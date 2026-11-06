# Distributional stat lines (task key: statlines)

Nov 6, 2026, about 11:00 pm UTC. Tool: `tools/statlines.py` (with `tools/statlines_engine.js` for the engine's
realised lines). Outputs: `data/derived/statlines.json` (model tables, CV and 2024-25 evaluation, gate) and
`data/derived/statlines_oof.json` (walk-forward per-fight distributions). Evaluator: `src/ml/statdist.js`, tested by
`tests/test_statdist.js` (3,059 checks against `tests/fixtures/statdist_fixtures.json`). Blind-test plugin:
`tools/blindtest_plugins/statlines.py` (`statlines_dom`, experimental). Example CLI: `tools/statlines_matchup.js`.
Scratch caches: `out/statlines_cache/` (gitignored).

Protocol (docs/BACKLOG.md, docs/V6_V10_PLAN.md 5-6):
- Every fight dated 2026-01-01 or later is dropped at load. The inputs (mlrates dataset and OOF rates, embed
  snapshots, oppadj snapshots, methodround S cells) were all built with 2026 dropped, and this is asserted again.
- Every choice was made by forward-chained CV on 2021-2023, with folds fit on 2019..Y-1. That covers the model per
  stat, the ridge strength, zero-inflation, and whether the winner expert enters a stack. The stack gate uses
  tools/ml2.py's `stack_predict` and its 0.0005 rule.
- 2024-01-01..2025-12-31 was scored once, after the pre-registration in commit 09b4d2d (10:49:29 pm UTC). The `final`
  stage ran at 10:50 pm and writes a lock file.
- No corner input exists anywhere: each row is "attacker X vs defender Y". The swap test is asserted on the data for
  all 3,549 fights (0 mismatches) and on the exported model (max difference 0.0). The JS test asserts it again.
- Brackets are 95% intervals from 2,000 event-cluster bootstrap resamples, paired for differences.

Every table below is printed by `python3 tools/statlines.py tables`. The full output is in the appendix.

## Bottom line

1. **A mean is not a stat line.** The current learned path (the mlrates + embedding blend) gives only a mean. Read
   as a Poisson count, it is badly overconfident.
   - On 2024-25, only 23-30% of the big counts (sig strikes, head, distance) fall inside its 80% band, and 8% of
     control times do.
   - The new layer is calibrated: 0.77-0.82 inside the 80% band for all 20 stats on 2024-25, and 0.79-0.81 in CV.
   - Log score per fight-side vs Poisson(blend): sig landed 4.30 vs 8.35, control 5.10 vs 58.7. (high)
2. **It also beats the obvious distributional baseline.** That baseline (nb_base) is the blend mean with one
   negative-binomial shape per stat.
   - 2024-25: lower log score on all 19 stats where the choice differs from nb_base, every CI excluding 0. For
     example: sig landed -0.078 [-0.102, -0.058] nats; head landed -0.085; control -0.130 [-0.155, -0.105]; TD
     attempts -0.034 [-0.046, -0.023]; KD -0.132.
   - CV 2021-23: the same on 17 of 19 stats. Body attempts and body landed are -0.007, inside the noise. (high)
3. **Means improve modestly on the verified blend.** Given the fight length, 2024-25:
   - Poisson deviance changes by -2.3% for sig landed, -2.0% head landed, -1.4% distance landed, -1.5% / -1.2% leg
     attempts / landed, -6% ground, -11% submission attempts and -32% knockdowns.
   - Control (-0.3%) and TD attempts (-0.4%) are flat.
   - The KD and submission gains come mostly from the length itself. Knowing t means knowing whether the fight was
     stopped, and knockdowns stop fights. Without a length (the unconditional table) KD and submission attempts tie
     the engine. (high)
4. **The engine's realised lines are the weak link, mostly in their spread.** Engine v4 vs this layer on 2024-25,
   which is clean for both since v4's parameters were tuned on 2019-2023.
   - Conditional means: better on all 20 stats in point estimate, with the CI excluding 0 on 19. The exception is
     clinch attempts, -0.138 [-0.282, +0.001]. Control -4.5 s [-8.4, -0.8]; sig landed -0.72 [-1.10, -0.37];
     ground attempts -0.71.
   - Fights that went the distance, share of actual values inside the engine's own 80% band (target 0.80):

     | stat | engine | this layer |
     |---|---|---|
     | TD attempts | 0.52 (23% above its P90) | 0.77 |
     | TD landed | 0.63 | 0.79 |
     | control | 0.68 | 0.81 |
     | leg strikes | 0.69 | 0.83 |
     | ground strikes | 0.64-0.66 | 0.78 |
     | sig landed (too wide) | 0.88 | 0.84 |

     This confirms the unverified realism_sens note (TD attempts 74% inside, 16% above P90) and shows it is worse in
     v4.
   - Unconditional lines (evalv-style deviance of the unconditional mean):

     | stat | engine v4 | this layer | diff [CI] |
     |---|---|---|---|
     | control | 154.1 | 147.9 | -6.2 s [-10.7, -2.5] |
     | sig landed | 21.74 | 20.99 | -0.75 [-1.31, -0.14] |
     | sig attempts | 43.2 | 42.1 | -1.15 [-2.19, +0.02] |
     | TD landed | 1.807 | 1.749 | -0.058 [-0.089, -0.027] |
     | KD | 0.649 | 0.647 | tie |

     The engine column reproduces version_history's v4 numbers: 154.1 / 21.87 / 43.42 / 1.806 / 0.652. That is the
     ceiling for Cycle 3 (v8). The plan expects control -1.5 to -4 s, attempts -0.4 to -1.0 and landed -0.1 to -0.3
     (V6_V10_PLAN section 3). This layer exceeds all three on 2024-25, so the targets are reachable if the engine
     matches these lines. (high for the numbers; medium that an engine retarget can capture most of it)
5. **Winner: nothing.** A dominance expert was built from the expected lines, using the engine's judging weights.
   - Alone it scores 0.6728 on 2019-2023 and 0.6262 on 2024-25.
   - The stack gate rejects it in all six stacks: no line, open and close, each with two base sets. The CV changes
     are +0.00046 to +0.00093 (worse), and its weight is 0 when fit through 2023. It enters nothing.
   - This matches the do-not-do list: mlrates OOF information is already inside ML v2. (high)
6. **Use.** `src/ml/statdist.js` evaluates the exported tables, with "dev" fit on 2019-2023 for backtests and
   "prod" refit 2019-2025 for the page. It serves three uses:
   - the page's per-fighter P10 / P50 / P90 lines, given a length or mixed over the fight-length grid;
   - the v8 retarget pass: `engineTargets` returns per-minute targets and is `null` unless the flag
     `{ enable: true }` is set, so an engine that calls it is unchanged by default;
   - a PIT / coverage reference for evalv's planned per-stat PIT diagnostic.

   `src/engine3.js` is not touched.

## What was built

**Rows.** These are mlrates' out-of-fold fight-sides for 2019-2025, 3,549 fights and 7,098 sides:
- 2019-2023 rates come from time-ordered folds trained 2010..year-1;
- 2024-25 rates come from the dev model trained 2010-2023;
- each side is joined to its embed snapshot (quarterly refit strictly before the fight), its oppadj snapshot and the
  fight's methodround S cells.

Targets per fighter: sig strikes attempted / landed (total, head, body, leg, distance, clinch, ground), KD, TD
attempted / landed, control seconds, submission attempts and reversals (20 stats).

**Base mean.** Each fold refits the mlrates + embedding blend inside the fold, as a GLM on 2019..Y-1 rows:
`link(rate) = b0 + b1 link(mlrates) [+ b2 eta_embedding]`, with b2 only where the exported embed recipe keeps it.
The 18 blended targets combine into per-minute base rates for the 20 stats (for example, head landed = head
attempts x head accuracy, and KD = head landed x KD per landed head strike).

**Second stage, per stat.** The candidates, chosen by the CV ladder:
- **pois_base.** Poisson at the blend mean x t. This is "the mean model".
- **nb_base.** NB2 with one shape.
- **nb_t.** Adds time terms to the mean and the shape: log t, finished, finished x log t, and five rounds.
- **nb_glm (lambda 30-30000).** nb_t plus a ridge GLM on 37 page-computable features:
  - own and opponent log base rates (sig att / landed, TD, control, subs, KD): pace and style;
  - the embedding win logit and an embedding flag;
  - ten oppadj factors per side;
  - finished x (win logit, own and opponent landed).

  The shape also depends on log mean and five rounds.
- **nb_gbm.** A LightGBM Poisson correction on everything: the full mlrates feature row, both embeddings, all
  oppadj factors and base rates. Rounds are set by early stopping on the last training year. The NB shape is
  refit on top.
- **Sparse stats.** Zero-inflated NB versions.
- **Control.** Zero-inflated Beta on the share of fight time (cap = 60 t s), with the GLM in the mean and the zero
  probability.

**Selection.** A candidate replaces the current choice only if its pooled CV log score is lower by more than 0.001
nats and it is lower in at least 2 of the 3 years. GBM never won, so the JS-evaluable choice is the overall choice.

**Chosen:**
- NB + GLM for 16 stats: ridge 10000 for sig / head / leg / distance attempts; 3000 for sig / head / distance landed,
  clinch, ground attempts and TD landed; 30000 (the grid edge, nearly nb_t) for body and leg landed; 300 for ground
  landed, TD attempts and submission attempts;
- nb_t for KD;
- zero-inflated Beta + GLM (300) for control;
- nb_base for reversals.

