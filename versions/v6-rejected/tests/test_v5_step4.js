#!/usr/bin/env node
/* test_v5_step4.js: engine v5 merge step 4 (params.components.embed, .oppadj, .preufc), flag-off identity and component checks.

   Each component's flag-off path must reproduce the engine before it, bit for bit, for fixed seeds:
   R0. embed, oppadj and preufc off = the step-3 engine (tests/fixtures/engine3_pre_step4.js, a frozen copy of src/engine3.js at
       commit df75ccd "v5 merge: step 3 styles_sos + officials + realism_sens"), on the current params3.js and mlrates.js.
   R0s. The same, strict: the step-3 engine on step 3's OWN params3.js and ml/mlrates.js (git show df75ccd; skipped without git).
   R1. oppadj and preufc off (embed on, with inputs) = the step-3 engine + embed (tests/fixtures/engine3_pre_oppadj.js).
   R2. preufc off = step 3 + embed + oppadj (tests/fixtures/engine3_pre_preufc.js), with oppadj off and with it on (sos off).
   Compared: whole fight objects (JSON, including the per-round trace) for fixed seeds, traced and untraced, a shared rng stream
   across fights, summarize() and explain() output, over
     a. random fighter pairs from data/derived/fighters.json with the production learned rates and the live durability roster
        (the page path), random SOS inputs, and random step-4 inputs (embedding etas and oppadj factors of real train fights,
        random pre-UFC records with 0-3 UFC fights),
     b. random pairs on the plain tables (ml: false) with the same kinds of inputs,
     c. 2019-2023 backtest fights (train years only) in both corner orders with the out-of-fold learned rates, the as-of priors,
        the durability walk-forward records + train NORM, the walk-forward SOS pairs and the step-4 walk-forward inputs
        (tools/mlpathrec.js): the tools/evalv.js path.
   Then: each flag on changes fights; the shipped defaults; no-input no-ops (page path); the embedding blend equals
   src/ml/embed.js blendMLRates and the backtest etas reproduce the snapshots' win logits; the leave-one-year-out coefficients;
   oppadj equals the reference adjTargets and refuses to stack with SOS; pre-UFC multipliers reproduce preufc.json and are applied
   to the right hazards; roster leak guards; the trace format; sensitivity() rebuilds keep the step-4 inputs.
     node tests/test_v5_step4.js [matchups per random group, default 150]   (a few minutes) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const FEm = require(path.join(ROOT, "src/ml/embed.js"));
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
const R0 = loadEngine(fx("engine3_pre_step4.js"));    // step 3
const R1 = loadEngine(fx("engine3_pre_oppadj.js"));   // step 3 + embed
const R2 = loadEngine(fx("engine3_pre_preufc.js"));   // step 3 + embed + oppadj
let R0s = null;
{
  const g = git(["show", "df75ccd:src/engine3.js"]);
  check("fixture engine3_pre_step4.js is src/engine3.js of the step-3 commit df75ccd", g === null || g === fx("engine3_pre_step4.js"),
    g === null ? "git not reachable, skipped" : "byte for byte");
  const gp = git(["show", "df75ccd:src/params3.js"]), gm = git(["show", "df75ccd:src/ml/mlrates.js"]);
  if (g && gp && gm) R0s = loadEngine(g, { "params3.js": loadModule(gp), "ml/mlrates.js": loadModule(gm) });
  check("reference engines load (step 3: no loadEmbed; +embed: no oppadjSide; +oppadj: no loadPreUFC)",
    typeof R0.loadEmbed !== "function" && typeof R1.loadEmbed === "function" && typeof R1.oppadjSide !== "function" &&
    typeof R2.oppadjSide === "function" && typeof R2.loadPreUFC !== "function" && typeof E.loadPreUFC === "function",
    `versions ${R0.VERSION} / ${R1.VERSION} / ${R2.VERSION}; strict step-3 params ${R0s ? R0s.params().version : "skipped"}`);
}

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
const ENGS = [E, R0, R1, R2].concat(R0s ? [R0s] : []);
for (const e of ENGS) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
const DUR = readJSON("data/derived/durability.json");
const NORM = { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 };
const EMJ = readJSON("data/derived/embed_model.json");
const LOYO = readJSON("data/derived/embed_blend_loyo.json");
const OAJ = XR.table("data/derived/oppadj.json");
const PREJ = XR.table("data/derived/preufc.json");

// ------------------------------------------------------------------ shipped defaults
check("defaults: embed on, oppadj off, styles_sos newcomer off (preufc: " + FP.components.preufc + "); earlier components unchanged",
  FP.components.embed === true && FP.components.oppadj === false && typeof FP.components.preufc === "boolean" &&
  FP.components.styles_sos.newcomer === false && FP.components.styles_sos.sos === true && FP.components.durability === true &&
  FP.components.dynamics === true && FP.components.officials === false && FP.components.realism_sens === false, JSON.stringify(FP.components));
check("params.embed.recipe = embed_model.json mlrates_blend.targets (b and task per target) and params.embed.tasks = the model's task order",
  Object.keys(EMJ.mlrates_blend.targets).every((t) => JSON.stringify(EMJ.mlrates_blend.targets[t].b) === JSON.stringify(FP.embed.recipe[t].b) &&
    EMJ.mlrates_blend.targets[t].task === FP.embed.recipe[t].task && EMJ.mlrates_blend.targets[t].link === FP.embed.recipe[t].link) &&
  JSON.stringify(EMJ.tasks.map((t) => t[0])) === JSON.stringify(FP.embed.tasks));
check("params.oppadj.beta = oppadj.json results.recommendation ml_path_beta (kd, accB, sub = 0)",
  Object.keys(FP.oppadj.beta).every((k) => Math.abs(FP.oppadj.beta[k] - OAJ.results.recommendation.families[k].ml_path_beta) < 1e-12) &&
  FP.oppadj.beta.kd === 0 && FP.oppadj.beta.accB === 0 && FP.oppadj.beta.sub === 0);

// ------------------------------------------------------------------ matchup generators
const rng = E.makeRng(20261106 ^ 4);
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
  return { a, b, opts, seed: 9000 + i };
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
  XR.apply(opts, f, o === 1, ALL4);   // every step-4 input, whatever the flags (ignored where a flag is off)
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
// v5 Calibrate B: components.calB (a later step: the joint level pass) is off in every comparison with an engine that predates it
const OFF0 = { components: { embed: false, oppadj: false, preufc: false, calB: false, v501: false } };
const OFF1 = { components: { embed: true, oppadj: false, preufc: false, calB: false, v501: false } };
const OFF2 = { components: { embed: true, oppadj: false, preufc: false, calB: false, v501: false } };
const OFF2b = { components: { embed: true, oppadj: true, preufc: false, styles_sos: { styles: false, sos: false, newcomer: false }, calB: false, v501: false } };
function runGroup(label, REF, refName, OFF, cases, ctx, refParams) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0, recs = 0, emb = 0, oa = 0;
  const go = () => {
    cases.forEach((c, i) => {
      const mr = REF.matchup(c.a, c.b, refParams ? withParams(c.opts, refParams) : c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, OFF));
      if (mr.mlApplied) applied++;
      if (c.hasRec) recs++;
      if (mc.embed && mc.embed.src) emb++;
      if (mc.oppadj && mc.oppadj.have[0]) oa++;
      const fr = fights(REF, mr, c.seed), fc = fights(E, mc, c.seed);
      nM++; nF += fr.length;
      for (let k = 0; k < fr.length; k++) if (fr[k] !== fc[k]) { bad++; if (!firstBad) firstBad = `case ${i} fight ${k}`; }
      if (i % 10 === 0) {
        nSum++;
        const sr = JSON.stringify(REF.summarize(mr, 150, c.seed)), sc = JSON.stringify(E.summarize(mc, 150, c.seed));
        const xr = JSON.stringify(REF.explain(mr)), xc = JSON.stringify(E.explain(mc));
        if (sr !== sc || xr !== xc) { badSum++; if (!firstBad) firstBad = `summary/explain ${i}`; }
      }
    });
  };
  const engs = [REF, E];
  if (ctx.ml) engs.forEach((e) => e.loadMLRates(mlJson));
  if (ctx.roster) engs.forEach((e) => e.loadDurability(DUR));
  try { go(); } finally { engs.forEach((e) => { e.loadMLRates(null); e.loadDurability(null); }); }
  check(`${refName}, ${label}: identical fights (JSON incl. trace), summaries and explain()`, bad === 0 && badSum === 0,
    `${nM} matchups (${applied} learned rates, ${recs} durability records, ${emb} with the embedding blend, ${oa} with oppadj), ${nF} fights, ${nSum} summaries; ` +
    `${bad} fight / ${badSum} summary mismatches${firstBad ? "; first " + firstBad : ""}`);
  return nM;
}

const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
const stp = Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2))));
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % stp === 3 % stp).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }
const noSos = (cs) => cs.map((c) => { const o = Object.assign({}, c.opts); delete o.sos; if (o.params && o.params.stylesSOS) { o.params = Object.assign({}, o.params); delete o.params.stylesSOS; } return Object.assign({}, c, { opts: o }); });

console.log(`engine ${E.VERSION} (params ${E.params().version}); ${NM} random matchups per group`);
const REFS = [
  [R0, "all three off = step-3 engine", OFF0, null],
  [R1, "oppadj + preufc off = step 3 + embed", OFF1, null],
  [R2, "preufc off = step 3 + embed + oppadj (oppadj off)", OFF2, null],
  [R2, "preufc off = step 3 + embed + oppadj (oppadj on, sos off)", OFF2b, OFF2b]
];
for (const [REF, refName, OFF, refP] of REFS) {
  let total = 0;
  const cA = refP ? noSos(casesA) : casesA, cB = refP ? noSos(casesB) : casesB, cC = refP ? noSos(casesC) : casesC;
  total += runGroup("a. random pairs, learned rates, durability roster, random SOS + step-4 inputs", REF, refName, OFF, cA, { ml: true, roster: true }, refP);
  total += runGroup("b. random pairs, plain tables, random SOS + step-4 inputs", REF, refName, OFF, cB, { ml: false, roster: false }, refP);
  total += runGroup("c. 2019-2023 backtest fights x 2 corner orders, OOF rates, durability, SOS, step-4 walk-forward inputs", REF, refName, OFF, cC, { ml: false, roster: false }, refP);
  check(`${refName}: identity covers >= 300 matchups incl. traced fights`, total >= 300, `${total} matchups`);
}
if (R0s) {
  let total = 0;
  // v5 Calibrate A (research/v5_train_ablation.md) turned components.v401.mlLevels off by default; the strict reference runs on
  // its own params3.js, so the current engine is called with that reference's v401 sub-flags pinned
  const OFF0s = { components: Object.assign({}, OFF0.components, { v401: R0s.params().components.v401 }) };
  total += runGroup("a (strict)", R0s, "all three off = step-3 engine on step 3's own params3.js + mlrates.js", OFF0s, casesA, { ml: true, roster: true });
  total += runGroup("c (strict)", R0s, "all three off = step-3 engine on step 3's own params3.js + mlrates.js", OFF0s, casesC, { ml: false, roster: false });
  check("strict step-3 reference: >= 300 matchups", total >= 300, `${total} matchups`);
} else console.log("SKIP  strict step-3 reference (git objects not reachable)");

// ------------------------------------------------------------------ not vacuous: each flag on changes fights vs its reference
{
  E.loadMLRates(mlJson); R0.loadMLRates(mlJson); R1.loadMLRates(mlJson); R2.loadMLRates(mlJson);
  try {
    const nc = casesC.filter((c) => c.opts.preufc && (c.opts.preufc.A || c.opts.preufc.B));
    const ON = [
      [R0, "embed (with inputs) on vs step 3", { components: { embed: true, oppadj: false, preufc: false, calB: false, v501: false } }, casesA.slice(0, 30).concat(casesC.slice(0, 30)), 0.3],
      [R1, "oppadj on (sos off) vs step 3 + embed (sos off)", OFF2b, noSos(casesA.slice(0, 30).concat(casesC.slice(0, 30))), 0.3, OFF1],
      [R2, "preufc on vs step 3 + embed + oppadj, newcomer bouts", { components: { embed: true, oppadj: false, preufc: true, calB: false, v501: false } }, nc.slice(0, 40), 0.3, OFF2]
    ];
    for (const [REF, nm, P, cs, min, refP] of ON) {
      let diff = 0, n = 0;
      cs.forEach((c) => {
        const ro = refP ? withParams(c.opts, refP) : c.opts;
        if (refP === OFF1) ro.params.components = Object.assign({}, ro.params.components, { styles_sos: { styles: false, sos: false, newcomer: false } });
        const fr = fights(REF, REF.matchup(c.a, c.b, ro), c.seed), fc = fights(E, E.matchup(c.a, c.b, withParams(c.opts, P)), c.seed);
        for (let q = 0; q < fr.length; q++) { n++; if (fr[q] !== fc[q]) diff++; }
      });
      check(`flag on changes fights: ${nm}`, diff > min * n, `${diff} of ${n} fights differ (${cs.length} matchups)`);
    }
  } finally { E.loadMLRates(null); R0.loadMLRates(null); R1.loadMLRates(null); R2.loadMLRates(null); }
}

// ------------------------------------------------------------------ no-input no-ops: default params without step-4 inputs (page path)
{
  let bad = 0, n = 0;
  E.loadMLRates(mlJson); R0.loadMLRates(mlJson); E.loadDurability(DUR); R0.loadDurability(DUR);
  try {
    casesA.slice(0, 40).forEach((c) => {
      const o = Object.assign({}, c.opts); delete o.embed; delete o.oppadj; delete o.preufc;
      // preufc on too: without a record it is a no-op; v5 Calibrate B's components.calB (a later step) pinned off against the step-3 engine
      const P = withParams(o, { components: { preufc: true, calB: false, v501: false } });
      const fr = fights(R0, R0.matchup(c.a, c.b, o), c.seed), fc = fights(E, E.matchup(c.a, c.b, P), c.seed);
      for (let q = 0; q < fr.length; q++) { n++; if (fr[q] !== fc[q]) bad++; }
    });
  } finally { E.loadMLRates(null); R0.loadMLRates(null); E.loadDurability(null); R0.loadDurability(null); }
  check("default params (embed on) + preufc on with no step-4 input (page path without rosters) = the step-3 engine, bit for bit", bad === 0, `${n} fights, ${bad} differ`);
}

// ------------------------------------------------------------------ embed: the blend, the backtest etas, the coefficients
{
  const h = FEm.load(EMJ), P = E.params(), tix = {}; P.embed.tasks.forEach((t, i) => { tix[t] = i; });
  let maxd = 0, maxPy = 0;
  for (const r of EMJ.blend_check) {
    const a = h.blendMLRates(r.ml, r.eta), b = E.embedBlend(r.ml, r.eta, P.embed.recipe, tix);
    for (const k in a) maxd = Math.max(maxd, Math.abs(a[k] - b[k]));
    if (r.out) for (const k in r.out) maxPy = Math.max(maxPy, Math.abs(r.out[k] - b[k]) / Math.max(1e-12, Math.abs(r.out[k])));
  }
  const r2 = E.makeRng(77);
  for (let q = 0; q < 300; q++) {
    const side = {}; TN.forEach((t) => { side[t] = t.startsWith("acc") || t === "td_acc" ? r2.u() : (t === "kd_h" ? 0.03 * r2.u() : (t === "ctrl" ? 60 * r2.u() : 12 * r2.u())); });
    const eta = P.embed.tasks.map(() => 4 * (r2.u() - 0.5));
    const a = h.blendMLRates(side, eta), b = E.embedBlend(side, eta, P.embed.recipe, tix);
    for (const k in a) maxd = Math.max(maxd, Math.abs(a[k] - b[k]));
  }
  check("engine embedBlend = src/ml/embed.js blendMLRates bit for bit (blend_check rows + 300 random sides) and = the Python outputs of tools/embed.py (relative 1e-9)",
    maxd === 0 && maxPy < 1e-9, `max |diff| vs JS ${maxd}; max rel diff vs Python ${maxPy.toExponential(2)}`);
  // backtest etas: the snapshot's quarterly refit reproduces the walk's own win logit (export rounding, max 2.4e-3)
  const EJ = XR.table("data/derived/embed.json");
  let maxw = 0, nW = 0;
  for (const f of train) {
    const s = EJ.snapshots[f.id]; if (!s) continue;
    const Q = EJ.quarters[s.q], hq = FEm.load({ K: EJ.model.K, tasks: EJ.model.tasks, divs: EJ.model.divs, default_division: "Lightweight", era_date: "2026-01-01", C: Q.C, W: Q.W, V: Q.V, ua: Q.ua, ud: Q.ud, M: Q.M, roster: {} });
    maxw = Math.max(maxw, Math.abs(hq.winLogit(s.A, s.B) - s.win_logit)); nW++;
  }
  check("backtest snapshots: quarterly refit + snapshot vectors reproduce the stored win logits (export rounding)", maxw < 3e-3, `${nW} train fights, max |diff| ${maxw.toExponential(2)}`);
  const f = train[17], e0 = XR.embedFor(f, false), e1 = XR.embedFor(f, true), y = f.date.slice(0, 4);
  let refused = false; try { XR.embedRecipe("2026-02-01"); } catch (err) { refused = true; }
  let missing = false; try { XR.embedEtas({ id: "no-such-fight", date: "2022-01-01" }); } catch (err) { missing = true; }
  check("mlpathrec embed: swapping corners swaps the etas; train recipe = leave-one-year-out; 2024-25 = the exported recipe; 2026 and missing snapshots refused",
    JSON.stringify(e0.etaA) === JSON.stringify(e1.etaB) && JSON.stringify(e0.etaB) === JSON.stringify(e1.etaA) &&
    // v6 (review gate 1): engines of major version 6+ take the fold-honest recipe (embed_blend_fh.json coef_fh[year]; '2024' for 2024-25)
    (XR.foldHonest ? (JSON.stringify(e0.recipe) === JSON.stringify(readJSON("data/derived/embed_blend_fh.json").coef_fh[y]) &&
      JSON.stringify(XR.embedRecipe("2024-06-01")) === JSON.stringify(readJSON("data/derived/embed_blend_fh.json").coef_fh["2024"])) :
      (JSON.stringify(e0.recipe) === JSON.stringify(LOYO.coef_loyo[y]) && JSON.stringify(XR.embedRecipe("2024-06-01")) === JSON.stringify(EMJ.mlrates_blend.targets))) && refused && missing,
    `fight ${f.id} ${f.date}`);
  const tc = LOYO.train_check.segments.all;
  check("embed_blend_loyo.json: the full 2019-2023 refit reproduces the exported recipe; train leave-one-year-out deviance improves (CIs below 0)",
    LOYO.full_fit_max_abs_diff < 1e-3 && tc.blend_vs_recal.ci95[1] < 0 && tc.blend_vs_raw.ci95[1] < 0 && LOYO.meta.rows === 3998,
    `max |b - exported| ${LOYO.full_fit_max_abs_diff}; vs recal ${(100 * tc.blend_vs_recal.mean).toFixed(2)}% [${(100 * tc.blend_vs_recal.ci95[0]).toFixed(2)}, ${(100 * tc.blend_vs_recal.ci95[1]).toFixed(2)}], vs raw ${(100 * tc.blend_vs_raw.mean).toFixed(2)}% [${(100 * tc.blend_vs_raw.ci95[0]).toFixed(2)}, ${(100 * tc.blend_vs_raw.ci95[1]).toFixed(2)}]`);
  // the backtest path applies it and records the raw targets
  E.loadMLRates(null);
  const c = casesC[0], m = E.matchup(c.a, c.b, c.opts);
  check("backtest path: the blend acts on the learned targets (m.embed.src 'opts', per-call recipe; m.mlPred = blended, m.embed.raw = the OOF rates)",
    m.mlApplied && m.embed && m.embed.src === "opts" && m.embed.recipe === "opts" && m.mlPred.A.d_att !== m.embed.raw.A.d_att &&
    m.embed.raw.A.d_att === c.opts.ml.pred.A.d_att);
  // live roster: only for bouts dated on or after its as-of date
  E.loadMLRates(mlJson);
  try {
    const info = E.loadEmbed(EMJ);
    const vg = { division: "Lightweight", rounds: 5, title: true };
    const mLive = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ date: "2026-11-06" }, vg));
    const mOld = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ date: "2023-06-01" }, vg));
    const hv = FEm.load(EMJ), mv = hv.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, date: "2026-11-06" });
    const P2 = E.params(), tix2 = {}; P2.embed.tasks.forEach((t, i) => { tix2[t] = i; });
    const want = E.embedBlend(mLive.embed.raw.A, mv.etaA, P2.embed.recipe, tix2);
    check("loadEmbed roster: used for a bout dated on or after its as-of date (= FightEmbed.matchup etas), never for an earlier bout",
      info.asof === "2026-01-01" && mLive.embed.src === "roster" && mOld.embed.src === null && Math.abs(mLive.mlPred.A.ctrl - want.ctrl) < 1e-12,
      `roster ${info.n}; Volk ctrl target ${mLive.embed.raw.A.ctrl.toFixed(2)} -> ${mLive.mlPred.A.ctrl.toFixed(2)} s/min`);
  } finally { E.loadEmbed(null); E.loadMLRates(null); }
}

// ------------------------------------------------------------------ oppadj
{
  function odds(p) { p = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return p / (1 - p); }
  function prob(o) { return o / (1 + o); }
  function pw(x, b) { return Math.pow(Math.max(x, 1e-6), b); }
  function adjTargets(t, Fi, Fj, bt2) {   // tools/oppadj_engine.js adjTargets (the reference), verbatim
    const o = Object.assign({}, t);
    const att0 = t.d_att + t.c_att + t.g_att;
    o.d_att = t.d_att * pw(Fi.dAtt * Fj.dAttAg, bt2.dAtt);
    o.c_att = t.c_att * pw(Fi.cAtt * Fj.cAttAg, bt2.cAtt);
    o.g_att = t.g_att * pw(Fi.gAtt * Fj.gAttAg, bt2.gAtt);
    const r = att0 > 0 ? (o.d_att + o.c_att + o.g_att) / att0 : 1;
    o.h_att = t.h_att * r; o.b_att = t.b_att * r; o.l_att = t.l_att * r;
    o.td_att = t.td_att * pw(Fi.tdAtt * Fj.tdAttAg, bt2.tdAtt);
    o.sub_att = t.sub_att * pw(Fi.sub * Fj.subAg, bt2.sub);
    o.ctrl = t.ctrl * pw(Fi.ctrl * Fj.octrl, bt2.ctrl);
    ["acc_h", "acc_b", "acc_l"].forEach((k, q) => { o[k] = prob(odds(t[k]) * pw(Fi.acc[q] * Fj.accAg[q], bt2[["accH", "accB", "accL"][q]])); });
    o.td_acc = prob(odds(t.td_acc) * pw(Fi.tdAcc * Fj.tdAccAg, bt2.tdAcc));
    o.kd_h = t.kd_h * pw(Fi.pow * Fj.chin, bt2.kd);
    return o;
  }
  let maxrel = 0, n = 0;
  for (const f of train) {
    const s = OAJ.snapshots[f.id], o = OOF.fights[f.id]; if (!s || !o) continue;
    for (const [side, X, Y] of [["A", s.A, s.B], ["B", s.B, s.A]]) {
      const t = rates(o[side]), a = adjTargets(t, X, Y, FP.oppadj.beta), b = E.oppadjSide(t, X, Y, FP.oppadj.beta);
      for (const k in a) maxrel = Math.max(maxrel, Math.abs(a[k] - b[k]) / Math.max(1e-12, Math.abs(a[k])));
      n++;
    }
  }
  check("oppadjSide = tools/oppadj_engine.js adjTargets on every 2019-2023 side (float rounding only)", maxrel < 1e-12, `${n} sides, max rel diff ${maxrel.toExponential(2)}`);
  let refused = false, refusedObj = false;
  try { E.matchup("alexander-volkanovski", "justin-gaethje", { ml: false, date: "2026-11-06", params: { components: { oppadj: true } } }); } catch (e) { refused = /exclusive/.test(e.message); }
  try { E.matchup("alexander-volkanovski", "justin-gaethje", { ml: false, date: "2026-11-06", params: { components: { oppadj: true, styles_sos: true } } }); } catch (e) { refusedObj = /exclusive/.test(e.message); }
  const c = casesC[2], mO = E.matchup(c.a, c.b, withParams(noSos([c])[0].opts, OFF2b));
  const c2 = casesC[3], m1 = E.matchup(c2.a, c2.b, withParams(noSos([c2])[0].opts, OFF2b));
  check("oppadj: refuses to stack with styles_sos sos (default sub-flags or `true`); with sos off it acts on the learned targets; corner swap mirrors the factors",
    refused && refusedObj && mO.oppadj.have.every(Boolean) && mO.oppadj.src === "opts" && m1.oppadj.have.every(Boolean) &&
    JSON.stringify(XR.oppadjFor(c.f, true).A) === JSON.stringify(OAJ.snapshots[c.f.id].B));
  const n2026 = Object.values(OAJ.snapshots).length;
  let r26 = false; try { XR.oppadjFor({ id: "x", date: "2026-03-01" }, false); } catch (e) { r26 = true; }
  check("mlpathrec oppadj: 2026 refused", r26, `${n2026} snapshots in oppadj.json (2026 rows are never served)`);
}

// ------------------------------------------------------------------ preufc
{
  // params = preufc.json's exact finish-model constants; the engine formula = (rate / ref)^(exp x fade); preufc.json's roster
  // multipliers (rates rounded to 3 decimals before the power, then the result rounded to 3) are reproduced from the debut records
  const SF = PREJ.eval.side_finish, Q = FP.preufc;
  const constOk = Q.ref.ko === SF.mu_pre.pre_ko && Q.ref.sub === SF.mu_pre.pre_sub && Q.ref.kol === SF.mu_pre.pre_kol &&
    Q.exp.pow === SF.ko_win["ufc+pre"]["coef_log_ratio (own, opponent), at n=0"][0] && Q.exp.sub === SF.sub_win["ufc+pre"]["coef_log_ratio (own, opponent), at n=0"][0] &&
    Q.exp.chin === SF.ko_loss["ufc+pre"]["coef_log_ratio (own, opponent), at n=0"][0] && Q.tau === SF.ko_win["ufc+pre"].tau;
  let maxd = 0, maxF = 0, nR = 0;
  const r3 = (x) => Math.round(x * 1000) / 1000;
  for (const s of Object.keys(PREJ.roster_priors).sort()) {
    const d = PREJ.fighters[s] && PREJ.fighters[s].debut, rp = PREJ.roster_priors[s].finish_odds_multipliers;
    if (!d || !rp || !rp.ko_win) continue;
    const n1 = PREJ.roster_priors[s].n_ufc, nn = d.n + 2, fd = Math.exp(-n1 / Q.tau);
    const rk = r3((d.ko_w + 0.3) / nn), rs = r3((d.sub_w + 0.2) / nn), rl = (d.ko_l + 0.2) / nn;   // tools/preufc.py roster_priors
    const want = [[Math.pow(rk / Q.ref.ko, Q.exp.pow), rp.ko_win], [Math.pow(rs / Q.ref.sub, Q.exp.sub), rp.sub_win], [Math.pow(rl / Q.ref.kol, Q.exp.chin), rp.ko_loss]];
    for (const [m0, o] of want) maxd = Math.max(maxd, Math.abs(r3(m0) - o.at_debut), Math.abs(r3(Math.pow(m0, fd)) - o.now));
    const mlt = E.preufcMult({ n: d.n, ko_w: d.ko_w, sub_w: d.sub_w, ko_l: d.ko_l, n_ufc: Math.min(n1, 3) });
    const f3 = Math.exp(-Math.min(n1, 3) / Q.tau);
    maxF = Math.max(maxF, Math.abs(mlt.pow - Math.pow((d.ko_w + 0.3) / nn / Q.ref.ko, Q.exp.pow * f3)) / mlt.pow,
      Math.abs(mlt.sub - Math.pow((d.sub_w + 0.2) / nn / Q.ref.sub, Q.exp.sub * f3)) / mlt.sub, Math.abs(mlt.chin - Math.pow(rl / Q.ref.kol, Q.exp.chin * f3)) / mlt.chin);
    nR++;
  }
  check("preufc: params = preufc.json's exact constants; engine multipliers = (rate / ref)^(exp x exp(-n_UFC / tau)); preufc.json roster multipliers reproduced",
    constOk && maxF < 1e-12 && maxd <= 0.0065, `${nR} roster fighters; formula rel diff ${maxF.toExponential(2)}; roster (at_debut, now) max |diff| ${maxd.toFixed(4)} ` +
    `(preufc.json's roster block differs from its own eval constants by up to 0.006 at very small rates; the eval constants are the recipe's)`);
  const g = E.preufcMult({ n: 17, ko_w: 14, sub_w: 1, ko_l: 0, n_ufc: 4 });
  check("preufc gate: more than maxUfc (3) prior UFC fights -> no prior", g === null && E.preufcMult({ n: 17, ko_w: 14, sub_w: 1, ko_l: 0, n_ufc: 3 }) !== null);
  // hazards: X's KO hazards x M_pow,X^s x M_chin,Y^s; X's sub attempt rates x M_sub,X^s
  E.loadMLRates(null);
  const c = casesC.find((x) => x.opts.preufc && x.opts.preufc.A && x.opts.preufc.B) || casesC.find((x) => x.opts.preufc && (x.opts.preufc.A || x.opts.preufc.B));
  const m0 = E.matchup(c.a, c.b, withParams(c.opts, { components: { preufc: false } })), m1 = E.matchup(c.a, c.b, withParams(c.opts, { components: { preufc: true } }));
  const sc = FP.preufc.scale, mu = m1.preufc.mult, ok = [0, 1].every((i) => {
    const j = 1 - i, ko = (mu[i] ? Math.pow(mu[i].pow, sc.pow) : 1) * (mu[j] ? Math.pow(mu[j].chin, sc.chin) : 1), su = mu[i] ? Math.pow(mu[i].sub, sc.sub) : 1;
    const close = (a, b) => Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(b));
    return close(m1.kd[i], m0.kd[i] * ko) && close(m1.gnp[i], m0.gnp[i] * ko) && close(m1.stko[i], m0.stko[i] * ko) &&
      [0, 1, 2, 3, 4].every((k) => close(m1.subTPos[i * 5 + k], m0.subTPos[i * 5 + k] * su) && close(m1.subBPos[j * 5 + k], m0.subBPos[j * 5 + k] * su)) &&
      close(m1.dRate[i], m0.dRate[i]) && close(m1.tdD[i], m0.tdD[i]);
  });
  check("preufc: KO hazards (kd, gnp, stko) and sub attempt tables scale by the recipe's multipliers^scale; nothing else moves",
    ok && m1.preufc.src.some((x) => x === "opts"), `fight ${c.f.id}: mult A ${mu[0] ? mu[0].pow.toFixed(3) + "/" + mu[0].sub.toFixed(3) + "/" + mu[0].chin.toFixed(3) : "none"}, B ${mu[1] ? mu[1].pow.toFixed(3) : "none"}`);
  let refused = false;
  try { E.matchup(c.a, c.b, withParams(c.opts, { components: { preufc: true, styles_sos: { styles: false, sos: true, newcomer: true } } })); } catch (e) { refused = /exclusive/.test(e.message); }
  check("preufc refuses styles_sos newcomer (the older stub): never both", refused);
  // backtest records: newcomer sides covered, n_ufc = backtest n, swapped with the corners, 2026 refused
  let cover = 0, need = 0;
  for (const f of train) for (const sd of ["A", "B"]) if (+f[sd].n <= 3) { need++; try { const r = XR.preufcFor(f, false, FP)[sd]; if (r && r.n_ufc === +f[sd].n) cover++; } catch (e) { /* counted as missing */ } }
  const f1 = c.f, p0 = XR.preufcFor(f1, false, FP), p1 = XR.preufcFor(f1, true, FP);
  let r26 = false; try { XR.preufcFor({ id: "x", date: "2026-02-01", A: { n: 1 }, B: { n: 1 } }, false, FP); } catch (e) { r26 = true; }
  check("mlpathrec preufc: every 2019-2023 newcomer side has its pre-bout record (n_ufc = backtest n); corner swap swaps; 2026 refused",
    cover === need && JSON.stringify(p0.A) === JSON.stringify(p1.B) && r26, `${cover} of ${need} newcomer sides`);
  // live roster: only from its ufcstats snapshot on
  const info = E.loadPreUFC(PREJ);
  try {
    const nc = Object.keys(PREJ.roster_priors).find((s) => PREJ.roster_priors[s].n_ufc <= 2 && DB.fighters[s]);
    const opp = "justin-gaethje";
    const mNow = E.matchup(nc, opp, { ml: false, date: "2026-11-06", params: { components: { preufc: true } } });
    const mOld = E.matchup(nc, opp, { ml: false, date: "2025-06-01", params: { components: { preufc: true } } });
    check("loadPreUFC roster: used from its ufcstats snapshot on, never for an earlier bout; veterans (> 3 UFC fights) get no prior",
      info.asof === "2026-10-31" && mNow.preufc.src[0] === "roster" && mNow.preufc.mult[0] !== null && mNow.preufc.mult[1] === null && mOld.preufc.src[0] === null,
      `${info.n} roster records; ${nc}: n_ufc ${PREJ.roster_priors[nc].n_ufc}`);
  } finally { E.loadPreUFC(null); }
}

