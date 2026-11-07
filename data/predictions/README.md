# Forward-test ledger

This folder holds the simulator's predictions for UFC fights that have not happened yet. A backtest can
leak, however carefully it is split. A prediction committed to git before the fight cannot. This ledger
is the final out-of-sample test: the model predicts, the fights happen, and the scores are whatever
they turn out to be.

## Files

| File | What it is | Mutable? |
|---|---|---|
| `cards_upcoming.json` | Snapshot of every announced UFC card in the window (bouts, weight class, rounds, title flag, roster slugs, status, sources, `as_of`). It is input data and gets refreshed whenever cards change. | Yes (re-snapshot as cards change) |
| `YYYY-MM-DD_<event-slug>.json` | One prediction file per event, committed before that event starts. | **No, never edited after commit** |
| `results.json` | Official results, appended after each event. | Append-only |
| `statlines_results.json` | Official per-fight stat totals (ufcstats) for bouts with a stat-line forecast (fwd-4.2 on), appended after each event. | Append-only |
| `scores.json` (+ `scores.md`) | Scores recomputed from the prediction files and `results.json` by a script. Never hand-edited. | Regenerated |
| `drift_monitor.json` | Drift-monitor state (rule 6.5.1 (b) and the level alarms) recomputed from the scored files by `tools/drift_monitor.py ledger`. Never hand-edited; changes no prediction. | Regenerated |

## Rules

1. **Commit before the event.** Each event's prediction file is committed (and pushed) before the
   first bout starts: the event's earliest `start_utc` in `cards_upcoming.json`, usually the prelims.
   That moment is the event's lock time. Git history is the timestamp. The commit time and the push
   to the remote prove the predictions existed before the fights.
2. **Never edited afterwards.** Once committed, a prediction file is not touched: no reformatting,
   no fixes, no "clarifications". A mistake stays in the record. A prediction can be superseded only
   *before* the lock time, by committing a new file (`..._v2.json`) that names the one it replaces.
   The latest file committed before the lock is the one that gets scored.
3. **No cherry-picking.** Every bout on the card at commit time gets a prediction, including UFC
   debutants (slug `null`, so the model falls back to its debut prior and the bout is flagged) and
   bouts marked `reported`, `rumoured` or `doubtful`. A bout that does not take place is void.
4. **Late changes.** A replacement opponent or a new bout announced after the event's file was
   committed can get a prediction only if a new file is committed before the lock. Anything not
   predicted before the lock is unscored. Weigh-in misses after the commit change nothing: the
   prediction stands as committed.
5. **One model version per file.** Each file records the model version, the code commit it was
   generated from, the roster snapshot date (`data/derived/fighters.json` meta) and the simulation
   count. Scores are tracked per model version. If the model changes because of forward results, the
   new version starts a fresh tally. Forward results are never used for tuning between milestones
   (same hidden-data protocol as the backtest vault, see `docs/BACKLOG.md`).

## Prediction file format

```json
{
  "event": "UFC 334: Gane vs. Hokit",
  "date": "2026-11-14",
  "lock_utc": "2026-11-14T22:00Z",
  "card_as_of": "<cards_upcoming.json as_of used>",
  "model": {"version": "v?", "code_commit": "<sha>", "roster_snapshot": "2026-10-31", "n_sims": 20000},
  "bouts": [
    {
      "bout_id": "2026-11-14:ciryl-gane__josh-hokit",
      "a": {"name": "Ciryl Gane", "slug": "ciryl-gane"},
      "b": {"name": "Josh Hokit", "slug": "josh-hokit"},
      "weight_class": "Heavyweight", "rounds": 5, "title": true, "status": "official",
      "p_a": 0.0,
      "p_method": {"a_ko": 0.0, "a_sub": 0.0, "a_dec": 0.0, "b_ko": 0.0, "b_sub": 0.0, "b_dec": 0.0, "draw": 0.0},
      "p_distance": 0.0,
      "market": {"source": "bestfightodds", "captured_utc": "...", "odds_a": -240, "odds_b": 201, "p_a_novig": 0.0},
      "flags": ["debut_b", "short_notice", "weight_change_a"]
    }
  ]
}
```

`a`/`b` follow the order in `cards_upcoming.json` (the order the card sources list them, not
red/blue corner and not winner-first). `bout_id` is `date:slug_a__slug_b`, with the fighter's name
slugified when the slug is `null`. The market block is a snapshot taken when the prediction is made.
It is recorded for comparison only and is never an input to `p_a`, unless a future model version
says so explicitly.

## Results format

`results.json` is append-only:

```json
{"results": [
  {"bout_id": "2026-11-14:ciryl-gane__josh-hokit", "outcome": "win", "winner": "a",
   "method": "KO/TKO", "round": 2, "time": "3:14",
   "closing_odds": {"source": "bestfightodds", "odds_a": -250, "odds_b": 210},
   "sources": ["<official result URL>", "<second source>"], "recorded_utc": "..."}
]}
```

`outcome` is one of `win`, `draw`, `nc` (no contest) or `cancelled`. Results come from two
independent sources (ufcstats.com or ufc.com plus one outlet). Closing odds go here, not in the
prediction file, because they are only known at fight time.

## Scoring

Only `win` outcomes count toward the headline numbers. Draws, no contests and cancelled bouts are
void and reported separately. Every metric is computed per bout on the probability given to the
actual winner, so it does not depend on which fighter is listed as `a` (the symmetric-evaluation
rule in `docs/BACKLOG.md`).

- **Log loss:** mean of `-ln p(winner)`. This is the primary metric. A coin flip scores 0.693.
- **Brier score:** mean of `(p_a - y_a)^2`. A coin flip scores 0.25.
- **Accuracy:** share of bouts where the favourite won (p > 0.5). A bout predicted at exactly 0.5
  counts as half.
- **Against the market:** the same three metrics for the no-vig closing line (mean of BestFightOdds'
  closing lines from `results.json`) and for the no-vig line captured at prediction time. The headline
  comparison is the paired per-bout difference in log loss (model minus market), with a bootstrap
  95% interval. Baselines: walk-forward Elo and a 50/50 coin.
- **Secondary:** method of victory (7-way log loss over `p_method`), goes-the-distance Brier
  (`p_distance`) and calibration (reliability table in 10-point bins once enough bouts exist).

Each event adds about 10 to 14 bouts, so after a few events the intervals are still wide. The
scores file reports the count and the interval next to every number, and a lead over the market is
not claimed until the paired interval excludes zero.

## Tooling

