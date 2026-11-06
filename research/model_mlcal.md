# mlcal: ML-driven engine calibration harness

Status: built and tested on engine v3, Nov 6, 2026. Files: `tools/mlcal.js` (evaluator, Node worker_threads),
`tools/mlcal.py` (driver: Optuna TPE with successive-halving pruning, CMA-ES, confirmation, ledger-guarded
validation, bootstrap CIs), `tools/mlcal_spec_engine3.json` (which v3 parameters to tune),
`tools/mlcal_hooks/elo_skill.js` + `tools/mlcal_spec_engine3_elo.json` (example coupling of an external
rating into the engine), `tests/test_mlcal.js` (23 checks), outputs `data/derived/mlcal_candidates.json`,
`data/derived/mlcal_val_ledger.json`, `data/derived/mlcal_priors_asof.json`.

## Results (Nov 6, 2026)

**Verdict.** The harness works end to end and tells the truth. In the requested small-budget run on
engine v3, no candidate beat the current parameters on validation, so nothing should be adopted. The
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

__RUNS23__


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

**Successive halving.** Rungs are cumulative sims per fight (default 15, 30, 60). Every trial starts at
15; Optuna's SuccessiveHalvingPruner (reduction factor 2) promotes the better half to 30 and the best
quarter to 60. A promotion only adds the new sims (rung r draws with seed offset r and its counts are
added to the earlier rungs'), and matchups are cached per trial inside each worker.

**Monte Carlo floor.** With N sims per fight the expected log-loss inflation is about 1/(2N) for the
winner (0.033 at 15, 0.008 at 60, 0.003 at 160) and about 6/(2N) for 7 bins before smoothing. It is close
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
   re-scored on a disjoint window of 600 other train fights with fresh seeds. This removes the winner's
   curse of the tuning sample and of the specific random draws; finalists are re-ranked by it.
4. Validation 2024-01-01..2025-12-31 (all 865 usable fights, both corner orders, 80 sims per order): each
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
2. `python3 tools/mlcal.py tune --spec tools/mlcal_spec_engine<N>.json --trials 60 --cma-evals 48
   --n-fights 800 --rungs 15,30,60 --workers 2 --top 3 --val-sims 80` (about 15-20 CPU minutes on this
   machine at engine v3 speed; `--cpu-min` caps tuning). A first look: `--trials 30 --cma-evals 32
   --n-fights 600`. A cheap code check without touching validation: `--no-val`.
3. Stage 2 on top of the winner: `--fixed data/derived/mlcal_candidates.json#1` (tune more parameters or
   hook weights with the first stage's values held), written to a different `--out`.
4. Read `data/derived/mlcal_candidates.json`: ranks, confirmation scores, validation metrics with CIs and
   paired differences, calibration table, base rates. Adopt a candidate only if its paired validation CI
   on the objective (or winner log loss) excludes zero or the version adds a capability without making
   validation worse (ROADMAP rule).
5. `node tools/mlcal.js export --cand data/derived/mlcal_candidates.json --rank 1 --out <file.js>` writes a
   full params file (the header lists every changed value). The owner of src/params3.js copies the values in,
   re-runs tests/test_engine3.js, and records the numbers in docs/CHANGELOG.md. mlcal never writes src/.
6. Re-validating a set that is already in the ledger returns the stored result. Do not delete ledger
   entries to get a second look; the 2026 vault stays for the milestone audits.

Quick one-off evaluation of any parameter file or candidate: `node tools/mlcal.js eval --split train
--n-fights 600 --sims 60 [--x candidate.json] [--detail]` (prints the objective, components, base rates
and stat-line errors as JSON).

## Nothing runs in the browser

mlcal produces parameter values for the engine, not a model the page evaluates, so there is no
`src/ml/mlcal.js`. A winning hook coupling is moved into the engine as code plus a params entry.
