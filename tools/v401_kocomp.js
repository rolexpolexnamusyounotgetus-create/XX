#!/usr/bin/env node
/* v401_kocomp.js: factors for engine v5 components.v401.koTargets (v5 merge step 1, item e).

   The self-calibration (tests/test_engine3.js --fit) aims the KO/TKO composition of league-average Lightweight pairs at three
   shares of strike KO/TKOs: ground finishes (lever gnpTko), clinch finishes (kdPos[1]) and standing stoppages without a
   knockdown (stko), while kdScale holds knockdowns per landed head strike and kdInstant / kdRefStop (odds) the KD-to-finish
   rate. v4's targets (28% / 12.5% / 7%) came from the all-years base-rate table; tools/ko_composition.py re-derives them
   from 2019-2023 fights (data/derived/ko_composition_pre2024.json). Re-running the whole self-calibration would refit every
   [selfcal] value with fresh Monte Carlo noise, and tools/v4_levels.js has re-levelled the KO block on real fights since.
   So this tool fits only the six KO-block levers, twice from the engine's current values with common random numbers:
   fit A aims at v4's targets, fit B at the 2019-2023 ones, both holding KD per 100 head landed and KD-to-finish at the
   engine's own current level (measured once at the start). factor = B / A (kdInstant, kdRefStop: odds ratio), i.e. the
   change the new targets alone make; params.v401.koComp stores it and the engine applies it with the sub-flag on.

   Train-only: league-average pairs built from data/derived/priors_dev.json (fights before 2024-01-01), learned rates off,
   no fight outcome enters. Runs with components.v401.koTargets off (the factors themselves are not applied while fitting).

     node tools/v401_kocomp.js [--n 30000] [--iters 10] [--avg 4] [--write]
   --write rewrites the koComp line of src/params3.js. Output: data/derived/v401_kocomp.json. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = +opt("--n", 30000), ITERS = +opt("--iters", 10), AVG = +opt("--avg", 4), WRITE = args.includes("--write");
const E = require(path.join(ROOT, "src/engine3.js"));
const BASE = require(path.join(ROOT, "src/params3.js"));
const comp = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/ko_composition_pre2024.json"), "utf8"));
const PRI = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/priors_dev.json"), "utf8")).priors;
const DIV = "Lightweight";
const TG_OLD = { ground: 0.28, clinch: 0.125, standNoKd: 0.07 };
const TG_NEW = comp.targets;
if (BASE.v401 && BASE.v401.koTargets) {
  const k = BASE.v401.koTargets;
  if (Math.abs(k.ground - TG_NEW.ground) > 1e-9 || Math.abs(k.clinch - TG_NEW.clinch) > 1e-9 || Math.abs(k.standNoKd - TG_NEW.standNoKd) > 1e-9)
    console.log("note: params3.js v401.koTargets differ from data/derived/ko_composition_pre2024.json; using the JSON");
}

function avgProfile(tag) {
  const P = PRI[DIV], S = {};
  for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;
  return { name: `${tag} ${DIV}`, division: DIV, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}
const PA = avgProfile("A"), PB = avgProfile("B");
const OFF_E = { components: { v401: { koTargets: false } } };
const eff = E.resolveParams(OFF_E);
const g0 = { kdScale: eff.kdScale, kdInstant: eff.kdInstant, kdRefStop: eff.kdRefStop, gnpTko: eff.gnpTko, kdClinch: eff.kdPos[1], stko: eff.stko };
const dmp = (x, e) => Math.pow(x, e === undefined ? 0.8 : e);
const oddsR = (t, s) => (t / (1 - t)) / (s / (1 - s));
function over(g) {
  return { components: { v401: { koTargets: false } }, kdScale: g.kdScale, kdInstant: g.kdInstant, kdRefStop: g.kdRefStop, gnpTko: g.gnpTko,
    stko: g.stko, kdPos: [eff.kdPos[0], g.kdClinch] };
}
function sim(params, n, seed) {
  // v5 durability component (on by default): league-average pairs run it in relative mode (the priors' own division level),
  // as tests/test_engine3.js simAvg does; no effect with the component off
  params = Object.assign({}, params, { durability: Object.assign({}, params && params.durability, { level: null }) });
  const m = E.matchup(PA, PB, { division: DIV, rounds: 3, title: false, params, priors: PRI, ml: false });
  const s = E.summarize(m, n, seed), a = s.avg.A, b = s.avg.B;
  const kk = s.koKind, kt = Math.max(1, kk.KO + kk.TKO_followup + kk.TKO_standing + kk.GNP + kk.LEG);
  const kl = s.koLoc, klt = Math.max(1, kl.dist + kl.clinch + kl.ground);
  const ko = s.finKO.reduce((x, y) => x + y, 0);
  return { kd100: 100 * (a.kd + b.kd) / (a.h_lnd + b.h_lnd), kdFin: s.kdFin, gShare: kl.ground / klt, cShare: kl.clinch / klt,
    stShare: kk.TKO_standing / kt, ko, fin: s.fins };
}
const fmt = (S) => `KO ${(100 * S.ko).toFixed(2)}% kd100 ${S.kd100.toFixed(4)} kdFin ${(100 * S.kdFin).toFixed(2)}% ground ${(100 * S.gShare).toFixed(2)}% ` +
  `clinch ${(100 * S.cShare).toFixed(2)}% standNoKd ${(100 * S.stShare).toFixed(2)}%`;

const t0 = Date.now();
console.log(`engine ${E.VERSION}, params ${BASE.version}; ${DIV} league-average pairs (priors_dev), 3 rounds, ${N} fights per iteration, ${ITERS} iterations, average of the last ${AVG}`);
console.log("start (v401 koTargets off):", JSON.stringify(g0));
const S0 = sim(over(g0), 2 * N, 9001);
console.log("start level (held):", fmt(S0));
function fit(TG, label) {
  const g = Object.assign({}, g0), hist = [];
  let S = null;
  for (let it = 0; it < ITERS; it++) {
    S = sim(over(g), N, 1000 + it);                       // common random numbers: the same seeds for both target sets
    console.log(`${label} it ${it}: ${fmt(S)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    g.kdScale *= dmp(S0.kd100 / S.kd100);
    const kf = dmp(oddsR(S0.kdFin, S.kdFin), 1.0);
    g.kdInstant = E.prob(E.odds(g.kdInstant) * kf); g.kdRefStop = E.prob(E.odds(g.kdRefStop) * kf);
    g.gnpTko *= dmp(oddsR(TG.ground, Math.max(0.005, S.gShare)), 0.9);
    g.kdClinch *= dmp(oddsR(TG.clinch, Math.max(0.005, S.cShare)), 0.8);
    g.stko *= dmp(oddsR(TG.standNoKd, Math.max(0.003, S.stShare)), 0.8);
    hist.push(Object.assign({}, g));
  }
  // Polyak average of the last AVG iterates (log scale; odds scale for the two probabilities)
  const tail = hist.slice(-AVG), out = {};
  for (const k of Object.keys(g0)) {
    const prob = k === "kdInstant" || k === "kdRefStop";
    const mean = tail.reduce((acc, x) => acc + Math.log(prob ? E.odds(x[k]) : x[k]), 0) / tail.length;
    out[k] = prob ? E.prob(Math.exp(mean)) : Math.exp(mean);
  }
  return { g: out, last: S };
}
const A = fit(TG_OLD, "A (v4 targets 28/12.5/7)");
const B = fit(TG_NEW, `B (2019-2023 targets ${(100 * TG_NEW.ground).toFixed(1)}/${(100 * TG_NEW.clinch).toFixed(1)}/${(100 * TG_NEW.standNoKd).toFixed(1)})`);
const r4 = (x) => +x.toPrecision(4);
const F = {
  kdScale: r4(B.g.kdScale / A.g.kdScale), kdClinch: r4(B.g.kdClinch / A.g.kdClinch), gnpTko: r4(B.g.gnpTko / A.g.gnpTko), stko: r4(B.g.stko / A.g.stko),
  kdInstant: r4(E.odds(B.g.kdInstant) / E.odds(A.g.kdInstant)), kdRefStop: r4(E.odds(B.g.kdRefStop) / E.odds(A.g.kdRefStop))
};
console.log("fit A:", JSON.stringify(A.g));
console.log("fit B:", JSON.stringify(B.g));
console.log("factors (B / A):", JSON.stringify(F));
// check with fresh seeds: the engine with the factors applied (sub-flag on) vs off, same seeds
const chkOff = sim({ components: { v401: { koTargets: false } } }, 2 * N, 77001);
const ON = { components: { v401: { koTargets: true } } };
const savedKC = BASE.v401 && BASE.v401.koComp;
if (!BASE.v401) BASE.v401 = {};
BASE.v401.koComp = F;                                       // in-process only, for the check
const chkOn = sim(ON, 2 * N, 77001);
BASE.v401.koComp = savedKC;
console.log("check (fresh seeds, league-average LW): sub-flag off:", fmt(chkOff));
console.log("                                        sub-flag on: ", fmt(chkOn));
const res = { meta: { tool: "tools/v401_kocomp.js", built: new Date().toISOString(), engine: E.VERSION, params: BASE.version, division: DIV, rounds: 3,
  n_per_iter: N, iters: ITERS, avg_last: AVG, priors: "data/derived/priors_dev.json (fights before 2024-01-01)", learned_rates: false,
  targets_old: TG_OLD, targets_new: TG_NEW, targets_source: "data/derived/ko_composition_pre2024.json (tools/ko_composition.py, 2019-2023 fights)" },
  start: g0, held_level: S0, fitA: A, fitB: B, factors: F, check: { off: chkOff, on: chkOn }, seconds: (Date.now() - t0) / 1000 };
fs.writeFileSync(path.join(ROOT, "data/derived/v401_kocomp.json"), JSON.stringify(res, null, 1));
console.log("wrote data/derived/v401_kocomp.json");
if (WRITE) {
  const pf = path.join(ROOT, "src/params3.js");
  let src = fs.readFileSync(pf, "utf8");
  const re = /^(\s*)koComp: \{[^}\n]*\}/m;
  if (!re.test(src)) throw new Error("v401_kocomp: no koComp line in params3.js");
  src = src.replace(re, (all, ind) => `${ind}koComp: { kdScale: ${F.kdScale}, kdClinch: ${F.kdClinch}, gnpTko: ${F.gnpTko}, stko: ${F.stko}, kdInstant: ${F.kdInstant}, kdRefStop: ${F.kdRefStop} }`);
  fs.writeFileSync(pf, src);
  console.log("rewrote the koComp line of src/params3.js");
}
