# Fighter finishing tendencies and the joint who x how x when model (task key: finishing)

Nov 7, 2026, about 12:10 am UTC. Tool: `tools/finishing.py`. Output: `data/derived/finishing.json`. JS evaluator:
`src/ml/finishing.js`, checked by `tests/test_finishing.js`. Blind-test plugin: `tools/blindtest_plugins/finishing.py`.
Caches: `out/finishing_cache/` (gitignored). Every number below is printed by `python3 tools/finishing.py summary`
(reads the JSON, no refit); the stages that produce them are listed under "Reproduce".

## Bottom line

**Not adopted. Production method / round stays S2 + ML v2 winner (with the 40/60 props blend when props exist).**
The finishing model is kept as a monitored candidate for the forward ledger and vault audit 2.

Verified Nov 7, about 12:30 am UTC: the rejection was reproduced with the verifier's own code. Points 3 and 5 below
were corrected; see the Verification log at the end.

1. **The stack gate rejects it.** Forward-chained 2021-2023, the blend of the finishing model with S2+ml2win changes
   7-bin log loss by **+0.0007 [-0.0044, +0.0055]** (needs < -0.0005). The nested selection procedure alone, on
   2020-2023: **+0.0012 [-0.0038, +0.0061]**.
2. **Fighter finishing tendencies are real but mostly already in S2.** Fighters do differ: the logit-scale
   random-effect sd is 0.47 for KO wins, 0.62 for submission wins, 0.63 for KO losses, 0.84 for submission losses and
   0.41 for being finished late (cardio fade). The pre-UFC record moves the prior for submission wins (weight 0.68) and
   KO wins (0.36). But methodround's S design already carries shrunk per-fighter finishing rates. Inside the
   conditional family, the empirical-Bayes block is worth only **-0.0015 [-0.0042, +0.0010]** in 7-bin on 2020-2023.
3. **The 2024-25 single look leans favourable, but it cannot overturn the CV decision.** Production configuration,
   857 fights, 84 cards:
   - 7-bin **-0.0039 [-0.0083, +0.0009]**;
   - who x how x when (joint) **-0.0085 [-0.0146, -0.0020]**;
   - method given the winner -0.0038 [-0.0083, +0.0010];
   - round given a finish -0.0067 [-0.0150, +0.0019].

   The gate's blend (beta 0.70) scores 7-bin -0.0032 [-0.0063, +0.0001] and joint -0.0072 [-0.0115, -0.0027]. About
   half of the joint gain comes from the round model (round part, joint minus 7-bin: -0.0046 [-0.0096, +0.0004], not
   significant on its own), and on 2020-2023 that same round model made round-given-finish worse (+0.0007). The joint
   CI is nominal: it is one of about 20 comparisons (4 models x 5 metrics) in a window that earlier labs have already
   used heavily. The decision follows CV, so these numbers are a confirmation look only.
4. **Nothing else earned a place:**
   - GBM: 7-bin +0.010 on 2020-2023 vs the logit.
   - The opponent-adjusted finishing filter: -0.0003 on top of the EB block, under the 0.0005 rule.
   - Log-linear pooling with S2's shares.
   - Fighter-level round tendencies (early finisher, late fade): they overfit the 2016-2019 folds and lose on
     2020-2023.
   - The 2019+ verified layers (statlines, durability, bayes) as a residual on S2+ml2win: all worse,
     +0.0007 to +0.0037 at the pre-set penalty.
5. **The round model has no CV case of its own (corrected by the verifier).** The finisher-oriented
   continuation-ratio round model on methodround's hazard columns, with no fighter round tendencies, looked steady in
   the two-period split: sided round loss -0.0025 (2016-2019) and -0.0020 (2020-2023). By year it is better than S2's
   round shapes in 5 of 8 years and worse in 3. Its 2020-2023 average is carried by 2020 (-0.017). On the gate years
   2021-2023 it is worse (+0.0019 per finish; 2023 +0.013), and a joint-metric stack gate for the round model alone
   fails (+0.0002), even though this candidate was picked on 2016-2023. Its round-given-finish was +0.0007 on
   2020-2023. The only support for it is the 2024-25 look, which cannot promote it. Track it only as a descriptive
   side line.

## What was built

**Universe and protocol.**
- Universe: methodround's walk-forward table, i.e. UFC bouts 2008-2025 where both men had an earlier UFC bout.
  Debut bouts belong to the debut method model.
- `build_db.parse_fights` is wrapped by tools/ml2.py, so every fight dated 2026-01-01 or later is dropped right after
  parsing. Every keyed source (preufc.json snapshots, statlines_oof.json, durability.json, bayes.json) is read only for
  dates before 2026-01-01.
