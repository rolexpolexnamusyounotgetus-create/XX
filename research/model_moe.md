# moe: mixture-of-experts stacker (the final win-probability layer)

Status: built, validated and exported, Nov 6, 2026. This layer is the last step before the page shows a
winner probability. It blends every expert the page has for a matchup: the market line, the market rating,
the engine, the tools/ml.py model, the built-in feature model, strike-share Elo and Elo.

Files:

- `tools/moe.py`: prep, experts, fit, report and export.
- `tools/moe_engine_bt.js`: the engine expert on backtest_dev.
- `src/ml/moe.js`: dependency-free UMD evaluator.
- `tests/test_moe.js`: 21 checks.
- Outputs:
  - `data/derived/moe.json` (349 kB): model, validated model, alternatives, built-in ML expert, full report and test vectors.
  - `data/derived/moe_page.json` (19 kB): the compact copy the page should inline.
  - `data/derived/moe_engine_bt.json`: engine predictions for all 2,864 backtest_dev fights.
  - Caches in `out/moe_cache/` (gitignored).

## Verdict

All numbers below are 2024-01-01..2025-12-31 validation fights, decisive only (n = 854; n = 844 when the market
line is needed). Every model is exactly corner-symmetric, so a score is the same in both corner orders. Brackets are
95% bootstrap CIs, resampled by event date (1,000 to 2,000 draws). Two schemes are reported:

- **"Static"** is the protocol number. Experts and the stacker are trained on fights up to 2023 only.
- **"Rolling"** refits experts and the stacker each January, so 2025 is predicted from fits through 2024. This is how the production model behaves.

| what the page has | MoE static | MoE rolling | best single input | MoE minus best single, static [CI] |
|---|---|---|---|---|
| everything + closing line (the 844 fights with a line) | **0.5796** [0.555, 0.604] | 0.5787 | market 0.5857 | **-0.0061 [-0.0088, -0.0034]** |
| everything, no line | **0.5955** [0.574, 0.617] | 0.5919 | ml 0.6079 | **-0.0124 [-0.0230, -0.0014]** |
| no line, no market rating | 0.6061 | 0.6018 | ml 0.6079 | -0.0018 [-0.0032, -0.0005] |
| moe.js alone (engine + feature LR + Elo) | 0.6145 | 0.6095 | feat_lr 0.6133 | +0.0013 [-0.0012, +0.0037] |
| line + engine + feature LR + Elo (844 fights with a line) | 0.5804 | 0.5795 | market 0.5857 | -0.0053 [-0.0074, -0.0031] |

Review correction (Verification log): the two line rows used to show 0.5821 / 0.5832 on 854 fights, which included
10 fights without a line, next to the market's 844. They are now on the same 844 fights. The differences were
already on 844.

- **With a line, the stack beat the closing line in 2024-25 but not in 2021-2023.** In 2024-25 it improves on the de-vigged close by 0.006 log loss, and the CI excludes zero. By year:
  - 2024: 0.5818 vs 0.5871.
  - 2025: 0.5773 static and 0.5754 rolling, vs 0.5842.
  - The same stacker in the forward-chained CV years 2021-2023 is level with the line: +0.0011 [-0.0023, +0.0046] (2021 -0.003, 2022 +0.006, 2023 -0.000).
  - Pooled over every out-of-sample year (2021-2025, n = 2,061): -0.0019 [-0.0042, +0.0004].
  - Read it as level with the line to slightly better, not as a reliable edge. The 2024-25 gain is information rather than a calibration artefact: it holds against the market given its best 2024-25 slope (-0.0057 [-0.0100, -0.0016]).
  - Numbers: moe.json `report.audit`.
