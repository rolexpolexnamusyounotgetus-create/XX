# Component: dynamics (roadmap v6 fight dynamics), `params.components.dynamics`

Nov 6, 2026. Worktree `/home/user/XX/.claude/worktrees/wf_0113c02d-461-2`, branch `comp/dynamics` (local, not pushed).

**Recipe.** `research/model_dynamics.md` section 8 (E1-E11), as corrected by its verifier (see its verification log and
the CORRECTION note in `docs/BACKLOG.md`):
- acceptance targets come from the train window;
- `form.vol` is at most 0.5;
- knockdown momentum is matched to the skip-round contrast: the scorer x0.92 and the dropped man x0.95, not x1.05.

**Data window.** Every fitted value and every number below comes from 2019-01-01..2023-12-31 only. No fight from 2024 or
later was simulated or scored, and no 2026 fight was read. The runners refuse dates from 2024-01-01 unless
`DYN_ALLOW_VALIDATION=1` is set, which is reserved for the single v5 measurement. They hard-stop at 2026-01-01.

**History.** Three builders worked on this component:
1. The first built the engine part on an in-flight v4.0.0-dev engine and started calibration, then hit the usage cap.
2. The second re-applied the component to the frozen engine v4.0.1 with the corrected recipe (pass 1). It then added a
   takedown round curve, re-based the pace curves and re-fit the levels (pass 2), and was interrupted before finishing the
   checks and the report.
3. This run checked pass 2 against the committed code: `HEAD` reproduces the pass-2 ablation bit for bit on 15 fights x
   2 configs. It then ran the train acceptance check, a sensitivity variant and the tests, ported the patch to v4.0.0,
   wrote the patches and this report.

## Verdict

**Recommendation: include in v5 with the flag on, as a structure and realism component that is neutral for prediction on
train. A joint level pass with durability is required after the merge.**

**Prediction (paired, 1,999 train fights, 211 events).**
- No outcome metric moves significantly:
  - winner log loss -0.0013 [-0.0057, +0.0034];
  - soft-label cross-entropy against the closing line -0.0006 [-0.0019, +0.0008];
  - 7-bin -0.0061 [-0.0169, +0.0048];
  - method +0.0029 [-0.0041, +0.0094];
  - method x round +0.0029 [-0.0092, +0.0149].
- Total stat-line deviance is flat (-0.08 [-1.17, +1.02]).
- Knockdown deviance improves significantly: -0.076 [-0.104, -0.052].
- Submission-attempt deviance gets slightly worse: +0.032 [+0.009, +0.053].

**Structure, where it clearly helps.**
- Round-to-round persistence of output:
  - own-output correlation R1-R2: 0.540 vs 0.570 real (flag off 0.462);
  - dynamic-RE AR(1): 0.49 vs 0.63 real (flag off 0.01);
  - accuracy AR(1): 0.61 vs 0.70 real (flag off 0.35).
- Knockdown risk per head strike by round, 3 rounds: 1.45 / 0.71 / 0.41 vs real 1.51 / 0.73 / 0.45 (flag off 1.35 / 0.87 /
  0.67).
- KD frailty: 1.40 vs 1.49 real (flag off 1.60).
- Rising takedown and control shapes by round.
- The skip-round knockdown-momentum contrast: the scorer's next round is -0.056 vs -0.048 real (flag off +0.002).
- The 5-round finish timing, the v4 known gap:

  | 5-round fights, finish share by round | R1 | R2 | R3 | R4 | R5 | sum of absolute errors |
  |---|---|---|---|---|---|---|
  | real | 17.3% | 16.5% | 9.5% | 5.3% | 4.9% | |
  | flag off | 14.7% | 12.6% | 10.3% | 9.1% | 5.4% | 11.6 pts |
  | flag on | 19.7% | 15.5% | 9.4% | 8.0% | 4.7% | 6.4 pts |

**Acceptance targets.**
- Hit:
  - round-to-round output correlation about 0.53 (realised 0.540; corrected train target 0.570);
  - knockdown round profile;
  - KD frailty about 1.5;
  - knockdown momentum contrast;
  - KD-to-finish conversion 0.511 vs 0.512.
- Not hit:
  - Fight-level output spread: sd 0.56 vs 0.44 on train. The original task said about 0.50; flag off gives 0.51.
  - The split between shared and individual output: fighters' correlation 0.63 vs 0.85.
  - Neither could be closed without losing persistence or prediction (sensitivity runs below).
- Partly hit, the 5-round KO rate by round (strikes-only definition of `tools/dynamics.py`):

  | 5-round fights, strikes-only KO rate | R1 | R2 | R3 | R4 | R5 | sum of squared errors |
  |---|---|---|---|---|---|---|
  | real | 0.105 | 0.152 | 0.074 | 0.043 | 0.080 | |
  | flag off | 0.099 | 0.097 | 0.072 | 0.077 | 0.072 | 0.0043 |
  | flag on | 0.144 | 0.137 | 0.093 | 0.066 | 0.071 | 0.0027 |

  Round 1 is over-predicted, about 2 SE on 247 real rounds.

**Base-version note.** The component was built and calibrated on v4.0.1, the version this workflow asked for.
- At about 19:15 UTC v4.0.1 was rejected on validation, and the main checkout's `src/` is v4.0.0 again.
- A v4.0.0 port patch is included. It applies cleanly, and the flag-off bit-for-bit test passes there.
- The `[dyncal]` levels must be re-run on whichever base v5 uses.

## Commits, base and patches

| Item | Value |
|---|---|
| Worktree start commit | `853ce32a40216ecdc9ac8daa35de006932ae6665` ("WIP autosave"; its `src/engine3.js` was a half-written in-flight v4) |
| **Base of the component patch** | **engine v4.0.1** = `versions/v4.0.1/engine3.js` and `params3.js` in the main checkout. In this worktree that is commit `db8760f569e272a18db5667b19ee16fcc3a33f7c`, whose `src/engine3.js` and `src/params3.js` equal `versions/v4.0.1` byte for byte. It is `396b9ab` (sync of v4.0.1 plus director/tests from main) plus the verified research sync (tools/dynamics.py, dynamics.json, model_dynamics.md, BACKLOG). Neither is part of the component |
| Component commits | `ba2afeb5` (pass 1: re-applied on v4.0.1, corrected recipe, re-frozen fixture, levels), `9a59f082` (pass 2 WIP: takedown round curve, re-based pace curves, re-fit levels; the code measured in this report), `a3644196` (final: comment-only update of the E2 block with the realised acceptance values) |
| Branch head | `comp/dynamics` = `a364419666173fb3541c1de46348ac6975f19d71` |
| Earlier history on the branch (superseded) | `325da4d`, `1abd743`, `9cd0caf`, `47e3dc7`: the first builder, on v4.0.0-dev |

