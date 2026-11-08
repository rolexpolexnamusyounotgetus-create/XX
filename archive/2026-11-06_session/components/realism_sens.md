# Component realism_sens: verified (Nov 6, 2026, about 7:40 pm UTC)

**Verdict: INCLUDE as a capability, with the factor layer OFF** (`params.components.realism_sens = false`).

- Ship `FightEngine.sensitivity` / `rateSd`, `tools/realism.js`, and the `src/ml/mlrates.js` cache-key fix. None of these
  changes a prediction.
- On the v4.0.1 final engine (main `1f30636`), the realism factors bring no out-of-fold gain, for three reasons:
  - The learned-rate levels added in v4.0.1 (`mlTdLevel` 1.067, `mlCtrlLevel` 1.053, `mlSubLevel` 1.083) already close
    the takedown, control and submission-attempt gaps the factors were built for.
  - The division KO / KD spreads are not stable across periods. The between-division sd is 0.13 / 0.17 on 2019-2021 and
    0 / 0 on 2022-2023.
  - The prediction metrics are null, with 7-bin and method log loss leaning worse.
- Only the 5-round KD factor (`fmt["5"].kd` about 1.30) holds out of fold.
- I found two bugs and fixed them. The patch is re-issued against main `1f30636`.

Verifier worktree: `/home/user/XX/.claude/worktrees/wf_7ea2629f-826-4`. Local branches, none pushed:

- `verify/realism_sens_main`: head `7e8e3cb`, on main `1f30636`. This is the re-issued patch.
- `verify/realism_sens`: head `86237be`, on `859a15c`. This was round 2, on v4.0.1 before the learned-rate levels.

## Deliverables

| File | What |
|---|---|
| `realism_sens.patch` | **Re-issued.** `git diff 1f30636 7e8e3cb`. The base is main `1f30636`, engine v4.0.1 final (engine3.js sha256 `ca86a62b3d3f...`, the `v4.0.1` entry in version_history.json). It contains the builder's component, the verifier fixes, factors refit on this engine, and the flag default set to off. It also applies to `122c31a` (v4.0.0) with offsets; only the `tools/README.md` tail is rejected (append that section by hand). Flag off is bit-identical there too (below). |
| `realism_sens.orig_853ce32.patch` | The builder's original patch, against `853ce32`. It applies cleanly to `853ce32` and reproduces `comp/realism_sens` (`6f118eb`) byte for byte (checked with `diff -r` on archive copies). |
| `realism_sens.orig.md` | The builder's original report: per-division realism tables, the Volk vs Gaethje sensitivity example, and the hand-offs. |
| `realism_sens.component_only.patch`, `realism_sens.on_main_v4_1553.patch` | The builder's other forms, unchanged. Superseded by `realism_sens.patch`. |

## Bugs found and fixed

1. **The EB fit blew up on groups with zero real events** (`tools/realism.js` `fitTargets` / `fmtTargets`).
   - The log ratio was `log(max(1e-6, real) / sim)`. A division with no real event got r = -12. One case was
     Women's Featherweight, with 0 knockdowns in 8 fights in 2019-2021.
   - That r carried a finite variance, so the DerSimonian-Laird tau^2 exploded. Every division then went unshrunk, and
     factors ran to the 0.4 / 2.5 clip.
   - On the 2019-2021 fold the buggy fit gave tau of KD 0.62, SUB 0.13 and KO 0.15. The factors included W-FW kd 0.40
     (at the clip), W-SW kd 1.94, BW sub 0.65 and MW kd 0.69, and the fixed-point loop diverged (worst gap 0.35, then
     1.21, 1.27, 1.32).
   - Fix: `logRatioCC(O, Ex, kind, n)`, a Haldane-Anscombe continuity-corrected log ratio on the count scale,
     `r = log((O + 0.5) / (Ex + 0.5))`. Its variance comes from the observed count:
     - shares: `v = 1/(O + 0.5) - 1/(n + 0.5)`, plus a small MC term;
     - counts: `v = 2/(O + 0.5)`.
   - `countExposure()` gives the real count and its exposure.
   - With the fix, the same fold has tau KD 0.17, SUB 0, KO 0.12, and the loop converges (worst gap about 0.07 to 0.10).
   - This affects fold fits (CV) the most. The builder's leave-one-year-out folds were exposed to it; the all-years
     fit barely moved.
