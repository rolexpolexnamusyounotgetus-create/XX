# Method-and-round model (methodround)

Built 2026-11-06 10:40 UTC by `tools/methodround.py` from the ufcstats snapshot through 2026-10-31. Outputs: `data/derived/methodround.json` (per-fight predictions keyed by backtest fight id, held-out metrics, roster outputs keyed by slug, compact JS model), `tools/methodround_model.js` (evaluator). This is the benchmark the simulator's method-and-round distribution has to match or beat.

## Bottom line

- Held out on 1229 UFC fights from Jan 1, 2024 to 2026-10-31 (draws kept as their own cell; DQ and no-contests dropped), never used for any choice. Confidence intervals are 95% event-cluster bootstrap (2,000 draws).
- **Method (KO/TKO, submission, decision):** model S log loss 0.9441 [0.9179, 0.9689] vs 0.9886 [0.9657, 1.0111] for division base rates; difference -0.0445 [-0.0616, -0.0276]. Finish-vs-decision 0.6602 [0.6435, 0.6763] vs 0.6801 [0.6735, 0.6864].
- **Who wins how (7 bins):** 1.5643 [1.5261, 1.5985] vs 1.6979 [1.6698, 1.7254] (base rates x Elo); **who x how x when** (every round cell): 2.0775 [2.0180, 2.1330] vs 2.2279 [2.1687, 2.2837].
- **Winner** (a by-product): 0.6256 [0.6119, 0.6384] log loss, 66.6% accuracy, vs Elo 0.6798 [0.6722, 0.6874].
- **Against the betting market's own method props** (1183 held-out fights with US-book method and round props): market method LL 0.9220 [0.8925, 0.9492], model SM 0.9367 [0.9101, 0.9613], model S 0.9423 [0.9151, 0.9668]; the 40/60 blend of SM and the market 0.9200 [0.8931, 0.9449] (blend weight chosen on 2021-2023).

## Held-out results (2024+)

| Model | Method 3-class LL | Finish vs decision LL | 7-bin LL | Method x round LL | Who x how x when LL | Round given finish LL | KO vs SUB given finish LL | Method given winner LL | Winner LL | Winner accuracy |
|---|---|---|---|---|---|---|---|---|---|---|
| Division x format base rates (raw 5-yr window) | 0.9987 | 0.6781 | 1.7444 | 1.7262 | 2.4720 | 1.1849 | 0.6556 | 1.0004 | 0.6932 | 50.0% |
| Division x format base rates (shrunk to all-division, k=50) | 0.9886 | 0.6801 | 1.7111 | 1.5187 | 2.2412 | 1.0683 | 0.6309 | 0.9901 | 0.6932 | 50.0% |
| Base rates x Elo winner split | 0.9886 | 0.6801 | 1.6979 | 1.5187 | 2.2279 | 1.0683 | 0.6309 | 0.9901 | 0.6798 | 55.0% |
| **Model S** (stats only, frozen fit through 2023) | 0.9441 | 0.6602 | 1.5643 | 1.4574 | 2.0775 | 1.0488 | 0.5805 | 0.9113 | 0.6256 | 66.6% |
| Model S, yearly refit | 0.9431 | 0.6591 | 1.5623 | 1.4571 | 2.0763 | 1.0498 | 0.5807 | 0.9102 | 0.6246 | 65.9% |
| **Model SM** (stats + closing moneyline, frozen) | 0.9388 | 0.6563 | 1.5243 | 1.4521 | 2.0376 | 1.0486 | 0.5776 | 0.9115 | 0.5853 | 69.6% |
| Model SM, yearly refit | 0.9383 | 0.6560 | 1.5242 | 1.4523 | 2.0383 | 1.0497 | 0.5773 | 0.9108 | 0.5860 | 69.7% |

Lower is better for every log loss (LL). Joint = the full outcome space (A or B, KO/TKO or submission, in round r; decision winner; draw). Brier for the 3-class method: S 0.5675, base 0.5936.

