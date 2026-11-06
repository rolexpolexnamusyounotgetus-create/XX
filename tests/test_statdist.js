// Node test: src/ml/statdist.js reproduces tools/statlines.py on the exported tables (data/derived/statlines.json).
//   node tests/test_statdist.js
// Fixtures (tests/fixtures/statdist_fixtures.json, written by `python3 tools/statlines.py fixtures`) hold Python
// outputs of the exported-table evaluator (tools/statlines.py py_eval, itself checked against the fitted models to
// 1e-6 in the final stage) for real table rows at their actual length and two other lengths, and unconditional
// mixtures over the methodround S fight-length grid.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const SDmod = require(path.join(ROOT, "src", "ml", "statdist.js"));

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; console.log("FAIL " + msg); } }
function rel(a, b) { return Math.abs(a - b) / Math.max(1e-9, Math.abs(b)); }

const J = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "statlines.json"), "utf8"));
const FX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "statdist_fixtures.json"), "utf8"));
const SDs = { dev: SDmod.load(J, { which: "dev" }), prod: SDmod.load(J, { which: "prod" }) };

function prep(SD, inp) {
  // the fixture input is "attacker vs defender" for one table row; side A = attacker
  return SD.prepare({ mlA: inp.ml, mlB: inp.mlo, etaA: inp.eta, etaB: inp.etao, hasEmb: inp.has_emb,
    winLogit: inp.win_logit, oppA: inp.opp, oppB: inp.oppo, rounds: inp.rounds });
}

// ---- 1. parity with Python: parameters, mean, variance, log pmf at the actual value, CDF points
let maxP = 0, maxL = 0, maxC = 0, nCase = 0;
for (const c of FX.cases) {
  const P = prep(SDs[c.which], c.input);
  for (const st of Object.keys(c.out)) {
    const o = c.out[st], d = P.dist("A", st, c.t);
    ok(d.kind === o.kind, `kind ${st} ${d.kind} vs ${o.kind}`);
    for (const k of Object.keys(o.p)) maxP = Math.max(maxP, rel(d.p[k], o.p[k]));
    maxP = Math.max(maxP, rel(d.mean, o.mean), rel(d["var"], o["var"]));
    maxL = Math.max(maxL, Math.abs(d.logpmf(o.y) - o.logpmf_y));
    for (const g of Object.keys(o.cdf)) maxC = Math.max(maxC, Math.abs(d.cdf(+g) - o.cdf[g]));
  }
  nCase++;
}
ok(nCase >= 60, "fixture cases " + nCase);
ok(maxP < 1e-7, "parameters/mean/var max rel diff " + maxP);
ok(maxL < 1e-6, "log pmf max abs diff " + maxL);
ok(maxC < 1e-6, "cdf max abs diff " + maxC);

// ---- 2. unconditional mixtures over the S-cell fight-length grid
let maxM = 0, qOff = 0, nq = 0;
for (const m of FX.mixtures) {
  const SD = SDs.dev, P = prep(SD, m.input), grid = SD.lengthGrid(m.S, m.rounds);
  const W = grid.w.reduce((a, b) => a + b, 0);
  ok(Math.abs(W - 1) < 1e-9, "grid weights sum to 1");
  ok(grid.t.length === 10 * m.rounds + 1 && grid.t[grid.t.length - 1] === 5 * m.rounds, "grid shape");
  for (const st of Object.keys(m.out)) {
    const d = P.mixture("A", st, grid), o = m.out[st];
    maxM = Math.max(maxM, rel(d.mean, o.mean));
    for (const [q, key] of [[0.1, "q10"], [0.5, "q50"], [0.9, "q90"]]) {
      const v = d.quantile(q);
      nq++;
      if (v !== o[key]) qOff++;
      ok(Math.abs(v - o[key]) <= 1, `mixture ${st} ${key} js ${v} vs py ${o[key]}`);
    }
  }
}
ok(FX.mixtures.length >= 4, "mixture fixtures");
ok(maxM < 1e-6, "mixture mean max rel diff " + maxM);
ok(qOff <= Math.max(1, Math.floor(nq / 20)), `mixture quantiles off by one: ${qOff} of ${nq}`);

// ---- 3. corner symmetry: swapping A and B swaps the sides exactly
for (const c of FX.cases.slice(0, 20)) {
  const inp = c.input, SD = SDs[c.which];
  const P = prep(SD, inp);
  const Q = SD.prepare({ mlA: inp.mlo, mlB: inp.ml, etaA: inp.etao, etaB: inp.eta, hasEmb: inp.has_emb,
    winLogit: -inp.win_logit, oppA: inp.oppo, oppB: inp.opp, rounds: inp.rounds });
  for (const st of SD.stats) {
    const a = P.dist("A", st, c.t), b = Q.dist("B", st, c.t), a2 = P.dist("B", st, c.t), b2 = Q.dist("A", st, c.t);
    ok(a.mean === b.mean && a["var"] === b["var"] && a2.mean === b2.mean, "swap symmetry " + st);
  }
}

