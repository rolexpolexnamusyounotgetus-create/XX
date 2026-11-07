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

## Results

### (1) Joint level pass

Run: `nice -n 5 node tools/v5_calB_levels.js fit --iters 6 --sims 60 --final-sims 200 --trace 20` (data/derived/v5_calB_levels.json;
1,999 fights, ML applied to 100% of matchups, ~2 minutes). The fixed point settled by iteration 3; the last steps move only the
non-KD stoppage scale (it follows convLevel's last 0.3%).

| lever | before (Calibrate A) | after |
|---|---|---|
| dyn.kdLevel3 | 0.655 | 0.6772 |
| dyn.kdLevel5 | 0.559 | 0.5656 |
| dyn.convLevel | 1.045 | 1.0966 |
| dyn.stkoScale / gnpScale | 0.733 / 0.481 | 0.6587 / 0.4322 (x0.899) |
| judge.t108 | 8.31 | 8.176 |

Final check, 200 sims per order (actual = the same 1,999 train fights; 95% event-cluster interval of the actual):

| target / check | actual [95% CI] | before | after |
|---|---|---|---|
| KD per 15 min, 3 rounds | 0.611 [0.564, 0.662] | 0.595 | **0.613** |
| KD per 15 min, 5 rounds | 0.500 [0.404, 0.603] | 0.504 | **0.509** |
| KD per 100 head landed, 3 / 5 rounds | 0.814 / 0.641 | 0.791 / 0.621 | **0.815 / 0.627** |
| KD per 100 head landed, all | 0.782 [0.721, 0.843] | 0.759 | **0.780** |
| strike finish per KD, same round | 0.512 [0.482, 0.542] (round panel) | 0.505 | **0.511** |
| KO / SUB / DEC | 31.7 / 17.5 / 50.8% | 31.7 / 17.5 / 50.8 | 31.8 / 17.5 / 50.7 |
| 10-8 share, decision judge-rounds (cards, deductions counted) | 4.71% (2021-23) [3.83, 5.63]; 5.29% (2019-23) | 4.47 | **4.75** |
| UD / SD / MD | 78.6 / 19.4 / 2.0 [MD 1.2, 2.9] | 79.0 / 20.1 / 0.9 | 79.0 / 20.0 / 1.0 |
| draws, share of fights | 1.01% [0.60, 1.47] | 0.60 | 0.62 |
| KD per 100 standing head by round, 3 rounds (panel) | 1.47 / 0.74 / 0.44 | 1.42 / 0.69 / 0.43 | 1.47 / 0.71 / 0.44 |
| same, 5 rounds (panel) | 1.22 / 1.01 / 0.54 / 0.28 / 0.42 | 1.20 / 0.93 / 0.48 / 0.36 / 0.31 | 1.21 / 0.94 / 0.49 / 0.35 / 0.32 |
| finish share by round, 3 rounds (n 1,729) | 24.4 / 16.7 / 7.5 (R2 [15.0, 18.4]) | 25.6 / 13.6 / 8.9 | 25.9 / 13.5 / 8.8 |
| KO by round, 3 rounds | 16.1 / 10.3 / 4.2 | 17.3 / 8.2 / 4.6 | 17.6 / 8.2 / 4.6 |
| SUB by round, 3 rounds | 8.3 / 6.4 / 3.3 | 8.3 / 5.4 / 4.2 | 8.3 / 5.3 / 4.3 |
| finish share by round, 5 rounds (n 243) | 17.3 / 16.5 / 9.5 / 5.3 / 4.9 | 19.6 / 15.5 / 9.5 / 8.0 / 4.6 | 19.7 / 15.5 / 9.3 / 8.0 / 4.6 |
| standing TKO without a KD / ground TKO without a KD, share of strike KO/TKOs | 7.2% / (all ground 28.6%) | 6.6 / 17.5 | 5.8 / 15.8 |
| sig landed / TD per 15, control s per 15 | 61.1 / 1.31 / 163 | 61.5 / 1.30 / 163.5 | 61.4 / 1.30 / 163.8 |

- Every level target is now at its actual. The knockdown rise (+3% in 3-round fights) mostly closes Calibrate A's KD per 100 head
  gap (0.759 vs 0.782); conversion goes up 5% on odds, and the non-KD stoppages come down 10% to hold the KO share.
- **Judging.** One lever, t108, aimed at the 2021-2023 card-implied 10-8 share. Majority decisions and draws stay low, and no level
  fixes them: on the 2019-2023 cards MDs do not follow 10-8s (2020: 5.8% 10-8, 0 MDs in 182 decisions; 2022: 4.0%, 3.6%), and
  thresholds that push 10-8s to 5.4% / 6.6% only lift MDs to 1.1% / 1.3% and draws to 0.71% / 0.82%. A structural item for v8.
- **Round shape (not a level; for v6).** 3-round fights finish too often in round 1 and too rarely in round 2 for KO and SUB alike
  (R2 13.5% vs 16.7%, below the actual's interval), with R3 a little high; 5-round R4 8.0% vs 5.3%. KD per standing head by round
  matches, so the gap sits in conversion / non-KD stoppage / submission timing or in fight-level heterogeneity, not in knockdowns.

Paired train effect of the pass (tools/v5_train_ablation.js --arms all,-calB --tag calB: 1,999 fights x 2 orders x 300 sims, one
seed per simulated fight; delta = calB off minus calB on, > 0 = the pass helps):

| metric | delta [95% CI] |
|---|---|
| soft-label CE vs the close | +0.0001 [-0.0000, +0.0002] |
| winner log loss | +0.0002 [-0.0002, +0.0006] |
| 7-bin | -0.0001 [-0.0017, +0.0014] |
| method | -0.0000 [-0.0008, +0.0008] |
| method x round (methodround) | -0.0008 [-0.0024, +0.0007] |
| who x how x when (methodround) | -0.0042 [-0.0120, +0.0007] |
| stat lines (mean relative deviance) | -0.07% [-0.12, -0.01] (sig attempts -0.07, sig landed -0.03 per fighter) |

The pass is outcome-neutral on train (every interval includes 0 except a 0.07% stat-line cost from the slightly shorter fights).
It is a realism calibration of the levels, as the brief asked, not a score gain.

### (2) Global-scale re-tune: nothing adopted

`nice -n 5 python3 tools/mlcal.py tune --spec tools/mlcal_spec_engine5.json --no-val --workers 3` (data/derived/mlcal_candidates_v5.json;
30 TPE trials + CMA-ES, 1,300-fight tuning window, 672-fight confirmation window, rungs 10/20/40; the baseline is the shipped
engine: subConvScale's box is centred on 1.847, the mlLevels-off value, which confirms the new injection).

| set | tuning window (40 sims) | confirmation objective | winner LL | 7-bin | base-rate penalty |
|---|---|---|---|---|---|
| baseline (Calibrate B levels) | 1.5415 | **1.5323** | **0.6679** | 1.7151 | **0.0069** |
| cma3_6 | 1.5299 | 1.5321 | 0.6706 | 1.6934 | 0.0148 |
| cma3_1 | 1.5198 | 1.5351 | 0.6751 | 1.6940 | 0.0130 |
| tpe28 | 1.5298 | 1.5390 | 0.6744 | 1.7020 | 0.0135 |

The tuning-window gains (up to -0.022) do not survive confirmation: the best confirmed candidate is 0.0002 better, under the
pre-registered 0.002, and worse on winner log loss and base rates. Same outcome as v4's search. No change.

### (3) blend_anchor rebuilt on the final engine

plain sims (200 per order) -> targets -> pilot (150 fights x 3 offsets x 400 sims) -> anchor sims (200 per order, slope0 0.771) ->
report (2,000 event-cluster resamples). data/derived/blend_anchor.json and out/blend_anchor/report.md were rewritten; the v4-engine
report is kept in out/calB/blend_anchor_before_calB.json (gitignored).

| setting | v4-engine cells | v5 (final) |
|---|---|---|
| mrWeight (LOYO optimum of the joint log loss; per-fold optima) | 0.15 (0.10-0.20) | **0.30** (0.30-0.40) |
| anchor slope0 (mix 0.5 / 1 / 1) | 0.86 (se 0.014) | **0.771** (se 0.014) |
| interval kappa80 (median bootstrap sd; raw 80% cover of the close) | 1.65 (0.297; 55%) | **2.15** (0.229; 46%), out of fold 79.6% / 94.2% |
| recalibration choice (no line) | recency h=1 + temperature | recency h=1 (params recalT stays 1: the stacker carries its own) |

Package vs simulator alone, 2019-2023 leave-one-year-out: winner -0.0143 [-0.0222, -0.0054], soft CE -0.0123 [-0.0141, -0.0105],
7-bin -0.0235 [-0.0349, -0.0118], method -0.0058 [-0.0126, +0.0008], joint method x round -0.0407 [-0.0539, -0.0275]. The joint
loss of the package is 2.1368 (v4-engine cells 2.1415). S rescaled alone vs the package: joint +0.0053 [-0.0002, +0.0104], 7-bin
+0.0076 [+0.0028, +0.0124], method +0.0044 [+0.0009, +0.0078]: the v5 cells add to the pool (the v4 cells added +0.0011, n.s.),
which is why the pool weight doubled.

### (4) Freeze

Engine VERSION "5.0.0", params "5.0.0-selfcal-pre2024". versions/v5/: engine3.js (sha256 951a7e63ce43...), params3.js
(bebc8d052fdb...), styles_sos.js, mlpathrec.js, ml/mlrates.js (40d870061947..., unchanged since v4), ml/embed.js, ml/blend.js,
ml/moe.js, ml/ml2.js, ml/mlpage.js.

### (5) Standard evaluation, TRAIN only

`nice -n 5 node tools/evalv.js --version v5 --split train --sims 300 --workers 3 --compare v4` (data/derived/evalv/v5_train.json;
the v5 entry in data/derived/version_history.json has a train block and validation null). 1,999 fights (1,952 decisive, 1,972 with
an outcome), symmetric, common random numbers, ML applied to 100% of matchups, 95% event-cluster intervals (2,000 resamples).

| train 2019-2023 | v5 [95% CI] | v5 - v4, paired [95% CI] |
|---|---|---|
| winner log loss | 0.6565 [0.6472, 0.6666] | -0.0070 [-0.0119, -0.0020] |
| Brier | 0.2324 [0.2279, 0.2371] | -0.0031 [-0.0057, -0.0007] |
| accuracy | 60.4% [58.0, 62.5] | -0.2 pts [-2.0, +1.4] |
| ECE (10 bins, mirrored; resampling spread) / calibration slope | 0.011 [0.008, 0.037] / 1.18 [1.01, 1.40] | |
| 7-bin log loss | 1.6345 [1.6022, 1.6671] | -0.0365 [-0.0540, -0.0198] |
| method log loss | 0.9578 [0.9341, 0.9832] | -0.0093 [-0.0175, -0.0013] |
| who x how x when (methodround; S 2.1523) | 2.1759; vs S +0.0236 [+0.0060, +0.0425] | -0.0272 [-0.0488, -0.0064] |
| method x round (S 1.4811) | 1.4906; vs S +0.0096 [-0.0018, +0.0210] | -0.0071 [-0.0174, +0.0032] |
| round given finish (S 1.0620) | 1.0819; vs S +0.0199 [+0.0090, +0.0310] | +0.0046 [-0.0064, +0.0158] |
| stat-line deviance: sig landed / attempts | 23.455 / 48.751 | -0.227 [-0.514, +0.067] / -0.568 [-1.173, +0.036] |
| stat-line deviance: TD / control / KD | 1.718 / 153.55 / 0.700 | -0.022 [-0.037, -0.007] / -2.92 [-4.63, -1.28] / -0.015 [-0.024, -0.006] |

| base rate, train | actual | v5 |
|---|---|---|
| finish / KO / SUB | 49.2 / 31.7 / 17.5% | 49.3 / 31.7 / 17.6 |
| finish by round, 3 rounds | 24.4 / 16.7 / 7.5 | 25.9 / 13.6 / 8.8 |
| finish by round, 5 rounds | 17.3 / 16.5 / 9.5 / 5.3 / 4.9 | 19.8 / 15.6 / 9.3 / 7.9 / 4.7 |
| KD per 100 head landed | 0.782 | 0.778 |
| decisions UD / SD / MD | 78.6 / 19.4 / 2.0 | 79.0 / 20.1 / 0.9 |
| 10-8 share (cards) | 5.29% (2021-23: 4.71%) | 4.75% |
| sig landed / TD per 15, control s per 15 | 61.1 / 1.31 / 163.0 | 61.4 / 1.30 / 163.7 |

- **Blend test:** by definition a validation measurement (the stacker fit on 2019-2023, scored on 2024-25); left to the Measure
  stage. Train-only plumbing check (`tools/evalv_blend.py --dry`: stacker fit 2019-2022, scored on the 390 decisive 2023 fights):
  v5's engine gets weight 0.25 with the line and 0.38 without, but the blend with the engine is not better on 2023: +0.0032
  [-0.0002, +0.0063] with the line, +0.0038 [-0.0014, +0.0088] without (v4's train probabilities in the same check: 0.20 / 0.21,
  +0.0026 / +0.0021). Information only (out/calB/v5_blend_dry.json).
- For the Measure stage: re-export the pre-2024 stacker with v5's train rows (BLINDTEST_MOE_ENGINE=engine_v5 after this
  evalv run; train rows only) before scoring the package with tools/predictrec.js.

## Read this honestly

- Everything here is train (2019-2023), the tuning window. The level pass fits levels to these fights' actuals, so the base-rate
  matches are in sample by construction; the paired v5 - v4 train numbers include every merged component and are not an
  out-of-sample estimate. The Measure stage's single 2024-25 look is.
- The pass is outcome-neutral on train; its value is realism (knockdowns, conversion, 10-8s at their actual levels). The known
  misfits (3-round round-2 finishes, majority decisions and draws) are structural and documented for v6 / v8.
