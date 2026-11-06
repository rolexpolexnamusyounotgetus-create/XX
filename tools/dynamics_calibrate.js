#!/usr/bin/env node
/* dynamics_calibrate.js: re-fit the level factors of the fight-dynamics component ([dyncal] in src/params3.js `dyn`)
   on 2019-2023 backtest fights (train only; refuses later dates).

   The dynamics recipe (research/model_dynamics.md E1-E11) replaces terms the walk-forward calibration had absorbed
   (stamina / pace / damage on knockdowns, damage and stamina on finishes, 5-round caution on knockdowns, larger output
   and accuracy form sds), so the realised levels move. This tool moment-matches them on the same leak-free inputs as
   tools/dynamics_bt.js (frozen profiles, walk-forward priors, out-of-fold learned rates), with fixed seeds:
     outLevel   sig attempts per fighter-minute          the flag-off engine on the same fights and seeds (--target-off,
                                                          the default) or the backtest actuals (--target-real)
     accLevel   sig accuracy                              same
     tdLevel    takedown attempts per fighter-minute      same
   Volume levels follow the flag-off engine by default so that an ablation measures the dynamics structure at equal
   volume (the base engine's own level calibration is not credited to or blamed on the component).
     kdLevel3/5 knockdowns per fight-minute, per format  backtest actuals of ALL 2019-2023 fights (3 rounds 0.611 per 15 min,
                                                          754 KDs; 5 rounds 0.500, 135 KDs), not the stride subsample (noisy)
                                                          and not the flag-off engine (0.640 / 0.379: its 5-round level is 24%
                                                          low); the round shape comes from the kdRound tables (per standing
                                                          head strike would overshoot: the engine lands ~4% more than real)
     convLevel  knockdown -> finish conversion per KD     dynamics.json finish_hazard.kd_conversion rate_train (0.512)
     stkoScale, standing / ground TKO without a KD:       one joint factor so the KO/TKO share matches the paired flag-off
     gnpScale   the data ratio of the two hazards is kept    engine (= real 2019-2023: 0.317 vs 0.317); printed against the
                                                          per-exposure rates in dynamics.json (0.000452 per standing head
                                                          absorbed, 0.006737 per ground strike); with knockdowns and their
                                                          conversion on data, the per-exposure rates overshoot the count
                                                          because the engine lands more strikes than real
   Usage: node tools/dynamics_calibrate.js [--iters 6] [--sims 24] [--stride 2] [--params '{"dyn":{...}}'] [--target-real]
   Prints the fitted values as JSON (paste into params3.js `dyn`). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
function opt(k, d) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; }
const ITERS = +opt("--iters", "6"), SIMS = +opt("--sims", "24"), STRIDE = +opt("--stride", "2");
const FROM = "2019-01-01", TO = "2023-12-31";
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
function dataFile(rel) { const a = path.join(ROOT, rel); return fs.existsSync(a) ? a : path.join("/home/user/XX", rel); }
const bt = JSON.parse(fs.readFileSync(dataFile("data/derived/backtest_dev.json"), "utf8"));
const priorsAsof = JSON.parse(fs.readFileSync(dataFile("data/derived/mlcal_priors_asof.json"), "utf8"));
const oof = JSON.parse(fs.readFileSync(dataFile("data/derived/mlrates_oof.json"), "utf8"));
const dyn = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/dynamics.json"), "utf8"));
const TN = oof.meta.targets, keys = bt.meta.keys;
const extra = JSON.parse(opt("--params", "{}"));
// v5 merge step 2: with the durability component on (the default), each backtest matchup gets its walk-forward record of
// data/derived/durability.json and the train NORM (tools/durrec.js), as tools/evalv.js and tools/dynamics_bt.js do; the
// paired "flag off" reference is then step 1 + durability (dynamics off)
const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT);

const allTrain = bt.fights.filter((f) => f.date >= FROM && f.date <= TO && oof.fights[f.id]);
const fights = bt.fights.filter((f, i) => f.date >= FROM && f.date <= TO && i % STRIDE === 0 && oof.fights[f.id]);
// ---- targets
let attS = 0, lndS = 0, minS = 0;
const kdA = { 3: 0, 5: 0 }, kdM = { 3: 0, 5: 0 };
for (const f of fights) {
  const a = f.actual; if (!a || !a.A || !a.minutes) continue;
  attS += a.A.sig_att + a.B.sig_att; lndS += a.A.sig_lnd + a.B.sig_lnd; minS += 2 * a.minutes;
}
for (const f of allTrain) {
  const a = f.actual; if (!a || !a.A || !a.minutes) continue;
  const R = f.rounds === 5 ? 5 : 3; kdA[R] += a.A.kd + a.B.kd; kdM[R] += a.minutes;
}
const TG = dyn.targets_by_round.train, FH = dyn.finish_hazard;
const T = {
  attPm: attS / minS, acc: lndS / attS, kdPm3: kdA[3] / kdM[3], kdPm5: kdA[5] / kdM[5],
  kdCell: (R, r) => TG[R + "_" + (r + 1)].kd_per100_standing_head / 100,
  conv: FH.kd_conversion.null.rate_train,
  stko: FH.non_kd_stoppage.rate_per_standing_head_st_train, gtko: FH.non_kd_stoppage.rate_per_ground_strike_gt_train
};
function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
function optsFor(f, swap, params) {
  const pri = priorsAsof[f.date.slice(0, 4)];
  const generic = f.division === "Catch Weight" || f.division === "Open Weight" || (pri && !pri[f.division]);
  const division = generic ? (f.prior_division || f.division) : f.division;
  const o = { division, rounds: f.rounds || (f.title ? 5 : 3), title: !!f.title, date: f.date, priors: pri, params };
  const ent = oof.fights[f.id], a = {}, b = {};
  TN.forEach((t, k) => { a[t] = ent.A[k]; b[t] = ent.B[k]; });
  o.ml = swap ? { A: b, B: a } : { A: a, B: b };
  return o;
}
function run(params) {
  const g = { att: 0, lnd: 0, tda: 0, secs: 0, kd: { 3: [0, 0, 0], 5: [0, 0, 0, 0, 0] }, sh: { 3: [0, 0, 0], 5: [0, 0, 0, 0, 0] },
    fsec: { 3: 0, 5: 0 }, kdN: 0, conv: 0, stko: 0, gtko: 0, expSh: 0, expG: 0, koR: { 3: [0, 0, 0], 5: [0, 0, 0, 0, 0] }, reach: { 3: [0, 0, 0], 5: [0, 0, 0, 0, 0] },
    nF: 0, nKO: 0, nSUB: 0, nDEC: 0 };
  for (const f of fights) {
    const nR = f.rounds === 5 ? 5 : 3;
    const PA = Object.assign({ keys }, f.A), PB = Object.assign({ keys }, f.B);
    for (const swap of [false, true]) {
      const o = optsFor(f, swap, params);
      DR.apply(o, f.id, swap);   // v5: durability walk-forward record + train NORM when the component is on (tools/durrec.js)
      const m = swap ? E.matchup(PB, PA, o) : E.matchup(PA, PB, o);
      DR.assertApplied(m, f.id, params);
      const rng = E.makeRng(seedOf(f.id, swap ? 2 : 1));
      for (let s = 0; s < SIMS; s++) {
        const fight = E.simulate(m, rng, true), nr = fight.rounds.length;
        g.nF++;
        if (E.isDecision(fight)) g.nDEC++; else if (fight.method === "SUB") g.nSUB++; else g.nKO++;
        for (const rr of fight.rounds) {
          const r = rr.r, last = r === nr - 1;
          const secs = last && fight.fin && fight.round === r + 1 ? fight.t : 300;
          g.reach[nR][r]++; g.fsec[nR] += secs;
          if (rr.fin && rr.fin.how !== "SUB") g.koR[nR][r]++;
          for (const sd of ["A", "B"]) {
            const st = rr.st[sd], o2 = sd === "A" ? "B" : "A";
            g.att += st.sig_att; g.lnd += st.sig_lnd; g.tda += st.td_att; g.secs += secs;
            g.kd[nR][r] += st.kd; g.sh[nR][r] += st.sh_lnd; g.expSh += st.sh_lnd; g.expG += st.g_lnd;
            if (st.kd > 0) { g.kdN += st.kd; if (rr.fin && rr.fin.by === sd && rr.fin.how !== "SUB") g.conv++; }
            if (rr.fin && rr.fin.by === sd && st.kd === 0 && rr.st[o2].kd === 0) {
              if (rr.fin.how === "TKO" && !rr.fin.follow) g.stko++;
              if (rr.fin.how === "GNP") g.gtko++;
            }
          }
        }
      }
    }
  }
  const out = { attPm: g.att / (g.secs / 60), acc: g.lnd / g.att, tdPm: g.tda / (g.secs / 60), conv: g.conv / Math.max(1, g.kdN), stko: g.stko / g.expSh, gtko: g.gtko / g.expG,
    ko: g.nKO / g.nF, sub: g.nSUB / g.nF, dec: g.nDEC / g.nF };
  for (const R of [3, 5]) {
    let s = 0, w = 0, t = 0;
    for (let r = 0; r < R; r++) { s += g.kd[R][r]; w += g.sh[R][r]; t += g.sh[R][r] * T.kdCell(R, r); }
    out["kd" + R] = s / Math.max(1, w); out["kdT" + R] = t / Math.max(1, w); out["kdPm" + R] = s / (g.fsec[R] / 60);
    out["kdR" + R] = g.kd[R].map((x, r) => +(100 * x / Math.max(1, g.sh[R][r])).toFixed(3));
    out["koR" + R] = g.koR[R].map((x, r) => +(x / Math.max(1, g.reach[R][r])).toFixed(4));
  }
  return out;
}
const odds = (p) => p / (1 - p);
function show(lab, o) {
  console.log(`${lab}: att/min ${o.attPm.toFixed(3)} (T ${T.attPm.toFixed(3)}) acc ${o.acc.toFixed(4)} (T ${T.acc.toFixed(4)}) ` +
    `TDatt/min ${o.tdPm.toFixed(4)} (T ${T.tdPm != null ? T.tdPm.toFixed(4) : "-"}) ` +
    `KD/100sh 3rd ${(100 * o.kd3).toFixed(3)} (data ${(100 * o.kdT3).toFixed(3)}) 5rd ${(100 * o.kd5).toFixed(3)} (data ${(100 * o.kdT5).toFixed(3)}) ` +
    `KD/15 3rd ${(15 * o.kdPm3).toFixed(3)} (T ${(15 * T.kdPm3).toFixed(3)}) 5rd ${(15 * o.kdPm5).toFixed(3)} (T ${(15 * T.kdPm5).toFixed(3)}) ` +
    `conv ${o.conv.toFixed(3)} (T ${T.conv.toFixed(3)}) stko ${(1e4 * o.stko).toFixed(2)}e-4 (T ${(1e4 * T.stko).toFixed(2)}) gtko ${(1e3 * o.gtko).toFixed(2)}e-3 (T ${(1e3 * T.gtko).toFixed(2)}) ` +
    `| KO ${o.ko.toFixed(3)} (T ${T.ko != null ? T.ko.toFixed(3) : "-"}) SUB ${o.sub.toFixed(3)} DEC ${o.dec.toFixed(3)} | KD by rd 3: ${o.kdR3.join(" ")} 5: ${o.kdR5.join(" ")} | KO hazard 3: ${o.koR3.join(" ")} 5: ${o.koR5.join(" ")}`);
}
console.log(`dynamics_calibrate: ${fights.length} train fights (stride ${STRIDE}), ${SIMS} sims per orientation; params ${FP.version}`);
// real outcome mix of the same fights (KO incl. doctor, SUB, decisions incl. draws; NC / DQ dropped)
{
  let ko = 0, sub = 0, dec = 0;
  for (const f of fights) { const mth = f.result.method; if (mth === "KO" || mth === "DOC") ko++; else if (mth === "SUB") sub++; else if (["UD", "SD", "MD", "DRAW"].includes(mth)) dec++; }
  const n = ko + sub + dec;
  console.log(`real: KO ${(ko / n).toFixed(3)} SUB ${(sub / n).toFixed(3)} DEC ${(dec / n).toFixed(3)} | KD/100sh by rd 3: ${[0, 1, 2].map((r) => (100 * T.kdCell(3, r)).toFixed(3)).join(" ")} 5: ${[0, 1, 2, 3, 4].map((r) => (100 * T.kdCell(5, r)).toFixed(3)).join(" ")} | KO hazard 3: ${[1, 2, 3].map((r) => TG["3_" + r].p_round_ends_ko_tko.toFixed(4)).join(" ")} 5: ${[1, 2, 3, 4, 5].map((r) => TG["5_" + r].p_round_ends_ko_tko.toFixed(4)).join(" ")}`);
}
{
  const off = run({ components: { dynamics: false } });
  if (!args.includes("--target-real")) { T.attPm = off.attPm; T.acc = off.acc; T.tdPm = off.tdPm; T.ko = off.ko; }
  else { let ta = 0, mm = 0; for (const f of fights) { const a = f.actual; if (a && a.A && a.minutes) { ta += a.A.td_att + a.B.td_att; mm += 2 * a.minutes; } } T.tdPm = ta / mm; }
  show("flag off", off);
}
const L = Object.assign({}, FP.dyn, (extra.dyn || {}));
const names = ["outLevel", "accLevel", "tdLevel", "kdLevel3", "kdLevel5", "convLevel", "stkoScale", "gnpScale"];
if (L.tdLevel == null) L.tdLevel = 1;
for (let it = 0; it < ITERS; it++) {
  const params = { components: { dynamics: true }, dyn: {} };
  for (const k of Object.keys(extra)) if (k !== "dyn") params[k] = extra[k];
  for (const k of Object.keys(L)) params.dyn[k] = L[k];
  const o = run(params);
  show(`iter ${it}`, o);
  console.log("   levels " + JSON.stringify(Object.fromEntries(names.map((k) => [k, +L[k].toFixed(4)]))));
  if (it === ITERS - 1) break;
  L.outLevel *= T.attPm / o.attPm;
  L.accLevel *= odds(T.acc) / odds(o.acc);
  L.tdLevel *= T.tdPm / o.tdPm;
  L.kdLevel3 *= T.kdPm3 / o.kdPm3;
  L.kdLevel5 *= Math.pow(T.kdPm5 / o.kdPm5, 0.8);              // fewer 5-round fights: damp
  L.convLevel *= Math.pow(odds(T.conv) / odds(o.conv), 1.2);
  if (T.ko != null) {
    const fk = Math.pow(T.ko / o.ko, 2.5);                   // non-KD stoppages are ~1/3 of KO/TKOs
    L.stkoScale *= fk; L.gnpScale *= fk;
  } else {
    L.stkoScale *= Math.pow(T.stko / Math.max(o.stko, 1e-9), 0.8);
    L.gnpScale *= Math.pow(T.gtko / Math.max(o.gtko, 1e-9), 0.9);
  }
}
console.log("FINAL " + JSON.stringify(Object.fromEntries(names.map((k) => [k, +L[k].toFixed(4)]))));
