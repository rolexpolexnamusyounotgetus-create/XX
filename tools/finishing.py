#!/usr/bin/env python3
"""Fighter finishing tendencies and the joint who x how x when model (task key: finishing).

Run from the project root (stages cache into out/finishing_cache/, each can be re-run alone):

    nice -n 5 python3 tools/finishing.py base      # methodround table + ML v2 S2 inputs; S2 / S2+ml2win per fold
    nice -n 5 python3 tools/finishing.py feats     # walk-forward fighter finishing state (events, filter inputs)
    nice -n 5 python3 tools/finishing.py tune      # hyperparameters by forward-chained CV on 2016-2019
    nice -n 5 python3 tools/finishing.py cv        # forward-chained CV 2020-2023 vs S2+ml2win (primary decision)
    nice -n 5 python3 tools/finishing.py stage2    # 2019+ verified layers (statlines, durability, bayes) on top
    nice -n 5 python3 tools/finishing.py gate      # stack gate: blend with S2+ml2win, forward-chained 2021-2023
    nice -n 5 python3 tools/finishing.py holdout   # 2024-01-01..2025-12-31 scored ONCE (refuses a second run)
    nice -n 5 python3 tools/finishing.py export    # data/derived/finishing.json (+ JS model, roster, test vectors)
    nice -n 5 python3 tools/finishing.py swap      # corner-swap test of the whole pipeline (refit on swapped rows)

What it models. The ML v2 winner probability decides who wins (it is taken as given, never re-predicted). This tool
models HOW (KO/TKO, submission, decision) given the winner, and WHEN (the finishing round) given the winner and the
method, from fighter-level finishing tendencies:
  (a) empirical-Bayes shrunk finishing and being-finished rates by method and by round (round 1, late rounds per late
      round started: early finishers and cardio fade), as observed / expected ratios with a gamma prior whose strength
      is fit by marginal likelihood on the training years; the expected counts come from a baseline logit of division x
      era x age x format fit on training years only; for low-sample fighters the prior mean moves with the pre-UFC
      record (preufc.json walk-forward snapshots);
  (b) an online opponent-adjusted finishing rating (KO / submission offence and vulnerability per fighter, a diagonal
      Gaussian filter over every UFC bout, walk-forward by construction);
  (c) five- vs three-round structure and title fights (fight terms and their interactions with the tendencies);
  (d) a joint model consistent with the winner: P(cell) = P_ml2(W) x P(method | W, x) x P(round | W, method, x).
The 2019+ verified layers (statlines expected KD / control / submission attempts, durability chin / power, bayes roster
skills) enter as a second stage trained on 2019+ rows only (stage2), gated like every other choice.

Hidden-data protocol (docs/BACKLOG.md). build_db.parse_fights is wrapped at import (tools/ml2.py) so every fight dated
2026-01-01 or later is dropped right after parsing; every keyed source is read for dates < 2026-01-01 only. Every choice
(features, penalties, shrinkage, model family, stage 2, blend weights) is made by forward-chained CV on data before
2024: hyperparameters on the 2016-2019 folds, the model choice on the 2020-2023 folds against S2+ml2win, the stack gate
on 2021-2023 with the 0.0005 rule. 2024-01-01..2025-12-31 is scored once (holdout; a marker file refuses a rerun).

Corner symmetry (Evaluation rule). No term reads the corner: the method model is oriented by the winner (its class
intercepts are method base rates given a win), the round model by the finisher, and the winner probability is ML v2's
(antisymmetric, no intercept). Swapping A and B swaps every cell exactly; `swap` asserts it on a refit.
"""
import os

for _v in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS"):
    os.environ.setdefault(_v, "1")
import argparse
import datetime as dt
import json
import math
import pickle
import sys
import time
import warnings
from collections import defaultdict

