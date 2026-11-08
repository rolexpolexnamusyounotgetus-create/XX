# Component: durability (engine v5), `params.components.durability`

Nov 6, 2026.

- **Built:** worktree `/home/user/XX/.claude/worktrees/wf_0113c02d-461-1`, branch `comp/durability`.
- **Verified three times:** worktree `/home/user/XX/.claude/worktrees/wf_0113c02d-461-3`, branch `verify/durability`
  (HEAD `6d857ca`; alias `verify/durability-pass3` at the same commit).
  - First pass: 3:40-4:41 pm UTC.
  - Second pass: 7:00-7:35 pm UTC.
  - Third pass: 8:24-8:50 pm UTC, independent, with new code.
- Nothing was pushed, and the main checkout was not edited.
- **Base commit for `durability.patch`:** `853ce32a40216ecdc9ac8daa35de006932ae6665`, the worktree's start commit.

## Third verifier's verdict (8:50 pm UTC): include in v5 (include = true)

**Include it with the same settings: flag on, `engineWeight` 0.5, absolute level, `kdCal` 1.1639618.** Apply it with
`durability_v4main.patch`.

- **No bugs found.** No patch file changed in this pass. Only this file was edited; the second pass's copy is kept as
  `durability.md.pass2`.
- **Main has not moved.** Engine 4.0.0 (= `versions/v4`). The seven target files still match the 7:25 pm snapshot md5s
  exactly. `durability_v4main.patch` applies to a fresh copy of main with no offsets or fuzz.
- **The deliverables match each other:**
  - the patch changes exactly the same lines in `engine3.js` and `params3.js` as the branch (`275b339..6d857ca`);
  - `durability.patch` is exactly `git diff 853ce32..6d857ca`;
  - `durability_component_only.patch` is exactly `git diff 275b339..6d857ca`.
- **Condition for the v5 measurement (unchanged).** `tools/evalv.js` must pass the walk-forward records; the wiring is
  in the patch.
  - I ran it end to end on the train split only: `--dev`, 2 sims per order, scratch copy.
  - Result: 1,999 of 1,999 fights, every matchup with records applied, no throws.
  - All 865 validation fights have a strict record (`fit_through` 2023-12-31). I checked fight ids only; no
    validation outcome was read or scored.

### Fresh-seed train ablation, third pass (v4.0.0 + component)

**Setup**

- Fights: 2019-01-01..2023-12-31, 1,999 backtest_dev fights in 211 events.
- Both corner orders, 250 sims per order (500 per fight).
- Common random numbers per simulation: `seed = h("v3dur|" + id + "|" + order + "|" + s)`. The same seeds are used
  flag off and flag on, and the scheme is new.
- Learned rates: OOF (`mlrates_oof.json`). Priors: `mlcal_priors_asof[year]`.
- Durability inputs:
  - the walk-forward record, with `fit_through` asserted earlier than the fight's year for all 1,999 fights;
  - base = the geometric mean of the two directions' `p / (C_def x P_att)`. The two directions agree to 3e-4 in log;
  - the train-only NORM; no roster loaded.
- The harness also asserts that every on-matchup used both records and the record base, and that no off-matchup carries
  `m.dur`.
- Code: harness `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur3/abl3.js`, scorer
  `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur3/score3.py`. They share no code
  with the builder's or either earlier verifier's.
- Scoring:
  - both orders pooled in the data's A/B frame, no intercepts;
  - 0.5 pseudo-count per category;
  - KO class = every engine stoppage that is not a submission (KO, TKO, GNP, LEG, DOC, CORNER);
  - outcomes as `evalv.js` maps them (NC, CNC and DQ excluded).
- CIs: paired event-cluster bootstrap, 2,000 resamples.
- CPU: 129 s in total (3 workers at nice 5, about 43 s each).

| Metric | n | off (v4.0.0) | on | on - off [95% CI] | 2nd pass |
|---|---|---|---|---|---|
| Winner log loss | 1952 | 0.6663 | 0.6649 | -0.0014 [-0.0035, +0.0006] | -0.0001 [-0.0022, +0.0020] |
| Brier | 1952 | 0.2369 | 0.2362 | -0.0007 [-0.0017, +0.0003] | -0.0000 [-0.0011, +0.0010] |
| Accuracy | 1952 | 0.5922 | 0.5973 | +0.0051 [-0.0046, +0.0150] | |
| **Soft-label CE vs closing line** | 1999 | 0.6717 | 0.6707 | **-0.0011 [-0.0016, -0.0005]** | -0.0008 [-0.0014, -0.0002] |
| **7-bin log loss** | 1972 | 1.6653 | 1.6580 | **-0.0073 [-0.0139, -0.0011]** | -0.0068 [-0.0131, -0.0009] |
| **Method log loss** | 1972 | 0.9689 | 0.9647 | **-0.0042 [-0.0075, -0.0009]** | -0.0036 [-0.0070, -0.0002] |
| **Round log loss** | 1972 | 1.2009 | 1.1968 | **-0.0042 [-0.0073, -0.0010]** | -0.0036 [-0.0070, +0.0001] |
| **Stat dev: sig landed** | 1999 | 23.686 | 23.494 | **-0.192 [-0.307, -0.072]** | -0.158 [-0.286, -0.038] |
| **Stat dev: sig attempted** | 1999 | 49.252 | 48.894 | **-0.358 [-0.593, -0.110]** | -0.299 [-0.563, -0.050] |
| **Stat dev: head landed** | 1999 | 17.781 | 17.648 | **-0.133 [-0.217, -0.050]** | -0.112 [-0.199, -0.031] |
| Stat dev: knockdowns | 1999 | 0.7183 | 0.7163 | -0.0019 [-0.0071, +0.0034] | -0.0023 [-0.0077, +0.0034] |
| **Stat dev: TD landed** | 1999 | 1.7448 | 1.7376 | **-0.0072 [-0.0114, -0.0030]** | -0.0038 [-0.0079, +0.0002] |
| **Stat dev: TD attempts** | 1999 | 3.2379 | 3.2273 | **-0.0106 [-0.0196, -0.0015]** | -0.0049 [-0.0133, +0.0041] |
| Stat dev: sub attempts | 1999 | 0.896 | 0.895 | -0.001 [-0.003, +0.001] | +0.0001 [-0.0024, +0.0026] |
| Stat dev: control (min) | 1999 | 2.6107 | 2.6058 | -0.0049 [-0.0110, +0.0014] | -0.0005 [-0.0066, +0.0056] |

- Stat deviance is Poisson, the mean of the two sides per fight.
- References on the same fights: closing line (`p_power_close`) winner log loss 0.6223; closing-line entropy, the floor
  for the soft CE, 0.6268.
- **Fresh seeds remove Monte Carlo noise, not sampling noise.** All four runs score the same 1,999 fights. When they
  agree (for example, 2021 being the worst year in every run), that confirms the Monte Carlo is stable. It is not
  independent evidence. The event-bootstrap CI above is the right measure of uncertainty.

**Base rates** (actual / off / on; on - off [95% CI]; on - actual [95% CI]):

| Base rate | n | actual | off | on | on - off | on - actual |
|---|---|---|---|---|---|---|
| finish | 1972 | 0.492 | 0.492 | 0.494 | +0.0020 [+0.0001, +0.0038] | +0.002 [-0.020, +0.023] |
| finish 5R | 243 | 0.535 | 0.522 | 0.521 | -0.0016 [-0.0060, +0.0027] | -0.014 [-0.079, +0.051] |
| KO/TKO | 1972 | 0.317 | 0.324 | 0.326 | +0.0026 [+0.0005, +0.0046] | +0.009 [-0.009, +0.028] |
| SUB | 1972 | 0.175 | 0.168 | 0.168 | -0.0006 [-0.0010, -0.0002] | -0.007 [-0.024, +0.010] |
| R1 finish | 1972 | 0.235 | 0.238 | 0.240 | +0.0017 [+0.0004, +0.0031] | +0.005 [-0.015, +0.024] |
| R1 finish 5R | 243 | 0.173 | 0.145 | 0.143 | -0.0018 [-0.0042, +0.0008] | -0.030 [-0.076, +0.018] |
| draw | 1972 | 0.010 | 0.002 | 0.002 | +0.0000 [-0.0001, +0.0001] | -0.008 [-0.012, -0.004] |
| KD per fight | 1999 | 0.445 | 0.464 | 0.466 | +0.0019 [-0.0024, +0.0060] | +0.021 [-0.008, +0.049] |
| KD per fight 3R | 1752 | 0.430 | 0.465 | 0.469 | +0.0036 [-0.0009, +0.0080] | +0.038 [+0.007, +0.068] |
| KD per fight 5R | 247 | 0.547 | 0.458 | 0.448 | **-0.0105 [-0.0193, -0.0014]** | -0.099 [-0.191, -0.016] |
| sig landed per fight | 1999 | 92.00 | 93.58 | 93.35 | -0.234 [-0.489, +0.026] | +1.35 [-1.79, +4.34] |
| minutes per fight | 1999 | 11.28 | 11.37 | 11.35 | -0.025 [-0.050, -0.001] | +0.064 [-0.209, +0.323] |

**KD observed / expected by defender band**, off -> on:

| Band | Result |
|---|---|
| age < 27 | 0.91 -> 0.98 |
| 27-30 | 0.84 -> 0.88 |
| 30-33 | 1.04 -> 1.03 |
| 33-36 | 0.96 -> 0.91 |
| 36+ | 1.02 -> 0.98 |
| KO losses 0 / 1 / 2+ | 0.93 / 1.00 / 0.98 -> 0.95 / 0.98 / 0.94 |
| all | 0.96 -> 0.95 |

The age spread narrows from 0.84-1.04 to 0.88-1.03.

**By year and by schedule** (on - off):

- Winner log loss by year: 2019 -0.0008; 2020 -0.0030; 2021 +0.0030 [-0.0013, +0.0071]; 2022 -0.0042 [-0.0080, -0.0005];
  2023 -0.0022.
- Soft CE improves in every year but 2021 (+0.0004 [-0.0007, +0.0014]).
- 3-round fights (n 1729):
  - soft CE -0.0009 [-0.0015, -0.0003];
  - 7-bin -0.0060 [-0.0129, +0.0004];
  - round -0.0033 [-0.0065, -0.0002].
- 5-round fights (n 243):
  - soft CE -0.0020 [-0.0037, -0.0003];
  - 7-bin -0.0164 [-0.0323, -0.0007];
  - method -0.0123 [-0.0256, -0.0002];
  - round -0.0103 [-0.0225, +0.0019].
- So the 5-round outcome scores improve even though 5-round knockdowns move further below the actual rate.

### What the third pass checked (all code-only or 2019-2023; nothing scored on 2024+, no 2026 row read)