**95% CIs and paired differences (event-cluster bootstrap):**

| Model | Method LL | Finish LL | 7-bin LL | Joint LL | Winner LL |
|---|---|---|---|---|---|
| Division x format base rates (shrunk to all-division, k=50) | 0.9886 [0.9657, 1.0111] | 0.6801 [0.6735, 0.6864] | 1.7111 [1.6844, 1.7384] | 2.2412 [2.1841, 2.2972] | 0.6932 [0.6932, 0.6932] |
| Base rates x Elo winner split | 0.9886 [0.9657, 1.0111] | 0.6801 [0.6735, 0.6864] | 1.6979 [1.6698, 1.7254] | 2.2279 [2.1687, 2.2837] | 0.6798 [0.6722, 0.6874] |
| **Model S** (stats only, frozen fit through 2023) | 0.9441 [0.9179, 0.9689] | 0.6602 [0.6435, 0.6763] | 1.5643 [1.5261, 1.5985] | 2.0775 [2.0180, 2.1330] | 0.6256 [0.6119, 0.6384] |
| **Model SM** (stats + closing moneyline, frozen) | 0.9388 [0.9130, 0.9632] | 0.6563 [0.6405, 0.6723] | 1.5243 [1.4839, 1.5610] | 2.0376 [1.9742, 2.0924] | 0.5853 [0.5644, 0.6053] |

| Paired difference | Method | Finish | 7-bin | Joint | Round given finish | Method given winner | Winner |
|---|---|---|---|---|---|---|---|
| S - division base rates | -0.0445 [-0.0616, -0.0276] | -0.0198 [-0.0330, -0.0069] | -0.1469 [-0.1734, -0.1226] | -0.1637 [-0.1931, -0.1362] | -0.0196 [-0.0307, -0.0083] | -0.0788 [-0.1011, -0.0574] | -0.0676 [-0.0812, -0.0548] |
| S - base rates x Elo | -0.0445 [-0.0616, -0.0276] | -0.0198 [-0.0330, -0.0069] | -0.1336 [-0.1603, -0.1094] | -0.1504 [-0.1789, -0.1230] | -0.0196 [-0.0307, -0.0083] | -0.0788 [-0.1011, -0.0574] | -0.0542 [-0.0671, -0.0423] |
| SM - S | -0.0053 [-0.0098, -0.0009] | -0.0039 [-0.0078, +0.0001] | -0.0399 [-0.0539, -0.0259] | -0.0399 [-0.0539, -0.0259] | -0.0001 [-0.0006, +0.0003] | +0.0003 [-0.0040, +0.0047] | -0.0402 [-0.0537, -0.0267] |
| S yearly refit - S frozen | -0.0011 [-0.0052, +0.0029] | -0.0012 [-0.0052, +0.0026] | -0.0020 [-0.0075, +0.0033] | -0.0012 [-0.0068, +0.0043] | +0.0010 [-0.0004, +0.0025] | -0.0010 [-0.0056, +0.0035] | -0.0010 [-0.0031, +0.0011] |
| SM - base rates x Elo | -0.0498 [-0.0662, -0.0341] | -0.0237 [-0.0366, -0.0108] | -0.1736 [-0.2035, -0.1451] | -0.1903 [-0.2217, -0.1580] | -0.0197 [-0.0308, -0.0086] | -0.0785 [-0.0992, -0.0587] | -0.0945 [-0.1149, -0.0746] |

Negative = the first model is better. The differences are on the same fights, so their CIs are much tighter than the CIs of the levels.

### Versus the market's method and round props

