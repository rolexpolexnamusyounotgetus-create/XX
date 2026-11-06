# ML v2 feature union (task key: ml2)

Nov 6, 2026, about 7:20 pm (final run: tables and fits 4:45-4:52 pm on ratings.json of 4:44 pm; styles tests and
re-export 7:05-7:15 pm). Tool: `tools/ml2.py`. Output: `data/derived/ml2.json`. Page evaluator: `src/ml/ml2.js`,
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
| **ML v2 logistic**, static (fit < 2024) | **0.5887** [0.5703, 0.6085] | **69.0%** | **-0.0176 [-0.0241, -0.0108]** |
| ML v2 logistic, monthly rolling refit | 0.5882 [0.5693, 0.6090] | 69.2% | -0.0181 [-0.0253, -0.0105] |
| ML v2 blend (LR 0.43 + LightGBM 0.40 + XGBoost 0.15), static | 0.5918 [0.5728, 0.6117] | 68.5% | -0.0145 [-0.0219, -0.0069] |
| ML v2 blend, monthly rolling | 0.5909 [0.5717, 0.6119] | 68.3% | -0.0153 [-0.0237, -0.0071] |
| closing line (845 fights) | 0.5854 | 69.2% | |
| opening line (843 fights) | 0.6094 | 66.8% | |

- On the fights that have a line, the ML v2 logistic is level with the close: static +0.0003 [-0.0171, +0.0167], rolling -0.0001 [-0.0176, +0.0163].
- It beats the opening line by 0.024 [0.009, 0.039].
- Compared with v1 (0.018 behind the close, tied with the open), the gap to the close is gone.
- Out of fold on 2019-2023 (1,955 fights, annual refits), the blend scores 0.6338 against v1's 0.6479: -0.0141 [-0.0193, -0.0086].
- **Better than v1 in every year 2019-2025.**

**2. Where the gain comes from.** Two verified sources that did not exist when v1 was built carry it. Both were rebuilt
per fight back to 2009/2013, so the model trains on 2010-2023:

- the walk-forward rating systems of tools/ratings.py: WHR on rounds, Glicko-2, margin Elo, TrueSkill with method outcomes;
- the Kalman market rating of tools/market.py, built from earlier closing lines.

Time-ordered CV results:

- Base CV: 0.64569. Market rating: 0.63917. Plus the ratings: 0.63516. Dropping ml.py's "opponent quality" group: 0.63413.
- CV turned down three other blocks; none passed the 0.0005 rule:
  - the pre-UFC record (preufc.json), -0.0004 at its best fade;
  - fight-week context (fightweek.json), -0.0002;
  - the newcomer gate and experience buckets, -0.0001.
- The 2019+-only sources add nothing that survives the rules (section 5):
  - durability, oppadj, mlrates and methodround S: CV gain at most -0.0004; 2024-25 within ±0.0008.
  - styles.py's matchup terms: the nested-screen version passes the stage-2 CV (-0.0011) but loses on 2024-25 (+0.0007 [-0.0020, +0.0032]). The stack CV, which makes the deployment decision, gives it less than 0.0005 in both regimes, so it is not used.

**3. Newcomers: two thirds of the gap to the close is closed.**

- In bouts where a side has 1-2 prior UFC fights (262 fights), ML v2 scores 0.6152 (logistic) / 0.6198 (blend) against v1's 0.6396.
- The blend's gain over v1 is -0.0199 [-0.0348, -0.0054].
- The gap to the close on those fights shrinks from +0.036 (v1) to +0.012 (blend, [-0.023, +0.048]).
- The market-rating term is what moves newcomers. A man's first one or two UFC closing lines already price his regional record and hype, so the pre-UFC block has nothing left to add (CV).

**4. Stacks, refit MoE-style (no intercept, non-negative logit weights, recency half-life chosen by forward-chained CV 2021-2023).**

| 2024-2025 | current stack (moe experts) | with ML v2 | ML v2 minus current [CI] | ML v2 stack minus close [CI] |
|---|---|---|---|---|
| no line, static | 0.5949 | **0.5898** | **-0.0051 [-0.0086, -0.0015]** | +0.0022 [-0.0133, +0.0173] (845) |
| no line, rolling | 0.5916 | **0.5875** | -0.0041 [-0.0083, +0.0003] | **-0.0006 [-0.0166, +0.0147]** (845) |
| with line, static (845) | 0.5788 | **0.5766** | -0.0022 [-0.0043, +0.0001] | **-0.0087 [-0.0134, -0.0041]** |
| with line, rolling (845) | 0.5778 | **0.5760** | -0.0018 [-0.0040, +0.0004] | -0.0094 [-0.0145, -0.0041] |

- **Pooled out of sample 2021-2025** (2,069 fights; the 2021-2023 rows are forward-chained CV years):
  - with the line, ML v2 beats the close by **-0.0045 [-0.0079, -0.0010]** and the current stack by **-0.0022 [-0.0040, -0.0003]**; the current stack alone is -0.0022 [-0.0046, +0.0002] against the close;
  - without a line, ML v2 beats the current stack by **-0.0060 [-0.0092, -0.0027]**. The ML v2 stack is +0.0078 [-0.0021, +0.0175] against the close; the current one is +0.0138 [+0.0040, +0.0233].
- **What the stacks keep.**
  - With the line: market 0.75 and ML v2 0.37. Every other expert drops to 0: market rating, engine, ML v1, feature LR, Elo.
  - Without a line: ML v2 0.78 and market rating 0.49.
- **On the page** (ML v2 logistic plus the inputs the page can compute):
  - the no-line stack scores 0.5890 static / **0.5862** rolling;
  - with the line it scores 0.5757 / 0.5749, which is -0.0096 / -0.0104 against the close.

