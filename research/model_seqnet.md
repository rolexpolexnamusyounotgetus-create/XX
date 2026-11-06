# seqnet: deep career-sequence model (task key: seqnet)

Nov 6, 2026, 10:20-11:05 pm UTC. Tool: `tools/seqnet.py`. Output: `data/derived/seqnet.json`. Blind-test plugin:
`tools/blindtest_plugins/seqnet.py`. Test: `tests/test_seqnet.py`. Scratch caches: `out/seqnet_cache/` (gitignored).
The first run of this task was killed by a container restart at about 10:22 pm after the data stage and 4 of 50
hyperparameter runs; this run reused its code and data cache (rebuilt identically) and finished the pipeline.

**Verdict: not adopted anywhere.** A small siamese GRU over each fighter's UFC career loses to ML v2 as a
standalone winner model, adds nothing as a stack expert (the stack gate rejects it in all six regime pairs), and
its method x round and stat-line heads lose clearly to methodround S and mlrates. Nothing ships to the page, so
there is no JS evaluator. The code, the JSON and the plugin stay as a standing negative baseline.

**Adversarially verified (Nov 6, ~11:20 pm UTC; see "Verification log" at the end).** The verdict stands. Every
headline number re-derives with independent code: the scores, the paired CIs, the stack gate in all six pairs, the
harness replay and the 7-bin gap to S, and a walk refit retrains bit-identically. No look-ahead, no 2026 data, no
selection on 2024-25 and no corner-order exploit was found. Two kinds of fix were made:
- Section 5's side findings were overstated: every hyperparameter-grid difference is within seed noise. They are
  rewritten below.
- Small corrections: the harness levels, the segment wording, the commit time, and the embed path the stat-line
  recipes need.

All brackets are 95% event-cluster bootstrap CIs (2,000 resamples of UFC cards; 1,000 for the per-target stat
lines), paired where they are differences. Lower log loss / deviance is better; differences are seqnet (or the
stack with seqnet) minus the reference.

## Bottom line

**1. Winner, standalone: clearly worse than ML v2; about ML v1's level.**

| model | OOF 2019-2023 (1,955; annual refits) | 2024-2025 (854; scored once) |
|---|---|---|
| **seqnet** (8-seed ensemble; static = fit < 2024) | **0.6492** (slope 0.83) | **0.6193** (slope 1.44) |
| seqnet annual (refit each January) | same rows | 0.6192 (slope 1.17) |
| ML v2 blend, static | 0.6338 | 0.5918 |
| ML v2 logistic, static | 0.6356 | 0.5887 |
| ML v1 logistic | 0.6479 | 0.6063 |
| market rating | 0.6541 | 0.6259 (845) |
| Elo | 0.6857 | 0.6769 |
| closing line | 0.6232 | 0.5854 (845) |
| opening line | | 0.6094 (843) |

| seqnet minus | OOF 2019-2023 | 2024-2025 |
|---|---|---|
| ML v2 blend | **+0.0155 [+0.0067, +0.0240]** | **+0.0276 [+0.0171, +0.0386]** |
| ML v2 logistic | +0.0137 [+0.0044, +0.0227] | +0.0307 [+0.0196, +0.0418] |
| ML v1 logistic | +0.0013 [-0.0080, +0.0105] | +0.0131 [+0.0020, +0.0240] |
| market rating | -0.0049 [-0.0168, +0.0071] | -0.0091 [-0.0222, +0.0042] (845) |
| Elo | -0.0365 [-0.0508, -0.0223] | -0.0576 [-0.0753, -0.0381] |
| closing line | +0.0260 [+0.0129, +0.0385] | +0.0315 [+0.0147, +0.0496] (845) |
| opening line | | +0.0079 [-0.0068, +0.0248] (843) |