2. **A null factor zeroed its lever** (`engine3.js realismFactors`). The check was `isFinite(null) === true`, so a factor
   written as `null` or `""` to mean "unset" became 0: no KOs, no submissions, or no attempts in that division. Now
   only finite positive numbers count, and anything else means 1.
3. **Tests** (`tests/test_realism_sens.js`, 46 checks now, up from 42):
   - New checks for both fixes (null / empty / non-positive factors; zero-event EB groups).
   - The "fitted factors are live" check now sets the flag explicitly, so it holds with the default off.
   - New check: the default params equal the explicit shipped setting.
   - The fixture is regenerated against `1f30636`.
4. **Re-issue on the current engine.**
   - The factors are refit on `1f30636` with the fixed fitter.
   - Flag default: off.
   - The comments in `params3.js` and `docs/ENGINE_V3_SPEC.md` say why.

## Checks

- **Flag off is bit-identical**, checked by my own harness (`scratchpad/rsv/identity*.js`). It uses different pairs,
  seeds and digest fields from the builder's test.
  - **What each case covers:**
    - random roster pairs, every division plus catch weight, cross-division pairs, 3 and 5 rounds;
    - base tables, loaded learned rates, and per-side OOF-style rates;
    - random knobs;
    - 25 fights, one traced fight, `summarize(120)` and the matchup tables.
  - **How the flag is turned off:**
    - through `opts.params`, with extreme factors present;
    - through the global `FightParams`.
  - **Results by engine:**
    - main `1f30636`: 440/440, then 240/240 again on the final re-issued tree;
    - v4.0.0 `122c31a`: 240/240;
    - `859a15c`: 440/440 (round 2).
  - The builder's test, with `--ref 1f30636` and with `--ref-dir` on a pristine copy: all pass.
- **Tests on the re-issued tree:**
  - `tests/test_realism_sens.js`: 46/46.
  - `tests/test_engine3.js` (default N 20,000): 76/76.
  - `tests/test_director3.js`: OK.
  - With the flag forced on at N 6,000, one engine check failed: "swapping corners mirrors the 7 outcome bins" (max
    3.0 points, threshold 2). This is sampling noise.
    - With the flag on, the tables mirror exactly (max relative difference 0).
    - At the test's own N (20,000, seeds 314 / 2718) the maximum bin difference is 0.60 points.
    - Learned-rate Volk-Gaethje at 3 x 12,000 fights gives z 0.17 / 0.17 / 0.43.
- **Fuzz** (`rsv/fuzz.js`):
  - Inputs: 500 random roster pairs x 3 and 5 rounds x (normal + stress). In the stress pass every factor sits at the
    fit's clip, 0.4 or 2.5. All divisions plus catch weight; learned rates on half.
  - Volume: 120,000 summarized fights, 2,000 traced fights and 2,000 director scripts, plus 6 `sensitivity()` runs.
  - Result: no NaN, infinity or negative total, no invalid bin or round, no slow fight (max 15 ms per fight under load
    20), and no director error.
  - Corner symmetry over 38 pairs x 1,500 fights per order: flag off mean 0.0032 (se 0.0031), flag on 0.0005 (se 0.0028).
- **Speed** (`rsv/speed_main.js`):
  - `summarize` of 20,000 five-round fights, interleaved: before 10.1 s, after with the flag on 8.6 s, after with the
    flag off 6.4 s. The load average was about 20, so noise dominates, and these numbers show no regression.
  - `simulate()` is untouched. `matchup()` adds one `realismFactors()` call.
