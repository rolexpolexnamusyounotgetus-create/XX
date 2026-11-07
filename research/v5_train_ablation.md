# v5 Calibrate A: leave-one-out train ablation of the merged components

Nov 7, 2026. Engine 5.0.0-dev as merged through v5 merge step 5 (commit 5251206). TRAIN 2019-2023 only: nothing dated 2024 or
later is simulated or scored here, and no 2026 fight is read. The Measure stage takes v5's single validation look.

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

## Results

(filled in after the run)
