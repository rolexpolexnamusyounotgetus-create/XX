/* Fight engine global parameters (engine v4 -> v5 merge; the file name stays params3.js for every version).
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
   v5 merge (docs/CHANGELOG.md "v5 merge log"): every component behind components.<name>; flag off = v4.0.0 for fixed seeds.
   - step 1, components.v401: v4.0.1's train-only fixes (versions/v4.0.1-rejected/), one sub-flag each, default on until
     the Calibrate stage's train leave-one-out decides. The usual fields carry the flag-on values ([v401 a] .. [v401 e]
     tags); v401.off (just before div, below) holds v4.0.0's values, which a sub-flag that is off puts back. Tools that
     rewrite these fields in place (tools/v4_levels.js --write, tools/judgecal.js --write, tests/test_engine3.js --fit
     --write) write the flag-on values: run them with the sub-flag on, or drop the sub-flag first.
   - step 2, components.durability (block durability) and components.dynamics (block dyn): both on. Each flag off
     reproduces the engine before it (tests/test_v5_step2.js). Their knockdown levels (durability.kdCal, dyn.kdLevel3/5)
     and the dynamics finish levels (convLevel, stkoScale, gnpScale) are still the separately verified values; one joint
     level pass in the Calibrate stage sets them (first joint check: docs/CHANGELOG.md v5 merge log, step 2).
   Units inside the engine: seconds and per-second rates unless a comment says otherwise. */
