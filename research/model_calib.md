# Calibration and drift (task key: calib)

Nov 6, 2026, ~10:45 pm UTC. Code: `tools/calib.py`. Output: `data/derived/calib.json`. Pre-registration:
`data/derived/calib_prereg.json` (commit 5878b25, 10:36 pm UTC, before the single 2024-25 look). Runtime function:
`src/ml/calib.js` (Python twins in tools/calib.py). Tests: `tests/test_calib.js` (14 checks). Blind-test plugin:
`tools/blindtest_plugins/calib.py`.

## Bottom line

1. **Do not add a recalibration. Nothing earns one before 2024.** I tested six families: recency half-life
   refits, per-card walk-forward refits, trailing temperature (= symmetric beta calibration), annual temperature, an odd
   curvature term `a z + b z|z|`, and segment-specific temperatures. That is 105 configurations, run on four heads (the
   no-line, open and close ML v2 page stacks plus the ML v2 logistic) in two universes.
   - Nothing beats the shipped incumbent on the forward-chained 2021-2023 gate by ml2's 0.0005 rule.
   - Even a configuration picked on the gate itself gains at most -0.0008 (T3a/T3b).
   - Every production spec in calib.json is therefore `{type: "none"}`, and `Calib.apply` is the identity.
2. **Before 2024, the year-to-year drift in calibration was noise you could not exploit.**
   - **Rating systems and both lines:** their yearly slopes (2012-2023) spread no more than one year's sampling noise
     (excess sd 0 to 0.05). The lag-1 correlation of log slopes is -0.23 to +0.40.
   - **ML fits, the market rating and the stacks:** they show some excess spread (0.11-0.24). Most of it is the
     small-sample overconfidence of the 2012-2016 fits plus one episode. In 2017 the tuned rating systems (WHR,
     Glicko-2, Elo-full, TrueSkill 1.08-1.27), the market rating, ML and stack families were underconfident (no-line
     stack 1.73) while the close was not (0.97); plain Elo (0.71) and strike Elo (0.92) were not underconfident
     either (verifier correction). It reverted by 2019 (0.81).
   - **Rescaling by last year's slope:** it never helped any family significantly in 2014-2023 (T2; point estimates
     as low as -0.0017, every CI includes 0). For the no-line stack it hurt: +0.0033 [+0.0002, +0.0064].
3. **2024-25, scored once: the choice is the incumbents** (T5). They reproduce ml2's published static numbers.
   - The no-line stack is 0.0004 apart: 0.5894 here vs 0.5890 in ml2, because market.json has no market rating for
     9 of the 854 fights, which ml2's stack entered as logit 0 (see Caveats; verifier correction).
   - The close stack beats the close by -0.0096 [-0.0141, -0.0052].
   - Across families, the 2024-25 shift was larger than anything in 2012-2023 (like-for-like, verifier correction).
     The mean log slope over the 11 families with every year from 2014 to 2025 was +0.268 in 2024 and +0.310 in
     2025 (slope 1.31 / 1.36). The highest earlier year was +0.124 (2022). Pooled 2024-25 slopes were 1.36-1.54 for
     the rating, market-rating and ML families (Elo and strike Elo 1.13-1.14). Single families had reached those
     levels before: the market rating was at 1.38 in 2022 and 1.55 [1.16, 1.98] in 2023, the open at 1.49 in 2022,
     and the no-line stack at 1.73 in 2017. The close stayed at 1.13 / 1.09.
4. **For the record only (cannot change anything): a per-card trailing temperature would have hedged 2024-25.**
   - The temperature family's 2016-2020 choice refits before every card on the last 200-400 scored bouts, with a
     N(1, 0.15²) prior.
   - On the 2021-2023 gate it scored -0.0004 to +0.0008 against the incumbents, and cost +0.0004 to +0.0008 against
     its own uncalibrated base.
   - On 2024-25 it scored -0.0047 [-0.0089, -0.0003] (no line), -0.0024 (open, n.s.), -0.0017 (close stack, n.s.)
     and -0.0035 [-0.0060, -0.0009] (ML v2 logistic) against the static incumbents. Against ml2's own rolling refits it
     was -0.0009 to -0.0031, and only the ML v2 logistic's CI excludes 0 (-0.0031 [-0.0052, -0.0004]). The other
     three include 0 (verifier). So most of the hedge against the static incumbents comes from refitting on 2024-25
     outcomes at all, not from the temperature form.
   - These are 24 descriptive rows (6 families x 4 heads) on an episode already known before this work began
     (BACKLOG: "every input became underconfident in 2024-25"). Picking the best of them is a 2024-25 selection.
   - That is one episode, already seen, so it is not adoptable. It is a candidate for v9 to pre-register as an
     insurance arm whose clean test is the forward ledger or vault audit 2.
5. **Segments:** women's bouts (slope 0.71-0.88) and five-rounders (0.74-0.89) look overconfident before 2024.
   No-line newcomer bouts look underconfident (1.17-1.20). Only 2 of the 24 segment-by-head CIs exclude 1 (open stack,
   women 0.71 [0.46, 0.97]; close stack, debut 1.28 [1.08, 1.50]). Chance alone would give about 1.2 (verifier). Segment temperatures still fail the gate: the best gain is
   -0.0004 for the open stack, and the line-stack "five" cell is -0.0002.
6. **Consistency with the PRE-REGISTERED production drift rule** (docs/V6_V10_PLAN.md 6.5.1):
   - My results agree with its default, which is to change nothing. The rule's expected cost is small in every
     scenario: regret at most 0.0019 log loss against the better of the two settings (T4).
   - It has three properties v9 should fix. None of them changes the rule before audit 1.
     - **(i) The threshold sits on a sharpened stack.** The production no-line stack (fit 2019-2025, h 1.5) is 1.22x
       sharper than the validated one. If 2026 repeats 2024-25 (validated-scale slope 1.37), its slope is about 1.11
       and rule (a) switches with probability 0.60, although switching then costs 0.0010. Switching pays only below a
       production slope of about 0.97, not 1.15.
     - **(ii) "CI includes 1" excludes the failure the rule exists for.** A clearly over-sharp production stack
       (validated-scale slope 0.9, production about 0.73) has a CI that excludes 1 from below. Rule (a) then switches
       only 43% of the time, although switching helps most there (-0.0022).
     - **(iii) Rule (b) is not a test.** A trailing-200 slope has a Wald CI of about ±0.46, so its CI includes 1
       almost always. In every scenario from slope 1.0 to 1.6, rule (b) fires at its first opportunity with probability
       0.60-0.91 and within four checks with probability 0.85-0.99. That includes persistent 2024-25-like
       underconfidence (0.88 / 0.98). The 2015-2023 replay had the CI include 1 at 31 of 36 quarterly checks. At 40-50
       ledger bouts a month from Nov 7, 2026, the first ready check falls on 2027-03-31 or 2027-06-30, and the switch
       most likely one quarter later.
     - The rule's text also does not name which ledger column is "the production no-line stack". fwd-4.1's
       `p_a_noline` is the MoE stack (h 1.5, T 1.17); `ml2_stack_noline_prod` is the ML v2 page stack. v9 should name
       one.
7. **The deliverable function:** `Calib.apply`, `Calib.fit`, `Calib.fitFromHistory`, `Calib.monitor` and `Calib.ruleB`
   (src/ml/calib.js), with Python twins `apply_spec`, `fit_spec`, `fit_from_history`, `slope_monitor` and
   `drift_rule_b`.
   - The test checks that the JS reproduces Python to 2e-16, that a corner swap gives exactly 1 - p, and that the
     production specs are the identity.
   - `ruleB` turns the ledger's scored bouts into the rule 6.5.1 (b) state ("h1.5" or "h3_T1"). The forward package
     can call it today without any behaviour change.

## What the task asked, and where it is answered