| Model | Method | Finish | KO vs SUB | Round given finish | Method given winner | 7-bin | Joint | Winner |
|---|---|---|---|---|---|---|---|---|
| Base rates x Elo | 0.9866 [0.9626, 1.0092] | 0.6795 [0.6726, 0.6863] | 0.6275 [0.6016, 0.6548] | 1.0720 [1.0340, 1.1075] | 0.9881 [0.9641, 1.0107] | 1.6973 [1.6686, 1.7258] | 2.2296 [2.1658, 2.2904] | 0.6804 [0.6724, 0.6881] |
| Model S | 0.9423 [0.9151, 0.9668] | 0.6591 [0.6425, 0.6754] | 0.5786 [0.5486, 0.6096] | 1.0538 [1.0169, 1.0880] | 0.9113 [0.8824, 0.9385] | 1.5631 [1.5253, 1.5976] | 2.0789 [2.0204, 2.1369] | 0.6235 [0.6104, 0.6367] |
| Model SM | 0.9367 [0.9101, 0.9613] | 0.6556 [0.6399, 0.6717] | 0.5744 [0.5448, 0.6040] | 1.0537 [1.0167, 1.0880] | 0.9115 [0.8843, 0.9376] | 1.5207 [1.4799, 1.5600] | 2.0366 [1.9738, 2.0981] | 0.5809 [0.5602, 0.6032] |
| Market props (US books, power de-vig, averaged) | 0.9220 [0.8925, 0.9492] | 0.6454 [0.6239, 0.6672] | 0.5650 [0.5316, 0.5979] | 1.0539 [1.0230, 1.0828] | 0.8838 [0.8521, 0.9127] | 1.5002 [1.4553, 1.5431] | 2.0160 [1.9566, 2.0741] | 0.5874 [0.5655, 0.6110] |
| SM + market blend (a=0.6) | 0.9200 [0.8931, 0.9449] | 0.6443 [0.6260, 0.6628] | 0.5634 [0.5320, 0.5935] | 1.0502 [1.0174, 1.0808] | 0.8835 [0.8560, 0.9091] | 1.4952 [1.4541, 1.5350] | 2.0093 [1.9492, 2.0663] | 0.5829 [0.5618, 0.6054] |
| SM refit + market blend | 0.9193 [0.8917, 0.9450] | 0.6436 [0.6257, 0.6616] | 0.5633 [0.5323, 0.5938] | 1.0509 [1.0186, 1.0812] | 0.8827 [0.8542, 0.9089] | 1.4946 [1.4529, 1.5350] | 2.0091 [1.9482, 2.0677] | 0.5832 [0.5616, 0.6060] |

| Paired difference | Method | Finish | KO vs SUB | Round given finish | Method given winner | 7-bin | Joint |
|---|---|---|---|---|---|---|---|
| SM - market | +0.0147 [+0.0001, +0.0302] | +0.0101 [-0.0013, +0.0221] | +0.0093 [-0.0094, +0.0281] | -0.0002 [-0.0133, +0.0130] | +0.0277 [+0.0078, +0.0480] | +0.0205 [-0.0019, +0.0430] | +0.0206 [-0.0019, +0.0438] |
| S - market | +0.0203 [+0.0042, +0.0362] | +0.0136 [+0.0018, +0.0257] | +0.0136 [-0.0066, +0.0340] | -0.0001 [-0.0132, +0.0132] | +0.0275 [+0.0072, +0.0482] | +0.0628 [+0.0360, +0.0924] | +0.0629 [+0.0356, +0.0920] |
| blend - market | -0.0019 [-0.0081, +0.0044] | -0.0011 [-0.0062, +0.0040] | -0.0016 [-0.0092, +0.0057] | -0.0037 [-0.0086, +0.0012] | -0.0002 [-0.0085, +0.0080] | -0.0050 [-0.0142, +0.0042] | -0.0068 [-0.0162, +0.0029] |
| blend - SM | -0.0167 [-0.0259, -0.0078] | -0.0113 [-0.0181, -0.0046] | -0.0110 [-0.0225, +0.0003] | -0.0035 [-0.0118, +0.0047] | -0.0280 [-0.0404, -0.0162] | -0.0255 [-0.0389, -0.0126] | -0.0274 [-0.0413, -0.0139] |