- **Leakage: none found.**
  - `tools/realism.js` drops every fight dated 2026-01-01 or later on load and refuses years after 2023 unless
    `--unledgered-val` is passed.
  - My driver hard-filters 2019-01-01..2023-12-31. It asserts that each OOF learned-rate entry's `src` is `cv<year>`,
    meaning a time-ordered fold trained on 2010 through the year before. There are 0 mismatches among the 1,999
    2019-2023 backtest fights; all 865 `dev` entries are 2024 or later and never loaded.
  - Inputs are frozen backtest snapshots (`resolve()` passes profile objects through, with no live-roster lookup) and
    walk-forward priors per year (`mlcal_priors_asof.json`). The closing line is used only for scoring.
  - Nothing from 2024 on, and no 2026 fight, was read.
- **Equations and values:**
  - **`dvf`.** The realism factors multiply the `[selfcal]` division factors at the six lever sites: attempts in the
    distance / clinch rates, `tdScale` x `td`, the control target, `subConvScale` x `sub`, the KO odds and `kdScale` x
    `kd`. They reach the learned-rate path because `leagueExpect` re-levels with the same factors (the test confirms
    att x1.3 gives x1.300).
  - **`disp` values.** Recomputed: att 20.54, acc 4.42, kd 1.96, td_att 2.75, td_acc 1.36, sub_att 2.26. They match.
  - **`knobSd`.** It falls back to the `form` sds: out 0.357, acc 0.478, pow / chin 0.316, cardio 0.15, grap 0.3,
    sub 0.8, judges' power 0.25. These match too.
  - **Shipped factors.** The builder's 15:53 factors equal its fit file.
  - **Minor issue, left as is.** `ebShrink` mixes the known-mean df (`Q - k`) with the estimated-mean denominator
    (`sum w - sum w^2 / sum w`), which makes tau^2 about 9% high for 12 equal-weight groups.
  - **Sensitivity code** (common random numbers, knob directions, the paired se and the rebuild path): checked, no
    issue found.

## The interaction that decides the verdict

