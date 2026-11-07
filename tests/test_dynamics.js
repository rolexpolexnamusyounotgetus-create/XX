// Fight-dynamics component tests (params.components.dynamics; research/model_dynamics.md E1-E11).
//
//   node tests/test_dynamics.js [--quick]
//
// 1. Flag off reproduces the engine before the component bit for bit: tests/fixtures/engine3_pre_dynamics.js is a frozen
//    copy of src/engine3.js from the commit the component was built on. Both engines get the same params (the frozen one
//    ignores `components` / `dyn`) and the same seeds; every traced fight and every summary must be identical, with and
//    without the learned stat-line rates. When the component is re-applied on top of a newer engine, refresh the fixture
//    from that engine (cp src/engine3.js tests/fixtures/engine3_pre_dynamics.js before applying the patch).
// 2. Flag on: determinism, trace parity, API and trace format unchanged.
// 3. Focused behaviour: AR(1) persistence, knockdown hazard by round, knockdown momentum, grappling carry-over,
//    mutual pace and the kPace prior, non-knockdown stoppage round decay.
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const QUICK = process.argv.includes("--quick");

const P = require(path.join(ROOT, "src/params3.js"));
const MLR = require(path.join(ROOT, "src/ml/mlrates.js"));
const E = require(path.join(ROOT, "src/engine3.js"));
// the frozen engine finds params / MLRates on the global object (its relative requires do not resolve from fixtures/)
globalThis.FightParams = P;
globalThis.MLRates = MLR;
const E0 = require(path.join(ROOT, "tests/fixtures/engine3_pre_dynamics.js"));
delete globalThis.FightParams;
delete globalThis.MLRates;

const dbJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8"));
E.loadDB(dbJson);
E0.loadDB(dbJson);

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
// v5 Calibrate B: components.calB (a later step; its judge.t108 acts with dynamics off too) is off in the flag-off identity checks
const OFF = { components: { dynamics: false, calB: false, v501: false } };
const ON = { components: { dynamics: true } };
function strip(f) { return JSON.stringify(f); }
function mean(a) { return a.reduce((x, y) => x + y, 0) / Math.max(1, a.length); }
function corr(x, y) {
  const mx = mean(x), my = mean(y);
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < x.length; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
  return sxy / Math.sqrt(sxx * syy);
}

console.log(`dynamics component tests: engine ${E.VERSION}, params ${P.version}, default components.dynamics = ${P.components && P.components.dynamics}`);

// ---------------------------------------------------------------- 1. flag off == pre-component engine, bit for bit
const slugs = Object.keys(dbJson.fighters).filter((s) => (dbJson.fighters[s].n_fights || dbJson.fighters[s].n || 0) >= 4).sort();
const pairs = [["alexander-volkanovski", "justin-gaethje", { rounds: 5, title: true }],
  ["alexander-volkanovski", "justin-gaethje", { rounds: 3 }]];
