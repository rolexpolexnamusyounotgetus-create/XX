#!/usr/bin/env node
/* Helper for tools/mlrates.py: engine v3 static expectations for every dataset row, and (sim mode) Monte Carlo
   outcome probabilities with plain engine rates vs ML rates.

   node tools/mlrates_engine.js expect <in.json> <out.json>
     in:  { priors: {year: {division: priorsObj}}, fights: [{year, division, prior_division, rounds, title, date,
            A: {S, age, ko_losses, home, pace, pace_w}, B: {...}}] }
     out: { params_version, rows: [[expA, expB] | null] }   (expX = MLRates.engineExpect side without internals)

   node tools/mlrates_engine.js sim <in.json> <out.json> [N] [seed]
     in additionally carries model (mlrates JSON) and per fight `ml: [ratesA, ratesB]` (or computes them)
     out: { rows: [{plain: {pA, pB, pD, bins}, ml: {...}}] } */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const FE = require(path.join(ROOT, "src", "engine3.js"));
const FP = require(path.join(ROOT, "src", "params3.js"));
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));

const mode = process.argv[2], inp = process.argv[3], outp = process.argv[4];
const D = JSON.parse(fs.readFileSync(inp, "utf8"));

function prof(sd, name) {
  return { name: name, S: sd.S, age: sd.age, ko_losses: sd.ko_losses || 0, division: sd.home || null, home: sd.home || null,
    pace: sd.pace || null, pace_w: sd.pace_w || null, n: sd.n, elo: sd.elo, height_in: sd.height_in, reach_in: sd.reach_in,
    stance: sd.stance, layoff: sd.layoff };
}
function strip(e) { const o = {}; for (const k of ML.TNAMES) o[k] = e[k]; return o; }

if (mode === "expect") {
  const rows = [];
  let t0 = Date.now(), bad = 0;
  for (const f of D.fights) {
    try {
      const m = FE.matchup(prof(f.A, "A"), prof(f.B, "B"), { division: f.prior_division, rounds: f.rounds, title: f.title,
        date: f.date, priors: D.priors[String(f.year)] });
      const e = ML.engineExpect(m);
      rows.push([strip(e.A), strip(e.B)]);
    } catch (err) { rows.push(null); bad++; if (bad < 5) console.error(err.message); }
  }
  fs.writeFileSync(outp, JSON.stringify({ params_version: FP.version, engine_version: FE.VERSION, rows: rows }));
  console.log("engine expectations: " + rows.length + " fights, " + bad + " failed, " + ((Date.now() - t0) / 1000).toFixed(1) + " s, params " + FP.version);
} else if (mode === "sim") {
  const N = +(process.argv[5] || 1000), seed0 = +(process.argv[6] || 12345);
  const model = D.model ? ML.load(D.model) : null;
  const rows = [];
  let t0 = Date.now();
  D.fights.forEach(function (f, idx) {
    const pA = prof(f.A, "A"), pB = prof(f.B, "B");
    const opts = { division: f.prior_division, rounds: f.rounds, title: f.title, date: f.date, priors: D.priors[String(f.year)] };
    const out = {};
    const m0 = FE.matchup(pA, pB, opts);
    const s0 = FE.summarize(m0, N, seed0 + idx);
    out.plain = { pA: s0.pA, pB: s0.pB, pD: s0.pD, bins: s0.bins, finA: s0.finA, finB: s0.finB, avgA: pick(s0.avg.A), avgB: pick(s0.avg.B), avgMin: s0.avgMin };
    if (model) {
      const ctx = { division: f.division, prior_division: f.prior_division, rounds: f.rounds, title: f.title, year: f.year, priors: D.priors[String(f.year)] };
      const pred = ML.predict(model, pA, pB, ctx);
      const m1 = FE.matchup(pA, pB, opts);
      const info = ML.applyToMatchup(m1, pred, { engine: FE, scales: D.scales || null });
      const s1 = FE.summarize(m1, N, seed0 + idx);
      out.ml = { pA: s1.pA, pB: s1.pB, pD: s1.pD, bins: s1.bins, finA: s1.finA, finB: s1.finB, avgA: pick(s1.avg.A), avgB: pick(s1.avg.B), avgMin: s1.avgMin, ratios: info.ratios };
    }
    rows.push(out);
    if (idx % 100 === 0) console.error("sim " + idx + "/" + D.fights.length + " " + ((Date.now() - t0) / 1000).toFixed(0) + " s");
  });
  fs.writeFileSync(outp, JSON.stringify({ params_version: FP.version, rows: rows }));
  console.log("sim: " + rows.length + " fights x " + N + " in " + ((Date.now() - t0) / 1000).toFixed(1) + " s");
}

function pick(a) {
  const o = {};
  for (const k of ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"]) o[k] = a[k];
  return o;
}
