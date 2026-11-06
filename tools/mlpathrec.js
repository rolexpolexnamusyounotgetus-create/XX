/* mlpathrec.js: leak-free per-fight inputs for the engine v5 merge step-4 components in backtest tools
   (params.components.embed, .oppadj, .preufc; docs/CHANGELOG.md "v5 merge log", step 4).

   Each of these components is a no-op until a caller passes its input (the engine never reads a roster table for a bout
   dated before the table's as-of date), so a backtest tool must pass them or the component silently stays off:
     embed   opts.embed = { etaA, etaB, recipe }: the embedding task predictors of research/model_embed.md for A attacking B
             and B attacking A, from the walk-forward snapshot vectors of data/derived/embed.json snapshots[id] (fit on every
             UFC fight before the bout) with the matrices of the snapshot's quarterly refit (quarters[q]); division = the
             fight's division if the embedding model knows it, else its prior division, else Lightweight (as tools/embed.py
             build_table); era and five-round flag from the fight. The blend coefficients:
               - fights dated before 2024-01-01 (train): data/derived/embed_blend_loyo.json coef_loyo[year], the recipe refit
                 without that year (leave-one-year-out; the exported recipe is fit on all 2019-2023 out-of-fold rows, so it
                 would be in-sample on train) by tools/embed_blend_loyo.py;
               - fights dated 2024-01-01..2025-12-31: embed_model.json mlrates_blend.targets (the exported recipe, fit on
                 2019-2023; = params.embed.recipe).
     oppadj  opts.oppadj = { A, B }: the walk-forward pre-fight factors of data/derived/oppadj.json snapshots[id] (tools/oppadj.py;
             each fit uses only fights strictly before the bout).
     preufc  opts.preufc = { A, B }: each side's non-UFC pro record before the bout from data/derived/preufc.json
             fighters[slug].snapshots (tools/preufc.py; Sherdog, record entering the bout) as { n, ko_w, sub_w, ko_l, n_ufc },
             for sides with at most params.preufc.maxUfc prior UFC fights (others pass null: the engine gates them out anyway).
   A/B are given in backtest_dev's order and swapped here together with the corners. Fights dated 2026-01-01 or later are
   refused (hidden-data protocol); so is a fight without its snapshot (never a silent neutral run).

     const XR = require("./mlpathrec.js")(E, ROOT);
     XR.apply(opts, f, swap, params);   // sets opts.embed / opts.oppadj / opts.preufc for each step-4 component that is on
     const m = E.matchup(A, B, opts);   XR.assertApplied(m, f.id, params);

   CLI (used once by tools/embed_blend_loyo.py; train fights only):
     node tools/mlpathrec.js --dump-embed-train <out.json>   ->  { id: { date, year, etaA, etaB } } for 2019-2023 backtest fights */
"use strict";
const fs = require("fs");
const path = require("path");

const VAULT_FROM = "2026-01-01", VAL_FROM = "2024-01-01";

