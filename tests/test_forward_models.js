// Node test for forward model v4.1 (data/predictions/README.md): the per-bout "models" block of tools/forward_ledger.js.
//   node tests/test_forward_models.js            (about 10 s; runs the evaluator twice on a synthetic card)
// 1. The ML v2 page stacks with weights fit 2019-2023 (data/derived/forward_models.json, tools/forward_models.py export)
//    evaluated by src/ml/ml2.js reproduce the Python vectors to 1e-12, and swapping the corners gives 1 - p.
// 2. whr_rounds and the ratings stack from ratings.json's roster reproduce ratings.json's own matchup row
//    (tools/ratings.py matchup_probs, which rounds members to 4 decimals before stacking).
// 3. Corner symmetry of every model: each bout is evaluated as (a, b) and as (b, a) with the lines flipped, and every
//    model must give P(a | a, b) = 1 - P(b | b, a) (engine included: its seeds follow the unordered pair).
// 4. Debutant seeding: a debutants_*.json entry (shift given, or computed from pre-UFC features with preufc.json's live
//    betas) and preufc.json roster_priors replace the 1500 rating; with no seed the rating stays 1500.
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const cp = require("child_process");
const ROOT = path.join(__dirname, "..");
const ML2 = require(path.join(ROOT, "src/ml/ml2.js"));
const rd = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
let fails = 0;
const check = (ok, msg) => { if (!ok) { fails++; console.error("FAIL: " + msg); } };

// ---------------------------------------------------------------- 1. fit-2019-2023 ML v2 stacks vs Python
const FM = rd("data/derived/forward_models.json");
const ML2J = rd("data/derived/ml2.json");
const H = ML2.load(Object.assign({}, ML2J.page_model, { stack: FM.ml2_static }));
for (const reg of ["line", "open", "noline"]) {
  const s = FM.ml2_static[reg];
  check(/^2019-01-01\.\.2023-12-31 only/.test(s.fit), reg + ": fit window is not 2019-2023");
  s.weights.forEach((w, i) => check(Math.round(w * 1e4) / 1e4 === s.weights_published_4dp[i], reg + ": weight " + i + " != published"));
  check(s.repro.max_abs_diff_vs_cached_static_2024_2025 <= 1e-12, reg + ": export did not reproduce the cached fit");
}
const swapFight = (f) => { const g = Object.assign({}, f); if (f.fw) g.fw = { A: f.fw.B, B: f.fw.A }; return g; };
let d1 = 0, s1 = 0;
for (const v of FM.test_vectors) {
  const q = H.predict(v.a, v.b, v.fight, v.p_line, v.p_open);
  const w = H.predict(v.b, v.a, swapFight(v.fight), 1 - v.p_line, 1 - v.p_open);
  d1 = Math.max(d1, Math.abs(q.pA - v.pA), Math.abs(q.pStack - v.p_stack_noline), Math.abs(q.pStackLine - v.p_stack_line),
    Math.abs(q.pStackOpen - v.p_stack_open));
  s1 = Math.max(s1, Math.abs(q.pStack + w.pStack - 1), Math.abs(q.pStackLine + w.pStackLine - 1), Math.abs(q.pStackOpen + w.pStackOpen - 1));
}
check(d1 <= 1e-12, "static ML v2 stacks: max |js - py| " + d1);
check(s1 <= 1e-12, "static ML v2 stacks: corner swap " + s1);
console.log("1. ML v2 fit-2019-2023 stacks: %d vectors, max |p_js - p_py| %s, max |p(a,b) + p(b,a) - 1| %s",
  FM.test_vectors.length, d1.toExponential(2), s1.toExponential(2));

// ---------------------------------------------------------------- evaluator runs (shared by 2-4)
const FJ = rd("data/derived/fighters.json").fighters;
const PU = rd("data/derived/preufc.json");
const nonRoster = Object.keys(PU.roster_priors).find((k) => !FJ[k] && PU.roster_priors[k].elo_debut_shift != null);
const cards = rd("data/predictions/cards_upcoming.json");
const pairs = [];
for (const e of cards.events) for (const b of e.bouts) if (b.a.slug && b.b.slug && FJ[b.a.slug] && FJ[b.b.slug])
  pairs.push({ a: b.a.slug, b: b.b.slug, division: b.weight_class, rounds: b.rounds || 3, title: !!b.title });
