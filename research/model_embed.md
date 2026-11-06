# embed: fighter embeddings (time-aware offense / defense vectors)

Status:
- Built Nov 6, 2026 by `tools/embed.py`.
- Relaunched the same day after the first run died on a usage cap. The relaunch reused the cached walks and
  CV, found and fixed a quarter-index bug in the stitched walk (section "Bug found and fixed"), rebuilt every
  downstream number, and added:
  - integration tests on the current best inputs,
  - segment tables,
  - the mlrates blend recipe,
  - style neighbours,
  - an empirical look-ahead check.
- Validation (2024-2025) was scored once per build: once for the first build and once after the bug fix.
- **Verified Nov 6, 2026 (adversarial review, "Verification log" at the end).** No look-ahead, no 2026 data, no corner
  leak; every number reproduces from a fresh rebuild. Two protocol fixes changed the conclusions on the winner side:
  1. The integration rule now compares base, +head and +head x exp by time-ordered CV. It used to pick only between
     the two head variants by leave-one-year-out, so it "chose the head" even where training CV said the head hurts.
     On top of the no-line stack, the ratings stack, the close and the close + stack, train CV now **rejects** the
     head, so its validated contribution there is 0.
  2. The exported stat-line recipe is the CV-selected one (time-ordered CV; 14 of 18 targets keep the term). The
     builder had exported all 18 targets after seeing that the CV-selected recipe scored 0.01% worse on validation.
  The stat-line gain stands: **-1.67% [-2.11, -1.24]**.

Outputs:
- `data/derived/embed.json`: model, per-snapshot embeddings, quarterly refits, roster embeddings, axes,
  neighbours, CV and validation numbers.
  - Snapshots are keyed by backtest id and side, 2019-2025.
  - 2010-2018 training snapshots are keyed by fight id.
  - Roster embeddings are keyed by slug.
  - Validation numbers include `validation.integration`, `validation.winner_segments`,
    `validation.stats.mlrates_blend` and `validation.leak_check`.
- `data/derived/embed_model.json`: compact browser model with the stat-line blend recipe (`mlrates_blend`), the
  style-neighbour basis (`nn_style`) and check blocks.
- `src/ml/embed.js`: dependency-free UMD evaluator: matchup, neighbours, `styleNeighbours`, `blendMLRates`.
- `tests/test_embed.js`: Node test reproducing the Python outputs.

Hidden-data protocol:
- Every fight dated 2026-01-01 or later is dropped on load and never read.
- Other components' files are read only for `backtest_dev.json` ids, so 2019-2025 only. This covers `ml.json`,
  `market.json`, `ratings.json` and `mlrates_oof.json`; `ratings.json` also lists 2026 fights, and those are
  not read.
- The roster embeddings are the fit at 2026-01-01. The last fight used is 2025-12-13.

## Results in one screen (validation 2024-01-01..2025-12-31, symmetric, event-cluster bootstrap 95% CIs)

**Stat lines: a clear, significant gain.**
- On top of the verified mlrates stat-line model, adding the embedding's task predictor lowers mean relative
  deviance over 18 targets by **-1.67% [-2.11, -1.24]** (1,730 directed rows). This is the exported recipe: the term
  is kept for the 14 targets where time-ordered CV inside 2019-2023 says it helps.
  - Fit on mlrates' 2019-2023 out-of-fold rows.
  - Every segment improves: attackers with 1-2 UFC fights -1.51% [-2.31, -0.69]; 2024 -1.47%; 2025 -1.88%.
  - Largest gains: distance accuracy -5.1%, leg accuracy -3.6%, control -3.3%, head accuracy -2.9%,
    head attempts -2.6%.
- Against this project's own per-stat baselines (10 per-fight stats):
  - LightGBM with embedding features -3.13% [-4.08, -2.20] vs the same LightGBM without them;
  - Poisson GLM -4.32% [-5.37, -3.34].
- **Use it in the stat-line -> simulator path** (`FightEmbed.blendMLRates`; recipe below).

**Winner: real signal, but already in the current stack.**

The last column is the verified decision: the variant (base, + head, + head x exp) with the lowest time-ordered CV
log loss inside 2019-2023. Where train CV picks the base, the head's validated contribution is 0, whatever the
2024-25 delta shows.

| model, 2024-25 (854 decisive fights) | log loss | + head vs reference, 95% CI | train CV keeps the head? |
|---|---|---|---|
| embedding head alone (antisymmetric, no other features) | 0.6336 | -0.0433 [-0.0607, -0.0264] vs Elo 0.6769 | n/a |
| this tool's logistic, base features | 0.6184 | | |
| same + embedding features | 0.6149 | -0.0036 [-0.0122, +0.0051] | yes (CV -0.006) |
| ML logistic (ml.json `lr`, recalibrated on 2019-23) + head | 0.6063 | -0.0025 [-0.0060, +0.0011] | yes |
| no-line stack (Elo + ML + market rating) + head | 0.5941 | -0.0012 [-0.0028, +0.0005] | **no** (CV +0.0015) |
| no-line best (that stack + ratings stack) + head | 0.5907 | -0.0006 [-0.0015, +0.0003] | **no** (CV +0.0015) |
| opening line + head | 0.5976 | **-0.0088 [-0.0143, -0.0036]** | yes |
| closing line + head | 0.5836 | -0.0013 [-0.0026, -0.0001] | **no** (CV +0.0006) |
| closing line + no-line stack + head | 0.5788 | +0.0004 [-0.0003, +0.0011] | **no** (CV +0.0016) |

- The head beats plain Elo clearly. It trails the tuned rating systems in `ratings.json` on the same years:
  WHR-with-rounds 0.618 and Glicko-2 0.623 (858 rows).
- What it knows is mostly what the ML features, the ratings and the market already know. Train CV keeps it only on
  top of a single model (the ML logistic, n.s. on validation) and the opening line (the one clear gain). On top of
  the no-line stack, the ratings stack and the closing line, train CV rejects it. The close's -0.0013 is a
  validation-only delta that a pre-registered rule would not have taken.
- No winner variant closes the newcomer gap. In fights where a man has 1-2 UFC fights, the head scores 0.656
  vs the close 0.604. The embedding of a man with one or two fights is mostly the division-average prior.
- Five-round fights (105) are the only segment where the embedding features help the feature models
  significantly: logistic -0.0249 [-0.0476, -0.0027], GBM -0.0287 [-0.0486, -0.0062]; on top of the close,
  -0.0041 [-0.0075, -0.0009].
  - Five-round fighters have more history: a mean of 8.5 prior UFC fights for the less experienced man vs 5.1.
  - This was found after the fact among 12 segments. Treat it as a hypothesis for the next look, not a finding.

**Look-ahead checks: clean.**
- The exposure behind every 2024-25 snapshot equals the decayed count of strictly earlier stat fights
  (0 mismatches in 2,074 rows).
- Scoring each fight with the attacker's next-fight vector, which has seen the fight, gives mean relative
  deviance 0.750. The exported pre-fight vector gives 0.902. An honest walk-forward should show exactly this
  gap.
- Every snapshot's refit is the latest quarter before its fight (guard in `--stage extras`).
- Verification added a perturbation test: scrambling one 2025 card's stat lines and results leaves every snapshot
  dated on or before that card bit-identical. Scrambling every row from 2024-07-01 on leaves that quarter's refit
  identical to 6e-15.

## Method

### Data and protocol

- Source: `data/raw/*.csv` through `tools/build_db.py` (`parse_fights`, `build_people`, `build_vectors`), so
  people, aliases and per-fight vectors are the same as everywhere else in the pipeline.
- Model rows: every UFC fight with round stats since 2005-01-01. That is 8,054 fights, 16,108 directed rows
  ("X against Y"), 2,390 fighters and 13 divisions. A fit at date T uses rows dated in
  [T - 4 half-lives, T); older rows would weigh under 1/16.
