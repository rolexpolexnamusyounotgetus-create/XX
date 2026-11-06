# embed: fighter embeddings (time-aware offense / defense vectors)

Status: built Nov 6, 2026 by `tools/embed.py`.

Outputs:
- `data/derived/embed.json`: model, per-snapshot embeddings keyed by backtest id and side, 2010-2018 training
  snapshots keyed by fight id, roster embeddings keyed by slug, axes, neighbours, CV and validation numbers.
- `data/derived/embed_model.json`: compact browser model plus a check block.
- `src/ml/embed.js`: dependency-free UMD evaluator.
- `tests/test_embed.js`: Node test reproducing the Python outputs.

Hidden-data protocol: every fight dated 2026-01-01 or later is dropped on load and never read. The roster
embeddings are the fit at 2026-01-01 (last fight used: 2025-12-13).

<!--RESULTS-->

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
- The 2010-2017 and 2018-2025 halves ran as two processes and were stitched by Procrustes at 2018-01-01.

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

<!--REST-->
