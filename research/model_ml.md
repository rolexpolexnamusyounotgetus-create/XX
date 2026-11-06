# ML benchmark and stacking layer (task key: ml)

Tool: `tools/ml.py`. Output: `data/derived/ml.json`. Built Nov 6, 2026 from the ufcstats snapshot through
Oct 31, 2026 (`data/raw/`), with `tools/build_db.py`'s loaders, people resolution and walk-forward Elo. Market
and engine inputs for the stacking layer come from `data/derived/market.json` (tools/market.py) and
`data/derived/moe_engine_bt.json` (engine v3 via tools/moe_engine_bt.js). Everything is chosen on 2010-2023 and
scored once on the hidden-data protocol's validation years, **2024-01-01..2025-12-31**. Fights from 2026-01-01 (the
vault) are never scored or fit on. Every number below is stored in `ml.json` (`results`, `tuning`).

**Corrected Nov 6 by an adversarial review (see the Verification log at the end).** The first version scored
"test" as 2024-01-01..2026-10-31, which took in the 2026 vault fights, fit the page model through the snapshot,
and quoted figures from an earlier run that the final `ml.json` no longer matched. All results below are
2024-2025 only (854 decisive fights instead of 1,223), regenerated from the corrected `ml.json`. No model, feature
or weight changed: they were all chosen on 2010-2023, and every per-fight prediction for 2019-2025 is identical to
the first build. The page model is now refit on fights before 2026 only.

## Bottom line

- **The logistic model is the strongest single predictor in the project.** On the 854 decisive 2024-2025 fights,
  trained on 2010-2023 only, it scores log loss **0.6062** [95% CI 0.5902, 0.6230], Brier 0.2088, accuracy
  **67.9%** [64.8, 70.6], AUC 0.744. Walk-forward Elo scores 0.6769 and 55.0%, so the gain is **0.071**
  [0.054, 0.087]. XGBoost (0.6139) and LightGBM (0.6166) beat Elo comfortably but lose to the logistic model
  (LightGBM by 0.0104 [0.0029, 0.0176]). The OOF-weighted blend (logistic 0.55, XGBoost 0.30, LightGBM 0.13) scores
  0.6091, statistically tied with the logistic model alone (+0.0029 [-0.0007, 0.0061]). Other models on the same
  fights: engine v3 0.6436, moe's feature logistic 0.6133 (its report), the market rating 0.6259 (845 fights).
- **Against the market** (843 fights with both an opening and a closing line): the close scores 0.5854 and the
  open 0.6094. The logistic model **ties the opening line** (-0.0055 [-0.0221, 0.0109]) and sits 0.018
  [0.001, 0.038] behind the close. Nothing else available before a line is posted comes close on its own.
- **The stacking layer adds held-out value.** Weights are fit on 2019-2023 out-of-fold predictions.
  - No line yet: Elo + ML + market rating scores **0.5935** on 845 fights, 0.0135 [0.0047, 0.0221] better than
    the ML blend on the same fights. It is 0.016 [0.001, 0.031] ahead of the opening line (the upper end of the
    interval is close to zero, so treat it as a tie with a lean) and 0.008 [-0.006, 0.023] behind the close.
  - Opening line posted: open + ML beats the open by **0.0209** [0.0143, 0.0273].
  - Closing line: close + ML beats the close by **0.0055** [0.0026, 0.0080], so the stats carry information the
    closing line has not fully priced. It is one of two close-plus-stats stacks in the code; the other
    (close + ML + engine + rating) gives 0.0049 [0.0012, 0.0086].
  - Engine v3 adds nothing next to the ML blend: its weight is -0.05, and including it costs 0.0009
    [0.0003, 0.0015] on its 854 fights.
- **7 bins** (A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO): P(win) from the stack times a softmax for the method
  given the winner scores **1.5245** [1.4857, 1.5666] on 857 fights. Corner-symmetric base rates score 1.6985 and Elo
  with base method splits 1.6818; the best published figure is 1.60-1.62 (FightLab, research/modeling_literature.md),
  on other years. The market's method props score 1.5012 against 1.5238 for this model on the same 830 fights
  (+0.023 [-0.007, 0.050], not significant), and a 50/50 log-linear pool of the two scores 1.4922 (-0.009
  [-0.024, +0.005] against the props).
- **A leak was found and removed before the final run.** A missing reach in ufcstats' tale of the tape marks
  fighters who were cut early: that side lost 94.5% of 403 fights in 2010-2018. The tree models had learned the
  pattern. It barely touches the evaluation years (one 2019-2023 backtest fight and one 2024-2025 backtest fight have
  exactly one missing reach), but the leak made the trees' CV look better than it was. See Leakage checks.
- **Calibration.** Out-of-fold slopes are 0.93-1.00, so no recalibration layer is adopted. All the ML models are
  under-confident in 2024-2025 (slope 1.43-1.59; the close needs 1.11 and the open 1.31): the period is more
  predictable for every model, the market included. A walk-forward yearly temperature does not help on the
  2020-2023 OOF years, so it is not adopted, but it does help on 2024-2025 (blend -0.0073 [-0.0138, -0.0005]); see
  section 3.

## Method

### Data and protocol

- Source: the ufcstats snapshot in `data/raw/` (through Oct 31, 2026), parsed by `tools/build_db.py`'s own loaders, so
  fight ids, people, aliases and Elo are identical to the rest of the pipeline. Walk-forward Elo (K 44, boost 1.5)
  matches `backtest_dev.json`, and on all 2,864 dev fights the fighter slugs, results, UFC fight counts, Elo, age and
  KO losses in this tool's table agree with `backtest_dev.json`'s independent snapshots (zero mismatches).
- Rows: every UFC fight from 2010-01-01 (fights involving an unresolved `amb:` person are dropped; none of the dev
  backtest fights is). Each side's features are computed from that fighter's earlier UFC fights only, at the fight
  date. Shrinkage targets are division league rates from the 5 years before Jan 1 of the fight's year.
- Tuning: everything (features, penalties, tree hyperparameters, group selection, blend and stack weights,
  recalibration) is chosen inside 2010-2023. Time-ordered CV = expanding window with four validation blocks
  (2016-17, 2018-19, 2020-21, 2022-23), each trained on all earlier years from 2010; validation rows are fights where
  both men had a prior UFC fight (the backtest definition).
- Out-of-fold (OOF) 2019-2023: annual expanding refits (train 2010..Y-1, predict Y). These feed the ML blend,
  Platt / isotonic recalibration and the stacking layer.
