# ML benchmark and stacking layer (task key: ml)

Tool: `tools/ml.py`. Output: `data/derived/ml.json`. Built Nov 6, 2026 from the ufcstats snapshot through
Oct 31, 2026 (`data/raw/`), with `tools/build_db.py`'s loaders, people resolution and walk-forward Elo. Market
and engine inputs for the stacking layer come from `data/derived/market.json` (tools/market.py) and
`data/derived/moe_engine_bt.json` (engine v3 via tools/moe_engine_bt.js). Tuned only on 2010-2023; scored once on
2024-01-01..2026-10-31. Every number below is stored in `ml.json` (`results`, `tuning`).

## Bottom line

- **The logistic model is the strongest single predictor in the project.** On the 1,223 decisive 2024+ fights,
  trained on 2010-2023 only, it scores log loss **0.6156** [95% CI 0.6011, 0.6303], Brier 0.2132, accuracy
  **66.6%** [64.3, 69.0], AUC 0.724. Walk-forward Elo scores 0.6799 and 54.9%, so the gain is **0.064**
  [0.050, 0.078]. XGBoost (0.6238) and LightGBM (0.6253) beat Elo comfortably but lose to the logistic model
  (LightGBM by 0.0097 [0.0037, 0.0154]). The OOF-weighted blend (logistic 0.56, XGBoost 0.43, LightGBM 0) scores
  0.6176, statistically tied with the logistic model alone. Other models on the same fights: the styles agent's
  skill logistic 0.6272, the market rating 0.6324 (1,213 fights). On the 854 fights of 2024-2025: engine v3
  0.6436, moe's feature logistic 0.6133, this logistic model 0.6062.
- **Against the market** (1,182 test fights with both an opening and a closing line): the close scores 0.5885 and
  the open 0.6105. The logistic model **ties the opening line** (+0.0005 [-0.0150, 0.0175]) and sits 0.023
  [0.005, 0.040] behind the close. It is far better than anything else available before a line is posted.
- **The stacking layer adds real held-out value.**
  - No line yet: Elo + ML + market rating scores **0.6057** on 1,213 fights, 0.0106 [0.0028, 0.0183] better than
    the ML blend on the same fights. It is 0.009 ahead of the opening line (CI crosses zero) and 0.013 behind the
    close.
  - Opening line posted: open + ML beats the open by **0.0174** [0.0113, 0.0234].
  - Closing line: close + ML beats the close by **0.0034** [0.0010, 0.0059], so the stats carry information the
    closing line has not priced.
  - Engine v3 adds nothing next to the ML blend: its weight is -0.05, and including it costs 0.0010
    [0.0003, 0.0016] on its 854 fights.
- **7 bins** (A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO): P(win) from the stack times a softmax for the method
  given the winner scores **1.5443** [1.5066, 1.5824] on 2024+. Corner-symmetric base rates score 1.7153 and Elo
  with base method splits 1.7018; the best published figure is 1.60-1.62, on other years. The market's method props
  do better still, 1.4983, against 1.5413 for this model on the same 1,183 fights.
- **A leak was found and removed.** A missing reach in ufcstats' tale of the tape marks fighters who were cut early:
  that side lost 94.5% of 2010-2018 fights. The tree models had learned the pattern. Held-out scores were not
  inflated, but the leak made the trees' CV look better than it was (LightGBM 0.6415 with the leak, 0.6466
  without). The trees also improved on test once it was closed: a first run with the leak scored LightGBM 0.6303
  and XGBoost 0.6324 on the same fights, against 0.6253 and 0.6238 now. See Leakage checks.
- **Calibration.** Out-of-fold slopes are 0.91-1.01, so no recalibration layer is needed. All the ML models are
  under-confident in 2024+ (slope 1.25-1.40): the period is more predictable for every model, the market included.
  A walk-forward yearly temperature does not help on the 2020-2023 OOF years, so it is not adopted.

## Method

### Data and protocol

- Source: the ufcstats snapshot in `data/raw/` (through Oct 31, 2026), parsed by `tools/build_db.py`'s own loaders, so
  fight ids, people, aliases and Elo are identical to the rest of the pipeline. Walk-forward Elo (K 44, boost 1.5)
  matches `backtest.json` to rounding; decayed exposure and fight counts recomputed for 800 random backtest entries
  match `backtest.json`'s independent snapshots (max relative error 0.0004, zero count mismatches).
- Rows: every UFC fight from 2010-01-01 (7,709 rows; fights involving an unresolved `amb:` person are dropped).
  Each side's features are computed from that fighter's earlier UFC fights only, at the fight date. Shrinkage
  targets are division league rates from the 5 years before Jan 1 of the fight's year.
- Tuning: everything (features, penalties, tree hyperparameters, group selection, blend and stack weights,
  recalibration) is chosen inside 2010-2023. Time-ordered CV = expanding window with four validation blocks
  (2016-17, 2018-19, 2020-21, 2022-23), each trained on all earlier years from 2010; validation rows are fights where
  both men had a prior UFC fight (the backtest definition).
- Out-of-fold (OOF) 2019-2023: annual expanding refits (train 2010..Y-1, predict Y). These feed the ML blend,
  Platt / isotonic recalibration and the stacking layer.
- Held-out test: every backtest fight from 2024-01-01 (1,223 decisive, 1,229 for 7 bins), predicted once by models
  trained on 2010-2023, as this task specifies. `*_refit` rows show the production policy (retrain each January with
  frozen hyperparameters: 2025 from <= 2024, 2026 from <= 2025). docs/BACKLOG.md's hidden-data protocol treats
  fights from 2026-01-01 as a vault; nothing in this tool was chosen with them, the per-fight 2026 predictions come
  only from models trained through 2023 (or 2025 for `*_refit`), and the 2024-2025 validation split is reported
  separately so this work lines up with the other v4+ agents.
- Corner symmetry: the A/B position is never a feature (A won 55.1% of decisive 2024+ fights). The logistic model
  uses only antisymmetric A-minus-B terms with no intercept, so p(B beats A) = 1 - p(A beats B) exactly. Trees and
  multinomial models train on both corner orders (labels mirrored) and average the two orientations at prediction.
- Metrics: log loss, Brier, accuracy, AUC, symmetric ECE (each fight counted from both sides), calibration slope
  and intercept (logistic regression of the result on logit p), 7-bin log loss. Draws and no-contests are excluded
  from winner metrics; DQ and NC from 7-bin metrics. CIs are 95% event-cluster bootstrap intervals (2,000
  resamples of UFC cards), and differences are paired on the same fights.

