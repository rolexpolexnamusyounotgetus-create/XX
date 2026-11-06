# mlcal: ML-driven engine calibration harness

Status: built and tested on engine v3, Nov 6, 2026. Files: `tools/mlcal.js` (evaluator, Node worker_threads),
`tools/mlcal.py` (driver: Optuna TPE with successive-halving pruning, CMA-ES, confirmation, ledger-guarded
validation, bootstrap CIs), `tools/mlcal_spec_engine3.json` (which v3 parameters to tune),
`tools/mlcal_hooks/elo_skill.js` + `tools/mlcal_spec_engine3_elo.json` (example coupling of an external
rating into the engine), `tests/test_mlcal.js` (30 checks, `node tests/test_mlcal.js`, about 10 s).
Outputs: `data/derived/mlcal_candidates.json` (run 1, the requested small-budget demo),
`data/derived/mlcal_candidates_wide.json` (run 2), `data/derived/mlcal_candidates_elo.json` (run 3),
`data/derived/mlcal_val_ledger.json` (every set ever scored on validation, with per-fight predictions),
`data/derived/mlcal_priors_asof.json` (walk-forward shrinkage priors 2019-2025).

## Results (Nov 6, 2026)

**Verdict.** The harness works end to end and its safeguards held: the gains the search found on the tuning
window did not survive confirmation or validation, and the harness reported that. In the requested
small-budget run on engine v3 (and in two follow-up runs) no candidate beat the current parameters
significantly on validation, so nothing should be adopted into src/params3.js. The best lead is an Elo
coupling through a hook (run 3): better on every outcome metric by point estimate, not significant. The
current v3 parameters beat the walk-forward Elo by 0.028 winner log loss [95% CI 0.010, 0.046] on 857
validation fights and are well calibrated (symmetric ECE 0.015). Run 1 also showed why small tuning
windows overfit (fight-sample noise, not Monte Carlo noise) and led to the wide-window defaults below.
tools/calibrate.js did not exist when this was written (no tools/calibrate.js and no
data/derived/calibration.json), so the comparison is against the parameter set it will replace:
src/params3.js `3.0.0-selfcal-2026-11-06` (league-average self-calibration from tests/test_engine3.js),
frozen at engine hash a6904fc06b98 / params hash 940478b62032.

### Run 1: the requested small budget

30 TPE trials + 32 CMA-ES evaluations (4 generations of 8, warm-started at the TPE incumbent), 16
dimensions (combA, combB, kPM, kAcc, kKD, kTdPM, kTdAcc, strikeScale, kdScale, kdInstant, subConvScale,
tdOddsScale, form.out, a joint form.pow/form.chin multiplier, form.vol, judge.sharedSd), 600-fight tuning
window, rungs 15/30/60 sims, 2 workers. CPU: 165 s tuning, 229 s in all (1,112 s wall on a machine at
load average ~40). Successive halving stopped 8 TPE trials at 15 sims and 11 at 30; 11 reached 60.
CMA ranked 32 candidates at 30 sims and promoted 16 to 60.

| set | tuning window (600, 60 sims) | confirmation (600 other train, 60 sims) | validation objective | validation winner LL [95% CI] | 7-bin LL | Brier | accuracy | sym. ECE | paired d winner LL vs current [95% CI] |
|---|---|---|---|---|---|---|---|---|---|
| current params3 | 1.6000 | 1.5654 | **1.4719** | **0.6486** [0.6316, 0.6657] | **1.6136** | **0.2284** | **0.621** | **0.015** | - |
| rank 1 (cma3_6) | 1.5815 | 1.5604 | 1.4851 | 0.6507 [0.6334, 0.6691] | 1.6172 | 0.2293 | 0.616 | 0.044 | +0.0021 [-0.0052, +0.0102] |
| rank 2 (cma2_7) | 1.5760 | 1.5622 | 1.4977 | 0.6540 [0.6398, 0.6683] | 1.6190 | 0.2309 | 0.607 | 0.028 | +0.0054 [-0.0024, +0.0138] |
| rank 3 (tpe16) | 1.5756 | 1.5888 | 1.4861 | 0.6522 [0.6374, 0.6669] | 1.6269 | 0.2300 | 0.620 | 0.032 | +0.0036 [-0.0049, +0.0125] |
| walk-forward Elo | | | | 0.6768 [0.6661, 0.6875] | | | | | |

