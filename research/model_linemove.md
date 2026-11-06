# Line timing and movement (task key: linemove)

Nov 6, 2026, about 10:42 pm UTC. Tool: `tools/linemove.py`. Output: `data/derived/linemove.json`. Blind-test plugin:
`tools/blindtest_plugins/linemove.py`. Test: `tests/test_linemove.py`. Scratch caches: `out/linemove_cache/` (gitignored).
Two runs. The first was stopped by a container restart after its 2024-25 look (pre-registration committed in fb65a93 at
10:23 pm, look written 10:24 pm). The second added a pre-2024 addendum, pre-registered it in 5a08703 at 10:34:14 pm (the
commit time is the authority; the "~22:36" inside the committed text is a typo), before opening the first look's
file, and then scored it once (valid_addendum ran at 10:34:19 pm).

Every table below is printed by `python3 tools/linemove.py tables` from linemove.json. Protocol (docs/BACKLOG.md):
- Rows dated 2026-01-01 or later are dropped at parse: 3,153 event-page rows and 1,179 fighter-page rows.
- Every choice is made by forward-chained CV on pre-2024 fights. The stack gate is 2021-2023, fit on 2019..Y-1, with
  tools/ml2.py's `stack_fit` and its 0.0005 rule.
- 2024-01-01..2025-12-31 is scored once per pre-registration.
- No intercepts; the corner swap is asserted (max |p(A,B) + p(B,A) - 1| = 2.2e-16).
- Brackets are 95% intervals from 2,000 card-cluster bootstrap resamples, paired for differences. n = 1,221 CV fights
  (2021-23) and 833 fights on 84 cards (2024-25), all decisive, with a full trajectory, a close and an open.

## Bottom line

1. **The data has no timestamps.** BestFightOdds' per-book line-history endpoint is obfuscated, so it was not used.
   - Two other sources were also left out. fightodds.io serves an undocumented API, and its terms render only
     client-side, so they could not be read. OddsPortal's robots.txt disallows the historical year pages.
   - What exists for 2015-2025 is BFO's 10-point mean-odds sparkline per bout. Point 0 is the opener, which is one
     book's first price. Points 1-8 are the mean across books in between, and point 9 is the mean close. The points are
     index-only: BFO's chart code plots them with `pointStart:1` and no time axis. A sampling test cannot tell
     time-uniform from index sampling (1.2496 vs 1.2499).
   - So "T-24h" maps only roughly onto the trajectory: somewhere between point 8 and the close.
   - Per-book closes exist for 2021+, but only for seven US recreational books. There is no sharp book (no Pinnacle or
     Circa), so a sharp-versus-recreational comparison is impossible here. (high)
2. **(Q1) The model knows a real part of the move before the market makes it, but mostly before the first consensus
   snapshot.**
   - From the opener: ML v2's gap to the opener correlates 0.44 with the logit move to the close (pooled 2015-2023;
     0.50 on 2019-23 alone; 0.38 on 2024-25). That gap alone explains 22% of the move out of sample (14% on
     2024-25). With the line level and ratings added, it explains 27% (33%). It is not mean reversion of a noisy
     opener: the line level alone explains 2% (10% on 2024-25) (verifier table V1).
   - From the first consensus snapshot, R^2 falls to 11% (6%). From point 8 it falls to 3% (1%).
   - In betting terms, backing ML v2's side at the opener earns closing-line value of +7.5% over a random side
     [+6.7%, +8.2%]; on 2024-25 it is +6.0% [+4.6%, +7.3%]. ROI is +3.9% [-1.1%, +9.1%] on 2019-23 and +9.6%
     [+1.9%, +17.3%] on 2024-25.
   - At BFO's mean consensus odds the edge shrinks. **Corrected by the verifier:** T4's "minus both sides" measure is
     not neutral. It scores a plain favourite rule at about +3% at every consensus point (+4-6% on 2024-25), so its
     "+0.2%, and -0.7% on 2024-25 at point 8" is an artefact of the measure. On a de-vig-consistent fair CLV (table
     V2), ML v2's side earns:
     - at point 1: +2.6% against +0.5% for the favourite rule (2024-25: +2.0% against +1.8%);
     - at point 8: +0.5% [+0.2%, +0.9%] (2024-25: +0.4% [-0.3%, +1.0%]), no better than the favourite rule (+0.6%,
       and +0.9% on 2024-25).

     ROI after the opener is not significant in either period.
   - Caveat: the opener is one book's first price, often small-limit. This is evidence that the model leads the market
     early. It is not a betting system. (high for the direction; medium for the ROI)
3. **(Q2) A stack trained on a consensus snapshot was built and gated, and it failed the pre-registered look.**
   - CV is flat across the training point. Stacks trained on any consensus point 1-8 agree within 0.0003 whatever
     consensus point is fed (T7). The close-trained row adds up to 0.0008 when fed points 1-3. Stacks trained on
     synthetic T-6h, T-24h, T-72h or T-7d lines score 0.6166-0.6172 in CV (a span of 0.0006). The line weight stays at 0.77-0.79; the
     ML v2 weight ranges over 0.33-0.40 (corrected by the verifier from "within about 0.02").
   - The pooled points 4-8 stack beat the open-trained stack on consensus lines in CV: -0.0012 [-0.0033, +0.0009],
     and -0.0015 [-0.0035, +0.0005] against the forward ledger's incumbent as actually run.
   - On 2024-25 the pre-registered primary was **contradicted**: +0.0041 [+0.0017, +0.0066]. The as-run comparison
     was +0.0028 [-0.0001, +0.0059]. (high)
4. **(Q3) Movement and dispersion add nothing beyond the close, for the winner or the method.**
   - Of eight winner variants (opener, late steam, first consensus, range spread, move size, late-move size, per-book
     sd), one passed the 0.0005 rule in CV: B3, + point 1, at -0.0007 [-0.0024, +0.0009]. It was not confirmed on
     2024-25: +0.0010 [-0.0012, +0.0033].
   - None of four movement features improved the goes-to-decision prop.
   - No US book's close beats the consensus close in either period. (high)
