#!/usr/bin/env python3
"""ML benchmark and stacking layer for the fight simulator (task key: ml).

Run from the project root:

    python3 tools/ml.py                 # full run: features, time-ordered CV on 2010-2023, final fit, report
    python3 tools/ml.py --quick         # smaller GBM search (for development)
    python3 tools/ml.py --no-cache      # rebuild the feature table instead of reusing the scratch cache

What it does (research/model_ml.md has the results and the reasoning):

1. Walk-forward features for every UFC fight since 2010, built only from fights before that fight's date:
   time-decayed, empirical-Bayes-shrunk per-minute rates and accuracies (offence and defence, by target and
   position), knockdown power and chin, takedown / control / submission rates, record, finish rates,
   last-3 form, opponent quality (mean pre-fight Elo of past opponents), age, reach / height, stance
   matchup, layoff, UFC experience, weight-class moves, title / 5-round flags, Elo and a margin-aware Elo.
   Shrinkage targets are division league rates from the 5 years before Jan 1 of the fight's year.
2. Models, all symmetric in the corners (the A/B position is never a feature; every training fight is used
   in both orientations and predictions average the two):
   - L2 logistic regression on antisymmetric difference and matchup features (no intercept),
   - LightGBM and XGBoost on side features, differences, matchup terms and context,
   - 7-bin outcome models (A KO, A sub, A dec, draw, B dec, B sub, B KO): direct multinomial logistic and
     LightGBM, plus a factorised winner x method-given-winner model.
3. Time-ordered CV inside 2010-2023 only (expanding window, validation years 2015-2023); out-of-fold
   predictions for 2019-2023 feed Platt / isotonic recalibration and the stacking layer. 2024+ is
   scored once by the models trained on 2010-2023.
4. Stacking: logit-linear, no intercept, weights fit on 2019-2023 out-of-fold predictions. Inputs: Elo,
   ML probabilities, and (when present) the simulator's per-fight probabilities
   (data/derived/calibration.json) and the de-vigged market (data/derived/market.json).
5. Outputs: data/derived/ml.json with per-fight predictions keyed by backtest fight id, the GBM's 2024+
   predictions, and a page model: logistic coefficients + feature definitions + per-fighter feature values
   for the current roster, so the page can evaluate any matchup in JS.

Walk-forward discipline: features use only earlier fights; Elo is the walk-forward rating from
tools/build_db.py (K and boost tuned on 2019-2023 there); nothing from 2024+ is used for any choice.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):   # the box is shared and busy:
    os.environ.setdefault(_v, "1")                                         # multithreaded BLAS thrashes
import argparse
import datetime as dt
import hashlib
import json
import math
import pickle
import sys
import time
import warnings
from collections import Counter, defaultdict

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_db as B  # noqa: E402  (shared loaders: parse_fights, build_people, build_vectors, run_elo, priors)

ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
OUT_JSON = os.path.join(DERIVED, "ml.json")
CACHE_DIR = os.environ.get("ML_CACHE_DIR", os.path.join(ROOT, "out", "ml_cache"))   # out/ is gitignored scratch

warnings.filterwarnings("ignore")

FEATURES_FROM = dt.date(2010, 1, 1)       # first fight that gets a training row
TUNE_END = 2023                            # last year used for any choice
TEST_FROM = 2024
CV_VAL_YEARS = list(range(2015, 2024))     # expanding-window validation years inside 2010-2023
OOF_YEARS = list(range(2019, 2024))        # out-of-fold years used for recalibration and stacking
ELO_K, ELO_BOOST = 44, 1.5                 # build_db.py's choice (tuned on 2019-2023)

KI = B.KI
NK = B.NK
LBS = dict(B.LBS)


def kv(v, k):
    return v[KI[k]]


SIG_L = np.array([KI["d_lnd"], KI["c_lnd"], KI["g_lnd"]])
SIG_A = np.array([KI["d_att"], KI["c_att"], KI["g_att"]])
OSIG_L = np.array([KI["od_lnd"], KI["oc_lnd"], KI["og_lnd"]])
OSIG_A = np.array([KI["od_att"], KI["oc_att"], KI["og_att"]])


# ====================================================================== loading
def load_all():
    log = {}
    fights, _ = B.parse_fights(log)
    people = B.build_people(fights, log)
    B.build_vectors(fights, log)
    _, elo_pre, _ = B.run_elo(fights, ELO_K, ELO_BOOST, store=True)
    return fights, people, elo_pre


def perf_score(v, mode):
    """Per-fighter performance used by the margin-aware Elo: 'sig' = significant strikes landed;
    'judge' = judging-weight score (head 1, body 0.74, leg 0.59, KD 13.5, TD 1.6, control 2.6 per minute;
    weights from the EM round-winner fit in docs/BACKLOG.md)."""
    if mode == "sig":
        return float(v[SIG_L].sum())
    return float(v[KI["h_lnd"]] + 0.74 * v[KI["b_lnd"]] + 0.59 * v[KI["l_lnd"]] + 13.5 * v[KI["kd"]]
                 + 1.6 * v[KI["td_lnd"]] + 2.6 * v[KI["ctrl"]] / 60.0)


def margin_elo(fights, K=40.0, w_share=0.3, mode="sig", boost=1.5):
    """Elo whose actual score blends the result with the fighter's share of a performance score.

    score_A = (1 - w) * result + w * perfA / (perfA + perfB)   (result 1 / 0 / 0.5; share 0.5 without stats)
    Returns pre-fight ratings {fid: (ra, rb)}, decisive predictions [(year, p, y, both_exp)], final ratings.
    """
    R = defaultdict(lambda: 1500.0)
    N = Counter()
    pre, preds = {}, []
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        ra, rb = R[a], R[b]
        ea = 1.0 / (1.0 + 10.0 ** ((rb - ra) / 400.0))
        pre[f.fid] = (ra, rb)
        if f.winner in ("A", "B"):
            preds.append((f.date.year, ea, 1.0 if f.winner == "A" else 0.0, N[a] >= 1 and N[b] >= 1))
        if f.winner in ("A", "B", "D"):
            res = {"A": 1.0, "B": 0.0, "D": 0.5}[f.winner]
            share = 0.5
            if f.stats:
                pa = perf_score(f.stats["v"][0], mode)
                pb = perf_score(f.stats["v"][1], mode)
                if pa + pb > 0:
                    share = pa / (pa + pb)
            sa = (1 - w_share) * res + w_share * share
            ka = K * (boost if N[a] < 5 else 1.0)
            kb = K * (boost if N[b] < 5 else 1.0)
            R[a] = ra + ka * (sa - ea)
            R[b] = rb - kb * (sa - ea)
        N[a] += 1
        N[b] += 1
    return pre, preds, R


def tune_margin_elo(fights, mode):
    """Pick K and the performance-share weight by log loss on 2010-2023 decisive fights (both men had a
    prior UFC fight). 2024+ is never scored here."""
    best = None
    grid = []
    for K in (48, 72, 96, 128, 160, 200):
        for w in (0.5, 0.65, 0.8, 0.9):
            _, preds, _ = margin_elo(fights, K, w, mode)
            rows = [(p, y) for (yr, p, y, ex) in preds if 2010 <= yr <= TUNE_END and ex]
            p = np.clip(np.array([r[0] for r in rows]), 1e-6, 1 - 1e-6)
            y = np.array([r[1] for r in rows])
            ll = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
            grid.append({"K": K, "w_share": w, "log_loss_2010_2023": round(ll, 5)})
            if best is None or ll < best[0]:
                best = (ll, K, w)
    return {"mode": mode, "K": best[1], "w_share": best[2], "log_loss_2010_2023": round(best[0], 5),
            "grid": grid}


# ====================================================================== priors (walk-forward)
def priors_by_year(fights, years, window=5):
    out = {}
    for y in years:
        out[y] = B.build_priors(fights, dt.date(y - window, 1, 1), dt.date(y, 1, 1))
    return out


def prior_vector(P):
    """League per-fighter-minute rates in KEYS order plus the accuracies the features need."""
    v = np.array([float(P.get(k) or 0.0) for k in B.KEYS])
    return v


# ====================================================================== per-fighter state
class FState:
    __slots__ = ("days", "V", "has", "res", "cat", "opp", "opp_elo", "own_elo", "div", "sched", "title",
                 "mins", "ko_l_flag", "first_day", "n5", "ntitle", "elo2")

    def __init__(self):
        self.days, self.V, self.has, self.res, self.cat = [], [], [], [], []
        self.opp, self.opp_elo, self.own_elo, self.div, self.sched, self.title = [], [], [], [], [], []
        self.mins, self.ko_l_flag, self.elo2 = [], [], []
        self.first_day = None
        self.n5 = 0
        self.ntitle = 0


# feature parameters (shrinkage pseudo-exposures and decay); defaults from research/modeling_literature.md
FEAT_PARAMS = {"half_life": 730.0, "k_min": 20.0, "k_att": 100.0, "k_head_kd": 350.0, "k_td": 10.0,
               "form_half_life": 365.0}


def _sh(x, e, prior, k):
    return (x + k * prior) / (e + k)


def side_features(st, day, P, prm, fight_lbs):
    """Feature dict for one fighter as of `day` (fights strictly before it) against division priors P."""
    n_all = len(st.days)
    f = {}
    pv = P["vec"]
    lam = math.log(2) / prm["half_life"]
    lam_f = math.log(2) / prm["form_half_life"]
    if n_all:
        days = np.array(st.days, dtype=float)
        has = np.array(st.has, dtype=bool)
        V = np.array(st.V)                        # (n, NK) zeros where no stats
        w = np.exp(-lam * (day - days))
        S = (w[:, None] * V).sum(0)
        C = V.sum(0)
        wf = np.exp(-lam_f * (day - days))
        Sf = (wf[:, None] * V).sum(0)
    else:
        days = np.zeros(0)
        has = np.zeros(0, dtype=bool)
        S = np.zeros(NK)
        C = np.zeros(NK)
        Sf = np.zeros(NK)
        w = np.zeros(0)
        wf = np.zeros(0)
    km, ka, kh, kt = prm["k_min"], prm["k_att"], prm["k_head_kd"], prm["k_td"]
    m = kv(S, "min")
    mu = lambda k: pv[KI[k]]                    # league per-minute
    sig_mu = pv[SIG_L].sum()
    sigatt_mu = pv[SIG_A].sum()
    acc_mu = sig_mu / max(sigatt_mu, 1e-9)

    def rate(keys, src=S, mins=None, k=km):
        idx = [KI[x] for x in keys]
        mm = kv(src, "min") if mins is None else mins
        return _sh(src[idx].sum(), mm, pv[idx].sum(), k)

    def acc(lk, ak, src=S, k=ka):
        li = [KI[x] for x in lk]
        ai = [KI[x] for x in ak]
        pm = pv[li].sum() / max(pv[ai].sum(), 1e-9)
        return _sh(src[li].sum(), src[ai].sum(), pm, k)

    f["slpm"] = rate(["d_lnd", "c_lnd", "g_lnd"])
    f["sapm"] = rate(["od_lnd", "oc_lnd", "og_lnd"])
    f["satt"] = rate(["d_att", "c_att", "g_att"])
    f["osatt"] = rate(["od_att", "oc_att", "og_att"])
    f["acc"] = acc(["d_lnd", "c_lnd", "g_lnd"], ["d_att", "c_att", "g_att"])
    f["def"] = 1 - acc(["od_lnd", "oc_lnd", "og_lnd"], ["od_att", "oc_att", "og_att"])
    f["head_pm"] = rate(["h_lnd"])
    f["body_pm"] = rate(["b_lnd"])
    f["leg_pm"] = rate(["l_lnd"])
    f["ohead_pm"] = rate(["oh_lnd"])
    f["obody_pm"] = rate(["ob_lnd"])
    f["oleg_pm"] = rate(["ol_lnd"])
    f["acc_head"] = acc(["h_lnd"], ["h_att"])
    f["def_head"] = 1 - acc(["oh_lnd"], ["oh_att"])
    f["acc_leg"] = acc(["l_lnd"], ["l_att"])
    f["dist_pm"] = rate(["d_lnd"])
    f["clinch_pm"] = rate(["c_lnd"])
    f["ground_pm"] = rate(["g_lnd"])
    f["odist_pm"] = rate(["od_lnd"])
    f["oclinch_pm"] = rate(["oc_lnd"])
    f["oground_pm"] = rate(["og_lnd"])
    f["acc_dist"] = acc(["d_lnd"], ["d_att"])
    f["def_dist"] = 1 - acc(["od_lnd"], ["od_att"])
    f["tot_pm"] = rate(["t_lnd"])
    f["otot_pm"] = rate(["ot_lnd"])
    f["kd15"] = 15 * rate(["kd"])
    f["okd15"] = 15 * rate(["okd"])
    kdph = mu("kd") / max(mu("h_lnd"), 1e-9)
    f["power"] = _sh(kv(S, "kd"), kv(S, "h_lnd"), kdph, kh)
    f["chin"] = _sh(kv(S, "okd"), kv(S, "oh_lnd"), kdph, kh)           # KD absorbed per head strike absorbed
    f["td15"] = 15 * rate(["td_lnd"])
    f["tda15"] = 15 * rate(["td_att"])
    f["otd15"] = 15 * rate(["otd_lnd"])
    f["otda15"] = 15 * rate(["otd_att"])
    tdacc_mu = mu("td_lnd") / max(mu("td_att"), 1e-9)
    f["td_acc"] = _sh(kv(S, "td_lnd"), kv(S, "td_att"), tdacc_mu, kt)
    f["td_def"] = 1 - _sh(kv(S, "otd_lnd"), kv(S, "otd_att"), tdacc_mu, kt)
    f["ctrl"] = rate(["ctrl"]) / 60.0                                    # share of fight time in control
    f["octrl"] = rate(["octrl"]) / 60.0
    f["sub15"] = 15 * rate(["sub_att"])
    f["osub15"] = 15 * rate(["osub_att"])
    f["rev15"] = 15 * rate(["rev"])
    f["str_diff"] = f["slpm"] - f["sapm"]
    f["td_diff"] = f["td15"] - f["otd15"]
    f["ctrl_diff"] = f["ctrl"] - f["octrl"]
    f["mins_dec"] = m                                                     # decayed exposure
    # short-memory (form) striking differential
    mf = kv(Sf, "min")
    f["form_str_diff"] = (_sh(Sf[SIG_L].sum(), mf, sig_mu, km) - _sh(Sf[OSIG_L].sum(), mf, sig_mu, km))
    f["form_ctrl_diff"] = (_sh(kv(Sf, "ctrl"), mf, mu("ctrl"), km) - _sh(kv(Sf, "octrl"), mf, mu("octrl"), km)) / 60

    # ---- record (all UFC bouts)
    res = st.res
    cats = st.cat
    W = sum(1 for r in res if r == 1.0)
    L = sum(1 for r in res if r == 0.0)
    D = sum(1 for r in res if r == 0.5)
    f["n"] = n_all
    f["log_n"] = math.log1p(n_all)
    f["wins"] = W
    f["losses"] = L
    f["win_pct"] = (W + 1.0) / (W + L + 2.0)
    cnt = Counter((r, c) for r, c in zip(res, cats))
    kow = cnt[(1.0, "ko")]
    subw = cnt[(1.0, "sub")]
    decw = cnt[(1.0, "dec")]
    kol = cnt[(0.0, "ko")]
    subl = cnt[(0.0, "sub")]
    decl = cnt[(0.0, "dec")]
    f["ko_w_rate"] = (kow + 0.3) / (n_all + 1.0)
    f["sub_w_rate"] = (subw + 0.15) / (n_all + 1.0)
    f["dec_w_rate"] = (decw + 0.25) / (n_all + 1.0)
    f["ko_l_rate"] = (kol + 0.3) / (n_all + 1.0)
    f["sub_l_rate"] = (subl + 0.15) / (n_all + 1.0)
    f["dec_l_rate"] = (decl + 0.25) / (n_all + 1.0)
    f["finish_w_share"] = (kow + subw + 0.5) / (W + 1.0)
    f["finished_share"] = (kol + subl + 0.5) / (L + 1.0)
    f["ko_losses"] = sum(st.ko_l_flag)
    f["kd_absorbed_c"] = kv(C, "okd")
    f["sig_absorbed_c"] = C[OSIG_L].sum() / 100.0                        # career damage (hundreds)
    f["mins_c"] = kv(C, "min")
    nstat = int(has.sum())
    f["min_per_fight"] = (kv(C, "min") + 10.0) / (nstat + 1.0)
    f["n5"] = st.n5
    f["ntitle"] = st.ntitle
    # decayed record
    if n_all:
        rr = np.array([np.nan if r is None else r for r in res], dtype=float)
        ok = ~np.isnan(rr)
        f["win_dec"] = (float((w[ok] * rr[ok]).sum()) + 1.0) / (float(w[ok].sum()) + 2.0)
        f["win_form"] = (float((wf[ok] * rr[ok]).sum()) + 0.5) / (float(wf[ok].sum()) + 1.0)
        kol_w = np.array([1.0 if (r == 0.0 and c == "ko") else 0.0 for r, c in zip(res, cats)])
        f["ko_l_dec"] = float((w * kol_w).sum())
    else:
        f["win_dec"] = 0.5
        f["win_form"] = 0.5
        f["ko_l_dec"] = 0.0
    # last 3 (NC skipped)
    valid = [(r, c) for r, c in zip(res, cats) if r is not None]
    last3 = valid[-3:]
    f["last3_win"] = (sum(r for r, _ in last3) + 0.5 * (3 - len(last3))) / 3.0
    f["last3_fin_l"] = sum(1 for r, c in last3 if r == 0.0 and c in ("ko", "sub"))
    f["last1_win"] = valid[-1][0] if valid else 0.5
    f["last1_ko_l"] = 1.0 if (valid and valid[-1][0] == 0.0 and valid[-1][1] == "ko") else 0.0
    streak = 0
    for r, _ in reversed(valid):
        if r == 1.0 and streak >= 0:
            streak += 1
        elif r == 0.0 and streak <= 0:
            streak -= 1
        else:
            break
    f["streak"] = streak
    # ---- ratings and opponent quality
    oe = [e for e in st.opp_elo if e is not None]
    f["opp_elo_mean"] = float(np.mean(oe)) if oe else 1500.0
    f["opp_elo_last3"] = float(np.mean(oe[-3:])) if oe else 1500.0
    beaten = [e for e, r in zip(st.opp_elo, res) if r == 1.0 and e is not None]
    f["beaten_elo_max"] = max(beaten) if beaten else 1450.0
    f["beaten_elo_mean"] = float(np.mean(beaten)) if beaten else 1450.0
    # ---- time and physical
    f["layoff"] = (day - days[-1]) if n_all else np.nan
    f["log_layoff"] = math.log1p(f["layoff"]) if n_all else np.nan
    f["years_ufc"] = (day - st.first_day) / 365.25 if st.first_day is not None else 0.0
    # weight-class move
    prev_lbs = None
    for d in reversed(st.div):
        if LBS.get(d):
            prev_lbs = LBS[d]
            break
    f["wc_move"] = (fight_lbs - prev_lbs) if (fight_lbs and prev_lbs) else 0.0
    divs = [LBS.get(d) for d in st.div if LBS.get(d)]
    f["new_class"] = 1.0 if (fight_lbs and divs and fight_lbs not in divs) else 0.0
    f["debut"] = 1.0 if n_all == 0 else 0.0
    return f


def elo_change(st, cur_elo, k=3):
    """Pre-fight Elo minus the pre-fight Elo k fights ago (1500 before the first fight)."""
    if not st.own_elo:
        return 0.0
    past = st.own_elo[-k] if len(st.own_elo) >= k else 1500.0
    return cur_elo - past


# ====================================================================== the walk
def bin7(winner, method):
    """0..6 = A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO; None for NC / DQ / other."""
    if winner == "D":
        return 3
    if winner not in ("A", "B"):
        return None
    c = {"KO": 0, "DOC": 0, "SUB": 1, "UD": 2, "SD": 2, "MD": 2}.get(method)
    if c is None:
        return None
    return c if winner == "A" else 6 - c


def fight_lbs_of(f, sa_div, sb_div):
    if LBS.get(f.division):
        return LBS[f.division]
    homes = [LBS[d] for d in (sa_div, sb_div) if LBS.get(d)]
    return max(homes) if homes else None


def home_div(st, day, years=3):
    recent = [d for t, d in zip(st.days, st.div) if day - t <= 365.25 * years and d not in B.NON_DIV]
    if not recent:
        recent = [d for d in st.div if d not in B.NON_DIV]
    if not recent:
        return None
    return Counter(recent).most_common(1)[0][0]


def prior_pack(pri, div):
    P = pri.get(div) or pri.get("ALL")
    return {"vec": prior_vector(P), "div": div}


def matchup_features(fa, fb, P):
    """Antisymmetric matchup terms (A minus B) from log5-style products of offence and the opponent's defence."""
    pv = P["vec"]
    sig_mu = max(pv[SIG_L].sum(), 1e-9)
    h_mu = max(pv[KI["h_lnd"]], 1e-9)
    td_mu = max(15 * pv[KI["td_lnd"]], 1e-9)
    ctrl_mu = max(pv[KI["ctrl"]] / 60.0, 1e-9)
    sub_mu = max(15 * pv[KI["sub_att"]], 1e-9)
    g_mu = max(pv[KI["g_lnd"]], 1e-9)
    kdph = pv[KI["kd"]] / h_mu
    out = {}
    ea = fa["slpm"] * fb["sapm"] / sig_mu
    eb = fb["slpm"] * fa["sapm"] / sig_mu
    out["x_sig"] = ea - eb
    out["x_sig_share"] = ea / (ea + eb) - 0.5
    ha = fa["head_pm"] * fb["ohead_pm"] / h_mu
    hb = fb["head_pm"] * fa["ohead_pm"] / h_mu
    out["x_head"] = ha - hb
    ka = ha * fa["power"] * fb["chin"] / max(kdph, 1e-9)
    kb = hb * fb["power"] * fa["chin"] / max(kdph, 1e-9)
    out["x_kd"] = 15 * (ka - kb)
    ta = fa["td15"] * fb["otd15"] / td_mu
    tb = fb["td15"] * fa["otd15"] / td_mu
    out["x_td"] = ta - tb
    ca = fa["ctrl"] * fb["octrl"] / ctrl_mu
    cb = fb["ctrl"] * fa["octrl"] / ctrl_mu
    out["x_ctrl"] = ca - cb
    sa = fa["sub15"] * fb["osub15"] / sub_mu
    sb = fb["sub15"] * fa["osub15"] / sub_mu
    out["x_sub"] = sa - sb
    ga = fa["ground_pm"] * fb["oground_pm"] / g_mu
    gb = fb["ground_pm"] * fa["oground_pm"] / g_mu
    out["x_gnp"] = ga - gb
    out["x_acc"] = fa["acc"] * (1 - fb["def"]) - fb["acc"] * (1 - fa["def"])
    out["x_tdacc"] = fa["td_acc"] * (1 - fb["td_def"]) - fb["td_acc"] * (1 - fa["td_def"])
    # symmetric matchup context (used by method / GBM models)
    out["s_pace"] = ea + eb
    out["s_kd"] = 15 * (ka + kb)
    out["s_sub"] = sa + sb
    out["s_ctrl"] = ca + cb
    return out