for (let k = 0; k < (QUICK ? 4 : 10); k++) {
  const a = slugs[(k * 97 + 13) % slugs.length], b = slugs[(k * 61 + 211) % slugs.length];
  if (a !== b) pairs.push([a, b, { rounds: k % 3 === 0 ? 5 : 3, title: k % 3 === 0 }]);
}
const manA = E.manualProfile({ name: "Manual A", slpm: 5.2, sapm: 3.9, acc: 0.5, def: 0.58, td15: 1.8, tdAcc: 0.4, tdDef: 0.7, sub15: 0.6 }, { division: "Welterweight" });
const manB = E.manualProfile({ name: "Manual B", slpm: 3.6, sapm: 3.2, acc: 0.44, def: 0.55, td15: 0.4, kd15: 0.9 }, { division: "Welterweight" });
pairs.push([manA, manB, { rounds: 3, division: "Welterweight" }]);
const SEEDS = QUICK ? 60 : 200;
let mlModel = null;
try { mlModel = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlrates.json"), "utf8")); } catch (e) { mlModel = null; }
for (const useML of [false, true]) {
  if (useML && !mlModel) { check("ML model available for the flag-off parity check", false, "data/derived/mlrates.json missing"); continue; }
  if (useML) { E.loadMLRates(mlModel); E0.loadMLRates(mlModel); }
  let same = true, nf = 0, bad = "";
  for (const [a, b, o] of pairs) {
    const opts = Object.assign({ date: "2026-11-06", params: OFF }, o);
    if (!useML) opts.ml = false;
    const m1 = E.matchup(a, b, opts), m0 = E0.matchup(a, b, opts);
    if (m1.dyn !== null) { same = false; bad = "m.dyn set with the flag off"; break; }
    for (let s = 1; s <= SEEDS && same; s++) {
      const tr = s % 2 === 0;
      const f1 = strip(E.simulate(m1, E.makeRng(s * 7919), tr)), f0 = strip(E0.simulate(m0, E0.makeRng(s * 7919), tr));
      nf++;
      if (f1 !== f0) { same = false; bad = (a.slug || a) + " vs " + (b.slug || b) + " seed " + s; }
    }
    if (!same) break;
    const s1 = E.summarize(m1, 600, 4242), s0 = E0.summarize(m0, 600, 4242);
    if (JSON.stringify(s1) !== JSON.stringify(s0)) { same = false; bad = "summary " + (a.slug || a) + " vs " + (b.slug || b); break; }
  }
  check(`flag off reproduces the pre-dynamics engine bit for bit (${useML ? "learned rates" : "plain rates"})`, same,
    same ? `${nf} fights over ${pairs.length} matchups, traced and untraced, plus summaries` : bad);
}
// a shared rng stream across many fights stays aligned too (draw order unchanged)
{
  const o = { rounds: 5, title: true, date: "2026-11-06", params: OFF };
  const m1 = E.matchup("alexander-volkanovski", "justin-gaethje", o), m0 = E0.matchup("alexander-volkanovski", "justin-gaethje", o);
  const r1 = E.makeRng(99), r0 = E0.makeRng(99);
  let ok = true;
  for (let i = 0; i < (QUICK ? 300 : 1500) && ok; i++) ok = strip(E.simulate(m1, r1, i % 3 === 0)) === strip(E0.simulate(m0, r0, i % 3 === 0));
  check("flag off: a shared rng stream stays aligned with the pre-dynamics engine", ok);
}
E.loadMLRates(null); E0.loadMLRates(null);

// ---------------------------------------------------------------- 2. flag on: determinism, trace parity, format
const VG5 = { rounds: 5, title: true, date: "2026-11-06", params: ON };
const mOn = E.matchup("alexander-volkanovski", "justin-gaethje", VG5);
check("flag on builds the dynamics tables", !!mOn.dyn && mOn.dyn.pace[0].length === 5 && mOn.dyn.kdP.length === 5);
check("flag on: same seed, same fight", strip(E.simulate(mOn, E.makeRng(5), true)) === strip(E.simulate(mOn, E.makeRng(5), true)));
{
  let ok = true, bad = -1;
  for (let s = 1; s <= 300 && ok; s++) {
    const a = E.simulate(mOn, E.makeRng(s), false), b = E.simulate(mOn, E.makeRng(s), true);
    if (a.winner !== b.winner || a.method !== b.method || a.round !== b.round || a.t !== b.t || JSON.stringify(a.totals) !== JSON.stringify(b.totals)) { ok = false; bad = s; }
  }
  check("flag on: trace on/off gives the same fight (300 seeds)", ok, ok ? "" : "seed " + bad);
}
{
  // the fight object, round record, stat line and, per event kind, the event fields, pooled over 200 traced fights each
  // (event fields depend on the kind: a strike carries tg, a clinch does not, so compare kind by kind)
  const mOff = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { params: OFF }));
  const keys = (o) => Object.keys(o).sort().join(",");
  function shape(m) {
    const top = new Set(), rec = new Set(), st = new Set(), ev = {};
    for (let s = 1; s <= 200; s++) {
      const f = E.simulate(m, E.makeRng(s * 31), true);
      top.add(keys(f));
      for (const r of f.rounds) {
        rec.add(keys(r).replace(/(^|,)ded(?=,|$)/, ""));   // rec.ded only on rounds with a point deduction (v4.0.1)
        st.add(keys(r.st.A)); st.add(keys(r.st.B));
        for (const e of r.ev) (ev[e.k] = ev[e.k] || new Set()).add(keys(e));
      }
    }
    const kinds = Object.keys(ev).sort();
    return { top: [...top].sort().join("|"), rec: [...rec].sort().join("|"), st: [...st].sort().join("|"),
      ev: kinds.map((k) => k + ":" + [...ev[k]].sort().join("/")).join(" "), kinds };
  }
  const a = shape(mOn), b = shape(mOff);
  const common = a.kinds.filter((k) => b.kinds.includes(k));
  const evSame = common.every((k) => a.ev.split(" ").find((x) => x.startsWith(k + ":")) === b.ev.split(" ").find((x) => x.startsWith(k + ":")));
  check("flag on keeps the fight object and trace format", a.top === b.top && a.rec === b.rec && a.st === b.st && evSame && common.length >= 6,
    `fight ${a.top === b.top}, round ${a.rec === b.rec}, stats ${a.st === b.st}, events ${evSame} over kinds ${common.join(" ")}`);
}
{
  const sOn = E.summarize(mOn, 3000, 3), sOff = E.summarize(E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { params: OFF })), 3000, 3);
  check("flag on changes the simulation", JSON.stringify(sOn.bins) !== JSON.stringify(sOff.bins));
  check("flag on: probabilities sum to 1", Math.abs(sOn.bins.reduce((x, y) => x + y, 0) - 1) < 1e-9);
}

