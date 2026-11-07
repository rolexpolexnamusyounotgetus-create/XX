/* Fight engine global parameters (engine v10 = the v4 simulator's parameters unchanged + v8's stat-line blocks (components
   embed / retarget / tdIntent / ctrlSpread, embed, retarget, spread) exactly as v8 shipped them + v7's prediction package
   (components.blend_anchor, blend) + cycle 5 (blend.debutWinner, components.explainer, explainer); the file name stays
   params3.js for every version).
   Fight engine global parameters (engine v4; the file name stays params3.js for every version).
   UMD: module.exports in Node, self.FightParams / window.FightParams in the browser.
   One plain object. Every entry carries a comment with its meaning and its source or default.
   Sources: data/derived/combine_fit.json (shrinkage, combination), data/derived/baserates.json and
   baserates_tables.md (league base rates), data/derived/priors_dev.json (train-only division priors, fights
   2018-01-01..2023-12-31), research/modeling_literature.md (age, chin), research/data_baserates.md and
   data/derived/judgecal.json (judging).
   v4 (Nov 6, 2026):
   - [selfcal v4] values: league-average self-calibration against the TRAIN-ONLY priors
     (node tests/test_engine3.js 8000 --fit --write --priors data/derived/priors_dev.json). v3's [selfcal] values had been
     fit to all-years priors (2018..2026-10, incl. validation and the vault).
   - [judgecal] values: tools/judgecal.js, maximum likelihood on the 2019-2023 judges' rounds (judgerounds_rows.json).
   - Global-scale re-tune (tools/mlcal.py, spec tools/mlcal_spec_engine4.json, learned rates on through the out-of-fold
     hook, TRAIN only, --no-val): no candidate beat the self-calibrated values on both train windows (tuning 1,300
     fights and confirmation 672 fights), so the search adopted nothing (data/derived/mlcal_candidates_v4.json).
   - [levels v4] values: tools/v4_levels.js, a dampened fixed point on 1,000 TRAIN fights with the learned rates on
     (out-of-fold), matching knockdowns per landed head strike, the KO/TKO and submission shares and the 10-8 share
     (data/derived/v4_levels.json). The self-calibrated league level ran ~10% low on knockdowns there.
   - [walkfwd] values left from v3 (tools/calibrate.js on 2019-2023 with walk-forward priors): form sds, caution5,
     r1Caution5, drainSchedExp, age / KO-loss / size coefficients, powExp, chinExp, ctrlScale.
   Units inside the engine: seconds and per-second rates unless a comment says otherwise. */
