# Crowd wisdom: community and expert consensus picks (task key: crowd)

Nov 6, 2026, 10:20-10:50 pm UTC (this run picked up the partial work of an earlier run that a container restart
killed at about 10:22 pm). Tool: `tools/crowd.py`. Data: `data/derived/crowd.json`. Plugin:
`tools/blindtest_plugins/crowd.py`. Test: `tests/test_crowd.py`. Raw pages: `data/raw/crowd_cache/` (gitignored).

All brackets are 95% event-cluster bootstrap CIs (2,000 resamples of UFC cards), paired where they are differences;
negative = the first-named model is better. Log loss throughout, lower is better.

## Bottom line

1. **The crowd does not help any prediction we make. Nothing is adopted.**
   - The pre-registered gate is forward-chained stack CV 2021-2023 with ml2's 0.0005 rule. No crowd column passes it
     in the no-line, open or close stacks, or in their page variants: 6 base stacks x 10 variants. The best gain is
     -0.00033, in the page no-line stack (+ crowd).
   - The decisions were frozen and committed (f84277b, about 10:41 pm UTC) before the one 2024-25 look. On 2024-25
     every crowd expert lands within ±0.0013 of its base stack, and none is significant.
2. **Taken alone, the crowd's pick share is a weak forecaster.** It beats Elo. It loses to ML v2, to the close and,
   before 2024, to the open:

   | 2019-2023, forward (470 fights, 104 cards) | log loss | accuracy | crowd minus it [CI] |
   |---|---|---|---|
   | crowd (RotoWire panel + Money MMA contest), calibrated forward | 0.6420 | 64.9% | |
   | Elo (ml.json) | 0.6891 | 54.2% | -0.0471 [-0.0674, -0.0262] |
   | Elo, strike-weighted (elo_sig) | 0.6742 | | -0.0322 [-0.0534, -0.0101] |
   | ML v2 blend (out of fold) | 0.6138 | 65.5% | +0.0282 [+0.0082, +0.0475] |
   | opening line | 0.6173 | 65.6% | +0.0247 [+0.0085, +0.0397] |
   | closing line | 0.6056 | 67.2% | +0.0365 [+0.0194, +0.0528] |

   The 2024-25 look (268 fights) says the same: crowd 0.6370, against Elo -0.0404 [-0.0705, -0.0093], ML v2 +0.0328
   [+0.0039, +0.0568], the open -0.0010 [-0.0235, +0.0199] and the close +0.0184 [-0.0022, +0.0388].
3. **Method/round: there are no crowd method or round shares to test.**
   - The only source that publishes them, Tapology, is off limits (point 6).
   - What could be tested is the crowd's winner consensus as an input to ml2's method model S2. It fails ml2's
     method rule: CV joint -0.00039 against S2+ml2win. On 2024-25 it is slightly worse: +0.0011 [-0.0029, +0.0051].
4. **Debut bouts: too few to say.** The crowd sources cover main cards, and only 22 covered bouts before 2024 and 18
   in 2024-25 have a debutant. The point estimates go both ways, and no CI is meaningful at that size.
5. **No look-ahead.**
   - RotoWire panels count only when published at least one day before the card (471 bouts). Five same-day panels
     are dropped.
   - The Money MMA contest locks before the card. For the 19 cards whose rules are readable, each stated lock falls
     before the main card for that venue: 3 am ET for Shanghai, 10 am ET for Abu Dhabi, 4-7 pm ET for US Fight
     Nights and 6-6:30 pm ET for pay-per-views.
   - Leak check (before 2024): where the crowd's majority disagrees with the closing favourite, the crowd's side wins
     only 38% (RotoWire, 20 of 52) and 42% (Money MMA, 13 of 31). Picks made after the fights would win most of
     those disagreements.
   - A strict freeze, which keeps only cards with a pre-event contest post, gives the same verdict everywhere.
