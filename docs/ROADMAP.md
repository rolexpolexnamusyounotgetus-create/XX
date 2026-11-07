# Engine roadmap: v3 to v10

**Status, Nov 7, 2026, 5:05 am ET (after v8's train gate).** The current validated engine is still **v4 (4.0.0)**. v8 (cycle 3,
stat-line fidelity: embedding blend, realised-rate retarget toward the statlines layer, takedown-intent / control-spread draws, on
the v4 simulator) was built and frozen; its binding train gate kept no sub-part: no pre-registration, no look (docs/CHANGELOG.md v8).
Earlier status (3:40 am ET, after v7's train gate): the current validated engine is still **v4 (4.0.0)**. v7 (cycle 2,
market props, on the v4 simulator with cycle 1 re-bundled) was built and frozen, and its binding train gate failed one marginal
check (cycle 1's close-regime winner bound vs the honest v4 package; cycle 2's own checks passed): no pre-registration, no look
(docs/CHANGELOG.md v7). Earlier status (3:00 am ET, after v6 and its review): the current validated engine is **v4 (4.0.0)**. v6 (the
prediction package with ML v2 heads) was validated once and rejected; its review changed no scored number and added no version,
but relabelled v6's train gate as not honestly passed, so v6's cycle-1 parts must pass v7's own gate before they can return
(docs/V6_V10_PLAN.md 7.1 item 10). Earlier status (after v5.0.1): The whole roadmap was built into v5 (Kira's
call, Nov 6): each v5-v10 component behind its own flag, verified in isolation, merged with a train leave-one-out ablation, then
measured once. v5 (5.0.0) and its review-fix release v5.0.1 were each validated once and **rejected** by the decision rule: both are
level with or slightly better than v4 on the winner (v5.0.1 -0.0057 [-0.0141, +0.0023], n.s.) and clearly better on four stat
lines, but their knockdown level runs hot on 2024-25 (KD per 100 head 0.83 vs 0.68; all of it in 2024). Every component is kept,
flag-isolated, in versions/v5.0.1-rejected/, which is the base for v6. v6-v10 are refinement cycles (docs/V6_V10_PLAN.md); the same
keep-only-if-better rule applies to every number.

Rule for every version: it ships only if it beats the previous version on the validation window (2024-01-01..2025-12-31, version
selection only; train 2019-2023; the 2026 vault is sealed for the two audits) with a paired 95% CI excluding 0 on winner log loss, or
is not worse there and clearly better on 7-bin, method or stat-line deviance (Holm-adjusted from v5.0.1 on) without base rates
drifting out of tolerance (a paired, SE-scaled test from v5.0.1 on: tools/evalv_decide.js). Each version records its numbers in
docs/CHANGELOG.md and data/derived/version_history.json. No version bump for cosmetic work.

| Version | Planned | Delivered (where it is now) | Checked by / result | Left for v6-v10 |
|---|---|---|---|---|
| v3 | Data-driven any-fighter engine, positions, KD follow-up, judging fit, walk-forward calibration, Elo baseline | done, validated (0.6424) | held-out log loss vs Elo; base rates | - |
| v4 | Opponent-adjusted skills, tuned decay and prior strengths | delivered as learned stat-line rates (mlrates), train-only priors, EM judging; **kept** (0.6324) | winner -0.0100 [-0.0170, -0.0030] vs v3 | its EM judging weights saw cards through 2026-10 (v5 carries the train-only refit) |
| v5 | Durability: age, weight moves, KO losses, damage, layoffs | **built** (components.durability: chin / power model, absolute L730 level; Calibrate A +0.0009 soft CE); in v5 / v5.0.1, both rejected | KD calibration by age band fixed on train; out of sample the absolute level runs hot in 2024 | a level that tracks era breaks (v9), chosen by train CV; the computed fallback re-levelled in v5.0.1 |
| v6 | Fight dynamics: fatigue, damage-driven output, adaptation | **built** (components.dynamics; v5.0.1 refit its within-fight noise to the real dispersion: fight-level ratio 0.99, A-B corr 0.705 vs 0.710) | round output correlation and KD-by-round now match on train; 5-round finish timing closer | round-level spread (sd 15.7 vs 12.6), log-attempt persistence, 3-round R2 finishes, MD / draws |
| v7 | Style matchups | **built**: styles_sos with strength of schedule on ("wf", +0.0009); style blocks off (they double-count on the learned path; winner tests null) | stat lines -0.5%; no winner effect | props-based how / when (cycle 2) |
| v8 | Officials: judges, referees, 10-8 rounds | **built**: components.officials (opt-in; named-judge effects do not predict), train-only EM judging, deductions, 10-8 rule | decision split and 10-8 share near train targets | MD 1.2% vs 2.0%, draws 0.75% vs 1.0%; stat-line retarget (cycle 3) |
| v9 | Uncertainty, ensembling, stacking with Elo and the market, recalibration | **built**: blend_anchor (FightEngine.predict: ML v2 package winner blend, pooled method x round, intervals); with the close it beats the close on 2024-25 (-0.0067 [-0.0096, -0.0036]) | scored once with v5; not part of a kept engine yet | walk-forward levels and drift trackers (glove-trial breaks as variance bumps), per-year KD / KO gate, fold-honest OOF pieces, recalibration rules (cycle 4) |
| v10 | Realism validation per division and method-by-round, sensitivity, final product pass | **built as capability**: realism_sens (FightEngine.sensitivity), director FUZZ test, page-vs-Node parity test | division / format factor layer off (no train gain) | newcomer path, explainer coherence, a page that ships the v5+ components (cycle 5), audit-2 freeze |

