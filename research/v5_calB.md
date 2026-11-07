# v5 Calibrate B: joint level pass, global-scale re-tune, blend_anchor rebuild, freeze (train 2019-2023 only)

Nov 7, 2026. Engine 5.0.0-dev with the Calibrate A flags (commit 2e24835; research/v5_train_ablation.md). TRAIN 2019-2023 only:
nothing dated 2024 or later is simulated or scored in this stage, and no 2026 fight is read. The Measure stage takes v5's single
validation look.

## Pre-registered rules (written before each run)

### (1) Joint level pass (tools/v5_calB_levels.js)

- Fights: all 1,999 backtest_dev fights dated 2019-2023, both corner orders, one seed per simulated fight (Calibrate A's common
  random numbers), evalv's leak-free inputs asserted on every matchup (as-of priors, out-of-fold learned rates, durrec, sosrec,
  mlpathrec).
- One lever per target, damped fixed point from the Calibrate A values, 6 iterations at 60 sims per order, final check at 200 sims
  per order (20 of them traced for the by-round tables):
  - dyn.kdLevel3 / kdLevel5: knockdowns per format, the geometric mean of the factors matching KD per 15 minutes and KD per 100
    head strikes landed (both are listed targets; they disagree by a few percent in 5-round fights). durability.kdCal is held, so
    each format has exactly one free knockdown scale (step 2's rule: kdCal or kdLevel3/5, never both).
  - dyn.convLevel: same-round strike finish per knockdown, target 0.512 (dynamics.json kd_conversion rate_train).
  - dyn.stkoScale and gnpScale, one joint factor (their data ratio kept): the KO/TKO share of the train fights with an outcome.
  - judge.t108: the card-implied 10-8 share of decision judge-rounds (evalv's definition, deductions counted), aimed at the
    2021-2023 decisions (4.71%): v4's choice of the current judging regime inside train. The 2019-2023 value (5.29%) is reported.
- Checks, not levers: KD per 100 standing head by round (dynamics.json targets_by_round.train), finish share by round for 3 and 5
  rounds (KO class, SUB), KO / SUB / DEC, decision split, draws, non-KD stoppage composition, with the actuals' event-cluster
  bootstrap intervals.
- The values go into params.calB.set behind a new flag `components.calB` (on); calB off must reproduce the Calibrate A engine bit
  for bit (tests/test_v5_calB.js).

### (2) Global-scale re-tune (tools/mlcal.py, spec tools/mlcal_spec_engine5.json, --no-val)

- Dimensions: strikeScale, accScale, tdScale, tdOddsScale, ctrlScale, subAttScale, subConvScale, mlWeight (the v4 spec minus the
  knockdown / finish levels the joint pass just set, which the dynamics path carries in dyn.kdLevel3/5, convLevel, stkoScale /
  gnpScale, and minus caution5, which kdLevel5 replaces on knockdowns).
- New `"inject": "overrides"` mode in tools/mlcal.js: only the leaves a candidate changes reach the engine, so trial 0 is the
  shipped engine. (With the old full-tree injection, the explicit tree would silently undo v401.mlLevels off and the calB set.)
- mlcal defaults: 1,300-fight tuning window, all other train fights as the confirmation window with fresh seeds, rungs 10/20/40,
  TPE then CMA-ES, 3 finalists, objective = winner log loss + 0.5 x 7-bin log loss + base-rate penalty.
- **Adoption rule:** keep the current global scales (the v4 precedent) unless the best confirmed candidate beats the baseline (trial
  0) on BOTH windows, by at least 0.002 on the confirmation objective, and then a paired full-train run (1,999 fights x 2 orders x
  300 sims, common random numbers; tools/v5_train_ablation.js) shows it not worse on soft-label CE vs the close (point estimate
  <= 0) and not worse with an interval excluding 0 on winner, 7-bin or method log loss. An adopted candidate goes into
  params.calB.set and the joint level pass is re-run on top of it.

### (3) blend_anchor rebuild

- tools/blend_anchor_bt.js sim --stage plain -> tools/blend_anchor_eval.js targets -> tools/blend_anchor_bt.js pilot -> sim --stage
  anchor -> tools/blend_anchor_eval.js report, on the final engine (calB on, final flags), 2019-2023 only. mrWeight (the
  leave-one-year-out optimum of the joint method x round log loss) and anchor.slope0 (the pilot's slope) are set from the report.
