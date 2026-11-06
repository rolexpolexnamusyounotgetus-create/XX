/* mlcal hook: play the learned matchup stat-line rates (mlrates) inside engine v3 while tools/mlcal.py tunes the
   engine, with a tunable blend weight.

   Spec: { "hook": "tools/mlrates_mlcal_hook.js", "tune": [ {"path": "hook.w_ml", "value": 1, "lo": 0, "hi": 1,
           "log": false}, ...engine parameters... ] }

   Leakage: for 2019-2025 fights the rates come from data/derived/mlrates_oof.json (2019-2023: time-ordered CV folds
   trained only on earlier years; 2024-2025: the dev model trained 2010-2023), so tuning on 2019-2023 never sees an
   in-sample ML prediction. Fights missing from that table use data/derived/mlrates.json (production, trained
   2010-2025) when dated 2026-01-01 or later, else mlrates_dev.json (flagged in-sample; counted in stats()).

   mlcal's hook interface only edits the matchup options, so on first use this module wraps the engine's
   matchup() (the same module object the worker required) to apply MLRates.applyToMatchup() whenever the
   options carry __mlrates. Symmetric: each corner's rates are that fighter's attacking rates vs the other. */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const ML = require(path.join(ROOT, "src", "ml", "mlrates.js"));

let OOF = null, DEV = null, PROD = null, patched = null;
const counts = { oof: 0, dev_val: 0, prod: 0, insample: 0, none: 0 };

function load(name) { return JSON.parse(fs.readFileSync(path.join(ROOT, "data", "derived", name), "utf8")); }
function engineModule() {
  for (const k of Object.keys(require.cache)) {
    const ex = require.cache[k] && require.cache[k].exports;
    if (ex && typeof ex.matchup === "function" && typeof ex.simulate === "function" && typeof ex.occupancy === "function") return ex;
  }
  return null;
}
function patch() {
  const E = engineModule();
  if (!E || E === patched) return E;
  if (!E.__mlratesOrig) {
    const orig = E.matchup;
    E.__mlratesOrig = orig;
    E.matchup = function (a, b, o) {
      const m = orig.call(this, a, b, o);
      const x = o && o.__mlrates;
      if (x && x.pred) ML.applyToMatchup(m, x.pred, { engine: E, weight: x.w, model: x.model });
      return m;
    };
  }
  patched = E;
  return E;
}
function rates(arr, names) { const o = {}; names.forEach((n, i) => { o[n] = arr[i]; }); return o; }

module.exports = {
  matchupOpts(opts, ctx) {
    const hp = ctx.hookParams || {};
    const w = hp.w_ml == null ? 1 : +hp.w_ml;
    if (!(w > 0)) return opts;
    patch();
    if (!OOF) OOF = load("mlrates_oof.json");
    const f = ctx.fight || {};
    const priors = opts.priors;
    if (!priors) return opts;
    const div = opts.division || f.prior_division || f.division;
    const P = ML.priorFor(div, priors);
    let pred = null, model = null;
    const ent = f.id ? OOF.fights[f.id] : null;
    if (ent && ent.A && ent.B) {
      if (!DEV) DEV = ML.load(load("mlrates_dev.json"));
      model = DEV;
      const names = OOF.meta.targets;
      const rA = rates(ent.A, names), rB = rates(ent.B, names);
      pred = ctx.swap ? { A: rB, B: rA } : { A: rA, B: rB };
      pred.base = names.map((t) => { const v = P[ML.BASE_KEY[t]]; return v == null ? 0 : +v; });
      counts[ent.src === "dev" ? "dev_val" : "oof"]++;
    } else {
      const late = String(f.date || "") >= "2026-01-01";
      if (late) { if (!PROD) PROD = ML.load(load("mlrates.json")); model = PROD; counts.prod++; }
      else { if (!DEV) DEV = ML.load(load("mlrates_dev.json")); model = DEV; counts.insample++; }
      const year = f.year || +String(f.date || "").slice(0, 4);
      pred = ML.predict(model, ctx.A, ctx.B, { division: f.division || div, prior_division: div, rounds: opts.rounds,
        title: opts.title, year: year, date: f.date, priors: priors });
    }
    return Object.assign({}, opts, { __mlrates: { pred: pred, w: Math.min(1, w), model: model } });
  },
  stats() { return Object.assign({}, counts); }
};
