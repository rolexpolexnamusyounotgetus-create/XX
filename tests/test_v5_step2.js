#!/usr/bin/env node
/* test_v5_step2.js: engine v5 merge step 2 (params.components.durability, params.components.dynamics), flag-off identity.

   Each component's flag-off path must reproduce the engine before it, bit for bit, for fixed seeds:
   1. durability off and dynamics off = the step-1 engine (tests/fixtures/engine3_pre_durability.js, a frozen copy of
      src/engine3.js at commit 9656818 "v5 merge: step 1 components.v401").
   2. dynamics off (durability on, the default) = the step-1 engine plus durability (tests/fixtures/engine3_pre_dynamics.js,
      a frozen copy of src/engine3.js after the durability merge and before the dynamics merge).
   Both reference engines run on the current src/params3.js and src/ml/mlrates.js (they ignore the flags and blocks they do
   not know). Components merged after step 2 (if any) are switched off for these comparisons.
   Compared: whole fight objects (JSON, including the per-round trace) for fixed seeds, traced and untraced, a shared rng
   stream across fights, summarize() output and explain() output, over random matchups:
     a. random fighter pairs from data/derived/fighters.json with the production learned rates and the live durability
        roster loaded (the page path),
     b. random pairs with opts.ml === false and no roster (the plain tables; durability falls back to computed records),
     c. 2019-2023 backtest fights (data/derived/backtest_dev.json, train years only) in both corner orders with the
        out-of-fold learned rates, the as-of priors and the durability walk-forward records + train NORM (the
        tools/evalv.js path).
   3. Both flags on: the trace format and the matchup API are unchanged (keys of fight, round, stats and totals objects).
   4. dyn.arPhi / dyn.accArPhi outside their valid range [0, 1) are clipped (finite tables and fights); defaults unchanged.
     node tests/test_v5_step2.js [matchups per random group, default 150]   (about a minute) */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const NM = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 150);

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
// a frozen engine source with its relative requires resolved against src/ (the same params and mlrates modules)
function loadEngine(rel) {
  const src = fs.readFileSync(path.join(ROOT, rel), "utf8"), mod = { exports: {} };
  const req = (p) => require(p.startsWith(".") ? path.join(ROOT, "src", p) : p);
  new Function("module", "exports", "require", src)(mod, mod.exports, req);
  return mod.exports;
}
const E1 = loadEngine("tests/fixtures/engine3_pre_durability.js");   // step-1 engine
const E2 = loadEngine("tests/fixtures/engine3_pre_dynamics.js");     // step-1 + durability
{
  let gitSame = null;
  try {
    const g = require("child_process").execFileSync("git", ["-C", ROOT, "show", "9656818:src/engine3.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
    gitSame = g === fs.readFileSync(path.join(ROOT, "tests/fixtures/engine3_pre_durability.js"), "utf8");
  } catch (e) { gitSame = null; }
  check("fixture engine3_pre_durability.js is src/engine3.js of the step-1 commit 9656818", gitSame !== false,
    gitSame === null ? "git not reachable, skipped" : "byte for byte");
  check("reference engines load (step 1: no durability API; pre-dynamics: durability API)", typeof E1.loadDurability !== "function" && typeof E2.loadDurability === "function",
    `versions ${E1.VERSION} / ${E2.VERSION}`);
}

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
for (const e of [E, E1, E2]) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
const DUR = readJSON("data/derived/durability.json");
const NORM = { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 };

// components merged after this step stay off; `keep` lists the ones a reference engine already has
function compOff(keep, extraOff) {
  const c = {};
  for (const k of Object.keys(FP.components || {})) if (k !== "v401" && !keep.includes(k)) c[k] = false;
  for (const k of extraOff) c[k] = false;
  return c;
}
const OFF1 = { components: compOff([], ["durability", "dynamics"]) };   // vs E1
const OFF2 = { components: compOff(["durability"], ["dynamics"]) };      // vs E2
check("default params: durability and dynamics on, dyn.stkoHurtGate off", FP.components.durability === true && FP.components.dynamics === true && FP.dyn.stkoHurtGate === false,
  JSON.stringify(FP.components));

// ------------------------------------------------------------------ matchup generators
const rng = E.makeRng(20261106 ^ 2);
const DB = JSON.parse(dbJson);
const slugs = Object.keys(DB.fighters).filter((s) => DB.fighters[s] && DB.fighters[s].n_fights >= 1).sort();
const DIVS = Object.keys(DB.priors).filter((d) => !["ALL", "Catch Weight", "Open Weight"].includes(d));
function pick(a) { return a[Math.floor(rng.u() * a.length)]; }
function randomCase(i) {
  const a = pick(slugs); let b = pick(slugs); while (b === a) b = pick(slugs);
  const fa = DB.fighters[a], div = rng.u() < 0.7 && fa.division && DB.priors[fa.division] ? fa.division : pick(DIVS);
  const rounds = rng.u() < 0.3 ? 5 : 3;
  const opts = { division: div, rounds, title: rounds === 5 && rng.u() < 0.6, date: "2026-11-06" };
  if (rng.u() < 0.25) { opts.adjA = { chin: 0.7 + rng.u(), pow: 0.7 + rng.u() }; opts.adjB = { out: 0.8 + 0.4 * rng.u(), chin: 0.7 + rng.u() }; }
  return { a, b, opts, seed: 3000 + i };
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
function runGroup(label, REF, refName, OFF, cases, ctx) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0, recs = 0;
  const go = () => {
    cases.forEach((c, i) => {
      const mr = REF.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, OFF));
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
    });
  };
  const engs = [REF, E];
  if (ctx.ml) engs.forEach((e) => e.loadMLRates(mlJson));
  if (ctx.roster) engs.forEach((e) => { if (typeof e.loadDurability === "function") e.loadDurability(DUR); });
  try { go(); } finally { engs.forEach((e) => { e.loadMLRates(null); if (typeof e.loadDurability === "function") e.loadDurability(null); }); }
  check(`${refName}, ${label}: identical fights (JSON incl. trace), summaries and explain()`, bad === 0 && badSum === 0,
    `${nM} matchups (${applied} with learned rates${recs ? ", " + recs + " with durability records" : ""}), ${nF} fights, ${nSum} summaries; ${bad} fight / ${badSum} summary mismatches${firstBad ? "; first " + firstBad : ""}`);
  return nM;
}

