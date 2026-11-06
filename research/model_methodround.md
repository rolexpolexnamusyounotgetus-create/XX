# Method-and-round model (methodround)

Built 2026-11-06 10:30 UTC by `tools/methodround.py` from the ufcstats snapshot through 2026-10-31. Outputs: `data/derived/methodround.json` (per-fight predictions keyed by backtest fight id, held-out metrics, roster outputs keyed by slug, compact JS model), `tools/methodround_model.js` (evaluator). This is the benchmark the simulator's method-and-round distribution has to match or beat.

## Bottom line

- Held out on 1229 UFC fights from Jan 1, 2024 to 2026-10-31 (draws kept as their own cell; DQ and no-contests dropped), never used for any choice. Confidence intervals are 95% event-cluster bootstrap (2,000 draws).
- **Method (KO/TKO, submission, decision):** model S log loss 0.9441 [0.9188, 0.9700] vs 0.9886 [0.9657, 1.0101] for division base rates; difference -0.0445 [-0.0619, -0.0267]. Finish-vs-decision 0.6602 [0.6430, 0.6775] vs 0.6801 [0.6732, 0.6862].
- **Who wins how (7 bins):** 1.5643 [1.5242, 1.5976] vs 1.6979 [1.6679, 1.7252] (base rates x Elo); **who x how x when** (every round cell): 2.0777 [2.0152, 2.1276] vs 2.2279 [2.1638, 2.2797].
- **Winner** (a by-product): 0.6256 [0.6111, 0.6373] log loss, 66.6% accuracy, vs Elo 0.6798 [0.6722, 0.6868].
- **Against the betting market's own method props** (1183 held-out fights with US-book method and round props): market method LL 0.9220 [0.8929, 0.9499], model SM 0.9380 [0.9116, 0.9628], model S 0.9423 [0.9157, 0.9661]; the 50/50 blend of SM and the market 0.9218 [0.8967, 0.9459] (blend weight chosen on 2021-2023).

## Held-out results (2024+)

| Model | Method 3-class LL | Finish vs decision LL | 7-bin LL | Method x round LL | Who x how x when LL | Round given finish LL | KO vs SUB given finish LL | Winner LL | Winner accuracy |
|---|---|---|---|---|---|---|---|---|---|
| Division x format base rates (raw 5-yr window) | 0.9987 | 0.6781 | 1.7444 | 1.7262 | 2.4720 | 1.1849 | 0.6556 | 0.6932 | 94.8% |
| Division x format base rates (shrunk to all-division, k=50) | 0.9886 | 0.6801 | 1.7111 | 1.5187 | 2.2412 | 1.0683 | 0.6309 | 0.6932 | 94.8% |
| Base rates x Elo winner split | 0.9886 | 0.6801 | 1.6979 | 1.5187 | 2.2279 | 1.0683 | 0.6309 | 0.6798 | 55.0% |
| **Model S** (stats only, frozen fit through 2023) | 0.9441 | 0.6602 | 1.5643 | 1.4576 | 2.0777 | 1.0492 | 0.5805 | 0.6256 | 66.6% |
| Model S, yearly refit | 0.9431 | 0.6591 | 1.5623 | 1.4573 | 2.0765 | 1.0501 | 0.5807 | 0.6246 | 65.9% |
| **Model SM** (stats + closing moneyline, frozen) | 0.9401 | 0.6583 | 1.5253 | 1.4536 | 2.0387 | 1.0491 | 0.5763 | 0.5861 | 69.4% |
| Model SM, yearly refit | 0.9387 | 0.6569 | 1.5244 | 1.4529 | 2.0386 | 1.0501 | 0.5762 | 0.5867 | 69.4% |

Lower is better for every log loss (LL). Joint = the full outcome space (A or B, KO/TKO or submission, in round r; decision winner; draw). Brier for the 3-class method: S 0.5675, base 0.5936.

**95% CIs and paired differences (event-cluster bootstrap):**

