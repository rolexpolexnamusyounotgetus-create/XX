# mlrates: learned matchup stat-line model that drives the simulator

Status: built, validated and exported Nov 6, 2026. Files: `tools/mlrates.py` (dataset, models, validation,
export), `tools/mlrates_engine.js` (engine v3 expectations and the simulator check, called by the Python tool),
`src/ml/mlrates.js` (dependency-free UMD evaluator plus the engine adapter), `tests/test_mlrates.js` (45 checks),
`tests/fixtures/mlrates_fixtures.json`, `tools/mlrates_mlcal_hook.js` (hook for the mlcal tuner). Outputs:
`data/derived/mlrates_eval.json` (all validation and simulator numbers in this report),
`data/derived/mlrates.json` (production model, trained 2010-2025), `data/derived/mlrates_dev.json` (trained
2010-2023: every validation number below, and honest engine backtests), `data/derived/mlrates_oof.json`
(out-of-fold rates for 2019-2025 fights, for tuning engine couplings without leakage).

## Verdict

1. **The learned per-matchup rates beat engine v3's own log-linear shrunk rates.** On 2024-2025 validation
   (1,730 fight-sides where both men had a prior UFC fight; the model was trained on 2010-2023 only), the ML
   stack has lower deviance on 12 of 18 stats with 95% CIs that exclude zero: attempt rates at distance, in the
   clinch, on the ground and to the head, body and leg; takedown attempts and success; control time; submission
   attempts; head accuracy; and knockdowns per landed head strike. Deviance skill versus league average goes from
   0.26 to 0.32 for distance attempts, 0.23 to 0.32 for takedown attempts, 0.23 to 0.29 for control time and
   0.00 to 0.06 for takedown success. The other six (reversals; body, leg, distance, clinch and ground accuracy)
   are inside the noise: body, leg and clinch accuracy slightly worse than the engine's, the rest slightly better.
2. **The simulator plays better fights with them.** Engine v3 with the ML rates applied through the adapter,
   versus the plain engine (400 simulations per fight and setup, paired seeds):
   - 2024-2025, 854 decisive fights, dev model trained 2010-2023: winner log loss **0.6465 -> 0.6239**
     (-0.0226 [-0.0311, -0.0136]), Brier 0.2274 -> 0.2171, accuracy 63.8% -> 66.7%, 7-outcome log loss
     1.5947 -> 1.5770 (-0.0177 [-0.0351, +0.0005]).
   - 2019-2023, 1955 decisive fights, out-of-fold rates: 0.6747 -> 0.6690
     (-0.0057 [-0.0123, +0.0012]), accuracy 56.5% -> 60.0%.
   - Pooled 2019-2025 (2809 fights, all out of sample): **0.6661 -> 0.6553, -0.0108 [-0.0159, -0.0055]**,
     better in every one of the seven years.
   - Simulated per-minute stat lines (sig. landed, takedowns landed, control) move closer to the real ones in both
     periods, all CIs excluding zero.
   - Walk-forward Elo: 0.6769 (2024-2025), 0.6857 (2019-2023).
3. **Ship it as the engine's rate layer.** In the integration recipe below, the engine keeps its calibrated league
   level and its in-fight dynamics. The ML model supplies each fighter's matchup-specific multipliers (attempts by
   position and target, accuracy, KD, takedowns, control, submissions, reversals). Knobs still work on top.

## Data and protocol

- Source: `data/raw/*.csv` (ufcstats). Parsed with `tools/build_db.py` functions; **every fight dated 2026-01-01
  or later is dropped right after parsing** (8,974 parsed, 8,494 kept). People, round stats and Elo (K=44, boost
  1.5 from `data/derived/elo_report.json`) are rebuilt from the kept fights.
- Walk-forward profiles: the same decayed sums `S` as fighters.json and the backtest (half-life 730 days), built
  only from earlier fights. The snapshots match `backtest_dev.json` to its 4-digit rounding (max relative
  difference 5e-4 over all 2,864 shared fights, no slug mismatch).
- Shrinkage priors: division rates from the 5 years before Jan 1 of the fight's year (`build_priors`, the same
  window as the backtest's `priors_asof`). Catch and open weight use the heavier pre-fight home division.
- Rows: every fight-side with round stats, two rows per fight (each man attacking the other). Training is
  2010-2023 (12,384 rows). Validation is 2024-2025 (2,074 rows; 1,730 where both men had a prior UFC fight, the
  backtest population, used for all headline numbers). The 2026 vault is never read.
