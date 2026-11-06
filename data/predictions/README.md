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
`fwd-4.1` instead (section "Forward model v4.1" below: the primary `p_a` and every scored secondary model).
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
- `p_a` = the line, and the method comes from division base rates, as in fwd-1.
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
- On Nov 6 no seed exists for the four debutants on the Nov 7 and Nov 14 cards (Degli, Lourenço, Calderon, Sanches).

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
  the close, with an event-cluster bootstrap 95% interval.
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