**Patches.**
- **`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/dynamics.patch`**: the component
  against v4.0.1.
  - Contents:
    - `src/engine3.js` and `src/params3.js`, as `git diff db8760f HEAD`;
    - the new files `tests/test_dynamics.js`, `tests/fixtures/engine3_pre_dynamics.js` (= v4.0.1 engine), `tools/dynamics_bt.js`,
      `tools/dynamics_calibrate.js`, `tools/dynamics_ablation.py` and `tools/dynamics_check_train.py`, as `git diff 853ce32 HEAD`;
    - an append to the main checkout's current `tools/README.md`.
  - Verified: `git apply` on a copy of `versions/v4.0.1` plus main's `tools/README.md` reproduces every component file of
    `HEAD` byte for byte.
- `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/dynamics_v4.0.0_port.patch`: the
  same component on engine v4.0.0 (`versions/v4`, the main checkout's `src/` now).
  - The engine and params hunks applied to v4.0.0 with offsets and one fuzz-2 hunk, then were re-diffed. The fixture is
    v4.0.0's engine.
  - `git apply --check` is clean on a v4.0.0 copy, and `tests/test_dynamics.js --quick` passes 21/21 there, flag-off
    bit-for-bit included.
  - The `[dyncal]` levels in it are the v4.0.1 fit. Re-run `tools/dynamics_calibrate.js`: v4.0.0 has no
    `mlTdLevel`/`mlCtrlLevel`/`mlSubLevel`, so its flag-off volume differs.
- `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/dynamics_from_worktree_start.patch`:
  `git diff 853ce32..comp/dynamics` (the literal "diff against the commit the worktree started from"). It includes the base
  syncs to v4.0.1 and the research sync, so do not apply it as the component.

**Re-applying on another engine.**
1. Run `cp src/engine3.js tests/fixtures/engine3_pre_dynamics.js` (the bit-for-bit test compares flag off with that frozen copy).
2. Apply the patch without its fixture hunk.
3. Re-run `node tools/dynamics_calibrate.js --iters 5 --sims 16 --stride 2` and write the `[dyncal]` levels.

The component is self-contained. In `src/engine3.js` it is a `dynOn(p)` switch, `dynTables()` called at the end of
`matchupBase`, and `DY ? <dynamics> : <v4.0.1 code>` branches in `fighterRates`, `matchupBase`, `simulate()` and
`explain()`. In `src/params3.js` it is `components: { dynamics: true }` and a `dyn` block.

## What changed

### `src/engine3.js`

The API, the trace format and the fight object are unchanged. With the flag off, the engine is v4.0.1 bit for bit.

- **`dynOn(p)`.** The component is on when `p.components.dynamics` is true and `p.dyn` exists. Params without the block
  run the old engine.
- **`fighterRates` (flag on).** The per-round pace-ratio prior strength is `dyn.kPace` 45 instead of `kPace` 15 (E10). The
  same `rho` feeds the cardio index and, through it, stamina drain.
- **`matchupBase` (flag on).**
  - The profile accuracy shifts are attenuated (`accProfA` 0.61, `accProfB` 0.50). This only acts on the base-table path:
    the learned-rate adapter re-targets accuracy to its own predictions.
  - It builds `m.dyn = dynTables(...)`, which also sets `m.k.outStam = dyn.outStam` (0.05).
- **`simulate()`, fight-level draws (flag on, `DY = m.dyn`).** The shared pace, the shared knockdown volatility and the
  individual output and accuracy form sds come from `dyn`. The draws and their order are the same.
- **`simulate()`, each round start (flag on).**
  - The two iid round-output normals of v4.0.1 become AR(1) innovations of each man's output noise. Two more normals
    drive an AR(1) on accuracy (logit).
  - Output = pace table x shared pace x round pace x exp(AR - sd^2/2) x knockdown momentum.
  - Accuracy odds = fight form x exp(AR) x `accLevel` x knockdown momentum.
  - Grappling carry-over (E6): distance output and takedown attempts are scaled by the opponent's control minutes, own
    takedowns landed and own control minutes from earlier rounds.
  - Takedown attempts also take x `tdLevel` x `tdR[r]`, the takedown round curve added in pass 2.
- **`simulate()`, finishes (flag on).**
  - Knockdown chance per landed standing strike: `kdB x kdPos x chinM x (hurt ? kdHurt) x kdP[r] x mobility`, with
    `kdP[r] = kdRound_R[r] x kdLevel_R`.
    - Dropped: the damage (`kdDmg`), defender-stamina (`kdStamDef`), attacker-stamina (`kdStamAtt`) and pace
      (`kdPaceExp`) terms, and the 5-round caution `finR` on knockdowns (E7/E11).
    - Body knockdowns keep their ratio and lose the stamina term.
  - Instant KO and follow-up referee stop: odds x `conv[r] = convLevel x exp(convRound r)`, replacing the damage and
    stamina terms (E8).
  - Standing TKO while hurt: `stko x (stkoBase + D/100) x stkoScale x exp(noKdRound r)` (E9).
  - Ground TKO: `gnp x pos x (1 + D/gnpDmg) x hurt x chinM x finR x gnpScale x exp(noKdRound r)`, with the stamina term
    dropped (E9).
- **`simulate()`, between rounds (flag on).**
  - Knockdown momentum, for the next round only (E4).
  - An optional knob, default off (E5): accuracy odds x `lostAcc` after a round lost on the majority of cards.
- **`explain()` (flag on).** It prints the dynamics pace table and the knockdown-by-round table.

### `src/params3.js`

`components: { dynamics: true }` and the `dyn` block. Every entry carries its meaning and source; values are in the
parameter table below.

### Tests and tools

- `tests/test_dynamics.js` (21 checks; see Tests) and the frozen v4.0.1 engine `tests/fixtures/engine3_pre_dynamics.js`.
- `tools/dynamics_bt.js`: the paired runner with common random numbers.
  - Seed = md5(fight id : orientation), both corner orders.
  - Leak-free inputs: frozen pre-fight profiles from `backtest_dev.json`, walk-forward priors from
    `mlcal_priors_asof.json`, and out-of-fold learned rates from `mlrates_oof.json`.
- `tools/dynamics_calibrate.js`: the level fit.
- `tools/dynamics_ablation.py`: the scorer (paired event-cluster bootstrap, 2,000 resamples).
- `tools/dynamics_check_train.py`: `tools/dynamics.py`'s `engine_check(real_period="train")` on 2019-2023 rows only.
- A section in `tools/README.md`.

## Equations (flag on)

Round r = 0..R-1 (R = 3 or 5). i attacks, j defends. z ~ N(0,1), fresh per use.

```
output multiplier   po[i][r] = pace[i][r] x sharedPace x roundPace_r x exp(e[i][r] - arSd^2/2) x momOut[i][r]
  pace[i][r]        = curve_R[r] / mean(curve_R[0..2]) x q[i][r] / mean(q[i][0..2]) x outLevel
  q[i][r]           = rel_i[r] x rel_j[r]^paceMutual,   rel_i[r] = rho_i[r] / mean(rho_i[0..2])
  rho_i[r]          = (ratio_i[r] x w_i[r] + kPace) / (w_i[r] + kPace)   (landed-per-minute late-round ratio, w minutes)
  e[i][0] = arSd z,   e[i][r] = arPhi e[i][r-1] + arSd sqrt(1 - arPhi^2) z
  sharedPace ~ LN(formPace), fOut[i] ~ LN(formOut), roundPace_r ~ LN(roundPace)     (mean-1 lognormals)
accuracy odds       x fAcc[i] x exp(a[i][r]) x accLevel x momAcc[i][r];  fAcc = exp(formAcc z);  a = AR(1)(accArSd, accArPhi)
fatigue on output   x (1 - outStam (1 - S))                                (outStam 0.05; v4.0.1 0.12)
knockdown momentum  after a round in which i scored >= 1 KD (next round only):
                    po[i] x 0.92, acc odds[i] x 0.94, TD attempts[i] x 0.88;  po[j] x 0.95, TD attempts[j] x 1.12
takedown attempts   rate[i][r] x exp(-0.104 octrl_i - 0.063 tdl_i + 0 x ctrl_i) x momTd[i][r] x tdLevel x tdR[r]
                    tdR[r] = tdRound_R[r] / mean(tdRound_R[0..2])
distance output     x exp(-0.013 octrl_i)
                    (octrl = minutes controlled by the opponent, tdl = own takedowns landed, ctrl = own control minutes;
                     all from earlier rounds)
knockdown           P(KD | landed standing head strike) = kd_ij x fPow_i x fChin_j x vol x kdPos x chinM_j x (hurt ? kdHurt : 1)
                                                          x kdRound_R[r] x kdLevel_R x (0.75 + 0.25 mobility_i)
conversion          instant-KO odds and follow-up stop odds x convLevel x exp(convRound r)
non-KD stoppage     standing, while hurt: stko_ij x pcF x chinM x (stkoBase + D/100) x stkoScale x exp(noKdRound r)
                    ground: gnp_ij x pcF x gnpTkoPos x (1 + D/gnpDmg) x (hurt ? gnpHurt) x chinM x finR x gnpScale x exp(noKdRound r)
```

## Parameters (flag on), with sources

RM = `research/model_dynamics.md`: section 2.4 is the dynamic random-effects decomposition, and E1-E11 are in section 8.
Every recipe number was fit on 2019-2023 ufcstats rounds. The `[dyncal v4.0.1]` values are level factors fit by
`tools/dynamics_calibrate.js` on 2019-2023 backtest fights with out-of-fold learned rates.

| Parameter | Value | v4.0.1 | Source / how set |
|---|---|---|---|
| `pace3` | [1, 1.16, 1.34] | division curve | E1. Starts from the recipe's distance curve [1, 1.15, 1.26]: output per minute of position rises more than per round-minute, because control rises by round. Scaled by target / realised so the realised sig attempts per round-minute match the train shape [1, 1.083, 1.141]: the recipe curve realised [1, 1.072, 1.072], because survivor selection is stronger with persistent output. Realised now: structural [1, 1.101, 1.170] vs real [1, 1.074, 1.132]; raw rates 8.23 / 8.89 / 9.34 vs real 8.12 / 8.79 / 9.26 per minute |
| `pace5` | [1, 1.28, 1.30, 1.42, 1.52] | division curve | E1, same method, damped (target [1, 1.176, 1.130, 1.187, 1.185]). Realised raw 8.11 / 9.48 / 9.20 / 9.43 / 9.26 vs real 7.68 / 9.03 / 8.68 / 9.12 / 9.10 |
| `outStam` | 0.05 | 0.12 | E1/E3: own earlier output costs at most -4.5% per 100 attempts |
| `formPace` | 0.45 | 0.329 | E2. Random-effects shared pace 0.37 (corrected recipe about 0.40); raised because the engine's other noise attenuates the realised fighters' correlation |
| `formOut` | 0.21 | 0.357 | E2 recipe 0.20 (corrected 0.18-0.20) |
| `arSd`, `arPhi` | 0.32, 0.85 | iid `roundOut` 0.15 | E2: random-effects estimate 0.31 / 0.68. 0.85 is an input: the realised AR(1) is 0.49, below the train 0.63 and inside the corrected "do not exceed 0.68 realised" |
| `roundPace` | 0.10 | 0.10 | E2: kept |
| `formAcc` | 0.43 | 0.478 | E2 recipe 0.28-0.30. **Deviation:** the wider value is kept for prediction. The narrow 0.31 with `formOut` 0 scored worse on method x round in pass 1 (sensitivity below) |
| `accArSd`, `accArPhi` | 0.28, 0.73 | none | E2: random-effects estimate 0.244 / 0.727; sd raised so the realised round accuracy noise matches (0.224 vs 0.239 real) |
| `accProfA`, `accProfB` | 0.61, 0.50 | 1, 1 | RM 2.4 profile coefficients; base-table path only |
| `vol` | 0.50 | 0.6 | E7 corrected: at most 0.5 (real train KD frailty 1.49; realised 1.40) |
| `momScorerOut`, `momScorerAcc`, `momScorerTd` | 0.92, 0.94, 0.88 | none | E4 corrected: skip-round contrast (scorer -5.9%, SE 4.8%) |
| `momDroppedOut`, `momDroppedTd` | **0.95**, 1.12 | none | E4 corrected: x0.95, not x1.05. The takedown term keeps the random-effects value; there is no skip-round contrast for takedowns |
| `lostAcc` | 1 (off) | none | E5 knob. The data say x0.92 (-0.079 logit, SE 0.015); it may be form information rather than a choice |
| `tdCtrlOpp`, `tdTdl`, `tdCtrlOwn` | -0.104, -0.063, 0 | none | E6. The own-control term is off (style persistence) |
| `distCtrlOpp` | -0.013 | none | E6 |
| `tdRound3`, `tdRound5` | [1, 1.17, 1.58], [1, 1.20, 1.38, 1.65, 1.95] | none | **Pass 2 addition (an E6 companion).** E6's carry-over coefficients are conditional effects inside a model with round cells. Alone, they made the engine's takedown attempts fall by round (pass 1: 4.01 / 3.68 / 3.41 per 15) while real attempts rise (3.58 / 3.75 / 4.30). Inputs = target shape / realised shape, two fixed-point steps on train matchups. Realised now: 3.52 / 3.61 / 4.06 (3 rounds) and 2.97 / 3.20 / 3.35 / 3.59 / 3.80 vs real 2.64 / 2.76 / 3.41 / 3.28 / 3.62 (5 rounds). Control: 0.179 / 0.183 / 0.205 vs real 0.184 / 0.199 / 0.205 (flag off flat 0.188 / 0.190 / 0.191) |
| `kdRound3` | [1.50, 0.85, 0.56] | stamina / pace / damage terms | E7: [1, .57, .37] with frailty (train), exposure-weighted mean 1 |
| `kdRound5` | [1.445, 1.27, 0.737, 0.535, 0.535] | same + caution5 | E7: the **train-only** frailty fit [1, .88, .51, .37, .37], R4-5 pooled. The recipe's [1, .65, .405, .29, .29] is a 2010-2023 fit, outside the tuning window |
| `kdLevel3`, `kdLevel5` | 0.655, 0.559 | (kdScale x caution) | [dyncal v4.0.1]: knockdowns per fight-minute of all 2019-2023 fights by format (3 rounds 0.611 per 15 min, 5 rounds 0.500) |
| `convLevel`, `convRound` | 1.045, -0.155 | damage / stamina terms | E8: per-knockdown conversion 0.512 (train); odds -15% per round (SE 0.077). The level is [dyncal] |
| `stkoBase`, `gnpDmg`, `noKdRound` | 0.9, 100, -0.17 | 0.3, 600, none | E9 |
| `stkoScale`, `gnpScale` | 0.733, 0.481 | 1, 1 | [dyncal]: one joint factor, so the KO/TKO share equals the flag-off engine's (v4.0.1 matched it to train) |
| `kPace`, `paceMutual` | 45, 0.4 | 15, 0 | E10 (verified 30-45; mutual 0.39 on train) |
| `outLevel`, `accLevel`, `tdLevel` | 1.039, 0.998, 1.126 | 1 | [dyncal]: equal volume, accuracy and takedown attempts to the flag-off engine on the same fights and seeds, so the ablation measures structure rather than level |

### Calibration

Calibration is on train: `tools/dynamics_calibrate.js --iters 5 --sims 16 --stride 2`, 1,000 fights x 2 orders x 16 sims.
The log is `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/dyn/cal10.log`.
- The levels in params are one damped update step past iteration 4.
- The table shows iteration 4 (the last measured).
- The full-set check (1,999 fights x 200 sims, ablation run `abl402`) confirms the final values:
  - KD per 15: 0.592 vs 0.590 real;
  - KO/TKO share: 0.3199, equal to flag off;
  - knockdown conversion: 0.511 vs 0.512;
  - sig attempts per 15: +0.46% vs flag off;
  - control per 15: +0.2% vs flag off.

| Statistic (cal10, iteration 4) | flag off | flag on | target |
|---|---|---|---|
| Sig attempts per fighter-minute | 8.797 | 8.820 | 8.797 (flag off) |
| Sig accuracy | 0.4694 | 0.4711 | 0.4694 (flag off) |
| TD attempts per fighter-minute | 0.2387 | 0.2385 | 0.2387 (flag off) |
| KD per 15 min, 3 rounds | 0.660 | 0.618 | 0.611 (real, all train fights) |
| KD per 15 min, 5 rounds | 0.386 | 0.500 | 0.500 (real) |
| KD -> finish per knockdown | 0.475 | 0.507 | 0.512 (data) |
| KO/TKO share | 0.320 | 0.321 | 0.320 (flag off) |
| KD per 100 standing head by round, 3 rounds | 1.34 / 0.84 / 0.65 | 1.45 / 0.71 / 0.43 | real 1.47 / 0.74 / 0.44 |
| KD per 100 standing head by round, 5 rounds | 0.76 / 0.58 / 0.50 / 0.38 / 0.39 | 1.22 / 0.88 / 0.55 / 0.26 / 0.29 | real 1.22 / 1.01 / 0.54 / 0.28 / 0.42 |

## Train acceptance

Method: `tools/dynamics.py` estimators on the engine CSVs of run `abl402` (8 sims x 2 orders per fight) against real
2019-2023 rounds of the same matchups. `on_v` is the sensitivity variant (`formOut` 0.12, `formPace` 0.43), not shipped.

| Train acceptance (dynamics.py estimators, same matchups) | real | off | on | on_v |
|---|---|---|---|---|
| output: sd fighter-fight | 0.444 | 0.513 | 0.561 | 0.530 |
| output: corr between fighters | 0.845 | 0.498 | 0.634 | 0.673 |
| output: sd round shared | 0.334 | 0.378 | 0.391 | 0.396 |
| output: sd round own | 0.284 | 0.232 | 0.254 | 0.244 |
| output: AR(1) own | 0.630 | 0.012 | 0.492 | 0.469 |
| accuracy: sd fighter-fight | 0.341 | 0.441 | 0.407 | 0.409 |
| accuracy: sd round own | 0.239 | 0.078 | 0.224 | 0.218 |
| accuracy: AR(1) own | 0.698 | 0.348 | 0.613 | 0.640 |
| raw own-output corr R1-R2 | 0.570 | 0.462 | 0.540 | 0.514 |
| raw own-output corr R1-R3 | 0.474 | 0.463 | 0.510 | 0.496 |
| raw fighters' corr same round | 0.656 | 0.539 | 0.592 | 0.623 |
| KD frailty (cells only) | 1.49 | 1.60 | 1.40 | 1.30 |
| output curve 3 rounds (structural) | 1 / 1.074 / 1.132 | 1 / 1.062 / 1.082 | 1 / 1.101 / 1.170 | 1 / 1.106 / 1.187 |
| P(round ends KO/TKO by strikes), 3 rounds | 0.158 / 0.129 / 0.070 | 0.165 / 0.112 / 0.095 | 0.169 / 0.102 / 0.078 | 0.164 / 0.108 / 0.076 |
| KD per 100 standing head, 3 rounds | 1.51 / 0.73 / 0.45 | 1.35 / 0.87 / 0.67 | 1.45 / 0.71 / 0.41 | 1.41 / 0.71 / 0.40 |
| output curve 5 rounds (structural) | 1 / 1.150 / 1.129 / 1.150 / 1.109 | 1 / 1.121 / 1.128 / 1.142 / 1.131 | 1 / 1.176 / 1.176 / 1.258 / 1.256 | 1 / 1.167 / 1.169 / 1.252 / 1.236 |
| P(round ends KO/TKO by strikes), 5 rounds | 0.105 / 0.152 / 0.074 / 0.043 / 0.080 | 0.099 / 0.097 / 0.072 / 0.077 / 0.072 | 0.144 / 0.137 / 0.093 / 0.066 / 0.071 | 0.166 / 0.146 / 0.085 / 0.066 / 0.056 |
| KD per 100 standing head, 5 rounds | 1.22 / 1.01 / 0.54 / 0.28 / 0.42 | 0.73 / 0.64 / 0.45 / 0.47 / 0.42 | 1.24 / 0.94 / 0.52 / 0.36 / 0.25 | 1.33 / 0.96 / 0.53 / 0.31 / 0.37 |
| KD momentum, scorer: KD round vs round before (log output) | +0.145 (0.067) | +0.213 (0.023) | +0.243 (0.025) | +0.252 (0.025) |
| KD momentum, scorer: next round vs round before | -0.048 (0.082) | +0.002 (0.027) | -0.056 (0.031) | -0.049 (0.030) |
| KD momentum, dropped: KD round vs round before | -0.070 (0.076) | -0.032 (0.026) | +0.017 (0.029) | +0.052 (0.030) |
| KD momentum, dropped: next round vs round before | +0.007 (0.084) | -0.028 (0.027) | -0.020 (0.030) | +0.018 (0.031) |
| late-round ratio total var | 0.424 | 0.509 | 0.510 | 0.505 |

How to read it:

- **Output spread.** With the flag on, the fight-level output spread is too wide (0.56 vs 0.44) and too individual
  (corr 0.63 vs 0.85).
  - The individual fight-level variance is about 0.115 vs 0.031 real. Most of it is AR(1) persistence, which the
    estimator assigns to the fighter-fight effect (it recovers phi 0.49 from the 0.85 input).
  - Cutting `formOut` from 0.21 to 0.12 and `formPace` to 0.43 (`on_v`) moves spread and correlation a third of the way.
    It costs persistence (R1-R2 corr 0.514) and does not score better (sensitivity below).
- **Knockdown round.** The dropped man's dip inside the knockdown round (-7% real) is not reproduced (+2%). E4 says it
  belongs in the within-round hurt logic, which this component does not change.
- **Late-round KO in 5-round fights.** Part of the remaining excess is not knockouts by strikes but between-round
  doctor and corner stoppages. The flag-independent engine part gives 2.4% after R3 and 4.5% after R4. Real 2019-2023
  5-round fights have 1.2% (2 of 162) and 0.7% (1 of 139), so the engine runs about 3x real over R3-R4 combined. The
  ablation's KO hazard counts them (`KO_M` includes DOC/CORNER), so 5-round R4 there is 0.104 (on) / 0.114 (off) vs 0.058
  real.

## Train-only ablation (flag on vs flag off)

Run `abl402` covers the 1,999 `backtest_dev` fights dated 2019-01-01..2023-12-31, in 211 events.
- Both corner orders, with common random numbers: the seed depends only on fight id and orientation.
- 100 sims per order, so 200 per fight, per configuration.
- Leak-free inputs: frozen profiles, walk-forward priors, and out-of-fold learned rates from `mlrates_oof.json`.
- CIs are paired event-cluster bootstrap, 2,000 resamples, percentile 95%. Every metric is symmetric and nothing is fit
  in the scorer.
- `HEAD` reproduces this run bit for bit (checked on 15 fights x 2 configs).

| Metric (per fight) | n | off | on | on - off | 95% CI |
|---|---|---|---|---|---|
| Winner log loss | 1955 | 0.6672 | 0.6659 | -0.0013 | [-0.0057, +0.0034] |
| Soft-label CE vs closing line (`p_power_close`) | 1975 | 0.6728 | 0.6722 | -0.0006 | [-0.0019, +0.0008] |
| 7-bin log loss | 1972 | 1.6643 | 1.6582 | -0.0061 | [-0.0169, +0.0048] |
| Method log loss (KO/SUB/DEC) | 1972 | 0.9662 | 0.9692 | +0.0029 | [-0.0041, +0.0094] |
| Method x round log loss | 1972 | 1.5055 | 1.5084 | +0.0029 | [-0.0092, +0.0149] |
| Stat-line deviance (sum of 9 counts) | 1975 | 115.877 | 115.802 | -0.075 | [-1.166, +1.021] |
|   sig attempts | 1975 | 41.436 | 41.313 | -0.123 | [-0.680, +0.448] |
|   sig landed | 1975 | 22.908 | 22.949 | +0.042 | [-0.246, +0.327] |
|   head landed | 1975 | 21.492 | 21.463 | -0.029 | [-0.255, +0.195] |
|   body landed | 1975 | 8.781 | 8.834 | +0.053 | [-0.030, +0.131] |
|   leg landed | 1975 | 9.737 | 9.750 | +0.013 | [-0.061, +0.089] |
|   knockdowns | 1975 | 1.897 | 1.820 | **-0.076** | **[-0.104, -0.052]** |
|   takedown attempts | 1975 | 4.701 | 4.707 | +0.006 | [-0.026, +0.035] |
|   takedowns landed | 1975 | 2.952 | 2.959 | +0.007 | [-0.011, +0.024] |
|   submission attempts | 1975 | 1.974 | 2.006 | **+0.032** | **[+0.009, +0.053]** |
|   control minutes (quasi-Poisson, not in the sum) | 1975 | 3.870 | 3.851 | -0.019 | [-0.048, +0.010] |

**Finish timing.** Unconditional share of fights finished in each round, all methods (KO/TKO incl. doctor/corner, and
submissions):

| | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 3 rounds, real (1,729 fights) | 24.4% | 16.7% | 7.5% | | |
| 3 rounds, flag off | 25.3% | 14.5% | 9.1% | | |
| 3 rounds, flag on | 25.6% | 13.8% | 9.1% | | |
| 5 rounds, real (243 fights) | 17.3% | 16.5% | 9.5% | 5.3% | 4.9% |
| 5 rounds, flag off | 14.7% | 12.6% | 10.3% | 9.1% | 5.4% |
| 5 rounds, flag on | 19.7% | 15.5% | 9.4% | 8.0% | 4.7% |

KO/TKO only, 3 rounds: real 16.1 / 10.3 / 4.2, off 16.6 / 9.1 / 5.4, on 17.2 / 8.4 / 4.8. In 5 rounds: real 11.9 / 13.6 /
6.2 / 3.3 / 4.5, off 10.2 / 9.2 / 7.6 / 7.1 / 3.8, on 15.5 / 12.0 / 6.8 / 5.8 / 2.9.

### Base-rate table

| Base rate (2019-2023 backtest fights) | real | off | on | off - real, 95% CI | on - real, 95% CI | on - off, 95% CI |
|---|---|---|---|---|---|---|
| P(KO/TKO) | 0.3174 | 0.3199 | 0.3199 | [-0.0168, +0.0217] | [-0.0170, +0.0221] | [-0.0022, +0.0022] |
| P(SUB) | 0.1749 | 0.1739 | 0.1760 | [-0.0183, +0.0155] | [-0.0168, +0.0180] | [+0.0003, +0.0041] |
| P(decision) | 0.5076 | 0.5062 | 0.5041 | [-0.0246, +0.0201] | [-0.0263, +0.0179] | [-0.0045, +0.0000] |
| 3rd R1 KO hazard | 0.1614 | 0.1659 | 0.1723 | [-0.0130, +0.0214] | [-0.0063, +0.0279] | [+0.0047, +0.0080] |
| 3rd R1 SUB hazard | 0.0827 | 0.0874 | 0.0835 | [-0.0085, +0.0180] | [-0.0119, +0.0140] | [-0.0052, -0.0025] |
| 3rd R2 KO hazard | 0.1362 | 0.1224 | 0.1129 | [-0.0318, +0.0029] | [-0.0416, -0.0063] | [-0.0113, -0.0076] |
| 3rd R2 SUB hazard | 0.0849 | 0.0721 | 0.0725 | [-0.0286, +0.0020] | [-0.0280, +0.0023] | [-0.0011, +0.0020] |
| 3rd R3 KO hazard | 0.0717 | 0.0906 | 0.0793 | [+0.0024, +0.0342] | [-0.0087, +0.0229] | [-0.0129, -0.0097] |
| 3rd R3 SUB hazard | 0.0560 | 0.0614 | 0.0712 | [-0.0093, +0.0192] | [+0.0004, +0.0292] | [+0.0084, +0.0113] |
| 5rd R1 KO hazard | 0.1193 | 0.1021 | 0.1553 | [-0.0604, +0.0214] | [-0.0073, +0.0755] | [+0.0481, +0.0584] |
| 5rd R1 SUB hazard | 0.0535 | 0.0449 | 0.0418 | [-0.0375, +0.0171] | [-0.0403, +0.0138] | [-0.0056, -0.0009] |
| 5rd R2 KO hazard | 0.1642 | 0.1073 | 0.1498 | [-0.1089, -0.0044] | [-0.0666, +0.0383] | [+0.0373, +0.0477] |
| 5rd R2 SUB hazard | 0.0348 | 0.0406 | 0.0438 | [-0.0197, +0.0287] | [-0.0171, +0.0320] | [+0.0005, +0.0059] |
| 5rd R3 KO hazard | 0.0932 | 0.1041 | 0.1053 | [-0.0377, +0.0532] | [-0.0365, +0.0544] | [-0.0036, +0.0059] |
| 5rd R3 SUB hazard | 0.0497 | 0.0376 | 0.0394 | [-0.0490, +0.0178] | [-0.0474, +0.0199] | [-0.0008, +0.0047] |
| 5rd R4 KO hazard | 0.0580 | 0.1136 | 0.1043 | [+0.0136, +0.0912] | [+0.0054, +0.0823] | [-0.0145, -0.0041] |
| 5rd R4 SUB hazard | 0.0362 | 0.0319 | 0.0410 | [-0.0399, +0.0245] | [-0.0306, +0.0334] | [+0.0061, +0.0123] |
| 5rd R5 KO hazard | 0.0880 | 0.0710 | 0.0612 | [-0.0668, +0.0299] | [-0.0768, +0.0191] | [-0.0144, -0.0054] |
| 5rd R5 SUB hazard | 0.0080 | 0.0312 | 0.0376 | [+0.0036, +0.0334] | [+0.0108, +0.0404] | [+0.0032, +0.0097] |
| minutes per fight | 11.34 | 11.34 | 11.25 | [-0.28, +0.24] | [-0.37, +0.16] | [-0.12, -0.06] |
| sig landed per 15 (both) | 122.17 | 123.49 | 123.73 | [-1.91, +4.33] | [-1.69, +4.65] | [-0.17, +0.61] |
| sig attempts per 15 (both) | 261.99 | 262.47 | 263.67 | [-5.78, +6.54] | [-4.46, +7.77] | [+0.40, +1.95] |
| KD per 15 (both) | 0.590 | 0.609 | 0.592 | [-0.024, +0.061] | [-0.042, +0.044] | [-0.023, -0.012] |
| TD landed per 15 (both) | 2.610 | 2.613 | 2.615 | [-0.106, +0.113] | [-0.104, +0.116] | [-0.006, +0.010] |
| control seconds per 15 (both) | 326.3 | 327.1 | 327.8 | [-10.4, +11.9] | [-9.8, +12.5] | [-0.2, +1.6] |
| sub attempts per 15 (both) | 0.742 | 0.744 | 0.750 | [-0.056, +0.058] | [-0.050, +0.065] | [+0.001, +0.012] |

Hazard = P(round ends KO/TKO or SUB | round reached). KO/TKO includes doctor and corner stoppages here.

Finish mechanics (simulated):

| | flag off | flag on | train data |
|---|---|---|---|
| KD -> finish per knockdown | 0.471 | 0.511 | 0.512 |
| Standing TKO without KD, per standing head absorbed | 0.000290 | 0.000373 | 0.000452 |
| Ground TKO without KD, per ground strike | 0.00686 | 0.00552 | 0.00674 |

### Sensitivity runs (train, same seeds, paired)

**Pass 1 vs pass 2.** Pass 1 had the flatter pace curves and no takedown round curve (`abl401`, on vs off).
- Winner -0.0030 [-0.0079, +0.0020] and method +0.0023, both n.s.
- Takedown-attempt deviance was significantly worse: +0.030 [+0.005, +0.056].
- Realised takedown attempts and control fell by round, where real ones rise.
- The pass-2 takedown round curve removed that: +0.006 [-0.026, +0.035].

**Narrow individual forms** (`formOut` 0, `formAcc` 0.31, the real accuracy dispersion; pass 1). Against the shipped wide
values:
- winner +0.0019 n.s.;
- method +0.0055 [-0.0004, +0.0115];
- method x round **+0.0108 [+0.0001, +0.0214]**.

The individual form sds also carry the matchup model's prediction error, so narrowing them to "true" fight-night form
makes the engine overconfident.

**`on_v`** (`formOut` 0.12, `formPace` 0.43; this run, `abl403`), vs the shipped `on`. It moves the acceptance numbers a
third of the way (table above) but does not score better:

| Metric | on_v - on | 95% CI |
|---|---|---|
| Winner | -0.0021 | [-0.0063, +0.0025] |
| Soft CE vs close | +0.0004 | [-0.0009, +0.0016] |
| 7-bin | +0.0019 | [-0.0085, +0.0122] |
| Method | +0.0019 | [-0.0038, +0.0075] |
| Method x round | -0.0000 | [-0.0111, +0.0109] |
| Stat lines | +0.44 | [-0.50, +1.43] |
| Control deviance | **+0.037** | **[+0.010, +0.066]** |

`on_v` also raises sig attempts per 15 by 0.7% vs `on` (+1.2% vs flag off), so it would need a level re-fit. Not adopted.

### Volk vs Gaethje (the page matchup; 5 x 5, title, 40,000 fights)

| Path | Volk win, flag off | Volk win, flag on | Gaethje KO/TKO, off | Gaethje KO/TKO, on | Volk KO/TKO, off | Volk KO/TKO, on | goes the distance, off | goes the distance, on |
|---|---|---|---|---|---|---|---|---|
| Learned rates (default path) | 69.0% | 63.4% | 12.0% | 18.7% | 18.4% | 19.4% | 62% | 54% |
| Base tables | 61.0% | 53.7% | 17.0% | 24.5% | 14.9% | 14.3% | 62% | 55% |

KO/TKO by round, learned rates: off 7.5 / 6.8 / 6.3 / 5.5 / 4.2%, on 12.9 / 10.7 / 6.2 / 5.1 / 3.2%.

- The shift comes from the 5-round knockdown level. v4.0.1 under-produces knockdowns in 5-round fights: 0.39 per 15 vs
  0.50 real on train.
- Dynamics also front-loads the knockdown risk (E7). Both favour the bigger puncher, Gaethje.
- If v5 ships the component, the page copy that quotes engine numbers must be refreshed.
- The market comparison is for context only; it was not used for any choice. The no-vig openers (Oct 24-25) have Volk
  at about 37%.

## Tests

| Test | Result |
|---|---|
| `node tests/test_dynamics.js` | 21 passed, 0 failed |
| `node tests/test_engine3.js` (N 20,000) | 76 passed, 0 failed, with the flag on by default |
| `node tests/test_director3.js` | OK: every beat valid, states and stats match the engine, no repeated lines |
| v4.0.0 port, `node tests/test_dynamics.js --quick` | 21 passed, 0 failed (flag-off identity vs v4.0.0) |

`tests/test_engine3.js` includes the base-rate self-calibration table by division, symmetry and clones, knob
directions, trace format and the speed check.

Logs are in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/dyn/`, as `test_*_p3.log`.

The 21 checks in `tests/test_dynamics.js`:

- **Flag off = the pre-component engine, bit for bit.** The fixture is `versions/v4.0.1/engine3.js`, compared on
  2,600 traced and untraced fights over 13 matchups, plus summaries, with plain and with learned rates. A shared rng
  stream stays aligned.
- **Flag on, structure.**
  - It builds the tables, is deterministic, and gives the same fight with the trace on or off (300 seeds).
  - The fight object and trace format are unchanged across every event kind. The flag changes the simulation, and
    probabilities sum to 1.
- **Flag on, behaviour.**
  - AR(1) persistence: R1-R2 output correlation 0.72 vs 0.53 with phi 0.
  - Knockdowns by round follow `kdRound3`; a flat table removes the decline.
  - Knockdown momentum.
  - Grappling carry-over.
  - Takedown round curve: attempts rise from R1 to R3, and fall with a flat curve.
  - kPace 45 vs 15.
  - Mutual pace.
  - Stoppage and conversion decay by round.
  - Chin and output knob directions with the flag on.

**Speed.** `summarize(Volk vs Gaethje, 20000)` takes 1.73 s of CPU under the 6 s budget, measured with the machine at
load average 9-25. Flag on vs off timings are within the noise (1.6-2.0 s per 20,000 fights either way). The component
adds four normals and two exps per round per fighter.

## Risks and interactions with other components

**Base version.**
- The component was built, calibrated and measured on v4.0.1. That version was rejected on validation at about 19:15
  UTC, and the main checkout's `src/` is v4.0.0 again.
- BACKLOG and the durability notes treat v4.0.0 as the v5 base. The v4.0.0 port patch applies cleanly and passes the
  bit-for-bit test.
- On v4.0.0 the `[dyncal]` levels must be re-fit: no `mlTdLevel`/`mlCtrlLevel`/`mlSubLevel` and different judging, so the
  flag-off volume and takedown levels differ.
- The ablation numbers above are v4.0.1 numbers.

**Levels are relative to the base engine.**
- The `[dyncal]` factors (kdLevel3/5, convLevel, stkoScale/gnpScale, out/acc/tdLevel) were matched with everything else
  at v4.0.1's values.
- Any other component that moves the global knockdown, finish or volume level needs one joint level pass after the
  merge, never two separate knockdown scales. That covers:
  - durability's `kdCal` and its chin/power multipliers;
  - officials' referee stoppage tables;
  - styles_sos rate changes;
  - realism's ko/sub levers;
  - embedding blends in the learned rates.
- Dynamics' `kdLevel3/5` and durability's `kdCal` are both global knockdown scales. Durability's `kdCal` was matched
  with dynamics off.

**Durability.**
- Its per-fighter chin/power multipliers and Gamma frailty priors add between-fight knockdown heterogeneity on top of
  dynamics' `vol` 0.5 and the pow/chin form sds.
- Recheck the cells-only KD frailty (train real 1.49, dynamics alone 1.40) with both on. If it goes above about 1.6,
  lower `dyn.vol` first.
- Durability's age and KO-loss terms are pre-fight. Dynamics removes the in-fight damage term on knockdown risk
  (E7/E11). They do not overlap.

**blend_anchor.** It rescales the simulator's method x round distribution toward the blend. Dynamics changes that shape:
- more early 5-round knockouts;
- fewer late 3-round knockouts;
- more late submissions, because the takedown curve puts more ground time late.

Its pooled cells and walk-forward method/round tables must be re-made with the flag on.

**officials.** If turned on, its referee tendencies multiply the follow-up stop and standing-TKO hazards, which
dynamics rescales by round (`conv[r]`, `stkoR[r]`). They are structurally compatible; levels as above.

**styles_sos and oppadj.** They change per-side rates. Dynamics multiplies the per-round pace, so they are compatible,
but `outLevel` and `tdLevel` were set at v4.0.1's volume.

**Weak spots found here (train).**
- **3-round R2 KO hazard.** It is under-predicted, 0.113 vs 0.136 (flag off 0.122). Two likely reasons:
  - The `[dyncal]` joint stoppage scale holds the KO share at the flag-off value. That leaves non-knockdown stoppages
    17-18% under the data rates (standing 0.000373 vs 0.000452, ground 0.00552 vs 0.00674), while knockdown conversion
    is on target.
  - Raising `stkoScale`/`gnpScale` toward the data and lowering `convLevel` to hold the KO share would move stoppages
    toward round 2. Not tested.
- **5-round R1 KO hazard.** It is over-predicted (strikes only 0.144 vs 0.105; about 2 SE). Per-strike knockdown risk
  in 5-round R1 matches (1.24 vs 1.22), so the excess comes through landed volume or conversion in title-fight R1. The
  `kdRound5` cells rest on 47 / 45 / 19 / 10 / 14 real knockdowns. Treat 5-round R3-5 as ±50%.
- **Between-round doctor and corner stoppages in 5-round fights** (2.4% after R3, 4.5% after R4) run about 3x real
  over R3-R4 combined, in both configurations. Real: 1.2% and 0.7%, 3 events in 301 rounds; 3-round fights 0.1-0.4%. This
  is a base-engine issue, outside this component, and the largest remaining 5-round R4 error.
- **Late submissions.**
  - 3-round R3 SUB hazard: 0.071 vs 0.056 real. The on - real CI [+0.0004, +0.0292] just excludes 0; flag off 0.061 is
    inside.
  - 5-round R5: 0.038 vs 0.008. Flag off 0.031 is also outside, so the base engine already shares this.
  - Submission-attempt deviance: +0.032.
  - Cause: the takedown round curve adds late ground time. A submission round curve, or capping the takedown curve, is
    the fix to try.
- **Takedown round curve.** It is steep ([1, 1.17, 1.58] input for a [1, 1.05, 1.20] real shape) because E6's carry-over
  bites harder in the engine than in the data. The controlled-minutes term was weaker (-0.040) on the 2024-25 refit, so
  out of sample both may be too strong together.

**Validation-window instability.** These come from the verified research and were not used for any choice here.
- Own-output AR(1) 0.68 fell to about 0.45 on the 2024-25 refit. The engine's realised 0.49 hedges this.
- KD frailty halves in 2024-25 (glove trial), so `vol` 0.5 may be wide for 2024+.
- E4 momentum contrasts flip sign on 2024-25 (scorer +15.5%, SE 11%).

**Not implemented.**
- The dropped man's within-round output dip after a knockdown: -7% real here, +2% in the engine.
- Desperation and adaptation, beyond the off-by-default `lostAcc` knob (E5: none in the data).
- The takedown momentum terms keep the dynamic-RE values. There is no skip-round contrast for takedowns.

**Engine details.**
- Under the flag, the 5-round caution `finR` still applies to ground TKOs but no longer to knockdowns.
- `accProfA/B` only act on the base-table path.
- With `p.dyn` missing, the flag is ignored and the engine runs as v4.0.1.

## Reproduce (train only)

```
cd /home/user/XX/.claude/worktrees/wf_0113c02d-461-2
node tests/test_dynamics.js                     # flag-off bit-for-bit vs tests/fixtures/engine3_pre_dynamics.js (= v4.0.1)
node tests/test_engine3.js && node tests/test_director3.js
node tools/dynamics_calibrate.js --iters 5 --sims 16 --stride 2           # [dyncal] levels (prints FINAL json)
bash <scratch>/dyn/run_ablation_v402.sh 100 abl402                          # 3 workers, nice -n 5: off / on, 100 sims per order, CSVs
bash <scratch>/dyn/run_checks402.sh                                         # train acceptance: check_abl402_{on,off}.json
bash <scratch>/dyn/run_variant403.sh                                        # sensitivity on_v (same seeds), scored vs on and off
python3 <scratch>/dyn/gen_final.py metrics|base <report.json> off on        # the tables above
python3 <scratch>/dyn/finshare.py <scratch>/dyn/abl402.json                 # finish share by round
bash <scratch>/dyn/make_patch.sh && bash <scratch>/dyn/apply_verify.sh      # patch vs v4.0.1 + byte-for-byte apply check
bash <scratch>/dyn/port_v400.sh; bash <scratch>/dyn/make_patch_v400.sh      # v4.0.0 port (patch -p1 -F3) + its test
```

`<scratch>` = `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad`.

Run files in `<scratch>/dyn/`:
- `abl402.json` and `abl402_report.{json,txt}`: the final ablation.
- `check_abl402_{on,off}.json`: the acceptance checks.
- `abl403_*` and `check_abl403_on_v.json`: the variant.
- `abl401*`: pass 1, including the narrow config.
- `cal10.log`: the calibration.
- `tables_final.md`: generated tables.

**Hidden-data notes.**
- `dynamics_bt.js` and `dynamics_ablation.py` refuse fights from 2024-01-01 (env `DYN_ALLOW_VALIDATION=1` for the single
  v5 look) and never read 2026.
- `dynamics_calibrate.js` hard-codes 2019-2023.
- `dynamics_check_train.py` uses `tools/dynamics.py`'s ufcstats loader. It cuts the panel to 2019-2023 right after
  parsing, before any statistic, exactly as the verified tool does. Walk-forward features only look backward.