### Features (per side, as of the fight)

| Group | Terms |
|---|---|
| Striking rates (decayed 730 d, shrunk 20 min toward the division) | sig landed / absorbed / attempted per min, head / body / leg landed and absorbed, distance / clinch / ground landed and absorbed, total strikes, striking differential, 1-year-decay form differential |
| Accuracy / defence (shrunk 100 attempts) | sig accuracy and defence, head accuracy and defence, leg accuracy, distance accuracy and defence |
| KD power / chin (shrunk 350 head strikes) | KD per 15 for / against, KD per landed head strike (power), KD absorbed per head strike absorbed (chin) |
| Grappling | TD landed / attempted per 15 for and against, TD accuracy and defence (shrunk 10), control share for / against, sub attempts per 15 for / against, reversals, TD and control differentials, control form |
| Record / finishes | shrunk win %, decayed win %, KO / SUB / DEC win and loss rates, finish share of wins, finished share of losses, career KO losses, KDs absorbed, sig strikes absorbed (damage) |
| Recent form | last-3 result mean, finish losses in last 3, last result, last loss by KO, streak, 1-year-decay win rate, Elo change over the last 3 fights |
| Experience | log UFC fights, log UFC minutes, minutes per fight, 5-round fights, title fights, years in the UFC, debut flag |
| Ratings | walk-forward Elo; two margin-aware Elos whose score blends the result with the share of significant strikes (K 160, w 0.8) or of a judging-weight score (K 160, w 0.9), tuned on 2010-2023 |
| Opponent quality | mean pre-fight Elo of all past opponents and of the last 3, best and mean Elo of beaten opponents |
| Age, size, stance | age, hinges past 30 and 34, age at UFC debut, height, reach, ape index, southpaw-vs-orthodox and switch indicators |
| Layoff / weight | log days since the last fight, layoff > 450 days, weight-class move in lb vs the previous fight, first fight in this class |
| Matchup | offence x opponent's allowed shares (log5-style) for sig strikes, head strikes, KDs, TDs, control, subs, ground strikes; for the trees also division-normalised expected differentials and symmetric totals (pace, KD, sub, control) |

The logistic model takes log-ratio (rates), logit-difference (accuracies) or plain differences of these (100
terms before group selection). The trees see the same differences plus 19 absolute side levels per fighter (age,
UFC fights, Elo, strike-share Elo, layoff, KO losses, KDs absorbed, win %, landed and absorbed per minute, TDs,
control, subs, power, chin, years in the UFC, last-3 form, weight move, debut) and the context (weight in lb, women,
title, 5 rounds, catch weight): 160 columns.

### Leakage checks, and one leak found and removed

- **Truncation test.** The feature table rebuilt from fights before 2024-06-01 only is identical, cell for cell, to
  the full-data table on those fights (6,405 rows x 209 features, 0 cells differ). No feature sees a later fight.
- **Independent recomputation.** Elo, decayed exposure and fight counts match `backtest.json`, which
  `tools/build_db.py` builds with separate code (see Data and protocol).
- **Leak found: missing tale-of-the-tape values.** ufcstats' height, reach, DOB and stance are a current snapshot,
  and a missing value is not random. In 2010-2018 rows where exactly one fighter had no reach on file, that
  fighter lost 94.5% of 403 fights: fighters cut after a short UFC run often never got a reach entry, so the
  missing value encodes the rest of their career. LightGBM sends NaN down its own branch, and in the first run
  absolute reach became its top feature (25% of gain). The held-out scores were not inflated by it (2019-2023 has
  one such fight; in 2024+ the side with missing reach lost 46.5% of 86 fights, no signal), but the trees were
  learning a rule that no longer holds and mis-scoring those 86 test fights. Fix: the trees see size only as
  A-minus-B differences (0 when either value is missing, so no direction), no absolute height or reach, a missing
  DOB takes the opponent's age, stance flags come from the stance string alone, and the method model has no ape
  term. The logistic model was already immune (differences only). **Other models in the project that give raw
  `height_in` / `reach_in` with NaN to a tree should do the same** (tools/moe.py's `SIDE_NUM` feeds them to its
  feature GBM).

## Results

### 1. Tuning inside 2010-2023

**Logistic model.** The grid covered L2 penalties 0.01-0.5, training on all fights vs only fights where both men
had fought in the UFC before, and an optional 8-year recency weight. All fights, no recency weight, penalty 0.1
won with CV log loss 0.6478. Training only on experienced pairs scored 0.6483 and the recency weight 0.6484.

Ablation (drop one feature group, CV change; and the group on its own):

| Group | Terms | CV change when dropped | CV with the group alone |
|---|---|---|---|
| age | 4 | +0.0111 | 0.6751 |
| grappling | 14 | +0.0026 | 0.6843 |
| margin Elo | 2 | +0.0022 | 0.6714 |
| size/reach | 3 | +0.0011 | 0.6917 |
| accuracy/defence | 7 | +0.0009 | 0.6825 |
| experience | 7 | +0.0005 | 0.6890 |
| recent form | 7 | +0.0002 | 0.6830 |
| layoff/weight move | 4 | +0.0001 | 0.6917 |
| stance | 2 | +0.0001 | 0.6934 |
| record/finishes | 14 | -0.0000 | 0.6782 |
| Elo | 1 | -0.0001 | 0.6851 |
| matchup shares | 7 | -0.0001 | 0.6692 |
| opponent quality | 4 | -0.0001 | 0.6953 |
| KD power/chin | 4 | -0.0003 | 0.6875 |
| striking rates | 20 | -0.0020 | 0.6764 |

Backward elimination of whole groups (a group goes only if dropping it lowers CV by more than 0.0005) removed the
20 raw striking-rate terms. They are redundant with the strike-share Elo, the matchup shares and the accuracy and
defence terms, and only add variance. After re-tuning, the penalty is 0.05 with 80 terms, CV 0.6457. Age is by far
the most valuable single group, and the two margin-aware Elos are worth more than plain Elo, which adds nothing
once they are in.

**Feature parameters** (logistic CV on annual 2016-2023 folds, penalty 0.1, run on an earlier build of the feature
table): the sweep is flat, so the literature defaults stay.

| Setting | CV log loss |
|---|---|
| default: half-life 730 d, 20 min, 100 attempts, 350 head strikes, form half-life 365 d | 0.6464 |
| half-life 365 / 1,095 / 1,460 d | 0.6475 / 0.6465 / 0.6467 |
| rate prior 10 / 40 min | 0.6460 / 0.6469 |
| accuracy and KD priors 50 and 200 / 200 and 600 | 0.6464 / 0.6463 |
| form half-life 180 d | 0.6465 |

