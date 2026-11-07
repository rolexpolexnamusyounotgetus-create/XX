/* propspool.js: market props for how and when (tools/props.py, research/model_props.md, data/derived/props.json).

   const PP = require("./src/ml/propspool.js");
   const pool = PP.create(require("./data/derived/props.json").model);
   pool.predict({ pA, rounds, model, books | props, swap, pModel, params })
     -> { cells, bins7, p_method, p_distance, fin_round, M, R, source, props }

   pA      the bout's winner probability (the winner stays with the winner stack: the output's
           P(A) / (P(A) + P(B)) equals pA exactly).
   rounds  3 or 5.
   model   the method-and-round package: either { M, R } (M[side][KO, SUB, DEC] = P(method | side wins),
           R[side][KO|SUB][round 1..5] = P(round | side, method)) or MethodRound cells
           { A: { ko: [r1..R], sub: [r1..R], dec }, B: {...}, draw } (tools/methodround_model.js predict().cells).
   books   raw per-book prop prices for the bout, page-team oriented: { book: { ko1, sub1, dec1, ud1, sm1, ko2, ...,
           draw, godec, godec_no, er1..er5, wr11..wr52, kor11.., subr11.., itd1, itd1_no, ..., ml1, ml2 } } (American
           odds; the keys of data/raw/odds/bfo_props_full.csv and of `tools/props.py capture` snapshots), with
           swap = true when page team 1 is the bout's B side. Or `props`: an already de-vigged consensus
           ({ m6, gd, er, wr, mr, n_books }, A/B oriented), e.g. a capture snapshot's `consensus`.
   pModel  the model package's own P(A) (the jlin weights use it); default: the model cells' own P(A).
   params  "production" (refit on 2021-2025 by the pre-registered procedure; default) or "fit_2021_2023" (the
           parameters scored on 2024-25; use them for backtests of 2024-25).

   Degrade: no method props -> the model's method | winner (identity); round shapes always come from the model
   (round props failed the CV gate); no props at all -> the model package composed with pA, unchanged.

   pool.debutMethod({ debut: { A: [ko, sub, dec], B: [...] }, pW, books | props, swap, rounds, params })
     -> { A, B, source }: the debut METHOD model pooled with the props (log-linear, CV-chosen), for debut bouts.

   PP.devigPower, PP.bookFamilies, PP.consensus, PP.propsCond, PP.compose are exported for tools and tests.
   UMD: module.exports in Node, self.PropsPool in the browser / a Web Worker. No DOM, no dependencies. */