| Model | Method LL | Finish LL | 7-bin LL | Joint LL | Winner LL |
|---|---|---|---|---|---|
| Division x format base rates (shrunk to all-division, k=50) | 0.9886 [0.9657, 1.0101] | 0.6801 [0.6732, 0.6862] | 1.7111 [1.6804, 1.7381] | 2.2412 [2.1788, 2.2963] | 0.6932 [0.6932, 0.6932] |
| Base rates x Elo winner split | 0.9886 [0.9657, 1.0101] | 0.6801 [0.6732, 0.6862] | 1.6979 [1.6679, 1.7252] | 2.2279 [2.1638, 2.2797] | 0.6798 [0.6722, 0.6868] |
| **Model S** (stats only, frozen fit through 2023) | 0.9441 [0.9188, 0.9700] | 0.6602 [0.6430, 0.6775] | 1.5643 [1.5242, 1.5976] | 2.0777 [2.0152, 2.1276] | 0.6256 [0.6111, 0.6373] |
| **Model SM** (stats + closing moneyline, frozen) | 0.9401 [0.9132, 0.9674] | 0.6583 [0.6400, 0.6765] | 1.5253 [1.4804, 1.5628] | 2.0387 [1.9752, 2.0910] | 0.5861 [0.5653, 0.6049] |

| Paired difference | Method | Finish | 7-bin | Joint | Round | finish | Winner |
|---|---|---|---|---|---|---|
| S - division base rates | -0.0445 [-0.0619, -0.0267] | -0.0198 [-0.0330, -0.0065] | -0.1469 [-0.1736, -0.1208] | -0.1635 [-0.1931, -0.1343] | -0.0192 [-0.0291, -0.0083] | -0.0676 [-0.0820, -0.0559] |
| S - base rates x Elo | -0.0445 [-0.0619, -0.0267] | -0.0198 [-0.0330, -0.0065] | -0.1336 [-0.1621, -0.1082] | -0.1502 [-0.1815, -0.1208] | -0.0192 [-0.0291, -0.0083] | -0.0542 [-0.0673, -0.0423] |
| SM - S | -0.0040 [-0.0088, +0.0005] | -0.0020 [-0.0066, +0.0027] | -0.0390 [-0.0510, -0.0254] | -0.0390 [-0.0510, -0.0254] | -0.0000 [-0.0004, +0.0003] | -0.0394 [-0.0521, -0.0263] |
| S yearly refit - S frozen | -0.0011 [-0.0052, +0.0031] | -0.0012 [-0.0055, +0.0027] | -0.0020 [-0.0074, +0.0036] | -0.0012 [-0.0068, +0.0046] | +0.0009 [-0.0004, +0.0022] | -0.0010 [-0.0033, +0.0013] |
| SM - base rates x Elo | -0.0485 [-0.0681, -0.0294] | -0.0218 [-0.0366, -0.0071] | -0.1726 [-0.2073, -0.1403] | -0.1892 [-0.2261, -0.1532] | -0.0192 [-0.0292, -0.0084] | -0.0937 [-0.1144, -0.0739] |

Negative = the first model is better. The differences are on the same fights, so their CIs are much tighter than the CIs of the levels.

### Versus the market's method and round props

