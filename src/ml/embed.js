/* Fighter embeddings: offense / defense latent vectors and the multi-task factor model that produced them
   (tools/embed.py -> data/derived/embed_model.json; research/model_embed.md).

   Each fighter has an offense vector o and a defense vector d (K dims each, axes named in model.axes). For
   attacker X against defender Y, task t (strike attempts by position and target, accuracies, knockdowns per
   landed head strike, takedowns, control, submission attempts, reversals, KO/TKO and submission finish
   hazards) has the linear predictor

       eta_t = C_t[0] + C_t[1 + division] + C_t[era] * era + C_t[five] * fiveRound + W_t . o_X + V_t . d_Y

   with a log link for rates (per fight minute; knockdowns per landed head strike) and a logit link for
   accuracies. The win head is antisymmetric (no intercept): swap A and B -> 1 - p.

       logit P(A beats B) = ua.(oA - oB) + ud.(dA - dB) + oA' M dB - oB' M dA

   Usage (Node or Web Worker, no dependencies):
     var E = FightEmbed.load(modelJson);              // data/derived/embed_model.json
     var r = E.matchup("alexander-volkanovski", "justin-gaethje", { division: "Lightweight", rounds: 5 });
     r.pA          P(A wins) from the embedding head (one input for a stacker, not a final forecast)
     r.ratesA      A's expected per-minute stat line against B: sig_att, sig_lnd, h_lnd, b_lnd, l_lnd, kd,
                   td_att, td_lnd, ctrl (seconds / min), sub_att, ko_haz, sub_haz (finish hazards / min)
     r.ratesB      the same for B against A
     r.etaA/etaB   the raw task linear predictors (model.tasks order)
     E.embedding(slug)       {o, d, expo} (expo = decayed fight count behind it; 0 = no UFC data -> zeros)
     E.neighbours(slug, k)   nearest roster fighters by distance between predicted-stat profiles (model.nn_Q)
     E.winLogit(ea, eb), E.eta(ex, ey, division, opts), E.rates(eta)   low-level pieces

   UMD: module.exports in Node, self.FightEmbed in a browser or Web Worker. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FightEmbed = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";

  var ERA_REF = Date.UTC(2015, 0, 1);
  var DAY = 86400000;

  function sig(x) { return 1 / (1 + Math.exp(-x)); }

  function dot(a, b, off, n) {
    var s = 0;
    for (var i = 0; i < n; i++) s += a[i] * b[off + i];
    return s;
  }

  function load(json) {
    var m = json && json.model ? json.model : json;
    var K = m.K, NT = m.tasks.length, NDIV = m.divs.length;
    var ti = {};
    m.tasks.forEach(function (t, i) { ti[t[0]] = i; });
    var di = {};
    m.divs.forEach(function (d, i) { di[d] = i; });

    function eraOf(opts) {
      if (opts && typeof opts.era === "number") return opts.era;
      var t = opts && opts.date ? Date.parse(opts.date) : Date.parse(m.era_date);
      return (t - ERA_REF) / DAY / 3652.5;
    }

    function divIndex(division) {
      if (division in di) return di[division];
      return di[m.default_division];
    }

    /** Embedding as one array [o (K), d (K)]; zeros for a fighter without UFC data. */
    function vec(slugOrVec) {
      if (Array.isArray(slugOrVec)) return slugOrVec;
      var r = m.roster[slugOrVec];
      if (!r) { var z = []; for (var i = 0; i < 2 * K; i++) z.push(0); return z; }
      return r[0];
    }

    /** Task linear predictors for attacker ex against defender ey (each [o, d], length 2K). */
    function eta(ex, ey, division, opts) {
      ex = vec(ex); ey = vec(ey);
      var dv = divIndex(division), era = eraOf(opts);
      var five = opts && (opts.rounds === 5 || opts.five) ? 1 : 0;
      var out = new Array(NT);
      for (var t = 0; t < NT; t++) {
        var C = m.C[t];
        var s = C[0] + C[1 + dv] + C[NDIV + 1] * era + C[NDIV + 2] * five;
        var Wt = m.W[t], Vt = m.V[t];
        for (var k = 0; k < K; k++) s += Wt[k] * ex[k] + Vt[k] * ey[K + k];
        out[t] = s;
      }
      return out;
    }

    /** Per-minute expected stat line of the attacker from the task linear predictors. */
    function rates(e) {
      function E(t) { return Math.exp(e[ti[t]]); }
      function P(t) { return sig(e[ti[t]]); }
      var r = {};
      r.sig_att = E("d_att") + E("c_att") + E("g_att");
      r.sig_lnd = E("d_att") * P("d_acc") + E("c_att") * P("c_acc") + E("g_att") * P("g_acc");
      r.h_lnd = E("h_att") * P("h_acc");
      r.b_lnd = E("b_att") * P("b_acc");
      r.l_lnd = E("l_att") * P("l_acc");
      r.kd = r.h_lnd * E("kd");
      r.td_att = E("td_att");
      r.td_lnd = E("td_att") * P("td_acc");
      r.ctrl = 60 * E("ctrl");
      r.sub_att = E("sub_att");
      r.ko_haz = E("ko_fin");
      r.sub_haz = E("sub_fin");
      return r;
    }

    /** Antisymmetric win logit of a over b from the embedding head. */
    function winLogit(ea, eb) {
      ea = vec(ea); eb = vec(eb);
      var s = 0, k, l;
      for (k = 0; k < K; k++) s += m.ua[k] * (ea[k] - eb[k]) + m.ud[k] * (ea[K + k] - eb[K + k]);
      for (k = 0; k < K; k++) {
        var row = m.M[k];
        for (l = 0; l < K; l++) s += row[l] * (ea[k] * eb[K + l] - eb[k] * ea[K + l]);
      }
      return s;
    }

    function embedding(slug) {
      var r = m.roster[slug];
      if (!r) return null;
      return { o: r[0].slice(0, K), d: r[0].slice(K), expo: r[1] };
    }

    function matchup(a, b, opts) {
      opts = opts || {};
      var division = opts.division || m.default_division;
      var ea = vec(a), eb = vec(b);
      var etaA = eta(ea, eb, division, opts), etaB = eta(eb, ea, division, opts);
      var z = winLogit(ea, eb);
      return { pA: sig(z), logit: z, etaA: etaA, etaB: etaB, ratesA: rates(etaA), ratesB: rates(etaB) };
    }

    function neighbours(slug, k, minExpo) {
      k = k || 10;
      minExpo = minExpo == null ? m.nn_min_expo : minExpo;
      var me = m.roster[slug];
      if (!me) return [];
      var out = [], Q = m.nn_Q, diff = new Array(2 * K);
      for (var s in m.roster) {
        if (s === slug) continue;
        var r = m.roster[s];
        if (r[1] < minExpo) continue;
        var d2 = 0, i, j;
        if (Q) {
          for (i = 0; i < 2 * K; i++) diff[i] = r[0][i] - me[0][i];
          for (i = 0; i < 2 * K; i++) for (j = 0; j < 2 * K; j++) d2 += diff[i] * Q[i][j] * diff[j];
        } else {
          for (i = 0; i < 2 * K; i++) { var q = r[0][i] - me[0][i]; d2 += q * q; }
        }
        out.push([s, Math.sqrt(Math.max(0, d2))]);
      }
      out.sort(function (x, y) { return x[1] - y[1]; });
      return out.slice(0, k);
    }

    return { model: m, K: K, tasks: m.tasks, axes: m.axes, eta: eta, rates: rates, winLogit: winLogit,
             embedding: embedding, matchup: matchup, neighbours: neighbours, vec: vec };
  }

  return { load: load, sig: sig };
});
