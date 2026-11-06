# Durability and power: knockdown chin and power model (engine v5 component)

Tool: `tools/durability.py` (run `python3 tools/durability.py`, about 5 minutes; `--quick` skips the tuning grid
and reuses the tuned spec). Output: `data/derived/durability.json`. Data: ufcstats snapshot through Oct 31, 2026
(`data/raw/`), parsed with `tools/build_db.py`'s own loaders, people resolution and Elo (K 44, boost 1.5).
Built Nov 6, 2026.

## Summary

- **The fitted model beats the constant-chin model by 220 deviance units on held-out 2024+ fights** (2,905
  attacker-defender rows, 681 knockdowns; SE 32, clustered by fight). That is 7.9% of the deviance. It also beats
  the v3 engine's hand-set chin/power structure by 52 (SE 19) and a covariates-only model by 90 (SE 22).
- **Fighter effects carry most of the signal.** Walk-forward empirical-Bayes chin and power multipliers
  (Gamma(3, 3) priors, worth about 290 standing head strikes each) are worth 203 deviance units on their own.
  Age, damage history and layoff add another 17 on top (SE 15).
- **Age (published claim, "+4%/yr past 30").** It replicates exactly (+0.0400, SE 0.0056). The richer model keeps the
  size but not the shape: susceptibility rises **+5.0%/yr past 30 (SE 0.9%) and +5.7%/yr before 30 (SE 1.4%)**.
  There is no knee at 30, and the hinge term is -0.007 (SE 0.019). On top of that, each year in the UFC adds
  **+2.9% (SE 1.5%)**. The spline beats the claim's past-30 form on held-out data by 11 (SE 6).
- **Power aging.** Past 30, power falls **-2.6%/yr (SE 1.0%)** holding UFC tenure fixed, plus **-2.4% per UFC
  year (SE 1.7%)**. That makes about -5%/yr for an active fighter. It is flat before 30. Without the tenure term,
  the published -3.6%/yr replicates.
- **Size tax (published claim, "none after Elo control"): confirmed and extended.** Moving up a class costs
  nothing in win probability: +0.06 log-odds (SE 0.055) per class, n = 7,982. Knockdowns absorbed per head
  strike are **×0.89 (SE 0.13) per class up for the defender**, which is the opposite of a tax. KO/TKO-loss odds
  are ×0.81 (SE 0.14) per class up. Weight-move terms add nothing on held-out data (-1.2, SE 3.2). The attacker
  moving up does score more knockdowns (×1.26 per class, SE 0.10), but that is selection: punchers move up.
- **Recent KO losses matter more than old ones.** Each KO/TKO loss in the past year multiplies knockdown
  susceptibility by ×1.20 (SE 0.10). Each older one multiplies it by ×1.06 (SE 0.03). This is on top of the
  fighter's knockdown history. In the per-fight KO-loss model, odds rise ×1.30 (SE 0.11) per recent KO loss and
  ×1.12 per older one.
- **Damage measured as head strikes absorbed shows no predictive wear** (-1.1% per 100, SE 2.6%). Durable fighters
  absorb more, which hides the effect between fighters. Within a fighter it is large (+33% per 100 sig head
  strikes absorbed, SE 7%), but that estimate is biased upward by careers that end on a KO. Treat it as an upper
  bound.
- **Fight-night heterogeneity.** Per-fight knockdown rates vary beyond the model with a lognormal sd of
  0.77-0.83. About a quarter to a third of the variance is shared by both men (sd 0.47-0.48). The v3 engine's shared
  `form.vol` 0.60 is too high, and its direction-specific power x chin sd (0.64) is about right.
- **The league knockdown level moves a lot, and the engine should track it.** Knockdowns per 1,000 standing head
  strikes were 5.95 during the UFC's 2024 glove trial (UFC 302 to UFC 309), against 8.25 before and 8.98 after.
  The 2026 rate is 11.6, and 40% of 2026 fights ended by KO/TKO. The level at the snapshot is 10.27 per 1,000 over
  the trailing 730 days and 11.71 over the trailing 365.
- **KO/TKO loss per fight** (logistic, pre-fight features only): held-out log loss 0.4160, against 0.4378 for
  Elo + division. The improvement is 66 log-loss units (SE 11). Deciles are calibrated within a few points.
- **Volkanovski vs Gaethje** (155 lb, 5 rounds, 730-day level): Gaethje drops Volkanovski 1.04 times per 100
  landed standing head strikes (90%: 0.40-1.97). Volkanovski drops Gaethje 0.58 times (0.21-1.16), so Gaethje's
  rate is 1.8 times higher. Per fight, P(KO/TKO loss) is 21.6% for Volkanovski (18.1-25.8) and 22.9% for Gaethje
  (18.5-28.4).

## 1. Data and walk-forward features

One row per attacker -> defender direction of every UFC fight with round stats: 17,948 rows from 8,974 fights.
The fit uses 2008-2023 (12,591 rows with exposure). The test set is 2024-01-01 to 2026-10-31 (2,905 rows, 1,503
fights, 681 knockdowns), and none of it is used for fitting or tuning.

- **Outcome:** knockdowns scored by the attacker in the fight (ufcstats KD).
- **Exposure E:** standing head strikes landed by the attacker. ufcstats has no head-by-position cross-tab, so E
  is the midpoint of max(HEAD - GROUND, 0) and min(HEAD, DISTANCE + CLINCH), the same convention as
  `tools/baserates.py`. Standing head strikes are 90% of head strikes landed since 2019. Rows with E = 0 (1,097
  rows, 1 knockdown) are dropped.