`python3 tools/forward_ledger.py predict --event <date>` writes an event's file in the format above (plus the
experts, the simulator's raw output, `p_a_line` / `p_a_noline` / `p_elo` and the flags), refusing to overwrite or to
predict after the lock; `--supersede` adds a `_v2` before the lock. Model version `fwd-1` sets `p_a` to the MoE
stack with the market line captured at prediction time as one of its experts (it says so in the file's `model.p_a`);
`p_a_noline` is the same stack without the line, and both are scored. From Nov 6, 2026 the tool writes model version
`fwd-4.1` instead (section "Forward model v4.1" below: the primary `p_a` and every scored secondary model). For events
dated 2026-11-14 or later it writes `fwd-4.2` (section "Forward model v4.2" below: the debut method model and the
stat-line block; `--fwd` picks the version by event date). From Nov 7, 2026 those events get `fwd-4.3` instead
(section "Forward model v4.3" below: `p_a_noline` becomes the ML v2 no-line stack). From Nov 7, 2026, about 11:30 am
UTC, they get `fwd-4.4` (section "Forward model v4.4" below: fwd-4.3's models on roster inputs refreshed to the newest
verified results by `tools/live_refresh.py`).
`python3 tools/forward_ledger.py score`
fetches results for finished ledger events (ufcstats through the Greco1899 CSVs and ESPN's scoreboard as the
second source), appends them to `results.json` and regenerates `scores.json` / `scores.md`. The backtest-side
counterpart is `tools/blindtest.py` (event-by-event replay of 2024-2025, `research/model_blindtest.md`).

## Forward model v4.1 (Nov 6, 2026)

Pre-registered on Nov 6, 2026, about 9:15 pm UTC. At that time no prediction file existed in this folder and no
forward result had been recorded. The model below applies to every file whose `model.version` starts with `fwd-4.1`.

- **Code and data.** The code is `tools/forward_ledger.py` 1.1 and `tools/forward_ledger.js`. The fixed ML v2 weights
  are exported by `tools/forward_models.py` to `data/derived/forward_models.json`. The tests are
  `tests/test_forward_models.js`, `tests/test_ml2.js` and `tests/test_blindtest_stack.js`.
- **Version string.** The ML v2 build, the forward_models.json hash, the MoE stack build, the engine and the ML page
  snapshot are all part of `model.version`. If any of them changes, the version changes and its scores are a separate
  tally.

### Primary `p_a` (a line was captured before the lock): `ml2_stack_open`

**Definition.** `ml2_stack_open` is the ML v2 page "open" stack with weights fit on 2019-2023 only, on opening lines:

`logit p_a = 0.6596 logit(line) + 0.5825 logit(ML v2 logistic)`

- Inputs are clipped to [0.01, 0.99]. There is no intercept.
- The full-precision weights are in `forward_models.json`. They reproduce tools/ml2.py's cached static fit exactly.
- `line` is the multiplicative de-vig of the consensus line captured at prediction time
  (`market.p_a_open_stack_input`), the same construction as the no-vig opener the stack was fit on.
- The rule is the same whatever the capture time before the lock. There is no switch by capture time.
  `market.hours_before_lock` records each bout's lead.

**Fallbacks.**
- A fighter missing from the ML v2 roster: `stack_open`, then `stack_line`. The bout is flagged `primary_fallback`.
- No line for the bout: `p_a = p_a_noline`.
- A debutant: `p_a` = the line, as in fwd-1.

**Why this stack.** The evidence comes from research/model_ml2.md (section 6 and the Verification log) and
research/model_blindtest.md.

1. **ML v2 stacks beat the MoE stacks in both line regimes.** This holds both in the pre-2024 CV and on 2024-2025.

   | regime | CV 2021-2023 (ML v2 vs MoE experts) | 2024-2025 (ML v2 vs MoE experts) |
   |---|---|---|
   | close | 0.61624 vs 0.61922 | 0.5757 vs 0.5788 |
   | open | 0.62275 vs 0.62840 | 0.5812 vs 0.5852, -0.0041 [-0.0066, -0.0014] |

   In the blind replay, `ml2_stack_line` scored 0.5760 against `moe_close`'s 0.5774.
2. **The line in a ledger file is not the close.**
   - It is the newest snapshot before the lock. That is planned for about T-25h to T-8h. The Nov 6 snapshots are T-36h
     for the Nov 7 card and T-204h for UFC 334.
   - The verified ML v2 recipe sends any pre-fight line, opener or moving, to the open stack. The line stack is kept
     for a true closing line.
   - Close-trained weights fed an opener cost +0.0099 [+0.0064, +0.0133] (ML v2). The MoE stacks show the same in the
     blind replay: +0.0102 [+0.0057, +0.0145].
3. **Supporting check.** This was run for this pre-registration and is not part of a verified report.
   - Method: a scratch script called tools/ml2.py's own `stack_predict` on its cached table. The weights were fixed
     and nothing was fitted. It covered the 843 fights of 2024-2025 that have both lines.
   - Result, as close-trained minus open-trained ML v2 stack:

     | line fed to both stacks | difference [95% CI] |
     |---|---|
     | the close | +0.0049 [+0.0016, +0.0078] |
     | the logit midpoint of open and close | +0.0065 [+0.0033, +0.0095] |
     | the open | +0.0099 [+0.0064, +0.0133] |

   - The open-trained weights did at least as well wherever the captured line sits between open and close, so no
     capture-time rule is needed.
   - Caveat: on the close itself this reflects 2024-2025. Every model was underconfident then and ML v2 was strong.
     The 2019-2025 production refit raises the close stack's ML v2 weight from 0.34 to 0.48. In 2019-2023 the
     close-trained weights remain the CV choice for a true close, so `ml2_stack_close` is the main secondary.

### No-line primary: `p_a_noline`

`p_a_noline` is unchanged from fwd-1: the MoE stack without a line (`blindtest_stack.json` `model`, absent block).
For a debutant it is `p_elo`, with the debutant seeded as below.

### Debutants

The 1500 debut rating is replaced by a seeded rating when a seed exists. A debutant's Elo is 1500 plus his pre-UFC
seed, taken from the first source that has him:

1. `data/predictions/debutants_*.json`.
2. preufc.json `roster_priors[slug].elo_debut_shift`, the shift at his UFC debut.
3. Otherwise 1500.

- `p_a_noline` = `p_elo` = `models.elo` uses that rating against the opponent's fighters.json Elo.
- `p_a` = the line, and the method comes from division base rates, as in fwd-1. "The line" here is fwd-1's construction,
  `market.p_a_stack_input`: the power de-vig of the mean decimal odds over every sportsbook in the consensus.
- Flags: `debut_<side>` is kept, plus `seeded_elo_<side>` or `debut_elo_1500_<side>`.

A debutants file is filled from pre-UFC records only, never from odds or results. It is committed before the event's
prediction file. Its format:

```json
{"meta": {"built": "...", "source": "sherdog via tools/preufc.py"},
 "fighters": {"samuel-sanches": {"name": "Samuel Sanches", "elo_debut_shift": 35.0, "source": "..."}}}
```

- The key is the fighter's slugified name.
- Instead of `elo_debut_shift`, an entry may give `"pre": {pre_wpct, pre_logn, pre_fin, pre_finl, pre_streak,
  pre_feed, pre_grad, pre_oppufc, pre_netelo, pre_dwcs, pre_agedeb, age_debut}`. These are standardized with
  preufc.json's `seeded_elo_live` betas, and a missing feature counts as the mean.
- An entry may also nest these values the way preufc.json's `fighters[slug]` does (the card desk's files):
  `derived.seeded_elo.elo_debut_shift` is used as given, else `derived.side_pre` plus `derived.age_at_ufc_debut` go
  through the same betas. A file's `also_upcoming` block (the next card's debutants, same shape) is a fallback that
  never overrides a `fighters` entry. `tests/test_forward_models.js` checks each form.
- At pre-registration (about 9:15 pm UTC, Nov 6) no seed existed for the four debutants on the Nov 7 and Nov 14 cards.
  `data/predictions/debutants_vegas124.json` (committed 9:15 pm UTC, Sherdog pre-UFC records via tools/preufc.py)
  now seeds them: Degli +128.2, Lourenço +17.4, Calderon -30.4 and, in `also_upcoming`, Sanches +78.6. Each shift
  recomputes from its `side_pre` and age with preufc.json's live betas. The seed moves `p_a_noline`, `p_elo` and
  `models.elo` only; `p_a` stays the line.

### Secondary models (scored, never chosen from forward results)

Every bout carries a `models` block with P(a wins | not a draw) for each model below, or null when the model cannot
run. `model.models` in each file repeats these definitions.