| item | answer | where |
|---|---|---|
| (1) rolling-origin drift of calibration slopes by family, inside 2010-2023 | T1 (slopes by year, persistence, noise vs excess), co-movement, T2 (trailing temperature per family) | `tools/calib.py drift` |
| (2) recalibration candidates chosen by rolling-origin CV within <= 2023 | T3a (backtest universe), T3b (all decisive fights, debut bouts included); nothing passes | `tools/calib.py cv [--universe all]` |
| (3) the chosen scheme's 2024-25 score, once | T5, after the committed pre-registration | `tools/calib.py prereg` → commit → `tools/calib.py confirm` |
| (4) consistency with the pre-registered drift rule | T4 plus the replay; findings (i)-(iii) above | `tools/calib.py rule` |
| (5) a tested function for the forward package and predict() | src/ml/calib.js + tools/calib.py; tests/test_calib.js | `node tests/test_calib.js` |

## Data and heads

- **Table.** 4,280 backtest-universe decisive fights from 2012-2023 (both men had a prior UFC fight), plus 2024-2025
  for the confirm stage only. Inputs are tools/ml2.py's verified caches: Elo, strike-share Elo, the four tuned rating
  systems, the market rating, ML v1 logistic, ML v2 logistic and blend (annual expanding refits = out of fold).
  - Lines come from market.json for 2019+ dev fights and from nlbair (BestFightOdds no-vig) before that.
  - Every row dated 2026-01-01 or later is dropped at parse, and both the drift and cv stages assert that.
  - The `all` universe adds debut bouts: 2,348 inner and 1,507 gate rows for the no-line head, against 1,824 / 1,224.
- **Heads and incumbents.** The ML v2 page stacks are no-line (ML v2 logistic + market rating, h 1.5), open (opener +
  ML v2 logistic) and close (close + ML v2 logistic). Each is refit with ml2's own stack code (`ml2.stack_fit`,
  `ml2.rec_w`) on 2019..Y-1, exactly as ml2's stack CV did. The fourth head is the ML v2 logistic as published.
- **Symmetry.** Every recalibration is an odd function of the logit: there is no intercept, and the segment flags are
  corner-symmetric. A corner-swap test runs end to end, with fits that see the swapped outcomes; the max is
  |p + p_swapped - 1| = 4.4e-16. CIs come from an event-cluster bootstrap with 2,000 resamples of cards, paired for
  differences. Slope CIs use 400 resamples, each refit.

## 1. Drift of calibration slopes, 2012-2023

### T1. Mirrored calibration slope by year, 2012-2023 (backtest universe, out of sample; > 1 = underconfident)

| family | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | pooled | lag-1 corr | sd log | noise sd | excess sd |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| elo | 0.92 | 0.88 | 1.36 | 0.79 | 1.03 | 0.71 | 0.56 | 0.32 | 0.87 | 0.97 | 1.01 | 0.77 | 0.84 | 0.249 | 0.325 | 0.464 | 0.0 |
| elo_sig | 1.21 | 1.11 | 1.09 | 1.03 | 0.73 | 0.92 | 0.98 | 0.81 | 0.89 | 0.89 | 1.04 | 0.90 | 0.96 | 0.166 | 0.129 | 0.266 | 0.0 |
| whr | 0.77 | 1.05 | 1.15 | 1.04 | 0.90 | 1.27 | 0.95 | 0.97 | 0.96 | 1.07 | 1.22 | 1.04 | 1.04 | -0.233 | 0.132 | 0.222 | 0.0 |
| glicko2 | 0.60 | 0.89 | 1.11 | 0.92 | 0.75 | 1.08 | 0.89 | 0.93 | 0.87 | 0.98 | 1.06 | 1.10 | 0.94 | 0.214 | 0.19 | 0.254 | 0.0 |
| elo_full | 0.59 | 0.85 | 1.05 | 0.92 | 0.78 | 1.10 | 0.92 | 1.01 | 0.91 | 1.00 | 1.04 | 1.09 | 0.96 | 0.361 | 0.199 | 0.263 | 0.0 |
| trueskill | 0.62 | 0.86 | 1.02 | 0.94 | 0.85 | 1.12 | 0.95 | 1.06 | 0.89 | 1.03 | 1.11 | 1.09 | 0.98 | 0.395 | 0.176 | 0.255 | 0.0 |
| mkt_rating |  | 0.98 | 0.82 | 0.85 | 0.75 | 1.24 | 1.19 | 0.69 | 1.14 | 0.96 | 1.38 | 1.55 | 1.02 | 0.136 | 0.246 | 0.215 | 0.119 |
| ml1 | 0.44 | 1.02 | 0.66 | 0.79 | 0.88 | 1.41 | 1.13 | 0.85 | 0.90 | 0.95 | 1.00 | 1.00 | 0.90 | 0.035 | 0.279 | 0.202 | 0.192 |
| ml2lr | 0.48 | 1.01 | 0.65 | 0.75 | 0.78 | 1.33 | 1.11 | 0.82 | 0.95 | 0.93 | 1.05 | 0.98 | 0.88 | 0.011 | 0.256 | 0.196 | 0.164 |
| ml2 |  |  |  |  |  |  |  | 0.86 | 1.05 | 0.97 | 1.09 | 1.05 | 1.00 |  |  |  |  |
| close |  | 1.19 | 0.98 | 0.75 | 1.05 | 0.97 | 1.15 | 1.02 | 0.98 | 0.96 | 1.16 | 1.02 | 1.01 | -0.103 | 0.119 | 0.154 | 0.0 |
| open |  | 1.45 | 1.33 | 0.93 | 0.90 | 1.14 | 1.00 | 1.04 | 1.21 | 0.95 | 1.49 | 1.05 | 1.12 | -0.087 | 0.17 | 0.163 | 0.047 |
| stack_noline |  |  | 0.48 | 0.95 | 0.98 | 1.73 | 1.19 | 0.81 | 1.03 | 0.99 | 1.14 | 1.04 | 0.92 | 0.154 | 0.306 | 0.186 | 0.243 |
| stack_open |  |  | 0.65 | 0.69 | 0.77 | 1.20 | 1.07 | 0.91 | 1.07 | 0.94 | 1.24 | 0.97 | 0.89 | 0.449 | 0.212 | 0.17 | 0.126 |
| stack_line |  |  | 0.63 | 0.72 | 1.02 | 1.13 | 1.16 | 0.94 | 0.97 | 0.94 | 1.13 | 1.00 | 0.92 | 0.607 | 0.188 | 0.154 | 0.108 |

How to read T1:
- **Columns.** "noise sd" is the median sampling sd of one year's log slope, from the slope CI. "excess sd" is
  sqrt(max(0, sd log² - noise sd²)). stack_* are the ML v2 page stacks refit each year on 2013..Y-1. Rows with fewer
  than 120 fights are left out.
- **Co-movement 2014-2023 (14 families).** PC1 explains 0.50 of the year-to-year variation. Mean log slope by year:
  2014 -0.121, 2015 -0.158, 2016 -0.148, 2017 +0.134, 2018 +0.004, 2019 -0.174, 2020 -0.032, 2021 -0.031,
  2022 +0.131, 2023 +0.031.
- **Weak predictors.** Elo (tools/ml.py, 400 scale) scores about 0.68-0.70 log loss, so its slope is barely
  identified: its 2019 CI is [-0.30, 0.87].
- **Tuning windows.** The rating systems' and the market rating's scale parameters were tuned by their own tools on
  2019-2023, so their near-1 slopes there are partly by construction. 2012-2018 is the cleaner view of their drift.

**Reading.** Before 2024 the families moved together (PC1 0.50), but in short swings that reverted: up in 2017 and
2022, down in 2014-16 and 2019. Last year's slope did not predict this year's. For ratings and lines the spread is
within sampling noise. The early ML and stack overconfidence (2012-2016, slopes 0.44-0.79) is a learning-curve effect
of fits on a few hundred fights, not drift.

### T2. Trailing temperature (mirrored slope of the previous 1 / 2 / 4 years) vs the raw predictions, log loss

