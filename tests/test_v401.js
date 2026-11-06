#!/usr/bin/env node
/* test_v401.js: engine v5 merge step 1 (params.components.v401, v4.0.1's train-only fixes), flag-off identity and port checks.

   1. Flag-off identity: with components.v401 off (false, or every sub-flag false) the current src/ engine reproduces the
      engine before this step, versions/v4/ (v4.0.0; sha256 recorded in data/derived/version_history.json), bit for bit:
      whole fight objects (JSON, including the per-round trace) for fixed seeds, traced and untraced, and summarize()
      output, over random matchups:
        a. random fighter pairs from data/derived/fighters.json with the production learned rates loaded (the page path),
        b. random pairs with opts.ml === false (the plain tables),
        c. 2019-2023 backtest fights (data/derived/backtest_dev.json, train years only) in both corner orders with the
           out-of-fold learned rates and the as-of priors (the tools/evalv.js path).
   2. Port fidelity: with every sub-flag on except koTargets (item e, new in v5) the engine reproduces the rejected v4.0.1
      (versions/v4.0.1-rejected/), whose fixes it ports; fights compared up to v4.0.1's always-present nDed: 0.
   3. Each sub-flag alone changes something (none is dead), and the judging-only sub-flags (emJudge, deductions) leave
      every fight unchanged up to the cards.
     node tests/test_v401.js [matchups per random group, default 150]   (about a minute) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const E4 = require(path.join(ROOT, "versions/v4/engine3.js"));
const E41 = require(path.join(ROOT, "versions/v4.0.1-rejected/engine3.js"));
const NM = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 150);

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const sha256 = (p) => require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, p))).digest("hex");

// the base this step was built on: versions/v4 is v4.0.0 (hashes as recorded in the version history)
{
  const vh = readJSON("data/derived/version_history.json");
  const list = Array.isArray(vh) ? vh : (vh.versions || []);
  const v4 = list.find((e) => e && e.version === "v4");
  check("versions/v4 is v4.0.0 by sha256 (data/derived/version_history.json)", !!v4 && sha256("versions/v4/engine3.js") === v4.engine_sha256 &&
    sha256("versions/v4/params3.js") === v4.params_sha256 && E4.VERSION === "4.0.0", E4.VERSION);
}

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
for (const e of [E, E4, E41]) e.loadDB(dbJson);
const mlJson = readJSON("data/derived/mlrates.json");
function withML(eng, fn) { eng.loadMLRates(mlJson); try { return fn(); } finally { eng.loadMLRates(null); } }

// v5 merge: the components merged after step 1 (durability, dynamics, ...) stay off in every comparison of this file, so
// it keeps testing step 1 against its own base whatever later steps add (each later step has its own identity test)
const LATER_OFF = {};
for (const k of Object.keys(E.params().components || {})) if (k !== "v401") LATER_OFF[k] = false;
const comp = (v401) => ({ components: Object.assign({}, LATER_OFF, { v401 }) });
const OFFS = [comp(false), comp({ emJudge: false, deductions: false, mlLevels: false, tdCap: false, koTargets: false })];
const SUBS = ["emJudge", "deductions", "mlLevels", "tdCap", "koTargets"];
const only = (s) => { const o = {}; for (const k of SUBS) o[k] = k === s; return comp(o); };

// ------------------------------------------------------------------ matchup generators
const rng = E.makeRng(20261106);
const DB = JSON.parse(dbJson);
const slugs = Object.keys(DB.fighters).filter((s) => DB.fighters[s] && DB.fighters[s].n_fights >= 1).sort();
const DIVS = Object.keys(DB.priors).filter((d) => !["ALL", "Catch Weight", "Open Weight"].includes(d));
function pick(a) { return a[Math.floor(rng.u() * a.length)]; }
function randomCase(i) {
  const a = pick(slugs); let b = pick(slugs); while (b === a) b = pick(slugs);
  const fa = DB.fighters[a], div = rng.u() < 0.7 && fa.division && DB.priors[fa.division] ? fa.division : pick(DIVS);
  const rounds = rng.u() < 0.3 ? 5 : 3;
  return { a, b, opts: { division: div, rounds, title: rounds === 5 && rng.u() < 0.6, date: "2026-11-06" }, seed: 1000 + i };
}
const bt = readJSON("data/derived/backtest_dev.json");
const train = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");   // train years only (hidden-data protocol)
for (const f of train) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
const OOF = readJSON("data/derived/mlrates_oof.json"), TN = OOF.meta.targets;
const priorsAsof = readJSON("data/derived/mlcal_priors_asof.json");
const rates = (arr) => { const o = {}; TN.forEach((n, k) => { o[n] = arr[k]; }); return o; };
function btCase(f, o) {
  const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A, ent = OOF.fights[f.id];
  const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priorsAsof[f.date.slice(0, 4)] };
  opts.ml = ent && ent.A && ent.B ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false;
  return { a: A, b: B, opts, seed: (parseInt(f.id.slice(0, 8), 16) ^ (o * 0x9e3779b1)) >>> 0 };
}

// ------------------------------------------------------------------ fight comparison
const SEEDS = 6;   // fights per matchup: seeds 0..5, odd ones traced
function fights(eng, m, seed) {
  const out = [];
  for (let k = 0; k < SEEDS; k++) out.push(JSON.stringify(eng.simulate(m, eng.makeRng(seed * 31 + k), k % 2 === 1)));
  // a shared stream too (trace parity across fights)
  const r = eng.makeRng(seed + 7); for (let k = 0; k < 4; k++) out.push(JSON.stringify(eng.simulate(m, r, k % 2 === 0)));
  return out;
}
const norm41 = (s) => { const o = JSON.parse(s); if (!o.nDed) delete o.nDed; return JSON.stringify(o, Object.keys(o).sort()); };
function withParams(opts, params) { const o = Object.assign({}, opts); o.params = Object.assign({}, opts.params || {}, params); return o; }

function runGroup(label, cases, useML) {
  let nM = 0, nF = 0, bad = 0, badSum = 0, nSum = 0, firstBad = null, applied = 0;
  const go = () => {
    cases.forEach((c, i) => {
      const off = OFFS[i % 2];
      const m4 = E4.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, off));
      if (m4.mlApplied) applied++;
      const f4 = fights(E4, m4, c.seed), fc = fights(E, mc, c.seed);
      nM++; nF += f4.length;
      for (let k = 0; k < f4.length; k++) if (f4[k] !== fc[k]) { bad++; if (!firstBad) firstBad = `${label} case ${i} fight ${k}`; }
      if (i % 10 === 0) {
        nSum++;
        const s4 = E4.summarize(m4, 150, c.seed), sc = E.summarize(mc, 150, c.seed);
        if (JSON.stringify(s4) !== JSON.stringify(sc)) { badSum++; if (!firstBad) firstBad = `${label} summary ${i}`; }
      }
    });
  };
  if (useML) { E4.loadMLRates(mlJson); E.loadMLRates(mlJson); try { go(); } finally { E4.loadMLRates(null); E.loadMLRates(null); } } else go();
  check(`flag off = v4.0.0, ${label}: identical fights (JSON incl. trace) and summaries`, bad === 0 && badSum === 0,
    `${nM} matchups (${applied} with learned rates), ${nF} fights, ${nSum} summaries; ${bad} fight / ${badSum} summary mismatches${firstBad ? "; first " + firstBad : ""}`);
  return nM;
}

console.log(`engine ${E.VERSION} (params ${E.params().version}) vs v4.0.0 (versions/v4) and v4.0.1 (versions/v4.0.1-rejected); ${NM} random matchups per group`);
let total = 0;
const casesA = [], casesB = [];
for (let i = 0; i < NM; i++) casesA.push(randomCase(i));
for (let i = 0; i < NM; i++) { const c = randomCase(NM + i); c.opts.ml = false; casesB.push(c); }
total += runGroup("a. random pairs, production learned rates", casesA, true);
total += runGroup("b. random pairs, plain tables (ml: false)", casesB, false);
const trainSample = train.slice().sort((x, y) => (x.id < y.id ? -1 : 1)).filter((_, i) => i % Math.max(1, Math.floor(train.length / Math.max(1, Math.round(NM / 2)))) === 0)
  .slice(0, Math.round(NM / 2));
const casesC = []; for (const f of trainSample) { casesC.push(btCase(f, 0)); casesC.push(btCase(f, 1)); }
total += runGroup("c. 2019-2023 backtest fights x 2 corner orders, out-of-fold learned rates", casesC, false);
check("identity covers >= 300 random matchups incl. traced fights", total >= 300, `${total} matchups`);

// ------------------------------------------------------------------ 2. port fidelity vs v4.0.1
{
  const ON = comp({ emJudge: true, deductions: true, mlLevels: true, tdCap: true, koTargets: false });
  let bad = 0, n = 0, nM = 0, firstBad = null;
  const cs = casesA.slice(0, 50).concat(casesC.slice(0, 50));
  E41.loadMLRates(mlJson); E.loadMLRates(mlJson);
  try {
    cs.forEach((c, i) => {
      const m41 = E41.matchup(c.a, c.b, c.opts), mc = E.matchup(c.a, c.b, withParams(c.opts, ON));
      const f41 = fights(E41, m41, c.seed), fc = fights(E, mc, c.seed); nM++;
      for (let k = 0; k < f41.length; k++) { n++; if (norm41(f41[k]) !== norm41(fc[k])) { bad++; if (!firstBad) firstBad = `case ${i} fight ${k}`; } }
    });
  } finally { E41.loadMLRates(null); E.loadMLRates(null); }
  check("sub-flags a-d on, koTargets off = v4.0.1 (the port is faithful)", bad === 0, `${nM} matchups, ${n} fights, ${bad} mismatches${firstBad ? "; first " + firstBad : ""}`);
}

// ------------------------------------------------------------------ 3. every sub-flag does something; judging-only ones keep the fight
{
  const cs = casesA.slice(0, 40);
  E.loadMLRates(mlJson);
  try {
    for (const s of SUBS) {
      let diff = 0, n = 0, preCards = true;
      // tdCap only binds when a learned multiplier passes the cap: give it extreme takedown rates
      const cases = s !== "tdCap" ? cs : cs.slice(0, 10).map((c) => {
        const pr = E.matchup(c.a, c.b, c.opts).mlPred;
        if (!pr) return c;
        const A = Object.assign({}, pr.A, { td_att: pr.A.td_att * 40, td_acc: 0.97 }), B = Object.assign({}, pr.B, { td_att: pr.B.td_att / 40, td_acc: 0.01 });
        return Object.assign({}, c, { opts: Object.assign({}, c.opts, { ml: { pred: { A, B } } }) });
      });
      cases.forEach((c) => {
        const m0 = E.matchup(c.a, c.b, withParams(c.opts, OFFS[0])), m1 = E.matchup(c.a, c.b, withParams(c.opts, only(s)));
        for (let k = 0; k < 8; k++) {
          const a = E.simulate(m0, E.makeRng(c.seed * 13 + k), false), b = E.simulate(m1, E.makeRng(c.seed * 13 + k), false);
          n++;
          const ja = norm41(JSON.stringify(a)), jb = norm41(JSON.stringify(b));   // a zero nDed field alone is not a change
          if (ja !== jb) diff++;
          if (JSON.stringify(a.totals) !== JSON.stringify(b.totals) || a.round !== b.round || a.t !== b.t ||
              (!E.isDecision(a) && (a.method !== b.method || a.winner !== b.winner))) preCards = false;
        }
      });
      check(`sub-flag ${s} alone changes fights`, diff > 0, `${diff} of ${n} fights differ from v4.0.0`);
      if (s === "emJudge" || s === "deductions") check(`sub-flag ${s} alone leaves every fight unchanged up to the cards`, preCards);
    }
  } finally { E.loadMLRates(null); }
  const fl = E.v401Flags(E.params());
  check("default params: all five v401 sub-flags on (until the Calibrate stage decides)", SUBS.every((s) => fl[s]), JSON.stringify(fl));
  const p = E.resolveParams(comp(false)), P4 = require(path.join(ROOT, "versions/v4/params3.js"));
  const keys = ["kdScale", "kdInstant", "kdRefStop", "stko", "gnpTko", "subConvScale", "kdPos"], jk = ["head", "body", "leg", "kd", "td", "ctrlMin", "sub", "sharedSd", "sharedFight", "indSd", "t108", "t108kd", "hurt", "power", "tasteSd"];
  check("v401 off resolves to v4.0.0's parameter values (judge, KO block, levels)", keys.every((k) => JSON.stringify(p[k]) === JSON.stringify(P4[k])) &&
    jk.every((k) => p.judge[k] === P4.judge[k]) && !(p.judge.ded > 0) && (p.mlTdLevel || 1) === 1 && (p.mlCtrlLevel || 1) === 1 && (p.mlSubLevel || 1) === 1);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
