# v6 (6.0.0): built, train gate passed, pre-registered (Nov 7, 2026); validation look pending

Engine 6.0.0, params 6.0.0-selfcal-pre2024. The exact files `tools/evalv.js --version v6` and `tools/predict_harness.js
--pkg v6=versions/v6:v6` evaluate. Pre-registration: data/derived/version_history.json, entry v6, field `prereg` (written
before any 2024-25 run of v6). Details: docs/CHANGELOG.md "v6".

What v6 is (docs/V6_V10_PLAN.md section 3, cycle 1, on the 4.1 "v5 rejected" branch):
- Simulator: the v5.0.1 simulator re-bundled (V6_V10_PLAN 6.1), after the v6 review gate 1: the learned-rate stack weights
  and the embedding-blend recipe refit fold-honestly (tools/v6_foldhonest.py, tools/v6_embed_fh.py), Calibrate A's embed /
  preufc calls rerun on them (verdicts unchanged) and the joint knockdown / finish / judging level pass rerun on them
  (params v501.set.levels; train 2019-2023 only). mlpathrec.js here selects the fold-honest recipe for engine major >= 6.
- Package (ml/blend.js 1.2.0): FightEngine.predict's winner is the ML v2 blend-head stack of the line regime (no line:
  ML v2 + market rating; open: opener + ML v2; close: closing line + ML v2; data/derived/v6_stacks.json), routed by the
  explicit lineKind; method x round pools 0.35 x simulator cells with 0.65 x S2 cells (data/derived/mr_s2.json; live:
  tools/methodround_model.js createS2); the ML v2 blend on the page comes from the JS tree evaluator ml/ml2trees.js
  (data/derived/ml2_trees.json, 416 KB gzipped with its test vectors); lab-3 debut method path (ml/debut.js) and
  distributional stat lines (ml/statdist.js) for live use.
- `params.blend { winner: 'stack', mrModel: 'S', debut: false, statDist: false, mrWeight: 0.3 }` reproduces the v5.0.1
  package bit for bit (tests/test_v6.js).

Contents: engine3.js, params3.js, styles_sos.js, mlpathrec.js, ml/{blend, mlrates, embed, moe, ml2, mlpage, ml2trees, debut,
statdist}.js. Backtests pass walk-forward cells, so ml/blend.js's relative require of tools/methodround_model.js is not needed
here (live use runs from src/).
