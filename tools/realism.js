#!/usr/bin/env node
/* realism.js: realism validation of any fight-engine version against real fights (realism_sens component, roadmap v10).

   Every backtest fight of the chosen years is simulated in both corner orders from leak-free inputs: the frozen walk-forward
   snapshots in backtest_dev.json, the walk-forward division priors (mlcal_priors_asof.json: 5 years before Jan 1 of the
   fight's year) and, when the engine takes learned rates, the out-of-fold tables in mlrates_oof.json (each fight's year held
   out of training). Each simulated fight gets its own seed (fight id x corner order x sim index), so two configurations see
   common random numbers. The simulated fights are compared with the real ones per division and per format.

   Modes
     report    division / format realism tables: method shares, method by round, finish timing within rounds, stat lines per
               15 minutes, KD per landed head strike, control, decision split, and predictive calibration (PIT) of the
               per-fight stat lines. Markdown on stdout (and --md file), everything in --json.
     fit       fits the realism_sens factors params.realism.div[division] (--levers, default ko,sub,kd) and, with --fmt,
               fmt["5"] (--fmt-levers, default ko,sub,kd: 5-round fights pooled, prior sd 0.2) on the chosen years:
               empirical-Bayes shrunk real/simulated ratios become targets, then damped multiplicative fixed-point steps on
               the engine levers (ko -> KO share, sub -> SUB share, kd -> KD per landed head strike, att -> sig attempts
               per minute, td -> TD attempts per 15, ctrl -> control per 15). Writes --out factors.json and prints before /
               after tables.
     compare   flag off vs flag on (params.components.realism_sens; --factors file overrides params.realism.div / fmt):
               winner log loss, soft-label cross-entropy vs the closing line (market.json p_power_close), 7-bin log loss,
               method log loss, stat-line deviance and the base-rate table, each with paired event-cluster bootstrap CIs.
               --perfight file keeps the per-fight contributions (for pooling folds with `pool`).
     pool      pools --in a.json,b.json,... per-fight files (e.g. leave-one-year-out folds) and bootstraps them as one set.
     disp      over-dispersion phi of each per-fight stat against the out-of-fold learned rates (no simulation); the values
               feed params.realism.disp (FightEngine.rateSd, the profile-rate sds of FightEngine.sensitivity).

   Common options
     --engine src/engine3.js --params src/params3.js           any engine version (UMD/CommonJS FightEngine + FightParams)
     --backtest data/derived/backtest_dev.json --priors data/derived/mlcal_priors_asof.json
     --oof data/derived/mlrates_oof.json | none                 out-of-fold learned rates (ignored by engines without them)
     --market data/derived/market.json
     --years 2019-2023 | 2019,2021                              default 2019-2023 (training years)
     --sims 200                                                 per fight, half in each corner order
     --workers 3 --seed 1 --flag on|off|asis --set path=value[,path=value]   (--set is applied to opts.params)
     --json out.json --md out.md --boot 2000

   Hidden-data protocol (docs/BACKLOG.md): fights dated 2026-01-01 or later are dropped on load whatever file is given, and
   years after 2023 need --unledgered-val (validation years are for version selection only). */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const VAULT_FROM = "2026-01-01";
const DIVS = ["Flyweight", "Bantamweight", "Featherweight", "Lightweight", "Welterweight", "Middleweight", "Light Heavyweight",
  "Heavyweight", "Women's Strawweight", "Women's Flyweight", "Women's Bantamweight", "Women's Featherweight"];
const DIV_SHORT = { "Flyweight": "FLW", "Bantamweight": "BW", "Featherweight": "FW", "Lightweight": "LW", "Welterweight": "WW",
  "Middleweight": "MW", "Light Heavyweight": "LHW", "Heavyweight": "HW", "Women's Strawweight": "W-SW", "Women's Flyweight": "W-FLW",
  "Women's Bantamweight": "W-BW", "Women's Featherweight": "W-FW" };
// per-side stats summed in the simulation (data has all but h_att, d/c/g landed)
const ST = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "d_lnd", "c_lnd", "g_lnd"];
const NST = ST.length, SI = {};
ST.forEach((k, i) => { SI[k] = i; });
const DATA_ST = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att"];
const PIT = ["sig_lnd", "sig_att", "h_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att"];
const NPIT = PIT.length;
const MAXR = 5;
// per-task record (one fight, one corner order), already in the data's orientation
const R_N = 0, R_BIN = 1, R_KOR = R_BIN + 7, R_SUBR = R_KOR + MAXR, R_DEC = R_SUBR + MAXR, R_FT = R_DEC + 4, R_FTS = R_FT + 6,
  R_ST = R_FTS + 1, R_SQ = R_ST + 2 * NST, R_MIN = R_SQ + 2 * NST, R_PIT = R_MIN + 1, R_PITM = R_PIT + 4 * NPIT, R_ERR = R_PITM + 2,
  REC = R_ERR + 1;

// ------------------------------------------------------------------ utilities
function absPath(p) { return path.isAbsolute(p) ? p : path.join(ROOT, p); }
function readJSON(p) { return JSON.parse(fs.readFileSync(absPath(p), "utf8")); }
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2), v = argv[i + 1]; if (v == null || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; } }
    else o._.push(a);
  }
  return o;
}
function setPath(o, p, v) {
  const ss = p.split(".");
  for (let i = 0; i < ss.length - 1; i++) { if (o[ss[i]] == null || typeof o[ss[i]] !== "object") o[ss[i]] = {}; o = o[ss[i]]; }
  o[ss[ss.length - 1]] = v;
}
function parseYears(s) {
  if (!s) return [2019, 2020, 2021, 2022, 2023];
  const out = [];
  for (const part of String(s).split(",")) {
    const m = part.match(/^(\d{4})-(\d{4})$/);
    if (m) { for (let y = +m[1]; y <= +m[2]; y++) out.push(y); } else out.push(+part);
  }
  return out;
}
const f1 = (x, d = 1) => (x == null || !isFinite(x) ? "-" : (+x).toFixed(d));
const pc = (x, d = 1) => (x == null || !isFinite(x) ? "-" : (100 * x).toFixed(d));

function resultBin(r) {      // data orientation: 0 A KO/TKO, 1 A sub, 2 A dec, 3 draw, 4 B dec, 5 B sub, 6 B KO/TKO; -1 = not scored
  if (r.winner === "D" || r.method === "DRAW") return 3;
  if (r.winner !== "A" && r.winner !== "B") return -1;
  if (r.method === "DQ" || r.method === "NC" || r.method === "CNC") return -1;
  const k = r.method === "SUB" ? 1 : (r.method === "UD" || r.method === "SD" || r.method === "MD") ? 2 : 0;
  return r.winner === "A" ? k : 6 - k;
}

// ------------------------------------------------------------------ data
function loadFights(o) {
  const bt = readJSON(o.backtest), PA = readJSON(o.priors), keys = bt.meta && bt.meta.keys;
  const OOF = o.oof && o.oof !== "none" && fs.existsSync(absPath(o.oof)) ? readJSON(o.oof) : null;
  const MKT = o.market && o.market !== "none" && fs.existsSync(absPath(o.market)) ? readJSON(o.market) : null;
  const years = new Set(o.years);
  if ([...years].some((y) => y >= 2024) && !o.unledgeredVal)
    throw new Error("realism: years after 2023 are validation years (version selection only); pass --unledgered-val for a code check");
  const T = OOF ? OOF.meta.targets : null;
  const toObj = (a) => { const r = {}; T.forEach((k, i) => { r[k] = a[i]; }); return r; };
  const out = [];
  let vault = 0, noRes = 0, noOof = 0;
  for (const f of bt.fights) {
    if (!(f.date < VAULT_FROM)) { vault++; continue; }
    if (!years.has(+f.date.slice(0, 4))) continue;
    const bin = resultBin(f.result);
    if (bin < 0) { noRes++; continue; }
    const yr = f.date.slice(0, 4), pri = PA[yr];
    if (!pri) throw new Error("realism: no walk-forward priors for " + yr);
    const generic = f.division === "Catch Weight" || f.division === "Open Weight" || !pri[f.division];
    const division = generic ? (f.prior_division || f.division) : f.division;
    const r = f.result, act = f.actual && f.actual.A && f.actual.B ? f.actual : null;
    const oof = OOF && OOF.fights[f.id] ? OOF.fights[f.id] : null;
    if (OOF && !oof) noOof++;
    const mk = MKT && MKT.fights[f.id] ? MKT.fights[f.id] : null;
    const rounds = f.rounds || (f.title ? 5 : 3);
    out.push({
      id: f.id, date: f.date, year: yr, event: f.event || f.date, division, divRaw: f.division, rounds, title: !!f.title,
      fmt: rounds === 5 ? (f.title ? "5-title" : "5-non-title") : "3",
      A: Object.assign({}, f.A, keys ? { keys } : {}), B: Object.assign({}, f.B, keys ? { keys } : {}),
      ml: oof ? { A: toObj(oof.A), B: toObj(oof.B) } : null, mlSrc: oof ? oof.src : null,
      close: mk && mk.p_power_close != null ? +mk.p_power_close : null,
      real: { bin, method: r.method, round: r.round || rounds, time_s: r.time_s != null ? +r.time_s : 300,
        minutes: act && act.minutes > 0 ? +act.minutes : (r.fight_s ? r.fight_s / 60 : null), A: act ? act.A : null, B: act ? act.B : null }
    });
  }
  return { fights: out, PA, vault, noRes, noOof, hasOof: !!OOF, hasMkt: !!MKT };
}

