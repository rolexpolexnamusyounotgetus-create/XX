#!/usr/bin/env node
/* officials_ablate.js: train-only ablation of the officials component (params.components.officials).

   Fights: data/derived/backtest_dev.json entries dated 2019-01-01 .. 2023-12-31 (hidden-data protocol: never 2024+).
   Inputs, all leak-free: frozen pre-fight profiles (backtest_dev), division priors as of Jan 1 of the fight year
   (mlcal_priors_asof.json), out-of-fold ML stat-line rates (mlrates_oof.json, time-ordered folds trained on earlier
   years) applied through opts.ml, the walk-forward officials table of the fight's year (officials_engine.json table Y
   is fit only on years before Y) and the fight's actual officials (officials_bt.json: referee; the three judges when
   the cards name them, else the event's judge pool).
   Symmetric: every fight is simulated in both corner orders. Common random numbers: each fight-orientation has one
   seed shared by every variant, and the officials component keeps the main RNG stream in step with the flag-off
   engine, so variants differ only where officials change an outcome.

   Variants: off (v4 judging, components.officials false), lg (officials on, league judge model only: no per-judge
   effects, neutral referee), jd (per-judge tendencies, neutral referee), full (per-judge + referee).

     node tools/officials_ablate.js --shard 0/3 [--n 400] [--out <file>] [--limit K]
   Output per shard: { meta, rows: [{ id, date, event, o: [orientation0, orientation1] }] }, each orientation
   { v: { off|lg|jd|full: { n, bins[7], dec[7], n108, rj, kdr, kdrf, mins, st: {A: {...}, B: {...}} } } }.
   dec = A UD, A SD, A MD, draw, B MD, B SD, B UD counts. tools/officials_ablate_report.py turns shards into metrics. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const ML = require(path.join(ROOT, "src/ml/mlrates.js"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const N = +opt("--n", 400), LIMIT = +opt("--limit", 0);
const [SH, NSH] = String(opt("--shard", "0/1")).split("/").map(Number);
const OUT = opt("--out", path.join(ROOT, `out/officials_ablate/shard${SH}.json`));
function derived(name) {
  const a = path.join(ROOT, "data/derived", name);
  if (fs.existsSync(a)) return a;
  const b = path.join("/home/user/XX/data/derived", name);   // large gitignored files live in the main checkout (read-only)
  if (fs.existsSync(b)) return b;
  throw new Error("missing " + name);
}
const load = (n) => JSON.parse(fs.readFileSync(derived(n), "utf8"));
const BT = load("backtest_dev.json"), PRI = load("mlcal_priors_asof.json"), OOF = load("mlrates_oof.json");
const DEV = ML.load(load("mlrates_dev.json")), OFFT = load("officials_engine.json"), OBT = load("officials_bt.json").fights;
const fights = BT.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");
const mine = fights.filter((f, i) => i % NSH === SH).slice(0, LIMIT || undefined);
const STATS = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att"];
const DECK = { "A:UD": 0, "A:SD": 1, "A:MD": 2, "D:DRAW": 3, "B:MD": 4, "B:SD": 5, "B:UD": 6 };

function prof(sd, name) {
  return { name: name, S: sd.S, age: sd.age, ko_losses: sd.ko_losses || 0, division: sd.home || null, home: sd.home || null,
    pace: sd.pace || null, pace_w: sd.pace_w || null, n: sd.n, elo: sd.elo, height_in: sd.height_in, reach_in: sd.reach_in, stance: sd.stance };
}
function hashSeed(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; }
function rates(arr) { const o = {}; OOF.meta.targets.forEach((t, i) => { o[t] = arr[i]; }); return o; }

function runVariant(m, seed) {
  const nR = m.rounds;      // one RNG per simulated fight: a divergence (e.g. an earlier stoppage) never shifts later sims
  const o = { n: N, bins: [0, 0, 0, 0, 0, 0, 0], dec: [0, 0, 0, 0, 0, 0, 0], n108: 0, rj: 0, kdr: 0, kdrf: 0, mins: 0, finR: new Array(nR).fill(0),
    st: { A: {}, B: {} } };
  for (const k of STATS) { o.st.A[k] = 0; o.st.B[k] = 0; }
  for (let i = 0; i < N; i++) {
    const f = E.simulate(m, E.makeRng((seed + Math.imul(i + 1, 0x9E3779B1)) >>> 0), false);
    o.bins[E.bucket(f)]++;
    const dk = DECK[f.winner + ":" + f.method];
    if (dk != null) { o.dec[dk]++; o.rj += 3 * nR; o.mins += 5 * nR; }
    else {
      o.finR[f.round - 1]++;
      o.mins += 5 * (f.round - 1) + f.t / 60;
      o.rj += 3 * (f.method === "CORNER" || f.method === "DOC" ? f.round : f.round - 1);
    }
    o.n108 += f.n108; o.kdr += f.kdr; o.kdrf += f.kdrf;
    for (const k of STATS) { o.st.A[k] += f.totals.A[k]; o.st.B[k] += f.totals.B[k]; }
  }
  for (const k of STATS) { o.st.A[k] /= N; o.st.B[k] /= N; }
  return o;
}

const t0 = Date.now();
const rows = [];
let checked = 0, checkFail = 0;
mine.forEach((f, idx) => {
  const year = f.date.slice(0, 4), pri = PRI[year];
  const div = f.prior_division || f.division;
  const tab = E.officialsTableFor(OFFT, f.date);
  if (!tab || +Object.keys(OFFT.tables).find((y) => OFFT.tables[y] === tab) > +year) throw new Error("no walk-forward table for " + f.date);
  const ob = OBT[f.id] || {};
  const ent = OOF.fights[f.id];
  const row = { id: f.id, date: f.date, event: f.event, o: [] };
  for (let sw = 0; sw < 2; sw++) {
    const pA = prof(sw ? f.B : f.A, "A"), pB = prof(sw ? f.A : f.B, "B");
    const opts = { division: div, rounds: f.rounds, title: f.title, date: f.date, priors: pri, officials: { tables: { [year]: tab }, aliases: OFFT.aliases },
      referee: ob.referee || undefined, params: { components: { officials: true } } };
    if (ob.judges && ob.judges.length === 3) opts.judges = ob.judges; else if (ob.judge_pool) opts.judgePool = ob.judge_pool;
    if (ent && ent.A && ent.B) { const rA = rates(ent.A), rB = rates(ent.B); opts.ml = { pred: sw ? { A: rB, B: rA } : { A: rA, B: rB }, model: DEV }; }
    else opts.ml = false;
    const m = E.matchup(pA, pB, opts);
    const seed = hashSeed(f.id + ":" + sw);
    const V = {};
    V.full = runVariant(m, seed);
    const mj = Object.assign({}, m, { off: Object.assign({}, m.off, { useRef: false }) });
    V.jd = runVariant(mj, seed);
    const ml = Object.assign({}, m, { off: Object.assign({}, m.off, { useRef: false, perJudge: false }) });
    V.lg = runVariant(ml, seed);
    const mo = Object.assign({}, m, { off: null });
    V.off = runVariant(mo, seed);
    // spot check: the off variant (m.off = null) equals a genuinely flag-off matchup
    if (checked < 6) {
      const m0 = E.matchup(pA, pB, Object.assign({}, opts, { params: { components: { officials: false } } }));
      const v0 = runVariant(m0, seed);
      checked++;
      if (JSON.stringify(v0) !== JSON.stringify(V.off)) checkFail++;
    }
    row.o.push({ mlApplied: !!m.mlApplied, judgesKnown: !!opts.judges, v: V });
  }
  rows.push(row);
  if (idx % 25 === 0) console.error(`shard ${SH}: ${idx}/${mine.length} ${((Date.now() - t0) / 1000).toFixed(0)} s`);
});
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ meta: { n: N, shard: SH, nshard: NSH, engine: E.VERSION, offCheck: { checked, failed: checkFail },
  secs: (Date.now() - t0) / 1000 }, rows }));
console.log(`shard ${SH}/${NSH}: ${rows.length} fights x 2 orientations x 4 variants x ${N} sims in ${((Date.now() - t0) / 1000).toFixed(0)} s; off-variant check ${checked - checkFail}/${checked}`);