- **Features are frozen before each fight.** They come only from earlier UFC fights. Fights are processed in
  date and bout order, and both directions of a fight are predicted before either is used to update.
  - Defender: age (linear spline, knot at 30, plus a missing-age flag); years since UFC debut;
    ln(1 + UFC fights); career sig head strikes absorbed / 100; knockdowns absorbed in the last 365 days and
    before that; KO/TKO losses (strikes or corner, doctor stoppages excluded) in the last 365 days and before
    that; UFC debut flag; layoff (< 120 days, 365-730, 730+, against a 120-365 reference); last fight a KO/TKO
    loss; last fight a KO/TKO loss and back within 180 days.
  - Attacker: age spline, years in the UFC, ln(1 + UFC fights), debut flag.
  - Tested and not kept: weight move (classes or pounds, up and down, both men); height and ape index relative
    to the division; reach and height advantage.
  - Context: division (Lightweight reference), five-round, title.
  - Home division is the most frequent real division over the 3 years before the fight
    (`build_db.mode_recent`). Weight move is fight division minus home, in classes (sexes kept apart) or pounds.
    Catch and open weight bouts get move 0 with a flag.
- **League level L(t):** knockdowns per standing head strike over the 730 days before the fight, from all rows.
  It is walk-forward and enters as an offset.
- **Fighter effects:** chin u_d and power v_a are Gamma(alpha, alpha) multipliers. Their walk-forward posterior
  means are `u = (alpha + KD absorbed) / (alpha + expected KD absorbed)` over the fighter's earlier fights.
  "Expected" is the rest of the model times the opponent's power effect as of then; power is the mirror image.
  No time decay: half-lives of 5 and 8 years were tested and lost.
- **Fitting:** a Poisson GLM with offsets log E + log L + log u + log v (Newton). It iterates fit -> walk -> fit
  four times. SEs are model-based plus a sandwich clustered by defender.
- **Tuning:** a staged grid scored by Poisson deviance on 2019-2023 with the model fit on 2008-2018. It covers
  the level window (180/365/730 days), age knots, the recent-history window (365/730/1095), alpha for chin and
  power (2-10), the damage block variant, attacker experience terms and decay. The chosen spec is level 730,
  knot 30, window 365, alpha_chin = alpha_power = 3, full damage block, attacker experience on, no decay
  (2019-2023 deviance 4,339.1). The grid is in `durability.json` `tuning_grid`. Coefficients are then refit on
  2008-2023 and scored on 2024+. A final live fit on 2008 through the snapshot gives the roster numbers.

## 2. Held-out results (fit 2008-2023, scored on 2024+)

Poisson deviance on 2,905 rows (lower is better). Differences are summed over fights, with fight-clustered SEs.

| Model | Params | Test deviance | vs M0L (SE) | KD obs / exp |
|---|---|---|---|---|
| M0 constant KD per standing head strike | 1 | 2782.3 | +7.9 (18.2) | 681 / 790 |
| M0L constant + trailing league level ("constant chin") | 1 | 2774.5 | 0 | 681 / 596 |
| M1 + division, 5-round, title | 15 | 2714.9 | -59.6 (18.2) | 681 / 578 |
| C30 M1 + years past 30, defender and attacker (claim form) | 17 | 2686.2 | -88.2 (20.4) | 681 / 590 |
| M2 M1 + age splines | 20 | 2674.8 | -99.6 (20.9) | 681 / 597 |
| M3 M2 + damage history, layoff, attacker experience | 36 | 2644.3 | -130.2 (24.8) | 681 / 559 |
| V3 engine v3 structure (shrunk decayed ratios k = 230, chin age past 34, 1.04^KO capped 1.15, size) | 13 | 2606.8 | -167.6 (26.3) | 681 / 537 |
| E1 M1 + fighter chin effect | 15 | 2639.4 | -135.1 (24.6) | 681 / 575 |
| E2 M1 + fighter power effect | 15 | 2652.2 | -122.2 (26.1) | 681 / 603 |
| E3 M1 + chin and power effects | 15 | 2571.9 | -202.6 (30.2) | 681 / 593 |
| **F final: M3 + chin and power effects** | 36 | **2554.6** | **-219.8 (32.3)** | 681 / 627 |
| F + weight move (classes) | 40 | 2553.4 | -221.0 (32.6) | 681 / 627 |
| F + weight move (pounds) | 40 | 2554.6 | -219.8 (33.1) | 681 / 630 |
| F + height, ape index, reach and height advantage | 40 | 2543.5 | -231.0 (33.9) | 681 / 636 |
| F without prior-KD covariates (KD history only through u) | 34 | 2549.5 | -225.0 (33.2) | 681 / 613 |

Paired differences on 2024+:

| Comparison | Δ deviance (SE) |
|---|---|
| F vs V3 (engine v3 structure) | -52.2 (18.5) |
| F vs E3 (fighter effects only) | -17.2 (15.1) |
| F vs M3 (covariates only) | -89.6 (22.2) |
| E3 vs V3 | -35.0 (15.4) |
| C30 vs M1 (adding the claim's age terms) | -28.7 (9.7) |
| M2 vs C30 (spline over the claim's past-30 form) | -11.4 (5.6) |
| F + weight move vs F | -1.2 (3.2) |
| F + pounds vs F | -0.0 (5.0) |
| F + body terms vs F | -11.2 (6.9); +1.4 on 2019-2023, so not adopted |
| F without prior-KD covariates vs F | -5.2 (7.1); +21 on 2019-2023, so not adopted |

On the backtest-eligible subset (both men had an earlier UFC fight, 2,379 rows), F beats M0L by 187.8.

**The test period runs hot.** Observed/expected under F is 0.81 in 2024, 1.25 in 2025 and 1.24 in 2026. The
trailing level lags the 2025-26 surge (section 6). Every model shares that offset, so the comparisons stay fair.

**Calibration of F on 2024+ (O/E; overall 1.09 because of the level surge):**

| Group | Rows | KD | M0L | M1 | V3 | F |
|---|---|---|---|---|---|---|
| Defender age < 27 | 326 | 55 | 0.82 | 0.89 | 1.05 | 1.16 |
| 27-30 | 630 | 129 | 1.09 | 1.10 | 1.29 | 1.22 |
| 30-33 | 831 | 183 | 1.05 | 1.09 | 1.22 | 1.00 |
| 33-36 | 651 | 159 | 1.22 | 1.22 | 1.29 | 1.02 |
| 36+ | 454 | 148 | 1.44 | 1.50 | 1.36 | 1.13 |
| Attacker age < 27 | 333 | 97 | 1.28 | 1.41 | 1.48 | 1.19 |
| 36+ | 442 | 80 | 0.93 | 0.96 | 1.19 | 1.08 |
| Defender moved down a class | 100 | 25 | 1.58 | 1.85 | 1.79 | 1.63 |
| Defender at home | 2,361 | 560 | 1.13 | 1.16 | 1.26 | 1.06 |
| Defender moved up a class | 140 | 20 | 0.72 | 0.73 | 0.72 | 0.68 |
| Defender UFC debut | 304 | 76 | 1.37 | 1.38 | 1.49 | 1.36 |
| Attacker UFC debut | 313 | 97 | 1.72 | 1.71 | 1.80 | 1.66 |
| Defender prior KO losses 0 | 1,632 | 320 | 0.95 | 1.01 | 1.21 | 1.08 |
| 1 | 695 | 181 | 1.28 | 1.31 | 1.36 | 1.13 |
| 2+ | 578 | 180 | 1.53 | 1.46 | 1.29 | 1.05 |
| Chin effect tercile: low (good chin) | 968 | 196 | 0.82 | 0.82 | 1.04 | 0.88 |
| high (weak chin) | 1,149 | 320 | 1.53 | 1.58 | 1.42 | 1.22 |
| Power effect tercile: low | 968 | 196 | 0.89 | 0.92 | 1.24 | 1.16 |
| high | 969 | 282 | 1.48 | 1.50 | 1.28 | 1.02 |

What the table shows:

- The age gradient that the constant model leaves (0.82 -> 1.44 across defender age bands) is gone under F.
- The KO-loss gradient (0.95 -> 1.53) is also gone.
- Debutants on both sides are under-predicted. Attacker experience terms did not help on 2019-2023, so this is a
  test-period observation.
- Defenders who moved up get knocked down less than predicted, and defenders who moved down more.

**Fighter-effect calibration slopes** come from free coefficients on log u and log v in place of the fixed 1:

| Period | Chin slope (SE) | Power slope (SE) |
|---|---|---|
| Training, 2008-2023 | 0.96 (0.06) | 0.97 (0.06) |
| Validation, 2019-2023 (fit 2008-2018) | 1.15 (0.09) | 0.87 (0.09) |
| Test, 2024+ | 1.41 (0.13) | 0.89 (0.12) |

Chin effects are somewhat underweighted out of sample. Raising u to the validation exponent 1.15 (estimated on
2019-2023, not on the test) improves 2024+ deviance by 5.3 (SE 2.8). Applying the power exponent 0.87 as well
gives no further gain (-4.7, SE 3.9).

## 3. Coefficients

These are log-rate coefficients on knockdowns per landed standing head strike. "Pre-2024" is the fit used for
held-out scoring; "live" is the fit on 2008 through Oct 31, 2026, used for the roster and the engine.
SE (cl) is clustered by defender.

| Term | Pre-2024 coef (SE, SE cl) | Live coef (SE cl) | Live multiplier |
|---|---|---|---|
| const (vs trailing league level) | -0.080 (0.107, 0.123) | +0.042 (0.111) | 1.043 |
| Bantamweight | +0.276 (0.073, 0.083) | +0.110 (0.076) | 1.116 |
| Featherweight | +0.040 (0.073, 0.082) | +0.084 (0.071) | 1.087 |
| Flyweight | +0.239 (0.097, 0.109) | +0.148 (0.093) | 1.159 |
| Welterweight | +0.146 (0.063, 0.067) | +0.093 (0.062) | 1.098 |
| Middleweight | +0.205 (0.070, 0.075) | +0.191 (0.069) | 1.210 |
| Light Heavyweight | +0.319 (0.076, 0.081) | +0.333 (0.074) | 1.395 |
| Heavyweight | +0.267 (0.082, 0.095) | +0.155 (0.085) | 1.168 |
| Women's Strawweight | -1.015 (0.146, 0.166) | -1.106 (0.149) | 0.331 |
| Women's Flyweight | -1.210 (0.181, 0.185) | -1.155 (0.156) | 0.315 |
| Women's Bantamweight | -1.105 (0.179, 0.181) | -1.093 (0.166) | 0.335 |
| Women's Featherweight | -0.406 (0.339, 0.363) | -0.505 (0.361) | 0.604 |
| Catch Weight | -0.005 (0.199, 0.207) | -0.083 (0.179) | 0.920 |
| Five-round | -0.098 (0.079, 0.094) | -0.100 (0.082) | 0.905 |
| Title | -0.116 (0.109, 0.128) | -0.125 (0.120) | 0.883 |
| Defender age - 30 (slope below 30) | +0.0553 (0.0119, 0.0139) | +0.0600 (0.0130) | 1.062/yr |
| Defender max(0, age - 30) (change past 30) | -0.0066 (0.0169, 0.0189) | -0.0059 (0.0173) | |
| Defender age unknown | +0.688 (0.319, 0.224) | +0.789 (0.213) | |
| Defender years in the UFC | +0.0282 (0.0127, 0.0148) | +0.0208 (0.0133) | 1.021/yr |
| Defender ln(1 + UFC fights) | +0.083 (0.058, 0.066) | +0.064 (0.058) | |
| Defender career sig head absorbed / 100 | -0.011 (0.022, 0.026) | -0.015 (0.019) | 0.985 |
| Defender KDs absorbed, last 365 days | -0.163 (0.041, 0.049) | -0.148 (0.043) | 0.862 each |
| Defender KDs absorbed, older | -0.118 (0.020, 0.022) | -0.097 (0.020) | 0.908 each |
| Defender KO/TKO losses, last 365 days | +0.180 (0.083, 0.102) | +0.145 (0.092) | 1.156 each |
| Defender KO/TKO losses, older | +0.055 (0.030, 0.033) | +0.045 (0.030) | 1.046 each |
| Defender UFC debut | +0.101 (0.091, 0.098) | +0.091 (0.089) | 1.095 |
| Layoff < 120 days | -0.162 (0.051, 0.057) | -0.119 (0.052) | 0.888 |
| Layoff 365-730 days | -0.011 (0.075, 0.084) | -0.029 (0.075) | 0.972 |
| Layoff 730+ days | -0.517 (0.170, 0.181) | -0.441 (0.158) | 0.644 |
| Last fight a KO/TKO loss | +0.107 (0.088, 0.103) | +0.151 (0.092) | 1.163 |
| ... and back within 180 days | -0.281 (0.106, 0.121) | -0.233 (0.106) | 0.792 |
| Attacker age - 30 (slope below 30) | -0.0086 (0.0104, 0.0119) | -0.0036 (0.0110) | |
| Attacker max(0, age - 30) | -0.0177 (0.0165, 0.0183) | -0.0241 (0.0167) | |
| Attacker years in the UFC | -0.0238 (0.0133, 0.0171) | -0.0212 (0.0148) | 0.979/yr |
| Attacker ln(1 + UFC fights) | +0.021 (0.053, 0.066) | +0.002 (0.059) | |
| Attacker UFC debut | -0.082 (0.085, 0.099) | -0.033 (0.088) | |

**Age slopes by segment** (log scale per year; % per year):

| | Defender < 30 | Defender >= 30 | Attacker < 30 | Attacker >= 30 |
|---|---|---|---|---|
| F pre-2024 | +0.055 (0.014): +5.7% | +0.049 (0.009): +5.0% | -0.009 (0.012): -0.9% | -0.026 (0.010): -2.6% |
| F live | +0.060 (0.013): +6.2% | +0.054 (0.008): +5.6% | -0.004 (0.011): -0.4% | -0.028 (0.009): -2.7% |
| M2, age only (no fighter effects, no damage terms) | +5.1% | +3.5% | -1.3% | -2.8% |

For an active fighter, age and UFC tenure advance together. From 30 to 38 the chin multiplier grows by
exp(8 x (0.054 + 0.021)) = **×1.82** (live fit), before any knockdown or KO-loss history. Over the same span,
power falls by exp(8 x (-0.028 - 0.021)) = **×0.68**.

**Prior knockdowns absorbed enter twice.** They raise u_d by (alpha + Y + 1) / (alpha + Y) and lower the
covariate term by ×0.86-0.91 each. The net effect of one more knockdown is ×1.21 for a fighter with none so far
and 3 expected, and ×1.04 for one who has already absorbed 4. The evidence has diminishing returns.

The negative prior-KD coefficients undo part of u's reaction. The version without them did worse on 2019-2023
(+21 deviance) and slightly better on 2024+ (-5, SE 7). Its test chin slope is 1.19 instead of 1.41. A v9
recalibration could revisit this.

**Layoffs.** Long layoffs come with fewer knockdowns absorbed (×0.64, SE 0.16), possibly from more cautious
fighting or from selection. A quick return after a KO loss is not riskier: a return inside 120 days after one is
net ×0.82. The plausible explanation is selection, because commissions suspend the worst-hurt fighters and the
ones who come back fast are the less damaged.

**Body terms (tested, not adopted):**

| Term | Coef (SE cl) | Effect |
|---|---|---|
| Defender height above division mean | +0.080 (0.015) | +8% per inch |
| Defender ape index | +0.047 (0.016) | +4.8% per inch |
| Reach advantage (attacker - defender) | +0.044 (0.011) | +4.5% per inch |
| Height advantage | -0.034 (0.015) | -3.4% per inch |

Tall-for-division fighters get dropped more. The block helps on 2024+ (-11.2, SE 6.9) but not on 2019-2023
(+1.4), so it is left for v7 (style and physical matchups) to recheck.

## 4. KO/TKO loss per fight

Logistic regression. One row per defender of each fight with stats; 2008-2023 fit (13,216 rows), 2024+ test
(3,034 rows). The outcome is a KO/TKO loss (strikes or corner, doctor stoppages excluded). Features are
pre-fight only.

- Expected exposure is the log ratio of the geometric mean of the attacker's standing head landed per minute and
  the defender's absorbed per minute (decayed sums, half-life 730 days, shrunk toward the league 1.94/min with
  15 minutes of prior) to the league rate.
- Scheduled length is log(scheduled minutes / 15).
- Elo difference is (Elo_att - Elo_def) / 400 x ln 10.
- The trailing KD level is log L(t) relative to its fit-period mean.
- Fighter effects enter as log u_d and log v_a (walk-forward).

| Model | Test log loss | vs K0 (SE) | vs K2 (SE) |
|---|---|---|---|
| K0 constant (test KO rate 16.4%) | 0.44676 | 0 | +27.2 (7.3) |
| K1 division + scheduled length | 0.44004 | -20.4 (6.7) | +6.8 (2.7) |
| K2 K1 + Elo difference | 0.43779 | -27.2 (7.3) | 0 |
| K3 K2 + trailing KD level | 0.43734 | -28.6 (7.4) | -1.4 (0.9) |
| K4 composite: log predicted KD rate (section 3 model) + exposure + scheduled length + Elo | 0.42151 | -76.6 (10.5) | -49.4 (9.8) |
| **K5 direct: K3 + exposure + age, damage, layoff, attacker experience, log u, log v** | **0.41598** | **-93.4 (12.7)** | **-66.2 (11.1)** |
| K6 K5 + weight move | 0.41607 | -93.1 (12.8) | -65.9 (11.2) |
| K7 K4 + KO-loss, KD and move terms | 0.42166 | -76.2 (11.6) | -48.9 (10.9) |

Totals are summed log-loss differences over test rows, clustered by fight.

K5 coefficients (pre-2024 fit; logit, SE):

| Term | Coef (SE) | Odds effect |
|---|---|---|
| Expected exposure | +1.10 (0.14) | |
| Scheduled length | +0.81 (0.17) | |
| Elo difference | +0.26 (0.08) | |
| Trailing level | +0.17 (0.11) | |
| Defender age, slope below 30 | +0.071 (0.016) | +7.4%/yr |
| Defender age, change past 30 | -0.019 (0.023) | slope past 30 about +5.3%/yr |
| Attacker age | -0.036 (0.014) | |
| Attacker years in the UFC | -0.067 (0.018) | |
| Attacker ln(1 + fights) | +0.20 (0.07) | |
| Defender KO losses, last 365 days | +0.26 (0.11) | ×1.30 |
| Defender KO losses, older | +0.118 (0.040) | ×1.12 |
| Last fight a KO loss | +0.20 (0.12) | |
| ... back within 180 days | -0.21 (0.14) | |
| Career head absorbed / 100 | -0.075 (0.047) | |
| Prior KDs absorbed, recent / older | -0.04 (0.07) / +0.01 (0.05) | |
| log v_a (attacker power) | +0.71 (0.08) | |
| log u_d (defender chin) | +0.37 (0.20) | |

Weight move (K6) is null again:

| Term | Coef (SE) |
|---|---|
| Defender moved up, per class | -0.21 (0.14) |
| Defender moved down, per class | +0.11 (0.10) |
| Attacker moved up, per class | +0.10 (0.13) |
| Attacker moved down, per class | -0.12 (0.11) |

Test calibration of K5 by predicted decile:

| Decile | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Predicted | 0.051 | 0.079 | 0.097 | 0.115 | 0.133 | 0.154 | 0.178 | 0.208 | 0.251 | 0.358 |
| Observed | 0.046 | 0.056 | 0.079 | 0.138 | 0.129 | 0.155 | 0.161 | 0.231 | 0.327 | 0.319 |

The live refit (2008 through the snapshot) is in `durability.json` `ko_loss_model_live`.

## 5. Fight-night heterogeneity (for `form.pow`, `form.chin`, `form.vol`)

A negative binomial fit with the model's mean fixed, on 2008-2023 rows, gives the extra-Poisson variance of the
per-fight knockdown rate (gamma variance v; lognormal sd = sqrt(ln(1 + v))). The share common to both directions
of a fight comes from cov(y_ab, y_ba) = mu_ab mu_ba v_shared.

| Means from | Total v (lognormal sd) | Shared v (SE) | Shared sd | Direction-specific sd | LR vs Poisson |
|---|---|---|---|---|---|
| Walk-forward fighter effects | 1.00 (0.83) | 0.257 (0.038) | 0.48 | 0.68 | 248 |
| Leave-one-out full-history fighter effects | 0.80 (0.77) | 0.247 (0.036) | 0.47 | 0.61 | 190 |

v3 has `form.vol` 0.60 (shared, v 0.43) and `form.pow` = `form.chin` = 0.45, which makes the direction-specific sd
0.64 (v 0.50). Its total v is 1.15, against 0.80-1.00 in the data, and nearly all the excess is in the shared
term.

Recommendation: `form.vol` 0.47, `form.pow` 0.43, `form.chin` 0.43. The engine's within-fight dynamics
(`kdRepeat`, hurt, accumulated damage) also cluster knockdowns. So the cleaner target is to simulate the backtest
and match the moments directly: per-direction extra-Poisson variance 0.8-1.0 and shared variance 0.25, measured
on simulated knockdown counts against the engine's own expected counts.

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

Around the UFC's 2024 glove trial (new gloves from UFC 302 in June 2024 until the old ones returned at UFC 309 in
November 2024, per press reports):

