#!/usr/bin/env bash
# Pairwise reports for a tools/durability_ablation.js run directory: DIR base:vs [base:vs ...]
#   tools/durability_ablation_reports.sh out/dur_ab off:on off:on_w0 on_w0:on
set -euo pipefail
cd "$(dirname "$0")/.."
D="$1"; shift
for pair in "$@"; do
  b="${pair%%:*}"; v="${pair##*:}"
  nice -n 5 python3 tools/durability_ablation_report.py "$D" --base "$b" --vs "$v" --boot "${BOOT:-2000}" --json "$D/report_${b}_vs_${v}.json" 2>/dev/null > "$D/report_${b}_vs_${v}.txt"
  echo "== $b vs $v"; head -n 22 "$D/report_${b}_vs_${v}.txt"
done
