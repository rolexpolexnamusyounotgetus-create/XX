#!/usr/bin/env node
/* Walk-forward calibration and validation of fight engine v3.

   node tools/calibrate.js [--quick] [--final-only] [--no-write] [--budget=MIN] [--n=N] [--nfinal=N] [--workers=W]

   For every entry of data/derived/backtest.json (UFC fights 2019-01-01 .. 2026-10-31, both men with at least one
   earlier UFC fight, each profile a snapshot frozen before the fight) this builds the matchup from the two snapshots
   (division / rounds / title from the entry; division priors from backtest.json priors_asof[year], which hold only
   fights from the 5 years before Jan 1 of the entry's year, so nothing from the fight's own year or later leaks in)
   and simulates N fights with common random numbers (each simulation i of a fight has its own fixed seed, so a
   parameter change re-simulates the same nights). Workers: worker_threads, one per core (max 4).

   Split: train = 2019-01-01 .. 2023-12-31 (tuning only), test = 2024-01-01 on (never used for tuning; reported once
   with the final parameters). The 2024-2025 slice ("val") and the 2026 slice are also reported separately because
   from v4 on 2026 is the sealed vault (docs/BACKLOG.md).

   Tuning (train only):
   - Moment matching (dampened fixed point) for the volume scales that have a direct data target in the "actual"
     block: strikeScale (sig attempts / min), accScale (sig accuracy), kdScale (KD per landed head strike),
     tdScale (TD attempts / min), tdOddsScale (TD accuracy), ctrlScale (control / min; 1 / get-up scale),
     subAttScale (sub attempts / min).
   - Coordinate descent with shrinking steps on the remaining globals, objective = winner log loss + 0.5 x 7-bin
     outcome log loss + base-rate drift penalties (finish rate 3 and 5 rounds, KO and SUB shares, KD per 100 head
     landed, unanimous share of decisions), each outside a tolerance. Parameters that only touch a subset of fights
     (age, prior KO losses, weight moves, 5-round fights) are re-simulated on that subset only.

   Metrics: winner log loss, Brier, accuracy (draws / no-contests excluded), ECE (10 bins, both corner orientations),
   calibration slope, 7-bin outcome log loss, finish rate and method split vs actual, per-fight landed-strike and
   takedown error vs the actual block, per-division breakdown. Baselines: pre-fight Elo (logistic of the Elo
   difference, scale fit on train), "more prior UFC wins" (constant fit on train), and a stacked blend (no-intercept
   logistic regression of engine logit and Elo difference, fit on train). Everything is corner-symmetric: no
   intercepts, calibration bins mirrored (ufcstats lists the winner first 56% of the time).

   Writes (unless --no-write): src/params3.js (tuned values, comments kept), data/derived/calibration.json.
*/
"use strict";
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.join(__dirname, "..");
const BT_PATH = path.join(ROOT, "data/derived/backtest.json");
const ENGINE = path.join(ROOT, "src/engine3.js");
const PARAMS = path.join(ROOT, "src/params3.js");

// ------------------------------------------------------------------ per-fight result vector layout (sums over N sims)
const V_BIN = 0;          // 7 outcome bins
const V_FIN = 7;          // finishes by round (5)
const V_KO = 12;          // KO/TKO (incl. doctor / corner) by round (5)
const V_SUB = 17;         // submissions by round (5)
const V_UD = 22, V_SD = 23, V_MD = 24, V_DRAW = 25;
const V_MIN = 26;         // fight minutes
const V_SL = 27, V_SA = 29, V_TL = 31, V_TA = 33, V_KD = 35, V_HL = 37, V_CT = 39, V_SUBA = 41;   // A, B pairs
const V_SHL = 43;         // standing head landed (both)
const V_DOC = 44;         // doctor + corner stoppages
const V_Z1 = 45, V_Z2 = 47;   // per side: sum and sum of squares of z = log((landed + 1) / (minutes + 0.5)) (per-fight output dispersion)
const V_Q1 = 49, V_Q2 = 51;   // per side: sum and sum of squares of logit accuracy log((landed + 0.5) / (missed + 0.5))
const V_F = 53;           // matchup constants (not sums): log power ratio A, B; log chin ratio A, B; years past chinAge0 A, B; prior KO losses A, B; lbs up / 10 A, B
const NV = 63;

function fightSeed(id, salt) { return ((parseInt(String(id).slice(0, 8), 16) >>> 0) ^ (salt >>> 0)) >>> 0; }

function simFight(E, m, N, fseed, out, o) {
  const nR = m.rounds;
  for (let i = 0; i < N; i++) {
    const rng = E.makeRng((fseed + Math.imul(i + 1, 0x9E3779B1)) >>> 0);
    const f = E.simulate(m, rng, false);
    out[o + E.bucket(f)]++;
    const meth = f.method;
    if (meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW") {
      out[o + (meth === "UD" ? V_UD : meth === "SD" ? V_SD : meth === "MD" ? V_MD : V_DRAW)]++;
      out[o + V_MIN] += nR * 5;
    } else {
      const r = f.round - 1;
      out[o + V_FIN + r]++;
      if (meth === "SUB") out[o + V_SUB + r]++; else out[o + V_KO + r]++;
      if (meth === "DOC" || meth === "CORNER") out[o + V_DOC]++;
      out[o + V_MIN] += r * 5 + f.t / 60;
    }
    const A = f.totals.A, B = f.totals.B;
    out[o + V_SL] += A.sig_lnd; out[o + V_SL + 1] += B.sig_lnd;
    out[o + V_SA] += A.sig_att; out[o + V_SA + 1] += B.sig_att;
    out[o + V_TL] += A.td_lnd; out[o + V_TL + 1] += B.td_lnd;
    out[o + V_TA] += A.td_att; out[o + V_TA + 1] += B.td_att;
    out[o + V_KD] += A.kd; out[o + V_KD + 1] += B.kd;
    out[o + V_HL] += A.h_lnd; out[o + V_HL + 1] += B.h_lnd;
    out[o + V_CT] += A.ctrl; out[o + V_CT + 1] += B.ctrl;
    out[o + V_SUBA] += A.sub_att; out[o + V_SUBA + 1] += B.sub_att;
    out[o + V_SHL] += A.sh_lnd + B.sh_lnd;
    const mn = meth === "UD" || meth === "SD" || meth === "MD" || meth === "DRAW" ? nR * 5 : (f.round - 1) * 5 + f.t / 60;
    const zA = Math.log((A.sig_lnd + 1) / (mn + 0.5)), zB = Math.log((B.sig_lnd + 1) / (mn + 0.5));
    const qA = Math.log((A.sig_lnd + 0.5) / (A.sig_att - A.sig_lnd + 0.5)), qB = Math.log((B.sig_lnd + 0.5) / (B.sig_att - B.sig_lnd + 0.5));
    out[o + V_Z1] += zA; out[o + V_Z1 + 1] += zB; out[o + V_Z2] += zA * zA; out[o + V_Z2 + 1] += zB * zB;
    out[o + V_Q1] += qA; out[o + V_Q1 + 1] += qB; out[o + V_Q2] += qA * qA; out[o + V_Q2 + 1] += qB * qB;
  }
  const fc = m.fac, a0 = m.p.chinAge0;
  out[o + V_F] = Math.log(fc[0].powRaw); out[o + V_F + 1] = Math.log(fc[1].powRaw);
  out[o + V_F + 2] = Math.log(fc[0].chinRaw); out[o + V_F + 3] = Math.log(fc[1].chinRaw);
  out[o + V_F + 4] = m.ages[0] != null ? Math.max(0, m.ages[0] - a0) : 0; out[o + V_F + 5] = m.ages[1] != null ? Math.max(0, m.ages[1] - a0) : 0;
  out[o + V_F + 6] = fc[0].koLosses || 0; out[o + V_F + 7] = fc[1].koLosses || 0;
  out[o + V_F + 8] = (fc[0].lbsUp || 0) / 10; out[o + V_F + 9] = (fc[1].lbsUp || 0) / 10;
}

// ================================================================== worker
if (!isMainThread) {
  const E = require(ENGINE);
  const bt = JSON.parse(fs.readFileSync(workerData.bt, "utf8"));
  const keys = bt.meta.keys, F = bt.fights;
  for (const f of F) { f.A.keys = keys; f.B.keys = keys; }
  parentPort.on("message", (msg) => {
    if (msg.type !== "eval") return;
    const out = new Float64Array(msg.idx.length * NV);
    for (let q = 0; q < msg.idx.length; q++) {
      const f = F[msg.idx[q]];
      const m = E.matchup(f.A, f.B, { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date,
        priors: bt.priors_asof[f.date.slice(0, 4)], params: msg.over });
      simFight(E, m, msg.N, fightSeed(f.id, msg.salt), out, q * NV);
    }
    parentPort.postMessage({ type: "res", id: msg.id, out }, [out.buffer]);
  });
  return;
}