| Window | Fights | KD per 1,000 (95% CI) | KO/TKO share |
|---|---|---|---|
| 12 months before | 527 | 8.25 (7.18-9.44) | 31.3% |
| Glove trial | 252 | 5.95 (4.72-7.41) | 21.4% |
| 12 months after | 532 | 8.98 (7.86-10.22) | 31.8% |
| Nov 2025-Oct 2026 | 520 | 11.87 (10.53-13.32) | 40.0% |

Our 2026 count is 191 KO/TKO of 480 bouts, or 193 with doctor stoppages, which matches AgentMMA's 193 of 480
through Oct 31. No source I
found names a 2026 rule or equipment change, so the 2026 surge is unexplained.

The trailing 730-day level won the 2019-2023 tuning narrowly (4,343.1 against 4,346.3 for 365 days and 4,349.2
for 180). At the snapshot it is 0.01027, and the trailing 365-day level is 0.01171. Under F, 2025-26 still runs
about 25% above prediction. Recommendation: keep 730 days as the default and expose the 365-day level as a
labeled "current season" scenario. Whichever is used, put the level in the engine's `kdScale`; do not let it leak
into the fighter multipliers.

## 7. Published claims, checked (docs/BACKLOG.md)

**1. "KD susceptibility +4.0% per year past 30 (SE 0.6%); knockdown power -3.6% per year past 30; p0 = 0.00844."**

