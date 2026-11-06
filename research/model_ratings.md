# Advanced fighter ratings: Elo variants, Glicko-2, TrueSkill, WHR, round-level and dimensional ratings

Nov 6, 2026. Tool: `tools/ratings.py`. Output: `data/derived/ratings.json`. Data: ufcstats snapshot through
Oct 31, 2026 (8,974 UFC bouts since 1994, 2,776 fighters), `preufc.json` (Sherdog pre-UFC records, walk-forward),
`market.json` (closing lines, benchmark only).

**Protocol.** Walk-forward over every UFC bout in date order. Each fight is predicted only from fights on earlier
days. Parameters were chosen by coordinate descent on 2019-2023 log loss, with the data stream cut at 2024-01-01 in
every trial. Second-stage models (dims winner model, stack, ratings_plus) were chosen by expanding-window CV by year
inside 2019-2023. 2024-2025 was scored once with the chosen settings. 2026 fights (the vault) were never scored.
Their pre-fight probabilities went to `ratings_vault.json` outside the repo.

**Metrics.** Draws and no-contests are excluded from winner metrics: 1,955 decisive tuning fights and 854 held-out
fights, both men with at least one prior UFC fight (`backtest.json` rows). Brackets are 95% event-clustered
bootstrap CIs (2,000 resamples of UFC cards); differences are paired.

All of this was built in two sessions. The first (cut off by the usage cap) wrote the tool and the full run (57 min
on a loaded 4-core box). This session reviewed the code, ran the ablations, the checks and the extra analyses below,
and wrote this note. Nothing was re-tuned after the 2024-2025 numbers were first computed.

## Bottom line

1. **Best single system: round-level WHR (`whr_rounds`).** It ranked first on 2020-2023 before the test was opened.
   - 2024-2025: log loss **0.6168** [0.6016, 0.6328], Brier 0.2140, accuracy 66.6%.
   - Against the project's Elo baseline (0.6769): **-0.060** [-0.076, -0.045].
   - The fight+rounds blend `whr_hybrid` ties it: 0.6162, difference -0.0006 [-0.0016, +0.0003].
   - The best online (one-pass) system is Glicko-2 at 0.6230. It is cheap enough to run in the browser.
2. **Combinations do better.**
   - The non-negative stack (whr_rounds + Glicko-2 + dims) scores **0.6108** [0.5946, 0.6279]: -0.0060 [-0.0088, -0.0033] vs whr_rounds.
   - Rating logits plus two covariates, layoff and height (`ratings_plus`), score **0.6040** [0.5868, 0.6223]: -0.0068 [-0.0123, -0.0010] vs the stack.
3. **Ratings alone do not reach the closing line, but they add to it.** On the 845 fights with a line, the close scores 0.5854.
   - whr_rounds is +0.030 [+0.012, +0.047] behind it. ratings_plus is +0.016 [+0.001, +0.032] behind.
   - Close plus the whr_rounds logit, with weights fit on 2019-2023, scores 0.5823: **-0.0031** [-0.0058, -0.0006] vs the close.
4. **Where the gain over Elo comes from.** Tuning K alone gains nothing (0.6858 vs 0.6857 on 2019-2023). The 0.036 gain
   from Elo to full Elo on 2019-2023 decomposes exactly (cumulative ablation; it returns to 0.6867 with everything off):
   - the age curve and layoff drift: 0.020;
   - the pre-UFC record (Sherdog): 0.009;
   - the newcomer age prior: 0.004;
   - margin of victory: 0.004.

   Scoring every round as a game is worth another 0.008 inside WHR on 2019-2023, and 0.0126 [0.0028, 0.0228] on 2024-2025.
