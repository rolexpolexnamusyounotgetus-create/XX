# v4.0.1: rejected (Nov 6, 2026)

Engine 4.0.1, params 4.0.1-pre2024: v4 plus the v4 review's fixes, all fit on train data (2019-2023) only.

- **judge weights**: EM round-winner weights refit on the 5,519 ufcstats cards from 2015 through 2023
  (tools/judge_em_train.py -> data/derived/judge_em_train.json). v4.0.0 used cards through 2026-10.
- **judging**: tools/judgecal.js refit, plus point deductions (judge.ded 0.00515 per fighter-round, judge.ded2 0.075).
- **levels**: tools/v4_levels.js re-run on all 1,999 train fights with learned-path levels: mlTdLevel 1.067,
  mlCtrlLevel 1.053, mlSubLevel 1.083; t108 8.31.
- **cap**: src/ml/mlrates.js caps the cumulative takedown-attempt multiplier (and the takedown-odds one) at mlMaxRatio.

Validation (one look, 11:45 am ET), paired against v4:
- Winner log loss: 0.6289 vs 0.6324, -0.0034 [-0.0073, +0.0008]. The CI includes 0.
- 7-bin: -0.0004 [-0.0232, +0.0149].
- Method: +0.0010 [-0.0046, +0.0063].
- Stat-line deviances: all CIs include 0.

Neither branch of the decision rule is met, so v4 was restored in src/. Numbers, notes and the decision are in
data/derived/version_history.json (entry v4.0.1) and docs/CHANGELOG.md.

Contents:
- engine3.js, params3.js, ml/mlrates.js: the frozen files evaluated by `tools/evalv.js --version v4.0.1`.
- tests/test_engine3.js: the test file for this version (VERSION 4.0.1, deductions, pre-2024 EM weights, cumulative cap).
  It reads ROOT/src, so it only runs with these files copied into src/.
- data/judgecal.json, data/v4_levels.json: this version's fits. data/derived/ holds v4.0.0's again.
- logs/: tests (76 passed, 0 failed), director test with learned rates, level matching, evalv train and val runs.

`versions/v4.0.1` is a symlink to this folder, so tools and agents that still use that path keep working.
