#!/usr/bin/env bash
# VAULT AUDIT 2 (auditor only; second and last opening of the sealed 2026 vault): every number in research/vault_audit_v10.md, in order.
# Reads the vault directory (default below) and audit 1's input builds under <vault>/audit1/ (inputs only: learned rates, priors, SOS
# pairs, the ML v2 feature table, per-fight expert values); writes only under <vault>/audit2/. Run from the repository root:
#   bash tools/vault_audit2/run_all.sh [<vault dir>]
set -euo pipefail
V="${1:-/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault}"
A="$V/audit2"
N="nice -n 5"
mkdir -p "$A"
$N python3 tools/vault_audit2/ml2s2_vault.py --vault "$V"                     # ML v2 production LR + blend (trees refit < 2026), S2 production, S fit 2025
$N node tools/vault_audit2/targets_vault.js --vault "$V"                       # retarget targets from statlines.json models.prod (fit 2019-2025)
$N node tools/vault_audit2/evalv_vault2.js --vault "$V" --mode dev2425 --version v7cmp --engine-dir versions/v7 --split val --sims 300 --workers 3
$N python3 tools/vault_audit2/cmp_stack_2025.py --vault "$V"                   # cmp4's MoE stacker fit through 2025 (reproduces the fit-2023 export first)
$N node tools/vault_audit2/harness_vault.js --vault "$V" --pkg v10=v10-rejected:v10 --pkg cmp4=v7-gate-failed:cmp4 --pkg v6=v6-rejected:v6 \
     --cmp-stacks audit2 --sims 300 --workers 3 --kinds close,open,none --out "$A/harness_vault.json"
$N node tools/vault_audit2/evalv_vault2.js --vault "$V" --mode vault --version v4 --engine-dir versions/v4 --sims 300 --workers 3
$N node tools/vault_audit2/evalv_vault2.js --vault "$V" --mode vault --version v10 --engine-dir versions/v10-rejected --sims 300 --workers 3 --compare v4
$N node tools/vault_audit2/evalv_vault2.js --vault "$V" --mode vault --version v8 --engine-dir versions/v8-gate-failed --sims 300 --workers 3 --compare v4
$N node tools/vault_audit2/stat_vault.js --vault "$V" --engine-dir versions/v10-rejected --sims 300 --workers 3 --seed 10 --arms cmp4,all --out "$A/stat_v10_vault.json"
$N node tools/vault_audit2/stat_vault.js --vault "$V" --engine-dir versions/v8-gate-failed --sims 300 --workers 3 --seed 10 --arms cmp4,all --out "$A/stat_v8_vault.json"
node tools/vault_audit2/decide_vault.js --vault "$V" --new v10 --old v4
node tools/vault_audit2/aux_vault.js --vault "$V"                               # props pool benchmark + cmp4 MoE wiring check
mkdir -p "$A/debut_vroot/audit1" && ln -sf "$V/preufc_vault.json" "$A/debut_vroot/preufc_vault.json"
$N python3 tools/vault_audit1/debut_vault.py --vault "$A/debut_vroot"           # debut method model (frozen, unchanged since audit 1)
$N python3 tools/vault_audit2/score_vault2.py --vault "$V"                      # every table -> <vault>/audit2/score_vault2.json
