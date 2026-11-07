#!/usr/bin/env node
/* v501_dynfit.js (engine v5.0.1; TRAIN 2019-2023 only): within-fight output dispersion of the simulator vs real fights, for the v5
   review's "within-fight output noise is far too large" finding. Simulates every 2019-2023 backtest fight in both corner orders with
   the evalv leak-free inputs (out-of-fold learned rates, as-of priors, durability records + train NORM, SOS pairs, step-4 inputs) and
   a params override, traces each fight, and reports the realism statistics of the review (the same estimators as its
   rounds_stats2.py) for the simulation and for the real fights (data: ufcstats per-round rows of the same fights,
   data/derived/v501_real_rounds.json; tools/v501_real_rounds.py):
     round level (full rounds): sig landed sd and NB k, attempts CV, within-round corr A vs B (landed, attempts), own corr R1-R2 /
       R1-R3 (landed), own log attempts corr R1-R2
     fight level (3-round fights that went the distance): residual sd of log1p(fight total) for sig attempts / landed and of
       sig accuracy (logit) vs the simulator's within-fight sd (ratio 1 = right amount of noise), corr of A and B log attempts
   No validation or vault fight is read.
     node tools/v501_dynfit.js --params '<json override>' [--sims 16] [--workers 3] [--label x] [--out file] [--engine-dir src] */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const ST = ["sig_att", "sig_lnd", "h_lnd", "kd", "td_att", "ctrl"];

if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(W.engineDir, "engine3.js"));
  const bt = J("data/derived/backtest_dev.json"), keys = bt.meta.keys;
  const PA = J("data/derived/mlcal_priors_asof.json"), OOF = J("data/derived/mlrates_oof.json"), T = OOF.meta.targets;
  const toObj = (a) => { const r = {}; T.forEach((k, i) => { r[k] = a[i]; }); return r; };
  const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT), SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT), XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
  const byId = new Map(bt.fights.map((f) => [f.id, f]));
  parentPort.on("message", (msg) => {
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id); if (!f || f.date < "2019-01-01" || f.date >= "2024-01-01") continue;
      const R = f.rounds === 5 ? 5 : 3, rec = { id, R, sims: [] };
      for (const swap of [false, true]) {
        const A = Object.assign({}, swap ? f.B : f.A, { keys }), B = Object.assign({}, swap ? f.A : f.B, { keys });
        const o = { division: f.prior_division || f.division, rounds: f.rounds, title: !!f.title, date: f.date, priors: PA[f.date.slice(0, 4)], params: JSON.parse(JSON.stringify(W.params || {})) };
        const oof = OOF.fights[f.id];
        o.ml = oof && oof.A && oof.B ? (swap ? { pred: { A: toObj(oof.B), B: toObj(oof.A) } } : { pred: { A: toObj(oof.A), B: toObj(oof.B) } }) : false;
        if (DR.on(o.params)) DR.apply(o, f.id, swap);
        if (SR.on(o.params)) SR.apply(o, f, swap);
        XR.apply(o, f, swap, o.params);
        const m = E.matchup(A, B, o);
        DR.assertApplied(m, f.id, o.params); SR.assertApplied(m, f.id, o.params); XR.assertApplied(m, f.id, o.params);
        const base = hash32(f.id + (swap ? "|s" : "|n"));
        for (let k = 0; k < W.sims; k++) {
          const s = E.simulate(m, E.makeRng((base ^ Math.imul(k + 1, 2654435761)) >>> 0), true);
          const dec = E.isDecision(s), rows = [];
          for (const rr of s.rounds) {
            const full = !(rr.r === s.rounds.length - 1 && !dec && s.round === rr.r + 1) ? 1 : 0;
            const sd = [rr.st.A, rr.st.B];
            const v = [0, 1].map((x) => { const real = swap ? 1 - x : x; return [real, ST.map((q) => +sd[x][q] || 0)]; });
            v.sort((a, b) => a[0] - b[0]);
            rows.push([rr.r + 1, full, v[0][1], v[1][1]]);
          }
          rec.sims.push({ dec: dec ? 1 : 0, rows });
        }
      }
      out.push(rec);
    }
    parentPort.postMessage(out);
  });
  return;
}