The market props come from `data/derived/market.json` (tools/market.py): per-book closing "wins by KO/TKO / submission / decision" prices, power-normalised and averaged over US books, spread over rounds with the books' "fight ends in round k" props. They exist from 2021 on.

## Calibration (held out, model S)

| Event | n | Mean predicted | Observed | ECE | Slope | Intercept |
|---|---|---|---|---|---|---|
| KO | 1229 | 0.336 | 0.319 | 0.028 | 1.18 | 0.03 |
| SUB | 1229 | 0.189 | 0.170 | 0.040 | 0.92 | -0.25 |
| DEC | 1229 | 0.475 | 0.511 | 0.046 | 0.96 | 0.15 |
| FINISH | 1229 | 0.525 | 0.489 | 0.044 | 0.96 | -0.15 |
| win_KO | 2458 | 0.168 | 0.160 | 0.020 | 1.25 | 0.30 |
| win_SUB | 2458 | 0.095 | 0.085 | 0.017 | 1.13 | 0.13 |
| win_DEC | 2458 | 0.234 | 0.253 | 0.028 | 1.20 | 0.33 |

Slope = logistic recalibration slope of the outcome on logit(p) (1 = calibrated, < 1 = overconfident). win_* pool both corners (two rows per fight).

**P(KO) by decile:** 0.13→0.10 (n=123); 0.19→0.15 (n=123); 0.25→0.24 (n=123); 0.29→0.24 (n=123); 0.32→0.28 (n=123); 0.35→0.33 (n=123); 0.38→0.37 (n=123); 0.42→0.46 (n=123); 0.47→0.45 (n=123); 0.57→0.59 (n=122)

**P(SUB) by decile:** 0.06→0.05 (n=123); 0.09→0.05 (n=123); 0.12→0.12 (n=123); 0.14→0.10 (n=123); 0.16→0.19 (n=123); 0.18→0.20 (n=123); 0.21→0.26 (n=123); 0.24→0.15 (n=123); 0.30→0.28 (n=123); 0.39→0.30 (n=122)

**P(DEC) by decile:** 0.25→0.33 (n=123); 0.33→0.29 (n=123); 0.38→0.39 (n=123); 0.42→0.52 (n=123); 0.45→0.48 (n=123); 0.49→0.52 (n=123); 0.53→0.64 (n=123); 0.57→0.57 (n=123); 0.62→0.61 (n=123); 0.72→0.75 (n=122)

**Finishing round, 3 rounds bouts (n=1082)**

| Round | P(KO) pred | KO obs | P(SUB) pred | SUB obs |
|---|---|---|---|---|
| 1 | 0.175 | 0.170 | 0.091 | 0.090 |
| 2 | 0.104 | 0.091 | 0.069 | 0.052 |
| 3 | 0.047 | 0.049 | 0.032 | 0.030 |
| decision | 0.482 | 0.518 |  |  |

**Finishing round, 5 rounds bouts (n=147)**

| Round | P(KO) pred | KO obs | P(SUB) pred | SUB obs |
|---|---|---|---|---|
| 1 | 0.163 | 0.116 | 0.048 | 0.034 |
| 2 | 0.114 | 0.122 | 0.044 | 0.054 |
| 3 | 0.063 | 0.075 | 0.038 | 0.034 |
| 4 | 0.035 | 0.041 | 0.026 | 0.020 |
| 5 | 0.032 | 0.034 | 0.015 | 0.014 |
| decision | 0.422 | 0.456 |  |  |

## By division and format (held out)

