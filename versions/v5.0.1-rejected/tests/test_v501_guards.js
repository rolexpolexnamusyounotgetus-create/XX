/* v5.0.1 input guards (v5 review): every case that used to hang, leak or silently skew now fails loudly or is handled.
     node tests/test_v501_guards.js
   - NaN / infinite / negative rate inputs (knobs, durability records, embedding predictors, pre-UFC records) never reach simulate:
     matchup throws naming the table, or the bad input is treated as missing; simulate has a rate check and an event cap
   - judges: a non-numeric judge power falls back to the params value; a NaN round score throws instead of going to corner B
   - dates: one canonical 'YYYY-MM-DD'; Date objects and timestamps are converted, unparsable strings throw, and a 2019 bout in
     any accepted form never picks up the live-fit rosters (durability, embedding, pre-UFC)
   - rounds: an integer 1..5 (a string '5' is coerced; 0, 7 and 'abc' throw)
   - params loading: in Node the engine uses its sibling params3.js even when another version's params sit on the global object,
     and it refuses params whose major version differs */
"use strict";
const fs = require("fs"), path = require("path"), cp = require("child_process");
const ROOT = path.join(__dirname, "..");
const J = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const E = require(path.join(ROOT, "src/engine3.js"));
E.loadDB(J("data/derived/fighters.json")); E.loadMLRates(J("data/derived/mlrates.json"));
let pass = 0, fail = 0;
function check(name, ok, info) { if (ok) pass++; else fail++; console.log((ok ? "PASS  " : "FAIL  ") + name + (info ? "  (" + info + ")" : "")); }
function throws(fn, re) { try { fn(); return false; } catch (e) { return re ? re.test(String(e.message)) : true; } }
const A = "alexander-volkanovski", B = "justin-gaethje", BASE = { division: "Lightweight", rounds: 5, title: true };
const mk = (o) => E.matchup(A, B, Object.assign({}, BASE, o || {}));