5. **Every rating system is underconfident on 2024-2025, and it is not a leak.**
   - Calibration slopes are about 1.0 on 2019-2023 (0.95-1.06 for the tuned systems), but 1.28-1.47 on 2024-2025 (dims 1.81).
   - The close moves only from 1.03 to 1.11.
   - The same shift shows in plain Elo (0.78 to 1.13), in dims (no age or pre-UFC data), and in ml2's separate ML pipeline (OOF 1.00, 2024-25 1.40-1.45).
   - 2024-2025 is simply more predictable from UFC history: the close itself drops from 0.623 to 0.585.

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
  - log wins over opponents with UFC experience;
  - feeder volume.

  It is applied only to UFC debuts on or after 2015-01-01. From then on, every debut was crawled whatever the
  fighter did later. Older debuts were crawled only if the fighter survived to 2015 or is on the current roster, and a
  term present only for them would leak survival. An earlier partial crawl "gained" 0.019 that way, so those debuts
  keep the age-only prior.

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
| `stack` | Non-negative, no-intercept logistic stack of system logits, forward selection by expanding-window CV 2020-2023 | whr_rounds 0.653, glicko2 0.363, dims 0.279 |
| `ratings_plus` | Rating logits + six A-minus-B covariates (age gap, years past 34, reach, height, log UFC fights, layoff), forward selection by the same CV, L2 1. Specified before the 2024+ results were seen | whr_rounds 0.86, layoff -0.09 per sd, height +0.12 per sd, dims 0.66, glicko2 0.31, elo_k -0.68, elo_rounds -0.56, whr 0.51 |

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
| elo_full | 0.6501 | 0.6487 | 0.6255 [0.6097, 0.6417] | 0.2180 [0.2107, 0.2255] | 66.4% [63.7, 69.1] | 0.054 | 1.36 | -0.0514 [-0.0676, -0.0349] |
| elo_rounds | 0.6514 | 0.6493 | 0.6255 [0.6088, 0.6429] | 0.2182 [0.2104, 0.2264] | 64.6% [61.7, 67.4] | 0.035 | 1.28 | -0.0514 [-0.0689, -0.0341] |
| glicko2 | 0.6497 | 0.6473 | 0.6230 [0.6064, 0.6400] | 0.2168 [0.2092, 0.2246] | 66.3% [63.3, 69.3] | 0.044 | 1.36 | -0.0539 [-0.0704, -0.0368] |
| trueskill | 0.6533 | 0.6508 | 0.6318 [0.6163, 0.6477] | 0.2211 [0.2139, 0.2285] | 65.2% [61.9, 68.6] | 0.042 | 1.35 | -0.0451 [-0.0604, -0.0296] |
| trueskill_mov | 0.6500 | 0.6491 | 0.6287 [0.6132, 0.6447] | 0.2195 [0.2122, 0.2268] | 65.8% [62.9, 68.7] | 0.047 | 1.36 | -0.0482 [-0.0635, -0.0328] |
| whr | 0.6524 | 0.6497 | 0.6294 [0.6140, 0.6457] | 0.2201 [0.2129, 0.2276] | 65.8% [62.7, 68.9] | 0.053 | 1.34 | -0.0475 [-0.0620, -0.0323] |
| whr_mov | 0.6486 | 0.6475 | 0.6258 [0.6102, 0.6425] | 0.2183 [0.2110, 0.2260] | 65.8% [63.1, 68.5] | 0.043 | 1.33 | -0.0511 [-0.0664, -0.0350] |
| **whr_rounds** | 0.6444 | **0.6419** | **0.6168** [0.6016, 0.6328] | 0.2140 [0.2069, 0.2215] | 66.6% [63.6, 69.6] | 0.048 | 1.47 | -0.0601 [-0.0757, -0.0449] |
| whr_hybrid | 0.6444 | 0.6419 | 0.6162 [0.6008, 0.6323] | 0.2138 [0.2066, 0.2213] | 66.6% [63.6, 69.5] | 0.048 | 1.47 | -0.0607 [-0.0761, -0.0458] |
| dims | 0.6796 (OOF) | 0.6782 | 0.6608 [0.6503, 0.6714] | 0.2341 [0.2290, 0.2393] | 61.7% [58.5, 65.1] | 0.058 | 1.81 | -0.0161 [-0.0276, -0.0039] |
| stack | 0.6437 | CV 0.6411 | 0.6108 [0.5946, 0.6279] | 0.2114 [0.2038, 0.2193] | 67.8% [65.1, 70.4] | 0.052 | 1.43 | -0.0661 [-0.0819, -0.0501] |
| ratings_plus | 0.6371 (in-sample) | CV 0.6373 | **0.6040** [0.5868, 0.6223] | 0.2081 [0.2002, 0.2165] | 67.7% [64.9, 70.6] | 0.043 | 1.41 | -0.0729 [-0.0908, -0.0548] |

