// Engine tests (v4; the file keeps its v3 name): spec invariants, the learned stat-line layer (loadMLRates, opts.ml,
// determinism, corner symmetry), the judges (EM weights, shared / fight-level noise, 10-8 rule), league-average
// base-rate self-calibration per division, Volk vs Gaethje summary and explain(), speed.
//
// Usage:
//   node tests/test_engine3.js [N]            run everything (N fights per Monte Carlo check, default 20000)
//   node tests/test_engine3.js [N] --quick    invariants + Volk vs Gaethje only (no division table)
//   node tests/test_engine3.js [N] --fit      self-calibrate the global scales (Lightweight) and the per-division
//                                             factors to the division base rates, print the values
//   node tests/test_engine3.js [N] --fit --write   same, and rewrite the [selfcal] values in src/params3.js
//   --priors <file>   league priors for the base-rate targets and the shrinkage (default data/derived/priors_dev.json,
//                     the train-only priors v4 is calibrated against; fighters.json priors, all years, if it is missing). Engine v4 self-calibration: --priors data/derived/priors_dev.json (fights before
//                     2024-01-01 only, tools/build_db.py --priors-until 2024-01-01; hidden-data protocol). The judges'
//                     noise and 10-8 rule are not touched here (tools/judgecal.js fits them to real judges' rounds).
//   v5 merge step 1: the KO/TKO composition targets of --fit follow params.components.v401.koTargets (on: params.v401.koTargets,
//                     2019-2023 fights; off: v4's 28 / 12.5 / 7%); the fit runs with the koComp factors off, so after
//                     --fit --write with the sub-flag on set params.v401.koComp to 1 (the fitted values then carry item e).
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
const ENGINE_SRC = path.join(ROOT, "src/engine3.js"), PARAMS_SRC = path.join(ROOT, "src/params3.js");
const E = require(ENGINE_SRC);
const BASE = require(PARAMS_SRC);
const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
const DB = E.loadDB(dbJson);
// learned stat-line model (engine v4): loaded only inside withML(), so every other check runs on the base tables
const ML_SRC = path.join(ROOT, "src/ml/mlrates.js");
const MLR = require(ML_SRC);
const mlJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlrates.json"), "utf8"));
const ML_MODEL = MLR.load(mlJson);
function withML(fn) { E.loadMLRates(ML_MODEL); try { return fn(); } finally { E.loadMLRates(null); } }

const args = process.argv.slice(2);
const N = +(args.find((a) => /^\d+$/.test(a)) || 20000);
// v4 is self-calibrated against the train-only priors, so the base-rate tables check against them by default
const PRIORS_FILE = args.indexOf("--priors") >= 0 ? args[args.indexOf("--priors") + 1] :
  (fs.existsSync(path.join(ROOT, "data/derived/priors_dev.json")) ? "data/derived/priors_dev.json" : null);
const PRI = PRIORS_FILE ? JSON.parse(fs.readFileSync(path.isAbsolute(PRIORS_FILE) ? PRIORS_FILE : path.join(ROOT, PRIORS_FILE), "utf8")).priors : DB.priors;
const FIT = args.includes("--fit"), WRITE = args.includes("--write"), QUICK = args.includes("--quick");
const DATE = "2026-11-06";

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const pct = (x, d = 1) => (100 * x).toFixed(d);
const f2 = (x, d = 2) => (x == null || !isFinite(x) ? "-" : (+x).toFixed(d));
const sum = (a) => a.reduce((x, y) => x + y, 0);

