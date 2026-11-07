#!/usr/bin/env node
/* test_v5_calA.js: v5 Calibrate A (research/v5_train_ablation.md) changes only the default component flags in src/params3.js
   (plus labels and comments). The engine code is step 5's. Checks:
   1. src/engine3.js is byte for byte step 5's (git show 5251206; skipped without git) and tests/fixtures/params3_pre_calA.js is
      step 5's src/params3.js (same).
   2. Old defaults explicit: the current engine and params, called with opts.params.components = step 5's components block,
      reproduce the step-5 engine (src/engine3.js on params3_pre_calA.js) bit for bit: whole fight objects (JSON incl. the
      per-round trace) for fixed seeds, traced and untraced, a shared rng stream across fights, summarize() and explain(), over
        a. random fighter pairs with the production learned rates, the live durability roster, random SOS and step-4 inputs,
        b. random pairs on the plain tables with the same kinds of inputs,
        c. 2019-2023 backtest fights x 2 corner orders with the out-of-fold learned rates, as-of priors, durability records +
           train NORM, walk-forward SOS pairs and the step-4 walk-forward inputs (the tools/evalv.js path).
   3. New defaults: the current engine with no override = the step-5 engine called with the new components block (a, c).
   4. Every component off (components: false) = the step-5 engine with components: false (c).
   5. The defaults chosen by the ablation (the components block below).
     node tests/test_v5_calA.js [matchups per random group, default 150] */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
const NM = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 150);

// the defaults set by Calibrate A (research/v5_train_ablation.md "Decisions"); keep in step with src/params3.js
const EXPECT = require(path.join(ROOT, "tests/fixtures/calA_components.json"));

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
function loadModule(src) { const mod = { exports: {} }; new Function("module", "exports", "require", src)(mod, mod.exports, require); return mod.exports; }
function loadEngine(src, mods) {
  const mod = { exports: {} };
  const req = (p) => {
    if (mods) for (const k in mods) if (p.endsWith(k)) return mods[k];
    return require(p.startsWith(".") ? path.join(ROOT, "src", p) : p);
  };
  new Function("module", "exports", "require", src)(mod, mod.exports, req);
  return mod.exports;
}
const engSrc = fs.readFileSync(path.join(ROOT, "src/engine3.js"), "utf8");
const preParamsSrc = fs.readFileSync(path.join(ROOT, "tests/fixtures/params3_pre_calA.js"), "utf8");
{
  const ge = git(["show", "5251206:src/engine3.js"]), gp = git(["show", "5251206:src/params3.js"]);
  check("src/engine3.js is step 5's (5251206) byte for byte", ge === null || ge === engSrc, ge === null ? "git not reachable, skipped" : "engine code unchanged");
  check("fixture params3_pre_calA.js is step 5's src/params3.js (5251206)", gp === null || gp === preParamsSrc, gp === null ? "git not reachable, skipped" : "byte for byte");
}
const P0 = loadModule(preParamsSrc);
const R0 = loadEngine(engSrc, { "params3.js": P0 });
const OLD = JSON.parse(JSON.stringify(P0.components)), NEW = JSON.parse(JSON.stringify(FP.components));
check("defaults: the components block set by Calibrate A", JSON.stringify(NEW) === JSON.stringify(EXPECT) &&
  (fs.readFileSync(path.join(ROOT, "src/params3.js"), "utf8").match(/^\s{4}components:\s*\{/mg) || []).length === 1,
  JSON.stringify(NEW));
{
  // nothing but components (and the label) differs between the step-5 params and the current params
  const strip = (p) => { const o = JSON.parse(JSON.stringify(p)); delete o.components; delete o.version; return JSON.stringify(o); };
  check("params: only the components block and the version label changed", strip(P0) === strip(FP), `${P0.version} -> ${FP.version}`);
}

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
for (const e of [E, R0]) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
const DUR = readJSON("data/derived/durability.json");
const NORM = { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 };

// ------------------------------------------------------------------ matchup generators (as tests/test_v5_step5.js)
const rng = E.makeRng(20261107 ^ 0xca1a);
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
  return { a, b, opts, seed: 9100 + i };
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
function withComponents(opts, comps) {
  if (comps === undefined) return opts;
  const o = Object.assign({}, opts), p = Object.assign({}, opts.params || {});
  p.components = comps;
  o.params = p; return o;
}
// current engine with compsE vs the step-5 engine with compsR (undefined = that engine's own defaults)
function runGroup(label, compsE, compsR, cases, ctx) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0, recs = 0;
  const engs = [R0, E];
  if (ctx.ml) engs.forEach((e) => e.loadMLRates(mlJson));
  if (ctx.roster) engs.forEach((e) => e.loadDurability(DUR));
  try {
    cases.forEach((c, i) => {
      const mr = R0.matchup(c.a, c.b, withComponents(c.opts, compsR)), mc = E.matchup(c.a, c.b, withComponents(c.opts, compsE));
      if (mr.mlApplied) applied++;
      if (c.hasRec) recs++;
      const fr = fights(R0, mr, c.seed), fc = fights(E, mc, c.seed);
      nM++; nF += fr.length;
      for (let k = 0; k < fr.length; k++) if (fr[k] !== fc[k]) { bad++; if (!firstBad) firstBad = `case ${i} fight ${k}`; }
      if (i % 10 === 0) {
        nSum++;
        const sr = JSON.stringify(R0.summarize(mr, 150, c.seed)), sc = JSON.stringify(E.summarize(mc, 150, c.seed));
        const xr = JSON.stringify(R0.explain(mr)), xc = JSON.stringify(E.explain(mc));
        if (sr !== sc || xr !== xc) { badSum++; if (!firstBad) firstBad = `summary/explain ${i}`; }
      }
    });
  } finally { engs.forEach((e) => { e.loadMLRates(null); e.loadDurability(null); }); }
  check(`${label}: identical fights (JSON incl. trace), summaries and explain()`, bad === 0 && badSum === 0,
    `${nM} matchups (${applied} learned rates, ${recs} durability records), ${nF} fights, ${nSum} summaries; ${bad} fight / ${badSum} summary mismatches${firstBad ? "; first " + firstBad : ""}`);
  return nM;
}
const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
const stp = Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2))));
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % stp === 3 % stp).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }

