#!/usr/bin/env node
/* test_v10.js: engine v10 (the consolidated bundle: the v4 simulator + v8's stat-line bundle as v8 shipped it + v7's prediction
   package + cycle 5's newcomer path and explainer coherence; docs/V6_V10_PLAN.md, data/derived/v10/gate_protocol.json).
   Checks on V10_DIR (default src/ while src holds 10.0.0, else versions/v10-rejected; the gate ran them on versions/v10):
     1. simulator identity: every v8 flag off = versions/v4 (engine 4.0.0) bit for bit (summarize and a traced fight, both corner
        orders, the v10 per-call inputs given) on train fights;
     2. the stat-line bundle as v8 shipped it: v10's matchup tables and fights with the default flags = versions/v8-gate-failed's
        (8.0.0, all four flags on) bit for bit, same inputs and seeds; the retarget and embedding were applied;
     3. blend 1.4.0 = 1.3.0: with the v8 flags off, debutWinner off and no statTargets, v10's predict() equals versions/v7's package
        (FightBlend 1.3.0 on the v4 simulator) bit for bit in all three line regimes, props on (test weights) and off;
     4. exact corner symmetry of the v10 package with every flag on (statTargets and embedding inputs swapped by FightBlend 1.4.0):
        |p(A,B) + p(B,A) - 1| < 1e-12 and mirrored cells < 1e-12 in every regime;
     5. newcomer path: (a) no 2019-2023 backtest side is a debutant (the backtest universe has no debut bouts), and predict() is
        bit-identical with debutWinner on and off on train fights; (b) live, a debut bout with a line takes the line-only stack
        (source 'line'), without a line the seeded Elo (source 'seeded_elo', p = the Elo formula), without either it keeps its
        source and says so; the debut winner model is reported as a candidate; the debut method model stays the method source;
        debutWinner off = no routing; corner symmetry of the debut path;
     6. explainer (showFight): (a) a trace does not move the random stream (untraced = traced outcome and totals, 60 seeds);
        (b) predict() is unchanged by showFight; (c) coherence: the shown fight lands in the drawn cell in >= 90% of 40 show seeds
        on a live matchup and always on the drawn winner; (d) the director builds the shown fight (src/director3.js); (e) explainer
        off -> the first fight of the show seed;
     7. guards: predict THROWS when blend_anchor is on and FightBlend is missing (page-style bundle, no require); manualProfile
        keeps n_fights 0; the v8 statlines targets file is leak-free by construction (2019 none, 2020-2023 f<year>, no 2026 fight).
     node tests/test_v10.js [--json out.json] */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const ROOT = path.join(__dirname, "..");
// v10 was not kept (docs/CHANGELOG.md "v10 finish"): src/ is v4 again, so the default is the frozen rejected copy unless src holds 10.0.0
const V10 = path.resolve(ROOT, process.env.V10_DIR || (require(path.join(ROOT, "src/engine3.js")).VERSION === "10.0.0" ? "src" : "versions/v10-rejected"));
const E = require(path.join(V10, "engine3.js"));
const FB = require(path.join(V10, "ml", "blend.js"));
const E4 = require(path.join(ROOT, "versions/v4/engine3.js"));
const E8 = require(path.join(ROOT, "versions/v8-gate-failed/engine3.js"));
const E7 = require(path.join(ROOT, "versions/v7-gate-failed/engine3.js"));
const FB7 = require(path.join(ROOT, "versions/v7-gate-failed/ml/blend.js"));
const D = require(path.join(ROOT, "src/director3.js"));
const argv = process.argv.slice(2);
const JOUT = argv.indexOf("--json") >= 0 ? argv[argv.indexOf("--json") + 1] : null;
let fails = 0, passes = 0;
const RES = {};
function check(name, ok, info, key) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
  RES[key || name] = { pass: !!ok, info: info || null, name };
}
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
if (E.VERSION !== "10.0.0") { console.error("test_v10: " + V10 + " holds engine " + E.VERSION + ", not 10.0.0"); process.exit(2); }

