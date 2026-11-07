/* Fight engine v4: a data-driven, continuous-time simulation of an MMA bout between any two fighters.
   Contract: docs/ENGINE_V3_SPEC.md (+ "Engine v4" section). Parameters: src/params3.js (FightParams).
   The file names stay engine3.js / params3.js for every version; VERSION below is the engine version.

   Profiles (data/derived/fighters.json, or backtest snapshots) hold decayed sums; matchup() turns them
   into rates by exposure-based shrinkage toward the fight division's priors, combines attacker and
   defender log-linearly (rates) or by log5 on odds (probabilities), and fits position occupancy so the
   pair's simulated control and clinch time match their data-implied expectations. v4: when a learned
   stat-line model is loaded (FightEngine.loadMLRates(mlrates.json), src/ml/mlrates.js), matchup() then
   re-targets the rate tables to the model's per-matchup predictions (attempts by position and target,
   accuracy, knockdowns, takedowns, control, submissions, reversals) at the engine's own league level;
   opts.ml === false keeps the plain v3-style tables. simulate() plays one fight as competing exponential
   clocks recomputed after every event: strike attempts (misses are real events) by target and position,
   clinch entries and breaks, takedowns, ground sub-positions with passes, escapes, sweeps and stand-ups,
   submissions, knockdowns with a follow-up sequence, hurt states, standing / ground-and-pound / leg TKOs,
   stamina and pace, three judges (v4: EM round-winner weights with shared + individual noise and a
   margin-based 10-8 rule, all fit on 2019-2023 judges' rounds), and doctor / corner stoppages.

   v8 (docs/V6_V10_PLAN.md cycle 3, stat-line fidelity; docs/CHANGELOG.md v8): three flagged sub-parts on top of the v4
   simulator, each off unless params.components.<name> is true (all off = v4.0.0 bit for bit, tests/test_v8.js):
   - components.embed: the embedding blend of the learned stat-line targets (research/model_embed.md recipe; opts.embed
     inputs, fold-honest coefficients in backtests via tools/mlpathrec.js), ported from the v6 engine;
   - components.retarget: a realised-rate retarget pass in matchup() toward the verified distributional stat-line layer
     (research/model_statlines.md; src/ml/statdist.js engineTargets at full length): a common-random-number pilot of
     params.retarget.pilot simulations in each corner order, pooled per fighter over the simulations that went the distance,
     then damped per-side corrections of attempts by position, accuracy odds (target x position logit shifts), the takedown
     attempt rate and the control target; params.retarget.iters iterations, capped by mlMaxRatio, cached per matchup;
     knockdown, conversion and stoppage levers untouched. Targets: opts.statTargets {A, B} (per-minute rates, this call's
     corner order) or opts.statdist {SD, input} (live); without targets the pass does nothing (m.retarget.applied false);
   - components.tdIntent / components.ctrlSpread: fight-level, mean-preserving lognormal draws per fighter on the takedown
     attempt rate (sd params.spread.td) and on the length of his top stints (the bottom man's stand-up and sweep hazards
     divided by a mean-1 lognormal, sd params.spread.ctrl), drawn from an auxiliary generator seeded by the fight's own
     form draws, so the main random stream is unchanged; sds fit to the 2019-2023 PIT coverage (tools/v8_gate.js).

   UMD: module.exports in Node, self.FightEngine in a browser or Web Worker. No DOM; all randomness comes from makeRng(seed). */
