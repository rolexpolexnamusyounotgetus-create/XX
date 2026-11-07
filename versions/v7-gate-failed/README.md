# v7 (7.0.0): frozen candidate, binding train gate FAILED (no pre-registration, no look)

- engine3.js: the v4 simulator bit for bit (versions/v4) + FightEngine.predict (refuses without FightBlend) + manualProfile
  keeps n_fights 0. params3.js: v4's values + `components.blend_anchor` and the `blend` block (winner 'ml2stack', S2 pool
  mrWeight 0.15, props pool w [0.47, 0.53] fit 2021-2023; both weights from the non-binding fits-only run
  data/derived/v7/dev_fits.json). ml/: blend.js 1.3.0, propspool.js, moe.js, ml2.js, ml2trees.js, mlpage.js, mlrates.js (v4's),
  debut.js, statdist.js. tools/ and tests/: the harness, predictrec, scorer and test as committed with the protocol.
- Train gate (data/derived/v7/gate_protocol.json, committed in 78b01cf before the run; binding run
  data/derived/v7/gate_train.json; score data/derived/v7/gate_train_score.json): 32 of 33 checks pass; FAIL on cycle 1's
  close-regime winner bound (v7 with props off minus the honest v4 package: -0.0024 [-0.0054, +0.00054], marginal, normal
  bound +0.00060 > +0.0005). Cycle 2's checks all pass (7-bin -0.0149 [-0.0273, -0.0028]).
- data/derived/version_history.json v7: status `gate_failed`, `train_gate`, `decision` (kept false); validation null.
  tools/evalv.js refuses a validation look for this entry. `versions/v7` is a compatibility symlink to this folder.
- Never edit this folder: a change is a new version.
