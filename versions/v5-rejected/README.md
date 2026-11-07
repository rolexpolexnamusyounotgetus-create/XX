# v5: rejected (Nov 6, 2026, 9:10 pm ET)

Engine 5.0.0, params 5.0.0-selfcal-pre2024: the whole roadmap merged onto v4.0.0 behind `params.components` flags. That covers
v4.0.1's train-only fixes (v401), durability, dynamics, styles_sos (SOS "wf"), officials (off), realism_sens (off), embed, oppadj
(off), preufc, blend_anchor (FightEngine.predict), and Calibrate B's joint level pass (calB). Everything was fit on 2019-2023 only.
The merge log is in docs/CHANGELOG.md ("v5 merge log").

One validation look (8:51 pm ET; `node tools/evalv.js --version v5 --split val --compare v4`), paired against v4 on 865 fights,
853 of them decisive:
- Winner log loss 0.6301 vs 0.6324, -0.0022 [-0.0099, +0.0053]. The CI includes 0.
- 7-bin +0.0029 [-0.0224, +0.0287], method -0.0005 [-0.0107, +0.0100], who x how x when +0.0091 [-0.0188, +0.0396]. All n.s.
- Stat-line deviance is better on 4 of 5 stats, with CIs excluding 0: sig landed -0.71, attempts -1.23, TD -0.048, control
  -4.1 s. KD is level.
- Base rates newly out of tolerance (v4 was inside both):
  - KD per 100 head landed 0.830 vs actual 0.684: +21%, against a 12% tolerance.
  - KO/TKO share 31.8% vs 29.1%: +2.7 pts, against 2 pts.

Branch 1 of the decision rule fails on the winner. Branch 2 fails on its base-rate condition. So v4 was restored in src/.
Numbers, the package scoring (tools/predict_eval.js), the blend test and the decision are in data/derived/version_history.json
(entry v5) and docs/CHANGELOG.md ("v5 (2026-11-07)").

Contents:
- engine3.js, params3.js, styles_sos.js, mlpathrec.js, ml/{mlrates, embed, blend, moe, ml2, mlpage}.js: the frozen files that
  `tools/evalv.js --version v5` evaluated (sha256 951a7e63... / bebc8d05...). They are unchanged since the freeze.
- tests/: the thirteen tests that need this engine in src/. They are test_engine3.js (the v5 version), test_v401,
  test_v5_step2..5, test_v5_calB, test_durability, test_dynamics, test_styles_sos, test_officials, test_realism_sens and
  test_blend_anchor. They read ROOT/src and ROOT/tests/fixtures, so they only run from tests/ with these engine files copied
  into src/. tests/test_v5_calA.js stayed in tests/ because it checks frozen fixtures and still passes.
- data/v4_levels.json: the v5-era output of tools/v4_levels.js, a step-3 smoke run. data/derived/ holds v4's file again.
- logs/: the package run (predict_eval_val.log) and the tests on the restored v4 (test_engine3 69 passed; director OK).

Related outputs stay in data/derived/:
- evalv/v5_train.json, v5_val.json, v5_blend.json, v5_val_package.json, v5_vs_v4_val_methodround_paired.json
- blindtest_stack_pre2024_v5.json, the pre-2024 stacker with engine_v5's train rows (blindtest.py registers engine_v5 as
  REJECTED, so default exports keep engine_v4)

src/styles_sos.js, src/ml/embed.js and src/ml/blend.js stay in src/. The v4 engine does not use them.

`versions/v5` is a symlink to this folder. Tools and the first vault audit (pre-registered scope: v5 vs v4 paired) keep
working on that path.

Update (Nov 7): the v5 review's fixes were measured as v5.0.1 (versions/v5.0.1-rejected/), also rejected. Build v6 from that
folder; this one stays as the exact 5.0.0 the first vault audit pairs against v4.
