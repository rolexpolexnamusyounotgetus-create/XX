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
if __name__ == "__main__":                 # cached objects (FoldData) pickle under the module name "finishing"
    sys.modules.setdefault("finishing", sys.modules["__main__"])
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
    slugs = [people[inv[p]].get("slug") or inv[p] for p in range(len(pid_of))]
    feats = {"E": E, "order": order, "start": start, "PA": PA, "PB": PB, "seq": seq, "pre": pre,
             "n_persons": len(pid_of), "slugs": slugs, "names": [people[inv[p]]["name"] for p in range(len(pid_of))]}
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


def eb_block(feats, base, v, use_pre=True, fixed=None, roster=False):
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
        if roster:          # every person after all his events (deployment); prior shift from his latest snapshot
            last = np.zeros(npers)
            for i in np.argsort(dates, kind="stable"):
                for s_, P in ((0, PA), (1, PB)):
                    if sh2[i, s_] != 0.0:
                        last[P[i][0]] = sh2[i, s_]
            S = cs[start[1:]] - cs[start[:-1]]
            lp = S - 0.5 * ((G[None, :] - lam * last[:, None]) / sigma) ** 2
            w = np.exp(lp - lp.max(1, keepdims=True))
            w /= w.sum(1, keepdims=True)
            meta.setdefault("roster", {})[rate] = (w * G[None, :]).sum(1)
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


# ====================================================================== designs (winner / finisher oriented)
FIGHT_COLS = ["lbs", "hw", "women", "r5", "title", "catch", "yr", "lg_ko", "lg_sub", "lg_mpf"]
FILTER_DEFAULT = {"sigma0": 0.8, "tau": 0.15}


class FoldData:
    """Everything a fold needs: EB block fit before v, filter state, cardio, S2 designs, ML v2 winner logit."""
    __module__ = "finishing"

    def __init__(self, base, feats, v, filt, card, use_pre=True):
        self.v = v
        self.base = base
        self.U, self.SD, self.meta = eb_block(feats, base, v, use_pre=use_pre)
        self.F = filt
        self.C = card
        T = base["T"]
        self.n = len(T)
        self.z = logit(base["pwin"], 1e-4)
        pr = base["priors"]
        yk = [k for k in pr if isinstance(k, int)]
        bk = np.zeros(self.n)
        bs = np.zeros(self.n)
        for i, (yy, dv) in enumerate(zip(T["year"], T["prior_div"])):
            P = pr[min(max(yy, min(yk)), max(yk))]
            P = P.get(dv) or P["ALL"]
            bk[i] = math.log(max(P["ko_w"], 1e-9) / max(P["dec_w"], 1e-9))
            bs[i] = math.log(max(P["sub_w"], 1e-9) / max(P["dec_w"], 1e-9))
        self.bk, self.bs = bk, bs
        self.nlog = np.log1p(np.stack([T["A_n"].to_numpy(float), T["B_n"].to_numpy(float)], 1))

    def fin(self, o):
        """Finishing block with W = side o (0 = A wins, 1 = B wins), L = the other side."""
        w, l = o, 1 - o
        U, F, C = self.U, self.F, self.C
        X = self.base["FX2"] if o == 0 else self.base["FY2"]
        D = {}
        for r in ("kow", "subw", "r1w", "latew", "dec", "kol", "subl"):
            D["w_" + r] = U[r][:, w]
        for r in ("kol", "subl", "r1l", "latel", "dec", "kow", "subw"):
            D["l_" + r] = U[r][:, l]
        D["w_sd_kow"], D["w_sd_subw"] = self.SD["kow"][:, w], self.SD["subw"][:, w]
        D["l_sd_kol"], D["l_sd_subl"] = self.SD["kol"][:, l], self.SD["subl"][:, l]
        D["f_oko"], D["f_osub"], D["f_dko"], D["f_dsub"] = F[:, w, 0], F[:, w, 1], F[:, l, 2], F[:, l, 3]
        D["f_eta_ko"] = self.bk + F[:, w, 0] + F[:, l, 2]
        D["f_eta_sub"] = self.bs + F[:, w, 1] + F[:, l, 3]
        D["w_card"], D["l_card"], D["l_card_opp"] = C[:, w, 0], C[:, l, 0], C[:, l, 1]
        z = self.z if o == 0 else -self.z
        D["zW"], D["azW"] = z, np.abs(z)
        D["w_nlog"], D["l_nlog"] = self.nlog[:, w], self.nlog[:, l]
        for c in FIGHT_COLS:
            D[c] = X[c].to_numpy(float)
        r5, ti = D["r5"], D["title"]
        D["r5_l_latel"], D["r5_w_latew"], D["r5_dec"] = r5 * D["l_latel"], r5 * D["w_latew"], r5 * (D["w_dec"] + D["l_dec"])
        D["ti_zW"] = ti * z
        D["r5_zW"] = r5 * z
        return pd.DataFrame(D)

    def s2(self, o):
        X = self.base["FX2"] if o == 0 else self.base["FY2"]
        return X[self.base["cols_s2"]].reset_index(drop=True)

    def eb6(self, o, blocks=("eb",)):
        """Directional EB columns for the six-class model with X = side o (attacker) and Y = the other side."""
        x, yv = o, 1 - o
        U, F = self.U, self.F
        D = {}
        if "eb" in blocks:
            for r in ("kow", "subw", "dec", "kol", "subl", "r1w", "r1l", "latew", "latel"):
                D["e_x_" + r] = U[r][:, x]
                D["e_y_" + r] = U[r][:, yv]
        if "filter" in blocks:
            for j, nm in enumerate(("oko", "osub", "dko", "dsub")):
                D["e_x_f" + nm] = F[:, x, j]
                D["e_y_f" + nm] = F[:, yv, j]
        return pd.DataFrame(D)


FIN_SETS = {
    "eb": ["w_kow", "w_subw", "w_dec", "l_kol", "l_subl", "l_dec", "w_kol", "w_subl", "l_kow", "l_subw"],
    "round": ["w_r1w", "w_latew", "l_r1l", "l_latel"],
    "sd": ["w_sd_kow", "w_sd_subw", "l_sd_kol", "l_sd_subl"],
    "filter": ["f_oko", "f_osub", "f_dko", "f_dsub", "f_eta_ko", "f_eta_sub"],
    "cardio": ["w_card", "l_card", "l_card_opp"],
    "win": ["zW", "azW"],
    "exp": ["w_nlog", "l_nlog"],
    "fight": FIGHT_COLS,
    "inter": ["r5_l_latel", "r5_w_latew", "r5_dec", "ti_zW", "r5_zW"],
}


def method_labels(base):
    """Winner side (0 = A, 1 = B, -1 = not decisive) and method class (0 KO, 1 SUB, 2 DEC, -1)."""
    T = base["T"]
    ws = np.where(T["winner"].to_numpy() == "A", 0, np.where(T["winner"].to_numpy() == "B", 1, -1))
    mc = T["cls"].map({"KO": 0, "SUB": 1, "DEC": 2}).fillna(-1).astype(int).to_numpy()
    ok = (ws >= 0) & (mc >= 0)
    return np.where(ok, ws, -1), np.where(ok, mc, -1)


class CondMethod:
    """P(method | W wins, x): multinomial logit over {KO, SUB, DEC} on winner-oriented features with class
    intercepts (method base rates given a win; no corner term). Recency weights as methodround (half-life 8 y)."""

    def __init__(self, C=0.01, hl=8.0):
        self.C, self.hl = C, hl

    def fit(self, X, y, years, ref_year):
        w = MR.recency_weights(years, ref_year, self.hl)
        self.sc = MR.StandardScaler().fit(X)
        self.lr = MR.LogisticRegression(C=self.C).fit(self.sc.transform(X), y, sample_weight=w)
        return self

    def predict(self, X):
        return self.lr.predict_proba(self.sc.transform(X))


class CondMethodGBM:
    """LightGBM version of CondMethod (multiclass, both orientations are separate rows by construction)."""

    def __init__(self, params=None, rounds=400, hl=8.0):
        self.hl, self.rounds = hl, rounds
        self.params = dict(objective="multiclass", num_class=3, learning_rate=0.02, num_leaves=7, min_data_in_leaf=80,
                           feature_fraction=0.6, bagging_fraction=0.8, bagging_freq=1, lambda_l2=10.0, verbose=-1,
                           num_threads=2, seed=7)
        if params:
            self.params.update(params)

    def fit(self, X, y, years, ref_year):
        import lightgbm as lgb
        w = MR.recency_weights(years, ref_year, self.hl)
        self.m = lgb.train(self.params, lgb.Dataset(np.asarray(X, float), y, weight=w), num_boost_round=self.rounds)
        return self

    def predict(self, X):
        return self.m.predict(np.asarray(X, float))


def p6_from_cond(qA, qB, pa):
    """Six-class who-and-how (XKO, XSUB, XDEC, YDEC, YSUB, YKO) from the winner probability and the conditional
    method shares of each potential winner."""
    pb = 1 - pa
    return np.stack([pa * qA[:, 0], pa * qA[:, 1], pa * qA[:, 2], pb * qB[:, 2], pb * qB[:, 1], pb * qB[:, 0]], 1)


def design(fd, o, spec):
    """spec: {'fin': [set names], 's2': bool}."""
    parts = []
    cols = [c for s in spec.get("fin", []) for c in FIN_SETS[s]]
    if cols:
        parts.append(fd.fin(o)[cols])
    if spec.get("s2"):
        parts.append(fd.s2(o))
    return pd.concat(parts, axis=1).to_numpy(float)


