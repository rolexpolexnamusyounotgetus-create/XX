#!/usr/bin/env python3
"""Mixture-of-experts stacker: the final win-probability layer (task key: moe).

Run from the project root (Python 3.13 + numpy/pandas/scipy/scikit-learn/lightgbm):

    python3 tools/moe.py prep         # walk-forward table 2010-2025 (2026+ dropped), priors_asof, Glicko,
                                      # layoffs, career counters -> out/moe_cache/prep.pkl + engine inputs
    node tools/moe_engine_bt.js       # engine expert: FightEngine.summarize on every backtest_dev fight,
                                      # both corner orders -> data/derived/moe_engine_bt.json
    python3 tools/moe.py experts      # internal experts (feature LR, feature GBM, Glicko) with strictly
                                      # out-of-fold predictions for 2019-2023 and <=2023-trained predictions
                                      # for 2024-2025 -> out/moe_cache/experts.pkl
    python3 tools/moe.py fit          # stackers (a) constrained logit-linear, (b) softmax-gated, (c) GBM
                                      # meta-learner + calibration; evaluation on 2024-2025; export
                                      # data/derived/moe.json (model + report numbers)
    python3 tools/moe.py all          # prep + experts + fit (the engine step must have been run)

Protocol (docs/BACKLOG.md): fights dated 2026-01-01 or later are dropped before anything is computed.
Train/tune = 2019-2023 (expert models also see 2010-2018 history as training data), validation =
2024-01-01..2025-12-31 for selection and reporting only. Every model is corner-symmetric: experts enter
as logits (antisymmetric under a corner swap), gating features are symmetric functions of the two sides,
nothing has an intercept, and GBMs are trained on mirrored rows and averaged over both orientations.

research/model_moe.md has the method, results and the page-integration recipe; src/ml/moe.js is the
dependency-free evaluator of the exported model.
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

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.dirname(HERE)
DERIVED = os.path.join(ROOT, "data", "derived")
CACHE = os.environ.get("MOE_CACHE", os.path.join(ROOT, "out", "moe_cache"))
VAULT_FROM = dt.date(2026, 1, 1)
HIST_FROM = dt.date(2010, 1, 1)          # snapshot entries used as expert-training history
TRAIN = ("2019-01-01", "2023-12-31")
VALID = ("2024-01-01", "2025-12-31")
ELO_K, ELO_BOOST = 44, 1.5               # data/derived/elo_report.json (chosen on 2019-2023)

DIVS = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight",
        "Light Heavyweight", "Heavyweight", "Women's Strawweight", "Women's Flyweight",
        "Women's Bantamweight", "Women's Featherweight"]
DIV_GROUPS = {  # coarse groups for gating (few fights per division)
    "Flyweight": "light", "Bantamweight": "light", "Featherweight": "light",
    "Lightweight": "middle", "Welterweight": "middle", "Middleweight": "middle",
    "Light Heavyweight": "heavy", "Heavyweight": "heavy",
    "Women's Strawweight": "women", "Women's Flyweight": "women", "Women's Bantamweight": "women",
    "Women's Featherweight": "women"}


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


def wjson(path, obj, indent=None):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh, indent=indent, separators=None if indent else (",", ":"), allow_nan=False)
    os.replace(tmp, path)


# ====================================================================== prep
def glicko_pass(fights, rd0=200.0, c_day=1.6, rd_min=40.0, q=math.log(10) / 400, store=False):
    """Glicko-1, one rating period per fight. RD grows with inactivity: RD^2 + c_day^2 * days."""
    R = defaultdict(lambda: 1500.0)
    RD = {}
    last = {}
    pre = {}
    preds = []
    nf = Counter()
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        rds = []
        for p in (a, b):
            if p not in RD:
                r = rd0
            else:
                r = min(350.0, math.sqrt(RD[p] ** 2 + c_day ** 2 * max(0, f.day - last[p])))
            rds.append(r)
        ra, rb = R[a], R[b]
        # expected score of A including both uncertainties (Glicko's g of combined RD)
        gab = 1 / math.sqrt(1 + 3 * q * q * (rds[0] ** 2 + rds[1] ** 2) / math.pi ** 2)
        ea = 1 / (1 + 10 ** (-gab * (ra - rb) / 400))
        if store:
            pre[f.fid] = (ra, rb, rds[0], rds[1])
        if f.winner in ("A", "B") and nf[a] >= 1 and nf[b] >= 1:
            preds.append((f.date.year, ea, 1.0 if f.winner == "A" else 0.0))
        if f.winner in ("A", "B", "D"):
            s = {"A": 1.0, "B": 0.0, "D": 0.5}[f.winner]
            new = []
            for i, (p, r_self, r_opp, rd_self, rd_opp, sc) in enumerate(
                    ((a, ra, rb, rds[0], rds[1], s), (b, rb, ra, rds[1], rds[0], 1 - s))):
                g = 1 / math.sqrt(1 + 3 * q * q * rd_opp ** 2 / math.pi ** 2)
                e = 1 / (1 + 10 ** (-g * (r_self - r_opp) / 400))
                d2 = 1 / (q * q * g * g * e * (1 - e))
                denom = 1 / rd_self ** 2 + 1 / d2
                new.append((p, r_self + q / denom * g * (sc - e), max(rd_min, math.sqrt(1 / denom))))
            for p, r, rd in new:
                R[p], RD[p] = r, rd
        else:
            for p, rd in ((a, rds[0]), (b, rds[1])):
                RD[p] = rd
        last[a] = last[b] = f.day
        nf[a] += 1
        nf[b] += 1
    return R, RD, last, pre, preds


def ll_rows(rows):
    p = np.clip(np.array([r[1] for r in rows]), 1e-6, 1 - 1e-6)
    y = np.array([r[2] for r in rows])
    return float(-np.mean(y * np.log(p) + (1 - y) * np.log(1 - p)))


def cmd_prep(args):
    import build_db as B
    t0 = time.time()
    os.makedirs(CACHE, exist_ok=True)
    lg = {}
    fights, _ = B.parse_fights(lg)
    n_all = len(fights)
    fights = [f for f in fights if f.date < VAULT_FROM]          # hidden-data protocol: drop 2026+
    log("parsed %d fights, kept %d dated before %s (last %s)" % (n_all, len(fights), VAULT_FROM, fights[-1].date))
    people = B.build_people(fights, lg)
    B.build_vectors(fights, lg)
    _, elo_pre, _ = B.run_elo(fights, ELO_K, ELO_BOOST, store=True)

    # Glicko: tune (rd0, c_day) on 2012-2023 decisive fights (2024+ untouched)
    best = None
    for rd0 in (150, 200, 250, 300):
        for c in (0.8, 1.2, 1.6, 2.4, 3.2):
            *_, preds = glicko_pass(fights, rd0, c)
            ll = ll_rows([r for r in preds if 2012 <= r[0] <= 2023])
            if best is None or ll < best[0]:
                best = (ll, rd0, c)
    log("glicko tuned on 2012-2023: rd0=%s c_day=%s log loss %.4f" % (best[1], best[2], best[0]))
    gR, gRD, glast, gpre, gpreds = glicko_pass(fights, best[1], best[2], store=True)

    # career counters per person, walk-forward (state before each fight)
    cnt = defaultdict(lambda: {"last": None, "min": 0.0, "n": 0, "w": 0, "l": 0, "streak": 0, "res": [],
                               "n5": 0, "title": 0, "fin_w": 0, "fin_l": 0, "opp_elo": []})
    extra = {}
    for f in fights:
        a, b = f.persons
        if a == b:
            continue
        rec = {}
        for tag, p, opp in (("A", a, b), ("B", b, a)):
            c = cnt[p]
            rec[tag] = {"layoff": (f.day - c["last"]) if c["last"] is not None else None,
                        "cmin": c["min"], "cn": c["n"], "w": c["w"], "l": c["l"], "streak": c["streak"],
                        "last3": float(np.mean(c["res"][-3:])) if c["res"] else 0.5, "n5": c["n5"],
                        "titles": c["title"], "fin_w": c["fin_w"], "fin_l": c["fin_l"],
                        "opp_elo": float(np.mean(c["opp_elo"][-5:])) if c["opp_elo"] else None}
        extra[f.fid] = rec
        mins = (f.fight_s or 0) / 60.0
        for s, p in ((0, a), (1, b)):
            c = cnt[p]
            c["last"] = f.day
            c["min"] += mins
            c["n"] += 1
            if f.sched == 5:
                c["n5"] += 1
            if f.title:
                c["title"] += 1
            c["opp_elo"].append(elo_pre[f.fid][1 - s])
            won = f.winner == ("A" if s == 0 else "B")
            lost = f.winner == ("B" if s == 0 else "A")
            if won:
                c["w"] += 1
                c["streak"] = c["streak"] + 1 if c["streak"] > 0 else 1
                c["res"].append(1.0)
                if f.cat in ("ko", "sub"):
                    c["fin_w"] += 1
            elif lost:
                c["l"] += 1
                c["streak"] = c["streak"] - 1 if c["streak"] < 0 else -1
                c["res"].append(0.0)
                if f.cat in ("ko", "sub"):
                    c["fin_l"] += 1
            else:
                c["res"].append(0.5)

    # snapshot entries from 2010 (same format as backtest.json) for expert training history
    B.BACKTEST_FROM = HIST_FROM
    state, entries = B.walk(fights, people, elo_pre, 730.0)
    entries = [e for e in entries if e["date"] < VAULT_FROM.isoformat()]
    for e in entries:
        g = gpre[e["id"]]
        x = extra[e["id"]]
        for i, t in enumerate(("A", "B")):
            e[t]["glicko"] = g[i]
            e[t]["glicko_rd"] = g[2 + i]
            e[t].update(x[t])
    log("entries %d (%s..%s)" % (len(entries), entries[0]["date"], entries[-1]["date"]))

    # priors_asof for the engine expert (fights in the 5 years before Jan 1 of the entry's year)
    priors_asof = {}
    for y in range(2010, 2026):
        priors_asof[str(y)] = B.build_priors(fights, dt.date(y - 5, 1, 1), dt.date(y, 1, 1))
    wjson(os.path.join(CACHE, "priors_asof.json"), priors_asof)

    # roster table for live use: Glicko and counters as of the end of 2025 data (+ the live snapshot below)
    keys = B.KEYS
    with open(os.path.join(CACHE, "prep.pkl"), "wb") as fh:
        pickle.dump({"entries": entries, "keys": keys, "priors_asof": priors_asof,
                     "glicko": {"rd0": best[1], "c_day": best[2], "tune_ll": best[0]},
                     "built": dt.datetime.now(dt.timezone.utc).isoformat()}, fh)
    log("prep done in %.0fs -> %s" % (time.time() - t0, CACHE))


# ====================================================================== main
def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("cmd", choices=["prep", "experts", "fit", "all"])
    ap.add_argument("--quick", action="store_true")
    args = ap.parse_args()
    warnings.filterwarnings("ignore")
    if args.cmd in ("prep", "all"):
        cmd_prep(args)
    if args.cmd in ("experts", "all"):
        cmd_experts(args)
    if args.cmd in ("fit", "all"):
        cmd_fit(args)


if __name__ == "__main__":
    main()