import numpy as np
import pandas as pd
from scipy.optimize import minimize, minimize_scalar
from scipy.special import gammaln

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("FIN_CACHE", os.path.join(ROOT, "out", "finishing_cache"))
OUT_JSON = os.path.join(DERIVED, "finishing.json")
SCRATCH_VAULT = "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault"
VAULT = dt.date(2026, 1, 1)
VAULT_S = "2026-01-01"
TEST_FROM = dt.date(2024, 1, 1)
TUNE_YEARS = (2016, 2017, 2018, 2019)       # hyperparameter folds (each fit on everything earlier)
CV_YEARS = (2020, 2021, 2022, 2023)         # model-choice folds (the comparison with S2+ml2win)
GATE_YEARS = (2021, 2022, 2023)             # stack gate (blend weights fit on earlier OOF rows)
FOLDS = TUNE_YEARS + CV_YEARS + (2024,)     # 2024 = the 2024-2025 window, fit on everything before 2024
SEL_MIN = 0.0005                            # the 0.0005 rule (tools/ml2.py SEL_MIN)
os.makedirs(CACHE, exist_ok=True)
warnings.filterwarnings("ignore")

import ml2 as M2  # noqa: E402  (wraps build_db.parse_fights: 2026+ dropped at parse)
import methodround as MR  # noqa: E402
import build_db as B  # noqa: E402

assert B.parse_fights is M2._parse_dev_only, "vault wrapper missing"
STAGES = {}
R5, NC_ = MR.R5, MR.NC_
I_XKO, I_XSUB, I_YKO, I_YSUB, I_XDEC, I_YDEC, I_DRAW = (MR.I_XKO, MR.I_XSUB, MR.I_YKO, MR.I_YSUB, MR.I_XDEC,
                                                        MR.I_YDEC, MR.I_DRAW)