- Nothing from 2026 was collected, so nothing was written to the vault.

**The incumbent, rebuilt.** S2 and S2+ml2win are rebuilt per fold exactly as tools/ml2.py's method stage builds them:
- the six-class logit on S's design plus the ML v2 columns, C 0.002, trained 2012+, recency half-life 8 years;
- the competing-risk hazard for round shapes;
- the ML v2 blend winner (out of fold for 2012-2023; the static fit before 2024 for 2024-2025).

The rebuild reproduces ml2's CV 2020-2023 numbers exactly (joint 2.14070, 7-bin 1.60642, method given winner 0.93340).

**(a) Empirical-Bayes finishing rates.** Nine indicators per fighter per bout:
- KO win, submission win, decision (any), KO loss and submission loss, each per bout;
- finishing win in round 1 and being finished in round 1;
- finishing win in round 3+ and being finished in round 3+, each per bout that reached round 3 (late finisher /
  cardio fade).

Each indicator gets:
- **a baseline logit** (division x era x age x format x title), fit on events before the fold year;
- **a logit-normal random effect** u_i ~ N(lam x pre-UFC shift, sigma^2). sigma and lam are fit by marginal
  likelihood on a fixed u-grid, using every person's events before the fold year.
  - A gamma-Poisson version was tried first. It understates heterogeneity for common outcomes such as decision and
    late finishes: the strength hit its bound.
- **the posterior mean and sd of u** for each row side, given his events strictly before the bout day. Same-day bouts
  never see each other.

The pre-UFC shift is the logit distance of his preufc.json snapshot rate (strict walk-forward network, preufc's
presence rule) from the training-years pre-UFC mean. Each row side uses only its own pre-fight snapshot.

| fit before | KO win | sub win | decision | KO loss | sub loss | R1 win | R1 loss | late win | late loss |
|---|---|---|---|---|---|---|---|---|---|
| 2016 sigma | 0.533 | 0.673 | 0.512 | 0.596 | 0.854 | 0.586 | 0.672 | 0.229 | 0.449 |
| 2016 lam (pre-UFC) | 0.469 | 0.638 | - | 0.112 | 0.156 | - | - | - | - |
| 2024 sigma | 0.442 | 0.627 | 0.535 | 0.650 | 0.830 | 0.532 | 0.652 | 0.300 | 0.396 |
| 2024 lam (pre-UFC) | 0.374 | 0.676 | - | 0.156 | 0.232 | - | - | - | - |
| 2026 (deployment) sigma | 0.465 | 0.616 | 0.541 | 0.626 | 0.839 | 0.550 | 0.671 | 0.304 | 0.413 |

**(b) Opponent-adjusted finishing filter.** A diagonal-Gaussian online filter over every UFC bout, run in day order
(each card is snapshotted before any update):
- each fighter has a KO and a submission offence, and a KO and a submission vulnerability;
- for each method m, eta_m = division-era base + offence of the winner + vulnerability of the loser, with a softmax
  against decision;
- prior sd 0.8 and drift 0.3 per inactive year, chosen by the filter's own pre-fight method-given-winner loss on
  2012-2019.

On its own it scores 0.9737 against 1.0117 for division base rates (2012-2019 bouts).

**Cardio.** Shrunk log ratio of landed per minute in rounds 2+ against round 1, for the fighter and for his opponents.

**(c) Structure.** The fight terms come from methodround: 5 rounds, title, weight, women, catch weight, year and
division finishing priors. The tune stage also offered interactions of 5 rounds and title with the late-finish
tendencies and the winner logit.

**(d) The joint model.**
- P(cell) = P_ml2(W) x P(method | W wins, x) x P(round | W finishes by method, r).
- The method model is a multinomial logit over {KO, SUB, DEC} on the winner-oriented design. Its class intercepts are
  method base rates given a win; nothing reads the corner.
- The round model is a continuation-ratio logit over rounds on the finisher-oriented design. It has free dummies for
  (format, round, method), and P(last round) is the remainder.
- The draw takes methodround's draw_c share of the decision mass.
- The winner probability is ML v2's and is never re-predicted.

**Candidate families.**
- the conditional multinomial logit on S2's design plus the winner logit, with and without the EB block, the pre-UFC
  prior and the filter;
- LightGBM;
- S2's own six-class model with the directional EB block appended (the incumbent family, mirrored training);
- the round-model variants.

A hierarchical Bayesian skill model was already built and rejected (research/model_bayes.md). Its walk-forward skill
means were tested here in stage 2.

