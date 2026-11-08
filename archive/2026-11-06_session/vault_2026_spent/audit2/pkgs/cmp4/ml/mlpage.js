/* ML page winner model (tools/ml.py -> ml.json page_model) for any two roster fighters.

   The page inlines a compact copy built by build.py: { snapshot, winner: {terms, platt_slope}, stack, keys,
   roster: {slug: [values in keys order]}, test_vectors }. The evaluator follows research/model_ml.md
   ("Page model: any matchup in JS"). MoE takes the raw logistic (pLR, WITHOUT the Platt slope) as its "ml"
   expert and the strike-share Elo as "elo_sig".

   MLPage.load(json)                          -> handle
   handle.has(slug)                           -> true when the fighter is in the ML roster
   handle.side(slug)                          -> the fighter's values as an object (keys -> values)
   handle.predict(slugA, slugB, fight)        -> { pA, pLR, pElo, pEloSig, pStack } or null
       fight = { date: "YYYY-MM-DD", lbs: 155, five: 1, title: 0, women: 0, catch: 0 }

   UMD: module.exports in Node, self.MLPage in a browser or Web Worker. No dependencies. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MLPage = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  var DAY = 86400000;
  function clampP(p) { return Math.min(Math.max(p, 1e-4), 1 - 1e-4); }
  function logit(p) { p = clampP(p); return Math.log(p / (1 - p)); }
  function miss(x) { return x === null || x === undefined || (typeof x === "number" && !isFinite(x)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }

  // dynamic keys recomputed for the fight date and weight (page_sides() in tools/ml.py)
  function sides(fx, fight, snapshot) {
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

  function term(t, a, b) {
    switch (t.type) {
      case "logr": return Math.log(a[t.key] + t.eps) - Math.log(b[t.key] + t.eps);
      case "logit": return logit(a[t.key]) - logit(b[t.key]);
      case "lin": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : (a[t.key] - b[t.key]) * t.scale;
      case "hinge": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : Math.max(a[t.key] - t.h, 0) - Math.max(b[t.key] - t.h, 0);
      case "flag": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : (a[t.key] > t.t ? 1 : 0) - (b[t.key] > t.t ? 1 : 0);
      case "share": { var ea = a[t.u] * b[t.v], eb = b[t.u] * a[t.v]; return 0.5 * (ea - eb) / (ea + eb + 1e-12); }
      case "stance": return (a.southpaw || 0) * (b.orthodox || 0) - (b.southpaw || 0) * (a.orthodox || 0);
    }
    throw new Error("MLPage: unknown term " + t.type);
  }

  function load(json) {
    var doc = typeof json === "string" ? JSON.parse(json) : json;
    if (!doc || !doc.winner || !doc.roster) return null;
    var keys = doc.keys || null, R = doc.roster, cache = {};
    function side(slug) {
      if (cache[slug]) return cache[slug];
      var row = R[slug]; if (!row) return null;
      var o;
      if (Array.isArray(row) && keys) { o = {}; for (var i = 0; i < keys.length; i++) if (row[i] !== null && row[i] !== undefined) o[keys[i]] = row[i]; }
      else o = row;
      cache[slug] = o; return o;
    }
    function predict(slugA, slugB, fight) {
      var fa = side(slugA), fb = side(slugB);
      if (!fa || !fb) return null;
      var a = sides(fa, fight, doc.snapshot), b = sides(fb, fight, doc.snapshot), z = 0, T = doc.winner.terms;
      for (var i = 0; i < T.length; i++) z += T[i].coef * term(T[i], a, b);
      if (!isFinite(z)) return null;
      var pLR = sigm(z), pA = sigm(z * (doc.winner.platt_slope || 1));
      var pElo = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
      var pEloSig = (!miss(a.elo_sig) && !miss(b.elo_sig)) ? 1 / (1 + Math.pow(10, (b.elo_sig - a.elo_sig) / 400)) : null;
      var haveMR = !miss(a.mr_mu) && !miss(b.mr_mu), st = (doc.stack || {})[haveMR ? "elo+lr+mkt_rating" : "elo+lr"], pStack = null;
      if (st) {
        var inp = { elo: pElo, lr: pLR, mkt_rating: haveMR ? sigm((a.mr_mu - b.mr_mu) / Math.sqrt(1 + Math.PI * (a.mr_sd * a.mr_sd + b.mr_sd * b.mr_sd) / 8)) : null };
        var zz = 0; for (var j = 0; j < st.inputs.length; j++) zz += st.weights[j] * logit(inp[st.inputs[j]]);
        pStack = sigm(zz);
      }
      return { pA: pA, pLR: pLR, pElo: pElo, pEloSig: pEloSig, pStack: pStack };
    }
    return { doc: doc, snapshot: doc.snapshot, has: function (s) { return !!R[s]; }, side: side, predict: predict };
  }

  return { load: load, sides: sides, term: term, VERSION: "1.0.0" };
});
