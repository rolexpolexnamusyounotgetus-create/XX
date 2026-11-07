#!/usr/bin/env node
/* test_blend121.js: src/ml/blend.js 1.2.1, the v6 review's fixes to the prediction package (docs/CHANGELOG.md "v6 review").
   Runs the frozen v6 engine (versions/v6-rejected/engine3.js) with src/ml/blend.js injected as FightBlend, so it works while
   src/ holds v4 (which has no predict()). Checks:
     1. backtest identity: on train fights in every line regime, 1.2.1 gives the frozen 1.2.0's p, cells, source and fit bit
        for bit (every backtest row is 'ml2stack'; the fixes touch only rows that are not), and the v5 blend settings too;
     2. debut / manual bout with a line (the review's case: a hand-entered debutant, not in ML v2's roster, no decayed sums):
        source 'line', p = the line-only stack of the line kind (data/derived/line_stack.json), |logit p - logit line| small,
        corner symmetric; without the line stack, p = the de-vigged line itself, flagged; never the bare simulator;
     3. with the v5 winner setting ('stack') the 1.1.1 behaviour is kept but flagged (lineDropped);
     4. isDebutant honours n_fights, then record.ufc / ufc_fights, before the pro record; a manual debutant takes the debut path;
     5. the ml2stack interval is not degenerate with or without the MoE stack loaded (sdLogit > 0) and uses its own kappa
        (boot.inflateMl2stack), never the v5 kappa; its train coverage (tools/v6_kappa.js, leave-one-year-out 2021-2023) is in
        band: 80% interval 0.77-0.83, 95% interval 0.92-0.97, and the defaults equal the fitted file.
     node tests/test_blend121.js */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const E6 = require(path.join(ROOT, "versions/v6-rejected/engine3.js"));
