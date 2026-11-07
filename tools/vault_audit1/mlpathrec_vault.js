/* VAULT AUDIT 1 (auditor only): step-4 engine inputs (components.embed / .oppadj / .preufc) for the sealed 2026 fights,
   with the API of tools/mlpathrec.js (flags / apply / assertApplied). Used only by tools/vault_audit1/evalv_vault.js.

   Frozen production procedure for a bout after 2026-01-01 (no fit uses a 2026 fight):
     embed   the production embedding exported at 2026-01-01 (data/derived/embed_model.json: loadings and fighter vectors fit
             on every UFC fight through 2025-12-13, tools/embed.py roster export), evaluated by the frozen engine's own
             ml/embed.js exactly as the page does (embed.eta(slugA, slugB, division, {date, rounds}); a fighter without a
             2026-01-01 embedding gets embed.js's zero vector, its documented behaviour). Recipe: embed_model.json
             mlrates_blend.targets (the 2019-2023 fit; what 2024-25 used). Division rule as tools/mlpathrec.js.
     oppadj  data/derived/oppadj.json snapshots (walk-forward pre-fight factors; off in v5 / v5.0.1).
     preufc  data/derived/preufc.json pre-bout Sherdog records (record entering the bout), as tools/mlpathrec.js, but 2026 rows
             are indexed (the vault is open for this audit). */
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = function mlpathrecVault(E, root) {
  root = root || path.resolve(__dirname, "..", "..");
  const J = {};
  const rd = (rel) => { if (!J[rel]) J[rel] = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); return J[rel]; };
  function flags(params) {
    const p = typeof E.resolveParams === "function" ? E.resolveParams(params || {}) : null;
    const c = (p && p.components) || {};
    return { embed: !!c.embed, oppadj: !!c.oppadj, preufc: !!c.preufc, p: p };
  }
  let EH = null;
  function embHandle() {
    if (EH) return EH;
    const dir = process.env.VAUDIT_ENGINE_DIR;
    const own = dir ? path.join(dir, "ml", "embed.js") : null;
    const lib = require(own && fs.existsSync(own) ? own : path.join(root, "src/ml/embed.js"));
    EH = { lib: lib, h: lib.load(rd("data/derived/embed_model.json")), src: own && fs.existsSync(own) ? own : "src/ml/embed.js" };
    return EH;
  }
  function embedDivision(f) {
    const divs = rd("data/derived/embed_model.json").divs;
    if (divs.indexOf(f.division) >= 0) return f.division;
    if (f.prior_division && divs.indexOf(f.prior_division) >= 0) return f.prior_division;
    return "Lightweight";
  }
  const missing = new Set();
  function embedFor(f, swap) {
    if (!(f.date >= "2026-01-01")) throw new Error("mlpathrec_vault: vault fights only (got " + f.date + ")");
    const R = rd("data/derived/embed_model.json").roster;
    for (const s of ["A", "B"]) if (!R[f[s].slug]) missing.add(f[s].slug);
    const h = embHandle().h, div = embedDivision(f), o = { date: f.date, rounds: f.rounds };
    const etaA = h.eta(f.A.slug, f.B.slug, div, o), etaB = h.eta(f.B.slug, f.A.slug, div, o);
    const recipe = rd("data/derived/embed_model.json").mlrates_blend.targets;
    return swap ? { etaA: etaB, etaB: etaA, recipe } : { etaA, etaB, recipe };
  }
  function oppadjFor(f, swap) {
    const s = rd("data/derived/oppadj.json").snapshots[f.id];
    if (!s || !s.A || !s.B) throw new Error("oppadj: no walk-forward factors for fight " + f.id);
    return swap ? { A: s.B, B: s.A } : { A: s.A, B: s.B };
  }
  let preIdx = null;
  function preIndex() {
    if (preIdx) return preIdx;
    const P = rd("data/derived/preufc.json"), cols = P.meta.snapshot_columns, ci = {};
    cols.forEach((c, i) => { ci[c] = i; });
    preIdx = new Map();
    for (const slug in P.fighters) for (const row of P.fighters[slug].snapshots || []) {
      preIdx.set(slug + "|" + row[ci.fid], { n: +row[ci.n] || 0, ko_w: +row[ci.ko_w] || 0, sub_w: +row[ci.sub_w] || 0,
        ko_l: +row[ci.ko_l] || 0, n_ufc: +row[ci.n_ufc_prior] || 0, date: row[ci.date] });
    }
    return preIdx;
  }
  function preufcSide(f, side, maxUfc) {
    const sd = f[side];
    if (!sd || sd.n == null || +sd.n > maxUfc) return null;
    const r = preIndex().get(sd.slug + "|" + f.id);
    if (!r) throw new Error("preufc: no pre-UFC snapshot for " + sd.slug + " in fight " + f.id + " (refusing a neutral run)");
    if (r.n_ufc !== +sd.n) throw new Error("preufc: UFC fight count mismatch for " + sd.slug + " in " + f.id + " (" + r.n_ufc + " vs " + sd.n + ")");
    return { n: r.n, ko_w: r.ko_w, sub_w: r.sub_w, ko_l: r.ko_l, n_ufc: r.n_ufc };
  }
  function preufcFor(f, swap, p) {
    const mx = p && p.preufc && p.preufc.maxUfc != null ? +p.preufc.maxUfc : 3;
    const a = preufcSide(f, "A", mx), b = preufcSide(f, "B", mx);
    return swap ? { A: b, B: a } : { A: a, B: b };
  }
  function apply(opts, f, swap, params) {
    const fl = flags(params !== undefined ? params : opts.params);
    if (fl.embed) opts.embed = embedFor(f, !!swap);
    if (fl.oppadj) opts.oppadj = oppadjFor(f, !!swap);
    if (fl.preufc) opts.preufc = preufcFor(f, !!swap, fl.p);
    return opts;
  }
  function assertApplied(m, id, params) {
    const fl = flags(params !== undefined ? params : (m.opts && m.opts.params));
    if (fl.embed && m.mlApplied && !(m.embed && m.embed.src === "opts")) throw new Error("embed: etas not applied for " + id);
    if (fl.oppadj && m.mlApplied && !(m.oppadj && m.oppadj.have && m.oppadj.have[0] && m.oppadj.have[1])) throw new Error("oppadj: factors not applied for " + id);
    if (fl.preufc && !m.preufc) throw new Error("preufc: component did not run for " + id);
  }
  return { flags, apply, assertApplied, embedFor, oppadjFor, preufcFor, missingEmbeddings: () => [...missing], table: rd };
};