| family | 1 y, 2014-23 | 1 y, 2021-23 | 2 y, 2014-23 | 4 y, 2014-23 | 4 y, 2021-23 |
|---|---|---|---|---|---|
| elo | +0.0000 [-0.0015, +0.0017] | +0.0001 [-0.0005, +0.0007] | -0.0001 [-0.0014, +0.0013] | +0.0000 [-0.0010, +0.0012] | +0.0009 [-0.0018, +0.0036] |
| elo_sig | +0.0001 [-0.0007, +0.0010] | +0.0001 [-0.0009, +0.0012] | +0.0001 [-0.0007, +0.0009] | +0.0001 [-0.0006, +0.0007] | -0.0000 [-0.0012, +0.0011] |
| whr | +0.0006 [-0.0003, +0.0016] | +0.0001 [-0.0016, +0.0020] | +0.0004 [-0.0003, +0.0011] | +0.0001 [-0.0002, +0.0004] | -0.0000 [-0.0005, +0.0005] |
| glicko2 | +0.0004 [-0.0006, +0.0014] | +0.0001 [-0.0014, +0.0015] | +0.0004 [-0.0005, +0.0013] | +0.0002 [-0.0007, +0.0012] | +0.0003 [-0.0006, +0.0013] |
| elo_full | +0.0004 [-0.0004, +0.0013] | +0.0000 [-0.0010, +0.0011] | +0.0003 [-0.0005, +0.0011] | +0.0002 [-0.0007, +0.0012] | +0.0001 [-0.0003, +0.0004] |
| trueskill | +0.0004 [-0.0004, +0.0012] | +0.0001 [-0.0015, +0.0016] | +0.0002 [-0.0004, +0.0009] | +0.0002 [-0.0006, +0.0010] | +0.0000 [-0.0002, +0.0002] |
| mkt_rating | +0.0004 [-0.0012, +0.0021] | -0.0017 [-0.0044, +0.0011] | +0.0003 [-0.0009, +0.0015] | +0.0001 [-0.0008, +0.0011] | -0.0000 [-0.0004, +0.0004] |
| ml1 | +0.0007 [-0.0011, +0.0026] | +0.0000 [-0.0012, +0.0012] | +0.0003 [-0.0015, +0.0021] | +0.0001 [-0.0017, +0.0017] | +0.0002 [-0.0007, +0.0011] |
| ml2lr | +0.0008 [-0.0015, +0.0030] | +0.0002 [-0.0009, +0.0012] | -0.0000 [-0.0023, +0.0023] | -0.0004 [-0.0027, +0.0018] | +0.0003 [-0.0006, +0.0011] |
| ml2 | +0.0005 [-0.0008, +0.0017] | +0.0002 [-0.0008, +0.0011] | +0.0003 [-0.0009, +0.0015] | +0.0005 [-0.0008, +0.0017] | +0.0002 [-0.0006, +0.0009] |
| close | +0.0010 [-0.0005, +0.0024] | +0.0006 [-0.0010, +0.0023] | +0.0008 [-0.0003, +0.0020] | +0.0007 [-0.0003, +0.0018] | -0.0001 [-0.0006, +0.0005] |
| open | +0.0017 [-0.0006, +0.0042] | +0.0040 [-0.0008, +0.0090] | +0.0007 [-0.0013, +0.0028] | +0.0008 [-0.0013, +0.0029] | -0.0001 [-0.0019, +0.0017] |
| stack_noline | +0.0033 [+0.0002, +0.0064] | +0.0002 [-0.0009, +0.0013] | +0.0037 [+0.0006, +0.0070] | +0.0048 [+0.0020, +0.0076] | +0.0003 [-0.0010, +0.0015] |
| stack_open | +0.0004 [-0.0025, +0.0033] | +0.0022 [-0.0001, +0.0047] | +0.0000 [-0.0029, +0.0028] | +0.0004 [-0.0025, +0.0034] | +0.0003 [-0.0004, +0.0011] |
| stack_line | +0.0002 [-0.0027, +0.0027] | +0.0007 [-0.0008, +0.0023] | +0.0007 [-0.0022, +0.0032] | +0.0015 [-0.0014, +0.0042] | +0.0001 [-0.0004, +0.0007] |

Negative = the rescaled predictions are better. No family improves significantly on any window: every CI includes 0,
and the most negative point estimate is -0.0017. The ML and stack families' 2014-2016
overconfidence would look correctable in hindsight, but a temperature estimated from the year before does not track it.

## 2. Recalibration candidates, chosen by rolling-origin CV within 2023

**Design.** The decision rule was written into the code before any cv output was read
(`calib_prereg.json` `decision_rule`).
- **Inner origins, 2016-2020.** Per head and family, the hyper-parameters are chosen by pooled log loss on 2016-2020.
  Each year is predicted only from earlier fights, with per-card refits where the scheme refits per card.
- **Gate, 2021-2023.** The forward-chained years, as in ml2's stack gate.
- **Pass rule.** A family passes only if both its 2016-2020 choice and its best configuration on the gate beat the
  incumbent by more than 0.0005.
- **Grid (105 configurations).**
  - **recency:** the stack refit each January on 2013..Y-1 with calendar-year half-life h in {none, 8, 4, 3, 2, 1.5,
    1, 0.75, 0.5}.
  - **percard:** the same, refit before every card on exact ages.
  - **temp:** a per-card temperature on the long-history stack's out-of-sample logits. Half-life 0.5-8 y, or the last
    200 / 400 / 800 bouts. Prior on a: flat, or N(1, sd²) with sd 0.3, 0.15 or 0.08.
  - **temp_annual:** one temperature per January from the last 1, 2 or 4 years.
  - **odd:** `a z + b z|z|` with priors on a and b.
  - **segment:** `(a + Σ d_k s_k) z` over women, heavy (men 205+), newcomer (fewer-fight side has 1-2), debut, five
    rounds and bigfav (raw favourite at 75%+). The flags were tried all together and one at a time, with shrinkage
    priors.

### T3a. Rolling-origin CV, universe 'backtest': each family's 2016-2020 choice on the 2021-2023 gate

