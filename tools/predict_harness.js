#!/usr/bin/env node
/* predict_harness.js: the v6 predict harness (docs/V6_V10_PLAN.md section 3, cycle 1, work item 6). Scores FightEngine.predict
   packages of FROZEN engine copies on backtest_dev.json, side by side on the same fights with common random numbers, in all
   three line regimes, and writes per-fight records for tools/predict_score.py (metrics, paired event-cluster CIs, the
   forward-chained pool-weight fit and the gate / look verdicts).

     node tools/predict_harness.js --split train --years 2019-2023 --sims 300 --workers 3 \
          --pkg v6=versions/v6:v6 --pkg v501=versions/v5.0.1-rejected:v5 --out data/derived/v6/gate_train.json
     node tools/predict_harness.js --split val --sims 300 --pkg v6=versions/v6:v6 --pkg v501=...:v5 --out ...   (the look)

   From v7 on (v6 review): every --split val run and every binding gate run (--binding) needs --protocol <file>, a JSON file
   committed before the run that fixes version, run, split, input_pipelines, packages and out (see checkProtocol below);
   a look also needs its data/derived/val_look_ledger.json row committed in HEAD. Runs without it are labelled non-binding.

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
   Inputs per fight are leak-free exactly as tools/evalv.js / tools/predict_eval.js build them. Never reads a 2026 fight.

   v7 (docs/V6_V10_PLAN.md cycle 2 + the cycle-1 re-bundle onto the v4 simulator; 7.1 item 10):
   --pkg name=engineDir:v7     the v7 package (winner 'ml2stack', S2 cells, as mode v6) run with props OFF (opts.propsOn false), so the
                               record holds the cycle-1 cells; the bout's de-vigged props consensus (data/derived/props.json, A/B in the
                               data's orientation) is recorded once per fight in rec.props, and tools/v7_gate.py composes the props
                               package from these pieces with forward-chained weights (src/ml/blend.js applyProps, checked JS = Python)
   --pkg name=engineDir:cmp4   the honest v4 package (the latest kept version's package composition, as vault audit 1 "predict() v4
                               base"): the same engine file with params.blend { winner 'stack' (MoE expert stack, close-trained `model`
                               with a closing line, open-trained `model_open` with an opener, the absent block without a line), mrModel
                               'S' (methodround S, SM with a closing line), debut / statDist / props off }; per-year stackers
                               --cmp-stacks <prefix> (<prefix>2020.json ... <prefix>2023.json: fit on 2019..Y-1 with this engine's
                               evalv rows); 2019-2020 rows use the fit through 2020 (flagged inSample; only used to fit pool weights)
   Packages on the same engine file must produce identical simulator cells (common random numbers; asserted). */
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
const CMP_STACKS = (dir, prefix) => { const P = prefix || (dir + "/cmp_stack_v501_fit"); return { "2019": P + "2020.json", "2020": P + "2020.json",
  "2021": P + "2020.json", "2022": P + "2021.json", "2023": P + "2022.json", "2024": P + "2023.json", "2025": P + "2023.json" }; };
const CMP4_BLEND = { winner: "stack", mrModel: "S", debut: false, statDist: false, props: { on: false } };

