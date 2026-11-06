# ML v2 feature union (task key: ml2)

Nov 6, 2026, about 4:45 pm. Tool: `tools/ml2.py`. Output: `data/derived/ml2.json`. Page evaluator: `src/ml/ml2.js`,
checked by `tests/test_ml2.js`. Scratch caches: `out/ml2_cache/` (gitignored).

The winner model, rebuilt on every verified feature source. It was then fed into the no-line and with-line stacks
and into the method/round model S.

The protocol (docs/BACKLOG.md) is followed throughout:

- Every fight dated 2026-01-01 or later is dropped right after parsing, before anything is built.
- Every choice is made by time-ordered CV on pre-2024 data.
- 2024-01-01..2025-12-31 is scored once.
- Every model is corner-symmetric: no intercept, mirrored training, and the corner-swap design check is asserted.

All brackets are 95% event-cluster bootstrap CIs (2,000 resamples of UFC cards unless stated), paired where they are
differences. n = 854 decisive validation fights, or 845 where the closing line is needed.

## Bottom line

**1. ML v2 is the best no-line predictor in the project, and its logistic part ties the closing line.**

| 2024-2025 (854 fights) | log loss [CI] | accuracy | minus ML v1 logistic [CI] |
|---|---|---|---|
| ML v1 logistic (tools/ml.py, reproduced exactly) | 0.6062 [0.5902, 0.6230] | 67.9% | 0 |
| **ML v2 logistic**, static (fit < 2024) | **0.5888** [0.5703, 0.6087] | **69.0%** | **-0.0175 [-0.0240, -0.0105]** |
| ML v2 logistic, monthly rolling refit | 0.5883 [0.5692, 0.6091] | 69.2% | -0.0179 [-0.0252, -0.0103] |
| ML v2 blend (LR 0.42 + LightGBM 0.32 + XGBoost 0.24), static | 0.5922 [0.5739, 0.6118] | 69.0% | -0.0140 [-0.0214, -0.0065] |
| ML v2 blend, monthly rolling | 0.5916 [0.5726, 0.6123] | 68.3% | -0.0147 [-0.0229, -0.0066] |
| closing line (845 fights) | 0.5854 | 69.2% | |
| opening line (843 fights) | 0.6094 | 66.8% | |

- On the fights that have a line, the ML v2 logistic is level with the close: static +0.0004 [-0.0169, +0.0168], rolling 0.0000.
- It beats the opening line by 0.024 [0.009, 0.039].
- Compared with v1 (0.018 behind the close, tied with the open), the gap to the close is gone.
- Out of fold on 2019-2023 (1,955 fights, annual refits), the blend scores 0.6337 against v1's 0.6479: -0.0142 [-0.0194, -0.0085].
- **Better in every year 2019-2025.**

**2. Where the gain comes from.** Two verified sources that did not exist when v1 was built carry it. Both were rebuilt
per fight back to 2009/2013, so the model trains on 2010-2023:

- the walk-forward rating systems of tools/ratings.py: WHR on rounds, Glicko-2, margin Elo, TrueSkill with method outcomes;
- the Kalman market rating of tools/market.py, built from earlier closing lines.

Time-ordered CV results:

- Base CV: 0.64569. Market rating: 0.63917. Plus the ratings: 0.63514. Dropping ml.py's "opponent quality" group: 0.63412.
- CV turned down three other blocks; none passed the 0.0005 rule:
  - the pre-UFC record (preufc.json), -0.0004 at its best fade;
  - fight-week context (fightweek.json), -0.0002;
  - the newcomer gate and experience buckets, -0.0001.
- The 2019+-only sources (durability, oppadj, mlrates, methodround S) add nothing on top: CV gain at most -0.0004 and 2024-25 within ±0.0015.

**3. Newcomers: two thirds of the gap to the close is closed.**

- In bouts where a side has 1-2 prior UFC fights (262 fights), ML v2 scores 0.6156 (logistic) / 0.6207 (blend) against v1's 0.6396.
- The blend's gain over v1 is -0.0189 [-0.0338, -0.0042].
- The gap to the close on those fights shrinks from +0.036 (v1) to +0.013 (blend, [-0.022, +0.049]); for the logistic it is about +0.012.
- The market-rating term is what moves newcomers. A man's first one or two UFC closing lines already price his regional record and hype, so the pre-UFC block has nothing left to add (CV).

**4. Stacks, refit MoE-style (no intercept, non-negative logit weights, recency half-life chosen by forward-chained CV 2021-2023).**

| 2024-2025 | current stack (moe experts) | with ML v2 | ML v2 minus current [CI] | ML v2 stack minus close [CI] |
|---|---|---|---|---|
| no line, static | 0.5949 | **0.5901** | **-0.0049 [-0.0083, -0.0014]** | +0.0025 [-0.0132, +0.0174] (845) |
| no line, rolling | 0.5916 | **0.5879** | -0.0037 [-0.0080, +0.0007] | **-0.0001 [-0.0161, +0.0150]** (845) |
| with line, static (845) | 0.5788 | **0.5767** | -0.0021 [-0.0042, +0.0001] | **-0.0087 [-0.0133, -0.0040]** |
| with line, rolling (845) | 0.5778 | **0.5761** | -0.0017 [-0.0038, +0.0005] | -0.0092 [-0.0144, -0.0040] |