Validation: 857 fights, 2024-01-13..2025-12-13, both corner orders x 80 sims. Objective values are only
comparable within a column (more sims means less Monte Carlo inflation).

What happened:
- The search found real improvements on the tuning window: -0.024 objective for the best three.
- Confirmation on 600 other train fights cut that to -0.005 / -0.003 for the CMA candidates and reversed
  it for tpe16 (+0.023). Validation agreed: all three were slightly worse than the current set, mostly
  through the base-rate penalty (rank 1: KD per 15 term 0.012 vs 0.001).
- Why: common random numbers remove the Monte Carlo noise from comparisons, but not the fight-sampling
  noise. The per-fight paired difference between two parameter sets has sd 0.24, so on 600 fights a
  candidate-vs-baseline comparison has SE about 0.010; picking the best of about 60 candidates buys about
  two SEs of luck, which is the 0.02 that vanished. At 1,300 fights the SE falls to about 0.0066.
- Era drift: the tuner raised kdScale to fit 2019-2023 (0.295 KD per 15 in train), but 2024-25 has 0.250,
  so the change cost base-rate error on validation. Base-rate targets move by era; a future spec can weight
  recent seasons or tune era-sensitive scales on 2022-2023 only.
- TPE importance (fANOVA over the complete trials): kAcc 0.22, kdScale 0.18, form.powchin 0.08,
  tdOddsScale 0.08, kKD 0.07, combB 0.06, kdInstant 0.06, judge.sharedSd 0.06; strikeScale and the sub
  scales barely matter for this objective.
- Current set on validation, simulated vs observed base rates: KO share 28.3% vs 29.1%, SUB 14.8% vs 16.9%,
  decisions 55.5% vs 53.6%, R1 share of 3-round finishes 49.4% vs 52.4%, sig landed per 15 61.0 vs 58.0, KD
  per 15 0.269 vs 0.250, TD per 15 1.39 vs 1.42, control per 15 169 vs 169 s, split/majority share of
  decisions 17.7% vs 18.5%. Stat lines: sig landed MAE 25.6 per fighter, KD MAE 0.32, TD MAE 1.14,
  correlation of predicted vs actual sig-landed differential 0.41.

### Runs 2 and 3: wide windows, and an Elo coupling through a hook

Both on the same frozen engine snapshot as run 1 (`--engine/--params` pointed at a copy of the run-1
snapshot), tuning window 1,300 train fights, confirmation on the other 672, rungs 10/20/40 sims, 2 workers.

- **Run 2, wide** (`data/derived/mlcal_candidates_wide.json`): the same 16 dimensions, 30 TPE trials + 24
  CMA evaluations; 241 s CPU tuning, 292 s in all. Tuning-window gains of 0.03-0.05 shrank to -0.004..+0.016
  on confirmation; on validation all three finalists were again slightly worse than the current set (paired
  winner log loss +0.0022 [-0.0066, +0.0111], +0.0039, +0.0026; objectives 1.4831-1.5356 vs 1.4719).
- **Run 3, Elo coupling** (`data/derived/mlcal_candidates_elo.json`, spec `tools/mlcal_spec_engine3_elo.json`,
  hook `tools/mlcal_hooks/elo_skill.js`): 5 dimensions (w_acc, w_pow, w_td per 400 Elo points, combA,
  combB), 20 TPE trials + 16 CMA evaluations; 156 s CPU tuning, 206 s in all.

| set | tuning window (1,300, 40 sims) | confirmation (672, 40 sims) | validation objective | validation winner LL [95% CI] | 7-bin LL | Brier | accuracy | sym. ECE | sig-diff corr | paired d winner LL [95% CI] | paired d (win + 0.5 bins) [95% CI] |
|---|---|---|---|---|---|---|---|---|---|---|---|
| current params3 | 1.6187 | 1.6007 | 1.4719 | 0.6486 [0.6316, 0.6657] | 1.6136 | 0.2284 | 0.621 | 0.015 | 0.41 | - | - |
| Elo rank 1 (tpe6): w_acc 0.75, w_pow -0.03, w_td 0.73, combA 1.04, combB 0.55 | 1.5923 | 1.5970 | **1.4661** | **0.6449** [0.6273, 0.6633] | **1.6063** | **0.2266** | **0.628** | 0.022 | 0.34 | -0.0036 [-0.0145, +0.0079] | -0.0085 [-0.0272, +0.0123] |
| Elo rank 2 (cma1_0): w_acc 0.75, w_pow -0.49, w_td 0.78, combA 0.91, combB 0.56 | 1.5943 | 1.6175 | 1.4802 | 0.6517 [0.6364, 0.6672] | 1.6207 | 0.2299 | 0.620 | 0.023 | 0.35 | +0.0031 [-0.0064, +0.0124] | |

