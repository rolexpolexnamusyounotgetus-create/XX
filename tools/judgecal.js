#!/usr/bin/env node
/* judgecal.js: fit engine v4's judging noise and 10-8 rule to real judges' rounds (train years only).

   Data: data/derived/judgerounds_rows.json (tools/judgerounds.py; MMA Decisions judge-by-round scores joined to the
   ufcstats per-round counts). Rows used: 2019-01-01 .. 2023-12-31 (the hidden-data protocol's train years), three
   judges, complete cards, ufcstats round stats present, deductions known (raw scores), no 10-10 rounds.

   Model (the engine's FightEngine.judgeRound without the engine-only hurt / power terms): judge j scores
   z_j = x + s + e_j, x = the EM round-winner logit of the round's ufcstats differentials (params3 judge weights:
   head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min, sub attempt 0.85; never refit here),
   s ~ N(0, sharedSd^2) shared by the panel, e_j ~ N(0, indSd^2). The round goes to sign(z_j); a 10-8 when
   |z_j| > t108 - t108kd x min(2, winner's KD edge). Maximum likelihood over (sharedSd, indSd, t108kd, t108 for
   2019-2020, t108 for 2021-2023), integrating s on a 161-point grid. The engine uses the 2021-2023 threshold: the
   10-8 rate fell back after 2020 (5.9% -> 3.6% of judge-rounds) and that is the most recent train era.

   Then a check with the engine's own judgeRound (tastes on, one fight-level taste draw per judge) on the same real
   rounds: non-unanimous share, pairwise disagreement, majority-vs-EM agreement by |x| band, 10-8 share (with and
   without a KD edge) and the unanimous / split / majority decision split of the complete fights, against the data.
   The engine-only damage terms (hurts, power) are then measured in simulated league-average decision rounds; their
   variance not explained by x is taken out of the shared noise (the real panel's shared noise already contains what
   judges see beyond the ufcstats counts), so the engine's total beyond-count variance matches the data.

     node tools/judgecal.js [--write] [--sims 4]        --write rewrites the [judgecal] values in src/params3.js
   Output: data/derived/judgecal.json (fit, standard errors, checks). */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const WRITE = args.includes("--write");
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const SIMS = +opt("--sims", 4);
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const J0 = FP.judge;

// ------------------------------------------------------------------ data
const D = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/judgerounds_rows.json"), "utf8"));
const RC = D.rounds.cols, rx = {}; RC.forEach((c, i) => { rx[c] = i; });
const SC = D.scores.cols, sx = {}; SC.forEach((c, i) => { sx[c] = i; });
const byRound = new Map();
for (const r of D.scores.rows) { const k = r[sx.ri]; if (!byRound.has(k)) byRound.set(k, []); byRound.get(k).push(r); }
const rounds = [];
let skipped = { even: 0, judges: 0 };
D.rounds.rows.forEach((r, i) => {
  const date = r[rx.date];
  if (!(date >= "2019-01-01" && date < "2024-01-01")) return;        // train years only
  if (!(r[rx.complete] && r[rx.has_stats] && r[rx.nJ] === 3 && r[rx.ded_A] != null && r[rx.ded_B] != null)) return;
  const js = byRound.get(i) || [];
  if (js.length !== 3) { skipped.judges++; return; }
  const o = [];
  for (const j of js) {
    const a = j[sx.A_raw] != null ? j[sx.A_raw] : j[sx.A] + r[rx.ded_A], b = j[sx.B_raw] != null ? j[sx.B_raw] : j[sx.B] + r[rx.ded_B];
    if (a === b) { o.length = 0; break; }
    o.push({ w: a > b ? 1 : -1, wide: Math.abs(a - b) >= 2 });
  }
  if (o.length !== 3) { skipped.even++; return; }
  const g = (s) => (+r[rx["A_" + s]] || 0) - (+r[rx["B_" + s]] || 0);
  const d = { head: g("head_l"), body: g("body_l"), leg: g("leg_l"), kd: g("kd"), td: g("td_l"), ctrl: g("ctrl"), sub: g("sub") };
  const x = J0.head * d.head + J0.body * d.body + J0.leg * d.leg + J0.kd * d.kd + J0.td * d.td + J0.ctrlMin * d.ctrl / 60 + J0.sub * d.sub;
  rounds.push({ fid: r[rx.fid], date, late: date >= "2021-01-01", rnd: r[rx.rnd], sched: r[rx.sched], d, x, o,
    nA: o.filter((q) => q.w > 0).length, nWide: o.filter((q) => q.wide).length });
});
console.log(`rounds: ${rounds.length} (2019-2023, 3 judges, complete, deductions known; skipped ${skipped.even} with a 10-10, ${skipped.judges} without 3 judge rows)`);

