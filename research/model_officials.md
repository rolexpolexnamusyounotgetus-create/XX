# Officials model: judges and referees (v8 component)

Built Nov 6, 2026 (2:40 pm UTC run) by `tools/officials.py` from the ufcstats snapshot through Oct 31, 2026.
Outputs: `data/derived/officials.json` (league judging parameters with standard errors, a per-judge table with
posterior sds, region pools, per-referee multipliers and pools, held-out metrics, and an `engine` block for the
simulator to sample from) and this report. Fold pickles and logs are under `out/officials/` and `out/officials_*.log`
(gitignored). No 2026 fight was used for any fit or score (hidden-data protocol, docs/BACKLOG.md).

## Bottom line

- **How much the officials explain (held out: 534 decisions, Jan 2024 to Dec 2025, fit before 2024 and frozen,
  real round stats given).** Full model (named judges + home + closeness) vs a league judge with neither
  (paired difference, 95% event-cluster interval; negative = better for log losses):
  - 7-class decision log loss (A by UD/SD/MD, draw, B by MD/SD/UD): **0.7930 vs 0.8055, -0.0125 [-0.0203, -0.0056]**
  - unanimous vs split/majority log loss: 0.4409 vs 0.4495, -0.0086 [-0.0130, -0.0046]
  - exact three-card log-likelihood per fight: -3.8672 vs -3.8944, +0.027 [+0.012, +0.044]
  - decision winner log loss: 0.3387 vs 0.3414, -0.0027 [-0.0083, +0.0022] (not significant)

  Named-judge effects alone (same model without them): split -0.0020 [-0.0040, -0.0001], 7-class -0.0020
  [-0.0045, +0.0004], winner +0.0003 [-0.0009, +0.0017]. **Verification correction:** against the same published
  parameters with every judge effect set to 0, the named effects make the decision winner worse on all three folds
  (2024-25 +0.0019 [+0.0003, +0.0035]; 2022-23 +0.0036 [+0.0006, +0.0077]; 2019-23 +0.0015 [+0.0003, +0.0028]) and
  never improve the 7-class loss (2024-25 -0.0003 [-0.0033, +0.0029]); only the 2024-25 split loss improves (-0.0026
  [-0.0051, -0.0000]). The engine default is now named judges off (`knobs.named_judges`); the -0.0125 headline is
  the home term plus the closeness shape, and the zero-effect model keeps it (-0.0122 [-0.0203, -0.0053]). On the
  tuning windows the officials terms do not help (2022-23 7-class -0.0024 [-0.0119, +0.0061]; 2019-23 +0.0043
  [-0.0025, +0.0110]); see the verification log at the end. Knowing the panel moves the predicted decision winner by
  a median 0.2 points (90th percentile 1.0, max 6.2) and flips it in 0.6% of decisions; it moves P(split or
  majority) by a median 0.5 points (90th percentile 1.6). The home term moves the winner by up to 17.7 points.
  **The round stats decide who wins a decision; the officials shape how it is scored.** The largest single
  officials effect is home country abroad.
- **Home abroad is real.** Given the round stats, the fighter from the event country gets +0.73 (SE 0.09; an
  event-clustered sandwich SE from the independent re-fit is about 0.12) latent units at events outside the USA,
  worth 2.5 landed head strikes per round at 2025 weights: an even round goes 60.7% to the home fighter. At US
  events the American gets -0.16 (SE 0.07): 47.7% of even rounds; h_USA changed sign between fits (+0.07 fit before
  2019), so treat it as unstable. Home terms alone improve held-out 7-class log loss by -0.0105 [-0.0182, -0.0039]
  on 2024-25; the gain is smaller and not significant on 2022-23 and absent on 2019-23 (verification log).
- **Judges share most of their noise.** 57% of a round's latent score variance is common to the panel
  (sigma_u = 2.08 vs the logistic own noise, sd 1.81). Treating judges as independent predicts 37% split or majority
  decisions (20% observed) and costs 0.14 in 7-class log loss.
- **Era drift.** The knockdown weight rose 79% per decade (w_K = +0.58, SE 0.12): a knockdown was worth 9.7 landed
  head strikes in 2017 and 17.1 in 2025. Control 3.3 head strikes per minute (2025), takedown 1.4, submission
  attempt 4.3, body 0.75, leg 0.59. 10-8s peaked in 2017-2020 and fell every year since: P(10-8 | win) for a
  +20 significant-strike round with a knockdown was 0.21 in 2019 and 0.08 in 2025.
- **Individual judges differ, but modestly and with wide error bars.** Effect sds after tuning: sharpness 7.5%,
  volume 7.4%, knockdown 12.5%, grappling 9.8%, 10-8 odds 20%. Most power-friendly (30+ cards since 2022): Sal
  D'Amato (1,090 cards; knockdown weight x1.15, sd 0.08; power index +0.63, sd 0.39). Least: Adalaide Byrd (259;
  -0.51, sd 0.34) and Chris Lee (673; knockdown weight x0.83, sd 0.10; -0.44, sd 0.28). Highest 10-8 propensity:
  Douglas Crosby (odds x1.44, log-sd 0.13). These are descriptive: used for prediction they make the held-out
  decision winner worse (verification log), so the engine uses them only when the `named_judges` knob is on.
- **Against the engine's current judging rule** (src/params3.js, recalibrated on 2019-2023 rounds), on the same
  2024-25 fights with the same stats: level on the decision winner (+0.0065 [-0.0042, +0.0168]; 2022-23 +0.0011
  [-0.0166, +0.0173]) and on the 7-class outcome (+0.0058 [-0.0097, +0.0204]), better on round scores (5-outcome
  round log loss -0.0140 [-0.0215, -0.0071]) and on the 2022-23 7-class outcome (-0.057 [-0.106, -0.020]). It adds
  judge identity, home, era weights, 10-8 levels by year and deductions, which the current rule lacks.
- **Two calibration problems on 2024-25 that no earlier data predicted.** 10-8s kept falling (8.8% of cards
  predicted with a 10-8, 5.5% observed); a damped trend tuned on 2022-23 made 2024-25 worse (-0.0033 per fight), so
  the engine uses the 2025 level. And 2025 judges agreed far more than in any earlier year (round unanimity 0.808
  observed vs 0.763 predicted; split or majority decisions 15.3% vs 26.6%), while 2024 was on target (0.772 vs
  0.775; 24.4% vs 24.7%). That is a labeled knob (`panel_sharpness_shift`, 0.21 reproduces 2025), not a default.
- **Referees barely matter for prediction.** With empirical-Bayes shrinkage every referee multiplier is within
  a few percent of 1 and held-out loss moves by 0.001 or less in every unit. With the lighter shrinkage tuned on
  2019-2023, only ground-and-pound stoppages improve on 2024-25 (-0.0016 [-0.0029, -0.0003] per unit) and standing
  TKOs get worse (+0.0005 [+0.00002, +0.0011]). League rates (2019 on): a knockdown leads to the scorer's KO/TKO in
  the same round 56.5% of the time; 68.7% of knockdown-round KOs are stopped on the knockdown blow itself; the rest
  average 4.4 follow-up ground strikes; standing TKO without a knockdown 0.00033 per landed standing strike;
  ground-and-pound stoppage 0.0080 per landed ground strike; doctor stoppage 0.73% of fights; DQ 0.17%; a point
  deduction in 2.6% of decisions.

## 1. Data

