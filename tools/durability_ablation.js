#!/usr/bin/env node
/* Train-only ablation of the durability component (params.components.durability) on backtest_dev fights.

   node tools/durability_ablation.js run [--sims 250] [--part 0 --parts 3] [--out DIR] [--from 2019-01-01] [--to 2023-12-31]
        [--variants off,on] [--set durability.kdCal=1.4] [--no-ml] [--limit N] [--stride K]
   python3 tools/durability_ablation_report.py DIR      (metrics, paired event-cluster bootstrap CIs)

   Every fight is simulated in both corner orders (A-B and B-A) for every variant with common random numbers: simulated
   fight s of orientation o uses the same seed in every variant, so the variants differ only through the matchup tables.
   Inputs are leak-free for 2019-2023:
     profiles  backtest_dev.json frozen pre-fight snapshots (read from data/derived, else the main checkout, read-only)
     priors    data/derived/mlcal_priors_asof.json[year]: division rates from the 5 years before Jan 1 of the fight year
     ML rates  data/derived/mlrates_oof.json (time-ordered out-of-fold tables, cv<year> folds for 2019-2023), so the
               v4 engine (learned stat-line rates) is the baseline; --no-ml runs the plain v3-style tables instead
     durability data/derived/durability.json backtest[fight_id]: strict walk-forward chin_re, chin_cov, pow_re, pow_cov
               (coefficients fit on 2008..Y-1) and p, from which base = L730(t) x exp(const + division + context);
               NORM = the strict-refit 2019-2023 values (engine.norm_*_backtest_2019_2023)
   Hidden-data protocol (docs/BACKLOG.md): the tool refuses --to on or after 2024-01-01 unless --allow-validation, and
   never reads a fight dated 2026-01-01 or later. Output: DIR/part<k>of<n>.json. */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src", "engine3.js"));

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const has = (k) => args.includes(k);
const mode = args[0];
if (mode !== "run") { console.error("usage: node tools/durability_ablation.js run [...]"); process.exit(2); }
const SIMS = +opt("--sims", 250), PART = +opt("--part", 0), PARTS = +opt("--parts", 1);
const FROM = opt("--from", "2019-01-01"), TO = opt("--to", "2023-12-31");
const OUT = opt("--out", path.join(ROOT, "out", "durability_ablation"));
const VARIANTS = opt("--variants", "off,on").split(",");
const LIMIT = +opt("--limit", 0), STRIDE = +opt("--stride", 1);
if (TO >= "2024-01-01" && !has("--allow-validation")) { console.error("refusing to evaluate on 2024+ (hidden-data protocol); pass --allow-validation only for the v5 measurement"); process.exit(2); }
if (TO >= "2026-01-01") { console.error("refusing: 2026 fights are the vault"); process.exit(2); }

function readDerived(name) {
  const local = path.join(ROOT, "data", "derived", name);
  const main = path.join("/home/user/XX/data/derived", name);
  return JSON.parse(fs.readFileSync(fs.existsSync(local) ? local : main, "utf8"));
}
const bt = readDerived("backtest_dev.json");
const pri = readDerived("mlcal_priors_asof.json");
const oof = has("--no-ml") ? null : readDerived("mlrates_oof.json");
const dur = readDerived("durability.json");
const T = oof ? oof.meta.targets : null;
const keys = bt.meta.keys;
const normBt = { normChin: dur.engine.norm_chin_backtest_2019_2023, normPow: dur.engine.norm_pow_backtest_2019_2023 };

// --set path=value overrides (repeatable), applied to every "on*" variant
const sets = [];
args.forEach((a, i) => { if (a === "--set") sets.push(args[i + 1]); });
function setPath(obj, p, v) { const ks = p.split("."); let o = obj; for (let i = 0; i < ks.length - 1; i++) { o[ks[i]] = o[ks[i]] || {}; o = o[ks[i]]; } o[ks[ks.length - 1]] = v; }
function variantParams(v) {
  if (v === "off") return { components: { durability: false } };
  const P = { components: { durability: true }, durability: Object.assign({}, normBt) };
  for (const s of sets) { const [k, val] = s.split("="); setPath(P, k, val === "null" ? null : (isNaN(+val) ? val : +val)); }
  // named variants: on_w0 (pure durability: no weight on the engine's own KD structure), on_w1 (durability level and
  // context only, the engine's own fighter structure), on_rel (relative mode: the engine's division level). Their kdCal
  // is level-matched to "off" on the static exposure-weighted mean hazard over the selected train fights (matchLevel).
  if (v === "on_w0") P.durability.engineWeight = 0;
  if (v === "on_w1") P.durability.engineWeight = 1;
  if (v === "on_rel") P.durability.level = null;
  if (KDCAL[v] != null) { P.durability.kdCal = KDCAL[v]; P.durability.kdCalRel = KDCAL[v]; }
  return P;
}
const KDCAL = {};
const obj = (arr) => { const o = {}; T.forEach((t, i) => { o[t] = arr[i]; }); return o; };
function seedOf(s) { return parseInt(crypto.createHash("md5").update(s).digest("hex").slice(0, 8), 16); }
function durRec(f) {
  const d = dur.backtest[f.id];
  if (!d) return null;
  const pick = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
  const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov);
  const bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
  return { A: pick(d.A), B: pick(d.B), base: 0.5 * (bA + bB), fit_through: d.fit_through };
}