| head | incumbent 2021-23 (slope) | family | 2016-20 choice | vs incumbent | gate-best vs incumbent | vs own long base | slope 2021-23 | passes |
|---|---|---|---|---|---|---|---|---|
| noline | 0.62984 (1.077) | recency | `h=None` | +0.0003 [-0.0010, +0.0014] | -0.0008 `h=0.5` | +0.0004 [-0.0007, +0.0016] | 1.116 | no |
|  |  | percard | `h=None` | +0.0001 [-0.0010, +0.0013] | -0.0006 `h=1.0` | +0.0003 [-0.0008, +0.0014] | 1.107 | no |
|  |  | temp | `last_n=200,sd_a=0.15` | +0.0004 [-0.0007, +0.0016] | +0.0000 `half_life=1.0,sd_a=0.08` | +0.0006 [-0.0002, +0.0015] | 1.027 | no |
|  |  | temp_annual | `max_age=1.0` | +0.0000 [-0.0014, +0.0015] | -0.0001 `max_age=2.0` | +0.0002 [-0.0009, +0.0013] | 0.996 | no |
|  |  | odd | `half_life=1.0,sd_a=0.15,sd_b=0.05` | +0.0003 [-0.0006, +0.0011] | +0.0002 `half_life=2.0,sd_a=0.15,sd_b=0.05` | +0.0004 [-0.0001, +0.0010] | 1.034 | no |
|  |  | segment | `half_life=2.0,sd_a=0.15,sd_b=0.05,segs=all six` | +0.0001 [-0.0005, +0.0007] | +0.0001 `half_life=2.0,sd_a=0.15,sd_b=0.1,segs=all six` | +0.0003 [-0.0001, +0.0007] | 1.050 | no |
| | | **chosen** | none | | | | | |
| open | 0.62275 (1.046) | recency | `h=0.5` | +0.0024 [+0.0001, +0.0048] | -0.0008 `h=None` | +0.0032 [+0.0007, +0.0058] | 0.957 | no |
|  |  | percard | `h=0.75` | +0.0006 [-0.0022, +0.0034] | -0.0008 `h=None` | +0.0014 [-0.0013, +0.0040] | 0.985 | no |
|  |  | temp | `last_n=400,sd_a=0.15` | -0.0004 [-0.0020, +0.0013] | -0.0006 `half_life=0.5,sd_a=0.08` | +0.0004 [-0.0009, +0.0017] | 1.005 | no |
|  |  | temp_annual | `max_age=1.0` | +0.0015 [-0.0010, +0.0040] | -0.0005 `max_age=2.0` | +0.0022 [-0.0001, +0.0047] | 0.937 | no |
|  |  | odd | `half_life=1.0,sd_a=0.15,sd_b=0.05` | -0.0004 [-0.0015, +0.0008] | -0.0004 `half_life=1.0,sd_a=0.15,sd_b=0.05` | +0.0004 [-0.0004, +0.0012] | 1.019 | no |
|  |  | segment | `half_life=2.0,sd_a=0.15,sd_b=0.05,segs=all six` | -0.0004 [-0.0013, +0.0004] | -0.0007 `half_life=2.0,sd_a=0.15,sd_b=0.2,segs=all six` | +0.0003 [-0.0004, +0.0010] | 1.052 | no |
| | | **chosen** | none | | | | | |
| line | 0.61624 (1.051) | recency | `h=None` | -0.0004 [-0.0012, +0.0004] | -0.0004 `h=None` | +0.0000 [+0.0000, +0.0000] | 1.026 | no |
|  |  | percard | `h=None` | -0.0003 [-0.0012, +0.0008] | -0.0003 `h=None` | +0.0001 [-0.0001, +0.0004] | 1.021 | no |
|  |  | temp | `last_n=200,sd_a=0.15` | +0.0002 [-0.0012, +0.0017] | -0.0002 `half_life=0.5,sd_a=0.08` | +0.0006 [-0.0003, +0.0016] | 1.009 | no |
|  |  | temp_annual | `max_age=1.0` | +0.0003 [-0.0010, +0.0017] | -0.0003 `max_age=4.0` | +0.0007 [-0.0008, +0.0023] | 1.002 | no |
|  |  | odd | `half_life=1.0,sd_a=0.15,sd_b=0.05` | +0.0001 [-0.0010, +0.0013] | +0.0000 `half_life=2.0,sd_a=0.15,sd_b=0.05` | +0.0005 [-0.0002, +0.0012] | 1.012 | no |
|  |  | segment | `half_life=2.0,sd_a=0.15,sd_b=0.05,segs=all six` | -0.0000 [-0.0008, +0.0008] | -0.0002 `half_life=8.0,sd_a=0.15,sd_b=0.2,segs=five` | +0.0004 [-0.0002, +0.0009] | 1.032 | no |
| | | **chosen** | none | | | | | |
| ml2lr | 0.63147 (0.985) | recency | `h=1.0` | +0.0001 [-0.0010, +0.0012] | +0.0001 `h=1.0` | +0.0001 [-0.0010, +0.0012] | 1.035 | no |
|  |  | percard | `h=0.75` | +0.0012 [+0.0002, +0.0024] | +0.0005 `h=3.0` | +0.0012 [+0.0002, +0.0024] | 1.001 | no |
|  |  | temp | `last_n=200,sd_a=0.15` | +0.0008 [+0.0001, +0.0016] | +0.0002 `half_life=2.0,sd_a=0.08` | +0.0008 [+0.0001, +0.0016] | 0.978 | no |
|  |  | temp_annual | `max_age=4.0` | +0.0003 [-0.0006, +0.0011] | +0.0001 `max_age=2.0` | +0.0003 [-0.0006, +0.0011] | 1.012 | no |
|  |  | odd | `half_life=1.0,sd_a=0.15,sd_b=0.05` | +0.0005 [-0.0001, +0.0012] | +0.0004 `half_life=2.0,sd_a=0.15,sd_b=0.05` | +0.0005 [-0.0001, +0.0012] | 1.002 | no |
|  |  | segment | `half_life=8.0,sd_a=0.15,sd_b=0.2,segs=bigfav` | +0.0006 [-0.0020, +0.0030] | +0.0003 `half_life=8.0,sd_a=0.15,sd_b=0.2,segs=five` | +0.0006 [-0.0020, +0.0030] | 1.086 | no |
| | | **chosen** | none | | | | | |

Columns:
- **vs incumbent.** Log loss on 1,224 gate fights against ml2's own stack fit on 2019..Y-1. The ML v2 logistic head's
  incumbent is the model as published.
- **gate-best.** The best configuration on the gate itself, which is optimistic by construction.
- **vs own long base.** Descriptive: the scheme against its uncalibrated long-history stack.

On the 2021-2023 gate, every calibration-type scheme (temp, odd, segment) costs +0.0003 to +0.0008 against its own
base. That is the insurance premium in calm years.

### T3b. The same CV over all decisive fights (debut bouts included)

| head | incumbent 2021-23 (slope) | family | 2016-20 choice | vs incumbent | gate-best vs incumbent | passes |
|---|---|---|---|---|---|---|
| noline | 0.63149 (1.078) | recency / percard / temp / temp_annual / odd / segment | `h=None` / `h=None` / `last_n=400,sd_a=0.15` / `max_age=1.0` / `half_life=1.0,...` / `half_life=2.0,...,all six` | -0.0000 / -0.0001 / +0.0000 / +0.0001 / +0.0000 / -0.0000 | -0.0005 / -0.0006 / -0.0001 / -0.0003 / -0.0000 / -0.0000 | none |
| open | 0.62030 (1.058) | same order | `h=1.0` / `h=1.0` / `last_n=400` / `max_age=1.0` / odd / segment | +0.0002 / +0.0005 / +0.0007 / +0.0014 / +0.0003 / -0.0001 | -0.0002 / -0.0001 / +0.0001 / +0.0000 / +0.0002 / -0.0001 | none |
| line | 0.60502 (1.058) | same order | `h=None` / `h=None` / `half_life=0.5,sd_a=0.08` / `max_age=1.0` / odd / segment | -0.0001 / +0.0001 / +0.0002 / +0.0001 / +0.0004 / -0.0003 | -0.0001 / +0.0001 / +0.0002 / -0.0000 / +0.0003 / -0.0008 | none |
| ml2lr | 0.63304 (0.990) | same order | `h=1.5` / `h=0.75` / `half_life=0.5,sd_a=0.08` / `max_age=4.0` / odd / segment | +0.0001 / +0.0008 / +0.0002 / +0.0003 / +0.0004 / +0.0003 | +0.0001 / +0.0004 / +0.0001 / +0.0000 / +0.0003 / +0.0002 | none |

The full T3b with CIs comes out of `python3 tools/calib.py report`.

### Segment slopes before 2024

The table gives the long-history base, 2016-2023 pooled, with 400-resample event-cluster CIs, backtest universe. The
debut column comes from the `all` universe.

| head | all | women | heavy | newcomer | debut (all) | five | bigfav |
|---|---|---|---|---|---|---|---|
| noline | 1.07 [0.94, 1.18] n 3048 | 0.88 [0.56, 1.25] n 488 | 1.01 [0.75, 1.28] n 480 | 1.20 [0.99, 1.43] n 1092 | 1.14 [0.85, 1.43] n 807 | 0.89 [0.62, 1.19] n 369 | 0.97 [0.79, 1.17] n 354 |
| open | 1.00 [0.90, 1.11] n 3047 | 0.71 [0.46, 0.97] n 487 | 1.08 [0.81, 1.33] n 480 | 1.03 [0.85, 1.18] n 1092 | 1.09 [0.89, 1.29] n 796 | 0.74 [0.50, 1.00] n 369 | 1.03 [0.85, 1.26] n 439 |
| line | 1.03 [0.93, 1.14] n 3047 | 0.84 [0.60, 1.12] n 487 | 1.08 [0.84, 1.33] n 480 | 1.09 [0.92, 1.27] n 1092 | 1.28 [1.08, 1.50] n 796 | 0.78 [0.53, 1.03] n 369 | 1.03 [0.88, 1.20] n 548 |
| ml2lr | 0.97 [0.86, 1.09] n 3048 | 0.84 [0.53, 1.17] n 488 | 0.94 [0.69, 1.18] n 480 | 1.11 [0.92, 1.32] n 1092 | 1.04 [0.79, 1.30] n 807 | 0.80 [0.56, 1.10] n 369 | 0.86 [0.71, 1.06] n 453 |