**5. Method/round model S refit (methodround.py's model, same hyperparameters and round hazard).**

- The chosen variant (by CV 2020-2023) adds the new features and takes its winner from ML v2 ("S2+ml2win").
- On 2024-2025 (857 fights):
  - 7-bin **1.5171 vs 1.5538** for S, **-0.0367 [-0.0511, -0.0218]**;
  - method (KO/SUB/DEC) 0.9298 vs 0.9360, -0.0062 [-0.0136, +0.0015];
  - winner -0.0299.
- In CV 2020-2023 the gains are 7-bin -0.0325 [-0.0439, -0.0204] and method -0.0075 [-0.0141, -0.0009].
- Against the market's method props (830 fights):
  - 7-bin is now +0.012 [-0.017, +0.040] behind; S was +0.050 [+0.018, +0.081] behind;
  - the 40/60 blend with the props beats the props on both method (-0.0071 [-0.0136, -0.0007]) and 7-bin (-0.0127 [-0.0248, -0.0007]).
- Durability chin/power and styles.py's per-side style z-scores ("S3") lose in CV (+0.0044 joint against S2+ml2win) and are not used.

**6. Caveats that matter.**

- **ratings.json** is the 4:44 pm build. It reads preufc.json's strict walk-forward network Elo (`net_elo_h`), and the rebuilt ratings match it to 5e-5.
  - It was re-saved at 7:19 pm with the same build stamp and parameters. Re-checked at 7:20 pm: the per-fight predictions match the ml2 table on all 2,864 dev fights (5e-5), and the page roster's 8,603 rating values are identical.
  - Its builder's note (research/model_ratings.md, 7:15 pm) still has an empty verification section, so the verifier has not signed off.
- **preufc.json** was rewritten at 4:49 pm (its meta still says built 4:07 pm). The verify stage recomputed the four rating systems on the current file: max |diff| 0 against the cached features. The table is current. preufc's own verifier was relaunched (BACKLOG, v5 verdicts).
- **Every model is underconfident on 2024-25.** Calibration slopes are 1.40-1.45 for ML v2 and 1.11 for the close. Rolling refits help a little. No temperature was adopted, because the OOF slope is 1.00.

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
| exp / gate | prior UFC fights | [n in 1-2] and [n in 3-5] differences; market rating, WHR and judge-Elo logits times [min n <= 2] (lets the model shrink harder toward the market-rating prior for newcomers) | all |
| late (stage 2) | durability.json, oppadj.json (verified 3:45 pm), mlrates_oof.json, methodround.json S | read for dev fights only; 2019+ only, so tested as a second stage on ML v2's out-of-fold logit | 2019+ |
| styles (stage 2) | tools/styles.py terms, styles.json archetypes | styles.py's own walk-forward builder run here on backtest.json (2026 rows dropped first): z constants from 2019-2023 rows, archetype centroids from styles.json (fit on 2019-2023 snapshots). styles.json has no per-fight table and its roster is live state, so it cannot be read directly | 2019+ (all 2,809 decisive dev fights) |

The rebuilt features match their source files on every dev backtest fight:

- the ratings to 5e-5 (rounding of ratings.json) for all seven systems on 2,864 fights;
- the market rating to 9e-5 on 2,855 fights;
- the style z constants to 0.003 of styles.json's (backtest.json was rebuilt after styles.json; both use 2019-2023 rows only).

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
| 1 | mr 0.63917, rat 0.63981, pre 0.64251 (tau 16), fw 0.64485, exp 0.64557 | mr |
| 2 | rat 0.63516, gate 0.63808, pre 0.63715 (tau 2), fw 0.63877, exp 0.63905 | rat |
| 3 | pre 0.63479 (tau 2), fw 0.63493, gate 0.63507, exp 0.63509 (all < 0.0005) | none |
| backward | drop "opponent quality": 0.63413 | -opp. quality |

Other checks:

- **Rating sets.** WHR-rounds only 0.63564; WHR + Glicko 0.63523; the four the ratings tool ranked best (WHR-rounds, Glicko-2, Elo-full, TrueSkill-mov) 0.63516; all seven 0.63468 (< 0.0005, so four).
- **Training variants.** All fights 0.63413; both-experienced only 0.63511; recency half-life 8 y 0.63454, 4 y 0.63531; from 2013 only 0.63834.
- **Final logistic.** 81 terms, L2 0.05 on standardised columns, CV 0.63413 (-0.0116 vs base).
- **Removing one block.** Market rating +0.0049, ratings +0.0042.

### 2. Trees, seeds, monotone constraints

Trees see ml.py's tree design (side levels, A-minus-B terms, matchup, context; no raw height or reach, so a missing
tale-of-the-tape cannot leak). On top of that they get the chosen new terms and the side levels for newcomer handling:
prior UFC fights, market-rating variance, WHR sd, pre-UFC availability. That is 155 columns, mirrored rows, and
predictions averaged over both corner orders. Learning rate 0.04 in both libraries.

| model | config (CV-chosen from 5 / 3 candidates) | CV | with monotone constraints | second seed |
|---|---|---|---|---|
| LightGBM | 5 leaves, min 200 per leaf, feature fraction 0.4, bagging 0.8, L2 30, 350 rounds | 0.63338 | 0.63398 (rejected) | 0.63401 |
| XGBoost | depth 2, min child weight 30, colsample 0.5, subsample 0.8, lambda 10, 475 rounds | 0.63310 | 0.63394 (rejected) | 0.63411 |

- Monotone constraints were tried on the rating, Elo and market-rating differences, which are increasing in A's favour. They cost CV in both libraries, so they are off.
- The second-seed column shows the seed noise in a single model's CV (about 0.0006-0.001), so the final trees average 5 LightGBM and 3 XGBoost seeds in logit space.
- The seed ensemble on 2024-25 (LightGBM, 5 seeds vs 1): static +0.0006 [-0.0008, +0.0020], rolling -0.0013 [-0.0027, +0.0000]. Not measurable either way.
- **Blend weights (OOF 2019-2023).** LR 0.434, LightGBM 0.399, XGBoost 0.153. Leave-one-year-out blend 0.6343 vs LR 0.6356.
- On 2024-25 the blend is a little worse than the LR alone: +0.0031 [-0.0002, +0.0062]. The trees are less underconfident there (slope 1.36 vs 1.45), but they rank fights worse. The protocol keeps the blend as "ML v2", because the choice was made before 2024. The page uses the logistic, which is the better 2024-25 model and the one the JS can evaluate.