The Elo coupling is the only change with a better validation point estimate on every outcome metric
(winner log loss, 7-bin, Brier, accuracy), and the gain is consistent with what TPE's importance says
(all three hook weights matter more than the exponents). It is not significant (the paired CI includes 0),
and it costs stat-line skill: with combB at 0.55 the defender's allowed rates matter less, so the
correlation between predicted and actual sig-landed differentials falls from 0.41 to 0.34. Its
lesson for v4+: results-based strength (Elo now, tools/ratings.py later) carries information the decayed
stat sums miss, and it should enter the engine through accuracy and takedown odds, not power. Next step
for whoever owns v4: re-run run 3 with `"wStat": 1` in the objective (protects the stat lines) and the
ratings.json rating in place of Elo, then put the winning coupling into the engine as params entries.

**Overall:** three runs' finalists (8 candidate sets, plus the baseline) were scored on validation once
each; none is a significant improvement over the current v3 set. Engine v3's global knobs sit on a flat
optimum around the self-calibrated values for this objective, and further gains must come from new
information or structure (v4-v10), which the hook interface lets the harness test and tune. The baseline was
scored twice on validation (runs 1 and 3) because the ledger hash scheme changed between the runs; the
results were bit-identical (deterministic seeds) and the ledger now carries one hash per parameter set,
with the repeat marked `duplicate_of`.


## What it does

The engine's global parameters (prior strengths, combination exponents, scales, form spreads, judge noise)
are tuned as a black box against the walk-forward backtest: for each candidate parameter set, every
training fight is simulated from the two pre-fight snapshots in `data/derived/backtest_dev.json`, and the
candidate is scored on how well the simulated outcome distribution predicts what happened.

**Objective (train, lower is better)**

    objective = 1.0 x winner log loss + 0.5 x 7-bin log loss + base-rate penalty (+ 0 x stat-line error)

- Winner log loss: P(A wins | not a draw) = (A wins + 0.5) / (decisive sims + 1), clipped to [0.005, 0.995];
  draws and no-contests are left out of this term.
- 7-bin log loss over A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO (DOC counts as KO/TKO; DQ and NC
  fights are dropped). Each fight's bin probabilities are smoothed with one pseudo-sim spread over the
  corner-symmetric train base distribution, so a bin the sims never hit still gets a finite loss.
- Base-rate penalty: sum of 0.003 x (error / tolerance)^2 over KO share (tol 2 pts), SUB share (1.5 pts),
  R1 and R3 share of 3-round finishes (3 pts each), split+majority share of decisions (4 pts), sig landed
  per 15 (6% rel), sig accuracy (1.5 pts), KD per 15 (12%), TD per 15 (10%), control per 15 (10%), sub
  attempts per 15 (15%). Simulated rates are pooled over the evaluated fights; observed rates over the
  whole split. One tolerance off costs 0.003, about the size of a real log-loss gain, so the tuner cannot
  buy log loss with unrealistic fights. All weights live in the spec's `objective` block.
- Reported but not optimized: Brier, accuracy, symmetric calibration error (ECE), sig-landed MAE per
  fighter, KD and TD MAE, and the correlation of predicted vs actual sig-landed differentials.

**Corner symmetry (BACKLOG "Evaluation rule").** No parameter sees corner order. During tuning each fight
is simulated in one corner order picked by a fixed hash of its id (`mirror: "swap"`), so any order effect
inside the engine averages out; on validation both orders are simulated and the probabilities averaged
(`mirror: "both"`). Scores are always computed in the data's orientation; log loss, Brier and the 7-bin
loss are invariant under relabeling, and the calibration table counts each fight from both sides.

**Common random numbers.** Fight f at rung r always uses seed mix(hash(id), seed, r), so two candidates
are compared on identical random draws and their difference has far less Monte Carlo noise than either
value (tests/test_mlcal.js checks the same candidate gives a bit-identical objective).