Notes on reading the table:

- "Rank" is the pre-registered selection score: 2020-2023 prequential log loss (dims out of fold). whr_rounds was
  chosen on it before the test was opened.
- Rating-system tuning scores are in-window: their few parameters were fit on the same years. The time-ordered
  check below measures that optimism.
- Slope is the no-intercept logistic recalibration slope; above 1 means underconfident.
- Accuracy CIs are wide (about ±3 points). Accuracy separates systems far less well than log loss.

**Paired differences on 2024-2025** (A minus B; negative = A better):

| Comparison | dLL [95% CI] | P(A better) |
|---|---|---|
| whr_rounds - whr (every round a game vs binary result) | -0.0126 [-0.0228, -0.0028] | 0.995 |
| whr_mov - whr (margin of victory vs binary) | -0.0036 [-0.0093, +0.0022] | 0.90 |
| trueskill_mov - trueskill (ordinal method outcome vs binary) | -0.0031 [-0.0087, +0.0023] | 0.87 |
| elo_full - elo_k (margin + priors + drift vs K-tuned Elo) | -0.0518 [-0.0668, -0.0367] | 1.00 |
| glicko2 - elo_full (same encoder and priors) | -0.0024 [-0.0053, +0.0006] | 0.95 |
| whr_mov - elo_full (same encoder and priors) | +0.0004 [-0.0029, +0.0040] | 0.41 |
| whr_rounds - elo_rounds (both round-level) | -0.0087 [-0.0164, -0.0015] | 0.99 |
| whr_rounds - glicko2 | -0.0062 [-0.0148, +0.0026] | 0.93 |
| whr_hybrid - whr_rounds | -0.0006 [-0.0016, +0.0003] | 0.89 |
| stack - whr_rounds | -0.0060 [-0.0088, -0.0033] | 1.00 |
| ratings_plus - whr_rounds | -0.0129 [-0.0197, -0.0060] | 1.00 |
| ratings_plus - stack | -0.0068 [-0.0123, -0.0010] | 0.99 |
| dims - elo_k | -0.0164 [-0.0279, -0.0047] | 1.00 |

What the comparisons say:

- **The rating family matters little once the priors and the encoder are shared.** Glicko-2, Elo and WHR are within
  0.003 of each other with margin of victory.
- **What matters is what a fight is scored as.** Scoring rounds instead of the result is the one clear structural win,
  and it needs WHR: round-level Elo gains nothing over margin Elo (0.6255 both). A plausible reason is that WHR
  re-solves the whole history, so the many small round signals are pooled across opponents rather than consumed once.
- Margin of victory helps by about 0.003-0.004 (90% probability), consistently across the three families.

**By year** (log loss on decisive backtest fights; 2019-2023 prequential, in-window for the parameters):

| Year | n | elo_ref | elo_full | glicko2 | trueskill_mov | whr_mov | whr_rounds | dims | stack | ratings_plus | close (n) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2019 | 388 | 0.6984 | 0.6558 | 0.6592 | 0.6535 | 0.6530 | 0.6549 | 0.6853 | 0.6541 | | 0.6319 (388) |
| 2020 | 343 | 0.6841 | 0.6592 | 0.6595 | 0.6615 | 0.6567 | 0.6520 | 0.6758 | 0.6502 | | 0.6303 (343) |
| 2021 | 415 | 0.6813 | 0.6500 | 0.6503 | 0.6500 | 0.6457 | 0.6441 | 0.6785 | 0.6438 | | 0.6393 (415) |
| 2022 | 419 | 0.6794 | 0.6457 | 0.6424 | 0.6442 | 0.6446 | 0.6325 | 0.6755 | 0.6321 | | 0.6018 (419) |
| 2023 | 390 | 0.6860 | 0.6412 | 0.6387 | 0.6425 | 0.6443 | 0.6407 | 0.6829 | 0.6400 | | 0.6142 (390) |
| 2024 | 429 | 0.6770 | 0.6330 | 0.6290 | 0.6375 | 0.6325 | 0.6197 | 0.6602 | 0.6144 | 0.6021 | 0.5872 (429) |
| 2025 | 425 | 0.6768 | 0.6178 | 0.6170 | 0.6199 | 0.6191 | 0.6140 | 0.6615 | 0.6072 | 0.6058 | 0.5835 (416) |

