#!/usr/bin/env node
/* durlevel_fit.js (engine v5.0.1; v5 review "computed durability path runs at a lower knockdown level"): fits the constants that
   re-level the engine's computed chin / power fallback (engine3.js durSide, params.durability.fallbackEB) to the record path the
   knockdown levels were matched on.

     node tools/durlevel_fit.js [--engine-dir versions/v5.0.1] [--write]      (prints the constants; --write stores data/derived/durlevel_fit.json)

   The fallback is chin_re = (alphaChin + KD absorbed) / (alphaChin + lvlDiv x chin_cov x 0.9 x head absorbed) and the same for
   power, with opponent effects taken as 1. Its bias depends on which sums the profile carries:
   - S path (decayed sums, half-life 730 days: backtest snapshots). Fit on the 2019-2023 backtest sides (TRAIN only) against
     their strict walk-forward records (durability.json backtest[id]), with lvlDiv = the record's own walk-forward base / context
     (the era's level, as a backtest would use it): normComputedChinS / normComputedPowS = geometric mean of record / computed.
   - C path (career sums: production profiles in fighters.json, the page and newcomers). Its bias comes from applying today's
     covariates (age) to a whole career's exposure. Fit on the live roster (durability.json roster vs the same fighters' fallback
     with the live level and terms): normComputedChin / normComputedPow. This is a production constant like normChin / normPow
     (the live fit through the durability snapshot); backtests never use it (tools/evalv.js, predict_eval.js and durrec.js refuse a
     matchup whose chin / power fields were not all taken from the walk-forward record).
   Reports the geometric means of chin x pow for both paths before and after, which tests/test_durlevel.js checks within 2%. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));

function fit(E) {
  const P = E.params(), dp = P.durability, T = dp.terms || {};
  const aC = dp.alphaChin || 3, aP = dp.alphaPow || 2.5, sh = dp.standShare != null ? dp.standShare : 0.9;
  const comp = (C, chinCov, powCov, lvlDiv) => ({
    chin: (aC + (+C.okd || 0)) / (aC + lvlDiv * chinCov * sh * (+C.oh_lnd || 0)),
    pow: (aP + (+C.kd || 0)) / (aP + lvlDiv * powCov * sh * (+C.h_lnd || 0)) });
  const mean = (a) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  // ---- S path: 2019-2023 backtest sides (train only; 2024+ fights are never read)
  const bt = J("data/derived/backtest_dev.json"), keys = bt.meta.keys, DUR = J("data/derived/durability.json");
  const sC = [], sP = [], sRec = [];
  for (const f of bt.fights) {
    if (!(f.date >= "2019-01-01" && f.date < "2024-01-01")) continue;
    const d = DUR.backtest[f.id]; if (!d) continue;
    const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
    const lvlDiv = Math.sqrt(bA * bB) / Math.exp((f.rounds === 5 ? (T.five || 0) : 0) + (f.title ? (T.title || 0) : 0));
    for (const s of ["A", "B"]) {
      const r = d[s], C = {}; for (let i = 0; i < keys.length; i++) C[keys[i]] = +f[s].S[i] || 0;
      const c = comp(C, r.chin_cov, r.pow_cov, lvlDiv);
      sC.push(Math.log(r.chin_re / c.chin)); sP.push(Math.log(r.pow_re / c.pow)); sRec.push(Math.log(r.chin_re * r.pow_re));
    }
  }
  // ---- C path: live roster (production)
  const db = J("data/derived/fighters.json"), R = DUR.roster, dkeys = db.meta.keys;
  const cC = [], cP = [], cRec = [];
  for (const s of Object.keys(R)) {
    const p = db.fighters[s]; if (!p || !p.C || (p.n_fights || 0) < 2) continue;
    const C = {}, ks = p.keys || dkeys; for (let i = 0; i < ks.length; i++) C[ks[i]] = +p.C[i] || 0;
    const lvlDiv = dp.level * Math.exp((T.const || 0) + (T["div_" + p.division] || 0)), r = R[s];
    const c = comp(C, r.chin_cov, r.pow_cov, lvlDiv);
    cC.push(Math.log(r.chin_re / c.chin)); cP.push(Math.log(r.pow_re / c.pow)); cRec.push(Math.log(r.chin_re * r.pow_re));
  }
  const r4 = (x) => Math.round(x * 1e4) / 1e4;
  return {
    S: { n_sides: sC.length, normComputedChinS: r4(Math.exp(mean(sC))), normComputedPowS: r4(Math.exp(mean(sP))),
      geo_record_chin_x_pow: r4(Math.exp(mean(sRec))), geo_computed_chin_x_pow_raw: r4(Math.exp(mean(sRec) - mean(sC) - mean(sP))) },
    C: { n_fighters: cC.length, normComputedChin: r4(Math.exp(mean(cC))), normComputedPow: r4(Math.exp(mean(cP))),
      geo_record_chin_x_pow: r4(Math.exp(mean(cRec))), geo_computed_chin_x_pow_raw: r4(Math.exp(mean(cRec) - mean(cC) - mean(cP))) } };
}
module.exports = { fit };
if (require.main === module) {
  // the engine must carry the durability component (5.0.1+): --engine-dir versions/v5.0.1 while src/ holds v4
  const ai = process.argv.indexOf("--engine-dir"), ED = ai > 0 ? path.resolve(ROOT, process.argv[ai + 1]) : path.join(ROOT, "src");
  const E = require(path.join(ED, "engine3.js"));
  const out = fit(E);
  out.meta = { tool: "tools/durlevel_fit.js", built: new Date().toISOString(), engine: E.VERSION, params: E.params().version,
    note: "S path fit on 2019-2023 backtest sides (train only); C path on the live roster (production constant, never used in backtests)" };
  console.log(JSON.stringify(out, null, 1));
  if (process.argv.includes("--write")) { fs.writeFileSync(path.join(ROOT, "data/derived/durlevel_fit.json"), JSON.stringify(out, null, 1) + "\n"); console.log("wrote data/derived/durlevel_fit.json"); }
}
