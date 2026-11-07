#!/usr/bin/env node
/* test_v9.js: engine v9 (docs/V6_V10_PLAN.md cycle 4) checks.
   1  flag-off identity: src engine with every v9 component off = versions/v4 (4.0.0) bit for bit (matchup tables, 300 seeded
      simulations, a traced fight) on train fights with the learned rates on, with them off, and on 5-round fights
   2  corner symmetry of the candidate: matchup(A, B) and matchup(B, A) are mirror images (rates, KD, judging, format, level)
   3  judgeWF: year rows (params = data/derived/v9/judge_wf.json byYear), later dates -> last row, earlier dates -> v4 weights,
      the 10-8 threshold mapping (r108 = lRef reproduces the fitted share), and no change to the league expectation
   4  levels: applyLevel scales both corners' targets, clips factors and accuracies, records m.level only when on
   5  format: kd5 / late5 act on 5-round fights only; conv on the conversion odds; stop on the doctor / corner hazards
   6  tools/v9_levels.js: a fight's factors use only fights dated strictly before it (perturbing later or same-day fights changes
      nothing), the first card gets 1, r108At is the month-start step function of eradrift.json
   7  params blocks match their fit files (judge_wf.json, format_fit.json, t108_map.json, levels_select.json -> levels off)
     node tests/test_v9.js [--json <out>]      (V9_DIR=<dir> picks the engine directory; default src/ while it is 9.0.0, else versions/v9) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
// the v9 engine: V9_DIR, else src/ while it holds 9.0.0, else the frozen candidate versions/v9 (src restored to v4 after the gate)
const V9_DIR = process.env.V9_DIR || (require(path.join(ROOT, "src/engine3.js")).VERSION === "9.0.0" ? "src" : "versions/v9");
const E9 = require(path.join(ROOT, V9_DIR, "engine3.js"));
const E4 = require(path.join(ROOT, "versions/v4/engine3.js"));
const LV = require(path.join(ROOT, "tools/v9_levels.js"));
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const results = [];
function check(name, ok, detail) { results.push({ name, ok: !!ok, detail: detail || "" }); console.log((ok ? "PASS " : "FAIL ") + name + (detail ? "  (" + detail + ")" : "")); }

const bt = readJSON("data/derived/backtest_dev.json");
const priors = readJSON("data/derived/mlcal_priors_asof.json");
const OOF = readJSON("data/derived/mlrates_oof_fh.json"), names = OOF.meta.targets;
const rates = (a) => { const o = {}; names.forEach((n, i) => { o[n] = a[i]; }); return o; };
const train = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");
for (const f of train) { f.A.keys = bt.meta.keys; f.B.keys = bt.meta.keys; }
const pick = train.filter((_, i) => i % 50 === 0).concat(train.filter((f) => f.rounds === 5).slice(0, 8));
const OFF = { components: { levels: false, judgeWF: false, format: false } };
function opts(f, o, extra) {
  const ent = OOF.fights[f.id];
  const x = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)],
    ml: ent ? { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } : false };
  return Object.assign(x, extra || {});
}
const TABLE_KEYS = ["dRate", "cRate", "gRate", "gBot", "tdD", "tdCC", "tdCU", "tdO", "tdOC", "kd", "gnp", "stko", "instO", "refO", "finR", "ctrlT", "up", "sw",
  "subO", "gillo", "upPos", "swPos", "gPos", "subTPos", "subBPos", "subOPos", "accO", "mixC", "occ", "drain", "pace", "k"];
function tables(m) { const o = {}; for (const k of TABLE_KEYS) o[k] = m[k] && m[k].length != null ? Array.from(m[k]) : m[k]; return JSON.stringify(o); }
function sims(E, m, seed, n) {
  const out = [];
  for (let i = 0; i < n; i++) { const s = E.simulate(m, E.makeRng(seed + i), false); out.push([s.winner, s.method, s.round, s.t, JSON.stringify(s.totals), s.n108]); }
  return JSON.stringify(out);
}

// ---------------------------------------------------------------- 1 flag-off identity
{
  let tab = 0, sim = 0, n = 0, noml = 0, five = 0;
  for (const f of pick) {
    for (let o = 0; o < 2; o++) {
      const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A;
      const m9 = E9.matchup(A, B, opts(f, o, { params: OFF })), m4 = E4.matchup(A, B, opts(f, o));
      n++;
      if (tables(m9) === tables(m4)) tab++;
      if (sims(E9, m9, 1000 + n, o === 0 ? 300 : 40) === sims(E4, m4, 1000 + n, o === 0 ? 300 : 40)) sim++;
      if (f.rounds === 5) five++;
      if (o === 0) {
        const a9 = E9.matchup(A, B, opts(f, o, { params: OFF, ml: false })), a4 = E4.matchup(A, B, opts(f, o, { ml: false }));
        if (tables(a9) === tables(a4) && sims(E9, a9, 7, 30) === sims(E4, a4, 7, 30)) noml++;
      }
    }
  }
  check("1a flag-off matchup tables = v4 (" + n + " matchups, " + five + " five-round)", tab === n, tab + "/" + n);
  check("1b flag-off simulations = v4 (300 / 40 seeded sims per matchup)", sim === n, sim + "/" + n);
  check("1c flag-off with the learned rates off = v4", noml === pick.length, noml + "/" + pick.length);
  const f = pick[3];
  const t9 = E9.simulate(E9.matchup(f.A, f.B, opts(f, 0, { params: OFF })), E9.makeRng(99), true);
  const t4 = E4.simulate(E4.matchup(f.A, f.B, opts(f, 0)), E4.makeRng(99), true);
  check("1d flag-off traced fight = v4 (the 3D show's trace)", JSON.stringify(t9) === JSON.stringify(t4));
  check("1e VERSION 9.0.0, params 9.0.0 label, v4 frozen 4.0.0", E9.VERSION === "9.0.0" && /^9\.0\.0/.test(E9.params().version) && E4.VERSION === "4.0.0");
}

// ---------------------------------------------------------------- 2 corner symmetry of the candidate
{
  const lvl = { att: 1.03, acc: 0.98, td: 1.05, ctrl: 0.97, kd: 1.02, r108: 4.1 };
  const ON = { components: { levels: true, judgeWF: true, format: true } };
  let ok = 0, n = 0;
  const pairs = [["dRate"], ["cRate"], ["gRate"], ["kd"], ["gnp"], ["stko"], ["tdO"], ["ctrlT"], ["subO"]];
  for (const f of pick.slice(0, 12)) {
    const mAB = E9.matchup(f.A, f.B, opts(f, 0, { params: ON, level: lvl })), mBA = E9.matchup(f.B, f.A, opts(f, 1, { params: ON, level: lvl }));
    n++;
    let good = Math.abs(mAB.instO - mBA.instO) < 1e-12 && Math.abs(mAB.refO - mBA.refO) < 1e-12 && JSON.stringify(mAB.finR) === JSON.stringify(mBA.finR) &&
      JSON.stringify(mAB.judgeWF) === JSON.stringify(mBA.judgeWF) && JSON.stringify(mAB.format) === JSON.stringify(mBA.format) && JSON.stringify(mAB.level) === JSON.stringify(mBA.level);
    for (const [k] of pairs) if (Math.abs(mAB[k][0] - mBA[k][1]) > 1e-9 * Math.max(1, Math.abs(mAB[k][0])) || Math.abs(mAB[k][1] - mBA[k][0]) > 1e-9 * Math.max(1, Math.abs(mAB[k][1]))) good = false;
    if (good) ok++;
  }
  check("2 candidate corner symmetry: matchup(A,B) mirrors matchup(B,A) (12 fights, every v9 component on)", ok === n, ok + "/" + n);
}

// ---------------------------------------------------------------- 3 judgeWF
{
  const P = E9.params(), jw = readJSON("data/derived/v9/judge_wf.json");
  const f = pick.find((x) => x.date.startsWith("2021"));
  const m = E9.matchup(f.A, f.B, opts(f, 0));
  const row = P.judgeWF.byYear["2021"];
  check("3a judgeWF uses the fight year's row (2021 -> fit on cards before 2021-01-01)", m.judgeWF && m.judgeWF.src === "byYear" && m.judgeWF.year === 2021 && m.p.judge.kd === row.kd && m.p.judge.head === row.head);
  const m27 = E9.matchup(f.A, f.B, Object.assign(opts(f, 0), { date: "2027-03-01" }));
  check("3b a date after the table uses the last row (2026)", m27.judgeWF.year === 2026 && m27.p.judge.kd === P.judgeWF.byYear["2026"].kd);
  const m15 = E9.matchup(f.A, f.B, Object.assign(opts(f, 0), { date: "2015-06-01" }));
  const v4j = E4.params().judge;
  check("3c a date before the table keeps the v4 weights", m15.judgeWF.src === "none" && m15.p.judge.kd === v4j.kd && m15.p.judge.head === v4j.head);
  const mr = E9.matchup(f.A, f.B, opts(f, 0, { level: { r108: P.judgeWF.r108.lRef } }));
  const want = (P.judgeWF.r108.alpha - Math.log(P.judgeWF.r108.sRef)) / P.judgeWF.r108.beta;
  check("3d r108 = lRef gives t108 = (alpha - ln sRef) / beta", Math.abs(mr.p.judge.t108 - want) < 1e-12, mr.p.judge.t108.toFixed(4));
  const mlo = E9.matchup(f.A, f.B, opts(f, 0, { level: { r108: P.judgeWF.r108.lRef / 2 } }));
  check("3e a lower tracked 10-8 level raises the threshold", mlo.p.judge.t108 > mr.p.judge.t108);
  check("3f params.judgeWF.byYear = judge_wf.json byYear", JSON.stringify(P.judgeWF.byYear) === JSON.stringify(jw.byYear));
  const off = E9.matchup(f.A, f.B, opts(f, 0, { params: OFF }));
  check("3g judgeWF leaves the rate tables (and the learned-rate league expectation) unchanged",
    JSON.stringify(off.dRate) === JSON.stringify(E9.matchup(f.A, f.B, opts(f, 0, { params: { components: { levels: false, judgeWF: true, format: false } } })).dRate));
  check("3h judgeWF does not leak into the parameter defaults", E9.params().judge.kd === v4j.kd);
}

// ---------------------------------------------------------------- 4 levels
{
  const pred = { A: { d_att: 5, c_att: 1, g_att: 1, h_att: 4, b_att: 1, l_att: 1, acc_h: 0.4, acc_b: 0.97, acc_l: 0.8, acc_d: 0.4, acc_c: 0.7, acc_g: 0.7, td_att: 0.2, ctrl: 10, kd_h: 0.01, sub_att: 0.03 },
    B: { d_att: 6, c_att: 1, g_att: 1, h_att: 5, b_att: 1, l_att: 1, acc_h: 0.35, acc_b: 0.6, acc_l: 0.8, acc_d: 0.35, acc_c: 0.7, acc_g: 0.7, td_att: 0.3, ctrl: 12, kd_h: 0.009, sub_att: 0.02 }, base: null };
  const r = E9.applyLevel(pred, { att: 1.1, acc: 1.05, td: 2, ctrl: 0.5, kd: 1.2 });
  check("4a applyLevel scales both corners", Math.abs(r.pred.A.d_att - 5.5) < 1e-12 && Math.abs(r.pred.B.h_att - 5.5) < 1e-12 && Math.abs(r.pred.A.kd_h - 0.012) < 1e-15 && r.pred.B.sub_att === 0.02);
  check("4b factors clipped to [0.7, 1.4], accuracies capped at 0.98", r.g.td === 1.4 && r.g.ctrl === 0.7 && Math.abs(r.pred.A.td_att - 0.28) < 1e-12 && r.pred.A.acc_b === 0.98);
  check("4c the caller's object is untouched", pred.A.d_att === 5 && pred.A.acc_b === 0.97);
  const f = pick[5];
  const on = E9.matchup(f.A, f.B, opts(f, 0, { params: { components: { levels: true } }, level: { att: 1.05 } }));
  const off = E9.matchup(f.A, f.B, opts(f, 0, { level: { att: 1.05 } }));
  check("4d m.level only when components.levels is on (candidate default: off)", on.level && on.level.applied && on.level.g.att === 1.05 && !off.level && E9.params().components.levels === false);
  check("4e levels on raises the learned attempt targets", on.ml.targets[0].d_att > off.ml.targets[0].d_att * 1.04);
}

// ---------------------------------------------------------------- 5 format
{
  const P = E9.params().format;
  const f5 = pick.find((x) => x.rounds === 5), f3 = pick.find((x) => x.rounds === 3);
  const FMT = { components: { levels: false, judgeWF: false, format: true } };
  const a5 = E9.matchupBase(f5.A, f5.B, opts(f5, 0, { params: FMT })), b5 = E9.matchupBase(f5.A, f5.B, opts(f5, 0, { params: OFF }));
  const a3 = E9.matchupBase(f3.A, f3.B, opts(f3, 0, { params: FMT })), b3 = E9.matchupBase(f3.A, f3.B, opts(f3, 0, { params: OFF }));
  check("5a kd5 on 5-round knockdown hazards only", Math.abs(a5.kd[0] / b5.kd[0] - P.kd5) < 1e-12 && Math.abs(a3.kd[0] / b3.kd[0] - 1) < 1e-12);
  check("5b late5 on rounds 4-5 of 5-round fights only", Math.abs(a5.finR[3] / b5.finR[3] - P.late5) < 1e-12 && Math.abs(a5.finR[2] / b5.finR[2] - 1) < 1e-12 && JSON.stringify(a3.finR) === JSON.stringify(b3.finR));
  check("5c conv on the conversion odds, every format", Math.abs(a3.instO / b3.instO - P.conv) < 1e-12 && Math.abs(a5.refO / b5.refO - P.conv) < 1e-12);
  check("5d stop on the doctor / corner hazards, both formats", Math.abs(a3.k.doc / b3.k.doc - P.stop) < 1e-12 && Math.abs(a5.k.corner / b5.k.corner - P.stop) < 1e-12);
  // learned-rate path: kd5 survives the adapter's KD re-target (the league expectation carries it)
  const L5 = E9.matchup(f5.A, f5.B, opts(f5, 0, { params: FMT })), L5o = E9.matchup(f5.A, f5.B, opts(f5, 0, { params: OFF }));
  check("5e with the learned rates on, the 5-round KD factor survives the re-target", Math.abs(L5.kd[0] / L5o.kd[0] - P.kd5) < 1e-6, (L5.kd[0] / L5o.kd[0]).toFixed(6));
}

// ---------------------------------------------------------------- 6 tools/v9_levels.js
{
  const fights = train.slice(0, 400);
  const ref = new Map(fights.map((f, i) => [f.id, { st: [40, 90, 30, 6, 4, 0.3, 1, 3, 100, 0.3, 42, 92, 31, 6, 4, 0.31, 1, 2.8, 95, 0.25].map((x) => x * (1 + 0.01 * (i % 7))), mins: 11 }]));
  const L1 = LV.computeLevels(fights, ref, { phi: { att: 20, acc: 3, td: 3, ctrl: 150, kd: 1.2 } });
  const tgt = fights[250];
  const later = fights.map((f) => (f.date >= tgt.date ? Object.assign({}, f, { actual: { A: Object.assign({}, f.actual.A, { sig_att: 999, sig_lnd: 500, ctrl: 900, td_att: 30, kd: 5 }), B: f.actual.B, minutes: f.actual.minutes } }) : f));
  const L2 = LV.computeLevels(later, ref, { phi: { att: 20, acc: 3, td: 3, ctrl: 150, kd: 1.2 } });
  check("6a factors use only fights dated strictly before (same-day and later perturbations change nothing)", JSON.stringify(L1.byId[tgt.id]) === JSON.stringify(L2.byId[tgt.id]));
  const after = fights.find((f) => f.date > tgt.date);
  check("6b ... and they do move the factors of later cards", JSON.stringify(L1.byId[after.id]) !== JSON.stringify(L2.byId[after.id]));
  const g0 = L1.byId[fights[0].id];
  check("6c the first card gets 1", LV.KEYS.every((k) => g0[k] === 1));
  const ER = readJSON("data/derived/eradrift.json");
  const i = ER.meta.months.indexOf("2022-07-01");
  check("6d r108At = eradrift r108 month-start level", LV.r108At("2022-07-19") === ER.levels.r108.league[i] && LV.r108At("2022-07-01") === ER.levels.r108.league[i]);
}

// ---------------------------------------------------------------- 7 params vs fit files
{
  const P = E9.params(), fm = readJSON("data/derived/v9/format_fit.json").final, tm = readJSON("data/derived/v9/t108_map.json"), sel = readJSON("data/derived/v9/levels_select.json");
  const r3 = (x) => Math.round(x * 1000) / 1000;
  check("7a params.format = format_fit.json final (3 dp)", P.format.kd5 === r3(fm.kd5) && P.format.late5 === r3(fm.late5) && P.format.conv === r3(fm.conv) && P.format.stop === r3(fm.stop));
  check("7b params.judgeWF.r108 = t108_map.json", P.judgeWF.r108.alpha === tm.alpha && P.judgeWF.r108.beta === tm.beta && P.judgeWF.r108.lRef === tm.lRef && P.judgeWF.r108.sRef === tm.sRef);
  check("7c components.levels off because the 2019-2020 choice kept no tracker", sel.keep.length === 0 && P.components.levels === false);
  check("7d candidate defaults: judgeWF and format on", P.components.judgeWF === true && P.components.format === true);
}

const nf = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - nf}/${results.length} checks pass (engine ${V9_DIR})`);
const ji = process.argv.indexOf("--json");
if (ji > 0) fs.writeFileSync(path.resolve(ROOT, process.argv[ji + 1]), JSON.stringify({ tool: "tests/test_v9.js", built: new Date().toISOString(), pass: nf === 0, checks: results }, null, 1));
process.exit(nf ? 1 : 0);