- Validation (the "test" columns below; `results.eval.test_2024_plus` keeps its key name for build.py): every
  backtest_dev fight from 2024-01-01 to 2025-12-31 (854 decisive, 857 for 7 bins), predicted once by models trained on
  2010-2023. `*_refit` rows show the production policy (retrain each January with frozen hyperparameters: 2025 from
  <= 2024). Per the protocol these years may be used for version selection, so they are not a pristine test: the
  first build's tree leak was found after a look at them (the logistic model was never changed after a look).
- Vault: fights from 2026-01-01. Stage two moves them out before any fit or score (`split_vault` in tools/ml.py).
  Their pre-fight predictions (frozen 2010-2023 models and the <= 2025 refits), without results, go to
  `ml_vault.json` in the vault directory outside the repository for the milestone auditor. The raw parse still reads
  2026 bouts to keep the roster's live state current (records, Elo, layoff for the page), as tools/market.py does for
  its live ratings; no 2026 result reaches a fit, a choice or a score.
- Corner symmetry: the A/B position is never a feature (A won 55-57% of decisive fights). The logistic model uses only
  antisymmetric A-minus-B terms with no intercept, so p(B beats A) = 1 - p(A beats B) exactly. Trees and
  multinomial models train on both corner orders (labels mirrored) and average the two orientations at prediction.
  The run stops unless the swapped logistic design is exactly -X and the swapped tree design equals the flipped one.
- Metrics: log loss, Brier, accuracy (a 0.5 prediction counts half), AUC, symmetric ECE (each fight counted from both
  sides), calibration slope (logistic regression of the result on logit p, fit on both corner orientations), 7-bin
  log loss. Draws and no-contests are excluded from winner metrics; DQ and NC from 7-bin metrics. CIs are 95%
  event-cluster bootstrap intervals (2,000 resamples of UFC cards; 500 for the market and stacking differences), and
  differences are paired on the same fights.

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
- **Self-leak test (verification).** For three event dates (2024-02-24, 2024-12-07, 2025-11-15), the winner of every
  fight on or after the date was flipped and the two stat lines swapped; Elo and both margin Elos were recomputed and
  the table rebuilt. Every row dated on or before the date is unchanged (0 cells differ), while for the first two
  dates 56-75% of later rows change, as they should (the third date has only four weeks of later fights, none with a
  perturbed earlier bout). No feature uses the fight it describes.
- **Independent recomputation.** Elo, fight counts, age and KO losses match `backtest_dev.json`, which
  `tools/build_db.py` builds with separate code (see Data and protocol). A fresh sklearn refit of the logistic
  specification reproduces this tool's 2024-2025 log loss (0.60625, max per-fight difference 1e-4), and a fresh
  LightGBM fit with another seed scores 0.6152 against 0.6166 (correlation 0.993).
- **Leak found: missing tale-of-the-tape values.** ufcstats' height, reach, DOB and stance are a current snapshot,
  and a missing value is not random. In 2010-2018 rows where exactly one fighter had no reach on file, that
  fighter lost 94.5% of 403 fights: fighters cut after a short UFC run often never got a reach entry, so the
  missing value encodes the rest of their career. LightGBM sends NaN down its own branch, and in the first run
  absolute reach became its top feature (25% of gain). The evaluation years barely contain the pattern (one
  2019-2023 backtest fight; in 2024-2025, 11 fights of which one is a backtest fight), so the held-out scores were
  not inflated by it, but the trees were learning a rule that no longer holds. Fix: the trees see size only as
  A-minus-B differences (0 when either value is missing, so no direction), no absolute height or reach, a missing
  DOB takes the opponent's age, stance flags come from the stance string alone, and the method model has no ape
  term. The logistic model was already immune (differences only, 0 when either side is missing). **Other models in
  the project that give raw `height_in` / `reach_in` with NaN to a tree should do the same** (tools/moe.py's
  `SIDE_NUM` feeds them to its feature GBM).