// ---------------------------------------------------------------- backtest inputs (as tools/predict_harness.js mode v10 builds them)
const bt = readJSON("data/derived/backtest_dev.json"), keys = bt.meta.keys;
const train = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");
for (const f of train) { f.A.keys = keys; f.B.keys = keys; }
const priors = readJSON("data/derived/mlcal_priors_asof.json"), OOF = readJSON("data/derived/mlrates_oof_fh.json");
const TGJ = readJSON("data/derived/v8/statlines_targets.json"), TG = TGJ.fights;
const PJ = readJSON("data/derived/props.json");
const rates = (arr) => { const o = {}; OOF.meta.targets.forEach((n, i) => { o[n] = arr[i]; }); return o; };
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
const OFF8 = { embed: false, retarget: false, tdIntent: false, ctrlSpread: false };
function baseOpts(f, params) {
  const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
  const ent = OOF.fights[f.id];
  o.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
  if (params) o.params = params;
  const t = TG[f.id];
  if (t && t.fold) o.statTargets = { A: t.A, B: t.B, fin: t.fin };
  XR.apply(o, f, false, params);   // the embedding inputs whenever the flag is on in params (default: on)
  return o;
}
const pickTrain = (from, to, n, filt) => { const L = train.filter((f) => f.date >= from && f.date < to && (!filt || filt(f))); const out = []; for (let i = 0; i < n; i++) out.push(L[Math.floor((i + 0.5) * L.length / n)]); return out; };
const fights = pickTrain("2021-01-01", "2024-01-01", 10);
const tables = (m) => {
  const k = ["dRate", "cRate", "gRate", "gBot", "tdD", "tdCC", "tdCU", "tdO", "tdOC", "ctrlT", "occ", "up", "kd", "gnp", "stko", "subO", "gillo", "pCtl", "clE", "accO", "upPos", "swPos", "gPos"];
  const o = {}; for (const x of k) { const v = m[x]; o[x] = v == null ? null : (Array.isArray(v) || ArrayBuffer.isView(v) ? Array.from(v) : v); } return JSON.stringify(o);
};

// 1. every v8 flag off = v4 bit for bit
{
  let same = 0, n = 0;
  for (const f of fights) {
    const b = baseOpts(f, { components: OFF8 });
    for (const [A, B, o] of [[f.A, f.B, b], [f.B, f.A, FB.swapOpts(b)]]) {
      const s10 = E.summarize(E.matchup(A, B, o), 60, 7), s4 = E4.summarize(E4.matchup(A, B, o), 60, 7);
      n++; if (JSON.stringify(s10) === JSON.stringify(s4)) same++;
    }
    const r10 = E.simulate(E.matchup(f.A, f.B, b), E.makeRng(11), true), r4 = E4.simulate(E4.matchup(f.A, f.B, b), E4.makeRng(11), true);
    n++; if (JSON.stringify(r10) === JSON.stringify(r4)) same++;
  }
  check("simulator identity: every v8 flag off = versions/v4 (summarize both orders + traced fight)", same === n, same + "/" + n, "simulator_identity_v4");
}

// 2. default flags = versions/v8-gate-failed (all on) bit for bit; inputs applied
{
  let same = 0, n = 0, applied = 0, nApp = 0;
  for (const f of fights) {
    const b = baseOpts(f);
    const m10 = E.matchup(f.A, f.B, b), m8 = E8.matchup(f.A, f.B, b);
    n++; if (tables(m10) === tables(m8)) same++;
    const s10 = E.summarize(m10, 60, 3), s8 = E8.summarize(m8, 60, 3);
    n++; if (JSON.stringify(s10) === JSON.stringify(s8)) same++;
    if (TG[f.id] && TG[f.id].fold) { nApp++; if (m10.retarget && m10.retarget.applied && m10.embed && m10.embed.src === "opts") applied++; }
  }
  check("stat-line bundle as v8 shipped it: v10 default flags = versions/v8-gate-failed (tables + 60 fights)", same === n, same + "/" + n, "bundle_identity_v8");
  check("stat-line bundle inputs applied (retarget with a leak-free fold table, embedding from opts)", applied === nApp && nApp > 0, applied + "/" + nApp, "bundle_inputs_applied");
}

