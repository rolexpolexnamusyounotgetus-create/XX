# Fight dynamics: round-level model (engine v6 component)

Tool: `tools/dynamics.py` (run `python3 tools/dynamics.py`, about 15 minutes on an idle machine and much longer
under load; `--quick` skips the jackknife and the simulation check; `--engine-csv <file>` adds the engine check).
Helper: `tools/dynamics_engine.js` runs the engine on development backtest fights and dumps per-round stats.
Output: `data/derived/dynamics.json`. Data: ufcstats snapshot through Oct 31, 2026 (`data/raw/`), parsed with
`tools/baserates.py`'s loader and `tools/build_db.py`'s people resolution. Built Nov 6, 2026.

**Walk-forward discipline.** Every coefficient below is fit on fights from **2019-01-01 to 2023-12-31** ("train",
2,502 fights). Held-out numbers are on **2024-01-01 to 2025-12-31** ("test", 1,029 fights). Fights from 2026-01-01
(476) belong to the sealed vault of the hidden-data protocol in `docs/BACKLOG.md`: they are never scored here.
2010-2018 ("ext", 3,658 fights) appears only in labeled robustness fits, never in the test period. Walk-forward
fighter features (career rates, chin and power indices, late-round ratios) use only fights before the fight in
question. The only exception is `cardio_by_slug`, the current per-fighter cardio table. Like
`fighters.json`, it uses every fight to the snapshot, so it is for forward predictions only, never for backtests.

Formats: 3 x 5 min and 5 x 5 min only. Panel: 8,660 fights, 41,200 fighter-rounds.

## Summary

- **Within a fight, output does not decay with damage or with work done.** Distance strike attempts per minute
  of non-control time do not move with head strikes absorbed in earlier rounds: +0.1% per 10 (SE 0.6%). Own
  earlier output costs at most a few percent: -4.5% per 100 attempts thrown (SE 2.4%). The league pace curve
  rises by round and stays the main dynamic. Structural round multipliers for distance output are
  [1, 1.15, 1.26] (3 rounds) and [1, 1.22, 1.23, 1.31, 1.37] (5 rounds).
- **Fixed-effects fits get the fatigue question backwards.** Within-fight fixed effects say each 100 attempts thrown
  cuts later output by 42%. A simulation with no fatigue at all reproduces that -0.42 (-0.40 to -0.44): it is pure
  mean reversion. The dynamic random-effects estimator, which conditions on earlier rounds through the
  likelihood, recovers the true value in simulation (0 → -0.01 to -0.05; -0.15 → -0.12 to -0.19).
- **Fight-night form and pace are much larger and more persistent than the engine assumes.** After walk-forward
  profiles, the two fighters share a fight-level pace effect with sd 0.37 (engine `form.pace` 0.10). Each fighter's
  own round-to-round noise is an AR(1) process (sd 0.31, autocorrelation 0.68), where the engine uses iid noise.
  Accuracy has individual fight-night form of sd 0.29 logit (engine `form.acc` 0.12). Profiles explain accuracy
  only about 0.55 for 1, so it should be attenuated.
- **Per-fighter cardio is real but small.** A fighter's true late-round output ratio has sd 0.16 on the log scale
  (τ² 0.026, 95% CI 0.018-0.034). One fight's observed ratio has sd 0.66, so a single fight is about 6% signal.
  Walk-forward empirical-Bayes predictions are calibrated on held-out fights (slope 0.92-0.98) but explain only
  about 2% of the variance. The engine's `kPace` 15 overweights fighter history. The train-chosen value is 45:
  held-out skill rises from 2.1% to 2.6%. The opponent's cardio moves your late output too, with coefficient
  0.4-0.7.
- **No between-round adaptation.** Losing a round, by the judges' consensus or on strikes landed, does not change
  output (+0.0% SE 1.1%, -0.8% SE 0.9%) or takedown attempts (+1.6% SE 4.8%). Accuracy dips slightly after a
  round the judges gave away: -0.04 logit (SE 0.016), about 1 point. Down two rounds entering the final round,
  fighters throw 4.7% less (SE 1.6%), not more.
- **Knockdown momentum.** The scorer eases off next round: output -8.8% (SE 3.0%), accuracy -0.058 logit,
  takedown attempts -12%. The man who was dropped does not slow: output +6% (SE 3%), takedown attempts +12%. Once
  per-fight frailty is in, his knockdown risk in the next round is x1.15 (95% CI 0.83-1.60). Without frailty it
  looks like x2.0, but that is selection.
- **Finish hazard vs accumulated damage: per-strike risk does not rise.** Knockdowns per landed standing head
  strike show no damage effect with a gamma frailty per fighter-fight: -4% per 10 head strikes absorbed (SE 4%).
  Adding damage terms worsens held-out log-likelihood. The frailty itself is strongly supported: variance about
  1.0, +4.6 held-out log-likelihood. Per-strike knockdown risk falls steeply by round: [1, 0.57, 0.37] in 3-round
  fights and [1, 0.65, 0.40, 0.29, 0.29] in 5-round fights. It is a round effect, not attacker fatigue.
  Knockdown-to-finish conversion (51-53% per knockdown) does not rise with damage and falls 15% in odds per
  round. Only non-knockdown stoppages lean on damage: +11% per 10 head strikes absorbed earlier (SE about 5%).
  Battered fighters are finished more often because they keep absorbing more per minute (head strikes absorbed
  per minute 2.2 → 6.2 across prior-damage bins), not because each strike gets more dangerous.