def cm_fold(fd, base, spec, C=0.01, start=2012, gbm=None, hl=8.0):
    """Fit the conditional method model on decisive rows dated [start, v) and predict qA, qB for every row."""
    T = base["T"]
    ws, mc = method_labels(base)
    yr = T["year"].to_numpy()
    XA, XB = design(fd, 0, spec), design(fd, 1, spec)
    tr = (yr < fd.v) & (yr >= start) & (ws >= 0)
    Xtr = np.where((ws[tr] == 0)[:, None], XA[tr], XB[tr])
    m = (CondMethodGBM(gbm, hl=hl) if gbm is not None else CondMethod(C, hl=hl)).fit(Xtr, mc[tr], yr[tr], fd.v)
    return m.predict(XA), m.predict(XB), m


# ---------------------------------------------------------------------- round given a finish
class CondRound:
    """P(finishing round | W finishes L by method m, scheduled R): continuation-ratio logit. Rows (fight, j) for
    j = 1..min(r, R-1) with y = 1 if the finish came in round j; free dummies for (R, j, m) and penalized covariates
    (finisher-oriented) plus covariate x (j-1) slopes. P(round R) is the remainder."""

    def __init__(self, C=0.01, hl=8.0, slope=True):
        self.C, self.hl, self.slope = C, hl, slope

    @staticmethod
    def dummies(R, j, m):
        d = np.zeros((len(R), 12))
        idx = np.where(R == 3, (j - 1) * 2 + m, 4 + (j - 1) * 2 + m)
        d[np.arange(len(R)), idx] = 1.0
        return d

    def _rows(self, X, R, j, m):
        Xs = self.sc.transform(X)
        parts = [Xs]
        if self.slope:
            parts.append(Xs * ((j - 1) / 2.0)[:, None])
        parts.append(self.dummies(R, j, m))
        return np.hstack(parts)

    def fit(self, X, R, m, r, years, ref_year):
        w0 = MR.recency_weights(years, ref_year, self.hl)
        self.sc = MR.StandardScaler().fit(X)
        ii, jj = [], []
        for i in range(len(R)):
            for j in range(1, min(r[i], R[i] - 1) + 1):
                ii.append(i)
                jj.append(j)
        ii, jj = np.array(ii), np.array(jj)
        y = (r[ii] == jj).astype(int)
        Z = self._rows(X[ii], R[ii], jj, m[ii])
        nfree = 12
        self.lr = MR.LogisticRegression(C=self.C, fit_intercept=False,
                                        free=list(range(Z.shape[1] - nfree, Z.shape[1]))).fit(Z, y, sample_weight=w0[ii])
        return self

    def shape(self, X, R, m):
        """(n, 5) P(round | finish by m) for scheduled R (zeros past R)."""
        n = len(R)
        out = np.zeros((n, 5))
        surv = np.ones(n)
        for j in range(1, 5):
            act = R > j
            h = np.zeros(n)
            if act.any():
                h[act] = self.lr.predict_proba(self._rows(X[act], R[act], np.full(act.sum(), j), m[act]))[:, 1]
            out[:, j - 1] = np.where(act, surv * h, 0.0)
            surv = np.where(act, surv * (1 - h), surv)
        last = np.where(R == 3, 2, 4)
        out[np.arange(n), last] = surv
        return out


ROUND_SETS = {
    "eb": ["w_r1w", "w_latew", "l_r1l", "l_latel", "w_kow", "w_subw", "l_kol", "l_subl", "w_dec", "l_dec"],
    "filter": ["f_eta_ko", "f_eta_sub"],
    "cardio": ["w_card", "l_card", "l_card_opp"],
    "win": ["zW", "azW"],
    "fight": ["lbs", "hw", "women", "title", "yr", "lg_mpf"],
}


def round_design(fd, o, spec):
    cols = [c for s in spec.get("fin", []) for c in ROUND_SETS[s]]
    parts = [fd.fin(o)[cols]] if cols else []
    if spec.get("haz"):
        X = fd.base["FX2"] if o == 0 else fd.base["FY2"]
        hz = [c for c in MR.HAZ_COLS if c not in FIGHT_COLS]
        parts.append(X[hz].reset_index(drop=True))
    return pd.concat(parts, axis=1).to_numpy(float)


def cr_fold(fd, base, spec, C=0.01, start=2008, slope=True):
    """Fit the round model on finished rows dated [start, v); return an H-like (n, NC_) array of round shapes for
    A KO, A SUB, B KO, B SUB (the layout joint_from_c6 reads)."""
    T = base["T"]
    ws, mc = method_labels(base)
    yr = T["year"].to_numpy()
    R = np.where(T["rounds"].to_numpy() == 5, 5, 3)
    rr = np.clip(T["rnd"].to_numpy().astype(int), 1, 5)
    XA, XB = round_design(fd, 0, spec), round_design(fd, 1, spec)
    tr = (yr < fd.v) & (yr >= start) & (ws >= 0) & (mc <= 1) & (rr <= R)
    Xtr = np.where((ws[tr] == 0)[:, None], XA[tr], XB[tr])
    m = CondRound(C, slope=slope).fit(Xtr, R[tr], mc[tr], rr[tr], yr[tr], fd.v)
    H = np.zeros((len(T), NC_))
    for base_i, X, meth in ((I_XKO, XA, 0), (I_XSUB, XA, 1), (I_YKO, XB, 0), (I_YSUB, XB, 1)):
        H[:, base_i:base_i + R5] = m.shape(X, R, np.full(len(T), meth))
    return H, m


def joint(base, P6, H, rows):
    return MR.joint_from_c6(P6[rows], H[rows], base["draw_c"])


def losses(base, J, rows):
    return MR.per_fight_losses(J, base["y"][rows], base["T"][rows])


def summ(base, P6, H, rows):
    return {k: round(v, 5) for k, v in MR.summarize_losses(losses(base, joint(base, P6, H, rows), rows)).items()}


def get_folds(base, feats, fcfg, use_pre=True, years=FOLDS):
    """FoldData for each fold (cached by filter settings and the pre-UFC switch)."""
    key = "fd_s%g_t%g_p%d.pkl" % (fcfg["sigma0"], fcfg["tau"], int(use_pre))
    if os.path.exists(cpath(key)):
        FD = load(key)
        if all(v in FD for v in years):
            return FD
    filt, _ = run_filter(feats, base, fcfg["sigma0"], fcfg["tau"])
    card = cardio_block(feats, base)
    FD = {v: FoldData(base, feats, v, filt, card, use_pre=use_pre) for v in years}
    save(FD, key)
    return FD


def oof_method(base, FD, years, cfg):
    """Out-of-fold P6 for the given folds under a method config {spec, C, start, hl, gbm, pool}."""
    T = base["T"]
    yr = T["year"].to_numpy()
    P6 = np.full((len(T), 6), np.nan)
    for v in years:
        va = (yr == v) if v < 2024 else (yr >= 2024)
        if cfg.get("six"):
            P6[va] = six_fold(FD[v], base, cfg)[va]
            continue
        qA, qB, _ = cm_fold(FD[v], base, cfg["spec"], cfg.get("C"), cfg.get("start", 2008), cfg.get("gbm"),
                            cfg.get("hl", 8.0))
        if cfg.get("gbm_mix"):
            gA, gB, _ = cm_fold(FD[v], base, cfg["spec"], None, cfg.get("start", 2008), cfg["gbm_mix"],
                                cfg.get("hl", 8.0))
            qA, qB = 0.5 * (qA + gA), 0.5 * (qB + gB)
        if cfg.get("pool"):
            qA, qB = pool_s2(base, qA, qB, cfg["pool"])
        P6[va] = p6_from_cond(qA[va], qB[va], base["pwin"][va])
    return P6


def six_fold(fd, base, cfg, return_model=False):
    """S2's six-class who-and-how logit (both orientations, averaged) with the directional EB block appended, fit on
    rows dated [start, v); the winner share is then replaced by ML v2's (S2+ml2win's reweighting)."""
    T = base["T"]
    y = base["y"]
    tr, _ = fold_masks(T, fd.v, cfg.get("start", 2012))
    XA = pd.concat([fd.s2(0), fd.eb6(0, cfg["six"])], axis=1)
    XB = pd.concat([fd.s2(1), fd.eb6(1, cfg["six"])], axis=1)
    cols = list(XA.columns)
    m = MR.C6Logit(cols, C=cfg["C"], hl_years=cfg.get("hl", MR.HL_YEARS)).fit(T[tr], XA[tr], XB[tr], y[tr])
    P6 = m.predict6(T, XA, XB)
    P6w = MR.reweight_winner(P6, base["pwin"])
    return (P6w, m, cols) if return_model else P6w


def s2_cond(base):
    """S2's own method-given-winner shares per side (from its six-class output)."""
    P = np.nan_to_num(base["P6_S2"], nan=1.0 / 6)
    qA = P[:, :3] / P[:, :3].sum(1, keepdims=True)
    qB = P[:, [5, 4, 3]] / P[:, 3:].sum(1, keepdims=True)
    return qA, qB


def pool_s2(base, qA, qB, a):
    """Log-linear pool of the conditional shares with S2's: q ~ q_fin^(1 - a) q_S2^a."""
    sA, sB = s2_cond(base)
    out = []
    for q, s in ((qA, sA), (qB, sB)):
        z = (1 - a) * np.log(np.clip(q, 1e-9, 1)) + a * np.log(np.clip(s, 1e-9, 1))
        z = np.exp(z - z.max(1, keepdims=True))
        out.append(z / z.sum(1, keepdims=True))
    return out


