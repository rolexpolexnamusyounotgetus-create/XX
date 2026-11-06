#!/usr/bin/env node
/* statlines_engine.js: the engine's REALISED per-fight stat-line distributions, scored against the actual lines
   (task key: statlines; companion of tools/statlines.py, which reads the output).

     nice -n 5 node tools/statlines_engine.js --actuals <actuals.json> --out <out.json> [--engine-dir versions/v4]
                                             [--sims 200] [--workers 2] [--seed 7] [--from 2019-01-01] [--until 2026-01-01]

   Runs a FROZEN engine (default versions/v4: engine3.js + params3.js, learned rates through opts.ml exactly as
   tools/evalv.js does) on data/derived/backtest_dev.json fights (every fight dated 2026-01-01 or later is dropped on
   load). Each fight is simulated in both corner orders (--sims per order, common random numbers keyed by fight id,
   order and seed) and mapped back to the data's orientation. Learned rates come from data/derived/mlrates_oof.json
   (2019-2023: time-ordered folds trained on 2010..year-1; 2024-2025: the dev model trained 2010-2023), so nothing a
   fight's own year produced reaches its simulation.

   Per fight, side and stat it writes the simulated mean and variance, the randomized PIT of the actual value
   (u = F(y-) + v * (F(y) - F(y-)), v uniform from a fixed per-fight seed), the sample CRPS (fair estimator), the naive
   inclusive 10-90% band hit, and the rate-based conditional mean at the actual length (sum of simulated totals / sum
   of simulated minutes x actual minutes). When the actual fight went the distance it repeats the PIT / CRPS / band /
   mean using only the simulations that went the distance (a clean "given t = scheduled length" comparison).
   No version history is touched; this is a descriptive reference for tools/statlines.py, not a version look. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const VAULT_FROM = "2026-01-01";
const STATS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att",
  "c_lnd", "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"];
const NS = STATS.length;

function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
function readJSON(p) { return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8")); }
function loadBacktest() {
  const bt = readJSON("data/derived/backtest_dev.json");
  const keys = bt.meta.keys;
  const fights = bt.fights.filter((f) => f.date < VAULT_FROM);         // hidden-data protocol: never a 2026 fight
  for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
  return fights;
}
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// sample metrics of actual y against simulated values xs (unsorted array)
function sampleMetrics(xs, y, v) {
  const n = xs.length;
  const s = Float64Array.from(xs).sort();
  let below = 0, at = 0, sum = 0, sum2 = 0, absy = 0;
  for (let i = 0; i < n; i++) { const x = s[i]; if (x < y - 1e-9) below++; else if (x <= y + 1e-9) at++; sum += x; sum2 += x * x; absy += Math.abs(x - y); }
  const pit = (below + v * at) / n;
  // fair CRPS: E|X - y| - E|X - X'| / 2 with the n(n-1) pair count; sum_{i<j} |x_j - x_i| = sum_i (2i - n + 1) x_(i), 0-based
  let pair = 0;
  for (let i = 0; i < n; i++) pair += (2 * i - n + 1) * s[i];
  const crps = absy / n - pair / (n * (n - 1));
  const q = (p) => { const h = (n - 1) * p, lo = Math.floor(h), hi = Math.min(n - 1, lo + 1); return s[lo] + (h - lo) * (s[hi] - s[lo]); };
  const q10 = q(0.1), q90 = q(0.9);
  const mean = sum / n;
  return [+mean.toFixed(4), +(sum2 / n - mean * mean).toFixed(4), +pit.toFixed(5), +crps.toFixed(4), (y >= q10 - 1e-9 && y <= q90 + 1e-9) ? 1 : 0];
}

if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(W.engineDir, "engine3.js"));
  const fights = loadBacktest();
  const byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON("data/derived/mlrates_oof.json");
  const ACT = readJSON(W.actuals);
  const names = OOF.meta.targets;
  const rates = (arr) => { const o = {}; names.forEach((nm, i) => { o[nm] = arr[i]; }); return o; };
  parentPort.on("message", (msg) => {
    if (msg.cmd !== "run") return;
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id), act = ACT[id];
      const R = f.rounds === 5 ? 5 : 3;
      const sims = [];   // [minutes, dec, A stats..., B stats...]
      let err = null, mlApplied = 0;
      try {
        for (let o = 0; o < 2; o++) {
          const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A;
          const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
          const ent = OOF.fights[f.id];
          if (ent && ent.A && ent.B) opts.ml = { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } };
          else opts.ml = false;
          const m = E.matchup(A, B, opts);
          if (m.mlApplied) mlApplied++;
          const rng = E.makeRng(mix(mix(hash32(f.id), o), W.seed));
          for (let i = 0; i < W.sims; i++) {
            const s = E.simulate(m, rng, false);
            const meth = s.method, isDec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
            const mins = isDec ? R * 5 : (s.round - 1) * 5 + s.t / 60;
            const TA = o === 0 ? s.totals.A : s.totals.B, TB = o === 0 ? s.totals.B : s.totals.A;
            const row = new Float64Array(2 + 2 * NS);
            row[0] = mins; row[1] = isDec ? 1 : 0;
            for (let k = 0; k < NS; k++) { row[2 + k] = +TA[STATS[k]] || 0; row[2 + NS + k] = +TB[STATS[k]] || 0; }
            sims.push(row);
          }
        }
      } catch (e) { err = String(e && e.message || e); }
      const rec = { id, n: sims.length, err, mlApplied };
      if (!err && act) {
        const tAct = act.minutes, wentDist = tAct >= 5 * R - 1 / 60;
        const dec = sims.filter((r) => r[1] === 1);
        let minsSum = 0; for (const r of sims) minsSum += r[0];
        rec.mins = +(minsSum / sims.length).toFixed(4);
        rec.pdec = +(dec.length / sims.length).toFixed(4);
        rec.t = tAct;
        const u = mulberry(mix(hash32(id), 99));
        for (let sd = 0; sd < 2; sd++) {
          const tag = sd === 0 ? "A" : "B", o = {};
          for (let k = 0; k < NS; k++) {
            const col = 2 + sd * NS + k, y = act[tag][STATS[k]];
            const xs = sims.map((r) => r[col]);
            const v = u();
            let tot = 0; for (const x of xs) tot += x;
            const m = sampleMetrics(xs, y, v);
            m.push(+(tot / minsSum * tAct).toFixed(4));           // rate-based conditional mean at the actual length
            if (wentDist && dec.length >= 40) {
              const md = sampleMetrics(dec.map((r) => r[col]), y, v);
              m.push(md[0], md[1], md[2], md[3], md[4]);
            }
            o[STATS[k]] = m;
          }
          rec[tag] = o;
        }
        rec.ndec = dec.length;
      }
      out.push(rec);
    }
    parentPort.postMessage({ cmd: "done", out, version: E.VERSION, params: E.params().version });
  });
  return;
}

function parseArgs(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2), v = argv[i + 1];
    if (v == null || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; }
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const ENGINE_DIR = path.resolve(ROOT, args["engine-dir"] || "versions/v4");
const SIMS = +(args.sims || 200), WORKERS = Math.max(1, Math.min(2, +(args.workers || 2))), SEED = +(args.seed || 7);
const FROM = args.from || "2019-01-01", UNTIL = args.until || VAULT_FROM;
if (!args.actuals || !args.out) { console.error("statlines_engine: --actuals and --out are required"); process.exit(2); }
if (UNTIL > VAULT_FROM) { console.error("statlines_engine: --until may not pass " + VAULT_FROM); process.exit(2); }
const ACT = readJSON(args.actuals);
const fights = loadBacktest().filter((f) => f.date >= FROM && f.date < UNTIL && ACT[f.id]);
const E0 = require(path.join(ENGINE_DIR, "engine3.js"));
console.log(`statlines_engine: ${ENGINE_DIR} (engine ${E0.VERSION}, params ${E0.params().version}), ${fights.length} fights ` +
  `${FROM}..${UNTIL} x 2 orders x ${SIMS} sims, ${WORKERS} workers`);
const ids = fights.map((f) => f.id), chunks = [];
for (let i = 0; i < ids.length; i += 25) chunks.push(ids.slice(i, i + 25));
const res = [];
let next = 0, live = 0, done = 0, ver = null;
const t0 = Date.now();
function finish() {
  const doc = { meta: { tool: "tools/statlines_engine.js", engine_dir: path.relative(ROOT, ENGINE_DIR), engine_version: ver && ver[0],
    params_version: ver && ver[1], sims_per_order: SIMS, seed: SEED, from: FROM, until: UNTIL, stats: STATS,
    fields: "per stat: [mean, var, pit, crps, in80_naive, cond_mean_at_actual_t] + when the fight went the distance and >= 40 " +
      "simulations did: [dec_mean, dec_var, dec_pit, dec_crps, dec_in80_naive]", built: new Date().toISOString() },
    fights: {} };
  for (const r of res) doc.fights[r.id] = r;
  fs.writeFileSync(args.out, JSON.stringify(doc));
  console.log(`wrote ${args.out} (${res.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
function feed(w) {
  if (next >= chunks.length) { w.terminate(); live--; if (live === 0) finish(); return; }
  w.postMessage({ cmd: "run", ids: chunks[next++] });
}
for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
  const w = new Worker(__filename, { workerData: { engineDir: ENGINE_DIR, sims: SIMS, seed: SEED, actuals: path.resolve(args.actuals) } });
  live++;
  w.on("message", (m) => {
    if (m.cmd === "done") {
      ver = [m.version, m.params];
      res.push(...m.out); done += m.out.length;
      if (done % 250 < m.out.length) console.log(`  ${done}/${ids.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
      feed(w);
    }
  });
  w.on("error", (e) => { console.error(e); process.exit(1); });
  feed(w);
}
