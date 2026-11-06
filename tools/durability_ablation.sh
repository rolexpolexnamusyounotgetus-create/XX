#!/usr/bin/env bash
# Run tools/durability_ablation.js in 3 parallel parts (nice 5; the machine is shared), then the report.
#   tools/durability_ablation.sh OUT_DIR [extra run args...]
# e.g. tools/durability_ablation.sh out/dur_ab --sims 250
set -euo pipefail
cd "$(dirname "$0")/.."
OUT="$1"; shift
mkdir -p "$OUT"
PARTS=${PARTS:-3}
for k in $(seq 0 $((PARTS - 1))); do
  nice -n 5 node tools/durability_ablation.js run --part "$k" --parts "$PARTS" --out "$OUT" "$@" > "$OUT/run$k.log" 2>&1 &
done
wait
tail -n 1 "$OUT"/run*.log
nice -n 5 python3 tools/durability_ablation_report.py "$OUT" --boot "${BOOT:-2000}" --base "${BASE:-off}" --vs "${VS:-on}" --json "$OUT/report_${BASE:-off}_vs_${VS:-on}.json" 2>/dev/null | tee "$OUT/report_${BASE:-off}_vs_${VS:-on}.txt"