- Time-ordered selection inside training. The GBM round counts, MLP epochs and GLM ridge strength use train <=
  2016, stop on 2017-2018. Out-of-fold predictions for 2019, 2020, 2021, 2022 and 2023 come from models trained
  on 2010..year-1, and the stacking weights are fit on those. The MLP architecture was chosen in a side run on
  train <= 2017 / 2018-2019. Validation was used only to report.
- Symmetry: the model has no corner input. Each side is "attacker X vs defender Y", so `predict(A, B)` and
  `predict(B, A)` swap exactly (tested). The simulator check scores both orientations.

## Features (164, all pre-fight; `features()` in both ports)

For each man, rates shrunk toward the division prior the way engine v3's `fighterRates` does: same exposure
estimates, simpler accuracy shrinkage, and the model's own constants (kPM 40, kAcc 150, kTdPM 45, kTdAcc 12, kKD
230, kCtrlTD 4, kRev 40, stored in the JSON so params3.js changes cannot shift the features). Each is a log ratio
(counts) or logit difference (probabilities) to the league:

- offense (23): attempts per distance minute, clinch attempts per fight minute, attempts per top minute; head/body/leg/total
  attempts per minute; accuracy by target (head, body, leg) and position (distance, clinch, ground); KD per
  landed head strike (power); takedown attempts per standing minute and success; control per minute and per
  takedown (top skill); submission attempts per ground minute and per minute; reversals per bottom minute; KO
  and submission win rates per fight;
- defense (23): the same quantities for what opponents did to him (chin = KD absorbed per head strike absorbed,
  takedown defense, escape weakness, and so on);
- both men's offense and defense blocks (X and Y), evidence (log decayed minutes, fights, head attempts,
  takedown attempts);
- engine-style log-linear combinations for every stat (X offense + Y allowed) and closed-form expectations: the
  pair's expected control, ground and clinch shares, and the expected per-fight-minute attempts at each
  position given those shares (the engine's occupancy logic in closed form);
- context: 5 rounds, title, women's division, division weight, year, ages, reach and height difference, stances
  (southpaw, switch, opposite-stance pairing), Elo of both, UFC experience, debut flags, weight-class move (fight
  weight minus home division, per 10 lb), prior KO losses, layoff (log months; flag when unknown).

## Targets and likelihoods

The attacker's realised totals in that fight, with fight minutes as exposure (counts), or successes out of trials
(probabilities). All models predict on the link scale with the league rate of the shrinkage division as offset
(log rate per minute, or logit):

| target | likelihood | exposure |
|---|---|---|
| d_att, c_att, g_att (sig. attempts at distance, clinch, ground) | Poisson | minutes |
| h_att, b_att, l_att (sig. attempts to head, body, leg) | Poisson | minutes |
| td_att, sub_att, rev | Poisson | minutes |
| ctrl (control seconds) | quasi-Poisson (Poisson deviance on seconds) | minutes |
| acc_h, acc_b, acc_l (landed / attempted by target) | binomial | attempts |
| acc_d, acc_c, acc_g (landed / attempted by position) | binomial | attempts |
| td_acc (takedowns landed / attempted) | binomial | takedown attempts |
| kd_h (knockdowns / landed head strikes) | binomial | landed head strikes |

## Models

- **GLM with interactions** (numpy IRLS, ridge): all 164 standardized features plus the 66 pairwise products of
  each target's top-12 GBM features. Each target's own mechanistic features (its engine-style combination,
  attacker offense, defender allowance, expected share) get 1/50 of the penalty. The ridge strength per target is
  picked from 50..156,250 on the selection split. Most targets pick the strongest values, so the GLM ends up as a
  re-weighted engine log-linear model with small corrections.
- **LightGBM** (Poisson / cross-entropy objective with offsets as init scores): 7 leaves, learning rate 0.06,
  min 50 rows per leaf, feature and bagging fraction 0.7 / 0.8, L2 5. Rounds by early stopping (20-395 per
  target, x1.1 for the final fits).
- **Multi-task MLP** (torch): one shared hidden layer of 128 (tanh-GELU, dropout 0.4, AdamW weight decay 0.03,
  lr 1e-3), 18 linear heads added to the offsets, Poisson and binomial negative log-likelihoods weighted by each
  task's baseline deviance. 6 epochs (early stopping). Two seeds, averaged.
- **Stack**: per target, non-negative weights on each component's departure from the offset (no intercept),
  fit on the 2019-2023 out-of-fold predictions. Weights (GLM / GBM / MLP), for example: distance attempts
  0.45 / 0.18 / 0.36, control 0.50 / 0.24 / 0.28, takedown success 0.10 / 0.72 / 0.44, KD 0.60 / 0 / 0.40.
  Components with weight < 0.001 are left out of the export.

Baselines:
- **engine v3**: the static expectation of `FightEngine.matchup()` (src/engine3.js with src/params3.js
  `3.0.0-selfcal-2026-11-06`, same priors and snapshots), extended from engine3 `explain()` to every target by
  `MLRates.engineExpect(m)`: position occupancy from the engine's fit, attempt rates (with the clinch controller
  multiplier), target mixes, accuracy tables, KD per landed standing head strike, takedown rates and success,
  control, submission and sweep rates. **engine v3 recal** adds one constant per stat, fit on 2010-2023, which
  removes any level bias. That constant helps some stats on validation and hurts others.
