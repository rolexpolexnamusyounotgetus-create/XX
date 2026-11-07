# v5 Calibrate A: leave-one-out train ablation of the merged components

Nov 7, 2026. Engine 5.0.0-dev as merged through v5 merge step 5 (commit 5251206). TRAIN 2019-2023 only: nothing dated 2024 or
later is simulated or scored here, and no 2026 fight is read. The Measure stage takes v5's single validation look.

## Bottom line

- **v5's defaults stay as merged except one flag: `components.v401.mlLevels` is now OFF.** Everything else keeps its merged
  default: v401 emJudge / deductions / tdCap / koTargets on, durability on, dynamics on, styles_sos SOS "wf" on (oppadj off),
  embed on, preufc on; officials and realism_sens stay off, blend_anchor stays on (it acts only in FightEngine.predict).
- **What helps on train** (removing it hurts the primary, soft-label CE vs the closing line, with a 95% interval clear of the
  +-0.0005 neutral band): embed +0.0038 [+0.0030, +0.0047], durability +0.0009 [+0.0004, +0.0015], SOS +0.0009 [+0.0004, +0.0015]
  (vs neither) and preufc +0.0004 [-0.0000, +0.0009] (point estimate worse, interval past the band; winner, 7-bin, method and
  method x round all worse without it with intervals excluding 0).
- **Neutral on the primary but kept on a secondary:** deductions (7-bin +0.0194 [+0.0067, +0.0345] without them, the draws), tdCap
  (7-bin, method and who x how x when worse without it by 0.0001-0.0002; it touches 20 of 3,998 sides) and koTargets (method x
  round +0.0027 [+0.0001, +0.0051]). dynamics is a structure component; removing it does not help (+0.0002 [-0.0005, +0.0009]).
- **mlLevels goes off.** Neutral on the primary (-0.0001 [-0.0005, +0.0004]) with no secondary worse without it, and with embed on
  its learned-path levels overshoot: TD per 15 1.380 vs 1.306 actual, control per 15 172 s vs 163 s, SUB share 18.1% vs 17.5%.
  With it off: 1.300, 164 s, 17.5%, KO 31.7% (actual 31.7%).