// ------------------------------------------------------------------ worker
function workerMain() {
  const { enginePath, paramsPath, priors, fights } = workerData;
  const E = require(enginePath);
  require(paramsPath);
  // engine v5 (merge step 3): leak-free durability records + train NORM (tools/durrec.js) and walk-forward SOS pairs
  // (tools/sosrec.js; leave-one-year-out coefficients before 2024) for every backtest fight; without them durability falls
  // back to the live fit (2008..2026-10) and SOS runs neutral. Both are no-ops for engines without those components.
  const DR = require(path.join(__dirname, "durrec.js"))(E, path.join(__dirname, ".."));
  const SR = require(path.join(__dirname, "sosrec.js"))(E, path.join(__dirname, ".."));
  const caches = new Map();
  const isDec = (f) => f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW";
  function build(f, swap, tree, useMl) {
    const A = swap ? f.B : f.A, B = swap ? f.A : f.B;
    const o = { division: f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.year] };
    if (tree) o.params = tree;
    if (useMl && f.ml) o.ml = swap ? { A: f.ml.B, B: f.ml.A } : { A: f.ml.A, B: f.ml.B };
    else if (useMl === false) o.ml = false;
    if (DR.on(o.params)) DR.apply(o, f.id, !!swap);
    if (SR.on(o.params)) SR.apply(o, f, !!swap);
    const m = E.matchup(A, B, o);
    DR.assertApplied(m, f.id, tree); SR.assertApplied(m, f.id, tree);
    return m;
  }
  parentPort.on("message", (msg) => {
    if (msg.type !== "run") return;
    const { key, tree, sims, seed, tasks, useMl } = msg;
    let cache = caches.get(key);
    if (!cache) { cache = new Map(); caches.set(key, cache); if (caches.size > 3) caches.delete(caches.keys().next().value); }
    const out = new Float64Array(tasks.length * REC), errors = [];
    const simA = new Float64Array(sims * NST), simB = new Float64Array(sims * NST), simMin = new Float64Array(sims);
    for (let ti = 0; ti < tasks.length; ti++) {
      const t = tasks[ti], f = fights[t.fi], o = ti * REC, sw = t.swap;
      let m = cache.get(ti);
      if (!m) {
        try { m = build(f, sw, tree, useMl); } catch (e) { if (errors.length < 5) errors.push(String(e && e.message || e)); out[o + R_ERR] = 1; continue; }
        cache.set(ti, m);
      }
      const base = mix(mix(hash32(f.id), seed >>> 0), sw ? 0xabcdef : 0x123457);
      let n = 0;
      for (let k = 0; k < sims; k++) {
        let s;
        try { s = E.simulate(m, E.makeRng(mix(base, k + 1)), false); } catch (e) { if (errors.length < 5) errors.push(String(e && e.message || e)); out[o + R_ERR] = 1; break; }
        let b = E.bucket(s);
        if (sw) b = 6 - b;
        out[o + R_BIN + b]++;
        const dec = isDec(s), rd = s.round;
        if (dec) out[o + R_DEC + ({ UD: 0, SD: 1, MD: 2, DRAW: 3 })[s.method]]++;
        else {
          if (s.method === "SUB") out[o + R_SUBR + rd - 1]++; else out[o + R_KOR + rd - 1]++;
          out[o + R_FT + Math.min(5, Math.floor(s.t / 50))]++; out[o + R_FTS] += s.t;
        }
        const TA = sw ? s.totals.B : s.totals.A, TB = sw ? s.totals.A : s.totals.B;
        const mins = dec ? s.round * 5 : (rd - 1) * 5 + s.t / 60;
        for (let q = 0; q < NST; q++) {
          const a = +TA[ST[q]] || 0, bb = +TB[ST[q]] || 0;
          out[o + R_ST + q] += a; out[o + R_ST + NST + q] += bb;
          out[o + R_SQ + q] += a * a; out[o + R_SQ + NST + q] += bb * bb;
          simA[k * NST + q] = a; simB[k * NST + q] = bb;
        }
        out[o + R_MIN] += mins; simMin[k] = mins;
        n++;
      }
      out[o + R_N] = n;
      // PIT pieces: how many sims fall below / equal to the real value (per side and stat, and fight minutes)
      const rA = f.real.A, rB = f.real.B;
      if (rA && rB && n > 0) {
        for (let q = 0; q < NPIT; q++) {
          const qi = SI[PIT[q]], ya = +rA[PIT[q]], yb = +rB[PIT[q]];
          let la = 0, ea = 0, lb = 0, eb = 0;
          for (let k = 0; k < n; k++) {
            const a = simA[k * NST + qi], bb = simB[k * NST + qi];
            if (a < ya - 1e-9) la++; else if (Math.abs(a - ya) <= 1e-9 + (PIT[q] === "ctrl" ? 0.5 : 0)) ea++;
            if (bb < yb - 1e-9) lb++; else if (Math.abs(bb - yb) <= 1e-9 + (PIT[q] === "ctrl" ? 0.5 : 0)) eb++;
          }
          out[o + R_PIT + 4 * q] = la; out[o + R_PIT + 4 * q + 1] = ea; out[o + R_PIT + 4 * q + 2] = lb; out[o + R_PIT + 4 * q + 3] = eb;
        }
        if (f.real.minutes != null) {
          const ym = f.real.minutes; let lm = 0, em = 0;
          for (let k = 0; k < n; k++) { if (simMin[k] < ym - 0.02) lm++; else if (Math.abs(simMin[k] - ym) <= 0.02) em++; }
          out[o + R_PITM] = lm; out[o + R_PITM + 1] = em;
        }
      }
    }
    parentPort.postMessage({ type: "res", key, rec: out, errors: errors.length ? errors : null }, [out.buffer]);
  });
}

// ------------------------------------------------------------------ pool
class Pool {
  constructor(o, fights, PA) {
    this.n = Math.max(1, Math.min(o.workers, 3));
    const slim = fights.map((f) => ({ id: f.id, year: f.year, date: f.date, division: f.division, rounds: f.rounds, title: f.title, A: f.A, B: f.B,
      ml: f.ml, real: { minutes: f.real.minutes, A: f.real.A, B: f.real.B } }));
    const years = {}; for (const f of fights) years[f.year] = PA[f.year];
    this.tasks = [];
    fights.forEach((f, fi) => { this.tasks.push({ fi, swap: false }); this.tasks.push({ fi, swap: true }); });
    this.groups = Array.from({ length: this.n }, () => []);
    this.tasks.forEach((t, i) => this.groups[i % this.n].push(i));
    this.workers = this.groups.map(() => new Worker(__filename, { workerData: { enginePath: absPath(o.engine), paramsPath: absPath(o.params), priors: years, fights: slim } }));
  }
  run(key, tree, sims, seed, useMl) {
    const out = new Float64Array(this.tasks.length * REC), errs = [];
    return Promise.all(this.workers.map((w, wi) => new Promise((res, rej) => {
      const onMsg = (m) => {
        if (m.type !== "res" || m.key !== key) return;
        w.off("message", onMsg); w.off("error", rej);
        const g = this.groups[wi];
        for (let j = 0; j < g.length; j++) out.set(m.rec.subarray(j * REC, (j + 1) * REC), g[j] * REC);
        if (m.errors) errs.push(...m.errors);
        res();
      };
      w.on("message", onMsg); w.once("error", rej);
      w.postMessage({ type: "run", key, tree, sims, seed, useMl, tasks: this.groups[wi].map((i) => this.tasks[i]) });
    }))).then(() => {
      // merge the two corner orders into one record per fight
      const nf = this.tasks.length / 2, rec = new Float64Array(nf * REC);
      for (let ti = 0; ti < this.tasks.length; ti++) {
        const t = this.tasks[ti], a = t.fi * REC, o = ti * REC;
        for (let k = 0; k < REC; k++) rec[a + k] += out[o + k];
      }
      return { rec, errors: errs };
    });
  }
  close() { return Promise.all(this.workers.map((w) => w.terminate())); }
}

