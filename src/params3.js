/* Fight engine v3: global parameters.
   UMD: module.exports in Node, self.FightParams / window.FightParams in the browser.
   One plain object. Every entry carries a comment with its meaning and its source or default.
   Sources: data/derived/combine_fit.json (shrinkage, combination), data/derived/baserates.json and
   baserates_tables.md (league base rates, 2015+), data/derived/priors.json (division priors, 2018+),
   research/modeling_literature.md (age, chin, judging), research/data_baserates.md.
   Values marked [selfcal] were set by the league-average self-calibration in tests/test_engine3.js
   (node tests/test_engine3.js --fit); tools/calibrate.js (walk-forward) will rewrite them.
   Units inside the engine: seconds and per-second rates unless a comment says otherwise.
   Walk-forward calibration (tools/calibrate.js, 2026-11-06): values marked [walkfwd] were tuned on 2019-2023 backtest fights
   (n=1955, frozen pre-fight snapshots) and checked on 2024-01-01 .. 2026-10-31 (n=1223, never tuned on).
   Test: winner log loss 0.648 (Elo 0.6805, blend 0.6453), Brier 0.2281, accuracy 64.0%,
   ECE 4.5%, 7-bin log loss 1.6049. Train: winner log loss 0.6721 (Elo 0.6851).
   Details: data/derived/calibration.json and docs/CHANGELOG.md. Re-running tests/test_engine3.js --fit --write would overwrite some of them. */