**Reading the segments.**
- **The consistent ones.** Women's bouts and five-rounders lean overconfident in every head. The pre-2024 no-line
  stack leans underconfident on newcomers. The latter is the opposite of what the blind test saw on 2024-25 for the MoE
  no-line stack (0.81), so it is not a stable property.
- **Debut bouts.** The close-stack slope on debut bouts in the all universe, 1.28 [1.08, 1.50], is the only CI above
  1. One other CI excludes 1, from below: open stack, women 0.71 [0.46, 0.97]. Two of 24 cells is about what chance
  gives (verifier).
- **Segment temperatures.** Even estimated with shrinkage, they fail the 0.0005 gate in both universes. The do-not-do
  list already says no segment-specific temperatures, and this note confirms it with CV.

## 3. 2024-25, scored once

The pre-registration was written at 10:36:10 pm UTC and committed as 5878b25. The confirm stage refuses to run unless
calib_prereg.json is committed unchanged. tools/calib.py at that commit has sha256-16 3bb208dc89b4d856, the hash
recorded in the pre-registration. The look ran from 10:36:31 to 10:37:00 pm UTC.

### T5. 2024-2025 (backtest universe)

| head | n | chosen | log loss | slope | Brier | acc. | vs close | ml2 rolling refit (reference) |
|---|---|---|---|---|---|---|---|---|
| noline | 854 | none (incumbent) | 0.58940 | 1.359 | 0.20221 | 0.6850 | +0.0013 [-0.0147, +0.0164] | 0.58615 (slope 1.248) |
| open | 843 | none (incumbent) | 0.58115 | 1.313 | 0.19849 | 0.6999 | -0.0043 [-0.0157, +0.0067] | 0.57997 (slope 1.254) |
| line | 845 | none (incumbent) | 0.57574 | 1.171 | 0.19639 | 0.7077 | -0.0096 [-0.0141, -0.0052] | 0.57493 (slope 1.147) |
| ml2lr | 854 | none (incumbent) | 0.58865 | 1.449 | 0.20140 | 0.6897 | +0.0003 [-0.0171, +0.0167] | 0.58819 (slope 1.405) |

"vs close" is paired on the fights that have a close: 845 for noline and ml2lr, 843 for open, 845 for line
(verifier note).

Descriptive only. Each family's 2016-2020 choice was run walk-forward through 2024-25, and by the pre-registration none
of it can change anything.

| head | family | log loss | slope | vs static incumbent | vs ml2 rolling |
|---|---|---|---|---|---|
| noline | recency (h none) | 0.59036 | 1.508 | +0.0009 [-0.0025, +0.0040] | +0.0042 [-0.0009, +0.0089] |
| noline | percard (h none) | 0.58963 | 1.475 | +0.0002 [-0.0029, +0.0031] | +0.0035 [-0.0012, +0.0080] |
| noline | temp (last 200, sd 0.15) | 0.58467 | 1.178 | -0.0047 [-0.0089, -0.0003] | -0.0015 [-0.0038, +0.0017] |
| noline | temp_annual (1 y) | 0.58586 | 1.007 | -0.0035 [-0.0125, +0.0062] | -0.0003 [-0.0067, +0.0076] |
| noline | odd | 0.58440 | 1.143 | -0.0050 [-0.0099, +0.0004] | -0.0017 [-0.0044, +0.0019] |
| noline | segment (all six) | 0.58484 | 1.167 | -0.0046 [-0.0090, +0.0002] | -0.0013 [-0.0036, +0.0018] |
| open | recency (h 0.5) | 0.57687 | 1.148 | -0.0043 [-0.0095, +0.0010] | -0.0031 [-0.0067, +0.0009] |
| open | percard (h 0.75) | 0.57601 | 1.099 | -0.0051 [-0.0106, +0.0009] | -0.0040 [-0.0081, +0.0008] |
| open | temp (last 400, sd 0.15) | 0.57874 | 1.139 | -0.0024 [-0.0059, +0.0017] | -0.0012 [-0.0037, +0.0016] |
| open | temp_annual (1 y) | 0.58165 | 1.035 | +0.0005 [-0.0065, +0.0081] | +0.0017 [-0.0041, +0.0082] |
| open | odd | 0.57868 | 1.159 | -0.0025 [-0.0054, +0.0010] | -0.0013 [-0.0033, +0.0010] |
| open | segment (all six) | 0.57934 | 1.191 | -0.0018 [-0.0042, +0.0008] | -0.0006 [-0.0021, +0.0009] |
| line | recency (h none) | 0.57446 | 1.174 | -0.0013 [-0.0021, -0.0004] | -0.0005 [-0.0013, +0.0003] |
| line | percard (h none) | 0.57424 | 1.169 | -0.0015 [-0.0025, -0.0004] | -0.0007 [-0.0016, +0.0002] |
| line | temp (last 200, sd 0.15) | 0.57406 | 1.103 | -0.0017 [-0.0037, +0.0006] | -0.0009 [-0.0023, +0.0008] |
| line | temp_annual (1 y) | 0.57385 | 1.056 | -0.0019 [-0.0057, +0.0021] | -0.0011 [-0.0041, +0.0022] |
| line | odd | 0.57363 | 1.102 | -0.0021 [-0.0042, +0.0001] | -0.0013 [-0.0026, +0.0002] |
| line | segment (all six) | 0.57386 | 1.121 | -0.0019 [-0.0035, -0.0001] | -0.0011 [-0.0020, -0.0001] |
| ml2lr | recency (h 1.0) | 0.58587 | 1.305 | -0.0028 [-0.0060, +0.0006] | -0.0023 [-0.0053, +0.0011] |
| ml2lr | percard (h 0.75) | 0.58343 | 1.160 | -0.0052 [-0.0107, +0.0008] | -0.0048 [-0.0097, +0.0009] |
| ml2lr | temp (last 200, sd 0.15) | 0.58510 | 1.305 | -0.0035 [-0.0060, -0.0009] | -0.0031 [-0.0052, -0.0004] |
| ml2lr | temp_annual (4 y) | 0.58743 | 1.391 | -0.0012 [-0.0028, +0.0003] | -0.0008 [-0.0024, +0.0010] |
| ml2lr | odd | 0.58529 | 1.298 | -0.0034 [-0.0060, -0.0005] | -0.0029 [-0.0053, -0.0000] |
| ml2lr | segment (bigfav) | 0.58975 | 1.464 | +0.0011 [-0.0005, +0.0026] | +0.0016 [-0.0004, +0.0035] |

Calibration slope by family on 2024-25, continuing T1:

| family | 2024 | 2025 | pooled |
|---|---|---|---|
| elo | 1.13 [0.66, 1.60] | 1.14 [0.67, 1.57] | 1.13 |
| elo_sig | 1.09 [0.72, 1.47] | 1.19 [0.82, 1.54] | 1.14 |
| whr | 1.46 [1.19, 1.80] | 1.49 [1.21, 1.81] | 1.48 |
| glicko2 | 1.26 [0.95, 1.62] | 1.47 [1.16, 1.78] | 1.36 |
| elo_full | 1.24 [0.94, 1.60] | 1.49 [1.18, 1.81] | 1.36 |
| trueskill | 1.21 [0.91, 1.56] | 1.53 [1.23, 1.85] | 1.36 |
| mkt_rating | 1.53 [1.18, 1.92] | 1.56 [1.19, 2.02] | 1.54 |
| ml1 | 1.57 [1.34, 1.80] | 1.51 [1.16, 1.91] | 1.54 |
| ml2lr | 1.48 [1.25, 1.71] | 1.42 [1.09, 1.78] | 1.45 |
| ml2 | 1.44 [1.23, 1.66] | 1.44 [1.12, 1.79] | 1.44 |
| close | 1.13 [0.95, 1.35] | 1.09 [0.87, 1.39] | 1.11 |
| open | 1.41 [1.18, 1.69] | 1.23 [0.97, 1.54] | 1.31 |