// ------------------------------------------------------------------ normal CDF (erfc, Numerical Recipes 6.2, |err| < 1.2e-7)
function erfc(x) {
  const z = Math.abs(x), t = 1 / (1 + 0.5 * z);
  const r = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 +
    t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return x >= 0 ? r : 2 - r;
}
const Phi = (x) => 0.5 * erfc(-x / Math.SQRT2);
const NG = 161, GS = [], GW = [];
for (let k = 0; k < NG; k++) { const s = -8 + 16 * k / (NG - 1); GS.push(s); GW.push(Math.exp(-0.5 * s * s)); }
const gw = GW.reduce((a, b) => a + b, 0); for (let k = 0; k < NG; k++) GW[k] /= gw;

// ------------------------------------------------------------------ likelihood
// th = [log sharedSd, log indSd, log indClose, t108kd (linear), log t108 early, log t108 late]
// individual sd = indSd x exp(-indClose x |x + s|): judges disagree mostly on rounds that look close to the whole panel
function negLL(th, sub) {
  const ss = Math.exp(th[0]), si = Math.exp(th[1]), gam = Math.exp(th[2]), kc = th[3], tE = Math.exp(th[4]), tL = Math.exp(th[5]);
  let nll = 0;
  for (const r of sub || rounds) {
    const t0 = r.late ? tL : tE;
    const TA = Math.max(0.05, t0 - kc * Math.min(2, Math.max(0, r.d.kd))), TB = Math.max(0.05, t0 - kc * Math.min(2, Math.max(0, -r.d.kd)));
    let L = 0;
    for (let k = 0; k < NG; k++) {
      const mu = r.x + ss * GS[k], sd = si * Math.exp(-gam * Math.abs(mu));
      const p0 = Phi(-mu / sd), pA8 = 1 - Phi((TA - mu) / sd), pB8 = Phi((-TB - mu) / sd);
      const pA9 = Math.max(1e-300, 1 - p0 - pA8), pB9 = Math.max(1e-300, p0 - pB8);
      let pr = GW[k];
      for (const q of r.o) pr *= q.w > 0 ? (q.wide ? Math.max(1e-300, pA8) : pA9) : (q.wide ? Math.max(1e-300, pB8) : pB9);
      L += pr;
    }
    nll -= Math.log(Math.max(1e-300, L));
  }
  return nll;
}
function nelderMead(f, x0, step, iters) {
  const n = x0.length;
  let P = [x0.slice()];
  for (let i = 0; i < n; i++) { const x = x0.slice(); x[i] += step[i]; P.push(x); }
  let F = P.map((x) => f(x));
  for (let it = 0; it < iters; it++) {
    const ord = F.map((v, i) => i).sort((a, b) => F[a] - F[b]); P = ord.map((i) => P[i]); F = ord.map((i) => F[i]);
    if (Math.abs(F[n] - F[0]) < 1e-7 * (1 + Math.abs(F[0]))) break;
    const c = new Array(n).fill(0); for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) c[j] += P[i][j] / n;
    const xr = c.map((v, j) => v + (v - P[n][j])), fr = f(xr);
    if (fr < F[0]) { const xe = c.map((v, j) => v + 2 * (v - P[n][j])), fe = f(xe); if (fe < fr) { P[n] = xe; F[n] = fe; } else { P[n] = xr; F[n] = fr; } }
    else if (fr < F[n - 1]) { P[n] = xr; F[n] = fr; }
    else {
      const xc = c.map((v, j) => v + 0.5 * (P[n][j] - v)), fc = f(xc);
      if (fc < F[n]) { P[n] = xc; F[n] = fc; }
      else { for (let i = 1; i <= n; i++) { P[i] = P[i].map((v, j) => P[0][j] + 0.5 * (v - P[0][j])); F[i] = f(P[i]); } }
    }
  }
  const b = F.indexOf(Math.min(...F));
  return { x: P[b], f: F[b] };
}
function hessianSE(f, x) {
  const n = x.length, h = 1e-3, H = [];
  for (let i = 0; i < n; i++) {
    H.push([]);
    for (let j = 0; j < n; j++) {
      const e = (a, b) => { const y = x.slice(); y[i] += a; y[j] += b; return f(y); };
      H[i].push((e(h, h) - e(h, -h) - e(-h, h) + e(-h, -h)) / (4 * h * h));
    }
  }
  // invert (Gauss-Jordan)
  const A = H.map((r, i) => r.concat(H.map((_, j) => (i === j ? 1 : 0))));
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const v = A[c][c]; for (let k = 0; k < 2 * n; k++) A[c][k] /= v;
    for (let r = 0; r < n; r++) if (r !== c) { const m = A[r][c]; for (let k = 0; k < 2 * n; k++) A[r][k] -= m * A[c][k]; }
  }
  return A.map((r, i) => Math.sqrt(Math.max(0, r[n + i])));
}

