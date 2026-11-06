# Advanced fighter ratings: Elo variants, Glicko-2, TrueSkill, WHR, round-level and dimensional ratings

Nov 6, 2026. Tool: `tools/ratings.py`. Output: `data/derived/ratings.json`. Data: ufcstats snapshot through
Oct 31, 2026 (8,974 UFC bouts since 1994, 2,776 fighters), `preufc.json` (Sherdog pre-UFC records, walk-forward),
`market.json` (closing lines, benchmark only).

**Protocol.** Walk-forward over every UFC bout in date order. Each fight is predicted only from fights on earlier
days. Parameters were chosen by coordinate descent on 2019-2023 log loss, with the data stream cut at 2024-01-01 in
every trial. Second-stage models (dims winner model, stack, ratings_plus) were chosen by expanding-window CV by year
inside 2019-2023. The 2024-2025 numbers below come from the chosen settings. 2026 fights (the vault) are not scored
here, and their pre-fight probabilities go to `ratings_vault.json` outside the repo. One exception, found in review:
the first full run (15:14 UTC, before the vault split) scored a pooled 2024-01-01..2026-10-31 window that included
369 vault fights. See the Verification log.

**Metrics.** Draws and no-contests are excluded from winner metrics: 1,955 decisive tuning fights and 854 held-out
fights, both men with at least one prior UFC fight (`backtest.json` rows). Brackets are 95% event-clustered
bootstrap CIs (2,000 resamples of UFC cards); differences are paired.

All of this was built in two sessions. The first (cut off by the usage cap) wrote the tool and the full run (57 min
on a loaded 4-core box). The second reviewed the code, ran the ablations, the checks and the extra analyses below,
and wrote this note. An adversarial review then fixed two small defects and rebuilt every output. The fixes were a
survivor look-ahead in one pre-UFC feature and a corner-order asymmetry in the dims league baseline. **All numbers in
this note are from the fixed build.** The tuned parameters were restored from the 2019-2023 tuning checkpoint, not
re-tuned. The rebuild moved 2024-2025 log loss by +0.0000 to +0.0004 (worse).

## Bottom line

1. **Best single system: round-level WHR (`whr_rounds`).** It ranked first on 2020-2023 before the 2024-2025 scores
   were computed. Its margin there over `whr_hybrid` is 0.00003, so treat the two as tied.
   - 2024-2025: log loss **0.6170** [0.6015, 0.6332], Brier 0.2141, accuracy 66.9%.
   - Against the project's Elo baseline (0.6769): **-0.060** [-0.076, -0.045].
   - The fight+rounds blend `whr_hybrid` ties it: 0.6164, difference -0.0006 [-0.0016, +0.0003].
   - The best online (one-pass) system is Glicko-2 at 0.6233. It is cheap enough to run in the browser.
2. **Combinations do better.**
   - The non-negative stack (whr_rounds + Glicko-2 + dims) scores **0.6112** [0.5950, 0.6286]: -0.0057 [-0.0084, -0.0030] vs whr_rounds.
   - Rating logits plus two covariates, layoff and height (`ratings_plus`), score **0.6043** [0.5870, 0.6227]: -0.0069 [-0.0123, -0.0012] vs the stack.
     This is a post-hoc result. ratings_plus was specified after the single systems' first 2024+ scores and the
     per-covariate 2024+ residual check had been computed (Verification log).
3. **Ratings alone do not reach the closing line, but they add to it.** On the 845 fights with a line, the close scores 0.5854.
   - whr_rounds is +0.030 [+0.012, +0.047] behind it. ratings_plus is +0.016 [+0.001, +0.032] behind.
   - Close plus the whr_rounds logit, with weights fit on 2019-2023, scores 0.5824: **-0.0030** [-0.0057, -0.0005] vs the close.
4. **Where the gain over Elo comes from.** Tuning K alone gains nothing (0.6858 vs 0.6857 on 2019-2023). The cumulative
   ablation accounts for the whole 0.036 gain from Elo to full Elo on 2019-2023 by construction: it returns to 0.6867
   with everything off. The split depends on the removal order, and the one-at-a-time effects sum to only 0.028. In
   removal order:
   - the age curve and layoff drift: 0.020;
   - the pre-UFC record (Sherdog): 0.009;
   - the newcomer age prior: 0.004;
   - margin of victory: 0.004.

   Scoring every round as a game is worth another 0.008 inside WHR on 2019-2023, and 0.0127 [0.0029, 0.0229] on 2024-2025.
5. **Every rating system is underconfident on 2024-2025. The review found no leak behind it.**
   - Calibration slopes are about 1.0 on 2019-2023 (0.94-1.05 for the tuned systems), but 1.28-1.47 on 2024-2025 (dims 1.81).
   - The close moves only from 1.03 to 1.11.
   - The same shift shows in plain Elo (0.78 to 1.13), in dims (no age or pre-UFC data), and in ml2's separate ML pipeline (OOF 1.00, 2024-25 1.40-1.45).
   - 2024-2025 is simply more predictable from UFC history: the close itself drops from 0.623 to 0.585.
   - The log-loss gap between whr_rounds and the close is the same in 2022-2023 (0.031, 0.026) as in 2024-2025
     (0.033, 0.027). A leak that only reached the test years would have narrowed it. A truncation and result-flip test
     at four cut days also leaves every pre-fight prediction unchanged (Verification log).

   Do not temper on 2024-2025. Recheck on the vault and the forward test.
6. **Recommendation for the final ensemble** (details at the end):
   - Keep the ratings as inputs to the ML stack, where ml2 already uses whr_rounds, Glicko-2, elo_full and trueskill_mov.
   - Use the stack as the ratings-only fallback.
   - Use the whr_rounds roster ratings (mean and sd) as the any-fighter skill input for the simulator.
   - Use the dims roster ratings as opponent-adjusted striking and grappling skill estimates.

## Systems

All ratings are in logit units (1 unit = 173.7 Elo points), except TrueSkill, which uses probit units with
performance noise 1. Every system shares the same machinery:

- **Newcomer prior.** A debutant's starting mean is `age_new x (age - 29)` plus a pre-UFC term (below).
- **Skill trajectory.** Between fights, a deterministic drift is applied:
  - an age curve: improvement `dy x (ay - age)+` per year before `ay`, decline `do x (age - ao)+` per year after `ao`;
  - optional early-career learning;
  - a layoff penalty `lay x (min(gap, 4) - 0.75)+`.
- **Outcome encoder**, one of:
  - binary result;
  - margin of victory: a finish counts 1, a unanimous decision `y_ud`, a split or majority decision `y_sd`, optional weights for finishes and round-1 finishes;
  - rounds: every round is a game;
  - hybrid: a blend of margin of victory and rounds.
