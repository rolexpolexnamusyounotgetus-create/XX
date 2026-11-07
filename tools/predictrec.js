/* predictrec.js: leak-free backtest inputs for FightEngine.predict (engine component blend_anchor, v5 merge step 5).

   FightEngine.predict's production defaults are fit on data a backtest must not see: the exported stack
   data/derived/blindtest_stack.json is fit through 2025, the method/round model S (methodround.json js_model) through
   2026-10, and the live rosters (ML page model, ML v2, market ratings, fighters.json) run through the snapshot. With
   opts.backtest = true predict refuses all of them; this helper builds what it needs instead, per backtest fight and
   corner order (A/B in backtest_dev.json's order, swapped here together with the corners):

     stack     a stacker fit on 2023 or earlier: data/derived/blindtest_stack_pre2024.json
               (python3 tools/blindtest.py export --fit-through 2023-12-31: the production stackers' configuration and
               expert map, fit on 2019-2023 out-of-sample expert rows only, with `model` and `model_open`)
     lineKind  'close' (market.json p_power_close, the close-trained block), 'open' (p_novig_open, the open-trained block)
               or 'none'
     experts   walk-forward expert probabilities in the stack's expert names:
                 2019-2023: ml / elo_sig = ml.json rows marked oof (annual expanding refits), feat_lr / elo =
                            blend_anchor_dev.json (expanding-window OOF feature LR, snapshot Elo), mkt_rating = market.json
                            p_market_rating (walk-forward Kalman): the rows the backtest stacker was fit on;
                 2024-2025: the blind replay's walk-forward predictions (blindtest.json fights[id].p: ml_lr, elo_sig,
                            feat_lr, elo, mkt_rating; each refit strictly before its card, fit_through checked here).
               engine is left out: predict plays the simulator itself (both corner orders).
     mrCells   walk-forward method/round cells: methodround.json fights[id].S (SM with a closing line), fit through
               Dec 31 of the year before the fight (2023-12-31 for 2024-2025), mirrored for the swapped order
     ml2       ML v2 next to the stack: ml2.json fights[id] { pA: ml2_lr, pMR: mr } (OOF 2019-2023, static fit < 2024 for
               2024-2025) with the page stacks' 2019-2023 weights (forward_models.json ml2_static)

   Train fights (before 2024): the pre-2024 stacker contains them, so predict refuses it unless the caller says so
   (cfg.inSample = true -> opts.inSample, flagged in predict's output) or passes per-year stackers (cfg.stacks =
   { "2021": doc, ... }, each fit before that year: tools/blindtest.py export --fit-through 2020-12-31 ...).
   Fights dated 2026-01-01 or later are refused (vault), and so is a fight missing from backtest_dev.json.

     const PR = require("./predictrec.js")(E, ROOT[, cfg]);
     Object.assign(opts, PR.opts(f, swap, { lineKind: "close" }));       // f = backtest_dev fight; swap = corners swapped
     const pkg = E.predict(A, B, opts);                                     // opts.backtest = true is set by PR.opts
*/
"use strict";
const fs = require("fs");
const path = require("path");

