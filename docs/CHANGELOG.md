# Changelog

Each engine version records its held-out numbers here (docs/ROADMAP.md). "Test" means UFC fights from
2024-01-01 to 2026-10-31 whose profiles were frozen before the fight and which no tuning step ever saw.

## v4 (2026-11-06): learned stat-line rates in the engine, train-only priors, EM judging, the standard evaluation

Status: built and measured on TRAIN only (2019-2023). The single validation look (2024-2025) is the next step:
`node tools/evalv.js --version v3 --split val` and then `node tools/evalv.js --version v4 --split val --compare v3`.
That run also runs the blend test and fills `validation` / `blend` in data/derived/version_history.json. Frozen files:
versions/v3/ (copied before any v4 edit) and versions/v4/ (engine3.js, params3.js, ml/mlrates.js).

### What changed vs v3

1. **The learned stat-line model runs inside the engine.**
   - `FightEngine.loadMLRates(json)` loads data/derived/mlrates.json through src/ml/mlrates.js.
   - When a model is loaded, `matchup()` = `matchupBase()` (the v3 tables) plus `MLRates.applyToMatchup` at the
     engine's own league level.
   - `opts.ml === false` keeps the base tables. `opts.ml = { pred }` takes precomputed per-side rates (the leak-free
     backtest path). `params.mlWeight` and `params.mlMaxRatio` are the new params.
   - The page: build.py puts src/ml/mlrates.js in the engine script, so the tally worker built from that script's text
     has the adapter. src/app.js posts the model JSON to the worker; the worker also receives every matchup with the
     learned tables applied. Headless check: v4 engine with the native model, a 20,000-fight tally in the background
     thread with ML stat lines on, no console errors.
   - src/ml/mlrates.js `leagueExpect` now calls `matchupBase` with `ml: false`, so there is no recursion. Its cache key
     carries the per-call params overrides, so a tuner's strikeScale change is no longer masked by a cached league level.
2. **Train-only priors.**
   - `tools/build_db.py --priors-until 2024-01-01 --priors-only --priors-out data/derived/priors_dev.json` builds them
     from fights 2018-01-01..2023-12-31 (Lightweight 406 fights vs 608 in the production priors).
   - The engine's self-calibration was re-run on them (`tests/test_engine3.js --fit --write --priors ...`): global
     scales and every `div.*` factor.
   - tests/test_engine3.js now checks base rates against these priors by default.
