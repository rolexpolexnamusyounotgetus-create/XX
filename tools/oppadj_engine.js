#!/usr/bin/env node
/* Engine-level check for tools/oppadj.py: Monte Carlo winner / method-round probabilities from engine v3 with the
   plain shrunk rates and with the opponent-adjustment factors applied to the same rates (common random numbers:
   both configurations use the same seeds, so the difference is mostly the factors, not sampling noise).

     node tools/oppadj_engine.js <in.json> <out.json> [sims_per_orientation] [part] [parts]

   in:  { priors: {year: {division: priorsObj}}, keys: [...], ml_beta: {family: beta}, fights: [{id, date, division,
          prior_division, rounds, title, A: {snapshot profile..., oppadj: factors}, B: {...},
          ml: {A: [18 ML rates], B: [...]} | null, ml_base: [18 league rates] | null}] }   (built by tools/oppadj.py)
   out: { rows: {id: {plain, adj, ml, ml_adj: {pA, pB, pD, bins, ...}}} }, symmetrised over both corner orders.
   Configurations: plain = engine raw rates; adj = raw rates x oppadj factors; ml = the ML stat-line rates
   (src/ml/mlrates.js applyToMatchup, the v4 rate core) on plain profiles; ml_adj = ML targets x (F_off,X x F_def,Y)^beta
   per family (beta from tools/oppadj.py's stacking fit on 2019-2023), the v5 integration recipe.

   src/engine3.js is not edited: it is loaded from its own text with one line added at the end of fighterRates()
   that applies prof.oppadj (the factor semantics documented in data/derived/oppadj.json meta.factors). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const Module = require("module");
const ROOT = path.resolve(__dirname, "..");
const FILE = path.join(ROOT, "src", "engine3.js");

function loadPatchedEngine() {
  const src = fs.readFileSync(FILE, "utf8");
  const anchor = "    R.cardio = cn ? cs / cn : 1;\n    return R;\n  }";
  if (src.split(anchor).length !== 2) throw new Error("engine3.js fighterRates anchor not found exactly once");
  const hook = "    R.cardio = cn ? cs / cn : 1;\n    if (prof.oppadj) applyOppAdj(R, prof.oppadj);\n    return R;\n  }\n" +
    "  function applyOppAdj(R, F) {\n" +
    "    var ks = ['dAtt','dAttAg','cAtt','cAttAg','gAtt','gAttAg','tdAtt','tdAttAg','ctrl','octrl','topSkill','escWeak','sub','subAg','pow','chin'];\n" +
    "    for (var q = 0; q < ks.length; q++) if (F[ks[q]] != null && isFinite(F[ks[q]])) R[ks[q]] *= F[ks[q]];\n" +
    "    if (F.tdAcc != null) R.tdAcc = clip(prob(odds(R.tdAcc) * F.tdAcc), 0.03, 0.95);\n" +
    "    if (F.tdAccAg != null) R.tdAccAg = clip(prob(odds(R.tdAccAg) * F.tdAccAg), 0.03, 0.95);\n" +
    "    for (var t = 0; t < 3; t++) {\n" +
    "      if (F.acc) { R.accSh[t] += Math.log(F.acc[t]); R.acc[t] = prob(odds(R.acc[t]) * F.acc[t]); }\n" +
    "      if (F.accAg) { R.accAgSh[t] += Math.log(F.accAg[t]); R.accAg[t] = prob(odds(R.accAg[t]) * F.accAg[t]); }\n" +
    "    }\n" +
    "  }";
  const patched = src.replace(anchor, hook);
  const m = new Module(FILE, module);
  m.filename = FILE;
  m.paths = Module._nodeModulePaths(path.dirname(FILE));
  m._compile(patched, FILE);
  return m.exports;
}

function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }

const inp = process.argv[2], outp = process.argv[3];
const SIMS = +(process.argv[4] || 300), PART = +(process.argv[5] || 0), PARTS = +(process.argv[6] || 1);
const E = loadPatchedEngine();
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));
const TN = ML.TNAMES;
function odds(p) { p = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return p / (1 - p); }
function prob(o) { return o / (1 + o); }
function pw(x, b) { return Math.pow(Math.max(x, 1e-6), b); }
function obj(arr) { const o = {}; TN.forEach((k, q) => { o[k] = arr[q]; }); return o; }
// ML targets for attacker i (factors Fi) against j (Fj), scaled by the opponent adjustment
function adjTargets(t, Fi, Fj, bt) {
  const o = Object.assign({}, t);
  const att0 = t.d_att + t.c_att + t.g_att;
  o.d_att = t.d_att * pw(Fi.dAtt * Fj.dAttAg, bt.dAtt);
  o.c_att = t.c_att * pw(Fi.cAtt * Fj.cAttAg, bt.cAtt);
  o.g_att = t.g_att * pw(Fi.gAtt * Fj.gAttAg, bt.gAtt);
  const r = att0 > 0 ? (o.d_att + o.c_att + o.g_att) / att0 : 1;
  o.h_att = t.h_att * r; o.b_att = t.b_att * r; o.l_att = t.l_att * r;
  o.td_att = t.td_att * pw(Fi.tdAtt * Fj.tdAttAg, bt.tdAtt);
  o.sub_att = t.sub_att * pw(Fi.sub * Fj.subAg, bt.sub);
  o.ctrl = t.ctrl * pw(Fi.ctrl * Fj.octrl, bt.ctrl);
  ["acc_h", "acc_b", "acc_l"].forEach((k, q) => { o[k] = prob(odds(t[k]) * pw(Fi.acc[q] * Fj.accAg[q], bt[["accH", "accB", "accL"][q]])); });
  o.td_acc = prob(odds(t.td_acc) * pw(Fi.tdAcc * Fj.tdAccAg, bt.tdAcc));
  o.kd_h = t.kd_h * pw(Fi.pow * Fj.chin, bt.kd);
  return o;
}
const D = JSON.parse(fs.readFileSync(inp, "utf8"));
const keys = D.keys;
const rows = {};
const t0 = Date.now();
let k = 0;
const r4 = (x) => Math.round(x * 1e4) / 1e4;
D.fights.forEach(function (f, idx) {
  if (idx % PARTS !== PART) return;
  if (f.date >= "2026-01-01") throw new Error("vault fight passed to the engine check: " + f.id);
  const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date,
    priors: D.priors[f.date.slice(0, 4)] };
  const out = {};
  const cfgs = f.ml ? ["plain", "adj", "ml", "ml_adj"] : ["plain", "adj"];
  for (const cfg of cfgs) {
    const A = Object.assign({ keys }, f.A), B = Object.assign({ keys }, f.B);
    if (cfg !== "adj") { delete A.oppadj; delete B.oppadj; }
    let s1, s2;
    try {
      const m1 = E.matchup(A, B, o), m2 = E.matchup(B, A, o);
      if (cfg === "ml" || cfg === "ml_adj") {
        let tA = obj(f.ml.A), tB = obj(f.ml.B);
        if (cfg === "ml_adj") {
          const nA = adjTargets(tA, f.A.oppadj, f.B.oppadj, D.ml_beta), nB = adjTargets(tB, f.B.oppadj, f.A.oppadj, D.ml_beta);
          tA = nA; tB = nB;
        }
        ML.applyToMatchup(m1, { A: tA, B: tB, base: f.ml_base }, { engine: E });
        ML.applyToMatchup(m2, { A: tB, B: tA, base: f.ml_base }, { engine: E });
      }
      s1 = E.summarize(m1, SIMS, seedOf(f.id, 1));
      s2 = E.summarize(m2, SIMS, seedOf(f.id, 2));
    } catch (err) { out[cfg] = { err: String(err.message || err) }; continue; }
    const bins = s1.bins.map((x, i) => 0.5 * (x + s2.bins[6 - i]));
    out[cfg] = { pA: r4(0.5 * (s1.pA + s2.pB)), pB: r4(0.5 * (s1.pB + s2.pA)), pD: r4(0.5 * (s1.pD + s2.pD)),
      bins: bins.map(r4),
      sigA: r4(0.5 * (s1.avg.A.sig_lnd + s2.avg.B.sig_lnd)), sigB: r4(0.5 * (s1.avg.B.sig_lnd + s2.avg.A.sig_lnd)),
      tdA: r4(0.5 * (s1.avg.A.td_lnd + s2.avg.B.td_lnd)), tdB: r4(0.5 * (s1.avg.B.td_lnd + s2.avg.A.td_lnd)),
      kdA: r4(0.5 * (s1.avg.A.kd + s2.avg.B.kd)), kdB: r4(0.5 * (s1.avg.B.kd + s2.avg.A.kd)),
      ctrlA: r4(0.5 * (s1.avg.A.ctrl + s2.avg.B.ctrl)), ctrlB: r4(0.5 * (s1.avg.B.ctrl + s2.avg.A.ctrl)) };
  }
  rows[f.id] = out;
  if (++k % 100 === 0) console.error("part " + PART + "/" + PARTS + ": " + k + " fights, " + ((Date.now() - t0) / k).toFixed(0) + " ms/fight");
});
fs.writeFileSync(outp, JSON.stringify({ engine_version: E.VERSION, sims_per_orientation: SIMS, rows: rows }));
console.log("oppadj engine check part " + PART + "/" + PARTS + ": " + k + " fights x up to 4 configs x 2 orientations x " + SIMS +
  " sims in " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
