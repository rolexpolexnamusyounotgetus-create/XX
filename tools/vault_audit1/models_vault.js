#!/usr/bin/env node
/* VAULT AUDIT 1 (auditor only): every frozen winner model's P(A wins) on the 2026 vault fights, from frozen files only.

     node tools/vault_audit1/models_vault.js [--vault <dir>]

   Inputs per fight (A = first ufcstats name, as in backtest_vault.json):
     close        market_vault p_power_close (power de-vig of the mean BFO closing line; pre-fight capture), p_novig_close kept too
     open         market_vault p_novig_open (multiplicative no-vig opener)
     elo          MoE.eloProb on backtest_vault pre-fight Elo (build_db K 44, boost 1.5)
     elo_sig      ml_vault elo_sig (strike-share margin Elo, walk-forward)
     ml_lr        ML v1 logistic: ml_vault lr_refit (January refit on every fight before 2026 = production) ; ml_lr_2023 = lr (fit 2010-2023)
     mkt_rating   market_vault p_market_rating (walk-forward Kalman on earlier closes)
     feat_lr      src/ml/moe.js featLR(moe_page.json feat, coef = production fit 2010-2025, priors = 2021-2025 division rates) on side
                  records = backtest_vault side + tools/vault_audit1/sides_vault.py counters
     engine_v4    <vault>/audit1/evalv/v4_vault.json pA (engine 4.0.0, 300 sims per corner order; the stacks' engine expert)
     ml2_lr       <vault>/audit1/ml2_vault.json ml2_lr_prod (page model, fit 2010-2025); ml2_lr_static (fit 2010-2023)
     whr_rounds   ratings_vault p.whr_rounds; ratings_stack = ratings_vault p.stack
   Stacks (frozen, nothing refit; evaluated with the frozen src/ml/moe.js of versions/v5-rejected = src/ml/moe.js):
     stack_close / stack_open / stack_noline = data/derived/blindtest_stack.json `model` (close fed), `model_open` (open fed), absent block
     moe_page_noline = data/derived/moe_page.json model, absent block (h 1.5, T 1.1667)
     ml2_stack_{close,open,noline}_static = forward_models.json ml2_static weights (fit 2019-2023), fed ml2_lr (prod) as the ledger does;
     ..._static_static = the same weights fed ml2_lr_static (the 2024-25 validation configuration)
     ml2_stack_{close,open,noline}_prod = ml2.json page_model.stack (fit 2019-2025), fed ml2_lr (prod)
   Output: <vault>/audit1/models_vault.json */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const vi = args.indexOf("--vault");