const NEW = require(path.join(ROOT, "src/ml/blend.js"));
const OLD = require(path.join(ROOT, "versions/v6-rejected/ml/blend.js"));
let fails = 0, passes = 0;
function check(name, ok, info) { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`); }
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const lg = (p, c) => { c = c || 1e-6; p = Math.min(Math.max(p, c), 1 - c); return Math.log(p / (1 - p)); };
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
const use = (fb) => { if (fb) globalThis.FightBlend = fb; else delete globalThis.FightBlend; };

// engine v7: src/ml/blend.js is 1.3.0 (market props, off unless params.blend.props is on, which no v5 / v6 params do), so every
// 1.2.1 check below must still hold with it
const ver = (v) => String(v).split(".").map(Number), atLeast = (v, w) => { const a = ver(v), b = ver(w); for (let i = 0; i < 3; i++) { if (a[i] !== b[i]) return a[i] > b[i]; } return true; };
check("blend.js version >= 1.2.1 (frozen v6 copy 1.2.0)", atLeast(NEW.VERSION, "1.2.1") && OLD.VERSION === "1.2.0", "src " + NEW.VERSION);

// ---------------------------------------------------------------- 1. backtest identity (inputs as tools/predict_harness.js)
{
  const bt = rd("data/derived/backtest_dev.json"), keys = bt.meta.keys;
  const fights = bt.fights.filter((f) => f.date >= "2021-01-01" && f.date < "2024-01-01");
  for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
  const pick = []; for (let i = 0; i < 8; i++) pick.push(fights[Math.floor((i + 0.5) * fights.length / 8)]);
  const priors = rd("data/derived/mlcal_priors_asof.json"), OOF = rd("data/derived/mlrates_oof_fh.json");
  const rates = (arr) => { const o = {}; OOF.meta.targets.forEach((n, i) => { o[n] = arr[i]; }); return o; };
  const DURJ = rd("data/derived/durability.json"), SOSJ = rd("data/derived/sos_wf.json");
  const XR = require(path.join(ROOT, "versions/v6-rejected/mlpathrec.js"))(E6, ROOT);
  const STK = { "2021": "data/derived/v6/cmp_stack_v501_fit2020.json", "2022": "data/derived/v6/cmp_stack_v501_fit2021.json", "2023": "data/derived/v6/cmp_stack_v501_fit2022.json" };
  const PR6 = require(path.join(ROOT, "tools/predictrec.js"))(E6, ROOT, { stacks: STK, v6: true });
  const PR5 = require(path.join(ROOT, "tools/predictrec.js"))(E6, ROOT, { stacks: STK });
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
  const off = { blend: { winner: "stack", mrModel: "S", debut: false, statDist: false, mrWeight: 0.3 } };
  let n6 = 0, same6 = 0, n5 = 0, same5 = 0, srcs = {};
  const sig = (pk) => JSON.stringify([pk.p, pk.cells, pk.source, pk.v6 && pk.v6.fit, pk.v6 && pk.v6.stack, pk.methodRound.weight, pk.methodRound.variant]);
  for (const f of pick) {
    const b = baseOpts(f);
    for (const kind of ["open", "none", "close"]) {
      const o6 = Object.assign({}, b, PR6.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: 40, interval: false });
      use(null); const a = E6.predict(f.A, f.B, o6); use(NEW); const c = E6.predict(f.A, f.B, o6);
      n6++; if (sig(a) === sig(c)) same6++; srcs[c.source] = (srcs[c.source] || 0) + 1;
      const o5 = Object.assign({}, b, PR5.opts(f, false, { lineKind: kind }), { seed: hash32(f.id), sims: 40, interval: false }, { params: Object.assign({}, b.params, off) });
      use(null); const a5 = E6.predict(f.A, f.B, o5); use(NEW); const c5 = E6.predict(f.A, f.B, o5);
      n5++; if (sig(a5) === sig(c5)) same5++;
    }
  }
  check("backtest identity, v6 settings: 1.2.1 = frozen 1.2.0 (p, cells, source, fit, pool)", same6 === n6, `${same6}/${n6}, sources ${JSON.stringify(srcs)}`);
  check("backtest identity, v5 settings (winner 'stack', S cells): 1.2.1 = frozen 1.2.0", same5 === n5, `${same5}/${n5}`);
}

// ---------------------------------------------------------------- live path
const LS = rd("data/derived/line_stack.json");
E6.loadDB(rd("data/derived/fighters.json"));
try { E6.loadMLRates(rd("data/derived/mlrates.json")); } catch (e) { /* the page path may run without learned rates */ }
use(NEW);
const LOAD = { stack: rd("data/derived/blindtest_stack.json"), feat: rd("data/derived/moe_page.json"), ml2: rd("data/derived/ml2.json"),
  market: rd("data/derived/market.json"), methodRound: rd("data/derived/methodround.json"), winnerStacks: rd("data/derived/v6_stacks.json"),
  mrS2: rd("data/derived/mr_s2.json"), debut: rd("data/derived/debut.json"), statDist: rd("data/derived/statlines.json"),
  ml2Trees: rd("data/derived/ml2_trees.json") };
E6.loadBlend(Object.assign({ lineStack: LS }, LOAD));
const base = { division: "Lightweight", rounds: 3, title: false, date: "2026-12-12", sims: 120, seed: 3 };
const man = E6.manualProfile({ name: "Manual Debutant", slpm: 4.2, sapm: 3.9, acc: 0.47, def: 0.55, td15: 1.2, n_fights: 0, record: { w: 12, l: 1, d: 0, ufc: 0 } }, { division: "Lightweight" });
const implied = (o) => (o < 0 ? -o / (-o + 100) : 100 / (o + 100));
const mult = (a, b) => implied(a) / (implied(a) + implied(b));

// ---------------------------------------------------------------- 2. debut / manual bout with a line
{
  const o = Object.assign({ lineKind: "open", line: { oddsA: -300, oddsB: 240 } }, base);
  const p = E6.predict("dan-hooker", man, o), q = E6.predict(man, "dan-hooker", Object.assign({}, o, { line: { oddsA: 240, oddsB: -300 } }));
  const L = mult(-300, 240), slope = LS.stacks.open.production.slope, want = 1 / (1 + Math.exp(-slope * lg(L, 0.01)));
  check("manual debutant + opener: source 'line', p = the open line-only stack (never the bare simulator)", p.source === "line" && Math.abs(p.p - want) < 1e-12 && p.lineFallback && p.lineFallback.stack === "open|production",
    `p ${p.p.toFixed(4)}, line ${L.toFixed(4)}, slope ${slope}, simulator ${p.sim.p.toFixed(4)}`);
  check("  |logit p - logit line| <= 0.25 and the line routing record says open", Math.abs(lg(p.p) - lg(L)) <= 0.25 && p.lineType === "open", (lg(p.p) - lg(L)).toFixed(4));
  check("  corner symmetry", Math.abs(p.p + q.p - 1) < 1e-12, (p.p + q.p - 1).toExponential(2));
  check("  the debut path runs for the manual debutant (record.ufc 0; manualProfile drops n_fights 0)", man.n_fights === null && p.debut && p.debut.applied === true && p.debut.debutant.B === true && p.debut.debutant.A === false,
    JSON.stringify(p.debut && p.debut.debutant));
  const c = E6.predict("dan-hooker", man, Object.assign({}, base, { lineKind: "close", line: { oddsA: -300, oddsB: 240 } }));
  check("manual debutant + closing line: the close line-only stack (power de-vig)", c.source === "line" && c.lineFallback.stack === "close|production" &&
    Math.abs(lg(c.p) - LS.stacks.close.production.slope * lg(c.line.p, 0.01)) < 1e-9 && c.line.devig === "power", `p ${c.p.toFixed(4)}, line ${c.line.p.toFixed(4)}`);
  E6.loadBlend({ lineStack: null });
  const r = E6.predict("dan-hooker", man, o);
  check("without line_stack.json: p = the de-vigged opener itself, flagged", r.source === "line" && Math.abs(r.p - L) < 1e-12 && /no line stack loaded/.test(r.blendError), r.p.toFixed(4));
  E6.loadBlend({ lineStack: LS });
  const n = E6.predict("dan-hooker", man, Object.assign({ lineKind: "none" }, base));
  check("no line: the simulator alone, explained in blendError (no line to fall back on)", n.source === "engine" && /no ML v2 head value/.test(n.blendError) && !n.lineFallback);
}

// ---------------------------------------------------------------- 3. v5 winner setting keeps 1.1.1 behaviour, flagged
{
  const o = Object.assign({ lineKind: "open", line: { oddsA: -300, oddsB: 240 }, blend: { winner: "stack" } }, base);
  const p = E6.predict("dan-hooker", man, o);
  check("winner 'stack' (v5 settings): source engine as in 1.1.1, flagged lineDropped", p.source === "engine" && p.lineDropped === true && /LINE DROPPED/.test(p.blendError));
  const p2 = E6.predict("dan-hooker", man, Object.assign({}, o, { blend: { winner: "stack", lineFallback: true } }));
  check("  params.blend.lineFallback true turns the line fallback on for it", p2.source === "line");
}

// ---------------------------------------------------------------- 4. isDebutant
{
  const D = NEW.isDebutant;
  const cases = [[{ n_fights: 0 }, true], [{ n_fights: 5 }, false], [{ n_fights: null, record: { w: 12, l: 1, ufc: 0 } }, true],
    [{ n_fights: null, record: { w: 12, l: 1, ufc: 3 } }, false], [{ record: { w: 12, l: 1 } }, false], [{ ufc_fights: 0, record: { w: 9 } }, true],
    [{ record: { w: 0, l: 0, d: 0, nc: 0 } }, true], [{}, false]];
  const bad = cases.filter(([p, want]) => D(p) !== want);
  check("isDebutant: n_fights, then record.ufc / ufc_fights, then the pro record", bad.length === 0, bad.length ? JSON.stringify(bad) : cases.length + " cases");
}

// ---------------------------------------------------------------- 5. the ml2stack interval
{
  const K = rd("data/derived/v6/review/kappa_ml2stack.json"), d = NEW.DEFAULTS.boot.inflateMl2stack;
  check("boot.inflateMl2stack defaults = tools/v6_kappa.js fit", d.none === K.inflateMl2stack.none && d.open === K.inflateMl2stack.open && d.close === K.inflateMl2stack.close, JSON.stringify(d));
  const inBand = (r) => r.oof.cover80 >= 0.77 && r.oof.cover80 <= 0.83 && r.oof.cover95 >= 0.92 && r.oof.cover95 <= 0.97;
  check("train coverage of the close (leave-one-year-out 2021-2023): 80% in 0.77-0.83, 95% in 0.92-0.97", inBand(K.regimes.none) && inBand(K.regimes.open),
    `none ${K.regimes.none.oof.cover80}/${K.regimes.none.oof.cover95}, open ${K.regimes.open.oof.cover80}/${K.regimes.open.oof.cover95}`);
  const o = Object.assign({ lineKind: "open", line: { oddsA: 170, oddsB: -200 } }, base, { rounds: 5 });
  const a = E6.predict("alexander-volkanovski", "justin-gaethje", o);
  check("ml2stack interval with the MoE stack loaded: sdLogit > 0, kappa = inflateMl2stack.open", a.source === "ml2stack" && a.interval.sdLogit > 0.05 && a.interval.inflate === d.open && a.interval.calibrated,
    `sd ${a.interval.sdLogit.toFixed(4)}, cal80 ${a.interval.calibrated["0.8"].map((x) => x.toFixed(3)).join("-")}`);
  E6.loadBlend({ stack: null });
  const b = E6.predict("alexander-volkanovski", "justin-gaethje", o);
  check("ml2stack interval WITHOUT the MoE stack: not degenerate (1.2.0 gave sd 0)", b.source === "ml2stack" && b.interval.sdLogit > 0.05 && Math.abs(b.interval.sdLogit - a.interval.sdLogit) < 1e-12,
    `sd ${b.interval.sdLogit.toFixed(4)}`);
  use(null);
  E6.loadBlend(Object.assign({}, LOAD, { stack: null }));   // the frozen module has its own state: same files, no MoE stack
  const z = E6.predict("alexander-volkanovski", "justin-gaethje", o);
  check("  (frozen 1.2.0 reproduces the review's degenerate interval)", z.source === "ml2stack" && z.interval.sdLogit < 1e-9, `sd ${z.interval.sdLogit.toExponential(1)}`);
  use(NEW);
  const nl = E6.predict("alexander-volkanovski", "justin-gaethje", Object.assign({}, o, { lineKind: "none", line: undefined }));
  check("  no-line regime uses inflateMl2stack.none; the v5 kappa (2.15) is never applied to ml2stack", nl.interval.inflate === d.none && a.interval.inflate !== 2.15);
}
console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