- **Replicated.** The same specification on 2010-2026 (Poisson, offset log head strikes absorbed, defender and
  attacker years past 30) gives +0.0400 (SE 0.0056), -0.0370 (SE 0.0069) and baseline 0.00851. With standing head
  strikes it gives +0.0419 / -0.0412, and on 2008-2023 +0.0411 / -0.0335.
- **Richer model, chin.** The size holds past 30 (+5.0%/yr, SE 0.9%, pre-2024; +5.6% live) but the shape is
  wrong: susceptibility also rises +5.7%/yr before 30 (SE 1.4%), with no knee (the hinge is -0.007, SE 0.019).
  Tenure adds +2-3% per UFC year. On held-out data the spline beats the past-30 form by 11.4 (SE 5.6).
  Recommendation: age chin linearly through 30, not from 30 (or from 34, as v3 does).
- **Richer model, power.** -2.6%/yr past 30 (SE 1.0%) with tenure held fixed, plus -2.4% per UFC year. Without
  the tenure term, -3.6%/yr (the published value). Flat before 30.
- **Within-fighter check.** Conditional Poisson with fighter fixed effects, 1,261 fighters with at least one
  knockdown absorbed:
  - Age-only spec: +17%/yr before 30 and +11%/yr after (cluster SEs 2.5 and 3.2 points).
  - Dropping each fighter's final UFC fight: +15.6%/yr and +9.8%/yr.
  - Adding career head strikes absorbed: age +4.4%/yr before 30 and -1.9%/yr after; head strikes absorbed
    +0.285 per 100 (SE 0.055).

  Within a career, susceptibility tracks accumulated head strikes more than birthdays. These within-fighter slopes
  are larger than the predictive ones but biased upward: careers end after KOs, which piles knockdowns into late
  career. They are an upper bound, and the predictive model is the one validated on held-out fights.

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
  | Defender moved up, per class | ×0.89 (SE 0.13) | ×0.83 (SE 0.11) |
  | Defender moved down, per class | ×1.09 (SE 0.09) | ×1.10 (SE 0.08) |
  | Attacker moved up, per class | ×1.26 (SE 0.10) | ×1.23 (SE 0.09) |
  | Attacker moved down, per class | ×0.92 (SE 0.10) | ×0.92 (SE 0.09) |

  In pounds (pre-2024): defender -0.3%/lb (SE 0.6%), attacker +1.3%/lb (SE 0.5%).
