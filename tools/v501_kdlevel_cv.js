#!/usr/bin/env node
/* v501_kdlevel_cv.js (engine v5.0.1; v5 review "the KD base-rate failure has a structural cause"): forward-chained CV inside
   2019-2023 (TRAIN only) of how the durability component sets the league knockdown level. No 2024+ fight is simulated or scored.

   PRE-REGISTERED (written before the first run, Nov 7 2026 ~04:20 UTC):
   Candidates for the knockdown base of each fight (absolute mode keeps the record's fighter / covariate terms):
     A  L730     the incumbent: the walk-forward record's base (trailing 730-day league level x terms)
     B  relative durability relative mode (params.durability.level null): the engine's own walk-forward priors level
                 (division rates from the 5 years before Jan 1 of the fight year) x context, C x P / NORM
     C  L1460    the record base x L1460(t) / L730(t)      (4-year trailing window)
     D  L1825    the record base x L1825(t) / L730(t)      (5-year trailing window)
     E  shrunk   the record base x sqrt(L730(t) x Llong(t)) / L730(t)   (L730 shrunk halfway, in logs, toward the level since 2008)
   (levels: data/derived/kd_levels_wf.json, tools/v501_kdlevels.py, strictly earlier fight days)
   Scoring, test years 2020-2023 (2019 is the first fit year): for candidate c and test year y, the knockdown scale is re-matched
   on 2019..y-1 only (s = actual KD/head over sim KD/head, pooled), then KD per 100 head landed in year y is predicted as s x sim.
   Primary: RMSE over the four test years of log(predicted / actual). Secondary: per-fight Poisson deviance of the fight's
   knockdowns (both men) on the test years under the same re-matched scale. Also reported: 2023 alone (the pseudo-holdout), KO
   share by year.
   Rule: the lowest primary RMSE wins, but the incumbent A is replaced only if the winner's RMSE is at most 0.9 x A's AND its
   secondary deviance is not worse than A's; otherwise A stays.

     nice -n 5 node tools/v501_kdlevel_cv.js [--sims 100] [--workers 3] [--engine-dir versions/v5.0.1] [--out data/derived/v501_kdlevel_cv.json]
   (ran on the 5.0.1 working copy in src/ before the levels set was added; the check is level-invariant: each fold re-matches the scale) */
"use strict";
const fs = require("fs");
const path = require("path");
const { Worker, isMainThread, parentPort, workerData } = require("worker_threads");
const ROOT = path.resolve(__dirname, "..");
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
function hash32(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; }
function mix(a, b) { let h = (a ^ Math.imul(b + 0x6d2b79f5, 0x9e3779b1)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x85ebca6b); h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35); return (h ^ (h >>> 16)) >>> 0; }
const CANDS = ["A_L730", "B_relative", "C_L1460", "D_L1825", "E_shrunk"];