| Check | Result |
|---|---|
| Flag off = frozen v4.0.0 | New checker: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur3/offchk3.js`. It compares `versions/v4/engine3.js` (its own params and mlrates) against main + `durability_v4main.patch`, with the flag off two ways: `opts.params` and the module's params object. **300 cases, 3,000 comparisons, 0 differences.** Each case compares the full matchup object (every field, `p` minus the two new keys), 2 traced fights, a 150-fight summary and `explain()`. The cases: 162 roster pairs (14 divisions, ML model on/off, knobs, as-of priors, four dates), 95 train backtest snapshots (OOF rates, as-of priors, `opts.dur` passed and ignored), 43 manual profiles. The flag on changed `kd` in 300 of 300. |
| Code review of `applyDurability` and the wrapper | Correct as written. `m.kd`, `gnp`, `stko` and `dw` are read only by `simulate()`, so rewriting them after `matchupML` leaves nothing stale. Knobs enter with total exponent 1 (`cp` and `fac` each carry them). The record base skips `ctx` (it already holds it). `kd > 1` cannot crash: it is used as `rng.u() < pk`. |
| Equations and values | `params.durability.terms` equals `durability.json` `engine.terms_live` key for key, 24 of 24. The same holds for `level`, `normChin`, `normPow` and the alphas. The equations match `research/model_durability.md` section 9 (exponents 1, no layoff, last-fight, tenure or size terms). `test_durability.js` reproduces section 8's 0.59 / 1.04 per 100 strikes. |
| Leakage in the records (code audit of `tools/durability.py`) | **Clean.** `trailing_level` uses days strictly before the fight day. `side_features` is computed before the fight is applied to the state. `eb_walk` predicts both directions of a fight before either updates. `backtest_multipliers` refits through Y-1 for each train year (2008-2023 for 2024+). |
| Corner symmetry | Same-division live pairs: 600 with the roster, 600 without; swap error 6.7e-16 in log. Fuzz: the on-asymmetry maximum is 0.125, against 0.499 for v4 itself (cross-division / cross-gender inputs); no matchup is less symmetric with the flag on. |
| NaN / loops (fuzz) | New fuzz: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur3/fuzz3.js`. 500 pairs x {3, 5 rounds}, 14 divisions; ML on/off, roster on/off, knobs 0.2-3.2, damaged profiles, and random `params.durability` overrides (relative mode, w 0/0.25/0.9/1, exponents, size, caution5, withdrawn terms, no fallbackEB, 365-day level). **0 throws; 2,000 traced fights all ended; 334 director scripts built with no NaN; `summarize` / `explain` with no NaN or undefined.** Slowest fight 217 ms at load 26. `kd >= 1` came up only for my synthetic extreme record (power multiplier 5e4), never for real or merely damaged profiles. |
| Live knockdown level | Same-division roster pairs at 2026-11-06, flag on / off: computed fallback median x1.24 (p05 0.92, p95 1.71), max kd 0.068 (off 0.060). With the roster: median x1.33 (p05 0.98, p95 1.83), max 0.079. See risk 1 below. |
| Tests (main + patch, main data) | `test_engine3.js` 69/69, `test_director3.js` OK, `test_mlrates.js` 47/47, `test_durability.js` 34/34 (flag-off reference resolved to `versions/v4`). Unpatched main copy: 69/69, OK, 47/47. |
| Speed (`summarize` 20,000 five-round VG fights with ML; CPU s; load 26; 3 alternating runs) | v4 2.68 / 2.69 / 2.33; flag off 2.80 / 2.63 / 2.43; flag on 2.36 / 2.23 / 2.05 (more early finishes). `matchup()` 4.9-6.6 ms in every mode. **No regression.** |
| Interaction with other components' patches | `styles_sos` wraps the internal `matchup()` and multiplies `m.kd` / `gnp` / `stko` after it, so it composes multiplicatively on top of durability. If v5 is assembled the other way round (a multiplier applied before `applyDurability`), durability would keep only `engRel^0.5` of it. `dynamics` changes the in-fight KD modifiers (`kdP`), not `m.kd`. No other component patch sets `opts.params` in `evalv.js`. |

### Risks the third pass adds

1. **Live level is well above the train level.**
   - Live LW base: 0.010274 x exp(0.07774) = 0.0111 per standing head strike. The train records' LW 3-round base
     averages 0.0079 (0.0070-0.0087 by year), so live is about x1.4.
   - Hence the live x1.24-1.33 on kd over v4.
   - About x1.07 of it is the live-fit constant (2008-2026, +0.078 vs +0.010 pre-2024). The v5 validation run does not
     test that part, because its records use the 2008-2023 fit. The validation run does test the tracked L730(t)
     level.
   - Both are labeled knobs: `durability.level` and `terms.const`.
2. **Five-round knockdowns.**
   - The record base carries the five/title terms (x0.895 / x0.908) on top of the engine's `caution5` / `r1Caution5`,
     a double count. 5-round knockdowns per fight fall from 0.458 to 0.448, against 0.547 actual. 5-round R1 finishes
     run 0.143 against 0.173.
   - The 5-round outcome scores still improve. Refit it jointly with dynamics, as the earlier passes said.
3. **`prof.dur` has no date guard; only the roster does.**
   - After the `fighters.json` rebuild, a tool that runs past fights on live profiles would get live-fit fighter
     effects. Such a tool already leaks through the live career sums, so this adds no new class of leak.
   - Backtests must keep using `backtest.json` snapshot sides plus `opts.dur`.
4. **Assembly order with other kd multipliers.** Apply `applyDurability` first, directly after `matchupML`. Any other
   component's kd / gnp / stko multiplier goes on top of it. The current `styles_sos` patch already does this.

---

# Second verifier's report (7:00-7:35 pm UTC; superseded where the third pass above differs)

## Second verifier's verdict (7:35 pm UTC): include in v5 (include = true)

**Include it: flag on, `engineWeight` 0.5, absolute level, `kdCal` 1.1639618.** This is unchanged from the first
verifier. Apply it with the rebuilt `durability_v4main.patch`.

**What changed since the first pass.** At 7:15 pm main dropped v4.0.1:

- v4.0.1 was validated and rejected (`versions/v4.0.1-rejected/`).
- Main's `src/` went back to the frozen `versions/v4` (engine 4.0.0). So **the v5 base is v4.0.0.**
- The first verifier's `durability_v4main.patch` targeted the in-flight v4.0.1. On today's main its engine API hunk
  rejects. On v4.0.1 it applied but left main's `tests/test_engine3.js` failing one check (below).
- The rebuilt patch targets main as it is now and applies with no fuzz.
- `kdCal` 1.164 was matched to v4.0.0 (`kdScale` 1.391), so it stays.

**Condition for the v5 measurement (unchanged).** `tools/evalv.js` must pass the walk-forward durability records.
The wiring is in the patch; I re-read it. If evalv does not pass them, the validation run takes the computed fallback
on live-fit terms (2008..2026-10).

### Fresh-seed train ablation on the v5 base (v4.0.0 + component)

**Setup**