**Margin-aware Elo.** Scoring each fight as (1 - w) x result + w x the fighter's share of significant strikes,
with K = 160 and w = 0.8, gives 2010-2023 log loss 0.6679 against 0.6836 for result-only Elo (4,672 fights). A
judging-weight score share (K 160, w 0.9) gives 0.6661. On 2024+ they score 0.6650 and 0.6608 against 0.6799:
-0.0149 [-0.0242, -0.0054] and -0.0192 [-0.0295, -0.0088]. A rating that sees how fights were won is
substantially better than one that sees only who won.

**Trees.** LightGBM (8 random configurations x 4 blocks, learning rate 0.04, rounds chosen on the CV curve) is
flat across configurations: 0.6466-0.6481. The best has 15 leaves, at least 160 rows per leaf, feature fraction 0.6
and 150 rounds. XGBoost (4 configurations) ranges 0.6473-0.6481; the best has depth 4, min child weight 60,
colsample 0.4, lambda 50 and 225 rounds.

**Blend and refits.** The blend weights are non-negative logit weights fit on 2019-2023 OOF: logistic 0.564,
XGBoost 0.426, LightGBM 0. The unconstrained fit gives LightGBM -0.105, a collinearity artefact. Leave-one-year-out
log loss of the blend is 0.6467, against 0.6479 for the logistic model's OOF. Refitting every year beats a model
frozen at the end of 2018 on 2019-2023 (0.6479 vs 0.6505), which is the evidence for the January-refit policy.

### 2. Out-of-fold 2019-2023 (1,955 decisive backtest fights)

| Model | Log loss | Brier | Accuracy | AUC | ECE | Slope |
|---|---|---|---|---|---|---|
| Elo | 0.6857 | 0.2464 | 0.549 | 0.545 | 0.014 | 0.55 |
| Strike-share Elo | 0.6729 | 0.2400 | 0.590 | 0.599 | 0.025 | 0.80 |
| Judging-score Elo | 0.6768 | 0.2417 | 0.589 | 0.597 | 0.019 | 0.67 |
| Logistic | 0.6479 | 0.2283 | 0.618 | 0.663 | 0.011 | 0.91 |
| LightGBM | 0.6511 | 0.2298 | 0.616 | 0.657 | 0.014 | 0.88 |
| XGBoost | 0.6492 | 0.2288 | 0.627 | 0.661 | 0.005 | 0.94 |
| ML blend | 0.6465 | 0.2276 | 0.626 | 0.665 | 0.004 | 0.97 |
| Stack: Elo + ML + market rating | 0.6374 | 0.2236 | 0.637 | 0.679 | 0.007 | 0.97 |

The blend and stack rows are in-sample for their few weights (the leave-one-year-out figures are 0.6467 and
0.6392). Platt and isotonic rows are in ml.json but are in-sample by construction here, so they are judged on 2024+
only.

### 3. Held-out 2024-01-01..2026-10-31 (1,223 decisive fights; models trained on 2010-2023)

| Model | Log loss [95% CI] | Brier | Accuracy [95% CI] | AUC | ECE | Slope | Minus Elo [95% CI] |
|---|---|---|---|---|---|---|---|
| Elo (backtest) | 0.6799 [0.6724, 0.6875] | 0.2435 | 0.549 [0.526, 0.575] | 0.570 | 0.022 | 0.88 | 0 |
| Strike-share Elo | 0.6650 [0.6556, 0.6745] | 0.2363 | 0.589 [0.563, 0.614] | 0.622 | 0.011 | 1.03 | -0.0149 [-0.0242, -0.0054] |
| Judging-score Elo | 0.6608 [0.6501, 0.6716] | 0.2341 | 0.613 [0.588, 0.637] | 0.637 | 0.018 | 1.04 | -0.0192 [-0.0295, -0.0088] |
| **Logistic** | **0.6156** [0.6011, 0.6303] | 0.2132 | **0.666** [0.643, 0.690] | 0.724 | 0.039 | 1.34 | **-0.0643** [-0.0784, -0.0500] |
| LightGBM | 0.6253 [0.6113, 0.6393] | 0.2174 | 0.657 [0.635, 0.680] | 0.709 | 0.031 | 1.25 | -0.0546 [-0.0677, -0.0409] |
| XGBoost | 0.6238 [0.6105, 0.6372] | 0.2167 | 0.660 [0.637, 0.682] | 0.712 | 0.035 | 1.32 | -0.0562 [-0.0690, -0.0424] |
| ML blend | 0.6176 [0.6037, 0.6312] | 0.2139 | 0.663 [0.638, 0.687] | 0.723 | 0.039 | 1.40 | -0.0623 [-0.0751, -0.0488] |
| ML blend, Platt (OOF) | 0.6175 [0.6034, 0.6311] | 0.2139 | 0.663 | 0.723 | 0.039 | 1.39 | -0.0624 |
| ML blend, isotonic (OOF) | 0.6178 [0.6035, 0.6318] | 0.2141 | 0.661 | 0.721 | 0.040 | 1.33 | -0.0621 |
| Logistic, annual refit | 0.6153 [0.6000, 0.6302] | 0.2130 | 0.662 | 0.723 | 0.034 | 1.28 | -0.0646 |
| LightGBM, annual refit | 0.6226 [0.6082, 0.6371] | 0.2160 | 0.666 | 0.713 | 0.036 | 1.23 | -0.0573 |
| ML blend, annual refit | 0.6175 [0.6028, 0.6315] | 0.2139 | 0.666 | 0.722 | 0.037 | 1.33 | -0.0624 |
| **Stack: Elo + ML + market rating** | **0.6071** [0.5896, 0.6251] | 0.2094 | **0.679** [0.655, 0.702] | 0.733 | 0.036 | 1.25 | **-0.0728** [-0.0899, -0.0549] |

Paired differences (event-cluster bootstrap): LightGBM - logistic +0.0097 [0.0037, 0.0154]; blend - logistic
+0.0020 [-0.0006, 0.0046]; blend - LightGBM -0.0077 [-0.0113, -0.0039]; isotonic - raw blend +0.0001
[-0.0017, 0.0020]; annual refit - frozen blend -0.0002 [-0.0016, 0.0014]; stack - blend -0.0105 [-0.0185, -0.0025].
The stack row uses the elo+ML stack for the 10 fights without a market rating.