if (!isMainThread) {
  const W = workerData;
  const E = require(path.join(W.engineDir, "engine3.js"));
  const bt = J("data/derived/backtest_dev.json"), keys = bt.meta.keys;
  const PA = J("data/derived/mlcal_priors_asof.json"), OOF = J("data/derived/mlrates_oof.json"), T = OOF.meta.targets;
  const toObj = (a) => { const r = {}; T.forEach((k, i) => { r[k] = a[i]; }); return r; };
  const LV = J("data/derived/kd_levels_wf.json").fights;
  const DR = require(path.join(ROOT, "tools/durrec.js"))(E, ROOT), SR = require(path.join(ROOT, "tools/sosrec.js"))(E, ROOT), XR = require(path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
  const byId = new Map(bt.fights.map((f) => [f.id, f]));
  parentPort.on("message", (msg) => {
    const out = [];
    for (const id of msg.ids) {
      const f = byId.get(id); if (!f || f.date < "2019-01-01" || f.date >= "2024-01-01") continue;
      const lv = LV[id]; if (!lv) throw new Error("no levels for " + id);
      const rec = { id, y: f.date.slice(0, 4), c: {} };
      for (const cand of CANDS) {
        let kd = 0, h = 0, ko = 0, n = 0;
        for (const swap of [false, true]) {
          const A = Object.assign({}, swap ? f.B : f.A, { keys }), B = Object.assign({}, swap ? f.A : f.B, { keys });
          const o = { division: f.prior_division || f.division, rounds: f.rounds, title: !!f.title, date: f.date, priors: PA[f.date.slice(0, 4)], params: {} };
          const oof = OOF.fights[f.id];
          o.ml = oof && oof.A && oof.B ? (swap ? { pred: { A: toObj(oof.B), B: toObj(oof.A) } } : { pred: { A: toObj(oof.A), B: toObj(oof.B) } }) : false;
          DR.apply(o, f.id, swap); SR.apply(o, f, swap); XR.apply(o, f, swap, o.params);
          if (cand === "B_relative") o.params = Object.assign({}, o.params, { durability: Object.assign({}, o.params.durability, { level: null }) });
          else if (cand !== "A_L730") {
            const r = cand === "C_L1460" ? lv.L1460 / lv.L730 : cand === "D_L1825" ? lv.L1825 / lv.L730 : Math.sqrt(lv.L730 * lv.Llong) / lv.L730;
            o.dur = Object.assign({}, o.dur, { base: o.dur.base * r });
          }
          const m = E.matchup(A, B, o);
          if (cand !== "B_relative") DR.assertApplied(m, f.id, o.params);
          const base = mix(mix(hash32(f.id), swap ? 1 : 0), 7);
          for (let k = 0; k < W.sims; k++) {
            const s = E.simulate(m, E.makeRng(mix(base, k + 1)), false);
            kd += s.totals.A.kd + s.totals.B.kd; h += s.totals.A.h_lnd + s.totals.B.h_lnd;
            if (!E.isDecision(s) && s.method !== "SUB") ko++;
            n++;
          }
        }
        rec.c[cand] = { kd: kd / n, h: h / n, ko: ko / n };
      }
      out.push(rec);
    }
    parentPort.postMessage(out);
  });
  return;
}

const args = {}; { const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) { const v = a[i + 1]; if (v == null || v.startsWith("--")) args[a[i].slice(2)] = true; else { args[a[i].slice(2)] = v; i++; } } }
const SIMS = +(args.sims || 100), WORKERS = Math.min(3, +(args.workers || 3));
const bt = J("data/derived/backtest_dev.json");
const train = bt.fights.filter((f) => f.date >= "2019-01-01" && f.date < "2024-01-01");
const ids = train.map((f) => f.id), chunks = []; for (let i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
const res = []; let next = 0, live = 0; const t0 = Date.now();
new Promise((resolve) => {
  for (let k = 0; k < WORKERS; k++) {
    const w = new Worker(__filename, { workerData: { sims: SIMS, engineDir: path.resolve(ROOT, args["engine-dir"] || "src") } }); live++;
    const feed = () => { if (next >= chunks.length) { w.terminate(); if (--live === 0) resolve(); return; } w.postMessage({ ids: chunks[next++] }); };
    w.on("message", (o) => { res.push(...o); feed(); }); w.on("error", (e) => { console.error(e); process.exit(1); });
    feed();
  }
}).then(() => {
  const act = new Map(train.map((f) => [f.id, f]));
  const YEARS = ["2019", "2020", "2021", "2022", "2023"], TEST = ["2020", "2021", "2022", "2023"];
  function koAct(f) { const m = f.result && f.result.method; return m === "KO" || m === "DOC" ? 1 : (["SUB", "UD", "SD", "MD", "DRAW"].includes(m) ? 0 : null); }
  const out = { meta: { tool: "tools/v501_kdlevel_cv.js", built: new Date().toISOString(), sims_per_order: SIMS, n_fights: res.length, wall_s: (Date.now() - t0) / 1000,
    rule: "lowest forward-chained RMSE of yearly log(KD/100 predicted / actual) over 2020-2023; the incumbent A_L730 is replaced only if the winner's RMSE <= 0.9 x A's and its per-fight KD deviance is not worse" }, cands: {} };
  for (const c of CANDS) {
    const Y = {}; for (const y of YEARS) Y[y] = { skd: 0, sh: 0, akd: 0, ah: 0, sko: 0, ako: 0, nko: 0 };
    for (const r of res) {
      const f = act.get(r.id), q = Y[r.y], x = r.c[c];
      if (f.actual && f.actual.A && f.actual.B) { q.skd += x.kd; q.sh += x.h; q.akd += f.actual.A.kd + f.actual.B.kd; q.ah += f.actual.A.h_lnd + f.actual.B.h_lnd; }
      const ka = koAct(f); if (ka != null) { q.sko += x.ko; q.ako += ka; q.nko++; }
    }
    const rows = {}, errs = [];
    let dev = 0;
    for (const y of YEARS) {
      const q = Y[y], simR = q.skd / q.sh, actR = q.akd / q.ah;
      const row = { sim_kd100_raw: 100 * simR, actual_kd100: 100 * actR, sim_ko: q.sko / q.nko, actual_ko: q.ako / q.nko };
      if (TEST.includes(y)) {
        let s1 = 0, s2 = 0; for (const z of YEARS) if (z < y) { s1 += Y[z].akd / Y[z].ah * Y[z].sh; s2 += Y[z].skd; }
        const scale = s1 / s2;   // pooled actual KD per head x sim head / sim KD over the fit years
        row.scale = scale; row.pred_kd100 = 100 * scale * simR; row.log_err = Math.log(scale * simR / actR); errs.push(row.log_err);
        for (const r of res) {
          if (r.y !== y) continue; const f = act.get(r.id); if (!(f.actual && f.actual.A && f.actual.B)) continue;
          const yk = f.actual.A.kd + f.actual.B.kd, mu = Math.max(1e-6, scale * r.c[c].kd);
          dev += 2 * ((yk > 0 ? yk * Math.log(yk / mu) : 0) - (yk - mu));
        }
      }
      rows[y] = row;
    }
    out.cands[c] = { by_year: rows, rmse: Math.sqrt(errs.reduce((a, b) => a + b * b, 0) / errs.length), err_2023: rows["2023"].log_err, dev_test: dev };
  }
  const A = out.cands.A_L730, best = CANDS.slice().sort((a, b) => out.cands[a].rmse - out.cands[b].rmse)[0];
  const ok = best !== "A_L730" && out.cands[best].rmse <= 0.9 * A.rmse && out.cands[best].dev_test <= A.dev_test;
  out.decision = { lowest_rmse: best, chosen: ok ? best : "A_L730", replaced_incumbent: ok };
  for (const c of CANDS) { const x = out.cands[c]; console.log(`${c.padEnd(11)} RMSE ${x.rmse.toFixed(4)}  2023 err ${x.err_2023 >= 0 ? "+" : ""}${x.err_2023.toFixed(4)}  test KD deviance ${x.dev_test.toFixed(1)}  | ` +
    TEST.map((y) => `${y} ${x.by_year[y].pred_kd100.toFixed(3)}/${x.by_year[y].actual_kd100.toFixed(3)}`).join("  ")); }
  console.log("decision:", JSON.stringify(out.decision));
  if (args.out) fs.writeFileSync(path.join(ROOT, args.out), JSON.stringify(out, null, 1));
});
