#!/usr/bin/env node
/* v10_explainer_check.js: the capability check of engine v10's explainer (FightEngine.showFight; docs/V6_V10_PLAN.md cycle 5
   "explainer coherence"), pre-declared in data/derived/v10/gate_protocol.json. Reads NO outcome: for train fights (2021-2023,
   every k-th) it builds the v10 package exactly as tools/predict_harness.js mode v10 does (leak-free learned rates, fold-honest
   embedding inputs, statlines targets, forward-chained ML v2 stack, S2 cells), calls predict() in the no-line regime, then
   showFight for S show seeds, and records how often the shown fight lands in the cell drawn from predict()'s cells (exact),
   on the drawn winner, and whether predict() is unchanged afterwards. Thresholds (protocol): exact >= 0.90, winner = 1.00,
   predict unchanged on every fight. A failed check turns components.explainer off; it never touches a scored number.
     nice -n 5 node tools/v10_explainer_check.js --engine-dir versions/v10 --every 8 --seeds 5 --out data/derived/v10/explainer_check.json */
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const args = {};
{ const a = process.argv.slice(2); for (let i = 0; i < a.length; i++) if (a[i].startsWith("--")) { const v = a[i + 1]; if (v == null || v.startsWith("--")) args[a[i].slice(2)] = true; else { args[a[i].slice(2)] = v; i++; } } }
const ED = path.resolve(ROOT, args["engine-dir"] || "versions/v10"), EVERY = +(args.every || 8), SEEDS = +(args.seeds || 5), SIMS = +(args.sims || 300);
const E = require(path.join(ED, "engine3.js"));
const J = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const bt = J("data/derived/backtest_dev.json"), keys = bt.meta.keys;
const fights = bt.fights.filter((f) => f.date >= "2021-01-01" && f.date < "2024-01-01").filter((_, i) => i % EVERY === 0);
for (const f of fights) { f.A.keys = keys; f.B.keys = keys; }
const priors = J("data/derived/mlcal_priors_asof.json"), OOF = J("data/derived/mlrates_oof_fh.json"), TG = J("data/derived/v8/statlines_targets.json").fights;
const rates = (a) => { const o = {}; OOF.meta.targets.forEach((n, i) => { o[n] = a[i]; }); return o; };
const XR = require(fs.existsSync(path.join(ED, "mlpathrec.js")) ? path.join(ED, "mlpathrec.js") : path.join(ROOT, "tools/mlpathrec.js"))(E, ROOT);
const STK = { "2021": "data/derived/v7/cmp_stack_v4pkg_fit2020.json", "2022": "data/derived/v7/cmp_stack_v4pkg_fit2021.json", "2023": "data/derived/v7/cmp_stack_v4pkg_fit2022.json" };
const PR = require(path.join(ROOT, "tools/predictrec.js"))(E, ROOT, { stacks: STK, v7: true, blendPath: path.relative(ROOT, path.join(ED, "ml", "blend.js")) });
let n = 0, exact = 0, win = 0, unchanged = 0, tries = 0, rows = 0, errs = 0;
const R0 = [];
for (const f of fights) {
  try {
    const o = { division: f.prior_division || f.division, rounds: f.rounds, title: f.title, date: f.date, priors: priors[f.date.slice(0, 4)] };
    const ent = OOF.fights[f.id];
    o.ml = ent && ent.A && ent.B ? { pred: { A: rates(ent.A), B: rates(ent.B) } } : false;
    const t = TG[f.id]; if (t && t.fold) o.statTargets = { A: t.A, B: t.B, fin: t.fin };
    XR.apply(o, f, false);
    const op = Object.assign({}, o, PR.opts(f, false, { lineKind: "none" }), { seed: 1, sims: SIMS, interval: false, propsOn: false });
    const pk = E.predict(f.A, f.B, op), k0 = JSON.stringify([pk.p, pk.cells]), R = pk.R;
    const side = (c) => (c === 4 * R + 2 ? 2 : (c === 4 * R ? 0 : (c === 4 * R + 1 ? 1 : (c < 2 * R ? 0 : 1))));
    let ex = 0, wn = 0;
    for (let s = 1; s <= SEEDS; s++) {
      const sf = E.showFight(f.A, f.B, Object.assign({}, op, { showSeed: s }), pk);
      rows++; tries += sf.tries;
      if (sf.coherent && sf.cell === sf.target) { exact++; ex++; }
      if (side(sf.cell) === side(sf.target)) { win++; wn++; }
    }
    const pk2 = E.predict(f.A, f.B, op);
    if (JSON.stringify([pk2.p, pk2.cells]) === k0) unchanged++;
    n++;
    R0.push({ id: f.id, exact: ex, winner: wn });
  } catch (e) { errs++; if (errs < 3) console.error(f.id, String(e.message).slice(0, 200)); }
}
const res = { tool: "tools/v10_explainer_check.js", engine: E.VERSION, params: E.params().version, fights: n, show_rows: rows, errors: errs,
  exact_rate: +(exact / rows).toFixed(4), winner_rate: +(win / rows).toFixed(4), predict_unchanged: unchanged, mean_tries: +(tries / rows).toFixed(2),
  thresholds: { exact_rate: ">= 0.90", winner_rate: "= 1.00", predict_unchanged: "every fight" },
  pass: errs === 0 && exact / rows >= 0.9 && win === rows && unchanged === n, note: "reads no outcome; capability check only", rows: R0 };
console.log(JSON.stringify(Object.assign({}, res, { rows: undefined })));
if (args.out) fs.writeFileSync(path.resolve(ROOT, args.out), JSON.stringify(res, null, 1));