- whr_rounds is best or within 0.002 of the best single system in every year from 2020 on.
- The gap between whr_rounds and the close is 0.02-0.03 in every year except 2021 (0.005). It does not shrink in the
  test years (0.033 and 0.031).
- The test window is easier for everyone: the close is 0.623 on 2019-2023 and 0.585 on 2024-2025. Compare test
  numbers with other 2024-2025 numbers, never with tuning-window ones.

## Calibration

Favourite orientation, 2024-2025, for whr_rounds:

| Favourite p | n | Mean predicted | Observed |
|---|---|---|---|
| 0.50-0.55 | 228 | 0.526 | 0.557 |
| 0.55-0.60 | 190 | 0.574 | 0.621 |
| 0.60-0.65 | 149 | 0.624 | 0.664 |
| 0.65-0.70 | 128 | 0.673 | 0.719 |
| 0.70-0.75 | 90 | 0.721 | 0.789 |
| 0.75-0.80 | 39 | 0.769 | 0.846 |
| 0.80-0.90 | 29 | 0.824 | 0.966 |

Favourites win 3-14 points more often than predicted in every bin.

Recalibration slope (no intercept), 2019-2023 vs 2024-2025:

| | elo_ref | elo_full | glicko2 | trueskill_mov | whr_mov | whr_rounds | dims | stack | close |
|---|---|---|---|---|---|---|---|---|---|
| 2019-2023 | 0.78 | 1.02 | 0.99 | 1.04 | 1.02 | 1.06 | 0.95 | 1.04 | 1.03 |
| 2024-2025 | 1.13 | 1.36 | 1.36 | 1.36 | 1.33 | 1.47 | 1.81 | 1.43 | 1.11 |

**This is a property of the period, not of these systems.** The kappa scales were tuned to a slope near 1 on
2019-2023. The jump appears in four different places:

- in plain Elo, which has no tuned scale and no priors;
- in dims, which uses neither age nor pre-UFC data;
- in ml2's ML models (OOF slope 1.00, 2024-2025 1.40-1.45; research/model_ml2.md);
- and, much less, in the close.

A temperature of about 1.4 would have helped on 2024-2025, but choosing it there is tuning on the validation window.
Leave the scales as tuned and check the slope on the vault and the forward ledger.

## Ablations (tuning window only, no re-tuning)

**One ingredient off at a time** (2019-2023 log loss; change vs the tuned system):

| Ingredient removed | elo_full | glicko2 | trueskill_mov | whr_rounds |
|---|---|---|---|---|
| (tuned) | 0.65009 | 0.64967 | 0.64998 | 0.64445 |
| age curve (dy = do = 0) | +0.0116 | +0.0108 | +0.0098 | +0.0116 |
| age decline only (do = 0) | +0.0116 | +0.0103 | +0.0098 | +0.0114 |
| early-career learning | 0 (not selected) | 0 | 0 | 0 |
| layoff drift | +0.0004 | +0.0009 | +0.0007 | +0.0005 |
| newcomer age prior | +0.0032 | +0.0027 | +0.0043 | +0.0030 |
| pre-UFC record | +0.0089 | +0.0083 | +0.0094 | +0.0081 |
| margin of victory (binary outcome) | +0.0036 | +0.0041 | n/a (ordinal flag) | n/a (rounds; see whr vs whr_rounds) |
| all trajectory terms (age, learning, layoff) | +0.0135 | +0.0137 | +0.0126 | +0.0131 |