// ---- 4. distribution sanity
for (const c of FX.cases.slice(0, 10)) {
  const P = prep(SDs[c.which], c.input);
  for (const st of ["sig_lnd", "td_att", "kd", "ctrl"]) {
    const d = P.dist("A", st, c.t);
    let s = 0, prev = -1, mono = true;
    const top = st === "ctrl" ? Math.ceil(60 * c.t) : d.quantile(0.9999);
    for (let y = 0; y <= top; y++) { s += d.pmf(y); const F = d.cdf(y); if (F < prev - 1e-12) mono = false; prev = F; }
    ok(mono, "cdf monotone " + st);
    if (st !== "ctrl") ok(Math.abs(s - d.cdf(top)) < 1e-8, `pmf sums to cdf ${st}: ${s} vs ${d.cdf(top)}`);
    else ok(Math.abs(d.cdf(60 * c.t) - 1) < 1e-12, "control cdf reaches 1 at the cap");
    const q1 = d.quantile(0.1), q5 = d.quantile(0.5), q9 = d.quantile(0.9);
    ok(q1 <= q5 && q5 <= q9 && d.cdf(q9) >= 0.9 && (q9 === 0 || d.cdf(q9 - 1) < 0.9), "quantiles " + st);
    const u = SDmod.pit(d, c.out[st].y, 0.5);
    ok(u >= 0 && u <= 1, "pit in [0, 1]");
  }
}
ok(Math.abs(SDmod.lgamma(10) - Math.log(362880)) < 1e-12, "lgamma");
ok(Math.abs(SDmod.betai(2, 3, 0.4) - 0.5248) < 1e-12, "incomplete beta");

// ---- 5. the flag: engineTargets is null unless enabled; enabled -> the expected per-minute rates
{
  const c = FX.cases[0];
  const off = prep(SDs.dev, c.input);
  ok(SDs.dev.engineTargets(off, 15) === null, "flag off -> engineTargets null");
  const SDon = SDmod.load(J, { which: "dev", enable: true }), on = prep(SDon, c.input);
  const tg = SDon.engineTargets(on, 15);
  ok(tg && Math.abs(tg.A.sig_lnd - on.dist("A", "sig_lnd", 15).mean / 15) < 1e-12, "flag on -> rates");
}

// ---- 6. metadata: embed task order matches the embedding model; no 2026 fight in the OOF table
{
  const EM = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "embed_model.json"), "utf8"));
  ok(JSON.stringify(EM.tasks.map((t) => t[0])) === JSON.stringify(J.embed_tasks), "embed task order");
  const OOF = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "statlines_oof.json"), "utf8"));
  const dates = Object.values(OOF.fights).map((f) => f.date);
  ok(dates.length > 2500 && dates.every((d) => d < "2026-01-01"), "OOF table has no 2026 fight");
}

// ---- 7. integration smoke: MLRates (dev model) on a 2025 backtest fight, no embedding -> sane lines
{
  const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));
  const model = ML.load(JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlrates_dev.json"), "utf8")));
  const bt = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "backtest_dev.json"), "utf8"));
  const pri = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlcal_priors_asof.json"), "utf8"));
  const f = bt.fights.filter((x) => x.date >= "2025-01-01" && x.date < "2026-01-01")[0];
  f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys;
  const ctx = { division: f.division, prior_division: f.prior_division, rounds: f.rounds, title: f.title,
    year: +f.date.slice(0, 4), date: f.date, priors: pri[f.date.slice(0, 4)] };
  const pr = ML.predict(model, f.A, f.B, ctx);
  const SD = SDs.dev;
  const P = SD.prepare({ mlA: pr.A, mlB: pr.B, hasEmb: false, winLogit: 0, rounds: f.rounds });
  const grid = SD.lengthGridSimple(0.5, f.rounds === 5 ? [0.15, 0.12, 0.09, 0.07, 0.07] : [0.25, 0.15, 0.10]);
  const L = P.line("A", grid);
  ok(L.sig_lnd.p10 <= L.sig_lnd.p50 && L.sig_lnd.p50 <= L.sig_lnd.p90 && L.sig_lnd.mean > 5 && L.sig_lnd.mean < 200,
    "integration line sig_lnd " + JSON.stringify(L.sig_lnd));
  ok(Object.keys(L).length === 20 && Object.values(L).every((v) => isFinite(v.mean)), "integration line finite");
}

console.log(`test_statdist: ${checks - fails}/${checks} checks passed (params ${maxP.toExponential(1)}, logpmf ` +
  `${maxL.toExponential(1)}, cdf ${maxC.toExponential(1)}, mixture mean ${maxM.toExponential(1)}, quantiles off ${qOff}/${nq})`);
process.exit(fails ? 1 : 0);
