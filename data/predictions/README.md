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
stat-line block; `--fwd` picks the version by event date).
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
