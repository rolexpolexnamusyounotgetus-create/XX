#!/usr/bin/env node
/* VAULT AUDIT 2 (auditor only): per-fight retarget targets (engine components.retarget, v8 / v10) for the sealed 2026 fights,
   computed exactly as tools/v8_targets.js does, from the statlines table fit through 2025-12-31 (data/derived/statlines.json
   models.prod, fit 2019-01-01..2025-12-31 by statlines' own production refit; deployment, never scored on 2024-25) instead of the
   forward-chained fold tables (2019-2023 'dev' for 2024-25).

     node tools/vault_audit2/targets_vault.js [--vault <dir>]  ->  <vault>/audit2/statlines_targets_vault.json

   Inputs per fight (backtest_vault orientation, A attacking B / B attacking A), the statlines row inputs with the 2026 analogue of
   each source (no 2026 result is in any fit):
     mlA / mlB    learned rates of the production mlrates.json (fit 2010-2025): <vault>/audit1/mlrates_vault.json (audit 1's build)
     etaA / etaB  the production embedding exported at 2026-01-01 (embed_model.json; embed.json's walk-forward snapshots stop
                  before 2026); a fighter without a 2026-01-01 vector gets embed.js's zero vector; hasEmb = true (every 2019-2025 row
                  had a snapshot)
     winLogit     the embedding win head on the same vectors (embed.js winLogit)
     oppA / oppB  data/derived/oppadj.json walk-forward pre-fight snapshots (GLM_OPPADJ keys)
   Checks (printed and stored): (1) the code path reproduces data/derived/v8/statlines_targets.json from
   data/derived/v8/statlines_inputs.json with the 'dev' / fold tables on 300 stored 2024-25 and train fights (max relative
   difference); (2) embed.js winLogit / eta on embed.json's own snapshot vectors and quarter matrices reproduce the stored snapshot
   win_logit for 2025 fights. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const args = process.argv.slice(2);
const vi = args.indexOf("--vault");
const VAULT = vi >= 0 ? args[vi + 1] : "/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault";
const AUD = path.join(VAULT, "audit2");
const J = (p) => JSON.parse(fs.readFileSync(path.isAbsolute(p) ? p : path.join(ROOT, p), "utf8"));
const SD0 = require(path.join(ROOT, "versions/v10-rejected/ml/statdist.js"));
const EMB = require(path.join(ROOT, "versions/v10-rejected/ml/embed.js"));
const GRID = { 3: [0.5, 1, 2, 3.5, 5, 7, 9, 11, 13, 14.9], 5: [0.5, 1, 2, 3.5, 5, 7.5, 10, 13, 16, 19, 22, 24.9] };
const FIN_ST = ["d_att", "c_att", "g_att", "d_lnd", "c_lnd", "g_lnd", "h_att", "b_att", "l_att", "h_lnd", "b_lnd", "l_lnd", "td_att", "ctrl", "td_lnd"];
const GLM_OPPADJ = ["dAtt", "cAtt", "gAtt", "tdAtt", "ctrl", "dAttAg", "cAttAg", "gAttAg", "tdAttAg", "octrl"];
const r6 = (x) => Math.round(x * 1e6) / 1e6, g5 = (x) => +x.toPrecision(6);
function targetsFor(SD, v) {
  const R = v.rounds === 5 ? 5 : 3;
  const P = SD.prepare({ mlA: v.mlA, mlB: v.mlB, etaA: v.etaA, etaB: v.etaB, hasEmb: v.hasEmb, winLogit: v.winLogit, oppA: v.oppA, oppB: v.oppB, rounds: v.rounds });
  const T = SD.engineTargets(P, 5 * R);
  T.fin = { t: GRID[R], A: {}, B: {} };
  for (const s of ["A", "B"]) for (const k of FIN_ST) T.fin[s][k] = GRID[R].map((t) => P.dist(s, k, t).mean);
  return T;
}
function pack(v, T) {
  const o = { date: v.date, fold: v.fold, rounds: v.rounds, A: {}, B: {}, fin: { t: T.fin.t, A: {}, B: {} } };
  for (const s of ["A", "B"]) for (const k in T[s]) o[s][k] = r6(T[s][k]);
  for (const s of ["A", "B"]) for (const k in T.fin[s]) o.fin[s][k] = T.fin[s][k].map(g5);
  return o;
}
// ---------------- check 1: reproduce the stored targets from the stored inputs (fold tables)
const FOLDS = J("data/derived/v8/statlines_folds.json"), INP = J("data/derived/v8/statlines_inputs.json"), TGS = J("data/derived/v8/statlines_targets.json").fights;
const hs = {};
let worst = 0, nchk = 0;
const ids = Object.keys(INP.fights).filter((id) => INP.fights[id].fold).filter((_, i) => i % 9 === 0).slice(0, 300);
for (const id of ids) {
  const v = INP.fights[id];
  if (!hs[v.fold]) hs[v.fold] = SD0.load(FOLDS, { which: v.fold, enable: true });
  const o = pack(v, targetsFor(hs[v.fold], v)), ref = TGS[id];
  for (const s of ["A", "B"]) for (const k in ref[s]) { worst = Math.max(worst, Math.abs(o[s][k] - ref[s][k]) / Math.max(1e-6, Math.abs(ref[s][k]))); nchk++; }
  for (const s of ["A", "B"]) for (const k in ref.fin[s]) ref.fin[s][k].forEach((x, i) => { worst = Math.max(worst, Math.abs(o.fin[s][k][i] - x) / Math.max(1e-6, Math.abs(x))); nchk++; });
}
console.log(`check 1: stored targets reproduced from stored inputs on ${ids.length} fights (${nchk} values): max rel diff ${worst.toExponential(2)}`);
// ---------------- check 2: embed.js win logit on snapshot vectors = stored snapshot win_logit (2025 fights)
const EJ = J("data/derived/embed.json"), M = EJ.model;
let wmax = 0, nw = 0;
for (const [id, s] of Object.entries(EJ.snapshots)) {
  if (nw >= 200 || !s || !s.A || !(String(s.date || "") >= "2025-01-01" || (TGS[id] && TGS[id].date >= "2025-01-01"))) continue;
  const Q = EJ.quarters[s.q];
  const h = EMB.load({ K: M.K, tasks: M.tasks, divs: M.divs, default_division: "Lightweight", era_date: "2026-01-01", C: Q.C, W: Q.W, V: Q.V, ua: Q.ua, ud: Q.ud, M: Q.M, roster: {} });
  if (typeof s.win_logit !== "number") continue;
  wmax = Math.max(wmax, Math.abs(h.winLogit(s.A, s.B) - s.win_logit)); nw++;
}
console.log(`check 2: embed.js winLogit vs stored snapshot win_logit on ${nw} 2025 fights: max abs diff ${wmax.toExponential(2)}`);
// ---------------- vault
const SDP = SD0.load(J("data/derived/statlines.json"), { which: "prod", enable: true });
const EM = J("data/derived/embed_model.json"), H = EMB.load(EM);
const MLV = J(path.join(VAULT, "audit1", "mlrates_vault.json"));
if (JSON.stringify(MLV.meta.targets) !== JSON.stringify(J("data/derived/statlines.json").mlrates_targets)) throw new Error("mlrates target order differs from statlines'");
const OPP = J("data/derived/oppadj.json").snapshots;
const BT = J(path.join(VAULT, "backtest_vault.json")).fights;
const divs = EM.divs;
const out = {}, miss = new Set(), errs = [];
for (const f of BT) {
  try {
    const ml = MLV.fights[f.id];
    if (!ml || !ml.A || !ml.B) throw new Error("no learned rates");
    const o = OPP[f.id];
    if (!o || !o.A || !o.B) throw new Error("no oppadj snapshot");
    for (const s of ["A", "B"]) if (!EM.roster[f[s].slug]) miss.add(f[s].slug);
    const div = divs.indexOf(f.division) >= 0 ? f.division : (f.prior_division && divs.indexOf(f.prior_division) >= 0 ? f.prior_division : "Lightweight");
    const eo = { date: f.date, rounds: f.rounds };
    const opp = (x) => { const r = {}; for (const k of GLM_OPPADJ) r[k] = x[k] == null ? 1.0 : +x[k]; return r; };
    const v = { date: f.date, fold: "prod", rounds: f.rounds, mlA: ml.A, mlB: ml.B, etaA: H.eta(f.A.slug, f.B.slug, div, eo), etaB: H.eta(f.B.slug, f.A.slug, div, eo),
      hasEmb: true, winLogit: H.winLogit(f.A.slug, f.B.slug), oppA: opp(o.A), oppB: opp(o.B) };
    out[f.id] = pack(v, targetsFor(SDP, v));
  } catch (e) { errs.push([f.id, String(e.message)]); }
}
fs.mkdirSync(AUD, { recursive: true });
fs.writeFileSync(path.join(AUD, "statlines_targets_vault.json"), JSON.stringify({
  meta: { tool: "tools/vault_audit2/targets_vault.js", built: new Date().toISOString(), table: "data/derived/statlines.json models.prod (fit 2019-01-01..2025-12-31)",
    evaluator: "versions/v10-rejected/ml/statdist.js (= src/ml/statdist.js) engineTargets(P, 5R) + fin grid, as tools/v8_targets.js",
    inputs: "mlrates_vault (production mlrates fit 2010-2025), embed_model.json 2026-01-01 etas + win logit, oppadj.json snapshots",
    check_stored_targets_max_rel: worst, check_stored_n: nchk, check_winlogit_max_abs: wmax, check_winlogit_n: nw,
    missing_embeddings: [...miss], errors: errs, n: Object.keys(out).length },
  fights: out }));
console.log(`targets: ${Object.keys(out).length} vault fights, ${errs.length} errors, ${miss.size} sides without a 2026-01-01 embedding -> ${path.join(AUD, "statlines_targets_vault.json")}`);
if (errs.length) console.log(errs.slice(0, 5));
