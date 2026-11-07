#!/usr/bin/env node
/* v5_calB_levels.js: Calibrate B (1), the ONE joint knockdown / finish / stoppage / judging level pass of engine v5, TRAIN only.

   TRAIN 2019-01-01..2023-12-31 only: every backtest_dev fight in that window (1,999), both corner orders, a seed per simulated
   fight (makeRng(mix(mix(mix(hash(id), o), seed), i + 1)), the Calibrate A scheme), so every configuration runs on the same
   random numbers. Nothing dated 2024 or later is simulated or scored, and 2026 is never read (backtest_dev.json holds none;
   the window filter drops 2024-25).

   Inputs are evalv's, leak-free: walk-forward as-of priors (mlcal_priors_asof.json[year]), out-of-fold learned rates
   (mlrates_oof.json), durability walk-forward records + the train NORM (tools/durrec.js), walk-forward SOS pairs with
   leave-one-year-out coefficients (tools/sosrec.js), embedding etas / oppadj / pre-UFC snapshots (tools/mlpathrec.js), each
   asserted applied on every matchup.

   Levers (one per target; durability.kdCal is held, so knockdowns have exactly one free scale per format):
     dyn.kdLevel3              knockdowns per 15 fight-minutes, 3-round fights        (2019-2023 backtest actuals)
     dyn.kdLevel5              knockdowns per 15 fight-minutes, 5-round fights        (same)
     dyn.convLevel             same-round strike finish by the man who scored a KD, per KD (dynamics.json kd_conversion
                               rate_train 0.512, the 2019-2023 round panel)
     dyn.stkoScale, gnpScale   one joint factor (their data ratio kept): the KO/TKO share of fights with an outcome (actuals)
     judge.t108                the card-implied 10-8 share of decision judge-rounds (judges' 10-8s + 3 x deduction points, as
                               tools/evalv.js counts it), 2021-2023 decisions: the judging regime v4 levelled to (train data
                               only; the 2019-2023 value is reported next to it)
   Checks (reported with event-cluster bootstrap intervals of the actuals; not levers): KD per 100 head landed by format, KD per
   100 standing head landed by round (trace sims vs dynamics.json targets_by_round.train), finish share by round (KO class and
   SUB) for 3 and 5 rounds, KO / SUB / DEC, decision split UD / SD / MD, draws, non-KD stoppage composition.

     nice -n 5 node tools/v5_calB_levels.js run [--params '{json}'] [--sims 60] [--trace 0] [--workers 3]
     nice -n 5 node tools/v5_calB_levels.js fit [--iters 6] [--sims 60] [--final-sims 200] [--trace 20] [--out data/derived/v5_calB_levels.json]
   fit: damped fixed point from the current params (src/params3.js as resolved by the engine), then one final run at
   --final-sims with --trace traced sims per fight and order for the by-round tables; writes the iteration history, the targets,
   the fitted levels and the check tables. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
const TRAIN = ["2019-01-01", "2024-01-01"];

function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
const readJSON = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
function trainFights() {
  const bt = readJSON("data/derived/backtest_dev.json");
  const out = bt.fights.filter((f) => f.date >= TRAIN[0] && f.date < TRAIN[1] && f.date < "2026-01-01");
  for (const f of out) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
  return out;
}
const KO_CLASS = { KO: 1, TKO: 1, GNP: 1, LEG: 1, DOC: 1, CORNER: 1 };
const STRIKE_FIN = { KO: 1, TKO: 1, GNP: 1, LEG: 1 };

// per-format accumulator (R = 3 or 5)
function newAcc() {
  const a = {};
  for (const R of [3, 5]) {
    a[R] = { n: 0, mins: 0, kd: 0, h: 0, sh: 0, sig: 0, td: 0, ctrl: 0, ko: new Array(R).fill(0), sub: new Array(R).fill(0), dec: 0, draw: 0,
      ud: 0, sd: 0, md: 0, decJR: 0, w108: 0, kdr: 0, kdrf: 0, nDed: 0,
      // traced sims only
      tn: 0, tkd: new Array(R).fill(0), tsh: new Array(R).fill(0), th: new Array(R).fill(0), treach: new Array(R).fill(0), tconv: 0, tkdN: 0,
      tkoEnd: 0, tstko: 0, tgtko: 0 };
  }
  return a;
}
function addAcc(a, b) {
  for (const R of [3, 5]) for (const k of Object.keys(a[R])) {
    if (Array.isArray(a[R][k])) for (let i = 0; i < a[R][k].length; i++) a[R][k][i] += b[R][k][i];
    else a[R][k] += b[R][k];
  }
}

// ================================================================== worker
if (!isMainThread) {
  const E = require(path.join(ROOT, "src/engine3.js"));
  const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT);
  const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);
  const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
  const fights = trainFights(), byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON("data/derived/mlrates_oof.json"), TN = OOF.meta.targets;
  const rates = (arr) => { const o = {}; TN.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  const ids = workerData.ids;
  parentPort.on("message", (msg) => {
    const acc = newAcc();
    let err = null, nMl = 0, nM = 0;
    try {
      for (const id of ids) {
        const f = byId.get(id), R = f.rounds === 5 ? 5 : 3, q = acc[R];
        for (let o = 0; o < 2; o++) {
          const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A, ent = OOF.fights[f.id];
          const params = JSON.parse(JSON.stringify(msg.params || {}));
          const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date,
            priors: priors[f.date.slice(0, 4)], params };
          opts.ml = ent && ent.A && ent.B ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false;
          DR.apply(opts, f.id, o === 1);
          if (SR.on(opts.params)) SR.apply(opts, f, o === 1);
          XR.apply(opts, f, o === 1, opts.params);
          const m = E.matchup(A, B, opts);
          DR.assertApplied(m, f.id, opts.params); SR.assertApplied(m, f.id, opts.params); XR.assertApplied(m, f.id, opts.params);
          nM++; if (m.mlApplied) nMl++;
          const s0 = mix(mix(hash32(f.id), o), msg.seed);
          for (let i = 0; i < msg.sims; i++) {
            const traced = i < msg.trace;
            const s = E.simulate(m, E.makeRng(mix(s0, i + 1)), traced);
            const meth = s.method, isDec = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW";
            q.n++;
            q.mins += isDec ? R * 5 : (s.round - 1) * 5 + s.t / 60;
            const r = Math.max(1, Math.min(R, s.round)) - 1;
            if (meth === "DRAW") q.draw++;
            if (isDec) {
              q.dec++;
              if (meth === "UD") q.ud++; else if (meth === "SD") q.sd++; else if (meth === "MD") q.md++;
              q.decJR += 3 * R; q.w108 += (s.n108 || 0) + 3 * (s.nDed || 0);
            } else if (meth === "SUB") q.sub[r]++; else q.ko[r]++;
            q.nDed += s.nDed || 0;
            const TA = s.totals.A, TB = s.totals.B;
            q.kd += TA.kd + TB.kd; q.h += TA.h_lnd + TB.h_lnd; q.sh += (TA.sh_lnd || 0) + (TB.sh_lnd || 0);
            q.sig += TA.sig_lnd + TB.sig_lnd; q.td += TA.td_lnd + TB.td_lnd; q.ctrl += TA.ctrl + TB.ctrl;
            q.kdr += s.kdr || 0; q.kdrf += s.kdrf || 0;
            if (traced) {
              q.tn++;
              const nr = s.rounds.length;
              for (const rr of s.rounds) {
                const rI = rr.r;
                q.treach[rI]++;
                for (const sd of ["A", "B"]) {
                  const st = rr.st[sd], o2 = sd === "A" ? "B" : "A";
                  q.tkd[rI] += st.kd; q.tsh[rI] += st.sh_lnd; q.th[rI] += st.h_lnd;
                  if (st.kd > 0) { q.tkdN += st.kd; if (rr.fin && rr.fin.by === sd && STRIKE_FIN[rr.fin.how]) q.tconv++; }
                  if (rr.fin && rr.fin.by === sd && st.kd === 0 && rr.st[o2].kd === 0) {
                    if (rr.fin.how === "TKO" && !rr.fin.follow) q.tstko++;
                    if (rr.fin.how === "GNP") q.tgtko++;
                  }
                }
                if (rr.fin && STRIKE_FIN[rr.fin.how]) q.tkoEnd++;
              }
              void nr;
            }
          }
        }
      }
    } catch (e) { err = String(e && e.stack || e); }
    parentPort.postMessage({ acc, err, nMl, nM });
  });
  return;
}

// ================================================================== main
const argv = process.argv.slice(2), MODE = argv[0] || "run";
const args = {};
argv.slice(1).forEach((a, i, arr) => { if (a.startsWith("--")) args[a.slice(2)] = arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true; });
const WORKERS = Math.max(1, Math.min(3, +(args.workers || 3))), SEED = +(args.seed || 1);
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const fights = trainFights();
const dyn = readJSON("data/derived/dynamics.json");

// ---------------------------------------------------------------- actual targets (train fights) with event-cluster bootstrap
const CLS = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DEC" };
function actualStats(sel) {
  const o = { 3: { kd: 0, mins: 0, h: 0, n: 0, ko: [0, 0, 0], sub: [0, 0, 0] }, 5: { kd: 0, mins: 0, h: 0, n: 0, ko: [0, 0, 0, 0, 0], sub: [0, 0, 0, 0, 0] },
    nOut: 0, ko: 0, sub: 0, dec: 0, draw: 0, ud: 0, sd: 0, md: 0, w108: 0, jr: 0, w108r: 0, jrr: 0 };
  for (const f of sel) {
    const R = f.rounds === 5 ? 5 : 3, q = o[R], a = f.actual, r = f.result || {};
    if (a && a.A && a.B && a.minutes) { q.kd += a.A.kd + a.B.kd; q.mins += a.minutes; q.h += a.A.h_lnd + a.B.h_lnd; }
    const c = CLS[r.method];
    if (!c || (r.method !== "DRAW" && r.winner !== "A" && r.winner !== "B")) continue;
    o.nOut++; q.n++;
    const rr = Math.min(R, Math.max(1, r.round || 1)) - 1;
    if (c === "KO") { o.ko++; q.ko[rr]++; } else if (c === "SUB") { o.sub++; q.sub[rr]++; } else o.dec++;
    if (r.method === "DRAW") o.draw++;
    if (r.method === "UD") o.ud++; else if (r.method === "SD") o.sd++; else if (r.method === "MD") o.md++;
    if (c === "DEC" && r.cards && r.cards.length === 3) {
      for (const cc of r.cards) {
        const rj = Math.max(1, Math.round((cc[0] + cc[1]) / 19)), w = Math.max(0, 19 * rj - (cc[0] + cc[1]));
        o.w108 += w; o.jr += rj;
        if (f.date >= "2021-01-01") { o.w108r += w; o.jrr += rj; }
      }
    }
  }
  return o;
}
function actualVec(o) {
  const v = {
    kd15_3: 15 * o[3].kd / o[3].mins, kd15_5: 15 * o[5].kd / o[5].mins,
    kd100h_3: 100 * o[3].kd / o[3].h, kd100h_5: 100 * o[5].kd / o[5].h, kd100h: 100 * (o[3].kd + o[5].kd) / (o[3].h + o[5].h),
    ko: o.ko / o.nOut, sub: o.sub / o.nOut, dec: o.dec / o.nOut, draw: o.draw / o.nOut,
    ud: o.ud / (o.ud + o.sd + o.md), sd: o.sd / (o.ud + o.sd + o.md), md: o.md / (o.ud + o.sd + o.md),
    r108: o.w108 / o.jr, r108_2123: o.w108r / o.jrr
  };
  for (const R of [3, 5]) for (let r = 0; r < R; r++) { v[`ko${R}_${r + 1}`] = o[R].ko[r] / o[R].n; v[`sub${R}_${r + 1}`] = o[R].sub[r] / o[R].n; v[`fin${R}_${r + 1}`] = (o[R].ko[r] + o[R].sub[r]) / o[R].n; }
  return v;
}
const ACT = actualVec(actualStats(fights));
const ACT_CI = (function () {
  const ev = new Map();
  for (const f of fights) { const k = f.event + "|" + f.date; if (!ev.has(k)) ev.set(k, []); ev.get(k).push(f); }
  const groups = [...ev.values()], NB = +(args.boot || 1000), draws = {};
  let st = 20261107;
  const rnd = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
  for (let b = 0; b < NB; b++) {
    const sel = []; for (let g = 0; g < groups.length; g++) sel.push(...groups[Math.floor(rnd() * groups.length)]);
    const v = actualVec(actualStats(sel));
    for (const k of Object.keys(v)) (draws[k] = draws[k] || []).push(v[k]);
  }
  const out = {};
  for (const k of Object.keys(draws)) { const d = draws[k].filter(isFinite).sort((a, b) => a - b); out[k] = [d[Math.floor(0.025 * d.length)], d[Math.floor(0.975 * d.length) - 1]]; }
  return out;
})();
const TB = dyn.targets_by_round.train;
ACT.conv = dyn.finish_hazard.kd_conversion.null.rate_train;
const convN = dyn.finish_hazard.kd_conversion.null.n_train, convSe = Math.sqrt(ACT.conv * (1 - ACT.conv) / convN);
ACT_CI.conv = [ACT.conv - 1.96 * convSe, ACT.conv + 1.96 * convSe];
for (const R of [3, 5]) for (let r = 0; r < R; r++) {
  const c = TB[R + "_" + (r + 1)];
  ACT[`kdsh${R}_${r + 1}`] = c.kd_per100_standing_head; const se = c.kd_per100_standing_head / Math.sqrt(c.n_kd);
  ACT_CI[`kdsh${R}_${r + 1}`] = [c.kd_per100_standing_head - 1.96 * se, c.kd_per100_standing_head + 1.96 * se];
}

function simVec(a) {
  const v = {};
  const t3 = a[3], t5 = a[5], n = t3.n + t5.n;
  v.kd15_3 = 15 * t3.kd / t3.mins; v.kd15_5 = 15 * t5.kd / t5.mins;
  v.kd100h_3 = 100 * t3.kd / t3.h; v.kd100h_5 = 100 * t5.kd / t5.h; v.kd100h = 100 * (t3.kd + t5.kd) / (t3.h + t5.h);
  const ko = t3.ko.reduce((x, y) => x + y, 0) + t5.ko.reduce((x, y) => x + y, 0), sub = t3.sub.reduce((x, y) => x + y, 0) + t5.sub.reduce((x, y) => x + y, 0);
  v.ko = ko / n; v.sub = sub / n; v.dec = (t3.dec + t5.dec) / n; v.draw = (t3.draw + t5.draw) / n;
  const nd = t3.ud + t3.sd + t3.md + t5.ud + t5.sd + t5.md;
  v.ud = (t3.ud + t5.ud) / nd; v.sd = (t3.sd + t5.sd) / nd; v.md = (t3.md + t5.md) / nd;
  v.r108 = (t3.w108 + t5.w108) / (t3.decJR + t5.decJR);
  v.conv = (t3.kdrf + t5.kdrf) / (t3.kd + t5.kd);
  for (const R of [3, 5]) for (let r = 0; r < R; r++) {
    v[`ko${R}_${r + 1}`] = a[R].ko[r] / a[R].n; v[`sub${R}_${r + 1}`] = a[R].sub[r] / a[R].n; v[`fin${R}_${r + 1}`] = (a[R].ko[r] + a[R].sub[r]) / a[R].n;
  }
  v.sig15 = 15 * (t3.sig + t5.sig) / 2 / (t3.mins + t5.mins); v.td15 = 15 * (t3.td + t5.td) / 2 / (t3.mins + t5.mins); v.ctrl15 = 15 * (t3.ctrl + t5.ctrl) / 2 / (t3.mins + t5.mins);
  if (t3.tn + t5.tn > 0) {
    for (const R of [3, 5]) for (let r = 0; r < R; r++) v[`kdsh${R}_${r + 1}`] = 100 * a[R].tkd[r] / Math.max(1, a[R].tsh[r]);
    v.convTrace = (t3.tconv + t5.tconv) / Math.max(1, t3.tkdN + t5.tkdN);
    v.stkoNoKd = (t3.tstko + t5.tstko) / Math.max(1, t3.tkoEnd + t5.tkoEnd); v.gtkoNoKd = (t3.tgtko + t5.tgtko) / Math.max(1, t3.tkoEnd + t5.tkoEnd);
  }
  return v;
}

// ---------------------------------------------------------------- worker pool
const ids = fights.map((f) => f.id);
const parts = Array.from({ length: WORKERS }, () => []);
// interleave 5-round fights evenly
ids.forEach((id, i) => parts[i % WORKERS].push(id));
const pool = parts.map((p) => new Worker(__filename, { workerData: { ids: p } }));
function runCfg(params, sims, trace) {
  return Promise.all(pool.map((w) => new Promise((res, rej) => {
    w.once("message", res); w.once("error", rej);
    w.postMessage({ params, sims, trace: trace || 0, seed: SEED });
  }))).then((outs) => {
    const a = newAcc(); let nMl = 0, nM = 0;
    for (const o of outs) { if (o.err) throw new Error(o.err); addAcc(a, o.acc); nMl += o.nMl; nM += o.nM; }
    return { acc: a, vec: simVec(a), mlShare: nMl / nM };
  });
}
const f4 = (x) => (x == null || !isFinite(x) ? "-" : x.toFixed(4));
const pc = (x) => (x == null || !isFinite(x) ? "-" : (100 * x).toFixed(2));
function line(lab, v) {
  return `${lab}: KD/15 3rd ${f4(v.kd15_3)} (${f4(ACT.kd15_3)}) 5rd ${f4(v.kd15_5)} (${f4(ACT.kd15_5)}) | KD/100h ${f4(v.kd100h)} (${f4(ACT.kd100h)}) | conv ${f4(v.conv)} (${f4(ACT.conv)}) | ` +
    `KO ${pc(v.ko)} (${pc(ACT.ko)}) SUB ${pc(v.sub)} (${pc(ACT.sub)}) DEC ${pc(v.dec)} | 10-8 ${pc(v.r108)} (${pc(ACT.r108_2123)}; all ${pc(ACT.r108)}) MD ${pc(v.md)} (${pc(ACT.md)}) draw ${pc(v.draw)} (${pc(ACT.draw)})`;
}

// current effective levels (src/params3.js as resolved with the default flags)
function current() {
  const p = E.resolveParams({});
  return { kdLevel3: p.dyn.kdLevel3, kdLevel5: p.dyn.kdLevel5, convLevel: p.dyn.convLevel, stkoScale: p.dyn.stkoScale, gnpScale: p.dyn.gnpScale, t108: p.judge.t108 };
}
function overrideOf(L, extra) {
  const o = JSON.parse(JSON.stringify(extra || {}));
  o.dyn = Object.assign({}, o.dyn || {}, { kdLevel3: L.kdLevel3, kdLevel5: L.kdLevel5, convLevel: L.convLevel, stkoScale: L.stkoScale, gnpScale: L.gnpScale });
  o.judge = Object.assign({}, o.judge || {}, { t108: L.t108 });
  return o;
}
const odds = (p) => p / (1 - p), logit = (p) => Math.log(p / (1 - p));

(async function main() {
  const t0 = Date.now();
  const extra = args.params ? JSON.parse(args.params) : {};
  console.log(`v5_calB_levels ${MODE}: ${fights.length} train fights x 2 orders, engine ${E.VERSION}, params ${FP.version}, ${WORKERS} workers`);
  if (MODE === "run") {
    const r = await runCfg(extra, +(args.sims || 60), +(args.trace || 0));
    console.log(line("run", r.vec));
    console.log(JSON.stringify({ sim: r.vec, actual: ACT, ml: r.mlShare }, null, 0));
  } else if (MODE === "fit") {
    const ITERS = +(args.iters || 6), SIMS = +(args.sims || 60), FSIMS = +(args["final-sims"] || 200), TRACE = +(args.trace || 20);
    const L = Object.assign(current(), args.start ? JSON.parse(args.start) : {});
    const hist = [];
    let prevT = null, prevR = null;
    for (let it = 0; it < ITERS; it++) {
      const r = await runCfg(overrideOf(L, extra), SIMS, 0), v = r.vec;
      hist.push({ it, levels: Object.assign({}, L), sim: v });
      console.log(line(`iter ${it}`, v));
      console.log("   levels " + JSON.stringify(Object.fromEntries(Object.entries(L).map(([k, x]) => [k, +x.toFixed(4)]))) + ` (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
      if (it === ITERS - 1) break;
      L.kdLevel3 *= ACT.kd15_3 / v.kd15_3;
      L.kdLevel5 *= Math.pow(ACT.kd15_5 / v.kd15_5, 0.8);
      L.convLevel *= Math.pow(odds(ACT.conv) / odds(v.conv), 1.2);
      const fk = Math.pow(ACT.ko / v.ko, 2.5);               // non-KD stoppages are about a third of KO/TKOs
      L.stkoScale *= fk; L.gnpScale *= fk;
      // t108: secant on logit(10-8 share); first step from a slope guess of -0.9 logit per unit of threshold
      const g = logit(v.r108) - logit(ACT.r108_2123);
      let slope = -0.9;
      if (prevT != null && Math.abs(L.t108 - prevT) > 1e-6) { const s = (logit(v.r108) - prevR) / (L.t108 - prevT); if (s < -0.05 && s > -5) slope = s; }
      prevT = L.t108; prevR = logit(v.r108);
      L.t108 = L.t108 - g / slope;
    }
    const fin = await runCfg(overrideOf(L, extra), FSIMS, TRACE);
    const base = await runCfg(extra, FSIMS, TRACE);
    console.log(line("final", fin.vec));
    console.log(line("before", base.vec));
    const out = {
      meta: { tool: "tools/v5_calB_levels.js", built: new Date().toISOString(), window: TRAIN, n_fights: fights.length, iters: ITERS, sims_iter: SIMS,
        sims_final: FSIMS, traced_final: TRACE, seed: SEED, engine_version: E.VERSION, params_version: FP.version, ml_applied_share: fin.mlShare,
        inputs: "as-of priors, OOF learned rates, durrec, sosrec, mlpathrec (asserted)", extra },
      before: current(), levels: L, history: hist, actual: ACT, actual_ci: ACT_CI, sim_final: fin.vec, sim_before: base.vec,
      acc_final: fin.acc, acc_before: base.acc
    };
    const OUT = args.out || "data/derived/v5_calB_levels.json";
    fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 1));
    console.log("FINAL " + JSON.stringify(Object.fromEntries(Object.entries(L).map(([k, x]) => [k, +x.toFixed(5)]))) + ` -> ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  await Promise.all(pool.map((w) => w.terminate()));
})().catch((e) => { console.error(e); process.exit(1); });
