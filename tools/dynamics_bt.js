#!/usr/bin/env node
/* dynamics_bt.js: paired backtest runner for the fight-dynamics component (params.components.dynamics).

   Runs src/engine3.js on walk-forward backtest snapshots from data/derived/backtest_dev.json in both corner orders,
   with common random numbers across configurations (the seed depends only on the fight id and the orientation), and
   writes per-fight symmetric outcome probabilities, the method x round distribution, per-round stat rates for each
   real fighter (for exposure-matched stat-line predictions) and knockdown / stoppage counters. Scored by
   tools/dynamics_ablation.py; also used by tools/dynamics_calibrate.js.

   Leak-free inputs: frozen pre-fight profiles (backtest_dev.json), walk-forward division priors
   (data/derived/mlcal_priors_asof.json: rates from the 5 years before Jan 1 of the fight's year), and out-of-fold
   learned stat-line rates (data/derived/mlrates_oof.json, folds trained on 2010..year-1). No live roster values.
   v5 merge step 2: when a configuration runs the durability component (params.components.durability, on by default),
   each matchup gets the walk-forward record of data/derived/durability.json backtest[id] as opts.dur and the train-only
   NORM, exactly as tools/evalv.js does; a fight without a record throws (never the live-fit fallback).

   Hidden-data protocol (docs/BACKLOG.md): this tool refuses fights dated 2024-01-01 or later unless
   DYN_ALLOW_VALIDATION=1 is set (reserved for the single v5 validation measurement), and never reads 2026 fights.

   Usage:
     node tools/dynamics_bt.js --out <file.json> [--from 2019-01-01] [--to 2023-12-31] [--sims 200]
          [--part 0 --parts 1] [--cfg off='{"components":{"dynamics":false}}' --cfg on='{}'] [--max 0]
          [--csv <file.csv> --csv-cfg on --csv-sims 10]   (dynamics_engine.js-style rows for tools/dynamics.py checks)
     node tools/dynamics_bt.js --merge <out.json> <part files...>
   Default configs: off = components.dynamics false, on = components.dynamics true (the params3.js dyn block). */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);

if (args[0] === "--merge") {
  const out = args[1], parts = args.slice(2);
  const res = { meta: null, fights: {} };
  for (const f of parts) {
    const j = JSON.parse(fs.readFileSync(f, "utf8"));
    res.meta = res.meta || j.meta;
    Object.assign(res.fights, j.fights);
  }
  res.meta.n = Object.keys(res.fights).length; res.meta.parts = parts.map((p) => path.basename(p));
  fs.writeFileSync(out, JSON.stringify(res));
  console.log("merged", parts.length, "parts,", res.meta.n, "fights ->", out);
  process.exit(0);
}

function opt(k, d) { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; }
function optAll(k) { const o = []; args.forEach((a, i) => { if (a === k) o.push(args[i + 1]); }); return o; }
const OUT = opt("--out", null);
const FROM = opt("--from", "2019-01-01"), TO = opt("--to", "2023-12-31");
const SIMS = +opt("--sims", "200"), PART = +opt("--part", "0"), PARTS = +opt("--parts", "1"), MAX = +opt("--max", "0");
const CSV = opt("--csv", null), CSV_CFG = opt("--csv-cfg", "on"), CSV_SIMS = +opt("--csv-sims", "10");
const EDIR = path.resolve(opt("--engine-dir", path.join(ROOT, "src")));
if (!OUT) { console.error("--out required"); process.exit(2); }
if (TO >= "2024-01-01" && process.env.DYN_ALLOW_VALIDATION !== "1") {
  console.error("refusing: fights from 2024-01-01 are validation data (docs/BACKLOG.md hidden-data protocol); tune on 2019-2023");
  process.exit(2);
}
const HARD_TO = "2026-01-01";   // the vault is never read

const E = require(path.join(EDIR, "engine3.js"));
const FP = require(path.join(EDIR, "params3.js"));
function dataFile(rel) {
  const a = path.join(ROOT, rel);
  return fs.existsSync(a) ? a : path.join("/home/user/XX", rel);    // large gitignored files live in the main checkout
}
const bt = JSON.parse(fs.readFileSync(dataFile("data/derived/backtest_dev.json"), "utf8"));
const priorsAsof = JSON.parse(fs.readFileSync(dataFile("data/derived/mlcal_priors_asof.json"), "utf8"));
const oof = JSON.parse(fs.readFileSync(dataFile("data/derived/mlrates_oof.json"), "utf8"));
const TN = oof.meta.targets;
const keys = bt.meta.keys;
// durability component (v5 merge step 2): leak-free walk-forward records + train NORM (tools/durrec.js)
const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT);

const cfgArgs = optAll("--cfg");
const CFGS = [];
if (cfgArgs.length) for (const c of cfgArgs) { const i = c.indexOf("="); CFGS.push([c.slice(0, i), JSON.parse(c.slice(i + 1) || "{}")]); }
else { CFGS.push(["off", { components: { dynamics: false } }]); CFGS.push(["on", { components: { dynamics: true } }]); }

