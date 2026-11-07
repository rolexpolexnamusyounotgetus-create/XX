#!/usr/bin/env node
/* predict_harness.js: the v6 predict harness (docs/V6_V10_PLAN.md section 3, cycle 1, work item 6). Scores FightEngine.predict
   packages of FROZEN engine copies on backtest_dev.json, side by side on the same fights with common random numbers, in all
   three line regimes, and writes per-fight records for tools/predict_score.py (metrics, paired event-cluster CIs, the
   forward-chained pool-weight fit and the gate / look verdicts).

     node tools/predict_harness.js --split train --years 2019-2023 --sims 300 --workers 3 \
          --pkg v6=versions/v6:v6 --pkg v501=versions/v5.0.1-rejected:v5 --out data/derived/v6/gate_train.json
     node tools/predict_harness.js --split val --sims 300 --pkg v6=versions/v6:v6 --pkg v501=...:v5 --out ...   (the look)

   --pkg name=engineDir:mode   mode v6: winner 'ml2stack' (per-year forward-chained ML v2 stacks, data/derived/v6_stacks.json),
                               S2 walk-forward cells (data/derived/mr_s2.json), the engine's own params.blend otherwise;
                               mode v5: the frozen engine's predict defaults (MoE expert stack by lineKind, S / SM cells).
                               Both get the same per-year MoE stacker (data/derived/v6/cmp_stack_v501_fit<Y-1>.json: fit on
                               2019..Y-1 with the v5.0.1 engine rows; the v6 package uses it only as its fallback).
   Per fight, package and kind (close / open / none; a fight without that line falls back to 'none' and is flagged
   lineMissing, the product as used): p (P(A wins | decisive)), the pooled cells, the simulator's raw / rescaled cells and the
   method/round model's rescaled cells (so the scorer can refit the pool weight), pD, the stack fit used. Seeds: hash(fight
   id), the same for every package and kind (common random numbers; the simulators of two packages with identical engine
   code must give identical raw cells, asserted). The interval is skipped (interval: false): it never moves a point output.
   Inputs per fight are leak-free exactly as tools/evalv.js / tools/predict_eval.js build them. Never reads a 2026 fight. */
"use strict";
const fs = require("fs");
const path = require("path");
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
const r9 = (x) => (x == null || !isFinite(x) ? x : Math.round(x * 1e9) / 1e9);
const CMP_STACKS = (dir) => ({ "2019": dir + "/cmp_stack_v501_fit2020.json", "2020": dir + "/cmp_stack_v501_fit2020.json",
  "2021": dir + "/cmp_stack_v501_fit2020.json", "2022": dir + "/cmp_stack_v501_fit2021.json", "2023": dir + "/cmp_stack_v501_fit2022.json",
  "2024": dir + "/cmp_stack_v501_fit2023.json", "2025": dir + "/cmp_stack_v501_fit2023.json" });