**What 2024-25 shows.**
- **A 2017-type episode at more than twice the size, held for two years.** Model families became underconfident while the close
  barely moved. The 2017 episode lasted one year at less than half this size (mean log slope +0.13 vs about +0.3), and it reverted.
- **Recency weighting of the stack caught it only partly.** Where the 2016-2020 choice had a short half-life, annual
  refits helped some (open, h 0.5: slope 1.31 → 1.15, -0.0043 n.s.). Where it chose no recency, they did not (no
  line: slope 1.51).
- **A per-card temperature on the last 200-400 bouts caught a third to a half of the excess slope** (no line
  1.36 → 1.18, open 1.31 → 1.14, close stack 1.17 → 1.10, ML v2 logistic 1.45 → 1.31).
- **This is the one result here that argues for a recalibration, and it comes from the period the protocol forbids
  selecting on.** v9 can pre-register `temp|last_n=200,sd_a=0.15` (or 400) as an insurance arm whose clean test is the
  forward ledger or vault audit 2. Its measured price in calm years is +0.0004 to +0.0008 per fight against its own
  base.

**Harness cross-check.** The same predictions were replayed through tools/blindtest.py (plugin `calib_*`, scratch
output, no report written). On the 843-fight common set the scores were:
- calib_line 0.5758, against the close -0.0096 [-0.0142, -0.0050];
- calib_line_wf 0.5741 (slope 1.10), against the close -0.0113 [-0.0167, -0.0054];
- calib_noline 0.5866 (slope 1.39), and calib_noline_wf 0.5808 (slope 1.22);
- calib_open 0.5812, and calib_open_wf 0.5787;
- market_close 0.5854 (slope 1.11).

Command: `python3 tools/blindtest.py replay --models calib_noline,calib_noline_wf,calib_open,calib_open_wf,calib_line,calib_line_wf,ml2_stack_noline,ml2_stack_line,market_close,market_open --out <scratch>.json`.

## 4. Consistency with the pre-registered production drift rule

**The rule (docs/V6_V10_PLAN.md 6.5.1; docs/BACKLOG.md PRE-REGISTERED).** The production no-line stack keeps h 1.5
and its temperature. It switches to h 3 and T 1 if either condition holds:
- (a) audit 1's mirrored slope for the frozen production no-line stack is below 1.15 with a 95% CI that includes 1;
- (b) the forward ledger's trailing-200 slope CI includes 1 for two consecutive quarters.

**Agreement.** This work finds no recalibration that helps before 2024 and adopts none. That matches the rule's
default and plan 4.2's "do not fit a temperature on 2024-25". Nothing here reacts to audit 1, and nothing proposes a
change to the rule before audit 1.

**Method.**
- The ML v2 no-line stack was used. Production weights are 1.0335 / 0.3906 (fit 2019-2025, h 1.5). They were
  re-derived by `ml2.stack_predict(..., 'roll', h, 2025)`, which reproduces ml2.json `page_stack`. The validated
  weights are 0.7049 / 0.5526 (fit 2019-2023).
- Outcomes were simulated on the 1,224 real 2021-2023 input pairs, as y ~ Bernoulli(sig(s · z_validated)) for a grid
  of true slopes s. s = 1.37 is the validated stack's published 2024-25 slope.
- Rule (a) was scored on resampled 370-fight vaults. Rule (b) was scored on a ledger stream of 130 bouts a quarter,
  checked quarterly on the trailing 200, four checks. 4,000 simulations per cell.
- h 3 is ml2's own production refit with h 3: 0.9741 / 0.3674.

### T4. Operating characteristics

The production stack is k = 1.217 times sharper than the validated one. Break-even: switching to h 3 helps only if the
true validated-scale slope is below 1.200, which means a production-stack slope below 0.970.

| true slope s (validated scale) | median production slope (n 370) | P(rule a switches) | P(persist branch) | P(rule b fires by check 2 / 4) | E[ll] h 1.5 | E[ll] h 3 | regret: never / rule a / rule b / break-even rule |
|---|---|---|---|---|---|---|---|
| 0.9 | 0.729 | 0.431 | 0.000 | 0.455 / 0.733 | 0.64529 | 0.64314 | 0.00215 / 0.00122 / 0.00057 / 0.00008 |
| 1.0 | 0.815 | 0.683 | 0.001 | 0.667 / 0.893 | 0.63204 | 0.63066 | 0.00138 / 0.00044 / 0.00015 / 0.00017 |
| 1.1 | 0.888 | 0.826 | 0.003 | 0.826 / 0.968 | 0.61966 | 0.61900 | 0.00066 / 0.00012 / 0.00002 / 0.00018 |
| 1.2 | 0.973 | 0.836 | 0.015 | 0.899 / 0.989 | 0.60812 | 0.60812 | 0.00000 / 0.00000 / 0.00000 / 0.00000 |
| 1.3 | 1.053 | 0.727 | 0.051 | 0.907 / 0.992 | 0.59736 | 0.59798 | 0.00000 / 0.00045 / 0.00061 / 0.00017 |
| 1.37 | 1.109 | 0.604 | 0.092 | 0.876 / 0.982 | 0.59026 | 0.59130 | 0.00000 / 0.00063 / 0.00102 / 0.00017 |
| 1.45 | 1.175 | 0.431 | 0.190 | 0.816 / 0.965 | 0.58258 | 0.58406 | 0.00000 / 0.00064 / 0.00143 / 0.00011 |
| 1.6 | 1.296 | 0.173 | 0.446 | 0.603 / 0.850 | 0.56929 | 0.57154 | 0.00000 / 0.00039 / 0.00191 / 0.00003 |

**Replay, 2015-2023.** The trailing-200 monitor ran on the deployed-style no-line stack (refit each year on
2013..Y-1, h 1.5). Over 36 quarterly checks, the CI included 1 at 31. Condition (b) was first met on 2015-09-30. The
CI excluded 1 only at 2015-03-31, 2017-06-30, 2017-09-30, 2017-12-31 (the 2017 episode, slopes 1.72-1.89) and
2019-09-30. The median CI half-width was 0.46.

**What this means.**
1. **The stakes are small either way.** Every rule's expected regret is at most 0.0019 log loss per fight. The rule
   is safe; the question is whether it is informative.
2. **Rule (a)'s threshold is centred for the validated stack, not the production stack.**
   - The production stack is already stretched by k = 1.22, so a 2026 that looks like 2024-25 shows up as a production
     slope of about 1.11, below 1.15. At s = 1.37, rule (a) switches with probability 0.60, and switching then costs
     0.0010.
   - The break-even production slope is about 0.97.
3. **The "CI includes 1" clause blocks the case the switch exists for.** At s = 0.9 the production stack is clearly
   too sharp (slope about 0.73), and its CI excludes 1 from below. Rule (a) switches only 43% of the time, and plan
   4.2 would call that "inconclusive".
4. **Rule (b) is close to an unconditional switch two quarters after the ledger reaches 200 scored bouts.** It fires
   by the fourth check with probability 0.85 or more in every scenario. On plan 6.4's count (10-14 bouts a card, about
   40-50 a month from Nov 7, 2026), the first check with 200 bouts is 2027-03-31 or 2027-06-30, and the likely switch
   is the quarter after. A one-way switch
   trivially satisfies plan 4's "fires at most once" replay criterion, but here that criterion says nothing.
5. **For v9, recorded here and not adopted:**
   - test the production stack's slope against its own break-even (about 0.97), or test the validated stack's slope
     against 1.15;
   - replace "CI includes 1" with a one-sided test in the direction that favours switching;
   - give (b) a window of 600 or more bouts, or a CI that excludes the persist branch (lower bound above 1.2), so it
     has power.
   - The simulation's "break-even rule" (switch when the production slope is below 0.97) has regret at most 0.00018
     in every scenario, against rule (a)'s 0.0012 and rule (b)'s 0.0019.
