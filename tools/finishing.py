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
