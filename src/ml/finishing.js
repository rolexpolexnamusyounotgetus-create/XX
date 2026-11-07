/* finishing.js: the finishing model (tools/finishing.py, research/model_finishing.md): who x how x when consistent with
   a given winner probability. STATUS: monitored candidate, NOT adopted (the forward-chained 2021-2023 stack gate
   rejected it; production method / round stays S2 + ML v2 winner with the props blend).

   const Finishing = require("./src/ml/finishing.js");
   const F = Finishing.load(require("./data/derived/finishing.json").js_model);
   F.predict({ xA, xB, rA, rB, pA, rounds })
     -> { cells, bins7, p6, qA, qB, shape: { AKO, ASUB, BKO, BSUB }, finRound, pFinish }
   F.methodShares(x)        -> [KO, SUB, DEC] given the side described by x wins
   F.roundShape(r, R, m)    -> P(round 1..5 | that side finishes by m), m = 0 KO / 1 SUB; zeros past R
   F.finFeatures(slugA, slugB, pA) -> { A: {...}, B: {...} }: the finishing block of the method design from the
                                     end-of-2025 EB roster and the winner probability (zW, azW, w_*, l_*)
   F.vector(obj, "method" | "round") -> the model's column order from a named object (throws on a missing column)

   P(cell) = P(W wins) x P(method | W wins, x) x P(round | W finishes by method, r). The winner probability pA is the
   ML v2 winner (or any winner the caller trusts); this model never re-predicts it. Designs: xA describes the fight
   with A as the winner (method columns: the finishing block, then methodround's S2 design with X = A), xB with B as
   the winner; rA / rB are the finisher-oriented round designs (methodround hazard columns with X = the finisher).
   The S2 design itself comes from methodround's feature builder (tools/methodround.py build_features + tools/ml2.py
   method_new_cols); this file only evaluates. Cells use the R5 layout: A KO r1..5, A SUB r1..5, B KO r1..5,
   B SUB r1..5, A DEC, B DEC, draw (draw = draw_c x decision mass). Corner symmetry: swapping (xA, rA) with (xB, rB)
   and pA with 1 - pA mirrors every cell exactly. */
"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FinishingModel = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const fin = (x) => typeof x === "number" && isFinite(x);
  const clip = (p, c) => Math.min(Math.max(p, c), 1 - c);
  const logit = (p, c) => { const q = clip(p, c); return Math.log(q / (1 - q)); };

  function softmax(z) {
    let m = -Infinity;
    for (const v of z) if (v > m) m = v;
    const e = z.map((v) => Math.exp(v - m));
    const s = e.reduce((a, b) => a + b, 0);
    return e.map((v) => v / s);
  }

  function linear(block, x, extra) {
    // standardized covariates, optional extra raw columns appended (round: slopes and dummies)
    const d = block.cols.length;
    if (x.length !== d) throw new Error("design has " + x.length + " columns, model expects " + d);
    const xs = new Array(d);
    for (let j = 0; j < d; j++) xs[j] = (x[j] - block.mean[j]) / block.scale[j];
    const full = extra ? extra(xs) : xs;
    return block.coef.map((row, k) => {
      let s = block.intercept ? block.intercept[k] : 0;
      for (let j = 0; j < full.length; j++) s += row[j] * full[j];
      return s;
    });
  }

  function load(model) {
    const M = model.method, R = model.round, drawC = model.draw_c;
    const roster = model.roster || {};

    function methodShares(x) {
      return softmax(linear(M, x));
    }

    function roundHazard(r, RR, j, m) {
      const z = linear(R, r, (xs) => {
        const out = xs.slice();
        if (R.slope) for (let i = 0; i < xs.length; i++) out.push(xs[i] * (j - 1) / 2);
        const dmy = new Array(12).fill(0);
        dmy[RR === 3 ? (j - 1) * 2 + m : 4 + (j - 1) * 2 + m] = 1;
        return out.concat(dmy);
      });
      return softmax(z)[1];
    }

    function roundShape(r, RR, m) {
      const out = [0, 0, 0, 0, 0];
      let surv = 1;
      for (let j = 1; j <= 4; j++) {
        if (RR > j) {
          const h = roundHazard(r, RR, j, m);
          out[j - 1] = surv * h;
          surv *= 1 - h;
        }
      }
      out[RR === 3 ? 2 : 4] = surv;
      return out;
    }

    function predict(q) {
      const RR = q.rounds === 5 ? 5 : 3;
      const pA = q.pA, pB = 1 - pA;
      const qA = methodShares(q.xA), qB = methodShares(q.xB);
      const p6 = [pA * qA[0], pA * qA[1], pA * qA[2], pB * qB[2], pB * qB[1], pB * qB[0]];
      const shape = { AKO: roundShape(q.rA, RR, 0), ASUB: roundShape(q.rA, RR, 1),
        BKO: roundShape(q.rB, RR, 0), BSUB: roundShape(q.rB, RR, 1) };
      const cells = new Array(23).fill(0);
      for (let r = 0; r < 5; r++) {
        cells[r] = p6[0] * shape.AKO[r];
        cells[5 + r] = p6[1] * shape.ASUB[r];
        cells[10 + r] = p6[5] * shape.BKO[r];
        cells[15 + r] = p6[4] * shape.BSUB[r];
      }
      cells[20] = p6[2] * (1 - drawC);
      cells[21] = p6[3] * (1 - drawC);
      cells[22] = (p6[2] + p6[3]) * drawC;
      const sum = (a, b) => cells.slice(a, b).reduce((s, v) => s + v, 0);
      const bins7 = [sum(0, 5), sum(5, 10), cells[20], cells[22], cells[21], sum(15, 20), sum(10, 15)];
      const finRound = [0, 1, 2, 3, 4].map((r) => cells[r] + cells[5 + r] + cells[10 + r] + cells[15 + r]);
      const pFinish = finRound.reduce((s, v) => s + v, 0);
      return { cells, bins7, p6, qA, qB, shape, finRound, pFinish };
    }

    function finSide(w, l, z) {
      const o = { zW: z, azW: Math.abs(z) };
      for (const k of ["kow", "subw", "dec", "kol", "subl", "r1w", "latew"]) o["w_" + k] = fin(w[k]) ? w[k] : 0;
      for (const k of ["kol", "subl", "dec", "kow", "subw", "r1l", "latel"]) o["l_" + k] = fin(l[k]) ? l[k] : 0;
      return o;
    }

    function finFeatures(slugA, slugB, pA) {
      // an unknown fighter (no UFC bout through 2025) enters at the prior mean: every EB shift 0
      const a = roster[slugA] || {}, b = roster[slugB] || {};
      const z = logit(pA, 1e-4);
      return { A: finSide(a, b, z), B: finSide(b, a, -z), knownA: slugA in roster, knownB: slugB in roster };
    }

    function vector(obj, which) {
      const cols = which === "round" ? R.cols : M.cols;
      return cols.map((c) => {
        if (!fin(obj[c])) throw new Error("missing column " + c);
        return obj[c];
      });
    }

    return { predict, methodShares, roundShape, finFeatures, vector, drawC, roster,
      methodCols: M.cols.slice(), roundCols: R.cols.slice() };
  }

  function mirrorCells(c) {
    const m = c.slice();
    for (let r = 0; r < 5; r++) {
      m[r] = c[10 + r]; m[10 + r] = c[r];
      m[5 + r] = c[15 + r]; m[15 + r] = c[5 + r];
    }
    m[20] = c[21]; m[21] = c[20];
    return m;
  }

  return { load, mirrorCells };
});