## Selection protocol and results

All CIs are 95% event-cluster bootstrap CIs (2,000 resamples of cards), paired with S2+ml2win on the same fights.
Negative = better.

### 1. Pre-specified route: tune on the 2016-2019 folds, score the frozen choice on 2020-2023

Tune folds (1,491 fights; S2+ml2win 7-bin 1.61732). Each fold year is fit on everything before it.
- **Core choice:** conditional MNL on the S2 design + winner logit + EB block (pre-UFC prior on), start 2008, no
  recency weighting, C 0.0015. 7-bin 1.60914 (-0.0082).
- **Ablations:**
  - without the EB block: 1.61238;
  - without the pre-UFC prior: 1.61236;
  - EB without the S2 design: 1.62127.
- **Forward selection:** no extra block passed the 0.0005 rule. Best was the filter at 1.60885.
- **Other families:** GBM at best 1.61742; S2-share pooling never helped (a = 0 best).
- **Round model:** the EB + fight + winner + filter + cardio round model gained joint -0.0029.

Frozen and scored on 2020-2023 (1,581 fights), the choice did not transfer:

| 2020-2023 | 7-bin | joint | method given winner | round given finish |
|---|---|---|---|---|
| S2+ml2win | 1.6064 | 2.1407 | 0.9334 | 1.0636 |
| finishing (frozen tune choice) - S2+ml2win | +0.0011 [-0.0040, +0.0063] | +0.0020 [-0.0052, +0.0094] | +0.0013 [-0.0038, +0.0064] | +0.0075 [-0.0011, +0.0163] |
| family check: MNL / GBM / average | 1.60754 / 1.61785 / 1.60891 | | | |

Diagnosis: the optimal penalty drifts. The 2016-2019 folds want C 0.0015, while 2020-2023 keep improving down to
C 0.0007 or below. The EB block helps at every penalty, but by less as the penalty loosens (verifier, from
`grid.pkl`, core minus s2cond at matched settings):
- 2016-2019: -0.0026 to -0.0053;
- 2020-2023: -0.0009 to -0.0035.

### 2. Decision procedure: nested forward-chained selection over the full grid

The grid has 93 method candidates:
- the conditional MNL in four specs (S2-only, + EB, + EB without the pre-UFC prior, + EB + filter) x start
  {2008, 2012} x recency {8 y, none} x C {0.0005-0.002};
- the six-class S2 + EB block in three specs x C {0.001-0.003};
- the incumbent itself.

It also has 31 round candidates, S2's shapes included. Year Y (2017-2023) is predicted by the candidate with the best
loss on 2016..Y-1, so the 2020-2023 numbers measure the procedure, choice included.

| 2020-2023 (1,581) | 7-bin | joint | method given winner | round given finish | method (3-class) |
|---|---|---|---|---|---|
| S2+ml2win | 1.6064 | 2.1407 | 0.9334 | 1.0636 | 0.9595 |
| finishing (nested) - S2+ml2win | +0.0012 [-0.0038, +0.0061] | +0.0024 [-0.0049, +0.0101] | +0.0014 [-0.0035, +0.0064] | +0.0043 [-0.0053, +0.0143] | +0.0041 [+0.0004, +0.0077] |
| conditional S2 design only, nested - S2+ml2win | +0.0027 [-0.0015, +0.0069] | +0.0027 | +0.0029 | +0.0004 | +0.0047 [+0.0016, +0.0080] |
| EB candidates - conditional S2-only (what the EB block adds) | -0.0015 [-0.0042, +0.0010] | | | | |
| best candidate on 2020-2023 itself (oracle; optimistic, never used) | -0.0042 [-0.0076, -0.0008] | | | | |

- **By year (7-bin, S2+ml2win / finishing):**
  - 2020: 1.5718 / 1.5715;
  - 2021: 1.6062 / 1.6073;
  - 2022: 1.6053 / 1.6043;
  - 2023: 1.6382 / 1.6431.
- **Nested picks:** the conditional model with the EB block (with or without the filter) every year. Round picks
  moved between the fighter-tendency variants.
- **Production pick over 2016-2023:** method `core|st2008|hl8|C0.001`; round `haz|C0.003|slope0`.
- **Why the six-class S2 + EB candidates were never picked:** their gains are small and steady (better than the
  incumbent in 5 to 6 of the 8 years, by 0.001-0.007). The conditional variants had a large 2018 (-0.015) that front-loaded the nested record.