// ---------------------------------------------------------------- synthetic league-average fighter
function avgProfile(div, tag) {
  const P = PRI[div], S = {};
  for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;   // 400 fight-minutes of exactly league-average fighting
  return { name: `${tag || "Average"} ${div}`, division: div, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}

// ---------------------------------------------------------------- base-rate targets from the division priors (2018+)
function targets(div, nR) {
  const P = PRI[div];
  const fin = nR === 5 ? P.fin5 : P.fin3, dec = nR === 5 ? P.dec5 : P.dec3;
  const ko = sum(fin.KO), sub = sum(fin.SUB), d = fin.DEC + fin.DRAW, tot = ko + sub + d;  // renormalized without DQ/NC/other
  const lnd = P.d_lnd + P.c_lnd + P.g_lnd, att = P.d_att + P.c_att + P.g_att;
  return {
    n: fin.n, fin: (ko + sub) / tot, ko: ko / tot, sub: sub / tot,
    koR: fin.KO.map((x) => x / tot), subR: fin.SUB.map((x) => x / tot), dec,
    sigL15: 15 * lnd, sigA15: 15 * att, acc: lnd / att,
    hL15: 15 * P.h_lnd, hA15: 15 * P.h_att, bL15: 15 * P.b_lnd, bA15: 15 * P.b_att, lL15: 15 * P.l_lnd, lA15: 15 * P.l_att,
    dL15: 15 * P.d_lnd, dA15: 15 * P.d_att, cL15: 15 * P.c_lnd, cA15: 15 * P.c_att, gL15: 15 * P.g_lnd, gA15: 15 * P.g_att,
    kd100: 100 * P.kd_per_h, kd15: P.kd15, td15: P.td15, tdA15: 15 * P.td_att, tdAcc: P.td_acc, ctrl15: P.ctrl15, sub15: P.sub15,
    kdFin: P.kd_fin, subConv: P.sub_conv
  };
}

// ---------------------------------------------------------------- simulate a league-average pair
function simAvg(div, nR, params, n, seed) {
  const m = E.matchup(avgProfile(div, "A"), avgProfile(div, "B"), { division: div, rounds: nR, title: nR === 5, params, priors: PRI, ml: false });
  const s = E.summarize(m, n, seed);
  const a = s.avg.A, b = s.avg.B, p15 = (k) => (a.per15[k] + b.per15[k]) / 2;
  const out = {
    m, s, fin: s.fins, ko: sum(s.finKO), sub: sum(s.finSUB), koR: s.finKO, subR: s.finSUB, dec: s.dec, r108: s.r108,
    sigL15: p15("sig_lnd"), sigA15: p15("sig_att"), acc: (a.sig_lnd + b.sig_lnd) / (a.sig_att + b.sig_att),
    hL15: p15("h_lnd"), hA15: p15("h_att"), bL15: p15("b_lnd"), bA15: p15("b_att"), lL15: p15("l_lnd"), lA15: p15("l_att"),
    dL15: p15("d_lnd"), dA15: p15("d_att"), cL15: p15("c_lnd"), cA15: p15("c_att"), gL15: p15("g_lnd"), gA15: p15("g_att"),
    kd100: 100 * (a.kd + b.kd) / (a.h_lnd + b.h_lnd), kd100s: 100 * (a.kd + b.kd) / (a.sh_lnd + b.sh_lnd), kd15: s.kd15,
    td15: p15("td_lnd"), tdA15: p15("td_att"), tdAcc: (a.td_lnd + b.td_lnd) / Math.max(1e-9, a.td_att + b.td_att),
    ctrl15: s.ctrl15, sub15: p15("sub_att"), subConv: sum(s.finSUB) / Math.max(1e-9, (a.sub_att + b.sub_att)),
    koLoc: s.koLoc, subNames: s.subNames, avgMin: s.avgMin
  };
  const kk = s.koKind, kt = Math.max(1, kk.KO + kk.TKO_followup + kk.TKO_standing + kk.GNP + kk.LEG);
  const kl = s.koLoc, klt = Math.max(1, kl.dist + kl.clinch + kl.ground);
  out.kdFin = s.kdFin; out.kdRounds = s.kdRounds; out.koKind = kk;
  out.gShare = kl.ground / klt; out.cShare = kl.clinch / klt; out.stShare = kk.TKO_standing / kt;
  return out;
}

// ---------------------------------------------------------------- tolerances (task contract)
const TOL = [
  ["finish rate", "fin", "abs", 0.03], ["KO/TKO share", "ko", "abs", 0.03], ["SUB share", "sub", "abs", 0.03],
  // v4: kdScale is matched on real 2019-2023 fights with the learned rates on (tools/v4_levels.js), about 12% above the
  // league-average self-calibration, so league-average pairs run ~10-15% high on knockdowns per landed head strike
  ["KD per 100 head landed", "kd100", "rel", 0.2], ["sig landed per 15", "sigL15", "rel", 0.08], ["control s per 15", "ctrl15", "rel", 0.15]
];
function within(sim, tgt, kind, tol) { return kind === "abs" ? Math.abs(sim - tgt) <= tol : Math.abs(sim / tgt - 1) <= tol; }

function divTable(div, n) {
  const T3 = targets(div, 3), S3 = simAvg(div, 3, null, n, 101);
  const T5 = targets(div, 5), S5 = simAvg(div, 5, null, Math.round(n / 2), 202);
  const all5 = targets("ALL", 5);
  console.log(`\n--- ${div} (${PRI[div].lbs || "?"} lb): league-average vs league-average, ${n} 3-round fights (data: ${PRIORS_FILE || "fighters.json priors"}, n=${T3.n}) ---`);
  console.log("metric".padEnd(30) + "sim".padStart(9) + "data".padStart(9) + "   tolerance");
  let ok = true;
  const row = (label, sim, tgt, scale, d, tolTxt, good) => {
    console.log(label.padEnd(30) + (scale === "%" ? pct(sim) : f2(sim, d)).padStart(9) + (tgt == null ? "" : (scale === "%" ? pct(tgt) : f2(tgt, d))).padStart(9) +
      (tolTxt ? "   " + tolTxt + (good === undefined ? "" : (good ? "  ok" : "  MISS")) : ""));
  };
  for (const [label, key, kind, tol] of TOL) {
    const good = within(S3[key], T3[key], kind, tol);
    if (!good) ok = false;
    row(label, S3[key], T3[key], kind === "abs" ? "%" : "", key === "kd100" ? 3 : 1, kind === "abs" ? `+/-${pct(tol, 0)} pts` : `+/-${pct(tol, 0)}%`, good);
  }
  row("decision share", 1 - S3.fin, 1 - T3.fin, "%");
  row("KO by round (share of fights)", 0, null, "", 0, S3.koR.map((x) => pct(x)).join(" / ") + "  vs data " + T3.koR.map((x) => pct(x)).join(" / "));
  row("SUB by round", 0, null, "", 0, S3.subR.map((x) => pct(x)).join(" / ") + "  vs data " + T3.subR.map((x) => pct(x)).join(" / "));
  const cond = (arr) => { let reach = 1; return arr.map((x) => { const c = x / reach; reach -= x; return c; }); };
  const simH = cond(S3.koR.map((x, i) => x + S3.subR[i])), datH = cond(T3.koR.map((x, i) => x + T3.subR[i]));
  row("finish hazard per round reached", 0, null, "", 0, simH.map((x) => pct(x)).join(" / ") + "  vs data " + datH.map((x) => pct(x)).join(" / "));
  row("sig attempted per 15", S3.sigA15, T3.sigA15, "", 1, "info");
  row("sig accuracy", S3.acc, T3.acc, "%");
  row("head landed / att per 15", S3.hL15, T3.hL15, "", 1, `${f2(S3.hA15, 1)} att vs ${f2(T3.hA15, 1)}; acc ${pct(S3.hL15 / S3.hA15)}% vs ${pct(T3.hL15 / T3.hA15)}%`);
  row("body landed / att per 15", S3.bL15, T3.bL15, "", 1, `${f2(S3.bA15, 1)} att vs ${f2(T3.bA15, 1)}; acc ${pct(S3.bL15 / S3.bA15)}% vs ${pct(T3.bL15 / T3.bA15)}%`);
  row("leg landed / att per 15", S3.lL15, T3.lL15, "", 1, `${f2(S3.lA15, 1)} att vs ${f2(T3.lA15, 1)}; acc ${pct(S3.lL15 / S3.lA15)}% vs ${pct(T3.lL15 / T3.lA15)}%`);
  row("distance landed / att per 15", S3.dL15, T3.dL15, "", 1, `${f2(S3.dA15, 1)} att vs ${f2(T3.dA15, 1)}; acc ${pct(S3.dL15 / S3.dA15)}% vs ${pct(T3.dL15 / T3.dA15)}%`);
  row("clinch landed / att per 15", S3.cL15, T3.cL15, "", 1, `${f2(S3.cA15, 1)} att vs ${f2(T3.cA15, 1)}; acc ${pct(S3.cL15 / S3.cA15)}% vs ${pct(T3.cL15 / T3.cA15)}%`);
  row("ground landed / att per 15", S3.gL15, T3.gL15, "", 1, `${f2(S3.gA15, 1)} att vs ${f2(T3.gA15, 1)}; acc ${pct(S3.gL15 / S3.gA15)}% vs ${pct(T3.gL15 / T3.gA15)}%`);
  row("KD per 15", S3.kd15, T3.kd15, "", 3, `KD per 100 standing head ${f2(S3.kd100s, 3)}`);
  row("P(finish same round | KD)", S3.kdFin, T3.kdFin, "%", 0, `${S3.kdRounds} one-sided KD rounds (data: priors kd_fin)`);
  row("TD landed per 15", S3.td15, T3.td15, "", 2, `attempts ${f2(S3.tdA15)} vs ${f2(T3.tdA15)}`);
  row("TD accuracy", S3.tdAcc, T3.tdAcc, "%");
  row("sub attempts per 15", S3.sub15, T3.sub15, "", 3, `conversion ${pct(S3.subConv)}% vs ${pct(T3.subConv)}%`);
  row("decision UD / SD / MD", S3.dec.UD, T3.dec.UD, "%", 0, `SD ${pct(S3.dec.SD)} vs ${pct(T3.dec.SD)}, MD ${pct(S3.dec.MD)} vs ${pct(T3.dec.MD)}, draws ${pct(S3.dec.DRAW)}% of decisions (data ~1.7%)`);
  row("10-8 per judge-round", S3.r108, 0.0469, "%", 0, "data 4.7% 2015+, ~2.5% 2024-25");
  const kl = S3.koLoc, kt = kl.dist + kl.clinch + kl.ground + kl["between rounds"], kk = S3.koKind, kkt = sum(Object.values(kk));
  row("KO/TKO location", 0, null, "", 0, `distance ${pct(kl.dist / kt)}% clinch ${pct(kl.clinch / kt)}% ground ${pct(kl.ground / kt)}% between rounds ${pct(kl["between rounds"] / kt)}%  (data all 60 / 12 / 28 of strike stoppages; doctor+corner ~2% of KO/TKOs)`);
  row("KO/TKO kinds", 0, null, "", 0, Object.entries(kk).map(([k, v]) => `${k} ${pct(v / Math.max(1, kkt))}%`).join(", "));
  const sn = Object.entries(S3.subNames).sort((x, y) => y[1] - x[1]).slice(0, 4), st = sum(Object.values(S3.subNames));
  row("submission types", 0, null, "", 0, sn.map(([k, v]) => `${k} ${pct(v / st, 0)}%`).join(", ") + "  (data RNC 44%, guillotine 17%, armbar 10%, arm triangle 10%)");
  // 5-round target: pooled 5-round hazards by round (baserates, n=571) scaled by this division's 3-round finish rate vs the
  // pooled 3-round finish rate (division 5-round samples are 20-60 fights)
  const H5ALL = [0.208, 0.204, 0.172, 0.108, 0.109], k5 = T3.fin / targets("ALL", 3).fin;
  const h5t = H5ALL.map((h) => Math.min(0.9, h * k5)), fin5t = 1 - h5t.reduce((acc, h) => acc * (1 - h), 1);
  const h5 = cond(S5.koR.map((x, i) => x + S5.subR[i]));
  row("5 rounds: finish rate", S5.fin, fin5t, "%", 0, `+/-6 pts (info)${Math.abs(S5.fin - fin5t) <= 0.06 ? "  ok" : "  MISS"}; KO ${pct(S5.ko)}, SUB ${pct(S5.sub)}; own 5-rd data ${pct(T5.fin)}% (n=${T5.n}); pooled 5-rd ${pct(all5.fin)}%`);
  row("5 rounds: hazard per round", 0, null, "", 0, h5.map((x) => pct(x)).join(" / ") + "  vs target " + h5t.map((x) => pct(x)).join(" / "));
  check(`${div}: base rates within tolerance (finish, KO, SUB, KD/100, landed/15, ctrl/15)`, ok);
  return { div, ok, S3, T3 };
}

// ---------------------------------------------------------------- self-calibration (--fit)
function writeParams(vals, div) {
  let src = fs.readFileSync(PARAMS_SRC, "utf8");
  for (const [k, v] of Object.entries(vals)) {
    const re = new RegExp("^(\\s*)" + k + ":\\s*[-0-9.eE/ ]+?(,?)(\\s*//)", "m");
    if (!re.test(src)) { console.log("  (could not find " + k + " in params3.js)"); continue; }
    src = src.replace(re, (all, ind, comma, cm) => `${ind}${k}: ${+(+v).toPrecision(4)}${comma}${cm}`);
  }
  if (div) {
    const body = Object.entries(div).map(([d, o]) => `      ${JSON.stringify(d)}: { ${Object.entries(o).map(([k, v]) => `${k}: ${+v.toFixed(3)}`).join(", ")} }`).join(",\n");
    src = src.replace(/(\n    div: )[\s\S]*?(\n  \};)/, `$1{\n${body}\n    }$2`);
  }
  fs.writeFileSync(PARAMS_SRC, src);
}