const pick = pairs.slice(0, 7);
pick.push({ a: "alexander-volkanovski", b: "justin-gaethje", division: "Lightweight", rounds: 5, title: false });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fwd-models-"));
const SEED = { name: "Test Seeded", elo_debut_shift: 60 };
const SEEDF = { name: "Test Features", pre: { pre_netelo: 1.0084 + 0.3594, pre_logn: 2.4222 - 0.4751, pre_feed: 2.4836 + 1.2104 } };  // +1 / -1 / +1 sd
// the card desk's preufc.json-shaped entries (data/predictions/debutants_vegas124.json): values nested under "derived";
// an "also_upcoming" block is a fallback that never overrides a "fighters" entry
const SEEDN = { name: "Test Nested", derived: { seeded_elo: { elo_debut_shift: 45 }, side_pre: { pre_netelo: 9 } } };
const SEEDNP = { name: "Test Nested Pre", derived: { side_pre: { pre_netelo: 1.0084 + 0.3594 }, age_at_ufc_debut: 28.3939 + 3.4675 } };
fs.writeFileSync(path.join(tmp, "debutants_test.json"), JSON.stringify({
  fighters: { "test-seeded": SEED, "test-features": SEEDF, "test-nested": SEEDN, "test-nested-pre": SEEDNP },
  also_upcoming: { "test-seeded": { name: "Test Seeded", elo_debut_shift: 999 }, "test-upcoming": { name: "Test Upcoming",
    derived: { seeded_elo: { elo_debut_shift: 25 } } } } }));
fs.writeFileSync(path.join(tmp, "debutants_a_test.json"), JSON.stringify({ also_upcoming: { "test-nested": { elo_debut_shift: -999 } } }));
const debuts = [
  { a: pick[0].a, b: null, key_b: "test-seeded", name_b: "Test Seeded" },
  { a: null, b: pick[1].b, key_a: "test-features", name_a: "Test Features" },
  { a: pick[2].a, b: null, key_b: nonRoster, name_b: nonRoster },
  { a: null, b: null, key_a: "nobody-one", name_a: "Nobody One", key_b: "test-seeded", name_b: "Test Seeded" },
  { a: pick[3].a, b: null, key_b: "nobody-two", name_b: "Nobody Two" },
  { a: pick[4].a, b: null, key_b: "test-nested", name_b: "Test Nested" },
  { a: null, b: pick[5].b, key_a: "test-nested-pre", name_a: "Test Nested Pre" },
  { a: pick[6].a, b: null, key_b: "test-upcoming", name_b: "Test Upcoming" }];
const lines = [0.31, 0.47, 0.55, 0.62, 0.68, 0.73, 0.8, 0.37, 0.58, 0.44, 0.52, 0.66, 0.29];
const fwd = [], rev = [];
const all = pick.map((p) => Object.assign({ division: p.division, rounds: p.rounds, title: p.title }, p))
  .concat(debuts.map((p) => Object.assign({ division: "Lightweight", rounds: 3, title: false }, p)));
all.forEach((p, i) => {
  const ka = p.key_a || p.a, kb = p.key_b || p.b, L = lines[i % lines.length], Lo = L - 0.012, N = L + 0.004;
  const base = { division: p.division, rounds: p.rounds, title: p.title };
  fwd.push(Object.assign({ bout_id: "t:" + ka + "__" + kb, a: p.a, b: p.b, key_a: ka, key_b: kb, name_a: p.name_a || ka,
    name_b: p.name_b || kb, p_line: L, p_open_in: Lo, p_novig: N }, base));
  rev.push(Object.assign({ bout_id: "t:" + kb + "__" + ka, a: p.b, b: p.a, key_a: kb, key_b: ka, name_a: p.name_b || kb,
    name_b: p.name_a || ka, p_line: 1 - L, p_open_in: 1 - Lo, p_novig: 1 - N }, base));
});
const run = (bouts) => {
  const f = path.join(tmp, "in_" + Math.random().toString(36).slice(2) + ".json");
  fs.writeFileSync(f, JSON.stringify({ date: "2026-12-12", sims: 30, bouts }));
  const o = cp.execFileSync("node", [path.join(ROOT, "tools/forward_ledger.js"), f, "--moe", "data/derived/blindtest_stack.json",
    "--pred-dir", tmp, "--raw"], { cwd: ROOT, maxBuffer: 1 << 28 });
  return JSON.parse(o.toString());
};
const A = run(fwd), B = run(rev);

// ---------------------------------------------------------------- 2. ratings vs ratings.json matchups
const RT = rd("data/derived/ratings.json");
const mrow = RT.matchups["alexander-volkanovski__justin-gaethje"];
const vg = A.bouts[pick.length - 1].models;
const dW = Math.abs(vg.whr_rounds - mrow.whr_rounds), dS = Math.abs(vg.ratings_stack - mrow.stack);
check(dW <= 5.1e-5, "whr_rounds " + vg.whr_rounds + " vs ratings.json " + mrow.whr_rounds);
check(dS <= 2e-4, "ratings_stack " + vg.ratings_stack + " vs ratings.json " + mrow.stack);
console.log("2. ratings (Volkanovski vs Gaethje): whr_rounds %s vs %s, ratings_stack %s vs %s",
  vg.whr_rounds.toFixed(5), mrow.whr_rounds, vg.ratings_stack.toFixed(5), mrow.stack);

