#!/usr/bin/env python3
"""ko_composition.py: the self-calibration's KO/TKO composition targets from TRAIN-era fights only (v5 merge step 1, item e).

tests/test_engine3.js --fit aims three composition shares of strike KO/TKOs: ground finishes, clinch finishes, and standing
stoppages without a knockdown. Through engine v4 they were 28% / 12.5% / 7%, read off the all-years base-rate table
(data/derived/baserates_tables.md: ufcstats fights 2015-01-01..2026-10-31, i.e. validation years and the vault). This script
recomputes them with the same parsers (tools/baserates.py load_data / parse_ko_detail / kd_block definitions) on fights
dated before 2024-01-01 only. The fight table is cut right after loading, before any statistic is computed, so no 2024+
row enters any number here (the same pattern as tools/judge_em_train.py).

Definitions (strike KO/TKOs: METHOD KO/TKO with a strike detail, i.e. not doctor / corner / injury stoppages):
  ground, clinch      share of strike KO/TKOs whose finishing position is "From <ground position>" / "On Ground", or
                      "In Clinch" (ufcstats detail string). The engine's koLoc ground / clinch share.
  standNoKd (direct)  share of strike KO/TKOs (fights with complete round stats) finished at distance or in the clinch
                      with no knockdown by the winner in the final round. The engine's koKind TKO_standing share.
  standNoKd (v4 formula, for reference) = (standing KO without KD per 100 standing head landed) / (standing KO per 100
                      standing head landed) x standing share, the arithmetic behind the old 7% (Lightweight row).

    python3 tools/ko_composition.py [--windows 2019-01-01:2024-01-01,2015-01-01:2024-01-01] [--out data/derived/ko_composition_pre2024.json]
The first window is the one the engine adopts (the train years of the hidden-data protocol); the others are reported for
robustness.
"""
import argparse
import importlib.util
import json
import math
import os

import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
spec = importlib.util.spec_from_file_location("baserates", os.path.join(HERE, "baserates.py"))
br = importlib.util.module_from_spec(spec)
spec.loader.exec_module(br)


def wilson(k, n, z=1.96):
    if n <= 0:
        return [None, None]
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return [round(c - h, 4), round(c + h, 4)]