| | |
|---|---|
| Decisions modelled | 3,876 UFC decisions, 2001-01-01 to 2025-12-31, scheduled distance, round stats complete (dropped: 1 deduction text that would not parse, 4 without three cards) |
| Cards | 11,628 (three per fight), 452 named judges |
| Round scores | 3,182 decisions with all three judges' round-by-round scores, 154 with part of the panel, 540 with totals only. Round scores come from `tools/judgerounds.py` (MMA Decisions via the nlbair and Davies GitHub datasets; 99.4% of three-judge fights agree with ufcstats on all three totals) |
| Judge totals | Parsed from ufcstats DETAILS. ufcstats writes each card loser-first (6,655 of 6,657 unanimous cards, research/data_baserates.md); cards are mapped to A (first name in BOUT) and B by the fight's winner; draw cards are unordered and both orientations are allowed. "Point Deducted: ... by <name>" prefixes are parsed and stripped |
| Deductions | Known for 2,975 decisions (MMA Decisions raw vs published round scores, 2013-2025) plus those DETAILS records; latent (0, 1 or 2 points per fighter) elsewhere |
| Round stats | Per-round landed significant strikes to head, body and legs, knockdowns, takedowns landed, control time, submission attempts and reversals for both fighters (A - B differentials) |
| Home | Event country (from the event location) vs each fighter's home countries (Wikidata country-for-sport plus every citizenship, else birth country; CC0). 1,578 of 1,974 fighter names matched (1,543 by name, 35 by date of birth plus surname); both fighters known in 3,209 decisions; exactly one home fighter in 1,457 (963 at US events, 494 abroad) |
| Referees | ufcstats REFEREE column; 8,227 fights with round stats for the stoppage units |

Raw check before any model: in decisions with exactly one home fighter, the home fighter won 285 of 485 abroad
(58.8%) and 470 of 950 at US events (49.5%). The model below asks whether that survives conditioning on the round
stats (it does abroad, see 3.4 and 3.5).

## 2. Method

### 2.1 Judges: a round-level latent model with shared noise

In round r of fight f, judge j scores the round for A when z_jfr > 0, where

```
z_jfr  = exp(n_j) * [ exp(v_j + wV*t) * V_fr + exp(p_j + wK*t) * K_fr + exp(g_j + wG*t) * G_fr + h * home_f + u_fr ] + e_jfr
V      = b_head*dHead + b_body*dBody + b_leg*dLeg          (landed significant strikes, A - B)
K      = b_kd*dKD
G      = b_td*dTD + b_ctrl*dCtrlMin + b_sub*dSubAtt + b_rev*dRev
t      = (year - 2017) / 10
home   = [A is from the event country] - [B is];  h = h_USA at US events, h_abroad elsewhere
u_fr   ~ N(0, s_fr^2), shared by the three judges;  s_fr = sigma_u * exp(-kappa * |core0_fr|)
core0  = exp(wV*t)*V + exp(wK*t)*K + exp(wG*t)*G     (the league judge's stat edge, no home term)
e_jfr  ~ Logistic(0, 1), the judge's own noise
```

The round winner W gets a 10-8 with P = sigmoid(c0 + c_year + c_j + thV*V_W + thK*K_W + thG*G_W + thU*u_W)
(everything oriented to W); a 10-10 has a small fixed probability; point deductions come off the totals.

Judge effects (n sharpness, v volume weight, p knockdown weight, g grappling weight, c 10-8 propensity) are
Gaussian random effects with sds tau_k: the hierarchical part. Every effect is multiplicative on a league weight,
so a judge with p = +0.1 values a knockdown 10.5% more than the league judge, and n = +0.1 is a judge whose own
noise is 10% smaller relative to the evidence (more decisive, agrees more with the stats and the panel).

**Likelihood.** A card with round scores contributes its observed round-outcome sequence (B10-8, B10-9, 10-10,
A10-9, A10-8 per round). A card known only by its total contributes the sum over every round-outcome sequence with
that total (deductions latent unless known), so the round-level likelihood is marginalised exactly rather than
approximated by EM (research/data_baserates.md used EM on 10-9-only cards). The three cards of a fight are joined
through the shared round noise u, integrated by Gauss-Hermite quadrature (10 nodes) round by round; every
consistent (card 1, card 2, card 3) sequence triple is enumerated (7 fights with more than 6,200 triples are
dropped). Fit: MAP by preconditioned L-BFGS with JAX gradients; the random-effect sds by empirical Bayes on the
training window times a multiplier tuned on 2019-2023; posterior sds of judge effects from the observed
information (outer product of per-fight scores) plus the prior precision; Laplace standard errors for the league
parameters. The model has no intercept and every term is antisymmetric in A and B, so it cannot learn ufcstats'
winner-first listing (docs/BACKLOG.md evaluation rule).

**The closeness term (new in this run).** Six structural variants of the league model (with home, no named judges)
were compared on the tuning window and the held-out window (section 3.2). Letting the shared noise sd depend on
the stat edge (kappa) was the only change that helped on both. The fitted kappa is negative: lopsided rounds carry
more shared noise than even ones, which means the round-winner curve has heavier tails than logistic-normal
(rounds that are lopsided on the ufcstats counts go the other way a little more often than a constant-noise model
allows). Every fold was then refit with it, warm-started from the base folds.

### 2.2 Referees: penalised random-intercept GLMs

Each unit is a GLM with fixed effects for division group, era (quadratic in year), round, five-round format and
title fights (plus unit-specific terms), and a referee random intercept u_ref ~ N(0, tau^2):

| Unit | Rows | Outcome | Family |
|---|---|---|---|
| kd_finish | fighter-rounds with >= 1 KD (3,255) | the KD scorer finishes by KO/TKO in that round | logistic; adds 2+ KDs, opponent also scored a KD, log standing strikes |
| kd_single | KD-round KO finishes (1,792) | the finishing blow is a single strike (DETAILS singular: "Punch", "Kick", "Knee"...), i.e. stopped on the knockdown blow with no follow-up: the short end of time-from-KD-to-stoppage | logistic |
| kd_follow | same 1,792 | ground strikes the finisher landed in that round: the follow-up a referee allows before stepping in (ufcstats has no KD timestamps, so the KD-to-stoppage time itself is not observable) | quasi-Poisson (dispersion 6.9) |
| stand_tko | fighter-rounds without a KD, with standing strikes landed (34,444) | standing TKO without a knockdown | Poisson with offset log(standing sig strikes landed) |
| gnp_tko | fighter-rounds without a KD, with ground strikes landed (11,261) | ground-and-pound stoppage | Poisson with offset log(ground sig strikes landed) |
| any_ko | fights (8,227) | KO/TKO from strikes | logistic |
| doctor | fights | doctor stoppage | logistic |
| dq | fights | disqualification | logistic |
| deduction | decisions with known deductions (2,975, 2013-2025) | any point deduction | logistic |

Shrinkage: tau by Laplace marginal likelihood (empirical Bayes) on all data, and separately tau tuned by
held-out loss on 2019-2023 (fit before 2019). Held-out check: yearly refits (fit on everything before each test
year), scored on 2024-2025.

## 3. Walk-forward design

| Fold | Fit on | Scored on | Role |
|---|---|---|---|
| tune22 | decisions before 2022 | 2022-2023 (485) | primary tuning fold (two-year horizon, like a yearly refit): picks the judge-effect shrinkage |
| tune | before 2019 | 2019-2023 (1,243) | secondary tuning fold (five-year horizon) |
| test | before 2024, frozen | 2024-01-01 to 2025-12-31 (534) | held-out validation (version selection only, per docs/BACKLOG.md) |
| test25 | before 2025 | 2025 (255) | yearly-refit check |
| final | before 2026 | none | the published tables |

Bootstrap intervals resample whole events (a card shares its judges and referees), 2,000 draws.

### 3.1 Judge-effect shrinkage (tuning)

Exact-card log-likelihood per fight on the tuning folds (higher is better), every model with closeness:

| Model | tune22: fit < 2022, score 2022-23 (485) | tune: fit < 2019, score 2019-23 (1,243) |
|---|---|---|
| league judge (no judge effects, no home) | -4.2026 | **-4.2689** |
| + home | -4.1947 | -4.2706 |
| + home + named judges, tau x 0.5 | **-4.1920** | -4.2732 |
| + home + named judges, tau x 1 (empirical Bayes) | -4.2000 | -4.2878 |
| + home + named judges, tau x 2 | -4.2310 | -4.3257 |

The primary fold (two-year horizon, which is how the tables will be used with yearly refits) picks named judges
with half the empirical-Bayes sd (tau x 0.5): tau = n 0.075, v 0.074, p 0.125, g 0.098, c 0.201. On the five-year
fold neither judges nor home help: judge effects estimated before 2019 carry little into 2019-2023, when most of
the panel was new or rarely seen before. Wider judge spreads (x2) lose on every fold. (Verification: the original
selection code left the league judge without home out of the candidate list, so the home term was never put to the
tuning folds; it is a candidate now and the pick is unchanged. The card log-likelihood gain of named judges on the
primary fold is +0.0026 [-0.0081, +0.0135] over league + home, and on decision metrics they lose on both tuning
folds, see the verification log.)

### 3.2 Structure: shared-noise shape (league + home, no named judges)

| Variant | 2022-23 (tuning) card LL vs base | 2024-25 (held-out) card LL vs base | 2024-25 winner LL | 2024-25 round unanimity pred / obs |
|---|---|---|---|---|
| base (logistic own noise, constant shared sd) | -4.2080 | -3.8879 | 0.3392 | 0.759 / 0.790 |
| probit own noise | +0.0009 [-0.0051, +0.0061] | -0.0141 [-0.0396, +0.0021] | 0.3390 | 0.759 / 0.790 |
| **closeness (shared sd depends on the stat edge)** | **+0.0133 [+0.0020, +0.0275]** | **+0.0083 [+0.0001, +0.0176]** | 0.3383 | 0.763 / 0.790 |
| fight-level shared noise | +0.0084 [-0.0223, +0.0398] | -0.0020 [-0.0314, +0.0284] | 0.3435 | 0.760 / 0.790 |
| closeness + fight-level | +0.0170 [-0.0147, +0.0492] | -0.0001 [-0.0292, +0.0305] | 0.3433 | 0.761 / 0.790 |
| probit + closeness | +0.0162 [+0.0021, +0.0336] | +0.0032 [-0.0186, +0.0224] | 0.3378 | 0.764 / 0.790 |

The best tuning-fold point estimate (closeness + fight-level noise) did not hold on 2024-25; closeness alone
helped on both windows with intervals above zero, and is a one-parameter change, so it was adopted (version
selection on 2024-25 is what the protocol allows). Fight-level noise (sd 1.28 when fit before 2022) improved the
2022-23 decision winner a lot (0.3745 to 0.3659) but worsened 2024-25 (0.3392 to 0.3435): it stays a knob, off by
default. Refitting the full model with closeness: card log-likelihood +0.0129 [+0.0033, +0.0233] per fight on
2024-25 (judges + home, tau x 0.5), with small gains on every decision metric (winner -0.0013, 7-class -0.0018,
split -0.0010, all intervals touching zero).

Fitted kappa = -0.037 (final fit): the shared sd is 2.08 in an even round, 2.50 for a one-knockdown edge, 3.1 for a
+20 strike, one-knockdown round. Lopsided rounds go to the trailing fighter more often than a constant-noise model
allows (ufcstats counts are an imperfect proxy for what judges see), though still rarely (P = 0.001 for that
+20 round).

### 3.3 Held-out decisions, 2024-25

534 decisions (531 not drawn), every model fit on decisions before 2024 and frozen. Card LL = exact log-likelihood
of the three observed cards; the other columns are from 8,000 simulated panels per fight given the real round
stats. Split = split or majority vs unanimous.

| Model | Card LL / fight | Winner LL | Winner Brier | Winner acc. | 7-class LL | Split LL | Split pred / obs | Cards with a 10-8 pred / obs |
|---|---|---|---|---|---|---|---|---|
| Independent judges (no shared noise) | -4.4302 | 0.3539 | 0.1117 | 85.3% | 0.9464 | 0.5444 | 0.374 / 0.200 | 0.097 / 0.055 |
| League judge | -3.8944 | 0.3414 | 0.1106 | 85.3% | 0.8055 | 0.4495 | 0.263 / 0.200 | 0.089 / 0.055 |
| League + home | -3.8796 | 0.3383 | 0.1095 | 85.5% | 0.7950 | 0.4429 | 0.261 / 0.200 | 0.089 / 0.055 |
| Named judges, no home | -3.8819 | 0.3417 | 0.1106 | 85.1% | 0.8038 | 0.4475 | 0.258 / 0.200 | 0.088 / 0.055 |
| **Named judges + home (published)** | **-3.8672** | 0.3387 | 0.1095 | 85.3% | 0.7930 | **0.4409** | 0.256 / 0.200 | 0.088 / 0.055 |
| Engine default after verification (published parameters, judge effects 0) | n/a | 0.3368 | | | 0.7933 | 0.4435 | 0.264 / 0.200 | |
| Engine v3 rule (params3.js, same stats) | n/a | 0.3322 | 0.1067 | 85.1% | 0.7872 | 0.4456 | 0.255 / 0.200 | 0.094 / 0.055 |

| Paired difference (2024-25) | Card LL / fight | Winner LL | 7-class LL | Split LL |
|---|---|---|---|---|
| shared noise (league - independent) | +0.536 [+0.445, +0.629] | -0.0125 [-0.0268, +0.0014] | -0.1409 [-0.1825, -0.0971] | -0.0949 [-0.1230, -0.0669] |
| home (league + home - league) | +0.0149 [+0.0049, +0.0264] | -0.0030 [-0.0089, +0.0020] | -0.0105 [-0.0182, -0.0039] | |
| named judges (judges + home - league + home) | +0.0124 [+0.0003, +0.0245] | +0.0003 [-0.0009, +0.0017] | -0.0020 [-0.0045, +0.0004] | -0.0020 [-0.0040, -0.0001] |
| named judges without home (judges - league) | +0.0126 [+0.0004, +0.0247] | +0.0004 [-0.0010, +0.0017] | -0.0018 [-0.0042, +0.0006] | -0.0020 [-0.0038, +0.0000] |
| all officials terms (judges + home - league) | +0.0273 [+0.0117, +0.0435] | -0.0027 [-0.0083, +0.0022] | -0.0125 [-0.0203, -0.0056] | -0.0086 [-0.0130, -0.0046] |
| published - engine v3 rule | | +0.0065 [-0.0042, +0.0168] | +0.0058 [-0.0097, +0.0204] | |

**Round level** (5,064 judge-rounds with observed scores): 5-outcome log loss 0.4593 published vs 0.4627 league
(-0.0034 [-0.0056, -0.0015]) vs 0.4733 engine v3 rule; round-winner accuracy 82.7-82.9% for all; P(10-8 | win)
predicted 0.030 vs 0.0196 observed.

**Yearly refit** (2024 scored by the fit before 2024, 2025 by the fit before 2025): card LL -3.8515 published vs
-3.8788 league (+0.0273 [+0.0109, +0.0446]); winner LL 0.3368 vs 0.3397; 7-class 0.7897 vs 0.8024. Refitting
yearly is worth about 0.016 per fight in card LL over the frozen fit.

**By year** (published model, frozen fit): 2024 card LL -3.925 vs -3.956 league, split predicted 0.247 vs 0.244
observed; 2025 card LL -3.804 vs -3.827, split predicted 0.266 vs 0.153 observed.

