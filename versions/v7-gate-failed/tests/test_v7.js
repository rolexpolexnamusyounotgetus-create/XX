#!/usr/bin/env node
/* test_v7.js: engine v7 (docs/V6_V10_PLAN.md cycle 2, market props for how and when, on the v4 simulator with cycle 1's prediction
   package re-bundled through v7's own gate; 7.1 item 10). Checks, on versions/v7 (V7_DIR to point elsewhere):
     1. simulator identity: v7's matchup / simulate / summarize equal the frozen v4 engine's for the same inputs and seeds;
     2. flag-off identities: (a) params.components.blend_anchor false -> predict = the one-order summarize package of v4;
        (b) props off (no opts.props, or params.blend.props.on false) -> the package equals src/ml/blend.js 1.2.1's (git HEAD~ copy)
        bit for bit; (c) props without a method family -> cells unchanged;
     3. the props pool: P(A) / (P(A) + P(B)) = p (1e-12); method given the winner = the joint-linear pool of the cells' and the
        props' mixes; round shapes per side and method unchanged; the draw = drawC x P(decision);
     4. exact corner symmetry (props on and off, every line regime): |p(A,B) + p(B,A) - 1| < 1e-12, mirrored cells < 1e-12;
     5. routing: open -> open-trained ML v2 stack, close -> close-trained, none -> no-line, forward-chained fit of the fight's year;
     6. S2 cells: tools/methodround_model.js createS2 = Python on the 40 stored feature rows (<= 1e-9);
     7. guards: predict THROWS when blend_anchor is on and FightBlend is missing (a page-style bundle with no require); the
        backtest guard refuses props weights fit on or after the fight; manualProfile keeps n_fights 0;
     8. live path (production files): Volkanovski vs Gaethje with and without props (de-vigged from raw book prices through
        PropsPool, the one de-vig), a debut bout keeps the debut method model (props reported only).
     node tests/test_v7.js [fights, default 24] [--json out.json]     (the gate reads the --json file: tools/v7_gate.py --tests) */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const V7 = path.resolve(ROOT, process.env.V7_DIR || "versions/v7");
const E7 = require(path.join(V7, "engine3.js"));
const E4 = require(path.join(ROOT, "versions/v4/engine3.js"));
const FB = require(path.join(V7, "ml", "blend.js"));
const MR = require(path.join(ROOT, "tools/methodround_model.js"));
const argv = process.argv.slice(2);
const NF = +(argv.find((a) => /^\d+$/.test(a)) || 24);
const JOUT = argv.indexOf("--json") >= 0 ? argv[argv.indexOf("--json") + 1] : null;
let fails = 0, passes = 0;
const RES = {};
function check(name, ok, info, key) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
  if (key) RES[key] = { pass: !!ok, info: info || null, name };
}
const readJSON = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }

// ---------------------------------------------------------------- backtest inputs (as tools/predict_harness.js builds them)
const bt = readJSON("data/derived/backtest_dev.json");
const keys = bt.meta.keys;
const fights = bt.fights.filter((f) => f.date >= "2022-01-01" && f.date < "2024-01-01");
for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
const PJ = readJSON("data/derived/props.json");
const withProps = fights.filter((f) => PJ.fights[f.id] && PJ.fights[f.id].props && PJ.fights[f.id].props.m6);
const pick = []; for (let i = 0; i < NF; i++) pick.push(withProps[Math.floor((i + 0.5) * withProps.length / NF)]);
const priors = readJSON("data/derived/mlcal_priors_asof.json"), OOF = readJSON("data/derived/mlrates_oof_fh.json");
const rates = (arr) => { const o = {}; OOF.meta.targets.forEach((n, i) => { o[n] = arr[i]; }); return o; };
function baseOpts(f) {
  const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
  const ent = OOF.fights[f.id];
  o.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
  return o;
}
const STK = { "2022": "data/derived/v6/cmp_stack_v501_fit2021.json", "2023": "data/derived/v6/cmp_stack_v501_fit2022.json" };
const PR7 = require(path.join(ROOT, "tools/predictrec.js"))(E7, ROOT, { stacks: STK, v7: true, blendPath: path.relative(ROOT, path.join(V7, "ml", "blend.js")) });
const KINDS = ["open", "none", "close"], SIMS = 60;
const PP_TEST = { w: [0.45, 0.55], fitThrough: "2021-12-31" };   // a test weight fit before every 2022-2023 fight