- Downstream snapshots: `build_db.walk` re-run from 2010-01-01 on the pre-2026 fights, giving 5,632 entries.
  This is the same construction as `backtest_dev.json`, which starts in 2019. The 2,864 shared entries match
  it exactly (max S difference 0.0, identical Elo).
- Splits: the factor model's hyperparameters come from time-ordered CV on 2019-2023. Downstream models train
  on 2010-2023, with their own hyperparameters from time-ordered CV inside that window. **Validation is
  2024-01-01..2025-12-31, scored once.**
- Corner symmetry:
  - The factor model has no corner input. Each fight gives both directed rows, and the win head is
    antisymmetric with no intercept.
  - Winner models use A-minus-B features with no intercept on mirrored data.
  - GBMs train on mirrored data and average both orientations.
  - Stacks have no intercept and are fit on mirrored data.
- Uncertainty: 95% intervals come from a paired bootstrap that resamples whole event dates (2,000 draws).

### The factor model

Every fighter i has an offense vector a_i and a defense vector d_i (K = 8 each, 16 dims). For a directed row
"X against Y" and each of 21 tasks t:

    eta_t = c_t + c_t[division] + beta_t * era + gamma_t * five_round + W_t . a_X + V_t . d_Y

| task group | tasks | likelihood (link) | exposure |
|---|---|---|---|
| strike attempts | distance, clinch, ground; head, body, leg; non-significant | negative binomial (log) | fight minutes |
| accuracy | distance, clinch, ground; head, body, leg | binomial, beta-binomial row weight (logit) | attempts |
| knockdowns | knockdowns per landed head strike | negative binomial (log) | landed head strikes |
| grappling | takedown attempts, control minutes, submission attempts, reversals | negative binomial (log) | fight minutes |
| takedown accuracy | takedowns landed / attempted | binomial, beta-binomial row weight (logit) | takedown attempts |
| finishes | KO/TKO wins, submission wins | Poisson hazard (log) | fight minutes |
| result | X beats Y | logistic, antisymmetric head | one per decisive fight |

    logit P(X beats Y) = u_a.(a_X - a_Y) + u_d.(d_X - d_Y) + a_X' M d_Y - a_Y' M d_X

**Why negative binomial.** A first quasi-Poisson version overfit badly. Its held-out deviance per row was about
4x the in-sample Pearson dispersion, because fight-to-fight variation is large (the backlog gives a
between-fight log output sd of 0.45). It treated high-volume rows as far more informative than they are. With
NB and beta-binomial weights, each row's information about a fighter saturates at the per-fight noise level.
The NB shapes k and beta-binomial rho are moment estimates on held-out 2016 fights, from a fit at
2016-01-01, so they use pre-2019 data only:

| NB k | d_att 4.20, c_att 1.29, g_att 0.31, h_att 4.82, b_att 3.43, l_att 1.26, ns_att 0.70, kd 2.88, td_att 2.97, ctrl 2.26, sub_att 0.82, rev 0.30 |
|---|---|
| **beta-binomial rho** | d_acc 0.027, c_acc 0.032, g_acc 0.063, h_acc 0.053, b_acc 0.079, l_acc 0.062, td_acc 0.105 |

**Priors.**
- Fighters and loadings get the same L2 prior strength lambda. This is a nuclear-norm-like penalty on the
  fighter x task matrix, so it also picks the effective rank (see the axes section).
- Division offsets shrink toward each task's global intercept (ridge 2). The era and five-round slopes have
  ridge 1.
- The first CV pass had a ridge toward zero on the intercepts. With a one-year half-life, one division's
  reversal rate collapsed and that row's deviance blew up (table below).

**Fitting.** MAP by alternating block Newton, one sweep at a time:
1. A weighted GLM step per task.
2. A 2K x 2K Newton step per fighter, including Gauss-Newton terms from the win head.
3. A logistic step for the head.
4. An exact rebalancing of the factor scales. Predictions are unchanged and the prior term falls.

Every step is backtracked, so the objective falls monotonically. The analytic gradient was checked
numerically (max relative error 1.5e-5). L-BFGS on the same objective was far slower on this shared machine,
because it crawls along the fighter/loading scale direction.

**Time.**
- Rows are weighted 0.5^((T - date) / half-life).
- A full refit runs at the start of every quarter. It is warm-started from the previous quarter and
  Procrustes-aligned to it. That rotation is an exactly equivalent solution, so the axes keep their meaning
  across refits.
- After every event a **light update** runs: three Newton steps on the fighters who just fought, with the
  loadings frozen. The embedding used for a fight dated d has therefore seen every UFC fight before d and
  nothing from d on.
- Test on Q1 2019, light updates vs a full refit:
  - Embedding correlation with the full refit: 0.983 (0.849 for stale embeddings).
  - Q2 held-out win log loss: 0.656 stale, 0.645 with light updates, 0.639 with the full refit.
  - Q2 held-out stat deviance: 21,985 stale, 20,998 light, 20,593 full.
- The 2010-2017 and 2018-2025 halves ran as two processes and were stitched by Procrustes at 2018-01-01
  (762 active fighters, correlation 0.9987, relative RMS difference 0.05). See "Bug found and fixed" for the
  quarter-index fix in the stitched walk.

**Axes.**
- Rotated to the varimax solution of the loadings of the 2019-01-01 refit (training data only).
- Offense axes are signed so the largest loading is positive. Defense axes are signed so that positive means
  opponents do less of the dominant task.
- Scaled to unit sd over fighters with a decayed fight count >= 1 at 2019-01-01. Near-unused axes keep the
  live axes' scale instead, so they don't turn into amplified noise.
- Ordered by effect on predictions.

### Hyperparameters: time-ordered CV on 2019-2023

Half-year refits, each scoring the next six months of fights in which both men had an earlier stat fight
(1,873 decisive fights for the win head; all directed rows for the 21 tasks). Relative deviance is the model's
held-out deviance divided by that of an intercept-only model (division x era x 5-round) on the same rows,
averaged over the 21 tasks. The score is mean relative deviance + win log loss / ln 2 (equal weight for stat
lines and winner). K = 8 per side and head ridge 10 were fixed.

| lambda | half-life (d) | defense prior x | win weight | mean rel. deviance | win log loss | score |
|---|---|---|---|---|---|---|
| **30** | **730** | **1** | **1** | **0.9071** | **0.6607** | **1.8603** |
| 15 | 730 | 1 | 1 | 0.9401 | 0.6719 | 1.9095 |
| 60 | 730 | 1 | 1 | 0.9234 | 0.6629 | 1.8797 |
| 30 | 365 | 1 | 1 | 0.9270 excl. reversals (blow-up, see above) | 0.6659 | n/a |
| 30 | 1460 | 1 | 1 | 0.9118 | 0.6724 | 1.8819 |
| 30 | 730 | 2 | 1 | 0.9172 | 0.6657 | 1.8776 |
| 30 | 730 | 1 | 4 | 0.9069 | 0.7255 | 1.9536 |

The chosen point is interior in every direction tried. A heavier win weight leaves the stat lines unchanged
but overfits the head badly. The CV ran before the intercept ridge was added, so the noise shapes differ
slightly from the final ones. `--skip-cv` reuses these results; a plain run recomputes them with the current
code.

Per-task CV relative deviance at the chosen point (1 = intercept-only; lower is better):

| distance att. 0.905 | clinch att. 0.902 | ground att. 0.852 | head att. 0.912 | body att. 0.825 | leg att. 0.759 | non-sig. att. 0.916 |
|---|---|---|---|---|---|---|
| **distance acc. 0.892** | **clinch acc. 0.978** | **ground acc. 0.982** | **head acc. 0.901** | **body acc. 0.943** | **leg acc. 0.953** | **KD per head 0.990** |
| **TD att. 0.712** | **TD acc. 0.961** | **control 0.773** | **sub. att. 0.952** | **reversals 0.980** | **KO hazard 0.984** | **sub. hazard 0.977** |

