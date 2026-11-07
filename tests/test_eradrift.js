// node tests/test_eradrift.js : src/ml/eradrift.js against the Python export (data/derived/eradrift.json test_vectors)
"use strict";
const fs = require("fs");
const path = require("path");
const ED = require(path.join(__dirname, "..", "src", "ml", "eradrift.js"));
const doc = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "data", "derived", "eradrift.json"), "utf8"));
const m = ED.load(doc);
let n = 0, fail = 0;
function ok(cond, msg) { n++; if (!cond) { fail++; console.log("FAIL", msg); } }
function close(a, b, tol, msg) {
  if (a === null || b === null) return ok(a === b, msg + " (null) " + a + " vs " + b);
  ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), msg + " " + a + " vs " + b);
}
const V = doc.test_vectors;
for (const v of V.levels) close(ED.level(m, v.target, v.date, v.division), v.expect, 1e-9, "level " + v.target + " " + v.date);
for (const v of V.bins7) {
  const o = ED.adjustCells(m, v.bins7, v.date, { candidate: v.candidate, division: v.division, rounds: v.rounds });
  o.forEach((x, i) => close(x, v.expect[i], 1e-7, "bins7 " + v.candidate + " " + i));
  close(o.reduce((s, x) => s + x, 0), v.bins7.reduce((s, x) => s + x, 0), 1e-9, "bins7 mass");
}
for (const v of V.joint) {
  const o = ED.adjustCells(m, v.joint, v.date, { candidate: v.candidate, division: v.division, rounds: v.rounds });
  o.forEach((x, i) => close(x, v.expect[i], 1e-7, "joint " + v.candidate + " " + i));
}
for (const v of V.stat) {
  const o = ED.adjustStatMeans(m, v.means, v.date, { all: v.all });
  for (const k of Object.keys(v.expect)) close(o[k], v.expect[k], 1e-7, "stat " + k + " " + v.date);
}
// production identity and corner symmetry
const mirror7 = (b) => b.slice().reverse();
for (const v of V.bins7) {
  const id = ED.adjustCells(m, v.bins7, v.date, { division: v.division, rounds: v.rounds });
  id.forEach((x, i) => ok(x === v.bins7[i], "production identity"));
  for (const cand of ["M2_fast_dec", "M3_both"]) {
    const o = ED.adjustCells(m, v.bins7, v.date, { candidate: cand, division: v.division, rounds: v.rounds });
    const s = mirror7(ED.adjustCells(m, mirror7(v.bins7), v.date, { candidate: cand, division: v.division, rounds: v.rounds }));
    o.forEach((x, i) => close(x, s[i], 1e-12, "swap symmetry"));
    const pA = (b) => b[0] + b[1] + b[2] + b[3] * b[2] / Math.max(b[2] + b[4], 1e-300);
    close(pA(o), pA(v.bins7), 1e-9, "P(A wins) unchanged");
  }
}
const mirrorJ = (J) => {
  const Q = J.slice();
  for (let r = 0; r < 5; r++) { Q[r] = J[10 + r]; Q[10 + r] = J[r]; Q[5 + r] = J[15 + r]; Q[15 + r] = J[5 + r]; }
  Q[20] = J[21]; Q[21] = J[20]; return Q;
};
for (const v of V.joint) {
  const o = ED.adjustCells(m, v.joint, v.date, { candidate: v.candidate, division: v.division, rounds: v.rounds });
  const s = mirrorJ(ED.adjustCells(m, mirrorJ(v.joint), v.date, { candidate: v.candidate, division: v.division, rounds: v.rounds }));
  o.forEach((x, i) => close(x, s[i], 1e-12, "joint swap symmetry"));
}
// zero offsets are the identity; levels are finite and in range
const b = [0.2, 0.1, 0.25, 0.01, 0.24, 0.08, 0.12];
ED.adjustBins7(b, 0, 0).forEach((x, i) => close(x, b[i], 1e-12, "zero offset identity"));
for (const k of Object.keys(m.levels)) {
  const c = ED.current(m, k);
  ok(c !== null && isFinite(c) && c >= 0, "current " + k);
  if (m.levels[k].kind === "bin") ok(c < 1, "share < 1 " + k);
}
ok(ED.level(m, "dec", "2011-06-01") === null, "before the first snapshot -> null");
console.log(`test_eradrift: ${n - fail}/${n} checks passed`);
if (fail) process.exit(1);