// ------------------------------------------------------------------ per-fight quantities (sim and real)
function realOf(f) {
  const r = f.real, b = r.bin;
  const o = { ko: b === 0 || b === 6 ? 1 : 0, sub: b === 1 || b === 5 ? 1 : 0, dec: b === 2 || b === 4 ? 1 : 0, draw: b === 3 ? 1 : 0, bin: b };
  o.finRound = o.ko || o.sub ? r.round : 0;
  o.finT = o.ko || o.sub ? r.time_s : null;
  o.decType = o.dec ? r.method : (o.draw ? "DRAW" : null);
  o.minutes = r.minutes;
  o.st = null;
  if (r.A && r.B) {
    o.st = {};
    for (const k of DATA_ST) o.st[k] = (+r.A[k] || 0) + (+r.B[k] || 0);
    o.sideA = r.A; o.sideB = r.B;
  }
  return o;
}

function simOf(rec, i) {
  const a = i * REC, N = rec[a + R_N];
  if (!(N > 0) || rec[a + R_ERR]) return null;
  const o = { N, bins: [], koR: [], subR: [], dec: [], ft: [], st: {}, sq: {}, stA: {}, stB: {} };
  for (let k = 0; k < 7; k++) o.bins.push(rec[a + R_BIN + k] / N);
  for (let r = 0; r < MAXR; r++) { o.koR.push(rec[a + R_KOR + r] / N); o.subR.push(rec[a + R_SUBR + r] / N); }
  for (let k = 0; k < 4; k++) o.dec.push(rec[a + R_DEC + k] / N);
  for (let k = 0; k < 6; k++) o.ft.push(rec[a + R_FT + k] / N);
  o.ftSum = rec[a + R_FTS] / N;
  o.ko = o.bins[0] + o.bins[6]; o.sub = o.bins[1] + o.bins[5]; o.decS = o.bins[2] + o.bins[4]; o.draw = o.bins[3];
  for (let q = 0; q < NST; q++) {
    const sa = rec[a + R_ST + q] / N, sb = rec[a + R_ST + NST + q] / N;
    o.stA[ST[q]] = sa; o.stB[ST[q]] = sb; o.st[ST[q]] = sa + sb;
    o.sq[ST[q]] = [rec[a + R_SQ + q] / N - sa * sa, rec[a + R_SQ + NST + q] / N - sb * sb];   // within-fight predictive variances
  }
  o.minutes = rec[a + R_MIN] / N;
  o.pit = {};
  for (let q = 0; q < NPIT; q++) {
    const la = rec[a + R_PIT + 4 * q], ea = rec[a + R_PIT + 4 * q + 1], lb = rec[a + R_PIT + 4 * q + 2], eb = rec[a + R_PIT + 4 * q + 3];
    o.pit[PIT[q]] = [(la + 0.5 * ea) / N, (lb + 0.5 * eb) / N];
  }
  o.pitMin = (rec[a + R_PITM] + 0.5 * rec[a + R_PITM + 1]) / N;
  return o;
}

// ------------------------------------------------------------------ group tables
function groupStats(fights, sims, idx) {
  // idx: fight indices in the group. Returns { n, real: {...}, sim: {...}, se: {...} }
  const n = idx.length;
  const R = { ko: 0, sub: 0, dec: 0, draw: 0, koR: [0, 0, 0, 0, 0], subR: [0, 0, 0, 0, 0], decT: { UD: 0, SD: 0, MD: 0 }, ft: [0, 0, 0, 0, 0, 0], ftSum: 0, nFin: 0,
    st: {}, min: 0, nSt: 0, ctrlBig: 0, nSides: 0 };
  const S = { ko: 0, sub: 0, dec: 0, draw: 0, koR: [0, 0, 0, 0, 0], subR: [0, 0, 0, 0, 0], decT: { UD: 0, SD: 0, MD: 0 }, ft: [0, 0, 0, 0, 0, 0], ftSum: 0, nFin: 0,
    st: {}, min: 0, pvar: {}, nOk: 0 };
  for (const k of ST) { R.st[k] = 0; S.st[k] = 0; S.pvar[k] = 0; }
  const pit = {}; for (const k of PIT) pit[k] = { s: 0, in80: 0, n: 0, lo10: 0, hi10: 0 };
  const pitMin = { s: 0, in80: 0, n: 0, lo10: 0, hi10: 0 };
  // stat-line dispersion: real per-fighter sig landed / min across fights vs the simulated predictive spread
  let rSig = [], sSigMean = [], sSigVar = 0;
  for (const i of idx) {
    const f = fights[i], r = realOf(f), s = sims[i];
    R.ko += r.ko; R.sub += r.sub; R.dec += r.dec; R.draw += r.draw;
    if (r.finRound) { (r.ko ? R.koR : R.subR)[r.finRound - 1]++; R.ft[Math.min(5, Math.floor(r.finT / 50))]++; R.ftSum += r.finT; R.nFin++; }
    if (r.decType && R.decT[r.decType] != null) R.decT[r.decType]++;
    if (r.st && r.minutes) {
      for (const k of DATA_ST) R.st[k] += r.st[k];
      R.min += r.minutes; R.nSt++;
      for (const sd of [r.sideA, r.sideB]) { R.nSides++; if (+sd.ctrl >= 120) R.ctrlBig++; rSig.push(+sd.sig_lnd / r.minutes); }
    }
    if (!s) continue;
    S.nOk++;
    S.ko += s.ko; S.sub += s.sub; S.dec += s.decS; S.draw += s.draw;
    for (let q = 0; q < MAXR; q++) { S.koR[q] += s.koR[q]; S.subR[q] += s.subR[q]; }
    S.decT.UD += s.dec[0]; S.decT.SD += s.dec[1]; S.decT.MD += s.dec[2];
    for (let q = 0; q < 6; q++) S.ft[q] += s.ft[q];
    S.ftSum += s.ftSum; S.nFin += s.ko + s.sub;
    if (r.st && r.minutes) {
      for (const k of ST) { S.st[k] += s.st[k]; S.pvar[k] += s.sq[k][0] + s.sq[k][1]; }
      S.min += s.minutes;
      sSigMean.push(s.stA.sig_lnd / Math.max(1e-9, s.minutes), s.stB.sig_lnd / Math.max(1e-9, s.minutes));
      for (const k of PIT) for (const v of s.pit[k]) {
        const P = pit[k]; P.s += v; P.n++; if (v >= 0.1 && v <= 0.9) P.in80++; if (v < 0.1) P.lo10++; if (v > 0.9) P.hi10++;
      }
      if (r.minutes != null) { const v = s.pitMin; pitMin.s += v; pitMin.n++; if (v >= 0.1 && v <= 0.9) pitMin.in80++; if (v < 0.1) pitMin.lo10++; if (v > 0.9) pitMin.hi10++; }
    }
  }
  const m15 = (x, mins) => 15 * x / Math.max(1e-9, 2 * mins);     // per fighter per 15 minutes
  const mk = (G, isReal) => {
    const nn = isReal ? n : Math.max(1, G.nOk), mins = G.min;
    const decs = G.decT.UD + G.decT.SD + G.decT.MD;
    const o = {
      ko: G.ko / nn, sub: G.sub / nn, dec: G.dec / nn, draw: G.draw / nn,
      koR: G.koR.map((x) => x / nn), subR: G.subR.map((x) => x / nn),
      ud: G.decT.UD / Math.max(1e-9, decs), split: (G.decT.SD + G.decT.MD) / Math.max(1e-9, decs),
      ftMean: G.ftSum / Math.max(1e-9, G.nFin), ft: G.ft.map((x) => x / Math.max(1e-9, G.nFin)),
      sigL15: m15(G.st.sig_lnd, mins), sigA15: m15(G.st.sig_att, mins), acc: G.st.sig_lnd / Math.max(1e-9, G.st.sig_att),
      head: G.st.h_lnd / Math.max(1e-9, G.st.h_lnd + G.st.b_lnd + G.st.l_lnd), leg: G.st.l_lnd / Math.max(1e-9, G.st.h_lnd + G.st.b_lnd + G.st.l_lnd),
      kd15: m15(G.st.kd, mins), kdPerH: 100 * G.st.kd / Math.max(1e-9, G.st.h_lnd),
      td15: m15(G.st.td_lnd, mins), tdA15: m15(G.st.td_att, mins), tdAcc: G.st.td_lnd / Math.max(1e-9, G.st.td_att),
      ctrl15: m15(G.st.ctrl, mins), sub15: m15(G.st.sub_att, mins), minutes: mins / Math.max(1, isReal ? G.nSt : G.nOk)
    };
    if (isReal) o.ctrlBig = G.ctrlBig / Math.max(1, G.nSides);
    return o;
  };
  const real = mk(R, true), sim = mk(S, false);
  // spread of per-fighter sig landed per minute: real across fights vs simulated (across fights + within-fight predictive)
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  const sdv = (a) => { const mu = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - mu) * (y - mu), 0) / Math.max(1, a.length - 1)); };
  real.sigPerMinSd = sdv(rSig);
  // within-fight predictive variance of sig landed per minute (approximation: per-fight count variance / minutes^2)
  sim.sigPerMinSd = Math.sqrt(sdv(sSigMean) ** 2 + (S.pvar.sig_lnd / Math.max(1, 2 * S.nOk)) / Math.max(1e-9, (S.min / Math.max(1, S.nOk)) ** 2));
  const pitOut = {};
  for (const k of PIT) { const P = pit[k]; pitOut[k] = { mean: P.s / Math.max(1, P.n), in80: P.in80 / Math.max(1, P.n), lo10: P.lo10 / Math.max(1, P.n), hi10: P.hi10 / Math.max(1, P.n) }; }
  pitOut.minutes = { mean: pitMin.s / Math.max(1, pitMin.n), in80: pitMin.in80 / Math.max(1, pitMin.n), lo10: pitMin.lo10 / Math.max(1, pitMin.n), hi10: pitMin.hi10 / Math.max(1, pitMin.n) };
  // z-scores of the real-vs-sim gap on the shares (binomial se of the real share at the simulated rate)
  const z = {};
  for (const k of ["ko", "sub", "dec"]) { const p = clip(sim[k], 1e-4, 1 - 1e-4); z[k] = (real[k] - sim[k]) / Math.sqrt(p * (1 - p) / Math.max(1, n)); }
  return { n, real, sim, pit: pitOut, z };
}