**By year** (log loss; 2019-2023 are OOF, 2024+ frozen models):

| Year | n | Elo | Logistic | LightGBM | ML blend | Open | Close |
|---|---|---|---|---|---|---|---|
| 2019 | 388 | 0.6984 | 0.6551 | 0.6626 | 0.6554 | 0.6508 | 0.6319 |
| 2020 | 343 | 0.6841 | 0.6514 | 0.6463 | 0.6473 | 0.6337 | 0.6291 |
| 2021 | 415 | 0.6813 | 0.6463 | 0.6502 | 0.6448 | 0.6544 | 0.6399 |
| 2022 | 419 | 0.6794 | 0.6440 | 0.6485 | 0.6423 | 0.6156 | 0.6032 |
| 2023 | 390 | 0.6860 | 0.6436 | 0.6476 | 0.6430 | 0.6339 | 0.6128 |
| 2024 | 429 | 0.6770 | 0.6064 | 0.6238 | 0.6117 | 0.6130 | 0.5871 |
| 2025 | 425 | 0.6768 | 0.6061 | 0.6124 | 0.6071 | 0.6034 | 0.5842 |
| 2026 | 369 | 0.6869 | 0.6374 | 0.6420 | 0.6368 | 0.6161 | 0.5999 |

The logistic model beats the opening line in 2021 and 2024 and is within 0.01 of it in 2019, 2023 and 2025 (the open
column covers the fights that have one). 2026 is the hardest test year for the frozen models, three years from
their training data; the refit variants use data through 2025.

**Calibration (2024+).** Each fight is counted from both sides; bins are on predicted p.

| Bin | Logistic: n sides, pred -> obs | ML blend: pred -> obs | Stack: pred -> obs |
|---|---|---|---|
| 0.1-0.2 | 51, 0.167 -> 0.157 | 0.179 -> 0.077 (26) | 0.168 -> 0.154 (78) |
| 0.2-0.3 | 204, 0.260 -> 0.191 | 0.261 -> 0.213 | 0.256 -> 0.195 |
| 0.3-0.4 | 444, 0.354 -> 0.288 | 0.353 -> 0.284 | 0.356 -> 0.303 |
| 0.4-0.5 | 524, 0.452 -> 0.445 | 0.450 -> 0.443 | 0.449 -> 0.437 |

The upper half mirrors this. The models are right about direction and too timid about size: in 2024+ the
favourites the models liked at 65% won 71%. A slope fit on the test year itself would be 1.36 for the logistic model
(log loss 0.6108 if applied) and 1.42 for the blend. The close needs only 1.06, the open 1.20, Elo 0.99. This is a
property of the period (2019-2023 OOF slopes are 0.91-1.01). The walk-forward version, which rescales each year by
the slope fit on the previous year, gives 2020-2023 OOF 0.64608 vs 0.64613 for the logistic model (a wash) and is
worse for the blend and the stack, so it is not adopted. It would have helped on 2024+ (blend 0.6159 vs 0.6176), and
the 2025 and 2026 rolling slopes of 1.5-1.6 show the shift. Keep it under watch at the yearly refit.

### 4. The hidden-data protocol's validation split (2024-2025, 854 fights)

| Model | Log loss [95% CI] | Accuracy |
|---|---|---|
| Elo | 0.6769 [0.6688, 0.6843] | 0.550 |
| Engine v3 (moe_engine_bt.json) | 0.6436 | 0.629 |
| moe.py feature logistic (its report) | 0.6133 | 0.678 |
| **Logistic** | **0.6062** [0.5912, 0.6217] | **0.678** |
| LightGBM | 0.6181 [0.6031, 0.6338] | 0.660 |
| ML blend | 0.6094 [0.5946, 0.6244] | 0.672 |
| Stack: Elo + ML + market rating | 0.5964 [0.5766, 0.6156] | 0.689 |
| Open / close (843-844 fights) | 0.6083 / 0.5857 | 0.673 / 0.692 |
| Open + ML / close + ML | 0.5874 / 0.5802 | 0.694 / 0.698 |

### 5. Against the market (1,182 test fights with both lines)

| Model | Log loss | Accuracy | Minus close [95% CI] | Minus open [95% CI] |
|---|---|---|---|---|
| Elo | 0.6796 | 0.551 | +0.0911 [0.0670, 0.1130] | +0.0690 [0.0501, 0.0887] |
| Logistic | 0.6110 | 0.671 | +0.0226 [0.0049, 0.0397] | +0.0005 [-0.0150, 0.0175] |
| LightGBM | 0.6215 | 0.661 | +0.0330 [0.0159, 0.0499] | +0.0110 [-0.0047, 0.0268] |
| ML blend | 0.6134 | 0.666 | +0.0249 [0.0081, 0.0418] | +0.0029 [-0.0119, 0.0188] |
| Market rating (pre-line) | 0.6311 | 0.652 | +0.0426 [0.0276, 0.0581] | +0.0206 [0.0086, 0.0335] |
| Stack: Elo + ML + market rating | 0.6016 | 0.684 | +0.0131 [-0.0010, 0.0275] | -0.0089 [-0.0229, 0.0051] |
| Opening line | 0.6105 | 0.671 | +0.0220 [0.0113, 0.0328] | 0 |
| Open + ML | 0.5931 | 0.693 | +0.0047 [-0.0042, 0.0141] | -0.0174 [-0.0234, -0.0113] |
| Closing line | 0.5885 | 0.699 | 0 | -0.0220 [-0.0328, -0.0113] |
| **Close + ML** | **0.5846** | **0.703** | **-0.0038** [-0.0062, -0.0014] | -0.0259 [-0.0373, -0.0146] |

The ML blend and the close agree closely (correlation of logits 0.77), and where they disagree, the close is much
nearer the truth. The side the ML model likes more than the market still outperforms its market price in every
band:

| \|ML - close\| | n | ML-favoured side won | Close said | ML said |
|---|---|---|---|---|
| < 0.05 | 341 | 0.446 | 0.458 | 0.484 |
| 0.05-0.10 | 288 | 0.417 | 0.378 | 0.451 |
| 0.10-0.15 | 265 | 0.343 | 0.329 | 0.453 |
| > 0.15 | 319 | 0.313 | 0.277 | 0.490 |

Above 5 points of disagreement, the side the ML model likes wins 1-4 points more often than its closing price says,
far less than the ML model claims. That is exactly what the close + ML weights (0.88 and 0.25) exploit. When the two
pick opposite favourites (245 fights), the ML pick wins 41%.

