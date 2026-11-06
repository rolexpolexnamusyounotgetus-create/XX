# mlcal: ML-driven engine calibration harness

Status: built and tested on engine v3, Nov 6, 2026. Files: `tools/mlcal.js` (evaluator, Node worker_threads),
`tools/mlcal.py` (driver: Optuna TPE with successive-halving pruning, CMA-ES, confirmation, ledger-guarded
validation, bootstrap CIs), `tools/mlcal_spec_engine3.json` (which v3 parameters to tune),
`tools/mlcal_hooks/elo_skill.js` + `tools/mlcal_spec_engine3_elo.json` (example coupling of an external
rating into the engine), `tests/test_mlcal.js` (23 checks), outputs `data/derived/mlcal_candidates.json`,
`data/derived/mlcal_val_ledger.json`, `data/derived/mlcal_priors_asof.json`.

__RESULTS__

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
