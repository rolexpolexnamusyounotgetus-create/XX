# Hierarchical Bayesian dynamic skill model (task key: bayes)

Nov 6, 2026, 10:25-11:20 pm UTC. This run continued the partial work of an earlier run that a container restart
killed at about 10:22 pm: the data stage, the Laplace filter and the empirical-Bayes fitting were reused; the EP
smoothing refits, the prediction schedule, the CV / stack / confirm / export stages and everything below are new.
Tool: `tools/bayes.py`. Output: `data/derived/bayes.json`. Plugin: `tools/blindtest_plugins/bayes.py`. Test:
`tests/test_bayes.py`. Scratch caches:
`out/bayes_cache/` (gitignored; `cv.json`, `eval.json`, `stack.json`, `confirm.json`, `swaptest.json` and the logs are
the sources of every number here and are copied into `bayes.json`).

All brackets are 95% event-cluster bootstrap CIs (2,000 resamples of UFC cards), paired where they are differences;
negative = the first-named model is better. Log loss throughout, lower is better. Decisive fights where both men have
a prior UFC fight (the backtest universe): 1,955 in 2019-2023, 854 in 2024-2025.

## Bottom line

1. **As a rating system it is the best in the project, by a hair: level with round-level WHR and ahead of Glicko-2.**
   It does not get near ML v2 or the closing line, and on its own it adds nothing to any stack that contains ML v2
   or a line.

   | winner log loss | 2019-2023 OOF (1,955) | bayes minus it [CI] | 2024-2025, scored once (854) | bayes minus it [CI] |
   |---|---|---|---|---|
   | **bayes** (monthly EP refits, variance-aware link) | **0.6439** | | **0.6153** | |
   | whr_rounds (ratings.py; parameters tuned on 2019-2023) | 0.6447 | -0.0008 [-0.0074, +0.0054] | 0.6170 | -0.0017 [-0.0106, +0.0073] |
   | glicko2 | 0.6499 | -0.0060 [-0.0152, +0.0029] | 0.6233 | -0.0080 [-0.0211, +0.0051] |
   | ratings stack (whr_rounds + glicko2 + dims) | 0.6440 | -0.0001 [-0.0069, +0.0060] | 0.6112 | +0.0041 [-0.0048, +0.0130] |
   | ML v2 logistic | 0.6356 | +0.0083 [-0.0006, +0.0170] | 0.5887 | +0.0267 [+0.0148, +0.0380] |
   | closing line | 0.6232 | +0.0207 [+0.0098, +0.0311] | 0.5854 (845) | +0.0270 [+0.0083, +0.0448] |

   bayes is walk-forward clean (hyperparameters refit each Jan 1 on earlier fights); whr_rounds's few parameters were
   tuned on 2019-2023 itself, which the ratings note puts at about 0.001-0.002 of optimism.
2. **Stack gate (forward-chained 2021-2023, ml2's code and 0.0005 rule; frozen and committed in 55c74e5 before the
   2024-25 look).** bayes enters only the page no-line stack (ML v2 logistic + market rating: CV -0.0010, weight 0.29)
   and the ratings-only stacks (-0.0022 to -0.0024). It gets weight 0 next to the close, and it is rejected in the open
   stacks and in ml2's CV-chosen no-line stack. On 2024-25 the one stack it entered that matters for production does
   not improve: page no-line + bayes **+0.0007 [-0.0024, +0.0036]**. Recommendation: **do not add it to the page
   no-line stack**; the CV gain was within noise and the confirmation is flat. As a WHR substitute or partner in a
   ratings-only fallback it helps consistently (2024-25 -0.0042 to -0.0045, CI just touching 0).
