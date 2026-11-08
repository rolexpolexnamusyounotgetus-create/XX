# Component styles_sos: style rate modifiers, strength of schedule, newcomer priors

Nov 6, 2026. Branch `comp/styles_sos` in worktree `/home/user/XX/.claude/worktrees/wf_5678b8c9-d1e-1` (not pushed).

- Worktree start commit: `853ce32` (its `src/engine3.js` was a half-written autosave: `matchup` was undefined, so the
  engine did not load).
- `a08e00c`: base sync. Copies the working engine v4 snapshot (`src/engine3.js`, `src/params3.js`, `src/ml/mlrates.js`)
  from the main checkout. No component code.
- Component commits sit on top of `a08e00c`.
- Patches:
  - `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/styles_sos.patch` is the full
    diff against `853ce32`, as asked, so it includes the base sync.
  - `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/styles_sos.component_only.patch`
    is the diff against `a08e00c`. It holds only the component and is the one to re-apply on top of the final v4.
  - `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/styles_sos.onmain.patch` is the
    same component re-applied by hand to a copy of the main checkout taken at about 4:40 pm (engine v4.0.1).
    - On that snapshot, the `src/engine3.js` hunks of the component-only patch apply as is.
    - `params3.js`, `build.py`, `test_engine3.js`, the spec and the README needed one-line context merges.
    - `tests/test_styles_sos.js` passes 36/36 there. The one check that is skipped needs this repo's git history.
    - The stripped engine equals that snapshot's `engine3.js` byte for byte.
    - Main's engine changed again after that copy, so apply with `--3way` or by hand.

## Verdict

The prediction target here is the engine v4 path, with learned stat-line rates from out-of-fold tables. All results are
from the 2019-2023 train ablation: 1,999 fights, 211 cards, both corner orders, common random numbers, paired
event-cluster bootstrap.

- **(b) Strength of schedule: include it in v5.**
  - On the learned-rate path it improves soft cross-entropy against the closing line by -0.0010 [-0.0018, -0.0001].
  - It also improves stat-line deviance by -0.48% [-0.84, -0.10]. Takedown attempts improve -1.2%, control -0.9% and
    takedowns landed -0.8%.
  - Winner log loss -0.0010 and method log loss -0.0007 are not significant. 7-bin log loss does not move.
  - On the base tables (learned rates off) it is significant on four metrics: winner -0.0045 [-0.0076, -0.0012], soft CE
    -0.0019 [-0.0028, -0.0010], 7-bin -0.0079 [-0.0156, -0.0002] and stat lines -0.40%.
  - Default source is this component's own compact walk-forward table (`sosSource: "wf"`).
  - The verified tools/oppadj.py factors are wired in as `sosSource: "oppadj"`. Against "wf" they give much better stat
    lines (learned rates -0.77% [-1.27, -0.26] more; base tables -3.3%). But they are worse on soft CE: +0.0011
    [+0.0001, +0.0021] on the learned-rate path.
- **(a) Styles, section 9 as written: leave it off on the v4/v5 path.**
  - With learned rates, all four blocks make soft CE worse by +0.0011 [+0.0001, +0.0022]. The other metrics do not move
    significantly.
  - At the rate level the learned model already holds these effects. The fitted slope on the prescribed shift is 0.30 for
    distance attempts, 0.19 for takedown attempts, 0.11 for control per takedown and 0.62 for ground strikes, where 1 would
    mean the shift adds fully. Adding the shift as given makes deviance worse for three of the four blocks.
  - On the base tables, the a = b = 1 composition the section was fit for, the blocks help the winner side a little
    (winner -0.0028, soft -0.0007, both n.s.) and hurt method (+0.0030, n.s.).
  - Defaults therefore: style blocks none with learned rates, all four on the base tables.
- **(c) Newcomer priors: skipped.** research/model_preufc.md appeared during the run but has no verification log. Its
  audit and engine sections are still placeholders (`AUDIT_BLOCK`, `ENGINE_BLOCK`), checked at the start and again
  at 4:05 pm. The flag is accepted and ignored.

## What changed