- Fights: 2019-01-01..2023-12-31, 1,999 backtest_dev fights in 211 events.
- Both corner orders, 200 sims per order (400 per fight).
- Common random numbers with a new seed scheme: `h32("dur-v2|id|order|s")`.
- Learned rates: OOF (`mlrates_oof.json`). Priors: `mlcal_priors_asof[year]`.
- Durability: walk-forward records (`fit_through` before the fight's year, asserted), plus the train-only NORM.
- No roster loaded.
- Code: new harness `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur2/abl2.js` and
  scorer `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur2/score2.py`. They share
  no code with the builder's or the first verifier's.
- Scoring: both orders pooled in the real A/B frame, additive smoothing 0.5 per category.
- CIs: paired event-cluster bootstrap, 2,000 resamples.
- CPU: 36 s per worker, 3 workers at nice 5.

| Metric | n | off (v4.0.0) | on | on - off [95% CI] | 1st verifier, same base |
|---|---|---|---|---|---|
| Winner log loss | 1952 | 0.6654 | 0.6654 | -0.0001 [-0.0022, +0.0020] | -0.0012 [-0.0035, +0.0010] |
| Brier | 1952 | 0.2364 | 0.2364 | -0.0000 [-0.0011, +0.0010] | -0.0006 [-0.0016, +0.0005] |
| **Soft-label CE vs closing line** | 1999 | 0.6717 | 0.6709 | **-0.0008 [-0.0014, -0.0002]** | -0.0008 [-0.0015, -0.0001] |
| **7-bin log loss** | 1972 | 1.6642 | 1.6575 | **-0.0068 [-0.0131, -0.0009]** | -0.0072 [-0.0129, -0.0014] |
| **Method log loss** | 1972 | 0.9703 | 0.9667 | **-0.0036 [-0.0070, -0.0002]** | -0.0040 [-0.0078, -0.0001] |
| Round log loss | 1972 | 1.2033 | 1.1997 | -0.0036 [-0.0070, +0.0001] | -0.0022 [-0.0059, +0.0018] |
| **Stat dev: sig landed** | 1999 | 23.725 | 23.566 | **-0.158 [-0.286, -0.038]** | -0.133 [-0.259, -0.010] |
| **Stat dev: sig attempted** | 1999 | 49.413 | 49.114 | **-0.299 [-0.563, -0.050]** | -0.248 [-0.513, +0.007] |
| **Stat dev: head landed** | 1999 | 17.796 | 17.683 | **-0.112 [-0.199, -0.031]** | -0.085 [-0.175, -0.003] |
| Stat dev: knockdowns | 1999 | 0.7168 | 0.7145 | -0.0023 [-0.0077, +0.0034] | -0.0039 [-0.0094, +0.0017] |
| Stat dev: TD landed | 1999 | 1.7460 | 1.7421 | -0.0038 [-0.0079, +0.0002] | -0.0045 [-0.0087, -0.0005] |
| Stat dev: TD attempts | 1999 | 3.2324 | 3.2275 | -0.0049 [-0.0133, +0.0041] | -0.0055 [-0.0141, +0.0033] |
| Stat dev: sub attempts | 1999 | 0.8974 | 0.8975 | +0.0001 [-0.0024, +0.0026] | +0.0006 [-0.0024, +0.0036] |
| Stat dev: control (min) | 1999 | 2.6107 | 2.6102 | -0.0005 [-0.0066, +0.0056] | -0.0025 [-0.0093, +0.0045] |

References on the same fights: closing line winner log loss 0.6232; closing-line entropy, the floor for the soft CE,
0.6268.

**Base rates** (actual / off / on; on - off [95% CI]):

| Base rate | n | actual | off | on | on - off | on - actual |
|---|---|---|---|---|---|---|
| finish | 1972 | 0.492 | 0.493 | 0.495 | +0.0020 [+0.0000, +0.0041] | +0.003 [-0.019, +0.026] |
| finish 5R | 243 | 0.535 | 0.527 | 0.523 | -0.0036 [-0.0083, +0.0013] | -0.012 [-0.075, +0.052] |
| KO/TKO | 1972 | 0.317 | 0.324 | 0.327 | +0.0028 [+0.0006, +0.0051] | +0.009 [-0.010, +0.029] |
| KO/TKO 5R | 243 | 0.395 | 0.387 | 0.384 | -0.0028 [-0.0078, +0.0025] | -0.011 [-0.074, +0.052] |
| SUB | 1972 | 0.175 | 0.169 | 0.168 | -0.0008 [-0.0012, -0.0004] | -0.007 [-0.025, +0.010] |
| R1 finish | 1972 | 0.235 | 0.239 | 0.241 | +0.0018 [+0.0004, +0.0032] | +0.006 [-0.013, +0.025] |
| draw | 1972 | 0.010 | 0.002 | 0.002 | -0.0000 [-0.0001, +0.0001] | -0.008 [-0.012, -0.004] |
| KD per fight | 1999 | 0.445 | 0.463 | 0.464 | +0.0019 [-0.0026, +0.0065] | +0.020 [-0.010, +0.049] |
| KD per fight 3R | 1752 | 0.430 | 0.463 | 0.467 | +0.0043 [-0.0005, +0.0092] | +0.037 [+0.006, +0.067] |
| KD per fight 5R | 247 | 0.547 | 0.460 | 0.445 | **-0.0152 [-0.0228, -0.0072]** | -0.102 [-0.193, -0.015] |
| sig landed per fight | 1999 | 92.00 | 93.31 | 93.09 | -0.219 [-0.492, +0.054] | +1.09 [-2.10, +3.96] |
| minutes per fight | 1999 | 11.28 | 11.36 | 11.33 | -0.025 [-0.051, +0.000] | +0.047 [-0.225, +0.290] |

- `kdCal` stays level-matched: knockdowns per fight +0.0019 [-0.0026, +0.0065].
- The draw shortfall is the base engine's; it is identical off and on.

**KD observed / expected by defender band**, off -> on (the ROADMAP v5 check):

| Band | sides | KD | off | on |
|---|---|---|---|---|
| age < 27 | 496 | 85 | 0.91 | 0.98 |
| age 27-30 | 980 | 186 | 0.85 | 0.88 |
| age 30-33 | 1130 | 271 | 1.04 | 1.03 |
| age 33-36 | 845 | 192 | 0.96 | 0.91 |
| age 36+ | 547 | 155 | 1.04 | 0.99 |
| KO losses 0 / 1 / 2+ | 2197 / 1033 / 768 | 413 / 256 / 220 | 0.93 / 1.00 / 0.98 | 0.95 / 0.99 / 0.94 |
| all | 3998 | 889 | 0.96 | 0.96 |

The age spread narrows from 0.85-1.04 to 0.88-1.03. The 33-36 band dips, as in both earlier runs; it is within its CI.

**By year** (on - off):

| Year | Winner log loss | Soft CE | 7-bin | Method |
|---|---|---|---|---|
| 2019 | -0.0024 | -0.0013 | -0.0110 | -0.0075 |
| 2020 | +0.0006 | +0.0002 | -0.0058 | -0.0029 |
| 2021 | **+0.0040** | +0.0003 | +0.0025 | -0.0025 |
| 2022 | -0.0007 | -0.0019 | -0.0054 | -0.0035 |
| 2023 | -0.0020 | -0.0014 | -0.0147 | -0.0018 |

- 2021 is the one year where winner log loss is worse in all four runs (+0.0031, +0.0052, +0.0007, +0.0040). It is
  not significant in any of them. Worth a look in the v5 write-up; not a reason to exclude.

**3-round vs 5-round fights** (on - off):

| Metric | 3R (n 1729) | 5R (n 243) |
|---|---|---|
| Winner log loss | -0.0003 [-0.0025, +0.0018] | +0.0017 [-0.0047, +0.0084] |
| 7-bin | -0.0059 [-0.0121, +0.0002] | -0.0134 [-0.0317, +0.0036] |
| Method | -0.0029 [-0.0065, +0.0006] | -0.0089 [-0.0204, +0.0028] |
| Round | -0.0015 [-0.0048, +0.0022] | **-0.0184 [-0.0328, -0.0039]** |
| KD deviance | -0.0037 [-0.0091, +0.0017] | +0.0079 [-0.0116, +0.0305] |

The component lowers 5-round knockdowns further from the actual rate, but the 5-round outcome scores still improve.
So I left `durability.caution5` and the five/title terms alone. That remains a joint refit with the dynamics component.

**Robustness run on the rejected v4.0.1** (same harness, 400 sims per fight): soft CE -0.0009 [-0.0015, -0.0003],
method -0.0035 [-0.0070, -0.0001], round -0.0038 [-0.0074, -0.0004], 7-bin -0.0054 [-0.0112, +0.0003], winner
+0.0002 [-0.0020, +0.0025]; knockdowns per fight +0.0016 [-0.0029, +0.0062]. The component's effect does not depend
on the v4.0.1 level changes.

### What the second pass checked

All work used 2019-2023 fights or code only. No 2024+ fight was simulated or scored, and no 2026 fight was read:
main's `backtest_dev.json` holds no 2026 rows, and the 2024-2025 rows were filtered out before use.

| Check | Result |
|---|---|
| Deliverables match the branch | `durability.patch` was exactly `git diff 853ce32..e5a8581`. Commit `9d4943e` is exactly the builder's original patch. |
| Flag off = engine before the change | My own checker, `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur2/offfuzz.js`, with a new case mix and seeds. It does not use a global FightParams, so each engine copy loads its own params. Each case compares the matchup table, 2 traced fights, a 300-fight summary and `explain()`, with the flag turned off two ways (`opts.params` and the module's params object). Cases mix roster pairs (knobs, learned rates on/off, three dates, 14 divisions), train backtest inputs (OOF rates, as-of priors, records) and manual profiles. **v4.0.1 + patch vs `versions/v4.0.1`: 0 differences in 3,000 comparisons. v4.0.0 + patch vs `versions/v4`: 0 differences in 3,000 comparisons.** The flag on changed `kd` in every case. |
| Equations and values | **All 22 terms**, `level`, the 365-day scenario, NORM (live and backtest) and the alphas equal `durability.json` `engine` exactly. Section 9 and V4/V6 of `research/model_durability.md` match the code term for term (exponents 1, no layoff / last-fight / tenure / size terms). The knobs enter with total exponent 1 in kd, gnp/stko and damage: v4's `fac.pow` / `fac.chin` and its learned kd target already include them. |
| Leakage | **Clean on the ablated path.** All 1,999 train fights have a record fit through an earlier year; the base is recomputed from the record. The live roster is date-guarded. In `build_db.py`, the recency fields come from the pre-fight state, and `dur` goes only into live profiles. `evalv.js` wiring was re-read: corner order, train NORM, it throws on a missing record, and it sets `opts.params` nowhere else. **One protocol note:** `research/model_durability.md` already reported 2024+ held-out results for this model family (section 2, V4's test column, V7). Its design choices were made on 2019-2023, but the v5 measurement is not this model's first contact with 2024-2025. |
| Corner symmetry | With the flag on, no matchup is less symmetric than with it off (400 roster pairs, both flags). The single asymmetric case, a man vs a woman at Open Weight, comes from v4 itself (0.59 in log off). The component halves it (0.30), since the engine structure enters with weight 0.5. |
| NaN / loops (fuzz) | 500 random pairs x {3, 5 rounds}, 14 divisions, with the roster toggled, random knobs, damaged profiles and random `params.durability` overrides. **v4.0.1 + patch:** 0 non-finite or out-of-range values, 0 throws, 2,000 traced fights all ending properly, 334 director scripts built, slowest fight 262 ms, max kd 0.111 per strike (40-KO-loss profile). Clean pairs: kd on/off median x1.23, p95 1.89. **v4.0.0 + patch:** the same, clean: 0 bad values, 0 throws, 2,000 traced fights, 334 director scripts, slowest fight 92 ms, the same corner-swap maximum (v4's own Open Weight case; no matchup less symmetric with the flag on, 400 pairs). |
| Tests | **Worktree:** `test_durability.js` 34/34, `test_engine3.js` 42/42, `test_director3.js` OK, `test_mlrates.js` 47/47. **v4.0.0 + patch, main data:** `test_engine3.js` 69/69 (it fails 1 check without fix 2 below), `test_director3.js` OK, `test_mlrates.js` 47/47, `test_durability.js` 34/34 against `versions/v4`. |
| Speed (summarize 20,000 five-round VG fights, CPU, load 18-19) | v4.0.1 2.48 / 2.38 s; component flag off 2.33 / 1.75 s; flag on 2.45 / 1.82 s. A warm `matchup()` is about 5 ms either way. **No regression.** |

### Bugs found and fixed in this pass

Both are test and patch-assembly bugs. Neither touches the engine or the train numbers.

1. **`tests/test_durability.js` compared against the wrong engine after a merge.**
   - Before: section 1 always read its reference from git `275b339`, the builder's in-flight base, when git could
     reach it. In the main checkout it can, so after merging the test would compare against the wrong engine and fail
     6 checks. The first verifier's `--write-golden` refresh did not help, because git takes priority over the
     golden fixture.
   - Now the lookup order is:
     1. `DUR_BASE_FILE`;
     2. `DUR_BASE_REV`;
     3. the frozen folder of the engine version in `src/`: `versions/v<VERSION>/`, or `versions/v<major>/` for X.0.0
        (the component does not bump VERSION, so on main that is `versions/v4`);
     4. git `275b339`;
     5. the golden fixture.
   - Commit `6d857ca`. On v4.0.0 + patch it resolves to `versions/v4` and passes 34/34. In this worktree it still
     resolves to `275b339`.
   - The golden fixture in the main patch is regenerated against `versions/v4`.
2. **Main's `tests/test_engine3.js` check "matchup without a model equals matchupBase" fails with the flag on.** That
   is by design: with the component on, `matchup()` also rewrites kd. The kd part of the check now runs with the
   component off; the base-table parts still run with it on. The fix is in `durability_v4main.patch`. The worktree's
   older `test_engine3.js` has no such check.
3. **`durability_v4main.patch` rebuilt against main as of 7:25 pm UTC (v4.0.0).**
   - The 4:37 pm version no longer applies there: the engine API hunk rejects.
   - The new one is built in one pass by `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur2/make_v4main3.sh`. It applies with no fuzz and reproduces the target tree exactly. Main did not change during the build.
   - Snapshot md5s are in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur2/v4m_snapshot_md5.txt`.
   - Main is still being edited (`docs/ENGINE_V3_SPEC.md` changed at 7:21 pm). If the patch stops applying, rerun
     that script.

### Patches now (all in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/`)

| File | What | Base |
|---|---|---|
| **`durability_v4main.patch`** (use this) | The whole verified component for today's main: 12 files. Engine, params, `build_db.py`, the evalv wiring, docs, both test fixes, the golden fixture against `versions/v4`, the new test, and the ablation tools. | Main checkout files at 2026-11-06T19:25Z, engine v4.0.0 (= `versions/v4`). md5: engine3.js `31a2f942...`, params3.js `c239b4fc...`, mlrates.js `25f44af8...`, test_engine3.js `d14b4ab6...`, ENGINE_V3_SPEC.md `41e2f420...`, evalv.js `50bc1add...`, build_db.py `d1dd2425...` |
| `durability.patch` | The requested deliverable: `git diff 853ce32a40216ecdc9ac8daa35de006932ae6665 6d857ca` (the `verify/durability` HEAD). It includes the builder's in-flight v4 sync. | Worktree start commit `853ce32a40216ecdc9ac8daa35de006932ae6665` |
| `durability_component_only.patch` | `275b339..6d857ca`: the component and all verifier fixes, without the base sync. | `275b339` |
| `durability_evalv_v4main.patch` | The evalv wiring alone (unchanged; main's evalv.js is unchanged). | Main `tools/evalv.js` |
| `durability_v4main_rejects.patch` | Superseded by `durability_v4main.patch`; kept for the record. | |

The previous versions of the rebuilt files are kept as `*.pass1` in the same folder.

**After merging:** rebuild `fighters.json` (`tools/build_db.py`) so live profiles carry `dur`. The golden refresh is
no longer needed.

### Risks the second pass adds

- **Main moved under every component today.** The v5 base is v4.0.0, not v4.0.1. Any other component verified
  against v4.0.1 needs the same re-check. For durability it is done: the effect is the same on both bases, and
  `kdCal` is matched to v4.0.0.
- **2024+ is not pristine for this model family.** The durability research already reported 2024+ held-out results
  (section 2; the 2024+ chin calibration slope 1.32 in V7). The v5 validation number for the engine is still a fair
  single look for the engine, but it is not a blind test of the durability model's design.
- **The winner gain is nil on the v5 base:** -0.0001 [-0.0022, +0.0020]. Include it for the method, round, 7-bin,
  stat-line and soft-CE gains, all small; the blend still decides the winner.

---

# First verifier's report (3:40-4:41 pm UTC; superseded where the section above differs: base engine, patch files, tests)

## First verifier's verdict: include in v5 (include = true)

**Include it, flag on, `engineWeight` 0.5, absolute level, with `kdCal` 1.1640 (re-matched to the frozen v4).**

Condition for the v5 measurement: `tools/evalv.js` must pass the walk-forward durability records. It does not do
that today. `durability_evalv_v4main.patch` does it; it is also folded into `durability_v4main.patch`. Without it:

- the validation run would go through a different code path from the one ablated on train;
- that path uses coefficients fit through Oct 2026, which include 2024-2025 and the vault.

### Why include

- **Flag off is the engine before the change, bit for bit.** This holds in all three contexts:
  - the builder's base (in-flight v4 sync `275b339`);
  - frozen `versions/v4`;
  - the main checkout as of 16:37 UTC (in-flight v4.0.1).
- **Fresh-seed results on v4 final, with my own harness and scorer (2019-2023, 1,999 fights), all paired event-cluster
  bootstrap 95% CIs:**

  | Metric | on - off [95% CI] | Significant |
  |---|---|---|
  | Soft-label CE vs closing line | -0.0008 [-0.0015, -0.0001] | yes |
  | 7-bin log loss | -0.0072 [-0.0129, -0.0014] | yes |
  | Method log loss | -0.0040 [-0.0078, -0.0001] | yes |
  | Sig-landed deviance | -0.133 [-0.259, -0.010] | yes |
  | Head-landed deviance | -0.085 [-0.175, -0.003] | yes |
  | Winner log loss | -0.0012 [-0.0035, +0.0010] | no |

- Base rates stay put, now that `kdCal` is level-matched.
- KD calibration by defender age band gets flatter: the O/E spread goes from 0.84-1.04 to 0.87-1.02. That is the
  ROADMAP's v5 check.
- **The gain is about how and when fights end, not who wins.** That is the simulator's job in the current
  architecture (BACKLOG: the blend decides the winner).
- **Caveat:** the gains are small. `engineWeight` and `kdCal` were set on these same train years, so treat the train
  numbers as slightly optimistic. The single 2024-2025 measurement decides.

### What I checked

All checks ran on 2019-2023 or on code only. Nothing was evaluated on 2024+, and no 2026 fight was read. For 2024-2025
I read only fight ids, dates and the records' `fit_through`, to check record coverage.

| Check | Result |
|---|---|
| Base commit `853ce32` | Its engine does not load (`ReferenceError: matchup is not defined`), as the builder said. The effective pre-change engine is the v4 sync `275b339`. The builder's component commit `bc8e562` has exactly the tree I got by applying the patch to `853ce32` (`git diff bc8e562 9d4943e` is empty). |
| Flag off = engine before the change | **0 differences.** Own checker (`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/check_off.js`): random cases x 2 ways of turning the flag off (`opts.params` and the global params object), comparing matchup tables (every field), 2 traced fights per case and Monte Carlo summaries as exact JSON. The cases mix roster pairs, plain tables, the learned-rate model, OOF backtest snapshots with as-of priors, knobs, 3 and 5 rounds and all divisions. 600 comparisons against `275b339`, 600 against `versions/v4` + component, and 300 against main (16:37) + `durability_v4main.patch`. The flag on changed 40 of 40 sampled tables each time. |
| Equations and values vs research/model_durability.md sections 3 and 9, and `durability.json` `engine` | **All match.** Terms: const 0.07774; the division terms; five -0.11143; title -0.09636; defender age 0.06177 / hinge -0.0016; age unknown 0.79895; prior KDs -0.14251 / -0.08; KO losses 0.18908 / 0.0749; attacker age -0.00445 / -0.03589. Values: level 0.010274 (365-day scenario 0.011706), alphas 3 / 2.5, NORM live 0.9972 x 0.9752 and backtest 0.9882 x 1.0183. Volkanovski-Gaethje by hand from cov x re: 0.010274 x exp(0.07774 - 0.11143) x C x P gives 0.588 / 1.044 per 100 (research 0.588 / 1.044). Exponents 1, size 0 and the withdrawn terms neutral all follow the revised research (V4, V6). The knobs enter with total exponent 1: they are in both the durability term and `engRel`. |
| Leakage, train ablation path | **Clean.** 1,999 of 1,999 train fights have a record with `fit_through` = Y-1 and OOF `cv<year>` rates. Priors are `mlcal_priors_asof[year]` and NORM is the backtest value. The record base, p / (C x P), agrees between the two directions to 7e-4 in log. The live `terms`, `level` and roster are never used on this path. `build_db.py`'s new recency fields use strictly earlier fights. `dur` goes only into live profiles, not into backtest sides. The train labels in `market.json` are identical in the worktree and main copies (the worktree copy also still holds 2026 rows, which no scorer reads). |
| Leakage, other paths | **Two found.** (1) **`tools/evalv.js` passes no `opts.dur`.** The v5 validation run would use the computed fallback: live-fit terms (2008..2026-10) and the Oct 2026 level for every fight. All 865 validation fights have strict records (`fit_through` 2023-12-31). Wired in `durability_evalv_v4main.patch`. (2) **The live roster via `loadDurability`** would hand any backtest tool fighter effects fit on the fight's own outcome. Fixed in the engine with a date guard (below). |
| Corner symmetry | Swapping corners swaps kd, gnp, stko and dw exactly, to 8.9e-16 in log, over 1,400 fuzz matchups. All my scoring is symmetric (both orders, no intercepts). |
| NaN / infinite loops | Fuzz (`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/fuzz.js`): 500 random roster pairs x {3, 5 rounds} over 14 divisions (incl. Catch and Open Weight). Inputs vary at random: learned-rate model on/off, roster on/off, knobs 0.2-3.2, damaged profiles (no age, 40 KO losses, no stats, recency counts above career), zero or partial `opts.dur`, and random `params.durability` overrides (relative mode, exponents, size, caution5, withdrawn terms). Result: **no non-finite value, no throw, no stuck fight.** Slowest fight 416 ms on the loaded machine; 2,000 traced fights and 200 director scripts per run, on both contexts. Clean live pairs: kd on/off median x1.23 (p05 0.79, p95 1.92); the highest hazard was 0.078 per strike for heavy-hitter vs fragile-chin pairs. |
| Trace / director | `simulate()` is untouched and the trace keys are unchanged. `tests/test_director3.js` passes with the flag on, on the worktree and on v4 final + component (`ENGINE_DIR`). |
| Tests (worktree, final) | `test_durability.js` 34/34 (31 + 3 new). `test_engine3.js` 42/42. `test_director3.js` OK. `test_mlrates.js` 47/47. |
| Speed (CPU time; load average ~45 on 4 cores) | `summarize` of 20,000 five-round fights (Volkanovski-Gaethje, learned rates, roster): v4 final 2.75 / 2.78 s; component flag off 2.83 / 2.92 s; flag on 2.85 / 2.38 s. That is 0.12-0.15 ms per fight in every case. `matchup()`: 3.4-3.9 ms either way. **No regression** (differences are within run-to-run noise). |

### Fixes I made

All fixes are on flag-on paths only; flag off is still bit-identical. They are commits `68255ac` and `e5a8581` on
`verify/durability`.

1. **Roster leak guard** (`src/engine3.js`, `loadDurability` / `durSide`).
   - Before: the live roster (`durability.json` roster, fit through Oct 31, 2026) was used for any profile with a
     slug, whatever the fight date.
   - Now: `loadDurability` keeps `meta.snapshot`, and the roster applies only when `m.date >= snapshot`.
   - Earlier fights must bring `opts.dur`. Without it they take the computed path and `m.dur.*.src` reads
     "computed".
   - Live use (the snapshot date or later) is unchanged.
2. **Manual profiles without an age** (`durCovariates`).
   - Before: `manualProfile()` fighters got the data's "age unknown" term: chin x2.22, which is x1.49 on the hazard
     after the 0.5 blend. In the data that term describes obscure short-stint fighters.
   - Now: a hand-made fighter sits at the reference age. Data profiles without a date of birth (8 roster fighters, 0
     train sides) keep the term.
3. **`kdCal` re-matched to the frozen v4: 1.18780096 -> 1.1639618** (`src/params3.js`).
   - The builder matched `kdCal` to the in-flight engine (`kdScale` 1.246). v4 final has `kdScale` 1.391, and
     `kdCal` multiplies it.
   - With the builder's value, knockdowns per fight rose +0.0095 [+0.0049, +0.0141] over v4 final, from 0.465 to
     0.474 against 0.445 actual. KO/TKO rose +0.0056 [+0.0034, +0.0079].
   - Rule used: the builder's own, kdCal x KD_off / KD_on, on train. With 1.164: +0.0024 [-0.0021, +0.0071] and
     +0.0025 respectively. The scores are unchanged or slightly better (table B).
   - The static on/off ratio is 0.989 on v4.0.0 and on main's in-flight v4.0.1 (`kdScale` 1.386), so the value
     carries over.
   - On the old in-flight base this value runs about 2% below its matched level. That base is superseded.
4. **`tests/test_durability.js`:** 3 new checks for fixes 1 and 2 (34 total).
5. **`docs/ENGINE_V3_SPEC.md`:** documents the roster and manual-age rules, and that backtests and evalv must pass
   records plus the train-only NORM.
6. **`tools/evalv.js` wiring** (new, `durability_evalv_v4main.patch`, against main's current evalv.js). With the flag
   on, each worker:
   - reads `durability.json` `backtest[id]`;
   - passes `opts.dur = { A, B, base }` in the simulation's corner order, with base the geometric mean of
     `p_A / (C_B P_A)` and `p_B / (C_A P_B)`;
   - passes the train-only NORM (`norm_*_backtest_2019_2023`) through `opts.params`;
   - throws on a missing record or an unapplied base rather than falling back to the live fit.

   Smoke-tested on the **train split only** (`--dev`, 1 sim per order, scratch tree, outputs in the scratchpad):
   1,999 of 1,999 fights, no failures, on v4 final and on main's v4.0.1. Engines without the flag (v3, v4) are
   unaffected.

None of fixes 1, 2, 4 and 5 changes a train-ablation number: the ablation passes records, loads no roster, has no
manual profiles, and every train side has an age.

### Patches (all in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/`)

| File | What | Base |
|---|---|---|
| **`durability_v4main.patch`** (recommended) | The whole verified component, self-contained: 12 files, including the evalv wiring. Checked to apply to, and reproduce exactly from, one snapshot of main. Flag off is bit-identical there (300 comparisons) and the fuzz is clean. | Main checkout files as of 2026-11-06T16:37:46Z. md5 of that snapshot: engine3.js `798e1f62...`, params3.js `f7a04e5d...`, build_db.py `d1dd2425...`, test_engine3.js `7c061fb6...`, ENGINE_V3_SPEC.md `418703a1...`, evalv.js `50bc1add...` (full list in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/v4main_snapshot_md5.txt`). **Main is still moving (v4.0.1 in flight)**; rebuild with `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/make_v4main.sh` if it no longer applies. |
| `durability.patch` | The requested deliverable: diff of `verify/durability` HEAD `e5a8581` against the worktree start commit `853ce32a40216ecdc9ac8daa35de006932ae6665`. It includes the v4 base sync. | `853ce32` |
| `durability_component_only.patch` | `275b339..e5a8581`: the component plus the verifier fixes, without the base sync. On current main the docs, test_engine3.js and engine API hunks reject; use `durability_v4main.patch` there. | `275b339` |
| `durability_v4main_rejects.patch` | docs + `tests/test_engine3.js` (relative-mode `simAvg`), rebuilt against main's current files. Kept for the builder's apply recipe; `durability_v4main.patch` already contains it. | Main |
| `durability_evalv_v4main.patch` | The evalv wiring alone. | Main `tools/evalv.js` |

The builder's originals are kept as `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/durability_builder_original.*` in the scratchpad.

**After merging:**

- Refresh the flag-off golden: `DUR_BASE_REV=<the pre-patch commit> node tests/test_durability.js --write-golden`.
  Until then section 1 compares against `275b339` and fails for the wrong reason.
- Rebuild `fighters.json` (`tools/build_db.py`) so live profiles carry `dur`.

### Independent train ablation (fresh seeds, my own harness and scorer)

**Setup**

- 2019-01-01..2023-12-31: 1,999 backtest_dev fights in 211 events.
- Both corner orders, 150 sims per order (300 per fight).
- Common random numbers, seed tag `verify-durability-2026-11-06` (different from the builder's).
- Learned rates: OOF. Durability: walk-forward records.
- Harness: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/abl.js`; scorer: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vdur/score.py`. Neither shares code with `tools/durability_ablation*`.
- Probabilities are corner-symmetric, with a Monte Carlo floor of 0.5 / (2 x sims). The "evalv-style" 7-bin adds one
  pseudo-simulation spread over the train outcome shares.
- Soft-label CE is against `market.json` `p_power_close`.
- CIs: paired event-cluster bootstrap, 2,000 resamples.
- CPU: about 32 s per worker per run on 3 workers at nice 5.

**A. The builder's context: in-flight v4 sync `275b339` + the component as delivered (`kdCal` 1.1878).** Replication.

| Metric | n | off | on | on - off [95% CI] | builder's on - off |
|---|---|---|---|---|---|
| Winner log loss | 1952 | 0.6680 | 0.6666 | -0.0014 [-0.0037, +0.0009] | -0.0018 [-0.0037, +0.0004] |
| Brier | 1952 | 0.2375 | 0.2368 | -0.0006 [-0.0017, +0.0004] | -0.0008 [-0.0018, +0.0002] |
| **Soft-label CE vs closing line** | 1999 | 0.6724 | 0.6714 | **-0.0011 [-0.0017, -0.0005]** | -0.0012 [-0.0018, -0.0006] |
| **7-bin log loss** | 1972 | 1.6650 | 1.6542 | **-0.0108 [-0.0165, -0.0051]** | -0.0055 [-0.0098, -0.0011] |
| 7-bin, evalv-style smoothing | 1972 | 1.6688 | 1.6561 | -0.0128 [-0.0213, -0.0056] | |
| **Method log loss** | 1972 | 0.9699 | 0.9654 | **-0.0045 [-0.0080, -0.0008]** | -0.0036 [-0.0072, -0.0002] |
| **Round log loss** | 1972 | 1.2098 | 1.2042 | **-0.0056 [-0.0094, -0.0020]** | -0.0054 [-0.0088, -0.0022] |
| Stat dev: sig landed | 1999 | 23.979 | 23.797 | -0.183 [-0.307, -0.063] | -0.174 [-0.290, -0.065] |
| Stat dev: sig attempted | 1999 | 49.588 | 49.243 | -0.346 [-0.590, -0.099] | -0.314 [-0.553, -0.078] |
| Stat dev: head landed | 1999 | 18.058 | 17.936 | -0.121 [-0.208, -0.036] | -0.113 [-0.194, -0.030] |
| Stat dev: knockdowns | 1999 | 0.7192 | 0.7137 | -0.0055 [-0.0110, -0.0001] | -0.0021 [-0.0076, +0.0036] |
| Stat dev: TD landed | 1999 | 1.7482 | 1.7438 | -0.0044 [-0.0087, -0.0006] | -0.0032 [-0.0071, +0.0003] |
| Stat dev: TD attempts | 1999 | 3.2432 | 3.2364 | -0.0068 [-0.0152, +0.0024] | -0.0077 [-0.0160, +0.0003] |
| Stat dev: sub attempts | 1999 | 0.9017 | 0.9010 | -0.0007 [-0.0034, +0.0019] | -0.0004 [-0.0028, +0.0018] |
| Stat dev: control (min) | 1999 | 2.6156 | 2.6157 | +0.0001 [-0.0061, +0.0063] | -0.0010 [-0.0068, +0.0046] |

- Everything replicates within Monte Carlo noise.
- My 7-bin gain is larger; it depends on the floor and the sims per fight, and the sign is robust.
- By year (on - off), winner log loss:
  - 2019: -0.0010.
  - 2020: -0.0029.
  - **2021: +0.0052 [-0.0003, +0.0103]**, borderline (builder +0.0031).
  - 2022: -0.0038.
  - 2023: -0.0046.
- Soft CE improves in every year except 2021 (+0.0003).
- Base rates (actual / off / on):
  - finish 0.492 / 0.479 / 0.482;
  - KO/TKO 0.317 / 0.318 / 0.321;
  - knockdowns per fight 0.445 / 0.455 / 0.459;
  - knockdowns per fight, 5 rounds: 0.547 / 0.447 / 0.436.
- KD O/E by defender age band:
  - off: 0.92 / 0.86 / 1.05 / 0.97 / 1.06;
  - on: 0.99 / 0.89 / 1.04 / 0.92 / 1.01.

**B. The v5 target: frozen `versions/v4` (= main `src/` at 16:00 UTC) + the component.**

- **Main columns:** the verified component (fixes + `kdCal` 1.164).
- **"run 2" column:** the builder's `kdCal` 1.1878.
- The flag-off baseline is v4 final. Both runs share seeds, so "off" is the same simulation.

| Metric | n | off | on | on - off [95% CI] | run 2 (builder's kdCal): on - off [95% CI] |
|---|---|---|---|---|---|
| Winner log loss | 1952 | 0.6647 | 0.6636 | -0.0012 [-0.0035, +0.0010] | -0.0013 [-0.0035, +0.0010] |
| Brier | 1952 | 0.2360 | 0.2355 | -0.0006 [-0.0016, +0.0005] | -0.0006 [-0.0017, +0.0005] |
| Accuracy | 1952 | 0.6086 | 0.6014 | -0.0072 [-0.0182, +0.0036] | -0.0064 [-0.0170, +0.0041] |
| **Soft-label CE vs closing line** | 1999 | 0.6715 | 0.6707 | **-0.0008 [-0.0015, -0.0001]** | -0.0008 [-0.0015, -0.0002] |
| **7-bin log loss** | 1972 | 1.6672 | 1.6600 | **-0.0072 [-0.0129, -0.0014]** | -0.0066 [-0.0124, -0.0006] |
| 7-bin, evalv-style smoothing | 1972 | 1.6940 | 1.6869 | -0.0071 [-0.0178, +0.0030] | -0.0046 [-0.0137, +0.0050] |
| **Method log loss** | 1972 | 0.9725 | 0.9685 | **-0.0040 [-0.0078, -0.0001]** | -0.0042 [-0.0081, -0.0001] |
| Round log loss | 1972 | 1.2057 | 1.2035 | -0.0022 [-0.0059, +0.0018] | -0.0024 [-0.0062, +0.0016] |
| Stat dev: sig landed | 1999 | 23.785 | 23.652 | -0.133 [-0.259, -0.010] | -0.134 [-0.258, -0.009] |
| Stat dev: sig attempted | 1999 | 49.429 | 49.181 | -0.248 [-0.513, +0.007] | -0.243 [-0.502, +0.014] |
| Stat dev: head landed | 1999 | 17.838 | 17.753 | -0.085 [-0.175, -0.003] | -0.093 [-0.182, -0.008] |
| Stat dev: knockdowns | 1999 | 0.7141 | 0.7102 | -0.0039 [-0.0094, +0.0017] | -0.0032 [-0.0084, +0.0023] |
| Stat dev: TD landed | 1999 | 1.7435 | 1.7390 | -0.0045 [-0.0087, -0.0005] | -0.0041 [-0.0083, -0.0002] |
| Stat dev: TD attempts | 1999 | 3.2374 | 3.2319 | -0.0055 [-0.0141, +0.0033] | -0.0047 [-0.0135, +0.0047] |
| Stat dev: sub attempts | 1999 | 0.9026 | 0.9033 | +0.0006 [-0.0024, +0.0036] | +0.0007 [-0.0023, +0.0038] |
| Stat dev: control (min) | 1999 | 2.6198 | 2.6174 | -0.0025 [-0.0093, +0.0045] | -0.0025 [-0.0095, +0.0046] |

Base rates (simulated vs actual):

| Base rate | n | actual | off | on | on - off [95% CI] | on - actual [95% CI] | run 2: on; on - off [95% CI] |
|---|---|---|---|---|---|---|---|
| finish | 1972 | 0.492 | 0.493 | 0.494 | +0.0018 [-0.0002, +0.0037] | +0.002 [-0.019, +0.024] | 0.497; +0.0045 [+0.0026, +0.0064] |
| finish 3R | 1729 | 0.486 | 0.488 | 0.491 | +0.0023 [+0.0003, +0.0043] | +0.004 [-0.019, +0.028] | 0.493; +0.0050 [+0.0030, +0.0070] |
| finish 5R | 243 | 0.535 | 0.523 | 0.521 | -0.0016 [-0.0064, +0.0033] | -0.014 [-0.077, +0.050] | 0.523; +0.0006 [-0.0041, +0.0056] |
| KO/TKO | 1972 | 0.317 | 0.324 | 0.326 | +0.0025 [+0.0003, +0.0048] | +0.009 [-0.010, +0.028] | 0.329; +0.0056 [+0.0034, +0.0079] |
| KO/TKO 5R | 243 | 0.395 | 0.383 | 0.381 | -0.0018 [-0.0072, +0.0039] | -0.014 [-0.076, +0.049] | 0.383; +0.0007 [-0.0048, +0.0064] |
| SUB | 1972 | 0.175 | 0.169 | 0.168 | -0.0007 [-0.0012, -0.0002] | -0.007 [-0.025, +0.010] | 0.168; -0.0011 [-0.0016, -0.0006] |
| R1 finish | 1972 | 0.235 | 0.239 | 0.240 | +0.0016 [+0.0001, +0.0030] | +0.005 [-0.013, +0.024] | 0.242; +0.0035 [+0.0020, +0.0049] |
| draw | 1972 | 0.010 | 0.002 | 0.002 | +0.0000 [-0.0001, +0.0001] | -0.008 [-0.012, -0.004] | 0.002; -0.0000 |
| knockdowns per fight | 1999 | 0.445 | 0.465 | 0.467 | +0.0024 [-0.0021, +0.0071] | +0.023 [-0.007, +0.051] | 0.474; **+0.0095 [+0.0049, +0.0141]** |
| knockdowns per fight, 3R | 1752 | 0.430 | 0.466 | 0.470 | +0.0046 [-0.0003, +0.0096] | +0.040 [+0.010, +0.070] | 0.477; +0.0117 [+0.0068, +0.0168] |
| knockdowns per fight, 5R | 247 | 0.547 | 0.459 | 0.446 | -0.0127 [-0.0212, -0.0043] | -0.100 [-0.192, -0.013] | 0.453; -0.0062 [-0.0147, +0.0024] |
| sig landed per fight | 1999 | 92.00 | 93.50 | 93.30 | -0.195 [-0.467, +0.070] | +1.30 [-1.85, +4.20] | 92.93; -0.562 [-0.836, -0.299] |

KD observed / expected by defender band (the ROADMAP v5 check: age band and weight move), off -> on (-> run 2):

| Band | sides | KD | off | on | run 2 |
|---|---|---|---|---|---|
| age < 27 | 496 | 85 | 0.90 | 0.97 | 0.96 |
| age 27-30 | 980 | 186 | 0.84 | 0.87 | 0.86 |
| age 30-33 | 1130 | 271 | 1.03 | 1.02 | 1.00 |
| age 33-36 | 845 | 192 | 0.96 | 0.91 | 0.90 |
| age 36+ | 547 | 155 | 1.04 | 0.99 | 0.98 |
| prior KO losses 0 | 2197 | 413 | 0.93 | 0.94 | 0.93 |
| prior KO losses 1 | 1033 | 256 | 0.99 | 0.98 | 0.96 |
| prior KO losses 2+ | 768 | 220 | 0.98 | 0.94 | 0.92 |
| moved up a class | 263 | 48 | 0.80 | 0.82 | 0.81 |
| same class | 3520 | 788 | 0.97 | 0.96 | 0.94 |
| moved down | 209 | 53 | 1.02 | 1.03 | 1.01 |
| all | 3998 | 889 | 0.96 | 0.95 | 0.94 |

- The age bands get flatter: the spread goes from 0.84-1.04 to 0.87-1.02.
- The 33-36 band moves down (0.96 -> 0.91), within its CI.
- The weight-move bands do not change (size knob 0, as the research advises).

By year (on - off): winner log loss / soft CE / 7-bin / method.

| Year | Winner log loss | Soft CE | 7-bin | Method |
|---|---|---|---|---|
| 2019 | -0.0015 | -0.0008 | -0.0135 | -0.0093 |
| 2020 | -0.0020 | -0.0002 | -0.0055 | -0.0062 |
| 2021 | +0.0007 | +0.0004 | -0.0076 | -0.0034 |
| 2022 | -0.0011 | -0.0019 | -0.0006 | +0.0016 |
| 2023 | -0.0023 | -0.0015 | -0.0089 | -0.0035 |

The 7-bin result improves in every year.

**Volkanovski vs Gaethje** (5 rounds non-title, learned-rate model, roster loaded, 20,000 sims; from the speed runs):

| Setting | Volkanovski wins | Volkanovski KO/TKO win | Gaethje KO/TKO win |
|---|---|---|---|
| v4 final | 68.0% | 19.0% | 12.6% |
| v4 final + component (`kdCal` 1.164) | 67.6% | 19.7% | 14.5% |
| Same, builder's `kdCal` 1.1878 | 67.6% | 20.3% | 14.9% |

### Risks and interactions the verifier adds

- **Validation wiring (blocking for the v5 measurement).** Apply `durability_v4main.patch`, or at least
  `durability_evalv_v4main.patch`, before `tools/evalv.js --split val`, so the validated path is the ablated path.
  Any other harness that scores backtests with the flag on (`tools/v4_levels.js`, `mlcal`, `calibrate.js`) must pass
  `opts.dur` the same way. Otherwise it runs the computed fallback on live-fit terms. The roster guard now prevents
  the worse, fighter-level leak.
- **Live knockdown level.** At the live snapshot, the component raises the per-strike knockdown hazard of clean roster
  pairs by a median of x1.2 (fuzz). Three things combine:
  - the trailing 730-day level of 0.010274, the 2025-26 surge;
  - the live constant +0.078, against +0.010 in the pre-2024 fit;
  - kdCal x kdScale = 1.62.

  On train the walk-forward base keeps the level matched; live, the level is a labeled knob (`durability.level`; the
  365-day scenario is 0.011706). The 2024-2025 measurement tests the tracked level through the 2024 glove-trial dip,
  because its records carry L730(t).
- **5-round knockdowns.** Both the engine and the component under-produce them: 0.459 off and 0.446 on, against
  0.547 actual. The durability five/title terms (x0.895 / x0.908) stack on the engine's walk-forward `caution5`
  (0.6258) and `r1Caution5` (0.75), which were fit to finish rates. The 5-round finish and KO rates still match within
  their CIs. Refit them jointly with the dynamics component's by-round KD hazards; `durability.caution5` is the knob.
- **kdCal after future level changes.** Re-match with kdCal x KD_off / KD_on on train after any `kdScale`,
  `kdInstant` or dynamics change. The static on/off ratio 0.989 is a quick proxy.
- **The fallback path is not train-validated.** No profile without a record was in any ablation. Release needs the
  `fighters.json` rebuild that adds `dur`.
- **durability.json holds 373 backtest entries for 2026 (vault) fight ids.** They are pre-fight values only, with no
  outcomes, and no harness reads them. The vault tooling should know they exist, and `durability.json` should be split
  like `market.json` was.

---

# Builder's report (unchanged below; superseded where the verifier section above differs: `kdCal`, the patch files, the tests count)


Nov 6, 2026. Worktree `/home/user/XX/.claude/worktrees/wf_0113c02d-461-1`, branch `comp/durability` (local, not pushed).

## Commits, base and patches (builder's; see the verifier's patch list at the top for the current files)

| Item | Value |
|---|---|
| Worktree start commit | `853ce32a40216ecdc9ac8daa35de006932ae6665` ("WIP autosave") |
| Base-sync commit | `275b339` - the start commit's `src/engine3.js` was half-written (`matchup` undefined, the engine did not load). I copied the main checkout's in-flight v4 `src/engine3.js`, `src/params3.js` and `src/ml/mlrates.js` (state at 14:21-14:22 UTC). This commit is not part of the component. |
| Component commit | `bc8e562` "Engine v5 component: durability" |
| Patch, as requested (diff vs the start commit, includes the base sync) | `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/durability.patch` |
| Component-only patch (diff `275b339..bc8e562`), use this one on top of v4 | `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/durability_component_only.patch` |
| The two hunks that reject on the main checkout's current files, rewritten against them | `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/durability_v4main_rejects.patch` |

**Applying the patch to the main checkout's current v4 files** (checked with `git apply --check` on copies of them):

- `src/engine3.js`, `src/params3.js`, `tools/build_db.py`, the tests and the tools apply cleanly, with offsets.
- Two hunks reject:
  - `tests/test_engine3.js`: the API-surface line is already v4's. The `simAvg` relative-mode line has to go into v4's `simAvg`.
  - `docs/ENGINE_V3_SPEC.md`: an end-of-file append.
- `durability_v4main_rejects.patch` carries both hunks, rewritten against the current main files.
- After applying, refresh the flag-off golden: `DUR_BASE_REV=<commit before the patch> node tests/test_durability.js --write-golden`.

## What changed

- **`src/engine3.js`**
  - v4's `matchup()` is renamed `matchupML()`. A new `matchup()` calls it and, when `m.p.components.durability` is true, runs `applyDurability(m, profA, profB, opts)`.
  - `applyDurability` rewrites only `m.kd`, `m.gnp`, `m.stko` and `m.dw` (and `m.finR`, only if the `caution5` override knob is set). It adds `m.dur` (inputs and factors).
  - `simulate()`, the RNG draw order and the trace format are untouched.
  - New API:
    - `FightEngine.loadDurability(durability.json | {roster})` registers roster records by slug.
    - `FightEngine.durabilityCovariates(prof, age)` is a test helper.
  - `explain()` prints the durability decomposition.
  - With the flag false, the result is the v4 engine bit for bit (tests below).
- **`src/params3.js`**: `components: { durability: true }` and a `durability` block. Every value is labeled with its source (table below).
- **`tools/build_db.py`**
  - Walk-forward backtest sides and live profiles gain `ko_losses_365`, `kd_absorbed_365`, `layoff`, `last_ko_loss` and `ufc_years`, from strictly earlier fights.
  - Live profiles also gain `dur` (`chin_re`, `pow_re`, `chin_cov`, `pow_cov`), taken from `data/derived/durability.json` roster when that file exists.
  - I regenerated these in the worktree (`python3 tools/build_db.py`, 10 s). Checks:
    - 1,229 of 1,229 profiles get `dur`.
    - The recency fields match the durability roster for all 1,229 fighters: 0 mismatches in KO losses and 0 in knockdowns absorbed.
    - Every old backtest field is identical to the main checkout's `backtest_dev.json` (5,728 of 5,728 sides).
  - The regenerated `fighters.json` is **not committed**: it is a 2.3 MB single-line file and would conflict with other branches. A copy is at `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/durability_fighters_regenerated.json`.
  - Rerun `tools/build_db.py` after `tools/durability.py` at release. Until then the live page uses the computed fallback below.
  - The worktree's `backtest_dev.json` (gitignored) was rebuilt with the 2026 rows dropped unread. No vault file was written.
- **`tests/test_durability.js`** (new, 31 checks) and **`tests/fixtures/durability_off_golden.json`** (flag-off digests from the base revision).
- **`tests/test_engine3.js`**
  - The API-surface check now uses v4's line: VERSION 4.0.0 plus the v4 functions. It already failed at the base-sync commit.
  - The league-average self-calibration runs the component in relative mode (reason under Risks).
- **`tools/durability_ablation.js`**, `_report.py`, `.sh`, `_reports.sh`: the train-only ablation harness.
  - It refuses `--to` on or after 2024-01-01 without `--allow-validation`.
  - It never reads 2026 fights.
- **`docs/ENGINE_V3_SPEC.md`**: a new section, "Engine v5 component: durability".

## Equations

Knockdown hazard per landed standing head strike by i on j (absolute mode, the default):

```
m.kd[i]  = kdCal * kdScale * base_ij * relK_ij
base_ij  = level * exp(const + div_d + five * [5 rounds] + title * [title])      (backtests: the record's walk-forward base)
relK_ij  = (C_j * P_i * size * knobs)^(1 - w) * engRel_ij^w                   w = engineWeight = 0.5
C_j      = chin_cov_j * chin_re_j        P_i = pow_cov_i * pow_re_i
chin_cov = exp(0.06177 (age - 30) - 0.0016 max(0, age - 30) + 0.79895 [age unknown]
               - 0.14251 KDabs_365d - 0.0800 KDabs_older + 0.18908 KOL_365d + 0.0749 KOL_older)
pow_cov  = exp(-0.00445 (age - 30) - 0.03589 max(0, age - 30))
chin_re  = (3 + KD absorbed) / (3 + expected)     pow_re = (2.5 + KD scored) / (2.5 + expected)    (walk-forward, no decay)
engRel_ij = m.kd_v4[i] / (kd0 * kdScale * div.kd)   (the engine's own structure: v3 ratios, or the v4 learned rates)
m.gnp[i] = gnpTko * sqrt(rel_ij) * div.ko,  m.stko[i] = stko * sqrt(rel_ij) * div.ko    (rel = relK with C x P / NORM)
m.dw[i]  = ((P_i / normPow * knob)^(1 - w) * fac_v3.pow_i^w)^powDmgExp
```

- **Relative mode** (`level: null`): `base = kd0 * kdScale * div.kd * ctx`, with C x P divided by NORM and `kdCalRel` (1) in place of `kdCal * kdScale`.
- **Inputs**, first found wins:
  1. `opts.dur = {A, B, base}`, in the corner order of the call (backtests pass `durability.json` `backtest[fight_id]`).
  2. `prof.dur` (fighters.json after a rebuild).
  3. The roster registered with `loadDurability`.
  4. Computed from the profile's age, KO losses and knockdowns absorbed (recency fields when present), with `chin_re` / `pow_re` from career sums (`fallbackEB`).

## The computed task's term list versus the verified research

The task text quoted the first version of `research/model_durability.md`. The verified revision (same date, Verification log V1-V7) changed several terms. I followed the revision and kept every withdrawn term as a labeled, neutral knob:

| Task text | Verified research | In the engine |
|---|---|---|
| chin +6.0%/yr all ages | +6.0% (pre-2024) / +6.4% (live), no knee | `d_age_c` 0.06177, `d_age_h30` -0.0016 (live) |
| per-UFC-year term +2.1%/yr | withdrawn (no out-of-sample value once age is in) | `withdrawn.ufcYear` 0 (knob) |
| power age/tenure | -3.6%/yr past 30 pre-2024, -4.0% live; tenure withdrawn | `a_age_c` -0.00445, `a_age_h30` -0.03589 |
| KO-loss recency x1.156 / x1.046 | x1.208 (365 d) / x1.078 (older) live, no cap; plus prior-KD covariates x0.867 / x0.923 | `d_kol_r`, `d_kol_o`, `d_okd_r`, `d_okd_o` |
| last-fight KO loss x1.163 | withdrawn | `withdrawn.lastKO` null (knob) |
| layoff >= 2 y x0.64 | withdrawn | `withdrawn.layoff24` null (knob) |
| five-round x0.905, title x0.883 | x0.895, x0.908 (live, after fighter effects) | `five` -0.11143, `title` -0.09636 |
| chin exponent 1.15 | withdrawn (validation slope 0.98 +- 0.10) | `chinExp` 1, `powExp` 1 |
| fighter multipliers, prior strength 3 | Gamma(3, 3) chin, Gamma(2.5, 2.5) power | records; `alphaChin` 3, `alphaPow` 2.5 for the fallback |
| no size tax, knobs kept | confirmed on 7,982 fights | `sizeChin` 0, `sizePow` 0 (knobs) |
| division multipliers | FLY 1.17 ... LHW 1.40, women 0.33-0.57 | `div_*` terms (live) |
| league KD level via params | 730-day level 0.010274; 365-day 0.011706 as a scenario | `level` 0.010274 |

I did not evaluate the withdrawn terms. The only coefficients available for them come from fits that include 2019-2023 (`coef_pre2024.F36`) or 2024+, so any 2019-2023 score would be in-sample. The durability tool already rejected them on 2019-2023 using strict 2008-2018 fits.

## Parameter values and sources

| Parameter | Value | Source |
|---|---|---|
| `terms.*` | live Poisson fit 2008-01..2026-10 | `durability.json` `engine.terms_live` |
| `level` | 0.010274 | `engine.level_now_trailing_730` (snapshot Oct 31, 2026); 0.011706 = `level_now_trailing_365` (scenario) |
| `normChin`, `normPow` | 0.9972, 0.9752 live; 0.9882, 1.0183 in the 2019-2023 backtest | `engine.norm_*`, `engine.norm_*_backtest_2019_2023` |
| `alphaChin`, `alphaPow` | 3, 2.5 | `meta.spec` (tuned on 2019-2023 in tools/durability.py) |
| `engineWeight` | 0.5 | **train 2019-2023**, static KD deviance (table below) |
| `kdCal` | 1.18780096 (x kdScale 1.246 = 1.48) | **train 2019-2023**: level-matched to the v4 engine's simulated knockdowns per fight (100 sims x 1,000 fights: 1.5 gave +1.6%). Final run: on 0.459 vs off 0.454 vs actual 0.445 per fight |
| `fallbackEB`, `standShare` | true, 0.9 | research section 1 (90% of head strikes landed standing since 2019) |
| `chinExp`, `powExp` | 1, 1 | research section 2 (validation slopes 0.98, 0.80; exponent 1.15 withdrawn) |
| `sizeChin`, `sizePow` | 0, 0 | research section 7.2 |
| `gnpCal`, `stkoCal`, `caution5` | 1, 1, null | neutral |

**Choosing `engineWeight`** (train 2019-2023):

- Data: 3,862 attacker-defender rows and 889 knockdowns.
- Model: Poisson deviance of knockdowns on landed head strikes, with a free scale per model.
- Inputs: the durability walk-forward `p`, the ML out-of-fold `kd_h`, and the engine's static `m.kd`. The script is in the scratchpad (`dur/static_kd.py`).
- CIs: event bootstrap.

| KD structure | Deviance | vs v4 engine [95% CI] |
|---|---|---|
| v3 engine (power/chin ratios) | 3272.2 | +10.4 |
| v4 engine (ML rates applied) | 3261.8 | 0 |
| ML `kd_h` (OOF) | 3252.6 | |
| durability alone (w = 0) | 3246.7 | -15.0 [-57.4, +25.7] |
| **durability^0.5 x v4^0.5 (w = 0.5)** | **3226.3** | **-35.5 [-57.5, -14.7]** (vs durability alone -20.4 [-42.0, +1.2]) |
| durability^0.5 x v3^0.5 | 3234.5 | vs v3 -37.7 [-56.9, -18.5] |
| free GLM exponents | 3218.2 | durability 0.505, ML 0.386 |

The durability walk-forward base level also beat the engine's division level under the same structure: -11.2 [-28.4, +6.4]. That is why absolute mode is the default.

## Train-only ablation (2019-01-01 .. 2023-12-31)

**Setup**

- 1,999 backtest_dev fights in 211 events.
- Every fight is simulated in both corner orders, 250 simulations per orientation (500 per fight), with common random numbers: per-simulation seeds are identical across variants.
- Inputs, all leak-free:
  - frozen snapshots;
  - walk-forward priors (`mlcal_priors_asof`);
  - ML out-of-fold rates (`mlrates_oof.json`, so the baseline is the v4 engine with learned rates);
  - strict walk-forward durability records (`fit_through` = Y-1).
- CIs: paired event-cluster bootstrap, 2,000 resamples.
- Run time: 21 minutes on 3 workers at nice 5.
- Outputs: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/dur/full1/` (`report_*.txt`, `report_*.json`, `part*.json`).

**References on the same fights**

- Closing line (no-vig, power): winner log loss 0.6232.
- Pre-fight Elo: 0.6857.
- Entropy of the closing line, the floor for the soft CE: 0.6268.

**Main result: flag off (v4) vs flag on (v5 durability)**

| Metric | n | off | on | on - off [95% CI] |
|---|---|---|---|---|
| Winner log loss (decisive) | 1955 | 0.6663 | 0.6645 | -0.0018 [-0.0037, +0.0004] |
| Brier | 1955 | 0.2367 | 0.2358 | -0.0008 [-0.0018, +0.0002] |
| **Soft-label CE vs closing line** | 1999 | 0.6719 | 0.6708 | **-0.0012 [-0.0018, -0.0006]** |
| **7-bin log loss** | 1972 | 1.6571 | 1.6516 | **-0.0055 [-0.0098, -0.0011]** |
| **Method log loss (KO/SUB/DEC)** | 1972 | 0.9681 | 0.9644 | **-0.0036 [-0.0072, -0.0002]** |
| **Round log loss (R1..Rn / decision)** | 1972 | 1.2022 | 1.1968 | **-0.0054 [-0.0088, -0.0022]** |
| Stat deviance: sig landed | 1999 | 23.8672 | 23.6933 | -0.1739 [-0.2899, -0.0645] |
| Stat deviance: sig attempted | 1999 | 49.3721 | 49.0582 | -0.3138 [-0.5530, -0.0778] |
| Stat deviance: head landed | 1999 | 17.9804 | 17.8674 | -0.1130 [-0.1939, -0.0295] |
| Stat deviance: knockdowns | 1999 | 0.7185 | 0.7163 | -0.0021 [-0.0076, +0.0036] |
| Stat deviance: TD landed | 1999 | 1.7436 | 1.7404 | -0.0032 [-0.0071, +0.0003] |
| Stat deviance: TD attempts | 1999 | 3.2366 | 3.2289 | -0.0077 [-0.0160, +0.0003] |
| Stat deviance: sub attempts | 1999 | 0.8984 | 0.8980 | -0.0004 [-0.0028, +0.0018] |
| Stat deviance: control (min) | 1999 | 2.6102 | 2.6091 | -0.0010 [-0.0068, +0.0046] |

Stat deviance is Poisson, per fight-side.

**By year**, off -> on (difference in brackets):

| Year | n | Winner log loss | Soft CE vs close | 7-bin |
|---|---|---|---|---|
| 2019 | 388 | 0.6593 -> 0.6595 (+0.0001) | 0.6751 -> 0.6738 (-0.0013) | 1.5976 -> 1.5885 (-0.0091) |
| 2020 | 343 | 0.6755 -> 0.6708 (-0.0047) | 0.6755 -> 0.6748 (-0.0006) | 1.6395 -> 1.6329 (-0.0066) |
| 2021 | 415 | 0.6474 -> 0.6505 (+0.0031) | 0.6734 -> 0.6735 (+0.0001) | 1.6363 -> 1.6330 (-0.0033) |
| 2022 | 419 | 0.6708 -> 0.6657 (-0.0052) | 0.6706 -> 0.6688 (-0.0018) | 1.6822 -> 1.6797 (-0.0025) |
| 2023 | 390 | 0.6803 -> 0.6778 (-0.0025) | 0.6657 -> 0.6636 (-0.0022) | 1.7265 -> 1.7201 (-0.0065) |

**Base-rate table** (simulated vs actual):

| Base rate | n | actual | off | on | on - off [95% CI] | on - actual [95% CI] |
|---|---|---|---|---|---|---|
| finish rate | 1972 | 0.492 | 0.480 | 0.483 | +0.003 [+0.001, +0.005] | -0.009 [-0.031, +0.012] |
| finish rate, 3 rounds | 1729 | 0.486 | 0.475 | 0.479 | +0.004 [+0.002, +0.006] | -0.007 [-0.031, +0.016] |
| finish rate, 5 rounds | 243 | 0.535 | 0.516 | 0.513 | -0.003 [-0.007, +0.002] | -0.022 [-0.082, +0.040] |
| KO/TKO rate | 1972 | 0.317 | 0.318 | 0.322 | +0.004 [+0.002, +0.006] | +0.004 [-0.015, +0.022] |
| KO/TKO rate, 5 rounds | 243 | 0.395 | 0.382 | 0.379 | -0.003 [-0.008, +0.003] | -0.016 [-0.080, +0.048] |
| SUB rate | 1972 | 0.175 | 0.162 | 0.161 | -0.001 [-0.001, -0.000] | -0.014 [-0.031, +0.004] |
| round-1 finish rate | 1972 | 0.235 | 0.229 | 0.231 | +0.002 [+0.001, +0.004] | -0.004 [-0.023, +0.015] |
| draw rate | 1972 | 0.010 | 0.016 | 0.016 | -0.000 [-0.000, +0.000] | +0.006 [+0.001, +0.010] |
| knockdowns per fight | 1999 | 0.445 | 0.454 | 0.459 | +0.004 [-0.000, +0.009] | +0.014 [-0.018, +0.043] |
| knockdowns per fight, 5 rounds | 247 | 0.547 | 0.450 | 0.439 | -0.011 [-0.020, -0.002] | -0.108 [-0.197, -0.023] |
| sig landed per fight (both) | 1999 | 91.998 | 98.207 | 97.840 | -0.367 [-0.637, -0.102] | +5.842 [+2.589, +8.881] |
| minutes per fight | 1999 | 11.284 | 11.527 | 11.493 | -0.034 [-0.058, -0.011] | +0.208 [-0.066, +0.484] |

**KD calibration by defender band** (ROADMAP v5 check). O/E is observed over simulated knockdowns; the unit is the defender's side of a fight.

| Band | sides | KD | O/E off [95% CI] | O/E on [95% CI] |
|---|---|---|---|---|
| age < 27 | 496 | 85 | 0.93 [0.72, 1.15] | 1.00 [0.78, 1.23] |
| age 27-30 | 980 | 186 | 0.86 [0.74, 0.98] | 0.89 [0.77, 1.01] |
| age 30-33 | 1130 | 271 | 1.05 [0.92, 1.19] | 1.04 [0.91, 1.18] |
| age 33-36 | 845 | 192 | 0.97 [0.84, 1.11] | 0.92 [0.79, 1.06] |
| age 36+ | 547 | 155 | 1.06 [0.91, 1.22] | 1.00 [0.86, 1.15] |
| prior KO losses 0 | 2197 | 413 | 0.95 [0.85, 1.05] | 0.96 [0.86, 1.07] |
| prior KO losses 1 | 1033 | 256 | 1.02 [0.91, 1.14] | 1.00 [0.88, 1.12] |
| prior KO losses 2+ | 768 | 220 | 1.00 [0.88, 1.11] | 0.95 [0.85, 1.06] |
| all | 3998 | 889 | 0.98 [0.91, 1.05] | 0.97 [0.91, 1.04] |

- The age bands get flatter: the spread goes from 0.86-1.06 to 0.89-1.04, and the young and old ends move toward 1.
- The KO-loss bands stay flat.
- Weight-move bands are not tabulated. The size knob is 0 and the research says to leave them alone.

**Variants** (same run, same seeds; `on_w0` and `on_w1` are level-matched to off on the static mean hazard):

| Variant vs | Winner log loss | Soft CE vs close | 7-bin | Method | Round | KD deviance |
|---|---|---|---|---|---|---|
| on_w0 (durability alone) - off | -0.0005 [-0.0042, +0.0035] | -0.0007 [-0.0018, +0.0004] | -0.0037 [-0.0112, +0.0034] | -0.0020 [-0.0076, +0.0032] | -0.0053 [-0.0104, -0.0003] | +0.0020 [-0.0075, +0.0117] |
| on_w1 (level and context only) - off | -0.0004 [-0.0011, +0.0004] | -0.0000 [-0.0003, +0.0003] | -0.0012 [-0.0039, +0.0015] | -0.0015 [-0.0041, +0.0007] | -0.0017 [-0.0040, +0.0005] | +0.0024 [-0.0009, +0.0055] |
| on (w 0.5) - on_w0 | -0.0013 [-0.0034, +0.0007] | -0.0005 [-0.0011, +0.0001] | -0.0018 [-0.0062, +0.0028] | -0.0017 [-0.0043, +0.0011] | -0.0001 [-0.0032, +0.0029] | -0.0042 [-0.0089, +0.0004] |
| on (w 0.5) - on_w1 | -0.0014 [-0.0034, +0.0008] | -0.0012 [-0.0018, -0.0005] | -0.0043 [-0.0082, -0.0005] | -0.0021 [-0.0050, +0.0005] | -0.0036 [-0.0062, -0.0010] | -0.0045 [-0.0092, +0.0002] |

Most of the gain comes from the fighter chin and power structure, not from the level or context terms (on vs on_w1). The blend beats durability alone on every metric (n.s. individually), which matches the static KD result.

**Plain engine** (v3-style tables, no learned rates), 100 simulations per orientation, same protocol. The output is in `dur/noml/`.

| Metric | off | on | on - off [95% CI] |
|---|---|---|---|
| Winner log loss | 0.6736 | 0.6728 | -0.0008 [-0.0033, +0.0016] |
| Soft CE vs close | 0.6776 | 0.6753 | **-0.0023 [-0.0030, -0.0016]** |
| 7-bin log loss | 1.6694 | 1.6617 | **-0.0077 [-0.0141, -0.0016]** |
| Method log loss | 0.9698 | 0.9667 | -0.0031 [-0.0066, +0.0003] |
| Round log loss | 1.2057 | 1.2033 | -0.0024 [-0.0060, +0.0015] |
| KD deviance | 0.7239 | 0.7206 | -0.0033 [-0.0091, +0.0026] |

**Volkanovski vs Gaethje** (fighters.json, ML model loaded, roster records, 5 rounds non-title, 20,000 simulations):

| Setting | Volkanovski wins | Volkanovski KO/TKO loss | Gaethje KO/TKO loss |
|---|---|---|---|
| Flag off | 69.1% | 11.7% | 17.8% |
| Flag on | 68.7% | 14.0% | 19.5% |
| Flag on, 365-day level scenario | 67.3% | 15.3% | 20.3% |

The research's per-fight KO/TKO-loss model (K5) gives 24.4% (Volkanovski) and 25.1% (Gaethje). The engine is still below that, because it under-produces knockdowns in 5-round fights (see Risks).

## Recommendation

Include it in v5, flag on, `engineWeight` 0.5, absolute level.

- **What improves significantly on 2019-2023:**
  - soft-label CE against the close (the low-noise development target);
  - 7-bin, method and round log loss;
  - strike stat-line deviance.
- **What does not:** winner log loss, -0.0018 [-0.0037, +0.0004], and the KD-count deviance.
- **Where the gain is:** the simulator is now worth more for how and when a fight ends (method and round) than for who wins. That is the simulator's job in the current architecture, where the blend decides the winner (docs/BACKLOG.md).
- **Two values were set on these same years:** `engineWeight` (from static KD deviance) and `kdCal` (level matching). So these train numbers are slightly optimistic. The single v5 validation measurement on 2024-2025 should confirm them.
- **Validation inputs:** use `durability.json` `backtest[fight_id]` records. Their 2024+ entries use the 2008-2023 fit (strict), so they are leak-free for validation.

## Risks and interactions

- **v4 learned rates.** v4's kd retarget is kept and blended (w = 0.5), not discarded. If v4-final changes `applyToMatchup`'s kd step or `m.kd` semantics, `engRel` changes with it.
- **Knockdown level after merging.** `kdCal` is a multiplier on `kdScale`, so a v4 re-tune of `kdScale` (main already moved it 1.246 -> 1.236) carries over. But `kdCal` was level-matched to the v4 in-flight engine. Re-check knockdowns per fight on/off after merging, and with the dynamics component, which changes the in-fight knockdown modifiers. To re-match: `kdCal_new = kdCal x KD_off / KD_on` from one `tools/durability_ablation.sh` run.
- **5-round fights.**
  - Both variants under-produce knockdowns in 5-round fights: 0.44-0.45 per fight against 0.547 actual. The durability five/title terms lower them a little more (-0.011 [-0.020, -0.002]).
  - The 5-round finish and KO rates still match within their CIs. That is why the Volkanovski-Gaethje per-fight KO risks sit below the research's K5 model.
  - The joint fix is a train-only refit of `caution5` / `r1Caution5`. `durability.caution5` exists as an override knob, but I left it null.
- **Dynamics component.** Its research says the knockdown hazard per head strike falls by round and does not rise with damage, and that `form.vol` should be about 0.48. Durability's research also says 0.48 versus the engine's 0.6. Both components touch knockdown hazards: dynamics the in-fight modifiers, durability the base hazard. Re-run the level match and `form.vol` together after merging both.
- **League level.** 2025-26 runs hot: the 365-day level is 0.011706 against the default 0.010274. 2024 contains the glove-trial dip, which the walk-forward records track in validation. Live predictions depend on which level window is believed, so it stays a labeled knob.
- **Priors-era self-calibration.** In absolute mode the knockdown level is the tracked league level, not the 2018-2026 priors' level. On the live 730-day level, league-average knockdowns per 100 head strikes came out 17-23% above the priors-era target, against a 15% tolerance. So `tests/test_engine3.js` runs its league-average table in relative mode. In relative mode it is within 2% in every division (8 of 8).
- **Live data.** Without a rebuilt `fighters.json`, live profiles use the computed path. It treats all KO losses and knockdowns as older, and estimates fighter multipliers from career sums without opponent adjustment: Gaethje `chin_re` 0.49 against the roster's 0.58. Rebuild `fighters.json` (adds about 0.2 MB to the page data) or call `loadDurability`.
- **Known research open items.**
  - The 2024+ chin calibration slope is 1.32: weak chins are dropped even more than the model says.
  - Debutants are under-predicted on both sides; pre-UFC priors are the natural fix.
  - Fighter-effect intervals are wide (a factor of 3-4).
- **Corner symmetry.** Every evaluation averages both orientations. The component swaps exactly under a corner swap (tested).
- **Tests.**
  - `tests/test_durability.js`: 31 of 31 pass. Its flag-off proof reads the base revision through `git show`, with the golden digest as a fallback.
  - `tests/test_engine3.js`: 42 of 42 pass (34 of 34 with `--quick`).
  - `tests/test_director3.js` and `tests/test_mlrates.js` (47 checks) pass with the flag on.
  - Engine speed is unchanged; the extra matchup work is about 0.1 ms.
