#!/usr/bin/env node
/* v4_levels.js: train-only level matching for engine v4 with the learned rates on (moment matching on real fights, the
   same idea as tools/calibrate.js stage 1 for v3).

   Why: the self-calibration (tests/test_engine3.js --fit) sets the engine's league level on league-average pairs, and the
   learned-rate adapter re-targets each matchup at that level. On the real 2019-2023 backtest fights the result came out
   about 10% low on knockdowns per landed head strike, 2 points low on the submission share and with more 10-8 rounds
   than the judges' fit implies (the engine's rounds, with hurts, are more lopsided than ufcstats counts show). This
   dampened fixed point moves four levers on TRAIN fights only:
     kdScale      -> knockdowns per 100 landed head strikes (actual, both fighters)
     koAll        -> KO/TKO share of outcomes (kdInstant, kdRefStop on odds; stko, gnpTko multiplicative)
     subConvScale -> submission share of outcomes (odds)
     judge.t108   -> 10-8 share of judge-rounds in simulated decisions = 3.55% (2021-2023 judges' rounds, deductions
                     removed, judgerounds_rows.json; the era tools/judgecal.js fits the threshold to)
   Sample: up to --n train fights (fixed hash order), one corner order per fight by hash, --sims sims, common random
   numbers across iterations, out-of-fold learned rates (data/derived/mlrates_oof.json), walk-forward priors.

     node tools/v4_levels.js [--n 1000] [--sims 40] [--iters 3] [--workers 2] [--write]
   --write rewrites kdScale, kdInstant, kdRefStop, stko, gnpTko, subConvScale and judge.t108 in src/params3.js. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function trainFights() {
  const bt = readJSON("data/derived/backtest_dev.json"), keys = bt.meta.keys;
  const fs_ = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");
  for (const f of fs_) { f.A.keys = keys; f.B.keys = keys; }
  return fs_;
}

if (!isMainThread) {
  const E = require(path.join(ROOT, "src/engine3.js"));
  const fights = trainFights(), byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json"), OOF = readJSON("data/derived/mlrates_oof.json"), names = OOF.meta.targets;
  const rates = (a) => { const o = {}; names.forEach((n, i) => { o[n] = a[i]; }); return o; };
  parentPort.on("message", (msg) => {
    const acc = { n: 0, ko: 0, sub: 0, kd: 0, hl: 0, w108: 0, jr: 0 };
    for (const id of msg.ids) {
      const f = byId.get(id), swap = (mix(hash32(id), 0x51ed) & 1) === 1;
      const A = swap ? f.B : f.A, B = swap ? f.A : f.B, ent = OOF.fights[id];
      const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)], params: msg.over };
      opts.ml = ent ? { pred: swap ? { A: rates(ent.B), B: rates(ent.A) } : { A: rates(ent.A), B: rates(ent.B) } } : false;
      const m = E.matchup(A, B, opts), rng = E.makeRng(mix(hash32(id), 7));
      for (let i = 0; i < msg.sims; i++) {
        const s = E.simulate(m, rng, false), meth = s.method, dec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
        acc.n++;
        if (meth === "SUB") acc.sub++; else if (!dec) acc.ko++;
        acc.kd += s.totals.A.kd + s.totals.B.kd; acc.hl += s.totals.A.h_lnd + s.totals.B.h_lnd;
        if (dec) { acc.w108 += s.n108 || 0; acc.jr += 3 * f.rounds; }
      }
    }
    parentPort.postMessage(acc);
  });
  return;
}

const args = {}; process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith("--")) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true; });
const N = +(args.n || 1000), SIMS = +(args.sims || 40), ITERS = +(args.iters || 3), WORKERS = Math.min(3, +(args.workers || 2));
const P0 = require(path.join(ROOT, "src/params3.js"));
const fights = trainFights();
// targets: every train fight with an outcome (actual base rates), 10-8 from the judges' rounds
let n = 0, ko = 0, sub = 0, kd = 0, hl = 0;
for (const f of fights) {
  const m = f.result && f.result.method;
  if (["KO", "DOC", "SUB", "UD", "SD", "MD", "DRAW"].includes(m)) { n++; if (m === "SUB") sub++; else if (m === "KO" || m === "DOC") ko++; }
  if (f.actual && f.actual.A && f.actual.B) { kd += f.actual.A.kd + f.actual.B.kd; hl += f.actual.A.h_lnd + f.actual.B.h_lnd; }
}
const jc = readJSON("data/derived/judgecal.json");
const T = { ko: ko / n, sub: sub / n, kd100: 100 * kd / hl, r108: jc.checks.data.late.r108 };
const sample = fights.slice().sort((a, b) => hash32(a.id) - hash32(b.id)).slice(0, N).map((f) => f.id);
console.log(`targets (train): KO ${(100 * T.ko).toFixed(1)}%, SUB ${(100 * T.sub).toFixed(1)}%, KD/100 head ${T.kd100.toFixed(3)}, 10-8 ${(100 * T.r108).toFixed(2)}% ` +
  `| sample ${sample.length} fights x ${SIMS} sims, ${WORKERS} workers`);
const workers = []; for (let k = 0; k < WORKERS; k++) workers.push(new Worker(__filename));
function run(over) {
  return Promise.all(workers.map((w, k) => new Promise((res) => {
    w.once("message", res); w.postMessage({ ids: sample.filter((_, i) => i % WORKERS === k), sims: SIMS, over });
  }))).then((parts) => parts.reduce((a, b) => { for (const q in b) a[q] = (a[q] || 0) + b[q]; return a; }, {}));
}
const odds = (p) => p / (1 - p), prob = (o) => o / (1 + o), oddsR = (t, s) => odds(t) / odds(s);
const g = { kdScale: P0.kdScale, koAll: 1, subConvScale: P0.subConvScale, t108: P0.judge.t108 };
const over = () => ({ kdScale: g.kdScale, kdInstant: prob(odds(P0.kdInstant) * g.koAll), kdRefStop: prob(odds(P0.kdRefStop) * g.koAll),
  stko: P0.stko * g.koAll, gnpTko: P0.gnpTko * g.koAll, subConvScale: g.subConvScale, judge: { t108: g.t108 } });
(async () => {
  const t0 = Date.now();
  let S = null;
  for (let it = 0; it <= ITERS; it++) {
    const a = await run(over());
    S = { ko: a.ko / a.n, sub: a.sub / a.n, kd100: 100 * a.kd / a.hl, r108: a.w108 / a.jr };
    console.log(`it ${it}: KO ${(100 * S.ko).toFixed(1)} SUB ${(100 * S.sub).toFixed(1)} KD/100 ${S.kd100.toFixed(3)} 10-8 ${(100 * S.r108).toFixed(2)}  ` +
      `| kdScale ${g.kdScale.toFixed(4)} koAll ${g.koAll.toFixed(4)} subConvScale ${g.subConvScale.toFixed(4)} t108 ${g.t108.toFixed(3)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
    if (it === ITERS) break;
    const rk = Math.pow(T.kd100 / S.kd100, 0.9);
    g.kdScale *= rk;
    // KO share rises with the knockdown rate: aim the conversion at the target given the knockdown change
    g.koAll *= Math.pow(oddsR(T.ko, Math.min(0.95, S.ko * Math.pow(rk, 0.6))), 0.8);
    g.subConvScale *= Math.pow(oddsR(T.sub, S.sub), 0.9);
    g.t108 *= Math.pow(S.r108 / T.r108, 0.35);
  }
  for (const w of workers) w.terminate();
  const o = over();
  const out = { kdScale: o.kdScale, kdInstant: o.kdInstant, kdRefStop: o.kdRefStop, stko: o.stko, gnpTko: o.gnpTko, subConvScale: o.subConvScale, t108: g.t108 };
  console.log("values:", JSON.stringify(out));
  fs.writeFileSync(path.join(ROOT, "data/derived/v4_levels.json"), JSON.stringify({ meta: { tool: "tools/v4_levels.js", built: new Date().toISOString(),
    sample: sample.length, sims: SIMS, iters: ITERS, split: "train 2019-2023" }, targets: T, last: S, values: out }, null, 1));
  if (args.write) {
    let src = fs.readFileSync(path.join(ROOT, "src/params3.js"), "utf8");
    for (const [k, v] of Object.entries(out)) {
      const re = new RegExp("^(\\s*)" + k + ":\\s*[-0-9.eE]+(,?)(\\s*//)", "m");
      if (!re.test(src)) throw new Error("v4_levels: no entry " + k);
      src = src.replace(re, (all, ind, comma, cm) => `${ind}${k}: ${+(+v).toPrecision(4)}${comma}${cm}`);
    }
    fs.writeFileSync(path.join(ROOT, "src/params3.js"), src);
    console.log("rewrote src/params3.js");
  }
})();