6. **Sources.**
   - **Tapology, the brief's primary source, was not used.** Its robots.txt disallows `anthropic-ai`, `Claude-Web`
     and `ClaudeBot` for the whole site (re-checked 10:30 pm UTC). Fetching it under the project's User-Agent would
     only hide who is asking, so it was not fetched in any form.
   - Two permitted public sources with history were used instead:
     - the **RotoWire staff panel**: 3-7 writers, pay-per-view main cards in 2016 and 2019-2025;
     - the **Money MMA pick'em contest consensus**: about 50 entrants, the five main-card bouts of each card, Feb
       2022-Dec 2025.
   - Match rate to ufcstats fight ids: 99.2% (476 of 480 bouts) and 98.5% (583 of 592 picks).
   - Coverage: 743 of the 2,809 backtest fights in 2019-2025.
7. **Forward use.** `tools/crowd.py capture` writes RotoWire panel shares for an upcoming card to
   `data/predictions/crowd/`. The shares are oriented to the ledger's a/b, keyed by its bout_id, and checked against
   the card's earliest start. Money MMA can only be recorded after the card, for evaluation only.

**Recommendation.**
- Keep the crowd out of every production stack and out of the method model.
- Capturing RotoWire panels for pay-per-views is free and keeps a side record. The case for doing it is weak: the
  close and ML v2 already contain what the panels know.
- One descriptive pattern, for the ledger to watch and not to act on. Given the close, a crowd weight that is free in
  sign comes out slightly negative (-0.05 to -0.13), i.e. fade the public. The CV gain is -0.00017. On 2024-25 the
  Money MMA version is -0.0011 [-0.0024, +0.0003]. At the stack-vs-stack MDE of about 0.003 this is far from
  detectable.

## Sources and access

