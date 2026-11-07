#!/usr/bin/env node
/* test_v6.js: engine v6 (cycle 1 of docs/V6_V10_PLAN.md: ML v2 heads inside FightEngine.predict, line routing, S2 cells,
   lab-3 debut path and distributional stat lines). Checks:
     1. simulator identity: v6's matchup / simulate / summarize equal the frozen v5.0.1 engine's for the same inputs and seeds
        (v6 re-bundles the v5.0.1 simulator unchanged);
     2. flag-off identity: params.blend { winner 'stack', mrModel 'S', debut / statDist off, mrWeight 0.3 } reproduces the
        frozen v5.0.1 package (p and cells bit for bit) in every line regime;
     3. routing: lineKind 'open' uses the OPEN-trained ML v2 stack, 'close' the close-trained one, 'none' the no-line one
        (an opener never reaches close-trained weights); a line without lineKind is refused; the weights are the forward-chained
        fit of the fight's year;
     4. the JS stacks reproduce tools/v6_prep.py's per-fight values;
     5. exact corner symmetry of p and the cells in every regime;
     6. S2 cells: tools/methodround_model.js createS2 = Python on 40 full feature rows (<= 1e-9);
     7. live (page / ledger) path with the production files: Volkanovski vs Gaethje with an opener and without a line (tree
        head, S2 cells, stat-line bands, corner symmetry), the debut path on a debutant profile, the logistic fallback.
     node tests/test_v6.js [fights, default 24] */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E6 = require(path.join(ROOT, "src/engine3.js"));
