# v6 (6.0.0): rejected (Nov 7, 2026)

Engine 6.0.0, params 6.0.0-selfcal-pre2024. Validated once and **rejected** by the pre-registered decision rule (branch 1).
src/ holds v4 (4.0.0) again. Details: docs/CHANGELOG.md "v6"; data/derived/version_history.json, entry v6 (`prereg`,
`validation`, `validation.package`, `decision`).

What v6 is (docs/V6_V10_PLAN.md section 3, cycle 1, on the 4.1 "v5 rejected" branch):
- Simulator: the v5.0.1 simulator re-bundled (V6_V10_PLAN 6.1), after the v6 review gate 1: the learned-rate stack weights
  and the embedding-blend recipe refit fold-honestly (tools/v6_foldhonest.py, tools/v6_embed_fh.py), Calibrate A's embed /
  preufc calls rerun on them (verdicts unchanged) and the joint knockdown / finish / judging level pass rerun on them
  (params v501.set.levels; train 2019-2023 only). mlpathrec.js here selects the fold-honest recipe for engine major >= 6.
- Package (ml/blend.js 1.2.0): FightEngine.predict's winner is the ML v2 blend-head stack of the line regime (no line:
  ML v2 + market rating; open: opener + ML v2; close: closing line + ML v2; data/derived/v6_stacks.json), routed by the
  explicit lineKind; method x round pools 0.35 x simulator cells with 0.65 x S2 cells (data/derived/mr_s2.json; live:
  tools/methodround_model.js createS2); the ML v2 blend on the page comes from the JS tree evaluator ml/ml2trees.js
  (data/derived/ml2_trees.json); lab-3 debut method path (ml/debut.js) and distributional stat lines (ml/statdist.js).
- `params.blend { winner: 'stack', mrModel: 'S', debut: false, statDist: false, mrWeight: 0.3 }` reproduces the v5.0.1
  package bit for bit (tests/test_v6.js).

Validation (one look, 07:02-07:06 UTC Nov 7; pre-registered at 06:56 UTC; a confirmation look):
- primary, open-regime winner log loss vs the v5.0.1 package on 842 decisive fights: 0.58193 vs 0.58438,
  -0.00245 [-0.00588, +0.00099]. The CI upper bound is above 0, so branch 1 fails (no branch-2 rescue was registered);
- secondaries: no line -0.00315 [-0.00709, +0.00069], close -0.00226 [-0.00463, +0.00014], 7-bin and method n.s.;
- engine level vs v4: winner -0.0065 [-0.0148, +0.0016]; sig landed, TD and control deviance better after Holm; KD per
  100 head 0.834 vs 0.684 fails the paired base-rate test (with the glove-trial window excluded, the SD+MD share fails instead).

Contents:
- engine3.js, params3.js, styles_sos.js, mlpathrec.js, ml/{mlrates, embed, blend, moe, ml2, mlpage, ml2trees, debut,
  statdist}.js: the frozen files the look evaluated (hashes = version_history.json v6 `prereg.files_sha256`; unchanged).
- tests/: the sixteen v5- and v6-engine tests that read ROOT/src (test_v6, test_v5_step2-5, test_v5_calB, test_v401, test_v501,
  test_v501_guards, test_durlevel, test_durability, test_dynamics, test_styles_sos, test_officials, test_realism_sens,
  test_blend_anchor) and v6's test_engine3.js. They run only with these files copied into src/.
- logs/restore/: the tests on the restored v4 src (24 of 24 pass).

Look outputs: data/derived/v6/look_val.json (harness), look_val_wiring.json (pre-scoring abort check), look_val_score.json;
data/derived/evalv/v6_val.json, v6_blend.json, v6_vs_v4_val_decide.json, v6_vs_v4_val_methodround_paired.json.

`versions/v6` is a symlink to this folder.
