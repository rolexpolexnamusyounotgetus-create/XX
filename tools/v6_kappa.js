#!/usr/bin/env node
/* v6_kappa.js: the interval inflation (kappa) for the v6 head-stack construction (winner 'ml2stack'), fit on train only
   (v6 review, issue "the v6 P(win) interval is degenerate / uncalibrated": src/ml/blend.js 1.2.1 params.blend.boot.inflateMl2stack).

     node tools/v6_kappa.js [--out data/derived/v6/review/kappa_ml2stack.json] [--B 200]

   The ml2stack interval perturbs the ML v2 head by the feature LR's profile-noise logit shift (src/ml/blend.js predict section
   6: perturbS on each profile's decayed sums S, the feature LR moe_page.json `feat` re-evaluated per draw) and passes it through
   the regime's stack. Its raw bootstrap sd is not a calibrated interval; kappa scales the sd so that the 80% interval covers
   the closing line 80% of the time, as the v5 kappa (boot.inflate) was fit for the v5 expert-stack construction
   (tools/blend_anchor_eval.js). Here, per regime ('none' and 'open'; the close regime is centred on the close itself, so it
   has no outside benchmark and takes the open value, a labelled judgment):
     fights   decisive data/derived/backtest_dev.json fights 2021-01-01..2023-12-31 with both lines (train only; profiles as of
              each fight, as the backtest stores them)
     point    the v6 stack of the regime with weights fit on 2019..Y-1 (data/derived/v6_stacks.json by_fit_year, as the gate)
     sd       blend.js's interval() over B profile draws (seed 7), the exact production code path
     kappa80  = quantile(|logit(close) - logit(p)| / sd, 0.80) / 1.2816   (kappa95 with 0.95 / 1.96 is reported)
     OOF      leave-one-year-out over 2021 / 2022 / 2023: kappa from the other two years, coverage on the held-out one
   The feature LR uses moe_page.json coef_valid (fit before 2024): in-sample for these years, which affects the centre of the
   shift little and its spread (what kappa scales) less. Nothing from 2024 on is read. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const FB = require(path.join(ROOT, "src/ml/blend.js"));
const M = require(path.join(ROOT, "src/ml/moe.js"));
const E = require(path.join(ROOT, "src/engine3.js"));   // only for makeRng (identical in every engine version)
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const OUT = opt("--out", "data/derived/v6/review/kappa_ml2stack.json");
const B = +opt("--B", 200);
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const sigm = (z) => 1 / (1 + Math.exp(-z)), lg = (p) => { p = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return Math.log(p / (1 - p)); };
const qtl = (xs, q) => { const a = xs.slice().sort((x, y) => x - y), t = q * (a.length - 1), lo = Math.floor(t), hi = Math.ceil(t); return a[lo] + (a[hi] - a[lo]) * (t - lo); };

const bt = rd("data/derived/backtest_dev.json"), mk = rd("data/derived/market.json").fights, V6 = rd("data/derived/v6_stacks.json");
const feat = rd("data/derived/moe_page.json").feat, keys = bt.meta.keys;
const so = { keys, snapshot: null, halfLife: bt.meta.half_life_days || 730 };
const boot = Object.assign({}, FB.DEFAULTS.boot, { B, inflate: 0 });
const rows = [];
for (const f of bt.fights) {
  if (!(f.date >= "2021-01-01" && f.date < "2024-01-01")) continue;
  const w = (f.result || {}).winner;
  if (w !== "A" && w !== "B") continue;
  const m = mk[f.id] || {}, inp = V6.inputs[f.id];
  if (!inp || !(m.p_power_close > 0 && m.p_power_close < 1) || !(m.p_novig_open > 0 && m.p_novig_open < 1)) continue;
  if (!Array.isArray(f.A.S) || !Array.isArray(f.B.S)) continue;
  const yr = +f.date.slice(0, 4);
  const pa = Object.assign({}, f.A, { keys }), pb = Object.assign({}, f.B, { keys });
  const sa = M.sideFromProfile(pa, f.date, so), sb = M.sideFromProfile(pb, f.date, so), division = f.prior_division || f.division;
  const f0 = lg(M.featLR(feat, sa, sb, { division, homeA: sa.home, homeB: sb.home, coef: "coef_valid" }));
  const rng = E.makeRng(7), shifts = [];
  for (let i = 0; i < B; i++) {
    const qa = Object.assign({}, pa, { S: FB.perturbS(pa.S, keys, rng, boot) }), qb = Object.assign({}, pb, { S: FB.perturbS(pb.S, keys, rng, boot) });
    const xa = M.sideFromProfile(qa, f.date, so), xb = M.sideFromProfile(qb, f.date, so);
    shifts.push(lg(M.featLR(feat, xa, xb, { division, homeA: xa.home, homeB: xb.home, coef: "coef_valid" })) - f0);
  }
  const rec = { id: f.id, year: yr, close: m.p_power_close };
  for (const kind of ["none", "open"]) {
    const st = FB.v6Stack(V6, kind, "blend", yr);
    const base = { ml2: inp.ml2, mkt_rating: Number.isFinite(inp.mkt_rating) ? inp.mkt_rating : null, open: kind === "open" ? m.p_novig_open : null, market: null };
    const ex = { ml2: inp.ml2lr };
    const blendFn = (e) => { const d6 = lg(e.ml2) - lg(ex.ml2), q = Object.assign({}, base); q.ml2 = sigm(lg(base.ml2) + d6); return FB.v6StackP(st, q); };
    const iv = FB.interval(blendFn, ex, (i) => shifts[i], { rng: E.makeRng(11), sign: 1 }, boot);
    rec[kind] = { p: iv.p, sd: iv.sdLogit, t: Math.abs(lg(m.p_power_close) - lg(iv.p)) / Math.max(iv.sdLogit, 1e-9) };
  }
  rows.push(rec);
}
const YEARS = [2021, 2022, 2023], out = { meta: { tool: "tools/v6_kappa.js", built: new Date().toISOString(), fights: rows.length, B,
  what: "kappa for the ml2stack interval (src/ml/blend.js params.blend.boot.inflateMl2stack): the 80% interval covers the close 80% of the time on 2021-2023",
  feature_lr: "moe_page.json feat coef_valid", stacks: "v6_stacks.json <regime>|blend by_fit_year = fight year (fit 2019..Y-1)" }, regimes: {} };
for (const kind of ["none", "open"]) {
  const t = rows.map((r) => r[kind].t), sd = rows.map((r) => r[kind].sd);
  const k80 = qtl(t, 0.8) / 1.2815516, k95 = qtl(t, 0.95) / 1.959964;
  const raw80 = t.filter((x) => x <= 1.2815516).length / t.length, raw95 = t.filter((x) => x <= 1.959964).length / t.length;
  const oof = {};
  let c80 = 0, c95 = 0, n = 0;
  for (const Y of YEARS) {
    const tr = rows.filter((r) => r.year !== Y).map((r) => r[kind].t), te = rows.filter((r) => r.year === Y).map((r) => r[kind].t);
    const k = qtl(tr, 0.8) / 1.2815516;
    const a = te.filter((x) => x <= 1.2815516 * k).length, b = te.filter((x) => x <= 1.959964 * k).length;
    oof[Y] = { kappa: +k.toFixed(4), cover80: +(a / te.length).toFixed(4), cover95: +(b / te.length).toFixed(4), n: te.length };
    c80 += a; c95 += b; n += te.length;
  }
  out.regimes[kind] = { n: t.length, median_sd_logit: +qtl(sd, 0.5).toFixed(4), raw_cover80: +raw80.toFixed(4), raw_cover95: +raw95.toFixed(4),
    kappa80: +k80.toFixed(4), kappa95: +k95.toFixed(4), oof: { cover80: +(c80 / n).toFixed(4), cover95: +(c95 / n).toFixed(4), by_year: oof },
    median_width80_calibrated: +qtl(rows.map((r) => sigm(lg(r[kind].p) + 1.2815516 * k80 * r[kind].sd) - sigm(lg(r[kind].p) - 1.2815516 * k80 * r[kind].sd)), 0.5).toFixed(4) };
  console.log(kind, JSON.stringify(out.regimes[kind]));
}
out.inflateMl2stack = { none: out.regimes.none.kappa80, open: out.regimes.open.kappa80, close: out.regimes.open.kappa80,
  note: "close takes the open value (an interval centred on the close has no outside benchmark; labelled judgment)" };
fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true });
fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(out, null, 1));
console.log("inflateMl2stack", JSON.stringify(out.inflateMl2stack), "->", OUT);