// ================================================================== main
const args = process.argv.slice(2);
const flag = (k) => args.includes(k);
const opt = (k, d) => { const a = args.find((x) => x.startsWith(k + "=")); return a ? +a.split("=")[1] : d; };
const QUICK = flag("--quick"), FINAL_ONLY = flag("--final-only"), NOWRITE = flag("--no-write");
const BUDGET_MIN = opt("--budget", QUICK ? 3 : 42);         // tuning wall-clock budget (minutes); the final evaluation comes after
const N_TUNE = opt("--n", QUICK ? 40 : 60);
const N_FINAL = opt("--nfinal", QUICK ? 120 : 1000);
const NW = opt("--workers", Math.max(1, Math.min(4, os.cpus().length)));
const SALT_TUNE = 0x5eed2019, SALT_FINAL = 0x0f1a1000;
const TODAY = "2026-11-06";
const T0 = Date.now();
const mins = () => (Date.now() - T0) / 60000;
const log = (...a) => console.log(`[${mins().toFixed(1).padStart(5)} min]`, ...a);

const E = require(ENGINE);
const BASE = require(PARAMS);
const bt = JSON.parse(fs.readFileSync(BT_PATH, "utf8"));
const F = bt.fights;
const fightersDb = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8"));

// ------------------------------------------------------------------ actual outcomes
function actualBin(f) {
  const w = f.result.winner, m = f.result.method;
  if (w === "D") return 3;
  if (w !== "A" && w !== "B") return null;
  const k = m === "KO" || m === "DOC" ? 0 : m === "SUB" ? 1 : (m === "UD" || m === "SD" || m === "MD") ? 2 : null;
  if (k === null) return null;   // DQ
  return w === "A" ? k : 6 - k;
}
const Y = F.map((f) => (f.result.winner === "A" ? 1 : f.result.winner === "B" ? 0 : null));   // DQ counts as a decisive result
const BIN = F.map(actualBin);
const ALL_IDX = F.map((_, i) => i).filter((i) => Y[i] !== null || BIN[i] !== null);
let TRAIN = ALL_IDX.filter((i) => F[i].date < "2024-01-01");
let TEST = ALL_IDX.filter((i) => F[i].date >= "2024-01-01");
if (QUICK) { TRAIN = TRAIN.filter((_, k) => k % 4 === 0); TEST = TEST.filter((_, k) => k % 4 === 0); }
const VAL = TEST.filter((i) => F[i].date < "2026-01-01"), Y2026 = TEST.filter((i) => F[i].date >= "2026-01-01");

// ------------------------------------------------------------------ prior UFC wins (naive baseline) from the raw results
function parseCsv(text) {
  const rows = []; let row = [], cur = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }
  return rows;
}
const MONTHS = { January: 1, February: 2, March: 3, April: 4, May: 5, June: 6, July: 7, August: 8, September: 9, October: 10, November: 11, December: 12 };
function priorWinsLookup() {
  const ev = parseCsv(fs.readFileSync(path.join(ROOT, "data/raw/ufc_event_details.csv"), "utf8"));
  const evDate = {};
  for (const r of ev.slice(1)) {
    const m = /^(\w+) (\d+), (\d{4})$/.exec((r[2] || "").trim());
    if (m) evDate[r[0].trim()] = `${m[3]}-${String(MONTHS[m[1]]).padStart(2, "0")}-${String(+m[2]).padStart(2, "0")}`;
  }
  const res = parseCsv(fs.readFileSync(path.join(ROOT, "data/raw/ufc_fight_results.csv"), "utf8"));
  const seen = new Set(), wins = {};
  for (const r of res.slice(1)) {
    const url = (r[10] || "").trim(); if (!url || seen.has(url)) continue; seen.add(url);
    const d = evDate[(r[0] || "").trim()]; if (!d) continue;
    const names = (r[1] || "").split(" vs. "); if (names.length !== 2) continue;
    const oc = (r[2] || "").trim();
    const w = oc === "W/L" ? names[0].trim() : oc === "L/W" ? names[1].trim() : null;
    if (w) (wins[w] = wins[w] || []).push(d);
  }
  for (const k in wins) wins[k].sort();
  return (name, date) => {
    const a = wins[name]; if (!a) return 0;
    let lo = 0, hi = a.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < date) lo = mid + 1; else hi = mid; }
    return lo;
  };
}
const priorWins = priorWinsLookup();
const PW = F.map((f) => [priorWins(f.A.name, f.date), priorWins(f.B.name, f.date)]);

// ------------------------------------------------------------------ subsets for parameters that only touch some fights
function lbsOf(f, div) {
  const pa = bt.priors_asof[f.date.slice(0, 4)] || {};
  return (pa[div] && pa[div].lbs) || (fightersDb.priors[div] && fightersDb.priors[div].lbs) || null;
}
const SUBSET = {
  all: null,
  age: new Set(F.map((f, i) => i).filter((i) => Math.max(F[i].A.age || 0, F[i].B.age || 0) > BASE.chinAge0)),
  ko: new Set(F.map((f, i) => i).filter((i) => (F[i].A.ko_losses || 0) > 0 || (F[i].B.ko_losses || 0) > 0)),
  size: new Set(F.map((f, i) => i).filter((i) => {
    const f = F[i], fl = lbsOf(f, f.prior_division || f.division);
    return fl && ["A", "B"].some((s) => { const h = lbsOf(f, f[s].home); return h && h < fl; });
  })),
  r5: new Set(F.map((f, i) => i).filter((i) => F[i].rounds === 5))
};

// ------------------------------------------------------------------ worker pool with dynamic chunks
class Pool {
  constructor(n) {
    this.workers = []; this.idle = []; this.queue = []; this.pending = new Map(); this.nextId = 1;
    for (let w = 0; w < n; w++) {
      const wk = new Worker(__filename, { workerData: { bt: BT_PATH } });
      wk.on("message", (msg) => this._done(wk, msg));
      wk.on("error", (e) => { console.error("worker error", e); process.exit(2); });
      this.workers.push(wk); this.idle.push(wk);
    }
  }
  _pump() {
    while (this.idle.length && this.queue.length) {
      const wk = this.idle.pop(), job = this.queue.shift();
      this.pending.set(job.id, job);
      wk.postMessage({ type: "eval", id: job.id, over: job.over, N: job.N, idx: job.idx, salt: job.salt });
    }
  }
  _done(wk, msg) {
    const job = this.pending.get(msg.id); this.pending.delete(msg.id);
    job.task.out.set(msg.out, job.off * NV);
    if (--job.task.left === 0) job.task.resolve();
    this.idle.push(wk); this._pump();
  }
  // simulate fights idx (global indices) -> { idx, out: Float64Array(idx.length * NV) } in idx order
  run(over, idx, N, salt) {
    return new Promise((resolve) => {
      // longest first (5-round fights are slower); each job writes a contiguous block of the permuted order
      const perm = idx.map((g, k) => k).sort((a, b) => F[idx[b]].rounds - F[idx[a]].rounds);
      const chunk = Math.max(4, Math.min(24, Math.ceil(idx.length / (NW * 12))));
      const buf = new Float64Array(idx.length * NV);
      const task = { out: buf, left: 0, resolve: null };
      task.resolve = () => {
        const res = new Float64Array(idx.length * NV);
        for (let q = 0; q < perm.length; q++) res.set(buf.subarray(q * NV, (q + 1) * NV), perm[q] * NV);
        resolve({ idx, out: res });
      };
      if (!perm.length) { task.resolve(); return; }
      for (let s = 0; s < perm.length; s += chunk) {
        const ks = perm.slice(s, s + chunk);
        task.left++;
        this.queue.push({ id: this.nextId++, over, N, salt, idx: ks.map((k) => idx[k]), off: s, task });
      }
      this._pump();
    });
  }
  close() { for (const w of this.workers) w.terminate(); }
}

// ------------------------------------------------------------------ math helpers
const clip = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const logit = (p) => Math.log(p / (1 - p));
const sigm = (z) => 1 / (1 + Math.exp(-z));
const oddsOf = (p) => p / (1 - p);
const probOf = (o) => o / (1 + o);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const r4 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(4));
const r3 = (x) => (x == null || !isFinite(x) ? null : +(+x).toFixed(3));

// result store: global Float64Array(F.length * NV) + N
function makeStore() { return new Float64Array(F.length * NV); }
function putResults(store, res) { for (let k = 0; k < res.idx.length; k++) store.set(res.out.subarray(k * NV, (k + 1) * NV), res.idx[k] * NV); }

function engineP(store, g) {
  const o = g * NV, a = store[o] + store[o + 1] + store[o + 2], b = store[o + 4] + store[o + 5] + store[o + 6];
  return (a + 0.5) / (a + b + 1);
}
function engineQ7(store, g, N) {
  const o = g * NV, al = 0.5, q = new Array(7);
  for (let k = 0; k < 7; k++) q[k] = (store[o + k] + al) / (N + 7 * al);
  return q;
}