### 3. Out of fold 2019-2023 (1,955 fights) and validation 2024-2025 (854)

| model | OOF 2019-23 | 2024-25 static [CI] | 2024-25 rolling [CI] | Brier (static) | acc. (static) | slope (static) |
|---|---|---|---|---|---|---|
| Elo | 0.6857 | 0.6769 | = | 0.2421 | 55.1% | 1.13 |
| ML v1 logistic | 0.6479 | 0.6062 [0.5902, 0.6230] | 0.6058 | 0.2088 | 67.9% | 1.54 |
| ML v1 stack (Elo + ML + market rating) | 0.6372 | 0.5958 | | 0.2044 | 68.4% | 1.47 |
| **ML v2 logistic** | 0.6356 | **0.5887** [0.5703, 0.6085] | **0.5882** [0.5693, 0.6090] | 0.2014 | 69.0% | 1.45 |
| ML v2 LightGBM (5 seeds) | 0.6350 | 0.5956 [0.5763, 0.6157] | 0.5942 | 0.2044 | 68.3% | 1.36 |
| ML v2 XGBoost (3 seeds) | 0.6353 | 0.5943 [0.5746, 0.6147] | 0.5942 | 0.2040 | 68.6% | 1.36 |
| **ML v2 blend** | **0.6338** | 0.5918 [0.5728, 0.6117] | 0.5909 [0.5717, 0.6119] | 0.2027 | 68.5% | 1.44 |
| closing line (845) | 0.6232 | 0.5854 | | 0.2005 | 69.2% | 1.11 |

Paired differences on 2024-25:

- ML v2 logistic vs:
  - the ML v1 stack (Elo + ML + market rating): -0.0072 [-0.0126, -0.0020];
  - Elo: -0.0883 [-0.1074, -0.0678];
  - the open: -0.0238 [-0.0390, -0.0087].
- Blend vs the close: +0.0037 [-0.0129, +0.0197].
- Rolling minus static: blend -0.0008 [-0.0025, +0.0009], logistic -0.0005 [-0.0018, +0.0008]. Monthly refits help a little, within noise.

By year (log loss; 2019-2023 out of fold, 2024-2025 static):

| year | n | Elo | ML v1 LR | ML v2 LR | ML v2 blend | close | blend calibration slope |
|---|---|---|---|---|---|---|---|
| 2019 | 388 | 0.6984 | 0.6552 | 0.6481 | 0.6484 | 0.6319 | 0.87 |
| 2020 | 343 | 0.6841 | 0.6514 | 0.6361 | 0.6310 | 0.6303 | 1.05 |
| 2021 | 415 | 0.6813 | 0.6464 | 0.6369 | 0.6361 | 0.6393 | 0.97 |
| 2022 | 419 | 0.6794 | 0.6440 | 0.6271 | 0.6269 | 0.6018 | 1.09 |
| 2023 | 390 | 0.6860 | 0.6436 | 0.6305 | 0.6266 | 0.6142 | 1.05 |
| 2024 | 429 | 0.6770 | 0.6064 | 0.5905 | 0.5950 | 0.5872 | 1.44 |
| 2025 | 425 | 0.6769 | 0.6061 | 0.5868 | 0.5885 | 0.5835 | 1.44 |

ML v2 beats v1 in all seven years. Its blend beats the close in 2021 and ties it in 2020.

**Calibration.** Favourite-side bins, predicted vs observed, on 2024-25 for the static blend:

| predicted | 0.52 | 0.58 | 0.62 | 0.67 | 0.72 | 0.77 | 0.83 |
|---|---|---|---|---|---|---|---|
| observed | 0.52 | 0.59 | 0.67 | 0.72 | 0.83 | 0.83 | 0.93 |
| n | 167 | 158 | 161 | 144 | 82 | 84 | 57 |