const t0 = Date.now();
const th0 = [Math.log(1.5), Math.log(1.3), Math.log(0.1), 0, Math.log(6.5), Math.log(7.3)];
let fit = nelderMead(negLL, th0, [0.3, 0.3, 0.8, 0.5, 0.2, 0.2], 800);
fit = nelderMead(negLL, fit.x, [0.08, 0.08, 0.3, 0.2, 0.05, 0.05], 800);
const se = hessianSE(negLL, fit.x);
const est = { sharedSd: Math.exp(fit.x[0]), indSd: Math.exp(fit.x[1]), indClose: Math.exp(fit.x[2]), t108kd: fit.x[3],
  t108_2019_2020: Math.exp(fit.x[4]), t108_2021_2023: Math.exp(fit.x[5]) };
const seLog = { sharedSd: se[0], indSd: se[1], indClose: se[2], t108kd: se[3], t108_2019_2020: se[4], t108_2021_2023: se[5] };
// reference: homoscedastic fit (indClose = 0), for the record
const fit0 = nelderMead((t) => negLL([t[0], t[1], -30, t[2], t[3], t[4]]), [fit.x[0], fit.x[1], fit.x[3], fit.x[4], fit.x[5]], [0.1, 0.1, 0.3, 0.05, 0.05], 600);
console.log(`ML fit (${((Date.now() - t0) / 1000).toFixed(1)} s): nll ${fit.f.toFixed(1)} over ${rounds.length} rounds (homoscedastic: ${fit0.f.toFixed(1)}, ` +
  `sharedSd ${Math.exp(fit0.x[0]).toFixed(3)}, indSd ${Math.exp(fit0.x[1]).toFixed(3)})`);
for (const k in est) console.log(`  ${k.padEnd(16)} ${est[k].toFixed(4)}  (se ${k === "t108kd" ? "" : "on log scale "}${seLog[k].toFixed(3)})`);

