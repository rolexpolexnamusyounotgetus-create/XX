# v8 (8.0.0): frozen candidate, binding train gate FAILED (no sub-part kept; no pre-registration, no look)

- engine3.js: the v4 simulator (4.0.0, bit for bit with every v8 flag off; tests/test_v8.js check 1) + docs/V6_V10_PLAN.md
  cycle 3 behind flags: `components.embed` (embedding blend of the learned targets, the v6 engine's code), `components.retarget`
  (realised-rate retarget toward the statlines layer: pilot of 200 simulations per corner order and iteration, 2 iterations,
  like-for-like targets at each simulation's own length and finished status, corrections of takedown attempts, control target,
  takedown odds, attempts by position and strike accuracy odds, capped by mlMaxRatio; knockdown / conversion / stoppage untouched),
  `components.tdIntent` / `ctrlSpread` (fight-level mean-1 lognormal takedown intent / top-stint length per fighter, sd 1.1 / 0,
  acting only on a retargeted matchup). params3.js: v4's values + the blocks components, embed, retarget, spread.
  ml/: mlrates.js (v4's), embed.js. mlpathrec.js: tools/mlpathrec.js as committed with the protocol (fold-honest embedding inputs).
- Inputs: data/derived/v8/statlines_targets.json (statdist engineTargets + finished-fight grid from the forward-chained fold
  tables of tools/v8_statlines_folds.py; none for 2019), mlrates_oof_fh.json, embed_blend_fh.json.
- Train gate (data/derived/v8/gate_protocol.json, committed in 1d8e729 before the run; binding run data/derived/v8/gate_train.json;
  score data/derived/v8/gate_train_score.json): FAIL, no sub-part kept (retarget fails the 7-bin / method +0.002 bounds and the
  SUB base rate; embed has no gain and worsens control MAE; tdIntent improves the takedown PIT but worsens deviance; ctrlSpread is
  a no-op at sd 0). Descriptive (not a gate result): every flag on vs v4 control deviance -3.24 s [-5.37, -1.13], control MAE
  +1.72 s [+0.83, +2.61].
- data/derived/version_history.json v8: status `gate_failed`, `train_gate`, `decision` (kept false); validation null; tools/evalv.js
  refuses a validation look for this entry. `versions/v8` is a compatibility symlink to this folder.
- Never edit this folder: a change is a new version.
