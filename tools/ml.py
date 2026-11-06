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
import argparse
import datetime as dt
import hashlib
import json
import math
import os
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
CACHE_DIR = os.environ.get("ML_CACHE_DIR", os.path.join("/tmp", "ml_cache"))

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


def margin_elo(fights, K=40.0, w_share=0.3, boost=1.5, until=None):
    """Elo whose actual score blends the result with the share of significant strikes landed.

    score_A = (1 - w) * result + w * sigA / (sigA + sigB)   (result 1 / 0 / 0.5; share 0.5 without stats)
    Returns pre-fight ratings {fid: (ra, rb)} and decisive predictions [(year, p, y, both_exp)].
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
                la = float(f.stats["v"][0][SIG_L].sum())
                lb = float(f.stats["v"][1][SIG_L].sum())
                if la + lb > 0:
                    share = la / (la + lb)
            sa = (1 - w_share) * res + w_share * share
            ka = K * (boost if N[a] < 5 else 1.0)
            kb = K * (boost if N[b] < 5 else 1.0)
            R[a] = ra + ka * (sa - ea)
            R[b] = rb - kb * (sa - ea)
        N[a] += 1
        N[b] += 1
    return pre, preds


def tune_margin_elo(fights):
    """Pick K and the strike-share weight on 2010-2018 decisive fights (both men experienced)."""
    best = None
    grid = []
    for K in (24, 32, 40, 48, 56):
        for w in (0.0, 0.2, 0.35, 0.5):
            _, preds = margin_elo(fights, K, w)
            rows = [(p, y) for (yr, p, y, ex) in preds if 2010 <= yr <= 2018 and ex]
            p = np.clip(np.array([r[0] for r in rows]), 1e-6, 1 - 1e-6)
            y = np.array([r[1] for r in rows])
            ll = float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))
            grid.append({"K": K, "w_share": w, "log_loss_2010_2018": round(ll, 5)})
            if best is None or ll < best[0]:
                best = (ll, K, w)
    return {"K": best[1], "w_share": best[2], "log_loss_2010_2018": round(best[0], 5), "grid": grid}


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


def build_table(fights, people, elo_pre, elo2_pre, prm=None, since=FEATURES_FROM, roster_slugs=None,
                snapshot=None):
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
        e2a, e2b = elo2_pre[f.fid]
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
            for fx, st, e, e2, p in ((fa, sa, ea, e2a, a), (fb, sb, eb, e2b, b)):
                fx["elo"] = e
                fx["elo2"] = e2
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
        for s, p, st, e_own, e_opp, e2 in ((0, a, sa, ea, eb, e2a), (1, b, sb, eb, ea, e2b)):
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
            st.elo2.append(e2)
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
