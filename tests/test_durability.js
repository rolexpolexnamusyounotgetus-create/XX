#!/usr/bin/env node
/* Durability component (params.components.durability, engine v5) checks.
   1. Flag off = the engine before the component, bit for bit: matchup tables, traced fights and Monte Carlo summaries
      for plain, learned-rate (v4) and manual matchups equal those of the pre-component engine source. That source is
      DUR_BASE_FILE (a path), else DUR_BASE_REV (git), else the frozen versions/v<VERSION>/ (or v<major>/) folder of the
      engine version in src/ (the main checkout), else git 275b339 (the builder's base sync); without any of them the
      cases are compared against the golden hashes in tests/fixtures/durability_off_golden.json
      (node tests/test_durability.js --write-golden refreshes them from the base found).
   2. Covariates reproduce durability.json roster chin_cov / pow_cov for every fighter (live coefficients).
   3. Knockdown probabilities reproduce research/model_durability.md section 8 (Volkanovski-Gaethje, 730-day level).
   4. Structure: corner swap, age, KO-loss recency, knobs, size knob default 0, engineWeight limits, record precedence,
      trace format unchanged, withdrawn terms neutral by default.
   node tests/test_durability.js        (about 20 seconds) */
"use strict";
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");
const ROOT = path.resolve(__dirname, "..");
const E = require(path.join(ROOT, "src", "engine3.js"));
const FP = require(path.join(ROOT, "src", "params3.js"));

let fails = 0, checks = 0;
function ok(cond, msg, info) { checks++; if (!cond) fails++; console.log((cond ? "PASS  " : "FAIL  ") + msg + (info ? "  (" + info + ")" : "")); }
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const dbJson = fs.readFileSync(path.join(ROOT, "data", "derived", "fighters.json"), "utf8");
const DUR = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "durability.json"), "utf8"));
const MLJ = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlrates.json"), "utf8"));
const OOF = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlrates_oof.json"), "utf8"));
const PRI = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlcal_priors_asof.json"), "utf8"));
E.loadDB(dbJson);
const OFF = { components: { durability: false } };
const GOLDEN = path.join(ROOT, "tests", "fixtures", "durability_off_golden.json");
const BASE_REV = process.env.DUR_BASE_REV || "275b339";