3. **What carried the gain over a filter.** Re-solving the history with expectation propagation (TrueSkill-through-
   time style) is the one big structural gain: monthly EP refits vs the plain one-pass filter **-0.0049 [-0.0075,
   -0.0023]** on 2019-2023 (2024-25: -0.0036 [-0.0076, +0.0001]). The stat likelihood (strikes, takedowns, control,
   submissions, knockdowns feeding the skills) is worth **-0.0070 [-0.0124, -0.0017]** over the same model with results
   only. This is the same lesson as the ratings note ("scoring rounds needs WHR"): many small signals pay only when the
   whole history is re-solved.
4. **Uncertainty: the posterior is useful for calibration but does not flag the hard fights.**
   - Folding the posterior variance into the probability (P = sigmoid(m / sqrt(1 + pi v / 8))) fixes the plug-in's
     overconfidence on 2019-2023: calibration slope 0.80 -> 0.99, log loss -0.0024 [-0.0055, +0.0008] (chosen by CV).
   - But **high posterior uncertainty does not mean lower accuracy.** Across terciles of the posterior sd of the result
     logit, accuracy is 61.4% / 62.7% / 63.0% on 2019-2023 and 62.1% / 67.6% / 71.2% on 2024-25: the most uncertain
     third is the most predictable. Given |logit p|, the sd adds nothing to P(correct) (2019-2023 coefficient +0.02,
     se 0.24). The variance-aware link therefore over-shrinks high-sd fights and under-shrinks low-sd ones (slopes
     0.89 / 1.04 / 1.05; 2024-25 1.09 / 1.32 / 1.51).
   - On 2024-25, where every model is underconfident, the plug-in link scores better (+0.0041 [+0.0001, +0.0080] for
     the variance-aware one). Not selectable: 2019-2023 CV chose the variance-aware link.
5. **Method x round and stat lines: a usable generative layer, not a better one.** Method cells trail methodround S on
   2019-2023 (method3 +0.0108 [+0.0025, +0.0189], joint +0.0054 n.s.) and lead it on 2024-25 (method3 -0.0161
   [-0.0290, -0.0034]); the sign flip says neither is reliably better. Stat lines (Poisson deviance given the actual
   minutes): knockdowns beat mlrates on 2019-2023 (-0.028 [-0.054, -0.005]; 2024-25 -0.013 n.s.); takedowns, control
   and submissions are level; significant strikes are 6-11% worse (+0.73 / +1.23).
6. **Simulator inputs.** `bayes.json` carries a production roster (hyperparameters fit on everything before
   2026-01-01, EP over every fight through 2025-12-31): for 1,285 fighters with a 2019-2025 UFC fight, the posterior
   mean and sd of all 11 skills and the implied per-minute rates against an average opponent. For the project's
   matchup: P(Volkanovski beats Gaethje) = **0.755** (logit sd 0.71), against whr_rounds 0.684 (ratings.json).

## Model

Every fighter carries an 11-dimensional latent skill vector x (log-rate multipliers; r in logit units):

