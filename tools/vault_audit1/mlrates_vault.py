#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): learned stat-line rates (mlrates) for the sealed 2026 fights.

    nice -n 5 python3 tools/vault_audit1/mlrates_vault.py [--vault <dir>]

Builds tools/mlrates.py's own walk-forward dataset with its cutoff moved past the vault (every feature is still
strictly pre-fight: the S sums, Elo, layoff and age are frozen before each fight), keeps the rows dated
2026-01-01..2026-10-31 and evaluates the FROZEN production model data/derived/mlrates.json (trained 2010-2025,
tools/mlrates.py's production export; nothing is refit) with tools/mlrates.py's own model_eta(). Priors: the fight
year's 5-year window (2021-2025 for 2026 fights), as in training. Output: <vault>/audit1/mlrates_vault.json in the
format of data/derived/mlrates_oof.json (src "prod2025"). Never writes inside the repository.
"""
import argparse, datetime as dt, json, os, sys, time
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
os.environ.setdefault("MLRATES_CACHE", "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault/audit1/mlrates_cache")
import numpy as np  # noqa: E402
import mlrates as MR  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
ap.add_argument("--model", default=os.path.join(ROOT, "data/derived/mlrates.json"))
a = ap.parse_args()
VF = json.load(open(os.path.join(a.vault, "backtest_vault.json")))
vids = {f["id"]: f for f in VF["fights"]}
MR.CUTOFF = dt.date(2026, 11, 1)          # include the vault fights in the walk (features stay pre-fight)
t0 = time.time()
rows, priors = MR.build_dataset()
vrows = [r for r in rows if r["date"] >= "2026-01-01"]
assert all(r["date"] < "2026-11-01" for r in vrows)
M = MR.make_matrix(vrows, priors)
J = json.load(open(a.model))
assert J["meta"]["train_years"] == [2010, 2025], J["meta"]["train_years"]
eta, off, comp = MR.model_eta(J, M["X"], M["BASE"])
nt = len(MR.TNAMES)
tab, miss = {}, 0
for k in range(len(eta)):
    r = vrows[M["row"][k]]
    if r["id"] not in vids:
        miss += 1
        continue
    ent = tab.setdefault(r["id"], {"date": r["date"], "src": "prod2025"})
    ent["AB"[M["side"][k]]] = [MR.sig(MR.inv_link(t, eta[k][t]), 5) for t in range(nt)]
# orientation check: the mlrates row's side 0 is the first ufcstats name = backtest A (compare slugs)
bad = [i for i, r in ((r["id"], r) for r in vrows) if i in vids and r["sides"][0].get("slug") not in (vids[i]["A"].get("slug"), None)]
out = {"meta": {"name": "mlrates rates for the 2026 vault fights (audit 1)", "targets": MR.TNAMES,
                "model": os.path.relpath(a.model, ROOT), "model_label": J["meta"]["label"], "train_years": J["meta"]["train_years"],
                "note": "tools/mlrates.py dataset with CUTOFF 2026-11-01 (pre-fight features only), frozen production model, model_eta",
                "n_vault_fights": len(vids), "n_rows": len(tab), "rows_not_in_vault_backtest": miss, "orientation_mismatch": bad[:20],
                "built": dt.datetime.utcnow().isoformat() + "Z", "wall_s": round(time.time() - t0, 1)},
       "fights": tab}
os.makedirs(os.path.join(a.vault, "audit1"), exist_ok=True)
p = os.path.join(a.vault, "audit1", "mlrates_vault.json")
json.dump(out, open(p, "w"), separators=(",", ":"))
print("wrote", p, "fights", len(tab), "of", len(vids), "missing vault ids", len(set(vids) - set(tab)), "orientation mismatches", len(bad))