def stance_terms(sa, sb):
    """Antisymmetric stance matchup indicators."""
    s = lambda x: (x or "").lower()
    a, b = s(sa), s(sb)
    out = {}
    out["st_south_vs_orth"] = float(a == "southpaw" and b == "orthodox") - float(b == "southpaw" and a == "orthodox")
    out["st_switch"] = float(a == "switch") - float(b == "switch")
    out["st_open"] = float((a == "southpaw") != (b == "southpaw") and a in ("southpaw", "orthodox")
                           and b in ("southpaw", "orthodox"))       # symmetric: open-stance fight
    return out


def build_table(fights, people, elo_pre, extra_ratings, prm=None, since=FEATURES_FROM, snapshot=None):
    """Walk every fight in date order; emit a feature row (both sides as of the fight) for fights >= since."""
    prm = dict(FEAT_PARAMS, **(prm or {}))
    years = sorted({f.date.year for f in fights if f.date >= since} | {snapshot.year + 1 if snapshot else 2027})
    pri = priors_by_year(fights, years)
    state = defaultdict(FState)
    rows = []
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        sa, sb = state[a], state[b]
        ea, eb = elo_pre[f.fid]
        xr = {k: pre[f.fid] for k, pre in extra_ratings.items()}
        if f.date >= since:
            ha, hb = home_div(sa, f.day), home_div(sb, f.day)
            div = f.division
            if div in B.NON_DIV:
                cands = [d for d in (ha, hb) if LBS.get(d)]
                div = max(cands, key=lambda d: LBS[d]) if cands else "ALL"
            P = prior_pack(pri[f.date.year], div)
            flbs = fight_lbs_of(f, ha, hb)
            fa = side_features(sa, f.day, P, prm, flbs)
            fb = side_features(sb, f.day, P, prm, flbs)
            for side, (fx, st, e, p) in enumerate(((fa, sa, ea, a), (fb, sb, eb, b))):
                fx["elo"] = e
                for k, v in xr.items():
                    fx[k] = v[side]
                fx["elo_chg3"] = elo_change(st, e)
                T = people[p]["tott"] or {}
                dob = T.get("dob")
                fx["age"] = (f.date - dob).days / 365.25 if dob else np.nan
                fx["height"] = T.get("height_in") or np.nan
                fx["reach"] = T.get("reach_in") or np.nan
                fx["ape"] = (fx["reach"] - fx["height"]) if (T.get("reach_in") and T.get("height_in")) else np.nan
                stc = (T.get("stance") or "").lower()
                fx["southpaw"] = float(stc == "southpaw")
                fx["switch"] = float(stc == "switch")
                fx["age_debut"] = ((dt.date.fromordinal(int(st.first_day)) - dob).days / 365.25
                                   if (dob and st.first_day is not None) else fx["age"])
            mx = matchup_features(fa, fb, P)
            T_a = people[a]["tott"] or {}
            T_b = people[b]["tott"] or {}
            mx.update(stance_terms(T_a.get("stance"), T_b.get("stance")))
            row = {"fid": f.fid, "date": f.date, "year": f.date.year, "event": f.event, "a": a, "b": b,
                   "slug_a": people[a].get("slug"), "slug_b": people[b].get("slug"),
                   "division": f.division, "prior_div": div, "lbs": flbs or np.nan,
                   "women": float(div.startswith("Women")), "title": float(bool(f.title)),
                   "five": float(f.sched == 5), "catch": float(f.division in B.NON_DIV),
                   "winner": f.winner, "method": f.method, "rnd": f.rnd, "bin7": bin7(f.winner, f.method),
                   "both_exp": len(sa.days) >= 1 and len(sb.days) >= 1,
                   "amb": a.startswith("amb:") or b.startswith("amb:")}
            for k, v in fa.items():
                row["A_" + k] = v
            for k, v in fb.items():
                row["B_" + k] = v
            for k, v in mx.items():
                row["M_" + k] = v
            rows.append(row)
        # apply the fight to both states
        for s, p, st, e_own, e_opp in ((0, a, sa, ea, eb), (1, b, sb, eb, ea)):
            if st.first_day is None:
                st.first_day = f.day
            st.days.append(f.day)
            if f.stats:
                st.V.append(f.stats["v"][s])
                st.has.append(True)
            else:
                st.V.append(np.zeros(NK))
                st.has.append(False)
            won = f.winner == ("A" if s == 0 else "B")
            lost = f.winner == ("B" if s == 0 else "A")
            st.res.append(1.0 if won else (0.0 if lost else (0.5 if f.winner == "D" else None)))
            st.cat.append(f.cat if (won or lost) else None)
            st.opp.append(f.persons[1 - s])
            st.opp_elo.append(e_opp)
            st.own_elo.append(e_own)
            st.div.append(f.division)
            st.sched.append(f.sched)
            st.title.append(bool(f.title))
            st.ko_l_flag.append(1 if (lost and f.method == "KO") else 0)
            if f.sched == 5:
                st.n5 += 1
            if f.title:
                st.ntitle += 1
    df = pd.DataFrame(rows)
    return df, state, pri


