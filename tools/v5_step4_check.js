#!/usr/bin/env node
/* v5_step4_check.js: train-only engine-level check of the v5 merge step-4 components (embed, preufc; oppadj for information),
   TRAIN 2019-01-01..2023-12-31 only (nothing from 2024 on is simulated or scored; 2026 is never read).

   Every 2019-2023 backtest_dev fight in both corner orders, common random numbers across configurations (fight f, order o uses
   makeRng(mix(mix(hash(id), o), seed)) as tools/evalv.js), with the evalv inputs: walk-forward as-of priors, out-of-fold learned
   rates, durability walk-forward records + train NORM (tools/durrec.js), walk-forward SOS pairs with leave-one-year-out
   coefficients (tools/sosrec.js), and the step-4 inputs (tools/mlpathrec.js: embedding etas + leave-one-year-out blend
   coefficients, oppadj snapshots, pre-UFC snapshots). Configurations (opts.params.components):
     base           embed off, oppadj off, preufc off   (= the step-3 engine)
     embed          embed on                            (the step-4 default)
     embed_preufc   embed on + preufc on
     embed_oppadj   embed on + oppadj on with styles_sos sos off (information for the Calibrate ablation; not a selection here)
   Scores (evalv's definitions and smoothing): winner log loss, 7-bin, method (KO / SUB / DEC), per-fight Poisson stat-line
   deviance (sig landed, sig attempts, TD landed, control, KD), and on newcomer sides (<= 3 prior UFC fights) the per-side
   KO-win and SUB-win log loss; paired differences vs base with 95% event-cluster bootstrap intervals (2,000 resamples).

     node tools/v5_step4_check.js [--sims 100] [--workers 3] [--configs base,embed,embed_preufc,embed_oppadj]
   Writes data/derived/v5_step4_check.json. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
const TRAIN = ["2019-01-01", "2024-01-01"];
const STATK = ["sig_lnd", "sig_att", "td_lnd", "ctrl", "kd"];
const CONFIGS = {
  base: { components: { embed: false, oppadj: false, preufc: false } },
  embed: { components: { embed: true, oppadj: false, preufc: false } },
  embed_preufc: { components: { embed: true, oppadj: false, preufc: true } },
  embed_oppadj: { components: { embed: true, oppadj: true, preufc: false, styles_sos: { sos: false } } }
};
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function trainFights() {
  const bt = readJSON("data/derived/backtest_dev.json");
  const fs_ = bt.fights.filter((f) => f.date >= TRAIN[0] && f.date < TRAIN[1]);
  for (const f of fs_) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
  return fs_;
}
function outcome(f) {
  const r = f.result || {};
  const cls = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DRAW" }[r.method] || null;
  if (!cls || (cls !== "DRAW" && r.winner !== "A" && r.winner !== "B")) return null;
  return { winner: cls === "DRAW" ? "D" : r.winner, cls };
}

if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(ROOT, "src/engine3.js"));
  const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT);
  const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
  const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
  const fights = trainFights(), byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON("data/derived/mlrates_oof.json"), TN = OOF.meta.targets;
  const rates = (arr) => { const o = {}; TN.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  parentPort.on("message", (msg) => {
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id), res = { id };
      try {
        for (const cn of W.configs) {
          const acc = { c7: [0, 0, 0, 0, 0, 0, 0], st: new Array(10).fill(0), n: 0 };
          for (let o = 0; o < 2; o++) {
            const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A, ent = OOF.fights[f.id];
            const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)],
              params: JSON.parse(JSON.stringify(CONFIGS[cn])) };
            opts.ml = ent && ent.A && ent.B ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false;
            DR.apply(opts, f.id, o === 1);
            if (SR.on(opts.params)) SR.apply(opts, f, o === 1);
            XR.apply(opts, f, o === 1, opts.params);
            const m = E.matchup(A, B, opts);
            SR.assertApplied(m, f.id, opts.params);
            XR.assertApplied(m, f.id, opts.params);
            const rng = E.makeRng(mix(mix(hash32(f.id), o), W.seed));
            for (let i = 0; i < W.sims; i++) {
              const s = E.simulate(m, rng, false);
              const wD = s.winner === "D" ? "D" : ((s.winner === "A") === (o === 0) ? "A" : "B");
              const isDec = s.method === "UD" || s.method === "SD" || s.method === "MD" || s.method === "DRAW";
              let k;
              if (wD === "D") k = 3; else if (isDec) k = wD === "A" ? 2 : 4; else if (s.method === "SUB") k = wD === "A" ? 1 : 5; else k = wD === "A" ? 0 : 6;
              acc.c7[k]++;
              const TA = o === 0 ? s.totals.A : s.totals.B, TB = o === 0 ? s.totals.B : s.totals.A;
              for (let q = 0; q < 5; q++) { acc.st[q] += TA[STATK[q]]; acc.st[5 + q] += TB[STATK[q]]; }
              acc.n++;
            }
          }
          res[cn] = acc;
        }
      } catch (e) { res.err = String(e && e.message || e); }
      out.push(res);
    }
    parentPort.postMessage(out);
  });
  return;
}

// ---------------------------------------------------------------- main
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith("--")) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true; });
const SIMS = +(args.sims || 100), WORKERS = Math.max(1, Math.min(3, +(args.workers || 3))), SEED = +(args.seed || 1);
const CFG = String(args.configs || "base,embed,embed_preufc,embed_oppadj").split(",");
const fights = trainFights();
console.log(`v5_step4_check: ${fights.length} train fights x 2 orders x ${SIMS} sims x configs ${CFG.join(", ")} (${WORKERS} workers)`);
const t0 = Date.now();
const chunks = []; for (let i = 0; i < fights.length; i += 20) chunks.push(fights.slice(i, i + 20).map((f) => f.id));
const results = new Map();
let next = 0, done = 0;
function finish() {
  // evalv's train-only smoothing prior for the 7 bins
  const c = { KO: 0, SUB: 0, DEC: 0, DRAW: 0 }; let n = 0;
  for (const f of fights) { const y = outcome(f); if (y) { c[y.cls]++; n++; } }
  const b7 = [c.KO / 2, c.SUB / 2, c.DEC / 2, c.DRAW, c.DEC / 2, c.SUB / 2, c.KO / 2].map((v) => v / n);
  const poisDev = (y, mu) => { mu = Math.max(mu, 1e-6); return 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu)); };
  const L = {}; CFG.forEach((k) => { L[k] = []; });
  const ev = [], errs = [];
  for (const f of fights) {
    const r = results.get(f.id);
    if (!r || r.err) { errs.push(f.id + ": " + (r ? r.err : "missing")); continue; }
    const y = outcome(f);
    ev.push(f.date);
    for (const k of CFG) {
      const a = r[k], N = a.n, p7 = a.c7.map((v, i) => (v + b7[i]) / (N + 1)), l = {};
      if (y) {
        const k7 = y.cls === "DRAW" ? 3 : (y.cls === "DEC" ? (y.winner === "A" ? 2 : 4) : (y.cls === "SUB" ? (y.winner === "A" ? 1 : 5) : (y.winner === "A" ? 0 : 6)));
        l.bin7 = -Math.log(p7[k7]);
        const s3 = { KO: p7[0] + p7[6], SUB: p7[1] + p7[5], DEC: p7[2] + p7[3] + p7[4] };
        l.method = -Math.log(s3[y.cls === "DRAW" ? "DEC" : y.cls]);
        if (y.winner !== "D") {
          const aW = a.c7[0] + a.c7[1] + a.c7[2], bW = a.c7[4] + a.c7[5] + a.c7[6];
          const pA = Math.min(0.995, Math.max(0.005, (aW + 0.5) / (aW + bW + 1))), yy = y.winner === "A" ? 1 : 0;
          l.winLL = -(yy * Math.log(pA) + (1 - yy) * Math.log(1 - pA));
        }
        // newcomer sides: per-side KO-win and SUB-win log loss
        for (const [side, iKO, iSUB] of [["A", 0, 1], ["B", 6, 5]]) {
          if (+f[side].n > 3) continue;
          const pk = p7[iKO], ps = p7[iSUB], yk = y.winner === side && y.cls === "KO" ? 1 : 0, ys = y.winner === side && y.cls === "SUB" ? 1 : 0;
          l.nc_ko = (l.nc_ko || 0) - (yk ? Math.log(pk) : Math.log(1 - pk));
          l.nc_sub = (l.nc_sub || 0) - (ys ? Math.log(ps) : Math.log(1 - ps));
          l.nc_n = (l.nc_n || 0) + 1;
        }
      }
      if (f.actual && f.actual.A && f.actual.B) {
        STATK.forEach((s, q) => {
          const ya = f.actual.A[s], yb = f.actual.B[s];
          if (ya != null && yb != null) l["dev_" + s] = 0.5 * (poisDev(ya, a.st[q] / N) + poisDev(yb, a.st[5 + q] / N));
        });
      }
      L[k].push(l);
    }
  }
  // paired differences vs base with event-cluster bootstrap
  const evs = [...new Set(ev)], evIdx = ev.map((d) => evs.indexOf(d));
  let s = 7; const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const picks = []; for (let b = 0; b < 2000; b++) { const p = new Array(evs.length).fill(0); for (let j = 0; j < evs.length; j++) p[Math.floor(rnd() * evs.length)]++; picks.push(p); }
  const metrics = ["winLL", "bin7", "method"].concat(STATK.map((x) => "dev_" + x), ["nc_ko", "nc_sub"]);
  function stat(arr, key, keyN) {   // ratio estimator: sum of losses / count (per side for the newcomer metrics)
    const sE = new Array(evs.length).fill(0), nE = new Array(evs.length).fill(0);
    arr.forEach((l, i) => { if (l[key] != null) { sE[evIdx[i]] += l[key]; nE[evIdx[i]] += keyN ? l[keyN] : 1; } });
    return { sE, nE };
  }
  const out = { meta: { tool: "tools/v5_step4_check.js", window: "TRAIN 2019-01-01..2023-12-31", fights: fights.length, sims_per_order: SIMS,
    seed: SEED, configs: CFG.reduce((o, k) => { o[k] = CONFIGS[k]; return o; }, {}), errors: errs.length, engine: require(path.join(ROOT, "src/engine3.js")).VERSION,
    note: "evalv's metric definitions and smoothing; nc_* = per newcomer side (<= 3 prior UFC fights)" }, levels: {}, paired: {} };
  for (const k of CFG) {
    out.levels[k] = {};
    for (const mt of metrics) {
      const nk = mt.startsWith("nc_") ? "nc_n" : null, { sE, nE } = stat(L[k], mt, nk);
      const tot = sE.reduce((a, b) => a + b, 0) / Math.max(1, nE.reduce((a, b) => a + b, 0));
      out.levels[k][mt] = +tot.toFixed(5);
      if (k === "base") continue;
      const b = stat(L.base, mt, nk), d = sE.map((v, j) => v - b.sE[j]), N = nE;
      const diff = d.reduce((a, c) => a + c, 0) / Math.max(1, N.reduce((a, c) => a + c, 0));
      const bs = picks.map((p) => { let num = 0, den = 0; for (let j = 0; j < p.length; j++) if (p[j]) { num += p[j] * d[j]; den += p[j] * N[j]; } return num / Math.max(1, den); }).sort((x, y) => x - y);
      out.paired[k] = out.paired[k] || {};
      out.paired[k][mt] = { diff: +diff.toFixed(5), lo: +bs[50].toFixed(5), hi: +bs[1949].toFixed(5) };
    }
  }
  out.levels.nc_sides = L.base.reduce((a, l) => a + (l.nc_n || 0), 0);
  fs.writeFileSync(path.join(ROOT, "data/derived/v5_step4_check.json"), JSON.stringify(out, null, 1));
  for (const k of CFG) {
    console.log(`${k.padEnd(13)} ` + metrics.map((mt) => `${mt} ${out.levels[k][mt]}` + (out.paired[k] ? ` (${out.paired[k][mt].diff >= 0 ? "+" : ""}${out.paired[k][mt].diff} [${out.paired[k][mt].lo}, ${out.paired[k][mt].hi}])` : "")).join("; "));
  }
  console.log(`errors ${errs.length}${errs.length ? ": " + errs.slice(0, 3).join(" | ") : ""}; newcomer sides ${out.levels.nc_sides}; ${((Date.now() - t0) / 1000).toFixed(0)} s; wrote data/derived/v5_step4_check.json`);
}
for (let w = 0; w < WORKERS; w++) {
  const wk = new Worker(__filename, { workerData: { sims: SIMS, seed: SEED, configs: CFG } });
  const feed = () => { if (next < chunks.length) wk.postMessage({ ids: chunks[next++] }); else wk.terminate(); };
  wk.on("message", (out) => {
    for (const r of out) results.set(r.id, r);
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${chunks.length} chunks, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (done === chunks.length) finish();
    feed();
  });
  wk.on("error", (e) => { console.error("worker error", e); process.exit(1); });
  feed();
}
