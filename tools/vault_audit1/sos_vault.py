#!/usr/bin/env python3
"""VAULT AUDIT 1 (auditor only): walk-forward strength-of-schedule pairs (tools/sos_wf.py) for the 2026 vault fights.

    nice -n 5 python3 tools/vault_audit1/sos_vault.py [--vault <dir>]

Runs tools/sos_wf.py's own build (the same walk: every pair is frozen before its fight) through 2026-10-31 into
<vault>/audit1/sos_wf_vault.json, carrying the repo file's coefficients (meta.coef = the 2019-2023 fit, meta.coef_loyo)
unchanged. Checks that every pre-2026 pair equals data/derived/sos_wf.json. Never writes inside the repository."""
import argparse, json, os, shutil, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, os.path.join(ROOT, "tools"))
import sos_wf as S  # noqa: E402
ap = argparse.ArgumentParser()
ap.add_argument("--vault", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
out = os.path.join(a.vault, "audit1", "sos_wf_vault.json")
os.makedirs(os.path.dirname(out), exist_ok=True)
repo = os.path.join(ROOT, "data", "derived", "sos_wf.json")
shutil.copyfile(repo, out)                       # cmd_build keeps meta.coef / coef_loyo / fit from the file at OUT_PATH
S.OUT_PATH = out
S.cmd_build(argparse.Namespace(until="2026-11-01", production=True, roster=False, rows=None))
R = json.load(open(repo))
V = json.load(open(out))
assert V["meta"]["coef"] == R["meta"]["coef"]
diff = [k for k, v in R["fights"].items() if V["fights"].get(k) != v]
vb = json.load(open(os.path.join(a.vault, "backtest_vault.json")))["fights"]
miss = [f["id"] for f in vb if f["id"] not in V["fights"]]
print("pre-2026 pairs differing from the repo file:", len(diff), "of", len(R["fights"]), "| vault fights without a pair:", len(miss))