// ================================================================== worker
if (!isMainThread) {
  const W = workerData;
  const PK = W.pkgs.map((p) => {
    const E = require(path.join(p.dir, "engine3.js"));
    return { name: p.name, mode: p.mode, dir: p.dir, E, FB: require(path.join(p.dir, "ml", "blend.js")), PRM: E.params() };
  });
  const E = PK[0].E, PRM = PK[0].PRM;   // matchup inputs are built once (the first package's engine) and shared
  const fights = loadBacktest();
  const byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const OOF = readJSON(W.oof || (+String(E.VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json"));
  const names = OOF.meta.targets;
  const rates = (arr) => { const o = {}; names.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  const useDur = typeof E.loadDurability === "function" && !!(PRM.components && PRM.components.durability);
  const DURJ = useDur ? readJSON("data/derived/durability.json") : null;
  const durNorm = useDur ? { durability: { normChin: DURJ.engine.norm_chin_backtest_2019_2023, normPow: DURJ.engine.norm_pow_backtest_2019_2023 } } : null;
  function durOpts(id) {
    const d = DURJ.backtest[id];
    if (!d) throw new Error("durability: no walk-forward record for " + id);
    const side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
    const ok = (v) => typeof v === "number" && isFinite(v) && v > 0;
    for (const s of ["A", "B"]) for (const k of ["chin_re", "chin_cov", "pow_re", "pow_cov"]) if (!d[s] || !ok(d[s][k])) throw new Error("durability: record " + id + " " + s + "." + k + " invalid");
    if (!d.p || !ok(d.p.A) || !ok(d.p.B)) throw new Error("durability: record " + id + " has no valid p.A / p.B");
    const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
    return { A: side(d.A), B: side(d.B), base: Math.sqrt(bA * bB) };
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
  const PRs = PK.map((p) => require(path.join(ROOT, "tools/predictrec.js"))(p.E, ROOT, { stacks: CMP_STACKS(W.stackDir), inSample: true, v6: p.mode === "v6" }));
  function baseOpts(f) {
    const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
    const ent = OOF.fights[f.id];
    opts.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
    if (useDur) { opts.dur = durOpts(f.id); opts.params = durNorm; }
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
      const rec = { id, date: f.date, event: f.event, rounds: f.rounds, err: null, pk: {} };
      try {
        const b = baseOpts(f);
        let simRef = null;
        rec.simCellsBy = {};
        for (let k = 0; k < PK.length; k++) {
          const P = PK[k], R0 = rec.pk[P.name] = {};
          simRef = null;   // common random numbers: one simulator run per package, identical across line kinds (asserted)
          if (P.mode === "v6" && +f.date.slice(0, 4) < (W.v6From || 2019)) continue;
          // the v5 package has no stacker fit before 2021 (per-year MoE exports start with the fit through 2020): it is
          // scored on 2021+ only; the v6 package's 2019-2020 rows exist only to fit its pool weight (flagged inSample)
          if (P.mode === "v5" && +f.date.slice(0, 4) < (W.cmpFrom || 2021)) continue;
          for (const kind of W.kinds) {
            const o = Object.assign({}, b, PRs[k].opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: W.sims, interval: false });
            if (P.mode === "v5") { delete o.winnerStacks; delete o.winnerFit; }
            const pk = P.E.predict(f.A, f.B, o);
            if (simRef === null) simRef = pk.sim.cells;
            else if (pk.sim.cells.some((v, i) => v !== simRef[i])) throw new Error("simulator cells differ between line kinds for " + f.id + " (" + P.name + " " + kind + ")");
            R0[kind] = {
              p: r9(pk.p), source: pk.source, lineKind: pk.lineKind, lineMissing: o.lineMissing || null, line: pk.line ? r9(pk.line.p) : null,
              cells: pk.cells.map(r9), pD: r9(pk.pD), simP: r9(pk.sim.p), simR: pk.methodRound.simRescaled.map(r9),
              mrR: pk.methodRound.mrRescaled ? pk.methodRound.mrRescaled.map(r9) : null, w: pk.methodRound.weight, variant: pk.methodRound.variant,
              fit: pk.v6 ? pk.v6.fit : (pk.stack ? pk.stack.fitThrough : null), stack: pk.v6 ? pk.v6.stack : (pk.stack ? pk.stack.block + ":" + (pk.stack.regime || "") : null),
              head: pk.v6 ? r9(pk.v6.headValue) : null, blendError: pk.blendError || null, inSample: pk.backtest ? pk.backtest.inSample : null
            };
          }
          if (simRef) rec.simCellsBy[P.name] = simRef.map(r9);
        }
      } catch (e) { rec.err = String((e && e.stack) || e).slice(0, 800); }
      out.push(rec);
    }
    parentPort.postMessage({ cmd: "done", out });
  });
  return;
}

// ================================================================== main
function parseArgs(argv) {
  const o = { pkg: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const k = a.slice(2), v = argv[i + 1];
    const val = (v == null || v.startsWith("--")) ? true : (i++, v);
    if (k === "pkg") o.pkg.push(val); else o[k] = val;
  }
  return o;
}
const args = parseArgs(process.argv.slice(2));
const SPLIT = String(args.split || "train");
if (!SPLITS[SPLIT]) { console.error("predict_harness: --split train | val"); process.exit(2); }
if (!args.pkg.length) { console.error("predict_harness: --pkg name=engineDir:mode (v6 | v5) at least once"); process.exit(2); }
const PKGS = args.pkg.map((s) => { const [name, rest] = s.split("="), i = rest.lastIndexOf(":"); return { name, dir: path.resolve(ROOT, rest.slice(0, i)), mode: rest.slice(i + 1) }; });
for (const p of PKGS) if (p.mode !== "v6" && p.mode !== "v5") { console.error("predict_harness: mode must be v6 or v5"); process.exit(2); }
const KINDS = String(args.kinds || "close,open,none").split(",");
const SIMS = +(args.sims || 300);
const WORKERS = Math.max(1, Math.min(3, +(args.workers || 3)));
const OUT = args.out;
if (!OUT) { console.error("predict_harness: --out is required"); process.exit(2); }
const MLP_FILE = fs.existsSync(path.join(PKGS[0].dir, "mlpathrec.js")) ? path.join(PKGS[0].dir, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js");
const fightsAll = loadBacktest();
let [d0, d1] = SPLITS[SPLIT];
if (args.years) { const [y0, y1] = String(args.years).split("-"); d0 = `${y0}-01-01`; d1 = `${+(y1 || y0) + 1}-01-01`; }
if (d1 > VAULT_FROM) { console.error("predict_harness: the vault is sealed"); process.exit(2); }
if (SPLIT === "train" && d1 > "2024-01-01") { console.error("predict_harness: --split train covers 2019-2023 only"); process.exit(2); }
let fights = fightsAll.filter((f) => f.date >= d0 && f.date < d1);
if (args.limit) fights = fights.slice(-(+args.limit));
const STACK_DIR = path.join(ROOT, "data/derived/v6");
const engs = PKGS.map((p) => { const E = require(path.join(p.dir, "engine3.js")); return `${p.name}: engine ${E.VERSION} params ${E.params().version} (${p.mode})`; });
console.log(`predict_harness on ${SPLIT} ${d0}..${d1}: ${fights.length} fights, kinds ${KINDS.join("/")}, ${SIMS} sims per order; ${engs.join("; ")}`);

function runAll() {
  return new Promise((resolve, reject) => {
    const ids = fights.map((f) => f.id), chunks = [];
    for (let i = 0; i < ids.length; i += 10) chunks.push(ids.slice(i, i + 10));
    const res = []; let next = 0, live = 0, done = 0; const t0 = Date.now();
    function feed(w) {
      if (next >= chunks.length) { w.terminate(); live--; if (live === 0) resolve(res); return; }
      w.postMessage({ cmd: "run", ids: chunks[next++] });
    }
    for (let k = 0; k < Math.min(WORKERS, chunks.length); k++) {
      const w = new Worker(__filename, { workerData: { pkgs: PKGS, kinds: KINDS, sims: SIMS, mlpathrec: MLP_FILE, stackDir: STACK_DIR,
        oof: args.oof || null, v6From: +(args["v6-from"] || 2019) } });
      live++;
      w.on("message", (m) => {
        if (m.cmd === "done") {
          res.push(...m.out); done += m.out.length;
          if (done % 200 < m.out.length) console.log(`  ${done}/${ids.length} fights, ${((Date.now() - t0) / 1000).toFixed(0)} s`);
          feed(w);
        }
      });
      w.on("error", reject);
      feed(w);
    }
  });
}

(async () => {
  const t0 = Date.now();
  const recs = await runAll();
  const byId = new Map(fights.map((f) => [f.id, f]));
  for (const r of recs) {
    const f = byId.get(r.id), res = f.result || {};
    r.result = { winner: res.winner || null, method: res.method || null, round: res.round || null, t: res.t || res.time_s || null };
    r.division = f.division; r.title = !!f.title;
  }
  recs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));
  const sha = (p) => require("crypto").createHash("sha256").update(fs.readFileSync(p)).digest("hex");
  const meta = { tool: "tools/predict_harness.js", built: new Date().toISOString(), split: SPLIT, range: [d0, d1], sims_per_order: SIMS, kinds: KINDS,
    packages: PKGS.map((p) => { const E = require(path.join(p.dir, "engine3.js")); return { name: p.name, mode: p.mode, dir: path.relative(ROOT, p.dir), engine_version: E.VERSION,
      params_version: E.params().version, engine_sha256: sha(path.join(p.dir, "engine3.js")), params_sha256: sha(path.join(p.dir, "params3.js")),
      blend_sha256: sha(path.join(p.dir, "ml", "blend.js")) }; }),
    inputs: { v6_stacks_sha256: sha(path.join(ROOT, "data/derived/v6_stacks.json")), mr_s2_sha256: sha(path.join(ROOT, "data/derived/mr_s2.json")),
      oof: args.oof || (+String(require(path.join(PKGS[0].dir, "engine3.js")).VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json"),
      embed_recipe: "tools/mlpathrec.js: fold-honest coef_fh for engine major >= 6 (data/derived/embed_blend_fh.json)", cmp_stacks: CMP_STACKS("data/derived/v6") },
    n_fights: recs.length, failed: recs.filter((r) => r.err).length, wall_s: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), JSON.stringify({ meta, fights: recs }));
  console.log(`wrote ${OUT}: ${recs.length} fights, ${meta.failed} failed, ${meta.wall_s} s`);
  const bad = recs.filter((r) => r.err).slice(0, 3);
  for (const r of bad) console.log("  ERR", r.id, r.err.split("\n")[0]);
})();
