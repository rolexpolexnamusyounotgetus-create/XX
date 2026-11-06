/* sosrec.js: leak-free strength-of-schedule inputs for backtest tools (engine v5, params.components.styles_sos, sub-flag
   sos with params.stylesSOS.sosSource "wf"; v5 merge step 3).

   The SOS component is a no-op until a caller passes opts.sos (the engine never reads a roster table for a bout dated on
   or before the table's as-of date). A backtest fight gets its one-step walk-forward pair from data/derived/sos_wf.json
   fights[id] (tools/sos_wf.py: each fighter's opponents' quality from fights strictly before this one; A/B in
   backtest_dev's order, swapped here together with the corners), plus the coefficients:
     - fights dated before 2024-01-01 (train): meta.coef_loyo[path][year], the leave-one-year-out fit without that year
       (the out-of-fold policy of the learned rates; the full 2019-2023 fit would be in-sample on train);
     - fights dated 2024-01-01..2025-12-31 (validation): meta.coef, the full 2019-2023 fit (= src/styles_sos.js SOS_COEF).
   Fights dated 2026-01-01 or later are refused (hidden-data protocol). tools/evalv.js keeps its own copy of this logic
   (sosOpts) so a frozen evaluation does not depend on tools/ code.

     const SR = require("./sosrec.js")(E, ROOT);
     if (SR.on(params)) SR.apply(opts, f, swap);      // sets opts.sos and opts.params.stylesSOS.sosCoef
     const m = E.matchup(A, B, opts); SR.assertApplied(m, f.id, params);

   apply() throws for a fight without a pair (never a silent neutral run). */
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = function sosrec(E, root) {
  let J = null;
  const load = () => {
    if (!J) {
      const a = path.join(root, "data/derived/sos_wf.json");
      J = JSON.parse(fs.readFileSync(fs.existsSync(a) ? a : path.join("/home/user/XX", "data/derived/sos_wf.json"), "utf8"));
    }
    return J;
  };
  // is the SOS sub-flag on with the "wf" source for this params override (resolved against the engine's own params)?
  function on(params) {
    const p = typeof E.resolveParams === "function" ? E.resolveParams(params || {}) : null;
    if (!p) return false;
    const c = p.components && p.components.styles_sos;
    if (!c || (c !== true && c.sos === false)) return false;
    return ((p.stylesSOS && p.stylesSOS.sosSource) || "wf") === "wf";
  }
  function coefFor(date) {
    const m = load().meta, d = String(date || "");
    if (!d) throw new Error("sos: fight without a date");
    if (d >= "2026-01-01") throw new Error("sos: refusing a fight dated " + d + " (hidden-data protocol)");
    if (d < "2024-01-01") {
      const y = d.slice(0, 4), L = m.coef_loyo;
      if (!L || !L.ml || !L.ml[y] || !L.base || !L.base[y]) throw new Error("sos: no leave-one-year-out coefficients for " + y);
      return { ml: L.ml[y], base: L.base[y] };
    }
    return { ml: m.coef.ml, base: m.coef.base };
  }
  function pair(id, swap) {
    const s = load().fights[id];
    if (!s || !s.A || !s.B) throw new Error("sos: no walk-forward pair for fight " + id + " (refusing a neutral run)");
    return swap ? { A: s.B, B: s.A } : { A: s.A, B: s.B };
  }
  // set opts.sos and the coefficients in opts.params for backtest fight f ({id, date}) in place; returns opts
  function apply(opts, f, swap) {
    opts.sos = pair(f.id, swap);
    const o = Object.assign({}, opts.params || {});
    o.stylesSOS = Object.assign({}, o.stylesSOS || {}, { sosCoef: coefFor(f.date) });
    opts.params = o;
    return opts;
  }
  function assertApplied(m, id, params) {
    if (!on(params)) return;
    const r = m.stylesSOS && m.stylesSOS.sos;
    if (!r || !r.have || !r.have[0] || !r.have[1]) {
      throw new Error("sos: walk-forward pair not applied for " + id + (m.stylesSOS && m.stylesSOS.missing ? " (src/styles_sos.js not loaded next to engine3.js)" : ""));
    }
  }
  return { on, apply, pair, coefFor, assertApplied, table: load };
};