const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
const step = Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2))));
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % step === 3 % step).slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }

console.log(`engine ${E.VERSION} (params ${E.params().version}); ${NM} random matchups per group`);
for (const [REF, refName, OFF] of [[E1, "durability + dynamics off = step-1 engine", OFF1], [E2, "dynamics off = step-1 + durability engine", OFF2]]) {
  let total = 0;
  total += runGroup("a. random pairs, production learned rates, live durability roster", REF, refName, OFF, casesA, { ml: true, roster: true });
  total += runGroup("b. random pairs, plain tables (ml: false), no roster", REF, refName, OFF, casesB, { ml: false, roster: false });
  total += runGroup("c. 2019-2023 backtest fights x 2 corner orders, OOF learned rates, durability walk-forward records", REF, refName, OFF, casesC, { ml: false, roster: false });
  check(`${refName}: identity covers >= 300 random matchups incl. traced fights`, total >= 300, `${total} matchups`);
}

// the comparisons are not vacuous: each flag turned on changes fights against its reference engine
{
  const ON1 = { components: compOff(["durability"], ["dynamics"]) }, ON2 = { components: compOff(["durability", "dynamics"], []) };
  E.loadMLRates(mlJson); E1.loadMLRates(mlJson); E2.loadMLRates(mlJson);
  try {
    for (const [REF, nm, ON, k] of [[E1, "durability on (dynamics off) vs step 1", ON1, "durability"], [E2, "dynamics on vs step 1 + durability", ON2, "dynamics"]]) {
      let diff = 0, n = 0;
      casesA.slice(0, 30).concat(casesC.slice(0, 30)).forEach((c) => {
        const fr = fights(REF, REF.matchup(c.a, c.b, c.opts), c.seed), fc = fights(E, E.matchup(c.a, c.b, withParams(c.opts, ON)), c.seed);
        for (let q = 0; q < fr.length; q++) { n++; if (fr[q] !== fc[q]) diff++; }
      });
      check(`flag ${k} on changes fights (${nm})`, diff > 0.5 * n, `${diff} of ${n} fights differ`);
    }
  } finally { E.loadMLRates(null); E1.loadMLRates(null); E2.loadMLRates(null); }
}

