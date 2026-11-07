#!/usr/bin/env python3
"""v10_look_secondaries.py: the pre-registered SECONDARIES of the v10 look that tools/v10_gate.py look does not compute
(version_history.json v10 prereg 'secondaries_reported_never_decisive'). Never decisive; run after the look's decision was scored,
on the same two binding harness files, with no new simulation:

    python3 tools/v10_look_secondaries.py data/derived/v10/look_val.json data/derived/v10/look_stat_val.json \
        --gate data/derived/v10/gate_train_score.json --out data/derived/v10/look_val_secondaries.json

- who x how x when (and the other methodround yardsticks) vs model S per regime, through tools/methodround.py --score (the package
  with props for v10, cmp4's package), as the gate's descriptive block did on 2021-2023;
- engine level, arm 'all' (v10 simulator) minus arm 'cmp4' (v4 simulator) on the stat harness: per-stat Poisson deviance and MAE,
  engine winner / 7-bin / method, PIT coverage and the stat-line base rates of each arm.
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
import v10_gate as V  # noqa: E402

G7, G8, PS = V.G7, V.G8, V.PS
YEARS = V.LOOK_YEARS


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("harness")
    ap.add_argument("stat")
    ap.add_argument("--gate", required=True)
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    D = json.load(open(a.harness))
    recs = D["fights"]
    assert all("2024-01-01" <= r["date"] < "2026-01-01" for r in recs), "the look reads 2024-2025 only"
    G = json.load(open(a.gate))
    w10, wc = G["fits"]["w"]["v10"]["fit_2019_2023"]["w"], G["fits"]["w"]["cmp4"]["fit_2019_2023"]["w"]
    pi = G["fits"]["pi"]["fit_2021_2023"]["pi"]
    fits = {"w": {"v10": {str(y): {"w": w10} for y in YEARS}, "cmp4": {str(y): {"w": wc} for y in YEARS}},
            "pi": {str(y): {"pi": pi} for y in YEARS}}
    out = {"meta": {"tool": "tools/v10_look_secondaries.py", "note": "pre-registered secondaries of the v10 look; never decisive; computed after "
                    "the decision was scored, from the same binding harness files (no new simulation)", "harness": os.path.relpath(a.harness, ROOT),
                    "stat": os.path.relpath(a.stat, ROOT), "weights": {"w_v10": w10, "w_cmp4": wc, "pi": pi}, "boot": dict(PS.BOOT)}}
    mr = {}
    for kind in ("none", "open", "close"):
        rk = V.pkg_rows(recs, kind, [("v10", "v10", "pkg"), ("cmp4", "cmp4", "cmp")], fits, YEARS)
        mr[kind] = {"n": len(rk), **{nm: G7.methodround_cells(rk, nm, "2024-01-01", "2026-01-01") for nm in ("v10", "cmp4")}}
    out["methodround_vs_S_package_with_props"] = mr

    Hs = json.load(open(a.stat))
    Fs = [f for f in Hs["fights"] if not f.get("err")]
    assert all("2024-01-01" <= f["date"] < "2026-01-01" for f in Fs)
    # smoothing prior from the gate's TRAIN stat harness (v10 review fix; the stored v10 secondaries predate it: weight 1/601)
    _, Fbase = G8.load(os.path.join(ROOT, G["meta"]["stat_harness"]), V.YEARS)
    arms, Ls, groups = G8.table(Hs, Fs, base_fights=Fbase)
    norm = {s: float(np.nanmean(G8.col(Ls["cmp4"], "dev_" + s))) for s in G8.STATS}
    keys = ["total", "total_raw", "winLL", "bin7", "method"] + ["dev_" + s for s in G8.STATS] + ["mae_" + s for s in G8.STATS]
    out["engine_all_vs_cmp4"] = G8.paired(groups, Ls["all"], Ls["cmp4"], keys, norm)
    out["engine_norm_dev_cmp4"] = norm
    out["engine_levels"] = {arm: {"dev": {s: round(float(np.nanmean(G8.col(Ls[arm], "dev_" + s))), 4) for s in G8.STATS},
                                  "mae": {s: round(float(np.nanmean(G8.col(Ls[arm], "mae_" + s))), 4) for s in G8.STATS},
                                  "winLL": round(float(np.nanmean(G8.col(Ls[arm], "winLL"))), 5), "bin7": round(float(np.nanmean(G8.col(Ls[arm], "bin7"))), 5),
                                  "method": round(float(np.nanmean(G8.col(Ls[arm], "method"))), 5), "pit": G8.pit_summary(Ls[arm]),
                                  "base_rates": G8.base_rates(Ls[arm])} for arm in arms}
    json.dump(out, open(a.out, "w"), indent=1, default=float)
    brief = {kind: {nm: {k: (v.get("diff"), v.get("ci95")) for k, v in (mr[kind][nm].get("metrics") or {}).items() if k in ("joint", "method3", "bin7")}
                    for nm in ("v10", "cmp4")} for kind in mr}
    print(json.dumps(brief, indent=1))
    print(json.dumps({k: (out["engine_all_vs_cmp4"][k]["diff"], out["engine_all_vs_cmp4"][k]["ci"]) for k in keys}, indent=0))


if __name__ == "__main__":
    main()