**Calibration of the decision winner** (2024-25, bins of width 0.1 in predicted P(A wins)): 116 decisions at 2.3%
predicted, 3.4% observed; 162 at 97.1% predicted, 98.1% observed; the middle bins are noisy (n = 23-48 each). A
logit-logit calibration slope is 0.92 on 2024-25 and 0.73 on 2022-23 (engine v3 rule: 1.02 and 0.82): the model
is somewhat overconfident about the decision winner in 2022-23 and close to calibrated in 2024-25. The fight-level
noise knob is the lever for that if it shows up again.

The tuning-fold numbers for the published model (2019-23, fit before 2019): card LL -4.2732, winner LL 0.3570,
7-class 0.9149, split 0.4667 (league judge -4.2689, 0.3549, 0.9106, 0.4664).

### 3.4 League judging parameters (final fit, all decisions before 2026)

| Term | beta (SE) | Head-strike units, 2017 | Head-strike units, 2025 |
|---|---|---|---|
| head landed | 0.3176 (0.0074) | 1 | 1 |
| body landed | 0.2398 (0.0090) | 0.75 | 0.75 |
| leg landed | 0.1866 (0.0081) | 0.59 | 0.59 |
| knockdown | 3.087 (0.203) | 9.7 | 17.1 |
| takedown landed | 0.4067 (0.0346) | 1.28 | 1.42 |
| control, per minute | 0.9409 (0.0287) | 2.96 | 3.28 |
| submission attempt | 1.2455 (0.0663) | 3.92 | 4.34 |
| reversal | 0.329 (0.105) | 1.04 | 1.15 |

Era trends per decade (t = (year - 2017)/10, each group weight x exp(w t)): volume w_V = -0.124 (SE 0.033),
knockdown w_K = +0.582 (SE 0.123), grappling w_G = +0.004 (SE 0.036). Shared noise sigma_u = 2.081 (log-SE 0.021),
kappa = -0.0373. Home: h_abroad = +0.733 (SE 0.092), h_USA = -0.159 (SE 0.066). 10-10: 0.115% of judge-rounds.
10-8 model: c0 = -8.992 (SE 0.30), theta V 0.514 (0.024), K 0.604 (0.064), G 0.804 (0.038), u 0.713 (0.039); year
levels c_year: 2015 +0.03, 2016 +0.53, 2017 +0.96, 2018 +1.07, 2019 +1.11, 2020 +0.91, 2021 +0.43, 2022 +0.05,
2023 -0.05, 2024 -0.45, 2025 -0.56 (random walk, step sd 0.3).

Round-win probability for a league judge in 2025 (shared noise integrated): +5 head strikes 0.70; +10 significant
strikes (6 head, 2 body, 2 leg) 0.81; one knockdown, nothing else 0.95; one takedown plus 2 minutes of control
0.79; 3 minutes of control 0.84; one submission attempt 0.67. These are consistent with the EM round-winner fit in
research/data_baserates.md (head-strike units there: body 0.74, leg 0.59, KD 13.5, TD 1.6, control 2.6/min, sub 4.7),
which pooled eras and had no shared noise.

### 3.5 Region and home

The home term is the only location effect with held-out support. Regional judge pools differ little in the judge
effects (share-weighted mean power index +0.01 in Nevada and +0.02 in other US states, +0.11-0.13 in the
Middle East, Europe, Asia and Brazil, all well inside one judge sd). Observed 10-8 rates since 2022 do differ by region:
3.2% of judge-rounds in Nevada, 2.1% in other US states, 7.2% in Brazil (63 cards), 0-1.3% in Asia, Europe,
Latin America and the Middle East, which the per-judge 10-8 effects (c) and the pools carry.

Caveats: nationality is from Wikidata and covers 80% of fighter names; a fighter with a missing nationality counts
as not home. The US coefficient compares Americans with foreigners at US events, where the foreigners in the
Wikidata subset may be the better-known ones; treat h_USA as small and uncertain.

### 3.6 10-8 rounds and deductions

Observed 10-8s per judge-round: 5.9% (2019), 6.0% (2020), 4.0% (2021), 3.1% (2022), 3.6% (2023), 2.2% (2024),
1.7% (2025). The random-walk year level forecasts the last level, so 2024-25 got 2023's level and over-predicted
(cards with a 10-8: 8.8% predicted vs 5.5% observed). A damped linear trend, cy[T+h] = cy[T] + d h (cy[T] -
cy[T-k])/k, tuned on 2022-23 (d = 0.75, k = 1: +0.0096 [-0.0034, +0.0215] there) lost on 2024-25 (-0.0033
[-0.0044, -0.0021]) because the 2022-to-2023 step pointed up. Not shipped: the engine uses c_2025 = -0.560 for
2026 fights.

Deductions: latent deductions are found reliably from totals alone. Hiding the 81 known deductions among 2,978
decisions, the posterior P(deduction) has AUC 0.992; 88% of the top-81 posteriors are true deductions; the side is
right in 81% of cases. Observed deductions per decision (MMA Decisions raw vs published): 2.6% on average since
2019 (1.1% in 2024, 2.0% in 2025).

### 3.7 Individual judges

Judges with 30 or more cards since 2022, ordered by power index. Multipliers are exp(effect) with the posterior
sd of the effect (log scale) in brackets. Power index = logit P(a round goes to the fighter with +1 knockdown and
+3 head strikes over the fighter with +1 takedown and 2.5 minutes of control) minus the league judge's (league
P = 0.887); P(damage round) is that probability for the judge. Round dissent = share of rounds where the other two
judges agreed and this judge did not (observed round scores).