| File | Change |
|---|---|
| `src/styles_sos.js` (new) | The component. UMD `StylesSOS` with no dependencies. Entry points: `apply`, `oppadjR`, `loadSOS`, `loadOppadj`. Also holds the style features (port of `tools/styles.py Side.features`), the section-9 coefficient tables, the SOS coefficient table and the oppadj adapter. |
| `src/engine3.js` | Hook. Every line is tagged `[styles_sos]`. `getSS()` loads the module. `api.matchup` wraps v4's `matchup()` and calls `StylesSOS.apply` once the tables are final. One line at the end of `fighterRates` applies oppadj factors to R, and only does so when `sosSource` is "oppadj". With the flag on and the module missing it records `m.stylesSOS = {missing: true}`. v4's own functions are not edited. |
| `src/params3.js` | Adds `components.styles_sos = { styles: true, sos: true, newcomer: false }`. Adds the `stylesSOS` knobs: `styleScale`, `styleSet`, `styleMinZ`, `styleCenter`, `styleBlocks`, `sosScale`, `sosSource`. |
| `build.py` | The engine script tag now inlines `src/styles_sos.js`, between params3 and engine3, so the page and the Web Worker match Node. |
| `tests/test_styles_sos.js` (new, 37 checks) | Flag off is bit-for-bit (details below). Python parity of features and terms. The equations, per-path blocks, knob, sub-flags and swap symmetry. SOS and oppadj formulas. Determinism, trace parity, API and trace format. Worker-style concatenation. |
| `tests/fixtures/styles_sos_fixture.json` (new) | 30 fights from 2019-2023 with the features and terms `tools/styles.py` computes, plus the 2019-2023 term means. |
| `tests/test_engine3.js` | The worker-concatenation check now includes `styles_sos.js`, mirroring build.py. |
| `tools/sos_wf.py` (new) | Walk-forward opponent quality from data/raw, with fights before 2026-01-01 only. `build` writes `data/derived/sos_wf.json` (2,864 backtest ids, 2019-2025). `fit` fits the coefficients on 2019-2023 with leave-one-year-out CV. |
| `tools/styles_sos_offsets.js`, `tools/styles_sos_ratecheck.py`, `tools/styles_sos_ablate.js`, `tools/styles_sos_score.py` (new) | Rate-level offsets, the style rate check, the engine ablation and the scorer. |
| `data/derived/sos_wf.json`, `data/derived/styles_sos_ablation.json` (new) | The SOS table with its fit, and every ablation number in this report. |
| `docs/ENGINE_V3_SPEC.md`, `tools/README.md` | Component section and tool entries. |

### Flag-off proof

`params.components.styles_sos = false` reproduces the engine before this change bit-for-bit.

`tests/test_styles_sos.js` deletes every `[styles_sos]` line and block from `src/engine3.js` and checks the result
against `git show a08e00c:src/engine3.js` (byte-equal, 15 lines removed). It then compiles that stripped source as a
second engine. On 24 matchups (base and learned rates, both corner orders, profiles with SOS and oppadj inputs) both
engines give identical tables, traced fights and 300-fight summaries for the same seeds.

### Tests

- Passing: `tests/test_styles_sos.js` 37/37, `tests/test_director3.js` OK, `tests/test_mlrates.js` 47/47.
- `tests/test_engine3.js`: 41/42. The one failure is the "API surface" check, which wants VERSION "3.0.0". It already
  fails on the v4 snapshot `a08e00c` (VERSION "4.0.0") and is the v4 workflow's to update.

## Flags and knobs

`params.components.styles_sos`:

- `false` switches everything off.
- `{ styles, sos, newcomer }` sets each sub-flag; `true` means `{ styles: true, sos: true }`.

`params.stylesSOS`:

- `styleScale` (default 1): the `styleMatchups` knob of section 9 item 4. It scales every style shift, range 0 to 1.5.
  `opts.styleMatchups` overrides it per matchup.
- `styleSet` (default "ab1"): which coefficient set to use. "ab1" is the a = b = 1 refit, the engine's composition.
  "fit" is the free-exponent fit.
- `styleMinZ` (default 2): with "ab1", terms whose tune |z| is below this are dropped.
- `styleCenter` (default true): terms enter minus their 2019-2023 mean, which keeps the league level. Only open stance is
  not mean 0 (0.2746).
- `styleBlocks` (default `{ ml: [], base: "all" }`): which blocks run on each path.
- `sosScale` (default 1): scales every strength-of-schedule shift.
- `sosSource` (default "wf"): "wf" or "oppadj".

Every shift is recorded on `m.stylesSOS`.

