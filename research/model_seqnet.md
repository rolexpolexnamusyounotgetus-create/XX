# seqnet: deep career-sequence model (task key: seqnet)

PRE-REGISTRATION (written Nov 6, 2026, ~10:58 pm UTC, before the single 2024-2025 look; the full report replaces
this section's place at the top once the look has run, and this section is kept verbatim below it).

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
