/* Fight engine v2: a continuous-time Markov model of an MMA bout.
   States: distance, clinch, A on top, B on top. Every landed strike is an event with a target
   (head, body, leg); head strikes carry knockdown risk, body strikes drain cardio, leg kicks cost
   mobility. Rounds go to three judges with individual preferences, scored on the ABC criteria
   (damage first, then dominance and duration). */
(function (root) {
  "use strict";
  var LEAGUE_TD_ACC = 0.37;
  var CL_ENTRY = 0.45 / 60, CL_EXIT = 1 / 15, BOTTOM_RATE = 0.35 / 60;
  var CLINCH_TGT = [0.55, 0.40, 0.05], TOP_TGT = [0.85, 0.15, 0], BOT_TGT = [0.7, 0.3, 0];
  // Averaging two career rates overshoots elite fights; the backtest bias sets this scale.
  var STRIKE_CAL = 0.85;
  // Knockdowns per landed head strike: each fighter's career rate is shrunk toward a league prior
  // worth 300 head strikes, so a short, soft-schedule career doesn't read as cannon power.
  var KD_PRIOR = 0.009, KD_PRIOR_N = 300;
  var FORM_OUT = 0.10, FORM_POW = 0.15, FORM_CHIN = 0.12;

  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function odds(p) { return p / (1 - p); }
  function log5(a, b, l) { var o = odds(a) * odds(b) / odds(l); return o / (1 + o); }
  function norm3(a) { var s = a[0] + a[1] + a[2]; return [a[0] / s, a[1] / s, a[2] / s]; }

  function fighter(o) {
    return {
      name: o.name, slpm: o.slpm, sapm: o.sapm, acc: o.acc || 0.48, def: o.def || 0.55,
      kd15: o.kd15, td15: o.td15 || 0, tdAcc: o.tdAcc || 0.35, tdDef: o.tdDef || 0.65, sub15: o.sub15 || 0,
      head: o.head || 0.62, body: o.body || 0.14, leg: o.leg || 0.24,
      gnp: o.gnp || 3.2, getUp: o.getUp || 40, ctrl: o.ctrl || 1, subDef: o.subDef || 1,
      drain: o.drain || 0.0002, pace: o.pace || [1, 1, 1, 1, 1], mins: o.mins || 150,
      tdAtt15: o.tdAtt15 != null ? o.tdAtt15 : (o.td15 || 0) / Math.max(0.15, o.tdAcc || 0.35)
    };
  }

  var VOLK = fighter({ name: "Volkanovski", mins: 313, slpm: 5.99, sapm: 3.31, acc: 0.57, def: 0.59, kd15: 0.30, td15: 1.63, tdAcc: 0.34, tdDef: 0.68, sub15: 0.20,
    head: 0.63, body: 0.11, leg: 0.26, gnp: 3.4, getUp: 35, ctrl: 0.9, drain: 0.00016, pace: [0.94, 0.98, 1.00, 1.04, 1.10] });
  var GAETHJE = fighter({ name: "Gaethje", mins: 202, slpm: 6.29, sapm: 6.83, acc: 0.576, def: 0.51, kd15: 0.67, td15: 0.30, tdAcc: 0.27, tdDef: 0.73, sub15: 0,
    head: 0.63, body: 0.09, leg: 0.28, gnp: 3.6, getUp: 45, ctrl: 1, subDef: 0.8, drain: 0.00024, pace: [1.05, 1.00, 0.98, 0.97, 0.93] });

  var DEFAULT_KNOBS = { volkChin: 1.15, volkPow: 0.85, volkOut: 0.95, mileage: 0, judgePower: 0.25, volkTd: 3.0, gaeTd: 1.5, gaeLeg: 0.18 };
  var PRESETS = [
    { id: "baseline", label: "Baseline", knobs: {} },
    { id: "tax", label: "155-lb tax", knobs: { volkOut: 0.90, volkPow: 0.75, volkChin: 1.35 } },
    { id: "mileage", label: "Gaethje's mileage", knobs: { mileage: 1 } },
    { id: "wrestle", label: "Volk wrestles", knobs: { volkTd: 7.5 } },
    { id: "prime", label: "Prime Volk", knobs: { volkOut: 1.00, volkPow: 0.95, volkChin: 1.00 } },
    { id: "calves", label: "Gaethje chops calves", knobs: { gaeLeg: 0.32 } },
    { id: "power", label: "Judges reward power", knobs: { judgePower: 0.6 } },
    { id: "volume", label: "Volume-only judges", knobs: { judgePower: 0 } }
  ];
  function presetKnobs(id) {
    var out = {}, k, p = null;
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) p = PRESETS[i];
    for (k in DEFAULT_KNOBS) out[k] = DEFAULT_KNOBS[k];
    if (p) for (k in p.knobs) out[k] = p.knobs[k];
    return out;
  }

  function kdPerHead(F) {
    var heads = F.slpm * F.mins * F.head, kds = F.kd15 / 15 * F.mins;
    return (kds + KD_PRIOR * KD_PRIOR_N) / (heads + KD_PRIOR_N);
  }

  // Build a matchup. A = blue corner, B = red corner.
  function matchup(A, B, mods) {
    mods = mods || {};
    function g(k, d) { return mods[k] != null ? mods[k] : d; }
    var m = { A: A, B: B };
    m.lamA = (A.slpm + B.sapm) / 2 * STRIKE_CAL * g("outA", 1) / 60;
    m.lamB = (B.slpm + A.sapm) / 2 * STRIKE_CAL * g("outB", 1) / 60;
    var kA = kdPerHead(A) * g("powA", 1), kB = kdPerHead(B) * g("powB", 1);
    m.kdA = kA * 0.85; m.kdB = kB * 0.85;
    m.wA = Math.sqrt(kA / 0.0075); m.wB = Math.sqrt(kB / 0.0075);   // damage per landed head strike
    m.durA = g("durA", 1); m.durB = g("durB", 1);
    m.drainA = A.drain * g("drainA", 1); m.drainB = B.drain * g("drainB", 1);
    var legA = g("legA", A.leg), legB = g("legB", B.leg);
    m.tgtA = norm3([Math.max(0.05, 1 - legA - A.body), A.body, legA]);
    m.tgtB = norm3([Math.max(0.05, 1 - legB - B.body), B.body, legB]);
    m.tdA = g("tdAttA", A.tdAtt15) / 900; m.tdB = g("tdAttB", B.tdAtt15) / 900;
    m.pTdA = log5(A.tdAcc, 1 - B.tdDef, LEAGUE_TD_ACC);
    m.pTdB = log5(B.tdAcc, 1 - A.tdDef, LEAGUE_TD_ACC);
    m.subA = A.sub15 / 900 * 6; m.subB = B.sub15 / 900 * 6;
    m.pSubA = 0.22 * B.subDef; m.pSubB = 0.22 * A.subDef;
    m.clinchA = g("clinchA", 0.5);
    m.gamma = g("judgePower", 0.25);
    return m;
  }

  // Knobs -> Volkanovski (A, blue) vs Gaethje (B, red)
  function volkGaethje(k) {
    var mi = k.mileage;
    return matchup(VOLK, GAETHJE, {
      outA: k.volkOut, powA: k.volkPow, durA: k.volkChin,
      outB: 1 - 0.07 * mi, powB: 1 - 0.05 * mi, durB: 1 + 0.20 * mi, drainB: 1 + 0.15 * mi,
      tdAttA: k.volkTd, tdAttB: k.gaeTd, legB: k.gaeLeg, clinchA: 0.45, judgePower: k.judgePower
    });
  }

  function makeRng(seed) {
    var a = seed >>> 0, b = 0x9e3779b9, c = 0x243f6a88, d = (0xb7e15162 ^ seed) >>> 0;
    function next() {
      a >>>= 0; b >>>= 0; c >>>= 0; d >>>= 0;
      var t = (a + b) | 0;
      a = b ^ (b >>> 9); b = (c + (c << 3)) | 0; c = (c << 21) | (c >>> 11); d = (d + 1) | 0;
      t = (t + d) | 0; c = (c + t) | 0;
      return (t >>> 0) / 4294967296;
    }
    for (var i = 0; i < 20; i++) next();
    var spare = null;
    return {
      u: next,
      normal: function () {
        if (spare !== null) { var s = spare; spare = null; return s; }
        var u1 = next(); if (u1 < 1e-300) u1 = 1e-300;
        var u2 = next(), r = Math.sqrt(-2 * Math.log(u1));
        spare = r * Math.sin(2 * Math.PI * u2);
        return r * Math.cos(2 * Math.PI * u2);
      },
      expo: function () { var u = next(); if (u < 1e-300) u = 1e-300; return -Math.log(u); }
    };
  }

  function newRoundStats() {
    return { hA: 0, bA: 0, lA: 0, gA: 0, kdA: 0, rkA: 0, tdA: 0, tdaA: 0, ctrlA: 0, subA: 0,
             hB: 0, bB: 0, lB: 0, gB: 0, kdB: 0, rkB: 0, tdB: 0, tdaB: 0, ctrlB: 0, subB: 0 };
  }

  /* One fight. Returns winner "A" | "B" | "D", method, round, time, cards, and with trace=true
     a round-by-round record of every event for the animation. */
  function simulate(m, rng, trace) {
    var A = m.A, B = m.B;
    // Fight-night form: nobody shows up as their exact career average. Each fight draws output,
    // power and chin for both men, which keeps the sim from being overconfident.
    var fA = Math.exp(FORM_OUT * rng.normal()), fB = Math.exp(FORM_OUT * rng.normal());
    var qA = Math.exp(FORM_POW * rng.normal()), qB = Math.exp(FORM_POW * rng.normal());
    var cA = Math.exp(FORM_CHIN * rng.normal()), cB = Math.exp(FORM_CHIN * rng.normal());
    var lamA = m.lamA * fA, lamB = m.lamB * fB, kdRA = m.kdA * qA, kdRB = m.kdB * qB;
    var dHA = 0, dHB = 0, dLA = 0, dLB = 0, SA = 1, SB = 1, durA = m.durA * cA, durB = m.durB * cB;
    var kdTakenA = 0, kdTakenB = 0;
    var cards = [[0, 0], [0, 0], [0, 0]];
    var jGam = [], jGrap = [];
    for (var j = 0; j < 3; j++) { jGam.push(m.gamma + 0.15 * rng.normal()); jGrap.push(clip(1 + 0.25 * rng.normal(), 0.5, 1.6)); }
    var rounds = trace ? [] : null;
    var fight = { winner: "D", method: "DRAW", round: 5, t: 300, cards: cards, rounds: rounds, totals: newRoundStats(),
      form: { outA: fA, outB: fB, powA: qA, powB: qB, chinA: 1 / cA, chinB: 1 / cB } };
    var TT = fight.totals;

    for (var r = 0; r < 5; r++) {
      var t = 0, state = 0, rockA = -1, rockB = -1, fin = null;
      var st = newRoundStats(), ev = trace ? [] : null;
      var pA = A.pace[r], pB = B.pace[r];
      while (true) {
        var rkA = t < rockA, rkB = t < rockB;
        // Leg kicks cost mobility: a slower man throws less, gets hit more and can't sit down on punches.
        var mobA = clip(1 - 0.006 * dLA, 0.6, 1), mobB = clip(1 - 0.006 * dLB, 0.6, 1);
        var oA = (0.82 + 0.18 * SA) * pA * (0.85 + 0.15 * mobA) * (rkA ? 0.7 : 1);
        var oB = (0.82 + 0.18 * SB) * pB * (0.85 + 0.15 * mobB) * (rkB ? 0.7 : 1);
        var openA = (1 + 1.4 * (1 - mobA)) * (rkA ? 1.3 : 1), openB = (1 + 1.4 * (1 - mobB)) * (rkB ? 1.3 : 1);
        var rSA, rSB, rT = 0, rTdA = 0, rTdB = 0, rSub = 0;
        if (state === 0) {
          rSA = lamA * oA * openB; rSB = lamB * oB * openA;
          rT = CL_ENTRY; rTdA = m.tdA * oA; rTdB = m.tdB * oB;
        } else if (state === 1) {
          rSA = lamA * 0.85 * oA * openB; rSB = lamB * 0.85 * oB * openA;
          rT = CL_EXIT; rTdA = m.tdA * 1.5 * oA; rTdB = m.tdB * 1.5 * oB;
        } else if (state === 2) {
          rSA = A.gnp / 60 * oA; rSB = BOTTOM_RATE; rT = 1 / (B.getUp * A.ctrl); rSub = m.subA;
        } else {
          rSA = BOTTOM_RATE; rSB = B.gnp / 60 * oB; rT = 1 / (A.getUp * B.ctrl); rSub = m.subB;
        }
        var R = rSA + rSB + rT + rTdA + rTdB + rSub;
        var dt = rng.expo() / R;
        var horizon = 300;
        if (rkA && rockA < horizon) horizon = rockA;
        if (rkB && rockB < horizon) horizon = rockB;
        var adv = Math.min(dt, horizon - t);
        SA -= m.drainA * adv * (0.6 + 0.4 * pA); SB -= m.drainB * adv * (0.6 + 0.4 * pB);
        if (state === 2) st.ctrlA += adv; else if (state === 3) st.ctrlB += adv;
        if (t + dt >= horizon) { t = horizon; if (t >= 300) break; continue; }
        t += dt;
        var u = rng.u() * R;
        if (u < rSA + rSB) {
          var byA = u < rSA;
          // ---- a landed strike ----
          var tg = byA ? (state === 0 ? m.tgtA : state === 1 ? CLINCH_TGT : state === 2 ? TOP_TGT : BOT_TGT)
                       : (state === 0 ? m.tgtB : state === 1 ? CLINCH_TGT : state === 3 ? TOP_TGT : BOT_TGT);
          var v = rng.u(), tgt = v < tg[0] ? 0 : (v < tg[0] + tg[1] ? 1 : 2);
          var ground = state >= 2, top = (state === 2 && byA) || (state === 3 && !byA);
          var w = byA ? m.wA : m.wB, kd = false, f = false, hurt = false, legTKO = false;
          if (byA) {
            if (ground) st.gA++; else if (tgt === 0) st.hA++; else if (tgt === 1) st.bA++; else st.lA++;
          } else {
            if (ground) st.gB++; else if (tgt === 0) st.hB++; else if (tgt === 1) st.bB++; else st.lB++;
          }
          if (tgt === 0) {
            var hd = ground ? (top ? 0.8 * w : 0.3 * w) : w;
            if (byA) dHB += hd; else dHA += hd;
            var dH = byA ? dHB : dHA, du = byA ? durB : durA, rk = byA ? rkB : rkA, Sd = byA ? SB : SA;
            var mobD = byA ? mobB : mobA, mobS = byA ? mobA : mobB;
            if (!ground) {
              var pKD = (byA ? kdRA : kdRB) * du * (1 + dH / 200) * (rk ? 1.6 : 1) * (1 + 0.3 * (1 - Sd)) *
                (1 + 0.8 * (1 - mobD)) * (0.75 + 0.25 * mobS);
              var roll = rng.u();
              if (roll < pKD) {
                kd = true;
                var pf = clip(0.28 + 0.0022 * dH + (rk ? 0.15 : 0), 0, 0.68);
                if (rng.u() < pf) f = true;
              } else if (roll < pKD * 2.5) {
                hurt = true;   // wobbled without going down
              }
            } else if (top) {
              var pT = 0.0035 * du * (1 + dH / 200) * (rk ? 2 : 1);
              if (rng.u() < pT) f = true;
            }
          } else if (tgt === 1) {
            if (byA) SB -= 0.006 * w; else SA -= 0.006 * w;
          } else {
            if (byA) dLB += w; else dLA += w;
            var dLd = byA ? dLB : dLA;
            if (dLd > 30 && rng.u() < 0.003 * (dLd - 30) / 10) { f = true; legTKO = true; }
          }
          if (trace) ev.push({ t: t, k: f ? "fin" : (kd ? "kd" : (hurt ? "hurt" : "hit")), w: byA ? "A" : "B", tg: tgt, s: state,
            dA: +dHA.toFixed(1), dB: +dHB.toFixed(1), gA: +dLA.toFixed(1), gB: +dLB.toFixed(1), sA: +SA.toFixed(3), sB: +SB.toFixed(3) });
          if (f) { fin = { by: byA ? "A" : "B", how: ground ? "GNP" : (legTKO ? "LEG" : "KO"), t: t }; break; }
          if (kd) {
            if (byA) { st.kdA++; kdTakenB++; dHB += 14; durB *= 1.12; rockB = t + 25; }
            else { st.kdB++; kdTakenA++; dHA += 14; durA *= 1.12; rockA = t + 25; }
            if (state !== 0) { state = 0; if (trace) ev.push({ t: t, k: "reset", s: 0 }); }
          } else if (hurt) {
            if (byA) { st.rkA++; dHB += 5; rockB = Math.max(rockB, t + 12); }
            else { st.rkB++; dHA += 5; rockA = Math.max(rockA, t + 12); }
          }
        } else if ((u -= rSA + rSB) < rT) {
          var from = state;
          state = state === 0 ? 1 : 0;
          if (trace) ev.push({ t: t, k: from === 0 ? "clinch" : (from === 1 ? "break" : "up"), w: from === 0 ? (rng.u() < m.clinchA ? "A" : "B") : (from === 2 ? "B" : from === 3 ? "A" : ""), s: state });
        } else if ((u -= rT) < rTdA + rTdB) {
          var aShoots = u < rTdA, pS = (aShoots ? m.pTdA : m.pTdB) * (state === 1 ? 1.15 : 1);
          if (aShoots) st.tdaA++; else st.tdaB++;
          var ok = rng.u() < pS;
          if (ok) { if (aShoots) st.tdA++; else st.tdB++; state = aShoots ? 2 : 3; }
          if (trace) ev.push({ t: t, k: ok ? "td" : "tdx", w: aShoots ? "A" : "B", s: state });
        } else {
          var topA = state === 2;
          if (topA) st.subA++; else st.subB++;
          var won = rng.u() < (topA ? m.pSubA : m.pSubB);
          if (trace) ev.push({ t: t, k: won ? "sub" : "subx", w: topA ? "A" : "B", s: state });
          if (won) { fin = { by: topA ? "A" : "B", how: "SUB", t: t }; break; }
        }
      }

      for (var key in st) TT[key] += st[key];
      var rec = trace ? { r: r, ev: ev, st: st, fin: fin, dHA: dHA, dHB: dHB, dLA: dLA, dLB: dLB, SA: SA, SB: SB } : null;
      if (fin) {
        if (trace) rounds.push(rec);
        fight.winner = fin.by; fight.method = fin.how; fight.round = r + 1; fight.t = fin.t;
        return fight;
      }

      // ---- judges: damage first, then dominance and duration ----
      var js = trace ? [] : null;
      var baseA = st.hA + 0.8 * st.bA + 0.55 * st.lA + 0.85 * st.gA, baseB = st.hB + 0.8 * st.bB + 0.55 * st.lB + 0.85 * st.gB;
      var grA = 3 * st.tdA + 0.06 * st.ctrlA + 7 * st.subA, grB = 3 * st.tdB + 0.06 * st.ctrlB + 7 * st.subB;
      var tot0 = baseA + baseB + grA + grB + 12 * (st.kdA + st.kdB) + 4 * (st.rkA + st.rkB) + 1;
      var shared = rng.normal() * 0.05 * tot0, gap = st.kdA - st.kdB;
      for (j = 0; j < 3; j++) {
        var iA = baseA * Math.pow(m.wA, jGam[j]) + 12 * st.kdA + 4 * st.rkA + grA * jGrap[j];
        var iB = baseB * Math.pow(m.wB, jGam[j]) + 12 * st.kdB + 4 * st.rkB + grB * jGrap[j];
        var dd = iA - iB + shared + rng.normal() * (0.09 * (iA + iB) + 1);
        var aw = dd > 0, big = aw ? (gap >= 2 || (gap >= 1 && iA > 2.2 * iB && iA > 20)) : (gap <= -2 || (gap <= -1 && iB > 2.2 * iA && iB > 20));
        var sa = aw ? 10 : (big ? 8 : 9), sb = aw ? (big ? 8 : 9) : 10;
        cards[j][0] += sa; cards[j][1] += sb;
        if (trace) js.push([sa, sb]);
      }
      if (trace) { rec.judges = js; rounds.push(rec); }

      // ---- between rounds ----
      SA += 0.5 * (1 - SA); SB += 0.5 * (1 - SB);
      if (r < 4) {
        var psA = clip((dHA - 100) / 400, 0, 0.3) + 0.06 * Math.max(0, kdTakenA - 1);
        var psB = clip((dHB - 100) / 400, 0, 0.3) + 0.06 * Math.max(0, kdTakenB - 1);
        var stA = rng.u() < psA, stB = rng.u() < psB;
        if (stA || stB) {
          var wnr = (stA && stB) ? (rng.u() < 0.5 ? "A" : "B") : (stA ? "B" : "A");
          if (trace) rec.stoppage = wnr;
          fight.winner = wnr; fight.method = "CORNER"; fight.round = r + 1; fight.t = 300;
          return fight;
        }
      }
    }
    var ja = 0, jb = 0;
    for (var q = 0; q < 3; q++) { if (cards[q][0] > cards[q][1]) ja++; else if (cards[q][1] > cards[q][0]) jb++; }
    var dr = 3 - ja - jb;
    if (ja >= 2) { fight.winner = "A"; fight.method = ja === 3 ? "UD" : (jb === 1 ? "SD" : "MD"); }
    else if (jb >= 2) { fight.winner = "B"; fight.method = jb === 3 ? "UD" : (ja === 1 ? "SD" : "MD"); }
    else { fight.winner = "D"; fight.method = dr === 3 ? "UD" : (dr === 2 ? "MD" : "SD"); }
    return fight;
  }

  // Outcome buckets: 0..6 = A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO
  function bucket(f) {
    if (f.winner === "D") return 3;
    var k = (f.method === "KO" || f.method === "GNP" || f.method === "CORNER" || f.method === "LEG") ? 0 : (f.method === "SUB" ? 1 : 2);
    return f.winner === "A" ? k : 6 - k;
  }

  var api = { fighter: fighter, VOLK: VOLK, GAETHJE: GAETHJE, matchup: matchup, volkGaethje: volkGaethje,
    DEFAULT_KNOBS: DEFAULT_KNOBS, PRESETS: PRESETS, presetKnobs: presetKnobs, makeRng: makeRng,
    simulate: simulate, bucket: bucket, clip: clip, log5: log5, kdPerHead: kdPerHead };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FightEngine = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