**Unconditional lines.** These mix the conditional distributions over a fight-length grid. The grid has 10 R + 1
points: each round's 10 thirty-second bins, plus the distance. The weights are the methodround S cells (P(finish in
round r by KO/TKO or submission), P(decision or draw)) times a fixed within-round finish-time table. That table comes
from 2010-2018 finishes only, by method and round 1 vs later.

## Pre-registration (commit 09b4d2d, 10:49:29 pm UTC, before `final` ran)

Frozen by forward-chained CV on 2021-2023 (folds fit on 2019..Y-1; `out/statlines_cache/cv.json`, `prereg.json`):

- **Per-stat model (JS-evaluable; no GBM won anywhere, so the overall choice is the same):** sig_att, h_att, l_att,
  d_att NB + ridge GLM (lambda 10000); sig_lnd, h_lnd, d_lnd, c_att, c_lnd, g_att, td_lnd NB + GLM (3000); b_att,
  b_lnd, l_lnd NB + GLM (30000, the grid edge, where the GLM fades toward nb_t); g_lnd, td_att, sub_att NB + GLM (300);
  kd NB with time terms (nb_t); ctrl zero-inflated Beta + GLM (300); rev NB with one shape (nb_base).
- **Winner expert:** rejected by the stack gate in all six stacks (CV gains +0.00046 to +0.00093, all worse; weight 0
  when fit through 2023). It enters nothing. Its 2024-25 numbers are reported as confirmation only.
- **What 2024-25 reports (once, models fit on 2019-2023):** per-stat conditional log score of the chosen model vs
  nb_base (blend mean, one NB shape) and vs Poisson(blend mean); Poisson deviance of the mean vs the blend and vs raw
  mlrates; PIT in80 / >P90 / <P10; engine v4 comparison (conditional-mean deviance, went-the-distance CRPS and PIT,
  unconditional CRPS, deviance and PIT).
- **Decision:** the model ships as the distributional layer if its 2024-25 conditional NLL is not worse than nb_base
  on any stat beyond the CI and PIT in80 stays within 0.78-0.82 on the large counts. Nothing is re-selected on
  2024-2025.

The outcome against the decision rule:
- 2024-25 conditional NLL is better than nb_base on every stat that differs from it.
- In80 for the large counts is 0.797-0.818.
- Three sparse stats sit at or just below 0.78: ground attempts 0.771, ground landed 0.783, TD attempts 0.782. Ground attempts misses the 0.78 bound, on a stat that is not a large count.
- So the layer ships as specified, with ground attempts flagged.

## Checks

- Export parity: the exported tables reproduce the fitted models to 4e-16, for both dev and prod.
- JS parity: `node tests/test_statdist.js` covers 120 cases at the actual length, 2.5 minutes and the full length,
  plus 6 unconditional mixtures. Parameters match to 2.8e-15, log pmf to 3.6e-12 and CDF to 2.1e-13. Mixture
  quantiles match exactly (0 of 72 off).
- The test also checks swap symmetry, CDF monotonicity, that the pmf sums to the CDF, the flag-off identity, the
  embed task order, and that there is no 2026 fight in the OOF table. It ends with an integration smoke run of
  MLRates -> StatDist on a 2025 backtest fight.
- Engine run: `tools/statlines_engine.js` ran frozen versions/v4 (engine 4.0.0, params 4.0.0-selfcal-pre2024) with
  out-of-fold mlrates rates, 2 corner orders x 200 sims, on 2,864 backtest fights. Its unconditional deviances match
  the v4 version-history entry, which validates the comparison harness.

## Example: Volk vs Gaethje (production tables; live roster profiles, so never scored)

`node tools/statlines_matchup.js alexander-volkanovski justin-gaethje --rounds 5` gives P10 / P50 / P90 (mean):

| stat | Volkanovski, goes 25 min | Volkanovski, mixed (P(dec) 0.55) | Gaethje, goes 25 min | Gaethje, mixed |
|---|---|---|---|---|
| sig landed | 68 / 118 / 187 (123.7) | 20 / 91 / 169 (94.0) | 37 / 74 / 128 (78.9) | 10 / 53 / 113 (58.7) |
| leg landed | 13 / 28 / 52 (31.0) | 4 / 21 / 46 (23.4) | 3 / 11 / 26 (13.0) | 1 / 7 / 22 (9.8) |
| TD attempted | 1 / 5 / 13 (6.1) | 0 / 3 / 11 (4.4) | 0 / 0 / 4 (1.3) | 0 / 0 / 3 (1.0) |
| control s | 2 / 143 / 584 (226.5) | 0 / 82 / 485 (171.0) | 0 / 7 / 267 (80.2) | 0 / 1 / 195 (58.8) |

The mixed column uses a placeholder length grid (P(decision) 0.55, finishes front-loaded). On the page the grid
should come from the simulator's or the method model's round distribution, via `SD.lengthGrid(S, rounds)` or
`lengthGridSimple`.

## Files and commands

```
nice -n 5 python3 tools/statlines.py build      # row table (mlrates OOF + embed + oppadj + S cells), 2026 dropped
nice -n 5 python3 tools/statlines.py cv --tag v2  # candidates x CV years 2021-2023 (cv_v2.json was adopted as cv.json)
nice -n 5 python3 tools/statlines.py actuals    # actual lines of the 2,864 backtest fights
nice -n 5 node tools/statlines_engine.js --actuals out/statlines_cache/actuals.json --out out/statlines_cache/engine_v4.json
nice -n 5 python3 tools/statlines.py cvfit      # CV-year evaluation, engine comparison, winner OOF
nice -n 5 python3 tools/statlines.py gate       # forward-chained stack gate (ml2's code)
nice -n 5 python3 tools/statlines.py prereg     # freeze the choices
nice -n 5 python3 tools/statlines.py final      # the one 2024-25 look + exports
nice -n 5 python3 tools/statlines.py fixtures   # JS parity fixtures
python3 tools/statlines.py tables               # every table in this note
node tests/test_statdist.js
```

`statlines_oof.json` sets:
- `raw2019` (393 fights): winner expert only;
- `cv2020` (456): trained on 2019;
- `cv` (1,540): 2021-2023 folds;
- `valid` (1,037): fit 2019-2023.

Per side and stat it holds the distribution at the actual length (NB mu, k [, pi]; control m, phi, pi) plus the
unconditional mean.

JS usage:

```
var SD = StatDist.load(statlinesJson, { which: "prod" });
var P = SD.prepare({ mlA, mlB, etaA, etaB, hasEmb, winLogit, oppA, oppB, rounds });
P.dist("A", "td_att", 25).quantile(0.9);
P.line("B", SD.lengthGrid(S, 5));
```

## Caveats and what was not done

- **Length conditioning.** "Given t" includes knowing whether the fight was stopped. That is legitimate for the
  simulator, which knows its own length, but it inflates the KD and submission gains. The unconditional tables are
  the fair comparison for the page.
- **Marginals only.** The two fighters' lines are independent marginals, and the stats are separate marginals: head
  + body + leg do not sum exactly to the total's distribution. The shared fight-level pace (dynamics: sd 0.37) is not
  modelled jointly. Use the lines per fighter and per stat, not for differences or totals.
- **Input timing.** On 2024-25 the second stage is static (fit 2019-2023). The inputs are walk-forward: the mlrates
  dev model, embed quarterly refits up to each fight's quarter, and oppadj snapshots. That is the same convention as
  their own verified notes.
- **Engine CV years.** The 2021-2023 engine comparison is in-sample for the engine's level calibration (selfcal on
  2019-2023). Only the 2024-25 engine rows are clean.
- **Grid edge.** Body attempts, body landed and leg landed chose the edge of the ridge grid (30000). The GLM there is
  nearly off, and the gaps between 10000 and 30000 are below 0.001 nats.
- **No NN head.** A GBM correction (the "GBM with NB head" variant) never beat the ridge GLM in CV, by 0.000-0.003
  nats. That made an NN head an unlikely win at this sample size, so it was not built. Quantile regression was not
  needed, since the parametric heads are calibrated.
- **Not wired in.** Nothing is wired into the engine or the page yet. Cycle 3's train-only acceptance test (retarget
  + TD-intent draw against these targets) is the next step. The fight-length grid on the page must come from the
  simulator or the method model.
- **Restart and repair.** A container restart killed the previous agent at about 10:22 pm. Its table build, its
  smoke CV runs and its engine run (verified identical: the actuals reproduce with 0 mismatches) were reused. The
  table was rebuilt after a guard change, and the CV was rerun twice with a wider ridge grid. After `final`, a
  non-finite log score of a rejected CV candidate (zero-inflated NB for reversals) was replaced by `null` so the JSON
  is strict. Nothing was re-scored.

## Appendix: full tables (`python3 tools/statlines.py tables`)

### CV candidates (2021-2023 pooled NLL per fight-side; selection rule: per stat, start from nb_base (the verified mlrates + embedding mean with one NB shape); walk the ladder nb_t -> best nb_glm (ridge 30/300/3000/10000/30000) -> nb_gbm, and for sparse stats also the zero-inflated versions (and for control the zero-inflated Beta); a candidate replaces the current choice only if its pooled 2021-2023 CV log score (NLL per fight-side) is lower by more than 0.001 nats AND it is lower in at least 2 of the 3 CV years. 'JS-evaluable' excludes nb_gbm (the page has no tree evaluator for it).)