- **Held-out:** move terms add -1.2 deviance (SE 3.2) in the KD model and +0.3 log loss in the KO model, so they
  are dropped.
- **The pattern is selection, not physics.** Fighters move up when they are dominant punchers and move down
  after being hurt. A mechanistic size tax is not supported by the KD data. Keep the size knob, but default it to
  0 and label any non-zero value a judgment call. The market-implied size view in `research/matchup_market.md`
  (elite FW champions at LW went 4-8) is not a knockdown effect in this data.

**3. Other BACKLOG numbers touched here.**

- **"KD per landed standing head strike 0.0095":** 2019+ average 0.00888, since Nov 2024 0.01027, LW since Nov
  2024 0.01098.
- **"5-round 0.0078, title 0.0070":** after fighter effects these shrink to ×0.905 (SE 0.08) for five rounds and
  ×0.883 (SE 0.12) for a title fight. Most of the raw gap is who fights in them.

## 8. Roster multipliers, and Volkanovski and Gaethje

`durability.json` `roster` has every fighter in `fighters.json` (1,229), as of Oct 31, 2026:

| Field | Meaning |
|---|---|
| `chin_re`, `pow_re` | Gamma posterior means of u and v |
| `chin_re_q`, `pow_re_q` | 5/50/95% quantiles |
| `chin_re_shape_rate`, `pow_re_shape_rate` | Gamma shape and rate |
| `chin_cov`, `pow_cov` | Covariate multipliers vs the reference profile (see below), with a normal 4-12 month layoff |
| `chin_total_q`, `pow_total_q` | Totals with 90% intervals, drawing coefficients (clustered covariance) and fighter effects |
| `kd_absorbed`, `kd_absorbed_expected` | Knockdowns absorbed vs the model's expectation |
| `kd_scored`, `kd_scored_expected` | Knockdowns scored vs the model's expectation |

