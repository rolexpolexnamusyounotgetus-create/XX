#!/usr/bin/env node
/* blend_anchor component: simulator runs on the 2019-2023 backtest_dev fights (train years only).

   node tools/blend_anchor_bt.js sim --stage plain [--sims 200] [--part 0 --parts 3]
   node tools/blend_anchor_bt.js sim --stage anchor --targets out/blend_anchor/targets.json [--sims 200] [--part i --parts n]
   node tools/blend_anchor_bt.js pilot [--n 150] [--sims 200]      # anchor slope prior: logit P_sim at s = -0.6, 0, +0.6
   node tools/blend_anchor_bt.js merge --stage plain|anchor

   Every fight dated 2019-01-01..2023-12-31 in data/derived/blend_anchor_dev.json (nothing later is read or run) is
   simulated in both corner orders (A-B with seed md5(id:1), B-A with md5(id:2): common random numbers across stages and
   anchor offsets) with the engine as it is in src/ (v4: learned stat-line rates), using leak-free inputs only:
     - profiles: backtest_dev's frozen pre-fight snapshots;
     - priors: data/derived/mlcal_priors_asof.json[year] (division rates from the 5 years before Jan 1 of the fight's year);
     - learned rates: data/derived/mlrates_oof.json (each year predicted by a model trained on earlier years), passed as
       opts.ml = { A, B } so no live model is consulted;
     - v5 merge step 5: the v5 components' walk-forward inputs for whichever components are on (durability records + train
       NORM, tools/durrec.js; SOS pairs, tools/sosrec.js; embed / oppadj / preufc, tools/mlpathrec.js), given in the A-B
       order (FightBlend.swapOpts swaps them for the B-A run) and asserted applied on both runs. Without them the engine
       would fall back to live fits that include 2024-26. REBUILD (Calibrate stage): rerun plain -> eval targets -> pilot
       -> anchor -> eval report only after the final component flags are fixed (the cells, mrWeight and slope0 belong to
       one engine).
   The anchor stage solves the per-fight skill offset (src/ml/blend.js anchor) so the simulator's own P(A) matches the
   out-of-fold blend target from tools/blend_anchor_eval.js (targets.json), starting from the plain run at s = 0.
   Output: out/blend_anchor/<stage>_part<i>of<n>.json, merged to out/blend_anchor/<stage>.json (gitignored).
   Run with nice -n 5 and at most 3 parts at once on the shared machine. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FB = require(path.join(ROOT, "src/ml/blend.js"));
const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT);      // v5 durability walk-forward records
const SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT);      // v5 walk-forward SOS pairs
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);   // v5 embed / oppadj / preufc inputs

const args = process.argv.slice(2), mode = args[0];
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const STAGE = opt("--stage", "plain"), SIMS = +opt("--sims", 200), PART = +opt("--part", 0), PARTS = +opt("--parts", 1);
const OUTDIR = process.env.BLEND_ANCHOR_OUT || path.join(ROOT, "out/blend_anchor");
const BT = process.env.BACKTEST_DEV || path.join(ROOT, "data/derived/backtest_dev.json");
fs.mkdirSync(OUTDIR, { recursive: true });

function J(f) { return JSON.parse(fs.readFileSync(f, "utf8")); }
function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
function r5(x) { return x == null ? null : Math.round(x * 1e5) / 1e5; }

if (mode === "merge") {
  const parts = fs.readdirSync(OUTDIR).filter((f) => new RegExp("^" + STAGE + "_part\\d+of\\d+\\.json$").test(f)).sort();
  const out = { meta: null, fights: {} };
  for (const f of parts) { const j = J(path.join(OUTDIR, f)); out.meta = out.meta || j.meta; Object.assign(out.fights, j.fights); }
  out.meta.n = Object.keys(out.fights).length; out.meta.parts = parts;
  fs.writeFileSync(path.join(OUTDIR, STAGE + ".json"), JSON.stringify(out));
  console.log("merged", parts.length, "parts,", out.meta.n, "fights ->", path.join(OUTDIR, STAGE + ".json"));
  process.exit(0);
}

const dev = J(path.join(ROOT, "data/derived/blend_anchor_dev.json"));
const bt = J(BT);
const PRI = J(path.join(ROOT, "data/derived/mlcal_priors_asof.json"));
const OOF = J(path.join(ROOT, "data/derived/mlrates_oof.json"));
const T = OOF.meta.targets;
const keys = bt.meta.keys;
const EVERY = +opt("--every", 1);
const fightsAll = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date <= "2023-12-31" && dev.fights[f.id]).filter((f, i) => i % EVERY === 0);
function obj(a) { const o = {}; T.forEach((t, i) => { o[t] = a[i]; }); return o; }
function setup(f) {
  const A = Object.assign({ keys }, f.A), B = Object.assign({ keys }, f.B);
  const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: PRI[f.date.slice(0, 4)],
    seeds: [seedOf(f.id, 1), seedOf(f.id, 2)] };
  const r = OOF.fights[f.id];
  o.ml = r ? { A: obj(r.A), B: obj(r.B) } : false;
  // v5 inputs in the A-B order (symSim's B-A run swaps them with FightBlend.swapOpts)
  if (DR.on(o.params)) DR.apply(o, f.id, false);
  if (SR.on(o.params)) SR.apply(o, f, false);
  XR.apply(o, f, false, o.params);
  return { A, B, o, ml: !!r };
}
function assertV5(r, f, o) {   // both corner orders got their walk-forward inputs
  for (const m of [r.m, r.m2]) { if (!m) continue; DR.assertApplied(m, f.id, o.params); SR.assertApplied(m, f.id, o.params); XR.assertApplied(m, f.id, o.params); }
}
function pack(r) {
  return { p: r5(r.p), pA: r5(r.pA), pB: r5(r.pB), pD: r5(r.pD), cells: r.cells.map(r5), cellMin: r.cellMin.map((x) => x == null ? null : Math.round(x * 1e3) / 1e3),
    cellN: r.cellN, sumA: r.sumA.map((x) => Math.round(x * 100) / 100), sumB: r.sumB.map((x) => Math.round(x * 100) / 100),
    minutes: Math.round(r.minutes * 1000) / 1000, n: r.n, runs: r.runs, R: r.R };
}
const P0 = E.params(), CFG = FB.cfgOf(P0, {});
// anchor channel overrides for the channel-mix experiment (train years only): --cAcc --cTd --cPow --slope0
["cAcc", "cTd", "cPow", "slope0"].forEach((k) => { const v = opt("--" + k, null); if (v != null) CFG.anchor[k] = +v; });
const TAG = opt("--tag", "");

if (mode === "pilot") {
  const n = +opt("--n", 150), offs = [-0.6, 0.6];
  const pick = fightsAll.filter((f, i) => i % Math.max(1, Math.floor(fightsAll.length / n)) === 0).slice(0, n);
  const rows = [];
  const t0 = Date.now();
  for (const f of pick) {
    const s = setup(f), z = [];
    for (const off of [offs[0], 0, offs[1]]) {
      const rr = FB.symSim(E, s.A, s.B, s.o, SIMS, s.o.seeds, off, CFG.anchor, true);
      assertV5(rr, f, s.o);
      z.push(FB.logit(Math.min(0.995, Math.max(0.005, rr.p))));
    }
    rows.push(z);
  }
  const sl = rows.map((z) => (z[2] - z[0]) / (offs[1] - offs[0]));
  const mean = sl.reduce((a, b) => a + b, 0) / sl.length, sorted = sl.slice().sort((a, b) => a - b);
  const sd = Math.sqrt(sl.reduce((a, b) => a + (b - mean) * (b - mean), 0) / (sl.length - 1));
  const res = { n: rows.length, sims: SIMS, offsets: offs, slope_mean: mean, slope_median: sorted[Math.floor(sorted.length / 2)], slope_sd: sd,
    slope_se: sd / Math.sqrt(sl.length), cAcc: CFG.anchor.cAcc, cTd: CFG.anchor.cTd, cPow: CFG.anchor.cPow, secs: (Date.now() - t0) / 1000 };
  fs.writeFileSync(path.join(OUTDIR, "pilot" + (TAG ? "_" + TAG : "") + ".json"), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
  process.exit(0);
}

if (mode !== "sim") { console.error("usage: sim | pilot | merge"); process.exit(1); }
const targets = STAGE.startsWith("anchor") ? J(opt("--targets", path.join(OUTDIR, "targets.json"))) : null;
const plain = STAGE.startsWith("anchor") ? J(path.join(OUTDIR, "plain.json")).fights : null;
const fights = fightsAll.filter((f, i) => i % PARTS === PART);
const res = {};
const t0 = Date.now();
let k = 0;
for (const f of fights) {
  const s = setup(f);
  try {
    if (STAGE === "plain") {
      const r = FB.symSim(E, s.A, s.B, s.o, SIMS, s.o.seeds, 0, CFG.anchor, true);
      assertV5(r, f, s.o);
      res[f.id] = pack(r);
      res[f.id].ml = s.ml;
    } else {
      const tg = targets.fights[f.id];
      if (tg == null || !plain[f.id]) continue;
      const base = Object.assign({}, plain[f.id]);
      base.n = SIMS;
      base.rates = null;
      s.o.anchorSims = SIMS;
      const a = FB.anchor(E, s.A, s.B, s.o, tg, CFG, base);
      assertV5(a.sim, f, s.o);
      res[f.id] = pack(a.sim);
      res[f.id].s = Math.round(a.s * 1e4) / 1e4; res[f.id].target = r5(tg); res[f.id].iters = a.iters; res[f.id].slope = r5(a.slope);
      res[f.id].hist = a.history.map((h) => [Math.round(h.s * 1e4) / 1e4, r5(h.p)]);
    }
  } catch (err) {
    res[f.id] = { err: String(err.message || err) };
  }
  if (++k % 50 === 0) console.log(`${STAGE} part ${PART}/${PARTS}: ${k}/${fights.length} (${((Date.now() - t0) / k).toFixed(0)} ms/fight)`);
}
const sha = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
const meta = { tool: "tools/blend_anchor_bt.js", stage: STAGE, engine_version: E.VERSION, params_version: P0.version, sims_per_order: SIMS,
  engine3_sha256_16: sha(path.join(ROOT, "src/engine3.js")), params3_sha256_16: sha(path.join(ROOT, "src/params3.js")),
  mlrates_sha256_16: sha(path.join(ROOT, "src/ml/mlrates.js")), blend_sha256_16: sha(path.join(ROOT, "src/ml/blend.js")),
  anchor: CFG.anchor, built: new Date().toISOString(), window: "2019-01-01..2023-12-31",
  cells: "A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW (A = first-named); symmetric over both corner orders",
  sums: FB.SK };
fs.writeFileSync(path.join(OUTDIR, `${STAGE}_part${PART}of${PARTS}.json`), JSON.stringify({ meta, fights: res }));
console.log(`done ${k} fights in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
