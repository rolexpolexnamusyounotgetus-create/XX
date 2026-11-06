// Node test: the blind-tested stack exported by `python3 tools/blindtest.py export` (data/derived/blindtest_stack.json)
// evaluated with the page's own MoE evaluator (src/ml/moe.js) must reproduce the Python stacker's probabilities.
//   node tests/test_blindtest_stack.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const MoE = require(path.join(ROOT, "src/ml/moe.js"));
const file = path.join(ROOT, "data/derived/blindtest_stack.json");
if (!fs.existsSync(file)) { console.log("skip: " + file + " missing (python3 tools/blindtest.py export)"); process.exit(0); }
const doc = JSON.parse(fs.readFileSync(file, "utf8"));
const M = MoE.load(doc);
let maxd = 0, n = 0, regimeBad = 0, symBad = 0;
for (const v of doc.test_vectors) {
  const r = M.predict({ experts: v.experts, gate: {} });
  maxd = Math.max(maxd, Math.abs(r.p - v.p));
  if (r.regime !== v.regime) regimeBad++;
  const sw = {}; for (const k in v.experts) sw[k] = 1 - v.experts[k];
  const r2 = M.predict({ experts: sw, gate: {} });
  if (Math.abs(r.p + r2.p - 1) > 1e-9) symBad++;
  n++;
}
console.log("blindtest stack: %d vectors, max |p_js - p_py| = %s, regime mismatches %d, corner-swap failures %d",
  n, maxd.toExponential(2), regimeBad, symBad);
if (!n || maxd > 1e-9 || regimeBad || symBad) { console.error("FAIL"); process.exit(1); }
console.log("PASS");
