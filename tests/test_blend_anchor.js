// Tests for the blend_anchor engine component (FightEngine.predict, src/ml/blend.js).
//
//   node tests/test_blend_anchor.js            (about a minute)
//
// 1. Flag off = the engine without the component, bit-for-bit: the engine source with the marked blend_anchor block
//    removed is compiled as a second module, and matchup / simulate (traced) / summarize / explain agree exactly with
//    the shipped engine for the same seeds (flag on or off: the component never touches them), and predict() with the
//    flag off returns summarize()'s own numbers.
// 2. Flag on: corner symmetry (exact), rescaling (exact P(win), draw share and within-winner mix kept), cell layout vs
//    summarize's 7 bins, pooling, the anchor solver, the stacker / temperature fits, the profile-noise bootstrap.
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "src");
const ENGINE = path.join(SRC, "engine3.js");
const E = require(ENGINE);
const FB = require(path.join(SRC, "ml/blend.js"));

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived", f), "utf8"));
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ---------------------------------------------------------------- the engine without the component
const src = fs.readFileSync(ENGINE, "utf8");
const b0 = src.indexOf("/* blend_anchor:begin"), b1 = src.indexOf("/* blend_anchor:end */");
check("engine carries one marked blend_anchor block", b0 > 0 && b1 > b0 && src.indexOf("/* blend_anchor:begin", b0 + 1) < 0);
const stripped = src.slice(0, b0) + src.slice(b1 + "/* blend_anchor:end */".length);
check("outside the block the engine never mentions the component", !/FightBlend|blend_anchor|api\.predict/.test(stripped));
const mod = new Module(ENGINE + ".noblend", null);
mod.filename = ENGINE; mod.paths = Module._nodeModulePaths(SRC);
mod._compile(stripped, ENGINE);
const E0 = mod.exports;
check("stripped engine has no predict", typeof E0.predict === "undefined" && typeof E.predict === "function");

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
E.loadDB(dbJson); E0.loadDB(dbJson);
const mlJson = J("mlrates.json");
E.loadMLRates(mlJson); E0.loadMLRates(mlJson);
const OFF = { components: { blend_anchor: false } }, ON = { components: { blend_anchor: true } };
const cases = [
  ["alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, title: false, date: "2026-11-14" }],
  ["islam-makhachev", "charles-oliveira", { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" }],
  ["belal-muhammad", "geoff-neal", { division: "Welterweight", rounds: 3, title: false, date: "2026-11-06", adjA: { acc: 1.1 }, adjB: { tdDef: 0.9 } }]
].filter((c) => E.profile(c[0]) && E.profile(c[1]));
check("test matchups found in fighters.json", cases.length >= 2, cases.length + " matchups");
const strip = (o) => JSON.stringify(o, (k, v) => (k === "opts" || k === "m" || k === "p" && typeof v === "object" ? undefined : v));
for (const [a, b, o] of cases) {
  for (const flag of [OFF, ON]) {
    const tag = `${a} vs ${b}, flag ${flag.components.blend_anchor ? "on" : "off"}`;
    const oo = Object.assign({}, o, { params: flag });
    const m1 = E.matchup(a, b, oo), m0 = E0.matchup(a, b, oo);
    check(`matchup identical (${tag})`, strip(m1) === strip(m0));
    const s1 = E.summarize(m1, 400, 11), s0 = E0.summarize(m0, 400, 11);
    check(`summarize identical, 400 fights (${tag})`, JSON.stringify(s1) === JSON.stringify(s0));
    const f1 = E.simulate(m1, E.makeRng(99), true), f0 = E0.simulate(m0, E0.makeRng(99), true);
    check(`traced simulate identical (${tag})`, JSON.stringify(f1) === JSON.stringify(f0));
    check(`explain identical (${tag})`, E.explain(m1).text === E0.explain(m0).text);
  }
  const pr = E.predict(a, b, Object.assign({}, o, { params: OFF, sims: 300, seed: 5 }));
  const s0 = E0.summarize(E0.matchup(a, b, o), 300, 5);
  check(`predict with the flag off = summarize (${a} vs ${b})`, pr.on === false && JSON.stringify(pr.sim) === JSON.stringify(s0) &&
    pr.p === s0.pA / (s0.pA + s0.pB), "p " + pr.p.toFixed(4));
}

// ---------------------------------------------------------------- building blocks
{
  const m = E.matchup(cases[0][0], cases[0][1], cases[0][2]);
  const s = E.summarize(m, 500, 3), c = FB.simCells(E, m, 500, 3), mg = FB.marginals(c.cells, m.rounds);
  check("simCells plays the same fights as summarize (7 bins equal)", mg.bins7.every((x, i) => Math.abs(x - s.bins[i]) < 1e-12));
  check("cells sum to 1", Math.abs(sum(c.cells) - 1) < 1e-12);
  const finA = []; for (let r = 0; r < m.rounds; r++) finA.push(c.cells[r] + c.cells[m.rounds + r]);
  check("cells by round match summarize finA", finA.every((x, i) => Math.abs(x - s.finA[i]) < 1e-12));
  const R = m.rounds, mir = FB.mirrorCells(FB.mirrorCells(c.cells, R), R);
  check("mirror is an involution", mir.every((x, i) => x === c.cells[i]));
  const rc = FB.rescale(c.cells, R, 0.7), mr = FB.marginals(rc, R), m0 = FB.marginals(c.cells, R);
  check("rescale hits P(win) exactly", Math.abs(mr.p - 0.7) < 1e-12, mr.p.toFixed(6));
  check("rescale keeps the draw share", Math.abs(mr.pD - m0.pD) < 1e-12);
  check("rescale keeps the method mix within each winner", Math.abs(mr.methodGivenWin.A.ko - m0.methodGivenWin.A.ko) < 1e-12 &&
    Math.abs(mr.methodGivenWin.B.sub - m0.methodGivenWin.B.sub) < 1e-12);
  const pool = FB.poolCells(rc, FB.rescale(FB.mirrorCells(c.cells, R), R, 0.7), 0.4, "linear");
  check("pool of two rescaled vectors keeps P(win)", Math.abs(FB.marginals(pool, R).p - 0.7) < 1e-12 && Math.abs(sum(pool) - 1) < 1e-12);
  const lg = FB.poolCells(rc, FB.rescale(FB.mirrorCells(c.cells, R), R, 0.7), 0.4, "log");
  check("log pool is normalised", Math.abs(sum(lg) - 1) < 1e-12);
  const o = { division: "Lightweight", rounds: 5 };
  check("anchor offset 0 leaves the options untouched", FB.anchorOpts(o, 0, FB.DEFAULTS.anchor) === o);
  const oa = FB.anchorOpts({ adjA: { acc: 1.2 } }, 1, { cAcc: 1, cTd: 1, cPow: 0 });
  check("anchor offset multiplies accuracy and takedown odds symmetrically", Math.abs(oa.adjA.acc - 1.2 * Math.exp(0.5)) < 1e-12 &&
    Math.abs(oa.adjB.acc - Math.exp(-0.5)) < 1e-12 && Math.abs(oa.adjB.tdDef - Math.exp(-0.5)) < 1e-12 && Math.abs(oa.adjA.tdDef - Math.exp(0.5)) < 1e-12);
  const op = FB.anchorOpts({}, 0.8, { cAcc: 0, cTd: 0, cPow: 1 });
  check("power split is mean-preserving (total KD rate kept, ratio e^(cPow s))", Math.abs((op.adjA.pow + op.adjB.pow) / 2 - 1) < 1e-12 &&
    Math.abs(op.adjA.pow / op.adjB.pow - Math.exp(0.8)) < 1e-12 && op.adjA.acc === 1 && op.adjB.acc === 1);
  const sw = FB.swapOpts({ adjA: 1, adjB: 2, ml: { A: "a", B: "b", base: 3 }, preufcA: true, preufcB: false });
  check("swapOpts swaps the side-specific options", sw.adjA === 2 && sw.adjB === 1 && sw.ml.A === "b" && sw.ml.B === "a" && sw.ml.base === 3 && sw.preufcA === false);
}
{
  // stacker: non-negative, no intercept, recovers weights on synthetic logits; symmetric by construction
  const rng = E.makeRng(4), X = [], y = [];
  for (let i = 0; i < 4000; i++) {
    const t = rng.normal(), x1 = t + 0.5 * rng.normal(), x2 = t + 0.5 * rng.normal(), x3 = rng.normal();
    X.push([x1, x2, x3]); y.push(rng.u() < 1 / (1 + Math.exp(-(0.6 * x1 + 0.3 * x2))) ? 1 : 0);
  }
  const w = FB.nnLogit(X, y, null, 1e-6);
  check("nnLogit recovers weights (0.6, 0.3, 0)", Math.abs(w[0] - 0.6) < 0.1 && Math.abs(w[1] - 0.3) < 0.1 && w[2] >= 0 && w[2] < 0.05, w.map((x) => x.toFixed(3)).join(", "));
  const Xm = X.map((r) => r.map((v) => -v)), ym = y.map((v) => 1 - v), wm = FB.nnLogit(Xm, ym, null, 1e-6);
  check("nnLogit is corner-symmetric (mirrored data, same weights)", w.every((x, i) => Math.abs(x - wm[i]) < 1e-6));
  const z = X.map((r) => 2 * (0.6 * r[0] + 0.3 * r[1])), T = FB.fitTemp(z, y);
  check("fitTemp undoes a doubled logit", Math.abs(T - 0.5) < 0.06, T.toFixed(3));
}
{
  // profile-noise draws keep exposures, keep landed <= attempted, and are unbiased on average
  const prof = E.profile(cases[0][0]), keys = E.KEYS, S = keys.map((k, i) => Array.isArray(prof.S) ? prof.S[i] : prof.S[k]);
  const rng = E.makeRng(9), I = {}; keys.forEach((k, i) => { I[k] = i; });
  let okExp = true, okLnd = true; const acc = new Array(keys.length).fill(0), Bn = 3000;
  for (let b = 0; b < Bn; b++) {
    const q = FB.perturbS(S, keys, rng, FB.DEFAULTS.boot);
    for (const k of ["min", "n", "rds", "ko_w", "dec_l"]) if (q[I[k]] !== S[I[k]]) okExp = false;
    for (const p of ["d", "h", "oh", "td", "otd"]) if (q[I[p + "_lnd"]] > q[I[p + "_att"]] + 1e-9) okLnd = false;
    q.forEach((x, i) => { acc[i] += x / Bn; });
  }
  check("profile noise keeps exposures and win/loss counts", okExp);
  check("profile noise keeps landed <= attempted", okLnd);
  const rel = ["d_att", "h_lnd", "td_att", "ctrl", "okd"].map((k) => Math.abs(acc[I[k]] / Math.max(1e-9, S[I[k]]) - 1));
  check("profile noise is unbiased (mean within 3%)", rel.every((r) => r < 0.03), rel.map((r) => r.toFixed(3)).join(" "));
}

// ---------------------------------------------------------------- flag on: the package
{
  // v5 merge step 5: the ML v2 package's exported stack (blindtest_stack.json; `model` / `model_open` by opts.lineKind) with the
  // feature LR from moe_page.json; tests/test_v5_step5.js checks the stack blocks, ML v2 and the backtest guard
  E.loadBlend({ stack: J("blindtest_stack.json"), feat: J("moe_page.json"), methodRound: J("methodround.json") });
  const [a, b, o] = cases[0];
  const oo = Object.assign({}, o, { sims: 300, seed: 5 });
  const t0 = Date.now();
  const r = E.predict(a, b, oo), rs = E.predict(b, a, oo);
  check("predict (flag on) returns the blend package", r.on === true && r.source === "stack" && r.p > 0 && r.p < 1 && r.experts.engine === r.sim.p,
    `p ${r.p.toFixed(4)} (engine ${r.sim.p.toFixed(4)}, ${Date.now() - t0} ms for two calls)`);
  check("predict is exactly corner-symmetric", Math.abs(r.p + rs.p - 1) < 1e-12 && r.bins7.every((x, i) => Math.abs(x - rs.bins7[6 - i]) < 1e-12),
    (r.p + rs.p).toString());
  check("package cells agree with P(win) and sum to 1", Math.abs(r.marginals.p - r.p) < 1e-12 && Math.abs(sum(r.cells) - 1) < 1e-9);
  check("method/round pooled with the S model", r.methodRound.mrRescaled !== null && r.methodRound.variant === "S" && r.methodRound.weight > 0 && r.methodRound.weight <= 1,
    "w " + r.methodRound.weight);
  check("ML stat lines present next to the simulator's", !!(r.statLines.ml && r.statLines.ml.perMin.A.sig_lnd > 0 && r.statLines.sim.perMin.A.sig_lnd > 0));
  const iv = r.interval;
  check("interval is ordered and contains the point", iv && iv.levels["0.95"][0] <= iv.levels["0.8"][0] && iv.levels["0.8"][0] <= r.p && r.p <= iv.levels["0.8"][1] &&
    iv.levels["0.8"][1] <= iv.levels["0.95"][1], JSON.stringify(iv.levels));
  const rl = E.predict(a, b, Object.assign({}, oo, { line: { oddsA: 160, oddsB: -180 }, lineKind: "close", interval: false }));
  check("a market line (lineKind 'close') switches the blend to the line regime", rl.blend.regime === "present" && rl.stack.block === "model" && Math.abs(rl.p - r.p) > 0.01, `p with line ${rl.p.toFixed(4)}`);
  const ro = E.predict(a, b, Object.assign({}, oo, { line: { oddsA: 160, oddsB: -180 }, lineKind: "open", interval: false }));
  check("an opener (lineKind 'open') uses the open-trained block", ro.blend.regime === "present" && ro.stack.block === "model_open" && Math.abs(ro.p - rl.p) > 1e-6, `p with opener ${ro.p.toFixed(4)}`);
  const ra = E.predict(a, b, Object.assign({}, oo, { anchor: true, interval: false }));
  check("anchor moves the simulator toward the blend", ra.anchor && Math.abs(ra.anchor.p - ra.p) < Math.abs(r.sim.p - r.p) + 0.02 && Math.sign(ra.anchor.s) === Math.sign(logitOf(r.p) - logitOf(r.sim.p)),
    `sim ${r.sim.p.toFixed(3)} -> anchored ${ra.anchor.p.toFixed(3)} (target ${ra.p.toFixed(3)}, s ${ra.anchor.s.toFixed(3)}, ${ra.anchor.iters} evals)`);
  check("anchored package keeps the blend's P(win)", Math.abs(ra.p - r.p) < 1e-12 && Math.abs(ra.marginals.p - ra.p) < 1e-12);
  const rT = E.predict(a, b, Object.assign({}, oo, { recalT: 1.2, interval: false }));
  check("recalT stretches the blended logit", Math.abs(logitOf(rT.p) - 1.2 * logitOf(rT.pRaw)) < 1e-9);
  // verifier additions: the interval is corner-symmetric too (canonical draw order, mirrored noise)
  const ivs = rs.interval, mir = (x, y) => Math.abs(x[0] - (1 - y[1])) < 1e-9 && Math.abs(x[1] - (1 - y[0])) < 1e-9;
  check("interval is exactly corner-symmetric (raw and calibrated)", !!(iv && ivs) && mir(iv.levels["0.8"], ivs.levels["0.8"]) && mir(iv.levels["0.95"], ivs.levels["0.95"]) &&
    mir(iv.calibrated["0.8"], ivs.calibrated["0.8"]) && Math.abs(iv.sdLogit - ivs.sdLogit) < 1e-9,
    `${JSON.stringify(iv.levels["0.8"])} vs mirrored ${JSON.stringify([1 - ivs.levels["0.8"][1], 1 - ivs.levels["0.8"][0]])}`);
  // a manual profile has no decayed-sum array, so no feat_lr and no stored MoE pattern: predict falls back to the simulator
  const man = E.manualProfile({ name: "Manual fighter", slpm: 4.2, sapm: 3.9, td15: 1.2, mins: 60 }, { division: "Lightweight" });
  let rm = null, err = null;
  try { rm = E.predict(man, b, Object.assign({}, oo, { anchor: true })); } catch (e) { err = e; }
  check("predict with a manual profile falls back to the simulator instead of throwing", !err && rm && rm.source === "engine" && !!rm.blendError &&
    Math.abs(rm.p - rm.sim.p) < 1e-12 && Math.abs(FB.sideSums(rm.cells, rm.R).pA + FB.sideSums(rm.cells, rm.R).pB + rm.pD - 1) < 1e-9,
    err ? String(err.message) : `p ${rm.p.toFixed(4)}, ${rm.blendError}`);
}
check("blend.js uses no Math.random", !/Math\.random/.test(fs.readFileSync(path.join(SRC, "ml/blend.js"), "utf8")));
function logitOf(p) { return Math.log(p / (1 - p)); }

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
