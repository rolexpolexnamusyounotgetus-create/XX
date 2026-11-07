#!/usr/bin/env bash
# VAULT AUDIT 1 (auditor only): every number in research/vault_audit_v5.md, in order. Reads the sealed vault directory
# (default below); writes only under <vault>/audit1/ (and a throwaway git worktree for the frozen ML v2 rating features).
# Run from the repository root:  bash tools/vault_audit1/run_all.sh [<vault dir>]
set -euo pipefail
V="${1:-/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault}"
WT="$V/audit1/wt_b9ac8d7"
N="nice -n 5"
$N python3 tools/vault_audit1/mlrates_vault.py --vault "$V"            # learned stat-line rates (production mlrates.json, fit 2010-2025)
$N python3 tools/vault_audit1/sos_vault.py --vault "$V"                # SOS walk-forward pairs (v5 engines)
$N node tools/vault_audit1/evalv_vault.js --vault "$V" --version v4 --sims 300 --workers 3
$N node tools/vault_audit1/evalv_vault.js --vault "$V" --version v5 --sims 300 --workers 3 --compare v4
$N node tools/vault_audit1/evalv_vault.js --vault "$V" --version v5.0.1 --sims 300 --workers 3 --compare v4
test -d "$WT" || git worktree add --detach "$WT" b9ac8d7
ln -sf "$PWD/data/derived/backtest.json" "$WT/data/derived/backtest.json"   # dev-only file, gitignored (ids for ratings.py)
$N python3 tools/vault_audit1/ratings_ml2_vault.py --vault "$V" --worktree "$WT"
$N python3 tools/vault_audit1/ml2_vault.py --vault "$V"                # ML v2 logistic (prod / static), static blend, S / S2 / S2+ml2win cells
$N python3 tools/vault_audit1/sides_vault.py --vault "$V"              # feat_lr side counters
node tools/vault_audit1/models_vault.js --vault "$V"                   # every frozen winner model and stack
node tools/vault_audit1/predict_vault.js --vault "$V"                  # predict() package, v4 base
node tools/vault_audit1/props_vault.js --vault "$V"                    # props pool vs S2 at the same winner
$N python3 tools/vault_audit1/debut_vault.py --vault "$V"              # debut method model on 2026 debut bouts
node tools/vault_audit1/decide_vault.js --vault "$V" --new v5 --old v4
node tools/vault_audit1/decide_vault.js --vault "$V" --new v5.0.1 --old v4
$N python3 tools/vault_audit1/score_vault.py --vault "$V"              # all metrics, CIs, paired differences, drift rule, base rates
git worktree remove --force "$WT"