- **The two directions of a fight do not share knockdown volatility.** The per-fight residual correlation of
  knockdowns absorbed is -0.024 over 2,313 fights. Independent frailty predicts +0.002 (sd 0.019). The engine's
  shared `form.vol` 0.6 structure predicts +0.074 (sd 0.020): rejected.
- **Engine v3 check.** On the same 865 validation matchups, engine snapshot b50cadf (30 sims each) has:
  - round-to-round output correlation 0.19 vs 0.53 real;
  - fight-level output sd 0.25 vs 0.50, and accuracy almost no fight-night spread;
  - knockdown frailty 1.7 vs 0.9;
  - a per-strike knockdown hazard that barely falls after round 2. That gives 2-3x too many KO/TKO finishes in
    rounds 3-5 of 5-round fights (0.12 vs 0.04-0.07 per round).

  Section 8 lists the exact changes.

## 1. Data, periods and estimators

**Panel.** One row per fighter-round: what he did (attempts and landed by target and position, knockdowns, takedowns,
control, submission attempts), what was done to him, and the state carried into the round from earlier rounds
of the same fight:

| Covariate | Meaning |
|---|---|
| `D10` | head sig strikes absorbed in earlier rounds, per 10 |
| `K_lag`, `K_early` | knockdowns absorbed in the previous round / before it |
| `Ks_lag`, `Ks_early` | knockdowns scored in the previous round / before it |
| `A100`, `oA100` | own / opponent's sig attempts in earlier rounds, per 100 (fatigue proxies) |
| `octrl_m`, `ctrl_m` | minutes controlled by the opponent / in control, earlier rounds |
| `otdl`, `tdl` | takedowns absorbed / landed in earlier rounds |
| `H10` | head sig strikes landed on the opponent in earlier rounds, per 10 |
| `lost` | lost the previous round on sig strikes landed (tie 0.5) |
| `lostJ` | share of the three judges who gave the previous round to the opponent (decisions only, section 4) |
| `behind2_final` | final scheduled round and down two or more rounds on sig-landed rounds |
| `partial` | final round that ended early (its rate includes the finishing sequence) |

Standing head strikes landed are the midpoint of ufcstats' bounds, `(max(head - ground, 0) + min(head, distance +
clinch)) / 2`, as in `tools/baserates.py`. Partial final rounds of at least 60 seconds are kept, with a `partial`
dummy, so that the round sequence stays missing-at-random given the observed past (dropping them would select on
the finishing round's own outcome).

**Dynamic random-effects model (output, accuracy).** For one outcome of both fighters of fight f in round r:

    y[f,i,r] = mu[format, r] + x[f,i,r]' gamma + a[f,i] + b[f,r] + e[f,i,r] + m[f,i,r]

- `a[f,i]` is a fighter-in-fight effect, sd `sa`. Its correlation between the two fighters is `rho`, the shared
  fight pace.
- `b[f,r]` is a round shock shared by both fighters, sd `sb`.
- `e` is each fighter's AR(1) round noise, sd `se`, autocorrelation `phi`.
- `m` is measurement noise with known variance: Poisson for log rates, binomial for empirical-logit accuracy.

The covariates `x` are functions of earlier rounds. Every fight starts fresh in round 1, so there is no
initial-conditions problem. The transform `z = y - x' gamma` has a unit-triangular Jacobian, which makes the
Gaussian likelihood of `z` exact.

Estimation: `(mu, gamma)` by GLS, profiled out; the five variance parameters by ML. SEs are cluster-robust by fight;
`out` and `dist` also have a 10-group delete-a-group jackknife (`se_jack`), which propagates the variance-parameter
uncertainty. Held-out evidence is the one-step-ahead predictive log-likelihood on test fights: each round given
both fighters' earlier rounds, parameters fixed from train.