// winner metrics for probability function pf(g) over idxs with Y != null
function winnerMetrics(idxs, pf) {
  let n = 0, ll = 0, br = 0, acc = 0, sharp = 0;
  const xs = [], ys = [];
  for (const g of idxs) {
    if (Y[g] === null) continue;
    const p = clip(pf(g), 1e-4, 1 - 1e-4), y = Y[g];
    n++; ll -= y ? Math.log(p) : Math.log(1 - p); br += (p - y) * (p - y);
    acc += p === 0.5 ? 0.5 : ((p > 0.5) === (y === 1) ? 1 : 0);
    sharp += Math.abs(p - 0.5);
    xs.push(p); ys.push(y);
  }
  const bins = calBins(xs, ys);
  return { n, log_loss: ll / n, brier: br / n, accuracy: acc / n, ece: bins.ece, slope: calSlope(xs, ys), sharpness: sharp / n, bins: bins.bins };
}
// 10 bins on both corner orientations (each fight enters as (p, y) and (1 - p, 1 - y))
function calBins(xs, ys) {
  const B = Array.from({ length: 10 }, (_, k) => ({ lo: k / 10, hi: (k + 1) / 10, n: 0, sp: 0, sy: 0 }));
  const add = (p, y) => { const b = B[Math.min(9, Math.floor(p * 10))]; b.n++; b.sp += p; b.sy += y; };
  for (let k = 0; k < xs.length; k++) { add(xs[k], ys[k]); add(1 - xs[k], 1 - ys[k]); }
  let ece = 0; const tot = 2 * xs.length;
  const bins = B.filter((b) => b.n > 0).map((b) => {
    ece += b.n / tot * Math.abs(b.sp / b.n - b.sy / b.n);
    return { lo: b.lo, hi: b.hi, n: b.n / 2, pred: r4(b.sp / b.n), obs: r4(b.sy / b.n) };
  });
  return { ece, bins };
}
// no-intercept logistic slope of y on logit(p) (1 = calibrated sharpness; < 1 overconfident)
function calSlope(xs, ys) {
  let w = 1;
  for (let it = 0; it < 30; it++) {
    let gr = 0, h = 0;
    for (let k = 0; k < xs.length; k++) { const z = logit(clip(xs[k], 1e-4, 1 - 1e-4)), p = sigm(w * z); gr += (ys[k] - p) * z; h += p * (1 - p) * z * z; }
    if (h <= 0) break; w += gr / h; if (Math.abs(gr / h) < 1e-9) break;
  }
  return w;
}
// no-intercept logistic regression with feature function fx(g) -> array
function fitLogistic(idxs, fx, d) {
  let w = new Array(d).fill(0);
  for (let it = 0; it < 50; it++) {
    const gr = new Array(d).fill(0), H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (const g of idxs) {
      if (Y[g] === null) continue;
      const x = fx(g); let z = 0; for (let a = 0; a < d; a++) z += w[a] * x[a];
      const p = sigm(z), r = Y[g] - p, v = p * (1 - p);
      for (let a = 0; a < d; a++) { gr[a] += r * x[a]; for (let b = 0; b < d; b++) H[a][b] += v * x[a] * x[b]; }
    }
    const step = solve(H, gr); let mx = 0;
    for (let a = 0; a < d; a++) { w[a] += step[a]; mx = Math.max(mx, Math.abs(step[a])); }
    if (mx < 1e-10) break;
  }
  return w;
}
function solve(A, b) {
  const n = b.length, M = A.map((r, i) => r.concat([b[i]]));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return new Array(n).fill(0);
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]; }
  }
  return M.map((r, i) => r[n] / r[i]);
}
function golden(f, lo, hi, it = 60) {
  const gr = (Math.sqrt(5) - 1) / 2; let a = lo, b = hi, c = b - gr * (b - a), d = a + gr * (b - a), fc = f(c), fd = f(d);
  for (let k = 0; k < it; k++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - gr * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + gr * (b - a); fd = f(d); } }
  return (a + b) / 2;
}

// ------------------------------------------------------------------ aggregates: sim vs actual base rates
function aggregates(store, idxs, N) {
  const S = { n: 0, n3: 0, n5: 0, fin: 0, fin3: 0, fin5: 0, ko: 0, sub: 0, dec: 0, draw: 0, ud: 0, sd: 0, md: 0, doc: 0,
    r3: [0, 0, 0], r5: [0, 0, 0, 0, 0], ko3: [0, 0, 0], sub3: [0, 0, 0], min: 0, sl: 0, sa: 0, tl: 0, ta: 0, kd: 0, hl: 0, ct: 0, suba: 0, shl: 0 };
  const A = JSON.parse(JSON.stringify(S));
  for (const g of idxs) {
    if (BIN[g] === null) continue;      // method-level stats need a known method
    const f = F[g], o = g * NV, five = f.rounds === 5;
    // sim (as fractions of N)
    S.n++; five ? S.n5++ : S.n3++;
    let fin = 0; for (let r = 0; r < 5; r++) fin += store[o + V_FIN + r];
    S.fin += fin / N; five ? (S.fin5 += fin / N) : (S.fin3 += fin / N);
    S.ko += (store[o] + store[o + 6]) / N; S.sub += (store[o + 1] + store[o + 5]) / N;
    S.dec += (store[o + 2] + store[o + 4]) / N; S.draw += store[o + 3] / N;
    S.ud += store[o + V_UD] / N; S.sd += store[o + V_SD] / N; S.md += store[o + V_MD] / N; S.doc += store[o + V_DOC] / N;
    if (five) for (let r = 0; r < 5; r++) S.r5[r] += store[o + V_FIN + r] / N;
    else for (let r = 0; r < 3; r++) { S.r3[r] += store[o + V_FIN + r] / N; S.ko3[r] += store[o + V_KO + r] / N; S.sub3[r] += store[o + V_SUB + r] / N; }
    S.min += store[o + V_MIN] / N;
    S.sl += (store[o + V_SL] + store[o + V_SL + 1]) / N; S.sa += (store[o + V_SA] + store[o + V_SA + 1]) / N;
    S.tl += (store[o + V_TL] + store[o + V_TL + 1]) / N; S.ta += (store[o + V_TA] + store[o + V_TA + 1]) / N;
    S.kd += (store[o + V_KD] + store[o + V_KD + 1]) / N; S.hl += (store[o + V_HL] + store[o + V_HL + 1]) / N;
    S.ct += (store[o + V_CT] + store[o + V_CT + 1]) / N; S.suba += (store[o + V_SUBA] + store[o + V_SUBA + 1]) / N;
    S.shl += store[o + V_SHL] / N;
    // actual
    const res = f.result, ac = f.actual, b = BIN[g], isFin = b === 0 || b === 1 || b === 5 || b === 6;
    A.n++; five ? A.n5++ : A.n3++;
    if (isFin) {
      A.fin++; five ? A.fin5++ : A.fin3++;
      const rr = Math.min(res.round, f.rounds) - 1;
      if (five) A.r5[rr]++; else { A.r3[rr]++; if (b === 1 || b === 5) A.sub3[rr]++; else A.ko3[rr]++; }
    }
    if (b === 0 || b === 6) A.ko++; if (b === 1 || b === 5) A.sub++; if (b === 2 || b === 4) A.dec++; if (b === 3) A.draw++;
    if (res.method === "UD") A.ud++; if (res.method === "SD") A.sd++; if (res.method === "MD") A.md++; if (res.method === "DOC") A.doc++;
    A.min += ac.minutes;
    A.sl += ac.A.sig_lnd + ac.B.sig_lnd; A.sa += ac.A.sig_att + ac.B.sig_att; A.tl += ac.A.td_lnd + ac.B.td_lnd; A.ta += ac.A.td_att + ac.B.td_att;
    A.kd += ac.A.kd + ac.B.kd; A.hl += ac.A.h_lnd + ac.B.h_lnd; A.ct += ac.A.ctrl + ac.B.ctrl; A.suba += ac.A.sub_att + ac.B.sub_att;
  }
  return { sim: S, act: A };
}
function rates(x) {
  const decs = x.ud + x.sd + x.md;
  return {
    n: x.n, fin: x.fin / x.n, fin3: x.n3 ? x.fin3 / x.n3 : null, fin5: x.n5 ? x.fin5 / x.n5 : null,
    ko: x.ko / x.n, sub: x.sub / x.n, dec: x.dec / x.n, draw: x.draw / x.n, doc: x.doc / x.n,
    ud: decs ? x.ud / decs : null, sd: decs ? x.sd / decs : null, md: decs ? x.md / decs : null,
    r3: x.r3.map((v) => (x.n3 ? v / x.n3 : null)), r5: x.r5.map((v) => (x.n5 ? v / x.n5 : null)),
    ko3: x.ko3.map((v) => (x.n3 ? v / x.n3 : null)), sub3: x.sub3.map((v) => (x.n3 ? v / x.n3 : null)),
    kd100: 100 * x.kd / x.hl, kd15: 15 * x.kd / 2 / x.min, sl15: 15 * x.sl / 2 / x.min, sa15: 15 * x.sa / 2 / x.min, acc: x.sl / x.sa,
    td15: 15 * x.tl / 2 / x.min, ta15: 15 * x.ta / 2 / x.min, tdAcc: x.tl / Math.max(1e-9, x.ta), ctrl15: 15 * x.ct / 2 / x.min,
    sub15: 15 * x.suba / 2 / x.min, avgMin: x.min / x.n
  };
}