# ====================================================================== logistic design (antisymmetric, JS-exportable)
# Every term is a function of the two fighters' per-fighter values only, so the page can evaluate it for any pair.
#   logr:  log(xA + eps) - log(xB + eps)          logit: logit(xA) - logit(xB)
#   lin:   (xA - xB) * scale                      hinge: max(xA - h, 0) - max(xB - h, 0)
#   flag:  [xA > t] - [xB > t]                    share: uA vB / (uA vB + uB vA) - 0.5   (offence x opponent's allowed)
#   stance: [A southpaw & B orthodox] - [B southpaw & A orthodox]
# lin / hinge / flag terms on age, height, reach, ape, age_debut, log_layoff are 0 when either value is missing.
LOGR_KEYS = ("slpm sapm satt osatt head_pm body_pm leg_pm ohead_pm obody_pm oleg_pm dist_pm clinch_pm ground_pm "
             "odist_pm oclinch_pm oground_pm tot_pm otot_pm kd15 okd15 td15 tda15 otd15 otda15 ctrl octrl sub15 "
             "osub15 rev15 power chin").split()
LOGIT_KEYS = "acc def acc_head def_head acc_leg acc_dist def_dist td_acc td_def".split()
LIN_KEYS = ("str_diff td_diff ctrl_diff form_str_diff form_ctrl_diff win_pct win_dec win_form last3_win last3_fin_l "
            "last1_win last1_ko_l streak ko_w_rate sub_w_rate dec_w_rate ko_l_rate sub_l_rate dec_l_rate "
            "finish_w_share finished_share ko_losses kd_absorbed_c sig_absorbed_c log_n log_mins_c min_per_fight n5 "
            "ntitle ko_l_dec years_ufc wc_move new_class debut").split()
