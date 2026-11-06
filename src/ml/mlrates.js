/* mlrates: learned matchup stat-line model for fight engine v3 (dependency-free evaluator).
   Model: data/derived/mlrates.json (built by tools/mlrates.py; report research/model_mlrates.md).

   MLRates.load(json)                       -> model handle (also MLRates.setModel)
   MLRates.predict(model, profA, profB, ctx) -> { A: rates, B: rates } expected per-minute rates and probabilities
                                               for each side attacking the other (symmetric: no corner input)
   MLRates.features(X, Y, ctx, P)           -> the feature vector (for tests)
   MLRates.engineExpect(m)                  -> engine v3's own static expectation for a FightEngine.matchup() object
   MLRates.applyToMatchup(m, pred, opts)    -> rewrites the matchup's rate tables in place so the simulator plays the
                                               ML-predicted rates (attempts by position and target, accuracy, KD,
                                               takedowns, control, submissions, reversals); needs FightEngine
                                               (global, or opts.engine) for the occupancy refit
   MLRates.matchup(FE, profA, profB, opts)  -> FE.matchup(...) followed by predict + applyToMatchup (one call)

   Profiles: fighters.json entries or backtest sides ({S, keys?, age | dob, n | n_fights, elo, ko_losses, home |
   division, height_in, reach_in, stance, layoff (days) | last_fight}). ctx: {division, rounds, title, date | year,
   priors (division -> priors object, as in fighters.json), prior_division?}.
   UMD: module.exports in Node, self.MLRates in a browser or Web Worker. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.MLRates = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";

  var KEYS = ["min", "n", "rds", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "h_att", "h_lnd", "b_att", "b_lnd",
    "l_att", "l_lnd", "t_att", "t_lnd", "od_att", "od_lnd", "oc_att", "oc_lnd", "og_att", "og_lnd", "oh_att", "oh_lnd",
    "ob_att", "ob_lnd", "ol_att", "ol_lnd", "ot_att", "ot_lnd", "kd", "okd", "td_att", "td_lnd", "otd_att", "otd_lnd",
    "ctrl", "octrl", "sub_att", "osub_att", "rev", "orev", "ko_w", "ko_l", "sub_w", "sub_l", "dec_w", "dec_l",
    "r5_min", "r5_min_1", "r5_min_2", "r5_min_3", "r5_min_4", "r5_min_5", "r5_lnd_1", "r5_lnd_2", "r5_lnd_3", "r5_lnd_4", "r5_lnd_5"];
  var LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
    "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115,
    "Women's Flyweight": 125, "Women's Bantamweight": 135, "Women's Featherweight": 145 };
  var WOMEN = { "Women's Strawweight": 1, "Women's Flyweight": 1, "Women's Bantamweight": 1, "Women's Featherweight": 1 };
  var OFF = ["d", "c", "g", "h", "b", "l", "t", "ah", "ab", "al", "ad", "ac", "ag", "kd", "tda", "tdp", "ctrl",
    "cpt", "sub", "subm", "rev", "fko", "fsub"];
  var COMBOS = ["d", "c", "g", "h", "b", "l", "t", "ah", "ab", "al", "ad", "ac", "ag", "kd", "tda", "tdp", "ctrl",
    "sub", "subm", "rev"];
  var TNAMES = ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "td_att", "sub_att", "rev", "ctrl",
    "acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g", "td_acc", "kd_h"];
  var BASE_KEY = { d_att: "d_att", c_att: "c_att", g_att: "g_att", h_att: "h_att", b_att: "b_att", l_att: "l_att",
    td_att: "td_att", sub_att: "sub_att", rev: "rev", ctrl: "ctrl", acc_h: "acc_h", acc_b: "acc_b", acc_l: "acc_l",
    acc_d: "acc_d", acc_c: "acc_c", acc_g: "acc_g", td_acc: "td_acc", kd_h: "kd_per_h" };
  var DEFAULT_FC = { gs: 0.84, kPM: 40, kAcc: 150, kTdPM: 45, kTdAcc: 12, kKD: 230, kCtrlTD: 4, kRev: 40, kFin: 3, bot: 0.12, layMed: 168 };
  var MODEL = null;

  // ------------------------------------------------------------------ small math (mirrors tools/mlrates.py)
  function shr(ev, ex, prior, k) { return (ev + k * prior) / (Math.max(0, ex) + k); }
  function lr(a, b) { return Math.log(Math.max(a, 1e-9) / Math.max(b, 1e-9)); }
  function lgt(p) { p = Math.min(Math.max(p, 1e-6), 1 - 1e-6); return Math.log(p / (1 - p)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  function pget(P, k, d) { var v = P[k]; return v == null ? (d == null ? 0 : d) : +v; }
  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }

  function sumsOf(prof) {
    var S = prof.S, keys = prof.keys || KEYS, o = {}, i;
    for (i = 0; i < KEYS.length; i++) o[KEYS[i]] = 0;
    if (Array.isArray(S)) { for (i = 0; i < keys.length && i < S.length; i++) o[keys[i]] = +S[i] || 0; }
    else if (S) { for (var k in S) o[k] = +S[k] || 0; }
    return o;
  }

  function priorFor(division, priors) {
    var all = priors.ALL || {}, d = priors[division] || all, out = {}, k;
    for (k in all) out[k] = all[k];
    for (k in d) if (d[k] != null) out[k] = d[k];
    return out;
  }

  function league(P, FC) {
    var gs = FC.gs, cf = pget(P, "ctrl") / 60, Lg = 2 * cf * gs, Lc = 2 * cf * (1 - gs), Ld = 1 - Lg - Lc;
    return { Lg: Lg, Lc: Lc, Ld: Ld, Ls: 1 - Lg, Lt: cf * gs,
      dAtt: pget(P, "d_att") / Ld, gAtt: pget(P, "g_att") / Math.max(cf * gs, 1e-6),
      tdAtt: pget(P, "td_att") / (1 - Lg), sub: pget(P, "sub_att") / Math.max(Lg, 1e-6),
      rev: pget(P, "rev") / Math.max(cf * gs, 1e-6) };
  }

  function fighterBlock(s, P, L, FC) {
    var gs = FC.gs, kPM = FC.kPM, kAcc = FC.kAcc, mn = Math.max(0, s.min);
    var topMin = s.ctrl / 60 * gs, botMin = s.octrl / 60 * gs, grMin = topMin + botMin;
    var clMin = (s.ctrl + s.octrl) / 60 * (1 - gs);
    var distMin = Math.max(0.25 * mn, mn - grMin - clMin), standMin = Math.max(0.3 * mn, mn - grMin);
    var nf = Math.max(0, s.n);
    var pko = pget(P, "ko_w") / Math.max(pget(P, "n"), 1e-9), psub = pget(P, "sub_w") / Math.max(pget(P, "n"), 1e-9);
    function side(o) {
      function g(k) { return s[o + k]; }
      var r = [], k, i;
      r.push(lr(shr(g("d_att"), distMin, L.dAtt, kPM * L.Ld), L.dAtt));
      r.push(lr(shr(g("c_att"), mn, pget(P, "c_att"), kPM), pget(P, "c_att")));
      r.push(lr(shr(g("g_att"), o ? botMin : topMin, L.gAtt, kPM * L.Lt), L.gAtt));
      var t4 = ["h", "b", "l", "t"];
      for (i = 0; i < 4; i++) { k = t4[i]; r.push(lr(shr(g(k + "_att"), mn, pget(P, k + "_att"), kPM), pget(P, k + "_att"))); }
      var a6 = ["h", "b", "l", "d", "c", "g"];
      for (i = 0; i < 6; i++) { k = a6[i]; var pa = pget(P, "acc_" + k, 0.5); r.push(lgt(shr(g(k + "_lnd"), g(k + "_att"), pa, kAcc)) - lgt(pa)); }
      var kdp = pget(P, "kd_per_h", 0.01);
      r.push(lr(shr(g("kd"), g("h_lnd"), kdp, FC.kKD), kdp));
      r.push(lr(shr(g("td_att"), standMin, L.tdAtt, FC.kTdPM * L.Ls), L.tdAtt));
      var ta = pget(P, "td_acc", 0.35);
      r.push(lgt(shr(g("td_lnd"), g("td_att"), ta, FC.kTdAcc)) - lgt(ta));
      r.push(lr(shr(g("ctrl"), mn, pget(P, "ctrl"), kPM), pget(P, "ctrl")));
      var cpt = pget(P, "ctrl_per_td", 100);
      r.push(lr(shr(g("ctrl"), g("td_lnd"), cpt, FC.kCtrlTD), cpt));
      r.push(lr(shr(g("sub_att"), grMin, L.sub, kPM * L.Lg), L.sub));
      r.push(lr(shr(g("sub_att"), mn, pget(P, "sub_att"), kPM), pget(P, "sub_att")));
      r.push(lr(shr(g("rev"), o ? topMin : botMin, L.rev, FC.kRev * L.Lt), L.rev));
      if (o) { r.push(lr(shr(s.ko_l, nf, pko, FC.kFin), pko)); r.push(lr(shr(s.sub_l, nf, psub, FC.kFin), psub)); }
      else { r.push(lr(shr(s.ko_w, nf, pko, FC.kFin), pko)); r.push(lr(shr(s.sub_w, nf, psub, FC.kFin), psub)); }
      return r;
    }
    return { off: side(""), dfn: side("o"),
      ev: [Math.log1p(mn), Math.log1p(nf), Math.log1p(s.h_att + s.oh_att), Math.log1p(s.td_att + s.otd_att)] };
  }

  function stanceCode(st) {
    st = String(st || "").toLowerCase();
    return st.indexOf("south") === 0 ? 1 : (st.indexOf("switch") === 0 ? 2 : (st.indexOf("ortho") === 0 ? 0 : -1));
  }

  // X, Y: normalized sides {s (sums), age, n, elo, ko_losses, home, height_in, reach_in, stance, layoff}
  function features(X, Y, ctx, P, FC) {
    FC = FC || (MODEL && MODEL.fc) || DEFAULT_FC;
    var L = league(P, FC), bx = fighterBlock(X.s, P, L, FC), by = fighterBlock(Y.s, P, L, FC);
    var f = [].concat(bx.off, bx.dfn, by.off, by.dfn, bx.ev, by.ev), io = {}, i;
    for (i = 0; i < OFF.length; i++) io[OFF[i]] = i;
    var cm = {};
    for (i = 0; i < COMBOS.length; i++) { var c = bx.off[io[COMBOS[i]]] + by.dfn[io[COMBOS[i]]]; f.push(c); cm[COMBOS[i]] = c; }
    var gs = FC.gs, Pc = pget(P, "ctrl");
    var ctrlX = Pc * Math.exp(cm.ctrl), ctrlY = Pc * Math.exp(by.off[io.ctrl] + bx.dfn[io.ctrl]);
    var grX = Math.min(0.7, ctrlX / 60 * gs), grY = Math.min(0.7, ctrlY / 60 * gs), clT = (ctrlX + ctrlY) / 60 * (1 - gs);
    var dist = Math.max(0.12, 1 - grX - grY - clT), stand = Math.max(0.2, 1 - grX - grY);
    f.push(Math.log(dist), Math.log(grX + 1e-3), Math.log(grY + 1e-3), Math.log(clT + 1e-3),
      Math.log(L.dAtt) + cm.d + Math.log(dist),
      Math.log(pget(P, "c_att")) + cm.c,
      Math.log(L.gAtt) + cm.g + Math.log(grX + FC.bot * grY + 1e-3),
      Math.log(pget(P, "h_att")) + cm.h,
      Math.log(pget(P, "b_att")) + cm.b,
      Math.log(pget(P, "l_att")) + cm.l,
      Math.log(L.tdAtt) + cm.tda + Math.log(stand),
      Math.log(ctrlX),
      Math.log(L.sub) + cm.sub + Math.log(grX + grY + 1e-3),
      Math.log(L.rev) + cm.rev + Math.log(grY + 1e-3));
    var div = ctx.division, lbsF = LBS[div] || pget(P, "lbs", 155) || 155;
    var women = (WOMEN[div] || WOMEN[ctx.prior_division]) ? 1 : 0;
    var ax = X.age, ay = Y.age, ageNa = (ax == null || ay == null) ? 1 : 0;
    var rx = X.reach_in, ry = Y.reach_in, hx = X.height_in, hy = Y.height_in, reachNa = (rx == null || ry == null) ? 1 : 0;
    var sx = stanceCode(X.stance), sy = stanceCode(Y.stance), oppst = ((sx === 0 && sy === 1) || (sx === 1 && sy === 0)) ? 1 : 0;
    // weight-class move: +-10 never binds on training rows (the models were trained on the unclipped value)
    function up(sd) { var hl = sd.home ? LBS[sd.home] : null; return (hl && lbsF) ? clip((lbsF - hl) / 10, -10, 10) : 0; }
    // unknown layoff for a fighter with UFC fights (e.g. backtest_dev sides) never occurs in training: impute the
    // training median (FC.layMed days); debutants keep the unknown branch, as in training
    var layMed = FC.layMed != null ? FC.layMed : DEFAULT_FC.layMed;
    function lay(sd) {
      var v = sd.layoff;
      if (v == null && sd.n) v = layMed;
      return v != null ? [Math.log1p(v / 30.4), 0] : [0, 1];
    }
    var lx = lay(X), ly = lay(Y);
    f.push(ctx.rounds === 5 ? 1 : 0, ctx.title ? 1 : 0, women, Math.log(lbsF / 155), (ctx.year - 2018) / 10,
      ax != null ? (ax - 30) / 5 : 0, ay != null ? (ay - 30) / 5 : 0, ageNa,
      !reachNa ? (rx - ry) / 3 : 0, (hx != null && hy != null) ? (hx - hy) / 3 : 0, reachNa,
      sx === 1 ? 1 : 0, sy === 1 ? 1 : 0, sx === 2 ? 1 : 0, sy === 2 ? 1 : 0, oppst,
      ((X.elo || 1500) - 1500) / 100, ((Y.elo || 1500) - 1500) / 100,
      Math.log1p(X.n || 0), Math.log1p(Y.n || 0), !X.n ? 1 : 0, !Y.n ? 1 : 0,
      up(X), up(Y), Math.min(5, X.ko_losses || 0), Math.min(5, Y.ko_losses || 0),
      lx[0], ly[0], lx[1], ly[1]);
    return f;
  }

  // ------------------------------------------------------------------ engine v3 static expectation
  // Per-minute expected attempts by position and target, accuracies, KD per landed head strike, takedowns, control,
  // submissions and reversals implied by a FightEngine.matchup() object m before pace, stamina, damage and form
  // (the same arithmetic as engine3 explain(), extended to every target). Side i = 0 (A) or 1 (B).
  function prob(o) { return o / (1 + o); }
  function engineSide(m, i) {
    var p = m.p, occ = m.occ, j = 1 - i, t, k;
    var cs = p.clinchCtrlStrike;
    var att = [m.dRate[i] * 60 * occ[0],
      m.cRate[i] * 60 * (occ[1 + i] * cs + occ[2 - i] * (2 - cs)),
      m.gRate[i] * 60 * occ[3 + i],
      m.gBot[i] * 60 * occ[4 - i]];                         // distance, clinch, ground top, ground bottom
    var mixes = [m.mixD[i], p.clinchMix, p.groundTopMix, p.groundBotMix];
    var A = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], Lnd = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (var pc = 0; pc < 4; pc++) for (t = 0; t < 3; t++) {
      A[pc][t] = att[pc] * mixes[pc][t];
      Lnd[pc][t] = A[pc][t] * prob(m.accO[(i * 4 + pc) * 3 + t]);
    }
    function sumT(M, t) { return M[0][t] + M[1][t] + M[2][t] + M[3][t]; }
    function sumP(M, pc) { return M[pc][0] + M[pc][1] + M[pc][2]; }
    var hA = sumT(A, 0), bA = sumT(A, 1), lA = sumT(A, 2), hL = sumT(Lnd, 0), bL = sumT(Lnd, 1), lL = sumT(Lnd, 2);
    var dA = sumP(A, 0), cA = sumP(A, 1), gA = sumP(A, 2) + sumP(A, 3), dL = sumP(Lnd, 0), cL = sumP(Lnd, 1), gL = sumP(Lnd, 2) + sumP(Lnd, 3);
    var kdPos = p.kdPos || [1, 1.1];
    var kdN = m.kd[i] * (Lnd[0][0] * kdPos[0] + Lnd[1][0] * kdPos[1] + p.kdBodyRatio * (Lnd[0][1] * kdPos[0] + Lnd[1][1] * kdPos[1]));
    var tdDist = m.tdD[i] * occ[0], tdCC = m.tdCC[i] * occ[1 + i], tdCU = m.tdCU[i] * occ[2 - i];
    var tdAtt = (tdDist + tdCC + tdCU) * 60;
    var tdL = (tdDist * prob(m.tdO[i]) + tdCC * prob(m.tdOC[i]) + tdCU * prob(m.tdOC[i] * 0.8)) * 60;
    var ctrl = (occ[3 + i] + occ[1 + i]) * 60;
    var subTop = 0, subBot = 0, rev = 0;
    for (k = 0; k < 5; k++) {
      subTop += m.occS[i][k] * m.subTPos[i * 5 + k];
      subBot += m.occS[j][k] * m.subBPos[j * 5 + k];
      rev += m.occS[j][k] * m.swPos[j * 5 + k];
    }
    var oppTdFail = (m.tdD[j] * occ[0] * (1 - prob(m.tdO[j])) + m.tdCC[j] * occ[1 + j] * (1 - prob(m.tdOC[j])) +
      m.tdCU[j] * occ[2 - j] * (1 - prob(m.tdOC[j] * 0.8))) * 60;
    var sub = (subTop * occ[3 + i] + subBot * occ[4 - i]) * 60 + oppTdFail * m.gillo[i];
    return { d_att: dA, c_att: cA, g_att: gA, h_att: hA, b_att: bA, l_att: lA, td_att: tdAtt, sub_att: sub,
      rev: rev * occ[4 - i] * 60, ctrl: ctrl,
      acc_h: hL / Math.max(1e-9, hA), acc_b: bL / Math.max(1e-9, bA), acc_l: lL / Math.max(1e-9, lA),
      acc_d: dL / Math.max(1e-9, dA), acc_c: cL / Math.max(1e-9, cA), acc_g: gL / Math.max(1e-9, gA),
      td_acc: tdL / Math.max(1e-9, tdAtt), kd_h: kdN / Math.max(1e-9, hL),
      _A: A, _L: Lnd, _att: att };
  }
  function engineExpect(m) { return { A: engineSide(m, 0), B: engineSide(m, 1) }; }

  // ------------------------------------------------------------------ model handle and evaluators
  function load(json) {
    var d = typeof json === "string" ? JSON.parse(json) : json;
    if (!d || !d.targets) throw new Error("MLRates.load: expected mlrates.json");
    var M = { meta: d.meta || {}, fc: d.fc || DEFAULT_FC, targets: d.targets, kinds: d.kinds, fnames: d.fnames,
      glm: d.glm || null, gbm: d.gbm || null, mlp: d.mlp || null, stack: d.stack, raw: d };
    if (M.glm) {
      M.glm.forEach(function (g) { if (g) { g._mean = M.raw.glm_mean; g._sd = M.raw.glm_sd; } });
    }
    MODEL = M;
    return M;
  }

  function glmEta(g, x, mean, sd) {
    var z = new Array(x.length), s = g.b0, i;
    for (i = 0; i < x.length; i++) { z[i] = (x[i] - mean[i]) / sd[i]; s += z[i] * g.b[i]; }
    var pr = g.pairs, nb = x.length;
    for (i = 0; i < pr.length; i++) s += z[pr[i][0]] * z[pr[i][1]] * g.b[nb + i];
    return s;
  }

  // trees: {f: [...], t: [...], l: [...], r: [...], v: [...]}; child index < 0 means leaf ~idx
  function gbmEta(trees, x) {
    var s = 0;
    for (var k = 0; k < trees.length; k++) {
      var T = trees[k], node = 0;
      if (T.f.length === 0) { s += T.v[0]; continue; }
      while (node >= 0) node = x[T.f[node]] <= T.t[node] ? T.l[node] : T.r[node];
      s += T.v[~node];
    }
    return s;
  }

  function geluT(x) { return 0.5 * x * (1 + Math.tanh(0.7978845608028654 * (x + 0.044715 * x * x * x))); }
  function mlpOut(net, x) {
    var h = new Array(x.length), i, j, k;
    for (i = 0; i < x.length; i++) h[i] = (x[i] - net.mean[i]) / net.sd[i];
    for (k = 0; k < net.W.length; k++) {
      var W = net.W[k], b = net.b[k], o = new Array(W.length);
      for (j = 0; j < W.length; j++) {
        var s = b[j], row = W[j];
        for (i = 0; i < row.length; i++) s += row[i] * h[i];
        o[j] = k < net.W.length - 1 ? geluT(s) : s;
      }
      h = o;
    }
    return h;
  }

  function normSide(prof, ctx) {
    var date = ctx.date || null, age = prof.age;
    if ((age == null || !isFinite(age)) && prof.dob && date) age = (Date.parse(date) - Date.parse(prof.dob)) / (365.25 * 86400000);
    var lay = prof.layoff;
    if (lay == null && prof.last_fight && date) lay = Math.round((Date.parse(date) - Date.parse(prof.last_fight)) / 86400000);
    var n = prof.n != null ? prof.n : (prof.n_fights != null ? prof.n_fights : null);
    return { s: sumsOf(prof), age: age != null && isFinite(age) ? +age : null, n: n || 0, elo: prof.elo != null ? +prof.elo : 1500,
      ko_losses: prof.ko_losses || 0, home: prof.home || prof.division || null,
      height_in: prof.height_in != null ? +prof.height_in : null, reach_in: prof.reach_in != null ? +prof.reach_in : null,
      stance: prof.stance || null, layoff: lay != null && isFinite(lay) && lay >= 0 ? +lay : null };
  }

  // linear predictor per target (log rate per minute, or logit) for X attacking Y
  function etaSide(M, f, base) {
    var nt = M.targets.length, out = new Array(nt), k, t;
    var mo = null;
    if (M.mlp) {
      mo = new Array(nt); for (t = 0; t < nt; t++) mo[t] = 0;
      for (k = 0; k < M.mlp.length; k++) { var o = mlpOut(M.mlp[k], f); for (t = 0; t < nt; t++) mo[t] += o[t] / M.mlp.length; }
    }
    for (t = 0; t < nt; t++) {
      var kind = M.kinds[t], off = kind === "pois" ? Math.log(Math.max(base[t], 1e-9)) : lgt(base[t]);
      var w = M.stack[t], eta = off;
      if (w.glm && M.glm && M.glm[t]) eta += w.glm * (glmEta(M.glm[t], f, M.raw.glm_mean, M.raw.glm_sd));
      if (w.gbm && M.gbm && M.gbm[t]) eta += w.gbm * gbmEta(M.gbm[t], f);
      if (w.mlp && mo) eta += w.mlp * mo[t];
      out[t] = eta;
    }
    return out;
  }

  function toRates(M, eta) {
    var o = {};
    for (var t = 0; t < M.targets.length; t++) o[M.targets[t]] = M.kinds[t] === "pois" ? Math.exp(eta[t]) : sigm(eta[t]);
    return o;
  }

  // predict(model, profA, profB, ctx): ctx {division, prior_division?, rounds, title, date | year, priors}
  function predict(M, profA, profB, ctx) {
    M = M || MODEL;
    if (!M) throw new Error("MLRates.predict: no model loaded");
    var year = ctx.year != null ? +ctx.year : (ctx.date ? +String(ctx.date).slice(0, 4) : new Date().getFullYear());
    var pdiv = ctx.prior_division || ctx.division;
    var A = normSide(profA, ctx), B = normSide(profB, ctx);
    if (!ctx.prior_division && (ctx.division === "Catch Weight" || ctx.division === "Open Weight")) {
      var hs = [A.home, B.home].filter(function (h) { return LBS[h]; });
      pdiv = hs.length ? hs.sort(function (a, b) { return LBS[b] - LBS[a]; })[0] : "ALL";
    }
    var P = priorFor(pdiv, ctx.priors);
    var c2 = { rounds: ctx.rounds || (ctx.title ? 5 : 3), title: !!ctx.title, division: ctx.division || pdiv, prior_division: pdiv, year: year };
    var base = M.targets.map(function (t) { return pget(P, BASE_KEY[t], 0); });
    var fA = features(A, B, c2, P, M.fc), fB = features(B, A, c2, P, M.fc);
    var eA = etaSide(M, fA, base), eB = etaSide(M, fB, base);
    return { A: toRates(M, eA), B: toRates(M, eB), etaA: eA, etaB: eB, featA: fA, featB: fB, base: base, prior_division: pdiv };
  }

  // ------------------------------------------------------------------ adapter: ML rates -> engine matchup tables
  function odds(p) { p = clip(p, 1e-6, 1 - 1e-6); return p / (1 - p); }
  function wavg(occ, mult) { var s = 0; for (var i = 0; i < 5; i++) s += occ[i] * mult[i]; return s; }

  function refitOccupancy(m, FE) {
    var p = m.p, i;
    var avgSweep = [wavg(m.occS[0], p.sweepPos), wavg(m.occS[1], p.sweepPos)];
    var avgStand = [wavg(m.occS[0], p.standPos), wavg(m.occS[1], p.standPos)];
    var q = { e: m.clE, pA: m.pCtl, x: m.clBreak, swap: m.clSwap, fc: p.standClinch, ftc: p.failTdClinch,
      tdD: m.tdD, pD: [prob(m.tdO[0]), prob(m.tdO[1])], tdCC: m.tdCC, tdCU: m.tdCU, pC: [prob(m.tdOC[0]), prob(m.tdOC[1])],
      up: m.up.slice(), rev: [m.sw[0] * avgSweep[1], m.sw[1] * avgSweep[0]] };
    var occ = null, gT = [0, 0], clT = m.clT, ctrlT = m.ctrlT;
    for (var it = 0; it < 60; it++) {
      occ = FE.occupancy(q, 300);
      var cl = occ[1] + occ[2];
      q.e = clip(q.e * Math.pow(clT / Math.max(1e-6, cl), 0.8), 1e-5, 0.08);
      gT[0] = Math.max(0.002, ctrlT[0] / 60 - occ[1]);
      gT[1] = Math.max(0.002, ctrlT[1] / 60 - occ[2]);
      q.up[1] = clip(q.up[1] * Math.pow(occ[3] / gT[0], 0.8), 1 / 3000, 1 / 6);
      q.up[0] = clip(q.up[0] * Math.pow(occ[4] / gT[1], 0.8), 1 / 3000, 1 / 6);
    }
    m.occ = FE.occupancy(q, 300); m.clE = q.e; m.up = q.up.slice(); m.gTarget = gT;
    for (i = 0; i < 2; i++) for (var k = 0; k < 5; k++) m.upPos[i * 5 + k] = m.up[1 - i] * p.standPos[k] / avgStand[i];
  }

  var PROB_T = { acc_h: 1, acc_b: 1, acc_l: 1, acc_d: 1, acc_c: 1, acc_g: 1, td_acc: 1, kd_h: 1 };
  var EMPTY = { name: "league average", S: [], ko_losses: 0 };
  var leagueCache = {};

  // engine v3's static expectation for two league-average (no-data) fighters with the matchup's settings
  // Cache key: division settings, the division priors and the parameter set (version label plus any per-call overrides,
  // so a tuner that injects params through opts.params never reuses a stale league level). The league-average pair has
  // no date of birth, so the date does not enter.
  function leagueExpect(m, FE) {
    var o = m.opts || {}, P = m.P || {};
    var key = [m.division, m.rounds, m.title, m.p.version, JSON.stringify([P.d_att, P.c_att, P.g_att, P.ctrl, P.kd_per_h, P.td_acc, P.td_att, P.sub_att, P.rev, P.acc_h, P.acc_d]),
      o.params ? JSON.stringify(o.params) : ""].join("|");
    if (leagueCache[key]) return leagueCache[key];
    var o2 = {}; for (var k in o) if (k !== "adjA" && k !== "adjB" && k !== "ml" && k !== "mlModel" && k.charAt(0) !== "_") o2[k] = o[k];
    o2.division = m.division; o2.rounds = m.rounds; o2.title = m.title; o2.ml = false;
    if (!o2.priors) { o2.priors = { ALL: m.P }; o2.priors[m.division] = m.P; }
    var base = FE.matchupBase || FE.__mlratesOrig || FE.matchup;
    var eL = engineSide(base(EMPTY, EMPTY, o2), 0);
    var keys = Object.keys(leagueCache); if (keys.length > 200) leagueCache = {};
    leagueCache[key] = eL;
    return eL;
  }

  // pred: MLRates.predict output. opts: {engine (FightEngine), level: "engine" (default) | "absolute", weight (0..1, default
  // 1: blend toward the engine's own rates), parts: {grappling,
  // strikes, accuracy, kd, subs: false to keep the engine's own}, maxRatio (cap on any single multiplier, default 4),
  // levels ({target: factor} on the learned rate targets, e.g. { td_att: 1.09, ctrl: 1.06 }; v4.0.1)}.
  // level "engine": the target for each stat is the engine's own league-average expectation x (ML / league rate), so the
  // simulator keeps its calibrated league level (its in-fight modifiers, e.g. on knockdowns, stay balanced) and plays the
  // ML's matchup-specific multipliers; probabilities combine on odds. level "absolute": the ML rates are imposed on the
  // engine's static expectation directly (diagnostics only: the in-fight modifiers then shift the realised level).
  function applyToMatchup(m, pred, opts) {
    opts = opts || {};
    var FE = opts.engine || (typeof self !== "undefined" && self.FightEngine) || (typeof globalThis !== "undefined" && globalThis.FightEngine);
    if (!FE || !FE.occupancy) throw new Error("MLRates.applyToMatchup: FightEngine needed (opts.engine)");
    var parts = opts.parts || {}, on = function (k) { return parts[k] !== false; };
    var RMAX = opts.maxRatio || 4, p = m.p, i, j, k, t, it;
    function rr(a, b) { return clip(a / Math.max(b, 1e-9), 1 / RMAX, RMAX); }
    var M = opts.model || MODEL, names = (M && M.targets) || TNAMES;
    var level = opts.level || "engine", eL = null, base = {};
    if (level === "engine") {
      eL = opts.leagueExpect || leagueExpect(m, FE);
      for (t = 0; t < names.length; t++) base[names[t]] = pred.base ? pred.base[t] : null;
    }
    // ML targets (re-levelled) with the matchup's knobs layered on top (the knobs stay meaningful)
    var tg = [{}, {}], sides = [pred.A, pred.B];
    for (i = 0; i < 2; i++) {
      j = 1 - i; var a = m.adj[i], aj = m.adj[j], src = sides[i];
      for (k in src) {
        var v = src[k];
        if (eL && base[k] != null && eL[k] != null && base[k] > 0) {
          v = PROB_T[k] && k !== "kd_h" ? prob(odds(eL[k]) * odds(v) / odds(base[k])) : eL[k] * v / base[k];
        }
        tg[i][k] = v;
      }
      // position accuracies made coherent with the target accuracies (same attempt-weighted overall; the ML's
      // relative position differences kept), so the two-margin fit below can match both exactly
      var ovT = (tg[i].h_att * tg[i].acc_h + tg[i].b_att * tg[i].acc_b + tg[i].l_att * tg[i].acc_l) / Math.max(1e-9, tg[i].h_att + tg[i].b_att + tg[i].l_att);
      var wP = [tg[i].d_att, tg[i].c_att, tg[i].g_att], zP = [lgt(tg[i].acc_d), lgt(tg[i].acc_c), lgt(tg[i].acc_g)], sh = 0;
      for (it = 0; it < 30; it++) {
        var num0 = 0, den0 = 0;
        for (k = 0; k < 3; k++) { num0 += wP[k] * sigm(zP[k] + sh); den0 += wP[k]; }
        if (den0 <= 0) break;
        sh += lgt(ovT) - lgt(num0 / den0);
      }
      tg[i].acc_d = sigm(zP[0] + sh); tg[i].acc_c = sigm(zP[1] + sh); tg[i].acc_g = sigm(zP[2] + sh);
      tg[i].d_att *= a.out; tg[i].c_att *= a.out; tg[i].g_att *= a.out;
      tg[i].h_att *= a.out; tg[i].b_att *= a.out; tg[i].l_att *= a.out;
      tg[i].td_att *= a.tdAtt; tg[i].sub_att *= a.sub;
      tg[i].td_acc = prob(odds(tg[i].td_acc) / aj.tdDef);
      ["acc_h", "acc_b", "acc_l", "acc_d", "acc_c", "acc_g"].forEach(function (q) { tg[i][q] = prob(odds(tg[i][q]) * a.acc); });
      tg[i].kd_h *= a.pow * aj.chin;
    }
    // level factors on the learned targets (v4.0.1: opts.levels = { td_att, ctrl } from params mlTdLevel / mlCtrlLevel,
    // matched on train fights by tools/v4_levels.js; rates only, never probabilities)
    var LV = opts.levels || {};
    for (i = 0; i < 2; i++) for (k in LV) if (tg[i][k] != null && !PROB_T[k] && LV[k] > 0 && LV[k] !== 1) tg[i][k] *= LV[k];
    // optional blend toward the engine's own rates: weight 1 = ML rates, 0 = plain engine (geometric on rates, logit on
    // probabilities), for tuning how far to trust the learned rates
    var wgt = opts.weight == null ? 1 : clip(+opts.weight, 0, 1);
    if (wgt < 1) {
      var eB0 = engineExpect(m), eb = [eB0.A, eB0.B];
      for (i = 0; i < 2; i++) for (k in tg[i]) {
        if (eb[i][k] == null || !isFinite(eb[i][k])) continue;
        if (PROB_T[k] && k !== "kd_h") tg[i][k] = sigm((1 - wgt) * lgt(eb[i][k]) + wgt * lgt(tg[i][k]));
        else tg[i][k] = Math.exp((1 - wgt) * Math.log(Math.max(eb[i][k], 1e-12)) + wgt * Math.log(Math.max(tg[i][k], 1e-12)));
      }
    }
    var ratios = [{}, {}];
    // 1) grappling: takedown attempts and success, sweeps, control targets; refit position occupancy
    if (on("grappling")) {
      var e0 = engineExpect(m), es = [e0.A, e0.B];
      for (i = 0; i < 2; i++) {
        var ro = rr(odds(tg[i].td_acc), odds(es[i].td_acc));   // capped like every other multiplier (v4.0.1)
        m.tdO[i] *= ro; m.tdOC[i] *= ro; ratios[i].tdOdds = ro;
        var rv = rr(tg[i].rev, es[i].rev); m.sw[i] *= rv; ratios[i].rev = rv;
        for (k = 0; k < 5; k++) m.swPos[(1 - i) * 5 + k] *= rv;
      }
      var cAllE = es[0].c_att + es[1].c_att, cAllT = tg[0].c_att + tg[1].c_att;
      m.clT = clip(m.clT * Math.pow(rr(cAllT, cAllE), p.clinchTimeExp), 0.005, 0.3);
      m.ctrlT = [tg[0].ctrl, tg[1].ctrl];
      var xA = m.ctrlT[0] / Math.max(1e-6, m.ctrlT[0] + m.ctrlT[1]);
      m.pCtl = 0.5 + p.clinchCtrlTemper * (xA - 0.5);
      var tdr = [1, 1];
      for (it = 0; it < 3; it++) {
        refitOccupancy(m, FE);
        var e1 = engineExpect(m), e1s = [e1.A, e1.B];
        for (i = 0; i < 2; i++) {
          // v4.0.1: the cap applies to the cumulative multiplier (v4.0.0 capped each of the three steps, so it could
          // compound to 4^3; 20 of 3,998 train sides went past 4, up to x6.3)
          var r1 = rr(tdr[i] * tg[i].td_att, e1s[i].td_att) / tdr[i];
          m.tdD[i] *= r1; m.tdCC[i] *= r1; m.tdCU[i] *= r1; tdr[i] *= r1;
        }
      }
      refitOccupancy(m, FE);
      ratios[0].tdAtt = tdr[0]; ratios[1].tdAtt = tdr[1];
    }
    // 2) strike attempts by position, then the distance target mix
    if (on("strikes")) {
      var e2 = engineExpect(m), e2s = [e2.A, e2.B];
      for (i = 0; i < 2; i++) {
        var rd = rr(tg[i].d_att, e2s[i].d_att), rc = rr(tg[i].c_att, e2s[i].c_att), rg = rr(tg[i].g_att, e2s[i].g_att);
        m.dRate[i] *= rd; m.cRate[i] *= rc; m.gRate[i] *= rg; m.gBot[i] *= rg;
        for (k = 0; k < 5; k++) m.gPos[i * 5 + k] *= rg;
        ratios[i].d = rd; ratios[i].c = rc; ratios[i].g = rg;
      }
      var e3 = engineExpect(m), e3s = [e3.A, e3.B];
      for (i = 0; i < 2; i++) {
        if (m.adj[i].leg != null) continue;                 // a leg-kick share knob overrides the learned mix
        var Ai = e3s[i]._A, tot = 0, want = [tg[i].h_att, tg[i].b_att, tg[i].l_att], ws = want[0] + want[1] + want[2];
        for (var pc = 0; pc < 4; pc++) for (t = 0; t < 3; t++) tot += Ai[pc][t];
        var dAtt = Ai[0][0] + Ai[0][1] + Ai[0][2];
        if (dAtt <= 0 || ws <= 0) continue;
        var need = [0, 0, 0], sN = 0;
        for (t = 0; t < 3; t++) { need[t] = Math.max(0.02 * dAtt, want[t] / ws * tot - (Ai[1][t] + Ai[2][t] + Ai[3][t])); sN += need[t]; }
        var mix = [need[0] / sN, need[1] / sN, need[2] / sN];
        m.mixD[i] = mix;
        m.mixC[(i * 4) * 2] = mix[0]; m.mixC[(i * 4) * 2 + 1] = mix[0] + mix[1];
        ratios[i].mixD = mix;
      }
    }
    // 3) accuracy: logit shifts by target and by position so both margins match (IPF on the logit scale)
    if (on("accuracy")) {
      for (i = 0; i < 2; i++) {
        var alpha = [0, 0, 0], beta = [0, 0, 0], wantT = [tg[i].acc_h, tg[i].acc_b, tg[i].acc_l], wantP = [tg[i].acc_d, tg[i].acc_c, tg[i].acc_g];
        var e4 = engineSide(m, i), A4 = e4._A, z0 = [];
        for (var pc2 = 0; pc2 < 4; pc2++) { z0.push([]); for (t = 0; t < 3; t++) z0[pc2].push(Math.log(m.accO[(i * 4 + pc2) * 3 + t])); }
        var posOf = [0, 1, 2, 2];
        for (it = 0; it < 25; it++) {
          for (t = 0; t < 3; t++) {
            var num = 0, den = 0;
            for (pc2 = 0; pc2 < 4; pc2++) { num += A4[pc2][t] * sigm(z0[pc2][t] + alpha[t] + beta[posOf[pc2]]); den += A4[pc2][t]; }
            if (den > 1e-9) alpha[t] += lgt(wantT[t]) - lgt(num / den);
          }
          for (var q = 0; q < 3; q++) {
            var num2 = 0, den2 = 0;
            for (pc2 = 0; pc2 < 4; pc2++) if (posOf[pc2] === q) for (t = 0; t < 3; t++) { num2 += A4[pc2][t] * sigm(z0[pc2][t] + alpha[t] + beta[q]); den2 += A4[pc2][t]; }
            if (den2 > 1e-9) beta[q] += lgt(wantP[q]) - lgt(num2 / den2);
          }
        }
        for (pc2 = 0; pc2 < 4; pc2++) for (t = 0; t < 3; t++) m.accO[(i * 4 + pc2) * 3 + t] = Math.exp(clip(z0[pc2][t] + alpha[t] + beta[posOf[pc2]], -8, 8));
        ratios[i].accShiftTarget = alpha; ratios[i].accShiftPos = beta;
      }
    }
    // 4) knockdown power x chin (and the TKO hazards built from the same product), submissions
    var e5 = engineExpect(m), e5s = [e5.A, e5.B];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      if (on("kd")) {
        var rk = rr(tg[i].kd_h, e5s[i].kd_h);
        m.kd[i] *= rk; m.gnp[i] *= Math.sqrt(rk); m.stko[i] *= Math.sqrt(rk); ratios[i].kd = rk;
      }
      if (on("subs")) {
        var rs = rr(tg[i].sub_att, e5s[i].sub_att);
        for (k = 0; k < 5; k++) { m.subTPos[i * 5 + k] *= rs; m.subBPos[j * 5 + k] *= rs; }
        m.gillo[i] = clip(m.gillo[i] * rs, 0, 0.5); ratios[i].sub = rs;
      }
    }
    m.ml = { targets: tg, ratios: ratios, league: eL, level: level };
    return { ratios: ratios, targets: tg, league: eL, level: level };
  }

  function mlMatchup(FE, profA, profB, opts) {
    opts = opts || {};
    var m = FE.matchup(profA, profB, opts);
    var M = opts.model || MODEL;
    if (!M) return m;
    var pa = typeof profA === "string" ? FE.profile(profA) : profA, pb = typeof profB === "string" ? FE.profile(profB) : profB;
    var pred = predict(M, pa, pb, { division: m.division, rounds: m.rounds, title: m.title, date: m.date,
      priors: opts.priors || (FE.loadDB && opts.db ? opts.db.priors : null) || m.priors || { ALL: m.P, [m.division]: m.P } });
    applyToMatchup(m, pred, { engine: FE, parts: opts.parts });
    m.mlPred = pred;
    return m;
  }

  return {
    KEYS: KEYS, TNAMES: TNAMES, BASE_KEY: BASE_KEY, DEFAULT_FC: DEFAULT_FC, engineExpect: engineExpect,
    load: load, setModel: load, predict: predict, applyToMatchup: applyToMatchup, matchup: mlMatchup,
    model: function () { return MODEL; },
    features: features, priorFor: priorFor, sumsOf: sumsOf, league: league,
    _internal: { shr: shr, lr: lr, lgt: lgt, sigm: sigm, clip: clip }
  };
});
