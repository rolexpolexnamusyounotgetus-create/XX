# Changelog

Each engine version records its held-out numbers here (docs/ROADMAP.md). "Test" means UFC fights from
2024-01-01 to 2026-10-31 whose profiles were frozen before the fight and which no tuning step ever saw.

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

**Volkanovski vs Gaethje** (Lightweight, 5 rounds, title, 20,000 fights, current profiles, tuned values):
- **Win:** Volkanovski 62.7%, Gaethje 36.6%, draw 0.7%. Elo alone gives 57.2% (1802 vs 1737); the blend gives 65.4%.
- **Outcome bins:**

  | Volk KO/TKO | Volk sub | Volk dec | draw | Gaethje dec | Gaethje sub | Gaethje KO/TKO |
  |---|---|---|---|---|---|---|
  | 14.6% | 4.3% | 43.8% | 0.7% | 17.9% | 2.1% | 16.6% |

- **Finishes by round:**

  | | R1 | R2 | R3 | R4 | R5 |
  |---|---|---|---|---|---|
  | Volkanovski | 3.8% | 4.1% | 4.6% | 4.0% | 2.5% |
  | Gaethje | 5.6% | 4.3% | 3.2% | 3.6% | 2.0% |

- **Distance:** 62.4% go the distance (UD 81%, SD 17%).
- **Knockdowns:** per landed standing head strike, Gaethje 1.27% vs Volkanovski 0.54%.
- **Change from before:** before the walk-forward tuning the same matchup gave Volk 62.9%, but with only 41% going the distance. The tuned engine
  keeps the winner split and moves about 21 points from finishes to decisions, mostly through `caution5` (5-round
  fights) and the lower chin exponent.

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