| source | what it gives | access decision |
|---|---|---|
| Tapology community predictions | winner %, method and round shares per bout | **not used**: robots.txt `Disallow: /` for anthropic-ai, Claude-Web, ClaudeBot (Nov 6, 2026); `import-csv` reads a permission-granted export if Kira ever has one |
| RotoWire staff / expert picks (rotowire.com/mma/article/...) | each writer's winner pick, every main-card bout of each pay-per-view | used; robots.txt allows every agent; its llms.txt invites LLM use |
| Money MMA pick'em results (moneymma.substack.com) | share of contest entrants picking the majority side, for 5 bouts per card | used; robots.txt allows every agent; free part of each post only |
| Money MMA contest-entry posts | the lock time (free part from 2025; paywalled before) | used for the freeze check |
| MMA Junkie, MMA Fighting, MMA Mania, Cageside Press, ESPN, BetMMA.tips, Bleacher Report, OpenML /api/ | staff picks / pick datasets | not used: robots.txt names Anthropic agents (earlier run's audit) |
| Bloody Elbow, Sherdog staff pick'em, VerdictMMA, MMASucka | staff picks | not used: 403 / picks as an image / picks behind a disallowed /api/ / no parseable table |

Scraping followed the brief: User-Agent "FightLabSim/1.0", robots.txt checked for that agent and for the Anthropic
agent names, at least 2.2 s between requests, no logins, nothing behind the paywall.
- 297 pages were cached: 96 RotoWire articles, 125 Money MMA results posts, 76 contest posts.
- No 2026 page was fetched. The sitemap filters are a pay-per-view number of 323 or lower, and a lastmod before
  2026-01-01.

## Data, matching, coverage

- Fights come from ufcstats via tools/build_db.py. 480 fights dated 2026-01-01 or later are dropped at parse.
- **Orientation.** A is the first ufcstats name, as in the backtest. `share_a` is the share of the panel (or of
  contest entrants) picking A.
- **Matching.**
  - A RotoWire bout is matched by both names, in either order, inside the window from the publish day to 10 days
    after it.
  - A Money MMA pick is matched by one name, unique in the 9 days before the results post.
  - RotoWire pairs accept aliases, such as "Ian Garry"/"Ian Machado Garry" and married names (the Money MMA
    single-name matcher does not: see the verification log, V4). A different opponent is
    rejected (selftest).

| source | bouts or picks | matched | rate | unmatched (all listed in crowd.json meta.match) |
|---|---|---|---|---|
| RotoWire | 480 bouts in 96 articles | 476 | 99.2% | 4: misspelt names (Adrade, Felcia) and one cancelled bout |
| Money MMA | 592 picks in 125 posts | 583 | 98.5% | 9: name variants ("Muniz/Park" listed as a pair); the consensus side won 7 of the other 8 (verification log, V4) |

**Inputs as probabilities.**
- **rw** = (n_a + 0.5) / (n + 1). The panel share is shrunk by half a pick per side.
- **mm** = share_a, clipped to [0.03, 0.97].
- **crowd** = the mean logit of whichever of the two is present.
- All three are symmetric: swapping the corners gives 1 - p exactly (tests/test_crowd.py checks every record).

**Coverage of the backtest stack table** (tools/ml2.py stack.pkl: 2,809 fights, 2019-2025):

| year | rows | rw | mm | crowd (either) | mm strict |
|---|---|---|---|---|---|
| 2019 | 388 | 47 | 0 | 47 | 0 |
| 2020 | 343 | 51 | 0 | 51 | 0 |
| 2021 | 415 | 60 | 0 | 60 | 0 |
| 2022 | 419 | 59 | 133 | 149 | 73 |
| 2023 | 390 | 62 | 160 | 163 | 71 |
| 2024 | 429 | 62 | 96 | 115 | 51 |
| 2025 | 425 | 56 | 158 | 158 | 87 |

The crowd covers 30% of the 2021-2023 CV rows (372 of 1,224) and 32% of 2024-25 (273 of 854). Whole-population
gains are therefore diluted by about 3x relative to the covered rows, so the covered-row differences are reported
too.

## Freeze (when the shares are fixed)

**RotoWire.**
- The article's JSON-LD `datePublished` must be at least one calendar day before the ufcstats event date.
- Days before the card, over all 476 matched bouts (crowd.json `meta.rw_days_published_before_event`): 4 days for 15
  bouts, 3 for 71, 2 for 355, 1 for 30, and 0 (same day) for 5. The same-day bouts are kept in the file but never fit
  or scored.
- After the card, the articles are re-saved with losing picks struck through and the panel's records added. Only the
  cell text is read; strike marks are never used.
- Consistency check: the strike marks agree with the results on 2,764 of 2,773 decisive pick cells. The picks shown
  are the picks RotoWire scored.

**Money MMA.**
- Entries in a prize contest lock before the card. The results post (1-9 days after the card) reports the share of
  entrants picking each side.
- `parse_contest` reads the lock statement in a contest post's free part. `lock_status` compares it with the earliest
  typical main-card start for the venue's region, in ET on the event date (`LOCK_BOUND_ET`): US pay-per-views 10 pm,
  other Americas cards 7 pm, Europe 1 pm, the Middle East noon, Asia 5 am, Oceania 9 pm.

| category | meaning | bouts (2022-2025) | used |
|---|---|---|---|
| lock_verified | the card's lock is readable, on the event day, before the bound (19 cards, all 2025) | 93 | yes |
| contest_pre_event | a contest post was published before the card; rules paywalled (2022-24) or stale (UFC 312 repeats UFC 311's date) | 210 | yes |
| by_design | no contest post found for the card; kept on the contest's rules | 280 | yes; dropped in the strict sensitivity (mm_s, crowd_s) |
| lock_after_bound | the stated lock is later than the main card's start | 0 | would be dropped |

**Leak checks** (before 2024, fights with a close; `cv.freeze`):

| source | n | crowd majority accuracy | close favourite accuracy | disagreements | crowd side won |
|---|---|---|---|---|---|
| RotoWire | 279 | 63.8% | 68.8% | 52 | 20 (38%, [25%, 53%]) |
| Money MMA | 293 | 65.7% | 67.6% | 31 | 13 (42%, [25%, 61%]) |

## Test 1: the crowd alone

The crowd input is calibrated by one no-intercept slope, p = sigmoid(b z). The slope is fit forward on every covered
decisive UFC bout of the earlier years, and the 2024-25 look uses the slope fit on data through 2023.
- Slopes for the panel: 0.25 (2019) rising to 0.43 (2023).
- Slope for the contest: 0.56 (fit on 2022, so the stand-alone mm row is 2023 only; in 2022 the crowd row uses the
  panel-only slope on rows that are mostly contest shares).
- So the raw shares are very overconfident as probabilities. A 6-0 panel is about a 74% favourite, not 93%.
- Every row below uses the same fights: those with both lines.

| | period | n (cards) | crowd | Elo | elo_sig | ML v2 | open | close | crowd - close [CI] | crowd majority acc. |
|---|---|---|---|---|---|---|---|---|---|---|
| rw | 2019-23 | 279 (61) | 0.6431 | 0.6970 | 0.6600 | 0.5923 | 0.6059 | 0.5927 | +0.0504 [+0.0270, +0.0747] | 63.8% |
| mm | 2023 (no 2022 slope) | 160 (37) | 0.6422 | 0.6974 | 0.6903 | 0.6350 | 0.6308 | 0.6175 | +0.0247 [-0.0009, +0.0491] | 65.3% |
| crowd | 2019-23 | 470 (104) | 0.6420 | 0.6891 | 0.6742 | 0.6138 | 0.6173 | 0.6056 | +0.0365 [+0.0194, +0.0528] | 64.9% |
| rw | 2024-25 (look) | 113 (26) | 0.6235 | 0.6643 | 0.6461 | 0.5715 | 0.6210 | 0.5824 | +0.0411 [+0.0041, +0.0767] | 67.3% |
| mm | 2024-25 (look) | 249 (57) | 0.6453 | 0.6832 | 0.6764 | 0.6078 | 0.6346 | 0.6229 | +0.0223 [+0.0009, +0.0432] | 65.1% |
| crowd | 2024-25 (look) | 268 (61) | 0.6370 | 0.6774 | 0.6680 | 0.6042 | 0.6380 | 0.6186 | +0.0184 [-0.0022, +0.0388] | 66.4% |

**Crowd minus each benchmark:**

| benchmark | crowd, 2019-23 | crowd, 2024-25 (look) |
|---|---|---|
| Elo | -0.0471 [-0.0674, -0.0262] | -0.0404 [-0.0705, -0.0093] |
| elo_sig | -0.0322 [-0.0534, -0.0101] | -0.0310 [-0.0589, -0.0040] |
| ML v2 | +0.0282 [+0.0082, +0.0475] | +0.0328 [+0.0039, +0.0568] |
| open | +0.0247 [+0.0085, +0.0397] | -0.0010 [-0.0235, +0.0199] |
| close | +0.0365 [+0.0194, +0.0528] | +0.0184 [-0.0022, +0.0388] |

- The crowd's majority agrees with the closing favourite on 80-91% of bouts.
- These are main-card and pay-per-view bouts, where the close is sharper than on whole cards: 0.6056 here vs 0.6232
  on all 1,955 backtest fights of 2019-2023.

## Test 2: the crowd as a stack expert (the gate)

**Method.** This is tools/ml2.py's stack:
- logit inputs, no intercept, non-negative weights;
- an absent expert enters as 0, which is how ml2 treats any absent expert;
- recency half-life (none, 3 or 1.5 years) chosen with the 0.0005 penalty;
- forward-chained CV: fit on 2019..Y-1, score Y, for Y = 2021, 2022, 2023.

**Bases.** The CV-chosen ML v2 stacks and their page variants. Every base reproduces ml2's own CV and 2024-25 numbers.
For example, market+ml2 has CV 0.61614, and its 2024-25 static score is -0.0087 [-0.0134, -0.0041] against the close.

**Variants per base (10).**
- rw, mm, crowd, each with a non-negative weight or a weight free in sign ("signed": fade the public).
- The same with the strict Money MMA freeze (mm_s, crowd_s).

**Rule (pre-registered).**
- The best primary variant by CV must beat the base by more than 0.0005 on all of the regime's rows.
- A Money MMA variant must also pass with the strict freeze.

| base stack | base CV | best crowd variant | its CV gain | covered-row CV diff [CI] (n) | variants passing | 2024-25 static, that variant [CI] |
|---|---|---|---|---|---|---|
| close: market + ml2 | 0.61614 | mm (signed) | -0.00017 | -0.0007 [-0.0033, +0.0018] (293) | 0 of 10 | -0.0011 [-0.0024, +0.0003] |
| close: market + ml2lr (page) | 0.61624 | mm (signed) | -0.00016 | -0.0006 [-0.0033, +0.0019] (293) | 0 | -0.0010 [-0.0023, +0.0003] |
| no line: ml2 + mkt_rating + feat_lr | 0.62854 | crowd | -0.00020 | -0.0014 [-0.0069, +0.0048] (372) | 0 | +0.0010 [-0.0004, +0.0023] |
| no line: ml2lr + mkt_rating (page) | 0.62984 | crowd | -0.00033 | -0.0019 [-0.0077, +0.0045] (372) | 0 | +0.0011 [-0.0004, +0.0027] |
| open: open + ml2 | 0.62231 | mm (non-negative, weight 0) | +0.00010 | +0.0004 [-0.0014, +0.0023] (293) | 0 | +0.0000 |
| open: open + ml2lr (page) | 0.62275 | mm | +0.00008 | +0.0004 [-0.0015, +0.0023] (293) | 0 | +0.0001 [-0.0001, +0.0002] |

**Weights fit on data through 2023.**
- With a line (close or open), the non-negative crowd weight is 0 or under 0.013.
- Without a line it is 0.08-0.11 for mm and crowd, and 0-0.006 for rw.
- Signed weights with the close: rw -0.05, mm -0.09, mm_s -0.13, crowd -0.05.

**The one look, 2024-25** (`confirm.stack`, all 60 variants), static and rolling:
- every difference against its base is within ±0.0013, and none is significant in the static fits;
- two rolling no-line rows (mm in both no-line bases) are worse, with CIs just above 0: +0.0009 [+0.0001, +0.0016]
  and +0.0010 [+0.0001, +0.0019].

## Test 3: method and round

**No crowd method or round shares exist in a permitted source.**
- RotoWire cells are fighter names.
- Money MMA's contest asks for the method (a bonus point), but its published consensus gives winner shares only.

**What was tested instead.** The crowd's winner consensus as an input to the method model.
- Model: ml2's S2, i.e. methodround's 6-class logit plus the competing-risks round hazard, with C6 = 0.002, ml2's CV
  choice.
- Three side-oriented columns were added, zero where absent: the crowd logit for X, its absolute value, and a presence
  flag.
- Folds are ml2's: an expanding window scored on 2020-2023, with 1,581 fights, 426 of them covered.
- The machinery reproduces ml2's numbers: S2 CV joint 2.1436, S2+ml2win 2.1407; on 2024-25, S2+ml2win 7-bin 1.5171
  and method 0.9298.

| CV 2020-2023 (1,581 fights) | joint | method (KO/SUB/DEC) | 7-bin | winner | method given winner |
|---|---|---|---|---|---|
| S2 | 2.14364 | 0.96067 | 1.60936 | 0.63227 | 0.93340 |
| S2c (S2 + crowd) | 2.14261 | 0.96010 | 1.60833 | 0.63161 | 0.93311 |
| S2+ml2win (production choice) | 2.14070 | 0.95945 | 1.60642 | 0.62931 | 0.93340 |
| S2c+ml2win | 2.14031 | 0.95870 | 1.60603 | 0.62930 | 0.93311 |

| paired [CI] | CV, all fights | CV, covered (426) | 2024-25 (look, 857) | 2024-25, covered (276) |
|---|---|---|---|---|
| S2c+ml2win - S2+ml2win: joint (= 7-bin) | -0.0004 [-0.0032, +0.0025] | -0.0021 [-0.0128, +0.0079] | +0.0011 [-0.0029, +0.0051] | +0.0087 [-0.0012, +0.0199] |
| same: method | -0.0008 [-0.0034, +0.0018] | -0.0031 [-0.0123, +0.0057] | +0.0008 [-0.0029, +0.0045] | +0.0076 [-0.0025, +0.0181] |
| S2c - S2: joint | -0.0010 [-0.0040, +0.0019] | -0.0050 [-0.0163, +0.0060] | +0.0016 [-0.0024, +0.0059] | +0.0078 [-0.0035, +0.0194] |

**Rule.** ml2's method rule: the lowest-CV variant must beat the best variant without the crowd by more than 0.0005.
S2c+ml2win beats S2+ml2win by only 0.00039, so it is not adopted.

**Correction note.** The first draft of the rule compared each crowd variant only with its own twin. Under that draft,
S2c "passed" against S2 (-0.0010). But S2 is not the production variant, and S2c is worse than S2+ml2win. The rule
was corrected to ml2's own rule on the cv numbers, before the 2024-25 look, and the correction can only make adoption
harder.

## Test 4: debut bouts

**Design.**
- Debut bout: either side has no earlier UFC bout in ufcstats.
- crowd.json covers every bout the sources picked, so it includes debut bouts outside the backtest universe.
- Lines come from nlbair (BFO) as multiplicative no-vig probabilities.
- line + crowd is a two-weight stack with the crowd weight free in sign. Its weights are fit forward on every covered
  decisive bout of the earlier years.

| line | period | segment | n (cards) | crowd | line | line + crowd | line + crowd - line [CI] |
|---|---|---|---|---|---|---|---|
| close | 2017-23 | debut | 22 (19) | 0.5361 | 0.4655 | 0.4492 | -0.0163 [-0.0502, +0.0190] |
| close | 2017-23 | other | 472 (106) | 0.6447 | 0.6130 | 0.6187 | +0.0057 [-0.0053, +0.0194] |
| open | 2017-23 | debut | 22 (19) | 0.5361 | 0.4768 | 0.4681 | -0.0087 [-0.0462, +0.0287] |
| open | 2017-23 | other | 472 (106) | 0.6447 | 0.6225 | 0.6333 | +0.0108 [+0.0007, +0.0221] |
| close | 2024-25 (look) | debut | 18 (16) | 0.5319 | 0.5382 | 0.5490 | +0.0109 [-0.0223, +0.0486] |
| close | 2024-25 (look) | other | 268 (61) | 0.6371 | 0.6149 | 0.6166 | +0.0017 [-0.0060, +0.0099] |
| open | 2024-25 (look) | debut | 18 (16) | 0.5319 | 0.6019 | 0.5939 | -0.0080 [-0.0316, +0.0214] |
| open | 2024-25 (look) | other | 268 (61) | 0.6371 | 0.6382 | 0.6412 | +0.0029 [-0.0036, +0.0093] |

**Reading.**
- There are 22 and 18 debut bouts. The signs flip between the periods, and the forward fits of the early years rest on
  about 50 panel bouts from 2016-2017.
- The RotoWire-only row on 11 pre-2024 debut bouts (close + panel -0.0565 [-0.0868, -0.0268]) is one of 24 cells and
  rests on 10 cards. Treat it as noise until the forward ledger has its own debut sample. The 2024-25 look has a
  second such cell, open + contest on 18 debut bouts (-0.0293 [-0.0519, -0.0037]); it is a different source and line,
  and the matching close cell goes the other way (+0.0141 [-0.0122, +0.0402]).
- On non-debut bouts the crowd hurts the open stack in CV. That matches test 2.

## Protocol and symmetry checks

- **Vault.** Fights dated 2026-01-01 or later are dropped at parse (480). No 2026 page was fetched, and nothing was
  written to the vault directory (no 2026 row appeared). crowd.json holds no 2026 fight (asserted in eval and in the
  test).
- **Stages.**
  - `eval --stage cv` drops the 2024-25 rows from every table before computing anything and writes
    `cv.decisions`.
  - `eval --stage confirm` refuses to run unless those decisions exist and the data hash matches. It refuses a
    second look unless `--again` is passed, which reproduces the same numbers.
  - The earlier killed run had computed 2024-25 numbers in the same pass as its CV, before this split. No choice here
    used them: this run did not read them, and replaced them.
- **Corner swap test.** A random half of the rows has every expert and y flipped. Every stack, non-negative and
  signed, gives the same predictions to 2.2e-16. crowd_probs(p) + crowd_probs(swapped) = 1 exactly.
- **Orientation check, method test.** The crowd logit's sign agrees with ML v2's on 76% of covered method rows, as
  asserted.

## Forward capture (data/predictions)

```
nice -n 5 python3 tools/crowd.py capture --event "UFC 334: Gane vs. Hokit" --date 2026-11-14 [--dry-run]
nice -n 5 python3 tools/crowd.py capture --source moneymma --event "UFC 334: Gane vs. Hokit" --date 2026-11-14
```

**RotoWire.**
- Writes `data/predictions/crowd/<date>_<event>_rotowire_<stamp>.json` (write-once).
- Each bout is oriented to cards_upcoming.json's a/b and keyed by the ledger's bout_id (`date:slug_a__slug_b`). It
  carries n_a, n_b, share_a and the stack input p_a_input = (n_a + 0.5) / (n + 1).
- `before_lock` is true only when the capture time is before the card's earliest `start_utc`.
- RotoWire publishes 1-3 days before pay-per-views only. For UFC 334, run it on Nov 12 or 13. On Nov 6 the dry run
  found no article yet.

**Money MMA.**
- Records the consensus and the contest's lock check after the card. It is flagged "evaluation only" and is never a
  pre-lock input.

**Cards before the ledger's first card** (Nov 7, 2026) are 2026 history and go only to the vault (`--vault`).

## Reproduce

```
nice -n 5 python3 tools/crowd.py fetch                   # cache (skips cached pages; >= 2.2 s between requests)
nice -n 5 python3 tools/crowd.py build                   # crowd.json (keeps cv/confirm blocks if the data is unchanged)
nice -n 5 python3 tools/crowd.py eval --stage cv         # every CV number in this note (log + crowd.json "cv")
nice -n 5 python3 tools/crowd.py eval --stage confirm --again   # reprints the 2024-25 look (identical; crowd.json "confirm")
python3 tests/test_crowd.py                              # selftest + data invariants
```

- `eval` needs tools/ml2.py's caches: `out/ml2_cache/stack.pkl`, `fit.pkl`, `cv.json` and `method.json`.
- Run time is about 30 s (cv) and 30 s (confirm).
- The blind-test plugin registers crowd, crowd_rw, crowd_mm and moe_{noline,open,close}_crowd, all experimental
  (`python3 tools/blindtest.py list`).

## Caveats and open threads

- **Small covered samples.** Covered-row CIs are about ±0.003 with a line and about ±0.006 without. Only a large
  effect could have shown up. The best covered-row point estimate, no line + crowd at -0.0014 to -0.0019, is below
  even that.
- **Main-card bias.** Both sources pick main-card and pay-per-view bouts, where lines are sharpest and debutants are
  rare. A whole-card crowd source such as Tapology could behave differently on prelims and newcomers. That needs a
  licensed or permission-granted export (`import_csv`).
- **The lock bound is approximate.** `LOCK_BOUND_ET` is typical start times by region, not per-card broadcast times.
  It only bites on 2025 cards, and every one of them passed with hours to spare except Royval vs Kape (lock 7 pm ET,
  bound 7 pm).
- **Fade the public with the close.** The weight is negative but not significant, and not adopted. A forward sample
  would need about 4x the covered bouts to test it at the 0.003 MDE.