6. **Unnamed column.** "Production no-line stack" in the ledger can mean two things:
   - fwd-4.1 `p_a_noline` / `stack_noline`, the MoE stack (h 1.5, T 1.1667 from moe_page.json);
   - `ml2_stack_noline_prod`, the ML v2 page production stack.

   The simulation used the ML v2 stack, whose validated and production weights are both published. The MoE stack has
   the same mechanism, stretching by both h 1.5 and T 1.17, with a different k that I did not compute. The rule's text
   should name one column before the ledger's first check.

## 5. The runtime function (forward package and FightEngine.predict())

**src/ml/calib.js** (UMD: Node, browser and Web Worker; no dependencies; version 1.1.0) and its tools/calib.py twins:

| JS | Python | what it does |
|---|---|---|
| `Calib.apply(spec, p, flags)` | `apply_spec` | recalibrated P(A); `spec = calib.json production[head]`, which is `{type: "none"}` for every head today, so the identity |
| `Calib.segFlags({women, lbs, nA, nB, rounds, pRaw})` | `seg_flags` | corner-symmetric segment flags |
| `Calib.fit(kind, rows, opts)` | `fit_spec` | MAP no-intercept logistic: temperature, odd or segment; half-life, max age, last-n and Gaussian priors |
| `Calib.fitFromHistory(rows, asOf, cfg)` | `fit_from_history` | walk-forward refit from the ledger's own scored rows strictly before `asOf`; `cfg = production_cfg[head]` (`{kind: "none"}` today) |
| `Calib.monitor(p, y, 200)` | `slope_monitor` | trailing-200 mirrored slope, Wald CI, `ciIncludes1` |
| `Calib.ruleB(rows, asOf)` | `drift_rule_b` | rule 6.5.1 (b): quarter-end checks, `firedAt`, `setting` "h1.5" or "h3_T1" |

**How to wire it.**
- **predict() and the page.** Call `Calib.apply(doc.production[head], p, flags)` after the stack. It returns p
  unchanged today.
- **Forward ledger.** Call `Calib.ruleB` (or `drift_rule_b`) on the scored production no-line column at each quarter
  end, and record the state in the ledger metadata. That is plan 6.5.1's "Cycle 4's monitor implements (b)".
- **Turning a scheme on later.** Change `production_cfg[head]` in data and call `fitFromHistory` before each card. No
  code change is needed. This only happens after a pre-registered decision.

**Tests** (`node tests/test_calib.js`, 14 checks, all pass):
- apply, fit, fitFromHistory, slope / SE, the monitor and ruleB reproduce the Python vectors to 2e-16 on synthetic
  inputs that carry no fight data;
- a corner swap gives exactly 1 - p for every kind;
- ruleB is corner-symmetric, handles quarter ends and keeps the default with an empty ledger;
- the production specs are the identity;
- the segment flags are correct and symmetric.

**Blind-test plugin** (`tools/blindtest_plugins/calib.py`):
- `calib_noline` / `calib_open` / `calib_line` are the pre-registered choice, which is the incumbent ml2 page stacks.
  Their history is 2021-2023 forward-chained.
- `calib_*_wf` are experimental controls: the long-history stack with the per-card trailing temperature, run
  walk-forward.

## Protocol and checks

- **2026 never enters.** It is dropped at parse in ml2's table builder, asserted again in the table stage, and
  nlbair rows are filtered to event_date < 2026-01-01. No 2026 row was collected, so nothing was written to the vault
  directory.
- **Choices use only data before 2024.** Every choice (family, hyper-parameters, adoption) uses rows dated before
  2024-01-01. The drift and cv stages assert `year <= 2023`.
- **2024-25 was read once.** That was the confirm stage, after the pre-registration commit. It is enforced in code:
  confirm refuses unless calib_prereg.json is committed unchanged. The harness replay above scores the same frozen
  predictions and was not used for any choice.
- **Corner symmetry and no intercepts.** Mirrored slopes, odd recalibrations only, swap test 4.4e-16, and
  corner-symmetric segment flags.
- **Event-cluster bootstrap.** 2,000 resamples of cards, paired for differences.
- **Mild optimism that does not touch 2024+.**
  - ML v2's blocks and penalty, and the rating systems' scale parameters, were chosen on CV years inside 2016-2023.
  - The incumbents' half-lives (ml2's) were chosen on the same 2021-2023 gate. That favours the incumbent slightly,
    which is why the "gate-best" column is shown: even selecting on the gate, no scheme gains more than 0.0008.

## Reproduce

```
nice -n 5 python3 tools/calib.py table          # ~10 s, reads out/ml2_cache (tools/ml2.py table/fit/stack caches)
nice -n 5 python3 tools/calib.py drift          # ~1 min  -> T1, T2
nice -n 5 python3 tools/calib.py cv             # ~7 min  -> T3a (backtest universe)
nice -n 5 python3 tools/calib.py cv --universe all   # ~7 min -> T3b
nice -n 5 python3 tools/calib.py rule           # ~2 min  -> T4 + replay (seeded)
python3 tools/calib.py prereg && git commit data/derived/calib_prereg.json   # already done (5878b25)
nice -n 5 python3 tools/calib.py confirm        # T5 (refuses without the committed pre-registration)
nice -n 5 python3 tools/calib.py plugin && nice -n 5 python3 tools/calib.py export
python3 tools/calib.py report                   # every table above, from data/derived/calib.json only
node tests/test_calib.js
```

## Caveats

- **The incumbent no-line stack differs from ml2's by 0.0004 on 2024-25** (0.58940 vs 0.58899, slope 1.359 vs 1.371).
  Its market-rating input is ml2's table rating (`mr_p`, rebuilt from 2013 so the long-history stacks have it), while
  ml2's stack stage used market.json's `p_market_rating`.
  - Verifier correction: the two ratings agree to within 1e-4 on every fight where both exist, 2019-2025. The whole
    gap comes from 9 of the 854 2024-25 fights, where market.json has no `p_market_rating` and ml2's stack enters the
    input as logit 0 (p = 0.5).
  - With those 9 set to missing, the verifier's code gives 0.58899 / slope 1.371, which is ml2's number.
  - The weights are identical (0.7049 / 0.5526), and the gate years are unaffected (0.62984 in both).
  - The open and close stacks reproduce ml2 exactly (0.58115, 0.57574).
- **Which no-line stack.** The rule analysis uses the ML v2 no-line stack. The MoE no-line stack in fwd-4.1's
  `p_a_noline` has the same mechanism (h 1.5 + T 1.17), but its k was not computed.
- **Scenario outcomes are synthetic.** They are drawn from a one-parameter slope model on real 2021-2023 inputs. A
  real 2026 shift could also change discrimination or the base rate, and the simulation ignores both.
- **Lines before 2019 come from a different source** (nlbair/BestFightOdds no-vig) than 2019+ (market.json). The
  close's 2013-2018 slopes sit on that source.
- **The drift table's ML rows for 2012-2016 are early annual fits on small samples.** Their overconfidence is not
  evidence about 2026.

## Verification log

Adversarial verifier, Nov 6, 2026, 10:50-11:30 pm UTC. I assumed any gain was fake until my own code reproduced it
from raw inputs. calib claims no gain, so I checked whether "nothing passes" is right, and whether any number or claim
is wrong. Code: `tools/calib_verify.py`, which does not import tools/calib.py or tools/ml2.py. Output:
`data/derived/calib_verify.json`.

**Verdict: confirmed. No recalibration enters production.**
- Every production spec stays `{type: none}`, so `Calib.apply` is the identity.
- The `calib_*` plugin models are copies of the ML v2 incumbent stacks.
- Nothing enters the stacks, the forward package or predict(). adopt = false.
- `Calib.monitor` and `Calib.ruleB` are usable tooling for the pre-registered rule 6.5.1 (b), with no behaviour change.
- I found no defect in the numbers. I corrected six statements in this note and one docstring in the plugin.

### What I checked and how