v4.0.1 final (main `873e3ca` / `1f30636`, after the builder's 15:53 refit) added `mlTdLevel`, `mlCtrlLevel` and
`mlSubLevel` on the learned-rate path. They do the job of this component's `td` / `ctrl` / `sub` factors, so the layer
must not ship with the builder's factors.

The builder's shipped 15:53 factors on `1f30636` correct twice:
- TD attempts per 15 go from +0.04 to **+0.16 too high** (95% CI [+0.04, +0.27]).
- Control per 15 goes from +0.2 s to +4.1 s.

Refit on `1f30636`, the `td` / `ctrl` factors fall to about 1.00. Between-division sd of log(real/sim), all of
2019-2023: KO 0.060, SUB 0, KD 0.101, TD 0.032, control 0.018, attempts 0.

## Ablation (independent: fresh seeds, my own driver `rsv/ablate.js` and scorer `rsv/score.js`)

Common to every table below:
- Train fights only: 2019-2023, 1,972 scored fights on 211 cards.
- Both corner orders, 100 sims per order (200 per fight), common random numbers (one seed per fight x order x sim).
- Leak-free inputs: frozen snapshots, walk-forward priors, out-of-fold learned rates.
- Paired event-cluster bootstrap 95% CIs (2,000 resamples of cards). Values are on minus off; negative is better.
- Fits use the component's own fitter with the EB fix; scoring uses my own code.
- Metrics:
  - winner log loss (draws excluded; Laplace-smoothed P(A));
  - soft-label cross-entropy against `p_power_close`;
  - 7-bin log loss;
  - method log loss (KO / SUB / DEC);
  - Poisson stat-line deviance (10 per-side stats, control in minutes);
  - Brier score.

### A. Main 1f30636 (v4.0.1 final): temporal 2-fold CV, pooled

Fold a fits on 2019-2021 and scores 2022-2023 (816 fights). Fold b fits on 2022-2023 and scores 2019-2021 (1,156
fights). Fit seed 6262, ablation seed 27182.

| Metric | flag off | flag on (fold factors) | on - off | 95% CI |
|---|---|---|---|---|
| Winner log loss | 0.6669 | 0.6658 | -0.0011 | [-0.0033, +0.0012] |
| Soft CE vs close | 0.6734 | 0.6731 | -0.0003 | [-0.0011, +0.0004] |
| 7-bin log loss | 1.6553 | 1.6602 | +0.0049 | [-0.0020, +0.0123] |
| Method log loss | 0.9662 | 0.9691 | +0.0029 | [-0.0015, +0.0074] |
| Stat-line deviance | 229.40 | 228.52 | -0.88 | [-1.77, -0.04] |
| Brier | 0.2370 | 0.2365 | -0.0005 | [-0.0015, +0.0006] |

Per fold (on - off):

| Metric | Fold a (2022-2023) | Fold b (2019-2021) |
|---|---|---|
| Winner log loss | -0.0027 [-0.0058, +0.0005] | -0.0000 [-0.0034, +0.0031] |
| Soft CE vs close | -0.0003 [-0.0016, +0.0009] | -0.0004 [-0.0013, +0.0006] |
| 7-bin log loss | +0.0080 [-0.0043, +0.0204] | +0.0027 [-0.0051, +0.0103] |
| Method log loss | +0.0043 [-0.0042, +0.0125] | +0.0019 [-0.0023, +0.0062] |
| Stat-line deviance | -1.25 [-2.59, +0.05] | -0.62 [-1.71, +0.55] |

Base rates (sim minus real; the last column is the change in |gap|, negative = closer to the data), pooled CV:

| Rate | real | off | on | change in |gap| [CI] |
|---|---|---|---|---|
| KO share | 0.3174 | +0.0013 | -0.0030 | +0.0017 [-0.0053, +0.0053] |
| SUB share | 0.1749 | +0.0001 | +0.0002 | +0.0001 [-0.0008, +0.0009] |
| DEC share | 0.5076 | -0.0014 | +0.0028 | +0.0014 [-0.0052, +0.0054] |
| 3-rd finishes in R2 | 0.3436 | -0.0470 | -0.0436 | -0.0034 [-0.0051, -0.0016] |
| 3-rd finishes in R3 | 0.1546 | +0.0329 | +0.0349 | +0.0020 [+0.0001, +0.0038] |
| 5-rd finishes in R4-5 | 0.1029 | +0.0426 | +0.0450 | +0.0025 [-0.0018, +0.0064] |
| KD per 100 head landed | 0.7806 | +0.0045 | -0.0091 | +0.0046 [-0.0165, +0.0176] |
| TD att per 15 | 3.5792 | +0.0433 | +0.0357 | -0.0076 [-0.0121, +0.0109] |
| TD landed per 15 | 1.3049 | +0.0005 | -0.0018 | +0.0014 [-0.0038, +0.0039] |
| Control s per 15 | 163.16 | +0.19 | -0.79 | +0.60 [-1.15, +1.19] |
| Sub att per 15 | 0.3712 | +0.0005 | -0.0027 | +0.0022 [-0.0043, +0.0043] |
| Sig landed per 15 | 61.09 | +0.66 | +0.55 | -0.11 [-0.17, +0.15] |

Every base rate this layer targets is already on the train level with the flag off.

The division KD factors do not carry across periods.
- Real KD per 100 landed head strikes was 0.751 in 2019-2021 and 0.822 in 2022-2023, while the simulated level stays
  flat.
- In fold a, the 2019-2021 factors push KD per head further off: the gap goes from -0.089 to -0.126, and |gap| grows
  by +0.037 [+0.030, +0.043].
- The decision share also gets worse: |gap| +0.0087 [+0.0060, +0.0109].

### B. Main 1f30636: in-sample (factors fit on 2019-2023 and scored on 2019-2023; seed 161803)

These are the factors in the patch's `params3.js`.

| Metric | on - off | 95% CI |
|---|---|---|
| Winner log loss | -0.0012 | [-0.0034, +0.0009] |
| Soft CE vs close | +0.0003 | [-0.0002, +0.0010] |
| 7-bin log loss | -0.0028 | [-0.0085, +0.0030] |
| Method log loss | -0.0013 | [-0.0045, +0.0019] |
| Stat-line deviance | -0.81 | [-1.68, +0.04] |
| Brier | -0.0005 | [-0.0015, +0.0004] |

Base rates in-sample: every gap is within a few thousandths with the flag off and stays there with it on. TD attempts
per 15 go from +0.047 to +0.029; KD per 100 head from +0.002 to 0.000.

### C. The one stable piece: the 5-round format factor (fmt only, out of fold, 243 five-round fights)

The fold's `fmt["5"]` was used with no division factors. Fold a gives ko 0.932, sub 1.090, kd 1.300; fold b gives ko
0.959, sub 0.986, kd 1.320; all years give ko 0.881, sub 1.023, kd 1.327.

| Metric (5-round fights only) | fmt (ko, sub, kd) | fmt kd only |
|---|---|---|
| Winner log loss | -0.0029 [-0.0087, +0.0033] | -0.0028 [-0.0086, +0.0031] |
| Soft CE vs close | -0.0014 [-0.0034, +0.0005] | -0.0018 [-0.0038, +0.0000] |
| 7-bin log loss | -0.0064 [-0.0229, +0.0104] | -0.0074 [-0.0247, +0.0099] |
| Method log loss | +0.0036 [-0.0102, +0.0178] | +0.0024 [-0.0126, +0.0177] |
| Stat-line deviance | -4.04 [-9.57, +1.54] | -4.12 [-10.26, +2.06] |
| KD per 100 head (real 0.640): sim - real | -0.164 [-0.303, -0.046] -> -0.024 [-0.166, +0.094] | -> -0.026 |
| KO share (real 0.395): sim - real | -0.015 -> +0.018 | -> +0.026 |

The engine under-predicts KDs per landed head strike in 5-round fights by about 25% (0.48 vs 0.64 real). A factor of
about 1.3 closes that gap out of fold. The effect on prediction is null to slightly favourable on these 243 fights, and
about -0.0002 soft CE pooled over all fights.

### D. Round 2, on 859a15c (v4.0.1 at 4:21 pm UTC, before the learned-rate levels; TD / control like v4.0.0)

Temporal 2-fold, pooled. Fixed fitter; fit seed 5151, ablation seed 31337.

| Metric | on - off | 95% CI |
|---|---|---|
| Winner log loss | +0.0008 | [-0.0018, +0.0035] |
| Soft CE vs close | +0.0002 | [-0.0006, +0.0010] |
| 7-bin log loss | +0.0028 | [-0.0041, +0.0100] |
| Method log loss | +0.0006 | [-0.0034, +0.0047] |
| Stat-line deviance | -0.38 | [-1.22, +0.49] |

On that engine the layer did close real gaps out of fold:
- TD attempts per 15: -0.177 to -0.117 (|gap| -0.060 [-0.067, -0.052]).
- TD landed per 15: -0.080 to -0.057 (|gap| -0.023 [-0.025, -0.020]).
- Control per 15: -8.5 s to -5.6 s (|gap| -2.9 s [-3.4, -2.3]).

This agrees with the builder's leave-one-year-out CV. In v4.0.1 final, the learned-rate levels now do that job.

## Recommendation for v5

1. **Include** the code: `sensitivity` / `rateSd` (tornado data for the page), `tools/realism.js` (the v10 realism
   report for any engine version), and the `mlrates.js` `leagueExpect` cache key. The cache key matters to every
   component toggled through the global `FightParams`: without it, a stale league level is reused after a flag flip.
2. **Factor layer off** for the v5 validation measurement (`components.realism_sens = false`, as shipped).
   - Do not count on it for prediction.
   - The division factors do not transfer across periods. Leave them off even if the layer is used later.
3. **Optional, decided on train data only**, after merging the other v5 components (durability moves KD levels;
   dynamics moves KD and finishes by round):
   - Run `node tools/realism.js report --years 2019-2023 --flag off`.
   - If the 5-round KD per 100 landed head strikes is still more than 2 se under the real 0.64, use format-only mode:
     - set `realism.div` to `{}`;
     - run `tools/realism.js fit --years 2019-2023 --levers ko,kd --fmt --fmt-levers kd,ko` and keep only `fmt["5"]`;
     - set the flag on.
   - On this engine that is worth about -0.0015 soft CE on 5-round fights. It is a realism gain, not a ranking gain.
4. **If v5 is built on v4.0.0** (no `mlTdLevel` / `mlCtrlLevel` / `mlSubLevel`), section D applies.
   - The layer then closes the TD / control gaps at neutral prediction.
   - Prefer carrying over v4.0.1's learned-rate levels instead: validated, one lever each.
   - If the layer is used there anyway, refit the factors on that engine first. The values in the patch are fit on
     v4.0.1 final.
5. **Keep** the `test_engine3.js` `simAvg` change. `[selfcal]` must be measured and fit with this layer off.

## What the component is (unchanged from the builder, see realism_sens.orig.md)

**Realism factors.**
- `dvf(k) = div_selfcal[d][k] x realism.div[d][k] x realism.fmt[R][k]` for k in {att, kd, ko, sub, ctrl, td}.
- `m.realism` records the factors in effect; `FightEngine.realismFactors(p, division, rounds)` returns them.

**Fit (`tools/realism.js fit`).**
- Per division d and target T, with the flag off: `r_d = log(real/sim)`, now continuity-corrected.
- Sampling variance: binomial for shares, quasi-Poisson (x2) for counts.
- DerSimonian-Laird tau^2 around 0; shrunk `r*_d = r_d tau^2 / (tau^2 + v_d)`.
- Damped multiplicative steps: `lever *= exp(0.85 log(T*/sim) / e)`, with elasticities e = 0.8 (ko, sub, ctrl), 0.9
  (kd, td), 0.95 (att). Four iterations, 100 sims per fight per corner order.
- `fmt["5"]`: 5-round fights pooled, prior sd 0.2.

**Parameter values in the patch.**
- `realism.div` and `realism.fmt["5"]` are refit on `1f30636`. The values are in `src/params3.js`, with
  `fmt["5"] = { ko 0.881, sub 1.023, kd 1.327 }`.
- `realism.disp` (att 20.5, acc 4.42, kd 1.96, td_att 2.75, td_acc 1.36, sub_att 2.26) is reproduced exactly.
- `realism.knobSd` is `{}`, which falls back to the form sds.

**Sensitivity.**
- Each item rebuilds the matchup with the original options, with `adjA` / `adjB[key]` multiplied by `exp(-/+ z sd)`.
  Judges' power is additive and floored at 0.
- Every variant replays the same per-fight seeds.
- Returns `lo`, `hi`, `dPA`, `dPWin`, `swing` and the paired MC `se`, sorted by swing.
- `rateSd`: sd(log rate) = sqrt(phi / I) and sd(logit p) = sqrt(phi / (n p (1 - p))). pow / chin are multiplied by
  `powExp` / `chinExp`.

## Risks and interactions

- **Refit last.** If the layer is ever turned on, refit it after durability, dynamics and any other change to KO / SUB /
  KD / TD levels. Stale factors correct twice; the 15:53 factors on v4.0.1 final showed this for TD and control.
- **5-round KD overlaps dynamics.** If dynamics adds a format or round KD hazard, the format factor overlaps it. Measure
  with `realism.js report` after merging dynamics, and use the format factor only if a gap remains.
- **Sensitivity bars show what moves the number, not calibrated intervals.**
  - Rate sds come from the profile sums. On the learned-rate path they overstate what the simulator plays.
  - Knob sds are the fight-night form sds, which include model error.
  - Common random numbers are partial: paired se is about 20-35% below independent runs, about 1 point at n = 1,500.
- **Fixture.** `tests/fixtures/realism_sens_base.json` pins `1f30636`. On another base, run
  `node tests/test_realism_sens.js --ref <base commit> --write-fixture` once, then run it again without the flag.
- **Shared machine.** All runs used at most 3 workers at `nice -n 5`. My scripts and logs are in
  `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/rsv/`. Round 3 is in `rsv/m3/`, with
  `score_cv.md`, `score_a.md`, `score_b.md`, `score_insample.md`, `score_cv_ship_pre.md`, `score_fmt5.md`,
  `score_fmtkd5.md` and the fit files `fit_a.json`, `fit_b.json`, `fit_all.json`.
