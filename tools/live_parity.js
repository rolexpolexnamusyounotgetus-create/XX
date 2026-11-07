#!/usr/bin/env node
/* live_parity.js: live-vs-backtest knockdown parity for an engine that carries the durability component (v6 review, issue
   "live KD / KO levels are well above the evaluated path"). A version may serve live (page / forward ledger) only if its live
   knockdown path matches the path its validation scored, on the same train pairs.

     node tools/live_parity.js --engine-dir versions/v6-rejected [--sims 200 --fights 120] [--out data/derived/v6/review/live_parity_v6.json]

   Arms (train fights 2019-01-01..2023-12-31 only; the same fighter records in both, so the comparison isolates the league
   level, the fit terms and the norms):
     backtest  opts.dur = the walk-forward record of data/derived/durability.json backtest[id] WITH its base (L730 at the fight
               date x context) and the 2019-2023 backtest norms: exactly what tools/evalv.js and tools/predict_harness.js pass;
     live      the same chin / power records WITHOUT the base, and the engine's params as shipped: base = params.durability.level
               x exp(terms const + division + five + title) and the params norms (what a page / ledger call gets).
   1. analytic: the knockdown base per landed standing head strike, live / backtest, per fight (relK is identical across arms,
      so this is the knockdown-hazard ratio); 2. simulated (--sims > 0): KD per 100 landed head strikes and the finish rate.
   PASS iff the geometric-mean base ratio and the simulated KD per 100 head ratio are within [0.90, 1.10] and the finish
   rates within 10% of each other (the review's tolerance). Engines without durability (v4) pass trivially. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const DIR = path.resolve(ROOT, opt("--engine-dir", "src"));
const SIMS = +opt("--sims", 200), NF = +opt("--fights", 120), OUT = opt("--out", null);
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const E = require(path.join(DIR, "engine3.js"));
const P = E.params(), dp = P.durability, on = !!(P.components && P.components.durability) && dp && dp.level != null;
const res = { meta: { tool: "tools/live_parity.js", built: new Date().toISOString(), engine_dir: path.relative(ROOT, DIR), engine: E.VERSION, params: P.version,
  tolerance: "ratios within [0.90, 1.10]" } };
if (!on) {
  res.pass = true; res.note = "no durability component in absolute mode: live and backtest knockdown paths are the same";
  console.log(res.note);
} else {
  const T = dp.terms || {}, tm = (k) => (T[k] != null ? +T[k] : 0);
  const DUR = rd("data/derived/durability.json"), bt = rd("data/derived/backtest_dev.json"), keys = bt.meta.keys;
  const fights = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01" && DUR.backtest[f.id]);
  const side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
  function rec(f) {
    const d = DUR.backtest[f.id];
    const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
    return { A: side(d.A), B: side(d.B), base: Math.sqrt(bA * bB) };
  }
  const liveBase = (f) => dp.level * Math.exp(tm("const") + tm("div_" + (f.prior_division || f.division)) + tm("five") * (f.rounds >= 5 ? 1 : 0) + tm("title") * (f.title ? 1 : 0));
  const ratios = fights.map((f) => liveBase(f) / rec(f).base), byYear = {};
  fights.forEach((f, i) => { const y = f.date.slice(0, 4); (byYear[y] = byYear[y] || []).push(ratios[i]); });
  const gm = (a) => Math.exp(a.reduce((s, x) => s + Math.log(x), 0) / a.length);
  res.analytic = { fights: fights.length, base_ratio_geomean: +gm(ratios).toFixed(4), by_year: Object.fromEntries(Object.entries(byYear).map(([y, a]) => [y, +gm(a).toFixed(4)])),
    live: { level: dp.level, terms_const: T.const, normChin: dp.normChin, normPow: dp.normPow },
    backtest: { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 } };
  console.log("analytic knockdown base live / backtest on", fights.length, "train fights: geomean", res.analytic.base_ratio_geomean, JSON.stringify(res.analytic.by_year));
  if (SIMS > 0) {
    const priors = rd("data/derived/mlcal_priors_asof.json");
    const OOF = rd(+String(E.VERSION).split(".")[0] >= 6 ? "data/derived/mlrates_oof_fh.json" : "data/derived/mlrates_oof.json");
    const rates = (arr) => { const o = {}; OOF.meta.targets.forEach((n, i) => { o[n] = arr[i]; }); return o; };
    const XR = require(fs.existsSync(path.join(DIR, "mlpathrec.js")) ? path.join(DIR, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
    const SOSJ = rd("data/derived/sos_wf.json");
    const pick = []; for (let i = 0; i < Math.min(NF, fights.length); i++) pick.push(fights[Math.floor((i + 0.5) * fights.length / Math.min(NF, fights.length))]);
    const acc = { backtest: { kd: 0, hl: 0, fin: 0, n: 0 }, live: { kd: 0, hl: 0, fin: 0, n: 0 } };
    for (const f of pick) {
      f.A.keys = keys; f.B.keys = keys;
      const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
      const ent = OOF.fights[f.id];
      o.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
      const s = SOSJ.fights[f.id], y = f.date.slice(0, 4), M = SOSJ.meta;
      const sosP = s ? { stylesSOS: { sosCoef: { ml: M.coef_loyo.ml[y], base: M.coef_loyo.base[y] } } } : {};
      if (s) o.sos = { A: s.A, B: s.B };
      const r = rec(f);
      const arms = {
        backtest: Object.assign({}, o, { dur: r, params: Object.assign({ durability: { normChin: DUR.engine.norm_chin_backtest_2019_2023, normPow: DUR.engine.norm_pow_backtest_2019_2023 } }, sosP) }),
        live: Object.assign({}, o, { dur: { A: r.A, B: r.B }, params: Object.assign({}, sosP) })
      };
      for (const k of Object.keys(arms)) {
        const oo = arms[k];
        XR.apply(oo, f, false, oo.params);
        const sm = E.summarize(E.matchup(f.A, f.B, oo), SIMS, 7);
        acc[k].kd += sm.avg.A.kd + sm.avg.B.kd; acc[k].hl += sm.avg.A.h_lnd + sm.avg.B.h_lnd; acc[k].fin += sm.fins; acc[k].n++;
      }
    }
    const kd100 = (a) => 100 * a.kd / Math.max(1e-9, a.hl), fin = (a) => a.fin / a.n;
    res.simulated = { fights: pick.length, sims: SIMS, kdPer100Head: { backtest: +kd100(acc.backtest).toFixed(4), live: +kd100(acc.live).toFixed(4) },
      finish: { backtest: +fin(acc.backtest).toFixed(4), live: +fin(acc.live).toFixed(4) } };
    res.simulated.kd_ratio = +(res.simulated.kdPer100Head.live / res.simulated.kdPer100Head.backtest).toFixed(4);
    res.simulated.finish_ratio = +(res.simulated.finish.live / res.simulated.finish.backtest).toFixed(4);
    console.log("simulated on", pick.length, "train fights x", SIMS, "sims: KD/100 head backtest", res.simulated.kdPer100Head.backtest, "live", res.simulated.kdPer100Head.live,
      "ratio", res.simulated.kd_ratio, "| finish", res.simulated.finish.backtest, "vs", res.simulated.finish.live, "ratio", res.simulated.finish_ratio);
  }
  const inT = (x) => x == null || (x >= 0.9 && x <= 1.1);
  res.pass = inT(res.analytic.base_ratio_geomean) && (!res.simulated || (inT(res.simulated.kd_ratio) && inT(res.simulated.finish_ratio)));
}
console.log("LIVE PARITY:", res.pass ? "PASS" : "FAIL");
if (OUT) { fs.mkdirSync(path.dirname(path.join(ROOT, OUT)), { recursive: true }); fs.writeFileSync(path.join(ROOT, OUT), JSON.stringify(res, null, 1)); }
process.exit(res.pass ? 0 : 1);