### 6. 7-bin outcome (1,229 test fights; 1,972 OOF)

| Model | OOF 2019-2023 | Test 2024+ |
|---|---|---|
| Corner-symmetric base rates (by rounds and sex) | 1.7387 | 1.7153 [1.6880, 1.7424] |
| Elo P(win) x base method split | 1.7309 | 1.7018 [1.6736, 1.7316] |
| Logistic P(win) x method softmax | 1.6292 | 1.5527 |
| Blend P(win) x method softmax | 1.6279 | 1.5547 |
| LightGBM P(win) x method LightGBM | 1.6343 | 1.5707 |
| Blend P(win) x method LightGBM | 1.6296 | 1.5630 |
| Direct multinomial logistic (both corner orders) | 1.6338 | 1.5596 |
| Ensemble (blend x softmax, blend x LightGBM, direct) | 1.6257 | 1.5549 |
| **Stack P(win) x method softmax** (recommended) | **1.6190** | **1.5443** [1.5066, 1.5824] |

The stack model minus base rates is -0.171 [-0.200, -0.143]. On the 1,183 test fights with method props, the market
scores 1.4983 and this model 1.5413. A 50/50 log-linear pool of the two scores 1.4991, so the props already contain
what the model knows about method.

The method model alone (P(KO/TKO, SUB, DEC) given the winner, softmax, C = 0.002) scores CV 0.9386 against 1.0184
for base rates. On test it predicts 34.0% KO/TKO, 17.0% SUB, 48.2% DEC and 0.8% draws, against 31.9 / 17.0 / 50.5 /
0.6 observed: KO/TKO is slightly over-predicted, because the 2024+ KO rate is below the training years'. P(finish)
by quintile, predicted -> observed: 0.32 -> 0.32, 0.44 -> 0.39, 0.51 -> 0.50, 0.58 -> 0.56, 0.69 -> 0.68.

### 7. What drives the predictions

- **Logistic, largest standardised coefficients:** judging-score Elo +0.123, age -0.120, strike-share Elo +0.109,
  takedown attempts per 15 +0.097, age past 30 -0.085, opponents' takedown attempts +0.080 (it partners the
  takedown defence and control-against terms), layoff over 450 days -0.079, years in the UFC -0.079, finish
  losses in the last 3 -0.078, control against -0.076, minutes per fight +0.071, head-strike matchup share
  +0.069, age at UFC debut -0.067, submission matchup share +0.062. Older at debut, longer in the UFC and older now
  are three separate, additive age penalties.
- **LightGBM gain by group:** margin Elo 20%, age 12%, striking rates 10%, grappling 9%, normalised matchup
  products 8%, matchup shares 6%, record 5%, accuracy and defence 4%, opponent quality 4%. Context (weight class,
  title, rounds, sex) gets under 0.3%: it changes how fights end, not who wins.

### 8. Where it works and where it does not (2024+, log loss)

| Subgroup | n | Elo | Logistic | ML blend | Close | ML accuracy |
|---|---|---|---|---|---|---|
| Men | 1,022 | 0.6815 | 0.6236 | 0.6249 | 0.5972 | 0.652 |
| Women | 201 | 0.6719 | 0.5754 | 0.5808 | 0.5535 | 0.721 |
| Men 145 lb and under | 386 | 0.6905 | 0.6248 | 0.6278 | 0.5966 | 0.650 |
| Men 155-185 lb | 474 | 0.6810 | 0.6143 | 0.6156 | 0.5853 | 0.667 |
| Men 205 lb and up | 162 | 0.6614 | 0.6478 | 0.6450 | 0.6338 | 0.611 |
| 3 rounds | 1,076 | 0.6809 | 0.6135 | 0.6152 | 0.5833 | 0.666 |
| 5 rounds, non-title | 96 | 0.6796 | 0.6322 | 0.6375 | 0.6346 | 0.615 |
| Title fights | 51 | 0.6604 | 0.6299 | 0.6326 | 0.6465 | 0.686 |
| A fighter with 1-2 UFC fights | 377 | 0.6887 | 0.6338 | 0.6351 | 0.5825 | 0.629 |
| Both 3-7 UFC fights | 517 | 0.6712 | 0.5989 | 0.5999 | 0.5854 | 0.704 |
| Both 8+ UFC fights | 329 | 0.6835 | 0.6212 | 0.6255 | 0.6058 | 0.638 |
| Elo gap < 50 | 766 | 0.6942 | 0.6278 | 0.6288 | 0.5980 | 0.649 |
| Elo gap 50-120 | 400 | 0.6631 | 0.5980 | 0.6022 | 0.5874 | 0.685 |
| Elo gap > 120 | 57 | 0.6055 | 0.5763 | 0.5754 | 0.4982 | 0.702 |

The gap to the close is mostly about newcomers: 0.051 when one man has only 1-2 UFC fights, 0.014 when both have
3-7. The market knows their regional records and the ML model does not, so pre-UFC data (tools/preufc.py) is the
most promising next feature. Heavyweights are hard for everyone. In 5-round and title fights the logistic model
matches or beats the close, on small samples.

## Stacking layer for the final product

### Design

- **Form.** Logit-linear pooling with no intercept: logit p = sum_i w_i logit p_i. Swapping the corners flips every
  input logit, so the stack is exactly corner-symmetric; with one input it is a symmetric Platt recalibration. The
  weights come from a lightly penalised logistic regression (lambda 0.001) on the 2019-2023 out-of-fold
  predictions, where every input is itself walk-forward. Leave-one-year-out inside 2019-2023 (fit on four years,
  score the fifth) is the honest tuning-period estimate; 2024+ uses the weights fit on all of 2019-2023.
- **Inputs available today.** Elo (backtest.json), the ML blend and its parts (this tool), engine v3
  P(A) / (P(A) + P(B)) (moe_engine_bt.json, 2019-2025, 100 simulations per corner order), and from market.json the
  pre-line market rating (Kalman filter on earlier closing lines and results; exists before any line is posted),
  the opening line (multiplicative de-vig) and the consensus closing line (power de-vig). A
  `data/derived/calibration.json` with per-fight engine probabilities and a `ratings.json` with per-fight rating
  probabilities are picked up automatically when they appear.
- **Three regimes for the product.** (1) Any matchup on the page, no line: Elo + ML + market rating (or Elo + ML
  when a fighter has no market history). (2) Fight week, opening line posted: open + ML. (3) Closing line: close + ML.
  A fight missing an input falls back to the next-smaller stack.