| dim | meaning | observed through |
|---|---|---|
| r | overall skill | soft round wins (ratings.py "rounds" encoder: judges' cards / round model, finishes, unplayed rounds) |
| so / sd | striking offence / defence | sig strikes landed by A in round j: NegBin(mins_j m_j exp(L_str + so_A - sd_B + u + e_A + ca_A (j-1)), k) |
| to / tdd | takedown offence / defence | takedowns per fight: NegBin(mins/15 exp(L_td + to_A - tdd_B)) |
| co | top control | control time (30 s units): NegBin(2 mins exp(L_ctl + co_A - tdd_B)) |
| su / sdf | submission threat / defence | sub attempts: NegBin(mins/15 exp(L_sub + su_A - sdf_B)) |
| pw / ch | power / chin | knockdowns per head strike landed: NegBin((head_A + 1) exp(L_kd + pw_A - ch_B)) |
| ca | cardio / pace | own output trend per round (above) |

- **Result link.** Soft round wins ~ Bernoulli(sigmoid(eta)), eta = beta_up' Delta, where Delta are the seven
  antisymmetric matchup features (r, striking, takedown, control, submission, KO, cardio advantages). Method given
  the winner: multinomial KO / SUB / DEC with division offsets and skill terms (power vs chin, submission vs defence,
  striking and takedown edges, eta). Finishing round from walk-forward shapes by format; draws at the walk-forward share.
- **Fight effects.** u (shared pace) and e_A, e_B (fight-night form) are latent per fight and integrated out, so the
  ten round-level strike counts are conditionally independent.
- **Dynamics.** Between fights x moves by a deterministic drift (age curve: improvement before 25, decline after 29 at
  an EB/CV-fit rate; layoff penalty on r; age-dependent drift of the stat skills) plus Gaussian noise
  q_fight + q_year x gap (gap capped at 6 years), i.e. the random walk is scaled by inactivity.
- **Hierarchical priors.** A debutant starts at N(mu0, Sigma0): mu0 for r regressed on age and the seven Sherdog pre-UFC
  features (walk-forward snapshots, debuts from 2015 on), the full 11 x 11 population covariance estimated by EM
  (in the 2024 fit r correlates 0.3-0.7 with the striking, wrestling and defensive skills and about 0 with
  submission threat). L_* are walk-forward exponentially weighted
  division baselines (pre-fight values).

## Inference

NumPyro is not installed here, and SVI over ~17,000 fighter-fight states refit walk-forward would be far slower than
the task allows, so the model uses the Kalman / EP approximation the task offers.

- **Filter (between refits).** After every fight day: a Laplace (Newton) update of the joint Gaussian over
  z = [x_A, x_B, u, e_A, e_B] (25 dimensions, 21 observation rows); both fighters' marginals are kept.
- **EP refit (at each cut day).** Expectation propagation over every earlier fight: each fight is a factor whose
  per-fighter Gaussian messages are re-estimated from the cavity (forward-backward over every fighter chain, i.e. all
  other information about both men, earlier and later) times the likelihood, with Laplace moments; parallel updates,
  damping 0.8, until the skill means move < 0.002 (14 sweeps from the filter's messages, 6-7 when warm-started from
  the previous refit; about 1.4 s per sweep over 7,500 fights). Converged log loss does not depend on the damping (0.66201 / 0.66202 / 0.66202 at
  0.5 / 0.8 / 1.0 on a test year). The filter then carries the EP state forward to the next cut.
- **Hyperparameters (empirical Bayes, refit every Jan 1 on data before it, warm-started from the previous year).**
  An EM M-step on per-fighter RTS-smoothed states (newcomer prior, Sigma0, stat-skill process noise and age drift,
  pace / form sds); type-II ML of the stat-side variance scales and NB dispersions on one-step predictive likelihood;
  no-intercept GLMs for the win link and the method model on the trailing 7 / 10 years; a coordinate search of the
  result-side scalars (r process noise, prior variance, encoder weights, age decline, layoff) on one-step-ahead
  winner log loss of the trailing 7 years. About 2-4 minutes per year on one core.
- **Prediction.** P(A) = sigmoid(m / sqrt(1 + pi v / 8)), with m and v the mean and variance of beta' Delta under the
  pre-fight posterior (the plug-in sigmoid(m) is the alternative); 23 method x round cells in methodround's layout;
  expected stat lines; per-fighter skill means and sds.

## Protocol

- Fights dated 2026-01-01 or later are dropped right after parsing (build_db.parse_fights is wrapped); the data
  ends 2025-12-13. No 2026 row was read, so nothing went to the vault.
- Every choice (EP schedule, link, variant, the option grid below, the stack gate) was made on 2019-2023 out-of-fold
  predictions (each year predicted with hyperparameters fit before its Jan 1) or the forward-chained 2021-2023 stack CV.
  The decisions were exported and committed (55c74e5, 11:07 pm UTC) before `confirm` scored 2024-2025 once
  (11:08 pm; `confirm` refuses to rerun without --force, and `forced_rerun` is false in bayes.json).
- 2024-2025 "static" = hyperparameters fit before 2024-01-01, states updated through 2025 (EP refits + filter);
  "roll" = 2025 from the fit before 2025-01-01. The plugin uses roll for the blind window.
- Corner symmetry: no intercepts anywhere; the swap test reruns 2019 on the corner-swapped data and finds
  max |P(A,B) + P(B,A) - 1| = 9e-16, mirrored method x round cells to 7e-16, stat lines to 2e-13, skills to 1e-14.

## CV choices (2019-2023 OOF, 1,955 fights)

Rule: stepwise from the simplest; a more complex option is taken only if it beats the current choice by more than
0.0005 (ml2's SEL_MIN). Every option tried is listed (the grid was run after the schedule results were seen, on
pre-2024 data only).

| variant / EP schedule / option | variance-aware link | plug-in link |
|---|---|---|
| main, filter only (no EP) | 0.64876 | 0.65222 |
| main, EP every Jan 1 | 0.64511 | 0.64772 |
| main, EP every quarter | 0.64440 | 0.64691 |
| **main, EP every month (chosen)** | **0.64390** | 0.64630 |
| main, yearly EP + win link refit on EP states ("+g") | 0.64492 | 0.64811 |
| main, yearly EP, r process noise x 0.1 / 0.25 / 0.67 / 1.5 / 2.25 | 0.64760 / 0.64635 / 0.64523 / 0.64533 / 0.64599 | |
| main, yearly EP, round-encoder weight x 2 / with noise x 0.25 | 0.64561 / 0.64524 | |
| nostats (results only), filter / yearly EP / quarterly EP | 0.65359 / 0.65122 / 0.65091 | 0.65927 / 0.65613 / 0.65571 |

- Steps taken: filter -> yearly EP (-0.0037) -> quarterly (-0.0007) -> monthly (-0.0005, just over the rule);
  plug-in -> variance-aware (-0.0024); nostats -> main (-0.0073). "+g" and every noise / weight multiplier fail
  the rule (best +0.0001).
- WHR keeps its process noise small (w2 0.027 per year) where the filter-tuned r noise is 2-8 times larger; shrinking
  it under EP did not help (x0.25: +0.0012), so the filter-tuned hyperparameters were kept.

By year (log loss):

| year | n | bayes | whr_rounds | glicko2 | ML v2 logistic |
|---|---|---|---|---|---|
| 2019 | 388 | 0.6561 | 0.6549 | 0.6592 | 0.6481 |
| 2020 | 343 | 0.6450 | 0.6522 | 0.6594 | 0.6361 |
| 2021 | 415 | 0.6449 | 0.6449 | 0.6514 | 0.6369 |
| 2022 | 419 | 0.6329 | 0.6326 | 0.6424 | 0.6271 |
| 2023 | 390 | 0.6415 | 0.6406 | 0.6387 | 0.6305 |
| 2024 (static) | 429 | 0.6197 | 0.6199 | 0.6294 | 0.5905 |
| 2025 (static) | 425 | 0.6109 | 0.6141 | 0.6172 | 0.5868 |

## Standalone comparison with the rating systems

| | 2019-2023 LL [CI] | acc | slope | 2024-2025 LL [CI] | acc | slope |
|---|---|---|---|---|---|---|
| bayes | 0.6439 [0.6302, 0.6572] | 62.4% | 0.99 | 0.6153 [0.5976, 0.6342] | 67.0% | 1.32 |
| bayes, rolling (2025 from the fit before 2025) | | | | 0.6146 | 66.6% | 1.34 |
| whr_rounds | 0.6447 [0.6319, 0.6575] | 61.6% | 1.05 | 0.6170 [0.6015, 0.6332] | 66.9% | 1.47 |
| glicko2 | 0.6499 [0.6369, 0.6631] | 60.6% | 0.99 | 0.6233 [0.6063, 0.6404] | 66.2% | 1.35 |
| elo_full | 0.6503 | 61.4% | 1.01 | 0.6258 | 66.0% | 1.35 |
| trueskill_mov | 0.6503 | 60.3% | 1.03 | 0.6291 | 65.9% | 1.35 |
| dims (ratings.py dimensional EKF) | 0.6796 | 56.2% | 0.95 | 0.6608 | 61.7% | 1.81 |
| Elo (project baseline) | 0.6857 | 55.0% | 0.78 | 0.6769 | 55.1% | 1.13 |

Paired, bayes minus: elo_full -0.0064 [-0.0156, +0.0026] / -0.0105 [-0.0242, +0.0025]; trueskill_mov -0.0064
[-0.0157, +0.0023] / -0.0138 [-0.0270, -0.0009]; dims -0.0357 [-0.0482, -0.0241] / -0.0455 [-0.0623, -0.0295]
(2019-2023 / 2024-2025). Brier 0.2265 vs whr_rounds 0.2268 (2019-2023), 0.2134 vs 0.2141 (2024-25).

Where it differs from WHR (bayes minus whr_rounds):

| bout type (min prior UFC fights) | 2019-2023 n | bayes / whr | diff [CI] | 2024-2025 n | bayes / whr | diff [CI] |
|---|---|---|---|---|---|---|
| newcomer bout (1-2) | 699 | 0.6400 / 0.6455 | -0.0055 [-0.0187, +0.0062] | 262 | 0.6447 / 0.6449 | -0.0002 [-0.0170, +0.0171] |
| 3-7 | 822 | 0.6412 / 0.6376 | +0.0036 [-0.0049, +0.0119] | 354 | 0.5993 / 0.5953 | +0.0040 [-0.0101, +0.0181] |
| 8+ | 434 | 0.6552 / 0.6568 | -0.0016 [-0.0108, +0.0082] | 238 | 0.6069 / 0.6185 | -0.0116 [-0.0233, +0.0013] |

The dimensional EKF in ratings.py (`dims`, same stat families, filter only, winner from a logistic on the six
advantages) is 0.036-0.046 worse: the joint model, the round-result link feeding the same skills, and the EP refits
are what turn stat skills into a competitive winner model.

## Stack gate (forward-chained 2021-2023)

Fit on 2019..Y-1 OOF rows, predict Y, for Y = 2021, 2022, 2023; recency half-life chosen by the same CV; no intercept,
non-negative logit weights (tools/ml2.py stack_fit / stack_predict). 1,224 CV fights.

| regime: base stack | CV base | CV + bayes | gain [paired CI, CV years] | bayes weight (fit <= 2023) | decision | 2024-25 static: plus minus base [CI] |
|---|---|---|---|---|---|---|
| close: market + ml2 | 0.61614 | 0.61617 | +0.00003 | 0.00 | rejected | 0 |
| close: page market + ml2lr | 0.61624 | 0.61627 | +0.00003 | 0.00 | rejected | 0 |
| close: market + whr | 0.61743 | 0.61734 | -0.00009 [-0.0011, +0.0008] | 0.14 | rejected | -0.0006 [-0.0018, +0.0006] |
| no line: ml2 + mkt_rating + feat_lr (ml2's CV choice) | 0.62854 | 0.62823 | -0.00031 [-0.0019, +0.0012] | 0.20 | rejected | +0.0002 [-0.0019, +0.0023] |
| **no line: page ml2lr + mkt_rating** | 0.62984 | 0.62883 | **-0.00101** [-0.0034, +0.0011] | 0.29 | **enters** | **+0.0007 [-0.0024, +0.0036]** |
| no line: whr + glicko2 (ratings only) | 0.63910 | 0.63666 | -0.00244 [-0.0067, +0.0014] | 0.58 | enters | -0.0045 [-0.0096, +0.0007] |
| no line: whr alone | 0.63942 | 0.63718 | -0.00224 [-0.0064, +0.0016] | 0.55 | enters | -0.0042 [-0.0093, +0.0007] |
| open: open + ml2 | 0.62231 | 0.62238 | +0.00007 [-0.0007, +0.0008] | 0.06 | rejected | +0.0001 [-0.0006, +0.0008] |
| open: page open + ml2lr | 0.62275 | 0.62261 | -0.00014 [-0.0012, +0.0008] | 0.11 | rejected | +0.0004 [-0.0009, +0.0015] |

Rolling stacks (refit each January on the rolling columns) give the same 2024-25 picture (page no-line +0.0006
[-0.0016, +0.0029]; ratings only -0.0046 [-0.0095, +0.0004]). bayes vs whr as the single rating input: alone
+0.0009 [-0.0060, +0.0076], next to the market +0.0001 [-0.0017, +0.0018] (CV years): interchangeable, and
partly complementary (the pair beats either).

## Uncertainty calibration

Fights split into terciles of the posterior sd of the result logit (beta' Delta); "va" = variance-aware link.

| window | sd tercile | n | mean edge | accuracy | LL va / plug-in | slope va / plug-in | share newcomer bouts | whr accuracy |
|---|---|---|---|---|---|---|---|---|
| 2019-2023 | 0.83-1.09 | 652 | 0.126 | 61.4% | 0.6534 / 0.6568 | 0.89 / 0.75 | 50% | 59.8% |
| | 1.09-1.20 | 651 | 0.124 | 62.7% | 0.6403 / 0.6417 | 1.04 / 0.85 | 38% | 62.2% |
| | 1.20-1.98 | 652 | 0.128 | 63.0% | 0.6380 / 0.6404 | 1.05 / 0.81 | 20% | 62.7% |
| 2024-2025 | 0.93-1.12 | 285 | 0.114 | 62.1% | 0.6464 / 0.6467 | 1.09 / 0.91 | 74% | 60.4% |
| | 1.12-1.18 | 284 | 0.125 | 67.6% | 0.6217 / 0.6179 | 1.32 / 1.07 | 14% | 70.1% |
| | 1.18-1.45 | 285 | 0.148 | 71.2% | 0.5778 / 0.5689 | 1.51 / 1.19 | 3% | 70.2% |

- P(correct) regressed on |logit p| and the sd: sd coefficient +0.02 (se 0.24) on 2019-2023, +1.33 (se 0.98) on
  2024-25. Uncertainty adds nothing to accuracy beyond the point estimate, and if anything points the wrong way.
- Why: the low-sd third is mostly newcomer bouts (50% on 2019-2023, 74% on 2024-25). The r uncertainty grows over a
  career instead of shrinking: the mean pre-fight sd of r is 0.67 in newcomer bouts, 0.95 at 3-7 prior fights and 1.13
  at 8+, against a debut prior sd of 0.57 (2019-2023). The filter-tuned per-fight and per-year r noise outpaces what
  each fight teaches, so the posterior sd tracks career length, not how hard the fight is to call. WHR shows the same
  accuracy pattern across these terciles, so the hardness of the low-sd (newcomer) bouts is in the fights.
- What it buys: the variance term does fix the overall overconfidence of the plug-in on 2019-2023 (slope 0.80 ->
  0.99). Next steps, not tried here: a tempered link sigmoid(m / sqrt(1 + c v)) with c fit by CV, and r process noise
  fit under EP (the posterior sd should stop growing with career length).

## Method x round (vs methodround S, out of fold)

Fights in backtest_dev.json with an outcome: 1,972 (2019-2023) and 857 (2024-25). bayes minus S:

| metric | 2019-2023 bayes / S | diff [CI] | 2024-2025 bayes / S | diff [CI] |
|---|---|---|---|---|
| joint (23 cells) | 2.1577 / 2.1523 | +0.0054 [-0.0084, +0.0183] | 2.0308 / 2.0418 | -0.0110 [-0.0329, +0.0113] |
| 7-bin | 1.6296 / 1.6281 | +0.0014 [-0.0122, +0.0137] | 1.5364 / 1.5538 | -0.0174 [-0.0390, +0.0041] |
| method (KO / SUB / DEC) | 0.9676 / 0.9569 | +0.0108 [+0.0025, +0.0189] | 0.9199 / 0.9360 | -0.0161 [-0.0290, -0.0034] |
| method given the winner | 0.9456 / 0.9342 | +0.0114 [+0.0015, +0.0214] | 0.8977 / 0.9073 | -0.0096 [-0.0248, +0.0063] |
| round given a finish | 1.0710 / 1.0620 | +0.0090 [+0.0029, +0.0151] | 1.0747 / 1.0601 | +0.0146 [+0.0071, +0.0223] |
| KO vs SUB given a finish | 0.6131 / 0.6016 | +0.0115 [-0.0010, +0.0239] | 0.5806 / 0.6017 | -0.0210 [-0.0388, -0.0028] |
| winner | 0.6433 / 0.6518 | | 0.6147 / 0.6213 | |

With both winners rescaled to ML v2 (the production arrangement), bayes is worse on 2019-2023 (joint +0.0138
[+0.0036, +0.0239]) and level on 2024-25 (-0.0045 [-0.0202, +0.0118]). The finishing-round shapes are the clear weak
spot (worse in both windows): they are division-free walk-forward shapes by format and method, not per-fighter.

## Stat lines (vs mlrates out of fold)

Poisson deviance per fighter-fight of the expected count given the actual minutes (knockdowns given actual head strikes
landed); baseline = walk-forward division rate only. 1,999 fights (2019-2023) / 865 (2024-25).

| stat | 2019-2023 bayes / mlrates / baseline | bayes - mlrates [CI] | 80% coverage | 2024-2025 bayes / mlrates | bayes - mlrates [CI] |
|---|---|---|---|---|---|
| sig strikes landed | 11.94 / 11.21 / 14.25 | +0.73 [+0.42, +1.06] | 0.75 | 12.39 / 11.16 | +1.23 [+0.77, +1.73] |
| takedowns | 1.505 / 1.472 / 1.897 | +0.033 [-0.002, +0.067] | 0.80 | 1.518 / 1.503 | +0.015 [-0.045, +0.073] |
| control (30 s units) | 3.767 / 3.786 / 5.115 | -0.019 [-0.132, +0.098] | 0.75 | 3.764 / 3.777 | -0.013 [-0.216, +0.193] |
| sub attempts | 0.990 / 0.985 / 1.131 | +0.005 [-0.015, +0.025] | 0.78 | 0.928 / 0.914 | +0.014 [-0.011, +0.040] |
| knockdowns | 0.855 / 0.883 / 0.885 | **-0.028 [-0.054, -0.005]** | 0.78 | 0.766 / 0.779 | -0.013 [-0.036, +0.010] |

- Predicted strikes run high: mean 48.4 vs 46.0 actual on 2019-2023. L_str is the log of the mean rate, so adding the
  pace and form variances to the log-normal mean correction double-counts them. Dropping them (measured on 2019-2023
  only, after the look, so not applied to the frozen predictor) gives mean 46.7 and deviance -0.12 [-0.20, -0.03],
  still +0.61 [+0.32, +0.92] behind mlrates. The rest of the gap is mlrates' richer features.
- The predictive intervals are slightly too narrow (80% intervals cover 75-80%).

## Simulator inputs

`bayes.json` -> `roster[slug]`: last fight, division, posterior `mean` and `sd` of the 11 skills, and
`rates_vs_average` = exp(L_division + skill): sig strikes landed / absorbed per minute, takedowns landed / allowed per
15, control seconds per minute, sub attempts per 15, knockdowns per head strike landed / absorbed, output trend per
round. For a matchup the engine-style rate for A is exp(L_div + so_A - sd_B) (sig strikes), and so on; the sds give
fight-to-fight parameter uncertainty. Rates use the baseline of the fighter's last division (Volkanovski's is
featherweight).

| (as of 2026-01-01) | r | so | sd | to | tdd | co | su | sdf | pw | ch | ca |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Volkanovski mean (sd) | 1.98 (0.70) | 0.45 (0.13) | 0.50 (0.13) | 0.46 (0.33) | 1.74 (0.32) | 0.38 (0.39) | -0.73 (0.56) | 1.45 (0.52) | 0.15 (0.25) | 0.48 (0.29) | 0.08 (0.04) |
| Gaethje mean (sd) | 1.40 (0.71) | 0.43 (0.13) | -0.15 (0.13) | -1.18 (0.44) | 1.09 (0.34) | -0.85 (0.43) | -1.80 (0.64) | 0.86 (0.52) | 0.64 (0.26) | 0.31 (0.28) | 0.09 (0.04) |

Read: equal striking output, Volkanovski's defence far better (absorbs 2.4 vs 4.6 per minute against an average
opponent), elite takedown defence on both sides, Gaethje's power edge (KD per head strike 0.019 vs 0.011). The
posterior gives Volkanovski 0.755 (logit 1.23, sd 0.71).

## Reproduce

From the project root, nice -n 5, at most 2 workers (CPU minutes on this box in brackets):

```
python3 tools/bayes.py data                                    # [~2]  data arrays (2026+ dropped at parse)
python3 tools/bayes.py fit --years 2019-2025 --variant main     # [~25] yearly EB refits
python3 tools/bayes.py fit --years 2019-2025 --variant nostats  # [~15] results-only ablation
python3 tools/bayes.py predict --variant main --schedules none,year,year+g,quarter,month          # [~30]
python3 tools/bayes.py predict --variant main --parts oof2019,oof2020,oof2021,oof2022,oof2023 \
    --schedules year+q0.67,year+q1.5,year+q2.25,year+q0.25,year+q0.1,year+w2,year+q0.25+w2       # [~6]
python3 tools/bayes.py predict --variant nostats --schedules none,year,quarter                    # [~6]
python3 tools/bayes.py cv && python3 tools/bayes.py eval && python3 tools/bayes.py stack
python3 tools/bayes.py swap
python3 tools/bayes.py confirm            # the one 2024-25 look (refuses a rerun without --force)
python3 tools/bayes.py fit --years 2026-2026 --variant main && python3 tools/bayes.py export
python3 tests/test_bayes.py               # bayes.json invariants + corner symmetry of filter and EP on a slice
```

The yearly fits warm-start from the previous year's hyperparameters, so they must run in order.

## Caveats

- **One look, many options before it.** Thirteen schedule / option variants were compared on 2019-2023 OOF; the chosen
  monthly schedule passed the 0.0005 rule by a hair over quarterly. The gain that matters (EP vs filter) is large and
  significant; the schedule within EP is not.
- **The comparison with WHR flatters WHR slightly** (its parameters were tuned on 2019-2023) and bayes was never tuned
  under EP: its hyperparameters are fit for the filter's one-step likelihood, then reused for the EP-refit states.
  Fitting them under EP (the coordinate search on EP-refit states) costs about 1.5 minutes per objective call and was
  not done.
- **Production uses** hyperparameters fit through 2025-12-31 (`fit --years 2026-2026`): deployment by the same
  procedure, never scored.
- The 2024-25 underconfidence seen in every model (ratings note) shows here too (slope 1.32); not corrected.
- No JS evaluator: the model needs the EP state of every fighter, so the page would read the roster from bayes.json
  rather than run the model.
