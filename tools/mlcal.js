#!/usr/bin/env node
/* mlcal.js: the evaluator half of the ML-driven engine calibration harness (driver: tools/mlcal.py).

   Engine-agnostic. It reads the engine's global parameter object (any UMD/CommonJS params file, default
   src/params3.js), a JSON spec of which parameters to tune (paths, bounds, log scale, multiplier groups),
   builds one full parameter tree per candidate and calls FightEngine.matchup(A, B, opts) and
   FightEngine.summarize(m, sims, seed) on walk-forward backtest snapshots (data/derived/backtest_dev.json)
   in 2-3 worker_threads. It returns the objective and its components:

     objective = wWin * symmetric winner log loss + wBins * 7-bin outcome log loss + base-rate penalties
                 (+ optional wStat * stat-line error)

   Common random numbers: every (fight, rung) gets a fixed seed, so two candidates see the same random
   numbers and their difference has far less Monte Carlo noise than either value. Rungs accumulate: rung r
   adds new sims with seed offset r to the earlier rungs' counts (successive halving pays only for the
   extra sims). Corner symmetry (docs/BACKLOG.md "Evaluation rule"): mirror "swap" simulates each fight in
   one corner order picked by a fixed hash of its id; "both" simulates both orders and averages; scoring
   is always in the data's orientation, and no parameter can see corner order.

   Hidden-data protocol: fights dated 2026-01-01 or later are dropped on load, whatever file is given.
   Splits: train 2019-01-01..2023-12-31, val 2024-01-01..2025-12-31.

   Usage
     node tools/mlcal.js spec  [--spec tools/mlcal_spec_engine3.json]           print the resolved dimensions
     node tools/mlcal.js serve [--spec ...] [--workers 2]                         JSON-lines server for mlcal.py
     node tools/mlcal.js eval  [--spec ...] [--split train|val] [--n-fights 600] [--sims 60] [--mirror swap|both|none]
                               [--x candidate.json] [--workers 2] [--seed 1]      one evaluation, JSON to stdout
     node tools/mlcal.js export --cand data/derived/mlcal_candidates.json [--rank 1] --out <file.js>
                                                                                  full params file for a candidate
   Server commands (one JSON object per line on stdin, one reply per line on stdout):
     {"cmd":"spec"}
     {"cmd":"setup","split":"train","nFights":600,"offset":0,"sampleSeed":1,"seed":1,"mirror":"swap"}
     {"cmd":"eval","key":"t7","x":{"kdScale":1.2},"sims":15,"seedOff":0,"detail":false}
     {"cmd":"drop","key":"t7"}   {"cmd":"quit"}
*/
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");

const ROOT = path.resolve(__dirname, "..");
const VAULT_FROM = "2026-01-01";
const SPLITS = { train: ["2019-01-01", "2024-01-01"], val: ["2024-01-01", "2026-01-01"], dev: ["2019-01-01", "2026-01-01"] };
const STAT_KEYS = ["sig_lnd", "sig_att", "kd", "td_lnd", "td_att", "ctrl", "sub_att", "h_lnd", "b_lnd", "l_lnd"];
const NSK = STAT_KEYS.length, MAXR = 5;
// record layout returned by a worker for one task (sim orientation)
const R_N = 0, R_C = 1, R_FA = R_C + 7, R_FB = R_FA + MAXR, R_SA = R_FB + MAXR, R_SB = R_SA + NSK, R_MIN = R_SB + NSK,
  R_DEC = R_MIN + 1, R_ERR = R_DEC + 3, REC = R_ERR + 1;

// ------------------------------------------------------------------ small utilities
function absPath(p) { return path.isAbsolute(p) ? p : path.join(ROOT, p); }
function readJSON(p) { return JSON.parse(fs.readFileSync(absPath(p), "utf8")); }
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
function mulberry(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
function seg(o, s) { return Array.isArray(o) ? +s : s; }
function getPath(o, p) { for (const s of p.split(".")) { if (o == null) return undefined; o = o[seg(o, s)]; } return o; }
function setPath(o, p, v) {
  const ss = p.split(".");
  for (let i = 0; i < ss.length - 1; i++) { o = o[seg(o, ss[i])]; if (o == null) throw new Error("mlcal: no such parameter path " + p); }
  o[seg(o, ss[ss.length - 1])] = v;
}
function flatten(o, pre, out) {
  if (typeof o === "number") { if (isFinite(o)) out.push({ path: pre, value: o }); return out; }
  if (o && typeof o === "object") for (const k of Object.keys(o)) flatten(o[k], pre ? pre + "." + k : String(k), out);
  return out;
}
function globMatch(pat, p) {
  const a = pat.split("."), b = p.split(".");
  return a.length === b.length && a.every((s, i) => s === "*" || s === b[i]);
}
function sha1(s) { return crypto.createHash("sha1").update(s).digest("hex"); }
function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) { const k = a.slice(2); const v = argv[i + 1]; if (v == null || v.startsWith("--")) o[k] = true; else { o[k] = v; i++; } }
    else o._.push(a);
  }
  return o;
}