// ------------------------------------------------------------------ 3. both on: API and trace format unchanged
{
  const vg = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" };
  E.loadMLRates(mlJson); E1.loadMLRates(mlJson);
  const m1 = E1.matchup("alexander-volkanovski", "justin-gaethje", vg), mc = E.matchup("alexander-volkanovski", "justin-gaethje", vg);
  E.loadMLRates(null); E1.loadMLRates(null);
  const missing = Object.keys(m1).filter((k) => !(k in mc));
  check("both on: the matchup object keeps every key of the step-1 engine (adds dur, dyn)", missing.length === 0 && mc.dur && mc.dyn, missing.length ? "missing " + missing.join(",") : Object.keys(mc).filter((k) => !(k in m1)).join(", ") + " added");
  // union of the keys each trace event kind carries, and the fight / round / stats / totals keys, over many traced fights
  function sig(eng, m, n) {
    const ev = {}, top = new Set(), rnd = new Set(), st = new Set(), tot = new Set();
    for (let s = 0; s < n; s++) {
      const f = eng.simulate(m, eng.makeRng(s), true);
      Object.keys(f).forEach((k) => { if (k !== "nDed") top.add(k); });
      Object.keys(f.totals.A).forEach((k) => tot.add(k));
      for (const r of f.rounds) {
        Object.keys(r).forEach((k) => rnd.add(k)); Object.keys(r.st).forEach((k) => st.add(k)); Object.keys(r.st.A).forEach((k) => st.add("A." + k));
        for (const e of r.ev || []) { ev[e.k] = ev[e.k] || new Set(); Object.keys(e).forEach((k) => ev[e.k].add(k)); }
      }
    }
    return { ev, top, rnd, st, tot };
  }
  const sa = sig(E1, m1, 1500), sb = sig(E, mc, 400);
  const sub = (x, y) => [...x].filter((k) => !y.has(k));
  const probs = [];
  for (const [nm, x, y] of [["fight", sb.top, sa.top], ["round", sb.rnd, sa.rnd], ["stats", sb.st, sa.st], ["totals", sb.tot, sa.tot]]) { const d = sub(x, y); if (d.length) probs.push(nm + " +" + d.join("/")); }
  for (const k in sb.ev) { if (!sa.ev[k]) probs.push("new event kind " + k); else { const d = sub(sb.ev[k], sa.ev[k]); if (d.length) probs.push(k + " +" + d.join("/")); } }
  const same = probs.length === 0, info = same ? "event kinds: " + Object.keys(sb.ev).sort().join(" ") : probs.join("; ");
  check("both on: no new fight, round, stats, totals or trace-event keys vs step 1 (400 traced VG fights vs 1,500)", same, info);
}

// ------------------------------------------------------------------ 4. dyn.arPhi / accArPhi valid range [0, 1): clipped, never NaN
{
  const vg = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06", ml: false };
  const bad = [], noNaN = (f) => !/null|NaN|Infinity/.test(JSON.stringify([f.winner, f.method, f.round, f.t, f.totals]));
  for (const [ap, aa] of [[1, 1], [1.5, -0.3], [-1, 2]]) {
    const m = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { dyn: { arPhi: ap, accArPhi: aa } } }, vg));
    for (let s = 0; s < 40; s++) { const f = E.simulate(m, E.makeRng(500 + s), s % 2 === 0); if (!noNaN(f)) { bad.push(ap + "/" + aa); break; } }
    if (!(m.dyn.arPhi >= 0 && m.dyn.arPhi < 1 && isFinite(m.dyn.arInn) && isFinite(m.dyn.accArInn))) bad.push("table " + ap + "/" + aa);
  }
  const m0 = E.matchup("alexander-volkanovski", "justin-gaethje", vg), m1 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { dyn: { arPhi: 0.85, accArPhi: 0.73 } } }, vg));
  const same = JSON.stringify(E.simulate(m0, E.makeRng(9), true)) === JSON.stringify(E.simulate(m1, E.makeRng(9), true));
  check("dyn.arPhi / accArPhi outside [0, 1) are clipped (finite tables and fights); the defaults pass through unchanged", bad.length === 0 && same,
    bad.length ? "bad: " + bad.join(", ") : "arPhi 1 / 1.5 / -1, accArPhi 1 / -0.3 / 2: finite");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