**Successive halving.** Rungs are cumulative sims per fight (default 10, 20, 40; run 1 used 15, 30, 60).
Every trial starts at the first rung; Optuna's SuccessiveHalvingPruner (reduction factor = rung ratio, 2)
promotes the better half to the second rung and the best quarter to the top rung. A promotion only adds the new sims (rung r draws with seed offset r and its counts are
added to the earlier rungs'), and matchups are cached per trial inside each worker.

**Monte Carlo floor.** With N sims per fight the expected log-loss inflation is about 1/(2N) for the
winner (0.05 at 10, 0.033 at 15, 0.0125 at 40, 0.008 at 60, 0.003 at 160) and about 6/(2N) for 7 bins before smoothing. It is close
to constant across candidates, so comparisons within a rung are fair; never compare values across rungs.

**Optimizers.**
1. Optuna TPE (multivariate, 10 random startup trials) in the spec's box (log scale for positive ranges).
   Trial 0 is always the current parameter set, so the baseline gets a full-fidelity score on the same
   random numbers.
2. CMA-ES (pycma) in the normalized box, warm-started at the TPE incumbent (`--cma-start current` for an
   independent start), step 0.15, population 8. Each generation is ranked at the second-to-last rung (all
   members on the same CRN, so ranks are valid), then the best half is promoted to the top rung so its
   score is comparable with complete TPE trials.
3. Confirmation: the best 3 distinct candidates (normalized RMS distance > 0.03) plus the baseline are
   re-scored on a disjoint window of train fights with fresh seeds (default: every train fight outside the
   tuning window, 672 with the default 1,300-fight window; run 1 used 600). This removes the winner's
   curse of the tuning sample and of the specific random draws; finalists are re-ranked by it.
4. Validation 2024-01-01..2025-12-31 (all 857 fights with a decisive result or a draw; NC and DQ dropped;
   both corner orders, 80 sims per order): each
   finalist and the baseline once. `data/derived/mlcal_val_ledger.json` stores the hash (engine file,
   params file, overrides, hook values) of every set ever scored there; a set already in the ledger is never
   re-run, its stored result is reused. 2,000-resample bootstrap over fights gives 95% CIs and paired CIs
   of the difference against the baseline; the walk-forward Elo stored in each snapshot is scored on the
   same fights as a reference.

**Hidden-data protocol.** `tools/mlcal.js` drops every fight dated 2026-01-01 or later on load, whatever
file it is given (tested with a synthetic 2026 entry). Shrinkage priors come from
`data/derived/mlcal_priors_asof.json`, the 2019..2025 entries of backtest.json's `priors_asof` (each built
only from fights before Jan 1 of its year by tools/build_db.py; `python3 tools/mlcal.py priors` re-extracts
it and discards the 2026 key and the fight list without reading them).

**Reproducibility.** At session start the evaluator copies the engine's directory and the params file to a
temp snapshot and every worker loads that copy, so tuning, confirmation and validation use the same code
even while src/ is being edited (it was, during the demo run). The candidates file records the engine and
params file hashes.

## Engine contract (what makes it engine-agnostic)

The harness needs only:
- a params module exporting one plain object (numbers, arrays, nested objects); tunable entries are
  addressed by dot paths (`kdScale`, `form.vol`, `judge.sharedSd`, `pace5.2`, `div.Lightweight.ko`);
- `FightEngine.matchup(profA, profB, { division, rounds, title, date, priors, params })`, where `params` is
  the full parameter tree (spec `"inject": "opts"`); for an engine that reads its params object directly,
  `"inject": "mutate"` writes the tree into the loaded params module in each worker instead;
- `FightEngine.summarize(m, N, seed)` returning `counts` (or `bins`) in the 7-bin order, `finA`/`finB` by
  round, `avg.A`/`avg.B` per-fight stats (`sig_lnd sig_att kd td_lnd td_att ctrl sub_att h_lnd b_lnd
  l_lnd`), `avgMin`, `dist` and `dec {UD, SD, MD}`. Missing stats only blank the matching penalty terms.

Profiles are the snapshot sides as stored in backtest_dev.json (decayed sums `S` with `meta.keys`, age,
ko_losses, home division, pace); catch-weight and open-weight bouts use the snapshot's `prior_division`.