(function (root) {
  "use strict";
  var FightParams = {
    version: "3.0.0-wf-2026-11-06",   // parameter set label (engine VERSION is separate)

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
    strikeScale: 1.107,      // [walkfwd 2026-11-06; was 1.063] global strike-attempt scale (absorbs exposure-estimate bias)
    clinchScale: 1.063,      // [selfcal] clinch strike-rate scale
    groundScale: 0.8183,     // [selfcal] ground strike-rate scale
    clinchMix: [0.55, 0.33, 0.12],   // clinch target mix head/body/leg (default; leg = knees to the thigh)
    groundTopMix: [0.84, 0.15, 0.01], // top ground-strike target mix (default)
    groundBotMix: [0.6, 0.4, 0.0],    // bottom ground-strike target mix (default)
    accScale: 1.021,        // [walkfwd 2026-11-06; was 0.9497] global accuracy odds scale (centers the fatigue / hurt / mobility modifiers on the data)
    botAccOdds: 0.6,         // accuracy odds multiplier for strikes thrown from the bottom (default)
    accHurt: 1.5,            // accuracy odds multiplier against a hurt defender (default)
    accStam: 0.25,           // defender fatigue: odds x (1 + accStam (1 - S_def)) (default)
    accMob: 1.2,             // defender leg damage: odds x (1 + accMob (1 - mobility)) (default)
    accSelfStam: 0.2,        // attacker fatigue: odds x (1 - accSelfStam (1 - S_att)) (default)
    outStam: 0.12,           // attacker fatigue: output x (1 - outStam (1 - S)) (default)
    outHurt: 0.65,           // output multiplier while hurt (default)
    outMob: 0.15,            // output x (1 - outMob (1 - mobility)) (default)

    // ---------------- damage, knockdowns, finishes ----------------
    kdScale: 1.246,          // [walkfwd 2026-11-06; was 1.232] global knockdown scale on p0 (division KD per landed standing head strike)
    kdPos: [1.0, 2.769],     // [selfcal] KD multiplier for distance, clinch head strikes; fit so clinch stoppages are 12.5% of strike KO/TKOs (baserates; knees and elbows)
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

    kdInstant: 0.3175,       // [walkfwd 2026-11-06; was 0.3763] P(knockdown is an immediate knockout), x damage, fatigue and division factors; scaled on odds with kdRefStop, stko and gnpTko (koAll 0.771) to the 2019-2023 KO share
    kdInstantDmg: 600,       // instant-KO x (1 + D / kdInstantDmg) (default)
    finStamAtt: 1.0,         // attacker fatigue: GNP TKO, follow-up referee stop and submission conversion x max(0.05, 1 - finStamAtt (1 - S_att)) (finish hazards fall by round while output rises)
    instStam: 1.0,           // attacker fatigue: instant-KO odds x (1 - instStam (1 - S_att)) (default)
    kdPounce: 0.72,          // P(attacker follows him down) after a knockdown that isn't a KO (default)
    kdRecover: 1 / 6.5,      // per second, the downed man recovers (to guard or his feet) (default; the follow-up length kdRefStop is fit against)
    kdRecoverStand: 0.45,    // share of recoveries that get back to the feet; the rest recover guard with the attacker on top (default)
    kdGnpRate: 1.1,          // ground strikes per second in the follow-up flurry (default)
    kdGnpAcc: 0.78,          // landing probability of follow-up ground strikes (default)
    kdRefStop: 0.153,       // [walkfwd 2026-11-06; was 0.1898] P(referee stops it) per landed follow-up head strike, x damage and fatigue factors
    refDmg: 600,             // follow-up referee stop odds x (1 + D / refDmg) (default; small: finish hazard falls by round in the data)
    kdFinRef: 0.6,           // league P(same-round finish | KD) the follow-up was tuned for; division kd_fin rescales on odds (priors kd_fin, LW 0.60)
    stko: 0.03439,           // [walkfwd 2026-11-06; was 0.04461] standing TKO hazard per landed standing head strike while hurt, x (stkoBase + D/100); fit so stoppages without a KD are ~7% of KO/TKOs (baserates 0.049 vs 0.509 per 100 standing head landed)
    gnpTko: 0.02467,           // [walkfwd 2026-11-06; was 0.032] GNP TKO hazard per landed top ground head strike (x sub-position, damage, fatigue); fit so ground stoppages are 28% of strike KO/TKOs (baserates)
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
    tdScale: 0.9724,          // [walkfwd 2026-11-06; was 1.008] takedown attempt rate scale
    tdOddsScale: 0.9103,     // [walkfwd 2026-11-06; was 0.9044] takedown success odds scale
    sweepScale: 1.0,         // sweep / reversal rate scale (default; reversals come from each pair's data rates)
    subAttScale: 1.042,      // [walkfwd 2026-11-06; was 1.073] submission attempt rate scale
    subConvScale: 1.619,     // [walkfwd 2026-11-06; was 1.385] submission conversion odds scale
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
    judge: {
      head: 0.411, body: 0.310, leg: 0.287,  // logit per landed strike differential (baserates round_model clean subset, 1,541 rounds)
      kd: 2.81,                               // per knockdown (same fit)
      td: 0.651,                              // per takedown landed (same fit)
      ctrlMin: 0.882,                         // per minute of control (same fit)
      sub: 1.342,                             // per submission attempt (same fit)
      hurt: 1.0,                              // per hurt/wobble scored (engine-only event; literature 12.5: between a head strike and a KD)
      power: 0.25,                            // default judges.power: extra credit for power-weighted head damage beyond the strike count (v2 judgePower 0.25)
      sharedSd: 1.1,                          // [walkfwd 2026-11-06] sd of the round noise shared by the three judges (logits) (default; indSd is fit to the split-decision share)
      indSd: 1.975,                           // [walkfwd 2026-11-06; was 1.206] sd of each judge's own noise (logits); fit to the unanimous share of decisions on 2019-2023 fights (78.6%)
      tasteSd: 0.2,                           // lognormal sd of each judge's fight-level taste for striking / grappling / damage (literature 12.5: 0.15-0.25)
      t108: 6.136,                            // [selfcal] logit margin a 10-8 needs with a one-knockdown edge (ABC: damage required); fit to ~3.5% of judge-rounds (4.7% 2015+, 2.5% 2024-25)
      t108b: 9.136,                           // [selfcal] logit margin a 10-8 needs with no knockdown edge but 2+ more hurts (t108 + 3)
      t108kd2: 3.136                          // [selfcal] logit margin a 10-8 needs with a two-knockdown edge (t108 - 3)
    },

    // ---------------- between rounds ----------------
    doc: 0.06,               // doctor stoppage hazard between rounds: doc * (D/100)^2, capped (sweep: ~0.7 per 100 league-average 3-round fights; baserates doctor 0.76 per 100 all, 1.5 LW, 1.55 in 5-rounders)
    docCap: 0.2,             // cap per interval
    corner: 0.03,            // corner stoppage hazard: corner per KD absorbed beyond the first, plus corner * (D/120)^3 (sweep: ~0.1 per 100 3-round fights; baserates corner 0.13 all, 0.35 LW, 0.52 in 5-rounders)

    // ---------------- division self-calibration factors ([selfcal]; neutral = 1) ----------------
    // att: strike-attempt scale; kd: knockdown scale; ko: scales kdInstant and kdRefStop odds and the stko / gnpTko hazards;
    // sub: submission conversion odds; ctrl: control target scale; td: takedown attempt scale.
    div: {
      "Flyweight": { att: 0.997, kd: 1.021, ko: 0.659, sub: 1.195, ctrl: 1.002, td: 1.017 },
      "Bantamweight": { att: 0.996, kd: 1.02, ko: 0.704, sub: 1.071, ctrl: 0.984, td: 1.018 },
      "Featherweight": { att: 0.999, kd: 1.03, ko: 0.805, sub: 1.03, ctrl: 1.002, td: 1.011 },
      "Lightweight": { att: 1, kd: 1.017, ko: 0.869, sub: 0.935, ctrl: 1.025, td: 1.009 },
      "Welterweight": { att: 1, kd: 0.992, ko: 0.933, sub: 1.252, ctrl: 1.041, td: 1.012 },
      "Middleweight": { att: 1.006, kd: 1.003, ko: 1.185, sub: 1.587, ctrl: 1.05, td: 1.01 },
      "Light Heavyweight": { att: 1.009, kd: 1.002, ko: 1.12, sub: 1.332, ctrl: 1.063, td: 1.014 },
      "Heavyweight": { att: 1.004, kd: 1.005, ko: 1.069, sub: 0.901, ctrl: 1.069, td: 1.001 },
      "Women's Strawweight": { att: 0.992, kd: 0.902, ko: 0.696, sub: 0.999, ctrl: 1.035, td: 0.996 },
      "Women's Flyweight": { att: 0.985, kd: 0.933, ko: 0.976, sub: 1.174, ctrl: 1.061, td: 0.994 },
      "Women's Bantamweight": { att: 0.985, kd: 0.858, ko: 0.743, sub: 1.008, ctrl: 1.066, td: 0.985 },
      "Women's Featherweight": { att: 0.959, kd: 0.86, ko: 0.856, sub: 1.313, ctrl: 1.269, td: 0.964 }
    }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = FightParams;
  else root.FightParams = FightParams;
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
