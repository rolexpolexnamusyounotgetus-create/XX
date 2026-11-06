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
  var DEFAULT_FC = { gs: 0.84, kPM: 40, kAcc: 150, kTdPM: 45, kTdAcc: 12, kKD: 230, kCtrlTD: 4, kRev: 40, kFin: 3, bot: 0.12 };
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
    function up(sd) { var hl = sd.home ? LBS[sd.home] : null; return (hl && lbsF) ? (lbsF - hl) / 10 : 0; }
    function lay(sd) { return sd.layoff != null ? [Math.log1p(sd.layoff / 30.4), 0] : [0, 1]; }
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

  return {
    KEYS: KEYS, TNAMES: TNAMES, BASE_KEY: BASE_KEY, DEFAULT_FC: DEFAULT_FC,
    features: features, priorFor: priorFor, sumsOf: sumsOf, league: league,
    _internal: { shr: shr, lr: lr, lgt: lgt, sigm: sigm, clip: clip }
  };
});