def oof_round(base, FD, years, rcfg):
    T = base["T"]
    yr = T["year"].to_numpy()
    H = np.array(base["H"], copy=True)
    if rcfg is None:
        return H
    for v in years:
        va = (yr == v) if v < 2024 else (yr >= 2024)
        Hv, _ = cr_fold(FD[v], base, rcfg["spec"], rcfg["C"], rcfg.get("start", 2008), rcfg.get("slope", True))
        H[va] = Hv[va]
    return H


def rows_of(base, years):
    yr = base["T"]["year"].to_numpy()
    m = np.zeros(len(yr), bool)
    for v in years:
        m |= (yr == v) if v < 2024 else (yr >= 2024)
    return m & (base["y"] >= 0)


# ====================================================================== stage: tune (folds 2016-2019)
METHOD_BLOCKS = ["filter", "round", "sd", "cardio", "exp", "inter"]
ROUND_SPECS = {"haz": {"haz": True}, "haz+eb": {"haz": True, "fin": ["eb"]},
               "eb+fight+win": {"fin": ["eb", "fight", "win"]},
               "eb+fight+win+filter+cardio": {"fin": ["eb", "fight", "win", "filter", "cardio"]},
               "haz+eb+fight+win+filter+cardio": {"haz": True, "fin": ["eb", "fight", "win", "filter", "cardio"]}}


def stage_tune(args):
    """Every hyperparameter by forward-chained CV on the 2016-2019 folds (each fit on everything before the fold
    year). Decision rule for adding anything: the 7-bin log loss improves by more than 0.0005 (the ml2 rule)."""
    t0 = time.time()
    base, feats = load("base.pkl"), load("feats.pkl")
    yrs = TUNE_YEARS
    rows = rows_of(base, yrs)
    rec = {"years": list(yrs), "n": int(rows.sum()), "S2+ml2win": summ(base, base["P6_S2w"], base["H"], rows)}
    ref = rec["S2+ml2win"]["bin7"]
    log("tune: S2+ml2win on %d tune-fold fights: bin7 %.5f joint %.5f mgw %.5f rgf %.5f" % (
        rows.sum(), ref, rec["S2+ml2win"]["joint"], rec["S2+ml2win"]["method_given_winner"],
        rec["S2+ml2win"]["round_given_fin"]))
    # 1) filter settings by the filter's own pre-fight method-given-winner log loss, 2012-2019 bouts
    rec["filter_grid"] = []
    best = None
    for s0 in (0.6, 0.8, 1.0):
        for tau in (0.1, 0.3):
            _, pl = run_filter(feats, base, s0, tau)
            m = (pl[:, 0] >= 2012) & (pl[:, 0] < 2020)
            v = float(pl[m, 1].mean())
            rec["filter_grid"].append({"sigma0": s0, "tau": tau, "mgw_ll": round(v, 5), "n": int(m.sum())})
            if best is None or v < best[0]:
                best = (v, {"sigma0": s0, "tau": tau})
    fcfg = best[1]
    _, pl0 = run_filter(feats, base, 1e-4, 0.0)
    m = (pl0[:, 0] >= 2012) & (pl0[:, 0] < 2020)
    rec["filter_base_only_mgw_ll"] = round(float(pl0[m, 1].mean()), 5)
    rec["filter"] = fcfg
    log("tune: filter %s (own mgw %.5f vs division base rates %.5f)" % (fcfg, best[0], rec["filter_base_only_mgw_ll"]))
    FD = get_folds(base, feats, fcfg, True)
    FDn = get_folds(base, feats, fcfg, False)
    rec["eb_meta"] = {str(v): FD[v].meta for v in FOLDS}

    def ev(cfg, H=None, fd=None):
        P6 = oof_method(base, fd or FD, yrs, cfg)
        return summ(base, P6, base["H"] if H is None else H, rows), P6
    # 2) training start, recency, penalty on the core spec (S2 design + winner logit + EB rates)
    rec["core_grid"] = []
    core = {"s2": True, "fin": ["win", "eb"]}
    best = None
    for start in (2008, 2012):
        for hl in (8.0, None):
            for C in (0.001, 0.0015, 0.002, 0.003):
                s, _ = ev({"spec": core, "C": C, "start": start, "hl": hl})
                rec["core_grid"].append({"start": start, "hl": hl, "C": C, **s})
                if best is None or s["bin7"] < best[0]:
                    best = (s["bin7"], start, hl, C)
    _, start, hl, C = best
    log("tune: core grid best start %d hl %s C %g bin7 %.5f (%+.5f vs S2+ml2win)" % (start, hl, C, best[0], best[0] - ref))
    # the conditional structure alone (S2 design + winner logit, no EB) and the EB block's own contribution
    s_noeb, _ = ev({"spec": {"s2": True, "fin": ["win"]}, "C": C, "start": start, "hl": hl})
    s_nopre, _ = ev({"spec": core, "C": C, "start": start, "hl": hl}, fd=FDn)
    s_eb_only, _ = ev({"spec": {"fin": ["win", "eb", "fight"]}, "C": 0.01, "start": start, "hl": hl})
    rec["ablation"] = {"conditional_S2_design_only": s_noeb, "core_without_preufc_prior": s_nopre,
                       "finishing_only_no_S2_design": s_eb_only}
    use_pre = not (best[0] >= s_nopre["bin7"] - SEL_MIN)       # the pre-UFC prior must earn its place
    if not use_pre:
        FD = FDn
    eb_in = best[0] < s_noeb["bin7"] - SEL_MIN
    log("tune: no-EB %.5f, no pre-UFC prior %.5f, finishing-only %.5f -> EB %s, pre-UFC prior %s" % (
        s_noeb["bin7"], s_nopre["bin7"], s_eb_only["bin7"], eb_in, use_pre))
    spec = {"s2": True, "fin": ["win"] + (["eb"] if eb_in else [])}
    cur = best[0] if eb_in else s_noeb["bin7"]
    # 3) forward block selection with the 0.0005 rule
    rec["forward"] = []
    pool = list(METHOD_BLOCKS)
    while pool:
        trial = []
        for b in pool:
            s, _ = ev({"spec": {"s2": True, "fin": spec["fin"] + [b]}, "C": C, "start": start, "hl": hl})
            trial.append((s["bin7"], b, s))
            rec["forward"].append({"base": list(spec["fin"]), "add": b, **s})
        bv, bb, _ = min(trial)
        if bv < cur - SEL_MIN:
            spec["fin"].append(bb)
            pool.remove(bb)
            cur = bv
            log("tune: + %s -> bin7 %.5f" % (bb, bv))
        else:
            break
    # 4) penalty re-check on the final spec
    rec["final_C_grid"] = []
    for Cc in (0.001, 0.0015, 0.002, 0.003):
        s, _ = ev({"spec": spec, "C": Cc, "start": start, "hl": hl})
        rec["final_C_grid"].append({"C": Cc, **s})
        if s["bin7"] < cur - 1e-9:
            cur, C = s["bin7"], Cc
    mcfg = {"spec": spec, "C": C, "start": start, "hl": hl}
    sM, P6M = ev(mcfg)
    # 5) GBM family and the MNL + GBM average (recorded; the family choice is made on the 2020-2023 folds)
    rec["gbm_grid"] = []
    bestg = None
    for nl, mdl, ff in ((4, 80, 0.6), (7, 80, 0.6), (7, 150, 0.4)):
        g = {"num_leaves": nl, "min_data_in_leaf": mdl, "feature_fraction": ff}
        s, _ = ev({"spec": spec, "start": start, "hl": hl, "gbm": g})
        rec["gbm_grid"].append({**g, **s})
        if bestg is None or s["bin7"] < bestg[0]:
            bestg = (s["bin7"], g)
    gcfg = {"spec": spec, "start": start, "hl": hl, "gbm": bestg[1]}
    # 6) log-linear pool with S2's own method-given-winner shares
    rec["pool_grid"] = []
    for a in (0.0, 0.25, 0.5, 0.75):
        s, _ = ev(dict(mcfg, pool=a))
        rec["pool_grid"].append({"a": a, **s})
    a_best = min(rec["pool_grid"], key=lambda r: r["bin7"])
    mcfg["pool"] = a_best["a"] if a_best["bin7"] < sM["bin7"] - SEL_MIN else 0.0
    sM, P6M = ev(mcfg)
    log("tune: method model %s -> bin7 %.5f (%+.5f vs S2+ml2win); GBM best %.5f" % (
        mcfg, sM["bin7"], sM["bin7"] - ref, bestg[0]))
    # 7) round model on the chosen method model's P6: selected on the joint (who x how x when) loss; it replaces
    # S2's competing-risk round shapes only if the joint improves by > 0.0005
    rec["round_grid"] = []
    bestr = None
    for name, rs in ROUND_SPECS.items():
        for Cr in (0.003, 0.01, 0.03):
            for slope in (True, False):
                rc = {"spec": rs, "C": Cr, "slope": slope, "name": name}
                H = oof_round(base, FD, yrs, rc)
                s = summ(base, P6M, H, rows)
                rec["round_grid"].append({"name": name, "C": Cr, "slope": slope, **s})
                if bestr is None or s["joint"] < bestr[0]:
                    bestr = (s["joint"], rc)
    rcfg = bestr[1] if bestr[0] < sM["joint"] - SEL_MIN else None
    log("tune: round model %s (best joint %.5f vs S2 shapes %.5f)" % (rcfg, bestr[0], sM["joint"]))
    rec["chosen"] = {"filter": fcfg, "use_pre": use_pre, "method": mcfg, "gbm": gcfg, "round": rcfg}
    rec["seconds"] = round(time.time() - t0)
    json.dump(rec, open(cpath("tune.json"), "w"), indent=1, default=float)
    log("tune: done in %.0f s" % (time.time() - t0))