METRICS = ["bin7", "joint", "method_given_winner", "round_given_fin", "method3", "finish", "ko_vs_sub",
           "method_round", "winner"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def cpath(name):
    return os.path.join(CACHE, name)


def save(obj, name):
    tmp = cpath(name + ".tmp")
    with open(tmp, "wb") as fh:
        pickle.dump(obj, fh, protocol=4)
    os.replace(tmp, cpath(name))


def load(name):
    with open(cpath(name), "rb") as fh:
        return pickle.load(fh)


def jload(name):
    with open(os.path.join(DERIVED, name)) as fh:
        return json.load(fh)


def sig(z):
    return 1.0 / (1.0 + np.exp(-z))


def logit(p, c=1e-4):
    p = np.clip(np.asarray(p, float), c, 1 - c)
    return np.log(p / (1 - p))


def fold_masks(T, v, start=None):
    """Training rows (year < v, year >= start) and prediction rows (year == v; v == 2024 means 2024-2025)."""
    yr = T["year"].to_numpy()
    tr = yr < v
    if start is not None:
        tr = tr & (yr >= start)
    va = (yr == v) if v < 2024 else (yr >= 2024)
    return tr, va


# ====================================================================== stage: base
def stage_base(args):
    """methodround's walk-forward table and design (2026 dropped at parse), ML v2's S2 columns, and per fold: the
    competing-risks hazard (round shapes), the S2 six-class logit and S2 + ML v2 winner, exactly as tools/ml2.py's
    method stage builds them, extended to the 2016-2019 folds."""
    t0 = time.time()
    D = MR.prepare(False)
    T, FX, FY, y = D["T"], D["FX"], D["FY"], D["y"]
    assert T["date"].max() < VAULT, "vault row in the methodround table"
    S = M2.load_table()
    T2 = S["df"]
    assert T2["date"].max() < VAULT
    F = pickle.load(open(os.path.join(M2.CACHE, "fit.pkl"), "rb"))
    C = json.load(open(os.path.join(M2.CACHE, "cv.json")))
    chosen = jload("methodround.json")["meta"]["chosen"]
    m2 = json.load(open(os.path.join(M2.CACHE, "method.json")))
    nX, nY, pwin, okz = M2.method_new_cols(T, T2, F, C["lr"]["tau"], C["pre_means"])
    FX2 = pd.concat([FX, nX], axis=1)
    FY2 = pd.concat([FY, nY], axis=1)
    cols_s2 = D["stat_cols"] + list(nX.columns)
    C6 = m2["chosen_C6_S2"]
    H = np.full((len(T), NC_), np.nan)
    P6 = np.full((len(T), 6), np.nan)
    draw_c = chosen["draw_c"]
    for v in FOLDS:
        tr, va = fold_masks(T, v)
        hz = MR.HazardModel(MR.HAZ_COLS, C=chosen["C_haz"], C_dec=MR.C_DEC).fit(
            T[tr & (T["year"] >= MR.HAZ_START).to_numpy()], FX[tr & (T["year"] >= MR.HAZ_START).to_numpy()],
            FY[tr & (T["year"] >= MR.HAZ_START).to_numpy()], y[tr & (T["year"] >= MR.HAZ_START).to_numpy()])
        H[va] = hz.predict(T[va], FX[va], FY[va])
        m6 = tr & (T["year"] >= 2012).to_numpy()
        m = MR.C6Logit(cols_s2, C=C6, hl_years=MR.HL_YEARS).fit(T[m6], FX2[m6], FY2[m6], y[m6])
        P6[va] = m.predict6(T[va], FX2[va], FY2[va])
        log("base: fold %d hazard + S2 (%d train rows, %d predicted)" % (v, m6.sum(), va.sum()))
    P6w = MR.reweight_winner(np.nan_to_num(P6, nan=1 / 6), pwin)
    keep = ["id", "date", "year", "event", "division", "prior_div", "rounds", "title", "winner", "method", "cls", "rnd",
            "fight_s", "A_slug", "B_slug", "A_name", "B_name", "A_age", "B_age", "A_n", "B_n"]
    base = {"T": T[keep].copy(), "FX2": FX2, "FY2": FY2, "y": y, "H": H, "P6_S2": P6, "P6_S2w": P6w, "pwin": pwin,
            "okz": okz, "cols_s2": cols_s2, "stat_cols": D["stat_cols"], "new_cols": list(nX.columns),
            "draw_c": draw_c, "PR": D["PR"], "priors": D["priors"], "C6": C6, "C_haz": chosen["C_haz"],
            "PMK": D["PMK"]}
    save(base, "base.pkl")
    # reproduction check against tools/ml2.py's method stage (CV 2020-2023 joint 2.1407 for S2+ml2win)
    vm = T["year"].isin(CV_YEARS).to_numpy()
    for k, P in (("S2", P6), ("S2+ml2win", P6w)):
        J = MR.joint_from_c6(P[vm], H[vm], draw_c)
        s = MR.summarize_losses(MR.per_fight_losses(J, y[vm], T[vm]))
        ref = m2["cv"][k]
        log("base: %s CV 2020-23 joint %.5f (ml2 %.5f) bin7 %.5f (ml2 %.5f) mgw %.5f (ml2 %.5f)" % (
            k, s["joint"], ref["joint"], s["bin7"], ref["bin7"], s["method_given_winner"], ref["method_given_winner"]))
        assert abs(s["joint"] - ref["joint"]) < 2e-4, "S2 reproduction failed"
    log("base: done in %.0f s; rows %d (%s..%s); ML v2 winner present in %.1f%% of 2016+ rows" % (
        time.time() - t0, len(T), T["date"].min(), T["date"].max(), 100 * okz[(T["year"] >= 2016).to_numpy()].mean()))


STAGES["base"] = stage_base


# ====================================================================== stage: feats (walk-forward fighter state)
DIVS = [d for d in B.DIVISIONS if d not in B.NON_DIV]
EV_IND = ["w_ko", "w_sub", "w_dec", "l_ko", "l_sub", "l_dec", "dec_any", "w_r1", "l_r1", "w_late", "l_late"]
# indicator -> exposure column ("n_ok" = every decisive or drawn bout; "reach3" = bouts that started round 3)
EB_RATES = {"kow": ("w_ko", "n_ok"), "subw": ("w_sub", "n_ok"), "kol": ("l_ko", "n_ok"), "subl": ("l_sub", "n_ok"),
            "dec": ("dec_any", "n_ok"), "r1w": ("w_r1", "n_ok"), "r1l": ("l_r1", "n_ok"),
            "latew": ("w_late", "reach3"), "latel": ("l_late", "reach3")}
PRE_MAP = {"kow": ("ko_w", "n"), "subw": ("sub_w", "n"), "kol": ("ko_l", "n"), "subl": ("sub_l", "n")}


def stage_feats(args):
    """One event row per person per UFC bout (every bout in the snapshot, 2026 dropped at parse), the pointer of
    each methodround row side into its person's event list (events strictly before the fight day: same-day bouts
    never see each other), the fight sequence for the online finishing filter, pre-UFC counts from preufc.json's
    walk-forward snapshots (presence by preufc's own pre-fight target rule), and per-round output for cardio."""
    t0 = time.time()
    base = load("base.pkl")
    T = base["T"]
    lg_ = {}
    fights, _ = B.parse_fights(lg_)
    assert max(f.date for f in fights) < VAULT
    people = B.build_people(fights, lg_)
    B.build_vectors(fights, lg_)
    pid_of = {}
    ev = defaultdict(list)
    ev_person = []
    by_day = defaultdict(list)
    for f in fights:
        by_day[f.day].append(f)
    ptr = {}                  # (fid, side) -> (pid, n_prior_events)
    seq = []                  # fight sequence for the filter (day order)
    rows_fid = set(T["id"])
    snap_side = {}
    ufc_dates = defaultdict(list)
    for day in sorted(by_day):
        card = by_day[day]
        for f in card:
            a, b = f.persons
            if a == b:
                continue
            for p in (a, b):
                if p not in pid_of:
                    pid_of[p] = len(pid_of)
            if f.fid in rows_fid:
                for s, p in ((0, a), (1, b)):
                    ptr[(f.fid, s)] = (pid_of[p], len(ev[pid_of[p]]))
        for f in card:
            a, b = f.persons
            if a == b:
                continue
            cls = MR.ko_class(f)
            for s, p in ((0, a), (1, b)):
                pid = pid_of[p]
                P = people[p]
                dob = (P["tott"] or {}).get("dob")
                age = (f.date - dob).days / 365.25 if dob else np.nan
                won = f.winner == ("A" if s == 0 else "B")
                lost = f.winner == ("B" if s == 0 else "A")
                R = f.sched if f.sched in (3, 5) else (5 if (f.sched or 3) >= 5 else 3)
                fin = cls in ("KO", "SUB")
                ok = (f.winner in ("A", "B") and cls in ("KO", "SUB", "DEC")) or f.winner == "D"
                rr = int(f.rnd or 1)
                reach3 = ok and ((fin and rr >= 3) or (not fin and R >= 3))
                e = {"pid": pid, "day": day, "year": f.date.year, "div": f.division, "age": age, "r5": float(R == 5),
                     "title": float(bool(f.title)), "n_ok": float(ok), "reach3": float(reach3),
                     "w_ko": float(won and cls == "KO"), "w_sub": float(won and cls == "SUB"),
                     "w_dec": float(won and cls == "DEC"), "l_ko": float(lost and cls == "KO"),
                     "l_sub": float(lost and cls == "SUB"), "l_dec": float(lost and cls == "DEC"),
                     "dec_any": float(ok and (cls == "DEC" or f.winner == "D")),
                     "w_r1": float(won and fin and rr == 1), "l_r1": float(lost and fin and rr == 1),
                     "w_late": float(won and fin and rr >= 3), "l_late": float(lost and fin and rr >= 3)}
                # per-round output (cardio): own and opponent landed / minutes in round 1 and in rounds 2+
                c = [0.0] * 8
                if f.stats:
                    m3, l3 = f.stats["r3"][s]
                    om3, ol3 = f.stats["r3"][1 - s]
                    v, ov = f.stats["v"][s], f.stats["v"][1 - s]
                    if R == 3:
                        c = [m3[0], l3[0], m3[1:].sum(), l3[1:].sum(), om3[0], ol3[0], om3[1:].sum(), ol3[1:].sum()]
                    else:
                        mm = [v[B.KI["r5_min_%d" % k]] for k in range(1, 6)]
                        ll = [v[B.KI["r5_lnd_%d" % k]] for k in range(1, 6)]
                        ol = [ov[B.KI["r5_lnd_%d" % k]] for k in range(1, 6)]
                        c = [mm[0], ll[0], sum(mm[1:]), sum(ll[1:]), mm[0], ol[0], sum(mm[1:]), sum(ol[1:])]
                e.update({"c_m1": c[0], "c_l1": c[1], "c_mL": c[2], "c_lL": c[3], "c_om1": c[4], "c_ol1": c[5],
                          "c_omL": c[6], "c_olL": c[7]})
                ev[pid].append(len(ev_person))
                ev_person.append(e)
                ufc_dates[pid].append(f.date)
            bh = {"KO": 1, "SUB": 2, "DEC": 0}.get(cls, -1) if f.winner in ("A", "B") else -1
            seq.append((pid_of[a], pid_of[b], day, f.date.year, f.division, f.winner, bh, f.fid))
    E = pd.DataFrame(ev_person)
    # person-ordered layout for cumulative sums: order[pid] = the global event rows of that person in time order
    order = np.concatenate([np.array(ev[p], int) for p in range(len(pid_of))])
    start = np.zeros(len(pid_of) + 1, int)
    start[1:] = np.cumsum([len(ev[p]) for p in range(len(pid_of))])
    # methodround row sides -> (pid, k)
    PA = np.array([ptr[(f, 0)] for f in T["id"]])
    PB = np.array([ptr[(f, 1)] for f in T["id"]])
    # pre-UFC counts (preufc.json snapshots, dated < 2026), presence by preufc's target rule (one of the first four
    # UFC bouts on/after 2015-01-01, the current bout included), as tools/ml2.py build_preufc applies it
    J = jload("preufc.json")
    cols = J["meta"]["snapshot_columns"]
    ci = {c: k for k, c in enumerate(cols)}
    snaps = {}
    for slug, rec in J["fighters"].items():
        for row in rec.get("snapshots") or []:
            if row[ci["date"]] >= VAULT_S:
                continue
            snaps[(row[ci["fid"]], slug)] = {c: row[ci[c]] for c in ("n", "ko_w", "sub_w", "dec_w", "ko_l", "sub_l",
                                                                         "dec_l", "date")}
    inv = {v: k for k, v in pid_of.items()}
    cut = dt.date(2015, 1, 1)
    pre = np.full((len(T), 2, 7), np.nan)
    for i, (fid, sa, sb) in enumerate(zip(T["id"], T["A_slug"], T["B_slug"])):
        for s, (pid, k), slug in ((0, PA[i], sa), (1, PB[i], sb)):
            kd = sorted(ufc_dates[pid])
            if not any(d >= cut for d in kd[:min(int(k), 3) + 1]):
                continue
            sn = snaps.get((fid, slug)) or snaps.get((fid, people[inv[pid]].get("slug")))
            if sn:
                pre[i, s] = [sn[c] for c in ("n", "ko_w", "sub_w", "dec_w", "ko_l", "sub_l", "dec_l")]
    feats = {"E": E, "order": order, "start": start, "PA": PA, "PB": PB, "seq": seq, "pre": pre,
             "n_persons": len(pid_of)}
    save(feats, "feats.pkl")
    log("feats: %d events, %d persons, %d sequence bouts; pre-UFC counts for %.1f%% of 2016+ row sides (%.0f s)" % (
        len(E), len(pid_of), len(seq), 100 * np.mean(~np.isnan(pre[(T["year"] >= 2016).to_numpy(), :, 0])),
        time.time() - t0))


STAGES["feats"] = stage_feats


# ====================================================================== (a) empirical-Bayes finishing rates
def event_design(E):
    """Baseline design of an event: division one-hot (catch / open weight -> the catch flag), era, age, format."""
    X = np.zeros((len(E), len(DIVS) + 7))
    dv = E["div"].to_numpy()
    for j, d in enumerate(DIVS):
        X[:, j] = dv == d
    k = len(DIVS)
    X[:, k] = np.isin(dv, list(B.NON_DIV))
    X[:, k + 1] = (np.clip(E["year"].to_numpy(float), 2005, 2030) - 2015) / 10.0
    age = E["age"].to_numpy(float)
    miss = np.isnan(age)
    a = np.where(miss, 30.0, age) - 30.0
    X[:, k + 2] = a / 5.0
    X[:, k + 3] = np.maximum(a - 5.0, 0.0) / 5.0
    X[:, k + 4] = miss
    X[:, k + 5] = E["r5"].to_numpy(float)
    X[:, k + 6] = E["title"].to_numpy(float)
    return X


def fit_baselines(feats, v):
    """Per-indicator baseline logit (division x era x age x format) on events dated before Jan 1 of v (2005+), and
    each event's baseline probability. Returns {rate: p (n_events,)}."""
    E = feats["E"]
    X = event_design(E)
    yr = E["year"].to_numpy()
    out = {}
    for rate, (ind, expo) in EB_RATES.items():
        tr = (yr < v) & (yr >= 2005) & (E[expo].to_numpy() > 0)
        lr = MR.LogisticRegression(C=50.0)
        lr.fit(X[tr], E[ind].to_numpy()[tr].astype(int))
        p = lr.predict_proba(X)[:, 1]
        out[rate] = np.where(E[expo].to_numpy() > 0, p, 0.0)
    return out


def person_cumsum(feats, x):
    """Cumulative sum of an event-level array over each person's events in time order; value(pid, k) = sum of his
    first k events (events strictly before the bout day)."""
    xo = np.asarray(x, float)[feats["order"]]
    cs = np.concatenate([[0.0], np.cumsum(xo)])

    def at(pid, k):
        st = feats["start"][pid]
        return cs[st + k] - cs[st]
    return at


def nb_strength(K, Ex):
    """Gamma-Poisson (negative binomial) marginal likelihood of person totals K given expected Ex; returns the
    prior strength m (prior: rate ratio ~ Gamma(m, m), mean 1)."""
    ok = Ex > 0.05
    K, Ex = K[ok], Ex[ok]

    def nll(lm):
        m = math.exp(lm)
        return -np.sum(gammaln(K + m) - gammaln(m) + m * np.log(m / (m + Ex)) + K * np.log(Ex / (m + Ex)))
    r = minimize_scalar(nll, bounds=(math.log(0.05), math.log(500.0)), method="bounded")
    return float(math.exp(r.x))


GH_Z, GH_W = np.polynomial.hermite_e.hermegauss(24)        # nodes / weights for N(0, 1)
GH_W = GH_W / GH_W.sum()
PRE_IDX = {"ko_w": 1, "sub_w": 2, "dec_w": 3, "ko_l": 4, "sub_l": 5, "dec_l": 6}


def pre_shift(feats, base, rate, v, a=4.0):
    """Logit-scale shift of a fighter's pre-UFC rate (shrunk with a pseudo-bouts toward the pre-UFC league mean
    of the training rows) from that mean; 0 where no pre-UFC record. (n, 2)."""
    pre = feats["pre"]
    if rate not in PRE_MAP:
        return np.zeros(pre.shape[:2]), None
    kk, nn = pre[:, :, PRE_IDX[PRE_MAP[rate][0]]], pre[:, :, 0]
    tr = (base["T"]["year"] < v).to_numpy()[:, None] & ~np.isnan(kk)
    mu = float(np.sum(np.where(tr, kk, 0)) / max(1.0, np.sum(np.where(tr, nn, 0))))
    sh = logit((np.nan_to_num(kk) + a * mu) / (np.nan_to_num(nn) + a)) - logit(mu)
    return np.where(np.isnan(kk), 0.0, sh), mu


def eb_block(feats, base, v, use_pre=True, fixed=None):
    """Logit-normal random-effects EB per finishing indicator. For fighter i and indicator q:
    logit P(y_ij = 1) = logit p0_j + u_i, u_i ~ N(lam * pre_shift_i, sigma^2), with p0 the baseline logit
    (division x era x age x format, fit on events before v). sigma and lam are fit by marginal likelihood (24-node
    Gauss-Hermite quadrature) on every person's events dated before v; each row side then gets the posterior mean
    and sd of u_i given his events strictly before the bout. Returns ({rate: (n, 2) post mean}, {rate: (n, 2) post
    sd}, meta)."""
    T = base["T"]
    E = feats["E"]
    pb = fit_baselines(feats, v)
    yr = E["year"].to_numpy()
    PA, PB = feats["PA"], feats["PB"]
    n = len(T)
    order, start = feats["order"], feats["start"]
    npers = len(start) - 1
    pid_ev = np.repeat(np.arange(npers), np.diff(start))            # person of each ordered event
    U, SD, meta = {}, {}, {"sigma": {}, "lam": {}, "mu_pre": {}}
    G = U_GRID
    dates = T["date"].to_numpy()
    for rate, (ind, expo) in EB_RATES.items():
        y = E[ind].to_numpy(float)[order]
        ex = E[expo].to_numpy(float)[order] > 0
        z0 = logit(np.clip(pb[rate][order], 1e-4, 1 - 1e-4))
        trv = (yr[order] < v) & ex
        sh2, mu = pre_shift(feats, base, rate, v) if use_pre else (np.zeros((n, 2)), None)
        meta["mu_pre"][rate] = None if mu is None else round(mu, 4)
        # event log-likelihood on a fixed grid of u (independent of the prior), and its per-person cumsum
        zz = z0[:, None] + G[None, :]
        Lg = np.where(ex[:, None], y[:, None] * zz - np.logaddexp(0, zz), 0.0)
        cs = np.vstack([np.zeros((1, len(G))), np.cumsum(Lg, 0)])
        # hyperparameter fit: every person's events before v; prior mean lam * (pre-UFC shift at his earliest row
        # side dated before v, else 0)
        Sp = np.zeros((npers, len(G)))
        np.add.at(Sp, pid_ev, Lg * trv[:, None])
        ps = np.zeros(npers)
        seen = np.zeros(npers, bool)
        for i in np.argsort(dates, kind="stable"):
            if T["year"].iat[i] >= v:
                break
            for s, P in ((0, PA), (1, PB)):
                pid = P[i][0]
                if not seen[pid] and sh2[i, s] != 0.0:
                    ps[pid], seen[pid] = sh2[i, s], True
        act = np.zeros(npers, bool)
        act[np.unique(pid_ev[trv])] = True
        Sa, psa = Sp[act], ps[act]
        mx = Sa.max(1, keepdims=True)
        ES = np.exp(Sa - mx)

        def nll(th):
            sigma, lam = math.exp(th[0]), th[1]
            pr = np.exp(-0.5 * ((G[None, :] - lam * psa[:, None]) / sigma) ** 2)
            pr /= pr.sum(1, keepdims=True)
            return -float(np.sum(mx[:, 0] + np.log(np.maximum((ES * pr).sum(1), 1e-300))))
        if fixed and rate in fixed:
            sigma, lam = fixed[rate]
        elif use_pre and rate in PRE_MAP:
            r = minimize(nll, [math.log(0.3), 0.3], method="Nelder-Mead",
                         options={"xatol": 1e-3, "fatol": 1e-3, "maxiter": 300})
            sigma, lam = math.exp(r.x[0]), float(r.x[1])
        else:
            r = minimize_scalar(lambda t: nll([t, 0.0]), bounds=(math.log(0.01), math.log(2.0)), method="bounded")
            sigma, lam = math.exp(r.x), 0.0
        meta["sigma"][rate], meta["lam"][rate] = round(sigma, 4), round(lam, 4)
        um = np.zeros((n, 2))
        us = np.zeros((n, 2))
        for s, P in ((0, PA), (1, PB)):
            pid, k = P[:, 0], P[:, 1]
            S = cs[start[pid] + k] - cs[start[pid]]
            lp = S - 0.5 * ((G[None, :] - lam * sh2[:, s][:, None]) / sigma) ** 2      # the row side's own snapshot
            w = np.exp(lp - lp.max(1, keepdims=True))
            w /= w.sum(1, keepdims=True)
            um[:, s] = (w * G[None, :]).sum(1)
            us[:, s] = np.sqrt(np.maximum((w * G[None, :] ** 2).sum(1) - um[:, s] ** 2, 0.0))
        U[rate], SD[rate] = um, us
    return U, SD, meta


U_GRID = np.linspace(-4.0, 4.0, 81)


# ====================================================================== (b) online opponent-adjusted finishing filter
def run_filter(feats, base, sigma0=0.6, tau=0.15):
    """Diagonal-Gaussian online filter over every UFC bout (day order; the whole card is snapshotted before any
    update). Each fighter has KO / submission offence o and vulnerability d (log-odds vs decision, given a win),
    eta_m = b_m(division, era) + o_W,m + d_L,m, softmax over {DEC, KO, SUB}. Prior N(0, sigma0^2); variance grows by
    tau^2 per year of inactivity (capped at sigma0^2). Returns per methodround row (n, 2 sides, 8):
    [o_ko, o_sub, d_ko, d_sub, var o_ko, var o_sub, var d_ko, var d_sub] before the fight, and the filter's own
    pre-fight method-given-winner predictions for its log loss."""
    priors = base["priors"]
    npers = feats["n_persons"]
    mu = np.zeros((npers, 4))
    var = np.full((npers, 4), sigma0 ** 2)
    last = np.full(npers, -1)
    rows = {f: i for i, f in enumerate(base["T"]["id"])}
    out = np.zeros((len(rows), 2, 8))
    s0 = sigma0 ** 2
    t2 = tau ** 2
    seq = feats["seq"]
    pred_ll = []
    bcache = {}

    def bvec(year, div):
        key = (year, div)
        if key not in bcache:
            pr = priors.get(max(min(year, max(k for k in priors if isinstance(k, int))), 2008))
            P = pr.get(div) or pr["ALL"]
            dec = max(P["dec_w"], 1e-9)
            bcache[key] = (math.log(max(P["ko_w"], 1e-9) / dec), math.log(max(P["sub_w"], 1e-9) / dec))
        return bcache[key]

    i = 0
    while i < len(seq):
        day = seq[i][2]
        j = i
        while j < len(seq) and seq[j][2] == day:
            j += 1
        card = seq[i:j]
        for a, b, _, _, _, _, _, fid in card:          # drift then snapshot
            for p in (a, b):
                if last[p] >= 0:
                    var[p] = np.minimum(var[p] + t2 * (day - last[p]) / 365.25, s0)
            r = rows.get(fid)
            if r is not None:
                out[r, 0] = np.concatenate([mu[a], var[a]])
                out[r, 1] = np.concatenate([mu[b], var[b]])
        for a, b, _, year, div, winner, bh, fid in card:
            for p in (a, b):
                last[p] = day
            if bh < 0:
                continue
            W, L = (a, b) if winner == "A" else (b, a)
            bk, bs = bvec(year, div)
            eta = np.array([0.0, bk + mu[W, 0] + mu[L, 2], bs + mu[W, 1] + mu[L, 3]])
            pz = np.exp(eta - eta.max())
            pz /= pz.sum()
            pred_ll.append((year, -math.log(pz[bh])))
            yv = np.zeros(3)
            yv[bh] = 1.0
            for m, (io, idd) in ((1, (0, 2)), (2, (1, 3))):
                g = yv[m] - pz[m]
                h = pz[m] * (1 - pz[m])
                vo, vd = var[W, io], var[L, idd]
                den = 1.0 + (vo + vd) * h
                mu[W, io] += vo * g / den
                mu[L, idd] += vd * g / den
                var[W, io] = vo - vo * vo * h / den
                var[L, idd] = vd - vd * vd * h / den
        i = j
    return out, np.array(pred_ll)


# ====================================================================== cardio (output in rounds 2+ vs round 1)
def cardio_block(feats, base, c_min=15.0):
    """Shrunk log ratio of landed per minute in rounds 2+ to round 1, own and opponent's (a fader lets the opponent
    pick up late), over all prior bouts with round stats; league ratios from events before 2016 (constants)."""
    E = feats["E"]
    pre16 = E["year"].to_numpy() < 2016
    r1 = E.loc[pre16, "c_l1"].sum() / max(1.0, E.loc[pre16, "c_m1"].sum())
    rL = E.loc[pre16, "c_lL"].sum() / max(1.0, E.loc[pre16, "c_mL"].sum())
    out = np.zeros((len(base["T"]), 2, 2))
    cs = {k: person_cumsum(feats, E[k].to_numpy(float)) for k in ("c_m1", "c_l1", "c_mL", "c_lL", "c_om1", "c_ol1",
                                                                  "c_omL", "c_olL")}
    for s, P in ((0, feats["PA"]), (1, feats["PB"])):
        for q, (m1, l1, mL, lL) in enumerate((("c_m1", "c_l1", "c_mL", "c_lL"),
                                              ("c_om1", "c_ol1", "c_omL", "c_olL"))):
            a1 = np.array([cs[l1](p, k) for p, k in P])
            b1 = np.array([cs[m1](p, k) for p, k in P])
            aL = np.array([cs[lL](p, k) for p, k in P])
            bL = np.array([cs[mL](p, k) for p, k in P])
            out[:, s, q] = np.log((aL + c_min * rL) / (bL + c_min)) - np.log((a1 + c_min * r1) / (b1 + c_min))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("stage", choices=list(STAGES) + ["all"])
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    stages = [s for s in STAGES if s not in ("holdout", "swap")] if args.stage == "all" else [args.stage]
    for s in stages:
        log("== stage %s" % s)
        STAGES[s](args)


if __name__ == "__main__":
    main()