// ---------------------------------------------------------------- the cases (all flag-off comparisons use these)
const T = OOF.meta.targets;
const oofId = "2cc1fe3570999428";                       // 2019-01-19 (train window), Belal Muhammad vs Geoff Neal
const oofObj = (arr) => { const o = {}; T.forEach((t, i) => { o[t] = arr[i]; }); return o; };
function cases(Eng) {
  const out = [];
  Eng.loadDB(dbJson);
  const vg = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06" };
  out.push(["plain VG 5rd title", () => Eng.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: false }, vg))]);
  out.push(["plain GV 3rd", () => Eng.matchup("justin-gaethje", "alexander-volkanovski", { division: "Lightweight", rounds: 3, date: "2026-11-06", ml: false })]);
  out.push(["plain knobs", () => Eng.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ ml: false, adjA: { chin: 1.2, pow: 0.9, out: 1.05 }, adjB: { chin: 0.9, pow: 1.1, leg: 0.2 } }, vg))]);
  out.push(["oof pred 2019", () => {
    const o = OOF.fights[oofId];
    const bt = { A: { slug: "belal-muhammad", age: 30.5, ko_losses: 1, kd_absorbed: 4, division: "Welterweight", S: null }, B: null };
    const pa = Eng.profile("belal-muhammad"), pb = Eng.profile("geoff-neal");
    return Eng.matchup(pa, pb, { division: "Welterweight", rounds: 3, date: "2019-01-19", priors: PRI["2019"], ml: { A: oofObj(o.A), B: oofObj(o.B) } });
  }]);
  out.push(["ml model VG", () => { Eng.loadMLRates(MLJ); const m = Eng.matchup("alexander-volkanovski", "justin-gaethje", vg); Eng.loadMLRates(null); return m; }]);
  out.push(["manual", () => {
    const a = Eng.manualProfile({ name: "M1", slpm: 5.2, sapm: 3.1, acc: 0.5, def: 0.6, td15: 1.5, kd15: 0.6, age: 33, ko_losses: 2 }, { division: "Featherweight" });
    const b = Eng.manualProfile({ name: "M2", slpm: 4.0, sapm: 4.4, acc: 0.44, def: 0.52, td15: 0.4, kd15: 0.2, age: 28 }, { division: "Featherweight" });
    return Eng.matchup(a, b, { division: "Featherweight", rounds: 3, ml: false });
  }]);
  return out;
}
function digest(Eng, m, params) {
  const strip = (k, v) => (typeof v === "function" ? undefined : (v instanceof Float64Array ? Array.from(v) : v));
  const tables = JSON.stringify({ kd: m.kd, dw: m.dw, gnp: m.gnp, stko: m.stko, dRate: m.dRate, cRate: m.cRate, gRate: m.gRate, accO: Array.from(m.accO),
    tdO: m.tdO, occ: m.occ, finR: m.finR, instO: m.instO, refO: m.refO, ml: m.ml || null, fac: m.fac, k: m.k }, strip);
  const traces = [];
  for (let s = 1; s <= 12; s++) traces.push(JSON.stringify(Eng.simulate(m, Eng.makeRng(1000 + s), true)));
  const sum = JSON.stringify(Eng.summarize(m, 1500, 77));
  return { tables: crypto.createHash("sha256").update(tables).digest("hex"), traces: crypto.createHash("sha256").update(traces.join("|")).digest("hex"),
    summary: crypto.createHash("sha256").update(sum).digest("hex"), kd: m.kd.slice() };
}
function runCases(Eng, offViaOpts) {
  const res = {};
  for (const [name, mk] of cases(Eng)) {
    const m = mk();
    res[name] = digest(Eng, m);
  }
  return res;
}
function loadEngineSource(src) {
  const mod = { exports: {} };
  const req = (p) => require(p.startsWith(".") ? path.join(ROOT, "src", p) : p);
  new Function("module", "exports", "require", src)(mod, mod.exports, req);
  return mod.exports;
}
// The pre-component engine, first found wins: DUR_BASE_FILE (a path to an engine3.js); DUR_BASE_REV (a git revision,
// when set); the frozen folder of the engine version src/ carries (versions/v<VERSION>/, or versions/v<major>/ for
// X.0.0: the component does not bump VERSION, so in the main checkout that is the engine it was applied to); the
// builder's base-sync commit 275b339 from git; else the golden fixture. The base source runs with the current
// src/params3.js and src/ml/mlrates.js, flag off.
let BASE_NAME = "";
function baseEngine() {
  const fromGit = (rev) => {
    try {
      const src = execFileSync("git", ["-C", ROOT, "show", rev + ":src/engine3.js"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 1 << 26 });
      BASE_NAME = "git " + rev; return loadEngineSource(src);
    } catch (e) { return null; }
  };
  if (process.env.DUR_BASE_FILE) { BASE_NAME = "file " + process.env.DUR_BASE_FILE; return loadEngineSource(fs.readFileSync(process.env.DUR_BASE_FILE, "utf8")); }
  if (process.env.DUR_BASE_REV) return fromGit(BASE_REV);
  const v = String(E.VERSION || ""), dirs = ["v" + v];
  if (/^\d+\.0\.0$/.test(v)) dirs.push("v" + v.split(".")[0]);
  for (const d of dirs) {
    const f = path.join(ROOT, "versions", d, "engine3.js");
    if (fs.existsSync(f)) { BASE_NAME = "versions/" + d; return loadEngineSource(fs.readFileSync(f, "utf8")); }
  }
  return fromGit(BASE_REV);
}

// ---------------------------------------------------------------- 1. flag off = pre-component engine
console.log("=== 1. flag off equals the engine before the component ===");
const saved = FP.components.durability;
FP.components.durability = false;                       // global flag off for this block
const offRes = runCases(E);
FP.components.durability = saved;
const Base = baseEngine();
if (process.argv.includes("--write-golden")) {
  if (!Base) { console.log("cannot read a pre-component engine (DUR_BASE_FILE, DUR_BASE_REV, versions/v4.0.1, git " + BASE_REV + ")"); process.exit(1); }
  fs.writeFileSync(GOLDEN, JSON.stringify({ base_rev: BASE_NAME, params_version: FP.version, note: "flag-off digests of tests/test_durability.js cases computed with the pre-component engine (" + BASE_NAME + ") and the current params3.js", cases: runCases(Base) }, null, 1));
  console.log("wrote " + GOLDEN);
}
let ref = null, refName = "";
if (Base) { ref = runCases(Base); refName = BASE_NAME; }
else if (fs.existsSync(GOLDEN)) { ref = JSON.parse(fs.readFileSync(GOLDEN, "utf8")).cases; refName = "golden fixture"; }
if (!ref) ok(false, "no reference for the pre-component engine (git or golden fixture)");
else for (const name in offRes) {
  const a = offRes[name], b = ref[name];
  ok(b && a.tables === b.tables && a.traces === b.traces && a.summary === b.summary, "flag off == " + refName + ": " + name);
}
// the per-call override (opts.params.components.durability = false) is the same path
{
  const vg = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06", ml: false };
  const m1 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: OFF }, vg));
  FP.components.durability = false;
  const m2 = E.matchup("alexander-volkanovski", "justin-gaethje", vg);
  FP.components.durability = saved;
  const d1 = digest(E, m1), d2 = digest(E, m2);
  ok(d1.tables === d2.tables && d1.traces === d2.traces && d1.summary === d2.summary && m1.dur === undefined, "opts.params.components.durability=false == global flag off");
  const m3 = E.matchup("alexander-volkanovski", "justin-gaethje", vg);
  ok(m3.dur && m3.kd[0] !== m1.kd[0], "flag on changes the knockdown tables", "kd " + m1.kd.map((x) => x.toFixed(5)) + " -> " + m3.kd.map((x) => x.toFixed(5)));
}

