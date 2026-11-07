#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): side records for the feature-LR expert (feat_lr) of the frozen stacks, for the 2026 vault.

    nice -n 5 python3 tools/vault_audit1/sides_vault.py [--vault <dir>]

feat_lr (src/ml/moe.js featLR on moe_page.json 'feat') needs, per side, the decayed sums S (backtest_vault.json) plus
career counters (career UFC minutes, W/L, streak, last-3 form, five-rounders, finish wins / losses, layoff). Those are built
here with tools/moe.py cmd_prep's own counter loop (copied verbatim below), walked over every parsed UFC fight in date order,
each record frozen before its fight. Check: the counters of every pre-2026 entry in out/moe_cache/prep.pkl (the frozen moe
build) are reproduced. Output <vault>/audit1/sides_vault.json {fid: {A: {...counters}, B: {...}}}."""
import argparse, json, os, pickle, sys
from collections import defaultdict
import numpy as np
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_db as B  # noqa: E402
import moe as MO  # noqa: E402
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
lg = {}
fights, _ = B.parse_fights(lg)
fights = [f for f in fights if f.date.isoformat() < "2026-11-01"]
people = B.build_people(fights, lg)
B.build_vectors(fights, lg)
_, elo_pre, _ = B.run_elo(fights, MO.ELO_K, MO.ELO_BOOST, store=True)
# ---- verbatim from tools/moe.py cmd_prep ("career counters per person, walk-forward (state before each fight)")
cnt = defaultdict(lambda: {"last": None, "min": 0.0, "n": 0, "w": 0, "l": 0, "streak": 0, "res": [],
                           "n5": 0, "title": 0, "fin_w": 0, "fin_l": 0, "opp_elo": []})
extra = {}
for f in fights:
    a_, b_ = f.persons
    if a_ == b_:
        continue
    rec = {}
    for tag, p, opp in (("A", a_, b_), ("B", b_, a_)):
        c = cnt[p]
        rec[tag] = {"layoff": (f.day - c["last"]) if c["last"] is not None else None,
                    "cmin": c["min"], "cn": c["n"], "w": c["w"], "l": c["l"], "streak": c["streak"],
                    "last3": float(np.mean(c["res"][-3:])) if c["res"] else 0.5, "n5": c["n5"],
                    "titles": c["title"], "fin_w": c["fin_w"], "fin_l": c["fin_l"],
                    "opp_elo": float(np.mean(c["opp_elo"][-5:])) if c["opp_elo"] else None}
    extra[f.fid] = rec
    mins = (f.fight_s or 0) / 60.0
    for s, p in ((0, a_), (1, b_)):
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
# ---- end verbatim
P = pickle.load(open(os.path.join(ROOT, "out", "moe_cache", "prep.pkl"), "rb"))
KEYS = ("layoff", "cmin", "cn", "w", "l", "streak", "last3", "n5", "fin_w", "fin_l")
nchk, worst = 0, 0.0
for e in P["entries"]:
    x = extra.get(e["id"])
    if x is None:
        continue
    for t in ("A", "B"):
        for k in KEYS:
            u, v = e[t].get(k), x[t][k]
            if u is None or v is None:
                worst = max(worst, 0.0 if u is v else 1e9)
            else:
                worst = max(worst, abs(float(u) - float(v)))
            nchk += 1
vf = json.load(open(os.path.join(a.vault, "backtest_vault.json")))["fights"]
out = {f["id"]: extra[f["id"]] for f in vf if f["id"] in extra}
json.dump({"meta": {"tool": "tools/vault_audit1/sides_vault.py", "check_vs_moe_prep": {"values": nchk, "max_abs_diff": worst},
                    "missing": [f["id"] for f in vf if f["id"] not in extra]}, "fights": out},
          open(os.path.join(a.vault, "audit1", "sides_vault.json"), "w"))
print("counters vs out/moe_cache/prep.pkl: %d values, max |diff| %g; vault fights %d of %d" % (nchk, worst, len(out), len(vf)))