| stat | pois_base | nb_base | nb_t | nb_glm_l30 | nb_glm_l300 | nb_glm_l3000 | nb_glm_l10000 | nb_glm_l30000 | nb_gbm | zinb_t | zinb_glm_l300 | zibeta_t | zibeta_glm_l300 | chosen (JS) | chosen (any) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | 13.5595 | 5.0472 | 4.9957 | 4.9844 | 4.9837 | 4.9819 | 4.9816 | 4.9821 | 4.9821 |  |  |  |  | nb_glm_l10000 | nb_glm_l10000 |
| sig_lnd | 8.5364 | 4.3882 | 4.3336 | 4.3215 | 4.3205 | 4.3197 | 4.3205 | 4.3216 | 4.3226 |  |  |  |  | nb_glm_l3000 | nb_glm_l3000 |
| h_att | 12.5940 | 4.8573 | 4.7968 | 4.7874 | 4.7866 | 4.7849 | 4.7848 | 4.7854 | 4.7865 |  |  |  |  | nb_glm_l10000 | nb_glm_l10000 |
| h_lnd | 7.7142 | 4.0517 | 3.9835 | 3.9733 | 3.9714 | 3.9713 | 3.9727 | 3.9740 | 3.9757 |  |  |  |  | nb_glm_l3000 | nb_glm_l3000 |
| b_att | 4.6897 | 3.2385 | 3.2349 | 3.2394 | 3.2376 | 3.2342 | 3.2327 | 3.2318 | 3.2309 |  |  |  |  | nb_glm_l30000 | nb_glm_l30000 |
| b_lnd | 4.0458 | 2.9701 | 2.9672 | 2.9698 | 2.9676 | 2.9643 | 2.9634 | 2.9631 | 2.9627 |  |  |  |  | nb_glm_l30000 | nb_glm_l30000 |
| l_att | 4.4293 | 2.9330 | 2.9267 | 2.9131 | 2.9108 | 2.9078 | 2.9075 | 2.9077 | 2.9078 |  |  |  |  | nb_glm_l10000 | nb_glm_l10000 |
| l_lnd | 4.0196 | 2.7729 | 2.7693 | 2.7590 | 2.7567 | 2.7533 | 2.7528 | 2.7528 | 2.7530 |  |  |  |  | nb_glm_l30000 | nb_glm_l30000 |
| d_att | 14.5711 | 4.9449 | 4.9226 | 4.9026 | 4.9016 | 4.8994 | 4.8988 | 4.8994 | 4.8996 |  |  |  |  | nb_glm_l10000 | nb_glm_l10000 |
| d_lnd | 8.5591 | 4.1835 | 4.1670 | 4.1494 | 4.1487 | 4.1472 | 4.1472 | 4.1480 | 4.1488 |  |  |  |  | nb_glm_l3000 | nb_glm_l3000 |
| c_att | 4.4637 | 2.6531 | 2.6245 | 2.6246 | 2.6216 | 2.6195 | 2.6198 | 2.6204 | 2.6204 | 2.6235 | 2.6215 |  |  | nb_glm_l3000 | nb_glm_l3000 |
| c_lnd | 3.7371 | 2.3936 | 2.3728 | 2.3726 | 2.3694 | 2.3673 | 2.3676 | 2.3680 | 2.3675 | 2.3717 | 2.3696 |  |  | nb_glm_l3000 | nb_glm_l3000 |
| g_att | 7.4539 | 2.5233 | 2.4733 | 2.4674 | 2.4655 | 2.4655 | 2.4659 | 2.4661 | 2.4667 | 2.4705 | 2.4666 |  |  | nb_glm_l3000 | nb_glm_l3000 |
| g_lnd | 5.6298 | 2.2707 | 2.2258 | 2.2199 | 2.2181 | 2.2184 | 2.2189 | 2.2192 | 2.2197 | 2.2231 | 2.2184 |  |  | nb_glm_l300 | nb_glm_l300 |
| kd | 0.6837 | 0.6608 | 0.5288 | 0.5297 | 0.5280 | 0.5282 | 0.5290 | 0.5294 | 0.5284 | 0.5283 | 0.5282 |  |  | nb_t | nb_t |
| td_att | 2.2120 | 1.9017 | 1.9034 | 1.8739 | 1.8723 | 1.8725 | 1.8751 | 1.8773 | 1.8770 | 1.8958 | 1.8748 |  |  | nb_glm_l300 | nb_glm_l300 |
| td_lnd | 1.3331 | 1.2387 | 1.2400 | 1.2315 | 1.2294 | 1.2285 | 1.2295 | 1.2300 | 1.2316 | 1.2411 | 1.2344 |  |  | nb_glm_l3000 | nb_glm_l3000 |
| ctrl | 60.4932 | 5.2392 | 5.2227 | 5.1761 | 5.1738 | 5.1745 | 5.1757 | 5.1766 | 5.1761 |  |  | 5.1753 | 5.1441 | zibeta_glm_l300 | zibeta_glm_l300 |
| sub_att | 0.7290 | 0.6854 | 0.6474 | 0.6441 | 0.6421 | 0.6437 | 0.6444 | 0.6448 | 0.6440 | 0.6476 | 0.6428 |  |  | nb_glm_l300 | nb_glm_l300 |
| rev | 0.3709 | 0.3629 | 0.3661 | 0.3751 | 0.3709 | 0.3683 | 0.3685 | 0.3689 | 0.3673 | inf | 0.3858 |  |  | nb_base | nb_base |

### Forward-chained CV years 2021-2023

Conditional on the actual fight length t (all fight-sides in the window: 3080; backtest universe, both men with a prior UFC fight: 2508). NLL = log score per fight-side (nats); dev = Poisson deviance of the mean; in80 = share of randomized PITs inside [0.1, 0.9] (target 0.80); CIs: 2,000 event-cluster resamples, paired.

| stat | chosen | NLL chosen | NLL nb_base | NLL Poisson(blend) | NLL diff vs nb_base | dev chosen | dev blend | dev mlrates | dev diff vs blend | dev % vs blend | in80 | >P90 | <P10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | nb_glm_l10000 | 4.9816 | 5.0472 | 13.559 | -0.0657 [-0.0861, -0.0465] | 20.890 | 21.154 | 21.226 | -0.263 [-0.463, -0.063] | -1.24% | 0.798 | 0.090 | 0.111 |
| sig_lnd | nb_glm_l3000 | 4.3197 | 4.3882 | 8.536 | -0.0684 [-0.0879, -0.0502] | 11.645 | 11.866 | 11.985 | -0.221 [-0.370, -0.077] | -1.86% | 0.799 | 0.094 | 0.107 |
| h_att | nb_glm_l10000 | 4.7848 | 4.8573 | 12.594 | -0.0725 [-0.0949, -0.0521] | 19.286 | 19.542 | 19.639 | -0.257 [-0.427, -0.090] | -1.31% | 0.800 | 0.094 | 0.106 |
| h_lnd | nb_glm_l3000 | 3.9713 | 4.0517 | 7.714 | -0.0804 [-0.1013, -0.0615] | 10.542 | 10.809 | 10.951 | -0.267 [-0.408, -0.135] | -2.47% | 0.797 | 0.096 | 0.106 |
| b_att | nb_glm_l30000 | 3.2318 | 3.2385 | 4.690 | -0.0067 [-0.0147, +0.0016] | 5.562 | 5.544 | 5.560 | +0.019 [-0.015, +0.051] | +0.34% | 0.811 | 0.092 | 0.097 |
| b_lnd | nb_glm_l30000 | 2.9631 | 2.9701 | 4.046 | -0.0070 [-0.0140, +0.0004] | 4.629 | 4.621 | 4.645 | +0.008 [-0.014, +0.029] | +0.18% | 0.806 | 0.094 | 0.100 |
| l_att | nb_glm_l10000 | 2.9075 | 2.9330 | 4.429 | -0.0255 [-0.0349, -0.0163] | 5.592 | 5.651 | 5.617 | -0.058 [-0.095, -0.022] | -1.03% | 0.807 | 0.096 | 0.097 |
| l_lnd | nb_glm_l30000 | 2.7528 | 2.7729 | 4.020 | -0.0202 [-0.0286, -0.0116] | 4.986 | 5.030 | 4.988 | -0.044 [-0.074, -0.013] | -0.87% | 0.799 | 0.095 | 0.106 |
| d_att | nb_glm_l10000 | 4.8988 | 4.9449 | 14.571 | -0.0461 [-0.0606, -0.0310] | 23.149 | 23.409 | 23.382 | -0.260 [-0.478, -0.035] | -1.11% | 0.805 | 0.081 | 0.115 |
| d_lnd | nb_glm_l3000 | 4.1472 | 4.1835 | 8.559 | -0.0363 [-0.0492, -0.0221] | 12.153 | 12.249 | 12.255 | -0.096 [-0.219, +0.028] | -0.78% | 0.792 | 0.084 | 0.124 |
| c_att | nb_glm_l3000 | 2.6195 | 2.6531 | 4.464 | -0.0336 [-0.0453, -0.0227] | 6.275 | 6.313 | 6.286 | -0.038 [-0.095, +0.018] | -0.60% | 0.805 | 0.121 | 0.074 |
| c_lnd | nb_glm_l3000 | 2.3673 | 2.3936 | 3.737 | -0.0263 [-0.0369, -0.0168] | 5.143 | 5.157 | 5.157 | -0.014 [-0.060, +0.029] | -0.28% | 0.807 | 0.113 | 0.081 |
| g_att | nb_glm_l3000 | 2.4655 | 2.5233 | 7.454 | -0.0578 [-0.0758, -0.0423] | 11.769 | 12.878 | 12.894 | -1.109 [-1.426, -0.816] | -8.61% | 0.789 | 0.113 | 0.098 |
| g_lnd | nb_glm_l300 | 2.2181 | 2.2707 | 5.630 | -0.0526 [-0.0687, -0.0386] | 8.664 | 9.458 | 9.477 | -0.794 [-1.053, -0.555] | -8.40% | 0.796 | 0.114 | 0.090 |
| kd | nb_t | 0.5288 | 0.6608 | 0.684 | -0.1320 [-0.1499, -0.1154] | 0.679 | 0.979 | 0.981 | -0.300 [-0.348, -0.255] | -30.63% | 0.800 | 0.102 | 0.098 |
| td_att | nb_glm_l300 | 1.8723 | 1.9017 | 2.212 | -0.0294 [-0.0379, -0.0204] | 2.444 | 2.469 | 2.513 | -0.025 [-0.062, +0.010] | -1.03% | 0.796 | 0.098 | 0.106 |
| td_lnd | nb_glm_l3000 | 1.2285 | 1.2387 | 1.333 | -0.0102 [-0.0163, -0.0043] | 1.527 | 1.533 | 1.547 | -0.006 [-0.017, +0.004] | -0.40% | 0.791 | 0.102 | 0.107 |
| ctrl | zibeta_glm_l300 | 5.1441 | 5.2392 | 60.493 | -0.0951 [-0.1159, -0.0734] | 115.794 | 116.029 | 118.220 | -0.235 [-1.880, +1.366] | -0.20% | 0.806 | 0.099 | 0.094 |
| sub_att | nb_glm_l300 | 0.6421 | 0.6854 | 0.729 | -0.0433 [-0.0531, -0.0329] | 0.890 | 1.002 | 1.003 | -0.113 [-0.144, -0.081] | -11.22% | 0.807 | 0.100 | 0.093 |
| rev | nb_base | 0.3629 | 0.3629 | 0.371 | +0.0000 [+0.0000, +0.0000] | 0.520 | 0.520 | 0.519 | +0.000 [-0.000, +0.000] | +0.01% | 0.814 | 0.087 | 0.099 |