- **Five-round bouts (198, descriptive; a 5-round cell decides nothing):**
  - 7-bin 1.5965 vs 1.6054;
  - joint 2.3651 vs 2.3864;
  - round given finish 1.4829 vs 1.5048.

  Three-round bouts lean the other way: 7-bin 1.6092 vs 1.6066.

**Round candidates by period** (sided round loss = joint minus 7-bin, finishes only; minus S2's shapes):

| round candidate | 2016-2019 | 2020-2023 | 2021-2023 (gate years; verifier) | round given finish 2020-2023 |
|---|---|---|---|---|
| haz, C 0.003, no slope (production pick) | -0.0025 | -0.0020 | +0.0019 | +0.0007 |
| haz + EB + fight + win + filter + cardio, C 0.003 | -0.0058 | +0.0011 | +0.0064 | +0.0048 |
| EB + fight + win + filter + cardio, C 0.003, slope | -0.0059 | +0.0017 | +0.0056 | +0.0071 |

The fighter-level round tendencies (early finishers, late fade) look strong on 2016-2019 and do not survive
2020-2023.

By year, the production pick's sided loss per finish (2016 to 2023) is -0.0007, -0.0072, +0.0078, -0.0103,
-0.0170, -0.0019, -0.0051, +0.0134. It is not steady.

Reproduce this table with the per-candidate losses in `out/finishing_cache/grid.pkl` (`grid` stage), or with
`python3 tools/finishing_verify.py rounds`.

### 3. Stack gate (forward-chained 2021-2023, the 0.0005 rule)

A linear pool of the joint cells, beta x finishing + (1 - beta) x S2+ml2win. Beta for year Y is fit on out-of-fold
rows 2017..Y-1 (grid 0-1 by 0.05). Gate fights: 1,235.

| input | beta 2021 / 2022 / 2023 | blend - S2+ml2win (7-bin) | raw - S2+ml2win | verdict |
|---|---|---|---|---|
| nested procedure (primary) | 0.95 / 0.85 / 0.80 | +0.0007 [-0.0044, +0.0055] | +0.0016 [-0.0043, +0.0072] | fail |
| nested method, S2 round shapes | 0.95 / 0.85 / 0.80 | +0.0007 [-0.0044, +0.0055] | +0.0016 [-0.0043, +0.0072] | fail |
| six-class S2 + EB at S2's penalty (minimal change; reported) | 1.00 / 0.85 / 0.95 | +0.0001 [-0.0026, +0.0027] | +0.0000 [-0.0028, +0.0028] | fail |

Decision: not adopted. The production beta it would have deployed (2017-2023 rows) is 0.70.

### 4. Stage 2: the 2019+ verified layers

The finishing model failed its gate, so each layer was tested as a residual on S2+ml2win's method-given-winner
shares. This is an offset multinomial logit with an L2 penalty fixed in advance at lam 1.0, on standardized
winner-oriented features. It is forward-chained over 2021-2023 and trained on 2019 (statlines 2020) through Y-1.

The layers:
- statlines: unconditional expected KD, submission attempts, takedowns, control, sig landed and head landed for
  winner and loser. Never the actual-length fields, which would leak the fight's length.
- durability: walk-forward chin / power.
- bayes: walk-forward skill means (power, submission, striking, takedown, control and cardio for the winner; chin,
  submission defence, striking and takedown defence and cardio for the loser).

| layer (lam 1.0) | 7-bin - S2+ml2win | method given winner |
|---|---|---|
| statlines | +0.0007 [-0.0032, +0.0046] | +0.0006 |
| durability | +0.0014 [-0.0006, +0.0034] | +0.0014 |
| bayes | +0.0010 [-0.0015, +0.0037] | +0.0010 |
| all three | +0.0037 [-0.0013, +0.0086] | +0.0036 |

Sensitivity:
- lam 0.3 is worse everywhere (all three +0.0101 [+0.0023, +0.0181]).
- lam 3.0 is closer to 0 but still positive.

This agrees with ml2's S3 rejection: these layers carry no method signal beyond S2.

### 5. 2024-2025, scored once

The production configuration (the nested pick, fit on fights before 2024-01-01) was scored at 00:02 UTC on Nov 7.
Every scored object was fixed in code before the run, and a marker file refuses a second run. 857 fights, 84 cards.

| 2024-2025 | 7-bin | joint | method given winner | round given finish | method (3-class) |
|---|---|---|---|---|---|
| S2+ml2win | 1.5171 | 2.0051 | 0.9001 | 1.0599 | 0.9298 |
| finishing | 1.5132 | 1.9966 | 0.8963 | 1.0532 | 0.9279 |
| finishing - S2+ml2win | -0.0039 [-0.0083, +0.0009] | -0.0085 [-0.0146, -0.0020] | -0.0038 [-0.0083, +0.0010] | -0.0067 [-0.0150, +0.0019] | -0.0018 [-0.0053, +0.0017] |
| finishing method, S2 round shapes - S2+ml2win | -0.0039 [-0.0083, +0.0009] | -0.0039 [-0.0083, +0.0009] | -0.0038 | +0.0001 [-0.0002, +0.0006] | -0.0018 |
| blend (beta 0.70) - S2+ml2win | -0.0032 [-0.0063, +0.0001] | -0.0072 [-0.0115, -0.0027] | -0.0032 [-0.0063, +0.0002] | -0.0056 [-0.0115, +0.0005] | -0.0016 [-0.0040, +0.0009] |
| six-class S2 + EB block - S2+ml2win | +0.0007 [-0.0031, +0.0044] | +0.0007 [-0.0031, +0.0044] | +0.0006 | +0.0001 | +0.0006 |

- **By year (7-bin):** 2024: 1.4920 S2+ml2win vs 1.4892 finishing; 2025: 1.5422 vs 1.5372.
- **The blind-test harness agrees on its own universe (857 scored fights):** finishing 1.5132, S2+ml2win 1.5171. The
  plugin registers both.
- **This look cannot change the decision.** Section 6.3's generic MDE for "7-bin when only the method given the
  winner changes" is about 0.015. This pair's own paired CI is tighter (half-width about 0.0046, so an MDE of about
  0.0065), and the observed -0.0039 is still below it. About half of the joint gain comes from the round model, whose
  CV evidence is negative on the gate years (section 2).

