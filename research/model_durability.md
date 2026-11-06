# Durability and power: knockdown chin and power model (engine v5 component)

Tool: `tools/durability.py` (run `python3 tools/durability.py`, about 5-10 minutes; `--quick` skips the tuning
grid and reuses the tuned spec). Output: `data/derived/durability.json`. Independent re-implementation used for
the verification: `tools/durability_verify.py` (output `data/derived/durability_verify.json`). Data: ufcstats
snapshot through Oct 31, 2026 (`data/raw/`), parsed with `tools/build_db.py`'s own loaders, people resolution and
Elo (K 44, boost 1.5). Built Nov 6, 2026.

**Revised Nov 6, 2026 after an adversarial verification pass (see the Verification log at the end).** The first
version carried a 36-parameter covariate set. Five of its blocks did not earn their place on the 2019-2023
validation window: layoff, last-fight-KO and quick return, UFC tenure and experience, career head strikes absorbed,
and attacker experience. Removing them by a validation-only rule cut the model to 24 parameters and improved
held-out 2024+ deviance by 19 (SE 7.5). The verification also made several other changes:

- The backtest values are now strict walk-forward. The first version used in-sample coefficients for 2019-2023.
- The headline comparisons now also report fighter-clustered SEs and a level-neutral check.
- The chin exponent of 1.15 is withdrawn.
- The numbers and the engine recommendation below are the revised ones.

## Summary

- **The model beats the constant-chin model by 238 deviance units on held-out 2024+ fights** (2,905
  attacker-defender rows, 681 knockdowns; SE 33 clustered by fight, 40 clustered on fighters). That is 8.6% of
  the deviance.
  - It beats the v3 engine's hand-set chin/power structure by 70 (SE 18-19).
  - Level-neutral, with each half-year rescaled to its observed total so the unexplained 2024-26 league-level
    swings don't count, the gain over v3 is still 37 (SE 16).
  - The fresh-code replication finds 63 (SE 18) raw and 29 (SE 16) level-neutral.
- **Fighter effects carry most of the signal.** Walk-forward empirical-Bayes chin and power multipliers are worth
  202 deviance units on their own. Both use Gamma priors: shape 3 for chin and 2.5 for power, worth about 290 and
  245 standing head strikes. Defender age, KO losses, prior knockdowns absorbed and attacker age add another 36 on
  top (SE 13; level-neutral 27, SE 12).
- **Age (published claim, "+4%/yr past 30").** It replicates exactly (+0.0400, SE 0.0056). The richer model keeps
  the size but not the shape:
  - Susceptibility rises about **+6%/yr at every age**: +6.1%/yr before 30 (SE 1.4%) and +6.0%/yr past 30 (SE
    0.9%). There is no knee (hinge -0.002, SE 0.019).
  - From 30 to 38 that is **x1.62** (live fit).
  - A separate UFC-tenure term (the first version's +2.9%/yr) does not predict out of sample once age is in.
- **Power aging.** Power falls **-3.6%/yr past 30 (SE 0.9%; live -4.0%)** and is flat before 30, so it falls
  x0.72 from 30 to 38. Dropping attacker age costs 10.4 deviance on 2019-2023 (SE 4.9).
- **KO losses and knockdown history.**
  - Each KO/TKO loss in the past year multiplies knockdown susceptibility by **x1.19 (SE 0.09)**; each older one
    by **x1.10 (SE 0.03)**.
  - Prior knockdowns absorbed enter the fighter's chin effect, and as covariates they temper it (x0.86 per recent
    one, x0.91 per older one). So the evidence has diminishing returns.