ELO_KEYS = "elo elo_sig elo_judge elo_chg3 opp_elo_mean opp_elo_last3 beaten_elo_max beaten_elo_mean".split()
PHYS_KEYS = "age height reach ape age_debut log_layoff".split()
SHARE_PAIRS = [("slpm", "sapm"), ("head_pm", "ohead_pm"), ("kd15", "okd15"), ("td15", "otd15"), ("ctrl", "octrl"),
               ("sub15", "osub15"), ("ground_pm", "oground_pm")]
EPS_LOG = 1e-3

GROUPS = {   # feature groups for ablation (term-name prefixes)
    "striking rates": ["slpm", "sapm", "satt", "osatt", "head_pm", "body_pm", "leg_pm", "ohead_pm", "obody_pm",
                       "oleg_pm", "dist_pm", "clinch_pm", "ground_pm", "odist_pm", "oclinch_pm", "oground_pm",
                       "tot_pm", "otot_pm", "str_diff", "form_str_diff"],
    "accuracy/defence": ["acc", "def", "acc_head", "def_head", "acc_leg", "acc_dist", "def_dist"],
    "KD power/chin": ["kd15", "okd15", "power", "chin"],
    "grappling": ["td15", "tda15", "otd15", "otda15", "ctrl", "octrl", "sub15", "osub15", "rev15", "td_acc", "td_def",
                  "td_diff", "ctrl_diff", "form_ctrl_diff"],
    "record/finishes": ["win_pct", "win_dec", "ko_w_rate", "sub_w_rate", "dec_w_rate", "ko_l_rate", "sub_l_rate",
                        "dec_l_rate", "finish_w_share", "finished_share", "ko_losses", "kd_absorbed_c",
                        "sig_absorbed_c", "ko_l_dec"],
    "recent form": ["win_form", "last3_win", "last3_fin_l", "last1_win", "last1_ko_l", "streak", "elo_chg3"],
    "experience": ["log_n", "log_mins_c", "min_per_fight", "n5", "ntitle", "years_ufc", "debut"],
    "Elo": ["elo"],
    "margin Elo": ["elo_sig", "elo_judge"],
    "opponent quality": ["opp_elo_mean", "opp_elo_last3", "beaten_elo_max", "beaten_elo_mean"],
    "age": ["age", "age30", "age34", "age_debut"],
    "size/reach": ["height", "reach", "ape"],
    "layoff/weight move": ["log_layoff", "lay_long", "wc_move", "new_class"],
    "stance": ["st_south_vs_orth", "st_switch"],
    "matchup shares": ["sh_" + u for u, _ in SHARE_PAIRS],
}