## Validation results (2024-2025, scored once after the fix)

### Bug found and fixed in this relaunch

The first build ran the walk as two processes (2010-2017 and 2018-2025) and stitched them. Each process numbered
its quarterly refits from 0. The stitched list put chunk 1's 32 quarters first, but chunk 2's fight records kept
their local numbers. Every 2018-2025 fight was therefore scored with the loadings, intercepts and win head of
the quarter eight years earlier: a 2025 fight used the 2017 refit.

This was not a look-ahead, since the parameters were older and not newer. It still degraded every downstream
number: a fight's embeddings were read through loadings fit eight years earlier. `stitch_and_orient` now shifts
chunk 2's indices, and `--stage extras` asserts that each snapshot's refit is the latest quarter before its
fight. The walks themselves were correct and were reused unchanged. Everything downstream was rebuilt:
calibration, table, winner and stat models, integration and recipe.

| 2024-2025 | first build (bug) | fixed |
|---|---|---|
| factor model, mean relative deviance vs context-only (21 tasks, calibrated) | 0.871 | **0.860** |
| embedding head log loss | 0.6461 | **0.6336** |
| head vs Elo | -0.0308 | **-0.0433** |
| this tool's logistic + embedding vs without | -0.0044 (n.s.) | -0.0036 (n.s.) |
| ML logistic + head | -0.0018 (n.s.) | -0.0025 (n.s.) |
| closing line + head | -0.0008 (n.s.) | -0.0013 [-0.0026, -0.0001] |
| LightGBM stat lines + embedding vs without | -1.59% | **-3.13%** |
| embedding's own stat line vs GLM baseline | +4.83% (worse) | **-2.62%** (better) |
| mlrates + embedding vs mlrates | -0.49% | **-1.68%** |

### The factor model on its own

Deviance is relative to a context-only model (division x era x five-round, with the defender's effect
included). These are walk-forward predictions, calibrated per task on 2010-2023.

| task | raw | calibrated | 95% CI vs context | task | raw | calibrated | 95% CI vs context |
|---|---|---|---|---|---|---|---|
| distance att. | 0.784 | 0.717 | [-0.34, -0.23] | KD per head | 0.984 | 0.972 | [-0.045, -0.014] |
| clinch att. | 0.875 | 0.861 | [-0.19, -0.08] | TD att. | 0.690 | 0.677 | [-0.38, -0.26] |
| ground att. | 0.924 | 0.919 | [-0.12, -0.04] | TD acc. | 0.956 | 0.955 | [-0.070, -0.018] |
| head att. | 0.813 | 0.749 | [-0.30, -0.20] | control | 0.708 | 0.694 | [-0.36, -0.26] |
| body att. | 0.741 | 0.740 | [-0.32, -0.20] | sub. att. | 0.947 | 0.939 | [-0.099, -0.025] |
| leg att. | 0.766 | 0.777 | [-0.27, -0.17] | reversals | 0.977 | 0.938 | [-0.094, -0.029] |
| non-sig. att. | 0.835 | 0.797 | [-0.28, -0.14] | KO/TKO hazard | 0.981 | 0.967 | [-0.052, -0.013] |
| distance acc. | 0.818 | 0.780 | [-0.26, -0.18] | sub. hazard | 0.970 | 0.938 | [-0.097, -0.029] |
| clinch acc. | 0.977 | 0.978 | [-0.040, -0.004] | head acc. | 0.867 | 0.834 | [-0.21, -0.12] |
| ground acc. | 0.979 | 0.980 | [-0.038, -0.003] | body acc. | 0.936 | 0.941 | [-0.087, -0.029] |
| leg acc. | 0.923 | 0.915 | [-0.12, -0.05] | **mean** | **0.878** | **0.860** | |

Win head:
- Calibration slope fit on 2010-2023: 1.071.
- Validation log loss: 0.6350 raw, 0.6336 calibrated.

### Winner models (this tool's downstream table, 854 decisive fights)

Setup:
- Training ran 2010-2023 on 4,672 fights.
- C for the logistic and boosting rounds for LightGBM were chosen by expanding-window CV over 2019-2023.
- Both models are mirrored with no intercept.
- The base features are the 54 decayed, shrunk per-side rates, plus Elo, age, reach, height and experience,
  the same construction as `backtest_dev.json`.
- `+ emb` adds 25 antisymmetric embedding features: the 16 vector differences, the head logit and 8 predicted
  log-rate differences.

| model | CV 2019-23 | log loss | Brier | accuracy | ECE | calibration slope |
|---|---|---|---|---|---|---|
| Elo | | 0.6769 | 0.2421 | 54.8% | 0.032 | 1.13 |
| embedding head | | 0.6336 | 0.2216 | 64.6% | 0.030 | 1.27 |
| logistic, base | 0.6521 | 0.6184 | 0.2143 | 66.6% | 0.047 | 1.41 |
| logistic + emb | 0.6461 | 0.6149 | 0.2129 | 67.2% | 0.057 | 1.40 |
| LightGBM, base | 0.6518 | 0.6276 | 0.2184 | 66.6% | 0.055 | 1.45 |
| LightGBM + emb | 0.6467 | 0.6219 | 0.2161 | 65.2% | 0.032 | 1.21 |

Paired deltas:
- logistic + emb vs base: -0.0036 [-0.0122, +0.0051]
- LightGBM + emb vs base: -0.0057 [-0.0167, +0.0052]
- head vs Elo: -0.0433 [-0.0607, -0.0264]

The embedding features improved time-ordered CV on 2019-2023 by 0.006 for both models. On validation the gain
is about half that size and inside the noise.

Calibration (deciles in both orientations, predicted / observed):
- head: 0.26/0.22, 0.34/0.32, 0.39/0.35, 0.44/0.42, 0.48/0.46 | 0.52/0.54, 0.56/0.58, 0.61/0.65, 0.66/0.68,
  0.74/0.78.
- logistic + emb: 0.24/0.18 ... 0.76/0.82.
- Every model is underconfident on 2024-25 (slopes above 1), as the backlog says of every input.

### Integration with the current best inputs (`validation.integration`)

Setup:
- Each set is a mirrored no-intercept logistic on the inputs' logits, unpenalised, fit on 2019-2023 and scored
  on 2024-2025.
- **base** is the inputs alone, recalibrated by that fit.
- **+head** adds the embedding head logit.
- **+head x exp** also adds head x g, with g = x_min / (1 + x_min) and x_min the smaller decayed fight count.
- The variant to keep (base, +head or +head x exp) is chosen by time-ordered expanding-window CV log loss inside
  2019-2023: fit on years before y, score y, for y = 2020..2023. Leave-one-year-out is reported as a diagnostic and
  agrees in every set.
  - Verification fix: the first version compared only +head with +head x exp, never with base, and reported that
    it "chose +head everywhere". With base in the comparison, train CV keeps the head for the ML logistic and the
    opening line only.
- Inputs: `ml.json` (`lr` = the 0.6062 logistic; `stack` = Elo + ML + market rating), `ratings.json`
  (`stack`), and `market.json` (power no-vig close, no-vig open).