STAGES["tune"] = stage_tune


# ====================================================================== stage: cv (folds 2020-2023)
def paired(base, rows, P, ref, B_=2000, seed=11):
    """Means with event-cluster CIs and paired differences vs ref for {name: (P6, H)} on rows."""
    T = base["T"]
    L = {k: losses(base, joint(base, p6, h, rows), rows) for k, (p6, h) in P.items()}
    bt, st = MR.cluster_bootstrap(L, T["event"].to_numpy()[rows], B=B_, seed=seed)
    pdif = {k + " - " + ref: MR.paired_diff(L[k], L[ref], st, METRICS) for k in P if k != ref}
    return bt, pdif, L, st


def stage_cv(args):
    """The pre-specified route (kept for the record): the 2016-2019 tune choices frozen and scored on the 2020-2023
    folds against S2+ml2win, with the model family (MNL / GBM / average) compared there. Its result (no gain: the
    optimal penalty drifts across eras) is why the decision procedure is the nested selection in `nested`."""
    t0 = time.time()
    base, feats = load("base.pkl"), load("feats.pkl")
    tn = json.load(open(cpath("tune.json")))
    ch = tn["chosen"]
    FD = get_folds(base, feats, ch["filter"], ch["use_pre"])
    years = TUNE_YEARS + CV_YEARS
    mcfg, gcfg, rcfg = ch["method"], ch["gbm"], ch["round"]
    P6 = {"MNL": oof_method(base, FD, years, mcfg), "GBM": oof_method(base, FD, years, gcfg),
          "MNL+GBM": oof_method(base, FD, years, dict(mcfg, gbm_mix=gcfg["gbm"]))}
    H = oof_round(base, FD, years, rcfg)
    rows = rows_of(base, CV_YEARS)
    fam = {k: summ(base, p, base["H"], rows) for k, p in P6.items()}
    fam_pick = min(fam, key=lambda k: fam[k]["bin7"])
    log("cv: family on 2020-2023 (S2 shapes): %s -> %s" % ({k: v["bin7"] for k, v in fam.items()}, fam_pick))
    # ablations on the CV folds (reported; nothing is re-chosen from them)
    abl = {"conditional_S2_design_only": dict(mcfg, spec={"s2": True, "fin": ["win"]}),
           "finishing_only_no_S2_design": {"spec": {"fin": ["win", "eb", "fight"]}, "C": 0.01,
                                           "start": mcfg["start"], "hl": mcfg["hl"]}}
    P6a = {k: oof_method(base, FD, CV_YEARS, c) for k, c in abl.items()}
    FDn = get_folds(base, feats, ch["filter"], not ch["use_pre"])
    P6a["core_without_preufc_prior" if ch["use_pre"] else "core_with_preufc_prior"] = oof_method(base, FDn, CV_YEARS, mcfg)
    best = P6[fam_pick]
    comp = {"S2+ml2win": (base["P6_S2w"], base["H"]), "S2": (np.nan_to_num(base["P6_S2"], nan=1 / 6), base["H"]),
            "finishing (method only, S2 round shapes)": (best, base["H"]),
            "finishing": (best, H)}
    for k, p in P6a.items():
        comp["ablation: " + k] = (p, base["H"])
    bt, pdif, L, st = paired(base, rows, comp, "S2+ml2win")
    out = {"years": list(CV_YEARS), "n": int(rows.sum()), "family": fam, "family_pick": fam_pick,
           "means": bt, "paired_vs_S2+ml2win": pdif, "choices": ch}
    # by year and by format (descriptive)
    yr = base["T"]["year"].to_numpy()
    out["by_year"] = {}
    for v in CV_YEARS:
        m = rows & (yr == v)
        out["by_year"][str(v)] = {k: summ(base, comp[k][0], comp[k][1], m)["bin7"] for k in ("S2+ml2win", "finishing")}
        out["by_year"][str(v)]["n"] = int(m.sum())
    r5 = (base["T"]["rounds"].to_numpy() == 5)
    out["by_format"] = {}
    for nm, m in (("3 rounds", rows & ~r5), ("5 rounds", rows & r5)):
        out["by_format"][nm] = {"n": int(m.sum()), **{k: {mm: summ(base, comp[k][0], comp[k][1], m)[mm]
                                                          for mm in ("bin7", "joint", "round_given_fin")}
                                                      for k in ("S2+ml2win", "finishing")}}
    for k, v in pdif.items():
        log("cv: %s: %s" % (k, {m: (v[m]["diff"], v[m]["ci95"]) for m in ("bin7", "joint", "method_given_winner",
                                                                            "round_given_fin") if m in v}))
    save({"P6": P6, "H": H, "P6_best": best, "fam_pick": fam_pick, "years": years}, "cv_oof.pkl")
    json.dump(out, open(cpath("cvfixed.json"), "w"), indent=1, default=float)
    log("cv: done in %.0f s" % (time.time() - t0))


STAGES["cvfixed"] = stage_cv


# ====================================================================== stage: grid (OOF for every candidate, 2016-2023)
GRID_SPECS = {"s2cond": ({"s2": True, "fin": ["win"]}, True),             # conditional structure, S2 design only
              "core": ({"s2": True, "fin": ["win", "eb"]}, True),         # + EB finishing rates (pre-UFC prior on)
              "core_nopre": ({"s2": True, "fin": ["win", "eb"]}, False),  # + EB rates without the pre-UFC prior
              "core_filter": ({"s2": True, "fin": ["win", "eb", "filter"]}, True)}   # + opponent-adjusted filter
GRID_START = (2008, 2012)
GRID_HL = (8.0, None)
GRID_C = (0.0005, 0.0007, 0.001, 0.0015, 0.002)
GRID_YEARS = TUNE_YEARS + CV_YEARS
INCUMBENT = "incumbent|S2+ml2win"


SIX_SPECS = {"six_eb": (("eb",), True), "six_eb_nopre": (("eb",), False), "six_eb_filter": (("eb", "filter"), True)}
SIX_C = (0.001, 0.0015, 0.002, 0.003)


def method_grid():
    out = {}
    for sn, (blocks, pre) in SIX_SPECS.items():
        for C in SIX_C:
            out["%s|st2012|hl8|C%g" % (sn, C)] = ({"six": blocks, "C": C, "start": 2012, "hl": 8.0}, pre)
    for sn, (spec, pre) in GRID_SPECS.items():
        for st in GRID_START:
            for hl in GRID_HL:
                for C in GRID_C:
                    out["%s|st%d|hl%s|C%g" % (sn, st, "none" if hl is None else "%g" % hl, C)] = (
                        {"spec": spec, "C": C, "start": st, "hl": hl}, pre)
    return out


def round_grid():
    out = {"S2 shapes": None}
    for name, rs in ROUND_SPECS.items():
        for Cr in (0.003, 0.01, 0.03):
            for slope in (True, False):
                out["%s|C%g|slope%d" % (name, Cr, slope)] = {"spec": rs, "C": Cr, "slope": slope, "name": name}
    return out


def stage_grid(args):
    """Out-of-fold predictions on every fold 2016-2023 (each fold year fit on everything before it) for every method
    and round candidate; per-fight losses are stored so the nested selection never refits. 2024-2025 is not touched."""
    t0 = time.time()
    base, feats = load("base.pkl"), load("feats.pkl")
    tn = json.load(open(cpath("tune.json")))
    fcfg = tn["chosen"]["filter"]
    FDs = {True: get_folds(base, feats, fcfg, True, GRID_YEARS), False: get_folds(base, feats, fcfg, False, GRID_YEARS)}
    rows = rows_of(base, GRID_YEARS)
    MG, RG = method_grid(), round_grid()
    res = {"rows": rows, "method": {}, "round": {}, "P6": {}, "H": {}}
    L = losses(base, joint(base, base["P6_S2w"], base["H"], rows), rows)     # the incumbent is a candidate too
    res["method"][INCUMBENT] = {m: L[m] for m in ("bin7", "method_given_winner", "method3", "joint")}
    res["P6"][INCUMBENT] = base["P6_S2w"].astype(np.float32)
    for i, (k, (cfg, pre)) in enumerate(MG.items()):
        P6 = oof_method(base, FDs[pre], GRID_YEARS, cfg)
        L = losses(base, joint(base, P6, base["H"], rows), rows)
        res["method"][k] = {m: L[m] for m in ("bin7", "method_given_winner", "method3", "joint")}
        res["P6"][k] = P6.astype(np.float32)
        if (i + 1) % 10 == 0:
            log("grid: method %d/%d (%.0f s)" % (i + 1, len(MG), time.time() - t0))
    for k, rc in RG.items():
        H = oof_round(base, FDs[True], GRID_YEARS, rc)
        L = losses(base, joint(base, base["P6_S2w"], H, rows), rows)
        res["round"][k] = {"sided": L["joint"] - L["bin7"], "round_given_fin": L["round_given_fin"]}
        res["H"][k] = H.astype(np.float32)
    log("grid: %d round candidates (%.0f s)" % (len(RG), time.time() - t0))
    save(res, "grid.pkl")