## (a) Style modifiers: research/model_styles.md section 9

### Inputs

- Style z-scores come from `Side.features` on the profile's own decayed sums S and the matchup prior `m.P`. For backtest
  snapshots that prior is priors_asof of the fight year, which makes the vectors walk-forward with no extra table. They
  are standardised with styles.json `zscore` (fit on 2019-2023 sides).
- The JS port matches `tools/styles.py` to 2e-16 on 30 fixture fights. The live roster takes the same path with
  fighters.json and its priors.
- Physical terms:
  - `length_d = ((reach_X - reach_Y)/4.57407 + (height_X - height_Y)/3.74025)/2`. A part is 0 when either value is missing.
  - `open` = 1 for southpaw vs orthodox. Switch counts as neither.

### Where each block acts

For attacker X against defender Y, each block adds `s` to the log of one table, after the tables are final:

| Block | Table changed | Effect |
|---|---|---|
| dist_att | `m.dRate` | x e^s |
| td_att | `m.tdD`, `m.tdCC`, `m.tdCU` | x e^s, after the occupancy fit, so control moves through the number of takedowns (section 9 item 3) |
| ctrl_per_td | the bottom man's `m.upPos` and `m.swPos` under X | / e^s |
| gnp_att | `m.gPos` and `m.gRate` | x e^s |

The `ctrl` block is a check only and is never applied.

### Coefficients

Source: styles.json `engine_modifiers.default_on`, the blocks that passed the 2019-2023 CV after the verification
log's fixes.

| Block | "ab1" (default; terms with a = b = 1 \|z\| < 2 dropped) | "fit" (free exponents) |
|---|---|---|
| dist_att | 0.052357 length_d - 0.067632 (open - 0.2746) | 0.063904 length_d - 0.073081 (open - 0.2746) - 0.023806 zy_kd_pow |
| td_att | -0.096627 length_d + 0.16794 zy_vol - 0.074101 zy_td_def | -0.076253 zy_td_int - 0.13401 length_d + 0.076694 zy_vol - 0.093306 zy_td_def |
| ctrl_per_td | -0.1069 zy_td_def | -0.069025 zy_td_def + 0.026359 zy_sub_int |
| gnp_att | 0.10378 zy_sub_int + 0.074442 zy_kd_pow | 0.10412 zy_sub_int + 0.085885 zy_kd_pow |

The "ab1" set drops dist_att/zy_kd_pow (z -1.39), td_att/zy_td_int (0.03) and ctrl_per_td/zy_sub_int (0.10), as
section 9 item 2 and the verification log prescribe.

### Rate-level check on 2019-2023

Tool: `tools/styles_sos_ratecheck.py`. The prescribed s is tested against realised per-fight counts, with each path's
own prediction as the offset:

- ml: the learned out-of-fold rates.
- base: the plain engine's static expectation.

The "fixed s" column adds s as given, with the level refit. The slope is fitted on s with a fight-clustered SE, where 1
would mean the prescribed shift adds fully. The style coefficients were fit on these same years, so the fixed-s column
is in-sample for them.

| Set | Block | Path | Fixed-s deviance change | Slope on s (se) | LOYO slope CV change [95% CI] |
|---|---|---|---|---|---|
| ab1 | dist_att | ml | +252 (+0.28%) | 0.30 (0.20) | +179 [+21, +351] |
| ab1 | dist_att | base | -699 (-0.73%) | 1.06 (0.20) | -534 [-990, +14] |
| ab1 | td_att | ml | +203 (+2.17%) | 0.19 (0.10) | -6 [-31, +19] |
| ab1 | td_att | base | -107 (-1.01%) | 0.66 (0.10) | -139 [-231, -43] |
| ab1 | ctrl_per_td | ml | +4451 (+0.98%) | 0.11 (0.16) | +362 [-130, +871] |
| ab1 | ctrl_per_td | base | +2607 (+0.53%) | 0.27 (0.17) | -157 [-1244, +933] |
| ab1 | gnp_att | ml | -90 (-0.18%) | 0.62 (0.23) | -129 [-336, +84] |
| ab1 | gnp_att | base | -289 (-0.54%) | 0.89 (0.24) | -279 [-588, +37] |
| fit | dist_att | ml | +573 (+0.63%) | 0.23 (0.15) | +115 [-38, +283] |
| fit | td_att | ml | +139 (+1.48%) | 0.27 (0.10) | -13 [-46, +20] |
| fit | ctrl_per_td | ml | +2710 (+0.60%) | 0.06 (0.22) | +373 [+31, +723] |
| fit | gnp_att | ml | -85 (-0.17%) | 0.60 (0.22) | -135 [-347, +88] |