function selfCalibrate(n) {
  const P0 = JSON.parse(JSON.stringify(BASE));
  const g = {
    strikeScale: P0.strikeScale, accScale: P0.accScale, groundScale: P0.groundScale, clinchScale: P0.clinchScale, kdScale: P0.kdScale,
    tdScale: P0.tdScale, tdOddsScale: P0.tdOddsScale, subAttScale: P0.subAttScale, subConvScale: P0.subConvScale,
    kdInstant: P0.kdInstant, kdRefStop: P0.kdRefStop, gnpTko: P0.gnpTko, stko: P0.stko, kdClinch: P0.kdPos[1]
  };
  const ref = "Lightweight", T = targets(ref, 3);
  // KO/TKO composition targets. v4 (baserates_tables.md, strike stoppages, all years 2015..2026-10): ground 28%, clinch 12.5%;
  // standing stoppages without a knockdown ~7% (0.049 vs 0.509 per 100 standing head landed at LW, x ~72% standing share).
  // v5 step 1, components.v401.koTargets on: params.v401.koTargets from 2019-2023 fights (tools/ko_composition.py). The fit
  // runs with the sub-flag's koComp factors off (they would otherwise multiply the levers being fit).
  const KOT = E.v401Flags(E.resolveParams()).koTargets && BASE.v401 && BASE.v401.koTargets;
  const TG = KOT ? { ground: KOT.ground, clinch: KOT.clinch, standNoKd: KOT.standNoKd } : { ground: 0.28, clinch: 0.125, standNoKd: 0.07 };
  if (KOT) console.log(`KO/TKO composition targets (components.v401.koTargets): ${JSON.stringify(TG)}; after --write set params.v401.koComp to 1`);
  const dmp = (x, e) => Math.pow(x, e === undefined ? 0.8 : e);
  const oddsR = (t, s2) => (t / (1 - t)) / (s2 / (1 - s2));
  const asParams = (gv, divv) => ({ strikeScale: gv.strikeScale, accScale: gv.accScale, groundScale: gv.groundScale, clinchScale: gv.clinchScale,
    kdScale: gv.kdScale, tdScale: gv.tdScale, tdOddsScale: gv.tdOddsScale, subAttScale: gv.subAttScale, subConvScale: gv.subConvScale,
    kdInstant: gv.kdInstant, kdRefStop: gv.kdRefStop, gnpTko: gv.gnpTko, stko: gv.stko, kdPos: [1, gv.kdClinch], div: divv || {},
    components: { v401: { koTargets: false } } });
  console.log(`\n=== Self-calibration: global scales on ${ref} (3 rounds), ${n} fights per iteration; priors ${PRIORS_FILE || "fighters.json (all years)"} ===`);
  for (let it = 0; it < 10; it++) {
    const S = simAvg(ref, 3, asParams(g), n, 1000 + it);
    console.log(`it ${it}: fin ${pct(S.fin)} (${pct(T.fin)}) KO ${pct(S.ko)} (${pct(T.ko)}) SUB ${pct(S.sub)} (${pct(T.sub)}) kdFin ${pct(S.kdFin)} (${pct(T.kdFin)}) ` +
      `gr ${pct(S.gShare)} cl ${pct(S.cShare)} stNoKd ${pct(S.stShare)} sigA ${f2(S.sigA15, 1)} (${f2(T.sigA15, 1)}) acc ${pct(S.acc)} (${pct(T.acc)}) ` +
      `kd100 ${f2(S.kd100, 3)} (${f2(T.kd100, 3)}) tdA ${f2(S.tdA15)} (${f2(T.tdA15)}) tdAcc ${pct(S.tdAcc)} (${pct(T.tdAcc)}) ` +
      `sub15 ${f2(S.sub15, 3)} (${f2(T.sub15, 3)}) ctrl ${f2(S.ctrl15, 0)} (${f2(T.ctrl15, 0)}) SD ${pct(S.dec.SD)} (${pct(T.dec.SD)}) 10-8 ${pct(S.r108, 2)}`);
    g.strikeScale *= dmp(T.dA15 / S.dA15);
    g.groundScale *= dmp((T.gA15 / S.gA15) / (T.dA15 / S.dA15));
    g.clinchScale *= dmp((T.cA15 / S.cA15) / (T.dA15 / S.dA15));
    g.accScale *= dmp(oddsR(T.acc, S.acc));
    g.kdScale *= dmp(T.kd100 / S.kd100);
    g.tdScale *= dmp(T.tdA15 / S.tdA15);
    g.tdOddsScale *= dmp(oddsR(T.tdAcc, S.tdAcc));
    g.subAttScale *= dmp(T.sub15 / S.sub15);
    g.subConvScale *= dmp(oddsR(T.sub, S.sub) / (T.sub15 / S.sub15), 1.0);
    const kf = dmp(oddsR(T.kdFin, S.kdFin), 1.0);
    g.kdInstant = E.prob(E.odds(g.kdInstant) * kf); g.kdRefStop = E.prob(E.odds(g.kdRefStop) * kf);
    g.gnpTko *= dmp(oddsR(TG.ground, Math.max(0.005, S.gShare)), 0.9);
    g.kdClinch *= dmp(oddsR(TG.clinch, Math.max(0.005, S.cShare)), 0.8);
    g.stko *= dmp(oddsR(TG.standNoKd, Math.max(0.003, S.stShare)), 0.8);
  }
  console.log("global:", JSON.stringify(g));
  const divs = Object.keys(PRI).filter((d) => !["ALL", "Catch Weight", "Open Weight"].includes(d));
  const divF = {};
  console.log(`\n=== Self-calibration: per-division factors (3 rounds), ${n} fights per iteration ===`);
  for (const d of divs) {
    const Td = targets(d, 3);
    const f = { att: 1, kd: 1, ko: 1, sub: 1, ctrl: 1, td: 1 };
    let S = null;
    for (let it = 0; it < 6; it++) {
      const dv = {}; dv[d] = f;
      S = simAvg(d, 3, asParams(g, dv), n, 3000 + it);
      f.att *= dmp(Td.sigL15 / S.sigL15);
      f.kd *= dmp(Td.kd100 / S.kd100);
      f.ko *= dmp(oddsR(Td.ko, S.ko), 1.1);
      f.sub *= dmp(oddsR(Td.sub, S.sub), 1.0);
      f.ctrl *= dmp(Td.ctrl15 / S.ctrl15);
      f.td *= dmp(Td.tdA15 / S.tdA15);
    }
    for (const k in f) f[k] = +f[k].toFixed(3);
    divF[d] = f;
    console.log(`${d.padEnd(22)} ${JSON.stringify(f)}  last: fin ${pct(S.fin)} (${pct(Td.fin)}) KO ${pct(S.ko)} (${pct(Td.ko)}) SUB ${pct(S.sub)} (${pct(Td.sub)}) kdFin ${pct(S.kdFin)} (${pct(Td.kdFin)}) sigL ${f2(S.sigL15, 1)} (${f2(Td.sigL15, 1)}) kd100 ${f2(S.kd100, 3)} (${f2(Td.kd100, 3)}) ctrl ${f2(S.ctrl15, 0)} (${f2(Td.ctrl15, 0)})`);
  }
  if (WRITE) {
    let src = fs.readFileSync(PARAMS_SRC, "utf8");
    src = src.replace(/kdPos: \[[^\]]*\]/, `kdPos: [1.0, ${+g.kdClinch.toPrecision(4)}]`);
    fs.writeFileSync(PARAMS_SRC, src);
    writeParams({ strikeScale: g.strikeScale, accScale: g.accScale, groundScale: g.groundScale, clinchScale: g.clinchScale, kdScale: g.kdScale,
      tdScale: g.tdScale, tdOddsScale: g.tdOddsScale, subAttScale: g.subAttScale, subConvScale: g.subConvScale, kdInstant: g.kdInstant, kdRefStop: g.kdRefStop,
      gnpTko: g.gnpTko, stko: g.stko }, divF);
    console.log("\nwrote src/params3.js");
  }
}