// ---------------------------------------------------------------- 2. covariates vs durability.json roster
console.log("\n=== 2. covariates reproduce the roster (live coefficients) ===");
{
  let n = 0, maxC = 0, maxP = 0, worst = "";
  for (const slug in DUR.roster) {
    const r = DUR.roster[slug];
    const prof = { ko_losses: (r.ko_losses_recent || 0) + (r.ko_losses_old || 0), ko_losses_365: r.ko_losses_recent || 0,
      kd_absorbed: r.kd_absorbed || 0, kd_absorbed_365: r.kd_absorbed_recent || 0 };
    const c = E.durabilityCovariates(prof, r.age);
    const dc = Math.abs(Math.log(c.chin / r.chin_cov)), dp = Math.abs(Math.log(c.pow / r.pow_cov));
    if (dc > maxC) { maxC = dc; worst = slug; }
    maxP = Math.max(maxP, dp); n++;
  }
  ok(n > 1000 && maxC < 2e-3 && maxP < 2e-3, "chin_cov and pow_cov match the roster for " + n + " fighters", "max |log ratio| chin " + maxC.toExponential(2) + " (" + worst + "), power " + maxP.toExponential(2));
}

// ---------------------------------------------------------------- 3. research section 8 numbers
console.log("\n=== 3. Volkanovski-Gaethje knockdown probabilities (research section 8) ===");
E.loadDurability(DUR);
{
  const o = { division: "Lightweight", rounds: 5, title: false, date: "2026-10-31", ml: false, params: { durability: { engineWeight: 0, kdCal: 1 / FP.kdScale } } };   // the data model's own hazard
  const m = E.matchup("alexander-volkanovski", "justin-gaethje", o);
  ok(near(100 * m.kd[0], 0.59, 0.01) && near(100 * m.kd[1], 1.04, 0.015), "pure durability, 730-day level: Volk drops Gaethje 0.59 / 100, Gaethje drops Volk 1.04 / 100",
    (100 * m.kd[0]).toFixed(3) + " / " + (100 * m.kd[1]).toFixed(3));
  ok(m.dur.A.src === "record" && near(m.dur.A.chin, 1.07, 0.01) && near(m.dur.B.chin, 0.80, 0.01) && near(m.dur.A.pow, 0.74, 0.01) && near(m.dur.B.pow, 0.98, 0.01),
    "roster totals: Volk chin 1.07 power 0.74, Gaethje chin 0.80 power 0.98", JSON.stringify([m.dur.A.chin, m.dur.A.pow, m.dur.B.chin, m.dur.B.pow].map((x) => +x.toFixed(3))));
  const m365 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, o, { params: { durability: { engineWeight: 0, kdCal: 1 / FP.kdScale, level: 0.011706 } } }));
  ok(near(100 * m365.kd[0], 0.67, 0.01) && near(100 * m365.kd[1], 1.19, 0.015), "365-day level scenario: 0.67 / 1.19 per 100", (100 * m365.kd[0]).toFixed(3) + " / " + (100 * m365.kd[1]).toFixed(3));
  const mt = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, o, { title: true }));
  ok(near(mt.kd[0] / m.kd[0], Math.exp(-0.09636), 1e-9), "title fight x0.908");
}