- **Earlier verification fixes kept in the code** (a first reviewer, cut off before writing a log): the judging
  weights of the judge-score Elo now come from an EM round model fit on decisions before 2023 only (the first build
  used a fit that included 2024-2026 rounds); the matchup-share term is now exactly antisymmetric (the first form
  left a sign of the row's orientation that the trees could read); calibration slopes are fit on mirrored data; and
  the OOF years of the stack-based 7-bin model use the leave-one-year-out stack.

## Results

### 1. Tuning inside 2010-2023

**Logistic model.** The grid covered L2 penalties 0.01-0.5, training on all fights vs only fights where both men
had fought in the UFC before, and an optional 8-year recency weight. All fights, no recency weight, penalty 0.1
won with CV log loss 0.6477. Training only on experienced pairs scored 0.6483 and the recency weight 0.6484.

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
judging-weight score share (K 160, w 0.9) gives 0.6660. On 2024-2025 they score 0.6637 and 0.6577 against 0.6769:
-0.0132 [-0.0252, -0.0013] and -0.0192 [-0.0317, -0.0077]. A rating that sees how fights were won is
substantially better than one that sees only who won.

**Trees.** LightGBM (8 random configurations x 4 blocks, learning rate 0.04, rounds chosen on the CV curve) is
flat across configurations: 0.6467-0.6481. The best has 7 leaves, at least 160 rows per leaf, feature fraction 0.6,
bagging 0.7, L2 60 and 250 rounds. XGBoost (4 configurations) ranges 0.6471-0.6486; the best has depth 4, min child
weight 60, colsample 0.4, lambda 50 and 300 rounds.

**Blend and refits.** The blend weights are non-negative logit weights fit on 2019-2023 OOF: logistic 0.546,
XGBoost 0.304, LightGBM 0.126 (the unconstrained fit is the same to three decimals). Leave-one-year-out log loss of
the blend is 0.6471, against 0.6479 for the logistic model's OOF. Refitting every year beats a model frozen at the
end of 2018 on 2019-2023 (0.6479 vs 0.6506), which is the evidence for the January-refit policy.

### 2. Out-of-fold 2019-2023 (1,955 decisive backtest fights)

| Model | Log loss | Brier | Accuracy | AUC | ECE | Slope |
|---|---|---|---|---|---|---|
| Elo | 0.6857 | 0.2464 | 0.550 | 0.545 | 0.014 | 0.78 |
| Strike-share Elo | 0.6729 | 0.2400 | 0.590 | 0.599 | 0.025 | 0.91 |
| Judging-score Elo | 0.6767 | 0.2417 | 0.592 | 0.597 | 0.025 | 0.77 |
| Logistic | 0.6479 | 0.2283 | 0.618 | 0.663 | 0.011 | 0.94 |
| LightGBM | 0.6496 | 0.2291 | 0.618 | 0.660 | 0.013 | 0.96 |
| XGBoost | 0.6494 | 0.2289 | 0.621 | 0.661 | 0.009 | 0.93 |
| ML blend | 0.6465 | 0.2277 | 0.624 | 0.665 | 0.004 | 1.00 |
| Stack: Elo + ML + market rating | 0.6372 | 0.2235 | 0.637 | 0.679 | 0.006 | 1.01 |

The blend and stack rows are in-sample for their few weights (the leave-one-year-out figures are 0.6471 and
0.6395). Platt and isotonic rows are in ml.json but are in-sample by construction here, so they are judged on
2024-2025 only.

### 3. Validation 2024-01-01..2025-12-31 (854 decisive fights; models trained on 2010-2023)

| Model | Log loss [95% CI] | Brier | Accuracy [95% CI] | AUC | ECE | Slope | Minus Elo [95% CI] |
|---|---|---|---|---|---|---|---|
| Elo (backtest) | 0.6769 [0.6684, 0.6854] | 0.2421 | 0.550 [0.522, 0.579] | 0.581 | 0.021 | 1.13 | 0 |
| Strike-share Elo | 0.6637 [0.6522, 0.6749] | 0.2357 | 0.589 [0.559, 0.619] | 0.629 | 0.009 | 1.14 | -0.0132 [-0.0252, -0.0013] |
| Judging-score Elo | 0.6577 [0.6448, 0.6706] | 0.2328 | 0.619 [0.587, 0.653] | 0.647 | 0.026 | 1.18 | -0.0192 [-0.0317, -0.0077] |
| **Logistic** | **0.6062** [0.5902, 0.6230] | 0.2088 | **0.679** [0.648, 0.706] | 0.744 | 0.055 | 1.54 | **-0.0707** [-0.0872, -0.0535] |
| LightGBM | 0.6166 [0.6010, 0.6329] | 0.2135 | 0.657 [0.628, 0.685] | 0.727 | 0.048 | 1.43 | -0.0603 [-0.0757, -0.0447] |
| XGBoost | 0.6139 [0.5981, 0.6304] | 0.2122 | 0.664 [0.635, 0.692] | 0.730 | 0.057 | 1.44 | -0.0630 [-0.0785, -0.0471] |
| ML blend | 0.6091 [0.5937, 0.6250] | 0.2100 | 0.672 [0.641, 0.699] | 0.742 | 0.057 | 1.59 | -0.0678 [-0.0830, -0.0519] |
| ML blend, Platt (OOF) | 0.6089 [0.5935, 0.6249] | 0.2099 | 0.672 | 0.742 | 0.057 | 1.59 | -0.0680 |
| ML blend, isotonic (OOF) | 0.6069 [0.5907, 0.6234] | 0.2090 | 0.677 | 0.742 | 0.057 | 1.57 | -0.0701 |
| Logistic, annual refit | 0.6057 [0.5894, 0.6224] | 0.2086 | 0.677 | 0.744 | 0.051 | 1.51 | -0.0712 |
| LightGBM, annual refit | 0.6161 [0.5996, 0.6329] | 0.2133 | 0.663 | 0.726 | 0.046 | 1.39 | -0.0608 |
| ML blend, annual refit | 0.6090 [0.5930, 0.6251] | 0.2100 | 0.677 | 0.740 | 0.053 | 1.55 | -0.0679 |
| **Stack: Elo + ML + market rating** | **0.5958** [0.5761, 0.6165] | 0.2044 | **0.684** [0.654, 0.712] | 0.753 | 0.046 | 1.47 | **-0.0811** [-0.1009, -0.0596] |
| Engine v3 (moe_engine_bt.json) | 0.6436 | | 0.631 | | | | |
| Opening line / closing line (843 / 845 fights) | 0.6094 / 0.5854 | | 0.668 / 0.692 | | | | |

Paired differences (event-cluster bootstrap): LightGBM - logistic +0.0104 [0.0029, 0.0176]; blend - logistic
+0.0029 [-0.0007, 0.0061]; blend - LightGBM -0.0075 [-0.0118, -0.0032]; isotonic - raw blend -0.0023
[-0.0046, 0.0001]; Platt - raw blend -0.0002 [-0.0003, -0.0001]; annual refit - frozen blend -0.0002
[-0.0015, 0.0010]; stack - blend -0.0133 [-0.0219, -0.0039]. The stack row uses the Elo + ML stack for the 9 fights
without a market rating. moe.py's feature logistic scores 0.6133 on these fights (its report).

**By year** (log loss; 2019-2023 are OOF, 2024-2025 frozen models):

| Year | n | Elo | Logistic | LightGBM | ML blend | Open | Close |
|---|---|---|---|---|---|---|---|
| 2019 | 388 | 0.6984 | 0.6552 | 0.6637 | 0.6563 | 0.6512 | 0.6319 |
| 2020 | 343 | 0.6841 | 0.6514 | 0.6430 | 0.6456 | 0.6345 | 0.6303 |
| 2021 | 415 | 0.6813 | 0.6464 | 0.6478 | 0.6454 | 0.6546 | 0.6393 |
| 2022 | 419 | 0.6794 | 0.6440 | 0.6451 | 0.6426 | 0.6140 | 0.6018 |
| 2023 | 390 | 0.6860 | 0.6436 | 0.6480 | 0.6429 | 0.6346 | 0.6142 |
| 2024 | 429 | 0.6770 | 0.6064 | 0.6241 | 0.6120 | 0.6151 | 0.5872 |
| 2025 | 425 | 0.6768 | 0.6061 | 0.6091 | 0.6062 | 0.6035 | 0.5835 |

The logistic model beats the opening line in 2021 and 2024 and is within 0.01 of it in 2019, 2023 and 2025 (the open
column covers the fights that have one).

**Calibration (2024-2025).** Each fight is counted from both sides; bins are on predicted p.

| Bin | Logistic: n sides, pred -> obs | ML blend: pred -> obs | Stack: pred -> obs |
|---|---|---|---|
| 0.1-0.2 | 32, 0.166 -> 0.125 | 0.181 -> 0.056 (18) | 0.167 -> 0.102 (49) |
| 0.2-0.3 | 139, 0.263 -> 0.166 | 0.265 -> 0.183 | 0.257 -> 0.160 |
| 0.3-0.4 | 299, 0.352 -> 0.268 | 0.354 -> 0.254 | 0.356 -> 0.294 |
| 0.4-0.5 | 384, 0.452 -> 0.435 | 0.451 -> 0.457 | 0.450 -> 0.445 |

The upper half mirrors this. The models are right about direction and too timid about size: in 2024-2025 the
favourites the logistic model liked at 65% won 73%. A slope fit on the validation years themselves would be 1.54 for
the logistic model (log loss 0.5961 if applied) and 1.59 for the blend; the close needs 1.11, the open 1.31, Elo 1.13.
This is a property of the period (2019-2023 OOF slopes are 0.93-1.00). The walk-forward version, which rescales each
year by the slope fit on the previous year, gives 2020-2023 OOF 0.64610 vs 0.64615 for the logistic model (a wash)
and is worse for the blend and the stack, so by the rule fixed before the run it is not adopted (`adopt` now also
requires a gain above 0.0005). On 2024-2025 it helps: logistic 0.6018 (-0.0045 [-0.0115, 0.0031]), blend 0.6019
(-0.0073 [-0.0138, -0.0005]), stack 0.5882 (-0.0076 [-0.0150, 0.0010]); the 2025 slope, fit on 2024, is 1.57. That
is the protocol's version-selection evidence for a future version, to be confirmed on the vault, not a result.

### 4. Against the market (843 validation fights with both lines)

| Model | Log loss | Accuracy | Minus close [95% CI] | Minus open [95% CI] |
|---|---|---|---|---|
| Elo | 0.6770 | 0.548 | +0.0916 [0.0671, 0.1152] | +0.0676 [0.0490, 0.0866] |
| Logistic | 0.6038 | 0.680 | +0.0184 [0.0007, 0.0384] | -0.0055 [-0.0221, 0.0109] |
| LightGBM | 0.6152 | 0.657 | +0.0298 [0.0121, 0.0498] | +0.0059 [-0.0093, 0.0208] |
| ML blend | 0.6072 | 0.673 | +0.0218 [0.0038, 0.0410] | -0.0022 [-0.0180, 0.0127] |
| Market rating (pre-line) | 0.6259 | 0.655 | +0.0404 [0.0231, 0.0556] | +0.0165 [0.0027, 0.0292] |
| Stack: Elo + ML + market rating | 0.5937 | 0.686 | +0.0083 [-0.0063, 0.0233] | -0.0157 [-0.0308, -0.0013] |
| Opening line | 0.6094 | 0.668 | +0.0239 [0.0122, 0.0363] | 0 |
| Open + ML | 0.5884 | 0.693 | +0.0030 [-0.0079, 0.0144] | -0.0209 [-0.0273, -0.0143] |
| Closing line | 0.5854 | 0.693 | 0 | -0.0239 [-0.0363, -0.0122] |
| **Close + ML** | **0.5800** | **0.699** | **-0.0055** [-0.0080, -0.0026] | -0.0294 [-0.0404, -0.0179] |

Market inputs are market.json's (outcome-blind cleaning of in-play closing ranges, exchanges excluded; see
research/model_market.md). The ML blend and the close agree closely (correlation of logits 0.76), and where they
disagree, the close is much nearer the truth. The side the ML model likes more than the market still does at least
as well as its closing price in every band above 5 points:

| \|ML - close\| | n | ML-favoured side won | Close said | ML said |
|---|---|---|---|---|
| < 0.05 | 235 | 0.438 | 0.450 | 0.477 |
| 0.05-0.10 | 207 | 0.420 | 0.384 | 0.458 |
| 0.10-0.15 | 179 | 0.330 | 0.328 | 0.450 |
| > 0.15 | 224 | 0.353 | 0.281 | 0.495 |

Above 5 points of disagreement, the side the ML model likes wins 0-7 points more often than its closing price says,
far less than the ML model claims. That is what the close + ML weights (0.88 and 0.25) exploit. When the two pick
opposite favourites (160 fights), the ML pick wins 45%.

### 5. 7-bin outcome (857 validation fights; 1,972 OOF)

| Model | OOF 2019-2023 | Validation 2024-2025 |
|---|---|---|
| Corner-symmetric base rates (by rounds and sex) | 1.7387 | 1.6985 [1.6715, 1.7274] |
| Elo P(win) x base method split | 1.7309 | 1.6818 [1.6536, 1.7119] |
| Logistic P(win) x method softmax | 1.6292 | 1.5347 |
| Blend P(win) x method softmax | 1.6280 | 1.5376 |
| LightGBM P(win) x method LightGBM | 1.6329 | 1.5477 |
| Blend P(win) x method LightGBM | 1.6297 | 1.5403 |
| Direct multinomial logistic (both corner orders) | 1.6338 | 1.5440 |
| Ensemble (blend x softmax, blend x LightGBM, direct) | 1.6257 | 1.5365 |
| **Stack P(win) x method softmax** (recommended; OOF uses the leave-one-year-out stack) | **1.6211** | **1.5245** [1.4857, 1.5666] |

The stack model minus base rates is -0.174 [-0.206, -0.141]. On the 830 validation fights with method props, the
market scores 1.5012 and this model 1.5238 (+0.023 [-0.007, 0.050]). A 50/50 log-linear pool of the two scores
1.4922 (-0.009 [-0.024, +0.005] against the props), so the model may add a little to the props, but not
significantly.

The method model alone (P(KO/TKO, SUB, DEC) given the winner, softmax, C = 0.002) scores CV 0.9386 against 1.0184
for base rates. On 2024-2025 it predicts 33.5% KO/TKO, 17.2% SUB, 48.5% DEC and 0.8% draws, against 29.1 / 16.9 /
53.6 / 0.5 observed: KO/TKO is over-predicted and decisions under-predicted, because 2024-2025 finishes less than the
training years. P(finish) by quintile, predicted -> observed: 0.32 -> 0.27, 0.44 -> 0.32, 0.51 -> 0.51,
0.58 -> 0.54, 0.68 -> 0.66.

### 6. What drives the predictions

- **Logistic, largest standardised coefficients:** judging-score Elo +0.124, age -0.120, strike-share Elo +0.109,
  takedown attempts per 15 +0.097, age past 30 -0.085, opponents' takedown attempts +0.080 (it partners the
  takedown defence and control-against terms), layoff over 450 days -0.079, years in the UFC -0.079, finish
  losses in the last 3 -0.078, control against -0.076, minutes per fight +0.071, head-strike matchup share
  +0.069, age at UFC debut -0.067, submission matchup share +0.062. Older at debut, longer in the UFC and older now
  are three separate, additive age penalties.