// ================================================================= main
console.log(`Fight engine ${E.VERSION}, params ${BASE.version}; ${Object.keys(DB.fighters).length} fighters; N = ${N}`);
if (FIT) { selfCalibrate(N); process.exit(0); }

const VG_OPTS = { division: "Lightweight", rounds: 5, title: true, date: DATE };
const mVG = E.matchup("alexander-volkanovski", "justin-gaethje", VG_OPTS);
const strip = (f) => JSON.stringify({ w: f.winner, m: f.method, d: f.detail, r: f.round, t: f.t, c: f.cards, tot: f.totals, form: f.form, n108: f.n108 });

console.log("\n=== API and determinism ===");
check("API surface", ["loadDB", "profile", "matchup", "matchupBase", "simulate", "bucket", "makeRng", "summarize", "explain", "manualProfile",
  "loadMLRates", "mlModel", "judgeRound", "deductions", "resolveParams", "v401Flags"].every((k) => typeof E[k] === "function") && /^5\.0\.0/.test(E.VERSION), "VERSION " + E.VERSION);
check("no learned model loaded by default: matchup = base tables", !E.mlModel() && mVG.mlApplied === false);
check("engine source has no Math.random", !/Math\.random/.test(fs.readFileSync(ENGINE_SRC, "utf8")));
{
  const saved = Math.random; Math.random = () => { throw new Error("Math.random used"); };
  let ok = true; try { E.simulate(mVG, E.makeRng(3), true); E.summarize(mVG, 200, 3); } catch (e) { ok = false; }
  Math.random = saved;
  check("engine runs with Math.random disabled", ok);
}
check("same seed, same fight", strip(E.simulate(mVG, E.makeRng(42), false)) === strip(E.simulate(mVG, E.makeRng(42), false)));
{
  const s1 = E.summarize(mVG, 2000, 9), s2 = E.summarize(mVG, 2000, 9);
  check("same seed, same summary", JSON.stringify(s1.bins) === JSON.stringify(s2.bins) && s1.avg.A.sig_lnd === s2.avg.A.sig_lnd);
}
{
  let ok = true, bad = -1;
  for (let sd = 1; sd <= 400; sd++) {
    const a = E.simulate(mVG, E.makeRng(sd), false), b = E.simulate(mVG, E.makeRng(sd), true);
    if (strip(a) !== strip(b)) { ok = false; bad = sd; break; }
  }
  check("trace on/off gives the same fight (400 seeds)", ok, ok ? "" : "first mismatch at seed " + bad);
}
{
  // a rng stream shared across fights must also stay in step with trace on/off
  const r1 = E.makeRng(77), r2 = E.makeRng(77); let ok = true;
  for (let i = 0; i < 200; i++) if (strip(E.simulate(mVG, r1, i % 2 === 0)) !== strip(E.simulate(mVG, r2, false))) { ok = false; break; }
  check("trace parity holds over a shared rng stream", ok);
}
{
  // browser / blob Web Worker: the page's engine script (params3.js + src/ml/mlrates.js + engine3.js) runs with no module
  // system; without a model it reproduces Node, and loadMLRates() inside it reproduces Node's learned-rate matchup
  const src = fs.readFileSync(PARAMS_SRC, "utf8") + "\n" + fs.readFileSync(ML_SRC, "utf8") + "\n" + fs.readFileSync(ENGINE_SRC, "utf8");
  const ctx = { console, Math, Date, JSON, Float64Array, Int8Array, Object, Array, isFinite, Number, String, Error };
  ctx.self = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  const W = ctx.FightEngine;
  let ok = !!W && !!ctx.FightParams && !!ctx.MLRates, okML = false;
  if (ok) {
    W.loadDB(dbJson);
    const mw = W.matchup("alexander-volkanovski", "justin-gaethje", VG_OPTS);
    ok = strip(W.simulate(mw, W.makeRng(5), true)) === strip(E.simulate(mVG, E.makeRng(5), true));
    W.loadMLRates(mlJson);
    const mwl = W.matchup("alexander-volkanovski", "justin-gaethje", VG_OPTS);
    const mnl = withML(() => E.matchup("alexander-volkanovski", "justin-gaethje", VG_OPTS));
    okML = mwl.mlApplied && strip(W.simulate(mwl, W.makeRng(6), true)) === strip(E.simulate(mnl, E.makeRng(6), true));
  }
  check("worker-style concatenation (self.FightParams + self.MLRates + self.FightEngine) reproduces Node results", ok);
  check("worker-style loadMLRates reproduces Node's learned-rate matchup", okML);
}

console.log("\n=== Engine v4: learned stat-line rates (loadMLRates / opts.ml) ===");
{
  const mBase = E.matchupBase("alexander-volkanovski", "justin-gaethje", VG_OPTS);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check("matchup without a model equals matchupBase", same(mVG.dRate, mBase.dRate) && same(Array.from(mVG.accO), Array.from(mBase.accO)) && same(mVG.kd, mBase.kd));
  const mML = withML(() => E.matchup("alexander-volkanovski", "justin-gaethje", VG_OPTS));
  check("with a model loaded matchup applies the learned rates", mML.mlApplied === true && !!mML.ml && !!mML.ml.ratios[0].d && !same(mML.dRate, mBase.dRate),
    `distance attempt ratio Volk ${f2(mML.ml.ratios[0].d)}, Gaethje ${f2(mML.ml.ratios[1].d)}`);
  const mOff = withML(() => E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: false }, VG_OPTS)));
  check("opts.ml === false keeps the base tables", mOff.mlApplied === false && same(mOff.dRate, mBase.dRate) && same(Array.from(mOff.accO), Array.from(mBase.accO)));
  const mW0 = withML(() => E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { mlWeight: 0 } }, VG_OPTS)));
  check("params.mlWeight 0 keeps the base tables", mW0.mlApplied === false && same(mW0.dRate, mBase.dRate));
  // precomputed per-side rates (the leak-free backtest path) give the same tables as the loaded model
  const ctxP = { division: "Lightweight", rounds: 5, title: true, date: DATE, priors: DB.priors };
  const pred = MLR.predict(ML_MODEL, DB.profile("alexander-volkanovski"), DB.profile("justin-gaethje"), ctxP);
  const mPre = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: pred.A, B: pred.B } } }, VG_OPTS));
  const relDiff = (a, b) => Math.max(...a.map((x, i) => Math.abs(x - b[i]) / Math.max(1e-12, Math.abs(b[i]))));
  check("opts.ml = { pred } reproduces the loaded model's tables", mPre.mlApplied && relDiff(mPre.dRate, mML.dRate) < 1e-9 && relDiff(Array.from(mPre.accO), Array.from(mML.accO)) < 1e-9 &&
    relDiff(mPre.kd, mML.kd) < 1e-9, `max rel diff dRate ${relDiff(mPre.dRate, mML.dRate).toExponential(1)}`);
  // determinism
  check("ML: same seed, same fight", strip(E.simulate(mML, E.makeRng(42), false)) === strip(E.simulate(mML, E.makeRng(42), false)));
  const mML2 = withML(() => E.matchup("alexander-volkanovski", "justin-gaethje", VG_OPTS));
  check("ML: matchup is deterministic (same tables twice)", same(mML.dRate, mML2.dRate) && same(Array.from(mML.accO), Array.from(mML2.accO)) && same(mML.tdD, mML2.tdD) && same(mML.occ, mML2.occ));
  let tp = true; for (let sd = 1; sd <= 150; sd++) if (strip(E.simulate(mML, E.makeRng(sd), false)) !== strip(E.simulate(mML, E.makeRng(sd), true))) { tp = false; break; }
  check("ML: trace on/off gives the same fight (150 seeds)", tp);
  // corner symmetry: the model has no corner input; the swapped matchup mirrors the tables and the outcome
  const pBA = MLR.predict(ML_MODEL, DB.profile("justin-gaethje"), DB.profile("alexander-volkanovski"), ctxP);
  check("ML: predict(A, B) and predict(B, A) swap exactly", MLR.TNAMES.every((t) => Math.abs(pred.A[t] - pBA.B[t]) < 1e-12 && Math.abs(pred.B[t] - pBA.A[t]) < 1e-12));
  const mMLBA = withML(() => E.matchup("justin-gaethje", "alexander-volkanovski", VG_OPTS));
  const mir = Math.max(Math.abs(mML.dRate[0] / mMLBA.dRate[1] - 1), Math.abs(mML.dRate[1] / mMLBA.dRate[0] - 1), Math.abs(mML.kd[0] / mMLBA.kd[1] - 1),
    Math.abs(mML.tdD[0] / mMLBA.tdD[1] - 1), Math.abs(mML.occ[3] - mMLBA.occ[4]));
  check("ML: swapping corners mirrors the learned tables", mir < 1e-6, `max rel diff ${mir.toExponential(1)}`);
  const NSm = Math.max(4000, Math.round(N / 2));
  const sAB = E.summarize(mML, NSm, 314), sBA = E.summarize(mMLBA, NSm, 2718);
  const se = Math.sqrt(sAB.pA * (1 - sAB.pA) / NSm + sBA.pB * (1 - sBA.pB) / NSm);
  check("ML: swapping corners swaps the probabilities", Math.abs(sAB.pA - sBA.pB) < 4 * se + 0.003, `Volk ${pct(sAB.pA)}% as A vs ${pct(sBA.pB)}% as B; base tables ${pct(E.summarize(mVG, NSm, 314).pA)}%`);
  const mc = withML(() => E.matchup("justin-gaethje", "justin-gaethje", VG_OPTS)), sc = E.summarize(mc, NSm, 55);
  const pw = sc.pA / (sc.pA + sc.pB), sec = Math.sqrt(0.25 / (NSm * (1 - sc.pD)));
  check("ML: a fighter vs his clone wins about 50%", Math.abs(pw - 0.5) < 4 * sec + 0.003, `${pct(pw)}% of non-draws`);
  // knobs still act on top of the learned rates
  const mChin = withML(() => E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ adjA: { chin: 1.6 } }, VG_OPTS)));
  const sChin = E.summarize(mChin, NSm, 314);
  check("ML: Volk chin knob 1.6 raises Gaethje's KO/TKO share", sChin.bins[6] > sAB.bins[6] + 0.01, `${pct(sAB.bins[6])}% -> ${pct(sChin.bins[6])}%`);
  // league level preserved: a league-average pair plays about the same base rates with and without the learned rates
  const avA = avgProfile("Lightweight", "A"), avB = avgProfile("Lightweight", "B"), oL = { division: "Lightweight", rounds: 3, priors: PRI };
  const s0 = E.summarize(E.matchup(avA, avB, Object.assign({ ml: false }, oL)), NSm, 11);
  const s1 = E.summarize(withML(() => E.matchup(avA, avB, Object.assign({ date: "2023-06-01" }, oL))), NSm, 11);
  check("ML: league-average pair keeps the league level (finish rate within 4 pts, sig landed within 8%)",
    Math.abs(s0.fins - s1.fins) < 0.04 && Math.abs(s1.avg.A.sig_lnd / s0.avg.A.sig_lnd - 1) < 0.08, `finish ${pct(s0.fins)}% -> ${pct(s1.fins)}%, sig landed ${f2(s0.avg.A.sig_lnd, 1)} -> ${f2(s1.avg.A.sig_lnd, 1)}`);
}