// 1. simulator identity with v4
{
  let same = 0, n = 0;
  for (const f of pick.slice(0, Math.min(12, pick.length))) {
    const b = baseOpts(f);
    for (const [A, B, o] of [[f.A, f.B, b], [f.B, f.A, FB.swapOpts(b)]]) {
      const s7 = E7.summarize(E7.matchup(A, B, o), 80, 7), s4 = E4.summarize(E4.matchup(A, B, o), 80, 7);
      n++; if (JSON.stringify(s7) === JSON.stringify(s4)) same++;
    }
    const m = E7.matchup(f.A, f.B, b), r7 = E7.simulate(m, E7.makeRng(11), true), r4 = E4.simulate(E4.matchup(f.A, f.B, b), E4.makeRng(11), true);
    n++; if (JSON.stringify(r7) === JSON.stringify(r4)) same++;
  }
  check("simulator identity: v7 summarize / simulate(trace) = frozen v4 engine, same inputs and seeds", same === n, same + "/" + n, "simulator_identity_v4");
}

// 2a. blend_anchor off -> the summarize package of v4
{
  let ok = 0, n = 0;
  for (const f of pick.slice(0, 8)) {
    const b = baseOpts(f);
    const pk = E7.predict(f.A, f.B, Object.assign({}, b, { sims: 70, seed: 5, params: { components: { blend_anchor: false } } }));
    const s4 = E4.summarize(E4.matchup(f.A, f.B, b), 70, 5);
    n++; if (pk.on === false && JSON.stringify(pk.sim) === JSON.stringify(s4) && pk.p === s4.pA / (s4.pA + s4.pB)) ok++;
  }
  check("flag-off identity (a): blend_anchor false -> predict = v4 summarize package", ok === n, ok + "/" + n, "flag_off_summarize");
}

// 2b. props off -> blend.js 1.2.1 (the version before 1.3.0), bit for bit
let FB121 = null, fb121note = "";
try {
  const tmp = fs.mkdtempSync(path.join(require("os").tmpdir(), "v7b121-"));
  fs.mkdirSync(path.join(tmp, "ml"));
  let src = null;
  for (const rev of ["HEAD", "HEAD~1", "HEAD~2", "HEAD~3", "HEAD~5", "HEAD~10", "HEAD~20", "HEAD~40"]) {
    try { const t = execFileSync("git", ["-C", ROOT, "show", rev + ":src/ml/blend.js"], { encoding: "utf8" }); if (/var VERSION = "1\.2\.1"/.test(t)) { src = t; fb121note = rev; break; } } catch (e) { /* next */ }
  }
  if (!src) {
    // the last commit whose src/ml/blend.js is 1.2.1
    const log = execFileSync("git", ["-C", ROOT, "log", "--format=%H", "-n", "200", "--", "src/ml/blend.js"], { encoding: "utf8" }).trim().split("\n");
    for (const h of log) { const t = execFileSync("git", ["-C", ROOT, "show", h + ":src/ml/blend.js"], { encoding: "utf8" }); if (/var VERSION = "1\.2\.1"/.test(t)) { src = t; fb121note = h.slice(0, 10); break; } }
  }
  if (src) {
    fs.writeFileSync(path.join(tmp, "ml", "blend.js"), src);
    for (const f of ["moe.js", "ml2.js", "ml2trees.js", "debut.js", "statdist.js", "mlpage.js"]) fs.copyFileSync(path.join(V7, "ml", f), path.join(tmp, "ml", f));
    FB121 = require(path.join(tmp, "ml", "blend.js"));
  }
} catch (e) { fb121note = String(e.message).slice(0, 120); }
{
  let ok = 0, n = 0, maxd = 0;
  if (FB121) {
    for (const f of pick.slice(0, 10)) {
      const b = baseOpts(f);
      for (const kind of KINDS) {
        const o = Object.assign({}, b, PR7.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: SIMS, interval: false });
        delete o.props;
        const a = E7.predict(f.A, f.B, o);
        const c = FB121.predict(E7, f.A, f.B, o, { meta: null, params: E7.params() });
        n++;
        const d = Math.max(Math.abs(a.p - c.p), ...a.cells.map((v, i) => Math.abs(v - c.cells[i])));
        maxd = Math.max(maxd, d); if (d === 0 && a.source === c.source) ok++;
      }
    }
  }
  check("flag-off identity (b): props off -> blend.js 1.2.1 package (p and cells bit for bit)", FB121 && ok === n && n > 0, FB121 ? ok + "/" + n + " exact (1.2.1 from " + fb121note + ")" : "1.2.1 not found: " + fb121note, "flag_off_props_121");
}
// 2c. params.blend.props.on false with props given; and a consensus with no method family
{
  let ok = 0, n = 0;
  for (const f of pick.slice(0, 6)) {
    const b = baseOpts(f);
    const o = Object.assign({}, b, PR7.opts(f, false, { lineKind: "close" }), { seed: hash32(f.id), sims: SIMS, interval: false, propsParams: PP_TEST });
    const off = E7.predict(f.A, f.B, Object.assign({}, o, { props: undefined }));
    const pOff = E7.predict(f.A, f.B, Object.assign({}, o, { params: { blend: { props: { on: false } } } }));
    const noM6 = E7.predict(f.A, f.B, Object.assign({}, o, { props: { gd: 0.5, n_books: { gd: 3 } } }));
    n++;
    if (JSON.stringify(off.cells) === JSON.stringify(pOff.cells) && JSON.stringify(off.cells) === JSON.stringify(noM6.cells) &&
      pOff.props && pOff.props.applied === false && noM6.props && noM6.props.applied === false) ok++;
  }
  check("flag-off identity (c): params props.on false, or props without a method family -> cells unchanged", ok === n, ok + "/" + n, "flag_off_props_param");
}

