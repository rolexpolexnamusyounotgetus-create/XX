/* ML v2 page winner model (tools/ml2.py -> data/derived/ml2.json page_model) for any two roster fighters.

   The logistic part of ML v2: tools/ml.py's antisymmetric A-minus-B terms (the base set) plus the new blocks the
   time-ordered CV kept, e.g. walk-forward rating systems (tools/ratings.py: WHR on rounds, Glicko-2, Elo with
   margin of victory, TrueSkill with method-aware outcomes) and the Kalman market rating built from earlier
   closing lines (tools/market.py). No intercept, so swapping the corners gives exactly 1 - p.
   research/model_ml2.md has the method, the validation numbers and the integration recipe.

   ML2.load(json)                           -> handle (json = ml2.json's page_model object, or a string)
   handle.has(slug)                         -> true when the fighter is in the ML v2 roster
   handle.side(slug, fight)                 -> the fighter's values for that fight (age, layoff, ... recomputed)
   handle.predict(slugA, slugB, fight[, pLine]) -> { pA, z, pMR, pStack, pStackLine } or null
       pA = the ML v2 logistic; pMR = market rating (both fighters rated); pStack = the validated no-line stack
       (ML v2 + market rating, page_model.stack.noline); pStackLine = the with-line stack when pLine (de-vigged
       closing-line P(A), e.g. MoE.devig) is given (page_model.stack.line)
       fight = { date: "YYYY-MM-DD", lbs: 155, five: 1,
                 fw: { A: { fw_missed: 0, fw_repl: 0, fw_repl14: 0, fw_home_intl: 0, ... }, B: {...} } }   (fw optional)
   handle.predictSides(a, b, fight[, pLine]) -> same, from two side objects (for fighters outside the roster)
   ML2.ratingProb(kind, kappa, ra, rb)      -> P(a beats b) for one rating system ({mu, sd})
   ML2.marketRatingProb(a, b, daysAfterSnapshot, params) -> P(a beats b) from market ratings [mu, sd, last, n]

   UMD: module.exports in Node, self.ML2 in a browser or Web Worker. No dependencies. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ML2 = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  var DAY = 86400000;
  function miss(x) { return x === null || x === undefined || (typeof x === "number" && !isFinite(x)); }
  function clamp(p, c) { return Math.min(Math.max(p, c), 1 - c); }
  function lg(p, c) { p = clamp(p, c); return Math.log(p / (1 - p)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }

  // erfc to double precision: Maclaurin series of erf for |x| < 2, Laplace continued fraction beyond.
  function erfc(x) {
    var z = Math.abs(x);
    if (z < 2) {
      var s = 0, term = x, x2 = x * x;
      for (var n = 0; n < 200; n++) {
        s += term / (2 * n + 1);
        term *= -x2 / (n + 1);
        if (Math.abs(term) < 1e-18) break;
      }
      return 1 - 2 / Math.sqrt(Math.PI) * s;
    }
    var f = 0;
    for (var k = 300; k >= 1; k--) f = (k / 2) / (z + f);
    var r = Math.exp(-z * z) / Math.sqrt(Math.PI) / (z + f);
    return x >= 0 ? r : 2 - r;
  }
  function ndtr(x) { return 0.5 * erfc(-x / Math.SQRT2); }

  function ratingProb(kind, kap, ra, rb) {
    var d = ra.mu - rb.mu;
    if (kind === "elo") return sigm(kap * d);
    if (kind === "glicko2") {
      var g = 1 / Math.sqrt(1 + 3 * (ra.sd * ra.sd + rb.sd * rb.sd) / (Math.PI * Math.PI));
      return sigm(kap * g * d);
    }
    if (kind === "trueskill") return ndtr(kap * d / Math.sqrt(2 + ra.sd * ra.sd + rb.sd * rb.sd));
    var vd = ra.sd * ra.sd + rb.sd * rb.sd;
    return sigm(kap * d / Math.sqrt(1 + Math.PI * kap * kap * vd / 8));
  }

  function marketRatingProb(a, b, days, P) {
    var g = Math.max(days, 0) / 365.25;
    var va = Math.min(a[1] * a[1] + P.tau * P.tau * g, 2 * P.v0), vb = Math.min(b[1] * b[1] + P.tau * P.tau * g, 2 * P.v0);
    return sigm((a[0] - b[0]) / Math.sqrt(1 + Math.PI * (va + vb) / 8));
  }

  // per-fight dynamic values (tools/ml.py page_sides)
  function pageSides(fx, fight, snapshot) {
    var v = {}, k;
    for (k in fx) v[k] = fx[k];
    var d = Date.parse(fight.date), snap = Date.parse(snapshot);
    v.age = fx._dob ? (d - Date.parse(fx._dob)) / DAY / 365.25 : null;
    if (fx._last_fight) { v.layoff = Math.round((d - Date.parse(fx._last_fight)) / DAY); v.log_layoff = Math.log(1 + v.layoff); }
    if (!miss(fx.years_ufc)) v.years_ufc = fx.years_ufc + Math.round((d - snap) / DAY) / 365.25;
    v.wc_move = (fight.lbs && fx._prev_lbs) ? fight.lbs - fx._prev_lbs : 0;
    v.new_class = (fight.lbs && fx._lbs_fought && fx._lbs_fought.length && fx._lbs_fought.indexOf(fight.lbs) < 0) ? 1 : 0;
    return v;
  }

  function baseTerm(t, a, b) {
    switch (t.type) {
      case "logr": return Math.log(a[t.key] + t.eps) - Math.log(b[t.key] + t.eps);
      case "logit": return lg(a[t.key], 1e-4) - lg(b[t.key], 1e-4);
      case "lin": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : (a[t.key] - b[t.key]) * t.scale;
      case "hinge": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : Math.max(a[t.key] - t.h, 0) - Math.max(b[t.key] - t.h, 0);
      case "flag": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : (a[t.key] > t.t ? 1 : 0) - (b[t.key] > t.t ? 1 : 0);
      case "share": { var ea = a[t.u] * b[t.v], eb = b[t.u] * a[t.v]; return 0.5 * (ea - eb) / (ea + eb + 1e-12); }
      case "stance": return (a.southpaw || 0) * (b.orthodox || 0) - (b.southpaw || 0) * (a.orthodox || 0);
    }
    return null;
  }

  function evalLogit(doc, a, b, fight) {
    var days = Math.round((Date.parse(fight.date) - Date.parse(doc.snapshot)) / DAY);
    var nA = a.n || 0, nB = b.n || 0, gNew = Math.min(nA, nB) <= 2 ? 1 : 0, fw = fight.fw || {};
    function zr(sys, kind, kap) {
      var ra = a.r && a.r[sys], rb = b.r && b.r[sys];
      if (!ra || !rb) return 0;
      return lg(ratingProb(kind, kap, ra, rb), 1e-3);
    }
    function zm() {
      if (!a.mr || !b.mr) return 0;
      return lg(marketRatingProb(a.mr, b.mr, days, doc.mr_params), 1e-3);
    }
    function pv(s, n, t) {
      if (!s.pre) return 0;
      var v = s.pre[t.key];
      if (miss(v)) return 0;
      return (v - t.mean) * (t.tau ? Math.exp(-n / t.tau) : 1);
    }
    var z = 0, T = doc.terms;
    for (var i = 0; i < T.length; i++) {
      var t = T[i], x = baseTerm(t, a, b);
      if (x === null) {
        switch (t.type) {
          case "rating": x = zr(t.sys, t.kind, t.kappa); break;
          case "mr": x = zm(); break;
          case "pre": x = pv(a, nA, t) - pv(b, nB, t); break;
          case "fw": x = ((fw.A || {})[t.key] || 0) - ((fw.B || {})[t.key] || 0); break;
          case "nbucket": x = (nA >= t.lo && nA <= t.hi ? 1 : 0) - (nB >= t.lo && nB <= t.hi ? 1 : 0); break;
          case "gate":
            x = (t.inner === "mr" ? zm() : t.inner === "whr" ? zr("whr_rounds", t.kind, t.kappa)
                 : (a.elo_judge - b.elo_judge) * 0.01) * gNew; break;
          default: throw new Error("ML2: unknown term " + t.type);
        }
      }
      z += t.coef * x;
    }
    return z;
  }

  function load(json) {
    var doc = typeof json === "string" ? JSON.parse(json) : json;
    if (doc && doc.page_model) doc = doc.page_model;
    if (!doc || !doc.terms || !doc.roster) return null;
    var keys = doc.keys, R = doc.roster;
    function side(slug, fight) {
      var row = R[slug];
      if (!row) return null;
      var fx = {};
      for (var i = 0; i < keys.length; i++) if (!miss(row.v[i]) || Array.isArray(row.v[i])) fx[keys[i]] = row.v[i];
      var v = pageSides(fx, fight, doc.snapshot);
      v.n = fx.n || 0;
      v.r = {};
      for (var j = 0; j < doc.rating_systems.length; j++) {
        var x = row.r[j];
        v.r[doc.rating_systems[j]] = x ? { mu: x[0], sd: x[1] } : null;
      }
      v.mr = row.mr || null;
      if (row.pre) { v.pre = {}; for (var k = 0; k < doc.pre_keys.length; k++) v.pre[doc.pre_keys[k]] = row.pre[k]; }
      else v.pre = null;
      return v;
    }
    function stackP(st, inp) {
      var z = 0;
      for (var i = 0; i < st.inputs.length; i++) {
        var p = inp[st.inputs[i]];
        z += st.weights[i] * (miss(p) ? 0 : lg(p, st.pclip));
      }
      return sigm(z);
    }
    function predictSides(a, b, fight, pLine) {
      var z = evalLogit(doc, a, b, fight);
      if (!isFinite(z)) return null;
      var out = { pA: sigm(z), z: z, pMR: null, pStack: null, pStackLine: null };
      if (a.mr && b.mr) {
        var days = Math.round((Date.parse(fight.date) - Date.parse(doc.snapshot)) / DAY);
        out.pMR = marketRatingProb(a.mr, b.mr, days, doc.mr_params);
      }
      if (doc.stack) {
        out.pStack = stackP(doc.stack.noline, { ml2lr: out.pA, mkt_rating: out.pMR });
        if (!miss(pLine)) out.pStackLine = stackP(doc.stack.line, { ml2lr: out.pA, mkt_rating: out.pMR, market: pLine });
      }
      return out;
    }
    return {
      doc: doc,
      has: function (slug) { return !!R[slug]; },
      side: side,
      predictSides: predictSides,
      predict: function (slugA, slugB, fight, pLine) {
        var a = side(slugA, fight), b = side(slugB, fight);
        if (!a || !b) return null;
        return predictSides(a, b, fight, pLine);
      }
    };
  }

  return { load: load, ratingProb: ratingProb, marketRatingProb: marketRatingProb, ndtr: ndtr };
});