console.log("\n=== Engine v4: train-only priors (hidden-data protocol) ===");
{
  const pdFile = path.join(ROOT, "data/derived/priors_dev.json");
  const pd = fs.existsSync(pdFile) ? JSON.parse(fs.readFileSync(pdFile, "utf8")) : null;
  check("data/derived/priors_dev.json exists and stops before 2024-01-01", !!pd && pd.meta.until === "2024-01-01" && pd.meta.since === "2018-01-01");
  check("train-only priors hold fewer fights than the production priors", !!pd && pd.priors.Lightweight.n_fights < DB.priors.Lightweight.n_fights,
    pd ? `Lightweight ${pd.priors.Lightweight.n_fights} vs ${DB.priors.Lightweight.n_fights}` : "");
  check("params are labelled as self-calibrated on the train-only priors", /selfcal-pre2024/.test(BASE.version), BASE.version);
}

console.log("\n=== Engine v4: judges (EM weights, shared + fight-level noise, 10-8 rule) ===");
{
  const J = mVG.p.judge, T1 = [1, 1, 1];
  // v5 step 1 (components.v401.emJudge, default on): the EM fit on pre-2024 cards only (tools/judge_em_train.py); with the
  // sub-flag off, v4.0.0's all-years fit (baserates.json, cards through 2026-10)
  const emF = path.join(ROOT, "data/derived/judge_em_train.json"), em = fs.existsSync(emF) ? JSON.parse(fs.readFileSync(emF, "utf8")) : null;
  const c = em && em.em_all_cards.target.coef, r4 = (x) => Math.round(x * 1e4) / 1e4;
  check("judge weights are the pre-2024 EM fit (data/derived/judge_em_train.json, cards before 2024-01-01)", E.v401Flags(mVG.p).emJudge && !!c && em.meta.until === "2024-01-01" &&
    em.meta.date_max_used < "2024-01-01" && J.head === r4(c.head_l) && J.body === r4(c.body_l) && J.leg === r4(c.leg_l) && J.kd === r4(c.kd) &&
    J.td === r4(c.td_l) && J.ctrlMin === r4(c.ctrl_min) && J.sub === r4(c.sub), em ? `${em.em_all_cards.n_cards} cards to ${em.meta.date_max_used}` : "missing");
  const J0 = E.resolveParams({ components: { v401: { emJudge: false } } }).judge;
  check("emJudge off: v4.0.0's all-years EM weights and judgecal values", J0.head === 0.179 && J0.body === 0.133 && J0.leg === 0.105 && J0.kd === 2.42 && J0.td === 0.286 &&
    J0.ctrlMin === 0.46 && J0.sub === 0.85 && J0.sharedSd === 1.416 && J0.t108 === 8.555 && J0.t108kd === -1.087);
  function panel(d, n, seed, sF) {
    const rng = E.makeRng(seed); let aW = 0, nonU = 0, n108 = 0;
    for (let i = 0; i < n; i++) {
      const c = [[0, 0], [0, 0], [0, 0]], js = [];
      n108 += E.judgeRound(J, 0, d[0], d[1], d[2], d[3], d[4], d[5], d[6], 0, 0, T1, T1, T1, sF ? J.sharedSd * Math.sqrt(J.sharedFight) * rng.normal() : 0, rng, c, js);
      const a = js.filter((x) => x[0] > x[1]).length; aW += a; if (a === 1 || a === 2) nonU++;
    }
    return { pA: aW / (3 * n), nonU: nonU / n, r108: n108 / (3 * n) };
  }
  const even = panel([0, 0, 0, 0, 0, 0, 0], 20000, 1, true);
  check("an even round is a coin flip", Math.abs(even.pA - 0.5) < 0.015, `P(A) ${pct(even.pA)}%`);
  const dA = panel([6, 2, 1, 0, 1, 30, 0], 20000, 2, true), dB = panel([-6, -2, -1, 0, -1, -30, 0], 20000, 3, true);
  check("judging is corner-symmetric (mirrored differentials mirror the round)", Math.abs(dA.pA - (1 - dB.pA)) < 0.015, `${pct(dA.pA)}% vs ${pct(1 - dB.pA)}%`);
  check("more output wins more rounds", dA.pA > 0.7, `P(A) ${pct(dA.pA)}% for +6 head, +2 body, +1 leg, +1 TD, +30 s control`);
  const big = panel([25, 5, 3, 1, 2, 120, 1], 20000, 4, true), kdOnly = panel([0, 0, 0, 1, 0, 0, 0], 20000, 5, true);
  check("10-8s come with lopsided rounds, rarely with even ones", big.r108 > 0.15 && even.r108 < 0.003, `lopsided ${pct(big.r108)}%, even ${pct(even.r108, 2)}%`);
  check("a lone knockdown edge usually wins the round", kdOnly.pA > 0.8, `P(KD scorer) ${pct(kdOnly.pA)}%`);
  check("non-unanimous share of even-looking rounds near the data (MMA Decisions |EM| < 0.5: 43%)", even.nonU > 0.3 && even.nonU < 0.55, `${pct(even.nonU)}%`);
  // engine fights: the panel's decision split and 10-8 share in Volk vs Gaethje stay in a sane band
  const sv = E.summarize(mVG, 4000, 21);
  check("decision split and 10-8 share in a sane band", sv.dec.UD > 0.6 && sv.dec.UD < 0.95 && sv.r108 > 0.005 && sv.r108 < 0.12,
    `UD ${pct(sv.dec.UD)}%, SD ${pct(sv.dec.SD)}%, 10-8 ${pct(sv.r108, 2)}% per judge-round`);
}

