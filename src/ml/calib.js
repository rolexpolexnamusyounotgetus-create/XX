/* Recalibration layer for P(A wins) (tools/calib.py -> data/derived/calib.json), plus the trailing calibration-slope
   monitor the pre-registered drift rule reads.

   What the CV found (research/model_calib.md): no recalibration scheme beats the shipped stacks on the forward-chained
   years 2021-2023 under ml2's 0.0005 rule, so every production spec in calib.json is {type: "none"} and apply() is the
   identity there. The fitter and the other kinds exist so the forward package and FightEngine.predict() can switch a
   scheme on later by changing data, not code, and so the ledger can refit it walk-forward from its own scored history.

   A recalibration maps the raw logit z of P(A wins) to z' = theta . phi(z, s), every column odd in z, flags corner-
   symmetric, no intercept, so apply(spec, 1 - p) = 1 - apply(spec, p) exactly:
     none         z' = z
     temperature  z' = a z                     (symmetric beta calibration)
     odd          z' = a z + b z |z|
     segment      z' = (a + sum_k d_k s_k) z   (s_k in SEGMENTS, 0/1)

   Usage (Node, browser or Web Worker; no dependencies):
     var spec = calibDoc.production.noline;                         // {type: "none"} today
     var flags = Calib.segFlags({ women: false, lbs: 155, nA: 30, nB: 12, rounds: 5, pRaw: pStack });
     var p = Calib.apply(spec, pStack, flags);                      // recalibrated P(A)
     var s2 = Calib.fitFromHistory(rows, "2026-12-12", cfg);        // walk-forward refit from scored rows
     var mon = Calib.monitor(pList, yList, 200);                    // {slope, ci, ciIncludes1} on the last 200
   UMD: module.exports in Node, self.Calib in a browser or Web Worker. */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calib = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function () {
  "use strict";
  var SEGMENTS = ["women", "heavy", "newcomer", "debut", "five", "bigfav"];
  var BIGFAV_P = 0.75;

  function clip(p, c) { return Math.min(Math.max(p, c), 1 - c); }
  function logit(p, c) { var q = clip(p, c === undefined ? 1e-12 : c); return Math.log(q / (1 - q)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  function log1pexp(q) { return q > 0 ? q + Math.log1p(Math.exp(-q)) : Math.log1p(Math.exp(q)); }

  /** Corner-symmetric flags. f: {women, lbs, nA, nB (or nMin), rounds (or five), pRaw}. heavy = men 205 lb and up;
      newcomer = the less experienced man has 1-2 prior UFC fights; debut = one man has none; bigfav = raw favourite
      at 75% or more. */
  function segFlags(f) {
    var women = !!f.women, lbs = f.lbs === undefined || f.lbs === null ? null : +f.lbs;
    var n = f.nMin !== undefined ? f.nMin : (f.nA === undefined || f.nB === undefined ? null : Math.min(+f.nA, +f.nB));
    var five = f.five !== undefined ? !!f.five : +f.rounds === 5;
    var p = f.pRaw === undefined || f.pRaw === null ? 0.5 : +f.pRaw;
    return { women: women ? 1 : 0, heavy: !women && lbs !== null && lbs >= 205 ? 1 : 0,
             newcomer: n !== null && n >= 1 && n <= 2 ? 1 : 0, debut: n === 0 ? 1 : 0, five: five ? 1 : 0,
             bigfav: Math.max(p, 1 - p) >= BIGFAV_P ? 1 : 0 };
  }

  /** Recalibrated P(A) for raw P(A) p. */
  function apply(spec, p, flags) {
    var t = spec && spec.type ? spec.type : "none";
    if (t === "none") return p;
    var z = logit(p, 1e-12);
    if (t === "temperature") return sigm(spec.a * z);
    if (t === "odd") return sigm(spec.a * z + spec.b * z * Math.abs(z));
    if (t === "segment") {
      var m = spec.a, d = spec.d || {}, fl = flags || {};
      for (var i = 0; i < SEGMENTS.length; i++) { var s = SEGMENTS[i]; if (d[s]) m += d[s] * (+fl[s] || 0); }
      return sigm(m * z);
    }
    throw new Error("calib: unknown spec type " + t);
  }

  function designRow(kind, z, flags, segs) {
    if (kind === "temperature") return [z];
    if (kind === "odd") return [z, z * Math.abs(z)];
    if (kind === "segment") { var r = [z]; for (var i = 0; i < segs.length; i++) r.push(z * (+(flags || {})[segs[i]] || 0)); return r; }
    throw new Error("calib: unknown kind " + kind);
  }

  function solve(H, g) {               // small dense Gaussian elimination with partial pivoting
    var n = g.length, A = H.map(function (r, i) { return r.slice().concat([g[i]]); });
    for (var c = 0; c < n; c++) {
      var piv = c;
      for (var r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
      var tmp = A[c]; A[c] = A[piv]; A[piv] = tmp;
      for (var r2 = c + 1; r2 < n; r2++) {
        var f = A[r2][c] / A[c][c];
        for (var k = c; k <= n; k++) A[r2][k] -= f * A[c][k];
      }
    }
    var x = new Array(n);
    for (var i = n - 1; i >= 0; i--) {
      var s = A[i][n];
      for (var j = i + 1; j < n; j++) s -= A[i][j] * x[j];
      x[i] = s / A[i][i];
    }
    return x;
  }

  /** MAP of a no-intercept logistic (same Newton + step halving as tools/calib.py fit_glm). X rows, y, w weights,
      m0 prior means, prec prior precisions (fight units). */
  function fitGLM(X, y, w, m0, prec, iters) {
    var k = m0.length, t = m0.slice(), n = X.length;
    function obj(th) {
      var s = 0;
      for (var i = 0; i < n; i++) { var q = 0; for (var j = 0; j < k; j++) q += X[i][j] * th[j]; s += w[i] * (log1pexp(q) - y[i] * q); }
      for (var j2 = 0; j2 < k; j2++) s += 0.5 * prec[j2] * (th[j2] - m0[j2]) * (th[j2] - m0[j2]);
      return s;
    }
    var f = obj(t);
    for (var it = 0; it < (iters || 50); it++) {
      var g = new Array(k).fill(0), H = [];
      for (var a = 0; a < k; a++) H.push(new Array(k).fill(0));
      for (var i = 0; i < n; i++) {
        var q = 0; for (var j = 0; j < k; j++) q += X[i][j] * t[j];
        var p = sigm(q), r = w[i] * (p - y[i]), v = w[i] * p * (1 - p);
        for (var j3 = 0; j3 < k; j3++) { g[j3] += X[i][j3] * r; for (var l = 0; l < k; l++) H[j3][l] += X[i][j3] * X[i][l] * v; }
      }
      for (var j4 = 0; j4 < k; j4++) { g[j4] += prec[j4] * (t[j4] - m0[j4]); H[j4][j4] += prec[j4] + 1e-9; }
      var step = solve(H, g), sc = 1, tn = t, fn = f;
      while (sc > 1e-6) {
        tn = t.map(function (x, j5) { return x - sc * step[j5]; });
        fn = obj(tn);
        if (fn <= f + 1e-12) break;
        sc *= 0.5;
      }
      var dmax = 0; for (var j6 = 0; j6 < k; j6++) dmax = Math.max(dmax, Math.abs(tn[j6] - t[j6]));
      var done = Math.abs(f - fn) < 1e-11 && dmax < 1e-9;
      t = tn; f = fn;
      if (done) break;
    }
    return t;
  }

  /** Fit a spec on history rows [{z (raw logit) or p, y, age (years before the fit date, > 0), flags}].
      opts: {halfLife, maxAge, lastN, sdA, sdB (default 0.25), segs, minN (default 60)}. */
  function fit(kind, rows, opts) {
    opts = opts || {};
    if (kind === "none") return { type: "none" };
    var segs = opts.segs || SEGMENTS, sdB = opts.sdB === undefined ? 0.25 : opts.sdB, minN = opts.minN || 60;
    var keep = rows.map(function (r) { return r.age > 0; });
    if (opts.lastN) {
      var order = rows.map(function (r, i) { return i; }).sort(function (a, b) { return rows[a].age - rows[b].age || a - b; });
      keep = rows.map(function () { return false; });
      for (var i = 0; i < Math.min(opts.lastN, order.length); i++) keep[order[i]] = rows[order[i]].age > 0;
    }
    var X = [], Y = [], W = [], neff = 0;
    for (var j = 0; j < rows.length; j++) {
      var r = rows[j];
      var w = !opts.halfLife ? 1 : Math.pow(0.5, r.age / opts.halfLife);
      if (opts.maxAge !== undefined && opts.maxAge !== null && r.age > opts.maxAge) w = 0;
      if (!keep[j]) w = 0;
      if (w > 0) {
        var z = r.z !== undefined ? r.z : logit(r.p, 1e-6);
        X.push(designRow(kind, z, r.flags, segs)); Y.push(r.y); W.push(w); neff += w;
      }
    }
    if (X.length < minN) return { type: "none", reason: "fewer than " + minN + " history rows" };
    var prec = function (sd) { return sd === undefined || sd === null ? 0 : 1 / (sd * sd); };
    var m0 = [1], pr = [prec(opts.sdA)];
    if (kind === "odd") { m0.push(0); pr.push(prec(sdB)); }
    if (kind === "segment") for (var s = 0; s < segs.length; s++) { m0.push(0); pr.push(prec(sdB)); }
    var th = fitGLM(X, Y, W, m0, pr);
    var spec = { type: kind, a: th[0], n_eff: neff };
    if (kind === "odd") spec.b = th[1];
    if (kind === "segment") { spec.d = {}; for (var s2 = 0; s2 < segs.length; s2++) spec.d[segs[s2]] = th[1 + s2]; }
    return spec;
  }

  function days(iso) { var d = new Date(iso + "T00:00:00Z"); return d.getTime() / 86400000; }

  /** Walk-forward refit as of an ISO date from scored rows [{date, p (raw), y, flags}]; rows on/after asOf ignored.
      cfg: {kind, halfLife, maxAge, lastN, sdA, sdB, segs} (calib.json production_cfg[head]). */
  function fitFromHistory(rows, asOf, cfg) {
    if (!cfg || !cfg.kind || cfg.kind === "none") return { type: "none" };
    var t0 = days(asOf);
    var hist = rows.filter(function (r) { return days(r.date) < t0; }).map(function (r) {
      return { p: r.p, y: r.y, flags: r.flags, age: (t0 - days(r.date)) / 365.25 };
    });
    return fit(cfg.kind, hist, cfg);
  }

  /** Mirrored calibration slope and Wald SE. */
  function slope(ps, ys) {
    var X = ps.map(function (p) { return [logit(p, 1e-6)]; }), w = ps.map(function () { return 1; });
    var b = fitGLM(X, ys, w, [1], [0])[0], info = 0;
    for (var i = 0; i < ps.length; i++) { var z = X[i][0], q = sigm(b * z); info += q * (1 - q) * z * z; }
    return { slope: b, se: 1 / Math.sqrt(Math.max(info, 1e-12)) };
  }

  /** Trailing-window monitor (rule 6.5.1 (b) reads ciIncludes1): last `window` scored bouts in time order. */
  function monitor(ps, ys, window) {
    window = window || 200;
    if (ps.length < window) return { n: ps.length, ready: false };
    var p = ps.slice(-window), y = ys.slice(-window), s = slope(p, y);
    var lo = s.slope - 1.96 * s.se, hi = s.slope + 1.96 * s.se;
    return { n: window, ready: true, slope: s.slope, ci: [lo, hi], ciIncludes1: lo <= 1 && 1 <= hi };
  }

  /** Calendar quarter ends from the quarter holding firstIso, strictly before asOfIso. */
  function quarterEnds(firstIso, asOfIso) {
    var y = +firstIso.slice(0, 4), q = Math.floor((+firstIso.slice(5, 7) - 1) / 3), out = [];
    var ends = ["03-31", "06-30", "09-30", "12-31"];
    for (;;) {
      var e = ("000" + y).slice(-4) + "-" + ends[q];
      if (e >= asOfIso) return out;
      out.push(e);
      if (++q === 4) { y++; q = 0; }
    }
  }

  /** Pre-registered drift rule 6.5.1 (b) on the forward ledger: rows [{date, p (production no-line stack P(A)), y}],
      quarter-end checks of the trailing-`window` slope before asOf; fires when two consecutive checks are ready and
      both CIs include 1. Same result as tools/calib.py drift_rule_b. */
  function ruleB(rows, asOf, window) {
    window = window || 200;
    var rs = rows.map(function (r, i) { return { d: r.date, i: i, p: +r.p, y: +r.y }; })
      .sort(function (a, b) { return a.d < b.d ? -1 : a.d > b.d ? 1 : a.i - b.i; });
    if (!rs.length) return { checks: [], fired: false, firedAt: null, setting: "h1.5" };
    var qs = quarterEnds(rs[0].d, asOf), checks = [], prev = false, firedAt = null;
    for (var k = 0; k < qs.length; k++) {
      var sel = rs.filter(function (t) { return t.d <= qs[k]; });
      var m = monitor(sel.map(function (t) { return t.p; }), sel.map(function (t) { return t.y; }), window);
      var inc = !!(m.ready && m.ciIncludes1);
      m.quarterEnd = qs[k];
      checks.push(m);
      if (inc && prev && firedAt === null) firedAt = qs[k];
      prev = inc;
    }
    return { checks: checks, fired: firedAt !== null, firedAt: firedAt, setting: firedAt ? "h3_T1" : "h1.5" };
  }

  return { SEGMENTS: SEGMENTS, BIGFAV_P: BIGFAV_P, segFlags: segFlags, apply: apply, fit: fit, fitGLM: fitGLM,
           fitFromHistory: fitFromHistory, slope: slope, monitor: monitor, quarterEnds: quarterEnds, ruleB: ruleB,
           logit: logit, sigm: sigm, VERSION: "1.1.0" };
});