- **league**: the division's prior rate.

## Validation results (2024-2025, both men with a prior UFC fight, 1,730 fight-sides)

Mean deviance per fight-side (lower is better). CIs are fight-cluster bootstraps (1,000 resamples); bold = CI
excludes zero. "(w=0)" = that component has stack weight 0 for the stat and is not exported.

| stat | likelihood | league | engine v3 | engine v3 recal | GLM | GBM | MLP | **ML stack** | ML - engine [95% CI] | ML - engine recal [95% CI] | skill vs league: engine / ML |
|---|---|---|---|---|---|---|---|---|---|---|---|
| d_att (distance sig attempts / min) | Poisson | 31.2005 | 23.0247 | 23.2377 | 21.3308 | 22.1976 | 21.5330 | **21.3029** | **-1.7219 [-2.4637, -1.0471]** | **-1.9349 [-2.7043, -1.2370]** | 0.262 / 0.317 |
| c_att (clinch sig attempts / min) | Poisson | 6.8453 | 6.1325 | 5.7708 | 5.6652 | (w=0) | 5.7228 | **5.6567** | **-0.4758 [-0.6117, -0.3294]** | **-0.1141 [-0.2060, -0.0184]** | 0.104 / 0.174 |
| g_att (ground sig attempts / min) | Poisson | 15.2194 | 14.3033 | 14.2233 | 13.7173 | 13.9535 | 13.6807 | **13.7131** | **-0.5901 [-0.9365, -0.2531]** | **-0.5102 [-0.8527, -0.1714]** | 0.060 / 0.099 |
| h_att (head sig attempts / min) | Poisson | 25.5278 | 19.5352 | 19.3880 | 18.3724 | 18.3412 | 18.3693 | **18.2465** | **-1.2887 [-1.8202, -0.7956]** | **-1.1415 [-1.6565, -0.6723]** | 0.235 / 0.285 |
| b_att (body sig attempts / min) | Poisson | 7.2271 | 5.7666 | 5.7496 | 5.3545 | 5.5228 | 5.3312 | **5.3522** | **-0.4145 [-0.5615, -0.2804]** | **-0.3974 [-0.5443, -0.2609]** | 0.202 / 0.259 |
| l_att (leg sig attempts / min) | Poisson | 6.9551 | 5.5335 | 5.5164 | 5.1616 | 5.2647 | 5.1573 | **5.1531** | **-0.3804 [-0.5772, -0.2147]** | **-0.3633 [-0.5611, -0.1973]** | 0.204 / 0.259 |
| td_att (takedown attempts / min) | Poisson | 3.6736 | 2.8310 | 2.8360 | 2.5021 | 2.5402 | 2.5208 | **2.4914** | **-0.3397 [-0.4310, -0.2508]** | **-0.3446 [-0.4354, -0.2535]** | 0.229 / 0.322 |
| sub_att (submission attempts / min) | Poisson | 1.0693 | 0.9572 | 0.9501 | 0.9106 | 0.9318 | 0.9265 | **0.9143** | **-0.0429 [-0.0671, -0.0180]** | **-0.0358 [-0.0584, -0.0130]** | 0.105 / 0.145 |
| rev (reversals / min) | Poisson | 0.5921 | 0.5586 | 0.5594 | 0.5334 | 0.5416 | 0.5387 | **0.5333** | -0.0254 [-0.0484, +0.0004] | **-0.0261 [-0.0495, -0.0002]** | 0.056 / 0.099 |
| ctrl (control seconds / min) | quasi-Poisson | 160.5279 | 123.1709 | 123.4714 | 114.1274 | 115.6791 | 115.0105 | **113.2999** | **-9.8710 [-13.0913, -6.3496]** | **-10.1715 [-13.5037, -6.6293]** | 0.233 / 0.294 |
| acc_h (head accuracy) | binomial | 4.8062 | 4.3249 | 4.2114 | 4.1219 | 4.1960 | 4.1729 | **4.1244** | **-0.2006 [-0.3335, -0.0607]** | **-0.0870 [-0.1721, -0.0001]** | 0.100 / 0.142 |
| acc_b (body accuracy) | binomial | 1.9295 | 1.8347 | 1.8577 | 1.8614 | 1.8893 | 1.8899 | **1.8732** | +0.0385 [-0.0050, +0.0798] | +0.0155 [-0.0195, +0.0485] | 0.049 / 0.029 |
| acc_l (leg accuracy) | binomial | 1.8832 | 1.7630 | 1.8039 | 1.7874 | 1.7574 | 1.8232 | **1.7791** | +0.0161 [-0.0253, +0.0616] | -0.0248 [-0.0545, +0.0095] | 0.064 / 0.055 |
| acc_d (distance accuracy) | binomial | 3.4502 | 2.9417 | 2.9048 | 2.8840 | 2.8829 | 2.9172 | **2.8756** | -0.0660 [-0.1920, +0.0720] | -0.0292 [-0.1044, +0.0481] | 0.147 / 0.167 |
| acc_c (clinch accuracy) | binomial | 1.6392 | 1.6290 | 1.6575 | 1.6239 | (w=0) | 1.6427 | **1.6325** | +0.0035 [-0.0401, +0.0438] | -0.0250 [-0.0575, +0.0056] | 0.006 / 0.004 |
| acc_g (ground accuracy) | binomial | 1.7769 | 1.7869 | 1.7772 | 1.7328 | (w=0) | 1.7381 | **1.7334** | -0.0534 [-0.1100, +0.0003] | -0.0437 [-0.0962, +0.0063] | -0.006 / 0.024 |
| td_acc (takedown success) | binomial | 1.8247 | 1.8177 | 1.8175 | 1.7017 | 1.7450 | 1.7022 | **1.7097** | **-0.1080 [-0.1542, -0.0691]** | **-0.1078 [-0.1542, -0.0689]** | 0.004 / 0.063 |
| kd_h (KD per landed head strike) | binomial | 0.8153 | 0.8141 | 0.7727 | 0.7659 | (w=0) | 0.7646 | **0.7630** | **-0.0511 [-0.0735, -0.0296]** | -0.0097 [-0.0244, +0.0037] | 0.002 / 0.064 |