| inputs | n train / valid | time-CV 2020-23 base / + head / + head x exp | chosen | base | + head | + head x exp | + head - base, 95% CI | slope base / + head |
|---|---|---|---|---|---|---|---|---|
| ML logistic | 1955 / 854 | 0.6463 / **0.6455** / 0.6457 | + head | 0.6087 (raw 0.6062) | 0.6063 | 0.6069 | -0.0025 [-0.0060, +0.0011] | 1.64 / 1.61 |
| no-line stack (Elo + ML + market rating) | 1955 / 854 | **0.6332** / 0.6347 / 0.6350 | base | 0.5952 (raw 0.5958) | 0.5941 | 0.5946 | -0.0012 [-0.0028, +0.0005] | 1.45 / 1.46 |
| no-line stack + ratings stack | 1955 / 854 | **0.6306** / 0.6321 / 0.6323 | base | 0.5913 | 0.5907 | 0.5913 | -0.0006 [-0.0015, +0.0003] | 1.40 / 1.40 |
| opening line | 1955 / 843 | 0.6341 / **0.6329** / 0.6331 | + head | 0.6064 (raw 0.6094) | 0.5976 | 0.5969 | **-0.0088 [-0.0143, -0.0036]** | 1.15 / 1.20 |
| closing line | 1955 / 845 | **0.6211** / 0.6218 / 0.6222 | base | 0.5849 (raw 0.5854) | 0.5836 | 0.5834 | -0.0013 [-0.0026, -0.0001] | 1.07 / 1.09 |
| closing line + no-line stack | 1955 / 845 | **0.6193** / 0.6209 / 0.6213 | base | 0.5784 | 0.5788 | 0.5789 | +0.0004 [-0.0003, +0.0011] | 1.14 / 1.13 |

- `validation.integration.sets[*].deltas["chosen - base"]` is 0 where base is chosen. The "+ head - base" column is
  the diagnostic delta for every set.
- Stack weights on the head logit: 0.27 on top of the ML logistic, 0.13 on top of the no-line stack, 0.07 with
  the ratings stack added, 0.35 on the open, 0.09 on the close, and -0.05 on close + stack.
- Train-window caveats, which do not touch validation: `ratings.json` marks its stack in-sample for 2019, and
  `ml.json`'s stack weights were fit on the same 2019-2023 out-of-fold rows. Both make the base look slightly better
  on the training rows than it will out of sample, which works against the head in the CV.
- Side result: on these rows the ratings stack improves the no-line stack by about 0.004, from 0.5952 to
  0.5913. That is outside this tool's scope; it is flagged here for whoever owns the stack.

### Segments (`validation.winner_segments`, `validation.integration.segments`)

Segments are by fight. "min UFC fights" counts prior UFC fights of the less experienced man; the backtest
requires at least 1 for both. Favourite terciles use the base model's |p - 0.5|. The "no-line best + head" and
"close + head" columns are diagnostics: train CV does not select the head for those inputs.

| segment | n | logistic + emb vs base | head vs Elo | ML logistic + head | no-line best + head | close + head |
|---|---|---|---|---|---|---|
| min UFC fights 1-2 (newcomer) | 262 | -0.0026 [-0.021, +0.014] | -0.026 [-0.059, +0.005] | -0.0025 [-0.010, +0.005] | -0.0002 [-0.002, +0.002] | -0.0008 [-0.003, +0.002] |
| min 3-5 | 238 | -0.0098 [-0.025, +0.005] | -0.047 [-0.079, -0.014] | -0.0019 [-0.009, +0.005] | -0.0000 [-0.002, +0.002] | -0.0010 [-0.003, +0.001] |
| min 6+ | 354 | -0.0001 [-0.012, +0.011] | -0.054 [-0.078, -0.029] | -0.0028 [-0.008, +0.002] | -0.0012 [-0.003, +0.000] | -0.0019 [-0.004, -0.000] |
| 2024 | 429 | -0.0028 [-0.015, +0.009] | -0.039 [-0.065, -0.016] | -0.0015 [-0.007, +0.004] | -0.0005 [-0.002, +0.001] | -0.0010 [-0.002, +0.001] |
| 2025 | 425 | -0.0044 [-0.017, +0.008] | -0.047 [-0.071, -0.025] | -0.0035 [-0.009, +0.001] | -0.0006 [-0.002, +0.001] | -0.0017 [-0.004, +0.000] |
| five-round | 105 | **-0.0249 [-0.048, -0.003]** | -0.061 [-0.111, -0.006] | -0.0073 [-0.018, +0.002] | -0.0015 [-0.004, +0.001] | **-0.0041 [-0.008, -0.001]** |
| three-round | 749 | -0.0006 [-0.010, +0.009] | -0.041 [-0.061, -0.022] | -0.0018 [-0.006, +0.002] | -0.0004 [-0.001, +0.001] | -0.0009 [-0.002, +0.000] |
| women | 147 | -0.0128 [-0.031, +0.005] | -0.060 [-0.100, -0.020] | -0.0032 [-0.011, +0.006] | -0.0014 [-0.004, +0.001] | -0.0019 [-0.005, +0.001] |
| men | 707 | -0.0016 [-0.012, +0.009] | -0.040 [-0.059, -0.021] | -0.0023 [-0.006, +0.002] | -0.0004 [-0.001, +0.001] | -0.0012 [-0.003, +0.000] |
| toss-ups | 285 | -0.0063 [-0.019, +0.007] | -0.014 [-0.039, +0.012] | -0.0009 [-0.008, +0.006] | -0.0016 [-0.004, +0.000] | -0.0022 [-0.005, +0.001] |
| middle third | 284 | +0.0017 [-0.014, +0.018] | -0.040 [-0.070, -0.009] | -0.0008 [-0.008, +0.006] | +0.0008 [-0.001, +0.003] | -0.0010 [-0.003, +0.001] |
| clear favourites | 285 | -0.0060 [-0.021, +0.009] | -0.076 [-0.104, -0.048] | -0.0056 [-0.011, -0.000] | -0.0009 [-0.002, +0.000] | -0.0008 [-0.003, +0.001] |

The newcomer gap, on the same 2024-25 rows (log loss):

| min UFC fights | n | close | ML logistic | no-line stack | embedding head | mean x_min |
|---|---|---|---|---|---|---|
| 1-2 | 259 | 0.604 | 0.633 | 0.616 | 0.656 | 1.10 |
| 3-5 | 236 | 0.560 | 0.580 | 0.556 | 0.618 | 2.38 |
| 6+ | 350 | 0.588 | 0.597 | 0.602 | 0.622 | 3.50 |

The embedding cannot help newcomers in its current form. A man with one or two UFC fights has a vector shrunk
almost to the division-average zero. The natural next step is a cold-start prior: a prior mean for the vectors
regressed on pre-UFC covariates from `preufc.json`. See the open threads.

### Stat lines

**This tool's per-stat models.** These are directed rows: both sides of every 2024-25 backtest fight, 1,730
rows; training used 9,534 rows from 2010-2023.
- The GLM baseline is a Poisson regression on the log5 rate, the attacker's and defender's shrunk rates, the
  prior and context.
- The GBM baseline adds every per-side feature.
- `+ emb` adds the embedding's predicted rate for that stat and the 8 offense and 8 defense coordinates. The
  GBM version also gets the other stats' predicted rates.
- "emb alone" is the factor model's own prediction. "blend" is log rate = b0 + b1 log(log5) + b2 log(emb).

All values are deviance relative to the GLM baseline:

| stat | GBM base | GLM + emb | GBM + emb | emb alone | blend | GLM + emb vs GLM, 95% CI | GBM + emb vs GBM, 95% CI |
|---|---|---|---|---|---|---|---|
| sig. attempts | 0.955 | 0.957 | 0.926 | 0.985 | 0.973 | -4.3% [-6.7, -2.2] | -3.1% [-4.8, -1.2] |
| sig. landed | 0.971 | 0.971 | 0.923 | 0.969 | 0.953 | -2.9% [-4.9, -0.9] | -5.0% [-6.6, -3.3] |
| head landed | 0.977 | 0.966 | 0.930 | 0.982 | 0.962 | -3.5% [-5.5, -1.5] | -4.8% [-6.5, -3.1] |
| body landed | 0.962 | 0.956 | 0.919 | 0.938 | 0.930 | -4.4% [-6.4, -2.5] | -4.5% [-6.4, -2.4] |
| leg landed | 0.988 | 0.976 | 0.969 | 1.005 | 0.969 | -2.5% [-4.1, -0.7] | -1.8% [-2.8, -0.9] |
| knockdowns | 0.982 | 0.979 | 0.980 | 0.992 | 0.989 | -2.1% [-3.2, -1.0] | -0.2% [-1.1, +0.7] |
| TD attempts | 0.951 | 0.932 | 0.915 | 0.939 | 0.940 | -6.8% [-9.4, -4.0] | -3.8% [-5.9, -1.5] |
| TD landed | 0.952 | 0.925 | 0.933 | 0.929 | 0.928 | -7.5% [-10.1, -4.9] | -2.0% [-4.2, +0.1] |
| control | 0.954 | 0.926 | 0.906 | 0.935 | 0.936 | -7.3% [-10.2, -4.5] | -5.0% [-7.5, -2.8] |
| sub. attempts | 0.997 | 0.981 | 0.986 | 1.064 | 0.993 | -1.9% [-3.6, -0.3] | -1.1% [-2.6, +0.4] |
| **mean** | 0.969 | 0.957 | **0.939** | 0.974 | 0.957 | **-4.32% [-5.37, -3.34]** | **-3.13% [-4.08, -2.20]** |

**On top of the verified mlrates stat-line model** (`validation.stats.mlrates_blend`; the integration
recipe). Per mlrates target:

    link(rate) = b0 + b1 link(mlrates) + b2 eta_embedding[task]

- Fit on mlrates' 2019-2023 out-of-fold rows (3,998). Scored on mlrates' dev model for 2024-2025 (1,730 rows).
- The comparison is with the recalibrated mlrates (b2 = 0), so the gain is the embedding's alone.
- The recalibration itself changes nothing: +0.01% [-0.13, +0.15].

The keep rule is time-ordered expanding-window CV inside 2019-2023 (fit on years before y, score y, for y =
2020..2023). Leave-one-year-out is the diagnostic. The validation column fits b2 for every target; the exported b2 is 0
where the CV rejected the term.

| target | time CV 2020-23 | LOYO 2019-23 | validation, 95% CI | exported b2 | target | time CV 2020-23 | LOYO 2019-23 | validation, 95% CI | exported b2 |
|---|---|---|---|---|---|---|---|---|---|
| distance att. | -0.55% | -1.01% | -2.13% [-3.47, -0.78] | 0.32 | head acc. | -1.83% | -1.69% | -2.86% [-4.12, -1.60] | 0.52 |
| clinch att. | -0.72% | -0.55% | -0.44% [-1.65, +0.80] | 0.41 | body acc. | -0.42% | -0.42% | -2.57% [-3.40, -1.76] | 0.39 |
| ground att. | -0.62% | -0.56% | -0.72% [-2.05, +0.62] | 0.37 | leg acc. | -0.36% | -0.73% | -3.63% [-5.25, -1.97] | 0.51 |
| head att. | -1.28% | -1.39% | -2.58% [-3.94, -1.18] | 0.36 | distance acc. | -1.92% | -1.74% | -5.11% [-6.72, -3.59] | 0.50 |
| body att. | -0.63% | -0.74% | -2.03% [-3.08, -0.96] | 0.33 | clinch acc. | -0.29% | -0.44% | -2.33% [-3.77, -0.92] | 0.56 |
| leg att. | -0.25% | -0.22% | -0.45% [-1.11, +0.24] | 0.20 | ground acc. | +0.10% | +0.01% | -0.13% [-0.77, +0.51] | **0** |
| TD att. | -1.63% | -1.41% | -2.00% [-3.26, -0.64] | 0.43 | TD acc. | +0.03% | -0.00% | -0.04% [-0.41, +0.36] | **0** |
| sub. att. | -0.02% | -0.09% | +0.17% [-0.71, +0.96] | 0.23 | KD per landed head | +0.16% | +0.11% | -0.00% | **0** |
| reversals | +0.04% | +0.01% | -0.00% | **0** | control | -1.90% | -1.92% | -3.30% [-5.02, -1.59] | 0.46 |

| rows | n | exported recipe (CV-selected, 14 targets keep b2) | all 18 targets (reference) |
|---|---|---|---|
| all | 1730 | **-1.67% [-2.11, -1.24]** | -1.68% [-2.13, -1.23] |
| attacker 1-2 UFC fights | 326 | -1.51% [-2.31, -0.69] | -1.57% [-2.36, -0.75] |
| attacker 3-5 | 383 | -1.37% [-2.17, -0.55] | -1.41% [-2.20, -0.57] |
| attacker 6+ | 1021 | -1.82% [-2.31, -1.35] | -1.81% [-2.29, -1.33] |
| fight with a 1-2 fight newcomer | 536 | -1.22% [-1.96, -0.37] | -1.26% [-2.01, -0.42] |
| 2024 | 866 | -1.47% [-1.99, -0.95] | -1.47% [-2.00, -0.93] |
| 2025 | 864 | -1.88% [-2.57, -1.24] | -1.90% [-2.61, -1.23] |

- Time-ordered CV inside 2019-2023 keeps the term for 14 of 18 targets. It rejects reversals, ground accuracy,
  takedown accuracy and knockdowns per landed head strike. LOYO also kept TD accuracy, at -0.00%.
- The exported recipe (`embed_model.json` `mlrates_blend.targets`, the `blendMLRates` default) is the CV-selected
  one. `targets_all` keeps b2 everywhere and is a reference only.
  - Verification fix: the builder had exported all 18 targets because the CV-selected recipe "scored worse on
    validation" (by 0.01%). That was a choice made on validation, so it was reversed.
- Knockdowns and reversals get b2 of about 0 even when it is fitted: the embedding adds nothing to mlrates'
  knockdown model.
- The embedding helps most where it is opponent-adjusted by construction: accuracy, the defender's share of
  it, and grappling control.

### Look-ahead and protocol checks (`validation.leak_check`)

Pre-fight vs post-fight vectors, scored on 1,300 directed 2024-25 rows (attackers with a later fight). Deviance
is relative to the defender-only prediction:

| vector | value |
|---|---|
| exported snapshot | 0.902 |
| the attacker's vector at his next fight | 0.750 |

- Per-task examples: head attempts 0.850 vs 0.491, TD attempts 0.691 vs 0.464, control 0.741 vs 0.540.
  Exported snapshots that had seen the fight would score like the second column.
- Exposure behind each snapshot equals the decayed count of strictly earlier stat fights: 0 of 2,074
  mismatches.
- Snapshot refits: each is the latest quarterly refit before the fight (asserted on every run of
  `--stage extras`).
- Hyperparameters, noise shapes, varimax orientation, per-task calibration, winner and stat model tuning, blend
  coefficients and variant selection all use data before 2024. Validation was read once per build. The
  verification corrected two selection rules that did not follow this (see the log at the end).

## What the dimensions mean

Axes are rotated to varimax on the 2019-01-01 refit (training data only) and scaled to unit sd over fighters
with a decayed fight count of at least 1 on that date.
- **Effect** is an axis's movement of predictions (loading norm x fighter sd), as a share of the largest axis.
- **Offense loadings** are the change in the attacker's log-rate or logit per unit.
- **Defense axes** are signed so that positive means opponents do less of the axis's dominant task.
- **Leaders** are fighters with a decayed fight count of at least 2 at 2026-01-01.
- The labels are hand labels (`AXIS_LABELS` in the tool).

