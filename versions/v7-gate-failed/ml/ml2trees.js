/* ML2Trees: the JS tree evaluator for ML v2's CV-chosen blend (engine v6; V6_V10_PLAN 7.1 item 7; research/model_ml2.md).

   ML v2's CV choice is the blend  logit p = w_lr logit(p_LR) + w_lgb logit(p_LightGBM) + w_xgb logit(p_XGBoost)  (no
   intercept; OOF 2019-2023 0.6338 vs 0.6356 for the logistic). The page model (src/ml/ml2.js) evaluates only the logistic;
   this module evaluates the trees exported by tools/v6_trees.py (data/derived/ml2_trees.json: LightGBM 5 seeds x 350
   rounds, XGBoost 3 seeds x 475 rounds, refit on every decisive fight 2010-2025) and builds their design rows for any two
   roster fighters.

     var T = ML2Trees.load(ml2TreesJson, ml2Handle);           // ml2Handle = ML2.load(ml2.json) (the page logistic)
     T.predict(slugA, slugB, fight, pLR)  -> { p (blend), pLgb, pXgb, pLR }   fight = { date, lbs, five, title, women, catch, division }
     T.predictRows(g0, g1)                -> { lgb, xgb }   (design rows: g0 = A's view, g1 = the corner-swapped view)
     T.designRow(parts, flip)             -> one design row (array in doc.columns order) from its parts

   Every tree model is corner-symmetric by construction: each seed predicts 0.5 (f(g0) + 1 - f(g1)), seeds are averaged in
   logit space, and the blend has no intercept. LightGBM thresholds are compared in double precision (x <= t; a missing
   value takes the tree's default direction when the split learned one, else counts as 0); XGBoost compares in float32
   (Math.fround(x) < t; a missing value takes the 'missing' branch). Parity with the Python libraries:
   tests/test_ml2trees.js (doc.vectors, doc.builder.check_matchup, doc.builder.check_design).

   UMD: module.exports in Node, self.ML2Trees in a browser or Web Worker. No DOM, no dependencies. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ML2Trees = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  var VERSION = "1.0.0";
  function sig(z) { return 1 / (1 + Math.exp(-z)); }
  function logit(p, eps) { eps = eps || 1e-6; p = Math.min(Math.max(p, eps), 1 - eps); return Math.log(p / (1 - p)); }
  function miss(v) { return v === null || v === undefined || (typeof v === "number" && isNaN(v)); }
  var DAY = 86400000;

  function lgbTree(T, x) {
    var n = T.root;
    while (n >= 0) {
      var v = x[T.f[n]], mt = T.mt[n], left;
      if (miss(v)) {
        if (mt === 2) left = !!T.dl[n];
        else if (mt === 1) left = !!T.dl[n];
        else left = 0 <= T.t[n];
      } else if (mt === 1 && Math.abs(v) <= 1e-35) left = !!T.dl[n];
      else left = v <= T.t[n];
      n = left ? T.l[n] : T.r[n];
    }
    return T.v[~n];
  }
  function xgbTree(T, x) {
    var n = T.root;
    while (n >= 0) {
      var v = x[T.f[n]];
      if (miss(v)) n = T.m[n];
      else n = Math.fround(v) < Math.fround(T.t[n]) ? T.y[n] : T.n[n];
    }
    return T.v[~n];
  }

  function load(json, ml2Handle) {
    var doc = typeof json === "string" ? JSON.parse(json) : json;
    if (!doc || !doc.columns || !doc.lgb || !doc.xgb) return null;
    var cols = doc.columns, CI = {}, i;
    for (i = 0; i < cols.length; i++) CI[cols[i]] = i;
    var B = doc.builder || null, W = doc.blend_w, H0 = ml2Handle || null;
    var xbm = (doc.xgb_base_score || []).map(function (b) { return Math.log(b / (1 - b)); });

    function ens(kind, g0, g1) {
      var models = doc[kind], zs = 0;
      for (var k = 0; k < models.length; k++) {
        var trees = models[k], s0 = kind === "xgb" ? xbm[k] : 0, s1 = s0;
        for (var t = 0; t < trees.length; t++) {
          if (kind === "lgb") { s0 += lgbTree(trees[t], g0); s1 += lgbTree(trees[t], g1); }
          else { s0 += xgbTree(trees[t], g0); s1 += xgbTree(trees[t], g1); }
        }
        zs += logit(0.5 * (sig(s0) + 1 - sig(s1)));
      }
      return sig(zs / models.length);
    }
    function predictRows(g0, g1) { return { lgb: ens("lgb", g0, g1), xgb: ens("xgb", g0, g1) }; }
    function blend(pLR, pLgb, pXgb) { return sig(W.lr * logit(pLR) + W.lgb * logit(pLgb) + W.xgb * logit(pXgb)); }

    // ml.py matchup_features (antisymmetric x_*, symmetric s_*) with the division's league constants P
    function matchup(fa, fb, P) {
      var o = {}, ea = fa.slpm * fb.sapm / P.sig_mu, eb = fb.slpm * fa.sapm / P.sig_mu;
      o.x_sig = ea - eb; o.x_sig_share = 0.5 * (ea - eb) / (ea + eb);
      var ha = fa.head_pm * fb.ohead_pm / P.h_mu, hb = fb.head_pm * fa.ohead_pm / P.h_mu;
      o.x_head = ha - hb;
      var kd = Math.max(P.kdph, 1e-9), ka = ha * fa.power * fb.chin / kd, kb = hb * fb.power * fa.chin / kd;
      o.x_kd = 15 * (ka - kb);
      var ta = fa.td15 * fb.otd15 / P.td_mu, tb = fb.td15 * fa.otd15 / P.td_mu;
      o.x_td = ta - tb;
      var ca = fa.ctrl * fb.octrl / P.ctrl_mu, cb = fb.ctrl * fa.octrl / P.ctrl_mu;
      o.x_ctrl = ca - cb;
      var sa = fa.sub15 * fb.osub15 / P.sub_mu, sb = fb.sub15 * fa.osub15 / P.sub_mu;
      o.x_sub = sa - sb;
      var ga = fa.ground_pm * fb.oground_pm / P.g_mu, gb = fb.ground_pm * fa.oground_pm / P.g_mu;
      o.x_gnp = ga - gb;
      o.x_acc = fa.acc * (1 - fb.def) - fb.acc * (1 - fa.def);
      o.x_tdacc = fa.td_acc * (1 - fb.td_def) - fb.td_acc * (1 - fa.td_def);
      o.s_pace = ea + eb; o.s_kd = 15 * (ka + kb); o.s_sub = sa + sb; o.s_ctrl = ca + cb;
      return o;
    }
    // ml.py stance_terms from the roster's stance flags
    function stance(a, b) {
      var aS = a.southpaw ? 1 : 0, aO = a.orthodox ? 1 : 0, aW = a.switch ? 1 : 0, bS = b.southpaw ? 1 : 0, bO = b.orthodox ? 1 : 0, bW = b.switch ? 1 : 0;
      return { st_south_vs_orth: (aS && bO ? 1 : 0) - (bS && aO ? 1 : 0), st_switch: aW - bW,
        st_open: ((aS !== bS) && (aS || aO) && (bS || bO)) ? 1 : 0 };
    }
    /** parts = { sideA, sideB (side levels), d (A's-view design values by column name), m (matchup values, A's view),
        ctx, ex: { nA, nB, A_mr_var, B_mr_var, A_rsd_whr_rounds, B_rsd_whr_rounds, A_pre_ok, B_pre_ok, mr_ok } }; flip = the
        corner-swapped row (tools/ml2.py gbm_matrix(flip=True)). */
    function designRow(parts, flip) {
      var x = new Array(cols.length).fill(NaN), sg = flip ? -1 : 1, k, sa = flip ? parts.sideB : parts.sideA, sb = flip ? parts.sideA : parts.sideB;
      for (var j = 0; j < B.side_keys.length; j++) {
        k = B.side_keys[j];
        var va = sa[k], vb = sb[k];
        if (k === "age") {
          var a2 = miss(va) ? vb : va, b2 = miss(vb) ? va : vb;
          va = miss(a2) ? 30 : a2; vb = miss(b2) ? 30 : b2;
        }
        x[CI["a_" + k]] = miss(va) ? NaN : va; x[CI["b_" + k]] = miss(vb) ? NaN : vb;
      }
      for (j = 0; j < B.d_cols.length; j++) { k = B.d_cols[j]; var dv = parts.d[k]; x[CI["d_" + k]] = miss(dv) ? NaN : sg * dv; }
      for (j = 0; j < B.m_anti.length; j++) { k = B.m_anti[j]; x[CI["m_" + k]] = sg * parts.m[k]; }
      for (j = 0; j < B.m_sym.length; j++) { k = B.m_sym[j]; x[CI["m_" + k]] = parts.m[k]; }
      for (j = 0; j < B.ctx.length; j++) { k = B.ctx[j]; var cv = parts.ctx[k]; x[CI[k]] = miss(cv) ? NaN : cv; }
      var e = parts.ex, A = flip ? "B_" : "A_", Bs = flip ? "A_" : "B_";
      x[CI.a_nprior] = flip ? e.nB : e.nA; x[CI.b_nprior] = flip ? e.nA : e.nB;
      ["mr_var", "rsd_whr_rounds", "pre_ok"].forEach(function (q) {
        var u = e[A + q], w = e[Bs + q];
        x[CI["a_" + q]] = miss(u) ? NaN : u; x[CI["b_" + q]] = miss(w) ? NaN : w;
      });
      x[CI.s_nmin] = Math.min(e.nA, e.nB); x[CI.s_mr_ok] = e.mr_ok;
      return x;
    }
    var DIVS = { 125: "Flyweight", 135: "Bantamweight", 145: "Featherweight", 155: "Lightweight", 170: "Welterweight", 185: "Middleweight", 205: "Light Heavyweight", 265: "Heavyweight" };
    /** The design parts for two roster fighters (the page's own inputs; ml2.js side() / termValues()). */
    function partsFromRoster(h, slugA, slugB, fight) {
      if (!B) throw new Error("ML2Trees: this export has no design builder");
      if (!h || !h.side || !h.termValues) throw new Error("ML2Trees: needs the ML v2 page handle (ML2.load(ml2.json))");
      var a = h.side(slugA, fight), b = h.side(slugB, fight);
      if (!a || !b) return null;
      var xa = B.roster_extra[slugA], xb = B.roster_extra[slugB];
      if (!xa || !xb) return null;
      var aa = {}, bb = {}, k, j;
      for (k in a) aa[k] = a[k];
      for (k in b) bb[k] = b[k];
      for (j = 0; j < B.extra_keys.length; j++) { aa[B.extra_keys[j]] = xa[j]; bb[B.extra_keys[j]] = xb[j]; }
      var xs = h.termValues(a, b, fight), d = {};
      for (j = 0; j < B.d_cols.length; j++) { k = B.d_cols[j]; if (xs[k] !== undefined) d[k] = xs[k]; }
      for (j = 0; j < B.extra_terms.length; j++) { var t = B.extra_terms[j]; d[t.name] = h.baseTerm(t, aa, bb); }
      for (j = 0; j < B.d_cols.length; j++) if (d[B.d_cols[j]] === undefined) throw new Error("ML2Trees: no value for design column d_" + B.d_cols[j]);
      var div = fight.division || DIVS[fight.lbs] || null, P = (div && B.priors[div]) || B.priors.ALL || B.priors[Object.keys(B.priors)[0]];
      var fa = {}, fb = {};
      for (j = 0; j < B.matchup_keys.length; j++) { k = B.matchup_keys[j]; fa[k] = aa[k]; fb[k] = bb[k]; }
      var m = matchup(fa, fb, P), st = stance(aa, bb);
      for (k in st) m[k] = st[k];
      var women = fight.women != null ? +fight.women : (/^Women/.test(div || "") ? 1 : 0);
      var ctx = { lbs: fight.lbs, women: women, title: fight.title ? 1 : 0, five: fight.five ? 1 : 0, catch: fight.catch ? 1 : 0 };
      function mrVar(mr) {
        if (!mr || miss(mr[1])) return null;
        var g = mr[2] ? Math.max((Date.parse(fight.date) - Date.parse(mr[2])) / DAY, 0) / 365.25 : 0, P2 = B.mr_params;
        return Math.min(mr[1] * mr[1] + P2.tau * P2.tau * g, 2 * P2.v0);
      }
      var ex = { nA: a.n || 0, nB: b.n || 0, A_mr_var: mrVar(a.mr), B_mr_var: mrVar(b.mr),
        A_rsd_whr_rounds: a.r && a.r.whr_rounds ? a.r.whr_rounds.sd : null, B_rsd_whr_rounds: b.r && b.r.whr_rounds ? b.r.whr_rounds.sd : null,
        A_pre_ok: a.pre ? 1 : 0, B_pre_ok: b.pre ? 1 : 0, mr_ok: (a.mr && b.mr) ? 1 : 0 };
      var sideA = {}, sideB = {};
      for (j = 0; j < B.side_keys.length; j++) { k = B.side_keys[j]; sideA[k] = aa[k]; sideB[k] = bb[k]; }
      return { sideA: sideA, sideB: sideB, d: d, m: m, ctx: ctx, ex: ex };
    }
    function predict(slugA, slugB, fight, pLR, h) {
      h = h || H0;
      var parts = partsFromRoster(h, slugA, slugB, fight);
      if (!parts) return null;
      if (miss(pLR)) { var r = h.predict(slugA, slugB, fight); pLR = r ? r.pA : null; }
      if (miss(pLR)) return null;
      var pr = predictRows(designRow(parts, false), designRow(parts, true));
      return { p: blend(pLR, pr.lgb, pr.xgb), pLgb: pr.lgb, pXgb: pr.xgb, pLR: pLR };
    }
    return { doc: doc, version: VERSION, predictRows: predictRows, blend: blend, designRow: designRow, matchup: matchup, stance: stance,
      partsFromRoster: partsFromRoster, predict: predict, setHandle: function (h) { H0 = h; } };
  }
  return { load: load, VERSION: VERSION };
});