// ---- rates
check("NaN strikeScale: matchup throws naming dRate", throws(() => mk({ params: { strikeScale: NaN } }), /dRate/));
check("Infinity kdScale: matchup throws naming kd", throws(() => mk({ params: { kdScale: Infinity } }), /table kd/));
check("negative tdScale: matchup throws (a table it poisons is named)", throws(() => mk({ params: { tdScale: -1 } }), /matchup table \w+/));
{
  const m = mk({ dur: { A: { chin_re: "1.2", pow_re: "x", chin_cov: 1, pow_cov: 1 }, B: {} } });
  check("durability record with a string field: finite hazards, side labelled partial / computed", isFinite(m.kd[0]) && isFinite(m.kd[1]) && m.dur.A.src === "partial" && m.dur.B.src === "computed", m.dur.A.src + "/" + m.dur.B.src);
  const t0 = Date.now(); let ok = true;
  for (let s = 1; s <= 200; s++) { const f = E.simulate(m, E.makeRng(s), false); if (!(f.t >= 0 && f.t <= 300)) ok = false; }
  check("... and 200 fights finish with finite clocks (was an infinite loop)", ok && Date.now() - t0 < 20000, (Date.now() - t0) + " ms");
}
{
  const n = (E.params().embed.tasks || []).length;
  const m = mk({ embed: { etaA: new Array(n).fill(NaN), etaB: new Array(n).fill(0) } });
  check("NaN embedding predictors: targets stay unblended, tables finite", m.dRate.every(isFinite) && m.kd.every(isFinite));
  let legNaN = 0; for (let s = 1; s <= 100; s++) { const f = E.simulate(m, E.makeRng(s), false); if (f.method === "LEG" && !(f.t >= 0)) legNaN++; }
  check("... no fight ends at t = NaN", legNaN === 0);
}
{
  const m = mk({ preufc: { A: { n: -5, ko_w: -3, sub_w: 0, ko_l: 0, n_ufc: 0 }, B: null } });
  check("negative pre-UFC counts: record treated as missing", m.preufc.mult[0] === null && isFinite(m.kd[0]));
}
{
  const m = mk();
  m.dRate = [NaN, NaN];   // a table broken after matchup: simulate's backstop
  check("simulate refuses a NaN total rate", throws(() => E.simulate(m, E.makeRng(1), false), /total event rate/));
}
// ---- judges
{
  const m = mk({ judges: { power: "abc" } });
  check("judge power 'abc' falls back to params.judge.power", m.judgePower === E.params().judge.power, String(m.judgePower));
  let a = 0, b = 0; for (let s = 1; s <= 300; s++) { const f = E.simulate(m, E.makeRng(s), false); if (f.winner === "A") a++; else if (f.winner === "B") b++; }
  check("... and no longer hands the fight to corner B", a > b, a + " A / " + b + " B");
  const cards = [[0, 0], [0, 0], [0, 0]], J0 = E.params().judge, one = [1, 1, 1];
  check("judgeRound throws on a NaN score", throws(() => E.judgeRound(J0, NaN, 10, 0, 0, 0, 0, 0, 0, 0, 1, one, one, one, 0, E.makeRng(1), cards, null), /not finite/));
}
// ---- dates
{
  const P = (d) => E.matchup(A, B, Object.assign({}, BASE, { date: d })).date;
  check("Date object -> ISO", P(new Date("2019-06-15T00:00:00Z")) === "2019-06-15");
  check("timestamp -> ISO", P(Date.parse("2019-06-15")) === "2019-06-15");
  check("'2019/06/15' -> ISO", P("2019/06/15") === "2019-06-15");
  check("ISO with a time part -> date", P("2019-06-15T20:00:00Z") === "2019-06-15");
  check("US-style '6/15/2019' throws", throws(() => P("6/15/2019"), /YYYY-MM-DD/));
  check("'2019-02-30' throws", throws(() => P("2019-02-30"), /YYYY-MM-DD/));
  E.loadDurability(J("data/derived/durability.json")); E.loadPreUFC(J("data/derived/preufc.json")); E.loadEmbed(J("data/derived/embed_model.json"));
  for (const d of ["2019-06-15", new Date("2019-06-15T00:00:00Z"), Date.parse("2019-06-15"), "2019/06/15"]) {
    const m = E.matchup(A, B, Object.assign({}, BASE, { date: d }));
    check("2019 bout (" + (d instanceof Date ? "Date" : typeof d === "number" ? "timestamp" : d) + ") never picks up a live-fit roster",
      m.dur.A.src === "computed" && m.dur.B.src === "computed" && (!m.embed || m.embed.src == null) && (!m.preufc || (m.preufc.src[0] == null && m.preufc.src[1] == null)),
      JSON.stringify([m.dur.A.src, m.dur.B.src, m.embed && m.embed.src]));
  }
  const m26 = E.matchup(A, B, Object.assign({}, BASE, { date: "2026-11-14" }));
  check("a current bout does use the rosters", m26.dur.A.src === "record" && m26.embed && m26.embed.src === "roster");
  check("officialsTableFor takes a Date", E.officialsTableFor({ tables: { "2019": { a: 1 }, "2023": { b: 2 } } }, new Date("2020-03-01T00:00:00Z")).a === 1);
  E.loadDurability(null); E.loadPreUFC(null); E.loadEmbed(null);
}
// ---- rounds
check("rounds '5' -> number 5", mk({ rounds: "5" }).rounds === 5);
check("rounds undefined + title -> 5, without -> 3", E.matchup(A, B, { division: "Lightweight", title: true }).rounds === 5 && E.matchup(A, B, { division: "Lightweight" }).rounds === 3);
check("rounds 0 / 7 / 'abc' throw", throws(() => mk({ rounds: 0 })) && throws(() => mk({ rounds: 7 })) && throws(() => mk({ rounds: "abc" })));
// ---- params loading (child processes: a clean require cache each)
{
  const v4p = path.join(ROOT, "versions/v4/params3.js"), src = path.join(ROOT, "src");
  const code = "global.FightParams = require(" + JSON.stringify(v4p) + "); const E = require(" + JSON.stringify(path.join(src, "engine3.js")) +
    "); console.log(E.params().version + '|' + JSON.stringify(Object.keys(E.params().components || {}).length))";
  const out = cp.execFileSync(process.execPath, ["-e", code], { encoding: "utf8" }).trim();
  check("global FightParams of v4 loaded first: the engine still uses its sibling params3.js", out.split("|")[0] === E.params().version && +out.split("|")[1] > 0, out);
  check("params with another major version are refused", throws(() => { const p = E.params(), v = p.version; p.version = "4.0.0-x"; try { mk(); } finally { p.version = v; } }, /major version/));
}
console.log(pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
