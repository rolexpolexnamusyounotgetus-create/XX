#!/usr/bin/env node
/* Rate-level offsets for the styles_sos fits (tools/sos_wf.py fit): for every 2019-2023 fight of
   data/derived/backtest_dev.json, each side's predicted per-minute rates and probabilities from
     ml   the learned stat-line model's out-of-fold rates (data/derived/mlrates_oof.json, time-ordered CV folds), and
     base engine v4's own static expectation with the learned rates off (opts.ml = false; MLRates.engineExpect),
   with priors_asof of the fight year. Only 2019-2023 fights are read (hidden-data protocol).

     node tools/styles_sos_offsets.js <priors_asof.json> <out.json>

   priors_asof.json: { "2019": {division: priors}, ... "2023": ... } (backtest.json priors_asof, years <= 2023). */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src", "engine3.js"));
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));

function devPath(name) {
  const p = path.join(ROOT, "data", "derived", name);
  return fs.existsSync(p) ? p : path.join("/home/user/XX/data/derived", name);
}
const PA = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const BT = JSON.parse(fs.readFileSync(devPath("backtest_dev.json"), "utf8"));
const OOF = JSON.parse(fs.readFileSync(devPath("mlrates_oof.json"), "utf8"));
const keys = BT.meta.keys, names = OOF.meta.targets;
const pick = ["d_att", "g_att", "td_att", "acc_d", "td_acc", "kd_h", "ctrl"];
const out = {};
let n = 0;
for (const f of BT.fights) {
  if (!(f.date >= "2019-01-01" && f.date < "2024-01-01")) continue;
  const A = Object.assign({ keys }, f.A), B = Object.assign({ keys }, f.B);
  const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date,
    priors: PA[f.date.slice(0, 4)], ml: false, params: { components: { styles_sos: false } } };   // the plain engine (no component)
  const m = E.matchup(A, B, o);
  const ex = ML.engineExpect(m);
  const rec = { base: { A: {}, B: {} } };
  for (const k of pick) { rec.base.A[k] = ex.A[k]; rec.base.B[k] = ex.B[k]; }
  const r = OOF.fights[f.id];
  if (r) {
    rec.ml = { A: {}, B: {} };
    names.forEach((t, i) => { if (pick.indexOf(t) >= 0) { rec.ml.A[t] = r.A[i]; rec.ml.B[t] = r.B[i]; } });
  }
  out[f.id] = rec; n++;
}
fs.writeFileSync(process.argv[3], JSON.stringify(out));
console.log("offsets for " + n + " fights (2019-2023)");