| Judge | Cards (since 2022) | Years | KD weight | Volume | Grappling | Sharpness | 10-8 odds | Power index | P(damage round) | Round dissent |
|---|---|---|---|---|---|---|---|---|---|---|
| Sal D'Amato | 1090 (407) | 2007-2025 | 1.15 (0.08) | 1.05 (0.03) | 1.02 (0.04) | 1.08 (0.05) | 1.09 (0.12) | +0.63 (0.39) | 0.937 | 7.5% of 2,770 |
| Mark Collett | 171 (31) | 2011-2025 | 1.08 (0.12) | 1.08 (0.05) | 1.04 (0.07) | 1.04 (0.07) | 0.97 (0.18) | +0.32 (0.51) | 0.915 | 8.6% of 408 |
| Vito Paolillo | 59 (42) | 2020-2025 | 1.03 (0.12) | 1.04 (0.07) | 0.92 (0.08) | 1.01 (0.07) | 1.01 (0.19) | +0.27 (0.51) | 0.911 | 9.0% of 155 |
| Anders Ohlsson | 86 (38) | 2017-2025 | 1.02 (0.12) | 1.06 (0.07) | 0.93 (0.08) | 1.02 (0.07) | 1.03 (0.19) | +0.24 (0.51) | 0.909 | 8.6% of 221 |
| Michael Bell | 512 (288) | 2013-2025 | 1.03 (0.11) | 1.02 (0.04) | 1.02 (0.05) | 1.11 (0.06) | 1.19 (0.14) | +0.17 (0.47) | 0.903 | 6.6% of 1,388 |
| David Lethaby | 177 (112) | 2018-2025 | 1.03 (0.12) | 1.10 (0.05) | 1.00 (0.07) | 0.98 (0.07) | 1.23 (0.17) | +0.15 (0.47) | 0.901 | 10.4% of 482 |
| Ben Cartlidge | 254 (125) | 2013-2025 | 1.02 (0.11) | 1.02 (0.05) | 1.01 (0.06) | 1.05 (0.07) | 1.18 (0.17) | +0.12 (0.44) | 0.898 | 7.7% of 673 |
| Clemens Werner | 121 (77) | 2016-2025 | 1.03 (0.12) | 1.05 (0.06) | 1.07 (0.08) | 1.07 (0.07) | 0.91 (0.19) | +0.06 (0.52) | 0.892 | 6.1% of 326 |
| Bryan Miner | 67 (34) | 2010-2025 | 1.00 (0.12) | 1.04 (0.07) | 0.99 (0.08) | 1.02 (0.07) | 0.89 (0.19) | +0.06 (0.51) | 0.892 | 6.5% of 169 |
| Darryl Ransom | 45 (33) | 2020-2025 | 0.98 (0.12) | 1.03 (0.07) | 0.98 (0.09) | 1.04 (0.07) | 1.04 (0.20) | +0.02 (0.49) | 0.888 | 3.5% of 115 |
| Tony Weeks | 396 (70) | 2001-2025 | 0.97 (0.12) | 1.07 (0.04) | 0.97 (0.06) | 1.04 (0.06) | 1.10 (0.15) | +0.02 (0.43) | 0.888 | 7.2% of 838 |
| Anthony Maness | 54 (39) | 2012-2025 | 0.99 (0.12) | 0.97 (0.07) | 0.96 (0.09) | 0.97 (0.07) | 0.94 (0.20) | -0.03 (0.47) | 0.884 | 13.9% of 144 |
| Dave Tirelli | 150 (38) | 2010-2025 | 1.03 (0.12) | 0.95 (0.05) | 1.07 (0.08) | 0.98 (0.07) | 0.93 (0.17) | -0.05 (0.46) | 0.881 | 10.2% of 392 |
| Ron McCarthy | 243 (139) | 2015-2025 | 1.02 (0.11) | 0.98 (0.05) | 1.12 (0.07) | 1.07 (0.07) | 0.95 (0.17) | -0.10 (0.43) | 0.877 | 6.3% of 653 |
| Junichiro Kamijo | 446 (201) | 2010-2025 | 1.01 (0.10) | 0.99 (0.04) | 1.10 (0.06) | 1.08 (0.06) | 1.00 (0.15) | -0.11 (0.41) | 0.875 | 7.0% of 1,195 |
| Douglas Crosby | 279 (41) | 2001-2022 | 1.00 (0.12) | 1.01 (0.05) | 1.08 (0.06) | 1.01 (0.07) | 1.44 (0.13) | -0.12 (0.43) | 0.874 | 8.1% of 456 |
| Eric Colón | 375 (179) | 2007-2025 | 0.98 (0.11) | 1.03 (0.04) | 1.04 (0.06) | 1.00 (0.06) | 1.01 (0.15) | -0.14 (0.39) | 0.872 | 9.1% of 978 |
| Derek Cleary | 676 (240) | 2012-2025 | 0.99 (0.09) | 0.95 (0.04) | 1.10 (0.05) | 1.05 (0.06) | 1.27 (0.13) | -0.20 (0.33) | 0.865 | 8.8% of 1,805 |
| Jacob Montalvo | 38 (34) | 2014-2025 | 0.93 (0.11) | 0.98 (0.07) | 1.04 (0.09) | 0.99 (0.07) | 0.92 (0.20) | -0.32 (0.43) | 0.851 | 9.0% of 100 |
| Chris Lee | 673 (226) | 2006-2025 | 0.83 (0.10) | 0.97 (0.04) | 0.91 (0.05) | 1.04 (0.06) | 1.07 (0.13) | -0.44 (0.28) | 0.835 | 8.2% of 1,576 |
| Adalaide Byrd | 259 (97) | 2006-2025 | 0.86 (0.11) | 1.00 (0.05) | 1.01 (0.07) | 0.98 (0.07) | 1.04 (0.17) | -0.51 (0.34) | 0.825 | 9.9% of 557 |

Reading it: no judge's power index is two posterior sds from the league; the clearest single effects are Chris
Lee's knockdown weight (x0.83, 1.8 sds low), D'Amato's (x1.15, 1.7 sds high), Douglas Crosby's and Derek Cleary's
10-8 propensity (odds x1.44 and x1.27), Derek Cleary, Junichiro Kamijo and Ron McCarthy leaning to grappling
(x1.10-1.12), and Michael Bell being the most decisive (sharpness x1.11). The table for all 452 judges is in
`officials.json` (`judging.judges`), with empirical dissent, observed 10-8 rates and regions.

### 3.8 Panel agreement in 2025

| Year | Decisions | Round unanimity pred / obs | Split or majority pred / obs |
|---|---|---|---|
| 2024 (fit before 2024) | 279 | 0.775 / 0.772 | 0.247 / 0.244 |
| 2025 (fit before 2024) | 255 | 0.763 / 0.808 | 0.266 / 0.153 |

Round unanimity in earlier years: 0.79, 0.79, 0.80, 0.78, 0.78 (2019-2023). With the final fit, adding 0.21 to every
judge's sharpness reproduces 2025's round unanimity (0.807); matching 2025's split rate would need more than 0.6,
which over-shoots the round agreement (0.87), so part of 2025's low split rate is chance or fight mix rather than
judges. The engine keeps 0 as default and exposes `knobs.panel_sharpness_shift`.

## 4. Referees

| Unit | Rows / events | League rate, 2019 on | tau (EB, all data) | tau (tuned 2019-23) | 2024-25 loss change, EB tau fit before 2024 | 2024-25 loss change, tuned tau |
|---|---|---|---|---|---|---|
| kd_finish: KD scorer finishes that round | 3,255 / 1,792 | 0.565 | 0.05 | 0.2 | +0.0009 [-0.0004, +0.0023] | +0.0024 [-0.0006, +0.0054] |
| kd_single: stopped on the knockdown blow | 1,792 / 1,250 | 0.687 | 0.1 | 0.4 | -0.0004 [-0.0009, +0.0001] | -0.0057 [-0.0159, +0.0049] |
| kd_follow: follow-up ground strikes | 1,792 / 7,839 strikes | 4.44 per finish | 0.05 | 0.3 | -0.0014 [-0.0078, +0.0048] | -0.0154 [-0.0876, +0.0532] |
| stand_tko: standing TKO without KD | 34,444 / 171 | 0.00033 per landed standing strike | 0.05 | 0.6 | +0.00001 [-0.00000, +0.00002] | +0.0005 [+0.00002, +0.0011] |
| gnp_tko: ground-and-pound stoppage | 11,261 / 543 | 0.0080 per landed ground strike | 0.05 | 0.3 | -0.0001 [-0.0002, -0.0000] | -0.0016 [-0.0029, -0.0003] |
| any_ko: fight ends by KO/TKO | 8,227 / 2,509 | 0.298 | 0.05 | 0 | +0.0002 [-0.0002, +0.0005] | 0 |
| doctor stoppage | 8,227 / 85 | 0.0073 | 0.05 | 0.15 | +0.0003 [-0.0003, +0.0010] | +0.0001 [-0.0001, +0.0003] |
| DQ | 8,227 / 22 | 0.0017 | 0.8 | 0.8 | -0.0009 [-0.0028, +0.0002] | -0.0009 [-0.0028, +0.0002] |
| point deduction (per decision) | 2,975 / 67 | 0.026 | 0.05 | | | |

Loss = mean log loss (binomial) or Poisson deviance per unit, yearly refits; negative = the referee effects
helped. The EB column of the held-out check uses the Laplace tau fit on data before 2024 (0.1, 0.05, 0.05, 0.05,
0.05, 0.05, 0.3, 0.8 in table order), so it is a walk-forward number too. The data support at most small referee differences: the overall KO/TKO rate shows none (tuned tau 0), and
the per-referee spreads that 2019-2023 tuning liked do not carry to 2024-25 except for ground-and-pound stoppages.
Fixed effects worth knowing (logit scale, kd_finish): a second knockdown in the round +0.80, the other fighter also
scored a knockdown -1.21, title fights -0.36, heavyweights/light heavyweights +0.65, women -0.43, later rounds
-0.09 per round.