const VAULT = vi >= 0 ? args[vi + 1] : "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const AUD = path.join(VAULT, "audit1");
const J = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const R = (rel) => J(path.join(ROOT, rel));
const MoE = require(path.join(ROOT, "versions/v5-rejected/ml/moe.js"));
const BT = J(path.join(VAULT, "backtest_vault.json"));
const MK = J(path.join(VAULT, "market_vault.json")).fights;
const MLV = J(path.join(VAULT, "ml_vault.json")).fights;
const RV = J(path.join(VAULT, "ratings_vault.json")).fights;
const SIDES = J(path.join(AUD, "sides_vault.json")).fights;
const ENG = new Map(J(path.join(AUD, "evalv", "v4_vault.json")).fights.map((x) => [x.id, x.pA]));
const ML2 = J(path.join(AUD, "ml2_vault.json")).fights;
const STK = R("data/derived/blindtest_stack.json");
const MP = R("data/derived/moe_page.json");
const FM = R("data/derived/forward_models.json").ml2_static;
const PROD = R("data/derived/ml2.json").page_model.stack;
const mClose = MoE.load(STK, "model"), mOpen = MoE.load(STK, "model_open"), mPage = MoE.load(MP);
const isNum = (x) => typeof x === "number" && isFinite(x);
const clip = (x, a, b) => Math.min(b, Math.max(a, x));
const logit = (p) => Math.log(p / (1 - p));
const sig = (z) => 1 / (1 + Math.exp(-z));
function stackP(st, inp) {               // src/ml/ml2.js stackP / blend.js ml2StackP
  let z = 0; const pc = st.pclip || 0.01;
  for (let i = 0; i < st.inputs.length; i++) {
    const q = inp[st.inputs[i]];
    if (!isNum(q)) { if (st.inputs[i] === "market" || st.inputs[i] === "open") return null; continue; }
    z += st.weights[i] * logit(clip(q, pc, 1 - pc));
  }
  return sig(z);
}
function side(f, t) {
  const s = f[t], c = (SIDES[f.id] || {})[t] || {};
  return { S: s.S, age: s.age, height_in: s.height_in, reach_in: s.reach_in, n: s.n, ko_losses: s.ko_losses, kd_absorbed: s.kd_absorbed,
    elo: s.elo, stance: s.stance, home: s.home, cmin: c.cmin, w: c.w, l: c.l, streak: c.streak, last3: c.last3, n5: c.n5,
    fin_w: c.fin_w, fin_l: c.fin_l, layoff: c.layoff };
}
// feat.keys must equal the backtest S order
const keys = BT.meta.keys;
if (JSON.stringify(MP.feat.keys) !== JSON.stringify(keys)) throw new Error("moe_page feat.keys differ from backtest S keys");
const out = {}, miss = {};
for (const f of BT.fights) {
  const m = MK[f.id] || {}, ml = MLV[f.id] || {}, rv = (RV[f.id] || {}).p || {}, m2 = ML2[f.id] || {};
  const close = isNum(m.p_power_close) ? m.p_power_close : (isNum(m.p_novig_close) ? m.p_novig_close : null);
  const sA = side(f, "A"), sB = side(f, "B");
  const feat = MoE.featLR(MP.feat, sA, sB, { division: f.division, homeA: f.A.home, homeB: f.B.home, coef: "coef" });
  const ex = { mkt_rating: isNum(m.p_market_rating) ? m.p_market_rating : null, engine: ENG.get(f.id), ml: ml.lr_refit,
    feat_lr: feat, elo_sig: ml.elo_sig, elo: MoE.eloProb(f.A.elo, f.B.elo) };
  for (const k in ex) if (!isNum(ex[k])) { miss[k] = (miss[k] || 0) + 1; delete ex[k]; }
  const r = {
    close, close_mult: isNum(m.p_novig_close) ? m.p_novig_close : null, open: isNum(m.p_novig_open) ? m.p_novig_open : null,
    elo: ex.elo, elo_sig: ml.elo_sig, ml_lr: ml.lr_refit, ml_lr_2023: ml.lr, ml_blend: ml.ml_refit, mkt_rating: ex.mkt_rating, feat_lr: feat,
    engine_v4: ENG.get(f.id), ml2_lr: m2.ml2_lr_prod, ml2_lr_static: m2.ml2_lr_static, ml2_blend_static: m2.ml2_blend_static,
    whr_rounds: rv.whr_rounds, ratings_stack: rv.stack,
  };
  r.stack_noline = mClose.predict({ experts: ex }).p;
  const rn = mClose.predict({ experts: ex });
  r.stack_noline_raw = rn.pRaw; r.stack_noline_used = rn.used.join("+");
  r.moe_page_noline = mPage.predict({ experts: ex }).p;
  if (isNum(close)) { const q = mClose.predict({ experts: Object.assign({ market: close }, ex) }); r.stack_close = q.p; r.stack_close_used = q.used.join("+"); }
  if (isNum(r.open)) r.stack_open = mOpen.predict({ experts: Object.assign({ market: r.open }, ex) }).p;
  const inp = { market: close, open: r.open, ml2lr: r.ml2_lr, mkt_rating: m2.mr != null ? m2.mr : ex.mkt_rating };
  const inpS = Object.assign({}, inp, { ml2lr: r.ml2_lr_static });
  for (const [k, kk] of [["close", "line"], ["open", "open"], ["noline", "noline"]]) {
    r["ml2_stack_" + k + "_static"] = stackP(FM[kk], inp);
    r["ml2_stack_" + k + "_static_static"] = stackP(FM[kk], inpS);
    r["ml2_stack_" + k + "_prod"] = stackP(PROD[kk], inp);
  }
  r.mr_ml2 = m2.mr;
  out[f.id] = r;
}
fs.writeFileSync(path.join(AUD, "models_vault.json"), JSON.stringify({ meta: { tool: "tools/vault_audit1/models_vault.js", built: new Date().toISOString(),
  missing_experts: miss, n: Object.keys(out).length,
  stack_built: STK.meta.built, moe_page_built: MP.meta.built, forward_models_built: R("data/derived/forward_models.json").meta.built }, fights: out }));
console.log("models_vault: " + Object.keys(out).length + " fights; missing experts " + JSON.stringify(miss));
