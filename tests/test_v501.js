#!/usr/bin/env node
/* test_v501.js: engine 5.0.1 = engine 5.0.0 (versions/v5-rejected/, frozen) + the v5 review's fixes. Checks:
   1. components.v501 OFF: the current engine and params with opts.params.components.v501 = false reproduce the frozen 5.0.0
      engine on its own params bit for bit for valid inputs (whole fight objects incl. the per-round trace, traced and untraced,
      a shared rng stream, summarize() and explain()) over
        a. random fighter pairs with the production learned rates, the live durability roster, random SOS and step-4 inputs,
        b. random pairs on the plain tables (computed durability fallback),
        c. 2019-2023 backtest fights x 2 corner orders with every walk-forward input (the tools/evalv.js path).
      So the input guards (NaN / date / rounds / judges / params loading) change nothing for valid inputs.
   2. Each sub-flag alone changes what it should and nothing else:
        durFallback: only matchups on the computed chin / power path (b); never a backtest fight with full records (c);
        dynNoise / kdBase / levels: the sets in params.v501.set (when present).
   3. resolveParams: v501 on puts each set in; an explicit opts.params override wins.
     node tests/test_v501.js [matchups per random group, default 120] */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
// the frozen 5.0.0 engine (its own sibling params3.js, ml/, styles_sos.js); 5.0.0 reads a global FightParams first, so none is set
delete global.FightParams;
const R0 = require(path.join(ROOT, "versions/v5-rejected/engine3.js"));
const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
const NM = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 120);
let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
check("reference is the frozen 5.0.0 engine", R0.VERSION === "5.0.0" && /^5\.0\.0/.test(R0.params().version) && /^5\.0\.1/.test(E.VERSION), R0.VERSION + " / " + E.VERSION);
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
function runGroup(label, extraE, cases, ctx) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0, recs = 0, comp = 0;
  const engs = [R0, E];
  if (ctx.ml) engs.forEach((e) => e.loadMLRates(mlJson));
  if (ctx.roster) engs.forEach((e) => e.loadDurability(DUR));
  try {
    cases.forEach((c, i) => {
      const mr = R0.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, extraE));
      if (mr.mlApplied) applied++;
      if (c.hasRec) recs++;
      if (mc.dur && (mc.dur.A.src !== "record" || mc.dur.B.src !== "record")) comp++;
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
  return { nM, nF, bad, badSum, nSum, firstBad, applied, recs, comp };
}
function report(label, r, expectSame) {
  const info = `${r.nM} matchups (${r.applied} learned rates, ${r.recs} durability records, ${r.comp} on the computed path), ${r.nF} fights, ${r.nSum} summaries; ${r.bad} fight / ${r.badSum} summary mismatches${r.firstBad ? "; first " + r.firstBad : ""}`;
  check(label, expectSame ? (r.bad === 0 && r.badSum === 0) : (r.bad > 0), info);
}
const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
const stp = Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2))));
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % stp === 5 % stp).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }

console.log(`engine ${E.VERSION} (params ${FP.version}) vs frozen ${R0.VERSION} (params ${R0.params().version}); ${NM} random matchups per group`);
const OFF = { components: { v501: false } };
report("1a. v501 off = 5.0.0: random pairs, learned rates, durability roster, SOS + step-4 inputs", runGroup("", OFF, casesA, { ml: true, roster: true }), true);
report("1b. v501 off = 5.0.0: random pairs, plain tables, computed durability", runGroup("", OFF, casesB, { ml: false, roster: false }), true);
report("1c. v501 off = 5.0.0: 2019-2023 backtest fights x 2 orders, every walk-forward input", runGroup("", OFF, casesC, { ml: false, roster: false }), true);
// 2. sub-flags one at a time (the others off)
const SUBS = ["durFallback", "dynNoise", "kdBase", "levels"];
const only = (s) => { const c = {}; for (const k of SUBS) c[k] = k === s; return { components: { v501: c } }; };
const set5 = (FP.v501 && FP.v501.set) || {};
{
  report("2a. durFallback alone changes computed-path matchups (plain tables, no roster)", runGroup("", only("durFallback"), casesB.slice(0, 40), { ml: false, roster: false }), false);
  report("2b. durFallback alone leaves backtest fights with full records unchanged", runGroup("", only("durFallback"), casesC, { ml: false, roster: false }), true);
}
for (const s of ["dynNoise", "kdBase", "levels"]) {
  if (!set5[s]) { check(`2. ${s}: no set in params.v501 (not part of this build)`, true); continue; }
  report(`2. ${s} alone changes backtest fights`, runGroup("", only(s), casesC.slice(0, 30), { ml: false, roster: false }), false);
}
// 3. resolveParams
{
  const rp = E.resolveParams({});
  let ok = true;
  for (const s of SUBS) if (set5[s]) for (const blk of Object.keys(set5[s])) for (const k of Object.keys(set5[s][blk])) {
    const v = set5[s][blk][k];
    if (typeof v !== "object" && rp[blk][k] !== v) ok = false;
  }
  check("3. v501 on: every set value is in the resolved params", ok);
  const ov = E.resolveParams({ durability: { normComputedChin: 0.5 } });
  check("3. an explicit opts.params override wins over the v501 set", ov.durability.normComputedChin === 0.5);
  const off = E.resolveParams({ components: { v501: false } });
  check("3. v501 off keeps the usual (5.0.0) fields", off.durability.normComputedChin === 1 && off.durability.normComputedPow === 1);
  check("3. v501Flags: true / false / object", JSON.stringify(E.v501Flags({ components: { v501: { dynNoise: false } } })) === JSON.stringify({ durFallback: true, dynNoise: false, kdBase: true, levels: true }));
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