console.log("\n=== Engine v5 step 1 (components.v401): point deductions, the cumulative learned-rate cap, learned-path levels ===");
{
  const J = mVG.p.judge;
  check("deduction params set (judgecal: 2019-2023 decision rounds)", E.v401Flags(mVG.p).deductions && J.ded > 0.002 && J.ded < 0.01 && J.ded2 >= 0 && J.ded2 < 0.3, `ded ${J.ded}, ded2 ${J.ded2}`);
  // deductions are drawn after the last round: with and without them every fight is the same up to the cards
  const m0 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { judge: { ded: 0 } } }, VG_OPTS));
  const m1 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { judge: { ded: 0.2 } } }, VG_OPTS));
  let sameFight = true, nDiff = 0, nDec = 0, sumOk = true, dPts = 0;
  for (let sd = 1; sd <= 400; sd++) {
    const a = E.simulate(m0, E.makeRng(sd), false), b = E.simulate(m1, E.makeRng(sd), true);
    if (JSON.stringify(a.totals) !== JSON.stringify(b.totals) || a.round !== b.round || (!/^(UD|SD|MD|DRAW)$/.test(a.method) && (a.method !== b.method || a.winner !== b.winner))) sameFight = false;
    if (/^(UD|SD|MD|DRAW)$/.test(b.method)) {
      nDec++; dPts += b.nDed; if (a.method !== b.method || a.winner !== b.winner) nDiff++;
      for (let j = 0; j < 3; j++) {
        let x = 0, y = 0; b.rounds.forEach((rd) => { if (rd.judges) { x += rd.judges[j][0]; y += rd.judges[j][1]; } });
        if (x !== b.cards[j][0] || y !== b.cards[j][1]) sumOk = false;
      }
    }
  }
  check("deductions leave the fight itself unchanged (same stats, same finishes; only the cards move)", sameFight && nDiff > 0, `${nDiff} of ${nDec} decisions changed at ded 0.2`);
  check("trace: per-round judges' scores add up to the cards after deductions", sumOk && dPts > 0, `${dPts} points deducted in ${nDec} decisions`);
  const sD = E.summarize(m1, 3000, 5), expPts = 2 * 5 * 0.2 * (1 + J.ded2);
  check("deduction points per decision match 2 x rounds x ded x (1 + ded2)", Math.abs(sD.dedPerDecision / expPts - 1) < 0.1, `${f2(sD.dedPerDecision)} vs ${f2(expPts)}`);
  const sN = E.summarize(mVG, 4000, 21);
  check("at the fitted rate deductions stay rare", sN.dedPerDecision > 0.01 && sN.dedPerDecision < 0.15, `${f2(sN.dedPerDecision, 3)} points per decision`);
  const mD0 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { components: { v401: { deductions: false } } } }, VG_OPTS));
  const sOff = E.summarize(mD0, 300, 21), fOff = E.simulate(mD0, E.makeRng(9), true);
  check("deductions sub-flag off: no deductions, no nDed / dedPerDecision fields (v4.0.0's objects)", mD0.p.judge.ded === 0 && !("dedPerDecision" in sOff) && !("nDed" in fOff));
  // cumulative cap: an extreme learned takedown rate cannot push the multiplier past mlMaxRatio
  const ctxP = { division: "Lightweight", rounds: 5, title: true, date: DATE, priors: DB.priors };
  const pr = MLR.predict(ML_MODEL, DB.profile("alexander-volkanovski"), DB.profile("justin-gaethje"), ctxP);
  const hiA = Object.assign({}, pr.A, { td_att: pr.A.td_att * 40, td_acc: 0.97 }), loB = Object.assign({}, pr.B, { td_att: pr.B.td_att / 40, td_acc: 0.01 });
  const mX = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: hiA, B: loB } } }, VG_OPTS));
  const RM = mVG.p.mlMaxRatio || 4, rs = mX.ml.ratios;
  check("learned takedown multipliers stay within mlMaxRatio (cumulative attempts and odds)",
    [rs[0].tdAtt, rs[1].tdAtt, rs[0].tdOdds, rs[1].tdOdds].every((v) => v <= RM * (1 + 1e-9) && v >= 1 / RM * (1 - 1e-9)),
    `TD attempts x${f2(rs[0].tdAtt)} / x${f2(rs[1].tdAtt, 3)}, TD odds x${f2(rs[0].tdOdds)} / x${f2(rs[1].tdOdds, 3)} (cap ${RM})`);
  const mX0 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: hiA, B: loB } }, params: { components: { v401: { tdCap: false } } } }, VG_OPTS));
  const rs0 = mX0.ml.ratios;
  check("tdCap off: v4.0.0's per-step cap (the cumulative multiplier can pass mlMaxRatio)", [rs0[0].tdAtt, rs0[1].tdAtt, rs0[0].tdOdds, rs0[1].tdOdds].some((v) => v > RM * 1.01 || v < 1 / RM / 1.01),
    `TD attempts x${f2(rs0[0].tdAtt)} / x${f2(rs0[1].tdAtt, 3)}, TD odds x${f2(rs0[0].tdOdds)} / x${f2(rs0[1].tdOdds, 3)}`);
  const mL = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: pr.A, B: pr.B } }, params: { mlTdLevel: 1.5 } }, VG_OPTS));
  const mL0 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: pr.A, B: pr.B } }, params: { mlTdLevel: 1 } }, VG_OPTS));
  check("mlTdLevel scales the learned takedown targets", mL.ml.ratios[0].tdAtt > mL0.ml.ratios[0].tdAtt * 1.2, `x${f2(mL0.ml.ratios[0].tdAtt)} -> x${f2(mL.ml.ratios[0].tdAtt)}`);
  const mLoff = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: pr.A, B: pr.B } }, params: { mlTdLevel: 1.5, components: { v401: { mlLevels: false } } } }, VG_OPTS));
  const mL1 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: { pred: { A: pr.A, B: pr.B } }, params: { mlTdLevel: 1, components: { v401: { mlLevels: false } } } }, VG_OPTS));
  check("mlLevels off: the learned-path levels are not applied", mLoff.ml.ratios[0].tdAtt === mL1.ml.ratios[0].tdAtt, `x${f2(mLoff.ml.ratios[0].tdAtt)}`);
  // koTargets: the composition factors multiply the KO block after the overrides
  const KC = (BASE.v401 && BASE.v401.koComp) || {}, pOn = E.resolveParams({ kdScale: 1.2 }), pOff = E.resolveParams({ kdScale: 1.2, components: { v401: { koTargets: false } } });
  check("koTargets multiplies kdScale / kdPos[1] / gnpTko / stko after the overrides (stored fields stay the pre-(e) levels)",
    Math.abs(pOn.kdScale - 1.2 * (KC.kdScale || 1)) < 1e-12 && pOff.kdScale === 1.2 && Math.abs(pOn.kdPos[1] - BASE.kdPos[1] * (KC.kdClinch || 1)) < 1e-12 &&
    Math.abs(pOn.gnpTko - BASE.gnpTko * (KC.gnpTko || 1)) < 1e-12 && Math.abs(pOn.stko - BASE.stko * (KC.stko || 1)) < 1e-12 && BASE.kdPos[1] === pOff.kdPos[1],
    `koComp ${JSON.stringify(KC)}`);
}