STAGES["grid"] = stage_grid


# ====================================================================== stage: nested (the decision procedure)
def nested_pick(scores, years_of, before, metric_rows):
    """Candidate with the lowest mean loss over rows dated in [2016, before)."""
    m = metric_rows & (years_of < before)
    best = None
    for k, v in scores.items():
        s = float(np.nanmean(np.where(m, v, np.nan)))
        if best is None or s < best[0]:
            best = (s, k)
    return best[1], best[0]


def nested_predictions(base, G, years):
    """For each year Y: the method candidate with the lowest 7-bin loss and the round candidate with the lowest sided
    round loss over the folds before Y, and that candidate's out-of-fold prediction for Y."""
    yr = base["T"]["year"].to_numpy()
    rows = G["rows"]
    n = len(yr)
    P6 = np.full((n, 6), np.nan)
    H = np.array(base["H"], copy=True)
    picks = {}
    mscore = {}
    for k, L in G["method"].items():
        v = np.full(n, np.nan)
        v[rows] = L["bin7"]
        mscore[k] = v
    rscore = {}
    for k, L in G["round"].items():
        v = np.full(n, np.nan)
        v[rows] = L["sided"]
        rscore[k] = v
    fin = rows & np.isin(base["y"], [i for i in range(NC_) if i < I_XDEC])
    for Y in years:
        mk, ms = nested_pick(mscore, yr, Y, rows)
        rk, rs = nested_pick(rscore, yr, Y, fin)
        va = yr == Y
        P6[va] = G["P6"][mk][va]
        H[va] = G["H"][rk][va]
        picks[str(Y)] = {"method": mk, "method_bin7_before": round(ms, 5), "round": rk, "round_sided_before": round(rs, 5)}
    return P6, H, picks


def stage_nested(args):
    """Nested forward-chained selection: year Y (2017-2023) is predicted by the candidates that did best on the folds
    2016..Y-1, so the 2020-2023 numbers measure the whole procedure (choice included) out of sample. The production
    choice for the 2024-2025 look is the best candidate over all folds 2016-2023."""
    t0 = time.time()
    base = load("base.pkl")
    G = load("grid.pkl")
    yr = base["T"]["year"].to_numpy()
    years = tuple(range(2017, 2024))
    P6n, Hn, picks = nested_predictions(base, G, years)
    rows = rows_of(base, CV_YEARS)
    fin_rows = rows_of(base, GRID_YEARS) & np.isin(base["y"], list(range(I_XDEC)))
    prod_m = nested_pick({k: _full(base, G, L["bin7"]) for k, L in G["method"].items()}, yr, 2024, G["rows"])
    prod_r = nested_pick({k: _full(base, G, L["sided"]) for k, L in G["round"].items()}, yr, 2024, fin_rows)
    # descriptive: the candidate that is best on 2020-2023 itself (optimistic, never used)
    orc = min(G["method"], key=lambda k: float(np.nanmean(np.where(rows, _full(base, G, G["method"][k]["bin7"]), np.nan))))
    comp = {"S2+ml2win": (base["P6_S2w"], base["H"]),
            "finishing (nested)": (P6n, Hn),
            "finishing (nested method, S2 round shapes)": (P6n, base["H"]),
            "oracle on 2020-23 (descriptive)": (G["P6"][orc].astype(float), base["H"]),
            "s2cond nested (no EB block)": None}
    # the same procedure restricted to the conditional-structure-only candidates: what the EB block adds
    Gs = dict(G, method={k: v for k, v in G["method"].items() if k.startswith("s2cond|")})
    P6s, _, picks_s = nested_predictions(base, Gs, years)
    comp["s2cond nested (no EB block)"] = (P6s, base["H"])
    Ge = dict(G, method={k: v for k, v in G["method"].items() if not k.startswith("s2cond|")})
    P6e, _, picks_e = nested_predictions(base, Ge, years)
    comp["EB candidates only, nested"] = (P6e, base["H"])
    bt, pdif, L, st = paired(base, rows, comp, "S2+ml2win")
    extra = {"EB candidates only, nested - s2cond nested (no EB block)":
             MR.paired_diff(L["EB candidates only, nested"], L["s2cond nested (no EB block)"], st, METRICS)}
    out = {"years": list(CV_YEARS), "n": int(rows.sum()), "picks": picks, "picks_s2cond": picks_s,
           "picks_eb_only": picks_e, "oracle_2020_23": orc, "means": bt, "paired_vs_S2+ml2win": pdif, "paired_extra": extra}
    out["production"] = {"method": prod_m[0], "method_mean_bin7_2016_2023": round(prod_m[1], 5),
                         "round": prod_r[0], "round_mean_sided_2016_2023": round(prod_r[1], 5)}
    out["by_year"] = {}
    for v in CV_YEARS:
        m = rows & (yr == v)
        out["by_year"][str(v)] = {"n": int(m.sum()), **{k: summ(base, comp[k][0], comp[k][1], m)["bin7"]
                                                        for k in ("S2+ml2win", "finishing (nested)")}}
    r5 = base["T"]["rounds"].to_numpy() == 5
    ti = base["T"]["title"].to_numpy().astype(bool)
    out["by_segment"] = {}
    for nm, m in (("3 rounds", rows & ~r5), ("5 rounds", rows & r5), ("title", rows & ti)):
        out["by_segment"][nm] = {"n": int(m.sum()), **{k: {mm: summ(base, comp[k][0], comp[k][1], m)[mm]
                                                           for mm in ("bin7", "joint", "round_given_fin")}
                                                       for k in ("S2+ml2win", "finishing (nested)")}}
    for k, v in list(pdif.items()) + list(extra.items()):
        log("nested: %s: %s" % (k, {m: (v[m]["diff"], v[m]["ci95"]) for m in ("bin7", "joint", "method_given_winner",
                                                                                "round_given_fin") if m in v}))
    log("nested: picks %s" % {y: (p["method"], p["round"]) for y, p in picks.items()})
    log("nested: production method %s, round %s" % (prod_m[0], prod_r[0]))
    save({"P6": P6n, "H": Hn, "years": years}, "nested_oof.pkl")
    json.dump(out, open(cpath("nested.json"), "w"), indent=1, default=float)
    log("nested: done in %.0f s" % (time.time() - t0))


def _full(base, G, v):
    out = np.full(len(base["T"]), np.nan)
    out[G["rows"]] = v
    return out


STAGES["nested"] = stage_nested


# ====================================================================== stage: gate (stack gate, forward-chained 2021-2023)
def blend_cells(Ja, Jb, beta):
    return beta * Ja + (1 - beta) * Jb


def fit_beta(base, Pa, Ha, Pb, Hb, rows, metric="bin7"):
    """Weight of model a in a linear pool of the joint cells with model b (grid 0..1 by 0.05), min mean loss."""
    Ja, Jb = joint(base, Pa, Ha, rows), joint(base, Pb, Hb, rows)
    best = None
    for b in np.round(np.arange(0, 1.0001, 0.05), 2):
        L = losses(base, blend_cells(Ja, Jb, b), rows)
        s = float(np.nanmean(L[metric]))
        if best is None or s < best[0]:
            best = (s, float(b))
    return best[1]


def gate_run(base, P6f, Hf, years=GATE_YEARS, hist_from=2017):
    """Forward-chained stack gate: for gate year Y, beta fit on OOF rows [hist_from, Y); the pooled gate-year cells."""
    yr = base["T"]["year"].to_numpy()
    n = len(yr)
    J = np.full((n, NC_), np.nan)
    betas = {}
    for Y in years:
        hist = rows_of(base, range(hist_from, Y))
        b = fit_beta(base, P6f, Hf, base["P6_S2w"], base["H"], hist)
        betas[str(Y)] = b
        m = rows_of(base, [Y])
        J[m] = blend_cells(joint(base, P6f, Hf, m), joint(base, base["P6_S2w"], base["H"], m), b)
    return J, betas