// 3. blend 1.4.0 = 1.3.0 with the v8 flags off, debutWinner off, no statTargets
const STK = { "2021": "data/derived/v7/cmp_stack_v4pkg_fit2020.json", "2022": "data/derived/v7/cmp_stack_v4pkg_fit2021.json", "2023": "data/derived/v7/cmp_stack_v4pkg_fit2022.json" };
const PR10 = require(path.join(ROOT, "tools/predictrec.js"))(E, ROOT, { stacks: STK, v7: true, blendPath: path.relative(ROOT, path.join(V10, "ml", "blend.js")) });
const PR7 = require(path.join(ROOT, "tools/predictrec.js"))(E7, ROOT, { stacks: STK, v7: true, blendPath: "versions/v7-gate-failed/ml/blend.js" });
const PP_TEST = { w: [0.45, 0.55], fitThrough: "2020-12-31" };
const withProps = (f) => PJ.fights[f.id] && PJ.fights[f.id].props && PJ.fights[f.id].props.m6;
const pfights = pickTrain("2021-01-01", "2024-01-01", 6, withProps);
{
  let same = 0, n = 0, bad = null;
  const p7 = E7.params().blend;
  for (const f of pfights) {
    for (const kind of ["open", "none", "close"]) {
      for (const propsOn of [false, true]) {
        const prm10 = { components: OFF8, blend: { debutWinner: false, mrWeight: p7.mrWeight } };
        const b10 = baseOpts(f, prm10); delete b10.statTargets;
        const b7 = baseOpts(f, { components: OFF8 }); delete b7.statTargets; delete b7.params; delete b7.embed;
        const o10 = Object.assign({}, b10, PR10.opts(f, false, { lineKind: kind }), { seed: 9, sims: 50, interval: false });
        const o7 = Object.assign({}, b7, PR7.opts(f, false, { lineKind: kind }), { seed: 9, sims: 50, interval: false });
        if (propsOn) { o10.propsParams = PP_TEST; o7.propsParams = PP_TEST; } else { o10.propsOn = false; o7.propsOn = false; }
        const a = E.predict(f.A, f.B, o10), c = E7.predict(f.A, f.B, o7);
        const ka = JSON.stringify([a.p, a.cells, a.source, a.sim.cells, a.methodRound.simRescaled, a.methodRound.mrRescaled, a.props && a.props.applied]);
        const kc = JSON.stringify([c.p, c.cells, c.source, c.sim.cells, c.methodRound.simRescaled, c.methodRound.mrRescaled, c.props && c.props.applied]);
        n++; if (ka === kc) same++; else if (!bad) bad = f.id + " " + kind + " props " + propsOn;
      }
    }
  }
  check("FightBlend 1.4.0 = 1.3.0 (v7 package) with v8 flags off, debutWinner off, no statTargets (3 regimes x props on/off)", same === n, same + "/" + n + (bad ? " first diff " + bad : ""), "blend140_eq_130");
}

// 4. corner symmetry of the full v10 package (every flag on)
{
  let mx = 0, n = 0;
  for (const f of pfights.slice(0, 4)) {
    for (const kind of ["open", "none", "close"]) {
      const b = baseOpts(f);
      const o = Object.assign({}, b, PR10.opts(f, false, { lineKind: kind }), { seed: 4, sims: 60, interval: false, propsParams: PP_TEST });
      const bs = FB.swapOpts(b); XR.apply(bs, f, true);
      const os = Object.assign({}, bs, PR10.opts(f, true, { lineKind: kind }), { seed: 4, sims: 60, interval: false, propsParams: PP_TEST });
      const a = E.predict(f.A, f.B, o), c = E.predict(f.B, f.A, os), mc = FB.mirrorCells(c.cells, a.R);
      mx = Math.max(mx, Math.abs(a.p + c.p - 1), ...a.cells.map((v, i) => Math.abs(v - mc[i])));
      n++;
    }
  }
  check("exact corner symmetry of the v10 package, every flag on (statTargets / embedding swapped by FightBlend 1.4.0)", mx < 1e-12, n + " rows, max " + mx.toExponential(2), "corner_swap");
}