| axis | effect | label | largest loadings (calibrated) | high | low |
|---|---|---|---|---|---|
| o0 | 1.00 | grappling offense: takedowns, control, submissions | td_att +0.58, sub_fin +0.46, ctrl +0.41, sub_att +0.32 | Chimaev, Hernandez, Dvalishvili, Almeida, de Ridder, Saint-Denis | Rountree, O'Malley, Prates, Cavalcanti |
| o1 | 0.60 | distance head-strike volume (striker, not a submitter) | h_att +0.17, d_att +0.15, sub_fin -0.13, ko_fin +0.12 | Ateba Gautier, Strickland, Pavlovich, Amil, Oezdemir, Vettori | Suarez, Valentin, Veretennikov, Mitchell |
| o2 | 0.50 | finishing striker: accuracy and KO power | ko_fin +0.15, d_acc +0.13, h_acc +0.13, g_att +0.12 | Aspinall, O'Malley, Kape, Pereira, Aliskerov, Gane | Maksum, Dumas, Guida, Maheshate |
| o3 | 0.47 | leg-kick volume | l_att +0.33, g_att -0.11, sub_fin -0.07 | Gutierrez, Petrosyan, Pennington, Edwards, Rosa, Shara Magomedov | Almeida, Sabatini, Lewis, McKinney |
| o4 | 0.45 | body-strike volume | b_att +0.23, c_att +0.08, l_att +0.07 | Njokuani, Michel Pereira, Gane, Stirling, Battle, Ochoa | Dulgarian, Solecki, Marshall, Radtke |
| o5 | 0.38 | clinch volume and dirty boxing | c_att +0.24, ns_att +0.08, b_acc +0.06 | Barriault, Dvalishvili, Aslan, Xiao Long, Leal, Yan | Amorim, Ponzinibbio, Petroski, Robertson |
| o6 | 0.23 | top-position damage and finishing | g_att +0.17, ko_fin +0.11, sub_fin +0.11, ns_att +0.10 | Diego Lopes, Pereira, Chimaev, Dawson, McKinney, Almeida | Ponzinibbio, Johns, Anthony Smith, Pinheiro |
| o7 | 0.22 | efficient close-range and leg striking (weak) | c_acc +0.08, l_acc +0.07, b_acc +0.06 | Joshua Van, Makhachev, Talbott, Alvarez, Lima, Allen | Pennington, Aslan, Maheshate, Pinheiro |
| d0 | 1.00 | anti-grappling: hard to take down, hold or submit | sub_fin -0.34, g_att -0.31, ctrl -0.31, td_acc -0.23 | Strickland, Ulberg, Zahabi, Kape, Fiorot, Blanchfield | Tafa, Holobaugh, Brundage, Parisian |
| d1 | 0.88 | denies distance striking (fights go to the mat; more reversals against) | rev +0.22, h_att -0.18, d_att -0.15, ko_fin -0.15 | Almeida, Sabatini, Dulgarian, Wells, Suarez, Chimaev | Marquez, Ducote, Joshua Van, Gall |
| d2 | 0.62 | hard to hit clean or finish | ko_fin -0.15, g_att -0.13, l_acc -0.13, h_acc -0.12 | Shevchenko, Makhachev, Suyoung You, Page, Luana Santos, Cavalcanti | Westin Wilson, Demopoulos, Tiuliulin, Lacerda |
| d3 | 0.55 | keeps fights out of the clinch (eats more leg kicks) | c_att -0.20, l_att +0.07, ko_fin -0.07 | Pavlovich, Ulberg, Gutierrez, Ogden, Blachowicz, Magny | Xiao Long, Barriault, Devin Clark, Reese |
| d4 | 0.51 | opponents rarely shoot on him | td_att -0.23, rev +0.13, g_att +0.09, ko_fin +0.09 | Dawson, Almeida, Muniz, Mitchell, Sabatini, Kazama | Prates, Jean Silva, Pereira, Yan |
| d5 | 0.35 | denies body and leg kicks (weak) | b_att -0.09, rev +0.09, l_att -0.07 | Almeida, de Ridder, Diniz, Almakhan, Robertson | Strickland, Morono, Gore, Kape |
| d6 | 0.23 | denies clinch accuracy (weak) | c_acc -0.05, l_acc +0.04 | Blanchfield, Fiorot, Jean Silva, Nolan, Ochoa, Topuria | Klose, Mokaev, Carnelossi, Khaos Williams |
| d7 | 0.16 | denies leg-kick accuracy (weak) | l_acc -0.10, b_acc -0.04 | Potieria, Johns, Bonfim, King Green, Zalal | Magny, Cortes-Acosta, Elekana, Mike Davis |

- The defense axes measure what opponents manage against a man, which mixes his skill with the fights he gets
  into. d1 and d4 are mostly grapplers: their opponents throw little at distance because they spend the fight
  underneath, and they reverse more because they are on the bottom.
- o7, d5, d6 and d7 move predictions by a quarter or less of the main axes; treat them as noise-level.
- The L2 prior acts like a nuclear-norm penalty, so it picks the effective rank. Among active men, the linear
  win head's direction carries 18% of the standardised profile variance.

## Volkanovski and Gaethje

Embeddings at 2026-01-01, in sd units:

| | o0 grappling | o1 head vol. | o2 finishing | o3 legs | o4 body | o5 clinch | o6 top | o7 | d0 anti-grap. | d1 | d2 hard to hit | d3 | d4 | d5 | d6 | d7 | decayed fights |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Volkanovski | +0.93 | +0.44 | **+2.17** | **+1.59** | -0.04 | **+1.54** | +0.64 | -1.16 | **+2.11** | +0.62 | **+1.45** | -0.66 | +0.83 | -0.46 | -0.41 | +0.29 | 4.11 |
| Gaethje | -1.19 | +0.04 | **+2.11** | +1.04 | -0.32 | **+2.16** | -0.30 | +1.22 | **+1.52** | -0.64 | +0.54 | -0.99 | +0.58 | -1.53 | -1.29 | -1.12 | 3.41 |

**Profile signatures** are the largest standardised effects on predicted stats; "def" effects are what
opponents do against him.
- **Volkanovski:** distance accuracy +2.3 sd, head accuracy +2.0. Opponents get less control (-2.0), fewer
  submission finishes (-2.0), fewer ground strikes (-1.9), fewer takedown attempts (-1.7) and lower takedown
  accuracy (-1.6). His attempt profile is high clinch (+1.4), leg-kick (+1.4) and ground (+1.1) volume, with
  modest takedown attempts (+0.5). Quality score +1.97 sd.
- **Gaethje:** distance accuracy +2.4 sd, body accuracy +2.2, head accuracy +1.7, KO finishing +1.7,
  knockdown power +1.6. Opponents throw more to his body (+1.6) and control him less (-1.6). He shoots almost
  never (-1.5). His attempt profile is high clinch (+1.4) and leg-kick (+1.2) volume, with no takedowns,
  control or submissions. Quality score +0.86 sd.

**Nearest neighbours.** The pool is men with a decayed fight count of at least 2 and a fight in 2023-2025.
Distances are on the 42-effect standardised profile.

| view | Volkanovski | Gaethje |
|---|---|---|
| profile distance (style + quality) | Bo Nickal 3.44, Chris Padilla 4.39, Jared Cannonier 4.44, John Castaneda 4.60, Rinat Fakhretdinov 4.63, Jamall Emmers 4.71 | Geoff Neal 3.56, Jonathan Martinez 4.16, Jiri Prochazka 4.35, Paulo Costa 4.42, Jared Cannonier 4.53, Nathaniel Wood 4.56 |
| style cosine, win-head direction removed | Bo Nickal 0.84, John Castaneda 0.80, Jack Hermansson 0.73, Mick Parkin 0.71, **Justin Gaethje 0.65**, Cody Stamann 0.65 | Geoff Neal 0.87, Joshua Van 0.83, Paulo Costa 0.82, Manel Kape 0.82, Kevin Jousset 0.81, Jonathan Martinez 0.80 |
| attempt profile cosine (what he tries to do) | Dricus du Plessis 0.94, Da'Mon Blackshear 0.92, Jean Matsumoto 0.89, Zach Reese 0.86, Tim Elliott 0.86, Rinat Fakhretdinov 0.86 | Tai Tuivasa 0.95, Sumudaerji 0.94, Cub Swanson 0.92, Shara Magomedov 0.92, Bryan Barberena 0.90, Marlon Vera 0.88 |
| profile distance, 145-170 lb only | Chris Padilla 4.39, John Castaneda 4.60, Rinat Fakhretdinov 4.63, Jamall Emmers 4.71, Kamaru Usman 5.03, Ian Machado Garry 5.11 | Geoff Neal 3.56, Nathaniel Wood 4.56, John Castaneda 4.65, Cub Swanson 4.87, Rongzhu 5.10, Rafael Fiziev 5.19 |

