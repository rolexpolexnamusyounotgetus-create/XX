// Officials component tests (params.components.officials; roadmap v8).
//
//   node tests/test_officials.js                      all checks; flag-off equality against the golden fixture
//   node tests/test_officials.js --base <engine.js>   flag-off equality against that engine file directly (use the
//                                                     engine the component was applied on, e.g. git show <base>:src/engine3.js)
//   node tests/test_officials.js --base <engine.js> --write-golden   rewrite tests/fixtures/officials_off_golden.json
//
// 1. Flag off = the engine before the component, bit for bit: same fights (trace on and off, every event) and the same
//    summarize() output for the same seeds.
// 2. Flag on: determinism, trace = no-trace, corner symmetry, the main RNG stream stays in step with the flag-off
//    engine (same fight path when the referee is neutral), named judges / referee resolution, tendencies move
//    decisions and stoppages in the stated direction, the shared panel noise reproduces near-even-round unanimity,
//    walk-forward table selection never uses a table fit on later fights.
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const ROOT = path.join(__dirname, "..");
const E = require(path.join(ROOT, "src/engine3.js"));
const FP = require(path.join(ROOT, "src/params3.js"));
const MLR = require(path.join(ROOT, "src/ml/mlrates.js"));
const dbJson = fs.readFileSync(path.join(ROOT, "data/derived/fighters.json"), "utf8");
E.loadDB(dbJson);
const GOLDEN = path.join(ROOT, "tests/fixtures/officials_off_golden.json");
const TABLES = path.join(ROOT, "data/derived/officials_engine.json");
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const sha = (x) => crypto.createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const OFF = { components: { officials: false } }, ON = { components: { officials: true } };

// load an engine file with this repo's params and ML module (so a base engine extracted anywhere resolves them)
function loadEngineFrom(file) {
  const src = fs.readFileSync(file, "utf8");
  const mod = { exports: {} };
  const req = (p) => (/params3\.js$/.test(p) ? FP : /mlrates\.js$/.test(p) ? MLR : require(p));
  const g = {};   // a private global: the UMD wrapper must not see this engine's FightEngine / FightParams
  new Function("module", "exports", "require", "globalThis", "self", "window", src)(mod, mod.exports, req, g, undefined, undefined);
  const X = mod.exports;
  X.loadDB(dbJson);
  return X;
}