- **LightGBM gain by group:** margin Elo 25%, age 14%, striking rates 9%, grappling 8%, normalised matchup
  products 8%, matchup shares 6%, record 5%, accuracy and defence 4%, opponent quality 3%. Context (weight class,
  title, rounds, sex) gets under 0.1%: it changes how fights end, not who wins.

### 7. Where it works and where it does not (2024-2025, log loss)

| Subgroup | n | Elo | Logistic | ML blend | Close | ML accuracy |
|---|---|---|---|---|---|---|
| Men | 707 | 0.6781 | 0.6114 | 0.6139 | 0.5889 | 0.663 |
| Women | 147 | 0.6713 | 0.5815 | 0.5863 | 0.5686 | 0.714 |
| Men 145 lb and under | 271 | 0.6947 | 0.6213 | 0.6253 | 0.5968 | 0.657 |
| Men 155-185 lb | 332 | 0.6730 | 0.5903 | 0.5921 | 0.5687 | 0.696 |
| Men 205 lb and up | 104 | 0.6508 | 0.6529 | 0.6538 | 0.6327 | 0.577 |
| 3 rounds | 749 | 0.6781 | 0.6074 | 0.6097 | 0.5804 | 0.672 |
| 5 rounds, non-title | 67 | 0.6724 | 0.6082 | 0.6143 | 0.6324 | 0.627 |
| Title fights | 38 | 0.6612 | 0.5797 | 0.5893 | 0.5998 | 0.763 |
| A fighter with 1-2 UFC fights | 262 | 0.6856 | 0.6396 | 0.6400 | 0.6039 | 0.615 |
| Both 3-7 UFC fights | 354 | 0.6654 | 0.5861 | 0.5889 | 0.5702 | 0.715 |
| Both 8+ UFC fights | 238 | 0.6844 | 0.5995 | 0.6053 | 0.5876 | 0.672 |
| Elo gap < 50 | 544 | 0.6936 | 0.6293 | 0.6297 | 0.6029 | 0.642 |
| Elo gap 50-120 | 273 | 0.6612 | 0.5714 | 0.5794 | 0.5706 | 0.718 |
| Elo gap > 120 | 37 | 0.5467 | 0.5244 | 0.5266 | 0.4306 | 0.784 |

The close column covers the fights that have a close. The gap to the close is largest for newcomers: 0.036 when one
man has only 1-2 UFC fights, 0.016 when both have 3-7. The market knows their regional records and the ML model does
not, so pre-UFC data (tools/preufc.py) is the most promising next feature. Heavyweights and light heavyweights are hard
for everyone, and there the logistic model does no better than Elo (0.6529 vs 0.6508, 104 fights). In 5-round and
title fights the logistic model beats the close, on small samples (67 and 38 fights).

## Stacking layer for the final product

### Design

- **Form.** Logit-linear pooling with no intercept: logit p = sum_i w_i logit p_i. Swapping the corners flips every
  input logit, so the stack is exactly corner-symmetric; with one input it is a symmetric Platt recalibration. The
  weights come from a lightly penalised logistic regression (lambda 0.001) on the 2019-2023 out-of-fold
  predictions, where every input is itself walk-forward. Leave-one-year-out inside 2019-2023 (fit on four years,
  score the fifth) is the honest tuning-period estimate; 2024-2025 uses the weights fit on all of 2019-2023.
- **Inputs available today.** Elo (backtest_dev.json), the ML blend and its parts (this tool), engine v3
  P(A) / (P(A) + P(B)) (moe_engine_bt.json, 2019-2025, 100 simulations per corner order), and from market.json the
  pre-line market rating (Kalman filter on earlier closing lines and results; exists before any line is posted;
  parameters fit on 2019-2023), the opening line (multiplicative de-vig) and the consensus closing line (power
  de-vig). A `data/derived/calibration.json` with per-fight engine probabilities in `fights` / `predictions` and a
  `ratings.json` are picked up automatically when they appear (the current calibration.json has no per-fight block,
  so it is not used).
- **Three regimes for the product.** (1) Any matchup on the page, no line: Elo + ML + market rating (or Elo + ML
  when a fighter has no market history). (2) Fight week, opening line posted: open + ML. (3) Closing line: close + ML.
  A fight missing an input falls back to the next-smaller stack.

### Results (weights fit on 2019-2023 OOF; scored once on 2024-2025)

| Stack | Weights (logit scale) | OOF leave-one-year-out (ML alone, same rows) | Val n | Val log loss | Accuracy | Minus ML, same fights [95% CI] | Minus best single input [95% CI] |
|---|---|---|---|---|---|---|---|
| Elo + ML | Elo -0.02, ML 1.00 | 0.6470 (0.6465) | 854 | 0.6095 | 0.672 | +0.0003 [0.0002, 0.0004] | same |
| Elo + logistic | Elo 0.02, logistic 0.93 | 0.6482 (0.6465) | 854 | 0.6092 | 0.678 | +0.0001 [-0.0029, 0.0032] | +0.0029 [0.0019, 0.0040] vs logistic |
| Elo + ML + engine v3 | Elo -0.02, ML 1.02, engine -0.05 | 0.6486 (0.6465) | 854 | 0.6100 | 0.672 | +0.0009 [0.0003, 0.0015] | same |
| Elo + engine v3 | Elo 0.49, engine 0.62 | 0.6742 (0.6465) | 854 | 0.6463 | 0.618 | +0.0372 [0.0263, 0.0478] | +0.0027 [-0.0044, 0.0092] vs engine |
| **Elo + ML + market rating** (pre-line, recommended) | Elo -0.49, ML 0.73, rating 0.77 | **0.6395** (0.6465) | 845 | **0.5935** | 0.685 | **-0.0135** [-0.0221, -0.0047] | same |
| Elo + logistic + market rating (page) | Elo -0.48, logistic 0.67, rating 0.78 | 0.6404 (0.6465) | 845 | 0.5929 | 0.696 | -0.0141 [-0.0231, -0.0048] | -0.0106 [-0.0193, -0.0025] vs logistic |
| Elo + ML + engine + market rating | -0.49, 0.76, -0.06, 0.77 | 0.6409 (0.6465) | 845 | 0.5943 | 0.689 | -0.0126 [-0.0213, -0.0040] | same |
| Market rating alone | 1.10 | 0.6552 (0.6465) | 845 | 0.6230 | 0.654 | +0.0161 [0.0026, 0.0284] | -0.0029 [-0.0046, -0.0014] vs raw rating |
| Open alone (recalibrated) | 1.13 | 0.6377 (0.6465) | 843 | 0.6066 | 0.668 | -0.0006 [-0.0168, 0.0166] | -0.0027 [-0.0050, -0.0005] vs raw open |
| **Open + ML** | open 0.80, ML 0.53 | 0.6304 (0.6465) | 843 | **0.5884** | 0.693 | -0.0187 [-0.0302, -0.0064] | **-0.0209** [-0.0273, -0.0143] vs open |
| Close alone (recalibrated) | 1.02 | 0.6233 (0.6465) | 845 | 0.5850 | 0.692 | -0.0219 [-0.0414, -0.0037] | -0.0003 [-0.0009, 0.0002] vs raw close |
| **Close + ML** | close 0.88, ML 0.25 | 0.6225 (0.6465) | 845 | **0.5799** | 0.698 | -0.0271 [-0.0437, -0.0109] | **-0.0055** [-0.0081, -0.0027] vs close |
| Close + ML + engine + rating | 0.85, 0.29, -0.12, 0.11 | 0.6249 (0.6465) | 845 | 0.5805 | 0.695 | -0.0265 [-0.0433, -0.0109] | -0.0049 [-0.0086, -0.0012] vs close |