- The model is too timid from about 60% up, like every model in 2024-25 (the market's slope is 1.11).
- Out of fold 2019-2023 the blend is calibrated (slope 1.00, ECE 0.006), so no temperature is adopted.
- The stacks' recency weighting (h 1.5) is what sharpens the no-line regime (below).

### 4. Segments (2024-2025, ML v2 blend static; "close" on the segment's fights with a line)

| segment | n | ML v1 LR | ML v2 LR | ML v2 blend | blend rolling | close | blend minus v1 [CI] | blend minus close [CI] |
|---|---|---|---|---|---|---|---|---|
| newcomer bout (a side with 1-2 UFC fights) | 262 | 0.6396 | 0.6152 | 0.6198 | 0.6204 | 0.6039 | **-0.0199 [-0.0348, -0.0054]** | +0.0118 [-0.023, +0.048] |
| both newcomers | 58 | 0.5883 | 0.5414 | 0.5484 | 0.5457 | 0.5001 | **-0.0399 [-0.078, -0.001]** | +0.051 [-0.013, +0.109] |
| middle (fewer-fight side 3-7) | 354 | 0.5861 | 0.5640 | 0.5658 | 0.5629 | 0.5702 | **-0.0203 [-0.0320, -0.0086]** | -0.0070 [-0.035, +0.016] |
| veterans (both 8+) | 238 | 0.5995 | 0.5961 | 0.5995 | 0.6003 | 0.5876 | +0.0000 [-0.013, +0.015] | +0.0108 [-0.016, +0.038] |
| men 125-145 | 271 | 0.6213 | 0.6018 | 0.6068 | 0.6083 | 0.5968 | -0.0145 [-0.030, +0.002] | +0.0075 [-0.020, +0.035] |
| men 155-185 | 332 | 0.5903 | 0.5689 | 0.5714 | 0.5675 | 0.5687 | **-0.0190 [-0.031, -0.006]** | -0.0042 [-0.031, +0.022] |
| men 205-265 | 104 | 0.6529 | 0.6401 | 0.6421 | 0.6419 | 0.6327 | -0.0108 [-0.034, +0.012] | +0.015 [-0.023, +0.047] |
| women | 147 | 0.5815 | 0.5725 | 0.5745 | 0.5758 | 0.5686 | -0.0070 [-0.028, +0.011] | +0.007 [-0.034, +0.046] |
| 3 rounds | 749 | 0.6074 | 0.5902 | 0.5932 | 0.5920 | 0.5804 | **-0.0142 [-0.022, -0.007]** | +0.0098 [-0.007, +0.026] |
| 5 rounds | 105 | 0.5979 | 0.5779 | 0.5815 | 0.5837 | 0.6206 | -0.0163 [-0.036, +0.005] | -0.0391 [-0.081, +0.004] |
| pick'em (close favourite < 60%) | 231 | 0.6819 | 0.6700 | 0.6743 | 0.6735 | 0.6789 | -0.0076 [-0.020, +0.005] | -0.012 [-0.041, +0.017] |
| moderate favourite (60-75%) | 407 | 0.6257 | 0.6194 | 0.6229 | 0.6239 | 0.6268 | -0.0028 [-0.013, +0.007] | -0.004 [-0.023, +0.016] |
| heavy favourite (75%+) | 216 | 0.4887 | 0.4436 | 0.4448 | 0.4407 | 0.4112 | **-0.0439 [-0.061, -0.027]** | +0.034 [-0.009, +0.073] |
| Flyweight | 68 | 0.6028 | 0.5893 | 0.5835 | 0.5873 | 0.6002 | -0.0193 [-0.050, +0.013] | -0.017 [-0.076, +0.040] |
| Bantamweight | 98 | 0.6219 | 0.5958 | 0.6101 | 0.6103 | 0.6086 | -0.0118 [-0.034, +0.015] | -0.001 [-0.068, +0.057] |
| Featherweight | 100 | 0.6395 | 0.6208 | 0.6246 | 0.6258 | 0.5893 | -0.0149 [-0.039, +0.008] | +0.031 [-0.010, +0.068] |
| Lightweight | 118 | 0.5848 | 0.5757 | 0.5853 | 0.5832 | 0.5884 | +0.0005 [-0.021, +0.023] | -0.009 [-0.058, +0.047] |
| Welterweight | 102 | 0.6300 | 0.6062 | 0.6040 | 0.6007 | 0.5910 | **-0.0260 [-0.046, -0.003]** | -0.000 [-0.047, +0.047] |
| Middleweight | 108 | 0.5481 | 0.5225 | 0.5226 | 0.5161 | 0.5249 | **-0.0254 [-0.045, -0.007]** | -0.004 [-0.040, +0.033] |
| Light Heavyweight | 55 | 0.6979 | 0.7036 | 0.6997 | 0.7005 | 0.6841 | +0.0018 [-0.031, +0.037] | +0.024 [-0.026, +0.074] |
| Heavyweight | 49 | 0.6023 | 0.5688 | 0.5775 | 0.5762 | 0.5750 | -0.0249 [-0.049, +0.005] | +0.004 [-0.059, +0.063] |
| Women's Strawweight | 65 | 0.6065 | 0.6021 | 0.6044 | 0.6056 | 0.5726 | -0.0021 [-0.035, +0.031] | +0.032 [-0.027, +0.079] |
| Women's Flyweight | 47 | 0.5710 | 0.5518 | 0.5492 | 0.5474 | 0.5377 | -0.0218 [-0.051, +0.008] | +0.014 [-0.070, +0.089] |

Divisions under 45 fights are in `ml2.json` results.segments only.

- **Where ML v2 gains.** Newcomer and middle-experience bouts, the 155-185 lb men, Welterweight, Middleweight and heavy favourites: the model finally commits to mismatches.
- **Where the market still leads.** Heavy favourites (+0.034), newcomer bouts (+0.012), Featherweight and Women's Strawweight (+0.03), Light Heavyweight (+0.024). In all of them the market has information the stats do not: camp, injuries, film, and the exact quality of a regional record. No single segment gap is significant.
- **Veterans.** ML v2 adds nothing over v1 for veterans (+0.0000).

### 5. Stage 2: the 2019+-only sources on top of ML v2

The second-stage model is a no-intercept logistic on [ML v2's out-of-fold logit, the source's A-minus-B terms], with L2
on the source terms. It is chosen by forward-chained CV over 2021-2023, trained from 2019 (1,224 CV fights), and the
2024-25 look is reported whatever the CV says.

| source block | columns | best L2 | CV gain | 2024-25 change [CI] | adopted |
|---|---|---|---|---|---|
| durability (chin, power, KD/strike, log ratios) | 3 | 0.3 | -0.0004 | -0.0008 [-0.0023, +0.0008] | no |
| oppadj (14 opponent-adjusted factors) | 14 | 10 | +0.0001 | -0.0001 [-0.0002, 0.0000] | no |
| mlrates OOF (expected landed, KD, TD, control, subs) | 5 | 10 | +0.0000 | +0.0000 | no |
| methodround S winner logit | 1 | 10 | +0.0000 | +0.0000 | no |
| all four | 23 | 10 | +0.0000 | -0.0001 [-0.0003, 0.0000] | no |
| styles: all 31 pre-registered matchup candidates (crosses, context, stance, type) | 32 | 1 | -0.0004 | -0.0002 [-0.0019, +0.0014] | no |
| styles: archetype main effects | 7 | 3 | -0.0001 | -0.0001 [-0.0004, +0.0002] | no |
| styles: 32-term skill baseline (z differences) | 32 | 10 | -0.0000 | -0.0002 [-0.0005, +0.0001] | no |
| all four + styles candidates + archetypes | 62 | 3 | -0.0001 | -0.0006 [-0.0014, +0.0001] | no |
| styles: styles.py's 3 screened terms, as published | 3 | 0.1 | -0.0037 (biased) | +0.0020 [-0.0024, +0.0063] | not admissible |
| **styles: screen nested inside each fold** | 2-3 | 0.3 | **-0.0011** | **+0.0007 [-0.0020, +0.0032]** | stage 2 yes; stack CV no |

How to read the styles rows:

- **The published screen is not admissible.** styles.py picked its three winner terms (submission threat vs submission exposure, clinch fighter vs distance fighter, leg kicker vs opponent who gets leg-kicked) by z on 2019-2023. Those are the years this CV scores. Its -0.0037 is in-sample for the selection, and 2024-25 confirms it: +0.0020.
- **The honest version repeats styles.py's rule inside each fold:** a term enters if its likelihood-ratio statistic on the fold's training years passes the 5% chi-square cut. The folds keep clinch-vs-distance in all three; submission threat in 2022 and 2023; leg kicks in 2022; stance in 2021.
  - It passes the stage-2 rule: -0.0011, against the 0.0005 threshold.
  - The one 2024-25 look shows no gain: +0.0007 [-0.0020, +0.0032].
- **Deployment test: "ML v2 + styles" (`ml2s`)** was rebuilt strictly walk-forward. Each year's screen and fit use earlier years only, and 2019 rows keep plain ML v2. It was offered to the stack CV in place of ML v2.
  - The stack CV gains are -0.00049 with the line and -0.00041 without. Both are below the 0.0005 rule, so the stacks keep plain ML v2.
  - 2024-25: line 0.5768 vs 0.5766, no line 0.5895 vs 0.5898 (static).

Style matchups carry no winner information that ML v2 lacks: the strongest penalty, or the nested screen, gets about
nothing. They remain useful for the simulator's stat lines (research/model_styles.md), not for the winner. The other
2019+ sources lead to the same conclusion.

### 6. Stacks

- **Inputs.** Each expert enters as logit(clip(p, 0.01, 0.99)); absent inputs enter as 0.
  - market: power de-vig of the consensus close;
  - mkt_rating: market.json;
  - engine: engine v3, moe_engine_bt.json;
  - ml: ML v1 logistic, `lr_refit` for rolling;
  - feat_lr: moe's feature LR;
  - elo_sig and elo;
  - ml2: the blend, out of fold for 2019-2023;
  - ml2s: ML v2 + the nested style stage, walk-forward (section 5).
- **Fit.** Weights are non-negative, with no intercept, fit on 2019-2023. The recency half-life (none, 3 or 1.5 y) comes from forward-chained CV 2021-2023.
- **Check.** My refit of the current expert set reproduces moe's numbers: no line 0.5949 static and 0.5916 rolling (moe: 0.5955 / 0.5919); with the line 0.5788 (moe 0.5796).

| regime | set | CV 2021-23 | weights | 2024-25 static | rolling |
|---|---|---|---|---|---|
| line | current (7 experts) | 0.61922 | market 0.86, mkt_rating 0.11, ml 0.15, feat_lr 0.06 | 0.5788 | 0.5778 |
| line | current + ml2 | 0.61696 | market 0.75, ml2 0.37, all others 0 | 0.5766 | 0.5760 |
| line | **market + ml2** | **0.61614** | market 0.75, ml2 0.37 | **0.5766** | **0.5760** |
| line | page: market + ML v2 logistic | 0.61624 | market 0.77, ml2lr 0.34 | 0.5757 | 0.5749 |
| line | market + ml2s (not adopted, -0.00049) | 0.61564 | market 0.78, ml2s 0.36 | 0.5768 | 0.5761 |
| no line | current (6 experts), h 1.5 | 0.63646 | mkt_rating 0.85, ml 0.55, feat_lr 0.03 | 0.5949 | 0.5916 |
| no line | current + ml2, h 1.5 | 0.63010 | ml2 0.78, mkt_rating 0.49, all others 0 | 0.5898 | 0.5875 |
| no line | **ml2 + mkt_rating (+ feat_lr 0)**, h 1.5 | **0.62854** | ml2 0.78, mkt_rating 0.49 | **0.5898** | **0.5875** |
| no line | page: ML v2 logistic + mkt_rating, h 1.5 | 0.62984 | ml2lr 0.70, mkt_rating 0.55 | 0.5890 | 0.5862 |
| no line | ml2 alone | 0.63011 | 1.00 | 0.5917 | 0.5897 |
| no line | ml2s + mkt_rating + feat_lr (not adopted, -0.00041) | 0.62813 | ml2s 0.79, mkt_rating 0.52 | 0.5895 | 0.5876 |

**By year.** The 2021-2023 rows are forward-chained, so they are out of sample too.

| year | close | line current | line + ml2 | no line current | no line + ml2 |
|---|---|---|---|---|---|
| 2021 | 0.6393 | 0.6362 | 0.6331 | 0.6443 | 0.6361 |
| 2022 | 0.6018 | 0.6075 | 0.6063 | 0.6399 | 0.6317 |
| 2023 | 0.6142 | 0.6138 | 0.6112 | 0.6245 | 0.6220 |
| 2024 | 0.5872 | 0.5810 | 0.5794 | 0.5976 | 0.5934 |
| 2025 | 0.5835 | 0.5765 / roll 0.5745 | 0.5738 / roll 0.5728 | 0.5923 / roll 0.5855 | 0.5862 / roll 0.5822 |

The ML v2 stacks beat the current ones in every year in both regimes. The pooled 2021-2025 numbers are in the bottom
line.

Segments (2024-25, static stacks; all four paired differences with CIs; "close" on the segment's fights with a line):

| segment | n | no line: current | no line: ml2 | no line ml2 minus current | no line ml2 minus close | close | line ml2 minus current | line ml2 minus close |
|---|---|---|---|---|---|---|---|---|
| newcomer bout | 262 | 0.6220 | 0.6163 | -0.0057 [-0.0138, +0.0033] | +0.0092 [-0.024, +0.041] | 0.6039 | -0.0014 [-0.0071, +0.0039] | -0.0060 [-0.0158, +0.0039] |
| both newcomers | 58 | 0.5532 | 0.5391 | -0.0141 [-0.0330, +0.0047] | +0.040 [-0.014, +0.091] | 0.5001 | -0.0012 [-0.0120, +0.0100] | -0.0003 [-0.0170, +0.0168] |
| middle 3-7 | 354 | 0.5655 | 0.5597 | -0.0058 [-0.0121, 0.0000] | -0.0127 [-0.040, +0.011] | 0.5702 | **-0.0040 [-0.0074, -0.0009]** | **-0.0131 [-0.0200, -0.0065]** |
| veterans 8+ | 238 | 0.6089 | 0.6053 | -0.0035 [-0.0121, +0.0059] | +0.017 [-0.011, +0.045] | 0.5876 | -0.0003 [-0.0044, +0.0042] | -0.0052 [-0.0140, +0.0041] |
| men 125-145 | 271 | 0.6204 | 0.6114 | **-0.0090 [-0.0167, -0.0005]** | +0.013 [-0.014, +0.039] | 0.5968 | -0.0022 [-0.0060, +0.0019] | -0.0050 [-0.0123, +0.0028] |
| men 155-185 | 332 | 0.5670 | 0.5629 | -0.0040 [-0.0107, +0.0030] | -0.011 [-0.038, +0.013] | 0.5687 | -0.0037 [-0.0078, +0.0003] | **-0.0151 [-0.0233, -0.0076]** |
| men 205-265 | 104 | 0.6354 | 0.6365 | +0.0011 [-0.0126, +0.0142] | +0.008 [-0.023, +0.036] | 0.6327 | +0.0022 [-0.0045, +0.0082] | +0.0038 [-0.0086, +0.0156] |
| women | 147 | 0.5825 | 0.5776 | -0.0049 [-0.0143, +0.0048] | +0.010 [-0.028, +0.046] | 0.5686 | -0.0018 [-0.0075, +0.0041] | -0.0100 [-0.0227, +0.0036] |
| 3 rounds | 749 | 0.5975 | 0.5921 | **-0.0054 [-0.0092, -0.0020]** | +0.009 [-0.007, +0.025] | 0.5804 | -0.0014 [-0.0036, +0.0008] | **-0.0071 [-0.0116, -0.0026]** |
| 5 rounds | 105 | 0.5765 | 0.5736 | -0.0029 [-0.0131, +0.0094] | **-0.047 [-0.088, -0.002]** | 0.6206 | **-0.0077 [-0.0143, -0.0007]** | **-0.0205 [-0.0332, -0.0063]** |
| pick'em < 60% | 231 | 0.6751 | 0.6735 | -0.0016 [-0.0094, +0.0064] | -0.010 [-0.038, +0.016] | 0.6789 | -0.0026 [-0.0076, +0.0021] | -0.0102 [-0.0209, +0.0002] |
| moderate 60-75% | 407 | 0.6310 | 0.6274 | -0.0036 [-0.0095, +0.0019] | +0.001 [-0.019, +0.022] | 0.6268 | -0.0022 [-0.0055, +0.0010] | **-0.0090 [-0.0151, -0.0022]** |
| heavy 75%+ | 216 | 0.4412 | 0.4295 | **-0.0118 [-0.0199, -0.0035]** | +0.018 [-0.021, +0.053] | 0.4112 | -0.0016 [-0.0057, +0.0022] | -0.0067 [-0.0153, +0.0018] |
| Flyweight | 68 | 0.5977 | 0.5866 | -0.0110 [-0.0254, +0.0037] | -0.014 [-0.070, +0.039] | 0.6002 | -0.0069 [-0.0158, +0.0025] | -0.0135 [-0.0303, +0.0038] |
| Bantamweight | 98 | 0.6212 | 0.6145 | -0.0067 [-0.0202, +0.0099] | +0.004 [-0.055, +0.056] | 0.6086 | -0.0013 [-0.0085, +0.0061] | -0.0062 [-0.0204, +0.0065] |
| Featherweight | 100 | 0.6417 | 0.6311 | -0.0106 [-0.0252, +0.0024] | +0.038 [-0.003, +0.075] | 0.5893 | -0.0001 [-0.0074, +0.0060] | +0.0020 [-0.0108, +0.0139] |
| Lightweight | 118 | 0.5666 | 0.5749 | +0.0083 [-0.0036, +0.0203] | -0.018 [-0.065, +0.035] | 0.5884 | -0.0003 [-0.0061, +0.0059] | -0.0153 [-0.0296, +0.0002] |
| Welterweight | 102 | 0.6095 | 0.6004 | -0.0091 [-0.0211, +0.0038] | -0.001 [-0.051, +0.047] | 0.5910 | -0.0032 [-0.0103, +0.0042] | -0.0111 [-0.0238, +0.0006] |
| Middleweight | 108 | 0.5269 | 0.5155 | **-0.0114 [-0.0200, -0.0022]** | -0.011 [-0.046, +0.024] | 0.5249 | **-0.0071 [-0.0131, -0.0012]** | **-0.0192 [-0.0302, -0.0077]** |
| Light Heavyweight | 55 | 0.6851 | 0.6950 | +0.0100 [-0.0088, +0.0282] | +0.018 [-0.028, +0.069] | 0.6841 | +0.0060 [-0.0029, +0.0151] | +0.0153 [-0.0000, +0.0330] |
| Heavyweight | 49 | 0.5797 | 0.5707 | -0.0089 [-0.0250, +0.0074] | -0.004 [-0.057, +0.046] | 0.5750 | -0.0021 [-0.0092, +0.0058] | -0.0091 [-0.0260, +0.0080] |
| Women's Strawweight | 65 | 0.6194 | 0.6152 | -0.0042 [-0.0187, +0.0102] | +0.043 [-0.009, +0.091] | 0.5726 | +0.0010 [-0.0075, +0.0086] | +0.0006 [-0.0191, +0.0201] |
| Women's Flyweight | 47 | 0.5396 | 0.5354 | -0.0042 [-0.0198, +0.0160] | -0.001 [-0.074, +0.067] | 0.5377 | +0.0009 [-0.0105, +0.0119] | -0.0094 [-0.0313, +0.0109] |

- **With the line, ML v2 adds most** where the close is weakest: 5-round fights, pick'ems, middle-experience bouts, Middleweight and the 155-185 lb men.
- **It adds nothing**, or slightly hurts, at 205+ lb and at Light Heavyweight. That is a small and noisy segment where the market leads every model.
- **Without a line**, the ML v2 stack is better than the close in 5-rounders (significant), pick'ems, middle-experience bouts and at 155-185. It is worse for heavy favourites, newcomers, veterans, Featherweight and Women's Strawweight.

**Production risk (same as moe's).** The no-line stack's recency weight emphasises 2024-25, where models were
underconfident:

- page production weights, refit on 2019-2025: ml2lr 1.03 and mkt_rating 0.39, sum 1.42;
- the validated weights (fit before 2024) sum to 1.26.

If 2026 looks like 2019-2023, the production stack will be too sharp. Watch the forward-test calibration (the blind
test, tools/blindtest.py) and refit with h = 3 if slopes fall back toward 1.

### 7. Method/round model S with the new features

- **Model.** methodround.py's model, imported unchanged: 6-class who-and-how logit, competing-risks round hazard, and methodround.json's chosen penalties (C_haz 0.03, draw_c).
- **Data.** Its table is rebuilt with 2026 dropped at parse.
- **New side-oriented columns (S2):**
  - the ML v2 logistic's logit (annual out-of-fold 2012-2023, static for 2024-25) and its absolute value;
  - the WHR-rounds and market-rating logits and their absolute values;
  - the pre-UFC KO / SUB / finish rates and KO-loss / SUB-loss / finished-loss rates for each side (faded exp(-n/8));
  - weight-miss flags.
- **S3** adds the 2019+ side sources to S2, zero-filled where absent, with a presence flag:
  - durability's log chin, power and KD-per-strike for X and Y;
  - styles.py's per-side z-scores for X and Y: submission threat and exposure, takedown intent and defence, control for and against, KD power, chin, volume, late output.
  - Coverage: 2,864 of 5,923 rows.
  - An S3 variant must beat its S2 counterpart by more than 0.0005 in CV.
- **Variants.** "+ml2win" keeps the 6-class model's method-given-winner shares and takes P(A wins) from the ML v2 blend.
- **Selection.** By CV joint loss 2020-2023 (methodround's own folds). The S2 and S3 penalties were chosen from 0.001, 0.002 and 0.004: 0.002 for S2, 0.001 for S3.

| variant | CV 2020-23 joint | method | 7-bin | winner | 2024-25 joint | method [CI] | 7-bin [CI] | winner |
|---|---|---|---|---|---|---|---|---|
| S (methodround) | 2.1732 | 0.9669 | 1.6390 | 0.6497 | 2.0418 | 0.9360 [0.9069, 0.9665] | 1.5538 [1.5163, 1.5948] | 0.6213 |
| S2 (new features) | 2.1436 | 0.9607 | 1.6094 | 0.6323 | 2.0114 | 0.9325 | 1.5235 | 0.5978 |
| S + ML v2 winner | 2.1531 | 0.9665 | 1.6188 | 0.6293 | 2.0120 | 0.9309 | 1.5240 | 0.5913 |
| **S2 + ML v2 winner (chosen)** | **2.1407** | **0.9595** | **1.6064** | 0.6293 | **2.0051** | **0.9298** [0.8994, 0.9623] | **1.5171** [1.4768, 1.5614] | 0.5913 |
| S3 (S2 + durability + style z) | 2.1527 | 0.9623 | 1.6184 | 0.6370 | 2.0117 | 0.9321 | 1.5237 | 0.6003 |
| S3 + ML v2 winner | 2.1451 | 0.9621 | 1.6108 | 0.6293 | 2.0028 | 0.9292 | 1.5148 | 0.5914 |

Paired with S on 2024-25 (chosen variant):

- 7-bin -0.0367 [-0.0511, -0.0218];
- method -0.0062 [-0.0136, +0.0015];
- finish -0.0016 [-0.0077, +0.0044];
- method given the winner -0.0072 [-0.0176, +0.0031].

The joint (method x round) gain equals the 7-bin gain exactly, because the round hazard is shared. The round shapes did
not change; that is the simulator's and v6's job.

Most of the 7-bin gain is the winner. "S + ML v2 winner" alone gets -0.0298 [-0.0398, -0.0193]. It also lowers method
log loss significantly, -0.0051 [-0.0074, -0.0026]: a sharper winner moves the KO / SUB / DEC mix toward the
favourite's profile.

S3 against S2: in CV, S3 + ML v2 winner is +0.0044 [-0.0006, +0.0096] worse on the joint loss, and plain S3 +0.0090
[+0.0034, +0.0151] worse. That holds on method too: +0.0026 / +0.0016. The 2019+ sources do not help method once ML v2,
the ratings and the pre-UFC finish rates are in. On 2024-25, S3 + ML v2 winner is -0.0023 [-0.0065, +0.0019]: within
noise, and not a reason to override the CV.

Other comparisons:

- **ML v1's factorised 7-bin model** (ml.json bins7), same 857 fights: -0.0074 [-0.0215, +0.0073].
- **Market method props** (830 fights): method +0.0017 [-0.0146, +0.0168] and 7-bin +0.0117 [-0.0167, +0.0396]. S was 7-bin +0.050 [+0.018, +0.081] behind.
- **methodround's 40/60 blend with the props** beats the props on method (-0.0071 [-0.0136, -0.0007]) and on 7-bin (-0.0127 [-0.0248, -0.0007]).

## Leakage checks

- **Vault.** `build_db.parse_fights` is wrapped at import. The base, ratings and method tables all assert that their last date is before 2026-01-01.
  - The market-rating stream drops nlbair rows dated 2026+ before running.
  - Every source keyed by backtest id is filtered to dev dates (`dev_only`) before use; market.json and ml.json carry no 2026 rows.
  - The styles block drops backtest.json rows dated 2026+ before building (backtest.json holds 2019-2025 only anyway).
  - Nothing in this tool reads a 2026 result.
- **Corner symmetry.** Asserted at every CV run: max |X + X_swapped| = 7e-16 for the logistic design, and 7e-16 for the tree design built from swapped rows against the flipped design.
  - The styles block is rebuilt from corner-swapped rows and asserted antisymmetric: max |X + X_swapped| = 0 for all 32 style and 32 skill columns.
  - The logistic and the stage-2 and stack models have no intercept, and trees average both orientations.
  - The page model reproduces 1 - p under a swap (Node test, 40 pairs, 1e-12).
- **Selection bias.** styles.py's published winner screen was chosen on 2019-2023. It is reported but not admissible here; the nested screen redoes the selection inside every fold (section 5).
- **Truncation test (`python3 tools/ml2.py verify`).** Each rating system was rerun in one process with the data stream cut at 2024-06-01.
  - On all 6,620 fights before the cut, the predictions are identical to the full run: max |diff| 0 for WHR-rounds, Glicko-2, Elo-full and TrueSkill-mov.
  - The market rating built only from fights before the cut is identical on its 6,302 fights.
- **Flipped results.** Every result from 2024-06-01 on was reversed. Earlier predictions did not move (max |diff| 0), while 69-70% of later Glicko-2 / Elo / TrueSkill predictions changed.
  - WHR-rounds shows 0% because its round outcomes come from round statistics precomputed before the flip. The truncation test covers it.
- **Reproduction.** The rebuilt base logistic reproduces ml.json's `lr` on all 854 validation fights (0.60625, max difference 0) and on the 1,955 OOF fights. The rebuilt ratings and market rating match their files (see Sources).
- **Pre-UFC presence rule.** A snapshot is used only when one of the fighter's first four UFC bouts is on/after 2015-01-01. That is preufc's own target rule, known before every later bout, so a veteran's record cannot appear just because he was still active in 2021+ (the roster).
- **Pre-UFC network Elo.** The 4:44 pm ratings.json reads preufc.json's strict walk-forward `net_elo_h` (`meta.preufc_network_elo_column`). The earlier build read the leaky `net_elo`. The tables here are from the strict build, and the verify stage confirms that the current preufc.json gives identical rating features (max |diff| 0).
- **One caveat, reported rather than fixed (it belongs to other tools).** The rating and market-rating parameters were tuned on 2019-2023, so the 2010-2018 training rows use parameters chosen on later years. This is training-side only; no 2024+ data shaped any parameter.

## Integration recipe

**Page.** Inline `ml2.json`'s `page_model` (about 1.1 MB as JSON; the 1,229-fighter roster dominates, so a compact copy can
drop fighters outside the page's selector) and `src/ml/ml2.js`:

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
- **Checks.** The Python and JS logits agree to 4e-16 on 40 pairs; the page stacks and the market rating agree to 1e-12. `tests/test_ml2.js` runs 245 checks, all passing on the final ml2.json.
- **Volkanovski vs Gaethje** (Dec 12, 2026, 155 lb, 5 rounds):
  - ML v2 logistic: P(Volkanovski) = 0.711 (v1 page model 0.661);
  - no-line stack: 0.759.
  - The market opened him at about 37%.
  - ML v2 has no size-move adjustment beyond ml.py's weight-move terms, and its market-rating input comes from his featherweight lines. Treat the gap to the market as the model not knowing what the market knows, not as an edge.

**Replace MoE's ML expert.** For the final probability, use the page stacks above:

- with the line, weights 0.71 / 0.48 on market / ML v2 logistic;
- without a line, 1.03 / 0.39 on ML v2 logistic / market rating, h 1.5, refit 2019-2025.

They score better than moe's 7-expert stack in both regimes. Engine, ML v1, feature LR and both Elos get weight 0
next to ML v2. The style stage (`ml2s`) is not part of the stacks.

**Blind test.** `ml2.json` fights carry:

- `ml2` (blend; OOF for 2019-2023, static for 2024-25);
- `ml2_lr`, `ml2_lgb`, `ml2_xgb`;
- `p_rolling` / `ml2_roll` / `ml2_lr_roll` (monthly rolling, 2024-25);
- `mr`;
- the stack columns.

tools/blindtest_plugins/ml2.py picks up `ml2_roll` first and uses `set: "oof"` rows as stacker history.

**Method/round.** Use the S2 + ML v2 winner variant as the method yardstick for engine v5+ (7-bin 1.5171 on 2024-25),
or reweight any 6-class output with ML v2's winner (`MR.reweight_winner`).

**Rebuild.**

```
nice -n 5 python3 tools/ml2.py all   # table, cv, fit, stage2, stack, method, verify, export (about 8 minutes; the last full run took 7.5)
node tests/test_ml2.js
```

The table stage reruns ratings.py's systems (about 75 seconds, mostly WHR) and caches them. After ratings.json,
preufc.json, backtest.json or styles.json changes, delete `out/ml2_cache/ratings_all.pkl` (ratings / preufc) or
`out/ml2_cache/styles_block.pkl` (backtest / styles).

## Open threads

1. **Ratings verifier.** research/model_ratings.md's verification section is still empty. When it signs off with changes, or changes parameters, rerun the tool. The table, the CV choices and every number above depend on those features.
2. **Underconfidence in 2024-25.** Slope 1.44 against 1.11 for the market. A temperature chosen on 2019-2023 would not help; the stack's recency weighting partly does. Re-check on the 2026 forward test.
3. **Trees vs logistic.** The trees won the OOF years and lost the validation years. A blend weight chosen with recency weighting, or LR-only, might be the better production choice. Decide on the blind test, not on 2024-25 again.
4. **Newcomers.** The pre-UFC block, the experience buckets and the market-rating gate all lost in CV once the market rating and the rating systems were in. The remaining newcomer gap to the close (+0.012) is information we do not have.
5. **Heavy favourites, Featherweight and Light Heavyweight** are the segments where ML v2 trails the close the most (+0.034, +0.031, +0.024).
6. **Style matchups.** The clinch-vs-distance term is screened in by every fold, but its gain is below the deployment rule and absent on 2024-25. Re-test it on the 2026 forward test before any engine v7 work treats style interactions as winner signal.