**Frailty Poisson (counts: knockdowns, takedown attempts, stoppages).**

    y[g,r] ~ Poisson(theta_g E[g,r] exp(x' beta))

- `theta_g` is a gamma frailty per fighter-fight, mean 1 and variance `alpha`, integrated out (negative
  multinomial).
- `E` is the exposure: landed standing head strikes absorbed for knockdowns, minutes for takedown attempts.

Stopping rules that depend on past events are ignorable for the likelihood. The held-out score is the test
log-likelihood, which factorizes into one-step predictive terms. SEs are a cluster-robust sandwich by fight.

**Validation of the estimator.** The worry is predetermined covariates built from the outcome itself. To test it,
I simulated log output from the fitted null model (no state effects), rebuilt the own-output fatigue proxy from
the simulated counts and refit:

| True effect of A100 | Dynamic RE estimate | Within-fight fixed effects |
|---|---|---|
| 0 | -0.010, -0.019, -0.049 (exploration runs); final run in `simulation_check` | -0.44, -0.40, -0.42 |
| -0.15 | -0.188, -0.115 | -0.69, -0.60 |

On real data the fixed-effects estimate is -0.424. That is exactly the artifact.

## 2. Output and accuracy vs in-fight state (part 1)

### 2.1 Round curves (structural: null model, fighter-fight effects integrated)

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| Sig attempts per round-minute, 3 rounds | 1 | 1.072 | 1.116 | | |
| Sig attempts per round-minute, 5 rounds | 1 | 1.150 | 1.129 | 1.150 | 1.109 |
| Distance attempts per non-control minute, 3 rounds | 1 | 1.149 | 1.261 | | |
| Distance attempts per non-control minute, 5 rounds | 1 | 1.225 | 1.228 | 1.311 | 1.372 |
| Sig accuracy (odds), 3 rounds | 1 | 1.035 | 1.013 | | |
| Sig accuracy (odds), 5 rounds | 1 | 1.037 | 1.072 | 1.084 | 1.088 |

Output per minute of position rises more steeply than output per round-minute, because control time also rises by
round (18.4% → 20.5% of round time in 3-round fights). The engine models positions, so its per-position rate
multiplier should follow the distance curve. The marginal targets the engine's realized rounds must reproduce are
in `targets_by_round` (train and test, every format-round): sig attempts and landed per minute, accuracy,
head and leg share, takedowns per 15, control share, knockdowns per 100 standing head strikes, and the
probability that the round ends by KO/TKO or submission.

### 2.2 State effects (train 2019-2023; log scale for rates, logit for accuracy)

Estimate (cluster-robust SE). `out` = log sig attempts per round-minute (11,878 fighter-rounds, 2,402 fights).
`dist` = log distance attempts per non-control minute (9,964). `acc` = empirical-logit sig accuracy (11,468).
`TD` = takedown attempts per minute (frailty Poisson, log rate). Jackknife SEs for `out` and `dist`:
`state_models.*.gamma.*.se_jack` in the JSON (see section 9).

| Covariate | out | dist | acc | TD attempts |
|---|---|---|---|---|
| D10 (per 10 head absorbed) | -0.017 (0.009) | +0.001 (0.006) | -0.010 (0.007) | -0.037 (0.022) |
| K_lag | +0.062 (0.029) | +0.033 (0.016) | -0.025 (0.025) | +0.111 (0.063) |
| K_early | +0.002 (0.049) | -0.012 (0.021) | -0.053 (0.033) | +0.109 (0.073) |
| A100 (own output, per 100) | +0.111 (0.040) | -0.045 (0.024) | +0.046 (0.035) | -0.056 (0.095) |
| oA100 (opponent output) | +0.149 (0.039) | -0.057 (0.025) | +0.078 (0.032) | +0.173 (0.097) |
| octrl_m (min controlled) | -0.005 (0.008) | -0.013 (0.005) | +0.002 (0.006) | **-0.104 (0.016)** |
| ctrl_m (min in control) | -0.021 (0.008) | -0.034 (0.005) | +0.028 (0.006) | +0.048 (0.012) |
| otdl | -0.014 (0.011) | -0.002 (0.006) | +0.008 (0.007) | -0.020 (0.022) |
| tdl | -0.017 (0.010) | -0.009 (0.006) | +0.004 (0.009) | -0.063 (0.013) |
| H10 (per 10 head landed) | -0.023 (0.009) | -0.001 (0.005) | -0.001 (0.007) | -0.004 (0.020) |
| Ks_lag | **-0.088 (0.030)** | -0.043 (0.019) | -0.058 (0.024) | -0.129 (0.069) |
| Ks_early | -0.030 (0.041) | -0.024 (0.022) | -0.025 (0.035) | +0.091 (0.077) |
| lost | -0.008 (0.009) | -0.014 (0.007) | -0.018 (0.013) | -0.020 (0.033) |
| behind2_final | -0.047 (0.016) | -0.006 (0.012) | -0.027 (0.021) | -0.005 (0.048) |
| partial | +0.164 (0.019) | +0.047 (0.012) | +0.162 (0.013) | +0.092 (0.029) |

Reading:

- **Damage.** Head strikes absorbed cut sig output per round-minute slightly (-1.7% per 10). They do not cut output
  per minute of standing time (+0.1%). Damage works through position, as damaged fighters spend more time
  controlled, not through rate.
- **Knockdowns absorbed** raise the next round's output and takedown attempts. Knockdowns scored lower the
  scorer's.
- **Fatigue proxies.** Own earlier output costs at most -4.5% per 100 attempts at distance. On all sig attempts it
  is positive: high-pace fights stay high-pace beyond what the AR(1) and fight effect capture.
- **Opponent's work.** The opponent's earlier output raises my accuracy (+0.08 logit per 100 of his attempts;
  head accuracy +0.21). That is defensive fatigue.
- **Grappling carry-over.** A fighter who was controlled shoots far less later: -10% per minute (z = 6.5).
- **Head accuracy** (not tabled) improves in-sample but loses on held-out data (-0.0024 log-likelihood per
  observation). Don't use its state terms.

### 2.3 The bracket: why the dynamic RE model is needed

Each estimator's coefficient on log output (SE):

| Estimator | A100 | D10 | K_lag | Ks_lag |
|---|---|---|---|---|
| Pooled OLS (between fighters) | +0.926 (0.046) | -0.001 (0.006) | +0.027 (0.037) | -0.050 (0.035) |
| Lagged-dependent-variable OLS | +0.447 (0.056) | -0.002 (0.007) | +0.027 (0.035) | -0.091 (0.035) |
| Within fighter-fight fixed effects | -0.424 (0.065) | +0.002 (0.008) | -0.001 (0.039) | -0.117 (0.038) |
| **Dynamic RE (z-transform ML)** | **+0.111 (0.040)** | -0.017 (0.009) | +0.062 (0.029) | -0.088 (0.030) |

Fixed effects and the lagged-DV fit bracket the truth for a lagged own-outcome covariate. The dynamic RE value
falls between them and is validated by simulation (section 1). Covariates that are not functions of the
fighter's own output (D10, K_lag) agree across estimators.

### 2.4 Form and persistence (for `form.out`, `form.pace`, `form.acc`, `roundOut`)

Null dynamic RE, train, without and with the walk-forward pre-fight expectation. The expectation is the
attacker's career rate times the defender's allowed rate, shrunk with 40 minutes for attempts and 150 attempts
for accuracy.

| | sd fighter-fight | corr between fighters | sd round shared | sd round own | AR(1) own |
|---|---|---|---|---|---|
| Output, no profile | 0.448 | 0.859 | 0.340 | 0.292 | 0.646 |
| Output, with profile | 0.368 | 1.00 (boundary) | 0.340 | 0.309 | 0.680 |
| Accuracy, no profile | 0.335 | -0.002 | 0.000 | 0.249 | 0.736 |
| Accuracy, with profile | 0.294 | 0.053 | 0.000 | 0.244 | 0.727 |

- **Output.** The profile coefficients are 0.985 (SE 0.038) for the attacker and 0.846 (0.037) for the defender's
  allowed rate. That supports the engine's log-linear combination with exponents near 1. What profiles leave
  over:
  - a fight-level pace shared by both men, sd 0.37;
  - a round shock shared by both, sd 0.34;
  - each man's own AR(1) noise, sd 0.31 with autocorrelation 0.68. This persistence is his individual fight-night
    output form, drifting slowly.
- **Accuracy.** The profile coefficients are only 0.61 (0.033) and 0.50 (0.032), so profile accuracy should be
  attenuated. That is a v4 item: log5 exponents of about 0.6 and 0.5, or a stronger `kAcc`. Accuracy has
  individual fight-night form of sd 0.29 logit, nothing shared, plus AR(1) round noise (sd 0.24, 0.73).
- **Raw correlations of log output (train).** Own round 1 vs round 2: 0.56. Round 1 vs round 3: 0.46. The two
  fighters in the same round: 0.67.

### 2.5 Held-out (test 2024-2025, one-step-ahead, parameters from train)

| Outcome | Δ log-lik per obs, state terms vs null | MSE reduction | Δ log-lik per obs, profile vs null |
|---|---|---|---|
| out | +0.0113 | 2.2% | +0.021 |
| dist | +0.0144 | 3.4% | |
| acc | +0.0003 | 0.7% | +0.013 |
| head acc | -0.0024 | 0.4% | |
| TD attempts (per fighter-fight) | +0.012 | | |

The state terms add a little real predictive information for output and takedown attempts (mostly the control
and knockdown terms) and nothing for accuracy.

## 3. Per-fighter late-round ratios (part 2)

**Definition.** For a fighter-fight with at least two full rounds:

    LR = mean over full rounds 2..T of log(sig per min) - log(sig per min in R1)

Both rates are relative to the league mean for that format and round from train. `LRa` uses attempts, `LRl`
landed. Sample sizes: 4,286 (ext), 2,952 (train), 1,264 (test).

**Variance decomposition** (method of moments on cross-products of different fights of the same fighter,
pre-test fights; 22,701 pairs; 95% CI by bootstrap over fighters):

| | τ² (true fighter variance) | 95% CI | τ | total var of one fight | ICC (one fight) |
|---|---|---|---|---|---|
| LRa (attempts) | 0.0255 | 0.018-0.033 | 0.160 | 0.441 | 0.058 |
| LRl (landed) | 0.0329 | 0.023-0.044 | 0.181 | 0.530 | 0.062 |
| LRa, train only | 0.0231 | 0.013-0.035 | | | |

**Walk-forward empirical Bayes:**

    LR_hat = m + w (mean of past LR - m),    w = n τ² / (n τ² + σ²),    σ² = total var - τ²

Held-out test (fighter-fights with at least one earlier LR, n = 1,077). τ² is chosen on train:

| Measure | τ² chosen | test skill (MSE vs league) | slope | corr |
|---|---|---|---|---|
| LRa | 0.03 | +1.55% | 0.92 | 0.115 |
| LRl | 0.04 | +2.14% | 0.98 | 0.131 |

The slopes near 1 mean the shrinkage is calibrated out of sample. A 3-year time-decay half-life did not help.

**The engine's current rule.** `rho[r] = (ratio x pace_w + kPace) / (pace_w + kPace)`, with landed per round
from `pace` / `pace_w` in backtest.json:

| kPace | train skill | train slope | test skill | test slope | test corr |
|---|---|---|---|---|---|
| 15 (current) | -0.10% | 0.49 | +2.07% | 0.68 | 0.152 |
| 30 | +1.15% | 0.69 | +2.74% | 0.99 | 0.156 |
| **45 (train-best)** | **+1.36%** | **0.88** | **+2.64%** | **1.27** | **0.158** |
| 60 | +1.35% | 1.06 | +2.44% | 1.54 | 0.158 |

**The opponent's cardio matters too.** Regress my realized LR on my walk-forward prediction and my opponent's:

| | own | opponent |
|---|---|---|
| train | 1.04 (0.17) | 0.39 (0.17) |
| test | 1.01 (0.24) | 0.74 (0.24) |

Late-round pace is partly mutual: you speed up with an opponent who speeds up.

**Systematic predictors** (OLS on train, cluster by fighter):

| Term | Effect |
|---|---|
| Age, per 5 years | +0.032 (0.017) |
| log career output | +0.098 (0.070) |
| LHW/HW | -0.048 (0.041) |
| Women | -0.075 (0.033) |
| 5-round fight | -0.042 (0.038) |

Test skill 1.2%, corr 0.06. Weak; not recommended over the fighter's own history.

**Current roster.** Shrunk ratios from all fights to the snapshot are in `fighter_late_ratio.current` and
`cardio_by_slug`. Among active fighters with at least five ratios, the spread is sd 0.11. Faders and surgers:

| Faders | late ratio | n | Surgers | late ratio | n |
|---|---|---|---|---|---|
| Jim Miller | 0.74 | 25 | Stephen Thompson | 1.37 | 15 |
| Rani Yahya | 0.78 | 14 | Kennedy Nzechukwu | 1.36 | 7 |
| Ismail Naurdiev | 0.79 | 7 | Joaquim Silva | 1.31 | 8 |
| Macy Chiasson | 0.79 | 8 | Joshua Van | 1.30 | 10 |
| Ketlen Vieira | 0.79 | 13 | Esteban Ribovics | 1.30 | 5 |
| Dustin Poirier | 0.81 | 16 | Ian Machado Garry | 1.25 | 10 |

**Volkanovski and Gaethje.**

| | Attempts-based EB (all fights) | Engine rule, kPace 15 | Engine rule, kPace 45 |
|---|---|---|---|
| Volkanovski | 1.053 (n 13, weight 0.48) | cardio index 1.16 | 1.10 |
| Gaethje | 1.035 (n 9, weight 0.39) | 0.86 | 0.92 |

The two measures disagree for Gaethje. His late-round fade is in strikes landed in 5-round fights, not in attempts
over all his fights. The landed rule had slightly higher held-out skill, so keep the engine's landed-based rule at
kPace 45.

## 4. Between-round adaptation (part 3)

**Judges' consensus labels.**

- **Clean sweeps.** For decisions where every card says the fight loser won no round, every round's winner is
  known. That is 27% of decisions.
- **Other cards.** Each card's total gives the number of rounds the fight loser won, assuming 10-9 and 10-8 rounds
  only. Which rounds those were is inferred from round stats with a round-winner logistic fit on train clean
  sweeps (326 fights): head 0.376, body 0.255, leg 0.281, KD 3.30, TD 0.95, control 0.74 per minute, sub 1.0. The
  probability is proportional to the product of round odds over subsets of the right size.
- **The label.** `lostJ` is the expected share of the three judges who gave the previous round to the opponent. It
  agrees with the sig-landed label on 78.6% of rounds.

Decision sample (fights that went the distance; train 7,712 output rows):

| Label | output | accuracy (logit) | TD attempts |
|---|---|---|---|
| lostJ (judges) | +0.000 (0.011); test refit +0.032 (0.015) | **-0.043 (0.016)**; test -0.033 (0.028) | +0.016 (0.048); test -0.019 (0.066) |
| lost (sig landed), same sample | -0.014 (0.009); test -0.000 (0.012) | -0.025 (0.013); test -0.003 (0.023) | -0.004 (0.037); test -0.018 (0.051) |
| lost, all fights (section 2.2) | -0.008 (0.009) | -0.018 (0.013) | -0.020 (0.033) |

No output or takedown response to losing a round, in either period. Accuracy dips by about 1 point after a round
the judges gave away. That replicates in sign on test but is not significant there. It may be partly information
about the night's form beyond the stats, not a choice.

**Desperation.** Down two or more rounds entering the final round:

| | train | validation (engine check, real) |
|---|---|---|
| Output | -4.7% (1.6%) | +1.5% (2.6%) |
| TD attempts | -0.5% (4.8%) | |

There is no surge.

## 5. Knockdown momentum (part 4)

Next-round shifts from the same models (train):

| | output | distance output | accuracy (logit) | TD attempts | KD risk next round |
|---|---|---|---|---|---|
| Dropped last round (K_lag) | +6.2% (2.9%) | +3.3% (1.6%) | -0.025 (0.025) | +11% (6%) | x1.15 (0.83-1.60) |
| Dropped earlier (K_early) | +0.2% (4.9%) | -1.2% (2.1%) | -0.053 (0.033) | +11% (7%) | x0.79 (0.47-1.31) |
| Scored a KD last round (Ks_lag) | **-8.8% (3.0%)** | -4.3% (1.9%) | **-0.058 (0.024)** | -12% (7%) | |
| Scored earlier (Ks_early) | -3.0% (4.1%) | -2.4% (2.2%) | -0.025 (0.035) | +9% (8%) | |

The KD-risk column is from the knockdown frailty model. Without frailty the next-round risk looks like x2.0
(K_lag +0.70, SE 0.14). Most of the "dropped again" pattern is the same fight-night vulnerability, not damage.

Raw difference-in-differences, next-round change in log output vs no-knockdown rounds:

| | train | test |
|---|---|---|
| Dropped | +0.025 (0.043) | +0.18 (0.07) |
| Scorer | -0.24 (0.04) | -0.29 (0.08) |

The scorer's raw drop includes mean reversion from a big round, which the model removes.

## 6. Finish hazard vs accumulated damage (part 5)

### 6.1 Knockdowns per landed standing head strike absorbed

Frailty Poisson. Walk-forward covariates:

| Covariate | Definition | Coefficient (SE) |
|---|---|---|
| `lchin` | log chin index: KD absorbed per standing head absorbed, shrunk with 230 strikes, relative to the train league rate 0.00882 | 0.61 (0.10) |
| `lpow` | log opponent power index, defined the same way | 0.71 (0.09) |
| `ldiv` | log division rate, train | 0.66 (0.12) |

Profile chin and power carry about 0.6-0.7 of their face value. Fits and test log-likelihood:

| Model | test log-lik | key terms | frailty variance |
|---|---|---|---|
| null (round cells + profile) | -1406.4 | | 1.08 (SE log 0.16) |
| + damage (D10, K_lag, K_early) | -1406.7 | D10 -0.041 (0.042); K_lag +0.144 (0.167); K_early -0.240 (0.260) | 1.02 |
| + fatigue (A100 defender, oA100 attacker) | -1405.9 | A100 -0.405 (0.201); oA100 +0.094 (0.179) | 1.04 |
| full | -1405.9 | | 1.01 |
| null, no frailty | -1411.0 | | |
| damage, no frailty | -1412.2 | D10 -0.132 (0.040); K_lag +0.70 (0.14) | |

- **Accumulated damage does not raise per-strike knockdown risk.** The point estimate is negative. The 95% upper
  bound at 50 head strikes absorbed is x1.22.
- **The attacker's own earlier output does not explain the round decline** (oA100 +0.09). So the engine's
  attacker-stamina path on power (`kdStamAtt` 1.1) has no support in this form.
- **Frailty helps on held-out data** (+4.6 log-likelihood).

Test calibration (sequential predictive means):

| Prior head strikes absorbed | observed KDs | damage model | null model |
|---|---|---|---|
| 0 (round 1) | 237 | 246 | 247 |
| 1-20 | 110 | 137 | 135 |
| 21-40 | 47 | 46 | 47 |
| 41-60 | 16 | 12.6 | 12.8 |
| 61+ | 4 | 5.5 | 6.2 |

The damage model does no better than the null in any bin.

**Round profile given frailty** (structural; relative to R1):

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 3 rounds, train | 1 | 0.569 | 0.372 | | |
| 3 rounds, 2010-2023 | 1 | 0.549 | 0.332 | | |
| 5 rounds, train | 1 | 0.880 | 0.507 | 0.294 | 0.446 (R4-5 pooled 0.367) |
| 5 rounds, 2010-2023 | 1 | 0.650 | 0.405 | 0.300 | 0.275 (R4-5 pooled 0.288) |
| 5 rounds, SE of log (2010-2023) | | 0.12 | 0.16 | 0.22 | 0.24 |
| Validation, real, cells only | 1 | 0.50 / 0.53 | 0.42 / 0.39 | 0.23 | 0.12 |

The R1 rate at league-average chin, power and frailty is 0.0151 per landed standing head strike (3-round). On test,
the train profile over-predicts round-2 knockdowns: 88 observed vs 114 predicted in 3-round fights, 11 vs 17 in
5-round fights. The decline is if anything steeper out of sample.

**Shared volatility.** Per fighter-fight Pearson residuals of knockdowns absorbed (no-frailty expectation,
real exposures), correlation between the two directions of the same fight:

| | correlation |
|---|---|
| Observed (2,313 train fights) | -0.024 |
| Simulated, independent frailty (variance 1) | +0.002 (sd 0.019) |
| Simulated, engine structure (pow 0.45 x chin 0.45 per direction x shared vol 0.6) | +0.074 (sd 0.020) |
| Simulated, shared frailty only | +0.183 (sd 0.028) |

The engine check (section 7) repeats this on simulated fights with the engine's own stopping rules
(`engine_check.kd_hazard.*.direction_residual_corr`).

`research/model_durability.md` reports about a quarter to a third of per-fight knockdown variance shared by both
men. The two results fit together if the sharing is in volume (wars have more strikes both ways) rather than in
per-strike risk. Section 2.4 finds a large shared pace component (sd 0.37). In the engine, shared volatility
belongs in `form.pace`, not in `form.vol`.

### 6.2 Knockdown → finish conversion, per knockdown

Each knockdown in a round converts or not; the last knockdown carries the finish (geometric likelihood). Rates:
train 51.2%, test 52.9%.

| Model | test log-lik | terms |
|---|---|---|
| null | -285.1 | round -0.155 (0.077) per round; 5-round -0.07 (0.20); log division rate +0.40 (0.21) |
| + damage | -284.7 | D10 +0.112 (0.073); knockdown index in fight +0.10 (0.13); round -0.32 (0.13) |
| + profile | -285.6 | defender chin +0.39 (0.19) |

Conversion by prior damage is flat (`kd_conversion.empirical_by_prior_damage`). The damage term trades off against
the round term, and together they add 0.4 log-likelihood on test. Conclusion: constant conversion, falling about
15% in odds per round. No damage dependence.

### 6.3 Non-knockdown stoppages

KO/TKO in rounds where the stopped man absorbed no knockdown. Pooled Poisson, one event per fighter-fight at
most. A shared frailty with the knockdown process is not identified: it collapses because a stoppage without a
knockdown excludes knockdown rounds by construction.

| | train events (test) | rate | D10 | per round | 5-round |
|---|---|---|---|---|---|
| Standing TKO, no KD | 55 (27) | 0.00045 per landed standing head absorbed | +0.108 (0.091) | -0.18 (0.24) | -0.10 (0.41) |
| Ground TKO, no KD | 150 (47) | 0.0067 per ground sig strike absorbed | +0.102 (0.067) | -0.17 (0.13) | -0.43 (0.30) |

Pooled damage slope: about +0.104 per 10 head strikes absorbed earlier (SE about 0.054). This is the one place
where damage feedback has support.

### 6.4 Finish risk vs prior damage: exposure, not fragility

Rounds 2+, by head strikes absorbed in earlier rounds (train):

| Prior head absorbed | P(stopped by strikes) | stoppages per 100 head absorbed | KD per 100 standing head | head absorbed per min |
|---|---|---|---|---|
| 1-20 | 4.8% | 0.47 | 0.73 | 2.2 |
| 21-40 | 5.7% | 0.35 | 0.48 | 3.6 |
| 41-60 | 5.5% | 0.25 | 0.36 | 4.8 |
| 61+ | 8.2% | 0.28 | 0.31 | 6.2 |

Test: 3.9%, 5.5%, 9.4%, 5.4% per round; head absorbed per minute 2.2, 3.6, 4.7, 6.0.

The per-round finish risk rises with accumulated damage. The per-strike risk falls, partly through the round
effect and partly through frailty selection. The rise comes from persistent exposure: the man taking a beating
keeps taking it. In the engine that persistence comes from fight-night form and pace (section 2.4), not from
damage multipliers on knockdown probability.

## 7. Engine v3 check (snapshot)

`tools/dynamics_engine.js` ran engine v3 on the 865 validation matchups (2024-2025, `backtest_dev.json`, walk-forward
profiles and priors), 30 traced fights each. The same statistics were computed on the simulated rounds and on the
real rounds of the same fights.

The working tree's engine at the time of the run (commit b641e44, 09:49) was broken: every fight ended "LEG" in
round 1 with NaN time, the Volkanovski-Gaethje default included. The check therefore used the previous commit,
**b50cadf (09:46), params 3.0.0-selfcal-2026-11-06**, from a scratch copy. Rerun it with
`node tools/dynamics_engine.js <csv> [--engine-dir src]` and `python3 tools/dynamics.py --engine-csv <csv>` once
the calibrated engine lands.

| Statistic | Engine | Real |
|---|---|---|
| Output, sd fighter-fight / corr / sd round shared / sd own / AR(1) | 0.25 / 0.55 / 0.41 / 0.22 / 0.06 | 0.50 / 0.80 / 0.36 / 0.23 / 0.51 |
| Own output correlation R1-R2, R1-R3 | 0.19, 0.17 | 0.53, 0.47 |
| Fighters' output correlation, same round | 0.62 | 0.69 |
| Accuracy, fight-level sd (persistent) | about 0.22 (AR at boundary) / 0.04 | 0.32 + AR(0.58) |
| Output round curve, 3 rounds | 1, 1.07, 1.085 | 1, 1.18, 1.14 |
| Sig attempts per minute R1, 3 / 5 rounds | 8.23 / 7.98 | 7.51 / 6.73 |
| KD frailty (cells only) | 1.71 | 0.88 |
| KD per strike, round profile, 3 rounds | 1, 0.69, 0.54 | 1, 0.50, 0.42 |
| KD per strike, round profile, 5 rounds | 1, 0.65, 0.54, 0.54, 0.58 | 1, 0.53, 0.39, 0.23, 0.12 |
| KD per 100 standing head, 5-round R4 / R5 | 0.53 / 0.53 | 0.26 / 0.14 |
| P(round ends KO/TKO), 3 rounds | 0.164, 0.121, 0.098 | 0.142, 0.097, 0.081 |
| P(round ends KO/TKO), 5 rounds | 0.19, 0.15, 0.12, 0.12, 0.13 | 0.10, 0.10, 0.07, 0.05, 0.04 |
| Head absorbed per min by prior-damage bin (0 → 61+) | 2.1 → 4.6 | 1.2 → 5.7 |
| Late-ratio total var (between-matchup part) | 0.53 (0.030) | 0.49 |
| Output after being controlled earlier (octrl_m) | +0.055 | +0.001 |

The engine's damage terms are near zero in its own output (D10 +0.005), which matches the data. Its gaps are:

1. too little persistent fight-night variation in output and accuracy, and no round-to-round persistence;
2. a knockdown hazard that does not fall enough after round 2, so late-round finishes in 5-round fights run 2-3x
   too often;
3. too much knockdown frailty (the shared `vol`);
4. a 3-round pace curve that is too flat in realized terms.

## 8. Engine recommendation (v6)

Every number is a starting value for `tools/calibrate.js` / mlcal. The acceptance check is the engine-check
statistics above plus `targets_by_round`.

**E1. Pace curve** (multiplier on per-position strike rates, by round):

    pace3 = [1, 1.15, 1.26]                     (was [1, 1.104, 1.148])
    pace5 = [1, 1.22, 1.23, 1.31, 1.37]         (was [1, 1.181, 1.195, 1.234, 1.259])
    outStam: 0.12 -> 0.05                       (no volume fatigue in the data; distance -4.5% per 100 own attempts)

Target the realized sig attempts per minute by round:

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 3 rounds, train | 8.12 | 8.79 | 9.26 | | |
| 3 rounds, test | 7.57 | 8.74 | 8.92 | | |
| 5 rounds, train | 7.68 | 9.03 | 8.68 | 9.12 | 9.10 |
| 5 rounds, test | 6.74 | 7.95 | 8.03 | 8.80 | 9.20 |

**E2. Fight-night form and persistence:**

    form.pace (shared, fight-level, lognormal):    0.10 -> 0.35
    form.out  (individual, fight-level):           0.15 -> 0.20
    round output noise per fighter: AR(1)
        e_r = 0.68 e_(r-1) + sqrt(1 - 0.68^2) * 0.30 * N(0,1),   e_1 = 0.30 * N(0,1)
        (replaces iid roundOut 0.15; without AR use roundOut 0.12)
    form.roundPace (shared round):                 keep 0.10 (the engine already realizes 0.41 vs 0.36 real)
    form.acc (logit):                              0.12 -> 0.28

    Acceptance (dynamic RE null on simulated rounds):
        output sd fighter-fight 0.50, corr 0.80, AR(1) about 0.5, own-round corr R1-R2 0.53
        accuracy persistent sd about 0.32

**E3. Damage and fatigue on rates:** none. Do not add damage multipliers to per-position output or accuracy. Keep
hurt effects within the round, as now: `hurtEnd` resets between rounds. Defender fatigue raising attacker accuracy
(`accStam` 0.25) is consistent with the data: +0.08 logit per 100 opponent attempts, about +0.07 after two rounds.

**E4. Knockdown momentum** (next round only, after a round in which i scored at least one knockdown and the fight
continued):

    po[i]   x 0.92;  accuracy odds of i x 0.94;  takedown attempts of i x 0.88
    po[j]   x 1.05 (j = the man dropped);         takedown attempts of j x 1.12
    kdRepeat: keep 1.15 (data x1.15 next round, CI 0.83-1.60, given per-direction frailty)

**E5. Adaptation:** none by default. No trailing-fighter surge. Optional knob, default off: accuracy odds x 0.96 in
the round after one lost on the cards.

**E6. Grappling carry-over** (takedown attempt rate in round r):

    x exp(-0.104 * minutes controlled by the opponent in earlier rounds)
    x exp(-0.063 * takedowns landed in earlier rounds)
    x exp(+0.048 * minutes in control in earlier rounds)      (optional: may be style persistence)

Distance output also falls 1.3% per minute controlled earlier: either directly, or through bottom-time drain
with `outStam` small.

**E7. Knockdown hazard per landed standing head strike:**

    p = p0_div x power x chin x kdRound[R][r] x frailty
    kdRound3 = [1.50, 0.85, 0.56]               (= [1, 0.57, 0.37] relative to R1; exposure-weighted mean 1)
    kdRound5 = [1.79, 1.16, 0.73, 0.52, 0.52]   (= [1, 0.65, 0.405, 0.29, 0.29]; 2010-2023 fit, R4-5 pooled)
    kdStamAtt: 1.1 -> 0;   kdPaceExp: -1.2 -> 0   (the table replaces both)
    kdDmg: 800 -> off (1e9)
    form.vol: 0.60 -> 0    (no shared per-strike volatility; shared volume lives in form.pace)
    form.pow, form.chin: keep 0.45

    Acceptance: engine-check KD frailty (cells only) about 0.9 (real 0.88 validation; 0.8-1.1 with profiles)

**E8. Knockdown → finish conversion:**

    per-knockdown conversion about 0.52 (league; division factor as now)
    conversion odds x exp(-0.155 (r - 1))
    kdInstantDmg, refDmg: 600 -> off (or keep large)

**E9. Non-knockdown stoppages:**

    standing TKO without a knockdown: 0.00045 per landed standing head strike absorbed (train average)
    ground TKO without a knockdown:   0.0067 per ground sig strike absorbed
    both x exp(0.0104 * head strikes absorbed in earlier rounds) x exp(-0.17 (r - 1))
    In the engine's forms:
        stkoBase: 0.3 -> 0.9   (stko x (stkoBase + D/100) then has the data's slope at small D)
        gnpDmg:   600 -> 100

**E10. Cardio:**

    kPace: 15 -> 45
    pace partly mutual: m.pace[i][r] = paceCurve[r] x rho_i[r] x rho_j[r]^0.4 / norm
        (opponent coefficient 0.39 train, 0.74 test)
    Expected spread of fighter cardio among active fighters: sd about 0.11 on the log scale.

**E11. Do not model late-fight finish risk as rising per-strike fragility.** It comes from exposure persistence
(E2) and the round-specific hazard (E7, E9).

## 9. Uncertainty and caveats

- **Jackknife.** Delete-a-group jackknife SEs (10 groups of fights) for the output and position-adjusted output
  models are in `state_models.out/dist.gamma.*.se_jack`. The judges'-label output models have them too
  (`adaptation_judges.models.out_*`). Other dynamic-RE SEs are cluster-robust sandwich SEs that treat the variance
  parameters as known. Simulation shows they understate the spread for lagged own-output terms (A100, oA100).
- **Exposure is measured, not designed.** Standing head strikes are a bounded midpoint. Partial-round rates
  include finishing sequences, absorbed by `partial`.
- **Validity assumption.** The dynamic RE likelihood is exact only if covariates built from variables outside the
  modeled outcome (knockdowns, control, landed) carry no information about the latent form beyond the modeled
  history. The bracket in 2.3 and the agreement of D10 and K_lag across estimators suggest this matters little.
  It could bias the accuracy-label effect in section 4.
- **Five-round fights are scarce.** About 250-500 fighter-rounds per round in train. Treat 5-round R4-R5 profiles
  as ±25%.
- **Judges' labels** cover only fights that went the distance. Which round a 29-28 card gave away is inferred from
  stats.
- **Engine check is a snapshot.** It ran against b50cadf, not the current src/, which was broken at run time.
- **The vault** (fights from 2026-01-01) was never scored. `cardio_by_slug` includes 2026 fights and must not be
  used for backtests.

## 10. Reproduce

```
python3 tools/dynamics.py                      # full: jackknife, simulation check
python3 tools/dynamics.py --quick              # point estimates and held-out only
node tools/dynamics_engine.js /tmp/eng.csv --sims 30 [--engine-dir src]
python3 tools/dynamics.py --quick --parts 5 --engine-csv /tmp/eng.csv
```

JSON keys:

| Key | Contents |
|---|---|
| `state_models` | parts 1, 3 and 4: output, dist, acc, hacc, tda |
| `comparison_estimators_out` | the 2.3 bracket |
| `form_decomposition` | section 2.4 |
| `simulation_check` | the estimator simulation |
| `kd_momentum_descriptive` | the raw difference-in-differences |
| `adaptation_judges` | section 4 |
| `fighter_late_ratio` | part 2, with `current` and `cardio_by_slug` |
| `finish_hazard` | `kd_hazard`, `kd_conversion`, `non_kd_stoppage`, `hazard_tables` |
| `targets_by_round` | marginal round-by-round targets |
| `round_correlations_train` | raw output correlations |
| `engine_check` | section 7 |