def stage_gate(args):
    """The stack gate (tools/ml2.py rule): the finishing model enters the method / round stack only if the forward-
    chained 2021-2023 blend with S2+ml2win beats S2+ml2win by more than 0.0005 in 7-bin log loss (primary). Primary
    input: the nested procedure's out-of-fold predictions. Also reported (not decisive): the minimal-change candidate
    (EB block inside S2's six-class model at S2's own penalty, nothing tuned) and the method-only nested predictions."""
    base = load("base.pkl")
    G = load("grid.pkl")
    nz = load("nested_oof.pkl")
    rows = rows_of(base, GATE_YEARS)
    inputs = {"nested procedure (primary)": (nz["P6"], nz["H"]),
              "nested method, S2 round shapes": (nz["P6"], base["H"]),
              "six_eb at S2's penalty C 0.002 (minimal change, reported)": (G["P6"]["six_eb|st2012|hl8|C0.002"].astype(float),
                                                                             base["H"])}
    out = {"years": list(GATE_YEARS), "n": int(rows.sum()), "rule": "enter if pooled 2021-2023 7-bin of the blend < "
           "S2+ml2win - 0.0005 (beta per year fit on OOF rows 2017..Y-1, grid 0..1 by 0.05)", "results": {}}
    T = base["T"]
    Linc = losses(base, joint(base, base["P6_S2w"], base["H"], rows), rows)
    for k, (P6f, Hf) in inputs.items():
        J, betas = gate_run(base, P6f, Hf)
        L = losses(base, J[rows], rows)
        Lraw = losses(base, joint(base, P6f, Hf, rows), rows)
        bt, st = MR.cluster_bootstrap({"blend": L, "raw": Lraw, "inc": Linc}, T["event"].to_numpy()[rows], B=2000)
        d = MR.paired_diff(L, Linc, st, METRICS)
        draw = MR.paired_diff(Lraw, Linc, st, METRICS)
        passed = d["bin7"]["diff"] < -SEL_MIN
        out["results"][k] = {"betas": betas, "blend_minus_S2+ml2win": d, "raw_minus_S2+ml2win": draw,
                             "blend": {m: bt["blend"][m] for m in ("bin7", "joint", "method_given_winner",
                                                                   "round_given_fin")},
                             "passes": bool(passed)}
        log("gate: %-58s betas %s blend-inc bin7 %+.5f %s joint %+.5f rgf %+.5f -> %s" % (
            k, betas, d["bin7"]["diff"], d["bin7"]["ci95"], d["joint"]["diff"], d["round_given_fin"]["diff"],
            "PASS" if passed else "fail"))
    out["decision"] = "enter" if out["results"]["nested procedure (primary)"]["passes"] else "not adopted"
    # production weight (deployment, if it enters): beta fit on every OOF row 2017-2023
    hist = rows_of(base, range(2017, 2024))
    out["production_beta"] = fit_beta(base, nz["P6"], nz["H"], base["P6_S2w"], base["H"], hist)
    json.dump(out, open(cpath("gate.json"), "w"), indent=1, default=float)
    log("gate: decision %s; production beta (2017-2023) %.2f" % (out["decision"], out["production_beta"]))


STAGES["gate"] = stage_gate


# ====================================================================== stage: stage2 (2019+ verified layers)
SL_STATS = ["kd", "sub_att", "td_lnd", "ctrl", "sig_lnd", "h_lnd"]
BY_DIMS_W = ["pw", "su", "so", "to", "co", "ca"]
BY_DIMS_L = ["ch", "sdf", "sd", "tdd", "ca"]


def layer_block(base):
    """Per row side, pre-fight values of the verified 2019+ layers (nan where absent; rows dated < 2026 only):
    statlines unconditional expected stat lines (statlines_oof.json, never the actual-length fields), durability's
    walk-forward chin / power random effects (durability.json backtest), bayes walk-forward skill means (bayes.json)."""
    T = base["T"]
    ids = list(T["id"])
    n = len(ids)
    sl = jload("statlines_oof.json")["fights"]
    du = jload("durability.json")["backtest"]
    by = jload("bayes.json")
    dims = by["meta"]["dims"]
    byf = by["fights"]
    out = {"sl": np.full((n, 2, len(SL_STATS)), np.nan), "du": np.full((n, 2, 2), np.nan),
           "by": np.full((n, 2, len(dims)), np.nan)}
    for i, f in enumerate(ids):
        r = sl.get(f)
        if r and r.get("date", "") < VAULT_S and "A" in r and r.get("set") != "raw2019":
            for s, t in enumerate(("A", "B")):
                for j, k in enumerate(SL_STATS):
                    v = r[t][k][-1]
                    out["sl"][i, s, j] = math.log1p(v / 60.0 if k == "ctrl" else v)
        r = du.get(f)
        if r and str(T["date"].iat[i]) < VAULT_S:
            for s, t in enumerate(("A", "B")):
                out["du"][i, s] = [math.log(max(r[t]["chin_re"], 1e-3)), math.log(max(r[t]["pow_re"], 1e-3))]
        r = byf.get(f)
        if r and r.get("date", "") < VAULT_S and r.get("skill_A"):
            out["by"][i, 0] = r["skill_A"]
            out["by"][i, 1] = r["skill_B"]
    out["by_dims"] = dims
    return out


def layer_design(LB, o, blocks):
    w, l = o, 1 - o
    cols, X = [], []
    if "statlines" in blocks:
        for j, k in enumerate(SL_STATS):
            X += [LB["sl"][:, w, j], LB["sl"][:, l, j]]
            cols += ["sl_w_" + k, "sl_l_" + k]
    if "durability" in blocks:
        X += [LB["du"][:, w, 1], LB["du"][:, l, 0], LB["du"][:, w, 0], LB["du"][:, l, 1]]
        cols += ["du_w_pow", "du_l_chin", "du_w_chin", "du_l_pow"]
    if "bayes" in blocks:
        di = {d: j for j, d in enumerate(LB["by_dims"])}
        for d in BY_DIMS_W:
            X.append(LB["by"][:, w, di[d]])
            cols.append("by_w_" + d)
        for d in BY_DIMS_L:
            X.append(LB["by"][:, l, di[d]])
            cols.append("by_l_" + d)
    return np.stack(X, 1), cols


def offset_mnl_fit(O, X, y, lam):
    """Multinomial logit with a fixed offset O (log base shares, coefficient 1), class intercepts and an L2 penalty
    lam on the standardized slopes (mean-NLL scale)."""
    n, d = X.shape
    k = 3
    Y = np.eye(k)[y]

    def f(th):
        W = th[:d * k].reshape(d, k)
        b = th[d * k:]
        Z = O + X @ W + b
        Z = Z - Z.max(1, keepdims=True)
        E = np.exp(Z)
        s = E.sum(1)
        P = E / s[:, None]
        nll = (np.log(s) - (Z * Y).sum(1)).mean()
        R = (P - Y) / n
        return nll + 0.5 * lam * (W ** 2).sum(), np.concatenate([(X.T @ R + lam * W).ravel(), R.sum(0)])
    r = minimize(f, np.zeros(d * k + k), jac=True, method="L-BFGS-B", options={"maxiter": 3000})
    return r.x[:d * k].reshape(d, k), r.x[d * k:]


def offset_mnl_predict(O, X, W, b):
    Z = O + X @ W + b
    E = np.exp(Z - Z.max(1, keepdims=True))
    return E / E.sum(1, keepdims=True)


def stage2_run(base, LB, blocks, lam, years=GATE_YEARS, first=2019):
    """Residual on S2+ml2win's method-given-winner shares, forward-chained: year Y fit on decisive rows in
    [first, Y) where the layers exist; rows without the layers keep the incumbent's shares."""
    T = base["T"]
    yr = T["year"].to_numpy()
    ws, mc = method_labels(base)
    sA, sB = s2_cond(base)
    OA, OB = np.log(np.clip(sA, 1e-9, 1)), np.log(np.clip(sB, 1e-9, 1))
    XA, cols = layer_design(LB, 0, blocks)
    XB, _ = layer_design(LB, 1, blocks)
    have = ~np.isnan(XA).any(1) & ~np.isnan(XB).any(1)
    P6 = np.array(base["P6_S2w"], copy=True)
    info = {}
    for Y in years:
        tr = (yr < Y) & (yr >= first) & (ws >= 0) & have
        va = ((yr == Y) if Y < 2024 else (yr >= 2024)) & have
        if tr.sum() < 200:
            info[str(Y)] = {"n_train": int(tr.sum()), "skipped": True}
            continue
        Xtr = np.where((ws[tr] == 0)[:, None], XA[tr], XB[tr])
        Otr = np.where((ws[tr] == 0)[:, None], OA[tr], OB[tr])
        mu, sd = Xtr.mean(0), Xtr.std(0) + 1e-9
        W, b = offset_mnl_fit(Otr, (Xtr - mu) / sd, mc[tr], lam)
        qA = offset_mnl_predict(OA[va], (XA[va] - mu) / sd, W, b)
        qB = offset_mnl_predict(OB[va], (XB[va] - mu) / sd, W, b)
        P6[va] = p6_from_cond(qA, qB, base["pwin"][va])
        info[str(Y)] = {"n_train": int(tr.sum()), "n_pred": int(va.sum())}
    return P6, info, cols


def stage_stage2(args):
    """The 2019+ verified layers as a residual on S2+ml2win's method shares (the finishing model itself did not pass
    its gate, so the incumbent is the base). Gate: pooled 2021-2023 7-bin better than S2+ml2win by > 0.0005. The
    penalty is pre-set (lam 1.0); lam 0.3 and 3.0 are reported as sensitivity, never chosen from."""
    base = load("base.pkl")
    LB = layer_block(base)
    yr = base["T"]["year"].to_numpy()
    cov = {k: {str(y): int((~np.isnan(LB[k][:, 0, 0]) & (yr == y)).sum()) for y in range(2019, 2026)}
           for k in ("sl", "du", "by")}
    rows = rows_of(base, GATE_YEARS)
    T = base["T"]
    Linc = losses(base, joint(base, base["P6_S2w"], base["H"], rows), rows)
    out = {"coverage_rows_by_year": cov, "rule": "enter if pooled 2021-2023 7-bin < S2+ml2win - 0.0005 at lam 1.0",
           "results": {}}
    for blocks in (("statlines",), ("durability",), ("bayes",), ("statlines", "durability", "bayes")):
        for lam in (1.0, 0.3, 3.0):
            first = 2020 if "statlines" in blocks else 2019
            P6, info, cols = stage2_run(base, LB, blocks, lam, first=first)
            L = losses(base, joint(base, P6, base["H"], rows), rows)
            bt, st = MR.cluster_bootstrap({"s2": L, "inc": Linc}, T["event"].to_numpy()[rows], B=2000)
            d = MR.paired_diff(L, Linc, st, ["bin7", "method_given_winner", "method3", "joint"])
            key = "+".join(blocks) + " lam %g" % lam
            out["results"][key] = {"folds": info, "minus_S2+ml2win": d,
                                   "passes": bool(lam == 1.0 and d["bin7"]["diff"] < -SEL_MIN)}
            log("stage2: %-40s bin7 %+.5f %s mgw %+.5f%s" % (key, d["bin7"]["diff"], d["bin7"]["ci95"],
                                                             d["method_given_winner"]["diff"],
                                                             "  PASS" if out["results"][key]["passes"] else ""))
    out["decision"] = [k for k, v in out["results"].items() if v["passes"]] or "none passes"
    json.dump(out, open(cpath("stage2.json"), "w"), indent=1, default=float)
    log("stage2: decision %s" % (out["decision"],))