| Model | Method | Finish | KO vs SUB | Round | finish | 7-bin | Joint | Winner |
|---|---|---|---|---|---|---|---|
| Base rates x Elo | 0.9866 [0.9631, 1.0083] | 0.6795 [0.6732, 0.6866] | 0.6275 [0.6026, 0.6552] | 1.0720 [1.0378, 1.1111] | 1.6973 [1.6704, 1.7258] | 2.2296 [2.1676, 2.2882] | 0.6804 [0.6725, 0.6880] |
| Model S | 0.9423 [0.9157, 0.9661] | 0.6591 [0.6432, 0.6760] | 0.5786 [0.5455, 0.6084] | 1.0540 [1.0178, 1.0885] | 1.5631 [1.5247, 1.5991] | 2.0791 [2.0210, 2.1358] | 0.6235 [0.6118, 0.6357] |
| Model SM | 0.9380 [0.9116, 0.9628] | 0.6573 [0.6409, 0.6761] | 0.5734 [0.5423, 0.6034] | 1.0540 [1.0176, 1.0886] | 1.5222 [1.4836, 1.5629] | 2.0382 [1.9790, 2.0998] | 0.5820 [0.5627, 0.6046] |
| Market props (US books, power de-vig, averaged) | 0.9220 [0.8929, 0.9499] | 0.6454 [0.6216, 0.6665] | 0.5650 [0.5316, 0.5977] | 1.0539 [1.0254, 1.0813] | 1.5002 [1.4553, 1.5442] | 2.0160 [1.9510, 2.0800] | 0.5874 [0.5659, 0.6106] |
| SM + market blend (a=0.5) | 0.9218 [0.8967, 0.9459] | 0.6462 [0.6275, 0.6660] | 0.5631 [0.5304, 0.5929] | 1.0501 [1.0179, 1.0809] | 1.4973 [1.4570, 1.5389] | 2.0114 [1.9532, 2.0756] | 0.5828 [0.5626, 0.6064] |
| SM refit + market blend | 0.9206 [0.8952, 0.9462] | 0.6451 [0.6266, 0.6635] | 0.5631 [0.5304, 0.5939] | 1.0509 [1.0197, 1.0809] | 1.4963 [1.4565, 1.5413] | 2.0110 [1.9507, 2.0768] | 0.5831 [0.5627, 0.6066] |

| Paired difference | Method | Finish | KO vs SUB | Round | finish | 7-bin | Joint |
|---|---|---|---|---|---|---|
| SM - market | +0.0160 [+0.0015, +0.0314] | +0.0119 [+0.0014, +0.0244] | +0.0083 [-0.0121, +0.0282] | +0.0001 [-0.0149, +0.0130] | +0.0220 [-0.0003, +0.0456] | +0.0221 [-0.0007, +0.0469] |
| S - market | +0.0203 [+0.0041, +0.0363] | +0.0136 [+0.0022, +0.0259] | +0.0136 [-0.0067, +0.0335] | +0.0001 [-0.0148, +0.0127] | +0.0628 [+0.0362, +0.0924] | +0.0630 [+0.0356, +0.0921] |
| blend - market | -0.0002 [-0.0074, +0.0078] | +0.0007 [-0.0047, +0.0072] | -0.0019 [-0.0125, +0.0082] | -0.0038 [-0.0104, +0.0024] | -0.0029 [-0.0144, +0.0092] | -0.0046 [-0.0161, +0.0081] |
| blend - SM | -0.0162 [-0.0236, -0.0090] | -0.0112 [-0.0171, -0.0059] | -0.0103 [-0.0203, -0.0002] | -0.0039 [-0.0109, +0.0042] | -0.0249 [-0.0362, -0.0139] | -0.0268 [-0.0387, -0.0152] |

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
| 1 | 0.162 | 0.116 | 0.047 | 0.034 |
| 2 | 0.113 | 0.122 | 0.044 | 0.054 |
| 3 | 0.064 | 0.075 | 0.038 | 0.034 |
| 4 | 0.035 | 0.041 | 0.027 | 0.020 |
| 5 | 0.032 | 0.034 | 0.015 | 0.014 |
| decision | 0.422 | 0.456 |  |  |

## By division and format (held out)