// ------------------------------------------------------------------ spec: which parameters, what bounds
function loadSpec(specPath) {
  const spec = specPath ? readJSON(specPath) : {};
  spec.engine = spec.engine || "src/engine3.js";
  spec.params = spec.params || "src/params3.js";
  spec.inject = spec.inject || "opts";       // "opts": pass the full tree as opts.params; "mutate": write it into the params object
  spec.backtest = spec.backtest || "data/derived/backtest_dev.json";
  spec.priors = spec.priors || "data/derived/mlcal_priors_asof.json";
  spec.objective = spec.objective || {};
  return spec;
}
function freshRequire(p) { const r = absPath(p); delete require.cache[require.resolve(r)]; return require(r); }

/* Resolve spec.tune into dimensions. Entry forms:
     {"path": "kdScale", "lo": 0.6, "hi": 2.2, "log": true}      one value; lo/hi absolute
     {"path": "form.vol", "rel": 2}                              bounds [v/rel, v*rel] (log scale)
     {"path": "div.*.ko", "rel": 1.5}                            glob: one dimension per match ("*" = one segment)
     {"name": "formPC", "paths": ["form.pow", "form.chin"], "lo": 0.6, "hi": 1.6}
                                                                 one multiplier on several current values
     {"path": "hook.w_oppadj", "value": 0, "lo": -1, "hi": 1}    passed to the spec's hook module, not the engine
   Optional: "min"/"max" hard limits, "int": true, "log": false. Defaults: spec.defaults.rel (1.6), log when lo > 0. */
function resolveSpec(spec, base) {
  const flat = flatten(base, "", []), fmap = new Map(flat.map((e) => [e.path, e.value]));
  const defs = Object.assign({ rel: 1.6 }, spec.defaults || {});
  const dims = [];
  const expand = (p) => (p.includes("*") ? flat.filter((e) => globMatch(p, e.path)).map((e) => e.path) : [p]);
  for (const ent of spec.tune || []) {
    if (ent.paths) {
      const paths = [].concat(...ent.paths.map(expand));
      for (const p of paths) if (!fmap.has(p)) throw new Error("mlcal spec: unknown parameter " + p);
      const rel = ent.rel || defs.rel;
      dims.push({ name: ent.name || "mult:" + ent.paths.join("+"), kind: "mult", paths, value: 1,
        lo: ent.lo != null ? ent.lo : 1 / rel, hi: ent.hi != null ? ent.hi : rel, log: ent.log != null ? !!ent.log : true, int: false,
        current: paths.map((p) => fmap.get(p)) });
      continue;
    }
    const paths = expand(ent.path);
    if (!paths.length) throw new Error("mlcal spec: no parameter matches " + ent.path);
    for (const p of paths) {
      const hook = p.startsWith("hook.");
      const v = hook ? +ent.value : fmap.get(p);
      if (v === undefined || !isFinite(v)) throw new Error("mlcal spec: unknown or non-numeric parameter " + p);
      let lo = ent.lo, hi = ent.hi;
      const rel = ent.rel || defs.rel;
      if (lo == null || hi == null) {
        if (v > 0) { if (lo == null) lo = v / rel; if (hi == null) hi = v * rel; }
        else if (v < 0) { if (lo == null) lo = v * rel; if (hi == null) hi = v / rel; }
        else throw new Error("mlcal spec: " + p + " is 0; give lo and hi");
      }
      if (ent.min != null) lo = Math.max(lo, ent.min);
      if (ent.max != null) hi = Math.min(hi, ent.max);
      if (v < lo) lo = v; if (v > hi) hi = v;            // the current value is always a legal point
      const log = ent.log != null ? !!ent.log && lo > 0 : lo > 0;
      dims.push({ name: p, kind: hook ? "hook" : "value", paths: [p], value: v, lo, hi, log, int: !!ent.int });
    }
  }
  const names = new Set();
  for (const d of dims) { if (names.has(d.name)) throw new Error("mlcal spec: duplicate dimension " + d.name); names.add(d.name); }
  return dims;
}

/* Full parameter tree for a candidate. x maps dimension names (or raw parameter paths) to values;
   missing dimensions keep their current values. Returns { tree, hook, overrides }. */
function buildTree(base, dims, x) {
  const tree = structuredClone(base), hook = {}, overrides = {};
  const byName = new Map(dims.map((d) => [d.name, d]));
  for (const d of dims) if (d.kind === "hook") hook[d.paths[0].slice(5)] = d.value;
  for (const name of Object.keys(x || {})) {
    let v = +x[name];
    const d = byName.get(name);
    if (!isFinite(v)) throw new Error("mlcal: non-numeric value for " + name);
    if (!d) {                                                     // raw path override
      if (name.startsWith("hook.")) { hook[name.slice(5)] = v; continue; }
      if (typeof getPath(base, name) !== "number") throw new Error("mlcal: unknown parameter " + name);
      setPath(tree, name, v); overrides[name] = v; continue;
    }
    if (d.int) v = Math.round(v);
    if (d.kind === "mult") for (const p of d.paths) { const nv = getPath(base, p) * v; setPath(tree, p, nv); overrides[p] = nv; }
    else if (d.kind === "hook") hook[d.paths[0].slice(5)] = v;
    else { setPath(tree, d.paths[0], v); overrides[d.paths[0]] = v; }
  }
  return { tree, hook, overrides };
}

