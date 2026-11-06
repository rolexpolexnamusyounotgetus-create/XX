// Node test for src/ml/ml2.js against the Python reference (tools/ml2.py page_eval) stored in
// data/derived/ml2.json page_model.test_vectors.   Run: node tests/test_ml2.js
"use strict";
const fs = require("fs");
const path = require("path");
const ML2 = require(path.join(__dirname, "..", "src", "ml", "ml2.js"));

const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "derived", "ml2.json"), "utf8"));
const pm = doc.page_model;
let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log("FAIL", msg); } }

const h = ML2.load(pm);
ok(h !== null, "load");
ok(ML2.load(doc) !== null, "load from the whole ml2.json");
let maxd = 0;
for (const tv of pm.test_vectors) {
  const r = h.predict(tv.a, tv.b, tv.fight);
  ok(r !== null, "predict " + tv.a + " vs " + tv.b);
  if (!r) continue;
  const d = Math.abs(r.z - tv.logit);
  maxd = Math.max(maxd, d);
  ok(d < 1e-9, `logit ${tv.a} vs ${tv.b}: js ${r.z} py ${tv.logit}`);
  if (tv.p_stack_noline !== undefined) {
    const rl = h.predict(tv.a, tv.b, tv.fight, tv.p_line);
    ok((tv.p_mr === null && rl.pMR === null) || Math.abs(rl.pMR - tv.p_mr) < 1e-12, `market rating ${tv.a} vs ${tv.b}`);
    ok(Math.abs(rl.pStack - tv.p_stack_noline) < 1e-12, `no-line stack ${tv.a} vs ${tv.b}`);
    ok(Math.abs(rl.pStackLine - tv.p_stack_line) < 1e-12, `line stack ${tv.a} vs ${tv.b}`);
  }
  // corner symmetry: swapping the fighters (and the fight-week flags) gives exactly 1 - p
  const f2 = JSON.parse(JSON.stringify(tv.fight));
  if (f2.fw) f2.fw = { A: f2.fw.B, B: f2.fw.A };
  const s = h.predict(tv.b, tv.a, f2);
  ok(Math.abs(s.pA - (1 - r.pA)) < 1e-12, `symmetry ${tv.a} vs ${tv.b}`);
}
ok(h.predict("no-such-fighter", pm.test_vectors[0].b, pm.test_vectors[0].fight) === null, "unknown fighter -> null");
ok(Math.abs(ML2.ratingProb("elo", 1, { mu: 0.3 }, { mu: -0.2 }) - 1 / (1 + Math.exp(-0.5))) < 1e-15, "elo prob");
ok(Math.abs(ML2.ndtr(0) - 0.5) < 1e-16 && Math.abs(ML2.ndtr(1.959963984540054) - 0.975) < 1e-12, "ndtr");
const vg = pm.test_vectors[0];
console.log(`ML2 page model: ${pm.terms.length} terms, ${Object.keys(pm.roster).length} roster fighters; ` +
            `${vg.a} vs ${vg.b} on ${vg.fight.date}: P(A) = ${vg.pA.toFixed(4)}` +
            (vg.p_stack_noline !== undefined ? `, no-line stack ${vg.p_stack_noline.toFixed(4)}` : ""));
console.log(`max |logit js - py| = ${maxd.toExponential(2)} over ${pm.test_vectors.length} vectors`);
console.log(fails === 0 ? `ok: ${checks} checks` : `${fails} of ${checks} checks FAILED`);
process.exit(fails === 0 ? 0 : 1);
