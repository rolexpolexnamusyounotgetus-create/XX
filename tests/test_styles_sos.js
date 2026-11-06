#!/usr/bin/env node
/* Tests for the styles_sos engine component (src/styles_sos.js, hook in src/engine3.js, flags in src/params3.js).

     node tests/test_styles_sos.js

   1. Flag off = the engine without the component, bit-for-bit: the engine source with every [styles_sos] line and the
      [styles_sos] begin/end block removed is compiled as a second engine; matchup tables, traced fights and summaries
      must be identical for the same seeds (plain and learned-rate matchups, both corner orders). When git is available
      the stripped source is also compared with src/engine3.js of the component's base commit.
   2. The JS style features and term values reproduce tools/styles.py (Side.features, term_value) on 30 fixture fights.
   3. Modifier mechanics: each block moves exactly the tables section 9 names, by exp(s); the knob scales s; the
      sub-flags switch parts independently; strength-of-schedule multipliers follow the documented formula.
   4. Engine invariants with the component on: determinism, trace on/off equality, corner-swap symmetry of the
      modifiers, no Math.random, API and trace format unchanged. */
"use strict";
const fs = require("fs");
const path = require("path");
const Module = require("module");
const cp = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const ENGINE = path.join(ROOT, "src", "engine3.js");
const E = require(ENGINE);
const SS = require(path.join(ROOT, "src", "styles_sos.js"));
const FP = require(path.join(ROOT, "src", "params3.js"));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "styles_sos_fixture.json"), "utf8"));
const BASE_COMMIT = "853ce32";   // the worktree commit the component branch started from (engine file synced in a08e00c)

let pass = 0, fail = 0;
function check(name, ok, info) {
  if (ok) pass++; else fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + name + (info ? "  (" + info + ")" : ""));
}
function close(a, b, tol) { return Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b)); }

// ------------------------------------------------------------------ the engine without the component
const SRC = fs.readFileSync(ENGINE, "utf8");
function stripComponent(src) {
  const out = [];
  let skip = false;
  for (const line of src.split("\n")) {
    if (line.indexOf("[styles_sos] begin") >= 0) { skip = true; continue; }
    if (line.indexOf("[styles_sos] end") >= 0) { skip = false; continue; }
    if (skip || line.indexOf("[styles_sos]") >= 0) continue;
    out.push(line);
  }
  return out.join("\n");
}
const STRIPPED = stripComponent(SRC);
function compile(src, file) {
  const m = new Module(file, module);
  m.filename = file;
  m.paths = Module._nodeModulePaths(path.dirname(file));
  m._compile(src, file);
  return m.exports;
}
const E0 = compile(STRIPPED, ENGINE);
check("stripped engine differs from the hooked one only by the hook", SRC !== STRIPPED && SRC.split("\n").length - STRIPPED.split("\n").length <= 20,
  (SRC.split("\n").length - STRIPPED.split("\n").length) + " lines removed");
