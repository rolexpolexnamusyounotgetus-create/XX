/* VAULT AUDIT 2 (auditor only): FightEngine.predict inputs for the sealed 2026 fights, with the API of tools/predictrec.js
   (opts(f, swap, {lineKind})), every object fit through 2025-12-31 by the frozen production procedure (vault_audits[1].fits).
   Used only by the audit-2 predict harness (tools/vault_audit2/harness_vault.js). Never writes anything.

     stack     <vault>/audit2/cmp_stack_v4pkg_fit2025.json (cmp4's MoE stacker, tools/vault_audit2/cmp_stack_2025.py)
     lineKind  'close' = market_vault p_power_close, 'open' = p_novig_open, 'none' (as tools/predictrec.js)
     experts   the frozen experts at 2025-12-31 (audit 1's per-fight values, <vault>/audit1/models_vault.json): ml = ML v1 lr_refit
               (January refit on every fight before 2026), elo_sig, feat_lr (moe_page production coef 2010-2025), elo (pre-fight),
               mkt_rating (walk-forward Kalman); engine = the package's own simulator (predict)
     mrCells   methodround.json S_refit (SM_refit with a closing line), the Jan-1 refit through 2025-12-31 (never js_model)
     ml2       ML v2 production logistic (ml2.json page_model, fit 2010-2025) + market rating, with forward_models.json ml2_static
     v6 / v7   winnerStacks = data/derived/v6_stacks.json with by_fit_year["2026"] = its production block (fit 2019-2025, the prereg's
               "ML v2 head-stack weights = v6_stacks.json production block"); ml2 = { pA: production logistic, pBlend: production blend
               (page LR + trees refit through 2025 = ml2_trees.json), pMR }; mrCells = S2 production (mr_s2.json js_model, fit 2012..2025);
               props (v7 / v10) = market_vault's consensus method6 (BFO pre-fight method props, power de-vig; per-book 2026 props are not in
               the repository) */
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = function predictrecVault(E, root, cfg) {
  cfg = cfg || {};
  const ROOT = root || path.resolve(__dirname, "..", "..");
  const VAULT = cfg.vault || "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
  const AUD1 = path.join(VAULT, "audit1"), AUD = path.join(VAULT, "audit2");
  const cache = {};
  function J(p) { if (!(p in cache)) cache[p] = JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8")); return cache[p]; }
  const isNum = (x) => typeof x === "number" && isFinite(x);
  const flip = (p) => (isNum(p) ? 1 - p : p);
  const FIT_THROUGH = "2025-12-31";
  function guard(f) { if (!(f.date >= "2026-01-01" && f.date < "2026-11-01")) throw new Error("predictrec_vault: vault fights only, got " + f.date); }
  function stackDoc() { return J(path.join(AUD, "cmp_stack_v4pkg_fit2025.json")); }
  function experts(f) {
    const m = J(path.join(AUD1, "models_vault.json")).fights[f.id];
    if (!m) throw new Error("predictrec_vault: no audit-1 expert row for " + f.id);
    const ex = {};
    for (const [name, key] of [["ml", "ml_lr"], ["elo_sig", "elo_sig"], ["feat_lr", "feat_lr"], ["elo", "elo"], ["mkt_rating", "mkt_rating"]]) if (isNum(m[key])) ex[name] = m[key];
    if (!(isNum(ex.ml) && isNum(ex.elo_sig))) { delete ex.ml; delete ex.elo_sig; }
    return ex;
  }
  function line(f, kind) {
    if (!kind || kind === "none") return null;
    const mk = J(path.join(VAULT, "market_vault.json")).fights[f.id] || {};
    const q = kind === "close" ? (isNum(mk.p_power_close) ? mk.p_power_close : mk.p_novig_close) : kind === "open" ? mk.p_novig_open : undefined;
    if (q === undefined) throw new Error("predictrec_vault: lineKind must be close / open / none");
    return isNum(q) ? q : null;
  }
  function mirror(c, R) {
    const q = new Array(c.length);
    for (let i = 0; i < R; i++) { q[i] = c[2 * R + i]; q[2 * R + i] = c[i]; q[R + i] = c[3 * R + i]; q[3 * R + i] = c[R + i]; }
    q[4 * R] = c[4 * R + 1]; q[4 * R + 1] = c[4 * R]; q[4 * R + 2] = c[4 * R + 2];
    return q;
  }
  function mrCells(f, kind) {
    const r = J("data/derived/methodround.json").fights[f.id];
    if (!r) return { cells: null };
    const R = r.rounds || f.rounds || 3, key = kind === "close" && Array.isArray(r.SM_refit) ? "SM_refit" : "S_refit", c = r[key];
    if (!Array.isArray(c) || c.length !== 4 * R + 3) return { cells: null };
    return { cells: c, variant: key, fitThrough: FIT_THROUGH, R };
  }
  function ml2row(f) {
    const r = J(path.join(AUD, "ml2s2_vault.json")).fights[f.id];
    if (!r || !isNum(r.ml2_lr_prod) || !isNum(r.ml2_blend_prod)) throw new Error("predictrec_vault: no ML v2 production row for " + f.id);
    const mk = J(path.join(VAULT, "market_vault.json")).fights[f.id] || {};
    return { pA: r.ml2_lr_prod, pBlend: r.ml2_blend_prod, pMR: isNum(mk.p_market_rating) ? mk.p_market_rating : null, S2: r.S2, R: r.rounds };
  }
  let W26 = null;
  function winnerStacks() {
    if (W26) return W26;
    const W = J("data/derived/v6_stacks.json"), out = { meta: W.meta, stacks: {} };
    for (const [k, blk] of Object.entries(W.stacks)) {
      const by = Object.assign({}, blk.by_fit_year);
      if (!blk.production || blk.production.fit_through !== "2025-12-31") throw new Error("predictrec_vault: v6_stacks " + k + " has no production block fit through 2025");
      by["2026"] = Object.assign({}, blk.production, { scores: "2026 (vault audit 2: the production block)" });
      out.stacks[k] = Object.assign({}, blk, { by_fit_year: by });
    }
    W26 = out;
    return W26;
  }
  function v6opts(f, swap, out) {
    out.winnerStacks = winnerStacks(); out.winnerFit = 2026;
    const r = ml2row(f);
    const m2 = { pA: r.pA, pBlend: r.pBlend, pMR: r.pMR };
    out.ml2 = swap ? { pA: 1 - m2.pA, pBlend: 1 - m2.pBlend, pMR: flip(m2.pMR) } : m2;
    out.ml2Schedule = "production (fit through 2025)";
    if (!Array.isArray(r.S2) || r.S2.length !== 4 * r.R + 3) throw new Error("predictrec_vault: no S2 cells for " + f.id);
    out.mrCells = swap ? mirror(r.S2, r.R) : r.S2.slice();
    out.mrVariant = "S2"; out.mrFitThrough = FIT_THROUGH; out.mrModel = "S2";
    return out;
  }
  function v7opts(f, swap, out) {
    v6opts(f, swap, out);
    const mk = J(path.join(VAULT, "market_vault.json")).fights[f.id] || {};
    if (Array.isArray(mk.method6) && mk.method6.length === 6) {
      const props = { m6: mk.method6, gd: isNum(mk.p_dec) ? mk.p_dec : null, n_books: { m6: mk.method_books || 1 } };
      const FB = require(path.join(ROOT, cfg.blendPath || "src/ml/blend.js"));
      out.props = swap ? FB.mirrorProps(props, f.rounds) : props;
    }
    return out;
  }
  function opts(f, swap, o) {
    o = o || {};
    guard(f);
    const kind = o.lineKind || "none";
    const ex = experts(f), q = line(f, kind), mr = mrCells(f, kind), m2 = ml2row(f);
    const out = { backtest: true, date: f.date, stack: stackDoc(), lineKind: kind, experts: {} };
    if (kind !== "none" && q === null) { out.lineKind = "none"; out.lineMissing = kind; }
    else if (q !== null) out.pMarket = swap ? 1 - q : q;
    for (const k in ex) out.experts[k] = swap ? flip(ex[k]) : ex[k];
    out.mrCells = mr.cells ? (swap ? mirror(mr.cells, mr.R) : mr.cells.slice()) : false;
    if (mr.cells) { out.mrVariant = mr.variant; out.mrFitThrough = mr.fitThrough; }
    out.ml2 = swap ? { pA: 1 - m2.pA, pMR: flip(m2.pMR) } : { pA: m2.pA, pMR: m2.pMR };
    const FM = J("data/derived/forward_models.json");
    if (FM && FM.ml2_static) out.ml2Stack = FM.ml2_static;
    if (cfg.v7) v7opts(f, swap, out);
    else if (cfg.v6) v6opts(f, swap, out);
    return out;
  }
  return { opts, experts, line, mrCells, mirror, v7opts, winnerStacks };
};