STAGES["stage2"] = stage_stage2


# ====================================================================== production configuration
def production_cfgs():
    """The configuration the protocol would deploy: the nested stage's pick over all folds 2016-2023 (method and
    round), the pre-UFC switch of that pick, and the gate's production blend weight."""
    nz = json.load(open(cpath("nested.json")))
    gt = json.load(open(cpath("gate.json")))
    tn = json.load(open(cpath("tune.json")))
    mk, rk = nz["production"]["method"], nz["production"]["round"]
    mcfg, pre = method_grid()[mk]
    rcfg = round_grid()[rk]
    return {"method_key": mk, "method": mcfg, "use_pre": pre, "round_key": rk, "round": rcfg,
            "beta": gt["production_beta"], "filter": tn["chosen"]["filter"], "gate_decision": gt["decision"]}


# ====================================================================== stage: swap (corner-swap test of the pipeline)
def swap_rows(base, feats, filt, card, flip):
    """Copies of base / feats / filter / cardio with A and B exchanged on the rows in flip."""
    b = dict(base)
    T = base["T"].copy()
    for c in ("slug", "name", "age", "n"):
        a_, b_ = T["A_" + c].copy(), T["B_" + c].copy()
        T.loc[flip, "A_" + c], T.loc[flip, "B_" + c] = b_[flip], a_[flip]
    T.loc[flip, "winner"] = T.loc[flip, "winner"].map({"A": "B", "B": "A"}).fillna(T.loc[flip, "winner"])
    b["T"] = T
    FX2, FY2 = base["FX2"].copy(), base["FY2"].copy()
    FX2.loc[flip], FY2.loc[flip] = base["FY2"].loc[flip].to_numpy(), base["FX2"].loc[flip].to_numpy()
    b["FX2"], b["FY2"] = FX2, FY2
    y = base["y"].copy()
    y[flip] = MR.mirror_index(base["y"][flip])
    b["y"] = y
    b["pwin"] = np.where(flip, 1 - base["pwin"], base["pwin"])
    for k in ("P6_S2", "P6_S2w"):
        b[k] = np.where(flip[:, None], base[k][:, ::-1], base[k])
    b["H"] = np.where(flip[:, None], MR.mirror_cells(base["H"]), base["H"])
    f = dict(feats)
    f["PA"] = np.where(flip[:, None], feats["PB"], feats["PA"])
    f["PB"] = np.where(flip[:, None], feats["PA"], feats["PB"])
    f["pre"] = np.where(flip[:, None, None], feats["pre"][:, ::-1], feats["pre"])
    return b, f, np.where(flip[:, None, None], filt[:, ::-1], filt), np.where(flip[:, None, None], card[:, ::-1], card)


def stage_swap(args):
    """Swap A and B on a random half of all rows (labels, designs, pointers, pre-UFC counts, filter state, ML v2
    winner, S2 inputs), refit the production configuration on fold 2023 (a CV fold, not the 2024-2025 window) and
    check that every prediction mirrors: P6 and the joint cells of flipped rows equal the mirror of the originals."""
    base, feats = load("base.pkl"), load("feats.pkl")
    pc = production_cfgs()
    rng = np.random.default_rng(20261107)
    flip = rng.random(len(base["T"])) < 0.5
    filt, _ = run_filter(feats, base, pc["filter"]["sigma0"], pc["filter"]["tau"])
    card = cardio_block(feats, base)
    bs, fs, filts, cards = swap_rows(base, feats, filt, card, flip)
    v = 2023
    res = {}
    for nm, (bb, ff, fl, cd) in (("orig", (base, feats, filt, card)), ("swap", (bs, fs, filts, cards))):
        fd = FoldData(bb, ff, v, fl, cd, use_pre=pc["use_pre"])
        P6 = oof_method(bb, {v: fd}, [v], pc["method"])
        H = oof_round(bb, {v: fd}, [v], pc["round"])
        six = oof_method(bb, {v: fd}, [v], {"six": ("eb",), "C": 0.002, "start": 2012, "hl": 8.0})
        rows = rows_of(bb, [v])
        res[nm] = (P6, H, six, joint(bb, P6, H, rows), rows)
    P6o, Ho, sixo, Jo, rows = res["orig"]
    P6s, Hs, sixs, Js, _ = res["swap"]
    fr = flip[rows]
    Jm = np.where(fr[:, None], MR.mirror_cells(Js), Js)
    d_p6 = float(np.nanmax(np.abs(np.where(flip[:, None], P6s[:, ::-1], P6s) - P6o)[rows]))
    d_six = float(np.nanmax(np.abs(np.where(flip[:, None], sixs[:, ::-1], sixs) - sixo)[rows]))
    d_j = float(np.nanmax(np.abs(Jm - Jo)))
    out = {"fold": v, "n_rows": int(rows.sum()), "n_flipped": int(fr.sum()), "max_abs_diff_P6": d_p6,
           "max_abs_diff_joint": d_j, "max_abs_diff_six_eb_P6": d_six, "method": pc["method_key"],
           "round": pc["round_key"]}
    json.dump(out, open(cpath("swap.json"), "w"), indent=1)
    log("swap: %s" % out)
    assert d_p6 < 1e-6 and d_j < 1e-6 and d_six < 1e-6, "corner-swap test failed"


STAGES["swap"] = stage_swap