// ---------------------------------------------------------------- 4. structure
console.log("\n=== 4. structure ===");
{
  const vg = { division: "Lightweight", rounds: 5, title: false, date: "2026-11-06", ml: false };
  const ab = E.matchup("alexander-volkanovski", "justin-gaethje", vg), ba = E.matchup("justin-gaethje", "alexander-volkanovski", vg);
  ok(near(ab.kd[0], ba.kd[1], 1e-15) && near(ab.kd[1], ba.kd[0], 1e-15) && near(ab.gnp[0], ba.gnp[1], 1e-15) && near(ab.dw[1], ba.dw[0], 1e-15), "corner swap swaps kd, gnp and damage exactly");
  const base = { name: "X", division: "Lightweight", S: null, ko_losses: 0, kd_absorbed: 0 };
  const mk = (a, b, extra) => E.matchup(Object.assign({}, base, a), Object.assign({}, base, b), Object.assign({ division: "Lightweight", rounds: 3, ml: false, params: { durability: { engineWeight: 0, fallbackEB: false } } }, extra || {}));
  const y30 = mk({ age: 30 }, { age: 30 }), o38 = mk({ age: 30 }, { age: 38 });
  ok(near(o38.kd[0] / y30.kd[0], Math.exp(8 * 0.06177 - 8 * 0.0016), 1e-9), "defender 30 -> 38: chin x" + Math.exp(8 * 0.06177 - 8 * 0.0016).toFixed(3));
  ok(near(o38.kd[1] / y30.kd[1], Math.exp(-8 * 0.00445 - 8 * 0.03589), 1e-9), "attacker 30 -> 38: power x" + Math.exp(-8 * 0.00445 - 8 * 0.03589).toFixed(3));
  const kr = mk({ age: 30 }, { age: 30, ko_losses: 1, ko_losses_365: 1 }), ko = mk({ age: 30 }, { age: 30, ko_losses: 1 });
  ok(near(kr.kd[0] / y30.kd[0], Math.exp(0.18908), 1e-9) && near(ko.kd[0] / y30.kd[0], Math.exp(0.0749), 1e-9), "KO loss in the last year x1.21, older x1.08 (no cap)");
  const k3 = mk({ age: 30 }, { age: 30, ko_losses: 4 });
  ok(near(k3.kd[0] / y30.kd[0], Math.exp(4 * 0.0749), 1e-9), "four older KO losses x" + Math.exp(4 * 0.0749).toFixed(3) + " (v3 capped at 1.15)");
  const kn = mk({ age: 30 }, { age: 30 }, { adjA: { pow: 1.3 }, adjB: { chin: 1.2 } });
  ok(near(kn.kd[0] / y30.kd[0], 1.3 * 1.2, 1e-9), "power and chin knobs multiply the hazard");
  const up = mk({ age: 30, division: "Featherweight" }, { age: 30, division: "Featherweight" });
  ok(near(up.kd[0], y30.kd[0], 1e-15) && near(up.kd[1], y30.kd[1], 1e-15), "no size tax by default (both moved up from featherweight)");
  const upT = mk({ age: 30 }, { age: 30, division: "Featherweight" }, { params: { durability: { engineWeight: 0, fallbackEB: false, sizeChin: 0.05 } } });
  ok(upT.kd[0] > y30.kd[0] * 1.03, "sizeChin knob raises the moved-up defender's hazard", (upT.kd[0] / y30.kd[0]).toFixed(4));
  const na = mk({ age: 30 }, { age: null });
  ok(near(na.kd[0] / y30.kd[0], Math.exp(0.79895), 1e-9), "age unknown x2.22");
  // engineWeight limits
  const p0 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: OFF }, vg));
  const w1 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { durability: { engineWeight: 1 } } }, vg));
  ok(near(w1.kd[0] / w1.dur.base / w1.dur.kdCal / FP.kdScale, p0.kd[0] / w1.dur.engLevel, 1e-12) && near(w1.gnp[1], p0.gnp[1], 1e-12) && near(w1.dw[0], p0.dw[0], 1e-12),
    "engineWeight 1: the engine's own structure at the durability level (gnp and damage unchanged)");
  const wh = E.matchup("alexander-volkanovski", "justin-gaethje", vg), w0 = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { durability: { engineWeight: 0 } } }, vg));
  ok(near(Math.log(wh.dur.relK[0]), 0.5 * Math.log(w0.dur.relK[0]) + 0.5 * Math.log(w1.dur.relK[0]), 1e-12), "engineWeight 0.5 is the geometric mean of 0 and 1");
  // relative mode
  const rel = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: { durability: { level: null, engineWeight: 0 } } }, vg));
  ok(rel.dur.mode === "relative" && near(rel.dur.base, rel.dur.engLevel * rel.dur.ctx, 1e-15), "level null: relative mode on the engine's division level");
  // record precedence: opts.dur beats the roster
  const rec = { A: { chin_re: 1, chin_cov: 1, pow_re: 2, pow_cov: 1 }, B: { chin_re: 1.5, chin_cov: 1, pow_re: 1, pow_cov: 1 }, base: 0.01 };
  const mr = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ dur: rec, params: { durability: { engineWeight: 0, kdCal: 1 / FP.kdScale } } }, vg));
  ok(near(mr.kd[0], 0.01 * 2 * 1.5, 1e-12) && near(mr.kd[1], 0.01, 1e-12) && mr.dur.baseFromRecord, "opts.dur records and base override the roster and the level");
  // withdrawn terms are neutral unless set
  const lay = mk({ age: 30 }, { age: 30, layoff: 900, last_ko_loss: 1, ufc_years: 8 });
  ok(near(lay.kd[0], y30.kd[0], 1e-15), "layoff, last-fight KO and UFC-years terms neutral by default");
  const lay2 = mk({ age: 30 }, { age: 30, layoff: 900 }, { params: { durability: { engineWeight: 0, fallbackEB: false, withdrawn: { layoff24: 0.64 } } } });
  ok(near(lay2.kd[0] / y30.kd[0], 0.64, 1e-9), "withdrawn layoff knob works when set (x0.64 at 730+ days)");
  // trace format unchanged
  const fOff = E.simulate(p0, E.makeRng(5), true), fOn = E.simulate(wh, E.makeRng(5), true);
  const shape = (f) => JSON.stringify([Object.keys(f).sort(), Object.keys(f.rounds[0]).sort(), Object.keys(f.rounds[0].st).sort(), Object.keys(f.totals.A).sort()]);
  ok(shape(fOff) === shape(fOn), "trace format unchanged (fight, round, stats keys)");
  // summary sanity
  const s = E.summarize(wh, 4000, 11);
  const tot = s.bins.reduce((x, y) => x + y, 0);
  ok(near(tot, 1, 1e-9) && s.bins[0] > 0.05 && s.bins[6] > 0.05 && s.kd15 > 0.1 && s.kd15 < 1.5, "Volk vs Gaethje (roster records) simulates sensibly",
    "Volk " + (100 * s.pA).toFixed(1) + "%, KO by Volk " + (100 * s.bins[0]).toFixed(1) + "%, by Gaethje " + (100 * s.bins[6]).toFixed(1) + "%, KD/15 " + s.kd15.toFixed(2));
  // fallback EB from career sums for a profile without a record
  E.loadDurability(null);
  const fb = E.matchup("alexander-volkanovski", "justin-gaethje", vg);
  ok(fb.dur.A.src === "computed" && fb.dur.B.chin_re < 1 && fb.dur.B.pow_re > 1, "no record: chin_re / pow_re from career sums (Gaethje: good chin, heavy hands)",
    "Gaethje chin_re " + fb.dur.B.chin_re.toFixed(2) + " (roster 0.58), pow_re " + fb.dur.B.pow_re.toFixed(2) + " (roster 1.35)");
  // verifier fixes (Nov 6): the live roster never reaches a fight dated before its snapshot (backtest leak guard), and a
  // hand-made profile without an age is the reference, not the data's "age unknown" x2.22
  E.loadDurability(DUR);
  const live = E.matchup("alexander-volkanovski", "justin-gaethje", vg);
  const past = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, vg, { date: "2022-02-12" }));
  ok(live.dur.A.src === "record" && past.dur.A.src === "computed" && past.dur.B.src === "computed",
    "roster used on or after its snapshot (" + DUR.meta.snapshot + "), never for an earlier fight date");
  const pastRec = E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({}, vg, { date: "2022-02-12", dur: rec }));
  ok(pastRec.dur.A.src === "record" && pastRec.dur.baseFromRecord, "an earlier fight still takes its opts.dur walk-forward record");
  E.loadDurability(null);
  const man = E.manualProfile({ name: "Hand-made" }, { division: "Lightweight" });
  ok(man.manual && man.age == null && near(E.durabilityCovariates(man, null).chin, 1, 1e-15) && near(E.durabilityCovariates({}, null).chin, Math.exp(0.79895), 1e-9),
    "manual profile without an age: chin covariate 1 (data profiles without an age keep x2.22)");
}

console.log("\n" + (fails ? fails + " FAILED of " + checks : "OK (" + checks + " checks)"));
process.exit(fails ? 1 : 0);