// ------------------------------------------------------------------ backtest fights
function resultBin(r) {      // data orientation: 0 A KO/TKO, 1 A sub, 2 A dec, 3 draw, 4 B dec, 5 B sub, 6 B KO/TKO
  if (r.winner === "D" || r.method === "DRAW") return 3;
  if (r.winner !== "A" && r.winner !== "B") return -1;
  if (r.method === "DQ" || r.method === "NC" || r.method === "CNC") return -1;
  const k = r.method === "SUB" ? 1 : (r.method === "UD" || r.method === "SD" || r.method === "MD") ? 2 : 0;
  return r.winner === "A" ? k : 6 - k;
}

/* Load the split, drop vault fights, NC/DQ, prepare engine profiles. Returns { all, sample, targets, pi7 }. */
function loadFights(spec, o) {
  const bt = readJSON(spec.backtest), PA = readJSON(spec.priors), keys = bt.meta && bt.meta.keys;
  const split = SPLITS[o.split || "train"];
  if (!split) throw new Error("mlcal: unknown split " + o.split);
  let vaultDropped = 0;
  const usable = [];
  for (const f of bt.fights) {
    if (!(f.date < VAULT_FROM)) { vaultDropped++; continue; }   // hidden-data protocol: never touch 2026+
    if (resultBin(f.result) < 0) continue;
    usable.push(f);
  }
  const inSplit = (f, s) => f.date >= s[0] && f.date < s[1];
  const prep = (f) => {
    const yr = f.date.slice(0, 4), pri = PA[yr];
    if (!pri) throw new Error("mlcal: no walk-forward priors for " + yr + " (run python3 tools/mlcal.py priors)");
    const generic = f.division === "Catch Weight" || f.division === "Open Weight" || !pri[f.division];
    const r = f.result, bin = resultBin(r);
    const winA = bin === 3 ? null : (bin < 3 ? 1 : 0);
    const act = f.actual && f.actual.A && f.actual.B && f.actual.minutes > 0 ? f.actual : null;
    return {
      id: f.id, date: f.date, year: yr, division: generic ? (f.prior_division || f.division) : f.division, divRaw: f.division,
      rounds: f.rounds || (f.title ? 5 : 3), title: !!f.title, bin, winA, method: r.method,
      finRound: bin === 2 || bin === 3 || bin === 4 ? 0 : (r.round || 0), eloA: f.A.elo, eloB: f.B.elo,
      A: Object.assign({}, f.A, keys ? { keys } : {}), B: Object.assign({}, f.B, keys ? { keys } : {}),
      act: act ? { A: act.A, B: act.B, minutes: act.minutes } : null
    };
  };
  const all = usable.filter((f) => inSplit(f, split)).map(prep);
  const train = o.split === "train" ? all : usable.filter((f) => inSplit(f, SPLITS.train)).map(prep);
  // deterministic shuffle (by sampleSeed), then the window [offset, offset + nFights)
  const rnd = mulberry(mix(0x5eed, o.sampleSeed == null ? 1 : +o.sampleSeed));
  const order = all.map((f, i) => [rnd(), i]).sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  const n = o.nFights && +o.nFights > 0 ? Math.min(+o.nFights, all.length) : all.length;
  const off = +(o.offset || 0);
  if (off + n > all.length && n < all.length) throw new Error(`mlcal: window ${off}+${n} exceeds the ${all.length} ${o.split} fights`);
  const pick = n === all.length ? order : order.slice(off, off + n);
  const sample = pick.sort((a, b) => a - b).map((i) => all[i]);
  return { all, sample, targets: targetsOf(all), pi7: pi7Of(train), vaultDropped, nUsable: all.length };
}

// symmetric 7-bin base distribution (smoothing prior for the 7-bin probabilities), from train fights only
function pi7Of(fights) {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const f of fights) c[f.bin]++;
  const n = fights.length, pi = c.map((x, k) => (x + c[6 - k]) / (2 * n));
  return pi;
}