Interval calibration of the comparators (same rows): in80 of Poisson(blend) / nb_base / chosen.

| stat | Poisson(blend) in80 | nb_base in80 | chosen in80 | chosen naive 10-90% band hit | chosen MAE of median | nb_base MAE of median |
|---|---|---|---|---|---|---|
| sig_att | 0.233 | 0.803 | 0.798 | 0.808 | 34.362 | 34.507 |
| sig_lnd | 0.311 | 0.812 | 0.799 | 0.811 | 17.539 | 17.614 |
| h_att | 0.232 | 0.794 | 0.800 | 0.811 | 28.797 | 28.965 |
| h_lnd | 0.320 | 0.811 | 0.797 | 0.821 | 13.019 | 13.094 |
| b_att | 0.449 | 0.819 | 0.811 | 0.850 | 6.647 | 6.662 |
| b_lnd | 0.478 | 0.811 | 0.806 | 0.859 | 5.121 | 5.122 |
| l_att | 0.423 | 0.800 | 0.807 | 0.865 | 5.195 | 5.203 |
| l_lnd | 0.448 | 0.803 | 0.799 | 0.868 | 4.467 | 4.477 |
| d_att | 0.238 | 0.811 | 0.805 | 0.814 | 33.669 | 34.155 |
| d_lnd | 0.312 | 0.814 | 0.792 | 0.808 | 15.899 | 16.027 |
| c_att | 0.450 | 0.803 | 0.805 | 0.879 | 4.435 | 4.487 |
| c_lnd | 0.484 | 0.812 | 0.807 | 0.889 | 3.461 | 3.479 |
| g_att | 0.279 | 0.798 | 0.789 | 0.893 | 5.675 | 5.728 |
| g_lnd | 0.343 | 0.801 | 0.796 | 0.894 | 4.117 | 4.160 |
| kd | 0.751 | 0.778 | 0.800 | 0.954 | 0.214 | 0.218 |
| td_att | 0.622 | 0.814 | 0.796 | 0.905 | 1.872 | 1.882 |
| td_lnd | 0.731 | 0.791 | 0.791 | 0.928 | 0.843 | 0.851 |
| ctrl | 0.074 | 0.786 | 0.806 | 0.871 | 90.778 | 99.401 |
| sub_att | 0.768 | 0.777 | 0.807 | 0.944 | 0.299 | 0.297 |
| rev | 0.809 | 0.783 | 0.814 | 0.964 | 0.130 | 0.130 |

Engine 4.0.0 / 4.0.0-selfcal-pre2024, 200 sims per order (2021-2023; NOTE engine v4 params (selfcal-pre2024) were tuned on 2019-2023, so its levels are in-sample here; 2024-2025 (final) is the clean comparison).

Conditional mean at the actual length (engine: rate-based mean, simulated totals / simulated minutes x t) and fights that went the distance (engine: only its simulations that went the distance; ours at t = 5R):

| stat | n | dev engine | dev chosen | diff chosen - engine | distance n | CRPS engine | CRPS chosen | CRPS diff | in80 engine | in80 chosen | >P90 engine | >P90 chosen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | 2508 | 20.595 | 20.161 | -0.433 [-0.895, +0.036] | 1218 | 34.710 | 34.002 | -0.708 [-1.287, -0.133] | 0.840 | 0.796 | 0.080 | 0.096 |
| sig_lnd | 2508 | 11.476 | 11.068 | -0.409 [-0.650, -0.154] | 1218 | 16.936 | 16.617 | -0.319 [-0.602, -0.035] | 0.856 | 0.806 | 0.066 | 0.096 |
| h_att | 2508 | 19.266 | 18.842 | -0.424 [-0.844, -0.001] | 1218 | 29.028 | 28.658 | -0.370 [-0.821, +0.085] | 0.805 | 0.806 | 0.094 | 0.096 |
| h_lnd | 2508 | 10.745 | 10.267 | -0.477 [-0.715, -0.231] | 1218 | 12.443 | 12.326 | -0.116 [-0.287, +0.058] | 0.805 | 0.796 | 0.080 | 0.102 |
| b_att | 2508 | 5.306 | 5.279 | -0.027 [-0.114, +0.070] | 1218 | 6.517 | 6.537 | +0.020 [-0.071, +0.113] | 0.753 | 0.795 | 0.115 | 0.099 |
| b_lnd | 2508 | 4.412 | 4.378 | -0.033 [-0.103, +0.040] | 1218 | 5.013 | 5.012 | -0.001 [-0.076, +0.070] | 0.740 | 0.798 | 0.129 | 0.096 |
| l_att | 2508 | 5.402 | 5.355 | -0.047 [-0.132, +0.039] | 1218 | 5.304 | 5.271 | -0.034 [-0.104, +0.037] | 0.663 | 0.804 | 0.149 | 0.096 |
| l_lnd | 2508 | 4.817 | 4.800 | -0.018 [-0.088, +0.059] | 1218 | 4.544 | 4.536 | -0.008 [-0.062, +0.051] | 0.664 | 0.795 | 0.148 | 0.100 |
| d_att | 2508 | 22.912 | 22.416 | -0.496 [-1.032, +0.035] | 1218 | 35.069 | 34.328 | -0.741 [-1.401, -0.042] | 0.800 | 0.800 | 0.096 | 0.082 |
| d_lnd | 2508 | 11.828 | 11.620 | -0.209 [-0.494, +0.086] | 1218 | 16.254 | 16.061 | -0.193 [-0.561, +0.205] | 0.810 | 0.791 | 0.090 | 0.080 |
| c_att | 2508 | 6.443 | 6.411 | -0.032 [-0.182, +0.113] | 1218 | 4.365 | 4.374 | +0.009 [-0.060, +0.082] | 0.811 | 0.799 | 0.105 | 0.131 |
| c_lnd | 2508 | 5.314 | 5.291 | -0.023 [-0.124, +0.080] | 1218 | 3.457 | 3.465 | +0.008 [-0.041, +0.057] | 0.788 | 0.806 | 0.120 | 0.129 |
| g_att | 2508 | 12.580 | 11.312 | -1.267 [-1.671, -0.830] | 1218 | 4.553 | 4.172 | -0.381 [-0.492, -0.258] | 0.631 | 0.801 | 0.085 | 0.108 |
| g_lnd | 2508 | 9.272 | 8.353 | -0.919 [-1.238, -0.584] | 1218 | 3.265 | 3.016 | -0.248 [-0.331, -0.159] | 0.691 | 0.801 | 0.078 | 0.109 |
| kd | 2508 | 0.974 | 0.677 | -0.297 [-0.345, -0.248] | 1218 | 0.108 | 0.109 | +0.001 [-0.001, +0.003] | 0.801 | 0.786 | 0.092 | 0.108 |
| td_att | 2508 | 2.375 | 2.307 | -0.068 [-0.130, -0.007] | 1218 | 1.894 | 1.791 | -0.103 [-0.154, -0.057] | 0.548 | 0.799 | 0.216 | 0.097 |
| td_lnd | 2508 | 1.491 | 1.467 | -0.024 [-0.047, -0.003] | 1218 | 0.848 | 0.809 | -0.039 [-0.052, -0.025] | 0.665 | 0.773 | 0.174 | 0.115 |
| ctrl | 2508 | 117.265 | 112.291 | -4.974 [-7.569, -2.372] | 1218 | 89.790 | 86.721 | -3.069 [-4.774, -1.274] | 0.672 | 0.796 | 0.152 | 0.099 |
| sub_att | 2508 | 1.004 | 0.868 | -0.135 [-0.171, -0.099] | 1218 | 0.196 | 0.195 | -0.000 [-0.003, +0.003] | 0.797 | 0.817 | 0.100 | 0.097 |
| rev | 2508 | 0.478 | 0.476 | -0.002 [-0.013, +0.007] | 1218 | 0.126 | 0.125 | -0.002 [-0.005, +0.002] | 0.802 | 0.812 | 0.094 | 0.081 |

