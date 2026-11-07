#!/usr/bin/env node
/* predict_eval.js: score FightEngine.predict (the prediction package: blend P(win), method x round rescaled to it and pooled
   with S / SM, calibrated interval; engine component blend_anchor) of a FROZEN engine version on backtest_dev.json, next to
   the benchmarks the package has to be judged against (market close and open, the ML logistic, ML v2, Elo, method/round
   model S / SM, the simulator alone).

     node tools/predict_eval.js --version v5 --split val --stack data/derived/blindtest_stack_pre2024_v5.json \
          [--kinds close,open,none] [--anchor] [--sims 1000] [--workers 3] [--out data/derived/evalv/v5_val_package.json]
     node tools/predict_eval.js --version v5 --split train --in-sample --limit 60 ...   (plumbing check on train fights only)

   Inputs per fight and corner order are leak-free and built exactly like tools/evalv.js (as-of priors, out-of-fold learned
   rates, durability walk-forward records + train-only NORM, SOS pairs, step-4 inputs via the frozen copy's mlpathrec.js),
   plus tools/predictrec.js (the stacker fit on 2023 or earlier, the line by lineKind, walk-forward experts, walk-forward
   method/round cells, ML v2 rows). opts.feat = data/derived/moe_page.json's feature LR with its 2010-2023 coefficients
   (coef_valid, the backtest default) so the interval carries the production profile noise; the point estimate never uses
   it (every validation fight has the blind replay's walk-forward feat_lr). Seeds: hash(fight id) (common random numbers
   across line kinds). predict runs both corner orders itself (FightBlend.swapOpts).
   lineKind 'close' / 'open' fall back to 'none' on fights without that line (flagged lineMissing): the product as used.

   Metrics (95% event-cluster bootstrap, 2,000 resamples; paired differences on the same fights): winner log loss, Brier,
   accuracy, ECE (10 bins, mirrored), calibration slope (mirrored, no intercept); 7-bin and method (KO / SUB / DEC) log loss;
   who x how x when and the other method/round metrics via `python3 tools/methodround.py --score` (paired against model S);
   interval coverage of the closing line (calibrated 80% / 95%). Every probability is P(first-named fighter A).
   Never reads a 2026 fight (dropped on load, refused by predictrec). Validation runs are part of a version's single look:
   run once, record in data/derived/version_history.json. */
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const VAULT_FROM = "2026-01-01";
const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"] };
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function readJSON(p) { return JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8")); }
function loadBacktest() {
  const bt = readJSON("data/derived/backtest_dev.json");
  const keys = bt.meta.keys;
  const fights = bt.fights.filter((f) => f.date < VAULT_FROM);
  for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
  return fights;
}
const r6 = (x) => (x == null || !isFinite(x) ? x : Math.round(x * 1e6) / 1e6);

// ================================================================== worker
if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(W.engineDir, "engine3.js"));
  const PRM = E.params();
  if (!(PRM.components && PRM.components.blend_anchor)) throw new Error("predict_eval: components.blend_anchor is off in " + W.engineDir);
  const fights = loadBacktest();
  const byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON("data/derived/mlrates_oof.json");
  const names = OOF.meta.targets;
  const rates = (arr) => { const o = {}; names.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  const useDur = typeof E.loadDurability === "function" && !!(PRM.components && PRM.components.durability);
  const DURJ = useDur ? readJSON("data/derived/durability.json") : null;
  const durNorm = useDur ? { durability: { normChin: DURJ.engine.norm_chin_backtest_2019_2023, normPow: DURJ.engine.norm_pow_backtest_2019_2023 } } : null;
  function durOpts(id, o) {
    const d = DURJ.backtest[id];
    if (!d) throw new Error("durability: no walk-forward record for " + id);
    const side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
    // v5.0.1 (v5 review): refuse a record with a missing or invalid field (the engine would fill it from the live fit)
    const ok = (v) => typeof v === "number" && isFinite(v) && v > 0;
    for (const s of ["A", "B"]) for (const k of ["chin_re", "chin_cov", "pow_re", "pow_cov"]) if (!d[s] || !ok(d[s][k])) throw new Error("durability: record " + id + " " + s + "." + k + " is not a finite positive number");
    if (!d.p || !ok(d.p.A) || !ok(d.p.B)) throw new Error("durability: record " + id + " has no valid p.A / p.B");
    const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
    const base = Math.sqrt(bA * bB);
    return o === 0 ? { A: side(d.A), B: side(d.B), base } : { A: side(d.B), B: side(d.A), base };
  }
  const SSC = PRM.components && PRM.components.styles_sos;
  const useSOS = !!SSC && (SSC === true || SSC.sos !== false) && ((PRM.stylesSOS && PRM.stylesSOS.sosSource) || "wf") === "wf";
  const SOSJ = useSOS ? readJSON("data/derived/sos_wf.json") : null;
  function sosParams(f, params) {
    const y = f.date.slice(0, 4), M = SOSJ.meta;
    const coef = f.date < "2024-01-01" ? { ml: M.coef_loyo.ml[y], base: M.coef_loyo.base[y] } : { ml: M.coef.ml, base: M.coef.base };
    if (!coef.ml || !coef.base) throw new Error("styles_sos: no coefficients for " + f.date);
    const p = Object.assign({}, params || {});
    p.stylesSOS = Object.assign({}, p.stylesSOS || {}, { sosCoef: coef });
    return p;
  }
  const XR = require(W.mlpathrec)(E, ROOT);
  const PR = require(path.join(ROOT, "tools/predictrec.js"))(E, ROOT, { stack: W.stack, inSample: !!W.inSample });
  const FEAT = readJSON("data/derived/moe_page.json");
  // the A-B (o = 0) matchup options, identical to tools/evalv.js; predict builds the B-A run with FightBlend.swapOpts
  function baseOpts(f) {
    const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
    const ent = OOF.fights[f.id];
    opts.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
    if (useDur) { opts.dur = durOpts(f.id, 0); opts.params = durNorm; }
    if (useSOS) {
      const s = SOSJ.fights[f.id];
      if (!s || !s.A || !s.B) throw new Error("styles_sos: no walk-forward pair for " + f.id);
      opts.sos = { A: s.A, B: s.B }; opts.params = sosParams(f, opts.params);
    }
    XR.apply(opts, f, false, opts.params);
    return opts;
  }
  parentPort.on("message", (msg) => {
    if (msg.cmd !== "run") return;
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id);
      const rec = { id, err: null, kinds: {} };
      try {
        const b = baseOpts(f);
        // assert the evalv inputs on both corner orders (the B-A matchup is predict's own swapOpts)
        const FB = require(path.join(W.engineDir, "ml", "blend.js"));
        for (const [o, oo] of [[0, b], [1, FB.swapOpts(b)]]) {
          const m = E.matchup(o === 0 ? f.A : f.B, o === 0 ? f.B : f.A, oo);
          XR.assertApplied(m, f.id, oo.params);
          if (useDur && !(m.dur && m.dur.baseFromRecord)) throw new Error("durability not applied for " + f.id);
          if (useDur && (m.dur.A.src !== "record" || m.dur.B.src !== "record")) throw new Error("durability: computed chin / power fields used for " + f.id);
          if (useSOS && !(m.stylesSOS && m.stylesSOS.sos && m.stylesSOS.sos.have && m.stylesSOS.sos.have[0] && m.stylesSOS.sos.have[1])) throw new Error("SOS not applied for " + f.id);
          if (b.ml && !m.mlApplied) throw new Error("learned rates not applied for " + f.id);
        }
        for (const kind of W.kinds) {
          for (const anc of W.anchorModes) {
            const o = Object.assign({}, b, PR.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), feat: FEAT, sims: W.sims });
            if (anc) o.anchor = true;
            const pk = E.predict(f.A, f.B, o);
            const iv = pk.interval || {};
            rec.kinds[kind + (anc ? "_anchor" : "")] = {
              p: r6(pk.p), pRaw: r6(pk.pRaw), source: pk.source, blendError: pk.blendError || null, lineKind: pk.lineKind,
              lineMissing: o.lineMissing || null, regime: pk.stack ? pk.stack.regime : null, line: pk.line ? r6(pk.line.p) : null,
              cells: pk.cells.map(r6), R: pk.R, pD: r6(pk.pD), simP: r6(pk.sim.p), simCells: pk.sim.cells.map(r6),
              mrWeight: pk.methodRound.weight, mrVariant: pk.methodRound.variant,
              ml2p: pk.ml2 ? r6(pk.ml2.p) : null, experts: Object.fromEntries(Object.entries(pk.experts).map(([k, v]) => [k, r6(v)])),
              weights: pk.blend && pk.blend.weights ? Object.fromEntries(Object.entries(pk.blend.weights).map(([k, v]) => [k, r6(v)])) : null,
              iv80: iv.calibrated ? iv.calibrated["0.8"].map(r6) : null, iv95: iv.calibrated ? iv.calibrated["0.95"].map(r6) : null,
              ivRaw80: iv.levels ? (iv.levels["0.8"] || []).map(r6) : null,
              anchorS: pk.anchor ? r6(pk.anchor.s) : null, anchorP: pk.anchor ? r6(pk.anchor.p) : null
            };
          }
        }
      } catch (e) { rec.err = String((e && e.stack) || e).slice(0, 600); }
      out.push(rec);
    }
    parentPort.postMessage({ cmd: "done", out });
  });
  return;
}

