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
check("loads production model", prod.model && prod.model.method, prod.model.method + " over " + prod.model.experts.join(", ") +
  (prod.model.method === "switch" ? ` (market present: ${prod.model.present.method}, absent: ${prod.model.absent.method})` : ""));
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

// missing experts: the four availability patterns the stacker was trained for must evaluate (market and/or
// engine missing); other subsets must evaluate for a gated model and fail loudly for a linear one
const g = tv[0].gate, full = { market: 0.62, mkt_rating: 0.6, engine: 0.55, ml: 0.58, feat_lr: 0.58, elo_sig: 0.56, elo: 0.53 };
const OPT = [].concat.apply([], prod.model.optional_groups || [["market"], ["engine"]]);
const E = prod.model.experts;
let okSub = true, nSub = 0;
for (let mask = 1; mask < (1 << E.length); mask++) {
  const ex = {};
  E.forEach((e, j) => { if (mask & (1 << j)) ex[e] = full[e]; });
  // a trained pattern: all non-optional experts present, and optional groups all-in or all-out
  const core = E.filter((e) => !OPT.includes(e)).every((e) => e in ex) &&
    (prod.model.optional_groups || []).every((gr) => gr.every((e) => e in ex) || gr.every((e) => !(e in ex)));
  try { const r = prod.predict({ experts: ex, gate: g }); if (!(r.p > 0 && r.p < 1)) okSub = false; nSub++; }
  catch (err) { if (core) okSub = false; }
}
check("every trained availability pattern evaluates", okSub, nSub + " of " + ((1 << E.length) - 1) + " subsets evaluate");

// an all-50% matchup is exactly 50%
const even = prod.predict({ experts: { market: 0.5, mkt_rating: 0.5, engine: 0.5, elo: 0.5, ml: 0.5, feat_lr: 0.5, elo_sig: 0.5 }, gate: g });
check("all experts at 50% -> 50%", Math.abs(even.p - 0.5) < 1e-12, even.p);

// weights sum to 1 and contributions add up to the logit
const r0 = prod.predict(tv[0]);
const wsum = Object.values(r0.weights).reduce((x, y) => x + y, 0);
const csum = Object.values(r0.contrib).reduce((x, y) => x + y, 0);
check("weights sum to 1", Math.abs(wsum - 1) < 1e-9, wsum);
if (r0.method !== "gbm") check("contributions sum to the logit", Math.abs(csum - r0.z) < 1e-9, csum.toFixed(6) + " vs " + r0.z.toFixed(6));

// built-in ML expert (feature LR): reproduce Python on validation rows, symmetry, and a live profile matchup
if (doc.feat) {
  let maxF = 0, maxFS = 0;
  for (const t of doc.feat.test_vectors) {
    const p = MoE.featLR(doc.feat, t.A, t.B, { division: t.division, priors: t.priors, coef: "coef_valid" });
    const q = MoE.featLR(doc.feat, t.B, t.A, { division: t.division, priors: t.priors, coef: "coef_valid" });
    maxF = Math.max(maxF, Math.abs(p - t.p_valid));
    maxFS = Math.max(maxFS, Math.abs(p + q - 1));
  }
  check(`featLR reproduces Python on ${doc.feat.test_vectors.length} validation fights`, maxF < 1e-9, "max |diff| " + maxF.toExponential(2));
  check("featLR corner swap gives 1 - p", maxFS < 1e-12, maxFS.toExponential(2));
  const fj = path.join(ROOT, "data/derived/fighters.json");
  if (fs.existsSync(fj)) {
    const db = JSON.parse(fs.readFileSync(fj, "utf8"));
    const o = { keys: db.meta.keys, snapshot: db.meta.snapshot, halfLife: db.meta.half_life_days };
    const A = MoE.sideFromProfile(db.fighters["alexander-volkanovski"], "2026-12-12", o);
    const B = MoE.sideFromProfile(db.fighters["justin-gaethje"], "2026-12-12", o);
    const pml = MoE.featLR(doc.feat, A, B, { division: "Lightweight", homeA: A.home, homeB: B.home });
    const gate = MoE.gateFromSides(A, B, { division: "Lightweight", rounds: 5 });
    const ex = { engine: 0.6, feat_lr: pml, elo: MoE.eloProb(A.elo, B.elo) };
    const mj = path.join(ROOT, "data/derived/market.json");
    if (fs.existsSync(mj)) {
      const MJ = JSON.parse(fs.readFileSync(mj, "utf8")), R = (MJ.ratings && typeof MJ.ratings === "object") ? MJ.ratings : {};
      const ra = R["alexander-volkanovski"], rb = R["justin-gaethje"];
      if (ra && rb) ex.mkt_rating = MoE.ratingProb(ra[0], ra[1], rb[0], rb[1]);
    }
    const r = prod.predict({ experts: ex, gate });
    const rm = prod.predict({ experts: Object.assign({ market: MoE.devig(160, -180) }, ex), gate });
    const fmt = (o) => Object.entries(o).map(([k, v]) => k + " " + v.toFixed(2)).join(", ");
    check("live profiles: Volkanovski vs Gaethje evaluates", pml > 0.05 && pml < 0.95 && r.p > 0 && r.p < 1,
      `featLR ${pml.toFixed(3)}${ex.mkt_rating ? ", market rating " + ex.mkt_rating.toFixed(3) : ""}; MoE (engine 0.60, no line) ` +
      `${r.p.toFixed(3)} [${fmt(r.weights)}]; with line +160/-180 ${rm.p.toFixed(3)} [${fmt(rm.weights)}]`);
    // an untrained pattern (ml without elo_sig) falls back to the largest trained pattern and says so
    const rf = prod.predict({ experts: Object.assign({ ml: 0.6 }, ex), gate });
    check("untrained pattern falls back and reports ignored experts", rf.ignored && rf.ignored.indexOf("ml") >= 0 && rf.p > 0 && rf.p < 1,
      "ignored: " + rf.ignored.join(", "));
  }
}

// helpers
check("ratingProb symmetric", Math.abs(MoE.ratingProb(0.3, 0.5, -0.1, 0.7) + MoE.ratingProb(-0.1, 0.7, 0.3, 0.5) - 1) < 1e-12);
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
