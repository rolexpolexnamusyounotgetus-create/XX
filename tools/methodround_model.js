/* Method-and-round model evaluator (tools/methodround.py writes the coefficients to
 * data/derived/methodround.json under "js_model"; this file is also embedded there as js_model.source).
 *
 * UMD: module.exports in Node, self.MethodRound in the browser / a Web Worker. No DOM, no dependencies.
 *
 *   var mr = MethodRound.create(json.js_model);
 *   var out = mr.predict(fighters.fighters["alexander-volkanovski"], fighters.fighters["justin-gaethje"],
 *                        { slugA: "alexander-volkanovski", slugB: "justin-gaethje", division: "Lightweight",
 *                          rounds: 5, title: true, date: "2026-11-14", pMarketA: 0.372 });  // pMarketA optional
 *
 * Profiles are fighters.json entries (S, C, record, n_fights, n_5rd, ko_losses, dob, elo, height_in, reach_in,
 * stance, last_fight, division). js_model.extras[slug] supplies the few walk-forward quantities fighters.json
 * lacks. With pMarketA (no-vig probability that A wins) the "SM" variant is used, otherwise "S".
 *
 * Returns { variant, cells: {A: {ko: [r1..R], sub: [r1..R], dec}, B: {...}, draw}, pA, pB, pDraw, pFinish, pKO,
 *           pSUB, pDEC, finRound: [r1..R], koRound, subRound, bins7: [A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO],
 *           methodGivenWin: {A: {ko, sub, dec}, B: {...}} }.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.MethodRound = factory();
}(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function lg(x) { return Math.log(Math.max(x, 1e-4)); }
  function logit(p, eps) {
    eps = eps || 1e-4;
    p = Math.min(Math.max(p, eps), 1 - eps);
    return Math.log(p / (1 - p));
  }
  function log1p(x) { return Math.log(1 + x); }
  function clip(x, a, b) { return Math.min(Math.max(x, a), b); }
  function softmax(z) {
    var m = -Infinity, i, s = 0, out = new Array(z.length);
    for (i = 0; i < z.length; i++) if (z[i] > m) m = z[i];
    for (i = 0; i < z.length; i++) { out[i] = Math.exp(z[i] - m); s += out[i]; }
    for (i = 0; i < z.length; i++) out[i] /= s;
    return out;
  }
  function dayNum(d) {
    if (d instanceof Date) return Math.floor(d.getTime() / 86400000);
    var p = String(d).split("-");
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }

  function create(model) {
    var KI = {};
    model.keys.forEach(function (k, i) { KI[k] = i; });
    var sh = model.shrink;

    function sideFeatures(prof, ex, P, day) {
      var S = prof.S, C = prof.C;
      function g(k) { return S[KI[k]]; }
      function gc(k) { return C[KI[k]]; }
      function p(k) { return P[k]; }
      function pf(k) { return P[k] / P.n; }
      var kf = sh.k_fight, km = sh.k_min, kh = sh.k_head, ka = sh.k_att, ks = sh.k_sub;
      var m = g("min"), n = g("n");
      var sig_l = g("d_lnd") + g("c_lnd") + g("g_lnd"), sig_a = g("d_att") + g("c_att") + g("g_att");
      var osig_l = g("od_lnd") + g("oc_lnd") + g("og_lnd"), osig_a = g("od_att") + g("oc_att") + g("og_att");
      var p_sig = p("d_lnd") + p("c_lnd") + p("g_lnd"), p_siga = p("d_att") + p("c_att") + p("g_att");
      var F = {};
      ["ko_w", "ko_l", "sub_w", "sub_l"].forEach(function (k) {
        F[k + "_pf"] = (g(k) + kf * pf(k)) / (n + kf);
        F[k + "_pm"] = 15 * (g(k) + km * p(k)) / (m + km);
      });
      F.dec_pf = (g("dec_w") + g("dec_l") + kf * (pf("dec_w") + pf("dec_l"))) / (n + kf);
      F.kd15 = 15 * (g("kd") + km * p("kd")) / (m + km);
      F.okd15 = 15 * (g("okd") + km * p("okd")) / (m + km);
      F.pow = (g("kd") + kh * p("kd_per_h")) / (g("h_lnd") + kh);
      F.chin = (g("okd") + kh * p("kd_per_h")) / (g("oh_lnd") + kh);
      F.slpm = (sig_l + km * p_sig) / (m + km);
      F.sapm = (osig_l + km * p_sig) / (m + km);
      F.hlpm = (g("h_lnd") + km * p("h_lnd")) / (m + km);
      F.hapm = (g("oh_lnd") + km * p("h_lnd")) / (m + km);
      F.acc = (sig_l + ka * p("acc_sig")) / (sig_a + ka);
      F.oacc = (osig_l + ka * p("acc_sig")) / (osig_a + ka);
      F.att_pm = (sig_a + km * p_siga) / (m + km);
      F.td15 = 15 * (g("td_lnd") + km * p("td_lnd")) / (m + km);
      F.otd15 = 15 * (g("otd_lnd") + km * p("td_lnd")) / (m + km);
      F.tda15 = 15 * (g("td_att") + km * p("td_att")) / (m + km);
      F.td_acc = (g("td_lnd") + ka / 5 * p("td_acc")) / (g("td_att") + ka / 5);
      F.otd_acc = (g("otd_lnd") + ka / 5 * p("td_acc")) / (g("otd_att") + ka / 5);
      F.ctrl = (g("ctrl") + km * p("ctrl")) / (m + km) / 60;
      F.octrl = (g("octrl") + km * p("ctrl")) / (m + km) / 60;
      F.gnd = (g("g_lnd") + km * p("g_lnd")) / (m + km);
      F.ognd = (g("og_lnd") + km * p("g_lnd")) / (m + km);
      F.sub15 = 15 * (g("sub_att") + km * p("sub_att")) / (m + km);
      F.osub15 = 15 * (g("osub_att") + km * p("sub_att")) / (m + km);
      F.sub_conv = (g("sub_w") + ks * p("sub_conv")) / (g("sub_att") + ks);
      F.sub_def = (g("sub_l") + ks * p("sub_conv")) / (g("osub_att") + ks);
      F.leg_share = (g("l_lnd") + 20 * p("l_lnd") / p_sig) / (sig_l + 20);
      F.mpf = (m + kf * p("mpf")) / (n + kf);
      var rec = prof.record || {}, na = prof.n_fights || 0;
      function r(k) { return rec[k] || 0; }
      ["ko_w", "ko_l", "sub_w", "sub_l"].forEach(function (k) { F["c_" + k] = (r(k) + kf * pf(k)) / (na + kf); });
      F.c_dec = (r("dec_w") + r("dec_l") + kf * (pf("dec_w") + pf("dec_l"))) / (na + kf);
      F.c_win = (r("w") + kf * 0.5) / (r("w") + r("l") + kf);
      // extras: [streak, last, fin_min_w, fin_n_w, fin_min_l, fin_n_l, r1_w, r1_l, dur, dur_n, opp_elo_mean]
      var e = ex || [0, "", 0, 0, 0, 0, 0, 0, 0, 0, 1500];
      F.c_mpf = (e[8] + kf * p("mpf")) / (e[9] + kf);
      F.fin_t_w = (e[2] + 2 * 6.5) / (e[3] + 2);
      F.fin_t_l = (e[4] + 2 * 6.5) / (e[5] + 2);
      F.r1_w = (e[6] + 1) / (e[3] + 2);
      F.r1_l = (e[7] + 1) / (e[5] + 2);
      var age = 30;
      if (prof.dob) age = (day - dayNum(prof.dob)) / 365.25;
      F.age = age;
      F.age30 = Math.max(0, age - 30);
      F.n_all = na;
      F.ko_losses = prof.ko_losses || 0;
      F.kd_abs = C[KI.okd];
      F.elo = prof.elo;
      F.opp_elo = e[10] == null ? 1500 : e[10];
      F.layoff = prof.last_fight ? day - dayNum(prof.last_fight) : 365;
      var last = e[1] || "";
      F.last_ko_l = last === "L_KO" ? 1 : 0;
      F.last_fin_w = (last === "W_KO" || last === "W_SUB") ? 1 : 0;
      F.streak = e[0] || 0;
      F.height = prof.height_in == null ? NaN : prof.height_in;
      F.reach = prof.reach_in == null ? NaN : prof.reach_in;
      F.south = prof.stance === "Southpaw" ? 1 : 0;
      F.n_S = n;
      var mc = gc("min");
      var csig = gc("d_lnd") + gc("c_lnd") + gc("g_lnd"), cosig = gc("od_lnd") + gc("oc_lnd") + gc("og_lnd");
      F.cs_sub15 = 15 * (gc("sub_att") + km * p("sub_att")) / (mc + km);
      F.cs_osub15 = 15 * (gc("osub_att") + km * p("sub_att")) / (mc + km);
      F.cs_td15 = 15 * (gc("td_lnd") + km * p("td_lnd")) / (mc + km);
      F.cs_otd15 = 15 * (gc("otd_lnd") + km * p("td_lnd")) / (mc + km);
      F.cs_ctrl = (gc("ctrl") + km * p("ctrl")) / (mc + km);
      F.cs_octrl = (gc("octrl") + km * p("ctrl")) / (mc + km);
      F.cs_kd15 = 15 * (gc("kd") + km * p("kd")) / (mc + km);
      F.cs_okd15 = 15 * (gc("okd") + km * p("kd")) / (mc + km);
      F.cs_slpm = (csig + km * p_sig) / (mc + km);
      F.cs_sapm = (cosig + km * p_sig) / (mc + km);
      F.cs_subw = (gc("sub_w") + kf * pf("sub_w")) / (gc("n") + kf);
      F.cs_kow = (gc("ko_w") + kf * pf("ko_w")) / (gc("n") + kf);
      return F;
    }

    var XK = ["ko_w_pf", "sub_w_pf", "ko_w_pm", "sub_w_pm", "kd15", "pow", "slpm", "hlpm", "acc", "td15", "tda15",
      "td_acc", "ctrl", "gnd", "sub15", "sub_conv", "c_ko_w", "c_sub_w", "att_pm", "leg_share"];
    var YK = ["ko_l_pf", "sub_l_pf", "ko_l_pm", "sub_l_pm", "okd15", "chin", "sapm", "hapm", "oacc", "otd15",
      "otd_acc", "octrl", "ognd", "osub15", "sub_def", "c_ko_l", "c_sub_l"];
    var XK2 = ["ko_l_pf", "sub_l_pf", "okd15", "chin", "sapm", "otd15", "osub15"];
    var YK2 = ["ko_w_pf", "sub_w_pf", "kd15", "pow", "slpm", "td15", "sub15"];
    var CS = ["cs_sub15", "cs_osub15", "cs_td15", "cs_otd15", "cs_ctrl", "cs_octrl", "cs_kd15", "cs_okd15",
      "cs_slpm", "cs_sapm", "cs_subw", "cs_kow"];

    function direction(X, Y, P, fight, common, mk) {
      var D = {}, i;
      function p(k) { return P[k]; }
      var p_sig = p("d_lnd") + p("c_lnd") + p("g_lnd");
      for (i = 0; i < XK.length; i++) D["x_" + XK[i]] = lg(X[XK[i]]);
      for (i = 0; i < YK.length; i++) D["y_" + YK[i]] = lg(Y[YK[i]]);
      for (i = 0; i < XK2.length; i++) D["x_" + XK2[i]] = lg(X[XK2[i]]);
      for (i = 0; i < YK2.length; i++) D["y_" + YK2[i]] = lg(Y[YK2[i]]);
      D.s_dec = logit(X.dec_pf) + logit(Y.dec_pf);
      D.s_cdec = logit(X.c_dec) + logit(Y.c_dec);
      D.s_mpf = lg(X.mpf) + lg(Y.mpf);
      D.s_cmpf = lg(X.c_mpf) + lg(Y.c_mpf);
      D.m_ko_pm = lg(X.ko_w_pm) + lg(Y.ko_l_pm) - lg(15 * p("ko_w"));
      D.m_sub_pm = lg(X.sub_w_pm) + lg(Y.sub_l_pm) - lg(15 * p("sub_w"));
      D.m_kd = lg(X.kd15) + lg(Y.okd15) - lg(15 * p("kd"));
      D.m_pow = lg(X.pow) + lg(Y.chin) - lg(p("kd_per_h"));
      D.m_str = lg(X.slpm) + lg(Y.sapm) - lg(p_sig);
      D.m_td = lg(X.td15) + lg(Y.otd15) - lg(15 * p("td_lnd"));
      D.m_ctrl = lg(X.ctrl) + lg(Y.octrl) - lg(p("ctrl") / 60);
      D.m_gnd = lg(X.gnd) + lg(Y.ognd) - lg(p("g_lnd"));
      D.m_subatt = lg(X.sub15) + lg(Y.osub15) - lg(15 * p("sub_att"));
      D.m_subcv = logit(X.sub_conv) + logit(Y.sub_def) - logit(p("sub_conv"));
      D.x_age30 = X.age30; D.y_age30 = Y.age30;
      D.x_age = (X.age - 30) / 5; D.y_age = (Y.age - 30) / 5;
      D.x_nlog = log1p(X.n_all); D.y_nlog = log1p(Y.n_all);
      D.x_kol = log1p(X.ko_losses); D.y_kol = log1p(Y.ko_losses);
      D.y_kol_age = log1p(Y.ko_losses) * Y.age30 / 5;
      D.x_kdabs = log1p(X.kd_abs); D.y_kdabs = log1p(Y.kd_abs);
      D.x_lay = log1p(X.layoff / 30); D.y_lay = log1p(Y.layoff / 30);
      D.x_lastkol = X.last_ko_l; D.y_lastkol = Y.last_ko_l;
      D.x_lastfinw = X.last_fin_w; D.y_lastfinw = Y.last_fin_w;
      D.x_streak = clip(X.streak, -4, 6) / 3; D.y_streak = clip(Y.streak, -4, 6) / 3;
      D.x_fint = lg(X.fin_t_w); D.y_fint = lg(Y.fin_t_l);
      D.x_r1 = logit(X.r1_w); D.y_r1 = logit(Y.r1_l);
      D.x_cwin = logit(X.c_win); D.y_cwin = logit(Y.c_win);
      D.d_elo = (X.elo - Y.elo) / 100;
      D.a_elo = Math.abs(D.d_elo);
      D.d_oppelo = (X.opp_elo - Y.opp_elo) / 100;
      var hgt = X.height - Y.height, rch = X.reach - Y.reach;
      D.d_height = (isNaN(hgt) ? 0 : hgt) / 3;
      D.d_reach = (isNaN(rch) ? (isNaN(hgt) ? 0 : hgt) : rch) / 3;
      D.d_age = (X.age - Y.age) / 5;
      D.oppst = (X.south + Y.south) === 1 ? 1 : 0;
      for (var k in common) D[k] = common[k];
      D.x_lowdata = 1 / (1 + X.n_S);
      D.y_lowdata = 1 / (1 + Y.n_S);
      for (i = 0; i < CS.length; i++) { D["x_" + CS[i]] = lg(X[CS[i]]); D["y_" + CS[i]] = lg(Y[CS[i]]); }
      D.mk = mk;
      D.mk_a = Math.abs(mk);
      return D;
    }

    function vec(D, part) {
      var x = new Array(part.cols.length);
      for (var i = 0; i < part.cols.length; i++) {
        var v = D[part.cols[i]];
        if (v === undefined || isNaN(v)) throw new Error("methodround: feature " + part.cols[i] + " is " + v);
        x[i] = (v - part.mean[i]) / part.scale[i];
      }
      return x;
    }
    function lin(x, coef, b) {
      var s = b || 0;
      for (var i = 0; i < x.length; i++) s += coef[i] * x[i];
      return s;
    }
    function c6probs(part, D) {
      var x = vec(D, part), z = new Array(6);
      for (var c = 0; c < 6; c++) z[c] = lin(x, part.coef[c], part.intercept[c]);
      return softmax(z);
    }
    function sigmoid(z) { return 1 / (1 + Math.exp(-z)); }

    var NC = 23, R5 = 5, IXKO = 0, IXSUB = 5, IYKO = 10, IYSUB = 15, IXDEC = 20, IYDEC = 21, IDRAW = 22;
    function hazardJoint(D, R) {
      var hz = model.hazard, x = vec(D, hz), P = new Array(NC).fill(0), S = 1;
      for (var r = 1; r <= R; r++) {
        var dummies = new Array(8).fill(0);
        dummies[R === 3 ? r - 1 : 3 + r - 1] = 1;
        var full = x.concat(dummies), z = new Array(5);
        for (var c = 0; c < 5; c++) z[c] = lin(full, hz.coef[c], 0);
        var h = softmax(z);   // classes: none, X KO, X SUB, Y KO, Y SUB
        P[IXKO + r - 1] = S * h[1]; P[IXSUB + r - 1] = S * h[2];
        P[IYKO + r - 1] = S * h[3]; P[IYSUB + r - 1] = S * h[4];
        S *= h[0];
      }
      var q = sigmoid(lin(vec(D, model.decision), model.decision.coef, 0));
      P[IXDEC] = S * q * (1 - model.draw_c);
      P[IYDEC] = S * (1 - q) * (1 - model.draw_c);
      P[IDRAW] = S * model.draw_c;
      return P;
    }
    function mirror(P) {
      var Q = P.slice();
      for (var r = 0; r < R5; r++) {
        Q[IXKO + r] = P[IYKO + r]; Q[IYKO + r] = P[IXKO + r];
        Q[IXSUB + r] = P[IYSUB + r]; Q[IYSUB + r] = P[IXSUB + r];
      }
      Q[IXDEC] = P[IYDEC]; Q[IYDEC] = P[IXDEC];
      return Q;
    }

    function predict(profA, profB, opts) {
      opts = opts || {};
      var LBS = model.lbs, R = opts.rounds === 5 ? 5 : 3;
      var div = opts.division || profA.division;
      var pdiv = div;
      if (!model.priors[div] || div === "Catch Weight" || div === "Open Weight") {
        var homes = [profA.division, profB.division].filter(function (d) { return LBS[d]; });
        pdiv = homes.length ? homes.reduce(function (a, b) { return LBS[a] >= LBS[b] ? a : b; }) : "ALL";
      }
      var P = model.priors[pdiv] || model.priors.ALL;
      var date = opts.date || new Date().toISOString().slice(0, 10), day = dayNum(date);
      var year = +String(date).slice(0, 4);
      var lbs = LBS[pdiv] || P.lbs || 170;
      var women = /^Women/.test(div) || /^Women/.test(pdiv);
      var common = {
        lbs: (lbs - 160) / 50, hw: lbs >= 250 ? 1 : 0, women: women ? 1 : 0, r5: R === 5 ? 1 : 0,
        title: opts.title ? 1 : 0, catch: (div === "Catch Weight" || div === "Open Weight") ? 1 : 0,
        yr: (year - 2016) / 10, lg_ko: logit(P.ko_w / P.n * 2), lg_sub: logit(P.sub_w / P.n * 2), lg_mpf: lg(P.mpf)
      };
      var exA = opts.extrasA || model.extras[opts.slugA], exB = opts.extrasB || model.extras[opts.slugB];
      var FA = sideFeatures(profA, exA, P, day), FB = sideFeatures(profB, exB, P, day);
      var useM = opts.pMarketA != null && isFinite(opts.pMarketA);
      var mk = useM ? logit(opts.pMarketA, 1e-3) : (profA.elo - profB.elo) / 400 * Math.LN10;
      var DA = direction(FA, FB, P, opts, common, mk), DB = direction(FB, FA, P, opts, common, -mk);
      var variant = useM ? "SM" : "S", part = model.c6[variant];
      var pa = c6probs(part, DA), pb = c6probs(part, DB), P6 = new Array(6), i;
      for (i = 0; i < 6; i++) P6[i] = 0.5 * (pa[i] + pb[5 - i]);
      if (useM) {
        var w = model.win.SM;
        var wa = sigmoid(lin(vec(DA, w), w.coef, 0)), wb = sigmoid(lin(vec(DB, w), w.coef, 0));
        var pw = 0.5 * (wa + 1 - wb), sa = P6[0] + P6[1] + P6[2], sb = P6[3] + P6[4] + P6[5];
        for (i = 0; i < 3; i++) { P6[i] = P6[i] / sa * pw; P6[3 + i] = P6[3 + i] / sb * (1 - pw); }
      }
      var HA = hazardJoint(DA, R), HB = mirror(hazardJoint(DB, R)), H = new Array(NC);
      for (i = 0; i < NC; i++) H[i] = 0.5 * (HA[i] + HB[i]);
      function shape(base) {
        var s = 0, out = [], r;
        for (r = 0; r < R; r++) s += H[base + r];
        for (r = 0; r < R; r++) out.push(H[base + r] / Math.max(s, 1e-12));
        return out;
      }
      var dc = model.draw_c;
      var A = { ko: shape(IXKO).map(function (v) { return v * P6[0]; }),
                sub: shape(IXSUB).map(function (v) { return v * P6[1]; }), dec: P6[2] * (1 - dc) };
      var Bs = { ko: shape(IYKO).map(function (v) { return v * P6[5]; }),
                 sub: shape(IYSUB).map(function (v) { return v * P6[4]; }), dec: P6[3] * (1 - dc) };
      var draw = (P6[2] + P6[3]) * dc;
      function sum(a) { return a.reduce(function (x, y) { return x + y; }, 0); }
      var aKO = sum(A.ko), aSUB = sum(A.sub), bKO = sum(Bs.ko), bSUB = sum(Bs.sub);
      var finRound = [], koRound = [], subRound = [];
      for (i = 0; i < R; i++) {
        koRound.push(A.ko[i] + Bs.ko[i]); subRound.push(A.sub[i] + Bs.sub[i]);
        finRound.push(koRound[i] + subRound[i]);
      }
      var pA = aKO + aSUB + A.dec, pB = bKO + bSUB + Bs.dec;
      return {
        variant: variant, rounds: R, cells: { A: A, B: Bs, draw: draw },
        pA: pA, pB: pB, pDraw: draw, pKO: aKO + bKO, pSUB: aSUB + bSUB, pDEC: A.dec + Bs.dec + draw,
        pFinish: aKO + aSUB + bKO + bSUB, finRound: finRound, koRound: koRound, subRound: subRound,
        bins7: [aKO, aSUB, A.dec, draw, Bs.dec, bSUB, bKO],
        methodGivenWin: { A: { ko: aKO / pA, sub: aSUB / pA, dec: A.dec / pA },
                          B: { ko: bKO / pB, sub: bSUB / pB, dec: Bs.dec / pB } }
      };
    }
    return { predict: predict, model: model };
  }

  return { create: create, version: 1 };
}));
