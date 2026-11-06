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
   v5 (in progress; the merge log is docs/CHANGELOG.md "v5 merge log"): each v5 component sits behind its own
   params.components.<name> flag, and every flag-off path reproduces v4.0.0 for fixed seeds. Step 1, components.v401:
   v4.0.1's train-only fixes (pre-2024 EM judging weights, point deductions, learned-path levels, the cumulative
   takedown cap, KO/TKO composition targets from 2019-2023 fights), one sub-flag each (see resolveParams below).
   Step 2: components.durability (applyDurability) and components.dynamics (dynTables). Step 3: components.styles_sos
   (src/styles_sos.js through the public matchup wrapper at the end; strength of schedule on, active only with opts.sos),
   components.officials (officialsFor / officialsRound; off, opt-in per call) and components.realism_sens
   (realismFactors; off) with FightEngine.sensitivity / rateSd (tornado data, common random numbers). Step 4: the learned
   stat-line path and newcomer priors: components.embed (embedTargets: the embedding blend of the learned targets),
   components.oppadj (oppadjTargets: opponent adjustment of the learned targets; off, exclusive with styles_sos sos) and
   components.preufc (applyPreUFC: pre-UFC finish-odds priors for fighters with 0-3 UFC fights).

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
  var VERSION = "5.0.0-dev";   // v5 merge in progress (v4.0.0 base); the freeze sets 5.0.0

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
  // fight-dynamics component (research/model_dynamics.md E1-E11): on when params.components.dynamics is true and the
  // params carry the dyn block; off reproduces the engine before the component bit for bit
  function dynOn(p) { return !!(p && p.components && p.components.dynamics && p.dyn); }
  function getML() { return MLR0 || (root && root.MLRates) || null; }
  var SS0 = null; if (typeof require === "function") { try { SS0 = require("./styles_sos.js"); } catch (e) { SS0 = null; } }  // [styles_sos]
  function getSS() { return SS0 || (root && root.StylesSOS) || null; }  // [styles_sos]
  // v5 merge step 4 (components.embed): the embedding evaluator, needed only to compute task predictors from a loaded roster
  // (loadEmbed); backtests pass precomputed predictors in opts.embed
  var EMB0 = null; if (typeof require === "function") { try { EMB0 = require("./ml/embed.js"); } catch (e) { EMB0 = null; } }
  function getEmbMod() { return EMB0 || (root && root.FightEmbed) || null; }

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

  // ------------------------------------------------------------------ components (engine v5)
  // params.components.<name> switches each v5 component; every flag-off path reproduces engine v4.0.0 exactly for fixed
  // seeds (tests/test_v401.js for step 1). Flags can be set in params3.js or per call through opts.params.components.
  // components.v401 (v5 merge step 1): v4.0.1's train-only fixes. v4.0.1's single validation look rejected them as a
  // bundle by the decision rule (no CI excluded 0), not because they are wrong; v5 carries them, measured inside v5's own
  // look, and the Calibrate stage keeps each only if it helps in the train leave-one-out. One sub-flag each:
  //   emJudge    (a) EM round-winner judging weights refit on 2015-2023 cards (tools/judge_em_train.py), with the judges'
  //                  noise, fight-level share and 10-8 KD term refit on them (tools/judgecal.js, 2019-2023 rounds) and the
  //                  10-8 threshold t108 re-levelled with them (tools/v4_levels.js, train fights)
  //   deductions (b) point deductions judge.ded / judge.ded2 (tools/judgecal.js, 2019-2023 decision rounds; drawn after
  //                  the last round, so a fight is unchanged up to the cards)
  //   mlLevels   (c) learned-path levels mlTdLevel / mlCtrlLevel / mlSubLevel (src/ml/mlrates.js opts.levels) with the
  //                  companion levels of the same tools/v4_levels.js run: kdScale, kdInstant, kdRefStop, stko, gnpTko,
  //                  subConvScale
  //   tdCap      (d) mlMaxRatio caps the cumulative takedown-attempt multiplier and the takedown-odds one (src/ml/mlrates.js
  //                  opts.cumCap; v4.0.0 capped each of three refit steps, so it compounded past x4 on 20 of 3,998 sides)
  //   koTargets  (e) the self-calibration's KO/TKO composition targets taken from 2019-2023 fights (tools/ko_composition.py:
  //                  ground 28.6%, clinch 7.1%, standing without a knockdown 7.2%; v4: 28 / 12.5 / 7 from all years):
  //                  factors params.v401.koComp on kdScale, kdPos[1] (clinch), gnpTko, stko and, on odds, kdInstant /
  //                  kdRefStop (tools/v401_kocomp.js, league-average pairs on the train-only priors)
  // params3.js keeps the flag-on values in the usual fields and v4.0.0's values in params.v401.off. A sub-flag that is off
  // puts those back BEFORE the opts.params overrides, so an explicit override always wins. koTargets multiplies AFTER the
  // overrides: the stored fields stay the pre-(e) levels, and a tuner that moves them through opts.params still gets the
  // factor (tools/v4_levels.js --write then writes pre-(e) levels, consistent with what it fitted).
  // components.v401: true / false switches all five; an object switches each sub-flag (on unless it is false).
  var V401_SUB = ["emJudge", "deductions", "mlLevels", "tdCap", "koTargets"];
  function v401Flags(p) {
    var c = p && p.components ? p.components.v401 : null, o = {}, i;
    for (i = 0; i < V401_SUB.length; i++) o[V401_SUB[i]] = c === true || (!!c && typeof c === "object" && c[V401_SUB[i]] !== false);
    return o;
  }
  // base params (FightParams) + per-call overrides -> the parameter set a matchup runs on
  function resolveParams(base, over) {
    var p = mergeParams(base, over), fl = v401Flags(p), OFF = base.v401 && base.v401.off, i;
    if (OFF) {
      var back = null;
      for (i = 0; i < V401_SUB.length; i++) {
        var s = V401_SUB[i];
        if (fl[s] || !OFF[s]) continue;
        back = back ? mergeParams(back, OFF[s]) : mergeParams({}, OFF[s]);
      }
      if (back) p = mergeParams(mergeParams(base, back), over);
    }
    var KC = fl.koTargets && base.v401 && base.v401.koComp;
    if (KC) {
      if (KC.kdScale) p.kdScale *= KC.kdScale;
      if (KC.kdInstant) p.kdInstant = prob(odds(p.kdInstant) * KC.kdInstant);
      if (KC.kdRefStop) p.kdRefStop = prob(odds(p.kdRefStop) * KC.kdRefStop);
      if (KC.gnpTko) p.gnpTko *= KC.gnpTko;
      if (KC.stko) p.stko *= KC.stko;
      if (KC.kdClinch && p.kdPos) { p.kdPos = p.kdPos.slice(); p.kdPos[1] *= KC.kdClinch; }
    }
    return p;
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
    var kP = dynOn(p) ? p.dyn.kPace : p.kPace;     // dynamics E10: per-round pace ratio prior strength (train-chosen 45)
    for (r = 1; r < 5; r++) {
      if (pc && pwt && pc[r] != null && pwt[r] > 0 && r < lc.length) {
        var ratio = clip(pc[r] / lc[r], 0.3, 3);
        rho[r] = (ratio * pwt[r] + kP) / (pwt[r] + kP); rw[r] = pwt[r];
      } else if (r >= 1) { rho[r] = 1 + 0.5 * (rho[r - 1] - 1); }
    }
    R.rho = rho; R.rhoW = rw;
    if (p.components && p.components.styles_sos && (prof.oppadj || prof.slug)) { var SSr = getSS(); if (SSr && SSr.oppadjR) SSr.oppadjR(R, prof, p); }  // [styles_sos]
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

  // ------------------------------------------------------------------ components (params.components.<name>: true = on)
  function compOn(p, name) { return !!(p && p.components && p.components[name]); }

  // realism_sens (v5 merge step 3; OFF: components.realism_sens false): per-division and per-format correction factors fit on
  // 2019-2023 walk-forward backtest fights where the engine's simulated base rates miss the real ones (tools/realism.js fit;
  // empirical-Bayes shrunk toward 1). They multiply the division self-calibration factors (p.div: att, kd, ko, sub, ctrl, td),
  // so they reach the learned-rate targets too (src/ml/mlrates.js re-levels to the engine's own league expectation, built
  // with the same factors). Off -> null. A factor counts only when it is a finite positive number (null, "", a negative or 0
  // is ignored = 1: isFinite(null) is true, so a null meant as "unset" would otherwise zero the lever). The shipped factors
  // were fit on v4.0.1 final: refit (tools/realism.js fit) on the v5 engine before ever turning the flag on.
  function realismFactors(p, division, nR) {
    if (!compOn(p, "realism_sens") || !p.realism) return null;
    var d = (p.realism.div && p.realism.div[division]) || null, f = (p.realism.fmt && p.realism.fmt[String(nR)]) || null, out = {}, k, n = 0;
    function ok(v) { return v != null && v !== "" && isFinite(v) && +v > 0; }
    if (d) for (k in d) if (ok(d[k])) { out[k] = +d[k]; n++; }
    if (f) for (k in f) if (ok(f[k])) { out[k] = (out[k] != null ? out[k] : 1) * +f[k]; n++; }
    return n ? out : null;
  }

  // ------------------------------------------------------------------ matchup (v3 rate tables, no learned model)
  function matchupBase(profA, profB, opts) {
    opts = opts || {};
    var base = getParams();
    if (!base) throw new Error("FightEngine: FightParams not loaded (load params3.js first)");
    var p = resolveParams(base, opts.params);   // v5: components flags (components.v401 sub-flags) applied here
    profA = resolve(profA); profB = resolve(profB);
    var division = opts.division || profA.division || profA.home || "Lightweight";
    var P = priorFor(division, opts.priors);
    var nR = opts.rounds || (opts.title ? 5 : 3);
    var dv = (p.div && p.div[division]) || {};
    var rz = realismFactors(p, division, nR);   // realism_sens component: walk-forward division / format factors, null when off
    function dvf(k) { var v = dv[k] != null ? dv[k] : 1; return rz && rz[k] != null ? v * rz[k] : v; }
    var L = league(P, p);
    var profs = [profA, profB];
    var R = [fighterRates(profA, P, L, p, nR), fighterRates(profB, P, L, p, nR)];
    var adj = [normAdj(opts.adjA), normAdj(opts.adjB)];
    var jud = opts.judges || {};
    var date = opts.date || (DB && DB.meta && DB.meta.snapshot) || null;
    var a = p.combA, b = p.combB, i, j, k;
    var m = { version: VERSION, A: info(profA), B: info(profB), division: division, rounds: nR, title: !!opts.title, date: date,
      p: p, P: P, L: L, R: R, adj: adj, judgePower: jud.power != null ? +jud.power : p.judge.power, opts: opts };
    // the two resolved profiles, for sensitivity() rebuilds (non-enumerable: no effect on the tables, copies or JSON)
    Object.defineProperty(m, "_src", { value: { A: profA, B: profB }, enumerable: false, writable: true, configurable: true });
    if (rz) m.realism = rz;

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
          var z = dynOn(p) ? L.accA[t] + L.accB[posq] + a * p.dyn.accProfA * R[i].accSh[t] + b * p.dyn.accProfB * R[j].accAgSh[t]
            : L.accA[t] + L.accB[posq] + a * R[i].accSh[t] + b * R[j].accAgSh[t];
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
    m.dyn = dynOn(p) ? dynTables(m, p, R, nR) : null;
    m.off = officialsFor(p, opts, m);           // officials component (null when params.components.officials is off)
    return m;
  }

  // ------------------------------------------------------------------ fight dynamics (component "dynamics")
  // research/model_dynamics.md section 8, recipe E1-E11, fit on 2019-2023 round data (data/derived/dynamics.json);
  // level factors re-fit on 2019-2023 backtest fights (tools/dynamics_calibrate.js). Per-round tables used by simulate():
  //   pace[i][r]  output multiplier: league distance pace curve (E1) x own cardio ratio (kPace 45) x opponent's^paceMutual
  //               (E10), normalised over the first rounds, x outLevel
  //   kdP[r]      knockdown multiplier per landed standing strike: kdRound table by format x kdLevel (E7; replaces the
  //               stamina, pace and damage terms and the 5-round caution on knockdowns)
  //   conv[r]     odds multiplier on the instant-KO and follow-up stoppage chances after a knockdown: convLevel x
  //               exp(convRound (r - 1)) (E8; replaces damage and stamina terms)
  //   stkoR[r], gnpR[r]  non-knockdown stoppage hazards: scale x exp(noKdRound (r - 1)), with damage slopes
  //               stkoBase / gnpDmg (E9; replaces attacker stamina)
  //   tdR[r]      takedown-attempt round curve (tdRound3 / tdRound5, normalised like pace), the marginal round shape the E6
  //               carry-over multipliers act within (real attempts rise by round; carry-over alone made them fall)
  function dynTables(m, p, R, nR) {
    var Y = p.dyn, i, j, k, r;
    var curve = nR === 5 ? Y.pace5 : (nR === 3 ? Y.pace3 : null);
    if (!curve) { curve = []; for (k = 0; k < nR; k++) curve.push(Y.pace5[Math.min(k, Y.pace5.length - 1)]); }
    var nb = Math.min(3, nR), cm0 = 0;
    for (k = 0; k < nb; k++) cm0 += curve[k];
    cm0 /= nb;
    var rel = [[], []], pace = [[], []];
    for (i = 0; i < 2; i++) {
      var rho = R[i].rho, rm = 0;
      for (k = 0; k < nb; k++) rm += rho[k];
      rm /= nb;
      for (k = 0; k < nR; k++) rel[i].push(rho[Math.min(4, k)] / rm);
    }
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var raw = [], s = 0;
      for (k = 0; k < nR; k++) { raw.push(rel[i][k] * Math.pow(rel[j][k], Y.paceMutual)); if (k < nb) s += raw[k]; }
      s /= nb;
      for (k = 0; k < nR; k++) pace[i].push(curve[k] / cm0 * raw[k] / s * Y.outLevel);
    }
    var kdTab = nR === 5 ? Y.kdRound5 : (nR === 3 ? Y.kdRound3 : null);
    if (!kdTab) { kdTab = []; for (k = 0; k < nR; k++) kdTab.push(Y.kdRound5[Math.min(k, Y.kdRound5.length - 1)]); }
    var kdL = nR >= 5 ? Y.kdLevel5 : Y.kdLevel3;
    // takedown-attempt round curve (marginal round shape that the carry-over terms act within), normalised like pace
    var tdCurve = nR === 5 ? Y.tdRound5 : (nR === 3 ? Y.tdRound3 : null), tdR = [];
    if (!tdCurve) { tdCurve = []; for (k = 0; k < nR; k++) tdCurve.push(Y.tdRound5 ? Y.tdRound5[Math.min(k, Y.tdRound5.length - 1)] : 1); }
    var tm0 = 0;
    for (k = 0; k < nb; k++) tm0 += tdCurve[k];
    tm0 /= nb;
    for (k = 0; k < nR; k++) tdR.push(tdCurve[k] / tm0);
    var kdP = [], conv = [], stkoR = [], gnpR = [];
    for (r = 0; r < nR; r++) {
      var kdT = kdTab[Math.min(r, kdTab.length - 1)];
      kdP.push(kdT * kdL);
      conv.push(Y.convLevel * Math.exp(Y.convRound * r));
      // E9 is a hazard per standing head strike absorbed. A standing TKO needs the hurt state, whose incidence already
      // follows kdRound (hurts are drawn with the knockdown chance), so the realised standing TKO per strike decays as
      // kdRound x exp(noKdRound r). Knob stkoHurtGate (verifier; default off, it did not score better on train) divides the
      // hurt gate's round decline back out so that it decays as exp(noKdRound r) alone
      stkoR.push(Y.stkoScale * Math.exp(Y.noKdRound * r) * (Y.stkoHurtGate ? kdTab[0] / kdT : 1));
      gnpR.push(Y.gnpScale * Math.exp(Y.noKdRound * r));
    }
    // E3: fatigue on output is small (distance -4.5% per 100 own attempts); the other stamina terms stay
    m.k.outStam = Y.outStam;
    // AR(1) autocorrelations: valid range [0, 1) (phi >= 1 makes the innovation sd sqrt(1 - phi^2) NaN); a value outside
    // it is clipped to [0, 0.999] (the defaults 0.85 / 0.73 pass through unchanged)
    var arPhi = clip(+Y.arPhi, 0, 0.999), aaPhi = clip(+Y.accArPhi, 0, 0.999);
    return {
      formPace: Y.formPace, formOut: Y.formOut, formAcc: Y.formAcc, vol: Y.vol, roundPace: Y.roundPace,
      arPhi: arPhi, arSd: Y.arSd, arInn: Y.arSd * Math.sqrt(1 - arPhi * arPhi), arC: 0.5 * Y.arSd * Y.arSd,
      accArPhi: aaPhi, accArSd: Y.accArSd, accArInn: Y.accArSd * Math.sqrt(1 - aaPhi * aaPhi), accLevel: Y.accLevel,
      pace: pace, kdP: kdP, conv: conv, stkoR: stkoR, gnpR: gnpR, stkoBase: Y.stkoBase, gnpDmg: Y.gnpDmg,
      momScOut: Y.momScorerOut, momScAcc: Y.momScorerAcc, momScTd: Y.momScorerTd, momDrOut: Y.momDroppedOut, momDrTd: Y.momDroppedTd,
      tdCtrlOpp: Y.tdCtrlOpp, tdTdl: Y.tdTdl, tdCtrlOwn: Y.tdCtrlOwn, distCtrlOpp: Y.distCtrlOpp, lostAcc: Y.lostAcc,
      tdLevel: Y.tdLevel != null ? Y.tdLevel : 1, tdR: tdR
    };
  }

  // ------------------------------------------------------------------ matchup (v4): base tables + learned stat-line rates
  // opts.ml: false -> plain base tables (v3-style rates); undefined / true -> apply the loaded model (loadMLRates) when there
  // is one; { pred } or { A, B } -> apply these precomputed per-side rates (corner order of this call; e.g. out-of-fold
  // tables for leak-free backtests; base = league rates of the shrinkage division, filled in when missing); { model } ->
  // that model handle instead of the loaded one. opts.mlModel is accepted as a shorthand for { model }.
  // params.mlWeight (0..1) blends toward the base tables (1 = full learned rates); params.mlMaxRatio caps any single
  // multiplier (components.v401.tdCap: also the cumulative takedown multipliers); params.mlTdLevel / mlCtrlLevel /
  // mlSubLevel (components.v401.mlLevels) scale the learned takedown-attempt, control and submission-attempt targets (train
  // level matching with the learned rates on; the plain tables keep their own self-calibrated level).
  // The result carries m.mlApplied (true / false) and, when applied, m.ml (targets, ratios) and m.mlPred.
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
  function matchupML(profA, profB, opts) {
    opts = opts || {};
    var pa = resolve(profA), pb = resolve(profB);
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
    // v5 merge step 4: the learned targets are rewritten before the adapter re-targets the tables: the embedding blend
    // (components.embed). Off: pred is untouched and the adapter gets exactly the step-3 inputs.
    if (compOn(m.p, "embed")) pred = embedTargets(m, pa, pb, opts, pred);
    var fl = v401Flags(m.p), mo = { engine: api, model: model || undefined, weight: w, maxRatio: m.p.mlMaxRatio || 4,
      parts: opts.mlParts || undefined };
    // v5 step 1 (components.v401): (c) learned-path levels on the takedown-attempt / control / sub-attempt targets;
    // (d) the cap on the cumulative takedown multipliers. Off: the adapter gets exactly v4.0.0's options.
    if (fl.mlLevels) mo.levels = { td_att: m.p.mlTdLevel || 1, ctrl: m.p.mlCtrlLevel || 1, sub_att: m.p.mlSubLevel || 1 };
    if (fl.tdCap) mo.cumCap = true;
    MLR.applyToMatchup(m, pred, mo);
    m.mlPred = { A: pred.A, B: pred.B, base: pred.base };
    m.mlApplied = true;
    return m;
  }
  // learned stat-line model (data/derived/mlrates.json; tools/mlrates.py). Returns the model handle.
  function loadMLRates(json) {
    var MLR = getML();
    if (!MLR) throw new Error("FightEngine.loadMLRates: src/ml/mlrates.js (MLRates) is not loaded");
    if (json == null) { MLMODEL = null; return null; }
    MLMODEL = json && json.targets && json.stack && json.raw ? json : MLR.load(json);
    return MLMODEL;
  }
  function mlModel() { return MLMODEL; }

  // ------------------------------------------------------------------ durability (engine v5 component: params.components.durability)
  // Replaces the chin / power block with the knockdown model of research/model_durability.md (tools/durability.py,
  // data/derived/durability.json). Knockdown hazard per landed standing head strike by i on j:
  //   m.kd[i] = kdCal * kdScale * base_ij * relK_ij
  //   base_ij = level * exp(const + div + five * [5 rounds] + title * [title])        (league level tracked by params)
  //   relK_ij = (C_j^chinExp * P_i^powExp * size * knobs)^(1 - w) * engRel_ij^w      (w = engineWeight)
  //   (relative mode, params.durability.level null: base_ij = the engine's division level x context, C x P / NORM,
  //   and kdCalRel in place of kdCal x kdScale)
  //   C_j = chin_cov_j * chin_re_j,  P_i = pow_cov_i * pow_re_i
  //   chin_cov = exp(d_age_c (age - 30) + d_age_h30 max(0, age - 30) + d_age_na [age unknown]
  //                  + d_okd_r KDabs_365d + d_okd_o KDabs_older + d_kol_r KOL_365d + d_kol_o KOL_older)
  //   pow_cov  = exp(a_age_c (age - 30) + a_age_h30 max(0, age - 30))
  //   chin_re = (alphaChin + KD absorbed) / (alphaChin + expected), pow_re = (alphaPow + KD scored) / (alphaPow + expected)
  // engRel_ij is the engine's own knockdown structure relative to its division level (v3 power x chin ratios, or the
  // learned v4 rates when they were applied): m.kd_before / (kd0 * kdScale * div kd). GNP and standing TKO hazards scale
  // with sqrt(rel_ij) and damage per head strike with the blended power ratio, as v3 / v4 do with their own products
  // (rel_ij = relK_ij with C x P / NORM: mean about 1).
  // Inputs per side (first found wins): opts.dur.A / opts.dur.B (corner order of this call; backtests pass the
  // walk-forward records of durability.json backtest[fight_id]), prof.dur, the roster registered with loadDurability()
  // (by slug), else computed from the profile (age, ko_losses[_365], kd_absorbed[_365]; chin_re / pow_re from career
  // sums when params.durability.fallbackEB, else 1). opts.dur.base overrides base_ij (backtests: the walk-forward
  // L730(t) x exp(const + division + context) of the record). The result carries m.dur (inputs and factors).
  // The roster is the LIVE fit (fighter effects through the durability snapshot, so they contain the outcomes of every
  // fight up to it). Leak guard: it is used only for matchups dated on or after its snapshot (durability.json
  // meta.snapshot), never for a backtest fight; earlier fights need opts.dur (the walk-forward backtest records).
  var DURROSTER = null, DURASOF = null;
  function loadDurability(json) {
    if (json == null) { DURROSTER = null; DURASOF = null; return null; }
    var d = typeof json === "string" ? JSON.parse(json) : json, r = d.roster || d, out = {};
    for (var s in r) {
      var x = r[s];
      if (x && (x.chin_re != null || x.pow_re != null)) out[s] = { chin_re: x.chin_re, pow_re: x.pow_re, chin_cov: x.chin_cov, pow_cov: x.pow_cov };
    }
    DURROSTER = out;
    DURASOF = (d.meta && d.meta.snapshot) || d.asof || null;
    return { n: Object.keys(out).length, asof: DURASOF };
  }
  function durCovariates(dp, prof, age, date) {
    // chin and power covariate multipliers vs the reference profile (30 years old, no knockdowns absorbed, no KO losses)
    var T = dp.terms || {}, tm = function (k) { return T[k] != null ? +T[k] : 0; };
    var kol = +prof.ko_losses || 0, kolR = prof.ko_losses_365 != null ? +prof.ko_losses_365 : 0;
    var kda = +prof.kd_absorbed || 0, kdaR = prof.kd_absorbed_365 != null ? +prof.kd_absorbed_365 : 0;
    var kolO = Math.max(0, kol - kolR), kdaO = Math.max(0, kda - kdaR);
    var lc = 0, lp = 0;
    if (age != null && isFinite(age)) {
      var a30 = age - 30, h30 = Math.max(0, a30);
      lc += tm("d_age_c") * a30 + tm("d_age_h30") * h30;
      lp += tm("a_age_c") * a30 + tm("a_age_h30") * h30;
    } else if (!prof.manual) lc += tm("d_age_na");   // the data's "age unknown" (x2.22: obscure short-stint fighters); a hand-made profile without an age is the reference
    lc += tm("d_okd_r") * kdaR + tm("d_okd_o") * kdaO + tm("d_kol_r") * kolR + tm("d_kol_o") * kolO;
    // withdrawn first-version terms, kept as labeled knobs (all neutral by default; research/model_durability.md V4)
    var wd = dp.withdrawn || {};
    if (prof.layoff != null && isFinite(prof.layoff) && +prof.layoff >= 730 && wd.layoff24 != null) lc += Math.log(wd.layoff24);
    if (prof.last_ko_loss && wd.lastKO != null) lc += Math.log(wd.lastKO);
    if (prof.ufc_years != null && wd.ufcYear) lc += wd.ufcYear * (+prof.ufc_years - (wd.ufcYearRef || 0));
    return { chin: Math.exp(lc), pow: Math.exp(lp), kolR: kolR, kolO: kolO, kdaR: kdaR, kdaO: kdaO };
  }
  function durSide(m, prof, i, opts, dp, lvlDiv) {
    var rost = DURROSTER && prof.slug && DURROSTER[prof.slug] && (!DURASOF || !m.date || String(m.date) >= DURASOF) ? DURROSTER[prof.slug] : null;
    var od = opts.dur || null, rec = (od && od[SIDE[i]]) || prof.dur || rost || null;
    var age = m.ages ? m.ages[i] : ageAt(prof, m.date), cov = null, src = rec ? "record" : "computed";
    var chinCov = rec && rec.chin_cov != null ? +rec.chin_cov : null, powCov = rec && rec.pow_cov != null ? +rec.pow_cov : null;
    if (chinCov == null || powCov == null) {
      cov = durCovariates(dp, prof, age, m.date);
      if (chinCov == null) chinCov = cov.chin;
      if (powCov == null) powCov = cov.pow;
    }
    var chinRe = rec && rec.chin_re != null ? +rec.chin_re : null, powRe = rec && rec.pow_re != null ? +rec.pow_re : null;
    if ((chinRe == null || powRe == null) && dp.fallbackEB) {
      // walk-forward empirical Bayes from career sums (C, else the decayed S): opponent effects taken as 1 and 90% of
      // head strikes standing (research/model_durability.md section 1)
      var C = prof.C ? (Array.isArray(prof.C) ? (function () { var o = {}, ks = prof.keys || (DB && DB.meta && DB.meta.keys) || KEYS; for (var q = 0; q < ks.length; q++) o[ks[q]] = +prof.C[q] || 0; return o; })() : prof.C) : sums(prof);
      var sh = dp.standShare != null ? dp.standShare : 0.9;
      if (chinRe == null) chinRe = ((dp.alphaChin || 3) + (+C.okd || 0)) / ((dp.alphaChin || 3) + lvlDiv * chinCov * sh * (+C.oh_lnd || 0));
      if (powRe == null) powRe = ((dp.alphaPow || 2.5) + (+C.kd || 0)) / ((dp.alphaPow || 2.5) + lvlDiv * powCov * sh * (+C.h_lnd || 0));
    }
    if (chinRe == null) chinRe = 1;
    if (powRe == null) powRe = 1;
    return { src: src, age: age, chin_re: chinRe, pow_re: powRe, chin_cov: chinCov, pow_cov: powCov, cov: cov };
  }
  function applyDurability(m, pa, pb, opts) {
    var p = m.p, dp = p.durability || {}, i, j, k;
    var T = dp.terms || {}, tm = function (k2) { return T[k2] != null ? +T[k2] : 0; };
    var od = opts.dur || {};
    var dv = (p.div && p.div[m.division]) || {}, dvkd = dv.kd != null ? dv.kd : 1;
    var engLevel = m.L.kd0 * p.kdScale * dvkd;                         // the engine's own division level (v3 / v4 KD)
    // absolute mode (params.durability.level set): base = tracked league level x division x context, and the fit's
    // constant already prices the average chin x power, so no NORM on the knockdown hazard. Relative mode (level null):
    // base = the engine's own division level x context, with C x P divided by NORM (their league mean).
    var absMode = dp.level != null;
    var ctx = Math.exp(tm("five") * (m.rounds >= 5 ? 1 : 0) + tm("title") * (m.title ? 1 : 0));
    var lvl = absMode ? +dp.level : null;                              // league KD per landed standing head strike
    var lvlDiv = absMode ? lvl * Math.exp(tm("const") + tm("div_" + m.division)) : m.L.kd0;
    var base = absMode ? (od.base != null && isFinite(od.base) ? +od.base : lvlDiv * ctx) : engLevel * ctx;
    var norm = (dp.normChin != null ? dp.normChin : 1) * (dp.normPow != null ? dp.normPow : 1);
    var normK = absMode ? 1 : norm;
    var w = dp.engineWeight != null ? clip(+dp.engineWeight, 0, 1) : 0;
    var cExp = dp.chinExp != null ? +dp.chinExp : 1, pExp = dp.powExp != null ? +dp.powExp : 1;
    var kdCal = absMode ? (dp.kdCal != null ? +dp.kdCal : 1) : (dp.kdCalRel != null ? +dp.kdCalRel : 1);
    var sd = [durSide(m, pa, 0, opts, dp, lvlDiv), durSide(m, pb, 1, opts, dp, lvlDiv)];
    var up = [0, 0];
    for (i = 0; i < 2; i++) {
      var hl = m.homeLbs ? m.homeLbs[i] : null;
      up[i] = (m.fightLbs && hl) ? Math.max(0, m.fightLbs - hl) / 10 : 0;
    }
    var koF = dv.ko != null ? dv.ko : 1;
    var engKd = m.kd.slice(), rel = [0, 0], relK = [0, 0], engRel = [0, 0], powRel = [0, 0];
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var C = Math.pow(sd[j].chin_cov * sd[j].chin_re, cExp) * Math.exp((dp.sizeChin || 0) * up[j]);
      var P = Math.pow(sd[i].pow_cov * sd[i].pow_re, pExp) * Math.exp(-(dp.sizePow || 0) * up[i]);
      var cp = C * P * m.adj[i].pow * m.adj[j].chin;
      engRel[i] = engKd[i] / engLevel;
      rel[i] = w > 0 ? Math.pow(cp / norm, 1 - w) * Math.pow(engRel[i], w) : cp / norm;     // mean about 1: TKO hazards, damage
      relK[i] = w > 0 ? Math.pow(cp / normK, 1 - w) * Math.pow(engRel[i], w) : cp / normK;  // knockdown hazard
      var pd = P / (dp.normPow != null ? dp.normPow : 1) * m.adj[i].pow, pe = m.fac && m.fac[i] ? m.fac[i].pow : 1;
      powRel[i] = w > 0 ? Math.pow(pd, 1 - w) * Math.pow(pe, w) : pd;
    }
    for (i = 0; i < 2; i++) {
      m.kd[i] = kdCal * (absMode ? p.kdScale : 1) * base * relK[i];
      m.dw[i] = Math.pow(powRel[i], p.powDmgExp);
      m.gnp[i] = p.gnpTko * Math.sqrt(rel[i]) * koF * (dp.gnpCal != null ? dp.gnpCal : 1);
      m.stko[i] = p.stko * Math.sqrt(rel[i]) * koF * (dp.stkoCal != null ? dp.stkoCal : 1);
    }
    if (dp.caution5 != null && m.rounds >= 5) {
      for (k = 0; k < m.rounds; k++) m.finR[k] = (k === 0 ? p.r1Caution5 : 1) * dp.caution5;
    }
    function pub(s) {
      var o = { src: s.src, age: s.age, chin_re: s.chin_re, chin_cov: s.chin_cov, pow_re: s.pow_re, pow_cov: s.pow_cov,
        chin: s.chin_cov * s.chin_re, pow: s.pow_cov * s.pow_re };
      if (s.cov) { o.ko_losses_365 = s.cov.kolR; o.ko_losses_older = s.cov.kolO; o.kd_absorbed_365 = s.cov.kdaR; o.kd_absorbed_older = s.cov.kdaO; }
      return o;
    }
    m.dur = { A: pub(sd[0]), B: pub(sd[1]), mode: absMode ? "absolute" : "relative", level: lvl, base: base, baseFromRecord: absMode && od.base != null,
      ctx: ctx, norm: norm, w: w, kdCal: kdCal, rel: rel, relK: relK, engRel: engRel, engKd: engKd, engLevel: engLevel, lbsUp: up };
    return m;
  }
  function matchup(profA, profB, opts) {
    opts = opts || {};
    var m = matchupML(profA, profB, opts);
    if (m.p.components && m.p.components.durability) applyDurability(m, resolve(profA), resolve(profB), opts);
    return m;
  }

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
  // the panel's view beyond the counts persists from round to round), with the EM round-winner weights (components.v401.emJudge:
  // refit on the 5,519 ufcstats cards of 2015-2023 only, tools/judge_em_train.py; off: v4.0.0's fit on all 7,550 cards
  // through 2026-10, research/data_baserates.md):
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

  // ------------------------------------------------------------------ point deductions (v4.0.1; v5: components.v401.deductions)
  // Fouls cost points on all three cards: in each round each fighter is docked with probability J.ded (1 point, 2 with
  // probability J.ded2; tools/judgecal.js on 2019-2023 decision rounds: 0.5% per fighter-round, 3.1% of decisions).
  // They are drawn once the last round is over and only for fights that go to the cards, so every earlier draw of the
  // fight is unchanged (common random numbers with v4.0.0 up to the decision) and a finished fight never consumes them.
  // rounds (trace) gets rec.ded = [A, B] and the per-round judges' scores lose the points, so the round cards still add
  // up to fight.cards. Returns the points deducted. With J.ded 0 (the sub-flag off) it draws nothing.
  function deductions(J, nR, rng, cards, rounds) {
    var pd = J.ded || 0;
    if (!(pd > 0)) return 0;
    var p2 = J.ded2 || 0, n = 0;
    for (var r = 0; r < nR; r++) for (var i = 0; i < 2; i++) {
      if (rng.u() >= pd) continue;
      var pts = rng.u() < p2 ? 2 : 1, j;
      n += pts;
      for (j = 0; j < 3; j++) cards[j][i] -= pts;
      var rec = rounds && rounds[r];
      if (rec) {
        if (rec.judges) for (j = 0; j < rec.judges.length; j++) rec.judges[j][i] -= pts;
        if (!rec.ded) rec.ded = [0, 0];
        rec.ded[i] += pts;
      }
    }
    return n;
  }

  // ------------------------------------------------------------------ officials (roadmap v8; params.components.officials)
  // Named judges and referee with tendencies fit walk-forward on real rounds and stoppages (tools/officials_engine.py,
  // data/derived/officials_engine.json; FightEngine.loadOfficials). Off (components.officials falsy): m.off = null and
  // the engine is bit-for-bit the v4 engine. On: each judge j scores a round by
  //   eta_j = exp(n_j) * (exp(v_j) V + exp(k_j) K + exp(g_j) G + u) + e_j,   u ~ N(0, sigmaU^2) shared by the panel (a share
  //   sharedFight of its variance drawn once per fight, the rest per round), e_j ~ Logistic(0, 1)
  //   V = head dHead + body dBody + leg dLeg;  G = td dTD + ctrlMin dCtrl/60 + sub dSubAtt + rev dRev;  x = V + kd dKD + G;
  //   K = kd dKD + head (hurt (dHurt - aH x) + judgePower (dPow - aP x)): the engine-only hurt / power terms enter only as
  //   their residual on the count index, and its variance comes out of the round part of u (the real panel's shared noise
  //   already holds what judges see beyond the counts; params.officials.engAdj, tools/officials_engcal.js);
  //   A - B differentials; 10-8 for the winner W with P = sigmoid(c0 + c_j + thV V_W + thK K_W +
  //   thG G_W + eps), eps ~ N(0, sigmaE^2) shared; 10-10 with P = p1010. The referee multiplies the follow-up stoppage odds
  //   after a knockdown (kdf), the standing-TKO hazard (stko) and the ground-and-pound TKO hazard (gnp).
  // Officials: opts.judges = [names or keys] (or { names, power }), opts.referee = name; opts.judgePool = [[key, weight]...]
  // to sample judges from (an event's judges); unknown or unnamed judges / referee are drawn from the table's recent
  // pool, and a judge or referee not in the table gets effects drawn from the population (tau). opts.officials: a
  // table set (officials_engine.json) to use instead of the loaded one, or false for league judging without tables.
  // RNG: the main stream sees exactly the v4 draw count (9 + 1 normals at the start, 1 + 3 normals per judged round, the
  // same stoppage draws), so flag-on and flag-off fights with one seed stay on the same path until officials differ;
  // judge picks and 10-8 / 10-10 draws use a second stream seeded from the start-of-fight normals.
  var OFFTAB = null;
  function nameKey(s) { return String(s == null ? "" : s).toLowerCase().replace(/[^a-z]/g, ""); }
  function loadOfficials(json) {
    if (json == null) { OFFTAB = null; return null; }
    var d = typeof json === "string" ? JSON.parse(json) : json;
    if (!d || !d.tables) throw new Error("FightEngine.loadOfficials: expected officials_engine.json with tables");
    OFFTAB = d;
    return d;
  }
  // the table for a fight date: the latest table year <= the fight's year (table Y is fit only on fights before Y);
  // null when the date precedes every table (no leak from later fits); no date -> the latest (production) table
  function officialsTableFor(set, date) {
    if (!set || !set.tables) return null;
    var ys = Object.keys(set.tables).map(Number).filter(isFinite).sort(function (a, b) { return a - b; });
    if (!ys.length) return null;
    var y = date ? +String(date).slice(0, 4) : ys[ys.length - 1], pick = null;
    for (var i = 0; i < ys.length; i++) if (ys[i] <= y) pick = ys[i];
    return pick == null ? null : set.tables[String(pick)];
  }
  function officialsFor(p, opts, m) {
    if (!(p.components && p.components.officials)) return null;
    var O = p.officials || {}, set = opts.officials === false ? null : (opts.officials && opts.officials.tables ? opts.officials : OFFTAB);
    var tab = opts.officials && opts.officials.league && opts.officials.judges ? opts.officials : officialsTableFor(set, m.date);
    var lg = (tab && tab.league) || O, b = lg.beta || O.beta, t8 = lg.ten8 || O.ten8, tau = lg.tau || O.tau;
    var perJ = O.perJudge !== false, useRef = O.referee !== false;
    var aliases = (set && set.aliases) || {}, jt = (tab && tab.judges) || {}, rt = (tab && tab.referees) || {};
    function jEff(key) { var r = jt[key]; return r ? [r[1], r[2], r[3], r[4], r[5]] : null; }
    function jKey(nm) {
      if (nm == null) return null;
      var s = String(nm);
      if (jt[s]) return s;
      var k = aliases[nameKey(s)];
      return k && jt[k] ? k : null;
    }
    var jl = Array.isArray(opts.judges) ? opts.judges : (opts.judges && Array.isArray(opts.judges.names) ? opts.judges.names : []);
    var slots = [];
    for (var i = 0; i < 3; i++) {
      var nm = jl[i];
      if (nm == null || nm === "") { slots.push(null); continue; }
      var key = jKey(nm), eff = key ? jEff(key) : null;
      slots.push({ name: key ? jt[key][0] : String(nm), key: key, eff: eff });     // eff null = not in the table: drawn from tau
    }
    // judge pool for unnamed slots: the given pool (an event's judges), else the table's recent pool
    var pool = [], src = Array.isArray(opts.judgePool) && opts.judgePool.length ? opts.judgePool : ((tab && tab.pool) || []), wsum = 0;
    for (i = 0; i < src.length; i++) {
      var e = src[i], kk = Array.isArray(e) ? e[0] : e, w = Array.isArray(e) ? +e[1] : 1;
      if (!(w > 0)) continue;
      var k2 = kk === "_other" ? null : jKey(kk);
      pool.push({ key: k2, name: k2 ? jt[k2][0] : (kk === "_other" ? null : String(kk)), eff: k2 ? jEff(k2) : null, w: w });
      wsum += w;
    }
    // referee: named (table multipliers; unknown -> population draw), else the table's pool
    var ref = null, rpool = [], rsum = 0, rnm = opts.referee;
    if (rnm != null && rnm !== "") {
      var rk = rt[rnm] ? rnm : null;
      if (!rk) { var nk = nameKey(rnm); for (var rr in rt) if (nameKey(rr) === nk) { rk = rr; break; } }
      ref = { name: rk || String(rnm), mult: rk ? [rt[rk][0], rt[rk][1], rt[rk][2]] : null };
    } else if (tab && tab.ref_pool) {
      for (i = 0; i < tab.ref_pool.length; i++) {
        var re0 = tab.ref_pool[i], rk2 = re0[0] !== "_other" && rt[re0[0]] ? re0[0] : null;
        rpool.push({ name: rk2, mult: rk2 ? [rt[rk2][0], rt[rk2][1], rt[rk2][2]] : null, w: +re0[1] });
        rsum += +re0[1];
      }
    }
    var rl = (tab && tab.ref_league) || {}, rtau = O.refTau || {};
    // engine-only terms (hurts, power beyond the count) enter as their residual on the count index; their residual
    // variance comes out of the round part of the shared noise and (x thK^2) out of the 10-8 shared noise
    var sigU0 = lg.sigmaU != null ? lg.sigmaU : O.sigmaU, rhoF = clip(lg.sharedFight != null ? +lg.sharedFight : (O.sharedFight || 0), 0, 0.95);
    var hurtHS = O.hurtHS != null ? O.hurtHS : p.judge.hurt / p.judge.head, ea = O.engAdj || null, aH = 0, aP = 0, varR = 0;
    if (ea) {
      aH = ea.aH || 0; aP = ea.aP || 0;
      varR = b.head * b.head * (hurtHS * hurtHS * (ea.vHH || 0) + 2 * hurtHS * m.judgePower * (ea.vHP || 0) + m.judgePower * m.judgePower * (ea.vPP || 0));
    }
    var sigR = Math.sqrt(Math.max(0.05, (1 - rhoF) * sigU0 * sigU0 - varR)), sigF = Math.sqrt(rhoF) * sigU0;
    var sigE = Math.sqrt(Math.max(0.05, t8.sigmaE * t8.sigmaE - t8.thK * t8.thK * varR));
    function rtauOf(u) { return rl[u] && rl[u].tau != null ? +rl[u].tau : (rtau[u] || 0); }
    return {
      table: !!tab, perJudge: perJ, useRef: useRef,
      beta: [b.head, b.body, b.leg, b.kd, b.td, b.ctrlMin, b.sub, b.rev || 0], sigU: sigU0, rhoF: rhoF, sigF: sigF, sigR: sigR,
      hurtHS: hurtHS, jp: m.judgePower, aH: aH, aP: aP, varR: varR,
      t8: [t8.c0, t8.thV, t8.thK, t8.thG, sigE], p1010: lg.p1010 != null ? lg.p1010 : (O.p1010 || 0),
      tau: [tau.n || 0, tau.v || 0, tau.k || 0, tau.g || 0, tau.c || 0], slots: slots, pool: pool, wsum: wsum,
      ref: ref, rpool: rpool, rsum: rsum, rtau: [rtauOf("kdf"), rtauOf("stko"), rtauOf("gnp")]
    };
  }
  // one fight's officials: three judges' effects [n, v, k, g, c], referee multipliers [kdf odds, stko, gnp], second RNG
  function officialsFight(off, zs) {
    var h = 2166136261;
    for (var q = 0; q < zs.length; q++) { h = Math.imul(h ^ ((Math.floor((zs[q] + 16) * 268435456) >>> 0)), 16777619) >>> 0; }
    var r2 = makeRng(h), tau = off.tau, sel = [], names = [], used = {}, i;
    function draw() { return [tau[0] * r2.normal(), tau[1] * r2.normal(), tau[2] * r2.normal(), tau[3] * r2.normal(), tau[4] * r2.normal()]; }
    for (i = 0; i < 3; i++) {
      var s = off.slots[i], eff = null, nm = null;
      if (s) { eff = s.eff || draw(); nm = s.name; if (s.key) used[s.key] = 1; }
      else if (off.pool.length && off.wsum > 0) {
        for (var tries = 0; tries < 8; tries++) {
          var u = r2.u() * off.wsum, e = 0;
          while (e < off.pool.length - 1 && u >= off.pool[e].w) { u -= off.pool[e].w; e++; }
          var pe = off.pool[e];
          if (pe.key && used[pe.key] && tries < 7) continue;
          if (pe.key) used[pe.key] = 1;
          eff = pe.eff || draw(); nm = pe.name; break;
        }
      } else eff = draw();
      if (!off.perJudge) eff = [0, 0, 0, 0, 0];
      sel.push(eff); names.push(nm);
    }
    var mult = [1, 1, 1], rname = null;
    if (off.ref) { rname = off.ref.name; mult = off.ref.mult || [Math.exp(off.rtau[0] * r2.normal()), Math.exp(off.rtau[1] * r2.normal()), Math.exp(off.rtau[2] * r2.normal())]; }
    else if (off.rpool.length && off.rsum > 0) {
      var ur = r2.u() * off.rsum, er = 0;
      while (er < off.rpool.length - 1 && ur >= off.rpool[er].w) { ur -= off.rpool[er].w; er++; }
      var rp = off.rpool[er];
      rname = rp.name;
      mult = rp.mult || [Math.exp(off.rtau[0] * r2.normal()), Math.exp(off.rtau[1] * r2.normal()), Math.exp(off.rtau[2] * r2.normal())];
    }
    if (!off.useRef) mult = [1, 1, 1];
    return { sel: sel, names: names, ref: mult, refName: rname, r2: r2 };
  }
  // standard normal CDF (Cody-style rational erfc, |error| < 1.2e-7) and the exact Logistic(0, 1) draw from a normal
  function ncdf(z) {
    var x = Math.abs(z) / Math.SQRT2, t = 1 / (1 + 0.5 * x);
    var y = t * Math.exp(-x * x - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 +
      t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
    return z >= 0 ? 1 - 0.5 * y : 0.5 * y;
  }
  function logisticOf(z) { var u = clip(ncdf(z), 1e-15, 1 - 1e-15); return Math.log(u / (1 - u)); }
  // one judged round under the officials model; draws 1 + 3 normals from rng (as judgeRound) and the rest from OF.r2
  function officialsRound(off, OF, uF, dHL, dBL, dLL, dKd, dTd, dCtrl, dSub, dRev, dHu, dPow, rng, cards, js) {
    var b = off.beta, t8 = off.t8;
    var V = b[0] * dHL + b[1] * dBL + b[2] * dLL;
    var G = b[4] * dTd + b[5] * dCtrl / 60 + b[6] * dSub + b[7] * dRev;
    var x = V + b[3] * dKd + G;                                       // count index; engine-only terms enter as their residual on it
    var Kx = b[3] * dKd + b[0] * (off.hurtHS * (dHu - off.aH * x) + off.jp * (dPow - off.aP * x));
    var u = (uF || 0) + off.sigR * rng.normal(), r2 = OF.r2, eps = t8[4] * r2.normal(), n108 = 0;
    for (var j = 0; j < 3; j++) {
      var e = logisticOf(rng.normal()), ef = OF.sel[j];
      var eta = Math.exp(ef[0]) * (Math.exp(ef[1]) * V + Math.exp(ef[2]) * Kx + Math.exp(ef[3]) * G + u) + e;
      var scA, scB;
      if (r2.u() < off.p1010) { scA = 10; scB = 10; }
      else {
        var sg = eta > 0 ? 1 : -1;
        var big = r2.u() < sigm(t8[0] + ef[4] + sg * (t8[1] * V + t8[2] * Kx + t8[3] * G) + eps);
        scA = sg > 0 ? 10 : (big ? 8 : 9); scB = sg > 0 ? (big ? 8 : 9) : 10;
        if (big) n108++;
      }
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
    var DY = m.dyn;                              // fight-dynamics tables (component "dynamics"), null when off
    // fight-night form (fixed draw order, independent of trace)
    // every multiplicative draw is a mean-1 lognormal: exp(sd * z - sd^2 / 2)
    var sharedPace = lnorm(rng, DY ? DY.formPace : F.pace);
    var vol = lnorm(rng, DY ? DY.vol : F.vol);   // shared fight volatility: a war vs a tactical fight
    var fOut = [1, 1], fAcc = [1, 1], fPow = [1, 1], fChin = [1, 1], fCard = [1, 1], fGrap = [1, 1], fSubO = [1, 1], fSubD = [1, 1];
    for (i = 0; i < 2; i++) {
      fOut[i] = lnorm(rng, DY ? DY.formOut : F.out); fAcc[i] = Math.exp((DY ? DY.formAcc : F.acc) * rng.normal());   // accuracy: logit-normal (odds multiplier)
      fPow[i] = lnorm(rng, F.pow); fChin[i] = lnorm(rng, F.chin);
      fCard[i] = lnorm(rng, F.cardio); fGrap[i] = lnorm(rng, F.grap);
      fSubO[i] = lnorm(rng, F.sub); fSubD[i] = lnorm(rng, F.sub);
    }
    var subK = [fSubO[0] * fSubD[1], fSubO[1] * fSubD[0]], subKs = [Math.sqrt(subK[0]), Math.sqrt(subK[1])];
    var tS = [1, 1, 1], tG = [1, 1, 1], tP = [1, 1, 1], OF = null;
    if (m.off) { var zs = []; for (j = 0; j < 9; j++) zs.push(rng.normal()); OF = officialsFight(m.off, zs); }   // officials: same 9 draws
    else for (j = 0; j < 3; j++) { tS[j] = lnorm(rng, J.tasteSd); tG[j] = lnorm(rng, J.tasteSd); tP[j] = lnorm(rng, J.tasteSd); }
    var zF = rng.normal(), jF = J.sharedSd * Math.sqrt(J.sharedFight || 0) * zF;   // judges' fight-level shared view (always drawn: fixed draw order)
    var offUF = OF ? m.off.sigF * zF : 0;                                       // officials: the panel's fight-level shared view (same draw)
    var kdB = [m.kd[0] * fPow[0] * fChin[1] * vol, m.kd[1] * fPow[1] * fChin[0] * vol];
    var dw = [m.dw[0] * Math.pow(fPow[0], K.powDmgExp), m.dw[1] * Math.pow(fPow[1], K.powDmgExp)];
    var pcF = [Math.sqrt(fPow[0] * fChin[1] * vol), Math.sqrt(fPow[1] * fChin[0] * vol)];
    var gnpB = [m.gnp[0] * pcF[0], m.gnp[1] * pcF[1]], stkoB = [m.stko[0] * pcF[0], m.stko[1] * pcF[1]];
    var drain = [m.drain[0] * fCard[0], m.drain[1] * fCard[1]];
    var gR = [fGrap[0] / fGrap[1], fGrap[1] / fGrap[0]];
    var gRs = [Math.sqrt(gR[0]), Math.sqrt(gR[1])];
    var tdO = [m.tdO[0] * gR[0], m.tdO[1] * gR[1]], tdOC = [m.tdOC[0] * gR[0], m.tdOC[1] * gR[1]];
    var instO = m.instO, refO = m.refO;
    if (OF) { refO *= OF.ref[0]; stkoB[0] *= OF.ref[1]; stkoB[1] *= OF.ref[1]; gnpB[0] *= OF.ref[2]; gnpB[1] *= OF.ref[2]; }
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
    if (OF) fight.officials = { judges: OF.names.slice(), referee: OF.refName, refMult: OF.ref.slice() };
    var po = [0, 0], fin = null;
    // dynamics state: fA = accuracy odds multiplier used by strikes (the fight-level form when off); dc / tdc = distance
    // output and takedown-attempt carry-over; arO / arA = AR(1) round noise on output / accuracy; mom* = knockdown momentum
    var fA = DY ? [fAcc[0], fAcc[1]] : fAcc, dc = [1, 1], tdc = [1, 1];
    var arO = [0, 0], arA = [0, 0], momO = [1, 1], momA = [1, 1], momT = [1, 1];

    for (var r = 0; r < nR; r++) {
      for (k = 0; k < 2 * NS; k++) st[k] = 0;
      var t = 0, state = 0, ctl = -1, pos = 0, downed = -1, kdLoc = 0;
      var ev = trace ? [] : null;
      var rp = sharedPace * lnorm(rng, DY ? DY.roundPace : F.roundPace);
      if (DY) {
        // E2: each man's round output noise is AR(1) (stationary sd arSd, autocorrelation arPhi); the same two normals
        // the plain engine spends on its iid round noise, then two more for the accuracy AR(1)
        var zo0 = rng.normal(), zo1 = rng.normal(), za0 = rng.normal(), za1 = rng.normal();
        if (r === 0) { arO[0] = DY.arSd * zo0; arO[1] = DY.arSd * zo1; arA[0] = DY.accArSd * za0; arA[1] = DY.accArSd * za1; }
        else {
          arO[0] = DY.arPhi * arO[0] + DY.arInn * zo0; arO[1] = DY.arPhi * arO[1] + DY.arInn * zo1;
          arA[0] = DY.accArPhi * arA[0] + DY.accArInn * za0; arA[1] = DY.accArPhi * arA[1] + DY.accArInn * za1;
        }
        for (i = 0; i < 2; i++) {
          po[i] = DY.pace[i][r] * fOut[i] * rp * Math.exp(arO[i] - DY.arC) * momO[i];
          fA[i] = fAcc[i] * Math.exp(arA[i]) * DY.accLevel * momA[i];
          // E6: grappling carry-over from earlier rounds (minutes controlled by the opponent, takedowns landed, own control)
          var oc = tot[(1 - i) * NS + I_CTRL] / 60, ocw = tot[i * NS + I_CTRL] / 60, otl = tot[i * NS + I_TDL];
          dc[i] = Math.exp(DY.distCtrlOpp * oc);
          tdc[i] = Math.exp(DY.tdCtrlOpp * oc + DY.tdTdl * otl + DY.tdCtrlOwn * ocw) * momT[i] * DY.tdLevel * DY.tdR[r];
        }
      } else {
        po[0] = m.pace[0][r] * fOut[0] * rp * lnorm(rng, F.roundOut);
        po[1] = m.pace[1][r] * fOut[1] * rp * lnorm(rng, F.roundOut);
      }
      var fr = m.finR[r], kdP = DY ? DY.kdP[r] : m.kdPace[r] * fr;

      while (true) {
        var h0 = t < hurtEnd[0], h1 = t < hurtEnd[1];
        var mob0 = 1 - G[0] / legScale; if (mob0 < legFloor) mob0 = legFloor;
        var mob1 = 1 - G[1] / legScale; if (mob1 < legFloor) mob1 = legFloor;
        var out0 = po[0] * (1 - K.outStam * (1 - S[0])) * (h0 ? K.outHurt : 1) * (1 - K.outMob * (1 - mob0));
        var out1 = po[1] * (1 - K.outStam * (1 - S[1])) * (h1 ? K.outHurt : 1) * (1 - K.outMob * (1 - mob1));
        var n = 0, top = -1, bot = -1, k5 = 0;
        if (state === 0) {
          evT[n] = E_STRIKE; evW[n] = 0; evX[n] = 0; evR[n++] = dRate[0] * out0 * dc[0];
          evT[n] = E_STRIKE; evW[n] = 1; evX[n] = 0; evR[n++] = dRate[1] * out1 * dc[1];
          evT[n] = E_CLINCH; evW[n] = 0; evX[n] = 0; evR[n++] = clE * pCtl;
          evT[n] = E_CLINCH; evW[n] = 1; evX[n] = 0; evR[n++] = clE * (1 - pCtl);
          evT[n] = E_TD; evW[n] = 0; evX[n] = 0; evR[n++] = tdD[0] * (1 - K.tdAttStam * (1 - S[0])) * (h0 ? 0.5 : 1) * tdc[0];
          evT[n] = E_TD; evW[n] = 1; evX[n] = 0; evR[n++] = tdD[1] * (1 - K.tdAttStam * (1 - S[1])) * (h1 ? 0.5 : 1) * tdc[1];
        } else if (state === 1) {
          var cs = K.clinchCtrlStrike;
          evT[n] = E_STRIKE; evW[n] = 0; evX[n] = 1; evR[n++] = cRate[0] * out0 * (ctl === 0 ? cs : 2 - cs);
          evT[n] = E_STRIKE; evW[n] = 1; evX[n] = 1; evR[n++] = cRate[1] * out1 * (ctl === 1 ? cs : 2 - cs);
          evT[n] = E_BREAK; evW[n] = 1 - ctl; evX[n] = 0; evR[n++] = clBreak;
          evT[n] = E_SWAP; evW[n] = 1 - ctl; evX[n] = 0; evR[n++] = clSwap * 2 * (ctl === 0 ? 1 - pCtl : pCtl);
          evT[n] = E_TD; evW[n] = ctl; evX[n] = 1; evR[n++] = tdCC[ctl] * (1 - K.tdAttStam * (1 - S[ctl])) * tdc[ctl];
          evT[n] = E_TD; evW[n] = 1 - ctl; evX[n] = 1; evR[n++] = tdCU[1 - ctl] * (1 - K.tdAttStam * (1 - S[1 - ctl])) * tdc[1 - ctl];
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
            o = accO[(i * 4 + pc) * 3 + tg] * fA[i] * (1 - K.accSelfStam * (1 - S[i])) * (hj ? K.accHurt : 1) * (1 + K.accStam * (1 - S[j]));
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
              // dynamics E7/E11: per-strike knockdown risk by round only (no damage, stamina or pace terms)
              var pk = DY ? kdB[i] * kdPos[pc] * chinM[j] * (hj ? K.kdHurt : 1) * kdP * (0.75 + 0.25 * mobi)
                : kdB[i] * kdPos[pc] * chinM[j] * (1 + D[j] / K.kdDmg) * (hj ? K.kdHurt : 1) * (1 + K.kdStamDef * (1 - S[j])) *
                Math.max(0.05, 1 - K.kdStamAtt * (1 - S[i])) * kdP * (0.75 + 0.25 * mobi);
              var uk = rng.u();
              if (uk < pk) kind = "kd";
              else if (uk < pk * (1 + K.hurtRatio)) kind = "hurt";
              else if (hj) { if (rng.u() < stkoB[i] * chinM[j] * (DY ? (DY.stkoBase + D[j] / 100) * DY.stkoR[r] : (K.stkoBase + D[j] / 100))) { kind = "fin"; finHow = "TKO"; } }
            } else if (pc === 2) {
              if (follow) {
                var ro = DY ? refO * chinM[j] * DY.conv[r] : refO * chinM[j] * (1 + D[j] / K.refDmg) * Math.max(0.05, 1 - K.finStamAtt * (1 - S[i]));
                if (rng.u() < ro / (1 + ro)) { kind = "fin"; finHow = "TKO"; }
              } else if (rng.u() < (DY ? gnpB[i] * gnpTkoPos[pos] * (1 + D[j] / DY.gnpDmg) * (hj ? K.gnpHurt : 1) * chinM[j] * fr * DY.gnpR[r]
                : gnpB[i] * gnpTkoPos[pos] * (1 + D[j] / K.gnpDmg) * (hj ? K.gnpHurt : 1) * chinM[j] * fr * Math.max(0.05, 1 - K.finStamAtt * (1 - S[i])))) { kind = "fin"; finHow = "GNP"; }
            }
          } else if (tg === 1) {
            S[j] -= K.bodyDrain * dw[i]; if (S[j] < 0.05) S[j] = 0.05;
            if (pc <= 1) {
              st[so + I_SBL]++;
              if (rng.u() < (DY ? kdB[i] * K.kdBodyRatio * kdPos[pc] * kdP : kdB[i] * K.kdBodyRatio * kdPos[pc] * (1 + K.kdStamDef * (1 - S[j])) * kdP)) kind = "kd";
            }
          } else {
            G[j] += dw[i];
            if (pc <= 1) st[so + I_SLL]++;
            if (pc === 0 && G[j] > K.legTko0 && rng.u() < K.legTko * (G[j] - K.legTko0) / 10) { kind = "fin"; finHow = "LEG"; }
          }
          if (kind === "kd") {
            st[so + I_KD]++; kdN[j]++; D[j] += K.dmgKD; chinM[j] *= K.kdRepeat;
            var io = DY ? instO * DY.conv[r] : instO * (1 + D[j] / K.kdInstantDmg) * (1 - K.instStam * (1 - S[i]));
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
      var cpre = DY && DY.lostAcc !== 1 ? [cards[0][0] - cards[0][1], cards[1][0] - cards[1][1], cards[2][0] - cards[2][1]] : null;
      if (OF) n108 += officialsRound(m.off, OF, offUF, st[a0 + I_HL] - st[b0 + I_HL], st[a0 + I_BL] - st[b0 + I_BL], st[a0 + I_LL] - st[b0 + I_LL],
        st[a0 + I_KD] - st[b0 + I_KD], st[a0 + I_TDL] - st[b0 + I_TDL], st[a0 + I_CTRL] - st[b0 + I_CTRL], st[a0 + I_SUB] - st[b0 + I_SUB],
        st[a0 + I_REV] - st[b0 + I_REV], st[a0 + I_HURT] - st[b0 + I_HURT], (st[a0 + I_DMG] - st[a0 + I_HL]) - (st[b0 + I_DMG] - st[b0 + I_HL]), rng, cards, js);
      else n108 += judgeRound(J, m.judgePower, st[a0 + I_HL] - st[b0 + I_HL], st[a0 + I_BL] - st[b0 + I_BL], st[a0 + I_LL] - st[b0 + I_LL],
        st[a0 + I_KD] - st[b0 + I_KD], st[a0 + I_TDL] - st[b0 + I_TDL], st[a0 + I_CTRL] - st[b0 + I_CTRL], st[a0 + I_SUB] - st[b0 + I_SUB],
        st[a0 + I_HURT] - st[b0 + I_HURT], (st[a0 + I_DMG] - st[a0 + I_HL]) - (st[b0 + I_DMG] - st[b0 + I_HL]), tS, tG, tP, jF, rng, cards, js);
      if (trace) rec.judges = js;

      // ---- between rounds: recovery, doctor and corner stoppages
      if (r < nR - 1) {
        if (DY) {
          // dynamics E4: knockdown momentum for the next round only (the scorer eases off, the dropped man does not slow);
          // E5 (knob, default off): accuracy odds x lostAcc after a round lost on the majority of cards
          momO[0] = momO[1] = momA[0] = momA[1] = momT[0] = momT[1] = 1;
          for (i = 0; i < 2; i++) {
            if (st[i * NS + I_KD] > 0) {
              momO[i] *= DY.momScOut; momA[i] *= DY.momScAcc; momT[i] *= DY.momScTd;
              momO[1 - i] *= DY.momDrOut; momT[1 - i] *= DY.momDrTd;
            }
          }
          if (cpre) {
            var wA = 0;
            for (j = 0; j < 3; j++) if (cards[j][0] - cards[j][1] > cpre[j]) wA++;
            momA[wA >= 2 ? 1 : 0] *= DY.lostAcc;
          }
        }
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
    // ---- decision (point deductions first: drawn only now, see deductions(); fight.nDed only when they are on)
    if (J.ded > 0) fight.nDed = deductions(J, nR, rng, cards, rounds);
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
    var methods = {}, dist = 0, distA = 0, distB = 0, dec = { UD: 0, SD: 0, MD: 0, DRAW: 0 }, n108 = 0, nDed = 0, rndsJudged = 0, secs = 0;
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
        dist++; dec[f.method]++; secs += nR * 300; rndsJudged += nR; nDed += f.nDed || 0;
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
    var out = {
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
    if (m.p.judge && m.p.judge.ded > 0) out.dedPerDecision = nDed / Math.max(1, dist);   // v4.0.1 / v5 deductions: points per decision
    return out;
  }

  // ------------------------------------------------------------------ sensitivity (realism_sens component): tornado data
  var SENS_KEYS = ["out", "acc", "pow", "chin", "cardio", "tdAtt", "tdDef", "sub"];
  var SENS_LABEL = { out: "striking output", acc: "striking accuracy", pow: "knockdown power", chin: "chin (KD susceptibility)",
    cardio: "cardio (stamina drain)", tdAtt: "takedown attempts", tdDef: "takedown defense", sub: "submission threat",
    judgePower: "judges' credit for power" };
  var SENS_UP_GOOD = { out: 1, acc: 1, pow: 1, chin: -1, cardio: -1, tdAtt: 1, tdDef: 1, sub: 1 };   // knob up is good (1) / bad (-1) for him

  // Posterior sd of fighter i's key profile rates (log scale for rates, logit for probabilities) from the shrinkage
  // pseudo-counts: I = his events + prior strength x prior rate (the same k's matchup() shrinks with), times a per-stat
  // over-dispersion phi fit on 2019-2023 fights against the out-of-fold learned rates (tools/realism.js disp ->
  // params.realism.disp; 1 = Poisson / binomial):  sd(log rate) = sqrt(phi / I),  sd(logit p) = sqrt(phi / (n p (1 - p))).
  // pow / chin are scaled by the engine's exponents on the shrunk ratios (powExp, chinExp), so each sd is on the knob's scale.
  function rateSd(m, i) {
    var p = m.p, P = m.P, L = m.L, R = m.R[i], s = R.sums, ds = (p.realism && p.realism.disp) || {};
    function ph(k) { return ds[k] != null && isFinite(ds[k]) && ds[k] > 0 ? +ds[k] : 1; }
    var att = s.d_att + s.c_att + s.g_att, attP = p.kPM * (P.d_att + P.c_att + P.g_att);
    var nAcc = s.h_att + s.b_att + s.l_att, lnd = s.h_lnd + s.b_lnd + s.l_lnd;
    var accP = (P.h_lnd + P.b_lnd + P.l_lnd) / Math.max(1e-9, P.h_att + P.b_att + P.l_att);
    var nA = nAcc + p.kAcc, acc = clip((lnd + p.kAcc * accP) / nA, 0.02, 0.98), p0 = P.kd_per_h;
    var tdN = s.otd_att + p.kTdAcc, tdP = clip(R.tdAccAg, 0.02, 0.98);
    return {
      out: Math.sqrt(ph("att") / Math.max(1, att + attP)),
      acc: Math.sqrt(ph("acc") / Math.max(1, nA * acc * (1 - acc))),
      pow: (p.powExp != null ? p.powExp : 1) * Math.sqrt(ph("kd") / Math.max(0.25, s.kd + p.kKD * p0)),
      chin: (p.chinExp != null ? p.chinExp : 1) * Math.sqrt(ph("kd") / Math.max(0.25, s.okd + p.kKD * p0)),
      tdAtt: Math.sqrt(ph("td_att") / Math.max(0.25, s.td_att + p.kTdPM * L.stand * L.tdAtt)),
      tdDef: Math.sqrt(ph("td_acc") / Math.max(0.25, tdN * tdP * (1 - tdP))),
      sub: Math.sqrt(ph("sub_att") / Math.max(0.25, s.sub_att + p.kPM * L.ground * L.sub))
    };
  }
  // 1-sd sizes for the knob items: params.realism.knobSd, else the fight-night form sds (params.form), which already carry the
  // model error the walk-forward fit saw; judges' power is additive (default 0.25 = its own default value).
  function knobSd(p) {
    var F = p.form || {}, K = (p.realism && p.realism.knobSd) || {};
    function g(k, d) { return K[k] != null && isFinite(K[k]) ? +K[k] : d; }
    return { out: g("out", F.out || 0.15), acc: g("acc", F.acc || 0.12), pow: g("pow", F.pow || 0.3), chin: g("chin", F.chin || 0.3),
      cardio: g("cardio", F.cardio || 0.15), tdAtt: g("tdAtt", F.grap || 0.3), tdDef: g("tdDef", F.grap || 0.3), sub: g("sub", F.sub || 0.5),
      judgePower: g("judgePower", 0.25) };
  }

  // FightEngine.sensitivity(m, opts): the change in P(win) and in the method shares for -z / +z sd of each knob and of each
  // fighter's key profile rates (tornado data for the page). Every variant is rebuilt with the matchup's own options (same
  // division, priors, learned rates, knobs) and replays the same per-fight seeds (common random numbers: identical fight-night form
  // draws, so the differences carry far less Monte Carlo noise than the probabilities themselves).
  //   opts: { n: sims per variant (default 1000), seed (1), z (1), kinds: ["knob", "rate"], sides: ["A", "B"],
  //           keys: subset of ["out", "acc", "pow", "chin", "cardio", "tdAtt", "tdDef", "sub", "judgePower"],
  //           sd: { key: sd, A: { key: sd }, B: {...} } overrides, profA / profB (when m has none), onProgress(f) }
  //   Knob items scale adjA / adjB[key] by exp(-z sd) / exp(+z sd) (judges' power: -/+ z sd, floored at 0). Rate items move the
  //   same lever by the fighter's posterior sd (rateSd; rates without a profile estimate, cardio, are knob-only).
  //   Returns { n, seed, z, base: S, items: [{ id, key, side, kind, label, sd, mult: [lo, hi], upGood, lo: S, hi: S,
  //   dPA: [lo.pA - base.pA, hi.pA - base.pA], dPWin: (his P(win) at +z) - (at -z) signed to "good for him", swing }], ms },
  //   items sorted by swing = |hi.pA - lo.pA|; S = { pA, pB, pD, ko, sub, dec, bins[7], finA[r], finB[r] }.
  function sensitivity(m, opts) {
    opts = opts || {};
    var src = m._src || {}, profA = opts.profA || src.A, profB = opts.profB || src.B;
    if (!profA || !profB) throw new Error("FightEngine.sensitivity: no profiles on the matchup (build it with matchup() or pass opts.profA / opts.profB)");
    var N = opts.n || 1000, seed = opts.seed == null ? 1 : +opts.seed, z = opts.z == null ? 1 : +opts.z, t0 = Date.now();
    var kinds = opts.kinds || ["knob", "rate"], sides = opts.sides || ["A", "B"], keys = opts.keys || SENS_KEYS.concat(["judgePower"]);
    // v5 merge: variants rebuild through the public matchup (api.matchup), so the components that wrap it (styles_sos)
    // apply to every variant as they did to m; m from matchupBase alone rebuilds with matchupBase
    var mo = m.opts || {}, build = m.mlApplied === undefined ? matchupBase : (api && api.matchup) || matchup, ov = opts.sd || {};
    function r4(x) { return Math.round(x * 1e4) / 1e4; }
    // per-fight seeds: fight k of every variant starts from the same generator state, so one desynchronised fight (a hit
    // instead of a miss consumes extra draws) cannot desynchronise the rest, as one shared stream (summarize) would
    var seeds = new Array(N);
    for (var q = 0; q < N; q++) { var h = Math.imul((seed >>> 0) ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(q + 1, 0xc2b2ae35); h ^= h >>> 15; h = Math.imul(h, 0x27d4eb2d); seeds[q] = (h ^ (h >>> 13)) >>> 0; }
    function brief(mv) {
      var b = [0, 0, 0, 0, 0, 0, 0], nR = mv.rounds, fA = [], fB = [], w = new Int8Array(N), k;
      for (k = 0; k < nR; k++) { fA.push(0); fB.push(0); }
      for (k = 0; k < N; k++) {
        var f = simulate(mv, makeRng(seeds[k]), false), bk = bucket(f);
        b[bk]++; w[k] = bk < 3 ? 2 : (bk === 3 ? 1 : 0);
        if (!isDecision(f)) { if (f.winner === "A") fA[f.round - 1]++; else if (f.winner === "B") fB[f.round - 1]++; }
      }
      for (k = 0; k < 7; k++) b[k] /= N;
      var out = { pA: r4(b[0] + b[1] + b[2]), pB: r4(b[4] + b[5] + b[6]), pD: r4(b[3]), ko: r4(b[0] + b[6]), sub: r4(b[1] + b[5]),
        dec: r4(b[2] + b[3] + b[4]), bins: b.map(r4), finA: fA.map(function (x) { return r4(x / N); }), finB: fB.map(function (x) { return r4(x / N); }) };
      Object.defineProperty(out, "_w", { value: w, enumerable: false });   // per-fight A score (2 win, 1 draw, 0 loss), for paired se
      return out;
    }
    // Monte Carlo se of (y.pA - x.pA) from the per-fight paired differences (draws count half)
    function pairSe(x, y) {
      var s = 0, s2 = 0;
      for (var k = 0; k < N; k++) { var d = (y._w[k] - x._w[k]) / 2; s += d; s2 += d * d; }
      var mu = s / N; return Math.sqrt(Math.max(0, s2 / N - mu * mu) / N);
    }
    function sdOf(side, key, d) {
      if (side && ov[side] && ov[side][key] != null) return +ov[side][key];
      return ov[key] != null && typeof ov[key] !== "object" ? +ov[key] : d;
    }
    var ks = knobSd(m.p), rs = [rateSd(m, 0), rateSd(m, 1)], specs = [];
    kinds.forEach(function (kind) {
      keys.forEach(function (key) {
        if (key === "judgePower") { if (kind === "knob") specs.push({ key: key, side: null, kind: kind, sd: sdOf(null, key, ks.judgePower) }); return; }
        if (SENS_UP_GOOD[key] == null) return;
        sides.forEach(function (sd0) {
          var i = sd0 === "B" ? 1 : 0, v = kind === "knob" ? ks[key] : rs[i][key];
          if (v == null || !isFinite(v)) return;
          specs.push({ key: key, side: SIDE[i], kind: kind, sd: sdOf(SIDE[i], key, v) });
        });
      });
    });
    var total = 1 + 2 * specs.length, done = 0;
    function tick() { done++; if (opts.onProgress) opts.onProgress(done / total); }
    var base = brief(m); tick();
    var items = specs.map(function (sp) {
      var res = [null, null], mult = [1, 1];
      for (var d = 0; d < 2; d++) {
        var sg = d === 0 ? -1 : 1, o = {}, k;
        for (k in mo) o[k] = mo[k];
        o.adjA = {}; for (k in (mo.adjA || {})) o.adjA[k] = mo.adjA[k];
        o.adjB = {}; for (k in (mo.adjB || {})) o.adjB[k] = mo.adjB[k];
        if (Array.isArray(mo.judges)) o.judges = { names: mo.judges.slice() };   // v5 merge: officials names (engine3.js officialsFor)
        else { o.judges = {}; for (k in (mo.judges || {})) o.judges[k] = mo.judges[k]; }
        if (sp.key === "judgePower") { mult[d] = Math.max(0, m.judgePower + sg * z * sp.sd); o.judges.power = mult[d]; }
        else {
          var ak = sp.side === "A" ? "adjA" : "adjB", cur = m.adj[sp.side === "A" ? 0 : 1][sp.key];
          mult[d] = Math.exp(sg * z * sp.sd); o[ak][sp.key] = cur * mult[d];
        }
        res[d] = brief(build(profA, profB, o)); tick();
      }
      var up = sp.key === "judgePower" ? 0 : SENS_UP_GOOD[sp.key];
      var pw0 = sp.side === "B" ? res[0].pB : res[0].pA, pw1 = sp.side === "B" ? res[1].pB : res[1].pA;
      return { id: (sp.side ? sp.side + "." : "") + sp.key + "." + sp.kind, key: sp.key, side: sp.side, kind: sp.kind,
        label: (sp.side ? (sp.side === "A" ? m.A.name : m.B.name) + ": " : "") + SENS_LABEL[sp.key] + (sp.kind === "rate" ? " (estimate)" : " (knob)"),
        sd: r4(sp.sd), mult: [r4(mult[0]), r4(mult[1])], upGood: up, lo: res[0], hi: res[1],
        dPA: [r4(res[0].pA - base.pA), r4(res[1].pA - base.pA)], dPWin: up ? r4(up * (pw1 - pw0)) : null,
        swing: r4(Math.abs(res[1].pA - res[0].pA)), se: r4(pairSe(res[0], res[1])) };
    });
    items.sort(function (x, y) { return y.swing - x.swing; });
    return { n: N, seed: seed, z: z, base: base, items: items, ms: Date.now() - t0 };
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
      if (m.dur) o.kd.durability = { mode: m.dur.mode, base: m.dur.base, rel: m.dur.rel[i], engineRel: m.dur.engRel[i], engineWeight: m.dur.w,
        oppChin: m.dur[SIDE[j]].chin, ownPow: m.dur[SIDE[i]].pow, opp: m.dur[SIDE[j]], own: m.dur[SIDE[i]] };
      o.grappling = { tdAttPer15Stand: m.tdS[i] * 900, tdSuccess: m.pTd[i], tdSuccessClinch: prob(m.tdOC[i] * m.adj[j].tdDef), ctrlTargetPer15: m.ctrlT[i] * 15,
        topSkill: R[i].topSkill, oppEscapeWeakness: R[j].escWeak, passEdge: m.gEdge[i], standUpMeanSecWhenUnder: 1 / Math.max(1e-9, m.up[i]),
        sweepPerMinBottom: m.sw[i] * 60 };
      o.subs = { attemptsPerGroundMin: m.threat[i], conversion: m.subConv[i], careerConvShrunk: R[i].subConv, oppDefFailShrunk: R[j].subDefFail, guillotinePerStuffedShot: m.gillo[i] };
      o.cardio = { paceByRound: (m.dyn ? m.dyn.pace[i] : m.pace[i]).slice(), cardioIndex: m.cardio[i], drainPerSec: m.drain[i], drainVsLeague: m.drain[i] / m.p.drain,
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
      if (m.dur) {
        var dO = m.dur[SIDE[j]], dS = m.dur[SIDE[i]];
        lines.push("  KD per landed standing head strike " + f(100 * m.kd[i], 3) + "% (durability, " + m.dur.mode + "): base " + f(100 * m.dur.base, 3) + "% x kdCal x kdScale x [opp chin " +
          f(dO.chin) + " (cov " + f(dO.chin_cov) + " x fighter " + f(dO.chin_re) + ") x own power " + f(dS.pow) + " (cov " + f(dS.pow_cov) + " x fighter " + f(dS.pow_re) + ") x knobs " +
          f(m.adj[i].pow) + "/" + f(m.adj[j].chin) + "]^" + f(1 - m.dur.w) + " x engine structure " + f(m.dur.engRel[i]) + "^" + f(m.dur.w) + "; damage/head " + f(m.dw[i]));
      } else {
        lines.push("  KD per landed standing head strike " + f(100 * m.kd[i], 3) + "% = p0 " + f(100 * o.kd.p0, 3) + "% x power " + f(fc.powRaw) + " x opp chin " + f(fo.chinRaw) +
          " x opp age " + f(fo.ageChin) + " x own age (power) " + f(fc.agePow) + " x opp KO losses (" + fo.koLosses + ") " + f(fo.koChin) + " x opp size " + f(fo.sizeChin) + " x own size (power) " + f(fc.sizePow) +
          " x knobs " + f(m.adj[i].pow) + "/" + f(m.adj[j].chin) + "; damage/head " + f(m.dw[i]));
      }
      lines.push("  Takedowns: " + f(o.grappling.tdAttPer15Stand) + " att per 15 standing min, success " + pct(m.pTd[i]) + " (career " + pct(R[i].tdAcc) + " vs opp allows " + pct(R[j].tdAccAg) + ", league " + pct(P.td_acc) +
        "); control target " + f(o.grappling.ctrlTargetPer15, 0) + " s/15 (league " + f(P.ctrl * 15, 0) + "), top skill " + f(R[i].topSkill) + " x opp escape " + f(R[j].escWeak) + " -> pass edge " + f(m.gEdge[i]));
      lines.push("  When under: mean stand-up " + f(1 / m.up[i], 0) + " s, sweeps " + f(m.sw[i] * 60, 3) + "/min");
      lines.push("  Submissions: " + f(m.threat[i], 3) + " attempts per ground-minute (league " + f(L.sub, 3) + "), conversion " + pct(m.subConv[i]) + " (shrunk own " + pct(R[i].subConv) + " vs opp " + pct(R[j].subDefFail) + ", league " + pct(P.sub_conv) + ")");
      var schedF = Math.pow(3 / m.rounds, m.p.drainSchedExp), cardF = Math.pow(clip(m.cardio[i], 0.5, 1.6), -m.p.cardioExp);
      lines.push("  Cardio: output by round " + (m.dyn ? m.dyn.pace[i] : m.pace[i]).map(function (x) { return f(x); }).join(" ") +
        (m.dyn ? " (dynamics: league pace curve x his late-round ratio x opponent's^" + m.p.dyn.paceMutual + "; knockdown risk by round " +
          m.dyn.kdP.map(function (x) { return f(x); }).join(" ") + ")" : " (division curve x his late-round ratio)") + "; cardio index " + f(m.cardio[i]) +
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
    loadMLRates: loadMLRates, mlModel: mlModel, judgeRound: judgeRound, deductions: deductions, loadDurability: loadDurability,
    durabilityCovariates: function (prof, age, dp) { return durCovariates(dp || (getParams() || {}).durability || {}, prof || {}, age, null); },
    loadOfficials: loadOfficials, officialsTable: function () { return OFFTAB; }, officialsTableFor: officialsTableFor, officialsRound: officialsRound,
    summarize: summarize, explain: explain, manualProfile: manualProfile,
    sensitivity: sensitivity, rateSd: rateSd, realismFactors: realismFactors,   // realism_sens component (v5 merge step 3)
    // helpers exposed for tests, calibration and the page
    priorFor: priorFor, league: league, fighterRates: fighterRates, occupancy: occupancy, isDecision: isDecision,
    clip: clip, log5: log5, odds: odds, prob: prob, params: getParams,
    // v5: the parameter set a matchup runs on (base params + components flags + opts.params overrides), and the v401 sub-flags
    resolveParams: function (over, base) { return resolveParams(base || getParams(), over); }, v401Flags: v401Flags
  };
  // [styles_sos] begin: component hook (src/styles_sos.js: style rate modifiers, strength of schedule). It runs after
  // the matchup tables are final (base or learned rates) and only when params.components.styles_sos is truthy; with the
  // flag off the engine is the engine without these lines (tests/test_styles_sos.js strips them and compares).
  function matchupStylesSOS(profA, profB, opts) {
    var m = matchup(profA, profB, opts);
    var c = m.p && m.p.components, on = !!(c && c.styles_sos), SS = on ? getSS() : null;
    if (SS) SS.apply(m, resolve(profA), resolve(profB), opts || {}, KEYS);
    else if (on) m.stylesSOS = { missing: true };   // flag on but src/styles_sos.js not loaded: tables unchanged, flagged
    return m;
  }
  api.matchup = matchupStylesSOS;
  // [styles_sos] end
  return api;
});