// 3 + 4 + 5: the pool, symmetry, routing
{
  let wmax = 0, mgwMax = 0, rshape = 0, drawMax = 0, sym = 0, symC = 0, nS = 0, route = 0, routeN = 0, applied = 0;
  const V6S = readJSON("data/derived/v6_stacks.json");
  for (const f of pick) {
    const b = baseOpts(f), Y = f.date.slice(0, 4);
    for (const kind of KINDS) {
      for (const propsOn of [true, false]) {
        const o = Object.assign({}, b, PR7.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: SIMS, interval: false, propsParams: PP_TEST });
        if (o.lineMissing) continue;
        if (!propsOn) delete o.props;
        const pk = E7.predict(f.A, f.B, o);
        const R = pk.R, c = pk.cells;
        if (propsOn) {
          applied += pk.props && pk.props.applied ? 1 : 0;
          const a = c.slice(0, 2 * R).reduce((x, y) => x + y, 0) + c[4 * R], bb = c.slice(2 * R, 4 * R).reduce((x, y) => x + y, 0) + c[4 * R + 1];
          wmax = Math.max(wmax, Math.abs(a / (a + bb) - pk.p));
          // method given the winner = jlin pool
          const off = E7.predict(f.A, f.B, Object.assign({}, o, { props: undefined }));
          const PPm = require(path.join(V7, "ml", "propspool.js"));
          const mdl = PPm.fromCells(FB.cellsToMR(off.cells, R)), m6 = o.props.m6, Wp = (m6[0] + m6[1] + m6[2]) / m6.reduce((x, y) => x + y, 0);
          const pM = [[m6[0], m6[1], m6[2]].map((x) => x / (m6[0] + m6[1] + m6[2])), [m6[3], m6[4], m6[5]].map((x) => x / (m6[3] + m6[4] + m6[5]))];
          for (const s of [0, 1]) {
            const cw = [0.45 * (s === 0 ? mdl.pOwn : 1 - mdl.pOwn), 0.55 * (s === 0 ? Wp : 1 - Wp)], t = cw[0] + cw[1];
            const want = [0, 1, 2].map((k) => (cw[0] * mdl.M[s][k] + cw[1] * pM[s][k]) / t);
            const got = pk.props.methodGivenWin[s === 0 ? "A" : "B"];
            mgwMax = Math.max(mgwMax, ...want.map((v, k) => Math.abs(v - got[k])));
            // round shapes per side and method unchanged
            const base = s === 0 ? 0 : 2 * R;
            for (const [lo, hi] of [[base, base + R], [base + R, base + 2 * R]]) {
              const sa = off.cells.slice(lo, hi), sb = c.slice(lo, hi), ta = sa.reduce((x, y) => x + y, 0), tb = sb.reduce((x, y) => x + y, 0);
              if (ta > 1e-12 && tb > 1e-12) rshape = Math.max(rshape, ...sa.map((v, i) => Math.abs(v / ta - sb[i] / tb)));
            }
          }
          const pdec = c[4 * R] + c[4 * R + 1];
          drawMax = Math.max(drawMax, Math.abs(c[4 * R + 2] - E7.params().blend.props.drawC * pdec / (1 - c[4 * R + 2])));
        }
        // corner swap
        const os = Object.assign({}, FB.swapOpts(b), PR7.opts(f, true, { lineKind: kind }), { seed: hash32(f.id), sims: SIMS, interval: false, propsParams: PP_TEST });
        if (!propsOn) delete os.props;
        const qk = E7.predict(f.B, f.A, os);
        sym = Math.max(sym, Math.abs(pk.p + qk.p - 1));
        const mc = FB.mirrorCells(qk.cells, R);
        symC = Math.max(symC, ...c.map((v, i) => Math.abs(v - mc[i])));
        nS++;
        if (!propsOn) {
          routeN++;
          const want = kind + "|blend", blk = V6S.stacks[want].by_fit_year[Y];
          if (pk.source === "ml2stack" && pk.routing.weights === want && pk.v6.fit === "Y" + Y && JSON.stringify(pk.v6.weights) === JSON.stringify(blk.weights)) route++;
        }
      }
    }
  }
  check("props pool applied on every fight-regime with method props", applied === routeN, applied + "/" + routeN, "props_applied");
  check("props pool: winner untouched, P(A) / (P(A) + P(B)) = p (1e-12)", wmax < 1e-12, wmax.toExponential(2), "props_winner_identity");
  check("props pool: method given the winner = joint-linear pool of the cells' and the props' mixes (1e-12)", mgwMax < 1e-12, mgwMax.toExponential(2), "props_jlin");
  check("props pool: round shapes per side and method = the cells' (1e-12)", rshape < 1e-12, rshape.toExponential(2), "props_round_shapes");
  check("props pool: draw = drawC x P(decision) (1e-12)", drawMax < 1e-12, drawMax.toExponential(2), "props_draw");
  check("corner swap: max |p(A,B) + p(B,A) - 1| < 1e-12 and mirrored cells < 1e-12 (props on and off, 3 regimes)", sym < 1e-12 && symC < 1e-12,
    nS + " cases, p " + sym.toExponential(2) + ", cells " + symC.toExponential(2), "corner_swap");
  check("routing: open -> open-trained, close -> close-trained, none -> no-line ML v2 stack (forward-chained fit of the year)", route === routeN, route + "/" + routeN, "routing");
}

