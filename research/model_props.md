# Market props for how and when (task key: props)

Nov 6-7, 2026, 11:35 pm to about 12:30 am UTC. Tool: `tools/props.py`. Output: `data/derived/props.json`. Compact
extract: `data/raw/odds/bfo_props_full.csv`. JS pool: `src/ml/propspool.js`, checked by `tests/test_propspool.js`.
Blind-test plugin: `tools/blindtest_plugins/props.py`. Forward capture: `python3 tools/props.py capture`. This is
docs/V6_V10_PLAN.md Cycle 2 research, done now so v7 only has to integrate it.

Protocol: every 2026+ row is dropped at parse. Every choice was made by forward-chained CV on fights before 2024.
Props start in 2021, so the folds are: fit on 2021, score 2022; fit on 2021-2022, score 2023. Leave-one-year-out over
2021-2023 is a secondary check. The 0.0005 rule applies to every added term. 2024-25 was scored once, pre-registered
in commit b3312e2 before the look (the look itself is commit 4c3aa4e). Every package is corner-symmetric (the swap
check is asserted). Brackets are 95% event-cluster bootstrap CIs (2,000 resamples of cards), paired for
differences. Negative = better for losses.

## Bottom line

1. **Props carry real method information, and the current 40/60 blend already captures it.** For method given the
   winner (winner held fixed), the props pool beats the S2 cells clearly in CV and again on 2024-25. It is level with
   the current 40/60 blend:

   | same winner (W_close), fights with method props | CV 2022-23 (797) | 2024-25, one look (830) |
   |---|---|---|
   | pool minus S2: **7-bin (pre-registered primary)** | -0.0175 [-0.0311, -0.0043] | **-0.0172 [-0.0283, -0.0056]** |
   | pool minus S2: method given the winner | -0.0183 [-0.0321, -0.0051] | -0.0177 [-0.0289, -0.0061] |
   | pool minus S2: method (KO / SUB / DEC) | -0.0148 [-0.0265, -0.0039] | -0.0104 [-0.0184, -0.0025] |
   | pool minus props alone: 7-bin | -0.0128 (not bootstrapped) | -0.0070 [-0.0172, +0.0028] |
   | pool minus current 40/60 blend: 7-bin | -0.0003 (not bootstrapped) | -0.0008 [-0.0023, +0.0005] |
   | pool minus current 40/60 blend: method given the winner | -0.0002 | -0.0008 [-0.0022, +0.0005] |

   Verifier's bootstrap of the two unbootstrapped CV rows (tools/props_verify.py, own join, n = 798): pool minus props
   alone 7-bin -0.0124 [-0.0225, -0.0032]; pool minus the 40/60 blend -0.0004 [-0.0019, +0.0009]. The pool-vs-blend
   gap is under the 0.0005 rule in CV, so the pool does not pass the gate **against the incumbent**. See the
   verification log.

   The CV-chosen form is not the log-linear pool the plan sketched. It is a **joint-linear pool**: each side's method
   mix is a weighted average of S2's and the props' mixes, with each source weighted by its own P(that side wins).
   That is exactly the structure of the current 40/60 blend. CV refits the weight to 0.46 S2 / 0.54 props (fit on
   2021-2023), or 0.43 / 0.57 in production (2021-2025). The log-linear pool was 0.0017 worse in CV (table 4).
2. **Round props add nothing over S2's hazard shapes.** Pooling any round family (fight ends in round k, fighter wins
   in round k, method by round) makes the unsided round given a finish worse by +0.0013 to +0.0040 in CV. That is
   above the plan's +0.002 gate for every family but one, and that one was worse on its own CV metric. The chosen
   pool keeps S2's round shapes. On 2024-25 the pool's round given a finish is -0.0008 [-0.0018, -0.0000] vs S2.
   The current blend, which uses the props' round shapes, is +0.0032 [-0.0075, +0.0143] better than the pool there:
   not significant, and against CV.
3. **The decision debias is rejected, and the decision share failed on 2024-25.** In CV a decision tilt is +0.0018
   worse: mixing S2 (too many decisions: 50.6% vs 48.1% observed) with the props (too few: 45.2%) already lands at
   47.5%. On 2024-25 the pre-registered "within 2 points" check **fails**: decisions were 54.2% of these fights, the
   pool predicted 47.8%, S2 48.8%, the props 47.0% and the 40/60 blend 47.3%. Every source missed by 5-7 points. This
   is the 2024-25 decision drift research/model_market.md already reports (props 47.5% vs 54.2%). No term fit on
   2021-2023 could have caught it. It belongs to the v9 drift monitor.
4. **Debut bouts: the debut method model plus props beats the debut model alone on 2024-25; in CV the gain passes the
   0.0005 point rule but its CI includes 0.** It uses a log-linear pool, chosen
   by CV over the joint-linear and linear forms (all three within 0.00003). CV (193 bouts): -0.0150 [-0.0514, +0.0198]
   on method given the winner. 2024-25 look (163 bouts): **-0.0364 [-0.0726, -0.0027]**. Against props alone it is
   -0.0026 [-0.0297, +0.0260]. Small samples. Use it where props exist and log it as monitored.
5. **Coverage is high on every part of the card, but only close to the event.** Method props exist for 97-98% of
   backtest bouts 2021-2025 (main card 97.9%, prelims 98.1%, early prelims 96.1%; 4.8 books on average). Across all
   bouts, debut bouts included: main 96.1%, prelims 94.8%, early prelims 92.2%. Timing matters more than card
   position. In the first forward snapshot (Nov 7, 12:01 am UTC):
   - UFC Vegas 124 (that day): all 14 bouts had method and round props;
   - UFC 334 (8 days out): only 2 of 11 bouts had any, both on the main card.