(The open + ML "vs open" figure is from the paired market comparison in section 4; on these fights the ML blend is
itself slightly better than the raw open, so the automatic "best single input" is the blend.)

**Expected 2024-2025 gain of the stacking layer:**

| Regime | Without the layer | With the layer | Gain [95% CI] |
|---|---|---|---|
| No line | ML blend | Elo + ML + market rating | -0.0135 [-0.0221, -0.0047] log loss; accuracy 0.673 -> 0.685 (845 fights) |
| Opening line | Open | Open + ML | -0.0209 [-0.0273, -0.0143] |
| Closing line | Close | Close + ML | -0.0055 [-0.0080, -0.0026] |
| Vs Elo (no line) | Elo | Elo + ML + market rating | -0.0811 [-0.1009, -0.0596] |

The engine's weight is about zero, and slightly negative, in every stack. Engine v3 as it stands, with
100 simulations per corner order, scores 0.6463 even with Elo's help, against 0.6095 for Elo + ML on the same
fights, so it has nothing to add to the win probability. The negative Elo weight beside the market rating is
expected: both the ML model and the market rating already contain Elo-like information, and the stack removes the
double count.

## Page model: any matchup in JS

`ml.json` carries everything the page needs to score any two roster fighters without the backtest:

- `page_model.winner.terms`: the logistic model as a list of terms. Each term has a `type` (`logr`, `logit`, `lin`,
  `hinge`, `flag`, `share`, `stance`), the per-fighter key(s) it reads, its parameters, a raw-unit `coef` and its
  feature `group`. The model is refit on every decisive fight from 2010-01-01 to 2025-12-31 (7,093 fights) with the
  CV-chosen penalty; the 2026 vault is not fit on (the validation numbers above are for the same specification fit on
  2010-2023 only). `platt_slope` is the OOF Platt slope; p(A wins) = 1 / (1 + exp(-platt_slope * sum_j coef_j *
  term_j(A, B))). Swapping A and B gives exactly 1 - p.
- `page_model.method`: P(KO/TKO, SUB, DEC | that fighter wins) as a softmax over
  [side_block(winner), side_block(loser), context]; with `draw_rate` this turns p(A wins) into the 7 bins. Fit on
  fights before 2026.
- `page_model.stack`: the product stack weights for `elo+lr+mkt_rating` (when both fighters have a market rating in
  market.json) and `elo+lr`, fit on 2019-2023 OOF predictions.
- `roster[slug]`: the per-fighter values as of the snapshot (live state through Oct 31, 2026), plus `_dob`,
  `_last_fight`, `_prev_lbs`, `_lbs_fought` (so the page recomputes age, layoff, years in the UFC, weight-class move
  and new-class for the fight date and weight), and `mr_mu` / `mr_sd` (market rating) when market.json has one.
- `page_model.test_vectors`: seven matchups with the Python answer. The JS below reproduces them to 5e-5 (the vectors are
  stored to 4 decimals); `selfcheck_max_abs_logit_diff` checks the term evaluator against the training design.

Test vectors (fight on Nov 15, 2026, 5 rounds; P(A wins); these are checks for the JS, not forecasts):

| A vs B | Logistic (Platt) | Elo | Market rating | Page stack | 7 bins (A KO, A SUB, A DEC, draw, B DEC, B SUB, B KO) |
|---|---|---|---|---|---|
| Volkanovski vs Gaethje, 155 | 0.654 | 0.592 | 0.635 | 0.671 | .243 .063 .343 .007 .170 .016 .157 |
| Makhachev vs Topuria, 155 | 0.647 | 0.677 | 0.670 | 0.654 | .164 .151 .327 .007 .094 .023 .233 |
| Aspinall vs Gane, 265 | 0.429 | 0.437 | 0.657 | 0.605 | .285 .061 .079 .007 .133 .071 .364 |
| Dvalishvili vs Yan, 135 | 0.518 | 0.473 | 0.414 | 0.458 | .041 .048 .426 .007 .321 .011 .146 |
| Pereira vs Ankalaev, 205 | 0.451 | 0.467 | 0.405 | 0.406 | .337 .016 .095 .007 .223 .064 .258 |
| Chimaev vs Du Plessis, 185 | 0.508 | 0.453 | 0.588 | 0.596 | .101 .131 .272 .007 .219 .045 .224 |
| Shevchenko vs Natalia Silva, 125 | 0.537 | 0.541 | 0.518 | 0.521 | .057 .050 .425 .007 .330 .025 .105 |

Two of these show what the stats see and miss. Aspinall has 23 career UFC minutes, so his rates sit near the
league prior and the logistic model has him as an underdog. The market rating, built from his betting lines, is
what lifts the stack to 0.60. For Volkanovski vs Gaethje every input favours Volkanovski: he absorbs 3.4
significant strikes a minute to Gaethje's 5.6, he brings a takedown threat, and he is higher on both margin Elos.
The Oct 24-25 openers had Gaethje at -180 to -200 (Volkanovski 37% no-vig, docs/BACKLOG.md). What the market is
pricing here (size, his two losses at 155) is outside what these features measure: the weight-move term is close
to zero (0.0011 logits per lb), in line with the durability analysis, which finds no size penalty after an Elo
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