def lr_term_specs():
    T = []
    for k in LOGR_KEYS:
        T.append({"name": k, "type": "logr", "key": k, "eps": EPS_LOG})
    for k in LOGIT_KEYS:
        T.append({"name": k, "type": "logit", "key": k})
    for k in LIN_KEYS:
        T.append({"name": k, "type": "lin", "key": k, "scale": 1.0})
    for k in ELO_KEYS:
        T.append({"name": k, "type": "lin", "key": k, "scale": 0.01})
    for k in PHYS_KEYS:
        T.append({"name": k, "type": "lin", "key": k, "scale": 1.0, "missing_zero": True})
    for h in (30, 34):
        T.append({"name": "age%d" % h, "type": "hinge", "key": "age", "h": float(h), "missing_zero": True})
    T.append({"name": "lay_long", "type": "flag", "key": "layoff", "t": 450.0, "missing_zero": True})
    for u, v in SHARE_PAIRS:
        T.append({"name": "sh_" + u, "type": "share", "u": u, "v": v})
    T.append({"name": "st_south_vs_orth", "type": "stance"})
    T.append({"name": "st_switch", "type": "lin", "key": "switch", "scale": 1.0})
    return T


def _logit(p):
    p = np.clip(p, 1e-4, 1 - 1e-4)
    return np.log(p / (1 - p))