// ---------------------------------------------------------------- 3. focused behaviour
// round-level stats from traced fights: output persistence (log sig attempts per minute of full rounds)
function roundStats(m, n, seed) {
  const r1 = [], r2 = [], kdBy = [], shBy = [], reached = [], koIn = [];
  for (let k = 0; k < m.rounds; k++) { kdBy.push(0); shBy.push(0); reached.push(0); koIn.push(0); }
  const rng = E.makeRng(seed);
  for (let i = 0; i < n; i++) {
    const f = E.simulate(m, rng, true);
    for (const rec of f.rounds) {
      reached[rec.r]++;
      for (const sd of ["A", "B"]) { kdBy[rec.r] += rec.st[sd].kd; shBy[rec.r] += rec.st[sd].sh_lnd; }
      if (rec.fin && rec.fin.how !== "SUB") koIn[rec.r]++;
    }
    if (f.rounds.length >= 2 && f.rounds[0].fin == null && f.rounds[1].fin == null) {
      r1.push(Math.log(f.rounds[0].st.A.sig_att + 0.5)); r2.push(Math.log(f.rounds[1].st.A.sig_att + 0.5));
    }
  }
  return { c12: corr(r1, r2), kd: kdBy.map((x, k) => x / Math.max(1, shBy[k])), ko: koIn.map((x, k) => x / Math.max(1, reached[k])) };
}
{
  const n = QUICK ? 2500 : 6000;
  const o3 = { rounds: 3, date: "2026-11-06", division: "Lightweight" };
  const a = "justin-gaethje", b = "alexander-volkanovski";
  const sOn = roundStats(E.matchup(a, b, Object.assign({}, o3, { params: ON })), n, 21);
  const noAR = { components: { dynamics: true }, dyn: { arPhi: 0 } };
  const sNoAR = roundStats(E.matchup(a, b, Object.assign({}, o3, { params: noAR })), n, 21);
  check("AR(1) round noise makes a man's output persist from round 1 to round 2", sOn.c12 > sNoAR.c12 + 0.05,
    `corr R1-R2 ${sOn.c12.toFixed(3)} with arPhi ${P.dyn.arPhi} vs ${sNoAR.c12.toFixed(3)} with arPhi 0`);
  const tab = P.dyn.kdRound3;
  const rat = sOn.kd[2] / sOn.kd[0], want = tab[2] / tab[0];
  check("knockdowns per standing head strike fall by round as the kdRound3 table says", Math.abs(Math.log(rat / want)) < 0.35,
    `R3/R1 ${rat.toFixed(3)} vs table ${want.toFixed(3)} (hurts and selection add noise)`);
  const flat = { components: { dynamics: true }, dyn: { kdRound3: [1, 1, 1] } };
  const sFlat = roundStats(E.matchup(a, b, Object.assign({}, o3, { params: flat })), n, 21);
  check("a flat kdRound3 table removes most of the decline", sFlat.kd[2] / sFlat.kd[0] > rat + 0.2,
    `R3/R1 ${(sFlat.kd[2] / sFlat.kd[0]).toFixed(3)} flat vs ${rat.toFixed(3)}`);
}
// knockdown momentum: extreme multipliers to see the direction cleanly
{
  const o = { rounds: 3, date: "2026-11-06", division: "Lightweight" };
  const strong = { components: { dynamics: true }, dyn: { momScorerOut: 0.5, momDroppedOut: 1.5, momScorerTd: 0.5, momDroppedTd: 1.5 } };
  const none = { components: { dynamics: true }, dyn: { momScorerOut: 1, momDroppedOut: 1, momScorerTd: 1, momDroppedTd: 1, momScorerAcc: 1 } };
  function momStat(params) {
    const m = E.matchup("justin-gaethje", "alexander-volkanovski", Object.assign({}, o, { params }));
    const rng = E.makeRng(77);
    let sc = 0, dr = 0, n = 0;
    for (let i = 0; i < (QUICK ? 6000 : 15000); i++) {
      const f = E.simulate(m, rng, true);
      if (f.rounds.length < 2 || f.rounds[0].fin || f.rounds[0].stoppage) continue;
      const k = f.rounds[0].st;
      if (k.A.kd > 0 && k.B.kd === 0) { const s2 = f.rounds[1].st; sc += s2.A.sig_att; dr += s2.B.sig_att; n++; }
    }
    return { ratio: sc / Math.max(1, dr), n };
  }
  const a = momStat(strong), b = momStat(none);
  check("knockdown momentum: the scorer eases off and the dropped man does not slow next round", a.ratio < b.ratio * 0.6,
    `R2 attempts scorer/dropped ${a.ratio.toFixed(2)} with strong momentum vs ${b.ratio.toFixed(2)} without (n ${a.n}, ${b.n})`);
}
// grappling carry-over: a man controlled earlier shoots less later
{
  const o = { rounds: 3, date: "2026-11-06", division: "Lightweight" };
  function tdLate(params) {
    const m = E.matchup("justin-gaethje", "alexander-volkanovski", Object.assign({}, o, { params }));
    const rng = E.makeRng(5);
    let att = 0, n = 0;
    for (let i = 0; i < (QUICK ? 3000 : 8000); i++) {
      const f = E.simulate(m, rng, true);
      if (f.rounds.length < 2 || f.rounds[0].fin || f.rounds[0].stoppage) continue;
      if (f.rounds[0].st.B.ctrl < 90) continue;          // B controlled A for 90+ s in round 1
      att += f.rounds[1].st.A.td_att; n++;
    }
    return att / Math.max(1, n);
  }
  const strong = tdLate({ components: { dynamics: true }, dyn: { tdCtrlOpp: -1.0 } }), none = tdLate({ components: { dynamics: true }, dyn: { tdCtrlOpp: 0, tdTdl: 0 } });
  check("grappling carry-over: takedown attempts fall after being controlled", strong < none * 0.6, `R2 TD attempts ${strong.toFixed(3)} vs ${none.toFixed(3)}`);
  // takedown round curve: the marginal attempt rate rises by round (real 2019-2023: 3.58 / 3.75 / 4.30 per 15 min) instead of
  // falling under the carry-over terms alone
  function tdByRound(params) {
    const m = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, o, { params }));
    const rng = E.makeRng(9), att = [0, 0, 0], sec = [0, 0, 0];
    for (let i = 0; i < (QUICK ? 2500 : 6000); i++) {
      const f = E.simulate(m, rng, true), nr = f.rounds.length;
      for (const rec of f.rounds) {
        const s = rec.r === nr - 1 && f.fin && f.round === rec.r + 1 ? f.t : 300;
        att[rec.r] += rec.st.A.td_att + rec.st.B.td_att; sec[rec.r] += s;
      }
    }
    return att.map((x, k) => x / Math.max(1, sec[k]));
  }
  const cur = tdByRound(ON), flatTd = tdByRound({ components: { dynamics: true }, dyn: { tdRound3: [1, 1, 1] } });
  check("takedown round curve: attempts per minute rise from round 1 to round 3 (they fall with a flat curve)",
    cur[2] > cur[0] && flatTd[2] < flatTd[0], `R3/R1 ${(cur[2] / cur[0]).toFixed(3)} with tdRound3 ${P.dyn.tdRound3.join("/")} vs ${(flatTd[2] / flatTd[0]).toFixed(3)} flat`);
}
// pace tables: kPace prior and mutual pace
{
  const p45 = E.matchup("alexander-volkanovski", "justin-gaethje", VG5);
  const p15 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { params: { components: { dynamics: true }, dyn: { kPace: 15 } } }));
  const dev = (R) => R.rho.reduce((x, y) => x + Math.abs(y - 1), 0);
  check("kPace 45 shrinks each man's late-round ratio harder than 15", dev(p45.R[0]) < dev(p15.R[0]) && dev(p45.R[1]) < dev(p15.R[1]),
    `sum |rho - 1|: ${dev(p45.R[0]).toFixed(3)} vs ${dev(p15.R[0]).toFixed(3)}`);
  const solo = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { params: { components: { dynamics: true }, dyn: { paceMutual: 0 } } }));
  const late = (m, i) => m.dyn.pace[i][4] / m.dyn.pace[i][0];
  const dirOpp = Math.sign(p45.R[1].rho[4] - 1);
  check("mutual pace moves a man's late output with his opponent's cardio", dirOpp === 0 || Math.sign(late(p45, 0) - late(solo, 0)) === dirOpp,
    `Volk R5/R1 ${late(p45, 0).toFixed(3)} with paceMutual 0.4 vs ${late(solo, 0).toFixed(3)} alone (Gaethje rho5 ${p45.R[1].rho[4].toFixed(3)})`);
  check("non-knockdown stoppage hazards decay by round", p45.dyn.stkoR[4] < p45.dyn.stkoR[0] && p45.dyn.gnpR[2] < p45.dyn.gnpR[0]);
  // knob stkoHurtGate (default off): the standing table becomes per hurt strike, so times the hurt gate (kdRound) it decays
  // as exp(noKdRound r); off leaves the table exactly as before
  const pg = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { params: { components: { dynamics: true }, dyn: { stkoHurtGate: true } } }));
  const gate = (m, r) => m.dyn.stkoR[r] * m.dyn.kdP[r] / m.dyn.kdP[0] / m.dyn.stkoR[0];
  check("stkoHurtGate: off by default; on, the standing table x hurt gate decays as exp(noKdRound r)", P.dyn.stkoHurtGate === false &&
    p45.dyn.stkoR.every((x, r) => x === E.resolveParams({}).dyn.stkoScale * Math.exp(P.dyn.noKdRound * r)) &&   // resolved: Calibrate B's set when calB is on Math.abs(gate(pg, 2) - Math.exp(2 * P.dyn.noKdRound)) < 1e-12 &&
    Math.abs(gate(pg, 4) - Math.exp(4 * P.dyn.noKdRound)) < 1e-12, `gate on: R3/R1 ${gate(pg, 2).toFixed(3)} vs exp(2 noKdRound) ${Math.exp(2 * P.dyn.noKdRound).toFixed(3)}`);
  check("knockdown conversion odds decay by round", p45.dyn.conv[4] < p45.dyn.conv[0]);
}
// verifier fix (E9): realised standing TKO per standing head strike absorbed (rounds without a knockdown) decays about as
// exp(noKdRound r), not kdRound x exp(noKdRound r) as it did before stkoHurtGate
{
  function stkoByRound(gateOn, n) {
    const m = E.matchup("alexander-volkanovski", "justin-gaethje", { rounds: 3, date: "2026-11-06", ml: false,
      params: { components: { dynamics: true }, dyn: { stkoHurtGate: gateOn } } });
    const rng = E.makeRng(gateOn ? 404 : 405), ev = [0, 0, 0], sh = [0, 0, 0];
    for (let s = 0; s < n; s++) {
      const f = E.simulate(m, rng, true);
      for (const rr of f.rounds) {
        if (rr.st.A.kd + rr.st.B.kd > 0) continue;
        sh[rr.r] += rr.st.A.sh_lnd + rr.st.B.sh_lnd;
        if (rr.fin && rr.fin.how === "TKO" && !rr.fin.follow) ev[rr.r]++;
      }
    }
    const h = ev.map((x, r) => x / sh[r]);
    return { r31: (h[2] + h[1]) / 2 / h[0], ev };
  }
  const n = QUICK ? 12000 : 30000, on = stkoByRound(true, n), off = stkoByRound(false, n);
  const e9 = (Math.exp(P.dyn.noKdRound) + Math.exp(2 * P.dyn.noKdRound)) / 2;
  check("stkoHurtGate on: standing TKO per strike absorbed decays by round about as E9 says (steeper with it off)", on.r31 > off.r31 + 0.12 && on.r31 > 0.55 && on.r31 < 1.25,
    `mean(R2, R3) / R1: ${on.r31.toFixed(2)} with the gate vs ${off.r31.toFixed(2)} without (E9 ${e9.toFixed(2)}; events ${on.ev.join("/")} vs ${off.ev.join("/")})`);
}
// knobs still work with the flag on
{
  const base = E.summarize(E.matchup("alexander-volkanovski", "justin-gaethje", VG5), 4000, 8);
  const chin = E.summarize(E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { adjA: { chin: 1.6 } })), 4000, 8);
  check("flag on: chin knob up on A -> more KO losses for A", chin.bins[6] > base.bins[6], `${(100 * base.bins[6]).toFixed(1)} -> ${(100 * chin.bins[6]).toFixed(1)}`);
  const out = E.summarize(E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, VG5, { adjA: { out: 1.3 } })), 4000, 8);
  check("flag on: output knob up on A -> more attempts by A", out.avg.A.sig_att > base.avg.A.sig_att, `${base.avg.A.sig_att.toFixed(1)} -> ${out.avg.A.sig_att.toFixed(1)}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