// 5a. newcomer path never fires on the backtest universe
{
  let deb = 0;
  for (const f of train) if (FB.isDebutant(f.A) || FB.isDebutant(f.B)) deb++;
  let same = 0, n = 0;
  for (const f of pfights.slice(0, 4)) for (const kind of ["open", "none"]) {
    const b = baseOpts(f);
    const o = Object.assign({}, b, PR10.opts(f, false, { lineKind: kind }), { seed: 2, sims: 40, interval: false, propsParams: PP_TEST });
    const a = E.predict(f.A, f.B, o), c = E.predict(f.A, f.B, Object.assign({}, o, { debutWinner: false }));
    n++; if (JSON.stringify([a.p, a.cells, a.source]) === JSON.stringify([c.p, c.cells, c.source]) && a.debutWinner === undefined) same++;
  }
  check("newcomer path: no 2019-2023 backtest side is a debutant, and predict() is bit-identical with debutWinner on / off", deb === 0 && same === n,
    "debutant sides " + deb + " of " + train.length + " fights; identical " + same + "/" + n, "debut_backtest_identity");
}

// 5b / 6 / 7: live path with the production files
const fj = readJSON("data/derived/fighters.json");
E.loadDB(fj);
try { E.loadMLRates(readJSON("data/derived/mlrates.json")); } catch (e) { /* page path may run without learned rates */ }
E.loadBlend({ stack: readJSON("data/derived/blindtest_stack.json"), feat: readJSON("data/derived/moe_page.json"), ml2: readJSON("data/derived/ml2.json"),
  market: readJSON("data/derived/market.json"), methodRound: readJSON("data/derived/methodround.json"), winnerStacks: readJSON("data/derived/v6_stacks.json"),
  mrS2: readJSON("data/derived/mr_s2.json"), debut: readJSON("data/derived/debut.json"), statDist: readJSON("data/derived/statlines.json"),
  ml2Trees: readJSON("data/derived/ml2_trees.json"), lineStack: readJSON("data/derived/line_stack.json"), props: PJ });
