#!/usr/bin/env node
/* VAULT AUDIT 2 (auditor only): JS-side pieces of the audit-2 score, per vault fight.

     node tools/vault_audit2/aux_vault.js [--vault <dir>]   ->  <vault>/audit2/aux_vault.json

   1. Props pool benchmark (src/ml/propspool.js, data/derived/props.json production parameters, fit 2021-2025) at the closing-line
      winner, with the production S2 cells (mr_s2.json js_model, fit 2012..2025) as the model; next to S2 composed with the same winner
      (PP.compose), exactly as vault audit 1 did with the S2 fold fit < 2024. Props = market_vault's consensus method6.
   2. Wiring check of the cmp4 records: the MoE switch stack fit through 2025 (versions/v7-gate-failed/ml/moe.js) recomputed from the
      experts, the line and the record's own simulator P(A) must equal the harness's p in every regime. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const vi = args.indexOf("--vault");
const VAULT = vi >= 0 ? args[vi + 1] : "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const AUD1 = path.join(VAULT, "audit1"), AUD = path.join(VAULT, "audit2");
const J = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const PP = require(path.join(ROOT, "src/ml/propspool.js"));
const PJ = J("data/derived/props.json");
const pool = PP.create(PJ.model);
const MoE = require(path.join(ROOT, "versions/v7-gate-failed/ml/moe.js"));
const STK = J(path.join(AUD, "cmp_stack_v4pkg_fit2025.json"));
const mClose = MoE.load(STK, "model"), mOpen = MoE.load(STK, "model_open");
const BT = J(path.join(VAULT, "backtest_vault.json")).fights;
const MK = J(path.join(VAULT, "market_vault.json")).fights;
const S2 = J(path.join(AUD, "ml2s2_vault.json")).fights;
const MV = J(path.join(AUD1, "models_vault.json")).fights;
const H = new Map(J(path.join(AUD, "harness_vault.json")).fights.map((r) => [r.id, r]));
const isNum = (x) => typeof x === "number" && isFinite(x);
function toModel(c, R) { return { A: { ko: c.slice(0, R), sub: c.slice(R, 2 * R), dec: c[4 * R] }, B: { ko: c.slice(2 * R, 3 * R), sub: c.slice(3 * R, 4 * R), dec: c[4 * R + 1] }, draw: c[4 * R + 2] }; }
function compact(c23, R) { return [].concat(c23.slice(0, R), c23.slice(5, 5 + R), c23.slice(10, 10 + R), c23.slice(15, 15 + R), [c23[20], c23[21], c23[22]]); }
const out = {};
let nProps = 0, wmax = 0, wn = 0;
for (const f of BT) {
  const m = MK[f.id] || {}, s2 = (S2[f.id] || {}).S2, R = f.rounds === 5 ? 5 : 3;
  const e = {};
  const pA = isNum(m.p_power_close) ? m.p_power_close : null;
  if (s2 && pA !== null) {
    const mdl = toModel(s2, R), fc = PP.fromCells(mdl);
    e["S2@close"] = compact(PP.compose(pA, fc.M, fc.R, R, PJ.model.draw_c), R);
    if (Array.isArray(m.method6) && m.method6.length === 6) {
      const r = pool.predict({ pA, rounds: R, model: mdl, props: { m6: m.method6, n_books: { m6: m.method_books || 1 } }, params: "production" });
      e["props_pool@close"] = compact(r.cells, R);
      nProps++;
    }
  }
  // cmp4 wiring
  const h = H.get(f.id), mv = MV[f.id];
  if (h && !h.err && mv) {
    for (const kind of ["close", "open", "none"]) {
      const rec = h.pk.cmp4[kind];
      const ex = { mkt_rating: mv.mkt_rating, engine: rec.simP, ml: mv.ml_lr, feat_lr: mv.feat_lr, elo_sig: mv.elo_sig, elo: mv.elo };
      for (const k in ex) if (!isNum(ex[k])) delete ex[k];
      let p;
      if (kind === "none") p = mClose.predict({ experts: ex }).p;
      else p = (kind === "close" ? mClose : mOpen).predict({ experts: Object.assign({ market: rec.line }, ex) }).p;
      wmax = Math.max(wmax, Math.abs(p - rec.p)); wn++;
    }
  }
  out[f.id] = e;
}
fs.writeFileSync(path.join(AUD, "aux_vault.json"), JSON.stringify({ meta: { tool: "tools/vault_audit2/aux_vault.js", built: new Date().toISOString(),
  n_props: nProps, params: "props.json model.params_production (fit 2021-2025)", s2: "mr_s2.json js_model (production, fit 2012..2025)",
  cmp4_moe_recompute_max_abs: wmax, cmp4_moe_recompute_n: wn }, fights: out }));
console.log("aux_vault: props pool on " + nProps + " fights; cmp4 MoE recomputation max |diff| " + wmax.toExponential(2) + " over " + wn + " fight x regime rows");
