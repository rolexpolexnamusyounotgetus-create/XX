# Component report: blend_anchor (VERIFIED, include in v5)

**Verifier's summary (Nov 6, 2026, about 4:50 pm UTC).**

- **Include in v5: yes.** Two bugs are fixed in the re-issued patch:
  - predict threw for manual profiles;
  - the P(win) interval was not corner-symmetric.
- **The flag-off engine is bit-identical** to v4 final (122c31a).
- **An independent re-run reproduces the train gains** (v4-final engine, fresh seeds, my own scoring code, 2019-2023 only):
  - winner -0.0229 [-0.0328, -0.0125];
  - 7-bin -0.0450 [-0.0584, -0.0306];
  - method-3 -0.0122 [-0.0191, -0.0050];
  - joint -0.0554;
  - strictly forward 2020-2023: winner -0.0264, 7-bin -0.0492.
- **Before the v5 measurement, read "Conditions for v5" below.**
  - predict's defaults load production data that includes validation and vault fights.
  - tools/evalv.js does not score predict.

**How to apply (supersedes the builder's section further down).**

- `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/blend_anchor.patch` is
  `git diff 122c31a verify/blend_anchor`: the component plus the verifier fixes, on top of v4 final.
  - **Base commit: 122c31a** (engine 4.0.0, params `4.0.0-selfcal-pre2024`; the commit this verifier worktree started
    from).
  - `blend_anchor_component_only.patch` is the same file.
- The builder's originals are kept, and are not for v4 final:
  - `blend_anchor.orig_853ce32.patch` (base 853ce32; it carries an in-flight v4 sync that would revert v4-final changes);
  - `blend_anchor_component_only.orig_f7ab48a.patch`.
- Branches in worktree `/home/user/XX/.claude/worktrees/wf_7ea2629f-826-3` (local only, not pushed):
  - `verify/blend_anchor` (122c31a + component + fixes);
  - `verify/blend_anchor_base` (853ce32 + the builder's patch; tree identical to the builder's 0f835d4).
- Verifier scripts and logs are in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vb/`:
  - identity_speed.js, speed.js, fuzz.js, anchor_trace.js;
  - abl/sim.js and abl/score.py, with abl/report_full.log and abl/report.json.

## Independent verification (Nov 6, 2026, about 4:45 pm UTC)

**Verdict: include in v5 (include = true).** Two bugs were fixed and the patch was re-issued. Four conditions for the v5
merge and measurement are listed under "Conditions for v5" below.

### Patches and base

- The builder's `blend_anchor.patch` applied on 853ce32 gives exactly the tree of 0f835d4.
- Engine v4 has since landed: commit 122c31a holds engine 4.0.0, params `4.0.0-selfcal-pre2024` and the frozen
  versions/v4/. The builder's component-only patch applies on 122c31a only with reduced context, because of the
  params3.js hunk.
- **The re-issued patches are against 122c31a (v4 final), not 853ce32.** Do not apply the old 853ce32 diff on v4 final:
  its in-flight v4 sync would revert v4-final changes, such as the judges' fight-level shared noise.
  - `blend_anchor.patch` and `blend_anchor_component_only.patch` are now the same file: the component plus the
    verifier fixes, `git diff 122c31a verify/blend_anchor`.
  - The builder's originals are kept as `blend_anchor.orig_853ce32.patch` and
    `blend_anchor_component_only.orig_f7ab48a.patch`.
  - Verifier branch: `verify/blend_anchor` in worktree wf_7ea2629f-826-3. The builder's patch applied on 853ce32 is on
    `verify/blend_anchor_base`.
- **On the main checkout as of about 4:50 pm UTC** (params `4.0.1-pre2024`, the v4 review's fixes):
  - The engine3.js and params3.js hunks apply with offset and fuzz, and `components` lands inside FightParams.
  - The tools/README.md hunk conflicts. It is documentation only: append the section by hand.
  - test_blend_anchor passes 63 of 63 on a copy of that src/ with the main data/.

### Bugs fixed (src/ml/blend.js, tests/test_blend_anchor.js)

1. **predict threw for any matchup whose experts match no stored MoE pattern.**
   - Every pattern in moe_page.json includes `feat_lr`.
   - A manual profile (`FightEngine.manualProfile`, whose S is an object rather than an array) has no feat_lr and no
     Elo. Every such call failed with "MoE: no linear weights for expert pattern engine": 20 of 500 fuzz pairs, all of
     them manual profiles.
   - Fix: catch the error and fall back to the simulator alone (`source: "engine"`), and report the reason in the new
     field `blendError`.
2. **The P(win) interval was not corner-symmetric.**
   - The profile-noise draws ran in call order, and the rating and Monte Carlo noise was not mirrored. So
     predict(B, A)'s interval was not the mirror image of predict(A, B)'s.
   - At B = 40 the endpoints differed by a median of 0.022 and at most 0.107. The point estimate and the cells were
     already exactly symmetric.
   - Fix: draw in the canonical fighter order (the same order `seedsOf` uses, factored out as `canonFlip`) and flip the
     sign of the symmetric noise terms through `ctx.sign` in `interval()`.
   - Afterwards the mirrored endpoints agree to 3e-16 across 50 swapped pairs.
   - The call in canonical order draws exactly as before, so the builder's interval and kappa numbers stand.
3. A params3.js comment gave the log-pool score as 2.1428. data/derived/blend_anchor.json says 2.1420; the comment now
   reads 2.1415 vs 2.1420.

There are two new tests, interval corner symmetry and the manual-profile fallback. test_blend_anchor now passes
63 of 63.

### Checks

| check | result |
|---|---|
| Flag off vs the **real** v4-final engine3.js / params3.js (not a stripped copy) | 40 random roster pairs, 12 divisions, 3 and 5 rounds, knobs, some with `ml: false`. matchup, summarize (200 fights), traced simulate and explain identical with the flag off **and** on: 80/80. predict with the flag off equals base summarize: 40/40. |
| Suites on v4 final + component | test_blend_anchor 63/63, test_engine3 69/69, test_director3 OK |
| Speed: summarize 20,000 five-round fights, 6 alternating repetitions, machine load about 50 | base median 9.6 s, patched 8.7 s. The code is identical, so there is no regression. predict with defaults takes 0.73 s; with anchor, 1.13 s. |
| Fuzz: 500 random pairs (13 division labels incl. Catch Weight, 3 and 5 rounds, random and extreme knobs, random lines and passed experts, anchor on about half, a manual profile every 25th) | Before the fix: 20 throws. After: 0 bad. No NaN or Inf, cells sum to 1, intervals ordered, \|s\| <= 4 (the clip was hit on extreme knobs), <= 4 anchor evaluations. |
| Corner swap (50 pairs) | p, the 7 bins and the simulator p mirror exactly. The anchor s mirrors to 9e-15 and the interval to 3e-16 after the fix. |
| Trace and director | 90 traced fights replayed with anchored knobs (30 pairs, \|s\| up to 4) through director3: 0 failures |
| Anchor solver vs an independent count | FightBlend.symSim cell counts equal the verifier's own counts with the same seeds (max diff 0, 928 fights) |

### Leakage audit

Nothing from 2024 on, and no 2026 fight, enters any fit or score in the ablation.

Checked:
- **Builder's dev extract.** data/derived/blend_anchor_dev.json covers 1,999 fights dated 2019-01-19..2023-12-16, with
  coefficient years 2019-2023 only.
- **feat_lr and elo.** My own extraction from out/moe_cache/experts.pkl matches blend_anchor_dev.json on all 1,999
  fights. feat_lr is the expanding-window page LR (each year fit on earlier years, C chosen on 2016-2018).
- **ml and elo_sig.** Only ml.json rows marked `oof` (2019-2023 annual expanding refits) are read.
- **Market.** mkt_rating is the walk-forward Kalman in market.json; the closing line serves only as the soft label and as
  a stacking input in the line regime.
- **S cells.** methodround.json `fights[id].S` with fit_through = Dec 31 of the previous year.
- **Rates and priors.** mlrates_oof.json (each year from earlier years) and mlcal_priors_asof.json (the 5 years before
  Jan 1 of the fight's year).
- **Profiles.** Frozen backtest_dev snapshots. tools/blend_anchor_bt.js never loads fighters.json, so no live roster
  values are used.

Mild in-window optimism (none of it from 2024+):
- The LOYO tables fit stackers and pool weights on later train years. The forward-chained tables avoid this and show the
  same gains.
- S's and ml's hyperparameters were chosen by CV inside 2016-2023.
- The builder's simulator was the in-flight v4, whose [selfcal] scales had been fit on league averages including
  2024-26. My re-run uses the v4-final train-only scales and reproduces the result.

### Equations and values against their sources

| value | source | status |
|---|---|---|
| mrWeight 0.15 | data/derived/blend_anchor.json settings.mrWeight; per-fold 0.10-0.20 | matches |
| kappa 1.65 | kappa80 1.648 | matches |
| slope0 0.86 | pilot_v1: 0.860, se 0.014, 120 fights, 200 sims per order | matches |
| recalT 1 | MoE production already carries T 1.17; the 2019-2023 fit gives T 1.09 | matches |
| cvOut 0.45 | docs/BACKLOG.md "Variance": between-fight log output sd 0.45 | matches |
| rescale (MoE.winnerFactors form) | | exact: P(win) hit, draw share and within-winner mix kept (tests) |
| anchor knob directions | engine: accuracy odds x adj.acc, TD odds / opponent's adj.tdDef, KD rate x adj.pow | correct |

Overstated, not changed:
- The "mean-preserving" power split keeps the pair's total knockdown rate only when the two KD rates are equal: in
  general the total is (k_A e^h + k_B e^-h) / cosh h.
- The builder measured +2.5% knockdowns vs the plain simulator. Mine: KD deviance +0.009, not significant.

### Independent train ablation (verifier)

Setup:
- Engine: v4 final + component.
- Seeds: fresh, md5("verify-blend|id|order"); 200 sims per corner order, both orders, common random numbers.
- Code: my own cell mapping, stacker (scipy L-BFGS-B, non-negative, no intercept, clipped logits), metrics and paired
  event-cluster bootstrap (2,000 draws).
- Fights: 1,999 dated 2019-2023 (1,952 decisive, 1,972 scored).
- "off" = the simulator alone (Jeffreys-smoothed cells).
- "on" = the package, with the LOYO stacker over mkt_rating / ml / feat_lr / engine / elo_sig / elo, and the
  simulator + S pool with the LOYO weight.

| metric | on | off | on - off [95% CI] | builder's |
|---|---|---|---|---|
| winner log loss | 0.6420 | 0.6649 | **-0.0229 [-0.0328, -0.0125]** | -0.0240 |
| soft CE vs close | 0.6527 | 0.6718 | **-0.0191 [-0.0213, -0.0170]** | -0.0200 |
| 7-bin | 1.6169 | 1.6619 | **-0.0450 [-0.0584, -0.0306]** | -0.0461 |
| method-3 | 0.9550 | 0.9672 | **-0.0122 [-0.0191, -0.0050]** | -0.0142 |
| joint method x round | 2.1399 | 2.1953 | **-0.0554 [-0.0702, -0.0405]** | -0.0671 |
| Brier | 0.2256 | 0.2361 | -0.0106 [-0.0151, -0.0059] | -0.0111 |
| dev sig. attempted | 20.20 | 20.45 | **-0.249 [-0.406, -0.085]** | -0.301 |
| dev sig. landed | 11.21 | 11.32 | **-0.114 [-0.199, -0.024]** | -0.222 |
| dev head landed | 10.56 | 10.67 | **-0.112 [-0.188, -0.032]** | -0.234 |
| dev body landed | 4.342 | 4.365 | -0.023 [-0.054, +0.012] | -0.030 |
| dev leg landed | 4.787 | 4.830 | **-0.042 [-0.076, -0.009]** | -0.058 |
| dev knockdowns | 0.982 | 0.984 | -0.002 [-0.011, +0.008] | -0.005 |
| dev TD attempted | 2.351 | 2.354 | -0.003 [-0.009, +0.003] | -0.022 (sig.) |
| dev TD landed | 1.472 | 1.476 | -0.003 [-0.008, +0.001] | -0.005 |
| dev control s | 113.58 | 115.73 | **-2.15 [-3.11, -1.20]** | -2.26 |
| dev sub attempts | 0.985 | 0.989 | -0.004 [-0.011, +0.004] | -0.011 (sig.) |

The stat lines differ from the builder's because the v4-final simulator's own stat lines are better than the in-flight
v4's, so the ML stat-line model wins on 5 stats instead of 7. It is worse on none.

**Strictly forward 2020-2023.** Stacker and pool weight are fit on years < Y only (n = 1,564 decisive):

| metric | on - off [95% CI] |
|---|---|
| winner | **-0.0264 [-0.0350, -0.0173]** |
| soft | -0.0182 [-0.0203, -0.0161] |
| 7-bin | **-0.0492 [-0.0629, -0.0354]** |
| method-3 | **-0.0115 [-0.0192, -0.0037]** |
| joint | **-0.0592 [-0.0740, -0.0441]** |

**Where the method gain comes from.** It comes from pooling with S, not from the rescale alone:
- on vs the blend + the rescaled simulator only: 7-bin -0.0223 [-0.0317, -0.0126], method -0.0108 [-0.0176, -0.0038],
  joint -0.0328.
- Forward, the same comparison: 7-bin -0.0232, method -0.0103.
- S rescaled alone vs on: 7-bin +0.0014 [-0.0016, +0.0046], not significant. The simulator adds little beyond S.

**By year (winner, on - off).**

| year | winner [95% CI] | 7-bin |
|---|---|---|
| 2019 | +0.003 [-0.020, +0.026] | -0.016 |
| 2020 | -0.032 [-0.053, -0.011] | -0.046 |
| 2021 | -0.004 [-0.031, +0.023] | -0.030 |
| 2022 | -0.037 [-0.053, -0.021] | -0.057 |
| 2023 | -0.045 [-0.063, -0.026] | -0.076 |

The 7-bin log loss improves in every year.

**Pool weight on v4 final.**
- LOYO optima 0.20-0.30 and forward 0.25-0.35, against the builder's 0.10-0.20.
- The curve is flat: joint 2.1396 at 0.15 vs 2.1392 at 0.25. The shipped 0.15 minus the cross-fit weight is
  -0.0003 [-0.0018, +0.0012].
- Keep 0.15, and refit it on the merged v5 engine.
- LOYO stacker weights on the full pattern: mkt_rating 0.50-0.78, ml 0.49-0.56, feat_lr 0.04-0.19,
  engine 0-0.17, elo_sig 0, elo 0.

**Anchor mode.** Run on every second fight (1,000), with targets from my own LOYO blend:
- It reaches the target: median |P_sim - target| 0.0099 (p90 0.0226); median |s| 0.40 (p90 1.01).
- Anchored vs plain simulator:

  | metric | anchored - plain [95% CI] |
  |---|---|
  | winner | **-0.0261 [-0.0409, -0.0120]** |
  | soft | -0.0183 |
  | 7-bin | -0.0122 [-0.0341, +0.0089], not significant |
  | method-3 | -0.0025, not significant |
  | head landed | **-0.172 [-0.345, -0.006]** |
  | sig. landed | -0.150 [-0.317, +0.023] |
  | control | -0.85 [-1.98, +0.24] |
  | KD | +0.009 [-0.011, +0.028] |

- No stat gets significantly worse.
- Inside the package, the anchored cells are neutral (7-bin +0.0020 [-0.0013, +0.0055]). This agrees with the builder.

**Base rates (on vs off).** The flag on improves the round-2 and round-3 finish shares, control and sub attempts. The
5-round finish rate moves the wrong way (+0.038, not significant, n = 243), as the builder found; it comes from S.

| rate | observed | off: pred (bias) | on: pred (bias) |
|---|---|---|---|
| P(finish in R2) | 0.167 | 0.145 (**-0.021**) | 0.155 (-0.012) |
| P(finish in R3) | 0.078 | 0.095 (**+0.018**) | 0.084 (+0.006) |
| control s | 122.6 | 115.8 (**-6.8**) | 117.7 (**-5.0**) |
| sub attempts | 0.280 | 0.255 (**-0.025**) | 0.264 (-0.016) |
| 5-round fights: P(finish) | 0.535 | 0.533 (-0.002) | 0.573 (+0.038) |
| P(draw) | 0.010 | 0.003 (**-0.007**) | 0.006 (-0.005) |
| KO / SUB / DEC | 0.317 / 0.175 / 0.508 | within 0.008 | within 0.012 |

### Conditions for v5 (what the merge and the single validation look must respect)

1. **predict's defaults are production data, not hidden-data-safe.**
   - The defaults are moe_page.json (refit through 2025, temperature 1.17) and methodround.json `js_model`
     (`fit_through: 2026-10-31`, which includes vault fights). The js_model also needs roster-only `extras[slug]`, so it
     cannot score backtest snapshots correctly anyway.
   - The v5 validation of this component, and any vault audit, must instead pass:
     - a ≤2023 stacker (moe.json `model_validated`, or a train-only refit) via `opts.moe`;
     - walk-forward S cells (`fights[id].S`; for 2024-25 these come from the fit through 2023) via `opts.mrCells`;
     - walk-forward experts via `opts.experts`.
2. **tools/evalv.js scores summarize, not predict.** With the flag on or off, simulate and summarize are bit-identical.
   A leave-one-out ablation that scores only evalv's engine metrics will therefore show this component as exactly zero.
   The v5 harness has to score predict's package: winner from the blend, cells from the pool.
3. **build.py has no slots yet** for src/ml/blend.js, src/ml/moe.js, tools/methodround_model.js, moe_page.json and
   methodround.json, so the page cannot call predict until they are inlined.
4. **Refits on the merged v5 engine:**
   - the MoE `engine` expert weight (moe_page.json was fit on v3), with tools/evalv_blend.py;
   - the pool weight;
   - slope0 (tools/blend_anchor_bt.js pilot), whenever durability or dynamics change the finish hazards.

   Merge the `components: {}` objects in params3.js into one.

---

# Builder's report (unchanged; its "How to apply" is superseded above)


## How to apply

- **Branch:** `comp/blend_anchor`, in worktree `/home/user/XX/.claude/worktrees/wf_7ea2629f-826-1`. Local only, not
  pushed.
- **Base commit** (where the worktree started): `853ce32` ("WIP autosave: in-flight agent output").
  - At 853ce32, `src/engine3.js` referenced `matchup()` without defining it, so the engine did not load.
  - Commit `f7ab48a` therefore copies the main checkout's in-flight v4 files (engine3.js, params3.js, ml/mlrates.js)
    as they stood at 14:25 UTC. It is the base for the component and is not part of it.
- **The component** is commit `0f835d4`.

Patches:

- `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/blend_anchor.patch`:
  `git diff 853ce32 0f835d4` (as requested). It includes the f7ab48a v4 sync.
- `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/blend_anchor_component_only.patch`:
  `git diff f7ab48a 0f835d4`, the component alone. **Apply this one on top of v4.**
  - Checked against a copy of the main checkout's current src/ (params `4.0.0-selfcal-pre2024`): it applies cleanly
    (params3 with fuzz 2).
  - On that copy, `predict` runs, flag off equals `summarize` bit-for-bit, and p(A, B) + p(B, A) = 1 exactly.

The engine change is one marked block in `src/engine3.js`. The rest is new files, plus one hunk in `src/params3.js`
(a `components: { blend_anchor: true }` object and the `blend: {...}` settings) and one section in tools/README.md.

**Merging with other components:** if they also add a `components: {}` object to params3.js, merge the keys into a
single object. A duplicate `components` key in the object literal silently drops the earlier one.

## Flag

- **`params.components.blend_anchor`** (default true).
  - true: `FightEngine.predict` returns the blend package.
  - false: it returns `summarize(matchup(a, b, opts), sims, seed)`'s own numbers.
- **The flag never touches matchup, simulate, summarize or explain.** `tests/test_blend_anchor.js` compiles the
  engine source with the marked block removed as a second module. Across 3 matchups x both flag values, with fixed
  seeds, it checks that matchup, summarize (400 fights), traced simulate and explain are identical, and that
  predict with the flag off equals the stripped engine's summarize.
- **Tests (61 checks):** `node tests/test_blend_anchor.js` -> 61 passed, 0 failed.

Other suites:

| suite | result |
|---|---|
| `tests/test_director3.js` | OK |
| `tests/test_moe.js` | 21/21 |
| `tests/test_mlrates.js` | OK (47) |
| `tests/test_engine3.js` | 41 passed, 1 failed |

The one test_engine3.js failure is the "API surface" check. It expects `VERSION === "3.0.0"` and the v4 snapshot
says 4.0.0. It fails the same way at f7ab48a, before this component, and the v4 workflow owns that line.

---

# blend_anchor: blend-anchored simulation, recalibration and uncertainty (engine component, roadmap v9)

Status: built and ablated on train years only, Nov 6, 2026. Every number below is from 2019-01-01..2023-12-31
backtest_dev fights. No 2024+ fight was read into any fit or score (validation is reserved for the single v5
measurement), and no 2026 fight was touched.

## What it is

`FightEngine.predict(profA, profB, opts)` returns the final prediction package. It sits behind the flag
`params.components.blend_anchor` (src/params3.js, default true). The work is in `src/ml/blend.js` (`FightBlend`,
UMD), and engine3.js gains one marked block (`/* blend_anchor:begin */ ... /* blend_anchor:end */`) that adds
`predict` and `loadBlend`. Nothing outside that block changes: matchup, simulate (and its trace), summarize and
explain are bit-for-bit the same with the flag on or off. With the flag off, `predict` returns the plain engine
package, whose numbers are exactly `summarize(matchup(a, b, opts), sims, seed)`.

The package (flag on):

1. **P(win).** The verified MoE stack (src/ml/moe.js with data/derived/moe_page.json) over the experts the call
   supplies:
   - computed inside predict: the simulator itself (`engine`, both corner orders), the page feature LR
     (`feat_lr`, via `MoE.featLR`) and Elo;
   - passed in `opts.experts`: `ml`, `elo_sig` and `mkt_rating`;
   - optional market line: `opts.line = {oddsA, oddsB}`, power de-vig.

   Then an optional temperature, `p = sigm(recalT * logit p_blend)`. The default `recalT` is 1 (see
   Recalibration).
2. **Method x round.** Cell layout: A KO r1..R, A SUB r1..R, B KO r1..R, B SUB r1..R, A DEC, B DEC, DRAW.
   - The simulator's cells get Jeffreys smoothing on the counts, `(n_c + 0.5) / (N + 0.5 K)`. With finite sims an
     outcome never simulated would otherwise get p = 0.
   - Rescaling (`MoE.winnerFactors`) multiplies every A-win cell by `fA = p (1 - pD) / pA` and every B-win cell
     by `fB = (1 - p)(1 - pD) / pB`. This keeps the draw share and the method/round mix within each winner.
   - The same rescaling is applied to the method/round model S, or SM when a line is given
     (tools/methodround_model.js).
   - The two are then linearly pooled: `cells = w rescale(sim) + (1 - w) rescale(S)`, with **w = 0.15**.
3. **Anchor mode** (`opts.anchor`). A per-matchup skill offset s is split +s/2 for A and -s/2 for B:
   - striking-accuracy odds `x e^(cAcc s/2)`;
   - takedown-success odds, via the opponent's tdDef, `x e^(cTd s/2)`;
   - knockdown power `x e^(cPow s/2) / cosh(cPow s/2)`. This split is mean-preserving: the pair's total
     knockdown rate stays put.

   The mix is **cAcc 0.5, cTd 1, cPow 1**. s is solved so that the simulator's own P(A) equals the package P(win):
   - every evaluation is both corner orders with fixed seeds (common random numbers);
   - steps are least-squares regression steps on logit P_sim(s) over all evaluated points;
   - the slope is shrunk toward the prior **slope0 0.86** (pilot) and clipped to [slope0/3, 3 slope0];
   - the search stops at |P - target| <= 0.01, a step under 0.05, or 4 evaluations.

   The anchored run's cells and stat lines replace the plain simulator's. Its cells are again rescaled exactly to
   the target. `anchor.adjA` and `anchor.adjB` are the knobs that reproduce the anchored matchup, for example for
   the 3D show's traced fight.
4. **Stat lines.** The ML stat-line model's per-minute rates (`m.mlPred`, src/ml/mlrates.js) next to the
   simulator's (plain or anchored). Expected totals use the package's expected fight length.
5. **Uncertainty.** An interval for P(win) from a parametric bootstrap of fighter-profile noise.
   - The noise is applied to each profile's decayed sums S: fight-level gamma multipliers with relative variance
     cv^2 / n_eff (n_eff = decayed fights S.n), plus count noise 1/count.
   - The cvs are:

     | sum | cv | source |
     |---|---|---|
     | strike volume | 0.45 | docs/BACKLOG.md "Variance": between-fight log output sd 0.45 |
     | grappling | 1.0 | judgment call |
     | subs | 1.5 | judgment call |
     | KD | 1.0 | judgment call |
     | accuracy | 0.25 | judgment call |

     Landed counts follow their attempts. Exposures and win/loss counts stay fixed.
   - The draws are propagated through the feature LR exactly. The ML expert takes the same logit shift (both are
     feature LRs on the same stats; their logits correlate about 0.9). The simulator gets its Monte Carlo error.
     All of this then goes through the blend.
   - `interval.levels` holds the raw bootstrap quantiles. `interval.calibrated` inflates the logit sd by
     **kappa = 1.65** (see below).

`FightEngine.loadBlend({ moe: moe_page.json, methodRound: methodround.json })` loads the data once. In a browser,
blend.js, moe.js and methodround_model.js are read from `self` (FightBlend, MoE, MethodRound). build.py needs a slot
for each one plus the two JSONs.

## Ablation protocol

- **Fights.** 1,999 backtest_dev fights dated 2019-2023 with simulator runs:
  - 1,952 decisive (scored for the winner);
  - 1,972 scored for method / 7-bin (DQ and no-contests excluded, as in tools/methodround.py);
  - 1,999 for stat lines.
- **Simulator (flag off, and the `engine` expert).** The engine as synced from the in-flight v4 (ML stat-line
  retargeting, EM judges), run with leak-free inputs:
  - frozen pre-fight snapshots;
  - priors `mlcal_priors_asof.json[year]` (5 years before Jan 1 of the fight's year);
  - learned rates from `mlrates_oof.json` (each year from a model trained on earlier years), passed as `opts.ml`.

  Each fight is run in both corner orders with 200 sims each (400 per fight), with seeds md5(id:1) and md5(id:2).
  These common random numbers are shared with the anchor stage.
- **Experts.** All are strictly walk-forward:
  - `feat_lr`: expanding-window OOF from out/moe_cache/experts.pkl, extracted by tools/blend_anchor_prep.py;
  - `ml`, `elo_sig`: ml.json, rows marked oof;
  - `mkt_rating`: market.json, walk-forward Kalman;
  - `elo`: snapshot Elo;
  - `market`: market.json p_power_close (closing line).
- **Cross-fitting.**
  - Stacker and pool weight: leave-one-year-out (LOYO) inside 2019-2023, so every fight is predicted by a fit
    without its own year. The stacker is the MoE linear family: non-negative, no intercept, on logit(clip(p, .01, .99)),
    one fit per availability pattern.
  - Recalibration choice and the "forward" table: rolling origin (fit on years < Y, test Y = 2021, 2022, 2023).
- **Symmetry.** Every model is corner-symmetric: stackers have no intercept, cells are averaged over both orders,
  and predict assigns the seed pair by a canonical fighter order. Scores are therefore the same in either
  orientation.
- **Metrics.**
  - Winner log loss on decisive fights.
  - Soft-label cross-entropy against the closing line q = p_power_close: -[q log p + (1-q) log(1-p)].
  - 7-bin, method-3 (KO / SUB / DEC incl. draw), joint method x round and finish log loss.
  - Stat-line deviance: Poisson deviance per fight-side, with exposure = actual minutes and predicted count =
    per-minute rate x minutes.
  - Base rates.
- **CIs.** Paired event-cluster bootstrap (2,000 draws, events resampled).

## Ablation: flag on vs flag off (2019-2023, LOYO)

"on" = the full package (no line): LOYO stacked blend for P(win), sim + S pooled at w = 0.15, ML stat lines.
"off" = the simulator alone.

| metric | n | on | off | on - off [95% CI] |
|---|---|---|---|---|
| winner log loss | 1952 | 0.6420 | 0.6660 | **-0.0240 [-0.0329, -0.0138]** |
| soft CE vs close | 1952 | 0.6528 | 0.6727 | **-0.0200 [-0.0222, -0.0179]** |
| 7-bin log loss | 1972 | 1.6167 | 1.6629 | **-0.0461 [-0.0597, -0.0318]** |
| method-3 log loss | 1972 | 0.9558 | 0.9699 | **-0.0142 [-0.0221, -0.0060]** |
| joint method x round | 1972 | 2.1415 | 2.2085 | **-0.0671 [-0.0835, -0.0502]** |
| finish vs decision | 1972 | 0.6608 | 0.6695 | **-0.0086 [-0.0143, -0.0028]** |
| Brier | 1952 | 0.2256 | 0.2367 | -0.0111 [-0.0151, -0.0065] |
| accuracy | 1952 | 0.626 | 0.606 | +0.020 [-0.001, +0.041] |
| dev sig. attempted | 1999 | 20.202 | 20.504 | **-0.301 [-0.473, -0.131]** |
| dev sig. landed | 1999 | 11.206 | 11.428 | **-0.222 [-0.337, -0.100]** |
| dev head landed | 1999 | 10.558 | 10.792 | **-0.234 [-0.350, -0.121]** |
| dev body landed | 1999 | 4.342 | 4.372 | -0.030 [-0.063, +0.005] |
| dev leg landed | 1999 | 4.787 | 4.845 | **-0.058 [-0.087, -0.027]** |
| dev knockdowns | 1999 | 0.982 | 0.987 | -0.005 [-0.015, +0.004] |
| dev TD attempted | 1999 | 2.351 | 2.373 | **-0.022 [-0.032, -0.012]** |
| dev TD landed | 1999 | 1.472 | 1.478 | -0.005 [-0.011, +0.001] |
| dev control s | 1999 | 113.58 | 115.84 | **-2.26 [-3.28, -1.31]** |
| dev sub attempts | 1999 | 0.985 | 0.996 | **-0.011 [-0.019, -0.003]** |

Forward-chained 2021-2023 (stacker on earlier years only, plus the chosen recalibration; n = 1,222 decisive):

| metric | on | off | on - off [95% CI] |
|---|---|---|---|
| winner | 0.6350 | 0.6643 | **-0.0293 [-0.0405, -0.0177]** |
| soft CE vs close | 0.6510 | 0.6711 | **-0.0201 [-0.0226, -0.0177]** |
| 7-bin | 1.6329 | 1.6820 | **-0.0492 [-0.0665, -0.0315]** |
| method-3 | 0.9738 | 0.9851 | **-0.0113 [-0.0219, -0.0013]** |
| joint | 2.1708 | 2.2374 | **-0.0666 [-0.0882, -0.0450]** |

By year, winner on - off:

| year | n | on | off | on - off [95% CI] |
|---|---|---|---|---|
| 2019 | 388 | 0.6632 | 0.6601 | +0.0031 [-0.018, +0.027] |
| 2020 | 342 | 0.6422 | 0.6789 | -0.0367 [-0.057, -0.016] |
| 2021 | 414 | 0.6458 | 0.6457 | +0.0001 [-0.025, +0.026] |
| 2022 | 419 | 0.6322 | 0.6726 | -0.0404 [-0.059, -0.023] |
| 2023 | 389 | 0.6271 | 0.6751 | -0.0480 [-0.066, -0.027] |

7-bin improves in every year (-0.021 to -0.078). The v4 simulator is level with the blend in 2019 and 2021 and far
behind in 2020, 2022 and 2023, which is the same year-to-year instability research/model_moe.md found for v3.

Where the gains come from:

- **Winner.** The blend. Single experts' winner log loss on the same fights:

  | expert | log loss |
  |---|---|
  | market close | 0.6223 |
  | ml | 0.6470 |
  | feat_lr | 0.6537 |
  | mkt_rating | 0.6539 |
  | simulator (v4) | 0.6660 |
  | elo_sig | 0.6726 |
  | elo | 0.6856 |

  - LOYO stacker weights (no line, every expert present): mkt_rating 0.50-0.78, ml 0.49-0.56, feat_lr 0.05-0.19,
    simulator 0-0.14, elo_sig 0, elo 0.
  - The v4 simulator earns a small non-zero weight in 3 of 5 folds.
  - For reference only (in-sample): MoE's own validated weights score 0.6407 on these fights; they were fit on
    2019-2023 with the stale v3 engine.
- **Method x round.**
  - Rescaling the simulator alone gives 7-bin -0.024 but method-3 only -0.0014 (n.s.).
  - Pooling with S adds the method information. S rescaled alone is 1.6184 on 7-bin, against 1.6167 for the pool
    (+0.0017 [-0.0006, +0.0039]), so the simulator's own method shape adds little beyond S.
  - LOYO pool weights per fold: 0.10-0.20. The linear pool beats the log pool (2.1415 vs 2.1420 joint).
- **Stat lines.** The ML stat-line model beats the plain simulator on 7 of 10 stats (CIs exclude 0). It is level
  on body landed, KD and TD landed.
- **With the closing line.**
  - The line-present blend (LOYO) scores 0.6233 against 0.6223 for the close (+0.0009 [-0.0018, +0.0039]). That is
    level with the line, matching MoE's CV years 2021-2023.
  - Against the no-line package it gains -0.0187 on the winner and -0.0185 on 7-bin.
  - The no-line package is 0.0197 behind the close.
- **Flag-off cells, raw vs smoothed.** Without Jeffreys smoothing the flag-off 7-bin is 1.6707, not 1.6629.
  One 2019-2023 draw had zero simulated draws in 400 runs and alone costs 0.008. The table above uses the smoothed
  simulator, the fairer comparison.

## Anchor mode (b)

The anchored simulator is solved to the LOYO no-line blend target. All 1,999 fights use the shipped mix.

| metric | anchored sim | plain sim | anchored - plain [95% CI] |
|---|---|---|---|
| winner | 0.6433 | 0.6660 | **-0.0227 [-0.0318, -0.0126]** |
| soft CE vs close | 0.6531 | 0.6727 | **-0.0196 [-0.0218, -0.0175]** |
| 7-bin | 1.6453 | 1.6629 | **-0.0176 [-0.0313, -0.0030]** |
| method-3 | 0.9662 | 0.9699 | -0.0038 [-0.0086, +0.0012] |
| joint | 2.1853 | 2.2085 | **-0.0233 [-0.0405, -0.0055]** |
| dev sig. attempted | 20.469 | 20.504 | -0.034 [-0.181, +0.109] |
| dev sig. landed | 11.235 | 11.428 | **-0.193 [-0.309, -0.075]** |
| dev head landed | 10.609 | 10.792 | **-0.183 [-0.290, -0.076]** |
| dev body landed | 4.348 | 4.372 | -0.024 [-0.054, +0.005] |
| dev leg landed | 4.838 | 4.845 | -0.007 [-0.031, +0.019] |
| dev knockdowns | 0.981 | 0.987 | -0.006 [-0.018, +0.008] |
| dev TD attempted | 2.368 | 2.373 | -0.004 [-0.012, +0.003] |
| dev TD landed | 1.466 | 1.478 | -0.011 [-0.027, +0.005] |
| dev control s | 114.42 | 115.84 | **-1.42 [-2.19, -0.63]** |
| dev sub attempts | 0.995 | 0.996 | -0.001 [-0.008, +0.006] |

- **The anchor reaches the blend.** Median |P_sim - target| is 0.010 (p90 0.024) after 1.7 evaluations on
  average. Median |s| is 0.38 (p90 0.92). s correlates 0.97 with the logit gap it closes.
- **The stat lines do not worsen; they improve.** No stat gets worse, and landed strikes and control get better.
  Anchored stat lines sit next to the ML stat-line model: sig. landed 11.235 vs 11.206 (n.s.), head 10.61 vs
  10.56 (n.s.); the ML model stays better on attempts (+0.27), leg landed and TD attempts.
- **Inside the package the anchor is neutral on method / 7-bin.** Pooled with S at w = 0.15: 7-bin -0.0001,
  method-3 -0.0006, both n.s.

How the mix was chosen. Four mixes were scored on every third fight (667 fights, train years). The selection
overlaps the full-run table above on those fights, so its numbers carry a little selection optimism.

| mix acc / td / pow | slope0 | sig. landed dev vs plain | head landed | KD | control | method-3 (raw cells) |
|---|---|---|---|---|---|---|
| 1 / 1 / 0 | 0.77 | +0.300 [-0.03, +0.62] | +0.248 | +0.002 | -1.48 | +0.0068 [+0.0002, +0.0138] |
| **0.5 / 1 / 1** | 0.86 | **-0.206 [-0.40, -0.03]** | -0.200 | +0.024 | -2.21 | +0.0021 (n.s.) |
| 0 / 1 / 2 | 0.91 | -0.054 | -0.038 | +0.044 [+0.014, +0.075] | -1.74 | +0.0114 (n.s.) |
| 0.5 / 2 / 0.5 | 0.71 | -0.133 | -0.141 | +0.012 | -0.64 | +0.0027 (n.s.) |

- **Pure accuracy does not work.** On the full 1,999 fights, the first version (accuracy and takedown odds only,
  1 / 1 / 0) reached the blend but worsened landed strikes: sig. landed +0.215 [+0.017, +0.414], head
  +0.244 [+0.049, +0.434].
- **Power keeps the stat lines realistic.** Putting part of the edge on knockdown power does. The mean-preserving
  power split then removed the extra knockdowns that the plain e^(+-s/2) split added: 0.2429 per fighter per fight
  became 0.2326 (plain sim 0.2270, observed 0.2224). It also turned the KD deviance from +0.010 to -0.006.

## Recalibration (c): rolling origin inside 2019-2023

The stacker is fit on years < Y with recency weights 0.5^((Y-1 - year)/h). The temperature is fit on the
forward-OOF logits of the training years (2020 on). The test years are Y = 2021, 2022, 2023, and the scores are
pooled log loss on decisive fights.

No line:

| scheme | CV log loss | 2021 | 2022 | 2023 | T by test year |
|---|---|---|---|---|---|
| **recency h=1 + temperature** | **0.6350** | 0.6440 | 0.6385 | 0.6218 | 0.943 / 0.979 / 1.051 |
| recency h=1 | 0.6351 | 0.6439 | 0.6383 | 0.6222 | - |
| recency h=1.5 + temperature | 0.6353 | 0.6440 | 0.6381 | 0.6231 | 0.943 / 0.984 / 1.051 |
| recency h=1.5 | 0.6354 | 0.6438 | 0.6379 | 0.6237 | - |
| recency h=3 (+ temperature) | 0.6358 | | | | |
| temperature (last year only) | 0.6361 | 0.6440 | 0.6377 | 0.6260 | 0.943 / 1.024 / 1.136 |
| temperature | 0.6364 | 0.6440 | 0.6380 | 0.6266 | 0.943 / 0.988 / 1.039 |
| none | 0.6365 | 0.6438 | 0.6379 | 0.6271 | - |

With the line, the winner is recency h=1 with no temperature (0.6182). Plain "none" scores 0.6184, and every
temperature variant scores 0.6185-0.6189.

- **The gains are small.** The chosen no-line scheme beats none by -0.0014 [-0.0033, +0.0005] on the forward
  table, not significant.
- **The direction is consistent.** Recency helps, mostly in 2023, and the fitted temperature rises year by year
  (0.94 -> 0.98 -> 1.05, and 1.09 when fit through 2023). That is the start of the 2024-25 under-confidence that
  research/model_moe.md and model_ml.md saw.
- **No second temperature in production (`recalT = 1`).** The scheme that wins here is what the MoE production
  refit already does: no line, h = 1.5 + temperature, refit through 2025 (T 1.17); with a line, no temperature.
  `recalT` exists for blends without their own calibration.
- **For the v5 release refit,** keep MoE's recipe: h = 1 or 1.5 is a toss-up (0.6350 vs 0.6353), plus a
  temperature fit on forward-OOF logits.

## Uncertainty (d)

These checks are on the LOYO no-line blend (1,952 fights; the close is available for all of them; B = 200 draws).

| variant | median sd (logit) | raw cover of close 80% / 95% | log loss point / bootstrap mean | calibration slope by sd tercile (narrow / mid / wide) |
|---|---|---|---|---|
| profile noise + MC (shipped) | 0.297 | 0.549 / 0.755 | 0.6420 / 0.6418 | 1.04 / 0.99 / 0.87 |
| profile noise x0.5 | 0.129 | 0.266 / 0.398 | 0.6420 / 0.6421 | 1.07 / 0.97 / 0.86 |
| + Glicko RD on Elo experts | 0.298 | 0.553 / 0.757 | 0.6420 / 0.6415 | 1.04 / 0.96 / 0.90 |

- **The raw profile-noise interval is too narrow** to describe how far the blend sits from a well-informed price.
  It covers the close in 55% of fights at the nominal 80%.
- **The calibrated interval** uses the logit-normal form `sigm(z0 +- z_q kappa sd)`. kappa is set so the 80%
  interval covers the close 80% of the time: **kappa = 1.65**.
  - Checked out of fold (kappa fit on the other four years): 80.0% at 80% and 94.4% at 95%.
  - By held-out year at 80%: 0.77, 0.73, 0.87, 0.83, 0.78. Kappa by fold: 1.60-1.72.
  - The median calibrated 80% width is 0.28 in probability.
- **The per-fight width carries only a little information.**
  - corr(sd, |logit p - logit q|) is 0.03.
  - The widest third is over-confident (calibration slope 0.87) while the narrowest is not (1.04).
  - Averaging p over the bootstrap (Bayesian model averaging) changes log loss by -0.0002.
- **Read it as "where a closing line would likely land"**, not as a per-fight reliability score.

## Base rates (2019-2023; mean predicted vs observed, bias with CI)

| rate | observed | off | on | anchored |
|---|---|---|---|---|
| P(KO/TKO) | 0.317 | 0.319 (+0.002) | 0.329 (+0.011 [-0.008, +0.032]) | 0.330 |
| P(submission) | 0.175 | 0.167 (-0.008) | 0.165 (-0.010) | 0.164 |
| P(decision incl. draw) | 0.508 | 0.514 (+0.006) | 0.507 (-0.001) | 0.506 |
| P(draw) | 0.010 | 0.015 (+0.005) | 0.008 (-0.002) | 0.008 |
| P(finish in R1) | 0.235 | 0.230 | 0.241 | 0.242 |
| P(finish in R2) | 0.167 | 0.143 (**-0.024 [-0.039, -0.008]**) | 0.156 (-0.011, n.s.) | 0.156 |
| P(finish in R3) | 0.078 | 0.095 (**+0.017 [+0.004, +0.029]**) | 0.083 (+0.005, n.s.) | 0.083 |
| 5-round fights: P(finish) | 0.535 | 0.526 | 0.577 (+0.042 [-0.021, +0.104]) | 0.577 |
| favourite: predicted vs won (each model's own favourite) | off's fav. won 0.607; on's fav. won 0.626 | 0.594 (-0.013, under-confident) | 0.631 (+0.005) | 0.631 |
| sig. landed / fighter / fight | 46.0 | 48.2 (**+2.25 [+1.17, +3.41]**) | 46.6 (+0.58, n.s.) | 48.1 |
| sig. attempted | 98.6 | 99.8 | 99.8 | 99.7 |
| takedowns landed | 0.98 | 0.89 (**-0.093**) | 0.92 (**-0.059**) | 0.89 |
| knockdowns | 0.222 | 0.227 | 0.229 | 0.233 |
| control s | 122.6 | 115.8 (**-6.8**) | 117.7 (**-5.0**) | 114.5 |
| sub attempts | 0.280 | 0.247 (**-0.033**) | 0.264 (-0.016, n.s.) | 0.247 |

- **Better with the flag on:** the round-2 and round-3 finish shares, sig. landed, takedowns, control and sub
  attempts. Each |on| - |off| bias difference has a CI below zero, except R3, whose CI touches zero.
- **The one row that moves the wrong way is the 5-round finish rate** (+0.042, n.s., n = 243). It comes from S.

## Volkanovski vs Gaethje (illustration, live data)

Settings: 5 rounds at 155, 2,000 sims per corner order. Experts computed in predict: engine, feat_lr and Elo. ml
and mkt_rating were not passed.

| call | P(Volk) | 80% calibrated | finish | anchor s |
|---|---|---|---|---|
| flag off (simulator alone) | 69.4% | - | - | - |
| no line | 75.2% (sim 69.6%, feat_lr 66.3%, Elo 59.2%) | 45.8-91.6% | 48.8% | +0.33 (sim -> 75.5%) |
| opener +160 / -180 (market 36.9%) | 43.6% | 35.8-51.7% | 49.4% | -1.36 (sim -> 43.4%) |

With the line, the anchored simulator plays Gaethje's edge through Volk's knobs: accuracy odds x0.71, power x0.41
and takedown defence x0.51 (so Gaethje's takedown odds x1.97). Gaethje gets the mirror image: accuracy x1.41 and
power x1.59. Sig. landed per minute becomes Volk 5.0 and Gaethje 4.2; the ML
model says 5.3 and 3.7. A |s| of 1.36 is beyond the 2019-2023 p90 of 0.92. The flag is "the simulator disagrees
with the market by a lot", and the anchor then forces strong knob values.

## Risks and interactions

- **Engine base.**
  - The simulator here is the in-flight v4 copied from the main checkout at 14:25 UTC: ML retargeting, EM judges,
    params `4.0.0-dev`, judge noise still at [judgecal] placeholders.
  - Its `[selfcal]` / `[walkfwd]` scales were fit on league averages that include 2024-26 (docs/BACKLOG.md). That
    affects flag on and off alike, and only through league averages.
  - When v4 lands, rerun the plain and anchor stages. The slope prior and the pool weight may move a little.
- **Other components.**
  - Each changes the `engine` expert and the simulator cells. The blend re-weights them automatically, but the
    weight here was 0-0.14.
  - The anchor knobs ride on `adj.acc`, `adj.tdDef` and `adj.pow`. These survive the v4 ML retargeting
    (mlrates.js applyToMatchup layers the knobs on top), but a component that rewires accuracy or power must keep
    honouring them.
  - durability / dynamics / officials change finish hazards, which changes what a unit of s does. Re-pilot slope0
    (`tools/blend_anchor_bt.js pilot`).
- **Production MoE vs the validated fit.** FightEngine.predict uses moe_page.json, the production refit through
  2025 with temperature 1.17 for no line. This ablation used train-only LOYO stackers, so the production blend's
  sharpness is untested here; see research/model_moe.md's "production stretch" risk. The interval kappa (1.65) was
  calibrated around the LOYO blend, not the production one.
- **Method/round S model.** It owns 85% of the method shape. Its 5-round finish rate runs high (+0.04, n.s.).
  It needs fighters.json-style profiles (C, record) and `extras[slug]`; for other profiles predict falls back to
  the rescaled simulator alone (w = 1).
- **Experts.** predict computes only engine, feat_lr and Elo itself. ml, elo_sig and mkt_rating must be passed by
  the page. Without them the blend uses a smaller pattern, which is weaker: the feat_lr + engine + elo pattern was
  0.6537-level on train years.
- **Interval semantics.** It is profile noise inflated to market-disagreement scale. It is not a per-fight
  reliability score (width-error correlation 0.03).
- **Cost.**
  - predict with 1,000 sims per order is about 1-4 s.
  - Anchor mode adds 1-4 evaluations of 300 sims per order, 1.7 on average.
  - The interval adds 200 feature-LR evaluations, about 0.5 s.
- **Selection optimism.** The anchor mix was picked among 4 on a third of the same fights (train years). The pool
  weight and the recalibration scheme were picked by cross-fitting; the stacker by LOYO.

## Files

| file | what |
|---|---|
| `src/ml/blend.js` | FightBlend: package, rescale/pool, anchor solver, nnLogit / fitTemp, profile bootstrap, interval |
| `src/engine3.js` | the marked blend_anchor block: `predict`, `loadBlend` |
| `src/params3.js` | `components.blend_anchor`, `blend` settings with sources |
| `tools/blend_anchor_prep.py` | 2019-2023 OOF expert extraction from the MoE cache -> `data/derived/blend_anchor_dev.json` |
| `tools/blend_anchor_bt.js` | simulator runs (plain / anchor / pilot), both orders, CRN, leak-free inputs |
| `tools/blend_anchor_eval.js` | cross-fitting, recalibration CV, pool weight, interval checks, metrics, bootstrap CIs -> `data/derived/blend_anchor.json` |
| `tests/test_blend_anchor.js` | 61 checks: flag-off = engine without the block (bit-for-bit), symmetry, rescale, pool, anchor, stacker, bootstrap |