module.exports = function mlpathrec(E, root) {
  root = root || path.resolve(__dirname, "..");
  const J = {};
  const rd = (rel) => {
    if (!J[rel]) {
      const a = path.join(root, rel);
      J[rel] = JSON.parse(fs.readFileSync(fs.existsSync(a) ? a : path.join(path.resolve(__dirname, ".."), rel), "utf8"));
    }
    return J[rel];
  };
  function guardDate(d, what) {
    d = String(d || "");
    if (!d) throw new Error(what + ": fight without a date");
    if (d >= VAULT_FROM) throw new Error(what + ": refusing a fight dated " + d + " (hidden-data protocol)");
    return d;
  }
  function flags(params) {
    const p = typeof E.resolveParams === "function" ? E.resolveParams(params || {}) : null;
    const c = (p && p.components) || {};
    return { embed: !!c.embed, oppadj: !!c.oppadj, preufc: !!c.preufc, p: p };
  }

  // ---------------------------------------------------------------- embed
  let FEmb = null;
  const qModels = new Map();
  function embModule() {
    if (!FEmb) FEmb = require(path.join(path.resolve(__dirname, ".."), "src/ml/embed.js"));
    return FEmb;
  }
  function quarterModel(q) {
    if (qModels.has(q)) return qModels.get(q);
    const EJ = rd("data/derived/embed.json"), M = EJ.model, Q = EJ.quarters[q];
    if (!Q) throw new Error("embed: no quarterly refit " + q);
    const h = embModule().load({ K: M.K, tasks: M.tasks, divs: M.divs, default_division: "Lightweight", era_date: "2026-01-01",
      C: Q.C, W: Q.W, V: Q.V, ua: Q.ua, ud: Q.ud, M: Q.M, roster: {} });
    qModels.set(q, h);
    return h;
  }
  function embedDivision(f) {
    const divs = rd("data/derived/embed.json").model.divs;
    if (divs.indexOf(f.division) >= 0) return f.division;
    if (f.prior_division && divs.indexOf(f.prior_division) >= 0) return f.prior_division;
    return "Lightweight";
  }
  // task predictors in backtest_dev's corner order (A attacking B, B attacking A)
  function embedEtas(f) {
    guardDate(f.date, "embed");
    const s = rd("data/derived/embed.json").snapshots[f.id];
    if (!s || !s.A || !s.B) throw new Error("embed: no walk-forward snapshot for fight " + f.id + " (refusing a neutral run)");
    const h = quarterModel(s.q), div = embedDivision(f), o = { date: f.date, rounds: f.rounds };
    return { etaA: h.eta(s.A, s.B, div, o), etaB: h.eta(s.B, s.A, div, o), q: s.q, division: div };
  }
  function embedRecipe(date) {
    const d = guardDate(date, "embed");
    if (d < VAL_FROM) {
      const L = rd("data/derived/embed_blend_loyo.json").coef_loyo, y = d.slice(0, 4);
      if (!L || !L[y]) throw new Error("embed: no leave-one-year-out blend coefficients for " + y + " (run tools/embed_blend_loyo.py)");
      return L[y];
    }
    return rd("data/derived/embed_model.json").mlrates_blend.targets;
  }
  function embedFor(f, swap) {
    const e = embedEtas(f), recipe = embedRecipe(f.date);
    return swap ? { etaA: e.etaB, etaB: e.etaA, recipe } : { etaA: e.etaA, etaB: e.etaB, recipe };
  }

  // ---------------------------------------------------------------- oppadj
  function oppadjFor(f, swap) {
    guardDate(f.date, "oppadj");
    const s = rd("data/derived/oppadj.json").snapshots[f.id];
    if (!s || !s.A || !s.B) throw new Error("oppadj: no walk-forward factors for fight " + f.id + " (refusing a neutral run)");
    return swap ? { A: s.B, B: s.A } : { A: s.A, B: s.B };
  }

  // ---------------------------------------------------------------- preufc
  let preIdx = null;
  function preIndex() {
    if (preIdx) return preIdx;
    const P = rd("data/derived/preufc.json"), cols = P.meta.snapshot_columns, ci = {};
    cols.forEach((c, i) => { ci[c] = i; });
    preIdx = new Map();
    for (const slug in P.fighters) {
      for (const row of P.fighters[slug].snapshots || []) {
        if (String(row[ci.date]) >= VAULT_FROM) continue;   // never index a vault-dated row
        preIdx.set(slug + "|" + row[ci.fid], { n: +row[ci.n] || 0, ko_w: +row[ci.ko_w] || 0, sub_w: +row[ci.sub_w] || 0,
          ko_l: +row[ci.ko_l] || 0, n_ufc: +row[ci.n_ufc_prior] || 0, date: row[ci.date] });
      }
    }
    return preIdx;
  }
  function preufcSide(f, side, maxUfc) {
    const sd = f[side];
    if (!sd || sd.n == null || +sd.n > maxUfc) return null;          // veterans: gated out by the engine anyway
    const r = preIndex().get(sd.slug + "|" + f.id);
    if (!r) throw new Error("preufc: no pre-UFC snapshot for " + sd.slug + " in fight " + f.id + " (refusing a neutral run)");
    if (r.n_ufc !== +sd.n) throw new Error("preufc: UFC fight count mismatch for " + sd.slug + " in " + f.id + " (" + r.n_ufc + " vs " + sd.n + ")");
    return { n: r.n, ko_w: r.ko_w, sub_w: r.sub_w, ko_l: r.ko_l, n_ufc: r.n_ufc };
  }
  function preufcFor(f, swap, p) {
    guardDate(f.date, "preufc");
    const mx = p && p.preufc && p.preufc.maxUfc != null ? +p.preufc.maxUfc : 3;
    const a = preufcSide(f, "A", mx), b = preufcSide(f, "B", mx);
    return swap ? { A: b, B: a } : { A: a, B: b };
  }

  // ---------------------------------------------------------------- harness API
  function apply(opts, f, swap, params) {
    const fl = flags(params !== undefined ? params : opts.params);
    if (fl.embed) opts.embed = embedFor(f, !!swap);
    if (fl.oppadj) opts.oppadj = oppadjFor(f, !!swap);
    if (fl.preufc) opts.preufc = preufcFor(f, !!swap, fl.p);
    return opts;
  }
  function assertApplied(m, id, params) {
    const fl = flags(params !== undefined ? params : (m.opts && m.opts.params));
    if (fl.embed && m.mlApplied && !(m.embed && m.embed.src === "opts")) throw new Error("embed: walk-forward etas not applied for " + id);
    if (fl.oppadj && m.mlApplied && !(m.oppadj && m.oppadj.have && m.oppadj.have[0] && m.oppadj.have[1])) throw new Error("oppadj: walk-forward factors not applied for " + id);
    if (fl.preufc && !m.preufc) throw new Error("preufc: component did not run for " + id);
  }
  return { flags, apply, assertApplied, embedFor, embedEtas, embedRecipe, oppadjFor, preufcFor, table: rd };
};

// ---------------------------------------------------------------- CLI: dump train etas for tools/embed_blend_loyo.py
if (require.main === module) {
  const args = process.argv.slice(2);
  const i = args.indexOf("--dump-embed-train");
  if (i < 0 || !args[i + 1]) { console.error("usage: node tools/mlpathrec.js --dump-embed-train <out.json>"); process.exit(2); }
  const ROOT = path.resolve(__dirname, "..");
  const X = module.exports({ resolveParams: () => ({ components: {} }) }, ROOT);
  const bt = JSON.parse(fs.readFileSync(path.join(ROOT, "data/derived/backtest_dev.json"), "utf8"));
  const out = {};
  let n = 0;
  for (const f of bt.fights) {
    if (!(f.date >= "2019-01-01" && f.date < VAL_FROM)) continue;     // train years only
    const e = X.embedEtas(f);
    out[f.id] = { date: f.date, year: +f.date.slice(0, 4), q: e.q, division: e.division, etaA: e.etaA, etaB: e.etaB };
    n++;
  }
  fs.writeFileSync(args[i + 1], JSON.stringify({ meta: { tasks: X.table("data/derived/embed.json").model.tasks.map((t) => t[0]),
    note: "embedding task predictors for 2019-2023 backtest_dev fights (tools/mlpathrec.js embedEtas)" }, fights: out }));
  console.log("wrote " + n + " train fights to " + args[i + 1]);
}