Reading them:
- The full profile matches Volkanovski with fighters whose opponents achieved little in the grappling tasks.
  Bo Nickal has three dominant UFC fights, so his vector is extreme, and dominance pulls the two together.
- Removing the quality direction does not change that much. The attempt profile is the cleanest style view.
  Volkanovski's twins mix volume striking with clinch and ground work; Gaethje's are leg-kicking pocket
  strikers who do not wrestle.
- Neighbours are style descriptions, not inputs to any model.
- `embed.js` `styleNeighbours` reproduces the attempt-profile view on the whole roster, with no activity or
  sex filter.

**Matchup from the embedding alone** (`embed.js`, Lightweight, 5 rounds):
- Head: P(Volkanovski) = 0.672.
- Per-minute significant strikes landed: 6.11 vs 4.63. Takedowns landed: 0.057 vs 0.011.
- For comparison, the backlog lists openers of about 37% for Volkanovski (no-vig, Oct 24-25) and the walk-forward
  market rating at 63.5%. The head is one stacker input, and the integration table shows how little weight it
  earns next to the line. It is not a forecast.

## Integration recipe

**Per-snapshot data** (`data/derived/embed.json`):
- `snapshots[fight_id]` covers every `backtest_dev.json` fight, 2019-2025. Fields:
  - `A`, `B`: 16 floats each, `[o0..o7, d0..d7]`.
  - `xA`, `xB`: decayed fight counts behind the vectors.
  - `q`: index of the quarterly refit in `quarters`.
  - `win_logit`: calibrated head logit, P(A) = sigmoid(win_logit).
- `train_snapshots[fight_id]` holds the same fields for 2010-2018 fights, plus `date`, `a`, `b` slugs.
- `quarters[q]` holds `C`, `W`, `V`, `ua`, `ud` and `M`, already calibrated. Task predictors for a backtest
  fight are therefore exact up to the 4-decimal export rounding (the head logit moves by at most 0.0024):
  `eta_t = C[t][0] + C[t][1 + div] + C[t][14] * era + C[t][15] * five + W[t] . o_X + V[t] . d_Y`. Here `era` is (date - 2015-01-01) / 3652.5 days, `div` indexes `model.divs`
  (13 divisions), and `C` has 16 columns. In JS, `FightEmbed.load({...embed_model, C, W, V, ua, ud, M})`
  with a quarter's matrices gives the same numbers.
- **Roster** (`roster[slug] = [16 floats, expo]`) is the fit at 2026-01-01. Its last fight used is 2025-12-13.
  1,098 roster fighters have UFC stat fights. Unknown fighters get the zero vector, the division average.

**Winner stack (MoE / no-line stack).** The only embedding input worth offering is `win_logit`, as one more logit
in the mirrored no-intercept stack. The 16 raw dimensions and the predicted-rate differences overfit on top of ML
(+0.016 to +0.018, see above).
- By this tool's train-only rule (time-ordered CV inside 2019-2023), the head is **rejected** on top of the no-line
  stack, the ratings stack, the closing line and the close + stack. Its validated contribution there is 0.
- It is kept only on top of a single model (ML logistic, -0.0025, n.s.) and the opening line (-0.0088
  [-0.0143, -0.0036]).
- So: offer it to the stacker as a candidate. Let the stacker's own time-ordered CV on 2019-2023 decide, and expect
  it to be dropped wherever the no-line stack or the close is present. Do not quote the -0.0006 to -0.0013 diagnostic
  deltas as gains.

**Stat-line model (mlrates -> engine v4+).** This is where the embedding earns its place. Per side:

    MLRates prediction for X vs Y  ->  FightEmbed.blendMLRates(mlSide, etaXY)

The per-target coefficients are in `embed_model.json` `mlrates_blend.targets`, the CV-selected recipe: b2 = 0 for
reversals, ground accuracy, takedown accuracy and knockdowns. They were fit on mlrates' 2019-2023 out-of-fold rows and
validated on 2024-2025. In the browser:

    var E = FightEmbed.load(embedModel), m = E.matchup(a, b, {division, rounds: 5});
    var blendedA = E.blendMLRates(mlratesSideA, m.etaA), blendedB = E.blendMLRates(mlratesSideB, m.etaB);

In a backtest, use the snapshot vectors and the fight's quarter as above. Do not use the roster vectors for
past fights.

**Release refit.** The blend coefficients and the head calibration were fit on data before 2024. At release,
refit the blend on 2019-2025 out-of-fold rows, and rerun `tools/embed.py` so the roster includes the newest
fights. Every input is underconfident on 2024-25 (calibration slopes 1.1-1.6 above). Recalibrate the final
blend, not the embedding head on its own.

## JS evaluator and test

- `src/ml/embed.js`: dependency-free UMD (Node, browser, Web Worker). It provides `matchup(a, b, opts)` (head
  probability, task predictors, per-minute stat line), `neighbours` (profile distance), `styleNeighbours`
  (attempt-profile cosine), `blendMLRates` (the stat-line recipe), `embedding` and the low-level `eta`,
  `rates` and `winLogit`.
- `tests/test_embed.js` (`node tests/test_embed.js`) checks the JS against the Python outputs in
  `embed_model.json`:
  - 30 matchups: head probability, all 21 task predictors and the derived rates, to 1e-9 relative, plus
    corner antisymmetry.
  - Zero vectors give a coin flip.
  - Profile neighbours are sorted.
  - 12 real 2024-25 validation rows through `blendMLRates`.
  - Style neighbours for both men, in order, with cosines.
  - Added in verification, a tie to the real pipeline rather than a Python twin: all 2,864 2019-2025 snapshots in
    `embed.json`, run through `embed.js` with their quarter's matrices, reproduce the walk's own unrounded win logits
    to the export rounding (max 2.4e-3). Swapping corners negates each logit exactly.

## Reproduce

    python3 tools/embed.py --cache <dir>                     # noise, CV, walk (two chunks), downstream, outputs
    python3 tools/embed.py --cache <dir> --stage walk --chunk 1 &  python3 tools/embed.py --cache <dir> --stage walk --chunk 2
    python3 tools/embed.py --cache <dir> --skip-cv           # downstream + outputs from cached walks
    python3 tools/embed.py --cache <dir> --skip-cv --stage extras   # integration, segments, blend recipe,
                                                             # neighbours, leak check; merges into the JSONs
    node tests/test_embed.js

Runtime on the shared machine (load average about 80):
- noise and CV, 7 configurations of half-year refits: about 20 minutes;
- each walk chunk: about 20 minutes;
- downstream: about 25 minutes;
- extras: under 1 minute.

## Open threads

1. **Cold-start prior for newcomers.** This is where the remaining winner gap is: the head scores 0.656 vs
   the close's 0.604 in newcomer fights. Make the prior mean of a debut fighter's vector a learned function of
   pre-UFC covariates (`preufc.json` debut snapshots: record, finish rates, opponent quality, age, height,
   reach). Fit it on training fighters only, then re-run the walk. It needs a `Fit` prior centred on mu_i
   instead of 0, plus a train-only fit of the mapping.
2. **The five-round signal** (-0.025 for the feature models) is a post-hoc hypothesis. Check it at the next
   audit. Volk vs Gaethje is a five-rounder.
3. **Per-task calibration** was fit on 2010-2023 pooled. A recency-weighted window chosen by time-ordered CV
   inside training may help distance and head volume, where the shrink factors are 0.58-0.60.
