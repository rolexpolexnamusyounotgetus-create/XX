/* statdist: distributional per-fight stat lines (tools/statlines.py -> data/derived/statlines.json;
   research/model_statlines.md). Dependency-free UMD: module.exports in Node, self.StatDist in a browser or Worker.

   For each fighter in a matchup, the predictive DISTRIBUTION (not only the mean) of his significant strikes
   attempted / landed (total, head / body / leg, distance / clinch / ground), knockdowns, takedowns attempted /
   landed, control seconds, submission attempts and reversals,
     (1) given that the fight lasts t minutes:        P.dist(side, stat, t)
     (2) unconditionally, over a fight-length grid:   P.mixture(side, stat, grid), grid = SD.lengthGrid(S, rounds)
   Counts are negative binomial (NB2, optionally zero-inflated); control time is a zero-inflated Beta on the share of
   fight time (cap = 60 t seconds). Means start from the verified mlrates + embedding stat-line blend; time terms and a
   ridge GLM on matchup features correct them (selected per stat by forward-chained CV 2021-2023).

   Usage:
     var SD = StatDist.load(statlinesJson, { which: "prod" });      // "dev" = fit 2019-2023 (backtests), "prod" 2019-2025
     var P = SD.prepare({
       mlA: MLRates side rates for A (object keyed by mlrates target names, or an 18-array in SD.mlTargets order),
       mlB: the same for B,
       etaA, etaB: FightEmbed task predictors (matchup().etaA / etaB) or null; hasEmb: both fighters embedded,
       winLogit: FightEmbed win logit for A (0 if none),
       oppA, oppB: oppadj factors {dAtt, cAtt, gAtt, tdAtt, ctrl, dAttAg, cAttAg, gAttAg, tdAttAg, octrl} or null (1),
       rounds: 3 | 5 });
     P.dist("A", "sig_lnd", 15)           -> {kind, mean, var, pmf(y), logpmf(y), cdf(y), quantile(q)}
     SD.lengthGrid(S, rounds)             -> {t: [...], w: [...]} from methodround S cells (or SD.lengthGridSimple)
     P.mixture("A", "ctrl", grid)         -> the same interface, mixed over the fight-length grid
     P.line("A", gridOrT)                 -> {stat: {mean, p10, p50, p90}} for the page
     P.rates("A", t)                      -> expected per-minute rates at length t (retarget targets for an engine)
     SD.pit(dist, y, u)                   -> randomized PIT of an observed value (u uniform in [0, 1])
     SD.engineTargets(P, t)               -> {A: rates, B: rates} when the flag is on, else null (engine keeps its own)

   Flag: StatDist.load(json, { enable: true }) turns on engineTargets(); off by default so an engine that calls it
   behaves exactly as before. Symmetric: no corner input (swap A and B -> the sides swap). */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StatDist = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";

  var ACC = { acc_h: 1, acc_b: 1, acc_l: 1, acc_d: 1, acc_c: 1, acc_g: 1, td_acc: 1 };
  var GLM_OWN = ["sig_att", "sig_lnd", "td_att", "ctrl", "sub_att", "kd"];

  function sig(x) { return 1 / (1 + Math.exp(-x)); }
  function clip(x, a, b) { return x < a ? a : (x > b ? b : x); }

  // log Gamma (Lanczos, g = 7, n = 9): relative error ~1e-15 for x > 0
  var LG = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function lgamma(x) {
    if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lgamma(1 - x);
    x -= 1;
    var a = LG[0], t = x + 7.5;
    for (var i = 1; i < 9; i++) a += LG[i] / (x + i);
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
  }
  function betaln(a, b) { return lgamma(a) + lgamma(b) - lgamma(a + b); }
  // regularized incomplete beta I_x(a, b) (continued fraction, Numerical Recipes betacf)
  function betacf(a, b, x) {
    var qab = a + b, qap = a + 1, qam = a - 1, c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < 1e-300) d = 1e-300;
    d = 1 / d;
    var h = d;
    for (var m = 1; m <= 500; m++) {
      var m2 = 2 * m, aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = 1 + aa / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d;
      var del = d * c;
      h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return h;
  }
  function betai(a, b, x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    var bt = Math.exp(-betaln(a, b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }

  // ------------------------------------------------------------------ distributions
  function nbLogPmf(y, mu, k) {
    mu = Math.max(mu, 1e-10);
    return lgamma(y + k) - lgamma(k) - lgamma(y + 1) + k * Math.log(k / (k + mu)) + y * Math.log(mu / (k + mu));
  }
  // P(Y <= j) for NB(mu, k) by the pmf recurrence (exact up to rounding; j is a few hundred at most)
  function nbCdf(j, mu, k) {
    if (j < 0) return 0;
    mu = Math.max(mu, 1e-12);
    var q = mu / (k + mu), lp = k * Math.log(k / (k + mu)), p = Math.exp(lp), s = p;
    var J = Math.floor(j);
    if (p === 0) {               // far from zero: start from the log pmf directly
      s = 0;
      for (var y = 0; y <= J; y++) s += Math.exp(nbLogPmf(y, mu, k));
      return Math.min(1, s);
    }
    for (var i = 0; i < J; i++) { p *= (i + k) / (i + 1) * q; s += p; }
    return Math.min(1, s);
  }

  function makeDist(kind, p) {
    var d = { kind: kind, p: p };
    if (kind === "nb" || kind === "zinb") {
      var pi = kind === "zinb" ? p.pi : 0;
      d.mean = (1 - pi) * p.mu;
      var v = p.mu + p.mu * p.mu / p.k;
      d["var"] = (1 - pi) * (v + p.mu * p.mu) - d.mean * d.mean;
      d.logpmf = function (y) {
        var f = nbLogPmf(y, p.mu, p.k);
        if (!pi) return f;
        return y === 0 ? Math.log(pi + (1 - pi) * Math.exp(f)) : Math.log(1 - pi) + f;
      };
      d.cdf = function (j) { return j < 0 ? 0 : pi + (1 - pi) * nbCdf(j, p.mu, p.k); };
    } else if (kind === "zibeta") {
      var a = p.m * p.phi, b = (1 - p.m) * p.phi, cap = p.cap;
      d.mean = (1 - p.pi) * p.m * cap;
      var ex2 = p.m * (p.m * p.phi + 1) / (p.phi + 1);
      d["var"] = cap * cap * ((1 - p.pi) * ex2 - Math.pow((1 - p.pi) * p.m, 2));
      d.logpmf = function (y) {       // mass on a 1-second grid (density of the share x 1 / cap), P(0) = pi
        if (y <= 0) return Math.log(p.pi);
        var s = clip(y / cap, 0.5 / cap, 1 - 0.5 / cap);
        return Math.log(1 - p.pi) + (a - 1) * Math.log(s) + (b - 1) * Math.log(1 - s) - betaln(a, b) - Math.log(cap);
      };
      d.cdf = function (j) {
        if (j < 0) return 0;
        if (j + 0.5 >= cap) return 1;
        return p.pi + (1 - p.pi) * betai(a, b, clip((j + 0.5) / cap, 0, 1));
      };
    } else throw new Error("statdist: unknown kind " + kind);
    d.pmf = function (y) { return Math.exp(d.logpmf(y)); };
    d.quantile = function (q) { return quantileOf(d, q); };
    return d;
  }

  function quantileOf(d, q) {
    // smallest integer j with F(j) >= q (bracket by doubling from the mean, then bisect)
    var hi = Math.max(1, Math.ceil(d.mean + 4 * Math.sqrt(Math.max(d["var"], 1)))), lo = -1;
    while (d.cdf(hi) < q && hi < 1e6) hi *= 2;
    while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (d.cdf(mid) >= q) hi = mid; else lo = mid; }
    return hi;
  }

  function mixDist(parts, w) {
    var W = 0, i;
    for (i = 0; i < w.length; i++) W += w[i];
    var d = { kind: "mixture", parts: parts, w: w.map(function (x) { return x / W; }) };
    var m = 0, m2 = 0;
    for (i = 0; i < parts.length; i++) {
      m += d.w[i] * parts[i].mean;
      m2 += d.w[i] * (parts[i]["var"] + parts[i].mean * parts[i].mean);
    }
    d.mean = m; d["var"] = m2 - m * m;
    d.cdf = function (j) { var s = 0; for (var k = 0; k < parts.length; k++) if (d.w[k] > 0) s += d.w[k] * parts[k].cdf(j); return Math.min(1, s); };
    d.logpmf = function (y) {
      var s = 0;
      for (var k = 0; k < parts.length; k++) {
        if (!(d.w[k] > 0)) continue;
        var P = parts[k];
        if (P.kind === "zibeta" && y > P.p.cap + 0.5) continue;
        s += d.w[k] * Math.exp(P.logpmf(y));
      }
      return Math.log(s);
    };
    d.pmf = function (y) { return Math.exp(d.logpmf(y)); };
    d.quantile = function (q) { return quantileOf(d, q); };
    return d;
  }

  function pit(d, y, u) {
    var Fy = d.cdf(y), Fm = y >= 1 ? d.cdf(y - 1) : 0;
    return Math.min(1, Math.max(0, Fm + (u == null ? 0.5 : u) * (Fy - Fm)));
  }

  // ------------------------------------------------------------------ the model
  function load(json, opts) {
    opts = opts || {};
    var which = opts.which || "prod";
    var M = json.models[which];
    if (!M) throw new Error("statdist: no model set " + which);
    var STATS = json.stats, MLT = json.mlrates_targets, NAMES = json.glm_names;
    var ti = {};
    json.embed_tasks.forEach(function (t, i) { ti[t] = i; });
    var iWL = NAMES.indexOf("win_logit"), iOwn = NAMES.indexOf("own_sig_lnd"), iOpp = NAMES.indexOf("opp_sig_lnd");
    var enabled = !!opts.enable;

    function linkML(t, x) {
      if (t === "ctrl") return Math.log(Math.max(x / 60, 1e-6));
      if (t === "kd_h") return Math.log(clip(x, 1e-6, 1 - 1e-6));
      if (ACC[t]) { var p = clip(x, 1e-6, 1 - 1e-6); return Math.log(p / (1 - p)); }
      return Math.log(Math.max(x, 1e-9));
    }
    function mlArr(ml) {
      if (Array.isArray(ml)) return ml;
      return MLT.map(function (t) { var v = ml[t]; if (v == null) throw new Error("statdist: missing mlrates target " + t); return +v; });
    }
    function blend(ml, eta, hasEmb) {
      var out = {};
      for (var k = 0; k < MLT.length; k++) {
        var t = MLT[k], b = M.blend[t], z0 = linkML(t, ml[k]), z;
        if (b.emb && hasEmb && eta) z = b.emb[0] + b.emb[1] * z0 + b.emb[2] * eta[ti[b.task]];
        else z = b.noemb[0] + b.noemb[1] * z0;
        if (ACC[t]) out[t] = sig(z);
        else if (t === "kd_h") out[t] = Math.min(Math.exp(z), 0.5);
        else if (t === "ctrl") out[t] = 60 * Math.exp(z);
        else out[t] = Math.exp(z);
      }
      return out;
    }
    function baseRates(g) {
      var h = g.h_att, b = g.b_att, l = g.l_att, hl = h * g.acc_h, bl = b * g.acc_b, ll = l * g.acc_l, o = {};
      o.sig_att = h + b + l; o.sig_lnd = hl + bl + ll;
      o.h_att = h; o.h_lnd = hl; o.b_att = b; o.b_lnd = bl; o.l_att = l; o.l_lnd = ll;
      ["d", "c", "g"].forEach(function (p) { o[p + "_att"] = g[p + "_att"]; o[p + "_lnd"] = g[p + "_att"] * g["acc_" + p]; });
      o.kd = hl * g.kd_h; o.td_att = g.td_att; o.td_lnd = g.td_att * g.td_acc; o.ctrl = g.ctrl;
      o.sub_att = g.sub_att; o.rev = g.rev;
      for (var s in o) o[s] = Math.max(o[s], 1e-6);
      return o;
    }
    function oppLog(o, k) { var v = o && o[k] != null ? +o[k] : 1; return Math.log(Math.max(v, 1e-3)); }

    function prepare(inp) {
      var R = inp.rounds === 5 ? 5 : 3;
      var hasEmb = !!inp.hasEmb && !!inp.etaA && !!inp.etaB;
      var wl = +inp.winLogit || 0;
      var BR = { A: baseRates(blend(mlArr(inp.mlA), inp.etaA, hasEmb)), B: baseRates(blend(mlArr(inp.mlB), inp.etaB, hasEmb)) };
      var Z = {};
      ["A", "B"].forEach(function (s) {
        var o = s === "A" ? "B" : "A", raw = [], i;
        GLM_OWN.forEach(function (st) { raw.push(Math.log(BR[s][st])); });
        GLM_OWN.forEach(function (st) { raw.push(Math.log(BR[o][st])); });
        raw.push(s === "A" ? wl : -wl, hasEmb ? 1 : 0);
        json.glm_oppadj.forEach(function (k) { raw.push(oppLog(s === "A" ? inp.oppA : inp.oppB, k)); });
        json.glm_oppadj.forEach(function (k) { raw.push(oppLog(s === "A" ? inp.oppB : inp.oppA, k)); });
        var z = new Array(raw.length);
        for (i = 0; i < raw.length; i++) z[i] = (raw[i] - M.glm_mu[i]) / M.glm_sd[i];
        Z[s] = z;
      });

      function dist(side, st, t) {
        var S = M.stats[st];
        if (!S) throw new Error("statdist: unknown stat " + st);
        var lt = Math.log(Math.max(t, 0.05)), fin = t < 5 * R - 1 / 60 ? 1 : 0, five = R === 5 ? 1 : 0;
        var Xt = [1, lt, fin, fin * lt, five];
        var lmu0 = Math.log(Math.max(BR[side][st] * t, 1e-8));
        var G = null, i;
        if (S.glm) {
          var z = Z[side];
          G = z.concat([fin * z[iWL], fin * z[iOwn], fin * z[iOpp]]);
        }
        var b = S.b, g = S.g, d = S.d;
        function dotv(x, c, off) { var s = 0; for (var j = 0; j < x.length; j++) s += x[j] * c[off + j]; return s; }
        if (S.kind === "zibeta") {
          var cap = 60 * t, sh = clip(Math.exp(lmu0) / cap, 1e-4, 0.98), off = Math.log(sh / (1 - sh));
          var em = off + dotv(Xt, b, 0) + (G ? dotv(G, b, Xt.length) : 0);
          var m = sig(clip(em, -15, 15));
          var phi = Math.exp(clip(g[0] + g[1] * lt + g[2] * fin, -4, 8));
          var ep = d[0] + d[1] * clip(lmu0 - Math.log(cap), -10, 2) + d[2] * lt + d[3] * fin + (G ? dotv(G, d, 4) : 0);
          return makeDist("zibeta", { pi: sig(ep), m: m, phi: phi, cap: cap });
        }
        var Xm = S.t ? Xt : [1];
        var e = lmu0 + dotv(Xm, b, 0) + (G ? dotv(G, b, Xm.length) : 0);
        var mu = Math.exp(clip(e, -20, 20));
        var Xk = !S.t ? [1] : (S.glm ? [1, lt, fin, clip(lmu0, -8, 8), five] : [1, lt, fin]);
        var k = Math.exp(clip(dotv(Xk, g, 0), -6, 9));
        if (S.kind === "zinb") {
          var pz = sig(d[0] + d[1] * clip(lmu0, -8, 8) + d[2] * lt + d[3] * fin);
          return makeDist("zinb", { mu: mu, k: k, pi: pz });
        }
        return makeDist("nb", { mu: mu, k: k });
      }
      function mixture(side, st, grid) {
        var parts = grid.t.map(function (t) { return dist(side, st, t); });
        return mixDist(parts, grid.w);
      }
      function line(side, gridOrT) {
        var out = {};
        STATS.forEach(function (st) {
          var d = typeof gridOrT === "number" ? dist(side, st, gridOrT) : mixture(side, st, gridOrT);
          out[st] = { mean: d.mean, p10: d.quantile(0.1), p50: d.quantile(0.5), p90: d.quantile(0.9) };
        });
        return out;
      }
      function rates(side, t) {
        var o = {};
        STATS.forEach(function (st) { o[st] = dist(side, st, t).mean / t; });
        return o;
      }
      return { rounds: R, base: BR, z: Z, dist: dist, mixture: mixture, line: line, rates: rates };
    }

    // fight-length grid from methodround S cells: A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW
    function lengthGrid(S, rounds) {
      var R = rounds === 5 ? 5 : 3;
      if (S.length !== 4 * R + 3) throw new Error("statdist: S cells length " + S.length + " for " + R + " rounds");
      var tot = 0, i, r, b;
      for (i = 0; i < S.length; i++) tot += S[i];
      var t = [], w = [], ft = json.finish_time;
      for (r = 0; r < R; r++) {
        var ko = (S[r] + S[2 * R + r]) / tot, sb = (S[R + r] + S[3 * R + r]) / tot, g = r === 0 ? "r1" : "rN";
        for (b = 0; b < 10; b++) { t.push(5 * r + (b + 0.5) * 0.5); w.push(ko * ft["KO|" + g][b] + sb * ft["SUB|" + g][b]); }
      }
      t.push(5 * R); w.push((S[4 * R] + S[4 * R + 1] + S[4 * R + 2]) / tot);
      return { t: t, w: w };
    }
    // simple grid from P(decision) and per-round finish shares (e.g. from FightEngine.predict or the tally)
    function lengthGridSimple(pDec, finByRound, koShare) {
      var R = finByRound.length, S = [], r, ks = koShare == null ? 0.7 : koShare;
      for (r = 0; r < R; r++) S.push(finByRound[r] * ks / 2);
      for (r = 0; r < R; r++) S.push(finByRound[r] * (1 - ks) / 2);
      for (r = 0; r < R; r++) S.push(finByRound[r] * ks / 2);
      for (r = 0; r < R; r++) S.push(finByRound[r] * (1 - ks) / 2);
      S.push(pDec / 2, pDec / 2, 0);
      return lengthGrid(S, R);
    }
    function engineTargets(P, t) {
      if (!enabled) return null;
      return { A: P.rates("A", t), B: P.rates("B", t) };
    }
    return { model: M, which: which, stats: STATS, mlTargets: MLT, enabled: enabled, prepare: prepare,
             lengthGrid: lengthGrid, lengthGridSimple: lengthGridSimple, pit: pit, engineTargets: engineTargets,
             choice: json.choice_js };
  }

  return { load: load, makeDist: makeDist, mixDist: mixDist, pit: pit, lgamma: lgamma, betai: betai, nbCdf: nbCdf };
});