How to read it:
- The attempt-rate, takedown and control gains are large and robust: they hold against the per-stat
  recalibrated engine too, so they are not just level corrections.
- Most of the KD gain is level. Against the recalibrated engine it shrinks to -0.010 [-0.024, +0.004]: engine
  v3's power-and-chin combination is about as good as the learned one once its level is right. (The adapter
  below keeps the engine's level anyway.)
- Body and leg accuracy are the one place where the engine's expected-accuracy construction (target accuracy
  adjusted for each fighter's position mix) did better on validation; the ML was better in the 2019-2023 CV (body
  1.976 vs 2.061). A candidate feature for the next fit: the engine's position-mix-adjusted accuracy shift.
- On all validation rows including debutants (2,074) the ranking is the same for the counts, takedown success, KD,
  head, distance and ground accuracy; body, leg and clinch accuracy are again slightly worse than the engine.

**Calibration** (slope of the observed rate on the predicted linear predictor; 1 = calibrated, < 1 = predictions
too spread, > 1 = too shrunk; deciles in the fit report):

| stat | ML slope | engine v3 slope |
|---|---|---|
| d_att / h_att | 1.19 / 1.20 | 1.33 / 1.32 |
| c_att / g_att | 0.93 / 0.92 | 0.96 / 0.75 |
| b_att / l_att | 1.11 / 0.93 | 1.04 / 0.91 |
| td_att / sub_att / rev | 0.97 / 1.03 / 0.88 | 1.21 / 0.83 / 0.64 |
| ctrl | 1.04 | 1.28 |
| acc_h / acc_b / acc_l | 0.97 / 0.86 / 0.98 | 0.83 / 0.89 / 1.26 |
| acc_d / acc_c / acc_g | 0.98 / 0.87 / 0.96 | 0.88 / 0.52 / 0.50 |
| td_acc / kd_h | 1.04 / 1.12 | 0.54 / 0.98 |