- **Without a line it nearly reaches the market.** The no-line stack is 0.012 better than the best single pre-line expert. Unlike the line-present gain, this one also holds in the CV years: -0.0071 [-0.0136, -0.0006] vs tools/ml.py's model in 2021-2023. In 2025 the rolling no-line stack scores 0.5802, almost the closing line's 0.5842. The gain comes from blending tools/ml.py, the walk-forward market rating (from earlier closing lines) and the feature LR. Their logits correlate 0.58-0.91, so they still carry different information.
- **A linear stack wins in both regimes.** Within each family, hyper-parameters were chosen by forward-chained CV on 2021-2023. The two winners:
  - With a line: constrained logit-linear, no intercept, no recency weighting, no calibration.
  - Without a line: the same, plus recency weights (half-life 1.5 years) and temperature calibration.
  - The gated MoE and the GBM meta-learners did not beat it in CV (table below).
  - The gating features (experience, Elo gap, layoff, age, division, rounds, pre-UFC data, which experts are present) carried no signal the CV could exploit. Under any penalty that did not overfit, the softmax gate collapsed to constant weights.
- **Every expert, the market included, became underconfident in 2024-25.** This is the most important finding for the rest of the project. Calibration slopes by year are in the table below. 2024-25 fights were more predictable than 2019-23: the closing line's log loss fell from 0.63 to 0.585. Models fit on 2019-2023 under-react to skill gaps.
  - The static no-line stack is therefore pessimistic. Its 2021-2023 temperature shrinks predictions that should have been stretched.
  - The production model is refit on 2019-2025 with recency weighting, and its no-line temperature came out at 1.17, i.e. it stretches.
  - Every other model in the project should be recalibrated on recent data too.
  - **Risk:** the production no-line model is much sharper than the validated one: weight sum 1.82 × temperature 1.17, against 1.45 × 1.04.
    - Its mean |p − 0.5| is 0.187, against 0.141 for the validated model on the same 2019-2023 fights.
    - If 2026 fights look like 2019-2023 rather than 2024-25, it costs 0.013 log loss there: 0.6556 vs 0.6425.
    - The same procedure, run one year earlier (fit through T, scored on T+1), under-stretched every year it could be checked (2023, 2024, 2025), and its temperature helped each time.
    - So the stretch is supported, but only by a 3-year trend. Watch the forward-test log loss. If 2026 calibration slopes fall back toward 1, refit with h = 3 or drop the temperature.
    - Line-present production is barely affected: 0.6228 vs 0.6221 on 2019-2023.

## Experts

Each per-fight expert is strictly out-of-fold for 2019-2023: it is produced by a model trained only on earlier
fights, or it is a walk-forward rating. Log loss on decisive fights:

| expert | source | train 2019-23 | valid static | valid rolling | page can compute it? |
|---|---|---|---|---|---|
| market | market.json `p_power_close` (power de-vig of consensus close) | 0.6232 | 0.5857 | = | optional line: `MoE.devig(oddsA, oddsB)` |
| market (open) | market.json `p_novig_open` | 0.6377 | 0.6083 | = | not used in the stack |
| mkt_rating | market.json `p_market_rating` (walk-forward Kalman rating from earlier closing lines) | 0.6541 | 0.6268 | = | `MoE.ratingProb(mu, sd, ...)` with market.json `ratings[slug]` |
| ml | ml.json `lr` (the tools/ml.py page winner model without its Platt slope); `lr_refit` for rolling | 0.6496 | 0.6079 | 0.6071 | yes, via the ml.json page model |
| feat_lr | this tool: symmetric L2 logistic on 60 side-feature differences | 0.6548 | 0.6133 | 0.6125 | yes: `MoE.featLR` (built in) |
| engine | FightEngine.summarize, 100 sims per corner order, pA/(pA+pB) | 0.6785 | 0.6436 | = | yes (the page's tally) |
| elo_sig | ml.json strike-share Elo | 0.6729 | 0.6637 | = | yes, via ml.json `roster[slug].elo_sig` |
| elo | backtest snapshot Elo (K 44, boost 1.5) | 0.6857 | 0.6769 | = | yes |

Research-only experts are in the "full" set. None improved the page set:

| expert | train 2019-23 | valid static |
|---|---|---|
| feature LR with Glicko, opponent Elo and title count | 0.6540 | 0.6105 |
| feature LightGBM | 0.6557 | 0.6190 |
| ml.json GBM | 0.6503 | 0.6134 |
| ml.json blend | 0.6482 | 0.6102 |
| walk-forward Glicko (RD0 150, c 2.4/day, tuned 2012-2023) | 0.6859 | 0.6756 |

The 12-expert full stack scored 0.5818 with a line and 0.5962 without one, the same as the 7-expert page set.

The feature experts (`python3 tools/moe.py experts`):

- **Data.** Walk-forward snapshots from 2010 on, in the backtest.json format. They are rebuilt by calling tools/build_db.py's `walk()`, with every fight dated 2026-01-01 or later dropped first. Counters (layoff, career minutes, record, streak, last 3 results, 5-round fights, finish rates) are computed before each fight.
- **Rates.** Shrunk toward walk-forward division priors (`priors_asof`: the 5 years before Jan 1 of the fight's year).
- **Choices.** LR C and GBM size were chosen on 2016-2018 inner folds, never on 2019+.
- **Out-of-fold predictions.**
  - 2019-2023: an expanding-window refit each year.
  - 2024-25 static: the ≤2023 model.
  - 2024-25 rolling: a January refit.
- **Symmetry.** The LR has no intercept and is fit on mirrored rows. The GBM is trained on mirrored rows and averaged over both corner orders.

Calibration slope (logit refit, 1 = calibrated, above 1 = underconfident) and log loss by year, decisive fights:

| expert | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|
| market | 0.632 (1.02) | 0.629 (0.99) | 0.640 (0.96) | 0.603 (1.14) | 0.613 (1.03) | 0.587 (1.13) | 0.584 (1.09) |
| mkt_rating | 0.679 (0.68) | 0.655 (1.17) | 0.664 (0.96) | 0.642 (1.37) | 0.631 (1.54) | 0.631 (1.51) | 0.622 (1.58) |
| ml | 0.657 (0.86) | 0.656 (0.88) | 0.644 (1.01) | 0.646 (1.04) | 0.646 (1.01) | 0.607 (1.68) | 0.609 (1.59) |
| feat_lr | 0.657 (0.92) | 0.656 (0.91) | 0.653 (0.91) | 0.657 (0.88) | 0.652 (0.91) | 0.617 (1.38) | 0.609 (1.48) |
| engine | 0.670 (0.88) | 0.686 (0.59) | 0.653 (1.05) | 0.693 (0.49) | 0.692 (0.51) | 0.647 (1.24) | 0.640 (1.32) |
| elo_sig | 0.679 (0.81) | 0.672 (0.89) | 0.674 (0.89) | 0.668 (1.05) | 0.672 (0.90) | 0.667 (1.09) | 0.660 (1.19) |
| elo | 0.698 (0.32) | 0.684 (0.86) | 0.681 (0.98) | 0.679 (1.01) | 0.686 (0.77) | 0.677 (1.13) | 0.677 (1.14) |

Fights per year: 388, 343, 415, 419, 390, 429, 425. The engine is unstable across years: it is near coin-flip in
2022-2023 (slope 0.5) and decent in 2024-25. This is why the stack gives it little weight (0 to 0.12).

## Stackers

Inputs:

- Each expert enters as `logit(clip(p, 0.01, 0.99))`, which flips sign under a corner swap.
- Gating features are symmetric functions of the two sides:
  - experience: log(1 + min prior UFC fights), log(1 + max), log(1 + min career UFC minutes);
  - |Elo gap| / 100;
  - format and division: 5 rounds, women / 125-145 / 205-265 groups;
  - layoff: the longer layoff, in log days;
  - age: mean age − 30 and |age gap|;
  - pre-UFC record known (data/derived/preufc.json);
  - for the gated model, one presence bit per optional expert group.
- No model has an intercept, so all are exactly symmetric.
- All are trained with **expert-dropout augmentation** over the 16 availability patterns the page can meet. The optional groups are {market line}, {market rating}, {engine} and {ml + elo_sig}; feat_lr and elo are always present.

The three families:

- **(a) Linear.** `p = σ(Σ w_k logit p_k)`, with `w_k ≥ 0` and one weight vector per availability pattern. Fit by L-BFGS-B, optionally with recency weights `0.5^(years before the last training year / h)`.
- **(b) Gated MoE.** `z = exp(u·g) · Σ_k softmax_k(V g | present experts) · logit p_k`. Fit jointly over all patterns, with an L2 penalty λ on every non-bias gate coefficient, analytic gradients and L-BFGS.
- **(c) GBM meta-learner.**
  - Plain variant: LightGBM on expert logits (NaN when absent) plus gating features, trained on mirrored rows and averaged over both corner orders.
  - Residual variant (`gbm_res`): boosts from the linear stack's logit as base margin.

Calibration is one of three kinds:

- none;
- temperature, the symmetric beta calibration with a = b and c = 0;
- isotonic, fit on mirrored data and symmetrised.

The kind is fit on forward-chained out-of-fold stacker logits and chosen nested: fit on the 2021-2022 out-of-fold
logits, scored on 2023.

Selection (2024-25 was never used for any choice) works in four steps:

1. Run forward-chained CV inside 2019-2023: train from 2019 up to year Y−1, predict Y, for Y = 2021, 2022, 2023. Score each regime (line present / absent) as the mean log loss over its 8 availability patterns.
2. Within each family, keep the lowest-CV hyper-parameters.
3. Across families, keep the simplest (linear, then gated, then gbm_res, then gbm) unless a more complex one is better by more than 0.0005. Disclosure: this parsimony margin was added after the first full run, where gated beat linear by about 0.00001 in the line-present regime.
4. Pick the calibration kind nested inside the CV.

| regime | linear | gated | gbm_res | gbm | chosen |
|---|---|---|---|---|---|
| CV log loss, line present | **0.6196** | 0.6196 (λ 0.1) | 0.6200 | 0.6266 | linear, no recency, no calibration |
| CV log loss, no line | **0.6443** (h 1.5) | 0.6468 | 0.6451 | 0.6544 | linear, h 1.5, temperature |
| valid static, everything + line | **0.5821** | 0.5829 | 0.5835 | 0.5776 | |
| valid static, everything, no line | **0.5955** | 0.6051 | 0.5972 | 0.6033 | |

Note: with a line, the GBM meta-learner posted the best validation score (0.5776, −0.0105 vs market
[−0.0185, −0.0021]) but the worst CV score. Its 2021-2023 behaviour was poor, so the rule rejects it. This is worth
re-checking in v9, when more seasons are available.

Production weights (`data/derived/moe.json` → `model.present.linear` / `model.absent.linear`):

- With a line and every expert present: market 0.81, mkt_rating 0.15, ml 0.16, feat_lr 0.19, engine 0, elo_sig 0, elo 0.
- With no line and every expert present: mkt_rating 0.80, ml 0.59, feat_lr 0.36, engine 0.07, elo_sig 0, elo 0, then temperature 1.17.

The weights sum to more than 1 because the inputs are partly independent. This is how the stack sharpens beyond any
single expert.

## Segments (validation, static, fights with a market line)

| segment | n | market | MoE with line | Δ vs market [95% CI] | MoE no line | ml | feat_lr | mkt_rating | engine | elo | Δ no line vs best single [95% CI] |
|---|---|---|---|---|---|---|---|---|---|---|---|
| newcomer bout (a side with ≤2 prior UFC fights) | 258 | 0.6051 | 0.6010 | -0.0041 [-0.0103, +0.0016] | 0.6203 | 0.6363 | 0.6408 | 0.6398 | 0.6581 | 0.6850 | -0.0160 [-0.0357, +0.0049] (ml) |
| middle experience (both 3-7) | 351 | 0.5702 | 0.5614 | -0.0088 [-0.0129, -0.0049] | 0.5617 | 0.5851 | 0.5909 | 0.6032 | 0.6431 | 0.6664 | -0.0233 [-0.0394, -0.0068] (ml) |
| veterans (both ≥8) | 235 | 0.5876 | 0.5832 | -0.0044 [-0.0099, +0.0015] | 0.6099 | 0.6032 | 0.6063 | 0.6477 | 0.6253 | 0.6853 | +0.0067 [-0.0134, +0.0270] (ml) |
| men 125-145 | 269 | 0.5968 | 0.5938 | -0.0030 [-0.0074, +0.0015] | 0.6190 | 0.6221 | 0.6186 | 0.6461 | 0.6519 | 0.6932 | +0.0005 [-0.0214, +0.0218] (feat_lr) |
| men 155-185 | 327 | 0.5695 | 0.5589 | -0.0107 [-0.0147, -0.0064] | 0.5612 | 0.5849 | 0.5955 | 0.6051 | 0.6334 | 0.6737 | -0.0236 [-0.0403, -0.0057] (ml) |
| men 205-265 | 102 | 0.6327 | 0.6345 | +0.0018 [-0.0057, +0.0095] | 0.6379 | 0.6554 | 0.6676 | 0.6368 | 0.6812 | 0.6547 | +0.0010 [-0.0303, +0.0323] (mkt_rating) |
| women | 146 | 0.5686 | 0.5615 | -0.0071 [-0.0153, +0.0011] | 0.5852 | 0.5878 | 0.5891 | 0.6326 | 0.6199 | 0.6720 | -0.0026 [-0.0302, +0.0236] (ml) |
| Lightweight | 119 | 0.5901 | 0.5772 | -0.0129 [-0.0234, -0.0033] | 0.5596 | 0.5822 | 0.6015 | 0.6062 | 0.6293 | 0.6526 | -0.0226 [-0.0551, +0.0051] (ml) |
| Welterweight | 100 | 0.5910 | 0.5805 | -0.0104 [-0.0171, -0.0043] | 0.5961 | 0.6162 | 0.5882 | 0.6313 | 0.6408 | 0.6959 | +0.0079 [-0.0270, +0.0428] (feat_lr) |
| Middleweight | 108 | 0.5271 | 0.5185 | -0.0086 [-0.0148, -0.0019] | 0.5307 | 0.5589 | 0.5957 | 0.5796 | 0.6311 | 0.6765 | -0.0281 [-0.0565, +0.0041] (ml) |
| Light Heavyweight | 54 | 0.6841 | 0.6945 | +0.0105 [-0.0010, +0.0225] | 0.6931 | 0.7009 | 0.7261 | 0.6651 | 0.6919 | 0.6671 | +0.0280 [-0.0177, +0.0762] (mkt_rating) |
| pick'em (favourite < 60%) | 222 | 0.6788 | 0.6705 | -0.0083 [-0.0147, -0.0021] | 0.6705 | 0.6749 | 0.6656 | 0.6852 | 0.6764 | 0.6942 | +0.0049 [-0.0192, +0.0294] (feat_lr) |
| moderate favourite (60-75%) | 407 | 0.6267 | 0.6208 | -0.0059 [-0.0099, -0.0020] | 0.6312 | 0.6261 | 0.6340 | 0.6631 | 0.6590 | 0.6923 | +0.0051 [-0.0091, +0.0191] (ml) |
| heavy favourite (≥ 75%) | 215 | 0.4118 | 0.4076 | -0.0042 [-0.0088, +0.0007] | 0.4409 | 0.4959 | 0.5091 | 0.4976 | 0.5773 | 0.6315 | -0.0550 [-0.0754, -0.0350] (ml) |
| 5-round | 105 | 0.6206 | 0.6109 | -0.0097 [-0.0178, -0.0017] | 0.5775 | 0.6001 | 0.6297 | 0.6069 | 0.6541 | 0.6683 | -0.0226 [-0.0496, +0.0045] (ml) |
| 3-round | 739 | 0.5807 | 0.5751 | -0.0056 [-0.0081, -0.0028] | 0.5953 | 0.6066 | 0.6077 | 0.6296 | 0.6411 | 0.6786 | -0.0113 [-0.0215, -0.0001] (ml) |
| pre-UFC record known for a side | 443 | 0.5924 | 0.5845 | -0.0079 [-0.0111, -0.0047] | 0.5875 | 0.5997 | 0.5994 | 0.6236 | 0.6346 | 0.6830 | -0.0119 [-0.0301, +0.0070] (feat_lr) |

The "best single" column picks the best expert within each segment, on the segment's own fights. That flatters the
single experts.

Where the gains are, and where they are not:

- **Gains with a line:** concentrated in the middle-experience bouts, men 155-185 and pick'ems.
- **No gain with a line:** light-heavyweight and heavyweight (205-265), where the line alone is as good or better (+0.002, CI spans 0).
- **Without a line, the biggest gain is heavy favourites** (−0.055). That is the 2024-25 underconfidence of single experts being partly undone by stacking.
- **Every division (log loss, market vs MoE with line):**
  - Flyweight: 0.5957 → 0.5904.
  - Bantamweight: 0.6123 → 0.6061.
  - Featherweight: 0.5825 → 0.5843.
  - Heavyweight: 0.5750 → 0.5670.
  - Women's Strawweight: 0.5726 → 0.5738.
  - Women's Flyweight: 0.5377 → 0.5259.
  - Full rows with CIs: moe.json `report.segments`.

Calibration on validation, mirrored reliability bins (predicted → observed):

- **MoE with line:** 0.554 → 0.596, 0.654 → 0.622, 0.743 → 0.785, 0.843 → 0.900. ECE 0.042; the market's own is 0.026.
- **MoE without line:** 0.550 → 0.574, 0.646 → 0.704, 0.745 → 0.792, 0.840 → 0.923. Still underconfident in 2024-25. The production refit addresses this.

## Exported model and page integration

The evaluator is `src/ml/moe.js` (UMD, so `require()` in Node, `self.MoE` in a worker). The model file is
`data/derived/moe_page.json` (19 kB: `model` + `feat`). The model is a `switch`:

- `present` is used when a market line is given, and `absent` otherwise.
- Each part holds linear weights for the 16 availability patterns.
- If the page passes an untrained combination (e.g. `ml` without `elo_sig`), the evaluator uses the largest trained pattern inside it and lists the rest in `r.ignored`.

The page call:

```js
const MOE = /* inlined data/derived/moe_page.json */, M = MoE.load(MOE);
const o = { keys: DB.meta.keys, snapshot: DB.meta.snapshot, halfLife: DB.meta.half_life_days };
const A = MoE.sideFromProfile(profA, fightDate, o), B = MoE.sideFromProfile(profB, fightDate, o);
const experts = {
  engine: s.pA / (s.pA + s.pB),                 // FightEngine.summarize(m, N), N >= 2000
  feat_lr: MoE.featLR(MOE.feat, A, B, { division, homeA: A.home, homeB: B.home }),
  elo: MoE.eloProb(A.elo, B.elo),
};
// optional groups: pass all members or none
if (mlPage) {                                   // tools/ml.py page model (ml.json page_model.winner)
  experts.ml = sigmoid(sumOfWinnerTerms);       // WITHOUT platt_slope (that is what the stack was fit on)
  experts.elo_sig = MoE.eloProb(roster[slugA].elo_sig, roster[slugB].elo_sig);
}
const ra = marketRatings[slugA], rb = marketRatings[slugB];      // market.json ratings[slug] = [mu, sd, ...]
if (ra && rb) experts.mkt_rating = MoE.ratingProb(ra[0], ra[1], rb[0], rb[1]);
if (line) experts.market = MoE.devig(line.oddsA, line.oddsB);    // American odds, power de-vig
const r = M.predict({ experts, gate: MoE.gateFromSides(A, B, { division, rounds, preufcA, preufcB }) });
// r.p = final P(A wins); r.weights / r.contrib for the model-stack panel; r.regime "present" | "absent"
const f = MoE.winnerFactors(s.pA, s.pB, s.pD, r.p);  // multiply the engine's A-win outputs by f.fA, B-win by f.fB
```

- **Draws.** Every expert, and the output, is P(A wins | decisive). `winnerFactors` rescales the engine's method / round / judges distribution so it agrees with the stacked winner probability. It keeps the engine's draw share and its method mix within each winner.
- **Gate inputs** come from the profiles: prior UFC fights, career UFC minutes (`C[min]`), Elo, days since the last fight, age at the fight date, division, rounds, and pre-UFC data known (preufc.json). They do not move the linear model (it has no gate). They feed the gated alternative that `moe.json` also carries (`MoE.load(doc, "gated_validated")`).
- **Wiring.** `build.py` and `page.src.html` belong to other agents. Inlining needs a `/*__MOE__*/` script slot for `src/ml/moe.js` and a JSON slot for `moe_page.json`.

Test: `node tests/test_moe.js` (21 checks). It verifies:

- The JS reproduces the Python predictions on 120 vectors: max |diff| 2.8e-16 for production and 2.2e-16 for the validated model. The vectors cover every pattern family and both corner orders.
- `featLR` reproduces Python on 40 validation fights (1.1e-16).
- Corner symmetry, all-50% in gives 50% out, and the fallback for untrained patterns.
- The UMD bundle works in a worker-like global.
- A live Volkanovski vs Gaethje call evaluates.

## Refresh recipe

Rerun after an engine recalibration (`params3.js`), a tools/ml.py or tools/market.py rebuild, or a data refresh.
Set `OMP_NUM_THREADS=1` on this shared box: LightGBM and OpenBLAS with 2 threads ran more than 10x slower than with 1 under load average ~40.

```
python3 tools/moe.py prep                                   # ~15 s: snapshots 2010-2025, priors_asof, Glicko, counters
node tools/moe_engine_bt.js --sims 100 --part 0 --parts 2 & node tools/moe_engine_bt.js --sims 100 --part 1 --parts 2; wait
node tools/moe_engine_bt.js --merge                         # engine expert (~2.5 min per part at low load)
OMP_NUM_THREADS=1 python3 tools/moe.py experts              # ~3 min: feature LR / GBM / Glicko + page LR
OMP_NUM_THREADS=1 python3 tools/moe.py fit                  # ~6 min: CV, validation, report, moe.json + moe_page.json
node tests/test_moe.js
```

To plug in a new expert:

1. Make it publish strictly out-of-fold per-fight P(A) for the backtest ids.
2. Add a reader in `external_experts()`.
3. Add its name to `SETS["page"]`, and to `OPTIONAL_GROUPS` if the page may lack it.
4. Rerun `fit`.
5. The page passes it under the same key.

Generic `ratings.json` / `methodround.json` / `oppadj.json` readers are already in place. They activate when the file has a per-fight table with `p`/`pA` fields.

## Caveats

- **Static vs rolling.** The static numbers are the protocol's numbers. The exported production model is the same specification refit on 2019-2025. It is what the rolling column approximates, and it cannot be scored on 2024-25 itself. `model_validated` in moe.json is the fit that produced the static report.
- **The engine expert** used 200 sims per fight (100 per corner order). Its Monte Carlo noise (about 0.14 of the 0.55 total logit sd) slightly attenuates its weight. The page's 20,000-sim tally is sharper than what the stack saw.
  - The engine and params hashes are recorded in `moe_engine_bt.json`.
  - The engine was being recalibrated while this ran. Rerun after the new `params3.js` lands.
  - That params3 version is stale: its sha256 prefix was `c3eec948...`, the current file's is `2321d486...`.
  - Its `[selfcal]` scales were fit to league base rates from 2015-01-01 to 2026-10-31, which include 2024-25 and the vault. Only league averages reach the engine (no per-fight outcomes), and it has weight 0 in every validated pattern the page uses, so no validated number depends on it. Production gives it 0.02-0.12 in patterns without ml or market.
- **Live-only data from other files.** The ml.json page model and market.json `ratings` are fit through the snapshot (2026-10-31), so they include vault fights. That is fine for live use, but they must not be used to score 2026 fights.
  - This tool read only backtest_dev ids from those files.
  - Its own data (snapshots, priors, Glicko, feature LR, priors for live use) stops at 2025-12-31.
- **Expert coverage.** The market rating needs earlier closing lines for both fighters. It covers 99.3% of backtest_dev fights but fewer UFC debut-like cases in the page. The stack falls back to the patterns without it.
- **Volkanovski vs Gaethje** (test call, engine set to a 0.60 placeholder):
  - Without a line, the stack says Volkanovski 0.79. The feature LR says 0.67 and the market rating 0.63.
  - With the +160/-180 opener it says 0.47; the market alone says 0.37.
  - The feature models do not see the move up to 155 or the 5-round late-career context. Treat a large no-line vs line gap as a flag, not an edge.
- **Gating.** The gated MoE is exported as an alternative (`gated_validated`, validated fit only) because the task asked for one. It is not the recommended model.
- **Hidden-data protocol.** Every fight dated 2026-01-01 or later was dropped before anything was computed, and no 2026 fight was scored.
