/* Volkanovski vs Gaethje fight model: browser port of volk_gaethje_sim.py.
   Same equations and defaults as the Python run (200,000 fights per scenario). */
(function (root) {
  "use strict";

  var MODEL = {
    V: { slpm: 5.99, sapm: 3.31, kd15: 0.30, tdacc: 0.34, tddef: 0.70 }, // Volkanovski
    G: { slpm: 6.29, sapm: 6.83, kd15: 0.67, tdacc: 0.27, tddef: 0.73 }, // Gaethje
    VOLK_PACE: [1.00, 1.00, 1.02, 1.05, 1.106],
    GAE_PACE: [1.04, 1.00, 0.98, 0.95, 0.92]
  };

  var DEFAULT_KNOBS = { volkOut: 0.95, volkPow: 0.85, volkDur: 1.15, mileage: 0, judgeW: 1.10, volkTd: 0.8, gaeTd: 0.6 };

  var PRESETS = [
    { id: "baseline", label: "Baseline", knobs: {} },
    { id: "tax", label: "155-lb tax", knobs: { volkOut: 0.90, volkPow: 0.75, volkDur: 1.35 } },
    { id: "mileage", label: "Gaethje's mileage", knobs: { mileage: 1 } },
    { id: "wrestle", label: "Volk wrestles", knobs: { volkTd: 2.5 } },
    { id: "prime", label: "Prime Volk", knobs: { volkOut: 1.00, volkPow: 0.95, volkDur: 1.00 } },
    { id: "power", label: "Judges reward power", knobs: { judgeW: 1.25 } },
    { id: "volume", label: "Volume-only judges", knobs: { judgeW: 1.00 } }
  ];

  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function presetKnobs(id) {
    var out = {}, k, p = null;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) p = PRESETS[i];
    for (k in DEFAULT_KNOBS) out[k] = DEFAULT_KNOBS[k];
    if (p) for (k in p.knobs) out[k] = p.knobs[k];
    return out;
  }

  // Knobs -> model parameters. Mileage 1.0 equals the Python "Gaethje's mileage" scenario.
  function deriveParams(k) {
    var m = k.mileage;
    return {
      volkOut: k.volkOut, volkPow: k.volkPow, volkDur: k.volkDur,
      gaeOut: 1 - 0.07 * m, gaePow: 1 - 0.05 * m, gaeDur: 1 + 0.20 * m,
      volkTd: k.volkTd, gaeTd: k.gaeTd, judgeW: k.judgeW
    };
  }

  // sfc32 generator with normal, exponential, Poisson and binomial draws
  function makeRng(seed) {
    var a = seed >>> 0, b = 0x9e3779b9, c = 0x243f6a88, d = (0xb7e15162 ^ seed) >>> 0;
    function next() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ (b >>> 9);
      b = (c + (c << 3)) | 0;
      c = (c << 21) | (c >>> 11);
      d = (d + 1) | 0;
      t = (t + d) | 0;
      c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (var i = 0; i < 20; i++) next();
    var spare = null;
    var rng = {
      u: next,
      normal: function () {
        if (spare !== null) { var s = spare; spare = null; return s; }
        var u1 = next(); if (u1 < 1e-300) u1 = 1e-300;
        var u2 = next(), r = Math.sqrt(-2 * Math.log(u1));
        spare = r * Math.sin(2 * Math.PI * u2);
        return r * Math.cos(2 * Math.PI * u2);
      },
      expo: function () { var u = next(); if (u < 1e-300) u = 1e-300; return -Math.log(u); },
      poisson: function (lam) {
        if (!(lam > 0)) return 0;
        if (lam < 60) {
          var L = Math.exp(-lam), k = 0, p = 1;
          do { k++; p *= next(); } while (p > L);
          return k - 1;
        }
        var x = Math.round(lam + Math.sqrt(lam) * rng.normal());
        return x < 0 ? 0 : x;
      },
      binom: function (n, p) { var s = 0; for (var i = 0; i < n; i++) if (next() < p) s++; return s; }
    };
    return rng;
  }

  // One five-round fight. With trace=true it also returns a round-by-round record for animation.
  function simulateFight(P, rng, trace) {
    var V = MODEL.V, G = MODEL.G;
    var lamV = (V.slpm + G.sapm) / 2 * P.volkOut / 60;
    var lamG = (G.slpm + V.sapm) / 2 * P.gaeOut / 60;
    var kdV = V.kd15 / (V.slpm * 15) * P.volkPow;
    var kdG = G.kd15 / (G.slpm * 15) * P.gaePow;
    var pTDV = (V.tdacc + 1 - G.tddef) / 2;
    var pTDG = (G.tdacc + 1 - V.tddef) / 2;
    var dmgV = 0, dmgG = 0, durV = P.volkDur, durG = P.gaeDur, legV = 1, legG = 1;
    var cards = [[0, 0], [0, 0], [0, 0]];
    var rounds = trace ? [] : null;
    var gnp = 2 / 60;

    for (var i = 0; i < 5; i++) {
      var tdV = rng.binom(rng.poisson(P.volkTd), pTDV);
      var tdG = rng.binom(rng.poisson(P.gaeTd), pTDG);
      var ctrlV = 0, ctrlG = 0, k;
      for (k = 0; k < tdV; k++) ctrlV += rng.expo() * 45;
      for (k = 0; k < tdG; k++) ctrlG += rng.expo() * 40;
      var ground = ctrlV + ctrlG;
      if (ground > 200) { var sh = 200 / ground; ctrlV *= sh; ctrlG *= sh; }
      var stand = 300 - ctrlV - ctrlG;

      var sV = lamV * MODEL.VOLK_PACE[i] * clip(1 - 0.0012 * dmgV, 0.5, 1) * legV;
      var sG = lamG * MODEL.GAE_PACE[i] * clip(1 - 0.0012 * dmgG, 0.5, 1) * legG;
      var pkV = kdV * durG * (1 + dmgG / 250);
      var pkG = kdG * durV * (1 + dmgV / 250);
      var pfV = clip(0.25 + 0.001 * dmgG, 0, 0.55);
      var pfG = clip(0.25 + 0.001 * dmgV, 0, 0.55);

      var koV = sV * stand * pkV * pfV + gnp * ctrlV * 0.006 * durG * (1 + dmgG / 250);
      var koG = sG * stand * pkG * pfG + gnp * ctrlG * 0.006 * durV * (1 + dmgV / 250);
      var subV = 0.0202 * tdV, subG = 0.0101 * tdG;
      var EV = koV + subV, EG = koG + subG;
      var tV = rng.expo() / Math.max(EV, 1e-12);
      var tG = rng.expo() / Math.max(EG, 1e-12);

      var rd = trace ? { i: i, tdV: tdV, tdG: tdG, ctrlV: ctrlV, ctrlG: ctrlG, dmgStartV: dmgV, dmgStartG: dmgG } : null;
      var by = null, frac = 0, isSub = false;
      if (tV < 1 && tV < tG) { by = "V"; frac = tV; isSub = rng.u() < subV / Math.max(EV, 1e-12); }
      else if (tG < 1 && tG <= tV) { by = "G"; frac = tG; isSub = rng.u() < subG / Math.max(EG, 1e-12); }
      if (by) {
        if (trace) {
          rd.finish = { by: by, method: isSub ? "SUB" : "KO", t: frac };
          rd.strV = rng.poisson(sV * stand * frac); rd.strG = rng.poisson(sG * stand * frac);
          rd.gV = rng.poisson(gnp * ctrlV * frac); rd.gG = rng.poisson(gnp * ctrlG * frac);
          rd.kdnV = rng.poisson(sV * stand * frac * pkV * (1 - pfV));
          rd.kdnG = rng.poisson(sG * stand * frac * pkG * (1 - pfG));
          rounds.push(rd);
        }
        return { winner: by, method: isSub ? "SUB" : "KO", round: i + 1, t: frac, cards: cards, rounds: rounds };
      }

      var strV = rng.poisson(sV * stand), strG = rng.poisson(sG * stand);
      var gV = rng.poisson(gnp * ctrlV), gG = rng.poisson(gnp * ctrlG);
      var kdnV = rng.poisson(sV * stand * pkV * (1 - pfV));
      var kdnG = rng.poisson(sG * stand * pkG * (1 - pfG));

      var ptsV = strV + 0.8 * gV + 10 * kdnV + ctrlV / 20 + 1.5 * tdV;
      var ptsG = P.judgeW * strG + 0.8 * gG + 10 * kdnG + ctrlG / 20 + 1.5 * tdG;
      var tot = ptsV + ptsG + 1;
      var shared = rng.normal() * 0.07 * tot;
      var gap = kdnV - kdnG;
      var js = trace ? [] : null;
      for (var j = 0; j < 3; j++) {
        var dd = ptsV - ptsG + shared + rng.normal() * (0.10 * tot + 1);
        var vr = dd > 0;
        var vp = vr ? 10 : (gap <= -2 ? 8 : 9);
        var gp = vr ? (gap >= 2 ? 8 : 9) : 10;
        cards[j][0] += vp; cards[j][1] += gp;
        if (trace) js.push([vp, gp]);
      }

      dmgG += P.volkPow * strV + gV + 15 * kdnV;
      dmgV += 1.25 * P.gaePow * strG + gG + 15 * kdnG;
      durG *= Math.pow(1.15, kdnV); durV *= Math.pow(1.15, kdnG);
      legV *= 1 - 0.004 * 0.23 * strG; legG *= 1 - 0.004 * 0.15 * strV;

      if (trace) {
        rd.strV = strV; rd.strG = strG; rd.gV = gV; rd.gG = gG; rd.kdnV = kdnV; rd.kdnG = kdnG;
        rd.judges = js; rd.dmgV = dmgV; rd.dmgG = dmgG;
        rounds.push(rd);
      }

      if (i < 4) {
        var stV = rng.u() < clip((dmgV - 110) / 350, 0, 0.4);
        var stG = rng.u() < clip((dmgG - 110) / 350, 0, 0.4);
        if (stV || stG) {
          var w = (stV && stG) ? (rng.u() < 0.5 ? "G" : "V") : (stV ? "G" : "V");
          if (trace) rd.stoppage = { by: w };
          return { winner: w, method: "CORNER", round: i + 1, t: 1, cards: cards, rounds: rounds };
        }
      }
    }

    var jv = 0, jg = 0;
    for (var q = 0; q < 3; q++) { if (cards[q][0] > cards[q][1]) jv++; else if (cards[q][1] > cards[q][0]) jg++; }
    var draws = 3 - jv - jg;
    if (jv >= 2) return { winner: "V", method: jv === 3 ? "UD" : (jg === 1 ? "SD" : "MD"), round: 5, t: 1, cards: cards, rounds: rounds };
    if (jg >= 2) return { winner: "G", method: jg === 3 ? "UD" : (jv === 1 ? "SD" : "MD"), round: 5, t: 1, cards: cards, rounds: rounds };
    return { winner: "D", method: draws === 3 ? "UD" : (draws === 2 ? "MD" : "SD"), round: 5, t: 1, cards: cards, rounds: rounds };
  }

  // Outcome bucket used by the tally: 0..6 = Volk KO, Volk sub, Volk dec, draw, Gaethje dec, Gaethje sub, Gaethje KO
  function bucket(r) {
    if (r.winner === "D") return 3;
    var fin = r.method === "KO" || r.method === "CORNER" ? 0 : (r.method === "SUB" ? 1 : 2);
    return r.winner === "V" ? fin : 6 - fin;
  }

  var api = {
    MODEL: MODEL, DEFAULT_KNOBS: DEFAULT_KNOBS, PRESETS: PRESETS, clip: clip,
    presetKnobs: presetKnobs, deriveParams: deriveParams, makeRng: makeRng,
    simulateFight: simulateFight, bucket: bucket
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FightModel = api;
})(typeof window !== "undefined" ? window : globalThis);