// observed base rates of a fight set (each fight weight 1; per-15 rates pooled by minutes)
function targetsOf(fights) {
  const n = fights.length, sh = [0, 0, 0, 0, 0, 0, 0];
  const f3 = [0, 0, 0], dec = { UD: 0, SD: 0, MD: 0 };
  const st = {}; for (const k of STAT_KEYS) st[k] = 0;
  let mins = 0, nAct = 0;
  for (const f of fights) {
    sh[f.bin]++;
    if (f.rounds === 3 && f.finRound >= 1 && f.finRound <= 3) f3[f.finRound - 1]++;
    if (dec[f.method] != null) dec[f.method]++;
    if (f.act) { nAct++; mins += f.act.minutes; for (const k of STAT_KEYS) st[k] += (+f.act.A[k] || 0) + (+f.act.B[k] || 0); }
  }
  return baseRates(sh.map((x) => x / n), f3, dec, st, mins);
}
function baseRates(binShare, f3, dec, st, mins) {
  const f3t = Math.max(1e-9, f3[0] + f3[1] + f3[2]), dt = Math.max(1e-9, dec.UD + dec.SD + dec.MD), m2 = Math.max(1e-9, 2 * mins);
  return {
    ko: binShare[0] + binShare[6], sub: binShare[1] + binShare[5], dec: binShare[2] + binShare[4], draw: binShare[3],
    fin3_r1: f3[0] / f3t, fin3_r2: f3[1] / f3t, fin3_r3: f3[2] / f3t, split: (dec.SD + dec.MD) / dt,
    sigL15: 15 * st.sig_lnd / m2, sigAcc: st.sig_lnd / Math.max(1e-9, st.sig_att), kd15: 15 * st.kd / m2,
    td15: 15 * st.td_lnd / m2, tdAcc: st.td_lnd / Math.max(1e-9, st.td_att), ctrl15: 15 * st.ctrl / m2, sub15: 15 * st.sub_att / m2,
    headShare: st.h_lnd / Math.max(1e-9, st.h_lnd + st.b_lnd + st.l_lnd)
  };
}

// default base-rate penalty: w * ((sim - data) / tol)^2, rel = relative error
const BR_DEFAULT = {
  ko: { tol: 0.02 }, sub: { tol: 0.015 }, fin3_r1: { tol: 0.03 }, fin3_r3: { tol: 0.03 }, split: { tol: 0.04 },
  sigL15: { tol: 0.06, rel: true }, sigAcc: { tol: 0.015 }, kd15: { tol: 0.12, rel: true }, td15: { tol: 0.10, rel: true },
  ctrl15: { tol: 0.10, rel: true }, sub15: { tol: 0.15, rel: true }
};

// ------------------------------------------------------------------ tasks and worker pool
function makeTasks(fights, mirror, seed) {
  const tasks = [];
  fights.forEach((f, fi) => {
    const h = hash32(f.id), s0 = mix(h, seed >>> 0);
    if (mirror === "both") { tasks.push({ fi, swap: false, seed: s0 }); tasks.push({ fi, swap: true, seed: mix(s0, 0xabcdef) }); }
    else tasks.push({ fi, swap: mirror === "swap" ? ((mix(h, 0x51ed) & 1) === 1) : false, seed: s0 });
  });
  return tasks;
}

class Pool {
  constructor(spec, fights, tasks, nWorkers, PA) {
    this.n = Math.max(1, Math.min(nWorkers, tasks.length));
    this.groups = Array.from({ length: this.n }, () => []);
    tasks.forEach((t, i) => this.groups[i % this.n].push(i));
    const common = { enginePath: absPath(spec.engine), paramsPath: absPath(spec.params), hookPath: spec.hook ? absPath(spec.hook) : null,
      inject: spec.inject, priors: PA };
    this.workers = this.groups.map((g) => new Worker(__filename, { workerData: Object.assign({
      tasks: g.map((i) => { const t = tasks[i], f = fights[t.fi]; return { swap: t.swap, seed: t.seed, f: { id: f.id, date: f.date, year: f.year,
        division: f.division, rounds: f.rounds, title: f.title, A: f.A, B: f.B } }; }) }, common) }));
    this.nTasks = tasks.length;
  }
  run(key, tree, hook, sims, seedOff) {
    const out = new Float64Array(this.nTasks * REC);
    const errs = [];
    return Promise.all(this.workers.map((w, wi) => new Promise((res, rej) => {
      const onMsg = (m) => {
        if (m.type !== "res") return;
        w.off("message", onMsg); w.off("error", rej);
        const rec = m.rec, g = this.groups[wi];
        for (let j = 0; j < g.length; j++) out.set(rec.subarray(j * REC, (j + 1) * REC), g[j] * REC);
        if (m.errors) errs.push(...m.errors);
        res();
      };
      w.on("message", onMsg); w.once("error", rej);
      w.postMessage({ type: "run", key, tree, hook, sims, seedOff });
    }))).then(() => ({ rec: out, errors: errs }));
  }
  close() { return Promise.all(this.workers.map((w) => w.terminate())); }
}