// ------------------------------------------------------------------ objective (train)
const TOL = { fin3: 0.02, fin5: 0.04, ko: 0.02, sub: 0.02, ud: 0.04, kd100: 0.10 };
const PEN_W = 0.02;
function objective(store, idxs, N) {
  let nw = 0, llw = 0, n7 = 0, ll7 = 0;
  for (const g of idxs) {
    if (Y[g] !== null) { const p = clip(engineP(store, g), 1e-4, 1 - 1e-4); llw -= Y[g] ? Math.log(p) : Math.log(1 - p); nw++; }
    if (BIN[g] !== null) { const q = engineQ7(store, g, N); ll7 -= Math.log(q[BIN[g]]); n7++; }
  }
  llw /= nw; ll7 /= n7;
  const ag = aggregates(store, idxs, N), s = rates(ag.sim), a = rates(ag.act);
  const dev = { fin3: s.fin3 - a.fin3, fin5: (s.fin5 != null && a.fin5 != null) ? s.fin5 - a.fin5 : 0, ko: s.ko - a.ko, sub: s.sub - a.sub,
    ud: s.ud - a.ud, kd100: s.kd100 / a.kd100 - 1 };
  let pen = 0;
  for (const k in TOL) { const e = Math.max(0, Math.abs(dev[k]) - TOL[k]) / TOL[k]; pen += PEN_W * e * e; }
  return { obj: llw + 0.5 * ll7 + pen, llw, ll7, pen, dev, s, a };
}

// ------------------------------------------------------------------ parameter vector
const P0 = JSON.parse(JSON.stringify(BASE));
const X0 = {
  formOut: P0.form.out, formPC: 1, formVol: P0.form.vol, formAcc: P0.form.acc, formGrap: P0.form.grap,
  jShared: P0.judge.sharedSd, jInd: P0.judge.indSd,
  chinAge: P0.chinAge, powAge: P0.powAge, powExp: P0.powExp != null ? P0.powExp : 1, chinExp: P0.chinExp != null ? P0.chinExp : 1,
  stko: P0.stko, gnpTko: P0.gnpTko, chinKO: P0.chinKO, sizeChin: P0.sizeChin, r1c5: P0.r1Caution5, dse: P0.drainSchedExp,
  // fixed-point fitted to train base rates
  koAll: 1, subConv: P0.subConvScale, caution5: P0.caution5 != null ? P0.caution5 : 1,
  // moment-matched
  strikeScale: P0.strikeScale, accScale: P0.accScale, kdScale: P0.kdScale, tdScale: P0.tdScale, tdOddsScale: P0.tdOddsScale,
  ctrlScale: P0.ctrlScale != null ? P0.ctrlScale : 1, subAttScale: P0.subAttScale
};
function buildOver(x) {
  return {
    form: { out: x.formOut, pow: P0.form.pow * x.formPC, chin: P0.form.chin * x.formPC, vol: x.formVol, acc: x.formAcc, grap: x.formGrap },
    judge: { sharedSd: x.jShared, indSd: x.jInd },
    chinAge: x.chinAge, powAge: x.powAge, powExp: x.powExp, chinExp: x.chinExp,
    kdInstant: probOf(oddsOf(P0.kdInstant) * x.koAll), kdRefStop: probOf(oddsOf(P0.kdRefStop) * x.koAll),
    stko: x.stko * x.koAll, gnpTko: x.gnpTko * x.koAll, subConvScale: x.subConv, chinKO: x.chinKO, sizeChin: x.sizeChin,
    r1Caution5: x.r1c5, drainSchedExp: x.dse, caution5: x.caution5,
    strikeScale: x.strikeScale, accScale: x.accScale, kdScale: x.kdScale, tdScale: x.tdScale, tdOddsScale: x.tdOddsScale,
    ctrlScale: x.ctrlScale, subAttScale: x.subAttScale
  };
}
// coordinate-descent specs, roughly in order of expected effect on the train objective
const SPECS = [
  { k: "formOut", kind: "mul", step: 1.5, lo: 0.02, hi: 0.6, sub: "all" },
  { k: "jShared", kind: "mul", step: 1.35, lo: 0.2, hi: 3, sub: "all" },
  { k: "formPC", kind: "mul", step: 1.3, lo: 0.2, hi: 2.2, sub: "all" },
  { k: "powExp", kind: "add", step: 0.25, lo: 0.2, hi: 2.0, sub: "all" },
  { k: "chinExp", kind: "add", step: 0.25, lo: 0.2, hi: 2.0, sub: "all" },
  { k: "chinAge", kind: "add", step: 0.02, lo: 0, hi: 0.15, sub: "age" },
  { k: "formVol", kind: "mul", step: 1.3, lo: 0.1, hi: 1.2, sub: "all" },
  { k: "formAcc", kind: "mul", step: 1.4, lo: 0.02, hi: 0.5, sub: "all" },
  { k: "stko", kind: "mul", step: 1.4, lo: 0.005, hi: 0.3, sub: "all" },
  { k: "gnpTko", kind: "mul", step: 1.3, lo: 0.005, hi: 0.2, sub: "all" },
  { k: "powAge", kind: "add", step: 0.02, lo: 0, hi: 0.12, sub: "age" },
  { k: "r1c5", kind: "add", step: 0.1, lo: 0.4, hi: 1.2, sub: "r5" },
  { k: "dse", kind: "add", step: 0.25, lo: -0.6, hi: 1.2, sub: "r5" },
  { k: "chinKO", kind: "add", step: 0.03, lo: 0, hi: 0.2, sub: "ko" },
  { k: "sizeChin", kind: "add", step: 0.05, lo: 0, hi: 0.3, sub: "size" },
  { k: "formGrap", kind: "mul", step: 1.4, lo: 0.05, hi: 0.9, sub: "all" }
];
const REANCHOR_EVERY = opt("--reanchor", 5);   // fixed-point re-anchor after this many coordinate-descent parameters
function stepVal(s, x, dir) {
  const v = s.kind === "mul" ? (dir > 0 ? x * s.step : x / s.step) : x + dir * s.step;
  return clip(v, s.lo, s.hi);
}

// moment-matching update of the volume scales from train aggregates (dampened)
function momentUpdate(x, s, a, damp) {
  const e = damp == null ? 0.8 : damp, y = Object.assign({}, x);
  const oR = (t, v) => oddsOf(t) / oddsOf(v);
  y.strikeScale = x.strikeScale * Math.pow(a.sa15 / s.sa15, e);
  y.accScale = x.accScale * Math.pow(oR(a.acc, s.acc), e);
  y.kdScale = x.kdScale * Math.pow(a.kd100 / s.kd100, e);
  y.tdScale = x.tdScale * Math.pow(a.ta15 / s.ta15, e);
  y.tdOddsScale = x.tdOddsScale * Math.pow(oR(a.tdAcc, s.tdAcc), e);
  y.ctrlScale = x.ctrlScale * Math.pow(a.ctrl15 / s.ctrl15, e);
  y.subAttScale = x.subAttScale * Math.pow(a.sub15 / s.sub15, e);
  // base-rate fixers: KO conversion (instant KO, referee stop, standing and GNP TKO together), submission conversion,
  // individual judge noise (unanimous share of decisions), 5-round caution (5-round finish rate)
  y.koAll = clip(x.koAll * Math.pow(a.ko / s.ko, 1.2 * e), 0.2, 5);
  y.subConv = clip(x.subConv * Math.pow(oR(a.sub, s.sub), e), 0.2, 6);
  y.jInd = clip(x.jInd * Math.pow((1 - a.ud) / Math.max(1e-3, 1 - s.ud), 0.6 * e), 0.2, 4);
  if (s.fin5 != null && a.fin5 != null && s.fin5 > 0) y.caution5 = clip(x.caution5 * Math.pow(a.fin5 / s.fin5, 1.4 * e), 0.3, 2);
  return y;
}