The ML is close to 1 almost everywhere. Engine v3 is too spread on clinch and ground accuracy, takedown success
and reversals (slopes 0.5-0.64), and too shrunk on distance and head attempts and on control (1.28-1.33).

**Stat lines at the actual fight length** (mean absolute error per fight-side, validation, both-prior):

| stat line | league | engine v3 | engine v3 recal | ML | ML - engine [95% CI] |
|---|---|---|---|---|---|
| sig. attempts | 40.817 | 35.212 | 35.055 | 33.539 | -1.673 [-2.402, -0.986] |
| sig. landed | 20.430 | 17.910 | 18.366 | 17.550 | -0.360 [-0.658, -0.047] |
| takedown attempts | 2.630 | 2.256 | 2.241 | 2.035 | -0.221 [-0.266, -0.173] |
| takedowns landed | 1.185 | 1.040 | 1.034 | 0.960 | -0.080 [-0.098, -0.061] |
| control seconds | 119.197 | 100.631 | 99.592 | 93.635 | -6.996 [-8.754, -5.067] |
| knockdowns | 0.352 | 0.403 | 0.324 | 0.341 | -0.061 [-0.068, -0.055] |
| submission attempts | 0.468 | 0.442 | 0.400 | 0.405 | -0.037 [-0.047, -0.029] |

## Time-ordered CV inside training (out-of-fold 2019-2023, all rows)

| stat | league | engine v3 | GLM | GBM | MLP | stack | weights GLM / GBM / MLP |
|---|---|---|---|---|---|---|---|
| d_att | 30.8892 | 24.6728 | 23.8028 | 24.2809 | 23.9161 | **23.6193** | 0.45 / 0.18 / 0.36 |
| c_att | 7.6865 | 6.9792 | 6.6557 | 6.7653 | 6.8427 | **6.6518** | 0.98 / 0.00 / 0.09 |
| g_att | 14.8259 | 13.9415 | 13.4105 | 13.4473 | 13.4794 | **13.3182** | 0.41 / 0.41 / 0.33 |
| h_att | 24.5879 | 20.4650 | 19.7037 | 20.0423 | 19.7910 | **19.5989** | 0.52 / 0.08 / 0.39 |
| b_att | 7.0880 | 5.7467 | 5.5789 | 5.6434 | 5.7564 | **5.5735** | 0.76 / 0.17 / 0.07 |
| l_att | 7.8230 | 6.1381 | 5.7416 | 5.8476 | 5.8680 | **5.7169** | 0.59 / 0.32 / 0.14 |
| td_att | 3.4046 | 2.7625 | 2.5071 | 2.5408 | 2.5145 | **2.4898** | 0.44 / 0.14 / 0.49 |
| sub_att | 1.1229 | 1.0365 | 1.0115 | 1.0172 | 1.0137 | **1.0064** | 0.40 / 0.23 / 0.37 |
| rev | 0.5721 | 0.5483 | 0.5231 | 0.5288 | 0.5222 | **0.5199** | 0.41 / 0.11 / 0.53 |
| ctrl | 152.6392 | 125.6700 | 117.6788 | 119.2208 | 118.6112 | **116.9463** | 0.50 / 0.24 / 0.28 |
| acc_h | 5.4124 | 4.9736 | 4.6090 | 4.6764 | 4.6649 | **4.5958** | 0.52 / 0.27 / 0.28 |
| acc_b | 2.1266 | 2.0606 | 2.0007 | 2.0203 | 1.9902 | **1.9761** | 0.38 / 0.17 / 0.54 |
| acc_l | 1.7565 | 1.7042 | 1.6362 | 1.6390 | 1.6439 | **1.6280** | 0.42 / 0.40 / 0.31 |
| acc_d | 4.2476 | 3.8287 | 3.3111 | 3.3598 | 3.3868 | **3.3019** | 0.64 / 0.31 / 0.09 |
| acc_c | 1.7270 | 1.7447 | 1.6530 | 1.6677 | 1.6543 | **1.6449** | 0.78 / 0.00 / 0.42 |
| acc_g | 1.8904 | 1.9192 | 1.8808 | 1.8796 | 1.8747 | **1.8669** | 0.21 / 0.00 / 0.51 |
| td_acc | 1.7628 | 1.7282 | 1.6746 | 1.6794 | 1.6774 | **1.6619** | 0.10 / 0.72 / 0.44 |
| kd_h | 0.8884 | 0.9135 | 0.8552 | 0.8629 | 0.8571 | **0.8537** | 0.60 / 0.00 / 0.40 |