### Results (weights fit on 2019-2023 OOF; scored once on 2024+)

| Stack | Weights (logit scale) | OOF leave-one-year-out (ML alone, same rows) | Test n | Test log loss | Accuracy | Minus ML, same fights [95% CI] | Minus best single input [95% CI] |
|---|---|---|---|---|---|---|---|
| Elo + ML | Elo -0.03, ML 1.00 | 0.6469 (0.6465) | 1,223 | 0.6178 | 0.666 | +0.0002 [-0.0001, 0.0004] | same |
| Elo + logistic | Elo 0.02, logistic 0.93 | 0.6482 (0.6465) | 1,223 | 0.6178 | 0.666 | +0.0002 [-0.0023, 0.0028] | +0.0022 vs logistic |
| Elo + ML + engine v3 | Elo -0.03, ML 1.03, engine -0.05 | 0.6485 (0.6465) | 854 | 0.6103 | 0.673 | +0.0010 [0.0003, 0.0016] | same |
| Elo + engine v3 | Elo 0.49, engine 0.62 | 0.6742 (0.6465) | 854 | 0.6463 | 0.618 | +0.0369 [0.0260, 0.0476] | +0.0027 vs engine |
| **Elo + ML + market rating** (pre-line, recommended) | Elo -0.51, ML 0.74, rating 0.76 | **0.6392** (0.6461) | 1,213 | **0.6057** | 0.679 | **-0.0106** [-0.0183, -0.0028] | same |
| Elo + logistic + market rating (page) | Elo -0.48, logistic 0.68, rating 0.78 | 0.6401 (0.6461) | 1,213 | 0.6055 | 0.683 | -0.0109 [-0.0193, -0.0023] | -0.0086 [-0.0160, -0.0010] vs logistic |
| Elo + ML + engine + market rating | -0.51, 0.77, -0.06, 0.76 | 0.6406 (0.6461) | 844 | 0.5952 | 0.692 | -0.0123 [-0.0211, -0.0037] | same |
| Market rating alone | 1.10 | 0.6553 (0.6461) | 1,213 | 0.6324 | 0.647 | +0.0161 [0.0043, 0.0283] | |
| Open alone (recalibrated) | 1.13 | 0.6376 (0.6461) | 1,182 | 0.6088 | 0.671 | -0.0046 [-0.0224, 0.0127] | -0.0017 [-0.0041, 0.0006] vs raw open |
| **Open + ML** | open 0.80, ML 0.53 | 0.6302 (0.6461) | 1,182 | **0.5931** | 0.693 | -0.0203 [-0.0328, -0.0073] | **-0.0174** [-0.0234, -0.0113] vs open |
| Close alone (recalibrated) | 1.02 | 0.6233 (0.6461) | 1,213 | 0.5899 | 0.699 | -0.0265 [-0.0449, -0.0100] | -0.0002 vs raw close |
| **Close + ML** | close 0.88, ML 0.25 | 0.6223 (0.6461) | 1,213 | **0.5866** | 0.702 | -0.0297 [-0.0453, -0.0149] | **-0.0034** [-0.0059, -0.0010] vs close |
| Close + ML + engine + rating | 0.85, 0.29, -0.12, 0.10 | 0.6249 (0.6461) | 844 | 0.5808 | 0.693 | -0.0266 [-0.0435, -0.0110] | -0.0049 [-0.0086, -0.0012] vs close |

**Expected 2024+ gain of the stacking layer:**

| Regime | Without the layer | With the layer | Gain [95% CI] |
|---|---|---|---|
| No line | ML blend | Elo + ML + market rating | -0.0106 [-0.0183, -0.0028] log loss; accuracy 0.663 -> 0.679 |
| Opening line | Open | Open + ML | -0.0174 [-0.0234, -0.0113] |
| Closing line | Close | Close + ML | -0.0034 [-0.0059, -0.0010] |
| Vs Elo (no line) | Elo | Elo + ML + market rating | -0.0728 [-0.0899, -0.0549] |

The engine's weight is about zero, and slightly negative, in every stack. Engine v3 as it stands, with
100 simulations per corner order, scores 0.6463 even with Elo's help, against 0.6103 for Elo + ML on the same
fights, so it has nothing to add to the win probability. The negative Elo weight beside the market rating is
expected: both the ML model and the market rating already contain Elo-like information, and the stack removes the
double count.

## Page model: any matchup in JS

`ml.json` carries everything the page needs to score any two roster fighters without the backtest:

- `page_model.winner.terms`: the logistic model as a list of terms. Each term has a `type` (`logr`, `logit`, `lin`,
  `hinge`, `flag`, `share`, `stance`), the per-fighter key(s) it reads, its parameters, a raw-unit `coef` and its
  feature `group`. The model is refit on every decisive fight from 2010 to the snapshot with the CV-chosen penalty
  (the held-out numbers above are for the same specification fit on 2010-2023 only). `platt_slope` is the OOF Platt
  slope; p(A wins) = 1 / (1 + exp(-platt_slope * sum_j coef_j * term_j(A, B))). Swapping A and B gives exactly 1 - p.
- `page_model.method`: P(KO/TKO, SUB, DEC | that fighter wins) as a softmax over
  [side_block(winner), side_block(loser), context]; with `draw_rate` this turns p(A wins) into the 7 bins.
- `page_model.stack`: the product stack weights for `elo+lr+mkt_rating` (when both fighters have a market rating in
  market.json) and `elo+lr`, fit on 2019-2023 OOF predictions.
- `roster[slug]`: the per-fighter values as of the snapshot, plus `_dob`, `_last_fight`, `_prev_lbs`,
  `_lbs_fought` (so the page recomputes age, layoff, years in the UFC, weight-class move and new-class for the fight
  date and weight), and `mr_mu` / `mr_sd` (market rating) when market.json has one.
- `page_model.test_vectors`: seven matchups with the Python answer. The JS below reproduces them to 5e-5 (the vectors are
  stored to 4 decimals); `selfcheck_max_abs_logit_diff` checks the term evaluator against the training design.

Test vectors (fight on Nov 15, 2026, 5 rounds; P(A wins); these are checks for the JS, not forecasts):

