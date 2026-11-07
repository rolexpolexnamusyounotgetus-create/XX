// realism_sens component tests (params.components.realism_sens): flag-off equivalence with the engine before the change,
// division / format realism factors, the learned-rate league cache, FightEngine.sensitivity (tornado data, common random
// numbers), FightEngine.rateSd, and the tools/realism.js helpers.
//
// Usage: node tests/test_realism_sens.js [--ref <git ref of the engine before the change> | --ref-dir <dir holding that
//        engine's engine3.js, params3.js and ml/mlrates.js>] [--write-fixture]
//   The flag-off check compares against (1) the engine at the git ref in tests/fixtures/realism_sens_base.json (or --ref),
//   when git can show it, and (2) the digest stored in that fixture. --write-fixture rewrites the digest from the ref engine.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const RT = require(path.join(ROOT, "tools/realism.js"));
const FIX = path.join(__dirname, "fixtures/realism_sens_base.json");

const args = process.argv.slice(2);
const argv = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
let fails = 0, passes = 0;
function check(name, ok, info) { if (ok) passes++; else fails++; console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`); }
const sha = (s) => crypto.createHash("sha1").update(s).digest("hex");

const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
const mlJson = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/mlrates.json"), "utf8"));
E.loadDB(dbJson);

// ---------------------------------------------------------------- matchups used for the equivalence digest
function avgProfile(P, div, tag) {
  const S = {}; for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;
  return { name: `${tag} ${div}`, division: div, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}
function cases(Eng) {
  const P = Eng.priorFor("Women's Strawweight");
  return [
    { name: "Volk vs Gaethje (5-rd title, base tables)", A: "alexander-volkanovski", B: "justin-gaethje", o: { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" }, ml: false },
    { name: "Volk vs Gaethje (learned rates)", A: "alexander-volkanovski", B: "justin-gaethje", o: { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" }, ml: true },
    { name: "Makhachev vs Oliveira (3-rd, learned rates)", A: "islam-makhachev", B: "charles-oliveira", o: { division: "Lightweight", rounds: 3, date: "2026-11-06" }, ml: true },
    { name: "league-average pair, W-SW 3-rd", A: avgProfile(P, "Women's Strawweight", "A"), B: avgProfile(P, "Women's Strawweight", "B"), o: { division: "Women's Strawweight", rounds: 3 }, ml: false }
  ];
}
function digest(Eng, extraOpts, nF) {
  const out = [];
  for (const c of cases(Eng)) {
    if (c.ml) Eng.loadMLRates(mlJson); else if (Eng.loadMLRates) Eng.loadMLRates(null);
    const a = typeof c.A === "string" && !Eng.profile(c.A) ? null : c.A, b = typeof c.B === "string" && !Eng.profile(c.B) ? null : c.B;
    if (!a || !b) { out.push(c.name + ": missing"); continue; }
    const o = Object.assign({}, c.o, extraOpts || {});
    const m = Eng.matchup(a, b, o);
    const fights = [];
    for (let s = 1; s <= nF; s++) {
      const f = Eng.simulate(m, Eng.makeRng(s), false);
      fights.push([f.winner, f.method, f.round, f.t, f.cards, f.totals, f.n108, f.detail]);
    }
    const tr = Eng.simulate(m, Eng.makeRng(3), true);
    const sm = Eng.summarize(m, 300, 7);
    out.push(c.name + ":" + sha(JSON.stringify([fights, tr.rounds, sm.bins, sm.avg, sm.methods, m.dRate, m.kd, m.tdD, m.ctrlT, m.mlApplied])));
  }
  if (Eng.loadMLRates) Eng.loadMLRates(null);
  return out;
}

// ---------------------------------------------------------------- 1. flag off = the engine before the change
console.log("=== flag off reproduces the engine before the change ===");
const fixture = fs.existsSync(FIX) ? JSON.parse(fs.readFileSync(FIX, "utf8")) : {};
const refDirArg = argv("--ref-dir");
const ref = refDirArg ? null : (argv("--ref") || fixture.base_commit || null);
const refLabel = refDirArg ? path.resolve(refDirArg) : ref;
let refE = null, refDir = null;
if (refDirArg) {
  try { refE = require(path.resolve(refDirArg, "engine3.js")); refE.loadDB(dbJson); }
  catch (e) { refE = null; console.log("      (reference engine in " + refDirArg + " not loadable: " + String(e.message || e).split("\n")[0] + ")"); }
} else if (ref) {
  try {
    refDir = fs.mkdtempSync(path.join(os.tmpdir(), "realism-ref-"));
    fs.mkdirSync(path.join(refDir, "ml"));
    for (const f of ["engine3.js", "params3.js", "ml/mlrates.js"]) {
      const txt = execFileSync("git", ["show", ref + ":src/" + f], { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
      fs.writeFileSync(path.join(refDir, f), txt);
    }
    refE = require(path.join(refDir, "engine3.js"));
    refE.loadDB(dbJson);
  } catch (e) { refE = null; console.log("      (git ref " + ref + " not available: " + String(e.message || e).split("\n")[0] + ")"); }
}
const NF = 150;
// wild realism factors present in the params, but the flag off: they must be ignored
const wild = { components: { realism_sens: false }, realism: { div: { "Lightweight": { ko: 3, sub: 0.2, kd: 2, att: 1.5, td: 2, ctrl: 0.5 }, "Women's Strawweight": { ko: 2.5, sub: 3 } }, fmt: { "5": { ko: 0.3, sub: 2 } } } };
const dOff = digest(E, { params: wild }, NF);
// the reference engine / stored digest predate v5 Calibrate A, which turned components.v401.mlLevels off by default
// (research/v5_train_ablation.md): compare them with the flag pinned to their state (on)
// v5 Calibrate B (components.calB, the joint level pass) postdates them too: off
const wildPinned = Object.assign({}, wild, { components: Object.assign({}, wild.components, { v401: { mlLevels: true }, calB: false, v501: false }) });
const dOffRef = digest(E, { params: wildPinned }, NF);
if (refE) {
  const dRef = digest(refE, null, NF);
  check("flag off (opts.params, wild factors present) = engine at " + (refDirArg ? refLabel : ref.slice(0, 10)) + ", bit for bit", JSON.stringify(dOffRef) === JSON.stringify(dRef),
    dOffRef.map((x, i) => x === dRef[i] ? "ok" : "DIFF " + x.split(":")[0]).join("; "));
  if (args.includes("--write-fixture")) {
    fs.writeFileSync(FIX, JSON.stringify({ base_commit: ref || null, base_dir: refDirArg ? refLabel : undefined, note: "digest of the engine before the realism_sens change (tests/test_realism_sens.js digest(), " + NF + " fights per case)", digest: dRef }, null, 1) + "\n");
    console.log("      wrote " + FIX);
  }
}
if (fixture.digest) check("flag off = stored digest of the engine before the change (tests/fixtures/realism_sens_base.json; v401.mlLevels pinned on)", JSON.stringify(dOffRef) === JSON.stringify(fixture.digest),
  dOffRef.map((x, i) => x === fixture.digest[i] ? "ok" : "DIFF " + x.split(":")[0]).join("; "));
{
  // flag off through the global FightParams (no opts.params): same result, and no stale learned-rate league cache
  const save = JSON.stringify({ c: FP.components, r: FP.realism });
  FP.components.realism_sens = false; FP.realism.div = wild.realism.div; FP.realism.fmt = wild.realism.fmt;
  const dG = digest(E, null, NF);
  FP.components.realism_sens = true;
  const dOnWild = digest(E, null, 40);
  const s = JSON.parse(save); FP.components = s.c; FP.realism = s.r;
  check("flag off via the global FightParams = flag off via opts.params", JSON.stringify(dG) === JSON.stringify(dOff));
  check("flag on with the same wild factors changes the fights (the flag is live)", dOnWild.every((x, i) => x !== dOff[i]));
}
{
  // neutral factors with the flag on change nothing (x 1 is exact). opts.params merges per division, so every division and
  // format entry is listed to replace the fitted values in params3.js
  const divs = Object.keys(FP.div);
  const one = { ko: 1, sub: 1, kd: 1, att: 1, td: 1, ctrl: 1 };
  const neutral = { components: { realism_sens: true }, realism: { div: Object.fromEntries(divs.map((d) => [d, one])), fmt: { "3": one, "5": one } } };
  check("flag on with neutral factors = flag off", JSON.stringify(digest(E, { params: neutral }, NF)) === JSON.stringify(dOff));
  const empty = { components: { realism_sens: true }, realism: { div: Object.fromEntries(divs.map((d) => [d, {}])), fmt: { "3": {}, "5": {} } } };
  check("flag on with no factors = flag off", JSON.stringify(digest(E, { params: empty }, NF)) === JSON.stringify(dOff));
  // the fitted factors in params3.js are live with the flag on and change the fights (explicit flag: the shipped default may be off)
  const hasFit = Object.keys((FP.realism && FP.realism.div) || {}).length + Object.keys((FP.realism && FP.realism.fmt) || {}).length > 0;
  if (hasFit) check("flag on with the fitted params3.js factors changes the fights", JSON.stringify(digest(E, { params: { components: { realism_sens: true } } }, 40)) !== JSON.stringify(digest(E, { params: { components: { realism_sens: false } } }, 40)));
  else console.log("      (params3.js carries no fitted realism factors yet: run tools/realism.js fit)");
  // the global default reproduces whichever setting params3.js ships
  const dflt = !!(FP.components && FP.components.realism_sens);
  check("default params = explicit flag " + (dflt ? "on" : "off"), JSON.stringify(digest(E, null, 20)) === JSON.stringify(digest(E, { params: { components: { realism_sens: dflt } } }, 20)));
}
{
  // API: the matchup object keeps its enumerable keys when the flag is off; m.realism appears only when factors apply
  const o = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" };
  const mOff = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { components: { realism_sens: false } } }, o));
  const mOn = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { components: { realism_sens: true }, realism: { div: { "Lightweight": { ko: 1.2 } }, fmt: { "5": {} } } } }, o));
  const keysOff = Object.keys(mOff), keysOn = Object.keys(mOn);
  check("matchup keys unchanged with the flag off (profiles are non-enumerable)", !keysOff.includes("realism") && !keysOff.includes("_src") && mOff._src && mOff._src.A.name === "Alexander Volkanovski");
  check("flag on: m.realism carries the factors in effect", keysOn.includes("realism") && mOn.realism.ko === 1.2, JSON.stringify(mOn.realism));
}
if (refDir) try { fs.rmSync(refDir, { recursive: true, force: true }); } catch (e) { /* ignore */ }

// ---------------------------------------------------------------- 2. realism factors
console.log("\n=== realism factors ===");
{
  const p = { components: { realism_sens: true }, realism: { div: { "Lightweight": { ko: 1.2, sub: 0.8 } }, fmt: { "5": { ko: 0.9, att: 1.05 } } } };
  const f5 = E.realismFactors(p, "Lightweight", 5), f3 = E.realismFactors(p, "Lightweight", 3), fw = E.realismFactors(p, "Welterweight", 3);
  check("division x format factors combine multiplicatively", Math.abs(f5.ko - 1.08) < 1e-12 && f5.sub === 0.8 && f5.att === 1.05, JSON.stringify(f5));
  check("3-round fight takes the division factors only; a division without factors gets none", f3.ko === 1.2 && !("att" in f3) && fw === null);
  check("flag off -> no factors", E.realismFactors({ components: { realism_sens: false }, realism: p.realism }, "Lightweight", 5) === null && E.realismFactors({ realism: p.realism }, "Lightweight", 5) === null);
  // null / "" / 0 / negative / NaN entries mean "unset" (= 1), never a zeroed lever (isFinite(null) is true)
  const pn = { components: { realism_sens: true }, realism: { div: { "Lightweight": { ko: null, sub: "", kd: 0, td: -1, ctrl: NaN, att: 1.1 } }, fmt: { "5": { ko: null } } } };
  const fn = E.realismFactors(pn, "Lightweight", 5);
  check("null / empty / non-positive factors are ignored (verifier fix)", fn && Object.keys(fn).join() === "att" && fn.att === 1.1, JSON.stringify(fn));
}
{
  // direction: ko / sub / kd / att factors move the league-average pair's outcomes the stated way (common seeds)
  const P = E.priorFor("Welterweight");
  const A = avgProfile(P, "Welterweight", "A"), B = avgProfile(P, "Welterweight", "B");
  const run = (fac) => E.summarize(E.matchup(A, B, { division: "Welterweight", rounds: 3, params: { components: { realism_sens: true }, realism: { div: { "Welterweight": fac } } } }), 6000, 5);
  const s0 = run({}), sK = run({ ko: 1.6 }), sS = run({ sub: 1.8 }), sA = run({ att: 1.2 }), sD = run({ kd: 1.5 });
  const ko = (s) => s.bins[0] + s.bins[6], sub = (s) => s.bins[1] + s.bins[5];
  check("ko factor up -> more KO/TKO", ko(sK) > ko(s0) + 0.02, `${(100 * ko(s0)).toFixed(1)} -> ${(100 * ko(sK)).toFixed(1)}%`);
  check("sub factor up -> more submissions", sub(sS) > sub(s0) + 0.015, `${(100 * sub(s0)).toFixed(1)} -> ${(100 * sub(sS)).toFixed(1)}%`);
  // per fight-minute (v5 Calibrate B): per-fight totals mix in fight length, and with the re-levelled knockdown / conversion levels the
  // att 1.2 fights end sooner (per fight x1.09, per minute x1.16; before Calibrate B x1.14 / x1.19)
  const apm = (s) => s.avg.A.sig_att / s.avgMin;
  check("att factor up -> more strike attempts (per fight-minute)", apm(sA) > apm(s0) * 1.1, `${apm(s0).toFixed(2)} -> ${apm(sA).toFixed(2)} per minute`);
  check("kd factor up -> more knockdowns per landed head strike", sD.avg.A.kdPer100Head > s0.avg.A.kdPer100Head * 1.2, `${s0.avg.A.kdPer100Head.toFixed(2)} -> ${sD.avg.A.kdPer100Head.toFixed(2)}`);
}
{
  // the factors reach the learned-rate targets (league level re-built with them) and the cache never goes stale
  E.loadMLRates(mlJson);
  const o = { division: "Lightweight", rounds: 3, date: "2026-11-06" };
  const mk = (flag, att) => E.matchup("islam-makhachev", "charles-oliveira", Object.assign({ params: { components: { realism_sens: flag }, realism: { div: { "Lightweight": { att } } } } }, o));
  const m0 = mk(false, 1.3), m1 = mk(true, 1.3), m2 = mk(true, 1);
  check("learned rates applied", m0.mlApplied && m1.mlApplied);
  const r = m1.dRate[0] / m0.dRate[0];
  check("att factor reaches the learned-rate attempt targets", Math.abs(r - 1.3) < 0.03, "ratio " + r.toFixed(3));
  check("flag on with att 1 = flag off tables", Math.abs(m2.dRate[0] - m0.dRate[0]) < 1e-12);
  // global flip without opts.params: the learned-rate league cache must not serve a level built under the other setting
  const save = JSON.stringify({ c: FP.components, r: FP.realism });
  FP.realism.div = { "Lightweight": { att: 1.3 } };
  FP.components.realism_sens = true; const g1 = E.matchup("islam-makhachev", "charles-oliveira", o);
  FP.components.realism_sens = false; const g0 = E.matchup("islam-makhachev", "charles-oliveira", o);
  FP.components.realism_sens = true; const g1b = E.matchup("islam-makhachev", "charles-oliveira", o);
  const s = JSON.parse(save); FP.components = s.c; FP.realism = s.r;
  check("global flag flips are not served from a stale league cache", Math.abs(g1.dRate[0] / g0.dRate[0] - 1.3) < 0.03 && g1b.dRate[0] === g1.dRate[0],
    (g1.dRate[0] / g0.dRate[0]).toFixed(3));
  E.loadMLRates(null);
}

// ---------------------------------------------------------------- 3. sensitivity
console.log("\n=== FightEngine.sensitivity ===");
{
  const o = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" };
  const m = E.matchup("alexander-volkanovski", "justin-gaethje", o);
  const t0 = Date.now();
  const S = E.sensitivity(m, { n: 500, seed: 3, keys: ["out", "chin", "tdAtt", "judgePower"] });
  const ms = Date.now() - t0;
  const S2 = E.sensitivity(m, { n: 500, seed: 3, keys: ["out", "chin", "tdAtt", "judgePower"] });
  check("item count: knob + rate x 2 sides per key, judges' power once", S.items.length === 3 * 2 * 2 + 1, S.items.length + " items");
  check("sorted by swing", S.items.every((it, i) => i === 0 || S.items[i - 1].swing >= it.swing));
  check("deterministic for a seed", JSON.stringify(S.items) === JSON.stringify(S2.items) && JSON.stringify(S.base) === JSON.stringify(S2.base));
  const sm = E.summarize(m, 500, 3);
  check("base summary is a valid distribution", Math.abs(S.base.bins.reduce((a, b) => a + b, 0) - 1) < 1e-3 && Math.abs(S.base.pA + S.base.pB + S.base.pD - 1) < 1e-3 &&
    Math.abs(S.base.pA - sm.pA) < 0.08, `pA ${S.base.pA} vs summarize ${sm.pA.toFixed(3)}`);
  const it = (id) => S.items.find((x) => x.id === id);
  check("A output knob up -> A wins more (dPWin > 0)", it("A.out.knob").hi.pA > it("A.out.knob").lo.pA && it("A.out.knob").dPWin > 0, `${it("A.out.knob").lo.pA} -> ${it("A.out.knob").hi.pA}`);
  check("B output knob up -> B wins more", it("B.out.knob").hi.pB > it("B.out.knob").lo.pB, `${it("B.out.knob").lo.pB} -> ${it("B.out.knob").hi.pB}`);
  check("chin knob up (easier to drop) on B -> more KO losses for B", it("B.chin.knob").hi.bins[0] > it("B.chin.knob").lo.bins[0], `${it("B.chin.knob").lo.bins[0]} -> ${it("B.chin.knob").hi.bins[0]}`);
  check("judges' power item spans 0 .. 2 x default", it("judgePower.knob").mult[0] === 0 && Math.abs(it("judgePower.knob").mult[1] - 2 * m.judgePower) < 1e-9);
  check("multipliers are exp(-/+ sd)", Math.abs(it("A.out.knob").mult[0] * it("A.out.knob").mult[1] - 1) < 1e-3 && Math.abs(Math.log(it("A.out.knob").mult[1]) - it("A.out.knob").sd) < 1e-3);
  // common random numbers: the paired se of a swing is well below the se two independent runs would have
  const x = it("A.out.knob"), indep = Math.sqrt(x.lo.pA * (1 - x.lo.pA) / 500 + x.hi.pA * (1 - x.hi.pA) / 500);
  const y = it("A.tdAtt.rate"), indepY = Math.sqrt(y.lo.pA * (1 - y.lo.pA) / 500 + y.hi.pA * (1 - y.hi.pA) / 500);
  check("common random numbers cut the swing's Monte Carlo se", x.se < 0.85 * indep && y.se < 0.85 * indepY, `out knob se ${x.se.toFixed(4)} vs independent ${indep.toFixed(4)}; td rate ${y.se.toFixed(4)} vs ${indepY.toFixed(4)}`);
  check("fast: 25 variants x 500 fights under 30 s", ms < 30000, ms + " ms");
  // learned-rate matchups rebuild with the same learned rates
  E.loadMLRates(mlJson);
  const mm = E.matchup("alexander-volkanovski", "justin-gaethje", o);
  const Sm = E.sensitivity(mm, { n: 200, seed: 1, keys: ["pow"], kinds: ["rate"] });
  E.loadMLRates(null);
  check("works on learned-rate matchups", mm.mlApplied && Sm.items.length === 2 && Sm.items.every((q) => q.lo.pA >= 0 && q.hi.pA <= 1));
  let threw = false; try { E.sensitivity({ opts: {} }); } catch (e) { threw = /profiles/.test(e.message); }
  check("clear error without profiles", threw);
}
{
  // rateSd: finite, positive, larger with less data, on the knob's scale
  const P = E.priorFor("Lightweight");
  const big = avgProfile(P, "Lightweight", "Big"), small = avgProfile(P, "Lightweight", "Small");
  for (const k of Object.keys(small.S)) small.S[k] /= 8;
  const mb = E.matchup(big, small, { division: "Lightweight", rounds: 3 });
  const a = E.rateSd(mb, 0), b = E.rateSd(mb, 1);
  check("rateSd finite and positive", Object.values(a).concat(Object.values(b)).every((v) => isFinite(v) && v > 0), JSON.stringify(a));
  check("rateSd larger with 1/8 the minutes", Object.keys(a).every((k) => b[k] > a[k]), Object.keys(a).map((k) => `${k} ${a[k].toFixed(3)}/${b[k].toFixed(3)}`).join(", "));
  const mp = E.matchup(big, small, { division: "Lightweight", rounds: 3, params: { realism: { disp: { att: 9 } } } });
  const m1 = E.matchup(big, small, { division: "Lightweight", rounds: 3, params: { realism: { disp: { att: 1 } } } });
  check("over-dispersion phi scales the rate sd by sqrt(phi)", Math.abs(E.rateSd(mp, 0).out / E.rateSd(m1, 0).out - 3) < 1e-9);
}

// ---------------------------------------------------------------- 4. tools/realism.js helpers
console.log("\n=== tools/realism.js helpers ===");
{
  check("resultBin maps outcomes in the data's orientation", RT.resultBin({ winner: "A", method: "KO" }) === 0 && RT.resultBin({ winner: "B", method: "SUB" }) === 5 &&
    RT.resultBin({ winner: "A", method: "SD" }) === 2 && RT.resultBin({ winner: "D", method: "DRAW" }) === 3 && RT.resultBin({ winner: "NC", method: "NC" }) === -1 &&
    RT.resultBin({ winner: "B", method: "DOC" }) === 6);
  check("Poisson deviance", Math.abs(RT.poisDev(0, 2.5) - 5) < 1e-12 && Math.abs(RT.poisDev(3, 3)) < 1e-12 && RT.poisDev(5, 2) > 0);
  const sh = RT.ebShrink([{ key: "a", r: 0.5, v: 0.01 }, { key: "b", r: -0.4, v: 0.01 }, { key: "c", r: 0.05, v: 0.2 }, { key: "d", r: 0.3, v: 1 }]);
  check("EB shrinkage: tau2 > 0 with real spread, precise groups barely shrink, noisy ones a lot", sh.tau2 > 0 && Math.abs(sh.a / 0.5) > 0.8 && Math.abs(sh.d / 0.3) < 0.4, JSON.stringify(sh));
  const sh0 = RT.ebShrink([{ key: "a", r: 0.01, v: 0.1 }, { key: "b", r: -0.02, v: 0.1 }, { key: "c", r: 0.0, v: 0.1 }]);
  check("EB shrinkage: no spread beyond noise -> everything to 0", sh0.tau2 === 0 && sh0.a === 0);
  // verifier fix: a group with no real event (a small division, e.g. 8 fights and 0 KDs) must not blow up tau^2 and unshrink
  // every other group. 11 groups on target (O = Ex = 150 events) + one with O = 0, Ex = 2.6.
  const ents = []; for (let g = 0; g < 11; g++) { const q = RT.logRatioCC(150, 150, "count", 150); ents.push({ key: "g" + g, r: q.r, v: q.v }); }
  const qz = RT.logRatioCC(0, 2.6, "count", 8); ents.push({ key: "zero", r: qz.r, v: qz.v });
  const shz = RT.ebShrink(ents);
  check("EB targets: a zero-event group keeps tau^2 small and its own ratio bounded (continuity correction)", Math.sqrt(shz.tau2) < 0.15 && shz.zero > -1 && isFinite(qz.r) && qz.r > -2.5,
    `tau ${Math.sqrt(shz.tau2).toFixed(3)}, r ${qz.r.toFixed(2)} -> ${shz.zero.toFixed(3)}`);
  const qs = RT.logRatioCC(0, 1.7, "share", 8);
  check("EB targets: zero share gives a finite, bounded log ratio", isFinite(qs.r) && qs.r > -2 && qs.v > 0, JSON.stringify(qs));
  // bootstrap: identical inputs -> zero difference with a degenerate CI; shifted -> CI excludes 0
  const mkPf = (shift) => Array.from({ length: 120 }, (_, i) => ({ event: "e" + (i % 40), winLL: 0.6 + 0.1 * Math.sin(i) + shift, softCE: 0.6, bin7LL: 1.5, methodLL: 0.9, statDev: 10, brier: 0.2, acc: 0.6,
    statDevPer: { sig_lnd: 1, sig_att: 1, h_lnd: 1, b_lnd: 1, l_lnd: 1, kd: 1, td_att: 1, td_lnd: 1, sub_att: 1, ctrl: 1 },
    br: { sim: { ko: 0.3, sub: 0.2, dec: 0.5, fin3: [0.1, 0.1, 0.1], dec3: [0.4, 0.1, 0], st: { sig_att: 100, sig_lnd: 50, h_lnd: 30, b_lnd: 10, l_lnd: 10, kd: 0.3, td_att: 3, td_lnd: 1, ctrl: 100, sub_att: 0.3 }, min: 12 },
      real: { ko: i % 3 === 0 ? 1 : 0, sub: 0, dec: i % 3 === 0 ? 0 : 1, fin3: [i % 3 === 0 ? 1 : 0, 0, 0], dec3: [i % 3 === 0 ? 0 : 1, 0, 0], st: { sig_att: 100, sig_lnd: 50, h_lnd: 30, b_lnd: 10, l_lnd: 10, kd: 0.3, td_att: 3, td_lnd: 1, ctrl: 100, sub_att: 0.3 }, min: 12 } } }));
  const b0 = RT.bootstrap(mkPf(0), mkPf(0), 200, 3), b1 = RT.bootstrap(mkPf(0), mkPf(-0.01), 200, 3);
  check("paired bootstrap: identical configs -> 0 difference", b0.point.diff.winLL === 0 && b0.ci["diff:winLL"][0] === 0 && b0.ci["diff:winLL"][1] === 0 && b0.events === 40);
  check("paired bootstrap: a constant shift is recovered with a CI excluding 0", Math.abs(b1.point.diff.winLL + 0.01) < 1e-12 && b1.ci["diff:winLL"][1] < 0);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