// within-judge persistence: when the same judge dissents twice in a fight, same direction or not (tastes would make it
// the same direction more often than not)
let pSame = 0, pOpp = 0, pOther = 0;
{
  const byF = new Map();
  for (const r of rounds) { if (!byF.has(r.fid)) byF.set(r.fid, []); byF.get(r.fid).push(r); }
  for (const rs of byF.values()) {
    const dis = [];
    for (const r of rs) { if (r.nA === 1 || r.nA === 2) { const maj = r.nA >= 2 ? 1 : -1; r.o.forEach((q, j) => { if (q.w !== maj) dis.push([j, q.w]); }); } }
    for (let a = 0; a < dis.length; a++) for (let b = a + 1; b < dis.length; b++) {
      if (dis[a][0] !== dis[b][0]) pOther++; else if (dis[a][1] === dis[b][1]) pSame++; else pOpp++;
    }
  }
}
console.log(`  dissent pairs in a fight: same judge same direction ${pSame}, same judge opposite ${pOpp}, different judges ${pOther} ` +
  `(independence: same judge 1/3 of pairs, half of them each way) -> no fight-level judge taste`);

// ------------------------------------------------------------------ checks with the engine's judgeRound (tastes on)
function dataStats(rs) {
  let nonU = 0, pairDis = 0, wide = 0, jr = 0, wideKd = 0, jrKd = 0, wideNo = 0, jrNo = 0, agree = 0, dec = 0;
  const bands = [0, 0.5, 1, 2, 3, Infinity], bn = [0, 0, 0, 0, 0], bu = [0, 0, 0, 0, 0], ba = [0, 0, 0, 0, 0];
  for (const r of rs) {
    const nA = r.nA, u = nA === 0 || nA === 3;
    if (!u) nonU++;
    pairDis += nA * (3 - nA) / 3;
    const maj = nA >= 2 ? 1 : -1, em = r.x > 0 ? 1 : (r.x < 0 ? -1 : 0);
    if (em !== 0) { dec++; if (maj === em) agree++; }
    const ax = Math.abs(r.x); let b = 0; while (ax >= bands[b + 1]) b++;
    bn[b]++; if (u) bu[b]++; if (em !== 0 && maj === em) ba[b]++;
    for (const q of r.o) {
      const kdE = q.w > 0 ? r.d.kd : -r.d.kd;
      jr++; if (q.wide) wide++;
      if (kdE > 0) { jrKd++; if (q.wide) wideKd++; } else { jrNo++; if (q.wide) wideNo++; }
    }
  }
  const n = rs.length;
  return { rounds: n, nonUnanimous: nonU / n, pairDisagree: pairDis / n, majorityAgreesEM: agree / Math.max(1, dec), r108: wide / jr,
    r108_kdEdge: wideKd / Math.max(1, jrKd), r108_noKdEdge: wideNo / Math.max(1, jrNo),
    unanimousByBand: bu.map((v, i) => v / Math.max(1, bn[i])), majorityAgreesByBand: ba.map((v, i) => v / Math.max(1, bn[i])), bandN: bn };
}
function decisionSplit(fightRounds, cardsOf) {
  let ud = 0, sd = 0, md = 0, dr = 0;
  for (const [fid, rs] of fightRounds) {
    const c = cardsOf(fid, rs);
    let a = 0, b = 0; for (const x of c) { if (x[0] > x[1]) a++; else if (x[1] > x[0]) b++; }
    if (a === 3 || b === 3) ud++; else if ((a === 2 && b === 1) || (b === 2 && a === 1)) sd++; else if (a === 2 || b === 2) md++; else dr++;
  }
  const n = ud + sd + md + dr, nd = ud + sd + md;
  return { fights: n, UD: ud / Math.max(1, nd), SD: sd / Math.max(1, nd), MD: md / Math.max(1, nd), drawShare: dr / Math.max(1, n) };
}
const fights = new Map();
for (const r of rounds) { if (!fights.has(r.fid)) fights.set(r.fid, []); fights.get(r.fid).push(r); }
// complete decisions only: every scheduled round present
const fullFights = new Map([...fights].filter(([, rs]) => rs.length === rs[0].sched));
const realCards = (fid, rs) => {
  const c = [[0, 0], [0, 0], [0, 0]];
  for (const r of rs) r.o.forEach((q, j) => { c[j][0] += q.w > 0 ? 10 : (q.wide ? 8 : 9); c[j][1] += q.w > 0 ? (q.wide ? 8 : 9) : 10; });
  return c;
};
const dataAll = dataStats(rounds), dataLate = dataStats(rounds.filter((r) => r.late));
const dataDec = decisionSplit(fullFights, realCards);