5. **(Q4) Routing: keep fwd-4.1. Use open-trained weights for any line captured before the lock, and close-trained
   weights only for a true close. No capture-time switch.**
   - What separates the stacks is not line timing. It is the ML v2 weight: open-trained 0.58, consensus 0.39,
     close-trained 0.33.
   - 2024-25 rewards ML v2 weight whatever line is fed. There, the open-trained stack beats the close-trained stack
     even on the close.
   - That is the drift/calibration question (the calib workstream), not a timing one. (medium-high)

## 1. Data

| item | value |
|---|---|
| source | `data/raw/odds/bfo_fighter_lines.csv`: BFO fighter-page sparklines, already parsed by tools/market.py |
| per-book closes | `data/raw/odds/bfo_event_lines.csv`: BetWay, FanDuel, BetRivers, Caesars, BetMGM, DraftKings and Unibet, 2021+. Exchanges are excluded |
| matching | tools/market.py's `assemble()`: 5,739 BFO matchups matched; both fighter pages agree in all 4,264 read twice |
| model inputs | tools/ml2.py cache. ML v2 logistic: annual-refit OOF for 2012-2023, static (fit < 2024) or monthly-rolling for 2024-25. Plus the market rating and WHR |

T1 coverage (decisive dev evaluation fights):

| year | eval fights | with a 10-point trajectory | per-book closes |
|---|---|---|---|
| 2015 | 383 | 91 | 0 |
| 2016 | 381 | 126 | 0 |
| 2017 | 344 | 169 | 0 |
| 2018 | 368 | 238 | 0 |
| 2019 | 388 | 388 | 0 |
| 2020 | 343 | 342 | 0 |
| 2021 | 415 | 414 | 506 |
| 2022 | 419 | 419 | 507 |
| 2023 | 390 | 388 | 515 |
| 2024 | 429 | 428 | 513 |
| 2025 | 425 | 405 | 510 |

T2 sparkline checks and timing:

| item | value |
|---|---|
| point 9 vs market.json power close, mean abs diff (n 2839) | 0.00159 |
| point 0 identical to the parsed opener | 1.0 |
| sampling test, Gaussian ll per step: time-uniform vs index-only (forward-chained 2016-2023, n 2481) | 1.2496 vs 1.2499 |
| matchup lead (days from BFO's first line to the event), quartiles | 27.7 / 48.5 / 71.4 |
| lead estimator CV MAE / median abs error (days; 537 short-notice anchors) | 8.05 / 4.22 |

- The lead is estimated from BFO's sequential matchup ids, anchored on Wikipedia short-notice replacements
  (data/derived/fightweek.json).
- Under the time-uniform reading, the median sparkline point sits at 48.5, 43.1, ..., 5.4 and 0 days before the event.
  Under that reading, a fitted volatility profile puts about 57% of the post-point-1 variance in the last 24 h. The
  profile underfits the observed close-minus-point variances (0.074 observed vs 0.047 modelled at point 1), so treat
  that share as rough.
- The synthetic T-k lines in T10 rest on this reading. They are descriptive.

## 2. Q1: what the model knows before the market moves

T3 shows how much of the move to the close is predictable. The target is the logit move to the close. R^2 is out of
sample: expanding-window fits on years before Y, pooled over 2019-2023 ("CV"), and coefficients fit on 2023 and earlier
for 2024-25. There is no intercept.

| from point | sd of move (2019-23) | corr(move, ML v2 gap) CV | 2024-25 | R2 M1 gap CV | 2024-25 | R2 M2 +ratings CV | 2024-25 | R2 M3 +level CV | 2024-25 |
|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.403 | 0.4434 | 0.38 | 0.2222 | 0.1416 | 0.2244 | 0.1752 | 0.2747 | 0.3346 |
| 1 | 0.2694 | 0.326 | 0.2499 | 0.1108 | 0.06 | 0.1361 | 0.0995 | 0.1812 | 0.2016 |
| 4 | 0.2256 | 0.2843 | 0.189 | 0.0819 | 0.0334 | 0.104 | 0.0758 | 0.14 | 0.1596 |
| 8 | 0.1302 | 0.1832 | 0.1145 | 0.033 | 0.0103 | 0.0579 | 0.0351 | 0.0748 | 0.0725 |

M1 uses ML v2's logit gap to the line. M2 adds the market-rating and WHR gaps. M3 adds the line level and the momentum
since the opener.

Verifier notes on T3:
- The "corr ... CV" column is a plain correlation pooled over 2015-2023, not a cross-validated number. On 2019-23
  alone it is 0.50, 0.35, 0.30 and 0.19.
- Target and feature share the -z_s term, so part of a gap's power could be mean reversion of a noisy snapshot. Table
  V1 rules that out: the line level alone explains 0.020, 0.020, 0.009 and 0.010 (CV). Adding ML v2 to the level
  raises that to 0.268, 0.172, 0.134 and 0.075.

T4 bets ML v2's side at point s, at that point's price. Point 0 is one book's opener; points 1-8 are BFO mean odds,
vig included, not the best price.
- CLV = p_close(side) x odds - 1, using the power no-vig close.
- "Minus both sides" subtracts the average CLV of betting both sides, which removes the vig and the line drift common
  to all bets.
- ROI is realised on outcomes.

| point | edge > | bets 2019-23 | CLV minus both sides 2019-23 | ROI 2019-23 | ROI 2015-18 | CLV minus both sides 2024-25 | ROI 2024-25 |
|---|---|---|---|---|---|---|---|
| 0 | 0.0 | 1951 | +0.075 [+0.067, +0.082] | +0.039 [-0.011, +0.091] | +0.082 [+0.000, +0.170] | +0.060 [+0.046, +0.073] | +0.096 [+0.019, +0.173] |
| 0 | 0.03 | 1601 | +0.086 [+0.078, +0.094] | +0.072 [+0.016, +0.130] | +0.106 [+0.024, +0.194] | +0.071 [+0.055, +0.088] | +0.148 [+0.066, +0.232] |
| 0 | 0.1 | 843 | +0.120 [+0.108, +0.132] | +0.141 [+0.067, +0.221] | +0.207 [+0.097, +0.328] | +0.101 [+0.073, +0.127] | +0.241 [+0.107, +0.371] |
| 1 | 0.0 | 1951 | +0.027 [+0.022, +0.033] | +0.008 [-0.041, +0.056] | +0.102 [+0.005, +0.202] | +0.025 [+0.014, +0.036] | +0.043 [-0.036, +0.124] |
| 1 | 0.03 | 1523 | +0.036 [+0.030, +0.043] | +0.022 [-0.034, +0.076] | +0.117 [+0.014, +0.220] | +0.028 [+0.015, +0.041] | +0.107 [+0.016, +0.203] |
| 1 | 0.1 | 742 | +0.050 [+0.042, +0.060] | +0.035 [-0.052, +0.120] | +0.264 [+0.120, +0.412] | +0.036 [+0.018, +0.054] | +0.185 [+0.046, +0.329] |
| 4 | 0.0 | 1951 | +0.017 [+0.012, +0.022] | -0.025 [-0.077, +0.025] | +0.123 [+0.024, +0.222] | +0.016 [+0.007, +0.025] | +0.032 [-0.043, +0.110] |
| 4 | 0.03 | 1540 | +0.022 [+0.016, +0.028] | +0.008 [-0.048, +0.063] | +0.125 [+0.014, +0.240] | +0.017 [+0.007, +0.027] | +0.077 [-0.015, +0.172] |
| 4 | 0.1 | 723 | +0.036 [+0.027, +0.043] | +0.015 [-0.066, +0.102] | +0.234 [+0.061, +0.395] | +0.009 [-0.008, +0.025] | +0.157 [+0.014, +0.299] |
| 8 | 0.0 | 1951 | +0.002 [-0.001, +0.006] | -0.017 [-0.066, +0.033] | +0.146 [+0.050, +0.242] | -0.007 [-0.013, -0.000] | +0.011 [-0.069, +0.095] |
| 8 | 0.03 | 1527 | +0.003 [-0.001, +0.007] | +0.008 [-0.052, +0.069] | +0.130 [+0.021, +0.243] | -0.011 [-0.017, -0.004] | +0.025 [-0.070, +0.123] |
| 8 | 0.1 | 721 | +0.004 [-0.001, +0.010] | +0.047 [-0.035, +0.128] | +0.193 [+0.027, +0.367] | -0.014 [-0.023, -0.004] | +0.160 [+0.004, +0.330] |

Reading:
- **Correction (verifier): the "CLV minus both sides" column is not a neutral benchmark at points 1-8.** The close is
  the power de-vig, which loads the vig onto the underdog, while the bet price carries the vig proportionally. So
  backing the favourite scores about +0.03 at every consensus point on this measure, and backing the underdog about
  -0.03. ML v2 backs the favourite in only 34-45% of its bets, so its column is biased down. Table V2 (end of this
  note) gives a de-vig-consistent fair CLV: the multiplicative no-vig probability at point s and at the close.
  - At the opener the edge is unchanged: +0.076 against -0.006 for the favourite rule (2024-25: +0.054 against
    +0.010).
  - At point 8 ML v2's side is +0.005 [+0.002, +0.009] (2024-25: +0.004 [-0.003, +0.010]). That is not "zero or
    negative", but it is no better than backing the favourite: +0.006, and +0.009 on 2024-25.
  - At the opener, ROI beats a favourite rule by +0.073 [+0.005, +0.142] on 2019-23 and +0.098 [-0.001, +0.201] on
    2024-25.
- **CLV, measured against the close, is the cleaner signal: one outcome-free number per bet.** On the fair measure it
  is clearly positive at the opener, smaller at the first consensus snapshot, and by point 8 no larger than a
  favourite rule's. That holds in both periods.
- **ROI is noisy.** 2019-23 is not significant except at the opener with an edge over 3%. The 2015-18 ROIs are large
  but come from the partially covered years. 2024-25 is the year when ML v2 tied the close (T6).
- **Multiplicity.** 4 points x 4 thresholds were tried, so treat any single cell as a lead.
- **Exploitable?** That depends on getting the opener in size, which this data cannot show.

T5 gives the share of the opener-to-close log-loss gain already in each forecast. The share is (LL open - LL forecast)
/ (LL open - LL close); 1 means as good as the close.

| forecast | CV 2021-23 | 2024-25 |
|---|---|---|
| open-trained stack (opener + ML v2 logistic) | 0.72 [0.28, 1.75] | 1.21 [0.80, 2.22] |
| ML v2 logistic alone | 0.16 [-1.58, 1.05] | 1.04 [0.44, 2.19] |
| raw consensus point 1 | 0.74 [0.41, 1.45] | 0.41 [0.20, 0.64] |
| raw consensus point 4 | 0.84 [0.56, 1.50] | 0.65 [0.47, 0.93] |
| raw consensus point 8 | 1.02 [0.86, 1.45] | 0.89 [0.71, 1.09] |
| consensus stack fed point 1 | 1.10 [0.70, 2.25] | 1.15 [0.83, 1.90] |
| consensus stack fed point 4 | 1.14 [0.75, 2.23] | 1.31 [0.99, 2.12] |
| consensus stack fed point 8 | 1.20 [0.87, 2.04] | 1.44 [1.14, 2.14] |

- With the opener, the model already holds about 70% of what the market learns by the close (CV); on 2024-25 it holds
  all of it.
- From the first consensus snapshot on, a stack is about as good as the close or better. The intervals are wide
  because the open-to-close gap is only about 0.016 log loss.

## 3. Q2: stacks for the capture time

T6 gives the raw lines' log loss:

| line | 2019-23 | CV years 2021-23 | 2024-25 |
|---|---|---|---|
| 0 | 0.63794 | 0.63493 | 0.60909 |
| 1 | 0.62792 | 0.62326 | 0.59919 |
| 2 | 0.62727 | 0.62275 | 0.59765 |
| 3 | 0.62692 | 0.62221 | 0.59629 |
| 4 | 0.62579 | 0.62164 | 0.59332 |
| 5 | 0.6252 | 0.62063 | 0.59136 |
| 6 | 0.62548 | 0.62065 | 0.59057 |
| 7 | 0.62488 | 0.61982 | 0.58911 |
| 8 | 0.62439 | 0.61876 | 0.58765 |
| 9 | 0.62324 | 0.61908 | 0.58397 |
| close_market_json | 0.62338 | 0.61916 | 0.58487 |
| ml2lr | 0.63601 | 0.6324 | 0.58395 |

**Universe caveat (verifier, table V4).** The 2024-25 rows are the 833 of 854 decisive evaluation fights with a full
trajectory. The 21 left out are not random: ML v2 scores 0.7748 on them against 0.5840 on the rest, and A wins 38%
against 55%. Every paired stack comparison here is unaffected, because all arms use the same rows. The absolute "ML v2
ties the close" on these 833 rows (0.58395 vs 0.58397) flatters ML v2, though. Use research/model_ml2.md's 854/845
numbers for ML v2 against the close (0.5887 vs 0.5854). In 2019-23 only 4 rows are missing.

T7 cross-feeds the stacks: log loss on CV 2021-23. Each row is the training point of a line + ML v2 logistic stack
(fit on 2019..Y-1, no recency weighting, the 0.0005 rule's choice at every point). Each column is the line fed.

| trained on \ fed | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0 | 0.6236 | 0.6182 | 0.6183 | 0.6181 | 0.6179 | 0.6175 | 0.6177 | 0.6176 | 0.6174 | 0.6185 |
| 1 | 0.6238 | 0.6174 | 0.6173 | 0.6171 | 0.6169 | 0.6163 | 0.6166 | 0.6164 | 0.6160 | 0.6171 |
| 2 | 0.6240 | 0.6174 | 0.6174 | 0.6171 | 0.6169 | 0.6163 | 0.6166 | 0.6164 | 0.6160 | 0.6171 |
| 3 | 0.6240 | 0.6175 | 0.6174 | 0.6172 | 0.6169 | 0.6164 | 0.6166 | 0.6164 | 0.6160 | 0.6171 |
| 4 | 0.6243 | 0.6175 | 0.6174 | 0.6171 | 0.6169 | 0.6163 | 0.6166 | 0.6163 | 0.6159 | 0.6170 |
| 5 | 0.6243 | 0.6175 | 0.6174 | 0.6171 | 0.6169 | 0.6163 | 0.6165 | 0.6163 | 0.6159 | 0.6170 |
| 6 | 0.6242 | 0.6175 | 0.6175 | 0.6172 | 0.6169 | 0.6164 | 0.6166 | 0.6164 | 0.6160 | 0.6170 |
| 7 | 0.6244 | 0.6176 | 0.6175 | 0.6172 | 0.6170 | 0.6164 | 0.6166 | 0.6164 | 0.6159 | 0.6169 |
| 8 | 0.6245 | 0.6177 | 0.6176 | 0.6173 | 0.6171 | 0.6165 | 0.6167 | 0.6164 | 0.6160 | 0.6169 |
| 9 | 0.6256 | 0.6182 | 0.6181 | 0.6178 | 0.6175 | 0.6168 | 0.6170 | 0.6167 | 0.6162 | 0.6170 |

T7b repeats this on 2024-25 (fit 2019-2023, static):

| trained on \ fed | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 |
|---|---|---|---|---|---|---|---|---|---|---|
| open-trained (point 0) | 0.5799 | 0.5757 | 0.5749 | 0.5743 | 0.5726 | 0.5717 | 0.5715 | 0.5710 | 0.5704 | 0.5687 |
| consensus (S4-8) | 0.5869 | 0.5813 | 0.5803 | 0.5794 | 0.5774 | 0.5761 | 0.5758 | 0.5751 | 0.5743 | 0.5721 |
| close-trained (point 9) | 0.5906 | 0.5843 | 0.5832 | 0.5823 | 0.5802 | 0.5789 | 0.5784 | 0.5776 | 0.5766 | 0.5742 |

T8 compares consensus training sets: CV 2021-23 mean log loss over fed points 4-9, with h chosen by the 0.0005 rule.

| set | h | mean fed 4-9 | weights (line, ML v2 lr) fit 2019-23 |
|---|---|---|---|
| S8 | None | 0.6166 | [0.7851, 0.3673] |
| S678 | None | 0.61656 | [0.7837, 0.3825] |
| S4-8 | None | 0.61653 | [0.7884, 0.3894] |
| S1-9 | None | 0.61655 | [0.7809, 0.3975] |
| S9 (close-trained) | None | 0.61686 | [0.7798, 0.331] |

Other variants tried in CV, none of which changed anything:
- line + ML v2 + market rating: weight 0 at every consensus point;
- the ML v2 blend instead of the logistic: about -0.0001;
- adding the opener to a consensus stack: worse at every point;
- a maturity-adaptive "any-time" stack: no gain;
- recency half-lives 3 and 1.5 years: never chosen.

All of these are in `linemove.json` under stacks.per_snapshot and stacks.anytime_stack.

T9 is the routing comparison: paired log-loss differences, 2,000 card resamples.

| comparison | CV 2021-23 | 2024-25 (static) | 2024-25 (January refit) |
|---|---|---|---|
| PRIMARY: consensus minus open-trained, both fed power, pooled fed 4-9 | -0.0012 [-0.0033, +0.0009] | +0.0041 [+0.0017, +0.0066] | +0.0037 [+0.0013, +0.0062] |
| consensus minus fwd-4.1 as run (open-trained fed multiplicative), pooled 4-9 | -0.0015 [-0.0035, +0.0005] | +0.0028 [-0.0001, +0.0059] | +0.0027 [-0.0002, +0.0056] |
| open-trained fed multiplicative minus fed power, pooled 4-9 | +0.0003 [-0.0006, +0.0011] | +0.0014 [+0.0001, +0.0025] | +0.0011 [-0.0002, +0.0022] |
| close-trained minus consensus, fed point 8 | +0.0002 [-0.0008, +0.0013] | +0.0023 [+0.0012, +0.0033] | +0.0022 [+0.0010, +0.0033] |
| close-trained minus consensus, fed the close (point 9) | +0.0000 [-0.0010, +0.0011] | +0.0020 [+0.0009, +0.0031] | +0.0019 [+0.0007, +0.0030] |
| consensus minus open-trained, fed the opener (point 0) | +0.0006 (T7: point-4-trained minus open-trained) | +0.0070 [+0.0045, +0.0097] | +0.0066 [+0.0040, +0.0093] |

Verdicts:
- PREREG primary: **contradicted** (the CI is entirely above 0).
- Addendum as-run secondary: not confirmed.
- Under PREREG's failure rule, the open-trained stack stays primary for consensus lines. The change would also fail
  docs/V6_V10_PLAN.md 6.3's "not worse" tolerance for the winner (CI upper bound +0.0059 > +0.002).
- In every period, feeding a single-book opener to anything but open-trained weights costs log loss.

T10 builds synthetic T-k lines: a Brownian bridge between the bracketing sparkline points, under the time-uniform
reading (CV 2021-23).

| k | rows | stack trained on T-k: CV | weights fit 2019-23 | raw line | open-trained fed T-k | point-8-trained fed T-k |
|---|---|---|---|---|---|---|
| T-6h | 2779 | 0.61712 | [0.784, 0.3414] | 0.61958 | 0.61866 | 0.61715 |
| T-24h | 2778 | 0.61695 | [0.7734, 0.3647] | 0.61962 | 0.61832 | 0.61692 |
| T-72h | 2771 | 0.61658 | [0.7773, 0.3636] | 0.6191 | 0.61798 | 0.61653 |
| T-7d | 2734 | 0.61715 | [0.7705, 0.3915] | 0.62023 | 0.61835 | 0.61709 |

- The bridge was validated by synthesising real points: point 6 from points 4 and 8, point 8 from 6 and 9, and point 7
  from 5 and 9. Stacks trained on the synthetic points match those trained on the real ones within 0.00002 log loss.
- On 2024-25, the synthetic T-24h line scores 0.5743 through the consensus stack and 0.5705 through the open-trained
  stack, a difference of +0.0038.
- Every k gives the same weights as the snapshot stacks. The k grid does not matter.

T14 gives the stack weights: logit p = w_line logit(line) + w_ml logit(ML v2 logistic), with inputs clipped to
[0.01, 0.99].

| stack | training points | line de-vig | fit 2019-2023 (validation) | production 2019-2025 |
|---|---|---|---|---|
| open_trained | [0] | multiplicative (single-book opener) | [0.660597, 0.579471] | [0.615703, 0.728916] |
| consensus | [4, 5, 6, 7, 8] | power de-vig of BFO mean decimal odds | [0.788425, 0.389418] | [0.725991, 0.542831] |
| close_trained | [9] | power de-vig of BFO mean decimal odds | [0.779758, 0.330967] | [0.720735, 0.480053] |

- The production refit follows tools/ml2.py's page procedure: 2019-2025, with OOF predictions for 2019-2023 and
  monthly-rolling ones for 2024-2025. It is deployment, not selection, and is never scored.
- The 2019-2023 open and close weights reproduce the forward ledger's ml2_stack_open (0.6596, 0.5825) and
  ml2_stack_close (0.7733, 0.3397) to within the row difference: the full-trajectory rows number 1,951 against ml2's
  1,999.

T15 compares the stacks with the raw close:

| stack | CV 2021-23 | 2024-25 |
|---|---|---|
| open-trained fed the opener | +0.0045 [-0.0053, +0.0138] | -0.0050 [-0.0167, +0.0064] |
| consensus fed point 1 | -0.0016 [-0.0088, +0.0053] | -0.0036 [-0.0122, +0.0053] |
| consensus fed point 4 | -0.0022 [-0.0086, +0.0043] | -0.0075 [-0.0152, +0.0005] |
| consensus fed point 8 | -0.0032 [-0.0088, +0.0019] | -0.0106 [-0.0167, -0.0040] |
| consensus fed point 9 | -0.0022 [-0.0074, +0.0026] | -0.0128 [-0.0176, -0.0078] |

## 4. Q3: does movement add anything beyond the close?

T11 tests the winner beyond the close: free signs, no intercept; CV 2021-23 fit on 2019..Y-1; B8 uses CV 2022-23.

| variant | CV log loss | vs B0 |
|---|---|---|
| B0 close + ml2lr (free signs) | 0.61705 | +0.0000 [+0.0000, +0.0000] |
| B1 + opener | 0.61736 | +0.0003 [-0.0014, +0.0020] |
| B2 + point 8 (late steam) | 0.61702 | -0.0000 [-0.0007, +0.0006] |
| B3 + point 1 (first consensus) | 0.61635 | -0.0007 [-0.0024, +0.0009] |
| B4 + points 1 and 8 | 0.61669 | -0.0004 [-0.0022, +0.0014] |
| B5 + range spread x (close, ml2lr) | 0.61717 | +0.0001 [-0.0008, +0.0015] |
| B6 + \|open-close move\| x (close, ml2lr) | 0.61773 | +0.0007 [-0.0008, +0.0023] |
| B7 + \|late move\| x (close, ml2lr) | 0.61842 | +0.0014 [-0.0017, +0.0043] |
| B8 + per-book sd x (close, ml2lr) [2021+; CV 2022-23] | 0.6088 | +0.0003 [-0.0001, +0.0006] |

B3 minus B0 on 2024-25 is +0.0010 [-0.0012, +0.0033] (n 833). This agrees with research/model_market.md: movement
adds nothing on top of the close.

T12 tests going to a decision beyond the decision prop: a logistic with an intercept (outcome-level, not corner-ordered;
the inputs are |close logit| and side-free move sizes). CV 2022-23, fit on 2021..Y-1.

| variant | CV log loss | vs D0 |
|---|---|---|
| D0 prop + \|close logit\| | 0.64824 |  |
| D + \|late move\| | 0.6488 | +0.0006 [-0.0002, +0.0013] |
| D + \|open-close move\| | 0.6485 | +0.0003 [-0.0028, +0.0033] |
| D + steam to favourite | 0.65054 | +0.0023 [-0.0010, +0.0059] |
| D + range spread | 0.64875 | +0.0005 [-0.0004, +0.0014] |
| raw decision prop (no refit) | 0.6454 |  |

T13 compares per-book closes with the consensus close, multiplicative de-vig for both:

| book | n 2021-23 | 2021-23 | n 2024-25 | 2024-25 |
|---|---|---|---|---|
| BetMGM | 1017 | +0.0014 [-0.0000, +0.0029] | 636 | +0.0009 [-0.0007, +0.0027] |
| BetRivers | 1023 | -0.0008 [-0.0020, +0.0004] | 820 | +0.0004 [-0.0013, +0.0023] |
| BetWay | 1213 | -0.0001 [-0.0015, +0.0013] | 824 | +0.0010 [-0.0011, +0.0033] |
| Caesars | 1028 | +0.0003 [-0.0010, +0.0018] | 819 | +0.0009 [-0.0009, +0.0026] |
| DraftKings | 1006 | +0.0005 [-0.0015, +0.0027] | 632 | -0.0004 [-0.0026, +0.0018] |
| FanDuel | 1160 | +0.0011 [-0.0003, +0.0027] | 827 | -0.0006 [-0.0017, +0.0006] |
| Unibet | 1017 | -0.0004 [-0.0015, +0.0009] | 325 | -0.0003 [-0.0020, +0.0014] |
| mean of the US books (>= 3 books) | 1166 | -0.0000 [-0.0001, +0.0001] | 827 | +0.0000 [-0.0001, +0.0001] |

## 5. Q4: routing for the forward package

| line captured | stack | line de-vig |
|---|---|---|
| single-book opener | open-trained | multiplicative |
| consensus at any time before the lock (T-24h included) | open-trained (fwd-4.1, unchanged) | multiplicative, as fwd-4.1; power ties in CV (+0.0003) |
| true close (backtests, results pages) | close-trained | power |
| no line | the no-line stack | - |

**Why no capture-time switch.**
- Among consensus lines, the timing of the training snapshot is worth at most 0.0005 (T7, T10).
- The one choice that mattered in CV, consensus-trained versus open-trained weights, reversed on 2024-25 (T9).
- What actually separates the stacks is how much they trust ML v2, and that drifts. In 2021-23 ML v2 alone was 0.013
  behind the close; in 2024-25 it tied it (T6).
- The routing question therefore reduces to the production drift rule (docs/V6_V10_PLAN.md 6.5.1) and the calib
  workstream's recalibration. A line-timing rule would just be a proxy for that.

**Not actionable.** On 2024-25, feeding the open-trained stack the power de-vig beat feeding it the multiplicative one:
+0.0014 [+0.0001, +0.0025] for multiplicative. CV calls it a tie (+0.0003), so nothing changes. It is a candidate
secondary column for the forward ledger, which never selects.

**What to add to docs/V6_V10_PLAN.md section 5 (do-not-do).** Do not train a stack on a consensus or T-k line, and do
not add a capture-time switch. Reason: it passed CV by -0.0012 and was contradicted on 2024-25 by +0.0041
[+0.0017, +0.0066].

## 6. Blind-test plugin

`tools/blindtest_plugins/linemove.py` registers three experimental models; none enters a default stack:
- `line_cons8`: the raw point-8 consensus;
- `linemove_cons`: the consensus stack fed point 8, January refit, with 2021-23 OOF history;
- `linemove_open_fed_cons`: the fwd-4.1 control.

`python3 tools/blindtest.py list` shows them. Each covers 833 window fights.

## 7. Exposures, caveats and open threads

- **Vault exposure (disclosed).** While checking the vault fight-list format for the `vault` stage, the second run
  printed one 2026 fight's stat line: the first row of backtest_vault.json, Hokit vs Freeman, Jan 24, 2026. No result
  field was printed, and nothing here uses it. The `vault` stage reads only id, date and names. Add it to the audit-1
  exposure list (V6_V10_PLAN 6.5.3).
- `linemove_vault.json` is in the vault directory, outside the repo: 373 fights, 371 with a trajectory. Exchanges are
  dropped.
- **This is not a fully independent check.** The 2024-25 window had already been scored for the ML v2 stacks
  (research/model_ml2.md). The ledger README's supporting check also read 2024-25, and its finding, open-trained
  weights at least as good, is what this look reproduces. The vault audit and the forward ledger are the clean tests.
- **ML v2's OOF features were CV-chosen on years that include 2021-23**, so the CV numbers are slightly optimistic for
  every stack alike.
- **ML v2 is computed as of fight day, not as of the opener** (verifier). The median opener is about 48 days before the
  event. Rating systems that propagate other fighters' results (WHR, Glicko-2) can update in between, so the Q1 "model
  leads the opener" numbers may include a little information the market did not have at the open. The fighters'
  own records do not change in that window, so the effect should be small. It was not quantified.
- **Open thread: real T-k data.** Archive timestamped consensus snapshots for every forward-ledger card: T-7d, T-72h,
  T-24h, T-6h and the close, with `captured_utc`, mean and per-book. That would let a matched regime be fit on genuine
  capture times once that data unseals after audit 2.
- **Open thread: a sharp book.** A licensed or permitted Pinnacle or Circa history would allow the sharp-versus-
  recreational test that this data cannot run.

## Reproduce

```
nice -n 5 python3 tools/linemove.py all          # build timing q1 stacks beyond addendum export (pre-2024 + export)
nice -n 5 python3 tools/linemove.py verify       # verifier block (V1-V4) -> linemove.json "verification"
python3 tools/linemove.py tables                 # every table above, V1-V4 at the end
python3 tests/test_linemove.py                   # protocol, weights, test vectors, corner swap, verdict wiring
python3 tools/blindtest.py list                  # plugin registration
# the two 2024-25 looks (already run once each; listed for the record):
#   python3 tools/linemove.py valid              (PREREG, fb65a93)
#   python3 tools/linemove.py valid_addendum     (PREREG_ADDENDUM, 5a08703)
nice -n 5 python3 tools/linemove.py vault        # 2026 trajectories -> the vault dir (outside the repo)
```

## Verification log

Adversarial verifier, Nov 6, 2026, about 11:15 pm UTC. Verdict: **the builder's decision stands. Nothing enters
production (adopt = false), and fwd-4.1's routing is unchanged.**
- Every gated and confirmed number reproduces from the raw CSVs with independent code.
- No look-ahead, no 2026 data in any fit, and no selection on 2024-25 was found.
- One measurement defect (T4's CLV benchmark) and four overstated claims were corrected in the text above.

**What was re-done independently.** Scripts are in the session scratchpad (`vf_linemove/vf1_build.py` ..
`vf4_clv.py`). They do not import tools/linemove.py or tools/market.py.

1. **Parser and join.**
   - Own reader of `data/raw/odds/bfo_fighter_lines.csv`: rows dated 2026+ and undated rows are skipped at read.
   - Own name/date matcher against the ufcstats fights, and own power and multiplicative de-vig.
   - Result: on the 4,000 fights both pipelines cover, the matchup id agrees in every case and every trajectory point is
     identical (max abs diff 0).
   - The 145 trajectories only linemove has come from market.py's nlbair crosswalk: name changes and reversed names
     (Pennington/Torres, Chookagian/Cerminara, Zhang Weili, "King" Green, Jacare Souza ...).
   - Those rows are correctly oriented. Their close correlates 0.9999 with market.json's close, and corr(logit close,
     logit ML v2) is 0.754 against 0.802 for the rest.
   - Matcher passes 2 and 3 (rescheduled and undated "Future Events" matchups) contribute 8 of 5,739 matches, so the
     risk of attaching a cancelled booking's line is negligible.
2. **Stack gate and both 2024-25 comparisons.** Own non-negative no-intercept logistic (no ridge) and own card
   bootstrap (different seed):

   | comparison | builder | verifier |
   |---|---|---|
   | CV gate: consensus S4-8 minus open-trained, fed power 4-9 | -0.0012 [-0.0033, +0.0009] | -0.0012 [-0.0034, +0.0009] |
   | CV: consensus minus fwd-4.1 as run (open fed multiplicative) | -0.0015 [-0.0035, +0.0005] | -0.0015 [-0.0036, +0.0005] |
   | CV: open fed multiplicative minus fed power | +0.0003 [-0.0006, +0.0011] | +0.0003 [-0.0006, +0.0011] |
   | 2024-25 PRIMARY (static) | +0.0041 [+0.0017, +0.0066] | +0.0042 [+0.0017, +0.0065] |
   | 2024-25 as run (static) | +0.0028 [-0.0001, +0.0059] | +0.0028 [-0.0001, +0.0059] |
   | 2024-25 close-trained minus consensus, fed the close | +0.0020 [+0.0009, +0.0031] | +0.0020 [+0.0011, +0.0030] |
   | weights 2019-23 (line, ML v2): open / consensus / close | 0.661, 0.579 / 0.788, 0.389 / 0.780, 0.331 | 0.662, 0.580 / 0.791, 0.389 / 0.782, 0.330 |

   Both 2024-25 inputs are ML v2's annual-refit OOF for 2019-2023 (`lr|oof`, verified in tools/ml2.py
   `expert_table`) and the static fit before 2024 for 2024-25. No stack weight sees a test-year outcome.
3. **Protocol and timeline (git).**
   - PREREG was committed in fb65a93 at 22:23:05 UTC; valid.json was written at 22:24:01.
   - PREREG_ADDENDUM was committed in 5a08703 at 22:34:14; valid_addendum.json was written at 22:34:21.
   - Both pre-registration texts in linemove.json are byte-identical to their commits.
   - The tool's CV stages were not changed after the looks. Only export, vault and tables were added.
   - `beyond.json` was re-written at 22:41:55, after the looks, but is byte-identical to the exported copy. It was a
     deterministic re-run, and the chosen set (S4-8) did not change.
   - linemove.json holds no 2026 date. The 2026 trajectories are only in the vault directory outside the repo.
   - Pre-existing and not linemove's doing: the tracked CSVs `data/raw/odds/bfo_*.csv` contain 2026 rows from the
     market workstream. Every linemove reader drops them at parse.
4. **Corner order (free-intercept check, table V3).**
   - A wins 56.7% of the CV fights.
   - A free intercept (about +0.11 to +0.16) would lower CV log loss by about 0.0013 for every stack alike.
   - The shipped stacks have no intercept and odd inputs, so the corner swap is exact (2.2e-16) and the ordering is not
     exploited.
5. **Matching bias (table V4).** Missing fights are dropped from every arm, so paired comparisons are unaffected. The
   21 missing 2024-25 fights are hard for ML v2 (log loss 0.77), so absolute ML v2-versus-close numbers on the 833 rows
   flatter ML v2. A caveat was added at T7.

**Defects found and fixed:**
- **T4 CLV benchmark (measurement defect, report-level).** "CLV minus both sides" prices the close with the power
  de-vig and the bet with its proportional vig. A favourite rule therefore scores about +0.03 at points 1-8, and ML v2
  (34-45% favourites) is biased down.
  - The tool gained a `verify` stage (de-vig-consistent fair CLV and favourite baselines; table V2), and the readings
    were corrected.
  - The opener result stands. The "zero or negative by point 8" claim did not: ML v2's side there is small and positive,
    and no better than backing the favourite.
- **Overstatements corrected:**
  - cross-feed spread "at most 0.0005": 0.0003 for training points 1-8, and 0.0008 with the close-trained row;
  - weights "within about 0.02": the ML v2 weight spans 0.33-0.40;
  - the T3 "corr ... CV" column is a pooled 2015-23 correlation;
  - "after vig" was wrong: the measure nets out the vig.
- **Q1 robustness added (table V1).** The model-gap R^2 is not opener mean reversion: level alone explains 0.020,
  level plus ML v2 0.268.
- **Caveat added.** ML v2 is computed as of fight day, not as of the opener, so a little post-open information may
  reach it through rating propagation.
- **Tool.** `export` now keeps the `verification` block on re-export, and `tables` prints V1-V4. No CV, gate or 2024-25
  number changed. `python3 tests/test_linemove.py` still passes 14,238 checks.

**Not verified.** The builder's statements that BFO's history endpoint is obfuscated, that fightodds.io's terms render
only client-side, and the User-Agent used for the robots.txt and bfo.min.js fetches.
- The cached robots.txt allows everything except /cnadm/. linemove.py itself makes no network requests.

**Adopt decision: false.**
- The consensus or T-k stack passed the pre-2024 gate only by the 0.0005 point rule; its CI included 0.
- Its pre-registered 2024-25 primary was contradicted, and it fails the 6.3 "not worse" tolerance.
- Movement and dispersion add nothing beyond the close.
- The proposed do-not-do entry is supported: no consensus or T-k training, no capture-time switch, no movement or
  dispersion on top of the close. So is archiving timestamped snapshots in the forward ledger.

### Verifier tables (from `python3 tools/linemove.py tables`)

V1 Q1 baseline, out-of-sample R^2 of the move to the close (CV 2019-23 / 2024-25):

| from point | line level only | ML v2 gap only (M1) | level + ML v2 | corr(move, gap) pooled <= 2023 / 2019-23 |
|---|---|---|---|---|
| 0 | 0.020 / 0.102 | 0.222 / 0.142 | 0.268 / 0.315 | 0.443 / 0.502 |
| 1 | 0.020 / 0.060 | 0.111 / 0.060 | 0.172 / 0.194 | 0.326 / 0.351 |
| 4 | 0.009 / 0.048 | 0.082 / 0.033 | 0.134 / 0.148 | 0.284 / 0.301 |
| 8 | 0.010 / 0.019 | 0.033 / 0.010 | 0.075 / 0.064 | 0.183 / 0.194 |

V2 CLV neutrality. "T4" is the builder's CLV minus both sides. "Fair" uses multiplicative no-vig at point s and at the
close.

| period | point | ML v2 fav. share | ML v2 T4 | favourite T4 | ML v2 fair | favourite fair | ROI ML v2 minus favourite |
|---|---|---|---|---|---|---|---|
| 2019-23 | 0 | 0.45 | +0.075 [+0.067, +0.082] | +0.011 [+0.002, +0.019] | +0.076 [+0.068, +0.086] | -0.006 [-0.012, -0.000] | +0.073 [+0.005, +0.142] |
| 2019-23 | 1 | 0.41 | +0.027 [+0.022, +0.033] | +0.029 [+0.024, +0.035] | +0.026 [+0.020, +0.032] | +0.005 [+0.001, +0.009] | +0.025 [-0.039, +0.089] |
| 2019-23 | 4 | 0.41 | +0.017 [+0.012, +0.022] | +0.030 [+0.025, +0.035] | +0.017 [+0.011, +0.022] | +0.005 [+0.002, +0.008] | +0.004 [-0.060, +0.071] |
| 2019-23 | 8 | 0.40 | +0.002 [-0.001, +0.006] | +0.031 [+0.028, +0.034] | +0.005 [+0.002, +0.009] | +0.006 [+0.004, +0.009] | +0.016 [-0.048, +0.077] |
| 2024-25 | 0 | 0.41 | +0.060 [+0.046, +0.073] | +0.044 [+0.030, +0.056] | +0.054 [+0.040, +0.070] | +0.010 [+0.001, +0.019] | +0.098 [-0.001, +0.201] |
| 2024-25 | 1 | 0.38 | +0.025 [+0.014, +0.036] | +0.057 [+0.046, +0.068] | +0.020 [+0.009, +0.031] | +0.018 [+0.011, +0.026] | +0.059 [-0.047, +0.167] |
| 2024-25 | 4 | 0.36 | +0.016 [+0.007, +0.025] | +0.052 [+0.042, +0.061] | +0.013 [+0.004, +0.023] | +0.014 [+0.007, +0.021] | +0.053 [-0.046, +0.160] |
| 2024-25 | 8 | 0.34 | -0.007 [-0.013, -0.000] | +0.043 [+0.036, +0.048] | +0.004 [-0.003, +0.010] | +0.009 [+0.005, +0.013] | +0.027 [-0.083, +0.141] |

V3 free-intercept check, CV 2021-23, stacks fed point 8 (A wins 0.567):

| stack | intercept by CV year (2021, 2022, 2023) | with intercept minus without |
|---|---|---|
| open-trained | 0.156, 0.120, 0.119 | -0.0014 [-0.0047, +0.0020] |
| consensus | 0.147, 0.108, 0.114 | -0.0013 [-0.0044, +0.0017] |
| close-trained | 0.143, 0.107, 0.117 | -0.0013 [-0.0044, +0.0017] |

V4 decisive evaluation fights without a full trajectory:

| period | missing / of | A wins missing / present | ML v2 LL missing / present | missing with a close |
|---|---|---|---|---|
| 2019-23 | 4 / 1955 | 0.500 / 0.571 | 0.4223 / 0.6360 | 4 |
| 2024-25 | 21 / 854 | 0.381 / 0.545 | 0.7748 / 0.5840 | 12 |