1. **Winner probability with no line (the page, any matchup): the Elo + ML + market-rating stack.** On 2024-2025 it
   is the best pre-line number this project has: 0.5935 on 845 fights, 0.0135 [0.0047, 0.0221] better than the
   ML blend and 0.081 better than Elo. On the page use `page_model.stack["elo+lr+mkt_rating"]` (logistic instead
   of the blend, 0.5929 on validation) with `binsStack` for the 7 bins, and `elo+lr` when either fighter has no market
   rating. The Elo weight is negative because Elo is already inside both other inputs; that is expected.
2. **Once a line exists, stack it with the ML probability, not the other way round.** Open + ML beats the open by
   0.0209 [0.0143, 0.0273]; close + ML beats the close by 0.0055 [0.0026, 0.0080]; both intervals exclude zero.
   Weights are in `results.stacking.variants`.
3. **Do not average the engine's win probability into the product yet.** Engine v3 (moe_engine_bt.json) gets a
   weight of about zero next to the ML blend and makes the stack slightly worse on the 854 fights it covers. Use
   the engine for how the fight goes (methods, rounds, stat lines, the 3D replay) and anchor it to the stack:
   choose the engine's per-matchup skill offset so its P(A wins) matches the stack, and let it distribute that
   probability over methods and rounds. Re-test when the calibrated engine writes per-fight probabilities.
4. **7 bins: P(win) from the stack times P(method | winner) from the method softmax** (`stack_fact`, which
   `results.seven.recommended` names on OOF). When the market's method props exist they are at least as good
   (1.5012 vs 1.5238 on the same 830 fights, not significant), and a 50/50 pool of the two is better than either on
   point estimate (1.4922).
5. **No Platt or isotonic layer on top.** OOF slopes are 0.93-1.00, and on 2024-2025 Platt (-0.0002) and isotonic
   (-0.0023 [-0.0046, 0.0001]) change little. The walk-forward yearly temperature did not help on 2020-2023 and is not
   adopted by this build; it did help on 2024-2025 (section 3), so it is the leading candidate for the next version
   selection, to be confirmed by the vault audit rather than assumed.
6. **Refit every January with frozen hyperparameters** (the `*_refit` rows; refitting beat a frozen model by 0.0026
   on 2019-2023), and re-tune once a year on a moving window that never touches the vault.
7. **Keep the logistic model as the backbone.** It is the best single model on 2024-2025 (LightGBM is 0.0104
   [0.0029, 0.0176] worse) and it is what the page evaluates. The trees help a little out of fold (blend 0.6471 vs
   0.6479) but not on 2024-2025 (+0.0029 [-0.0007, 0.0061]), so the blend is optional. Use it where Python runs, and
   the logistic model on the page.
8. **Next data, in order of expected value:** pre-UFC records for newcomers (the gap to the close is 0.036 log loss
   when a fighter has 1-2 UFC fights and 0.016 when both have 3-7); the calibrated engine's per-fight
   probabilities (`calibration.json`) and tools/ratings.py's per-fight ratings (`ratings.json`), which
   `load_external()` picks up when present (re-run `--stage2`; check the field names against the final formats);
   opponent-adjusted rates from tools/oppadj.py as features; then refit the stack weights.

## Caveats

- **2024-2025 is an easier period than 2019-2023 for everyone.** The closing line goes from 0.624 (OOF years) to 0.585
  (validation), and the ML blend moves about as much. Compare models on the same fights, never across periods or with
  other projects' numbers from other years.
- **2024-2025 is a validation set, not a pristine test.** The protocol allows version selection on it, and the
  first build's tree leak was found after a look at it. The sealed 2026 vault (ml_vault.json, outside the repo) is
  the clean test, at the milestone audits.
- **Models are under-confident in 2024-2025** (calibration slope 1.43-1.59 for the ML models, 1.11 for the close).
  Nothing fit on 2019-2023 can see this (OOF Platt slopes 0.93-1.00), and the validation-fit slope is reported only as
  a diagnostic. The rolling-temperature rule is the walk-forward way to track it.
- **Engine inputs.** moe_engine_bt.json is engine v3.0.0 at 100 simulations per corner order (Monte Carlo noise
  about 0.035 in p), it covers 2019-2025 only, and the engine's parameters were self-calibrated with 2019-2023 in
  view, so its 2019-2023 stacking weight is if anything optimistic. Re-fit the stack when the calibrated engine
  writes per-fight probabilities.
- **Market-rating inputs.** The market rating's Kalman parameters were fit on 2019-2023, so the OOF (and LOYO)
  figures of the stacks that use it are slightly optimistic; the 2024-2025 figures are not.
- **Page model limits.** Per-fighter values are shrunk toward the fighter's own home division, not the fight's
  (immaterial for experienced fighters). The logistic model reads finishing speed through minutes per fight, so
  fighters whose few UFC fights were all quick wins (Tom Aspinall: 23 career UFC minutes) are under-rated; the
  stack's market-rating input is what corrects them. Age, layoff and weight move are recomputed for the fight date,
  everything else is as of Oct 31, 2026.
- **Tale-of-the-tape values are current, not historical.** Height, reach and DOB do not change; stance can, and a
  few fighters switched. Their missingness is handled as above.
- **Not used:** the A/B order (a real pre-fight signal: the first-named fighter, usually the red corner, wins 55-57%
  of decisive fights, but it means nothing for a hypothetical matchup), pre-UFC records
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

## Verification log

Adversarial review, Nov 6, 2026 (the first verifier was cut off by a usage limit after making four fixes in the code,
listed under Leakage checks, without writing a log). Brief: assume the headline is inflated or wrong; hunt for
look-ahead, tuning on 2024+, 2026 data, corner-order exploitation, wrong joins, market-data traps, over-claimed
precision and code bugs; re-run the headline with fresh code; fix in place.

**Problems found and fixed**