The stack beats every single component on every stat in CV. On validation it is the best model for 9 stats and
within 1.3% of the best single component on the others (largest gaps: leg accuracy 1.779 vs 1.757 for the GBM
alone, body accuracy 1.873 vs 1.861 for the GLM, ground attempts 13.713 vs 13.681 for the MLP). No single
component is reliably better across stats, so the stack is the safe choice.

## What the model learned (engine insights)

- **The defender's "allowed" rates deserve about 0.5-0.75 of the weight engine v3 gives them** (GLM marginal
  exponents on the attacker's offense ratio a and the defender's allowed ratio b; engine v3 uses a = b = 1):
  distance attempts a 0.86 / b 0.64, head attempts 0.68 / 0.66, body 1.33 / 0.53, leg 1.42 / 0.47,
  takedown attempts 1.49 / 0.55, KD per head strike (power / chin) 0.94 / 0.60, head accuracy 0.59 / 0.73.
  Control is the exception (1.26 / 1.45): who controls whom is more extreme than the product of the two
  histories. (This complements data/derived/combine_fit.json, which compared a single shared exponent.)
  The other features absorb part of the signal, so these exponents are a guide for `combA` / `combB` per stat,
  not a drop-in.
- The most used GBM splits: both men's takedown-attempt rates, the pair's expected control, year (era drift in
  pace and accuracy), head-attempt combination, age of both men, body and leg offense, height difference,
  defensive takedown and control histories, reach difference.

## Simulator check: engine v3 plain vs engine v3 + ML rates

Setup: every fight where both men had a prior UFC fight. Each side's snapshot comes from the dataset above,
priors are the year's 5-year window, and the engine is src/engine3.js with params `3.0.0-selfcal-2026-11-06`. There are
400 simulations per fight and setup, with the same seed for plain and ML so the comparison is paired. "ML" is
`FightEngine.matchup` followed by `MLRates.applyToMatchup` (level "engine", weight 1). 2024-2025 uses
`mlrates_dev.json` (trained 2010-2023). 2019-2023 uses the out-of-fold rates (each year predicted by a model
trained on 2010..year-1). No simulated fight's own year was ever in the training data of the rates it used.
Winner metrics are scored on decisive fights in both corner orientations; the model has no corner input.

| | 2024-2025 plain | 2024-2025 ML | 2019-2023 plain | 2019-2023 ML |
|---|---|---|---|---|
| fights (decisive) | 854 | | 1955 | |
| winner log loss | 0.6465 | **0.6239** | 0.6747 | **0.6690** |
| Brier | 0.2274 | **0.2171** | 0.2409 | **0.2379** |
| accuracy | 0.638 | **0.667** | 0.564 | **0.600** |
| 7-outcome log loss (winner x KO/SUB/DEC, draw) | 1.5947 | **1.5770** | 1.6754 | **1.6744** |
| sig. landed / min, MAE of simulated vs actual | 1.920 | **1.898** | 1.977 | **1.955** |
| takedowns landed / min, MAE | 0.1027 | **0.0951** | 0.1016 | **0.0941** |
| control s / min, MAE | 9.265 | **8.774** | 9.252 | **8.765** |
| walk-forward Elo winner log loss | 0.6769 | | 0.6857 | |

Paired differences, ML minus plain, with fight-bootstrap 95% CIs:

| | 2024-2025 | 2019-2023 |
|---|---|---|
| winner log loss | **-0.0226 [-0.0311, -0.0136]** | -0.0057 [-0.0123, +0.0012] |
| 7-outcome log loss | -0.0177 [-0.0351, +0.0005] | -0.0011 [-0.0147, +0.0129] |
| sig. landed / min MAE | **-0.0220 [-0.0443, -0.0017]** | **-0.0226 [-0.0378, -0.0063]** |
| takedowns landed / min MAE | **-0.0076 [-0.0089, -0.0061]** | **-0.0074 [-0.0084, -0.0066]** |
| control s / min MAE | **-0.4908 [-0.6255, -0.3603]** | **-0.4870 [-0.5838, -0.4004]** |

