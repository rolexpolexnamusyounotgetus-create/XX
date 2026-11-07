#!/usr/bin/env python3
"""v5_train_ablation_mr.py: methodround scoring of the Calibrate A arms (tools/v5_train_ablation.js), TRAIN 2019-2023 only.

Uses tools/methodround.py's own scoring code (expand_cells, outcome_cells, per_fight_losses, cluster_bootstrap, paired_diff:
the same functions `methodround.py --score` runs) on each arm's smoothed joint cells, so the numbers are comparable with
methodround model S and with evalv's "who x how x when". Reports per arm: the level of every methodround metric, the paired
difference vs model S, and the paired difference vs the all-on arm (event-cluster bootstrap, 2,000 resamples, the same
resampling matrix for every arm).

    python3 tools/v5_train_ablation_mr.py [--tag main]
Reads out/v5_train_ablation[_<tag>]/cells_<arm>.json and data/derived/v5_train_ablation[_<tag>].json (arm list);
writes data/derived/v5_train_ablation_mr[_<tag>].json. Nothing dated 2024 or later is scored (window 2019-01-01..2024-01-01).
"""
import argparse
import json
import os
import sys

import numpy as np
import pandas as pd

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import methodround as MR  # noqa: E402

D0, D1 = "2019-01-01", "2024-01-01"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tag", default="")
    a = ap.parse_args()
    tag = ("_" + a.tag) if a.tag else ""
    summ = json.load(open(os.path.join(ROOT, "data/derived", "v5_train_ablation%s.json" % tag)))
    arms = list(summ["meta"]["arms"].keys())
    ref = summ["meta"].get("ref", "all")
    cdir = os.path.join(ROOT, "out", "v5_train_ablation" + tag)
    bt = {f["id"]: f for f in json.load(open(os.path.join(ROOT, "data/derived/backtest_dev.json")))["fights"]}
    mr = json.load(open(MR.OUT_JSON))["fights"]
    subs = {k: json.load(open(os.path.join(cdir, "cells_%s.json" % k))) for k in arms}
    ids = [i for i in subs[ref] if i in bt and i in mr and "S" in mr[i] and D0 <= bt[i]["date"] < D1 and bt[i]["date"] < "2026-01-01"]
    rows = []
    for i in ids:
        f = bt[i]
        res = f["result"]
        cls = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC", "DRAW": "DRAW"}.get(res["method"])
        rows.append({"id": i, "rounds": 5 if f["rounds"] == 5 else 3, "cls": cls if res["winner"] in "ABD" else None,
                     "winner": res["winner"], "rnd": res["round"], "event": f["event"]})
    T = pd.DataFrame(rows)
    y = MR.outcome_cells(T)
    ok = y >= 0
    Pm = np.stack([MR.expand_cells(mr[i]["S"], R) for i, R in zip(T["id"], T["rounds"])])
    L = {"S": MR.per_fight_losses(Pm[ok], y[ok], T[ok])}
    for k in arms:
        Ps = np.stack([MR.expand_cells(subs[k][i]["cells"], R) for i, R in zip(T["id"], T["rounds"])])
        L[k] = MR.per_fight_losses(Ps[ok], y[ok], T[ok])
    lev, st = MR.cluster_bootstrap(L, T["event"][ok].to_numpy(), B=2000, seed=11)
    out = {"meta": {"tool": "tools/v5_train_ablation_mr.py", "window": "TRAIN %s..%s" % (D0, D1), "n": int(ok.sum()),
                    "scorer": "tools/methodround.py per_fight_losses / cluster_bootstrap / paired_diff (as --score)",
                    "metrics": MR.METRICS},
           "ref": ref, "levels": lev, "vs_S": {}, "vs_all": {}}
    for k in arms:      # vs_all: paired vs the reference arm (named "all" for the main run's reference)
        out["vs_S"][k] = MR.paired_diff(L[k], L["S"], st, MR.METRICS)
        if k != ref:
            out["vs_all"][k] = MR.paired_diff(L[k], L[ref], st, MR.METRICS)
    path = os.path.join(ROOT, "data/derived", "v5_train_ablation_mr%s.json" % tag)
    json.dump(out, open(path, "w"), indent=1)
    print("scored %d train fights; model S joint %.4f, method_round %.4f" % (ok.sum(), lev["S"]["joint"]["mean"], lev["S"]["method_round"]["mean"]))
    for k in arms:
        s = "%-12s joint %.4f method_round %.4f" % (k, lev[k]["joint"]["mean"], lev[k]["method_round"]["mean"])
        if k != ref:
            d = out["vs_all"][k]
            s += "  vs %s:" % ref + " joint %+.4f [%+.4f, %+.4f]  method_round %+.4f [%+.4f, %+.4f]" % (
                d["joint"]["diff"], d["joint"]["ci95"][0], d["joint"]["ci95"][1],
                d["method_round"]["diff"], d["method_round"]["ci95"][0], d["method_round"]["ci95"][1])
        print(s)
    print("wrote", os.path.relpath(path, ROOT))


if __name__ == "__main__":
    main()
