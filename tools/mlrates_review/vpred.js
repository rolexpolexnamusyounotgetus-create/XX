#!/usr/bin/env node
/* Reviewer: dev-model predictions (JS evaluator) on backtest_dev sides for 2019-2025 with and without the true
   layoff, plus engine v3 static expectations (FightEngine.matchup -> MLRates.engineExpect) for each side.
   node vpred.js <layoff.json> <out.json> */
"use strict";
const fs = require("fs"), ROOT = "/home/user/XX";
const FE = require(ROOT + "/src/engine3.js"), ML = require(ROOT + "/src/ml/mlrates.js");
const BT = JSON.parse(fs.readFileSync(ROOT + "/data/derived/backtest_dev.json", "utf8"));
const PA = JSON.parse(fs.readFileSync(ROOT + "/data/derived/mlcal_priors_asof.json", "utf8"));
const DEV = ML.load(JSON.parse(fs.readFileSync(ROOT + "/data/derived/mlrates_dev.json", "utf8")));
const LAY = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const out = [];
for (const f of BT.fights) {
  if (f.date >= "2026-01-01") throw new Error("2026");
  const yr = f.date.slice(0, 4), priors = PA[yr], pdiv = f.prior_division || f.division;
  const ctx = { division: f.division, prior_division: pdiv, rounds: f.rounds, title: f.title, year: +yr, priors: priors };
  const p0 = ML.predict(DEV, f.A, f.B, ctx);
  const A1 = Object.assign({}, f.A, { layoff: LAY[f.id][0] }), B1 = Object.assign({}, f.B, { layoff: LAY[f.id][1] });
  const p1 = ML.predict(DEV, A1, B1, ctx);
  const m = FE.matchup(Object.assign({ name: "A" }, f.A), Object.assign({ name: "B" }, f.B),
    { division: pdiv, rounds: f.rounds, title: f.title, date: f.date, priors: priors });
  const e = ML.engineExpect(m);
  const strip = (x) => { const o = {}; for (const k of ML.TNAMES) o[k] = x[k]; return o; };
  out.push({ id: f.id, date: f.date, base: p0.base, noLay: [p0.A, p0.B], lay: [p1.A, p1.B], eng: [strip(e.A), strip(e.B)] });
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log("rows", out.length);