// 6. S2 parity
{
  const d = readJSON("data/derived/mr_s2.json"), m = MR.createS2(d.js_model);
  let mx = 0;
  for (const v of d.js_model.vectors) { const o = m.fromFeatures(v.DA, v.DB, v.rounds); for (let i = 0; i < 23; i++) mx = Math.max(mx, Math.abs(o.joint23[i] - v.joint23[i])); }
  check("S2 cells: JS = Python on " + d.js_model.vectors.length + " feature rows (<= 1e-9)", mx <= 1e-9 && d.js_model.vectors.length >= 40, "max |diff| " + mx.toExponential(2), "s2_parity");
}

// 7. guards
{
  // a page-style bundle: params3.js + mlrates.js + engine3.js in a vm context with no require and no FightBlend
  const code = ["params3.js", "ml/mlrates.js", "engine3.js"].map((f) => fs.readFileSync(path.join(V7, f), "utf8")).join("\n;\n");
  const ctx = { console, Math, JSON, Date, Float64Array, Int8Array, Uint32Array, ArrayBuffer, Object, Array, Number, String, Error, isFinite, isNaN, parseInt, parseFloat };
  ctx.self = ctx; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(code, ctx);
  const EB = ctx.FightEngine, f = pick[0], b = baseOpts(f);
  let threw = null;
  try { EB.predict(f.A, f.B, Object.assign({}, b, { sims: 20 })); } catch (e) { threw = String(e.message); }
  let offOk = false;
  try { const r = EB.predict(f.A, f.B, Object.assign({}, b, { sims: 20, params: { components: { blend_anchor: false } } })); offOk = r.on === false && r.source === "engine"; } catch (e) { offOk = false; }
  check("refuses: blend_anchor on and FightBlend missing -> predict throws (no silent one-order summarize)", !!threw && /FightBlend/.test(threw) && offOk,
    threw ? threw.slice(0, 90) + "..." : "did not throw", "refuse_without_blend");
  // backtest guard on props weights
  const o = Object.assign({}, b, PR7.opts(f, false, { lineKind: "close" }), { seed: 1, sims: 20, interval: false, propsParams: { w: [0.5, 0.5], fitThrough: f.date } });
  let g = null; try { E7.predict(f.A, f.B, o); } catch (e) { g = String(e.message); }
  const o2 = Object.assign({}, o); delete o2.propsParams;   // the frozen params weights (fit through 2023-12-31) on a 2022-2023 fight
  let g2 = null; try { E7.predict(f.A, f.B, o2); } catch (e) { g2 = String(e.message); }
  check("backtest guard: props weights fit on or after the fight are refused (opts.propsParams and the frozen params)", !!g && /props weights fit through/.test(g) && !!g2 && /props weights fit through/.test(g2));
  const mp = E7.manualProfile({ name: "Debut Guy", n_fights: 0, record: { w: 12, l: 1 } }, { division: "Lightweight", priors: priors["2023"] });
  check("manualProfile keeps n_fights 0 (v6 review)", mp.n_fights === 0 && FB.isDebutant(mp), "n_fights " + mp.n_fights, "manual_profile_n0");
}

