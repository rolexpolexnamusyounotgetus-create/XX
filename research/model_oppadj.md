# oppadj: opponent (strength-of-schedule) adjustment, walk-forward

Status: built and validated Nov 6, 2026 (afternoon); adversarial review the same afternoon (see "Verification
log" at the end: the headline per-fight result reproduces exactly with independent code; verdicts 3 and 7 and the
Volkanovski vs Gaethje numbers were corrected in place). Roadmap slot: v4 "opponent-adjusted skills, tuned
half-life and per-stat prior strengths" (now merged into the v5 build). Files:

- `tools/oppadj.py`: data, walk-forward two-way fits, grid search, held-out scoring, factors, report numbers.
- `tools/oppadj_engine.js`: engine v3 Monte Carlo check (plain, plain x factors, ML rates, ML x factors^beta);
  it loads `src/engine3.js` from its own text with one hook line added in memory. No file under `src/` is edited.
- `data/derived/oppadj.json`: `snapshots[fight_id][A|B]` (3,237 backtest fights, pre-fight factors),
  `roster[slug]` (1,229 fighters, factors at the Oct 31, 2026 snapshot plus a schedule diagnostic),
  `results` (every number in this report), `meta` (semantics, units, engine k values used).

Factor names (task name -> fields in `oppadj.json`, each relative to the same field of `fighterRates`):
att_adj -> dAtt, cAtt, gAtt (attempt rates at distance, in the clinch, on top); def_adj -> accAg[t] (accuracy
odds allowed, t = head, body, leg) and dAttAg, cAttAg, gAttAg (attempts allowed); acc_adj -> acc[t] (accuracy
odds); kdpow_adj -> pow; chin_adj -> chin; td_adj -> tdAtt (attempts) and tdAcc (success odds); tddef_adj ->
tdAccAg (success odds allowed) and tdAttAg; plus ctrl / octrl (control, control allowed), topSkill / escWeak
(control per takedown landed / absorbed), sub / subAg (submission attempts, allowed).

Reproduce (4 cores): `python3 tools/oppadj.py` (about 11 minutes; `--cache f.pkl` saves the grid and
`--reuse` re-scores from it in 80 s), then the engine Monte Carlo runs as used here:
`python3 tools/oppadj.py --engine-eval --engine-sims-test 600 --engine-sims-tune 250` (all families, both
periods; about 15 minutes on an idle machine) and `python3 tools/oppadj.py --engine-eval --engine-gated
--engine-periods test --engine-sims-test 300` (recommended set, 2024-25, plus Volkanovski vs Gaethje).
Each engine run copies `src/engine3.js`, `src/params3.js` and `src/ml/mlrates.js` to its scratch directory
first and records their hashes, so edits to `src/` during a run cannot mix versions.

## Verdict

1. **Opponent adjustment makes the engine's per-fight rates better on unseen fights.** On 2024-2025
   validation fights (856 fights, 1,712 fight-sides; every parameter chosen on 2019-2023), the adjusted rates
   reduce held-out per-fight deviance against the engine's own raw shrunk rates for 9 of 12 stat families,
   with 95% fight-cluster bootstrap intervals that exclude zero for 8: takedown attempts -11.5%, control time
   -7.9%, control per takedown -6.7%, distance strike attempts -5.4%, takedown success -3.9%, leg accuracy
   -3.4%, head accuracy -3.3%, ground strike attempts -2.9% (clinch attempts -1.0%, n.s.).
2. **The gain is real opponent adjustment, not only re-tuning.** Against the same model with opponents held
   at average ("no-opp"), the two-way fit wins on distance attempts (-9.4%), control (-4.8%), head accuracy
   (-3.7%), ground attempts (-2.8%) and takedown attempts (-2.7%), all CIs excluding zero. Against the engine's
   own formula with the half-life and both prior strengths re-tuned ("raw re-tuned"), it still wins on
   distance attempts (-2.5%), control (-4.7%) and takedown attempts (-3.2%). [Verified with like-for-like
   baselines that get the same half-life-averaging option: distance -2.5% [0.2, 4.9], control -4.7% [1.8, 7.5],
   takedown attempts -3.1% [0.4, 5.8] (dyadic-robust 95%). For distance attempts the opponent part exists only
   with the half-life average: one adjusted configuration vs one raw configuration is -0.2%, n.s.]
3. **Re-tuned prior strengths, more than the opponent adjustment, fix the engine's combination scale.**
   [Corrected by the verification pass.] With the engine's raw rates the log5 / log-linear combination (exponents
   1, 1) is mis-scaled: a free fit on 2019-2023 wants offense exponents of 1.23 (distance attempts), 0.71 (head
   accuracy), 1.61 (takedown attempts), 1.32 (control), 0.39 (takedown success), 0.49 (control per takedown).
   With adjusted effects the same fit returns 0.99, 0.99, 1.01, 0.89, 0.77 and 0.93, but the raw rates with
   re-tuned half-life and k (no opponent adjustment) also return 0.91, 0.93, 0.92, 0.93, 1.13 and 0.88. The fit
   is circular on 2019-2023 (k was tuned on the same sides at exponents 1). On 2024-25 the adjusted offense
   exponents are 0.72-1.06 and the defense exponents 0.72-1.22 (takedown attempts allowed 0.72, distance
   attempts allowed 1.22). Exponent 1 is roughly right once the prior strengths are re-tuned, with or without
   opponents; it is not exact.
