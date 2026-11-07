#!/usr/bin/env node
/* v8_targets.js: per-fight retarget targets for engine v8 (components.retarget), computed with the shipped evaluator
   src/ml/statdist.js (StatDist.engineTargets) from the leak-free fold tables of tools/v8_statlines_folds.py.

   Target = the statlines layer's expected per-minute rate of every stat for each fighter at full length (t = 5 x rounds,
   the went-the-distance condition), in backtest_dev's corner order. The engine compares it with its own realised per-minute
   rates in the pilot simulations that went the distance (like for like: research/model_statlines.md, verifier's correction 4).
   Model set per fight year: f2020 (fit 2019), f2021 (2019-20), f2022 (2019-21), f2023 (2019-22), dev (2019-2023) for 2024-2025.
   2019 fights have no table (null): the retarget is off for them. 2026 is refused.

     node tools/v8_targets.js [--check]      -> data/derived/v8/statlines_targets.json */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const SD0 = require(path.join(ROOT, "src/ml/statdist.js"));
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const FOLDS = J("data/derived/v8/statlines_folds.json"), INP = J("data/derived/v8/statlines_inputs.json");
const handles = {};
function sd(which) { if (!handles[which]) handles[which] = SD0.load(FOLDS, { which, enable: true }); return handles[which]; }
function targetsFor(v) {
  const SD = sd(v.fold);
  const P = SD.prepare({ mlA: v.mlA, mlB: v.mlB, etaA: v.etaA, etaB: v.etaB, hasEmb: v.hasEmb, winLogit: v.winLogit, oppA: v.oppA, oppB: v.oppB, rounds: v.rounds });
  return SD.engineTargets(P, 5 * (v.rounds === 5 ? 5 : 3));
}
const out = {}, r6 = (x) => Math.round(x * 1e6) / 1e6;
let nNull = 0, worst = 0, nRef = 0;
for (const [id, v] of Object.entries(INP.fights)) {
  if (v.date >= "2026-01-01") throw new Error("v8_targets: refusing a 2026 fight " + id);
  if (!v.fold) { out[id] = { date: v.date, fold: null, rounds: v.rounds }; nNull++; continue; }
  const T = targetsFor(v);
  const ref = INP.python_ref[id];
  if (ref) for (const s of ["A", "B"]) for (const k in ref[s]) { worst = Math.max(worst, Math.abs(T[s][k] - ref[s][k]) / Math.max(1e-9, Math.abs(ref[s][k]))); nRef++; }
  const o = { date: v.date, fold: v.fold, rounds: v.rounds, A: {}, B: {} };
  for (const s of ["A", "B"]) for (const k in T[s]) o[s][k] = r6(T[s][k]);
  out[id] = o;
}
console.log(`targets: ${Object.keys(out).length} fights (${nNull} without a table: 2019); JS engineTargets vs Python py_eval on ${nRef} values: max relative difference ${worst.toExponential(2)}`);
if (worst > 1e-9) { console.error("v8_targets: JS / Python mismatch"); process.exit(1); }
fs.writeFileSync(path.join(ROOT, "data/derived/v8/statlines_targets.json"), JSON.stringify({
  meta: { tool: "tools/v8_targets.js", built: new Date().toISOString(), evaluator: "src/ml/statdist.js StatDist.engineTargets(P, 5R)",
    what: "per-minute expected rates at full length (t = 5 x rounds) per fighter, backtest_dev orientation; engine v8 retarget targets",
    folds: FOLDS.meta.fold_of_year, no_table: "2019 fights (fold null): retarget off", js_vs_python_max_rel: worst, n_checked: nRef },
  fights: out }));
console.log("wrote data/derived/v8/statlines_targets.json");