- **Pre-UFC term** (preufc.json, strict walk-forward snapshots). Seven features:
  - shrunk non-UFC win share;
  - log pro fights;
  - strict Sherdog-network Elo;
  - Contender Series win;
  - win rate of the feeder promotion's graduates in the UFC;
  - log wins over opponents with UFC experience. Since the review, an opponent counts only if his first UFC bout was
    on or after 2015-01-01 and before the bout (every such debut was crawled);
  - feeder volume.

  It is applied only to UFC debuts on or after 2015-01-01. From then on, every debut was crawled whatever the
  fighter did later. Older debuts were crawled only if the fighter survived to 2015 or is on the current roster, and a
  term present only for them would leak survival. An earlier partial crawl "gained" 0.019 that way, so those debuts
  keep the age-only prior. The same survival rule applies to opponents in the UFC-experience count above.

| System | What it is | Tuned parameters (2019-2023) |
|---|---|---|
| `elo_ref` | The project's existing Elo (K = 44 points, x1.5 for the first 5 UFC fights) | none |
| `elo_k` | Elo with a tuned K schedule: K(1 + kb e^(-n/kn))(1 + kl x layoff) | K 0.228 (39.6 pts), kb 0.8, kn 3, kl 0.1 |
| `elo_full` | Elo + margin of victory + newcomer prior (age, pre-UFC) + age/layoff drift | K 0.285 (49.5 pts), kb 0.8, kn 6, kl 0.16; y_ud 0.9, y_sd 0.55 (finish 1); age_new -0.0625/yr; decline 0.02 x (age - 29) per year; lay 0.05; pre_net 0.40 per 100 network-Elo pts, pre_wp 3.0 |
| `elo_rounds` | Round-level Elo. Every round is a game: judge-consensus round winners where cards exist, the round-stat model elsewhere. The finishing round goes to the finisher (weight w_fround), and each unplayed round adds w_rem to him | K 0.048 per round, w_fround 1.76, w_rem 0.4, kappa 1.8 |
| `glicko2` | Glicko-2: rating deviation inflating continuously with inactivity (phi^2 + sigma^2 x days/T), volatility (Illinois update), margin-weighted games, same priors and drift | phi0 1.125, sigma0 0.11, tau 0.3, T 40 days, kappa 0.9, y_ud 0.9, y_sd 0.55; decline 0.04 x (age - 31) per year; lay 0.128 |
| `trueskill` | TrueSkill-like Gaussian (probit) moment matching; skill variance grows with time (tau_y^2 per year) and per fight (gamma^2) | s0 0.69, tau_y 0.08, gamma 0.1, kappa 0.9 |
| `trueskill_mov` | TrueSkill with ordinal outcomes. A finish truncates the performance gap at > th_fin, a unanimous decision at > th_ud, a split decision to (0, th_sd) | th_fin 0.4, th_ud 0.2, th_sd 0.18, tau_y 0.11 |
| `whr` | Whole-History Rating / Bayesian Bradley-Terry. Skill is a Gaussian random walk: x' ~ N(x + drift, w2 x years + vf). MAP by sparse Newton (PCG with chain-block preconditioner) over all nodes, re-solved before every fight day, so opponents are re-estimated retroactively. Predictive sd from the posterior chain block plus the walk since the last fight | w2 0.015 /yr, vf 0.015 per fight, s0 0.8, kappa 1.1 |
| `whr_mov` | WHR on margin-of-victory outcomes | w2 0.0375, kappa 1.2, y_sd 0.55, y_ud 1.0 |
| `whr_rounds` | WHR, every round a game (the round-level rating of the brief) | w2 0.0266, w_round 0.80, w_fround 1.5, w_rem 0.4, kappa 1.1 |
| `whr_hybrid` | WHR on lam x (margin of victory) + (1 - lam) x rounds | lam 0.27, w_round 1.0 |
| `dims` | Dimensional ratings. Offence and defence per fighter in six dimensions, Kalman (EKF) updates from per-fight stats against a walk-forward division baseline. The dimensions: sig strikes landed per minute (NB), accuracy (binomial), knockdowns per landed head strike (NB), takedowns per 15 (NB), control share (quasi-Poisson), sub attempts per 15 (NB). Process noise, prior variance and dispersion were tuned by the one-step predictive likelihood of each stat. The winner model is a no-intercept logistic on the six matchup advantages, with L2 chosen by year-wise CV | standardized coefficients: str 0.19, acc 0.13, ctl 0.10, sub 0.09, td 0.07, pwr 0.02 (L2 300) |
| `stack` | Non-negative, no-intercept logistic stack of system logits, forward selection by expanding-window CV 2020-2023 | whr_rounds 0.657, glicko2 0.356, dims 0.270 |
| `ratings_plus` | Rating logits + six A-minus-B covariates (age gap, years past 34, reach, height, log UFC fights, layoff), forward selection by the same CV, L2 1. Specified after the first 2024+ scores (post hoc; see the Verification log) | whr_rounds 0.87, layoff -0.09 per sd, height +0.12 per sd, dims 0.66, glicko2 0.31, elo_k -0.69, elo_rounds -0.57, whr 0.51 |

**Round model.** P(A wins a round) is a logistic in the round-stat differentials, fitted by EM on 5,609 pre-2019
10-9 cards (17,449 card-rounds); each judge's total constrains the hidden round winners. Coefficients:

| Per landed differential | Head | Body | Leg | Knockdown | Takedown | Control (per min) | Sub attempt |
|---|---|---|---|---|---|---|---|
| Coefficient | 0.177 | 0.152 | 0.109 | 1.443 | 0.312 | 0.448 | 0.596 |

The strike, takedown and control weights are close to research/data_baserates.md's EM fit over all 7,495 cards
(head 0.179, body 0.133, leg 0.105, takedown 0.286, control 0.46). The knockdown (1.44 vs 2.42) and sub-attempt
(0.60 vs 0.85) weights are lower; that fit used every year, this one pre-2019 cards only. Where cards exist, each round's winner probability is the
posterior given the stats and every judge's total (10-8 rate 4.5%). The consensus round share picks the decision
winner in 98.5% of decisions.

## Held-out results (2024-2025, n = 854)