How to read it:

- On the base tables the prescribed shifts reproduce the research's gains for distance attempts, takedown attempts and
  ground strikes.
- `ctrl_per_td` makes total control worse on both paths.
- On the learned-rate path only `gnp_att` still helps. That is the "styles_sel" variant in the ablation: learned rates
  gnp_att only; base tables dist_att, td_att and gnp_att.

## (b) Strength of schedule

### Source rule and what happened

The brief: use oppadj when research/model_oppadj.md has a verification log, otherwise build a compact walk-forward
adjustment.

- At the start there was no research/model_oppadj.md, so I built a compact walk-forward adjustment ("wf").
- Before delivery (3:49 pm) the report had gained a verification log. I then wired its factors in exactly as its
  recommendation describes and ablated them too.
- Both sources are now selectable with `sosSource`.

### "wf" source: tools/sos_wf.py

**Walk.** The tool walks every UFC fight in data/raw chronologically, using the same parse as build_db and dropping
fights dated 2026-01-01 or later right after parsing. Its decayed sums reproduce backtest_dev's S for all 5,728 sides,
with a maximum relative difference of 5e-4 (rounding).

**Opponent quality.** At each fight it takes the opponent Y's pre-fight shrunk rates against the division prior of that
year (priors_asof window). The shrinkage constants and exposures are the engine's `fighterRates` ones.

- What Y allows (`a`): distance attempts per distance minute, distance accuracy (log-odds), takedown attempts per
  standing minute, takedown success, chin.
- What Y produces (`o`): the same five stats for Y's own output.

**Accumulation.** X accumulates `num += w q` and `den += w` with the profile's 730-day half-life. The weights are X's
exposures in that fight:

- offense: distance minutes, own distance attempts, standing minutes, own takedown attempts, own head strikes landed;
- defense: the same exposures for what was thrown at him.

Each side stores `[q, w] = [num/den, den]` per stat, frozen before the fight.

**Engine shift.** For X's matchup rate against Y:

```
bias = q w / (w + k),  k = [24.8, 150, 32.4, 12, 230]   (kPM*L_dist, kAcc, kTdPM*L_stand, kTdAcc, kKD)
s_stat = beta_a (bias_a(X) - c_a) + beta_o (bias_o(Y) - c_o)
dAtt: m.dRate x e^s    acc: distance m.accO odds x e^s    tdAtt: m.tdD/tdCC/tdCU x e^s
tdAcc: m.tdO/tdOC x e^s    kd: m.kd x e^s (m.gnp, m.stko x e^(s/2))
```

The centers c are the 2019-2023 mean biases, so the league level does not move. A side with no table is neutral.

**Fit.** Coefficients are fit by Poisson or binomial GLMs on 3,998 fight-sides from 2019-2023. The offset is each path's
own prediction plus an intercept. The pre-registered rule: a stat is on only when its leave-one-year-out CV deviance
change has a fight-bootstrap CI below zero.

| Path | Stat | beta_a (z) | beta_o (z) | LOYO CV deviance change [95% CI] | On |
|---|---|---|---|---|---|
| ml | dAtt | -0.965 (-2.99) | -1.331 (-4.19) | -728 [-1398, -100] | yes |
| ml | acc | -0.836 (-6.21) | -0.451 (-3.09) | -165 [-273, -48] | yes |
| ml | tdAtt | -0.624 (-1.94) | -0.952 (-5.07) | -72 [-135, -6] | yes |
| ml | tdAcc | +0.019 (+0.06) | -0.423 (-1.28) | +5 [-3, +14] | no |
| ml | kd | +0.402 (+0.38) | -1.764 (-2.15) | +1 [-10, +12] | no |
| base | dAtt | -1.118 (-3.43) | -1.218 (-3.88) | -737 [-1357, -106] | yes |
| base | acc | -0.774 (-5.51) | -0.310 (-2.06) | -103 [-204, -8] | yes |
| base | tdAtt | -0.051 (-0.15) | -1.348 (-6.81) | -134 [-216, -55] | yes |
| base | tdAcc | -0.519 (-1.54) | -0.931 (-2.74) | -9 [-31, +11] | no |
| base | kd | -0.163 (-0.16) | -1.444 (-1.77) | +3 [-5, +11] | no |