"use strict";
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PropsPool = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const R5 = 5, NC = 23;
  const I = { XKO: 0, XSUB: 5, YKO: 10, YSUB: 15, XDEC: 20, YDEC: 21, DRAW: 22 };
  const OVER_MAX_DEFAULT = { m6: 1.6, gd: 1.25, er: 1.8, wr: 2.2, mr: 2.6, itd: 1.25, ou: 1.25 };

  const isNum = (x) => typeof x === "number" && isFinite(x);
  function amDec(a) { a = +a; return a > 0 ? 1 + a / 100 : 1 + 100 / (-a); }
  function qOf(a) {
    if (a === null || a === undefined || a === "") return null;
    const v = +a;
    return isFinite(v) && Math.abs(v) >= 100 ? 1 / amDec(v) : null;
  }
  const sum = (v) => v.reduce((s, x) => s + x, 0);

  /* power de-vig of a mutually exclusive, exhaustive family: p_i = q_i^k, sum 1 (multiplicative if sum <= 1) */
  function devigPower(q) {
    const S = sum(q);
    if (S <= 1) return { p: q.map((x) => x / S), over: S };
    let lo = 1.0, hi = 30.0;
    for (let i = 0; i < 80; i++) {
      const k = 0.5 * (lo + hi);
      if (sum(q.map((x) => Math.pow(x, k))) > 1) lo = k; else hi = k;
    }
    const k = 0.5 * (lo + hi);
    const v = q.map((x) => Math.pow(x, k));
    const t = sum(v);
    return { p: v.map((x) => x / t), over: S };
  }

  function decQ(d, t) {
    const q = qOf(d["dec" + t]);
    if (q !== null) return q;
    const u = qOf(d["ud" + t]), m = qOf(d["sm" + t]);
    return u !== null && m !== null ? u + m : null;
  }

  /* one book's prices -> de-vigged families oriented to the bout's A/B (tools/props.py book_families) */
  function bookFamilies(d, K, sw, overMax) {
    const OM = overMax || OVER_MAX_DEFAULT;
    const out = {};
    const t1 = sw ? 2 : 1, t2 = sw ? 1 : 2;
    const g = (k) => qOf(d[k]);
    const draw = g("draw");
    function keep(fam, q, extraDraw) {
      if (q.some((x) => x === null || !(x > 0) || x >= 1)) return null;
      const qq = (extraDraw && draw !== null && draw > 0 && draw < 0.2) ? q.concat([draw]) : q.slice();
      const r = devigPower(qq);
      if (!(r.over >= 0.97 && r.over <= OM[fam])) return null;
      return r;
    }
    const rng = (n) => Array.from({ length: n }, (_, i) => i + 1);
    let r = keep("m6", [g("ko" + t1), g("sub" + t1), decQ(d, t1), g("ko" + t2), g("sub" + t2), decQ(d, t2)], true);
    if (r) { out.m6 = r.p.slice(0, 6); out.m6_over = r.over; }
    r = keep("gd", [g("godec"), qOf(d.godec_no)], false);
    if (r) out.gd = r.p[0];
    r = keep("er", rng(K).map((k) => g("er" + k)).concat([g("godec")]), false);
    if (r) out.er = r.p;
    r = keep("wr", rng(K).map((k) => g("wr" + k + t1)).concat(rng(K).map((k) => g("wr" + k + t2)),
      [decQ(d, t1), decQ(d, t2)]), true);
    if (r) out.wr = r.p.slice(0, 2 * K + 2);
    r = keep("mr", rng(K).map((k) => g("kor" + k + t1)).concat(rng(K).map((k) => g("subr" + k + t1)),
      rng(K).map((k) => g("kor" + k + t2)), rng(K).map((k) => g("subr" + k + t2)), [decQ(d, t1), decQ(d, t2)]), true);
    if (r) out.mr = r.p.slice(0, 4 * K + 2);
    const itd = [t1, t2].map((t) => { const x = keep("itd", [g("itd" + t), qOf(d["itd" + t + "_no"])], false); return x ? x.p[0] : null; });
    if (itd.some((x) => x !== null)) out.itd = itd;
    const ou = {};
    for (const x of ["15", "25", "35", "45"]) {
      const y = keep("ou", [g("ou" + x), qOf(d["ou" + x + "_no"])], false);
      if (y) ou[x] = y.p[0];
    }
    if (Object.keys(ou).length) out.ou = ou;
    const m1 = qOf(d.ml1), m2 = qOf(d.ml2);
    if (m1 !== null && m2 !== null) {
      const q = sw ? [m2, m1] : [m1, m2];
      if (q[0] + q[1] >= 0.98 && q[0] + q[1] <= 1.25) out.ml = devigPower(q).p[0];
    }
    return out;
  }

  function median(v) {
    const s = v.slice().sort((a, b) => a - b), n = s.length;
    return n % 2 ? s[(n - 1) / 2] : 0.5 * (s[n / 2 - 1] + s[n / 2]);
  }

  /* books' families -> consensus (arithmetic mean; outcome-blind outlier rule with >= 3 books) */
  function consensus(famsByBook, maxDev) {
    const md = isNum(maxDev) ? maxDev : 0.15;
    const out = {}, nb = {};
    let dropped = 0;
    const key = { m6: (p) => p[2] + p[5], gd: (p) => p, er: (p) => p[p.length - 1],
      wr: (p) => p[p.length - 1] + p[p.length - 2], mr: (p) => p[p.length - 1] + p[p.length - 2], ml: (p) => p };
    const books = Object.keys(famsByBook);
    for (const fam of ["m6", "gd", "er", "wr", "mr", "ml"]) {
      let vals = books.filter((b) => famsByBook[b][fam] !== undefined).map((b) => famsByBook[b][fam]);
      if (!vals.length) continue;
      if (vals.length >= 3) {
        const m = median(vals.map(key[fam]));
        const kept = vals.filter((v) => Math.abs(key[fam](v) - m) <= md);
        dropped += vals.length - kept.length;
        if (kept.length) vals = kept;
      }
      if (fam === "gd" || fam === "ml") out[fam] = sum(vals) / vals.length;
      else out[fam] = vals[0].map((_, i) => sum(vals.map((v) => v[i])) / vals.length);
      nb[fam] = vals.length;
    }
    for (const j of [0, 1]) {
      const v = books.map((b) => famsByBook[b].itd).filter((x) => x && x[j] !== null && x[j] !== undefined).map((x) => x[j]);
      if (v.length) { out.itd = out.itd || [null, null]; out.itd[j] = sum(v) / v.length; }
    }
    const ou = {};
    for (const b of books) for (const [x, v] of Object.entries(famsByBook[b].ou || {})) (ou[x] = ou[x] || []).push(v);
    if (Object.keys(ou).length) { out.ou = {}; for (const x of Object.keys(ou)) out.ou[x] = sum(ou[x]) / ou[x].length; }
    out.n_books = nb;
    out.n_dropped = dropped;
    return out;
  }

  /* consensus -> props' method | winner (2 x 3) and round | side, method (2 x 2 x 5) */
  function propsCond(cons, K, repR) {
    let M = null, R = null;
    if (cons && cons.m6) {
      const v = cons.m6, a = v.slice(0, 3), b = v.slice(3, 6), sa = sum(a), sb = sum(b);
      M = [a.map((x) => x / sa), b.map((x) => x / sb)];
    }
    const order = { er: ["er"], wr: ["wr"], best: ["mr", "wr", "er"] }[repR || "er"];
    for (const fam of order) {
      const f = cons && cons[fam];
      if (!f) continue;
      R = [0, 1].map(() => [0, 1].map(() => new Array(R5).fill(0)));
      const norm = (sh) => { const t = sum(sh); return sh.map((x) => x / t); };
      if (fam === "er") { const sh = norm(f.slice(0, K)); for (const s of [0, 1]) for (const m of [0, 1]) for (let k = 0; k < K; k++) R[s][m][k] = sh[k]; }
      else if (fam === "wr") { for (const s of [0, 1]) { const sh = norm(f.slice(s * K, (s + 1) * K)); for (const m of [0, 1]) for (let k = 0; k < K; k++) R[s][m][k] = sh[k]; } }
      else { for (const s of [0, 1]) for (const m of [0, 1]) { const sh = norm(f.slice((2 * s + m) * K, (2 * s + m + 1) * K)); for (let k = 0; k < K; k++) R[s][m][k] = sh[k]; } }
      break;
    }
    return { M, R };
  }

  function softmax(v) { const m = Math.max(...v); const e = v.map((x) => Math.exp(x - m)); const t = sum(e); return e.map((x) => x / t); }
  const clipLog = (x) => Math.log(Math.min(Math.max(x, 1e-6), 1));

  /* pool of method | winner experts for one bout (tools/props.py pool_method): log / lin / jlin + debias tilt */
  function poolMethod(mode, Ms, par, ext) {
    const beta = par.beta || [0, 0, 0];
    const out = [null, null];
    const nbx = ext && isNum(ext.lognb) ? ext.lognb - Math.log(4) : 0;
    if (mode === "log") {
      const w = par.alpha.slice();
      if (par.alpha_nb && ext && ext.pIdx !== null && ext.pIdx !== undefined) w[ext.pIdx] = Math.max(0, w[ext.pIdx] + par.alpha_nb * nbx);
      for (const s of [0, 1]) out[s] = softmax([0, 1, 2].map((c) => Ms.reduce((acc, M, j) => acc + w[j] * clipLog(M[s][c]), 0) + beta[c]));
      return out;
    }
    let w = par.w.slice();
    if (par.alpha_nb && ext && ext.pIdx !== null && ext.pIdx !== undefined) {
      w[ext.pIdx] *= Math.exp(par.alpha_nb * nbx);
      const t = sum(w); w = w.map((x) => x / t);
    }
    for (const s of [0, 1]) {
      const c = mode === "lin" ? w : w.map((wj, j) => wj * (s === 0 ? ext.Wsrc[j] : 1 - ext.Wsrc[j]));
      const tot = sum(c);
      out[s] = [0, 1, 2].map((k) => Ms.reduce((acc, M, j) => acc + c[j] * M[s][k], 0) / tot);
    }
    if (beta.some((b) => b !== 0)) for (const s of [0, 1]) { const e = out[s].map((x, k) => x * Math.exp(beta[k])); const t = sum(e); out[s] = e.map((x) => x / t); }
    return out;
  }

  /* winner pA + method | winner M + round shapes R -> 23 cells; P(A) / (P(A) + P(B)) = pA exactly */
  function compose(pA, M, R, K, drawC) {
    const P = new Array(NC).fill(0);
    const Wm = [pA, 1 - pA];
    const draw = drawC * (Wm[0] * M[0][2] + Wm[1] * M[1][2]);
    const nd = 1 - draw;
    [[I.XKO, I.XSUB, I.XDEC], [I.YKO, I.YSUB, I.YDEC]].forEach(([bko, bsub, bdec], s) => {
      const ws = nd * Wm[s];
      for (let r = 0; r < R5; r++) {
        P[bko + r] = ws * M[s][0] * R[s][0][r];
        P[bsub + r] = ws * M[s][1] * R[s][1][r];
      }
      P[bdec] = ws * M[s][2];
    });
    P[I.DRAW] = draw;
    if (K === 3) for (const b of [I.XKO, I.XSUB, I.YKO, I.YSUB]) { P[b + 3] = 0; P[b + 4] = 0; }
    const t = sum(P);
    return P.map((x) => x / t);
  }

  function fromCells(c) {
    /* MethodRound cells -> { M, R, pOwn } */
    const M = [], R = [];
    let pa = 0, pb = 0;
    [c.A, c.B].forEach((S, s) => {
      const ko = S.ko.slice(), sub = S.sub.slice();
      while (ko.length < R5) ko.push(0);
      while (sub.length < R5) sub.push(0);
      const k = sum(ko), b = sum(sub), tot = k + b + S.dec;
      M[s] = [k / tot, b / tot, S.dec / tot];
      R[s] = [ko.map((x) => x / Math.max(k, 1e-12)), sub.map((x) => x / Math.max(b, 1e-12))];
      if (s === 0) pa = tot; else pb = tot;
    });
    return { M, R, pOwn: pa / (pa + pb) };
  }

  function summary(cells, K) {
    const s = (a, b) => cells.slice(a, b).reduce((x, y) => x + y, 0);
    const pm = { a_ko: s(I.XKO, I.XKO + R5), a_sub: s(I.XSUB, I.XSUB + R5), a_dec: cells[I.XDEC],
      b_ko: s(I.YKO, I.YKO + R5), b_sub: s(I.YSUB, I.YSUB + R5), b_dec: cells[I.YDEC], draw: cells[I.DRAW] };
    const fin = []; for (let r = 0; r < K; r++) fin.push(cells[I.XKO + r] + cells[I.XSUB + r] + cells[I.YKO + r] + cells[I.YSUB + r]);
    return { p_method: pm, p_distance: pm.a_dec + pm.b_dec + pm.draw, fin_round: fin,
      bins7: [pm.a_ko, pm.a_sub, pm.a_dec, pm.draw, pm.b_dec, pm.b_sub, pm.b_ko] };
  }

  function create(model) {
    const spec = model.spec;
    const drawC = model.draw_c;
    function parOf(which) { return which === "fit_2021_2023" ? model.params : model.params_production; }
    function propsFrom(input, K) {
      if (input.props) return input.props;
      if (!input.books) return null;
      const fams = {};
      for (const [bk, d] of Object.entries(input.books)) fams[bk] = bookFamilies(d, K, !!input.swap, model.over_max);
      return consensus(fams, model.outlier_max_dev);
    }
    function predict(input) {
      const K = input.rounds === 5 ? 5 : 3;
      const mdl = input.model.M ? { M: input.model.M, R: input.model.R, pOwn: null } : fromCells(input.model);
      const pModel = isNum(input.pModel) ? input.pModel : (isNum(mdl.pOwn) ? mdl.pOwn : input.pA);
      const cons = propsFrom(input, K);
      const pc = cons ? propsCond(cons, K, spec.rep_r) : { M: null, R: null };
      const par = parOf(input.params);
      let M = mdl.M, R = mdl.R, source = "model (no method props)";
      if (pc.M && spec.m_exp.indexOf("P") >= 0) {
        const Ms = spec.m_exp.map((e) => (e === "P" ? pc.M : mdl.M));
        const Wp = sum(cons.m6.slice(0, 3)) / sum(cons.m6);
        const ext = { lognb: Math.log(Math.max((cons.n_books || {}).m6 || 1, 1)), pIdx: spec.m_exp.indexOf("P"),
          Wsrc: spec.m_exp.map((e) => (e === "P" ? Wp : pModel)) };
        M = poolMethod(spec.m_mode, Ms, par.m, ext);
        source = "pool (method props)";
      }
      if (pc.R && spec.r_exp.indexOf("P") >= 0) source += " + round props";   // not in the CV-chosen spec
      const cells = compose(input.pA, M, R, K, drawC);
      return Object.assign({ cells, M, R, source, props: cons }, summary(cells, K));
    }
    function debutMethod(input) {
      const K = input.rounds === 5 ? 5 : 3;
      const cons = propsFrom(input, K);
      const pc = cons ? propsCond(cons, K, "er") : { M: null };
      const D = [input.debut.A, input.debut.B];
      if (!pc.M || !model.debut || !model.debut.mode) return { A: D[0], B: D[1], source: "debut model (no method props)" };
      const par = input.params === "fit_2021_2023" ? model.debut.params : model.debut.params_production;
      const Wp = sum(cons.m6.slice(0, 3)) / sum(cons.m6);
      const ext = { lognb: Math.log(Math.max((cons.n_books || {}).m6 || 1, 1)), pIdx: 1,
        Wsrc: [isNum(input.pW) ? input.pW : 0.5, Wp] };
      const M = poolMethod(model.debut.mode, [D, pc.M], par, ext);
      return { A: M[0], B: M[1], source: "debut pool (method props)", props: cons };
    }
    return { predict, debutMethod, spec };
  }

  return { create, devigPower, bookFamilies, consensus, propsCond, poolMethod, compose, fromCells, summary, version: 1 };
});
