/* Mixture-of-experts stacker: the final win-probability layer (tools/moe.py -> data/derived/moe.json).

   Blends whatever experts the page has for a matchup (engine, ML, Elo, optional market line ...) in logit
   space with weights that depend on symmetric "gating" features (experience, Elo gap, layoff, age,
   division, 3 vs 5 rounds, pre-UFC data). Missing experts are simply left out: the softmax renormalises over
   the experts that are present (gated model) or the matching availability pattern is used (linear model).
   Every probability is P(first-named fighter A wins); the model has no intercept and is exactly symmetric
   (swap A and B -> 1 - p).

   Usage (Node or Web Worker, no dependencies):
     var M = MoE.load(moeJson);                    // whole data/derived/moe.json, or its .model block
     var r = M.predict({
       experts: { engine: 0.55, ml: 0.58, elo: MoE.eloProb(1650, 1580), market: MoE.devig(-150, 130) },
       gate: { nA: 9, nB: 4, cminA: 120, cminB: 50, eloA: 1650, eloB: 1580, rounds: 3, division: "Lightweight",
               layoffA: 180, layoffB: 120, ageA: 31.2, ageB: 27.9, preufcA: false, preufcB: true } });
     r.p        calibrated P(A wins);  r.weights  expert weights (sum 1);  r.scale  confidence multiplier;
     r.contrib  each expert's share of the final logit;  r.used  experts used.

   UMD: module.exports in Node, self.MoE in a browser or Web Worker. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MoE = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  var DIV_GROUPS = {
    "Flyweight": "light", "Bantamweight": "light", "Featherweight": "light",
    "Lightweight": "middle", "Welterweight": "middle", "Middleweight": "middle",
    "Light Heavyweight": "heavy", "Heavyweight": "heavy",
    "Women's Strawweight": "women", "Women's Flyweight": "women", "Women's Bantamweight": "women",
    "Women's Featherweight": "women"
  };

  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function logit(p) { p = clip(p, 1e-6, 1 - 1e-6); return Math.log(p / (1 - p)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  function present(p) { return typeof p === "number" && isFinite(p) && p >= 0 && p <= 1; }

  /** Raw gating features (same order as model.gate.names); twin of gate_vector() in tools/moe.py. */
  function gateVector(g) {
    function lay(x) { return (x === null || x === undefined || !isFinite(x)) ? Math.log1p(365) : Math.log1p(Math.min(x, 2000)); }
    function age(x) { return (x === null || x === undefined || !isFinite(x)) ? 30 : +x; }
    var grp = DIV_GROUPS[g.division] || "middle";
    var nA = +g.nA || 0, nB = +g.nB || 0, aA = age(g.ageA), aB = age(g.ageB);
    return [
      Math.log1p(Math.min(nA, nB)), Math.log1p(Math.max(nA, nB)),
      Math.min(Math.log1p(+g.cminA || 0), Math.log1p(+g.cminB || 0)),
      Math.abs((+g.eloA || 1500) - (+g.eloB || 1500)) / 100,
      +g.rounds === 5 ? 1 : 0, grp === "women" ? 1 : 0, grp === "light" ? 1 : 0, grp === "heavy" ? 1 : 0,
      Math.max(lay(g.layoffA), lay(g.layoffB)), (aA + aB) / 2 - 30, Math.abs(aA - aB),
      0.5 * (g.preufcA ? 1 : 0) + 0.5 * (g.preufcB ? 1 : 0)
    ];
  }

  function standardise(model, raw) {
    var mu = model.gate.mu, sd = model.gate.sd, out = [1];
    for (var i = 0; i < raw.length; i++) out.push((raw[i] - mu[i]) / sd[i]);
    return out;
  }

  function calibrate(cal, p) {
    if (!cal || cal.type === "none") return p;
    if (cal.type === "temperature") return sigm(cal.a * logit(p));
    // isotonic: piecewise-linear on the exported grid (np.interp semantics)
    var x = cal.x, y = cal.y, n = x.length;
    if (p <= x[0]) return y[0];
    if (p >= x[n - 1]) return y[n - 1];
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (x[mid] <= p) lo = mid; else hi = mid; }
    var t = (p - x[lo]) / (x[hi] - x[lo]);
    return y[lo] + t * (y[hi] - y[lo]);
  }

  function treeRaw(trees, x) {
    var s = 0;
    for (var t = 0; t < trees.length; t++) {
      var T = trees[t], node = T.root;
      if (node < 0) { s += T.leaves[-node - 1]; continue; }
      while (node >= 0) {
        var nd = T.nodes[node], v = x[nd[0]], left;
        if (v !== v) { if (nd[5]) left = nd[4] === 1; else left = 0 <= nd[1]; }   // NaN: default side, or as 0
        else left = v <= nd[1];
        node = left ? nd[2] : nd[3];
      }
      s += T.leaves[-node - 1];
    }
    return s;
  }

  function linearLogit(model, L, used) {
    var key = used.join("+"), w = model.linear && model.linear[key];
    if (!w) throw new Error("MoE: no linear weights for expert pattern " + key);
    var z = 0, contrib = {};
    for (var k in w) { var c = w[k] * L[k]; contrib[k] = c; z += c; }
    var tot = 0; for (k in w) tot += w[k];
    var weights = {}; for (k in w) weights[k] = tot > 0 ? w[k] / tot : 0;
    return { z: z, contrib: contrib, weights: weights, scale: tot };
  }

  function predictWith(model, inputs) {
    var ex = (inputs && inputs.experts) || {}, E = model.experts, pc = model.pclip;
    var used = [], L = {}, i, k;
    for (i = 0; i < E.length; i++) {
      var p = ex[E[i]];
      if (present(p)) { used.push(E[i]); L[E[i]] = logit(clip(p, pc, 1 - pc)); }
    }
    if (!used.length) throw new Error("MoE: no expert probabilities given");
    var raw = gateVector((inputs && inputs.gate) || {}), g = standardise(model, raw);
    var z, weights = {}, contrib = {}, scale = 1;
    if (model.method === "gated") {
      var a = [], mx = -Infinity;
      for (i = 0; i < E.length; i++) {
        if (!(E[i] in L)) { a.push(null); continue; }
        var s = 0; for (k = 0; k < g.length; k++) s += model.V[i][k] * g[k];
        a.push(s); if (s > mx) mx = s;
      }
      var den = 0; for (i = 0; i < E.length; i++) if (a[i] !== null) den += Math.exp(a[i] - mx);
      var h = 0;
      for (i = 0; i < E.length; i++) if (a[i] !== null) { weights[E[i]] = Math.exp(a[i] - mx) / den; h += weights[E[i]] * L[E[i]]; }
      var us = 0; for (k = 0; k < g.length; k++) us += model.u[k] * g[k];
      scale = Math.exp(clip(us, -5, 5));
      z = scale * h;
      for (k in weights) contrib[k] = scale * weights[k] * L[k];
    } else if (model.method === "linear") {
      var r = linearLogit(model, L, used);
      z = r.z; weights = r.weights; contrib = r.contrib; scale = r.scale;
    } else if (model.method === "gbm" || model.method === "gbm_res") {
      var x1 = [], x2 = [];
      for (i = 0; i < E.length; i++) { var l = E[i] in L ? L[E[i]] : NaN; x1.push(l); x2.push(-l); }
      for (k = 1; k < g.length; k++) { x1.push(g[k]); x2.push(g[k]); }
      z = 0.5 * (treeRaw(model.trees, x1) - treeRaw(model.trees, x2));
      if (model.method === "gbm_res") { var rb = linearLogit(model, L, used); z += rb.z; weights = rb.weights; contrib = rb.contrib; }
    } else throw new Error("MoE: unknown method " + model.method);
    var pRaw = sigm(z), pc2 = calibrate(model.calibration, pRaw);
    return { p: pc2, pRaw: pRaw, z: z, weights: weights, scale: scale, contrib: contrib, used: used, gate: raw };
  }

  /** P(A) from Elo ratings (scale 400). */
  function eloProb(eA, eB) { return 1 / (1 + Math.pow(10, (eB - eA) / 400)); }

  function decimal(american) { american = +american; return american > 0 ? 1 + american / 100 : 1 + 100 / Math.abs(american); }

  /** De-vigged P(A) from American moneylines (power method by default, as chosen on 2019-2023 in market.json;
      "mult" = proportional). */
  function devig(oddsA, oddsB, method) {
    var qa = 1 / decimal(oddsA), qb = 1 / decimal(oddsB);
    if (method === "mult") return qa / (qa + qb);
    var lo = 0.5, hi = 3;
    for (var it = 0; it < 80; it++) {
      var k = 0.5 * (lo + hi);
      if (Math.pow(qa, k) + Math.pow(qb, k) > 1) lo = k; else hi = k;
    }
    var kk = 0.5 * (lo + hi);
    return Math.pow(qa, kk) / (Math.pow(qa, kk) + Math.pow(qb, kk));
  }

  /** Load moe.json (whole document or a model block); returns { predict(inputs), model, doc }. */
  function load(json, which) {
    var doc = typeof json === "string" ? JSON.parse(json) : json;
    var model = doc.model && doc.experts === undefined ? (which && doc[which] ? doc[which] : (which && doc.alternatives && doc.alternatives[which]) || doc.model) : doc;
    return { model: model, doc: doc, predict: function (inputs) { return predictWith(model, inputs); } };
  }

  return { load: load, predict: predictWith, gateVector: gateVector, eloProb: eloProb, devig: devig,
    decimal: decimal, calibrate: calibrate, logit: logit, sigm: sigm, VERSION: "1.0.0" };
});