// ------------------------------------------------------------------ worker
function workerMain() {
  const { enginePath, paramsPath, hookPath, inject, priors, tasks } = workerData;
  const E = require(enginePath), P0 = require(paramsPath);
  const hook = hookPath ? require(hookPath) : null;
  let cacheKey = null, cache = null;
  function build(t, tree, hp) {
    const f = t.f, A = t.swap ? f.B : f.A, B = t.swap ? f.A : f.B;
    let opts = { division: f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.year] };
    if (inject !== "mutate") opts.params = tree;
    if (hook && hook.matchupOpts) opts = hook.matchupOpts(opts, { fight: f, swap: t.swap, A, B, hookParams: hp, params: tree }) || opts;
    return E.matchup(A, B, opts);
  }
  parentPort.on("message", (msg) => {
    if (msg.type !== "run") return;
    const errors = [];
    if (msg.key !== cacheKey) {
      if (inject === "mutate") for (const k of Object.keys(msg.tree)) P0[k] = structuredClone(msg.tree[k]);
      cache = tasks.map((t) => { try { return build(t, msg.tree, msg.hook); } catch (e) { errors.push(String(e && e.message || e)); return null; } });
      cacheKey = msg.key;
    }
    const out = new Float64Array(tasks.length * REC);
    for (let j = 0; j < tasks.length; j++) {
      const m = cache[j], o = j * REC;
      if (!m) { out[o + R_ERR] = 1; continue; }
      let s;
      try { s = E.summarize(m, msg.sims, mix(tasks[j].seed, 1 + (msg.seedOff | 0))); }
      catch (e) { if (errors.length < 5) errors.push(String(e && e.message || e)); out[o + R_ERR] = 1; continue; }
      const N = s.n || msg.sims;
      out[o + R_N] = N;
      const cnt = s.counts || s.bins.map((x) => Math.round(x * N));
      for (let k = 0; k < 7; k++) out[o + R_C + k] = cnt[k];
      for (let r = 0; r < MAXR; r++) {
        out[o + R_FA + r] = s.finA && s.finA[r] != null ? s.finA[r] * N : 0;
        out[o + R_FB + r] = s.finB && s.finB[r] != null ? s.finB[r] * N : 0;
      }
      const aA = (s.avg && s.avg.A) || {}, aB = (s.avg && s.avg.B) || {};
      for (let k = 0; k < NSK; k++) { out[o + R_SA + k] = (+aA[STAT_KEYS[k]] || 0) * N; out[o + R_SB + k] = (+aB[STAT_KEYS[k]] || 0) * N; }
      out[o + R_MIN] = (+s.avgMin || 0) * N;
      const nd = (s.dist || 0) * N, dec = s.dec || {};
      out[o + R_DEC] = (dec.UD || 0) * nd; out[o + R_DEC + 1] = (dec.SD || 0) * nd; out[o + R_DEC + 2] = (dec.MD || 0) * nd;
    }
    parentPort.postMessage({ type: "res", key: msg.key, rec: out, errors: errors.length ? errors.slice(0, 5) : null }, [out.buffer]);
  });
}

// ------------------------------------------------------------------ accumulation and metrics
function newAcc(nf) { return { n: new Float64Array(nf), rec: new Float64Array(nf * REC), err: new Uint8Array(nf) }; }
function accumulate(acc, tasks, rec) {
  for (let ti = 0; ti < tasks.length; ti++) {
    const t = tasks[ti], o = ti * REC, a = t.fi * REC;
    if (rec[o + R_ERR]) { acc.err[t.fi] = 1; continue; }
    const N = rec[o + R_N];
    acc.n[t.fi] += N;
    acc.rec[a + R_N] += N;
    for (let k = 0; k < 7; k++) acc.rec[a + R_C + k] += rec[o + R_C + (t.swap ? 6 - k : k)];
    for (let r = 0; r < MAXR; r++) {
      acc.rec[a + R_FA + r] += rec[o + (t.swap ? R_FB : R_FA) + r];
      acc.rec[a + R_FB + r] += rec[o + (t.swap ? R_FA : R_FB) + r];
    }
    for (let k = 0; k < NSK; k++) {
      acc.rec[a + R_SA + k] += rec[o + (t.swap ? R_SB : R_SA) + k];
      acc.rec[a + R_SB + k] += rec[o + (t.swap ? R_SA : R_SB) + k];
    }
    acc.rec[a + R_MIN] += rec[o + R_MIN];
    for (let k = 0; k < 3; k++) acc.rec[a + R_DEC + k] += rec[o + R_DEC + k];
  }
}