function groupsOf(fights) {
  const g = { ALL: [] };
  fights.forEach((f, i) => {
    g.ALL.push(i);
    (g["div:" + f.division] = g["div:" + f.division] || []).push(i);
    (g["fmt:" + f.fmt] = g["fmt:" + f.fmt] || []).push(i);
    (g["rounds:" + f.rounds] = g["rounds:" + f.rounds] || []).push(i);
  });
  return g;
}

function tables(fights, sims, title) {
  const G = groupsOf(fights), rows = {};
  for (const k of Object.keys(G)) rows[k] = groupStats(fights, sims, G[k]);
  const divKeys = DIVS.filter((d) => rows["div:" + d]).map((d) => "div:" + d);
  const fmtKeys = ["fmt:3", "fmt:5-non-title", "fmt:5-title"].filter((k) => rows[k]);
  const order = ["ALL"].concat(fmtKeys, divKeys);
  const name = (k) => (k === "ALL" ? "All" : k.startsWith("div:") ? DIV_SHORT[k.slice(4)] || k.slice(4) : k.startsWith("fmt:") ? (k === "fmt:3" ? "3-rd" : k.slice(4).replace("5-", "5-rd ")) : k);
  const L = [];
  const zf = (z) => (Math.abs(z) >= 2 ? (z > 0 ? " ▲" : " ▼") : "");
  L.push("## " + title);
  L.push("");
  L.push("Real vs simulated (sim = engine, both corner orders). ▲/▼ = real share more than 2 binomial se above / below the simulated share.");
  L.push("");
  L.push("### Method shares");
  L.push("");
  L.push("| Group | n | KO/TKO real | sim | SUB real | sim | DEC real | sim | Draw real | sim |");
  L.push("|---|---|---|---|---|---|---|---|---|---|");
  for (const k of order) { const r = rows[k]; L.push(`| ${name(k)} | ${r.n} | ${pc(r.real.ko)}${zf(r.z.ko)} | ${pc(r.sim.ko)} | ${pc(r.real.sub)}${zf(r.z.sub)} | ${pc(r.sim.sub)} | ${pc(r.real.dec)}${zf(r.z.dec)} | ${pc(r.sim.dec)} | ${pc(r.real.draw)} | ${pc(r.sim.draw)} |`); }
  L.push("");
  L.push("### Method by round (share of all fights in the group; real / sim)");
  L.push("");
  L.push("| Group | KO R1 | KO R2 | KO R3 | KO R4-5 | SUB R1 | SUB R2 | SUB R3 | SUB R4-5 |");
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const k of order) {
    const r = rows[k], a = r.real, s = r.sim;
    const c = (x, y) => pc(x) + " / " + pc(y);
    L.push(`| ${name(k)} | ${c(a.koR[0], s.koR[0])} | ${c(a.koR[1], s.koR[1])} | ${c(a.koR[2], s.koR[2])} | ${c(a.koR[3] + a.koR[4], s.koR[3] + s.koR[4])} | ${c(a.subR[0], s.subR[0])} | ${c(a.subR[1], s.subR[1])} | ${c(a.subR[2], s.subR[2])} | ${c(a.subR[3] + a.subR[4], s.subR[3] + s.subR[4])} |`);
  }
  L.push("");
  L.push("### Finish timing within the round (finishes only; real / sim)");
  L.push("");
  L.push("| Group | mean s | 0:00-0:50 | 0:50-1:40 | 1:40-2:30 | 2:30-3:20 | 3:20-4:10 | 4:10-5:00 |");
  L.push("|---|---|---|---|---|---|---|---|");
  for (const k of order) {
    const r = rows[k], a = r.real, s = r.sim;
    L.push(`| ${name(k)} | ${f1(a.ftMean, 0)} / ${f1(s.ftMean, 0)} | ` + a.ft.map((x, q) => pc(x, 0) + " / " + pc(s.ft[q], 0)).join(" | ") + " |");
  }
  L.push("");
  L.push("### Stat lines per fighter per 15 minutes (real / sim)");
  L.push("");
  L.push("| Group | sig landed | sig att | accuracy | head % | KD per 100 head | KD | TD landed | TD att | TD acc | control s | sub att |");
  L.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const k of order) {
    const r = rows[k], a = r.real, s = r.sim;
    const c = (x, y, d) => f1(x, d) + " / " + f1(y, d);
    L.push(`| ${name(k)} | ${c(a.sigL15, s.sigL15, 1)} | ${c(a.sigA15, s.sigA15, 1)} | ${pc(a.acc)} / ${pc(s.acc)} | ${pc(a.head)} / ${pc(s.head)} | ${c(a.kdPerH, s.kdPerH, 2)} | ${c(a.kd15, s.kd15, 2)} | ${c(a.td15, s.td15, 2)} | ${c(a.tdA15, s.tdA15, 2)} | ${pc(a.tdAcc)} / ${pc(s.tdAcc)} | ${c(a.ctrl15, s.ctrl15, 0)} | ${c(a.sub15, s.sub15, 2)} |`);
  }
  L.push("");
  L.push("### Decisions and fight length (real / sim)");
  L.push("");
  L.push("| Group | unanimous share | split + majority | fight minutes | sd of sig landed/min per fighter |");
  L.push("|---|---|---|---|---|");
  for (const k of order) {
    const r = rows[k], a = r.real, s = r.sim;
    L.push(`| ${name(k)} | ${pc(a.ud)} / ${pc(s.ud)} | ${pc(a.split)} / ${pc(s.split)} | ${f1(a.minutes, 2)} / ${f1(s.minutes, 2)} | ${f1(a.sigPerMinSd, 2)} / ${f1(s.sigPerMinSd, 2)} |`);
  }
  L.push("");
  L.push("### Predictive calibration of per-fight stat lines (PIT of the real value in the simulated distribution)");
  L.push("");
  L.push("Mean PIT 0.50 = unbiased; share inside the simulated 10-90% band 80% = right spread (lower = too narrow); below 10% / above 90% should be 10% each.");
  L.push("");
  L.push("| Group | " + PIT.concat(["minutes"]).join(" | ") + " |");
  L.push("|---|" + PIT.concat(["minutes"]).map(() => "---").join("|") + "|");
  for (const k of ["ALL"].concat(fmtKeys)) {
    const r = rows[k];
    L.push(`| ${name(k)} | ` + PIT.concat(["minutes"]).map((q) => `${f1(r.pit[q].mean, 2)}, ${pc(r.pit[q].in80, 0)}% (${pc(r.pit[q].lo10, 0)}/${pc(r.pit[q].hi10, 0)})`).join(" | ") + " |");
  }
  L.push("");
  return { md: L.join("\n"), rows };
}

