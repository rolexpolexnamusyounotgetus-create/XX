// Node test for src/ml/propspool.js against tools/props.py (data/derived/props.json test vectors).
// Run: node tests/test_propspool.js
"use strict";
const path = require("path");
const PP = require(path.join(__dirname, "..", "src", "ml", "propspool.js"));
const J = require(path.join(__dirname, "..", "data", "derived", "props.json"));

let fails = 0, checks = 0;
function close(a, b, tol, what) {
  checks++;
  const flat = (x) => (Array.isArray(x) ? x.flat(Infinity) : [x]);
  const A = flat(a), B = flat(b);
  if (A.length !== B.length) { fails++; console.log("FAIL length", what, A.length, B.length); return; }
  for (let i = 0; i < A.length; i++) {
    if (A[i] === null && B[i] === null) continue;
    if (!(Math.abs(A[i] - B[i]) <= tol)) { fails++; console.log("FAIL", what, i, A[i], B[i]); return; }
  }
}
function ok(cond, what) { checks++; if (!cond) { fails++; console.log("FAIL", what); } }

const pool = PP.create(J.model);
ok(J.test_vectors.length >= 20, "test vectors present");

// 1) raw books -> families -> consensus -> pooled conditionals -> 23 cells, identical to Python
let maxCell = 0;
for (const tv of J.test_vectors) {
  const fams = {};
  for (const [bk, d] of Object.entries(tv.books)) fams[bk] = PP.bookFamilies(d, tv.K, tv.swap, J.model.over_max);
  const cons = PP.consensus(fams, J.model.outlier_max_dev);
  for (const k of ["m6", "gd", "er", "wr", "mr"]) {
    if (tv.expect[k] === null || tv.expect[k] === undefined) ok(cons[k] === undefined, tv.fid + " " + k + " absent");
    else close(cons[k], tv.expect[k], 1e-9, tv.fid + " " + k);
  }
  ok(JSON.stringify(cons.n_books) === JSON.stringify(tv.expect.n_books) ||
     Object.keys(tv.expect.n_books).every((k) => cons.n_books[k] === tv.expect.n_books[k]), tv.fid + " n_books");
  const out = pool.predict({ pA: tv.pA, pModel: tv.pModel, rounds: tv.K, model: tv.model, books: tv.books, swap: tv.swap,
                             params: tv.params });
  close(out.M, tv.expect.M, 1e-9, tv.fid + " M");
  close(out.R, tv.expect.R, 1e-12, tv.fid + " R");
  close(out.cells, tv.expect.cells, 1e-9, tv.fid + " cells");
  for (let i = 0; i < 23; i++) maxCell = Math.max(maxCell, Math.abs(out.cells[i] - tv.expect.cells[i]));
  ok(out.source.startsWith("pool"), tv.fid + " source " + out.source);
  // the winner stays bit-identical: P(A) / (P(A) + P(B)) = pA
  const pm = out.p_method, pa = pm.a_ko + pm.a_sub + pm.a_dec, pb = pm.b_ko + pm.b_sub + pm.b_dec;
  close(pa / (pa + pb), tv.pA, 1e-12, tv.fid + " winner identity");
  close(out.cells.reduce((s, x) => s + x, 0), 1, 1e-12, tv.fid + " sums to 1");
}

// 2) corner swap: every input swapped -> the cells mirror exactly
function mirror(P) {
  const Q = P.slice();
  for (let r = 0; r < 5; r++) { Q[r] = P[10 + r]; Q[10 + r] = P[r]; Q[5 + r] = P[15 + r]; Q[15 + r] = P[5 + r]; }
  Q[20] = P[21]; Q[21] = P[20];
  return Q;
}
let maxSwap = 0;
for (const tv of J.test_vectors) {
  const a = pool.predict({ pA: tv.pA, pModel: tv.pModel, rounds: tv.K, model: tv.model, books: tv.books, swap: tv.swap });
  const b = pool.predict({ pA: 1 - tv.pA, pModel: 1 - tv.pModel, rounds: tv.K,
                           model: { M: [tv.model.M[1], tv.model.M[0]], R: [tv.model.R[1], tv.model.R[0]] },
                           books: tv.books, swap: !tv.swap });
  const m = mirror(b.cells);
  for (let i = 0; i < 23; i++) maxSwap = Math.max(maxSwap, Math.abs(m[i] - a.cells[i]));
}
ok(maxSwap < 1e-12, "corner swap max " + maxSwap);

// 3) degrade: no props -> the model package composed with pA, unchanged; method props only -> rounds from the model
const tv0 = J.test_vectors[0];
const none = pool.predict({ pA: tv0.pA, rounds: tv0.K, model: tv0.model });
close(none.cells, PP.compose(tv0.pA, tv0.model.M, tv0.model.R, tv0.K, J.model.draw_c), 1e-15, "no props = identity");
ok(none.source === "model (no method props)", "no-props source");
const noM6 = pool.predict({ pA: tv0.pA, rounds: tv0.K, model: tv0.model, props: { gd: 0.5, n_books: { gd: 3 } } });
close(noM6.M, tv0.model.M, 0, "no method family -> model method | winner");

// 4) MethodRound cells input: own P(A) is used as pModel; round trip of the conditionals
const P0 = PP.compose(0.63, tv0.model.M, tv0.model.R, tv0.K, J.model.draw_c);
const K0 = tv0.K;
const cellsObj = { A: { ko: P0.slice(0, K0), sub: P0.slice(5, 5 + K0), dec: P0[20] },
                   B: { ko: P0.slice(10, 10 + K0), sub: P0.slice(15, 15 + K0), dec: P0[21] }, draw: P0[22] };
const fc = PP.fromCells(cellsObj);
close(fc.M, tv0.model.M, 1e-12, "fromCells M round trip");
close(fc.pOwn, 0.63, 1e-12, "fromCells own P(A)");
const viaCells = pool.predict({ pA: tv0.pA, rounds: tv0.K, model: cellsObj, books: tv0.books, swap: tv0.swap });
const viaMR = pool.predict({ pA: tv0.pA, pModel: 0.63, rounds: tv0.K, model: { M: fc.M, R: fc.R }, books: tv0.books, swap: tv0.swap });
close(viaCells.cells, viaMR.cells, 1e-15, "cells input = M/R input with pModel = own P(A)");

// 5) debut bouts: log pool of the debut method model and the props; symmetric; degrades to the debut model
const deb = { A: [0.35, 0.15, 0.5], B: [0.25, 0.2, 0.55] };
const d1 = pool.debutMethod({ debut: deb, pW: 0.6, rounds: tv0.K, books: tv0.books, swap: tv0.swap });
const d2 = pool.debutMethod({ debut: { A: deb.B, B: deb.A }, pW: 0.4, rounds: tv0.K, books: tv0.books, swap: !tv0.swap });
close([d1.A, d1.B], [d2.B, d2.A], 1e-12, "debut pool symmetry");
ok(d1.source.startsWith("debut pool"), "debut pool source");
const d0 = pool.debutMethod({ debut: deb, pW: 0.6, rounds: 3 });
close([d0.A, d0.B], [deb.A, deb.B], 0, "debut degrade");
close(d1.A.reduce((s, x) => s + x, 0), 1, 1e-12, "debut pool sums to 1");

console.log("propspool: %d checks, %d failures; max |cell diff| vs Python %s; swap %s", checks, fails,
            maxCell.toExponential(2), maxSwap.toExponential(2));
process.exit(fails ? 1 : 0);