| Division | n | Pred KO/SUB/DEC | Obs KO/SUB/DEC | Method LL S | Method LL base | Joint LL S | Joint LL base |
|---|---|---|---|---|---|---|---|
| Bantamweight | 138 | 0.29/0.15/0.56 | 0.20/0.17/0.63 | 0.9199 | 0.9619 | 1.9653 | 2.1174 |
| Featherweight | 144 | 0.35/0.20/0.46 | 0.37/0.16/0.47 | 0.9667 | 1.0252 | 2.1110 | 2.2696 |
| Flyweight | 98 | 0.33/0.22/0.45 | 0.22/0.20/0.57 | 0.9680 | 0.9831 | 2.0836 | 2.2368 |
| Heavyweight | 80 | 0.48/0.14/0.38 | 0.41/0.11/0.47 | 0.9198 | 0.9525 | 2.1341 | 2.2296 |
| Light Heavyweight | 85 | 0.46/0.15/0.39 | 0.58/0.14/0.28 | 0.9395 | 1.0133 | 2.3947 | 2.5189 |
| Lightweight | 172 | 0.38/0.21/0.42 | 0.37/0.19/0.44 | 0.9811 | 1.0439 | 2.1959 | 2.3758 |
| Middleweight | 162 | 0.39/0.20/0.41 | 0.36/0.18/0.46 | 1.0155 | 1.0345 | 2.1487 | 2.3392 |
| Welterweight | 138 | 0.36/0.18/0.46 | 0.41/0.14/0.45 | 0.9656 | 1.0210 | 2.1384 | 2.3121 |
| Women's Bantamweight | 51 | 0.15/0.19/0.66 | 0.16/0.23/0.61 | 0.9160 | 0.9667 | 1.8489 | 2.0811 |
| Women's Flyweight | 63 | 0.16/0.19/0.65 | 0.11/0.14/0.75 | 0.7459 | 0.8177 | 1.6202 | 1.8673 |
| Women's Strawweight | 85 | 0.17/0.21/0.62 | 0.14/0.19/0.67 | 0.8781 | 0.8865 | 1.8605 | 1.9704 |

| Format | n | Method S/base | Finish S/base | Round|fin S/base | Joint S/base |
|---|---|---|---|---|---|
| 3 rounds | 1082 | 0.9492 / 0.9879 | 0.6658 / 0.6820 | 0.9795 / 0.9989 | 2.0423 / 2.1984 |
| 5 rounds | 147 | 0.9070 / 0.9935 | 0.6193 / 0.6659 | 1.5000 / 1.5203 | 2.3369 / 2.5558 |

| Year | n | Method S | Method S refit | Method SM | Method base | Joint S | Joint base |
|---|---|---|---|---|---|---|---|
| 2024 | 428 | 0.9198 | 0.9198 | 0.9202 | 0.9667 | 2.0153 | 2.1671 |
| 2025 | 429 | 0.9521 | 0.9479 | 0.9426 | 0.9875 | 2.0683 | 2.2329 |
| 2026 | 372 | 0.9629 | 0.9642 | 0.9558 | 1.0151 | 2.1598 | 2.3360 |

## How to use the outputs

- `fights[id]` (every backtest.json fight, 2019+): `S` and `SM` hold the joint as A KO r1..R, A SUB r1..R,
  B KO r1..R, B SUB r1..R, A dec, B dec, draw (R = scheduled rounds, A = first ufcstats name); `sum_S` has P(finish),
  P(KO), P(SUB), P(dec), P(A), P(B) and the 7 bins; `fit_through` says which fit produced it (2019-2023 are
  out-of-fold, 2024+ the fit through 2023; `S_refit` / `SM_refit` for 2025-2026).
- `roster[slug]`: each fighter's win/lose-by-method shares against his current division field.
- `js_model` + `tools/methodround_model.js`: `MethodRound.create(js_model).predict(profA, profB, {slugA, slugB,
  division, rounds, title, date, pMarketA})` with fighters.json profiles; returns the cells, bins7, finish-round
  distribution and method-given-win for each fighter (S without `pMarketA`, SM with it).
- Score the simulator (or any model) on the same fights and metrics: write `{fight_id: {"cells": [...]}}` (same
  layout as above) or `{fight_id: {"bins7": [...], "fin_round": [...]}}` and run
  `python3 tools/methodround.py --score sim.json` (paired event-cluster bootstrap against model S).