4. **Composite per-fight lines improve** (2024-25, conditional on each fight's time in each position):
   significant strikes attempted -5.1% deviance [-6.9, -3.3] (MAE 25.72 -> 25.01 per side), landed -3.4%
   [-5.1, -1.8], head landed -2.6% [-4.2, -1.1], takedowns landed -9.4% [-12.8, -6.2]. Knockdowns do not
   improve (+0.7%, n.s.).
5. **It still adds information on top of the ML stat-line model** (`tools/mlrates.py`, the v4 rate core):
   stacking the adjustment onto the ML rates (coefficient fit on 2019-2023 out-of-fold rates) cuts 2024-25
   deviance for distance attempts -2.5% [-3.7, -1.4], control -2.9% [-5.2, -0.5], leg accuracy -0.6%,
   takedown success -0.3%; head accuracy, takedown and clinch attempts are positive but n.s.
6. **Where it does not help, switch it off:** knockdown power / chin (+0.7% deviance, held-out slope about 0),
   body accuracy (+1.1%) and submission attempts (+0.3%). Recommended set below.
7. **In the simulator the effect is small and not significant anywhere.** [Corrected by the verification pass.]
   Engine v3 Monte Carlo, same seeds. Plain engine: winner log loss falls by about 0.003 with the factors in
   both periods (2019-2023 -0.0034, 2024-25 -0.0032 with all families, -0.0028 with the recommended set: 0.6441 ->
   0.6413; pooled 2019-2025 -0.0033 [-0.0079, +0.0015]). On top of the ML rates the gain is 0.0000 on 2019-2023
   and -0.0020 / -0.0026 on 2024-25 (0.6303 -> 0.6278, accuracy 66.9% -> 67.6%); pooled -0.0006. None of these
   is significant. Of the 22 reported intervals that measure the factors (adj - plain and ML x f - ML; winner,
   7-bin and finish; by period, pooled and for the recommended set), two exclude zero, both 7-bin and both on
   data that include 2019-2023 (pooled all-family -0.0090 [-0.0169, -0.0009]; ML x f - ML on 2019-2023 -0.0073
   [-0.0140, -0.0002]), about what chance gives, and neither survives a Holm correction; with the recommended
   set the 7-bin is flat (plain) or worse (ML, +0.0053, n.s.) on 2024-25. The recommended set's 2024-25 engine numbers are not fully
   held out: three on/off switches used 2024-25 (see the Verification log). Volkanovski vs Gaethje: 61.5% ->
   65.3% Volkanovski in the plain engine with factors computed at the bout division (65.1% before the
   verification fix), mostly through the grappling exchange.

## Data and protocol

- Source: `data/raw/*.csv` (ufcstats snapshot through Oct 31, 2026), parsed with `tools/build_db.py`
  (`parse_fights`, `build_people`, `build_vectors`, same 60-key round-stat vectors as `fighters.json` and the
  backtest). 17,414 directed fight-sides (8,707 UFC fights with round stats since Jan 1, 2001; ufcstats has
  no control time before that), 2,586 people.
- Every backtest entry is a prediction date (333 distinct dates, 3,237 fights, all with stats, zero slug
  mismatches). Each fit uses only rows dated strictly before that date. The factors are relative to the
  engine's raw rates computed from the backtest's own frozen S sums, so they are pre-fight quantities.
- Baselines per row: the walk-forward division priors of the 5 years before Jan 1 of that fight's year
  (`backtest.priors_asof` for 2019+, `build_db.build_priors` with the same window before), transformed by a
  Python copy of `engine3.js league()`; catch and open weight use the backtest's `prior_division` or the
  heavier recent home division. The roster fit uses `priors.json` (live).
- Hidden-data protocol (docs/BACKLOG.md): tune = 2019-01-01..2023-12-31 (every half-life, prior strength,
  half-life averaging choice, blend weight and level calibration); validation = 2024-01-01..2025-12-31,
  used only to report and for the family on/off selection; the 2026 vault is never scored or simulated.
  Factors for the 2026 snapshots are written (they are pre-fight outputs the audit needs).
- Engine reference: `src/engine3.js fighterRates()` with `src/params3.js`, read at run time (4.0.0-dev for
  the grid, 4.0.0-selfcal-pre2024 for the final re-score; kPM 40, kAcc 150, kTdPM 45, kTdAcc 12, kKD 230,
  kCtrlTD 4, kTgt 80, ctrlGroundShare 0.84 and the position mixes are identical in both, and the factors'
  hash `meta.factors_sha16` did not change). Python replicas of `league()`, `distMix()`, `expAcc()` and `fighterRates()` are vectorized in the tool.
- Scoring: Poisson deviance for counts, binomial deviance for probabilities, summed over held-out sides, each
  prediction multiplied by one level constant fit on 2019-2023 (so every model is judged on the same footing
  and nothing is fit on validation). Uncertainty: 2,000 fight-cluster bootstrap resamples of the per-fight
  deviance difference. Rows with tiny exposure are not scored (for example under 0.5 distance minutes).

## Model

For each stat family, a two-way (offense x defense) model is fit on every earlier fight-side, at every
prediction date T, with exponential time decay.

**Counts** (attempts by position, takedown attempts, control, submission attempts, knockdowns, control per
takedown). Row i: fighter X attacking Y in one past fight, with y_i events, exposure E_i and league baseline
L_i (the engine's league quantity for that row's division-year):

    y_i ~ Poisson( E_i * L_i * exp(c + o_X + d_Y) ),      weight w_i = 0.5 ^ ((T - t_i) / h)

o_X is what X does (offense), d_Y what Y allows (defense; > 0 = leaky). Exposures are the engine's: distance
minutes max(0.25 min, min - (ctrl + octrl)/60) for distance attempts, fight minutes for clinch attempts and
control, top minutes ctrl/60 x 0.84 for ground strikes, standing minutes max(0.3 min, min - (ctrl+octrl)/60
x 0.84) for takedown attempts, ground minutes for submissions, landed head strikes for knockdowns, takedowns
landed for control per takedown.

Each effect has a conjugate pseudo-data prior: k exposure units at the league rate of that fighter's own
exposure-weighted baseline L_X (Poisson-gamma), so the posterior mode is

    o_X = log[ (sum_i w y_i + k_o L_X e^c) / (sum_i w E_i L_i e^(c + d_Y(i)) + k_o L_X e^c) ]
    d_Y = log[ (sum_i w y_i + k_d L_Y e^c) / (sum_i w E_i L_i e^(c + o_X(i)) + k_d L_Y e^c) ]

With every d at zero and a single division this is exactly the engine's `shr(events, exposure, prior, k)`.
With both free, it is the engine's shrinkage with every past opponent's exposure re-weighted by how leaky
or tight that opponent was: iterative proportional fitting (block-coordinate MAP) until no effect moves
more than 5e-5, plus an exact one-dimensional move along the o + delta / d - delta ridge that only the priors
pin down. One global level per date, c = log(sum w y / sum w E L). Fits warm-start from the previous date.

**Probabilities** (head, body and leg accuracy; takedown success):

    logit P(landed_i) = b_i + c + a_X + g_Y

b_i is the logit of the engine's expected accuracy for that row's own position mix (`expAcc` with the
row's distance / clinch / ground attempts and the shrunk distance target mix), or the league takedown
success. Priors: k pseudo-attempts at the fighter's own baseline probability; clipped Newton steps
alternating offense and defense to the same tolerance.

**Prediction** for side X against Y at date T: counts mu = E L exp(c + o_X + d_Y) x s, probabilities
z = b + c + a_X + g_Y + delta, with s / delta the 2019-2023 level calibration. Optional half-life averaging
(geometric mean over the five half-lives, each at its own best k) is used where it beat the single best
configuration on 2019-2023 (distance attempts, head and leg accuracy). Final prediction: a blend on the log
(logit) scale, lambda x adjusted + (1 - lambda) x engine raw, lambda in {0, 0.1, ..., 1} chosen on 2019-2023.

**Search** (all on 2019-2023): 840 walk-forward fits for every family x half-life {365, 730, 1095, 1460,
2190} x k on a 7-point grid with k_off = k_def, for both the two-way model and the no-opp ablation; a local
search over separate k_off, k_def at each family's best half-life; then every half-life at the chosen k
ratio. The engine-form raw rates were re-tuned the same way (half-life, separate offense and defense k) as
the strongest baseline that has no opponent adjustment.

## Results by stat family (held-out 2024-2025)

Deviance on 2024-25 sides (lower is better). "final vs engine" and "opp-adj vs no-opp" are deviance changes
(negative = better) with 95% bootstrap intervals, in percent of the baseline's deviance. The slope is the coefficient on
log(final / engine raw) when the held-out outcomes are regressed on it with the engine raw prediction as
offset (1 = the adjustment is right-sized on unseen fights, 0 = no information; quasi-likelihood SE).

| family | engine fields | half-life (days) | k off / def | lambda | engine raw | raw re-tuned | opp-adj | final | final vs engine | opp-adj vs no-opp | slope (se) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| distance attempts | dAtt, dAttAg | avg of 5 | 12 / 25 dist. min | 0.7 | 16116 | 15501 | 15111 | 15240 | **-5.4%** [-7.2, -3.5] | -9.4% [-11.3, -7.4] | 1.60 (0.14) |
| clinch attempts | cAtt, cAttAg | 2190 | 40 / 40 fight min | 0.8 | 9873 | 9843 | 9791 | 9775 | -1.0% [-2.4, +0.3] | -0.3% [-1.6, +1.0] | 0.83 (0.24) |
| ground attempts | gAtt, gAttAg | 2190 | 12 / 12 top min | 0.9 | 14645 | 14395 | 14209 | 14218 | **-2.9%** [-5.2, -0.6] | -2.8% [-4.2, -1.4] | 1.39 (0.28) |
| head accuracy | accSh[0], accAgSh[0] | avg of 5 | 300 / 300 att. | 1.0 | 5094 | 5016 | 4928 | 4928 | **-3.3%** [-5.9, -0.8] | -3.7% [-5.7, -1.7] | 1.13 (0.13) |
| body accuracy | accSh[1], accAgSh[1] | 2190 | 80 / 150 att. | 0.7 | 2964 | 2942 | 3027 | 2997 | +1.1% [+0.1, +2.1] | -0.4% [-1.1, +0.3] | 0.94 (0.26) |
| leg accuracy | accSh[2], accAgSh[2] | avg of 5 | 80 / 40 att. | 0.9 | 2819 | 2739 | 2718 | 2722 | **-3.4%** [-5.0, -1.9] | -0.8% [-1.6, -0.0] | 1.04 (0.17) |
| knockdowns / head landed | pow, chin | 1460 | 230 / 460 head landed | 0.7 | 1259 | 1266 | 1275 | 1268 | +0.7% [+0.1, +1.4] | +0.1% [-0.2, +0.5] | -0.57 (0.71) |
| takedown attempts | tdAtt, tdAttAg | 1095 | 8 / 16 stand. min | 1.0 | 6038 | 5519 | 5341 | 5341 | **-11.5%** [-15.0, -8.3] | -2.7% [-5.2, -0.2] | 1.03 (0.08) |
| takedown success | tdAcc, tdAccAg | 2190 | 48 / 24 TD att. | 1.0 | 2026 | 1954 | 1947 | 1947 | **-3.9%** [-5.9, -2.0] | -0.4% [-1.1, +0.3] | 1.29 (0.17) |
| control time | ctrl, octrl | 1460 | 10 / 20 fight min | 0.9 | 211961 | 205427 | 195872 | 195216 | **-7.9%** [-11.5, -4.4] | -4.8% [-7.6, -2.1] | 0.95 (0.08) |
| control per takedown | topSkill, escWeak | 2190 | 16 / 16 TDs landed | 0.9 | 78508 | 73455 | 73151 | 73246 | **-6.7%** [-10.4, -3.2] | -0.5% [-1.3, +0.2] | 1.17 (0.17) |
| submission attempts | sub, subAg | 2190 | 22 / 45 ground min | 1.0 | 1324 | 1311 | 1327 | 1327 | +0.3% [-1.8, +2.4] | +0.1% [-0.6, +0.8] | 0.46 (0.23) |

Averaged half-lives: distance attempts 365:6/6, 730:12/12, 1095:12/25, 1460:12/25, 2190:12/25; head accuracy
365-1095 at 150/150 and 1460-2190 at 300/300; leg accuracy 365:40/40 and 730-2190 at 80/40.

Reading the table:

- The column "raw re-tuned" isolates what a different half-life and prior strength alone buy inside the
  engine's own formula; "opp-adj" minus that is the opponent adjustment itself. Takedown attempts are the
  clearest case: re-tuning alone takes 8.6%, the two-way fit another 3.2%.
- Calibration by quintile of the predicted change (2024-25): for takedown attempts the fifth of sides whose
  factors cut the rate most (median x0.56) landed at 0.50 of the engine's raw prediction and 0.92 of the
  adjusted one; the fifth raised most (x1.52) landed at 1.55 and 0.97. Control: 0.68 / 1.11 and 1.38 / 0.94.
  Head accuracy: 40.8% observed vs 43.8% engine vs 41.7% adjusted in the most-cut fifth; 36.3% vs 34.5% vs
  37.3% in the most-raised fifth. Takedown success: 38.0% vs 45.4% vs 39.3%, and 37.3% vs 26.7% vs 33.2%.
- Slopes above 1 (distance attempts 1.60, ground attempts 1.39, takedown success 1.29, control per takedown
  1.17) say the 2019-2023 choices were, if anything, too timid for 2024-25 (lambda below 1 and strong priors).
  They are reported, not used: nothing is fit on validation.
- Knockdown power and chin: no family member helps. The opponent-adjusted KD rates are no better than the raw
  ones (slope -0.57 +/- 0.71): one knockdown per ~100 head strikes is too rare for schedule effects to show.
  Leave chin and power to the durability model (`research/model_durability.md`).
- Body accuracy: the two-way model is worse than the raw rates even before opponents (its no-opp version is
  worse too); something in the body-accuracy baseline does not transfer. Off.
- Gains are similar by experience: for distance attempts 5.1% (1-3 prior UFC fights), 7.8% (4-8), 3.8% (9+);
  takedown attempts 8.5% / 13.3% / 12.7%; control 7.3% / 4.6% / 11.2%; and in both years.

### Half-life scan

Best k at each half-life, two-way model, tune / test deviance (the engine's sums use 730 days; bold = best
single half-life on tune; distance attempts, head and leg accuracy use the average over all five):

| family | 365 | 730 | 1095 | 1460 | 2190 | 3650 (diagnostic, chosen k) |
|---|---|---|---|---|---|---|
| distance attempts | 39629 / 14930 | 38793 / 15084 | 38682 / 15431 | 38602 / 15435 | **38594** / 15474 | 38652 / 15533 |
| clinch attempts | 26945 / 9968 | 26531 / 9860 | 26421 / 9775 | 26337 / 9772 | **26279** / 9791 | 26261 / 9823 |
| ground attempts | 29938 / 14556 | 29586 / 14335 | 29428 / 14344 | 29367 / 14273 | **29344** / 14209 | 29367 / 14173 |
| head accuracy | 13313 / 5038 | 13072 / 4938 | 13060 / 4921 | 13032 / 4963 | **13028** / 4954 | 13051 / 4955 |
| leg accuracy | 5538 / 2699 | **5529** / 2717 | 5533 / 2733 | 5541 / 2743 | 5554 / 2755 | 5570 / 2767 |
| knockdowns | 3308 / 1275 | 3291 / 1277 | 3286 / 1275 | **3285** / 1275 | 3285 / 1275 | 3288 / 1276 |
| takedown attempts | 12289 / 5542 | 11842 / 5346 | **11785** / 5341 | 11790 / 5362 | 11824 / 5401 | 11875 / 5449 |
| takedown success | 4302 / 2004 | 4262 / 1966 | 4247 / 1956 | 4243 / 1951 | **4241** / 1947 | 4245 / 1944 |
| control time | 470545 / 200226 | 454450 / 194942 | 450797 / 194929 | **450136** / 195872 | 450609 / 197616 | 451985 / 199643 |
| control per takedown | 172424 / 74329 | 170819 / 73693 | 170439 / 73354 | 170021 / 73206 | **169729** / 73151 | 169659 / 73216 |
| submission attempts | 3351 / 1344 | 3307 / 1326 | 3289 / 1323 | 3284 / 1324 | **3282** / 1327 | 3279 / 1329 |

Skill estimates want a much longer memory than the engine's 730-day sums: 2190 days (or the five-way average)
for strike volume, head accuracy, takedown success, control per takedown and submissions; 1460 for control and knockdowns; 1095 for
takedown attempts; only leg accuracy prefers 730. Seven families sit at the end of the task grid, but the
3650-day diagnostic is worse or flat on tune for all of them (clinch attempts, control per takedown and
submissions are flat within 0.1%), so the edge of the grid is not hiding a gain. The best half-life on
validation is often shorter (730 for distance attempts, 1095 for control); the averaged half-lives for
distance attempts partly hedge that. Prior strengths (k, in the family's exposure units; engine-unit
equivalents in `results.families.*.chosen`): distance attempts 12 / 25 distance minutes (engine kPM 19 / 40
after its x L.dist), ground attempts 12 / 12 top minutes (kPM-equivalent 76), takedown attempts 8 / 16
standing minutes (kTdPM-equivalent 12 / 23 vs the engine's 45), takedown success 48 / 24 attempts (engine
kTdAcc 12), control 10 / 20 fight minutes (engine kPM 40), control per takedown 16 / 16 takedowns (engine
kCtrlTD 4), head accuracy 300 / 300 attempts (engine kAcc 150).

### Composite per-fight lines

Each side's predicted totals in the fight given its actual minutes in each position (attempt rates x target
mix x accuracy; KD = landed head x KD rate; TD landed = attempts x success), one level constant per line fit on
2019-2023; 1,712 held-out sides:

| line | engine raw | raw re-tuned | final | final vs engine | final vs raw re-tuned | MAE engine / re-tuned / final |
|---|---|---|---|---|---|---|
| sig. strikes attempted | 19240 | 18637 | 18261 | **-5.1%** [-6.9, -3.3] | -2.0% [-3.5, -0.4] | 25.72 / 25.19 / 25.01 |
| sig. strikes landed | 14427 | 14131 | 13934 | **-3.4%** [-5.1, -1.8] | -1.4% [-2.8, +0.1] | 15.45 / 15.27 / 15.24 |
| head strikes landed | 15110 | 14982 | 14713 | **-2.6%** [-4.2, -1.1] | -1.8% [-3.1, -0.6] | 12.61 / 12.58 / 12.50 |
| knockdowns | 1410 | 1420 | 1420 | +0.7% [-0.1, +1.4] | 0.0% | 0.334 / 0.335 / 0.335 |
| takedowns landed | 3620 | 3347 | 3281 | **-9.4%** [-12.8, -6.2] | -2.0% [-4.4, +0.5] | 1.17 / 1.12 / 1.14 |

Attempted-strike MAE falls 0.71 per side [0.39, 1.03].

### Winner proxy (pre-fight only)

A symmetric no-intercept logistic model on the A-minus-B differences of four pre-fight expectations
(landed per minute, KD per 15, takedowns landed per 15, control share), fit on 2019-2023 mirrored rows,
scored on 854 decisive 2024-25 fights: engine raw rates 0.6609, adjusted 0.6560 (-0.0048 [-0.0106, +0.0008]);
with Elo added 0.6554 vs 0.6523 (-0.0031 [-0.0082, +0.0020]); walk-forward Elo alone 0.6783. Accuracy 61.8%
-> 62.8%. The raw re-tuned rates are worse than the engine's here (0.6667): re-tuning the priors for
per-stat deviance alone does not help the winner, the opponent adjustment does.

### On top of the ML stat-line model

Baseline: the ML rate of `tools/mlrates.py` (time-ordered out-of-fold rates for 2019-2023, the dev model
trained 2010-2023 for 2024-25; `data/derived/mlrates_oof.json`) x exposure, one level term fit on 2019-2023.
Challenger: the same plus beta x log(F_off,X x F_def,Y) (logit for probabilities), beta fit on 2019-2023.

| family | beta (2019-23 fit) | beta (2024-25, diagnostic) | test deviance ML | ML + oppadj | change |
|---|---|---|---|---|---|
| distance attempts | 0.93 | 1.70 | 36594 | 35667 | **-2.53%** [-3.70, -1.40] |
| clinch attempts | 0.99 | 0.73 | 9697 | 9626 | -0.73% [-2.10, +0.65] |
| ground attempts | 0.17 | 0.57 | 18557 | 18527 | -0.17% [-0.52, +0.21] |
| takedown attempts | 0.37 | 0.32 | 4264 | 4209 | -1.29% [-2.81, +0.30] |
| control time | 0.62 | 0.59 | 195884 | 190303 | **-2.85%** [-5.22, -0.50] |
| head accuracy | 0.55 | 0.78 | 7032 | 6964 | -0.97% [-2.08, +0.13] |
| body accuracy | 0.56 | 0.60 | 3106 | 3126 | +0.65% [+0.07, +1.23] |
| leg accuracy | 0.26 | 0.32 | 2694 | 2679 | **-0.55%** [-0.97, -0.14] |
| takedown success | 0.12 | 0.51 | 1905 | 1899 | **-0.29%** [-0.55, -0.05] |
| knockdowns | 0.26 | -1.07 | 1246 | 1249 | +0.20% [+0.03, +0.39] |
| submission attempts | 0.36 | -0.12 | 1426 | 1434 | +0.59% [-0.11, +1.30] |

(ML counts use fight minutes as exposure, so these deviances are larger than in the family table.) The ML
model already learns some schedule information from opponents' raw allowed rates, which is why the betas are
below 1 except for strike volume, but the adjusted effects still carry information it misses.

## Engine-level check (Monte Carlo, engine v3)

`tools/oppadj_engine.js` simulates every 2019-2025 backtest fight in both corner orders with the same seeds
in four configurations: plain engine rates; plain rates x factors; the ML stat-line rates through
`src/ml/mlrates.js applyToMatchup` (the v4 core; out-of-fold rates for 2019-2023, dev model for 2024-25); ML
targets x (F_off,X F_def,Y)^beta. 250 simulations per orientation for 2019-2023, 600 for 2024-25. Winner log
loss on decisive fights (lower is better), deltas with 95% bootstrap intervals; 7-bin = A KO / SUB / DEC,
draw, B DEC / SUB / KO.

Recommended set (knockdowns, body accuracy and submissions off; ML betas from the recommendation table;
`results.engine_backtest_recommended`; frozen engine copy, params 4.0.0-selfcal-pre2024; 2024-25, 300
simulations per orientation; 854 decisive fights):

| configuration | winner log loss | Brier | accuracy | 7-bin log loss | finish log loss |
|---|---|---|---|---|---|
| plain engine | 0.6441 | 0.2261 | 64.1% | 1.5823 | 0.6622 |
| plain x factors | 0.6413 | 0.2248 | 65.1% | 1.5824 | 0.6656 |
| ML rates | 0.6303 | 0.2197 | 66.9% | 1.5613 | 0.6598 |
| ML x factors^beta | **0.6278** | **0.2184** | **67.6%** | 1.5666 | 0.6612 |
| walk-forward Elo | 0.6769 | | | | |

Deltas: factors - plain -0.0028 [-0.0114, +0.0058]; ML x f - ML -0.0026 [-0.0074, +0.0022]; ML x f - plain
-0.0163 [-0.0248, -0.0078]. 7-bin: factors - plain +0.0000 [-0.0139, +0.0144], ML x f - ML +0.0053 [-0.0047,
+0.0153].

First run (every family, ML betas clipped to [0, 1] with no on/off selection; `results.engine_backtest`; other
work edited the engine's judging and calibration scales between its two periods, so only the paired deltas
within a period are meaningful):

| period | plain | x factors | ML | ML x factors^beta | factors - plain | ML x f - ML | 7-bin: factors - plain | 7-bin: ML x f - ML |
|---|---|---|---|---|---|---|---|---|
| 2019-2023 (1,955) | 0.6724 | 0.6691 | 0.6655 | 0.6655 | -0.0034 [-0.0091, +0.0024] | -0.0000 [-0.0033, +0.0033] | -0.0095 [-0.0195, +0.0002] | -0.0073 [-0.0140, -0.0002] |
| 2024-2025 (854) | 0.6439 | 0.6407 | 0.6296 | 0.6276 | -0.0032 [-0.0110, +0.0047] | -0.0020 [-0.0058, +0.0017] | -0.0080 [-0.0225, +0.0051] | +0.0045 [-0.0027, +0.0121] |

Pooled 2019-2025 paired deltas of that run (2,809 decisive fights; `pooled_2019_2025_paired`): factors - plain
winner -0.0033 [-0.0079, +0.0015], 7-bin **-0.0090 [-0.0169, -0.0009]**; ML x f - ML winner -0.0006 [-0.0032,
+0.0020], 7-bin -0.0037 [-0.0091, +0.0017]. (2019-2023 is out of sample for winners and methods, which never
entered the tuning, but it is the period the factor hyperparameters were chosen on for per-fight stats.)
Walk-forward Elo: 0.6857 and 0.6769.

Reading: the factors make the simulator more decisive (mean |logit P(A)| 0.36 -> 0.42) and it pays: winner log
loss improves by 0.003 in every period, with and without the ML layer, and accuracy by about one point, but no
single winner delta is significant. The method / outcome distribution improves with all families on (pooled
7-bin -0.009, significant) and is flat with the recommended set on 2024-25, which suggests the knockdown
factors help the method mix even though they do not help per-fight knockdown counts; worth an ablation in the
v5 merge. The per-fight stat gains are large and clear; how far they move the winner depends on the rest of
the engine, and the ML layer already carries part of the schedule information.

## Factor sizes

Spread over 2024-25 sides (the factor multiplies the engine's raw rate; 5th / 50th / 95th percentile):
takedown attempts 0.48 / 0.98 / 1.55 (sd of log 0.36), control 0.59 / 1.04 / 1.47 (0.28), control allowed
0.67 / 0.97 / 1.25, takedown success odds 0.78 / 1.01 / 1.33, ground attempts 0.82 / 0.98 / 1.20, clinch
attempts 0.87 / 1.00 / 1.16, control per takedown 0.84 / 1.00 / 1.17, head accuracy odds 0.94 / 1.02 / 1.11,
head accuracy allowed 0.91 / 1.01 / 1.09, distance attempts 0.93 / 1.00 / 1.07. Strike volume and accuracy
move a few percent; grappling volume and control move a lot, because the engine's raw grappling rates are
the most schedule-dependent (a wrestler's takedown rate depends heavily on whom he has met).

Each factor bundles three things, all validated together: the opponent adjustment, the longer half-life and
re-tuned prior strength, and era-normalized division baselines. The table's "raw re-tuned" and "no-opp"
columns split them. `roster[slug].sched` isolates the schedule: the exposure-weighted average of what his
opponents allowed relative to the league (> 1 = soft schedule, raw numbers inflated).

Examples from the roster (438 fighters active since Jan 1, 2025 with 6+ UFC fights): the largest control
factors go to Khamzat Chimaev 2.17, Erin Blanchfield 2.02, Merab Dvalishvili 1.93, Grant Dawson 1.77 and Umar
Nurmagomedov 1.70; their opponents allowed only 0.51-0.69 of league control (sched.ctrl), and the engine's
kPM 40 fight-minute prior also pulls their raw rate hard toward the league. The smallest takedown-attempt
factors go to strikers who almost never shoot (Khalil Rountree Jr. 0.22, Shara Magomedov 0.31, CJ Vergara 0.32):
mostly the weaker prior (8 standing minutes instead of the engine's 31, kTdPM 45 x L.stand 0.68), since their schedules were,
if anything, soft for takedowns (sched 1.26-1.32). Chimaev also has the toughest takedown schedule on the roster
(opponents allowed 0.56 of league attempts) and the largest attempt factor (2.09).

## Volkanovski and Gaethje

Roster factors at the Oct 31, 2026 snapshot (relative to the engine's raw rates from `fighters.json`):

| factor | Volkanovski | Gaethje | reading (allowed < 1 = better defense than raw) |
|---|---|---|---|
| distance attempts / allowed | 1.01 / 1.01 | 0.98 / 0.99 | volume about as raw |
| clinch attempts / allowed | 1.44 / 1.04 | 1.16 / 1.00 | the longer memory credits both men's clinch work, Volk's most |
| head accuracy odds / allowed | 0.945 / 0.942 | 0.985 / 0.925 | both land a bit less and get hit a bit less than raw |
| body accuracy odds / allowed | 1.02 / 0.974 | 1.12 / 0.998 | off in the recommended set |
| leg accuracy odds / allowed | 0.866 / 0.851 | 1.02 / 1.04 | Volk's leg kicks discounted, but leg kicks land less on him too |
| takedown attempts / allowed | 1.12 / 1.03 | 0.649 / 1.13 | Gaethje shoots even less than raw, opponents shoot on him more |
| takedown success odds / allowed | 1.21 / 0.823 | 1.19 / 1.02 | both finish shots better than raw; Volk's takedown defense tighter |
| control / control allowed | 1.33 / 0.678 | 0.821 / 0.711 | Volk controls more than raw; both concede less control than raw |
| control per takedown / per takedown absorbed | 1.04 / 1.23 | 0.954 / 1.01 | once down, Volk is held a little longer than raw says |
| power / chin | 1.18 / 0.967 | 1.09 / 0.952 | off in the recommended set (no validated gain) |
| schedule: opponents' TD success allowed (odds) | 0.855 | 0.659 | both met stingy takedown defenders, Gaethje especially |
| schedule: opponents' control allowed | 0.742 | 0.881 | Volk's opponents were hard to hold down |
| schedule: opponents' KD per head landed allowed | 0.765 | 0.921 | Volk hit tough chins |

Engine v3 (params 4.0.0-selfcal-pre2024, no ML layer, `fighters.json` profiles, 5 x 5 lightweight title
fight, 10,000 simulations per corner order, same seeds), plain rates vs the recommended factor set
(`results.engine_backtest_recommended.volk_gaethje`):

| | plain | with factors |
|---|---|---|
| Volkanovski wins | 61.5% | 65.1% |
| Volk KO / SUB / DEC | 14.6 / 4.2 / 42.7% | 14.7 / 2.6 / 47.8% |
| Gaethje KO / SUB / DEC | 16.4 / 1.9 / 19.8% | 16.0 / 0.9 / 17.8% |
| sig. strikes landed, Volk / Gaethje | 122.8 / 80.2 | 130.4 / 81.6 |
| takedowns landed, Volk / Gaethje | 1.07 / 0.99 | 1.64 / 0.69 |
| control seconds, Volk / Gaethje | 109 / 95 | 106 / 53 |

The adjustment mostly changes the grappling exchange: Volkanovski's takedown success and control are
credited for a tough schedule, Gaethje's control and takedown volume are cut. It moves the engine further from
the market openers (about 37% Volkanovski, docs/BACKLOG.md); the stacked blend, not the simulator, sets the
winner probability on the page, so this is a "how" change more than a "who" change.

## Recommendation for the engine

**1. Apply the factors** at the end of `fighterRates(prof, P, L, p, nR)` when the profile carries them
(`prof.oppadj`, from `roster[slug]` for live profiles and `snapshots[id][A|B]` for backtest profiles):

    R.f       <- R.f * F.f        for f in dAtt dAttAg cAtt cAttAg gAtt gAttAg tdAtt tdAttAg ctrl octrl topSkill escWeak
    R.tdAcc   <- clip(sigm(logit(R.tdAcc)   + ln F.tdAcc),   0.03, 0.95)
    R.tdAccAg <- clip(sigm(logit(R.tdAccAg) + ln F.tdAccAg), 0.03, 0.95)
    R.accSh[t]   <- R.accSh[t]   + ln F.acc[t]        t = 0 (head), 2 (leg)
    R.accAgSh[t] <- R.accAgSh[t] + ln F.accAg[t]

Leave pow, chin, sub, subAg, acc[1] and accAg[1] at 1 (families off: knockdowns, submissions, body accuracy).
`tools/oppadj_engine.js applyOppAdj()` is the reference implementation (it also updates R.acc / R.accAg for
display). Nothing else in the engine changes: combA = combB = 1 are now the right exponents (finding 3), and
the factors carry a calibration-neutral term (sqrt of the ratio of the 2019-2023 level constants, per side)
so the engine's global scales tuned on raw rates (strikeScale, accScale, tdScale, tdOddsScale, ctrlScale) stay
valid.

**2. How the factors are computed** (what `tools/oppadj.py` writes; regenerate with every data snapshot, and
whenever params3's k values change, because the factors are relative to the engine's raw rates):

    counts:        F_off,X = ( Lbar_X * exp(c/2 + o_X) / R_X.off )^lambda * kappa
                   F_def,X = ( Lbar_X * exp(c/2 + d_X) / R_X.def )^lambda * kappa
    probabilities: F_off,X = exp( lambda * (c/2 + a_X - shift_X) + kappa' )     (odds multiplier;
                   shift = R.accSh[t] for accuracy, logit R.tdAcc - logit league for takedown success)

with (o, d, a, g, c) the walk-forward two-way fit above at the family's half-life h and prior strengths
(k_off, k_def), Lbar the engine's league field for his division, averaged over half-lives (mean of log F)
where marked, and kappa = sqrt(s_final / s_engine) (counts) or (delta_final - delta_engine) / 2
(probabilities) from the 2019-2023 level calibration. Parameter values (h days; k in exposure units; lambda):

| family | h | k_off | k_def | lambda | kappa | ML-path beta |
|---|---|---|---|---|---|---|
| distance attempts | avg 365-2190 (6/6, 12/12, 12/25, 12/25, 12/25) | | | 0.7 | 0.994 | 0.93 |
| clinch attempts | 2190 | 40 | 40 | 0.8 | 1.029 | 0.99 |
| ground attempts | 2190 | 12 | 12 | 0.9 | 0.991 | 0.17 |
| head accuracy | avg 365-2190 (150 x3, 300 x2, both sides) | | | 1.0 | -0.024 | 0.55 |
| body accuracy | 2190 | 80 | 150 | **0 (off)** | | 0 |
| leg accuracy | avg 365-2190 (40/40, then 80/40) | | | 0.9 | -0.051 | 0.26 |
| knockdowns (pow, chin) | 1460 | 230 | 460 | **0 (off)** | | 0 |
| takedown attempts | 1095 | 8 | 16 | 1.0 | 1.026 | 0.37 |
| takedown success | 2190 | 48 | 24 | 1.0 | 0.020 | 0.12 |
| control | 1460 | 10 | 20 | 0.9 | 1.028 | 0.62 |
| control per takedown | 2190 | 16 | 16 | 0.9 | 1.010 | (engine R, any path) |
| submission attempts | 2190 | 22 | 45 | **0 (off)** | | 0 |

**3. With the ML rate layer (v4 core),** whose `applyToMatchup` overrides the engine's rate fields, apply the
adjustment to the ML targets instead, per side X against Y:

    target_X <- target_X * (F_off,X * F_def,Y)^beta          (counts: d_att c_att g_att td_att ctrl)
    odds(target_X) <- odds(target_X) * (F_off,X * F_def,Y)^beta   (acc_h acc_l td_acc)
    h_att, b_att, l_att scale with the total attempt change (d_att + c_att + g_att)

with beta from the table (2019-2023 fit, clipped to [0, 1], 0 where the stack did not improve 2024-25), and
topSkill / escWeak still multiplying the engine's R (the ML-path simulations above left topSkill unadjusted, so
that combination is untested at the engine level). `tools/oppadj_engine.js adjTargets()` is the reference.

**4. If the engine keeps raw rates for any family,** its own prior strengths are far from the 2019-2023
optimum of its own formula (re-tuned half-life h, offense / defense k in engine units; 2024-25 deviance change
vs the current engine in brackets):

| family | engine now | re-tuned (h, k_off / k_def) | 2024-25 | best k at h = 730 (2024-25) |
|---|---|---|---|---|
| control per takedown | kCtrlTD 4 | 2190, 16 / 16 | -6.4% | -5.7% |
| takedown attempts | kTdPM 45 | 1095, 10 / 90 | -8.6% | -8.6% |
| control | kPM 40 | 1460, 20 / 40 | -3.1% | -2.2% |
| takedown success | kTdAcc 12 | 2190, 96 / 24 | -3.6% | -2.8% |
| distance attempts | kPM 40 | 1460, 20 / 40 | -3.8% | -3.1% |
| leg accuracy | kAcc 150 | 730, 80 / 40 | -2.8% | -2.8% |
| ground attempts | kPM 40 | 2190, 80 / 80 | -1.7% | -0.6% |
| head accuracy | kAcc 150 | 1095, 300 / 300 | -1.5% | -0.6% |
| submissions | kPM 40 | 2190, 80 / 160 | -0.9% | 80 / 80: -0.7% |
| clinch attempts | kPM 40 | 2190, 40 / 80 | -0.3% | 40 / 40: 0.0% |
| body accuracy | kAcc 150 | 2190, 150 / 150 | -0.7% | 80 / 80: -0.6% |
| knockdowns | kKD 230 | 1460, 230 / 460 | +0.5% | +0.8% |

The engine has one prior strength per parameter for offense and defense alike (kPM covers five families),
so adopting these needs separate offense / defense k per field in `fighterRates`; per-stat half-lives need
separate decayed sums in `fighters.json` and the backtest (today's S is one 730-day sum). The factors carry
all of this without either change, so this table is the fallback, not the recommendation.

## Caveats

- Uncertainty is per family; no correction for testing 12 families. The strongest results (takedown
  attempts, control, distance attempts) would survive any reasonable correction; clinch attempts would not.
- Validation is used for one thing beyond reporting: switching off the three families that lost on 2024-25
  (knockdowns, body accuracy, submissions). That is version selection, allowed by the protocol, but those
  three decisions are mildly optimistic. All hyperparameters, blends and level constants are 2019-2023 only.
- The 2019-2023 choices were conservative for 2024-25 (slopes above 1 for four families). A later recalibration
  on recent years (the BACKLOG's "every input became underconfident in 2024-25") should revisit lambda.
- UFC fights only: opponents met before the UFC are invisible, so a newcomer's factor is close to 1 and his
  opponents' factors do the work. Cross-division links make the schedule network connected enough for the
  fit to be stable, but women's divisions are effectively separate islands with their own levels.
- Body accuracy fails even without opponents (no-opp is worse than raw); its baseline or target mix in the
  row model is suspect and worth a look before trying again.
- The factors depend on params3's k values (read at run time; params3 4.0.0-dev here) and on the backtest S
  (730-day half-life); regenerate both together.
- The no-opp ablation for distance attempts is worse than the engine's raw rates, so part of the two-way gain
  there replaces structure the engine's own formula already had; the "raw re-tuned" comparison (-2.5%) is the
  conservative estimate of the opponent part.
- Engine-level runs overlapped with other work editing `src/` (judging noise, calibration scales). The first
  run's two periods ran on different engine versions (each delta is paired within one version); the
  recommended-set run used a frozen copy (hashes in `results.engine_backtest_recommended`). Absolute log losses
  differ slightly between the runs for that reason and because of the simulation counts (600 vs 300 per
  orientation on 2024-25); compare deltas, not levels.
- Factors are computed against the rates of the fighter's own division priors (roster) or the fight's prior
  division (backtest). When a fighter moves division the engine's raw rate changes with the new priors while
  the factor does not; a second-order effect.
- The knockdown family is off on per-fight evidence, but the pooled 7-bin gain with every family on and its
  absence with the recommended set hint that pow / chin factors may still help the method mix. Re-test them in
  the v5 leave-one-out ablation together with the durability model, which also rescales chin and power.
