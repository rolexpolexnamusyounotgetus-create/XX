#!/usr/bin/env node
/* Checks src/ml/mlrates.js against the Python reference (tools/mlrates.py):
   1. features: JS features from raw side profiles + priors equal the Python features (fixtures);
   2. model: JS linear predictors (GLM + LightGBM trees + MLP, stacked) equal the Python evaluation of the same JSON;
   3. symmetry: predict(A, B) and predict(B, A) swap exactly;
   4. adapter: with FightEngine, applyToMatchup moves the engine's static expectation onto the targets (engine
      league-average expectation x ML / league rate)
      (position attempts, target attempts, accuracies, KD, takedowns, control, submissions) and the matchup still
      simulates; corner swap still swaps the outcome.
   node tests/test_mlrates.js            (about 10 seconds) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log("FAIL " + msg); } }

const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "mlrates_fixtures.json"), "utf8"));
const model = ML.load(JSON.parse(fs.readFileSync(path.join(ROOT, FX.model), "utf8")));

// ---- 1-2: features and linear predictors
let maxF = 0, maxE = 0, maxR = 0;
for (const fx of FX.fixtures) {
  const f = fx.fight;
  const ctx = { division: f.division, prior_division: f.prior_division, rounds: f.rounds, title: f.title, year: f.year,
    priors: FX.priors[String(f.year)] };
  const pr = ML.predict(model, f.A, f.B, ctx);
  for (let k = 0; k < fx.featA.length; k++) {
    maxF = Math.max(maxF, Math.abs(pr.featA[k] - fx.featA[k]), Math.abs(pr.featB[k] - fx.featB[k]));
  }
  for (let t = 0; t < fx.etaA.length; t++) {
    maxE = Math.max(maxE, Math.abs(pr.etaA[t] - fx.etaA[t]), Math.abs(pr.etaB[t] - fx.etaB[t]));
  }
  // 3: symmetry
  const ctx2 = Object.assign({}, ctx);
  const sw = ML.predict(model, f.B, f.A, ctx2);
  for (let t = 0; t < pr.etaA.length; t++) maxR = Math.max(maxR, Math.abs(sw.etaA[t] - pr.etaB[t]), Math.abs(sw.etaB[t] - pr.etaA[t]));
}
console.log("fixtures: " + FX.fixtures.length + " fights; max |feature diff| " + maxF.toExponential(2) +
  ", max |eta diff| " + maxE.toExponential(2) + ", max swap asymmetry " + maxR.toExponential(2));
ok(maxF < 1e-9, "features reproduce Python (max diff " + maxF + ")");
ok(maxE < 1e-6, "linear predictors reproduce Python (max diff " + maxE + ")");
ok(maxR === 0, "corner swap swaps predictions exactly");
// reviewer: the parity check must cover a weight-class move beyond 3 x 10 lb (a +-3 clip once diverged from the
// trained feature) and the median-layoff imputation for experienced sides without a layoff (backtest_dev sides)
const iUp = model.fnames.indexOf("upX"), iUpY = model.fnames.indexOf("upY");
ok(FX.fixtures.some((fx) => Math.abs(fx.featA[iUp]) > 3 || Math.abs(fx.featA[iUpY]) > 3), "fixtures include a weight-class move > 30 lb");
ok(FX.fixtures.some((fx) => /-nolayoff$/.test(fx.id) && fx.fight.A.layoff == null && fx.fight.A.n > 0), "fixtures include experienced sides with no layoff");

// ---- 4: adapter with the engine
let FE = null;
try { FE = require(path.join(ROOT, "src", "engine3.js")); } catch (e) { FE = null; }
if (!FE) {
  console.log("engine3.js not importable: adapter checks skipped");
} else {
  let worst = 0, n = 0;
  const names = ["d_att", "c_att", "g_att", "td_att", "ctrl", "sub_att", "acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "kd_h", "td_acc"];
  const errs = {};
  for (const fx of FX.fixtures.slice(0, 25)) {
    const f = fx.fight;
    const priors = FX.priors[String(f.year)];
    const ctx = { division: f.division, prior_division: f.prior_division, rounds: f.rounds, title: f.title, year: f.year, priors: priors };
    const pr = ML.predict(model, f.A, f.B, ctx);
    const pa = Object.assign({ name: "A", division: f.A.home }, f.A), pb = Object.assign({ name: "B", division: f.B.home }, f.B);
    const m = FE.matchup(pa, pb, { division: f.prior_division, rounds: f.rounds, title: f.title, date: f.date, priors: priors });
    const info = ML.applyToMatchup(m, pr, { engine: FE });
    const after = ML.engineExpect(m);
    for (const [side, tag, ti] of [[after.A, "A", 0], [after.B, "B", 1]]) {
      const tgt = info.targets[ti];
      for (const k of names) {
        const want = tgt[k], got = side[k];
        const rel = Math.abs(Math.log(Math.max(got, 1e-9) / Math.max(want, 1e-9)));
        errs[k] = Math.max(errs[k] || 0, rel);
      }
      // target attempts: shares
      const tw = tgt.h_att + tgt.b_att + tgt.l_att, tg = side.h_att + side.b_att + side.l_att;
      errs.h_share = Math.max(errs.h_share || 0, Math.abs(side.h_att / tg - tgt.h_att / tw));
      // re-levelling: target / engine league-average expectation equals ML / league rate
      const eL = info.league;
      if (eL) for (const k of ["d_att", "ctrl", "kd_h", "td_att"]) {
        const t = ML.TNAMES.indexOf(k);
        const rel = Math.abs(Math.log((tgt[k] / eL[k]) / (pr[tag][k] / pr.base[t])));
        errs.relevel = Math.max(errs.relevel || 0, rel);
      }
    }
    n++;
    const s = FE.summarize(m, 200, 99);
    ok(s.pA + s.pB + s.pD > 0.999 && isFinite(s.avg.A.sig_lnd), "ML-adapted matchup simulates");
  }
  console.log("adapter: max |log(engine expectation after / ML target)| over " + n + " fights:");
  console.log("  " + Object.keys(errs).map(k => k + " " + errs[k].toFixed(4)).join(", "));
  // control and grappling are fit through the position occupancy (approximate); strikes/acc/kd are exact
  for (const k of ["d_att", "c_att", "g_att", "acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "kd_h", "td_acc", "sub_att"]) {
    ok(errs[k] < 0.02, "adapter hits " + k + " (max log error " + errs[k].toFixed(4) + ")");
  }
  for (const k of ["td_att", "ctrl"]) ok(errs[k] < 0.15, "adapter approaches " + k + " (max log error " + errs[k].toFixed(4) + ")");
  ok(errs.h_share < 0.03, "adapter matches the head-strike share (max abs error " + errs.h_share.toFixed(4) + ")");
  ok(errs.relevel < 1e-9, "targets keep the engine's league level x the ML matchup multiplier");

  // corner swap symmetry of the adapted simulation (Monte Carlo)
  const fx = FX.fixtures[3], f = fx.fight, priors = FX.priors[String(f.year)];
  const ctx = { division: f.division, prior_division: f.prior_division, rounds: f.rounds, title: f.title, year: f.year, priors: priors };
  const o = { division: f.prior_division, rounds: f.rounds, title: f.title, date: f.date, priors: priors };
  const pa = Object.assign({ name: "A", division: f.A.home }, f.A), pb = Object.assign({ name: "B", division: f.B.home }, f.B);
  const m1 = FE.matchup(pa, pb, o); ML.applyToMatchup(m1, ML.predict(model, f.A, f.B, ctx), { engine: FE });
  const m2 = FE.matchup(pb, pa, o); ML.applyToMatchup(m2, ML.predict(model, f.B, f.A, ctx), { engine: FE });
  const s1 = FE.summarize(m1, 4000, 1), s2 = FE.summarize(m2, 4000, 2);
  const se = Math.sqrt(0.25 / 4000) * 2;
  console.log("swap check: pA " + s1.pA.toFixed(3) + " vs swapped pB " + s2.pB.toFixed(3));
  ok(Math.abs(s1.pA - s2.pB) < 4 * se, "corner swap swaps the simulated win probability");
}

console.log((fails ? "FAILED " + fails : "OK") + " (" + checks + " checks)");
process.exit(fails ? 1 : 0);