// ------------------------------------------------------------------ fitting the realism factors
const LEVERS = {   // lever -> target, elasticity prior (d log sim / d log lever), EB unit
  ko: { target: "ko", el: 0.8, kind: "share" },
  sub: { target: "sub", el: 0.8, kind: "share" },
  kd: { target: "kdPerH", el: 0.9, kind: "count", num: "kd" },
  att: { target: "sigA15", el: 0.95, kind: "rate" },
  td: { target: "tdA15", el: 0.9, kind: "count", num: "td_att" },
  ctrl: { target: "ctrl15", el: 0.8, kind: "rate" }
};

// empirical-Bayes shrinkage of log(real / sim) across divisions: r_d ~ N(mu = 0, tau^2) + sampling noise v_d
function ebShrink(entries) {
  // entries: [{ key, r, v }] -> { key: shrunk r, tau2 }
  const ok = entries.filter((e) => isFinite(e.r) && isFinite(e.v) && e.v > 0);
  let tau2 = 0;
  if (ok.length >= 3) {
    const w = ok.map((e) => 1 / e.v), sw = w.reduce((a, b) => a + b, 0);
    // method of moments (DerSimonian-Laird around 0)
    const Q = ok.reduce((a, e, i) => a + w[i] * e.r * e.r, 0), c = sw - ok.reduce((a, e, i) => a + w[i] * w[i], 0) / sw;
    tau2 = Math.max(0, (Q - ok.length) / Math.max(1e-9, c));
  }
  const out = { tau2 };
  for (const e of entries) out[e.key] = isFinite(e.r) && e.v > 0 ? e.r * tau2 / (tau2 + e.v) : 0;
  return out;
}

// Log ratio of the real to the simulated level on the count scale, with a continuity correction (Haldane-Anscombe +0.5) and
// its sampling variance from the observed count. Verifier fix: the uncorrected log(max(1e-6, real) / sim) gave r = -12 for a
// group with no real event (e.g. Women's Featherweight with 0 KDs in 2019-2021, 8 fights); its finite variance then made the
// DerSimonian-Laird tau^2 explode (KD 0.62, SUB 1.10), so every division's ratio went unshrunk and factors hit the 0.4 / 2.5
// clip (realism_sens verifier notes). O = real events, Ex = events the simulation implies on the same exposure.
//   share: v = 1/(O + 0.5) - 1/(n + 0.5) (+ a small Monte Carlo term);  count: v = phi / (O + 0.5), phi = 2 (over-dispersion)
function logRatioCC(O, Ex, kind, n) {
  const r = Math.log((O + 0.5) / (Ex + 0.5));
  const v = kind === "share" ? Math.max(1e-4, 1 / (O + 0.5) - 1 / (n + 0.5)) + 1 / Math.max(50, Ex * 20) : 2 / (O + 0.5);
  return { r, v };
}
// real numerator count and exposure (the denominator of the rate, in the target's units) of a count target over fights idx
function countExposure(fights, idx, L) {
  let num = 0, den = 0;
  for (const i of idx) {
    const r = realOf(fights[i]); if (!r.st || !r.minutes) continue;     // the fights groupStats() uses for the real rate
    num += r.st[L.num];
    den += L.target === "kdPerH" ? r.st.h_lnd / 100 : 2 * r.minutes / 15;   // kdPerH = 100 kd / h_lnd; tdA15 = 15 td_att / (2 min)
  }
  return { num, den };
}

function fitTargets(fights, sims, levers) {
  // per division: real vs flag-off sim, sampling variances, EB-shrunk target ratios
  const G = groupsOf(fights), res = {};
  for (const lv of levers) {
    const L = LEVERS[lv], ents = [];
    for (const d of DIVS) {
      const idx = G["div:" + d]; if (!idx || !idx.length) continue;
      const gs = groupStats(fights, sims, idx), rv = gs.real[L.target], sv = gs.sim[L.target];
      let v, rr = null;
      if (L.kind === "share") { const q = logRatioCC(rv * gs.n, sv * gs.n, "share", gs.n); rr = q.r; v = q.v; }   // binomial var of log O (+ small MC term)
      else if (L.kind === "count") {
        // Poisson-ish count with over-dispersion (2) of the real numerator
        const ce = countExposure(fights, idx, L), q = logRatioCC(ce.num, sv * ce.den, "count", gs.n);
        rr = q.r; v = q.v;
      } else {
        // rate: between-fight variance of the per-fight log ratio / n (cluster se)
        const lr = []; for (const i of idx) { const r = realOf(fights[i]), s = sims[i]; if (!r.st || !s || !r.minutes) continue;
          const key = L.target === "sigA15" ? "sig_att" : "ctrl";
          lr.push(Math.log((r.st[key] / r.minutes + (key === "ctrl" ? 5 : 1)) / (s.st[key] / Math.max(1e-9, s.minutes) + (key === "ctrl" ? 5 : 1)))); }
        const mu = lr.reduce((a, b) => a + b, 0) / Math.max(1, lr.length);
        v = lr.reduce((a, b) => a + (b - mu) * (b - mu), 0) / Math.max(1, lr.length - 1) / Math.max(1, lr.length);
      }
      ents.push({ key: d, r: rr != null ? rr : Math.log(Math.max(1e-6, rv) / Math.max(1e-6, sv)), v, n: gs.n, real: rv, sim: sv });
    }
    const sh = ebShrink(ents);
    res[lv] = { tau2: sh.tau2, div: {} };
    for (const e of ents) res[lv].div[e.key] = { n: e.n, real: e.real, sim0: e.sim, r: e.r, se: Math.sqrt(e.v), rShrunk: sh[e.key], target: e.sim * Math.exp(sh[e.key]) };
  }
  return res;
}

function fmtTargets(fights, sims, levers) {
  // 5-round format factor on top of the division factors: pooled over all 5-round fights
  const G = groupsOf(fights), idx = G["rounds:5"] || [], res = {};
  if (!idx.length) return res;
  const gs = groupStats(fights, sims, idx);
  for (const lv of levers) {
    const L = LEVERS[lv]; if (L.kind === "rate") continue;
    const rv = gs.real[L.target], sv = gs.sim[L.target];
    // continuity-corrected log ratio on the count scale (as fitTargets; verifier fix)
    let q;
    if (L.kind === "share") q = logRatioCC(rv * gs.n, sv * gs.n, "share", gs.n);
    else { const ce = countExposure(fights, idx, L); q = logRatioCC(ce.num, sv * ce.den, "count", gs.n); }
    const r = q.r, v = q.v;
    // fixed prior sd 0.2 on a format factor (one group: no between-group variance to estimate)
    const tau2 = 0.04, rs = r * tau2 / (tau2 + v);
    res[lv] = { n: gs.n, real: rv, sim0: sv, r, se: Math.sqrt(v), rShrunk: rs, target: sv * Math.exp(rs) };
  }
  return res;
}

// ------------------------------------------------------------------ comparison metrics (per fight) and bootstrap
const STAT_DEV = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "sub_att", "ctrl"];
function poisDev(y, mu) { mu = Math.max(mu, 1e-6); return 2 * ((y > 0 ? y * Math.log(y / mu) : 0) - (y - mu)); }