// ---------------------------------------------------------------- cases for the bit-for-bit check
function avgProfile(div, tag) {
  const P = JSON.parse(dbJson).priors[div], S = {};
  for (const k of E.KEYS) S[k] = (P[k] || 0) * 400;
  return { name: `${tag} ${div}`, division: div, S, age: 30, ko_losses: 0, pace: null, pace_w: null };
}
const CASES = [
  { a: "alexander-volkanovski", b: "justin-gaethje", o: { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" } },
  { a: "justin-gaethje", b: "alexander-volkanovski", o: { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06", judges: { power: 0.6 } } },
  { a: "AVG_A", b: "AVG_B", o: { division: "Welterweight", rounds: 3 } },
  { a: "AVG_A", b: "AVG_B", o: { division: "Flyweight", rounds: 3, adjA: { out: 1.3, tdAtt: 2 }, adjB: { chin: 1.4 } } }
];
function prof(x, div) { return x === "AVG_A" ? avgProfile(div, "A") : x === "AVG_B" ? avgProfile(div, "B") : x; }
function caseOutputs(X, params) {
  const out = [];
  CASES.forEach((c, ci) => {
    const m = X.matchup(prof(c.a, c.o.division), prof(c.b, c.o.division), Object.assign({}, c.o, { params: params, ml: false }));
    const fights = [];
    for (let s = 1; s <= 40; s++) {
      const f1 = X.simulate(m, X.makeRng(1000 * ci + s), true), f0 = X.simulate(m, X.makeRng(1000 * ci + s), false);
      fights.push(sha(f1), sha(f0));
    }
    out.push({ fights: sha(fights.join("")), summary: sha(X.summarize(m, 3000, 77 + ci)) });
  });
  return out;
}

console.log("=== 1. flag off = engine before the component (bit for bit) ===");
const mine = caseOutputs(E, OFF);
const baseFile = opt("--base");
if (baseFile) {
  const B = loadEngineFrom(baseFile);
  const ref = caseOutputs(B, OFF);
  CASES.forEach((c, i) => check(`case ${i} (${c.a} vs ${c.b}, ${c.o.division}): 160 fights + summarize identical to ${path.basename(baseFile)}`,
    mine[i].fights === ref[i].fights && mine[i].summary === ref[i].summary));
  if (args.includes("--write-golden")) {
    fs.writeFileSync(GOLDEN, JSON.stringify({ note: "sha256 of flag-off outputs (tests/test_officials.js caseOutputs) from the engine the officials component was applied on",
      base_engine: path.basename(baseFile), base_engine_sha256: sha(fs.readFileSync(baseFile, "utf8")), params_version: FP.version, cases: ref }, null, 1));
    console.log("wrote " + path.relative(ROOT, GOLDEN));
  }
} else if (fs.existsSync(GOLDEN)) {
  const G = JSON.parse(fs.readFileSync(GOLDEN, "utf8"));
  // the golden predates v5 Calibrate A, which turned components.v401.mlLevels off by default (research/v5_train_ablation.md):
  // compare with that sub-flag pinned to the golden's state (on)
  const mineG = caseOutputs(E, { components: { officials: false, v401: { mlLevels: true } } });
  CASES.forEach((c, i) => check(`case ${i} (${c.a} vs ${c.b}, ${c.o.division}): flag-off outputs match the golden hashes of ${G.base_engine} (v401.mlLevels pinned on)`,
    mineG[i].fights === G.cases[i].fights && mineG[i].summary === G.cases[i].summary,
    mineG[i].fights === G.cases[i].fights ? "" : "regenerate with --base <engine the component sits on> --write-golden if the base engine changed"));
} else check("golden fixture present (run with --base <engine.js> --write-golden)", false);

// a flag-off matchup carries no officials and no fight carries an officials record
const mOff = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5, title: true, params: OFF });
check("flag off: m.off is null and fights carry no officials field", mOff.off === null && E.simulate(mOff, E.makeRng(5), false).officials === undefined);

console.log("\n=== 2. flag on ===");
const T = JSON.parse(fs.readFileSync(TABLES, "utf8"));
E.loadOfficials(T);
const VG = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" };
const mOn = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: ON }, VG));
check("flag on: m.off built from the latest table", mOn.off && mOn.off.table === true);
const strip = (f) => JSON.stringify({ w: f.winner, m: f.method, d: f.detail, r: f.round, t: f.t, c: f.cards, tot: f.totals, o: f.officials, n108: f.n108 });
let det = true, tr = true;
for (let s = 1; s <= 200; s++) {
  const a = E.simulate(mOn, E.makeRng(s), false), b = E.simulate(mOn, E.makeRng(s), false), c = E.simulate(mOn, E.makeRng(s), true);
  if (strip(a) !== strip(b)) det = false;
  if (strip(a) !== strip(c)) tr = false;
}
check("flag on: same seed -> same fight (200 seeds)", det);
check("flag on: trace=true and trace=false give the same fight", tr);

// the main stream stays in step: with the referee neutral, every fight follows the flag-off path (same totals, same
// finish); only decisions can differ
{
  const mN = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { components: { officials: true }, officials: { referee: false } } }, VG));
  const mO = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: OFF }, VG));
  let same = 0, n = 0, decDiff = 0;
  for (let s = 1; s <= 400; s++) {
    const a = E.simulate(mN, E.makeRng(s), false), b = E.simulate(mO, E.makeRng(s), false);
    n++;
    const fin = !E.isDecision(a);
    if (JSON.stringify(a.totals) === JSON.stringify(b.totals) && (fin ? (a.winner === b.winner && a.method === b.method && a.t === b.t) : E.isDecision(b))) same++;
    if (!fin && a.winner !== b.winner) decDiff++;
  }
  check("RNG sync: neutral referee -> every fight has the flag-off totals and finish (400 seeds)", same === n, `${same}/${n}; decisions with another winner ${decDiff}`);
}

