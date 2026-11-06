#!/usr/bin/env node
/* forward_ledger.js: the page's forecast package for upcoming bouts, evaluated in Node (called by tools/forward_ledger.py).

     node tools/forward_ledger.js <input.json> [--engine-dir src]      -> JSON on stdout

   input.json = { date: "YYYY-MM-DD", sims: 2000, bouts: [{ bout_id, a, b, division, rounds, title, p_line }] }
   a / b are data/derived/fighters.json slugs (null or unknown = UFC debut), p_line the de-vigged market P(a) or null.

   Per bout, exactly what the page computes (src/app.js expertsFor + computeBlend):
   - experts: feat_lr (MoE.featLR on fighters.json profiles), elo, ml + elo_sig (MLPage on ml.json's page model and
     roster), mkt_rating (market.json ratings), engine (FightEngine.summarize with the learned stat-line rates, both
     corner orders averaged; draws removed);
   - the MoE stack (data/derived/moe_page.json) without the line and, when p_line is given, with it as 'market';
   - the method-and-round model (tools/methodround_model.js; S without the line, SM with it), scaled to the stack's
     winner probability (head.bins7, finishing round, distance), as the page's headline does.
   A bout with a debutant gets no stack (the stack never saw a debut; the ledger falls back to its debut prior). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const engineDir = path.resolve(ROOT, opt("--engine-dir", "src"));
const E = require(path.join(engineDir, "engine3.js"));
const MLRates = require(path.join(engineDir, "ml", "mlrates.js"));
const MoE = require(path.join(ROOT, "src/ml/moe.js"));
const MLPage = require(path.join(ROOT, "src/ml/mlpage.js"));
const MRm = require(path.join(ROOT, "tools/methodround_model.js"));
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const sha = (p) => crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex").slice(0, 16);

const input = JSON.parse(fs.readFileSync(args[0], "utf8"));
const FJ = rd("data/derived/fighters.json");
const DB = E.loadDB(FJ);
let mlNative = false;
const mlr = rd("data/derived/mlrates.json");
if (typeof E.loadMLRates === "function") { E.loadMLRates(mlr); mlNative = true; } else MLRates.load(mlr);
const MOEJ = rd("data/derived/moe_page.json");
const MOE = MoE.load(MOEJ);
const mlj = rd("data/derived/ml.json");
const MLP = MLPage.load({ snapshot: mlj.page_model.snapshot, winner: mlj.page_model.winner, stack: mlj.page_model.stack,
  roster: mlj.roster });
const MKT = rd("data/derived/market.json");
const MKTR = {};
for (const s in MKT.ratings) { const r = MKT.ratings[s]; if (Array.isArray(r) && r.length >= 2) MKTR[s] = [r[0], r[1]]; }
const mrj = rd("data/derived/methodround.json").js_model;
const jm = Object.assign({}, mrj); delete jm.source;
const MR = MRm.create(jm);
const LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170, "Middleweight": 185,
  "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115, "Women's Flyweight": 125, "Women's Bantamweight": 135,
  "Women's Featherweight": 145 };

function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
const r5 = (x) => (x == null || !isFinite(x)) ? null : Math.round(x * 1e5) / 1e5;
const sum = (a) => a.reduce((x, y) => x + y, 0);

function engineRun(pa, pb, ctx, N, id) {
  const one = (x, y, k) => {
    const o = { division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date };
    if (mlNative) {
      const M = E.mlModel ? E.mlModel() : MLRates.model();
      const p = MLRates.predict(M, x, y, { division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date, priors: DB.priors });
      o.ml = { pred: { A: p.A, B: p.B, base: p.base } };
    }
    return E.summarize(E.matchup(x, y, o), N, seedOf(id, k));
  };
  const s1 = one(pa, pb, 1), s2 = one(pb, pa, 2);
  const bins = s1.bins.map((v, i) => 0.5 * (v + s2.bins[6 - i]));
  const finA = s1.finA.map((v, i) => 0.5 * (v + s2.finB[i])), finB = s1.finB.map((v, i) => 0.5 * (v + s2.finA[i]));
  const pA = 0.5 * (s1.pA + s2.pB), pB = 0.5 * (s1.pB + s2.pA), pD = 0.5 * (s1.pD + s2.pD);
  return { pA, pB, pD, bins, finA, finB, dist: 0.5 * (s1.dist + s2.dist), pA_ab: s1.pA, pA_ba: s2.pB, n: 2 * N,
    mlApplied: mlNative };
}

function headFrom(p, mr, eng) {
  // src/app.js computeBlend: the stack's winner odds, the draw share and method/round cells of the method-and-round model
  if (p == null) return null;
  const pD = mr ? mr.pDraw : (eng ? eng.pD : 0.008);
  const qA = p * (1 - pD), qB = (1 - p) * (1 - pD);
  const h = { pA: qA, pB: qB, pD, src: null };
  if (mr) {
    const c = mr.cells, fA = qA / Math.max(1e-9, mr.pA), fB = qB / Math.max(1e-9, mr.pB);
    h.src = "methodround_" + mr.variant;
    h.bins7 = [sum(c.A.ko) * fA, sum(c.A.sub) * fA, c.A.dec * fA, pD, c.B.dec * fB, sum(c.B.sub) * fB, sum(c.B.ko) * fB];
    h.finA = c.A.ko.map((v, i) => (v + c.A.sub[i]) * fA);
    h.finB = c.B.ko.map((v, i) => (v + c.B.sub[i]) * fB);
  } else if (eng) {
    const f = MoE.winnerFactors(eng.pA, eng.pB, eng.pD, p);
    h.src = "engine";
    h.bins7 = eng.bins.map((v, i) => (i < 3 ? v * f.fA : (i > 3 ? v * f.fB : v)));
    h.finA = eng.finA.map((v) => v * f.fA); h.finB = eng.finB.map((v) => v * f.fB);
  }
  if (h.bins7) {
    h.p_distance = h.bins7[2] + h.bins7[3] + h.bins7[4];
    h.p_method = { a_ko: h.bins7[0], a_sub: h.bins7[1], a_dec: h.bins7[2], b_ko: h.bins7[6], b_sub: h.bins7[5], b_dec: h.bins7[4], draw: h.bins7[3] };
  }
  return h;
}

function roundObj(o) {
  if (Array.isArray(o)) return o.map(roundObj);
  if (o && typeof o === "object") { const q = {}; for (const k in o) q[k] = roundObj(o[k]); return q; }
  return typeof o === "number" ? r5(o) : o;
}

const out = { meta: {
  engine_dir: path.relative(ROOT, engineDir) || ".", engine_version: E.VERSION,
  params_version: (() => { try { return require(path.join(engineDir, "params3.js")).version; } catch (e) { return null; } })(),
  engine_sha256_16: sha(path.join(engineDir, "engine3.js")), params_sha256_16: sha(path.join(engineDir, "params3.js")),
  mlrates_js_sha256_16: sha(path.join(engineDir, "ml", "mlrates.js")),
  moe_page_built: (MOEJ.meta || {}).built || null, moe_js: MoE.VERSION, ml_page_snapshot: mlj.page_model.snapshot,
  ml_built: mlj.meta.built, market_built: MKT.meta.built, methodround_built: (rd("data/derived/methodround.json").meta || {}).built,
  roster_snapshot: (FJ.meta || {}).snapshot, mlrates_native: mlNative, sims_per_order: input.sims
}, bouts: [] };

for (const b of input.bouts) {
  const pa = b.a ? DB.fighters[b.a] : null, pb = b.b ? DB.fighters[b.b] : null;
  const ctx = { division: b.division, rounds: b.rounds === 5 ? 5 : 3, title: !!b.title, date: input.date };
  const r = { bout_id: b.bout_id, debut_a: !pa, debut_b: !pb, experts: {}, notes: [] };
  if (!pa || !pb) { r.notes.push("debut: not in fighters.json, no stack"); out.bouts.push(r); continue; }
  const o = { keys: FJ.meta.keys, snapshot: FJ.meta.snapshot, halfLife: FJ.meta.half_life_days || 730 };
  const A = MoE.sideFromProfile(pa, ctx.date, o), B = MoE.sideFromProfile(pb, ctx.date, o);
  const ex = r.experts;
  try { const fl = MoE.featLR(MOEJ.feat, A, B, { division: ctx.division, homeA: A.home, homeB: B.home }); if (isFinite(fl)) ex.feat_lr = fl; } catch (e) { r.notes.push("feat_lr failed"); }
  ex.elo = MoE.eloProb(A.elo, B.elo);
  const lbs = LBS[ctx.division] || 155;
  const ml = MLP.predict(b.a, b.b, { date: ctx.date, lbs, five: ctx.rounds === 5 ? 1 : 0, title: ctx.title ? 1 : 0,
    women: /^Women/.test(ctx.division || "") ? 1 : 0, "catch": LBS[ctx.division] ? 0 : 1 });
  if (ml && ml.pEloSig != null && isFinite(ml.pLR)) { ex.ml = ml.pLR; ex.elo_sig = ml.pEloSig; r.ml_platt = ml.pA; r.ml_stack = ml.pStack; }
  else r.notes.push("no ML page profile");
  const ra = MKTR[b.a], rb = MKTR[b.b];
  if (ra && rb) ex.mkt_rating = MoE.ratingProb(ra[0], ra[1], rb[0], rb[1]); else r.notes.push("no market rating");
  let eng = null;
  try { eng = engineRun(pa, pb, ctx, input.sims || 2000, b.bout_id); ex.engine = eng.pA / Math.max(1e-9, eng.pA + eng.pB); }
  catch (e) { r.notes.push("engine failed: " + (e.message || e)); }
  const gate = MoE.gateFromSides(A, B, { division: ctx.division, rounds: ctx.rounds });
  let rNo = null, rLine = null;
  try { rNo = MOE.predict({ experts: ex, gate }); } catch (e) { r.notes.push("stack (no line) failed: " + e.message); }
  const hasLine = b.p_line != null && isFinite(b.p_line);
  if (hasLine) { try { rLine = MOE.predict({ experts: Object.assign({}, ex, { market: b.p_line }), gate }); } catch (e) { r.notes.push("stack (line) failed: " + e.message); } }
  let mrS = null, mrSM = null;
  try { mrS = MR.predict(pa, pb, { slugA: b.a, slugB: b.b, division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date }); } catch (e) { r.notes.push("methodround S failed"); }
  if (hasLine) { try { mrSM = MR.predict(pa, pb, { slugA: b.a, slugB: b.b, division: ctx.division, rounds: ctx.rounds, title: ctx.title, date: ctx.date, pMarketA: b.p_line }); } catch (e) { r.notes.push("methodround SM failed"); } }
  r.stack_noline = rNo ? { p: rNo.p, weights: rNo.weights, used: rNo.used, regime: rNo.regime } : null;
  r.stack_line = rLine ? { p: rLine.p, weights: rLine.weights, used: rLine.used, regime: rLine.regime } : null;
  r.head_noline = headFrom(rNo ? rNo.p : null, mrS, eng);
  r.head_line = headFrom(rLine ? rLine.p : null, mrSM || mrS, eng);
  r.engine = eng ? { pA: eng.pA, pB: eng.pB, pD: eng.pD, bins7: eng.bins, finA: eng.finA, finB: eng.finB, dist: eng.dist,
    pA_ab: eng.pA_ab, pA_ba: eng.pA_ba, n: eng.n, ml_applied: eng.mlApplied } : null;
  r.methodround_S = mrS ? { pA: mrS.pA, pB: mrS.pB, pDraw: mrS.pDraw, bins7: mrS.bins7 } : null;
  r.mr_extras = { a: !!(MR.model.extras || {})[b.a], b: !!(MR.model.extras || {})[b.b] };
  out.bouts.push(roundObj(r));
}
process.stdout.write(JSON.stringify(out));