def add_derived(df):
    for s in ("A_", "B_"):
        df[s + "log_mins_c"] = np.log1p(df[s + "mins_c"])
        df[s + "orthodox"] = ((df[s + "southpaw"] == 0) & (df[s + "switch"] == 0) & df[s + "height"].notna()).astype(float)
    return df


def lr_design(df, specs=None, A="A_", Bp="B_"):
    """Antisymmetric term matrix (n x terms) for the logistic model, A minus B."""
    specs = specs or lr_term_specs()
    out = {}
    for t in specs:
        ty = t["type"]
        if ty == "logr":
            out[t["name"]] = np.log(df[A + t["key"]] + t["eps"]) - np.log(df[Bp + t["key"]] + t["eps"])
        elif ty == "logit":
            out[t["name"]] = _logit(df[A + t["key"]]) - _logit(df[Bp + t["key"]])
        elif ty == "lin":
            v = (df[A + t["key"]] - df[Bp + t["key"]]) * t["scale"]
            out[t["name"]] = v.fillna(0.0) if t.get("missing_zero") else v
        elif ty == "hinge":
            v = np.maximum(df[A + t["key"]] - t["h"], 0) - np.maximum(df[Bp + t["key"]] - t["h"], 0)
            out[t["name"]] = v.fillna(0.0)
        elif ty == "flag":
            a, b = df[A + t["key"]], df[Bp + t["key"]]
            v = (a > t["t"]).astype(float) - (b > t["t"]).astype(float)
            v[a.isna() | b.isna()] = 0.0
            out[t["name"]] = v
        elif ty == "share":
            ea = df[A + t["u"]] * df[Bp + t["v"]]
            eb = df[Bp + t["u"]] * df[A + t["v"]]
            out[t["name"]] = ea / (ea + eb + 1e-12) - 0.5
        elif ty == "stance":
            out[t["name"]] = ((df[A + "southpaw"] * df[Bp + "orthodox"]) - (df[Bp + "southpaw"] * df[A + "orthodox"]))
    X = pd.DataFrame(out, index=df.index)
    return X.astype(float).fillna(0.0)


def term_group(name):
    for g, names in GROUPS.items():
        if name in names:
            return g
    return "other"


# ====================================================================== GBM design (side, difference, matchup, context)
GBM_SIDE = ("age n elo elo_sig log_layoff ko_losses kd_absorbed_c win_pct slpm sapm td15 ctrl sub15 power chin height "
            "reach years_ufc last3_win wc_move debut").split()
M_ANTI = ["x_sig", "x_sig_share", "x_head", "x_kd", "x_td", "x_ctrl", "x_sub", "x_gnp", "x_acc", "x_tdacc",
          "st_south_vs_orth", "st_switch"]
M_SYM = ["s_pace", "s_kd", "s_sub", "s_ctrl", "st_open"]
CTX = ["lbs", "women", "title", "five", "catch"]


def gbm_design(df, Xlr, flip=False):
    a, b = ("B_", "A_") if flip else ("A_", "B_")
    sg = -1.0 if flip else 1.0
    F = {}
    for k in GBM_SIDE:
        F["a_" + k] = df[a + k].to_numpy(dtype=float)
        F["b_" + k] = df[b + k].to_numpy(dtype=float)
    for c in Xlr.columns:
        F["d_" + c] = sg * Xlr[c].to_numpy(dtype=float)
    for c in M_ANTI:
        F["m_" + c] = sg * df["M_" + c].to_numpy(dtype=float)
    for c in M_SYM:
        F["m_" + c] = df["M_" + c].to_numpy(dtype=float)
    for c in CTX:
        F[c] = df[c].to_numpy(dtype=float)
    return pd.DataFrame(F, index=df.index)


# ====================================================================== metrics
def log_loss(p, y):
    p = np.clip(np.asarray(p, float), 1e-6, 1 - 1e-6)
    y = np.asarray(y, float)
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def auc(p, y):
    p, y = np.asarray(p), np.asarray(y)
    order = np.argsort(p)
    ranks = np.empty(len(p))
    ranks[order] = np.arange(1, len(p) + 1)
    # average ranks for ties
    s = pd.Series(p)
    ranks = s.rank().to_numpy()
    npos = y.sum()
    nneg = len(y) - npos
    return float((ranks[y == 1].sum() - npos * (npos + 1) / 2) / (npos * nneg)) if npos and nneg else float("nan")


def calib_slope(p, y):
    """Logistic recalibration y ~ a + b * logit(p) (data orientation)."""
    from scipy.optimize import minimize
    z = _logit(np.asarray(p))
    y = np.asarray(y, float)

    def f(w):
        t = w[0] + w[1] * z
        return np.sum(np.logaddexp(0, t) - y * t), np.array([np.sum(1 / (1 + np.exp(-t)) - y),
                                                             np.sum((1 / (1 + np.exp(-t)) - y) * z)])
    r = minimize(f, np.array([0.0, 1.0]), jac=True, method="BFGS")
    return float(r.x[0]), float(r.x[1])


def ece_sym(p, y, nb=10):
    """Calibration error counting each fight from both sides (corner-symmetric), 10 equal-width bins."""
    p = np.r_[p, 1 - np.asarray(p)]
    y = np.r_[y, 1 - np.asarray(y)]
    e = 0.0
    for k in range(nb):
        m = (p >= k / nb) & (p < (k + 1) / nb) if k < nb - 1 else (p >= k / nb)
        if m.any():
            e += m.sum() / len(p) * abs(p[m].mean() - y[m].mean())
    return float(e)


def calib_table(p, y, nb=10):
    p = np.r_[p, 1 - np.asarray(p)]
    y = np.r_[y, 1 - np.asarray(y)]
    out = []
    for k in range(nb):
        m = (p >= k / nb) & (p < (k + 1) / nb) if k < nb - 1 else (p >= k / nb)
        if m.any():
            out.append({"lo": k / nb, "hi": (k + 1) / nb, "n_sides": int(m.sum()), "pred": round(float(p[m].mean()), 4),
                        "obs": round(float(y[m].mean()), 4)})
    return out


def win_metrics(p, y):
    p = np.asarray(p, float)
    y = np.asarray(y, float)
    a, b = calib_slope(p, y)
    return {"n": int(len(y)), "log_loss": round(log_loss(p, y), 5),
            "brier": round(float(np.mean((p - y) ** 2)), 5),
            "accuracy": round(float(np.mean((p > 0.5) == (y > 0.5))), 4),
            "auc": round(auc(p, y), 4), "ece_sym": round(ece_sym(p, y), 4),
            "calib_intercept": round(a, 3), "calib_slope": round(b, 3)}


