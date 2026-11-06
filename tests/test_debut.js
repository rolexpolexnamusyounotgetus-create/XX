#!/usr/bin/env node
/* tests/test_debut.js: the debut-path JS evaluator (src/ml/debut.js) against tools/debut.py's export.
   node tests/test_debut.js
   1. reproduces Python's production winner probability and P(method | winner) on the exported fixtures (1e-6);
   2. corner symmetry: P(A | A, B) = 1 - P(B | B, A); method rows swap with the corners; whohow sums to 1;
   3. unknown columns enter at the training mean (a side with every column missing = the mean side);
   4. regimes follow the CV-frozen decisions (close never overridden unless CV admitted the debut model). */
"use strict";
const path = require("path");
const fs = require("fs");
const ROOT = path.join(__dirname, "..");
const D = require(path.join(ROOT, "src/ml/debut.js"));
const J = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/debut.json"), "utf8"));
const M = D.load(J.model);
let fails = 0, checks = 0;
function ok(c, msg) { checks++; if (!c) { fails++; console.log("FAIL", msg); } }
const close = (a, b, t) => Math.abs(a - b) <= t;

// 1. fixtures
let maxP = 0, maxM = 0;
for (const fx of J.fixtures) {
  const p = M.winner(fx.A, fx.B);
  maxP = Math.max(maxP, Math.abs(p - fx.p));
  const m = M.method(fx.A, fx.B, fx.bout);
  for (let c = 0; c < 3; c++) {
    maxM = Math.max(maxM, Math.abs(m.A[c] - fx.method_A[c]), Math.abs(m.B[c] - fx.method_B[c]));
  }
}
ok(J.fixtures.length >= 20, "at least 20 fixtures (" + J.fixtures.length + ")");
ok(maxP < 2e-6, "winner reproduces Python (max diff " + maxP.toExponential(2) + ")");
ok(maxM < 2e-6, "method reproduces Python (max diff " + maxM.toExponential(2) + ")");

// 2. symmetry, on fixtures and random sides
let rnd = 12345;
const r = () => { rnd = (rnd * 1103515245 + 12345) % 2147483648; return rnd / 2147483648; };
function randomSide() {
  const s = {};
  for (const k of J.model.winner.cols) s[k] = r() < 0.15 ? null : (r() - 0.5) * 4 + (k === "elo" ? 15 : 0);
  s._n = Math.floor(r() * 4);
  s.debut = s._n === 0 ? 1 : 0;
  for (const k of ["pre_ko", "pre_sub", "pre_kol", "pre_subl"]) s[k] = r() * 0.6;
  for (const k of ["uko_w", "usub_w", "uko_l", "usub_l"]) s[k] = Math.floor(r() * 3);
  s.pav = 1;
  return s;
}
let maxSym = 0, maxMs = 0, maxSum = 0;
const pairs = J.fixtures.map((f) => [f.A, f.B, f.bout]);
for (let i = 0; i < 300; i++) pairs.push([randomSide(), randomSide(), { division: "Lightweight", rounds: r() < 0.2 ? 5 : 3 }]);
for (const [a, b, bout] of pairs) {
  maxSym = Math.max(maxSym, Math.abs(M.winner(a, b) + M.winner(b, a) - 1));
  const m1 = M.method(a, b, bout), m2 = M.method(b, a, bout);
  for (let c = 0; c < 3; c++) maxMs = Math.max(maxMs, Math.abs(m1.A[c] - m2.B[c]), Math.abs(m1.marginal[c] - m2.marginal[c]));
  const s = m1.whohow.A.concat(m1.whohow.B).reduce((x, y) => x + y, 0);
  maxSum = Math.max(maxSum, Math.abs(s - 1));
}
ok(maxSym < 1e-12, "winner corner symmetry (max " + maxSym.toExponential(2) + ")");
ok(maxMs < 1e-12, "method rows swap with the corners (max " + maxMs.toExponential(2) + ")");
ok(maxSum < 1e-12, "who x how sums to 1 (max " + maxSum.toExponential(2) + ")");

// 3. unknown columns = the training mean
const empty = { _n: 0 };
ok(close(M.winner(empty, empty), 0.5, 1e-12), "two unknown sides -> 0.5");
const meanSide = { _n: 0 };
J.model.winner.cols.forEach((k, j) => { meanSide[k] = J.model.winner.mu[j]; });
ok(close(M.winner(meanSide, empty), 0.5, 1e-12), "the mean side equals an unknown side");

// 4. regimes
const sd = J.model.stack_decisions;
const a = J.fixtures[0].A, b = J.fixtures[0].B;
const pr = M.predict(a, b, { division: "Lightweight", rounds: 3, p_close: 0.7, p_open: 0.65 });
if (!sd.close.debut_enters) ok(pr.p_close === 0.7, "close regime keeps the close (CV kept the debut model out)");
else ok(pr.p_close !== 0.7, "close regime stacks the debut model (CV admitted it)");
if (sd.open.debut_enters) ok(Math.abs(pr.p_open - 0.65) > 0 && pr.src_open.indexOf("stack") === 0, "open regime stacks [open, debut]");
else ok(pr.p_open === 0.65, "open regime keeps the opener");
const pr2 = M.predict(b, a, { division: "Lightweight", rounds: 3, p_close: 0.3, p_open: 0.35 });
ok(close(pr.p_open + pr2.p_open, 1, 1e-12) && close(pr.p_noline + pr2.p_noline, 1, 1e-12), "regime outputs are corner-symmetric");
console.log((fails ? "FAILED " : "ok ") + (checks - fails) + "/" + checks + " checks; fixtures " + J.fixtures.length +
  "; winner cols " + J.model.winner.cols.length + "; decisions " + JSON.stringify({ noline: sd.noline, open: sd.open.debut_enters, close: sd.close.debut_enters }));
process.exit(fails ? 1 : 0);