// ------------------------------------------------------------------ per-fight landed-strike and takedown error vs the actual block
function statError(store, idxs) {
  const out = {};
  for (const [name, vi, ak, pk] of [["sig_landed", V_SL, "sig_lnd", (P) => P.d_lnd + P.c_lnd + P.g_lnd], ["td_landed", V_TL, "td_lnd", (P) => P.td_lnd],
    ["sig_attempted", V_SA, "sig_att", (P) => P.d_att + P.c_att + P.g_att]]) {
    let n = 0, sp = 0, sa = 0, mae = 0, mse = 0, maeB = 0, mseB = 0; const rs = [], ra = [];
    for (const g of idxs) {
      const f = F[g], o = g * NV, simMin = store[o + V_MIN]; if (!(simMin > 0)) continue;
      const mins = f.actual.minutes; if (!(mins > 0)) continue;
      const P = (bt.priors_asof[f.date.slice(0, 4)] || {})[f.prior_division || f.division] || bt.priors_asof[f.date.slice(0, 4)].ALL;
      for (let s = 0; s < 2; s++) {
        const rate = store[o + vi + s] / simMin, pred = rate * mins, act = f.actual[s ? "B" : "A"][ak], base = pk(P) * mins;
        n++; sp += pred; sa += act; mae += Math.abs(pred - act); mse += (pred - act) ** 2; maeB += Math.abs(base - act); mseB += (base - act) ** 2;
        if (mins >= 5) { rs.push(rate); ra.push(act / mins); }
      }
    }
    out[name] = { n, bias: sp / sa - 1, mae: mae / n, rmse: Math.sqrt(mse / n), mae_division_avg: maeB / n, rmse_division_avg: Math.sqrt(mseB / n),
      corr_per_min: pearson(rs, ra), note: "prediction = simulated rate per minute x actual fight minutes; baseline = division prior rate x minutes" };
  }
  return out;
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return null;
  const mx = sum(x) / n, my = sum(y) / n; let sxy = 0, sxx = 0, syy = 0;
  for (let k = 0; k < n; k++) { sxy += (x[k] - mx) * (y[k] - my); sxx += (x[k] - mx) ** 2; syy += (y[k] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

function ll7Of(idxs, qf) {
  let n = 0, ll = 0;
  for (const g of idxs) { if (BIN[g] === null) continue; ll -= Math.log(Math.max(1e-6, qf(g)[BIN[g]])); n++; }
  return { n, log_loss: ll / n };
}

// ================================================================== run
(async function main() {
  log(`engine ${E.VERSION}, params ${BASE.version}; backtest ${F.length} entries; train ${TRAIN.length}, test ${TEST.length} (val 2024-25 ${VAL.length}, 2026 ${Y2026.length}); ` +
    `${NW} workers; N tune ${N_TUNE}, final ${N_FINAL}; tuning budget ${BUDGET_MIN} min${QUICK ? " [quick]" : ""}`);
  log(`subsets: age>${BASE.chinAge0} ${SUBSET.age.size}, prior KO losses ${SUBSET.ko.size}, moving up ${SUBSET.size.size}, 5 rounds ${SUBSET.r5.size}`);
  const pool = new Pool(NW);
  let x = Object.assign({}, X0);
  const history = [];
  let tuneInfo = { evals: 0, passes: 0, start: null, end: null, moment_updates: 0 };

  async function evalFull(xx, idxs, N, salt) {
    const st = makeStore(); putResults(st, await pool.run(buildOver(xx), idxs, N, salt)); tuneInfo.evals++; return st;
  }

  let beforeTest = null, fpLog = [], kdReg = null, noise = null;
  if (!FINAL_ONLY) {
    // ---------------- before tuning: a test read with the builder's parameters (reported only, never used for tuning)
    {
      const NB = QUICK ? 40 : 100, st = await evalFull(x, TEST, NB, SALT_FINAL);
      const e = winnerMetrics(TEST, (g) => engineP(st, g)), e7 = ll7Of(TEST, (g) => engineQ7(st, g, NB)), ag = aggregates(st, TEST, NB), rs = rates(ag.sim), ra = rates(ag.act);
      beforeTest = { n_sims: NB, params_version: BASE.version, log_loss: r4(e.log_loss), brier: r4(e.brier), accuracy: r4(e.accuracy), ece: r4(e.ece), slope: r3(e.slope),
        outcome7_log_loss: r4(e7.log_loss), finish_sim: r4(rs.fin), finish_actual: r4(ra.fin), ko_sim: r4(rs.ko), sub_sim: r4(rs.sub), fin5_sim: r4(rs.fin5), fin5_actual: r4(ra.fin5) };
      log(`before tuning (test, N=${NB}): LL ${e.log_loss.toFixed(4)} Brier ${e.brier.toFixed(4)} acc ${(100 * e.accuracy).toFixed(1)}% ECE ${(100 * e.ece).toFixed(2)}% slope ${e.slope.toFixed(2)} 7-bin ${e7.log_loss.toFixed(4)} fin ${(100 * rs.fin).toFixed(1)}/${(100 * ra.fin).toFixed(1)}`);
    }
    const show = (tag, o, extra) => log(`${tag}: obj ${o.obj.toFixed(5)} = LLwin ${o.llw.toFixed(5)} + 0.5 x LL7 ${o.ll7.toFixed(5)} + pen ${o.pen.toFixed(5)} | ` +
      `fin3 ${(100 * o.s.fin3).toFixed(1)}/${(100 * o.a.fin3).toFixed(1)} fin5 ${o.s.fin5 != null ? (100 * o.s.fin5).toFixed(1) : "-"}/${o.a.fin5 != null ? (100 * o.a.fin5).toFixed(1) : "-"} ` +
      `KO ${(100 * o.s.ko).toFixed(1)}/${(100 * o.a.ko).toFixed(1)} SUB ${(100 * o.s.sub).toFixed(1)}/${(100 * o.a.sub).toFixed(1)} UD ${(100 * o.s.ud).toFixed(1)}/${(100 * o.a.ud).toFixed(1)} ` +
      `kd100 ${o.s.kd100.toFixed(3)}/${o.a.kd100.toFixed(3)} att15 ${o.s.sa15.toFixed(1)}/${o.a.sa15.toFixed(1)} acc ${(100 * o.s.acc).toFixed(1)}/${(100 * o.a.acc).toFixed(1)} ` +
      `tdA15 ${o.s.ta15.toFixed(2)}/${o.a.ta15.toFixed(2)} tdAcc ${(100 * o.s.tdAcc).toFixed(1)}/${(100 * o.a.tdAcc).toFixed(1)} ctrl15 ${o.s.ctrl15.toFixed(0)}/${o.a.ctrl15.toFixed(0)} sub15 ${o.s.sub15.toFixed(3)}/${o.a.sub15.toFixed(3)}` +
      (extra ? " | " + extra : ""));

    // ---------------- stage 1: fixed point on data targets (train only)
    let cur = null, best = null;
    const nFP = QUICK ? 3 : opt("--fp", 8);
    for (let it = 0; it <= nFP; it++) {
      cur = await evalFull(x, TRAIN, N_TUNE, SALT_TUNE); best = objective(cur, TRAIN, N_TUNE);
      const D = dispersion(cur, TRAIN, N_TUNE), sl = slopeInfo(cur, TRAIN), K = kdRegression(cur, TRAIN);
      const sh = shapeStats(best);
      show(it === 0 ? "baseline (train)" : `fixed point ${it}`, best,
        `slope ${sl.raw.toFixed(3)} (noise-corrected ${sl.corr.toFixed(3)}) | landed disp ${D.zRatio.toFixed(3)} acc disp ${D.qRatio.toFixed(3)} | R1 share 3rd ${(100 * sh.s1).toFixed(1)}/${(100 * sh.a1).toFixed(1)} | ` +
        `KD reg d(pow) ${K.d[1].toFixed(3)}+-${K.se[1].toFixed(3)} d(chin) ${K.d[2].toFixed(3)}+-${K.se[2].toFixed(3)} d(ageChin) ${K.d[3].toFixed(4)}+-${K.se[3].toFixed(4)} ` +
        `d(agePow) ${K.d[4].toFixed(4)}+-${K.se[4].toFixed(4)} d(koL) ${K.d[5].toFixed(3)}+-${K.se[5].toFixed(3)} d(up) ${K.d[6].toFixed(3)}+-${K.se[6].toFixed(3)}`);
      fpLog.push({ it, obj: r4(best.obj), llw: r4(best.llw), ll7: r4(best.ll7), pen: r4(best.pen), slope: r3(sl.raw), slope_corr: r3(sl.corr), landed_disp: r3(D.zRatio), acc_disp: r3(D.qRatio),
        r1_share_3rd: [r3(sh.s1), r3(sh.a1)], kd_reg: { d: K.d.map(r4), se: K.se.map(r4) }, x: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toPrecision(4)])) });
      history.push({ t: +mins().toFixed(2), what: it === 0 ? "baseline" : "fixed point", obj: r4(best.obj), llw: r4(best.llw), ll7: r4(best.ll7), pen: r4(best.pen) });
      if (it === 0) tuneInfo.start = { obj: best.obj, llw: best.llw, ll7: best.ll7, pen: best.pen, dev: best.dev, slope: sl.raw };
      kdReg = { d: K.d.map(r4), se: K.se.map(r4), names: K.names, n: K.n };
      if (it === nFP || mins() > BUDGET_MIN * 0.6) break;
      x = fixedPoint(x, best, D, K, sh, it < 2 ? 0.8 : 0.6);
      tuneInfo.moment_updates++;
    }

    // ---------------- stage 2: coordinate descent (shrinking steps) on the train objective for levers without a direct data target;
    // a step is accepted only if it beats the Monte Carlo noise of the objective
    noise = objNoise(cur, TRAIN, N_TUNE);
    const THR = Math.max(0.0005, 1.0 * noise);
    log(`objective Monte Carlo sd at N=${N_TUNE}: ${noise.toFixed(5)}; acceptance threshold ${THR.toFixed(5)}`);
    const steps = {}; for (const s of SPECS) steps[s.k] = s.step;
    let stop = false;
    for (let pass = 0; pass < 3 && !stop; pass++) {
      let improvedAny = false;
      for (const s0 of SPECS) {
        if (mins() > BUDGET_MIN) { stop = true; break; }
        const s = Object.assign({}, s0, { step: steps[s0.k] });
        const subIdx = s.sub === "all" ? TRAIN : TRAIN.filter((g) => SUBSET[s.sub].has(g));
        let improved = false;
        for (const dir of [1, -1]) {
          if (mins() > BUDGET_MIN) { stop = true; break; }
          const v = stepVal(s, x[s.k], dir);
          if (v === x[s.k]) continue;
          const xc = Object.assign({}, x, { [s.k]: v });
          const st = new Float64Array(cur); putResults(st, await pool.run(buildOver(xc), subIdx, N_TUNE, SALT_TUNE)); tuneInfo.evals++;
          const oc = objective(st, TRAIN, N_TUNE);
          const acc = oc.obj < best.obj - THR;
          log(`CD pass ${pass + 1} ${s.k} ${x[s.k].toPrecision(4)} -> ${v.toPrecision(4)} (${subIdx.length} fights): obj ${oc.obj.toFixed(5)} (best ${best.obj.toFixed(5)}) LLwin ${oc.llw.toFixed(5)} LL7 ${oc.ll7.toFixed(5)} pen ${oc.pen.toFixed(5)}${acc ? "  accepted" : ""}`);
          history.push({ t: +mins().toFixed(2), what: s.k, from: r4(x[s.k]), to: r4(v), obj: r4(oc.obj), llw: r4(oc.llw), ll7: r4(oc.ll7), pen: r4(oc.pen), accepted: acc });
          if (acc) { x = xc; cur = st; best = oc; improved = true; improvedAny = true; break; }
        }
        if (!improved) steps[s0.k] = s0.kind === "mul" ? Math.sqrt(steps[s0.k]) : steps[s0.k] / 2;
      }
      tuneInfo.passes = pass + 1;
      if (!improvedAny) { log("coordinate descent: no step beat the noise threshold in this pass; stopping"); break; }
    }
    // re-anchor the data-target scales once more if anything moved in stage 2
    if (history.some((h) => h.accepted)) {
      const D = dispersion(cur, TRAIN, N_TUNE), K = kdRegression(cur, TRAIN), sh = shapeStats(best);
      x = fixedPoint(x, best, D, K, sh, 0.6, true);
      cur = await evalFull(x, TRAIN, N_TUNE, SALT_TUNE); best = objective(cur, TRAIN, N_TUNE); tuneInfo.moment_updates++;
      show("final re-anchor", best);
      history.push({ t: +mins().toFixed(2), what: "fixed point", obj: r4(best.obj), llw: r4(best.llw), ll7: r4(best.ll7), pen: r4(best.pen) });
    }
    log("x = " + JSON.stringify(Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toPrecision(4)]))));
    tuneInfo.end = { obj: best.obj, llw: best.llw, ll7: best.ll7, pen: best.pen, dev: best.dev };
    try { fs.writeFileSync(path.join(os.tmpdir(), "calibrate_x.json"), JSON.stringify(x)); } catch (e) { /* checkpoint only */ }
  } else {
    log("final-only: evaluating src/params3.js as is");
  }
  const tuneMin = mins();

  // ---------------- final evaluation: N_FINAL per fight on train and test, fresh seeds
  log(`final evaluation: ${TRAIN.length + TEST.length} fights x ${N_FINAL} sims...`);
  const over = buildOver(x);
  const fin = makeStore();
  putResults(fin, await pool.run(over, TRAIN.concat(TEST), N_FINAL, SALT_FINAL));
  log("final simulations done");
  pool.close();

  const pEng = (g) => engineP(fin, g);
  const q7Eng = (g) => engineQ7(fin, g, N_FINAL);
  const eloD = (g) => (F[g].A.elo - F[g].B.elo) / 400;
  // Elo: logistic of the Elo difference, scale fit on train (no intercept)
  const eloLL = (sc) => { let ll = 0; for (const g of TRAIN) { if (Y[g] === null) continue; const p = 1 / (1 + Math.pow(10, -eloD(g) * 400 / sc)); ll -= Y[g] ? Math.log(p) : Math.log(1 - p); } return ll; };
  const eloScale = golden(eloLL, 150, 2500);
  const pElo = (g) => 1 / (1 + Math.pow(10, -eloD(g) * 400 / eloScale));
  // naive: the man with more prior UFC wins, probability fit on train
  let nv = 0, nvw = 0;
  for (const g of TRAIN) { if (Y[g] === null) continue; const d = PW[g][0] - PW[g][1]; if (d === 0) continue; nv++; if ((d > 0) === (Y[g] === 1)) nvw++; }
  const naiveP = nvw / nv;
  const pNaive = (g) => { const d = PW[g][0] - PW[g][1]; return d === 0 ? 0.5 : (d > 0 ? naiveP : 1 - naiveP); };
  // blend: no-intercept logistic regression of engine logit and Elo difference (fit on train)
  const fx = (g) => [logit(clip(pEng(g), 1e-3, 1 - 1e-3)), eloD(g)];
  const wB = fitLogistic(TRAIN, fx, 2);
  const pBlend = (g) => { const x2 = fx(g); return sigm(wB[0] * x2[0] + wB[1] * x2[1]); };
  // engine recalibrated alone (slope on train): for reference
  const wE = fitLogistic(TRAIN, (g) => [logit(clip(pEng(g), 1e-3, 1 - 1e-3))], 1);
  // 7-bin reference: Elo winner probability x train method shares by format (corner-symmetric)
  const split = { 3: [0, 0, 0, 0, 0], 5: [0, 0, 0, 0, 0] };   // ko, sub, dec, draw, n
  for (const g of TRAIN) { const b = BIN[g]; if (b === null) continue; const s = split[F[g].rounds === 5 ? 5 : 3]; s[4]++; if (b === 0 || b === 6) s[0]++; else if (b === 1 || b === 5) s[1]++; else if (b === 3) s[3]++; else s[2]++; }
  const q7EloBase = (g) => {
    const s = split[F[g].rounds === 5 ? 5 : 3], pd = s[3] / s[4], dec = 1 - pd, pa = pElo(g) * dec, pb = (1 - pElo(g)) * dec, nd = s[4] - s[3];
    const ko = s[0] / nd, sb = s[1] / nd, de = s[2] / nd;
    return [pa * ko, pa * sb, pa * de, pd, pb * de, pb * sb, pb * ko];
  };

  function block(idxs) {
    const eng = winnerMetrics(idxs, pEng), elo = winnerMetrics(idxs, pElo), nai = winnerMetrics(idxs, pNaive), bl = winnerMetrics(idxs, pBlend);
    const engRecal = winnerMetrics(idxs, (g) => sigm(wE[0] * logit(clip(pEng(g), 1e-3, 1 - 1e-3))));
    const e7 = ll7Of(idxs, q7Eng), b7 = ll7Of(idxs, q7EloBase);
    const ag = aggregates(fin, idxs, N_FINAL), s = rates(ag.sim), a = rates(ag.act);
    const strip = (m) => ({ n: m.n, log_loss: r4(m.log_loss), brier: r4(m.brier), accuracy: r4(m.accuracy), ece: r4(m.ece), slope: r3(m.slope), sharpness: r4(m.sharpness) });
    return {
      n: idxs.length, engine: Object.assign(strip(eng), { outcome7_log_loss: r4(e7.log_loss), n7: e7.n }), elo: Object.assign(strip(elo), { outcome7_log_loss_with_base_methods: r4(b7.log_loss) }),
      blend: strip(bl), naive: strip(nai), engine_recalibrated: strip(engRecal),
      finish_rate: { sim: r4(s.fin), actual: r4(a.fin), error: r4(s.fin - a.fin) },
      method_split: { sim: { ko: r4(s.ko), sub: r4(s.sub), dec: r4(s.dec), draw: r4(s.draw) }, actual: { ko: r4(a.ko), sub: r4(a.sub), dec: r4(a.dec), draw: r4(a.draw) },
        abs_error_mean: r4((Math.abs(s.ko - a.ko) + Math.abs(s.sub - a.sub) + Math.abs(s.dec - a.dec) + Math.abs(s.draw - a.draw)) / 4) },
      rates_sim: s, rates_actual: a, stat_error: statError(fin, idxs), _bins: { engine: eng.bins, elo: elo.bins, blend: bl.bins }
    };
  }
  const RES = { train: block(TRAIN), test: block(TEST), val_2024_2025: block(VAL), y2026: block(Y2026) };

  // per-division (test)
  const divs = {};
  for (const g of TEST) { const d = F[g].prior_division || F[g].division; (divs[d] = divs[d] || []).push(g); }
  const perDiv = Object.entries(divs).sort((a, b) => b[1].length - a[1].length).map(([d, idxs]) => {
    const e = winnerMetrics(idxs, pEng), el = winnerMetrics(idxs, pElo), bl = winnerMetrics(idxs, pBlend), e7 = ll7Of(idxs, q7Eng);
    const ag = aggregates(fin, idxs, N_FINAL), s = rates(ag.sim), a = rates(ag.act);
    return { division: d, n: e.n, engine_log_loss: r4(e.log_loss), elo_log_loss: r4(el.log_loss), blend_log_loss: r4(bl.log_loss), engine_accuracy: r4(e.accuracy),
      elo_accuracy: r4(el.accuracy), engine_brier: r4(e.brier), outcome7_log_loss: r4(e7.log_loss), finish_sim: r4(s.fin), finish_actual: r4(a.fin),
      ko_sim: r4(s.ko), ko_actual: r4(a.ko), sub_sim: r4(s.sub), sub_actual: r4(a.sub) };
  });
  // per format (test)
  const perFormat = [3, 5].map((nr) => {
    const idxs = TEST.filter((g) => F[g].rounds === nr), e = winnerMetrics(idxs, pEng), el = winnerMetrics(idxs, pElo), ag = aggregates(fin, idxs, N_FINAL), s = rates(ag.sim), a = rates(ag.act);
    return { rounds: nr, n: e.n, engine_log_loss: r4(e.log_loss), elo_log_loss: r4(el.log_loss), engine_accuracy: r4(e.accuracy), finish_sim: r4(s.fin), finish_actual: r4(a.fin),
      by_round_sim: (nr === 5 ? s.r5 : s.r3).map(r4), by_round_actual: (nr === 5 ? a.r5 : a.r3).map(r4) };
  });

  // base-rate table (sim vs actual) on train and test
  function brTable(b) {
    const s = b.rates_sim, a = b.rates_actual, rows = [];
    const add = (metric, sv, av, unit) => rows.push({ metric, sim: unit === "%" ? r4(sv) : r3(sv), actual: unit === "%" ? r4(av) : r3(av), unit });
    add("finish rate", s.fin, a.fin, "%"); add("finish rate, 3 rounds", s.fin3, a.fin3, "%"); add("finish rate, 5 rounds", s.fin5, a.fin5, "%");
    add("KO/TKO (incl. doctor)", s.ko, a.ko, "%"); add("submission", s.sub, a.sub, "%"); add("decision", s.dec, a.dec, "%"); add("draw", s.draw, a.draw, "%");
    add("doctor stoppage (sim: doctor + corner)", s.doc, a.doc, "%");
    for (let r = 0; r < 3; r++) add(`3 rounds: finished in R${r + 1} (share of fights)`, s.r3[r], a.r3[r], "%");
    for (let r = 0; r < 5; r++) add(`5 rounds: finished in R${r + 1} (share of fights)`, s.r5[r], a.r5[r], "%");
    add("unanimous share of decisions", s.ud, a.ud, "%"); add("split share of decisions", s.sd, a.sd, "%"); add("majority share of decisions", s.md, a.md, "%");
    add("KD per 100 head strikes landed", s.kd100, a.kd100, ""); add("KD per 15 min per fighter", s.kd15, a.kd15, "");
    add("sig. strikes landed per 15 per fighter", s.sl15, a.sl15, ""); add("sig. strikes attempted per 15 per fighter", s.sa15, a.sa15, "");
    add("sig. strike accuracy", s.acc, a.acc, "%"); add("takedowns landed per 15", s.td15, a.td15, ""); add("takedown attempts per 15", s.ta15, a.ta15, "");
    add("takedown accuracy", s.tdAcc, a.tdAcc, "%"); add("control seconds per 15", s.ctrl15, a.ctrl15, ""); add("submission attempts per 15", s.sub15, a.sub15, "");
    add("average fight minutes", s.avgMin, a.avgMin, "");
    return rows;
  }

  // ---------------- Volkanovski vs Gaethje with the tuned parameters (current profiles, fighters.json priors)
  E.loadDB(fightersDb);
  const VG = { division: "Lightweight", rounds: 5, title: true, date: TODAY, params: over };
  const mVG = E.matchup("alexander-volkanovski", "justin-gaethje", VG);
  const NVG = QUICK ? 4000 : 20000;
  const sVG = E.summarize(mVG, NVG, 20261106);
  const fA = fightersDb.fighters["alexander-volkanovski"], fB = fightersDb.fighters["justin-gaethje"];
  const pEngVG = sVG.pA / (sVG.pA + sVG.pB);
  const pEloVG = 1 / (1 + Math.pow(10, -(fA.elo - fB.elo) / eloScale));
  const pBlendVG = sigm(wB[0] * logit(clip(pEngVG, 1e-3, 1 - 1e-3)) + wB[1] * (fA.elo - fB.elo) / 400);
  const vg = {
    matchup: "Alexander Volkanovski vs Justin Gaethje", division: "Lightweight", rounds: 5, title: true, n: NVG, seed: 20261106,
    win: { volkanovski: r4(sVG.pA), gaethje: r4(sVG.pB), draw: r4(sVG.pD) },
    bins: { labels: ["Volkanovski KO/TKO", "Volkanovski SUB", "Volkanovski DEC", "Draw", "Gaethje DEC", "Gaethje SUB", "Gaethje KO/TKO"], p: sVG.bins.map(r4) },
    finishes_by_round: { volkanovski: sVG.finA.map(r4), gaethje: sVG.finB.map(r4), ko_tko: sVG.finKO.map(r4), sub: sVG.finSUB.map(r4) },
    goes_distance: r4(sVG.dist), decisions: { UD: r4(sVG.dec.UD), SD: r4(sVG.dec.SD), MD: r4(sVG.dec.MD), DRAW: r4(sVG.dec.DRAW) },
    elo: { volkanovski: fA.elo, gaethje: fB.elo, p_volkanovski: r4(pEloVG) }, blend_p_volkanovski: r4(pBlendVG),
    kd_per_standing_head: { volkanovski: r4(mVG.kd[0]), gaethje: r4(mVG.kd[1]) },
    avg: { volkanovski: { sig_lnd: r3(sVG.avg.A.sig_lnd), td_lnd: r3(sVG.avg.A.td_lnd), kd: r3(sVG.avg.A.kd), ctrl: r3(sVG.avg.A.ctrl) },
      gaethje: { sig_lnd: r3(sVG.avg.B.sig_lnd), td_lnd: r3(sVG.avg.B.td_lnd), kd: r3(sVG.avg.B.kd), ctrl: r3(sVG.avg.B.ctrl) } }
  };

  const tuned = {};
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === "object") { tuned[k] = {}; for (const [k2, v2] of Object.entries(v)) tuned[k][k2] = +(+v2).toPrecision(4); }
    else tuned[k] = +(+v).toPrecision(4);
  }
  const cal = {
    version: "3.0.0", params_version: NOWRITE ? BASE.version : `3.0.0-wf-${TODAY}`, date: TODAY, generated: new Date().toISOString(), quick: QUICK,
    method: "walk-forward: frozen pre-fight snapshots, division priors from the 5 years before each fight's year; train 2019-2023 (tuning), test 2024-01-01 on (never tuned on). " +
      "Engine probabilities from N simulations per fight with fixed seeds; winner metrics exclude draws and no-contests; calibration bins use both corner orientations.",
    n_train: RES.train.engine.n, n_test: RES.test.engine.n, n_val_2024_2025: RES.val_2024_2025.engine.n, n_2026: RES.y2026.engine.n,
    n_sims_per_fight: N_FINAL, n_sims_tuning: FINAL_ONLY ? null : N_TUNE,
    metrics: {
      train: { engine: RES.train.engine, elo: RES.train.elo, blend: RES.train.blend, naive: RES.train.naive, engine_recalibrated: RES.train.engine_recalibrated },
      test: { engine: RES.test.engine, elo: RES.test.elo, blend: RES.test.blend, naive: RES.test.naive, engine_recalibrated: RES.test.engine_recalibrated },
      val_2024_2025: { engine: RES.val_2024_2025.engine, elo: RES.val_2024_2025.elo, blend: RES.val_2024_2025.blend, naive: RES.val_2024_2025.naive },
      y2026: { engine: RES.y2026.engine, elo: RES.y2026.elo, blend: RES.y2026.blend, naive: RES.y2026.naive }
    },
    calibration_bins_test: { engine: RES.test._bins.engine, elo: RES.test._bins.elo, blend: RES.test._bins.blend,
      note: "10 bins; every fight counted in both corner orientations (n = fights, each contributing two half-weight points)" },
    finish_and_method: { train: { finish_rate: RES.train.finish_rate, method_split: RES.train.method_split }, test: { finish_rate: RES.test.finish_rate, method_split: RES.test.method_split } },
    base_rates: { train: brTable(RES.train), test: brTable(RES.test) },
    stat_error: { train: RES.train.stat_error, test: RES.test.stat_error },
    per_division_test: perDiv, per_format_test: perFormat,
    blend: { features: ["logit(engine P(A))", "(Elo A - Elo B) / 400"], intercept: false, coef: wB.map((w) => +w.toFixed(4)), fit_on: "train" },
    engine_recalibration_slope_train: +wE[0].toFixed(4),
    elo_baseline: { scale: +eloScale.toFixed(1), rule: "P(A) = 1 / (1 + 10^(-(Elo A - Elo B) / scale)), scale fit on train; Elo is the snapshot's pre-fight rating (data/derived/elo_report.json: K 44, boost 1.5 under 5 fights)" },
    naive_baseline: { rule: "the man with more prior UFC wins (raw results before the fight date); probability fit on train; ties 0.5", p: +naiveP.toFixed(4) },
    tuning: FINAL_ONLY ? null : { info: tuneInfo, minutes: +tuneMin.toFixed(1), x: Object.fromEntries(Object.entries(x).map(([k, v]) => [k, +v.toPrecision(4)])), start_x: X0, history,
      objective: "winner log loss + 0.5 x 7-bin log loss + 0.02 x sum(((|dev| - tol) / tol)^2) for fin3 2 pts, fin5 4 pts, KO 2 pts, SUB 2 pts, UD share 4 pts, KD/100 10%" },
    tuned_params: tuned,
    before_tuning_test: beforeTest,
    volk_gaethje: vg,
    caveats: [
      "Division correction factors (params.div) come from the league-average self-calibration against fighters.json priors, which include 2024+ fights: a small base-rate leak into the test set (rates only, no outcomes per fight).",
      "Engine probabilities carry Monte Carlo noise (N per fight); log loss is inflated by about 1/(2N).",
      "Profiles are snapshots of UFC fights only; debutants are excluded (both men need a prior UFC fight)."
    ]
  };
  const minutesTotal = mins();
  cal.compute_minutes = +minutesTotal.toFixed(1);

  // ---------------- print summary
  const pr = (name, m) => `${name.padEnd(8)} LL ${m.log_loss.toFixed(4)}  Brier ${m.brier.toFixed(4)}  acc ${(100 * m.accuracy).toFixed(1)}%  ECE ${(100 * m.ece).toFixed(2)}%  slope ${m.slope.toFixed(2)}`;
  for (const sp of ["train", "test", "val_2024_2025", "y2026"]) {
    const b = RES[sp];
    console.log(`\n== ${sp} (n winner ${b.engine.n}, n 7-bin ${b.engine.n7}) ==`);
    console.log(pr("engine", b.engine) + `  7-bin LL ${b.engine.outcome7_log_loss.toFixed(4)}`);
    console.log(pr("elo", b.elo) + `  7-bin LL (Elo x base methods) ${b.elo.outcome7_log_loss_with_base_methods.toFixed(4)}`);
    console.log(pr("blend", b.blend)); console.log(pr("naive", b.naive)); console.log(pr("eng-rec", b.engine_recalibrated));
    console.log(`finish ${(100 * b.finish_rate.sim).toFixed(1)} vs ${(100 * b.finish_rate.actual).toFixed(1)}; KO ${(100 * b.method_split.sim.ko).toFixed(1)} vs ${(100 * b.method_split.actual.ko).toFixed(1)}; ` +
      `SUB ${(100 * b.method_split.sim.sub).toFixed(1)} vs ${(100 * b.method_split.actual.sub).toFixed(1)}; landed bias ${(100 * b.stat_error.sig_landed.bias).toFixed(1)}% MAE ${b.stat_error.sig_landed.mae.toFixed(1)} ` +
      `(div avg ${b.stat_error.sig_landed.mae_division_avg.toFixed(1)}), corr ${b.stat_error.sig_landed.corr_per_min.toFixed(3)}; TD bias ${(100 * b.stat_error.td_landed.bias).toFixed(1)}% MAE ${b.stat_error.td_landed.mae.toFixed(2)} (div avg ${b.stat_error.td_landed.mae_division_avg.toFixed(2)})`);
  }
  console.log("\nper division (test):"); for (const d of perDiv) console.log(`  ${d.division.padEnd(22)} n ${String(d.n).padStart(4)}  engine ${d.engine_log_loss.toFixed(4)}  elo ${d.elo_log_loss.toFixed(4)}  blend ${d.blend_log_loss.toFixed(4)}  fin ${(100 * d.finish_sim).toFixed(1)}/${(100 * d.finish_actual).toFixed(1)}`);
  console.log("per format (test):"); for (const d of perFormat) console.log(`  ${d.rounds} rounds n ${d.n}: engine ${d.engine_log_loss.toFixed(4)} elo ${d.elo_log_loss.toFixed(4)} fin ${(100 * d.finish_sim).toFixed(1)}/${(100 * d.finish_actual).toFixed(1)} by round ${d.by_round_sim.map((v) => (100 * v).toFixed(1)).join("/")} vs ${d.by_round_actual.map((v) => (100 * v).toFixed(1)).join("/")}`);
  console.log(`blend coef ${JSON.stringify(cal.blend.coef)}; Elo scale ${cal.elo_baseline.scale}; naive p ${cal.naive_baseline.p}; engine recal slope ${cal.engine_recalibration_slope_train}`);
  console.log(`Volk vs Gaethje: ${JSON.stringify(vg.win)} bins ${JSON.stringify(vg.bins.p)} distance ${vg.goes_distance}`);
  console.log(`  finishes by round Volk ${JSON.stringify(vg.finishes_by_round.volkanovski)} Gaethje ${JSON.stringify(vg.finishes_by_round.gaethje)}; blend P(Volk) ${vg.blend_p_volkanovski}`);
  console.log("tuned: " + JSON.stringify(tuned));

  if (!NOWRITE) {
    fs.writeFileSync(path.join(ROOT, "data/derived/calibration.json"), JSON.stringify(cal, null, 1));
    log("wrote data/derived/calibration.json");
    if (!FINAL_ONLY) { writeParams(x, cal); log("wrote src/params3.js"); }
  } else {
    fs.writeFileSync(path.join(os.tmpdir(), "calibration_preview.json"), JSON.stringify(cal, null, 1));
    log("--no-write: preview in " + path.join(os.tmpdir(), "calibration_preview.json"));
  }
  log("done");
})().catch((e) => { console.error(e); process.exit(1); });

