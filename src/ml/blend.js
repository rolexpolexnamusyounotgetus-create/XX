/* FightBlend: blend-anchored simulation, recalibration and uncertainty (engine component "blend_anchor", roadmap v9).

   The engine exposes it as FightEngine.predict(profA, profB, opts) when params.components.blend_anchor is true
   (src/params3.js; the flag off gives the plain engine package, whose numbers are FightEngine.summarize's).

   The package (research and numbers: the blend_anchor component report; data/derived/blend_anchor.json):
     1. P(win): the verified ML v2 package (v5 merge step 5; research/model_blindtest.md, research/model_ml2.md):
        the exported production stack data/derived/blindtest_stack.json in src/ml/moe.js's format, chosen by an EXPLICIT
        opts.lineKind: 'close' = the close-trained `model` (a fight-day line near the close, power de-vig), 'open' = the
        open-trained `model_open` (an opener or any earlier line, proportional de-vig; a close-trained stack fed an
        opener costs +0.0102 [+0.0057, +0.0145] on 2024-25), 'none' = the shared no-line block. A line without
        lineKind is refused. Experts: engine (this simulator, both corner orders), feat_lr (moe_page.json `feat`), elo,
        ml + elo_sig (the ML page model, ml.json), mkt_rating (market.json ratings), market (the line); any of them can
        be passed in opts.experts instead. ML v2's page logistic (src/ml/ml2.js, ml2.json page_model) and its page
        stacks are computed next to it (`ml2`); opts.winner = 'ml2' makes the lineKind-matched ML v2 page stack the
        headline instead. Then an optional temperature (params.blend.recalT; logit x T; 1 = none).
        BACKTESTS (opts.backtest = true): the loaded production stack (fit through 2025), the S model (fit through
        2026-10) and every live roster (ML page, ML v2, market ratings) are refused: pass a stacker fit on 2023 or
        earlier (opts.stack, with its fit_through; tools/blindtest.py export --fit-through 2023-12-31), walk-forward
        method/round cells (opts.mrCells) and walk-forward experts (opts.experts; tools/predictrec.js builds all three).
     2. Method x round: the simulator's cells (both corner orders) rescaled to that P(win) with MoE.winnerFactors
        (draw share and the within-winner method/round mix kept), pooled with the method/round model S/SM
        (tools/methodround_model.js, data/derived/methodround.json), also rescaled:
          cells = w * rescale(sim) + (1 - w) * rescale(S or SM),   w = params.blend.mrWeight (fit out-of-fold 2019-2023).
     3. Anchor mode (opts.anchor): a per-matchup skill offset s, split +s/2 for A and -s/2 for B, on the log-odds of
        striking accuracy (adj.acc x e^(cAcc s/2)), takedown success (opponent adj.tdDef x e^(-cTd s/2)) and knockdown
        power (adj.pow x e^(cPow s/2) / cosh(cPow s/2), mean-preserving), solved by regression steps on logit P_sim(s)
        with common random numbers so the simulator's own P(A) matches the blend. Mix 0.5 / 1 / 1 (params.blend.anchor),
        chosen on 2019-2023 because it hits the blend while improving the simulator's stat lines. Its stat lines and
        method/round cells then describe fights the blend believes in (e.g. the 3D show's traced fight).
     4. Stat lines: the ML stat-line model's per-minute rates when the matchup carries them (m.mlPred, src/ml/mlrates.js)
        next to the simulator's (plain or anchored), with expected totals over the package's expected fight length.
     5. Uncertainty: an interval for P(win) from a parametric bootstrap of fighter-profile noise (each profile's decayed
        sums S get fight-level gamma noise with dispersion / effective fights, plus count noise), propagated through
        the profile-driven experts (feature LR exactly; the ML expert by the same logit shift), with optional rating
        noise (Glicko RD on Elo, market-rating sd) and the simulator's Monte Carlo error, then through the blend. The raw
        bootstrap is too narrow (it covers the closing line 55% / 76% at 80% / 95%), so `calibrated` inflates its logit
        sd by params.blend.boot.inflate = 1.65 (80% / 94% out of fold on 2019-2023).

   Cell layout (methodround.json): [A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW], R = scheduled
   rounds; KO includes TKO, GNP, leg, doctor and corner stoppages. Every probability is P(first-named fighter A).

   UMD: module.exports in Node, self.FightBlend in a browser or Web Worker. No DOM; all randomness comes from the engine RNG (FightEngine.makeRng). */