function simulateJudges(Jp, rs, nSims, seed, tasteOn) {
  // per fight: draw tastes once (as the engine does), then judge every round with judgeRound
  const rng = E.makeRng(seed);
  const out = [];
  const decCards = [];
  for (let s = 0; s < nSims; s++) {
    for (const [fid, frs] of rs) {
      const tS = [1, 1, 1], tG = [1, 1, 1], tP = [1, 1, 1];
      const lnorm = (sd) => (sd > 0 ? Math.exp(sd * rng.normal() - 0.5 * sd * sd) : 1);
      for (let j = 0; j < 3; j++) { tS[j] = tasteOn ? lnorm(Jp.tasteSd) : 1; tG[j] = tasteOn ? lnorm(Jp.tasteSd) : 1; tP[j] = tasteOn ? lnorm(Jp.tasteSd) : 1; }
      const cards = [[0, 0], [0, 0], [0, 0]];
      for (const r of frs) {
        const js = [], c0 = [[0, 0], [0, 0], [0, 0]];
        E.judgeRound(Jp, 0, r.d.head, r.d.body, r.d.leg, r.d.kd, r.d.td, r.d.ctrl, r.d.sub, 0, 0, tS, tG, tP, rng, c0, js);
        const o = js.map((x) => ({ w: x[0] > x[1] ? 1 : -1, wide: Math.abs(x[0] - x[1]) >= 2 }));
        out.push({ x: r.x, d: r.d, o, nA: o.filter((q) => q.w > 0).length });
        js.forEach((x, j) => { cards[j][0] += x[0]; cards[j][1] += x[1]; });
      }
      if (frs.length === frs[0].sched) decCards.push(cards);
    }
  }
  let ud = 0, sd = 0, md = 0, dr = 0;
  for (const c of decCards) {
    let a = 0, b = 0; for (const x of c) { if (x[0] > x[1]) a++; else if (x[1] > x[0]) b++; }
    if (a === 3 || b === 3) ud++; else if ((a === 2 && b === 1) || (b === 2 && a === 1)) sd++; else if (a === 2 || b === 2) md++; else dr++;
  }
  const nd = ud + sd + md;
  return { rounds: dataStats(out), dec: { fights: decCards.length / nSims, UD: ud / nd, SD: sd / nd, MD: md / nd, drawShare: dr / decCards.length } };
}
const Jfit = Object.assign({}, J0, { sharedSd: est.sharedSd, indSd: est.indSd, indClose: est.indClose, t108kd: est.t108kd, t108: est.t108_2021_2023 });
const JfitEarly = Object.assign({}, Jfit, { t108: est.t108_2019_2020 });
const lateFights = new Map([...fights].filter(([, rs]) => rs[0].late)), earlyFights = new Map([...fights].filter(([, rs]) => !rs[0].late));
const simLateT = simulateJudges(Jfit, lateFights, SIMS, 11, true), simEarlyT = simulateJudges(JfitEarly, earlyFights, SIMS, 12, true);
const simLate0 = simulateJudges(Jfit, lateFights, SIMS, 11, false);
// pooled 2019-2023 check: each era with its own threshold
function pool(a, b, na, nb) {
  const o = {}; for (const k in a) o[k] = Array.isArray(a[k]) ? a[k].map((v, i) => (v * na + b[k][i] * nb) / (na + nb)) : (typeof a[k] === "number" ? (a[k] * na + b[k] * nb) / (na + nb) : a[k]);
  return o;
}
const nL = rounds.filter((r) => r.late).length, nE = rounds.length - nL;
const simAll = { rounds: pool(simLateT.rounds, simEarlyT.rounds, nL, nE), dec: pool(simLateT.dec, simEarlyT.dec, lateFights.size, earlyFights.size) };

