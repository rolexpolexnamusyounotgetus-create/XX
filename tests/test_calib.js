// Test for src/ml/calib.js: reproduces tools/calib.py's recalibration, fitter, walk-forward refit, slope and monitor
// on the vectors in data/derived/calib.json (test_vectors), checks exact corner symmetry, identity for the production
// specs, and the segment flags.
//
//   node tests/test_calib.js
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..");
const Calib = require(path.join(ROOT, "src/ml/calib.js"));
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/calib.json"), "utf8"));
const V = doc.test_vectors;

let fails = 0, passes = 0;
function check(name, ok, info) {
  if (ok) passes++; else fails++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${info ? "  (" + info + ")" : ""}`);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// 1. apply: every kind, both corner orders
let dA = 0, dS = 0, dSym = 0;
for (const t of V.apply) {
  const o = Calib.apply(t.spec, t.p, t.flags), s = Calib.apply(t.spec, 1 - t.p, t.flags);
  dA = Math.max(dA, Math.abs(o - t.out));
  dS = Math.max(dS, Math.abs(s - t.out_swapped));
  dSym = Math.max(dSym, Math.abs(o + s - 1));
}
check(`apply reproduces Python on ${V.apply.length} vectors`, dA < 1e-12, "max |diff| " + dA.toExponential(2));
check("apply on the swapped corner reproduces Python", dS < 1e-12, "max |diff| " + dS.toExponential(2));
check("corner swap gives 1 - p for every kind", dSym < 1e-12, "max |p + p_swapped - 1| " + dSym.toExponential(2));

// 2. fit: same MAP estimates
let dF = 0;
for (const t of V.fit) {
  const o = Object.assign({}, t.opts);
  const opts = { halfLife: o.half_life, maxAge: o.max_age, lastN: o.last_n, sdA: o.sd_a, sdB: o.sd_b, segs: o.segs };
  const sp = Calib.fit(t.kind, t.rows, opts);
  dF = Math.max(dF, Math.abs(sp.a - t.spec.a));
  if (t.kind === "odd") dF = Math.max(dF, Math.abs(sp.b - t.spec.b));
  if (t.kind === "segment") for (const k of Object.keys(t.spec.d)) dF = Math.max(dF, Math.abs(sp.d[k] - t.spec.d[k]));
  if (Math.abs(sp.n_eff - t.spec.n_eff) > 1e-9) dF = Math.max(dF, 1);
}
check(`fit reproduces Python MAP estimates on ${V.fit.length} problems`, dF < 1e-7, "max |diff| " + dF.toExponential(2));

// 3. walk-forward refit from scored history rows (the forward-ledger path)
let dH = 0;
for (const t of V.history) {
  const c = t.cfg;
  const cfg = { kind: c.kind, halfLife: c.half_life, maxAge: c.max_age, lastN: c.last_n, sdA: c.sd_a, sdB: c.sd_b, segs: c.segs };
  const sp = Calib.fitFromHistory(V.history_rows, t.as_of, cfg);
  if (sp.type !== t.spec.type) dH = Math.max(dH, 1);
  else if (sp.type !== "none") {
    dH = Math.max(dH, Math.abs(sp.a - t.spec.a));
    if (sp.d) for (const k of Object.keys(t.spec.d)) dH = Math.max(dH, Math.abs(sp.d[k] - t.spec.d[k]));
  }
}
check(`fitFromHistory reproduces Python on ${V.history.length} configs`, dH < 1e-7, "max |diff| " + dH.toExponential(2));

// 4. slope + monitor
let dSl = 0, monOk = true;
for (const t of V.slope) {
  const s = Calib.slope(t.p, t.y);
  dSl = Math.max(dSl, Math.abs(s.slope - t.slope), Math.abs(s.se - t.se));
}
for (const t of V.monitor) {
  const m = Calib.monitor(t.p, t.y, t.window);
  if (m.ready !== t.out.ready) monOk = false;
  else if (m.ready && (!near(m.slope, t.out.slope, 1e-4) || m.ciIncludes1 !== t.out.ci_includes_1 ||
           !near(m.ci[0], t.out.ci[0], 1e-4) || !near(m.ci[1], t.out.ci[1], 1e-4))) monOk = false;
}
check("slope and Wald SE reproduce Python", dSl < 1e-8, "max |diff| " + dSl.toExponential(2));
check("trailing-200 monitor reproduces Python (ready flag, slope, CI, includes-1)", monOk);

// 4b. pre-registered drift rule 6.5.1 (b): quarterly trailing-200 checks, fire on two consecutive CIs including 1
let rbOk = true, rbInfo = [];
for (const t of V.rule_b || []) {
  const o = Calib.ruleB(t.rows, t.as_of, t.window);
  const e = t.out;
  if (o.fired !== e.fired || o.firedAt !== e.fired_at || o.setting !== e.setting || o.checks.length !== e.checks.length) rbOk = false;
  for (let k = 0; k < Math.min(o.checks.length, e.checks.length); k++) {
    const a = o.checks[k], b = e.checks[k];
    if (a.quarterEnd !== b.quarter_end || a.ready !== b.ready || a.n !== b.n) rbOk = false;
    else if (a.ready && (!near(a.slope, b.slope, 1e-4) || a.ciIncludes1 !== b.ci_includes_1)) rbOk = false;
  }
  rbInfo.push((e.fired_at || "no fire") + " / " + e.checks.length + " checks");
}
check(`ruleB reproduces Python drift_rule_b on ${(V.rule_b || []).length} synthetic ledgers`, rbOk && (V.rule_b || []).length > 0,
  rbInfo.join("; "));
const qe = Calib.quarterEnds("2026-11-07", "2027-07-01");
check("quarter ends", JSON.stringify(qe) === JSON.stringify(["2026-12-31", "2027-03-31", "2027-06-30"]), JSON.stringify(qe));
const rbEmpty = Calib.ruleB([], "2027-01-01");
check("ruleB with no scored bouts keeps the default setting", !rbEmpty.fired && rbEmpty.setting === "h1.5");
// swapping corners on every ledger row (p -> 1 - p, y -> 1 - y) leaves the rule's state unchanged
if (V.rule_b && V.rule_b.length) {
  const t = V.rule_b[0];
  const sw = t.rows.map((r) => ({ date: r.date, p: 1 - r.p, y: 1 - r.y }));
  const a = Calib.ruleB(t.rows, t.as_of, t.window), b = Calib.ruleB(sw, t.as_of, t.window);
  let symOk = a.firedAt === b.firedAt;
  for (let k = 0; k < a.checks.length; k++) if (a.checks[k].ready && !near(a.checks[k].slope, b.checks[k].slope, 1e-9)) symOk = false;
  check("ruleB is corner-symmetric (mirrored slope)", symOk);
}

// 5. production specs: today every head is the identity (nothing passed the CV gate)
const heads = Object.keys(doc.production);
let idOk = true;
for (const h of heads) {
  const sp = doc.production[h];
  if (sp && sp.type === "none") {
    for (const p of [0.03, 0.31, 0.5, 0.77, 0.99]) if (Calib.apply(sp, p, {}) !== p) idOk = false;
  }
}
check(`production specs (${heads.join(", ")}) are applied exactly`, idOk,
  heads.map((h) => h + ": " + (doc.production[h] ? doc.production[h].type : "walk-forward")).join(", "));

// 6. flags
const f1 = Calib.segFlags({ women: false, lbs: 155, nA: 30, nB: 12, rounds: 5, pRaw: 0.62 });
const f2 = Calib.segFlags({ women: true, lbs: 125, nA: 0, nB: 4, rounds: 3, pRaw: 0.2 });
const f3 = Calib.segFlags({ women: false, lbs: 265, nMin: 2, five: false, pRaw: 0.76 });
check("segment flags", f1.five === 1 && f1.heavy === 0 && f1.newcomer === 0 && f1.bigfav === 0 &&
  f2.women === 1 && f2.debut === 1 && f2.newcomer === 0 && f2.bigfav === 1 && f2.heavy === 0 &&
  f3.heavy === 1 && f3.newcomer === 1 && f3.bigfav === 1 && f3.five === 0, JSON.stringify([f1, f2, f3]));
const fs1 = Calib.segFlags({ women: false, lbs: 155, nA: 12, nB: 30, rounds: 5, pRaw: 0.38 });
check("segment flags are corner-symmetric", JSON.stringify(fs1) === JSON.stringify(f1));

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