(function (root, factory) {
  var FP = root && root.FightParams, MLR = root && root.MLRates;
  if (!FP && typeof require === "function") { try { FP = require("./params3.js"); } catch (e) { FP = null; } }
  if (!MLR && typeof require === "function") { try { MLR = require("./ml/mlrates.js"); } catch (e) { MLR = null; } }
  var api = factory(FP, root, MLR);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FightEngine = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function (FP0, root, MLR0) {
  "use strict";
  var VERSION = "8.0.0";   // v8: v4.0.0 + components embed / retarget / tdIntent / ctrlSpread (all off = 4.0.0 bit for bit)

  // Sum keys (spec order; profiles may carry their own order in meta.keys / prof.keys)
  var KEYS = ["min", "n", "rds", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "h_att", "h_lnd", "b_att", "b_lnd",
    "l_att", "l_lnd", "t_att", "t_lnd", "od_att", "od_lnd", "oc_att", "oc_lnd", "og_att", "og_lnd", "oh_att", "oh_lnd",
    "ob_att", "ob_lnd", "ol_att", "ol_lnd", "ot_att", "ot_lnd", "kd", "okd", "td_att", "td_lnd", "otd_att", "otd_lnd",
    "ctrl", "octrl", "sub_att", "osub_att", "rev", "orev", "ko_w", "ko_l", "sub_w", "sub_l", "dec_w", "dec_l",
    "r5_min", "r5_min_1", "r5_min_2", "r5_min_3", "r5_min_4", "r5_min_5", "r5_lnd_1", "r5_lnd_2", "r5_lnd_3", "r5_lnd_4", "r5_lnd_5"];

  // Per-fighter fight statistics (round and fight totals), in this order
  var STK = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att", "c_lnd",
    "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev", "hurt", "pass", "up", "dmg", "sh_lnd", "sb_lnd", "sl_lnd"];
  var NS = STK.length;
  var I_SA = 0, I_SL = 1, I_HA = 2, I_HL = 3, I_BA = 4, I_BL = 5, I_LA = 6, I_LL = 7, I_DA = 8, I_DL = 9, I_CA = 10, I_CL = 11,
    I_GA = 12, I_GL = 13, I_KD = 14, I_TDA = 15, I_TDL = 16, I_CTRL = 17, I_SUB = 18, I_REV = 19, I_HURT = 20, I_PASS = 21,
    I_UP = 22, I_DMG = 23, I_SHL = 24, I_SBL = 25, I_SLL = 26;

  var POSN = ["guard", "half", "side", "mount", "back"];
  var LOCN = ["dist", "clinch", "ground", "ground"];
  var SIDE = ["A", "B"];
  // event types
  var E_STRIKE = 0, E_CLINCH = 1, E_BREAK = 2, E_TD = 3, E_PASS = 4, E_ESC = 5, E_SWEEP = 6, E_UP = 7, E_SUB = 8,
    E_RECOVER = 9, E_RESET = 10, E_SWAP = 11;

  var DB = null;
  var MLMODEL = null;          // learned stat-line model handle (MLRates.load), set by loadMLRates()
  // v8 components.embed: the embedding evaluator, needed only to compute task predictors from a loaded roster (loadEmbed);
  // backtests pass precomputed predictors in opts.embed
  var EMB0 = null; if (typeof require === "function") { try { EMB0 = require("./ml/embed.js"); } catch (e) { EMB0 = null; } }
  function getEmbMod() { return EMB0 || (root && root.FightEmbed) || null; }

  // ------------------------------------------------------------------ helpers
  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function odds(p) { p = clip(p, 1e-6, 1 - 1e-6); return p / (1 - p); }
  function prob(o) { return o / (1 + o); }
  function logit(p) { return Math.log(odds(p)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  function log5(a, b, l) { return prob(odds(a) * odds(b) / odds(l)); }
  function shr(ev, ex, prior, k) { return (ev + k * prior) / (Math.max(0, ex) + k); }
  function pw(x, e) { return e === 1 ? x : Math.pow(x, e); }
  function lnorm(rng, sd) { return sd > 0 ? Math.exp(sd * rng.normal() - 0.5 * sd * sd) : (rng.normal(), 1); }
  function getParams() { return FP0 || (root && root.FightParams) || null; }
  function finNum(v) { return v != null && v !== "" && typeof v !== "boolean" && isFinite(+v); }
  function compOn(p, name) { return !!(p && p.components && p.components[name]); }
  function getML() { return MLR0 || (root && root.MLRates) || null; }

  function mergeParams(base, over) {
    var out = {}, k, k2;
    for (k in base) {
      var v = base[k];
      if (v && typeof v === "object" && !Array.isArray(v)) { out[k] = {}; for (k2 in v) out[k][k2] = v[k2]; }
      else out[k] = v;
    }
    if (over) for (k in over) {
      var o = over[k];
      if (o && typeof o === "object" && !Array.isArray(o) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
        for (k2 in o) {
          if (o[k2] && typeof o[k2] === "object" && !Array.isArray(o[k2]) && out[k][k2] && typeof out[k][k2] === "object") {
            var inner = {}, k3; for (k3 in out[k][k2]) inner[k3] = out[k][k2][k3]; for (k3 in o[k2]) inner[k3] = o[k2][k3]; out[k][k2] = inner;
          } else out[k][k2] = o[k2];
        }
      } else out[k] = o;
    }
    return out;
  }

  function sums(prof) {
    var S = prof.S, keys = prof.keys || (DB && DB.meta && DB.meta.keys) || KEYS, o = {}, i;
    for (i = 0; i < KEYS.length; i++) o[KEYS[i]] = 0;
    if (Array.isArray(S)) { for (i = 0; i < keys.length && i < S.length; i++) o[keys[i]] = +S[i] || 0; }
    else if (S) { for (var k in S) o[k] = +S[k] || 0; }
    return o;
  }

  function yearsBetween(d0, d1) {
    var a = Date.parse(d0), b = Date.parse(d1);
    if (!isFinite(a) || !isFinite(b)) return null;
    return (b - a) / (365.2425 * 86400000);
  }
  function ageAt(prof, date) {
    if (prof.age != null && isFinite(prof.age)) return +prof.age;
    if (prof.dob && date) return yearsBetween(prof.dob, date);
    return null;
  }

  function priorFor(division, priors) {
    var src = priors || (DB && DB.priors);
    if (!src) throw new Error("FightEngine: no priors loaded. Call FightEngine.loadDB(fightersJson) or pass opts.priors.");
    var all = src.ALL || {}, d = src[division] || all, out = {}, k;
    for (k in all) out[k] = all[k];
    for (k in d) if (d[k] != null) out[k] = d[k];
    return out;
  }

  // ------------------------------------------------------------------ league (division) derived quantities
  function league(P, p) {
    var L = {}, gs = p.ctrlGroundShare;
    var cf = P.ctrl / 60;                       // fraction of fight time each fighter controls
    L.ground = 2 * cf * gs; L.clinch = 2 * cf * (1 - gs); L.dist = 1 - L.ground - L.clinch;
    L.stand = 1 - L.ground; L.top = cf * gs;
    L.dAtt = P.d_att / L.dist;                  // distance attempts per distance-minute (per fighter)
    L.gAtt = P.g_att / L.top;                   // ground attempts per top-minute
    L.tdAtt = P.td_att / L.stand;               // takedown attempts per standing minute
    L.sub = P.sub_att / L.ground;               // submission attempts per ground-minute (either side)
    L.rev = P.rev / L.top;                      // reversals per bottom-minute
    // distance target mix = totals minus clinch and ground mixes
    var cm = p.clinchMix, gm = p.groundTopMix, tA = [P.h_att, P.b_att, P.l_att], dm = [0, 0, 0], s = 0, t;
    for (t = 0; t < 3; t++) { dm[t] = Math.max(0.02 * P.d_att, tA[t] - P.c_att * cm[t] - P.g_att * gm[t]); s += dm[t]; }
    for (t = 0; t < 3; t++) dm[t] /= s;
    L.mixD = dm;
    // accuracy table: logit p(pos, tgt) = alpha_tgt + beta_pos, fit to the division's target and position marginals
    var att = [P.d_att, P.c_att, P.g_att], mix = [dm, cm, gm];
    var tm = [P.acc_h, P.acc_b, P.acc_l], pm = [P.acc_d, P.acc_c, P.acc_g];
    var a = [logit(tm[0]), logit(tm[1]), logit(tm[2])], b = [0, logit(pm[1]) - logit(pm[0]), logit(pm[2]) - logit(pm[0])];
    for (var it = 0; it < 80; it++) {
      var q, num, den, w;
      for (t = 0; t < 3; t++) {
        num = 0; den = 0;
        for (q = 0; q < 3; q++) { w = att[q] * mix[q][t]; num += w * sigm(a[t] + b[q]); den += w; }
        a[t] += logit(tm[t]) - logit(num / den);
      }
      for (q = 0; q < 3; q++) {
        num = 0; den = 0;
        for (t = 0; t < 3; t++) { w = att[q] * mix[q][t]; num += w * sigm(a[t] + b[q]); den += w; }
        b[q] += logit(pm[q]) - logit(num / den);
      }
    }
    L.accA = a; L.accB = b;
    // knockdowns per landed standing head strike: KDs only come from standing strikes
    var groundHead = P.g_lnd * gm[0];
    L.kd0 = P.kd_per_h * P.h_lnd / Math.max(0.2 * P.h_lnd, P.h_lnd - groundHead);
    return L;
  }

  function expAcc(L, w, mix, t) {
    var num = 0, den = 0;
    for (var q = 0; q < 3; q++) { var x = w[q] * mix[q][t]; num += x * sigm(L.accA[t] + L.accB[q]); den += x; }
    return den > 0 ? num / den : sigm(L.accA[t]);
  }

  function distMix(s, pre, L, p) {
    // a fighter's distance target mix: his totals by target minus clinch / ground shares, shrunk to the league mix
    var cm = p.clinchMix, gm = p.groundTopMix, names = ["h", "b", "l"], c = [0, 0, 0], tot = 0, t;
    var dAtt = s[pre + "d_att"], cAtt = s[pre + "c_att"], gAtt = s[pre + "g_att"];
    for (t = 0; t < 3; t++) {
      c[t] = Math.max(0.02 * dAtt, s[pre + names[t] + "_att"] - cAtt * cm[t] - gAtt * gm[t]);
      tot += c[t];
    }
    var out = [0, 0, 0];
    for (t = 0; t < 3; t++) out[t] = (c[t] + p.kTgt * L.mixD[t]) / (tot + p.kTgt);
    return out;
  }

  // ------------------------------------------------------------------ one fighter's shrunk rates
  function fighterRates(prof, P, L, p, nR) {
    var s = sums(prof), gs = p.ctrlGroundShare, R = { sums: s };
    var min = Math.max(0, s.min);
    var topMin = s.ctrl / 60 * gs, botMin = s.octrl / 60 * gs, grMin = topMin + botMin;
    var clMin = (s.ctrl + s.octrl) / 60 * (1 - gs);
    var distMin = Math.max(0.25 * min, min - grMin - clMin), standMin = Math.max(0.3 * min, min - grMin);
    R.min = min; R.distMin = distMin; R.topMin = topMin; R.botMin = botMin; R.standMin = standMin;
    R.dAtt = shr(s.d_att, distMin, L.dAtt, p.kPM * L.dist);
    R.dAttAg = shr(s.od_att, distMin, L.dAtt, p.kPM * L.dist);
    R.cAtt = shr(s.c_att, min, P.c_att, p.kPM);
    R.cAttAg = shr(s.oc_att, min, P.c_att, p.kPM);
    R.gAtt = shr(s.g_att, topMin, L.gAtt, p.kPM * L.top);
    R.gAttAg = shr(s.og_att, botMin, L.gAtt, p.kPM * L.top);
    R.tdAtt = shr(s.td_att, standMin, L.tdAtt, p.kTdPM * L.stand);
    R.tdAttAg = shr(s.otd_att, standMin, L.tdAtt, p.kTdPM * L.stand);
    R.tdAcc = clip(shr(s.td_lnd, s.td_att, P.td_acc, p.kTdAcc), 0.03, 0.95);
    R.tdAccAg = clip(shr(s.otd_lnd, s.otd_att, P.td_acc, p.kTdAcc), 0.03, 0.95);
    R.ctrl = shr(s.ctrl, min, P.ctrl, p.kPM);
    R.octrl = shr(s.octrl, min, P.ctrl, p.kPM);
    var cpt = P.ctrl_per_td;
    R.topSkill = shr(s.ctrl, s.td_lnd, cpt, p.kCtrlTD) / cpt;
    R.escWeak = shr(s.octrl, s.otd_lnd, cpt, p.kCtrlTD) / cpt;
    R.sub = shr(s.sub_att, grMin, L.sub, p.kPM * L.ground);
    R.subAg = shr(s.osub_att, grMin, L.sub, p.kPM * L.ground);
    R.subConv = clip(shr(s.sub_w, s.sub_att, P.sub_conv, p.kSub), 0.03, 0.85);
    R.subDefFail = clip(shr(s.sub_l, s.osub_att, P.sub_conv, p.kSub), 0.03, 0.85);
    R.rev = shr(s.rev, botMin, L.rev, p.kRev * L.top);
    R.revAg = shr(s.orev, topMin, L.rev, p.kRev * L.top);
    R.pow = shr(s.kd, s.h_lnd, P.kd_per_h, p.kKD);
    R.chin = shr(s.okd, s.oh_lnd, P.kd_per_h, p.kKD);
    // target mix at distance and accuracy shifts by target (relative to what his position mix implies)
    R.mixD = distMix(s, "", L, p);
    R.mixDAg = distMix(s, "o", L, p);
    var eps = 1e-6, cm = p.clinchMix, gm = p.groundTopMix, names = ["h", "b", "l"], t;
    var wX = [s.d_att + eps * P.d_att, s.c_att + eps * P.c_att, s.g_att + eps * P.g_att];
    var wO = [s.od_att + eps * P.d_att, s.oc_att + eps * P.c_att, s.og_att + eps * P.g_att];
    R.accSh = [0, 0, 0]; R.accAgSh = [0, 0, 0]; R.acc = [0, 0, 0]; R.accAg = [0, 0, 0];
    for (t = 0; t < 3; t++) {
      var eX = expAcc(L, wX, [R.mixD, cm, gm], t), eO = expAcc(L, wO, [R.mixDAg, cm, gm], t);
      var aX = shr(s[names[t] + "_lnd"], s[names[t] + "_att"], eX, p.kAcc);
      var aO = shr(s["o" + names[t] + "_lnd"], s["o" + names[t] + "_att"], eO, p.kAcc);
      R.acc[t] = aX; R.accAg[t] = aO;
      R.accSh[t] = logit(aX) - logit(eX); R.accAgSh[t] = logit(aO) - logit(eO);
    }
    // pace: landed/min by round vs round 1, relative to the league curve, shrunk toward 1
    var pc = prof.pace, pwt = prof.pace_w, five = false, r;
    if (pc && pwt) for (r = 3; r < 5; r++) if (pc[r] != null && pwt[r] > 0) five = true;
    var lc = five ? p.paceLnd5 : p.paceLnd3;
    var rho = [1, 1, 1, 1, 1], rw = [0, 0, 0, 0, 0];
    for (r = 1; r < 5; r++) {
      if (pc && pwt && pc[r] != null && pwt[r] > 0 && r < lc.length) {
        var ratio = clip(pc[r] / lc[r], 0.3, 3);
        rho[r] = (ratio * pwt[r] + p.kPace) / (pwt[r] + p.kPace); rw[r] = pwt[r];
      } else if (r >= 1) { rho[r] = 1 + 0.5 * (rho[r - 1] - 1); }
    }
    R.rho = rho; R.rhoW = rw;
    var cs = 0, cn = 0, lastR = Math.max(2, nR || 3);
    for (r = 1; r < Math.min(5, lastR); r++) { cs += rho[r]; cn++; }
    R.cardio = cn ? cs / cn : 1;
    return R;
  }

  function normAdj(a) {
    a = a || {};
    function g(k, d) { return a[k] != null && isFinite(a[k]) ? +a[k] : d; }
    return { out: g("out", 1), acc: g("acc", 1), pow: g("pow", 1), chin: g("chin", 1), cardio: g("cardio", 1),
      tdAtt: g("tdAtt", 1), tdDef: g("tdDef", 1), leg: a.leg != null && isFinite(a.leg) ? clip(+a.leg, 0, 0.9) : null, sub: g("sub", 1) };
  }

  // ------------------------------------------------------------------ position occupancy (macro CTMC) for the fit
  // states: 0 distance, 1 clinch A controls, 2 clinch B controls, 3 A on top, 4 B on top. Integrated over one round from distance.
  function occupancy(q, T) {
    var D = 1, CA = 0, CB = 0, TA = 0, TB = 0, o0 = 0, o1 = 0, o2 = 0, o3 = 0, o4 = 0, dt = 1, n = Math.round(T / dt);
    var e = q.e, pA = q.pA, x = q.x, sw = q.swap, fc = q.fc;
    for (var s = 0; s < n; s++) {
      o0 += D; o1 += CA; o2 += CB; o3 += TA; o4 += TB;
      var fDCA = e * pA * D + q.tdD[0] * (1 - q.pD[0]) * q.ftc * D, fDCB = e * (1 - pA) * D + q.tdD[1] * (1 - q.pD[1]) * q.ftc * D;
      var fDTA = q.tdD[0] * q.pD[0] * D, fDTB = q.tdD[1] * q.pD[1] * D;
      var fCAD = x * CA, fCBD = x * CB, fCACB = sw * 2 * (1 - pA) * CA, fCBCA = sw * 2 * pA * CB;
      var fCATA = q.tdCC[0] * q.pC[0] * CA, fCATB = q.tdCU[1] * q.pC[1] * CA;
      var fCBTB = q.tdCC[1] * q.pC[1] * CB, fCBTA = q.tdCU[0] * q.pC[0] * CB;
      var fTAD = q.up[1] * (1 - fc) * TA, fTACA = q.up[1] * fc * TA, fTATB = q.rev[1] * TA;
      var fTBD = q.up[0] * (1 - fc) * TB, fTBCB = q.up[0] * fc * TB, fTBTA = q.rev[0] * TB;
      D += dt * (fCAD + fCBD + fTAD + fTBD - fDCA - fDCB - fDTA - fDTB);
      CA += dt * (fDCA + fCBCA + fTACA - fCAD - fCACB - fCATA - fCATB);
      CB += dt * (fDCB + fCACB + fTBCB - fCBD - fCBCA - fCBTB - fCBTA);
      TA += dt * (fDTA + fCATA + fCBTA + fTBTA - fTAD - fTACA - fTATB);
      TB += dt * (fDTB + fCBTB + fCATB + fTATB - fTBD - fTBCB - fTBTA);
    }
    return [o0 / n, o1 / n, o2 / n, o3 / n, o4 / n];
  }

  // sub-position occupancy over a ground stint for a top man with pass multiplier pm (escape multiplier 1/pm)
  function subposOcc(p, pm) {
    var x = p.tdLand.slice(), acc = [0, 0, 0, 0, 0], h = 1 / 150, a, b;
    for (var s = 0; s < 600; s++) {
      var nx = x.slice();
      for (a = 0; a < 5; a++) {
        acc[a] += x[a];
        for (b = 0; b < 5; b++) {
          var f = x[a] * (p.pass[a][b] * pm + p.retain[a][b] / pm);
          nx[a] -= f; nx[b] += f;
        }
      }
      for (a = 0; a < 5; a++) x[a] = nx[a] * (1 - h);
    }
    var t = acc[0] + acc[1] + acc[2] + acc[3] + acc[4];
    for (a = 0; a < 5; a++) acc[a] /= t;
    return acc;
  }
  function wavg(occ, mult) { var s = 0; for (var i = 0; i < 5; i++) s += occ[i] * mult[i]; return s; }

  function info(prof) {
    return { slug: prof.slug || null, name: prof.name || "Fighter", nick: prof.nick || null, division: prof.division || prof.home || null,
      dob: prof.dob || null, height_in: prof.height_in || null, reach_in: prof.reach_in || null, stance: prof.stance || null,
      record: prof.record || null, elo: prof.elo || null, ko_losses: prof.ko_losses || 0, n_fights: prof.n_fights || prof.n || null };
  }

  function resolve(x) {
    if (typeof x === "string") { var p = profile(x); if (!p) throw new Error("FightEngine: unknown fighter " + x); return p; }
    return x;
  }

  // ------------------------------------------------------------------ matchup (v3 rate tables, no learned model)
  function matchupBase(profA, profB, opts) {
    opts = opts || {};
    var base = getParams();
    if (!base) throw new Error("FightEngine: FightParams not loaded (load params3.js first)");
    var p = mergeParams(base, opts.params);
    profA = resolve(profA); profB = resolve(profB);
    var division = opts.division || profA.division || profA.home || "Lightweight";
    var P = priorFor(division, opts.priors);
    var nR = opts.rounds || (opts.title ? 5 : 3);
    var dv = (p.div && p.div[division]) || {};
    function dvf(k) { return dv[k] != null ? dv[k] : 1; }
    var L = league(P, p);
    var profs = [profA, profB];
    var R = [fighterRates(profA, P, L, p, nR), fighterRates(profB, P, L, p, nR)];
    var adj = [normAdj(opts.adjA), normAdj(opts.adjB)];
    var jud = opts.judges || {};
    var date = opts.date || (DB && DB.meta && DB.meta.snapshot) || null;
    var a = p.combA, b = p.combB, i, j, k;
    var m = { version: VERSION, A: info(profA), B: info(profB), division: division, rounds: nR, title: !!opts.title, date: date,
      p: p, P: P, L: L, R: R, adj: adj, judgePower: jud.power != null ? +jud.power : p.judge.power, opts: opts };

    // ---- strike attempt rates
    m.dRate = [0, 0]; m.cRate = [0, 0]; m.gRate = [0, 0]; m.gBot = [0, 0];
    var Ec = [0, 0], gRateAvg = [0, 0];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var sc = p.strikeScale * dvf("att");
      m.dRate[i] = L.dAtt * pw(R[i].dAtt / L.dAtt, a) * pw(R[j].dAttAg / L.dAtt, b) / 60 * sc * adj[i].out;
      Ec[i] = P.c_att * pw(R[i].cAtt / P.c_att, a) * pw(R[j].cAttAg / P.c_att, b);
      gRateAvg[i] = L.gAtt * pw(R[i].gAtt / L.gAtt, a) * pw(R[j].gAttAg / L.gAtt, b) / 60 * sc * p.groundScale * adj[i].out;
    }
    var clinchMult = Math.pow((Ec[0] + Ec[1]) / (2 * P.c_att), p.clinchTimeExp);
    var clT = clip(L.clinch * clinchMult, 0.005, 0.3);
    for (i = 0; i < 2; i++) m.cRate[i] = Ec[i] / clT / 60 * p.strikeScale * dvf("att") * p.clinchScale * adj[i].out;

    // ---- takedowns (knob-neutral for the occupancy fit; knobs applied after)
    var tdS = [0, 0], pTd = [0, 0];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      tdS[i] = L.tdAtt * pw(R[i].tdAtt / L.tdAtt, a) * pw(R[j].tdAttAg / L.tdAtt, b) / 60 * p.tdScale * dvf("td");
      pTd[i] = prob(odds(log5(R[i].tdAcc, R[j].tdAccAg, P.td_acc)) * p.tdOddsScale);
    }
    // ---- control targets (s per fight-minute) and clinch controller share
    var ctrlT = [0, 0];
    var ctrlSc = p.ctrlScale != null ? p.ctrlScale : 1;   // global control-target scale (walk-forward; the inverse of a get-up scale)
    for (i = 0; i < 2; i++) { j = 1 - i; ctrlT[i] = P.ctrl * pw(R[i].ctrl / P.ctrl, a) * pw(R[j].octrl / P.ctrl, b) * dvf("ctrl") * ctrlSc; }
    var xA = ctrlT[0] / (ctrlT[0] + ctrlT[1]);
    var pCtl = 0.5 + p.clinchCtrlTemper * (xA - 0.5);
    var pcs = [pCtl, 1 - pCtl];
    var standT = Math.max(0.2, L.stand), distT = Math.max(0.1, standT - clT);
    m.tdD = [0, 0]; m.tdCC = [0, 0]; m.tdCU = [0, 0];
    for (i = 0; i < 2; i++) {
      var rd = tdS[i] * (distT + clT) / (distT + clT * (pcs[i] * p.tdClinchMult + (1 - pcs[i]) * p.tdClinchUnder));
      m.tdD[i] = rd; m.tdCC[i] = rd * p.tdClinchMult; m.tdCU[i] = rd * p.tdClinchUnder;
    }
    var pTdC = [prob(odds(pTd[0]) * p.tdClinchOdds), prob(odds(pTd[1]) * p.tdClinchOdds)];
    // ---- sweeps
    var sw = [0, 0];
    for (i = 0; i < 2; i++) { j = 1 - i; sw[i] = L.rev * pw(R[i].rev / L.rev, a) * pw(R[j].revAg / L.rev, b) / 60 * p.sweepScale; }
    // ---- grappling edge on top (passes) from control per takedown vs control conceded per takedown absorbed
    var gEdge = [0, 0], occS = [null, null];
    for (i = 0; i < 2; i++) { j = 1 - i; gEdge[i] = clip(Math.sqrt(R[i].topSkill * R[j].escWeak), 0.4, 2.5); occS[i] = subposOcc(p, gEdge[i]); }
    var avgSweep = [wavg(occS[0], p.sweepPos), wavg(occS[1], p.sweepPos)];
    var avgStand = [wavg(occS[0], p.standPos), wavg(occS[1], p.standPos)];
    // ---- fit clinch entry and stand-up hazards so occupancy matches the targets
    var q = { e: 0.0025, pA: pCtl, x: p.clinchBreak, swap: p.clinchSwap, fc: p.standClinch, ftc: p.failTdClinch,
      tdD: m.tdD, pD: pTd, tdCC: m.tdCC, tdCU: m.tdCU, pC: pTdC,
      up: [1 / 200, 1 / 200], rev: [sw[0] * avgSweep[1], sw[1] * avgSweep[0]] };   // rev[i] = i sweeps from bottom (top = other)
    var occ = null, it, gTarget = [0, 0];
    for (it = 0; it < 60; it++) {
      occ = occupancy(q, 300);
      var cl = occ[1] + occ[2];
      q.e = clip(q.e * Math.pow(clT / Math.max(1e-6, cl), 0.8), 1e-5, 0.08);
      gTarget[0] = Math.max(0.002, ctrlT[0] / 60 - occ[1]);
      gTarget[1] = Math.max(0.002, ctrlT[1] / 60 - occ[2]);
      q.up[1] = clip(q.up[1] * Math.pow(occ[3] / gTarget[0], 0.8), 1 / 3000, 1 / 6);   // B gets up from under A
      q.up[0] = clip(q.up[0] * Math.pow(occ[4] / gTarget[1], 0.8), 1 / 3000, 1 / 6);
    }
    occ = occupancy(q, 300);
    m.occ = occ; m.ctrlT = ctrlT; m.clT = clT; m.gTarget = gTarget;
    m.clE = q.e; m.pCtl = pCtl; m.clBreak = p.clinchBreak; m.clSwap = p.clinchSwap;
    m.up = q.up.slice(); m.sw = sw; m.gEdge = gEdge; m.occS = occS;
    // knobs on takedowns after the fit: attempts x tdAtt, success odds / opponent's tdDef
    m.tdO = [0, 0]; m.tdOC = [0, 0];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      m.tdD[i] *= adj[i].tdAtt; m.tdCC[i] *= adj[i].tdAtt; m.tdCU[i] *= adj[i].tdAtt;
      m.tdO[i] = odds(pTd[i]) / adj[j].tdDef; m.tdOC[i] = odds(pTdC[i]) / adj[j].tdDef;
    }
    m.pTd = pTd; m.tdS = tdS;

    // ---- per sub-position tables (index top*5 + pos)
    m.upPos = new Float64Array(10); m.swPos = new Float64Array(10); m.gPos = new Float64Array(10);
    m.subTPos = new Float64Array(10); m.subBPos = new Float64Array(10); m.subOPos = new Float64Array(10);
    var threat = [0, 0];
    for (i = 0; i < 2; i++) { j = 1 - i; threat[i] = L.sub * pw(R[i].sub / L.sub, a) * pw(R[j].subAg / L.sub, b) * p.subAttScale * adj[i].sub; }
    var sb = p.subBotShare, ss = p.subStandShare;
    var oddsNorm = (1 - sb - ss) + sb * p.subBotOdds + ss * p.subStandOdds;
    for (i = 0; i < 2; i++) {
      j = 1 - i;                                   // i on top, j on bottom
      var oc = occS[i];
      var aSt = avgStand[i], aSw = avgSweep[i], aG = wavg(oc, p.gnpPos), aT = wavg(oc, p.subTopPos), aB = wavg(oc, p.subBotPos);
      var oddsW = 0; for (k = 0; k < 5; k++) oddsW += oc[k] * p.subTopPos[k] * p.subOddsPos[k];
      var aO = oddsW / aT;
      for (k = 0; k < 5; k++) {
        m.upPos[i * 5 + k] = m.up[j] * p.standPos[k] / aSt;
        m.swPos[i * 5 + k] = sw[j] * p.sweepPos[k] / aSw;
        m.gPos[i * 5 + k] = gRateAvg[i] * p.gnpPos[k] / aG;
        m.subTPos[i * 5 + k] = threat[i] * (1 - sb - ss) * 2 / 60 * p.subTopPos[k] / aT;
        m.subBPos[i * 5 + k] = threat[j] * sb * 2 / 60 * p.subBotPos[k] / aB;    // the bottom man (j) attacking
        m.subOPos[i * 5 + k] = p.subOddsPos[k] / aO / oddsNorm;
      }
      m.gBot[j] = gRateAvg[j] * p.gBotRel;
      m.gRate[i] = gRateAvg[i];
    }
    m.threat = threat;
    m.subO = [0, 0]; m.subConv = [0, 0]; m.gillo = [0, 0];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      m.subConv[i] = log5(R[i].subConv, R[j].subDefFail, P.sub_conv);
      m.subO[i] = odds(m.subConv[i]) * p.subConvScale * dvf("sub") * Math.sqrt(adj[i].sub);
      // standing guillotine attempts per stuffed shot by the opponent (league: standing share of attempts / failed shots)
      var lg = P.sub_att * ss / Math.max(1e-4, P.td_att - P.td_lnd);
      m.gillo[i] = clip(lg * threat[i] / L.sub * p.gilloScale, 0, 0.3);
    }
    m.subBotO = p.subBotOdds / oddsNorm; m.subStandO = p.subStandOdds / oddsNorm;

    // ---- accuracy odds by attacker, position code (0 dist, 1 clinch, 2 top, 3 bottom), target
    m.accO = new Float64Array(24); m.mixC = new Float64Array(16);
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var mixD = R[i].mixD.slice();
      if (adj[i].leg != null) {
        var hb = mixD[0] + mixD[1], rest = 1 - adj[i].leg;
        mixD = [mixD[0] / hb * rest, mixD[1] / hb * rest, adj[i].leg];
      }
      var mixes = [mixD, p.clinchMix, p.groundTopMix, p.groundBotMix];
      for (var pc = 0; pc < 4; pc++) {
        var mx = mixes[pc];
        m.mixC[(i * 4 + pc) * 2] = mx[0]; m.mixC[(i * 4 + pc) * 2 + 1] = mx[0] + mx[1];
        var posq = pc < 2 ? pc : 2;
        for (var t = 0; t < 3; t++) {
          var z = L.accA[t] + L.accB[posq] + a * R[i].accSh[t] + b * R[j].accAgSh[t];
          m.accO[(i * 4 + pc) * 3 + t] = Math.exp(z) * (pc === 3 ? p.botAccOdds : 1) * p.accScale * adj[i].acc;
        }
      }
      m.mixD = m.mixD || [null, null]; m.mixD[i] = mixD;
    }

    // ---- power, chin and their factors
    var ages = [ageAt(profA, date), ageAt(profB, date)];
    var homeLbs = [null, null], fightLbs = P.lbs;
    for (i = 0; i < 2; i++) {
      var hd = profs[i].division || profs[i].home;
      try { homeLbs[i] = hd ? priorFor(hd, opts.priors).lbs : null; } catch (e) { homeLbs[i] = null; }
    }
    m.ages = ages; m.homeLbs = homeLbs; m.fightLbs = fightLbs;
    var fac = [{}, {}];
    for (i = 0; i < 2; i++) {
      var ag = ages[i] != null ? Math.max(0, ages[i] - p.chinAge0) : 0;
      var upLb = (fightLbs && homeLbs[i]) ? Math.max(0, fightLbs - homeLbs[i]) / 10 : 0;
      var kol = profs[i].ko_losses || 0;
      fac[i] = {
        powRaw: R[i].pow / P.kd_per_h, chinRaw: R[i].chin / P.kd_per_h,
        ageChin: Math.exp(p.chinAge * ag), agePow: Math.exp(-p.powAge * ag),
        koChin: Math.min(p.chinKOcap, Math.pow(1 + p.chinKO, kol)), koLosses: kol,
        sizeChin: Math.exp(p.sizeChin * upLb), sizePow: Math.exp(-p.sizePow * upLb), lbsUp: upLb * 10
      };
      // power / chin exponents (walk-forward tunable; default to the log-linear combination exponents)
      fac[i].pow = pw(fac[i].powRaw, p.powExp != null ? p.powExp : a) * fac[i].agePow * fac[i].sizePow * adj[i].pow;
      fac[i].chin = pw(fac[i].chinRaw, p.chinExp != null ? p.chinExp : b) * fac[i].ageChin * fac[i].koChin * fac[i].sizeChin * adj[i].chin;
    }
    m.fac = fac;
    var koF = dvf("ko"), finOdds = odds(P.kd_fin != null ? P.kd_fin : p.kdFinRef) / odds(p.kdFinRef);
    m.kd = [0, 0]; m.dw = [0, 0]; m.gnp = [0, 0]; m.stko = [0, 0];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      m.kd[i] = L.kd0 * p.kdScale * dvf("kd") * fac[i].pow * fac[j].chin;
      m.dw[i] = Math.pow(fac[i].pow, p.powDmgExp);
      var pc2 = Math.sqrt(fac[i].pow * fac[j].chin);
      m.gnp[i] = p.gnpTko * pc2 * koF;
      m.stko[i] = p.stko * pc2 * koF;
    }
    m.instO = odds(p.kdInstant) * Math.sqrt(finOdds) * koF;
    m.refO = odds(p.kdRefStop) * finOdds * koF;

    // ---- pace and cardio
    var curve = nR === 5 ? p.pace5 : (nR === 3 ? p.pace3 : null);
    if (!curve) { curve = []; for (k = 0; k < nR; k++) curve.push(k < p.pace5.length ? p.pace5[k] : p.pace5[p.pace5.length - 1]); }
    var nb = Math.min(3, nR), cm0 = 0; for (k = 0; k < nb; k++) cm0 += curve[k]; cm0 /= nb;
    m.paceCurve = []; m.kdPace = []; m.pace = [[], []]; m.finR = [];
    var c5 = p.caution5 != null ? p.caution5 : 1;   // 5-round (main event / title) caution on knockdowns, GNP TKOs and submission conversion, every round
    for (k = 0; k < nR; k++) m.finR.push(nR >= 5 ? (k === 0 ? p.r1Caution5 : 1) * c5 : 1);
    for (k = 0; k < nR; k++) { m.paceCurve.push(curve[k] / cm0); m.kdPace.push(Math.pow(curve[k] / cm0, p.kdPaceExp)); }
    m.drain = [0, 0]; m.cardio = [0, 0];
    for (i = 0; i < 2; i++) {
      var rho = R[i].rho, rm = 0; for (k = 0; k < nb; k++) rm += rho[k]; rm /= nb;
      for (k = 0; k < nR; k++) m.pace[i].push(m.paceCurve[k] * rho[Math.min(4, k)] / rm);
      m.cardio[i] = R[i].cardio;
      m.drain[i] = p.drain * Math.pow(3 / nR, p.drainSchedExp) * Math.pow(clip(R[i].cardio, 0.5, 1.6), -p.cardioExp) * adj[i].cardio;
    }
    // fixed-shape constants for the simulation loop (one literal: a stable, fast object layout)
    m.k = {
      accHurt: p.accHurt,
      accMob: p.accMob,
      accSelfStam: p.accSelfStam,
      accStam: p.accStam,
      bodyDrain: p.bodyDrain,
      clinchCtrlStrike: p.clinchCtrlStrike,
      corner: p.corner,
      dmgHeal: p.dmgHeal,
      dmgHurt: p.dmgHurt,
      dmgKD: p.dmgKD,
      dmgPos: p.dmgPos,
      doc: p.doc,
      docCap: p.docCap,
      drainPos: p.drainPos,
      drainTd: p.drainTd,
      drainAtt: p.drainAtt,
      failTdClinch: p.failTdClinch,
      finStamAtt: p.finStamAtt,
      gnpDmg: p.gnpDmg,
      gnpHurt: p.gnpHurt,
      gnpTkoPos: p.gnpTkoPos,
      groundReset: p.groundReset,
      hurtKdSecs: p.hurtKdSecs,
      hurtRatio: p.hurtRatio,
      hurtSecs: p.hurtSecs,
      instStam: p.instStam,
      kdBodyRatio: p.kdBodyRatio,
      kdDmg: p.kdDmg,
      kdGnpAcc: p.kdGnpAcc,
      kdGnpRate: p.kdGnpRate,
      kdHurt: p.kdHurt,
      kdInstantDmg: p.kdInstantDmg,
      kdPos: p.kdPos,
      kdPounce: p.kdPounce,
      kdRecover: p.kdRecover,
      kdRecoverStand: p.kdRecoverStand,
      kdRepeat: p.kdRepeat,
      kdStamAtt: p.kdStamAtt,
      kdStamDef: p.kdStamDef,
      legDmgScale: p.legDmgScale,
      legMobFloor: p.legMobFloor,
      legTko: p.legTko,
      legTko0: p.legTko0,
      outHurt: p.outHurt,
      outMob: p.outMob,
      outStam: p.outStam,
      pass: p.pass,
      powDmgExp: p.powDmgExp,
      recover: p.recover,
      refDmg: p.refDmg,
      retain: p.retain,
      standClinch: p.standClinch,
      standStam: p.standStam,
      stkoBase: p.stkoBase,
      subFailLose: p.subFailLose,
      subHurt: p.subHurt,
      subStam: p.subStam,
      tdAttStam: p.tdAttStam,
      tdLand: p.tdLand,
      tdStam: p.tdStam
    };
    return m;
  }

  // ------------------------------------------------------------------ matchup (v4): base tables + learned stat-line rates
  // opts.ml: false -> plain base tables (v3-style rates); undefined / true -> apply the loaded model (loadMLRates) when there
  // is one; { pred } or { A, B } -> apply these precomputed per-side rates (corner order of this call; e.g. out-of-fold
  // tables for leak-free backtests; base = league rates of the shrinkage division, filled in when missing); { model } ->
  // that model handle instead of the loaded one. opts.mlModel is accepted as a shorthand for { model }.
  // params.mlWeight (0..1) blends toward the base tables (1 = full learned rates); params.mlMaxRatio caps any single
  // multiplier. The result carries m.mlApplied (true / false) and, when applied, m.ml (targets, ratios) and m.mlPred.
  function mlPredFor(MLR, m, pa, pb, opts, model) {
    var x = opts.ml;
    var pred = null;
    if (x && typeof x === "object" && (x.pred || (x.A && x.B))) {
      var src = x.pred || x;
      pred = { A: src.A, B: src.B, base: src.base || null };
    } else if (model) {
      var priors = opts.priors || (DB && DB.priors) || null;
      if (!priors) { priors = {}; priors.ALL = m.P; priors[m.division] = m.P; }
      pred = MLR.predict(model, pa, pb, { division: m.division, prior_division: opts.prior_division || null, rounds: m.rounds,
        title: m.title, date: m.date, priors: priors });
    }
    if (!pred) return null;
    if (!pred.base) {
      var names = (model && model.targets) || MLR.TNAMES;
      pred.base = names.map(function (t) { var v = m.P[MLR.BASE_KEY[t]]; return v == null ? 0 : +v; });
    }
    return pred;
  }
  // v4's matchup: base tables + learned stat-line rates (v8: + the embedding blend of the learned targets when components.embed)
  function matchupML(pa, pb, opts) {
    var m = matchupBase(pa, pb, opts);
    m.mlApplied = false;
    if (opts.ml === false) return m;
    var MLR = getML();
    if (!MLR) return m;
    var model = opts.mlModel || (opts.ml && typeof opts.ml === "object" && opts.ml.model) || MLMODEL;
    var pred = mlPredFor(MLR, m, pa, pb, opts, model);
    if (!pred) return m;
    var w = m.p.mlWeight != null ? +m.p.mlWeight : 1;
    if (!(w > 0)) return m;
    if (compOn(m.p, "embed")) pred = embedTargets(m, pa, pb, opts, pred);   // v8 (off: pred untouched, exactly v4)
    MLR.applyToMatchup(m, pred, { engine: api, model: model || undefined, weight: w, maxRatio: m.p.mlMaxRatio || 4,
      parts: opts.mlParts || undefined });
    m.mlPred = { A: pred.A, B: pred.B, base: pred.base };
    m.mlApplied = true;
    return m;
  }
  function matchup(profA, profB, opts) {
    opts = opts || {};
    var pa = resolve(profA), pb = resolve(profB);
    var m = matchupML(pa, pb, opts);
    // v8: fight-level spread draws (components.tdIntent / ctrlSpread) and the realised-rate retarget (components.retarget);
    // with every v8 flag off nothing below touches m (v4.0.0 bit for bit)
    var sp = spreadOf(m.p);
    if (sp) m.spread = sp;
    if (!opts._noRetarget && compOn(m.p, "retarget")) retarget(m, pa, pb, opts);
    return m;
  }

  // ------------------------------------------------------------------ v8 components.embed (ported from engine v6)
  // research/model_embed.md "Integration recipe" (verified: mean relative deviance over 18 stat-line targets -1.67% [-2.11,
  // -1.24] on 2024-25). Per learned target t of one side (X attacking Y), before the adapter re-targets the tables:
  //   link(rate_t) = b0 + b1 link(mlrates rate_t) + b2 eta[task(t)]
  // links: log for per-minute rates (ctrl on minutes per minute), logit for accuracies, log for kd_h (capped at 0.5); eta = the
  // embedding model's task predictors for X against Y (params.embed.tasks order). Coefficients: params.embed.recipe (the exported
  // recipe, fit on 2019-2023) or opts.embed.recipe per call (backtests: fold-honest coefficients fit on 2019..Y-1,
  // data/derived/embed_blend_fh.json via tools/mlpathrec.js). Inputs: opts.embed = { etaA, etaB, recipe? } (this call's corner
  // order; false = none), else a roster registered with loadEmbed(embed_model.json) for bouts dated on or after its as-of date,
  // else nothing (the targets pass unchanged, m.embed.src null). Learned-rate path only.
  var EMBM = null, EMBASOF = null;
  function loadEmbed(json) {
    if (json == null) { EMBM = null; EMBASOF = null; return null; }
    var FEm = getEmbMod();
    if (!FEm) throw new Error("FightEngine.loadEmbed: src/ml/embed.js (FightEmbed) is not loaded");
    var d = typeof json === "string" ? JSON.parse(json) : json, h = FEm.load(d), p = getParams();
    var tk = (p && p.embed && p.embed.tasks) || null;
    if (tk && JSON.stringify(h.tasks.map(function (t) { return t[0]; })) !== JSON.stringify(tk)) throw new Error("FightEngine.loadEmbed: task order differs from params.embed.tasks");
    EMBM = h;
    EMBASOF = (d.model || d).era_date || null;
    return { n: Object.keys(h.model.roster || {}).length, asof: EMBASOF };
  }
  function embedEtas(m, pa, pb, opts) {
    var o = opts.embed;
    if (o === false) return null;
    if (o && o.etaA && o.etaB) return { etaA: o.etaA, etaB: o.etaB, recipe: o.recipe || null, src: "opts" };
    if (EMBM && (!m.date || !EMBASOF || String(m.date) >= EMBASOF)) {
      var eo = { rounds: m.rounds }, va = EMBM.vec((pa && pa.slug) || ""), vb = EMBM.vec((pb && pb.slug) || "");
      if (m.date) eo.date = m.date;
      return { etaA: EMBM.eta(va, vb, m.division, eo), etaB: EMBM.eta(vb, va, m.division, eo), recipe: null, src: "roster" };
    }
    return null;
  }
  function embedBlendSide(side, eta, recipe, tix) {
    var out = {}, k;
    for (k in side) out[k] = side[k];
    for (var tn in recipe) {
      if (side[tn] == null) continue;
      var r = recipe[tn], x = +side[tn], z, q, ti = tix[r.task];
      if (ti == null || eta[ti] == null) throw new Error("FightEngine embed: no task predictor for " + r.task);
      if (!finNum(eta[ti]) || !finNum(x)) continue;   // a non-finite predictor (or target) is missing: the target stays unblended
      if (tn === "ctrl") z = Math.log(Math.max(x / 60, 1e-6));
      else if (tn === "kd_h") z = Math.log(Math.min(Math.max(x, 1e-6), 1 - 1e-6));
      else if (r.link === "logit") { q = Math.min(Math.max(x, 1e-6), 1 - 1e-6); z = Math.log(q / (1 - q)); }
      else z = Math.log(Math.max(x, 1e-9));
      var e = r.b[0] + r.b[1] * z + r.b[2] * eta[ti];
      if (r.link === "logit") out[tn] = sigm(e);
      else if (tn === "ctrl") out[tn] = 60 * Math.exp(e);
      else if (tn === "kd_h") out[tn] = Math.min(Math.exp(e), 0.5);
      else out[tn] = Math.exp(e);
    }
    return out;
  }
  function embedTargets(m, pa, pb, opts, pred) {
    var eb = embedEtas(m, pa, pb, opts), pe = m.p.embed || {};
    if (!eb) { m.embed = { src: null }; return pred; }
    var rc = eb.recipe || pe.recipe, tix = {}, i;
    if (!rc || !pe.tasks) throw new Error("FightEngine: components.embed is on but params.embed has no tasks / recipe");
    for (i = 0; i < pe.tasks.length; i++) tix[pe.tasks[i]] = i;
    m.embed = { src: eb.src, recipe: eb.recipe ? "opts" : "params", raw: { A: pred.A, B: pred.B }, eta: { A: eb.etaA, B: eb.etaB } };
    return { A: embedBlendSide(pred.A, eb.etaA, rc, tix), B: embedBlendSide(pred.B, eb.etaB, rc, tix), base: pred.base };
  }

  // ------------------------------------------------------------------ v8 components.tdIntent / ctrlSpread
  // Per fighter and fight: a mean-1 lognormal multiplier on his takedown attempt rates (intent: some nights a wrestler shoots
  // all fight, some nights he does not) and on the length of his top stints (the bottom man's stand-up and sweep hazards are
  // divided by a mean-1 lognormal). Sds params.spread.td / .ctrl, fit to the 2019-2023 PIT coverage of takedown attempts and
  // control (the v4 engine's 80% bands held 0.68 / 0.77 of the real values on train; research/model_statlines.md).
  function spreadOf(p) {
    var on1 = compOn(p, "tdIntent"), on2 = compOn(p, "ctrlSpread"), sp = p.spread || {};
    var td = on1 && sp.td > 0 ? +sp.td : 0, ct = on2 && sp.ctrl > 0 ? +sp.ctrl : 0;
    return td > 0 || ct > 0 ? { td: td, ctrl: ct } : null;
  }
  // auxiliary generator seed from the fight's own form draws (doubles -> 32 bits); the main stream is not touched
  function auxSeed(a, b, c, d, e) {
    var x = [a, b, c, d, e], h = 0x811c9dc5;
    for (var i = 0; i < 5; i++) { var v = (Math.floor(Math.abs(x[i]) * 1e9) % 4294967296) >>> 0; h = Math.imul(h ^ v, 0x01000193) >>> 0; h = (h ^ (h >>> 15)) >>> 0; }
    return h;
  }
  // ------------------------------------------------------------------ v8 components.retarget: realised-rate retarget
  // The simulator's realised lines lose information against its static inputs (pace, stamina, damage, hurt and form act on
  // top of the rate tables): train 2019-23, ML static rates beat the realised lines on sig attempts / landed / control
  // (V6_V10_PLAN cycle 3 evidence). This pass makes the realised per-minute rates of the simulations that went the distance
  // match the statlines layer's per-minute means at full length (research/model_statlines.md: the like-for-like subset), by
  // a pilot -> correct loop:
  //   1. pilot: params.retarget.pilot simulations of this matchup in EACH corner order (fixed seeds: common random numbers,
  //      deterministic), pooled per fighter over the decision simulations;
  //   2. per fighter, with shrink s = damp x n / (n + kDec) (n = pooled decision simulations): takedown attempt rate x
  //      (target / realised)^s, control target x (target / realised)^s (then the position occupancy is refit as in matchup()),
  //      attempts by position (distance, clinch, ground) x (target / realised)^s x (static change the grappling step caused)^-1,
  //      accuracy odds x exp(s x shift) with the shift from a two-margin (target x position) logit fit of the realised vs the
  //      target accuracies on the static cells; realised rates are smoothed toward the target with kMin minutes and kAcc
  //      attempts, so a sparse stat is barely corrected;
  //   3. params.retarget.iters iterations; every cumulative multiplier is capped at [1 / mlMaxRatio, mlMaxRatio] and every
  //      accuracy shift at +-log(mlMaxRatio). Knockdown, conversion and stoppage levers are not touched.
  // Corner symmetry: the pilot runs both orders and the canonical order of the pair (by a content signature) fixes which order
  // gets which seed, so A-B and B-A get identical per-fighter corrections; the steps are cached per matchup and replayed.
  var RT_ST = ["d_att", "c_att", "g_att", "d_lnd", "c_lnd", "g_lnd", "h_att", "b_att", "l_att", "h_lnd", "b_lnd", "l_lnd", "td_att", "ctrl"];
  var NRT = RT_ST.length, RT_POSA = [0, 1, 2], RT_POSL = [3, 4, 5], RT_TGTA = [6, 7, 8], RT_TGTL = [9, 10, 11], RT_TD = 12, RT_CT = 13;
  var RTC = new Map(), RTC_MAX = 128;
  function rtTargets(m, opts) {
    var t = opts.statTargets || null;
    if (!t && opts.statdist && opts.statdist.SD && opts.statdist.input) {
      var SD = opts.statdist.SD;
      t = SD.engineTargets(SD.prepare(opts.statdist.input), 5 * m.rounds);
    }
    if (!t || !t.A || !t.B) return null;
    for (var i = 0; i < NRT; i++) {
      var k = RT_ST[i];
      if (!finNum(t.A[k]) || !finNum(t.B[k]) || t.A[k] < 0 || t.B[k] < 0) throw new Error("FightEngine retarget: target " + k + " missing or invalid");
    }
    return t;
  }
  function rtSig(prof, adj, mlSide, eta, tg) {
    var s = sums(prof), v = [];
    for (var i = 0; i < KEYS.length; i++) v.push(+(+s[KEYS[i]]).toPrecision(12));
    return JSON.stringify([prof.slug || prof.name || "", v, prof.age == null ? null : prof.age, prof.dob || null, prof.ko_losses || 0,
      prof.pace || null, prof.pace_w || null, prof.division || prof.home || null, adj || null, mlSide || null, eta || null, tg]);
  }
  function swapOpts(o, m) {
    var q = {}, k;
    for (k in o) q[k] = o[k];
    q.adjA = o.adjB; q.adjB = o.adjA;
    if (o.ml && typeof o.ml === "object" && (o.ml.pred || (o.ml.A && o.ml.B))) {
      var src = o.ml.pred || o.ml;
      q.ml = { pred: { A: src.B, B: src.A, base: src.base || null } };
      if (o.ml.model) q.ml.model = o.ml.model;
    }
    if (o.embed && o.embed.etaA && o.embed.etaB) q.embed = { etaA: o.embed.etaB, etaB: o.embed.etaA, recipe: o.embed.recipe || null };
    if (o.statTargets) q.statTargets = { A: o.statTargets.B, B: o.statTargets.A };
    if (o.statdist && o.statdist.input) {
      var I = o.statdist.input, J2 = {};
      for (k in I) J2[k] = I[k];
      J2.mlA = I.mlB; J2.mlB = I.mlA; J2.etaA = I.etaB; J2.etaB = I.etaA; J2.oppA = I.oppB; J2.oppB = I.oppA; J2.winLogit = -(+I.winLogit || 0);
      q.statdist = { SD: o.statdist.SD, input: J2 };
    }
    q.division = m.division;
    q._noRetarget = true;
    return q;
  }
  function rtPilot(m, N, seed) {
    var rng = makeRng(seed), sum = new Float64Array(2 * NRT), n = 0;
    for (var s = 0; s < N; s++) {
      var f = simulate(m, rng, false);
      if (!isDecision(f)) continue;
      n++;
      var TA = f.totals.A, TB = f.totals.B;
      for (var k = 0; k < NRT; k++) { sum[k] += TA[RT_ST[k]]; sum[NRT + k] += TB[RT_ST[k]]; }
    }
    return { n: n, sum: sum };
  }
  // one fighter's step from pooled decision-simulation counts c (RT_ST order), n simulations of 5R minutes, target rates tg
  function rtStep(c, n, R, tg, rc) {
    var mins = n * 5 * R, s = rc.damp * n / (n + rc.kDec), kMin = rc.kMin, kAcc = rc.kAcc, i;
    function rate(k) { var t = tg[RT_ST[k]]; return (c[k] + t * kMin) / (mins + kMin); }
    function ratio(k) { var t = tg[RT_ST[k]], r = rate(k); return t > 0 && r > 0 ? Math.pow(t / r, s) : 1; }
    var st = { s: s, n: n, td: ratio(RT_TD), ct: ratio(RT_CT), att: [ratio(0), ratio(1), ratio(2)], realPos: [], tgtT: [], realT: [], tgtQ: [], realQ: [] };
    for (i = 0; i < 3; i++) {
      var ta = tg[RT_ST[RT_TGTA[i]]], tl = tg[RT_ST[RT_TGTL[i]]], pa = tg[RT_ST[RT_POSA[i]]], pl = tg[RT_ST[RT_POSL[i]]];
      var aT = clip(tl / Math.max(ta, 1e-9), 0.02, 0.98), aQ = clip(pl / Math.max(pa, 1e-9), 0.02, 0.98);
      st.tgtT.push(aT); st.tgtQ.push(aQ);
      st.realT.push(clip((c[RT_TGTL[i]] + kAcc * aT) / (c[RT_TGTA[i]] + kAcc), 0.02, 0.98));
      st.realQ.push(clip((c[RT_POSL[i]] + kAcc * aQ) / (c[RT_POSA[i]] + kAcc), 0.02, 0.98));
      st.realPos.push(rate(RT_POSA[i]));
    }
    return st;
  }
  // static per-second attempts by position (distance, clinch, ground) and the static cells (4 position codes x 3 targets)
  function rtStatic(m, i) {
    var occ = m.occ, cs = m.p.clinchCtrlStrike, j = 1 - i;
    var a = [m.dRate[i] * occ[0], m.cRate[i] * (occ[1 + i] * cs + occ[2 - i] * (2 - cs)), m.gRate[i] * occ[3 + i], m.gBot[i] * occ[4 - i]];
    return { pos: [a[0], a[1], a[2] + a[3]], cell: a, j: j };
  }
  function rtRefitOcc(m) {
    var p = m.p, i, k;
    var avgSweep = [wavg(m.occS[0], p.sweepPos), wavg(m.occS[1], p.sweepPos)];
    var avgStand = [wavg(m.occS[0], p.standPos), wavg(m.occS[1], p.standPos)];
    var q = { e: m.clE, pA: m.pCtl, x: m.clBreak, swap: m.clSwap, fc: p.standClinch, ftc: p.failTdClinch,
      tdD: m.tdD, pD: [prob(m.tdO[0]), prob(m.tdO[1])], tdCC: m.tdCC, tdCU: m.tdCU, pC: [prob(m.tdOC[0]), prob(m.tdOC[1])],
      up: m.up.slice(), rev: [m.sw[0] * avgSweep[1], m.sw[1] * avgSweep[0]] };
    var occ = null, gT = [0, 0];
    for (var it = 0; it < 60; it++) {
      occ = occupancy(q, 300);
      var cl = occ[1] + occ[2];
      q.e = clip(q.e * Math.pow(m.clT / Math.max(1e-6, cl), 0.8), 1e-5, 0.08);
      gT[0] = Math.max(0.002, m.ctrlT[0] / 60 - occ[1]);
      gT[1] = Math.max(0.002, m.ctrlT[1] / 60 - occ[2]);
      q.up[1] = clip(q.up[1] * Math.pow(occ[3] / gT[0], 0.8), 1 / 3000, 1 / 6);
      q.up[0] = clip(q.up[0] * Math.pow(occ[4] / gT[1], 0.8), 1 / 3000, 1 / 6);
    }
    m.occ = occupancy(q, 300); m.clE = q.e; m.up = q.up.slice(); m.gTarget = gT;
    for (i = 0; i < 2; i++) for (k = 0; k < 5; k++) m.upPos[i * 5 + k] = m.up[1 - i] * p.standPos[k] / avgStand[i];
  }
  // two-margin logit fit: shifts alpha (by target) and beta (by position) so the weighted cell accuracies match wantT / wantQ
  function rtIpf(A, z0, wantT, wantQ) {
    var al = [0, 0, 0], be = [0, 0, 0], posOf = [0, 1, 2, 2], pc, t, q, it;
    for (it = 0; it < 40; it++) {
      for (t = 0; t < 3; t++) {
        var num = 0, den = 0;
        for (pc = 0; pc < 4; pc++) { num += A[pc][t] * sigm(z0[pc][t] + al[t] + be[posOf[pc]]); den += A[pc][t]; }
        if (den > 1e-12) al[t] += logit(wantT[t]) - logit(num / den);
      }
      for (q = 0; q < 3; q++) {
        var num2 = 0, den2 = 0;
        for (pc = 0; pc < 4; pc++) if (posOf[pc] === q) for (t = 0; t < 3; t++) { num2 += A[pc][t] * sigm(z0[pc][t] + al[t] + be[q]); den2 += A[pc][t]; }
        if (den2 > 1e-12) be[q] += logit(wantQ[q]) - logit(num2 / den2);
      }
      for (t = 0; t < 3; t++) al[t] = clip(al[t], -6, 6);
      for (q = 0; q < 3; q++) be[q] = clip(be[q], -6, 6);
    }
    return { al: al, be: be };
  }
  // apply one step (S[0] for side A of m, S[1] for side B) to m; deterministic in (m, S)
  function rtApply(m, S) {
    var p = m.p, cap = p.mlMaxRatio || 4, lc = Math.log(cap), cum = m.retarget.cum, i, k, pc, t;
    function capped(i, key, r) { var c0 = cum[i][key], c1 = clip(c0 * r, 1 / cap, cap); cum[i][key] = c1; return c1 / c0; }
    var e0 = [rtStatic(m, 0), rtStatic(m, 1)];
    for (i = 0; i < 2; i++) {
      var rt = capped(i, "td", S[i].td);
      m.tdD[i] *= rt; m.tdCC[i] *= rt; m.tdCU[i] *= rt;
      m.ctrlT[i] *= capped(i, "ct", S[i].ct);
    }
    var xA = m.ctrlT[0] / Math.max(1e-6, m.ctrlT[0] + m.ctrlT[1]);
    m.pCtl = 0.5 + p.clinchCtrlTemper * (xA - 0.5);
    rtRefitOcc(m);
    var e1 = [rtStatic(m, 0), rtStatic(m, 1)];
    for (i = 0; i < 2; i++) {
      var rd = capped(i, "d", S[i].att[0] * e0[i].pos[0] / Math.max(1e-12, e1[i].pos[0]));
      var rc2 = capped(i, "c", S[i].att[1] * e0[i].pos[1] / Math.max(1e-12, e1[i].pos[1]));
      var rg = capped(i, "g", S[i].att[2] * e0[i].pos[2] / Math.max(1e-12, e1[i].pos[2]));
      m.dRate[i] *= rd; m.cRate[i] *= rc2; m.gRate[i] *= rg; m.gBot[i] *= rg;
      for (k = 0; k < 5; k++) m.gPos[i * 5 + k] *= rg;
    }
    // accuracy: static cells weighted by the realised position attempts; the shift maps the realised margins to the targets
    for (i = 0; i < 2; i++) {
      var st = rtStatic(m, i), mixes = [m.mixD[i], p.clinchMix, p.groundTopMix, p.groundBotMix], posOf = [0, 1, 2, 2];
      var A = [], z0 = [];
      for (pc = 0; pc < 4; pc++) {
        var q = posOf[pc], sc = S[i].realPos[q] / Math.max(1e-12, st.pos[q] * 60);
        A.push([]); z0.push([]);
        for (t = 0; t < 3; t++) { A[pc].push(st.cell[pc] * 60 * sc * mixes[pc][t]); z0[pc].push(Math.log(m.accO[(i * 4 + pc) * 3 + t])); }
      }
      var f0 = rtIpf(A, z0, S[i].realT, S[i].realQ), f1 = rtIpf(A, z0, S[i].tgtT, S[i].tgtQ);
      for (pc = 0; pc < 4; pc++) for (t = 0; t < 3; t++) {
        var ci = pc * 3 + t, sh = S[i].s * ((f1.al[t] - f0.al[t]) + (f1.be[posOf[pc]] - f0.be[posOf[pc]]));
        var c1 = clip(cum[i].acc[ci] + sh, -lc, lc);
        sh = c1 - cum[i].acc[ci]; cum[i].acc[ci] = c1;
        m.accO[(i * 4 + pc) * 3 + t] *= Math.exp(sh);
      }
    }
  }
  function rtCum() { return [{ td: 1, ct: 1, d: 1, c: 1, g: 1, acc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }, { td: 1, ct: 1, d: 1, c: 1, g: 1, acc: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0] }]; }
  function retarget(m, pa, pb, opts) {
    var tg = rtTargets(m, opts);
    if (!tg) { m.retarget = { applied: false, reason: "no targets" }; return m; }
    var p = m.p, r0 = p.retarget || {};
    var rc = { pilot: r0.pilot || 200, iters: r0.iters || 2, damp: r0.damp != null ? +r0.damp : 0.9, kDec: r0.kDec != null ? +r0.kDec : 20,
      kMin: r0.kMin != null ? +r0.kMin : 5, kAcc: r0.kAcc != null ? +r0.kAcc : 5, seed: r0.seed != null ? r0.seed >>> 0 : 20261107 };
    var mlS = function (s) { var x = opts.ml; if (!x || typeof x !== "object") return null; var src = x.pred || x; return src[s] || null; };
    var emS = function (s) { var e = opts.embed; return e && e.etaA ? (s === "A" ? e.etaA : e.etaB) : null; };
    var sigA = rtSig(pa, opts.adjA, mlS("A"), emS("A"), tg.A), sigB = rtSig(pb, opts.adjB, mlS("B"), emS("B"), tg.B);
    var canonAB = sigA <= sigB;
    var ctx = JSON.stringify([m.division, m.rounds, m.title, m.date, m.P, m.p, opts.judges || null, opts.prior_division || null,
      opts.ml === false, m.mlApplied]);
    var key = ctx + "|" + (canonAB ? sigA + "|" + sigB : sigB + "|" + sigA);
    m.retarget = { applied: true, cum: rtCum(), iters: rc.iters, pilot: rc.pilot, fromCache: false, steps: null, nDec: [] };
    var hit = RTC.get(key);
    if (hit) {
      for (var h = 0; h < hit.steps.length; h++) rtApply(m, canonAB ? [hit.steps[h].X, hit.steps[h].Y] : [hit.steps[h].Y, hit.steps[h].X]);
      m.retarget.fromCache = true; m.retarget.steps = hit.steps.length; m.retarget.nDec = hit.nDec.slice();
      return m;
    }
    var m2 = matchup(pb, pa, swapOpts(opts, m));
    m2.retarget = { applied: true, cum: rtCum(), mirror: true };
    var M0 = canonAB ? m : m2, M1 = canonAB ? m2 : m;      // M0: the canonical first fighter X is side A
    var tX = canonAB ? tg.A : tg.B, tY = canonAB ? tg.B : tg.A, R = m.rounds, steps = [], nD = [];
    var seed0 = rc.seed, seed1 = (rc.seed ^ 0x9e3779b9) >>> 0;
    for (var it = 0; it < rc.iters; it++) {
      var s0 = rtPilot(M0, rc.pilot, seed0), s1 = rtPilot(M1, rc.pilot, seed1), cX = new Float64Array(NRT), cY = new Float64Array(NRT);
      for (var k = 0; k < NRT; k++) { cX[k] = s0.sum[k] + s1.sum[NRT + k]; cY[k] = s0.sum[NRT + k] + s1.sum[k]; }
      var n = s0.n + s1.n, stX = rtStep(cX, n, R, tX, rc), stY = rtStep(cY, n, R, tY, rc);
      rtApply(M0, [stX, stY]); rtApply(M1, [stY, stX]);
      steps.push({ X: stX, Y: stY }); nD.push(n);
    }
    if (RTC.size >= RTC_MAX) RTC.delete(RTC.keys().next().value);
    RTC.set(key, { steps: steps, nDec: nD });
    m.retarget.steps = steps.length; m.retarget.nDec = nD;
    return m;
  }
  function retargetCacheClear() { RTC.clear(); }

  // learned stat-line model (data/derived/mlrates.json; tools/mlrates.py). Returns the model handle.
  function loadMLRates(json) {
    var MLR = getML();
    if (!MLR) throw new Error("FightEngine.loadMLRates: src/ml/mlrates.js (MLRates) is not loaded");
    if (json == null) { MLMODEL = null; return null; }
    MLMODEL = json && json.targets && json.stack && json.raw ? json : MLR.load(json);
    return MLMODEL;
  }
  function mlModel() { return MLMODEL; }

  // ------------------------------------------------------------------ RNG (v2's xoshiro-style generator)
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

  // ------------------------------------------------------------------ names and details
  var SUBN = {
    back: [["Rear Naked Choke", 0.86], ["Neck Crank", 0.06], ["Arm Triangle", 0.04], ["Armbar", 0.04]],
    mount: [["Arm Triangle", 0.45], ["Armbar", 0.35], ["Americana", 0.1], ["Rear Naked Choke", 0.1]],
    side: [["Arm Triangle", 0.45], ["Kimura", 0.25], ["D'Arce Choke", 0.15], ["Armbar", 0.15]],
    half: [["Arm Triangle", 0.35], ["D'Arce Choke", 0.25], ["Kimura", 0.2], ["Anaconda Choke", 0.2]],
    guard: [["Kimura", 0.3], ["Arm Triangle", 0.2], ["D'Arce Choke", 0.2], ["Guillotine Choke", 0.15], ["Neck Crank", 0.15]],
    bottom: [["Guillotine Choke", 0.38], ["Triangle Choke", 0.24], ["Armbar", 0.22], ["Kimura", 0.08], ["Heel Hook", 0.08]],
    stand: [["Guillotine Choke", 0.8], ["D'Arce Choke", 0.1], ["Anaconda Choke", 0.1]]
  };
  function pickName(list, u) { var acc = 0; for (var i = 0; i < list.length; i++) { acc += list[i][1]; if (u < acc) return list[i][0]; } return list[list.length - 1][0]; }
  var GNPPOS = ["From Guard", "From Half Guard", "From Side Control", "From Mount", "From Back Control"];

  function koDetail(how, tg, pc, pos, u) {
    if (how === "LEG") return "Kick to Leg At Distance";
    if (how === "GNP") return (u < 0.8 ? "Punches" : "Elbows") + " to Head " + GNPPOS[pos];
    var where = pc === 1 ? "In Clinch" : "At Distance";
    if (tg === 1) return (pc === 1 ? "Knee" : (u < 0.5 ? "Kick" : "Punch")) + " to Body " + where;
    if (how === "TKO") return (pc === 1 ? (u < 0.5 ? "Knees" : "Punches") : "Punches") + " to Head " + where;
    if (pc === 1) return (u < 0.45 ? "Knee" : (u < 0.75 ? "Elbow" : "Punch")) + " to Head " + where;
    return (u < 0.88 ? "Punch" : (u < 0.97 ? "Kick" : "Knee")) + " to Head " + where;
  }

  function evObj(t, k, w, s, pos, down, D, G, S) {
    var e = { t: +t.toFixed(2), k: k, w: w, s: s };
    if (s >= 2) e.pos = down ? "down" : POSN[pos];
    e.dA = +D[0].toFixed(1); e.dB = +D[1].toFixed(1); e.gA = +G[0].toFixed(1); e.gB = +G[1].toFixed(1);
    e.sA = +S[0].toFixed(3); e.sB = +S[1].toFixed(3);
    return e;
  }
  function statObj(st, i) { var o = {}; for (var k = 0; k < NS; k++) o[STK[k]] = st[i * NS + k]; o.ctrl = +o.ctrl.toFixed(1); o.dmg = +o.dmg.toFixed(2); return o; }

  // ------------------------------------------------------------------ judges (one round)
  // Each judge j scores z_j = tS_j * striking + tG_j * grappling + tP_j * damage + shared + individual noise (logits; A
  // minus B differentials; the shared noise has a fight-level part sF, variance share sharedFight, drawn once per fight:
  // the panel's view beyond the counts persists from round to round), with the EM round-winner weights fit on 7,550 ufcstats cards (research/data_baserates.md):
  // striking = head * dHead + body * dBody + leg * dLeg landed; grappling = td * dTD + ctrlMin * dCtrl / 60 + sub * dSubAtt;
  // damage = kd * dKD + hurt * dHurt + judgePower * head * dPow (engine-only: hurts and power beyond the strike count).
  // The round goes to sign(z_j); a 10-8 when |z_j| > t108 - t108kd * min(2, winner's KD edge). The shared and individual
  // sds, the fight-level share, the tastes and the 10-8 thresholds are fit to the 2019-2023 judges' rounds
  // (tools/judgecal.js). Draw order: one shared normal, then one normal per judge. Adds the scores to cards and returns the number of 10-8s; js (optional)
  // receives [A, B] per judge.
  function judgeRound(J, jp, dHL, dBL, dLL, dKd, dTd, dCtrl, dSub, dHu, dPow, tS, tG, tP, sF, rng, cards, js) {
    var dStr = J.head * dHL + J.body * dBL + J.leg * dLL;
    var dGr = J.td * dTd + J.ctrlMin * dCtrl / 60 + J.sub * dSub;
    var dDm = J.kd * dKd + J.hurt * dHu + jp * J.head * dPow;
    var rho = J.sharedFight || 0;
    var shared = (sF || 0) + J.sharedSd * Math.sqrt(1 - rho) * rng.normal(), n108 = 0, kc = J.t108kd || 0;
    for (var j = 0; j < 3; j++) {
      var z = dStr * tS[j] + dGr * tG[j] + dDm * tP[j] + shared + J.indSd * rng.normal();
      var aw = z > 0, mg = aw ? z : -z, kdE = aw ? dKd : -dKd;
      var big = mg > J.t108 - kc * (kdE <= 0 ? 0 : (kdE >= 2 ? 2 : kdE));
      var scA = aw ? 10 : (big ? 8 : 9), scB = aw ? (big ? 8 : 9) : 10;
      if (big) n108++;
      cards[j][0] += scA; cards[j][1] += scB;
      if (js) js.push([scA, scB]);
    }
    return n108;
  }

  // ------------------------------------------------------------------ simulate one fight
  function simulate(m, rng, trace) {
    var p = m.p, K = m.k, F = p.form, J = p.judge, nR = m.rounds, i, j, k;
    var dRate = m.dRate, cRate = m.cRate, tdD = m.tdD, tdCC = m.tdCC, tdCU = m.tdCU, gPos = m.gPos, gBot = m.gBot, gEdge = m.gEdge;
    var swPos = m.swPos, upPos = m.upPos, subTPos = m.subTPos, subBPos = m.subBPos, subOPos = m.subOPos, subO = m.subO, gillo = m.gillo;
    var clE = m.clE, pCtl = m.pCtl, clBreak = m.clBreak, clSwap = m.clSwap, subBotO = m.subBotO, subStandO = m.subStandO;
    // fight-night form (fixed draw order, independent of trace)
    // every multiplicative draw is a mean-1 lognormal: exp(sd * z - sd^2 / 2)
    var sharedPace = lnorm(rng, F.pace);
    var vol = lnorm(rng, F.vol);                 // shared fight volatility: a war vs a tactical fight
    var fOut = [1, 1], fAcc = [1, 1], fPow = [1, 1], fChin = [1, 1], fCard = [1, 1], fGrap = [1, 1], fSubO = [1, 1], fSubD = [1, 1];
    for (i = 0; i < 2; i++) {
      fOut[i] = lnorm(rng, F.out); fAcc[i] = Math.exp(F.acc * rng.normal());   // accuracy: logit-normal (odds multiplier)
      fPow[i] = lnorm(rng, F.pow); fChin[i] = lnorm(rng, F.chin);
      fCard[i] = lnorm(rng, F.cardio); fGrap[i] = lnorm(rng, F.grap);
      fSubO[i] = lnorm(rng, F.sub); fSubD[i] = lnorm(rng, F.sub);
    }
    var subK = [fSubO[0] * fSubD[1], fSubO[1] * fSubD[0]], subKs = [Math.sqrt(subK[0]), Math.sqrt(subK[1])];
    var tS = [1, 1, 1], tG = [1, 1, 1], tP = [1, 1, 1];
    for (j = 0; j < 3; j++) { tS[j] = lnorm(rng, J.tasteSd); tG[j] = lnorm(rng, J.tasteSd); tP[j] = lnorm(rng, J.tasteSd); }
    var jF = J.sharedSd * Math.sqrt(J.sharedFight || 0) * rng.normal();   // judges' fight-level shared view (always drawn: fixed draw order)
    var spD = null;
    if (m.spread) {
      // v8 components.tdIntent / ctrlSpread: per fighter, mean-1 lognormal takedown intent and top-stint length, from an auxiliary
      // generator seeded by this fight's own form draws (the main stream is untouched; off: none of this runs)
      var spr = m.spread, ar = makeRng(auxSeed(sharedPace, vol, fOut[0], fOut[1], fAcc[0]));
      var tdM = [lnorm(ar, spr.td), lnorm(ar, spr.td)], ctM = [lnorm(ar, spr.ctrl), lnorm(ar, spr.ctrl)];
      tdD = [m.tdD[0] * tdM[0], m.tdD[1] * tdM[1]]; tdCC = [m.tdCC[0] * tdM[0], m.tdCC[1] * tdM[1]]; tdCU = [m.tdCU[0] * tdM[0], m.tdCU[1] * tdM[1]];
      upPos = new Float64Array(m.upPos); swPos = new Float64Array(m.swPos);
      for (k = 0; k < 5; k++) { upPos[k] /= ctM[0]; swPos[k] /= ctM[0]; upPos[5 + k] /= ctM[1]; swPos[5 + k] /= ctM[1]; }   // index top * 5 + pos
      spD = { tdA: tdM[0], tdB: tdM[1], ctrlA: ctM[0], ctrlB: ctM[1] };
    }
    var kdB = [m.kd[0] * fPow[0] * fChin[1] * vol, m.kd[1] * fPow[1] * fChin[0] * vol];
    var dw = [m.dw[0] * Math.pow(fPow[0], K.powDmgExp), m.dw[1] * Math.pow(fPow[1], K.powDmgExp)];
    var pcF = [Math.sqrt(fPow[0] * fChin[1] * vol), Math.sqrt(fPow[1] * fChin[0] * vol)];
    var gnpB = [m.gnp[0] * pcF[0], m.gnp[1] * pcF[1]], stkoB = [m.stko[0] * pcF[0], m.stko[1] * pcF[1]];
    var drain = [m.drain[0] * fCard[0], m.drain[1] * fCard[1]];
    var gR = [fGrap[0] / fGrap[1], fGrap[1] / fGrap[0]];
    var gRs = [Math.sqrt(gR[0]), Math.sqrt(gR[1])];
    var tdO = [m.tdO[0] * gR[0], m.tdO[1] * gR[1]], tdOC = [m.tdOC[0] * gR[0], m.tdOC[1] * gR[1]];
    var instO = m.instO, refO = m.refO;
    var kdGnpO = odds(K.kdGnpAcc);
    var mixC = m.mixC, accO = m.accO, pass = K.pass, retain = K.retain;
    var dmgPos = K.dmgPos, kdPos = K.kdPos, gnpTkoPos = K.gnpTkoPos, drainPos = K.drainPos;
    var legScale = K.legDmgScale, legFloor = K.legMobFloor;

    var D = [0, 0], G = [0, 0], S = [1, 1], hurtEnd = [-1, -1], kdN = [0, 0], chinM = [1, 1];
    var st = new Float64Array(2 * NS), tot = new Float64Array(2 * NS);
    var evR = new Float64Array(24), evT = new Int8Array(24), evW = new Int8Array(24), evX = new Int8Array(24);
    var cards = [[0, 0], [0, 0], [0, 0]], n108 = 0, kdr = 0, kdrf = 0;
    var rounds = trace ? [] : null;
    var fight = { winner: "D", method: "DRAW", detail: "", round: nR, t: 300, cards: cards, totals: null,
      form: { A: { out: fOut[0], acc: fAcc[0], pow: fPow[0], chin: 1 / fChin[0], cardio: 1 / fCard[0], grap: fGrap[0], subOff: fSubO[0], subDef: 1 / fSubD[0] },
              B: { out: fOut[1], acc: fAcc[1], pow: fPow[1], chin: 1 / fChin[1], cardio: 1 / fCard[1], grap: fGrap[1], subOff: fSubO[1], subDef: 1 / fSubD[1] } },
      rounds: rounds, fin: null, n108: 0, kdr: 0, kdrf: 0, pace: sharedPace, vol: vol };
    if (spD) fight.spread = spD;
    var po = [0, 0], fin = null;

    for (var r = 0; r < nR; r++) {
      for (k = 0; k < 2 * NS; k++) st[k] = 0;
      var t = 0, state = 0, ctl = -1, pos = 0, downed = -1, kdLoc = 0;
      var ev = trace ? [] : null;
      var rp = sharedPace * lnorm(rng, F.roundPace);
      po[0] = m.pace[0][r] * fOut[0] * rp * lnorm(rng, F.roundOut);
      po[1] = m.pace[1][r] * fOut[1] * rp * lnorm(rng, F.roundOut);
      var fr = m.finR[r], kdP = m.kdPace[r] * fr;

      while (true) {
        var h0 = t < hurtEnd[0], h1 = t < hurtEnd[1];
        var mob0 = 1 - G[0] / legScale; if (mob0 < legFloor) mob0 = legFloor;
        var mob1 = 1 - G[1] / legScale; if (mob1 < legFloor) mob1 = legFloor;
        var out0 = po[0] * (1 - K.outStam * (1 - S[0])) * (h0 ? K.outHurt : 1) * (1 - K.outMob * (1 - mob0));
        var out1 = po[1] * (1 - K.outStam * (1 - S[1])) * (h1 ? K.outHurt : 1) * (1 - K.outMob * (1 - mob1));
        var n = 0, top = -1, bot = -1, k5 = 0;
        if (state === 0) {
          evT[n] = E_STRIKE; evW[n] = 0; evX[n] = 0; evR[n++] = dRate[0] * out0;
          evT[n] = E_STRIKE; evW[n] = 1; evX[n] = 0; evR[n++] = dRate[1] * out1;
          evT[n] = E_CLINCH; evW[n] = 0; evX[n] = 0; evR[n++] = clE * pCtl;
          evT[n] = E_CLINCH; evW[n] = 1; evX[n] = 0; evR[n++] = clE * (1 - pCtl);
          evT[n] = E_TD; evW[n] = 0; evX[n] = 0; evR[n++] = tdD[0] * (1 - K.tdAttStam * (1 - S[0])) * (h0 ? 0.5 : 1);
          evT[n] = E_TD; evW[n] = 1; evX[n] = 0; evR[n++] = tdD[1] * (1 - K.tdAttStam * (1 - S[1])) * (h1 ? 0.5 : 1);
        } else if (state === 1) {
          var cs = K.clinchCtrlStrike;
          evT[n] = E_STRIKE; evW[n] = 0; evX[n] = 1; evR[n++] = cRate[0] * out0 * (ctl === 0 ? cs : 2 - cs);
          evT[n] = E_STRIKE; evW[n] = 1; evX[n] = 1; evR[n++] = cRate[1] * out1 * (ctl === 1 ? cs : 2 - cs);
          evT[n] = E_BREAK; evW[n] = 1 - ctl; evX[n] = 0; evR[n++] = clBreak;
          evT[n] = E_SWAP; evW[n] = 1 - ctl; evX[n] = 0; evR[n++] = clSwap * 2 * (ctl === 0 ? 1 - pCtl : pCtl);
          evT[n] = E_TD; evW[n] = ctl; evX[n] = 1; evR[n++] = tdCC[ctl] * (1 - K.tdAttStam * (1 - S[ctl]));
          evT[n] = E_TD; evW[n] = 1 - ctl; evX[n] = 1; evR[n++] = tdCU[1 - ctl] * (1 - K.tdAttStam * (1 - S[1 - ctl]));
        } else {
          top = state - 2; bot = 1 - top; k5 = top * 5 + pos;
          if (downed === bot) {
            evT[n] = E_STRIKE; evW[n] = top; evX[n] = 2; evR[n++] = K.kdGnpRate;
            evT[n] = E_RECOVER; evW[n] = bot; evX[n] = 0; evR[n++] = K.kdRecover;
          } else {
            var gTop = gR[top], hb = bot === 0 ? h0 : h1;
            evT[n] = E_STRIKE; evW[n] = top; evX[n] = 2; evR[n++] = gPos[k5] * (top === 0 ? out0 : out1);
            evT[n] = E_STRIKE; evW[n] = bot; evX[n] = 3; evR[n++] = gBot[bot] * (bot === 0 ? out0 : out1);
            var prow = pass[pos], rrow = retain[pos];
            for (var to = pos + 1; to < 5; to++) if (prow[to] > 0) { evT[n] = E_PASS; evW[n] = top; evX[n] = to; evR[n++] = prow[to] * gEdge[top] * gTop; }
            for (to = 0; to < pos; to++) if (rrow[to] > 0) { evT[n] = E_ESC; evW[n] = bot; evX[n] = to; evR[n++] = rrow[to] / (gEdge[top] * gTop); }
            evT[n] = E_SWEEP; evW[n] = bot; evX[n] = 0; evR[n++] = swPos[k5] / gTop;
            evT[n] = E_UP; evW[n] = bot; evX[n] = 0; evR[n++] = upPos[k5] / gTop * (1 - K.standStam * (1 - S[bot])) * (hb ? 0.5 : 1);
            evT[n] = E_SUB; evW[n] = top; evX[n] = 2; evR[n++] = subTPos[k5] * gRs[top] * subKs[top];
            evT[n] = E_SUB; evW[n] = bot; evX[n] = 3; evR[n++] = subBPos[k5] * gRs[bot] * subKs[bot];
            evT[n] = E_RESET; evW[n] = -1; evX[n] = 0; evR[n++] = K.groundReset;
          }
        }
        var Rs = 0; for (k = 0; k < n; k++) Rs += evR[k];
        var dt = rng.expo() / Rs;
        var horizon = 300;
        if (hurtEnd[0] > t && hurtEnd[0] < horizon) horizon = hurtEnd[0];
        if (hurtEnd[1] > t && hurtEnd[1] < horizon) horizon = hurtEnd[1];
        var adv = t + dt < horizon ? dt : horizon - t;
        // stamina and control accrue over the interval
        var pc0 = state === 0 ? 0 : (state === 1 ? 1 : (state === 2 ? 2 : 3)), pc1 = state === 0 ? 0 : (state === 1 ? 1 : (state === 3 ? 2 : 3));
        S[0] -= drain[0] * adv * drainPos[pc0] * (0.6 + 0.4 * po[0]);
        S[1] -= drain[1] * adv * drainPos[pc1] * (0.6 + 0.4 * po[1]);
        if (S[0] < 0.05) S[0] = 0.05; if (S[1] < 0.05) S[1] = 0.05;
        if (state === 1) st[ctl * NS + I_CTRL] += adv; else if (state >= 2) st[top * NS + I_CTRL] += adv;
        if (t + dt >= horizon) { t = horizon; if (t >= 300) break; continue; }
        t += dt;
        var uu = rng.u() * Rs, e = 0;
        while (e < n - 1 && uu >= evR[e]) { uu -= evR[e]; e++; }
        var et = evT[e], w = evW[e], x = evX[e];

        if (et === E_STRIKE) {
          i = w; j = 1 - i;
          var pc = x, so = i * NS, hj = j === 0 ? h0 : h1, mobj = j === 0 ? mob0 : mob1, mobi = i === 0 ? mob0 : mob1;
          var follow = pc === 2 && downed === j;
          var ut = rng.u(), tg, o;
          if (follow) { tg = ut < 0.92 ? 0 : 1; o = kdGnpO; }
          else {
            var mb = (i * 4 + pc) * 2;
            tg = ut < mixC[mb] ? 0 : (ut < mixC[mb + 1] ? 1 : 2);
            o = accO[(i * 4 + pc) * 3 + tg] * fAcc[i] * (1 - K.accSelfStam * (1 - S[i])) * (hj ? K.accHurt : 1) * (1 + K.accStam * (1 - S[j]));
            if (pc === 0) o *= 1 + K.accMob * (1 - mobj);
          }
          st[so + I_SA]++; st[so + I_HA + 2 * tg]++; S[i] -= K.drainAtt;
          st[so + (pc === 0 ? I_DA : (pc === 1 ? I_CA : I_GA))]++;
          if (rng.u() >= o / (1 + o)) {
            if (trace) { var em = evObj(t, "miss", SIDE[i], state, pos, downed >= 0, D, G, S); em.tg = tg; em.loc = LOCN[pc]; ev.push(em); }
            continue;
          }
          st[so + I_SL]++; st[so + I_HL + 2 * tg]++;
          st[so + (pc === 0 ? I_DL : (pc === 1 ? I_CL : I_GL))]++;
          var kind = "hit", finHow = null;
          if (tg === 0) {
            D[j] += dw[i] * dmgPos[pc]; st[so + I_DMG] += dw[i];
            if (pc <= 1) {
              st[so + I_SHL]++;
              var pk = kdB[i] * kdPos[pc] * chinM[j] * (1 + D[j] / K.kdDmg) * (hj ? K.kdHurt : 1) * (1 + K.kdStamDef * (1 - S[j])) *
                Math.max(0.05, 1 - K.kdStamAtt * (1 - S[i])) * kdP * (0.75 + 0.25 * mobi);
              var uk = rng.u();
              if (uk < pk) kind = "kd";
              else if (uk < pk * (1 + K.hurtRatio)) kind = "hurt";
              else if (hj) { if (rng.u() < stkoB[i] * chinM[j] * (K.stkoBase + D[j] / 100)) { kind = "fin"; finHow = "TKO"; } }
            } else if (pc === 2) {
              if (follow) {
                var ro = refO * chinM[j] * (1 + D[j] / K.refDmg) * Math.max(0.05, 1 - K.finStamAtt * (1 - S[i]));
                if (rng.u() < ro / (1 + ro)) { kind = "fin"; finHow = "TKO"; }
              } else if (rng.u() < gnpB[i] * gnpTkoPos[pos] * (1 + D[j] / K.gnpDmg) * (hj ? K.gnpHurt : 1) * chinM[j] * fr * Math.max(0.05, 1 - K.finStamAtt * (1 - S[i]))) { kind = "fin"; finHow = "GNP"; }
            }
          } else if (tg === 1) {
            S[j] -= K.bodyDrain * dw[i]; if (S[j] < 0.05) S[j] = 0.05;
            if (pc <= 1) {
              st[so + I_SBL]++;
              if (rng.u() < kdB[i] * K.kdBodyRatio * kdPos[pc] * (1 + K.kdStamDef * (1 - S[j])) * kdP) kind = "kd";
            }
          } else {
            G[j] += dw[i];
            if (pc <= 1) st[so + I_SLL]++;
            if (pc === 0 && G[j] > K.legTko0 && rng.u() < K.legTko * (G[j] - K.legTko0) / 10) { kind = "fin"; finHow = "LEG"; }
          }
          if (kind === "kd") {
            st[so + I_KD]++; kdN[j]++; D[j] += K.dmgKD; chinM[j] *= K.kdRepeat;
            var io = instO * (1 + D[j] / K.kdInstantDmg) * (1 - K.instStam * (1 - S[i]));
            if (rng.u() < io / (1 + io)) { kind = "fin"; finHow = "KO"; }
          }
          if (kind === "fin") {
            var locFin = follow ? kdLoc : pc;
            var du = rng.u();
            fin = { by: SIDE[i], how: finHow, t: t, loc: LOCN[locFin], tg: tg, pos: state >= 2 ? (follow ? "down" : POSN[pos]) : null, follow: follow,
              detail: koDetail(finHow === "TKO" && follow ? "TKO" : finHow, tg, locFin === 1 ? 1 : (locFin === 0 ? 0 : 2), pos, du) };
            if (trace) { var ef = evObj(t, "fin", SIDE[i], state, pos, downed >= 0, D, G, S); ef.tg = tg; ef.loc = LOCN[pc]; ef.how = finHow; ev.push(ef); }
            break;
          }
          if (kind === "kd") {
            hurtEnd[j] = Math.max(hurtEnd[j], t + K.hurtKdSecs);
            var preState = state;
            if (rng.u() < K.kdPounce * (0.7 + 0.3 * S[i])) { state = 2 + i; pos = 1; downed = j; kdLoc = pc; ctl = i; }
            else { state = 0; ctl = -1; downed = -1; }
            if (trace) {
              var ek = evObj(t, "kd", SIDE[i], preState, pos, false, D, G, S); ek.tg = tg; ek.loc = LOCN[pc]; ek.to = state; ev.push(ek);
              if (preState !== 0 && state === 0) ev.push(evObj(t, "reset", "", 0, 0, false, D, G, S));
            }
          } else {
            if (kind === "hurt") { st[so + I_HURT]++; D[j] += K.dmgHurt; hurtEnd[j] = Math.max(hurtEnd[j], t + K.hurtSecs); }
            if (trace) { var eh = evObj(t, kind, SIDE[i], state, pos, downed >= 0, D, G, S); eh.tg = tg; eh.loc = LOCN[pc]; ev.push(eh); }
          }
        } else if (et === E_CLINCH) {
          state = 1; ctl = w;
          if (trace) { var ec = evObj(t, "clinch", SIDE[w], 1, 0, false, D, G, S); ec.loc = "clinch"; ev.push(ec); }
        } else if (et === E_SWAP) {
          ctl = w;
          if (trace) { var es = evObj(t, "clinch", SIDE[w], 1, 0, false, D, G, S); es.loc = "clinch"; es.swap = true; ev.push(es); }
        } else if (et === E_BREAK) {
          state = 0; ctl = -1;
          if (trace) ev.push(evObj(t, "break", SIDE[w], 0, 0, false, D, G, S));
        } else if (et === E_TD) {
          i = w; j = 1 - i;
          st[i * NS + I_TDA]++; S[i] -= K.drainTd; if (S[i] < 0.05) S[i] = 0.05;
          var hj2 = j === 0 ? h0 : h1;
          var ot = (x === 0 ? tdO[i] : tdOC[i] * (ctl === i ? 1 : 0.8)) * (1 + K.tdStam * (1 - S[j])) * (hj2 ? 1.5 : 1);
          var fromState = state;
          if (rng.u() < ot / (1 + ot)) {
            st[i * NS + I_TDL]++;
            var ul = rng.u(), tl = K.tdLand, acc = 0; pos = 4;
            for (k = 0; k < 5; k++) { acc += tl[k]; if (ul < acc) { pos = k; break; } }
            state = 2 + i; ctl = i; downed = -1;
            if (trace) { var et1 = evObj(t, "td", SIDE[i], state, pos, false, D, G, S); et1.loc = LOCN[x]; et1.from = fromState; ev.push(et1); }
          } else {
            if (trace) { var et2 = evObj(t, "tdx", SIDE[i], state, pos, false, D, G, S); et2.loc = LOCN[x]; ev.push(et2); }
            if (rng.u() < gillo[j] * subKs[j]) {
              // standing guillotine on the stuffed shot
              st[j * NS + I_SUB]++;
              var gname = pickName(SUBN.stand, rng.u());
              var og = subO[j] * subStandO * gRs[j] * subK[j] * (1 + K.subStam * (1 - S[i]));
              if (rng.u() < og / (1 + og)) {
                fin = { by: SIDE[j], how: "SUB", t: t, loc: LOCN[x], name: gname, detail: gname, pos: null };
                if (trace) { var eg = evObj(t, "sub", SIDE[j], state, pos, false, D, G, S); eg.name = gname; eg.loc = LOCN[x]; ev.push(eg); }
                break;
              }
              if (trace) { var eg2 = evObj(t, "subx", SIDE[j], state, pos, false, D, G, S); eg2.name = gname; eg2.loc = LOCN[x]; ev.push(eg2); }
            } else if (x === 0 && rng.u() < K.failTdClinch) {
              state = 1; ctl = i;
              if (trace) { var ec2 = evObj(t, "clinch", SIDE[i], 1, 0, false, D, G, S); ec2.loc = "clinch"; ev.push(ec2); }
            }
          }
        } else if (et === E_PASS) {
          pos = x; st[w * NS + I_PASS]++;
          if (trace) { var ep = evObj(t, "pass", SIDE[w], state, pos, false, D, G, S); ep.loc = "ground"; ev.push(ep); }
        } else if (et === E_ESC) {
          pos = x;
          if (trace) { var ee = evObj(t, "esc", SIDE[w], state, pos, false, D, G, S); ee.loc = "ground"; ev.push(ee); }
        } else if (et === E_SWEEP) {
          st[w * NS + I_REV]++; state = 2 + w; ctl = w; pos = rng.u() < 0.6 ? 0 : 1;
          if (trace) { var ew = evObj(t, "sweep", SIDE[w], state, pos, false, D, G, S); ew.loc = "ground"; ev.push(ew); }
        } else if (et === E_UP) {
          st[w * NS + I_UP]++;
          if (rng.u() < K.standClinch) { state = 1; ctl = 1 - w; } else { state = 0; ctl = -1; }
          if (trace) ev.push(evObj(t, "up", SIDE[w], state, 0, false, D, G, S));
        } else if (et === E_SUB) {
          i = w; j = 1 - i;
          st[i * NS + I_SUB]++;
          var fromTop = x === 2, hj3 = j === 0 ? h0 : h1;
          var sname = pickName(fromTop ? SUBN[POSN[pos]] : SUBN.bottom, rng.u());
          var os = subO[i] * (fromTop ? subOPos[top * 5 + pos] : subBotO) * gRs[i] * subK[i] * (1 + K.subStam * (1 - S[j])) * (hj3 ? K.subHurt : 1) * fr * Math.max(0.05, 1 - K.finStamAtt * (1 - S[i]));
          if (rng.u() < os / (1 + os)) {
            fin = { by: SIDE[i], how: "SUB", t: t, loc: "ground", name: sname, detail: sname, pos: POSN[pos] + (fromTop ? "" : " (bottom)") };
            if (trace) { var eu = evObj(t, "sub", SIDE[i], state, pos, false, D, G, S); eu.name = sname; eu.loc = "ground"; ev.push(eu); }
            break;
          }
          var uf = rng.u();
          if (trace) { var ex = evObj(t, "subx", SIDE[i], state, pos, false, D, G, S); ex.name = sname; ex.loc = "ground"; ev.push(ex); }
          if (fromTop) { if (uf < K.subFailLose) pos = pos >= 3 ? 1 : 0; }
          else if (uf < 0.15 && pos < 2) pos = pos + 1;
        } else if (et === E_RECOVER) {
          downed = -1;
          if (rng.u() < K.kdRecoverStand) { state = 0; ctl = -1; } else { pos = 0; }
          if (trace) ev.push(evObj(t, "recover", SIDE[w], state, pos, false, D, G, S));
        } else if (et === E_RESET) {
          state = 0; ctl = -1; downed = -1;
          if (trace) ev.push(evObj(t, "reset", "", 0, 0, false, D, G, S));
        }
      }

      for (k = 0; k < 2 * NS; k++) tot[k] += st[k];
      for (i = 0; i < 2; i++) if (st[i * NS + I_KD] > 0 && st[(1 - i) * NS + I_KD] === 0) { kdr++; if (fin && fin.by === SIDE[i] && fin.how !== "SUB") kdrf++; }
      fight.kdr = kdr; fight.kdrf = kdrf;
      var rec = null;
      if (trace) {
        var sA = statObj(st, 0), sB = statObj(st, 1);
        var stv = { A: sA, B: sB,
          hA: sA.sh_lnd, bA: sA.sb_lnd, lA: sA.sl_lnd, gA: sA.g_lnd, kdA: sA.kd, rkA: sA.hurt, tdA: sA.td_lnd, tdaA: sA.td_att, ctrlA: sA.ctrl, subA: sA.sub_att,
          hB: sB.sh_lnd, bB: sB.sb_lnd, lB: sB.sl_lnd, gB: sB.g_lnd, kdB: sB.kd, rkB: sB.hurt, tdB: sB.td_lnd, tdaB: sB.td_att, ctrlB: sB.ctrl, subB: sB.sub_att };
        rec = { r: r, ev: ev, st: stv, judges: null, fin: fin, stoppage: null,
          endState: { s: state, pos: state >= 2 ? POSN[pos] : null, dA: +D[0].toFixed(1), dB: +D[1].toFixed(1), gA: +G[0].toFixed(1), gB: +G[1].toFixed(1), sA: +S[0].toFixed(3), sB: +S[1].toFixed(3) },
          dHA: +D[0].toFixed(1), dHB: +D[1].toFixed(1), dLA: +G[0].toFixed(1), dLB: +G[1].toFixed(1), SA: +S[0].toFixed(3), SB: +S[1].toFixed(3) };
        rounds.push(rec);
      }
      if (fin) {
        fight.winner = fin.by; fight.method = fin.how; fight.detail = fin.detail; fight.round = r + 1; fight.t = fin.t; fight.fin = fin;
        fight.totals = { A: statObj(tot, 0), B: statObj(tot, 1) };
        return fight;
      }

      // ---- judges: EM round-winner weights (data fit), shared + individual noise, fight-level tastes, margin 10-8 rule
      var a0 = 0, b0 = NS;
      var js = trace ? [] : null;
      n108 += judgeRound(J, m.judgePower, st[a0 + I_HL] - st[b0 + I_HL], st[a0 + I_BL] - st[b0 + I_BL], st[a0 + I_LL] - st[b0 + I_LL],
        st[a0 + I_KD] - st[b0 + I_KD], st[a0 + I_TDL] - st[b0 + I_TDL], st[a0 + I_CTRL] - st[b0 + I_CTRL], st[a0 + I_SUB] - st[b0 + I_SUB],
        st[a0 + I_HURT] - st[b0 + I_HURT], (st[a0 + I_DMG] - st[a0 + I_HL]) - (st[b0 + I_DMG] - st[b0 + I_HL]), tS, tG, tP, jF, rng, cards, js);
      if (trace) rec.judges = js;

      // ---- between rounds: recovery, doctor and corner stoppages
      if (r < nR - 1) {
        for (i = 0; i < 2; i++) { S[i] += K.recover * (1 - S[i]); D[i] *= 1 - K.dmgHeal; hurtEnd[i] = -1; }
        var stop = [false, false], kindS = ["", ""];
        for (i = 0; i < 2; i++) {
          var pd = Math.min(K.docCap, K.doc * (D[i] / 100) * (D[i] / 100));
          var pcn = K.corner * Math.max(0, kdN[i] - 1) + K.corner * Math.pow(D[i] / 120, 3);
          var us = rng.u();
          if (us < pd) { stop[i] = true; kindS[i] = "DOC"; } else if (us < pd + pcn) { stop[i] = true; kindS[i] = "CORNER"; }
        }
        var ut2 = rng.u();
        if (stop[0] || stop[1]) {
          var loser = (stop[0] && stop[1]) ? (ut2 < 0.5 ? 0 : 1) : (stop[0] ? 0 : 1);
          var wn = SIDE[1 - loser];
          if (trace) rec.stoppage = wn;
          fight.winner = wn; fight.method = kindS[loser]; fight.detail = kindS[loser] === "DOC" ? "Doctor's Stoppage" : "Corner Stoppage";
          fight.round = r + 1; fight.t = 300; fight.fin = { by: wn, how: kindS[loser], t: 300, loc: "between rounds", detail: fight.detail };
          fight.n108 = n108; fight.totals = { A: statObj(tot, 0), B: statObj(tot, 1) };
          return fight;
        }
      }
    }
    // ---- decision
    var ja = 0, jb = 0;
    for (var q = 0; q < 3; q++) { if (cards[q][0] > cards[q][1]) ja++; else if (cards[q][1] > cards[q][0]) jb++; }
    var dr = 3 - ja - jb;
    if (ja >= 2) { fight.winner = "A"; fight.method = ja === 3 ? "UD" : (jb === 1 ? "SD" : "MD"); }
    else if (jb >= 2) { fight.winner = "B"; fight.method = jb === 3 ? "UD" : (ja === 1 ? "SD" : "MD"); }
    else { fight.winner = "D"; fight.method = "DRAW"; }
    var cardTxt = cards.map(function (c) { return c[0] + "-" + c[1]; }).join(", ");
    fight.detail = fight.winner === "D" ? ((dr === 3 ? "Unanimous" : (dr === 2 ? "Majority" : "Split")) + " Draw (" + cardTxt + ")")
      : ({ UD: "Unanimous", SD: "Split", MD: "Majority" }[fight.method] + " Decision (" + cardTxt + ")");
    fight.round = nR; fight.t = 300; fight.n108 = n108;
    fight.totals = { A: statObj(tot, 0), B: statObj(tot, 1) };
    return fight;
  }

  // Outcome buckets: 0..6 = A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO (KO/TKO includes GNP, LEG, CORNER, DOC)
  function bucket(f) {
    if (f.winner === "D") return 3;
    var k = f.method === "SUB" ? 1 : ((f.method === "UD" || f.method === "SD" || f.method === "MD") ? 2 : 0);
    return f.winner === "A" ? k : 6 - k;
  }
  function isDecision(f) { return f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW"; }

  // ------------------------------------------------------------------ Monte Carlo summary
  function summarize(m, N, seed, onProgress) {
    var rng = makeRng(seed == null ? 1 : seed), nR = m.rounds, i, k;
    var bins = [0, 0, 0, 0, 0, 0, 0], finA = [], finB = [], finKO = [], finSUB = [];
    for (k = 0; k < nR; k++) { finA.push(0); finB.push(0); finKO.push(0); finSUB.push(0); }
    var methods = {}, dist = 0, distA = 0, distB = 0, dec = { UD: 0, SD: 0, MD: 0, DRAW: 0 }, n108 = 0, rndsJudged = 0, secs = 0;
    var sumA = new Float64Array(NS), sumB = new Float64Array(NS);
    var koLoc = { dist: 0, clinch: 0, ground: 0, "between rounds": 0 }, subNames = {}, koKind = { KO: 0, TKO_followup: 0, TKO_standing: 0, GNP: 0, LEG: 0, DOC: 0, CORNER: 0 }, kdr = 0, kdrf = 0;
    var chunk = Math.max(1, Math.floor(N / 50));
    for (i = 0; i < N; i++) {
      var f = simulate(m, rng, false), b = bucket(f);
      bins[b]++;
      var key = f.winner + ":" + f.method; methods[key] = (methods[key] || 0) + 1;
      var TA = f.totals.A, TB = f.totals.B;
      for (k = 0; k < NS; k++) { sumA[k] += TA[STK[k]]; sumB[k] += TB[STK[k]]; }
      if (isDecision(f)) {
        dist++; dec[f.method]++; secs += nR * 300; rndsJudged += nR;
        if (f.winner === "A") distA++; else if (f.winner === "B") distB++;
      } else {
        secs += (f.round - 1) * 300 + f.t; rndsJudged += f.method === "CORNER" || f.method === "DOC" ? f.round : f.round - 1;
        if (f.winner === "A") finA[f.round - 1]++; else finB[f.round - 1]++;
        if (f.method === "SUB") { finSUB[f.round - 1]++; subNames[f.fin.detail] = (subNames[f.fin.detail] || 0) + 1; }
        else {
          finKO[f.round - 1]++; koLoc[f.fin.loc] = (koLoc[f.fin.loc] || 0) + 1;
          var kk = f.method === "TKO" ? (f.fin.follow ? "TKO_followup" : "TKO_standing") : f.method; koKind[kk] = (koKind[kk] || 0) + 1;
        }
      }
      n108 += f.n108; kdr += f.kdr; kdrf += f.kdrf;
      if (onProgress && i % chunk === 0) onProgress(i / N);
    }
    if (onProgress) onProgress(1);
    var mins = secs / 60;
    function avgOf(sum) {
      var o = {}; for (k = 0; k < NS; k++) o[STK[k]] = sum[k] / N;
      o.per15 = {}; for (k = 0; k < NS; k++) o.per15[STK[k]] = sum[k] / mins * 15;
      o.acc = sum[I_SL] / Math.max(1, sum[I_SA]); o.accHead = sum[I_HL] / Math.max(1, sum[I_HA]);
      o.accBody = sum[I_BL] / Math.max(1, sum[I_BA]); o.accLeg = sum[I_LL] / Math.max(1, sum[I_LA]);
      o.accDist = sum[I_DL] / Math.max(1, sum[I_DA]); o.accClinch = sum[I_CL] / Math.max(1, sum[I_CA]); o.accGround = sum[I_GL] / Math.max(1, sum[I_GA]);
      o.tdAcc = sum[I_TDL] / Math.max(1, sum[I_TDA]);
      o.kdPer100Head = 100 * sum[I_KD] / Math.max(1, sum[I_HL]); o.kdPer100StandHead = 100 * sum[I_KD] / Math.max(1, sum[I_SHL]);
      return o;
    }
    var avgA = avgOf(sumA), avgB = avgOf(sumB);
    var pA = (bins[0] + bins[1] + bins[2]) / N, pB = (bins[4] + bins[5] + bins[6]) / N, pD = bins[3] / N;
    var fins = N - dist;
    return {
      n: N, seed: seed, bins: bins.map(function (x) { return x / N; }), counts: bins,
      pA: pA, pB: pB, pD: pD, se: Math.sqrt(pA * (1 - pA) / N),
      finA: finA.map(function (x) { return x / N; }), finB: finB.map(function (x) { return x / N; }),
      finKO: finKO.map(function (x) { return x / N; }), finSUB: finSUB.map(function (x) { return x / N; }),
      dist: dist / N, distA: dist ? distA / dist : 0, distB: dist ? distB / dist : 0,
      dec: { UD: dec.UD / Math.max(1, dist), SD: dec.SD / Math.max(1, dist), MD: dec.MD / Math.max(1, dist), DRAW: dec.DRAW / Math.max(1, dist) },
      methods: methods, koLoc: koLoc, koKind: koKind, subNames: subNames, fins: fins / N, kdFin: kdrf / Math.max(1, kdr), kdRounds: kdr,
      r108: n108 / Math.max(1, 3 * rndsJudged), avgMin: mins / N,
      avg: { A: avgA, B: avgB },
      kd15: (sumA[I_KD] + sumB[I_KD]) / 2 / mins * 15, ctrl15: (sumA[I_CTRL] + sumB[I_CTRL]) / 2 / mins * 15
    };
  }

  // ------------------------------------------------------------------ explain: why the matchup looks the way it does
  function explain(m) {
    var P = m.P, L = m.L, R = m.R, out = { division: m.division, rounds: m.rounds, A: null, B: null, pair: null, text: "" };
    var occ = m.occ, nm = [m.A.name, m.B.name], lines = [], i, j;
    function f(x, d) { return x == null || !isFinite(x) ? "-" : (+x).toFixed(d == null ? 2 : d); }
    function pct(x) { return x == null ? "-" : (100 * x).toFixed(1) + "%"; }
    var standFrac = occ[0] + occ[1] + occ[2], topF = [occ[3], occ[4]];
    lines.push(nm[0] + " vs " + nm[1] + " | " + m.division + " (" + (P.lbs || "?") + " lb), " + m.rounds + " rounds" + (m.title ? ", title" : "") + (m.date ? ", " + m.date : ""));
    lines.push("Expected position time (fit): distance " + pct(occ[0]) + ", clinch " + pct(occ[1] + occ[2]) + " (" + nm[0] + " controls " + pct(occ[1] / Math.max(1e-9, occ[1] + occ[2])) + "), " +
      nm[0] + " on top " + pct(occ[3]) + ", " + nm[1] + " on top " + pct(occ[4]) + "  [league: distance " + pct(L.dist) + ", clinch " + pct(L.clinch) + ", ground " + pct(L.ground) + "]");
    var sides = [];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var o = {}, fc = m.fac[i], fo = m.fac[j];
      o.name = nm[i]; o.age = m.ages[i]; o.home = m[i ? "B" : "A"].division; o.minutes = R[i].min;
      o.attPerMin = { dist: m.dRate[i] * 60, clinch: m.cRate[i] * 60, groundTop: m.gRate[i] * 60, groundBottom: m.gBot[i] * 60 };
      o.leagueAttPerMin = { dist: L.dAtt, clinch: P.c_att / m.clT, groundTop: L.gAtt };
      var accD = [], accC = [], accG = [];
      for (var t = 0; t < 3; t++) {
        accD.push(prob(m.accO[(i * 4) * 3 + t])); accC.push(prob(m.accO[(i * 4 + 1) * 3 + t])); accG.push(prob(m.accO[(i * 4 + 2) * 3 + t]));
      }
      o.accuracy = { dist: accD, clinch: accC, ground: accG, careerShrunk: R[i].acc, oppAllowedShrunk: R[j].accAg };
      o.targetMixDist = m.mixD[i];
      // expected landed per 15 from occupancy and base rates (before pace, form and fatigue)
      var dl = 0, da = m.dRate[i] * occ[0] * 900, cl = 0, ca = m.cRate[i] * (occ[1] + occ[2]) * 900, ga = m.gRate[i] * topF[i] * 900 + m.gBot[i] * topF[j] * 900;
      var mx = m.mixD[i], gl = 0;
      for (t = 0; t < 3; t++) { dl += da * mx[t] * accD[t]; cl += ca * m.p.clinchMix[t] * accC[t]; gl += ga * m.p.groundTopMix[t] * accG[t]; }
      o.expectedPer15 = { distAtt: da, distLnd: dl, clinchAtt: ca, clinchLnd: cl, groundAtt: ga, groundLnd: gl, sigLnd: dl + cl + gl, sigAtt: da + ca + ga,
        tdAtt: (m.tdD[i] * occ[0] + (i === 0 ? m.tdCC[0] * occ[1] + m.tdCU[0] * occ[2] : m.tdCC[1] * occ[2] + m.tdCU[1] * occ[1])) * 900,
        ctrlSec: (topF[i] + occ[1 + i]) * 900 };
      o.career = { slpm: R[i].sums.min > 0 ? (R[i].sums.d_lnd + R[i].sums.c_lnd + R[i].sums.g_lnd) / R[i].sums.min : null,
        sapm: R[i].sums.min > 0 ? (R[i].sums.od_lnd + R[i].sums.oc_lnd + R[i].sums.og_lnd) / R[i].sums.min : null };
      o.kd = { p0: m.kd[i] / (fc.pow * fo.chin), perHeadLanded: m.kd[i], powerRatio: fc.powRaw, oppChinRatio: fo.chinRaw, ageChinOpp: fo.ageChin, agePow: fc.agePow,
        koLossChinOpp: fo.koChin, oppKoLosses: fo.koLosses, sizeChinOpp: fo.sizeChin, sizePow: fc.sizePow, knobPow: m.adj[i].pow, knobChinOpp: m.adj[j].chin,
        damagePerHead: m.dw[i], instantKO: prob(m.instO) };
      o.grappling = { tdAttPer15Stand: m.tdS[i] * 900, tdSuccess: m.pTd[i], tdSuccessClinch: prob(m.tdOC[i] * m.adj[j].tdDef), ctrlTargetPer15: m.ctrlT[i] * 15,
        topSkill: R[i].topSkill, oppEscapeWeakness: R[j].escWeak, passEdge: m.gEdge[i], standUpMeanSecWhenUnder: 1 / Math.max(1e-9, m.up[i]),
        sweepPerMinBottom: m.sw[i] * 60 };
      o.subs = { attemptsPerGroundMin: m.threat[i], conversion: m.subConv[i], careerConvShrunk: R[i].subConv, oppDefFailShrunk: R[j].subDefFail, guillotinePerStuffedShot: m.gillo[i] };
      o.cardio = { paceByRound: m.pace[i].slice(), cardioIndex: m.cardio[i], drainPerSec: m.drain[i], drainVsLeague: m.drain[i] / m.p.drain,
        drainSchedule: Math.pow(3 / m.rounds, m.p.drainSchedExp), drainCardio: Math.pow(clip(m.cardio[i], 0.5, 1.6), -m.p.cardioExp) };
      o.knobs = m.adj[i];
      sides.push(o);
      lines.push("");
      lines.push("== " + nm[i] + " (" + (o.home || "?") + ", age " + f(o.age, 1) + ", " + f(o.minutes, 0) + " decayed UFC minutes) ==");
      lines.push("  Attempts/min: distance " + f(o.attPerMin.dist) + " (league " + f(L.dAtt) + "), clinch " + f(o.attPerMin.clinch) + ", ground top " + f(o.attPerMin.groundTop) + " (league " + f(L.gAtt) + ")");
      lines.push("  Accuracy at distance head/body/leg " + accD.map(pct).join(" / ") + "; clinch " + accC.map(pct).join(" / ") + "; ground " + accG.map(pct).join(" / "));
      lines.push("  Distance target mix head/body/leg " + m.mixD[i].map(pct).join(" / "));
      lines.push("  Expected per 15 (base): sig att " + f(o.expectedPer15.sigAtt, 1) + ", landed " + f(o.expectedPer15.sigLnd, 1) + " (dist " + f(dl, 1) + ", clinch " + f(cl, 1) + ", ground " + f(gl, 1) +
        "); career landed/min " + f(o.career.slpm) + ", absorbed/min " + f(o.career.sapm));
      lines.push("  KD per landed standing head strike " + f(100 * m.kd[i], 3) + "% = p0 " + f(100 * o.kd.p0, 3) + "% x power " + f(fc.powRaw) + " x opp chin " + f(fo.chinRaw) +
        " x opp age " + f(fo.ageChin) + " x own age (power) " + f(fc.agePow) + " x opp KO losses (" + fo.koLosses + ") " + f(fo.koChin) + " x opp size " + f(fo.sizeChin) + " x own size (power) " + f(fc.sizePow) +
        " x knobs " + f(m.adj[i].pow) + "/" + f(m.adj[j].chin) + "; damage/head " + f(m.dw[i]));
      lines.push("  Takedowns: " + f(o.grappling.tdAttPer15Stand) + " att per 15 standing min, success " + pct(m.pTd[i]) + " (career " + pct(R[i].tdAcc) + " vs opp allows " + pct(R[j].tdAccAg) + ", league " + pct(P.td_acc) +
        "); control target " + f(o.grappling.ctrlTargetPer15, 0) + " s/15 (league " + f(P.ctrl * 15, 0) + "), top skill " + f(R[i].topSkill) + " x opp escape " + f(R[j].escWeak) + " -> pass edge " + f(m.gEdge[i]));
      lines.push("  When under: mean stand-up " + f(1 / m.up[i], 0) + " s, sweeps " + f(m.sw[i] * 60, 3) + "/min");
      lines.push("  Submissions: " + f(m.threat[i], 3) + " attempts per ground-minute (league " + f(L.sub, 3) + "), conversion " + pct(m.subConv[i]) + " (shrunk own " + pct(R[i].subConv) + " vs opp " + pct(R[j].subDefFail) + ", league " + pct(P.sub_conv) + ")");
      var schedF = Math.pow(3 / m.rounds, m.p.drainSchedExp), cardF = Math.pow(clip(m.cardio[i], 0.5, 1.6), -m.p.cardioExp);
      lines.push("  Cardio: output by round " + m.pace[i].map(function (x) { return f(x); }).join(" ") + " (division curve x his late-round ratio); cardio index " + f(m.cardio[i]) +
        "; stamina drain x" + f(m.drain[i] / m.p.drain) + " of the 3-round base (" + m.rounds + "-round pacing x" + f(schedF) + ", cardio x" + f(cardF) + ", knob x" + f(m.adj[i].cardio) + ")");
    }
    out.A = sides[0]; out.B = sides[1];
    out.pair = { occupancy: occ, clinchTarget: m.clT, ctrlTargetPer15: [m.ctrlT[0] * 15, m.ctrlT[1] * 15], clinchEntryPerMinDist: m.clE * 60, judgePower: m.judgePower };
    out.text = lines.join("\n");
    return out;
  }

  // ------------------------------------------------------------------ manual profiles from ufcstats-style career rates
  function manualProfile(rates, opts) {
    opts = opts || {};
    var r = rates || {}, division = opts.division || r.division || "Lightweight";
    var P = priorFor(division, opts.priors);
    var min = r.mins != null ? +r.mins : 60;
    function g(k, d) { return r[k] != null && isFinite(r[k]) ? +r[k] : d; }
    var slpm = g("slpm", P.slpm || (P.d_lnd + P.c_lnd + P.g_lnd)), sapm = g("sapm", slpm), acc = g("acc", P.acc_sig || 0.46), def = g("def", 1 - (P.acc_sig || 0.46));
    var head = g("head", P.h_lnd / (P.h_lnd + P.b_lnd + P.l_lnd)), body = g("body", P.b_lnd / (P.h_lnd + P.b_lnd + P.l_lnd)), leg = g("leg", P.l_lnd / (P.h_lnd + P.b_lnd + P.l_lnd));
    var hs = head + body + leg; head /= hs; body /= hs; leg /= hs;
    var lp = P.d_lnd + P.c_lnd + P.g_lnd;
    var dist = g("dist", P.d_lnd / lp), clinch = g("clinch", P.c_lnd / lp), ground = g("ground", P.g_lnd / lp);
    var ps = dist + clinch + ground; dist /= ps; clinch /= ps; ground /= ps;
    var S = {}, k;
    for (k = 0; k < KEYS.length; k++) S[KEYS[k]] = 0;
    S.min = min; S.n = min / (P.mpf || 10); S.rds = min / 4.6;
    // split landed and attempts by target / position with league accuracies scaled on odds so totals match
    function split(lnd, att, shares, accs) {
      var lo = 0.05, hi = 20, c = 1, it, out = [0, 0, 0];
      for (it = 0; it < 60; it++) {
        c = Math.sqrt(lo * hi); var sa = 0;
        for (var t = 0; t < 3; t++) sa += lnd * shares[t] / prob(odds(accs[t]) * c);
        if (sa > att) lo = c; else hi = c;
      }
      for (var t2 = 0; t2 < 3; t2++) out[t2] = lnd * shares[t2] / prob(odds(accs[t2]) * c);
      return out;
    }
    var sigL = slpm * min, sigA = sigL / clip(acc, 0.1, 0.95), oL = sapm * min, oA = oL / clip(1 - def, 0.1, 0.95);
    var tA = split(sigL, sigA, [head, body, leg], [P.acc_h, P.acc_b, P.acc_l]), pA = split(sigL, sigA, [dist, clinch, ground], [P.acc_d, P.acc_c, P.acc_g]);
    S.h_lnd = sigL * head; S.b_lnd = sigL * body; S.l_lnd = sigL * leg; S.h_att = tA[0]; S.b_att = tA[1]; S.l_att = tA[2];
    S.d_lnd = sigL * dist; S.c_lnd = sigL * clinch; S.g_lnd = sigL * ground; S.d_att = pA[0]; S.c_att = pA[1]; S.g_att = pA[2];
    var lh = P.h_lnd / (P.h_lnd + P.b_lnd + P.l_lnd), lb = P.b_lnd / (P.h_lnd + P.b_lnd + P.l_lnd), ll = 1 - lh - lb;
    var oT = split(oL, oA, [lh, lb, ll], [P.acc_h, P.acc_b, P.acc_l]), oP = split(oL, oA, [P.d_lnd / lp, P.c_lnd / lp, P.g_lnd / lp], [P.acc_d, P.acc_c, P.acc_g]);
    S.oh_lnd = oL * lh; S.ob_lnd = oL * lb; S.ol_lnd = oL * ll; S.oh_att = oT[0]; S.ob_att = oT[1]; S.ol_att = oT[2];
    S.od_lnd = oL * P.d_lnd / lp; S.oc_lnd = oL * P.c_lnd / lp; S.og_lnd = oL * P.g_lnd / lp; S.od_att = oP[0]; S.oc_att = oP[1]; S.og_att = oP[2];
    S.t_lnd = sigL * (P.t_lnd / lp); S.t_att = sigA * (P.t_att / (P.d_att + P.c_att + P.g_att)); S.ot_lnd = oL * (P.ot_lnd / lp); S.ot_att = oA * (P.ot_att / (P.d_att + P.c_att + P.g_att));
    S.kd = g("kd15", P.kd15 || P.kd * 15) / 15 * min;
    S.okd = r.okd15 != null ? +r.okd15 / 15 * min : P.kd_per_h * S.oh_lnd;
    var td15 = g("td15", P.td15 || P.td_lnd * 15), tdAcc = clip(g("tdAcc", P.td_acc), 0.05, 0.95), tdDef = clip(g("tdDef", 1 - P.td_acc), 0, 0.97);
    S.td_lnd = td15 / 15 * min; S.td_att = S.td_lnd / tdAcc;
    S.otd_att = r.otdAtt15 != null ? +r.otdAtt15 / 15 * min : P.otd_att * min; S.otd_lnd = S.otd_att * (1 - tdDef);
    S.ctrl = r.ctrl15 != null ? +r.ctrl15 / 15 * min : P.ctrl * min * clip(td15 / Math.max(0.05, P.td_lnd * 15), 0.15, 4);
    S.octrl = r.octrl15 != null ? +r.octrl15 / 15 * min : P.ctrl * min * clip((1 - tdDef) / Math.max(0.05, P.td_acc), 0.15, 4);
    S.sub_att = g("sub15", P.sub15 || P.sub_att * 15) / 15 * min; S.osub_att = P.osub_att * min;
    S.rev = P.rev * min; S.orev = P.orev * min;
    var rec = r.record || {};
    S.ko_w = rec.ko_w || 0; S.ko_l = rec.ko_l || 0; S.sub_w = rec.sub_w || 0; S.sub_l = rec.sub_l || 0; S.dec_w = rec.dec_w || 0; S.dec_l = rec.dec_l || 0;
    return { name: r.name || opts.name || "Manual fighter", slug: r.slug || opts.slug || null, nick: r.nick || null, division: division,
      dob: r.dob || null, age: r.age != null ? +r.age : null, height_in: r.height_in || null, reach_in: r.reach_in || null, stance: r.stance || null,
      record: r.record || null, ko_losses: r.ko_losses != null ? +r.ko_losses : (rec.ko_l || 0), kd_absorbed: null, n_fights: r.n_fights || null,
      pace: r.pace || null, pace_w: r.pace_w || null, S: S, manual: true };
  }

  // ------------------------------------------------------------------ data registry
  function loadDB(json) {
    var d = typeof json === "string" ? JSON.parse(json) : json;
    if (!d || !d.priors) throw new Error("FightEngine.loadDB: expected fighters.json with priors and fighters");
    DB = { meta: d.meta || {}, priors: d.priors, fighters: d.fighters || {} };
    for (var s in DB.fighters) if (!DB.fighters[s].slug) DB.fighters[s].slug = s;
    return {
      meta: DB.meta, priors: DB.priors, fighters: DB.fighters,
      get: profile, profile: profile,
      list: function () { return Object.keys(DB.fighters); },
      find: function (q) {
        q = String(q || "").toLowerCase(); var out = [];
        for (var k in DB.fighters) if (k.indexOf(q) >= 0 || String(DB.fighters[k].name || "").toLowerCase().indexOf(q) >= 0) out.push(k);
        return out;
      }
    };
  }
  function profile(slug) { return DB && DB.fighters[slug] ? DB.fighters[slug] : null; }

  var api = {
    VERSION: VERSION, KEYS: KEYS, STATS: STK,
    loadDB: loadDB, profile: profile, matchup: matchup, matchupBase: matchupBase, simulate: simulate, bucket: bucket, makeRng: makeRng,
    loadMLRates: loadMLRates, mlModel: mlModel, judgeRound: judgeRound,
    // v8: components embed / retarget / tdIntent / ctrlSpread
    loadEmbed: loadEmbed, embedBlend: embedBlendSide, compOn: compOn,
    resolveParams: function (over, base) { return mergeParams(base || getParams(), over || {}); },
    retargetCacheClear: retargetCacheClear, _rt: { step: rtStep, apply: rtApply, ipf: rtIpf, pilot: rtPilot, swapOpts: swapOpts, auxSeed: auxSeed, spreadOf: spreadOf },
    summarize: summarize, explain: explain, manualProfile: manualProfile,
    // helpers exposed for tests, calibration and the page
    priorFor: priorFor, league: league, fighterRates: fighterRates, occupancy: occupancy, isDecision: isDecision,
    clip: clip, log5: log5, odds: odds, prob: prob, params: getParams
  };
  return api;
});
