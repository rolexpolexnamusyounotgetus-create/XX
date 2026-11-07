#!/usr/bin/env node
/* test_v5_calB.js: v5 Calibrate B (research/v5_calB.md) puts the joint level pass behind components.calB (params.calB.set:
   dyn.kdLevel3 / kdLevel5 / convLevel / stkoScale / gnpScale, judge.t108; src/engine3.js resolveParams). Checks:
   1. Fixtures: tests/fixtures/engine3_pre_calB.js / params3_pre_calB.js are the Calibrate A commit's (2e24835) src files (skipped
      without git). src/engine3.js = that engine + the [calB]-tagged lines (and the VERSION label).
   2. src/params3.js differs from the Calibrate A params only in the version label, components.calB, the calB block and the
      blend_anchor rebuild's blend.mrWeight / blend.anchor.slope0 / blend.boot.inflate (predict only).
   3. calB OFF: the current engine and params with opts.params.components.calB = false reproduce the Calibrate A engine on its own
      params bit for bit: whole fight objects (JSON incl. the per-round trace) for fixed seeds, traced and untraced, a shared rng
      stream across fights, summarize() and explain(), over
        a. random fighter pairs with the production learned rates, the live durability roster, random SOS and step-4 inputs,
        b. random pairs on the plain tables with the same kinds of inputs,
        c. 2019-2023 backtest fights x 2 corner orders with the out-of-fold learned rates, as-of priors, durability records +
           train NORM, walk-forward SOS pairs and the step-4 walk-forward inputs (the tools/evalv.js path).
   4. calB ON (the defaults) = the Calibrate A engine called with params.calB.set as an opts.params override (a, c): the component is
      exactly that parameter set.
   5. components: false on both = identical (the plain v4 path).
   6. resolveParams: calB on puts the set in; a v401 sub-flag that is off still restores its own fields (emJudge off -> t108 8.555);
      an explicit override wins; calB off keeps the usual fields.
   7. The flag changes default fights; the trace keys are unchanged.
     node tests/test_v5_calB.js [matchups per random group, default 150] */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
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

// ------------------------------------------------------------------ 1-2. sources
const preEngSrc = fs.readFileSync(path.join(ROOT, "tests/fixtures/engine3_pre_calB.js"), "utf8");
const preParSrc = fs.readFileSync(path.join(ROOT, "tests/fixtures/params3_pre_calB.js"), "utf8");
{
  const ge = git(["show", "2e24835:src/engine3.js"]), gp = git(["show", "2e24835:src/params3.js"]);
  check("fixtures are the Calibrate A commit's (2e24835) src/engine3.js and src/params3.js", ge === null || (ge === preEngSrc && gp === preParSrc),
    ge === null ? "git not reachable, skipped" : "byte for byte");
  // v5.0.1: from engine 5.0.1 on, src/ carries later changes (components.v501 and the input guards); the source checks then
  // verify the Calibrate B diff on the frozen 5.0.0 files (versions/v5-rejected/), and the behaviour checks below pin v501 off
  const SRC5 = /^5\.0\.0/.test(E.VERSION) ? "src" : "versions/v5-rejected";
  const cur = fs.readFileSync(path.join(ROOT, SRC5, "engine3.js"), "utf8");
  const vnorm = (s) => s.replace(/var VERSION = "[^"]*";[^\n]*/, "var VERSION;");
  const norm = cur.split("\n").filter((l) => !l.includes("[calB]") || l.includes("if (back)"))
    .map((l) => (l.includes("[calB]") ? l.replace(/\s*\/\/ \[calB\].*$/, "").replace("mergeParams(b0, back)", "mergeParams(base, back)") : l)).join("\n");
  check("src/engine3.js = the Calibrate A engine + the [calB] lines (and the VERSION label)", vnorm(norm) === vnorm(preEngSrc),
    `VERSION ${E.VERSION}`);
}
const P0 = loadModule(preParSrc);
const R0 = loadEngine(preEngSrc, { "params3.js": P0 });
{
  const strip = (p) => {
    const o = JSON.parse(JSON.stringify(p));
    delete o.version; delete o.calB; if (o.components) delete o.components.calB;
    if (o.blend) { delete o.blend.mrWeight; if (o.blend.anchor) delete o.blend.anchor.slope0; if (o.blend.boot) delete o.blend.boot.inflate; }
    return JSON.stringify(o);
  };
  const FP5 = /^5\.0\.0/.test(E.VERSION) ? FP : loadModule(fs.readFileSync(path.join(ROOT, "versions/v5-rejected/params3.js"), "utf8"));
  check("params: only the label, components.calB, the calB block and blend.mrWeight / anchor.slope0 / boot.inflate changed", strip(P0) === strip(FP5),
    `${P0.version} -> ${FP5.version}` + (FP5 === FP ? "" : " (frozen 5.0.0 params; src is " + FP.version + ")"));
  check("defaults: components.calB on, the set holds the fitted levels", FP.components.calB === true && FP.calB && FP.calB.set &&
    FP.calB.set.dyn && FP.calB.set.judge && Object.keys(FP.calB.set).sort().join(",") === "dyn,judge", JSON.stringify(FP.calB.set));
}

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
for (const e of [E, R0]) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
const DUR = readJSON("data/derived/durability.json");
const NORM = { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 };