6. **Consistency between families is good**, so one de-vig (power within each family per book, mean over books)
   works everywhere. On 2,060-4,100 bouts:
   - P(decision) agrees across method / goes-to-decision / round props within 0.6-1.4 points (correlations
     0.996-0.999);
   - the method market's P(A) is within 1.3 points of the same books' moneyline;
   - "over 1.5 rounds" sits inside the round props' bounds in 99.95% of bouts.
7. **Winner: unchanged by construction.** Every package is composed with the same winner (cycle 1's close stack,
   W_close), and P(A) / (P(A) + P(B)) equals it exactly (JS test: 1e-12).

**Recommendation for v7 (integration):**
- Verifier's correction: the swap below is **not** a gain over production. Against the incumbent 40/60 blend the pool
  is -0.0003 in CV (verifier -0.0004 [-0.0019, +0.0009]; -0.0002 on rows where both prop sources exist). That fails
  the 0.0005 rule. Use the pool as the integration vehicle for props in predict(): the same model as the blend, with
  a forward-chained weight and one de-vig from raw book prices in training and live. Do not log it as an
  improvement. The part that adds something production lacks is the debut-bout pool.
- Replace the 40/60 joint blend with this pool: `PropsPool.create(props.json.model).predict(...)`.
  - It is the same structure, with the weight refit forward-chained.
  - It reads the full-family extract. Its method coverage equals market.json's (2,071 bouts 2021-2025), and it adds
    the round, inside-the-distance, over/under and method-by-round families plus raw per-book prices, so live
    captures go through the identical de-vig.
  - It has an explicit degrade path (no method props -> the model's method mix; rounds always from the model).
  - JS and Python agree to 1.7e-16.
- Keep S2's round shapes.
- On debut bouts, use `debutMethod()` when props exist.
- The 2024-25 gain over the current blend is -0.0008 and not significant. Read the swap as hygiene and coverage,
  not a measurable gain. The v7 look's real comparison is the package vs v6's cells, where the expected effect is
  about -0.017 on 7-bin with props.
- Capture props with timestamps in the ledger (`tools/props.py capture`). The weights were fit on closing props;
  ledger props are T-25h to T-8h snapshots, so monitor the gap.

## 1. Data

**Source.** BestFightOdds event pages for every UFC card with props, 2021-01-16 to 2025-12-13 (286 pages).
- Fetched with User-Agent `FightLabSim/1.0`, at least 2.5 s apart (one robots.txt check). BFO's robots.txt allows
  everything except /cnadm/.
- Raw pages are cached in `data/raw/props_cache/bfo/` (gitignored). The committed compact extract is
  `data/raw/odds/bfo_props_full.csv`: 14,892 bout-book rows, closing prices, no 2026 row.
- BFO shows no prop prices on 2019-2020 pages (checked on UFC 251), so there are no earlier folds.
- The per-book line-history endpoint is obfuscated and was not used (tools/linemove.py: a request to it was refused
  as circumvention). Historical props are therefore closing prices with no timestamps. The `capture` stage stamps
  forward snapshots.

**Families.** These are parsed by `tools/market.py parse_event_props_full`, an additive extension; the existing
parser and its outputs are unchanged.

| key | family | legs |
|---|---|---|
| m6 | method of victory | A KO, A SUB, A DEC, B KO, B SUB, B DEC (+ draw when quoted) |
| gd | goes to decision | yes / no |
| er | fight ends in round k | rounds 1..K + decision |
| wr | fighter wins in round k | A r1..K, B r1..K, A dec, B dec |
| mr | fighter wins by KO / SUB in round k | 4K + 2 legs |
| itd | wins inside the distance | yes / no per side |
| ou | over k.5 rounds | yes / no |

**De-vig.**
- Power de-vig within each family for each book; multiplicative when a book's family sums to 1 or less.
- A family is dropped when a leg is missing, when a leg is at or above 1, or when its overround is implausible
  (OVER_MAX in the tool).
- Families are averaged arithmetically over books.
- With 3 or more books, a book is dropped when its key scalar (P(decision), or P(A) for the moneyline) is more than
  0.15 from the median book. This rule is outcome-blind; it is the market.py rule applied per family.
- The same code runs in Python (`book_families`, `consensus`) and JS (`bookFamilies`, `consensus`). The test checks
  parity from raw prices.

**Matching.** Bouts are joined through market.json's BFO matchup id (outcome-free) and oriented by name similarity.
There were 0 orientation flags against the closing line (a flag would be the props' P(A) disagreeing with the close
by more than 0.25 while agreeing with the flipped close).

**Coverage, backtest bouts 2021-2025** (outcome-free; `props.json coverage`):

| year | bouts | m6 | er | wr | mr | books (m6) |
|---|---|---|---|---|---|---|
| 2021 | 427 | 99.8% | 99.3% | 99.8% | 52.2% | 3.44 |
| 2022 | 422 | 98.1% | 98.1% | 98.1% | 97.2% | 5.76 |
| 2023 | 405 | 97.0% | 97.0% | 97.0% | 97.0% | 5.34 |
| 2024 | 433 | 99.1% | 98.6% | 97.9% | 97.2% | 5.14 |
| 2025 | 432 | 94.7% | 94.7% | 94.0% | 94.4% | 4.32 |

2025 misses 24 backtest bouts (verifier's count):
- the 9 July-19 undercard bouts that BFO never listed (research/model_market.md);
- 2 more July-19 bouts and the whole 2025-07-12 card (12 bouts). That card's page is not in market.py's page list
  (`bfo_event_props.csv`), which `event_list()` inherits, so it was never fetched;
- 1 matched bout without a six-way market.

**By card position** (fightweek.json card segments):

| segment | backtest bouts | m6 | all bouts incl. debut | m6 | round family |
|---|---|---|---|---|---|
| main card | 1,004 | 97.9% | 1,095 | 96.1% | 95.7% |
| prelims | 884 | 98.1% | 1,173 | 94.8% | 94.7% |
| early prelims | 155 | 96.1% | 218 | 92.2% | 92.2% |
| segment unknown | 76 | 94.7% | 91 | 74.7% | 73.6% |

**How to degrade.** Missing props are mostly a timing problem (early in fight week), not a card-position problem.
- No method family: the model's method given the winner (identity).
- Method family present: the pool.
- Rounds: always the model's shapes.
- No props at all: the cycle-1 package composed with the winner, unchanged.

The degrade costs nothing measurable: the all-fights rows of tables 5 and 6 differ from the with-props rows by under
0.001.

## 2. Consistency between families (outcome-free, all 2021-2025 development bouts)

| check | n | mean abs diff | mean diff | corr |
|---|---|---|---|---|
| P(decision): m6 vs goes-to-decision | 2,069 | 0.0128 | -0.0100 | 0.9970 |
| P(decision): m6 vs fight-ends-in-round | 2,067 | 0.0143 | -0.0131 | 0.9972 |
| P(decision): m6 vs fighter-wins-in-round | 2,063 | 0.0078 | -0.0036 | 0.9985 |
| P(decision): goes-to-decision vs ends-in-round | 2,067 | 0.0061 | -0.0030 | 0.9993 |
| P(A): m6 vs the same books' moneyline | 2,071 | 0.0134 | | 0.9954 |
| P(A): m6 vs fighter-wins-in-round | 2,063 | 0.0089 | | 0.9983 |
| P(inside the distance): m6 vs ITD market | 4,113 | 0.0173 | +0.0104 | 0.9940 |
| finish-round shape: ends-in-round vs wins-in-round (L1) | 2,061 | 0.0305 (p90 0.0613) | | |
| over 1.5 rounds inside the ends-in-round bounds (±0.02) | 2,033 | 99.95% inside | | |

The method market prices the fewest decisions, about 1 point fewer than the two-way decision market.

On the tuning years (2021-2023, 1,213 bouts, decisions 49.5%), every family under-prices decisions:
- m6 45.8%, gd 47.1%, er 47.4%, wr 46.1%;
- the decision log loss is close across families (er 0.6573, gd 0.6584, wr 0.6587, m6 0.6592).

No family-consistency variant helped method given the winner in CV:
- m6 rescaled to the m6/gd mean: -0.00002;
- m6 averaged with the method-by-round family: +0.0003.

## 3. The pool and the winner it is composed with

- **Experts.**
  - S2 cells: tools/ml2.py's method stage, re-run to keep every fold, out-of-fold 2020-2023 and fit through 2023 for
    2024-25. It reproduces ml2's CV (joint 2.14070, method 0.95945, 7-bin 1.60642) and its stored 2024-25 cells to
    5e-6.
  - SM cells (methodround with the closing line).
  - The props' method given the winner (from m6) and round shapes (er, wr or mr).
- **Winner.** W_close is cycle 1's close-regime stack: market (power close) + ML v2, no intercept, non-negative,
  ml2's stack_fit, forward-chained. On 2021-2023 it scores 0.6150 vs 0.6173 for the close. Fit 2019-2023 weights are
  [market 0.763, ML v2 0.376]. W_ml2 (the ML v2 blend that S2+ml2win uses) is reported as a secondary.
- **Composer.** P(A, method m, round r) = (1 - draw) W M[A][m] R[A][m][r], with draw = draw_c (0.01457) x P(decision).
  P(A) / (P(A) + P(B)) therefore equals W, and every compared package differs only in its conditionals.
- **Forms tried.**
  - log: log p = sum_j w_j log M_j + beta;
  - lin: p = sum_j w_j M_j;
  - jlin: p(side) proportional to sum_j w_j W_j(side) M_j(side), with W_j = source j's own P(side wins);
  - each with an optional decision (and submission) tilt beta;
  - a book-count weight on the props;
  - SM as a third expert.
  - Rounds: log or lin pools of S2's shapes with each props round family, plus optional format round biases
    (3-round only).

## 4. Selection (forward-chained CV 2022-2023; `props.json cv.selection`)

Method given the winner, on fights with method props (n = 790 decisive):

| stage | candidate | CV | vs current | decision |
|---|---|---|---|---|
| 0 | S2 | 0.95273 | | start |
| 1 | S2+P log | 0.93614 | -0.01659 | |
| 1 | S2+P log [m6/gd consistent] | 0.93612 | -0.01661 | |
| 1 | S2+P log [m6/mr consistent] | 0.93647 | -0.01626 | |
| 1 | S2+P lin | 0.93563 | -0.01710 | |
| 1 | S2+P jlin [m6/mr] | 0.93476 | -0.01797 | |
| 1 | **S2+P jlin** | **0.93444** | **-0.01828** | accepted |
| 2 | + decision tilt | 0.93623 | +0.00179 | rejected |
| 2 | + decision and submission tilts | 0.93695 | +0.00251 | rejected |
| 3 | + book-count weight | 0.93524 | +0.00079 | rejected |
| 4 | + SM as a third expert | 0.93793 | +0.00348 | rejected |

Comparators on the same rows: props alone 0.94672; the current 40/60 blend's conditionals 0.93466.
- The 40/60 weight was chosen on 2021-2023 (methodround), so its CV number here is partly in-sample.

Round given side and method, on finishes with every round family (n = 414). Gate: methodround's unsided round given a
finish not worse than the current choice by more than 0.002 (V6_V10_PLAN Cycle 2).

| candidate | CV | vs S2 shapes | gate (unsided) | |
|---|---|---|---|---|
| S2 shapes | 1.04795 | | 1.04621 | start, kept |
| S2+P[ends in round] log / lin | 1.05326 / 1.05344 | +0.0053 / +0.0055 | +0.0040 / +0.0034 | fail |
| S2+P[wins in round] log / lin | 1.04946 / 1.04905 | +0.0015 / +0.0011 | +0.0024 / +0.0013 | fail / pass but worse |
| S2+P[most specific] log / lin | 1.04594 / 1.04632 | -0.0020 / -0.0016 | +0.0024 / +0.0022 | fail |
| + format round biases | | | | not reached |

Chosen: **joint-linear S2 + props for method given the winner, S2 round shapes**. Weights fit on 2021-2023: S2 0.460,
props 0.540 (frozen for the look). Production refit on 2021-2025: 0.427 / 0.573. The corner swap of the chosen pool
mirrors the joint to 1.7e-16.

## 5. CV packages (W_close, fights with method props, 2022-2023 forward-chained, n = 797)

| package | 7-bin | method given winner | round given finish | method | finish | who x how x when |
|---|---|---|---|---|---|---|
| S2 (cycle-1 cells) | 1.5965 | 0.9527 | 1.0455 | 0.9721 | 0.6488 | 2.1409 |
| props alone | 1.5918 | 0.9467 | 1.0501 | 0.9632 | 0.6494 | 2.1373 |
| current 40/60 blend | 1.5793 | 0.9347 | 1.0468 | 0.9574 | 0.6433 | 2.1223 |
| **pool** | **1.5790** | **0.9344** | 1.0462 | **0.9573** | **0.6429** | 2.1234 |

| minus S2 | 7-bin | method given winner | round given finish | method | who x how x when |
|---|---|---|---|---|---|
| props alone | -0.0047 [-0.0273, +0.0170] | -0.0060 [-0.0290, +0.0157] | +0.0046 [-0.0082, +0.0168] | -0.0089 [-0.0286, +0.0090] | -0.0036 [-0.0285, +0.0210] |
| current 40/60 blend | -0.0172 [-0.0318, -0.0032] | -0.0181 [-0.0331, -0.0038] | +0.0013 [-0.0069, +0.0092] | -0.0148 [-0.0274, -0.0029] | -0.0185 [-0.0349, -0.0028] |
| pool | -0.0175 [-0.0311, -0.0043] | -0.0183 [-0.0321, -0.0051] | +0.0007 [-0.0002, +0.0016] | -0.0148 [-0.0265, -0.0039] | -0.0175 [-0.0311, -0.0043] |

- P(decision) on these fights: observed 48.1%. Predicted: S2 50.6%, props 45.2%, blend 46.9%, pool 47.5%.
- Leave-one-year-out 2021-2023 (1,215 fights): pool minus S2 7-bin -0.0162 [-0.0274, -0.0052]; blend -0.0159.
- With W_ml2 in place of W_close, every difference is within 0.0003 of the rows above.
- As published (each package with its own winner): pool minus the 40/60 blend 7-bin -0.0027 [-0.0065, +0.0012].

## 6. 2024-25, the single pre-registered look (W_close, fights with method props, n = 830)

| package | 7-bin | method given winner | round given finish | method | finish | who x how x when |
|---|---|---|---|---|---|---|
| S2 (cycle-1 cells) | 1.5042 | 0.9006 | 1.0631 | 0.9283 | 0.6596 | 1.9911 |
| props alone | 1.4940 | 0.8895 | 1.0626 | 0.9233 | 0.6536 | 1.9805 |
| current 40/60 blend | 1.4878 | 0.8838 | 1.0591 | 0.9188 | 0.6512 | 1.9728 |
| **pool** | **1.4870** | **0.8830** | 1.0623 | **0.9178** | **0.6503** | 1.9739 |

| comparison | 7-bin | method given winner | round given finish | method | who x how x when |
|---|---|---|---|---|---|
| pool minus S2 (primary: 7-bin) | **-0.0172 [-0.0283, -0.0056]** | -0.0177 [-0.0289, -0.0061] | -0.0008 [-0.0018, -0.0000] | -0.0104 [-0.0184, -0.0025] | -0.0172 [-0.0283, -0.0056] |
| pool minus the current 40/60 blend | -0.0008 [-0.0023, +0.0005] | -0.0008 [-0.0022, +0.0005] | +0.0032 [-0.0075, +0.0143] | -0.0010 [-0.0020, +0.0001] | +0.0011 [-0.0043, +0.0066] |
| pool minus props alone | -0.0070 [-0.0172, +0.0028] | -0.0066 [-0.0169, +0.0031] | -0.0003 [-0.0169, +0.0171] | -0.0055 [-0.0124, +0.0012] | -0.0066 [-0.0196, +0.0066] |
| current 40/60 blend minus S2 | -0.0164 [-0.0288, -0.0035] | -0.0169 [-0.0292, -0.0040] | -0.0041 [-0.0152, +0.0065] | -0.0095 [-0.0183, -0.0006] | -0.0183 [-0.0316, -0.0049] |

**Pre-registered checks:**

| check | result |
|---|---|
| primary: pool not worse than S2 with a CI excluding 0 | pass, -0.0172 [-0.0283, -0.0056] (CV said -0.0175) |
| method given winner vs the 40/60 blend, upper bound +0.003 | pass, upper bound +0.0005 |
| round given finish vs S2, not worse by more than 0.002 | pass, -0.0008 |
| P(decision) within 2 points of observed | **FAIL**: observed 54.2%; pool 47.8%, S2 48.8%, props 47.0%, blend 47.3% |

**Other rows:**
- All fights with the degrade (857): pool minus S2 7-bin -0.0167 [-0.0273, -0.0058].
- W_ml2 instead of W_close: -0.0173 [-0.0285, -0.0060].
- As published, each with its own winner: pool (W_close) minus the 40/60 blend -0.0055 [-0.0100, -0.0010]. That
  difference is mostly the sharper winner, not the method part.

**Card segment** (descriptive; pool minus S2, 7-bin):

| segment | n | pool minus S2, 7-bin |
|---|---|---|
| main card | 380 | -0.0175 [-0.0332, -0.0014] |
| prelims | 353 | -0.0173 [-0.0331, -0.0018] |
| early prelims | 66 | -0.0099 [-0.0496, +0.0335] |
| unknown | 31 | -0.0276 [-0.0870, +0.0525] |

**Confirmation-look caveat.** The S2, props and 40/60 numbers on 2024-25 were already known from research/model_ml2.md
section 7 and research/model_methodround.md. Only the pool's numbers are new, and the pool equals the 40/60 structure
with a refit weight. So this look mostly confirms wiring and stability. The clean tests are vault audit 2 and the
forward ledger.

## 7. Debut bouts (secondary universe)

**Universe.** tools/debut.py's debut bouts: at least one side with 0 prior UFC bouts. They are disjoint from the
backtest universe.
- The expert is the debut METHOD model, annual walk-forward exactly as tools/debut.py runs it (frozen CV choices,
  lambda from its CV), fed the close where there is one.
- Props are matched by date and names to the same extract. 2021-2025 debut bouts with method props: 71, 85, 108, 81,
  82.

| CV 2022-2023 (193) | method given winner | method (W = close) | who x how |
|---|---|---|---|
| debut model alone | 1.00129 | 0.99598 | 1.56171 |
| props alone | 1.00116 | 0.97293 | 1.56157 |
| debut + props, log (chosen) / lin / jlin | 0.98628 / 0.98631 / 0.98631 | 0.96825 | 1.54670 |
| chosen minus debut alone | -0.0150 [-0.0514, +0.0198] | -0.0277 [-0.0590, +0.0005] | |

| 2024-25 look (163) | method given winner | method | who x how |
|---|---|---|---|
| debut model alone | 0.9414 | 0.9808 | 1.5139 |
| props alone | 0.9076 | 0.9632 | 1.4801 |
| pool (log; debut 0.443, props 0.552, fit 2021-2023) | 0.9050 | 0.9587 | 1.4775 |
| pool minus debut alone | **-0.0364 [-0.0726, -0.0027]** | -0.0220 [-0.0484, +0.0025] | -0.0364 [-0.0726, -0.0027] |
| pool minus props alone | -0.0026 [-0.0297, +0.0260] | -0.0045 [-0.0241, +0.0155] | |

Production weights (2021-2025): debut 0.400, props 0.633. JS: `pool.debutMethod({debut: {A, B}, pW, books | props})`.

## 8. Leakage and protocol checks

- **2026.** event_list and the extract stop at 2025-12-31 (asserted). load_extract skips any 2026 row.
  build_db.parse_fights is wrapped through tools/ml2.py, and the method table asserts its last date is before 2026.
  No 2026 prop was collected, so nothing went to the vault directory.
  - Audit 2 note: 2026 full-family props exist on BFO's pages. The repo's older `bfo_event_props.csv` (market.py)
    holds 2026 rows; these files are not read here.
- **Selection.** Every choice comes from the forward-chained folds 2022-2023, with 2021 for fitting only:
  - prop family and representation;
  - pool form;
  - tilts and book weighting;
  - SM;
  - round pooling and its gate.

  family_scores reads only 2021-2023 outcomes. Consistency and coverage are outcome-free and use all development
  rows.
- **The look.** The pre-registration (out/props_cache/prereg.json, embedded in data/derived/props.json) was committed
  in b3312e2 before `valid` ran. `valid` refuses a second run (out/props_cache/valid.done). Parameters were frozen
  from the CV run.
- **Symmetry.** No pool term depends on the corner: per-side conditionals only, shared tilts. Swapping every input
  mirrors the joint: Python 1.7e-16, JS 2.2e-16 on 30 vectors. The winner is untouched by construction.
- **Reproduction.**
  - S2 / S2+ml2win cells reproduce ml2 (CV 2.14070; 2024-25 cells to 5e-6).
  - W_ml2 matches ml2.json to 5e-5.
  - JS matches Python from raw book prices to 1.7e-16 per cell, and the de-vigged families to 1e-9.
- **Comparability.** Metrics are methodround's `per_fight_losses`. Intervals use its `cluster_bootstrap` /
  `paired_diff` (event clusters, 2,000 resamples). The winner stack is tools/ml2.py's `stack_fit`. These are the same
  machinery as ml2's method stage and stacks.
  - The blind-test plugin `props_pool` publishes 7-bin bins for all 865 window fights. Its P(A) is W_close, so in the
    winner tables it is the close stack.
- **Fix after the look, outputs unchanged.** `_dec_q` treated an empty "wins by decision" cell as present, so it never
  fell back to unanimous + split. No bout-book in the 2021-2025 extract has that pattern: the table was rebuilt
  identical, and props.json's numbers did not change.

## 9. Caveats

- **Only two forward folds** (2022, 2023), about 800 fights. The plan says so. Leave-one-year-out agrees.
- **Closing props only.** Ledger snapshots come T-25h to T-8h before the lock, and earlier props are thinner. For
  moneylines, close-trained weights fed an opener cost +0.010 (research/model_ml2.md). Whether that holds for props is
  untested: there is no timestamped history. Capture snapshots and compare on the forward ledger.
- **The current 40/60 blend's CV number is partly in-sample.** Its weight was chosen on 2021-2023, and it uses
  market.json's older props. The pool's tie with it is the expected outcome, not a gain.
- **Decision drift.** The 2024-25 decision share was 6-7 points above every source. A decision tilt fit on 2021-2023
  is rejected and would not have fixed it. Do not fit one on 2024-25 (V6_V10_PLAN section 5). Track the share in the
  v9 drift monitor.
- **Debut samples are small.** 193 CV bouts and 163 look bouts. The look's CI just excludes 0.
- **BFO coverage limits.** US books only (BetMGM, BetRivers, BetWay, Caesars, DraftKings, FanDuel, Unibet); no sharp
  book. 2021 has 3.4 books per bout, versus 5+ from 2022.
- **Single-book props are weak (verifier).** On the 196 single-book bouts of 2021-2023 (194 of them BetWay-only in
  2021), the props' method given the winner is +0.0285 worse than S2. On 3+ book bouts it is -0.0117 better. The
  forward-chained folds hold only 8 single-book bouts, so CV could not test the book-count weight. Early-week
  captures with one book quoting get the full props weight. Monitor this on the ledger. Do not tune it on 2024-25.

## 10. Reproduce

```
nice -n 5 python3 tools/props.py fetch     # about 15 min the first time (286 pages, >= 2.5 s apart); then cached
nice -n 5 python3 tools/props.py extract   # -> data/raw/odds/bfo_props_full.csv
nice -n 5 python3 tools/props.py table     # match, de-vig per family, coverage
nice -n 5 python3 tools/props.py cells     # S / S2 / SM / S2+ml2win per fold (about 15 s; needs out/ml2_cache)
nice -n 5 python3 tools/props.py winner    # W_ml2, W_close
nice -n 5 python3 tools/props.py debut     # debut-bout pool CV (needs out/debut_cache)
nice -n 5 python3 tools/props.py cv        # selection + CV tables + LOYO (seconds)
python3 tools/props.py prereg              # before the look
python3 tools/props.py valid               # the single 2024-25 look (refuses a second run)
python3 tools/props.py export              # data/derived/props.json
node tests/test_propspool.js               # JS vs Python parity, symmetry, degrade, debut pool
python3 tools/props.py capture [--until YYYY-MM-DD]   # forward snapshot -> data/predictions/props_snapshot_<UTC>.json
```

Every number in this note is in `data/derived/props.json`:
- tables 4-5: `cv`; table 6: `valid`; section 7: `debut_cv` and `valid.debut_bouts`;
- sections 1-2: `coverage`, `consistency`, `families_tune_2021_2023`.

## 11. Integration recipe (v7, forward ledger)

- **Fight week.** Run `python3 tools/props.py capture` with the odds snapshot. Each bout record carries:
  - `books` (raw prices, page order) and `swap`;
  - the A/B-oriented `consensus`;
  - `fetched_utc` per page, and `bout_id` / `a` / `b` / `segment` from cards_upcoming.json.
- **predict().** `PropsPool.create(model).predict({pA, rounds, model: cells, props: bout.consensus})`.
  - `pA` is the bout's winner (the ledger's p_a);
  - `cells` are the method-and-round model's cells (MethodRound `predict().cells`); their own P(A) is used as
    `pModel`, as in training;
  - the result: `cells`, `p_method` (the ledger's seven keys), `p_distance`, `fin_round`, `source`.
  - With no method props, `source` is "model (no method props)" and the cells are the model's, composed with pA.
- **Debut bouts.** `pool.debutMethod({debut: {A: given_a, B: given_b}, pW: p_a, props})` replaces `given_a` /
  `given_b`. The round split stays the ledger's division profile.
- **Parameters.** Backtests of 2024-25 use `params: "fit_2021_2023"`. Live use takes the default production
  parameters (refit 2021-2025).
- **Pre-registration.** A ledger version that adopts this needs a new fwd version entry before the lock
  (V6_V10_PLAN 6.4).

## Verification log

Adversarial verifier, Nov 7, 2026, about 12:05 to 12:40 am UTC. Command: `nice -n 5 python3 tools/props_verify.py`
(about 20 s), which writes `data/derived/props_verify.json`. Every verifier number below is in that file.

**Verdict: the gain is real, but it is the gain production already has. Adopt the props path in predict() as an
equivalent of the 40/60 blend (no claimed gain) and the debut-bout pool (a new use, monitored).**
- Against S2 (v6's cycle-1 cells): the props pool is a clear, reproducible gain. Verifier CV 2022-23 7-bin
  -0.0178 [-0.0312, -0.0039]; builder -0.0175 [-0.0311, -0.0043].
- Against the incumbent 40/60 blend it is a tie: CV -0.0004 [-0.0019, +0.0009], under the 0.0005 rule. Read the v7
  swap as engineering (refit weight, one de-vig from raw book prices in training and live), not as a gain.
- The debut-bout pool passes the 0.0005 point rule in CV (-0.0123 [-0.047, +0.021]; CI includes 0). The 2024-25
  re-score agrees (-0.0385 [-0.069, -0.010]).

### What was re-derived with independent code

- **Props.** Own parse of `data/raw/odds/bfo_props_full.csv` (14,892 rows, 0 rows dated 2026, 0 invalid American
  odds), own power de-vig per book, own outlier rule, own mean over books.
- **Join and outcomes.** Own date (±1 day) and fuzzy-name join to backtest_dev.json; own outcome coding from
  `result`.
- **Winner stack.** Own W_close: market + ML v2, no intercept, weights ≥ 0, forward-chained.
- **Pool and scoring.** Own joint-linear pool, fit by a 1,001-point grid over its single weight. Own 7-bin, method
  given the winner and method3. Own event-cluster bootstrap (2,000 resamples of cards, paired).
- **Comparator inputs taken from the builder's caches.** S2 / S2+ml2win cells, W_ml2, market.json's props joint
  (for the 40/60 blend) and the debut model's walk-forward cells. They were checked against ml2's stored outputs:
  W_ml2 vs ml2.json max |d| 5.0e-5; S2+ml2win 2024-25 cells vs ml2's cache 5.0e-6. Outcome coding agrees with the
  23-cell y on every bout; the 3 DQs are excluded both ways.
- **Builder's own code.** The builder's `table` and `cv` stages were re-run into a scratch cache. The rebuilt table
  has 0 differing family entries out of 2,864, so the post-look `_dec_q` fix changed nothing. CV, parameters and
  CIs reproduce bit for bit.

| quantity (same winner W_close) | builder | verifier |
|---|---|---|
| CV n (7-bin / method given winner) | 797 / 790 | 798 / 791 |
| CV jlin S2 weight (fold 2022, 2023) | 0.46 (fit 2021-23) | 0.455, 0.420; 0.462 fit 2021-23 |
| CV pool − S2, 7-bin | -0.0175 [-0.0311, -0.0043] | -0.0178 [-0.0312, -0.0039] |
| CV pool − S2, method given winner | -0.0183 [-0.0321, -0.0051] | -0.0182 [-0.0316, -0.0042] |
| CV 40/60 blend − S2, 7-bin | -0.0172 [-0.0318, -0.0032] | -0.0174 [-0.0318, -0.0025] |
| CV pool − 40/60 blend, 7-bin | -0.0003 (no CI) | -0.0004 [-0.0019, +0.0009] |
| CV pool − blend, rows with both prop sources (790) | | -0.0002 [-0.0015, +0.0010] |
| CV pool − props alone, 7-bin | -0.0128 (no CI) | -0.0124 [-0.0225, -0.0032] |
| CV log pool − jlin pool | +0.0017 | +0.0017 [-0.0003, +0.0037] |
| CV P(decision): observed / pool / S2 / props | 48.1 / 47.5 / 50.6 / 45.2% | 47.9 / 47.4 / 50.5 / 45.0% |
| 2024-25 re-score n (7-bin) | 830 | 830 |
| 2024-25 pool − S2, 7-bin | -0.0172 [-0.0283, -0.0056] | -0.0171 [-0.0282, -0.0059] |
| 2024-25 pool − blend, 7-bin | -0.0008 [-0.0023, +0.0005] | -0.0006 [-0.0020, +0.0008] |
| 2024-25 P(decision): observed / pool | 54.2 / 47.8% | 54.1 / 47.8% |
| debut CV n, pool − debut model | 193, -0.0150 [-0.0514, +0.0198] | 195, -0.0123 [-0.047, +0.021] |
| debut 2024-25 n, pool − debut model | 163, -0.0364 [-0.0726, -0.0027] | 168, -0.0385 [-0.069, -0.010] |

The 2024-25 rows only re-score the builder's single look; nothing was selected on them.

### Protocol audit

- **Pre-registration before the look.** Confirmed from file times and commits:
  - prereg.json written 11:55:54 pm, committed in b3312e2 at 11:56:51 pm;
  - `valid.done` written 11:57:02 pm, the look committed in 4c3aa4e at 11:58:31 pm;
  - cv.json (11:54:21 pm) predates both.

  No earlier stage prints a 2024-25 outcome metric (`winner` skips 2024; `cells` logs 2020-23 only).
- **2026 data.**
  - The extract stops at the 2025-12-14 BFO page date (ufcstats 2025-12-13). The fits read dev fights only (asserted
    in the tool and here).
  - `event_list()` reads only slugs and dates from market.py's `bfo_event_props.csv`, filtered to dates before 2026.
    That file holds 2026 rows and belongs to another workstream.
  - The one committed 2026 artifact, `data/predictions/props_snapshot_20261107-0001.json`, covers only upcoming cards
    (Nov 7-21, 2026, fetched 12:01 am Nov 7). That is the forward-ledger category, like the odds snapshots. It holds
    no vault bout and no result.
- **Scraping.**
  - User-Agent FightLabSim/1.0, at least 2.0 s between requests (2.5 s + jitter by default), raw cache gitignored.
  - BFO's robots.txt, fetched again once: `Allow: /`, `Disallow: /cnadm/`.
- **Selection on 2024-25.** None found. Every choice comes from the 2022-23 forward folds. One mild point: the CV
  candidate that won (jlin) is the incumbent blend's structure, which earlier 2024-25 reports already favoured. It
  won CV on its own merit, and the builder says so.

### Look-ahead hunt

- **Late or in-play prices in the closing props.** market.json found leaked in-play prices in BFO moneyline closing
  ranges, so the props were tested the same way. No sign of leakage:
  - each book vs the mean of the other books, 9,538 book-bouts: the deviation on the realised six-way cell has sd
    0.0175 and 0 cases above +0.15. Deviations above 0.10 occur on 0.021% of realised cells vs 0.017% of
    non-realised cells;
  - no book is sharper than the others' consensus by more than 0.005 (per-book six-way log loss minus others,
    -0.0034 to +0.0049);
  - the method market's own P(A) is not sharper than the close: 0.6190 vs 0.6182 (2021-23, n = 1,204).
- **Fold structure.**
  - S2 cells: fit on years < Y, hazard on years < Y.
  - W_close: fit on 2019..Y-1. The verifier's own refit matches the builder's to 8.7e-4.
  - Pool: fit on 2021..Y-1.
  - Debut model cells: annual walk-forward (tools/debut.py).
- **Pre-existing, not props.** ml2's `method_new_cols` centres the pre-UFC features on all pre-2024 rows, so CV-year
  S2 cells use a centring constant that includes 2022-23 rows. It enters every compared package through S2, so it
  does not touch the differences.

### Corner order (free-intercept checks)

- **Swap tests.** Python 1.7e-16 and JS 2.2e-16; `node tests/test_propspool.js` gives 732 checks, 0 failures.
- **Free corner tilts inside the pool.** Separate A-side and B-side SUB / DEC tilts, fit forward-chained, make CV
  worse by +0.0080. Method given the winner carries no exploitable ordering signal.
- **Winner stack.** A free intercept on unmirrored 2019-23 data takes +0.135, the known artefact of A winning 57.1%
  of these fights. The stack has no intercept, and the pool cannot move the winner. Exported cells give P(A) / (P(A)
  + P(B)) = W_close to 2e-5 (5-decimal rounding).

### Joins and match bias

- **Backtest join.** The verifier's own date-and-name join finds 2,086 bouts. 2,081 of them carry the same BFO
  matchup id as market.json. The other 3 that also have a market.json id are BFO duplicate listings of the same bout.
  The props' orientation never disagrees with the builder's.
- **Bouts without method props.** 50 of 2,119 (2.4%); not random but harmless:
  - where they fall: concentrated in 2025 (24) and in a few 2022-23 PPV bouts (e.g. UFC 281, 287);
  - decision share: 43.8% vs 50.9% with props (n = 50, not significant);
  - why it is harmless: comparisons are paired on the same rows, and the all-fights degrade row covers these bouts.
  - The report's 2025 coverage note was incomplete and is corrected above: a whole card, 2025-07-12, was never
    fetched because `event_list()` inherits market.py's page list.
- **Debut join recall.** The debut-bout join (MK.name_sim ≥ 0.8 on raw names) misses 15 of the 452 debut bouts that
  do have props, mostly name variants:
  - examples: Lupita / "Loopy" Godinez, Zhu Rong / "Rongzhu", Ariane Lipski / "da Silva", Cheyanne Buys / Vlismas;
  - 8 of the 15 are in 2021;
  - with them included the conclusion is unchanged (table above).

  Not fixed in tools/props.py: rebuilding the debut cache would change pre-registered, frozen parameters. Live use is
  unaffected, because `capture` orients to cards_upcoming.json.

### Gates re-run

| gate (forward-chained CV 2022-23, 0.0005 rule) | result |
|---|---|
| props pool vs S2, method given winner | pass: -0.0182 |
| props pool vs incumbent 40/60 blend | **fail (tie):** -0.0004 [-0.0019, +0.0009] |
| plan's Cycle 2 train test vs cycle-1 cells (7-bin CI excludes 0; method not worse; P(decision) within 2 points: 47.4 vs 47.9%; winner bit-identical) | pass |
| winner stack: + the method market's P(A) on top of close + ML v2 | fail: +0.0004 (n = 791) |
| round given a finish: S2 1.0455, props "ends in round k" 1.0507, 0.75/0.25 mix 1.0453 | no props round shape earns its place (builder's +0.002 gate also fails) |
| debut pool vs debut model alone | pass on the point estimate: -0.0123 (CI includes 0) |

### Corrections made to this note

1. Bottom line, table 1: added the verifier's CIs for the two unbootstrapped CV rows, and stated that the pool fails
   the gate against the incumbent.
2. Bottom line, item 4: the debut claim now says the CV gain passes the point rule with a CI that includes 0.
3. The v7 recommendation now says the swap is not a gain over production.
4. Section 1: the 2025 coverage gap is corrected.
5. Caveats: added the single-book finding. On 196 single-book bouts (2021-23, 194 of them BetWay-only in 2021) the
   props are +0.0285 worse than S2, against -0.0117 better on 3+ books. CV could not test this, because the scored
   folds hold only 8 single-book bouts.

### Not changed

- **tools/props.py.** No defect that changes a scored number was found.
- **Incidental: the blind-test harness.** `tools/blindtest.py score --quick` rewrote data/derived/blindtest.json and
  research/model_blindtest.md in the repo, although `--quick` is documented as writing nothing. The verifier restored
  both files to HEAD; that harness belongs to another workstream. The plugin itself works: a replay into a scratch
  file gives props_pool 7-bin 1.4870 on 857 fights and an order check of 0.0225 (close 0.028).

### Decision

**adopt = true, scoped:**
- (a) Props enter predict() through `PropsPool`. It is the same model as the 40/60 blend, with a forward-chained
  weight, S2 round shapes and the raw-price power de-vig shared by training and `capture`. The plan's "one de-vig
  everywhere" item is met. It is a tie with the incumbent, so log no gain.
- (b) The debut-bout pool is a monitored addition. It needs its own pre-registered forward version before it
  governs a card.
- (c) Winner unchanged; round props, the decision tilt, SM and the book-count weight stay rejected.
- The 2024-25 P(decision) miss (54.1% observed vs 47.8%) is shared by every source and belongs to the v9 drift
  monitor.