Centers [c_a, c_o]: dAtt [-0.00235, 0.00261], acc [0.00116, 0.01981], tdAtt [-0.01435, -0.03326].

Coefficients near -1 are what full one-step adjustment predicts. They are stable across the five leave-one-year-out
folds (learned-rate dAtt beta_a between -0.88 and -1.14). The ablation uses each fold's coefficients
(`meta.coef_loyo[path][year]`), so the coefficients are out-of-fold for every fight.

### "oppadj" source

The factors are the verified tools/oppadj.py output, read from `data/derived/oppadj.json`.

- **Base tables.** The factors multiply engine R in `fighterRates` for the recommended families: dAtt, cAtt, gAtt,
  tdAtt, ctrl, topSkill/escWeak, tdAcc, and head and leg accuracy. Knockdowns, submissions and body accuracy stay 1.
- **Learned rates.** The matchup tables get `(F_off,X F_def,Y)^beta`, with beta from `results.recommendation`: dAtt 0.932,
  cAtt 0.988, gAtt 0.17, accH 0.548, accL 0.262, tdAtt 0.372, tdAcc 0.119, ctrl 0.621.
- **One difference from their reference.** Their reference multiplies the learned targets before re-targeting. Here the
  same multipliers go on the final tables. Clinch time and the occupancy fit are not re-run, and control enters through
  the top man's stand-up and sweep hazards.

## (c) Newcomer priors

Skipped. research/model_preufc.md exists, but it has no verification log, and its audit and engine sections are
unfilled placeholders. The `newcomer` sub-flag is accepted and does nothing. The report's own numbers make it a strong
candidate once it is verified:

- newcomer bouts -0.0147 log loss on top of the UFC-stat logistic;
- -0.0106 on top of tools/ml.py;
- nothing on top of the closing line.

Its suggested engine form: shift newcomers' power, chin and submission priors and overall level by regional records,
fading with UFC experience.

## Ablation (train only)

Setup:

- **Fights.** backtest_dev, dated 2019-01-01 to 2023-12-31: 1,999 fights, of which 1,955 decisive, all 1,999 with a
  closing line, on 211 cards. The tool refuses fights dated 2024 or later.
- **Simulation.** `summarize` in both corner orders, symmetrised. The seed depends only on fight id and orientation, so
  every configuration uses common random numbers. 300 simulations per orientation on the learned-rate path (600 per
  fight), 250 on the base tables (500 per fight).
- **Inputs.** Learned rates are the `mlrates_oof.json` time-ordered CV folds. Profiles are the frozen snapshots with
  priors_asof. SOS uses the walk-forward table with leave-one-year-out coefficients. oppadj uses the pre-fight snapshot
  factors.
- **Uncertainty.** Paired 95% bootstrap over cards, 2,000 replicates. The base-rate table uses 200 replicates.
- **Compute.** 3 workers at nice 5.
- **Metrics.**
  - winner log loss: decisive fights, with p = pA / (pA + pB);
  - soft CE: cross-entropy against `market.json p_power_close`;
  - 7-bin and method log losses: half a simulated fight of smoothing per class;
  - stat-line deviance: per side, Poisson deviance of the actual counts against the simulated rate per minute times the
    actual minutes. Control uses quasi-Poisson on seconds. The table reports the mean relative change over 10 stats.

### Engine v4 path (learned out-of-fold rates)

Change vs off is shown as "value (difference [95% CI])". Negative is better.