## Method

**Data.** Every UFC bout in the ufcstats snapshot, parsed with `tools/build_db.py`'s own loaders so
people, aliases and Elo match the pipeline. A walk-forward pass over all 6296 bouts since 2008 (both fighters with an
earlier UFC bout) snapshots each fighter before every fight: the 730-day decayed sums `S` (identical to
backtest.json, checked to 5e-4 relative), career sums `C`, the career record by method over every bout (also bouts
without round stats), finishing-time tendencies, last result, streak, layoff, age, pre-fight Elo, mean opponent
Elo and physicals. Same-day bouts never see each other. Division priors come from the five calendar years before
the fight's year (`build_db.build_priors`), the same rule as `backtest.json` `priors_asof`.

**Outcome space.** {A, B} x {KO/TKO, submission} x round 1..R, plus A by decision, B by decision and draw (R = 3 or
5 scheduled rounds). KO/TKO includes doctor and corner stoppages. Every reported target is a marginal of this joint.

**Features (133, all pre-fight).** Per side, shrunk toward the bout's division prior (pseudo-exposure: 3.0 fights for
per-fight result rates, 15.0 minutes for per-minute rates, 300.0 landed head strikes for knockdown power and chin, 150.0
attempts for accuracies, 6.0 submission attempts for conversion): KO/sub wins and losses per fight and per 15
minutes, decision share, knockdowns scored/absorbed per 15, KD per landed head strike (power) and absorbed per head
strike taken (chin), strikes landed/absorbed, accuracy and defence, takedowns landed/absorbed, takedown accuracy
and defence, control share both ways, ground strikes both ways, submission attempts both ways, submission
conversion and defence, minutes per fight; the same finishing and grappling rates from undecayed career sums;
career record rates; mean minute and round-1 share of his finishes / finished losses; age, years past 30,
experience, KO losses, knockdowns absorbed (career), KO losses x age, layoff, last-fight KO loss, streak.
Matchup terms: log5-style attacker x defender intensities (KO hazard, sub hazard, KD rate, KD power vs chin,
strike volume, takedowns, control, ground strikes, sub attempts, sub conversion), symmetric fight-length
tendencies, Elo difference and its absolute value, height/reach/age differences, open stance; fight terms:
division weight, heavyweight, women, 5 rounds, title, catch weight, year, and the division's prior KO/sub rates and
minutes per fight. SM adds the closing-line log-odds (power de-vig) and its absolute value.

**Models.**
1. *Who-and-how:* a multinomial logit over six outcomes (A KO, A SUB, A DEC, B DEC, B SUB, B KO) with an L2
   penalty on standardized coefficients (C = 0.002 for S, 0.001 for SM, per-observation scale), recency weights
   (half-life 8 years), trained on 2012+ (S) / 2013+ (SM) fights. Every fight is used in both orientations and
   predictions average the two, so the A/B corner (A wins 56%) never leaks and swapping fighters swaps the
   probabilities exactly. SM replaces the six-class model's winner share with a separate symmetric winner logit
   (C = 0.005) and keeps its method-given-winner shares.
2. *When:* a discrete-time competing-risks model: per round, a multinomial logit over {no finish, A KO, A SUB, B KO,
   B SUB} with separate unpenalized baseline hazards for each round of 3- and 5-round bouts and 37 shared
   finishing-tendency features (C = 0.03), trained on 2008+ fight-rounds in both orientations; a symmetric logit
   picks the decision winner. Its conditional round shapes (P(round r | A KO), ...) spread the six-class
   probabilities over rounds; a draw takes 1.40% of the decision mass.
3. *Market blend (live only):* when US-book method props exist, (1 - a) x SM + a x market joint, a = 0.6 chosen on
   2021-2023.