| System | Tune LL 2019-23 | Rank LL 2020-23 | Test LL [95% CI] | Brier [CI] | Accuracy [CI] | ECE | Slope | dLL vs elo_ref [CI] |
|---|---|---|---|---|---|---|---|---|
| elo_ref | 0.6857 | 0.6826 | 0.6769 [0.6684, 0.6854] | 0.2421 [0.2380, 0.2463] | 55.0% [52.2, 57.9] | 0.036 | 1.13 | 0 |
| elo_k | 0.6858 | 0.6828 | 0.6772 [0.6691, 0.6854] | 0.2423 [0.2383, 0.2463] | 55.9% [53.0, 58.9] | 0.015 | 1.15 | +0.0003 [-0.0012, +0.0019] |
| elo_full | 0.6503 | 0.6490 | 0.6258 [0.6097, 0.6420] | 0.2181 [0.2107, 0.2256] | 66.0% [63.3, 68.9] | 0.047 | 1.35 | -0.0511 [-0.0676, -0.0345] |
| elo_rounds | 0.6517 | 0.6496 | 0.6258 [0.6086, 0.6433] | 0.2184 [0.2104, 0.2266] | 64.9% [61.9, 67.7] | 0.031 | 1.28 | -0.0511 [-0.0687, -0.0333] |
| glicko2 | 0.6499 | 0.6476 | 0.6233 [0.6063, 0.6403] | 0.2170 [0.2092, 0.2248] | 66.2% [63.2, 69.2] | 0.043 | 1.35 | -0.0536 [-0.0704, -0.0361] |
| trueskill | 0.6536 | 0.6511 | 0.6323 [0.6164, 0.6484] | 0.2213 [0.2140, 0.2289] | 64.6% [61.2, 68.1] | 0.037 | 1.34 | -0.0446 [-0.0601, -0.0288] |
| trueskill_mov | 0.6503 | 0.6495 | 0.6291 [0.6134, 0.6450] | 0.2197 [0.2122, 0.2271] | 65.9% [63.1, 68.8] | 0.061 | 1.35 | -0.0478 [-0.0634, -0.0321] |
| whr | 0.6526 | 0.6500 | 0.6296 [0.6141, 0.6461] | 0.2202 [0.2129, 0.2279] | 65.5% [62.2, 68.6] | 0.050 | 1.33 | -0.0473 [-0.0621, -0.0320] |
| whr_mov | 0.6488 | 0.6477 | 0.6261 [0.6102, 0.6429] | 0.2184 [0.2110, 0.2262] | 65.2% [62.4, 68.1] | 0.036 | 1.32 | -0.0508 [-0.0663, -0.0346] |
| **whr_rounds** | 0.6447 | **0.6421** | **0.6170** [0.6015, 0.6332] | 0.2141 [0.2068, 0.2217] | 66.9% [63.8, 69.8] | 0.051 | 1.47 | -0.0599 [-0.0757, -0.0446] |
| whr_hybrid | 0.6446 | 0.6422 | 0.6164 [0.6009, 0.6325] | 0.2138 [0.2066, 0.2214] | 66.2% [63.1, 69.2] | 0.044 | 1.46 | -0.0605 [-0.0760, -0.0455] |
| dims | 0.6796 (OOF) | 0.6782 | 0.6608 [0.6503, 0.6714] | 0.2341 [0.2290, 0.2392] | 61.7% [58.5, 65.1] | 0.058 | 1.81 | -0.0161 [-0.0276, -0.0039] |
| stack | 0.6440 | CV 0.6415 | 0.6112 [0.5950, 0.6286] | 0.2116 [0.2041, 0.2195] | 67.6% [64.9, 70.3] | 0.050 | 1.43 | -0.0657 [-0.0816, -0.0495] |
| ratings_plus | 0.6373 (in-sample) | CV 0.6376 | **0.6043** [0.5870, 0.6227] | 0.2082 [0.2004, 0.2168] | 67.6% [64.7, 70.5] | 0.043 | 1.41 | -0.0726 [-0.0906, -0.0542] |

Notes on reading the table:

- "Rank" is the pre-registered selection score: 2020-2023 prequential log loss (dims out of fold). whr_rounds was
  chosen on it (0.64213 vs whr_hybrid 0.64216, a tie).
- Rating-system tuning scores are in-window: their few parameters were fit on the same years. The time-ordered
  check below measures that optimism.
- Slope is the no-intercept logistic recalibration slope; above 1 means underconfident.
- Accuracy CIs are wide (about ±3 points). Accuracy separates systems far less well than log loss.
- Fighters recur across cards, but clustering on fighters as well as events barely changes the uncertainty: the
  dyadic (event + fighter) standard errors of the paired differences are within 0.0004 of the event-clustered ones
  (Verification log).

**Paired differences on 2024-2025** (A minus B; negative = A better):

| Comparison | dLL [95% CI] | P(A better) |
|---|---|---|
| whr_rounds - whr (every round a game vs binary result) | -0.0127 [-0.0229, -0.0029] | 0.996 |
| whr_mov - whr (margin of victory vs binary) | -0.0035 [-0.0093, +0.0022] | 0.90 |
| trueskill_mov - trueskill (ordinal method outcome vs binary) | -0.0032 [-0.0087, +0.0022] | 0.88 |
| elo_full - elo_k (margin + priors + drift vs K-tuned Elo) | -0.0515 [-0.0666, -0.0362] | 1.00 |
| glicko2 - elo_full (same encoder and priors) | -0.0024 [-0.0054, +0.0005] | 0.95 |
| whr_mov - elo_full (same encoder and priors) | +0.0003 [-0.0029, +0.0039] | 0.42 |
| whr_rounds - elo_rounds (both round-level) | -0.0089 [-0.0165, -0.0018] | 0.99 |
| whr_rounds - glicko2 | -0.0063 [-0.0149, +0.0024] | 0.93 |
| whr_hybrid - whr_rounds | -0.0006 [-0.0016, +0.0003] | 0.89 |
| stack - whr_rounds | -0.0057 [-0.0084, -0.0030] | 1.00 |
| ratings_plus - whr_rounds | -0.0126 [-0.0195, -0.0058] | 1.00 |
| ratings_plus - stack (post hoc) | -0.0069 [-0.0123, -0.0012] | 0.99 |
| dims - elo_k | -0.0164 [-0.0279, -0.0047] | 1.00 |

"P(A better)" is the share of bootstrap resamples in which A wins, not a posterior probability.

What the comparisons say:

- **The rating family matters little once the priors and the encoder are shared.** Glicko-2, Elo and WHR are within
  0.003 of each other with margin of victory.
- **What matters is what a fight is scored as.** Scoring rounds instead of the result is the one clear structural win,
  and it needs WHR: round-level Elo gains nothing over margin Elo (0.6258 both). A plausible reason is that WHR
  re-solves the whole history, so the many small round signals are pooled across opponents rather than consumed once.
- Margin of victory helps by about 0.003-0.004 in all three families. No single comparison is significant (each CI
  includes zero), but the sign is the same in all three.

**By year** (log loss on decisive backtest fights; 2019-2023 prequential, in-window for the parameters):