Most active referees since 2019: lighter-shrinkage multiplier (sd of the log effect) / empirical-Bayes multiplier.

| Referee | Fights (2019 on) | KD finish odds | Stop on the KD blow odds | Follow-up strikes | Standing TKO rate | GNP TKO rate | Doctor odds | Deduction odds (EB) |
|---|---|---|---|---|---|---|---|---|
| Herb Dean | 1196 (492) | 1.07 (0.10) / 1.02 | 0.85 (0.15) / 0.96 | 0.98 (0.09) / 0.98 | 1.14 (0.22) / 1.01 | 1.01 (0.12) / 1.00 | 0.97 (0.13) / 1.00 | 1.01 |
| Mark Smith | 461 (398) | 1.07 (0.13) / 1.01 | 0.68 (0.20) / 0.92 | 1.06 (0.13) / 1.00 | 1.01 (0.30) / 1.00 | 1.29 (0.16) / 1.02 | 0.99 (0.15) / 1.00 | 1.00 |
| Jason Herzog | 433 (358) | 0.89 (0.13) / 0.98 | 0.96 (0.21) / 1.00 | 1.07 (0.13) / 1.01 | 1.47 (0.27) / 1.01 | 0.86 (0.19) / 0.99 | 1.01 (0.15) / 1.00 | 1.00 |
| Chris Tognoni | 436 (350) | 0.99 (0.14) / 1.00 | 0.95 (0.22) / 1.00 | 1.13 (0.14) / 1.01 | 1.38 (0.29) / 1.01 | 1.34 (0.17) / 1.02 | 0.98 (0.15) / 1.00 | 1.01 |
| Marc Goddard | 574 (323) | 0.93 (0.12) / 0.99 | 0.80 (0.19) / 0.95 | 1.10 (0.11) / 1.01 | 0.96 (0.28) / 1.00 | 0.97 (0.16) / 0.99 | 0.93 (0.14) / 0.99 | 1.00 |
| Keith Peterson | 387 (269) | 1.09 (0.14) / 1.01 | 1.30 (0.23) / 1.06 | 1.02 (0.14) / 1.00 | 0.84 (0.34) / 0.99 | 1.14 (0.18) / 1.01 | 1.02 (0.15) / 1.00 | 0.99 |
| Dan Miragliotta | 498 (171) | 1.01 (0.12) / 1.00 | 0.93 (0.19) / 0.99 | 1.09 (0.11) / 1.01 | 0.88 (0.32) / 0.99 | 1.06 (0.16) / 1.01 | 1.06 (0.14) / 1.01 | 0.99 |
| Mike Beltran | 186 (158) | 1.02 (0.16) / 1.00 | 1.10 (0.27) / 1.02 | 1.33 (0.16) / 1.03 | 0.71 (0.42) / 0.99 | 1.06 (0.22) / 1.00 | 0.97 (0.15) / 1.00 | 1.00 |
| Kerry Hatley | 141 (96) | 1.01 (0.17) / 1.00 | 1.02 (0.29) / 1.00 | 0.90 (0.20) / 0.99 | 1.23 (0.41) / 1.00 | 1.09 (0.23) / 1.00 | 1.00 (0.15) / 1.00 | 1.00 |

Style reading (lighter shrinkage, about 1.5-2 sds at most, not predictive on 2024-25): Mark Smith lets knockdowns
play on (stop-on-the-blow odds x0.68) and then stops ground-and-pound sooner (x1.29); Keith Peterson stops on the
blow more (x1.30); Jason Herzog and Chris Tognoni stop standing fighters without a knockdown more (x1.47, x1.38);
Mike Beltran allows the most follow-up (x1.33). Five referees worked 54% of UFC fights in 2019-2025 (nine worked
74%), so most referee rows are thin and the spreads are hard to separate from event and era.

## 5. Recommendation for the engine (v8)

### 5.1 Judging: replace `judgeRound` with this model

All values are in `officials.json` under `engine` (fit on every decision before 2026). Per fight: build the
panel (5.3), get t = (year - 2017)/10 (0.9 for 2026), and the home term home = [A from the event country] - [B
from it] with h = +0.733 abroad and -0.159 at US events (knob `home_effect` multiplies h). Per round, from the
simulated A - B differentials:

```
V     = 0.3176*dHeadLanded + 0.2398*dBodyLanded + 0.1866*dLegLanded
K     = 3.0866*dKD
G     = 0.4067*dTDLanded + 0.9409*dCtrlSec/60 + 1.2455*dSubAtt + 0.3289*dRev     (dRev = 0 if not simulated)
core0 = exp(-0.1235*t)*V + exp(0.5820*t)*K + exp(0.0035*t)*G
s     = 2.0814 * exp(0.0373*|core0|)                 # shared-noise sd (kappa = -0.0373)
u     = s * N(0,1)                                    # one draw per round, shared by the three judges
                                                      # (+ one fight-level N(0, sv^2) draw if knob sv > 0)
for each judge j with effects (n, v, p, g, c)            # default (named_judges off): n = v = p = g = c = 0
  core_j = exp(v - 0.1235*t)*V + exp(p + 0.5820*t)*K + exp(g + 0.0035*t)*G + h*home
  if U < 0.00115: the card is 10-10 for this round
  else A wins iff exp(n + shift) * (core_j + u) + logit(U') > 0      # shift = knob panel_sharpness_shift, default 0
       winner W's edge (V_W, K_W, G_W, u_W) = (V, K, G, u) if A won, else their negatives
       10-8 with P = sigmoid(-8.9923 + c_year + c + 0.5145*V_W + 0.6041*K_W + 0.8041*G_W + 0.7131*u_W)
       c_year = -0.5596 for 2025-2026 fights (engine.ten_eight.c_by_year for past eras)
```

Totals subtract point deductions (5.2); the decision follows the three card totals (UD, SD, MD, draw). The engine's
hurt and power-damage terms have no counterpart in ufcstats, so the data-fit weights already price the average
damage per landed strike; give `hurt` weight 0 by default and keep it as a labeled knob. The 2024-25 checks above
were made with real stats; the simulator also needs its simulated per-round strike and control totals to match
real ones (other components) for these probabilities to carry over.

### 5.2 Referees and stoppages

- Use the league rates as the engine's targets, not per-referee multipliers: P(scorer's KO/TKO in the knockdown
  round) 0.565, P(stopped on the knockdown blow | knockdown-round KO) 0.687, follow-up ground strikes 4.44 per
  knockdown-round KO (quasi-Poisson, dispersion 6.9), standing TKO without a knockdown 0.00033 per landed standing
  significant strike, ground-and-pound stoppage 0.0080 per landed ground significant strike, doctor stoppage 0.0073
  per fight, DQ 0.0017 per fight, point deduction 0.026 per decision (one point, split evenly between the
  fighters). The fixed effects in `referees.units.*.fixed_effects` give the division, round, title and
  five-round adjustments.
- For a named referee, multiply each hazard (or odds) by `engine.referees_eb[name]` (columns `referee_cols`); every
  multiplier is within a few percent of 1 except DQ, so this is cosmetic. `engine.referees_tuned` is the
  lighter-shrinkage style table for the knob only.

### 5.3 Sampling officials

- Default (`engine.named_judges_default` = false, verification log): every judge is the league judge, effects 0,
  for named and unknown officials alike. This is the configuration that validated best on decision outcomes.
- Assigned officials, only with the `named_judges` knob on (scenario use): look up `engine.judges[key]` (MMA
  Decisions judge id, columns `judge_cols`; posterior sds in `judges_sd`) and `engine.referees_eb[name]` (dq column:
  use 1.0, see the referee note). Use the posterior means; to propagate uncertainty, draw each judge's effects once
  per simulated fight from N(mean, sd^2).
