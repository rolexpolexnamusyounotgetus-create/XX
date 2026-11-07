# v9 (9.0.0): frozen candidate, binding train gate FAILED (8 of 14 checks; no pre-registration, no look)

- engine3.js: the v4 simulator (4.0.0, bit for bit with every v9 flag off; tests/test_v9.js checks 1a-1d) + docs/V6_V10_PLAN.md
  cycle 4 behind flags: `components.judgeWF` (EM round-winner weights from params.judgeWF.byYear of the fight's year, each row fit
  on judges' cards before Jan 1 of that year; the 10-8 threshold from the tracked 10-8 level opts.level.r108), `components.format`
  (5-round KD factor kd5, rounds 4-5 finish factor late5, conversion odds conv, doctor / corner scale stop), `components.levels`
  (walk-forward level factors on the learned targets via opts.level; off). params3.js: v4's values + the blocks components,
  judgeWF (byYear 2019-2026, r108 mapping), format. ml/: mlrates.js (v4's).
- Inputs: data/derived/v9/judge_wf.json (tools/v9_judge_wf.py), data/derived/eradrift.json (10-8 tracker), tools/v9_levels.js
  (level trackers, r108At), data/derived/v9/format_fit.json, t108_map.json, levels_phi.json, levels_select.json.
- Train gate (data/derived/v9/gate_protocol.json, committed in f97d110 before the run; binding run data/derived/v9/gate_train.json;
  replay data/derived/v9/drift_replay.json; score data/derived/v9/gate_train_score.json): FAIL on G1 (5 of 6 year-level base-rate
  errors; control falls), G2a (sig-landed deviance), G7 7-bin and method (+0.002 bounds); passes G2b, G5, G6a-c, G7 winner;
  G3 / G4 not applicable.
- data/derived/version_history.json v9: status `gate_failed`, `train_gate`, `decision` (kept false), `drift_monitor` (the forward
  ledger's monitor rules); validation null; tools/evalv.js refuses a validation look for this entry. `versions/v9` is a
  compatibility symlink to this folder. The harness runs it with `--engine-dir versions/v9`.
- Never edit this folder: a change is a new version.
