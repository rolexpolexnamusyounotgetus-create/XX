/* mlcal hook for engine v4: play the learned stat-line rates natively (FightEngine.matchup opts.ml = { pred }) while
   tools/mlcal.py tunes the engine on TRAIN fights.

   Leakage: rates come from data/derived/mlrates_oof.json (2019-2023: time-ordered folds trained on 2010..year-1;
   2024-2025: the dev model trained 2010-2023), so a 2019-2023 tuning window never sees an in-sample ML prediction.
   A fight missing from that table runs on the base tables (opts.ml = false) and is counted in stats().
   Symmetric: each corner's rates are that fighter attacking the other; ctx.swap flips them with the corners.
   Spec: { "hook": "tools/mlcal_hooks/ml_oof_v4.js", ... }. Hook parameter hook.ml_off = 1 turns the rates off (ablation). */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
let OOF = null;
const counts = { oof: 0, missing: 0 };
function rates(arr, names) { const o = {}; names.forEach((n, i) => { o[n] = arr[i]; }); return o; }
module.exports = {
  matchupOpts(opts, ctx) {
    const hp = ctx.hookParams || {};
    if (hp.ml_off) return Object.assign({}, opts, { ml: false });
    if (!OOF) OOF = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", "mlrates_oof.json"), "utf8"));
    const f = ctx.fight || {};
    const ent = f.id ? OOF.fights[f.id] : null;
    if (!ent || !ent.A || !ent.B) { counts.missing++; return Object.assign({}, opts, { ml: false }); }
    counts.oof++;
    const names = OOF.meta.targets, rA = rates(ent.A, names), rB = rates(ent.B, names);
    return Object.assign({}, opts, { ml: { pred: ctx.swap ? { A: rB, B: rA } : { A: rA, B: rB } } });
  },
  stats() { return Object.assign({}, counts); }
};