// ------------------------------------------------------------------ statistics (shared by sim and real)
function corr(x, y) { const n = x.length; if (n < 3) return NaN; let mx = 0, my = 0; for (let i = 0; i < n; i++) { mx += x[i]; my += y[i]; } mx /= n; my /= n; let sxy = 0, sxx = 0, syy = 0; for (let i = 0; i < n; i++) { const a = x[i] - mx, b = y[i] - my; sxy += a * b; sxx += a * a; syy += b * b; } return sxy / Math.sqrt(sxx * syy); }
function mean(a) { return a.reduce((s, v) => s + v, 0) / a.length; }
function sd(a) { const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1)); }
// fights: [{ id, R, sims: [{ dec, rows: [[rnd, full, statsA[], statsB[]]] }] }]; real fights carry one "sim"
function roundStats(fights) {
  const L = [], Aatt = [], Batt = [], Alnd = [], Blnd = [], r12 = [[], []], r13 = [[], []], a12 = [[], []];
  const iA = ST.indexOf("sig_att"), iL = ST.indexOf("sig_lnd");
  for (const f of fights) for (const s of f.sims) {
    const byR = {};
    for (const [rnd, full, a, b] of s.rows) {
      if (!full) continue;
      byR[rnd] = [a, b];
      L.push(a[iL], b[iL]); Aatt.push(a[iA]); Batt.push(b[iA]); Alnd.push(a[iL]); Blnd.push(b[iL]);
    }
    for (let side = 0; side < 2; side++) {
      if (byR[1] && byR[2]) { r12[0].push(byR[1][side][iL]); r12[1].push(byR[2][side][iL]); a12[0].push(Math.log1p(byR[1][side][iA])); a12[1].push(Math.log1p(byR[2][side][iA])); }
      if (byR[1] && byR[3]) { r13[0].push(byR[1][side][iL]); r13[1].push(byR[3][side][iL]); }
    }
  }
  const m = mean(L), v = sd(L) ** 2, att = Aatt.concat(Batt);
  return { round_sig_lnd_mean: m, round_sig_lnd_sd: Math.sqrt(v), round_sig_lnd_nbk: m * m / (v - m), round_sig_att_cv: sd(att) / mean(att),
    corr_AB_round_att: corr(Aatt, Batt), corr_AB_round_lnd: corr(Alnd, Blnd), own_corr_R1R2_lnd: corr(r12[0], r12[1]), own_corr_R1R3_lnd: corr(r13[0], r13[1]),
    own_corr_R1R2_logatt: corr(a12[0], a12[1]) };
}
// fight totals of 3-round decisions: per fight-side y = log1p(total) (attempts, landed) and logit accuracy
function fightTotals(s, side) {
  const iA = ST.indexOf("sig_att"), iL = ST.indexOf("sig_lnd"); let a = 0, l = 0;
  for (const row of s.rows) { a += row[2 + side][iA]; l += row[2 + side][iL]; }
  return { att: Math.log1p(a), lnd: Math.log1p(l), acc: Math.log((l + 0.5) / (a - l + 0.5)) };
}
function fightStats(simF, realF) {
  const realBy = new Map(realF.map((f) => [f.id, f])), out = {};
  for (const k of ["att", "lnd", "acc"]) {
    const z = [], w = [];
    for (const f of simF) {
      if (f.R !== 3) continue;
      const rf = realBy.get(f.id); if (!rf || !rf.sims[0].dec) continue;
      for (let side = 0; side < 2; side++) {
        const ys = f.sims.filter((s) => s.dec).map((s) => fightTotals(s, side)[k]);
        if (ys.length < 5) continue;
        z.push(fightTotals(rf.sims[0], side)[k] - mean(ys)); w.push(sd(ys) ** 2);
      }
    }
    out["resid_sd_" + k] = sd(z); out["sim_within_sd_" + k] = Math.sqrt(mean(w)); out["ratio_" + k] = sd(z) / Math.sqrt(mean(w)); out["bias_" + k] = mean(z); out.n_fight_sides = z.length;
  }
  const xa = [], xb = [];
  for (const f of simF) if (f.R === 3) for (const s of f.sims) if (s.dec) { xa.push(fightTotals(s, 0).att); xb.push(fightTotals(s, 1).att); }
  out.corr_AB_fight_logatt = corr(xa, xb);
  return out;
}
function realFights() {
  const rows = J("data/derived/v501_real_rounds.json").rows, by = new Map();
  for (const r of rows) {
    if (!by.has(r.fid)) by.set(r.fid, { id: r.fid, R: r.R, dec: ["UD", "SD", "MD", "DRAW"].includes(r.method) ? 1 : 0, rr: {} });
    const g = by.get(r.fid); (g.rr[r.rnd] = g.rr[r.rnd] || [null, null, r.full])[r.side] = ST.map((q) => +r[q] || 0);
  }
  const out = [];
  for (const g of by.values()) {
    const rows = [];
    for (const rnd of Object.keys(g.rr).map(Number).sort((a, b) => a - b)) { const x = g.rr[rnd]; if (x[0] && x[1]) rows.push([rnd, x[2], x[0], x[1]]); }
    out.push({ id: g.id, R: g.R, sims: [{ dec: g.dec, rows }] });
  }
  return out;
}
module.exports = { roundStats, fightStats, realFights };

if (require.main === module) {
  const args = {}; const av = process.argv.slice(2); for (let i = 0; i < av.length; i++) if (av[i].startsWith("--")) { const v = av[i + 1]; if (v == null || v.startsWith("--")) args[av[i].slice(2)] = true; else { args[av[i].slice(2)] = v; i++; } }
  const params = args.params ? JSON.parse(args.params) : {};
  const SIMS = +(args.sims || 16), WORKERS = Math.min(3, +(args.workers || 3));
  const engineDir = path.resolve(ROOT, args["engine-dir"] || "src");
  const real = realFights();
  const ids = real.map((f) => f.id);
  const chunks = []; for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));
  const res = []; let next = 0, live = 0; const t0 = Date.now();
  new Promise((resolve) => {
    for (let k = 0; k < WORKERS; k++) {
      const w = new Worker(__filename, { workerData: { engineDir, sims: SIMS, params } }); live++;
      const feed = () => { if (next >= chunks.length) { w.terminate(); if (--live === 0) resolve(); return; } w.postMessage({ ids: chunks[next++] }); };
      w.on("message", (o) => { res.push(...o); feed(); }); w.on("error", (e) => { console.error(e); process.exit(1); });
      feed();
    }
  }).then(() => {
    const sim = { round: roundStats(res), fight: fightStats(res, real) };
    const rl = { round: roundStats(real) };
    const out = { label: args.label || "", params, sims_per_order: SIMS, n_fights: res.length, wall_s: (Date.now() - t0) / 1000, sim, real: rl };
    const r4 = (x) => (typeof x === "number" ? Math.round(x * 1e4) / 1e4 : x);
    const show = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r4(v)]));
    console.log(JSON.stringify({ label: out.label, params, n: out.n_fights, wall_s: r4(out.wall_s), round_sim: show(sim.round), round_real: show(rl.round), fight: show(sim.fight) }));
    if (args.out) fs.writeFileSync(args.out, JSON.stringify(out));
  });
}
