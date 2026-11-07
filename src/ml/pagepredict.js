/* pagepredict.js: the page's prediction recipe in one dependency-free place, so Node can test exactly what the page runs.

   Winner (research/model_ml2.md "Integration recipe"; weights = data/derived/forward_models.json ml2_static, the
   fit-2019-2023 stacks the forward ledger scores, research/vault_audit_v5.md section 2):
     no line                      -> ML v2 no-line stack   (ML v2 logistic 0.7049 + market rating 0.5526)
     any pre-fight line (default) -> ML v2 open stack      (multiplicative no-vig line 0.6596 + ML v2 logistic 0.5825)
     a line marked as the close   -> ML v2 close stack     (power de-vig line 0.7733 + ML v2 logistic 0.3397)
   An opener never reaches the close-trained weights (fed an opener they cost +0.0099 log loss on 2024-25).

   PagePredict.devig(oddsA, oddsB)            -> { ia, ib, over, pMult, pPow } from American odds (strings or numbers)
   PagePredict.winner(h, slugA, slugB, fight, line)
       h = ML2.load(page block); fight = { date, lbs, five }; line = null | { kind: "open" | "close", pMult, pPow }
       -> { p, kind, pML2, pMR, pNoLine, pOpen, pClose, pLine, used: [{ key, p, w, z }], scale, z } or null
   PagePredict.s2Inputs(h, ML2.ratingProb, slugA, slugB, fight, res) -> { z, zw, zm, src } for methodround S2 (as
       src/ml/blend.js s2Inputs: logits of the ML v2 logistic (clip 1e-6), its round-level WHR term and the market rating
       (clip 1e-3); pre-UFC rates and weight-miss flags enter as 0, as in blend.js when they are not given)
   PagePredict.isDebutant(profile)            -> true when the profile has no prior UFC fight
   PagePredict.debutCells(cells, R, dm)       -> cells with each side's method given the winner replaced by the debut
       method model's (dm = { A: [ko, sub, dec], B: [...] }), keeping each side's total and round shapes
   PagePredict.lengthCells(c, R)              -> StatDist layout [A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R,
       A DEC, B DEC, DRAW] from { A: { ko: [], sub: [], dec }, B: {...}, draw }

   UMD: module.exports in Node, self.PagePredict in a browser. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PagePredict = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function clip(p, c) { return Math.min(Math.max(p, c), 1 - c); }
  function logit(p, c) { var q = clip(p, c); return Math.log(q / (1 - q)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }

  // American odds -> implied probability; "EV" / "even" / "evens" = +100
  function implied(s) {
    s = String(s == null ? "" : s).trim().toLowerCase().replace(/[−–]/g, "-");
    if (!s) return null;
    if (s === "ev" || s === "even" || s === "evens") return 0.5;
    if (!/^[+-]?\d+(\.\d+)?$/.test(s)) return NaN;
    var v = parseFloat(s);
    if (Math.abs(v) < 100) return NaN;
    return v > 0 ? 100 / (v + 100) : -v / (-v + 100);
  }
  /** Both de-vigs of a two-way line: multiplicative (the construction the open stack was fit on: market.py
      p_novig_open) and power (the closing-line construction of the close stack: market.py p_power_close). */
  function devig(oddsA, oddsB) {
    var ia = implied(oddsA), ib = implied(oddsB), out = { ia: ia, ib: ib, over: null, pMult: null, pPow: null };
    if (!isNum(ia) || !isNum(ib)) return out;
    out.over = ia + ib - 1;
    out.pMult = ia / (ia + ib);
    var lo = 0.5, hi = 3;                          // power k with ia^k + ib^k = 1 (as src/ml/moe.js devig)
    for (var it = 0; it < 80; it++) { var k = 0.5 * (lo + hi); if (Math.pow(ia, k) + Math.pow(ib, k) > 1) lo = k; else hi = k; }
    var kk = 0.5 * (lo + hi);
    out.pPow = Math.pow(ia, kk) / (Math.pow(ia, kk) + Math.pow(ib, kk));
    return out;
  }

  var REGIME = { none: "noline", open: "open", close: "line" };
  function winner(h, slugA, slugB, fight, line) {
    if (!h) return null;
    var kind = line && (line.kind === "open" || line.kind === "close") ? line.kind : "none";
    var pOpenIn = kind === "open" ? line.pMult : undefined, pCloseIn = kind === "close" ? line.pPow : undefined;
    if (kind !== "none" && !isNum(kind === "open" ? pOpenIn : pCloseIn)) kind = "none";
    var r = h.predict(slugA, slugB, fight, kind === "close" ? pCloseIn : undefined, kind === "open" ? pOpenIn : undefined);
    if (!r || !isNum(r.pA)) return null;
    var st = h.doc.stack && h.doc.stack[REGIME[kind]];
    var p = kind === "none" ? r.pStack : (kind === "open" ? r.pStackOpen : r.pStackLine);
    if (!st || !isNum(p)) return null;
    var inp = { ml2lr: r.pA, mkt_rating: r.pMR, open: pOpenIn, market: pCloseIn }, used = [], z = 0, scale = 0;
    for (var i = 0; i < st.inputs.length; i++) {
      var key = st.inputs[i], q = inp[key], w = st.weights[i], zi = isNum(q) ? w * logit(q, st.pclip) : 0;
      used.push({ key: key, p: isNum(q) ? q : null, w: w, z: zi });
      z += zi; scale += w;
    }
    return { p: p, kind: kind, pML2: r.pA, pMR: isNum(r.pMR) ? r.pMR : null, pNoLine: r.pStack,
      pOpen: isNum(r.pStackOpen) ? r.pStackOpen : null, pClose: isNum(r.pStackLine) ? r.pStackLine : null,
      pLine: kind === "open" ? pOpenIn : (kind === "close" ? pCloseIn : null), used: used, scale: scale, z: z, zCheck: Math.abs(sigm(z) - p) };
  }

  // ratingProb = ML2.ratingProb (the handle does not expose it)
  function s2Inputs(h, ratingProb, slugA, slugB, fight, res) {
    var out = { z: 0, zw: 0, zm: 0, pre: null, missed: null, src: [] };
    if (res && isNum(res.pML2)) { out.z = logit(res.pML2, 1e-6); out.src.push("z"); }
    if (res && isNum(res.pMR)) { out.zm = logit(res.pMR, 1e-3); out.src.push("zm"); }
    if (h && ratingProb && h.has(slugA) && h.has(slugB)) {
      var sa = h.side(slugA, fight), sb = h.side(slugB, fight);
      var T = (h.doc.terms || []).filter(function (t) { return t.type === "rating" && t.sys === "whr_rounds"; })[0];
      if (T && sa && sb && sa.r && sb.r && sa.r.whr_rounds && sb.r.whr_rounds) {
        out.zw = logit(ratingProb(T.kind, T.kappa, sa.r.whr_rounds, sb.r.whr_rounds), 1e-3); out.src.push("zw");
      }
    }
    return out;
  }

  function isDebutant(prof) {
    if (!prof) return false;
    var rec = prof.record || {}, n = isNum(prof.n_fights) ? prof.n_fights : (rec.w || 0) + (rec.l || 0) + (rec.d || 0) + (rec.nc || 0);
    return n === 0 && !!(prof.record || isNum(prof.n_fights));
  }

  // cells in methodround's layout { A: { ko: [R], sub: [R], dec }, B: {...}, draw }; dm.A / dm.B = [ko, sub, dec] given
  // that side wins, or null to keep that side as it is
  function debutCells(c, R, dm) {
    function side(s, sh) {
      var ko = 0, sub = 0, i, o = { ko: [], sub: [], dec: s.dec };
      for (i = 0; i < R; i++) { ko += s.ko[i]; sub += s.sub[i]; }
      if (!sh) return { ko: s.ko.slice(), sub: s.sub.slice(), dec: s.dec };
      var tot = ko + sub + s.dec;
      for (i = 0; i < R; i++) {
        o.ko.push(tot * sh[0] * (ko > 0 ? s.ko[i] / ko : 1 / R));
        o.sub.push(tot * sh[1] * (sub > 0 ? s.sub[i] / sub : 1 / R));
      }
      o.dec = tot * sh[2];
      return o;
    }
    return { A: side(c.A, dm && dm.A), B: side(c.B, dm && dm.B), draw: c.draw };
  }

  function lengthCells(c, R) {
    return c.A.ko.slice(0, R).concat(c.A.sub.slice(0, R), c.B.ko.slice(0, R), c.B.sub.slice(0, R), [c.A.dec, c.B.dec, c.draw || 0]);
  }

  return { devig: devig, implied: implied, winner: winner, s2Inputs: s2Inputs, isDebutant: isDebutant, debutCells: debutCells,
    lengthCells: lengthCells, logit: logit, VERSION: "1.0.0" };
});