**Spec format** (`tools/mlcal_spec_engine3.json`): `engine`, `params`, `inject`, optional `hook`, `fixed`,
`defaults.rel`, `objective`, and `tune`, a list of
- `{"path": "kdScale", "lo": 0.7, "hi": 2.0}`: absolute bounds, log scale when lo > 0 (`"log": false` for linear);
- `{"path": "form.vol", "rel": 2}`: bounds [v/2, 2v] around the current value;
- `{"path": "div.*.ko", "rel": 1.5}`: glob, one dimension per match;
- `{"name": "form.powchin", "paths": ["form.pow", "form.chin"], "lo": 0.4, "hi": 1.6}`: one multiplier on
  several current values;
- `{"path": "hook.w_acc", "value": 0, "lo": -0.3, "hi": 1.2}`: a weight passed to the hook module;
- optional `min`/`max` hard limits and `int`. The current value is always inside the box.

**Hooks: plugging other analysts' outputs into the engine.** A hook module exports
`matchupOpts(opts, ctx)` and returns the matchup options for one fight, with `ctx = { fight, swap, A, B,
hookParams, params }` (A and B in simulation corner order). It must be antisymmetric in A and B. The
example `tools/mlcal_hooks/elo_skill.js` turns the pre-fight Elo gap d = (Elo_A - Elo_B)/400 into knob
changes: accuracy odds x exp(+-w_acc d), KD power and chin x exp(+-w_pow d), takedown defense
x exp(+-w_td d). The same pattern couples ratings.json, oppadj.json, durability.json or an ML model's
per-fight output into the engine with weights the harness tunes; a coupling that wins on validation
becomes an engine feature with a params entry in the next cycle.

## How future engine cycles call it

1. Write `tools/mlcal_spec_engine<N>.json`: point `engine`/`params` at the new files, list the parameters
   that version adds or re-opens (keep it to 10-20 dimensions per run), keep the objective block unless the
   version is about something else (raise `wStat` for a stat-line version, for example).
2. `python3 tools/mlcal.py tune --spec tools/mlcal_spec_engine<N>.json --out data/derived/mlcal_candidates_<tag>.json`
   runs the defaults learned on Nov 6: 30 TPE trials, 24 CMA evaluations, 1,300-fight tuning window, all
   other train fights for confirmation, rungs 10/20/40, 3 finalists, 80 sims per corner order on validation,
   2 workers (about 5 CPU minutes at engine v3 speed, 0.2 ms CPU per simulated fight; `--cpu-min` caps the
   tuning phase). With more dimensions raise `--trials`/`--cma-evals` rather than shrinking the window. The
   requested demo was `--trials 30 --cma-evals 32 --n-fights 600 --rungs 15,30,60 --confirm-fights 600
   --confirm-sims 60`. A cheap code check that never touches validation: `--no-val`.
3. Stage 2 on top of the winner: `--fixed data/derived/mlcal_candidates.json#1` (tune more parameters or
   hook weights with the first stage's values held), written to a different `--out`. To re-score a saved
   candidate on a changed engine: `--fixed <file>#<rank> --trials 1 --cma-evals 0` (trial 0 is the
   candidate; it is confirmed and validated, under a new hash because the engine changed). To repeat a run
   exactly, point `--engine/--params` at a frozen copy of the files it used (hashes in the candidates file).
4. Read `data/derived/mlcal_candidates.json`: ranks, confirmation scores, validation metrics with CIs and
   paired differences, calibration table, base rates. Adopt a candidate only if its paired validation CI
   on the objective (or winner log loss) excludes zero or the version adds a capability without making
   validation worse (ROADMAP rule).
5. `node tools/mlcal.js export --cand data/derived/mlcal_candidates.json --rank 1 --out <file.js>` writes a
   full params file (the header lists every changed value and the hook weights, and warns when the live
   params file has changed since the candidate was tuned; it refuses to write src/params3.js). The owner of src/params3.js copies the values in,
   re-runs tests/test_engine3.js, and records the numbers in docs/CHANGELOG.md. mlcal never writes src/.
6. Re-validating a set that is already in the ledger returns the stored result. Do not delete ledger
   entries to get a second look; the 2026 vault stays for the milestone audits.

Quick one-off evaluation of any parameter file or candidate: `node tools/mlcal.js eval --split train
--n-fights 600 --sims 60 [--x <json with an "x" or "overrides" object>] [--engine/--params/--hook/--fixed] [--detail]` (prints the objective, components, base rates
and stat-line errors as JSON).

## Nothing runs in the browser

mlcal produces parameter values for the engine, not a model the page evaluates, so there is no
`src/ml/mlcal.js`. A winning hook coupling is moved into the engine as code plus a params entry.