function perFightMetrics(fights, sims, pi7) {
  const piM = [pi7[0] + pi7[6], pi7[1] + pi7[5], pi7[2] + pi7[3] + pi7[4]];
  return fights.map((f, i) => {
    const s = sims[i], r = realOf(f);
    if (!s) return null;
    const N = s.N, c = s.bins.map((x) => x * N);
    const cA = c[0] + c[1] + c[2], cB = c[4] + c[5] + c[6];
    const p = clip((cA + 0.5) / (cA + cB + 1), 0.005, 0.995);
    const o = { event: f.event, year: f.year, division: f.division, fmt: f.fmt };
    if (r.bin !== 3) {
      const y = r.bin < 3 ? 1 : 0;
      o.winLL = y ? -Math.log(p) : -Math.log(1 - p);
      o.brier = (p - y) * (p - y);
      o.acc = p > 0.5 ? y : (p < 0.5 ? 1 - y : 0.5);
    }
    if (f.close != null) { const q = f.close; o.softCE = -(q * Math.log(p) + (1 - q) * Math.log(1 - p)); }
    o.bin7LL = -Math.log((c[r.bin] + pi7[r.bin]) / (N + 1));
    const mc = [c[0] + c[6], c[1] + c[5], c[2] + c[3] + c[4]], my = r.ko ? 0 : (r.sub ? 1 : 2);
    o.methodLL = -Math.log((mc[my] + piM[my]) / (N + 1));
    if (r.st && f.real.A && f.real.B) {
      let dev = 0; const per = {};
      for (const k of STAT_DEV) {
        const sc = k === "ctrl" ? 1 / 60 : 1;
        const d = poisDev(sc * (+f.real.A[k] || 0), sc * s.stA[k]) + poisDev(sc * (+f.real.B[k] || 0), sc * s.stB[k]);
        per[k] = d; dev += d;
      }
      o.statDev = dev; o.statDevPer = per;
    }
    // base-rate pieces (numerators and denominators), sim and real
    o.br = {
      sim: { ko: s.ko, sub: s.sub, dec: s.decS + s.draw, fin3: f.rounds === 3 ? [s.koR[0] + s.subR[0], s.koR[1] + s.subR[1], s.koR[2] + s.subR[2]] : null,
        dec3: s.dec.slice(0, 3), st: s.st, min: s.minutes },
      real: { ko: r.ko, sub: r.sub, dec: r.dec + r.draw, fin3: f.rounds === 3 && r.finRound ? [r.finRound === 1 ? 1 : 0, r.finRound === 2 ? 1 : 0, r.finRound === 3 ? 1 : 0] : (f.rounds === 3 ? [0, 0, 0] : null),
        dec3: r.decType && r.decType !== "DRAW" ? [r.decType === "UD" ? 1 : 0, r.decType === "SD" ? 1 : 0, r.decType === "MD" ? 1 : 0] : [0, 0, 0],
        st: r.st, min: r.minutes }
    };
    return o;
  });
}

const METRICS = ["winLL", "softCE", "bin7LL", "methodLL", "statDev", "brier", "acc"];
const BR_KEYS = ["ko", "sub", "dec", "fin3_r1", "fin3_r2", "fin3_r3", "split", "sigL15", "sigAcc", "kd15", "kdPer100H", "td15", "tdAcc", "ctrl15", "sub15"];

function baseRatesW(pf, side, w) {
  // weighted base rates from per-fight pieces; w(i) = weight of fight i
  let n = 0, ko = 0, sub = 0, dec = 0, f3 = [0, 0, 0], d3 = [0, 0, 0], mins = 0;
  const st = {}; for (const k of DATA_ST) st[k] = 0;
  for (let i = 0; i < pf.length; i++) {
    const o = pf[i]; if (!o) continue; const wi = w ? w[i] : 1; if (!wi) continue;
    const b = o.br[side];
    n += wi; ko += wi * b.ko; sub += wi * b.sub; dec += wi * b.dec;
    if (b.fin3) for (let q = 0; q < 3; q++) f3[q] += wi * b.fin3[q];
    for (let q = 0; q < 3; q++) d3[q] += wi * b.dec3[q];
    const rs = o.br.real.st;
    if (rs && o.br.real.min) { mins += wi * b.min; for (const k of DATA_ST) st[k] += wi * b.st[k]; }
  }
  const f3t = f3[0] + f3[1] + f3[2], d3t = d3[0] + d3[1] + d3[2], m2 = Math.max(1e-9, 2 * mins);
  return { ko: ko / n, sub: sub / n, dec: dec / n, fin3_r1: f3[0] / f3t, fin3_r2: f3[1] / f3t, fin3_r3: f3[2] / f3t, split: (d3[1] + d3[2]) / Math.max(1e-9, d3t),
    sigL15: 15 * st.sig_lnd / m2, sigAcc: st.sig_lnd / Math.max(1e-9, st.sig_att), kd15: 15 * st.kd / m2, kdPer100H: 100 * st.kd / Math.max(1e-9, st.h_lnd),
    td15: 15 * st.td_lnd / m2, tdAcc: st.td_lnd / Math.max(1e-9, st.td_att), ctrl15: 15 * st.ctrl / m2, sub15: 15 * st.sub_att / m2 };
}

function bootstrap(pfOff, pfOn, B, seed) {
  // paired event-cluster bootstrap: resample events (cards) with replacement; every fight on a drawn card enters with that weight
  const n = pfOff.length, evIdx = new Map(), ev = new Int32Array(n);
  for (let i = 0; i < n; i++) { const e = (pfOff[i] || pfOn[i] || {}).event || String(i); if (!evIdx.has(e)) evIdx.set(e, evIdx.size); ev[i] = evIdx.get(e); }
  const E = evIdx.size, rnd = mulberry(seed || 7);
  const point = { off: {}, on: {}, diff: {} }, draws = {};
  const valOf = (pf, k, i) => (pf[i] && pf[i][k] != null ? pf[i][k] : null);
  function wmeans(w) {
    const r = { off: {}, on: {}, diff: {} };
    for (const k of METRICS) {
      let s0 = 0, s1 = 0, sw = 0;
      for (let i = 0; i < n; i++) { const a = valOf(pfOff, k, i), b = valOf(pfOn, k, i); if (a == null || b == null) continue; const wi = w ? w[i] : 1; s0 += wi * a; s1 += wi * b; sw += wi; }
      r.off[k] = s0 / sw; r.on[k] = s1 / sw; r.diff[k] = (s1 - s0) / sw;
    }
    const bOff = baseRatesW(pfOff, "sim", w), bOn = baseRatesW(pfOn, "sim", w), bReal = baseRatesW(pfOff, "real", w);
    for (const k of BR_KEYS) {
      r.off["br_" + k] = bOff[k] - bReal[k]; r.on["br_" + k] = bOn[k] - bReal[k];
      r.diff["br_" + k] = Math.abs(bOn[k] - bReal[k]) - Math.abs(bOff[k] - bReal[k]);
      r.off["real_" + k] = bReal[k];
    }
    return r;
  }
  const pt = wmeans(null);
  for (const g of ["off", "on", "diff"]) for (const k of Object.keys(pt[g])) { point[g][k] = pt[g][k]; draws[g + ":" + k] = []; }
  const cnt = new Float64Array(E), w = new Float64Array(n);
  for (let b = 0; b < B; b++) {
    cnt.fill(0);
    for (let j = 0; j < E; j++) cnt[Math.floor(rnd() * E)]++;
    for (let i = 0; i < n; i++) w[i] = cnt[ev[i]];
    const r = wmeans(w);
    for (const g of ["off", "on", "diff"]) for (const k of Object.keys(r[g])) draws[g + ":" + k].push(r[g][k]);
  }
  const ci = {};
  for (const key of Object.keys(draws)) {
    const a = draws[key].filter((x) => isFinite(x)).sort((x, y) => x - y);
    ci[key] = a.length ? [a[Math.floor(0.025 * (a.length - 1))], a[Math.ceil(0.975 * (a.length - 1))]] : [NaN, NaN];
  }
  // per-stat deviance breakdown (point only)
  const perStat = {};
  for (const k of STAT_DEV) {
    let s0 = 0, s1 = 0, c = 0;
    for (let i = 0; i < n; i++) { const a = pfOff[i], bb = pfOn[i]; if (!a || !bb || !a.statDevPer || !bb.statDevPer) continue; s0 += a.statDevPer[k]; s1 += bb.statDevPer[k]; c++; }
    perStat[k] = { off: s0 / c, on: s1 / c, diff: (s1 - s0) / c };
  }
  const nOf = (k) => { let c = 0; for (let i = 0; i < n; i++) if (valOf(pfOff, k, i) != null && valOf(pfOn, k, i) != null) c++; return c; };
  const counts = {}; for (const k of METRICS) counts[k] = nOf(k);
  return { point, ci, events: E, n, counts, perStat };
}