**What did not earn a place (tuning-period CV, 2020-2023 validation years):** LightGBM six-class models
(method LL about 0.008 worse than the logit; a 30% blend gained 0.001 joint LL, not worth the opacity or the
page size); a post-hoc temperature + per-method bias recalibration (no gain under leave-one-year-out); shorter
recency half-lives (3-4 years slightly worse); training from 2008 (slightly worse than 2012 for the six-class
model); a factorized winner x method-given-winner model (better winner, worse method; its winner part is reused
in SM). Feature-group ablations: grappling, submission, fight-length tendencies and division terms carry the
method signal; striking volume, age/experience and Elo carry the winner signal; recent-form and durability
groups are roughly neutral for method (kept for the winner and for the page).

**Tuning (expanding window, validation years 2020-2023):**

| Part | Setting | Method LL | Joint LL | Winner LL |
|---|---|---|---|---|
| S | C6=0.001 | 0.9664 | 2.1746 | 0.6521 |
| S | C6=0.002 | 0.9669 | 2.1733 | 0.6497 |
| S | C6=0.004 | 0.9690 | 2.1758 | 0.6489 |
| SM | C6=0.001, C_win=0.002 | 0.9631 | 2.1425 | 0.6225 |
| SM | C6=0.001, C_win=0.003 | 0.9631 | 2.1420 | 0.6220 |
| SM | C6=0.001, C_win=0.005 | 0.9632 | 2.1419 | 0.6219 |
| SM | C6=0.002, C_win=0.002 | 0.9628 | 2.1425 | 0.6225 |
| SM | C6=0.002, C_win=0.003 | 0.9629 | 2.1420 | 0.6220 |
| SM | C6=0.002, C_win=0.005 | 0.9629 | 2.1419 | 0.6219 |
| SM | C6=0.004, C_win=0.002 | 0.9641 | 2.1452 | 0.6225 |
| SM | C6=0.004, C_win=0.003 | 0.9643 | 2.1446 | 0.6220 |
| SM | C6=0.004, C_win=0.005 | 0.9644 | 2.1446 | 0.6219 |
| hazard | C_haz=0.003 | 0.9669 | 2.1734 | rgf 1.0636 |
| hazard | C_haz=0.01 | 0.9669 | 2.1733 | rgf 1.0634 |
| hazard | C_haz=0.03 | 0.9669 | 2.1732 | rgf 1.0634 |

Market blend on the 1203 2021-2023 fights with props: a=0.0 joint 2.1452 method 0.9692; a=0.1 joint 2.1365 method 0.9647; a=0.2 joint 2.1302 method 0.9612; a=0.3 joint 2.1257 method 0.9585; a=0.4 joint 2.1228 method 0.9565; a=0.5 joint 2.1214 method 0.9552; a=0.6 joint 2.1214 method 0.9546; a=0.7 joint 2.1228 method 0.9546; a=0.8 joint 2.1257 method 0.9553; a=0.9 joint 2.1302 method 0.9567; a=1.0 joint 2.1365 method 0.9588.

Walk-forward out-of-fold 2019-2023 (each year predicted by a fit through the previous Dec 31; the hyperparameters were chosen on 2020-2023, so these are tuning-period numbers, not held out; n=1972): S method 0.9569 / joint 2.1523 / winner 0.6518; base rates method 1.0014 / joint 2.2701; base x Elo winner 0.6856.

## Roster and the default matchup