**Cumulative** (strip one after another):

| Step | elo_full | glicko2 | trueskill_mov | whr_rounds |
|---|---|---|---|---|
| tuned | 0.6501 | 0.6497 | 0.6500 | 0.6445 |
| - margin of victory / rounds (binary result) | 0.6537 (+0.0036) | 0.6538 (+0.0041) | 0.6500 (n/a) | 0.6524 (+0.0080) |
| - pre-UFC record | 0.6628 (+0.0091) | 0.6624 (+0.0086) | 0.6593 (+0.0094) | 0.6620 (+0.0095) |
| - newcomer age prior | 0.6664 (+0.0036) | 0.6654 (+0.0030) | 0.6644 (+0.0051) | 0.6659 (+0.0039) |
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

Parameters chosen on 2019-2021 only, then scored on 2022-2023:

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

The main run skipped the WHR rows for cost; this session ran them (`review_whr`). The chain was re-chosen on 2019-2021
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
| **Reproducibility.** Rerun all 11 rating systems with the stored parameters; compare to the stored pre-fight probabilities on the 2,864 backtest fights (2019-2025) | Identical: max difference 0.0000 for 10 systems, 0.0001 for elo_ref (4-decimal rounding) |
| **Corner-swap symmetry.** Swap A and B on every bout since 1994 (fighters, ages, results, round stats, judges' cards), rebuild the round outcomes, rerun | P_swap(A) = 1 - P(A) to machine precision for all 11 systems (max 4.4e-16). The ratings cannot learn ufcstats' winner-first ordering (A wins 56%). dims, stack and ratings_plus are no-intercept logistics on antisymmetric features, so they are symmetric too |
| **No future data.** ml2 independently truncated the data after 2024-06-01, and separately flipped every result after it (ml2.json `verify`) | whr_rounds, glicko2, elo_full, trueskill_mov: predictions before the cut unchanged (max difference 0.0) |
| **Same-day information** | No fighter has two bouts on one day after 1999-11-19. In the online systems, a card's earlier bouts therefore never inform a later bout of the same fighter |
| **WHR solver** | Each day's solve uses only nodes dated before that day. The day's new nodes are initialised from predictive means after the predictions are made |
| **Pre-UFC inputs** | Strict walk-forward Sherdog snapshots (fights before the bout date). The strict network Elo rates opponents only from pages of debutants who reached the UFC before Jan 1 of the bout year. The prior is applied only to 2015+ debuts, where coverage is complete and outcome-independent (see Systems) |
| **Age** | Every one of the 2,809 decisive tuning and test fights has both dates of birth, so missingness cannot carry information |
| **Round model** | Fit on pre-2019 cards only, and used only to update ratings after a fight |
| **Vault** | 2026 bouts are predicted (for the sealed export) but never scored. `test_2024_plus` and every number here stop at 2025-12-31 |

Stored in `ratings.json` under `review.verify` (rerun: `python3 tools/ratings.py review verify`, about 3 min idle).

## Market benchmark

The closing line is known only minutes before the bout. It is a benchmark here, never a feature.

| 2024-2025 fights with a close (n = 845) | Log loss | Brier | Accuracy |
|---|---|---|---|
| Close (power de-vig) | 0.5854 | 0.2005 | 69.2% |
| whr_rounds | 0.6151 (+0.030 [+0.012, +0.047]) | 0.2132 | 66.7% |
| stack | +0.023 [+0.005, +0.040] vs close | | |
| ratings_plus | +0.016 [+0.001, +0.032] vs close | | |
| Close + whr_rounds (weights 0.88 / 0.26 fit on 2019-2023) | 0.5823 (-0.0031 [-0.0058, -0.0006]) | 0.1992 | 69.7% |
| Close + whr_rounds + glicko2 + dims (fit on 2019-2023) | 0.5821 (-0.0032 [-0.0065, -0.0000]) | 0.1992 | 69.9% |

- The logits of the close and whr_rounds correlate 0.78.
- The rating carries a little information the close lacks.
- Adding more rating systems on top of the close adds nothing: the 4-member fit puts all weight on the close and glicko2.

## Residual signal and segments

**Pre-fight covariates beyond whr_rounds** (fit on 2019-2023, one at a time, per A-minus-B unit):

| Covariate | Coefficient | SE | z | 2024-25 dLL vs rescaled rating |
|---|---|---|---|---|
| reach (in) | +0.033 | 0.015 | 2.2 | -0.0008 |
| height (in) | +0.045 | 0.019 | 2.3 | -0.0013 |
| layoff (years since last UFC fight) | -0.161 | 0.081 | -2.0 | -0.0007 |
| age gap (years) | -0.015 | 0.011 | -1.3 | -0.0001 |
| years past 34 | -0.019 | 0.025 | -0.8 | +0.0003 |
| log UFC fights | -0.035 | 0.056 | -0.6 | -0.0007 |

- The age curve leaves no age signal behind.
- Size and layoff leave a little. ratings_plus picked layoff and height.

**2024-2025 by the less experienced fighter's prior UFC fights:**

| Prior UFC fights | n | whr_rounds | elo_ref |
|---|---|---|---|
| 1-2 | 262 | 0.6444 | 0.6856 |
| 3-5 | 238 | 0.5856 | 0.6649 |
| 6-10 | 251 | 0.6121 | 0.6806 |
| 11+ | 103 | 0.6305 | 0.6734 |

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
| Flyweight | Joshua Van 1.94 ± 0.49; Tatsuro Taira 1.73 ± 0.52; Manel Kape 1.63 ± 0.53; Brandon Moreno 1.42 ± 0.48; Asu Almabayev 1.44 ± 0.55 |
| Bantamweight | Petr Yan 2.18 ± 0.50; Umar Nurmagomedov 2.20 ± 0.53; Merab Dvalishvili 2.14 ± 0.48; Song Yadong 1.94 ± 0.50; Sean O'Malley 1.84 ± 0.52 |
| Featherweight | Alexander Volkanovski 2.36 ± 0.50; Aljamain Sterling 1.79 ± 0.50; Diego Lopes 1.67 ± 0.52; Movsar Evloev 1.58 ± 0.52; Kevin Vallejos 1.71 ± 0.66 |
| Lightweight | Arman Tsarukyan 2.51 ± 0.57; Ilia Topuria 2.25 ± 0.53; Charles Oliveira 2.08 ± 0.50; Quillan Salkilld 1.94 ± 0.61; Max Holloway 1.78 ± 0.48 (Justin Gaethje 7th, 1.58 ± 0.49) |
| Welterweight | Islam Makhachev 3.16 ± 0.54; Shavkat Rakhmonov 2.21 ± 0.63; Ian Machado Garry 2.08 ± 0.52; Michael Morales 2.02 ± 0.62; Sean Brady 1.83 ± 0.54 |
| Middleweight | Khamzat Chimaev 2.33 ± 0.55; Dricus Du Plessis 1.92 ± 0.50; Sean Strickland 1.60 ± 0.47; Nassourdine Imavov 1.62 ± 0.51; Brendan Allen 1.56 ± 0.47 |
| Light Heavyweight | Carlos Ulberg 1.65 ± 0.57; Magomed Ankalaev 1.54 ± 0.51; Abdul Rakhman Yakhyaev 1.52 ± 0.67; Navajo Stirling 1.23 ± 0.60; Alex Pereira 1.09 ± 0.50 |
| Heavyweight | Ciryl Gane 1.79 ± 0.55; Tom Aspinall 1.85 ± 0.61; Jon Jones 1.67 ± 0.62; Alexander Volkov 1.45 ± 0.52; Sergei Pavlovich 1.41 ± 0.57 |

`python3 tools/ratings.py tables` prints the full top 10 for every division, the women's included.

**Volkanovski vs Gaethje from current ratings.** P(Volkanovski wins):

| elo_ref | elo_full | elo_rounds | glicko2 | trueskill_mov | whr_mov | whr_rounds | dims | stack | ratings_plus |
|---|---|---|---|---|---|---|---|---|---|
| 0.59 | 0.56 | 0.70 | 0.54 | 0.59 | 0.61 | 0.68 | 0.68 | 0.68 | 0.63 |

- Both are about 38. whr_rounds: Volkanovski 2.36 ± 0.50, Gaethje 1.58 ± 0.49.
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
2. **ratings_plus.** It is better on 2024-2025 (-0.007 vs stack), but it carries negative weights on two correlated
   Elo logits (elo_k -0.68, elo_rounds -0.56). That amplifies disagreements between systems and is fragile on live
   matchups (Volk-Gaethje: 0.63 vs the stack's 0.68). Use it for backtest-row probabilities, not for the page.
3. **Simulator skill input.**
   - Use whr_rounds `mu` with its `sd` as the overall skill signal for any fighter. It is the most accurate single
     rating, and WHR re-estimates old opponents.
   - Use dims offence/defence (with sd) as the opponent-adjusted striking, accuracy, power, takedown, control and
     submission skills. Each is a log-rate offset from the division baseline, so it maps directly onto engine rates.
     The KD-power dimension is weak (winner coefficient 0.02); prefer the durability model for chin and power.
   - Do not add an age adjustment on top of the ratings.
4. **Calibration.** Do not temper on 2024-2025. Record the slope on the vault audit and the forward ledger. If it
   stays above 1.2 there, fit one temperature on 2024-2025 for the next cycle and validate it on 2026.
5. **Maintenance.**
   - Rerun `python3 tools/ratings.py --ckpt CK` then `python3 tools/ratings.py plus` after each data refresh. With the
     checkpoint, tuning is reused when the grids are unchanged.
   - The online systems (Elo, Glicko-2, TrueSkill) update in milliseconds.
   - WHR needs a re-solve, about 10 s for the full history.

## Caveats

- **The test window is easier than the tuning window.** The close drops 0.038. Compare 2024-2025 numbers only with other 2024-2025 numbers.
- **WHR variances use the fighter's own chain block.** Opponents are treated as known, as in Coulom's WHR, so the WHR sds are somewhat too small. kappa absorbs part of that on average.
- **One scale across divisions and sexes.** It is linked only by cross-division bouts and anchored by the newcomer prior. Cross-division matchups (Volk-Gaethje) are the least reliable outputs.
- **The pre-UFC prior covers only 2015+ debuts.** Fighters who debuted earlier start from the age-only prior. By 2024-2025 that matters for few active fighters.
- **Draws enter the ratings as half wins.** Winner metrics exclude them.
- **Elo looks weak here (55% accuracy).** Part of that is the backtest's makeup: 262 of the 854 test fights have a fighter with only 1-2 UFC fights, and plain Elo knows almost nothing about him. Every system is scored on the same rows, so the comparisons are fair.
- **One analysis was added this session**, after the main 2024-2025 numbers were known: the four-member close+ratings blend. Its weights were fit on 2019-2023, so nothing was chosen on the test window, but it is a secondary result.

## Reproduce

```
python3 tools/ratings.py --ckpt /tmp/ratings_ck.json   # tune + final runs + outputs (~1 h on 4 cores)
python3 tools/ratings.py plus                          # ratings_plus, added to ratings.json
python3 tools/ratings.py tables                        # the tables above
python3 tools/ratings.py ablate                        # one-at-a-time ablations (tuning window)
python3 tools/ratings.py review                        # this session's checks and extra analyses -> ratings.json "review"
                                                       #   (parts: describe, ablation, verify; e.g. `review verify`)
python3 tools/ratings.py review_whr 3                  # WHR time-ordered check, 3 workers (~15 min idle)
```

`ratings.json["review"]` holds: `describe` (by-year log loss, calibration slopes, paired differences, close+rating
blends), `ablation_one_at_a_time`, `ablation_cumulative`, `whr_time_ordered` and `verify`. The `describe`/`ablation`
parts were written by `review`; `verify` and `whr_time_ordered` came from scratch copies of the same procedures, run
in parallel under load.