// ================================================================== worker
if (!isMainThread) {
  const W = workerData;
  const PK = W.pkgs.map((p) => {
    const E = require(path.join(p.dir, "engine3.js"));
    return { name: p.name, mode: p.mode, dir: p.dir, E, FB: require(path.join(p.dir, "ml", "blend.js")), PRM: E.params() };
  });
  // matchup inputs: each package runs on ITS OWN frozen input pipeline (its copy's mlpathrec.js and its version's learned-rate
  // table: mlrates_oof_fh.json for engine major >= 6, else mlrates_oof.json), as tools/evalv.js evaluates versions; with
  // --shared-inputs every package gets the first package's inputs (a sensitivity run)
  const E = PK[0].E, PRM = PK[0].PRM;
  const fights = loadBacktest();
  const byId = new Map(fights.map((f) => [f.id, f]));
  const priors = readJSON("data/derived/mlcal_priors_asof.json");
  const oofFor = (Ek) => readJSON(W.oof || (+String(Ek.VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json"));
  const OOFS = PK.map((p, k) => (W.shared && k > 0) ? null : oofFor(p.E));
  const names = OOFS[0].meta.targets;
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
  const XRS = PK.map((p, k) => (W.shared && k > 0) ? null : require(fs.existsSync(path.join(p.dir, "mlpathrec.js")) ? path.join(p.dir, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js"))(p.E, ROOT));
  const PRs = PK.map((p) => require(path.join(ROOT, "tools/predictrec.js"))(p.E, ROOT, { stacks: CMP_STACKS(W.stackDir, W.cmpStacks), inSample: true,
    v6: p.mode === "v6", v7: p.mode === "v7", blendPath: path.relative(ROOT, path.join(p.dir, "ml", "blend.js")), ml2Rolling: !!W.ml2Rolling }));
  function baseOpts(f, k) {
    const OOF = OOFS[k], XR = XRS[k];
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
        const B0 = baseOpts(f, 0);
        let simRef = null;
        rec.simCellsBy = {};
        for (let k = 0; k < PK.length; k++) {
          const P = PK[k], R0 = rec.pk[P.name] = {};
          simRef = null;   // common random numbers: one simulator run per package, identical across line kinds (asserted)
          if (P.mode === "v6" && +f.date.slice(0, 4) < (W.v6From || 2019)) continue;
          // the v5 package has no stacker fit before 2021 (per-year MoE exports start with the fit through 2020): it is
          // scored on 2021+ only; the v6 package's 2019-2020 rows exist only to fit its pool weight (flagged inSample)
          if (P.mode === "v5" && +f.date.slice(0, 4) < (W.cmpFrom || 2021)) continue;
          const b = (W.shared || k === 0) ? B0 : baseOpts(f, k);
          for (const kind of W.kinds) {
            const o = Object.assign({}, b, PRs[k].opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: W.sims, interval: false });
            if (P.mode === "v5") { delete o.winnerStacks; delete o.winnerFit; }
            if (P.mode === "v7") {
              // cycle-1 cells (props off); the consensus is recorded once per fight for tools/v7_gate.py
              if (o.props && !rec.props) rec.props = { m6: o.props.m6 || null, n_books: o.props.n_books || null, gd: o.props.gd == null ? null : o.props.gd };
              o.propsOn = false;
            }
            if (P.mode === "cmp4") {
              o.params = Object.assign({}, o.params || {}, { blend: Object.assign({}, ((o.params || {}).blend) || {}, CMP4_BLEND) });
              delete o.props; delete o.winnerStacks; delete o.winnerFit;
              if (+f.date.slice(0, 4) < 2021) o.inSample = true;   // the 2019-2020 rows use the stacker fit through 2020 (pool-weight fits only)
            }
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
        // common random numbers across packages that share an engine file (v7: the v7 and cmp4 packages run one simulator)
        const byFile = {};
        for (const P of PK) {
          const c = rec.simCellsBy[P.name]; if (!c) continue;
          const key = path.join(P.dir, "engine3.js");
          if (byFile[key] && JSON.stringify(byFile[key]) !== JSON.stringify(c)) throw new Error("simulator cells differ between packages on " + key + " for " + f.id);
          byFile[key] = c;
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
for (const p of PKGS) if (["v6", "v5", "v7", "cmp4"].indexOf(p.mode) < 0) { console.error("predict_harness: mode must be v6, v5, v7 or cmp4"); process.exit(2); }
if (PKGS.some((p) => p.mode === "cmp4") && !args["cmp-stacks"]) { console.error("predict_harness: mode cmp4 needs --cmp-stacks <prefix> (per-year stackers <prefix>2020.json ...)"); process.exit(2); }
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
// ---------------------------------------------------------------- binding runs (v6 review)
// The v6 gate's comparator definition was chosen after two failing runs, and the v6 ledger row could not be shown to precede
// the look. From v7 on a BINDING run (every --split val run, and a gate run marked --binding) needs --protocol <file>: a JSON
// document committed to git (tracked and identical to HEAD) that fixes, before the run, { version, run: 'gate' | 'look',
// split, input_pipelines: 'own' | 'shared', packages: ["name=dir:mode", ...], out }. Refused when the file is untracked or
// modified, when the command line differs from it, when the output already exists (a binding run happens once), or, for
// --split val, when HEAD's data/derived/val_look_ledger.json has no row for the version (the row is committed first).
function gitOut(a) { return require("child_process").execFileSync("git", ["-C", ROOT].concat(a), { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }); }
function checkProtocol() {
  const binding = SPLIT === "val" || !!args.binding;
  if (!binding) return { binding: false, note: "non-binding run (no --protocol): a development or sensitivity run, never a gate verdict" };
  if (!args.protocol || args.protocol === true) { console.error("predict_harness: a binding run (--split val or --binding) needs --protocol <committed JSON>"); process.exit(2); }
  const rel = path.relative(ROOT, path.resolve(ROOT, String(args.protocol)));
  try { gitOut(["ls-files", "--error-unmatch", rel]); } catch (e) { console.error("predict_harness: protocol " + rel + " is not tracked by git; commit it before the run"); process.exit(2); }
  try { gitOut(["diff", "--quiet", "HEAD", "--", rel]); } catch (e) { console.error("predict_harness: protocol " + rel + " differs from HEAD; commit it before the run"); process.exit(2); }
  const P = readJSON(rel), want = { split: SPLIT, input_pipelines: args["shared-inputs"] ? "shared" : "own", packages: args.pkg.slice(), out: String(OUT) };
  // v7: a protocol may also fix the years, sims, kinds and comparator stackers; when it does, the command line must match
  if (P.years !== undefined) want.years = args.years ? String(args.years) : null;
  if (P.sims !== undefined) want.sims = SIMS;
  if (P.kinds !== undefined) want.kinds = KINDS.join(",");
  if (P.cmp_stacks !== undefined) want.cmp_stacks = args["cmp-stacks"] ? String(args["cmp-stacks"]) : null;
  if (P.ml2_rolling !== undefined) want.ml2_rolling = !!args["ml2-rolling"];
  for (const k of Object.keys(want)) {
    if (JSON.stringify(P[k]) !== JSON.stringify(want[k])) { console.error(`predict_harness: protocol ${rel} fixes ${k} = ${JSON.stringify(P[k])}, the command line gives ${JSON.stringify(want[k])}`); process.exit(2); }
  }
  if (!P.version || (P.run !== "gate" && P.run !== "look")) { console.error("predict_harness: protocol needs version and run ('gate' | 'look')"); process.exit(2); }
  if (fs.existsSync(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT))) { console.error("predict_harness: " + OUT + " exists; a binding run happens once"); process.exit(2); }
  if (SPLIT === "val") {
    let L = null;
    try { L = JSON.parse(gitOut(["show", "HEAD:data/derived/val_look_ledger.json"])); } catch (e) { L = null; }
    const rows = (L && L.engine_versions) || [], v = String(P.version);
    if (!rows.some((r) => r.version === v || String(r.version).startsWith(v + " "))) {
      console.error("predict_harness: HEAD's data/derived/val_look_ledger.json has no row for " + v + "; append and commit it before the look"); process.exit(2);
    }
  }
  return { binding: true, protocol: rel, protocol_sha256: require("crypto").createHash("sha256").update(fs.readFileSync(path.join(ROOT, rel))).digest("hex"),
    git_head: gitOut(["rev-parse", "HEAD"]).trim(), version: P.version, run: P.run };
}
const PROTOCOL = checkProtocol();
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
      const w = new Worker(__filename, { workerData: { pkgs: PKGS, kinds: KINDS, sims: SIMS, mlpathrec: MLP_FILE, stackDir: STACK_DIR, cmpStacks: args["cmp-stacks"] || null,
        oof: args.oof || null, v6From: +(args["v6-from"] || 2019), shared: !!args["shared-inputs"], ml2Rolling: !!args["ml2-rolling"] } });
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
  const meta = { tool: "tools/predict_harness.js", built: new Date().toISOString(), split: SPLIT, range: [d0, d1], sims_per_order: SIMS, kinds: KINDS, protocol: PROTOCOL,
    packages: PKGS.map((p) => { const E = require(path.join(p.dir, "engine3.js")); return { name: p.name, mode: p.mode, dir: path.relative(ROOT, p.dir), engine_version: E.VERSION,
      params_version: E.params().version, engine_sha256: sha(path.join(p.dir, "engine3.js")), params_sha256: sha(path.join(p.dir, "params3.js")),
      blend_sha256: sha(path.join(p.dir, "ml", "blend.js")) }; }),
    inputs: { v6_stacks_sha256: sha(path.join(ROOT, "data/derived/v6_stacks.json")), mr_s2_sha256: sha(path.join(ROOT, "data/derived/mr_s2.json")),
      oof: args.oof || (+String(require(path.join(PKGS[0].dir, "engine3.js")).VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json"),
      embed_recipe: "each package's frozen mlpathrec.js: fold-honest coef_fh for engine major >= 6 (data/derived/embed_blend_fh.json), leave-one-year-out / exported recipe before",
      input_pipelines: args["shared-inputs"] ? "shared (the first package's inputs for every package; sensitivity run)" : "own (each package's frozen mlpathrec.js and learned-rate table)",
      ml2_schedule_2024_2025: args["ml2-rolling"] ? "monthly rolling (ml2.json ml2_roll / ml2_lr_roll)" : "static fit < 2024 (v6_stacks.json inputs)",
      cmp_stacks: CMP_STACKS("data/derived/v6", args["cmp-stacks"] || null),
      cmp_stacks_sha256: (() => { const o = {}; for (const [y, f] of Object.entries(CMP_STACKS("data/derived/v6", args["cmp-stacks"] || null))) { const fp = path.join(ROOT, f); if (fs.existsSync(fp)) o[y] = sha(fp); } return o; })(),
      props_sha256: fs.existsSync(path.join(ROOT, "data/derived/props.json")) ? sha(path.join(ROOT, "data/derived/props.json")) : null,
      market_sha256: sha(path.join(ROOT, "data/derived/market.json")), methodround_sha256: sha(path.join(ROOT, "data/derived/methodround.json")) },
    n_fights: recs.length, failed: recs.filter((r) => r.err).length, wall_s: Math.round((Date.now() - t0) / 1000) };
  fs.writeFileSync(path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT), JSON.stringify({ meta, fights: recs }));
  console.log(`wrote ${OUT}: ${recs.length} fights, ${meta.failed} failed, ${meta.wall_s} s`);
  const bad = recs.filter((r) => r.err).slice(0, 3);
  for (const r of bad) console.log("  ERR", r.id, r.err.split("\n")[0]);
})();