| Division | n | Pred KO/SUB/DEC | Obs KO/SUB/DEC | Method LL S | Method LL base | Joint LL S | Joint LL base |
|---|---|---|---|---|---|---|---|
| Bantamweight | 138 | 0.29/0.15/0.56 | 0.20/0.17/0.63 | 0.9199 | 0.9619 | 1.9653 | 2.1174 |
| Featherweight | 144 | 0.35/0.20/0.46 | 0.37/0.16/0.47 | 0.9667 | 1.0252 | 2.1115 | 2.2696 |
| Flyweight | 98 | 0.33/0.22/0.45 | 0.22/0.20/0.57 | 0.9680 | 0.9831 | 2.0836 | 2.2368 |
| Heavyweight | 80 | 0.48/0.14/0.38 | 0.41/0.11/0.47 | 0.9198 | 0.9525 | 2.1348 | 2.2296 |
| Light Heavyweight | 85 | 0.46/0.15/0.39 | 0.58/0.14/0.28 | 0.9395 | 1.0133 | 2.3953 | 2.5189 |
| Lightweight | 172 | 0.38/0.21/0.42 | 0.37/0.19/0.44 | 0.9811 | 1.0439 | 2.1959 | 2.3758 |
| Middleweight | 162 | 0.39/0.20/0.41 | 0.36/0.18/0.46 | 1.0155 | 1.0345 | 2.1488 | 2.3392 |
| Welterweight | 138 | 0.36/0.18/0.46 | 0.41/0.14/0.45 | 0.9656 | 1.0210 | 2.1386 | 2.3121 |
| Women's Bantamweight | 51 | 0.15/0.19/0.66 | 0.16/0.23/0.61 | 0.9160 | 0.9667 | 1.8489 | 2.0811 |
| Women's Flyweight | 63 | 0.16/0.19/0.65 | 0.11/0.14/0.75 | 0.7459 | 0.8177 | 1.6201 | 1.8673 |
| Women's Strawweight | 85 | 0.17/0.21/0.62 | 0.14/0.19/0.67 | 0.8781 | 0.8865 | 1.8605 | 1.9704 |

| Format | n | Method S/base | Finish S/base | Round|fin S/base | Joint S/base |
|---|---|---|---|---|---|
| 3 rounds | 1082 | 0.9492 / 0.9879 | 0.6658 / 0.6820 | 0.9801 / 0.9989 | 2.0426 / 2.1984 |
| 5 rounds | 147 | 0.9070 / 0.9935 | 0.6193 / 0.6659 | 1.4991 / 1.5203 | 2.3365 / 2.5558 |

| Year | n | Method S | Method S refit | Method SM | Method base | Joint S | Joint base |
|---|---|---|---|---|---|---|---|
| 2024 | 428 | 0.9198 | 0.9198 | 0.9225 | 0.9667 | 2.0153 | 2.1671 |
| 2025 | 429 | 0.9521 | 0.9479 | 0.9446 | 0.9875 | 2.0686 | 2.2329 |
| 2026 | 372 | 0.9629 | 0.9642 | 0.9552 | 1.0151 | 2.1600 | 2.3360 |

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
   penalty on standardized coefficients (C = 0.002 for S, 0.002 for SM, per-observation scale), recency weights
   (half-life 8 years), trained on 2012+ (S) / 2013+ (SM) fights. Every fight is used in both orientations and
   predictions average the two, so the A/B corner (A wins 56%) never leaks and swapping fighters swaps the
   probabilities exactly. SM replaces the six-class model's winner share with a separate symmetric winner logit
   (C = 0.003) and keeps its method-given-winner shares.
2. *When:* a discrete-time competing-risks model: per round, a multinomial logit over {no finish, A KO, A SUB, B KO,
   B SUB} with separate unpenalized baseline hazards for each round of 3- and 5-round bouts and 37 shared
   finishing-tendency features (C = 0.01), trained on 2008+ fight-rounds in both orientations; a symmetric logit
   picks the decision winner. Its conditional round shapes (P(round r | A KO), ...) spread the six-class
   probabilities over rounds; a draw takes 1.40% of the decision mass.
3. *Market blend (live only):* when US-book method props exist, (1 - a) x SM + a x market joint, a = 0.5 chosen on
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
| S | C6=0.002 | 0.9669 | 2.1733 | 0.6497 |
| SM | C6=0.002, C_win=0.003 | 0.9629 | 2.1420 | 0.6220 |
| hazard | C_haz=0.01 | 0.9669 | 2.1733 | rgf 1.0634 |