(function (root) {
  "use strict";
  var FightParams = {
    version: "10.0.0-selfcal-pre2024",   // v10 (docs/V6_V10_PLAN.md cycles 1-3 + 5 consolidated): v4's simulator values unchanged ([selfcal] fit to train-only priors, data/derived/priors_dev.json, fights before 2024-01-01) + v8's blocks (components, embed, retarget, spread) + v7's blend block + cycle 5 (blend.debutWinner, explainer). Labels before: 8.0.0 / 7.0.0 / 4.0.0-selfcal-pre2024

    // ---------------- v8 components (stat-line fidelity; docs/V6_V10_PLAN.md cycle 3; engine3.js header) ----------------
    // Each sub-part acts only when its flag is true; all false = engine 4.0.0 bit for bit (tests/test_v8.js). Defaults = the
    // sub-parts kept by the binding train gate (data/derived/v8/gate_protocol.json, tools/v8_gate.py RULES).
    components: {
      // v10: v7's prediction package (FightEngine.predict = the blend block below; false: the plain engine package, summarize).
      // On without FightBlend: predict throws (V6_V10_PLAN 7.1 item 10 h)
      blend_anchor: true,
      // v10 cycle 5: FightEngine.showFight draws the shown fight's winner x method x round from predict()'s cells (block explainer)
      explainer: true,
      embed: true,       // embedding blend of the learned stat-line targets (block embed; needs opts.embed or a loaded roster)
      retarget: true,    // realised-rate retarget toward the statlines layer (block retarget; needs opts.statTargets or opts.statdist)
      tdIntent: true,    // fight-level mean-1 lognormal takedown intent per fighter (spread.td); acts only on a retargeted matchup
      ctrlSpread: true   // fight-level mean-1 lognormal top-stint length per fighter (spread.ctrl); acts only on a retargeted matchup
    },
    // embedding blend recipe (= data/derived/embed_model.json mlrates_blend.targets, fit on mlrates' 2019-2023 out-of-fold rows;
    // the v6 engine's block): link(rate) = b[0] + b[1] link(mlrates rate) + b[2] eta[task]. Backtests pass fold-honest
    // coefficients per call (data/derived/embed_blend_fh.json coef_fh[year], fit on 2019..year-1; tools/mlpathrec.js).
    embed: {
      tasks: ["d_att", "c_att", "g_att", "h_att", "b_att", "l_att", "ns_att", "d_acc", "c_acc", "g_acc", "h_acc", "b_acc", "l_acc", "kd", "td_att", "td_acc", "ctrl", "sub_att", "rev", "ko_fin", "sub_fin"],
      recipe: {
        d_att: { task: "d_att", link: "log", b: [-0.069982, 0.711099, 0.322209] },
        c_att: { task: "c_att", link: "log", b: [-0.003585, 0.581088, 0.406225] },
        g_att: { task: "g_att", link: "log", b: [-0.038304, 0.657976, 0.37345] },
        h_att: { task: "h_att", link: "log", b: [-0.177151, 0.725199, 0.360312] },
        b_att: { task: "b_att", link: "log", b: [-0.000881, 0.686235, 0.32603] },
        l_att: { task: "l_att", link: "log", b: [0.01211, 0.796754, 0.202168] },
        td_att: { task: "td_att", link: "log", b: [0.043751, 0.573656, 0.425045] },
        sub_att: { task: "sub_att", link: "log", b: [0.352258, 0.851244, 0.229988] },
        rev: { task: "rev", link: "log", b: [-0.490037, 0.88882, 0.0] },
        ctrl: { task: "ctrl", link: "log", b: [0.064459, 0.557073, 0.455859] },
        acc_h: { task: "h_acc", link: "logit", b: [0.011774, 0.521711, 0.515074] },
        acc_b: { task: "b_acc", link: "logit", b: [0.07556, 0.554021, 0.388165] },
        acc_l: { task: "l_acc", link: "logit", b: [-0.011057, 0.481682, 0.51298] },
        acc_d: { task: "d_acc", link: "logit", b: [-0.011446, 0.434249, 0.503721] },
        acc_c: { task: "c_acc", link: "logit", b: [0.19873, 0.255241, 0.563796] },
        acc_g: { task: "g_acc", link: "logit", b: [0.014659, 0.946195, 0.0] },
        td_acc: { task: "td_acc", link: "logit", b: [-0.056387, 0.889465, 0.0] },
        kd_h: { task: "kd", link: "log", b: [-0.703483, 0.849507, 0.0] }
      }
    },
    // realised-rate retarget (engine3.js retarget): design constants set before any gate number (not tuned): pilot simulations
    // per corner order and iteration, iterations, damping and the shrink of the step toward 1 with few decision simulations
    // (s = damp x n / (n + kDec)), smoothing of the realised rates toward the target (kMin minutes, kAcc attempts), pilot seed
    retarget: { pilot: 200, iters: 2, damp: 0.9, kDec: 20, kMin: 5, kAcc: 5, seed: 20261107 },
    // fight-level spread draws: lognormal sds (mean 1), fit to the 2019-2023 PIT coverage (non-binding development runs before the
    // gate protocol, embed + retarget on, 150 sims per order, seed 1; data/derived/v8/dev/spread_fit_td*.json, spread_fit_ctrl*.json):
    // td = the smallest grid value whose train takedown-attempt PIT meets the plan's band (inside the 80% band >= 0.78, above P90
    // <= 0.12): 1.1 (0.781 / 0.117; v4 0.68 / 0.16; the PIT-uniformity minimum is 1.25-1.3, whose extra spread costs Monte Carlo
    // noise in the per-fight means); ctrl = the minimiser of the control PIT calibration error given td 1.1: 0 (the takedown-intent
    // draw alone brings control to 0.799 / 0.101 / 0.100), so components.ctrlSpread is a no-op at this value
    spread: { td: 1.1, ctrl: 0 },

    // ---------------- engine v7 / v10: the prediction package (FightEngine.predict; src/ml/blend.js 1.4.0) ----------------
    // mrWeight and props.w below: written before the v10 gate protocol from a NON-BINDING fits-only run of the v10 package
    // (data/derived/v10/dev_fits.json; no metric, no comparator); the binding gate refits every weight forward-chained.
    blend: {
      sims: 1000,          // simulations per corner order in predict() (both orders run and averaged; exact corner symmetry)
      symmetric: true,     // run A-B and B-A (common random numbers)
      smooth: 0.5,         // Jeffreys pseudo-count per method x round cell on the simulated counts
      // cycle 1 (V6_V10_PLAN section 3), re-bundled onto the v4 simulator through v7's own gate (7.1 item 10): the winner is the ML v2
      // head stack of the EXPLICIT line regime (no line = ML v2 + market rating, h 1.5; open = opener + ML v2; close = closing line +
      // ML v2; data/derived/v6_stacks.json, production fit 2019-2025, backtests the forward-chained fits); an opener never reaches
      // close-trained weights; method x round = mrWeight x rescaled simulator cells + (1 - mrWeight) x rescaled S2 cells
      winner: "ml2stack",
      ml2Head: "blend",    // ML v2 LR + LightGBM + XGBoost (the CV choice; JS tree evaluator src/ml/ml2trees.js on the page / ledger)
      mrModel: "S2",
      mrPool: "linear",
      mrWeight: 0.15,   // weight of the rescaled v4-simulator cells in the S2 pool: the w in 0..1 step 0.05 minimising the no-line package's joint
                           // method x round log loss on 2019-2023 (tools/v7_gate.py fits, the rule of tools/predict_score.py; the train gate uses the
                           // forward-chained fits for 2021 / 2022 / 2023 instead: 0.20 / 0.20 / 0.20; data/derived/v7/dev_fits.json, a non-binding
                           // fits-only run of the v7 package, reproduced by the binding gate). v6 (v5.0.1 simulator): 0.35; v4-engine cells with S: 0.15
      debut: true,         // bouts with a UFC debutant: method given the winner from the debut method model (lab 3, research/model_debut.md)
      // v10 cycle 5 (newcomer path; src/ml/blend.js 1.4.0): a bout with a UFC debutant takes its WINNER from the line where there is
      // one (the line-only stack of that line kind, data/derived/line_stack.json), else the seeded Elo (opts.seededElo), never from the
      // ML v2 head / MoE stack / simulator; the debut winner model is reported as a monitored candidate only. This is the verified
      // adoption block of data/derived/debut.json (model.adoption: winner_noline fallback_seeded_elo, open / close line, method debut),
      // the routing fwd-4.2 already uses in the forward ledger. The backtest universe has no debut bouts, so no scored number moves.
      debutWinner: true,
      statDist: true,      // P10 / P50 / P90 stat lines (lab 3, research/model_statlines.md); page / ledger only, never a backtest score
      recalT: 1,           // no temperature on top of the stacks (the no-line stack carries its recency weighting)
      lineFallback: null,  // 1.2.1: with 'ml2stack' a line is never dropped (line-only stack, data/derived/line_stack.json)
      // anchor mode (opts.anchor; explainer only): slope0 0.86 is the v4-engine pilot (120 fights x 3 offsets x 400 sims, se 0.014)
      anchor: { cAcc: 0.5, cTd: 1, cPow: 1, powNorm: true, slope0: 0.86, priorWeight: 2, iters: 4, step: 0.05, tol: 0.01, sims: 300, maxAbs: 4 },
      // interval (live only; backtests score none): profile-noise bootstrap; kappa 1.65 for the expert-stack construction on the v4
      // engine; the head stack has its own kappa (tools/v6_kappa.js, data/derived/v6/review/kappa_ml2stack.json)
      boot: { B: 200, seed: 7, level: [0.8, 0.95], cvOut: 0.45, cvGrap: 1.0, cvSub: 1.5, cvKd: 1.0, cvAcc: 0.25, count: true,
        eloRd: 0, eloRdScale: 0, mrSd: 0, engineMC: true, inflate: 1.65, inflateMl2stack: { none: 1.2569, open: 1.3691, close: 1.3691 } },
      // cycle 2 (V6_V10_PLAN section 3; research/model_props.md, verified, adopted as hygiene): with method props (opts.props), method
      // given the winner = the joint-linear pool [w_cells, w_props] of the package cells' and the props' mixes, each weighted by its
      // own P(side wins); round shapes stay the cells' (round props failed the CV gate); draw = drawC x P(decision); winner untouched.
      props: {
        on: true,
        mode: "jlin",        // the CV-chosen form (log-linear 0.0017 worse in forward-chained CV 2022-23)
        w: [0.47, 0.53],   // fit on 2021-2023 close-regime fights with method props: the w_cells in 0..1 step 0.01 minimising method
                             // given the winner log loss of the pooled cells (tools/v7_gate.py fits, cells with the 2019-2023 mrWeight); the
                             // train gate uses the forward-chained fits (2021 -> 2022: 0.48; 2021-22 -> 2023: 0.44; data/derived/v7/dev_fits.json).
                             // research/model_props.md (S2 cells as the model expert): 0.46 / 0.54
        fitThrough: "2023-12-31",   // the weights' last training date (the backtest guard refuses them for fights on or before it)
        decShift: 0,         // labeled knob: logit shift on DEC within method given the winner. 0: the forward-chained CV rejected a decision
                             // tilt (+0.0018, research/model_props.md table 4); the market over-prices finishes, calibrate to outcomes only
        drawC: 0.01457,      // P(draw) = drawC x P(decision) (data/derived/props.json model.draw_c, fit 2021-2023)
        outlierMaxDev: 0.15, // de-vig: with >= 3 books, drop a book whose key scalar is > 0.15 from the median (outcome-blind; props.json)
        overMax: { m6: 1.6, gd: 1.25, er: 1.8, wr: 2.2, mr: 2.6, itd: 1.25, ou: 1.25 },   // implausible-overround caps per family (props.json)
        debutPool: false     // debut bouts keep the debut method model; true only reports the debut-bout props pool (monitored, never applied)
      }
    },

    // ---------------- engine v10 cycle 5: explainer coherence (FightEngine.showFight; engine3.js explainer block) ----------------
    explainer: {
      on: true,          // with components.explainer: the shown fight's cell is a draw from predict()'s cells
      maxTries: 400,     // seeds searched for a fight landing in the drawn cell (untraced), then the hit is replayed traced
      seed: 1            // default show seed (opts.showSeed overrides; the page passes a fresh seed per "new fight")
    },

    // ---------------- learned stat-line rates (engine v4) ----------------
    mlWeight: 1,      // blend of the learned matchup rates (FightEngine.loadMLRates; src/ml/mlrates.js) vs the base tables: 1 = learned, 0 = base
    mlMaxRatio: 4,    // cap on any single learned-vs-base multiplier (src/ml/mlrates.js applyToMatchup maxRatio)

    // ---------------- profile estimation (shrinkage toward the fight division's priors) ----------------
    kPM: 40,          // per-minute rate prior strength, fight-minutes of division-average fighting (combine_fit meta.shrink_k_default.pm)
    kAcc: 150,        // accuracy-by-target prior strength, attempts (combine_fit shrink_k_default.acc; fit alone preferred 300)
    kTdPM: 45,        // takedown attempts per minute prior strength, fight-minutes (combine_fit td_pm)
    kTdAcc: 12,       // takedown accuracy prior strength, attempts (combine_fit td_acc)
    kKD: 230,         // knockdowns per landed head strike (power and chin) prior strength, landed head strikes (combine_fit kd)
    kCtrlTD: 4,       // control seconds per takedown (top skill / bottom escape) prior strength, takedowns (literature 12.3: 3-5)
    kSub: 5,          // submission conversion and submission defense prior strength, attempts (literature: FightLab 4)
    kRev: 40,         // reversal (sweep) rates prior strength, fight-minutes (same scale as kPM)
    kPace: 15,        // per-round pace ratio prior strength, minutes fought in that round (literature 12.3: ~3 five-round fights)
    kTgt: 80,         // distance target-mix prior strength, attempts (default)
    combA: 1,         // log-linear exponent on the attacker's ratio (combine_fit: pure a=b=1 beat the free fit and averaging held-out)
    combB: 1,         // log-linear exponent on the defender's allowed ratio (same source)
    powExp: 1.104,        // [walkfwd 2026-11-06; was 1] exponent on the shrunk power ratio (KD scored per landed head strike vs division); same knockdown regression
    chinExp: 0.5463,       // [walkfwd 2026-11-06; was 1] exponent on the shrunk chin ratio (KD absorbed per landed head strike absorbed vs division); Poisson regression of actual knockdowns on predicted (chin history predicts less than the raw ratio)
    ctrlScale: 1.004,     // [walkfwd 2026-11-06; was 1] global scale on each pair's control-time target (1 / get-up scale); moment-matched to control per minute in the walk-forward backtest

    // ---------------- positions ----------------
    ctrlGroundShare: 0.84,   // share of ufcstats control time spent on the ground; rest is clinch control (baserates est 0.89 main, 0.79 alt; midpoint)
    clinchTimeExp: 0.5,      // share (as exponent) of a pair's excess clinch striking explained by more clinch time, rest by higher clinch output (default)
    clinchBreak: 1 / 20,     // clinch separation hazard per second: mean clinch about 20 s (default; clinch entry is fit per pair)
    clinchSwap: 1 / 60,      // per second, the controlled man reverses the clinch position (default)
    clinchCtrlStrike: 1.2,   // clinch strike rate multiplier for the controller; the controlled man gets 2 - x (default)
    clinchCtrlTemper: 0.8,   // clinch controller share = 0.5 + temper * (ctrl share - 0.5) (default)
    standClinch: 0.35,       // share of stand-ups that come up into a clinch on the fence (control continues) (default; ufcstats counts it as control)
    tdClinchMult: 5,         // takedown attempt rate per second in the clinch as controller, relative to distance (default)
    tdClinchUnder: 1.5,      // same for the man being controlled (default)
    tdClinchOdds: 1.25,      // takedown success odds multiplier from the clinch (default)
    tdLand: [0.55, 0.33, 0.07, 0.0, 0.05], // landing sub-position after a takedown: guard, half, side, mount, back (default)
    failTdClinch: 0.25,      // share of stuffed shots at distance that end in a clinch, shooter controlling (default)
    groundReset: 1 / 1500,   // referee stand-up (stalling) hazard per second on the ground (default; rare in UFC)

    // ground sub-positions: 0 guard, 1 half, 2 side, 3 mount, 4 back
    // top man's advance hazards per second, from -> to (scaled by the top man's grappling edge)
    pass: [[0, 1 / 75, 0, 0, 1 / 600],      // guard -> half, guard -> back (scramble)
           [0, 0, 1 / 60, 0, 1 / 260],      // half -> side, half -> back
           [0, 0, 0, 1 / 85, 1 / 170],      // side -> mount, side -> back
           [0, 0, 0, 0, 1 / 110],           // mount -> back (he turns)
           [0, 0, 0, 0, 0]],
    // bottom man's escape hazards per second, from -> to (scaled by the bottom man's grappling edge)
    retain: [[0, 0, 0, 0, 0],
             [1 / 80, 0, 0, 0, 0],          // half -> guard
             [0, 1 / 55, 0, 0, 0],          // side -> half
             [0, 1 / 65, 0, 0, 0],          // mount -> half (bridge / elbow escape)
             [1 / 90, 1 / 140, 0, 0, 0]],   // back -> guard (turns in), back -> half
    standPos: [1.0, 0.85, 0.6, 0.3, 0.75],  // stand-up hazard multipliers by sub-position (normalized per pair) (default)
    sweepPos: [1.4, 0.9, 0.45, 0.35, 0.15], // sweep / reversal hazard multipliers by sub-position (normalized) (default)
    gnpPos: [0.75, 0.95, 1.15, 1.5, 1.1],   // top ground-strike rate multipliers by sub-position (normalized) (default)
    gnpTkoPos: [0.35, 0.6, 1.0, 2.6, 1.9],  // GNP TKO hazard multipliers per landed ground head strike (baserates: mount 4.9%, back 4.1%, guard/half 2.4% of KOs)
    subTopPos: [0.3, 0.55, 1.0, 1.9, 5.0],  // top submission attempt rate multipliers (normalized; baserates: back 47% of subs, RNC 44%)
    subBotPos: [1.0, 0.45, 0.12, 0.05, 0.02], // bottom (guard player) submission attempt multipliers (normalized)
    subOddsPos: [0.6, 0.75, 0.9, 1.1, 1.7], // conversion odds multipliers by top sub-position (normalized by attempt mix) (default)
    subBotOdds: 0.75,        // conversion odds multiplier for attempts from the bottom (default)
    subStandOdds: 0.9,       // conversion odds multiplier for standing guillotines on stuffed shots (default)
    subBotShare: 0.17,       // share of ground submission attempts thrown from the bottom (baserates: 16% bottom)
    subStandShare: 0.05,     // share of submission attempts that are standing (guillotine on a shot) (baserates: standing 3.2% of finishes; guillotine 17% overall)
    subStam: 0.2,            // defender fatigue: conversion odds x (1 + subStam (1 - S)) (default)
    subHurt: 2.0,            // conversion odds multiplier while the defender is hurt (default)
    subFailLose: 0.22,       // a failed top submission costs the top man position (back to guard / half) this often (default)
    gBotRel: 0.12,           // bottom man's ground strike rate relative to the top man's (default)

    // ---------------- strikes ----------------
    strikeScale: 1.094,      // [selfcal v4: train-only priors_dev.json; v3 walkfwd 1.107] global strike-attempt scale (absorbs exposure-estimate bias)
    clinchScale: 1.074,      // [selfcal v4: train-only priors_dev.json] clinch strike-rate scale
    groundScale: 0.8362,     // [selfcal v4: train-only priors_dev.json] ground strike-rate scale
    clinchMix: [0.55, 0.33, 0.12],   // clinch target mix head/body/leg (default; leg = knees to the thigh)
    groundTopMix: [0.84, 0.15, 0.01], // top ground-strike target mix (default)
    groundBotMix: [0.6, 0.4, 0.0],    // bottom ground-strike target mix (default)
    accScale: 0.9539,        // [selfcal v4: train-only priors_dev.json; v3 walkfwd 1.021] global accuracy odds scale (centers the fatigue / hurt / mobility modifiers on the data)
    botAccOdds: 0.6,         // accuracy odds multiplier for strikes thrown from the bottom (default)
    accHurt: 1.5,            // accuracy odds multiplier against a hurt defender (default)
    accStam: 0.25,           // defender fatigue: odds x (1 + accStam (1 - S_def)) (default)
    accMob: 1.2,             // defender leg damage: odds x (1 + accMob (1 - mobility)) (default)
    accSelfStam: 0.2,        // attacker fatigue: odds x (1 - accSelfStam (1 - S_att)) (default)
    outStam: 0.12,           // attacker fatigue: output x (1 - outStam (1 - S)) (default)
    outHurt: 0.65,           // output multiplier while hurt (default)
    outMob: 0.15,            // output x (1 - outMob (1 - mobility)) (default)

    // ---------------- damage, knockdowns, finishes ----------------
    kdScale: 1.391,          // [levels v4: tools/v4_levels.js on 2019-2023 fights, learned rates on; v3 walkfwd 1.246] global knockdown scale on p0 (division KD per landed standing head strike)
    kdPos: [1.0, 2.561],     // [selfcal v4: train-only priors_dev.json] KD multiplier for distance, clinch head strikes; fit so clinch stoppages are 12.5% of strike KO/TKOs (baserates; knees and elbows)
    kdBodyRatio: 0.05,       // KD chance per landed standing body strike relative to head (baserates: body 5.5% of KO/TKOs)
    kdDmg: 800,              // accumulated head damage: KD x (1 + D / kdDmg) (literature 3.2: damage effect is weaker than fatigue and selection)
    kdHurt: 1.8,             // KD multiplier while hurt (default)
    kdStamDef: 0.2,          // defender fatigue: KD x (1 + kdStamDef (1 - S_def)) (default)
    kdStamAtt: 1.1,          // attacker fatigue cuts power: KD x max(0.05, 1 - kdStamAtt (1 - S_att)) (literature 3.2: per-strike KD falls ~50% from R1 to R5)
    kdPaceExp: -1.2,         // KD x paceCurve(r)^kdPaceExp: later-round extra volume is lower-power work (literature 3.2) (default)
    kdRepeat: 1.15,          // each knockdown absorbed multiplies his KD susceptibility for the rest of the fight (default)
    chinAge0: 34,            // age where chin and power aging start (research/modeling_literature.md 3.3, 5)
    chinAge: 0.04109,           // [walkfwd 2026-11-06; was 0.04] chin x exp(chinAge * max(0, age - chinAge0)) (within-fighter x1.21 at 34-36, x1.35 at 37+; partly in the decayed stats already)
    powAge: 0.1152,            // [walkfwd 2026-11-06; was 0.03] power x exp(-powAge * max(0, age - chinAge0)); knockdown regression (older attackers score fewer knockdowns than predicted: -0.097 +- 0.028 per year at the start)
    chinKO: 0.1238,            // [walkfwd 2026-11-06; was 0.04] chin x (1 + chinKO) ^ prior KO losses, capped by chinKOcap; knockdown regression
    chinKOcap: 1.15,         // cap on the prior-KO-loss chin multiplier
    sizeChin: 0,          // [walkfwd 2026-11-06; was 0.05] chin x exp(sizeChin * (lbs_fight - lbs_home) / 10) when fighting above his home division; knockdown regression found no extra knockdowns for men moving up (-0.16 +- 0.08), so 0
    sizePow: 0.03,           // power x exp(-sizePow * (lbs_fight - lbs_home) / 10) for the man moving up (default, small)
    hurtRatio: 2.0,          // P(hurt | landed standing head strike, no KD) = hurtRatio * p_KD (default)
    hurtSecs: 14,            // seconds a non-KD hurt lasts (default)
    hurtKdSecs: 25,          // seconds of hurt after surviving a knockdown (v2: 25)
    dmgKD: 12,               // head damage added by a knockdown (v2: 14)
    dmgHurt: 4,              // head damage added by a hurt (v2: 5)
    dmgPos: [1.0, 0.9, 0.8, 0.3],   // head damage per landed head strike: distance, clinch, ground top, ground bottom (v2 0.8 / 0.3 on the ground)
    powDmgExp: 0.5,          // damage per landed head strike = (power ratio)^powDmgExp (v2: sqrt)
    dmgHeal: 0.06,           // share of head damage that clears between rounds (default)

    kdInstant: 0.3673,       // [levels v4: tools/v4_levels.js on 2019-2023 fights, learned rates on; v3 walkfwd 0.3175] P(knockdown is an immediate knockout), x damage, fatigue and division factors; scaled on odds with kdRefStop, stko and gnpTko (koAll 0.771) to the 2019-2023 KO share
    kdInstantDmg: 600,       // instant-KO x (1 + D / kdInstantDmg) (default)
    finStamAtt: 1.0,         // attacker fatigue: GNP TKO, follow-up referee stop and submission conversion x max(0.05, 1 - finStamAtt (1 - S_att)) (finish hazards fall by round while output rises)
    instStam: 1.0,           // attacker fatigue: instant-KO odds x (1 - instStam (1 - S_att)) (default)
    kdPounce: 0.72,          // P(attacker follows him down) after a knockdown that isn't a KO (default)
    kdRecover: 1 / 6.5,      // per second, the downed man recovers (to guard or his feet) (default; the follow-up length kdRefStop is fit against)
    kdRecoverStand: 0.45,    // share of recoveries that get back to the feet; the rest recover guard with the attacker on top (default)
    kdGnpRate: 1.1,          // ground strikes per second in the follow-up flurry (default)
    kdGnpAcc: 0.78,          // landing probability of follow-up ground strikes (default)
    kdRefStop: 0.184,       // [levels v4: tools/v4_levels.js on 2019-2023 fights, learned rates on; v3 walkfwd 0.153] P(referee stops it) per landed follow-up head strike, x damage and fatigue factors
    refDmg: 600,             // follow-up referee stop odds x (1 + D / refDmg) (default; small: finish hazard falls by round in the data)
    kdFinRef: 0.6,           // league P(same-round finish | KD) the follow-up was tuned for; division kd_fin rescales on odds (priors kd_fin, LW 0.60)
    stko: 0.03644,           // [levels v4: tools/v4_levels.js on 2019-2023 fights, learned rates on; v3 walkfwd 0.03439] standing TKO hazard per landed standing head strike while hurt, x (stkoBase + D/100); fit so stoppages without a KD are ~7% of KO/TKOs (baserates 0.049 vs 0.509 per 100 standing head landed)
    gnpTko: 0.03072,           // [levels v4: tools/v4_levels.js on 2019-2023 fights, learned rates on; v3 walkfwd 0.02467] GNP TKO hazard per landed top ground head strike (x sub-position, damage, fatigue); fit so ground stoppages are 28% of strike KO/TKOs (baserates)
    stkoBase: 0.3,           // standing TKO hazard while hurt = stko x (stkoBase + D / 100) (default)
    gnpDmg: 600,             // GNP TKO x (1 + D / gnpDmg) (default)
    gnpHurt: 2.0,            // GNP TKO multiplier while hurt (default)
    legDmgScale: 120,        // leg damage units for a full mobility loss scale: mobility = 1 - G / legDmgScale, floored (default)
    legMobFloor: 0.55,       // mobility floor (default)
    legTko0: 30,             // leg damage threshold for leg-kick TKO risk (v2: 30)
    legTko: 0.0018,          // leg TKO hazard per landed leg kick per 10 units above the threshold (baserates: leg 0.7% of KO/TKOs)
    bodyDrain: 0.0035,       // stamina drained by a landed body strike, x damage weight (default)

    // ---------------- stamina and pace ----------------
    drain: 0.0011,           // base stamina drain per second at league-average cardio in a 3-round fight (S starts at 1; ~0.4 by the end of R3; shapes the finish hazard by round)
    r1Caution5: 0.75,        // [walkfwd 2026-11-06] round 1 of 5-round fights: knockdown, GNP TKO and submission conversion x this (baserates per-minute finish hazard R1 5-rd 0.0463 vs 3-rd 0.0576 = 0.80; main-event caution)
    drainSchedExp: 0.2,      // [walkfwd 2026-11-06] drain x (3 / scheduled rounds)^drainSchedExp: some pacing in 5-rounders (small: baserates 5-rd hazard falls to ~11% in R4-R5, so the championship rounds stay grueling)
    caution5: 0.6258,             // [walkfwd 2026-11-06; was 1] 5-round fights: knockdown, GNP TKO and submission conversion x this in every round (on top of r1Caution5); fit to the 5-round finish rate (2019-2023: 53.5%)
    drainPos: [1.0, 1.5, 0.9, 1.6],   // drain multiplier at distance, clinch, ground top, ground bottom (default)
    drainAtt: 0.0,           // stamina per strike attempt thrown (0: activity drain is carried by the pace term, drain x (0.6 + 0.4 x output); available for tuning)
    drainTd: 0.006,          // stamina per takedown attempt (shooter) (default)
    recover: 0.55,           // between rounds S += recover * (1 - S) (v2: 0.5)
    cardioExp: 1.5,          // drain x cardioIndex^-cardioExp, cardioIndex = shrunk late-round output ratio (default)
    pace5: [1.0, 1.181, 1.195, 1.234, 1.259],  // league attempts by round vs R1, 5-round fights that went the distance (baserates pace_att_ratio_5rd_went_distance)
    pace3: [1.0, 1.104, 1.148],                // same, 3-round fights (baserates pace_att_ratio_3rd)
    paceLnd5: [1.0, 1.2, 1.2, 1.23, 1.23],     // league landed/min by round vs R1, for each fighter's pace ratio (priors ALL pace5)
    paceLnd3: [1.0, 1.11, 1.13],               // same for 3-round data (priors ALL pace3)

    // ---------------- grappling scales ----------------
    tdAttStam: 0.0,          // attacker fatigue: takedown attempts x (1 - tdAttStam (1 - S)); 0 because attempts rise by round in the data (baserates pace curve)
    tdStam: 0.15,            // defender fatigue: takedown success odds x (1 + tdStam (1 - S_def)) (small: baserates TD accuracy falls by round in 5-rounders)
    standStam: 0.3,          // bottom man's fatigue: stand-up hazard x (1 - standStam (1 - S)) (default)
    tdScale: 1.018,          // [selfcal v4: train-only priors_dev.json; v3 walkfwd 0.9724] takedown attempt rate scale
    tdOddsScale: 0.9018,     // [selfcal v4: train-only priors_dev.json; v3 walkfwd 0.9103] takedown success odds scale
    sweepScale: 1.0,         // sweep / reversal rate scale (default; reversals come from each pair's data rates)
    subAttScale: 1.085,      // [selfcal v4: train-only priors_dev.json; v3 walkfwd 1.042] submission attempt rate scale
    subConvScale: 1.847,     // [levels v4: tools/v4_levels.js on 2019-2023 fights, learned rates on; v3 walkfwd 1.619] submission conversion odds scale
    gilloScale: 1.0,         // standing guillotine attempts on stuffed shots scale

    // ---------------- fight-night form (sds; every multiplicative draw is a mean-1 lognormal) ----------------
    form: {
      out: 0.3573,      // [walkfwd 2026-11-06; was 0.15] lognormal sd of each man's output; fit so the per-fight landed-rate spread matches how far real fights fall from the engine mean (dispersion ratio 2.07 -> 1.00; includes model error, not just form)
      vol: 0.6,      // [walkfwd 2026-11-06] lognormal sd of a shared fight volatility on both men's knockdown odds: wars vs tactical fights (stands in for matchup heterogeneity; baserates finish hazard falls by round)
      pace: 0.3287,     // [walkfwd 2026-11-06; was 0.1] lognormal sd of a shared fight pace (both men); fit to the A/B landed-rate residual covariance (data 0.117 vs sim 0.046 at the start)
      acc: 0.4783,      // [walkfwd 2026-11-06; was 0.12] logit-normal sd of accuracy; fit to the per-fight accuracy spread vs the engine mean (dispersion ratio 2.44 -> 1.00)
      pow: 0.3162,      // [walkfwd 2026-11-06; was 0.45] lognormal sd of power; fit to the round-1 share of 3-round finishes (falling hazard) on 2019-2023 fights
      chin: 0.3162,     // [walkfwd 2026-11-06; was 0.45] lognormal sd of chin; tied to pow
      cardio: 0.15,   // lognormal sd of cardio (drain) (default)
      grap: 0.3,     // [walkfwd 2026-11-06] lognormal sd of grappling (TD odds, control, passes, sub attempts) (default)
      sub: 0.80,      // lognormal sd of submission offense and of submission defense (attempts x sqrt, conversion odds x); sub hazard falls ~2:1 from R1 to R3 (priors fin3)
      roundOut: 0.15, // lognormal sd of each man's output per round (round sig-landed var/mean 8.3; round-to-round corr 0.58)
      roundPace: 0.10 // lognormal sd of the shared pace per round (default)
    },

    // ---------------- judging ----------------
    // v4: EM round-winner fit over all 7,550 ufcstats cards with only 10-9 rounds (docs/BACKLOG.md "Judging";
    // research/data_baserates.md item 12), logit per landed differential. Noise, tastes and the 10-8 rule are fit to the
    // 2019-2023 judges' rounds in data/derived/judgerounds_rows.json by tools/judgecal.js (train years only).
    judge: {
      head: 0.179, body: 0.133, leg: 0.105,   // per landed sig strike differential to head / body / leg (EM fit)
      kd: 2.42,                               // per knockdown (EM fit; 13.5 head strikes)
      td: 0.286,                              // per takedown landed (EM fit)
      ctrlMin: 0.46,                          // per minute of control (EM fit; ufcstats control includes clinch control)
      sub: 0.85,                              // per submission attempt (EM fit)
      hurt: 0.8,                              // per hurt/wobble scored (engine-only event, not in ufcstats: about 1/3 of a knockdown; judgment call)
      power: 0.25,                            // default judges.power: extra credit for power-weighted head damage beyond the strike count (v2 judgePower 0.25)
      sharedSd: 1.416,                        // [judgecal] sd of the noise shared by the three judges (logits; ML on 2019-2023 rounds 1.531, less the engine-only hurt / power terms' residual variance)
      sharedFight: 0.3303,                    // [judgecal] share of the shared variance drawn once per fight (persists across rounds; data 0.283 of 1.531^2, LR 101): panel residuals correlate ~0.12 between rounds of a fight
      indSd: 1.079,                           // [judgecal] sd of each judge's own noise (logits)
      tasteSd: 0,                             // lognormal sd of each judge's fight-level taste for striking / grappling / damage; 0 in v4: a judge who dissents twice in a fight does so in either direction equally often (judgecal: no fight-level taste; v3 0.2 from literature 12.5)
      t108: 8.555,                            // [judgecal 7.07 on real rounds; levels v4 8.555: simulated decision rounds give the 2021-2023 3.5% 10-8 share on train fights] a judge scores 10-8 when his |z| exceeds t108 - t108kd x min(2, winner's KD edge); 2021-2023 threshold (2019-2020: 6.29; 10-8 share 3.6% vs 5.9%)
      t108kd: -1.087                          // [judgecal] threshold change per knockdown of edge; negative: z already carries 2.42 per KD, and judges give a 10-8 to 13% of KD-edge round winners, not the 23% that z alone implies
    },

    // ---------------- between rounds ----------------
    doc: 0.06,               // doctor stoppage hazard between rounds: doc * (D/100)^2, capped (sweep: ~0.7 per 100 league-average 3-round fights; baserates doctor 0.76 per 100 all, 1.5 LW, 1.55 in 5-rounders)
    docCap: 0.2,             // cap per interval
    corner: 0.03,            // corner stoppage hazard: corner per KD absorbed beyond the first, plus corner * (D/120)^3 (sweep: ~0.1 per 100 3-round fights; baserates corner 0.13 all, 0.35 LW, 0.52 in 5-rounders)

    // ---------------- division self-calibration factors ([selfcal v4]: train-only priors_dev.json; neutral = 1) ----------------
    // att: strike-attempt scale; kd: knockdown scale; ko: scales kdInstant and kdRefStop odds and the stko / gnpTko hazards;
    // sub: submission conversion odds; ctrl: control target scale; td: takedown attempt scale.
    div: {
      "Flyweight": { att: 0.987, kd: 1.013, ko: 0.583, sub: 1.068, ctrl: 0.997, td: 1.002 },
      "Bantamweight": { att: 0.994, kd: 1.026, ko: 0.603, sub: 1.135, ctrl: 0.984, td: 1.004 },
      "Featherweight": { att: 0.995, kd: 1.005, ko: 0.645, sub: 0.901, ctrl: 0.997, td: 1.005 },
      "Lightweight": { att: 1.018, kd: 1, ko: 0.744, sub: 0.86, ctrl: 1.015, td: 1.008 },
      "Welterweight": { att: 0.991, kd: 0.986, ko: 0.759, sub: 1.267, ctrl: 1.033, td: 0.998 },
      "Middleweight": { att: 1.024, kd: 0.968, ko: 1.079, sub: 1.434, ctrl: 1.046, td: 0.993 },
      "Light Heavyweight": { att: 1.034, kd: 0.996, ko: 0.972, sub: 1.014, ctrl: 1.043, td: 1.007 },
      "Heavyweight": { att: 1.027, kd: 0.972, ko: 0.933, sub: 1.011, ctrl: 1.069, td: 0.987 },
      "Women's Strawweight": { att: 0.982, kd: 0.894, ko: 0.531, sub: 0.898, ctrl: 1.033, td: 0.989 },
      "Women's Flyweight": { att: 0.956, kd: 0.949, ko: 0.806, sub: 1.045, ctrl: 1.066, td: 0.976 },
      "Women's Bantamweight": { att: 0.97, kd: 0.934, ko: 0.564, sub: 0.84, ctrl: 1.053, td: 0.975 },
      "Women's Featherweight": { att: 0.976, kd: 0.853, ko: 0.709, sub: 1.169, ctrl: 1.048, td: 0.986 }
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = FightParams;
  else root.FightParams = FightParams;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