function seedOf(id, k) { return parseInt(crypto.createHash("md5").update(id + ":" + k).digest("hex").slice(0, 8), 16); }
function sha(file) { return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16); }
const r5 = (x) => Math.round(x * 1e5) / 1e5;

// per-round stat columns accumulated for each real fighter
const RS = ["sig_att", "sig_lnd", "h_lnd", "b_lnd", "l_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "sh_lnd", "g_lnd"];
const NRS = RS.length;
const STRIKE_FIN = { KO: 1, TKO: 1, GNP: 1, LEG: 1 };

let fights = bt.fights.filter((f) => f.date >= FROM && f.date <= TO && f.date < HARD_TO);
fights = fights.filter((f, i) => i % PARTS === PART);
if (MAX > 0) fights = fights.slice(0, MAX);

// --csv path: dynamics_engine.js-style rows for --csv-cfg; a path containing {cfg} writes one file per configuration
const CSV_HEAD = "fid,sim,idx,rnd,R,rsec,winner,method,fin_round,division,sig_att,sig_lnd,h_att,h_lnd,d_att,d_lnd,c_att,c_lnd,g_att,g_lnd,kd,td_att,td_lnd,ctrl,sub_att,sh_lnd,b_lnd,l_lnd,hurt,dmg_end";
const csvByCfg = {};
if (CSV) for (const [c] of CFGS) if (CSV.includes("{cfg}") || c === CSV_CFG) csvByCfg[c] = [CSV_HEAD];
const CSV_KEYS = ["sig_att", "sig_lnd", "h_att", "h_lnd", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "sh_lnd", "b_lnd", "l_lnd", "hurt"];

function optsFor(f, swap) {
  const pri = priorsAsof[f.date.slice(0, 4)];
  const generic = f.division === "Catch Weight" || f.division === "Open Weight" || (pri && !pri[f.division]);
  const division = generic ? (f.prior_division || f.division) : f.division;
  const o = { division, rounds: f.rounds || (f.title ? 5 : 3), title: !!f.title, date: f.date, priors: pri };
  const ent = oof.fights[f.id];
  if (ent && ent.A && ent.B) {
    const a = {}, b = {};
    TN.forEach((t, k) => { a[t] = ent.A[k]; b[t] = ent.B[k]; });
    o.ml = swap ? { A: b, B: a } : { A: a, B: b };
  } else o.ml = false;
  return o;
}

const res = {};
const t0 = Date.now();
let nDone = 0, nErr = 0;
for (const f of fights) {
  const nR = f.rounds || (f.title ? 5 : 3);
  const PA = Object.assign({ keys }, f.A), PB = Object.assign({ keys }, f.B);
  const rec = { date: f.date, rounds: nR, ml: !!(oof.fights[f.id]) };
  for (const [cname, cparams] of CFGS) {
    const acc = {
      pA: 0, pB: 0, pD: 0, bins: [0, 0, 0, 0, 0, 0, 0], ko: new Array(nR).fill(0), sub: new Array(nR).fill(0), dec: 0,
      // rate tables per real side (0 = backtest A, 1 = backtest B) and round: [reached, secs, ...RS]
      rt: [0, 1].map(() => Array.from({ length: nR }, () => new Array(2 + NRS).fill(0))),
      kd: new Array(nR).fill(0), kdConv: new Array(nR).fill(0), kdRounds: new Array(nR).fill(0),
      stko: 0, gtko: 0, expSh: 0, expG: 0, mins: 0, roundsReached: new Array(nR).fill(0), koEnd: new Array(nR).fill(0)
    };
    let ok = true;
    for (const swap of [false, true]) {
      let m;
      try {
        const o = optsFor(f, swap);
        o.params = cparams;
        DR.apply(o, f.id, swap);
        m = swap ? E.matchup(PB, PA, o) : E.matchup(PA, PB, o);
        DR.assertApplied(m, f.id, cparams);
      } catch (e) { ok = false; nErr++; if (nErr < 4) console.error(String(e && e.stack || e)); break; }
      const rng = E.makeRng(seedOf(f.id, swap ? 2 : 1));
      for (let s = 0; s < SIMS; s++) {
        const fight = E.simulate(m, rng, true);
        // winner in backtest orientation
        const wEng = fight.winner, wReal = wEng === "D" ? "D" : ((wEng === "A") !== swap ? "A" : "B");
        if (wReal === "A") acc.pA++; else if (wReal === "B") acc.pB++; else acc.pD++;
        const b = E.bucket(fight), bReal = swap ? 6 - b : b;
        acc.bins[bReal]++;
        const dec = E.isDecision(fight);
        if (dec) acc.dec++; else if (fight.method === "SUB") acc.sub[fight.round - 1]++; else acc.ko[fight.round - 1]++;
        acc.mins += dec ? nR * 5 : ((fight.round - 1) * 300 + fight.t) / 60;
        const nr = fight.rounds.length;
        for (const rr of fight.rounds) {
          const r = rr.r, last = r === nr - 1;
          const secs = last && fight.fin && fight.round === r + 1 && fight.method !== "DOC" && fight.method !== "CORNER" ? fight.t : 300;
          acc.roundsReached[r]++;
          for (let side = 0; side < 2; side++) {
            const eng = (side === 0) !== swap ? "A" : "B", st = rr.st[eng];
            const row = acc.rt[side][r];
            row[0]++; row[1] += secs;
            for (let k = 0; k < NRS; k++) row[2 + k] += st[RS[k]] || 0;
          }
          // knockdown conversion (per KD; the last KD of a round carries the finish) and non-KD stoppages
          for (const eng of ["A", "B"]) {
            const o2 = eng === "A" ? "B" : "A", kds = rr.st[eng].kd;
            acc.expSh += rr.st[eng].sh_lnd; acc.expG += rr.st[eng].g_lnd;
            if (kds > 0) {
              acc.kd[r] += kds; acc.kdRounds[r]++;
              if (rr.fin && rr.fin.by === eng && STRIKE_FIN[rr.fin.how]) acc.kdConv[r]++;
            }
            if (rr.fin && rr.fin.by === eng && rr.st[o2].kd === 0 && rr.st[eng].kd === 0) {
              if (rr.fin.how === "TKO" && !rr.fin.follow) acc.stko++;
              if (rr.fin.how === "GNP") acc.gtko++;
            }
          }
          if (rr.fin && STRIKE_FIN[rr.fin.how]) acc.koEnd[r]++;
        }
        const csvLines = csvByCfg[cname];
        if (csvLines && !swap && s < CSV_SIMS) {
          for (const rr of fight.rounds) {
            const last = rr.r === nr - 1;
            const rsec = last && fight.fin && fight.round === rr.r + 1 ? fight.t : 300;
            for (const [idx, side] of [[0, "A"], [1, "B"]]) {
              const st = rr.st[side];
              const row = [f.id, s, idx, rr.r + 1, nR, Math.round(rsec * 10) / 10, fight.winner, fight.method, fight.round, JSON.stringify(f.division)];
              for (const k of CSV_KEYS) row.push(st[k] != null ? st[k] : 0);
              row.push(idx === 0 ? rr.endState.dA : rr.endState.dB);
              csvLines.push(row.join(","));
            }
          }
        }
      }
    }
    if (!ok) { rec[cname] = { err: true }; continue; }
    const N = 2 * SIMS;
    rec[cname] = {
      pA: r5(acc.pA / N), pB: r5(acc.pB / N), pD: r5(acc.pD / N), bins: acc.bins.map((x) => r5(x / N)),
      ko: acc.ko.map((x) => r5(x / N)), sub: acc.sub.map((x) => r5(x / N)), dec: r5(acc.dec / N), mins: r5(acc.mins / N),
      rt: acc.rt.map((sd) => sd.map((row) => row.map((x) => r5(x)))), n: N,
      kd: acc.kd, kdConv: acc.kdConv, kdRounds: acc.kdRounds, stko: acc.stko, gtko: acc.gtko, expSh: r5(acc.expSh), expG: r5(acc.expG),
      reached: acc.roundsReached, koEnd: acc.koEnd
    };
  }
  res[f.id] = rec;
  if (++nDone % 50 === 0) console.error(`part ${PART}/${PARTS}: ${nDone}/${fights.length} (${((Date.now() - t0) / nDone).toFixed(0)} ms/fight)`);
}
const meta = {
  tool: "tools/dynamics_bt.js", engine_version: E.VERSION, params_version: FP.version, sims_per_orientation: SIMS,
  configs: CFGS, from: FROM, to: TO, engine3_sha256_16: sha(path.join(EDIR, "engine3.js")), params3_sha256_16: sha(path.join(EDIR, "params3.js")),
  inputs: "backtest_dev.json frozen profiles; mlcal_priors_asof.json walk-forward priors; mlrates_oof.json out-of-fold learned rates; durability.json backtest walk-forward records + train NORM when a configuration runs components.durability",
  orientation: "every number is in backtest order (A = first-named); averaged over the A-B and B-A runs with seeds md5(id:1), md5(id:2)",
  rt_columns: ["reached", "secs"].concat(RS), built: new Date().toISOString(), errors: nErr
};
fs.writeFileSync(OUT, JSON.stringify({ meta, fights: res }));
for (const c of Object.keys(csvByCfg)) fs.writeFileSync(CSV.replace("{cfg}", c), csvByCfg[c].join("\n") + "\n");
console.log(`done ${nDone} fights (${nErr} errors) in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${OUT}`);