| check | result | command |
|---|---|---|
| Timeline | The decision rule and the cv stage first appear together in autosave 021fb79 (10:14 pm). No cv output existed before then: the earlier commits have only table and drift stages. cv_backtest.json was written at 10:35:23 pm. Its sha256-16 7d66a0ff3e97f20c equals the one recorded in calib_prereg.json. The prereg was committed at 10:36:20 pm (5878b25); confirm ran 10:36:31-10:37:00 pm. After the prereg, tools/calib.py changed only in test vectors and export notes, so the cv, confirm and rule stages are as pre-registered. drift and rule were re-run after the look; both read ≤ 2023 only, with unchanged code | `git log`, `git diff ee4f349 HEAD -- tools/calib.py` |
| 2026 data | The ml2 table, the calib table and calib.json fights all end 2025-12-13. The only 2026 strings in calib.json are the constant "2026-01-01" and the build date. No 2026 rows were collected, so there was nothing for the vault | `python3 tools/calib_verify.py claims` (meta) and grep |
| Look-ahead in inputs | ML v2 logistic 2012-2023 = annual expanding refits (train < Jan 1 of Y). ML v2 pre-UFC means fit < 2024. Market rating = walk-forward Kalman on earlier closes, stream cut at 2026 (ml2's perturbation test). Rating and market-rating scale parameters were tuned on 2019-2023; the note discloses this. No normalisation is fit on 2024+ | read tools/ml2.py |
| Line join | nlbair f1 = table A on all 3,360 nlbair rows used (my builder asserts it), and winners agree 100%. The market.json and nlbair closes correlate 0.996 (MAD 0.012) on 2,785 shared fights. Close coverage in the backtest universe: 99.7-100% 2014-2024, 91% 2013, 97.9% 2025. The gate years are complete, so no match bias | `tools/calib_verify.py` (table build) |
| Stack gate, own code | Own non-negative no-intercept stack fit, own temperature MAP, own event-cluster bootstrap (different seed). Incumbent gate 0.62984 / 0.62275 / 0.61624 / 0.63147 (slopes 1.077 / 1.046 / 1.051 / 0.985), which equals calib and ml2.json's stack CV | `nice -n 5 python3 tools/calib_verify.py gate` |
| Temperature family | Over the full 26-config grid, the 2016-2020 choice is the same as calib's for every head (last 200, sd 0.15; open last 400). Gate vs incumbent: +0.00043 [-0.0007, +0.0017] no line, -0.00039 open, +0.00018 close, +0.0008 [+0.0001, +0.0016] ML v2 logistic. calib: +0.0004 / -0.0004 / +0.0002 / +0.0008 | same |
| Recency and per-card | No line: h none +0.00028, h 0.5 -0.00083 [-0.0021, +0.0005] (calib's gate-best -0.0008), per-card h 1 -0.00057. Open: h 0.5 (inner choice) +0.0024 [+0.0001, +0.0047], significantly worse as calib says; h none -0.00075. Close: h none -0.00039 | same |
| Odd and segment | No line +0.00024 / +0.00013, open -0.00037 / -0.00045 (calib +0.0003 / +0.0001 / -0.0004 / -0.0004) | `... calib_verify.py oddseg` |
| Corner symmetry | My stack, per-card stack and per-card temperature, refit on swapped corners: max \|p + p_swapped - 1\| ≤ 1.1e-8 (optimizer tolerance; calib's exact fits 4.4e-16) | `... calib_verify.py confirm` |
| Free-intercept check | ufcstats order is real on the gate: mean P(A) 0.524 against an A win rate of 0.566. A free intercept would gain -0.0038 (no line) and -0.0018 (close) in sample, more than any calib scheme. No calib scheme has an intercept or an ordered term, so none can use it | `... calib_verify.py claims` |
| 2024-25, recomputed (not re-selected) | Every pre-registered object reproduces: 0.58940 / 0.58115 / 0.57574 / 0.58865. Close stack vs close -0.0096 [-0.0143, -0.0050]. No-line descriptive temp row -0.0047 [-0.0089, -0.0003]. A harness replay to a scratch file (calib_* + markets) matches the note's cross-check line by line | `... calib_verify.py confirm`; `BLINDTEST_CACHE=<scratch> nice -n 5 python3 tools/blindtest.py replay --models calib_noline,calib_noline_wf,calib_open,calib_open_wf,calib_line,calib_line_wf,market_close,market_open --out <scratch>.json` |
| Plugin columns | Against my own incumbents: max \|diff\| 4e-5 (2021-2023 history) and 3e-5 (2024-25). There are no history rows before 2021 for the incumbents | `... calib_verify.py confirm` |
| Rule stage | Sharpness k = 1.2172 (calib 1.217). The T4 claims in the bottom line match rule.json | same; `python3 tools/calib.py report` |
| JS | `node tests/test_calib.js`: 14 of 14 pass | |

### Corrections made (report only; no number in calib.json changes)

1. **The cause of the 0.0004 no-line gap.** It is not a different market-rating source. The two ratings agree to
   9e-5 wherever both exist. market.json lacks `p_market_rating` for 9 of the 854 2024-25 fights, and ml2's stack fed
   those as logit 0. With them set to missing, my code gives ml2's 0.58899 / 1.371. Fixed in bottom line 3, the
   Caveats and the plugin docstring.
2. **"The 2024-25 shift was larger than anything in 2012-2023."** The note compared single-family pooled slopes with a
   cross-family mean. Like-for-like, the 11-family mean log slope was +0.268 in 2024 and +0.310 in 2025, against at
   most +0.124 (2022) before, so the cross-family claim holds. But single families had reached 2024-25 levels before
   2024: the market rating was at 1.38 in 2022 and 1.55 [1.16, 1.98] in 2023. Fixed in bottom line 3.
3. **2017 episode.** Plain Elo (0.71) and strike Elo (0.92) were not underconfident in 2017. Fixed in bottom line 2.
4. **T2.** "Never helped" and "no family improves" now say "not significantly": the best point estimate is -0.0017
   and every CI includes 0.
5. **The trailing-temperature hedge.**
   - Against ml2's rolling refits, only the ML v2 logistic's CI excludes 0. The other three heads are n.s.
   - So most of the -0.0047 against the static incumbent comes from refitting on 2024-25 at all.
   - The row is one of 24 descriptive rows, on an episode already in BACKLOG before this work began.
   - Fixed in bottom line 4.
6. **Segments.** Two of 24 segment-by-head CIs exclude 1, which is about chance: close-stack debut above 1, and
   open-stack women below 1. Fixed in bottom line 5 and the segment reading. The "vs close" n in T5 is the fights with
   a close (845 / 843 / 845 / 845).

### Notes for v9 (not defects; no change made)

- **The decision rule.**
  - calib's two-part rule (2016-2020 choice AND gate-best both better by more than 0.0005) is stricter than ml2's
    rule, which picks h on the gate. It was committed before any cv output.
  - Under ml2's rule with h 0.5 added to ml2's grid {none, 3, 1.5}, the no-line stack would have moved to h 0.5:
    -0.0008 [-0.0021, +0.0005], n.s.
  - calib rejects it because the 2016-2020 origins prefer no recency (0.63605 vs 0.63679).
  - I agree with the rejection: the gain is inside noise, and the inner years point the other way.
- **Direction of drift rule 6.5.1.**
  - Both clauses are read on the stretched production stack, and a slope near 1 there means the stretch is right.
  - In T4, rule (a)'s switch probability peaks (0.84) at s = 1.2, where the production slope is 0.97 and switching is
    neutral.
  - This strengthens the note's findings (i)-(iii): as written, the rule switches most often when production is
    already calibrated. Rule (b) switches almost regardless of the true slope.
  - Changing the rule before audit 1 is not allowed. v9 should re-specify it on the validated scale or against the
    break-even.
- **The insurance arm.**
  - A per-card trailing temperature is suggested by the 2024-25 look, so it is a 2024-25-informed idea. Its only clean
    tests are the forward ledger and vault audit 2.
  - If cycle 4 ships per-card stack refits, the do-not-do list already forbids a second temperature on top
    (+0.0005 / -0.0001). The arm is relevant only while production keeps annual or static stacks.