function compareMd(bs, title) {
  const L = [];
  const f4 = (x) => (x == null || !isFinite(x) ? "-" : (+x).toFixed(4));
  const ci = (k) => { const c = bs.ci[k]; return c ? `[${f4(c[0])}, ${f4(c[1])}]` : "-"; };
  L.push("## " + title);
  L.push("");
  L.push(`${bs.n} fights on ${bs.events} event cards; paired event-cluster bootstrap 95% CIs (on - off; negative = flag on better for losses).`);
  L.push("");
  L.push("| Metric | n | flag off | flag on | on - off | 95% CI |");
  L.push("|---|---|---|---|---|---|");
  const names = { winLL: "Winner log loss", softCE: "Soft-label CE vs closing line", bin7LL: "7-bin log loss", methodLL: "Method log loss (KO/SUB/DEC)",
    statDev: "Stat-line deviance (Poisson, per fight)", brier: "Brier", acc: "Accuracy" };
  for (const k of METRICS) L.push(`| ${names[k]} | ${bs.counts[k]} | ${f4(bs.point.off[k])} | ${f4(bs.point.on[k])} | ${f4(bs.point.diff[k])} | ${ci("diff:" + k)} |`);
  L.push("");
  L.push("Stat-line deviance by stat (point): " + STAT_DEV.map((k) => `${k} ${bs.perStat[k].off.toFixed(3)} -> ${bs.perStat[k].on.toFixed(3)}`).join("; "));
  L.push("");
  L.push("### Base rates (sim - real; |gap| change: negative = closer to the data with the flag on)");
  L.push("");
  L.push("| Rate | real | off: sim - real (95% CI) | on: sim - real (95% CI) | abs gap on - off (95% CI) |");
  L.push("|---|---|---|---|---|");
  for (const k of BR_KEYS) L.push(`| ${k} | ${f4(bs.point.off["real_" + k])} | ${f4(bs.point.off["br_" + k])} ${ci("off:br_" + k)} | ${f4(bs.point.on["br_" + k])} ${ci("on:br_" + k)} | ${f4(bs.point.diff["br_" + k])} ${ci("diff:br_" + k)} |`);
  L.push("");
  return L.join("\n");
}

function pi7Of(fights) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const f of fights) c[f.real.bin]++;
  const n = fights.length;
  return c.map((x, k) => (x + c[6 - k]) / (2 * n));
}

// ------------------------------------------------------------------ dispersion (no simulation)
function dispersion(fights) {
  const acc = { att: [0, 0], acc: [0, 0], kd: [0, 0], td_att: [0, 0], td_acc: [0, 0], sub_att: [0, 0] };
  let n = 0;
  for (const f of fights) {
    if (!f.ml || !f.real.A || !f.real.B || !f.real.minutes) continue;
    const mins = f.real.minutes;
    for (const [pr, act] of [[f.ml.A, f.real.A], [f.ml.B, f.real.B]]) {
      const muAtt = (pr.d_att + pr.c_att + pr.g_att) * mins, ya = +act.sig_att;
      if (muAtt > 1) { acc.att[0] += (ya - muAtt) ** 2 / muAtt; acc.att[1]++; }
      const ht = pr.h_att + pr.b_att + pr.l_att, pAcc = (pr.h_att * pr.acc_h + pr.b_att * pr.acc_b + pr.l_att * pr.acc_l) / Math.max(1e-9, ht);
      if (ya >= 5) { const e = ya * pAcc; acc.acc[0] += (+act.sig_lnd - e) ** 2 / (ya * pAcc * (1 - pAcc)); acc.acc[1]++; }
      const muKd = pr.kd_h * (+act.h_lnd);
      if (muKd > 0.02) { acc.kd[0] += (+act.kd - muKd) ** 2 / muKd; acc.kd[1]++; }
      const muTd = pr.td_att * mins;
      if (muTd > 0.05) { acc.td_att[0] += (+act.td_att - muTd) ** 2 / muTd; acc.td_att[1]++; }
      const ta = +act.td_att;
      if (ta >= 1) { const e = ta * pr.td_acc; acc.td_acc[0] += (+act.td_lnd - e) ** 2 / (ta * pr.td_acc * (1 - pr.td_acc)); acc.td_acc[1]++; }
      const muSub = pr.sub_att * mins;
      if (muSub > 0.02) { acc.sub_att[0] += (+act.sub_att - muSub) ** 2 / muSub; acc.sub_att[1]++; }
    }
    n++;
  }
  const out = {};
  for (const k of Object.keys(acc)) out[k] = { phi: acc[k][0] / Math.max(1, acc[k][1]), n: acc[k][1] };
  return { n, phi: out };
}

