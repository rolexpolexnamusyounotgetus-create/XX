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

  // ------------------------------------------------------------------ built-in ML expert (feature LR)
  /* moe.json 'feat' holds a corner-symmetric L2 logistic regression on side-feature differences (no intercept),
     fit on walk-forward snapshots 2010-2025 (tools/moe.py, cmd lrpage). A side record is
     { S (decayed sums, feat.keys order), age, height_in, reach_in, n, ko_losses, kd_absorbed, elo, cmin
       (career UFC minutes), w, l, streak, last3, n5, fin_w, fin_l, layoff (days), stance }:
     sideFromProfile() builds one from a fighters.json profile. */
  function sideFeatures(feat, s, P) {
    var S = {}, keys = feat.keys, i, k;
    for (i = 0; i < keys.length; i++) S[keys[i]] = +(s.S && s.S[i]) || 0;
    function num(x) { return x === null || x === undefined || !isFinite(x) ? NaN : +x; }
    function pr(k) { return P[k] !== undefined && P[k] !== null ? +P[k] : 0; }
    var o = {};
    ["age", "height_in", "reach_in", "n", "ko_losses", "kd_absorbed", "elo", "cmin", "w", "l", "streak", "last3",
      "n5", "fin_w", "fin_l", "layoff"].forEach(function (k) { o[k] = num(s[k]); });
    o.layoff = isFinite(o.layoff) ? Math.log1p(Math.min(o.layoff, 2000)) : NaN;
    o.cmin = Math.log1p(o.cmin);
    o.n_log = Math.log1p(o.n);
    var m = S.min;
    o.dmin = Math.log1p(m);
    o.dn = S.n;
    feat.rate_defs.forEach(function (d) {
      var nm = 0, p = 0; d[1].forEach(function (k) { nm += S[k]; p += pr(k); });
      o[d[0]] = (nm + d[2] * p) / (m + d[2]);
    });
    feat.acc_defs.forEach(function (d) {
      var l = 0, a = 0, pl = 0, pa = 0;
      d[1].forEach(function (k) { l += S[k]; pl += pr(k); });
      d[2].forEach(function (k) { a += S[k]; pa += pr(k); });
      var p0 = pa > 0 ? pl / pa : 0.4, acc = (l + d[3] * p0) / (a + d[3]);
      o[d[0]] = d[4] ? 1 - acc : acc;
    });
    var nf = S.n, wins = S.ko_w + S.sub_w + S.dec_w;
    o.winr = (wins + 1) / (nf + 2);
    ["ko_w", "sub_w", "dec_w", "ko_l", "sub_l", "dec_l"].forEach(function (k) { o[k + "_r"] = (S[k] + 0.25) / (nf + 1.5); });
    o.wl_c = (o.w + 1) / (o.w + o.l + 2);
    o.fin_wr = (o.fin_w + 0.5) / (o.w + o.l + 2);
    o.fin_lr = (o.fin_l + 0.5) / (o.w + o.l + 2);
    o.diff_sl = o.slpm - o.sapm;
    o.southpaw = s.stance === "Southpaw" ? 1 : 0;
    o["switch"] = s.stance === "Switch" ? 1 : 0;
    o.streak6 = isFinite(o.streak) ? Math.max(-6, Math.min(6, o.streak)) : 0;
    return feat.names.map(function (k) { return o[k]; });
  }

  var LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
    "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
    "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145 };

  /** P(A wins) from the built-in feature LR. ctx = { division, homeA, homeB, priors (optional override),
      coef: "coef" (production, default) | "coef_valid" }. */
  function featLR(feat, sideA, sideB, ctx) {
    ctx = ctx || {};
    var div = ctx.division || "Lightweight";
    if (!LBS[div]) {                       // catch / open weight: the heavier pre-fight home division
      var homes = [ctx.homeA, ctx.homeB].filter(function (h) { return LBS[h]; });
      if (homes.length) div = homes.reduce(function (a, b) { return LBS[a] >= LBS[b] ? a : b; });
    }
    var PR = ctx.priors || feat.priors, P = PR[div] || PR.ALL;
    var fa = sideFeatures(feat, sideA, P), fb = sideFeatures(feat, sideB, P), c = feat[ctx.coef || "coef"], z = 0;
    for (var i = 0; i < c.length; i++) { var d = fa[i] - fb[i]; if (isFinite(d)) z += c[i] * d; }
    return sigm(z);
  }

  function days(d0, d1) { return (Date.parse(d1) - Date.parse(d0)) / 86400000; }

  /** Side record from a fighters.json profile for a fight on `date` (ISO). opts = { keys (fighters.json
      meta.keys), snapshot (meta.snapshot), halfLife (meta.half_life_days, 730) }. */
  function sideFromProfile(prof, date, opts) {
    opts = opts || {};
    var keys = opts.keys, S = prof.S || [], C = prof.C || [], rec = prof.record || {};
    var dt = opts.snapshot && date ? Math.max(0, days(opts.snapshot, date)) : 0;
    var f = Math.pow(0.5, dt / (opts.halfLife || 730));
    var iMin = keys ? keys.indexOf("min") : 0;
    var res = (prof.recent || []).map(function (r) { return r.res; });
    var streak = 0;
    for (var i = 0; i < res.length; i++) {
      var r = res[i];
      if (r !== "W" && r !== "L") continue;          // draws / no contests leave a streak unchanged
      if (streak === 0) streak = r === "W" ? 1 : -1;
      else if ((r === "W") === (streak > 0)) streak += streak > 0 ? 1 : -1;
      else break;
    }
    var l3 = res.slice(0, 3).map(function (r) { return r === "W" ? 1 : (r === "L" ? 0 : 0.5); });
    return {
      S: S.map(function (x) { return x * f; }),
      age: prof.dob && date ? days(prof.dob, date) / 365.25 : null,
      height_in: prof.height_in, reach_in: prof.reach_in, stance: prof.stance,
      n: prof.n_fights || 0, ko_losses: prof.ko_losses || 0, kd_absorbed: prof.kd_absorbed || 0, elo: prof.elo || 1500,
      cmin: C[iMin] || 0, w: rec.w || 0, l: rec.l || 0, streak: streak,
      last3: l3.length ? l3.reduce(function (a, b) { return a + b; }, 0) / l3.length : 0.5,
      n5: prof.n_5rd || 0, fin_w: (rec.ko_w || 0) + (rec.sub_w || 0), fin_l: (rec.ko_l || 0) + (rec.sub_l || 0),
      layoff: prof.last_fight && date ? Math.max(0, days(prof.last_fight, date)) : null,
      home: prof.division || null
    };
  }

  /** Gate inputs for predict() from two side records (sideFromProfile) and the bout. */
  function gateFromSides(a, b, ctx) {
    ctx = ctx || {};
    return { nA: a.n, nB: b.n, cminA: a.cmin, cminB: b.cmin, eloA: a.elo, eloB: b.elo, rounds: ctx.rounds || 3,
      division: ctx.division, layoffA: a.layoff, layoffB: b.layoff, ageA: a.age, ageB: b.age,
      preufcA: !!ctx.preufcA, preufcB: !!ctx.preufcB };
  }

  /** Load moe.json (whole document or a model block); returns { predict(inputs), model, doc }. */
  function load(json, which) {
    var doc = typeof json === "string" ? JSON.parse(json) : json;
    var model = doc.model && doc.experts === undefined ? (which && doc[which] ? doc[which] : (which && doc.alternatives && doc.alternatives[which]) || doc.model) : doc;
    return { model: model, doc: doc, predict: function (inputs) { return predictWith(model, inputs); } };
  }

  return { load: load, predict: predictWith, gateVector: gateVector, eloProb: eloProb, devig: devig,
    decimal: decimal, calibrate: calibrate, logit: logit, sigm: sigm, featLR: featLR, sideFeatures: sideFeatures,
    sideFromProfile: sideFromProfile, gateFromSides: gateFromSides, VERSION: "1.0.0" };
});