const LIVE = { division: "Lightweight", rounds: 5, title: false, date: "2026-12-12", sims: 150, seed: 3, interval: false };
{
  const deb = JSON.parse(JSON.stringify(E.profile("justin-gaethje")));
  deb.slug = "test-debutant"; deb.name = "Test Debutant"; deb.n_fights = 0; deb.record = { w: 0, l: 0, d: 0, nc: 0, ko_w: 0, sub_w: 0, dec_w: 0, ko_l: 0, sub_l: 0, dec_l: 0 };
  const L = { lineKind: "open", line: { oddsA: -300, oddsB: 240 } };
  const a = E.predict("alexander-volkanovski", deb, Object.assign({}, LIVE, L));
  const lsb = FB.lineStackBlock(readJSON("data/derived/line_stack.json"), "open", null);
  check("newcomer path, with a line: the line-only stack decides the winner (source 'line'), the debut method model the method",
    a.source === "line" && a.debutWinner && a.debutWinner.applied && a.debutWinner.source === "line" && a.debut && a.debut.applied === true && !!lsb,
    "p " + a.p.toFixed(4) + " (" + (a.debutWinner ? a.debutWinner.note : "-") + "), candidate " + (a.debutWinner && a.debutWinner.candidate && a.debutWinner.candidate.p != null ? a.debutWinner.candidate.p.toFixed(4) : "-"), "debut_line");
  const se = { A: 1600, B: 1450 }, pse = 1 / (1 + Math.pow(10, (1450 - 1600) / 400));
  const b = E.predict("alexander-volkanovski", deb, Object.assign({}, LIVE, { lineKind: "none", seededElo: se }));
  check("newcomer path, no line: the seeded Elo decides the winner (source 'seeded_elo', p = the Elo formula)",
    b.source === "seeded_elo" && Math.abs(b.p - pse) < 1e-12 && b.debut && b.debut.applied === true && b.winner === "seeded_elo", "p " + b.p.toFixed(6) + " vs " + pse.toFixed(6), "debut_seeded");
  const c = E.predict("alexander-volkanovski", deb, Object.assign({}, LIVE, { lineKind: "none" }));
  check("newcomer path, no line and no seeded Elo: the headline keeps its source and the record says so",
    c.source !== "seeded_elo" && c.debutWinner && c.debutWinner.applied === false && /no line and no opts.seededElo/.test(c.debutWinner.note), "source " + c.source, "debut_none");
  const d = E.predict("alexander-volkanovski", deb, Object.assign({}, LIVE, { lineKind: "none", seededElo: se, debutWinner: false }));
  check("newcomer path off (debutWinner false): no routing (the 1.3.0 headline)", d.source !== "seeded_elo" && d.debutWinner === undefined && d.p === c.p, "source " + d.source, "debut_off");
  const q = E.predict(deb, "alexander-volkanovski", Object.assign({}, LIVE, { lineKind: "none", seededElo: { A: 1450, B: 1600 } }));
  const mq = FB.mirrorCells(q.cells, b.R), sym = Math.max(Math.abs(b.p + q.p - 1), ...b.cells.map((v, i) => Math.abs(v - mq[i])));
  check("newcomer path: corner symmetry (seeded Elo swapped with the corners)", sym < 1e-12, sym.toExponential(2), "debut_symmetry");
}
{
  // 6a. trace invariance
  const m = E.matchup("alexander-volkanovski", "justin-gaethje", LIVE);
  let same = 0;
  for (let s = 1; s <= 60; s++) {
    const u = E.simulate(m, E.makeRng(1000 + s), false), t = E.simulate(m, E.makeRng(1000 + s), true);
    if (u.winner === t.winner && u.method === t.method && u.round === t.round && u.t === t.t && JSON.stringify(u.totals) === JSON.stringify(t.totals)) same++;
  }
  check("explainer: a trace does not move the random stream (untraced = traced outcome and totals)", same === 60, same + "/60", "trace_invariance");
  // 6b / 6c
  const PO = Object.assign({}, LIVE, { lineKind: "open", line: { oddsA: 170, oddsB: -200 } });
  const pk0 = E.predict("alexander-volkanovski", "justin-gaethje", PO), k0 = JSON.stringify([pk0.p, pk0.cells]);
  let exact = 0, win = 0, N = 40, tries = 0;
  for (let s = 1; s <= N; s++) {
    const sf = E.showFight("alexander-volkanovski", "justin-gaethje", Object.assign({}, PO, { showSeed: s }), pk0);
    const tp = sf.target, R = pk0.R, side = (c) => (c === 4 * R + 2 ? 2 : (c === 4 * R ? 0 : (c === 4 * R + 1 ? 1 : (c < 2 * R ? 0 : 1))));
    if (sf.coherent && sf.cell === tp) exact++;
    if (side(sf.cell) === side(tp)) win++;
    tries += sf.tries;
    if (E.cellOfFight(sf.fight, R) !== sf.cell) { exact = -999; break; }
  }
  const pk1 = E.predict("alexander-volkanovski", "justin-gaethje", PO);
  check("explainer: predict() is unchanged by showFight", JSON.stringify([pk1.p, pk1.cells]) === k0, null, "explainer_no_side_effect");
  check("explainer coherence: the shown fight lands in the cell drawn from predict()'s cells (>= 90%) and always on the drawn winner",
    exact >= 0.9 * N && win === N, "exact " + exact + "/" + N + ", winner " + win + "/" + N + ", mean tries " + (tries / N).toFixed(1), "explainer_coherence");
  // 6d. the director consumes the shown fight
  let dirOk = 0;
  for (let s = 1; s <= 6; s++) {
    const sf = E.showFight("alexander-volkanovski", "justin-gaethje", Object.assign({}, PO, { showSeed: 100 + s }), pk0);
    try {
      const sc = D.build(sf.fight, s, { matchup: sf.matchup, rounds: 5 });
      if (sc && sc.rounds && sc.rounds.length === sf.fight.rounds.length && sc.rounds.every((r) => r.beats && r.beats.length)) dirOk++;
    } catch (e) { /* counted as a failure */ }
  }
  check("explainer: the director builds every shown fight (src/director3.js)", dirOk === 6, dirOk + "/6", "explainer_director");
  // 6e. explainer off
  const off = E.showFight("alexander-volkanovski", "justin-gaethje", Object.assign({}, PO, { showSeed: 5, params: { components: { explainer: false } } }), pk0);
  const f0 = E.simulate(E.matchup("alexander-volkanovski", "justin-gaethje", PO), E.makeRng(5), true);
  check("explainer off: the first traced fight of the show seed (the pre-v10 behaviour)", off.coherent === false && JSON.stringify(off.fight) === JSON.stringify(f0), off.reason, "explainer_off");
}
{
  // 7. guards
  const code = ["params3.js", "ml/mlrates.js", "engine3.js"].map((f) => fs.readFileSync(path.join(V10, f), "utf8")).join("\n;\n");
  const ctx = { console, Math, JSON, Date, Float64Array, Int8Array, Uint32Array, ArrayBuffer, Object, Array, Number, String, Error, isFinite, isNaN, parseInt, parseFloat, Map, Set };
  ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  const EB = ctx.FightEngine, f = fights[0], b = baseOpts(f, { components: OFF8 }); delete b.statTargets; delete b.embed;
  let threw = null;
  try { EB.predict(f.A, f.B, Object.assign({}, b, { sims: 20 })); } catch (e) { threw = String(e.message); }
  let offOk = false;
  try { const r = EB.predict(f.A, f.B, Object.assign({}, b, { sims: 20, params: { components: { blend_anchor: false } } })); offOk = r.on === false && r.source === "engine"; } catch (e) { offOk = false; }
  check("refuses: blend_anchor on and FightBlend missing -> predict throws (no silent one-order summarize)", !!threw && /FightBlend/.test(threw) && offOk,
    threw ? threw.slice(0, 80) + "..." : "did not throw", "refuse_without_blend");
  const mp = E.manualProfile({ name: "Debut Guy", n_fights: 0, record: { w: 12, l: 1 } }, { division: "Lightweight", priors: priors["2023"] });
  check("manualProfile keeps n_fights 0 (v6 review)", mp.n_fights === 0 && FB.isDebutant(mp), "n_fights " + mp.n_fights, "manual_profile_n0");
  let bad = 0, n26 = 0;
  for (const [id, t] of Object.entries(TG)) {
    const f = bt.fights.find((x) => x.id === id);
    if (!f) continue;
    if (f.date >= "2026-01-01") n26++;
    const y = +f.date.slice(0, 4), want = y === 2019 ? null : (y <= 2023 ? "f" + y : "dev");
    if ((t.fold || null) !== want) bad++;
  }
  check("statlines targets leak-free by construction (2019 none, 2020-2023 f<year>, 2024-2025 dev, no 2026 fight)", bad === 0 && n26 === 0, "mismatches " + bad + ", 2026 rows " + n26, "targets_folds");
}

console.log(`\n${passes} passed, ${fails} failed`);
if (JOUT) fs.writeFileSync(path.resolve(ROOT, JOUT), JSON.stringify({ tool: "tests/test_v10.js", v10_dir: path.relative(ROOT, V10), passes, fails,
  engine_version: E.VERSION, params_version: E.params().version, blend_version: FB.VERSION, checks: RES }, null, 1));
process.exit(fails ? 1 : 0);