function metrics(fights, acc, targets, pi7, objCfg, detail) {
  const cfg = Object.assign({ wWin: 1, wBins: 0.5, wBase: 1, wStat: 0, binPrior: 1, winPrior: 0.5, pClip: 0.005 }, objCfg || {});
  const brCfg = cfg.baserates || BR_DEFAULT, brW = cfg.brWeight != null ? cfg.brWeight : 0.003;
  let ll = 0, br = 0, hit = 0, nW = 0, ll7 = 0, n7 = 0, nErr = 0;
  const ece = Array.from({ length: 10 }, () => [0, 0, 0]);
  const sh = [0, 0, 0, 0, 0, 0, 0], f3 = [0, 0, 0], dec = { UD: 0, SD: 0, MD: 0 }, st = {};
  for (const k of STAT_KEYS) st[k] = 0;
  let mins = 0, sigAE = 0, tdAE = 0, kdAE = 0, nSt = 0;
  const dx = [], dy = [];
  const per = detail ? [] : null;
  for (let i = 0; i < fights.length; i++) {
    const f = fights[i], a = i * REC, N = acc.rec[a + R_N];
    if (acc.err[i] || !(N > 0)) { nErr++; continue; }
    const c = acc.rec.subarray(a + R_C, a + R_C + 7);
    const cA = c[0] + c[1] + c[2], cB = c[4] + c[5] + c[6];
    const p = clip((cA + cfg.winPrior) / (cA + cB + 2 * cfg.winPrior), cfg.pClip, 1 - cfg.pClip);
    const q = new Array(7);
    for (let k = 0; k < 7; k++) q[k] = (c[k] + cfg.binPrior * pi7[k]) / (N + cfg.binPrior);
    if (f.winA != null) {
      ll -= f.winA ? Math.log(p) : Math.log(1 - p);
      br += (p - f.winA) * (p - f.winA);
      hit += p > 0.5 ? f.winA : (p < 0.5 ? 1 - f.winA : 0.5);
      nW++;
      for (const [pp, yy] of [[p, f.winA], [1 - p, 1 - f.winA]]) { const b = Math.min(9, Math.floor(pp * 10)); ece[b][0]++; ece[b][1] += pp; ece[b][2] += yy; }
    }
    ll7 -= Math.log(q[f.bin]); n7++;
    for (let k = 0; k < 7; k++) sh[k] += c[k] / N;
    if (f.rounds === 3) for (let r = 0; r < 3; r++) f3[r] += (acc.rec[a + R_FA + r] + acc.rec[a + R_FB + r]) / N;
    dec.UD += acc.rec[a + R_DEC] / N; dec.SD += acc.rec[a + R_DEC + 1] / N; dec.MD += acc.rec[a + R_DEC + 2] / N;
    const sA = acc.rec.subarray(a + R_SA, a + R_SA + NSK), sB = acc.rec.subarray(a + R_SB, a + R_SB + NSK);
    for (let k = 0; k < NSK; k++) st[STAT_KEYS[k]] += (sA[k] + sB[k]) / N;
    mins += acc.rec[a + R_MIN] / N;
    if (f.act) {
      const ia = STAT_KEYS.indexOf("sig_lnd"), it = STAT_KEYS.indexOf("td_lnd"), ik = STAT_KEYS.indexOf("kd");
      const pa = sA[ia] / N, pb = sB[ia] / N;
      sigAE += Math.abs(pa - f.act.A.sig_lnd) + Math.abs(pb - f.act.B.sig_lnd);
      tdAE += Math.abs(sA[it] / N - f.act.A.td_lnd) + Math.abs(sB[it] / N - f.act.B.td_lnd);
      kdAE += Math.abs(sA[ik] / N - f.act.A.kd) + Math.abs(sB[ik] / N - f.act.B.kd);
      nSt += 2; dx.push(pa - pb); dy.push(f.act.A.sig_lnd - f.act.B.sig_lnd);
    }
    if (per) per.push({ id: f.id, date: f.date, division: f.divRaw, rounds: f.rounds, n: N, pA: p, q, winA: f.winA, bin: f.bin,
      eloA: f.eloA, eloB: f.eloB, sigA: sA[0] / N, sigB: sB[0] / N, actSigA: f.act ? f.act.A.sig_lnd : null, actSigB: f.act ? f.act.B.sig_lnd : null });
  }
  const nOk = fights.length - nErr;
  const sim = baseRates(sh.map((x) => x / Math.max(1, nOk)), f3, dec, st, mins);
  const brTerms = {};
  for (const k of Object.keys(brCfg)) {
    const c = brCfg[k], s = sim[k], d = targets[k];
    if (s == null || d == null || !isFinite(s) || !isFinite(d)) continue;
    const e = c.rel ? (s / Math.max(1e-9, d) - 1) : (s - d);
    const w = c.w != null ? c.w : brW;
    brTerms[k] = w * (e / c.tol) * (e / c.tol);
    br += brTerms[k];
  }
  let eceV = 0, eceN = 0;
  for (const b of ece) if (b[0]) { eceV += Math.abs(b[1] - b[2]); eceN += b[0]; }
  const llW = nW ? ll / nW : NaN, ll7v = n7 ? ll7 / n7 : NaN;
  const mx = dx.reduce((s, v) => s + v, 0) / Math.max(1, dx.length), my = dy.reduce((s, v) => s + v, 0) / Math.max(1, dy.length);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < dx.length; i++) { sxy += (dx[i] - mx) * (dy[i] - my); sxx += (dx[i] - mx) ** 2; syy += (dy[i] - my) ** 2; }
  const statTerm = nSt ? sigAE / nSt / 30 : 0;          // sig-landed MAE in units of 30 strikes (only used if wStat > 0)
  const failPenalty = nErr > 0.02 * fights.length ? 10 : 0;
  const objective = cfg.wWin * llW + cfg.wBins * ll7v + cfg.wBase * br + cfg.wStat * statTerm + failPenalty;
  const out = {
    objective: isFinite(objective) ? objective : 99, winLL: llW, binLL: ll7v, basePen: br, brier: nW ? br === br ? null : null : null,
    nFights: fights.length, nWinner: nW, nFailed: nErr,
    winner: { logloss: llW, brier: nW ? (detail === undefined ? 0 : 0) : 0 }
  };
  out.brier = nW ? brierOf(fights, acc, cfg) : NaN;
  out.accuracy = nW ? hit / nW : NaN;
  out.ece = eceN ? eceV / eceN : NaN;
  delete out.winner;
  out.baserates = { sim, data: targets, terms: brTerms };
  out.statline = { sigLndMAE: nSt ? sigAE / nSt : null, tdLndMAE: nSt ? tdAE / nSt : null, kdMAE: nSt ? kdAE / nSt : null,
    sigDiffCorr: sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null };
  if (per) out.perFight = per;
  return out;
}
function brierOf(fights, acc, cfg) {
  let s = 0, n = 0;
  for (let i = 0; i < fights.length; i++) {
    const f = fights[i], a = i * REC, N = acc.rec[a + R_N];
    if (acc.err[i] || !(N > 0) || f.winA == null) continue;
    const c = acc.rec.subarray(a + R_C, a + R_C + 7), cA = c[0] + c[1] + c[2], cB = c[4] + c[5] + c[6];
    const p = clip((cA + cfg.winPrior) / (cA + cB + 2 * cfg.winPrior), cfg.pClip, 1 - cfg.pClip);
    s += (p - f.winA) ** 2; n++;
  }
  return s / Math.max(1, n);
}

