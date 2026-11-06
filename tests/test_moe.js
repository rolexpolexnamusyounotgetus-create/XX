// Test for src/ml/moe.js: reproduces the Python predictions stored in data/derived/moe.json (test_vectors,
// written by tools/moe.py from 2024-2025 validation rows under every expert-availability pattern and both
// corner orders), checks exact corner symmetry, missing-expert handling, and the helpers.
//
//   node tests/test_moe.js
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const MoE = require(path.join(ROOT, "src/ml/moe.js"));
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/moe.json"), "utf8"));

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}

const prod = MoE.load(doc), val = MoE.load(doc, "model_validated");
check("loads production model", prod.model && prod.model.method, prod.model.method + " over " + prod.model.experts.join(", "));
let maxP = 0, maxV = 0, maxSym = 0;
const tv = doc.test_vectors;
for (let i = 0; i < tv.length; i++) {
  const t = tv[i];
  const a = prod.predict(t), b = val.predict(t);
  maxP = Math.max(maxP, Math.abs(a.p - t.p_prod));
  maxV = Math.max(maxV, Math.abs(b.p - t.p_valid));
  if (i % 2 === 0 && i + 1 < tv.length) {
    const s = prod.predict(tv[i + 1]);
    maxSym = Math.max(maxSym, Math.abs(a.p + s.p - 1));
  }
}
check(`reproduces Python production predictions on ${tv.length} vectors`, maxP < 1e-9, "max |diff| " + maxP.toExponential(2));
check(`reproduces Python validated-model predictions on ${tv.length} vectors`, maxV < 1e-9, "max |diff| " + maxV.toExponential(2));
check("corner swap gives 1 - p", maxSym < 1e-9, "max |p(A,B) + p(B,A) - 1| " + maxSym.toExponential(2));

// alternatives (other stacker families) also evaluate
for (const k of Object.keys(doc.alternatives || {})) {
  const m = MoE.load(doc, k);
  const r = m.predict(tv[0]);
  check(`alternative model '${k}' evaluates`, r.p > 0 && r.p < 1, "p = " + r.p.toFixed(4));
}

// missing experts: every subset that keeps at least one non-market expert must work for the gated model
const g = tv[0].gate, full = { market: 0.62, engine: 0.55, ml: 0.58, feat_lr: 0.58, elo: 0.53 };
const E = prod.model.experts;
let okSub = true, nSub = 0;
for (let mask = 1; mask < (1 << E.length); mask++) {
  const ex = {};
  E.forEach((e, j) => { if (mask & (1 << j)) ex[e] = full[e]; });
  try { const r = prod.predict({ experts: ex, gate: g }); if (!(r.p > 0 && r.p < 1)) okSub = false; nSub++; }
  catch (err) { if (prod.model.method === "gated") okSub = false; }
}
check("any subset of experts evaluates (gated) or fails loudly (linear)", okSub, nSub + " subsets evaluated");

// an all-50% matchup is exactly 50%
const even = prod.predict({ experts: { market: 0.5, engine: 0.5, elo: 0.5, ml: 0.5, feat_lr: 0.5 }, gate: g });
check("all experts at 50% -> 50%", Math.abs(even.p - 0.5) < 1e-12, even.p);

// weights sum to 1 and contributions add up to the logit
const r0 = prod.predict(tv[0]);
const wsum = Object.values(r0.weights).reduce((x, y) => x + y, 0);
const csum = Object.values(r0.contrib).reduce((x, y) => x + y, 0);
check("weights sum to 1", Math.abs(wsum - 1) < 1e-9, wsum);
if (prod.model.method !== "gbm") check("contributions sum to the logit", Math.abs(csum - r0.z) < 1e-9, csum.toFixed(6) + " vs " + r0.z.toFixed(6));

// helpers
check("eloProb symmetric", Math.abs(MoE.eloProb(1600, 1500) + MoE.eloProb(1500, 1600) - 1) < 1e-12);
const pv = MoE.devig(-150, 130), pm = MoE.devig(-150, 130, "mult");
check("devig -150/+130 near 58%", pv > 0.56 && pv < 0.60 && pm > 0.56 && pm < 0.60, "power " + pv.toFixed(4) + ", mult " + pm.toFixed(4));
check("devig symmetric", Math.abs(MoE.devig(-150, 130) + MoE.devig(130, -150) - 1) < 1e-9);

// works inside a Web-Worker-like global (no module/exports)
const src = fs.readFileSync(path.join(ROOT, "src/ml/moe.js"), "utf8");
const ctx = { self: {}, Math, JSON, isFinite, Error };
vm.runInNewContext(src, ctx);
check("UMD: defines self.MoE without module", !!(ctx.self.MoE && ctx.self.MoE.load));
const w = ctx.self.MoE.load(doc).predict(tv[0]);
check("worker-global copy gives the same p", Math.abs(w.p - tv[0].p_prod) < 1e-12);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
