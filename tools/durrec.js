/* durrec.js: leak-free durability inputs for backtest tools (engine v5, params.components.durability).

   With the durability component on (the default from v5 merge step 2), a backtest fight must get its walk-forward record
   from data/derived/durability.json backtest[fight_id] (chin_re, chin_cov, pow_re, pow_cov; 2019-2023 entries fit on
   2008..Y-1, 2024-2025 entries on 2008-2023) as opts.dur, plus the train-only NORM (norm_*_backtest_2019_2023) in
   opts.params.durability. Without them the engine falls back to the live-fit terms (2008..2026-10, which include the
   validation years and the vault) and the Oct 2026 league level. This module is the one place backtest tools get them
   (tools/evalv.js keeps its own verified copy of the same code, durOpts).

     const DR = require("./durrec.js")(E, ROOT);
     if (DR.on(params)) { opts.dur = DR.rec(f.id, swap); opts.params = DR.withNorm(params); }
     const m = E.matchup(A, B, opts); DR.assertApplied(m, f.id, params);

   rec() throws for a fight without a record (never the live-fit fallback). League-average pairs (no fight id) use
   DR.relative(params) instead: relative mode on the priors' own division level, as tests/test_engine3.js simAvg does. */
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = function durrec(E, root) {
  let J = null;
  const load = () => {
    if (!J) {
      const a = path.join(root, "data/derived/durability.json");
      J = JSON.parse(fs.readFileSync(fs.existsSync(a) ? a : path.join("/home/user/XX", "data/derived/durability.json"), "utf8"));
    }
    return J;
  };
  // is the durability component on for this params override (resolved against the engine's own params)?
  function on(params) {
    if (typeof E.loadDurability !== "function") return false;
    if (typeof E.resolveParams === "function") return !!(E.resolveParams(params || {}).components || {}).durability;
    const p = E.params ? E.params() : null, c = params && params.components;
    return !!(c && c.durability != null ? c.durability : p && p.components && p.components.durability);
  }
  function rec(id, swap) {
    const d = load().backtest[id];
    if (!d) throw new Error("durability: no walk-forward record for fight " + id + " (refusing the live-fit fallback)");
    const side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
    const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
    const base = Math.sqrt(bA * bB);
    return swap ? { A: side(d.B), B: side(d.A), base } : { A: side(d.A), B: side(d.B), base };
  }
  // params override + the train-only NORM (an explicit params.durability.normChin / normPow still wins)
  function withNorm(params) {
    const e = load().engine, o = Object.assign({}, params || {});
    o.durability = Object.assign({ normChin: e.norm_chin_backtest_2019_2023, normPow: e.norm_pow_backtest_2019_2023 }, (params && params.durability) || {});
    return o;
  }
  function relative(params) {
    const o = Object.assign({}, params || {});
    o.durability = Object.assign({}, (params && params.durability) || {}, { level: null });
    return o;
  }
  function assertApplied(m, id, params) {
    if (on(params) && !(m.dur && m.dur.baseFromRecord)) throw new Error("durability: walk-forward record not applied for " + id);
  }
  // convenience: set opts.dur / opts.params for a backtest fight in place; returns opts
  function apply(opts, id, swap) {
    if (on(opts.params)) { opts.dur = rec(id, swap); opts.params = withNorm(opts.params); }
    return opts;
  }
  return { on, rec, withNorm, relative, assertApplied, apply };
};