| Config | Winner log loss | Soft CE vs close | 7-bin | Method | Stat-line deviance | Calib. slope |
|---|---|---|---|---|---|---|
| off (v4 without the component) | 0.6633 | 0.6712 | 1.6554 | 0.9701 | 0 | 0.998 |
| (a) styles, section 9 exact (ab1, 4 blocks) | +0.0005 [-0.0026, +0.0037] | **+0.0011 [+0.0001, +0.0022]** | +0.0015 [-0.0048, +0.0080] | +0.0020 [-0.0017, +0.0056] | +0.17% [-0.24, +0.59] | 0.972 |
| (a) styles, fit set | +0.0010 [-0.0021, +0.0041] | +0.0007 [-0.0002, +0.0016] | -0.0010 [-0.0072, +0.0051] | -0.0010 [-0.0048, +0.0029] | +0.09% [-0.33, +0.50] | 0.944 |
| (a) styles_sel (gnp_att only) | +0.0008 [-0.0017, +0.0034] | +0.0003 [-0.0005, +0.0010] | -0.0017 [-0.0080, +0.0042] | -0.0022 [-0.0056, +0.0011] | +0.01% [-0.21, +0.21] | 0.984 |
| **(b) SOS, wf (= the default config on this path)** | -0.0010 [-0.0039, +0.0018] | **-0.0010 [-0.0018, -0.0001]** | +0.0002 [-0.0070, +0.0071] | -0.0007 [-0.0046, +0.0031] | **-0.48% [-0.84, -0.10]** | 1.014 |
| (b) SOS, oppadj | -0.0004 [-0.0036, +0.0029] | +0.0002 [-0.0008, +0.0012] | -0.0048 [-0.0113, +0.0018] | -0.0028 [-0.0067, +0.0011] | **-1.24% [-1.70, -0.77]** | 0.946 |
| (a)+(b) exact + wf | **-0.0037 [-0.0072, -0.0002]** | -0.0006 [-0.0018, +0.0005] | -0.0015 [-0.0085, +0.0053] | -0.0001 [-0.0040, +0.0041] | -0.08% [-0.67, +0.45] | 1.037 |
| (a sel)+(b) wf | -0.0010 [-0.0041, +0.0018] | **-0.0008 [-0.0017, -0.0000]** | -0.0020 [-0.0081, +0.0043] | -0.0001 [-0.0038, +0.0039] | -0.34% [-0.69, +0.00] | 1.019 |
| oppadj vs wf (paired) | +0.0006 [-0.0026, +0.0038] | **+0.0011 [+0.0001, +0.0021]** | -0.0049 [-0.0114, +0.0017] | -0.0021 [-0.0062, +0.0019] | **-0.77% [-1.27, -0.26]** | |

The combined (a)+(b) winner gain of -0.0037 is the only winner-loss interval that excludes zero on this path. It stands
against two other readings:

- Styles alone are +0.0005 on winner loss.
- Soft CE for the combination, the less noisy metric (research/model_market.md: 3-4.6 times less noisy), is -0.0006
  n.s., below SOS alone.

With about 30 intervals in this table, read it as noise rather than an interaction.

Stat-line deviance by stat (sum over sides; negative is better):

| Stat | (a) styles | (b) wf | (b) oppadj |
|---|---|---|---|
| sig att | -0.30% [n.s.] | -0.93% [-1573, +20] | **-2.10%** |
| sig landed | -0.10% | -0.63% | **-2.01%** |
| head landed | +0.05% | -0.54% | **-1.61%** |
| body / leg landed | -0.06% / -0.23% | -0.22% / +0.07% | **-1.16%** / +0.01% |
| knockdowns | -0.27% | -0.02% | +0.07% |
| takedown att | +0.60% | **-1.15%** | **-2.30%** |
| takedowns landed | +0.29% | **-0.84%** | **-1.06%** |
| control | +0.87% | **-0.93%** | **-2.06%** |
| sub att | **+0.88%** | +0.41% | -0.15% |

### Base tables (learned rates off; the page path until v5 inlines the learned model)