// ================================================================== main
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
if (!args.version) { console.error("predict_eval: --version vN is required"); process.exit(2); }
const VERSION = String(args.version), SPLIT = String(args.split || "train");
if (!SPLITS[SPLIT]) { console.error("predict_eval: --split train | val"); process.exit(2); }
const ENGINE_DIR = path.resolve(ROOT, args["engine-dir"] || path.join("versions", VERSION));
const STACK = args.stack || "data/derived/blindtest_stack_pre2024.json";
const KINDS = String(args.kinds || "close,open,none").split(",");
const ANCHOR = args.anchor ? (args["anchor-only"] ? [true] : [false, true]) : [false];
const SIMS = +(args.sims || 1000);
const WORKERS = Math.max(1, Math.min(3, +(args.workers || 3)));
const B = +(args.boot || 2000);
const LIMIT = args.limit ? +args.limit : null;
const OUT = args.out || path.join("data/derived/evalv", `${VERSION}_${SPLIT}_package${LIMIT ? "_smoke" : ""}.json`);
const MLP_FILE = fs.existsSync(path.join(ENGINE_DIR, "mlpathrec.js")) ? path.join(ENGINE_DIR, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js");
if (SPLIT === "train" && !args["in-sample"]) { console.error("predict_eval: train fights sit inside the pre-2024 stacker: pass --in-sample (diagnostic only)"); process.exit(2); }
const stackDoc = readJSON(STACK);
const fightsAll = loadBacktest();
const [d0, d1] = SPLITS[SPLIT];
let fights = fightsAll.filter((f) => f.date >= d0 && f.date < d1);
if (LIMIT) fights = fights.slice(-LIMIT);
const E0 = require(path.join(ENGINE_DIR, "engine3.js"));
console.log(`predict_eval ${VERSION} (engine ${E0.VERSION}, params ${E0.params().version}) on ${SPLIT}: ${fights.length} fights, kinds ${KINDS.join("/")}` +
  `${args.anchor ? " (+ anchor mode)" : ""}, ${SIMS} sims per order, stack ${STACK} (engine expert ${(stackDoc.meta.usage || "").split("'engine' expert = ")[1] || "?"})`);

function runAll() {
  return new Promise((resolve, reject) => {
    const ids = fights.map((f) => f.id), chunks = [];
    for (let i = 0; i < ids.length; i += 20) chunks.push(ids.slice(i, i + 20));
    const res = []; let next = 0, live = 0, done = 0; const t0 = Date.now();
    function feed(w) {
      if (next >= chunks.length) { w.terminate(); live--; if (live === 0) resolve(res); return; }
      w.postMessage({ cmd: "run", ids: chunks[next++] });
    }
    for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
      const w = new Worker(__filename, { workerData: { engineDir: ENGINE_DIR, stack: path.isAbsolute(STACK) ? STACK : path.join(ROOT, STACK), inSample: !!args["in-sample"],
        kinds: KINDS, anchorModes: ANCHOR, sims: SIMS, mlpathrec: MLP_FILE } });
      live++;
      w.on("message", (m) => {
        if (m.cmd === "done") {
          res.push(...m.out); done += m.out.length;
          if (done % 100 < m.out.length) console.log(`  ${done}/${ids.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
          feed(w);
        }
      });
      w.on("error", reject);
      feed(w);
    }
  });
}

// ------------------------------------------------------------------ outcomes and losses
function outcome(f) {
  const r = f.result || {};
  const cls = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DRAW" }[r.method] || null;
  if (!cls || (cls !== "DRAW" && r.winner !== "A" && r.winner !== "B")) return null;
  return { winner: cls === "DRAW" ? "D" : r.winner, cls, round: r.round || 1 };
}
const clip = (x, lo, hi) => (x < lo ? lo : (x > hi ? hi : x));
const PCLIP = 1e-4;
function bins7(c, R) {
  const s = (a, b) => { let t = 0; for (let i = a; i < b; i++) t += c[i]; return t; };
  return [s(0, R), s(R, 2 * R), c[4 * R], c[4 * R + 2], c[4 * R + 1], s(3 * R, 4 * R), s(2 * R, 3 * R)];
}
function k7(y) { return y.cls === "DRAW" ? 3 : (y.cls === "DEC" ? (y.winner === "A" ? 2 : 4) : (y.cls === "SUB" ? (y.winner === "A" ? 1 : 5) : (y.winner === "A" ? 0 : 6))); }
function winLoss(p, y) {
  if (!y || (y.winner !== "A" && y.winner !== "B") || p == null || !isFinite(p)) return null;
  const yy = y.winner === "A" ? 1 : 0, q = clip(p, PCLIP, 1 - PCLIP);
  return { winLL: -(yy * Math.log(q) + (1 - yy) * Math.log(1 - q)), brier: (q - yy) * (q - yy), acc: q === 0.5 ? 0.5 : ((q > 0.5) === (yy === 1) ? 1 : 0), _p: q, _y: yy };
}
function cellLoss(cells, R, y) {
  if (!y || !cells) return null;
  const tot = cells.reduce((a, b) => a + b, 0);
  const b7 = bins7(cells, R).map((v) => clip(v / tot, 1e-6, 1));
  const s3 = { KO: b7[0] + b7[6], SUB: b7[1] + b7[5], DEC: b7[2] + b7[3] + b7[4] };
  return { bin7: -Math.log(b7[k7(y)]), method: -Math.log(s3[y.cls === "DRAW" ? "DEC" : y.cls]) };
}
function ece(ps, ys) {
  const bins = new Array(10).fill(0).map(() => [0, 0, 0]);
  for (let i = 0; i < ps.length; i++) for (const [p, y] of [[ps[i], ys[i]], [1 - ps[i], 1 - ys[i]]]) {
    const b = Math.min(9, Math.floor(p * 10)); bins[b][0]++; bins[b][1] += p; bins[b][2] += y;
  }
  let e = 0, n = 0; for (const b of bins) n += b[0];
  for (const b of bins) if (b[0]) e += b[0] / n * Math.abs(b[1] / b[0] - b[2] / b[0]);
  return e;
}
function calSlope(ps, ys) {
  let beta = 1;
  for (let it = 0; it < 30; it++) {
    let g = 0, h = 0;
    for (let i = 0; i < ps.length; i++) for (const [p, y] of [[ps[i], ys[i]], [1 - ps[i], 1 - ys[i]]]) {
      const x = Math.log(p / (1 - p)), q = 1 / (1 + Math.exp(-beta * x)); g += (y - q) * x; h += q * (1 - q) * x * x;
    }
    beta += g / Math.max(1e-9, h);
  }
  return beta;
}
function groupsOf(fs_) {
  const ev = new Map();
  fs_.forEach((f, i) => { const k = f.event + "|" + f.date; if (!ev.has(k)) ev.set(k, []); ev.get(k).push(i); });
  return [...ev.values()];
}
function rngOf(seed) { let st = seed >>> 0; return () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; }; }
// bootstrap of one model's per-fight losses (rows aligned with fs_; null = not scored) + ECE / slope
function boot1(fs_, L, keys) {
  const G = groupsOf(fs_), rnd = rngOf(12345), out = {};
  const point = {}, draws = {};
  for (const k of keys) { const v = L.map((l) => l && l[k]).filter((x) => x != null && isFinite(x)); point[k] = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length); draws[k] = []; point["n_" + k] = v.length; }
  const wi = L.map((l, i) => (l && l._p != null ? i : -1)).filter((i) => i >= 0);
  point.ece = ece(wi.map((i) => L[i]._p), wi.map((i) => L[i]._y)); point.calSlope = calSlope(wi.map((i) => L[i]._p), wi.map((i) => L[i]._y));
  draws.ece = []; draws.calSlope = [];
  for (let b = 0; b < B; b++) {
    const sums = {}, cnt = {}; for (const k of keys) { sums[k] = 0; cnt[k] = 0; }
    const ps = [], ys = [];
    for (let g = 0; g < G.length; g++) for (const i of G[Math.floor(rnd() * G.length)]) {
      const l = L[i]; if (!l) continue;
      for (const k of keys) { const v = l[k]; if (v != null && isFinite(v)) { sums[k] += v; cnt[k]++; } }
      if (l._p != null && b < 400) { ps.push(l._p); ys.push(l._y); }
    }
    for (const k of keys) draws[k].push(sums[k] / Math.max(1, cnt[k]));
    if (b < 400) { draws.ece.push(ece(ps, ys)); draws.calSlope.push(calSlope(ps, ys)); }
  }
  for (const k of Object.keys(draws)) {
    const d = draws[k].slice().sort((a, b) => a - b);
    out[k] = { est: point[k], lo: d[Math.floor(0.025 * d.length)], hi: d[Math.min(d.length - 1, Math.floor(0.975 * d.length))], n: point["n_" + k] };
  }
  return out;
}
// paired difference a - b on the fights where both are scored
function paired(fs_, La, Lb, keys) {
  const G = groupsOf(fs_), rnd = rngOf(777), out = {};
  for (const k of keys) {
    const d = La.map((l, i) => (l && Lb[i] && l[k] != null && Lb[i][k] != null ? l[k] - Lb[i][k] : null));
    const v = d.filter((x) => x != null), est = v.reduce((a, b) => a + b, 0) / Math.max(1, v.length);
    const ds = [];
    for (let b = 0; b < B; b++) {
      let s = 0, c = 0;
      for (let g = 0; g < G.length; g++) for (const i of G[Math.floor(rnd() * G.length)]) if (d[i] != null) { s += d[i]; c++; }
      ds.push(s / Math.max(1, c));
    }
    ds.sort((a, b) => a - b);
    out[k] = { diff: est, lo: ds[Math.floor(0.025 * B)], hi: ds[Math.floor(0.975 * B)], n: v.length };
  }
  return out;
}
function methodroundScore(tag, cellsById) {
  const dir = path.join(ROOT, "out", "evalv"); fs.mkdirSync(dir, { recursive: true });
  const inp = path.join(dir, `${tag}_${SPLIT}_cells.json`), outp = path.join(dir, `${tag}_${SPLIT}_methodround.json`);
  const sub = {}; for (const id in cellsById) sub[id] = { cells: cellsById[id].map((v) => +v.toFixed(6)) };
  fs.writeFileSync(inp, JSON.stringify(sub));
  try {
    execFileSync("python3", [path.join(ROOT, "tools/methodround.py"), "--score", inp, "--score-from", d0, "--score-until", d1,
      "--score-out", outp, "--backtest", path.join(ROOT, "data/derived/backtest_dev.json")], { stdio: ["ignore", "pipe", "pipe"], env: Object.assign({}, process.env, { OMP_NUM_THREADS: "1" }) });
    return JSON.parse(fs.readFileSync(outp, "utf8"));
  } catch (e) { return { error: String(e.stderr || e.message).slice(-2000) }; }
}
function rnd4(o) { if (Array.isArray(o)) return o.map(rnd4); if (o && typeof o === "object") { const q = {}; for (const k in o) q[k] = rnd4(o[k]); return q; } return typeof o === "number" ? Math.round(o * 1e4) / 1e4 : o; }

(async function main() {
  const t0 = Date.now();
  const recs = await runAll();
  const errs = recs.filter((r) => r.err);
  if (errs.length) { console.log(`  ${errs.length} fights failed, e.g. ${errs[0].id}: ${errs[0].err}`); }
  const byId = new Map(recs.filter((r) => !r.err).map((r) => [r.id, r]));
  const fsOk = fights.filter((f) => byId.has(f.id));
  const Y = fsOk.map(outcome);
  const MK = readJSON("data/derived/market.json").fights, MR = readJSON("data/derived/methodround.json").fights;
  const BTJ = readJSON("data/derived/blindtest.json").fights, MLJ = readJSON("data/derived/ml.json").fights, ML2 = readJSON("data/derived/ml2.json").fights;
  const EV = fs.existsSync(path.join(ROOT, `data/derived/evalv/${VERSION}_${SPLIT}.json`)) ? new Map(readJSON(`data/derived/evalv/${VERSION}_${SPLIT}.json`).fights.map((x) => [x.id, x])) : new Map();
  const num = (x) => (typeof x === "number" && isFinite(x) ? x : null);
  const bt = (f, k) => { const v = ((BTJ[f.id] || {}).p || {})[k]; return v && num(v[0]) != null && (!v[2] || v[2] < f.date) ? v[0] : null; };
  const sCells = (f, key) => { const r = MR[f.id]; if (!r) return null; const c = r[key + "_refit"] ? r[key + "_refit"] : r[key]; return Array.isArray(c) ? c : null; };
  const sP = (c, R) => { if (!c) return null; const b = bins7(c, R); const a = b[0] + b[1] + b[2], bb = b[4] + b[5] + b[6]; return a / (a + bb); };
  const kinds = Object.keys(byId.get(fsOk[0].id).kinds);
  // winner probabilities per model
  const models = {};
  for (const k of kinds) models["package_" + k] = fsOk.map((f) => byId.get(f.id).kinds[k].p);
  models.sim_package = fsOk.map((f) => byId.get(f.id).kinds[kinds[0]].simP);
  if (EV.size) models["engine_evalv_" + VERSION] = fsOk.map((f) => (EV.get(f.id) || {}).pA ?? null);
  models.market_close = fsOk.map((f) => num((MK[f.id] || {}).p_power_close) ?? num((MK[f.id] || {}).p_novig_close));
  models.market_open = fsOk.map((f) => num((MK[f.id] || {}).p_novig_open));
  // the package's own `ml` / `elo` expert inputs (tools/predictrec.js): blind replay rows on 2024-2025, ml.json oof / blend_anchor_dev.json on train
  const BAD = fs.existsSync(path.join(ROOT, "data/derived/blend_anchor_dev.json")) ? readJSON("data/derived/blend_anchor_dev.json").fights : {};
  models.ml_lr_walkforward = fsOk.map((f) => (f.date >= "2024-01-01" ? bt(f, "ml_lr") : ((MLJ[f.id] || {}).set === "oof" ? num(MLJ[f.id].lr) : null)));
  models.ml_lr_static = fsOk.map((f) => { const r = MLJ[f.id] || {}; return f.date >= "2024-01-01" ? (r.set === "test" ? num(r.lr) : null) : (r.set === "oof" ? num(r.lr) : null); });
  models.ml2_lr = fsOk.map((f) => { const r = ML2[f.id] || {}; return (f.date >= "2024-01-01" ? r.set === "valid" : r.set === "oof") ? num(r.ml2_lr) : null; });
  models.elo_walkforward = fsOk.map((f) => (f.date >= "2024-01-01" ? bt(f, "elo") : num((BAD[f.id] || {}).elo)));
  models.mkt_rating = fsOk.map((f) => num((MK[f.id] || {}).p_market_rating));
  models.model_S = fsOk.map((f) => sP(sCells(f, "S"), f.rounds === 5 ? 5 : 3));
  models.model_SM = fsOk.map((f) => sP(sCells(f, "SM"), f.rounds === 5 ? 5 : 3));
  const WL = {};
  for (const m in models) WL[m] = models[m].map((p, i) => winLoss(p, Y[i]));
  // cell-based losses
  const CL = {};
  for (const k of kinds) CL["package_" + k] = fsOk.map((f, i) => { const r = byId.get(f.id).kinds[k]; return cellLoss(r.cells, r.R, Y[i]); });
  CL.sim_package = fsOk.map((f, i) => { const r = byId.get(f.id).kinds[kinds[0]]; return cellLoss(r.simCells, r.R, Y[i]); });
  CL.model_S = fsOk.map((f, i) => cellLoss(sCells(f, "S"), f.rounds === 5 ? 5 : 3, Y[i]));
  CL.model_SM = fsOk.map((f, i) => cellLoss(sCells(f, "SM"), f.rounds === 5 ? 5 : 3, Y[i]));
  const merge = (m) => fsOk.map((f, i) => { const a = WL[m] ? WL[m][i] : null, c = CL[m] ? CL[m][i] : null; return a || c ? Object.assign({}, a || {}, c || {}) : null; });
  const KEYS = ["winLL", "brier", "acc", "bin7", "method"];
  const res = { models: {}, paired: {}, coverage: {}, methodround: {}, lineMissing: {}, sources: {}, weights: {} };
  for (const m of new Set(Object.keys(WL).concat(Object.keys(CL)))) res.models[m] = boot1(fsOk, merge(m), KEYS);
  // common decisive set for the winner table: every package kind + close + ML + Elo + S present
  const common = fsOk.map((f, i) => ["market_close", "ml_lr_walkforward", "elo_walkforward", "model_S"].concat(kinds.map((k) => "package_" + k)).every((m) => WL[m][i]));
  res.common = { n: common.filter(Boolean).length, models: {} };
  const onCommon = (m) => merge(m).map((l, i) => (common[i] ? l : null));
  for (const m of Object.keys(WL)) res.common.models[m] = boot1(fsOk, onCommon(m), ["winLL", "brier", "acc"]);
  const refs = ["market_close", "market_open", "ml_lr_walkforward", "ml_lr_static", "ml2_lr", "elo_walkforward", "mkt_rating", "model_S", "model_SM", "sim_package"].concat(EV.size ? ["engine_evalv_" + VERSION] : []);
  for (const k of kinds) {
    const pm = "package_" + k;
    res.paired[pm] = {};
    for (const r of refs) res.paired[pm]["vs_" + r] = paired(fsOk, merge(pm), merge(r), KEYS);
    // coverage of the closing line by the calibrated interval (fights with a close)
    let n = 0, c80 = 0, c95 = 0, w80 = 0, w95 = 0;
    fsOk.forEach((f, i) => {
      const r = byId.get(f.id).kinds[k], q = models.market_close[i];
      if (!r.iv80 || q == null) return;
      n++; if (q >= r.iv80[0] && q <= r.iv80[1]) c80++; if (q >= r.iv95[0] && q <= r.iv95[1]) c95++;
      w80 += r.iv80[1] - r.iv80[0]; w95 += r.iv95[1] - r.iv95[0];
    });
    res.coverage[pm] = { n, cover80_close: n ? c80 / n : null, cover95_close: n ? c95 / n : null, width80: n ? w80 / n : null, width95: n ? w95 / n : null };
    res.lineMissing[pm] = fsOk.filter((f) => byId.get(f.id).kinds[k].lineMissing).length;
    const src = {}; fsOk.forEach((f) => { const r = byId.get(f.id).kinds[k]; const s = r.source + (r.blendError ? " (error)" : ""); src[s] = (src[s] || 0) + 1; }); res.sources[pm] = src;
    // mean stack weights by regime
    const wsum = {}, wn = {};
    fsOk.forEach((f) => { const r = byId.get(f.id).kinds[k]; if (!r.weights) return; const g = r.regime || "?"; wn[g] = (wn[g] || 0) + 1; wsum[g] = wsum[g] || {}; for (const e in r.weights) wsum[g][e] = (wsum[g][e] || 0) + r.weights[e]; });
    res.weights[pm] = Object.fromEntries(Object.entries(wsum).map(([g, w]) => [g, Object.assign({ n: wn[g] }, Object.fromEntries(Object.entries(w).map(([e, v]) => [e, v / wn[g]])))]));
    // who x how x when (methodround --score, paired vs model S)
    const cb = {}; fsOk.forEach((f) => { cb[f.id] = byId.get(f.id).kinds[k].cells; });
    res.methodround[pm] = methodroundScore(`${VERSION}pkg_${k}`, cb);
  }
  { const cb = {}; fsOk.forEach((f) => { cb[f.id] = byId.get(f.id).kinds[kinds[0]].simCells; }); res.methodround.sim_package = methodroundScore(`${VERSION}pkgsim`, cb); }
  // base rates of the package (mean predicted vs actual) on fights with an outcome
  res.baseRates = {};
  for (const k of kinds.concat(["sim"])) {
    let n = 0, ko = 0, sub = 0, dec = 0, aKO = 0, aSUB = 0, aDEC = 0;
    fsOk.forEach((f, i) => {
      const y = Y[i]; if (!y) return;
      const r = byId.get(f.id).kinds[k === "sim" ? kinds[0] : k], c = k === "sim" ? r.simCells : r.cells, R = r.R, b = bins7(c, R), t = b.reduce((a, x) => a + x, 0);
      n++; ko += (b[0] + b[6]) / t; sub += (b[1] + b[5]) / t; dec += (b[2] + b[3] + b[4]) / t;
      if (y.cls === "KO") aKO++; else if (y.cls === "SUB") aSUB++; else aDEC++;
    });
    res.baseRates[k] = { n, KO: [ko / n, aKO / n], SUB: [sub / n, aSUB / n], DEC: [dec / n, aDEC / n] };
  }
  const doc = { meta: { tool: "tools/predict_eval.js", version: VERSION, split: SPLIT, range: [d0, d1], built: new Date().toISOString(), engine_dir: path.relative(ROOT, ENGINE_DIR),
      engine_version: E0.VERSION, params_version: E0.params().version, stack: STACK, stack_engine: (stackDoc.meta.usage || "").split("'engine' expert = ")[1] || null,
      stack_fit_info: stackDoc.meta.fit_info, sims_per_order: SIMS, kinds: KINDS, anchor: !!args.anchor, in_sample: !!args["in-sample"], n_fights: fsOk.length, failed: errs.length,
      bootstrap: B, wall_s: (Date.now() - t0) / 1000, limit: LIMIT,
      notes: "package = FightEngine.predict defaults (blend P(win) from the stack block chosen by lineKind; method x round = mrWeight x rescaled simulator cells + " +
        "(1 - mrWeight) x rescaled S (SM with a close); calibrated interval) with tools/predictrec.js inputs; lineKind close/open fall back to none without that line. " +
        "Benchmarks: market_close = market.json p_power_close; market_open = p_novig_open; ml_lr_walkforward = blindtest.json ml_lr (refit before each card; the " +
        "package's `ml` expert); ml_lr_static = ml.json lr (trained through 2023); ml2_lr = ml2.json (static fit < 2024); elo_walkforward = blindtest.json elo; " +
        "model_S / model_SM = methodround.json cells (fit through the previous year), P(A) = A cells / (A + B). Winner metrics on decisive fights with clip 1e-4." },
    results: rnd4(res), errors: errs.slice(0, 20).map((e) => ({ id: e.id, err: e.err })),
    // per fight: the simulator once (identical for every line kind: same seeds and matchup), experts once, then per kind the package
    fights: fsOk.map((f) => {
      const K = byId.get(f.id).kinds, k0 = K[kinds[0]];
      const ex = Object.assign({}, k0.experts); delete ex.market;
      const per = {};
      for (const k of kinds) {
        const r = K[k];
        per[k] = { p: r.p, src: r.source + (r.blendError ? "!" : ""), lk: r.lineKind, miss: r.lineMissing || undefined, line: r.line, reg: r.regime, cells: r.cells,
          iv80: r.iv80, iv95: r.iv95, ml2p: r.ml2p, mrW: r.mrWeight, mrV: r.mrVariant, anchorS: r.anchorS == null ? undefined : r.anchorS };
      }
      return { id: f.id, date: f.date, R: k0.R, simP: k0.simP, simCells: k0.simCells, experts: ex, kinds: per };
    }) };
  fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
  fs.writeFileSync(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), JSON.stringify(doc));
  // console summary
  const f4 = (x) => (x == null ? "  -   " : x.toFixed(4));
  console.log(`\n${VERSION} package on ${SPLIT}: ${fsOk.length} fights (${errs.length} failed); common decisive set n=${res.common.n}`);
  for (const m of Object.keys(res.models)) {
    const r = res.models[m];
    console.log(`  ${m.padEnd(26)} winLL ${f4(r.winLL.est)} [${f4(r.winLL.lo)}, ${f4(r.winLL.hi)}] n=${r.winLL.n}  brier ${f4(r.brier.est)}  acc ${f4(r.acc.est)}  ece ${f4(r.ece.est)}  slope ${f4(r.calSlope.est)}` +
      (r.bin7.n ? `  7bin ${f4(r.bin7.est)} method ${f4(r.method.est)}` : ""));
  }
  for (const k of kinds) {
    const pm = "package_" + k, P = res.paired[pm];
    console.log(`  ${pm}: ` + ["vs_market_close", "vs_ml_lr_walkforward", "vs_elo_walkforward", "vs_model_S", "vs_sim_package"].map((r) => `${r} ${P[r].winLL.diff >= 0 ? "+" : ""}${P[r].winLL.diff.toFixed(4)} [${P[r].winLL.lo.toFixed(4)}, ${P[r].winLL.hi.toFixed(4)}] (n ${P[r].winLL.n})`).join("; "));
    const mr = res.methodround[pm];
    if (mr && mr.metrics) console.log("    methodround: " + ["joint", "bin7", "method3", "method_round", "winner"].map((q) => mr.metrics[q] ? `${q} ${mr.metrics[q].submitted.toFixed(4)} (S ${mr.metrics[q].model_S.toFixed(4)}, ${mr.metrics[q].diff >= 0 ? "+" : ""}${mr.metrics[q].diff.toFixed(4)} [${mr.metrics[q].ci95[0].toFixed(4)}, ${mr.metrics[q].ci95[1].toFixed(4)}])` : "").join("; "));
    else if (mr && mr.error) console.log("    methodround failed: " + mr.error.split("\n").slice(-2).join(" "));
    console.log(`    coverage of the close: 80% ${f4(res.coverage[pm].cover80_close)} 95% ${f4(res.coverage[pm].cover95_close)} (n ${res.coverage[pm].n}); line missing ${res.lineMissing[pm]}; sources ${JSON.stringify(res.sources[pm])}`);
  }
  console.log(`wrote ${OUT} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
})().catch((e) => { console.error(e); process.exit(1); });