try {
  const baseSrc = cp.execSync("git show a08e00c:src/engine3.js", { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  check("stripped engine == engine3.js at the component's base (a08e00c, v4 snapshot of " + BASE_COMMIT + "'s main)", baseSrc === STRIPPED);
} catch (e) {
  console.log("SKIP  base-commit source comparison (git object not available)");
}

// ------------------------------------------------------------------ fixture profiles
const keys = FIX.keys;
function sideProf(s, name) { return { name: name, keys: keys, S: s.S, height_in: s.height_in, reach_in: s.reach_in, stance: s.stance, age: 30 }; }
function oaFactors(seed) {   // a deterministic oppadj-style factor set (tools/oppadj.py snapshot format)
  const r = (k) => 1 + 0.15 * Math.sin(seed * 3.7 + k * 1.3);
  const o = {};
  ["dAtt", "dAttAg", "cAtt", "cAttAg", "gAtt", "gAttAg", "tdAtt", "tdAttAg", "tdAcc", "tdAccAg", "ctrl", "octrl", "topSkill", "escWeak",
    "sub", "subAg", "pow", "chin"].forEach((k, i) => { o[k] = r(i); });
  o.acc = [r(20), r(21), r(22)]; o.accAg = [r(23), r(24), r(25)];
  return o;
}
// priors: a division prior assembled from the engine-free fixture is not stored; use a league-like prior from the
// roster if present, else synthesise one from the fixture sums (any positive prior works for the equality checks)
function synthPrior() {
  const P = {}, n = FIX.fights.length * 2;
  for (const k of keys) P[k] = 0;
  let min = 0;
  for (const f of FIX.fights) for (const s of [f.A, f.B]) { s.S.forEach((v, i) => { P[keys[i]] += v; }); min += s.S[0]; }
  for (const k of keys) P[k] = P[k] / min;
  P.lbs = 155; P.min = 1;
  for (const p of ["d", "c", "g", "h", "b", "l", "t"]) P["acc_" + p] = P[p + "_lnd"] / P[p + "_att"];
  P.acc_sig = (P.d_lnd + P.c_lnd + P.g_lnd) / (P.d_att + P.c_att + P.g_att);
  P.kd_per_h = P.kd / P.h_lnd; P.td_acc = P.td_lnd / P.td_att; P.ctrl_per_td = P.ctrl / P.td_lnd;
  P.sub_conv = Math.max(0.1, P.sub_w / Math.max(1e-6, P.sub_att)); P.kd_fin = 0.6; P.mpf = 11;
  return { Lightweight: P, ALL: P };
}
const PRI = synthPrior();
const base = { division: "Lightweight", rounds: 3, title: false, date: "2021-06-01", priors: PRI };
const OFFP = { components: { styles_sos: false } };

function sideSos(seed) {   // a deterministic, non-trivial strength-of-schedule input
  const r = (k) => Math.sin(seed * 12.9898 + k * 78.233) * 0.5;
  const mk = (o) => [0, 1, 2, 3, 4].map((i) => [0.2 * r(i + o), 20 + 30 * Math.abs(r(i + o + 9))]);
  return { a: mk(0), o: mk(5) };
}
const learned = (() => {   // a fake learned-rate prediction (league-like with a matchup twist) to exercise the ML path
  const P = PRI.Lightweight;
  const mk = (f) => ({ d_att: P.d_att * f, c_att: P.c_att, g_att: P.g_att, h_att: P.h_att * f, b_att: P.b_att, l_att: P.l_att,
    td_att: P.td_att / f, sub_att: P.sub_att, rev: P.rev, ctrl: P.ctrl / f, acc_h: P.acc_h, acc_b: P.acc_b, acc_l: P.acc_l,
    acc_d: P.acc_d, acc_c: P.acc_c, acc_g: P.acc_g, td_acc: P.td_acc, kd_h: P.kd_per_h });
  return { A: mk(1.15), B: mk(0.9) };
})();

// ------------------------------------------------------------------ 1. flag off = engine without the component
function tablesEqual(m0, m1) {
  const ks = ["dRate", "cRate", "gRate", "gBot", "tdD", "tdCC", "tdCU", "tdO", "tdOC", "upPos", "swPos", "gPos", "subTPos",
    "subBPos", "subOPos", "accO", "mixC", "kd", "dw", "gnp", "stko", "subO", "gillo", "drain", "occ", "up", "sw"];
  for (const k of ks) {
    const a = m0[k], b = m1[k];
    if (!a && !b) continue;
    if (!a || !b || a.length !== b.length) return k;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(Number.isNaN(a[i]) && Number.isNaN(b[i]))) return k + "[" + i + "]";
  }
  return null;
}
let offOk = true, offInfo = "";
for (let q = 0; q < 6; q++) {
  const f = FIX.fights[q];
  for (const ml of [false, true]) {
    for (const swap of [false, true]) {
      const A = sideProf(swap ? f.B : f.A, "A"), B = sideProf(swap ? f.A : f.B, "B");
      if (q % 2) { A.oppadj = oaFactors(q); B.oppadj = oaFactors(q + 7); }
      const o = Object.assign({}, base, { ml: ml ? learned : false, sos: { A: sideSos(q), B: sideSos(q + 50) } });
      const m0 = E0.matchup(A, B, o);
      const m1 = E.matchup(A, B, Object.assign({}, o, { params: OFFP }));
      const d = tablesEqual(m0, m1);
      if (d) { offOk = false; offInfo = "table " + d + " fight " + q; }
      const t0 = E0.simulate(m0, E0.makeRng(100 + q), true), t1 = E.simulate(m1, E.makeRng(100 + q), true);
      if (JSON.stringify(t0) !== JSON.stringify(t1)) { offOk = false; offInfo = "traced fight differs, fight " + q; }
      const s0 = E0.summarize(m0, 300, 7 + q), s1 = E.summarize(m1, 300, 7 + q);
      if (JSON.stringify(s0) !== JSON.stringify(s1)) { offOk = false; offInfo = "summary differs, fight " + q; }
      if (m1.stylesSOS) { offOk = false; offInfo = "component record present with the flag off"; }
    }
  }
}
check("flag off: tables, traced fights and summaries identical to the engine without the component (24 matchups)", offOk, offInfo);
{
  // components: false at the top level and an engine without params.components behave the same way
  const f = FIX.fights[7], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  const m0 = E0.matchup(A, B, base), m1 = E.matchup(A, B, Object.assign({}, base, { params: { components: false } }));
  check("params.components = false is also the plain engine", tablesEqual(m0, m1) === null &&
    JSON.stringify(E0.summarize(m0, 200, 3)) === JSON.stringify(E.summarize(m1, 200, 3)));
  const m2 = E.matchup(A, B, Object.assign({}, base, { params: { components: { styles_sos: { styles: false, sos: false } } } }));
  check("both sub-flags off changes no table", tablesEqual(m0, m2) === null);
}
check("default params: component on in this branch (strength of schedule on, style blocks off)",
  !!(FP.components && FP.components.styles_sos && FP.components.styles_sos.sos && FP.components.styles_sos.styles === false));
{
  // [verifier] with the defaults and no SOS input (live roster without a table, tools that pass no opts.sos) the tables
  // are exactly the plain engine's, on both paths
  const f = FIX.fights[2], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  let same = true;
  for (const ml of [false, learned]) {
    const m0 = E.matchup(A, B, Object.assign({}, base, { ml: ml, params: OFFP })), m1 = E.matchup(A, B, Object.assign({}, base, { ml: ml }));
    if (tablesEqual(m0, m1) !== null) same = false;
  }
  check("defaults without an SOS input: tables identical to the engine without the component (base and learned rates)", same);
}

// ------------------------------------------------------------------ 2. style features and terms vs tools/styles.py
{
  let worstF = 0, worstT = 0;
  // each fixture fight carries the priors_asof division prior tools/styles.py used (the keys the features need)
  const withP = FIX.fights.filter((f) => f.P);
  if (withP.length) {
    for (const f of withP) {
      const sA = {}, sB = {};
      keys.forEach((k, i) => { sA[k] = f.A.S[i]; sB[k] = f.B.S[i]; });
      const fa = SS.styleFeatures(sA, f.P), fb = SS.styleFeatures(sB, f.P);
      for (const k of Object.keys(f.fA)) { worstF = Math.max(worstF, Math.abs(fa[k] - f.fA[k]), Math.abs(fb[k] - f.fB[k])); }
      const za = SS.styleZ(fa), zb = SS.styleZ(fb);
      for (const term of Object.keys(f.t)) {
        const ab = SS.termValue(term, za, zb, f.A, f.B), ba = SS.termValue(term, zb, za, f.B, f.A);
        worstT = Math.max(worstT, Math.abs(ab - f.t[term][0]), Math.abs(ba - f.t[term][1]));
      }
    }
    check("style features match tools/styles.py Side.features (" + withP.length + " fights)", worstF < 1e-9, "max diff " + worstF.toExponential(2));
    check("term values match tools/styles.py term_value", worstT < 1e-9, "max diff " + worstT.toExponential(2));
  } else check("fixture carries the division priors", false, "regenerate tests/fixtures/styles_sos_fixture.json");
  const tm = FIX.term_means_2019_2023;
  check("open-stance centering constant matches the 2019-2023 side mean", Math.abs(SS.TERM_MEAN.open - tm.open) < 1e-5, tm.open.toFixed(6));
  check("z terms have mean ~0 on 2019-2023 sides (no centering needed)", ["zy_vol", "zy_td_def", "zy_sub_int", "zy_kd_pow"].every((k) => Math.abs(tm[k]) < 1e-4));
}

// ------------------------------------------------------------------ 3. mechanics
{
  const f = FIX.fights[3], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  const o = Object.assign({}, base, { ml: false });
  const m0 = E.matchup(A, B, Object.assign({}, o, { params: OFFP }));
  const m1 = E.matchup(A, B, Object.assign({}, o, { params: { components: { styles_sos: { styles: true, sos: false } } } }));
  const r = m1.stylesSOS.styles, ok = [];
  for (let i = 0; i < 2; i++) {
    const e = r.mult[i];
    ok.push(close(m1.dRate[i], m0.dRate[i] * e.dist_att, 1e-12));
    ok.push(close(m1.tdD[i], m0.tdD[i] * e.td_att, 1e-12) && close(m1.tdCC[i], m0.tdCC[i] * e.td_att, 1e-12) && close(m1.tdCU[i], m0.tdCU[i] * e.td_att, 1e-12));
    ok.push(close(m1.gRate[i], m0.gRate[i] * e.gnp_att, 1e-12));
    for (let k = 0; k < 5; k++) {
      ok.push(close(m1.upPos[i * 5 + k], m0.upPos[i * 5 + k] / e.ctrl_per_td, 1e-12));
      ok.push(close(m1.swPos[i * 5 + k], m0.swPos[i * 5 + k] / e.ctrl_per_td, 1e-12));
      ok.push(close(m1.gPos[i * 5 + k], m0.gPos[i * 5 + k] * e.gnp_att, 1e-12));
    }
  }
  check("styles: dist_att, td_att, ctrl_per_td, gnp_att move exactly their tables by exp(s)", ok.every(Boolean));
  const untouched = ["cRate", "gBot", "tdO", "tdOC", "accO", "kd", "subTPos", "subBPos", "mixC", "drain"].every((k) =>
    Array.from(m0[k]).every((v, i) => v === m1[k][i]));
  check("styles: every other table untouched (strikes in the clinch, accuracy, takedown success, KD, subs, cardio)", untouched);
  // equations: recompute s from the fixture's term values and the ab1 coefficients (|z| >= 2, open centred)
  const zA = SS.styleZ(SS.styleFeatures(m1.R[0].sums, m1.P)), zB = SS.styleZ(SS.styleFeatures(m1.R[1].sums, m1.P));
  const tv = (t, i) => i === 0 ? SS.termValue(t, zA, zB, A, B) : SS.termValue(t, zB, zA, B, A);
  let eqOk = true;
  for (let i = 0; i < 2; i++) {
    const dist = 0.052357 * tv("length_d", i) - 0.067632 * (tv("open", i) - 0.274637);
    const td = -0.096627 * tv("length_d", i) + 0.16794 * tv("zy_vol", i) - 0.074101 * tv("zy_td_def", i);
    const cpt = -0.1069 * tv("zy_td_def", i);
    const gnp = 0.10378 * tv("zy_sub_int", i) + 0.074442 * tv("zy_kd_pow", i);
    eqOk = eqOk && close(r.s[i].dist_att, dist, 1e-9) && close(r.s[i].td_att, td, 1e-9) && close(r.s[i].ctrl_per_td, cpt, 1e-9) && close(r.s[i].gnp_att, gnp, 1e-9);
  }
  check("styles (ab1): s equals section 9's a = b = 1 equations without the |z| < 2 terms, open centred", eqOk);
  const mf = E.matchup(A, B, Object.assign({}, o, { params: { components: { styles_sos: { styles: true, sos: false } }, stylesSOS: { styleSet: "fit" } } }));
  let fitOk = true;
  for (let i = 0; i < 2; i++) {
    const zx = i === 0 ? zA : zB, zy = i === 0 ? zB : zA;
    const dist = 0.063904 * tv("length_d", i) - 0.073081 * (tv("open", i) - 0.274637) - 0.023806 * zy.kd_pow;
    const td = -0.076253 * zy.td_int - 0.13401 * tv("length_d", i) + 0.076694 * zy.vol - 0.093306 * zy.td_def;
    fitOk = fitOk && close(mf.stylesSOS.styles.s[i].dist_att, dist, 1e-9) && close(mf.stylesSOS.styles.s[i].td_att, td, 1e-9) && zx;
  }
  check("styles (fit): free-exponent coefficients with every term", fitOk);
  const mk = E.matchup(A, B, Object.assign({}, o, { styleMatchups: 0.5, params: { components: { styles_sos: { styles: true, sos: false } } } }));
  check("styleMatchups knob scales s (0.5 -> square root of the multipliers)", close(mk.stylesSOS.styles.mult[0].dist_att, Math.sqrt(r.mult[0].dist_att), 1e-12) &&
    close(mk.dRate[1], m0.dRate[1] * Math.sqrt(r.mult[1].dist_att), 1e-12));
  const mz = E.matchup(A, B, Object.assign({}, o, { styleMatchups: 0, params: { components: { styles_sos: { styles: true, sos: false } } } }));
  check("styleMatchups 0 reproduces the plain tables", tablesEqual(m0, mz) === null);
  // swap symmetry: A vs B multipliers equal B vs A swapped
  const ms = E.matchup(B, A, Object.assign({}, o, { params: { components: { styles_sos: { styles: true, sos: false } } } }));
  check("styles: swapping corners swaps the multipliers", ["dist_att", "td_att", "ctrl_per_td", "gnp_att"].every((k) =>
    close(ms.stylesSOS.styles.mult[0][k], r.mult[1][k], 1e-12) && close(ms.stylesSOS.styles.mult[1][k], r.mult[0][k], 1e-12)));
}
{
  const f = FIX.fights[5], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  const sos = { A: sideSos(1), B: sideSos(2) };
  for (const ml of [false, true]) {
    const o = Object.assign({}, base, { ml: ml ? learned : false, sos: sos });
    const m0 = E.matchup(A, B, Object.assign({}, o, { params: OFFP }));
    const m1 = E.matchup(A, B, Object.assign({}, o, { params: { components: { styles_sos: { styles: false, sos: true } } } }));
    const rec = m1.stylesSOS.sos, C = SS.SOS_COEF[ml ? "ml" : "base"], K = SS.SOS_K;
    let ok = rec.path === (ml ? "ml" : "base");
    for (let i = 0; i < 2; i++) {
      const X = i === 0 ? sos.A : sos.B, Y = i === 0 ? sos.B : sos.A;
      SS.SOS_STATS.forEach((st, q) => {
        const c = C[st], ba = X.a[q][0] * X.a[q][1] / (X.a[q][1] + K[q]), bo = Y.o[q][0] * Y.o[q][1] / (Y.o[q][1] + K[q]);
        const want = Math.exp(c[0] * (ba - c[2]) + c[1] * (bo - c[3]));
        ok = ok && close(rec.mult[i][st], want, 1e-12);
      });
      const e = rec.mult[i];
      ok = ok && close(m1.dRate[i], m0.dRate[i] * e.dAtt, 1e-12) && close(m1.tdD[i], m0.tdD[i] * e.tdAtt, 1e-12) &&
        close(m1.tdO[i], m0.tdO[i] * e.tdAcc, 1e-12) && close(m1.kd[i], m0.kd[i] * e.kd, 1e-12);
      for (let t = 0; t < 3; t++) ok = ok && close(m1.accO[i * 12 + t], m0.accO[i * 12 + t] * e.acc, 1e-12) && m1.accO[i * 12 + 3 + t] === m0.accO[i * 12 + 3 + t];
    }
    check("sos (" + (ml ? "learned rates" : "base tables") + "): multipliers = exp(beta_a (bias_a - c_a) + beta_o (bias_o - c_o)) on the documented tables", ok);
  }
  const m0 = E.matchup(A, B, Object.assign({}, base, { params: OFFP }));
  const mn = E.matchup(A, B, Object.assign({}, base, { params: { components: { styles_sos: { styles: false, sos: true } } } }));
  check("sos: sides without an input are neutral", tablesEqual(m0, mn) === null);
  const lo = SS.loadSOS({ roster: { "fx-a": sos.A, "fx-b": sos.B } });
  const Ar = Object.assign({ slug: "fx-a" }, A), Br = Object.assign({ slug: "fx-b" }, B);
  const m2 = E.matchup(Ar, Br, Object.assign({}, base, { params: { components: { styles_sos: { styles: false, sos: true } } } }));
  const m3 = E.matchup(A, B, Object.assign({}, base, { sos: sos, params: { components: { styles_sos: { styles: false, sos: true } } } }));
  check("sos: a loaded roster table (by slug) gives the same result as opts.sos", !!lo && tablesEqual(m2, m3) === null);
  // [verifier] no look-ahead from a roster table: bouts on or before its roster_asof run neutral, later bouts use it, and
  // an explicit opts.sos is never topped up from the table
  const SOP = { components: { styles_sos: { styles: false, sos: true } } };
  SS.loadSOS({ meta: { roster_asof: "2026-10-31" }, roster: { "fx-a": sos.A, "fx-b": sos.B } });
  const mPast = E.matchup(Ar, Br, Object.assign({}, base, { date: "2021-05-01", params: SOP }));
  const mLive = E.matchup(Ar, Br, Object.assign({}, base, { date: "2026-11-07", params: SOP }));
  const mPart = E.matchup(Ar, Br, Object.assign({}, base, { date: "2026-11-07", sos: { A: sos.A }, params: SOP }));
  check("sos: roster table not used for bouts on or before its roster_asof (backtest without opts.sos is neutral)",
    tablesEqual(mPast, mn) === null && mPast.stylesSOS.sos.have.join() === "false,false");
  check("sos: roster table used for bouts after its roster_asof", tablesEqual(mLive, m3) === null && mLive.stylesSOS.sos.have.join() === "true,true");
  check("sos: a side missing from opts.sos stays neutral (not filled from the roster table)", mPart.stylesSOS.sos.have.join() === "true,false");
  SS.loadSOS(null);
}

{
  // per-path block lists (params3.js default: none on the learned-rate path, all four on the base tables)
  const f = FIX.fights[4], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  const st = { components: { styles_sos: { styles: true, sos: false } } };
  const m0 = E.matchup(A, B, Object.assign({}, base, { ml: learned, params: OFFP }));
  const mD = E.matchup(A, B, Object.assign({}, base, { ml: learned, params: st }));
  check("default: no style block on the learned-rate path (tables unchanged)", tablesEqual(m0, mD) === null && mD.stylesSOS.styles.blocks.length === 0);
  const mB = E.matchup(A, B, Object.assign({}, base, { ml: false, params: st }));
  check("default: all four style blocks on the base tables", mB.stylesSOS.styles.blocks.length === 4 &&
    ["dist_att", "td_att", "ctrl_per_td", "gnp_att"].every((k) => mB.stylesSOS.styles.mult[0][k] !== 1));
  const mA = E.matchup(A, B, Object.assign({}, base, { ml: learned, params: Object.assign({}, st, { stylesSOS: { styleBlocks: "all" } }) }));
  const mG = E.matchup(A, B, Object.assign({}, base, { ml: learned, params: Object.assign({}, st, { stylesSOS: { styleBlocks: { ml: ["gnp_att"], base: "all" } } }) }));
  check("styleBlocks 'all' / per-path lists select the blocks", mA.stylesSOS.styles.blocks.length === 4 &&
    mG.stylesSOS.styles.mult[0].dist_att === 1 && mG.stylesSOS.styles.mult[0].gnp_att !== 1 && mG.dRate[0] === m0.dRate[0] && mG.gRate[0] !== m0.gRate[0]);
}

{
  // sos source "oppadj" (tools/oppadj.py factors, research/model_oppadj.md recommendation)
  const f = FIX.fights[6], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  A.oppadj = oaFactors(1); B.oppadj = oaFactors(2);
  const oaP = { components: { styles_sos: { styles: false, sos: true } }, stylesSOS: { sosSource: "oppadj" } };
  const P = E.priorFor("Lightweight", PRI), L = E.league(P, FP);
  const R0 = E.fighterRates(Object.assign({}, A, { oppadj: null }), P, L, FP, 3);
  const pOA = Object.assign({}, FP, oaP);
  const R1 = E.fighterRates(A, P, L, pOA, 3);
  let ok = SS.OA_R_FIELDS.every((k) => close(R1[k], R0[k] * A.oppadj[k], 1e-12));
  const od = (x) => x / (1 - x);
  ok = ok && close(od(R1.tdAcc), od(R0.tdAcc) * A.oppadj.tdAcc, 1e-9) && close(od(R1.tdAccAg), od(R0.tdAccAg) * A.oppadj.tdAccAg, 1e-9);
  ok = ok && close(R1.accSh[0], R0.accSh[0] + Math.log(A.oppadj.acc[0]), 1e-12) && close(R1.accSh[2], R0.accSh[2] + Math.log(A.oppadj.acc[2]), 1e-12) &&
    R1.accSh[1] === R0.accSh[1] && R1.pow === R0.pow && R1.chin === R0.chin && R1.sub === R0.sub && R1.subAg === R0.subAg;
  check("oppadj (base tables): factors multiply the engine R fields of the recommended families only", ok);
  const R2 = E.fighterRates(A, P, L, Object.assign({}, FP, { components: { styles_sos: { styles: false, sos: true } } }), 3);
  check("oppadj factors are inert unless sosSource is 'oppadj'", SS.OA_R_FIELDS.every((k) => R2[k] === R0[k]));
  // learned-rate path: the R-level factors still run (topSkill / escWeak matter there; the re-targeted fields are
  // overridden), so the reference is the same matchup with every beta at 0
  const zeroB = {}; Object.keys(SS.OA_ML_BETA).forEach((k) => { zeroB[k] = 0; });
  const m0 = E.matchup(A, B, Object.assign({}, base, { ml: learned, params: { components: oaP.components, stylesSOS: { sosSource: "oppadj", oppadjBeta: zeroB } } }));
  const m1 = E.matchup(A, B, Object.assign({}, base, { ml: learned, params: oaP }));
  const Bt = SS.OA_ML_BETA, e0 = m1.stylesSOS.sos.mult[0];
  const want = Math.pow(A.oppadj.dAtt * B.oppadj.dAttAg, Bt.dAtt), wantTd = Math.pow(A.oppadj.tdAtt * B.oppadj.tdAttAg, Bt.tdAtt);
  const wantH = Math.pow(A.oppadj.acc[0] * B.oppadj.accAg[0], Bt.accH);
  check("oppadj (learned rates): final tables x (F_off,X F_def,Y)^beta", m1.stylesSOS.sos.source === "oppadj" && close(e0.dAtt, want, 1e-12) &&
    close(m1.dRate[0], m0.dRate[0] * want, 1e-9) && close(m1.tdD[0], m0.tdD[0] * wantTd, 1e-9) && close(m1.accO[0], m0.accO[0] * wantH, 1e-9) &&
    m1.kd[0] === m0.kd[0]);
}

// ------------------------------------------------------------------ 4. invariants with the component on
{
  const f = FIX.fights[9], A = sideProf(f.A, "A"), B = sideProf(f.B, "B");
  const o = Object.assign({}, base, { ml: learned, sos: { A: sideSos(3), B: sideSos(4) } });
  const m = E.matchup(A, B, o);
  check("component on by default records its work on m.stylesSOS (sos applied, styles off)", !!(m.stylesSOS && m.stylesSOS.styles === null && m.stylesSOS.sos &&
    m.stylesSOS.sos.have.join() === "true,true"));
  const a1 = E.simulate(m, E.makeRng(42), true), a2 = E.simulate(m, E.makeRng(42), true), a3 = E.simulate(m, E.makeRng(42), false);
  check("same seed, same fight (component on)", JSON.stringify(a1) === JSON.stringify(a2));
  check("trace on and off give the same fight (component on)", a1.winner === a3.winner && a1.method === a3.method && a1.round === a3.round &&
    a1.t === a3.t && JSON.stringify(a1.totals) === JSON.stringify(a3.totals));
  const kinds = new Set();
  a1.rounds.forEach((r) => r.ev.forEach((e) => kinds.add(e.k)));
  const allowed = new Set(["miss", "hit", "hurt", "kd", "fin", "clinch", "break", "td", "tdx", "pass", "esc", "sweep", "up", "sub", "subx", "recover", "reset"]);
  check("trace format unchanged (event kinds)", [...kinds].every((k) => allowed.has(k)), [...kinds].join(","));
  check("API surface unchanged", ["loadDB", "profile", "matchup", "simulate", "bucket", "makeRng", "summarize", "explain", "manualProfile"].every((k) => typeof E[k] === "function"));
  check("component source has no Math.random", !/Math\.random/.test(fs.readFileSync(path.join(ROOT, "src", "styles_sos.js"), "utf8")));
  const s1 = E.summarize(m, 3000, 9);
  const mS = E.matchup(B, A, Object.assign({}, o, { ml: { A: learned.B, B: learned.A }, sos: { A: o.sos.B, B: o.sos.A } }));
  const s2 = E.summarize(mS, 3000, 19);
  check("corner swap swaps the probabilities (component on, within MC error)", Math.abs(s1.pA - s2.pB) < 0.04, s1.pA.toFixed(3) + " vs " + s2.pB.toFixed(3));
  let ex = true; try { E.explain(m); } catch (e) { ex = false; }
  check("explain() works with the component on", ex);
  // browser / Web Worker: build.py's engine tag (params3.js + styles_sos.js + engine3.js) with no module system
  const vm = require("vm");
  const rd = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");
  const mkCtx = () => { const c = { console, Math, Date, JSON, Float64Array, Int8Array, Object, Array, isFinite, Number, String, Error }; c.self = c; vm.createContext(c); return c; };
  // (the learned-rate module is not part of this concatenation, so these use the base tables)
  const ob = Object.assign({}, o, { ml: false, params: { components: { styles_sos: true } } });   // both sub-flags on
  const c1 = mkCtx(); vm.runInContext(rd("params3.js") + "\n" + rd("styles_sos.js") + "\n" + rd("engine3.js"), c1);
  const mw = c1.FightEngine.matchup(A, B, ob), mn = E.matchup(A, B, ob);
  check("worker-style concatenation with styles_sos.js reproduces Node (component on)", !!(mw.stylesSOS && mw.stylesSOS.styles) &&
    JSON.stringify(c1.FightEngine.simulate(mw, c1.FightEngine.makeRng(5), true)) === JSON.stringify(E.simulate(mn, E.makeRng(5), true)));
  const c2 = mkCtx(); vm.runInContext(rd("params3.js") + "\n" + rd("engine3.js"), c2);
  const mm = c2.FightEngine.matchup(A, B, ob);
  check("flag on without styles_sos.js loaded: plain tables, flagged as missing", !!(mm.stylesSOS && mm.stylesSOS.missing) &&
    JSON.stringify(c2.FightEngine.summarize(mm, 200, 3)) === JSON.stringify(E.summarize(E.matchup(A, B, Object.assign({}, ob, { params: OFFP })), 200, 3)));
}

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