1. **Vault breach (protocol; high).** The first build scored "test" as 2024-01-01..2026-10-31, so the 373 backtest
   fights of 2026 (480 UFC bouts) were scored, and 2026 results shaped statements in the report (recommendation 7
   leaned on the 2026 row to prefer the logistic model; the calibration paragraph cited the 2026 rolling slope). It
   also read backtest.json (with 2026 results) and fit the page model's coefficients on every fight through the
   snapshot, 2026 outcomes included. Fix in tools/ml.py: `split_vault()` moves every 2026 row out of every fit and
   score at the start of stage two; the tool reads backtest_dev.json; the page model and method softmax are fit on
   fights before 2026; 2026 pre-fight predictions (no results) go to `ml_vault.json` in the vault directory, as
   tools/market.py does. The raw parse still walks 2026 bouts for the roster's live state only. This was a protocol
   breach rather than inflation: the old 2024-2026 headline (0.6156) is worse than the 2024-2025 figure (0.6062).
   This log quotes no further 2026 numbers.
2. **The report did not match its own ml.json (medium).** The text came from a run before the first verifier's
   fixes; the final run (11:39) changed numbers the text never caught up with. Examples: blend weights (report:
   LightGBM 0, unconstrained -0.105; ml.json: 0.126 and 0.126), LightGBM 0.6253 vs 0.6233 and XGBoost 0.6238 vs 0.6221
   on 2024-2026, isotonic 0.6178 vs 0.6156 (and the sign of isotonic minus blend), LightGBM minus logistic +0.0097 vs
   +0.0077, the best LightGBM (15 leaves, 150 rounds vs 7 leaves, 250 rounds) and XGBoost (225 vs 300 rounds), the OOF
   7-bin stack 1.6190 vs 1.6211, calibration slopes (Elo 0.88 in data orientation vs 0.99 fit on mirrored data), and
   the LightGBM gain shares. Every table is now regenerated from the corrected ml.json.
3. **Flag contradicting the text (low).** `rolling_temperature.lr.adopt` was True on a 0.00005 OOF gain that the
   report calls a wash and does not adopt. `adopt` now requires a gain above 0.0005 (the group-selection threshold).
4. **Claims restated on 2024-2025.** Logistic vs close: +0.023 [0.005, 0.040] became +0.018 [0.001, 0.038]. Close +
   ML vs close: 0.0034 became 0.0055 [0.0026, 0.0080] (still significant). "The props already contain what the model
   knows about method" became "the 50/50 pool is better on point estimate, not significantly" (-0.009
   [-0.024, +0.005]). The newcomer gap to the close: 0.051 became 0.036. New: the no-line stack is marginally ahead of
   the opening line (-0.016 [-0.031, -0.001]); the logistic model is no better than Elo for men at 205 lb and up.
5. **Mixed periods on the page (low; outside tools/ml.py).** build.py's "since 2024" table put market.json's 2024-2025
   benchmarks next to ml.json's 2024-2026 numbers. Both are 2024-2025 now; the page needs `python3 build.py`.

**Checks that found nothing wrong**

- **Look-ahead.** My own perturbation test (fresh driver code around ml.py's table builder): flipping every result and
  swapping the stat lines from a date onward, with Elo and margin Elos recomputed, leaves every row up to that date
  unchanged (0 cells, three dates). The first build's truncation test also holds.
- **Tuning period.** Every choice uses 2010-2023 only: LR and tree CV blocks end in 2023, the margin-Elo grid is
  scored on 2010-2023, the judge-score weights come from pre-2023 decisions, build_db's Elo K was tuned on 2019-2023,
  the market rating's parameters on 2019-2023, and blend, stack, Platt, isotonic and the 7-bin pick on 2019-2023 OOF
  (with LOYO for the stack-based 7-bin OOF).
- **Corner order.** The symmetry guard passes; in my refits p(x) + p(-x) = 1 to 2e-16 (logistic) and 1e-16
  (orientation-averaged LightGBM); stacks and Platt have no intercept; isotonic is fit on mirrored data and
  symmetrised; calibration slopes are fit on mirrored data; accuracy counts p = 0.5 as half.
- **Joins.** `y` matches backtest_dev.json on all 2,864 dev fights; slugs, UFC fight counts, Elo, age and KO losses
  match on both sides of all 2,864 (0 mismatches); no dev fight is lost to `amb:` people. ufcstats' loser-first rows
  come through the OUTCOME code (W/L, L/W); draws and no-contests have y = null and are excluded; DQs are excluded
  from 7-bin scoring. The method6 order ([A_KO, A_SUB, A_DEC, B_KO, B_SUB, B_DEC]) maps correctly to the 7 bins.
- **Market data.** The 2019-2025 open, close and market-rating values the ML run used are identical to the
  market.json now on disk (its later rebuild only removed 2026 rows). In-play closing ranges and exchange prices are
  handled upstream (research/model_market.md); the market rating at a fight uses only earlier lines and results.
- **Fresh-code reproduction.** Independent rescoring of the per-fight predictions against backtest_dev.json results
  reproduces every 2024-2025 figure. A sklearn refit of the logistic specification on 2010-2023 reproduces 0.60625
  (max per-fight difference 1e-4). A direct LightGBM fit with another seed scores 0.6152 vs 0.6166 (correlation 0.993).
  Unpenalised sklearn stack refits on the OOF give Elo + ML + rating 0.5930 and close + ML 0.5799 (recalibrated close
  0.5849). A deliberately crude logistic built only from backtest_dev.json snapshots (about 20 difference terms,
  trained on 2019-2023) scores 0.6276, so 2024-2025 is easy for any stats model and the full model's extra 0.021 is
  plausible from 14 years of training data and the margin Elos.
- **Downstream.** Every per-fight value for 2019-2025 in ml.json (elo, elo_sig, lr, gbm, xgb, ml, ml_iso, stack,
  *_refit, bins7) is identical before and after the fix (max difference 0), so tools/moe.py, embed.py and preufc.py
  inputs are unchanged. The page model's coefficients changed slightly (fit through 2025 instead of the snapshot):
  Volkanovski vs Gaethje 0.652 -> 0.654 (logistic), 0.667 -> 0.671 (stack).

**Rerun.** `python3 tools/ml.py --stage2` on the cached stage-1 fits (no stage-1 fit or choice for 2019-2025 depends
on the changes: tuning and OOF fits end in 2023, the 2025 refit uses 2010-2024; only the 2026 predictions, now
exported to the vault, came from fits that include 2025), plus a
full `--quick` smoke run into a scratch cache to exercise the new stage-one path end to end (see the note below).
Files changed: tools/ml.py, data/derived/ml.json, research/model_ml.md, the ML line of docs/BACKLOG.md, and
ml_vault.json in the vault directory. Not changed: docs/CHANGELOG.md and research/model_styles.md still quote
2024-2026 ("2024+", 1,223 fights) numbers from other tools.