(function (root) {
  "use strict";
  var FightParams = {
    version: "5.0.0-dev.2-selfcal-pre2024",   // parameter set label (engine VERSION is separate); [selfcal] values fit to train-only priors (data/derived/priors_dev.json, fights before 2024-01-01); v5 merge steps 1 (components.v401) and 2 (durability, dynamics)

    // ---------------- engine v5 components (src/engine3.js resolveParams; each flag off reproduces v4.0.0) ----------------
    components: {
      // v5 merge step 1: v4.0.1's train-only fixes, one sub-flag each (true / false for all five): (a) emJudge pre-2024 EM
      // judging weights + the noise / 10-8 refit on them; (b) deductions; (c) mlLevels learned-path levels + companions;
      // (d) tdCap cumulative takedown cap; (e) koTargets KO/TKO composition from 2019-2023 fights. Values: v401 below.
      v401: { emJudge: true, deductions: true, mlLevels: true, tdCap: true, koTargets: true },
      // v5 merge step 2: knockdown chin / power block of research/model_durability.md (engine3.js applyDurability;
      // values: durability below)
      durability: true,
      // v5 merge step 2: fight dynamics, research/model_dynamics.md E1-E11 (block `dyn` below; dyn.stkoHurtGate stays off)
      dynamics: true
    },

    // ---------------- fight dynamics (component "dynamics"; research/model_dynamics.md section 8, data/derived/dynamics.json) ----------------
    // Recipe values were fit on 2019-2023 ufcstats round data (train) by tools/dynamics.py and re-checked against the same JSON;
    // [dyncal v4.0.1] values are level factors re-fit by tools/dynamics_calibrate.js on 2019-2023 backtest fights (out-of-fold
    // learned rates) on top of engine v4.0.1: 1,000 train fights, 16 sims per corner order, 5 damped iterations plus one final
    // update step from the last iteration (train only; scratchpad dyn/cal10.log). Volume, accuracy and takedown attempts follow
    // the flag-off engine; knockdowns per fight-minute the 2019-2023 actuals by format; conversion the data's 0.512 per knockdown;
    // the KO/TKO share the flag-off engine.
    dyn: {
      // E1 pace curves. RM 2.1: output per minute of position rises more steeply than per round-minute because control time rises
      // by round, so a position-based engine starts from the distance curve [1, 1.15, 1.26] / [1, 1.22, 1.23, 1.31, 1.37]. With the
      // takedown round curve below, the engine's control share rises by round as in real fights, and the recipe curves realised
      // [1, 1.072, 1.072] / [1, 1.103, 1.054, 1.056, 1.013] per round-minute on train matchups (survivor selection is stronger
      // with persistent fight-night output: high-output fights end early). Inputs = recipe x target / realised (5 rounds damped):
      pace3: [1, 1.16, 1.34],                 // E1: output multiplier by round, 3 rounds (train realised target [1, 1.083, 1.141] per round-minute)
      pace5: [1, 1.28, 1.30, 1.42, 1.52],     // E1: same, 5 rounds (target [1, 1.176, 1.130, 1.187, 1.185])
      outStam: 0.05,                          // E1/E3: output x (1 - outStam (1 - S)); own earlier output costs at most -4.5% per 100 attempts (was 0.12)
      // E2 form and persistence. Recipe: pace 0.35, out 0.20, AR(1) 0.30 / 0.68 (corrected E2: pace ~0.40, out 0.18-0.20, phi ~0.6,
      // acc ~0.30). The first builder's train check (tools/dynamics_check_train.py on 2019-2023 rounds; real own-round corr R1-R2
      // 0.570, R1-R3 0.474, fighters 0.656) found the recipe realising 0.468 / 0.424 / 0.553 because the engine's other round noise
      // attenuates persistence; pace 0.45 and AR 0.32 / 0.85 fit best of four. Realised on v4.0.1 train matchups (same estimators,
      // run abl402; real / flag off / these values): own-round corr R1-R2 0.570 / 0.462 / 0.540, AR(1) 0.63 / 0.01 / 0.49, sd
      // fighter-fight 0.44 / 0.51 / 0.56, fighters' corr 0.85 / 0.50 / 0.63. A sensitivity run with formOut 0.12, formPace 0.43
      // (abl403) gave 0.514 / 0.47 / 0.53 / 0.67 and no better scores (stat-line deviance +0.44, n.s.; control deviance worse).
      // The individual form sds (formOut, formAcc) also carry the matchup model's error,
      // not only true fight-night form: on the v4.0.1 train ablation (abl401) the narrow alternative (formOut 0, formAcc 0.31, the
      // real accuracy dispersion) scored worse than these values on method (+0.0055) and method x round (+0.0108 [+0.0001, +0.0214]).
      formPace: 0.45,                         // E2: lognormal sd of the shared fight-level pace (RE with profiles: 0.37; real fighters' corr 0.84 needs more)
      formOut: 0.21,                          // E2: lognormal sd of each man's fight-level output form (recipe 0.20; with the AR(1) the flag-off total 0.37)
      arSd: 0.32,                             // E2: stationary sd of each man's AR(1) round output noise (RE: 0.31)
      arPhi: 0.85,                            // E2: its round-to-round autocorrelation (RE: 0.68; engine round noise attenuates the realised value to ~0.5); valid range [0, 1), the engine clips to [0, 0.999]
      roundPace: 0.10,                        // E2: lognormal sd of the shared round pace (engine already realises 0.41 vs 0.36 real)
      formAcc: 0.43,                          // E2: logit sd of each man's fight-level accuracy form (recipe 0.28; RE with profiles 0.29; with the AR(1) the
                                              // flag-off total 0.48; 0.31 matches the real accuracy dispersion but scores worse, see above)
      accArSd: 0.28,                          // accuracy AR(1) round noise, stationary logit sd (RE with profiles 0.244; 0.24 realised 0.19 vs 0.24 real)
      accArPhi: 0.73,                         // its autocorrelation (RE with profiles: 0.727); valid range [0, 1) as arPhi
      accProfA: 0.61,                         // attenuation of the attacker's profile accuracy shift (RE profile coefficient 0.61; no effect when ML rates re-target accuracy)
      accProfB: 0.50,                         // attenuation of the defender's allowed-accuracy shift (0.50)
      vol: 0.50,                              // E7: lognormal sd of the shared per-fight knockdown volatility (was 0.6). Recipe 0.30 was sized to 2024-25 (engine
                                              // frailty 1.7 vs 0.9 real); on 2019-2023 matchups real frailty is 1.49 (flag off 1.65, vol 0.30 1.09), so 0.50
      // E4 knockdown momentum (corrected recipe, research/model_dynamics.md section 5 and its verification log): engine multipliers on
      // the baseline rate must match the skip-round contrast (next round vs the round before the knockdown round; 2010-2023: scorer
      // -5.9% SE 4.8%, dropped -2.6% SE 4.9%), not the dynamic-RE coefficients (-8.8% / +6%, relative to the knockdown round itself)
      momScorerOut: 0.92,                     // E4: next-round output of a man who scored a knockdown (removes the engine's +6.5% over baseline)
      momScorerAcc: 0.94,                     // E4: his accuracy odds (-0.058 logit)
      momScorerTd: 0.88,                      // E4: his takedown attempts (-12%)
      momDroppedOut: 0.95,                    // E4: next-round output of the man who was dropped (corrected: x0.95, not x1.05)
      momDroppedTd: 1.12,                     // E4: his takedown attempts (+11-12%)
      lostAcc: 1,                             // E5 knob, default off: accuracy odds x this after a round lost on the cards (published round scores: -0.079
                                              // logit, SE 0.015, i.e. x0.92; may be form information the stats miss, not a choice, so off)
      tdCtrlOpp: -0.104,                      // E6: takedown attempts x exp(tdCtrlOpp x minutes controlled by the opponent in earlier rounds) (z = 6.5)
      tdTdl: -0.063,                          // E6: x exp(tdTdl x own takedowns landed in earlier rounds)
      tdCtrlOwn: 0,                           // E6 optional: x exp(tdCtrlOwn x own minutes in control earlier) (data +0.048, may be style persistence; off)
      distCtrlOpp: -0.013,                    // E6: distance output x exp(distCtrlOpp x minutes controlled by the opponent earlier)
      // E6 companion: the carry-over coefficients are conditional effects inside a model with round cells; real takedown attempts
      // RISE by round (targets_by_round.train, per 15 min: 3 rounds 3.58 / 3.75 / 4.30; 5 rounds 2.64 / 2.76 / 3.41 / 3.28 / 3.62,
      // smoothed log-linear +8% per round) and so does control (18.4% -> 20.5% of round time). Without a round curve the carry-over
      // made the engine's attempts FALL by round (abl401: 4.01 / 3.68 / 3.41) and worsened takedown-attempt deviance on train.
      // Inputs = target shape / realised shape, two fixed-point steps on train matchups (flat curve realised 3 rounds [1, .919, .850],
      // 5 rounds [1, .933, .891, .844, .801]; first step [1, 1.14, 1.41] / [1, 1.16, 1.31, 1.50, 1.72] realised [1, 1.02, 1.07] /
      // [1, 1.04, 1.11, 1.14, 1.21]). The steep inputs say the carry-over bites harder in the engine than in the data (the
      // controlled-minutes term was weaker, -0.040, on the 2024-25 refit); the marginal round shape is what is matched here.
      tdRound3: [1, 1.17, 1.58],              // E6: takedown-attempt multiplier by round, 3 rounds (normalised over the first rounds; tdLevel sets the level)
      tdRound5: [1, 1.20, 1.38, 1.65, 1.95],  // E6: same, 5 rounds
      kdRound3: [1.50, 0.85, 0.56],           // E7: knockdown risk per landed standing strike by round, 3 rounds ([1, .57, .37] with frailty, train)
      kdRound5: [1.445, 1.27, 0.737, 0.535, 0.535], // E7: 5 rounds = [1, .88, .51, .37, .37], the train-only (2019-2023) frailty fit with R4-5
                                              // pooled (the recipe's [1, .65, .405, .29, .29] is a 2010-2023 fit, outside the tuning window; on the
                                              // first builder's runs it and a geometric-mean compromise over-predicted 5-round round-1 KO/TKO)
      kdLevel3: 0.655,                           // [dyncal v4.0.1] knockdown level in 3-round fights (replaces kdStamAtt, kdPaceExp, kdDmg, kdStamDef)
      kdLevel5: 0.559,                           // [dyncal v4.0.1] knockdown level in 5-round fights (replaces caution5 / r1Caution5 on knockdowns)
      convLevel: 1.045,                           // [dyncal v4.0.1] odds scale on the instant-KO and follow-up stoppage chances after a knockdown (per-KD conversion 0.512 train)
      convRound: -0.155,                      // E8: conversion odds x exp(convRound (r - 1)) (SE 0.077); replaces kdInstantDmg, refDmg, instStam, finStamAtt
      stkoBase: 0.9,                          // E9: standing TKO while hurt = stko x (stkoBase + D / 100) (was 0.3; data slope +0.0104 per head strike absorbed)
      gnpDmg: 100,                            // E9: ground TKO x (1 + D / gnpDmg) (was 600)
      noKdRound: -0.17,                       // E9: non-knockdown stoppage hazards x exp(noKdRound (r - 1)) (standing -0.18, ground -0.17)
      stkoHurtGate: false,                    // E9 knob (verifier, default off): a standing TKO needs the hurt state, whose incidence follows kdRound, so the
                                              // realised standing TKO per standing head absorbed decays as kdRound x exp(noKdRound r) ([1, .54, .37] in 3-round
                                              // train fights vs E9 [1, .84, .70]; E9 round SE 0.24). true divides the stop chance per hurt strike by
                                              // kdRound[r] / kdRound[0] (refit: stkoScale 0.700, gnpScale 0.459). Train ablation, gate on vs off: n.s. on every metric
                                              // (7-bin +0.0041, method +0.0018); 3-round R3 KO hazard 0.087 vs 0.072 real (0.079 gate off), so not adopted
      stkoScale: 0.733,                       // [dyncal v4.0.1] standing TKO scale; with gnpScale one joint factor (data ratio of the two hazards kept) so the
                                              // KO/TKO share matches the flag-off engine (data: 0.00045 per landed standing head absorbed, no-KD rounds)
      gnpScale: 0.481,                        // [dyncal v4.0.1] ground TKO scale (data: 0.0067 per ground sig strike absorbed, no-KD rounds)
      kPace: 45,                              // E10: per-round pace ratio prior strength (train-best 45; was 15; verified: 30-45 supported, 45 vs 15 n.s. held out)
      paceMutual: 0.4,                        // E10: pace partly mutual: x opponent's late-round ratio^paceMutual (0.39 train)
      outLevel: 1.039,                           // [dyncal v4.0.1] output level (keeps the realised attempts per minute)
      accLevel: 0.998,                            // [dyncal v4.0.1] accuracy odds level (keeps the realised accuracy)
      tdLevel: 1.126                              // [dyncal v4.0.1] takedown-attempt level (keeps the realised takedown volume; E4 / E6 shift attempts between rounds)
    },

    // ---------------- learned stat-line rates (engine v4) ----------------
    mlWeight: 1,      // blend of the learned matchup rates (FightEngine.loadMLRates; src/ml/mlrates.js) vs the base tables: 1 = learned, 0 = base
    mlMaxRatio: 4,    // cap on any single learned-vs-base multiplier (src/ml/mlrates.js applyToMatchup maxRatio; [v401 d] tdCap: on the cumulative takedown multipliers too)
    mlTdLevel: 1.067,   // [v401 c: levels v4.0.1, tools/v4_levels.js on all 1,999 2019-2023 fights, learned rates on; off 1] factor on the learned takedown-attempt targets (v4.0.0 left takedowns landed 6% low on train)
    mlCtrlLevel: 1.053,  // [v401 c: same; off 1] factor on the learned control targets (v4.0.0: control 5% low on train)
    mlSubLevel: 1.083,   // [v401 c: same; off 1] factor on the learned submission-attempt targets (v4.0.0: attempts 6.5% low on train, which the submission conversion scale had absorbed)

    // ---------------- durability: knockdown chin and power (engine v5; research/model_durability.md section 9) ----------------
    // KD hazard per landed standing head strike by i on j = kdCal x base_ij x rel_ij (see engine3.js applyDurability).
    // terms: live Poisson fit 2008-01-01..2026-10-31 (data/derived/durability.json engine.terms_live; log-rate coefficients
    // vs the trailing league level, Lightweight / non-title / 3-round / age-30 reference). Backtests pass walk-forward
    // records (durability.json backtest[fight_id]: chin_re, chin_cov, pow_re, pow_cov and the base L730 x context) per call.
    durability: {
      level: 0.010274,   // league KD per landed standing head strike, trailing 730 days at the Oct 31, 2026 snapshot (durability.json engine.level_now_trailing_730); labeled scenario: 0.011706 = trailing 365 days ("current season", 2025-26 surge)
      terms: {
        "const": 0.07774,                                  // vs the trailing level
        "div_Flyweight": 0.15988, "div_Bantamweight": 0.11456, "div_Featherweight": 0.08257, "div_Welterweight": 0.08936,
        "div_Middleweight": 0.18624, "div_Light Heavyweight": 0.33379, "div_Heavyweight": 0.14286, "div_Catch Weight": -0.09189,
        "div_Women's Strawweight": -1.08298, "div_Women's Flyweight": -1.12069, "div_Women's Bantamweight": -1.06114,
        "div_Women's Featherweight": -0.56292,             // division multipliers vs Lightweight (FLY 1.17 ... LHW 1.40; women 0.33-0.57)
        five: -0.11143,      // five-round fight x0.895 (after fighter effects)
        title: -0.09636,     // title fight x0.908
        d_age_c: 0.06177,    // defender chin: +6.4%/yr at every age (no knee at 30: hinge below)
        d_age_h30: -0.0016,  // change in the defender slope past 30
        d_age_na: 0.79895,   // defender age unknown
        d_okd_r: -0.14251,   // per KD absorbed in the last 365 days (tempers chin_re's reaction: diminishing evidence)
        d_okd_o: -0.08,      // per older KD absorbed
        d_kol_r: 0.18908,    // per KO/TKO loss (strikes or corner) in the last 365 days: x1.21
        d_kol_o: 0.0749,     // per older KO/TKO loss: x1.08
        a_age_c: -0.00445,   // attacker power, slope below 30 (flat)
        a_age_h30: -0.03589  // attacker power past 30: -4.0%/yr (x0.72 from 30 to 38)
      },
      normChin: 0.9972,  // NORM = 2024+ exposure-weighted mean of the live C_d (durability.json engine.norm_chin); backtests on 2019-2023 use norm_chin_backtest_2019_2023 0.9882
      normPow: 0.9752,   // same for P_a (engine.norm_pow); 2019-2023 backtests use 1.0183
      alphaChin: 3,      // Gamma(3, 3) prior on the fighter chin multiplier, worth ~290 standing head strikes (tuned on 2019-2023)
      alphaPow: 2.5,     // Gamma(2.5, 2.5) prior on the fighter power multiplier (~245 standing head strikes)
      fallbackEB: true,  // profiles without a durability record: chin_re / pow_re from career sums (opponent effects taken as 1)
      standShare: 0.9,   // standing share of landed head strikes for that fallback (research section 1: 90% since 2019)
      engineWeight: 0.5, // [train 2019-2023] geometric weight on the engine's own KD structure (v3 ratios, or the v4 learned rates); 1 - w on durability. Static KD deviance on 2019-2023: w 0.5 beat durability alone by 20 [-42, +1] and v4 alone by 36 [-58, -15]
      kdCal: 1.1639618,  // [train 2019-2023] extra conversion x kdScale from the data hazard to the engine's base hazard (its in-fight KD modifiers average below 1); level-matched to the FROZEN v4 engine's simulated knockdowns per fight on 2019-2023 (verifier, Nov 6: 1,999 fights x 300 sims, OOF rates; kdScale 1.391 -> kdCal x kdScale 1.619): 1.18780096 (the builder's value, matched to the in-flight v4 with kdScale 1.246) gave on 0.474 vs off 0.465 per fight there, 1.164 gives 0.467. Re-match after any kdScale / KD-modifier change: kdCal x KD_off / KD_on. kdCalRel (default 1) replaces it in relative mode
      chinExp: 1,        // exponent on C_d (validation slope 0.98 +- 0.10; the first version's 1.15 is withdrawn)
      powExp: 1,         // exponent on P_a (validation 0.80 +- 0.08 is worth only -2.3 +- 4 on 2024+, so 1)
      sizeChin: 0,       // labeled knob, no size tax by default: chin x exp(sizeChin x lbs up / 10) for the man above his home division (data: x0.85-0.91 per class up, the wrong sign for a tax)
      sizePow: 0,        // labeled knob: power x exp(-sizePow x lbs up / 10)
      gnpCal: 1,         // scale on the GNP TKO hazard when the component is on (sqrt of the blended power x chin product, as v3)
      stkoCal: 1,        // scale on the standing TKO hazard (same)
      caution5: null,    // null keeps the engine's caution5 for 5-round fights; a number overrides it while the component is on
      // first-version terms that failed the 2019-2023 one-SE rule (research/model_durability.md V4); labeled knobs, neutral:
      // layoff24 (first version x0.64 at 730+ days), lastKO (x1.163 when the last fight was a KO loss), ufcYear (+0.021/yr in the UFC)
      withdrawn: { layoff24: null, lastKO: null, ufcYear: 0, ufcYearRef: 2.6 }
    },

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
    kdScale: 1.383,          // [v401 c: levels v4.0.1, tools/v4_levels.js on all 1,999 2019-2023 fights, learned rates on; off = levels v4 1.391; v3 walkfwd 1.246; v401 e: x koComp.kdScale] global knockdown scale on p0 (division KD per landed standing head strike)
    kdPos: [1.0, 2.561],     // [selfcal v4: train-only priors_dev.json; v401 e: [1] x koComp.kdClinch] KD multiplier for distance, clinch head strikes; fit so clinch stoppages are 12.5% of strike KO/TKOs (baserates all years; 2019-2023 fights: 7.1%, components.v401.koTargets)
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

    kdInstant: 0.3623,       // [v401 c: levels v4.0.1; off = levels v4 0.3673; v3 walkfwd 0.3175; v401 e: odds x koComp.kdInstant] P(knockdown is an immediate knockout), x damage, fatigue and division factors; scaled on odds with kdRefStop, stko and gnpTko (koAll 0.771) to the 2019-2023 KO share
    kdInstantDmg: 600,       // instant-KO x (1 + D / kdInstantDmg) (default)
    finStamAtt: 1.0,         // attacker fatigue: GNP TKO, follow-up referee stop and submission conversion x max(0.05, 1 - finStamAtt (1 - S_att)) (finish hazards fall by round while output rises)
    instStam: 1.0,           // attacker fatigue: instant-KO odds x (1 - instStam (1 - S_att)) (default)
    kdPounce: 0.72,          // P(attacker follows him down) after a knockdown that isn't a KO (default)
    kdRecover: 1 / 6.5,      // per second, the downed man recovers (to guard or his feet) (default; the follow-up length kdRefStop is fit against)
    kdRecoverStand: 0.45,    // share of recoveries that get back to the feet; the rest recover guard with the attacker on top (default)
    kdGnpRate: 1.1,          // ground strikes per second in the follow-up flurry (default)
    kdGnpAcc: 0.78,          // landing probability of follow-up ground strikes (default)
    kdRefStop: 0.1807,       // [v401 c: levels v4.0.1; off = levels v4 0.184; v3 walkfwd 0.153; v401 e: odds x koComp.kdRefStop] P(referee stops it) per landed follow-up head strike, x damage and fatigue factors
    refDmg: 600,             // follow-up referee stop odds x (1 + D / refDmg) (default; small: finish hazard falls by round in the data)
    kdFinRef: 0.6,           // league P(same-round finish | KD) the follow-up was tuned for; division kd_fin rescales on odds (priors kd_fin, LW 0.60)
    stko: 0.03565,           // [v401 c: levels v4.0.1; off = levels v4 0.03644; v3 walkfwd 0.03439; v401 e: x koComp.stko] standing TKO hazard per landed standing head strike while hurt, x (stkoBase + D/100); fit so stoppages without a KD are ~7% of KO/TKOs (baserates 0.049 vs 0.509 per 100 standing head landed)
    gnpTko: 0.03005,           // [v401 c: levels v4.0.1; off = levels v4 0.03072; v3 walkfwd 0.02467; v401 e: x koComp.gnpTko] GNP TKO hazard per landed top ground head strike (x sub-position, damage, fatigue); fit so ground stoppages are 28% of strike KO/TKOs (baserates)
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
    subConvScale: 1.697,     // [v401 c: levels v4.0.1 (with mlSubLevel's 8% more attempts); off = levels v4 1.847; v3 walkfwd 1.619] submission conversion odds scale
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
    // [v401 a] emJudge (default): EM round-winner fit over the 5,519 ufcstats cards of 2015-01-01..2023-12-31 with only 10-9
    // rounds (tools/judge_em_train.py -> data/derived/judge_em_train.json; same code as baserates.json
    // round_model.em_all_cards), logit per landed differential, with the noise and the 10-8 KD term refit on these weights
    // (tools/judgecal.js on the 2019-2023 judges' rounds in data/derived/judgerounds_rows.json, train years only) and t108
    // re-levelled (tools/v4_levels.js). Off (v401.off.emJudge): v4.0.0's all-cards fit through 2026-10 (validation years and
    // the vault) and the judgecal / levels values fit on it. [v401 b] deductions: judge.ded / ded2 (off: 0).
    judge: {
      head: 0.1742, body: 0.1271, leg: 0.1042,   // [v401 a: em pre-2024] per landed sig strike differential to head / body / leg (v4.0.0, all years: 0.179 / 0.133 / 0.105)
      kd: 2.1635,                               // [v401 a: em pre-2024] per knockdown (12.4 head strikes; v4.0.0 2.42)
      td: 0.2780,                               // [v401 a: em pre-2024] per takedown landed (v4.0.0 0.286)
      ctrlMin: 0.4623,                          // [v401 a: em pre-2024] per minute of control (ufcstats control includes clinch control; v4.0.0 0.46)
      sub: 0.8467,                              // [v401 a: em pre-2024] per submission attempt (v4.0.0 0.85)
      hurt: 0.8,                              // per hurt/wobble scored (engine-only event, not in ufcstats: about 1/3 of a knockdown; judgment call)
      power: 0.25,                            // default judges.power: extra credit for power-weighted head damage beyond the strike count (v2 judgePower 0.25)
      sharedSd: 1.357,                        // [judgecal; v401 a, v4.0.0 1.416] sd of the noise shared by the three judges (logits; ML on 2019-2023 rounds 1.489 with the pre-2024 weights (v4.0.0: 1.531), less the engine-only hurt / power terms' residual variance)
      sharedFight: 0.3402,                    // [judgecal; v401 a, v4.0.0 0.3303] share of the shared variance drawn once per fight (persists across rounds; data 0.283 of 1.489^2, LR 101): panel residuals correlate ~0.12 between rounds of a fight
      indSd: 1.053,                           // [judgecal; v401 a, v4.0.0 1.079] sd of each judge's own noise (logits)
      tasteSd: 0,                             // lognormal sd of each judge's fight-level taste for striking / grappling / damage; 0 in v4: a judge who dissents twice in a fight does so in either direction equally often (judgecal: no fight-level taste; v3 0.2 from literature 12.5)
      t108: 8.31,                            // [judgecal + levels v4.0.1; v401 a, v4.0.0 8.555] a judge scores 10-8 when his |z| exceeds t108 - t108kd x min(2, winner's KD edge); judgecal fits it on real rounds (2021-2023 threshold; 2019-2020 lower, 10-8 share 3.6% vs 5.9%), then tools/v4_levels.js re-levels it so simulated decision rounds give the 2021-2023 3.6% share on train fights (the engine's rounds, with hurts, are more lopsided)
      t108kd: -0.8585,                        // [judgecal; v401 a, v4.0.0 -1.087] threshold change per knockdown of edge; negative: z already carries the KD weight, and judges give a 10-8 to 13% of KD-edge round winners, not the 23% that z alone implies
      ded: 0.00515,                           // [judgecal; v401 b, off 0] point deduction (foul) per fighter per round, on all three cards; 2019-2023 decision rounds (v4.0.0 had none, so its draws and majority decisions came from 10-8s alone)
      ded2: 0.075                             // [judgecal; v401 b] share of deductions that cost 2 points
    },

    // ---------------- between rounds ----------------
    doc: 0.06,               // doctor stoppage hazard between rounds: doc * (D/100)^2, capped (sweep: ~0.7 per 100 league-average 3-round fights; baserates doctor 0.76 per 100 all, 1.5 LW, 1.55 in 5-rounders)
    docCap: 0.2,             // cap per interval
    corner: 0.03,            // corner stoppage hazard: corner per KD absorbed beyond the first, plus corner * (D/120)^3 (sweep: ~0.1 per 100 3-round fights; baserates corner 0.13 all, 0.35 LW, 0.52 in 5-rounders)

    // ---------------- v5 merge step 1: components.v401 values (src/engine3.js resolveParams) ----------------
    // off: v4.0.0's values, put back (before opts.params overrides) for each sub-flag that is off. Never tuned: they are
    // the reference that makes each flag-off path reproduce v4.0.0 (tests/test_v401.js). One line per sub-flag on purpose:
    // the in-place rewriters (tools/v4_levels.js, tools/judgecal.js, tests/test_engine3.js --write) match a field name at
    // the start of a line, so they only ever touch the usual (flag-on) fields above.
    // koComp: (e) factors from re-aiming the self-calibration's KO/TKO composition at 2019-2023 fights (tools/ko_composition.py
    // -> data/derived/ko_composition_pre2024.json: ground 28.6%, clinch 7.1%, standing without a KD 7.2%, vs v4's all-years
    // 28 / 12.5 / 7; the clinch share is the big move: ufcstats labelled ~24% of strike KO/TKOs "In Clinch" in 2015-2018
    // and ~7% from 2019 on). tools/v401_kocomp.js fits kdScale, kdPos[1], gnpTko, stko and kdInstant / kdRefStop (odds)
    // twice on league-average Lightweight pairs (train-only priors, learned rates off, common random numbers), once to v4's
    // targets and once to the 2019-2023 ones, holding knockdowns per head strike and KD-to-finish at the engine's own level;
    // factor = second / first. Applied after the opts.params overrides, so the usual fields stay the pre-(e) levels.
    v401: {
      off: {
        emJudge: { judge: { head: 0.179, body: 0.133, leg: 0.105, kd: 2.42, td: 0.286, ctrlMin: 0.46, sub: 0.85, sharedSd: 1.416, sharedFight: 0.3303, indSd: 1.079, t108: 8.555, t108kd: -1.087 } },
        deductions: { judge: { ded: 0, ded2: 0 } },
        mlLevels: { mlTdLevel: 1, mlCtrlLevel: 1, mlSubLevel: 1, kdScale: 1.391, kdInstant: 0.3673, kdRefStop: 0.184, stko: 0.03644, gnpTko: 0.03072, subConvScale: 1.847 }
      },
      koTargets: { ground: 0.2859, clinch: 0.0711, standNoKd: 0.0725 },   // (e) the self-calibration's composition targets (tests/test_engine3.js --fit uses them while the sub-flag is on; v4: 0.28 / 0.125 / 0.07)
      koComp: { kdScale: 1.11, kdClinch: 0.4999, gnpTko: 1.023, stko: 1.051, kdInstant: 0.9877, kdRefStop: 0.9877 }   // (e) tools/v401_kocomp.js --n 30000 --iters 12 (data/derived/v401_kocomp.json): clinch share 12.7% -> 6.9% on league-average LW pairs, KD per head strike held, KO share +0.4 pt
    },

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
