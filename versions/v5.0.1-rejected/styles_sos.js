/* styles_sos engine component (roadmap v7 style layer + strength of schedule; engine v5 candidate).
   UMD: module.exports in Node, self.StylesSOS in a browser or Web Worker. No DOM, no randomness, no dependencies.

   FightEngine.matchup() calls StylesSOS.apply(m, profA, profB, opts) after the matchup tables are final (base tables
   or the learned stat-line rates of engine v4) when params.components.styles_sos is truthy. With the flag off (or this
   file not loaded) the engine is bit-for-bit the engine without the component (tests/test_styles_sos.js proves it).

   Sub-flags (params.components.styles_sos = { styles, sos, newcomer }; `true` means the defaults below):
   (a) styles: style rate modifiers exactly per research/model_styles.md section 9, the four blocks on by default
       there (dist_att, td_att, ctrl_per_td, gnp_att; ctrl is a check only and never applied). For attacker X vs
       defender Y each block adds s = sum_k c_k t_k to the log of one engine rate (the scale knob multiplies s):
         dist_att     X's distance strike-attempt rate (m.dRate)            x exp(s)
         td_att       X's takedown-attempt rates (m.tdD, m.tdCC, m.tdCU)    x exp(s)   (after the occupancy fit, so
                      control moves through the number of takedowns, as section 9 item 3 prescribes)
         ctrl_per_td  X's top-control duration per takedown: the bottom man's stand-up and sweep hazards under X
                      (m.upPos, m.swPos)                                    / exp(s)
         gnp_att      X's ground-strike rate on top (m.gPos, m.gRate)       x exp(s)
       Coefficient sets (styles.json engine_modifiers.default_on): "ab1" (default; the engine composes rates with
       a = b = 1) uses coef_per_unit_ab1 and drops the terms whose a = b = 1 tune z is below 2 (section 9 item 2 and
       the verification log: dist_att/zy_kd_pow, td_att/zy_td_int, ctrl_per_td/zy_sub_int); "fit" uses coef_per_unit
       with every term (the free-exponent fit). Term values: length_d = ((reach_X - reach_Y)/4.57407 + (height_X -
       height_Y)/3.74025)/2 (a part is 0 when either value is missing), open = 1 for southpaw vs orthodox, zy_* = the
       defender's style z-score (styles.py Side.features from the profile's decayed sums S and the matchup's division
       prior m.P, standardised with styles.json zscore mu/sd fit on 2019-2023 sides). Backtest snapshots with
       priors_asof therefore give walk-forward style vectors with no extra table.
   (b) sos: one-step strength of schedule from tools/sos_wf.py (data/derived/sos_wf.json). Each fighter carries, per
       stat, [q, w] for what his past opponents allowed (a) and produced (o); the bias of his shrunk rate is
       q w / (w + k) and X's matchup rate vs Y is multiplied by exp(scale * (beta_a bias_a(X) + beta_o bias_o(Y))):
         dAtt  m.dRate (distance attempts)          acc   distance accuracy odds m.accO (position 0, all targets)
         tdAtt m.tdD, m.tdCC, m.tdCU                tdAcc takedown success odds m.tdO, m.tdOC
         kd    m.kd (and m.gnp, m.stko by the square root)
       beta per path (learned rates on: "ml", off: "base") fit on 2019-2023 rate rows by tools/sos_wf.py fit (Poisson /
       binomial with the path's own prediction as offset); a stat is on only when its leave-one-year-out CV deviance
       change has a fight-bootstrap CI below zero. Inputs: opts.sos = {A, B} (then only it; a side it lacks is
       neutral), else prof.sos, else the roster table loaded with StylesSOS.loadSOS(sos_wf.json --roster) by slug, the
       latter only for bouts dated after its meta.roster_asof (no look-ahead for a backtest that omits opts.sos); a side
       without an input is neutral.
       params.stylesSOS.sosSource = "oppadj" swaps in the verified factors of tools/oppadj.py instead (prof.oppadj or
       StylesSOS.loadOppadj(oppadj.json)): base tables through engine R in fighterRates, learned rates through
       (F_off,X F_def,Y)^beta on the final tables (see the oppadj block below). Default "wf": on the 2019-2023 ablation
       it is better on the winner side (soft CE vs the close), oppadj is better on per-fight stat lines.
   (c) newcomer priors from pre-UFC records: NOT implemented. research/model_preufc.md (with a verification log)
       did not exist when this component was built (checked Nov 6, 2026 at the start and before delivery), so the
       flag is accepted and ignored.

   Defaults (params3.js): sub-flag styles off, sos on with source "wf". When styles is switched on, the per-path style
   blocks (params.stylesSOS.styleBlocks) default to none with the learned rates (they already carry these effects) and
   all four on the base tables.

   The result is recorded on m.stylesSOS (terms, s per block and side, multipliers) for explain() and the page. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.StylesSOS = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  var VERSION = "1.0.0";

  // ---------------------------------------------------------------- (a) styles: constants from data/derived/styles.json
  var K_MIN = 10, K_TD = 4, K_HEAD = 60;                     // styles.json meta.shrinkage (LOYO CV on 2019-2023)
  var SD_REACH = 4.57407, SD_HEIGHT = 3.74025;               // styles.json zscore.sd reach / height (inches)
  var ZMU = { vol: 0.0112602, td_int: -0.178432, td_def: 0.0741507, sub_int: -0.277324, kd_pow: -0.0887844 };
  var ZSD = { vol: 0.248695, td_int: 0.614186, td_def: 0.522196, sub_int: 0.93909, kd_pow: 0.647881 };
  // engine_modifiers.default_on: [term, coef_per_unit (free exponents), coef_per_unit_ab1, z_tune_ab1]
  var BLOCKS = {
    dist_att: [["length_d", 0.063904, 0.052357, 7.268], ["open", -0.073081, -0.067632, -3.885],
      ["zy_kd_pow", -0.023806, -0.0099884, -1.395]],
    td_att: [["zy_td_int", -0.076253, 0.00065554, 0.027], ["length_d", -0.13401, -0.096627, -2.861],
      ["zy_vol", 0.076694, 0.16794, 6.908], ["zy_td_def", -0.093306, -0.074101, -3.326]],
    ctrl_per_td: [["zy_td_def", -0.069025, -0.1069, -6.012], ["zy_sub_int", 0.026359, 0.0016536, 0.098]],
    gnp_att: [["zy_sub_int", 0.10412, 0.10378, 4.175], ["zy_kd_pow", 0.085885, 0.074442, 3.082]]
  };
  var BLOCK_NAMES = ["dist_att", "td_att", "ctrl_per_td", "gnp_att"];
  // 2019-2023 side means of the term values (tests/fixtures/styles_sos_fixture.json): the z terms are mean 0 by
  // construction and length_d is antisymmetric; open-stance pairs are 27.5% of sides. With styleCenter the open term
  // enters as (open - 0.2746), so adding the block keeps the league attempt level the engine was calibrated to.
  var TERM_MEAN = { open: 0.274637 };

  // ---------------------------------------------------------------- (b) sos: coefficients from data/derived/sos_wf.json
  var SOS_STATS = ["dAtt", "acc", "tdAtt", "tdAcc", "kd"];
  var SOS_K = [24.8, 150, 32.4, 12, 230];    // kPM*0.62, kAcc, kTdPM*0.72, kTdAcc, kKD (sos_wf.json meta.fit.K)
  // [beta_a (his opponents' allowed), beta_o (the defender's opponents' output), center_a, center_o]: the shift is
  // beta_a (bias_a - center_a) + beta_o (bias_o - center_o); centers are the 2019-2023 mean biases, so the league level
  // the engine was calibrated to is kept on average. tdAcc and kd failed the 2019-2023 CV rule (coefficients 0).
  var SOS_COEF = {
    ml: { dAtt: [-0.9647, -1.3308, -0.00235, 0.00261], acc: [-0.8362, -0.4513, 0.00116, 0.01981],
      tdAtt: [-0.6244, -0.9522, -0.01435, -0.03326], tdAcc: [0, 0, 0, 0], kd: [0, 0, 0, 0] },
    base: { dAtt: [-1.1175, -1.2177, -0.00235, 0.00261], acc: [-0.7738, -0.3103, 0.00116, 0.01981],
      tdAtt: [-0.051, -1.3477, -0.01435, -0.03326], tdAcc: [0, 0, 0, 0], kd: [0, 0, 0, 0] }
  };
  var SOS_TABLE = null;                       // roster table (slug -> {a, o}) from loadSOS
  var SOS_ASOF = null;                        // its meta.roster_asof: the table holds every fight up to that date

  // ---------------------------------------------------------------- (b') sos source "oppadj": verified factors of
  // tools/oppadj.py (data/derived/oppadj.json, research/model_oppadj.md "Recommendation for the engine" and its
  // verification log). Base tables: the snapshot / roster factors multiply engine R fields in fighterRates (families
  // with engine_path_lambda > 0; knockdowns, submissions and body accuracy stay 1). Learned rates: the matchup rate of X
  // vs Y is multiplied by (F_off,X * F_def,Y)^beta (results.recommendation ml_path_beta); this component applies those
  // multipliers to the final tables (the reference multiplies the learned targets before re-targeting: same factors,
  // but clinch time and the occupancy fit are not re-run, and control enters through the top man's stand-up and sweep
  // hazards). topSkill / escWeak multiply R on both paths.
  var OA_R_FIELDS = ["dAtt", "dAttAg", "cAtt", "cAttAg", "gAtt", "gAttAg", "tdAtt", "tdAttAg", "ctrl", "octrl", "topSkill", "escWeak"];
  var OA_ML_BETA = { dAtt: 0.932, cAtt: 0.988, gAtt: 0.17, accH: 0.548, accB: 0, accL: 0.262, kd: 0, tdAtt: 0.372, tdAcc: 0.119,
    ctrl: 0.621, sub: 0 };
  var OA_TABLE = null;

  var DEFAULTS = { styleScale: 1, styleSet: "ab1", styleMinZ: 2, styleCenter: true, styleBlocks: null, sosScale: 1, sosCoef: SOS_COEF,
    sosK: SOS_K, sosSource: "wf", oppadjBeta: null };

  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function logit(p) { p = clip(p, 1e-6, 1 - 1e-6); return Math.log(p / (1 - p)); }
  function num(x) { return x != null && isFinite(x) ? +x : null; }

  function sumsOf(prof, KEYS) {
    var S = prof && prof.S, keys = (prof && prof.keys) || KEYS, o = {}, i;
    for (i = 0; i < KEYS.length; i++) o[KEYS[i]] = 0;
    if (Array.isArray(S)) { for (i = 0; i < keys.length && i < S.length; i++) o[keys[i]] = +S[i] || 0; }
    else if (S) { for (var k in S) o[k] = +S[k] || 0; }
    return o;
  }

  // styles.py Side.features, the five features the modifier blocks use
  function styleFeatures(s, P) {
    var m = Math.max(0, s.min || 0), f = {};
    var pSig = P.d_att + P.c_att + P.g_att, sig = s.d_att + s.c_att + s.g_att;
    f.vol = Math.log(((sig + K_MIN * pSig) / (m + K_MIN)) / pSig);
    f.td_int = Math.log(((s.td_att + K_MIN * P.td_att) / (m + K_MIN)) / P.td_att);
    var t0 = P.td_acc;
    f.td_def = logit(1 - (s.otd_lnd + K_TD * t0) / (s.otd_att + K_TD)) - logit(1 - t0);
    f.sub_int = Math.log(((s.sub_att + K_MIN * P.sub_att) / (m + K_MIN)) / P.sub_att);
    var k0 = P.kd_per_h;
    f.kd_pow = Math.log(((s.kd + K_HEAD * k0) / (s.h_lnd + K_HEAD)) / k0);
    return f;
  }
  function styleZ(f) {
    var z = {};
    for (var k in ZMU) z[k] = f[k] != null && isFinite(f[k]) ? (f[k] - ZMU[k]) / ZSD[k] : 0;
    return z;
  }
  function stanceOf(prof) { var st = String((prof && prof.stance) || "").toLowerCase(); return st; }

  // term values for attacker X (zx, px) against defender Y (zy, py)
  function termValue(term, zx, zy, px, py) {
    if (term.indexOf("zy_") === 0) return zy[term.slice(3)] || 0;
    if (term.indexOf("zx_") === 0) return zx[term.slice(3)] || 0;
    if (term === "length_d") {
      var rx = num(px.reach_in), ry = num(py.reach_in), hx = num(px.height_in), hy = num(py.height_in);
      var rd = rx != null && ry != null ? (rx - ry) / SD_REACH : 0, hd = hx != null && hy != null ? (hx - hy) / SD_HEIGHT : 0;
      return (rd + hd) / 2;
    }
    if (term === "open") {
      var a = stanceOf(px), b = stanceOf(py);
      return (a === "southpaw" && b === "orthodox") || (a === "orthodox" && b === "southpaw") ? 1 : 0;
    }
    throw new Error("StylesSOS: unknown term " + term);
  }

  // per-block s for X attacking Y
  function blockShifts(zx, zy, px, py, set, minZ, center, only) {
    var out = {}, b, t;
    for (var q = 0; q < BLOCK_NAMES.length; q++) {
      b = BLOCK_NAMES[q];
      var s = 0, terms = BLOCKS[b];
      if (only && only.indexOf(b) < 0) { out[b] = 0; continue; }
      for (t = 0; t < terms.length; t++) {
        var T = terms[t], c;
        if (set === "fit") c = T[1];
        else { if (Math.abs(T[3]) < minZ) continue; c = T[2]; }
        s += c * (termValue(T[0], zx, zy, px, py) - (center && TERM_MEAN[T[0]] ? TERM_MEAN[T[0]] : 0));
      }
      out[b] = s;
    }
    return out;
  }

  function applyStyles(m, profs, KEYS, cfg) {
    var set = cfg.styleSet === "fit" ? "fit" : "ab1", sc = cfg.styleScale != null ? +cfg.styleScale : 1;
    var minZ = cfg.styleMinZ != null ? +cfg.styleMinZ : 2;
    var sA = m.R && m.R[0] && m.R[0].sums ? m.R[0].sums : sumsOf(profs[0], KEYS);   // the engine's own sums
    var sB = m.R && m.R[1] && m.R[1].sums ? m.R[1].sums : sumsOf(profs[1], KEYS);
    var z = [styleZ(styleFeatures(sA, m.P)), styleZ(styleFeatures(sB, m.P))];
    var ctr = cfg.styleCenter !== false, path = m.mlApplied ? "ml" : "base";
    // block list for this path: null / "all" = the four section-9 blocks, [] = none (params3.js default: none with the
    // learned rates, which already carry these effects; all four on the base tables)
    var sb = cfg.styleBlocks, only = sb && sb !== "all" && sb[path] != null && sb[path] !== "all" ? sb[path] : null;
    var sh = [blockShifts(z[0], z[1], profs[0], profs[1], set, minZ, ctr, only), blockShifts(z[1], z[0], profs[1], profs[0], set, minZ, ctr, only)];
    var mult = [{}, {}], i, j, k;
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var e = {};
      for (k in sh[i]) e[k] = Math.exp(sc * sh[i][k]);
      mult[i] = e;
      m.dRate[i] *= e.dist_att;
      m.tdD[i] *= e.td_att; m.tdCC[i] *= e.td_att; m.tdCU[i] *= e.td_att;
      if (m.tdS) m.tdS[i] *= e.td_att;
      for (k = 0; k < 5; k++) {
        m.upPos[i * 5 + k] /= e.ctrl_per_td; m.swPos[i * 5 + k] /= e.ctrl_per_td;   // i on top, j underneath
        m.gPos[i * 5 + k] *= e.gnp_att;
      }
      if (m.up) m.up[j] /= e.ctrl_per_td;
      if (m.sw) m.sw[j] /= e.ctrl_per_td;
      m.gRate[i] *= e.gnp_att;
    }
    return { set: set, scale: sc, path: path, blocks: only || BLOCK_NAMES.slice(), z: z, s: sh, mult: mult };
  }

  // ---------------------------------------------------------------- (b) sos
  // Input precedence: opts.sos (per call, e.g. a backtest's walk-forward pairs; a side it lacks is neutral, never filled
  // from a table), then prof.sos, then the roster table by slug. The roster table holds every fight up to its as-of
  // date, so it is used only for bouts dated after that (or undated): a backtest snapshot that carries no opts.sos runs
  // neutral instead of reading later fights. [verifier fix]
  function sosFor(prof, side, opts, date) {
    if (opts && opts.sos) return opts.sos[side] || null;
    if (prof && prof.sos) return prof.sos;
    if (SOS_TABLE && prof && prof.slug && SOS_TABLE[prof.slug] && !(SOS_ASOF && date && String(date) <= SOS_ASOF)) return SOS_TABLE[prof.slug];
    return null;
  }
  function biasOf(pairs, i, K, dflt) {
    if (!pairs || !pairs[i]) return dflt;
    var q = +pairs[i][0] || 0, w = Math.max(0, +pairs[i][1] || 0);
    return q * w / (w + K[i]);
  }
  function applySOS(m, profs, opts, cfg) {
    var path = m.mlApplied ? "ml" : "base", C = (cfg.sosCoef || SOS_COEF)[path] || {}, K = cfg.sosK || SOS_K;
    var sc = cfg.sosScale != null ? +cfg.sosScale : 1;
    var date = (opts && opts.date) || m.date || null;
    var src = [sosFor(profs[0], "A", opts, date), sosFor(profs[1], "B", opts, date)];
    var s = [{}, {}], mult = [{}, {}], i, j, t, q;
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      for (q = 0; q < SOS_STATS.length; q++) {
        var st = SOS_STATS[q], c = C[st] || [0, 0, 0, 0];
        var ca = c[2] || 0, co = c[3] || 0;   // a side with no input is neutral (bias = center)
        var v = c[0] * (biasOf(src[i] && src[i].a, q, K, ca) - ca) + c[1] * (biasOf(src[j] && src[j].o, q, K, co) - co);
        s[i][st] = v; mult[i][st] = Math.exp(sc * v);
      }
      var e = mult[i];
      m.dRate[i] *= e.dAtt;
      for (t = 0; t < 3; t++) m.accO[(i * 4 + 0) * 3 + t] *= e.acc;
      m.tdD[i] *= e.tdAtt; m.tdCC[i] *= e.tdAtt; m.tdCU[i] *= e.tdAtt;
      if (m.tdS) m.tdS[i] *= e.tdAtt;
      m.tdO[i] *= e.tdAcc; m.tdOC[i] *= e.tdAcc;
      m.kd[i] *= e.kd; var r = Math.sqrt(e.kd); m.gnp[i] *= r; m.stko[i] *= r;
    }
    return { path: path, scale: sc, have: [!!src[0], !!src[1]], s: s, mult: mult };
  }

  function oppadjFor(prof) {
    if (prof && prof.oppadj) return prof.oppadj;
    if (OA_TABLE && prof && prof.slug && OA_TABLE[prof.slug]) return OA_TABLE[prof.slug];
    return null;
  }
  // called by engine3.js fighterRates (base-table factors; also topSkill / escWeak on the learned-rate path)
  function oppadjR(R, prof, p) {
    var cfg = config(p);
    if (!cfg || !cfg.flags.sos || cfg.sosSource !== "oppadj" || cfg.sosScale === 0) return false;
    var F = oppadjFor(prof);
    if (!F) return false;
    var sc = cfg.sosScale != null ? +cfg.sosScale : 1, q, t;
    function f(x) { return x != null && isFinite(x) && x > 0 ? Math.pow(+x, sc) : 1; }
    for (q = 0; q < OA_R_FIELDS.length; q++) R[OA_R_FIELDS[q]] *= f(F[OA_R_FIELDS[q]]);
    function oddsMul(pr, m) { var o = pr / (1 - pr) * m; return clip(o / (1 + o), 0.03, 0.95); }
    R.tdAcc = oddsMul(R.tdAcc, f(F.tdAcc));
    R.tdAccAg = oddsMul(R.tdAccAg, f(F.tdAccAg));
    for (t = 0; t < 3; t += 2) {        // head and leg accuracy (body accuracy is off)
      if (F.acc) R.accSh[t] += Math.log(f(F.acc[t]));
      if (F.accAg) R.accAgSh[t] += Math.log(f(F.accAg[t]));
    }
    return true;
  }
  function applyOppadjML(m, profs, cfg) {
    var Fs = [oppadjFor(profs[0]), oppadjFor(profs[1])], sc = cfg.sosScale != null ? +cfg.sosScale : 1;
    var B = cfg.oppadjBeta || OA_ML_BETA, mult = [{}, {}], i, j, k, t;
    function g(F, key, idx) { var v = F ? (idx != null ? (F[key] ? F[key][idx] : null) : F[key]) : null; return v != null && isFinite(v) && v > 0 ? +v : 1; }
    function pr(Fx, Fy, off, def, beta, idx) { return Math.pow(g(Fx, off, idx) * g(Fy, def, idx), sc * (beta || 0)); }
    for (i = 0; i < 2; i++) {
      j = 1 - i;
      var X = Fs[i], Y = Fs[j], e = mult[i];
      e.dAtt = pr(X, Y, "dAtt", "dAttAg", B.dAtt); e.cAtt = pr(X, Y, "cAtt", "cAttAg", B.cAtt); e.gAtt = pr(X, Y, "gAtt", "gAttAg", B.gAtt);
      e.accH = pr(X, Y, "acc", "accAg", B.accH, 0); e.accL = pr(X, Y, "acc", "accAg", B.accL, 2);
      e.tdAtt = pr(X, Y, "tdAtt", "tdAttAg", B.tdAtt); e.tdAcc = pr(X, Y, "tdAcc", "tdAccAg", B.tdAcc); e.ctrl = pr(X, Y, "ctrl", "octrl", B.ctrl);
      m.dRate[i] *= e.dAtt; m.cRate[i] *= e.cAtt; m.gRate[i] *= e.gAtt;
      for (k = 0; k < 5; k++) { m.gPos[i * 5 + k] *= e.gAtt; m.upPos[i * 5 + k] /= e.ctrl; m.swPos[i * 5 + k] /= e.ctrl; }
      if (m.up) m.up[j] /= e.ctrl;
      if (m.sw) m.sw[j] /= e.ctrl;
      for (t = 0; t < 4; t++) { m.accO[(i * 4 + t) * 3 + 0] *= e.accH; m.accO[(i * 4 + t) * 3 + 2] *= e.accL; }
      m.tdD[i] *= e.tdAtt; m.tdCC[i] *= e.tdAtt; m.tdCU[i] *= e.tdAtt;
      if (m.tdS) m.tdS[i] *= e.tdAtt;
      m.tdO[i] *= e.tdAcc; m.tdOC[i] *= e.tdAcc;
    }
    return { path: "ml", source: "oppadj", have: [!!Fs[0], !!Fs[1]], mult: mult };
  }

  // ---------------------------------------------------------------- entry point
  function config(p) {
    var c = p && p.components ? p.components.styles_sos : null;
    if (!c) return null;
    var flags = c === true ? { styles: true, sos: true, newcomer: false } : c;
    var cfg = {}, k, o = (p && p.stylesSOS) || {};
    for (k in DEFAULTS) cfg[k] = DEFAULTS[k];
    for (k in o) if (o[k] != null) cfg[k] = o[k];
    cfg.flags = { styles: flags.styles !== false, sos: flags.sos !== false, newcomer: false };
    return cfg;
  }

  function apply(m, profA, profB, opts, KEYS) {
    var cfg = config(m.p);
    if (!cfg) return m;
    opts = opts || {};
    KEYS = KEYS || ["min", "n", "rds", "d_att", "d_lnd", "c_att", "c_lnd", "g_att", "g_lnd", "h_att", "h_lnd", "b_att",
      "b_lnd", "l_att", "l_lnd", "t_att", "t_lnd", "od_att", "od_lnd", "oc_att", "oc_lnd", "og_att", "og_lnd", "oh_att",
      "oh_lnd", "ob_att", "ob_lnd", "ol_att", "ol_lnd", "ot_att", "ot_lnd", "kd", "okd", "td_att", "td_lnd", "otd_att",
      "otd_lnd", "ctrl", "octrl", "sub_att", "osub_att", "rev", "orev"];
    var profs = [profA, profB], rec = { version: VERSION, flags: cfg.flags, styles: null, sos: null };
    var knob = opts.styleMatchups != null && isFinite(opts.styleMatchups) ? clip(+opts.styleMatchups, 0, 1.5) : null;
    if (knob != null) cfg.styleScale = knob;
    if (cfg.flags.styles && cfg.styleScale !== 0) rec.styles = applyStyles(m, profs, KEYS, cfg);
    if (cfg.flags.sos && cfg.sosScale !== 0) {
      if (cfg.sosSource === "oppadj") rec.sos = m.mlApplied ? applyOppadjML(m, profs, cfg)
        : { path: "base", source: "oppadj", have: [!!oppadjFor(profs[0]), !!oppadjFor(profs[1])], inRates: true };
      else rec.sos = applySOS(m, profs, opts, cfg);
    }
    m.stylesSOS = rec;
    return m;
  }

  function loadOppadj(json) {     // oppadj.json (its roster, by slug) or a slug -> factors table
    var d = typeof json === "string" ? JSON.parse(json) : json;
    OA_TABLE = d ? (d.roster || d) : null;
    return OA_TABLE;
  }
  function loadSOS(json) {     // sos_wf.json built with --roster (its roster and meta.roster_asof), or a slug -> {a, o} table
    var d = typeof json === "string" ? JSON.parse(json) : json;
    SOS_TABLE = d ? (d.roster || d) : null;
    SOS_ASOF = d && d.meta && d.meta.roster_asof ? String(d.meta.roster_asof) : null;
    return SOS_TABLE;
  }

  return { VERSION: VERSION, apply: apply, config: config, loadSOS: loadSOS, loadOppadj: loadOppadj, oppadjR: oppadjR,
    OA_ML_BETA: OA_ML_BETA, OA_R_FIELDS: OA_R_FIELDS, styleFeatures: styleFeatures,
    styleZ: styleZ, blockShifts: blockShifts, termValue: termValue, BLOCKS: BLOCKS, TERM_MEAN: TERM_MEAN, SOS_COEF: SOS_COEF, SOS_K: SOS_K,
    SOS_STATS: SOS_STATS, DEFAULTS: DEFAULTS };
});