module.exports = function predictrec(E, root, cfg) {
  cfg = cfg || {};
  const ROOT = root || path.join(__dirname, "..");
  const VAULT = "2026-01-01", VALID = "2024-01-01";
  const cache = {};
  function J(rel) {
    if (!(rel in cache)) cache[rel] = JSON.parse(fs.readFileSync(path.isAbsolute(rel) ? rel : path.join(ROOT, rel), "utf8"));
    return cache[rel];
  }
  const isNum = (x) => typeof x === "number" && isFinite(x);
  const STACK_PATH = cfg.stack || "data/derived/blindtest_stack_pre2024.json";
  function guardDate(d) {
    if (!d || d >= VAULT) throw new Error("predictrec: fights dated " + VAULT + " or later are sealed (vault), got " + d);
  }
  function stackFor(date) {
    const yr = date.slice(0, 4);
    if (cfg.stacks && cfg.stacks[yr]) return { doc: typeof cfg.stacks[yr] === "string" ? J(cfg.stacks[yr]) : cfg.stacks[yr], inSample: false };
    const doc = J(STACK_PATH);
    const ft = Object.values((doc.meta && doc.meta.fit_info) || {}).map((x) => x.fit_through);
    if (!ft.length || ft.some((d) => !d || d > "2023-12-31")) throw new Error("predictrec: " + STACK_PATH + " is not fit on 2023 or earlier (" + ft.join(", ") + ")");
    const inSample = ft.some((d) => d >= date);
    if (inSample && !cfg.inSample) throw new Error("predictrec: the backtest stacker " + STACK_PATH + " is fit through " + ft.join("/") +
      ", which contains this fight (" + date + "); pass cfg.inSample = true for an in-sample train diagnostic or per-year stackers in cfg.stacks");
    return { doc, inSample };
  }
  function flip(p) { return isNum(p) ? 1 - p : p; }
  function experts(f) {
    const ex = {};
    if (f.date < VALID) {
      const ml = J("data/derived/ml.json").fights[f.id] || {}, d = J("data/derived/blend_anchor_dev.json").fights[f.id] || {};
      const mk = J("data/derived/market.json").fights[f.id] || {};
      if (ml.set === "oof" && isNum(ml.lr) && isNum(ml.elo_sig)) { ex.ml = ml.lr; ex.elo_sig = ml.elo_sig; }
      if (isNum(d.feat_lr)) ex.feat_lr = d.feat_lr;
      if (isNum(d.elo)) ex.elo = d.elo;
      if (isNum(mk.p_market_rating)) ex.mkt_rating = mk.p_market_rating;
    } else {
      const b = (J("data/derived/blindtest.json").fights[f.id] || {}).p || {};
      for (const [name, key] of [["ml", "ml_lr"], ["elo_sig", "elo_sig"], ["feat_lr", "feat_lr"], ["elo", "elo"], ["mkt_rating", "mkt_rating"]]) {
        const v = b[key];
        if (!v || !isNum(v[0])) continue;
        if (v[2] && v[2] >= f.date) throw new Error("predictrec: blindtest.json " + key + " for " + f.id + " is fit through " + v[2] + ", not before " + f.date);
        ex[name] = v[0];
      }
      if (!(isNum(ex.ml) && isNum(ex.elo_sig))) { delete ex.ml; delete ex.elo_sig; }
    }
    return ex;
  }
  function line(f, kind) {
    if (!kind || kind === "none") return null;
    const mk = J("data/derived/market.json").fights[f.id] || {};
    const q = kind === "close" ? (isNum(mk.p_power_close) ? mk.p_power_close : mk.p_novig_close) : kind === "open" ? mk.p_novig_open : undefined;
    if (q === undefined && kind !== "close" && kind !== "open") throw new Error("predictrec: lineKind must be 'close', 'open' or 'none', got " + kind);
    return isNum(q) ? q : null;
  }
  function mrCells(f, kind) {
    const r = J("data/derived/methodround.json").fights[f.id];
    if (!r) return { cells: null };
    const R = r.rounds || f.rounds || 3, key = kind === "close" && Array.isArray(r.SM) ? "SM" : "S", c = r[key];
    // the cells returned are the static r.S / r.SM, so their fit date is r.fit_through (v6 review: the guard used to read the
    // date of r.S_refit / r.SM_refit, labelling 2025 static cells "fit through 2024-12-31"; harmless, the cells were older)
    const ft = r.fit_through;
    if (!Array.isArray(c) || c.length !== 4 * R + 3) return { cells: null };
    if (!ft || ft >= f.date) throw new Error("predictrec: methodround.json " + key + " for " + f.id + " is fit through " + ft + ", not before " + f.date);
    return { cells: c, variant: key, fitThrough: ft, R };
  }
  function mirror(c, R) {
    const q = new Array(c.length);
    for (let i = 0; i < R; i++) { q[i] = c[2 * R + i]; q[2 * R + i] = c[i]; q[R + i] = c[3 * R + i]; q[3 * R + i] = c[R + i]; }
    q[4 * R] = c[4 * R + 1]; q[4 * R + 1] = c[4 * R]; q[4 * R + 2] = c[4 * R + 2];
    return q;
  }
  function ml2(f) {
    const r = J("data/derived/ml2.json").fights[f.id];
    if (!r || !isNum(r.ml2_lr)) return null;
    if (f.date < VALID ? r.set !== "oof" : r.set !== "valid") throw new Error("predictrec: ml2.json row " + f.id + " is set " + r.set);
    return { pA: r.ml2_lr, pMR: isNum(r.mr) ? r.mr : null };
  }
  // ---------------------------------------------------------------- engine v6 (cfg.v6 = true): ML v2 heads + S2 cells
  //   winnerStacks  data/derived/v6_stacks.json (tools/v6_prep.py stacks); winnerFit = the fight's year for 2021-2023 (weights
  //                 fit on 2019..year-1, the forward-chained gate), 2024 for 2024-2025 (fit through 2023-12-31); fights before
  //                 2021 get winnerFit 2021 flagged inSample (only used to fit the method/round pool weight, never scored)
  //   ml2           { pA: ML v2 logistic, pBlend: ML v2 blend, pMR: market rating } from v6_stacks.json inputs (annual OOF
  //                 2019-2023, static fit < 2024 for 2024-2025; full precision)
  //   mrCells       data/derived/mr_s2.json fights[id].S2 (fold fit on earlier years only), variant 'S2', mirrored on a swap
  function v6opts(f, swap, out) {
    const W = J(cfg.winnerStacks || "data/derived/v6_stacks.json"), yr = +f.date.slice(0, 4);
    const fitY = yr >= 2024 ? 2024 : Math.max(2021, yr);
    out.winnerStacks = W; out.winnerFit = fitY;
    if (yr < 2021) out.inSample = true;
    const r = W.inputs[f.id];
    if (!r) throw new Error("predictrec v6: no v6_stacks.json inputs for " + f.id);
    if (r.year !== yr) throw new Error("predictrec v6: inputs year mismatch for " + f.id);
    let m2 = { pA: r.ml2lr, pBlend: r.ml2, pMR: isNum(r.mkt_rating) ? r.mkt_rating : null };
    // v7 look, refit schedule 'walk-forward' (V6_V10_PLAN 7.1 item 10 c): 2024-2025 fights take ML v2's monthly-rolling rows
    // (ml2.json ml2_roll = the blend head, ml2_lr_roll = the logistic; refit before each month's first card) instead of the
    // static fit < 2024; the stack weights stay the fit through 2023 (v6_stacks.json Y2024). Train years are unaffected.
    if (cfg.ml2Rolling && yr >= 2024) {
      const q = J("data/derived/ml2.json").fights[f.id];
      if (!q || q.set !== "valid" || !isNum(q.ml2_roll) || !isNum(q.ml2_lr_roll)) throw new Error("predictrec v6: no ML v2 monthly-rolling row for " + f.id);
      m2 = { pA: q.ml2_lr_roll, pBlend: q.ml2_roll, pMR: m2.pMR };
      out.ml2Schedule = "monthly rolling";
    }
    out.ml2 = swap ? { pA: 1 - m2.pA, pBlend: 1 - m2.pBlend, pMR: flip(m2.pMR) } : m2;
    const S2 = J(cfg.mrS2 || "data/derived/mr_s2.json").fights[f.id];
    if (!S2) throw new Error("predictrec v6: no S2 cells for " + f.id);
    if (!S2.fit_through || S2.fit_through >= f.date) throw new Error("predictrec v6: S2 cells for " + f.id + " fit through " + S2.fit_through + ", not before " + f.date);
    const R = S2.rounds;
    out.mrCells = swap ? mirror(S2.S2, R) : S2.S2.slice();
    out.mrVariant = "S2"; out.mrFitThrough = S2.fit_through; out.mrModel = "S2";
    return out;
  }
  // ---------------------------------------------------------------- engine v7 (cfg.v7 = true): v6opts + market props
  //   props  data/derived/props.json fights[id].props: the A/B-oriented de-vigged consensus (power de-vig per family per book,
  //          mean over books; tools/props.py, the same code path as src/ml/propspool.js and `tools/props.py capture`), from
  //          closing prices; mirrored on a swap (FightBlend.mirrorProps); absent (no key) when the bout has no props row
  function v7opts(f, swap, out) {
    v6opts(f, swap, out);
    const P = J(cfg.propsFile || "data/derived/props.json");
    const r = P.fights[f.id];
    if (r && r.props) {
      if (r.date && Math.abs(Date.parse(r.date) - Date.parse(f.date)) > 3 * 86400000) throw new Error("predictrec v7: props row date " + r.date + " vs fight " + f.date + " for " + f.id);
      const FB = require(path.join(ROOT, cfg.blendPath || "src/ml/blend.js"));
      out.props = swap ? FB.mirrorProps(r.props, f.rounds) : r.props;
    }
    return out;
  }
  /** predict options for backtest fight f (backtest_dev.json entry), corners swapped when swap is true.
      o = { lineKind: 'close' | 'open' | 'none' (default 'none'), strictLine: throw when the fight has no such line (else
      lineKind falls back to 'none' and lineMissing is set) }. */
  function opts(f, swap, o) {
    o = o || {};
    guardDate(f.date);
    const kind = o.lineKind || "none", st = stackFor(f.date);
    const ex = experts(f), q = line(f, kind), mr = mrCells(f, kind), m2 = ml2(f);
    const out = { backtest: true, date: f.date, stack: st.doc, inSample: st.inSample || undefined, lineKind: kind, experts: {} };
    if (kind !== "none" && q === null) {
      if (o.strictLine) throw new Error("predictrec: fight " + f.id + " has no " + kind + " line");
      out.lineKind = "none"; out.lineMissing = kind;
    } else if (q !== null) out.pMarket = swap ? 1 - q : q;
    for (const k in ex) out.experts[k] = swap ? flip(ex[k]) : ex[k];
    out.mrCells = mr.cells ? (swap ? mirror(mr.cells, mr.R) : mr.cells.slice()) : false;
    if (mr.cells) { out.mrVariant = mr.variant; out.mrFitThrough = mr.fitThrough; }
    if (m2) out.ml2 = swap ? { pA: 1 - m2.pA, pMR: flip(m2.pMR) } : m2;
    const FM = J("data/derived/forward_models.json");
    if (FM && FM.ml2_static) out.ml2Stack = FM.ml2_static;
    if (cfg.v7) v7opts(f, swap, out);
    else if (cfg.v6) v6opts(f, swap, out);
    return out;
  }
  return { opts, experts, line, mrCells, ml2, stackFor, mirror, STACK_PATH, v7opts };
};
