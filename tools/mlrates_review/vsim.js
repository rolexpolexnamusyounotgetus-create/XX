#!/usr/bin/env node
/* Independent re-run of the mlrates simulator check (reviewer code, not the analyst's harness).
   Data path: data/derived/backtest_dev.json sides (with pace, as calibrate.js feeds the engine), priors from
   data/derived/mlcal_priors_asof.json, rates from (a) mlrates_oof.json [default] or (b) MLRates.predict(dev model)
   on the backtest side (optionally with layoff injected). Each fight is simulated in BOTH corner orientations,
   plain vs ML with paired seeds, seeds disjoint from the analyst's (1000+/5000+).
   node vsim.js <out.json> <N> <worker k> <of K> <yearFrom> <yearTo> <rates: oof|dev|devlay> [layoff.json] */
"use strict";
const fs = require("fs"), path = require("path");
const ROOT = "/home/user/XX";
const FE = require(path.join(ROOT, "src", "engine3.js"));
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));
const [outp, Ns, ks, Ks, y0, y1, mode, layp] = process.argv.slice(2);
const N = +Ns, K = +Ks, kw = +ks;
const BT = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/backtest_dev.json"), "utf8"));
const PA = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlcal_priors_asof.json"), "utf8"));
const OOF = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlrates_oof.json"), "utf8"));
const DEV = ML.load(JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlrates_dev.json"), "utf8")));
const LAY = layp ? JSON.parse(fs.readFileSync(layp, "utf8")) : null;
const names = OOF.meta.targets;
const fights = BT.fights.filter((f) => f.date < "2026-01-01" && +f.date.slice(0, 4) >= +y0 && +f.date.slice(0, 4) <= +y1);
const rows = [];
let t0 = Date.now();
function rates(a) { const o = {}; names.forEach((n, i) => { o[n] = a[i]; }); return o; }
fights.forEach(function (f, idx) {
  if (idx % K !== kw) return;
  if (f.date >= "2026-01-01") throw new Error("2026 fight touched");
  const yr = f.date.slice(0, 4), priors = PA[yr];
  const pdiv = f.prior_division || f.division;
  const P = ML.priorFor(pdiv, priors);
  const base = names.map((t) => { const v = P[ML.BASE_KEY[t]]; return v == null ? 0 : +v; });
  const A = Object.assign({ name: "A" }, f.A), B = Object.assign({ name: "B" }, f.B);
  if (LAY && LAY[f.id]) { A.layoff = LAY[f.id][0]; B.layoff = LAY[f.id][1]; }
  let pred = null;
  if (mode === "oof") {
    const e = OOF.fights[f.id];
    if (!e || !e.A || !e.B) return;
    pred = { A: rates(e.A), B: rates(e.B), base: base, src: e.src };
  } else {
    pred = ML.predict(DEV, A, B, { division: f.division, prior_division: pdiv, rounds: f.rounds, title: f.title, year: +yr, priors: priors });
  }
  const opts = { division: pdiv, rounds: f.rounds, title: f.title, date: f.date, priors: priors };
  const out = { id: f.id, date: f.date, winner: f.result.winner, method: f.result.method, src: pred.src || mode };
  for (const orient of ["AB", "BA"]) {
    const X = orient === "AB" ? A : B, Y = orient === "AB" ? B : A;
    const pr = orient === "AB" ? pred : { A: pred.B, B: pred.A, base: base };
    const seed = (orient === "AB" ? 7100000 : 8300000) + idx;
    const m0 = FE.matchup(X, Y, opts);
    const s0 = FE.summarize(m0, N, seed);
    const m1 = FE.matchup(X, Y, opts);
    ML.applyToMatchup(m1, pr, { engine: FE });
    const s1 = FE.summarize(m1, N, seed);
    out[orient] = { plain: { pA: s0.pA, pB: s0.pB, pD: s0.pD, bins: s0.bins }, ml: { pA: s1.pA, pB: s1.pB, pD: s1.pD, bins: s1.bins } };
  }
  if (mode !== "oof") out.predA = pred.A, out.predB = pred.B;
  rows.push(out);
  if (rows.length % 100 === 0) console.error("w" + kw + " " + rows.length + " " + ((Date.now() - t0) / 1000).toFixed(0) + "s");
});
fs.writeFileSync(outp, JSON.stringify({ N: N, mode: mode, rows: rows }));
console.error("w" + kw + " done " + rows.length + " in " + ((Date.now() - t0) / 1000).toFixed(0) + "s");