| Config | Winner log loss | Soft CE vs close | 7-bin | Method | Stat-line deviance | Calib. slope |
|---|---|---|---|---|---|---|
| off | 0.6721 | 0.6758 | 1.6637 | 0.9652 | 0 | 0.906 |
| (a) styles, exact (ab1, 4 blocks) | -0.0028 [-0.0064, +0.0005] | -0.0007 [-0.0018, +0.0005] | -0.0023 [-0.0096, +0.0048] | +0.0030 [-0.0013, +0.0071] | +0.08% [-0.38, +0.50] | 0.957 |
| (a) styles_sel (dist, td, gnp) | **-0.0049 [-0.0083, -0.0015]** | **-0.0012 [-0.0023, -0.0000]** | +0.0010 [-0.0067, +0.0088] | **+0.0068 [+0.0025, +0.0111]** | -0.02% | 1.018 |
| (b) SOS, wf | **-0.0045 [-0.0076, -0.0012]** | **-0.0019 [-0.0028, -0.0010]** | **-0.0079 [-0.0156, -0.0002]** | -0.0003 [-0.0045, +0.0039] | **-0.40% [-0.78, -0.01]** | 1.004 |
| (b) SOS, oppadj | -0.0044 [-0.0100, +0.0012] | -0.0010 [-0.0026, +0.0005] | -0.0094 [-0.0189, +0.0011] | +0.0001 [-0.0057, +0.0061] | **-3.72% [-4.50, -2.90]** | 0.901 |
| **(a)+(b) exact + wf (= the default config on this path)** | **-0.0059 [-0.0094, -0.0023]** | **-0.0016 [-0.0028, -0.0004]** | -0.0026 [-0.0104, +0.0052] | +0.0033 [-0.0011, +0.0077] | -0.08% [-0.70, +0.49] | 1.011 |
| oppadj vs wf (paired) | +0.0001 [-0.0053, +0.0052] | +0.0009 [-0.0006, +0.0024] | -0.0014 [-0.0102, +0.0073] | +0.0004 [-0.0055, +0.0063] | **-3.34% [-4.10, -2.56]** | |

### Base rates, learned-rate path

Simulated vs actual on 2019-2023. The bracket is the change against off with its 200-replicate card bootstrap.

| Quantity | Actual | off | (a) styles | (b) wf | (b) oppadj |
|---|---|---|---|---|---|
| KO/TKO share | 0.3174 | 0.3188 | 0.3172 (-0.0016) | 0.3182 (-0.0006) | see JSON |
| SUB share | 0.1749 | 0.1618 | 0.1641 (+0.0024) | 0.1615 (-0.0003) | |
| DEC share | 0.4975 | 0.5038 | 0.5027 (-0.0011) | 0.5043 (+0.0005) | |
| finish R1 / R2 / R3, 3-round | 0.244 / 0.167 / 0.075 | 0.242 / 0.143 / 0.091 | +0.0007 / +0.0005 / -0.0005 | +0.0000 / -0.0004 / -0.0009 | |
| finish R1-R5, 5-round | 0.173 / 0.165 / 0.095 / 0.054 / 0.049 | 0.139 / 0.124 / 0.103 / 0.096 / 0.053 | small (largest R2 +0.0033) | small (R4 -0.0025) | |
| sig att per 15, per fighter | 131.0 | 132.0 | 131.7 (-0.39) | 132.0 (-0.00) | 131.6 (-0.49) |
| sig landed per 15 | 61.1 | 63.9 | 63.7 (-0.20) | 63.9 (-0.04) | 63.7 (-0.28) |
| knockdowns per 15 | 0.296 | 0.297 | 0.295 (-0.0024) | 0.297 (+0.0005) | 0.296 (-0.0012) |
| takedown att per 15 | 3.59 | 3.28 | 3.35 (+0.065) | 3.29 (+0.011) | 3.29 (+0.007) |
| takedowns landed per 15 | 1.306 | 1.189 | 1.210 (+0.021) | 1.192 (+0.003) | 1.188 (-0.002) |
| control per 15, s | 163.0 | 154.5 | 156.1 (+1.6) | 154.8 (+0.3) | 154.4 (-0.1) |
| sub att per 15 | 0.372 | 0.331 | 0.336 (+0.005) | 0.332 (+0.001) | 0.328 (-0.003) |
| sig / TD accuracy | 0.467 / 0.364 | 0.484 / 0.362 | -0.0001 / -0.0008 | -0.0003 / -0.0004 | |
| decisions UD / SD / MD | 0.786 / 0.194 / 0.020 | 0.759 / 0.180 / 0.031 | within ±0.0014 | within ±0.0007 | |

- The component does not move league base rates by anything that matters.
- The centering keeps the levels. The largest shifts are the styles' +2% takedown attempts and +1% control, both toward
  the actual rates.
- oppadj on the base tables moves levels more: control -6.2 s per 15 (163.5 -> 157.3, away from the actual 163.0) and
  submission attempts -4.5%.
- The full tables, including the base-table path, are in `data/derived/styles_sos_ablation.json` (`baserates`).

## Recommendation for v5

Include the component with the branch defaults:

```
components.styles_sos = { styles: true, sos: true, newcomer: false }
stylesSOS: styleBlocks { ml: [], base: "all" }, sosSource "wf"
```