def ll7(P, k):
    P = np.clip(np.asarray(P, float), 1e-6, 1)
    P = P / P.sum(1, keepdims=True)
    return float(-np.mean(np.log(P[np.arange(len(k)), np.asarray(k, int)])))


def cluster_boot(groups, stat_fn, n_boot=2000, seed=7):
    """Event-cluster bootstrap. stat_fn(idx) -> float or array. Returns array of bootstrap stats."""
    rng = np.random.default_rng(seed)
    g = pd.Series(groups).astype("category").cat.codes.to_numpy()
    G = g.max() + 1
    members = [np.flatnonzero(g == i) for i in range(G)]
    out = []
    for _ in range(n_boot):
        pick = rng.integers(0, G, G)
        idx = np.concatenate([members[i] for i in pick])
        out.append(stat_fn(idx))
    return np.array(out)


def ci(arr, lo=2.5, hi=97.5):
    return [round(float(np.percentile(arr, lo)), 5), round(float(np.percentile(arr, hi)), 5)]


# ====================================================================== models
def fit_lr(X, y, lam, sw=None):
    """L2 logistic regression without intercept (antisymmetric features => corner-symmetric model).
    Loss = weighted mean log loss + lam/2 ||w||^2 on standardised columns."""
    from scipy.optimize import minimize
    n, d = X.shape
    sw = np.ones(n) if sw is None else np.asarray(sw, float)
    sw = sw / sw.sum()

    def f(w):
        z = X @ w
        p = 1 / (1 + np.exp(-z))
        return np.sum(sw * (np.logaddexp(0, z) - y * z)) + 0.5 * lam * w @ w, X.T @ (sw * (p - y)) + lam * w
    r = minimize(f, np.zeros(d), jac=True, method="L-BFGS-B", options={"maxiter": 3000})
    return r.x


class LRModel:
    def __init__(self, lam, recency=None):
        self.lam, self.recency = lam, recency

    def fit(self, X, y, years=None, ref_year=None):
        X = np.asarray(X, float)
        self.s = X.std(0) + 1e-9
        sw = None
        if self.recency and years is not None:
            sw = 0.5 ** ((ref_year - np.asarray(years)) / self.recency)
        self.w = fit_lr(X / self.s, np.asarray(y, float), self.lam, sw)
        self.coef = self.w / self.s
        return self

    def predict(self, X):
        return 1 / (1 + np.exp(-(np.asarray(X, float) @ self.coef)))


def lgb_fit(params, G0, G1, y, rounds, sw=None):
    import lightgbm as lgb
    Xa = pd.concat([G0, G1], ignore_index=True)
    ya = np.r_[y, 1 - y]
    w = None if sw is None else np.r_[sw, sw]
    p = dict(params)
    p.update(objective="binary", verbose=-1, num_threads=1, max_bin=63, seed=p.get("seed", 1),
             bagging_freq=1, deterministic=True, force_row_wise=True)
    return lgb.train(p, lgb.Dataset(Xa, ya, weight=w), num_boost_round=rounds)


def lgb_pred(m, G0, G1, it=None):
    return 0.5 * (m.predict(G0, num_iteration=it) + 1 - m.predict(G1, num_iteration=it))


def xgb_fit(params, G0, G1, y, rounds):
    import xgboost as xgb
    Xa = pd.concat([G0, G1], ignore_index=True)
    ya = np.r_[y, 1 - y]
    p = dict(params)
    p.update(objective="binary:logistic", eval_metric="logloss", nthread=1, tree_method="hist", max_bin=63,
             seed=1, verbosity=0)
    return xgb.train(p, xgb.DMatrix(Xa, label=ya), num_boost_round=rounds)


def xgb_pred(m, G0, G1, it=None):
    import xgboost as xgb
    r = (0, it) if it else (0, 0)
    return 0.5 * (m.predict(xgb.DMatrix(G0), iteration_range=r) + 1 - m.predict(xgb.DMatrix(G1), iteration_range=r))


# ====================================================================== 7-bin outcome models
METHOD_SIDE_LOG = ["slpm", "sapm", "head_pm", "ohead_pm", "ground_pm", "oground_pm", "kd15", "okd15", "td15",
                   "otd15", "ctrl", "octrl", "sub15", "osub15", "power", "chin", "leg_pm", "clinch_pm"]
METHOD_SIDE_LOGIT = ["acc", "def", "td_acc", "td_def"]
METHOD_SIDE_LIN = ["ko_w_rate", "sub_w_rate", "dec_w_rate", "ko_l_rate", "sub_l_rate", "dec_l_rate",
                   "finish_w_share", "finished_share", "ko_losses", "kd_absorbed_c", "sig_absorbed_c", "log_n",
                   "min_per_fight", "last1_ko_l", "ko_l_dec", "win_pct", "streak"]
METHOD_SIDE_ELO = ["elo", "elo_sig"]


def side_block(df, p):
    """Per-fighter transformed features for the method / multinomial models (prefix p = 'A_' or 'B_')."""
    F = {}
    for k in METHOD_SIDE_LOG:
        F["log_" + k] = np.log(df[p + k] + EPS_LOG)
    for k in METHOD_SIDE_LOGIT:
        F["lgt_" + k] = _logit(df[p + k])
    for k in METHOD_SIDE_LIN:
        F[k] = df[p + k]
    for k in METHOD_SIDE_ELO:
        F[k] = df[p + k] / 100.0
    age = df[p + "age"]
    F["age"] = age.fillna(30.0)
    F["age30"] = np.maximum(age.fillna(30.0) - 30, 0)
    F["reach"] = (df[p + "reach"] - df[p + "height"]).fillna(0.0)
    return pd.DataFrame(F, index=df.index).astype(float)


def ctx_block(df):
    return pd.DataFrame({"lbs": df["lbs"].fillna(160.0) / 100.0, "women": df["women"], "five": df["five"],
                         "title": df["title"], "catch": df["catch"]}, index=df.index).astype(float)


def method_label(df, winner_side):
    """0 KO/TKO, 1 SUB, 2 DEC from the fight's method (winner-oriented); -1 otherwise."""
    m = df["method"].map({"KO": 0, "DOC": 0, "SUB": 1, "UD": 2, "SD": 2, "MD": 2}).fillna(-1).astype(int)
    return m.to_numpy()


