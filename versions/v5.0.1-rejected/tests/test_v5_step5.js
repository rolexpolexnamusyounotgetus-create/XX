#!/usr/bin/env node
/* test_v5_step5.js: engine v5 merge step 5 (params.components.blend_anchor: FightEngine.predict, the prediction package with
   the ML v2 package's winner blend), flag-off identity and package checks.

   Identity: the component adds FightEngine.predict / loadBlend and never touches matchup / simulate / summarize / explain.
   R0. The step-4 engine (tests/fixtures/engine3_pre_blend_anchor.js, a frozen copy of src/engine3.js at commit 6210f69
       "v5 merge: step 4 embed + oppadj + preufc") on the current params3.js and mlrates.js: whole fight objects (JSON incl. the
       per-round trace) for fixed seeds, traced and untraced, a shared rng stream across fights, summarize() and explain(), with
       blend_anchor OFF and ON, over
         a. random fighter pairs with the production learned rates, the live durability roster, random SOS and step-4 inputs,
         b. random pairs on the plain tables with the same kinds of inputs,
         c. 2019-2023 backtest fights x 2 corner orders with the out-of-fold learned rates, as-of priors, durability records +
            train NORM, walk-forward SOS pairs and the step-4 walk-forward inputs (the tools/evalv.js path).
       predict() with the flag off = R0.summarize(R0.matchup(...)) (the public matchup, so SOS inputs count).
   R0s. The same, strict: the step-4 engine on step 4's OWN params3.js and ml/mlrates.js (git show 6210f69; skipped without git).
   Package (flag on): the stack block follows opts.lineKind (close -> blindtest_stack `model`, open -> `model_open`, none -> the
   no-line block) and reproduces MoE.load(...).predict on the reported experts; the line needs an explicit lineKind; de-vig by
   kind; exact corner symmetry (p, 7 bins, interval) for every kind; ML v2 = src/ml/ml2.js; winner 'ml2'; the v5 per-call inputs
   swap with the corners inside predict (the B-A run equals the harness's own swapped matchup); the backtest guard refuses
   production defaults, a stacker fit after 2023 or containing the fight, missing method/round cells, live ML v2 and 2026;
   tools/predictrec.js inputs (pre-2024 stacker, walk-forward experts and cells, mirrored with the corners).
     node tests/test_v5_step5.js [matchups per random group, default 150]   (a few minutes) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const FB = require(path.join(ROOT, "src/ml/blend.js"));
const MoE = require(path.join(ROOT, "src/ml/moe.js"));
const ML2 = require(path.join(ROOT, "src/ml/ml2.js"));
const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
const NM = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 150);

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function git(args) {
  try { return require("child_process").execFileSync("git", ["-C", ROOT].concat(args), { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 }); }
  catch (e) { return null; }
}
function loadEngine(src, mods) {
  const mod = { exports: {} };
  const req = (p) => {
    if (mods) for (const k in mods) if (p.endsWith(k)) return mods[k];
    return require(p.startsWith(".") ? path.join(ROOT, "src", p) : p);
  };
  new Function("module", "exports", "require", src)(mod, mod.exports, req);
  return mod.exports;
}
function loadModule(src) { const mod = { exports: {} }; new Function("module", "exports", "require", src)(mod, mod.exports, require); return mod.exports; }
const fx = (f) => fs.readFileSync(path.join(ROOT, "tests/fixtures", f), "utf8");
const R0 = loadEngine(fx("engine3_pre_blend_anchor.js"));   // step 4
let R0s = null;
{
  const g = git(["show", "6210f69:src/engine3.js"]);
  check("fixture engine3_pre_blend_anchor.js is src/engine3.js of the step-4 commit 6210f69", g === null || g === fx("engine3_pre_blend_anchor.js"),
    g === null ? "git not reachable, skipped" : "byte for byte");
  const gp = git(["show", "6210f69:src/params3.js"]), gm = git(["show", "6210f69:src/ml/mlrates.js"]);
  if (g && gp && gm) R0s = loadEngine(g, { "params3.js": loadModule(gp), "ml/mlrates.js": loadModule(gm) });
  check("reference engine loads (step 4: no predict) and the merged engine has predict + loadBlend",
    typeof R0.predict !== "function" && typeof R0.loadPreUFC === "function" && typeof E.predict === "function" && typeof E.loadBlend === "function",
    `versions ${R0.VERSION} / ${E.VERSION}; strict step-4 params ${R0s ? R0s.params().version : "skipped"}`);
}
// v5 Calibrate B rebuilt blend_anchor on the final engine (research/v5_calB.md): mrWeight 0.3, kappa 2.15 (step 5: 0.15, 1.65)
check("params: one components block, blend_anchor on, earlier components unchanged; blend settings (mrWeight 0.15 / Calibrate B 0.3, recalT 1, kappa 1.65 / Calibrate B 2.15)",
  FP.components.blend_anchor === true && FP.components.embed === true && FP.components.oppadj === false && FP.components.durability === true &&
  FP.components.dynamics === true && FP.components.officials === false && FP.components.realism_sens === false && FP.components.v401 &&
  FP.components.styles_sos && FP.components.styles_sos.sos === true && (FP.components.calB ? FP.blend.mrWeight === 0.3 && FP.blend.boot.inflate === 2.15 : FP.blend.mrWeight === 0.15 && FP.blend.boot.inflate === 1.65) && FP.blend.recalT === 1 &&
  (fs.readFileSync(path.join(ROOT, "src/params3.js"), "utf8").match(/^\s{4}components:\s*\{/mg) || []).length === 1, JSON.stringify(Object.keys(FP.components)));

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
const ENGS = [E, R0].concat(R0s ? [R0s] : []);
for (const e of ENGS) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
const DUR = readJSON("data/derived/durability.json");
const NORM = { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 };

// ------------------------------------------------------------------ matchup generators (as tests/test_v5_step4.js)
const rng = E.makeRng(20261107 ^ 5);
const DB = JSON.parse(dbJson);
const slugs = Object.keys(DB.fighters).filter((s) => DB.fighters[s] && DB.fighters[s].n_fights >= 1).sort();
const DIVS = Object.keys(DB.priors).filter((d) => !["ALL", "Catch Weight", "Open Weight"].includes(d));
function pick(a) { return a[Math.floor(rng.u() * a.length)]; }
const bt = readJSON("data/derived/backtest_dev.json");
const train = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");   // train years only (hidden-data protocol)
for (const f of train) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
function randSos() { const mk = () => [0, 1, 2, 3, 4].map(() => [0.3 * (rng.u() - 0.5), 5 + 60 * rng.u()]); return { a: mk(), o: mk() }; }
function randPre() { const n = Math.floor(30 * rng.u()), kw = Math.floor(n * rng.u()), sw = Math.floor((n - kw) * rng.u()); return { n, ko_w: kw, sub_w: sw, ko_l: Math.floor(4 * rng.u()), n_ufc: Math.floor(4 * rng.u()) }; }
function randStep4(opts) {
  const f = pick(train), e = XR.embedFor(f, rng.u() < 0.5), oa = XR.oppadjFor(f, rng.u() < 0.5);
  opts.embed = { etaA: e.etaA, etaB: e.etaB };
  if (rng.u() < 0.3) opts.embed.recipe = e.recipe;
  opts.oppadj = oa;
  opts.preufc = { A: rng.u() < 0.7 ? randPre() : null, B: rng.u() < 0.7 ? randPre() : null };
}
function randomCase(i) {
  const a = pick(slugs); let b = pick(slugs); while (b === a) b = pick(slugs);
  const fa = DB.fighters[a], div = rng.u() < 0.7 && fa.division && DB.priors[fa.division] ? fa.division : pick(DIVS);
  const rounds = rng.u() < 0.3 ? 5 : 3;
  const opts = { division: div, rounds, title: rounds === 5 && rng.u() < 0.6, date: "2026-11-06", sos: { A: randSos(), B: randSos() } };
  if (rng.u() < 0.25) { opts.adjA = { chin: 0.7 + rng.u(), pow: 0.7 + rng.u() }; opts.adjB = { out: 0.8 + 0.4 * rng.u(), chin: 0.7 + rng.u() }; }
  randStep4(opts);
  return { a, b, opts, seed: 7000 + i };
}
const OOF = readJSON("data/derived/mlrates_oof.json"), TN = OOF.meta.targets;
const priorsAsof = readJSON("data/derived/mlcal_priors_asof.json");
const rates = (arr) => { const o = {}; TN.forEach((n, k) => { o[n] = arr[k]; }); return o; };
function durRec(id, o) {
  const d = DUR.backtest[id];
  if (!d) return null;
  const side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
  const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
  const base = Math.sqrt(bA * bB);
  return o === 0 ? { A: side(d.A), B: side(d.B), base } : { A: side(d.B), B: side(d.A), base };
}
const ALL4 = { components: { embed: true, oppadj: true, preufc: true, styles_sos: { sos: false } } };
function btCase(f, o) {
  const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A, ent = OOF.fights[f.id];
  const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priorsAsof[f.date.slice(0, 4)] };
  opts.ml = ent && ent.A && ent.B ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false;
  const rec = durRec(f.id, o);
  if (rec) { opts.dur = rec; opts.params = { durability: NORM }; }
  SR.apply(opts, f, o === 1);
  XR.apply(opts, f, o === 1, ALL4);
  return { a: A, b: B, opts, seed: (parseInt(f.id.slice(0, 8), 16) ^ (o * 0x9e3779b1)) >>> 0, hasRec: !!rec, f };
}

// ------------------------------------------------------------------ comparison
const SEEDS = 6;
function fights(eng, m, seed) {
  const out = [];
  for (let k = 0; k < SEEDS; k++) out.push(JSON.stringify(eng.simulate(m, eng.makeRng(seed * 31 + k), k % 2 === 1)));
  const r = eng.makeRng(seed + 7); for (let k = 0; k < 4; k++) out.push(JSON.stringify(eng.simulate(m, r, k % 2 === 0)));
  return out;
}
function withParams(opts, params) {
  const o = Object.assign({}, opts), p = Object.assign({}, opts.params || {});
  for (const k in params) p[k] = (p[k] && typeof p[k] === "object" && !Array.isArray(p[k])) ? Object.assign({}, p[k], params[k]) : params[k];
  o.params = p; return o;
}
const OFF = { components: { blend_anchor: false } }, ON = { components: { blend_anchor: true } };
function runGroup(label, REF, refName, FLAG, cases, ctx) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, badPred = 0, nPred = 0, firstBad = null, applied = 0, recs = 0;
  // ctx.pin: components the current engine must take from the reference (the strict groups' v401 sub-flags; see below)
  // v5 Calibrate B: components.calB (a later step: the joint level pass) is off in every comparison with the step-4 engine
  const FE = { components: Object.assign({}, FLAG.components, ctx.pin || {}, { calB: false, v501: false }) };
  const go = () => {
    cases.forEach((c, i) => {
      const mr = REF.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, FE));
      if (mr.mlApplied) applied++;
      if (c.hasRec) recs++;
      const fr = fights(REF, mr, c.seed), fc = fights(E, mc, c.seed);
      nM++; nF += fr.length;
      for (let k = 0; k < fr.length; k++) if (fr[k] !== fc[k]) { bad++; if (!firstBad) firstBad = `case ${i} fight ${k}`; }
      if (i % 10 === 0) {
        nSum++;
        const sr = JSON.stringify(REF.summarize(mr, 150, c.seed)), sc = JSON.stringify(E.summarize(mc, 150, c.seed));
        const xr = JSON.stringify(REF.explain(mr)), xc = JSON.stringify(E.explain(mc));
        if (sr !== sc || xr !== xc) { badSum++; if (!firstBad) firstBad = `summary/explain ${i}`; }
      }
      if (FLAG === OFF && i % 10 === 5) {   // predict with the flag off = summarize(matchup) of the engine before the step
        nPred++;
        const pr = E.predict(c.a, c.b, Object.assign(withParams(c.opts, FE), { sims: 120, seed: c.seed }));
        const s0 = REF.summarize(REF.matchup(c.a, c.b, c.opts), 120, c.seed);
        if (pr.on !== false || JSON.stringify(pr.sim) !== JSON.stringify(s0) || pr.p !== s0.pA / (s0.pA + s0.pB)) { badPred++; if (!firstBad) firstBad = `predict ${i}`; }
      }
    });
  };
  const engs = [REF, E];
  if (ctx.ml) engs.forEach((e) => e.loadMLRates(mlJson));
  if (ctx.roster) engs.forEach((e) => e.loadDurability(DUR));
  try { go(); } finally { engs.forEach((e) => { e.loadMLRates(null); e.loadDurability(null); }); }
  check(`${refName}, blend_anchor ${FLAG === OFF ? "off" : "on"}, ${label}: identical fights (JSON incl. trace), summaries and explain()` +
    (FLAG === OFF ? "; predict = summarize" : ""), bad === 0 && badSum === 0 && badPred === 0,
    `${nM} matchups (${applied} learned rates, ${recs} durability records), ${nF} fights, ${nSum} summaries${FLAG === OFF ? ", " + nPred + " predict calls" : ""}; ` +
    `${bad} fight / ${badSum} summary / ${badPred} predict mismatches${firstBad ? "; first " + firstBad : ""}`);
  return nM;
}
const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
const stp = Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2))));
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % stp === 2 % stp).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }

console.log(`engine ${E.VERSION} (params ${E.params().version}); ${NM} random matchups per group`);
for (const FLAG of [OFF, ON]) {
  let total = 0;
  total += runGroup("a. random pairs, learned rates, durability roster, random SOS + step-4 inputs", R0, "step-4 engine", FLAG, casesA, { ml: true, roster: true });
  total += runGroup("b. random pairs, plain tables, random SOS + step-4 inputs", R0, "step-4 engine", FLAG, casesB, { ml: false, roster: false });
  total += runGroup("c. 2019-2023 backtest fights x 2 corner orders, OOF rates, durability, SOS, step-4 inputs", R0, "step-4 engine", FLAG, casesC, { ml: false, roster: false });
  check(`blend_anchor ${FLAG === OFF ? "off" : "on"}: identity covers >= 300 matchups incl. traced fights`, total >= 300, `${total} matchups`);
}
if (R0s) {
  let total = 0;
  // v5 Calibrate A (research/v5_train_ablation.md) turned components.v401.mlLevels off by default; the strict reference runs on
  // its own params3.js, so the current engine is called with that reference's v401 sub-flags pinned
  const pin = { v401: R0s.params().components.v401 };
  total += runGroup("a (strict)", R0s, "step-4 engine on step 4's own params3.js + mlrates.js", OFF, casesA, { ml: true, roster: true, pin });
  total += runGroup("c (strict)", R0s, "step-4 engine on step 4's own params3.js + mlrates.js", OFF, casesC, { ml: false, roster: false, pin });
  check("strict step-4 reference: >= 300 matchups", total >= 300, `${total} matchups`);
} else console.log("SKIP  strict step-4 reference (git objects not reachable)");

// ------------------------------------------------------------------ package: the ML v2 winner blend by lineKind
const STK = readJSON("data/derived/blindtest_stack.json"), STKPRE = readJSON("data/derived/blindtest_stack_pre2024.json");
const ML2J = readJSON("data/derived/ml2.json"), MOEP = readJSON("data/derived/moe_page.json");
E.loadMLRates(mlJson);
console.log("loadBlend:", JSON.stringify(E.loadBlend({ stack: STK, feat: MOEP, mlPage: readJSON("data/derived/ml.json"), market: readJSON("data/derived/market.json"),
  ml2: ML2J, methodRound: readJSON("data/derived/methodround.json") })));
{
  const A = "alexander-volkanovski", B = "justin-gaethje", base = { division: "Lightweight", rounds: 5, date: "2026-12-12", sims: 300, seed: 11 };
  const line = { oddsA: 160, oddsB: -180 }, lineS = { oddsA: -180, oddsB: 160 };
  const mClose = MoE.load(STK), mOpen = MoE.load(STK, "model_open"), H2 = ML2.load(ML2J.page_model);
  const q2 = H2.predict(A, B, { date: base.date, lbs: 155, five: 1 }, MoE.devig(160, -180), MoE.devig(160, -180, "mult"));
  for (const [kind, Mexp, block, regime] of [["none", mClose, "model", "absent"], ["open", mOpen, "model_open", "present"], ["close", mClose, "model", "present"]]) {
    const o = Object.assign({}, base, kind === "none" ? {} : { line }, { lineKind: kind });
    const r = E.predict(A, B, o), rs = E.predict(B, A, Object.assign({}, base, kind === "none" ? {} : { line: lineS }, { lineKind: kind }));
    const ex = Object.assign({}, r.experts); delete ex.ml2;
    const ref = Mexp.predict({ experts: ex, gate: MoE.gateFromSides(MoE.sideFromProfile(E.profile(A), base.date, { keys: DB.meta.keys, snapshot: DB.meta.snapshot, halfLife: DB.meta.half_life_days || 730 }),
      MoE.sideFromProfile(E.profile(B), base.date, { keys: DB.meta.keys, snapshot: DB.meta.snapshot, halfLife: DB.meta.half_life_days || 730 }), { division: "Lightweight", rounds: 5 }) });
    const expMarket = kind === "close" ? MoE.devig(160, -180) : kind === "open" ? MoE.devig(160, -180, "mult") : undefined;
    check(`lineKind '${kind}': stack block ${block} (${regime}), p = MoE.load(blindtest_stack${kind === "open" ? ", 'model_open'" : ""}).predict on the reported experts`,
      r.source === "stack" && r.stack.block === block && r.blend.regime === regime && Math.abs(r.p - ref.p) < 1e-12 && r.lineKind === kind &&
      (kind === "none" ? r.experts.market === undefined && r.line === null : Math.abs(r.experts.market - expMarket) < 1e-12 && r.line.devig === (kind === "open" ? "proportional" : "power")) &&
      ["engine", "feat_lr", "elo", "ml", "elo_sig", "mkt_rating"].every((k) => typeof r.experts[k] === "number"),
      `p ${r.p.toFixed(4)}, experts ${Object.keys(r.experts).join(",")}`);
    const iv = r.interval, ivs = rs.interval, mir = (x, y) => Math.abs(x[0] - (1 - y[1])) < 1e-9 && Math.abs(x[1] - (1 - y[0])) < 1e-9;
    check(`lineKind '${kind}': exact corner symmetry (p, 7 bins, cells, calibrated interval)`, Math.abs(r.p + rs.p - 1) < 1e-12 &&
      r.bins7.every((x, i) => Math.abs(x - rs.bins7[6 - i]) < 1e-12) && mir(iv.calibrated["0.8"], ivs.calibrated["0.8"]) && Math.abs(FB.marginals(r.cells, r.R).p - r.p) < 1e-12,
      `${r.p.toFixed(6)} + ${rs.p.toFixed(6)}`);
    const want = kind === "none" ? q2.pStack : kind === "close" ? q2.pStackLine : q2.pStackOpen;
    check(`lineKind '${kind}': ML v2 next to it = src/ml/ml2.js (logistic ${q2.pA.toFixed(4)}, ${r.ml2.stack} stack)`,
      r.ml2 && Math.abs(r.ml2.pA - q2.pA) < 1e-12 && Math.abs(r.ml2.pMR - q2.pMR) < 1e-12 && Math.abs(r.ml2.p - want) < 1e-12 && r.experts.ml2 === r.ml2.pA,
      `ml2 p ${r.ml2.p.toFixed(4)}`);
    if (kind === "open") {
      const rw = E.predict(A, B, Object.assign({}, o, { winner: "ml2" })), rws = E.predict(B, A, Object.assign({}, base, { line: lineS, lineKind: "open", winner: "ml2" }));
      check("winner 'ml2': headline = the lineKind-matched ML v2 page stack, corner-symmetric, method x round rescaled to it",
        rw.source === "ml2" && rw.winner === "ml2" && Math.abs(rw.p - q2.pStackOpen) < 1e-12 && Math.abs(rw.p + rws.p - 1) < 1e-12 && Math.abs(FB.marginals(rw.cells, rw.R).p - rw.p) < 1e-12,
        `p ${rw.p.toFixed(4)}`);
    }
  }
  let e1 = null, e2 = null, e3 = null, e4 = null;
  try { E.predict(A, B, Object.assign({}, base, { line, interval: false })); } catch (e) { e1 = e.message; }
  try { E.predict(A, B, Object.assign({}, base, { lineKind: "close", interval: false })); } catch (e) { e2 = e.message; }
  try { E.predict(A, B, Object.assign({}, base, { line, lineKind: "open", stack: MOEP, interval: false })); } catch (e) { e3 = e.message; }
  try { E.predict(A, B, Object.assign({}, base, { line, lineKind: "early", interval: false })); } catch (e) { e4 = e.message; }
  check("a line without lineKind, lineKind without a line, 'open' with a stack lacking model_open, and an unknown kind are refused",
    /explicit opts\.lineKind/.test(e1 || "") && /needs a line/.test(e2 || "") && /open-trained/.test(e3 || "") && /must be 'close', 'open' or 'none'/.test(e4 || ""));
  const rn = E.predict(A, B, Object.assign({}, base, { line, lineKind: "none", interval: false })), r0 = E.predict(A, B, Object.assign({}, base, { interval: false }));
  check("lineKind 'none' ignores a given line (= no line)", rn.p === r0.p && rn.experts.market === undefined && rn.blend.regime === "absent");
  const rl = E.predict(A, B, Object.assign({}, base, { stack: MOEP, interval: false }));
  check("a legacy moe_page.json stack still works for no-line / close (opts.stack)", rl.source === "stack" && rl.stack.from === "opts" && rl.p > 0 && rl.p < 1);
}

// ------------------------------------------------------------------ v5 per-call inputs swap with the corners inside predict
{
  const sw = FB.swapOpts({ adjA: 1, adjB: 2, ml: { A: "a", B: "b", base: 3 }, preufcA: true, preufcB: false, dur: { A: "dA", B: "dB", base: 4 },
    sos: { A: "sA", B: "sB" }, embed: { etaA: "eA", etaB: "eB", recipe: 5 }, oppadj: { A: "oA", B: "oB" }, preufc: { A: "pA", B: null } });
  check("swapOpts swaps dur, sos, embed (etaA/etaB), oppadj and preufc and keeps the shared parts", sw.dur.A === "dB" && sw.dur.B === "dA" && sw.dur.base === 4 &&
    sw.sos.A === "sB" && sw.embed.etaA === "eB" && sw.embed.etaB === "eA" && sw.embed.recipe === 5 && sw.oppadj.B === "oA" && sw.preufc.A === null && sw.preufc.B === "pA" &&
    sw.adjA === 2 && sw.ml.A === "b" && sw.preufcA === false);
  let bad = 0, n = 0, symBad = 0, nSym = 0;
  for (const f of trainSample.slice(0, 24)) {
    const c0 = btCase(f, 0), c1 = btCase(f, 1);
    const P = withParams(c0.opts, { components: { embed: true, preufc: true, oppadj: false } });
    const P1 = withParams(c1.opts, { components: { embed: true, preufc: true, oppadj: false } });
    const ma = JSON.stringify(E.matchup(c0.b, c0.a, FB.swapOpts(P))), mb = JSON.stringify(E.matchup(c1.a, c1.b, P1));
    n++; if (ma !== mb) bad++;
    if (n <= 8) {
      nSym++;
      const PR = require(path.join(ROOT, "tools/predictrec.js"))(E, ROOT, { inSample: true });
      const o0 = Object.assign({}, P, PR.opts(f, false, { lineKind: "close" }), { sims: 100, seed: 3, interval: false });
      const o1 = Object.assign({}, P1, PR.opts(f, true, { lineKind: "close" }), { sims: 100, seed: 3, interval: false });
      const r0 = E.predict(c0.a, c0.b, o0), r1 = E.predict(c1.a, c1.b, o1);
      if (!(Math.abs(r0.p + r1.p - 1) < 1e-12 && r0.bins7.every((x, i) => Math.abs(x - r1.bins7[6 - i]) < 1e-12) && Math.abs(r0.sim.p + r1.sim.p - 1) < 1e-12)) symBad++;
    }
  }
  check("predict's mirrored run builds the harness's own swapped matchup (durability, SOS, embed, preufc, OOF rates): identical", bad === 0, `${n} train fights, ${bad} differ`);
  check("backtest predict with every v5 input + predictrec is exactly corner-symmetric (p, 7 bins, simulator p)", symBad === 0 && nSym > 0, `${nSym} train fights, ${symBad} asymmetric`);
}

// ------------------------------------------------------------------ backtest guard and tools/predictrec.js
{
  const PR = require(path.join(ROOT, "tools/predictrec.js"))(E, ROOT);
  const PRin = require(path.join(ROOT, "tools/predictrec.js"))(E, ROOT, { inSample: true });
  const f = trainSample[5], c = btCase(f, 0), bo = Object.assign({}, c.opts, { sims: 60, seed: 2, interval: false });
  const errs = {};
  const tryP = (k, o) => { try { E.predict(c.a, c.b, Object.assign({}, bo, o)); errs[k] = null; } catch (e) { errs[k] = e.message; } };
  tryP("noStack", { backtest: true, mrCells: false });
  tryP("prodStack", { backtest: true, stack: STK, mrCells: false });
  tryP("inSample", { backtest: true, stack: STKPRE, mrCells: false });
  tryP("noCells", { backtest: true, stack: STKPRE, inSample: true });
  tryP("liveMl2", { backtest: true, stack: STKPRE, inSample: true, mrCells: false, ml2: ML2J });
  tryP("vault", { backtest: true, stack: STKPRE, mrCells: false, date: "2026-02-01" });
  tryP("noFit", { backtest: true, stack: { model: STK.model }, mrCells: false });
  check("backtest guard: refuses the loaded stack, a stack fit through 2025, a stacker containing the fight (unless inSample), missing method/round cells, the live ML v2 page model, 2026 dates and a stacker without fit_through",
    /pass a stacker fit on 2023 or earlier/.test(errs.noStack || "") && /must be fit on 2023 or earlier/.test(errs.prodStack || "") && /contains this fight/.test(errs.inSample || "") &&
    /opts\.mrCells/.test(errs.noCells || "") && /precomputed walk-forward/.test(errs.liveMl2 || "") && /sealed/.test(errs.vault || "") && /no fit_through/.test(errs.noFit || ""),
    JSON.stringify(Object.keys(errs).filter((k) => !errs[k])));
  const ob = Object.assign({}, bo, PRin.opts(f, false, { lineKind: "close" }));
  const rb = E.predict(c.a, c.b, ob);
  const exp = PRin.experts(f);
  check("backtest predict uses only the passed experts (no live roster: ml / elo_sig / mkt_rating / feat_lr as given), the passed cells and the pre-2024 stacker",
    rb.backtest && rb.backtest.stackFitThrough <= "2023-12-31" && rb.backtest.inSample === true && rb.stack.from === "opts" && rb.methodRound.variant === "SM" &&
    ["ml", "elo_sig", "feat_lr", "mkt_rating"].every((k) => exp[k] === undefined ? rb.experts[k] === undefined : rb.experts[k] === exp[k]) &&
    rb.ml2 && Math.abs(rb.ml2.pA - ML2J.fights[f.id].ml2_lr) < 1e-12 && rb.ml2.stack === "line" && typeof rb.ml2.p === "number",
    `p ${rb.p.toFixed(4)}, experts ${JSON.stringify(Object.keys(rb.experts))}, ml2 ${rb.ml2 && rb.ml2.p.toFixed(4)}`);
  let eT = null; try { PR.opts(f, false, {}); } catch (e) { eT = e.message; }
  let eV = null; try { PR.opts({ id: "x", date: "2026-03-01" }, false, {}); } catch (e) { eV = e.message; }
  check("predictrec: a train fight needs inSample or per-year stackers; 2026 refused", /contains this fight/.test(eT || "") && /sealed/.test(eV || ""));
  const o0 = PRin.opts(f, false, { lineKind: "close" }), o1 = PRin.opts(f, true, { lineKind: "close" }), R = f.rounds;
  check("predictrec: corner swap flips the experts, the line and ML v2, and mirrors the cells; cells are walk-forward (fit before the fight)",
    Object.keys(o0.experts).every((k) => Math.abs(o0.experts[k] + o1.experts[k] - 1) < 1e-12) && Math.abs(o0.pMarket + o1.pMarket - 1) < 1e-12 &&
    Math.abs(o0.ml2.pA + o1.ml2.pA - 1) < 1e-12 && JSON.stringify(FB.mirrorCells(o0.mrCells, R)) === JSON.stringify(o1.mrCells) && o0.mrFitThrough < f.date,
    `${Object.keys(o0.experts).join(",")}; cells ${o0.mrVariant} fit through ${o0.mrFitThrough}`);
}
E.loadMLRates(null);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
