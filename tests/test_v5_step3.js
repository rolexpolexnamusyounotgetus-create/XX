#!/usr/bin/env node
/* test_v5_step3.js: engine v5 merge step 3 (params.components.styles_sos, .officials, .realism_sens), flag-off identity.

   Each component's flag-off path must reproduce the engine before it, bit for bit, for fixed seeds:
   R0. styles_sos, officials and realism_sens off = the step-2 engine (tests/fixtures/engine3_pre_styles_sos.js, a frozen copy
       of src/engine3.js at commit 8317287 "v5 merge: step 2 durability + dynamics"), run on the current params3.js and
       mlrates.js like the earlier step tests.
   R0s. The same, strict: the step-2 engine on step 2's OWN params3.js and ml/mlrates.js (git show 8317287; skipped without git).
   R1. officials and realism_sens off (styles_sos on, with SOS inputs passed) = the step-2 engine + styles_sos
       (tests/fixtures/engine3_pre_officials.js).
   R2. realism_sens off = step 2 + styles_sos + officials (tests/fixtures/engine3_pre_realism.js).
   Compared: whole fight objects (JSON, including the per-round trace) for fixed seeds, traced and untraced, a shared rng
   stream across fights, summarize() and explain() output, over
     a. random fighter pairs from data/derived/fighters.json with the production learned rates and the live durability roster
        (the page path), with random SOS inputs (opts.sos) and, for a quarter of them, named judges and a referee,
     b. random pairs on the plain tables (ml: false) with random SOS inputs,
     c. 2019-2023 backtest fights (train years only) in both corner orders with the out-of-fold learned rates, the as-of priors,
        the durability walk-forward records + train NORM and the walk-forward SOS pairs (tools/sosrec.js: sos_wf.json, A/B
        swapped with the corners, leave-one-year-out coefficients): the tools/evalv.js path.
   Then: the comparisons are not vacuous (each flag on changes fights), the shipped defaults, SOS without inputs is a no-op,
   the harness helper (corner swap mirrors the multipliers; 2026 refused), the officials opt-in, and sensitivity() rebuilds
   through the public matchup (SOS and officials names survive the rebuild).
     node tests/test_v5_step3.js [matchups per random group, default 150]   (about three minutes) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
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
// a frozen engine source; relative requires resolve against src/ (the current params, mlrates and styles_sos modules) unless
// `mods` maps them
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
const R0 = loadEngine(fx("engine3_pre_styles_sos.js"));   // step 2
const R1 = loadEngine(fx("engine3_pre_officials.js"));    // step 2 + styles_sos
const R2 = loadEngine(fx("engine3_pre_realism.js"));      // step 2 + styles_sos + officials
let R0s = null;
{
  const g = git(["show", "8317287:src/engine3.js"]);
  check("fixture engine3_pre_styles_sos.js is src/engine3.js of the step-2 commit 8317287", g === null || g === fx("engine3_pre_styles_sos.js"),
    g === null ? "git not reachable, skipped" : "byte for byte");
  const gp = git(["show", "8317287:src/params3.js"]), gm = git(["show", "8317287:src/ml/mlrates.js"]);
  if (g && gp && gm) R0s = loadEngine(g, { "params3.js": loadModule(gp), "ml/mlrates.js": loadModule(gm) });
  check("reference engines load (step 2: no StylesSOS hook / officials / sensitivity; +styles_sos; +officials)",
    typeof R0.loadOfficials !== "function" && typeof R1.loadOfficials !== "function" && typeof R2.loadOfficials === "function" &&
    typeof R2.sensitivity !== "function" && typeof E.sensitivity === "function" && !/\[styles_sos\]/.test(fx("engine3_pre_styles_sos.js")) &&
    /\[styles_sos\]/.test(fx("engine3_pre_officials.js")), `versions ${R0.VERSION} / ${R1.VERSION} / ${R2.VERSION}; strict step-2 params ${R0s ? R0s.params().version : "skipped"}`);
}

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
const ENGS = [E, R0, R1, R2].concat(R0s ? [R0s] : []);
for (const e of ENGS) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
const DUR = readJSON("data/derived/durability.json");
const NORM = { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 };
const SOSJ = SR.table();

// ------------------------------------------------------------------ shipped defaults
check("defaults: styles_sos = { styles: false, sos: true, newcomer: false } with sosSource 'wf'; officials off with named-judge effects off; realism_sens off",
  JSON.stringify(FP.components.styles_sos) === JSON.stringify({ styles: false, sos: true, newcomer: false }) && FP.stylesSOS.sosSource === "wf" &&
  FP.components.officials === false && FP.officials.perJudge === false && FP.components.realism_sens === false &&
  FP.components.durability === true && FP.components.dynamics === true, JSON.stringify(FP.components));

// ------------------------------------------------------------------ matchup generators
const rng = E.makeRng(20261106 ^ 3);
const DB = JSON.parse(dbJson);
const slugs = Object.keys(DB.fighters).filter((s) => DB.fighters[s] && DB.fighters[s].n_fights >= 1).sort();
const DIVS = Object.keys(DB.priors).filter((d) => !["ALL", "Catch Weight", "Open Weight"].includes(d));
const JUDGES = ["Sal D'Amato", "Derek Cleary", "Chris Lee", "Mike Bell", "Junichiro Kamijo"], REFS = ["Herb Dean", "Marc Goddard", "Jason Herzog"];
function pick(a) { return a[Math.floor(rng.u() * a.length)]; }
function randSos() {   // a random but plausible [q, w] pair per stat (5 stats), opponents' allowed (a) and produced (o)
  const mk = () => [0, 1, 2, 3, 4].map(() => [0.3 * (rng.u() - 0.5), 5 + 60 * rng.u()]);
  return { a: mk(), o: mk() };
}
function randomCase(i) {
  const a = pick(slugs); let b = pick(slugs); while (b === a) b = pick(slugs);
  const fa = DB.fighters[a], div = rng.u() < 0.7 && fa.division && DB.priors[fa.division] ? fa.division : pick(DIVS);
  const rounds = rng.u() < 0.3 ? 5 : 3;
  const opts = { division: div, rounds, title: rounds === 5 && rng.u() < 0.6, date: "2026-11-06", sos: { A: randSos(), B: randSos() } };
  if (rng.u() < 0.25) { opts.adjA = { chin: 0.7 + rng.u(), pow: 0.7 + rng.u() }; opts.adjB = { out: 0.8 + 0.4 * rng.u(), chin: 0.7 + rng.u() }; }
  if (rng.u() < 0.25) { opts.judges = [pick(JUDGES), pick(JUDGES), pick(JUDGES)]; opts.referee = pick(REFS); }
  return { a, b, opts, seed: 7000 + i };
}
const bt = readJSON("data/derived/backtest_dev.json");
const train = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");   // train years only (hidden-data protocol)
for (const f of train) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
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
function btCase(f, o) {
  const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A, ent = OOF.fights[f.id];
  const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priorsAsof[f.date.slice(0, 4)] };
  opts.ml = ent && ent.A && ent.B ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false;
  const rec = durRec(f.id, o);
  if (rec) { opts.dur = rec; opts.params = { durability: NORM }; }
  SR.apply(opts, f, o === 1);   // opts.sos (corners swapped) + leave-one-year-out coefficients in opts.params.stylesSOS
  return { a: A, b: B, opts, seed: (parseInt(f.id.slice(0, 8), 16) ^ (o * 0x9e3779b1)) >>> 0, hasRec: !!rec };
}

// ------------------------------------------------------------------ comparison
const SEEDS = 6;   // fights per matchup: seeds 0..5, odd ones traced, then a shared stream of 4
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
const OFF0 = { components: { styles_sos: false, officials: false, realism_sens: false, calB: false } };
const OFF1 = { components: { officials: false, realism_sens: false, calB: false } };
const OFF2 = { components: { realism_sens: false, calB: false } };
function runGroup(label, REF, refName, OFF, cases, ctx) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0, recs = 0, sosOn = 0, named = 0;
  const go = () => {
    cases.forEach((c, i) => {
      const mr = REF.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, OFF));
      if (mr.mlApplied) applied++;
      if (c.hasRec) recs++;
      if (Array.isArray(c.opts.judges)) named++;
      if (mc.stylesSOS && mc.stylesSOS.sos && mc.stylesSOS.sos.have[0]) sosOn++;
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
    `${nM} matchups (${applied} learned rates, ${recs} durability records, ${sosOn} with SOS applied, ${named} with named officials), ${nF} fights, ${nSum} summaries; ` +
    `${bad} fight / ${badSum} summary mismatches${firstBad ? "; first " + firstBad : ""}`);
  return nM;
}

const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
const stp = Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2))));
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % stp === 5 % stp).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }

console.log(`engine ${E.VERSION} (params ${E.params().version}); ${NM} random matchups per group`);
const REFS3 = [[R0, "all three off = step-2 engine", OFF0], [R1, "officials + realism_sens off = step 2 + styles_sos", OFF1], [R2, "realism_sens off = step 2 + styles_sos + officials", OFF2]];
for (const [REF, refName, OFF] of REFS3) {
  let total = 0;
  total += runGroup("a. random pairs, learned rates, durability roster, random SOS inputs, some named officials", REF, refName, OFF, casesA, { ml: true, roster: true });
  total += runGroup("b. random pairs, plain tables, random SOS inputs", REF, refName, OFF, casesB, { ml: false, roster: false });
  total += runGroup("c. 2019-2023 backtest fights x 2 corner orders, OOF rates, durability records, walk-forward SOS pairs", REF, refName, OFF, casesC, { ml: false, roster: false });
  check(`${refName}: identity covers >= 300 matchups incl. traced fights`, total >= 300, `${total} matchups`);
}
if (R0s) {
  let total = 0;
  // v5 Calibrate A (research/v5_train_ablation.md) turned components.v401.mlLevels off by default; the strict reference runs on
  // its own params3.js, so the current engine is called with that reference's v401 sub-flags pinned
  const OFF0s = { components: Object.assign({}, OFF0.components, { v401: R0s.params().components.v401 }) };
  total += runGroup("a (strict)", R0s, "all three off = step-2 engine on step 2's own params3.js + mlrates.js", OFF0s, casesA, { ml: true, roster: true });
  total += runGroup("c (strict)", R0s, "all three off = step-2 engine on step 2's own params3.js + mlrates.js", OFF0s, casesC, { ml: false, roster: false });
  check("strict step-2 reference: >= 300 matchups", total >= 300, `${total} matchups`);
} else console.log("SKIP  strict step-2 reference (git objects not reachable)");

// ------------------------------------------------------------------ not vacuous: each flag on changes fights vs its reference
{
  E.loadMLRates(mlJson); R0.loadMLRates(mlJson); R1.loadMLRates(mlJson); R2.loadMLRates(mlJson);
  try {
    const ON = [
      [R0, "styles_sos (SOS, with inputs) on vs step 2", { components: { officials: false, realism_sens: false, calB: false } }, 0.3],
      [R1, "officials on vs step 2 + styles_sos", { components: { officials: true, realism_sens: false, calB: false } }, 0.05],
      [R2, "realism_sens on (shipped v4.0.1 factors) vs step 2 + styles_sos + officials", { components: { realism_sens: true, calB: false } }, 0.3]
    ];
    // fight.officials (the names) is dropped before comparing, so the officials check counts changed scoring, not the new field
    const noOff = (j) => { const o = JSON.parse(j); delete o.officials; return JSON.stringify(o); };
    for (const [REF, nm, P, min] of ON) {
      let diff = 0, n = 0;
      casesA.slice(0, 30).concat(casesC.slice(0, 30)).forEach((c) => {
        const fr = fights(REF, REF.matchup(c.a, c.b, c.opts), c.seed).map(noOff), fc = fights(E, E.matchup(c.a, c.b, withParams(c.opts, P)), c.seed).map(noOff);
        for (let q = 0; q < fr.length; q++) { n++; if (fr[q] !== fc[q]) diff++; }
      });
      check(`flag on changes fights: ${nm}`, diff > min * n, `${diff} of ${n} fights differ`);
    }
  } finally { E.loadMLRates(null); R0.loadMLRates(null); R1.loadMLRates(null); R2.loadMLRates(null); }
}

// ------------------------------------------------------------------ SOS with no inputs is a no-op (the page path until a roster table loads)
{
  let bad = 0, n = 0;
  E.loadMLRates(mlJson); R0.loadMLRates(mlJson);
  try {
    casesA.slice(0, 40).forEach((c) => {
      const o = Object.assign({}, c.opts); delete o.sos;
      // v5 Calibrate B: the default params now carry components.calB (a later step), pinned off against the step-2 engine
      const fr = fights(R0, R0.matchup(c.a, c.b, o), c.seed), fc = fights(E, E.matchup(c.a, c.b, withParams(o, { components: { calB: false } })), c.seed);
      for (let q = 0; q < fr.length; q++) { n++; if (fr[q] !== fc[q]) bad++; }
    });
  } finally { E.loadMLRates(null); R0.loadMLRates(null); }
  check("default params (calB off) with no SOS input (page path) = the step-2 engine, bit for bit", bad === 0, `${n} fights, ${bad} differ`);
}

// ------------------------------------------------------------------ harness helper (tools/sosrec.js)
{
  const f = train.find((x) => SOSJ.fights[x.id]);
  const oA = SR.apply({ division: f.division, rounds: f.rounds, date: f.date, ml: false }, f, false);
  const oB = SR.apply({ division: f.division, rounds: f.rounds, date: f.date, ml: false }, f, true);
  const mA = E.matchup(f.A, f.B, oA), mB = E.matchup(f.B, f.A, oB);
  const ma = mA.stylesSOS.sos.mult, mb = mB.stylesSOS.sos.mult;
  const mirror = Object.keys(ma[0]).every((k) => Math.abs(ma[0][k] - mb[1][k]) < 1e-12 && Math.abs(ma[1][k] - mb[0][k]) < 1e-12);
  const y = f.date.slice(0, 4), loyo = JSON.stringify(oA.params.stylesSOS.sosCoef) === JSON.stringify({ ml: SOSJ.meta.coef_loyo.ml[y], base: SOSJ.meta.coef_loyo.base[y] });
  const val = JSON.stringify(SR.coefFor("2024-06-01")) === JSON.stringify(SOSJ.meta.coef);
  let refused = false; try { SR.coefFor("2026-01-15"); } catch (e) { refused = true; }
  let noPair = false; try { SR.pair("no-such-fight", false); } catch (e) { noPair = true; }
  check("sosrec: swapping the corners swaps the pair and mirrors the multipliers; train = leave-one-year-out, 2024-25 = meta.coef; 2026 and missing pairs refused",
    mirror && loyo && val && refused && noPair && mA.stylesSOS.sos.have.every(Boolean), `fight ${f.id} ${f.date}; dAtt mult ${ma[0].dAtt.toFixed(4)} / ${ma[1].dAtt.toFixed(4)}`);
  check("module SOS_COEF = sos_wf.json meta.coef (the 2019-2023 fit used for 2024-25)", JSON.stringify(require(path.join(ROOT, "src/styles_sos.js")).SOS_COEF) === JSON.stringify(SOSJ.meta.coef));
  const n2026 = Object.values(SOSJ.fights).filter((x) => String(x.date) >= "2026-01-01").length;
  check("sos_wf.json holds no fight dated 2026-01-01 or later", n2026 === 0, `${Object.keys(SOSJ.fights).length} pairs`);
}

// ------------------------------------------------------------------ officials opt-in (showing real officials)
{
  const vg = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06", ml: false, judges: ["Sal D'Amato", "Derek Cleary", "Chris Lee"], referee: "Herb Dean" };
  const f0 = E.simulate(E.matchup("alexander-volkanovski", "justin-gaethje", vg), E.makeRng(5), true);
  const mOn = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { components: { officials: true } } }, vg));
  const f1 = E.simulate(mOn, E.makeRng(5), true);
  check("officials: off by default even with named judges (no fight.officials); opt-in per call records the names",
    !f0.officials && f1.officials && f1.officials.judges.length === 3 && f1.officials.referee === "Herb Dean" && mOn.off.perJudge === false,
    JSON.stringify(f1.officials && f1.officials.judges));
}

// ------------------------------------------------------------------ sensitivity rebuilds through the public matchup
{
  const c = casesC[0];
  const m = E.matchup(c.a, c.b, c.opts);
  const z0 = (o) => E.sensitivity(m, Object.assign({ n: 150, seed: 3, kinds: ["knob"], keys: ["out"], sides: ["A"], sd: { out: 0 } }, o || {}));
  const s = z0();
  check("sensitivity: a zero-size variant rebuilt from the matchup's options reproduces it (SOS inputs survive the rebuild)",
    m.stylesSOS.sos.have.every(Boolean) && s.items.every((it) => it.dPA[0] === 0 && it.dPA[1] === 0), JSON.stringify(s.items.map((it) => it.dPA)));
  const vg = { division: "Lightweight", rounds: 3, date: "2026-11-06", ml: false, judges: ["Sal D'Amato", "Derek Cleary", "Chris Lee"], params: { components: { officials: true } } };
  const mo = E.matchup("alexander-volkanovski", "justin-gaethje", vg);
  const so = E.sensitivity(mo, { n: 150, seed: 4, kinds: ["knob"], keys: ["out"], sides: ["A"], sd: { out: 0 } });
  check("sensitivity: officials name lists survive the rebuild", so.items.every((it) => it.dPA[0] === 0 && it.dPA[1] === 0), JSON.stringify(so.items.map((it) => it.dPA)));
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