- **Not predictive, removed:**
  - Layoff (the first version's "x0.64 after two years").
  - Last fight a KO loss, and a quick return after one.
  - Years in the UFC and number of UFC fights.
  - Career head strikes absorbed.
  - Attacker experience.
  - Each costs less than one SE on 2019-2023 when dropped, and together they made 2024+ worse.
- **Size tax (published claim, "none after Elo control"): confirmed.**
  - Moving up a class costs nothing in win probability: +0.06 log-odds (SE 0.055) per class, n = 7,982.
  - Knockdowns absorbed per head strike are x0.91 (SE 0.13) per class up for the defender.
  - Weight-move terms add nothing on held-out data (+0.3, SE 3.0) and hurt on 2019-2023 (+16, SE 8.5).
  - The attacker moving up scores more knockdowns (x1.25 per class), which is selection: punchers move up.
- **Fight-night heterogeneity.**
  - Per-fight knockdown rates vary beyond the model with a lognormal sd of 0.78-0.84.
  - About a quarter of the variance is shared by both men (sd 0.48-0.49).
  - v3's shared `form.vol` 0.60 is too high, and its direction-specific power x chin sd of 0.64 is about right.
- **The league knockdown level moves a lot.**
  - Knockdowns per 1,000 standing head strikes were 5.95 during the 2024 glove trial (UFC 302 to UFC 309), against
    8.25 in the year before and 8.98 in the year after.
  - Over Nov 2025-Oct 2026 the rate was 11.7, and 2026 fights ended by KO/TKO at 40%.
  - At the snapshot the level is 10.27 per 1,000 over the trailing 730 days and 11.71 over the trailing 365.
- **KO/TKO loss per fight** (logistic, pre-fight features only): held-out log loss 0.4152, against 0.4378 for Elo
  + division. That is an improvement of 69 log-loss units (SE 11).
- **Volkanovski vs Gaethje** (155 lb, 5 rounds, 730-day level):
  - Gaethje drops Volkanovski 1.04 times per 100 landed standing head strikes (90%: 0.40-1.99).
  - Volkanovski drops Gaethje 0.59 times (0.21-1.19).
  - Per fight, P(KO/TKO loss) is 24.4% for Volkanovski (21.0-28.1) and 25.1% for Gaethje (21.2-29.3).

## 1. Data and walk-forward features

One row per attacker -> defender direction of every UFC fight with round stats: 17,948 rows from 8,974 fights.
The fit uses 2008-2023 (12,591 rows with exposure, 2,911 knockdowns). The test set is 2024-01-01 to 2026-10-31
(2,905 rows, 1,503 fights, 681 knockdowns), and none of it is used for fitting or tuning.

- **Outcome:** knockdowns scored by the attacker in the fight (ufcstats KD).
- **Exposure E:** standing head strikes landed by the attacker. ufcstats has no head-by-position cross-tab, so E
  is the midpoint of max(HEAD - GROUND, 0) and min(HEAD, DISTANCE + CLINCH), the same convention as
  `tools/baserates.py`. Standing head strikes are 90% of head strikes landed since 2019. Rows with E = 0 (1,097
  rows, 1 knockdown) are dropped.
- **Features are frozen before each fight.** They come only from earlier UFC fights. Fights are processed in
  date and bout order, and both directions of a fight are predicted before either is used to update.
- **Final model features:**
  - Defender: age as a linear spline with a knot at 30, plus a missing-age flag; knockdowns absorbed in the last
    365 days and before that; KO/TKO losses (strikes or corner, doctor stoppages excluded) in the last 365 days
    and before that.
  - Attacker: age spline.
  - Context: division (Lightweight reference), five-round, title.
- **Tested and removed by the 2019-2023 one-SE rule:**
  - Years in the UFC, ln(1 + UFC fights), career sig head strikes absorbed, UFC debut flag.
  - Layoff (< 120 days, 365-730, 730+).
  - Last fight a KO/TKO loss, and that loss with a return inside 180 days.
  - Attacker years in the UFC, ln(1 + fights), debut.
- **Tested and not added:** weight move (classes or pounds, up and down, both men); height and ape index relative
  to the division; reach and height advantage.
- **Home division** is the most frequent real division over the 3 years before the fight
  (`build_db.mode_recent`). Weight move is fight division minus home, in classes (sexes kept apart) or pounds.
- **League level L(t):** knockdowns per standing head strike over the 730 days before the fight (strictly
  earlier days), from all rows. It is walk-forward and enters as an offset.
- **Fighter effects:** chin u_d and power v_a are Gamma(alpha, alpha) multipliers. Their walk-forward posterior
  means are `u = (alpha_c + KD absorbed) / (alpha_c + expected KD absorbed)` over the fighter's earlier fights.
  "Expected" is the rest of the model times the opponent's power effect as of then; power is the mirror image
  with alpha_p. There is no time decay: half-lives of 5 and 8 years were tested, and none beat no decay by one SE.
- **Fitting:** a Poisson GLM with offsets log E + log L + log u + log v (Newton). It iterates fit -> walk -> fit
  four times. Coefficient SEs are model-based plus a sandwich clustered by defender.
- **Tuning (validation only: fit 2008-2018, score 2019-2023):**
  - A staged grid over the level window (180/365/730 days), age knots, the recent-history window (365/730/1095),
    and alpha for chin and power (2-10).
  - Then a **backward one-SE elimination** of the optional covariate blocks: at each step, drop the block whose
    removal costs the least in fight-clustered SEs of the 2019-2023 deviance difference, while that cost is under
    one SE. The steps are in `tuning_diagnostics.elimination`.
  - Then the alphas again, and the decay half-lives (kept off unless they beat no decay by one SE).
  - **Chosen spec:** level 730, knot 30, window 365, alpha_chin 3, alpha_power 2.5, no decay, blocks {prior KDs
    absorbed, KO losses, attacker age}. Its 2019-2023 deviance is 4,341.9, against 4,339.1 for the 36-parameter
    version, which is within noise for 12 fewer parameters.
- **Refits:** coefficients are refit on 2008-2023 and scored on 2024+. A final live fit on 2008 through the
  snapshot gives the roster numbers.

## 2. Held-out results (fit 2008-2023, scored on 2024+)

Poisson deviance on 2,905 rows (lower is better). Differences are summed over fights.

- "SE f" clusters by fight. "SE fr" clusters on fighters: each row belongs to both of its fighters' clusters, so
  the same fighter's effect shared across test fights is counted.
- "Level-neutral" rescales every model's predictions so each half-year's total matches the observed total. It is
  a diagnostic only, since it uses outcomes. It removes calibration-in-the-large, which in 2024-26 is dominated by
  the unexplained league-level swings.

| Model | Params | Test deviance | vs M0L (SE f / SE fr) | Level-neutral vs M0L (SE fr) | KD obs / exp |
|---|---|---|---|---|---|
| M0 constant KD per standing head strike | 1 | 2782.3 | +7.9 (18.2 / 23.8) | -1.7 | 681 / 790 |
| M0L constant + trailing league level ("constant chin") | 1 | 2774.5 | 0 | 0 | 681 / 596 |
| M1 + division, 5-round, title | 15 | 2714.9 | -59.6 (18.2 / 21.6) | -62.2 (23.2) | 681 / 578 |
| C30 M1 + years past 30, defender and attacker (claim form) | 17 | 2686.2 | -88.2 (20.4 / 22.5) | -86.2 (23.7) | 681 / 590 |
| M2 M1 + age splines | 20 | 2674.8 | -99.6 (20.9 / 22.9) | -94.3 (23.9) | 681 / 597 |
| M3 final covariates, no fighter effects | 24 | 2664.1 | -110.3 (22.1 / 23.8) | -104.2 (24.7) | 681 / 601 |
| M36 first version's 36-parameter covariates, no fighter effects | 36 | 2644.3 | -130.2 (24.8 / 27.8) | -142.5 (29.3) | 681 / 559 |
| V3 engine v3 structure (shrunk decayed ratios k = 230, chin age past 34, 1.04^KO capped 1.15, size) | 13 | 2606.8 | -167.6 (26.3 / 31.6) | -193.6 (34.0) | 681 / 537 |
| E1 M1 + fighter chin effect | 15 | 2639.4 | -135.1 (24.6 / 27.5) | -142.9 (28.8) | 681 / 575 |
| E2 M1 + fighter power effect | 15 | 2654.0 | -120.5 (27.5 / 35.2) | -116.0 (34.7) | 681 / 607 |
| E3 M1 + chin and power effects | 15 | 2572.8 | -201.6 (31.3 / 38.5) | -204.4 (38.6) | 681 / 596 |
| **F final: M3 + chin and power effects** | 24 | **2536.8** | **-237.6 (32.9 / 39.5)** | **-230.9 (39.1)** | 681 / 623 |
| F36 first version: 36-parameter covariates + chin and power effects | 36 | 2555.9 | -218.6 (33.3 / 40.0) | -210.7 (39.4) | 681 / 629 |
| F + weight move (classes) | 28 | 2537.1 | -237.3 | -230.1 | 681 / 624 |
| F + weight move (pounds) | 28 | 2538.7 | -235.8 | -227.4 | 681 / 626 |
| F + height, ape index, reach and height advantage | 28 | 2527.5 | -246.9 | -241.6 | 681 / 632 |

Paired differences on 2024+:

| Comparison | Δ deviance (SE f / SE fr) | Level-neutral (SE fr) |
|---|---|---|
| F vs V3 (engine v3 structure) | -70.0 (18.1 / 19.0) | -37.4 (15.8) |
| F vs E3 (fighter effects only) | -36.0 (13.0 / 12.7) | -26.5 (12.2) |
| F vs M3 (covariates only) | -127.3 (24.0 / 29.2) | -126.7 (29.0) |
| E3 vs V3 | -34.0 (16.0 / 17.6) | -10.8 (15.8) |
| F36 (first version) vs F | +19.0 (7.5 / 7.7) | +20.2 (7.4) |
| F36 vs V3 | -51.0 (19.0 / 20.0) | -17.2 (16.4) |
| F36 vs E3 | -17.0 (15.1 / 15.0) | -6.3 (14.3) |
| C30 vs M1 (adding the claim's age terms) | -28.7 (9.7 / 9.7) | -24.0 (9.5) |
| M2 vs C30 (spline over the claim's past-30 form) | -11.4 (5.6 / 6.0) | -8.1 (5.8) |
| F + weight move vs F | +0.3 (3.0 / 2.9); +16.2 (8.5) on 2019-2023 | +0.8 |
| F + pounds vs F | +1.8 (5.0 / 3.7) | +3.5 |
| F + body terms vs F | -9.3 (6.9 / 7.2); -2.7 (10.3) on 2019-2023 (within 1 SE), so not adopted | -10.7 |

On the backtest-eligible subset (both men had an earlier UFC fight, 2,379 rows), F beats M0L by 200.0 and F36 by
13.0.

**The first version overfit.** It has a lower training deviance than F (10,975 against 11,016 on 2008-2023),
yet a higher deviance on both 2019-2023 (in the validation fits) and 2024+.

**The test period runs hot.**

- Observed/expected under F is 0.82 in 2024, 1.26 in 2025 and 1.25 in 2026 (section 6).
- The trailing level lags the 2025-26 surge, and every model shares that offset.
- A model that happens to predict more knockdowns gets credit for it. That is why the level-neutral column
  matters: it cuts F's raw gain over V3 from 70 to 37. V3 predicts only 537 of the 681 knockdowns.

**Calibration of F on 2024+ (O/E; overall 1.09 because of the level surge):**

| Group | Rows | KD | M0L | M1 | V3 | F |
|---|---|---|---|---|---|---|
| Defender age < 27 | 326 | 55 | 0.82 | 0.89 | 1.05 | 1.15 |
| 27-30 | 630 | 129 | 1.09 | 1.10 | 1.29 | 1.21 |
| 30-33 | 831 | 183 | 1.05 | 1.09 | 1.22 | 1.02 |
| 33-36 | 651 | 159 | 1.22 | 1.22 | 1.29 | 1.01 |
| 36+ | 454 | 148 | 1.44 | 1.50 | 1.36 | 1.16 |
| Attacker age < 27 | 333 | 97 | 1.28 | 1.41 | 1.48 | 1.22 |
| 36+ | 442 | 80 | 0.93 | 0.96 | 1.19 | 1.08 |
| Defender moved down a class | 100 | 25 | 1.58 | 1.85 | 1.79 | 1.58 |
| Defender at home | 2,361 | 560 | 1.13 | 1.16 | 1.26 | 1.07 |
| Defender moved up a class | 140 | 20 | 0.72 | 0.74 | 0.72 | 0.70 |
| Defender UFC debut | 304 | 76 | 1.37 | 1.38 | 1.49 | 1.34 |
| Attacker UFC debut | 313 | 97 | 1.72 | 1.71 | 1.80 | 1.59 |
| Defender prior KO losses 0 | 1,632 | 320 | 0.95 | 1.01 | 1.21 | 1.08 |
| 1 | 695 | 181 | 1.28 | 1.31 | 1.36 | 1.15 |
| 2+ | 578 | 180 | 1.54 | 1.46 | 1.29 | 1.07 |
| Chin effect tercile: low (good chin) | 968 | 197 | 0.82 | 0.82 | 1.04 | 0.92 |
| high (weak chin) | 1,133 | 305 | 1.49 | 1.54 | 1.38 | 1.18 |
| Power effect tercile: low | 968 | 195 | 0.90 | 0.93 | 1.26 | 1.24 |
| high | 969 | 281 | 1.48 | 1.51 | 1.29 | 1.01 |

What the table shows:

- The age gradient that the constant model leaves (0.82 -> 1.44 across defender age bands) is mostly gone under
  F. Fighter effects alone (E3) leave it in place (0.77 -> 1.30 level-neutral). Defender age is what removes it.
- The KO-loss gradient (0.95 -> 1.54) is also gone.
- Debutants on both sides are under-predicted. The debut and experience terms did not help on 2019-2023, so this
  is a test-period observation; pre-UFC priors (`data/derived/preufc.json`) are the natural fix.
- Defenders who moved up get knocked down less than predicted, and defenders who moved down more (small counts).

**Fighter-effect calibration slopes** come from free coefficients on log u and log v in place of the fixed 1:

| Period | Chin slope (SE) | Power slope (SE) |
|---|---|---|
| Training, 2008-2023 | 0.88 (0.06) | 0.88 (0.05) |
| Validation, 2019-2023 (fit 2008-2018) | 0.98 (0.10) | 0.80 (0.08) |
| Test, 2024+ | 1.32 (0.13) | 0.83 (0.11) |

- **Chin.** Calibrated on validation, so no exponent is recommended. Applying the validation slope 0.98 changes
  2024+ deviance by +0.8. The 2024+ slope of 1.32 is flagged as an open item (Verification log) and not fitted,
  because it comes from the test period.
- **Power.** Effects are a little over-dispersed in every window. Applying the validation power exponent 0.80
  changes 2024+ deviance by only -2.3 (SE 4-5), so the exponent stays at 1.

## 3. Coefficients

These are log-rate coefficients on knockdowns per landed standing head strike. "Pre-2024" is the fit used for
held-out scoring; "live" is the fit on 2008 through Oct 31, 2026, used for the roster and the engine. SE (cl) is
clustered by defender.

| Term | Pre-2024 coef (SE, SE cl) | Live coef (SE cl) | Live multiplier |
|---|---|---|---|
| const (vs trailing league level) | +0.010 (0.058, 0.063) | +0.078 (0.058) | 1.081 |
| Bantamweight | +0.272 (0.072, 0.082) | +0.115 (0.076) | 1.121 |
| Featherweight | +0.034 (0.073, 0.081) | +0.083 (0.071) | 1.086 |
| Flyweight | +0.254 (0.097, 0.108) | +0.160 (0.092) | 1.173 |
| Welterweight | +0.138 (0.063, 0.066) | +0.089 (0.062) | 1.093 |
| Middleweight | +0.187 (0.069, 0.073) | +0.186 (0.067) | 1.205 |
| Light Heavyweight | +0.319 (0.075, 0.079) | +0.334 (0.073) | 1.396 |
| Heavyweight | +0.224 (0.080, 0.090) | +0.143 (0.081) | 1.154 |
| Women's Strawweight | -0.994 (0.145, 0.165) | -1.083 (0.147) | 0.339 |
| Women's Flyweight | -1.158 (0.181, 0.183) | -1.121 (0.155) | 0.326 |
| Women's Bantamweight | -1.089 (0.178, 0.182) | -1.061 (0.167) | 0.346 |
| Women's Featherweight | -0.508 (0.338, 0.379) | -0.563 (0.376) | 0.570 |
| Catch Weight | -0.019 (0.198, 0.203) | -0.092 (0.177) | 0.912 |
| Five-round | -0.088 (0.076, 0.092) | -0.111 (0.081) | 0.895 |
| Title | -0.069 (0.109, 0.126) | -0.096 (0.118) | 0.908 |
| Defender age - 30 (slope below 30) | +0.0595 (0.0117, 0.0137) | +0.0618 (0.0128) | 1.064/yr |
| Defender max(0, age - 30) (change past 30) | -0.0015 (0.0164, 0.0185) | -0.0016 (0.0170) | |
| Defender age unknown | +0.688 (0.319, 0.229) | +0.799 (0.216) | |
| Defender KDs absorbed, last 365 days | -0.149 (0.040, 0.049) | -0.143 (0.042) | 0.867 each |
| Defender KDs absorbed, older | -0.090 (0.018, 0.020) | -0.080 (0.018) | 0.923 each |
| Defender KO/TKO losses, last 365 days | +0.177 (0.060, 0.073) | +0.189 (0.065) | 1.208 each |
| Defender KO/TKO losses, older | +0.095 (0.028, 0.031) | +0.075 (0.028) | 1.078 each |
| Attacker age - 30 (slope below 30) | -0.0057 (0.0102, 0.0117) | -0.0044 (0.0108) | |
| Attacker max(0, age - 30) | -0.0314 (0.0159, 0.0180) | -0.0359 (0.0163) | |

**Age slopes by segment** (log scale per year; % per year):

| | Defender < 30 | Defender >= 30 | Attacker < 30 | Attacker >= 30 |
|---|---|---|---|---|
| F pre-2024 | +0.060 (0.014): +6.1% | +0.058 (0.008): +6.0% | -0.006 (0.012): -0.6% | -0.037 (0.009): -3.6% |
| F live | +0.062 (0.013): +6.4% | +0.060 (0.008): +6.2% | -0.004 (0.011): -0.4% | -0.040 (0.008): -4.0% |
| M2, age only (no fighter effects, no damage terms) | +5.1% | +3.5% | -1.3% | -2.8% |

From 30 to 38 the chin multiplier grows by exp(8 x 0.060) = **x1.62** (live fit), before any knockdown or
KO-loss history. Over the same span, power falls by exp(8 x -0.040) = **x0.72**. The first version split this
between age and a UFC-tenure term (x1.82 for an active fighter). Tenure does not predict out of sample once age is
in: dropping the tenure/experience block improves 2019-2023 deviance by 2.5.

**Prior knockdowns absorbed enter twice.**

- They raise u_d by (alpha + Y + 1) / (alpha + Y), and they lower the covariate term by x0.87 (recent) or x0.92
  (older) each.
- The net effect of one more knockdown is about x1.23 for a fighter with none so far and 3 expected, and about
  x1.05 for one who has already absorbed 4 (older knockdowns). The evidence has diminishing returns.
- Removing the covariate pair costs 19.4 deviance on 2019-2023 (SE 6.0).

**KO losses** add to that: x1.21 per KO loss in the past year and x1.08 per older one (live). Removing them costs
9.0 on 2019-2023 (SE 4.1).

**In-sample associations from the first version that do not predict** (`coef_pre2024.F36`; validation cost of
dropping each block in brackets):

- Layoff: 730+ days x0.60 [+5.9, SE 6.5 for the three layoff dummies].
- Last fight a KO loss, and the quick-return interaction (net x0.82 back within 180 days): [-0.0, SE 4.8].
- Years in the UFC, ln fights, career head absorbed, debut: [-2.5, SE 7.3].
- Attacker experience: [+1.1, SE 2.5].

They may reflect selection, for example commissions suspending the worst-hurt fighters. Either way they add
nothing to prediction once age, KO losses, knockdown history and the fighter effects are in. The engine should
not carry them.

**Body terms (tested, not adopted;** division means now taken from pre-2024 rows only**):**

| Term | Coef (SE cl) | Effect |
|---|---|---|
| Defender height above division mean | +0.081 (0.015) | +8% per inch |
| Defender ape index | +0.049 (0.016) | +5.0% per inch |
| Reach advantage (attacker - defender) | +0.047 (0.011) | +4.8% per inch |
| Height advantage | -0.034 (0.015) | -3.4% per inch |

Tall-for-division fighters get dropped more. The block helps on 2024+ (-9.3, SE 6.9), but only -2.7 (SE 10.3) on
2019-2023, which is within one SE. It is left for v7 (style and physical matchups) to recheck.

## 4. KO/TKO loss per fight

Logistic regression. One row per defender of each fight with stats; 2008-2023 fit (13,216 rows), 2024+ test
(3,034 rows). The outcome is a KO/TKO loss (strikes or corner, doctor stoppages excluded). Features are pre-fight
only.

- Expected exposure is the log ratio of the geometric mean of the attacker's standing head landed per minute and
  the defender's absorbed per minute (decayed sums, half-life 730 days, shrunk toward the league 1.94/min with 15
  minutes of prior) to the league rate.
- Scheduled length is log(scheduled minutes / 15).
- Elo difference is (Elo_att - Elo_def) / 400 x ln 10.
- The trailing KD level is log L(t) relative to its fit-period mean.
- Fighter effects enter as log u_d and log v_a (walk-forward).
- The direct model K5 uses the final KD model's covariate set.

| Model | Test log loss | vs K0 (SE) | vs K2 (SE) |
|---|---|---|---|
| K0 constant (test KO rate 16.4%) | 0.44676 | 0 | +27.2 (7.3) |
| K1 division + scheduled length | 0.44004 | -20.4 (6.7) | +6.8 (2.7) |
| K2 K1 + Elo difference | 0.43779 | -27.2 (7.3) | 0 |
| K3 K2 + trailing KD level | 0.43734 | -28.6 (7.4) | -1.4 (0.9) |
| K4 composite: log predicted KD rate (section 3 model) + exposure + scheduled length + Elo | 0.42075 | -78.9 (10.3) | -51.7 (9.6) |
| **K5 direct: K3 + exposure + age, KD history, KO losses, log u, log v** | **0.41515** | **-95.9 (12.5)** | **-68.7 (10.9)** |
| K6 K5 + weight move | 0.41517 | -95.8 (12.6) | -68.6 (10.9) |
| K7 K4 + KO-loss, KD and move terms | 0.42103 | -78.1 (11.5) | -50.9 (10.8) |

Totals are summed log-loss differences over test rows, clustered by fight. With the first version's covariate
set, K5 scored 0.41598.

K5 coefficients (pre-2024 fit; logit, SE):

| Term | Coef (SE) | Odds effect |
|---|---|---|
| Expected exposure | +1.12 (0.13) | |
| Scheduled length | +0.78 (0.16) | |
| Elo difference | +0.29 (0.08) | |
| Trailing level | +0.25 (0.10) | |
| Defender age, slope below 30 | +0.069 (0.015) | +7.1%/yr |
| Defender age, change past 30 | -0.008 (0.022) | slope past 30 about +6.3%/yr |
| Attacker age, below 30 / change past 30 | -0.031 (0.014) / -0.027 (0.021) | |
| Defender KO losses, last 365 days | +0.29 (0.08) | x1.34 |
| Defender KO losses, older | +0.124 (0.038) | x1.13 |
| Prior KDs absorbed, recent / older | -0.14 (0.06) / -0.061 (0.028) | |
| log v_a (attacker power) | +0.65 (0.08) | |
| log u_d (defender chin) | +0.77 (0.12) | |

Weight move (K6) is null again:

| Term | Coef (SE) |
|---|---|
| Defender moved up, per class | -0.22 (0.14) |
| Defender moved down, per class | +0.09 (0.10) |
| Attacker moved up, per class | +0.11 (0.12) |
| Attacker moved down, per class | -0.11 (0.11) |

Test calibration of K5 by predicted decile:

| Decile | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Predicted | 0.054 | 0.083 | 0.103 | 0.120 | 0.137 | 0.157 | 0.182 | 0.213 | 0.256 | 0.359 |
| Observed | 0.049 | 0.043 | 0.119 | 0.082 | 0.145 | 0.135 | 0.194 | 0.238 | 0.287 | 0.349 |

The live refit (2008 through the snapshot) is in `durability.json` `ko_loss_model_live`.

## 5. Fight-night heterogeneity (for `form.pow`, `form.chin`, `form.vol`)

A negative binomial fit with the model's mean fixed, on 2008-2023 rows, gives the extra-Poisson variance of the
per-fight knockdown rate (gamma variance v; lognormal sd = sqrt(ln(1 + v))). The share common to both directions
of a fight comes from cov(y_ab, y_ba) = mu_ab mu_ba v_shared.

| Means from | Total v (lognormal sd) | Shared v (SE) | Shared sd | Direction-specific sd | LR vs Poisson |
|---|---|---|---|---|---|
| Walk-forward fighter effects | 1.04 (0.84) | 0.269 (0.039) | 0.49 | 0.69 | 265 |
| Leave-one-out full-history fighter effects | 0.84 (0.78) | 0.255 (0.037) | 0.48 | 0.62 | 208 |

v3 has `form.vol` 0.60 (shared, v 0.43) and `form.pow` = `form.chin` = 0.45, which makes the direction-specific sd
0.64 (v 0.50). Its total v is 1.15, against 0.84-1.04 in the data, and nearly all the excess is in the shared
term.

Recommendation:

- `form.vol` 0.48.
- `form.pow` = `form.chin` 0.44-0.49. v3's 0.45 is inside that range.
- The engine's within-fight dynamics (`kdRepeat`, hurt, accumulated damage) also cluster knockdowns. So the cleaner
  target is to simulate the backtest and match the moments directly: per-direction extra-Poisson variance 0.8-1.0
  and shared variance 0.25-0.27, measured on simulated knockdown counts against the engine's own expected counts.
- These moments condition on realized exposure, so treat them as approximate.

## 6. The league knockdown level moves

Knockdowns per 1,000 landed standing head strikes:

| Period | Rate |
|---|---|
| 2016-2019H1 | 9.8-12.1 |
| 2019H2-2023 | 7.4-10.2 |
| 2024H1 | 7.45 |
| 2024H2 | 6.19 |
| 2025H1 | 8.39 |
| 2025H2 | 10.90 |
| 2026H1 | 10.44 |
| 2026H2 (to Oct 31) | 13.19 |

Around the UFC's 2024 glove trial (new gloves from UFC 302, June 1, 2024, until the old ones returned at UFC 309,
Nov 16, 2024, per press reports):

| Window | Fights | KD per 1,000 (95% CI) | KO/TKO share |
|---|---|---|---|
| 12 months before | 524 | 8.25 (7.18-9.44) | 31.3% |
| Glove trial | 249 | 5.95 (4.72-7.41) | 21.4% |
| 12 months after | 528 | 8.98 (7.86-10.22) | 31.8% |
| Nov 2025-Oct 2026 | 552 | 11.71 (10.42-13.11) | 39.4% |

Fight counts are bouts with exposure.

Our 2026 count is 191 KO/TKO of 480 bouts, or 193 with doctor stoppages, which matches AgentMMA's 193 of 480
through Oct 31. No source I found names a 2026 rule or equipment change, so the 2026 surge is unexplained.

The trailing 730-day level won the 2019-2023 tuning narrowly (4,339.1 against 4,342.6 for 365 days and 4,345.3 for
180). At the snapshot it is 0.01027, and the trailing 365-day level is 0.01171. Under F, 2025-26 still runs about
25% above prediction.

Recommendation:

- Keep 730 days as the default and expose the 365-day level as a labeled "current season" scenario.
- Whichever is used, put the level in the engine's `kdScale`; do not let it leak into the fighter multipliers.

## 7. Published claims, checked (docs/BACKLOG.md)

**1. "KD susceptibility +4.0% per year past 30 (SE 0.6%); knockdown power -3.6% per year past 30; p0 = 0.00844."**

- **Replicated.** The same specification on 2010-2026 (Poisson, offset log head strikes absorbed, defender and
  attacker years past 30) gives +0.0400 (SE 0.0056), -0.0370 (SE 0.0069) and baseline 0.00851. With standing head
  strikes it gives +0.0419 / -0.0412, and on 2008-2023 +0.0411 / -0.0335.
- **Richer model, chin.** The size holds past 30 (+6.0%/yr, SE 0.9%, pre-2024; +6.2% live) but the shape is
  wrong: susceptibility also rises +6.1%/yr before 30 (SE 1.4%), with no knee (the hinge is -0.002, SE 0.019).
  On held-out data the spline beats the past-30 form by 11.4 (SE 5.6).
  - Recommendation: age chin linearly through all ages (about 0.06/yr), not from 30, and not from 34 as v3 does.
- **Richer model, power.** -3.6%/yr past 30 (SE 0.9%; live -4.0%), flat before 30. That is the published value.
- **Within-fighter check.** Conditional Poisson with fighter fixed effects, 1,261 fighters with at least one
  knockdown absorbed:
  - Age-only spec: +16%/yr before 30 and +11%/yr after (cluster SEs 2.5 and 3.2 points).
  - Dropping each fighter's final UFC fight: +15%/yr and +9%/yr.
  - Adding career head strikes absorbed: age +3.7%/yr before 30 and -2.2%/yr after; head strikes absorbed +0.287
    per 100 (SE 0.055).

  Within a career, susceptibility tracks accumulated head strikes more than birthdays. These within-fighter slopes
  are larger than the predictive ones but biased upward: careers end after KOs, which piles knockdowns into late
  career. They are an upper bound. The predictive model, validated on held-out fights, is the one to use, and
  career head strikes absorbed do not predict across fighters (the block was removed on validation).

**2. "Moving up one class: no measurable penalty after an Elo control (+0.03 log-odds, SE 0.10, n = 383); KD
absorbed per head strike unchanged (ratio 1.02)."**

- **Confirmed with more data and controls.**
  - Win logistic with Elo: +0.060 (SE 0.055) per class moved up, n = 7,982 fights.
  - One class apart only: +0.076 (SE 0.059), n = 1,229.
  - With age and KO-loss controls: +0.031 (SE 0.057).
  - Per 10 lb: +0.044 (SE 0.028).
- **Knockdowns absorbed per standing head strike, final model + move terms:**

  | Term | Pre-2024 | Live |
  |---|---|---|
  | Defender moved up, per class | x0.91 (SE 0.13) | x0.85 (SE 0.11) |
  | Defender moved down, per class | x1.07 (SE 0.09) | x1.09 (SE 0.08) |
  | Attacker moved up, per class | x1.25 (SE 0.10) | x1.21 (SE 0.09) |
  | Attacker moved down, per class | x0.92 (SE 0.10) | x0.92 (SE 0.09) |

  In pounds (pre-2024): defender -0.2%/lb (SE 0.6%), attacker +1.25%/lb (SE 0.5%).
- **Held-out:** move terms add +0.3 deviance (SE 3.0) on 2024+ and +16 (SE 8.5) on 2019-2023 in the KD model, and
  +0.1 log loss in the KO model. They are dropped.
- **The pattern is selection, not physics.** Fighters move up when they are dominant punchers and move down after
  being hurt. A mechanistic size tax is not supported by the KD data. Keep the size knob, but default it to 0 and
  label any non-zero value a judgment call. The market-implied size view in `research/matchup_market.md` (elite
  FW champions at LW went 4-8) is not a knockdown effect in this data.

**3. Other BACKLOG numbers touched here.**

- **"KD per landed standing head strike 0.0095":** 2019+ average 0.00888, since Nov 2024 0.01027, LW since Nov
  2024 0.01098.
- **"5-round 0.0078, title 0.0070":** after fighter effects these shrink to x0.895 (SE 0.08) for five rounds and
  x0.908 (SE 0.12) for a title fight. Most of the raw gap is who fights in them.

## 8. Roster multipliers, and Volkanovski and Gaethje

`durability.json` `roster` has every fighter in `fighters.json` (1,229), as of Oct 31, 2026:

| Field | Meaning |
|---|---|
| `chin_re`, `pow_re` | Gamma posterior means of u and v |
| `chin_re_q`, `pow_re_q` | 5/50/95% quantiles |
| `chin_re_shape_rate`, `pow_re_shape_rate` | Gamma shape and rate |
| `chin_cov`, `pow_cov` | Covariate multipliers vs the reference profile (see below) |
| `chin_total_q`, `pow_total_q` | Totals with 90% intervals, drawing coefficients (clustered covariance) and fighter effects |
| `kd_absorbed`, `kd_absorbed_expected` | Knockdowns absorbed vs the model's expectation |
| `kd_scored`, `kd_scored_expected` | Knockdowns scored vs the model's expectation |

The reference profile is a 30-year-old with no knockdowns absorbed and no KO losses. For that profile the
covariate terms are exactly 0 (`engine.ref_lin` = 0). Chin multipliers above 1 mean easier to drop.

**Volkanovski and Gaethje (live fit, as of Oct 31, 2026):**

| | Volkanovski | Gaethje |
|---|---|---|
| Age; UFC fights; years in UFC | 38.1; 19; 9.9 | 38.0; 16; 9.3 |
| KD absorbed vs expected | 4 vs 5.97 | 4 vs 9.06 |
| KD absorbed in the last year | 0 | 1 (Topuria, Jun 2026, body shots per reports) |
| KO/TKO losses (last year / older) | 0 / 2 | 0 / 3 |
| Chin effect u (90% interval) | 0.78 (0.37-1.32) | 0.58 (0.27-0.98) |
| Chin covariates (age, KD history, KO losses) | x1.37 | x1.38 |
| **Chin total (90% interval)** | **1.07 (0.49-1.84)** | **0.81 (0.38-1.37)** |
| KD scored vs expected | 6 vs 5.79 | 9 vs 6.00 |
| Power effect v (90% interval) | 1.02 (0.52-1.66) | 1.35 (0.77-2.07) |
| Power covariates (age) | x0.72 | x0.73 |
| **Power total (90% interval)** | **0.73 (0.38-1.18)** | **0.99 (0.56-1.53)** |

Neither man has a weak chin for his history. Both have absorbed fewer knockdowns than a model of their opponents
and exposure expects, Gaethje markedly so (4 against 9). But age pushes both totals back toward or above the
reference. Gaethje's power residual (9 knockdowns against 6.0 expected) is the clearest fighter-specific signal of
the four.

**KD probability per landed standing head strike in a 5-round, non-title lightweight fight** (90% intervals from
the fighter-effect posteriors):

| Direction | Trailing 730-day level | Trailing 365-day level |
|---|---|---|
| Volkanovski drops Gaethje | 0.59 per 100 (0.21-1.19) | 0.67 per 100 (0.24-1.36) |
| Gaethje drops Volkanovski | 1.04 per 100 (0.40-1.99) | 1.19 per 100 (0.45-2.26) |

- A title fight multiplies both by 0.908.
- The two-fighter reference pair in this setting would be 0.99 per 100 at the 730-day level.
- These intervals cover only the fighter effects; coefficient uncertainty is small by comparison. The roster
  `chin_total_q` and `pow_total_q` include both.

**Per-fight KO/TKO loss** (K5 refit on all data; 90% intervals cover coefficients only):

| | Trailing 730-day level | Trailing 365-day level |
|---|---|---|
| P(Gaethje loses by KO/TKO) | 25.1% (21.2-29.3) | 25.8% (21.7-30.3) |
| P(Volkanovski loses by KO/TKO) | 24.4% (21.0-28.1) | 25.1% (21.5-28.9) |

The per-strike rates favor Gaethje's power, while the per-fight risks are close. Volkanovski's higher landing rate
and his Elo edge (about 65 points) offset it. The v5 engine run for this matchup should land near these per-fight
numbers. The first version had 21.6% and 22.9%; the revised covariate set prices both men's KO-loss histories and
ages slightly higher.

**Active roster extremes** (8+ UFC fights, fought in 2025-26; posterior mean and 90% interval):

| Group | Fighter | KD absorbed / expected | u | KD scored / expected | v |
|---|---|---|---|---|---|
| Weakest chin | Steve Garcia | 6 / 0.7 | 2.40 (1.25-3.86) | 8 / 1.0 | 3.03 (1.67-4.72) |
| | Chase Hooper | 6 / 0.8 | 2.36 (1.23-3.78) | | |
| | Kyle Daukaus | 6 / 0.9 | 2.30 (1.20-3.68) | | |
| | Terrance McKinney | 5 / 0.5 | 2.27 (1.13-3.74) | | |
| Best chin | Marvin Vettori | 0 / 9.8 | 0.23 (0.06-0.49) | | |
| | Tim Elliott | 0 / 9.4 | 0.24 (0.07-0.51) | | |
| | Calvin Kattar | 1 / 12.2 | 0.26 (0.09-0.51) | | |
| | Marlon Vera | 1 / 10.6 | 0.29 (0.10-0.57) | | |
| Most power | Carlos Prates | | | 12 / 1.4 | 3.71 (2.26-5.44) |
| | Uros Medic | | | 9 / 0.9 | 3.36 (1.91-5.13) |
| | Montel Jackson | | | 14 / 2.6 | 3.22 (2.03-4.62) |
| | Deiveson Figueiredo | | | 12 / 2.2 | 3.05 (1.86-4.48) |

## 9. Engine recommendation (v5)

Replace v3's power and chin block (`fighterRates` R.pow / R.chin and the `fac` factors in `matchup`) with the
following. Knockdown probability per landed standing head strike by a on d:

```
p_ad = kd0_div * kdScale * ctx * C_d * P_a / NORM

ctx  = exp(-0.111 * five_round  - 0.096 * title)                  (live fit)
C_d  = exp(f_d) * u_d               chin  (exponent 1: validation slope 0.98 +- 0.10)
P_a  = exp(g_a) * v_a               power (exponent 1: validated 0.80 +- 0.08 is worth only -2.3 +- 4 on 2024+)

f_d =  0.0618 * (age - 30) - 0.0016 * max(0, age - 30) + 0.799 * [age unknown]
     - 0.1425 * KDabs_365d - 0.0800 * KDabs_older
     + 0.1891 * KOL_365d   + 0.0749 * KOL_older
g_a = -0.0044 * (age - 30) - 0.0359 * max(0, age - 30)

u_d = (3.0 + KD absorbed) / (3.0 + expected KD absorbed)     over all earlier UFC fights, no time decay
v_a = (2.5 + KD scored)   / (2.5 + expected KD scored)
```

- **Inputs.**
  - `KOL` = KO/TKO losses by strikes or corner (not doctor). `KDabs` = knockdowns absorbed.
  - The 365-day windows count fights in the 365 days before the fight date. Ages are at the fight date.
  - The "expected" sums come from this model fight by fight: E x L x exp(const + division + ctx + f + g) x the
    opponent's effect as of then.
  - There are no layoff, last-fight, tenure, experience or weight-move terms.
- **Where to read them.**
  - Live roster: read `chin_re`, `pow_re` and the shape/rate pairs from `durability.json` `roster`.
  - Backtest: `durability.json` `backtest[fight_id]` gives side `chin_re`, `chin_cov`, `pow_re`, `pow_cov`, plus
    `p[side]`, the model's knockdown probability per standing head strike landed by that side.
  - The backtest values are strict walk-forward: an entry in year Y <= 2023 uses coefficients fit on 2008..Y-1
    only (`fit_through` says which), and 2024+ entries use the 2008-2023 fit.
- **NORM.**
  - For live use, NORM = norm_chin x norm_pow = 0.9972 x 0.9752. These are the 2024+ exposure-weighted means of
    C_d and P_a (`engine.norm_chin`, `engine.norm_pow`).
  - For the 2019-2023 tuning backtest, use 0.9882 x 1.0183 (`engine.norm_chin_backtest_2019_2023`,
    `engine.norm_pow_backtest_2019_2023`, from the strict refits), so no 2024+ data enters the tuning-period
    engine.
  - Either way, NORM keeps the division average where `kd0` and `kdScale` put it.
- **Absolute form.** Alternatively use p_ad = L x exp(terms_live const + division + ctx) x C_d x P_a directly,
  with L = `engine.level_now_trailing_730` (0.01027) or `_365` (0.01171). The reference offset `engine.ref_lin`
  is 0.

Mapping to `src/params3.js`:

| v3 parameter | v3 value | v5 recommendation |
|---|---|---|
| `kKD` (shared shrinkage, all head strikes, decayed S) | 230 | Gamma EB on career sums with no decay: alpha 3 for chin and 2.5 for power. That is about 290 and 245 standing head strikes at today's level, with opponent-adjusted expectations instead of raw head strikes |
| `chinAge0` / `chinAge` | 34 / 0.04 | Linear through all ages: 0.062/yr (hinge -0.002), no tenure term |
| `powAge` (from 34) | 0.03 | 0.040/yr past 30 (0.004 before) |
| `chinKO`, `chinKOcap` | 0.04, 1.15 | Split by recency: x1.21 per KO loss in the past 365 days, x1.08 per older one, no cap. Add the prior-KD covariates (x0.867 per KD absorbed in the past 365 days, x0.923 per older one), which temper u_d's reaction |
| Layoff / last-fight-KO / quick-return terms | none | None. The first version's x0.64 (2+ years), x1.16 and x0.79 do not predict |
| `sizeChin` / `sizePow` | 0.05 / 0.03 | 0 / 0 by default (data: defender x0.85-0.91 per class up, the wrong sign for a tax; held-out gain nil). Keep as labeled knobs |
| `combA` / `combB` for KD only | 1 / 1 | 1 / 1 (the first version's chin exponent of 1.15 is withdrawn) |
| `kdScale` / level | 1.232 x division prior | Track the trailing league level: 0.01027 (730 days) default, 0.01171 (365 days) as a scenario |
| `form.vol`, `form.pow`, `form.chin` | 0.60, 0.45, 0.45 | 0.48, 0.44-0.49, 0.44-0.49, or match the moments in section 5 by simulation |
| Five-round / title | none | x0.895 / x0.908 |
| Division multipliers vs LW (live) | | FLY 1.17, BW 1.12, FW 1.09, WW 1.09, MW 1.21, LHW 1.40, HW 1.15; women 0.33-0.35 (WFW 0.57, n small) |

**v5 acceptance checks** (ROADMAP: KD-absorbed calibration by age band and weight move): the tables in section 2
give the targets.

- An engine using this block should reproduce flat O/E across defender age bands (F: 1.01-1.21, after the level)
  and across prior-KO-loss bands (1.07-1.15).
- Weight-move bands should be left alone: up 0.70, down 1.58 on small counts.
- On the 2019-2023 backtest, compare against the strict-refit `p` values, not against a 2008-2023 fit.

## 10. Caveats

- **Exposure is estimated.** ufcstats gives no head-by-position split, so standing head strikes are the midpoint
  of bounds. Knockdowns from body shots (rare; Topuria's on Gaethje is one) are charged to head-strike exposure.
- **The per-strike hazard conditions on realized exposure.** A knockdown can end a fight and cut exposure. The
  Poisson-process likelihood stays valid under that kind of stopping, but the per-fight KO model (section 4) is
  the pre-fight check.
- **The test period runs about 9% hot** (2025-26 knockdown surge, cause unknown). All models share the level
  offset. A model that predicts more knockdowns overall gains from it, which is why section 2 also reports the
  level-neutral comparison. Absolute predictions for late 2026 depend on which level window you believe.
- **Selection is everywhere.** It shows in who moves up, who returns fast after a KO, who keeps getting fights
  after absorbing damage, and who fights for titles. The coefficients are predictive associations, validated out
  of sample, not causal effects. The within-fighter estimates are upper bounds.
- **Fighter effects are noisy.** A fighter with 10 fights has roughly 3-6 expected knockdowns of evidence, so 90%
  intervals on u and v span about a factor of 3-4. Volkanovski's and Gaethje's intervals both include 1, except
  Gaethje's chin effect u (0.27-0.98).
- **Pre-UFC careers are invisible.** Debutants start at the prior, and the data shows they are under-predicted on
  both sides in 2024+.
- **Volkanovski's last two fights** (Jan 31 and Oct 24, 2026) and Gaethje's 2026 fights are in the snapshot. The
  roster numbers include them.

Sources:

- Data: `data/raw/*.csv` (ufcstats.com via Greco1899/scrape_ufc_stats).
- Glove dates and the 2026 KO count are from press summaries returned by a web search on Nov 6, 2026. The pages
  themselves could not be opened from this environment (their hosts are not on the allowed network list). Our
  own dated data confirms the knockdown dip inside that window.
  - [SI: UFC knockouts down 30% since major glove redesign](https://www.si.com/fannation/mma/news/ufc-knockouts-down-30-percent-since-major-glove-redesign)
  - [ESPN: how fighter frustrations brought back old UFC gloves](https://www.espn.com.au/mma/story/_/id/42533757/how-fighter-frustrations-brought-back-old-ufc-gloves)
  - [AgentMMA: did the UFC's new gloves reduce knockouts](https://agentmma.com/mma-lab/ufc-new-gloves-knockout-rate)
  - [AgentMMA: UFC knockouts 2026](https://agentmma.com/mma-lab/ufc-knockouts-2026)

## Verification log

Adversarial review, Nov 6, 2026. The working assumption was that the analysis is wrong until shown otherwise.
Every number below was produced by code in the repository: `tools/durability.py` (fixed and rerun) or
`tools/durability_verify.py` (fresh code). Scratch ablations were run against the same table. The first version's
JSON is not kept in the repository; its numbers are quoted from the first version of this report.

### V1. Headline re-run with fresh code

`tools/durability_verify.py` does not import `durability.py` or `build_db.py`. It does the following
independently:

- Parses `data/raw/*.csv` directly and dedupes by fight URL.
- Identifies fighters by their ufcstats name, with no people resolution.
- Recomputes every feature, the trailing level and the walk-forward Gamma effects.
- Fits the Poisson models with statsmodels.

Held-out 2024+ deviance differences (SE clustered by fight / on fighters):

| Comparison | First version (`durability.py`) | Fresh code | Level-neutral, fresh code |
|---|---|---|---|
| Analyst's model vs constant chin (M0L) | -219.8 (32.3) | -214.5 (32.4 / 39.0) | -205.4 (38.4) |
| Analyst's model vs V3 | -52.2 (18.5) | -46.0 (18.7 / 19.3) | -10.7 (15.5) |
| Analyst's model vs fighter effects only (E3) | -17.2 (15.1) | -10.4 (15.2 / 15.2) | +2.3 (14.2) |
| Analyst's model vs covariates only (M3) | -89.6 (22.2) | -86.1 (22.4 / 29.3) | -68.2 (26.3) |
| **Revised model vs constant chin** | | -231.7 (33.1 / 39.9) | -223.5 (39.4) |
| **Revised model vs V3** | | -63.2 (18.3 / 19.4) | -28.8 (16.2) |
| **Revised model vs E3** | | -27.7 (13.4 / 13.5) | -15.8 (12.9) |
| **Revised model vs analyst's model** | | -17.2 (7.6 / 7.6) | -18.1 (7.4) |

**Verdict on the headline.** The gain over a constant-chin model is real and replicates within about 5 units in
independent code. Two of the first version's secondary claims did not hold up:

- **"Beats v3 by 52 (SE 19)."** Most of this was calibration-in-the-large in a hot test period. V3 predicts 537
  knockdowns and the analyst's model 629, against 681 observed. Level-neutral, it was 17 (SE 16) in the tool and
  11 (SE 16) in fresh code: not significant.
- **"Age, damage and layoff add 17 on top of fighter effects (SE 15)."** Level-neutral this is 6 (SE 14) in the
  tool and -2 (SE 14) in fresh code. The first version's covariate block added nothing out of sample on top of the
  fighter effects.

After the fixes, both comparisons are positive in level-neutral terms. They are about 2.4 and 2.2 SEs in the
tool, and 1.8 and 1.2 SEs in fresh code.

### V2. Look-ahead leakage

Checks that passed:

- **Feature freezing.** `d_n_prior` equals the count of earlier fights for every fighter sampled. Both directions
  of a fight are predicted before either updates the state. Elo is stored pre-fight (`build_db.run_elo`).
- **Trailing level.** Brute-force recomputation at random days (strictly earlier days, 730-day window) matches
  `trailing_level` exactly for every post-2008 day checked. The one mismatch is a 2000 date, where the window
  widens for lack of knockdowns, and pre-2008 rows are not used.
- **Tuning windows.** The first version fit on 2008-2018 and validated on 2019-2023; nothing was tuned on 2024+.
- **Walk-forward EB on the test set.** It uses 2024+ fights before the target fight, with 2008-2023 coefficients.
  That is legitimate walk-forward.

Failures, all fixed:

1. **Backtest multipliers were in-sample for 2019-2023.** `backtest[...]` used coefficients fit on 2008-2023 for
   every entry. Those coefficients include the outcomes of the 2019-2023 fights the backtest (and the engine's
   tuning) are scored on.
   - On 2019-2023 the in-sample coefficients score 4,274.1 deviance, against 4,325.3 for strict expanding-window
     refits: they flattered the tuning period by **51 deviance units (SE 8.7)**.
   - Fixed: entries in year Y <= 2023 now use a fit on 2008..Y-1, with a `fit_through` field on each entry.
     `verification.backtest_insample_vs_strict_2019_2023` records the comparison.
2. **The engine NORM was computed on 2024+ with the live fit.** That is fine for live use but leaks test-period
   data into a backtest normalization. Added `engine.norm_chin_backtest_2019_2023` and `norm_pow_backtest_2019_2023`
   (strict refits).
3. **Height and reach division means used all years, including 2024+.** This affected only the body block (not
   adopted), but it contaminated the reported 2024+ gain for that block. Fixed: the means come from pre-2024 rows.

### V3. Joins

All of these checks passed:

- **Fighter order.** Round stats map to bout names (`f.names`). A won 56% of 2019+ fights, so ufcstats order is
  not winner-first and the win logit is well posed. Backtest sides match 3,237 of 3,237 entries. Pre-fight KO
  losses and knockdowns absorbed match `backtest.json`'s own `ko_losses` and `kd_absorbed` with 0 mismatches.
- **Methods.** `KO/TKO` -> KO, including corner stoppages; doctor stoppages (`DOC`, 100 fights) are excluded from
  KO losses as documented. NCs and draws have no KO loser. Judges' cards (loser-first) are not used here.
- **Knockdown totals.** The table holds 3,886 knockdowns against 3,899 in the raw round rows. The 13 missing are in
  bouts with ambiguous (event, bout) keys. No ambiguous-person rows reach the fit.
- **Spot check.** Raw data shows Topuria vs Gaethje (Jun 14, 2026) as "L/W", a Gaethje win by corner stoppage
  after round 4 despite a Topuria knockdown. This was confirmed against the sources in `research/gaethje.md`. So
  Gaethje's 3 KO losses and 4 knockdowns absorbed are right.

### V4. Overfitting: which blocks survive

Cost of dropping each block from the first version's model. The validation column is the decision window; the test
column is shown for information only and was not used to choose.

| Block (params) | 2019-2023 (fit 2008-2018) | 2024+ (fit 2008-2023) | Decision (one-SE, validation only) |
|---|---|---|---|
| Defender age spline (3) | +19.7 (9.6) | +24.8 (8.4) | keep |
| Prior KDs absorbed (2) | +20.5 (8.3) | (in "damage" below) | keep |
| KO losses recent / older (2) | +3.3 (1.8) | (in "damage") | keep |
| Tenure, ln fights, head absorbed, debut (4) | -2.5 (7.3) | (in "damage") | drop |
| Damage block as a whole (8) | +16.5 (9.7) | -7.8 (7.2) | |
| Layoff dummies (3) | +5.9 (6.5) | (in "layoff" below) | drop |
| Last-fight KO and quick-return (2) | -0.0 (4.8) | (in "layoff") | drop |
| Layoff block as a whole (5) | +5.5 (8.3) | -8.3 (6.1) | |
| Attacker experience (3) | +1.1 (2.5) | -1.2 (2.8) | drop |
| Attacker age spline (2) | +2.4 (3.4); +10.4 (4.9) once attacker experience is out | +0.3 (2.8) | keep (sequential step) |

The sequential elimination (`tuning_diagnostics.elimination`) dropped, in order: tenure/experience, attacker
experience, last-fight KO, layoff. It stopped at {prior KDs, KO losses, attacker age}, with each remaining block
over 2 SEs.

The decay half-lives use the same one-SE preference for the simpler option. The unconstrained grid had picked an
8-year power half-life on a 1.7-unit gain. Alpha_power moved from 3.0 to 2.5 (a 0.4-unit gain), which is harmless.

**Result.** The first version had the lower training deviance (10,975 against 11,016), but the revised model wins
on 2024+ by 19.0 (SE 7.5); see V1 for the full comparison.

### V5. Uncertainty

- **Fight clustering understates the SEs of model comparisons** that involve fighter effects, by up to 25%. The
  same fighter's effect is shared across his test fights: for F vs M0L the SE is 32.9 clustered by fight and 39.5
  clustered on fighters. Both are now reported (`se_fighter`). The function treats each directed row as a member
  of both fighters' clusters, counting rows that share both fighters once.
- **Level-neutral comparisons** (half-year rescaling) are now in `ladder_test` and `pairwise_test` as a diagnostic.
- **Coefficient SEs** cluster by defender and treat the walk-forward offsets as fixed. Roster intervals treat the
  expected-knockdown sums as known. Both are second-order relative to the fighter-effect posteriors, which dominate
  the intervals.

### V6. Claims corrected

- **Chin exponent 1.15, "2024+ gain 5.3 (SE 2.8)".** This was not produced by the code. Recomputed for the first
  version's model it is -7.2 (SE 3.0) in fresh code, with validation slope 1.16. With the revised covariates the
  validation slope is 0.98 (SE 0.10), so the exponent is withdrawn and the engine uses 1.0. The tool now computes
  this (`verification.chin_exponent`).
- **"Fighter-to-fighter differences in power are larger and more predictable than in chin"** (analyst summary).
  This is contradicted by the ladder: chin alone (E1) is worth 135 deviance units against 120 for power alone
  (E2). The validation calibration slopes also say power effects are slightly over-dispersed (0.80), not
  under-used.
- **UFC tenure +2.9%/yr, layoff x0.64, quick return after a KO x0.82, "x1.82 from 30 to 38".** These are
  in-sample associations that do not predict; the age-only figure is x1.62. Removed from the engine
  recommendation.
- **Body block "+1.4 on 2019-2023".** It is actually -2.7 (SE 10.3). It is still within one SE, so the decision
  not to adopt it stands.
- **Section 6 level-window deviances** were misquoted as 4,343.1 / 4,346.3 / 4,349.2. The grid gives 4,339.1 /
  4,342.6 / 4,345.3.
- **"Nov 2025-Oct 2026: 11.87 per 1,000, 520 fights, 40.0% KO."** The data gives 11.71 (10.42-13.11), 552 bouts
  with exposure and 39.4%, which is consistent with the 365-day level 0.011706.
- **The glove-trial rates** (5.95, 8.25, 8.98) and the 2026 KO count (191 + 2 doctor of 480) replicate exactly.

### V7. Open items (not fitted, because they would need the test period)

- **Chin on 2024+.** The chin calibration slope on 2024+ is 1.32 (SE 0.13), against 0.98 on 2019-2023. The test
  period's weak chins were dropped even more than the model says, possibly a level x chin interaction in a hot
  league. Recheck in v9 with 2026 as validation once 2027 data exist.
- **Debutants** are under-predicted on both sides (O/E 1.34 and 1.59 against 1.07 at home). Pre-UFC priors
  (`data/derived/preufc.json`) should be tested as the u/v prior mean.
- **The level surge** (2025H2-2026: 10.4-13.2 per 1,000) is unexplained. A faster level window (365 days) won
  nothing on 2019-2023 but would have tracked 2025-26 better.

### Files changed

- `tools/durability.py`:
  - Optional covariate blocks and a backward one-SE elimination in `tune()`.
  - One-SE preference for no decay.
  - The first version kept as the `F36`/`M36` comparison rows.
  - Fighter-clustered SEs and level-neutral columns.
  - Strict walk-forward `backtest`.
  - Backtest NORMs.
  - Chin-exponent check.
  - Pre-2024 body-term centring.
  - `DEFAULT_SPEC` set to the tuned spec.
- `tools/durability_verify.py` (new): independent re-implementation; output in
  `data/derived/durability_verify.json`.
- `data/derived/durability.json`: regenerated (built 2026-11-06T10:57Z, spec in `meta.spec`).
- `research/model_durability.md`: this report, revised in place, plus this log.