// ------------------------------------------------------------------ trace format and matchup keys with everything on
{
  E.loadMLRates(mlJson); R0.loadMLRates(mlJson);
  try {
    // key unions over many traced fights (optional keys such as a deduction count appear only on some paths)
    const U = () => ({ fight: new Set(), round: new Set(), evk: {} });
    const OPT = ["nDed", "ded"];   // present only on paths with a point deduction (v401 deductions)
    const ur = U(), uc = U(), extra = new Set();
    const add = (u, f) => {
      Object.keys(f).forEach((k) => u.fight.add(k));
      for (const r of f.rounds) {
        Object.keys(r).forEach((k) => u.round.add(k));
        for (const e of (r.ev || [])) { const t = "ev:" + e.k; if (!u.evk[t]) u.evk[t] = new Set(); Object.keys(e).forEach((k) => u.evk[t].add(k)); }
      }
    };
    noSos(casesC.slice(0, 40)).forEach((c, i) => {
      const mr = R0.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, ALL4));
      Object.keys(mc).filter((k) => !(k in mr)).forEach((k) => extra.add(k));
      for (let q = 0; q < 3; q++) { add(ur, R0.simulate(mr, R0.makeRng(100 * i + q), true)); add(uc, E.simulate(mc, E.makeRng(100 * i + q), true)); }
    });
    const same = (a, b) => JSON.stringify([...a].filter((k) => !OPT.includes(k)).sort()) === JSON.stringify([...b].filter((k) => !OPT.includes(k)).sort());
    const evNew = [];
    for (const t in uc.evk) for (const k of uc.evk[t]) if (!ur.evk[t] || !ur.evk[t].has(k)) evNew.push(t + "." + k);
    check("all step-4 components on: same fight / round keys (deduction keys aside) and event kinds / fields as step 3 (120 traced fights each); the matchup only gains m.embed / m.oppadj / m.preufc",
      same(ur.fight, uc.fight) && same(ur.round, uc.round) && evNew.length === 0 && same(extra, ["embed", "oppadj", "preufc"]),
      `${Object.keys(uc.evk).length} event kinds (step 3: ${Object.keys(ur.evk).length}); new fields: ${JSON.stringify(evNew)}; extra matchup keys ${JSON.stringify([...extra])}`);
  } finally { E.loadMLRates(null); R0.loadMLRates(null); }
}

// ------------------------------------------------------------------ sensitivity rebuilds keep the step-4 inputs
{
  const c = noSos([casesC[1]])[0];
  const m = E.matchup(c.a, c.b, withParams(c.opts, ALL4));
  const s = E.sensitivity(m, { n: 150, seed: 3, kinds: ["knob"], keys: ["out"], sides: ["A"], sd: { out: 0 } });
  check("sensitivity: a zero-size variant rebuilt from the matchup's options reproduces it (embed, oppadj and pre-UFC inputs survive the rebuild)",
    m.embed.src === "opts" && m.oppadj.have.every(Boolean) && !!m.preufc && s.items.every((it) => it.dPA[0] === 0 && it.dPA[1] === 0), JSON.stringify(s.items.map((it) => it.dPA)));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
