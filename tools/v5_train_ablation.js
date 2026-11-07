#!/usr/bin/env node
/* v5_train_ablation.js: Calibrate A, the leave-one-out TRAIN ablation that sets v5's default component flags.

   TRAIN 2019-01-01..2023-12-31 only: every backtest_dev fight in that window (1,999), both corner orders, common random numbers
   across arms (fight f, order o uses makeRng(mix(mix(hash(id), o), seed)), as tools/evalv.js). Nothing dated 2024 or later is
   simulated or scored, and 2026 is never read (backtest_dev.json holds none; the window filter drops 2024-25).

   Inputs are evalv's, leak-free: walk-forward as-of priors (mlcal_priors_asof.json[year]), out-of-fold learned rates
   (mlrates_oof.json), durability walk-forward records + the train NORM (tools/durrec.js), walk-forward SOS pairs with
   leave-one-year-out coefficients (tools/sosrec.js), and the step-4 inputs (tools/mlpathrec.js: embedding etas with
   leave-one-year-out blend coefficients, oppadj snapshots, pre-UFC snapshots). Every arm asserts its inputs were applied.

   Arms (opts.params overrides on top of src/params3.js as merged; ARMS below):
     all            every component as merged (v401 a-e, durability, dynamics, styles_sos sos "wf", embed, preufc)
     -<x>           all minus one component or v401 sub-flag (durability, dynamics, sos, embed, preufc, emJudge, deductions,
                    mlLevels, tdCap, koTargets)
     oppadj         oppadj instead of SOS ({ oppadj: true, styles_sos: { sos: false } }; the engine refuses both together)
     v3p            the reviewer's "v3 params + learned rates": every parameter v4 changed relative to v3 (the [selfcal] scales and
                    KO block, the division table, the judge block) set back to versions/v3/params3.js, judge.sharedFight and
                    judge.t108kd 0 (v3 had neither), and the v401 refits of those same fields (emJudge, mlLevels, koTargets) off;
                    learned rates and every other v5 component stay on. v3's own 10-8 rule (t108b / t108kd2) is not in the v5
                    engine, so its judging is v3's weights and noise with the v4 10-8 rule at v3's threshold.
     final          (with --final '<json components override>') the chosen defaults, for the confirmation run

   Per arm and fight (evalv's definitions and smoothing): winner log loss, Brier, soft-label cross-entropy against the closing
   line (market.json p_power_close; research/model_market.md 4.11), 7-bin and method (KO / SUB / DEC) log loss, per-fight Poisson
   stat-line deviance (sig landed, sig attempts, TD landed, TD attempts, control, KD, head landed, sub attempts) and the total
   (mean of the five evalv targets' deviances, each divided by the all-on arm's train mean: x100 = mean relative change in %),
   and the base-rate table. Paired differences vs `all` with 95% event-cluster bootstrap intervals (2,000 resamples of
   event-dates, the same resamples for every arm and metric). The joint cells go to out/v5_train_ablation/cells_<arm>.json for
   tools/v5_train_ablation_mr.py (methodround.py's own per-fight losses: method x round, who x how x when, ...).

     nice -n 5 node tools/v5_train_ablation.js [--sims 300] [--workers 3] [--arms all,-durability,...] [--tag main]
         [--final '{"v401":{"tdCap":false}}']
   Writes data/derived/v5_train_ablation[_<tag>].json and out/v5_train_ablation[_<tag>]/. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
const TRAIN = ["2019-01-01", "2024-01-01"];
const STATK = ["sig_lnd", "sig_att", "td_lnd", "td_att", "ctrl", "kd", "h_lnd", "sub_att"];
const NSTAT = STATK.length;
const DEVK = ["sig_lnd", "sig_att", "td_lnd", "ctrl", "kd"];          // evalv's deviance targets (the total uses these)
const DEVX = ["td_att", "h_lnd", "sub_att"];                           // reported per target only

function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
const readJSON = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
function trainFights() {
  const bt = readJSON("data/derived/backtest_dev.json");
  const out = bt.fights.filter((f) => f.date >= TRAIN[0] && f.date < TRAIN[1] && f.date < "2026-01-01");
  for (const f of out) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
  return out;
}
function outcome(f) {
  const r = f.result || {};
  const cls = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DRAW" }[r.method] || null;
  if (!cls || (cls !== "DRAW" && r.winner !== "A" && r.winner !== "B")) return null;
  return { winner: cls === "DRAW" ? "D" : r.winner, cls, round: r.round || 1, method: r.method };
}

// ---------------------------------------------------------------- arms
// v3p: the fields v4 changed relative to v3 (everything in versions/v3/params3.js whose value differs from versions/v4/params3.js)
function v3Override() {
  const ld = (p) => { const k = require.resolve(p); delete require.cache[k]; return require(p); };
  const v3 = ld(path.join(ROOT, "versions/v3/params3.js")), v4 = ld(path.join(ROOT, "versions/v4/params3.js"));
  const o = {};
  for (const k of Object.keys(v3)) {
    if (k === "version") continue;
    const a = v3[k], b = v4[k];
    if (JSON.stringify(a) === JSON.stringify(b)) continue;
    if (a && typeof a === "object" && !Array.isArray(a)) {
      // two-level objects (judge, div): copy v3's whole block (merged field by field by the engine's mergeParams)
      o[k] = JSON.parse(JSON.stringify(a));
    } else o[k] = a;
  }
  o.judge = Object.assign({}, o.judge || {}, { sharedFight: 0, t108kd: 0 });
  o.components = { v401: { emJudge: false, mlLevels: false, koTargets: false } };
  return o;
}
function armDefs(finalOver) {
  const A = {
    all: {},
    "-durability": { components: { durability: false } },
    "-dynamics": { components: { dynamics: false } },
    "-sos": { components: { styles_sos: { sos: false } } },
    oppadj: { components: { oppadj: true, styles_sos: { sos: false } } },
    "-embed": { components: { embed: false } },
    "-preufc": { components: { preufc: false } },
    "-emJudge": { components: { v401: { emJudge: false } } },
    "-deductions": { components: { v401: { deductions: false } } },
    "-mlLevels": { components: { v401: { mlLevels: false } } },
    "-tdCap": { components: { v401: { tdCap: false } } },
    "-koTargets": { components: { v401: { koTargets: false } } },
    v3p: v3Override()
  };
  if (finalOver) A.final = { components: finalOver };
  return A;
}

// ================================================================== worker
if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(ROOT, "src/engine3.js"));
  const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT);
  const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
  const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
  const ARMS = armDefs(W.finalOver);
  const fights = trainFights(), byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON("data/derived/mlrates_oof.json"), TN = OOF.meta.targets;
  const rates = (arr) => { const o = {}; TN.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  parentPort.on("message", (msg) => {
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id), R = f.rounds === 5 ? 5 : 3, NCELL = 4 * R + 3, res = { id, arms: {} };
      try {
        for (const an of W.arms) {
          const acc = { cells: new Float64Array(NCELL), dec: [0, 0, 0], draw: 0, decRounds: 0, decN108: 0, nDed: 0,
            stats: new Float64Array(2 * NSTAT), mins: 0, n: 0, ml: 0 };
          for (let o = 0; o < 2; o++) {
            const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A, ent = OOF.fights[f.id];
            const params = JSON.parse(JSON.stringify(ARMS[an]));
            const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date,
              priors: priors[f.date.slice(0, 4)], params };
            opts.ml = ent && ent.A && ent.B ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false;
            DR.apply(opts, f.id, o === 1);
            if (SR.on(opts.params)) SR.apply(opts, f, o === 1);
            XR.apply(opts, f, o === 1, opts.params);
            const m = E.matchup(A, B, opts);
            DR.assertApplied(m, f.id, opts.params);
            SR.assertApplied(m, f.id, opts.params);
            XR.assertApplied(m, f.id, opts.params);
            if (m.mlApplied) acc.ml++;
            const rng = E.makeRng(mix(mix(hash32(f.id), o), W.seed));
            for (let i = 0; i < W.sims; i++) {
              const s = E.simulate(m, rng, false);
              const wD = s.winner === "D" ? "D" : ((s.winner === "A") === (o === 0) ? "A" : "B");
              const meth = s.method, isDec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
              const r = Math.max(1, Math.min(R, s.round));
              if (wD === "D") { acc.cells[4 * R + 2]++; acc.draw++; }
              else if (isDec) { acc.cells[wD === "A" ? 4 * R : 4 * R + 1]++; acc.dec[meth === "UD" ? 0 : (meth === "SD" ? 1 : 2)]++; }
              else { const sub = meth === "SUB"; acc.cells[(wD === "A" ? (sub ? R : 0) : (sub ? 3 * R : 2 * R)) + r - 1]++; }
              if (isDec) { acc.decRounds += R; acc.decN108 += (s.n108 || 0) + 3 * (s.nDed || 0); }
              acc.nDed += s.nDed || 0;
              acc.mins += isDec ? R * 5 : (s.round - 1) * 5 + s.t / 60;
              const TA = o === 0 ? s.totals.A : s.totals.B, TB = o === 0 ? s.totals.B : s.totals.A;
              for (let k = 0; k < NSTAT; k++) { acc.stats[k] += TA[STATK[k]]; acc.stats[NSTAT + k] += TB[STATK[k]]; }
              acc.n++;
            }
          }
          res.arms[an] = { cells: Array.from(acc.cells), dec: acc.dec, draw: acc.draw, decRounds: acc.decRounds, decN108: acc.decN108,
            nDed: acc.nDed, stats: Array.from(acc.stats), mins: acc.mins, n: acc.n, ml: acc.ml };
        }
      } catch (e) { res.err = String(e && e.stack || e); }
      out.push(res);
    }
    parentPort.postMessage(out);
  });
  return;
}

// ================================================================== main
const args = {};
process.argv.slice(2).forEach((a, i, arr) => { if (a.startsWith("--")) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true; });
const SIMS = +(args.sims || 300), WORKERS = Math.max(1, Math.min(3, +(args.workers || 3))), SEED = +(args.seed || 1), BOOT = +(args.boot || 2000);
const FINAL = args.final ? JSON.parse(args.final) : null;
const ARMS = armDefs(FINAL);
const ARMLIST = String(args.arms || Object.keys(ARMS).join(",")).split(",");
if (ARMLIST[0] !== "all") { console.error("the first arm must be 'all' (the reference)"); process.exit(2); }
for (const a of ARMLIST) if (!ARMS[a]) { console.error("unknown arm " + a); process.exit(2); }
const TAG = args.tag ? "_" + args.tag : "";
const OUTDIR = path.join(ROOT, "out", "v5_train_ablation" + TAG);
const fights = trainFights();
const LIMIT = args.limit ? +args.limit : fights.length;
const runFights = fights.slice(0, LIMIT);
console.log(`v5_train_ablation: ${runFights.length} train fights x 2 orders x ${SIMS} sims x ${ARMLIST.length} arms (${ARMLIST.join(" ")}), ${WORKERS} workers`);
const t0 = Date.now();

// ---------------------------------------------------------------- evalv's metric definitions (copied; keep in step)
const clip = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));
function baseDist(fs_) {
  const c = { KO: 0, SUB: 0, DEC: 0, DRAW: 0 }, byR = { 3: { ko: [0, 0, 0], sub: [0, 0, 0], dec: 0, draw: 0, n: 0 }, 5: { ko: [0, 0, 0, 0, 0], sub: [0, 0, 0, 0, 0], dec: 0, draw: 0, n: 0 } };
  let n = 0;
  for (const f of fs_) {
    const y = outcome(f); if (!y) continue;
    c[y.cls]++; n++;
    const R = f.rounds === 5 ? 5 : 3, q = byR[R]; q.n++;
    if (y.cls === "KO") q.ko[Math.min(R, y.round) - 1]++; else if (y.cls === "SUB") q.sub[Math.min(R, y.round) - 1]++; else if (y.cls === "DEC") q.dec++; else q.draw++;
  }
  const b7 = [c.KO / 2, c.SUB / 2, c.DEC / 2, c.DRAW, c.DEC / 2, c.SUB / 2, c.KO / 2].map((v) => v / n);
  const cells = {};
  for (const R of [3, 5]) {
    const q = byR[R], m = Math.max(1, q.n), v = [];
    for (let r = 0; r < R; r++) v.push(q.ko[r] / 2 / m); for (let r = 0; r < R; r++) v.push(q.sub[r] / 2 / m);
    for (let r = 0; r < R; r++) v.push(q.ko[r] / 2 / m); for (let r = 0; r < R; r++) v.push(q.sub[r] / 2 / m);
    v.push(q.dec / 2 / m, q.dec / 2 / m, q.draw / m);
    const s = v.reduce((a, b) => a + b, 0) || 1; cells[R] = v.map((x) => (x + 1e-4) / (s + 1e-4 * v.length));
  }
  return { b7, cells };
}
function perFight(sim, f, base) {
  const R = f.rounds === 5 ? 5 : 3, n = sim.n, c = sim.cells;
  const cellsS = c.map((v, i) => (v + base.cells[R][i]) / (n + 1));
  const sumR = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += c[i]; return s; };
  const aKO = sumR(0, R), aSUB = sumR(R, 2 * R), bKO = sumR(2 * R, 3 * R), bSUB = sumR(3 * R, 4 * R), aDEC = c[4 * R], bDEC = c[4 * R + 1], DR = c[4 * R + 2];
  const raw7 = [aKO, aSUB, aDEC, DR, bDEC, bSUB, bKO];
  const b7 = raw7.map((v, i) => (v + base.b7[i]) / (n + 1));
  const aW = aKO + aSUB + aDEC, bW = bKO + bSUB + bDEC;
  const pA = clip((aW + 0.5) / (aW + bW + 1), 0.005, 0.995);
  const finR = []; for (let r = 0; r < R; r++) finR.push((c[r] + c[R + r] + c[2 * R + r] + c[3 * R + r]) / n);
  const stats = { A: {}, B: {} };
  for (let k = 0; k < NSTAT; k++) { stats.A[STATK[k]] = sim.stats[k] / n; stats.B[STATK[k]] = sim.stats[NSTAT + k] / n; }
  return { id: f.id, event: f.event, date: f.date, rounds: R, pA, b7, cells: cellsS, finR,
    pKO: (aKO + bKO) / n, pSUB: (aSUB + bSUB) / n, pDEC: (aDEC + bDEC + DR) / n, pDraw: DR / n, stats, mins: sim.mins / n,
    dec: sim.dec, draw: sim.draw, decRounds: sim.decRounds, decN108: sim.decN108, nDed: sim.nDed, n };
}
function poisDev(y, mu) { mu = Math.max(mu, 1e-6); return 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu)); }
function losses(pf, f, close) {
  const y = outcome(f), L = {};
  if (y) {
    const k7 = y.cls === "DRAW" ? 3 : (y.cls === "DEC" ? (y.winner === "A" ? 2 : 4) : (y.cls === "SUB" ? (y.winner === "A" ? 1 : 5) : (y.winner === "A" ? 0 : 6)));
    L.bin7 = -Math.log(pf.b7[k7]);
    const s3 = { KO: pf.b7[0] + pf.b7[6], SUB: pf.b7[1] + pf.b7[5], DEC: pf.b7[2] + pf.b7[3] + pf.b7[4] };
    L.method = -Math.log(s3[y.cls === "DRAW" ? "DEC" : y.cls]);
    if (y.winner === "A" || y.winner === "B") {
      const yy = y.winner === "A" ? 1 : 0, p = pf.pA;
      L.winLL = -(yy * Math.log(p) + (1 - yy) * Math.log(1 - p));
      L.brier = (p - yy) * (p - yy);
      L.acc = p === 0.5 ? 0.5 : ((p > 0.5) === (yy === 1) ? 1 : 0);
    }
  }
  // soft-label cross-entropy against the closing line (every train fight with a close; research/model_market.md 4.11)
  if (close != null) { const q = close, p = pf.pA; L.softCE = -(q * Math.log(p) + (1 - q) * Math.log(1 - p)); }
  if (f.actual && f.actual.A && f.actual.B) {
    for (const k of DEVK.concat(DEVX)) {
      const ya = f.actual.A[k], yb = f.actual.B[k];
      if (ya == null || yb == null) continue;
      L["dev_" + k] = 0.5 * (poisDev(ya, pf.stats.A[k]) + poisDev(yb, pf.stats.B[k]));
    }
  }
  return L;
}
function baseRates(pfs, fs_) {
  const o = {}, idx = new Map(fs_.map((f) => [f.id, f]));
  let n = 0, sFin = 0, sKO = 0, sSUB = 0, sDEC = 0, aFin = 0, aKO = 0, aSUB = 0, aDEC = 0, sDraw = 0, aDraw = 0;
  const fr = { 3: { n: 0, s: [0, 0, 0], a: [0, 0, 0] }, 5: { n: 0, s: [0, 0, 0, 0, 0], a: [0, 0, 0, 0, 0] } };
  let sKD = 0, sHL = 0, aKD = 0, aHL = 0, sUD = 0, sSD = 0, sMD = 0, aUD = 0, aSD = 0, aMD = 0, sW = 0, sR = 0, aW = 0, aR = 0;
  let sMin = 0, aMin = 0, sSL = 0, aSL = 0, sTD = 0, aTD = 0, sCT = 0, aCT = 0;
  for (const pf of pfs) {
    const f = idx.get(pf.id), y = outcome(f);
    if (y) {
      n++; sFin += pf.pKO + pf.pSUB; sKO += pf.pKO; sSUB += pf.pSUB; sDEC += pf.pDEC; sDraw += pf.pDraw;
      if (y.cls === "KO") { aKO++; aFin++; } else if (y.cls === "SUB") { aSUB++; aFin++; } else { aDEC++; if (y.cls === "DRAW") aDraw++; }
      const q = fr[pf.rounds]; q.n++;
      for (let r = 0; r < pf.rounds; r++) q.s[r] += pf.finR[r];
      if (y.cls === "KO" || y.cls === "SUB") q.a[Math.min(pf.rounds, y.round) - 1]++;
      const nd = pf.dec[0] + pf.dec[1] + pf.dec[2];
      if (nd) { sUD += pf.dec[0] / pf.n; sSD += pf.dec[1] / pf.n; sMD += pf.dec[2] / pf.n; }
      if (y.method === "UD") aUD++; else if (y.method === "SD") aSD++; else if (y.method === "MD") aMD++;
      sW += pf.decN108 / pf.n; sR += 3 * pf.decRounds / pf.n;
      const cards = f.result && f.result.cards;
      if ((y.method === "UD" || y.method === "SD" || y.method === "MD" || y.method === "DRAW") && cards && cards.length === 3) {
        for (const c of cards) { const rj = Math.max(1, Math.round((c[0] + c[1]) / 19)); aW += Math.max(0, 19 * rj - (c[0] + c[1])); aR += rj; }
      }
    }
    if (f.actual && f.actual.A && f.actual.B) {
      sKD += pf.stats.A.kd + pf.stats.B.kd; sHL += pf.stats.A.h_lnd + pf.stats.B.h_lnd;
      aKD += f.actual.A.kd + f.actual.B.kd; aHL += f.actual.A.h_lnd + f.actual.B.h_lnd;
      sMin += pf.mins; aMin += f.actual.minutes || 0;
      sSL += pf.stats.A.sig_lnd + pf.stats.B.sig_lnd; aSL += f.actual.A.sig_lnd + f.actual.B.sig_lnd;
      sTD += pf.stats.A.td_lnd + pf.stats.B.td_lnd; aTD += f.actual.A.td_lnd + f.actual.B.td_lnd;
      sCT += pf.stats.A.ctrl + pf.stats.B.ctrl; aCT += f.actual.A.ctrl + f.actual.B.ctrl;
    }
  }
  const pair = (s, a) => ({ sim: s, actual: a, diff: s - a });
  o.n = n;
  o.finish = pair(sFin / n, aFin / n); o.KO = pair(sKO / n, aKO / n); o.SUB = pair(sSUB / n, aSUB / n); o.DEC = pair(sDEC / n, aDEC / n);
  o.draw = pair(sDraw / n, aDraw / n);
  for (const R of [3, 5]) { const q = fr[R]; o["finByRound" + R] = { n: q.n, sim: q.s.map((v) => v / Math.max(1, q.n)), actual: q.a.map((v) => v / Math.max(1, q.n)) }; }
  o.kdPer100Head = pair(100 * sKD / sHL, 100 * aKD / aHL);
  const sD = sUD + sSD + sMD, aD = aUD + aSD + aMD;
  o.decision = { sim: { UD: sUD / sD, SD: sSD / sD, MD: sMD / sD }, actual: { UD: aUD / aD, SD: aSD / aD, MD: aMD / aD }, nActual: aD };
  o.r108 = pair(sW / Math.max(1e-9, sR), aW / Math.max(1, aR));
  o.sigLndPer15 = pair(15 * sSL / 2 / sMin, 15 * aSL / 2 / aMin); o.tdPer15 = pair(15 * sTD / 2 / sMin, 15 * aTD / 2 / aMin); o.ctrlPer15 = pair(15 * sCT / 2 / sMin, 15 * aCT / 2 / aMin);
  return o;
}

// ---------------------------------------------------------------- run
const chunks = []; for (let i = 0; i < runFights.length; i += 10) chunks.push(runFights.slice(i, i + 10).map((f) => f.id));
const results = new Map();
let next = 0, done = 0;
function finish() {
  const MKT = readJSON("data/derived/market.json").fights;
  const base = baseDist(fights);                       // train-only smoothing prior (all 1,999 train fights, as evalv)
  const errs = [];
  const okF = runFights.filter((f) => { const r = results.get(f.id); if (!r || r.err) { errs.push(f.id + ": " + (r ? r.err.split("\n")[0] : "missing")); return false; } return true; });
  if (errs.length) { console.error(`${errs.length} fights failed, e.g. ${errs[0]}`); }
  const PF = {}, L = {};
  for (const a of ARMLIST) {
    PF[a] = okF.map((f) => perFight(results.get(f.id).arms[a], f, base));
    L[a] = PF[a].map((pf, i) => { const mk = MKT[okF[i].id]; return losses(pf, okF[i], mk && mk.p_power_close != null ? +mk.p_power_close : null); });
  }
  // total stat-line deviance: mean over the five evalv targets of dev_k / (all-on train mean of dev_k)
  const ref = {};
  for (const k of DEVK) { const v = L.all.map((l) => l["dev_" + k]).filter((x) => x != null); ref[k] = v.reduce((s, x) => s + x, 0) / v.length; }
  for (const a of ARMLIST) for (const l of L[a]) {
    if (DEVK.every((k) => l["dev_" + k] != null)) l.devTot = DEVK.reduce((s, k) => s + l["dev_" + k] / ref[k], 0) / DEVK.length;
  }
  // event-cluster bootstrap (event | date, as evalv), the same resamples for every arm and metric
  const gk = okF.map((f) => f.event + "|" + f.date), G = [...new Set(gk)], gi = gk.map((k) => G.indexOf(k));
  let st = 20261107; const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  const Wm = []; for (let b = 0; b < BOOT; b++) { const w = new Float64Array(G.length); for (let j = 0; j < G.length; j++) w[Math.floor(rnd() * G.length)]++; Wm.push(w); }
  const METRICS = ["softCE", "winLL", "brier", "acc", "bin7", "method", "devTot"].concat(DEVK.map((k) => "dev_" + k), DEVX.map((k) => "dev_" + k));
  function clusterStat(vals) {         // per-group sums and counts of a per-fight array (null = n/a)
    const s = new Float64Array(G.length), c = new Float64Array(G.length);
    vals.forEach((v, i) => { if (v != null && isFinite(v)) { s[gi[i]] += v; c[gi[i]]++; } });
    return { s, c };
  }
  function boot(vals) {
    const { s, c } = clusterStat(vals);
    let S = 0, C = 0; for (let j = 0; j < G.length; j++) { S += s[j]; C += c[j]; }
    const bs = Wm.map((w) => { let a = 0, d = 0; for (let j = 0; j < G.length; j++) if (w[j]) { a += w[j] * s[j]; d += w[j] * c[j]; } return a / Math.max(1e-9, d); }).sort((x, y) => x - y);
    return { est: S / Math.max(1e-9, C), lo: bs[Math.floor(0.025 * BOOT)], hi: bs[Math.min(BOOT - 1, Math.floor(0.975 * BOOT))], n: C,
      pWorse: bs.filter((x) => x > 0).length / BOOT };
  }
  const out = { meta: { tool: "tools/v5_train_ablation.js", window: "TRAIN 2019-01-01..2023-12-31 (nothing from 2024 on simulated or scored; 2026 never read)",
    fights: okF.length, sims_per_order: SIMS, seed: SEED, bootstrap: BOOT, clusters: G.length, errors: errs.length,
    engine_version: require(path.join(ROOT, "src/engine3.js")).VERSION, params_version: require(path.join(ROOT, "src/params3.js")).version,
    engine_sha256: require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, "src/engine3.js"))).digest("hex"),
    params_sha256: require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, "src/params3.js"))).digest("hex"),
    arms: ARMLIST.reduce((o, a) => { o[a] = ARMS[a]; return o; }, {}),
    devTot_ref: ref, wall_s: (Date.now() - t0) / 1000,
    note: "evalv's metric definitions and smoothing (winner p = (A wins + 0.5) / (decisive + 1), clipped 0.005..0.995; 7-bin smoothed by one " +
      "pseudo-sim of train base rates). softCE = -(q log p + (1-q) log(1-p)), q = market.json p_power_close, on every train fight with a close. " +
      "devTot = mean over sig_lnd, sig_att, td_lnd, ctrl, kd of the per-fight Poisson deviance divided by the all-on arm's train mean " +
      "(x100 = mean relative change in %). Paired: arm minus all, ratio estimator over event-date clusters; pWorse = bootstrap share of " +
      "resamples where the arm is worse than all (for acc: higher is better, so read it reversed)." },
    levels: {}, paired: {}, baseRates: {}, ml_applied: {} };
  for (const a of ARMLIST) {
    out.levels[a] = {}; out.paired[a] = {};
    for (const mt of METRICS) {
      const v = L[a].map((l) => l[mt] != null ? l[mt] : null);
      const b = boot(v); out.levels[a][mt] = { est: b.est, lo: b.lo, hi: b.hi, n: b.n };
      if (a !== "all") {
        const d = L[a].map((l, i) => (l[mt] != null && L.all[i][mt] != null ? l[mt] - L.all[i][mt] : null));
        out.paired[a][mt] = boot(d);
      }
    }
    out.baseRates[a] = baseRates(PF[a], okF);
    out.ml_applied[a] = okF.reduce((s, f) => s + results.get(f.id).arms[a].ml, 0) / (2 * okF.length);
  }
  fs.mkdirSync(OUTDIR, { recursive: true });
  for (const a of ARMLIST) {
    const sub = {}; for (const pf of PF[a]) sub[pf.id] = { cells: pf.cells.map((v) => +v.toFixed(7)) };
    fs.writeFileSync(path.join(OUTDIR, `cells_${a}.json`), JSON.stringify(sub));
    fs.writeFileSync(path.join(OUTDIR, `fights_${a}.json`), JSON.stringify(PF[a].map((pf, i) => ({ id: pf.id, pA: pf.pA, b7: pf.b7, finR: pf.finR, L: L[a][i] }))));
  }
  const outFile = path.join(ROOT, "data/derived", `v5_train_ablation${TAG}.json`);
  fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
  const f4 = (x) => (x >= 0 ? "+" : "") + x.toFixed(4);
  console.log(`all: softCE ${out.levels.all.softCE.est.toFixed(4)}  winLL ${out.levels.all.winLL.est.toFixed(4)}  bin7 ${out.levels.all.bin7.est.toFixed(4)}  method ${out.levels.all.method.est.toFixed(4)}`);
  for (const a of ARMLIST) if (a !== "all") {
    const P = out.paired[a];
    console.log(`${a.padEnd(12)} ` + ["softCE", "winLL", "bin7", "method", "devTot"].map((mt) => `${mt} ${f4(P[mt].est)} [${f4(P[mt].lo)}, ${f4(P[mt].hi)}]`).join("  "));
  }
  console.log(`errors ${errs.length}; ${((Date.now() - t0) / 1000).toFixed(0)} s; wrote ${path.relative(ROOT, outFile)} and ${path.relative(ROOT, OUTDIR)}/`);
}
for (let w = 0; w < Math.min(WORKERS, chunks.length); w++) {
  const wk = new Worker(__filename, { workerData: { sims: SIMS, seed: SEED, arms: ARMLIST, finalOver: FINAL } });
  const feed = () => { if (next < chunks.length) wk.postMessage({ ids: chunks[next++] }); else wk.terminate(); };
  wk.on("message", (o) => {
    for (const r of o) results.set(r.id, r);
    done++;
    if (done % 20 === 0) console.log(`  ${done}/${chunks.length} chunks, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    if (done === chunks.length) finish();
    feed();
  });
  wk.on("error", (e) => { console.error("worker error", e); process.exit(1); });
  feed();
}