- Unknown officials: take the event region (`region_of(location)`: Nevada, USA (other states), Canada, Brazil,
  Latin America, UK and Ireland, Europe, Middle East, Asia, Australia and NZ), draw three distinct judges from
  `engine.judge_pools[region]` by share (2022-2025 cards), and a referee from `engine.referee_pools[region]`.
  `_other` (a judge not in the table) and unknown names: draw (n, v, p, g, c) from N(0, tau^2) with tau = (0.0752,
  0.0740, 0.1250, 0.0978, 0.2014).
- With the knob on, judging taste spread comes from the judge effects, which replaces the engine's lognormal
  `tasteSd` 0.2 (the data say about 0.07-0.12 per weight after shrinkage). With the default (knob off) set `tasteSd`
  to 0: the shared and own noise of the published fit already carry the panel's disagreement.

### 5.4 Expected effect on the engine's checks

On real 2024-25 round stats, the published model gives split/majority 25.6% (observed 20.0%), cards with a 10-8
8.8% with the 2023 level (5.5% observed; the 2025 level brings the rate down to the 2025 data), and 7-class
decision log loss 0.793. The engine default (named judges off) gives split/majority 26.4%, 7-class 0.7933 and
decision-winner log loss 0.3368 (published 0.3387). The roadmap's v8 check (decision-split and scorecard calibration) should be run on the
simulator's own fights once the judging block is swapped in: target split/majority 18-24% (15% in 2025), round
unanimity 0.77-0.81, 10-8 rounds about 2% of judge-rounds (2024-25), 10-10 0.1%.

## 6. Caveats and open threads

- Who wins a decision is mostly set by the round stats; officials explain about 0.003 of winner log loss (not
  significant) and 0.0125 of 7-class decision log loss. For the blend's winner probability this component is
  close to neutral; its value is realistic scorecards, split rates, home bias and assigned-official scenarios.
- 2024-25 was used for version selection (closeness on, fight-level noise off, damped 10-8 trend off), as the
  protocol allows; the 2026 vault was not opened. The next independent check is the v10 vault audit.
- Judge effects are estimated mostly from post-2013 round-by-round cards; earlier judges and totals-only cards
  carry much less information. Judges new to the UFC get the prior (the five-year fold shows old judge estimates
  age badly; refit yearly).
- Nationality coverage is 80% (Wikidata); dual citizenships count as home in both countries. Event country is
  from ufcstats' location string. Wikidata coverage is higher for winners (verification log), but symmetrically for locals and visitors;
  with the 99.9%-coverage nationality of data/derived/fightweek.json the held-out home gain is slightly larger.
- Referee outcomes are proxies: ufcstats has no knockdown timestamps, so "time from knockdown to stoppage" is
  measured by whether the stoppage came on the knockdown blow (DETAILS singular strike) and by the follow-up ground
  strikes in that round.
- The engine-v3 comparison uses the params3.js judge block as it stood at 2:40 pm UTC (head 0.179 ... sharedSd 1.0,
  indSd 1.0, tasteSd 0.2, t108 6.0, t108kd 1.5); that file belongs to another agent and may change.
- Reproduce: `python3 tools/officials.py --stage all` (base folds, structure variants, closeness folds, post; about
  an hour on 4 cores), or `OFFICIALS_SUFFIX=_c python3 tools/officials.py --stage post` from the cached folds in
  `out/officials/` (about 6 minutes).


## Verification log

Adversarial review, Nov 6, 2026 (afternoon), by a separate agent that started from the assumption that the
analysis was wrong. What I did: re-scored the analyst's fold pickles with my own metric and bootstrap code; wrote
an independent re-implementation of the judge model and re-fit it on three walk-forward folds
(`tools/officials_verify.py`, summary `data/derived/officials_verify.json`, per-fight output in
`out/officials/verify/`); ran ablations of the published structure in the analyst's own simulator; fixed what was
wrong in `tools/officials.py` and reran its post stage. Folds: 2024-25 = fit before 2024 (validation); 2022-23 =
fit before 2022 and 2019-23 = fit before 2019 (tuning). Intervals are 95% event-cluster bootstraps; negative =
the first model is better for log losses.

### 1. Joins: held

- **Loser-first cards.** After mapping DETAILS to A and B, the three cards agree with the official result (winner
  and UD/SD/MD) in 3,871 of 3,876 decisions. The 5 exceptions are source errors, not mapping errors: Demopoulos vs
  Frey 2022 (DETAILS 29-29, 28-28, 30-27 for a split decision), Cummins vs Blachowicz 2017 (a 28-28 card in a
  "unanimous" decision), Trinaldo vs Parke 2015, Cariaso vs Smolka 2014, Thomson vs Franca 2004. None is in 2024-25.
- **Round scores.** The round-by-round codes reproduce the card totals on 9,763 of 9,772 observed cards. The 9 misses
  are deductions missing from fights marked deduction-free; only those cards are affected.
- **Fighter order.** A is the first-named fighter and wins 61.7% of non-drawn decisions, so the listing carries
  information. The model is antisymmetric with no intercept, so it cannot learn the listing. The 55 draws allow
  both orientations. NCs are excluded by the category filter. fightweek.json's A/B order matches ufcstats in all
  3,270 matched decisions (8 are spelling variants).
- **Metrics.** The published held-out numbers recompute exactly from the pickles (7-class 0.7930 vs 0.8055, -0.0125
  [-0.0204, -0.0056]; card LL +0.0273 [+0.0109, +0.0433]).

### 2. Leakage and selection: none that moves the results

- **Fold boundaries.** Each fold fits only on decisions dated before its first scored year (3,335 before 2024).
  The judge index comes from training only. The 10-8 year level is capped at the last training year, and the era
  trend is extrapolated. No 2026 row is loaded.
- **Nationality.** It is a 2026 snapshot, and Wikidata coverage depends on outcomes: fighters who won the decision
  are listed more often (local fighters abroad 94% vs 89%, visitors 94% vs 85%), because listing follows later
  fame. The bias hits locals and visitors about equally. With fightweek.json's nationality (99.9% coverage
  2012-2025), the raw home decision win rate abroad is 60.8% (541 decisions, vs 59.6% of 441 with Wikidata), and
  the re-fit home gain on 2024-25 grows to -0.0127 [-0.0223, -0.0041]. Selection does not create the home effect.
- **Panel knowledge.** Held-out scores condition on the actual three judges. Commissions often name them only
  days before the fight, or on fight night, so named-judge gains are an upper bound for pre-fight use (moot, see 4).
- **Deduction check.** The deduction check (AUC 0.992) uses the final fit, which saw those decisions. The deduction
  prior is estimated only from fights where the deduction is latent, so the check is close to out-of-sample but
  not strictly so.
- **Test-set reuse.** 2024-25 was used to adopt closeness and to reject fight-level noise and the 10-8 trend. The
  protocol allows version selection on 2024-25, and the headline does not depend on it. On the base folds without
  closeness, judges + home vs league is 7-class -0.0130 [-0.0208, -0.0061], and home alone -0.0108 [-0.0185,
  -0.0040].

### 3. Headline with fresh code: replicated

The fresh code has its own likelihood, fit on cards with observed round scores only (12-node Gauss-Hermite shared
noise with the closeness sd), its own 10-8 GLM (winner-oriented stats, random-walk year levels, judge
intercepts), its own simulator (20,000 panels per fight), its own metrics and event-cluster sandwich SEs.