// ------------------------------------------------------------------ main
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args._[0] || "help";
  if (mode === "help") { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); return; }
  const o = {
    engine: args.engine || "src/engine3.js", params: args.params || "src/params3.js",
    backtest: args.backtest || "data/derived/backtest_dev.json", priors: args.priors || "data/derived/mlcal_priors_asof.json",
    oof: args.oof || "data/derived/mlrates_oof.json", market: args.market || "data/derived/market.json",
    years: parseYears(args.years), sims: +(args.sims || 200), workers: Math.min(3, +(args.workers || 3)), seed: +(args.seed || 1),
    unledgeredVal: !!args["unledgered-val"], boot: +(args.boot || 2000)
  };
  if (mode === "pool") return poolMode(args, o);
  const D = loadFights(o);
  const fights = D.fights;
  console.error(`realism ${mode}: ${fights.length} fights (${o.years.join(",")}), dropped ${D.vault} vault-dated and ${D.noRes} unscored; ` +
    `OOF learned rates ${D.hasOof ? "on (" + D.noOof + " fights without)" : "off"}; closing lines ${D.hasMkt ? "on" : "off"}`);
  if (mode === "disp") {
    const d = dispersion(fights);
    console.log(JSON.stringify(d, null, 1));
    if (args.json) fs.writeFileSync(absPath(args.json), JSON.stringify(d, null, 1));
    return;
  }
  const E = require(absPath(o.engine)), P0 = require(absPath(o.params));
  const hasComp = !!(P0.components && Object.prototype.hasOwnProperty.call(P0.components, "realism_sens"));
  const useMl = D.hasOof && typeof E.matchupBase === "function" ? true : null;
  const sets = {};
  if (args.set) for (const kv of String(args.set).split(",")) { const [k, v] = kv.split("="); setPath(sets, k, isFinite(+v) ? +v : v === "true" ? true : v === "false" ? false : v); }
  const treeWith = (flag, factors) => {
    const t = JSON.parse(JSON.stringify(sets));
    if (hasComp && flag != null) setPath(t, "components.realism_sens", flag);
    if (factors) {
      // every division / format entry explicit, so a factor left at 1 here never falls back to the params file's own value
      t.realism = Object.assign({}, t.realism || {});
      t.realism.div = {}; for (const d of DIVS) t.realism.div[d] = Object.assign({}, (factors.div || {})[d] || {});
      t.realism.fmt = { "3": Object.assign({}, (factors.fmt || {})["3"] || {}), "5": Object.assign({}, (factors.fmt || {})["5"] || {}) };
    }
    return Object.keys(t).length ? t : null;
  };
  const pool = new Pool(o, fights, D.PA);
  const t0 = Date.now();
  const runCfg = async (key, tree, sims) => {
    const t1 = Date.now();
    const r = await pool.run(key, tree, sims || o.sims / 2, o.seed, useMl);
    if (r.errors.length) console.error("errors:", r.errors.slice(0, 3));
    const sims_ = fights.map((f, i) => simOf(r.rec, i));
    console.error(`  ${key}: ${((Date.now() - t1) / 1000).toFixed(0)} s (${sims_.filter((x) => !x).length} failed)`);
    return sims_;
  };
  const meta = { tool: "tools/realism.js", mode, engine: o.engine, engine_version: E.VERSION || null, params: o.params, params_version: P0.version || null,
    years: o.years, n: fights.length, sims_per_fight: o.sims, seed: o.seed, learned_rates: useMl ? "out-of-fold (" + o.oof + ")" : "engine default",
    priors: o.priors, built: new Date().toISOString(), component_flag: hasComp };
  try {
    if (mode === "report") {
      const flag = args.flag === "off" ? false : args.flag === "on" ? true : null;
      const sims = await runCfg("report", treeWith(flag, args.factors ? readJSON(args.factors) : null));
      const T = tables(fights, sims, `Realism: engine ${E.VERSION || "?"} (params ${P0.version || "?"}${hasComp ? ", realism_sens " + (flag == null ? "as in params" : flag ? "on" : "off") : ""}), ${o.years[0]}-${o.years[o.years.length - 1]}, ${fights.length} fights x ${o.sims} sims`);
      console.log(T.md);
      if (args.md) fs.writeFileSync(absPath(args.md), T.md + "\n");
      if (args.json) fs.writeFileSync(absPath(args.json), JSON.stringify({ meta, rows: T.rows }));
    } else if (mode === "fit") {
      if (!hasComp) throw new Error("realism fit: the params file has no components.realism_sens flag");
      const levers = (args.levers || "ko,sub,kd").split(",");
      const iters = +(args.iters || 4), damp = +(args.damp || 0.85), simsFit = +(args["fit-sims"] || o.sims) / 2;
      const s0 = await runCfg("off", treeWith(false, null), simsFit);
      const tg = fitTargets(fights, s0, levers), tf = args.fmt ? fmtTargets(fights, s0, String(args["fmt-levers"] || "ko,sub,kd").split(",")) : {};
      const fac = { div: {}, fmt: {} };
      for (const d of DIVS) { fac.div[d] = {}; for (const lv of levers) if (tg[lv].div[d]) fac.div[d][lv] = 1; }
      if (args.fmt) { fac.fmt["5"] = {}; for (const lv of Object.keys(tf)) fac.fmt["5"][lv] = 1; }
      // initial step from the elasticity priors
      for (const d of DIVS) for (const lv of levers) { const t = tg[lv].div[d]; if (t) fac.div[d][lv] = Math.exp(t.rShrunk / LEVERS[lv].el); }
      for (const lv of Object.keys(tf)) fac.fmt["5"][lv] = Math.exp(tf[lv].rShrunk / LEVERS[lv].el);
      let simsNow = null;
      const hist = [];
      for (let it = 0; it < iters; it++) {
        simsNow = await runCfg("fit" + it, treeWith(true, fac), simsFit);
        const G = groupsOf(fights);
        let worst = 0;
        // format first (pooled 5-round), then divisions
        for (const lv of Object.keys(tf)) {
          const gs = groupStats(fights, simsNow, G["rounds:5"]), cur = gs.sim[LEVERS[lv].target];
          const step = damp * Math.log(tf[lv].target / Math.max(1e-6, cur)) / LEVERS[lv].el;
          fac.fmt["5"][lv] = clip(fac.fmt["5"][lv] * Math.exp(step), 0.4, 2.5);
        }
        for (const d of DIVS) {
          const idx = G["div:" + d]; if (!idx) continue;
          const gs = groupStats(fights, simsNow, idx);
          for (const lv of levers) {
            const t = tg[lv].div[d]; if (!t) continue;
            const cur = gs.sim[LEVERS[lv].target], rel = Math.log(t.target / Math.max(1e-6, cur));
            worst = Math.max(worst, Math.abs(rel));
            if (it < iters - 1) fac.div[d][lv] = clip(fac.div[d][lv] * Math.exp(damp * rel / LEVERS[lv].el), 0.4, 2.5);
          }
        }
        hist.push({ it, worstRelGap: worst });
        console.error(`  iteration ${it}: worst |log(target / sim)| ${worst.toFixed(3)}`);
      }
      const r3 = (x) => Math.round(x * 1000) / 1000;
      const facOut = { div: {}, fmt: {} };
      for (const d of DIVS) { const e = {}; let any = false; for (const lv of Object.keys(fac.div[d] || {})) { const v = r3(fac.div[d][lv]); if (v !== 1) { e[lv] = v; any = true; } } if (any) facOut.div[d] = e; }
      for (const lv of Object.keys(fac.fmt["5"] || {})) { facOut.fmt["5"] = facOut.fmt["5"] || {}; facOut.fmt["5"][lv] = r3(fac.fmt["5"][lv]); }
      const before = tables(fights, s0, "Before (flag off)"), after = tables(fights, simsNow, "After (flag on, fitted factors)");
      const out = { meta: Object.assign(meta, { levers, iters, damp, sims_fit: simsFit * 2, fmt: !!args.fmt }), factors: facOut, targets: tg, fmtTargets: tf, history: hist };
      if (args.out) fs.writeFileSync(absPath(args.out), JSON.stringify(out, null, 1));
      const L = ["## Fitted realism factors (" + o.years.join(",") + ")", "", "| Division | n | " + levers.map((lv) => `${lv}: real / sim0 -> shrunk target, factor`).join(" | ") + " |",
        "|---|---|" + levers.map(() => "---").join("|") + "|"];
      for (const d of DIVS) {
        const any = levers.find((lv) => tg[lv].div[d]); if (!any) continue;
        L.push(`| ${DIV_SHORT[d]} | ${tg[any].div[d].n} | ` + levers.map((lv) => { const t = tg[lv].div[d]; if (!t) return "-"; const sc = LEVERS[lv].kind === "share" ? 100 : 1;
          return `${f1(sc * t.real, 2)} / ${f1(sc * t.sim0, 2)} -> ${f1(sc * t.target, 2)}, x${(facOut.div[d] && facOut.div[d][lv]) || 1}`; }).join(" | ") + " |");
      }
      L.push("", "EB between-division sd of log(real / sim): " + levers.map((lv) => `${lv} ${Math.sqrt(tg[lv].tau2).toFixed(3)}`).join(", "));
      if (args.fmt) L.push("", "5-round format factors: " + JSON.stringify(facOut.fmt) + "  targets: " + JSON.stringify(tf));
      L.push("", "```js", "realism: { div: " + JSON.stringify(facOut.div) + ", fmt: " + JSON.stringify(facOut.fmt) + " }", "```", "");
      const md = L.join("\n") + "\n" + before.md + "\n" + after.md;
      console.log(md);
      if (args.md) fs.writeFileSync(absPath(args.md), md + "\n");
    } else if (mode === "compare") {
      if (!hasComp) throw new Error("realism compare: the params file has no components.realism_sens flag");
      const factors = args.factors ? readJSON(args.factors).factors || readJSON(args.factors) : null;
      const sOff = await runCfg("off", treeWith(false, null));
      const sOn = await runCfg("on", treeWith(true, factors));
      const pi7 = args.pi7 ? JSON.parse(args.pi7) : pi7Of(fights);
      const pfOff = perFightMetrics(fights, sOff, pi7), pfOn = perFightMetrics(fights, sOn, pi7);
      if (args.perfight) fs.writeFileSync(absPath(args.perfight), JSON.stringify({ meta, pi7, off: pfOff, on: pfOn }));
      const bs = bootstrap(pfOff, pfOn, o.boot, 11);
      const md = compareMd(bs, `Flag off vs on, ${o.years.join(",")} (${fights.length} fights x ${o.sims} sims, CRN)`);
      console.log(md);
      if (args.md) fs.writeFileSync(absPath(args.md), md + "\n");
      if (args.json) fs.writeFileSync(absPath(args.json), JSON.stringify({ meta, bootstrap: bs }));
      if (args.tables) {
        const T0 = tables(fights, sOff, "Flag off"), T1 = tables(fights, sOn, "Flag on");
        fs.writeFileSync(absPath(args.tables), T0.md + "\n\n" + T1.md + "\n");
      }
    } else throw new Error("realism: unknown mode " + mode);
  } finally {
    await pool.close();
  }
  console.error(`done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

function poolMode(args, o) {
  const files = String(args.in || "").split(",").filter(Boolean);
  if (!files.length) throw new Error("realism pool: give --in a.json,b.json");
  let off = [], on = [];
  for (const f of files) { const j = readJSON(f); off = off.concat(j.off); on = on.concat(j.on); }
  const bs = bootstrap(off, on, o.boot, 11);
  const md = compareMd(bs, args.title || `Pooled (${files.length} files)`);
  console.log(md);
  if (args.md) fs.writeFileSync(absPath(args.md), md + "\n");
  if (args.json) fs.writeFileSync(absPath(args.json), JSON.stringify({ files, bootstrap: bs }));
}

if (!isMainThread) workerMain();
else if (require.main === module) main().catch((e) => { console.error(e && e.stack || e); process.exit(1); });

module.exports = { resultBin, ebShrink, poisDev, bootstrap, baseRatesW, groupStats, LEVERS, logRatioCC, fitTargets };