| A vs B | Logistic (Platt) | Elo | Market rating | Page stack | 7 bins (A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO) |
|---|---|---|---|---|---|
| Volkanovski vs Gaethje, 155 | 0.652 | 0.592 | 0.633 | 0.667 | .261 .061 .325 .008 .160 .016 .169 |
| Makhachev vs Topuria, 155 | 0.634 | 0.677 | 0.665 | 0.639 | .157 .145 .327 .008 .100 .021 .242 |
| Aspinall vs Gane, 265 | 0.426 | 0.437 | 0.659 | 0.604 | .284 .058 .081 .008 .142 .070 .359 |
| Dvalishvili vs Yan, 135 | 0.518 | 0.473 | 0.414 | 0.458 | .042 .051 .421 .008 .319 .012 .148 |
| Pereira vs Ankalaev, 205 | 0.437 | 0.467 | 0.405 | 0.397 | .321 .015 .098 .008 .232 .060 .267 |
| Chimaev vs Du Plessis, 185 | 0.511 | 0.453 | 0.588 | 0.599 | .102 .130 .276 .008 .227 .045 .214 |
| Shevchenko vs Natalia Silva, 125 | 0.545 | 0.541 | 0.516 | 0.525 | .061 .053 .426 .008 .323 .023 .107 |

Two of these show what the stats see and miss. Aspinall has 23 career UFC minutes, so his rates sit near the
league prior and the logistic model has him as an underdog. The market rating, built from his betting lines, is
what lifts the stack to 0.60. For Volkanovski vs Gaethje every input favours Volkanovski: he absorbs 3.4
significant strikes a minute to Gaethje's 5.6, he brings a takedown threat, and he is higher on both margin Elos.
The Oct 24-25 openers had Gaethje at -180 to -200 (Volkanovski 37% no-vig, docs/BACKLOG.md). What the market is
pricing here (size, his two losses at 155) is outside what these features measure: the weight-move term is close
to zero (0.0014 logits per lb), in line with the durability analysis, which finds no size penalty after an Elo
control. Treat it as a real disagreement, and note that it is the kind the closing-line test says the market
usually wins.

```js
// model = ml.page_model, roster = ml.roster, fight = {date: "2026-11-15", lbs: 155, five: 1, title: 0, women: 0, catch: 0}
function mlSides(fx, fight, snapshot) {
  const v = Object.assign({}, fx), DAY = 86400000;
  const d = Date.parse(fight.date), snap = Date.parse(snapshot);
  v.age = fx._dob ? (d - Date.parse(fx._dob)) / DAY / 365.25 : null;
  if (fx._last_fight) { v.layoff = Math.round((d - Date.parse(fx._last_fight)) / DAY); v.log_layoff = Math.log1p(v.layoff); }
  v.years_ufc = fx.years_ufc + Math.round((d - snap) / DAY) / 365.25;
  v.wc_move = (fight.lbs && fx._prev_lbs) ? fight.lbs - fx._prev_lbs : 0;
  v.new_class = (fight.lbs && fx._lbs_fought && fx._lbs_fought.length && !fx._lbs_fought.includes(fight.lbs)) ? 1 : 0;
  return v;
}
const clampP = p => Math.min(Math.max(p, 1e-4), 1 - 1e-4);
const logit = p => Math.log(clampP(p) / (1 - clampP(p)));
const miss = x => x === null || x === undefined;
function mlTerm(t, a, b) {
  switch (t.type) {
    case "logr": return Math.log(a[t.key] + t.eps) - Math.log(b[t.key] + t.eps);
    case "logit": return logit(a[t.key]) - logit(b[t.key]);
    case "lin": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : (a[t.key] - b[t.key]) * t.scale;
    case "hinge": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : Math.max(a[t.key] - t.h, 0) - Math.max(b[t.key] - t.h, 0);
    case "flag": return (miss(a[t.key]) || miss(b[t.key])) ? 0 : (a[t.key] > t.t) - (b[t.key] > t.t);
    case "share": { const ea = a[t.u] * b[t.v], eb = b[t.u] * a[t.v]; return 0.5 * (ea - eb) / (ea + eb + 1e-12); }
    case "stance": return a.southpaw * b.orthodox - b.southpaw * a.orthodox;
  }
  throw new Error("unknown term " + t.type);
}
function mlSideBlock(v, M) {
  const sb = M.side_block, out = [];
  for (const k of sb["log(x+eps)"]) out.push(Math.log(v[k] + sb.eps));
  for (const k of sb["logit(x)"]) out.push(logit(v[k]));
  for (const k of sb["x"]) out.push(v[k]);
  for (const k of sb["x/100"]) out.push(v[k] / 100);
  const age = miss(v.age) ? 30 : v.age;
  out.push(age, Math.max(age - 30, 0));
  return out;
}
function mlPredict(model, roster, slugA, slugB, fight) {
  const a = mlSides(roster[slugA], fight, model.snapshot), b = mlSides(roster[slugB], fight, model.snapshot);
  let z = 0;
  for (const t of model.winner.terms) z += t.coef * mlTerm(t, a, b);
  const pLR = 1 / (1 + Math.exp(-z));                                   // raw logistic (stack input)
  const pA = 1 / (1 + Math.exp(-z * model.winner.platt_slope));
  const M = model.method, ctx = [fight.lbs / 100, fight.women || 0, fight.five || 0, fight.title || 0, fight.catch || 0];
  const meth = (w, l) => {                                              // [KO/TKO, SUB, DEC | this fighter wins]
    const x = mlSideBlock(w, M).concat(mlSideBlock(l, M), ctx);
    const lg = M.coef.map((row, k) => M.intercept[k] + row.reduce((s, c, j) => s + c * x[j], 0));
    const mx = Math.max(...lg), e = lg.map(v => Math.exp(v - mx)), s = e.reduce((p, q) => p + q, 0);
    return e.map(v => v / s);
  };
  const mA = meth(a, b), mB = meth(b, a), pD = model.draw_rate, q = 1 - pD;
  const bins = [q*pA*mA[0], q*pA*mA[1], q*pA*mA[2], pD, q*(1-pA)*mB[2], q*(1-pA)*mB[1], q*(1-pA)*mB[0]];
  const pElo = 1 / (1 + Math.pow(10, (b.elo - a.elo) / 400));
  const haveMR = !miss(a.mr_mu) && !miss(b.mr_mu), st = (model.stack || {})[haveMR ? "elo+lr+mkt_rating" : "elo+lr"];
  let pStack = null;
  if (st) {
    const inp = { elo: pElo, lr: pLR, mkt_rating: haveMR ?
      1 / (1 + Math.exp(-(a.mr_mu - b.mr_mu) / Math.sqrt(1 + Math.PI * (a.mr_sd ** 2 + b.mr_sd ** 2) / 8))) : null };
    pStack = 1 / (1 + Math.exp(-st.inputs.reduce((s, k, i) => s + st.weights[i] * logit(inp[k]), 0)));
  }
  const binsStack = pStack === null ? null :           // recommended 7 bins: stack P(win) x method softmax
    [q*pStack*mA[0], q*pStack*mA[1], q*pStack*mA[2], pD, q*(1-pStack)*mB[2], q*(1-pStack)*mB[1], q*(1-pStack)*mB[0]];
  return { pA, pLR, pElo, pStack, bins, binsStack };  // bins order: A KO/TKO, A SUB, A DEC, draw, B DEC, B SUB, B KO/TKO
}
```