// corner symmetry with the same named officials
{
  const ofs = { judges: ["Sal D'Amato", "Derek Cleary", "Chris Lee"], referee: "Herb Dean" };
  const m1 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: ON }, VG, ofs));
  const m2 = E.matchup("justin-gaethje", "alexander-volkanovski", Object.assign({ params: ON }, VG, ofs));
  const s1 = E.summarize(m1, 30000, 11), s2 = E.summarize(m2, 30000, 12);
  const se = Math.sqrt(2 * s1.pA * (1 - s1.pA) / 30000);
  check("corner symmetry: P(Volk) as A = P(Volk) as B within 3 se", Math.abs(s1.pA - s2.pB) < 3 * se + 0.002, `${s1.pA.toFixed(4)} vs ${s2.pB.toFixed(4)}`);
  const f = E.simulate(m1, E.makeRng(9), false);
  check("named officials resolve (names and aliases) and are reported", JSON.stringify(f.officials.judges) === JSON.stringify(["Sal D'Amato", "Derek Cleary", "Chris Lee"]) &&
    f.officials.referee === "Herb Dean", JSON.stringify(f.officials));
  const m3 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: ON }, VG, { judges: ["sal d'amato", "m318", "Nobody Inparticular"], referee: "Some New Referee" }));
  check("name keys, ids and unknown names resolve (unknown -> population draw)", m3.off.slots[0].key === "m94" && m3.off.slots[1].key === "m318" &&
    m3.off.slots[2].key === null && m3.off.slots[2].eff === null && m3.off.ref.mult === null);
}

// tendencies move outcomes in the stated direction (synthetic table: three grappling-loving vs three striking-loving judges)
{
  const t = JSON.parse(JSON.stringify(T.tables["2024"]));
  t.judges = { g1: ["Grap 1", 0, -0.4, 0, 0.8, 0, 100], g2: ["Grap 2", 0, -0.4, 0, 0.8, 0, 100], g3: ["Grap 3", 0, -0.4, 0, 0.8, 0, 100],
    s1: ["Str 1", 0, 0.4, 0, -0.8, 0, 100], s2: ["Str 2", 0, 0.4, 0, -0.8, 0, 100], s3: ["Str 3", 0, 0.4, 0, -0.8, 0, 100],
    w1: ["Wide 1", 0, 0, 0, 0, 2.0, 100], w2: ["Wide 2", 0, 0, 0, 0, 2.0, 100], w3: ["Wide 3", 0, 0, 0, 0, 2.0, 100] };
  t.referees = { "Quick Ref": [3, 3, 3, 100], "Late Ref": [0.33, 0.33, 0.33, 100] };
  const set = { tables: { 2024: t }, aliases: {} };
  // a wrestler vs a striker: league-average welterweights with the A side's takedowns x3 and striking output x0.8
  // v5: params3.js ships named-judge effects off (officials.perJudge false); the tendency checks switch them on explicitly
  const ONJ = { components: { officials: true }, officials: { perJudge: true } };
  const base = { division: "Welterweight", rounds: 3, officials: set, adjA: { tdAtt: 3, out: 0.8 }, params: ONJ };
  const pick = (js, b) => E.summarize(E.matchup(avgProfile("Welterweight", "A"), avgProfile("Welterweight", "B"), Object.assign({ judges: js, referee: "Quick Ref" }, b || base)), 20000, 21);
  const g = pick(["g1", "g2", "g3"]), s = pick(["s1", "s2", "s3"]);
  {
    const b0 = Object.assign({}, base, { params: ON });
    check("v5 default: named-judge effects off (officials.perJudge false), so the two panels score identically",
      FP.officials.perJudge === false && JSON.stringify(pick(["g1", "g2", "g3"], b0)) === JSON.stringify(pick(["s1", "s2", "s3"], b0)));
  }
  check("grappling-weighting judges give the wrestler more decisions", g.distA > s.distA + 0.03, `wrestler wins ${(100 * g.distA).toFixed(1)}% of decisions vs ${(100 * s.distA).toFixed(1)}%`);
  const w = pick(["w1", "w2", "w3"]), n0 = pick(["g1", "s1", "w1"]);
  check("10-8-prone judges score more 10-8s", w.r108 > 2 * Math.max(1e-4, pick(["s1", "s2", "s3"]).r108), `${(100 * w.r108).toFixed(2)}% vs ${(100 * s.r108).toFixed(2)}% of judge-rounds`);
  const ref = (r) => E.summarize(E.matchup(avgProfile("Welterweight", "A"), avgProfile("Welterweight", "B"), Object.assign({ referee: r, judges: ["g1", "s1", "w1"] }, base)), 20000, 23);
  const q = ref("Quick Ref"), l = ref("Late Ref");
  const st = (x) => x.koKind.TKO_standing + x.koKind.GNP + x.koKind.TKO_followup;
  check("a quick-stopping referee produces more referee stoppages", st(q) > 1.5 * st(l), `${st(q)} vs ${st(l)} of 20000 (standing TKO + GNP + follow-up)`);
  check("referee does not change instant KOs much (not his call)", Math.abs(q.koKind.KO - l.koKind.KO) < 0.25 * Math.max(q.koKind.KO, l.koKind.KO) + 30, `${q.koKind.KO} vs ${l.koKind.KO}`);
  void n0;
}