v5.0.1 also delivered the evaluation and hygiene the review asked for, which every later cycle uses: input guards in the engine,
the paired base-rate test and Holm adjustment, per-minute stat-line deviance, per-year / per-window base rates, the 2024-25 look
ledger (data/derived/val_look_ledger.json), and the vault cleanup of the durability and styles research.

What remains, in the order of docs/V6_V10_PLAN.md section 3 (re-ranked after v5.0.1):
1. **v6 (cycle 1): the prediction package as the kept object.** (Done Nov 7: built, validated once, REJECTED by branch 1, open winner -0.00245 [-0.00588, +0.00099] vs the v5.0.1 package; v4 stays; docs/CHANGELOG.md v6. Review done ~8:00 am UTC: the gate is relabelled "failed as first run; passes only under a comparator chosen after the failure", the look had power about 0.26, src/ml/blend.js 1.2.1 fixes the debut / manual line fallback and the interval; no new version; docs/CHANGELOG.md "v6 review".) Rebuild on versions/v5.0.1-rejected/; first fit the "out-of-fold"
   pieces fold-honestly (mlrates stack weights, embed calibration) and rerun Calibrate A / calB on them; ML v2 heads in predict(),
   line routing; one pre-registered look. KD level stays the v5 one unless train CV finds better (it did not in v5.0.1).
2. **v7 (cycle 2): market props for how and when.** (Done Nov 7: built on v4, binding train gate FAILED on cycle 1's close-regime
   winner bound, marginal; cycle 2's checks passed; no look; versions/v7-gate-failed/.) Base: v4 (latest kept). It may re-bundle cycle 1's parts (ML v2 head stacks,
   routing, S2 cells, tree head, harness) only through its own gate, run once under a comparator committed beforehand, with
   honest per-year comparator inputs, one refit schedule for both packages, power from the gate's SE and 20,000-resample CIs
   (V6_V10_PLAN 7.1 item 10; docs/BACKLOG.md "v7 gate and look requirements"). The v5-lineage simulator has used its re-bundle;
   predict() therefore has to be carried onto the v4 simulator (refusing, not falling back, when FightBlend is missing).
3. **v8 (cycle 3): stat-line fidelity** (control, attempts; the one cycle most likely to pass). (Done Nov 7: built on v4, binding
   train gate FAILED, no sub-part kept: the retarget improved total stat-line deviance on train but missed the 7-bin / method
   +0.002 bounds and a SUB base-rate tolerance the comparator also misses; control MAE worsens; versions/v8-gate-failed/.)
4. **v9 (cycle 4): levels and drift.** The 2024 knockdown and KO drop (glove trial and early 2024) is the main open level question;
   handle dated breaks as variance bumps on the forward ledger, never as a tilt fit on 2024-25.
5. **v10 (cycle 5): newcomers, explainer, the page.** The page currently runs v4; a v5+ page must pass tests/test_page_parity.js.

The 3D show and the page improve alongside: modern renderer, image-based lighting, post-processing, likeness avatars from the tale
of the tape and the scouting files, technique choices from each fighter's real style, and a matchup explorer for any two fighters.