// ------------------------------------------------------------------ the session (shared by serve and eval)
class Session {
  constructor(spec, nWorkers) {
    this.spec = spec;
    this.nWorkers = nWorkers;
    this.base = freshRequire(spec.params);
    this.dims = resolveSpec(spec, this.base);
    this.PA = readJSON(spec.priors);
    for (const y of Object.keys(this.PA)) if (+y >= 2026) delete this.PA[y];
    this.pool = null; this.accs = new Map();
    const E = freshRequire(spec.engine);
    this.engineVersion = E.VERSION || null;
    this.paramsHash = sha1(fs.readFileSync(absPath(spec.params), "utf8")).slice(0, 12);
    this.engineHash = sha1(fs.readFileSync(absPath(spec.engine), "utf8")).slice(0, 12);
  }
  specInfo() {
    return { dims: this.dims.map((d) => ({ name: d.name, kind: d.kind, paths: d.paths, value: d.value, lo: d.lo, hi: d.hi, log: d.log, int: d.int })),
      engine: this.spec.engine, params: this.spec.params, engineVersion: this.engineVersion, paramsVersion: this.base.version || null,
      paramsHash: this.paramsHash, engineHash: this.engineHash, inject: this.spec.inject, objective: this.spec.objective };
  }
  async setup(o) {
    if (this.pool) await this.pool.close();
    this.accs.clear();
    const L = loadFights(this.spec, o);
    this.fights = L.sample; this.targets = L.targets; this.pi7 = L.pi7;
    this.mirror = o.mirror || "swap";
    this.tasks = makeTasks(this.fights, this.mirror, o.seed == null ? 1 : +o.seed);
    this.pool = new Pool(this.spec, this.fights, this.tasks, o.workers || this.nWorkers, this.PA);
    this.setupInfo = { split: o.split || "train", n: this.fights.length, nSplit: L.nUsable, offset: +(o.offset || 0), sampleSeed: o.sampleSeed == null ? 1 : +o.sampleSeed,
      seed: o.seed == null ? 1 : +o.seed, mirror: this.mirror, tasks: this.tasks.length, workers: this.pool.n, vaultDropped: L.vaultDropped,
      ids: o.returnIds ? this.fights.map((f) => f.id) : undefined,
      first: this.fights.length ? this.fights[0].date : null, last: this.fights.length ? this.fights[this.fights.length - 1].date : null };
    return Object.assign({ ok: true, targets: this.targets, pi7: this.pi7 }, this.setupInfo);
  }
  async evaluate(o) {
    if (!this.pool) throw new Error("mlcal: setup first");
    const key = String(o.key || "k" + Date.now());
    const { tree, hook, overrides } = buildTree(this.base, this.dims, o.x || {});
    const t0 = Date.now();
    const r = await this.pool.run(key, tree, hook, +o.sims || 30, +o.seedOff || 0);
    let acc = o.accumulate === false ? null : this.accs.get(key);
    if (!acc) { acc = newAcc(this.fights.length); if (o.accumulate !== false) this.accs.set(key, acc); }
    accumulate(acc, this.tasks, r.rec);
    const m = metrics(this.fights, acc, this.targets, this.pi7, Object.assign({}, this.spec.objective, o.objective || {}), !!o.detail);
    let simsPerFight = 0; for (let i = 0; i < acc.n.length; i++) simsPerFight += acc.n[i];
    m.simsPerFight = simsPerFight / Math.max(1, acc.n.length);
    m.key = key; m.ms = Date.now() - t0; m.errors = r.errors.length ? r.errors.slice(0, 3) : undefined;
    m.overrides = o.returnOverrides ? overrides : undefined;
    return m;
  }
  drop(key) { if (key === "*") this.accs.clear(); else this.accs.delete(String(key)); return { ok: true }; }
  async close() { if (this.pool) await this.pool.close(); this.pool = null; }
}