## Recommendation for the final ensemble (v9)

1. **Winner probability with no line (the page, any matchup): the Elo + ML + market-rating stack.** On 2024+ it
   is the best pre-line number this project has: 0.6057 on 1,213 fights, 0.0106 [0.0028, 0.0183] better than the
   ML blend and 0.073 better than Elo. On the page use `page_model.stack["elo+lr+mkt_rating"]` (logistic instead
   of the blend, 0.6055 on test) with `binsStack` for the 7 bins, and `elo+lr` when either fighter has no market
   rating. The Elo weight is negative because Elo is already inside both other inputs; that is expected.
2. **Once a line exists, stack it with the ML probability, not the other way round.** Open + ML beats the open by
   0.0174 [0.0113, 0.0234]; close + ML beats the close by 0.0034 [0.0010, 0.0059]; both intervals exclude zero.
   Weights are in `results.stacking.variants`.
3. **Do not average the engine's win probability into the product yet.** Engine v3 (moe_engine_bt.json) gets a
   weight of about zero next to the ML blend and makes the stack slightly worse on the 854 fights it covers. Use
   the engine for how the fight goes (methods, rounds, stat lines, the 3D replay) and anchor it to the stack:
   choose the engine's per-matchup skill offset so its P(A wins) matches the stack, and let it distribute that
   probability over methods and rounds. Re-test when the calibrated engine writes per-fight probabilities.
4. **7 bins: P(win) from the stack times P(method | winner) from the method softmax** (`stack_fact`), or the
   ensemble, whichever `results.seven.recommended` names after a re-run; when the market's method props exist,
   they are better still (1.4983 vs 1.5413 on the same fights, and pooling the two gains nothing).
5. **No Platt or isotonic layer on top.** OOF slopes are 0.91-1.01, and on 2024+ Platt (-0.0002) and isotonic
   (+0.0001) change nothing. The walk-forward yearly temperature did not help on 2020-2023 and is not adopted.
   Re-check it at each refit, because the slopes fit on 2024 and 2025 (1.5-1.6) say the current models are too
   timid.
6. **Refit every January with frozen hyperparameters** (the `*_refit` rows; refitting beat a frozen model by 0.0026
   on 2019-2023), and re-tune once a year on a moving window that never touches the vault.
7. **Keep the logistic model as the backbone.** It is the best single model on held-out data, it is what the page
   evaluates, and it holds up at least as well as the trees as the training data age (2026 row of the by-year table).
   The trees help a little out of fold (blend 0.6467 vs 0.6479) but not on 2024+ (+0.0020 [-0.0006, 0.0046]), so
   the blend is optional. Use it where Python runs, and the logistic model on the page.
8. **Next data, in order of expected value:** pre-UFC records for newcomers (the gap to the close is 0.051 log loss
   when a fighter has 1-2 UFC fights and 0.014 when both have 3-7); the calibrated engine's per-fight
   probabilities (`calibration.json`) and tools/ratings.py's per-fight ratings (`ratings.json`), which
   `load_external()` picks up when present (re-run `--stage2`; check the field names against the final formats);
   opponent-adjusted rates from tools/oppadj.py as features; then refit the stack weights.

## Caveats

- **2024+ is an easier period than 2019-2023 for everyone.** The closing line goes from 0.624 (tune) to 0.590 (test),
  and the ML blend moves about as much. Compare models on the same fights, never across periods or with other
  projects' numbers from other years.
- **Models are under-confident in 2024+** (calibration slope 1.25-1.40 for the ML models, 1.06 for the close).
  Nothing fit on 2019-2023 can see this (OOF Platt slopes 0.91-1.01), and the test-fit slope is reported only as a
  diagnostic. The rolling-temperature rule is the walk-forward way to track it.
- **Engine inputs.** moe_engine_bt.json is engine v3.0.0 at 100 simulations per corner order (Monte Carlo noise
  about 0.035 in p), it covers 2019-2025 only, and the engine's parameters were self-calibrated with 2019-2023 in
  view, so its 2019-2023 stacking weight is if anything optimistic. Re-fit the stack when the calibrated engine
  writes per-fight probabilities.
- **Page model limits.** Per-fighter values are shrunk toward the fighter's own home division, not the fight's
  (immaterial for experienced fighters). The logistic model reads finishing speed through minutes per fight, so
  fighters whose few UFC fights were all quick wins (Tom Aspinall: 23 career UFC minutes) are under-rated; the
  stack's market-rating input is what corrects them. Age, layoff and weight move are recomputed for the fight date,
  everything else is as of Oct 31, 2026.
- **Tale-of-the-tape values are current, not historical.** Height, reach and DOB do not change; stance can, and a
  few fighters switched. Their missingness is handled as above.
- **Not used:** the A/B order (a real pre-fight signal: the first-named fighter, usually the red corner, won 55.1% of
  decisive 2024+ fights, but it means nothing for a hypothetical matchup), pre-UFC records
  (data/derived/preufc.json covers 258 of 1,711 targets so far), fight-week context, and opponent-adjusted rates
  from tools/oppadj.py (not yet available as per-fight features).

## Reproduce

```
python3 tools/ml.py                # full run: features, CV on 2010-2023, final fits, stacking, 7 bins, export
python3 tools/ml.py --stage2       # redo stacking / 7-bin / evaluation / export from out/ml_cache/stage1.pkl
python3 tools/ml.py --stage2 --page-only   # redo only the page model and the export
python3 tools/ml.py --quick        # small tree searches (development)
python3 tools/ml.py --direct7-gbm  # also fit a direct 7-class LightGBM (slow; not part of the reported run)
```

Python 3.13 with numpy, pandas, scipy, scikit-learn 1.9, lightgbm 4.7 and xgboost 3.4. BLAS is pinned to one thread
(the box is shared); the tree searches fork `--jobs` workers (default 4). Every number in this file is stored in
`data/derived/ml.json` (`results`, `tuning`), so the page and other agents can read them rather than this text.