console.log(`engine ${E.VERSION} (params ${FP.version}; step 5 params ${P0.version}); ${NM} random matchups per group`);
console.log(`step 5 components ${JSON.stringify(OLD)}\nnew components    ${JSON.stringify(NEW)}`);
{
  let t = 0;
  t += runGroup("2a. old defaults explicit = step-5 engine: random pairs, learned rates, durability roster, SOS + step-4 inputs", OLD, undefined, casesA, { ml: true, roster: true });
  t += runGroup("2b. old defaults explicit = step-5 engine: random pairs, plain tables", OLD, undefined, casesB, { ml: false, roster: false });
  t += runGroup("2c. old defaults explicit = step-5 engine: 2019-2023 backtest fights x 2 orders, every walk-forward input", OLD, undefined, casesC, { ml: false, roster: false });
  check("old defaults: identity covers >= 300 matchups incl. traced fights", t >= 300, `${t} matchups`);
}
{
  let t = 0;
  t += runGroup("3a. new defaults = step-5 engine with the new components block: random pairs, learned rates, roster", undefined, NEW, casesA, { ml: true, roster: true });
  t += runGroup("3c. new defaults = step-5 engine with the new components block: backtest fights", undefined, NEW, casesC, { ml: false, roster: false });
  check("new defaults: >= 300 matchups", t >= 300, `${t} matchups`);
}
runGroup("4. components: false on both = the plain v4 path of the step-5 engine (backtest fights)", false, false, casesC, { ml: false, roster: false });
{
  // the defaults differ from step 5's where the ablation turned a flag off, so a default fight must change somewhere
  E.loadMLRates(mlJson); R0.loadMLRates(mlJson);
  let diff = 0;
  for (const c of casesC.slice(0, 40)) {
    const a = JSON.stringify(E.simulate(E.matchup(c.a, c.b, c.opts), E.makeRng(c.seed), false));
    const b = JSON.stringify(R0.simulate(R0.matchup(c.a, c.b, c.opts), R0.makeRng(c.seed), false));
    if (a !== b) diff++;
  }
  E.loadMLRates(null); R0.loadMLRates(null);
  const changed = JSON.stringify(OLD) !== JSON.stringify(NEW);
  check("default fights change iff the components block changed", changed ? diff > 0 : diff === 0, `${diff} of 40 backtest fights differ; block changed: ${changed}`);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