## Checks

- **Corner symmetry (swap test, `swap` stage).** A random half of fold 2023's universe was swapped A <-> B: labels,
  designs, person pointers, pre-UFC counts, filter state, ML v2 winner and S2 inputs. After a refit of the production
  configuration and of the six-class S2 + EB model, every prediction mirrors: max |difference| 7.8e-16 (production
  method P6), 7.2e-16 (joint cells), 6.7e-16 (six-class S2 + EB P6).
  - No model reads the corner. The method model is winner-oriented, the round model finisher-oriented, and the
    six-class model is trained on both orientations and averaged.
- **Walk-forward.** EB posteriors, the filter and cardio use only events strictly before the bout day (pointers taken
  before the card is applied). EB hyperparameters and baselines are fit on events before the fold year. The pre-UFC
  prior of a row side uses only that row side's own snapshot.
- **Incumbent reproduction.** S2 and S2+ml2win are reproduced to ml2's printed CV values (assertion in `base`).
- **JS evaluator** (`node tests/test_finishing.js`, 371 checks):
  - it reproduces Python's deployment model on 30 exported 2024-2025 designs (method shares 4e-16, cells 2e-16);
  - the swap mirrors every cell;
  - the cells sum to 1;
  - A's mass before the draw share equals pA;
  - the round shapes sum to 1 and are zero past the scheduled rounds;
  - the roster builder's roles and unknown-fighter prior behave as documented.

## Integration recipe (monitored side line only)