console.log("\n=== Trace format ===");
{
  const f = E.simulate(mVG, E.makeRng(2024), true);
  const kinds = new Set(), allowed = new Set(["miss", "hit", "hurt", "kd", "fin", "clinch", "break", "td", "tdx", "pass", "esc", "sweep", "up", "sub", "subx", "recover", "reset"]);
  let okFields = true, okKinds = true, okTime = true;
  for (const r of f.rounds) {
    let last = 0;
    for (const e of r.ev) {
      kinds.add(e.k);
      if (!allowed.has(e.k)) okKinds = false;
      if (!(e.t >= 0 && e.t <= 300 && e.t >= last - 1e-9)) okTime = false; last = e.t;
      if (!("dA" in e && "dB" in e && "gA" in e && "gB" in e && "sA" in e && "sB" in e && "s" in e && "w" in e)) okFields = false;
      if ((e.k === "hit" || e.k === "miss" || e.k === "kd" || e.k === "hurt" || e.k === "fin") && (e.tg == null || !e.loc)) okFields = false;
      if ((e.k === "sub" || e.k === "subx") && !e.name) okFields = false;
      if (e.k === "fin" && !e.how) okFields = false;
    }
    if (!r.st || !r.st.A || !r.st.B || r.st.hA == null) okFields = false;
    if (!r.fin && !r.stoppage && !(r.judges && r.judges.length === 3)) okFields = false;
  }
  check("event kinds are from the spec table (+ esc)", okKinds, [...kinds].join(" "));
  check("events carry t, k, w, s, snapshots; strikes carry tg and loc; subs carry name; fin carries how", okFields);
  check("event times are ordered within each round", okTime);
  // a big sample for rare kinds
  const seen = new Set(); const rr = E.makeRng(1);
  for (let i = 0; i < 300; i++) for (const r of E.simulate(mVG, rr, true).rounds) for (const e of r.ev) seen.add(e.k);
  check("all spec kinds occur over 300 traced fights", ["miss", "hit", "hurt", "kd", "fin", "clinch", "break", "td", "tdx", "pass", "sweep", "up", "subx", "recover"].every((k) => seen.has(k)), [...seen].join(" "));
  const ex = f.rounds[0].ev.find((e) => e.k === "hit");
  console.log("  sample event:", JSON.stringify(ex));
  console.log("  result:", f.winner, f.method, "|", f.detail, "| round", f.round, "at", f2(f.t, 1), "s | cards", JSON.stringify(f.cards));
}

console.log("\n=== Symmetry and clones ===");
const NS = Math.max(4000, N);
{
  const sAB = E.summarize(mVG, NS, 314);
  const mBA = E.matchup("justin-gaethje", "alexander-volkanovski", VG_OPTS);
  const sBA = E.summarize(mBA, NS, 2718);
  const se = Math.sqrt(sAB.pA * (1 - sAB.pA) / NS + sBA.pB * (1 - sBA.pB) / NS);
  check("swapping corners swaps the probabilities", Math.abs(sAB.pA - sBA.pB) < 4 * se + 0.003, `Volk ${pct(sAB.pA)}% as A vs ${pct(sBA.pB)}% as B; 4 se = ${pct(4 * se)}`);
  const binDiff = Math.max(...sAB.bins.map((x, i) => Math.abs(x - sBA.bins[6 - i])));
  check("swapping corners mirrors the 7 outcome bins", binDiff < 0.02, `max bin diff ${pct(binDiff)} pts`);
}
for (const slug of ["alexander-volkanovski", "justin-gaethje"]) {
  const mc = E.matchup(slug, slug, VG_OPTS), s = E.summarize(mc, NS, 55);
  const pAw = s.pA / (s.pA + s.pB), se = Math.sqrt(0.25 / (NS * (1 - s.pD)));
  check(`${slug} vs his clone wins about 50%`, Math.abs(pAw - 0.5) < 4 * se + 0.003, `${pct(pAw)}% of non-draws, 4 se = ${pct(4 * se)}`);
}
{
  const s = E.summarize(E.matchup(avgProfile("Lightweight"), avgProfile("Lightweight"), { division: "Lightweight", rounds: 3 }), NS, 66);
  const pAw = s.pA / (s.pA + s.pB), se = Math.sqrt(0.25 / (NS * (1 - s.pD)));
  check("league-average vs league-average wins about 50%", Math.abs(pAw - 0.5) < 4 * se + 0.003, `${pct(pAw)}%`);
}

console.log("\n=== Knob directions (Volk = A, Gaethje = B) ===");
{
  const NK = Math.max(6000, Math.round(N / 2));
  const base = E.summarize(mVG, NK, 808);
  const run = (o) => E.summarize(E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG_OPTS, o)), NK, 808);
  const koA = (s) => s.bins[0], koB = (s) => s.bins[6];
  let s;
  s = run({ adjA: { chin: 1.6 } }); check("chin knob up on A -> more KO losses for A", koB(s) > koB(base) + 0.01, `${pct(koB(base))} -> ${pct(koB(s))}`);
  s = run({ adjB: { chin: 0.6 } }); check("chin knob down on B -> fewer KO losses for B", koA(s) < koA(base) - 0.01, `${pct(koA(base))} -> ${pct(koA(s))}`);
  s = run({ adjA: { pow: 1.6 } }); check("power knob up on A -> more KO wins for A", koA(s) > koA(base) + 0.01, `${pct(koA(base))} -> ${pct(koA(s))}`);
  s = run({ adjA: { out: 1.3 } }); check("output knob up on A -> more attempts by A", s.avg.A.sig_att > base.avg.A.sig_att * 1.15, `${f2(base.avg.A.sig_att, 1)} -> ${f2(s.avg.A.sig_att, 1)}`);
  s = run({ adjA: { acc: 1.5 } }); check("accuracy knob up on A -> higher accuracy for A", s.avg.A.acc > base.avg.A.acc + 0.03, `${pct(base.avg.A.acc)} -> ${pct(s.avg.A.acc)}`);
  s = run({ adjA: { cardio: 2.5 } }); check("cardio knob up on A (tires faster) -> lower win share for A", s.pA < base.pA - 0.01, `${pct(base.pA)} -> ${pct(s.pA)}`);
  s = run({ adjA: { tdAtt: 3 } }); check("takedown-attempt knob up on A -> more TD attempts and control for A", s.avg.A.td_att > 2 * base.avg.A.td_att && s.avg.A.ctrl > base.avg.A.ctrl, `TD att ${f2(base.avg.A.td_att)} -> ${f2(s.avg.A.td_att)}, ctrl ${f2(base.avg.A.ctrl, 0)} -> ${f2(s.avg.A.ctrl, 0)} s`);
  s = run({ adjB: { tdDef: 2 } }); check("takedown-defense knob up on B -> lower TD success for A", s.avg.A.tdAcc < base.avg.A.tdAcc - 0.04, `${pct(base.avg.A.tdAcc)} -> ${pct(s.avg.A.tdAcc)}`);
  s = run({ adjB: { leg: 0.4 } }); check("leg-kick share knob on B -> more leg kicks by B", s.avg.B.l_att / s.avg.B.sig_att > base.avg.B.l_att / base.avg.B.sig_att + 0.1, `${pct(base.avg.B.l_att / base.avg.B.sig_att)}% -> ${pct(s.avg.B.l_att / s.avg.B.sig_att)}% of attempts`);
  s = run({ adjA: { sub: 3 } }); check("submission knob up on A -> more submission wins for A", s.bins[1] > base.bins[1] + 0.005, `${pct(base.bins[1])} -> ${pct(s.bins[1])}`);
  const jp0 = run({ judges: { power: 0 } }), jp1 = run({ judges: { power: 1.5 } });
  check("judges.power up -> decisions shift toward the harder hitter", (jp1.distB - jp0.distB) * Math.sign(mVG.dw[1] - mVG.dw[0]) > 0.005, `Gaethje's share of decisions ${pct(jp0.distB)} -> ${pct(jp1.distB)} (damage/head ${f2(mVG.dw[0])} vs ${f2(mVG.dw[1])})`);
}

