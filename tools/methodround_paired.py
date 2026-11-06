#!/usr/bin/env python3
"""methodround_paired.py: paired who x how x when comparison of two engine versions on the same fights.

tools/evalv.js scores each version against methodround model S (`methodround.py --score`) but not against each other.
This script takes the two versions' cell files that evalv.js writes (out/evalv/<version>_<split>_cells.json), scores both
with methodround.py's own per-fight losses on the same fights, and reports the paired difference new - old with the same
event-cluster bootstrap (2,000 draws). It reads stored predictions only (no simulation), so on the validation split it
is part of the version's single look, not a second one.

    python3 tools/methodround_paired.py --new v4.0.1 --old v4 --split val [--out data/derived/evalv/v4.0.1_vs_v4_val_methodround_paired.json]
"""
import argparse
import importlib.util
import json
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("methodround", os.path.join(HERE, "methodround.py"))
mr = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mr)
SPLITS = {"train": ("2019-01-01", "2024-01-01"), "val": ("2024-01-01", "2026-01-01")}


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--new", required=True)
    ap.add_argument("--old", required=True)
    ap.add_argument("--split", default="train", choices=list(SPLITS))
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    d0, d1 = SPLITS[a.split]
    bt = {f["id"]: f for f in json.load(open(os.path.join(ROOT, "data/derived/backtest_dev.json")))["fights"] if f["date"] < "2026-01-01"}
    S = json.load(open(mr.OUT_JSON))["fights"]
    sub = {v: json.load(open(os.path.join(ROOT, "out/evalv", "%s_%s_cells.json" % (v, a.split)))) for v in (a.new, a.old)}
    ids = [i for i in sub[a.new] if i in sub[a.old] and i in bt and i in S and "S" in S[i] and d0 <= bt[i]["date"] < d1]
    rows = []
    for i in ids:
        f = bt[i]; res = f["result"]
        cls = {"KO": "KO", "DOC": "KO", "SUB": "SUB", "UD": "DEC", "SD": "DEC", "MD": "DEC", "DRAW": "DRAW"}.get(res["method"])
        rows.append({"id": i, "rounds": 5 if f["rounds"] == 5 else 3, "cls": cls if res["winner"] in "ABD" else None,
                     "winner": res["winner"], "rnd": res["round"], "event": f["event"]})
    T = pd.DataFrame(rows)
    y = mr.outcome_cells(T)
    ok = y >= 0
    P = {}
    for v in (a.new, a.old, "S"):
        src = (lambda i: S[i]["S"]) if v == "S" else (lambda i, v=v: sub[v][i]["cells"])
        P[v] = np.stack([mr.expand_cells(src(i), R) for i, R in zip(T["id"], T["rounds"])])
    L = {v: mr.per_fight_losses(P[v][ok], y[ok], T[ok]) for v in P}
    _, st = mr.cluster_bootstrap({"x": L[a.new]}, T["event"][ok].to_numpy(), B=2000)
    d = mr.paired_diff(L[a.new], L[a.old], st, mr.METRICS)
    out = {"split": a.split, "n": int(ok.sum()), "new": a.new, "old": a.old, "tool": "tools/methodround_paired.py",
           "metrics": {m: {a.old: float(np.nanmean(L[a.old][m])), a.new: float(np.nanmean(L[a.new][m])), "S": float(np.nanmean(L["S"][m])),
                           "diff": d[m]["diff"], "ci95": d[m]["ci95"]} for m in mr.METRICS if m in d}}
    print("%s - %s on %s (%d fights), paired, event-cluster bootstrap:" % (a.new, a.old, a.split, out["n"]))
    for m, v in out["metrics"].items():
        print("  %-20s %s %.4f  %s %.4f  S %.4f  diff %+.5f [%+.5f, %+.5f]" % (m, a.old, v[a.old], a.new, v[a.new], v["S"], v["diff"], v["ci95"][0], v["ci95"][1]))
    if a.out:
        with open(a.out, "w") as fh:
            json.dump(out, fh, indent=1)
        print("wrote", os.path.relpath(a.out, ROOT))


if __name__ == "__main__":
    main()
