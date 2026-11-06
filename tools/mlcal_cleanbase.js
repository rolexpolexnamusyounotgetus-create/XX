#!/usr/bin/env node
/* mlcal_cleanbase.js: rebuild the engine v3 [selfcal] values from TRAIN-PERIOD base rates only.

   Why (mlcal review, Nov 6 2026): src/params3.js 3.0.0-selfcal-2026-11-06 was self-calibrated by
   tests/test_engine3.js --fit against data/derived/fighters.json priors, which pool every fight from
   2018-01-01 to the 2026-10-31 snapshot, i.e. the 2024-2025 validation years AND the 2026 vault. A baseline
   whose global scales and per-division factors were matched to those league rates has seen the validation
   period, so "nothing beats the current params on validation" is not a fair comparison.

   This script runs the same procedure (same damped fixed-point updates, same targets, same order: global
   scales on Lightweight, then per-division factors) with the targets AND the engine's shrinkage priors taken
   from data/derived/mlcal_priors_asof.json[<year>] (default 2024: fights in [2019-01-01, 2024-01-01), built
   walk-forward by tools/build_db.py). It writes a full params file with the [selfcal] values replaced; it
   never writes src/.

     node tools/mlcal_cleanbase.js --engine <dir/engine3.js> --params <params3.js> --out <file.js> [--asof 2024] [--n 8000] [--ndiv 6000]
*/
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const a = {};
for (let i = 2; i < process.argv.length; i += 2) a[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const ASOF = String(a.asof || "2024");
if (+ASOF > 2024) throw new Error("mlcal_cleanbase: --asof must be <= 2024 (train-period priors only)");
const E = require(abs(a.engine));
const PARAMS_SRC = abs(a.params);
const BASE = JSON.parse(JSON.stringify(require(PARAMS_SRC)));
const PRI = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlcal_priors_asof.json"), "utf8"))[ASOF];
const N = +(a.n || 8000), NDIV = +(a.ndiv || 6000);
const sum = (x) => x.reduce((s, v) => s + v, 0);
const pct = (x, d = 1) => (100 * x).toFixed(d);

// ---- copied from tests/test_engine3.js (avgProfile, targets, simAvg subset), with priors = PRI
function avgProfile(div, tag) {
  const P = PRI[div], S = {};
  for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;
  return { name: `${tag} ${div}`, division: div, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}
function targets(div, nR) {
  const P = PRI[div];
  const fin = nR === 5 ? P.fin5 : P.fin3, dec = nR === 5 ? P.dec5 : P.dec3;
  const ko = sum(fin.KO), sub = sum(fin.SUB), d = fin.DEC + fin.DRAW, tot = ko + sub + d;
  const lnd = P.d_lnd + P.c_lnd + P.g_lnd, att = P.d_att + P.c_att + P.g_att;
  return { n: fin.n, fin: (ko + sub) / tot, ko: ko / tot, sub: sub / tot, dec, sigL15: 15 * lnd, sigA15: 15 * att, acc: lnd / att,
    dA15: 15 * P.d_att, cA15: 15 * P.c_att, gA15: 15 * P.g_att, kd100: 100 * P.kd_per_h, tdA15: 15 * P.td_att, tdAcc: P.td_acc,
    ctrl15: P.ctrl15, sub15: P.sub15, kdFin: P.kd_fin };
}
function simAvg(div, nR, params, n, seed) {
  const m = E.matchup(avgProfile(div, "A"), avgProfile(div, "B"), { division: div, rounds: nR, title: nR === 5, params, priors: PRI });
  const s = E.summarize(m, n, seed);
  const A = s.avg.A, B = s.avg.B, p15 = (k) => (A.per15[k] + B.per15[k]) / 2;
  const kk = s.koKind, kt = Math.max(1, kk.KO + kk.TKO_followup + kk.TKO_standing + kk.GNP + kk.LEG);
  const kl = s.koLoc, klt = Math.max(1, kl.dist + kl.clinch + kl.ground);
  return { fin: s.fins, ko: sum(s.finKO), sub: sum(s.finSUB), dec: s.dec, r108: s.r108,
    sigL15: p15("sig_lnd"), sigA15: p15("sig_att"), acc: (A.sig_lnd + B.sig_lnd) / (A.sig_att + B.sig_att),
    dA15: p15("d_att"), cA15: p15("c_att"), gA15: p15("g_att"), kd100: 100 * (A.kd + B.kd) / (A.h_lnd + B.h_lnd),
    tdA15: p15("td_att"), tdAcc: (A.td_lnd + B.td_lnd) / Math.max(1e-9, A.td_att + B.td_att), ctrl15: s.ctrl15, sub15: p15("sub_att"),
    kdFin: s.kdFin, gShare: kl.ground / klt, cShare: kl.clinch / klt, stShare: kk.TKO_standing / kt };
}

// ---- tests/test_engine3.js selfCalibrate(), unchanged except for the priors and N
const P0 = BASE;
const g = { strikeScale: P0.strikeScale, accScale: P0.accScale, groundScale: P0.groundScale, clinchScale: P0.clinchScale, kdScale: P0.kdScale,
  tdScale: P0.tdScale, tdOddsScale: P0.tdOddsScale, subAttScale: P0.subAttScale, subConvScale: P0.subConvScale,
  kdInstant: P0.kdInstant, kdRefStop: P0.kdRefStop, gnpTko: P0.gnpTko, stko: P0.stko, kdClinch: P0.kdPos[1], indSd: P0.judge.indSd, t108: P0.judge.t108 };
const ref = "Lightweight", T = targets(ref, 3);
const TG = { ground: 0.28, clinch: 0.125, standNoKd: 0.07 };
const dmp = (x, e) => Math.pow(x, e === undefined ? 0.8 : e);
const oddsR = (t, s2) => (t / (1 - t)) / (s2 / (1 - s2));
const asParams = (gv, divv) => ({ strikeScale: gv.strikeScale, accScale: gv.accScale, groundScale: gv.groundScale, clinchScale: gv.clinchScale,
  kdScale: gv.kdScale, tdScale: gv.tdScale, tdOddsScale: gv.tdOddsScale, subAttScale: gv.subAttScale, subConvScale: gv.subConvScale,
  kdInstant: gv.kdInstant, kdRefStop: gv.kdRefStop, gnpTko: gv.gnpTko, stko: gv.stko, kdPos: [1, gv.kdClinch],
  judge: { indSd: gv.indSd, t108: gv.t108, t108b: gv.t108 + 3, t108kd2: Math.max(0.5, gv.t108 - 3) }, div: divv || {} });
const c0 = process.cpuUsage();
console.log(`clean selfcal: targets and shrinkage priors = priors_asof[${ASOF}] (n LW 3-rd fights ${T.n}); N ${N} global, ${NDIV} per division`);
for (let it = 0; it < 10; it++) {
  const S = simAvg(ref, 3, asParams(g), N, 1000 + it);
  console.log(`it ${it}: fin ${pct(S.fin)} (${pct(T.fin)}) KO ${pct(S.ko)} (${pct(T.ko)}) SUB ${pct(S.sub)} (${pct(T.sub)}) acc ${pct(S.acc)} (${pct(T.acc)}) kd100 ${S.kd100.toFixed(3)} (${T.kd100.toFixed(3)}) ctrl ${S.ctrl15.toFixed(0)} (${T.ctrl15.toFixed(0)})`);
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
  g.indSd *= dmp(T.dec.SD / Math.max(0.01, S.dec.SD), 0.6);
  g.t108 *= dmp(S.r108 / 0.035, 0.35);
}
console.log("global:", JSON.stringify(g));
const divs = Object.keys(PRI).filter((d) => !["ALL", "Catch Weight", "Open Weight"].includes(d));
const divF = {};
for (const d of divs) {
  const Td = targets(d, 3), f = { att: 1, kd: 1, ko: 1, sub: 1, ctrl: 1, td: 1 };
  let S = null;
  for (let it = 0; it < 6; it++) {
    const dv = {}; dv[d] = f;
    S = simAvg(d, 3, asParams(g, dv), NDIV, 3000 + it);
    f.att *= dmp(Td.sigL15 / S.sigL15); f.kd *= dmp(Td.kd100 / S.kd100); f.ko *= dmp(oddsR(Td.ko, S.ko), 1.1);
    f.sub *= dmp(oddsR(Td.sub, S.sub), 1.0); f.ctrl *= dmp(Td.ctrl15 / S.ctrl15); f.td *= dmp(Td.tdA15 / S.tdA15);
  }
  for (const k in f) f[k] = +f[k].toFixed(3);
  divF[d] = f;
  console.log(`${d.padEnd(22)} ${JSON.stringify(f)}  fin ${pct(S.fin)} (${pct(Td.fin)}) KO ${pct(S.ko)} (${pct(Td.ko)}) SUB ${pct(S.sub)} (${pct(Td.sub)})`);
}
// ---- write: same regex rewrite as tests/test_engine3.js writeParams(), applied to a copy of the params source
let src = fs.readFileSync(PARAMS_SRC, "utf8");
src = src.replace(/kdPos: \[[^\]]*\]/, `kdPos: [1.0, ${+g.kdClinch.toPrecision(4)}]`);
const vals = { strikeScale: g.strikeScale, accScale: g.accScale, groundScale: g.groundScale, clinchScale: g.clinchScale, kdScale: g.kdScale,
  tdScale: g.tdScale, tdOddsScale: g.tdOddsScale, subAttScale: g.subAttScale, subConvScale: g.subConvScale, kdInstant: g.kdInstant, kdRefStop: g.kdRefStop,
  gnpTko: g.gnpTko, stko: g.stko, indSd: g.indSd, t108: g.t108, t108b: g.t108 + 3, t108kd2: Math.max(0.5, g.t108 - 3) };
for (const [k, v] of Object.entries(vals)) {
  const re = new RegExp("^(\\s*)" + k + ":\\s*[-0-9.eE/ ]+?(,?)(\\s*//)", "m");
  if (!re.test(src)) throw new Error("mlcal_cleanbase: could not find " + k + " in " + PARAMS_SRC);
  src = src.replace(re, (all, ind, comma, cm) => `${ind}${k}: ${+(+v).toPrecision(4)}${comma}${cm}`);
}
const body = Object.entries(divF).map(([d, o]) => `      ${JSON.stringify(d)}: { ${Object.entries(o).map(([k, v]) => `${k}: ${+v.toFixed(3)}`).join(", ")} }`).join(",\n");
src = src.replace(/(\n    div: )[\s\S]*?(\n  \};)/, `$1{\n${body}\n    }$2`);
src = src.replace(/version: "([^"]*)"/, `version: "$1+selfcal-pre${ASOF}"`);
src = `/* Generated by tools/mlcal_cleanbase.js from ${path.relative(ROOT, PARAMS_SRC)}: [selfcal] values re-fit to priors_asof[${ASOF}] ` +
  `(train-period league rates only). Not for src/. */\n` + src;
fs.writeFileSync(abs(a.out), src);
const cu = process.cpuUsage(c0);
console.log(`wrote ${a.out}; ${((cu.user + cu.system) / 1e6).toFixed(0)} s CPU`);
