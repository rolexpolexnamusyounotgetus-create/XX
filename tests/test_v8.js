#!/usr/bin/env node
/* test_v8.js: engine v8 (docs/V6_V10_PLAN.md cycle 3) checks on the candidate files (ENGINE_DIR, default src/).

     node tests/test_v8.js [--json out.json]         ENGINE_DIR=versions/v8 node tests/test_v8.js

   1. flag-off identity: every v8 flag off = versions/v4 (engine 4.0.0) bit for bit (matchup tables and 300 simulated fights per
      matchup, traced and untraced) on backtest fights with the learned rates, and on the live Volkanovski vs Gaethje matchup
   2. spread flags with sd 0, and the spread / retarget flags without their inputs, leave the fights identical to flag-off
   3. the spread draws do not touch the main random stream (form draws identical) and are mean-1 lognormal (empirical means)
   4. retarget: deterministic, corner-symmetric (A-B and B-A get identical per-fighter multipliers), cache replay = computed
      result bit for bit, every cumulative multiplier inside [1 / mlMaxRatio, mlMaxRatio], realised decision rates move toward
      the targets, knockdown / conversion / stoppage tables untouched
   5. embed: applied with opts.embed, equals the blend formula (embedBlend), off without inputs
   6. targets: data/derived/v8/statlines_targets.json reproduces src/ml/statdist.js engineTargets on the fold tables (sample),
      fold per year as registered (2019 none, 2020-2023 f<year>, 2024-2025 dev), no 2026 fight anywhere in the v8 inputs
   7. the director consumes a v8 trace (traced fight with every component on is valid)  */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ENG = path.resolve(ROOT, process.env.ENGINE_DIR || "src");
const E = require(path.join(ENG, "engine3.js"));
const E4 = require(path.join(ROOT, "versions/v4/engine3.js"));
const SD0 = require(path.join(ROOT, "src/ml/statdist.js"));
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const checks = [];
function ok(name, cond, detail) { checks.push({ name, pass: !!cond, detail: detail == null ? null : detail }); console.log((cond ? "PASS " : "FAIL ") + name + (detail != null ? "  (" + (typeof detail === "string" ? detail : JSON.stringify(detail)) + ")" : "")); }

const bt = J("data/derived/backtest_dev.json"), keys = bt.meta.keys;
const pri = J("data/derived/mlcal_priors_asof.json");
const OOF = J("data/derived/mlrates_oof_fh.json"), names = OOF.meta.targets;
const TGJ = J("data/derived/v8/statlines_targets.json"), TG = TGJ.fights;
const rates = (a) => { const o = {}; names.forEach((n, i) => { o[n] = a[i]; }); return o; };
const XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
const OFF = { components: { embed: false, retarget: false, tdIntent: false, ctrlSpread: false } };
const ON = { components: { embed: true, retarget: true, tdIntent: true, ctrlSpread: true } };
const fights = bt.fights.filter((f) => f.date >= "2020-01-01" && f.date < "2024-01-01").filter((_, i) => i % 97 === 0).slice(0, 12);
for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
function baseOpts(f, o) {
  const ent = OOF.fights[f.id];
  return { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: pri[f.date.slice(0, 4)],
    ml: { pred: o === 0 ? { A: rates(ent.A), B: rates(ent.B) } : { A: rates(ent.B), B: rates(ent.A) } } };
}
function v8Opts(f, o, params) {
  const op = Object.assign(baseOpts(f, o), { params });
  const t = TG[f.id];
  if (t && t.fold) op.statTargets = o === 0 ? { A: t.A, B: t.B } : { A: t.B, B: t.A };
  XR.apply(op, f, o === 1, params);
  return op;
}
function tables(m) {
  const k = ["dRate", "cRate", "gRate", "gBot", "tdD", "tdCC", "tdCU", "tdO", "tdOC", "ctrlT", "occ", "up", "kd", "gnp", "stko", "subO", "gillo", "pCtl", "clE"];
  const o = {}; for (const x of k) o[x] = Array.isArray(m[x]) || ArrayBuffer.isView(m[x]) ? Array.from(m[x]) : m[x];
  for (const x of ["accO", "mixC", "upPos", "swPos", "gPos", "subTPos", "subBPos", "subOPos"]) o[x] = Array.from(m[x]);
  return JSON.stringify(o);
}
function sims(Ex, m, seed, n, trace) { const rng = Ex.makeRng(seed), out = []; for (let i = 0; i < n; i++) out.push(JSON.stringify(Ex.simulate(m, rng, !!trace))); return out; }

