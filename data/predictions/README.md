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
`p_a_noline` is the same stack without the line, and both are scored. `python3 tools/forward_ledger.py score`
fetches results for finished ledger events (ufcstats through the Greco1899 CSVs and ESPN's scoreboard as the
second source), appends them to `results.json` and regenerates `scores.json` / `scores.md`. The backtest-side
counterpart is `tools/blindtest.py` (event-by-event replay of 2024-2025, `research/model_blindtest.md`).

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