| 2024-25 (534 decisions) | Analyst 7-class | Fresh 7-class | Analyst winner LL | Fresh winner LL |
|---|---|---|---|---|
| League judge | 0.8055 | 0.8039 | 0.3414 | 0.3338 |
| League + home | 0.7950 | 0.7932 | 0.3383 | 0.3309 |
| Named judges + home | 0.7930 | 0.7919 | 0.3387 | 0.3313 |
| All officials terms vs league | -0.0125 [-0.0204, -0.0056] | -0.0120 [-0.0200, -0.0048] | -0.0027 [-0.0083, +0.0024] | -0.0024 [-0.0084, +0.0029] |
| Home vs league | -0.0105 [-0.0182, -0.0037] | -0.0107 [-0.0185, -0.0038] | -0.0030 [-0.0087, +0.0021] | -0.0029 [-0.0087, +0.0025] |

h_abroad comes out at 0.685 in the fresh fit vs 0.688 in the analyst's fit (both fit before 2024). The fresh
model's decision-winner loss is lower on 2024-25 (paired vs the analyst's model with judges off, -0.0060 [-0.0093,
-0.0024]) but not on 2022-23 (-0.0010 [-0.0086, +0.0067]). Its calibration slope is the same (0.94 on 2024-25,
0.74 on 2022-23). That is not enough to switch models.

### 4. Named-judge effects make decision predictions worse: fixed

These are the analyst's own simulator and parameters (judges + home, tau x 0.5), with every judge effect set to 0
("named off") or as published (`officials.json` `judging.verification`).

| Published - named off | Winner LL | 7-class LL | Split LL |
|---|---|---|---|
| 2024-25 | +0.0019 [+0.0003, +0.0035] | -0.0003 [-0.0033, +0.0029] | -0.0026 [-0.0051, -0.0000] |
| 2022-23 | +0.0036 [+0.0006, +0.0077] | +0.0024 [-0.0009, +0.0058] | +0.0020 [-0.0003, +0.0048] |
| 2019-23 | +0.0015 [+0.0003, +0.0028] | +0.0018 [-0.0002, +0.0038] | -0.0000 [-0.0011, +0.0011] |

The fresh re-fit agrees (named judges vs none, winner / 7-class): 2024-25 +0.0004 [-0.0009, +0.0019] / -0.0012
[-0.0036, +0.0012]; 2022-23 +0.0024 [-0.0000, +0.0051] / +0.0014 [-0.0018, +0.0046]; 2019-23 +0.0017 [+0.0002,
+0.0031] / +0.0004 [-0.0021, +0.0030]. The judge effects were adopted on a card log-likelihood gain of +0.0026
[-0.0081, +0.0135] on the tuning fold. No window shows a decision-level gain, the winner loss is worse in every
window, and only the 2024-25 split loss improves. The named-off model keeps the whole headline: -0.0122 [-0.0203,
-0.0053] 7-class vs the league judge, and -0.0017 [-0.0031, -0.0004] vs league + home.
**Fix:** `engine.named_judges_default = false` and `engine.knobs.named_judges` (default off, with the evidence).
Every judge is the league judge, using the same league parameters and `tasteSd` 0. The judge table stays as
description and for assigned-official scenarios. Sections 5.1, 5.3 and 5.4 are updated.

### 5. Home term: real, but the held-out gain depends on the window (kept, caveats added)

- **Estimate.** h_abroad is stable across fits: 0.70 (fit before 2019), 0.65 (before 2022), 0.69 (before 2024),
  0.73 (final). The fresh re-fits give 0.71, 0.65 and 0.69, with event-cluster SEs of 0.12-0.13.
- **Gain from the home terms** (named off; removing both terms, analyst / fresh):

  | Window | Analyst | Fresh |
  |---|---|---|
  | 2024-25 | -0.0108 [-0.0185, -0.0042] | -0.0107 [-0.0185, -0.0038] |
  | 2022-23 | -0.0057 [-0.0149, +0.0034] | -0.0045 [-0.0148, +0.0054] |
  | 2019-23 (fit before 2019) | +0.0012 [-0.0048, +0.0076] | +0.0004 [-0.0058, +0.0066] |

  The windows have little power. Decisions with a home fighter abroad numbered 10, 0 and 7 in 2020-2022 (closed
  and Apex events), 25 in 2023 and 40 in 2024-25.
- **h_USA changes sign** across fits: +0.07 before 2019, then -0.10, -0.14, -0.16 (fresh: -0.05, -0.21, -0.25).
  Dropping it changes 7-class loss by +0.0016 [-0.0000, +0.0034] on 2024-25, +0.0008 [-0.0014, +0.0030] on 2022-23
  and -0.0009 [-0.0023, +0.0005] on 2019-23. It stays in (validation leans that way) but is flagged unstable in
  the knob note.
- **Tuning list fixed.** `tuning_choice` had left the no-home league judge out of the candidate list, so the home
  term was never tested on a tuning fold. It is a candidate now, and the pick is unchanged.

### 6. Uncertainty: SEs somewhat too small

The Laplace SEs are conditional on the judge effects and are not clustered by event. In the fresh model, the
event-cluster sandwich SEs are 10-20% larger than the inverse-Hessian SEs (h_abroad 0.118 vs 0.106; w_K 0.216 vs
0.187, fit before 2024). Read the SEs in 3.4 as about 1.15 times larger. The bootstrap intervals of the held-out
metrics already resample events (84 events on 2024-25).

### 7. Referees: held, one caution

The league rates and the empirical-Bayes multipliers check out: all are within a few percent of 1 except DQ. DQ
rests on 22 events in all, its tau sits at the top of the grid (0.8), Mark Smith gets x3.70 from 5 DQs in 461
fights, and the 2024-25 check had 2 DQs (-0.0009 [-0.0028, +0.0002]). **Fix:** `engine.referee_note` now says to
use 1.0 for the dq multiplier unless a DQ scenario is wanted.

### 8. Fixes made and rerun

- `tools/officials.py`:
  - The league judge is now a tuning candidate (`judging.tuning.home_on_tuning_fold`).
  - New `verification_block` (the ablations in 4 and 5, all folds, written to `judging.verification`).
  - `engine.named_judges_default` and `engine.knobs.named_judges`, set by rule: on only if named effects beat zero
    effects on the 2024-25 7-class loss without hurting the winner loss on any fold.
  - Verification notes on `knobs.home_effect` and `referee_note`.
- **Rerun.** `OFFICIALS_SUFFIX=_c python3 tools/officials.py --stage post`, log at `out/officials_post_c_verify.log`.
  Every number already in `officials.json` reproduced exactly. The only changes are the additions above.
- **New tool.** `tools/officials_verify.py`, run as `<variants> <fold> all`, `--checks` and `--collect`. A smoke run
  of the repo copy reproduces the scratch fit (league, 2024-25: nll 8795.27, 7-class 0.8039).
- **This report.** Updated the bottom line, 3.1, the 3.3 table (engine-default row), 5.1, 5.3, 5.4 and the
  nationality caveat.

### 9. Corrected engine recommendation (changes only)

- **Judging.** Same equations and values as 5.1, but by default every judge has n = v = p = g = c = 0 and
  `tasteSd` is 0. Named effects only with `knobs.named_judges` on. On real 2024-25 stats this default gives
  decision-winner log loss 0.3368, 7-class 0.7933 and split/majority 26.4% predicted vs 20.0% observed.
- **Home.** h_abroad +0.733 and h_USA -0.159, as published. Treat h_USA as unstable; `home_effect` scales both.
- **Referees.** dq multiplier 1.0. The other multipliers are cosmetic, as the report says.

**Verdict.** The pipeline is sound: the joins are right, the walk-forward is clean, and the headline 7-class gain
reproduces with independent code. The gain is the home-abroad term, which is significant on 2024-25 but not on the
earlier windows. The claim that named judges add predictive value did not survive: they worsen the decision winner
in every window. They are now off by default.
