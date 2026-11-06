"""Split the walk-forward backtest into a development file and a sealed vault.

    python3 tools/make_vault.py [--vault-from 2026-01-01] [--vault-dir <dir outside the repo>]

Development: data/derived/backtest_dev.json (everything before --vault-from; tuning uses 2019-2023,
version selection uses 2024-01-01 up to the vault date). The vault file goes to a directory outside the
repository so building and tuning agents never read it; only milestone audits open it.
"""
import argparse, json, os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ap = argparse.ArgumentParser()
ap.add_argument("--vault-from", default="2026-01-01")
ap.add_argument("--vault-dir", default="/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault")
a = ap.parse_args()
src = json.load(open(os.path.join(ROOT, "data/derived/backtest.json")))
dev = [f for f in src["fights"] if f["date"] < a.vault_from]
vault = [f for f in src["fights"] if f["date"] >= a.vault_from]
meta = dict(src.get("meta", {}), split={"dev_until": a.vault_from, "train": "2019-01-01..2023-12-31",
            "validation": "2024-01-01.." + a.vault_from, "vault_from": a.vault_from, "n_dev": len(dev), "n_vault": len(vault)})
json.dump({"meta": meta, "fights": dev}, open(os.path.join(ROOT, "data/derived/backtest_dev.json"), "w"), separators=(",", ":"))
os.makedirs(a.vault_dir, exist_ok=True)
json.dump({"meta": meta, "fights": vault}, open(os.path.join(a.vault_dir, "backtest_vault.json"), "w"), separators=(",", ":"))
print("dev", len(dev), "vault", len(vault), "->", a.vault_dir)
