// tests/test_ml2trees.js: the v6 JS tree evaluator (src/ml/ml2trees.js) against tools/v6_trees.py's Python references.
//   node tests/test_ml2trees.js
"use strict";
const path = require("path");
const ROOT = path.join(__dirname, "..");
const T = require(path.join(ROOT, "src/ml/ml2trees.js"));
const ML2 = require(path.join(ROOT, "src/ml/ml2.js"));
const doc = require(path.join(ROOT, "data/derived/ml2_trees.json"));
const m2doc = require(path.join(ROOT, "data/derived/ml2.json"));
let fails = 0, checks = 0;
function ok(c, msg) { checks++; if (!c) { fails++; console.log("FAIL", msg); } }
const nan = (a) => a.map((v) => (v === null ? NaN : v));
const h = ML2.load(m2doc);
const M = T.load(doc, h);
// 1) tree evaluation on 40 Python design rows (exported trees evaluated in Python; double sums of float32 leaves)
let e1 = 0;
for (const v of doc.vectors) {
  const r = M.predictRows(nan(v.g0), nan(v.g1));
  e1 = Math.max(e1, Math.abs(r.lgb - v.lgb), Math.abs(r.xgb - v.xgb));
}
ok(e1 <= 1e-9, "tree rows: max |js - py| " + e1);
console.log("tree rows: max |js - py| = " + e1.toExponential(2) + " over " + doc.vectors.length + " vectors");
// 2) matchup terms vs ml.py matchup_features
let e2 = 0;
for (const c of doc.builder.check_matchup) {
  const o = M.matchup(c.fa, c.fb, doc.builder.priors[c.division]);
  for (const k in c.m) if (k in o) e2 = Math.max(e2, Math.abs(o[k] - c.m[k]));
}
ok(e2 <= 1e-9, "matchup: max |js - py| " + e2);
console.log("matchup terms: max |js - py| = " + e2.toExponential(2));
// 3) design rows from their parts vs tools/ml2.py gbm_matrix rows (both orientations)
let e3 = 0, nanBad = 0;
for (const c of doc.builder.check_design) {
  const parts = { sideA: c.sideA, sideB: c.sideB, d: c.d, m: c.m, ctx: c.ctx, ex: c.ex };
  for (const [flip, ref] of [[false, c.g0], [true, c.g1]]) {
    const x = M.designRow(parts, flip);
    ref.forEach((v, i) => {
      if (v === null) { if (!isNaN(x[i])) nanBad++; }
      else e3 = Math.max(e3, Math.abs(x[i] - v));
    });
  }
}
ok(e3 <= 1e-12 && nanBad === 0, "design rows: max |js - py| " + e3 + ", NaN mismatches " + nanBad);
console.log("design rows: max |js - py| = " + e3.toExponential(2) + ", NaN mismatches " + nanBad + " over " + doc.builder.check_design.length + " fights x 2 orientations");
// 4) live roster pairs: corner symmetry and sanity
const slugs = Object.keys(doc.builder.roster_extra).filter((s) => h.has(s)).sort();
let rs = 1; const rnd = () => { rs = (Math.imul(rs, 1664525) + 1013904223) >>> 0; return rs / 4294967296; };
let e4 = 0, n4 = 0;
for (let k = 0; k < 40; k++) {
  const a = slugs[Math.floor(rnd() * slugs.length)], b = slugs[Math.floor(rnd() * slugs.length)];
  if (a === b) continue;
  const fight = { date: "2026-12-12", lbs: [125, 145, 155, 170, 205][k % 5], five: k % 3 === 0 ? 1 : 0, title: k % 7 === 0 ? 1 : 0 };
  const p1 = M.predict(a, b, fight), p2 = M.predict(b, a, fight);
  if (!p1 || !p2) continue;
  n4++;
  e4 = Math.max(e4, Math.abs(p1.p + p2.p - 1), Math.abs(p1.pLgb + p2.pLgb - 1), Math.abs(p1.pXgb + p2.pXgb - 1));
  ok(p1.p > 0 && p1.p < 1 && isFinite(p1.p), "finite p for " + a + " vs " + b);
}
ok(n4 >= 30 && e4 < 1e-12, "corner swap: max |p(A,B) + p(B,A) - 1| " + e4 + " over " + n4 + " pairs");
console.log("corner swap: max |p(A,B) + p(B,A) - 1| = " + e4.toExponential(2) + " over " + n4 + " roster pairs");
const vg = M.predict("alexander-volkanovski", "justin-gaethje", { date: "2026-12-12", lbs: 155, five: 1, title: 0, division: "Lightweight" });
ok(vg && isFinite(vg.p), "Volkanovski vs Gaethje");
if (vg) console.log("Volkanovski vs Gaethje (Dec 12, 2026, 155 lb, 5 rounds): ML v2 logistic " + vg.pLR.toFixed(4) + ", LightGBM " + vg.pLgb.toFixed(4) + ", XGBoost " + vg.pXgb.toFixed(4) + ", blend " + vg.p.toFixed(4));
console.log(fails ? fails + " of " + checks + " checks FAILED" : "ok: " + checks + " checks");
process.exit(fails ? 1 : 0);