On the learned-rate path this is exactly the "(b) SOS, wf" configuration. On the base tables it is the "(a)+(b) exact +
wf" configuration.

The expected v5 effect on the learned-rate path is small: about -0.001 on winner and soft CE, and -0.5% on stat lines.
For the single v5 validation measurement that is the honest prior. The strength-of-schedule part is the robust piece;
the style layer is a no-op on that path by design.

If the v5 simulator's job is mainly "how and when" (stat lines, method and round) rather than earning winner weight in
the blend, choose `sosSource: "oppadj"` instead. On 2019-2023 it gives 0.8-3.3% better stat lines and n.s. better 7-bin
and method, at a significant +0.0011 on soft CE. Do not stack the two sources: both adjust the same rates for the same
opposition.

## Risks and interactions

1. **The learned stat-line model already holds styles.** The rate check shows the section-9 shifts are mostly
   double-counted on top of mlrates: slopes 0.1-0.3 except ground strikes. Any further style work for v7 has to be fit on
   top of the learned rates, not the log-linear base.
2. **The v4 engine is still moving.** The hook wraps `matchup()` and adds one line in `fighterRates`; it does not edit v4
   code.
   - `src/params3.js` gains a `components` block, which other components also add. Merge by key.
   - The `fighterRates` line sits above `R.cardio = ...`, so tools/oppadj_engine.js's in-memory anchor still matches.
3. **Re-tuning.** The global scales (strikeScale, tdScale, ctrlScale, form sds) were tuned without the component. The
   centering keeps levels on average, but the calibration slope moves on the learned-rate path: 0.998 off, 1.014 with
   SOS. A v5 recalibration pass should run with the component on.
4. **Live and page inputs.** Style vectors are computed in-engine and need nothing extra. SOS needs a roster table:
   `tools/sos_wf.py build --until <snapshot> --production --roster`, which reads 2026 fights and so was not run here
   under the protocol, then `StylesSOS.loadSOS(...)`. Until that is built and inlined, live and page matchups run SOS
   neutral, so backtest and page differ there.
5. **oppadj roster factors.** They are relative to the fighter's home division (their verification item 6).
   `loadOppadj` uses them as given, so the Volkanovski-at-155 caveat applies. The backtest snapshots are built at the bout
   division.
6. **Selection leaks inside the train ablation.** None reach 2024+.
   - The wf on/off rule per stat used the pooled LOYO CV of all five years. The per-fight coefficients are out-of-fold,
     but the on/off choice is not nested.
   - The "styles_sel" block lists came from the same 2019-2023 rate check.
   - The style coefficients themselves were fit on 2019-2023 by tools/styles.py.
   - oppadj's half-lives, k and lambda were tuned on 2019-2023, and its on/off switches and some ML betas used 2024-25
     (their verification item 4). Its 2019-2023 stat-line gains are therefore partly in-sample.
7. **Stance, reach and height** are the current tale of the tape applied to past fights (styles caveat). This is a mild
   look-ahead that matters mainly for the open-stance term.
8. **Interactions with other v5 components.**
   - Durability: SOS leaves kd and chin alone (those stats failed the CV rule), so there is no overlap.
   - Dynamics and pace components act on in-fight hazards, not on these tables.
   - Officials and judging are unaffected.
   - A component that also rescales `m.dRate` or `m.tdD` after `matchup()` will compound multiplicatively with this one.
     Order does not matter for pure multipliers.

## Reproduce

Run from the worktree. `priors_asof_2019_2023.json` is `backtest.json` `priors_asof` restricted to years up to 2023.

```
python3 tools/sos_wf.py build --rows rows.json
node tools/styles_sos_offsets.js priors_asof_2019_2023.json offsets.json
python3 tools/sos_wf.py fit rows.json offsets.json
python3 tools/styles_sos_ratecheck.py priors_asof_2019_2023.json rows.json offsets.json
node tools/styles_sos_ablate.js priors_asof_2019_2023.json out_p0.json --sims 300 --part 0 --parts 3 --ml oof --configs off,styles,sos,both,styles_fit
python3 tools/styles_sos_score.py score.json out_p0.json out_p1.json out_p2.json
node tests/test_styles_sos.js
```

The ablation also takes `--ml off` for the base tables, and configs `styles_sel`, `both_sel`, `oppadj`. The scorer takes
`--base sos --configs oppadj` for paired comparisons.