Unconditional lines (no length given): engine's full simulated distribution vs our mixture over the methodround S fight-length grid; dev is the evalv-style deviance of the unconditional mean:

| stat | n | CRPS engine | CRPS ours | CRPS diff | dev engine | dev ours | dev diff | in80 engine | in80 ours | >P90 engine | >P90 ours | <P10 engine | <P10 ours | NLL ours | NLL Poisson(blend) mix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | 2508 | 37.723 | 37.185 | -0.539 [-0.984, -0.101] | 48.541 | 47.398 | -1.143 [-2.181, -0.081] | 0.826 | 0.805 | 0.082 | 0.098 | 0.092 | 0.097 | 5.4307 | 8.288 |
| sig_lnd | 2508 | 18.210 | 17.871 | -0.339 [-0.547, -0.128] | 23.877 | 23.139 | -0.738 [-1.210, -0.241] | 0.836 | 0.805 | 0.072 | 0.095 | 0.092 | 0.101 | 4.7028 | 5.927 |
| h_att | 2508 | 30.030 | 29.708 | -0.322 [-0.651, +0.009] | 40.390 | 39.578 | -0.812 [-1.613, +0.031] | 0.800 | 0.803 | 0.095 | 0.097 | 0.106 | 0.099 | 5.1852 | 7.980 |
| h_lnd | 2508 | 12.360 | 12.184 | -0.176 [-0.294, -0.048] | 17.930 | 17.419 | -0.511 [-0.846, -0.164] | 0.801 | 0.810 | 0.082 | 0.095 | 0.118 | 0.095 | 4.2669 | 5.497 |
| b_att | 2508 | 6.326 | 6.263 | -0.063 [-0.134, +0.010] | 9.689 | 9.519 | -0.170 [-0.358, +0.028] | 0.775 | 0.817 | 0.109 | 0.092 | 0.116 | 0.091 | 3.5678 | 4.156 |
| b_lnd | 2508 | 4.729 | 4.689 | -0.040 [-0.089, +0.008] | 7.583 | 7.454 | -0.129 [-0.263, +0.010] | 0.774 | 0.822 | 0.108 | 0.091 | 0.118 | 0.087 | 3.2657 | 3.709 |
| l_att | 2508 | 4.521 | 4.431 | -0.090 [-0.135, -0.045] | 7.841 | 7.618 | -0.222 [-0.357, -0.095] | 0.757 | 0.825 | 0.124 | 0.092 | 0.120 | 0.083 | 3.1003 | 3.771 |
| l_lnd | 2508 | 3.842 | 3.775 | -0.067 [-0.104, -0.031] | 6.862 | 6.693 | -0.169 [-0.275, -0.063] | 0.760 | 0.816 | 0.122 | 0.091 | 0.118 | 0.093 | 2.9375 | 3.500 |
| d_att | 2508 | 35.511 | 35.024 | -0.487 [-0.910, -0.037] | 49.213 | 48.150 | -1.063 [-2.099, +0.030] | 0.800 | 0.819 | 0.098 | 0.089 | 0.102 | 0.092 | 5.3138 | 8.448 |
| d_lnd | 2508 | 16.025 | 15.800 | -0.225 [-0.429, -0.015] | 23.006 | 22.464 | -0.542 [-1.015, -0.019] | 0.807 | 0.816 | 0.092 | 0.082 | 0.100 | 0.102 | 4.5067 | 5.845 |
| c_att | 2508 | 3.815 | 3.768 | -0.046 [-0.094, -0.000] | 8.458 | 8.259 | -0.200 [-0.385, -0.018] | 0.800 | 0.794 | 0.104 | 0.122 | 0.096 | 0.084 | 2.7831 | 3.998 |
| c_lnd | 2508 | 2.957 | 2.928 | -0.029 [-0.063, +0.005] | 6.815 | 6.682 | -0.133 [-0.261, -0.003] | 0.801 | 0.784 | 0.108 | 0.118 | 0.091 | 0.098 | 2.5199 | 3.469 |
| g_att | 2508 | 4.377 | 4.255 | -0.123 [-0.171, -0.070] | 12.210 | 11.931 | -0.279 [-0.504, -0.027] | 0.726 | 0.793 | 0.105 | 0.114 | 0.169 | 0.093 | 2.4740 | 4.723 |
| g_lnd | 2508 | 3.179 | 3.088 | -0.091 [-0.129, -0.050] | 8.994 | 8.758 | -0.236 [-0.419, -0.030] | 0.746 | 0.791 | 0.104 | 0.116 | 0.150 | 0.093 | 2.2270 | 3.835 |
| kd | 2508 | 0.177 | 0.178 | +0.001 [-0.001, +0.003] | 0.719 | 0.721 | +0.001 [-0.012, +0.013] | 0.805 | 0.808 | 0.096 | 0.097 | 0.100 | 0.095 | 0.5573 | 0.555 |
| td_att | 2508 | 1.590 | 1.522 | -0.068 [-0.091, -0.046] | 3.290 | 3.202 | -0.088 [-0.158, -0.020] | 0.679 | 0.798 | 0.159 | 0.095 | 0.163 | 0.107 | 1.9929 | 2.211 |
| td_lnd | 2508 | 0.676 | 0.653 | -0.024 [-0.032, -0.016] | 1.790 | 1.758 | -0.031 [-0.061, -0.006] | 0.730 | 0.801 | 0.138 | 0.100 | 0.132 | 0.099 | 1.2847 | 1.359 |
| ctrl | 2508 | 74.316 | 72.804 | -1.512 [-2.302, -0.768] | 159.796 | 154.989 | -4.807 [-7.903, -1.849] | 0.769 | 0.817 | 0.124 | 0.088 | 0.107 | 0.095 | 5.2781 | 26.759 |
| sub_att | 2508 | 0.236 | 0.236 | -0.000 [-0.002, +0.002] | 0.914 | 0.903 | -0.010 [-0.026, +0.005] | 0.785 | 0.794 | 0.113 | 0.108 | 0.102 | 0.097 | 0.6470 | 0.668 |
| rev | 2508 | 0.101 | 0.100 | -0.001 [-0.002, +0.000] | 0.513 | 0.513 | -0.000 [-0.012, +0.011] | 0.802 | 0.816 | 0.100 | 0.081 | 0.097 | 0.104 | 0.3427 | 0.348 |

PIT histograms (10 bins, counts) for key stats:

| stat | model | histogram |
|---|---|---|
| sig_lnd | ours, given t (all rows) | 330 288 289 304 309 337 318 303 314 288 |
| sig_lnd | Poisson(blend), given t | 1173 181 126 104 109 81 97 112 148 949 |
| sig_lnd | engine, distance only | 95 69 98 109 154 154 167 159 133 80 |
| sig_lnd | ours, distance only | 119 95 117 122 118 143 140 121 126 117 |
| sig_lnd | engine, unconditional | 232 263 222 222 230 261 296 298 301 183 |
| sig_lnd | ours, unconditional | 253 273 231 239 252 250 235 286 252 237 |
| sig_att | ours, given t (all rows) | 343 232 239 315 334 303 328 365 343 278 |
| sig_att | Poisson(blend), given t | 1239 122 97 83 69 69 68 83 127 1123 |
| sig_att | engine, distance only | 97 79 79 105 120 147 171 178 143 99 |
| sig_att | ours, distance only | 131 76 95 129 127 115 134 162 132 117 |
| sig_att | engine, unconditional | 232 258 233 261 216 236 253 302 310 207 |
| sig_att | ours, unconditional | 243 261 242 245 219 270 243 267 271 247 |
| td_att | ours, given t (all rows) | 325 303 286 295 310 296 316 320 326 303 |
| td_att | Poisson(blend), given t | 642 344 297 237 212 206 193 219 207 523 |
| td_att | engine, distance only | 288 128 97 81 72 53 71 73 92 263 |
| td_att | ours, distance only | 127 136 120 98 115 99 134 129 142 118 |
| td_att | engine, unconditional | 408 338 294 253 181 170 167 144 155 398 |
| td_att | ours, unconditional | 268 242 267 237 257 254 236 253 255 239 |
| td_lnd | ours, given t (all rows) | 329 312 297 298 324 308 299 300 298 315 |
| td_lnd | Poisson(blend), given t | 402 393 305 307 282 250 268 216 232 425 |
| td_lnd | engine, distance only | 196 147 127 130 91 90 67 71 86 213 |
| td_lnd | ours, distance only | 136 123 107 120 129 107 112 117 127 140 |
| td_lnd | engine, unconditional | 331 315 285 276 219 221 183 159 174 345 |
| td_lnd | ours, unconditional | 248 249 252 273 230 251 276 236 241 252 |
| ctrl | ours, given t (all rows) | 291 297 325 333 304 324 288 333 279 306 |
| ctrl | Poisson(blend), given t | 1849 40 29 29 32 19 20 27 32 1003 |
| ctrl | engine, distance only | 214 117 110 101 96 102 87 99 107 185 |
| ctrl | ours, distance only | 128 111 110 146 104 131 123 130 115 120 |
| ctrl | engine, unconditional | 268 275 256 259 252 239 243 200 199 317 |
| ctrl | ours, unconditional | 239 256 242 229 289 272 244 265 251 221 |
| kd | ours, given t (all rows) | 303 313 303 317 301 298 279 329 323 314 |
| kd | Poisson(blend), given t | 317 349 306 303 291 294 310 234 227 449 |
| kd | engine, distance only | 130 99 118 121 138 138 125 125 112 112 |
| kd | ours, distance only | 130 114 104 128 129 116 94 134 138 131 |
| kd | engine, unconditional | 250 248 233 289 232 257 237 252 270 240 |
| kd | ours, unconditional | 238 249 269 222 229 291 259 241 267 243 |
| sub_att | ours, given t (all rows) | 286 317 305 287 331 314 286 323 324 307 |
| sub_att | Poisson(blend), given t | 323 329 348 282 310 306 292 225 272 393 |
| sub_att | engine, distance only | 125 141 123 139 126 103 124 109 106 122 |
| sub_att | ours, distance only | 105 138 132 107 126 129 108 132 123 118 |
| sub_att | engine, unconditional | 257 249 244 256 251 226 252 250 240 283 |
| sub_att | ours, unconditional | 244 256 231 251 257 242 262 235 258 272 |