- **The JS model.** `finishing.json` `js_model` holds:
  - the deployment refit on every fight before 2026-01-01 by the frozen procedure;
  - the method block (165 columns: the winner logit, the EB block, then S2's design);
  - the round block (27 methodround hazard columns plus 12 free dummies);
  - draw_c;
  - the end-of-2025 EB roster (1,285 fighters active since 2019);
  - the test vectors.
- **Calling it.** `FinishingModel.load(js).predict({xA, xB, rA, rB, pA, rounds})` returns the 23 cells, the 7 bins,
  P(method | winner) for each side, the round shapes and P(finish).
  - The S2 part of the design comes from methodround's feature builder and tools/ml2.py `method_new_cols`. The page
    does not compute those yet (v6 cycle item).
  - `finFeatures(slugA, slugB, pA)` fills the finishing block from the roster.
- **The blind test.** `tools/blindtest_plugins/finishing.py` registers `finishing` and `finishing_s2ml2win`, both
  experimental, both with P(A) = the ML v2 winner. Their 7 bins are paired in the harness's 7-bin table.
- **Forward ledger / audit 2.** If it is monitored, pre-register it before the audit-2 freeze as a descriptive side line
  next to S2+ml2win:
  - 7-bin is primary, as at the gate, and joint is secondary;
  - do not pick the metric because 2024-25 leaned its way on the joint, since that would be selection on 2024-25
    (verifier).

  It must not replace S2+ml2win without a new forward version and a clean test.

## Descriptive: Volkanovski and Gaethje in the EB roster (through 2025-12-31)

Each value is the posterior shift of the fighter's log-odds from the division x era x age x format baseline.

| fighter | KO win | sub win | decision | KO loss | sub loss | R1 win | R1 loss | late win | late loss |
|---|---|---|---|---|---|---|---|---|---|
| Alexander Volkanovski (17 UFC bouts) | +0.44 | -0.50 | +0.18 | -0.19 | -0.88 | -0.36 | -0.23 | +0.05 | -0.23 |
| Justin Gaethje (14) | +0.81 | -1.02 | -0.48 | -0.10 | +0.01 | +0.29 | -0.19 | +0.02 | +0.33 |

- **Gaethje:** finishes or gets finished (decision -0.48), wins by KO well above baseline and early (R1 win +0.29),
  and is finished late more than baseline (late loss +0.33).
- **Volkanovski:** goes the distance more than baseline, with a KO-win shift above baseline, is hard to submit, and
  for his age is not KO-prone.
- These describe tendencies; they are not a matchup forecast.

## Do-not-do (from this lab)

- **No GBM for method given the winner.** It is +0.008 on the tune folds and +0.010 on 2020-2023 against the logit,
  and averaging with the logit does not help.
- **No fighter-level round tendencies as round-model features.** Early finisher, late finisher and cardio fade
  overfit (sided loss -0.006 on 2016-2019 becomes +0.001 to +0.002 on 2020-2023).
- **Do not add the 2019+ layers to the method model.** This covers statlines, durability and bayes, whether as S3
  columns or as a residual.
- **No wide hyperparameter searches for method models.** Candidate differences (about ±0.003) are smaller than the
  year-to-year noise (about ±0.01). The nested record is driven by single years, and the oracle on 2020-2023
  (-0.0042) is pure optimism.
- **Do not judge a method-model penalty on 2016-2019 alone.** The optimum drifts toward stronger shrinkage on later
  years.
- **Do not replace S2's round shapes with the continuation-ratio round model on its two-period average (verifier).**
  It loses on the 2021-2023 gate years and swings by year. A replacement needs a gate-years win first.

## Caveats

- **Optimism in the incumbent's CV.** The ML v2 out-of-fold winner for 2012-2018 comes from features and settings
  chosen on 2019-2023 (ml2's caveat). S2's own penalty (C 0.002) was chosen by ml2 on 2020-2023, which makes the
  incumbent's 2020-2023 numbers slightly optimistic. That is conservative for this comparison.
- **Adaptive CV route.** The pre-specified 2016-2019 route failed, and the nested grid and the six-class candidates
  were added after it. Everything stayed on data before 2024, and the 2024-25 objects were fixed before the look. The
  nested estimate is honest about the choice within the grid, not about the decision to build the grid.
- **Static physical fields.** Height, reach, stance and date of birth come from the snapshot, as in methodround.
- **Survivorship in pre-UFC coverage.** The pre-UFC counts exist only under preufc's target rule (one of the first
  four UFC bouts on or after 2015), so the prior is off for most pre-2015 debutants.
- **No debut bouts.** The universe excludes them (both men need a prior UFC bout). Debut bouts belong to the debut
  method model.
- **The props are better than any of these.** Market method props beat S2 on method given the winner
  (research/model_methodround.md), and the 40/60 props blend remains the production choice when props exist.

## Reproduce

```
nice -n 5 python3 tools/finishing.py base      # ~15 s; asserts the S2 / S2+ml2win reproduction
nice -n 5 python3 tools/finishing.py feats     # ~3 s
nice -n 5 python3 tools/finishing.py tune      # ~70 s (2016-2019 folds)
nice -n 5 python3 tools/finishing.py cvfixed   # ~30 s
nice -n 5 python3 tools/finishing.py grid      # ~75 s (93 method + 31 round candidates, OOF 2016-2023)
nice -n 5 python3 tools/finishing.py nested
nice -n 5 python3 tools/finishing.py gate
nice -n 5 python3 tools/finishing.py stage2
nice -n 5 python3 tools/finishing.py swap
nice -n 5 python3 tools/finishing.py holdout   # refuses to run twice (out/finishing_cache/holdout.done)
nice -n 5 python3 tools/finishing.py export
python3 tools/finishing.py summary             # every table above, from data/derived/finishing.json
node tests/test_finishing.js
```

Inputs: data/raw (through build_db), out/ml2_cache (`table.pkl`, `fit.pkl`, `cv.json`, `method.json` from
`tools/ml2.py`), data/derived/methodround.json (chosen penalties, draw share), preufc.json, statlines_oof.json,
durability.json, bayes.json.

## Verification log

Adversarial verifier, Nov 7, 2026, 12:15-12:35 am UTC. **Verdict: NOT ADOPTED (confirmed).** Production method /
round stays S2 + ML v2 winner, with the 40/60 props blend when props exist. No look-ahead, no 2026 data and no
selection on 2024-25 was found in the numbers. The stack gate fails when re-run with the verifier's own code, on the
7-bin metric and on the joint metric. Two claims were overstated and are corrected above: the round model's
"steadiness", and the reading of the 2024-25 joint gain.

**Commands.** All verifier code is in `tools/finishing_verify.py` (own raw-CSV outcome parser, losses, beta search
and event-cluster bootstrap):

```
FIN_CACHE=<scratch> nice -n 5 python3 tools/finishing.py {base,feats,tune,cvfixed,grid,nested,gate,stage2,swap}
FIN_CACHE=<scratch> python3 tools/finishing_verify.py {score,gate,rounds,eb,lookahead,corner}
node tests/test_finishing.js
```

### Protocol and timeline

- **Order of work (git autosaves and cache mtimes).** Every selection artefact was written before the single
  2024-25 look (`holdout.done` 00:02:20):
  - tune.json 11:49 pm;
  - grid and nested 11:59 pm;
  - gate 12:00 am;
  - stage2 12:01 am;
  - swap 12:02:11 am.
- **After the look, only cosmetic or export code changed:**
  - slugs and names added to `feats` (feats.pkl rewritten 12:03 am);
  - the `roster=` option of `eb_block`;
  - the export, the summary and the docstrings.
  - `cvfixed` was re-run at 12:04 am with unchanged code. It is deterministic: the verifier's re-run gives identical
    numbers.
  - No CV choice, grid value or gate input changed after the look.
- **No second 2024-25 run.** No other holdout marker or holdout prediction cache exists on the machine.
- **2026 data.** None found.
  - `finishing.json` holds no 2026 date except build timestamps. Its fights run 2019-01-19..2025-12-13.
  - The parse wrapper is asserted.
  - The roster stops at 2025: Volkanovski 17 UFC bouts, Gaethje 14 (his 2026 bout is absent).
  - No vault file was needed.
- **Adaptive route (disclosed).** The C values 0.0005 and 0.0007 and the six-class candidates were added after the
  2016-2019 route failed on 2020-2023. This happened before 2024, so the nested 2020-2023 estimate is slightly
  optimistic about the grid's design. It does not change the verdict, because the estimate is already a loss.

### Independent reproduction

| check (verifier code) | builder | verifier |
|---|---|---|
| full pipeline re-run into a scratch cache (base .. swap, stage2) | (all tables) | identical to 5 decimals: S2 / S2+ml2win reproduce ml2 (joint 2.14070, 7-bin 1.60642); tune, cvfixed, nested picks, gate, stage2, swap |
| 2020-23 nested, re-scored from `finishing.json` against raw-CSV outcomes (1,581 fights, 169 cards) | 7-bin +0.0012, joint +0.0024, round given finish +0.0043 | +0.00119 [-0.0037, +0.0058], +0.00236, +0.00426 |
| stack gate 2021-23, 7-bin, own beta grid and bootstrap (1,235 fights) | +0.0007 [-0.0044, +0.0055], betas 0.95/0.85/0.80 | +0.00072 [-0.0043, +0.0058], same betas: **fail** |
| stack gate 2021-23 on the joint metric (not run by the builder) | - | nested +0.00002 [-0.0048, +0.0051]: **fail**; round model alone on S2+ml2win +0.00015: **fail** |
| production pick (method and round both chosen on 2016-2023) put through the gate | - | -0.0016 (7-bin): it "passes" only because it was chosen on the gate years. This is the optimism the nested procedure removes; not a valid gate input |
| own re-implementation: raw-CSV finishing counts by fighter name, beta-shrunk logits, sklearn conditional logit; k and C chosen on 2016-19, scored on 2020-23 (method given winner, 1,564 fights) | EB block -0.0015; conditional + EB worse than the incumbent | EB block -0.0011 [-0.0026, +0.0004]; own conditional + EB vs S2+ml2win +0.0035 [-0.0011, +0.0081]: same conclusion |
| 2024-25 look, re-scored from the exported cells (857 fights, 84 cards) | 7-bin -0.0039, joint -0.0085 [-0.0146, -0.0020] | -0.00389 [-0.0085, +0.0007], -0.00851 [-0.0147, -0.0019]; round part -0.0046 [-0.0096, +0.0004] |
| the exported 2024-25 cells come from a fit on fights before 2024 | stated | a fresh fit before 2024 reproduces all 865 exported rows to 5e-6 (export rounding); nothing new was scored |
| JS evaluator | 371 checks | `node tests/test_finishing.js`: 371/371 |

### Leakage and symmetry hunts

- **Look-ahead self-test (new).** Every outcome and per-round stat dated on or after 2022-07-01 was perturbed:
  method and round labels swapped between winner and loser, filter winners flipped, cardio randomised. Then fold
  2022 was rebuilt and refit.
  - The 204 rows dated on or before that day did not move: max |dP6| 7e-15, |dH| 0, |dEB| 1e-13.
  - The 218 later rows did move: max |dP6| 0.015.
  - So the EB posteriors, the filter and cardio read only strictly earlier events. Same-day bouts were included in
    the perturbation and did not leak.
- **Normalisation and baselines.** Each is fit on its training rows only, or is a fixed constant:
  - the scalers;
  - the baseline logits (events before the fold);
  - the EB hyperparameters (events before the fold);
  - the pre-UFC league mean (rows before the fold);
  - the cardio league ratios (constants from before 2016);
  - the methodround priors (window [y-5, y)).
- **The statlines layer.** It reads `[-1]`, the unconditional mean, never the actual-length mu.
- **Corner order.**
  - `build_features` builds FX = f(A, B) and FY = f(B, A) with one function. Fight columns are identical in both.
  - The swap refit test was re-run: 7.8e-16.
  - A free corner flag added to the production method model makes 2020-23 slightly worse (7-bin +0.0003). Its
    standardized coefficients are about 0.01. No ordering signal is present, and the symmetric model cannot read
    one.
- **Joins.**
  - All 2,864 exported fights match raw ufcstats by fight id with equal dates.
  - All 5,058 pre-2024 methodround rows match.
  - ML v2's winner is present in 100% of 2012+ rows. It is 0 (neutral) in 2008-2011 training rows, a modelling
    choice that CV handled through the start-year grid.
  - Pre-UFC counts cover 82.8% of 2016+ row sides; missing sides get a zero prior shift.
  - Debut bouts are excluded by design (stated).

### Defects fixed in the tool (minimal edits)

1. **Stale fold cache (`get_folds`).** A cached `fd_*.pkl` pickles its own copy of base.pkl (the S2 design and the
   ML v2 winner) and the EB block built from feats.pkl. The documented recheck after an ml2 or methodround rebuild
   (rerun `base` → `export`) would therefore have reused stale designs and winner logits silently.
   - Fix: the cache is rebuilt when base.pkl or feats.pkl is newer than it.
   - Tested: after touching base.pkl, `cvfixed` rebuilt the cache and gave identical results.
   - The builder's numbers were not affected. Their fold caches were built after base.pkl, and the later feats change
     was cosmetic.
2. **Stale docstrings.**
   - The module docstring still described the dropped gamma-Poisson prior.
   - `eb_block` claimed 24-node Gauss-Hermite quadrature; the code uses an 81-point grid on [-4, 4].

### Report corrections

1. **The round model.** It is not "the only round variant steady across both CV periods".
   - Sided loss per finish against S2's shapes, by year 2016-2023: -0.0007, -0.0072, +0.0078, -0.0103, -0.0170,
     -0.0019, -0.0051, +0.0134.
   - On the 2021-2023 gate years it is +0.0019 (worse).
   - The joint gate for the round model alone fails.
   - Recommendation 3 (pre-register it as a v6/v7 candidate) has no CV basis. Its only support is the 2024-25 look, so
     it is downgraded to a descriptive side line.
2. **The 2024-25 joint gain.** Its CI excludes 0, but it is one nominal result among about 20 comparisons. Its round
   part on its own is not significant (-0.0046 [-0.0096, +0.0004]). "Most of the joint gain" became "about half".
3. **The EB block's size.** Not "about -0.0025 at every penalty": -0.0009 to -0.0035 on 2020-23 and -0.0026 to
   -0.0053 on 2016-19, shrinking as C rises.
4. **The MDE.** The generic 0.015 from plan section 6.3 is looser than this pair's own paired CI (half-width 0.0046,
   so an MDE of about 0.0065). The -0.0039 is still below it.
5. **The monitored metric.** The forward-ledger side line must not use the joint as primary *because* 2024-25 leaned
   that way: 7-bin is primary and joint secondary.

### Not re-run

- The blind-test harness replay (heavy refits). The plugin reads the same `finishing.json` cells that the verifier
  re-scored, and both registered models are experimental with P(A) = ML v2, so no stacker reads them.