// 8. live path with the production files
{
  const fj = readJSON("data/derived/fighters.json");
  E7.loadDB(fj);
  try { E7.loadMLRates(readJSON("data/derived/mlrates.json")); } catch (e) { /* page path may run without learned rates */ }
  E7.loadBlend({ stack: readJSON("data/derived/blindtest_stack.json"), feat: readJSON("data/derived/moe_page.json"), ml2: readJSON("data/derived/ml2.json"),
    market: readJSON("data/derived/market.json"), methodRound: readJSON("data/derived/methodround.json"), winnerStacks: readJSON("data/derived/v6_stacks.json"),
    mrS2: readJSON("data/derived/mr_s2.json"), debut: readJSON("data/derived/debut.json"), statDist: readJSON("data/derived/statlines.json"),
    ml2Trees: readJSON("data/derived/ml2_trees.json"), lineStack: readJSON("data/derived/line_stack.json"), props: PJ });
  const opts = { division: "Lightweight", rounds: 5, title: false, date: "2026-12-12", sims: 200, seed: 3, interval: false };
  // raw per-book prices (page team 1 = Volkanovski), de-vigged by PropsPool inside predict: the one de-vig
  const books = { BookA: { ko1: 450, sub1: 1400, dec1: 175, ko2: -110, sub2: 2000, dec2: 375, draw: 5000, godec: 120, godec_no: -150 },
    BookB: { ko1: 500, sub1: 1600, dec1: 160, ko2: -120, sub2: 2200, dec2: 350, draw: 4000, godec: 115, godec_no: -145 } };
  const pn = E7.predict("alexander-volkanovski", "justin-gaethje", Object.assign({ lineKind: "open", line: { oddsA: 170, oddsB: -200 } }, opts));
  const pp = E7.predict("alexander-volkanovski", "justin-gaethje", Object.assign({ lineKind: "open", line: { oddsA: 170, oddsB: -200 }, props: { books, swap: false } }, opts));
  const qp = E7.predict("justin-gaethje", "alexander-volkanovski", Object.assign({ lineKind: "open", line: { oddsA: -200, oddsB: 170 }, props: { books, swap: true } }, opts));
  const R = pp.R, mcq = FB.mirrorCells(qp.cells, R);
  const symL = Math.max(Math.abs(pp.p + qp.p - 1), ...pp.cells.map((v, i) => Math.abs(v - mcq[i])));
  check("live: props from raw book prices (PropsPool de-vig) change method given the winner, not the winner", pp.props && pp.props.applied && pp.p === pn.p &&
    pp.props.nBooks === 2 && pp.props.pProps > 0.2 && pp.props.pProps < 0.6, "p " + pp.p.toFixed(4) + ", props P(A) " + (pp.props ? pp.props.pProps.toFixed(3) : "-") +
    ", Volk KO/SUB/DEC given a win " + (pp.props ? pp.props.methodGivenWin.A.map((x) => x.toFixed(3)).join("/") : "-"), "live_props");
  check("live: corner symmetry with raw-price props (swap flag)", symL < 1e-12, symL.toExponential(2));
  const deb = JSON.parse(JSON.stringify(E7.profile("justin-gaethje")));
  deb.slug = "test-debutant"; deb.n_fights = 0; deb.record = { w: 0, l: 0, d: 0, nc: 0, ko_w: 0, sub_w: 0, dec_w: 0, ko_l: 0, sub_l: 0, dec_l: 0 };
  const pd = E7.predict("alexander-volkanovski", deb, Object.assign({ lineKind: "open", line: { oddsA: -300, oddsB: 240 }, props: { books, swap: false } }, opts));
  check("live: a debut bout keeps the debut method model (props reported, not applied)", pd.debut && pd.debut.applied === true && pd.props && pd.props.applied === false,
    pd.props ? pd.props.reason : "no props record", "debut_keeps_debut_model");
}

console.log(`\n${passes} passed, ${fails} failed`);
if (JOUT) fs.writeFileSync(path.resolve(ROOT, JOUT), JSON.stringify({ tool: "tests/test_v7.js", v7_dir: path.relative(ROOT, V7), fights: NF, passes, fails,
  engine_version: E7.VERSION, params_version: E7.params().version, blend_version: FB.VERSION, checks: RES }, null, 1));
process.exit(fails ? 1 : 0);