### Winner expert: forward-chained stack gate (2021-2023)

Expert alone on 2019-2023 (walk-forward): log loss 0.6728, accuracy 0.609 (n 1955).

| stack | CV base | CV + statlines | gain | enters (gain < -0.0005) | statlines weight (fit <= 2023) | paired CV-years diff [CI] |
|---|---|---|---|---|---|---|
| line|market+ml2 + statlines | 0.61614 | 0.61667 | +0.00053 | no | 0.000 | +0.00053 [-0.0003, +0.0013] |
| line|page: market+ml2lr + statlines | 0.61624 | 0.61670 | +0.00046 | no | 0.000 | +0.00046 [-0.0003, +0.0012] |
| noline|ml2+mkt_rating+feat_lr + statlines | 0.62854 | 0.62916 | +0.00062 | no | 0.000 | +0.00062 [-0.0004, +0.0015] |
| noline|page: ml2lr+mkt_rating + statlines | 0.62984 | 0.63040 | +0.00056 | no | 0.000 | +0.00056 [-0.0004, +0.0015] |
| open|open+ml2 + statlines | 0.62231 | 0.62324 | +0.00093 | no | 0.000 | +0.00093 [-0.0006, +0.0024] |
| open|page: open+ml2lr + statlines | 0.62275 | 0.62357 | +0.00082 | no | 0.000 | +0.00082 [-0.0007, +0.0023] |

### 2024-2025 confirmation (scored once; fit 2019-2023)

Conditional on the actual fight length t (all fight-sides in the window: 2074; backtest universe, both men with a prior UFC fight: 1730). NLL = log score per fight-side (nats); dev = Poisson deviance of the mean; in80 = share of randomized PITs inside [0.1, 0.9] (target 0.80); CIs: 2,000 event-cluster resamples, paired.

| stat | chosen | NLL chosen | NLL nb_base | NLL Poisson(blend) | NLL diff vs nb_base | dev chosen | dev blend | dev mlrates | dev diff vs blend | dev % vs blend | in80 | >P90 | <P10 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | nb_glm_l10000 | 4.9588 | 5.0293 | 13.178 | -0.0706 [-0.0912, -0.0516] | 20.182 | 20.414 | 20.916 | -0.231 [-0.543, +0.103] | -1.13% | 0.807 | 0.086 | 0.108 |
| sig_lnd | nb_glm_l3000 | 4.2956 | 4.3738 | 8.352 | -0.0782 [-0.1017, -0.0582] | 11.267 | 11.531 | 11.933 | -0.264 [-0.455, -0.060] | -2.29% | 0.807 | 0.080 | 0.113 |
| h_att | nb_glm_l10000 | 4.7625 | 4.8328 | 12.392 | -0.0703 [-0.0935, -0.0498] | 19.018 | 19.175 | 19.590 | -0.157 [-0.429, +0.152] | -0.82% | 0.797 | 0.098 | 0.105 |
| h_lnd | nb_glm_l3000 | 3.9556 | 4.0403 | 7.662 | -0.0847 [-0.1114, -0.0610] | 10.521 | 10.736 | 11.022 | -0.215 [-0.393, -0.027] | -2.01% | 0.801 | 0.095 | 0.104 |
| b_att | nb_glm_l30000 | 3.2027 | 3.2165 | 4.612 | -0.0138 [-0.0218, -0.0060] | 5.410 | 5.425 | 5.516 | -0.015 [-0.044, +0.018] | -0.27% | 0.813 | 0.074 | 0.113 |
| b_lnd | nb_glm_l30000 | 2.8962 | 2.9098 | 3.891 | -0.0136 [-0.0208, -0.0069] | 4.387 | 4.405 | 4.478 | -0.018 [-0.036, +0.002] | -0.41% | 0.814 | 0.065 | 0.121 |
| l_att | nb_glm_l10000 | 2.9321 | 2.9767 | 4.305 | -0.0446 [-0.0561, -0.0334] | 5.265 | 5.343 | 5.359 | -0.078 [-0.118, -0.037] | -1.46% | 0.811 | 0.088 | 0.101 |
| l_lnd | nb_glm_l30000 | 2.7504 | 2.7887 | 3.844 | -0.0384 [-0.0483, -0.0287] | 4.601 | 4.659 | 4.699 | -0.057 [-0.090, -0.026] | -1.23% | 0.817 | 0.081 | 0.102 |
| d_att | nb_glm_l10000 | 4.8831 | 4.9329 | 14.214 | -0.0498 [-0.0650, -0.0360] | 22.485 | 22.698 | 22.988 | -0.212 [-0.589, +0.179] | -0.93% | 0.818 | 0.076 | 0.106 |
| d_lnd | nb_glm_l3000 | 4.1327 | 4.1812 | 8.332 | -0.0485 [-0.0637, -0.0349] | 11.627 | 11.791 | 11.979 | -0.164 [-0.360, +0.046] | -1.39% | 0.807 | 0.076 | 0.118 |
| c_att | nb_glm_l3000 | 2.5137 | 2.5538 | 4.135 | -0.0401 [-0.0558, -0.0252] | 5.758 | 5.774 | 5.828 | -0.016 [-0.077, +0.049] | -0.28% | 0.807 | 0.092 | 0.101 |
| c_lnd | nb_glm_l3000 | 2.2355 | 2.2657 | 3.488 | -0.0302 [-0.0436, -0.0179] | 4.801 | 4.829 | 4.902 | -0.028 [-0.073, +0.020] | -0.57% | 0.816 | 0.087 | 0.097 |
| g_att | nb_glm_l3000 | 2.3139 | 2.3670 | 7.933 | -0.0532 [-0.0814, -0.0303] | 13.186 | 14.035 | 14.139 | -0.850 [-1.282, -0.442] | -6.05% | 0.771 | 0.109 | 0.120 |
| g_lnd | nb_glm_l300 | 2.0634 | 2.1127 | 5.951 | -0.0493 [-0.0731, -0.0289] | 9.680 | 10.300 | 10.390 | -0.620 [-0.947, -0.307] | -6.02% | 0.783 | 0.112 | 0.105 |
| kd | nb_t | 0.4922 | 0.6245 | 0.636 | -0.1323 [-0.1547, -0.1099] | 0.609 | 0.901 | 0.900 | -0.292 [-0.346, -0.236] | -32.41% | 0.796 | 0.101 | 0.103 |
| td_att | nb_glm_l300 | 1.9073 | 1.9417 | 2.248 | -0.0344 [-0.0462, -0.0230] | 2.505 | 2.516 | 2.568 | -0.011 [-0.056, +0.035] | -0.43% | 0.782 | 0.106 | 0.113 |
| td_lnd | nb_glm_l3000 | 1.2168 | 1.2390 | 1.318 | -0.0221 [-0.0291, -0.0156] | 1.483 | 1.494 | 1.521 | -0.011 [-0.025, +0.002] | -0.72% | 0.800 | 0.095 | 0.105 |
| ctrl | zibeta_glm_l300 | 5.0982 | 5.2280 | 58.717 | -0.1297 [-0.1550, -0.1054] | 112.201 | 112.508 | 115.319 | -0.306 [-2.434, +1.890] | -0.27% | 0.814 | 0.081 | 0.105 |
| sub_att | nb_glm_l300 | 0.6126 | 0.6545 | 0.676 | -0.0419 [-0.0557, -0.0295] | 0.807 | 0.909 | 0.906 | -0.102 [-0.141, -0.067] | -11.23% | 0.806 | 0.094 | 0.100 |
| rev | nb_base | 0.3773 | 0.3773 | 0.385 | +0.0000 [+0.0000, +0.0000] | 0.541 | 0.541 | 0.542 | +0.000 [-0.000, +0.000] | +0.00% | 0.806 | 0.095 | 0.098 |

Interval calibration of the comparators (same rows): in80 of Poisson(blend) / nb_base / chosen.