const E5 = require(path.join(ROOT, "versions/v5.0.1-rejected/engine3.js"));
const FB = require(path.join(ROOT, "src/ml/blend.js"));
const MR = require(path.join(ROOT, "tools/methodround_model.js"));
const NF = +(process.argv.slice(2).find((a) => /^\d+$/.test(a)) || 24);
let fails = 0, passes = 0;
function check(name, ok, info) { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`); }
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const sig = (z) => 1 / (1 + Math.exp(-z)), lg = (p, c) => { p = Math.min(Math.max(p, c), 1 - c); return Math.log(p / (1 - p)); };

// ---------------------------------------------------------------- backtest inputs (as tools/predict_harness.js)
const bt = readJSON("data/derived/backtest_dev.json");
const keys = bt.meta.keys;
const fights = bt.fights.filter((f) => f.date >= "2021-01-01" && f.date < "2024-01-01");
for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
const pick = []; for (let i = 0; i < NF; i++) pick.push(fights[Math.floor((i + 0.5) * fights.length / NF)]);
const PRM = E6.params(), priors = readJSON("data/derived/mlcal_priors_asof.json"), OOF = readJSON("data/derived/mlrates_oof_fh.json");
const rates = (arr) => { const o = {}; OOF.meta.targets.forEach((n, i) => { o[n] = arr[i]; }); return o; };
const DURJ = readJSON("data/derived/durability.json"), SOSJ = readJSON("data/derived/sos_wf.json");
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E6, ROOT);
const STK = { "2021": "data/derived/v6/cmp_stack_v501_fit2020.json", "2022": "data/derived/v6/cmp_stack_v501_fit2021.json", "2023": "data/derived/v6/cmp_stack_v501_fit2022.json" };
const PR6 = require(path.join(ROOT, "tools/predictrec.js"))(E6, ROOT, { stacks: STK, v6: true });
const PR5 = require(path.join(ROOT, "tools/predictrec.js"))(E5, ROOT, { stacks: STK });
function baseOpts(f) {
  const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
  const ent = OOF.fights[f.id];
  o.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
  const d = DURJ.backtest[f.id], side = (x) => ({ chin_re: x.chin_re, chin_cov: x.chin_cov, pow_re: x.pow_re, pow_cov: x.pow_cov });
  const bA = d.p.A / (d.B.chin_re * d.B.chin_cov * d.A.pow_re * d.A.pow_cov), bB = d.p.B / (d.A.chin_re * d.A.chin_cov * d.B.pow_re * d.B.pow_cov);
  o.dur = { A: side(d.A), B: side(d.B), base: Math.sqrt(bA * bB) };
  o.params = { durability: { normChin: DURJ.engine.norm_chin_backtest_2019_2023, normPow: DURJ.engine.norm_pow_backtest_2019_2023 } };
  const s = SOSJ.fights[f.id], y = f.date.slice(0, 4), M = SOSJ.meta;
  o.sos = { A: s.A, B: s.B };
  o.params.stylesSOS = { sosCoef: { ml: M.coef_loyo.ml[y], base: M.coef_loyo.base[y] } };
  XR.apply(o, f, false, o.params);
  return o;
}
const KINDS = ["open", "none", "close"], SIMS = 60;
const V6S = readJSON("data/derived/v6_stacks.json");

// 1 + 2: simulator identity and flag-off package identity
{
  let simSame = 0, simN = 0, pkSame = 0, pkN = 0, maxd = 0;
  const off = { blend: { winner: "stack", mrModel: "S", debut: false, statDist: false, mrWeight: 0.3 } };
  for (const f of pick.slice(0, Math.min(12, pick.length))) {
    const b = baseOpts(f);
    for (const [A, B, o] of [[f.A, f.B, b], [f.B, f.A, FB.swapOpts(b)]]) {
      const s6 = E6.summarize(E6.matchup(A, B, o), 80, 7), s5 = E5.summarize(E5.matchup(A, B, o), 80, 7);
      simN++; if (JSON.stringify(s6) === JSON.stringify(s5)) simSame++;
    }
    for (const kind of KINDS) {
      const o5 = Object.assign({}, b, PR5.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: SIMS, interval: false });
      const o6 = Object.assign({}, o5, { params: Object.assign({}, b.params, off) });
      const p5 = E5.predict(f.A, f.B, o5), p6 = E6.predict(f.A, f.B, o6);
      pkN++;
      const d = Math.max(Math.abs(p5.p - p6.p), ...p5.cells.map((v, i) => Math.abs(v - p6.cells[i])));
      maxd = Math.max(maxd, d); if (d === 0) pkSame++;
    }
  }
  check("simulator identity: v6 summarize(matchup) = frozen v5.0.1 for the same inputs and seeds", simSame === simN, simSame + "/" + simN);
  check("flag-off identity: v6 predict with v5 blend settings = frozen v5.0.1 predict (p and cells)", pkSame === pkN, pkSame + "/" + pkN + " exact, max |diff| " + maxd);
}

// 3 + 4 + 5: routing, Python parity, corner symmetry
{
  let route = 0, routeN = 0, par = 0, sym = 0, symC = 0, nS = 0, refused = 0;
  for (const f of pick) {
    const b = baseOpts(f), Y = f.date.slice(0, 4);
    for (const kind of KINDS) {
      const o = Object.assign({}, b, PR6.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: SIMS, interval: false });
      if (o.lineMissing) continue;
      const pk = E6.predict(f.A, f.B, o);
      routeN++;
      const want = kind + "|blend", blk = V6S.stacks[want].by_fit_year[Y];
      const okR = pk.source === "ml2stack" && pk.routing.weights === want && pk.v6.fit === "Y" + Y &&
        JSON.stringify(pk.v6.weights) === JSON.stringify(blk.weights) && pk.lineType === kind;
      if (okR) route++;
      // manual stack
      const inp = V6S.inputs[f.id], line = kind === "open" ? inp.open : kind === "close" ? inp.market : null;
      const xs = V6S.stacks[want].inputs.map((nm) => nm === "ml2" ? inp.ml2 : nm === "mkt_rating" ? inp.mkt_rating : line);
      let z = 0; xs.forEach((q, i) => { if (q != null) z += blk.weights[i] * lg(q, 0.01); });
      par = Math.max(par, Math.abs(sig(z) - pk.p));
      const py = (V6S.per_fight[f.id] || {})[want];
      if (py != null) par = Math.max(par, Math.abs(py - pk.p));
      // corner swap
      const os = Object.assign({}, FB.swapOpts(b), PR6.opts(f, true, { lineKind: kind }), { seed: hash32(f.id), sims: SIMS, interval: false });
      const qk = E6.predict(f.B, f.A, os);
      sym = Math.max(sym, Math.abs(pk.p + qk.p - 1));
      const R = pk.R, mc = FB.mirrorCells(qk.cells, R);
      symC = Math.max(symC, ...pk.cells.map((v, i) => Math.abs(v - mc[i])));
      nS++;
    }
    // an opener fed as an unlabelled line is refused
    try { E6.predict(f.A, f.B, Object.assign({}, b, PR6.opts(f, false, { lineKind: "none" }), { line: { oddsA: -150, oddsB: 130 }, lineKind: undefined, seed: 1, sims: 20, interval: false })); }
    catch (e) { if (/explicit opts.lineKind/.test(String(e.message))) refused++; }
  }
  check("routing: open -> open-trained, close -> close-trained, none -> no-line ML v2 stack; forward-chained fit of the fight's year", route === routeN, route + "/" + routeN);
  check("JS stacks = manual stack = tools/v6_prep.py per-fight values (stored to 8 decimals)", par < 1e-8, "max |diff| " + par.toExponential(2));
  check("corner swap: max |p(A,B) + p(B,A) - 1| < 1e-12 and mirrored cells", sym < 1e-12 && symC < 1e-12, nS + " fight-regimes, p " + sym.toExponential(2) + ", cells " + symC.toExponential(2));
  check("a line without an explicit lineKind is refused", refused === pick.length, refused + "/" + pick.length);
  // routing guard at the block level: an 'open' request never returns close-trained weights
  const st = FB.v6Stack(V6S, "open", "blend", 2024), sc = FB.v6Stack(V6S, "close", "blend", 2024);
  check("v6Stack('open') is the open-trained block, distinct from the close-trained one", st.key === "open|blend" && st.inputs[0] === "open" && JSON.stringify(st.weights) !== JSON.stringify(sc.weights));
}

// 6: S2 parity
{
  const d = readJSON("data/derived/mr_s2.json"), m = MR.createS2(d.js_model);
  let mx = 0;
  for (const v of d.js_model.vectors) { const o = m.fromFeatures(v.DA, v.DB, v.rounds); for (let i = 0; i < 23; i++) mx = Math.max(mx, Math.abs(o.joint23[i] - v.joint23[i])); }
  check("S2 cells: JS = Python on " + d.js_model.vectors.length + " feature rows (<= 1e-9)", mx <= 1e-9, "max |diff| " + mx.toExponential(2));
  // walk-forward cells: every dev fight has S2 cells fit strictly before it
  let bad = 0, n = 0; for (const [id, r] of Object.entries(d.fights)) { n++; if (!(r.fit_through < r.date) || Math.abs(r.S2.reduce((a, b) => a + b, 0) - 1) > 1e-6) bad++; }
  check("S2 walk-forward cells: fit strictly before each fight, normalised", bad === 0 && n === 2864, n + " fights, " + bad + " bad");
}

// 7: live path with the production files
{
  const fj = readJSON("data/derived/fighters.json");
  E6.loadDB(fj);
  try { E6.loadMLRates(readJSON("data/derived/mlrates.json")); } catch (e) { /* the page path may run without learned rates */ }
  E6.loadBlend({ stack: readJSON("data/derived/blindtest_stack.json"), feat: readJSON("data/derived/moe_page.json"), ml2: readJSON("data/derived/ml2.json"),
    market: readJSON("data/derived/market.json"), methodRound: readJSON("data/derived/methodround.json"), winnerStacks: V6S,
    mrS2: readJSON("data/derived/mr_s2.json"), debut: readJSON("data/derived/debut.json"), statDist: readJSON("data/derived/statlines.json"),
    ml2Trees: readJSON("data/derived/ml2_trees.json") });
  const opts = { division: "Lightweight", rounds: 5, title: false, date: "2026-12-12", sims: 200, seed: 3, interval: false };
  const po = E6.predict("alexander-volkanovski", "justin-gaethje", Object.assign({ lineKind: "open", line: { oddsA: 170, oddsB: -200 } }, opts));
  const pn = E6.predict("alexander-volkanovski", "justin-gaethje", Object.assign({ lineKind: "none" }, opts));
  const qo = E6.predict("justin-gaethje", "alexander-volkanovski", Object.assign({ lineKind: "open", line: { oddsA: -200, oddsB: 170 } }, opts));
  check("live: open regime uses the open-trained ML v2 blend stack (tree head)", po.source === "ml2stack" && po.routing.weights === "open|blend" && po.v6.headSource === "trees" && po.v6.fit === "production",
    "p " + po.p.toFixed(4) + ", head " + (po.v6.headValue || 0).toFixed(4) + " (" + po.v6.headSource + "), line " + po.line.p.toFixed(3));
  check("live: no-line regime", pn.source === "ml2stack" && pn.routing.weights === "none|blend", "p " + pn.p.toFixed(4));
  check("live: corner symmetry of the open-regime p", Math.abs(po.p + qo.p - 1) < 1e-12, (po.p + qo.p - 1).toExponential(2));
  check("live: S2 method/round cells pooled with the simulator", po.methodRound.variant === "S2" && po.methodRound.model === "S2" && Math.abs(po.cells.reduce((a, b) => a + b, 0) - 1) < 1e-9,
    "inputs " + (po.methodRound.s2Inputs ? po.methodRound.s2Inputs.src.join("/") : "none") + ", w " + po.methodRound.weight);
  check("live: distributional stat lines (P10 / P50 / P90)", !!(po.statLines.dist && po.statLines.dist.A && po.statLines.dist.A.sig_lnd && isFinite(po.statLines.dist.A.sig_lnd.p50)),
    po.statLines.dist && po.statLines.dist.A ? "Volk sig landed P10/P50/P90 " + ["p10", "p50", "p90"].map((k) => po.statLines.dist.A.sig_lnd[k]).join("/") : JSON.stringify(po.statLines.dist));
  // debut path: a debutant profile (no UFC fights) against a roster fighter
  const deb = JSON.parse(JSON.stringify(E6.profile("justin-gaethje")));
  deb.slug = "test-debutant"; deb.n_fights = 0; deb.record = { w: 0, l: 0, d: 0, nc: 0, ko_w: 0, sub_w: 0, dec_w: 0, ko_l: 0, sub_l: 0, dec_l: 0 };
  const pd = E6.predict("alexander-volkanovski", deb, Object.assign({ lineKind: "open", line: { oddsA: -300, oddsB: 240 } }, opts));
  const R = pd.R, sA = pd.cells.slice(0, 2 * R).reduce((a, b) => a + b, 0) + pd.cells[4 * R];
  check("live: debut path replaces method given the winner, keeps the winner", pd.debut && pd.debut.applied === true && Math.abs(sA / (1 - pd.cells[4 * R + 2]) - pd.p) < 1e-9,
    pd.debut ? JSON.stringify(pd.debut.debutant) + ", source " + pd.source : "none");
  // logistic fallback when the tree evaluator is not loaded
  E6.loadBlend({ ml2Trees: null });
  const pf = E6.predict("alexander-volkanovski", "justin-gaethje", Object.assign({ lineKind: "open", line: { oddsA: 170, oddsB: -200 } }, opts));
  check("live: without the tree evaluator the logistic head's stack is used, flagged", pf.source === "ml2stack" && pf.v6.headSource === "lr fallback" && pf.routing.weights === "open|lr" && /logistic/.test(pf.v6.note || ""));
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