// ------------------------------------------------------------------ write tuned values into src/params3.js (comments kept)
function writeParams(x, cal) {
  let src = fs.readFileSync(PARAMS, "utf8");
  const over = buildOver(x), tag = `[walkfwd ${TODAY}]`;
  const fmt = (v) => String(+(+v).toPrecision(4));
  function rep(text, key, val) {
    const re = new RegExp("^(\\s*)" + key + ":\\s*([-0-9.eE/ ]+?)(,?)(\\s*)//\\s*(\\[(?:selfcal|walkfwd[^\\]]*)\\]\\s*)?", "m");
    const m = re.exec(text);
    if (!m) { console.log("  (could not find " + key + " in params3.js)"); return text; }
    const old = m[2].trim();
    let oldNum; try { oldNum = Function("return (" + old + ")")(); } catch (e) { oldNum = old; }
    const was = typeof oldNum === "number" && Math.abs(oldNum - +val) > 1e-9 ? `; was ${+oldNum.toPrecision(4)}` : "";
    return text.replace(re, `${m[1]}${key}: ${fmt(val)}${m[3]}${m[4]}// ${tag.slice(0, -1)}${was}] `);
  }
  function repBlock(text, blockName, entries) {
    const start = text.indexOf("\n    " + blockName + ": {");
    if (start < 0) { console.log("  (no block " + blockName + ")"); return text; }
    let depth = 0, end = -1;
    for (let i = text.indexOf("{", start); i < text.length; i++) { if (text[i] === "{") depth++; else if (text[i] === "}") { depth--; if (depth === 0) { end = i; break; } } }
    let body = text.slice(start, end);
    for (const [k, v] of Object.entries(entries)) body = rep(body, k, v);
    return text.slice(0, start) + body + text.slice(end);
  }
  const top = ["strikeScale", "accScale", "kdScale", "tdScale", "tdOddsScale", "ctrlScale", "subAttScale", "subConvScale", "kdInstant", "kdRefStop",
    "stko", "gnpTko", "chinAge", "powAge", "powExp", "chinExp", "chinKO", "sizeChin", "r1Caution5", "drainSchedExp", "caution5"];
  for (const k of top) src = rep(src, k, over[k]);
  src = repBlock(src, "form", { out: over.form.out, pow: over.form.pow, chin: over.form.chin, vol: over.form.vol, acc: over.form.acc, grap: over.form.grap });
  src = repBlock(src, "judge", { sharedSd: over.judge.sharedSd, indSd: over.judge.indSd });
  src = src.replace(/version: "[^"]*"/, `version: "3.0.0-wf-${TODAY}"`);
  // calibration note in the header
  const t = cal.metrics.test, tr = cal.metrics.train;
  const note = `   Walk-forward calibration (tools/calibrate.js, ${TODAY}): values marked [walkfwd] were tuned on 2019-2023 backtest fights
   (n=${cal.n_train}, frozen pre-fight snapshots) and checked on 2024-01-01 .. 2026-10-31 (n=${cal.n_test}, never tuned on).
   Test: winner log loss ${t.engine.log_loss} (Elo ${t.elo.log_loss}, blend ${t.blend.log_loss}), Brier ${t.engine.brier}, accuracy ${(100 * t.engine.accuracy).toFixed(1)}%,
   ECE ${(100 * t.engine.ece).toFixed(1)}%, 7-bin log loss ${t.engine.outcome7_log_loss}. Train: winner log loss ${tr.engine.log_loss} (Elo ${tr.elo.log_loss}).
   Details: data/derived/calibration.json and docs/CHANGELOG.md. Re-running tests/test_engine3.js --fit --write would overwrite some of them. */`;
  src = src.replace(/(   Values marked \[selfcal\][\s\S]*?)(\s*\*\/)/, (all, a) => {
    const cleaned = a.replace(/\n   Walk-forward calibration \(tools\/calibrate\.js[\s\S]*$/, "");
    return cleaned + "\n" + note;
  });
  fs.writeFileSync(PARAMS, src);
}