**Pooled 2019-2025** (2809 decisive fights, all predictions out of sample): winner log loss
0.6661 -> **0.6553**, difference **-0.0108 [-0.0159, -0.0055]**. By year (plain -> ML): 2019: 0.6729 -> 0.6581 (n 388) | 2020: 0.6875 -> 0.6818 (n 343) | 2021: 0.6541 -> 0.6518 (n 415) | 2022: 0.6814 -> 0.6772 (n 419) | 2023: 0.6801 -> 0.6782 (n 390) | 2024: 0.6475 -> 0.6218 (n 429) | 2025: 0.6455 -> 0.6260 (n 425).
ML is better in all seven years. The gain is larger in 2024-2025 (and 2019) than in 2020-2023. Training size
does not explain it (the 2019 fold had the least data), so treat the pooled number as the planning estimate:
about -0.011 winner log loss.

**Calibration of the simulated win probability** (symmetric, deciles of both orientations): 2019-2023 ECE 0.036
plain -> 0.023 ML. 2024-2025 ECE 0.036 plain -> 0.048 ML: the ML version spreads its probabilities more, which
helps the log loss, but on 2024-2025 both versions are still underconfident (in the 0.7-0.8 decile the ML says
0.742 and 81.1% win). A logit-slope recalibration fit on the 2019-2023 simulations gives slopes 0.77 (plain) and
0.75 (ML), meaning both were overconfident in that period. Applied to 2024-2025 it makes both worse (plain 0.6465
-> 0.6513, ML 0.6239 -> 0.6325; the ML lead remains, at
-0.0188 [-0.0254, -0.0119]). So do not ship a fixed recalibration from this. The engine's dispersion
(form sds, shared volatility, judge noise) should be re-tuned with the ML rates on (mlcal hook), and a v9 stacking
layer should own the final calibration.

## Integration recipe (exact)

Everything the page needs is in `src/ml/mlrates.js` (UMD; `module.exports` in Node, `self.MLRates` in a browser
or Web Worker, no dependencies) plus `data/derived/mlrates.json` (1.28 MB; 2,384 trees, 2 small MLPs, 18 GLMs).

**Page / worker (live).** Inline the model JSON like the roster, load it once, and build matchups through the
wrapper:

```js
// after FightEngine.loadDB(fightersJson) and MLRates.load(mlratesJson)
var opts = { division: "Lightweight", rounds: 5, title: false, date: "2026-11-06", priors: db.priors,
             adjA: knobsA, adjB: knobsB };
var m = MLRates.matchup(FightEngine, "alexander-volkanovski", "justin-gaethje", opts);  // engine matchup + ML rates
var s = FightEngine.summarize(m, 20000, seed);                                        // unchanged
// m.mlPred = per-side predicted rates (for the stat-line panel), m.ml.targets / m.ml.ratios = what was applied
```

In the tally Web Worker, add mlrates.js and the model JSON to the worker's source the same way the engine
script is (the worker builds the matchup with `MLRates.matchup` instead of `FightEngine.matchup`). Keep a toggle
("learned rates on/off") that falls back to `FightEngine.matchup`.

**What the adapter does** (`MLRates.applyToMatchup(m, pred, {engine: FightEngine})`, in place on the matchup
object `m`; engine3.js and params3.js are untouched):

1. Targets. For each side and stat: target = (engine v3's static expectation for two league-average fighters with
   the same division, rounds and priors) x (ML rate / league rate), on odds for probabilities. The simulator keeps
   its calibrated league level and its in-fight modifiers stay balanced: the engine's static KD-per-head
   expectation runs 1.5-2x the observed league rate, and its self-calibrated in-fight modifiers bring the simulated
   rate back down, so imposing the observed rate on the static table would under-produce knockdowns. Only the
   matchup-specific multipliers come from the ML. Position accuracies
   are shifted on the logit scale to be coherent with the target accuracies. The matchup's knobs then multiply in:
   out (attempts), acc (accuracy odds), tdAtt, opponent's tdDef, sub, pow x opponent's chin (KD). The leg knob
   overrides the learned target mix. Optional `weight` in 0..1 blends toward the engine's own rates.
2. Grappling: takedown success odds (`tdO`, `tdOC`) and sweep rates (`sw`, `swPos`) scaled; control targets
   `ctrlT` set to the ML control; clinch time `clT` scaled by the clinch-attempt ratio^clinchTimeExp; clinch
   controller share recomputed; the engine's occupancy fit (clinch entry and stand-up hazards via
   `FightEngine.occupancy`) re-run, with takedown attempt rates (`tdD`, `tdCC`, `tdCU`) rescaled over 3 passes
   so per-minute takedown attempts and control land on target; `upPos` rebuilt.
