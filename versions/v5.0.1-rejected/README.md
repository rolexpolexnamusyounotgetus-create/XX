# v5.0.1: rejected (Nov 7, 2026)

Engine 5.0.1, params 5.0.1-selfcal-pre2024: engine 5.0.0 (versions/v5-rejected/) plus the v5 review's fixes. Validated once and
**rejected** by the pre-registered rule; src/ holds v4 (4.0.0) again. Details: docs/CHANGELOG.md "v5.0.1", research/v501_fixes.md,
data/derived/version_history.json (entry v5.0.1).

What 5.0.1 changed (each behaviour fix behind a `components.v501` sub-flag; v501 off = 5.0.0 for valid inputs, tests/test_v501.js):
- Input guards, no flag (bit-identical to 5.0.0 on the train backtest): finite / non-negative rate tables checked at the end of
  matchup (the field is named), a total-rate check and a 200,000-event cap per round in simulate, invalid durability / pre-UFC /
  embedding inputs treated as missing (src "partial" / "computed"), judge power falls back when not finite and a NaN round score
  throws, one canonical YYYY-MM-DD date for every leak guard (Date objects and timestamps converted, unparsable strings refused),
  integer rounds 1-5, params3.js / mlrates.js loaded from the engine's own folder in Node with a params major-version check, and
  FightBlend refuses invalid odds instead of silently dropping the line.
- durFallback: the computed chin / power fallback re-levelled to the record path (page and newcomers only).
- dynNoise: within-fight output noise refit to the real fights' dispersion on 2019-2023.
- levels: outLevel and the joint knockdown / finish / judging level pass redone on top of dynNoise.
- kdBase: no set. The pre-registered forward-chained 2019-2023 check kept the trailing 730-day knockdown base.

Validation (one look, 4:3x am UTC Nov 7; the second look at 2024-25 for the v5 lineage, pre-registered as such), paired vs v4:
- winner log loss 0.6267 vs 0.6324, -0.0057 [-0.0141, +0.0023]: branch 1 fails;
- sig landed, attempts, TD and control deviance better after Holm, but KD per 100 head 0.827 vs 0.684 actual (v4 0.746) fails the
  paired base-rate test: branch 2 fails.

Contents:
- engine3.js, params3.js, styles_sos.js, mlpathrec.js, ml/{mlrates, embed, blend, moe, ml2, mlpage}.js: the frozen files
  `tools/evalv.js --version v5.0.1` evaluated (sha256 beccb4c5... / 8c27856e...).
- tests/: the 5.0.1-engine tests (test_engine3 for 5.0.1, test_v501, test_v501_guards, test_durlevel, and the v5 tests with
  components.v501 pinned off). They read ROOT/src, so they run only with these files copied into src/.
- data/: v501_levels.json (the level pass), v501_kdlevel_cv.json (the knockdown-base check), durlevel_fit.json (the fallback
  constants). Copies of the files in data/derived/.
- logs/: the realism grid (dynfit_grid.jsonl), the level-pass log, train decide outputs vs 5.0.0 and v4, and the tests on the
  restored v4.

`versions/v5.0.1` is a symlink to this folder.
