// Node test: the blind-tested stack exported by `python3 tools/blindtest.py export` (data/derived/blindtest_stack.json)
// evaluated with the page's own MoE evaluator (src/ml/moe.js) must reproduce the Python stacker's probabilities.
// v5 merge step 5: the same check for the backtest stacker `python3 tools/blindtest.py export --fit-through 2023-12-31`
// (data/derived/blindtest_stack_pre2024.json, FightEngine.predict with opts.backtest), plus its fit_through guard.
//   node tests/test_blindtest_stack.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const MoE = require(path.join(ROOT, "src/ml/moe.js"));
const FILES = [
  ["data/derived/blindtest_stack.json", "python3 tools/blindtest.py export", null],
  ["data/derived/blindtest_stack_pre2024.json", "python3 tools/blindtest.py export --fit-through 2023-12-31", "2023-12-31"]
];
let any = false, failed = false;
for (const [rel, how, maxFit] of FILES) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) { console.log("skip: " + rel + " missing (" + how + ")"); continue; }
  any = true;
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const Ms = { model: MoE.load(doc) };
  if (doc.model_open) Ms.model_open = MoE.load(doc, "model_open");   // open-trained line weights (blindtest verification)
  let maxd = 0, n = 0, regimeBad = 0, symBad = 0, bad = null;
  const perModel = {};
  for (const v of doc.test_vectors) {
    const key = v.model || "model";
    const M = Ms[key];
    if (!M) { bad = "no block " + key; break; }
    if (key !== "model" && M.model === doc.model) { bad = "MoE.load(doc, '" + key + "') fell back to doc.model"; break; }
    perModel[key] = (perModel[key] || 0) + 1;
    const r = M.predict({ experts: v.experts, gate: {} });
    maxd = Math.max(maxd, Math.abs(r.p - v.p));
    if (r.regime !== v.regime) regimeBad++;
    const sw = {}; for (const k in v.experts) sw[k] = 1 - v.experts[k];
    const r2 = M.predict({ experts: sw, gate: {} });
    if (Math.abs(r.p + r2.p - 1) > 1e-9) symBad++;
    n++;
  }
  if (maxFit) {                                     // the backtest stacker: every block fit on 2023 or earlier
    const fi = (doc.meta && doc.meta.fit_info) || {}, ft = Object.values(fi).map((x) => x.fit_through);
    if (ft.length < 3 || ft.some((d) => !d || d > maxFit)) bad = "fit_info fit_through " + JSON.stringify(ft) + " not all <= " + maxFit;
    if (doc.test_vectors.some((v) => !doc.model_open)) bad = bad || "no model_open block";
  }
  console.log("%s: %d vectors %s, max |p_js - p_py| = %s, regime mismatches %d, corner-swap failures %d%s",
    path.basename(rel), n, JSON.stringify(perModel), maxd.toExponential(2), regimeBad, symBad, bad ? ", " + bad : "");
  if (bad || !n || maxd > 1e-9 || regimeBad || symBad) failed = true;
}
if (!any) process.exit(0);
if (failed) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
