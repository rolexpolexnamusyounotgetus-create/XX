#!/usr/bin/env node
/* officials_engcal.js: the officials judging model's engine-only adjustment (params.officials.engAdj).

   The judging model is fit on real rounds, where the panel's shared noise already contains everything judges see
   beyond the ufcstats counts (wobbles, power). The engine adds explicit engine-only terms (hurts, power beyond the
   count; v4's hurt and judgePower terms). Adding them on top would count that information twice: rounds would be
   too lopsided (too few split decisions, too many 10-8s). So the engine uses only their part not explained by the
   counts, r = b_head (hurtHS (dHurt - aH x) + judgePower (dPow - aP x)), x = the count index V + b_kd dKD + G, and takes
   r's variance out of the per-round shared noise (and thK^2 var(r) out of the 10-8 shared noise).

   aH, aP (slopes through the origin) and the residual covariance (vHH, vHP, vPP) are measured on judged rounds of
   simulated 2019-2023 backtest fights (train years only; no outcomes are used): frozen pre-fight profiles, priors as of
   the fight year, out-of-fold ML rates, both corner orders.

     node tools/officials_engcal.js [--fights 500] [--n 60] [--write]   (--write updates engAdj in src/params3.js) */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const ML = require(path.join(ROOT, "src/ml/mlrates.js"));
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const NF = +opt("--fights", 500), N = +opt("--n", 60);
function derived(name) {
  const a = path.join(ROOT, "data/derived", name);
  return fs.existsSync(a) ? a : path.join("/home/user/XX/data/derived", name);
}
const load = (n) => JSON.parse(fs.readFileSync(derived(n), "utf8"));
const BT = load("backtest_dev.json"), PRI = load("mlcal_priors_asof.json"), OOF = load("mlrates_oof.json");
const DEV = ML.load(load("mlrates_dev.json"));
const fights = BT.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");
const step = Math.max(1, Math.floor(fights.length / NF));
const O = FP.officials, b = O.beta;
function prof(sd) { return { name: sd.name, S: sd.S, age: sd.age, ko_losses: sd.ko_losses || 0, division: sd.home, pace: sd.pace, pace_w: sd.pace_w }; }
function rates(arr) { const o = {}; OOF.meta.targets.forEach((t, i) => { o[t] = arr[i]; }); return o; }

let sxx = 0, sxh = 0, sxp = 0, n = 0;
const X = [], H = [], Pw = [];
let used = 0;
for (let fi = 0; fi < fights.length && used < NF; fi += step, used++) {
  const f = fights[fi], ent = OOF.fights[f.id];
  for (let sw = 0; sw < 2; sw++) {
    const opts = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: PRI[f.date.slice(0, 4)],
      params: { components: { officials: false } } };
    if (ent) { const rA = rates(ent.A), rB = rates(ent.B); opts.ml = { pred: sw ? { A: rB, B: rA } : { A: rA, B: rB }, model: DEV }; }
    const m = E.matchup(prof(sw ? f.B : f.A), prof(sw ? f.A : f.B), opts);
    for (let s = 0; s < N; s++) {
      const fo = E.simulate(m, E.makeRng(1000003 * fi + 7919 * sw + s + 1), true);
      for (const rec of fo.rounds) {
        if (!rec.judges) continue;
        const A = rec.st.A, B = rec.st.B;
        const x = b.head * (A.h_lnd - B.h_lnd) + b.body * (A.b_lnd - B.b_lnd) + b.leg * (A.l_lnd - B.l_lnd) + b.kd * (A.kd - B.kd) +
          b.td * (A.td_lnd - B.td_lnd) + b.ctrlMin * (A.ctrl - B.ctrl) / 60 + b.sub * (A.sub_att - B.sub_att) + b.rev * (A.rev - B.rev);
        const dh = A.hurt - B.hurt, dp = (A.dmg - A.h_lnd) - (B.dmg - B.h_lnd);
        X.push(x); H.push(dh); Pw.push(dp);
        sxx += x * x; sxh += x * dh; sxp += x * dp; n++;
      }
    }
  }
}
const aH = sxh / sxx, aP = sxp / sxx;
let vHH = 0, vHP = 0, vPP = 0;
for (let i = 0; i < n; i++) { const rh = H[i] - aH * X[i], rp = Pw[i] - aP * X[i]; vHH += rh * rh; vHP += rh * rp; vPP += rp * rp; }
vHH /= n; vHP /= n; vPP /= n;
const hurtHS = O.hurtHS != null ? O.hurtHS : FP.judge.hurt / FP.judge.head, jp = FP.judge.power;
const varR = b.head * b.head * (hurtHS * hurtHS * vHH + 2 * hurtHS * jp * vHP + jp * jp * vPP);
let rawVar = 0; for (let i = 0; i < n; i++) { const d = b.head * (hurtHS * H[i] + jp * Pw[i]); rawVar += d * d; } rawVar /= n;
const out = { aH: +aH.toFixed(5), aP: +aP.toFixed(5), vHH: +vHH.toFixed(5), vHP: +vHP.toFixed(5), vPP: +vPP.toFixed(5) };
console.log(JSON.stringify({ rounds: n, fights: used, sims: N, engAdj: out, at_defaults: { hurtHS, judgePower: jp, var_engine_terms: rawVar, var_residual: varR,
  sigmaU: O.sigmaU, roundShared: Math.sqrt((1 - O.sharedFight) * O.sigmaU * O.sigmaU),
  roundSharedAdj: Math.sqrt(Math.max(0.05, (1 - O.sharedFight) * O.sigmaU * O.sigmaU - varR)) } }, null, 1));
if (args.includes("--write")) {
  const p = path.join(ROOT, "src/params3.js");
  let src = fs.readFileSync(p, "utf8");
  const re = /engAdj: \{[^}]*\}/;
  if (!re.test(src)) throw new Error("engAdj not found in params3.js");
  src = src.replace(re, "engAdj: { aH: " + out.aH + ", aP: " + out.aP + ", vHH: " + out.vHH + ", vHP: " + out.vHP + ", vPP: " + out.vPP + " }");
  fs.writeFileSync(p, src);
  console.log("wrote engAdj to src/params3.js");
}