// ---------------------------------------------------------------- 3. corner symmetry of every model
const keys = A.meta.model_keys;
let smax = 0, nchk = 0;
const nonNull = {};
A.bouts.forEach((x, i) => {
  const y = B.bouts[i];
  for (const k of keys) {
    const p = x.models[k], q = y.models[k];
    check((p == null) === (q == null), "bout " + x.bout_id + " model " + k + ": null on one side only");
    if (p == null || q == null) continue;
    smax = Math.max(smax, Math.abs(p + q - 1)); nchk++;
    nonNull[k] = (nonNull[k] || 0) + 1;
    check(Math.abs(p + q - 1) <= 1e-9, "bout " + x.bout_id + " model " + k + ": " + p + " + " + q + " != 1");
  }
});
for (const k of keys) check(nonNull[k] >= (k === "elo" || k === "market_novig" ? all.length : pick.length),
  "model " + k + " ran on " + (nonNull[k] || 0) + " bouts only");
console.log("3. corner symmetry: %d model evaluations on %d bouts (%d models), max |p(a,b) + p(b,a) - 1| %s",
  nchk, all.length, keys.length, smax.toExponential(2));

// ---------------------------------------------------------------- 4. debutant seeding
const SL = PU.eval.models[Object.keys(PU.eval.models).find((k) => /^seeded_elo_live/.test(k))];
let shiftF = 0;
SL.keys.forEach((k, i) => { const v = SEEDF.pre[k]; if (v != null) shiftF += SL.beta_elo_points_per_sd[i] * (v - SL.mu[i]) / SL.sd[i]; });
const off = pick.length;
const sd = A.bouts.slice(off).map((x) => x.elo_seed);
check(sd[0].b.rating === 1560 && /debutants_test\.json/.test(sd[0].b.source), "debutants file shift: " + JSON.stringify(sd[0].b));
check(Math.abs(sd[1].a.rating - (1500 + shiftF)) < 1e-9 && /betas on 3\//.test(sd[1].a.source), "debutants file features: " + JSON.stringify(sd[1].a));
check(Math.abs(shiftF - (48.23 + 33.83 + 19.26)) < 0.01, "seed betas changed: +1 sd net Elo, -1 sd log fights, +1 sd feeder = " + shiftF);
check(Math.abs(sd[2].b.rating - (1500 + PU.roster_priors[nonRoster].elo_debut_shift)) < 1e-9 && /roster_priors/.test(sd[2].b.source),
  "preufc roster_priors seed: " + JSON.stringify(sd[2].b));
check(sd[3].a.rating === 1500 && sd[3].b.rating === 1560, "two debutants: " + JSON.stringify(sd[3]));
check(sd[4].b.rating === 1500 && /no pre-UFC seed/.test(sd[4].b.source), "unseeded debutant: " + JSON.stringify(sd[4].b));
check(sd[5].b.rating === 1545 && /derived\.seeded_elo/.test(sd[5].b.source), "nested derived.seeded_elo shift: " + JSON.stringify(sd[5].b));
const shiftNP = 48.23 - 32.48;                                  // +1 sd net Elo, +1 sd age at UFC debut
check(Math.abs(sd[6].a.rating - (1500 + shiftNP)) < 0.01 && /betas on 2\//.test(sd[6].a.source),
  "nested derived.side_pre + age_at_ufc_debut: " + JSON.stringify(sd[6].a));
check(sd[7].b.rating === 1525 && /also_upcoming/.test(sd[7].b.source), "also_upcoming fallback: " + JSON.stringify(sd[7].b));
const eA = FJ[pick[0].a].elo;
check(Math.abs(A.bouts[off].models.elo - 1 / (1 + Math.pow(10, (1560 - eA) / 400))) < 1e-12, "seeded Elo probability");
for (const x of A.bouts.slice(off)) for (const k of keys) if (k !== "elo" && k !== "market_novig") check(x.models[k] == null, "debut bout ran " + k);
console.log("4. debutant seeding: file shift 1560, features %s (shift %s), preufc %s (%s), none 1500",
  sd[1].a.rating.toFixed(2), shiftF.toFixed(2), sd[2].b.rating.toFixed(1), nonRoster);

fs.rmSync(tmp, { recursive: true, force: true });
if (fails) { console.error("FAIL (%d)", fails); process.exit(1); }
console.log("PASS");