def method_design(df, winner_is_a):
    """Winner-oriented design: [winner side block, loser side block, context]."""
    SA, SB = side_block(df, "A_"), side_block(df, "B_")
    w = np.asarray(winner_is_a, bool)[:, None]
    W = np.where(w, SA.to_numpy(), SB.to_numpy())
    L = np.where(w, SB.to_numpy(), SA.to_numpy())
    C = ctx_block(df).to_numpy()
    cols = (["w_" + c for c in SA.columns] + ["l_" + c for c in SB.columns] + list(ctx_block(df.iloc[:1]).columns))
    return np.hstack([W, L, C]), cols


class SoftmaxLR:
    """Multinomial logistic regression with L2 on standardised columns (sklearn lbfgs)."""

    def __init__(self, C):
        self.C = C

    def fit(self, X, y, sw=None):
        from sklearn.linear_model import LogisticRegression
        self.mu = X.mean(0)
        self.s = X.std(0) + 1e-9
        self.m = LogisticRegression(C=self.C, max_iter=4000, tol=1e-6)
        self.m.fit((X - self.mu) / self.s, y, sample_weight=sw)
        self.classes = list(self.m.classes_)
        return self

    def predict(self, X, ncls):
        P = np.zeros((len(X), ncls))
        P[:, self.classes] = self.m.predict_proba((X - self.mu) / self.s)
        return P

    def export(self, cols):
        """Raw-unit coefficients: logit_k = b_k + sum_j W_kj x_j."""
        W = self.m.coef_ / self.s
        b = self.m.intercept_ - (self.m.coef_ * (self.mu / self.s)).sum(1)
        return {"classes": [int(c) for c in self.classes], "features": cols,
                "intercept": [round(float(v), 6) for v in b],
                "coef": [[round(float(v), 6) for v in row] for row in W]}


def assemble7(pA, mA, mB, pD):
    """7-bin from P(A wins | decisive), method-given-winner (rows: KO, SUB, DEC) for each side, draw rate."""
    pA = np.asarray(pA)[:, None]
    q = 1 - pD
    out = np.zeros((len(pA), 7))
    out[:, 0:3] = q * pA * mA
    out[:, 3] = pD
    out[:, 4] = q * (1 - pA[:, 0]) * mB[:, 2]
    out[:, 5] = q * (1 - pA[:, 0]) * mB[:, 1]
    out[:, 6] = q * (1 - pA[:, 0]) * mB[:, 0]
    return out


def direct7_design(df, flip=False):
    a, b = ("B_", "A_") if flip else ("A_", "B_")
    SA, SB = side_block(df, a), side_block(df, b)
    C = ctx_block(df)
    X = np.hstack([SA.to_numpy(), SB.to_numpy(), C.to_numpy()])
    cols = ["a_" + c for c in SA.columns] + ["b_" + c for c in SB.columns] + list(C.columns)
    return X, cols


MIRROR7 = np.array([6, 5, 4, 3, 2, 1, 0])


def base7(df_train, df_eval):
    """Corner-symmetric base rates by (scheduled rounds, women): P(KO/SUB/DEC | decisive) and P(draw)."""
    out = np.zeros((len(df_eval), 7))
    tr = df_train[df_train["bin7"].notna()]
    allm = _method_split(tr)
    for i, (five, women) in enumerate(zip(df_eval["five"], df_eval["women"])):
        g = tr[(tr["five"] == five) & (tr["women"] == women)]
        ms = _method_split(g) if len(g) >= 150 else allm
        out[i] = ms
    return out


def _method_split(g):
    b = g["bin7"].astype(int).to_numpy()
    c = np.bincount(b, minlength=7).astype(float) + 0.5
    pD = c[3] / c.sum()
    ko = c[0] + c[6]
    sub = c[1] + c[5]
    dec = c[2] + c[4]
    t = ko + sub + dec
    q = 1 - pD
    return np.array([q * ko / t / 2, q * sub / t / 2, q * dec / t / 2, pD, q * dec / t / 2, q * sub / t / 2,
                     q * ko / t / 2])


def method_split_given_winner(base7row):
    m = np.array([base7row[0], base7row[1], base7row[2]])
    return m / m.sum()


# ====================================================================== external inputs for stacking
def load_external(ids):
    """Per-fight probabilities (A wins | decisive) from other pipeline stages when their files exist."""
    ext = {}
    src = {}
    p = os.path.join(DERIVED, "market.json")
    if os.path.exists(p):
        M = json.load(open(p))["fights"]
        for key, field in (("mkt_close", "p_power_close"), ("mkt_close_mult", "p_novig_close"),
                           ("mkt_open", "p_novig_open"), ("mkt_rating", "p_market_rating")):
            ext[key] = {i: M[i][field] for i in ids if i in M and M[i].get(field) is not None}
        src["market"] = "data/derived/market.json (tools/market.py): p_power_close = power de-vig of the consensus close; " \
                        "p_novig_open = multiplicative de-vig of the opening line; p_market_rating = walk-forward " \
                        "Kalman market rating from earlier closing lines (usable before a line exists)"
    p = os.path.join(DERIVED, "moe_engine_bt.json")
    if os.path.exists(p):
        E = json.load(open(p))
        F = E["fights"]
        ext["engine"] = {i: F[i]["pA"] / max(F[i]["pA"] + F[i]["pB"], 1e-9) for i in ids if i in F}
        src["engine"] = ("data/derived/moe_engine_bt.json (engine v%s via tools/moe_engine_bt.js, %d sims per corner "
                         "order, pA/(pA+pB))" % (E["meta"].get("engine_version"), E["meta"].get("sims_per_orientation", 0)))
    p = os.path.join(DERIVED, "calibration.json")
    if os.path.exists(p):
        try:
            C = json.load(open(p))
            F = C.get("fights") or C.get("predictions") or {}
            got = {}
            for i in ids:
                r = F.get(i)
                if isinstance(r, dict):
                    v = r.get("pA") if r.get("pA") is not None else r.get("p")
                    if v is not None:
                        pb = r.get("pB")
                        got[i] = v / (v + pb) if pb else v
            if got:
                ext["engine_cal"] = got
                src["engine_cal"] = "data/derived/calibration.json per-fight engine probabilities"
        except Exception:
            pass
    p = os.path.join(DERIVED, "ratings.json")
    if os.path.exists(p):
        try:
            R = json.load(open(p))
            F = R.get("fights") or R.get("backtest") or {}
            best = R.get("best") or R.get("recommended")
            got = {}
            for i in ids:
                r = F.get(i)
                if isinstance(r, dict):
                    v = None
                    if isinstance(best, str) and isinstance(r.get(best), (int, float)):
                        v = r[best]
                    elif isinstance(r.get("p"), dict) and isinstance(best, str):
                        v = r["p"].get(best)
                    elif isinstance(r.get("p_best"), (int, float)):
                        v = r["p_best"]
                    if v is not None:
                        got[i] = v
            if got:
                ext["ratings"] = got
                src["ratings"] = "data/derived/ratings.json (%s)" % best
        except Exception:
            pass
    return ext, src
