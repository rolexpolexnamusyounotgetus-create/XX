#!/usr/bin/env node
/* v8_targets.js: per-fight retarget targets for engine v8 (components.retarget), computed with the shipped evaluator
   src/ml/statdist.js (StatDist.engineTargets and P.dist) from the leak-free fold tables of tools/v8_statlines_folds.py.

   Targets, in backtest_dev's corner order: (1) A / B: the statlines layer's expected per-minute rate of every stat at full
   length (t = 5 x rounds, the went-the-distance condition; StatDist.engineTargets); (2) fin: the expected totals of a fight
   STOPPED at minute t on a fixed grid (P.dist(side, stat, t).mean with the finished flag on), interpolated log-log by the
   engine. The engine's pilot compares each simulated fight with the statlines mean at that fight's own length and finished
   status (like for like: research/model_statlines.md, verifier's correction 4), summed over its pilot simulations.
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
// finished-fight grid (minutes; every point < 5R - 1/60, so the finished flag is on)
const GRID = { 3: [0.5, 1, 2, 3.5, 5, 7, 9, 11, 13, 14.9], 5: [0.5, 1, 2, 3.5, 5, 7.5, 10, 13, 16, 19, 22, 24.9] };
const FIN_ST = ["d_att", "c_att", "g_att", "d_lnd", "c_lnd", "g_lnd", "h_att", "b_att", "l_att", "h_lnd", "b_lnd", "l_lnd", "td_att", "ctrl", "td_lnd"];
function targetsFor(v) {
  const SD = sd(v.fold), R = v.rounds === 5 ? 5 : 3;
  const P = SD.prepare({ mlA: v.mlA, mlB: v.mlB, etaA: v.etaA, etaB: v.etaB, hasEmb: v.hasEmb, winLogit: v.winLogit, oppA: v.oppA, oppB: v.oppB, rounds: v.rounds });
  const T = SD.engineTargets(P, 5 * R);
  T.fin = { t: GRID[R], A: {}, B: {} };
  for (const s of ["A", "B"]) for (const k of FIN_ST) T.fin[s][k] = GRID[R].map((t) => P.dist(s, k, t).mean);
  return T;
}
const g5 = (x) => +x.toPrecision(6);
const out = {}, r6 = (x) => Math.round(x * 1e6) / 1e6;
let nNull = 0, worst = 0, nRef = 0;
for (const [id, v] of Object.entries(INP.fights)) {
  if (v.date >= "2026-01-01") throw new Error("v8_targets: refusing a 2026 fight " + id);
  if (!v.fold) { out[id] = { date: v.date, fold: null, rounds: v.rounds }; nNull++; continue; }
  const T = targetsFor(v);
  const ref = INP.python_ref[id];
  if (ref) for (const s of ["A", "B"]) for (const k in ref[s]) { worst = Math.max(worst, Math.abs(T[s][k] - ref[s][k]) / Math.max(1e-9, Math.abs(ref[s][k]))); nRef++; }
  const o = { date: v.date, fold: v.fold, rounds: v.rounds, A: {}, B: {}, fin: { t: T.fin.t, A: {}, B: {} } };
  for (const s of ["A", "B"]) for (const k in T[s]) o[s][k] = r6(T[s][k]);
  for (const s of ["A", "B"]) for (const k in T.fin[s]) o.fin[s][k] = T.fin[s][k].map(g5);
  out[id] = o;
}
console.log(`targets: ${Object.keys(out).length} fights (${nNull} without a table: 2019); JS engineTargets vs Python py_eval on ${nRef} values: max relative difference ${worst.toExponential(2)}`);
if (worst > 1e-9) { console.error("v8_targets: JS / Python mismatch"); process.exit(1); }
fs.writeFileSync(path.join(ROOT, "data/derived/v8/statlines_targets.json"), JSON.stringify({
  meta: { tool: "tools/v8_targets.js", built: new Date().toISOString(), evaluator: "src/ml/statdist.js StatDist.engineTargets(P, 5R)",
    what: "per fighter, backtest_dev orientation: A / B = per-minute expected rates at full length (t = 5 x rounds); fin = expected totals of a fight stopped at minute t on the grid fin.t (6 significant digits); engine v8 retarget targets",
    folds: FOLDS.meta.fold_of_year, no_table: "2019 fights (fold null): retarget off", js_vs_python_max_rel: worst, n_checked: nRef },
  fights: out }));
console.log("wrote data/derived/v8/statlines_targets.json");
