# v10 (10.0.0): consolidated bundle, binding bundle-level train gate PASSED, single look run: KEPT by branch 2 (kept under the glove-window amendment)

- engine3.js: v8's simulator code (the v4 simulator + components embed / retarget / tdIntent / ctrlSpread exactly as v8 shipped
  them; every v8 flag off = versions/v4 bit for bit, defaults = versions/v8-gate-failed bit for bit; tests/test_v10.js) + v7's
  FightEngine.predict block (refuses without FightBlend; needs FightBlend >= 1.4.0) + cycle 5's FightEngine.showFight (explainer
  coherence: the shown traced fight's winner x method x round is a draw from predict()'s cells) + manualProfile keeps n_fights 0.
- params3.js: v4's simulator values + v8's blocks (components, embed, retarget, spread) + v7's blend block with mrWeight 0.2 and
  props.w [0.47, 0.53] (non-binding fits-only run data/derived/v10/dev_fits.json) + blend.debutWinner true + components.explainer
  / explainer block.
- ml/: blend.js 1.4.0 (swaps statTargets / statdist with the corners in predict's B-A run; newcomer path: a debut bout's winner
  from the line-only stack, else opts.seededElo; the debut winner model reported as a monitored candidate), debut.js, embed.js,
  ml2.js, ml2trees.js, mlpage.js, mlrates.js (v4's), moe.js, propspool.js, statdist.js. mlpathrec.js: tools/mlpathrec.js.
- tools/ and tests/: the GATE-TIME copies hashed in data/derived/v10/gate_protocol.json (predict_harness.js with mode v10,
  predictrec.js, predict_score.py, v10_gate.py, v10_stat_gate.js, v10_explainer_check.js, v7_gate.py, v8_gate.py,
  methodround_model.js, test_v10.js). After the gate, tools/v10_gate.py gained the `look` command and tools/v10_stat_gate.js its
  binding-only `--split val` mode (hashes in data/derived/v10/look_protocol.json); the gate code paths are unchanged.
- Train gate (protocol committed first, 0358a0c at 11:19:34 UTC Nov 7; binding runs once 11:19-11:25 UTC; score
  data/derived/v10/gate_train_score.json): PASS. Primary open-regime winner log loss v10 package - cmp4 (2021-2023, 1,222 decisive
  fights) -0.00528 [-0.00964, -0.00097] (v7's C1 open number reproduced exactly, as stated before the run); co-primary total
  stat-line relative deviance v10 engine - v4 -1.13% [-1.76%, -0.51%] (1,254 fights). The design was chosen after v7's / v8's train
  results (disclosed in the protocol): the gate is a consistency / wiring check, not independent evidence.
- data/derived/version_history.json v10: status `preregistered`, `train_gate`, `prereg` (the single look: open-regime winner vs
  cmp4, branch 1; branch 2 = total stat-line deviance vs v4 + the glove-excluded paired base-rate test), validation null;
  vault_audits[audit 2] holds the audit-2 pre-registration. The look runs data/derived/v10/look_protocol.json's commands once.
- Never edit this folder: a change is a new version.

Validation (one look, 11:39-11:44 UTC Nov 7; pre-registered at 11:34:57 UTC; a confirmation look; docs/CHANGELOG.md "v10 look"):
- Ran data/derived/v10/look_protocol.json's commands once, in order, on these frozen files (engine e5c05d2f, params 8c20073f, ml/blend.js
  55e072c4; hashes unchanged). Pre-checks: tests/test_v10.js 19 / 19, 39 of 40 jobs (test_page_parity: its 4 tolerated checks). Exactly the
  11 pre-announced fights failed (no ML v2 monthly-rolling row).
- Primary, open-regime winner log loss, this package minus cmp4 (842 decisive fights): -0.00326 [-0.00653, +0.00004]; the upper bound is
  marginal (within 2 MC SE of 0) and the clustered normal bound (+0.00002) decides: branch 1 fails.
- Branch 2 keeps: not worse (upper <= +0.002); total stat-line deviance vs v4 -0.88% [-1.69%, -0.07%]; the glove-excluded paired
  base-rate test passes (the full window fails on KD per 100 head 0.771 vs 0.684 actual) -> label "kept under the glove-window amendment".
- Outputs: data/derived/v10/look_val.json, look_stat_val.json, look_val_score.json, look_val_secondaries.json, data/derived/evalv/
  v10_val.json, v10_vs_v4_val_decide.json, v10_blend.json; version_history.json v10 `status: kept`, `validation`, `decision`.
- v10 is the latest kept version (src/ = this folder's engine, params and ml/blend.js).