3. Strikes: `dRate`, `cRate`, `gRate`/`gPos`/`gBot` scaled to the per-minute attempts by position; the
   distance target mix (`mixD`, `mixC`) set so head/body/leg shares match.
4. Accuracy: logit shifts by target and by position (two-margin IPF over the 4x3 position-by-target table) on
   `accO`.
5. KD: `kd` scaled to the KD per landed head strike; `gnp` and `stko` by its square root (they are built from
   the same power x chin product).
6. Submissions: `subTPos`, `subBPos`, `gillo` scaled to the per-minute attempts.

Every multiplier is capped at 4x either way (`maxRatio`). Measured on 25 fixture fights, the engine's
expectation after the adapter equals the target exactly for attempts, accuracies, KD and submissions; within
1.5% for takedown attempts and 8% (worst case) for control, which goes through the occupancy fit.

**Backtests / calibrate.js.** Use `data/derived/mlrates_dev.json` for any score on 2024-2025 (it never saw those
years). For tuning on 2019-2023, use the out-of-fold rates in `data/derived/mlrates_oof.json`, not the dev model,
which saw those years. Sides in `backtest_dev.json` work as profiles directly. `layoff` is not stored there, so
the model takes its "unknown layoff" branch. Pass `layoff` (days) or `last_fight` to use it. With fighters.json
profiles, layoff is computed from `last_fight` and the matchup date.

```js
var pred = MLRates.predict(model, entry.A, entry.B, { division: entry.division, prior_division: entry.prior_division,
  rounds: entry.rounds, title: entry.title, year: +entry.date.slice(0, 4), priors: priorsAsof[entry.date.slice(0, 4)] });
var m = FightEngine.matchup(entry.A, entry.B, engineOpts);
MLRates.applyToMatchup(m, pred, { engine: FightEngine });
```

**mlcal.** `tools/mlrates_mlcal_hook.js` plugs the rates into the tuner (`"hook": "tools/mlrates_mlcal_hook.js"`,
dimension `{"path": "hook.w_ml", "value": 1, "lo": 0, "hi": 1, "log": false}`). It reads the out-of-fold table for
2019-2025 fights, so tuning windows never see an in-sample ML prediction. The engine's dispersion parameters
(form sds, judge noise) were tuned for the plain rates and should be re-tuned with the rates on. The
recalibration slope below shows the room.

**Python reference.** `tools/mlrates.py` `model_eta(J, X, BASE)` evaluates an exported model, and `features()`
builds the feature vector. The Node test proves the JS port reproduces both: max feature difference 1.8e-15,
max linear-predictor difference 1.8e-15 over 62 fixture fights (124 sides, including a catch-weight bout and a
debutant).

## Reproduce

```
python3 tools/mlrates.py build                 # dataset, about 20 s
python3 tools/mlrates.py engine                # engine v3 expectations for every row (node), about 40 s
python3 tools/mlrates.py fit                   # selection, CV, validation, exports: ~12 min wall on a loaded machine
python3 tools/mlrates.py sim --period train    # 2019-2023 simulator check with out-of-fold rates
python3 tools/mlrates.py sim --period val      # 2024-2025 simulator check with the dev model (+ recalibration)
node tests/test_mlrates.js                     # 45 checks
```

Every training job runs single-threaded (OpenMP/BLAS/torch threads = 1). On this shared 4-core machine at load
~45, two LightGBM threads ran 10x slower than one. The fit used about 12 minutes of CPU.

## Caveats and next steps

- Selection effects: realised per-minute rates in short fights (finishes) are noisy and selected. The Poisson
  exposure handles the noise, not the selection.
- Opponent adjustment (tools/oppadj.py) was not available for 2010-2018 rows when this was fit; the model sees
  opposition quality only through Elo and the defensive histories. When oppadj factors exist for every training
  row, add them as features (they would also need the roster table at inference).
- The engine's static expectation ignores pace, stamina and form; the adapter matches static expectations, so
  realised simulated rates differ by the engine's own (calibrated) dynamics, the same for plain and ML.
- Body and leg accuracy: see above. Reversals and clinch accuracy carry little signal for any model.
- The model JSON adds 1.28 MB to the page. If size matters, drop the GBM component (largest part). The loss is
  small for most stats because the GLM and MLP carry most of the stack weight.
- The Volkanovski-Gaethje default matchup moves from 62% to 75% for Volkanovski with the learned rates (5
  rounds, 3,000 simulations). The no-vig market has him at about 37%. A single fight says nothing about the
  model, but the gap is a flag for the v9 market blend.