// level matching for the named variants (static hazards only: no simulation, no outcome except exposure weights)
function staticMean(v, list) {
  let num = 0, den = 0;
  for (const f of list) {
    const d = durRec(f), o8 = oof ? oof.fights[f.id] : null;
    if (!d || (oof && !o8) || !f.actual) continue;
    const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: pri[f.date.slice(0, 4)],
      ml: o8 ? { A: obj(o8.A), B: obj(o8.B) } : false, dur: { A: d.A, B: d.B, base: d.base }, params: variantParams(v) };
    const m = E.matchup(Object.assign({ keys }, f.A), Object.assign({ keys }, f.B), opts);
    num += f.actual.A.h_lnd * m.kd[0] + f.actual.B.h_lnd * m.kd[1]; den += f.actual.A.h_lnd + f.actual.B.h_lnd;
  }
  return num / den;
}
{
  const named = VARIANTS.filter((v) => v === "on_w0" || v === "on_w1" || v === "on_rel");
  if (named.length) {
    const list = bt.fights.filter((f) => f.date >= FROM && f.date <= TO && f.date < "2026-01-01");
    const m0 = staticMean("off", list);
    for (const v of named) {
      const P = variantParams(v), k0 = v === "on_rel" ? (P.durability.kdCalRel != null ? P.durability.kdCalRel : 1) : (P.durability.kdCal != null ? P.durability.kdCal : (E.params().durability.kdCal || 1));
      KDCAL[v] = k0 * m0 / staticMean(v, list);
      console.error(`level match ${v}: kdCal ${KDCAL[v].toFixed(4)}`);
    }
  }
}

const STATS = ["sig_lnd", "sig_att", "h_lnd", "b_lnd", "l_lnd", "sh_lnd", "kd", "td_lnd", "td_att", "ctrl", "sub_att", "hurt"];
let fights = bt.fights.filter((f) => f.date >= FROM && f.date <= TO && f.date < "2026-01-01");
fights = fights.filter((f, i) => i % STRIDE === 0);
if (LIMIT) fights = fights.slice(0, LIMIT);
fights = fights.filter((f, i) => i % PARTS === PART);
const res = {};
const t0 = Date.now();
let k = 0, skipped = 0;
for (const f of fights) {
  const d = durRec(f), o8 = oof ? oof.fights[f.id] : null;
  if (!d || (oof && !o8)) { skipped++; continue; }
  const sides = { A: Object.assign({ keys }, f.A), B: Object.assign({ keys }, f.B) };
  const out = { date: f.date, event: f.event, rounds: f.rounds, title: !!f.title, division: f.division, fit_through: d.fit_through, o: {} };
  for (const ori of ["AB", "BA"]) {
    const x = ori === "AB" ? "A" : "B", y = ori === "AB" ? "B" : "A";
    const base = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: pri[f.date.slice(0, 4)] };
    base.ml = o8 ? { A: obj(o8[x]), B: obj(o8[y]) } : false;
    base.dur = { A: d[x], B: d[y], base: d.base };
    const seed0 = seedOf(f.id + ":" + ori);
    out.o[ori] = {};
    for (const v of VARIANTS) {
      const m = E.matchup(sides[x], sides[y], Object.assign({ params: variantParams(v) }, base));
      const acc = { n: SIMS, win: [0, 0, 0], bins: [0, 0, 0, 0, 0, 0, 0], finA: Array(f.rounds).fill(0), finB: Array(f.rounds).fill(0),
        min: 0, A: {}, B: {}, kdRounds: 0, kd: m.kd.slice() };
      for (const s of STATS) { acc.A[s] = 0; acc.B[s] = 0; }
      for (let s = 0; s < SIMS; s++) {
        const rng = E.makeRng((seed0 ^ Math.imul(s + 1, 0x9e3779b1)) >>> 0);
        const r = E.simulate(m, rng, false);
        const b = E.bucket(r);
        acc.bins[b]++;
        acc.win[r.winner === "A" ? 0 : (r.winner === "B" ? 1 : 2)]++;
        if (!E.isDecision(r)) { if (r.winner === "A") acc.finA[r.round - 1]++; else if (r.winner === "B") acc.finB[r.round - 1]++; }
        acc.min += E.isDecision(r) ? f.rounds * 5 : ((r.round - 1) * 300 + r.t) / 60;
        for (const st of STATS) { acc.A[st] += r.totals.A[st]; acc.B[st] += r.totals.B[st]; }
      }
      out.o[ori][v] = acc;
    }
  }
  res[f.id] = out;
  if (++k % 50 === 0) console.error(`part ${PART}/${PARTS}: ${k}/${fights.length} (${((Date.now() - t0) / k).toFixed(0)} ms/fight)`);
}
fs.mkdirSync(OUT, { recursive: true });
const meta = { tool: "tools/durability_ablation.js", engine: E.VERSION, sims_per_orientation: SIMS, variants: VARIANTS, sets: sets,
  from: FROM, to: TO, ml: !!oof, part: PART, parts: PARTS, n: k, skipped: skipped, built: new Date().toISOString(),
  kdcal_matched: KDCAL, variant_params: Object.fromEntries(VARIANTS.map((v) => [v, variantParams(v)])) };
fs.writeFileSync(path.join(OUT, `part${PART}of${PARTS}.json`), JSON.stringify({ meta, fights: res }));
console.error(`done ${k} fights (${skipped} skipped) in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
