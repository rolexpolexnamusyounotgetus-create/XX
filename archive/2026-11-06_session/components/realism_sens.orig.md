# Component realism_sens: realism validation, division/format realism factors, sensitivity (roadmap v10)

Branch `comp/realism_sens` in worktree `/home/user/XX/.claude/worktrees/wf_7ea2629f-826-2` (local, not pushed).

- Patch (required form, against the worktree's start commit `853ce32`):
  `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/realism_sens.patch`
- Component-only patch (against `3a58472`, the 14:27 v4 snapshot):
  `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/realism_sens.component_only.patch`
- **Patch to apply on the current main v4** (the main checkout's files at 15:53 UTC; factors refit on that engine):
  `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/realism_sens.on_main_v4_1553.patch`
  (`patch -p1` from the repo root). Section "Re-application on the current v4" below has the details.

**Base.** The start commit `853ce32` held a half-written `src/engine3.js` (`matchup` undefined; the engine did not
load). Commit `3a58472` copies the main checkout's working engine v4 (`src/engine3.js`, `src/params3.js`,
`src/ml/mlrates.js`, 14:27 UTC) unchanged. The component is in commits `edc2599`, `a2c4410` and `6f118eb` on top of
it; branch head is `6f118eb`. So the required patch includes that v4 sync. The ablation and CV below ran on the 14:27
snapshot.

## What changed

| File | Change |
|---|---|
| `src/engine3.js` | `realismFactors(p, division, rounds)`: with `params.components.realism_sens` on, `params.realism.div[division]` x `params.realism.fmt[rounds]` multiply the `[selfcal]` division factors (`att kd ko sub ctrl td`) through the existing `dvf()` in `matchupBase`. `m.realism` records the factors in effect. Profiles are kept on `m._src` (non-enumerable) for rebuilds. New `sensitivity(m, opts)`, `rateSd(m, i)`, `knobSd(p)`. Exports `sensitivity`, `rateSd`, `realismFactors`. `simulate()` and `summarize()` are untouched. |
| `src/params3.js` | `components: { realism_sens: true }`; `realism: { div, fmt, disp, knobSd }` with the fitted values and sources. |
| `src/ml/mlrates.js` | One-line fix: the `leagueExpect` cache key now includes `m.p.components` and `m.realism`. Without it, flipping any component flag on the global `FightParams` (not via `opts.params`) reused a learned-rate league level built under the other setting. This affects every component, not just this one. |
| `tools/realism.js` | New. Modes `report` / `fit` / `compare` / `pool` / `disp` for any engine version (`--engine`, `--params`). |
| `tests/test_realism_sens.js` + `tests/fixtures/realism_sens_base.json` | New: 42 checks (below). |
| `tests/test_engine3.js` | `simAvg` (the `[selfcal]` league-average table and `--fit`) runs with `realism_sens` off. The realism layer is fit on top of `[selfcal]`, so `[selfcal]` must be measured and fit without it. |
| `docs/ENGINE_V3_SPEC.md`, `tools/README.md` | Component section, `sensitivity` API, tool usage. |

### Flag

`params.components.realism_sens`: `true` by default in this worktree. With `false`, the engine reproduces the engine
before the change bit for bit for the same seed. `tests/test_realism_sens.js` checks this in four ways:

1. Against the engine at git ref `3a58472`, loaded side by side. It compares 150 fights per case, one traced fight,
   a 300-fight summary and the rate tables, over four cases: Volk-Gaethje on base tables, Volk-Gaethje on learned
   rates, Makhachev-Oliveira on learned rates, and a W-SW league-average pair. Extreme realism factors are present in
   the params but ignored.
2. Against a stored digest of the same engine (in the fixture).
3. With the flag flipped on the global `FightParams` instead of through `opts.params`.
4. With the flag on but every factor set to 1, or no factors at all.

## Equations

- **Realism factors.** `dvf(k) = div_selfcal[d][k] x realism.div[d][k] x realism.fmt[R][k]`, for
  k in {att, kd, ko, sub, ctrl, td}. Each lever acts where the existing division factors act:
  - `att`: strike-attempt rates.
  - `kd`: knockdown probability per landed head strike.
  - `ko`: instant-KO and referee-stop odds, plus the standing-TKO and GNP-TKO hazards.
  - `sub`: submission conversion odds.
  - `ctrl`: control-time targets (the occupancy fit).
  - `td`: takedown attempt rate.

  The learned-rate adapter re-levels to the engine's own league expectation, which is built with the same factors.
  So the factors reach learned-rate matchups: the test confirms att x1.3 gives exactly x1.300 on the learned attempt
  targets.
- **Fit (`tools/realism.js fit`).**
  - For division d and target T (KO share, SUB share, KD per 100 landed head strikes, TD attempts per 15, control per
    15, sig attempts per minute), compute `r_d = log(real_d / sim_d)` with the flag off.
  - Sampling variance `v_d`: binomial for the shares, over-dispersed Poisson (x2) for the counts, per-fight cluster
    variance for the rates.
  - Between-division variance `tau^2` by DerSimonian-Laird around 0. Shrunk `r*_d = r_d tau^2 / (tau^2 + v_d)`.
  - Target `T*_d = sim_d exp(r*_d)`. Then damped multiplicative steps, with all levers fit jointly:
    `lever <- lever x exp(0.85 log(T*_d / sim_d) / e)`, with elasticity priors e = 0.8 (ko, sub, ctrl), 0.9 (kd, td),
    0.95 (att). Four iterations, 100 sims per fight in both corner orders.
  - Format factor `fmt["5"]`: all 5-round fights pooled, fixed prior sd 0.2 on the log ratio.
- **Profile-rate sds (`rateSd`).**
  - Rates: `sd(log rate) = sqrt(phi / I)`, where I = the fighter's events plus the shrinkage prior's pseudo-events
    (the same k values `matchup()` uses).
  - Probabilities: `sd(logit p) = sqrt(phi / (n p (1 - p)))`.
  - pow and chin are multiplied by `powExp` and `chinExp`.
  - phi is the Pearson over-dispersion of each per-fight stat against the out-of-fold learned rates on 2019-2023
    (`tools/realism.js disp`).
- **`sensitivity(m, opts)`.**
  - Each item rebuilds the matchup with the original options, multiplying `adjA`/`adjB[key]` by `exp(-/+ z sd)`.
    Judges' power is additive and floored at 0. Learned-rate matchups rebuild through `matchup()` with the same
    learned rates.
  - Every variant replays the same per-fight seeds (common random numbers). The fight-night form draws match exactly.
    `summarize()` uses one stream for all N fights, so one desynchronised fight would desynchronise the rest; per-fight
    seeding avoids that.
  - Each item returns `lo`, `hi` (P(win), the 7 bins, KO/SUB/DEC, finishes by round), `dPA`, `dPWin` (signed to "good
    for him"), `swing`, and the paired Monte Carlo `se`. Items are sorted by swing.
  - Defaults: n = 1000, z = 1, both kinds (knob, rate), both sides, keys out/acc/pow/chin/cardio/tdAtt/tdDef/sub plus
    judgePower.

## Parameter values and sources

| Parameter | Value | Source |
|---|---|---|
| `realism.disp` | att 20.5, acc 4.42, kd 1.96, td_att 2.75, td_acc 1.36, sub_att 2.26 | `tools/realism.js disp`: 1,972 scored 2019-2023 backtest fights x 2 sides vs out-of-fold learned rates (`mlrates_oof.json`) |
| `realism.knobSd` | {} (falls back to `form`: out 0.357, acc 0.478, pow/chin 0.316, cardio 0.15, grap 0.3, sub 0.8; judges' power 0.25) | fight-night form sds, walk-forward fit (params3 `form`); judges' power: its own default, a judgment call |
| `realism.fmt["5"]` | ko 0.819, sub 1.111, kd 1.361 | fit on 243 five-round fights 2019-2023. KD per 100 landed head strikes: 0.44 simulated vs 0.64 real. kd x1.36 lifts it to 0.58; ko x0.82 holds the KO share (39.5% real, 39.9% simulated) |
| `realism.div` | 12 divisions x {ko, sub, kd, td, ctrl, att} (values in `src/params3.js`) | fit on all 1,972 scored 2019-2023 fights. EB between-division sd of log(real/sim): KO 0.040, SUB 0.000, KD/head 0.125, TD att 0.094, control 0.065, sig att 0.000 |

Because SUB share and sig attempts show no between-division spread beyond noise, their targets equal the flag-off
simulation. The `sub` and `att` values (and most `ko` values) only compensate for the td / ctrl / kd / format
changes, holding those shares where they were. The levers that carry real corrections:

- `td`: x1.03 to x1.21 in 10 of 12 divisions. The engine under-shoots TD attempts by 8%.
- `ctrl`: HW x1.08, W-BW x1.59.
- `kd`: W-SW x1.14, MW x0.90, WW x0.91.
- `fmt["5"].kd`.

## Realism validation (2019-2023, 1,972 fights x 200 sims, both corner orders, OOF learned rates)

Full division and format tables: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/rs/report_off.md`
(flag off), `.../rs/fit_all.md` (fit with before/after), and `.../rs/cmp_insample_tables.md` (off and on, 200 sims).

Before / after the factors (in-sample, 200 sims; real / flag off / flag on):

| Group | n | KO% real / off / on | SUB% real / off / on | KD per 100 head real / off / on | TD att per 15 real / off / on | control s per 15 real / off / on |
|---|---|---|---|---|---|---|
| All | 1972 | 31.7 / 31.9 / 31.6 | 17.5 / 16.1 / 16.2 | 0.78 / 0.73 / 0.74 | 3.58 / 3.28 / 3.52 | 163 / 155 / 159 |
| 3-rd | 1729 | 30.7 / 31.0 / 30.4 | 18.0 / 16.5 / 16.5 | 0.81 / 0.80 / 0.78 | 3.70 / 3.39 / 3.63 | 169 / 161 / 165 |
| 5-rd | 243 | 39.5 / 38.4 / 39.9 | 14.0 / 13.2 / 13.7 | 0.64 / 0.44 / 0.58 | 3.04 / 2.82 / 3.01 | 136 / 127 / 133 |
| FLW | 94 | 33.0 / 27.3 / 27.8 | 23.4 / 19.8 / 20.3 | 1.17 / 0.87 / 0.94 | 4.30 / 4.15 / 4.27 | 166 / 156 / 161 |
| BW | 223 | 34.1 / 31.1 / 31.5 | 13.0 / 16.9 / 17.0 | 1.06 / 0.97 / 1.02 | 4.21 / 3.72 / 4.13 | 146 / 140 / 144 |
| FW | 235 | 27.7 / 30.2 / 29.5 | 16.2 / 15.2 / 15.3 | 0.77 / 0.70 / 0.73 | 3.63 / 3.61 / 3.63 | 152 / 153 / 152 |
| LW | 261 | 34.1 / 32.7 / 32.9 | 21.5 / 16.4 / 16.3 | 0.81 / 0.74 / 0.77 | 4.05 / 3.67 / 4.00 | 168 / 164 / 166 |
| WW | 252 | 28.6 / 34.6 / 33.6 | 17.1 / 15.5 / 15.5 | 0.83 / 0.94 / 0.89 | 3.35 / 3.09 / 3.32 | 160 / 152 / 158 |
| MW | 222 | 34.7 / 39.6 / 38.0 | 20.3 / 17.6 / 17.7 | 0.78 / 0.91 / 0.85 | 3.85 / 3.43 / 3.79 | 157 / 157 / 156 |
| LHW | 163 | 44.8 / 46.3 / 45.5 | 16.0 / 15.6 / 15.3 | 1.23 / 1.13 / 1.17 | 3.28 / 3.13 / 3.25 | 155 / 155 / 155 |
| HW | 157 | 51.0 / 43.1 / 44.5 | 12.1 / 10.2 / 10.4 | 0.98 / 0.83 / 0.89 | 2.49 / 2.36 / 2.45 | 153 / 139 / 147 |
| W-SW | 127 | 17.3 / 14.7 / 14.5 | 18.1 / 17.1 / 17.1 | 0.43 / 0.20 / 0.24 | 3.41 / 3.15 / 3.36 | 170 / 159 / 165 |
| W-FLW | 151 | 17.2 / 17.0 / 16.3 | 21.2 / 19.7 / 19.6 | 0.21 / 0.21 / 0.21 | 3.26 / 2.66 / 3.15 | 184 / 165 / 177 |
| W-BW | 73 | 17.8 / 16.9 / 17.0 | 13.7 / 13.3 / 13.4 | 0.30 / 0.24 / 0.24 | 2.86 / 2.63 / 2.76 | 224 / 166 / 175 |
| W-FW | 14 | 14.3 / 22.0 / 21.4 | 14.3 / 17.1 / 17.3 | 0.12 / 0.40 / 0.41 | 3.25 / 2.94 / 3.01 | 186 / 171 / 176 |

What already matched with the flag off:

- Overall method split: KO 31.7% real vs 31.9% simulated, SUB 17.5 vs 16.1, DEC 49.7 vs 50.4.
- Decision split: unanimous 78.6 vs 78.2.
- Sig attempts per 15: 131.0 vs 132.0.
- KD per 15: 0.30 vs 0.30.
- TD accuracy: 36.5 vs 36.3.
- PIT of per-fight sig landed / attempted / control: about 80% inside the 10-90% band, mean PIT about 0.50.

Miscalibrations the factors do not touch. These are hand-offs to other components:

1. **Finish timing within the round is front-loaded.** In the first 50 s of a round, 11% of real finishes vs 17%
   simulated; in the last 50 s, 22% vs 17%. Mean finish time in the round is 162 s real vs 149 s simulated. Real
   finishes ramp up through a round; the engine's hazard is flat. This belongs to dynamics: a within-round hazard
   ramp.
2. **5-round KO by round.** R4-5 KO is 7.4% (non-title) / 8.4% (title) of fights real vs 11.2% / 11.6% simulated.
   R1-R2 is under-predicted in 5-round non-title fights (R1 15.5 real vs 10.5). This matches the dynamics research.
   The format factor fixes the KD rate, not its timing.
3. **3-round finishes by round.** R2 share of finishes: 34.4% real vs 30.1% simulated. R3: 15.5% vs 19.0%. Both CIs
   exclude 0, and neither moves with the flag.
4. **Per-fight TD attempts are too narrow.** PIT: 74% inside the 80% band, 16% of real values above the simulated
   90th percentile. Fight-night form changes TD success, not TD attempts. Needs a fight-level TD-intent draw (v9
   variance). Raising the level (this component) slightly lowers the mean PIT (0.46 to 0.45).
5. **Accuracy is +1.8 points too high** (sim - real 0.0175 [0.0116, 0.0229]) and sig landed is +2.8 per 15
   [1.2, 4.3]. Simulated accuracy is higher in 11 of 12 divisions, while attempts match (EB sd 0). So it needs a
   global `accScale` or learned-accuracy re-levelling, not a division factor. No accuracy lever exists in the division
   table.
6. **Gaps EB judges as noise but worth watching.** HW KO 51.0% real vs 44.5% (z about 2). WW KO 28.6 vs 33.6.
   W-SW KD per 100 head 0.43 vs 0.24.

## Ablation: flag off vs on, training years only, common random numbers

Metrics: winner log loss (draws excluded), soft-label cross-entropy against the closing line (`p_power_close`;
3-4.6x less noisy), 7-bin log loss, method log loss (KO/SUB/DEC), Poisson stat-line deviance (10 per-side stats,
control in minutes), and the base-rate table. CIs are paired event-cluster bootstrap 95% (2,000 resamples of cards).
Both corner orders, 100 sims each (200 per fight). Inputs are leak-free: frozen snapshots, walk-forward priors,
out-of-fold learned rates. No 2024+ fight is touched; 2026 fights are dropped on load.

### In-sample (factors fit on 2019-2023, scored on 2019-2023; 1,972 fights, 211 cards)

1972 fights on 211 event cards; paired event-cluster bootstrap 95% CIs (on - off; negative = flag on better for losses).

| Metric | n | flag off | flag on | on - off | 95% CI |
|---|---|---|---|---|---|
| Winner log loss | 1952 | 0.6654 | 0.6675 | 0.0021 | [-0.0007, 0.0050] |
| Soft-label CE vs closing line | 1972 | 0.6732 | 0.6730 | -0.0002 | [-0.0010, 0.0005] |
| 7-bin log loss | 1972 | 1.6696 | 1.6694 | -0.0002 | [-0.0117, 0.0111] |
| Method log loss (KO/SUB/DEC) | 1972 | 0.9746 | 0.9713 | -0.0033 | [-0.0075, 0.0008] |
| Stat-line deviance (Poisson, per fight) | 1972 | 229.7791 | 229.1965 | -0.5826 | [-1.5357, 0.3574] |
| Brier | 1952 | 0.2364 | 0.2374 | 0.0010 | [-0.0003, 0.0023] |
| Accuracy | 1952 | 0.6009 | 0.5978 | -0.0031 | [-0.0149, 0.0101] |

Stat-line deviance by stat (point): sig_lnd 47.742 -> 47.638; sig_att 98.692 -> 98.399; h_lnd 35.942 -> 35.911; b_lnd 14.960 -> 14.941; l_lnd 13.973 -> 13.932; kd 1.447 -> 1.442; td_att 6.468 -> 6.412; td_lnd 3.490 -> 3.468; sub_att 1.800 -> 1.800; ctrl 5.263 -> 5.253

### Base rates (sim - real; |gap| change: negative = closer to the data with the flag on)

| Rate | real | off: sim - real (95% CI) | on: sim - real (95% CI) | abs gap on - off (95% CI) |
|---|---|---|---|---|
| ko | 0.3174 | 0.0017 [-0.0182, 0.0207] | -0.0014 [-0.0212, 0.0178] | -0.0002 [-0.0042, 0.0043] |
| sub | 0.1749 | -0.0136 [-0.0304, 0.0034] | -0.0132 [-0.0298, 0.0036] | -0.0004 [-0.0013, 0.0007] |
| dec | 0.5076 | 0.0119 [-0.0086, 0.0350] | 0.0147 [-0.0059, 0.0375] | 0.0027 [-0.0031, 0.0042] |
| fin3_r1 | 0.5018 | 0.0080 [-0.0261, 0.0403] | 0.0061 [-0.0276, 0.0392] | -0.0019 [-0.0035, 0.0033] |
| fin3_r2 | 0.3436 | -0.0425 [-0.0753, -0.0107] | -0.0417 [-0.0749, -0.0102] | -0.0009 [-0.0029, 0.0013] |
| fin3_r3 | 0.1546 | 0.0345 [0.0090, 0.0599] | 0.0355 [0.0099, 0.0609] | 0.0010 [-0.0011, 0.0030] |
| split | 0.2141 | 0.0041 [-0.0209, 0.0305] | 0.0013 [-0.0236, 0.0279] | -0.0028 [-0.0047, 0.0043] |
| sigL15 | 61.0872 | 2.7621 [1.2280, 4.2569] | 2.9665 [1.4302, 4.4418] | 0.2044 [0.1433, 0.2681] |
| sigAcc | 0.4663 | 0.0175 [0.0116, 0.0229] | 0.0183 [0.0124, 0.0237] | 0.0008 [0.0006, 0.0010] |
| kd15 | 0.2951 | 0.0006 [-0.0214, 0.0225] | 0.0081 [-0.0136, 0.0297] | 0.0075 [-0.0087, 0.0085] |
| kdPer100H | 0.7806 | -0.0533 [-0.1129, 0.0064] | -0.0381 [-0.0974, 0.0220] | -0.0152 [-0.0188, 0.0144] |
| td15 | 1.3049 | -0.1143 [-0.1674, -0.0584] | -0.0267 [-0.0799, 0.0285] | -0.0876 [-0.0909, -0.0303] |
| tdAcc | 0.3646 | -0.0014 [-0.0126, 0.0105] | -0.0014 [-0.0128, 0.0107] | -0.0000 [-0.0005, 0.0005] |
| ctrl15 | 163.1607 | -8.5624 [-14.2907, -2.6656] | -4.4312 [-10.1323, 1.4143] | -4.1312 [-4.4489, -1.2762] |
| sub15 | 0.3712 | -0.0391 [-0.0687, -0.0107] | -0.0303 [-0.0598, -0.0022] | -0.0088 [-0.0103, -0.0069] |

### Leave-one-year-out CV (factors fit on four years, scored on the fifth; pooled over 2019-2023)

1972 fights on 211 event cards; paired event-cluster bootstrap 95% CIs (on - off; negative = flag on better for losses).

| Metric | n | flag off | flag on | on - off | 95% CI |
|---|---|---|---|---|---|
| Winner log loss | 1952 | 0.6654 | 0.6666 | 0.0012 | [-0.0019, 0.0045] |
| Soft-label CE vs closing line | 1972 | 0.6732 | 0.6729 | -0.0003 | [-0.0012, 0.0006] |
| 7-bin log loss | 1972 | 1.6696 | 1.6738 | 0.0043 | [-0.0092, 0.0172] |
| Method log loss (KO/SUB/DEC) | 1972 | 0.9746 | 0.9767 | 0.0021 | [-0.0032, 0.0072] |
| Stat-line deviance (Poisson, per fight) | 1972 | 229.7791 | 229.3653 | -0.4138 | [-1.4432, 0.5101] |
| Brier | 1952 | 0.2364 | 0.2369 | 0.0005 | [-0.0010, 0.0020] |
| Accuracy | 1952 | 0.6009 | 0.5917 | -0.0092 | [-0.0227, 0.0044] |

Stat-line deviance by stat (point): sig_lnd 47.742 -> 47.668; sig_att 98.692 -> 98.443; h_lnd 35.942 -> 35.929; b_lnd 14.960 -> 14.944; l_lnd 13.973 -> 13.915; kd 1.447 -> 1.446; td_att 6.468 -> 6.462; td_lnd 3.490 -> 3.481; sub_att 1.800 -> 1.806; ctrl 5.263 -> 5.271

### Base rates (sim - real; |gap| change: negative = closer to the data with the flag on)

| Rate | real | off: sim - real (95% CI) | on: sim - real (95% CI) | abs gap on - off (95% CI) |
|---|---|---|---|---|
| ko | 0.3174 | 0.0017 [-0.0182, 0.0207] | -0.0022 [-0.0220, 0.0170] | 0.0006 [-0.0050, 0.0051] |
| sub | 0.1749 | -0.0136 [-0.0304, 0.0034] | -0.0098 [-0.0269, 0.0071] | -0.0037 [-0.0051, 0.0039] |
| dec | 0.5076 | 0.0119 [-0.0086, 0.0350] | 0.0121 [-0.0087, 0.0351] | 0.0002 [-0.0017, 0.0020] |
| fin3_r1 | 0.5018 | 0.0080 [-0.0261, 0.0403] | 0.0064 [-0.0274, 0.0393] | -0.0016 [-0.0034, 0.0031] |
| fin3_r2 | 0.3436 | -0.0425 [-0.0753, -0.0107] | -0.0420 [-0.0754, -0.0101] | -0.0005 [-0.0027, 0.0017] |
| fin3_r3 | 0.1546 | 0.0345 [0.0090, 0.0599] | 0.0356 [0.0099, 0.0611] | 0.0011 [-0.0010, 0.0031] |
| split | 0.2141 | 0.0041 [-0.0209, 0.0305] | 0.0009 [-0.0240, 0.0269] | -0.0032 [-0.0051, 0.0047] |
| sigL15 | 61.0872 | 2.7621 [1.2280, 4.2569] | 2.8893 [1.3436, 4.3969] | 0.1272 [0.0620, 0.1896] |
| sigAcc | 0.4663 | 0.0175 [0.0116, 0.0229] | 0.0182 [0.0123, 0.0237] | 0.0007 [0.0005, 0.0009] |
| kd15 | 0.2951 | 0.0006 [-0.0214, 0.0225] | 0.0096 [-0.0128, 0.0314] | 0.0089 [-0.0101, 0.0107] |
| kdPer100H | 0.7806 | -0.0533 [-0.1129, 0.0064] | -0.0336 [-0.0945, 0.0267] | -0.0197 [-0.0253, 0.0190] |
| td15 | 1.3049 | -0.1143 [-0.1674, -0.0584] | -0.0312 [-0.0850, 0.0249] | -0.0831 [-0.0877, -0.0343] |
| tdAcc | 0.3646 | -0.0014 [-0.0126, 0.0105] | -0.0017 [-0.0130, 0.0102] | 0.0002 [-0.0006, 0.0007] |
| ctrl15 | 163.1607 | -8.5624 [-14.2907, -2.6656] | -4.8297 [-10.6302, 0.9947] | -3.7327 [-4.1169, -1.6402] |
| sub15 | 0.3712 | -0.0391 [-0.0687, -0.0107] | -0.0314 [-0.0613, -0.0030] | -0.0077 [-0.0095, -0.0056] |

Per held-out year (on - off, 95% CI):

| Year | Winner LL | Soft CE | 7-bin LL | Method LL |
|---|---|---|---|---|
| 2019 | -0.0038 [-0.0099, 0.0022] | 0.0006 [-0.0011, 0.0022] | 0.0080 [-0.0244, 0.0535] | 0.0007 [-0.0082, 0.0102] |
| 2020 | 0.0023 [-0.0045, 0.0083] | 0.0002 [-0.0013, 0.0020] | -0.0064 [-0.0278, 0.0143] | -0.0029 [-0.0133, 0.0076] |
| 2021 | -0.0028 [-0.0104, 0.0049] | -0.0017 [-0.0035, -0.0000] | 0.0022 [-0.0166, 0.0219] | 0.0087 [-0.0040, 0.0228] |
| 2022 | 0.0029 [-0.0033, 0.0089] | -0.0014 [-0.0033, 0.0007] | 0.0251 [0.0027, 0.0545] | 0.0037 [-0.0093, 0.0182] |
| 2023 | 0.0077 [-0.0008, 0.0169] | 0.0010 [-0.0014, 0.0034] | -0.0100 [-0.0485, 0.0159] | -0.0011 [-0.0103, 0.0082] |

## Sensitivity example (Volk vs Gaethje, LW 5-round title, learned rates, flag on; n = 1,500, seed 11)

The base summary is P(Volk) 67.5%, KO 32.8%, SUB 7.5%, DEC 59.7%. The run took 46 s for 63 variants on this
machine (load average about 40 on 4 cores). Top items:

| Item | sd | multipliers | P(Volk) at -1 sd | at +1 sd | swing | MC se | KO share -1/+1 | SUB share -1/+1 |
|---|---|---|---|---|---|---|---|---|
| Justin Gaethje: striking output (knob) | 0.357 | 0.70 / 1.43 | 80.7% | 50.8% | 29.9 | 1.4 | 31.3 / 39.3 | 6.6 / 7.1 |
| Alexander Volkanovski: striking output (knob) | 0.357 | 0.70 / 1.43 | 54.3% | 77.0% | 22.7 | 1.3 | 29.0 / 42.3 | 6.5 / 6.9 |
| Justin Gaethje: knockdown power (estimate) | 0.689 | 0.50 / 1.99 | 74.1% | 54.5% | 19.5 | 1.1 | 27.9 / 43.9 | 7.2 / 7.2 |
| Justin Gaethje: striking accuracy (knob) | 0.478 | 0.62 / 1.61 | 77.6% | 58.7% | 18.9 | 1.3 | 31.3 / 36.4 | 7.0 / 6.5 |
| Alexander Volkanovski: striking accuracy (knob) | 0.478 | 0.62 / 1.61 | 58.1% | 73.6% | 15.5 | 1.4 | 31.4 / 36.8 | 7.3 / 7.3 |
| Alexander Volkanovski: knockdown power (estimate) | 0.939 | 0.39 / 2.56 | 61.6% | 76.2% | 14.6 | 1.1 | 23.7 / 53.1 | 7.1 / 7.2 |
| Justin Gaethje: striking output (estimate) | 0.140 | 0.87 / 1.15 | 71.5% | 61.1% | 10.3 | 1.2 | 31.8 / 35.2 | 7.6 / 7.1 |
| Justin Gaethje: knockdown power (knob) | 0.316 | 0.73 / 1.37 | 71.1% | 61.2% | 9.9 | 0.9 | 29.4 / 37.7 | 7.0 / 7.2 |
| Alexander Volkanovski: striking output (estimate) | 0.134 | 0.87 / 1.14 | 62.1% | 71.5% | 9.3 | 1.2 | 31.5 / 34.6 | 7.3 / 8.0 |
| Alexander Volkanovski: chin (KD susceptibility) (estimate) | 0.415 | 0.66 / 1.51 | 69.9% | 61.1% | 8.9 | 0.9 | 30.2 / 37.3 | 7.7 / 7.1 |
| Justin Gaethje: submission threat (estimate) | 1.427 | 0.24 / 4.17 | 68.9% | 61.2% | 7.7 | 0.9 | 33.2 / 31.1 | 5.9 / 15.3 |
| Justin Gaethje: striking accuracy (estimate) | 0.145 | 0.86 / 1.16 | 72.3% | 65.3% | 7.1 | 1.1 | 32.3 / 35.6 | 7.3 / 6.5 |
| Alexander Volkanovski: knockdown power (knob) | 0.316 | 0.73 / 1.37 | 64.6% | 70.9% | 6.3 | 0.9 | 29.1 / 38.7 | 7.6 / 7.8 |
| Alexander Volkanovski: chin (KD susceptibility) (knob) | 0.316 | 0.73 / 1.37 | 69.5% | 63.2% | 6.3 | 0.8 | 30.1 / 36.2 | 7.6 / 7.6 |

(31 items in all; the rest swing under 3 points.)

Full JSON: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/rs/tornado_vg.json`.

## Tests

`node tests/test_realism_sens.js`: 42 passed. It covers:

- The flag-off equivalence (four ways, above), and m.realism / _src.
- Factor combination, and factor direction (ko/sub/att/kd).
- Factors reaching the learned-rate targets, and no stale league cache on global flips.
- `sensitivity`: item count, sort, determinism, knob directions, multipliers, CRN se below the independent-runs se,
  speed, learned-rate matchups, error without profiles.
- `rateSd` monotonicity and phi scaling.
- The `tools/realism.js` helpers: resultBin, deviance, EB shrinkage, paired bootstrap.

`node tests/test_director3.js`: OK. `node tests/test_engine3.js`: everything passes except "API surface". That check
expects `VERSION === "3.0.0"` and already fails on the synced v4 base, before this change. With the realism layer
left on, the `[selfcal]` league-average table would miss the KO tolerance in FW, WW and MW by 3.6-5.1 points. Hence
the `simAvg` change: `[selfcal]` is fit and checked with the layer off.

## Risks and interactions

- **Refit last.** The factors are a residual layer, fit on the current engine. Durability (chin / power), dynamics
  (KD hazard by round, within-round ramp), officials (judging) and anything else that moves KO / SUB / KD / TD levels
  would be double-corrected by stale factors. Order for v5: the other components, then `[selfcal]` with this flag
  off, then `tools/realism.js fit`, then the single v5 validation. The fit takes about 9 minutes at load 40.
- **Mostly compensation.** EB found no real between-division signal for SUB share or attempts and very little for KO.
  The factors that move things are td / ctrl / kd / fmt.kd. Prediction gains should not be expected. The value is in
  stat-line realism (TD, control, KD per head strike in 5-rounders) and in keeping method shares honest.
- **Control elasticity is low in places.** W-BW `ctrl` 1.588 moves control only 166 to 175 s (target 191), because the
  occupancy fit saturates. Factor values are not effect sizes.
- **`[selfcal]` interplay.** `tests/test_engine3.js` now measures `[selfcal]` with the layer off. If the v4 workflow
  re-runs `--fit --write`, keep that change (or pass the flag off) so the realism factors are not absorbed into
  `[selfcal]`.
- **The `mlrates.js` cache-key change** touches a v4 file (one line). It is needed by every component toggled through
  the global params.
- **Fixture.** `tests/fixtures/realism_sens_base.json` pins base commit `3a58472`. When re-applying on the final v4,
  regenerate it against the engine without this component: check out the v4 commit, apply the patch, then run
  `node tests/test_realism_sens.js --ref <v4 commit> --write-fixture`.
- **Sensitivity sds.**
  - Rate sds come from the profile sums. With learned rates, the matchup is driven by the ML prediction (which pools
    features), so these sds overstate the uncertainty of what the simulator plays. Examples: Volk's power sd 0.94 log
    (x0.39 to x2.56), submission threat sds above 1.
  - Knob sds are the fight-night form sds, which carry model error.
  - Treat bars as "what moves the number", not as calibrated intervals.
- **Sensitivity noise and speed.** CRN is partial: after the first diverging event in a fight the streams separate. So
  the paired se is only about 20-35% below independent runs (about 1 point at n = 1,500). The page should show items
  with swing > 2 se, or use n >= 2,000.
  - Cost: 63 variants x 1,500 fights = 46 s at load 40, roughly 10 s in a browser worker on an idle machine.
  - Restrict `keys` or `kinds` for a quick tornado.
- **Not applied.** The ROADMAP's per-division realism also lists stat-line distribution shape. The tool reports it
  (PIT, per-fighter spread) but no factor targets it. Fixing the spread is v9 / dynamics work.

## Re-application on the current v4 (main checkout, 15:53 UTC, then 16:20 UTC)

The main checkout moved twice while this ran:

- By 15:53 it had `[selfcal v4]` refit on train-only priors, `tools/v4_levels.js` levels (kdScale, KO conversion,
  subConvScale, t108) and a fight-level shared judge noise.
- By 16:20 it was v4.0.1: judging weights refit on pre-2024 cards, point deductions, and the TD-multiplier cap fix in
  `mlrates.js`.

The component-only patch still applies to the engine (offsets only). `params3.js`, `test_engine3.js` (`simAvg` now
passes `priors: PRI, ml: false`) and the spec tail needed manual merges. `realism_sens.on_main_v4_1553.patch` is that
merge against the 15:53 files.

- **Factors refit on the 15:53 engine.** Same fit settings (1,972 fights, 100 sims, 4 iterations). EB between-division
  sd of log(real/sim): KO 0.064, SUB 0, KD/head 0.100, TD att 0.061, control 0.056, attempts 0. `fmt["5"]`: ko 0.856,
  sub 1.048, kd 1.296. The TD corrections are smaller (x1.00-1.14), because v4's own re-levelling closed part of the
  gap. Values are in the patch's `params3.js`. Fit output: `.../rs/v4now/fit_v4now.md`.
- **Tests on that engine** (scratch copy `.../rs/v4now/rebased`):
  - `test_realism_sens.js --ref-dir <pristine 15:53 src>`: 42/42, flag off bit for bit.
  - main's updated `test_engine3.js 6000`: 69/69. Its VERSION check is fixed upstream.
  - `test_director3.js`: OK.
- **v4.0.1 (16:20).** The same patch applies with one trivial conflict: the `tools/README.md` tail; append the
  section by hand. Flag off reproduces v4.0.1 bit for bit (`--ref-dir` against a pristine 16:20 copy). The fixture
  must be regenerated on whatever v4 the patch finally lands on: `node tests/test_realism_sens.js --ref-dir <dir with
  that v4's engine3.js, params3.js, ml/mlrates.js before the patch> --write-fixture`. The first run reports the old
  digest as a mismatch; the second is clean. v4.0.1 changes only judging and decisions, so the 15:53 factors should
  still hold, but refit them last anyway.
- **In-sample ablation on the 15:53 engine** (fresh factors, 1,972 fights x 200 sims, CRN; on - off, 95% CI):

| Metric | flag off | flag on | on - off | 95% CI |
|---|---|---|---|---|
| Winner log loss | 0.6639 | 0.6662 | +0.0023 | [-0.0005, +0.0052] |
| Soft-label CE vs close | 0.6722 | 0.6717 | -0.0004 | [-0.0013, +0.0004] |
| 7-bin log loss | 1.6922 | 1.6916 | -0.0006 | [-0.0159, +0.0141] |
| Method log loss | 0.9692 | 0.9728 | +0.0036 | [-0.0011, +0.0082] |
| Stat-line deviance | 228.99 | 228.17 | -0.82 | [-1.74, +0.08] |

  Base-rate gaps (sim - real), off to on:
  - TD landed / 15: -0.079 to -0.039 (|gap| CI [-0.042, -0.007]).
  - Control / 15: -8.3 to -4.7 s ([-3.9, -1.3]).
  - KO share: +0.007 to -0.001.
  - KD per 100 head strikes: +0.009 to -0.002.
  - Sub attempts / 15: -0.028 to -0.019.
  - 3-round R3 finish share: slightly worse (+0.003, CI [0.0006, 0.0047]).

  Full output: `.../rs/v4now/cmp_v4now.md` and `cmp_v4now_tables.md`.

## Recommendation for v5

Include it, as a capability layer, refit last. Do not count on it for prediction.

- **Predictions.** Flag on vs off is null on every prediction metric, in-sample and out of fold:
  - Winner log loss: CV +0.0012 [-0.0019, +0.0045]; in-sample +0.0021 [-0.0007, +0.0050]; on the 15:53 v4 +0.0023
    [-0.0005, +0.0052]. The point estimate is slightly worse in all three runs. The less noisy soft label is
    -0.0003 / -0.0002 / -0.0004, with CIs including 0. Treat the winner effect as zero, with a small risk of a
    +0.002 cost.
  - Soft CE vs the close: -0.0003 [-0.0012, +0.0006].
  - 7-bin: +0.0043 [-0.0092, +0.0172].
  - Method: +0.0021 [-0.0032, +0.0072].
  - Stat-line deviance: -0.41 [-1.44, +0.51].

  The division factors are small, and EB judges most division KO / SUB differences as noise. The winner is set by
  the per-matchup learned rates, not by division levels.
- **Realism.** The gains hold out of fold:
  - TD landed per 15 gap: -0.114 to -0.031 (|gap| change CI [-0.088, -0.034]).
  - Control per 15 gap: -8.6 to -4.8 s ([-4.1, -1.6]).
  - Sub attempts per 15 gap: -0.039 to -0.031 ([-0.010, -0.006]).
  - 5-round KD per 100 head strikes: 0.44 to 0.58 (real 0.64).
  - KO / SUB / DEC shares unchanged.

  Cost: sig landed per 15 is +0.13 further off (it was already +2.8 too high).

  That fits the roadmap rule "a capability checked against data without making the held-out numbers worse", provided
  the single v5 validation measurement confirms no degradation. If it shows any, set
  `components.realism_sens = false`. The flag gates only the factors.
- **Ship regardless of the flag.** `FightEngine.sensitivity` / `rateSd` (tornado data for the page, no effect on
  predictions), `tools/realism.js` (the v10 realism check for any engine version), and the `mlrates.js` cache-key fix
  (needed by every component flag).
- **Order.** Merge the other v5 components, refit `[selfcal]` with this flag off, then run
  `node tools/realism.js fit --years 2019-2023 --levers ko,sub,kd,td,ctrl,att --fmt` and paste the factors into
  params3.js. Then run `compare` for the ablation and `report` for the v10 tables.
- **Hand-offs from the realism tables.** These are where the real realism gaps are; none is a division-level fix:
  - Within-round finish ramp (dynamics).
  - 5-round late-round KO excess (dynamics).
  - 3-round R2 / R3 finish split (dynamics).
  - Per-fight TD-attempt spread (v9 variance).
  - Global accuracy +1.8 points (v4 calibration).

## Reproduce

```
B=/home/user/XX/data/derived/backtest_dev.json
node tools/realism.js report  --backtest $B --years 2019-2023 --sims 200 --flag off --md report_off.md
node tools/realism.js disp    --backtest $B --years 2019-2023
node tools/realism.js fit     --backtest $B --years 2019-2023 --levers ko,sub,kd,td,ctrl,att --fmt --fmt-levers ko,sub,kd --iters 4 --fit-sims 100 --out fit_all.json
node tools/realism.js compare --backtest $B --years 2019-2023 --sims 200 --perfight pf_insample.json --tables tables.md
# leave-one-year-out: fit on four years (--years 2020,2021,2022,2023 ...), compare --years 2019 --factors fit_2019.json --perfight pf_2019.json, then
node tools/realism.js pool --in pf_2019.json,pf_2020.json,pf_2021.json,pf_2022.json,pf_2023.json
```
Driver used: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/rs/cv.sh` (all runs:
3 workers, nice -n 5; about 75 minutes in all at load average 35-50). The per-fight files and the fold fits are in
`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/rs/` and `.../rs/cv/`.