| Year | n | elo_ref | elo_full | glicko2 | trueskill_mov | whr_mov | whr_rounds | dims | stack | ratings_plus | close (n) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2019 | 388 | 0.6984 | 0.6558 | 0.6592 | 0.6537 | 0.6530 | 0.6549 | 0.6853 | 0.6542 | | 0.6319 (388) |
| 2020 | 343 | 0.6841 | 0.6591 | 0.6594 | 0.6614 | 0.6566 | 0.6522 | 0.6758 | 0.6505 | | 0.6303 (343) |
| 2021 | 415 | 0.6813 | 0.6510 | 0.6514 | 0.6513 | 0.6466 | 0.6449 | 0.6785 | 0.6447 | | 0.6393 (415) |
| 2022 | 419 | 0.6794 | 0.6459 | 0.6424 | 0.6444 | 0.6448 | 0.6326 | 0.6755 | 0.6323 | | 0.6018 (419) |
| 2023 | 390 | 0.6860 | 0.6412 | 0.6387 | 0.6424 | 0.6443 | 0.6406 | 0.6829 | 0.6399 | | 0.6142 (390) |
| 2024 | 429 | 0.6770 | 0.6334 | 0.6294 | 0.6380 | 0.6328 | 0.6198 | 0.6602 | 0.6149 | 0.6026 | 0.5872 (429) |
| 2025 | 425 | 0.6768 | 0.6181 | 0.6172 | 0.6202 | 0.6193 | 0.6141 | 0.6615 | 0.6076 | 0.6061 | 0.5835 (416) |

- whr_rounds is best or within 0.002 of the best single system in every year from 2020 on.
- The gap between whr_rounds and the close, on the same fights, is 0.02-0.03 in every year except 2021 (0.006). It
  does not shrink in the test years (0.033 and 0.027).
- The test window is easier for everyone: the close is 0.623 on 2019-2023 and 0.585 on 2024-2025. Compare test
  numbers with other 2024-2025 numbers, never with tuning-window ones.

## Calibration

Favourite orientation, 2024-2025, for whr_rounds:

| Favourite p | n | Mean predicted | Observed |
|---|---|---|---|
| 0.50-0.55 | 231 | 0.526 | 0.580 |
| 0.55-0.60 | 182 | 0.573 | 0.604 |
| 0.60-0.65 | 152 | 0.624 | 0.658 |
| 0.65-0.70 | 132 | 0.672 | 0.727 |
| 0.70-0.75 | 89 | 0.723 | 0.786 |
| 0.75-0.80 | 37 | 0.769 | 0.838 |
| 0.80-0.90 | 30 | 0.823 | 0.967 |
| 0.90-1.00 | 1 | 0.915 | 1.000 |

Favourites win 3-14 points more often than predicted in every bin.

Recalibration slope (no intercept), 2019-2023 vs 2024-2025:

| | elo_ref | elo_full | glicko2 | trueskill_mov | whr_mov | whr_rounds | dims | stack | close |
|---|---|---|---|---|---|---|---|---|---|
| 2019-2023 | 0.78 | 1.01 | 0.99 | 1.03 | 1.01 | 1.05 | 0.95 | 1.04 | 1.03 |
| 2024-2025 | 1.13 | 1.35 | 1.35 | 1.35 | 1.32 | 1.47 | 1.81 | 1.43 | 1.11 |

**This looks like a property of the period, not of these systems, and no leak was found behind it.** The kappa scales
were tuned to a slope near 1 on 2019-2023. The jump appears in four different places:

- in plain Elo, which has no tuned scale and no priors;
- in dims, which uses neither age nor pre-UFC data;
- in ml2's ML models (OOF slope 1.00, 2024-2025 1.40-1.45; research/model_ml2.md);
- and, much less, in the close.

By year it is a step at 2024 rather than a trend: whr_rounds goes 0.96, 0.95, 1.06, 1.21, 1.05 over 2019-2023, then
1.46 and 1.48. The close stays 0.96-1.16 throughout. A test-only leak would also look like underconfidence there
(better discrimination at the same scale). But it would narrow the gap to the close, and the gap is unchanged.

A temperature of about 1.4 would have helped on 2024-2025, but choosing it there is tuning on the validation window.
Leave the scales as tuned and check the slope on the vault and the forward ledger.

## Ablations (tuning window only, no re-tuning)

**One ingredient off at a time** (2019-2023 log loss; change vs the tuned system):

| Ingredient removed | elo_full | glicko2 | trueskill_mov | whr_rounds |
|---|---|---|---|---|
| (tuned) | 0.65031 | 0.64987 | 0.65029 | 0.64467 |
| age curve (dy = do = 0) | +0.0118 | +0.0110 | +0.0101 | +0.0117 |
| age decline only (do = 0) | +0.0118 | +0.0105 | +0.0101 | +0.0115 |
| early-career learning | 0 (not selected) | 0 | 0 | 0 |
| layoff drift | +0.0004 | +0.0009 | +0.0008 | +0.0005 |
| newcomer age prior | +0.0030 | +0.0025 | +0.0040 | +0.0029 |
| pre-UFC record | +0.0087 | +0.0081 | +0.0090 | +0.0078 |
| margin of victory (binary outcome) | +0.0037 | +0.0042 | n/a (ordinal flag) | n/a (rounds; see whr vs whr_rounds) |
| all trajectory terms (age, learning, layoff) | +0.0138 | +0.0139 | +0.0130 | +0.0132 |

**Cumulative** (strip one after another):

| Step | elo_full | glicko2 | trueskill_mov | whr_rounds |
|---|---|---|---|---|
| tuned | 0.6503 | 0.6499 | 0.6503 | 0.6447 |
| - margin of victory / rounds (binary result) | 0.6540 (+0.0037) | 0.6541 (+0.0042) | 0.6503 (n/a) | 0.6527 (+0.0080) |
| - pre-UFC record | 0.6628 (+0.0088) | 0.6623 (+0.0083) | 0.6593 (+0.0090) | 0.6620 (+0.0093) |
| - newcomer age prior | 0.6664 (+0.0036) | 0.6653 (+0.0030) | 0.6644 (+0.0050) | 0.6659 (+0.0039) |
| - age curve and layoff drift | 0.6867 (+0.0204) | 0.6853 (+0.0199) | 0.6830 (+0.0186) | 0.6841 (+0.0183) |
| for reference: elo_k (K tuned, nothing else) | 0.6858 | | | |

**The age curve is the single largest ingredient.** It is worth 0.012 alone and 0.020 once the priors are gone,
since the newcomer age prior and the drift overlap.

- The tuned decline in elo_full is 0.02 x (age - 29) logits per year: 0.12 per year at 35 and 0.18 at 38. That is a
  cumulative 0.81 logits from 29 to 38 before results pull a rating back.
- Glicko-2 picked a steeper curve: 0.04 x (age - 31) per year.

This agrees with research/volkanovski.md (KD susceptibility +4.0% per year past 30) and the durability model. It also
means every rating carries an age penalty that the simulator must not apply a second time through the skill hook.
Pass the rating as is. Do not add an age adjustment on top.

## Time-ordered checks inside the tuning window

Parameters chosen on 2019-2021 only, then scored on 2022-2023. These rows come from the pre-fix build (the old
opp_ufc_w count). The fix moves tuning-window log loss by about +0.0002, so the comparisons stand.