| model | what it is |
|---|---|
| `market_novig` | Benchmark: the BestFightOdds mean at prediction time, multiplicative no-vig (= `market.p_a_novig`). |
| `stack_line` | MoE stack, close-trained weights, fed the power de-vig consensus (= `p_a_line`, fwd-1's `p_a`). |
| `stack_open` | MoE stack, open-trained weights (`model_open`), fed the multiplicative de-vig consensus. |
| `stack_noline` | MoE stack without a line (= `p_a_noline` for non-debut bouts). |
| `ml2_lr` | ML v2 logistic page model (refit 2010-2025). |
| `ml2_stack_close` | ML v2 line stack, fit 2019-2023 on closing lines (market 0.7733 + ML v2 0.3397), fed the power de-vig consensus. |
| `ml2_stack_open` | **Primary** (above). |
| `ml2_stack_noline` | ML v2 no-line stack, fit 2019-2023 (ML v2 0.7049 + market rating 0.5526, half-life 1.5 y). |
| `ml2_stack_*_prod` | The same three ML v2 stacks with the page's production weights, refit 2019-2025 (ml2.json `page_model.stack`). |
| `whr_rounds` | Round-level WHR from ratings.json's current roster ratings. |
| `ratings_stack` | ratings.json's stack of whr_rounds, glicko2 and dims, logit weights fit 2019-2023. No `ratings_plus`. |
| `elo` | fighters.json Elo, with debutants seeded as above (= `p_elo`). |
| `simulator` | Engine 4.0.0 summarize, both corner orders, learned stat-line rates, draws removed. |

All of these are corner-symmetric. Swapping a and b and flipping the line gives exactly 1 - p for every model
(`tests/test_forward_models.js`). The engine is included because its seeds follow the unordered pair.

### Scoring (per model version)

- **Headline.** The paired per-bout log-loss difference of `p_a` against the market at prediction time, and against
  the close, with an event-cluster bootstrap 95% interval. The interval is widened to the bout-level bootstrap
  wherever that one is wider. With one event the cluster bootstrap collapses to a point, and with a few events it is
  far too narrow (clarified Nov 6, about 9:45 pm UTC, before any prediction file; `scores.json` keeps both intervals).
- **Results.** The tool records a fetched result only when both sources agree (`verified`). A single-source or
  conflicting result waits for a later run or for a `--manual` entry, because `results.json` is append-only.
- **`p_a_noline`.** Scored the same way. `p_elo` and the coin stay as baselines.
- **Every entry in the `models` block.** Log loss, Brier and accuracy, plus the paired log-loss difference against the
  market at prediction time and against the close (`scores.json` `models`, `scores.md` "Models block").
- **Claims.** A lead is not claimed until its paired interval excludes zero.
- **Questions the secondaries answer.** These are exploratory, and nothing switches on them within v4.1:
  - `ml2_stack_open` vs `ml2_stack_close`: which weights suit a line captured before the close, read against
    `hours_before_lock`;
  - the ML v2 stacks vs the MoE stacks;
  - fit-2019-2023 vs production weights;
  - `ml2_stack_noline` vs `stack_noline`;
  - `whr_rounds`, `ratings_stack`, `elo` and `simulator` as single models.
- **Changing the primary.** Doing so needs a new model version, chosen at a milestone and never on forward results
  alone (rule 5).

## Forward model v4.2 (Nov 6-7, 2026)

Pre-registered on Nov 6, 2026, about 11:30 pm UTC, and committed on its own before the code that implements it. At that
time no file with a `model.version` starting `fwd-4.2` existed, no UFC 334 prediction existed, and the only ledger file
was the Vegas 124 file (Nov 7, `fwd-4.1`, committed 9:40 pm UTC), which this section does not touch.

- **Scope.** fwd-4.2 applies to every ledger file for an event dated **2026-11-14 (UFC 334) or later**, until a later
  section of this README says otherwise. Events dated before 2026-11-14 stay `fwd-4.1`.
- **Sources of the decision.** Two lab-3 results verified on Nov 6 (read with their "Verification log" sections) and
  docs/BACKLOG.md:
  - research/model_debut.md: adopt the debut **method** model for bouts with a UFC debutant, in place of division base
    rates, fed the ledger's own winner probability. CV 2019-2023 in the adopted setup: method given the winner -0.033
    [-0.059, -0.006], marginal KO / SUB / DEC -0.025 [-0.049, -0.002]; the single 2024-25 look confirms (-0.086 /
    -0.051). The debut **winner** model is not adopted (CV -0.049 nested, not confirmed on 2024-25: +0.003 [-0.046,
    +0.050]; slope 0.81) and is logged as a monitored candidate.
  - research/model_statlines.md: adopt the distributional stat-line layer (src/ml/statdist.js, "prod" tables) for
    per-fighter P10 / P50 / P90 lines mixed over a fight-length distribution. 2024-25: 80% band coverage 0.77-0.82;
    better log score than the NB baseline on all 19 differing stats. No winner use.
- **Nothing selected on forward results.** Both adoptions come from CV on 2019-2023 confirmed once on 2024-25. No
  forward result exists (there is no results.json yet); Vegas 124 has not been fought.

### Winner: unchanged from fwd-4.1

`p_a`, `p_a_line`, `p_a_noline`, `p_elo`, every `models` entry of fwd-4.1, the fallbacks, the flags and the debutant
seeding follow the fwd-4.1 rules above with the same weights and code path. In particular, for a bout with a debutant
`p_a` = the line (`market.p_a_stack_input`) when a line was captured before the lock, else `p_elo` (Elo with the
debutant seeded from his pre-UFC record).

The simulator (`models.simulator`, and the engine expert inside the MoE stacks) reads the frozen engine in
`versions/v4/` (engine 4.0.0 / params 4.0.0-selfcal-pre2024, the same three files and hashes as the Vegas 124 file's
`model.engine`). fwd-4.2 never reads `src/engine3.js` or `src/params3.js`: a v5 merge is in progress there.

### Method for a bout with a debutant (new primary)

For every bout where at least one man is not in `fighters.json`, the primary `p_method`, `p_distance` and
`p_finish_round` come from the debut method model (tools/debut.py export, `data/derived/debut.json` `model.method`,
evaluated by `src/ml/debut.js` `method()`): a multinomial logit for P(KO/TKO, SUB, DEC | winner), written from the
winner's point of view, with the debut.json `live_division_base` shares as offsets (lambda 30, CV-chosen).

- **Winner probability fed in** (research/model_debut.md "Integration", the adopted setup "who x how with the ledger's
  winner probability"): `pW` = the bout's own `p_a`. That is the line in the power de-vig construction
  (`market.p_a_stack_input`, the construction the historical closing lines were built with; when the snapshot has no
  consensus power value, tools/forward_ledger.py already falls back to the power de-vig of the BestFightOdds mean odds),
  else, with no line, the seeded Elo `p_elo`. The mismatch feature |logit pW| therefore reads the line, as in the
  verifier's "CV with the ledger's winner fed" run.
- **Cells.** With `given_a[m]` = P(m | a wins) and `given_b[m]` = P(m | b wins) from `method(sideA, sideB, {division,
  rounds, pA: pW})`, and `dr` = the division base-rate draw share (fighters.json `priors`, the same
  `division_method_prior` as fwd-4.1):
  - `a_m = p_a (1 - dr) given_a[m]`, `b_m = (1 - p_a)(1 - dr) given_b[m]`, `draw = dr`, for m in ko, sub, dec;
  - the seven cells sum to 1 and the a cells sum to `p_a (1 - dr)`;
  - `p_distance = a_dec + b_dec + draw`.
- **Rounds.** `p_finish_round` (and the stat-line length grid below) splits each side's KO and SUB cells over the rounds
  by the division base-rate round profile: fighters.json `priors[division].fin3` (or `fin5` for five rounds) `KO` and
  `SUB` per round, each normalised to sum 1 (the `ALL` profile when a division's list sums to 0).
- **Sides** (the `--debut-model` hook's side builders, unchanged): a veteran from fighters.json plus debut.json
  `roster_gnet` (network columns as of 2026-01-01) via `sideFromProfile`; a debutant from his
  `data/predictions/debutants_*.json` entry via `sideFromDebutant` (fight-week flags from `bout.notice` unless the card
  gives `flags_a` / `flags_b`); a debutant without an entry enters with every column at the training mean. Two
  debutants: both from their entries.
- **Recorded as** `p_method_source` = "debut method model (debut.json)", plus `debut_method` (`given_a`, `given_b`,
  `p_w_used`, side sources) and the full `debut_path` block of the hook (regimes, adopted path, unknown columns).
- **Scored secondary:** `p_method_secondary.division_base_rates` = fwd-4.1's cells for the same bout (division base
  rates scaled to `p_a`) with its own `p_distance`.

Bouts without a debutant keep fwd-4.1's method exactly (the method-and-round model scaled to `p_a`).

### Monitored secondary: `models.debut_model`

`models.debut_model` = P(a wins | not a draw) from `src/ml/debut.js` `winner()` on debut.json (the no-line debut model:
16-column symmetric logistic, CV-frozen blocks, refit 2012-2025), for every bout with a debutant; null otherwise. It is
scored like every other `models` entry (log loss, Brier, accuracy, paired difference vs the market at prediction time
and vs the close). It is never the primary in fwd-4.2. The `debut_path` block also carries the stack [open, debut] and
the other regimes for audit; they are not scored.

### Stat-line forecast block (new, recorded for scoring)

Every bout gets a `statlines` block: for each fighter (`a`, `b`) and each stat `sig_lnd`, `sig_att` (significant strikes
landed / attempted), `td_lnd`, `td_att` (takedowns landed / attempted), `ctrl` (control seconds), `kd` (knockdowns) and
`sub_att` (submission attempts): `mean`, `p10`, `p50`, `p90`, and the comparator `blend_mean`.

- **Evaluator.** `src/ml/statdist.js`, `StatDist.load(statlines.json, { which: "prod" })` (the production tables, refit
  2019-2025 by the CV-frozen procedure; the per-stat model choice of research/model_statlines.md).
- **Inputs per fighter** (the production chain of tools/statlines_matchup.js, with the event date):
  - learned rates: MLRates `predict` (the frozen `versions/v4/ml/mlrates.js`, whose `predict` is identical to
    src/ml/mlrates.js) on `data/derived/mlrates.json`, profiles from fighters.json (`S` with `meta.keys`), ctx
    {division, rounds, title, date = event date, priors = fighters.json `priors`};
  - embedding: `src/ml/embed.js` on `data/derived/embed_model.json`, `matchup(a, b, {division, rounds, date})`;
    `hasEmb` = both roster embeddings have `expo` > 0; the win logit is the embedding logit when `hasEmb`, else 0 (as
    in training);
  - oppadj roster factors from `data/derived/oppadj.json` `roster` (a missing fighter = 1);
  - a debutant: the mlrates profile of a debut side in training (no UFC sums, n 0, Elo 1500, no KO losses, no home
    division, unknown layoff) with date of birth, height, reach and stance from his debutants entry (ufcstats tott,
    else Sherdog); no embedding, oppadj 1.
- **Fight-length distribution** (the method model's): `SD.lengthGrid(S, rounds)` with S = the bout's primary method
  cells by round, [a KO r1..R, a SUB r1..R, b KO r1..R, b SUB r1..R, a DEC, b DEC, draw]:
  - bout without a debutant: the method-and-round model cells of the variant the headline uses (SM with a line, else
    S), rescaled per side to `p_a` exactly as `p_method` is, so they sum to 1 and match `p_method` and `p_distance`;
    if the engine supplied the head (method-and-round model failed), its per-round finishes are split into KO and SUB
    by its own KO / SUB totals; with no head, as for a debut bout below;
  - bout with a debutant: the primary debut-method cells, split over rounds by the division base-rate profile above.
  - The within-round finish-time table is statlines.json `finish_time` (2010-2018 finishes).
- **Quantiles.** `pq` = the smallest integer y with mixture CDF(y) >= q (control on a 1-second grid). `mean` is the
  mixture mean. `blend_mean` = the verified mlrates + embedding blend rate (StatDist `base`) x the grid's expected
  minutes: the incumbent "mean model", recorded as the comparator for the deviance.
- **Symmetry.** No corner input: swapping a and b swaps the two fighters' lines exactly.
- The lines are marginals per fighter and per stat (research/model_statlines.md "Caveats"). They are a forecast for
  scoring, not an input to any probability.

### Scoring (fwd-4.2 files)

- **Winner.** Exactly as fwd-4.1, including `models.debut_model` in the models block table.
- **Method, bouts with a debutant.** For the primary and for `p_method_secondary.division_base_rates`: 7-way log loss
  (the README secondary metric), method given the winner (log of the winner's actual cell over the winner's three
  cells), marginal KO / SUB / DEC ((a_m + b_m) / (1 - draw)), and goes-the-distance Brier. Paired differences
  (primary minus base rates) with the event-cluster bootstrap widened to the bout-level one. Decisive bouts only, with
  the method mapped as in fwd-4.1 (KO/TKO incl. doctor stoppage, SUB, any decision); DQ and other methods are void for
  the method metrics.
- **Stat lines.** Actuals are the per-fight totals of ufcstats' per-round rows (the Greco1899 `ufc_fight_stats.csv`
  refresh, the same mirror the results fetch uses), appended to `statlines_results.json` (append-only) only for a bout
  whose result in `results.json` is verified by the two-source rule (unchanged) with outcome `win` or `draw`, and only
  when both fighters' rows cover every round through the result's round. ufcstats is the only official per-fight stat
  source, so the stat totals have one source; the outcome keeps two. No contest and cancelled bouts are void. Per stat,
  over fight-sides:
  - mean Poisson deviance of `mean`, 2 [y ln(y / mu) - (y - mu)], and of `blend_mean`, with the paired difference
    (event-cluster bootstrap widened to the bout-level one);
  - coverage of [p10, p90] (inclusive), share above p90 and share below p10. The targets are 0.80 / 0.10 / 0.10 for
    the large counts and control; for the sparse counts (kd, sub_att, td_lnd, td_att) the inclusive band covers more
    than 0.80 by discreteness, so their tail shares are the check;
  - mean absolute error of p50.
- **Questions these answer** (exploratory; nothing switches within fwd-4.2): debut method vs division base rates on
  forward bouts; whether the stat-line bands stay calibrated on live cards; whether the layer's means beat the blend
  means; how `debut_model` compares with the line and seeded Elo.

### Files and hashes fwd-4.2 reads (sha256, first 16 hex)

The tool refuses to write a fwd-4.2 file when any file below has a different hash (a dry run reports the mismatch). A
change to any of them, a roster refresh included, is a new version (fwd-4.2.1 or later) that needs a dated addendum
here naming the new hashes before its first file.

| file | sha256-16 | role |
|---|---|---|
| data/derived/fighters.json | df4d868a2195fb4a | roster snapshot 2026-10-31, profiles, Elo, division priors |
| data/derived/moe_page.json | 34a33d1837e9b912 | feature LR expert |
| data/derived/ml.json | 444b7b1e62086cc1 | ML page model expert |
| data/derived/market.json | 8edb0a6cc9c3ca4f | market rating expert |
| data/derived/methodround.json | b26b7e373367f346 | method-and-round model |
| data/derived/mlrates.json | 6dec930e670f7c70 | learned stat-line rates (engine and stat-line inputs) |
| data/derived/ml2.json | 0837826dbc05cd1f | ML v2 logistic and production stacks |
| data/derived/forward_models.json | 20269ec7642c1db8 | ML v2 stacks fit 2019-2023 (primary weights) |
| data/derived/ratings.json | 5fc4f8a3be14051f | whr_rounds, ratings stack |
| data/derived/preufc.json | 30111c93e864dfe0 | debut seeding betas, roster_priors |
| data/derived/blindtest_stack.json | ded17ce026bbff29 | MoE stacks (close, open, no line) |
| data/derived/debut.json | f6709d52292ccc83 | debut method model, debut winner model, roster_gnet |
| data/derived/statlines.json | 30c3a959a1a3ac2a | stat-line tables ("prod") and finish-time table |
| data/derived/embed_model.json | 061d9fba48cc6633 | embedding (stat-line inputs) |
| data/derived/oppadj.json | c27c8c6de3733c59 | oppadj roster factors (stat-line inputs) |
| versions/v4/engine3.js | 6c661f68a4c41c1d | engine 4.0.0 |
| versions/v4/params3.js | e16a6481319f9b15 | params 4.0.0-selfcal-pre2024 |
| versions/v4/ml/mlrates.js | b563032dd9468f7b | MLRates evaluator (engine adapter and stat-line inputs) |
| src/ml/moe.js | ad1097b488bbb3ac | MoE evaluator |
| src/ml/mlpage.js | d4c72febf5c57666 | ML page evaluator |
| src/ml/ml2.js | a840ae6ad9e6bcc3 | ML v2 evaluator |
| src/ml/debut.js | e5bbc188f4cf42c9 | debut model evaluator and side builders |
| src/ml/statdist.js | c7facbbc4b406be1 | stat-line evaluator |
| src/ml/embed.js | e3fa72fd6c0b140b | embedding evaluator |
| tools/methodround_model.js | 60d90d231bb4300f | method-and-round evaluator |

- **Per-event inputs** (not pinned; each file records them with hashes, as in fwd-4.1): `cards_upcoming.json`, the
  newest odds snapshot before the lock and `data/predictions/debutants_*.json`.
- **Tool code.** `tools/forward_ledger.py` 1.2 (`predict --fwd 4.2`), `tools/forward_ledger.js` (`--fwd 4.2`) and a new
  `tools/forward_statlines.js` (the stat-line block). They are written after this commit; the implementation commit and
  the three files' hashes are added below, before any fwd-4.2 file exists. Each fwd-4.2 file records the code commit
  and those hashes. The fwd-4.1 path of the same tools stays byte-identical (tested).
- **Version switch.** `--fwd auto` (the default) picks the version this README assigns to the event date: fwd-4.2 for
  2026-11-14 or later, fwd-4.1 before. Writing a ledger file under any other version is refused (dry runs may use either).
- **Version string.** `model.version` starts `fwd-4.2:` and names the primary, the debut.json and statlines.json hashes
  and the engine, so a later change shows up as a separate tally.

### Addendum: implementation (Nov 6, 2026, about 11:45 pm UTC; before any fwd-4.2 file)

The code was written after the pre-registration commit (6011e6f, 11:30:52 pm UTC) and follows it without changes to the
rules above. No fwd-4.2 ledger file exists; the UFC 334 dry run (`predict --event 2026-11-14 --fwd 4.2 --dry-run
--sims 5000`) wrote nothing under data/predictions.

- Tool code hashes (sha256, first 16 hex), recorded in every fwd-4.2 file as `model.code_sha256_16`:
  - `tools/forward_ledger.py` (1.2): d5f662f54089525a
  - `tools/forward_ledger.js`: b225c680da5a2e29
  - `tools/forward_statlines.js`: 267beac95846c7df
- A later edit to these files must keep the fwd-4.1 output byte-identical (tests/test_forward_v42.js part 1, against
  tests/fixtures/forward_v41_golden.json, the pre-v4.2 tool's output) and the fwd-4.2 output unchanged, or it starts a
  new version.
- One implementation detail the rules leave open: the Greco1899 CSV writes most counts as "2.0"; the stat-total parser
  reads those as integers (tests/test_forward_score42.py checks it against an independent parse of a 2025 event).
- Tests: `node tests/test_forward_v42.js` (fwd-4.1 identity, additions only, corner symmetry of every new field, method
  cells sum to 1 and agree with p_a, debut bouts with and without a line, guards, this hash table) and
  `python3 tests/test_forward_score42.py` (stat parse, match rules, scoring arithmetic).
- Verifier fix (Nov 7, 2026, about 12:05 am UTC; before any fwd-4.2 file; no prediction output changes). The stat-line
  deviance difference resampled fight-sides in its bout-level bootstrap, not bouts as "Scoring (fwd-4.2 files)" says, so
  one bout's two sides could give an interval that excludes zero. `boot_ci` now resamples the bout id there, so a bout's
  two sides move together, and a stat gets an interval only from 2 bouts on (the winner metrics' rule of 2 units).
  Every other interval, fwd-4.1's included, is unchanged. tests/test_forward_score42.py part 5 checks it, and
  tests/test_forward_v42.js part 4 now checks that the latest hash listed here for each tool file is the one on disk.
  New hash: `tools/forward_ledger.py` (1.2, verifier fix): a9e9359dbd638bbf

## Forward model v4.3 (Nov 7, 2026)

Pre-registered on Nov 7, 2026, about 7:35 am UTC, and committed on its own before the code that implements it. At that
time no file with a `model.version` starting `fwd-4.2` or `fwd-4.3` existed and no UFC 334 prediction existed. The only
ledger file was the Vegas 124 file (Nov 7, `fwd-4.1`, committed 9:40 pm UTC Nov 6, lock 10:00 pm UTC Nov 7), which this
section does not touch. No forward result had been recorded (there is no results.json).

- **Scope.** fwd-4.3 applies to every ledger file for an event dated **2026-11-14 (UFC 334) or later**, until a later
  section of this README says otherwise. It supersedes fwd-4.2 for those events. No fwd-4.2 file was ever written, so
  none will be; `--fwd 4.2` stays available for dry runs with its output unchanged (tested). Events dated before
  2026-11-14 stay `fwd-4.1`.
- **What changes.** Everything in fwd-4.2 stays as it is: winner rules, method, debut handling, stat-line block,
  scoring, version switch and guards. The exceptions are the three items below, plus a re-pin of two evaluator files
  in the hash table that changes no number ("Files and hashes fwd-4.3 reads").
  1. `p_a_noline` becomes the ML v2 no-line stack.
  2. The MoE no-line stack becomes the scored secondary `models.moe_noline`.
  3. Drift rule 6.5.1(b) reads `p_a_noline` from fwd-4.3 on, and tracks the MoE column beside it.
- This section governs the ledger only. It changes nothing on the page or in the engine's `predict()`.

### 1. No-line primary `p_a_noline`: `ml2_stack_noline`

**Definition.** For a bout without a debutant, `p_a_noline` = `models.ml2_stack_noline`, the ML v2 no-line stack with
weights fit on 2019-2023 only:

`logit p_a_noline = 0.7049 logit(ML v2 logistic) + 0.5526 logit(market rating)`

- **The export it reads.** The weights are used exactly as exported for the ledger: data/derived/forward_models.json,
  block `ml2_static.noline`, written by tools/forward_models.py 1.0 at 2026-11-06T21:08:55Z, before audit 1. The
  file's sha256 is `20269ec7642c1db8305a483e5bf79ffa8b2267d4d0c871f48eef1ce4d9aca91a`, which fwd-4.2 already pins as
  `20269ec7642c1db8`.
  - Inputs `[ml2lr, mkt_rating]`, weights `[0.7049087055847891, 0.5526351104765688]`.
  - Recency half-life 1.5 y (CV-chosen). Inputs clipped to [0.01, 0.99]. No intercept, no temperature.
  - Fit on 1,955 decisive fights dated 2019-2023 by tools/ml2.py's `stack_predict` ('static', key
    `noline|page: ml2lr+mkt_rating`). It reproduces ml2.json's cached static predictions exactly (max diff 0).
- **Evaluation.** fwd-4.1 and fwd-4.2 already compute `models.ml2_stack_noline` this way: tools/forward_ledger.js calls
  src/ml/ml2.js `predict(...).pStack` with `stack` = forward_models.json `ml2_static`.
  - The inputs at prediction time are the ML v2 logistic page model (ml2.json `page_model`, refit 2010-2025) and
    ml2.json's market rating. A missing market rating enters as logit 0.
  - The weights were fit on out-of-fold logistic predictions. The ledger feeds the production logistic, as it does for
    fwd-4.1's primary.
- **Not the CV choice, and why.** The forward-chained CV 2021-2023 in research/model_ml2.md (section 6, verified)
  prefers the **blend-based** no-line stack, 0.62854 against 0.62984 for this logistic-based one. That gap is above the
  0.0005 rule. The blend combines the ML v2 logistic, LightGBM and XGBoost with the market rating.
  - The ledger's JS cannot evaluate the blend's trees. ml2.json exports only the logistic, and no blend-based no-line
    stack was ever exported for the forward ledger.
  - Engine v6 has since added a JS tree evaluator (src/ml/ml2trees.js with data/derived/ml2_trees.json) and a
    `none|blend` stack in v6_stacks.json. Those exports were built on Nov 7 at 6:08 and 6:29 am UTC, after audit 1.
    They belong to the rejected v6 package and were never verified as ledger inputs, so fwd-4.3 does not read them.
  - fwd-4.3 therefore uses the verified logistic-based no-line stack, the page's JS-constrained variant, and says so.
    Its slightly better 2024-25 score (0.5890 against 0.5898 for the blend-based stack) is one look. It is not a reason
    to prefer it.
- **Fallback.** For a bout without a debutant, if the ML v2 no-line stack cannot run (a fighter missing from the ML v2
  roster), `p_a_noline` = the MoE no-line stack (`models.moe_noline`) and the bout is flagged `noline_fallback`.
- **Debutants: unchanged.** For a bout with a debutant, `p_a_noline` = `p_elo`: Elo with the debutant seeded, as in
  fwd-4.1 "Debutants". No stack runs on such a bout.
- **Consequences under the unchanged fwd-4.2 rules.**
  - A bout without a debutant and without a captured line gets `p_a` = `p_a_noline` (fwd-4.1's "No line for the bout"
    fallback). Its `p_a`, its method cells (rescaled to `p_a`) and its stat-line length grid now follow the ML v2
    no-line stack.
  - `--headline noline` likewise sets `p_a` to the new `p_a_noline`.
  - Bouts with a line, and every bout with a debutant, keep fwd-4.2's `p_a`, `p_method`, `p_distance`,
    `p_finish_round` and stat lines exactly.
- **Recorded as** `p_a_noline_source` on each bout: `ml2_stack_noline`, `moe_stack (noline_fallback)`,
  `elo_debut_seeded` or `elo_debut_prior`.

### 2. Scored secondary `models.moe_noline`

`models.moe_noline` is the MoE stack without a line: blindtest_stack.json `model`, absent block (h 1.5, temperature
1.1607, fit through 2025-12-13). It is the column fwd-4.1 and fwd-4.2 publish as `p_a_noline` on bouts without a
debutant.

- On a bout with a debutant it is null, like every stack.
- It is the same number as `models.stack_noline`, which stays in the block unchanged. The second name marks the series
  that rule 6.5.1(b) tracks.
- It is scored like every other `models` entry: log loss, Brier, accuracy, and the paired difference against the market
  at prediction time and against the close.
- The fwd-4.2 column can be rebuilt from any fwd-4.3 file: `models.moe_noline` on a bout without a debutant,
  `p_a_noline` (= `p_elo`) on a bout with one.

### 3. Drift rule 6.5.1(b): the column it reads

docs/V6_V10_PLAN.md 6.5.1(b) switches "the production no-line stack" when the forward ledger's trailing-200-bout
mirrored slope has a CI that includes 1 at two consecutive quarterly checks (src/ml/calib.js `ruleB`, tools/calib.py
`drift_rule_b`). Its text did not name the ledger column (research/model_calib.md, rule-consistency check). From fwd-4.3
on:

- **Trigger series: `p_a_noline`.** Each scored row uses the `p_a_noline` of its own file. In fwd-4.1 and fwd-4.2 files
  (Vegas 124) that is the MoE stack. In fwd-4.3 files it is the ML v2 no-line stack. The earlier rows leave the
  trailing window as later bouts arrive.
- **Tracked series: the MoE no-line stack.** This is `p_a_noline` in fwd-4.1 and fwd-4.2 files and `models.moe_noline`
  from fwd-4.3 on. In every version it is the same number as `models.stack_noline`. The monitor computes and reports
  rule (b) on this series too, so the MoE history continues unbroken. This series never triggers anything.
- **Rows.** The rows are scored bouts with outcome `win`; draws, no contests and cancellations are left out. Bouts with
  a debutant are left out, because their `p_a_noline` is seeded Elo, not a stack, in every version. Rows run in date
  order, with ties in file order. A `noline_fallback` row enters the trigger series with the MoE value it carries.
- **What the switch means for the new column.** "h 3, T 1" applied to the ML v2 no-line stack means the same stack refit
  on 2019-2023 with a recency half-life of 3 y by tools/ml2.py's own `stack_predict`. Half-life 3 is in its CV grid
  (0.63029 in ml2.json `stacks.cv`). The stack has no temperature, so T is already 1.
  - If the rule fires, that refit enters as a new version (fwd-4.3.x or later), with a README addendum naming its
    weights and hashes before its first file.
  - If only the MoE series would fire, nothing changes.
- The monitor itself belongs to cycle 4 (plan 6.5.1). fwd-4.3 does not change the rule's window, test or threshold.

### Evidence, and the audit-1 flag

- **Before the vault** (research/model_ml2.md sections 4 and 6, verified Nov 6):
  - CV 2021-2023: the no-line stack on the ML v2 logistic and the market rating scores 0.62984, against 0.63646 for the
    stack on the MoE experts (h 1.5).
  - 2024-25, static weights, 854 fights: the ML v2 no-line stack scores 0.5898 against 0.5949 for the MoE experts'
    stack, -0.0051 [-0.0086, -0.0015]. That row is the blend-based stack, the CV choice. The logistic-based stack used
    here scores 0.5890 on the same fights; no paired interval was reported for it.
  - Pooled 2021-2025, the blend-based ML v2 no-line stack beats the current one by -0.0060 [-0.0092, -0.0027]. The
    2021-2023 rows are out of sample for the stack weights only.
  - The same report warned that ML v2's production no-line weights (refit 2019-2025, sum 1.42 against 1.26 for the
    weights fit before 2024) would be too sharp if 2026 looked like 2019-2023. fwd-4.3 uses the 2019-2023 weights.
  - In the blind 2024-25 replay (research/model_blindtest.md, 843 fights), ML v2's rolling no-line stack and
    `moe_noline` were level: 0.5847 against 0.5856.
- **Audit 1** (research/vault_audit_v5.md sections 2-3; the 2026 vault, 369 decisive fights):
  - The ledger's `p_a_noline`, the production MoE no-line stack, scored 0.6602 [0.5996, 0.7253] with a mirrored slope
    of 0.56 [0.38, 0.77], so it was over-confident.
  - It was worse than the ML v2 logistic alone (0.6287) by +0.0315 [+0.0039, +0.0603].
  - The column fwd-4.3 adopts (forward_models.json `ml2_static.noline` fed the production logistic) scored 0.6356
    [0.5929, 0.6834], slope 0.80 [0.53, 1.10]. Against the MoE stack that is -0.0246 [-0.0467, -0.0032].
- **Flag (plan 6.5.2).** This change was decided on Nov 7, after audit 1 had been read. Audit 1 ran from 4:57 to 5:35 am
  UTC and its report was committed by 5:51 am.
  - Plan 6.5.1 says no setting other than the pre-registered rules reacts to audit 1. Audit 1's section 7 lists any
    change to the drift rule's column, and any change to the no-line stacks' sharpening, as items to flag.
  - So both the switch of `p_a_noline` and the column rule (b) reads go into audit 2's list as "**not clean on the
    vault**". The vault cannot confirm either one. Their clean test is this ledger.
  - The pre-vault evidence above already supported the change on its own. Before the vault, research/model_calib.md had
    also asked for the rule's column to be named. Nothing is refit: the weights are the Nov 6 export, fit on 2019-2023.
- **Nothing selected on forward results.** No forward result exists. Vegas 124 has not been fought.

### Scoring (fwd-4.3 files)

- Scoring is exactly as for fwd-4.2. `p_a_noline` is scored as a column (the new definition) and `models.moe_noline` as
  a models entry.
- **Questions these answer** (exploratory; nothing switches within fwd-4.3 except through rule (b)):
  - the ML v2 no-line stack against the MoE no-line stack on forward bouts (`p_a_noline` against `models.moe_noline`);
  - the calibration slope of each.

### Files and hashes fwd-4.3 reads (sha256, first 16 hex)

The tool refuses to write a fwd-4.3 file when any file below has a different hash (a dry run reports the mismatch). A
change to any of them, a roster refresh included, is a new version (fwd-4.3.1 or later). It needs a dated addendum here
naming the new hashes before its first file.

| file | sha256-16 | role |
|---|---|---|
| data/derived/fighters.json | df4d868a2195fb4a | roster snapshot 2026-10-31, profiles, Elo, division priors |
| data/derived/moe_page.json | 34a33d1837e9b912 | feature LR expert |
| data/derived/ml.json | 444b7b1e62086cc1 | ML page model expert |
| data/derived/market.json | 8edb0a6cc9c3ca4f | market rating expert |
| data/derived/methodround.json | b26b7e373367f346 | method-and-round model |
| data/derived/mlrates.json | 6dec930e670f7c70 | learned stat-line rates (engine and stat-line inputs) |
| data/derived/ml2.json | 0837826dbc05cd1f | ML v2 logistic, market rating and production stacks |
| data/derived/forward_models.json | 20269ec7642c1db8 | ML v2 stacks fit 2019-2023 (both primaries' weights) |
| data/derived/ratings.json | 5fc4f8a3be14051f | whr_rounds, ratings stack |
| data/derived/preufc.json | 30111c93e864dfe0 | debut seeding betas, roster_priors |
| data/derived/blindtest_stack.json | ded17ce026bbff29 | MoE stacks (close, open, no line = models.moe_noline) |
| data/derived/debut.json | f6709d52292ccc83 | debut method model, debut winner model, roster_gnet |
| data/derived/statlines.json | 30c3a959a1a3ac2a | stat-line tables ("prod") and finish-time table |
| data/derived/embed_model.json | 061d9fba48cc6633 | embedding (stat-line inputs) |
| data/derived/oppadj.json | c27c8c6de3733c59 | oppadj roster factors (stat-line inputs) |
| versions/v4/engine3.js | 6c661f68a4c41c1d | engine 4.0.0 |
| versions/v4/params3.js | e16a6481319f9b15 | params 4.0.0-selfcal-pre2024 |
| versions/v4/ml/mlrates.js | b563032dd9468f7b | MLRates evaluator (engine adapter and stat-line inputs) |
| src/ml/moe.js | ad1097b488bbb3ac | MoE evaluator |
| src/ml/mlpage.js | d4c72febf5c57666 | ML page evaluator |
| src/ml/ml2.js | 0b62c4462dd7a915 | ML v2 evaluator (re-pinned, see below) |
| src/ml/debut.js | e5bbc188f4cf42c9 | debut model evaluator and side builders |
| src/ml/statdist.js | c7facbbc4b406be1 | stat-line evaluator |
| src/ml/embed.js | e3fa72fd6c0b140b | embedding evaluator |
| tools/methodround_model.js | fea58a2f9beff3ca | method-and-round evaluator (re-pinned, see below) |

- **Re-pin of two evaluators.** Two files moved from their fwd-4.2 hashes: src/ml/ml2.js (`a840ae6ad9e6bcc3` to
  `0b62c4462dd7a915`) and tools/methodround_model.js (`60d90d231bb4300f` to `fea58a2f9beff3ca`). Both gained additive
  code for engine v6 (autosaves at 6:09 and 6:27 am UTC, Nov 7):
  - ml2.js: `termValues`, `baseTerm` and an optional term-recording argument;
  - methodround_model.js: `features` and `createS2`, with `predict` refactored through `features`.
- **The re-pin changes no ledger number.** Two checks ran before this pre-registration:
  - with the current files, tools/forward_ledger.js on tests/fixtures/forward_v41_golden.json's input reproduces both
    golden outputs byte for byte;
  - a UFC 334 `--fwd 4.2 --dry-run --sims 300`, run from a copy of the tree with the two fwd-4.2-pinned versions
    restored, equals the same run on the current tree. The comparison covers every field except the run's timestamp,
    commit and code hashes.
- These two files also make a fwd-4.2 write refuse today. fwd-4.2 keeps its own pins.
- **Per-event inputs.** As in fwd-4.2.
- **Tool code.** `tools/forward_ledger.py` 1.3 (`predict --fwd 4.3`), `tools/forward_ledger.js` (`--fwd 4.3`) and
  `tools/forward_statlines.js`.
  - The code is written after this commit. The implementation commit and the code hashes go into a dated addendum
    below before any fwd-4.3 file exists. Each fwd-4.3 file records the code commit and those hashes.
  - The fwd-4.1 and fwd-4.2 outputs of the same tools stay byte-identical. The tests compare them with
    tests/fixtures/forward_v41_golden.json and with a fwd-4.2 fixture captured from the current code before the edit.
- **Version switch.** `--fwd auto` (the default) picks fwd-4.3 for events dated 2026-11-14 or later and fwd-4.1 before.
  Writing a ledger file under any other version is refused; dry runs may use any.
- **Version string.** `model.version` starts `fwd-4.3:`. It names both primaries (`ml2_stack_open` with a line,
  `ml2_stack_noline` without), the forward_models.json hash, the debut.json and statlines.json hashes and the engine.
  `model.preregistration` names this section and the pinned table.

### Addendum: fwd-4.3 implementation (Nov 7, 2026, about 7:40 am UTC; before any fwd-4.3 file)

The code was written after the pre-registration commit (386b99c, 7:32:17 am UTC). It follows the rules above without
changing them. The repository's periodic autosave commits picked up some in-flight edits between the two commits; none
of them is a ledger file.

- **UFC 334 dry run** (`predict --event 2026-11-14 --fwd 4.3 --dry-run`, 2,000 sims per corner order). It wrote nothing
  under data/predictions and read every pinned input at its pinned hash (`pinned_inputs_ok` true).
  - On all 11 bouts without a debutant, `p_a_noline` comes from the ML v2 no-line stack. Elder vs Sanches keeps
    seeded Elo.
  - Every UFC 334 bout has a line in the newest snapshot, so `p_a` is the same as under fwd-4.2.
- **Tool code hashes** (sha256, first 16 hex), recorded in every fwd-4.3 file as `model.code_sha256_16`:
  - `tools/forward_ledger.py` (1.3): 7678ea131cc16990
  - `tools/forward_ledger.js`: 21cfa219be5910a7
  - `tools/forward_statlines.js` (unchanged): 267beac95846c7df
- **What the code adds.**
  - JS `--fwd 4.3`: `models.moe_noline` and `meta.fwd`.
  - Python `predict --fwd 4.3`: `p_a_noline` from `models.ml2_stack_noline`; the MoE fallback with `noline_fallback`;
    `p_a_noline_source`; the model-block fields `noline_primary`, `noline_fallback` and `drift_rule_b`; a
    `preregistration` block with the fwd-4.3 pins and the audit-1 flag; tool 1.3.
  - `--fwd auto` picks fwd-4.3 from 2026-11-14.
  - `score` is unchanged apart from listing `moe_noline` in its models-block order. The rule (b) monitor is not part of
    this code; it belongs to cycle 4.
- **Tests.**
  - `node tests/test_forward_v43.js` checks:
    - fwd-4.1 identity against tests/fixtures/forward_v41_golden.json, across the re-pin;
    - fwd-4.2 identity, JS and ledger documents, against tests/fixtures/forward_v42_golden.json;
    - that fwd-4.3 differs from fwd-4.2 only in the pre-registered fields;
    - corner symmetry;
    - that the no-line stack equals forward_models.json's Python test vectors to 1e-12 (27 vectors, max 6e-17);
    - the `noline_fallback` path, with a fighter removed from a temporary copy of ml2.json;
    - the version guards, and that this README's hash table and code hashes match the tool and the files on disk.
  - tests/fixtures/forward_v42_golden.json was captured at 7:33 am UTC from the tools before the edit. Their hashes at
    capture are in the fixture.
  - In tests/test_forward_v42.js, two assertions now expect fwd-4.3 where the README assigns it: the `--fwd auto` pick
    and the refusal message.
- A later edit to these files must keep the fwd-4.1 and fwd-4.2 outputs byte-identical and the fwd-4.3 output
  unchanged, or it starts a new version.

## Forward model v4.4 (Nov 7, 2026)

Pre-registered on Nov 7, 2026, about 11:30 am UTC, before the code that implements it (`tools/live_refresh.py` and
`--fwd 4.4`). The repository's autosave committed this text first, at 11:30:05 am UTC (5321d1c, together with unrelated
v10 gate files); the README-only commit that follows it marks the pre-registration. At that time no file with a `model.version` starting `fwd-4.2`, `fwd-4.3` or
`fwd-4.4` existed and no UFC 334 prediction existed. The only ledger file was the Vegas 124 file (Nov 7, `fwd-4.1`,
lock 10:00 pm UTC Nov 7), which this section does not touch. No forward result had been recorded (there is no
results.json). The newest UFC event in the Greco1899 CSVs was UFC Fight Night: Moicano vs. Nolan (Oct 31), the same as the
fwd-4.3 snapshot. The input audit behind this section is research/live_inputs_audit.md (commit 7de2fa5).

- **Scope.** fwd-4.4 applies to every ledger file for an event dated **2026-11-14 (UFC 334) or later**, until a later
  section of this README says otherwise. It supersedes fwd-4.3 for those events. No fwd-4.3 file was ever written, so
  none will be; `--fwd 4.3` and `--fwd 4.2` stay available for dry runs with their output unchanged (tested). Events
  dated before 2026-11-14 stay `fwd-4.1`.
- **What changes: the inputs only.** The models, weights, evaluators, columns, primaries, fallbacks, flags, debut
  handling, method, stat-line block, scoring and drift-rule column are exactly fwd-4.3's. No weight is refit, no
  hyperparameter is re-selected, and no model is added or removed. What changes is the per-fighter state those frozen
  models read: the roster-level inputs are rebuilt with the newest completed fights before each card, instead of
  staying at the Oct 31 snapshot that fwd-4.3 pins.
- **Forward results enter as state only.** Results of ledger events (Vegas 124 and later) reach the inputs the same way
  any completed UFC fight does: as rating, record and stat updates under frozen parameters. They are never used to tune
  anything (rule 5).

### 1. Live inputs

`tools/live_refresh.py build` writes the live files to `data/derived/live/` with `data/derived/live/manifest.json`.
Each live file is a copy of its fwd-4.3 pinned file in which only the live part below is rebuilt. Every other key is
copied byte for byte and guarded.

| live file | replaces (fwd-4.3 pin) | live part (rebuilt at the cutoff) | how (frozen parameters) |
|---|---|---|---|
| `fighters_live.json` | fighters.json `df4d868a2195fb4a` | `fighters` (profiles, Elo), `priors`, `meta.snapshot`, `meta.n_fights`, `meta.n_stat_fights` | tools/build_db.py's parse, people, vectors, walk and priors functions. Elo with elo_report.json's chosen K 44 and boost 1.5 (not re-selected), half-life 730 d, roster since 2021-01-01, live priors from fights 2018-01-01..cutoff. Profiles carry exactly the pinned profile keys: today's build_db adds five durability keys (`ko_losses_365`, `kd_absorbed_365`, `last_ko_loss`, `layoff`, `ufc_years`) and `dur`, which the pinned file does not have; they are dropped (audit section 1, finding 6). |
| `market_live.json` | market.json `8edb0a6cc9c3ca4f` | `ratings` | Kalman continuation of the stored state with eval.market_rating.params (sig_m 0.5, tau 0.5 per year, v0 1.5, kappa 1.5): for each completed bout after the stored state's snapshot, var at the fight = min(sd^2 + tau^2 x days since the snapshot / 365.25, 2 v0); then tools/market.py `run_rating`'s line update and result update; then every sd is drifted to the cutoff. A fighter new to the stored state starts at (mu0 0, v0). Exact up to the 4-decimal rounding of the stored mu and sd (audit section 4.1). |
| `ratings_live.json` | ratings.json `5fc4f8a3be14051f` | `roster` | tools/ratings.py `load_data`, `prepare`, `run_system` for each of the 11 systems with ratings.json's stored params, `run_dims` with the stored dim_params, `roster_states(ref_day = cutoff)`. |
| `ml_live.json` | ml.json `444b7b1e62086cc1` | `roster` (with `mr_mu` / `mr_sd` from market_live.json ratings), `page_model.snapshot` | tools/ml.py `load_all`, `run_elo`, `margin_elo` with ml.json `tuning.margin_elo`'s stored K and w (160 / 0.8 sig, 160 / 0.9 judge; not re-tuned), `build_table`, `roster_features`, and the export's 6-significant-digit rounding. |
| `ml2_live.json` | ml2.json `0837826dbc05cd1f` | `page_model.roster`, `page_model.snapshot` | The roster as tools/ml2.py `page_model()` builds it, with the stored `keys`, `rating_systems` and `pre_keys`: `v` from ml_live.json's roster; `mr` from market_live.json; `pre` from preufc.json `current` (the pinned preufc.json, unchanged) through `preufc.side_pre`; `r` = the four rating systems (elo_full, glicko2, trueskill_mov, whr_rounds) re-run through the cutoff with ratings.json's stored params and tools/ratings.py's pre-review `opp_ufc_w` count (`OPPUFC_CLEAN = False`). The pinned ml2.json roster was exported against the ratings.json build of 4:44 pm UTC Nov 6, before the review fix rebuilt ratings.json at 8:42 pm, and the ML v2 logistic's training features came from that code; with this setting the live builder reproduces the pinned `r` block exactly at the Oct 31 cutoff (checked before this pre-registration: 0 of 1,229 rows differ). |
| `methodround_live.json` | methodround.json `b26b7e373367f346` | `js_model.extras`, `js_model.priors` | tools/methodround.py's walk-forward table and state through the cutoff, exported with `export_js_model`'s own extras and priors code. The coefficients, scalers, `draw_c`, `fit_through` and `source` are copied. |
| `oppadj_live.json` | oppadj.json `c27c8c6de3733c59` | `roster` | tools/oppadj.py's roster-factor code with the stored `chosen` configs, lambda and kappa and the stored engine k values, at T = cutoff + 1, on fighters_live.json's S and live priors. |

- **Not refreshed in fwd-4.4** (read at their fwd-4.3 pins): every weight file (moe_page, mlrates, forward_models,
  blindtest_stack, statlines, mr_s2), preufc.json, debut.json (its `roster_gnet` stays as of 2026-01-01) and
  embed_model.json (its roster stays at the 2026-01-01 refit). Catching the last two up is a new builder semantics
  (light updates with frozen loadings; re-rating against the frozen network) with no pinned cutoff to test against.
  They feed no winner probability except the veteran side of a debut bout's method model, and a later version may add
  them. Debutant seeds (`data/predictions/debutants_*.json`) stay per-event inputs, as in fwd-4.1.
- **Zero-diff rule.** Run with `--cutoff 2026-10-31`, the builder must reproduce each live file's live part equal to the
  pinned file's: the same JSON values after the pinned file's own rounding, apart from build timestamps (`built`). Where
  a pinned file was itself built from older inputs or code, every differing value must be explained by that, in the
  implementation addendum. A live file that fails this at the implementation commit is not used: fwd-4.4 reads that
  input at its fwd-4.3 pin, and the addendum names it. The tests repeat the check.
- **Guards.** The builder refuses to write when any frozen key of a live file differs from the pinned file, when a
  frozen weight file's hash differs from its fwd-4.3 pin (checked before and after the build), or when it would write
  outside `data/derived/live/` (and its own scratch under out/). It never writes data/derived/*.json, backtest*,
  `*_oof*`, version_history.json, research tables or the sealed vault directory, and it never calls a builder's `main`.

### 2. Results, odds and the cutoff

- **Results.** The Greco1899 scrape_ufc_stats CSVs (ufcstats; User-Agent "FightLabSim/1.0"), fetched at an upstream
  commit that the manifest records by SHA, with each file's sha256. Fights dated on or before 2026-10-31 are taken as
  the pinned build took them. A bout dated after 2026-10-31 enters only when ESPN's public scoreboard (the second
  source, as for `score`) lists it and agrees on both fighters, the winner (or no winner for a draw or no contest), the
  final round, and finish versus decision; and when ufcstats has per-round stats for both men through that round. A
  bout that fails stays out of the live inputs and is listed in the manifest with the reason. data/raw is never
  written: the fetched CSVs are kept under out/ and only their hashes go into the manifest.
- **Cutoff.** `as_of` = the date of the latest event the live inputs include. Every snapshot convention follows the
  pinned builders with `as_of` as the snapshot: fighters `meta.snapshot`, ratings `ref_day`, market sd drift, ml.json and
  ml2.json `page_model.snapshot`, and league priors through `as_of`.
- **Odds** (market rating only). The closing line of a completed bout is the last pre-fight capture in the odds timeline
  (data/predictions/odds_snapshot_*.json via tools/odds_upcoming.py, phase `pre_start`): the BestFightOdds sportsbook
  mean, multiplicative no-vig (`bfo_p_a_novig`), the same construction as `score`'s closing proxy and market.json's
  `p_close_mult`. Nothing captured after a bout's start is used, and neither are exchange prices. A bout with no
  pre-fight capture updates by its result only, as `run_rating` does when a line is missing, and the manifest lists it.
- **When.** The refresh is run after the Greco1899 refresh that carries the previous card and after its results pass
  the two-source check, and it is committed before the event's prediction file. If the upstream refresh slips, the
  latest verified `as_of` is used; that is not a failure, and the manifest and the prediction file record which.

### 3. Manifest and what each fwd-4.4 file records

- `manifest.json`: `as_of`, built time (UTC), the code commit, the sha256 of tools/live_refresh.py and of each builder
  module it imported, the upstream Greco1899 commit and file hashes, the ESPN pages read, the odds snapshots read, the
  bouts added after 2026-10-31 and the bouts held out (with reasons), the frozen parameters used, each live file's
  sha256, the guard results and the zero-diff status of each live file.
- Each fwd-4.4 prediction file records `model.live_inputs`: the manifest path and sha256, `as_of`, each live file's
  sha256, the Greco1899 commit, and `fallback` (true or false, with the reason).

### 4. Fallback

fwd-4.4 reads the live set all or nothing. It falls back to fwd-4.3's pinned inputs (data/derived at the fwd-4.3 hashes)
for every live input, records `model.live_inputs.fallback` = true with the reason, and flags every bout
`live_inputs_fallback`, when any of these holds at prediction time:

- `data/derived/live/manifest.json` is missing or unreadable, or a live file is missing;
- a live file's sha256 differs from the manifest;
- a guard fails when re-checked (a frozen key of a live file differs from the pinned file);
- the manifest's `as_of` is before 2026-10-31, or it was built at or after the event's lock;
- the manifest says a live file failed its build or its zero-diff check.

With the fallback, every number equals what fwd-4.3 would publish. Writing a fwd-4.4 file is refused only when the
fallback inputs themselves fail fwd-4.3's pinned-hash check.

### 5. Version switch, version string, scoring

- **Version switch.** `--fwd auto` (the default) picks fwd-4.4 for events dated 2026-11-14 or later and fwd-4.1 before.
  Writing a ledger file under any other version is refused; dry runs may use any.
- **Pinned files.** fwd-4.3's table, with the seven files above checked through the manifest instead of a fixed hash
  (fighters, market, ratings, ml, ml2, methodround, oppadj); the pinned copies must still match fwd-4.3 for the
  fallback. Every other file and evaluator keeps its fwd-4.3 hash.
- **Version string.** `model.version` starts `fwd-4.4:` and names both primaries, the forward_models.json, debut.json and
  statlines.json hashes, the engine, and the live inputs' `as_of` and manifest sha256 (or "fallback: fwd-4.3 pinned
  inputs"). `model.preregistration` names this section.
- **Scoring.** Exactly as fwd-4.3. fwd-4.4 is a separate tally from any other version.
- **Tool code.** `tools/live_refresh.py` (new), `tools/forward_ledger.py` 1.4 (`predict --fwd 4.4`),
  `tools/forward_ledger.js` (`--fwd 4.4` and the input-folder option) and `tools/forward_statlines.js` (the same
  option). The implementation commit and the code hashes go into a dated addendum below before any fwd-4.4 file
  exists. The fwd-4.1, fwd-4.2 and fwd-4.3 outputs of the same tools stay byte-identical (golden fixtures captured from
  the current tools before the edit).
- **The page is out of scope.** This section changes nothing on the page, in build.py or in src/app.js.

### Addendum: fwd-4.4 implementation (Nov 7, 2026, about 12:00 pm UTC; before any fwd-4.4 file)

The code was written after the README-only pre-registration commit (f963070, 11:30:24 am UTC). It follows the rules
above without changing them. The repository's autosave commits picked up in-flight edits between the two commits; none
of them is a ledger file, and none touched a data/derived input, a backtest or evaluation file, or the vault.

- **Tool code hashes** (sha256, first 16 hex), recorded in every fwd-4.4 file as `model.code_sha256_16`:
  - `tools/forward_ledger.py` (1.4): f8aec0838cc8d8df
  - `tools/forward_ledger.js`: 39e0ae0596d54455
  - `tools/forward_statlines.js`: a8ae3e47c01e87e6
  - `tools/live_refresh.py` (1.0): 53f6bfd3777960ac
- **Zero-diff rule** (`python3 tools/live_refresh.py regress`, cutoff 2026-10-31 on the pinned Oct 31 CSVs, Greco1899
  3d4886d). Every live file reproduces its fwd-4.3 pinned file **byte for byte**: fighters `df4d868a2195fb4a`, market
  `8edb0a6cc9c3ca4f`, ratings `5fc4f8a3be14051f`, ml `444b7b1e62086cc1`, ml2 `0837826dbc05cd1f`, methodround
  `b26b7e373367f346`. The builders take 25 s. Two details make the bytes match:
  - ratings.json stores elo_ref's K rounded to 6 decimals (0.253284). elo_ref is untuned (tools/ratings.py specs:
    K = 44 x ln 10 / 400, the pipeline's Elo K 44 in logit units), so the builder runs that exact value; with the rounded
    value, 4 of the 1,229 elo_ref means flip in the 4th decimal.
  - The ml2 `r` block uses tools/ratings.py with `OPPUFC_CLEAN = False`, as section 1 says (0 of 1,229 rows differ).
- **oppadj.json stays at its fwd-4.3 pin.** tools/live_refresh.py 1.0 has no oppadj roster builder (oppadj.py's roster
  factors need its full walk data object, its stored `chosen` configs and the engine k values), so under the zero-diff
  rule fwd-4.4 reads oppadj.json at `c27c8c6de3733c59`, and the manifest says so (`not_live`). oppadj feeds only the
  stat-line block, not any winner probability. Adding it later is a new version.
- **Details the rules leave open, settled here.**
  - Market stream membership after Oct 31 follows tools/market.py for fights after nlbair's window: backtest-type
    bouts only (both men with a prior UFC fight, no ambiguous name). A debut bout is listed in the manifest
    (`not_in_stream`) and is not a market update, as it would not be in a market.py rebuild either.
  - `as_of` is the date of the newest event that passed the two-source check. An event ESPN does not list (or where no
    bout passes) stops the cutoff before it; later events wait for the next refresh.
  - The Greco1899 CSVs carry trailing spaces in some EVENT fields; events and bouts are matched on stripped text.
  - A debutant who fights after the snapshot enters the live roster under his ufcstats slug. The card snapshot
    (cards_upcoming.json) must then carry that slug for him to be treated as a veteran on a later card; with a `null`
    slug he stays a debutant, as in fwd-4.3.
- **First build** (`python3 tools/live_refresh.py build`, Nov 7, 11:47 am UTC): Greco1899 HEAD 3d4886d ("2026-11-01 data
  refresh") has no event after Oct 31, so `as_of` = 2026-10-31, no bout was added or held out, and every live file equals
  its pin. The live set is rebuilt and committed after this addendum (its manifest records the implementation commit).
- **UFC 334 dry run** (`predict --event 2026-11-14 --fwd 4.4 --dry-run`, 2,000 sims per corner order). It reads the live
  set (`live_inputs.used` true) and writes nothing under data/predictions. Every bout field equals the fwd-4.3 dry run
  on the same day; only the model block differs (version, tool, fwd, live_inputs, preregistration, inputs, code hashes).
  So no UFC 334 fighter's input changed yet, and the largest p_a change is 0. Vegas 124 (tonight) reaches the Greco1899
  CSVs with the Sunday refresh, about 6:00 pm UTC Nov 8.
- **Sensitivity check** (diagnostic only, not an input; scratch build in out/live_refresh/sens_oct25). The same builders
  run on the Oct 25 upstream refresh (5d6622f, events through Oct 24) and compared with the Oct 31 inputs on the UFC 334
  card measure what one card of results (Oct 31, 13 bouts) does to UFC 334, whose fighters did not fight that week. Largest
  changes: ml2_stack_open (primary) 0.0006, ml2_stack_noline 0.0009, ml2_lr 0.0011, whr_rounds 0.0044, ratings_stack
  0.0027, Elo 0. The market file was held at its Oct 31 state in both runs.
- **Tests.**
  - `python3 tests/test_live_refresh.py` (60 checks, about 65 s): the market continuation against tools/market.py
    `run_rating` on a synthetic stream (to the stored 4-decimal rounding; exact up to rounding ties from an unrounded state);
    the two-source rule on the Dec 13, 2025 card (12 of 12 pass; a changed winner, round or finish class, a missing stats
    round, a bout missing on ESPN and an unavailable scoreboard are held out or stop the cutoff); filtered CSV copies;
    `check_live` on the live folder and 8 tampered variants; the pins; the zero-diff rule; and an integration build on a
    synthetic post-snapshot card in a temporary folder (as_of moves, participants change, non-participants keep their Elo
    and career sums, every guard holds).
  - `node tests/test_forward_v44.js`: fwd-4.3, fwd-4.2 and fwd-4.1 ledger documents and the fwd-4.3 JS output
    byte-identical to tests/fixtures/forward_v43_golden.json (captured at 11:34 am UTC from the tools before the edit, code
    hashes at capture = the fwd-4.3 addendum's); fwd-4.4 = fwd-4.3 on equal inputs; the fallback (missing folder, changed
    frozen key) gives fwd-4.3's numbers flagged `live_inputs_fallback`; a changed live market rating moves only its bout;
    corner symmetry; the version guards; this hash list.
  - tests/test_forward_v43.js and tests/test_forward_v42.js now expect fwd-4.4 where `--fwd auto` and the refusal
    messages name the version for events from 2026-11-14.
  - tools/drift_monitor.py: a fwd-4.4 file is read like a fwd-4.3 file (its `p_a_noline` is the ML v2 stack, never the
    MoE series). No number changes; no fwd-4.4 file exists.
- **Runbook per card.** After the Greco1899 Sunday refresh: `python3 tools/live_refresh.py build`, check the manifest
  (`python3 tools/live_refresh.py show`: as_of, bouts added and held out), commit data/derived/live/, then
  `predict --event <date>` (fwd-4.4 by default) before the lock. If the build fails or is not run, the prediction file
  falls back to fwd-4.3's pinned inputs and says so.

## Drift monitor (Nov 7, 2026; engine cycle 4 tooling, no model change)

`python3 tools/drift_monitor.py ledger` regenerates `drift_monitor.json` from the scored files (the same file selection as
`score`). It runs docs/V6_V10_PLAN.md 6.5.1's "cycle 4 monitor" and changes no prediction. It was built in cycle 4 (v9, whose
engine failed its train gate; the monitor is not part of any engine). Its rules were written into data/derived/version_history.json
v9 `drift_monitor` before any ledger bout was scored, independent of vault audit 1:

- **Rule 6.5.1 (b), unchanged.** Trigger series `p_a_noline` and tracked series the MoE no-line stack, as in "Drift rule
  6.5.1(b): the column it reads" above; trailing-200 mirrored slope with a Wald 95% CI at every calendar quarter end
  (tools/calib.py `drift_rule_b`); the rule fires at the first quarter end whose check and the previous one's are ready and both
  include 1. A firing switches the production no-line stack to h 3, T 1 through a new fwd version with a README addendum first.
- **Level alarms** (research/model_eradrift.md 7.5, plus the decision share of research/model_props.md): over the trailing 200
  scored bouts at each quarter end, calibration in the large of the decision share (`p_distance`), the KO/TKO share and the
  round-1 share of finishes (`p_finish_round`), and the realised / predicted ratio of sig strikes landed, control, takedown
  attempts and knockdowns (the `statlines` block against `statlines_results.json`). An alarm fires when the 95% CI of the gap
  excludes 0 at two consecutive quarter ends (the rule-(b) clock). An alarm opens a review that may pre-register a new candidate;
  it never applies a tilt, and forward results still never tune a model between milestones.
- **Breaks.** Dated, pre-announced changes (equipment, rules, judging criteria) are listed in the file with their effective date
  and source and flagged on every check whose window spans them. They are variance interventions, never fitted tilts.

## Props capture (Nov 7, 2026; recorded, never scored)

Engine v7 work (docs/V6_V10_PLAN.md cycle 2, work item 6). Before each lock, next to the odds snapshot:

    python3 tools/props.py capture                    # data/predictions/props_snapshot_<UTC>.json (raw per-book prices + consensus)
    python3 tools/props_ledger.py --event <date>      # data/predictions/<date>_<slug>.props.json (write-once, read-only)

`<date>_<slug>.props.json` holds, per ledger bout, the de-vigged props consensus (power de-vig per family per book, mean over
books: the one de-vig of training, `tools/props.py capture` and src/ml/propspool.js) oriented to the ledger's a / b, the props
and odds snapshots used and the minutes between them. **No forward model version reads or scores it.** It exists so a later
version that uses props can be checked against timestamped T-25h..T-8h props (the props pool was fit on closing props). Such a
version needs its own pre-registration here first. Engine v7 failed its train gate (docs/CHANGELOG.md v7), so no fwd version
uses props. tools/forward_ledger.py is unchanged, and so is the code hash the fwd-4.2 / fwd-4.3 addenda pin.

## Card snapshot notes (`cards_upcoming.json`)

- `order` 1 is the main event, then down the card. `segment` is `main`, `prelims`, `early_prelims`
  or `unknown` (not slotted yet).
- `status` is `official` (on the UFC-fed ESPN feed or announced by the UFC), `reported` (booked per
  at least two outlets, not yet on a UFC-fed listing), `rumoured` (single-origin report) or `doubtful`
  (sources conflict). The full definitions are in the file's `schema` block.
- `open_slots` lists fighters still booked without an opponent, and `removed` keeps cancelled or moved
  pairings for the audit trail. `prior_ufc_meetings` flags rematches.
- `verification` records the latest independent re-check of the snapshot: what was checked, what
  changed, the bout counts by status, and the `as_of` it replaced.
- `unreachable_sources` lists hosts that could not be fetched when the snapshot was taken
  (ufcstats.com, ufc.com and tapology.com were blocked in the Nov 6, 2026 session). Refresh the
  snapshot, ideally against ufc.com, before writing each event's prediction file.