4. **Engine.** Feed `blendMLRates` output into `FightEngine.loadMLRates` and measure the simulator's winner,
   method and round with `tools/evalv.js`. That is the engine cycle's call and is not done here.
5. **K sweep.** K = 8 per side was fixed in the CV. Sizes 6 and 12 were not tried. The nuclear-norm-like prior
   leaves 4 of the 16 axes weak, so a larger K is unlikely to help.

## Verification log

Adversarial review, Nov 6, 2026, about 4:05-4:45 pm UTC. The reviewer assumed every validation gain was fake until
shown otherwise. It used fresh code and its own scripts (scratchpad `embed_verify/`), with `nice -n 5`, one thread
per process and no more than two processes at a time.

**Verdict.** No leakage found:
- no 2026 data;
- no look-ahead in the walk;
- no corner exploitation;
- clean joins;
- every exported number reproduces.

Two selection rules broke the hidden-data protocol. Both are fixed, and the fixes change the winner-side conclusions:
- the head no longer earns a validated slot next to the no-line stack or the close;
- the stat-line gain stands at -1.67% [-2.11, -1.24].

### What was checked

1. **Hidden data.**
   - `load_data` drops fights from 2026-01-01 on before any fit. The last fight used is 2025-12-13.
   - `embed.json` and `embed_model.json` hold no date in 2026 other than the build timestamp and the 2026-01-01
     roster/era date.
   - Every snapshot id is a `backtest_dev.json` id (2019-01-19..2025-12-13), and the training snapshots end on
     2018-12-29.
   - `ml.json` `lr`/`stack` are out-of-fold for 2019-2023 (`set: oof`) and trained on 2010-2023 for 2024-25
     (`set: test`).
   - `mlrates_oof.json` holds time-ordered folds (`cv<year>`) for 2019-2023 and the 2010-2023 dev model for 2024-25.
   - `ratings.json` (built 3:44 pm, unchanged since) is read for backtest ids only. Its stack is in-sample for 2019.
     That affects the training rows only.
   - The closing and opening lines are stacking inputs only and never a feature of the embedding.
   - The Elo hyperparameters (`elo_report.json`) were tuned on 2019-2023.
   - The five-round flag is the scheduled format (`parse_format`), not the rounds fought.
2. **Walk-forward look-ahead.** This is the decisive test.
   - The current code reproduces the cached 2025-01-01 quarterly refit to 6e-15. Replaying the 132 light updates of
     that quarter reproduces every cached snapshot bit for bit (max difference 0).
   - Scrambling the stat lines of the 2025-02-22 card (24 directed rows; counts multiplied by U(0, 3)) and flipping
     its 12 results leaves every snapshot dated on or before that day **bit-identical**. The perturbed men's later
     fight moves (by up to 0.22 sd).
   - Scrambling every row and result from 2024-07-01 on (1,526 rows, 755 results) leaves that quarter's refit
     identical to 6e-15.
   - The tool's own pre- vs post-fight check (0.902 vs 0.750) and exposure check (0 of 2,074) reproduce.
3. **Fresh rebuild.** `--skip-cv` and `--stage extras` were rerun with the current code on a copy of the cached
   walks, into a scratch directory.
   - Every number in `embed.json` (meta, model, quarters, snapshots, roster, validation.winner, validation.stats)
     matches the published file to 1e-9.
   - The core code at walk time matches the current code except for two unused local variables.
   - After the fixes, the published `embed.json` and `embed_model.json` equal that fresh rebuild apart from
     timestamps.
4. **Independent re-scoring from the JSON alone** (own code, no `tools/embed.py` model code):
   - head 0.6336 vs Elo 0.6769, -0.0433 [-0.0595, -0.0262];
   - all six integration rows to 1e-4, with the same head weights (0.27, 0.13, 0.07, 0.35, 0.09, -0.05);
   - the mlrates blend from the rounded exported snapshots and quarters: -1.68% (all targets) and -1.67%
     (CV-selected), with the same segments and the same rejected targets.
5. **Joins.**
   - All 2,864 snapshot-table entries match `backtest_dev.json`: S sums, Elo, slugs and winners, with 0 differences.
   - Orientation is asserted against `ml.json` `y` and the `ratings.json` slugs.
6. **Corner symmetry.**
   - The factor model has no corner input, and the win head is antisymmetric with no intercept.
   - All winner models and stacks are mirrored with no intercept, and the GBMs average both orientations.
   - JS: swapping corners negates every snapshot logit exactly.
7. **JS vs Python.**
   - `node tests/test_embed.js` passes.
   - Verification added a tie to the real pipeline instead of the Python twin: all 2,864 snapshots run through
     `embed.js` reproduce the walk's own win logits to the 4-decimal export rounding (max 2.4e-3).

### Problems found and fixed

1. **Winner integration: the head was never compared with the base.**
   - `eval_integration` chose between +head and +head x exp by leave-one-year-out, and the report said it "chose
     +head everywhere".
   - With the base in the comparison, train CV (time-ordered, and LOYO too) prefers the base on top of the no-line
     stack (time CV +0.0015 for the head), the ratings stack (+0.0015), the close (+0.0006) and the close + stack
     (+0.0016).
   - The reported close gain, -0.0013 [-0.0026, -0.0001], is a validation-only delta.
   - Fixed: time-ordered CV over all three variants, `chosen - base` = 0 where the base wins, and both CV scores
     stored per variant.
   - Now kept: ML logistic alone (-0.0025, n.s.) and the opening line (-0.0088 [-0.0143, -0.0036]).
   - The integration recipe no longer says to "expect a weight of 0.07-0.13".
2. **Stat-line recipe chosen on validation.**
   - `embed_model.json` exported the all-18-target recipe. Its note said the CV-selected one "scored worse on
     validation" (by 0.01%).
   - The keep rule was also leave-one-year-out, which trains on later years. The protocol asks for time-ordered CV.
   - Fixed:
     - The keep rule is time-ordered expanding-window CV. It rejects reversals, ground accuracy, TD accuracy and
       knockdowns.
     - `mlrates_blend.targets` (the `blendMLRates` default) is the CV-selected recipe, and `targets_all` is
       reference only.
     - `blend_check` is regenerated.
   - Headline: -1.67% [-2.11, -1.24], with attackers on 1-2 UFC fights at -1.51% [-2.31, -0.69] (was -1.68% and
     -1.57%).
   - The rule was switched because the protocol requires it. The resulting validation number was not consulted
     first. Both recipes had already been seen, and they differ by 0.01%.
3. **Report wording.** "Task predictors are exact" now says exact up to the 4-decimal export rounding.

### Caveats left as they are (no validation impact)

- **Validation reads.** 2024-25 has now been read three times: the bugged build, the fix, and this verification.
  The verification made no selection on it.
- **"Division-average zero" is only nearly true.** A fighter with no stat fight before a refit keeps his seeded
  N(0, 0.1) initial vector, because his Newton step is masked. That vector also enters the scale rebalancing.
  - It carries no outcome information.
  - Exposure is above 0 on both sides of every 2019-2025 snapshot.
  - Only 4 sides of 2010-2018 training snapshots have exposure 0 (|v| at most 0.15 sd).
  - Fixing it would mean re-running the walks. Zero the initial vectors at the next rebuild.
- **Train-only fits on their own rows.**
  - The per-task calibration and the head slope (fit on 2010-2023 walk-forward rows) are applied to the same
    training rows the downstream models train on.
  - `ml.json`'s and `ratings.json`'s 2019-2023 stacks are partly in-sample (see above).
  - None of this reaches 2024-25.
- **Grid edge.** The winner logistic with embedding features picks C = 0.003, the smallest value in its grid. That
  is not a leak, but a smaller C was never tried.
- **Five-round segment.** -0.025 for the feature models remains a post-hoc hypothesis found among 12 segments.
  Check it at the next audit.