| System | 2022-23 LL, tuned on 2019-23 (in-window) | 2022-23 LL, tuned on 2019-21 only | Optimism |
|---|---|---|---|
| elo_k | 0.6830 | 0.6850 | 0.002 |
| elo_full | 0.6435 | 0.6519 | 0.008 |
| elo_rounds | 0.6457 | 0.6551 | 0.009 |
| glicko2 | 0.6406 | 0.6506 | 0.010 |
| trueskill | 0.6454 | 0.6503 | 0.005 |
| trueskill_mov | 0.6434 | 0.6468 | 0.003 |
| whr | 0.6455 | 0.6503 | 0.005 |
| whr_rounds | 0.6364 | **0.6437** | 0.007 |

The main run skipped the WHR rows for cost; the second session ran them (`review_whr`). The chain was re-chosen on 2019-2021
end to end, so no upstream WHR input saw 2022-2023:

- whr starts from elo_full's own 2019-2021 choice of the shared priors;
- whr_rounds starts from that whr choice plus elo_rounds' 2019-2021 round weights.

The 2019-2021 choice for whr_rounds differs from the full-window one: w2 0.067 vs 0.027, kappa 1.46 vs 1.10, w_round
0.6 vs 0.8. It still scores best of all systems on 2022-2023 (0.6437, against 0.6468 for trueskill_mov and 0.6506 for
glicko2), so picking whr_rounds as the best single system does not depend on in-window tuning.

- The in-window tuning scores flatter the systems with many parameters by up to 0.010. The 2024-2025 numbers carry
  none of that.
- Even tuned on 2019-2021 alone, every system with priors and drift beats Elo (0.6826 on 2022-2023) by 0.027 or more.

## Leakage and correctness checks

