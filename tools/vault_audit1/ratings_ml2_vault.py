#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): the rating-system features of the FROZEN ML v2 build, extended to the 2026 vault.

    nice -n 5 python3 tools/vault_audit1/ratings_ml2_vault.py --worktree <checkout of commit b9ac8d7> [--vault <dir>]

The ML v2 table (out/ml2_cache/run1/table.pkl, built 16:45 UTC Nov 6) took its z_whr_rounds / z_glicko2 / z_elo_full /
z_trueskill_mov columns from tools/ratings.py and data/derived/ratings.json as they were then (commit b9ac8d7); both changed
later that evening, and today's ratings.json gives different features (up to 0.33 logit). The ML v2 coefficients were fit on
the old features, so the frozen procedure for a 2026 fight is the old code with the old parameters, run over the stream
through 2026-10-31 (pre-fight predictions; no parameter is refit). This script imports ratings.py / build_db.py from a
checkout of b9ac8d7, runs ml2.build_ratings' loop with the cutoff at 2026-11-01, checks that every pre-2026 prediction
equals the frozen out/ml2_cache/ratings_all.pkl, and writes <vault>/audit1/ratings_ml2_vault.pkl (fid, p, rec)."""
import argparse, datetime as dt, json, os, pickle, sys, time
import numpy as np
ap = argparse.ArgumentParser()
ap.add_argument("--worktree", required=True)
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(a.worktree, "tools"))
os.chdir(a.worktree)
import build_db as B  # noqa: E402 (b9ac8d7)
import ratings as RT  # noqa: E402 (b9ac8d7)
assert os.path.dirname(os.path.abspath(RT.__file__)) == os.path.join(os.path.abspath(a.worktree), "tools")
SYSTEMS = ["whr_rounds", "glicko2", "elo_full", "trueskill_mov", "whr_mov", "elo_rounds", "whr_hybrid"]
CUT = dt.date(2026, 11, 1)
t0 = time.time()
D = RT.load_data()
RT.prepare(D, log=lambda s: None)
assert D.day.max() < CUT.toordinal()
J = json.load(open(os.path.join(a.worktree, "data", "derived", "ratings.json")))
ev = np.where(D.day >= dt.date(2009, 1, 1).toordinal())[0]
out = {"fid": list(D.fid), "p": {}, "rec": {}}
for name in SYSTEMS:
    S = J["systems"][name]
    p, rec, _ = RT.run_system(D, S["kind"], S["params"], until=CUT.toordinal(), record=True, eval_idx=ev)
    out["p"][name], out["rec"][name] = p, rec
    print("%s done (%.0f s)" % (name, time.time() - t0), flush=True)
FR = pickle.load(open(os.path.join(ROOT, "out", "ml2_cache", "ratings_all.pkl"), "rb"))
fpos = {f: i for i, f in enumerate(out["fid"])}
chk = {}
for name in SYSTEMS:
    d = [abs(out["p"][name][fpos[f]] - FR["p"][name][i]) for i, f in enumerate(FR["fid"]) if f in fpos and np.isfinite(FR["p"][name][i])]
    chk[name] = {"n": len(d), "max_abs_diff_vs_frozen": float(max(d))}
out["check"] = chk
print(json.dumps(chk))
pickle.dump(out, open(os.path.join(a.vault, "audit1", "ratings_ml2_vault.pkl"), "wb"))
print("wrote ratings_ml2_vault.pkl (%.0f s)" % (time.time() - t0))