The reference profile is a 30-year-old with 2.6 UFC years, 5 UFC fights and 89 head strikes absorbed, no
knockdowns absorbed and no KO losses, at home. Chin multipliers above 1 mean easier to drop.

**Volkanovski and Gaethje (live fit, as of Oct 31, 2026):**

| | Volkanovski | Gaethje |
|---|---|---|
| Age; UFC fights; years in UFC | 38.1; 19; 9.9 | 38.0; 16; 9.3 |
| KD absorbed vs expected | 4 vs 5.71 | 4 vs 7.96 |
| KO/TKO losses (last year / older) | 0 / 2 | 0 / 3 |
| Chin effect u (90% interval) | 0.80 (0.38-1.36) | 0.64 (0.30-1.08) |
| Chin covariates (age, tenure, history) | ×1.33 | ×1.26 |
| **Chin total (90% interval)** | **1.07 (0.50-1.83)** | **0.81 (0.36-1.42)** |
| KD scored vs expected | 6 vs 6.24 | 9 vs 6.25 |
| Power effect v (90% interval) | 0.97 (0.51-1.56) | 1.30 (0.75-1.97) |
| Power covariates (age, tenure) | ×0.69 | ×0.70 |
| **Power total (90% interval)** | **0.67 (0.33-1.09)** | **0.90 (0.52-1.39)** |

Neither man has a weak chin for his history. Both have absorbed fewer knockdowns than a model of their
opponents and exposure expects, Gaethje markedly so (4 against 8). But age and tenure push both totals back
toward or above the reference. Gaethje's power residual (9 knockdowns against 6.3 expected) is the clearest
fighter-specific signal of the four.

**KD probability per landed standing head strike in a 5-round, non-title lightweight fight** (90% intervals from
the fighter-effect posteriors):

| Direction | Trailing 730-day level | Trailing 365-day level |
|---|---|---|
| Volkanovski drops Gaethje | 0.58 per 100 (0.21-1.16) | 0.66 per 100 (0.23-1.32) |
| Gaethje drops Volkanovski | 1.04 per 100 (0.40-1.97) | 1.19 per 100 (0.46-2.25) |

A title fight multiplies both by 0.883. The two-fighter reference pair in this setting would be 1.07 per 100 at
the 730-day level. These intervals cover only the fighter effects; coefficient uncertainty is small by comparison
(the roster `chin_total_q` and `pow_total_q` include both).

**Per-fight KO/TKO loss** (K5 refit on all data; 90% intervals cover coefficients only):

| | Trailing 730-day level | Trailing 365-day level |
|---|---|---|
| P(Gaethje loses by KO/TKO) | 22.9% (18.5-28.4) | 23.3% (18.8-29.0) |
| P(Volkanovski loses by KO/TKO) | 21.6% (18.1-25.8) | 22.0% (18.3-26.4) |

The per-strike rates favor Gaethje's power, while the per-fight risks are close. Volkanovski's higher landing rate
and his Elo edge (about 65 points) offset it. The v5 engine run for this matchup should land near these per-fight
numbers.

**Active roster extremes** (8+ UFC fights, fought in 2025-26; posterior mean and 90% interval):

| Group | Fighter | KD absorbed / expected | u | KD scored / expected | v |
|---|---|---|---|---|---|
| Weakest chin | Steve Garcia | 6 / 0.7 | 2.42 (1.26-3.88) | 8 / 1.0 | 2.74 (1.54-4.23) |
| | Johnny Walker | 7 / 1.3 | 2.32 (1.26-3.64) | 6 / 1.7 | 1.90 (0.99-3.04) |
| | Chase Hooper | 6 / 0.9 | 2.32 (1.21-3.72) | | |
| Best chin | Tim Elliott | 0 / 10.7 | 0.22 (0.06-0.46) | | |
| | Marvin Vettori | 0 / 10.4 | 0.22 (0.06-0.47) | | |
| | Calvin Kattar | 1 / 11.8 | 0.27 (0.09-0.52) | | |
| | Max Holloway | 2 / 14.4 | 0.29 (0.11-0.52) | | |
| Most power | Carlos Prates | | | 12 / 1.6 | 3.26 (2.01-4.76) |
| | Uros Medic | | | 9 / 0.9 | 3.04 (1.75-4.61) |
| | Montel Jackson | | | 14 / 2.6 | 3.01 (1.92-4.31) |
| | Deiveson Figueiredo | | | 12 / 2.3 | 2.84 (1.75-4.15) |

## 9. Engine recommendation (v5)

Replace v3's power and chin block (`fighterRates` R.pow / R.chin and the `fac` factors in `matchup`) with the
following. Knockdown probability per landed standing head strike by a on d:

```
p_ad = kd0_div * kdScale * ctx * C_d * P_a / NORM

ctx  = exp(-0.100 * five_round  - 0.125 * title)                  (live fit)
C_d  = exp(f_d) * u_d ^ 1.15        chin;  u_d ^ 1.0 if the validated exponent is not adopted
P_a  = exp(g_a) * v_a               power

f_d =  0.0600 * (age - 30) - 0.0059 * max(0, age - 30) + 0.789 * [age unknown]
     + 0.0208 * (yrs_ufc - 2.606) + 0.0637 * (ln(1 + ufc_fights) - 1.792) - 0.0154 * (head_absorbed/100 - 0.89)
     - 0.1484 * KDabs_365d - 0.0966 * KDabs_older + 0.1453 * KOL_365d + 0.0454 * KOL_older + 0.0905 * [debut]
     - 0.1187 * [layoff < 120 d] - 0.0287 * [365 <= layoff < 730 d] - 0.4405 * [layoff >= 730 d]
     + 0.1514 * [last fight KO/TKO loss] - 0.2325 * [last fight KO/TKO loss and layoff < 180 d]
g_a = -0.0036 * (age - 30) - 0.0241 * max(0, age - 30) - 0.0212 * (yrs_ufc - 2.606)
     + 0.0021 * (ln(1 + ufc_fights) - 1.792) - 0.0334 * [debut]

u_d = (3 + KD absorbed) / (3 + expected KD absorbed)     over all earlier UFC fights, no time decay
v_a = (3 + KD scored)   / (3 + expected KD scored)
```

