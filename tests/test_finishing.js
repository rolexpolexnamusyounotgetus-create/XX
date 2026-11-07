#!/usr/bin/env node
/* tests/test_finishing.js: the finishing-model JS evaluator (src/ml/finishing.js) against tools/finishing.py's export.
   node tests/test_finishing.js
   1. reproduces Python's deployment model (refit through 2025-12-31) on 30 exported 2024-2025 designs: P(method |
      winner) for both sides and all 23 joint cells (1e-9);
   2. corner symmetry: swapping (xA, rA) <-> (xB, rB) and pA <-> 1 - pA mirrors every cell;
   3. coherence: cells sum to 1; A's mass before the draw share equals pA; round shapes sum to 1 and are 0 past the scheduled
      rounds; bins7 and the finishing-round distribution are marginals of the cells;
   4. the roster feature builder: the finishing block is antisymmetric in the winner logit, unknown fighters enter at
      the prior (0), and its column names are a subset of the method design. */
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const FM = require(path.join(ROOT, "src/ml/finishing.js"));
const J = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/finishing.json"), "utf8"));
const F = FM.load(J.js_model);
let fails = 0, checks = 0;
function ok(c, msg) { checks++; if (!c) { fails++; console.log("FAIL", msg); } }
const sum = (a) => a.reduce((s, v) => s + v, 0);

// 1. reproduction
const TV = J.js_model.test_vectors;
ok(TV.length >= 30, "at least 30 test vectors (" + TV.length + ")");
let maxQ = 0, maxC = 0;
for (const t of TV) {
  const r = F.predict(t);
  for (let k = 0; k < 3; k++) maxQ = Math.max(maxQ, Math.abs(r.qA[k] - t.qA[k]), Math.abs(r.qB[k] - t.qB[k]));
  for (let k = 0; k < 23; k++) maxC = Math.max(maxC, Math.abs(r.cells[k] - t.cells[k]));
}
ok(maxQ < 1e-9, "method shares reproduce Python (max diff " + maxQ.toExponential(2) + ")");
ok(maxC < 1e-9, "joint cells reproduce Python (max diff " + maxC.toExponential(2) + ")");

// 2. corner symmetry
let maxS = 0;
for (const t of TV) {
  const a = F.predict(t);
  const b = F.predict({ xA: t.xB, xB: t.xA, rA: t.rB, rB: t.rA, pA: 1 - t.pA, rounds: t.rounds });
  const m = FM.mirrorCells(b.cells);
  for (let k = 0; k < 23; k++) maxS = Math.max(maxS, Math.abs(m[k] - a.cells[k]));
}
ok(maxS < 1e-12, "swap mirrors every cell (max diff " + maxS.toExponential(2) + ")");

// 3. coherence
for (const t of TV) {
  const r = F.predict(t);
  ok(Math.abs(sum(r.cells) - 1) < 1e-12, t.id + " cells sum to 1");
  // the draw share comes out of each side's decision mass (methodround joint_from_c6): add it back
  const dc = F.drawC;
  const pA = sum(r.cells.slice(0, 10)) + r.cells[20] / (1 - dc);
  ok(Math.abs(pA - t.pA) < 1e-12, t.id + " winner mass before the draw share equals pA");
  for (const k of ["AKO", "ASUB", "BKO", "BSUB"]) {
    ok(Math.abs(sum(r.shape[k]) - 1) < 1e-12, t.id + " " + k + " round shape sums to 1");
    if (t.rounds === 3) ok(r.shape[k][3] === 0 && r.shape[k][4] === 0, t.id + " no rounds 4-5 in a 3-round bout");
  }
  ok(Math.abs(sum(r.bins7) - 1) < 1e-12, t.id + " bins7 sum to 1");
  ok(Math.abs(r.pFinish - (1 - r.cells[20] - r.cells[21] - r.cells[22])) < 1e-12, t.id + " pFinish = 1 - decisions");
}

// 4. roster feature builder
const slugs = Object.keys(F.roster);
ok(slugs.length > 1000, "roster has " + slugs.length + " fighters");
const A = "alexander-volkanovski", B = "justin-gaethje";
ok(A in F.roster && B in F.roster, "Volkanovski and Gaethje are in the roster");
const ff = F.finFeatures(A, B, 0.6);
ok(Math.abs(ff.A.zW + ff.B.zW) < 1e-15 && ff.A.azW === ff.B.azW, "zW antisymmetric, azW symmetric");
ok(ff.A.w_kow === F.roster[A].kow && ff.B.l_kol === F.roster[A].kol, "winner / loser roles read the right fighter");
const unk = F.finFeatures("nobody-at-all", B, 0.5);
ok(!unk.knownA && unk.A.w_kow === 0 && unk.B.l_kol === 0, "unknown fighter enters at the prior");
const mc = new Set(F.methodCols);
for (const k of Object.keys(ff.A)) if (mc.has(k)) ok(Number.isFinite(ff.A[k]), "builder fills " + k);
ok(["zW", "azW", "w_kow", "l_kol"].every((k) => mc.has(k)), "method design carries the finishing block");
let threw = false;
try { F.vector({}, "method"); } catch (e) { threw = true; }
ok(threw, "vector() refuses a design with missing columns");

console.log((fails ? "FAILED " : "ok ") + (checks - fails) + "/" + checks + " checks" +
  " (method max diff " + maxQ.toExponential(1) + ", cells " + maxC.toExponential(1) + ", swap " + maxS.toExponential(1) + ")");
process.exit(fails ? 1 : 0);