console.log("\n=== Per-pair position calibration (simulated vs data-implied expectations) ===");
{
  // matchup() fits clinch entry and stand-up hazards so the expected occupancy reproduces each pair's data-implied control
  // and clinch time; strike rates per position are per minute of that position. Check the simulation lands there on average.
  const pairs = [["merab-dvalishvili", "sean-o-malley", "Bantamweight"], ["islam-makhachev", "belal-muhammad", "Welterweight"],
    ["arman-tsarukyan", "charles-oliveira", "Lightweight"], ["khamzat-chimaev", "dricus-du-plessis", "Middleweight"],
    ["tom-aspinall", "ciryl-gane", "Heavyweight"], ["zhang-weili", "tatiana-suarez", "Women's Strawweight"],
    ["valentina-shevchenko", "alexa-grasso", "Women's Flyweight"], ["alexander-volkanovski", "justin-gaethje", "Lightweight"]];
  const NP = Math.max(3000, Math.round(N / 4));
  console.log("pair".padEnd(44) + "ctrl/15 sim vs target (A, B)".padEnd(34) + "clinch landed/15 sim vs exp".padEnd(30) + "ground landed/15 sim vs exp");
  let worstC = 0, worstK = 0, worstG = 0;
  for (const [a, b, d] of pairs) {
    const mm = E.matchup(a, b, { division: d, rounds: 3, date: DATE }), s = E.summarize(mm, NP, 17), x = E.explain(mm);
    const cA = s.avg.A.per15.ctrl, cB = s.avg.B.per15.ctrl, tA = mm.ctrlT[0] * 15, tB = mm.ctrlT[1] * 15;
    const kS = s.avg.A.per15.c_lnd + s.avg.B.per15.c_lnd, kE = x.A.expectedPer15.clinchLnd + x.B.expectedPer15.clinchLnd;
    const gS = s.avg.A.per15.g_lnd + s.avg.B.per15.g_lnd, gE = x.A.expectedPer15.groundLnd + x.B.expectedPer15.groundLnd;
    const relC = Math.abs((cA + cB) / (tA + tB) - 1), relK = Math.abs(kS / kE - 1), relG = Math.abs(gS / gE - 1);
    worstC = Math.max(worstC, relC); worstK = Math.max(worstK, relK); worstG = Math.max(worstG, relG);
    console.log(`${mm.A.name} vs ${mm.B.name}`.padEnd(44) + `${f2(cA, 0)}/${f2(tA, 0)}, ${f2(cB, 0)}/${f2(tB, 0)}`.padEnd(34) + `${f2(kS, 1)} vs ${f2(kE, 1)}`.padEnd(30) + `${f2(gS, 1)} vs ${f2(gE, 1)}`);
  }
  check("simulated control per 15 within 25% of each pair's data-implied target", worstC < 0.25, `worst ${pct(worstC)}%`);
  check("simulated clinch landed per 15 within 25% of each pair's expectation", worstK < 0.25, `worst ${pct(worstK)}%`);
  // knockdown follow-up flurries add ground strikes on top of the base expectation, so heavy-knockdown pairs run high
  check("simulated ground landed per 15 within 40% of each pair's base expectation (KD follow-ups add on top)", worstG < 0.40, `worst ${pct(worstG)}%`);
}

console.log("\n=== manualProfile ===");
{
  const mp = E.manualProfile({ name: "Manual Volk", slpm: 6.0, sapm: 3.3, acc: 0.57, def: 0.59, td15: 1.6, tdAcc: 0.34, tdDef: 0.68, sub15: 0.2, kd15: 0.3, head: 0.63, body: 0.11, leg: 0.26, mins: 313, age: 38.1, ko_losses: 2 }, { division: "Featherweight" });
  const mm = E.matchup(mp, "justin-gaethje", VG_OPTS), s = E.summarize(mm, 3000, 4);
  const sl = s.avg.A.per15.sig_lnd / 15;
  check("manual profile simulates with plausible output", sl > 4 && sl < 8 && s.pA > 0.2 && s.pA < 0.85, `landed/min ${f2(sl)}, win ${pct(s.pA)}%`);
}

let tableRes = [];
if (!QUICK) {
  console.log("\n=== League-average base rates by division (self-calibration check) ===");
  for (const d of ["Lightweight", "Featherweight", "Welterweight", "Heavyweight", "Women's Flyweight", "Bantamweight", "Middleweight", "Women's Strawweight"]) tableRes.push(divTable(d, N));
}

console.log("\n=== Volkanovski (A) vs Gaethje (B): Lightweight, 5 rounds, title, " + DATE + " ===");
{
  const t0 = Date.now(), c0 = process.cpuUsage();
  const s = E.summarize(mVG, 20000, 20261106);
  const cu = process.cpuUsage(c0), ms = Math.round((cu.user + cu.system) / 1000), wall = Date.now() - t0;
  console.log(`win: Volkanovski ${pct(s.pA)}%  Gaethje ${pct(s.pB)}%  draw ${pct(s.pD)}%   (MC se ${pct(s.se, 2)} pts)`);
  console.log(`bins [A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO]: ${s.bins.map((x) => pct(x)).join(" / ")}`);
  console.log(`finishes by round, Volk: ${s.finA.map((x) => pct(x)).join(" / ")}   Gaethje: ${s.finB.map((x) => pct(x)).join(" / ")}`);
  console.log(`goes the distance ${pct(s.dist)}% (Volk wins ${pct(s.distA)}% of decisions); decisions UD ${pct(s.dec.UD)} SD ${pct(s.dec.SD)} MD ${pct(s.dec.MD)} draw ${pct(s.dec.DRAW)}; 10-8 per judge-round ${pct(s.r108, 2)}%`);
  console.log("methods:", Object.entries(s.methods).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${pct(v / s.n)}%`).join(", "));
  console.log(`average fight ${f2(s.avgMin, 1)} min; KD per 15 per fighter ${f2(s.kd15, 3)}; control per 15 ${f2(s.ctrl15, 0)} s`);
  const C = (slug) => { const f = DB.fighters[slug], c = {}; DB.meta.keys.forEach((k, i) => (c[k] = f.C[i])); return c; };
  const SS = (slug) => { const f = DB.fighters[slug], c = {}; DB.meta.keys.forEach((k, i) => (c[k] = f.S[i])); return c; };
  console.log("\nper fighter (sim per 15 min of fight time vs UFC career and decayed rates per 15):");
  console.log("stat".padEnd(22) + "Volk sim".padStart(10) + "career".padStart(9) + "decayed".padStart(9) + " |" + "Gaethje sim".padStart(12) + "career".padStart(9) + "decayed".padStart(9));
  const cv = C("alexander-volkanovski"), cg = C("justin-gaethje"), dvv = SS("alexander-volkanovski"), dg = SS("justin-gaethje");
  const lines = [
    ["sig landed", (a) => a.per15.sig_lnd, (c) => 15 * (c.d_lnd + c.c_lnd + c.g_lnd) / c.min],
    ["sig attempted", (a) => a.per15.sig_att, (c) => 15 * (c.d_att + c.c_att + c.g_att) / c.min],
    ["sig absorbed", null, (c) => 15 * (c.od_lnd + c.oc_lnd + c.og_lnd) / c.min, true],
    ["accuracy %", (a) => 100 * a.acc, (c) => 100 * (c.d_lnd + c.c_lnd + c.g_lnd) / (c.d_att + c.c_att + c.g_att)],
    ["head landed", (a) => a.per15.h_lnd, (c) => 15 * c.h_lnd / c.min],
    ["body landed", (a) => a.per15.b_lnd, (c) => 15 * c.b_lnd / c.min],
    ["leg landed", (a) => a.per15.l_lnd, (c) => 15 * c.l_lnd / c.min],
    ["ground landed", (a) => a.per15.g_lnd, (c) => 15 * c.g_lnd / c.min],
    ["knockdowns", (a) => a.per15.kd, (c) => 15 * c.kd / c.min],
    ["TD landed", (a) => a.per15.td_lnd, (c) => 15 * c.td_lnd / c.min],
    ["TD accuracy %", (a) => 100 * a.tdAcc, (c) => 100 * c.td_lnd / Math.max(1, c.td_att)],
    ["control s", (a) => a.per15.ctrl, (c) => 15 * c.ctrl / c.min],
    ["sub attempts", (a) => a.per15.sub_att, (c) => 15 * c.sub_att / c.min]
  ];
  for (const [lab, fs2, fc, absorbed] of lines) {
    const va = absorbed ? s.avg.B.per15.sig_lnd : fs2(s.avg.A), vb = absorbed ? s.avg.A.per15.sig_lnd : fs2(s.avg.B);
    console.log(lab.padEnd(22) + f2(va).padStart(10) + f2(fc(cv)).padStart(9) + f2(fc(dvv)).padStart(9) + " |" + f2(vb).padStart(12) + f2(fc(cg)).padStart(9) + f2(fc(dg)).padStart(9));
  }
  const load = require("os").loadavg()[0];
  check("summarize(Volk vs Gaethje, 20000) under 6 s of CPU on one core", ms < 6000, `${ms} ms CPU, ${wall} ms wall, load average ${load.toFixed(1)} on ${require("os").cpus().length} cores`);
  check("Volk vs Gaethje probabilities sum to 1", Math.abs(s.pA + s.pB + s.pD - 1) < 1e-9 && Math.abs(sum(s.bins) - 1) < 1e-9);
}

console.log("\n=== explain(Volkanovski vs Gaethje) ===");
console.log(E.explain(mVG).text);

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