3. **Judging.**
   - EM round-winner weights: head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min, sub attempt 0.85.
     The engine-only hurt weight is 0.8.
   - tools/judgecal.js fit the noise and the 10-8 rule by maximum likelihood on the 3,883 judges' rounds of 2019-2023
     (data/derived/judgerounds_rows.json):
     - shared sd 1.53 and individual sd 1.08;
     - a fight-level share of the shared noise of 0.28 (LR 101: panel residuals correlate about 0.12 between rounds of a
       fight);
     - no fight-level judge tastes: a judge who dissents twice in a fight goes either way equally often (37 vs 40);
     - 10-8 threshold 6.29 (2019-2020) / 7.07 (2021-2023), with -1.09 per KD of edge (a KD-edge round winner gets a
       10-8 13% of the time, not the 23% the z margin alone implies).
   - On the real rounds the fitted judges reproduce:
     - non-unanimous rounds 22.6% (data 21.3%);
     - pair disagreement 15.1% (14.2%);
     - majority agrees with the EM leader 81.7% (82.9%);
     - 10-8 share 4.5% / 3.7% (4.5% / 3.6%);
     - 10-8 given a KD edge 13.5% (13.1%).
     Decisions come out UD 76.5% vs 80.3%, the one gap left.
   - In the engine, sharedSd is 1.416 (the hurt/power terms' residual variance taken out) and sharedFight 0.33.
4. **Re-tune on TRAIN only.**
   - tools/mlcal.py with tools/mlcal_spec_engine4.json: 11 global scales including mlWeight, learned rates on through
     tools/mlcal_hooks/ml_oof_v4.js, 20 TPE + 16 CMA trials, `--no-val`.
     - No finalist beat the self-calibrated set on both train windows: baseline tuning 1.5596 / confirmation 1.5573;
       best finalists 1.5667 / 1.5551 and 1.5487 / 1.5680.
     - Nothing was adopted (data/derived/mlcal_candidates_v4.json).
   - tools/v4_levels.js then matched four levels on 1,000 train fights with the learned rates on: kdScale 1.236 ->
     1.391, KO conversion x0.89 on odds, subConvScale 1.488 -> 1.847, t108 7.07 -> 8.555. The self-calibrated league level
     ran about 10% low on knockdowns per landed head strike on real fights, and the engine's rounds, with hurts, gave
     6.9% 10-8s against 3.6%.

### The standard evaluation (tools/evalv.js, new)

- Fights are symmetric (both corner orders), with common random numbers, 300 sims per order, walk-forward priors and
  out-of-fold learned rates.
- CIs come from a 2,000-resample event-cluster bootstrap.
- methodround `--score` gives the who x how x when metrics, paired against model S.
- There is also a stat-line deviance and a base-rate table.
- The blend test is tools/evalv_blend.py: the MoE linear stacker refit with the version's engine, then the validated
  engine weight and the validation log loss with and without the engine. It only runs on the validation run; its
  plumbing was checked train-only with `--dry` (fit 2019-2022, score 2023).
- Results: data/derived/evalv/, data/derived/version_history.json.

### Train numbers (2019-2023; tuning data for both versions, so not a selection criterion)

| train 2019-2023 (1,952 decisive of 1,999 fights) | v3 | v4 | v4 - v3, paired [95% CI] |
|---|---|---|---|
| Winner log loss | 0.6716 [0.6620, 0.6814] | 0.6635 [0.6529, 0.6740] | -0.0081 [-0.0134, -0.0026] |
| Brier | 0.2394 [0.2349, 0.2441] | 0.2355 [0.2304, 0.2405] | -0.0040 [-0.0065, -0.0012] |
| Accuracy | 0.5710 [0.5501, 0.5912] | 0.6053 [0.5817, 0.6290] | +0.0343 [+0.0163, +0.0524] |
| 7-bin log loss | 1.6636 [1.6350, 1.6929] | 1.6710 [1.6320, 1.7098] | +0.0074 [-0.0092, +0.0254] |
| Method (KO/SUB/DEC) log loss | 0.9690 [0.9462, 0.9929] | 0.9672 [0.9436, 0.9923] | -0.0018 [-0.0087, +0.0059] |
| ECE (10 bins, mirrored) | 0.0181 | 0.0187 | |
| Calibration slope (mirrored, no intercept) | 0.926 [0.741, 1.111] | 1.059 [0.894, 1.292] | |
| Stat-line deviance per fighter: sig landed | 24.302 [23.053, 25.492] | 23.681 [22.487, 24.885] | -0.621 [-0.931, -0.321] |
| Stat-line deviance per fighter: sig attempts | 50.607 [48.156, 53.044] | 49.318 [46.923, 51.668] | -1.289 [-1.939, -0.616] |
| Stat-line deviance per fighter: takedowns | 1.856 [1.780, 1.941] | 1.740 [1.660, 1.822] | -0.116 [-0.150, -0.081] |
| Stat-line deviance per fighter: control s | 164.526 [157.959, 171.090] | 156.470 [149.458, 163.351] | -8.056 [-10.534, -5.356] |
| Stat-line deviance per fighter: knockdowns | 0.721 [0.689, 0.756] | 0.715 [0.684, 0.748] | -0.006 [-0.015, +0.003] |
| who x how x when log loss (model S 2.1523) | 2.1984 (+0.0461 [+0.0301, +0.0625]) | 2.2031 (+0.0508 [+0.0322, +0.0701]) | +0.0047 |
| method (methodround) log loss (model S 0.9569) | 0.9690 (+0.0121 [+0.0039, +0.0206]) | 0.9672 (+0.0103 [+0.0018, +0.0195]) | -0.0018 |
| method x round log loss (model S 1.4811) | 1.5001 (+0.0191 [+0.0087, +0.0297]) | 1.4977 (+0.0167 [+0.0054, +0.0283]) | -0.0024 |
| round given finish log loss (model S 1.0620) | 1.0787 (+0.0167 [+0.0048, +0.0284]) | 1.0773 (+0.0153 [+0.0039, +0.0264]) | -0.0014 |

| base rate (train) | actual | v3 | v4 |
|---|---|---|---|
| finish rate | 49.2% | 49.6% | 49.2% |
| KO/TKO share | 31.7% | 32.1% | 32.3% |
| submission share | 17.5% | 17.4% | 16.9% |
| decision share | 50.8% | 50.4% | 50.8% |
| finish by round, 3-round fights | 24.4/16.7/7.5 | 25.3/14.5/9.2 | 25.1/14.5/9.1 |
| finish by round, 5-round fights | 17.3/16.5/9.5/5.3/4.9 | 15.3/13.2/10.4/9.2/5.4 | 14.5/12.8/10.4/9.3/5.4 |
| KD per 100 head landed | 0.782 | 0.788 | 0.784 |
| decisions UD / SD / MD | 78.6 / 19.4 / 2.0 | 79.4 / 19.2 / 1.4 | 79.3 / 20.2 / 0.5 |
| 10-8 share of judge-rounds in decisions | 5.29% (cards; 4.5% 2019-23 and 3.6% 2021-23 in the judges' rounds) | 5.09% | 3.46% |
| sig landed per 15 (per fighter) | 61.1 | 61.0 | 61.7 |
| takedowns per 15 | 1.31 | 1.31 | 1.23 |
| control s per 15 | 163 | 164 | 155 |

Read: on train, v4 beats v3 on the winner and on every stat line except knockdowns (tie). The 7-bin, method and
who-x-how-x-when scores are level with v3, and both trail methodround model S there. v3's train numbers are flattered
too: its walk-forward stage was tuned on these fights, and its [selfcal] values saw all-years league rates. The 5-round
finish curve is still off in both versions (too few early finishes, too many in R3-R4); that is v6 (dynamics).

## v3 (2026-11-06): data-driven any-fighter engine, walk-forward calibrated

### What changed vs v2

v2 was a hand-built Volkanovski vs Gaethje simulator:
- Its constants, knobs, presets, director tables, 3D specs and page copy were all hard-wired to those two fighters.
- Strike rates averaged career landed/min with absorbed/min and multiplied by `STRIKE_CAL = 0.85`, a factor tuned on 4
  in-sample fights. The audit found that formula under-predicts landed strikes by 18% walk-forward.
- Night-to-night form spreads were tiny (output 0.10, power 0.15, chin 0.12).
- It finished 36% of five-round fights against 58% in the data, with a hazard that rose by round.
- Knockdowns converted to same-round finishes 37% of the time against 57% in the data.
- Its "backtest" was 7 in-sample fights (research/audit_v2.md).

v3 (src/engine3.js, src/params3.js, docs/ENGINE_V3_SPEC.md) replaces all of that:
- **Any two fighters.** 1,229 profiles in data/derived/fighters.json, built from round-level ufcstats data.
  - Sums are time-decayed (730-day half-life) and shrunk toward the fight division's priors.
  - Profiles become rates only inside the engine, so a live profile and a frozen backtest snapshot go through the same code.
- **Matchup construction.** Attacker and defender rates combine log-linearly; probabilities combine by log5 on odds.
  - Strikes are attempts times accuracy, by target (head/body/leg) and position (distance, clinch, ground), so misses are real events.
  - Clinch entry and stand-up hazards are fit per pair, so simulated control and clinch time match the pair's data-implied targets.
- **Fight model.** Ground sub-positions (guard, half, side, mount, back) with passes, escapes, sweeps and stand-ups.
  - Knockdowns come from power x chin with age, prior-KO-loss and size factors. A knockdown leads to an instant KO or a follow-up with a referee-stop hazard.
  - Also modeled: hurt states; standing, ground-and-pound and leg-kick TKOs; position-specific submissions plus guillotines on stuffed shots; doctor and corner stoppages; stamina and pace curves.
- **Judging.** Three judges use the round-winner logistic weights fit on real rounds, with fight-level tastes, shared and individual noise, and 10-8 rules.
- **Trace.** The trace keeps the v2 event kinds, so src/director.js still works.
- **Calibration and validation.** tools/calibrate.js (new) does the walk-forward calibration and validation described below.

This entry also adds four tunable hooks to the engine and params. Each defaults to neutral, and the engine VERSION stays 3.0.0:
- `powExp` and `chinExp`: exponents on the shrunk power and chin ratios.
- `ctrlScale`: a global control-target scale, the inverse of a get-up scale.
- `caution5`: a knockdown / GNP / submission-conversion factor in every round of 5-round fights.

### How it was calibrated (tools/calibrate.js)

`node tools/calibrate.js [--quick] [--final-only] [--no-write] [--budget=MIN] [--n=N] [--nfinal=N]` uses worker_threads, one per core.

**Data.** Every entry of data/derived/backtest.json: 3,237 UFC fights from 2019-01-01 to 2026-10-31 in which both men had an
earlier UFC fight.
- Each side is the snapshot built only from fights before that date.
- Division priors come from `priors_asof[year]`: the 5 years before Jan 1 of the fight's year, so nothing from the
  fight's year or later leaks in. fighters.json priors include test fights and are kept for live use only.
- **Split:** train 2019-2023, 1,955 decisive fights (1,972 with a known method, draws included). Test 2024-01-01 on, 1,223 decisive (1,229).
- Every fight is simulated with fixed per-simulation seeds.
- Everything is corner-symmetric, because ufcstats lists the winner first 56% of the time:
  - no model has an intercept;
  - calibration bins count every fight in both orientations;
  - the blend is a no-intercept logistic regression.

**Why not plain coordinate descent on log loss.** In a continuous-time event simulation, common random numbers stay
shared only for the first few events. The Monte Carlo sd of the train objective was 0.003 even at 150 simulations per
fight, as large as most parameter effects. So tuning ran in two stages.

**Stage 1: fixed point on train data targets.** Eight dampened iterations at N=80 per fight:
- **Volumes (moment-matched):** strike attempts, accuracy, KD per landed head strike, takedown attempts and accuracy,
  control and submission attempts per minute.
- **Outcome shares:**
  - the KO share sets `koAll`, which scales instant-KO and referee-stop odds plus the standing and GNP TKO hazards;
  - the SUB share sets submission conversion;
  - the 5-round finish rate sets `caution5`;
  - the unanimous share of decisions sets the individual judge noise.
- **Per-fight dispersion (new):** the engine's predictive spread of each fighter's landed rate and accuracy is
  widened until it matches how far real fights fall from the engine's mean.
  - The part of the error the two fighters share goes to the shared fight pace; the rest goes to individual form.
- **Finish timing:** the round-1 share of 3-round finishes sets the power/chin form spread.
- **Knockdown regression (new):** a Poisson regression of actual knockdowns on the engine's predicted knockdowns (as an
  offset), with power ratio, opponent chin ratio, ages past 34, prior KO losses and weight moves as covariates.
  - It updates `powExp`, `chinExp`, `chinAge`, `powAge`, `chinKO` and `sizeChin`, each coefficient shrunk by its precision.

**Stage 2: coordinate descent with shrinking steps** on the train objective. The objective is winner log loss +
0.5 x 7-bin log loss + base-rate drift penalties (finish rate in 3 and 5 rounds, KO and SUB shares, KD/100, unanimous share).
- It covered the levers without a direct data target: judge-noise scale, fight volatility, 5-round round-1 caution and
  pacing, and the standing and GNP TKO hazards.
- A step had to beat 2 Monte Carlo sd at N=150. None did, so those levers keep the builder's values.
  stko and gnpTko are still rescaled through `koAll`.

**Final evaluation.** N=1,000 simulations per fight on train and test, with fresh seeds. Compute was 37.7 minutes on 4
cores at a load average of 45-50 from other jobs.

### Tuned values (src/params3.js, tagged `[walkfwd 2026-11-06]`)

| parameter | before | after | driven by |
|---|---|---|---|
| form.out (output sd) | 0.15 | 0.357 | per-fight landed-rate dispersion (ratio 2.07 -> 1.00) |
| form.pace (shared pace sd) | 0.10 | 0.329 | A/B residual covariance (0.117 data vs 0.046 sim -> matched) |
| form.acc (accuracy logit sd) | 0.12 | 0.478 | per-fight accuracy dispersion (ratio 2.44 -> 1.00) |
| form.pow = form.chin | 0.45 | 0.316 | round-1 share of 3-round finishes |
| judge.indSd | 1.206 | 1.975 | unanimous share of decisions (82.5% -> 79.4%, data 78.6%) |
| chinExp / powExp | 1 / 1 | 0.546 / 1.104 | knockdown regression (opponent-chin coefficient -0.39 +- 0.13 at the start) |
| powAge | 0.03 | 0.115 | knockdown regression (power past 34: -0.097 +- 0.028 per year at the start) |
| chinKO | 0.04 | 0.124 (cap 1.15 kept) | knockdown regression |
| sizeChin | 0.05 | 0 | knockdown regression (moving up: -0.16 +- 0.08; no extra knockdowns absorbed) |
| chinAge | 0.04 | 0.041 | knockdown regression (no change needed) |
| kdInstant / kdRefStop | 0.376 / 0.190 | 0.318 / 0.153 | KO share (`koAll` 0.771; stko 0.0446 -> 0.0344, gnpTko 0.032 -> 0.0247) |
| subConvScale | 1.385 | 1.619 | SUB share |
| caution5 (new) | 1 | 0.626 | 5-round finish rate (63.6% -> 53.6%, data 53.5%) |
| strikeScale / accScale / kdScale | 1.063 / 0.950 / 1.232 | 1.107 / 1.021 / 1.246 | attempts / accuracy / KD per 100 head landed |
| tdScale / tdOddsScale / subAttScale / ctrlScale | 1.008 / 0.904 / 1.073 / 1 | 0.972 / 0.910 / 1.042 / 1.004 | takedown / submission / control rates |

Unchanged: judge.sharedSd 1.1, form.vol 0.6, form.grap 0.3, r1Caution5 0.75, drainSchedExp 0.2, per-division factors
(`div`).

Effect on the train objective: 1.592 -> 1.508. Winner log loss 0.681 -> 0.672, 7-bin 1.707 -> 1.672, drift penalty
0.057 -> 0. The noise-corrected train calibration slope went from 0.76 (overconfident) to about 1.0.

### Numbers

Winner metrics exclude draws and no-contests. ECE uses 10 bins over both corner orientations. Slope is a
no-intercept logistic recalibration slope: below 1 means overconfident, above 1 means underconfident.

**Held-out test, 2024-01-01 to 2026-10-31** (n = 1,223 decisive; 1,229 for 7-bin):

| model | log loss | Brier | accuracy | ECE | slope | 7-bin log loss |
|---|---|---|---|---|---|---|
| engine v3 | **0.6480** | **0.2281** | **64.0%** | 4.5% | 1.37 | **1.605** |
| Elo (scale 515 fit on train) | 0.6805 | 0.2438 | 55.0% | 1.8% | 1.28 | 1.717 (Elo x train method split) |
| blend (0.830 x engine logit + 1.173 x Elo diff / 400) | 0.6453 | 0.2268 | 63.0% | 3.9% | 1.47 | - |
| naive: more prior UFC wins | 0.6928 | 0.2498 | 53.3% | 3.1% | - | - |
| coin flip | 0.6931 | 0.2500 | 50% | - | - | - |

**Test slices:**

| slice | n | engine LL | Elo LL | blend LL | engine accuracy |
|---|---|---|---|---|---|
| 2024-2025 (the validation window from v4 on) | 854 | 0.6434 | 0.6783 | 0.6399 | 65.0% |
| 2026 (the vault from v4 on) | 369 | 0.6586 | 0.6857 | 0.6579 | 61.7% |
| 3-round fights | 1,076 | 0.645 | 0.681 | - | 65.2% |
| 5-round fights | 147 | 0.670 | 0.675 | - | 55.1% |

**Train, 2019-2023** (n = 1,955), at the tuned values:

| model | log loss | Brier | accuracy | ECE | slope | 7-bin log loss |
|---|---|---|---|---|---|---|
| engine | 0.6721 | 0.2396 | 57.7% | 1.8% | 0.92 | 1.661 |
| Elo | 0.6851 | 0.2460 | 54.9% | 0.7% | 1.00 | 1.739 |
| blend | 0.6688 | 0.2381 | 58.9% | 0.6% | 1.00 | - |

**Before vs after tuning, on test.** The builder's self-calibrated parameters scored log loss 0.6584, Brier 0.2329,
accuracy 61.5%, ECE 1.7%, slope 0.94 and 7-bin 1.630.
- That read used N=100 simulations per fight. Monte Carlo noise inflates log loss by about 1/(2N), so the comparable
  winner log loss is about 0.654, against 0.648 after tuning. The comparable 7-bin is about 1.60, about the same as after.
- So tuning bought about 0.006 nats of winner log loss, 0.005 of Brier and 2.5 points of accuracy on test.
- It cost calibration error: ECE 1.7% -> 4.5%, because the tuned engine is underconfident in 2024+ (see caveats).

**Per division (test):** the engine beats Elo in 9 of 11 divisions.
- **Engine ahead:** LW 0.654 vs 0.676; MW 0.634 vs 0.676; FW 0.655 vs 0.692; BW 0.665 vs 0.691; WW 0.630 vs 0.693;
  FLW 0.646 vs 0.681; Women's Strawweight 0.609 vs 0.680; Women's Flyweight 0.635 vs 0.658; Women's Bantamweight 0.598 vs 0.687.
- **Elo ahead:** Light Heavyweight (0.695 vs 0.662, n=83) and Heavyweight (0.687 vs 0.671, n=79).

**Base rates, simulated vs actual:**

| | train sim | train actual | test sim | test actual |
|---|---|---|---|---|
| finish rate | 49.6% | 49.2% | 48.4% | 48.9% |
| finish rate, 5 rounds | 53.6% | 53.5% | 51.9% | 54.4% |
| KO/TKO / SUB / decision | 32.1 / 17.4 / 49.4 | 31.7 / 17.5 / 49.8 | 31.0 / 17.4 / 50.6 | 31.9 / 17.0 / 50.5 |
| 3 rounds: finished in R1 / R2 / R3 | 25.3 / 14.5 / 9.2 | 24.4 / 16.7 / 7.5 | 24.5 / 14.4 / 9.1 | 26.0 / 14.2 / 8.0 |
| 5 rounds: R1 / R2 / R3 / R4 / R5 | 15.4 / 13.2 / 10.4 / 9.2 / 5.4 | 17.3 / 16.5 / 9.5 / 5.3 / 4.9 | 14.6 / 12.7 / 10.3 / 9.2 / 5.2 | 15.0 / 17.7 / 10.9 / 6.1 / 4.8 |
| unanimous / split / majority (of decisions) | 79.4 / 19.2 / 1.4 | 78.6 / 19.4 / 2.0 | 79.6 / 19.1 / 1.4 | 82.6 / 16.4 / 1.0 |
| KD per 100 head strikes landed | 0.785 | 0.781 | 0.731 | 0.768 |
| sig. landed / attempted per 15 per fighter | 61.0 / 130.9 | 61.1 / 131.0 | 63.4 / 129.4 | 58.1 / 122.8 |
| takedowns landed per 15, accuracy | 1.31, 36.5% | 1.31, 36.5% | 1.37, 35.9% | 1.43, 35.9% |
| control seconds per 15 | 163 | 163 | 166 | 168 |

**Per-fight stat error (test).** Each fighter-side's simulated rate per minute is multiplied by the actual fight
minutes and compared with the division-average rate.
- Significant strikes landed: MAE 18.2 against 20.3 for the division average; RMSE 25.1 against 27.8; correlation 0.45; bias +9.3%.
- Takedowns landed: MAE 1.04 against 1.18; correlation 0.41; bias -4.5%.

**Volkanovski vs Gaethje** (Lightweight, 5 rounds, title, 20,000 fights, seed 20261106, current profiles, src/params3.js
as written):
- **Win:** Volkanovski 63.3%, Gaethje 35.9%, draw 0.7%. Elo alone gives 57.2% (1802 vs 1737); the blend gives 66.0%.
- **Outcome bins:**

  | Volk KO/TKO | Volk sub | Volk dec | draw | Gaethje dec | Gaethje sub | Gaethje KO/TKO |
  |---|---|---|---|---|---|---|
  | 14.9% | 4.0% | 44.5% | 0.7% | 17.3% | 2.2% | 16.4% |

- **Finishes by round:**

  | | R1 | R2 | R3 | R4 | R5 |
  |---|---|---|---|---|---|
  | Volkanovski | 3.8% | 4.1% | 4.4% | 4.0% | 2.6% |
  | Gaethje | 5.7% | 4.3% | 3.2% | 3.6% | 1.8% |

- **Distance:** 62.5% go the distance (UD 81%, SD 16%).
- **Knockdowns:** per landed standing head strike, Gaethje 1.27% vs Volkanovski 0.54%.
- **Doctor and corner stoppages:** 5.3% of fights. These run high in general: the sim gives 1.6% doctor + corner
  stoppages on train fights vs 0.6% doctor stoppages in the data, where corner stoppages are filed under KO/TKO.
- **Change from before:** before the walk-forward tuning the same matchup gave Volk 62.9%, but with only 41% going the distance. The tuned engine
  keeps the winner split and moves about 21 points from finishes to decisions, mostly through `caution5` (5-round
  fights) and the lower chin exponent.

**Tests:** `node tests/test_engine3.js` passes 42 of 42 with the tuned values. That includes the league-average
base-rate checks for all 8 checked divisions: Lightweight finish 52.3% vs 52.7% data, KO 34.1% vs 35.6%, SUB 18.1%
vs 17.1%, KD/100 head landed 0.889 vs 0.875.

### Caveats (honest)

1. **The test period is more predictable than train, and the tuned engine is underconfident there.** Its test slope is
   1.37, so its probabilities should be stretched, and ECE is 4.5%. Elo with a train-fit scale shows the same shift
   (slope 1.28), so it is a period effect more than an engine one. Before tuning the engine was sharper and better
   calibrated on test (ECE 1.7%) but had worse log loss, Brier and accuracy. Recalibrating on train does not fix this,
   because on train the engine is already calibrated (slope 0.92). A v9 recalibration should be fit on the 2024-2025
   validation window.
2. **Stage 2 changed nothing.** The judge-noise scale, fight volatility, 5-round pacing and the standing/GNP TKO split
   could not be distinguished from Monte Carlo noise (objective sd 0.003 at N=150). They stay at the builder's values.
3. **5-round finishes are spread too evenly by round.** Round 4 is over-predicted (9.2% of fights vs 5.3% train and
   6.1% test) and round 2 under-predicted (13% vs 17-18%). The total is right on train and 2.5 points low on test.
4. **Strike volume is 9% high on test.** UFC fights in 2024-2026 had fewer attempts (122.8 vs 131.0 per 15) and the
   division priors lag (the 5 years before the fight's year). The volume scales were matched on 2019-2023.
5. **The widened form spreads are not pure night-to-night form.** form.out 0.36, pace 0.33 and acc 0.48 were fit to how
   far real fights fall from the engine's mean, so they include the engine's own prediction error. That is the right
   width for calibrated outcomes, but a single simulated fight is now noisier than a typical real fight between two
   known quantities.
6. **The per-division factors (`div`) leak a little base-rate information.** They come from the builder's
   league-average self-calibration against fighters.json priors, which include 2024+ fights. That is rates only, not
   per-fight outcomes.
7. **The Elo baseline itself was tuned on 2019-2023** (K 44, boost 1.5 in data/derived/elo_report.json). Its scale was refit
   here (515). The blend weights also come from train.
8. **v3 used the 2026 slice once,** as the v3 task specified (test = 2024-01-01 on). From v4 on that slice is the sealed
   vault (docs/BACKLOG.md), so later versions should compare on the 2024-2025 numbers above.
9. **Volkanovski vs Gaethje disagrees with the market.** The openers (Oct 24-25, 2026; docs/BACKLOG.md) have Gaethje
   a -180 to -200 favourite, 37% no-vig for Volk. The engine has Volk 63%, Elo 57%. The engine's edge for Volk comes
   from his landed-volume and accuracy rates. The market may be pricing things the stats see only partly (age 38, three
   KO losses, the move up; the knockdown regression found no extra knockdown risk for moving up across 3,950
   fighter-sides). Treat the engine number as the stats view, not a betting line.
10. **Monte Carlo:** N=1,000 per fight inflates log loss by about 0.0005. Debutants are excluded from the backtest, since both men need a
    prior UFC fight.