- **Inputs.** `KOL` = KO/TKO losses by strikes or corner (not doctor). Ages are at the fight date. The
  "expected" sums come from this model fight by fight.
- **Where to read them.** For the live roster, read `chin_re`, `pow_re` and the shape/rate pairs from
  `durability.json`. For the backtest, `durability.json` `backtest[fight_id]` gives the walk-forward values for
  every one of the 3,237 entries (pre-2024 fit, leak-free for 2024+): side `chin_re`, `chin_cov`, `pow_re`,
  `pow_cov`, plus `p[side]`, the model's knockdown probability per standing head strike landed by that side.
- **NORM.** With kd0_div = the division prior, NORM = norm_chin x norm_pow = 0.953 x 0.959 (the
  2024+ exposure-weighted means of C_d and P_a, `engine.norm_chin` and `engine.norm_pow`). This keeps the
  division average where `kd0` and `kdScale` put it.
- **Absolute form.** Alternatively use p_ad = L x exp(terms_live const + division + ctx + ref_lin) x C_d x P_a
  directly, with L = `engine.level_now_trailing_730` (0.01027) or `_365` (0.01171) and ref_lin =
  `engine.ref_lin`.

Mapping to `src/params3.js`:

| v3 parameter | v3 value | v5 recommendation |
|---|---|---|
| `kKD` (shared shrinkage, all head strikes, decayed S) | 230 | Gamma EB with alpha 3 for chin and 3 for power on career sums, no decay. That is about 290 standing / 325 all head strikes at today's level, with opponent-adjusted expectations instead of raw head strikes |
| `chinAge0` / `chinAge` | 34 / 0.04 | Linear through 30: 0.060/yr at all ages (hinge -0.006), plus 0.021 per UFC year |
| `powAge` (from 34) | 0.03 | 0.028/yr past 30 (0.004 before), plus 0.021 per UFC year |
| `chinKO`, `chinKOcap` | 0.04, 1.15 | Split by recency: ×1.156 per KO loss in the past 365 days, ×1.046 per older one, ×1.163 if the last fight was a KO loss (×0.79 back if he returns within 180 days). Drop the cap: u_d and the negative prior-KD terms already guard against double counting |
| `sizeChin` / `sizePow` | 0.05 / 0.03 | 0 / 0 by default (data: defender ×0.83-0.89 per class up, the wrong sign for a tax; held-out gain nil). Keep as labeled knobs |
| `combA` / `combB` for KD only | 1 / 1 | Power exponent 1.0; chin exponent 1.15 (validated on 2019-2023: slope 1.15 ± 0.09; 2024+ gain 5.3 ± 2.8) |
| `kdScale` / level | 1.297 x division prior | Track the trailing league level: 0.01027 (730 days) default, 0.01171 (365 days) as a scenario |
| `form.vol`, `form.pow`, `form.chin` | 0.60, 0.45, 0.45 | 0.47, 0.43, 0.43, or match the moments in section 5 by simulation |
| Five-round / title | none | ×0.905 / ×0.883 |
| Division multipliers vs LW (live) | | FLY 1.16, BW 1.12, FW 1.09, WW 1.10, MW 1.21, LHW 1.40, HW 1.17; women 0.32-0.34 (WFW 0.60, n small) |

**v5 acceptance checks** (ROADMAP: KD-absorbed calibration by age band and weight move): the tables in section 2
give the targets. An engine using this block should reproduce flat O/E across defender age bands (F:
1.00-1.22, after the level) and across prior-KO-loss bands (1.05-1.13). Weight-move bands should be left alone:
up 0.68, down 1.63 on small counts.

## 10. Caveats

- **Exposure is estimated.** ufcstats gives no head-by-position split, so standing head strikes are the midpoint
  of bounds. Knockdowns from body shots (rare) are charged to head-strike exposure.
- **The per-strike hazard conditions on realized exposure.** A knockdown can end a fight and cut exposure. The
  Poisson-process likelihood stays valid under that kind of stopping, but the per-fight KO model (section 4) is
  the pre-fight check.
- **The test period runs about 9% hot** (2025-26 knockdown surge, cause unknown). All models share the level
  offset, so the comparisons stay fair, but absolute predictions for late 2026 depend on which level window you
  believe.
- **Selection is everywhere.** It shows in who moves up, who returns fast after a KO, who keeps getting fights
  after absorbing damage, and who fights for titles. The coefficients are predictive associations, validated
  out of sample, not causal effects. The within-fighter estimates are upper bounds.
- **Fighter effects are noisy.** A fighter with 10 fights has roughly 3-6 expected knockdowns of evidence, so
  90% intervals on u and v span about a factor of 3-4. Volkanovski's and Gaethje's intervals both include 1.
- **Pre-UFC careers are invisible.** Debutants start at the prior; the data shows debut attackers produce more
  knockdowns than predicted in 2024+.
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