- seqnet's point estimate is worse than ML v2's in every year 2019-2025 and in every experience segment (newcomer
  bouts, 3-7 prior fights, veterans, five-rounders, women's bouts). In 2019-2023, four of the five segment CIs
  include 0 (Winner detail below).
- The pre-registration expected seqnet to be 0.010-0.020 worse than ML v2 on 2024-25. It came out +0.0276, worse
  than expected.
- It is overconfident out of fold (calibration slope 0.83, against ML v2's 1.00). On 2024-25 it is underconfident
  (1.44), like every other model in that period.
- The annual refit does not help: annual minus static on 2024-25 is -0.0001 [-0.0074, +0.0080].

**2. As a stack expert: rejected by the gate, and 2024-25 agrees.**

| regime: base stack | 2021-2023 stack CV, base -> + seqnet | gain (0.0005 rule) | 2024-25 static: + seqnet minus base |
|---|---|---|---|
| close: market + ML v2 | 0.61614 -> 0.61634 | +0.00020, rejected | +0.0005 [-0.0002, +0.0012] |
| close: market + ML v2 logistic (page) | 0.61624 -> 0.61637 | +0.00013, rejected | +0.0007 [-0.0000, +0.0015] |
| open: open + ML v2 | 0.62231 -> 0.62254 | +0.00023, rejected | +0.0009 [-0.0003, +0.0021] |
| open: open + ML v2 logistic (page) | 0.62275 -> 0.62284 | +0.00009, rejected | +0.0013 [-0.0000, +0.0026] |
| no line: ML v2 + market rating + feat_lr | 0.62854 -> 0.62884 | +0.00030, rejected | +0.0001 [-0.0001, +0.0004] |
| no line: ML v2 logistic + market rating (page) | 0.62984 -> 0.62985 | +0.00001, rejected | +0.0005 [-0.0001, +0.0011] |

- The stacker gives seqnet weights of 0.02-0.13. Its logit correlates 0.84 with ML v2's out of fold, so it carries
  almost no information that ML v2 lacks.
- In the blind-test harness, which refits the MoE stackers before every card, adding seqnet makes both stacks worse:
  - with the close (845 fights): moe_close 0.5773 -> 0.5785, +0.0012 [+0.0000, +0.0025];
  - with no line (all 854 fights): moe_noline 0.5896 -> 0.5910, +0.0014 [+0.0002, +0.0028]. On the 845 fights every
    harness model covers, it is 0.5855 -> 0.5865.

**3. Method x round: much worse than methodround S.** The model's 23-cell joint is its winner, times its
method-and-round head given the winner, plus a draw share by format.

| seqnet minus S | 2019-2023 (1,972; walk-forward S) | 2024-2025 (857) |
|---|---|---|
| who x how x when (joint) | +0.058 [+0.038, +0.077] | +0.071 [+0.044, +0.100] |
| 7-bin | +0.051 [+0.032, +0.070] | +0.062 [+0.035, +0.091] |
| method (KO / SUB / DEC) | +0.031 [+0.018, +0.044] | +0.038 [+0.018, +0.059] |
| method given the actual winner | +0.056 [+0.040, +0.072] | +0.067 [+0.042, +0.093] |
| round given a finish | +0.012 [+0.005, +0.019] | +0.015 [+0.004, +0.027] |

Giving seqnet's head ML v2's winner does not rescue it. On 2024-25 it is still +0.072 [+0.043, +0.100] on 7-bin
against ML v2's S2+ml2win cells.

**4. Stat lines: much worse alone; a 0.1% sliver as an add-on term.**

| mean relative deviance over the 18 mlrates targets | 2019-2023 (3,998 directed rows) | 2024-2025 (1,730) |
|---|---|---|
| seqnet's stat head alone vs mlrates | +16.0% [+14.7, +17.3] | +18.9% [+16.7, +21.3] |
| mlrates + seqnet term (per-target CV keep: 6 of 18) vs mlrates recalibrated | CV keeps 6 targets | -0.10% [-0.18, -0.02] |
| mlrates + embeddings (embed's recipe, 14 of 18) vs mlrates recalibrated | CV keeps 14 targets | -1.67% [-2.06, -1.29] |
| + seqnet on top of mlrates + embeddings (CV keep: 7 of 18) | CV keeps 7 targets | -0.10% [-0.19, -0.01] |

- The 0.1% gains exclude 0 on the single 2024-25 look, but they are about a tenth of what 2024-25 can resolve for
  one target (around 1% of level; docs/V6_V10_PLAN.md section 2).
- The per-target keep rule has no margin: any CV improvement keeps the term. A 0.0005-style margin would keep fewer
  targets.
- Using them would mean running a PyTorch network in the stat-line path.
- The pre-registration said nothing from the heads would be adopted, and nothing is.

**5. What the experiment taught (all from data before 2024; corrected by the verifier).**
- **No hyperparameter change differed from the base config beyond noise.** The table below gives each config minus
  base, paired per fight on the 1,093 fights of the 2016-2018 CV (`tools/seqnet_verify.py claims`).

  | config minus base | CV log loss difference |
  |---|---|
  | from2010 (chosen) | -0.0007 [-0.0053, +0.0043] |
  | long_hist | -0.0002 [-0.0037, +0.0031] |
  | side_elo (current Elo as an input) | +0.0009 [-0.0020, +0.0039] |
  | winner_only (no method or stat losses) | +0.0014 [-0.0027, +0.0054] |
  | slow | +0.0015 [-0.0015, +0.0047] |
  | slow_reg | +0.0019 [-0.0020, +0.0057] |
  | small | +0.0022 [-0.0029, +0.0072] |
  | transformer | +0.0077 [-0.0004, +0.0156] |

  - Seed noise is as large as most of these gaps: two single seeds of the same config differ by +0.0011 (base) to
    +0.0035 (from2010).
  - So the earlier claims "the joint heads help the winner", "regularization did not help" and "the current Elo did
    not help" are not established. None of these is distinguishable from 0. The choice of `from2010` followed the
    pre-declared 0.0005 rule correctly, but it is a noise-level pick.
- **Training dynamics.** At the base learning rate (2e-3), the best validation epoch is 2-7. The slower configs
  peak later: slow at 5-10 epochs, slow_reg at 5-22, the transformer at 3-11. After the best epoch, validation loss
  rises by a median of 0.004-0.022 over the next three epochs.
- **Data size as "the binding constraint" is a hypothesis, not a result.** Each refit trains on 3,680 (2019) to
  6,709 (2025) fights, and the net peaks early. But no learning-curve test was run. Dropping 2005-2009 (`from2010`)
  was not worse than keeping it.
- **Seed ensembles matter for nets this small** (re-derived exactly). Out-of-fold log loss falls from 0.6528
  (1 seed) to 0.6509 (2), 0.6503 (4) and 0.6492 (8).
- **Recommendation: no more retunes of deep winner models over UFC-only careers.** The gap to ML v2 (+0.015 out of
  fold) is several times any hyperparameter effect seen here. A larger training universe, such as pre-UFC regional
  fights (research/model_preufc.md), would be a new premise. It is untested, and the pre-UFC block already failed
  inside ML v2.

## The model

- **Career tokens** (88 features per past fight, standardized on the training window only):
  - context: age, layoff, first fight, division weight, catchweight, women's bout, five rounds, title;
  - outcome: win, loss, draw, NC; method (KO, SUB, UD, SD/MD, other); ending round and duration; decision margin
    on the judges' cards;
  - opponent: the opponent's pre-fight Elo, record, finish-loss rate and ambiguity flag, plus the fighter's own
    pre-fight Elo;
  - market: the no-vig closing line he carried into that fight (market.json, else nlbair cut at 2026-01-01), with
    a missing flag;
  - fight stats: own and absorbed per-minute rates (significant strikes landed and attempted, accuracy, head, body,
    leg, distance, clinch and ground landed, knockdowns, takedowns landed and attempted with accuracy, submission
    attempts, reversals, control share);
  - per-round differentials for rounds 1-5 (significant strikes, control, takedowns, knockdowns).
  - Each token also carries its age relative to the predicted fight (years, and their log) and the weight-class
    change since that fight.
- **Encoder.** A token MLP, then a GRU (H 64) over the most recent 16 fights. Readout is the last hidden state plus
  an attention pool. Debutants take a learned empty-career state.
- **Side and context inputs.**
  - Side features: age; height, reach and ape-index differences, used only when both men have them; stance; layoff;
    debut flag; log number of UFC fights; weight move since the last fight.
  - Bout context: five rounds, title, women's, catchweight, division weight, era.
- **Heads.** One side tower makes a state s for each man. Then:
  - winner: z = g(s_A, s_B, c) - g(s_B, s_A, c), so P(A) = 1 - P(B) by construction, with no intercept;
  - method x round given the winner: an 11-way softmax (KO r1-5, SUB r1-5, DEC; rounds 4-5 masked in three-round
    bouts), read from (s_winner, s_loser);
  - stat lines: the 18 mlrates targets for each man attacking the other. Poisson for counts, with minutes as
    exposure; binomial for accuracies, with attempts as trials. Offsets come from training-window base rates.
- **Loss and size.** Loss = winner BCE + 0.3 x method CE + 0.3 x stat NLL (each target scaled by its base-rate
  deviance). 76,511 parameters. AdamW (lr 2e-3, wd 1e-4), dropout 0.2, batch 256, gradient clip 5. PyTorch 2.15 on
  CPU with 1 thread per process and 2 processes.
- **Leak guards.**
  - ufcstats' tale of the tape is a current snapshot, and a missing DOB or reach marks a short career (debut sides
    with a missing reach lost 346 of 392 fights). So no missingness flag reaches the network: a missing DOB takes
    the opponent's age, as tools/ml.py does, and size enters only as a difference when both values exist.
  - A token is built from a fight only after both men's pre-fight states are recorded, so a history never contains
    the predicted fight.

## Protocol

- **Vault.** Every fight dated 2026-01-01 or later is dropped right after parsing (`build_db.parse_fights` is
  wrapped), and the nlbair odds are cut at the same date. No 2026 row was read, so no vault file was written. The
  last fight in the data is 2025-12-13.
- **Hyperparameters.** Chosen by time-ordered CV on 2016, 2017 and 2018:
  - each fold trains before Jan 1 of Y-1, early-stops on Y-1 and predicts Y;
  - each fold uses 2 seeds, logits averaged;
  - scoring is on the ML-universe rows (decisive, not ambiguous, both men with a prior UFC fight; 1,093 fights).
  - So the 2019-2023 out-of-fold predictions that feed the stack gate are clean of the selection.
  - ml2's 0.0005 rule applies: a departure from the base config must beat it by more than 0.0005, and stage 2
    combines every stage-1 change that passes. Only `from2010` passed, so there was nothing to combine.
- **Walk-forward annual refits for Y = 2019..2025.**
  1. Three seeds train before Jan 1 of Y-1 and early-stop on Y-1 (patience 8). The epoch count is the minimum of
     their mean validation curve.
  2. Eight seeds then refit on everything before Jan 1 of Y for that many epochs, and their logits are averaged.
  - "Static" 2024-25 predictions are the fit before 2024-01-01. "Annual" ones are the fit before Jan 1 of the
    fight's year.
- **Stack gate.** ml2's own code (`stack_predict`: no intercept, non-negative logit weights, recency half-life
  chosen by forward-chained CV) on ml2's 2019-2025 expert table, with the seqnet column added. Forward-chained
  2021-2023 CV, 0.0005 rule.
- **The single look.** 2024-2025 was scored once, by the `confirm` stage (`out/seqnet_cache/confirm.done`), after
  the pre-registration was committed (8e41138, 10:55:43 pm UTC by git).
  - One fix came afterwards. The market-rating benchmark row came out NaN because 9 of the 854 fights in 2025 have
    no market rating. The `addendum` stage scores that benchmark on its 845 fights with NaN-safe helpers and changes
    no seqnet number.
- **Corner symmetry.**
  - Exact by construction. `tests/test_seqnet.py` checks random weights for both encoders: |z(A,B) + z(B,A)| = 0,
    the method heads permute, the stat heads swap, and z(A,A) = 0.
  - `tools/seqnet.py swaptest` checks a trained model on 464 real 2015 bouts with every corner swapped. Max errors:
    |z + z_swapped| 1.3e-7, method 1.2e-7, stats 4.8e-7 (float32).
  - All stacks are intercept-free.

## Hyperparameter CV (2016-2018, 1,093 fights)

| config | change from base | CV log loss | 2016 / 2017 / 2018 | best epochs (seed 1, 2) per fold |
|---|---|---|---|---|
| **from2010** (chosen) | train on fights from 2010 (base: 2005) | **0.64526** | 0.6503 / 0.6411 / 0.6439 | 5,6 / 4,4 / 5,3 |
| long_hist | last 24 fights (base 16) | 0.64567 | 0.6505 / 0.6455 / 0.6408 | 5,4 / 6,5 / 6,2 |
| base | H 64, lr 2e-3, dropout 0.2, wd 1e-4, attention pool | 0.64592 | 0.6511 / 0.6416 / 0.6447 | 5,4 / 6,3 / 3,2 |
| side_elo | + current pre-fight Elo as a side input | 0.64679 | 0.6512 / 0.6404 / 0.6482 | 5,4 / 6,3 / 3,2 |
| winner_only | no method / stat losses | 0.64733 | 0.6542 / 0.6422 / 0.6450 | 3,3 / 6,7 / 2,2 |
| slow | lr 7e-4 | 0.64745 | 0.6544 / 0.6421 / 0.6453 | 8,9 / 10,6 / 6,5 |
| slow_reg | lr 7e-4, dropout 0.35, wd 1e-2 | 0.64781 | 0.6564 / 0.6399 / 0.6463 | 11,10 / 22,6 / 6,5 |
| small | H 32 | 0.64816 | 0.6528 / 0.6455 / 0.6459 | 5,6 / 6,6 / 6,6 |
| transformer | 2-layer transformer encoder (H 64, 4 heads) | 0.65358 | 0.6606 / 0.6494 / 0.6502 | 4,4 / 10,11 / 4,3 |

For scale, on the same fights the closing line scores 0.6274 and raw Elo 0.6852 (`out/seqnet_cache/hp_refs.json`).

## Walk-forward refits

| refit year | training fights (from 2010) | epochs chosen | early-stopping validation log loss (year Y-1, all bouts) |
|---|---|---|---|
| 2019 | 3,680 | 5 | 0.6446 |
| 2020 | 4,196 | 4 | 0.6745 |
| 2021 | 4,652 | 6 | 0.6452 |
| 2022 | 5,161 | 7 | 0.6553 |
| 2023 | 5,672 | 5 | 0.6417 |
| 2024 | 6,192 | 2 | 0.6507 |
| 2025 | 6,709 | 6 | 0.6184 |

## Winner detail (2019-2023 out of fold, 1,955 fights)

| year | n | seqnet | ML v2 blend | Elo |
|---|---|---|---|---|
| 2019 | 388 | 0.6570 | 0.6484 | 0.6984 |
| 2020 | 343 | 0.6485 | 0.6310 | 0.6841 |
| 2021 | 415 | 0.6520 | 0.6361 | 0.6813 |
| 2022 | 419 | 0.6359 | 0.6269 | 0.6794 |
| 2023 | 390 | 0.6537 | 0.6266 | 0.6860 |

| segment, seqnet minus ML v2 blend | OOF 2019-2023 | 2024-2025 |
|---|---|---|
| newcomer bout (less experienced man has 1-2 UFC fights) | +0.0078 [-0.0078, +0.0232] (699) | +0.0223 [+0.0026, +0.0421] (262) |
| 3-7 prior fights | +0.0221 [+0.0079, +0.0360] (822) | +0.0338 [+0.0193, +0.0485] (354) |
| 8+ prior fights | +0.0153 [-0.0033, +0.0340] (434) | +0.0241 [+0.0016, +0.0474] (238) |
| five rounds | +0.0262 [-0.0031, +0.0546] (241) | +0.0361 [+0.0006, +0.0691] (105) |
| women | +0.0158 [-0.0040, +0.0354] (362) | +0.0214 [+0.0000, +0.0434] (147) |

Logit correlation with the other experts (out of fold):

| expert | correlation |
|---|---|
| ML v2 blend | 0.837 |
| ML v2 logistic | 0.837 |
| ML v1 | 0.825 |
| close | 0.706 |
| market rating | 0.678 |
| Elo | 0.420 |

## 2024-2025 stacks in full (scored once; decides nothing)

| stack | base | + seqnet | static: plus minus base | rolling: plus minus base |
|---|---|---|---|---|
| close: market + ML v2 | 0.5766 | 0.5771 | +0.0005 [-0.0002, +0.0012] | +0.0003 [-0.0004, +0.0009] |
| close: market + ML v2 logistic | 0.5757 | 0.5765 | +0.0007 [-0.0000, +0.0015] | +0.0004 [-0.0002, +0.0011] |
| open: open + ML v2 | 0.5823 | 0.5832 | +0.0009 [-0.0003, +0.0021] | +0.0005 [-0.0007, +0.0017] |
| open: open + ML v2 logistic | 0.5812 | 0.5824 | +0.0013 [-0.0000, +0.0026] | +0.0008 [-0.0005, +0.0021] |
| no line: ML v2 + market rating + feat_lr | 0.5898 | 0.5900 | +0.0001 [-0.0001, +0.0004] | +0.0000 [-0.0001, +0.0002] |
| no line: ML v2 logistic + market rating | 0.5890 | 0.5895 | +0.0005 [-0.0001, +0.0011] | +0.0002 [-0.0002, +0.0006] |
| harness moe_close (refit every card) | 0.5773 | 0.5785 | +0.0012 [+0.0000, +0.0025] | |
| harness moe_noline (refit every card) | 0.5855 | 0.5865 | +0.0014 [+0.0002, +0.0028] | |

**Cross-checks.** The look reproduces the published benchmarks:
- close 0.5854 and open 0.6094;
- ML v2 blend 0.5918 and logistic 0.5887;
- the market + ML v2 stack against the close: -0.0087 [-0.0134, -0.0038];
- S2+ml2win 7-bin 1.5171;
- embed's stat-line blend: -1.67%;
- the harness's moe_close 0.5773 and moe_noline +0.0001 vs the close.

## Stat lines per target (relative deviance change)

| target | seqnet alone vs mlrates, 2019-23 | seqnet alone vs mlrates, 2024-25 | CV keeps the seqnet term on mlrates / on mlrates + emb | 2024-25: kept term on mlrates + emb |
|---|---|---|---|---|
| distance attempts | +29.0% | +46.8% | no / yes | -0.20% [-0.61, +0.19] |
| clinch attempts | +16.2% | +25.0% | no / no | 0 |
| ground attempts | +5.0% | +9.2% | yes / yes | -0.62% [-1.31, +0.05] |
| head attempts | +23.8% | +39.1% | no / no | 0 |
| body attempts | +28.3% | +33.5% | no / no | 0 |
| leg attempts | +42.0% | +35.1% | yes / yes | 0.00% [-0.53, +0.59] |
| TD attempts | +41.7% | +47.4% | no / no | 0 |
| sub attempts | +11.6% | +17.1% | yes / no | 0 |
| reversals | +8.5% | +9.4% | no / no | 0 |
| control | +25.6% | +34.9% | yes / yes | -0.28% [-0.83, +0.28] |
| head accuracy | +10.1% | +11.3% | yes / yes | -0.31% [-0.75, +0.13] |
| body accuracy | +6.7% | +0.6% | no / no | 0 |
| leg accuracy | +6.8% | +3.6% | no / yes | -0.29% [-1.12, +0.43] |
| distance accuracy | +16.3% | +14.3% | no / no | 0 |
| clinch accuracy | +4.2% | -0.8% | no / no | 0 |
| ground accuracy | +2.8% | +1.5% | no / no | 0 |
| TD accuracy | +3.8% | +5.0% | yes / yes | -0.12% [-0.39, +0.14] |
| KD per landed head strike | +4.9% | +7.4% | no / no | 0 |

The recipe is embed's: link = b0 + b1 link(mlrates) [+ b2 eta_emb] + b3 link(seqnet), fit on 2019-2023 out-of-fold
rows. A term is kept per target when time-ordered CV inside 2019-2023 (fit on years before v, score v = 2020..2023)
says it lowers deviance. The stat head is probably undertrained: the epoch count is set by the winner loss, which
overfits in 2-7 epochs. A head-specific schedule was not tried.

## Reproduce

Run from the project root. Times are on the shared 4-core box with about 12 other processes running.

    python3 tests/test_seqnet.py                          # symmetry test, random weights (6 s)
    python3 tools/seqnet.py data                          # tokens, sequences, targets (6 s)
    nice -n 5 python3 tools/seqnet.py hpcv --workers 2    # 2016-2018 HP CV, 9 configs x 3 folds x 2 seeds (15 min)
    nice -n 5 python3 tools/seqnet.py walk --workers 2    # 21 early-stopping + 56 refit runs (8 min)
    nice -n 5 python3 tools/seqnet.py swaptest            # trained-model corner swap on real data
    nice -n 5 python3 tools/seqnet.py cv                  # OOF, stack gate, method, stat lines (pre-2024 only)
    nice -n 5 python3 tools/seqnet.py confirm             # 2024-2025, refuses a second run without --force
    nice -n 5 python3 tools/seqnet.py addendum            # market-rating benchmark row on its 845 fights
    nice -n 5 python3 tools/seqnet.py export              # data/derived/seqnet.json
    nice -n 5 python3 tools/blindtest.py replay --models seqnet,moe_noline_seqnet,moe_close_seqnet,moe_noline,moe_close,market_close,ml2 --out <scratch>/blindtest_seqnet.json

Each stage resumes from its cache. `hpcv` and `walk` skip runs already in `hpcv.json` or `walk.pkl`. The chosen
config is frozen in `chosen.json` the first time `walk` runs; delete it to re-select. Training is seeded with one
thread per process, so reruns on the same machine should match to float precision. The verifier retrained the
2023 refit with seed 101 and got bit-identical logits.

Two runtime dependencies:
- **embed's state for the stat-line recipes.** The `cv` and `confirm` stat-line recipes that use embeddings read
  embed's `eval_state.pkl`, which `tools/embed.py` writes to its `--cache` directory. The published run read a
  session scratch copy.
  - Set `SEQNET_EMBED_STATE=<embed cache>/eval_state.pkl`. The default is `$TMPDIR/embed_cache`.
  - Without it, those recipes are skipped with a warning and the stat-line row set changes. No winner or stack
    number depends on it.
- **The harness replay output.** It lives in the session scratchpad. Its provenance (replay at 10:56:52 pm UTC) is
  in `seqnet.json["blindtest_replay"]`.

Verification: `nice -n 5 python3 tools/seqnet_verify.py all` (about 10 s) writes `data/derived/seqnet_verify.json`.

`data/derived/seqnet.json` carries the following.
- Per backtest fight id (2019-2025, 2,809 fights):
  - `p`: OOF for 2019-23, the fit before 2024 for 2024-25;
  - `p_annual`;
  - `fit_through`;
  - 7-bin and finish-round distributions from both fits.
- Block-level results: the HP CV summary, the swap test, the CV block, the 2024-25 block (with its addendum) and
  the harness replay summary.

## Caveats

- **Inherited inputs.** Elo comes from tools/ml.py and closing lines from market.json / nlbair. ML v2 shares both,
  and the Elo constants were set when ML v1 was built. The 2019-2023 out-of-fold years are therefore clean of
  seqnet's own selection, but not of every upstream choice.
- **Stance is a single current snapshot.** It is used as is. Height and reach enter only as differences.
- **Early stopping.** The epoch count comes from noisy one-year validation curves; the 2024 refit chose 2 epochs.
  Averaging 3 seeds' curves reduces the noise but does not remove it.
- **The HP grid was small.** 9 configs on 3 folds, and the top three are within 0.0007 of each other. A wider
  search is very unlikely to close a 0.015-0.028 gap to ML v2.
- **2024-25 was looked at once.** Nothing was selected on it. The 0.1% stat-line sliver is reported, not adopted.

---

The pre-registration below is verbatim as committed in 8e41138 (10:55:43 pm UTC by git). The "~10:58 pm" in its first
line was an estimate written before the commit; the commit time is the record.

## Pre-registration of the 2024-2025 look

Frozen before the look (all from data before 2024; `out/seqnet_cache/`):
- Config `from2010` (siamese GRU, H 64, attention pool, last 16 fights, method and stat heads at weight 0.3,
  trained on fights from 2010), chosen by the 2016-2018 time-ordered HP CV with ml2's 0.0005 rule
  (`hpcv.json`, `chosen.json`).
- Walk-forward refits 2019-2025: epochs per refit year by early stopping on the last training year (3 seeds),
  then refits on the whole window (8 seeds, logits averaged) (`walk.pkl`).
- The stack gate (ml2's forward-chained 2021-2023 stack CV, 0.0005 rule) REJECTED seqnet in all six pairs
  (close: market+ml2, market+ml2lr; open: open+ml2, open+ml2lr; no line: ml2+mkt_rating+feat_lr, ml2lr+mkt_rating);
  CV gains +0.00001 to +0.00030 (worse). **seqnet therefore enters no production stack, whatever 2024-2025 shows.**
- Method x round and stat lines: the CV numbers (2019-2023) already say seqnet's heads lose to methodround S and to
  mlrates; nothing from them is adopted.

What the look scores (stage `confirm`, once; `confirm.done` marks it):
- Primary (descriptive, decides nothing): seqnet static (fit < 2024) winner log loss vs ML v2 blend static on the
  854 decisive ML-universe fights, paired event-cluster bootstrap CI. CV expectation: seqnet worse by 0.010-0.020.
- Secondaries: seqnet annual (refit each January); vs ML v2 logistic, Elo, market rating, ML v1, the close (845)
  and the open (843); by year; experience segments; every gate pair's stack with and without seqnet (static and
  rolling); method x round vs S and S2+ml2win (857); stat-line deviance per target vs mlrates (dev fit) and the
  recipes fit on 2019-2023 with the CV keep rule (mlrates + seqnet, mlrates + embeddings + seqnet).
- Failure: not applicable to adoption (already rejected); if 2024-2025 showed seqnet gaining in a stack, that is
  one look and is not a reason to add it (the clean tests would be vault audit 2 and the forward ledger).

## Verification log

Adversarial verifier, Nov 6, 2026, about 11:05-11:25 pm UTC. I started from the stance that every number was fake
until reproduced. My code is `tools/seqnet_verify.py` (stages protocol, score, gate, claims and repro; about 10 s
in all), and it writes `data/derived/seqnet_verify.json`.

It is independent of the builder's evaluation code:
- its own log loss;
- its own event-cluster bootstrap, with a different seed;
- its own mirrored, intercept-free stacker;
- its own parse of the raw ufcstats CSVs.

It reads the builder's caches only as inputs (`out/seqnet_cache/data.pkl`, `walk.pkl` and `hpcv.json`).

**Decision: adopt = false. The builder's verdict is confirmed.** seqnet enters no winner stack and no method x
round or stat-line path. It stays as a standing negative baseline: the tool, the JSON, and a blind-test plugin whose
two stack variants are marked experimental.

### Protocol and leak hunt

| check | how | result |
|---|---|---|
| 2026 data | scanned data.pkl, the token days and seqnet.json | 0 examples and 0 tokens on or after 2026-01-01; last fight 2025-12-13. The only "2026-" strings in seqnet.json are the cutoff constant and build timestamps. The round stats and nlbair rows of 2026 are discarded before use. No vault file was needed. |
| look-ahead inside careers | checked every history token's date against the fight it feeds (94,963 tokens) | 0 tokens dated after their fight. 113 share the fight's day, all on 1994-1999 tournament nights. They are earlier bouts that night: build_db orders a day by -idx, and ufcstats lists the main event first. None falls in a training window (from 2010) or an evaluation year. |
| labels and joins | checked the 2,809 evaluation labels against my own parse of `ufc_fight_results.csv` | 0 mismatches and 0 missing. seqnet.json covers all 2,809 ml2 rows, so no bout failed to match and there is no match bias. |
| walk-forward windows | recomputed each refit's training rows | All 7 refits match the logged n_train. Each one's last training fight comes before Jan 1 of the year it predicts: the 2024 refit's last fight is 2023-12-16 (it predicts 2024-25), and the 2025 refit's is 2024-12-14. |
| normalisation | read the code | Token and side standardisation, the stat base rates and the draw shares are all fit on rows before each refit's cutoff. |
| published predictions | averaged walk.pkl's logits myself | They reproduce seqnet.json's `p` and `p_annual` to 5e-6, which is rounding. |
| selection | re-scored the HP CV from its raw runs, and read the git history | The table is identical, and the 0.0005 rule picks from2010, the only passing change. The config was frozen at 10:46:24 pm and the pre-registration committed at 10:55:43 pm. Confirm scored at 10:55:49 pm, with no forced rerun. After the commit, only the NaN-safe helpers and the addendum stage changed (`git diff 8e41138 HEAD -- tools/seqnet.py`). |
| early 2024 exposure | read the walk log | The 2025 refit early-stops on 2024 (validation log loss 0.6184, all bouts), so the walk shows one 2024 number before the look. Annual walk-forward requires this. Nothing depended on it: the config was already frozen. |
| tale-of-the-tape missingness | counted evaluation rows | Only 1 of the 2,809 has a missing height, reach or date of birth. The snapshot-missingness leak has no room to act in the evaluation universe. |
| corner order | ran the symmetry test and a free-intercept fit (2019-2023 OOF) | `tests/test_seqnet.py` passes exactly. seqnet's mean P(A) is 0.524 against a 0.571 A-win rate, and its free intercept is 0.225. For comparison: Elo 0.226, ML v2 0.195, close 0.124. seqnet does not exploit ufcstats' winner-first order. |

### Re-derivation (own code)

| claim | builder | verifier |
|---|---|---|
| OOF 2019-2023 winner log loss (1,955 fights) | 0.6492, slope 0.83 | 0.64923, slope 0.827 |
| OOF seqnet minus ML v2 blend | +0.0155 [+0.0067, +0.0240] | +0.0155 [+0.0066, +0.0237] |
| OOF seqnet minus the close | +0.0260 [+0.0129, +0.0385] | +0.0260 [+0.0132, +0.0382] |
| 2024-25 seqnet static (854 fights) | 0.6193 | 0.61933 |
| 2024-25 seqnet minus ML v2 blend | +0.0276 [+0.0171, +0.0386] | +0.0276 [+0.0170, +0.0378] |
| 2024-25 seqnet minus the close (845 fights) | +0.0315 [+0.0147, +0.0496] | +0.0315 [+0.0147, +0.0485] |
| 2024-25 annual minus static | -0.0001 [-0.0074, +0.0080] | -0.0001 [-0.0072, +0.0081] |
| stack gate, six pairs (forward-chained 2021-2023, 0.0005 rule) | all rejected; gains +0.00001 to +0.00030 | Identical CV values to 5 decimals in all six pairs, all rejected. Every paired CV-year CI spans 0. |
| gate with looser stackers | | Signed weights: gains -0.00000 to +0.00024. A free intercept with no mirroring (the corner-order exploit, not allowed) does best at -0.00038. Both are short of the 0.0005 bar. |
| harness: moe_close + seqnet minus moe_close | +0.0012 [+0.0000, +0.0025] | +0.00124 [+0.00006, +0.00250] (845 fights) |
| harness: moe_noline + seqnet minus moe_noline | +0.0014 [+0.0002, +0.0028] | +0.00141 [+0.00022, +0.00279] (854 fights) |
| harness fit dates | | Every seqnet `fit_through` is before its fight's date. |
| 7-bin, seqnet minus S | +0.051 (2019-23, 1,972 incl. draws); +0.062 (2024-25, 857) | +0.053 [+0.033, +0.072] (1,952 decisive); +0.065 [+0.037, +0.093] (853). Uses the published bins and raw outcomes. |
| raw stat head vs mlrates OOF, 2019-2023 | +16.0% (3,998 rows) | +15.97% (3,998 rows), own deviance |
| seed curve (1, 2, 4, 8 seeds) | 0.6528 / 0.6509 / 0.6503 / 0.6492 | 0.65275 / 0.65093 / 0.65026 / 0.64923 |
| retraining reproducibility | | The 2023 refit with seed 101, retrained, gives a max logit difference of 0.0 (bit-identical). |

### Defects found and fixed

1. **Overstated side findings (section 5 and the builder's summary).** Every hyperparameter-grid difference is
   within noise: all eight paired CIs against base include 0, and two seeds of one config differ by up to 0.0035.
   - "Joint heads help the winner (-0.0014)", "regularization did not help" and "the current Elo did not help" are
     now reported as not distinguishable from 0, with CIs.
   - "Every configuration overfits within 2-7 epochs" is true only at the base learning rate. The slow configs peak
     at 5-22 epochs.
   - "Data size is the binding constraint" is now labelled a hypothesis. No learning curve was run, and from2010,
     which drops 2005-2009, was not worse.
   - The transformer's +0.0083 was measured against from2010. Against the like-for-like base GRU it is +0.0077
     [-0.0004, +0.0156].
2. **The harness line mixed two fight sets.** It paired the 845-fight common-set levels (0.5855 -> 0.5865) with the
   854-fight paired difference. It now gives 0.5896 -> 0.5910 on all 854 and the common-set levels separately.
3. **Segments.** "Worse in every segment" is now worded as point estimates; four of the five 2019-2023 CIs include 0.
   The pre-registered expectation (0.010-0.020 worse than ML v2) is now set against the result (+0.0276).
4. **Commit time.** The pre-registration commit is 10:55:43 pm by git, not 10:55:44.
5. **Embed path (`tools/seqnet.py`).** `EMBED_STATE` defaulted to a path inside this session's scratchpad, so the
   "+emb" stat-line recipes would silently disappear anywhere else. It now defaults to embed's own
   `$TMPDIR/embed_cache`, still honours `SEQNET_EMBED_STATE`, and logs a warning when the file is missing. The
   `chosen_cfg` docstring now names the 0.0005 rule. No number changes.
6. **Replay provenance.** `blindtest_replay.replayed_at` in seqnet.json was null. It now holds the replay's own
   time, 10:56:52 pm UTC, and seqnet.json was re-exported. Its fights, cv, validation and hpcv blocks are
   byte-identical to before.

### Noted, not changed

- The stat-line keep rule has no margin. The 2024-25 sliver of -0.10% is one look and was pre-registered as not
  adopted.
- Inherited inputs are already listed under Caveats: the tale-of-the-tape snapshot (stance is current) and Elo
  constants from ML v1.
- The `seqnet` plugin is not marked experimental, so it appears in standing harness replays. It covers all 854
  decisive fights in the 2024-25 window, so it does not shrink the harness's common set.