(function (root, factory) {
  var api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FightBlend = api;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis), function (root) {
  "use strict";
  var VERSION = "1.2.0";   // 1.2.0 (engine v6): ML v2 winner heads by line regime (winner 'ml2stack', data/derived/v6_stacks.json), S2 method/round cells (tools/methodround_model.js createS2), debut method path, distributional stat lines; every v6 path is off unless params.blend switches it on, so 1.1.1 behaviour is unchanged for v5 params
  var VERSION_PREV = "1.1.1";   // 1.1.1 (v5.0.1): invalid market lines are refused, never treated as no line; 1.1.0 (v5 merge step 5): ML v2 package winner blend, opts.lineKind, backtest guard, v5 corner swaps
  var STATE = { stack: null, feat: null, ml2: null, mlPage: null, mktRatings: null, mr: null, mrModel: null, data: null,
    winnerStacks: null, mrS2: null, debut: null, statDist: null, ml2Trees: null, preufc: null };

  function clip(x, lo, hi) { return x < lo ? lo : (x > hi ? hi : x); }
  function logit(p) { p = clip(p, 1e-6, 1 - 1e-6); return Math.log(p / (1 - p)); }
  function sigm(z) { return 1 / (1 + Math.exp(-z)); }
  function isNum(x) { return typeof x === "number" && isFinite(x); }
  function own(o) { var r = {}; if (o) for (var k in o) r[k] = o[k]; return r; }

  function moeLib() {
    if (root && root.MoE) return root.MoE;
    if (typeof require === "function") { try { return require("./moe.js"); } catch (e) { return null; } }
    return null;
  }
  function mrLib() {
    if (root && root.MethodRound) return root.MethodRound;
    if (typeof require === "function") { try { return require("../../tools/methodround_model.js"); } catch (e) { return null; } }
    return null;
  }
  function ml2Lib() {
    if (root && root.ML2) return root.ML2;
    if (typeof require === "function") { try { return require("./ml2.js"); } catch (e) { return null; } }
    return null;
  }
  function debutLib() {
    if (root && root.DebutModel) return root.DebutModel;
    if (typeof require === "function") { try { return require("./debut.js"); } catch (e) { return null; } }
    return null;
  }
  function statLib() {
    if (root && root.StatDist) return root.StatDist;
    if (typeof require === "function") { try { return require("./statdist.js"); } catch (e) { return null; } }
    return null;
  }
  function treesLib() {
    if (root && root.ML2Trees) return root.ML2Trees;
    if (typeof require === "function") { try { return require("./ml2trees.js"); } catch (e) { return null; } }
    return null;
  }
  function mlPageLib() {
    if (root && root.MLPage) return root.MLPage;
    if (typeof require === "function") { try { return require("./mlpage.js"); } catch (e) { return null; } }
    return null;
  }

  // ------------------------------------------------------------------ defaults (params.blend overrides; see params3.js)
  var DEFAULTS = {
    sims: 1000,            // sims per corner order in predict()
    symmetric: true,       // run both corner orders (A-B and B-A) and average
    mrWeight: 0.15,        // weight of the rescaled simulator cells in the method/round pool (rest: S / SM); fit 2019-2023
    mrPool: "linear",      // linear (or "log") pool
    smooth: 0.5,           // Jeffreys pseudo-count per cell on the simulated cell counts before rescaling (0 = raw)
    recalT: 1,             // temperature on the blended logit (1 = none)
    anchor: { cAcc: 0.5, cTd: 1, cPow: 1, powNorm: true, slope0: 0.86, priorWeight: 2, iters: 4, step: 0.05, tol: 0.01, sims: 300, maxAbs: 4 },
    boot: { B: 200, seed: 7, level: [0.8, 0.95], cvOut: 0.45, cvGrap: 1.0, cvSub: 1.5, cvKd: 1.0, cvAcc: 0.25,
      count: true, eloRd: 0, eloRdScale: 0, mrSd: 0, engineMC: true, inflate: 1.65 },
    // engine v6 (cycle 1, docs/V6_V10_PLAN.md section 3); the defaults reproduce 1.1.1 (engine v5 params carry none of these)
    winner: "stack",       // 'stack' = the MoE expert stack (v5); 'ml2' = ML v2 page stack (v5 option); 'ml2stack' = v6 ML v2 heads
    ml2Head: "lr",         // ML v2 head inside the v6 stacks: 'blend' (LR + LightGBM + XGBoost, the CV choice) or 'lr'
    mrModel: "S",          // method/round model pooled with the simulator: 'S' (S / SM, v5) or 'S2' (v6: S2 cells, no SM)
    debut: false,          // v6: bouts with a UFC debutant take method given the winner from the debut model (src/ml/debut.js)
    statDist: false        // v6: distributional stat lines (src/ml/statdist.js, P10 / P50 / P90) next to the means
  };
  function cfgOf(p, opts) {
    var b = (p && p.blend) || {}, o = (opts && opts.blend) || {}, out = {}, k;
    for (k in DEFAULTS) out[k] = DEFAULTS[k];
    for (k in b) out[k] = b[k];
    for (k in o) out[k] = o[k];
    out.anchor = own(DEFAULTS.anchor); for (k in (b.anchor || {})) out.anchor[k] = b.anchor[k]; for (k in (o.anchor || {})) out.anchor[k] = o.anchor[k];
    out.boot = own(DEFAULTS.boot); for (k in (b.boot || {})) out.boot[k] = b.boot[k]; for (k in (o.boot || {})) out.boot[k] = o.boot[k];
    return out;
  }

  // ------------------------------------------------------------------ cells
  function nCells(R) { return 4 * R + 3; }
  function cellOf(f, R) {
    if (f.winner === "D") return 4 * R + 2;
    if (f.method === "UD" || f.method === "SD" || f.method === "MD") return f.winner === "A" ? 4 * R : 4 * R + 1;
    var r = clip((f.round | 0) || 1, 1, R) - 1, sub = f.method === "SUB";
    if (f.winner === "A") return (sub ? R : 0) + r;
    return (sub ? 3 * R : 2 * R) + r;
  }
  function fightMinutes(f, R) {
    if (f.method === "UD" || f.method === "SD" || f.method === "MD" || f.method === "DRAW") return 5 * R;
    return 5 * ((f.round || 1) - 1) + (f.t || 0) / 60;
  }
  function mirrorCells(c, R) {
    var q = new Array(c.length), i;
    for (i = 0; i < R; i++) { q[i] = c[2 * R + i]; q[2 * R + i] = c[i]; q[R + i] = c[3 * R + i]; q[3 * R + i] = c[R + i]; }
    q[4 * R] = c[4 * R + 1]; q[4 * R + 1] = c[4 * R]; q[4 * R + 2] = c[4 * R + 2];
    return q;
  }
  function sideSums(c, R) {
    var a = 0, b = 0, i;
    for (i = 0; i < 2 * R; i++) { a += c[i]; b += c[2 * R + i]; }
    return { pA: a + c[4 * R], pB: b + c[4 * R + 1], pD: c[4 * R + 2] };
  }
  /** Rescale cells so P(A wins) / (P(A) + P(B)) = p, keeping the draw share and the method/round mix within each
      winner (MoE.winnerFactors). */
  function rescale(c, R, p) {
    var s = sideSums(c, R), dec = Math.max(1e-12, 1 - s.pD), out = c.slice(), i;
    var fA = s.pA > 0 ? p * dec / s.pA : 0, fB = s.pB > 0 ? (1 - p) * dec / s.pB : 0;
    for (i = 0; i < 2 * R; i++) { out[i] *= fA; out[2 * R + i] *= fB; }
    out[4 * R] *= fA; out[4 * R + 1] *= fB;
    return out;
  }
  /** Jeffreys-smoothed cell probabilities from simulated counts: (n_c + a) / (N + a K). A finite run gives an outcome it
      never produced probability 0; a = 0.5 keeps it small but scoreable. */
  function smoothCells(cellN, a) {
    var N = 0, K = cellN.length, i, out = new Array(K);
    for (i = 0; i < K; i++) N += cellN[i];
    for (i = 0; i < K; i++) out[i] = N > 0 ? (cellN[i] + a) / (N + a * K) : 1 / K;
    return out;
  }
  function poolCells(a, b, w, kind) {
    var n = a.length, out = new Array(n), i, s = 0;
    if (kind === "log") {
      for (i = 0; i < n; i++) { out[i] = Math.exp(w * Math.log(Math.max(a[i], 1e-9)) + (1 - w) * Math.log(Math.max(b[i], 1e-9))); s += out[i]; }
      for (i = 0; i < n; i++) out[i] /= s;
      return out;
    }
    for (i = 0; i < n; i++) out[i] = w * a[i] + (1 - w) * b[i];
    return out;
  }
  /** Named marginals of a cell vector (methodround.py marginals()). */
  function marginals(c, R) {
    var o = { pA: 0, pB: 0, pD: c[4 * R + 2], xKO: 0, xSUB: 0, yKO: 0, ySUB: 0, finRound: [], koRound: [], subRound: [] }, i;
    for (i = 0; i < R; i++) {
      o.xKO += c[i]; o.xSUB += c[R + i]; o.yKO += c[2 * R + i]; o.ySUB += c[3 * R + i];
      o.koRound.push(c[i] + c[2 * R + i]); o.subRound.push(c[R + i] + c[3 * R + i]); o.finRound.push(o.koRound[i] + o.subRound[i]);
    }
    o.xDEC = c[4 * R]; o.yDEC = c[4 * R + 1];
    o.pA = o.xKO + o.xSUB + o.xDEC; o.pB = o.yKO + o.ySUB + o.yDEC;
    o.p = o.pA + o.pB > 0 ? o.pA / (o.pA + o.pB) : 0.5;
    o.pKO = o.xKO + o.yKO; o.pSUB = o.xSUB + o.ySUB; o.pDEC = o.xDEC + o.yDEC + o.pD; o.pFinish = o.pKO + o.pSUB;
    o.bins7 = [o.xKO, o.xSUB, o.xDEC, o.pD, o.yDEC, o.ySUB, o.yKO];
    o.methodGivenWin = {
      A: o.pA > 0 ? { ko: o.xKO / o.pA, sub: o.xSUB / o.pA, dec: o.xDEC / o.pA } : null,
      B: o.pB > 0 ? { ko: o.yKO / o.pB, sub: o.ySUB / o.pB, dec: o.yDEC / o.pB } : null
    };
    return o;
  }

  // ------------------------------------------------------------------ simulation runs
  var SK = ["sig_att", "sig_lnd", "h_att", "h_lnd", "b_att", "b_lnd", "l_att", "l_lnd", "d_att", "d_lnd", "c_att", "c_lnd",
    "g_att", "g_lnd", "kd", "td_att", "td_lnd", "ctrl", "sub_att", "rev"];
  /** N fights of matchup m with FightEngine.makeRng(seed): the same fights FightEngine.summarize(m, N, seed) plays.
      Returns cell probabilities, per-side stat sums, total minutes and minutes per cell. */
  function simCells(FE, m, N, seed) {
    var R = m.rounds, nc = nCells(R), cnt = new Float64Array(nc), cmin = new Float64Array(nc), rng = FE.makeRng(seed == null ? 1 : seed);
    var sA = new Float64Array(SK.length), sB = new Float64Array(SK.length), mins = 0, i, k;
    for (i = 0; i < N; i++) {
      var f = FE.simulate(m, rng, false), c = cellOf(f, R), mn = fightMinutes(f, R);
      cnt[c]++; cmin[c] += mn; mins += mn;
      var TA = f.totals.A, TB = f.totals.B;
      for (k = 0; k < SK.length; k++) { sA[k] += TA[SK[k]] || 0; sB[k] += TB[SK[k]] || 0; }
    }
    var cells = [], cm = [];
    for (k = 0; k < nc; k++) { cells.push(cnt[k] / N); cm.push(cnt[k] > 0 ? cmin[k] / cnt[k] : null); }
    return { R: R, n: N, cells: cells, cellMin: cm, cellN: Array.prototype.slice.call(cnt), sumA: Array.prototype.slice.call(sA),
      sumB: Array.prototype.slice.call(sB), minutes: mins };
  }
  function swapML(x) {
    if (!x || typeof x !== "object") return x;
    if (x.pred) { var y = own(x); y.pred = { A: x.pred.B, B: x.pred.A, base: x.pred.base }; return y; }
    if (x.A && x.B) { var z = own(x); z.A = x.B; z.B = x.A; return z; }
    return x;
  }
  function swapAB(x) {
    if (!x || typeof x !== "object" || Array.isArray(x)) return x;
    var y = own(x);
    if ("A" in x || "B" in x) { y.A = x.B; y.B = x.A; }
    if ("etaA" in x || "etaB" in x) { y.etaA = x.etaB; y.etaB = x.etaA; }
    return y;
  }
  /** Options for the B-A corner order: side-specific entries swapped. v5 merge step 5: also the v5 components' per-call
      inputs, so the mirrored run sees each fighter's own record: opts.dur (durability walk-forward records { A, B, base }),
      opts.sos (styles_sos { A, B }), opts.embed ({ etaA, etaB, recipe }), opts.oppadj ({ A, B }) and opts.preufc ({ A, B })
      (tools/durrec.js, sosrec.js and mlpathrec.js swap the same entries with the corners). */
  function swapOpts(o) {
    var s = own(o);
    s.adjA = o.adjB; s.adjB = o.adjA;
    if (o.ml && typeof o.ml === "object") s.ml = swapML(o.ml);
    if (o.preufcA != null || o.preufcB != null) { s.preufcA = o.preufcB; s.preufcB = o.preufcA; }
    ["dur", "sos", "embed", "oppadj", "preufc"].forEach(function (k) { if (o[k] && typeof o[k] === "object") s[k] = swapAB(o[k]); });
    return s;
  }
  /** Anchor offset s (log-odds) applied through the matchup knobs: A's striking accuracy odds x e^(cAcc s/2), B's
      x e^(-cAcc s/2); A's takedown success odds x e^(cTd s/2) (B's tdDef), B's x e^(-cTd s/2) (A's tdDef); optional
      knockdown power x e^(+-cPow s/2) / cosh(cPow s/2) (mean-preserving). s = 0 leaves the options untouched. */
  function anchorOpts(o, s, a) {
    if (!s) return o;
    var r = own(o), A = own(o.adjA), B = own(o.adjB), h = s / 2;
    function m(x) { return isNum(x) ? +x : 1; }
    A.acc = m(A.acc) * Math.exp(a.cAcc * h); B.acc = m(B.acc) * Math.exp(-a.cAcc * h);
    if (a.cTd) { B.tdDef = m(B.tdDef) * Math.exp(-a.cTd * h); A.tdDef = m(A.tdDef) * Math.exp(a.cTd * h); }
    if (a.cPow) {
      // mean-preserving split (powNorm): both multipliers divided by cosh(cPow s/2), so the pair's total knockdown rate stays
      // put while the ratio moves by e^(cPow s); without it the convex split adds knockdowns (+7% on 2019-2023)
      var cn = a.powNorm === false ? 1 : Math.cosh(a.cPow * h);
      A.pow = m(A.pow) * Math.exp(a.cPow * h) / cn; B.pow = m(B.pow) * Math.exp(-a.cPow * h) / cn;
    }
    r.adjA = A; r.adjB = B;
    return r;
  }
  /** Seeds for the A-B and B-A runs. Without explicit opts.seeds the pair is assigned by a canonical order of the two
      fighters (slug, then name), so predict(A, B) and predict(B, A) play exactly the same simulated fights and the
      package is exactly corner-symmetric (p(A, B) = 1 - p(B, A)). */
  function seedsOf(opts, pa, pb) {
    if (opts && opts.seeds && opts.seeds.length === 2) return [opts.seeds[0] >>> 0, opts.seeds[1] >>> 0];
    var s = opts && opts.seed != null ? opts.seed >>> 0 : 1, pair = [s, (s + 7919) >>> 0];
    return canonFlip(pa, pb) ? [pair[1], pair[0]] : pair;
  }
  /** true when B comes first in the canonical fighter order (slug, then name). */
  function canonFlip(pa, pb) {
    var ka = pa ? String(pa.slug || pa.name || "") : "", kb = pb ? String(pb.slug || pb.name || "") : "";
    return ka > kb;
  }
  /** Simulator run at anchor offset s: A-B (and B-A, mirrored back) with fixed seeds (common random numbers).
      Stats are per original side; p = P(A wins | decisive). */
  function symSim(FE, pa, pb, opts, N, seeds, s, acfg, symmetric) {
    var o1 = anchorOpts(opts, s, acfg), m1 = FE.matchup(pa, pb, o1), r1 = simCells(FE, m1, N, seeds[0]);
    var R = r1.R, out = { s: s, R: R, n: N, runs: 1, m: m1 }, i;
    if (symmetric !== false) {
      var m2 = FE.matchup(pb, pa, swapOpts(o1)), r2 = simCells(FE, m2, N, seeds[1]), c2 = mirrorCells(r2.cells, R), cm2 = mirrorCells(r2.cellMin, R);
      var n2 = mirrorCells(r2.cellN, R);
      out.cells = []; out.cellMin = []; out.cellN = [];
      for (i = 0; i < r1.cells.length; i++) {
        out.cells.push(0.5 * (r1.cells[i] + c2[i]));
        var nn = r1.cellN[i] + n2[i];
        out.cellN.push(nn);
        out.cellMin.push(nn > 0 ? ((r1.cellMin[i] || 0) * r1.cellN[i] + (cm2[i] || 0) * n2[i]) / nn : null);
      }
      out.sumA = r1.sumA.map(function (x, k) { return x + r2.sumB[k]; });
      out.sumB = r1.sumB.map(function (x, k) { return x + r2.sumA[k]; });
      out.minutes = r1.minutes + r2.minutes; out.runs = 2; out.m2 = m2;
    } else {
      out.cells = r1.cells; out.cellMin = r1.cellMin; out.cellN = r1.cellN; out.sumA = r1.sumA; out.sumB = r1.sumB; out.minutes = r1.minutes;
    }
    var ss = sideSums(out.cells, R);
    out.pA = ss.pA; out.pB = ss.pB; out.pD = ss.pD; out.p = ss.pA + ss.pB > 0 ? ss.pA / (ss.pA + ss.pB) : 0.5;
    out.avgMin = out.minutes / (N * out.runs);
    out.rates = { A: rateObj(out.sumA, out.minutes), B: rateObj(out.sumB, out.minutes) };
    return out;
  }
  function rateObj(sum, mins) { var o = {}; for (var k = 0; k < SK.length; k++) o[SK[k]] = mins > 0 ? sum[k] / mins : 0; return o; }

  // ------------------------------------------------------------------ anchor solver
  /** Root search for the offset s with P_sim(s) = target. The simulated P(s) is noisy (a few hundred fights per
      evaluation; the continuous-time event race diverges after any rate change, so common random numbers do not make
      it smooth), so every step refits logit P = a + beta s by least squares over all evaluated points, with beta
      shrunk toward the prior slope (slope0, fit on 2019-2023) and clipped to [slope0/3, 3 slope0], and solves for the
      target; it stops when the step falls under `step` or after `iters` evaluations. The last evaluation is the
      anchored run (its cells are rescaled exactly to the target afterwards). base = symSim at s = 0 when already run.
      Returns { s, p, target, iters, slope, history, sim }. */
  function anchor(FE, pa, pb, opts, target, cfg, base) {
    var a = cfg.anchor, N = (opts && opts.anchorSims) || a.sims, seeds = seedsOf(opts, pa, pb), sym = cfg.symmetric !== false;
    var zT = logit(clip(target, 0.005, 0.995)), b0 = a.slope0, wPrior = a.priorWeight == null ? 2 : a.priorWeight;
    var r0 = base && base.n === N ? base : symSim(FE, pa, pb, opts, N, seeds, 0, a, sym);
    function zOf(p) { return logit(clip(p, 0.002, 0.998)); }
    var hist = [{ s: 0, p: r0.p, z: zOf(r0.p) }], last = r0, beta = b0;
    if (Math.abs(r0.p - target) <= a.tol) return { s: 0, p: r0.p, target: target, iters: 0, slope: beta, history: hist, sim: r0 };
    var s = clip((zT - hist[0].z) / b0, -a.maxAbs, a.maxAbs);
    for (var it = 1; it <= a.iters; it++) {
      last = symSim(FE, pa, pb, opts, N, seeds, s, a, sym);
      hist.push({ s: s, p: last.p, z: zOf(last.p) });
      if (Math.abs(last.p - target) <= a.tol || it === a.iters) break;
      var n = hist.length, ms = 0, mz = 0, sxx = 0, sxz = 0, i;
      for (i = 0; i < n; i++) { ms += hist[i].s / n; mz += hist[i].z / n; }
      for (i = 0; i < n; i++) { sxx += (hist[i].s - ms) * (hist[i].s - ms); sxz += (hist[i].s - ms) * (hist[i].z - mz); }
      // OLS slope shrunk toward the prior: (wPrior * b0 + sxx * b_ols) / (wPrior + sxx)
      beta = clip((wPrior * b0 + sxz) / (wPrior + sxx), b0 / 3, 3 * b0);
      var sNew = clip(ms + (zT - mz) / beta, -a.maxAbs, a.maxAbs);
      if (Math.abs(sNew - s) < (a.step || 0.05)) break;
      s = sNew;
    }
    var h = hist[hist.length - 1];
    return { s: h.s, p: last.p, target: target, iters: hist.length - 1, slope: beta, history: hist, sim: last };
  }

  // ------------------------------------------------------------------ stacker (train-only refits; production uses MoE)
  function solve(H, g) {       // Gaussian elimination with partial pivoting: H x = g (small dense)
    var n = g.length, A = H.map(function (r, i) { return r.concat([g[i]]); }), i, j, k;
    for (i = 0; i < n; i++) {
      var piv = i; for (j = i + 1; j < n; j++) if (Math.abs(A[j][i]) > Math.abs(A[piv][i])) piv = j;
      var t = A[i]; A[i] = A[piv]; A[piv] = t;
      if (Math.abs(A[i][i]) < 1e-14) A[i][i] = 1e-14;
      for (j = i + 1; j < n; j++) { var f = A[j][i] / A[i][i]; for (k = i; k <= n; k++) A[j][k] -= f * A[i][k]; }
    }
    var x = new Array(n);
    for (i = n - 1; i >= 0; i--) { var s = A[i][n]; for (j = i + 1; j < n; j++) s -= A[i][j] * x[j]; x[i] = s / A[i][i]; }
    return x;
  }
  /** Non-negative, no-intercept logistic regression on expert logits: p = sigm(sum_k w_k x_k), w >= 0 (the MoE linear
      family; exactly corner-symmetric). X: rows of logits, y in {0,1}, wt: optional row weights. Projected Newton. */
  function nnLogit(X, y, wt, l2) {
    var n = X.length, k = n ? X[0].length : 0, b = [], i, j, l, it, lam = l2 == null ? 1e-4 : l2;
    for (j = 0; j < k; j++) b.push(1 / Math.max(1, k));
    function obj(bb) {
      var s = 0; for (i = 0; i < n; i++) { var z = 0; for (j = 0; j < k; j++) z += bb[j] * X[i][j]; var w = wt ? wt[i] : 1; s += w * ((z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z))) - y[i] * z); }
      for (j = 0; j < k; j++) s += 0.5 * lam * bb[j] * bb[j];
      return s;
    }
    var f0 = obj(b);
    for (it = 0; it < 100; it++) {
      var g = new Array(k).fill(0), H = []; for (j = 0; j < k; j++) H.push(new Array(k).fill(0));
      for (i = 0; i < n; i++) {
        var z = 0; for (j = 0; j < k; j++) z += b[j] * X[i][j];
        var p = sigm(z), w = wt ? wt[i] : 1, r = w * (p - y[i]), v = w * p * (1 - p);
        for (j = 0; j < k; j++) { g[j] += r * X[i][j]; for (l = j; l < k; l++) H[j][l] += v * X[i][j] * X[i][l]; }
      }
      for (j = 0; j < k; j++) { g[j] += lam * b[j]; H[j][j] += lam; for (l = 0; l < j; l++) H[j][l] = H[l][j]; }
      var free = []; for (j = 0; j < k; j++) if (b[j] > 1e-12 || g[j] < 0) free.push(j);
      if (!free.length) break;
      var Hf = free.map(function (a) { return free.map(function (c) { return H[a][c]; }); }), gf = free.map(function (a) { return -g[a]; });
      var d = solve(Hf, gf), t = 1, nb, f1;
      for (var ls = 0; ls < 30; ls++) {
        nb = b.slice(); free.forEach(function (a, q) { nb[a] = Math.max(0, b[a] + t * d[q]); });
        f1 = obj(nb);
        if (f1 <= f0 + 1e-12) break;
        t *= 0.5;
      }
      var step = 0; for (j = 0; j < k; j++) step = Math.max(step, Math.abs(nb[j] - b[j]));
      b = nb; var df = f0 - f1; f0 = f1;
      if (step < 1e-9 || df < 1e-11) break;
    }
    return b;
  }
  /** Temperature T minimising the (weighted) log loss of sigm(T z). */
  function fitTemp(z, y, wt) {
    var T = 1;
    for (var it = 0; it < 50; it++) {
      var g = 0, h = 0;
      for (var i = 0; i < z.length; i++) { var p = sigm(T * z[i]), w = wt ? wt[i] : 1; g += w * (p - y[i]) * z[i]; h += w * p * (1 - p) * z[i] * z[i]; }
      if (h <= 0) break;
      var st = g / h; T -= st;
      if (Math.abs(st) < 1e-10) break;
    }
    return clip(T, 0.2, 5);
  }

  // ------------------------------------------------------------------ profile-noise bootstrap
  function gammaDraw(rng, shape) {      // Marsaglia-Tsang, mean shape, using the engine RNG
    if (shape < 1) { var u = rng.u(); return gammaDraw(rng, shape + 1) * Math.pow(u < 1e-300 ? 1e-300 : u, 1 / shape); }
    var d = shape - 1 / 3, c = 1 / Math.sqrt(9 * d);
    for (;;) {
      var x = rng.normal(), v = 1 + c * x;
      if (v <= 0) continue;
      v = v * v * v; var uu = rng.u();
      if (uu < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(uu) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  function mult(rng, relVar) { if (!(relVar > 0)) return 1; var a = 1 / relVar; return gammaDraw(rng, a) / a; }
  // count / attempt families of the profile sums: offense volume, defense (opponent) volume, grappling, subs, KD
  var FAM = {
    out: ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "t_att"],
    oout: ["od_att", "oc_att", "og_att", "oh_att", "ob_att", "ol_att", "ot_att"],
    lnd: [["d_lnd", "d_att"], ["c_lnd", "c_att"], ["g_lnd", "g_att"], ["h_lnd", "h_att"], ["b_lnd", "b_att"], ["l_lnd", "l_att"], ["t_lnd", "t_att"]],
    olnd: [["od_lnd", "od_att"], ["oc_lnd", "oc_att"], ["og_lnd", "og_att"], ["oh_lnd", "oh_att"], ["ob_lnd", "ob_att"], ["ol_lnd", "ol_att"], ["ot_lnd", "ot_att"]],
    grap: ["td_att", "ctrl", "rev"], ograp: ["otd_att", "octrl", "orev"], tdl: [["td_lnd", "td_att"]], otdl: [["otd_lnd", "otd_att"]],
    sub: ["sub_att"], osub: ["osub_att"], kd: ["kd"], okd: ["okd"]
  };
  /** One bootstrap draw of a profile's decayed sums S (array in `keys` order): fight-level gamma noise with relative
      variance cv^2 / n_eff per family (n_eff = decayed fights, S.n) plus count noise 1 / count; landed counts follow
      their attempts and get an accuracy draw. Exposures (min, n, rds, r5_*) and win/loss method counts are kept. */
  function perturbS(S, keys, rng, b) {
    var I = {}, i; for (i = 0; i < keys.length; i++) I[keys[i]] = i;
    var out = S.slice(), neff = Math.max(0.5, +S[I.n] || 0.5);
    function g(k) { return I[k] != null ? +S[I[k]] || 0 : 0; }
    function cnt(x) { return b.count && x > 0 ? 1 / Math.max(x, 0.5) : 0; }
    function famVol(list, cv) {
      var f = mult(rng, cv * cv / neff);
      list.forEach(function (k) { if (I[k] == null) return; out[I[k]] = g(k) * f * mult(rng, cnt(g(k))); });
    }
    function famAcc(pairs) {
      pairs.forEach(function (pr) {
        var L = g(pr[0]), A0 = g(pr[1]), A1 = I[pr[1]] != null ? out[I[pr[1]]] : A0;
        if (I[pr[0]] == null || !(A0 > 0)) return;
        var acc = clip(L / A0, 1e-3, 0.999), rv = b.cvAcc * b.cvAcc / neff + (b.count ? (1 - acc) / Math.max(L, 0.5) : 0);
        out[I[pr[0]]] = Math.min(A1, A1 * acc * mult(rng, rv));
      });
    }
    famVol(FAM.out, b.cvOut); famVol(FAM.oout, b.cvOut); famAcc(FAM.lnd); famAcc(FAM.olnd);
    famVol(FAM.grap, b.cvGrap); famVol(FAM.ograp, b.cvGrap); famAcc(FAM.tdl); famAcc(FAM.otdl);
    famVol(FAM.sub, b.cvSub); famVol(FAM.osub, b.cvSub); famVol(FAM.kd, b.cvKd); famVol(FAM.okd, b.cvKd);
    return out;
  }
  function quant(xs, q) {
    var a = xs.slice().sort(function (x, y) { return x - y; }), t = q * (a.length - 1), lo = Math.floor(t), hi = Math.ceil(t);
    return a[lo] + (a[hi] - a[lo]) * (t - lo);
  }
  /** Interval for P(win). blendFn(experts) -> p (blend + recalibration); experts: point experts; featFn(drawIndex) ->
      logit shift of the feature LR under one profile draw (or null); ctx: { rdA, rdB, mrSd, engineN }. */
  function interval(blendFn, experts, featShift, ctx, b) {
    // ctx.sign (+1 / -1): orientation of the call relative to the canonical fighter order; the symmetric noise terms are
    // multiplied by it so that the two corner orders draw mirrored noise (exact interval symmetry)
    var rng = ctx.rng, B = b.B, ps = [], zs = [], i, sg = ctx.sign === -1 ? -1 : 1;
    var p0 = blendFn(experts);
    for (i = 0; i < B; i++) {
      var e = own(experts), d = featShift ? featShift(i) : 0;
      if (isNum(e.feat_lr) && d) e.feat_lr = sigm(logit(e.feat_lr) + d);
      if (isNum(e.ml) && d) e.ml = sigm(logit(e.ml) + d);
      if (isNum(e.ml2) && d) e.ml2 = sigm(logit(e.ml2) + d);   // ML v2's page logistic: a feature LR on the same stats
      if (isNum(e.elo) && (b.eloRdScale > 0)) {
        var rd = Math.sqrt(Math.pow(ctx.rdA || b.eloRd || 0, 2) + Math.pow(ctx.rdB || b.eloRd || 0, 2)) * b.eloRdScale;
        if (rd > 0) e.elo = sigm(logit(e.elo) + sg * Math.LN10 / 400 * rd * rng.normal());
      }
      if (isNum(e.elo_sig) && (b.eloRdScale > 0)) {
        var rd2 = Math.sqrt(Math.pow(ctx.rdA || b.eloRd || 0, 2) + Math.pow(ctx.rdB || b.eloRd || 0, 2)) * b.eloRdScale;
        if (rd2 > 0) e.elo_sig = sigm(logit(e.elo_sig) + sg * Math.LN10 / 400 * rd2 * rng.normal());
      }
      if (isNum(e.mkt_rating) && (ctx.mrSd || b.mrSd) > 0) e.mkt_rating = sigm(logit(e.mkt_rating) + sg * (ctx.mrSd || b.mrSd) * rng.normal());
      if (isNum(e.engine) && b.engineMC && ctx.engineN > 0) {
        var pe = clip(e.engine, 0.01, 0.99);
        e.engine = sigm(logit(pe) + sg * rng.normal() / Math.sqrt(ctx.engineN * pe * (1 - pe)));
      }
      var p = blendFn(e); ps.push(p); zs.push(logit(p));
    }
    var out = { p: p0, B: B, mean: ps.reduce(function (a, x) { return a + x; }, 0) / B, levels: {} };
    var zm = zs.reduce(function (a, x) { return a + x; }, 0) / B, zv = 0;
    zs.forEach(function (z) { zv += (z - zm) * (z - zm); });
    out.sdLogit = Math.sqrt(zv / Math.max(1, B - 1));
    (b.level || [0.8, 0.95]).forEach(function (lv) {
      out.levels[String(lv)] = [quant(ps, (1 - lv) / 2), quant(ps, 1 - (1 - lv) / 2)];
    });
    // calibrated interval: logit-normal around the point with the bootstrap sd inflated by kappa (b.inflate), the factor
    // that makes the 80% interval cover the closing line 80% of the time on 2019-2023 (profile noise alone is too narrow)
    if (b.inflate > 0) {
      var z0 = logit(p0);
      out.inflate = b.inflate; out.calibrated = {};
      (b.level || [0.8, 0.95]).forEach(function (lv) {
        var zq = normInv(1 - (1 - lv) / 2) * b.inflate * out.sdLogit;
        out.calibrated[String(lv)] = [sigm(z0 - zq), sigm(z0 + zq)];
      });
    }
    return out;
  }
  /** Standard normal quantile (Acklam's rational approximation, |error| < 1.2e-9). */
  function normInv(p) {
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.3577518672690, -30.66479806614716, 2.506628277459239],
      b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572],
      c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783],
      d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416], q, r;
    if (p < 0.02425) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    if (p > 1 - 0.02425) { q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }

  // ------------------------------------------------------------------ stat lines
  /** Per-minute rates from MLRates targets (per-side objects keyed by mlrates target names). */
  function mlStatRates(t) {
    if (!t) return null;
    var sa = t.d_att + t.c_att + t.g_att, sl = t.d_att * t.acc_d + t.c_att * t.acc_c + t.g_att * t.acc_g, hl = t.h_att * t.acc_h;
    return { sig_att: sa, sig_lnd: sl, h_att: t.h_att, h_lnd: hl, b_lnd: t.b_att * t.acc_b, l_lnd: t.l_att * t.acc_l, kd: hl * t.kd_h,
      td_att: t.td_att, td_lnd: t.td_att * t.td_acc, ctrl: t.ctrl, sub_att: t.sub_att, rev: t.rev };
  }
  function scaleRates(r, mins) { if (!r) return null; var o = {}; for (var k in r) o[k] = r[k] * mins; return o; }
  function expectedMinutes(cells, cellMin, R) {
    var e = 0, s = 0, i;
    for (i = 0; i < cells.length; i++) {
      var mm = cellMin && cellMin[i] != null ? cellMin[i] : (i >= 4 * R ? 5 * R : 5 * ((i % R) + 0.5));
      e += cells[i] * mm; s += cells[i];
    }
    return s > 0 ? e / s : 5 * R;
  }

  // ------------------------------------------------------------------ the winner blend (v5 merge step 5: the ML v2 package)
  var LBS = { "Flyweight": 125, "Bantamweight": 135, "Featherweight": 145, "Lightweight": 155, "Welterweight": 170,
    "Middleweight": 185, "Light Heavyweight": 205, "Heavyweight": 265, "Women's Strawweight": 115, "Women's Flyweight": 125,
    "Women's Bantamweight": 135, "Women's Featherweight": 145 };
  var STACK_BLOCK = { close: "model", open: "model_open", none: "model" };
  var FIT_KEY = { close: "moe_close", open: "moe_open", none: "moe_noline" };   // blindtest_stack.json meta.fit_info keys
  var BACKTEST_STACK_MAX = "2023-12-31";   // hidden-data protocol: a backtest stacker is fit on 2023 or earlier
  var VAULT_FROM = "2026-01-01";
  /** Last training date per block of a stacker document: blindtest_stack.json meta.fit_info (tools/blindtest.py export),
      else an explicit doc.fit_through (set by the caller, e.g. { model: moe.json model_validated, fit_through:
      "2023-12-31" }). Nothing is inferred from other metadata (moe.json's meta.train describes model_validated, not
      model). */
  function stackFitThrough(doc) {
    var m = (doc && doc.meta) || {}, out = {}, k, n = 0;
    if (m.fit_info) for (k in m.fit_info) if (m.fit_info[k] && m.fit_info[k].fit_through) { out[k] = m.fit_info[k].fit_through; n++; }
    if (doc && doc.fit_through) { out.all = doc.fit_through; n++; }
    return n ? out : null;
  }
  function fitThroughFor(ft, kind) {
    if (!ft) return null;
    if (ft[FIT_KEY[kind]]) return ft[FIT_KEY[kind]];
    if (ft.all) return ft.all;
    var mx = null; for (var k in ft) if (!mx || ft[k] > mx) mx = ft[k];
    return mx;
  }
  /** A stack handle from a stacker document in src/ml/moe.js's format: data/derived/blindtest_stack.json (close-trained
      `model` + open-trained `model_open`, the same no-line block in both), a moe.json / moe_page.json-style document
      (`model` only: no open-trained block, so lineKind 'open' is refused), a bare model block, a MoE.load() handle or a
      handle made here. */
  function stackOf(x, M) {
    if (!x) return null;
    if (x.isStack) return x;
    if (typeof x === "string") x = JSON.parse(x);
    if (x.predict && x.model) x = x.doc && x.doc.model ? x.doc : { model: x.model };   // a MoE.load() handle
    var doc = x.model ? x : { model: x };
    return { isStack: true, doc: doc, close: M.load(doc), open: doc.model_open ? M.load(doc, "model_open") : null,
      fitThrough: stackFitThrough(doc), built: doc.meta && doc.meta.built || null };
  }
  function featOf(x) { if (!x) return null; if (typeof x === "string") x = JSON.parse(x); return x.feat || (x.names && x.coef ? x : null); }
  function ml2Of(x) {
    if (!x) return null;
    if (x.predictSides && x.doc) return x;                         // an ML2.load() handle
    var L = ml2Lib(); if (!L) return null;
    return L.load(x);                                              // ml2.json or its page_model
  }
  function mlPageOf(x) {
    if (!x) return null;
    if (x.predict && x.has) return x;                              // an MLPage.load() handle
    var L = mlPageLib(); if (!L) return null;
    var d = typeof x === "string" ? JSON.parse(x) : x;
    if (d.page_model && d.roster) d = { snapshot: d.page_model.snapshot, winner: d.page_model.winner, stack: d.page_model.stack, roster: d.roster };
    return L.load(d);
  }
  function ratingsOf(x) {
    if (!x) return null;
    var d = typeof x === "string" ? JSON.parse(x) : x, R = d.ratings || d, out = {};
    for (var k in R) if (Array.isArray(R[k]) && R[k].length >= 2 && isNum(R[k][0]) && isNum(R[k][1])) out[k] = [R[k][0], R[k][1]];
    return out;
  }
  /** The market line and its kind. A line (opts.line American odds, opts.pMarket or opts.experts.market) needs an
      explicit opts.lineKind; 'close' de-vigs odds by the power method (the close-trained stack's construction), 'open'
      proportionally (the open-trained stack's: market.json p_novig_open); 'none' drops any line. */
  function lineOf(opts, ex, M) {
    var q = null, src = null, kind = opts.lineKind;
    // v5.0.1 (v5 review): a line counts only when it is valid: a probability strictly inside (0, 1), or American odds that are
    // finite with |odds| >= 100 and de-vig to a probability inside (0, 1). Invalid odds (0, NaN, 'abc') used to give a NaN
    // market expert, so a 'close' forecast silently became the no-line one while still reporting lineKind 'close'.
    function isP(x) { return isNum(x) && x > 0 && x < 1; }
    function isOdds(o) { o = +o; return isNum(o) && Math.abs(o) >= 100; }
    if (isP(ex.market)) { q = ex.market; src = "experts.market"; }
    else if (isP(opts.pMarket)) { q = opts.pMarket; src = "pMarket"; }
    else if (opts.line && isOdds(opts.line.oddsA) && isOdds(opts.line.oddsB)) src = "line";
    if (kind == null) {
      if (src) throw new Error("FightBlend.predict: a market line needs an explicit opts.lineKind: 'close' (a fight-day line near the " +
        "close: the close-trained stack `model`, power de-vig), 'open' (an opener or any earlier line: the open-trained `model_open`, " +
        "proportional de-vig) or 'none' (ignore the line)");
      kind = "none";
    }
    if (kind !== "close" && kind !== "open" && kind !== "none") throw new Error("FightBlend.predict: opts.lineKind must be 'close', 'open' or 'none', got " + kind);
    if (kind === "none") return { kind: "none", p: null, src: null, devig: null };
    if (!src) throw new Error("FightBlend.predict: opts.lineKind '" + kind + "' needs a line (opts.line { oddsA, oddsB }, opts.pMarket or opts.experts.market)");
    var dv = src === "line" ? (kind === "open" ? "proportional" : "power") : "as given";
    if (src === "line") q = M.devig(+opts.line.oddsA, +opts.line.oddsB, kind === "open" ? "mult" : undefined);
    if (!isP(q)) throw new Error("FightBlend.predict: opts.lineKind '" + kind + "' needs a line, and the one given does not de-vig to a probability in (0, 1)");
    return { kind: kind, p: q, src: src, devig: dv };
  }
  // ML v2 page stack (src/ml/ml2.js stackP): logit p = sum_i w_i logit(clip(input_i, pclip)); no intercept, so exactly
  // corner-symmetric
  function ml2StackP(st, inp) {
    if (!st || !st.inputs) return null;
    var z = 0, pc = st.pclip || 0.01;
    for (var i = 0; i < st.inputs.length; i++) {
      var q = inp[st.inputs[i]];
      if (!isNum(q)) { if (st.inputs[i] === "market" || st.inputs[i] === "open") return null; continue; }
      z += st.weights[i] * logit(clip(q, pc, 1 - pc));
    }
    return sigm(z);
  }
  var ML2_STACK = { none: "noline", close: "line", open: "open" };
  /** ML v2 next to the stack: { pA (ML v2 logistic), pMR (its market rating), stacks: { noline, line, open } (page
      stacks), p (the lineKind-matched page stack), stack (its name), weights (which stack weights) }. src: an ML2 handle
      (both fighters in its roster) or a precomputed { pA, pMR } (backtests: ml2.json rows), with stack weights from
      src.stack, opts.ml2Stack (e.g. forward_models.json ml2_static, fit 2019-2023) or the handle's page_model.stack. */
  function ml2Package(src, stackW, pa, pb, m, date, line) {
    if (!src) return null;
    var pA = null, pMR = null, W = stackW || null, h = src.predictSides ? src : null, note = null;
    if (h) {
      if (!pa.slug || !pb.slug || !h.has(pa.slug) || !h.has(pb.slug)) return { pA: null, note: "a fighter is not in the ML v2 roster" };
      var r = h.predict(pa.slug, pb.slug, { date: date, lbs: LBS[m.division] || 155, five: m.rounds === 5 ? 1 : 0 });
      if (!r) return { pA: null, note: "ML v2 returned no prediction" };
      pA = r.pA; pMR = r.pMR; W = W || h.doc.stack || null;
    } else {
      pA = isNum(src.pA) ? src.pA : null; pMR = isNum(src.pMR) ? src.pMR : null; W = W || src.stack || null;
      if (pA == null) return { pA: null, note: "no ML v2 probability given" };
    }
    if (!W) note = "no ML v2 stack weights";
    var inp = { ml2lr: pA, mkt_rating: pMR, market: line.kind === "close" ? line.p : null, open: line.kind === "open" ? line.p : null };
    var st = W ? { noline: ml2StackP(W.noline, inp), line: ml2StackP(W.line, inp), open: ml2StackP(W.open, inp) } : null;
    return { pA: pA, pMR: pMR, stacks: st, stack: ML2_STACK[line.kind], p: st ? st[ML2_STACK[line.kind]] : null, W: W, inp: inp, note: note };
  }

  // ------------------------------------------------------------------ data loading
  /** Load the blend's data once. Every part may be omitted; production page / ledger files:
        stack:       data/derived/blindtest_stack.json (the ML v2 package's exported stack; `model` + `model_open`)
                     (`moe` is an alias: a moe_page.json-style document loads as a stack without an open-trained block)
        feat:        data/derived/moe_page.json (its `feat` block: the feature LR expert feat_lr)
        mlPage:      data/derived/ml.json (page_model + roster: the `ml` and `elo_sig` experts)
        market:      data/derived/market.json (ratings: the `mkt_rating` expert)
        ml2:         data/derived/ml2.json (page_model: ML v2's page logistic and page stacks, src/ml/ml2.js)
        methodRound: data/derived/methodround.json (or its js_model: the S / SM method x round model)
        data:        data/derived/blend_anchor.json
      The production files are fit through 2025 (stack, ML v2) or 2026-10 (S, rosters): never for backtests. */
  function load(o) {
    o = o || {};
    var M = moeLib();
    if (o.stack !== undefined) STATE.stack = o.stack && M ? stackOf(o.stack, M) : null;
    else if (o.moe !== undefined) STATE.stack = o.moe && M ? stackOf(o.moe, M) : null;
    if (o.feat !== undefined) STATE.feat = featOf(o.feat);
    else if (o.moe !== undefined && o.stack === undefined) STATE.feat = featOf(o.moe && (o.moe.doc || o.moe));
    if (o.mlPage !== undefined) STATE.mlPage = mlPageOf(o.mlPage);
    if (o.market !== undefined) STATE.mktRatings = ratingsOf(o.market);
    if (o.ml2 !== undefined) STATE.ml2 = ml2Of(o.ml2);
    if (o.methodRound !== undefined) {
      var MR = mrLib(), jm = o.methodRound && (o.methodRound.js_model || o.methodRound);
      STATE.mrModel = jm || null;
      STATE.mr = jm && MR ? (jm.predict ? jm : MR.create(jm)) : null;
    }
    if (o.data !== undefined) STATE.data = o.data;
    // engine v6
    if (o.winnerStacks !== undefined) STATE.winnerStacks = o.winnerStacks || null;
    if (o.mrS2 !== undefined) STATE.mrS2 = o.mrS2 ? (o.mrS2.js_model || o.mrS2) : null;
    if (o.debut !== undefined) { var DL = debutLib(); STATE.debut = o.debut && DL ? { M: DL.load(o.debut.model || o.debut), lib: DL } : null; }
    if (o.statDist !== undefined) { var SL = statLib(); STATE.statDist = o.statDist && SL ? SL.load(o.statDist, { which: "prod" }) : null; }
    if (o.ml2Trees !== undefined) { var TL = treesLib(); STATE.ml2Trees = o.ml2Trees && TL ? TL.load(o.ml2Trees) : null; }
    if (o.preufc !== undefined) STATE.preufc = o.preufc || null;
    return { stack: !!STATE.stack, stackOpen: !!(STATE.stack && STATE.stack.open), feat: !!STATE.feat, mlPage: !!STATE.mlPage,
      market: !!STATE.mktRatings, ml2: !!STATE.ml2, methodRound: !!STATE.mr, data: !!STATE.data,
      winnerStacks: !!STATE.winnerStacks, mrS2: !!STATE.mrS2, debut: !!STATE.debut, statDist: !!STATE.statDist, ml2Trees: !!STATE.ml2Trees };
  }

  // ------------------------------------------------------------------ the package
  function resolveProf(FE, x) {
    if (typeof x === "string") { var p = FE.profile(x); if (!p) throw new Error("FightBlend: unknown fighter " + x); return p; }
    return x;
  }
  /** Backtest guard (opts.backtest): refuse production defaults and anything from the vault. */
  function backtestCheck(opts, date, stk, kind) {
    if (!date) throw new Error("FightBlend.predict (backtest): the fight date is required (opts.date)");
    if (date >= VAULT_FROM) throw new Error("FightBlend.predict (backtest): fights dated " + VAULT_FROM + " or later are sealed (vault), got " + date);
    if (!(opts.stack || opts.moe)) throw new Error("FightBlend.predict (backtest): pass a stacker fit on 2023 or earlier in opts.stack " +
      "(e.g. data/derived/blindtest_stack_pre2024.json); the loaded production stack is fit through 2025");
    if (!stk) throw new Error("FightBlend.predict (backtest): the stacker in opts.stack could not be loaded");
    var ft = fitThroughFor(stk.fitThrough, kind);
    if (!ft) throw new Error("FightBlend.predict (backtest): the stacker carries no fit_through (meta.fit_info or doc.fit_through)");
    if (ft > BACKTEST_STACK_MAX) throw new Error("FightBlend.predict (backtest): the stacker is fit through " + ft +
      "; a backtest stacker must be fit on 2023 or earlier");
    // a train-window fight inside the stacker's fit (opts.inSample, e.g. a pre-2024 stacker on a 2019-2023 fight) is allowed
    // only as an explicit in-sample diagnostic; validation fights always need a stacker fit before them
    if (ft >= date && !(opts.inSample === true && date < "2024-01-01")) throw new Error("FightBlend.predict (backtest): the stacker is fit through " +
      ft + ", which contains this fight (" + date + "); pass a stacker fit before it (per-year exports) or opts.inSample = true for a train-window diagnostic");
    if (opts.mrCells === undefined) throw new Error("FightBlend.predict (backtest): pass walk-forward method/round cells in opts.mrCells " +
      "(methodround.json fights[id].S, fit through the previous year; or false for simulator cells only); the loaded S model is fit through 2026-10");
    if (opts.mrCells && opts.mrFitThrough && opts.mrFitThrough >= date) throw new Error("FightBlend.predict (backtest): method/round cells fit through " +
      opts.mrFitThrough + " are not walk-forward for a fight on " + date);
    return ft;
  }
  /** FightEngine.predict with the component on. opts: the matchup options (division, rounds, title, date, priors, adjA,
      adjB, ml, dur, sos, embed, oppadj, preufc ...) plus sims, seed / seeds, lineKind ('close' | 'open' | 'none'), line
      { oddsA, oddsB } (American) or pMarket, experts { engine, feat_lr, elo, ml, elo_sig, mkt_rating, market }, stack
      (alias moe: a stacker document or handle), feat (+ featCoef), ml2 (handle, ml2.json, or { pA, pMR } precomputed) +
      ml2Stack, winner ('stack' default | 'ml2'), methodRound (handle / js_model), mrCells (precomputed S/SM cells, A-B
      orientation; false = simulator cells only) + mrFitThrough, anchor (true or config), interval (false to skip), blend
      (config overrides), recalT, backtest (true: refuse production defaults). ctx (from the engine): { meta (fighters.json
      meta for the feature LR), params (merged with opts.params) }. */
  function predict(FE, profA, profB, opts, ctx) {
    opts = opts || {}; ctx = ctx || {};
    var params = ctx.params || (FE.params ? FE.params() : null), cfg = cfgOf(params, opts), M = moeLib();
    var pa = resolveProf(FE, profA), pb = resolveProf(FE, profB), BT = !!opts.backtest;
    var N = opts.sims || cfg.sims, seeds = seedsOf(opts, pa, pb), sym = cfg.symmetric !== false;
    var meta = ctx.meta || {};
    // 0. the line and the stack it selects (explicit lineKind), and the backtest guard (before any simulation)
    var ex = own(opts.experts), line = lineOf(opts, ex, M);
    if (line.kind === "none") delete ex.market; else ex.market = line.p;
    var stk = (opts.stack || opts.moe) ? (M ? stackOf(opts.stack || opts.moe, M) : null) : (BT ? null : STATE.stack);
    var date0 = opts.date || null, stackFT = BT ? backtestCheck(opts, date0, stk, line.kind) : (stk ? fitThroughFor(stk.fitThrough, line.kind) : null);
    var moe = null, block = null;
    if (stk) {
      block = STACK_BLOCK[line.kind];
      moe = line.kind === "open" ? stk.open : stk.close;
      if (!moe) throw new Error("FightBlend.predict: lineKind 'open' needs an open-trained stack block (`model_open`, data/derived/blindtest_stack.json); " +
        "this stacker has only close-trained line weights");
    }
    // 1. the simulator (plain)
    var sim = symSim(FE, pa, pb, opts, N, seeds, 0, cfg.anchor, sym), R = sim.R, m = sim.m;
    // 2. experts and the blend
    if (!isNum(ex.engine)) ex.engine = sim.p;
    var date = opts.date || m.date || meta.snapshot || null, division = m.division, rounds = m.rounds;
    var feat = opts.feat ? featOf(opts.feat) : (BT ? null : STATE.feat), featCoef = opts.featCoef || (BT ? "coef_valid" : "coef");
    var sides = null;
    if (M && Array.isArray(pa.S) && Array.isArray(pb.S)) {
      var so = { keys: pa.keys || meta.keys || FE.KEYS, snapshot: meta.snapshot || null, halfLife: meta.half_life_days || 730 };
      sides = [M.sideFromProfile(pa, date, so), M.sideFromProfile(pb, date, so)];
      sides.opts = so;
      if (feat && !isNum(ex.feat_lr)) ex.feat_lr = M.featLR(feat, sides[0], sides[1], { division: division, homeA: sides[0].home, homeB: sides[1].home, coef: featCoef });
    }
    if (!isNum(ex.elo) && M && isNum(pa.elo) && isNum(pb.elo)) ex.elo = M.eloProb(pa.elo, pb.elo);
    if (!BT) {
      // live rosters (production / page / ledger only): the same experts tools/forward_ledger.js computes
      var mlp = STATE.mlPage;
      if (mlp && !isNum(ex.ml) && pa.slug && pb.slug && mlp.has(pa.slug) && mlp.has(pb.slug)) {
        var mr0 = mlp.predict(pa.slug, pb.slug, { date: date, lbs: LBS[division] || 155, five: rounds === 5 ? 1 : 0, title: m.title ? 1 : 0,
          women: /^Women/.test(division || "") ? 1 : 0, "catch": LBS[division] ? 0 : 1 });
        if (mr0 && isNum(mr0.pLR) && isNum(mr0.pEloSig)) { ex.ml = mr0.pLR; ex.elo_sig = mr0.pEloSig; }
      }
      var RT = STATE.mktRatings;
      if (RT && !isNum(ex.mkt_rating) && pa.slug && pb.slug && RT[pa.slug] && RT[pb.slug]) ex.mkt_rating = M.ratingProb(RT[pa.slug][0], RT[pa.slug][1], RT[pb.slug][0], RT[pb.slug][1]);
    }
    if (!(isNum(ex.ml) && isNum(ex.elo_sig))) { delete ex.ml; delete ex.elo_sig; }   // the MoE optional group: both or none
    var ml2live = !!(opts.ml2 && (opts.ml2.predictSides || opts.ml2.page_model || opts.ml2.terms));
    if (BT && ml2live) throw new Error("FightBlend.predict (backtest): opts.ml2 must be a precomputed walk-forward { pA, pMR } (ml2.json fights: " +
      "OOF 2019-2023, static fit < 2024 for 2024-2025), not the page model, whose roster and coefficients are fit through 2025");
    var ml2src = opts.ml2 ? (ml2live ? ml2Of(opts.ml2) : opts.ml2) : (BT ? null : STATE.ml2);
    var ml2 = ml2Package(ml2src, opts.ml2Stack || null, pa, pb, m, date, line);
    if (ml2 && isNum(ml2.pA)) ex.ml2 = ml2.pA;   // reported (and shifted in the interval); not an expert of the exported stack
    var gate = M && sides ? M.gateFromSides(sides[0], sides[1], { division: division, rounds: rounds, preufcA: opts.preufcA, preufcB: opts.preufcB }) :
      { rounds: rounds, division: division };
    var T = isNum(opts.recalT) ? opts.recalT : cfg.recalT;
    var winner = opts.winner || "stack";
    if (winner !== "stack" && winner !== "ml2") throw new Error("FightBlend.predict: opts.winner must be 'stack' or 'ml2', got " + winner);
    // The stack throws when no trained pattern fits the available experts (every stored pattern carries feat_lr, so a
    // manual profile without decayed sums S has none): fall back to the simulator alone and say why (verifier fix)
    var r = null, pRaw = ex.engine, source = "engine", blendError = null;
    if (moe) {
      try { r = moe.predict({ experts: ex, gate: gate }); pRaw = r.p; source = "stack"; } catch (err) { r = null; blendError = String((err && err.message) || err); }
    } else blendError = "no stacker loaded (FightEngine.loadBlend({ stack: blindtest_stack.json }) or opts.stack)";
    if (winner === "ml2") {
      if (ml2 && isNum(ml2.p)) { pRaw = ml2.p; source = "ml2"; }
      else blendError = (blendError ? blendError + "; " : "") + "winner 'ml2': " + ((ml2 && ml2.note) || "ML v2 not available") + ", kept " + source;
    }
    function blendP(e) {
      if (source === "ml2") {
        var inp = own(ml2.inp); inp.ml2lr = e.ml2;
        return sigm(T * logit(ml2StackP(ml2.W[ml2.stack], inp)));
      }
      if (!r) return sigm(T * logit(e.engine));
      return sigm(T * logit(moe.predict({ experts: e, gate: gate }).p));
    }
    var p = sigm(T * logit(pRaw));
    // 3. anchor mode
    var anc = null, cellSim = sim.cells, cellMin = sim.cellMin, rates = sim.rates;
    if (opts.anchor) {
      var acfg = own(cfg.anchor);
      if (typeof opts.anchor === "object") for (var k in opts.anchor) acfg[k] = opts.anchor[k];
      var cfgA = own(cfg); cfgA.anchor = acfg;
      var base = (acfg.sims === N) ? sim : null;
      anc = anchor(FE, pa, pb, opts, p, cfgA, base);
      cellSim = anc.sim.cells; cellMin = anc.sim.cellMin; rates = anc.sim.rates;
    }
    // 4. method x round (S without a line; SM only with a closing line: SM was fit with the closing line as a feature, so
    // an opener goes to S, the same close-vs-open rule as the winner stack). Backtests pass walk-forward cells (opts.mrCells).
    var mrCells = opts.mrCells || null, mrVariant = opts.mrCells ? (opts.mrVariant || "passed") : null;
    if (!mrCells && opts.mrCells !== false && !BT) {
      var MR = opts.methodRound ? (opts.methodRound.predict ? opts.methodRound : (mrLib() ? mrLib().create(opts.methodRound.js_model || opts.methodRound) : null)) : STATE.mr;
      if (MR && Array.isArray(pa.C) && Array.isArray(pb.C)) {
        try {
          var mo = MR.predict(pa, pb, { slugA: pa.slug, slugB: pb.slug, division: division, rounds: rounds, title: m.title, date: date,
            pMarketA: line.kind === "close" ? line.p : undefined });
          mrVariant = mo.variant;
          mrCells = [].concat(mo.cells.A.ko, mo.cells.A.sub, mo.cells.B.ko, mo.cells.B.sub, [mo.cells.A.dec, mo.cells.B.dec, mo.cells.draw]);
        } catch (e) { mrCells = null; }
      }
    }
    var w = isNum(opts.mrWeight) ? opts.mrWeight : cfg.mrWeight;
    var cellN = anc ? anc.sim.cellN : sim.cellN;
    if (cfg.smooth > 0 && cellN) cellSim = smoothCells(cellN, cfg.smooth);
    var simR = rescale(cellSim, R, p), cells = simR, mrR = null;
    if (mrCells && mrCells.length === cellSim.length) { mrR = rescale(mrCells, R, p); cells = poolCells(simR, mrR, w, cfg.mrPool); }
    else w = 1;
    var mg = marginals(cells, R);
    // 5. stat lines
    var expMin = expectedMinutes(cells, cellMin, R);
    var mlR = m.mlPred ? { A: mlStatRates(m.mlPred.A), B: mlStatRates(m.mlPred.B) } : null;
    var statLines = {
      minutes: expMin,
      sim: { perMin: rates, total: { A: scaleRates(rates.A, expMin), B: scaleRates(rates.B, expMin) }, anchored: !!anc },
      ml: mlR ? { perMin: mlR, total: { A: scaleRates(mlR.A, expMin), B: scaleRates(mlR.B, expMin) } } : null
    };
    // 6. uncertainty
    var iv = null;
    if (opts.interval !== false && cfg.boot.B > 0) {
      var rng = FE.makeRng(cfg.boot.seed >>> 0), featShift = null;
      // exact corner symmetry of the interval (verifier fix): the profile draws are made in the canonical fighter order
      // (the one seedsOf uses) and the rating / Monte Carlo noise is mirrored, so predict(B, A) draws the same noise for
      // the same fighter and its interval is the mirror image of predict(A, B)'s
      var flip = canonFlip(pa, pb);
      if (M && feat && (r || source === "ml2") && sides) {
        var keys = sides.opts.keys, f0 = logit(M.featLR(feat, sides[0], sides[1], { division: division, homeA: sides[0].home, homeB: sides[1].home, coef: featCoef }));
        var shifts = [];
        for (var bI = 0; bI < cfg.boot.B; bI++) {
          var qa = own(pa), qb = own(pb);
          if (flip) { qb.S = perturbS(pb.S, keys, rng, cfg.boot); qa.S = perturbS(pa.S, keys, rng, cfg.boot); }
          else { qa.S = perturbS(pa.S, keys, rng, cfg.boot); qb.S = perturbS(pb.S, keys, rng, cfg.boot); }
          var sa = M.sideFromProfile(qa, date, sides.opts), sb = M.sideFromProfile(qb, date, sides.opts);
          shifts.push(logit(M.featLR(feat, sa, sb, { division: division, homeA: sa.home, homeB: sb.home, coef: featCoef })) - f0);
        }
        featShift = function (i) { return shifts[i]; };
      }
      iv = interval(blendP, ex, featShift, { rng: rng, rdA: opts.rdA, rdB: opts.rdB, mrSd: opts.mrSd, engineN: N * sim.runs, sign: flip ? -1 : 1 }, cfg.boot);
    }
    return {
      component: "blend_anchor", version: VERSION, on: true, source: source, blendError: blendError,
      p: p, pRaw: pRaw, recalT: T, pA: mg.pA, pB: mg.pB, pD: mg.pD,
      experts: ex, blend: r ? { weights: r.weights, contrib: r.contrib, used: r.used, regime: r.regime || null, scale: r.scale, ignored: r.ignored } : null,
      // v5 merge step 5: which line, which stack block, which headline, and ML v2 next to it
      lineKind: line.kind, line: line.kind === "none" ? null : { kind: line.kind, p: line.p, src: line.src, devig: line.devig },
      winner: source === "ml2" ? "ml2" : "stack",
      stack: stk ? { block: block, regime: r ? r.regime || null : null, fitThrough: stackFT, built: stk.built, from: (opts.stack || opts.moe) ? "opts" : "loaded" } : null,
      ml2: ml2 ? { pA: ml2.pA, pMR: ml2.pMR, stacks: ml2.stacks || null, stack: ml2.stack || null, p: isNum(ml2.p) ? ml2.p : null, note: ml2.note || null } : null,
      backtest: BT ? { date: date, stackFitThrough: stackFT, inSample: !!(stackFT && date && stackFT >= date), mrCells: opts.mrCells ? "passed" : "none",
        mrFitThrough: opts.mrFitThrough || null } : null,
      cells: cells, R: R, marginals: mg, bins7: mg.bins7,
      methodRound: { weight: w, pool: cfg.mrPool || "linear", variant: mrVariant, simRescaled: simR, mrRescaled: mrR },
      sim: { p: sim.p, pA: sim.pA, pB: sim.pB, pD: sim.pD, cells: sim.cells, n: N, runs: sim.runs, avgMin: sim.avgMin, rates: sim.rates },
      // anchor.adjA / adjB: the knobs that reproduce the anchored matchup (e.g. FightEngine.matchup(a, b, {..., adjA, adjB})
      // for the 3D show's traced fight)
      anchor: anc ? { s: anc.s, p: anc.p, target: anc.target, iters: anc.iters, slope: anc.slope, history: anc.history, cells: anc.sim.cells,
        rates: anc.sim.rates, adjA: anchorOpts(opts, anc.s, cfgA.anchor).adjA || null, adjB: anchorOpts(opts, anc.s, cfgA.anchor).adjB || null } : null,
      statLines: statLines, interval: iv
    };
  }

  return {
    VERSION: VERSION, DEFAULTS: DEFAULTS, SK: SK, load: load, state: function () { return STATE; }, predict: predict,
    // building blocks (backtests, tests)
    cfgOf: cfgOf, cellOf: cellOf, nCells: nCells, mirrorCells: mirrorCells, sideSums: sideSums, rescale: rescale, poolCells: poolCells, smoothCells: smoothCells,
    marginals: marginals, simCells: simCells, symSim: symSim, swapOpts: swapOpts, anchorOpts: anchorOpts, anchor: anchor,
    nnLogit: nnLogit, fitTemp: fitTemp, perturbS: perturbS, interval: interval, mlStatRates: mlStatRates,
    expectedMinutes: expectedMinutes, logit: logit, sigm: sigm
  };
});