- **emJudge stays on as a protocol exception.** By the rule it would go off: removing it gives -0.0001 [-0.0002, -0.0000] on the
  primary (inside the band) and -0.0006 [-0.0015, +0.0000] on 7-bin. But its off state is v4's EM judging weights, fit on
  ufcstats cards from 2015 through 2026-10, which include the validation years and the vault (the v4 review's finding). Choosing
  it would put 2024-2026 data into the version that takes the validation look, so it is not an admissible arm. The train-only
  weights cost 0.0001 nats of soft CE on train.
- **SOS vs oppadj:** SOS stays. oppadj instead of SOS is +0.0005 [-0.0001, +0.0012] on the primary (better on sig landed
  deviance, -0.19 [-0.34, -0.04], and total stat lines -0.32% [-0.71, +0.07], but not on any outcome metric).
- **v3 params + learned rates is not better.** v3p -0.0001 [-0.0006, +0.0005] vs all on; its judging is broken in this engine (v3's
  10-8 rule is not in the v5 engine: 41% 10-8 rounds, 3.3% draws). With the v5 judging instead (v3pj), +0.0001 [-0.0003, +0.0005]
  vs the final defaults. v4's parameter set stays.
- The final default set is exactly the `-mlLevels` arm; the confirmation run reproduces it (all - final = +0.000073, the exact
  negative of the main run's -0.000073).

## Pre-registered decision rule (written before the full run)

Arms: `all` (every component as merged) and, one at a time, `all` minus durability, dynamics, styles_sos SOS, embed, preufc and
each v401 sub-flag (a emJudge, b deductions, c mlLevels, d tdCap, e koTargets); `oppadj` (oppadj instead of SOS); and the
reviewer's `v3p` ("v3 params + learned rates"). For every arm, delta = arm minus `all` on the same fights and simulated fights
(common random numbers), with a 95% event-cluster bootstrap interval. delta > 0 on a loss means removing the component hurts.

- Primary metric: soft-label cross-entropy against the closing line (market.json p_power_close; research/model_market.md 4.11).
  Secondary: winner log loss, 7-bin log loss, method log loss, method x round and who x how x when (methodround.py's scorer),
  total stat-line deviance (mean relative deviance over sig landed, sig attempts, TD landed, control, KD).
- Neutral band: eps = 0.0005 nats, the project's usual materiality threshold (BACKLOG calib / props gates).
- **A component stays on only if removing it hurts:**
  1. delta_primary > 0 and its 95% interval is not inside [-eps, +eps] ("point estimate worse and not clearly neutral"); or
  2. delta_primary's interval is inside [-eps, +eps] (clearly neutral on the primary) and at least one secondary metric is worse
     without it with an interval excluding 0, while no secondary metric is better without it with an interval excluding 0.
  Otherwise it goes off.
- **Capability / structure components** (dynamics, the round-by-round structure the 3D show and the round props use) stay on
  unless removing them helps: delta_primary < 0 with an interval excluding 0, or a secondary metric better without them with an
  interval excluding 0 while delta_primary is not worse (point estimate <= 0).
  officials (opt-in) and realism_sens are already off as merged, so their removal arms are the `all` arm; they are not ablated.
  blend_anchor acts only in FightEngine.predict, never in matchup / simulate, so it cannot move any metric here.
- **SOS vs oppadj: keep exactly one.** SOS (the incumbent, verified) stays unless the `oppadj` arm is better on the primary
  (delta < 0) and not clearly neutral; if the primary is clearly neutral, the total stat-line deviance decides when its interval
  excludes 0, else SOS stays. The `-sos` arm (neither) is information only.
- **v3p**: v5 keeps v4's parameter set (train-only self-calibration, EM judging, v4 levels, with the v401 refits) unless v3p beats
  `all` on the primary with an interval excluding 0 and is not worse with an interval excluding 0 on winner, 7-bin or method log
  loss.
- **Confirmation:** if more than one flag changes, the final default set is run against `all` once more (leave-one-out effects are
  not additive), and reported.

## Setup

- Tool: `nice -n 5 node tools/v5_train_ablation.js --sims 300 --workers 3 --tag main`, then
  `python3 tools/v5_train_ablation_mr.py --tag main` (methodround's own per-fight losses and bootstrap).
- 1,999 train fights, both corner orders, 300 simulated fights per order and arm. Simulated fight i of fight f in order o has its
  own seed, mix(hash(id), o, seed, i), identical across arms, so arms stay paired fight by fight.
- Leak-free inputs, as tools/evalv.js: walk-forward as-of priors, out-of-fold learned rates (mlrates_oof.json), durability
  walk-forward records + train NORM (tools/durrec.js), walk-forward SOS pairs with leave-one-year-out coefficients
  (tools/sosrec.js), embedding etas with leave-one-year-out blend coefficients, oppadj and pre-UFC snapshots (tools/mlpathrec.js).
  Each arm asserts its inputs were applied.
- Metrics use evalv's definitions and smoothing. 2,000 event-date cluster resamples, the same for every arm and metric.

## Results (main run: every arm vs all on)

Run: 1999 fights x 2 orders x 300 sims per arm, 211 event-date clusters, 2000 bootstrap resamples, errors 0, wall 369 s.
Engine 5.0.0-dev (sha256 923ffd1bb85e...), params 5.0.0-dev.5-selfcal-pre2024 (sha256 b63ee9ab7040...).

### Levels of the reference arm, as merged (all on) (train, 95% event-cluster intervals)

| metric | as merged (all on) |
|---|---|
| Soft-label CE vs the close (n 1999) | 0.6641 [0.6607, 0.6674] |
| Winner log loss (n 1952) | 0.6555 [0.6461, 0.6656] |
| Brier (n 1952) | 0.2319 [0.2275, 0.2368] |
| Accuracy (n 1952) | 0.6145 [0.5935, 0.6361] |
| 7-bin log loss (n 1972) | 1.6313 [1.6005, 1.6628] |
| Method log loss (n 1972) | 0.9580 [0.9348, 0.9822] |
| Method x round (methodround) | 1.4871 [1.4400, 1.5343]; model S 1.4811, all - S +0.0060 [-0.0047, +0.0176] |
| Who x how x when (methodround) | 2.1621 [2.1102, 2.2145]; model S 2.1523, all - S +0.0098 [-0.0071, +0.0273] |

### Paired differences: arm minus as merged (all on) (> 0 = removing the component hurts; bold = 95% interval excludes 0)

| arm (removed / changed) | soft CE vs close | winner LL | 7-bin | method | method x round | who x how x when | stat lines (% rel.) | rule verdict |
|---|---|---|---|---|---|---|---|---|
| durability | **+0.0009 [+0.0004, +0.0015]** | +0.0008 [-0.0014, +0.0027] | **+0.0065 [+0.0020, +0.0108]** | +0.0027 [-0.0002, +0.0056] | +0.0008 [-0.0031, +0.0049] | **+0.0068 [+0.0013, +0.0121]** | **+0.42 [+0.12, +0.72]** | keep (primary worse without it) |
| dynamics | +0.0002 [-0.0005, +0.0009] | -0.0012 [-0.0042, +0.0015] | +0.0032 [-0.0045, +0.0117] | -0.0000 [-0.0037, +0.0038] | +0.0039 [-0.0027, +0.0111] | +0.0118 [-0.0007, +0.0265] | +0.26 [-0.12, +0.63] | keep (structure; removal does not help) |
| styles_sos SOS (neither SOS nor oppadj) | **+0.0009 [+0.0004, +0.0015]** | +0.0015 [-0.0008, +0.0036] | **+0.0133 [+0.0041, +0.0243]** | +0.0026 [-0.0000, +0.0052] | +0.0030 [-0.0019, +0.0082] | +0.0125 [-0.0001, +0.0277] | **+0.26 [+0.01, +0.50]** | information (exactly one of SOS / oppadj stays) |
| oppadj instead of SOS | +0.0005 [-0.0001, +0.0012] | +0.0013 [-0.0014, +0.0038] | +0.0002 [-0.0056, +0.0058] | +0.0001 [-0.0031, +0.0032] | -0.0004 [-0.0057, +0.0050] | +0.0009 [-0.0089, +0.0107] | -0.32 [-0.71, +0.07] | SOS stays (oppadj not better) |
| embed | **+0.0038 [+0.0030, +0.0047]** | +0.0027 [-0.0003, +0.0056] | +0.0094 [-0.0001, +0.0211] | +0.0007 [-0.0025, +0.0038] | +0.0048 [-0.0008, +0.0104] | **+0.0150 [+0.0026, +0.0285]** | **+0.48 [+0.14, +0.85]** | keep (primary worse without it) |
| preufc | +0.0004 [-0.0000, +0.0009] | **+0.0034 [+0.0015, +0.0051]** | **+0.0123 [+0.0048, +0.0202]** | **+0.0061 [+0.0012, +0.0108]** | **+0.0071 [+0.0021, +0.0123]** | **+0.0126 [+0.0028, +0.0218]** | **+0.29 [+0.05, +0.52]** | keep (primary worse without it) |
| v401 (a) emJudge | **-0.0001 [-0.0002, -0.0000]** | -0.0000 [-0.0002, +0.0002] | -0.0006 [-0.0015, +0.0000] | +0.0000 [-0.0000, +0.0000] | +0.0000 [-0.0000, +0.0000] | -0.0006 [-0.0016, +0.0000] | +0.00 [+0.00, +0.00] | off |
| v401 (b) deductions | **+0.0000 [+0.0000, +0.0001]** | +0.0001 [-0.0000, +0.0002] | **+0.0194 [+0.0067, +0.0345]** | -0.0000 [-0.0000, -0.0000] | -0.0000 [-0.0000, +0.0000] | **+0.0193 [+0.0066, +0.0337]** | +0.00 [+0.00, +0.00] | keep (primary neutral; secondary worse without it) |
| v401 (c) mlLevels | -0.0001 [-0.0005, +0.0004] | +0.0003 [-0.0015, +0.0021] | +0.0005 [-0.0046, +0.0056] | -0.0000 [-0.0026, +0.0026] | +0.0032 [-0.0015, +0.0081] | +0.0067 [-0.0042, +0.0181] | -0.06 [-0.25, +0.14] | off |
| v401 (d) tdCap | +0.0000 [-0.0000, +0.0001] | +0.0001 [-0.0000, +0.0003] | **+0.0002 [+0.0000, +0.0004]** | **+0.0001 [+0.0000, +0.0003]** | +0.0001 [+0.0000, +0.0002] | **+0.0002 [+0.0000, +0.0005]** | +0.01 [-0.00, +0.04] | keep (primary neutral; secondary worse without it) |
| v401 (e) koTargets | +0.0001 [-0.0001, +0.0003] | +0.0000 [-0.0008, +0.0008] | +0.0021 [-0.0003, +0.0044] | +0.0002 [-0.0011, +0.0016] | **+0.0027 [+0.0001, +0.0051]** | +0.0027 [-0.0033, +0.0079] | +0.03 [-0.06, +0.12] | keep (primary neutral; secondary worse without it) |
| v3 params + learned rates | -0.0001 [-0.0006, +0.0005] | -0.0010 [-0.0033, +0.0013] | +0.0076 [-0.0015, +0.0166] | -0.0016 [-0.0049, +0.0016] | -0.0008 [-0.0062, +0.0049] | +0.0098 [-0.0019, +0.0213] | +0.10 [-0.22, +0.41] | v4 parameter set stays |

### Stat-line deviance per target (arm minus as merged (all on), per fighter; bold = interval excludes 0)

| arm | sig_lnd | sig_att | td_lnd | td_att | ctrl | kd | h_lnd | sub_att |
|---|---|---|---|---|---|---|---|---|
| as merged (all on) level | 23.462 | 48.749 | 1.717 | 3.169 | 153.103 | 0.698 | 17.583 | 0.883 |
| durability | **+0.152 [+0.001, +0.297]** | +0.237 [-0.073, +0.531] | **+0.007 [+0.003, +0.011]** | **+0.012 [+0.002, +0.021]** | +0.33 [-0.06, +0.73] | +0.003 [-0.002, +0.007] | **+0.120 [+0.017, +0.220]** | -0.000 [-0.002, +0.002] |
| dynamics | +0.013 [-0.177, +0.187] | +0.028 [-0.378, +0.390] | +0.005 [-0.001, +0.011] | **+0.016 [+0.004, +0.028]** | +0.51 [-0.02, +1.02] | +0.004 [-0.001, +0.009] | -0.015 [-0.147, +0.108] | -0.000 [-0.005, +0.004] |
| styles_sos SOS (neither SOS nor oppadj) | -0.018 [-0.143, +0.099] | +0.007 [-0.233, +0.239] | **+0.010 [+0.003, +0.016]** | +0.016 [-0.000, +0.031] | **+0.74 [+0.13, +1.32]** | +0.002 [-0.000, +0.004] | -0.011 [-0.095, +0.074] | +0.001 [-0.002, +0.005] |
| oppadj instead of SOS | **-0.188 [-0.336, -0.038]** | -0.317 [-0.629, +0.003] | +0.001 [-0.011, +0.012] | +0.004 [-0.020, +0.029] | -0.72 [-2.10, +0.59] | +0.002 [-0.001, +0.005] | **-0.137 [-0.241, -0.035]** | -0.000 [-0.005, +0.004] |
| embed | +0.095 [-0.026, +0.222] | **+0.299 [+0.014, +0.595]** | +0.003 [-0.009, +0.015] | +0.014 [-0.010, +0.039] | **+1.50 [+0.18, +2.82]** | +0.002 [-0.001, +0.005] | +0.074 [-0.037, +0.185] | -0.000 [-0.005, +0.005] |
| preufc | -0.012 [-0.106, +0.080] | -0.023 [-0.216, +0.168] | +0.002 [-0.001, +0.005] | +0.004 [-0.001, +0.010] | +0.12 [-0.23, +0.49] | **+0.009 [+0.005, +0.014]** | -0.001 [-0.064, +0.060] | **+0.017 [+0.005, +0.028]** |
| v401 (a) emJudge | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.00 [+0.00, +0.00] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] |
| v401 (b) deductions | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.00 [+0.00, +0.00] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] | +0.000 [+0.000, +0.000] |
| v401 (c) mlLevels | -0.020 [-0.086, +0.044] | -0.064 [-0.208, +0.071] | -0.000 [-0.006, +0.006] | -0.003 [-0.016, +0.011] | -0.27 [-0.91, +0.34] | +0.001 [-0.001, +0.003] | -0.017 [-0.062, +0.028] | +0.001 [-0.004, +0.005] |
| v401 (d) tdCap | -0.000 [-0.003, +0.003] | -0.001 [-0.010, +0.008] | +0.001 [-0.000, +0.004] | **+0.003 [+0.000, +0.008]** | -0.00 [-0.05, +0.04] | **-0.000 [-0.000, -0.000]** | +0.001 [-0.000, +0.006] | -0.000 [-0.000, +0.000] |
| v401 (e) koTargets | +0.015 [-0.023, +0.055] | +0.004 [-0.071, +0.080] | +0.001 [-0.001, +0.003] | -0.000 [-0.003, +0.003] | -0.01 [-0.16, +0.16] | +0.000 [-0.002, +0.002] | +0.008 [-0.019, +0.035] | -0.000 [-0.002, +0.001] |
| v3 params + learned rates | +0.110 [-0.073, +0.297] | -0.038 [-0.285, +0.199] | -0.002 [-0.010, +0.006] | -0.002 [-0.021, +0.017] | -0.08 [-0.65, +0.47] | +0.002 [-0.001, +0.005] | +0.098 [-0.049, +0.243] | +0.001 [-0.004, +0.006] |

### Other methodround metrics (arm minus as merged (all on))

| arm | finish | round_given_fin | ko_vs_sub | method_given_winner | method3 |
|---|---|---|---|---|---|
| as merged (all on) level | 0.6629 | 1.0742 | 0.5994 | 0.9348 | 0.9580 |
| durability | **+0.0023 [+0.0002, +0.0046]** | +0.0006 [-0.0035, +0.0046] | +0.0007 [-0.0029, +0.0044] | **+0.0053 [+0.0017, +0.0088]** | +0.0027 [-0.0003, +0.0056] |
| dynamics | +0.0010 [-0.0019, +0.0039] | +0.0003 [-0.0076, +0.0085] | -0.0021 [-0.0077, +0.0033] | +0.0006 [-0.0045, +0.0062] | -0.0000 [-0.0038, +0.0039] |
| styles_sos SOS (neither SOS nor oppadj) | +0.0003 [-0.0015, +0.0021] | +0.0022 [-0.0036, +0.0083] | **+0.0047 [+0.0009, +0.0086]** | +0.0036 [-0.0000, +0.0074] | +0.0026 [-0.0000, +0.0053] |
| oppadj instead of SOS | -0.0006 [-0.0027, +0.0014] | +0.0004 [-0.0059, +0.0068] | +0.0013 [-0.0032, +0.0062] | -0.0002 [-0.0048, +0.0044] | +0.0001 [-0.0030, +0.0033] |
| embed | +0.0009 [-0.0015, +0.0032] | **+0.0071 [+0.0012, +0.0130]** | -0.0005 [-0.0052, +0.0044] | -0.0016 [-0.0061, +0.0028] | +0.0007 [-0.0024, +0.0039] |
| preufc | +0.0013 [-0.0016, +0.0043] | +0.0018 [-0.0014, +0.0054] | **+0.0096 [+0.0016, +0.0173]** | **+0.0089 [+0.0016, +0.0157]** | **+0.0061 [+0.0013, +0.0106]** |
| v401 (a) emJudge | +0.0000 [-0.0000, +0.0000] | +0.0000 [-0.0000, +0.0000] | -0.0000 [-0.0000, +0.0000] | +0.0000 [-0.0002, +0.0002] | +0.0000 [-0.0000, +0.0000] |
| v401 (b) deductions | -0.0000 [-0.0000, +0.0000] | +0.0000 [-0.0000, +0.0000] | +0.0000 [-0.0000, +0.0000] | -0.0001 [-0.0003, +0.0001] | -0.0000 [-0.0000, +0.0000] |
| v401 (c) mlLevels | -0.0001 [-0.0021, +0.0017] | +0.0040 [-0.0012, +0.0095] | +0.0002 [-0.0032, +0.0039] | -0.0010 [-0.0047, +0.0028] | -0.0000 [-0.0026, +0.0026] |
| v401 (d) tdCap | +0.0000 [-0.0000, +0.0001] | -0.0001 [-0.0003, +0.0000] | **+0.0002 [+0.0000, +0.0004]** | **+0.0001 [+0.0000, +0.0003]** | **+0.0001 [+0.0000, +0.0003]** |
| v401 (e) koTargets | +0.0004 [-0.0005, +0.0013] | +0.0030 [-0.0003, +0.0062] | -0.0004 [-0.0023, +0.0014] | +0.0013 [-0.0006, +0.0031] | +0.0002 [-0.0011, +0.0015] |
| v3 params + learned rates | -0.0007 [-0.0033, +0.0018] | +0.0018 [-0.0041, +0.0083] | -0.0019 [-0.0067, +0.0029] | -0.0019 [-0.0062, +0.0023] | -0.0016 [-0.0050, +0.0016] |

### Base rates (simulated, train fights; actual in the first row)

| arm | finish | KO | SUB | draw | R1/R2/R3 (3 rd) | R1..R5 (5 rd) | KD/100 head | UD/SD/MD | 10-8 | sig/15 | TD/15 | ctrl/15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| actual | 49.2 | 31.7 | 17.5 | 1.01 | 24.4/16.7/7.5 | 17.3/16.5/9.5/5.3/4.9 | 0.782 | 78.6/19.4/2.0 | 5.29 | 61.1 | 1.306 | 163.0 |
| as merged (all on) | 49.4 | 31.3 | 18.1 | 0.60 | 25.7/13.7/8.9 | 19.7/15.5/9.2/8.1/4.7 | 0.756 | 79.4/19.7/0.9 | 4.58 | 61.6 | 1.380 | 172.2 |
| durability | 49.1 | 31.0 | 18.1 | 0.61 | 25.4/13.7/8.9 | 19.6/15.6/9.4/8.1/4.8 | 0.747 | 79.4/19.7/0.9 | 4.58 | 61.6 | 1.381 | 172.3 |
| dynamics | 49.1 | 31.2 | 17.9 | 0.64 | 25.4/14.3/9.0 | 14.7/12.8/10.4/9.2/5.4 | 0.783 | 79.5/19.6/1.0 | 4.55 | 61.3 | 1.385 | 172.4 |
| styles_sos SOS (neither SOS nor oppadj) | 49.4 | 31.3 | 18.1 | 0.60 | 25.8/13.7/8.9 | 19.5/15.5/9.3/7.9/4.7 | 0.757 | 79.4/19.7/0.9 | 4.58 | 61.6 | 1.376 | 171.9 |
| oppadj instead of SOS | 49.3 | 31.3 | 18.0 | 0.60 | 25.8/13.6/8.8 | 19.7/15.4/9.3/7.9/4.6 | 0.755 | 79.5/19.6/0.9 | 4.59 | 61.5 | 1.395 | 172.5 |
| embed | 49.1 | 32.0 | 17.1 | 0.62 | 25.4/13.6/8.9 | 19.6/15.5/9.5/8.0/4.7 | 0.745 | 79.4/19.7/0.9 | 4.70 | 61.9 | 1.308 | 164.3 |
| preufc | 50.1 | 31.5 | 18.5 | 0.60 | 26.1/13.9/9.1 | 19.6/15.5/9.3/8.1/4.7 | 0.770 | 79.3/19.8/0.9 | 4.55 | 61.5 | 1.379 | 171.8 |
| v401 (a) emJudge | 49.4 | 31.3 | 18.1 | 0.60 | 25.7/13.7/8.9 | 19.7/15.5/9.2/8.1/4.7 | 0.756 | 79.4/19.7/0.9 | 4.52 | 61.6 | 1.380 | 172.2 |
| v401 (b) deductions | 49.4 | 31.3 | 18.1 | 0.22 | 25.7/13.7/8.9 | 19.7/15.5/9.2/8.1/4.7 | 0.756 | 79.4/20.1/0.4 | 3.47 | 61.6 | 1.380 | 172.2 |
| v401 (c) mlLevels | 49.2 | 31.7 | 17.5 | 0.59 | 25.6/13.6/8.9 | 19.7/15.6/9.4/7.9/4.6 | 0.759 | 79.0/20.1/0.9 | 4.47 | 61.5 | 1.300 | 163.6 |
| v401 (d) tdCap | 49.4 | 31.3 | 18.1 | 0.60 | 25.7/13.7/8.9 | 19.7/15.5/9.2/8.1/4.7 | 0.756 | 79.4/19.7/0.9 | 4.58 | 61.6 | 1.381 | 172.2 |
| v401 (e) koTargets | 49.5 | 31.4 | 18.0 | 0.61 | 25.8/13.7/8.8 | 19.8/15.6/9.2/8.1/4.7 | 0.764 | 79.4/19.7/0.9 | 4.61 | 61.6 | 1.378 | 171.7 |
| v3 params + learned rates | 47.9 | 31.0 | 16.9 | 3.26 | 24.6/13.4/8.8 | 18.8/15.2/9.2/8.2/4.8 | 0.698 | 79.8/12.0/8.3 | 40.83 | 63.8 | 1.262 | 163.2 |

ML (learned rates) applied: all 100.0%, -durability 100.0%, -dynamics 100.0%, -sos 100.0%, oppadj 100.0%, -embed 100.0%, -preufc 100.0%, -emJudge 100.0%, -deductions 100.0%, -mlLevels 100.0%, -tdCap 100.0%, -koTargets 100.0%, v3p 100.0%

## Confirmation run (vs the final defaults)

Run: 1999 fights x 2 orders x 300 sims per arm, 211 event-date clusters, 2000 bootstrap resamples, errors 0, wall 117 s.

#### Paired differences: arm minus final defaults (> 0 = removing the component hurts; bold = 95% interval excludes 0)

| arm (removed / changed) | soft CE vs close | winner LL | 7-bin | method | method x round | who x how x when | stat lines (% rel.) | rule verdict |
|---|---|---|---|---|---|---|---|---|
| as merged (all on) | +0.0001 [-0.0004, +0.0005] | -0.0003 [-0.0021, +0.0015] | -0.0005 [-0.0056, +0.0047] | +0.0000 [-0.0026, +0.0026] | -0.0032 [-0.0081, +0.0015] | -0.0067 [-0.0181, +0.0042] | +0.06 [-0.14, +0.25] | confirmation |
| v3 params + learned rates, v5 judging | +0.0001 [-0.0003, +0.0005] | +0.0001 [-0.0016, +0.0019] | +0.0012 [-0.0044, +0.0067] | -0.0016 [-0.0048, +0.0016] | -0.0040 [-0.0092, +0.0015] | -0.0028 [-0.0139, +0.0075] | +0.16 [-0.11, +0.42] | v4 parameter set stays |
| v3 params + learned rates | -0.0000 [-0.0006, +0.0006] | -0.0014 [-0.0034, +0.0008] | +0.0071 [-0.0026, +0.0163] | -0.0016 [-0.0048, +0.0016] | -0.0040 [-0.0092, +0.0015] | +0.0031 [-0.0099, +0.0155] | +0.16 [-0.11, +0.42] | v4 parameter set stays |

#### Base rates (simulated, train fights; actual in the first row)

| arm | finish | KO | SUB | draw | R1/R2/R3 (3 rd) | R1..R5 (5 rd) | KD/100 head | UD/SD/MD | 10-8 | sig/15 | TD/15 | ctrl/15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| actual | 49.2 | 31.7 | 17.5 | 1.01 | 24.4/16.7/7.5 | 17.3/16.5/9.5/5.3/4.9 | 0.782 | 78.6/19.4/2.0 | 5.29 | 61.1 | 1.306 | 163.0 |
| final defaults | 49.2 | 31.7 | 17.5 | 0.59 | 25.6/13.6/8.9 | 19.7/15.6/9.4/7.9/4.6 | 0.759 | 79.0/20.1/0.9 | 4.47 | 61.5 | 1.300 | 163.6 |
| as merged (all on) | 49.4 | 31.3 | 18.1 | 0.60 | 25.7/13.7/8.9 | 19.7/15.5/9.2/8.1/4.7 | 0.756 | 79.4/19.7/0.9 | 4.58 | 61.6 | 1.380 | 172.2 |
| v3 params + learned rates, v5 judging | 47.9 | 31.0 | 16.9 | 0.62 | 24.6/13.4/8.8 | 18.8/15.2/9.2/8.2/4.8 | 0.698 | 79.3/19.8/0.9 | 4.73 | 63.8 | 1.262 | 163.2 |
| v3 params + learned rates | 47.9 | 31.0 | 16.9 | 3.26 | 24.6/13.4/8.8 | 18.8/15.2/9.2/8.2/4.8 | 0.698 | 79.8/12.0/8.3 | 40.83 | 63.8 | 1.262 | 163.2 |

ML (learned rates) applied: final 100.0%, all 100.0%, v3pj 100.0%, v3p 100.0%

## Decisions

| component / flag | merged default | rule verdict | v5 default | why |
|---|---|---|---|---|
| durability | on | keep | **on** | primary +0.0009 [+0.0004, +0.0015] without it; 7-bin, who x how x when, stat lines also worse |
| dynamics | on | keep (structure) | **on** | removal does not help on any metric |
| styles_sos sos "wf" | on | SOS stays | **on** | oppadj instead: +0.0005 [-0.0001, +0.0012]; neither: +0.0009 [+0.0004, +0.0015] |
| oppadj | off | - | **off** | exactly one of SOS / oppadj; SOS wins |
| embed | on | keep | **on** | primary +0.0038 [+0.0030, +0.0047] without it |
| preufc | on | keep | **on** | primary +0.0004 [-0.0000, +0.0009]; winner, 7-bin, method, method x round worse without it |
| v401 (a) emJudge | on | off | **on (exception)** | off state = EM weights fit on cards through 2026-10 (validation years + vault): inadmissible under the hidden-data protocol |
| v401 (b) deductions | on | keep | **on** | primary neutral; 7-bin +0.0194 [+0.0067, +0.0345] without them |
| v401 (c) mlLevels | on | off | **off** | primary neutral, no secondary worse without it; levels overshoot TD / control / SUB with embed on |
| v401 (d) tdCap | on | keep | **on** | primary neutral; 7-bin / method / joint worse without it (tiny, 20 sides) |
| v401 (e) koTargets | on | keep | **on** | primary neutral; method x round +0.0027 [+0.0001, +0.0051] without it |
| officials | off (opt-in) | not ablated | **off** | already off as merged; opt-in per call for named officials |
| realism_sens | off | not ablated | **off** | already off; refit on v5 before any use |
| blend_anchor | on | not ablated | **on** | predict only; never touches matchup / simulate |
| parameter set | v4 (selfcal pre-2024, EM judging, v4 levels) | v4 stays | **v4** | v3p / v3pj not better on the primary |

src/params3.js carries the new default (`components.v401.mlLevels: false`), the per-flag Calibrate A numbers in the comments and
the label "5.0.0-dev.6-selfcal-pre2024". The engine code is unchanged (tests/test_v5_calA.js).

What mlLevels off means in the engine: matchupBase puts back v4.0.0's values for the (c) fields before any opts.params override:
mlTdLevel / mlCtrlLevel / mlSubLevel 1 and kdScale 1.391, kdInstant 0.3673, kdRefStop 0.184, stko 0.03644, gnpTko 0.03072,
subConvScale 1.847 (koTargets' koComp factors still multiply the KO block after that). The usual fields keep the (c) values, so
`components: { v401: { mlLevels: true } }` restores the merged behaviour.

## Read this honestly

- These are train numbers (2019-2023, the tuning window). Several inputs were themselves chosen on this window: the preufc
  exponents were fit on 2015-2023 newcomer sides, the selfcal and v4 levels on 2019-2023, the SOS and embedding blends use
  leave-one-year-out coefficients (out of year, but within the window). The ablation ranks components; it is not an
  out-of-sample estimate. The Measure stage's single 2024-25 look is.
- Leave-one-out effects are not additive. Only one flag changed, so the final set is an arm that was run (`-mlLevels`).
- The soft-label CE measures distance from the closing line, not truth. It is 3-4.6x less noisy than outcome log loss
  (research/model_market.md 4.11) but rewards agreeing with the market. Every keep decision above is also supported by at least
  one outcome metric, except durability's and SOS's, which are supported by 7-bin (both) and who x how x when (durability).
- The tdCap and deductions effects are real but small: tdCap changes 20 of 3,998 sides; deductions only move decision mass
  between A, draw and B. deductions still leave train draws at 0.59% (actual 1.01%) and MD at 0.9% of decisions (actual 2.0%).
- Base-rate misfits that no flag fixes (for Calibrate B / the joint level pass): 3-round round-2 finishes 13.6% vs 16.7% actual
  and round 3 8.9% vs 7.5%; 5-round round 4 7.9% vs 5.3%; 10-8 share 4.5% vs 5.3% (cards); KD per 100 head 0.759 vs 0.782.
- The emJudge exception is the one place the ablation's verdict was overridden. If a train-only refit of the all-cards EM (cards
  2015-2023 only) is wanted as an alternative, it is exactly emJudge on; there is no clean "off".

## For the next stages

- Calibrate B (levels): run the one joint KD level pass with these defaults (mlLevels off changes kdScale / kdInstant / kdRefStop /
  stko / gnpTko / subConvScale to the v4 values; the KD per 100 head is 0.759 vs 0.782 actual). tools/v4_levels.js --write and
  tests/test_engine3.js --fit --write rewrite the usual (flag-on) fields; with mlLevels off, those writes do not reach the
  default path unless mlLevels is switched back on. Re-fit the league-average self-calibration with these flags.
- Rebuild blend_anchor's method x round cells (tools/blend_anchor_bt.js) and refit mrWeight / slope0 with these defaults.
- Measure: evalv a frozen versions/v5/ with these params; the history entry's train block should reproduce the `final` arm's
  levels to Monte Carlo error (evalv uses one rng stream per fight and order; this harness uses one seed per simulated fight).
- The page path changes only through mlLevels (Volkanovski vs Gaethje below).

## Reproduce

```
nice -n 5 node tools/v5_train_ablation.js --sims 300 --workers 3 --tag main                     # 13 arms, ~6 min
python3 tools/v5_train_ablation_mr.py --tag main
python3 tools/v5_train_ablation_report.py --tag main
nice -n 5 node tools/v5_train_ablation.js --sims 300 --workers 3 --tag confirm --ref final \
  --arms final,all,v3pj,v3p --final '{"v401":{"mlLevels":false}}'                              # ~2 min
python3 tools/v5_train_ablation_mr.py --tag confirm && python3 tools/v5_train_ablation_report.py --tag confirm
node tests/test_v5_calA.js
```
Outputs: data/derived/v5_train_ablation_main.json, v5_train_ablation_mr_main.json, v5_train_ablation_confirm.json,
v5_train_ablation_mr_confirm.json (per-fight cells and losses per arm in out/, not committed).