| stat | Poisson(blend) in80 | nb_base in80 | chosen in80 | chosen naive 10-90% band hit | chosen MAE of median | nb_base MAE of median |
|---|---|---|---|---|---|---|
| sig_att | 0.234 | 0.817 | 0.807 | 0.814 | 33.260 | 33.322 |
| sig_lnd | 0.296 | 0.812 | 0.807 | 0.818 | 16.940 | 17.102 |
| h_att | 0.248 | 0.808 | 0.797 | 0.807 | 28.200 | 28.141 |
| h_lnd | 0.301 | 0.811 | 0.801 | 0.828 | 12.997 | 13.036 |
| b_att | 0.417 | 0.811 | 0.813 | 0.860 | 6.443 | 6.460 |
| b_lnd | 0.459 | 0.817 | 0.814 | 0.872 | 4.769 | 4.790 |
| l_att | 0.432 | 0.806 | 0.811 | 0.875 | 5.018 | 5.037 |
| l_lnd | 0.453 | 0.810 | 0.817 | 0.885 | 4.196 | 4.211 |
| d_att | 0.238 | 0.820 | 0.818 | 0.825 | 32.844 | 33.123 |
| d_lnd | 0.301 | 0.815 | 0.807 | 0.828 | 15.501 | 15.605 |
| c_att | 0.426 | 0.817 | 0.807 | 0.900 | 3.906 | 3.952 |
| c_lnd | 0.477 | 0.815 | 0.816 | 0.914 | 2.997 | 3.004 |
| g_att | 0.257 | 0.806 | 0.771 | 0.897 | 5.436 | 5.471 |
| g_lnd | 0.307 | 0.803 | 0.783 | 0.896 | 3.899 | 3.955 |
| kd | 0.770 | 0.791 | 0.796 | 0.961 | 0.200 | 0.202 |
| td_att | 0.603 | 0.794 | 0.782 | 0.903 | 1.935 | 1.972 |
| td_lnd | 0.734 | 0.805 | 0.800 | 0.936 | 0.842 | 0.856 |
| ctrl | 0.080 | 0.784 | 0.814 | 0.882 | 87.392 | 97.788 |
| sub_att | 0.794 | 0.800 | 0.806 | 0.954 | 0.267 | 0.273 |
| rev | 0.799 | 0.791 | 0.806 | 0.959 | 0.133 | 0.133 |

Engine 4.0.0 / 4.0.0-selfcal-pre2024, 200 sims per order (2024-2025 (engine v4 params tuned on 2019-2023; clean)).

Conditional mean at the actual length (engine: rate-based mean, simulated totals / simulated minutes x t) and fights that went the distance (engine: only its simulations that went the distance; ours at t = 5R):

| stat | n | dev engine | dev chosen | diff chosen - engine | distance n | CRPS engine | CRPS chosen | CRPS diff | in80 engine | in80 chosen | >P90 engine | >P90 chosen |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | 1730 | 19.619 | 18.740 | -0.879 [-1.498, -0.313] | 924 | 31.412 | 30.468 | -0.944 [-1.662, -0.269] | 0.861 | 0.826 | 0.045 | 0.071 |
| sig_lnd | 1730 | 11.281 | 10.558 | -0.723 [-1.099, -0.372] | 924 | 15.333 | 14.862 | -0.472 [-0.778, -0.182] | 0.878 | 0.840 | 0.030 | 0.061 |
| h_att | 1730 | 18.363 | 17.581 | -0.782 [-1.355, -0.255] | 924 | 26.411 | 25.851 | -0.560 [-1.115, -0.026] | 0.820 | 0.816 | 0.070 | 0.083 |
| h_lnd | 1730 | 10.450 | 9.852 | -0.598 [-0.943, -0.270] | 924 | 11.517 | 11.321 | -0.196 [-0.420, +0.012] | 0.828 | 0.815 | 0.055 | 0.089 |
| b_att | 1730 | 5.331 | 5.228 | -0.103 [-0.178, -0.024] | 924 | 6.138 | 6.080 | -0.058 [-0.140, +0.019] | 0.738 | 0.819 | 0.084 | 0.064 |
| b_lnd | 1730 | 4.297 | 4.224 | -0.073 [-0.134, -0.014] | 924 | 4.457 | 4.429 | -0.028 [-0.089, +0.031] | 0.780 | 0.832 | 0.069 | 0.056 |
| l_att | 1730 | 5.132 | 5.057 | -0.074 [-0.150, -0.003] | 924 | 4.755 | 4.716 | -0.038 [-0.101, +0.025] | 0.685 | 0.831 | 0.117 | 0.069 |
| l_lnd | 1730 | 4.542 | 4.470 | -0.072 [-0.134, -0.012] | 924 | 3.985 | 3.944 | -0.041 [-0.093, +0.010] | 0.687 | 0.827 | 0.118 | 0.068 |
| d_att | 1730 | 21.576 | 20.736 | -0.840 [-1.464, -0.263] | 924 | 31.642 | 30.728 | -0.914 [-1.620, -0.265] | 0.798 | 0.828 | 0.075 | 0.061 |
| d_lnd | 1730 | 11.234 | 10.693 | -0.541 [-0.898, -0.205] | 924 | 14.545 | 14.184 | -0.361 [-0.693, -0.037] | 0.846 | 0.841 | 0.047 | 0.053 |
| c_att | 1730 | 5.716 | 5.578 | -0.138 [-0.282, +0.001] | 924 | 3.678 | 3.638 | -0.040 [-0.109, +0.033] | 0.807 | 0.816 | 0.083 | 0.092 |
| c_lnd | 1730 | 4.829 | 4.689 | -0.140 [-0.261, -0.026] | 924 | 2.830 | 2.787 | -0.043 [-0.096, +0.013] | 0.781 | 0.821 | 0.090 | 0.078 |
| g_att | 1730 | 13.661 | 12.947 | -0.713 [-1.299, -0.084] | 924 | 4.803 | 4.351 | -0.452 [-0.615, -0.291] | 0.642 | 0.776 | 0.084 | 0.110 |
| g_lnd | 1730 | 10.181 | 9.627 | -0.554 [-1.024, -0.084] | 924 | 3.470 | 3.166 | -0.304 [-0.423, -0.186] | 0.660 | 0.777 | 0.092 | 0.121 |
| kd | 1730 | 0.866 | 0.599 | -0.267 [-0.323, -0.213] | 924 | 0.089 | 0.087 | -0.002 [-0.004, +0.000] | 0.819 | 0.806 | 0.079 | 0.100 |
| td_att | 1730 | 2.497 | 2.401 | -0.096 [-0.173, -0.027] | 924 | 2.011 | 1.849 | -0.162 [-0.218, -0.107] | 0.523 | 0.769 | 0.228 | 0.118 |
| td_lnd | 1730 | 1.511 | 1.457 | -0.054 [-0.082, -0.026] | 924 | 0.882 | 0.810 | -0.072 [-0.091, -0.052] | 0.632 | 0.787 | 0.185 | 0.109 |
| ctrl | 1730 | 114.523 | 110.015 | -4.508 [-8.372, -0.822] | 924 | 86.017 | 81.944 | -4.073 [-6.335, -1.937] | 0.676 | 0.813 | 0.144 | 0.086 |
| sub_att | 1730 | 0.919 | 0.811 | -0.108 [-0.155, -0.063] | 924 | 0.199 | 0.202 | +0.003 [-0.001, +0.007] | 0.776 | 0.788 | 0.114 | 0.111 |
| rev | 1730 | 0.548 | 0.533 | -0.016 [-0.030, -0.001] | 924 | 0.153 | 0.147 | -0.006 [-0.010, -0.001] | 0.787 | 0.821 | 0.117 | 0.091 |

Unconditional lines (no length given): engine's full simulated distribution vs our mixture over the methodround S fight-length grid; dev is the evalv-style deviance of the unconditional mean:

| stat | n | CRPS engine | CRPS ours | CRPS diff | dev engine | dev ours | dev diff | in80 engine | in80 ours | >P90 engine | >P90 ours | <P10 engine | <P10 ours | NLL ours | NLL Poisson(blend) mix |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| sig_att | 1730 | 34.789 | 34.224 | -0.565 [-0.970, -0.127] | 43.224 | 42.077 | -1.148 [-2.194, +0.016] | 0.843 | 0.821 | 0.070 | 0.088 | 0.087 | 0.091 | 5.3624 | 7.430 |
| sig_lnd | 1730 | 16.912 | 16.591 | -0.322 [-0.511, -0.119] | 21.739 | 20.988 | -0.751 [-1.307, -0.139] | 0.855 | 0.820 | 0.052 | 0.087 | 0.093 | 0.093 | 4.6375 | 5.449 |
| h_att | 1730 | 27.904 | 27.576 | -0.328 [-0.665, +0.032] | 36.554 | 35.699 | -0.856 [-1.747, +0.103] | 0.821 | 0.812 | 0.082 | 0.097 | 0.097 | 0.092 | 5.1174 | 7.352 |
| h_lnd | 1730 | 11.766 | 11.653 | -0.112 [-0.258, +0.041] | 16.804 | 16.378 | -0.426 [-0.872, +0.041] | 0.817 | 0.813 | 0.073 | 0.103 | 0.110 | 0.084 | 4.2216 | 5.231 |
| b_att | 1730 | 5.891 | 5.799 | -0.093 [-0.156, -0.025] | 8.875 | 8.629 | -0.246 [-0.407, -0.060] | 0.802 | 0.835 | 0.084 | 0.083 | 0.113 | 0.082 | 3.5022 | 3.942 |
| b_lnd | 1730 | 4.287 | 4.207 | -0.080 [-0.125, -0.032] | 6.872 | 6.652 | -0.220 [-0.335, -0.092] | 0.791 | 0.840 | 0.080 | 0.070 | 0.129 | 0.090 | 3.1649 | 3.438 |
| l_att | 1730 | 4.256 | 4.196 | -0.060 [-0.106, -0.013] | 7.001 | 6.828 | -0.174 [-0.296, -0.055] | 0.783 | 0.845 | 0.111 | 0.080 | 0.106 | 0.075 | 3.1107 | 3.592 |
| l_lnd | 1730 | 3.539 | 3.486 | -0.053 [-0.090, -0.015] | 6.070 | 5.913 | -0.157 [-0.259, -0.061] | 0.776 | 0.837 | 0.106 | 0.076 | 0.118 | 0.087 | 2.9194 | 3.305 |
| d_att | 1730 | 32.888 | 32.358 | -0.529 [-0.952, -0.060] | 43.829 | 42.495 | -1.334 [-2.404, -0.182] | 0.834 | 0.827 | 0.081 | 0.089 | 0.085 | 0.084 | 5.2557 | 7.766 |
| d_lnd | 1730 | 14.963 | 14.662 | -0.301 [-0.495, -0.084] | 20.745 | 19.943 | -0.802 [-1.354, -0.199] | 0.839 | 0.831 | 0.065 | 0.083 | 0.096 | 0.086 | 4.4508 | 5.419 |
| c_att | 1730 | 3.230 | 3.209 | -0.021 [-0.064, +0.025] | 7.091 | 6.969 | -0.122 [-0.287, +0.047] | 0.820 | 0.819 | 0.090 | 0.095 | 0.090 | 0.086 | 2.6584 | 3.393 |
| c_lnd | 1730 | 2.469 | 2.441 | -0.028 [-0.062, +0.009] | 5.827 | 5.693 | -0.134 [-0.269, +0.001] | 0.800 | 0.809 | 0.086 | 0.088 | 0.114 | 0.103 | 2.3612 | 2.968 |
| g_att | 1730 | 4.502 | 4.305 | -0.197 [-0.269, -0.132] | 13.638 | 13.632 | -0.006 [-0.368, +0.373] | 0.723 | 0.787 | 0.106 | 0.114 | 0.171 | 0.099 | 2.3232 | 5.286 |
| g_lnd | 1730 | 3.272 | 3.139 | -0.133 [-0.187, -0.082] | 10.129 | 10.108 | -0.021 [-0.298, +0.273] | 0.721 | 0.783 | 0.106 | 0.114 | 0.173 | 0.102 | 2.0770 | 4.250 |
| kd | 1730 | 0.156 | 0.156 | +0.000 [-0.002, +0.002] | 0.649 | 0.647 | -0.002 [-0.014, +0.010] | 0.817 | 0.827 | 0.087 | 0.086 | 0.095 | 0.087 | 0.5023 | 0.503 |
| td_att | 1730 | 1.701 | 1.614 | -0.087 [-0.113, -0.061] | 3.418 | 3.309 | -0.109 [-0.199, -0.029] | 0.672 | 0.784 | 0.173 | 0.116 | 0.155 | 0.100 | 2.0535 | 2.266 |
| td_lnd | 1730 | 0.703 | 0.669 | -0.034 [-0.042, -0.025] | 1.807 | 1.749 | -0.058 [-0.089, -0.027] | 0.714 | 0.795 | 0.150 | 0.108 | 0.136 | 0.097 | 1.2907 | 1.369 |
| ctrl | 1730 | 73.655 | 71.540 | -2.114 [-3.340, -1.040] | 154.147 | 147.899 | -6.248 [-10.701, -2.536] | 0.774 | 0.828 | 0.118 | 0.078 | 0.108 | 0.094 | 5.2548 | 23.917 |
| sub_att | 1730 | 0.220 | 0.221 | +0.000 [-0.003, +0.004] | 0.830 | 0.829 | -0.001 [-0.021, +0.019] | 0.786 | 0.805 | 0.105 | 0.095 | 0.109 | 0.099 | 0.6309 | 0.633 |
| rev | 1730 | 0.119 | 0.116 | -0.002 [-0.004, -0.000] | 0.575 | 0.557 | -0.018 [-0.031, -0.004] | 0.795 | 0.811 | 0.110 | 0.092 | 0.095 | 0.097 | 0.3842 | 0.390 |

PIT histograms (10 bins, counts) for key stats:

| stat | model | histogram |
|---|---|---|
| sig_lnd | ours, given t (all rows) | 234 205 230 199 213 197 223 207 200 166 |
| sig_lnd | Poisson(blend), given t | 886 106 82 59 76 57 65 66 103 574 |
| sig_lnd | engine, distance only | 85 82 83 97 116 93 122 135 83 28 |
| sig_lnd | ours, distance only | 92 92 102 92 92 91 118 87 102 56 |
| sig_lnd | engine, unconditional | 161 160 181 172 175 174 193 209 215 90 |
| sig_lnd | ours, unconditional | 161 166 162 169 172 174 172 208 195 151 |
| sig_att | ours, given t (all rows) | 223 186 189 197 210 217 245 224 205 178 |
| sig_att | Poisson(blend), given t | 886 82 65 54 47 41 48 59 89 703 |
| sig_att | engine, distance only | 86 68 74 97 94 107 118 123 114 43 |
| sig_att | ours, distance only | 95 88 80 94 104 95 106 105 91 66 |
| sig_att | engine, unconditional | 151 160 178 170 166 183 191 193 214 124 |
| sig_att | ours, unconditional | 157 144 152 177 179 173 194 195 207 152 |
| td_att | ours, given t (all rows) | 234 215 200 205 211 193 176 213 208 219 |
| td_att | Poisson(blend), given t | 462 248 205 151 138 113 137 125 134 361 |
| td_att | engine, distance only | 230 95 62 64 55 44 42 62 59 211 |
| td_att | ours, distance only | 104 88 88 87 90 89 83 94 92 109 |
| td_att | engine, unconditional | 268 262 202 141 121 129 92 101 114 300 |
| td_att | ours, unconditional | 173 164 154 160 171 178 183 166 180 201 |
| td_lnd | ours, given t (all rows) | 218 187 213 224 219 220 202 192 203 196 |
| td_lnd | Poisson(blend), given t | 276 249 243 235 182 170 146 145 152 276 |
| td_lnd | engine, distance only | 169 126 103 76 63 48 60 42 66 171 |
| td_lnd | ours, distance only | 96 91 93 105 89 90 93 75 91 101 |
| td_lnd | engine, unconditional | 235 230 188 196 168 144 108 100 101 260 |
| td_lnd | ours, unconditional | 168 176 164 172 189 175 179 161 159 187 |
| ctrl | ours, given t (all rows) | 217 213 229 219 211 201 231 205 179 169 |
| ctrl | Poisson(blend), given t | 1264 29 17 16 16 17 19 24 28 644 |
| ctrl | engine, distance only | 166 85 89 89 64 86 71 74 67 133 |
| ctrl | ours, distance only | 94 79 104 104 98 95 107 93 71 79 |
| ctrl | engine, unconditional | 186 190 167 192 192 158 161 129 148 207 |
| ctrl | ours, unconditional | 163 169 148 162 193 199 187 192 182 135 |
| kd | ours, given t (all rows) | 214 218 215 191 206 195 211 210 204 210 |
| kd | Poisson(blend), given t | 209 193 209 234 232 193 184 181 172 267 |
| kd | engine, distance only | 94 107 89 87 83 89 92 119 91 73 |
| kd | ours, distance only | 87 106 95 81 97 82 98 97 89 92 |
| kd | engine, unconditional | 165 181 189 174 169 181 186 170 164 151 |
| kd | ours, unconditional | 151 174 180 156 188 188 181 186 178 148 |
| sub_att | ours, given t (all rows) | 207 207 213 211 217 216 205 202 201 195 |
| sub_att | Poisson(blend), given t | 208 228 227 256 217 202 190 158 169 219 |
| sub_att | engine, distance only | 102 93 77 82 89 107 85 111 73 105 |
| sub_att | ours, distance only | 93 96 92 95 93 95 87 75 95 103 |
| sub_att | engine, unconditional | 189 172 159 164 171 178 160 199 157 181 |
| sub_att | ours, unconditional | 172 164 162 173 152 184 188 180 190 165 |

### Winner expert on 2024-2025 (confirmation only)

| comparison | n | a | b | diff [CI] | entered by CV |
|---|---|---|---|---|---|
| line|market+ml2 + statlines vs base (2024-2025, static fit <= 2023) | 845 | 0.57663 | 0.57663 | +0.00000 [-0.0000, +0.0000] | False |
| line|page: market+ml2lr + statlines vs base (2024-2025, static fit <= 2023) | 845 | 0.57574 | 0.57574 | -0.00000 [-0.0000, +0.0000] | False |
| noline|ml2+mkt_rating+feat_lr + statlines vs base (2024-2025, static fit <= 2023) | 854 | 0.58980 | 0.58981 | -0.00000 [-0.0000, -0.0000] | False |
| noline|page: ml2lr+mkt_rating + statlines vs base (2024-2025, static fit <= 2023) | 854 | 0.58898 | 0.58899 | -0.00000 [-0.0000, -0.0000] | False |
| open|open+ml2 + statlines vs base (2024-2025, static fit <= 2023) | 843 | 0.58230 | 0.58229 | +0.00000 [+0.0000, +0.0000] | False |
| open|page: open+ml2lr + statlines vs base (2024-2025, static fit <= 2023) | 843 | 0.58115 | 0.58115 | -0.00000 [-0.0000, -0.0000] | False |

Expert alone 2024-2025: log loss 0.6262, accuracy 0.656 (n 854).