// ------------------------------------------------------------------ CLI
async function serve(args) {
  const spec = loadSpec(args.spec);
  const sess = new Session(spec, +(args.workers || 2));
  const rl = require("readline").createInterface({ input: process.stdin, terminal: false });
  const send = (o) => process.stdout.write(JSON.stringify(o) + "\n");
  let chain = Promise.resolve();
  rl.on("line", (line) => {
    line = line.trim(); if (!line) return;
    chain = chain.then(async () => {
      let req;
      try { req = JSON.parse(line); } catch (e) { send({ error: "bad json: " + e.message }); return; }
      try {
        if (req.cmd === "spec") send(sess.specInfo());
        else if (req.cmd === "setup") send(await sess.setup(req));
        else if (req.cmd === "eval") send(await sess.evaluate(req));
        else if (req.cmd === "drop") send(sess.drop(req.key));
        else if (req.cmd === "tree") { const b = buildTree(sess.base, sess.dims, req.x || {}); send({ tree: b.tree, overrides: b.overrides, hook: b.hook }); }
        else if (req.cmd === "quit") { await sess.close(); send({ ok: true }); process.exit(0); }
        else send({ error: "unknown cmd " + req.cmd });
      } catch (e) { send({ error: String(e && e.stack || e) }); }
    });
  });
  rl.on("close", () => { chain.then(() => sess.close()).then(() => process.exit(0)); });
}

async function evalCli(args) {
  const spec = loadSpec(args.spec);
  const sess = new Session(spec, +(args.workers || 2));
  let x = {};
  if (args.x) { const j = readJSON(args.x); x = j.x || j.overrides || j; }
  const info = await sess.setup({ split: args.split || "train", nFights: +(args["n-fights"] || 0), offset: +(args.offset || 0),
    sampleSeed: +(args["sample-seed"] || 1), seed: +(args.seed || 1), mirror: args.mirror || "swap" });
  const m = await sess.evaluate({ key: "cli", x, sims: +(args.sims || 60), seedOff: 0, detail: !!args.detail });
  await sess.close();
  const out = Object.assign({ setup: info }, m);
  delete out.setup.targets;
  process.stdout.write(JSON.stringify(out, null, args.compact ? 0 : 1) + "\n");
}

function exportCli(args) {
  const spec = loadSpec(args.spec);
  const cand = readJSON(args.cand || "data/derived/mlcal_candidates.json");
  const rank = +(args.rank || 1);
  const c = rank === 0 ? cand.baseline : (cand.candidates || []).find((e) => e.rank === rank);
  if (!c) throw new Error("mlcal export: no candidate with rank " + rank);
  const base = freshRequire(spec.params), dims = resolveSpec(spec, base);
  const { tree, overrides } = buildTree(base, dims, c.overrides || c.x || {});
  tree.version = String(base.version || "params") + "+mlcal-r" + rank;
  const txt = "/* Generated by tools/mlcal.js export from " + (args.cand || "data/derived/mlcal_candidates.json") + " (rank " + rank + ").\n" +
    "   Base: " + spec.params + " (" + (base.version || "?") + "). Changed values:\n" +
    Object.keys(overrides).map((k) => "     " + k + ": " + getPath(base, k) + " -> " + overrides[k]).join("\n") + "\n*/\n" +
    "(function (root) {\n  \"use strict\";\n  var FightParams = " + JSON.stringify(tree, null, 2).replace(/\n/g, "\n  ") + ";\n" +
    "  if (typeof module !== \"undefined\" && module.exports) module.exports = FightParams;\n  else root.FightParams = FightParams;\n" +
    "})(typeof self !== \"undefined\" ? self : (typeof window !== \"undefined\" ? window : globalThis));\n";
  if (!args.out) throw new Error("mlcal export: give --out <file.js> (never src/params3.js)");
  if (path.resolve(absPath(args.out)) === path.resolve(absPath(spec.params))) throw new Error("mlcal export: refusing to overwrite the live params file");
  fs.writeFileSync(absPath(args.out), txt);
  console.log("wrote " + args.out + " (" + Object.keys(overrides).length + " changed values)");
}

if (!isMainThread) workerMain();
else if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || "help";
  const run = async () => {
    if (cmd === "spec") { const spec = loadSpec(args.spec); const s = new Session(spec, 1); console.log(JSON.stringify(s.specInfo(), null, 1)); }
    else if (cmd === "serve") await serve(args);
    else if (cmd === "eval") await evalCli(args);
    else if (cmd === "export") exportCli(args);
    else { console.log(fs.readFileSync(__filename, "utf8").split("*/")[0]); }
  };
  run().catch((e) => { console.error(e && e.stack || e); process.exit(1); });
}

module.exports = { resolveSpec, buildTree, loadSpec, loadFights, resultBin, metrics, flatten, getPath, setPath, Session, BR_DEFAULT, SPLITS };