// ------------------------------------------------------------------ matchup generators (as tests/test_v5_calA.js)
const rng = E.makeRng(20261107 ^ 0xca1b);
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
  return { a, b, opts, seed: 9300 + i };
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
// opts with an extra params override merged in (two levels, as the engine's mergeParams; components merged field by field)
function withParams(opts, extra) {
  if (extra === undefined) return opts;
  const o = Object.assign({}, opts), p = JSON.parse(JSON.stringify(opts.params || {}));
  if (extra === false) { p.components = false; o.params = p; return o; }
  for (const k of Object.keys(extra)) {
    const v = extra[k];
    if (v && typeof v === "object" && !Array.isArray(v) && p[k] && typeof p[k] === "object") p[k] = Object.assign({}, p[k], v);
    else p[k] = JSON.parse(JSON.stringify(v));
  }
  o.params = p; return o;
}
// current engine with extraE vs the Calibrate A engine with extraR (undefined = that engine's own defaults)
function runGroup(label, extraE, extraR, cases, ctx) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0, recs = 0;
  const engs = [R0, E];
  if (ctx.ml) engs.forEach((e) => e.loadMLRates(mlJson));
  if (ctx.roster) engs.forEach((e) => e.loadDurability(DUR));
  try {
    cases.forEach((c, i) => {
      const mr = R0.matchup(c.a, c.b, withParams(c.opts, extraR)), mc = E.matchup(c.a, c.b, withParams(c.opts, extraE));
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
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % stp === 5 % stp).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }

console.log(`engine ${E.VERSION} (params ${FP.version}; Calibrate A params ${P0.version}); ${NM} random matchups per group`);
const OFF = { components: { calB: false, v501: false } };
{
  let t = 0;
  t += runGroup("3a. calB off = Calibrate A engine: random pairs, learned rates, durability roster, SOS + step-4 inputs", OFF, undefined, casesA, { ml: true, roster: true });
  t += runGroup("3b. calB off = Calibrate A engine: random pairs, plain tables", OFF, undefined, casesB, { ml: false, roster: false });
  t += runGroup("3c. calB off = Calibrate A engine: 2019-2023 backtest fights x 2 orders, every walk-forward input", OFF, undefined, casesC, { ml: false, roster: false });
  check("calB off: identity covers >= 300 matchups incl. traced fights", t >= 300, `${t} matchups`);
}
{
  let t = 0;
  const SET = JSON.parse(JSON.stringify(FP.calB.set));
  // v5.0.1: components.v501 (a later step) is pinned off; its own identity test is tests/test_v501.js
  const V5OFF = { components: { v501: false } };
  t += runGroup("4a. calB on (defaults, v501 off) = Calibrate A engine + the calB set as an override: random pairs, learned rates, roster", V5OFF, SET, casesA, { ml: true, roster: true });
  t += runGroup("4c. calB on (defaults, v501 off) = Calibrate A engine + the calB set as an override: backtest fights", V5OFF, SET, casesC, { ml: false, roster: false });
  check("calB on: >= 300 matchups", t >= 300, `${t} matchups`);
}
runGroup("5. components: false on both = the plain v4 path (backtest fights)", false, false, casesC, { ml: false, roster: false });
{
  const S = FP.calB.set, p1 = E.resolveParams({ components: { v501: false } }), p0 = E.resolveParams(OFF);
  const sameDyn = Object.keys(S.dyn).every((k) => p1.dyn[k] === S.dyn[k] && p0.dyn[k] === FP.dyn[k]);
  check("resolveParams: calB on = the set, calB off = the usual fields", sameDyn && p1.judge.t108 === S.judge.t108 && p0.judge.t108 === FP.judge.t108,
    `kdLevel3 ${p1.dyn.kdLevel3} / ${p0.dyn.kdLevel3}, t108 ${p1.judge.t108} / ${p0.judge.t108}`);
  const pe = E.resolveParams({ components: { v401: { emJudge: false }, v501: false } });
  check("resolveParams: emJudge off restores v4.0.0's t108 under calB", pe.judge.t108 === FP.v401.off.emJudge.judge.t108 && pe.dyn.kdLevel3 === S.dyn.kdLevel3,
    `t108 ${pe.judge.t108}`);
  const po = E.resolveParams({ judge: { t108: 9.1 }, dyn: { convLevel: 1.2 }, components: { v501: false } });
  check("resolveParams: an explicit override wins over the calB set", po.judge.t108 === 9.1 && po.dyn.convLevel === 1.2 && po.dyn.kdLevel3 === S.dyn.kdLevel3);
  const pf = E.resolveParams({ components: false });
  check("resolveParams: components false leaves the set out", pf.dyn.kdLevel3 === FP.dyn.kdLevel3 && pf.judge.t108 === FP.v401.off.emJudge.judge.t108);
}
{
  E.loadMLRates(mlJson);
  let diff = 0, keysSame = true;
  for (const c of casesC.slice(0, 40)) {
    const a = E.simulate(E.matchup(c.a, c.b, withParams(c.opts, { components: { v501: false } })), E.makeRng(c.seed), true);
    const b = E.simulate(E.matchup(c.a, c.b, withParams(c.opts, OFF)), E.makeRng(c.seed), true);
    if (JSON.stringify(a) !== JSON.stringify(b)) diff++;
    // nDed is present only in a fight with a point deduction (as before Calibrate B), so it is left out of the key list
    const ka = Object.keys(a).filter((k) => k !== "nDed").join(","), kb = Object.keys(b).filter((k) => k !== "nDed").join(",");
    // a round's ded key appears only with a point deduction (decisions), as nDed does
    const rk = (r) => Object.keys(r).filter((k) => k !== "ded").join(",");
    const ra = a.rounds.map(rk).join("|"), rb = b.rounds.map(rk).join("|");
    if (ka !== kb || (a.rounds.length === b.rounds.length && ra !== rb)) keysSame = false;
  }
  E.loadMLRates(null);
  check("calB changes default fights", diff > 0, `${diff} of 40 backtest fights differ`);
  check("trace format: fight and round keys unchanged with calB on", keysSame);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