- **Volkanovski vs Gaethje, 5 x 5 at 155, stats only:** Volk 60.3% (KO 26.3, sub 3.5, dec 30.5), Gaethje 39.0% (KO 21.5, sub 0.9, dec 16.7), draw 0.7%; finish 52.1% (KO/TKO 47.8%, sub 4.3%); finish by round 16.0, 14.7, 9.8, 6.1, 5.6.
- **Volkanovski vs Gaethje, 5 x 5 at 155, with the no-vig market price Volkanovski 37.2% (openers Oct 24-25, 2026, docs/BACKLOG.md):** Volk 44.7% (KO 18.8, sub 2.9, dec 22.9), Gaethje 54.6% (KO 28.6, sub 1.6, dec 24.4), draw 0.7%; finish 52.0% (KO/TKO 47.5%, sub 4.5%); finish by round 15.9, 14.6, 9.8, 6.1, 5.6.
- `roster[slug]`: 1222 fighters, P(win/lose by KO, SUB, decision), P(finish) and method-given-win, averaged over everyone in the fighter's division with a UFC fight since 2025-01-01 (3 rounds, stats-only model fit through the snapshot).
  Highest P(win by KO/TKO) vs their division field: josh-hokit 50%; damian-pinas 50%; michael-morales 49%; carlos-prates 47%; navajo-stirling 46%.
  Highest P(win by submission): jaqueline-amorim 42%; valter-walker 40%; charles-oliveira 37%; jailton-almeida 36%; yaroslav-amosov 35%.
- JS model (`js_model` in the JSON, evaluator `tools/methodround_model.js`, fit through the snapshot): verified; Python vs node on 40 random roster matchups, max abs difference 3.8e-05.

## Recommendation for the final ensemble

Evidence behind the recommendations: method given the actual winner, S - base rates -0.0788 [-0.1011, -0.0574]; SM - market on the 2024+ props subset: method +0.0147 [+0.0001, +0.0302], KO vs SUB +0.0093 [-0.0094, +0.0281], round given finish -0.0002 [-0.0133, +0.0130], method given winner +0.0277 [+0.0078, +0.0480].

1. **Use this model as the method/round prior and as the yardstick for the simulator.** The v3+ engine's
   simulated method distribution should be scored on the same held-out fights with the same metrics (method
   3-class LL, finish LL, round-given-finish LL, 7-bin and joint LL, plus the calibration tables above):
   `python3 tools/methodround.py --score sim.json`. If the engine does not beat model S on method and round, the
   page should take its method/round split from here and use the engine for the play-by-play and the story.
2. **Factorize the final forecast:** P(A wins) from the winner ensemble (market + Elo + engine + this model's
   winner), then P(method, round | winner) from this model's conditional shares (`methodGivenWin` in the JS
   output; the per-fight cells give the same). That keeps the winner question with the stack and uses this
   model for what it was built for (the evidence line above gives its method-given-winner edge).
3. **Live, with a line:** use SM, and when method props are posted, blend with them (weight a in the meta). The
   props are sharper than the model on finish vs decision and KO vs submission (they price in pre-UFC records,
   camp news and styles the stats do not see); the model matches them on the finishing round, and the blend is
   within noise of the props or better on every target.
4. **Without a line** (hypothetical matchups such as Volkanovski vs Gaethje before odds): use S.
5. Natural next inputs: pre-UFC records (tools/preufc.py; Sherdog crawl was incomplete when this ran, so it is not
   used), opponent-adjusted rates (tools/oppadj.py) and the durability model's chin/power estimates
   (data/derived/durability.json) as extra features; refit with `python3 tools/methodround.py`.

## Limitations

- Method and round are noisy targets: on the held-out props subset the market's method log loss is 0.922 against 0.987 for base rates x Elo (uniform over three classes: 1.099). Gains of 0.01-0.05 in log loss are what good looks like here.
- The stats-only variant knows nothing about weight-class moves, injuries, camp changes or pre-UFC
  records; for Volkanovski vs Gaethje it favours Volkanovski on his UFC numbers while the market makes Gaethje a
  clear favourite. Use SM (or the winner ensemble) whenever a line exists.
- Draws are a fixed share of decision outcomes; DQ and no-contests are not modelled (excluded from scoring).
- The SM variant needs the closing line; scored on 2024+ it is a live model, not a fight-week forecast.
- The market props benchmark covers fights with US-book props (2021+) and uses averaged, power-normalised
  prices; a single sharp book could be stronger.
- Roster outputs are averages over the current division field with the stats-only model; they describe
  tendencies, not any particular matchup.