function show(name, d, s) {
  const f = (v) => (100 * v).toFixed(1) + "%";
  console.log(`  ${name.padEnd(26)} data ${f(d)}  model ${f(s)}`);
}
console.log("\ncheck on the same real rounds, engine judgeRound with tastes (sd " + J0.tasteSd + "), " + SIMS + " panels per round:");
show("non-unanimous rounds", dataAll.nonUnanimous, simAll.rounds.nonUnanimous);
show("pairwise disagreement", dataAll.pairDisagree, simAll.rounds.pairDisagree);
show("majority agrees with EM", dataAll.majorityAgreesEM, simAll.rounds.majorityAgreesEM);
show("10-8 share (2019-2023)", dataAll.r108, simAll.rounds.r108);
show("10-8 share (2021-2023)", dataLate.r108, simLateT.rounds.r108);
show("10-8 | KD edge", dataAll.r108_kdEdge, simAll.rounds.r108_kdEdge);
show("10-8 | no KD edge", dataAll.r108_noKdEdge, simAll.rounds.r108_noKdEdge);
console.log("  unanimous by |EM| band 0-.5/.5-1/1-2/2-3/3+: data " + dataAll.unanimousByBand.map((v) => (100 * v).toFixed(0)).join("/") +
  "  model " + simAll.rounds.unanimousByBand.map((v) => (100 * v).toFixed(0)).join("/"));
console.log("  majority=EM by band:                      data " + dataAll.majorityAgreesByBand.map((v) => (100 * v).toFixed(0)).join("/") +
  "  model " + simAll.rounds.majorityAgreesByBand.map((v) => (100 * v).toFixed(0)).join("/"));
console.log(`  decisions (${dataDec.fights} complete fights): data UD ${(100 * dataDec.UD).toFixed(1)} SD ${(100 * dataDec.SD).toFixed(1)} MD ${(100 * dataDec.MD).toFixed(1)}` +
  `  model UD ${(100 * simAll.dec.UD).toFixed(1)} SD ${(100 * simAll.dec.SD).toFixed(1)} MD ${(100 * simAll.dec.MD).toFixed(1)}` +
  `  (no tastes, 2021-23: UD ${(100 * simLate0.dec.UD).toFixed(1)})`);