# ====================================================================== stage: holdout (2024-2025, scored once)
def stage_holdout(args):
    """The single 2024-01-01..2025-12-31 look. Scored objects (fixed in code before the look): the production finishing
    model (nested pick: method + round), its method with S2's round shapes, the gate's production blend with
    S2+ml2win (beta from 2017-2023 OOF rows), and the minimal-change six-class S2 + EB block at S2's own penalty;
    every one paired with S2+ml2win. Everything is fit on fights before 2024-01-01. A marker refuses a second run."""
    mark = cpath("holdout.done")
    if os.path.exists(mark):
        raise SystemExit("holdout already scored (%s); the 2024-2025 window is scored once" % open(mark).read().strip())
    base, feats = load("base.pkl"), load("feats.pkl")
    pc = production_cfgs()
    FD = get_folds(base, feats, pc["filter"], pc["use_pre"], years=FOLDS)
    P6 = oof_method(base, FD, [2024], pc["method"])
    H = oof_round(base, FD, [2024], pc["round"])
    FDp = get_folds(base, feats, pc["filter"], True, years=FOLDS)
    six = oof_method(base, FDp, [2024], {"six": ("eb",), "C": 0.002, "start": 2012, "hl": 8.0})
    rows = rows_of(base, [2024])
    assert base["T"]["date"][rows].min() >= TEST_FROM and base["T"]["date"][rows].max() < VAULT
    Jf = joint(base, P6, H, rows)
    Ji = joint(base, base["P6_S2w"], base["H"], rows)
    Jfull = np.full((len(rows), NC_), np.nan)
    Jfull[rows] = blend_cells(Jf, Ji, pc["beta"])
    T = base["T"]
    L = {"S2+ml2win": losses(base, Ji, rows), "finishing": losses(base, Jf, rows),
         "finishing method, S2 round shapes": losses(base, joint(base, P6, base["H"], rows), rows),
         "blend (beta %.2f)" % pc["beta"]: losses(base, Jfull[rows], rows),
         "six-class S2 + EB block (C 0.002)": losses(base, joint(base, six, base["H"], rows), rows)}
    bt, st = MR.cluster_bootstrap(L, T["event"].to_numpy()[rows], B=2000, seed=11)
    pdif = {k + " - S2+ml2win": MR.paired_diff(L[k], L["S2+ml2win"], st, METRICS) for k in L if k != "S2+ml2win"}
    out = {"window": "2024-01-01..2025-12-31", "n": int(rows.sum()), "n_cards": int(T["event"][rows].nunique()),
           "production": {k: v for k, v in pc.items() if k not in ("method", "round")}, "means": bt, "paired": pdif,
           "scored_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    yr = T["year"].to_numpy()
    out["by_year"] = {str(y): {k: round(float(np.nanmean(np.where((yr[rows] == y), L[k]["bin7"], np.nan))), 5)
                               for k in L} for y in (2024, 2025)}
    for k, v in pdif.items():
        log("holdout: %s: %s" % (k, {m: (v[m]["diff"], v[m]["ci95"]) for m in ("bin7", "joint", "method_given_winner",
                                                                                 "round_given_fin", "method3")}))
    save({"P6": P6, "H": H, "six": six, "rows": rows}, "holdout_pred.pkl")
    json.dump(out, open(cpath("holdout.json"), "w"), indent=1, default=float)
    with open(mark, "w") as fh:
        fh.write("scored %s UTC, n=%d\n" % (out["scored_utc"], out["n"]))
    log("holdout: done (n=%d)" % out["n"])


STAGES["holdout"] = stage_holdout


# ====================================================================== stage: export
EB_EXPORT = ["kow", "subw", "dec", "kol", "subl", "r1w", "r1l", "latew", "latel"]


def r5_(x, k=5):
    return None if x is None or (isinstance(x, float) and not np.isfinite(x)) else round(float(x), k)


def lr_block(model_sc, lr, cols):
    """Full-precision coefficients (rounding to 8 dp drifts 1e-8 over ~200 columns)."""
    return {"cols": list(cols), "mean": [float(v) for v in model_sc.mean_], "scale": [float(v) for v in model_sc.scale_],
            "coef": [[float(v) for v in row] for row in lr.coef_], "intercept": [float(v) for v in lr.intercept_]}


def method_cols(pc, base):
    spec = pc["method"]["spec"]
    return [c for s in spec.get("fin", []) for c in FIN_SETS[s]] + (list(base["cols_s2"]) if spec.get("s2") else [])


def round_cols(pc, base):
    spec = pc["round"]["spec"]
    cols = [c for s in spec.get("fin", []) for c in ROUND_SETS[s]]
    if spec.get("haz"):
        cols += [c for c in MR.HAZ_COLS if c not in FIGHT_COLS]
    return cols


def stage_export(args):
    """data/derived/finishing.json: protocol, every stage's results, per-fight cells for the blind-test plugin
    (2019-2023 nested out-of-fold, 2024-2025 the single look), and the deployment model (refit on every fight before
    2026-01-01 by the frozen procedure) with the end-of-2025 EB roster and JS test vectors."""
    t0 = time.time()
    base, feats = load("base.pkl"), load("feats.pkl")
    pc = production_cfgs()
    T = base["T"]
    yr = T["year"].to_numpy()
    res = {k: json.load(open(cpath(k + ".json"))) for k in ("tune", "cvfixed", "nested", "gate", "stage2", "swap",
                                                             "holdout")}
    nz = load("nested_oof.pkl")
    hp = load("holdout_pred.pkl")
    # per-fight cells: nested OOF 2019-2023, holdout 2024-2025
    P6 = np.where(np.isnan(nz["P6"]), hp["P6"], nz["P6"])
    H = np.where(yr[:, None] >= 2024, hp["H"], nz["H"])
    fights = {}
    for i in np.flatnonzero(yr >= 2019):
        if str(T["date"].iat[i]) >= VAULT_S or np.isnan(P6[i]).any():
            continue
        J = MR.joint_from_c6(P6[i:i + 1], H[i:i + 1], base["draw_c"])[0]
        Ji = MR.joint_from_c6(base["P6_S2w"][i:i + 1], base["H"][i:i + 1], base["draw_c"])[0]
        R = 5 if T["rounds"].iat[i] == 5 else 3

        def compact(c):
            return [round(float(x), 5) for x in list(c[0:R]) + list(c[5:5 + R]) + list(c[10:10 + R]) +
                    list(c[15:15 + R]) + list(c[20:23])]

        def b7(c):
            return [round(float(x), 5) for x in (c[0:5].sum(), c[5:10].sum(), c[20], c[22], c[21], c[15:20].sum(),
                                                 c[10:15].sum())]
        fights[T["id"].iat[i]] = {"date": str(T["date"].iat[i]), "set": "holdout" if yr[i] >= 2024 else "nested_oof",
                                  "rounds": R, "p_a": round(float(base["pwin"][i]), 5), "cells": compact(J),
                                  "bins7": b7(J), "s2ml2win_cells": compact(Ji), "s2ml2win_bins7": b7(Ji)}
    # deployment refit: every fight before 2026-01-01 (EB, filter, method and round models)
    filt, _ = run_filter(feats, base, pc["filter"]["sigma0"], pc["filter"]["tau"])
    card = cardio_block(feats, base)
    fd = FoldData(base, feats, 2026, filt, card, use_pre=pc["use_pre"])
    _, _, meta_r = eb_block(feats, base, 2026, use_pre=pc["use_pre"], roster=True)
    mc = pc["method"]
    qA, qB, mm = cm_fold(fd, base, mc["spec"], mc["C"], mc["start"], None, mc["hl"])
    Hd, rm = cr_fold(fd, base, pc["round"]["spec"], pc["round"]["C"], pc["round"].get("start", 2008),
                     pc["round"].get("slope", True))
    mcols, rcols = method_cols(pc, base), round_cols(pc, base)
    js = {"what": "finishing model (monitored candidate; not adopted by the stack gate): P(cell) = pA x P(method | "
                  "winner) x P(round | winner, method); method = multinomial logit over [KO, SUB, DEC] on the winner-"
                  "oriented design; round = continuation-ratio logit over rounds on the finisher-oriented design",
          "fit_through": "2025-12-31", "draw_c": base["draw_c"], "classes": ["KO", "SUB", "DEC"],
          "method": lr_block(mm.sc, mm.lr, mcols),
          "round": dict(lr_block(rm.sc, rm.lr, rcols), slope=bool(rm.slope),
                        dummies="12 free columns after the covariates (and their (j-1)/2 slopes when slope): index "
                                "(j-1)*2+m for 3-round bouts, 4+(j-1)*2+m for 5-round bouts; j = round 1..R-1, "
                                "m = 0 KO / 1 SUB; P(round R) = the remainder"),
          "cells": "R5 layout: A KO r1..5, A SUB r1..5, B KO r1..5, B SUB r1..5, A DEC, B DEC, draw",
          "fin_features": {"zW": "logit(P(W wins)) from the ML v2 winner (A side: logit pA, B side: -logit pA)",
                           "azW": "|zW|", "w_<rate>": "the winner's EB posterior mean (log-odds shift) for the rate",
                           "l_<rate>": "the loser's EB posterior mean for the rate"},
          "eb": {"rates": {r: {"indicator": EB_RATES[r][0], "exposure": EB_RATES[r][1]} for r in EB_EXPORT},
                 "sigma": {r: fd.meta["sigma"][r] for r in EB_EXPORT}, "lam_pre": {r: fd.meta["lam"][r] for r in EB_EXPORT},
                 "fit_through": "2025-12-31"}}
    act = set()
    E = feats["E"]
    for pid, d in zip(E["pid"], E["year"]):
        if d >= 2019:
            act.add(pid)
    roster = {}
    nev = np.diff(feats["start"])
    for pid in sorted(act):
        roster[feats["slugs"][pid]] = {"name": feats["names"][pid], "n_ufc": int(nev[pid]),
                                       **{r: round(float(meta_r["roster"][r][pid]), 4) for r in EB_EXPORT}}
    js["roster"] = roster
    # JS test vectors: 2024-2025 rows with the deployment model's predictions from their full designs
    rng = np.random.default_rng(7)
    pick = np.sort(rng.choice(np.flatnonzero((yr >= 2024) & (base["y"] >= 0)), 30, replace=False))
    XA_m = design(fd, 0, mc["spec"])
    XB_m = design(fd, 1, mc["spec"])
    XA_r, XB_r = round_design(fd, 0, pc["round"]["spec"]), round_design(fd, 1, pc["round"]["spec"])
    P6d = p6_from_cond(qA, qB, base["pwin"])
    Jd = MR.joint_from_c6(P6d, Hd, base["draw_c"])
    tv = []
    for i in pick:
        tv.append({"id": T["id"].iat[i], "rounds": int(5 if T["rounds"].iat[i] == 5 else 3),
                   "pA": float(base["pwin"][i]), "xA": [float(v) for v in XA_m[i]], "xB": [float(v) for v in XB_m[i]],
                   "rA": [float(v) for v in XA_r[i]], "rB": [float(v) for v in XB_r[i]],
                   "cells": [float(v) for v in Jd[i]], "qA": [float(v) for v in qA[i]], "qB": [float(v) for v in qB[i]]})
    # roster feature builder check: Volkanovski vs Gaethje EB block from the roster
    js["test_vectors"] = tv
    meta = {"tool": "tools/finishing.py", "built": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "protocol": "2026+ dropped at parse (tools/ml2.py wrapper); every choice by forward-chained CV < 2024 "
                        "(tune folds 2016-2019, nested selection 2017-2023, stack gate 2021-2023, 0.0005 rule); "
                        "2024-01-01..2025-12-31 scored once (holdout marker); corner-swap test passed",
            "decision": "NOT ADOPTED (stack gate failed); monitored candidate",
            "production": {k: v for k, v in pc.items() if k not in ("method", "round")},
            "cells": "per fight: R-round layout A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, draw; "
                     "bins7 [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO]; p_a = the ML v2 winner it conditions on"}
    out = {"meta": meta, "tune": res["tune"], "cv_fixed": res["cvfixed"], "nested": res["nested"], "gate": res["gate"],
           "stage2": res["stage2"], "swap": res["swap"], "holdout": res["holdout"], "fights": fights, "js_model": js}
    with open(OUT_JSON + ".tmp", "w") as fh:
        json.dump(out, fh, separators=(",", ":"), default=float, allow_nan=False)
    os.replace(OUT_JSON + ".tmp", OUT_JSON)
    log("export: %s (%d fights, roster %d, %.1f MB, %.0f s)" % (OUT_JSON, len(fights), len(roster),
                                                               os.path.getsize(OUT_JSON) / 1e6, time.time() - t0))


STAGES["export"] = stage_export


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