Market blend on the 1203 2021-2023 fights with props: a=0.0 joint 2.1454 method 0.9690; a=0.1 joint 2.1364 method 0.9643; a=0.2 joint 2.1299 method 0.9607; a=0.3 joint 2.1254 method 0.9579; a=0.4 joint 2.1224 method 0.9560; a=0.5 joint 2.1210 method 0.9547; a=0.6 joint 2.1210 method 0.9541; a=0.7 joint 2.1225 method 0.9543; a=0.8 joint 2.1254 method 0.9551; a=0.9 joint 2.1301 method 0.9566; a=1.0 joint 2.1365 method 0.9588.

## Roster and the default matchup

- **Volkanovski vs Gaethje, 5 x 5 at 155, stats only:** Volk 60.3% (KO 26.3, sub 3.5, dec 30.5), Gaethje 39.0% (KO 21.5, sub 0.9, dec 16.7), draw 0.7%; finish 52.1% (KO/TKO 47.8%, sub 4.3%); finish by round 16.1, 14.7, 9.8, 6.0, 5.6.
- **Volkanovski vs Gaethje, 5 x 5 at 155, with the no-vig market price Volkanovski 37.2% (openers Oct 24-25, 2026, docs/BACKLOG.md):** Volk 46.1% (KO 19.7, sub 2.6, dec 23.8), Gaethje 53.2% (KO 27.8, sub 1.2, dec 24.2), draw 0.7%; finish 51.3% (KO/TKO 47.6%, sub 3.8%); finish by round 15.9, 14.5, 9.6, 5.9, 5.5.
- `roster[slug]`: 355 fighters, P(win/lose by KO, SUB, decision), P(finish) and method-given-win, averaged over everyone in the fighter's division with a UFC fight since 2025-01-01 (3 rounds, stats-only model fit through the snapshot).
  Highest P(win by KO/TKO) vs their division field: carlos-prates 47%; brando-pericic 46%; ateba-gautier 44%; carlos-ulberg 43%; iwo-baraniewski 43%.
  Highest P(win by submission): jaqueline-amorim 42%; bia-mesquita 30%; anthony-hernandez 28%; jimmy-crute 27%; benoit-saint-denis 27%.
- JS model (`js_model` in the JSON, evaluator `tools/methodround_model.js`, fit through the snapshot): verified; Python vs node on 40 random roster matchups, max abs difference 3.8e-05.

## Recommendation for the final ensemble

1. **Use this model as the method/round prior and as the yardstick for the simulator.** The v3+ engine's
   simulated method distribution should be scored on the same held-out fights with the same metrics (method
   3-class LL, finish LL, round-given-finish LL, 7-bin and joint LL, plus the calibration tables above). If the
   engine does not beat model S on method and round, the page should take its method/round split from here and
   use the engine for the play-by-play and the fight story.
2. **Factorize the final forecast:** P(A wins) from the winner ensemble (market + Elo + engine + this model's
   winner), then P(method, round | winner) from this model's conditional shares (`methodGivenWin` in the JS
   output; the per-fight cells give the same). Method given winner is where this model adds the most, and it
   leaves the winner question to the stack.
3. **Live, with a line:** use SM, and when method props are posted, blend with them (weight a in the meta); the
   props are sharp on KO vs submission, while the model is sharper on the finishing round.
4. **Without a line** (hypothetical matchups such as Volkanovski vs Gaethje before odds): use S.
5. Natural next inputs: pre-UFC records (tools/preufc.py; Sherdog crawl was incomplete when this ran, so it is not
   used), opponent-adjusted rates (tools/oppadj.py) and the durability model's chin/power estimates
   (data/derived/durability.json) as extra features; refit with `python3 tools/methodround.py`.

## Limitations

- Method and round are noisy targets: even the market's props reach a method log loss of only about 0.95
  against 1.01 for base rates. Gains of 0.01-0.05 in log loss are what good looks like here.
- Draws are a fixed share of decision outcomes; DQ and no-contests are not modelled (excluded from scoring).
- The SM variant needs the closing line; scored on 2024+ it is a live model, not a fight-week forecast.
- The market props benchmark covers fights with US-book props (2021+) and uses averaged, power-normalised
  prices; a single sharp book could be stronger.
- Roster outputs are averages over the current division field with the stats-only model; they describe
  tendencies, not any particular matchup.