// ------------------------------------------------------------------ engine-only damage terms vs the shared noise
// simulated league-average decision rounds (Lightweight, 3 rounds, train-only priors): residual variance of
// hurt * dHurt + power * head * dPow after regressing on the count-based x
const PRI = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/priors_dev.json"), "utf8")).priors;
function avgProfile(div, tag) {
  const P = PRI[div], S = {};
  for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;
  return { name: `${tag} ${div}`, division: div, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}
const mm = E.matchup(avgProfile("Lightweight", "A"), avgProfile("Lightweight", "B"), { division: "Lightweight", rounds: 3, priors: PRI, ml: false });
const rngE = E.makeRng(99);
let sx2 = 0, sxh = 0, sh = 0, sh2 = 0, sxx = 0, nr = 0;
for (let i = 0; i < 4000; i++) {
  const f = E.simulate(mm, rngE, true);
  for (const rec of f.rounds) {
    if (rec.fin) continue;
    const a = rec.st.A, b = rec.st.B;
    const x = J0.head * (a.h_lnd - b.h_lnd) + J0.body * (a.b_lnd - b.b_lnd) + J0.leg * (a.l_lnd - b.l_lnd) + J0.kd * (a.kd - b.kd) +
      J0.td * (a.td_lnd - b.td_lnd) + J0.ctrlMin * (a.ctrl - b.ctrl) / 60 + J0.sub * (a.sub_att - b.sub_att);
    const h = J0.hurt * (a.hurt - b.hurt) + J0.power * J0.head * ((a.dmg - a.h_lnd) - (b.dmg - b.h_lnd));
    sxx += x * x; sxh += x * h; sh += h; sh2 += h * h; sx2 += x; nr++;
  }
}
const beta = sxh / sxx, varH = sh2 / nr - (sh / nr) ** 2, resid = Math.max(0, varH - beta * beta * sxx / nr + 0);
const sharedEngine = Math.sqrt(Math.max(0.5 * est.sharedSd ** 2, est.sharedSd ** 2 - resid));
console.log(`\nengine-only damage terms in ${nr} simulated league-average rounds: sd ${Math.sqrt(varH).toFixed(3)}, beta on x ${beta.toFixed(3)}, ` +
  `residual var ${resid.toFixed(3)} -> engine sharedSd ${sharedEngine.toFixed(3)} (data ${est.sharedSd.toFixed(3)})`);

const tasteNote = { sameJudgeSameDir: pSame, sameJudgeOpposite: pOpp, differentJudges: pOther };
const result = {
  meta: { tool: "tools/judgecal.js", built: new Date().toISOString(), data: "data/derived/judgerounds_rows.json, 2019-01-01..2023-12-31 rows only",
    rounds: rounds.length, fights: fights.size, complete_decisions: fullFights.size, weights: { head: J0.head, body: J0.body, leg: J0.leg, kd: J0.kd, td: J0.td, ctrlMin: J0.ctrlMin, sub: J0.sub },
    model: "z_j = x + s + e_j; s ~ N(0, sharedSd^2) per round, e_j ~ N(0, (indSd exp(-indClose |x + s|))^2); 10-8 when |z_j| > t108 - t108kd x min(2, winner KD edge)" },
  fit: { estimates: est, se: seLog, nll: fit.f, homoscedastic: { nll: fit0.f, sharedSd: Math.exp(fit0.x[0]), indSd: Math.exp(fit0.x[1]) }, dissentPersistence: tasteNote },
  engine: { sharedSd: +sharedEngine.toFixed(4), indSd: +est.indSd.toFixed(4), indClose: +est.indClose.toFixed(4), t108: +est.t108_2021_2023.toFixed(4), t108kd: +est.t108kd.toFixed(4),
    note: "t108 = the 2021-2023 threshold (latest train era); sharedSd reduced by the residual variance of the engine-only hurt / power terms",
    damageTerms: { rounds: nr, sd: Math.sqrt(varH), betaOnX: beta, residualVar: resid } },
  checks: { data: { all: dataAll, late: dataLate, decisions: dataDec }, model: { all: simAll, late: simLateT, lateNoTaste: simLate0 } }
};
fs.writeFileSync(path.join(ROOT, "data/derived/judgecal.json"), JSON.stringify(result, null, 1));
console.log("wrote data/derived/judgecal.json");

if (WRITE) {
  const pf = path.join(ROOT, "src/params3.js");
  let src = fs.readFileSync(pf, "utf8");
  const vals = { sharedSd: result.engine.sharedSd, indSd: result.engine.indSd, indClose: result.engine.indClose, t108: result.engine.t108, t108kd: result.engine.t108kd };
  for (const [k, v] of Object.entries(vals)) {
    const re = new RegExp("^(\\s*)" + k + ":\\s*[-0-9.eE]+(,?)(\\s*//\\s*\\[judgecal\\])", "m");
    if (!re.test(src)) throw new Error("judgecal: could not find [judgecal] entry " + k);
    src = src.replace(re, (all, ind, comma, cm) => `${ind}${k}: ${+(+v).toPrecision(4)}${comma}${cm}`);
  }
  fs.writeFileSync(pf, src);
  console.log("rewrote [judgecal] values in src/params3.js:", JSON.stringify(vals));
}