// shared panel noise: near-even rounds are mostly unanimous (data 2019-2023: 59%; independent judges 25%)
{
  const lg = T.tables["2024"].league; void lg;
  const mU = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: ON }, VG));
  const off = Object.assign({}, mU.off), rng = E.makeRng(99), OF = { sel: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]], r2: E.makeRng(98) };
  let un = 0, N = 40000;
  const rngF = E.makeRng(97);
  for (let i = 0; i < N; i++) {
    const cards = [[0, 0], [0, 0], [0, 0]];
    const uF = off.sigF * rngF.normal();                            // the fight-level part, drawn per fight in simulate()
    E.officialsRound(off, OF, uF, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, rng, cards, null);
    const w = cards.map((c) => Math.sign(c[0] - c[1]));
    if (Math.abs(w[0] + w[1] + w[2]) === 3) un++;
  }
  // expected: E_u[p^3 + (1-p)^3], p = sigmoid(u), u ~ N(0, sigmaU^2)
  let ex = 0, M = 4001;
  for (let i = 0; i < M; i++) { const z = -8 + 16 * i / (M - 1), u = Math.hypot(mU.off.sigF, mU.off.sigR) * z, p = 1 / (1 + Math.exp(-u)), w = Math.exp(-z * z / 2); ex += w * (p ** 3 + (1 - p) ** 3); }
  let wn = 0; for (let i = 0; i < M; i++) { const z = -8 + 16 * i / (M - 1); wn += Math.exp(-z * z / 2); }
  ex /= wn;
  check("shared noise: an even round is unanimous as often as the model says (not 25%)", Math.abs(un / N - ex) < 0.01 && un / N > 0.45, `${(100 * un / N).toFixed(1)}% vs model ${(100 * ex).toFixed(1)}%`);
  const ea = FP.officials.engAdj, sR0 = Math.sqrt((1 - mU.off.rhoF) * mU.off.sigU ** 2);
  check("engine-only terms: their residual variance comes out of the round-level shared noise", ea && mU.off.varR > 0 &&
    Math.abs(mU.off.sigR ** 2 - (sR0 ** 2 - mU.off.varR)) < 1e-9, `round sd ${sR0.toFixed(3)} -> ${mU.off.sigR.toFixed(3)} (residual variance ${mU.off.varR.toFixed(3)})`);
}

// walk-forward table selection and the train-only guard
{
  const tf = E.officialsTableFor;
  check("table for 2021-06-01 is table 2021 (fit on 2016-2020)", tf(T, "2021-06-01") === T.tables["2021"] && T.tables["2021"].league.window[1] === 2020);
  check("no table before the first table year (no later fit leaks backwards)", tf(T, "2018-12-31") === null);
  check("dates after the last table use the production table", tf(T, "2026-11-06") === T.tables["2024"]);
  const ok = Object.keys(T.tables).every((y) => T.tables[y].league.window[1] < +y) && T.meta.max_date <= "2024-01-01";
  check("every table is fit only on years before its own; nothing on/after 2024-01-01", ok, `max_date ${T.meta.max_date}`);
}

// API: opts.judges as { names, power } keeps the judges.power knob
{
  const mP = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: ON }, VG, { judges: { names: ["m94"], power: 0.7 } }));
  check("opts.judges = { names, power } keeps the power knob and the names", mP.judgePower === 0.7 && mP.off.jp === 0.7 && mP.off.slots[0].key === "m94");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