def shares(F, S, label):
    k = F[(F.cat == "KO/TKO") & (F.ko_kind == "strikes")]
    n = len(k)
    out = {"label": label, "n_fights": int(len(F)), "n_ko_strikes": int(n)}
    for pos in ["distance", "clinch", "ground", "unknown"]:
        c = int((k.ko_pos == pos).sum())
        out[pos] = {"n": c, "share": round(c / n, 4) if n else None, "ci95": wilson(c, n)}
    # direct standing-without-KD share: final round of the winner, complete round stats
    ks = k[k.has_stats]
    fr = S[(S.rnd == S.end_round) & (S.idx == S.winner) & (S.cat == "KO/TKO") & (S.ko_kind == "strikes")]
    fr = fr[fr.fid.isin(set(ks.fid))]
    nk = len(fr)
    st_nokd = int(((fr.kd == 0) & fr.ko_pos.isin(["distance", "clinch"])).sum())
    out["standNoKd_direct"] = {"n": st_nokd, "of": int(nk), "share": round(st_nokd / nk, 4) if nk else None, "ci95": wilson(st_nokd, nk)}
    # the v4 formula (per-100 ratio x standing share), from tools/baserates.py kd_block definitions
    kb = br.kd_block(S, F)
    st = kb["standing_ko_per100_standing_head_landed"]
    nk_ = kb["standing_ko_without_kd_per100_standing_head_landed"]
    stand_share = (out["distance"]["n"] + out["clinch"]["n"]) / n if n else None
    out["standNoKd_v4_formula"] = {"per100_standing_ko": round(st, 4), "per100_standing_ko_without_kd": round(nk_, 4),
                                   "standing_share": round(stand_share, 4) if stand_share else None,
                                   "share": round(nk_ / st * stand_share, 4) if st and stand_share else None}
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--raw", default=os.path.join(ROOT, "data", "raw"))
    ap.add_argument("--windows", default="2019-01-01:2024-01-01,2015-01-01:2024-01-01")
    ap.add_argument("--out", default=os.path.join(ROOT, "data", "derived", "ko_composition_pre2024.json"))
    a = ap.parse_args()
    wins = [w.split(":") for w in a.windows.split(",")]
    if any(u > "2024-01-01" for _, u in wins):
        raise SystemExit("ko_composition: windows must end by 2024-01-01 (hidden-data protocol)")
    since_min = min(s for s, _ in wins)
    F0, S0, notes, _ = br.load_data(a.raw, since_min)
    F0 = F0[F0.DATE < pd.Timestamp("2024-01-01")].copy()       # hidden-data protocol: nothing from 2024-01-01 on
    S0 = S0[S0.fid.isin(set(F0.fid))].copy()
    res = []
    for s, u in wins:
        F = F0[(F0.DATE >= pd.Timestamp(s)) & (F0.DATE < pd.Timestamp(u))]
        S = S0[S0.fid.isin(set(F.fid))]
        r = shares(F, S, "All UFC %s..%s" % (s, u))
        r["since"], r["until"], r["date_max_used"] = s, u, str(F.DATE.max().date())
        lw = F.division == "Lightweight"
        rl = shares(F[lw], S[S.fid.isin(set(F[lw].fid))], "Lightweight %s..%s" % (s, u))
        r["lightweight"] = {k: rl[k] for k in ("n_ko_strikes", "ground", "clinch", "standNoKd_direct", "standNoKd_v4_formula")}
        res.append(r)
    w0 = res[0]
    targets = {"ground": w0["ground"]["share"], "clinch": w0["clinch"]["share"], "standNoKd": w0["standNoKd_direct"]["share"]}
    out = {"meta": {"tool": "tools/ko_composition.py", "adopted_window": "%s..%s" % (wins[0][0], wins[0][1]),
                    "notes": notes, "v4_targets": {"ground": 0.28, "clinch": 0.125, "standNoKd": 0.07},
                    "v4_source": "data/derived/baserates_tables.md, All UFC 2015-01-01..2026-10-31 (ground 27.5%, clinch 12.3%; "
                                 "standNoKd 0.049 / 0.509 per 100 standing head landed x ~72% standing share, Lightweight row)"},
           "targets": targets, "windows": res}
    out = br.clean(out)
    with open(a.out, "w") as fh:
        json.dump(out, fh, indent=1)
    for r in res:
        print("%-28s n=%4d  ground %.1f%% [%s]  clinch %.1f%% [%s]  standNoKd direct %.1f%% [%s] (n=%d)  v4-formula %.1f%%  |  LW n=%d ground %.1f%% clinch %.1f%% standNoKd %.1f%%" % (
            r["label"], r["n_ko_strikes"], 100 * r["ground"]["share"], "-".join("%.1f" % (100 * x) for x in r["ground"]["ci95"]),
            100 * r["clinch"]["share"], "-".join("%.1f" % (100 * x) for x in r["clinch"]["ci95"]),
            100 * r["standNoKd_direct"]["share"], "-".join("%.1f" % (100 * x) for x in r["standNoKd_direct"]["ci95"]), r["standNoKd_direct"]["of"],
            100 * r["standNoKd_v4_formula"]["share"], r["lightweight"]["n_ko_strikes"], 100 * r["lightweight"]["ground"]["share"],
            100 * r["lightweight"]["clinch"]["share"], 100 * r["lightweight"]["standNoKd_direct"]["share"]))
    print("adopted targets (%s): %s" % (out["meta"]["adopted_window"], json.dumps(targets)))
    print("wrote", os.path.relpath(a.out, ROOT))


if __name__ == "__main__":
    main()
