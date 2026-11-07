#!/usr/bin/env node
/* evalv_decide.js (v5.0.1; v5 review "the base-rate gate compares points against tolerances smaller than the sampling noise" and
   "Branch 2 passes if any one of 7 correlated secondary metrics excludes 0"): applies the DECISION RULE to two stored evalv runs of
   the same split, new vs previous version, with the corrections the review asked for, pre-registered before v5.0.1's look.

     node tools/evalv_decide.js --new data/derived/evalv/v5.0.1_val.json --old <previous version's per-fight file> [--boot 2000] [--out f]

   Both files must hold the per-fight simulated stats (evalv 5.0.1+ outputs; a deterministic --dev reproduction of an older
   version's run gives them, and the tool checks its pA against the stored look).
   Branch 1: winner log loss, paired event-cluster 95% CI excludes 0 on the good side.
   Branch 2: winner not worse (CI includes 0) AND at least one of the pre-registered secondary family improves after a Holm
     adjustment at family-wise 0.05: 7-bin, method, and the stat-line deviances of sig landed, sig attempts, TD, control, KD (the
     seven metrics the registered rule names; unconditional totals, as registered); per-minute deviance (conditioned on the real
     fight length) and the unadjusted CIs are reported next to it. AND the base-rate condition:
     paired: for each gated base rate b, D_b = |new_b - actual_b| - |old_b - actual_b| with an event-cluster CI (all three
       recomputed per resample, ratios of sums); b drifts out of tolerance when D_b's CI is above 0 AND |new_b - actual_b| > tol_b,
       tol_b = max(registered mlcal tolerance, 1.96 x the event-cluster SE of actual_b). This is the governing condition.
     registered (v5's rule, reported): a base rate that was inside the mlcal tolerance for old and is outside for new, or is
       further outside, fails.
   Sensitivity (information only, never a rule input): the same paired test with the dated 2024 glove-trial window
   (2024-06-01..2024-11-15) excluded. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const args = {}; { const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) { const v = a[i + 1]; if (v == null || v.startsWith("--")) args[a[i].slice(2)] = true; else { args[a[i].slice(2)] = v; i++; } } }
const B = +(args.boot || 2000);
const J = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const NEW = J(args.new), OLD = J(args.old);
const bt = J("data/derived/backtest_dev.json");
const byId = new Map(bt.fights.filter((f) => f.date < "2026-01-01").map((f) => [f.id, f]));
const oldBy = new Map(OLD.fights.map((x) => [x.id, x]));
const fights = NEW.fights.filter((x) => oldBy.has(x.id) && byId.has(x.id));
if (!fights.length || !fights[0].st || !oldBy.get(fights[0].id).st) { console.error("evalv_decide: both runs need per-fight simulated stats (evalv 5.0.1+)"); process.exit(2); }
const TOL = { KO: 0.02, SUB: 0.015, R1_3rd: 0.03, R3_3rd: 0.03, SDMD: 0.04, kd100: 0.12, td15: 0.10, ctrl15: 0.10, sig15: 0.06 };
const REL = { kd100: 1, td15: 1, ctrl15: 1, sig15: 1 };   // relative tolerances (fraction of actual); the rest absolute shares
function outcome(f) {
  const r = f.result || {}, cls = { KO: "KO", DOC: "KO", SUB: "SUB", UD: "DEC", SD: "DEC", MD: "DEC", DRAW: "DRAW" }[r.method] || null;
  if (!cls || (cls !== "DRAW" && r.winner !== "A" && r.winner !== "B")) return null;
  return { cls, round: r.round || 1, method: r.method };
}
// per-fight additive pieces of every base rate (sums; ratios are taken after summing over a resample)
function pieces(x, f) {
  const y = outcome(f), a = f.actual, p = {};
  const R = x.rounds === 5 ? 5 : 3;
  if (y) {
    p.n = 1; p.sKO = x.pKO; p.aKO = y.cls === "KO" ? 1 : 0; p.sSUB = x.pSUB; p.aSUB = y.cls === "SUB" ? 1 : 0;
    if (R === 3) { const fin = x.finR[0] + x.finR[1] + x.finR[2]; p.sF3 = fin; p.sR1 = x.finR[0]; p.sR3 = x.finR[2];
      const af = y.cls === "KO" || y.cls === "SUB"; p.aF3 = af ? 1 : 0; p.aR1 = af && Math.min(3, y.round) === 1 ? 1 : 0; p.aR3 = af && Math.min(3, y.round) === 3 ? 1 : 0; }
    const d = x.dec || [0, 0, 0]; p.sDec = d[0] + d[1] + d[2]; p.sSM = d[1] + d[2];
    p.aDec = ["UD", "SD", "MD"].includes(y.method) ? 1 : 0; p.aSM = y.method === "SD" || y.method === "MD" ? 1 : 0;
  }
  if (a && a.A && a.B) {
    const st = x.st, q = (k) => st[k][0] + st[k][1];
    p.sKD = q("kd"); p.sH = q("h_lnd"); p.aKD = a.A.kd + a.B.kd; p.aH = a.A.h_lnd + a.B.h_lnd;
    p.sMin = x.mins; p.aMin = +a.minutes || 0;
    p.sSig = q("sig_lnd"); p.aSig = a.A.sig_lnd + a.B.sig_lnd; p.sTD = q("td_lnd"); p.aTD = a.A.td_lnd + a.B.td_lnd; p.sCt = q("ctrl"); p.aCt = a.A.ctrl + a.B.ctrl;
  }
  return p;
}
function rates(S, pre) {
  const g = (k) => S[pre + k] || 0;
  return { KO: g("KO") / S.n, SUB: g("SUB") / S.n, R1_3rd: g("R1") / g("F3"), R3_3rd: g("R3") / g("F3"), SDMD: g("SM") / g("Dec"),
    kd100: 100 * g("KD") / g("H"), sig15: 15 * g("Sig") / 2 / g("Min"), td15: 15 * g("TD") / 2 / g("Min"), ctrl15: 15 * g("Ct") / 2 / g("Min") };
}
function addTo(S, p) { for (const k in p) S[k] = (S[k] || 0) + p[k]; }
const PN = fights.map((x) => pieces(x, byId.get(x.id))), PO = fights.map((x) => pieces(oldBy.get(x.id), byId.get(x.id)));
function groupsOf(ix) { const ev = new Map(); for (const i of ix) { const k = fights[i].event + "|" + fights[i].date; if (!ev.has(k)) ev.set(k, []); ev.get(k).push(i); } return [...ev.values()]; }
function rng(seed) { let st = seed >>> 0; return () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; }; }
function baseRateTest(ix, label) {
  const groups = groupsOf(ix), rnd = rng(4242), keys = Object.keys(TOL);
  function stat(sel) {
    const SN = {}, SO = {};
    for (const i of sel) { addTo(SN, PN[i]); addTo(SO, PO[i]); }
    const rn = rates(SN, "s"), ro = rates(SO, "s"), ra = rates(SN, "a");
    return { rn, ro, ra };
  }
  const pt = stat(ix), draws = Object.fromEntries(keys.map((k) => [k, { d: [], a: [] }]));
  for (let b = 0; b < B; b++) {
    const sel = []; for (let g = 0; g < groups.length; g++) for (const i of groups[Math.floor(rnd() * groups.length)]) sel.push(i);
    const s = stat(sel);
    for (const k of keys) { draws[k].d.push(Math.abs(s.rn[k] - s.ra[k]) - Math.abs(s.ro[k] - s.ra[k])); draws[k].a.push(s.ra[k]); }
  }
  const out = { label, n_fights: ix.length, rows: {} };
  let failP = [], failR = [];
  for (const k of keys) {
    const d = draws[k].d.slice().sort((a, b) => a - b), av = draws[k].a, m = av.reduce((x, y) => x + y, 0) / av.length;
    const se = Math.sqrt(av.reduce((x, y) => x + (y - m) * (y - m), 0) / (av.length - 1));
    const act = pt.ra[k], tolReg = REL[k] ? TOL[k] * act : TOL[k], tol = Math.max(tolReg, 1.96 * se);
    const eN = pt.rn[k] - act, eO = pt.ro[k] - act, D = Math.abs(eN) - Math.abs(eO);
    const lo = d[Math.floor(0.025 * B)], hi = d[Math.floor(0.975 * B)];
    const pairedFail = lo > 0 && Math.abs(eN) > tol;
    const regFail = (Math.abs(eN) > tolReg) && (Math.abs(eO) <= tolReg || Math.abs(eN) > Math.abs(eO));
    if (pairedFail) failP.push(k); if (regFail) failR.push(k);
    out.rows[k] = { actual: act, new: pt.rn[k], old: pt.ro[k], err_new: eN, err_old: eO, D_abs_err: D, D_ci: [lo, hi], se_actual: se,
      tol_registered: tolReg, tol_paired: tol, paired_fail: pairedFail, registered_fail: regFail };
  }
  out.paired_fail = failP; out.registered_fail = failR;
  return out;
}
// ---- paired metric tests with bootstrap p-values (same event clusters), Holm over the registered secondary family
function pairedP(key, ix) {
  const groups = groupsOf(ix), rnd = rng(777);
  const d = fights.map((x) => { const a = x.L[key], b = oldBy.get(x.id).L[key]; return a != null && b != null && isFinite(a) && isFinite(b) ? a - b : null; });
  const v = ix.map((i) => d[i]).filter((x) => x != null), est = v.reduce((a, b) => a + b, 0) / v.length;
  const ds = [];
  for (let b = 0; b < B; b++) { let s = 0, c = 0; for (let g = 0; g < groups.length; g++) for (const i of groups[Math.floor(rnd() * groups.length)]) if (d[i] != null) { s += d[i]; c++; } ds.push(s / Math.max(1, c)); }
  ds.sort((a, b) => a - b);
  const le = ds.filter((x) => x <= 0).length / B, ge = ds.filter((x) => x >= 0).length / B;
  return { diff: est, ci: [ds[Math.floor(0.025 * B)], ds[Math.floor(0.975 * B)]], p_two_sided: Math.min(1, 2 * Math.min(le, ge)), n: v.length };
}
const ALL = fights.map((_, i) => i);
const win = pairedP("winLL", ALL);
const FAMILY = ["bin7", "method", "dev_sig_lnd", "dev_sig_att", "dev_td_lnd", "dev_ctrl", "dev_kd"];
const fam = Object.fromEntries(FAMILY.map((k) => [k, pairedP(k, ALL)]));
const extra = Object.fromEntries(["brier", "devpm_sig_lnd", "devpm_sig_att", "devpm_td_lnd", "devpm_ctrl", "devpm_kd"].filter((k) => fights[0].L[k] != null && oldBy.get(fights[0].id).L[k] != null).map((k) => [k, pairedP(k, ALL)]));
// Holm: sort p ascending; reject while p_(j) <= 0.05 / (m - j); a metric counts as "clearly better" when rejected AND diff < 0
const order = FAMILY.slice().sort((a, b) => fam[a].p_two_sided - fam[b].p_two_sided);
let stop = false;
order.forEach((k, j) => { const thr = 0.05 / (FAMILY.length - j); fam[k].holm_threshold = thr; fam[k].holm_reject = !stop && fam[k].p_two_sided <= thr; if (!fam[k].holm_reject) stop = true; });
const better = FAMILY.filter((k) => fam[k].holm_reject && fam[k].diff < 0), worse = FAMILY.filter((k) => fam[k].holm_reject && fam[k].diff > 0);
const br = baseRateTest(ALL, "full window");
const noGlove = ALL.filter((i) => !(fights[i].date >= "2024-06-01" && fights[i].date < "2024-11-16"));
const brS = NEW.meta.split === "val" ? baseRateTest(noGlove, "sensitivity: without the dated 2024 glove-trial window (information only)") : null;
const b1 = win.ci[1] < 0;
const notWorse = win.ci[0] <= 0 && win.ci[1] >= 0 || b1;
const b2 = !b1 && notWorse && better.length > 0 && br.paired_fail.length === 0;
const b2reg = !b1 && notWorse && FAMILY.some((k) => fam[k].ci[1] < 0) && br.registered_fail.length === 0;
const out = {
  meta: { tool: "tools/evalv_decide.js", built: new Date().toISOString(), new: args.new, old: args.old, new_version: NEW.meta.version, old_version: OLD.meta.version,
    split: NEW.meta.split, n_paired: fights.length, boot: B },
  branch1: { winLL: win, pass: b1 },
  branch2: { winner_not_worse: notWorse, family: fam, holm_order: order, clearly_better_holm: better, clearly_worse_holm: worse,
    base_rates: br, pass: b2, registered_v5_rule: { any_unadjusted_ci_excludes_0: FAMILY.filter((k) => fam[k].ci[1] < 0), base_rates_fail: br.registered_fail, pass: b2reg } },
  extra_metrics: extra, sensitivity_no_glove_trial: brS,
  decision: { keep: b1 || b2, basis: b1 ? "branch 1" : (b2 ? "branch 2 (Holm + paired base-rate test)" : "neither branch"),
    registered_v5_rule_would_keep: b1 || b2reg }
};
console.log(JSON.stringify({ winLL: win, branch1: b1, clearly_better_holm: better, clearly_worse_holm: worse, base_rate_paired_fail: br.paired_fail,
  base_rate_registered_fail: br.registered_fail, decision: out.decision }, null, 1));
if (args.out) fs.writeFileSync(path.isAbsolute(args.out) ? args.out : path.join(ROOT, args.out), JSON.stringify(out, null, 1));