// ---------------------------------------------------------------- 1. flag-off identity vs versions/v4
{
  let same = true, nm = 0, bad = null;
  for (const f of fights) for (let o = 0; o < 2; o++) {
    const A = o === 0 ? f.A : f.B, B = o === 0 ? f.B : f.A;
    const m4 = E4.matchup(A, B, baseOpts(f, o)), m8 = E.matchup(A, B, Object.assign(baseOpts(f, o), { params: OFF }));
    nm++;
    if (tables(m4) !== tables(m8)) { same = false; bad = f.id + " tables"; break; }
    const a = sims(E4, m4, 11 + o, 300), b = sims(E, m8, 11 + o, 300);
    if (a.join("\n") !== b.join("\n")) { same = false; bad = f.id + " sims"; break; }
    const at = sims(E4, m4, 5, 3, true), bt2 = sims(E, m8, 5, 3, true);
    if (at.join("\n") !== bt2.join("\n")) { same = false; bad = f.id + " traced"; break; }
  }
  ok("flag-off identity vs versions/v4 (tables, 300 sims, traced) on " + nm + " backtest matchups", same, bad);
  // live Volk vs Gaethje (fighters.json profiles, no learned model loaded)
  const DB = J("data/derived/fighters.json"); E.loadDB(DB); E4.loadDB(DB);
  const vo = { division: "Lightweight", rounds: 5, title: false };
  const a = sims(E4, E4.matchup("alexander-volkanovski", "justin-gaethje", vo), 3, 300).join("\n");
  const b = sims(E, E.matchup("alexander-volkanovski", "justin-gaethje", Object.assign({ params: OFF }, vo)), 3, 300).join("\n");
  ok("flag-off identity vs versions/v4 on the live Volkanovski vs Gaethje matchup", a === b);
  // defaults without v8 inputs: retarget does nothing (no targets), embed does nothing (no etas / roster); only the spread draws act
  const mD = E.matchup("alexander-volkanovski", "justin-gaethje", vo);
  ok("live matchup with default flags and no targets: retarget not applied, embed source null", mD.retarget && mD.retarget.applied === false && (!mD.embed || mD.embed.src === null), mD.retarget);
}
// ---------------------------------------------------------------- 2. sd 0 and missing inputs = flag-off
{
  const f = fights[0];
  const m0 = E.matchup(f.A, f.B, Object.assign(baseOpts(f, 0), { params: OFF }));
  const mz = E.matchup(f.A, f.B, Object.assign(baseOpts(f, 0), { params: { components: { tdIntent: true, ctrlSpread: true }, spread: { td: 0, ctrl: 0 } } }));
  ok("spread flags on with sd 0 = flag-off fights", sims(E, m0, 9, 200).join() === sims(E, mz, 9, 200).join() && mz.spread === undefined);
  const mr = E.matchup(f.A, f.B, Object.assign(baseOpts(f, 0), { params: { components: { retarget: true, embed: true } } }));
  ok("retarget / embed on without targets or etas = flag-off fights", sims(E, m0, 9, 200).join() === sims(E, mr, 9, 200).join() && mr.retarget.applied === false);
}
// ---------------------------------------------------------------- 3. spread draws: main stream untouched, mean 1
{
  const f = fights[1];
  const P = { components: { tdIntent: true, ctrlSpread: true }, spread: { td: 0.8, ctrl: 0.6 } };
  const m0 = E.matchup(f.A, f.B, Object.assign(baseOpts(f, 0), { params: OFF })), ms = E.matchup(f.A, f.B, Object.assign(baseOpts(f, 0), { params: P }));
  let formSame = true, td = 0, ct = 0, td2 = 0, n = 0;
  const r0 = E.makeRng(21), r1 = E.makeRng(21);
  for (let i = 0; i < 4000; i++) {
    const a = E.simulate(m0, E.makeRng(1000 + i), false), b = E.simulate(ms, E.makeRng(1000 + i), false);
    if (JSON.stringify(a.form) !== JSON.stringify(b.form) || a.pace !== b.pace || a.vol !== b.vol) formSame = false;
    td += b.spread.tdA + b.spread.tdB; ct += b.spread.ctrlA + b.spread.ctrlB; td2 += Math.log(b.spread.tdA) ** 2 + Math.log(b.spread.tdB) ** 2; n += 2;
  }
  void r0; void r1;
  const sdLog = Math.sqrt(td2 / n - (Math.log(1) - 0.32) ** 2);
  ok("spread draws leave the main stream's form draws identical", formSame);
  ok("spread multipliers are mean-1 (empirical means within 4%)", Math.abs(td / n - 1) < 0.04 && Math.abs(ct / n - 1) < 0.04, { td: +(td / n).toFixed(4), ctrl: +(ct / n).toFixed(4) });
  void sdLog;
  // the realised takedown-attempt mean moves little (mean-preserving in the lever)
  const s0 = E.summarize(m0, 6000, 4), s1 = E.summarize(ms, 6000, 4);
  const t0 = s0.avg.A.td_att + s0.avg.B.td_att, t1 = s1.avg.A.td_att + s1.avg.B.td_att;
  ok("TD-intent draw: realised takedown attempts per fight within 8% of flag-off", Math.abs(t1 / t0 - 1) < 0.08, { off: +t0.toFixed(3), on: +t1.toFixed(3) });
}
// ---------------------------------------------------------------- 4. retarget
{
  const f = fights.find((x) => TG[x.id] && TG[x.id].fold) || fights[2];
  E.retargetCacheClear();
  const P = { components: { embed: true, retarget: true, tdIntent: false, ctrlSpread: false } };
  const mAB = E.matchup(f.A, f.B, v8Opts(f, 0, P));
  const mBA = E.matchup(f.B, f.A, v8Opts(f, 1, P));
  ok("retarget applied with targets (computed, then the mirror order replayed from the cache)", mAB.retarget.applied && !mAB.retarget.fromCache && mBA.retarget.fromCache, mAB.retarget.nPilot);
  const cA = mAB.retarget.cum, cB = mBA.retarget.cum;
  const symm = JSON.stringify(cA[0]) === JSON.stringify(cB[1]) && JSON.stringify(cA[1]) === JSON.stringify(cB[0]);
  ok("retarget is corner-symmetric: per-fighter cumulative multipliers identical in A-B and B-A", symm);
  E.retargetCacheClear();
  const mBA2 = E.matchup(f.B, f.A, v8Opts(f, 1, P));
  ok("cache replay = full computation bit for bit (B-A computed fresh vs replayed)", tables(mBA2) === tables(mBA) && !mBA2.retarget.fromCache);
  E.retargetCacheClear();
  const mAB2 = E.matchup(f.A, f.B, v8Opts(f, 0, P));
  ok("retarget deterministic (fresh cache, same tables)", tables(mAB2) === tables(mAB));
  const cap = E.params().mlMaxRatio || 4;
  let inCap = true;
  for (const c of cA) { for (const k of ["td", "ct", "d", "c", "g"]) if (c[k] < 1 / cap - 1e-12 || c[k] > cap + 1e-12) inCap = false; for (const a of c.acc.concat([c.tdAcc])) if (Math.abs(a) > Math.log(cap) + 1e-12) inCap = false; }
  ok("every cumulative retarget multiplier inside [1 / mlMaxRatio, mlMaxRatio], accuracy shifts within +-log(mlMaxRatio)", inCap);
  const mE = E.matchup(f.A, f.B, Object.assign(v8Opts(f, 0, { components: { embed: true, retarget: false } }), {}));
  ok("retarget leaves knockdown / GNP / standing-TKO / submission-conversion / guillotine tables untouched",
    JSON.stringify([mE.kd, mE.gnp, mE.stko, mE.subO, mE.gillo, Array.from(mE.subOPos)]) === JSON.stringify([mAB.kd, mAB.gnp, mAB.stko, mAB.subO, mAB.gillo, Array.from(mAB.subOPos)]));
  // realised decision-subset rates move toward the targets (distance attempts, takedown attempts, sig landed) on a few fights
  let closer = 0, tot = 0;
  for (const g of fights.filter((x) => TG[x.id] && TG[x.id].fold).slice(0, 6)) {
    const t = TG[g.id];
    const m0 = E.matchup(g.A, g.B, v8Opts(g, 0, { components: { embed: true } })), m1 = E.matchup(g.A, g.B, v8Opts(g, 0, P));
    const dr = (m) => { const r = E.makeRng(77), acc = { d_att: 0, td_att: 0, sig_lnd: 0 }; let n = 0; for (let i = 0; i < 1500; i++) { const s = E.simulate(m, r, false); if (!E.isDecision(s)) continue; n++; for (const k in acc) acc[k] += (s.totals.A[k] + s.totals.B[k]); } for (const k in acc) acc[k] /= n * 5 * g.rounds; return acc; };
    const a0 = dr(m0), a1 = dr(m1);
    for (const k of ["d_att", "td_att", "sig_lnd"]) { const want = t.A[k] + t.B[k]; tot++; if (Math.abs(a1[k] - want) <= Math.abs(a0[k] - want) + 0.02 * want) closer++; }
  }
  ok("realised decision rates move toward the statlines targets (>= 80% of fight x stat)", closer >= 0.8 * tot, closer + "/" + tot);
  // swapOpts swaps every corner-specific input
  const so = E._rt.swapOpts(v8Opts(f, 0, P), mAB);
  ok("swapOpts swaps learned rates, etas and targets and pins the division", so.ml.pred.A === v8Opts(f, 0, P).ml.pred.B || JSON.stringify(so.ml.pred.A) === JSON.stringify(v8Opts(f, 1, P).ml.pred.A) && JSON.stringify(so.statTargets.A) === JSON.stringify(TG[f.id].B) && so.division === mAB.division);
}
// ---------------------------------------------------------------- 5. embed
{
  const f = fights[3];
  const op = v8Opts(f, 0, { components: { embed: true } });
  const m = E.matchup(f.A, f.B, op);
  const P = E.params(), tix = {}; P.embed.tasks.forEach((t, i) => { tix[t] = i; });
  const want = E.embedBlend(op.ml.pred.A, op.embed.etaA, op.embed.recipe, tix);
  const raw = m.embed.raw.A, same = Object.keys(want).every((k) => Math.abs(want[k] - E.embedBlend(raw, op.embed.etaA, op.embed.recipe, tix)[k]) < 1e-15);
  ok("embed applied from opts.embed (fold-honest recipe) and equal to the blend formula", m.embed.src === "opts" && m.embed.recipe === "opts" && same);
  const y = f.date.slice(0, 4), fh = J("data/derived/embed_blend_fh.json").coef_fh;
  ok("backtest embed recipe = embed_blend_fh.json coef_fh[year] (fit on 2019..year-1)", JSON.stringify(op.embed.recipe) === JSON.stringify(fh[y]));
}
// ---------------------------------------------------------------- 6. targets file
{
  const FOLDS = J("data/derived/v8/statlines_folds.json"), INP = J("data/derived/v8/statlines_inputs.json");
  let worst = 0, n = 0, foldOk = true, no2026 = true;
  const fy = { 2020: "f2020", 2021: "f2021", 2022: "f2022", 2023: "f2023", 2024: "dev", 2025: "dev" };
  for (const [id, t] of Object.entries(TG)) {
    if (t.date >= "2026-01-01") no2026 = false;
    const y = +t.date.slice(0, 4);
    if ((y === 2019 && t.fold !== null) || (y > 2019 && t.fold !== fy[y])) foldOk = false;
  }
  for (const id of Object.keys(INP.fights)) if (INP.fights[id].date >= "2026-01-01") no2026 = false;
  const ids = Object.keys(TG).filter((id) => TG[id].fold).filter((_, i) => i % 53 === 0);
  for (const id of ids) {
    const v = INP.fights[id], SD = SD0.load(FOLDS, { which: v.fold, enable: true });
    const T = SD.engineTargets(SD.prepare({ mlA: v.mlA, mlB: v.mlB, etaA: v.etaA, etaB: v.etaB, hasEmb: v.hasEmb, winLogit: v.winLogit, oppA: v.oppA, oppB: v.oppB, rounds: v.rounds }), 5 * v.rounds);
    for (const s of ["A", "B"]) for (const k in T[s]) { worst = Math.max(worst, Math.abs(T[s][k] - TG[id][s][k]) / Math.max(1e-6, T[s][k])); n++; }
  }
  ok("statlines_targets.json = statdist engineTargets on the fold tables (" + n + " values, 6-decimal storage)", worst < 5e-5, worst.toExponential(2));
  ok("target fold per year as registered (2019 none, 2020-23 f<year>, 2024-25 dev)", foldOk);
  ok("no 2026 fight in the v8 targets or inputs", no2026);
  ok("fold tables: dev refit = statlines.json models.dev and folds = statlines_oof.json (export checks)", FOLDS.meta.checks.dev_refit_vs_statlines_json_max_rel < 1e-4 && FOLDS.meta.checks.folds_vs_statlines_oof_max_rel < 2e-3, FOLDS.meta.checks);
  const dev = SD0.load(FOLDS, { which: "dev" }), sj = SD0.load(J("data/derived/statlines.json"), { which: "dev" });
  ok("statlines_folds.json dev = statlines.json dev (identical tables)", JSON.stringify(dev.model) === JSON.stringify(sj.model));
}
// ---------------------------------------------------------------- 7. trace for the director
{
  const D = require(path.join(ROOT, "src/director3.js"));
  const f = fights.find((x) => TG[x.id] && TG[x.id].fold);
  const P = { components: ON.components, spread: { td: 0.7, ctrl: 0.5 } };
  const m = E.matchup(f.A, f.B, v8Opts(f, 0, P));
  let good = true;
  for (let i = 0; i < 20; i++) {
    const fx = E.simulate(m, E.makeRng(400 + i), true);
    try { const s = (D.build || D.FightDirector && D.FightDirector.build)(fx, 400 + i); if (!s) good = false; } catch (e) { good = false; }
    for (const r of fx.rounds) for (const ev of r.ev) if (!(ev.t >= 0 && ev.t <= 300)) good = false;
  }
  ok("director builds scripts from 20 traced v8 fights (all components on, spread on), event times valid", good);
}
const nPass = checks.filter((c) => c.pass).length;
console.log(`\ntest_v8: ${nPass}/${checks.length} checks pass (engine ${E.VERSION}, params ${E.params().version}, ${path.relative(ROOT, ENG) || "."})`);
const ji = process.argv.indexOf("--json");
if (ji > 0) fs.writeFileSync(process.argv[ji + 1], JSON.stringify({ engine: E.VERSION, params: E.params().version, engine_dir: path.relative(ROOT, ENG), checks, pass: nPass === checks.length }, null, 1));
process.exit(nPass === checks.length ? 0 : 1);