- **Pooled out of sample 2021-2025** (2,069 fights; the 2021-2023 rows are forward-chained CV years):
  - with the line, ML v2 beats the close by **-0.0044 [-0.0079, -0.0010]** and the current stack by **-0.0022 [-0.0041, -0.0002]**; the current stack alone is -0.0022 [-0.0046, +0.0002] against the close;
  - without a line, ML v2 beats the current stack by **-0.0058 [-0.0091, -0.0027]**, and the stack is +0.0080 [-0.0019, +0.0175] against the close.
- **What the stacks keep.**
  - With the line: market 0.75 and ML v2 0.38. Every other expert drops to 0: market rating, engine, ML v1, feature LR, Elo.
  - Without a line: ML v2 0.78 and market rating 0.50.
- **On the page** (ML v2 logistic plus the inputs the page can compute):
  - the no-line stack scores 0.5891 static / **0.5863** rolling;
  - with the line it scores 0.5758 / 0.5750, which is -0.0096 against the close.

**5. Method/round model S refit (methodround.py's model, same hyperparameters and round hazard).**

- The chosen variant (by CV 2020-2023) adds the new features and takes its winner from ML v2 ("S2+ml2win").
- On 2024-2025 (857 fights):
  - 7-bin **1.5175 vs 1.5538** for S, **-0.0363 [-0.0505, -0.0214]**;
  - method (KO/SUB/DEC) 0.9298 vs 0.9360, -0.0062 [-0.0135, +0.0015];
  - winner -0.0295.
- In CV 2020-2023 the gains are 7-bin -0.0324 [-0.0439, -0.0205] and method -0.0074 [-0.0139, -0.0007].
- Against the market's method props (830 fights):
  - 7-bin is now +0.012 [-0.016, +0.040] behind; S was +0.050 [+0.018, +0.081] behind;
  - the 40/60 blend with the props beats the props on both method (-0.0071 [-0.0137, -0.0006]) and 7-bin (-0.0125 [-0.0244, -0.0005]).

**6. Caveats that matter.**

- **ratings.json** is used as published at 3:44 pm. Its verifier has not signed off (docs/BACKLOG.md, EMBEDDINGS note). Its newcomer prior reads preufc.json's leaky `net_elo` rather than the strict `net_elo_h` (see Leakage checks).
- **preufc.json** was rebuilt at 4:07 pm, after this table was built. Re-running ratings.py on it would move the rating features by up to 0.03 in probability. Rerun `python3 tools/ml2.py all` (about 45 minutes) when either file changes.
- **Every model is underconfident on 2024-25.** Calibration slopes are 1.40-1.45 for ML v2 and 1.11 for the close. Rolling refits help a little; no temperature was adopted, because the OOF slope is 1.00.

## Data and protocol

### Rows, labels, splits

- **Rows.** Every UFC fight 2010-01-01..2025-12-31: 7,229 rows, from tools/ml.py's own walk-forward feature table, rebuilt here.
  - `build_db.parse_fights` is wrapped so the 480 fights dated 2026+ never enter (8,974 parsed, 8,494 kept).
  - Training rows are decisive fights without an ambiguous person, debut fights included (ml.py's "all" set, which CV kept again).
  - Evaluation rows are backtest fights, where both men had a prior UFC fight: 1,955 in 2019-2023 and 854 in 2024-2025. The ids are identical to ml.json's `oof` / `test` sets.
- **CV.** Time-ordered expanding window from 2010, with validation blocks 2016-17, 2018-19, 2020-21 and 2022-23. This is ml.py's scheme, so the base CV reproduces ml.py's final 0.64569 exactly.
  - The selection rule is ml.py's: a block or group enters or leaves only if CV improves by more than 0.0005.
  - Trees: rounds chosen on the CV curve.
  - Blend weights: non-negative logit weights fit on the 2019-2023 out-of-fold predictions.
- **Out of fold 2019-2023.** Annual expanding refits: train before Jan 1 of Y, predict Y. The logistic is also refit annually for 2012-2018, for the method model.
- **Static.** Fit on fights before 2024-01-01; predicts 2024-2025.
- **Rolling.** Refit on the first of every month 2024-01..2025-12, on all fights before that date (24 refits, same hyperparameters), predicting that month. This is how a deployed model behaves. Stacks are refit each January.

### Sources and how each reaches 2010-2018 rows

| block | source | how it was built here | coverage |
|---|---|---|---|
| base (80 terms) | tools/ml.py feature table | rebuilt with 2026 dropped at parse; margin Elos retuned to the same K 160, w 0.8 / 0.9 | 2010+ |
| rat | tools/ratings.py | the seven systems rerun with ratings.json's tuned parameters on every bout since 1994, stream cut at 2026-01-01 | 2009+ (all rows) |
| mr | tools/market.py market rating | the same Kalman filter and parameters (sig_m 0.5, tau 0.5/yr, v0 1.5, kappa 1.5), the same stream (nlbair closes, market.json closes for dev fights), cut at 2025-12-31 | 2013+ (91.5% of 2013 rows, 100% after) |
| pre | preufc.json strict snapshots, tools/preufc.side_pre | kept only when one of the fighter's first four UFC bouts (this one included) is on/after 2015-01-01; that rule decides preufc's target set, so presence never depends on a later career | 50% of 2015 sides, 92-95% of 2024-25 |
| fw | fightweek.json | missed weight, replacement, replacement at 14 days or less, home crowd outside the USA, any home, opponent change, time zone shift, travel | 2012+ |
| exp / gate | prior UFC fights | [n in 1-2] and [n in 3-5] differences; market rating, WHR and judge-Elo logits times [min n <= 2] | all |
| late (stage 2) | durability.json, oppadj.json (verified 3:45 pm), mlrates_oof.json, methodround.json S | read for dev fights only; 2019+ only, so tested as a second stage on ML v2's out-of-fold logit | 2019+ |

The rebuilt features match their source files on every dev backtest fight:

- the ratings to 5e-5 (rounding of ratings.json) for all seven systems on 2,864 fights;
- the market rating to 9e-5 on 2,855 fights.

The rating and market-rating parameters were tuned by their own tools on 2019-2023. So the 2010-2018 training rows see
parameters chosen on later years. That is a mild look-ahead inside the training data only: nothing tuned on 2024+
touches them, and every 2024-2025 prediction uses parameters chosen before 2024.

## Results

### 1. What the CV chose (logistic)

Greedy forward selection over the new blocks, then backward elimination of ml.py's base groups. The pre block's fade
tau was searched each time it was tried.

| step | candidates (CV log loss) | added |
|---|---|---|
| 0 | base, ml.py's 80 terms: **0.64569** (lam 0.05) | |
| 1 | mr 0.63917, rat 0.63977, pre 0.64251 (tau 16), fw 0.64485, exp 0.64557 | mr |
| 2 | rat 0.63514, gate 0.63809, pre 0.63715 (tau 2), fw 0.63877, exp 0.63905 | rat |
| 3 | pre 0.63478 (tau 2), fw 0.63491, gate 0.63506, exp 0.63507 (all < 0.0005) | none |
| backward | drop "opponent quality": 0.63412 (next best: drop layoff/weight move 0.63473) | -opp. quality |

Other checks:

- **Rating sets.** WHR-rounds only 0.63565; WHR + Glicko 0.63522; the four the ratings tool ranked best (WHR-rounds, Glicko-2, Elo-full, TrueSkill-mov) 0.63514; all seven 0.63473 (< 0.0005, so four).
- **Training variants.** All fights 0.63412; both-experienced only 0.63512; recency half-life 8 y 0.63454, 4 y 0.63531; from 2013 only 0.63835.
- **Final logistic.** 81 terms, L2 0.05 on standardised columns, CV 0.63412 (-0.0116 vs base).
- **Removing one block.** Market rating +0.0049, ratings +0.0042.
- **Coefficients** of the new terms (static fit, logit per logit unit): market rating 0.43, WHR-rounds 0.27, Glicko-2 0.11, Elo-full 0.08, TrueSkill-mov 0.07.

### 2. Trees, seeds, monotone constraints

Trees see ml.py's tree design (side levels, A-minus-B terms, matchup, context; no raw height or reach, so a missing
tale-of-the-tape cannot leak). On top of that they get the chosen new terms and the side levels for newcomer handling:
prior UFC fights, market-rating variance, WHR sd, pre-UFC availability. That is 155 columns, mirrored rows, and
predictions averaged over both corner orders.

| model | config (CV-chosen) | CV | with monotone constraints | second seed |
|---|---|---|---|---|
| LightGBM | 4 leaves, min 120 per leaf, feature fraction 0.3, bagging 0.8, L2 10, 500 rounds at 0.04 | 0.63317 | 0.63392 (rejected) | 0.63333 |
| XGBoost | depth 2, min child weight 30, colsample 0.5, subsample 0.8, lambda 10, 475 rounds | 0.63303 | 0.63378 (rejected) | 0.63352 |

- Monotone constraints were tried on the rating, Elo and market-rating differences, which are increasing in A's favour. They cost CV in both libraries, so they are off.
- Final trees average 5 LightGBM and 3 XGBoost seeds in logit space.
- The seed ensemble is worth -0.0003 [-0.0017, +0.0011] on 2024-25: harmless, not measurable.
- **Blend weights (OOF 2019-2023).** LR 0.416, LightGBM 0.324, XGBoost 0.237. Leave-one-year-out blend 0.6344 vs LR 0.6355.
- On 2024-25 the blend is worse than the LR alone: +0.0034 [+0.0001, +0.0066]. The trees are less underconfident there (slope 1.35 vs 1.45), but rank fights worse. The protocol keeps the blend as "ML v2", because the choice was made before 2024. The page uses the logistic, which is the better 2024-25 model and the one the JS can evaluate.

### 3. Out of fold 2019-2023 (1,955 fights) and validation 2024-2025 (854)

| model | OOF 2019-23 | 2024-25 static [CI] | 2024-25 rolling [CI] | Brier (static) | acc. (static) | slope (static) |
|---|---|---|---|---|---|---|
| Elo | 0.6857 | 0.6769 | = | 0.2421 | 55.1% | 1.13 |
| ML v1 logistic | 0.6479 | 0.6062 [0.5902, 0.6230] | 0.6058 | 0.2088 | 67.9% | 1.54 |
| ML v1 stack (Elo + ML + market rating) | 0.6373 | 0.5958 | | 0.2044 | 68.4% | 1.47 |
| **ML v2 logistic** | 0.6355 | **0.5888** [0.5703, 0.6087] | **0.5883** [0.5692, 0.6091] | 0.2015 | 69.0% | 1.45 |
| ML v2 LightGBM (5 seeds) | 0.6349 | 0.5951 [0.5760, 0.6150] | 0.5943 | 0.2042 | 68.5% | 1.35 |
| ML v2 XGBoost (3 seeds) | 0.6350 | 0.5950 [0.5755, 0.6152] | 0.5944 | 0.2042 | 69.0% | 1.35 |
| **ML v2 blend** | **0.6337** | 0.5922 [0.5739, 0.6118] | 0.5916 [0.5726, 0.6123] | 0.2029 | 69.0% | 1.45 |
| closing line (845) | 0.6232 | 0.5854 | | 0.2005 | 69.2% | 1.11 |

Paired differences on 2024-25:

- ML v2 logistic vs:
  - the ML v1 stack (Elo + ML + market rating): -0.0070 [-0.0126, -0.0017];
  - Elo: -0.0881 [-0.1073, -0.0676];
  - the open: -0.0237 [-0.0388, -0.0086].
- Blend vs the close: +0.0043 [-0.0124, +0.0201].
- Rolling minus static: blend -0.0006 [-0.0025, +0.0013], logistic -0.0005 [-0.0018, +0.0008]. Monthly refits help a little, within noise.

By year (log loss; 2019-2023 out of fold, 2024-2025 static):

| year | n | Elo | ML v1 LR | ML v2 LR | ML v2 blend | close | blend calibration slope |
|---|---|---|---|---|---|---|---|
| 2019 | 388 | 0.6984 | 0.6552 | 0.6481 | 0.6479 | 0.6319 | 0.86 |
| 2020 | 343 | 0.6841 | 0.6514 | 0.6359 | 0.6307 | 0.6303 | 1.05 |
| 2021 | 415 | 0.6813 | 0.6464 | 0.6371 | 0.6359 | 0.6393 | 0.98 |
| 2022 | 419 | 0.6794 | 0.6440 | 0.6268 | 0.6275 | 0.6018 | 1.08 |
| 2023 | 390 | 0.6860 | 0.6436 | 0.6304 | 0.6265 | 0.6142 | 1.06 |
| 2024 | 429 | 0.6770 | 0.6064 | 0.5905 | 0.5957 | 0.5872 | 1.45 |
| 2025 | 425 | 0.6769 | 0.6061 | 0.5870 | 0.5887 | 0.5835 | 1.45 |

ML v2 beats v1 in all seven years. Its blend beats the close in 2021 and ties it in 2020.

**Calibration.** Favourite-side bins, predicted vs observed, on 2024-25 for the static blend:

| predicted | 0.52 | 0.58 | 0.62 | 0.67 | 0.72 | 0.77 | 0.83 |
|---|---|---|---|---|---|---|---|
| observed | 0.53 | 0.61 | 0.68 | 0.72 | 0.83 | 0.83 | 0.93 |
| n | 172 | 162 | 162 | 136 | 82 | 81 | 58 |

- The model is too timid from about 60% up, like every model in 2024-25 (the market's slope is 1.11).
- Out of fold 2019-2023 the blend is calibrated (slope 1.00, ECE 0.009), so no temperature is adopted.
- The stacks' recency weighting (h 1.5) is what sharpens the no-line regime (below).

### 4. Segments (2024-2025, ML v2 blend static; "close" on the segment's fights with a line)

| segment | n | ML v1 LR | ML v2 LR | ML v2 blend | blend rolling | close | blend minus v1 [CI] | blend minus close [CI] |
|---|---|---|---|---|---|---|---|---|
| newcomer bout (a side with 1-2 UFC fights) | 262 | 0.6396 | 0.6156 | 0.6207 | 0.6215 | 0.6039 | **-0.0189 [-0.0338, -0.0042]** | +0.0126 [-0.022, +0.049] |
| both newcomers | 58 | 0.5883 | 0.5415 | 0.5497 | 0.5475 | 0.5001 | -0.0387 [-0.076, +0.000] | +0.052 [-0.012, +0.111] |
| middle (fewer-fight side 3-7) | 354 | 0.5861 | 0.5642 | 0.5666 | 0.5637 | 0.5702 | **-0.0195 [-0.0309, -0.0079]** | -0.0062 [-0.034, +0.017] |
| veterans (both 8+) | 238 | 0.5995 | 0.5959 | 0.5990 | 0.6002 | 0.5876 | -0.0005 [-0.014, +0.014] | +0.0106 [-0.016, +0.037] |
| men 125-145 | 271 | 0.6213 | 0.6020 | 0.6063 | 0.6084 | 0.5968 | -0.0150 [-0.031, +0.001] | +0.0070 [-0.021, +0.035] |
| men 155-185 | 332 | 0.5903 | 0.5691 | 0.5716 | 0.5683 | 0.5687 | **-0.0187 [-0.031, -0.006]** | -0.0037 [-0.031, +0.021] |
| men 205-265 | 104 | 0.6529 | 0.6402 | 0.6453 | 0.6447 | 0.6327 | -0.0076 [-0.031, +0.016] | +0.018 [-0.020, +0.050] |
| women | 147 | 0.5815 | 0.5725 | 0.5752 | 0.5757 | 0.5686 | -0.0062 [-0.027, +0.012] | +0.008 [-0.033, +0.047] |
| 3 rounds | 749 | 0.6074 | 0.5903 | 0.5937 | 0.5926 | 0.5804 | **-0.0138 [-0.022, -0.006]** | +0.0103 [-0.007, +0.027] |
| 5 rounds | 105 | 0.5979 | 0.5777 | 0.5820 | 0.5845 | 0.6206 | -0.0159 [-0.035, +0.003] | -0.0386 [-0.080, +0.005] |
| pick'em (close favourite < 60%) | 231 | 0.6819 | 0.6702 | 0.6743 | 0.6738 | 0.6789 | -0.0076 [-0.020, +0.005] | -0.011 [-0.041, +0.017] |
| moderate favourite (60-75%) | 407 | 0.6257 | 0.6196 | 0.6228 | 0.6239 | 0.6268 | -0.0030 [-0.013, +0.007] | -0.004 [-0.023, +0.016] |
| heavy favourite (75%+) | 216 | 0.4887 | 0.4436 | 0.4470 | 0.4427 | 0.4112 | **-0.0417 [-0.059, -0.025]** | +0.036 [-0.007, +0.076] |
| Lightweight | 118 | 0.5848 | 0.5758 | 0.5863 | 0.5840 | 0.5884 | +0.0015 [-0.019, +0.023] | -0.008 [-0.057, +0.048] |
| Featherweight | 100 | 0.6395 | 0.6207 | 0.6228 | 0.6251 | 0.5893 | -0.0167 [-0.040, +0.006] | +0.029 [-0.011, +0.066] |
| Welterweight | 102 | 0.6300 | 0.6066 | 0.6035 | 0.6020 | 0.5910 | **-0.0265 [-0.048, -0.005]** | -0.000 [-0.047, +0.047] |
| Middleweight | 108 | 0.5481 | 0.5228 | 0.5226 | 0.5165 | 0.5249 | **-0.0254 [-0.045, -0.006]** | -0.004 [-0.039, +0.033] |
| Light Heavyweight | 55 | 0.6979 | 0.7041 | 0.7045 | 0.7034 | 0.6841 | +0.0066 [-0.026, +0.043] | +0.029 [-0.022, +0.080] |

Other divisions are in `ml2.json` results.segments.

- **Where ML v2 gains.** Newcomer and middle-experience bouts, the 155-185 lb men, and heavy favourites: the model finally commits to mismatches.
- **Where the market still leads.** Heavy favourites (+0.036), Featherweight, Light Heavyweight and newcomer bouts. In all four the market has information the stats do not: camp, injuries, film, and the exact quality of a regional record.
- **Veterans.** ML v2 adds nothing over v1 for veterans (-0.0005).

### 5. Stage 2: the 2019+-only sources on top of ML v2

The second-stage model is a no-intercept logistic on [ML v2's out-of-fold logit, the source's A-minus-B terms], with L2
on the source terms. It is chosen by forward-chained CV over 2021-2023, trained from 2019 (1,224 CV fights), and the
2024-25 look is reported whatever the CV says.

| source block | best L2 | CV gain | 2024-25 change [CI] | adopted |
|---|---|---|---|---|
| durability (chin, power, KD/strike, log ratios) | 0.3 | -0.0004 | -0.0007 [-0.0022, +0.0008] | no |
| oppadj (14 opponent-adjusted factors) | 10 | +0.0001 | -0.0001 [-0.0002, 0.0000] | no |
| mlrates OOF (expected landed, KD, TD, control, subs) | 10 | +0.0000 | +0.0000 | no |
| methodround S winner logit | 3 | +0.0000 | +0.0000 | no |
| all four | 10 | +0.0001 | -0.0001 [-0.0003, 0.0000] | no |

The strongest penalty wins in every case, so these sources carry no winner information that ML v2 lacks. They remain
useful for the simulator's stat lines (their own reports), not for the winner.

### 6. Stacks

- **Inputs.** Each expert enters as logit(clip(p, 0.01, 0.99)); absent inputs enter as 0.
  - market: power de-vig of the consensus close;
  - mkt_rating: market.json;
  - engine: engine v3, moe_engine_bt.json;
  - ml: ML v1 logistic, `lr_refit` for rolling;
  - feat_lr: moe's feature LR;
  - elo_sig and elo;
  - ml2: the blend, out of fold for 2019-2023.
- **Fit.** Weights are non-negative, with no intercept, fit on 2019-2023. The recency half-life (none, 3 or 1.5 y) comes from forward-chained CV 2021-2023.
- **Check.** My refit of the current expert set reproduces moe's numbers: no line 0.5949 static and 0.5916 rolling (moe: 0.5955 / 0.5919); with the line 0.5788 (moe 0.5796).

| regime | set | CV 2021-23 | weights | 2024-25 static | rolling |
|---|---|---|---|---|---|
| line | current (7 experts) | 0.61922 | market 0.86, mkt_rating 0.11, ml 0.15, feat_lr 0.06 | 0.5788 | 0.5778 |
| line | **market + ml2** (= current + ml2) | **0.61615** | market 0.75, ml2 0.38 | **0.5767** | **0.5761** |
| line | page: market + ML v2 logistic | 0.61621 | market 0.77, ml2lr 0.34 | 0.5758 | 0.5750 |
| no line | current (6 experts), h 1.5 | 0.63646 | mkt_rating 0.85, ml 0.55, feat_lr 0.03 | 0.5949 | 0.5916 |
| no line | **ml2 + mkt_rating (+ feat_lr 0)**, h 1.5 | **0.62861** | ml2 0.78, mkt_rating 0.50 | **0.5901** | **0.5879** |
| no line | page: ML v2 logistic + mkt_rating, h 1.5 | 0.62984 | ml2lr 0.71, mkt_rating 0.55 | 0.5891 | 0.5863 |
| no line | ml2 alone | 0.63024 | 1.00 | 0.5922 | 0.5904 |

**By year.** The 2021-2023 rows are forward-chained, so they are out of sample too.

| year | close | line current | line + ml2 | no line current | no line + ml2 |
|---|---|---|---|---|---|
| 2021 | 0.6393 | 0.6362 | 0.6329 | 0.6443 | 0.6359 |
| 2022 | 0.6018 | 0.6075 | 0.6066 | 0.6399 | 0.6324 |
| 2023 | 0.6142 | 0.6138 | 0.6111 | 0.6245 | 0.6217 |
| 2024 | 0.5872 | 0.5810 | 0.5796 | 0.5976 | 0.5939 |
| 2025 | 0.5835 | 0.5765 / roll 0.5745 | 0.5738 / roll 0.5728 | 0.5923 / roll 0.5855 | 0.5862 / roll 0.5824 |

The ML v2 stacks beat the current ones in every year in both regimes. The pooled 2021-2025 numbers are in the bottom
line.

Segments (2024-25, static stacks; differences with CIs):

| segment | n | no line: current | no line: ml2 | ml2 minus current [CI] | close | line: ml2 minus close [CI] |
|---|---|---|---|---|---|---|
| newcomer bout | 262 | 0.6220 | 0.6170 | -0.0051 [-0.0135, +0.0034] | 0.6039 | -0.0058 [-0.0155, +0.0041] |
| middle 3-7 | 354 | 0.5655 | 0.5602 | -0.0054 [-0.0114, +0.0006] | 0.5702 | **-0.0130 [-0.0199, -0.0063]** |
| veterans 8+ | 238 | 0.6089 | 0.6049 | -0.0040 [-0.0127, +0.0054] | 0.5876 | -0.0053 [-0.0139, +0.0042] |
| men 125-145 | 271 | 0.6204 | 0.6110 | **-0.0094 [-0.0170, -0.0013]** | 0.5968 | -0.0053 [-0.0126, +0.0025] |
| men 155-185 | 332 | 0.5670 | 0.5630 | -0.0040 [-0.0106, +0.0030] | 0.5687 | **-0.0151 [-0.0232, -0.0076]** |
| men 205-265 | 104 | 0.6354 | 0.6390 | +0.0036 [-0.0105, +0.0175] | 0.6327 | +0.0050 [-0.0075, +0.0170] |
| women | 147 | 0.5825 | 0.5781 | -0.0044 [-0.0140, +0.0052] | 0.5686 | -0.0098 [-0.0225, +0.0038] |
| 3 rounds | 749 | 0.5975 | 0.5924 | **-0.0052 [-0.0088, -0.0017]** | 0.5804 | **-0.0070 [-0.0115, -0.0024]** |
| 5 rounds | 105 | 0.5765 | 0.5737 | -0.0028 [-0.0131, +0.0093] | 0.6206 | **-0.0205 [-0.0333, -0.0063]** |
| pick'em < 60% | 231 | 0.6751 | 0.6734 | -0.0018 [-0.0099, +0.0063] | 0.6789 | -0.0101 [-0.0207, +0.0003] |
| moderate 60-75% | 407 | 0.6310 | 0.6272 | -0.0038 [-0.0101, +0.0020] | 0.6268 | **-0.0092 [-0.0153, -0.0022]** |
| heavy 75%+ | 216 | 0.4412 | 0.4309 | **-0.0103 [-0.0183, -0.0021]** | 0.4112 | -0.0061 [-0.0151, +0.0025] |
| Middleweight | 108 | 0.5269 | 0.5153 | **-0.0117 [-0.0208, -0.0021]** | 0.5249 | **-0.0193 [-0.0307, -0.0082]** |
| Light Heavyweight | 55 | 0.6851 | 0.6986 | +0.0136 [-0.0052, +0.0321] | 0.6841 | +0.0170 [+0.0010, +0.0355] |

- **With the line, ML v2 adds most** where the close is weakest: 5-round fights, pick'ems and the 155-185 lb men.
- **It adds nothing**, or slightly hurts, at 205+ lb and at Light Heavyweight. That is a small and noisy segment where the market leads every model.
- **Without a line**, the ML v2 stack is better than the close in pick'ems, 5-rounders, middle-experience bouts and at 155-185, and worse for heavy favourites, newcomers and Featherweight.

**Production risk (same as moe's).** The no-line stack's recency weight emphasises 2024-25, where models were
underconfident:

- page production weights, refit on 2019-2025: ml2lr 1.03 and mkt_rating 0.39, sum 1.42;
- the validated weights (fit before 2024) sum to 1.26.

If 2026 looks like 2019-2023, the production stack will be too sharp. Watch the forward-test calibration (the blind
test, tools/blindtest.py) and refit with h = 3 if slopes fall back toward 1.

### 7. Method/round model S with the new features

- **Model.** methodround.py's model, imported unchanged: 6-class who-and-how logit, competing-risks round hazard, and methodround.json's chosen penalties (C_haz 0.03, draw_c).
- **Data.** Its table is rebuilt with 2026 dropped at parse.
- **New side-oriented columns:**
  - the ML v2 logistic's logit (annual out-of-fold 2012-2023, static for 2024-25) and its absolute value;
  - the WHR-rounds and market-rating logits and their absolute values;
  - the pre-UFC KO / SUB / finish rates and KO-loss / SUB-loss / finished-loss rates for each side (faded exp(-n/8));
  - weight-miss flags.
- **Variants.** "+ml2win" keeps the 6-class model's method-given-winner shares and takes P(A wins) from the ML v2 blend.
- **Selection.** By CV joint loss 2020-2023 (methodround's own folds). S2's penalty was chosen from 0.001, 0.002 and 0.004: 0.002.

| variant | CV 2020-23 joint | method | 7-bin | winner | 2024-25 joint | method [CI] | 7-bin [CI] | winner |
|---|---|---|---|---|---|---|---|---|
| S (methodround) | 2.1732 | 0.9669 | 1.6390 | 0.6497 | 2.0418 | 0.9360 [0.9069, 0.9665] | 1.5538 [1.5163, 1.5948] | 0.6213 |
| S2 (new features) | 2.1437 | 0.9607 | 1.6095 | 0.6323 | 2.0116 | 0.9325 | 1.5236 | 0.5980 |
| S + ML v2 winner | 2.1531 | 0.9665 | 1.6188 | 0.6294 | 2.0125 | 0.9310 | 1.5245 | 0.5918 |
| **S2 + ML v2 winner (chosen)** | **2.1408** | **0.9596** | **1.6065** | 0.6294 | **2.0055** | **0.9298** [0.8995, 0.9624] | **1.5175** [1.4772, 1.5622] | 0.5918 |

Paired with S on 2024-25:

- 7-bin -0.0363 [-0.0505, -0.0214];
- method -0.0062 [-0.0135, +0.0015];
- finish -0.0016 [-0.0076, +0.0045];
- method given the winner -0.0072 [-0.0176, +0.0031].

The joint (method x round) gain equals the 7-bin gain exactly, because the round hazard is shared. The round shapes did
not change; that is the simulator's and v6's job.

Most of the 7-bin gain is the winner. "S + ML v2 winner" alone gets -0.0293. It also lowers method log loss
significantly, -0.0050 [-0.0073, -0.0025]: a sharper winner moves the KO / SUB / DEC mix toward the favourite's
profile.

Other comparisons:

- **ML v1's factorised 7-bin model** (ml.json bins7), same 857 fights: -0.0070 [-0.0214, +0.0077].
- **Market method props** (830 fights): method +0.0017 [-0.0146, +0.0167] and 7-bin +0.012 [-0.016, +0.040]. S was 7-bin +0.050 [+0.018, +0.081] behind.
- **methodround's 40/60 blend with the props** beats the props on method (-0.0071 [-0.0137, -0.0006]) and on 7-bin (-0.0125 [-0.0244, -0.0005]).

## Leakage checks

- **Vault.** `build_db.parse_fights` is wrapped at import. The base, ratings and method tables all assert that their last date is before 2026-01-01.
  - The market-rating stream drops nlbair rows dated 2026+ before running.
  - Every source keyed by backtest id is filtered to dev dates (`dev_only`) before use; market.json and ml.json carry no 2026 rows.
  - Nothing in this tool reads a 2026 result.
- **Corner symmetry.** Asserted at every CV run: max |X + X_swapped| = 4e-16 for the logistic design, and 4e-16 for the tree design built from swapped rows against the flipped design.
  - The logistic has no intercept, and trees average both orientations.
  - The page model reproduces 1 - p under a swap (Node test, 40 pairs, 1e-12).
- **Truncation test (`python3 tools/ml2.py verify`).** Each rating system was rerun in one process with the data stream cut at 2024-06-01.
  - On all 6,620 fights before the cut, the predictions are identical to the full run: max |diff| 0 for WHR-rounds, Glicko-2, Elo-full and TrueSkill-mov.
  - The market rating built only from fights before the cut is identical on its 6,302 fights.
- **Flipped results.** Every result from 2024-06-01 on was reversed. Earlier predictions did not move (max |diff| 0), while 69-70% of later Glicko-2 / Elo / TrueSkill predictions changed.
  - WHR-rounds shows 0% because its round outcomes come from round statistics precomputed before the flip. The truncation test covers it.
- **Reproduction.** The rebuilt base logistic reproduces ml.json's `lr` on all 854 validation fights (0.60625, max difference 0) and on the 1,955 OOF fights. The rebuilt ratings and market rating match their files (see Sources).
- **Pre-UFC presence rule.** A snapshot is used only when one of the fighter's first four UFC bouts is on/after 2015-01-01. That is preufc's own target rule, known before every later bout, so a veteran's record cannot appear just because he was still active in 2021+ (the roster).
- **Two caveats, reported rather than fixed** (they belong to other tools):
  1. **ratings.py's newcomer prior uses the leaky `net_elo`.** `attach_preufc` reads preufc.json's `net_elo` (network built from every cached page), not the strict `net_elo_h`. preufc's own audit found the two correlate 0.996 and score the same (-0.0003). The prior also only starts in 2015 and fades.
     - Expected effect here: small, but not measured.
     - Fix in ratings.py: read `net_elo_h` / `opp_wpct_h` when present, then rerun ratings.py and this tool.
  2. **The rating and market-rating parameters were tuned on 2019-2023.** The 2010-2018 training rows therefore use parameters chosen on later years. This is training-side only; no 2024+ data shaped any parameter.
- **Source drift.** preufc.json was rebuilt at 4:07 pm, after the table. A ratings rebuild on it would move the rating features by up to 0.030 (WHR-rounds), 0.031 (Glicko-2), 0.030 (Elo-full) and 0.036 (TrueSkill) in probability. The published ratings.json (3:44 pm) still matches the cached features exactly.

## Integration recipe

**Page.** Inline `ml2.json`'s `page_model` (972 kB as written; the roster dominates, so a compact copy can drop fighters
outside the page's selector) and `src/ml/ml2.js`:

```js
const h = ML2.load(pageModel);                 // ml2.json page_model
const r = h.predict("alexander-volkanovski", "justin-gaethje",
                    { date: "2026-12-12", lbs: 155, five: 1 },   // + fw: {A: {...}, B: {...}} optional
                    pLineA);                   // optional de-vigged closing-line P(A) (MoE.devig)
// r.pA: ML v2 logistic; r.pMR: market rating; r.pStack: validated no-line stack (ML v2 + market rating);
// r.pStackLine: with-line stack (market 0.71 + ML v2 0.48) when pLineA is given
```

- **Inputs.** The page model needs no other file:
  - ml.py's 76 base terms, from ml.json's roster values (live through Oct 31, 2026);
  - the four rating systems (ratings.json roster: mu, sd; formulas from ratings.py `matchup_probs`);
  - the market rating (market.json ratings: [mu, sd, last, n]; variance drifts tau² per year after the snapshot).
- **Refit.** Coefficients are refit on every decisive fight 2010-2025 (7,093 rows) with the validated settings.
- **Checks.** The Python and JS logits agree to 9e-16 on 40 pairs; the page stacks and the market rating agree to 1e-12. `tests/test_ml2.js` runs 245 checks.
- **Volkanovski vs Gaethje** (Dec 12, 2026, 155 lb, 5 rounds):
  - ML v2 logistic: P(Volkanovski) = 0.710 (v1 page model 0.661);
  - no-line stack: 0.758.
  - The market opened him at about 37%.
  - ML v2 has no size-move adjustment beyond ml.py's weight-move terms, and its market-rating input comes from his featherweight lines. Treat the gap to the market as the model not knowing what the market knows, not as an edge.

**Replace MoE's ML expert.** For the final probability, use the page stacks above. With the line, weights 0.71 / 0.48
on market / ML v2 logistic. Without a line, 1.03 / 0.39 on ML v2 logistic / market rating, h 1.5, refit 2019-2025.
They score better than moe's 7-expert stack in both regimes. Engine, ML v1, feature LR and both Elos get weight 0
next to ML v2.

**Blind test.** `ml2.json` fights carry:

- `ml2` (blend; OOF for 2019-2023, static for 2024-25);
- `ml2_lr`, `ml2_lgb`, `ml2_xgb`;
- `p_rolling` / `ml2_roll` / `ml2_lr_roll` (monthly rolling, 2024-25);
- `mr`;
- the stack columns.

tools/blindtest_plugins/ml2.py picks up `p_rolling` first and uses `set: "oof"` rows as stacker history.

**Method/round.** Use the S2 + ML v2 winner variant as the method yardstick for engine v5+ (7-bin 1.5175 on 2024-25),
or reweight any 6-class output with ML v2's winner (`MR.reweight_winner`).

**Rebuild.**

```
nice -n 5 python3 tools/ml2.py all   # table, cv, fit, stage2, stack, method, verify, export (~45 min on the busy box)
node tests/test_ml2.js
```

The table stage reruns ratings.py's systems (about 4 minutes, mostly WHR) and caches them. Delete
`out/ml2_cache/ratings_all.pkl` after ratings.json or preufc.json changes.

## Open threads

1. **Ratings verifier.** When it signs off or changes parameters, or when ratings.py switches to the strict `net_elo_h`, rerun the tool. The table, the CV choices and every number above depend on those features.
2. **Underconfidence in 2024-25.** Slope 1.45 against 1.11 for the market. A temperature chosen on 2019-2023 would not help; the stack's recency weighting partly does. Re-check on the 2026 forward test.
3. **Trees vs logistic.** The trees won the OOF years and lost the validation years. A blend weight chosen with recency weighting, or LR-only, might be the better production choice. Decide on the blind test, not on 2024-25 again.
4. **Newcomers.** The pre-UFC block, the experience buckets and the market-rating gate all lost in CV once the market rating and the rating systems were in. The remaining newcomer gap to the close (+0.013) is information we do not have.
5. **Heavy favourites and Light Heavyweight** are the two segments where ML v2 trails the close the most (+0.036, +0.029).