| Check | Result |
|---|---|
| **Reproducibility.** Rerun all 11 rating systems with the stored parameters; compare to the stored pre-fight probabilities on the 2,864 backtest fights (2019-2025) | Identical on the fixed build: max difference 0.0000 for 10 systems, 0.0001 for elo_ref (4-decimal rounding) |
| **Independent re-score** (reviewer code, outcomes from data/raw/ufc_fight_results.csv by fight id) | Every headline number reproduced. Joins clean: 2,864 ids, 0 outcome or corner-order mismatches, 0 duplicate pair-dates; 6 alias spellings and 19 duplicated raw rows (identical copies) |
| **Corner-swap symmetry.** Swap A and B on every bout since 1994 (fighters, ages, results, round stats, judges' cards), rebuild the round outcomes, rerun | P_swap(A) = 1 - P(A) to machine precision for all 11 systems (max 7.8e-16). The ratings cannot learn ufcstats' winner-first ordering (A wins 57.1% on 2019-2023, 54.1% on 2024-2025). Scoring every fight from B's corner gives the same log loss for all 14 predictors (max difference 1e-16). The dims matchup features were off by up to 0.02 before the review fix (league baseline updated A first); they are now exactly antisymmetric. stack and ratings_plus are no-intercept logistics on antisymmetric inputs |
| **No future data.** Reviewer truncation test at 4 cut days (2022-01-15, 2024-01-13, 2025-01-11, 2025-12-13): later bouts deleted, every result on the cut day flipped (winner, cards, round stats), everything rebuilt | All 11 systems and the dims pre-fight states: max difference 0.0 on and before every cut day. Positive control: flipping without truncating changes later predictions by up to 0.17. ml2's independent cut at 2024-06-01 agrees |
| **Same-day information** | No fighter has two bouts on one day after 1999-11-19. In the online systems, a card's earlier bouts therefore never inform a later bout of the same fighter |
| **Chronology** | Fight days are sorted; all 328 numbered UFC events are in date order; prelims precede the main event inside a card |
| **WHR solver** | Each day's solve uses only nodes dated before that day. The day's new nodes are initialised from predictive means after the predictions are made |
| **Pre-UFC inputs** | Strict walk-forward Sherdog snapshots (fights before the bout date). The strict network Elo rates opponents only from pages of debutants who reached the UFC before Jan 1 of the bout year. The prior is applied only to 2015+ debuts. All 1,373 such debuts have a snapshot, whether the fighter later had 1 UFC bout (163) or 8+ (369), so its presence carries no survival information. The UFC-experience count was recounted over opponents who debuted from 2015 on (review fix) |
| **Age** | Every one of the 2,809 decisive tuning and test fights has both dates of birth, so missingness cannot carry information |
| **Round model** | Fit on pre-2019 cards only, and used only to update ratings after a fight |
| **Normalisation** | dims feature scales and ratings_plus covariate scales come from 2019-2023 rows only. The pre-UFC centring constants are fixed offsets, absorbed by the tuned newcomer mean |
| **Vault** | 2026 bouts are predicted (for the sealed export) but not scored. `test_2024_plus` and every number here stop at 2025-12-31. The first full run (before the vault split) did score a pooled 2024-2026 window; see the Verification log |

Stored in `ratings.json` under `review.verify`, `review.reviewer_audit` and `review.reviewer_truncation_leak_test`.

## Market benchmark

The closing line is known only minutes before the bout. It is a benchmark here, never a feature.

| 2024-2025 fights with a close (n = 845) | Log loss | Brier | Accuracy |
|---|---|---|---|
| Close (power de-vig) | 0.5854 | 0.2005 | 69.2% |
| whr_rounds | 0.6152 (+0.030 [+0.012, +0.047]) | 0.2132 | 67.0% |
| stack | +0.024 [+0.006, +0.041] vs close | | |
| ratings_plus | +0.016 [+0.001, +0.032] vs close | | |
| Close + whr_rounds (weights 0.88 / 0.25 fit on 2019-2023) | 0.5824 (-0.0030 [-0.0057, -0.0005]) | 0.1992 | 69.6% |
| Close + whr_rounds + glicko2 + dims (fit on 2019-2023) | 0.5823 (-0.0031 [-0.0063, +0.0001]) | 0.1992 | 69.9% |

- The logits of the close and whr_rounds correlate 0.78.
- The rating carries a little information the close lacks.
- Adding more rating systems on top of the close adds nothing: the 4-member fit puts all weight on the close and glicko2.

## Residual signal and segments

**Pre-fight covariates beyond whr_rounds** (fit on 2019-2023, one at a time, per A-minus-B unit):

| Covariate | Coefficient | SE | z | 2024-25 dLL vs rescaled rating |
|---|---|---|---|---|
| reach (in) | +0.033 | 0.015 | 2.2 | -0.0008 |
| height (in) | +0.044 | 0.019 | 2.3 | -0.0012 |
| layoff (years since last UFC fight) | -0.164 | 0.081 | -2.0 | -0.0007 |
| age gap (years) | -0.015 | 0.011 | -1.4 | -0.0001 |
| years past 34 | -0.021 | 0.025 | -0.8 | +0.0003 |
| log UFC fights | -0.040 | 0.056 | -0.7 | -0.0008 |

- The age curve leaves no age signal behind.
- Size and layoff leave a little. ratings_plus picked layoff and height.

**2024-2025 by the less experienced fighter's prior UFC fights:**

| Prior UFC fights | n | whr_rounds | elo_ref |
|---|---|---|---|
| 1-2 | 262 | 0.6449 | 0.6856 |
| 3-5 | 238 | 0.5858 | 0.6649 |
| 6-10 | 251 | 0.6119 | 0.6806 |
| 11+ | 103 | 0.6304 | 0.6734 |

- whr_rounds gains 0.04-0.08 over Elo in every bucket, most at 3-5 prior fights (0.079).
- Bouts with a 1-2 fight newcomer stay the hardest. ml2 closes more of that gap with the market-rating term
  (research/model_ml2.md).

## Outputs (`data/derived/ratings.json`)

**`systems.<name>`** holds, per system:

- kind, family, label;
- tuned params;
- tuning, inner-split and 2024-2025 metrics;
- the bootstrap CIs and deltas vs elo_ref;
- calibration bins, ECE and slopes;
- the time-ordered check.

dims also stores its winner model and per-dimension filter parameters. stack and ratings_plus store members and weights.

**`predictions.<ufcstats fight id>`** has one row for each of the 2,864 backtest fights from 2019-2025:

- date, A and B slugs, the result `y` (1 = A won, 0.5 = draw, null = NC), split;
- `p`: pre-fight P(A wins) per system;
- `r`: pre-fight [mu_A, sd_A, mu_B, sd_B] per rating system (sd null for Elo);
- `dims`: pre-fight [offence, defence] per dimension and side.

How to use the `p` values by window:

- Rating systems are prequential everywhere.
- dims is out of fold for 2019-2023.
- stack is out of fold for 2020-2023.
- ratings_plus is a 2019-2023 fit; use it on 2024+ only.

**`roster.<slug>`** has 1,229 fighters. It is the live state at the Oct 31, 2026 snapshot, so it includes 2026 results.
It is for the page and live matchups only, never for scoring past fights. Each row has:

- name, division, last fight, age;
- per system: `mu`, and `sd` where the system has one. Glicko-2 also has `vol` and an Elo-scale value. WHR also has the mean and sd at the last fight;
- `dims`: off, off_sd, def, def_sd per dimension. Expected rate vs an average opponent = division baseline x exp(off), from `dim_baselines`.

**Matchup probability from roster ratings.** Here d = mu_A - mu_B and kappa is from `systems.<name>.params` (default 1):

| Family | P(A wins) |
|---|---|
| Elo | sigmoid(kappa x d) |
| Glicko-2 | sigmoid(kappa x g x d), with g = 1 / sqrt(1 + 3 (sd_A^2 + sd_B^2) / pi^2) |
| TrueSkill | Phi(kappa x d / sqrt(2 + sd_A^2 + sd_B^2)) |
| WHR | sigmoid(kappa x d / sqrt(1 + pi kappa^2 (sd_A^2 + sd_B^2) / 8)) |

`matchup_probs()` in the tool implements these, plus dims and stack.

**Current top of each men's division** (whr_rounds, active in the last two years, ordered by mean - 1 sd; mean ± sd in logits):

| Division | Top 5 |
|---|---|
| Flyweight | Joshua Van 1.93 ± 0.49; Tatsuro Taira 1.72 ± 0.52; Manel Kape 1.59 ± 0.53; Brandon Moreno 1.41 ± 0.48; Asu Almabayev 1.39 ± 0.55 |
| Bantamweight | Petr Yan 2.17 ± 0.50; Umar Nurmagomedov 2.20 ± 0.53; Merab Dvalishvili 2.13 ± 0.48; Song Yadong 1.93 ± 0.50; Sean O'Malley 1.83 ± 0.52 |
| Featherweight | Alexander Volkanovski 2.34 ± 0.50; Aljamain Sterling 1.78 ± 0.50; Diego Lopes 1.64 ± 0.52; Movsar Evloev 1.57 ± 0.52; Kevin Vallejos 1.70 ± 0.66 |
| Lightweight | Arman Tsarukyan 2.49 ± 0.57; Ilia Topuria 2.24 ± 0.53; Charles Oliveira 2.06 ± 0.50; Quillan Salkilld 1.94 ± 0.61; Max Holloway 1.76 ± 0.48 (Justin Gaethje 7th, 1.56 ± 0.49) |
| Welterweight | Islam Makhachev 3.15 ± 0.54; Shavkat Rakhmonov 2.21 ± 0.63; Ian Machado Garry 2.07 ± 0.52; Michael Morales 2.02 ± 0.62; Sean Brady 1.80 ± 0.54 |
| Middleweight | Khamzat Chimaev 2.32 ± 0.55; Dricus Du Plessis 1.91 ± 0.50; Sean Strickland 1.59 ± 0.47; Nassourdine Imavov 1.61 ± 0.51; Brendan Allen 1.55 ± 0.47 |
| Light Heavyweight | Carlos Ulberg 1.64 ± 0.57; Magomed Ankalaev 1.53 ± 0.51; Abdul Rakhman Yakhyaev 1.51 ± 0.67; Navajo Stirling 1.22 ± 0.60; Alex Pereira 1.08 ± 0.50 |
| Heavyweight | Ciryl Gane 1.77 ± 0.55; Tom Aspinall 1.83 ± 0.62; Jon Jones 1.66 ± 0.62; Alexander Volkov 1.43 ± 0.52; Sergei Pavlovich 1.40 ± 0.57 |

`python3 tools/ratings.py tables` prints the full top 10 for every division, the women's included.

**Volkanovski vs Gaethje from current ratings.** P(Volkanovski wins):

| elo_ref | elo_full | elo_rounds | glicko2 | trueskill_mov | whr_mov | whr_rounds | dims | stack | ratings_plus |
|---|---|---|---|---|---|---|---|---|---|
| 0.59 | 0.57 | 0.71 | 0.54 | 0.60 | 0.62 | 0.68 | 0.68 | 0.68 | 0.63 |

- Both are about 38. whr_rounds: Volkanovski 2.34 ± 0.50, Gaethje 1.56 ± 0.49.
- **The opening market disagrees.** Gaethje opened -180 to -200, about 37% no-vig for Volkanovski (research/matchup_market.md, high confidence).
- The ratings use one scale across divisions and have no weight-class term. BACKLOG found no measurable penalty for moving up one class after an Elo control (+0.03 log-odds, se 0.10, research/matchup_market.md), so size alone does not explain the gap. Featherweight and lightweight are linked only through fighters who moved between them, Volkanovski's two lightweight losses to Makhachev among them.
- Ratings alone trail the close by 0.02-0.03 in almost every year. Treat this matchup as a case where the market knows something the ratings do not, and do not quote the ratings' 68% as a forecast.

## Recommendation for the final ensemble

1. **Winner probability.**
   - With a line: the close plus the ML stack. The ratings add 0.003 to the close alone (above), and ml2's ML v2 already
     includes four of these systems as features (rebuilt per fight from these parameters). Do not also add the
     ratings stack on top of ML v2 without a train-only CV gain.
   - Without a line: ML v2.
   - Ratings-only fallback: for a fighter pair with no feature row, use `stack`. It has non-negative weights and
     scored 0.611.
   - ml2 rebuilt its rating features from these parameters and the pre-fix opp_ufc_w count. The fix moves the
     ratings by less than 0.0004 in log loss, so no ml2 rerun is needed for that reason alone.
2. **ratings_plus.** It is better on 2024-2025 (-0.007 vs stack), but that is a post-hoc result. It also carries
   negative weights on two correlated Elo logits (elo_k -0.69, elo_rounds -0.57). That amplifies disagreements between
   systems and is fragile on live matchups (Volk-Gaethje: 0.63 vs the stack's 0.68). Use it for backtest-row
   probabilities, not for the page.
3. **Simulator skill input.**
   - Use whr_rounds `mu` with its `sd` as the overall skill signal for any fighter. It is the most accurate single
     rating (tied with whr_hybrid), and WHR re-estimates old opponents.
   - Use dims offence/defence (with sd) as the opponent-adjusted striking, accuracy, power, takedown, control and
     submission skills. Each is a log-rate offset from the division baseline, so it maps directly onto engine rates.
     The KD-power dimension is weak (winner coefficient 0.02); prefer the durability model for chin and power.
   - Do not add an age adjustment on top of the ratings.
4. **Calibration.** Do not temper on 2024-2025. Record the slope on the vault audit and the forward ledger. If it
   stays above 1.2 there, fit one temperature on 2024-2025 for the next cycle and validate it on 2026.
5. **Maintenance.**
   - Rerun `python3 tools/ratings.py --ckpt CK` then `python3 tools/ratings.py plus` after each data refresh. With the
     checkpoint, tuning is reused when the grids are unchanged.
   - Set `OPENBLAS_NUM_THREADS=1` (the tool does it when imported first). A script that imports numpy before the tool
     gets multi-threaded BLAS, which makes a WHR run 20-60x slower on a busy box.
   - The online systems (Elo, Glicko-2, TrueSkill) update in milliseconds.
   - WHR needs a re-solve, about 10 s for the full history.

## Caveats

- **The test window is easier than the tuning window.** The close drops 0.038. Compare 2024-2025 numbers only with other 2024-2025 numbers.
- **The vault is not pristine for this tool.** The first full run (15:14 UTC, before the vault split) scored a pooled
  2024-01-01..2026-10-31 window (1,223 fights, 369 of them from 2026). That pooled log loss is in git history (commit
  d9131dd). Nothing was tuned on it. An auditor opening the vault for these ratings should know that one pooled look happened.
- **WHR variances use the fighter's own chain block.** Opponents are treated as known, as in Coulom's WHR, so the WHR sds are somewhat too small. kappa absorbs part of that on average.
- **One scale across divisions and sexes.** It is linked only by cross-division bouts and anchored by the newcomer prior. Cross-division matchups (Volk-Gaethje) are the least reliable outputs.
- **The pre-UFC prior covers only 2015+ debuts.** Fighters who debuted earlier start from the age-only prior. By 2024-2025 that matters for few active fighters.
- **Draws enter the ratings as half wins.** Winner metrics exclude them.
- **Elo looks weak here (55% accuracy).** Part of that is the backtest's makeup: 262 of the 854 test fights have a fighter with only 1-2 UFC fights, and plain Elo knows almost nothing about him. Every system is scored on the same rows, so the comparisons are fair.
- **Two results came after the 2024-2025 numbers were known**, with weights fit on 2019-2023 only: ratings_plus and
  the four-member close+ratings blend. Nothing was chosen on the test window, but both are secondary results.

## Reproduce

```
python3 tools/ratings.py --ckpt CK              # tune + final runs + outputs (~1 h on 4 cores; ~1 min with a full checkpoint)
python3 tools/ratings.py plus                   # ratings_plus, added to ratings.json
python3 tools/ratings.py tables                 # the tables above
python3 tools/ratings.py ablate                 # one-at-a-time ablations (tuning window)
python3 tools/ratings.py review                 # describe, ablation, verify -> ratings.json "review"
python3 tools/ratings.py review_whr 3           # WHR time-ordered check, 3 workers
python3 tools/ratings.py review_audit           # reviewer checks: raw join, corner order, slope by year, dyadic SEs,
                                                #   ablation on both windows, pre-UFC coverage, dims swap
python3 tools/ratings.py review_leak            # truncation + same-day flip test at 3 test-window cut days
python3 tools/ratings.py review_oppufc new      # opp_ufc_w recount (now a no-op: the tool uses the recount)
```

`ratings.json["review"]` holds `describe`, `ablation_one_at_a_time`, `ablation_cumulative` and `verify` (all on the
fixed build). It also holds `reviewer_audit` and `reviewer_truncation_leak_test` (fixed build), plus
`whr_time_ordered`, `reviewer_oppufc_new` and `reviewer_oppufc_all` (pre-fix build, kept for reference and labelled).

## Verification log

**Adversarial review, Nov 6, 2026 (8:25-9:00 pm UTC).** Brief: assume the held-out result is inflated until proven
otherwise. Hunt for look-ahead, corner-order artefacts, mismatched joins, tuning on 2024+ and over-claimed
precision; re-run the headline numbers with fresh code; fix in place. The reviewer's own scripts did not import
the tool's scoring code. They read the stored predictions, backtest.json and the raw ufcstats CSV.

**Verdict: the headline result holds.** whr_rounds 0.6170 [0.6015, 0.6332] on 2024-2025, -0.060 vs Elo; stack
0.6112; ratings_plus 0.6043. No look-ahead in the UFC history was found. Two small real defects were fixed, worth
+0.0000 to +0.0004 in test log loss. Four claims in the earlier note were wrong or too strong and are corrected
above.

What was checked, and what came out:

1. **Fresh re-score.** The analyst's numbers reproduce exactly from the stored predictions, with outcomes taken
   independently from data/raw/ufc_fight_results.csv by fight URL id.
   - Joins: 2,864 prediction ids = 2,864 backtest ids. 0 outcome mismatches, 0 corner-order mismatches, 0 duplicate
     pair-dates, no fighter twice on a day.
   - The 6 raw-name differences are alias spellings (Kai Kamaka / Kai Kamaka III, Cerqueira / Cerquiera, Pitbull /
     Freire). The 19 duplicated raw rows are identical copies of two Noche UFC cards, which the parser dedupes.
   - The market close is oriented the same way as the ratings: no strongly opposite-sign rows, and the flipped close
     would score 0.945.
2. **Corner order.** A, the first-named fighter, wins 57.1% (2019-2023) and 54.1% (2024-2025).
   - Every rating system is exactly swap-symmetric: a rerun with own swap code agrees with `review.verify`.
   - Scoring every fight from B's corner gives the same log loss for all 14 predictors (max difference 1e-16).
   - **Found:** the dims Kalman filter updated the league baseline once per side, A first (base x rho^2 + rho x k_A + k_B),
     so dims depended on the corner order. The rate-difference features were off by up to 0.022, the log-advantage
     features by 0.0009, and P(dims) by up to 3e-5; test log loss was unchanged at 5 decimals.
   - **Fixed:** the baseline now decays by rho^2 per fight and adds both sides with weight (1 + rho)/2. That keeps the
     same memory and makes the features exactly antisymmetric (max 0.0).
3. **Look-ahead in the UFC history.** Own parallel truncation test at 4 cut days, one in the tuning window and three
   in the test window. Bouts after the cut were deleted, results on the cut day flipped, everything rebuilt, and the
   11 systems plus the dims states rerun.
   - Max difference 0.0 everywhere, on the cut day and before it. The tool's `review_leak` (3 cut days) gives the same.
   - Positive control: flipping without truncating moves later predictions by up to 0.17 (WHR re-solves 710 of 857
     later fights), so the test can see a leak when there is one.
   - Chronology: days are sorted, all 328 numbered events are in date order, and prelims come before the main event.
4. **Look-ahead through external inputs** (the truncation test cannot see these).
   - preufc.py was read line by line. Every snapshot feature uses Sherdog rows dated before the bout. Promotion
     quality uses debuts and first-3-bout results before the bout. The strict network uses only pages of debutants
     who debuted before Jan 1 of the bout year.
   - Prior coverage of 2015+ debutants is 100% at every later career length (1 bout: 163 of 163; 8+: 369 of 369), so
     its presence leaks no survival.
   - **Found:** opp_ufc_w recognised an opponent as a UFC fighter through crawled pages. Pre-2015 UFC debutants were
     crawled only if they survived to 2015 or the 2026 roster, so whether an old opponent counted depended on his
     later career. The previous reviewer pass had measured this as `reviewer_oppufc_*`.
   - **Fixed:** `attach_preufc` now counts only opponents whose first UFC bout is in [2015-01-01, bout date), which
     is a complete crawl. 2,620 snapshots changed; it equals the earlier recount exactly.
   - Dates of birth: complete on every scored fight.
5. **Tuning on 2024+ and forking paths** (code and git history).
   - Every tuning trial cuts the data at 2024-01-01. Second stages are fit on 2019-2023 or earlier. Scales come from
     tuning rows only. The round model is fit on pre-2019 cards.
   - Git history shows three full builds with test scores, all with the same selection rule and grids:
     - 15:14 UTC: test = 2024-01-01..2026-10-31 (1,223 fights, **369 vault fights scored**; commit d9131dd);
     - 15:43 UTC: test cut to 2024-2025;
     - 16:44 UTC: strict network Elo replaced the cached-network column (a leak fix) and the systems were re-tuned
       once on 2019-2023; test log loss moved by 0.0004 or less.
   - **Corrected claims:**
     - "2026 fights were never scored";
     - "nothing was re-tuned after the 2024-2025 numbers were first computed";
     - "ratings_plus was specified before the 2024+ results were seen". It was built at about 15:27, after the
       per-covariate 2024+ residual deltas were stored at 15:14. Its candidates were all six covariates from that
       check and its selection used 2019-2023 CV only, but its edge over the stack is post hoc.
6. **Underconfidence on 2024-2025: period effect or leak?**
   - The slope steps up at 2024 for every UFC-history system, including untuned Elo and dims.
   - The whr_rounds-close log-loss gap is unchanged (2022 0.031, 2023 0.026, 2024 0.033, 2025 0.027). A test-only
     leak would narrow it.
   - Every ingredient's ablation value grows by a similar factor on 2024-2025 (stored parameters, diagnostic only).
     For elo_full: age and layoff drift +0.032 vs +0.020, pre-UFC +0.013 vs +0.009. The age term is built only from
     dates of birth and cannot leak.
   - **Corrected claim:** "it is not a leak" now reads "no leak found", with this evidence.
7. **Precision.** The event-clustered bootstrap is adequate.
   - Dyadic standard errors (pairs of fights sharing an event or a fighter) differ from the event-clustered ones by at
     most 0.0004. Examples: whr_rounds - elo_ref se 0.0077 vs 0.0077; ratings_plus - stack 0.0030 vs 0.0030;
     whr_rounds - glicko2 0.0046 vs 0.0043.
   - A product-weight multiway bootstrap gave intervals 3x wider. That method is known to be conservative when each
     fighter has only about 2.5 test fights, so it was not used.
   - **Corrected claims:**
     - "decomposes exactly" now says the cumulative path accounts for the gain by construction and depends on the
       removal order;
     - the whr_rounds selection is flagged as a tie with whr_hybrid (2020-2023: 0.64213 vs 0.64216);
     - "P(A better)" is described as a bootstrap share, not a probability.

**Fixes and rerun.** Code changes in tools/ratings.py:

- `OPPUFC_CLEAN` recount in `attach_preufc`;
- the symmetric baseline in `run_dims`;
- meta fields `preufc_oppufc_rule` and `review_fixes`;
- a new `review_audit` command.

Rebuild sequence:

1. `main --ckpt` with the 2019-2023 tuning checkpoint. All 11 systems and the dims filter were restored, not re-tuned.
2. `plus`.
3. `review describe,ablation,verify`.
4. `review_audit` and `review_leak`.

The vault export was rewritten with the fixed pre-fight probabilities (not scored). 2024-2025 log loss before → after:

| | elo_full | glicko2 | trueskill_mov | whr_mov | whr_rounds | whr_hybrid | dims | stack | ratings_plus |
|---|---|---|---|---|---|---|---|---|---|
| pre-fix | 0.6255 | 0.6230 | 0.6287 | 0.6258 | 0.6168 | 0.6162 | 0.6608 | 0.6108 | 0.6040 |
| fixed | 0.6258 | 0.6233 | 0.6291 | 0.6261 | 0.6170 | 0.6164 | 0.6608 | 0.6112 | 0.6043 |

The tuning-window scores moved by the same +0.0002, so the selection ranking (whr_rounds first) and the stack members
are unchanged. Volkanovski vs Gaethje: whr_rounds 0.682 → 0.684, stack 0.682 → 0.684.

**For the project log (not edited here):** docs/BACKLOG.md should record, as it does for market and ml, that the
ratings' first build scored 2024-2026 with the vault included.
