# tools/

Offline scripts that turn the UFC stats snapshot into the data the v3 engine, the calibration harness
and the page read. The contract for every output is `docs/ENGINE_V3_SPEC.md`; this file explains how
the pipeline gets there and how to add or override a fighter.

## build_db.py: the data pipeline

```
python3 tools/build_db.py                    # from the project root, about 5 seconds
python3 tools/build_db.py --half-life 540    # decay half-life for the S sums, in days (default 730)
python3 tools/build_db.py --roster-since 2019-01-01   # who goes in fighters.json (default 2021-01-01)
```

Needs Python 3 with pandas and numpy (no scipy, no network). Rerun it whenever `data/raw/` changes.

### Inputs (data/raw/, ufcstats.com via Greco1899/scrape_ufc_stats)

| File | Used for |
|---|---|
| ufc_event_details.csv | event dates (the snapshot date is the last event) |
| ufc_fight_results.csv | bouts, outcome, method, round/time, time format, weight class, judges' cards |
| ufc_fight_stats.csv | round-by-round stats per fighter ("x of y" strings, CTRL "m:ss") |
| ufc_fighter_details.csv | canonical names (they match the bout names) and nicknames |
| ufc_fighter_tott.csv | height, reach, stance, DOB, listed weight |

### Steps

1. **Clean and parse.** Every field is stripped. Fight id = the ufcstats fight URL id. The scrape lists
   two Noche UFC cards twice under different event names: one copy per fight URL is kept. Fights whose
   event has no date in ufc_event_details.csv are dropped and listed in `meta.excluded_fights`
   (currently the two bouts of "UFC - Road to UFC 4.6"). Outcome `W/L` / `L/W` maps to the two names
   in `BOUT` in order; `D/D` draw; `NC/NC` no contest. Division = the weight-class string reduced to a
   division name (`UFC`, `Interim`, `Title`, `Tournament`, TUF / Road to UFC season words dropped;
   "Super Heavyweight" counts as Heavyweight; early no-class tournaments are Open Weight).
   `title` = championship bouts (undisputed, interim, "Superfight Championship"); TUF and Road to UFC
   tournament finals are flagged `tourn` instead.
2. **Time.** Round lengths come from `TIME FORMAT` ("3 Rnd (5-5-5)", "3 Rnd + OT (5-5-5-5)",
   "1 Rnd + OT (12-3)" ...; "No Time Limit" = one open round). Minutes in a stats round = the scheduled
   length, except the final round = `TIME`. Total fight seconds = earlier rounds + `TIME`.
3. **People.** Bout names are matched to ufcstats people (fighter URL ids): first the fighter-details
   name, then the tott name (catches renames like "Kai Kamaka" / "Kai Kamaka III", "Patricio Freire" /
   "Patricio Pitbull"), then `MANUAL_ALIASES` in the script ("Nick Galanti", "Rafael Cerquiera"), then a
   strict fuzzy match. Merges are listed in `meta.aliases`. Nine names belong to two different people
   in ufcstats (Anthony Figueroa, Anthony Romero, Bruno Silva, Jean Silva, Joey Gomez, Michael McDonald,
   Mike Davis, Tony Johnson, Victor Valenzuela). Each of their bouts is assigned by the listed weight
   closest to the division limit (needs a 10 lb margin), otherwise to the same person as that name's
   nearest confidently assigned bout within 4 years; anything still open becomes an `amb:` person that
   is kept out of the roster, the priors and the backtest. All bouts resolve in this snapshot; Bruno
   Silva becomes `bruno-silva-bulldog` (flyweight) and `bruno-silva-blindado` (middleweight). The
   report is `meta.ambiguous_names`. A tott row stored under a fighter's URL with a different name and
   an implausible weight is ignored (`meta.tott_distrusted`: Tyrell Fortune carries Regina Malpica's row).
4. **Per-fight vectors.** Round stats are summed per fighter into the spec's sum keys (what he did, what
   was done to him, results, 5-round pace pieces). Fights without round stats (a few 1990s bouts) count
   for the record, Elo and `n_fights` but not for the sums.
5. **Elo.** Walk-forward over every fight since 1994 (start 1500, scale 400, draws 0.5, NCs skipped),
   K grid 16..80 x boost {1, 1.5, 2, 2.5} for a fighter's first 5 UFC fights; chosen by log loss on
   2019-2023 decisive fights where both men had a prior UFC fight, then reported on 2024+.
6. **Walk-forward.** Fights in date order (bout order inside an event). Before each fight both men's
   decayed sums are snapshotted as of that date, built only from earlier fights; then the fight is
   added. Eligible fights (2019-01-01 on, both with a prior UFC fight, no `amb:` person) become
   backtest entries. At the end every S is decayed to the snapshot date.
7. **Priors.** Fights since 2018-01-01, per division and ALL.

### Outputs

**data/derived/fighters.json** (about 2 MB; the page inlines it). Spec "Profile format":
`meta` (source, snapshot, built, half_life_days, roster_since, keys, notes, ambiguous_names, aliases,
tott_distrusted, excluded_fights), `priors` (same object as priors.json), `fighters` keyed by slug
(ascii, lowercase, hyphenated name; namesakes get the nickname appended). Each fighter: `name nick id
dob height_in reach_in stance division divisions record last_fight n_fights n_5rd ko_losses
kd_absorbed elo S C pace pace_w recent`.

- `S` / `C`: sums in `meta.keys` order, decayed (`0.5 ^ (days before snapshot / half_life)`) and
  career. Keys: the spec list plus `r5_min_1..r5_min_5` (minutes in each round of 5-round fights, the
  denominators the pace curve needs). Divide by exposure and shrink toward priors in the engine.
- `record`: `w l d nc ko_w sub_w dec_w ko_l sub_l dec_l dq_w dq_l`; KO includes doctor and corner
  stoppages; Overturned and Could Not Continue are NC; DQ has its own fields.
- `ko_losses`: KO/TKO losses by strikes or corner stoppage (doctor stoppages excluded), for chin aging.
- `division`: most frequent division over the 3 years before the snapshot (catch and open weight
  ignored), else career.
- `pace` / `pace_w`: sig landed per minute by round in his 5-round fights relative to round 1, with the
  minutes per round as weights; 3-round fights for rounds 1-3 (and null for 4-5) when he has no
  5-round fights.
- `recent`: last 6 fights, newest first: `date opp res method rd time wc title`, plus `how` (ufcstats
  finish detail) for KO/TKO and submission finishes.

**data/derived/priors.json**: `{meta, priors}`; `priors[division]` holds `lbs`, `n_fights`,
`fighter_min`, every sum key per fighter-minute (the league-average fighter), accuracies `acc_d acc_c
acc_g acc_h acc_b acc_l acc_t acc_sig`, `slpm`, `kd_per_h` (knockdowns per landed head strike), `kd15`,
`td_acc`, `td15`, `ctrl_per_td` (control seconds per takedown landed), `ctrl15`, `sub15`, `sub_conv`
(submission wins per attempt), `kd_fin` (share of rounds with a knockdown that the knockdown scorer
finished by KO/TKO), `fin3`/`fin5` (finish split by round: KO and SUB arrays, DEC, DRAW, OTH, n),
`dec3`/`dec5` (UD/SD/MD shares), `pace3`/`pace5`, `mpf3`/`mpf5`/`mpf` (minutes per fight). Open
Weight has no fights since 2018 and carries the ALL rates with `fallback: "ALL"`.

**data/derived/backtest.json** (about 5 MB, for tools/calibrate.js; not inlined in the page):
`{meta, fights}`. Each entry: `id date event division rounds title [tourn] A B result actual`.
A = first name in the ufcstats bout. Sides carry `slug name age n ko_losses kd_absorbed elo home
height_in reach_in stance pace pace_w S`, all as of the fight (S decayed to the fight date; `n`,
`ko_losses`, `kd_absorbed`, `pace`, `home` and `elo` from earlier fights only). `result`: `winner`
(A, B, D, NC), `method` (KO, SUB, UD, SD, MD, DRAW, DQ, NC, DOC, CNC), `round`, `time_s` (seconds into
the final round), `fight_s` (total), `detail` (finish detail, or the cards), `cards` ([A, B] per
judge; ufcstats writes them loser-first, order unknown for draws), `corner` for corner stoppages.
`actual`: per side `sig_lnd sig_att kd td_lnd td_att ctrl sub_att h_lnd b_lnd l_lnd`, plus `minutes`.

**data/derived/elo_report.json**: rule, chosen K and boost, the grid with tuning metrics, 2019-2023
and 2024+ log loss / Brier / accuracy, 2024+ calibration bins.

**data/overrides.json** is created only when missing (appearance placeholders for the default matchup
copied from the v2 rig SPECS); after that it is hand-edited and never overwritten.

### Checks the script prints

Career numbers for Volkanovski and Gaethje should match ufcstats: Volkanovski 5.98 landed / 3.33
absorbed per minute, 34% takedown accuracy, 67% takedown defense; Gaethje 6.29 / 6.83, 27% / 73%.
A random-entry recomputation of backtest snapshots from raw per-fight vectors matched to rounding.


## Engine v4 tooling: train-only priors, judges' fit, standard evaluation

- `python3 tools/build_db.py --priors-until 2024-01-01 --priors-only --priors-out data/derived/priors_dev.json`
  writes the train-only league priors (fights 2018-01-01..2023-12-31; later fights are dropped right after parsing).
  `--priors-until` without `--priors-only` restricts the priors inside a full rebuild; the default (no flag) keeps every
  fight for production.
- `node tests/test_engine3.js 8000 --fit --write --priors data/derived/priors_dev.json` re-fits the engine's [selfcal]
  values (global scales, per-division factors) to those train-only priors. It does not touch the judges.
- `node tools/judgecal.js [--write]` fits the judges' noise and 10-8 rule (sharedSd, sharedFight, indSd, t108, t108kd)
  by maximum likelihood. It uses the 2019-2023 judges' rounds in data/derived/judgerounds_rows.json and checks the fit
  with the engine's own `judgeRound`. Writes data/derived/judgecal.json; `--write` rewrites the [judgecal] entries of
  src/params3.js. About 3 CPU minutes.
- `python3 tools/mlcal.py tune --spec tools/mlcal_spec_engine4.json --no-val ...` re-tunes the global scales on TRAIN with
  the learned rates on (hook tools/mlcal_hooks/ml_oof_v4.js passes the out-of-fold rates as `opts.ml`).
- `node tools/evalv.js --version v<N> [--split train|val] [--sims 300] [--workers 3] [--compare v<M>]` is the standard
  evaluation of the frozen copy in versions/v<N>/. It is symmetric, uses common random numbers and event-cluster
  bootstrap CIs, and adds methodround `--score` and the base-rate table. Results go to data/derived/evalv/ and
  data/derived/version_history.json. A validation run is a single look per version and also runs the blend test,
  `tools/evalv_blend.py`. `--engine-dir src --dev` evaluates unfrozen code without touching the history.
  `python3 tools/evalv_blend.py --engine-bt <file> --dry` checks the blend plumbing on train years only (fit 2019-2022,
  score 2023).
- `python3 tools/methodround.py --score cells.json --score-from D0 --score-until D1 --score-out out.json --backtest
  data/derived/backtest_dev.json` adds JSON output and a date window to the method/round yardstick.

## Engine v5 merge step 1: components.v401 (v4.0.1's train-only fixes)

- Flags: `params.components.v401 = { emJudge, deductions, mlLevels, tdCap, koTargets }` in src/params3.js, or per call through
  `opts.params.components.v401` (`false` switches all five off). `FightEngine.resolveParams(over)` returns the parameter set a
  matchup runs on; `FightEngine.v401Flags(p)` the sub-flags. Each sub-flag off puts back v4.0.0's values
  (`params.v401.off`), so with all five off the engine is v4.0.0 bit for bit.
- `node tests/test_v401.js [150]` (about 10 s): flag-off identity against versions/v4 (fights incl. traces and summaries over
  450 matchups: random pairs with and without the learned rates, 2019-2023 backtest fights in both corner orders), port
  fidelity against versions/v4.0.1-rejected (sub-flags a-d on), and that every sub-flag does something.
- `python3 tools/ko_composition.py` writes data/derived/ko_composition_pre2024.json: the KO/TKO composition targets of the
  self-calibration (ground, clinch, standing without a knockdown) from fights before 2024-01-01 (2019-2023 adopted; the
  table is cut right after loading). ufcstats labels ~24% of 2015-2018 strike KO/TKOs "In Clinch" and ~7% from 2019 on.
- `node tools/v401_kocomp.js [--n 30000] [--iters 12] [--write]` turns those targets into the koTargets factors
  (`params.v401.koComp`): two restricted fits of the KO block on league-average Lightweight pairs (train-only priors,
  learned rates off, common random numbers), v4 targets vs 2019-2023 targets; writes data/derived/v401_kocomp.json.
- Provenance of the flag-on values: data/derived/judge_em_train.json (a), data/derived/judgecal_v401.json (a, b; v4.0.1's
  tools/judgecal.js run), data/derived/v4_levels_v401.json (c and t108; v4.0.1's tools/v4_levels.js run).

## Adding or overriding a fighter

All hand edits go in `data/overrides.json`, keyed by the fighter's slug from fighters.json. The build
script never touches that file once it exists, so rebuilding the data keeps the edits.

```jsonc
{
  "fighters": {
    "justin-gaethje": {
      "appearance": { "skin": "#d59a7c", "hair": "#6b4a33", "beard": false,
                      "shorts": "#c9312f", "trim": "#111111", "glove": "#16181c" },
      "nick": "The Highlight",           // any profile field can be replaced
      "reach_in": 70
    }
  },
  "manual": {
    "new-signee": {                      // not in the ufcstats data (or a full replacement)
      "name": "New Signee", "dob": "1997-05-01", "height_in": 70, "reach_in": 72, "stance": "Orthodox",
      "division": "Lightweight",
      "rates": { "slpm": 4.5, "sapm": 3.9, "acc": 0.48, "def": 0.57, "td15": 1.2, "tdAcc": 0.40,
                 "tdDef": 0.70, "sub15": 0.4, "kd15": 0.3, "head": 0.62, "body": 0.18, "leg": 0.20,
                 "dist": 0.80, "clinch": 0.10, "ground": 0.10, "mins": 60 }
    }
  }
}
```

- **Fighter in the data**: nothing to do; everyone with a UFC fight since `--roster-since` gets a
  profile. To include older fighters, rerun with an earlier `--roster-since` (the file grows by about
  1.6 KB per fighter).
- **Name mismatch** (a bout name that doesn't match ufcstats' fighter list): add it to
  `MANUAL_ALIASES` in build_db.py; the build prints how many names stayed unmatched.
- **Two people with one name**: handled automatically by weight and era; check
  `meta.ambiguous_names` after a new snapshot.
- **Fighter not in the data** (new signee, other promotions): add a `manual` entry with a `rates`
  block in ufcstats career format (`slpm sapm acc def td15 tdAcc tdDef sub15 kd15 head body leg dist
  clinch ground mins`); the engine turns it into pseudo-sums, and `mins` sets how much weight it gets
  against the priors.
- **New data**: replace the CSVs in `data/raw/` with a fresh scrape and rerun build_db.py, then
  tools/calibrate.js.

## odds_upcoming.py: upcoming odds for the forward test

```
python3 -I tools/odds_upcoming.py snapshot     # all sources -> data/predictions/odds_snapshot_<YYYYMMDD-HHMM>.json
python3 -I tools/odds_upcoming.py show | plan | timeline
python3 -I tools/odds_upcoming.py snapshot --replay <STAMP>   # rebuild a capture from data/raw/web_cache/*/<STAMP>/
```

Stdlib only, about 90 polite requests (1.25 s apart, robots.txt checked) in 3-4 minutes.

- **Sources:** fightodds.io (24 books, per-book openers, Pinnacle history), bestfightodds event pages
  (moneylines and method/distance props), Action Network (next card), Covers (low trust, filtered)
  and Wikipedia (fallback cards).
- **Bouts:** `data/predictions/cards_upcoming.json` defines them, keeping its a/b order and the
  ledger `bout_id`.
- **Output per bout:** per-book lines with multiplicative, Shin and power no-vig; a consensus; the
  ledger-format `market` block (BFO mean, multiplicative); the market open; and the 7-way method
  market and P(distance).
- **Snapshots are never overwritten.** Each run also rebuilds the open/close timeline
  `data/derived/odds_upcoming.json`.

Run it in fight week, at T-2h before each card's lock, and about 10 h after the card for the archived
closing lines (`plan` prints the times). Details and caveats: `research/data_odds_upcoming.md`. Its
verification log (Nov 6) covers the source spot checks and the exchange identities: BFO's "Polymarket"
is stored as `PolymarketUS`, and BFO's Kalshi prices include the taker fee.


## fightweek.py: fight-week context (weigh-ins, bout changes, venue, home country)

```
python3 tools/fightweek.py fetch-wiki | fetch-geo | fetch-sherdog   # cached, <= 1 request/second per site
python3 tools/fightweek.py all                                       # build + walk-forward eval (no network)
python3 tools/fightweek.py report                                    # markdown tables for the research note
python3 tools/fightweek.py verify                                    # leakage checks: corner-order swap, post-fight text
```

Needs requests, bs4/lxml, pandas, numpy (no scipy). Reads Wikipedia event articles (`/wiki/` pages;
the API paths are disallowed by robots.txt), the Open-Meteo geocoder, `data/raw/wikidata_mma_people.csv`
and Sherdog fighter pages (sharing tools/preufc.py's cache and keeping the combined Sherdog rate under
1/s). Raw pages live in `data/raw/web_cache/{wikipedia,open-meteo,sherdog}/` (gitignored).

- **Output:** `data/derived/fightweek.json` = `{meta, fights, fighters}`; per ufcstats fight id: weight
  miss and size, catchweight, late replacement with days of notice, opponent change, venue (city,
  country, altitude, Apex), home / nationality / time-zone shift / travel per side, crowd (COVID closed
  doors), event type, card segment; per slug: nationality with sources and a home point.
- **Eval:** train 2012-2023, validate 2024-2025, mirrored no-intercept logistic beyond Elo + debut; results
  in `meta.eval`. Details, audit and caveats: `research/data_fightweek.md`.


## blindtest.py: the standing blind test (event-by-event walk-forward replay of every model)

```
nice -n 5 python3 tools/blindtest.py list                 # registered models, refit schedules, information class
nice -n 5 python3 tools/blindtest.py replay               # replay 2024-01-01..2025-12-31, score, write outputs (~30 min busy box)
nice -n 5 python3 tools/blindtest.py replay --models elo,ml_lr,moe_noline   # a subset plus what it needs
nice -n 5 python3 tools/blindtest.py score                # re-score the stored replay and rewrite the report
python3 tools/blindtest.py replay --quick --out /tmp/x.json   # smoke test: first 8 cards
```

Before every UFC card date in the window each registered model is refit/updated on data strictly before that date
(per event, per month, or frozen/sequential) and predicts the card; stackers refit before every card on 2019..yesterday.
Fights from 2026-01-01 are never read. Outputs: `data/derived/blindtest.json` (every prediction with model version,
refit cutoff and fit_through; fits; scores) and the auto section of `research/model_blindtest.md` (scoreboard with
event-cluster bootstrap CIs, cumulative curves, segments incl. newcomers, calibration, 7-bin). A new model is a ~10-line
`@register` plugin (in the file or in `tools/blindtest_plugins/*.py`, auto-imported; `ml2.py` there registers ML v2 as
soon as `data/derived/ml2.json` exists). New engine versions register themselves from `data/derived/evalv/v<N>_val.json`
(produced by the controlled one-look `tools/evalv.js` run; the harness never runs a validation look itself).
Heavy fits are cached in `out/blindtest_cache/`.

## forward_ledger.py: write-once forward predictions and their scoring

```
python3 tools/forward_ledger.py predict --event 2026-11-14 [--sims 2000] [--dry-run --dry-out /tmp/x.json]
python3 tools/forward_ledger.py predict --event 2026-11-14 --supersede   # _v2 before the lock, names the file it replaces
python3 tools/forward_ledger.py score [--no-fetch] [--manual results.json]
python3 tools/forward_ledger.py status
```

`predict` writes `data/predictions/<date>_<event-slug>.json` (O_EXCL, read-only; refuses after the card's lock or when
the file exists) from `cards_upcoming.json`, the newest pre-lock odds snapshot and the page's model package evaluated
in Node by `tools/forward_ledger.js` (MoE stack with and without the line, experts, simulator, method/round).
`score` pulls results for finished ledger events only (ufcstats via the Greco1899 CSVs into `out/forward_results/`,
ESPN's scoreboard JSON as the second source), appends them to `results.json`, and regenerates `scores.json`/`scores.md`.

Forward model v4.1 (pre-registered in `data/predictions/README.md`): each bout also carries a `models` block (benchmark
line, MoE stacks with and without the line, ML v2 logistic and its page stacks with fit-2019-2023 and production weights,
whr_rounds, ratings stack, Elo with pre-UFC-seeded debutants, simulator). `p_a` is `ml2_stack_open`, and `score` rates
every model against the market at prediction time and against the close, per model version. The fit-2019-2023 ML v2
weights come from:

```
nice -n 5 python3 tools/forward_models.py export   # data/derived/forward_models.json from tools/ml2.py's cached stack table
node tests/test_forward_models.js                  # weights vs Python, ratings vs ratings.json, corner symmetry, debut seeds
```


## ml2.py: ML v2 feature union (winner model, stacks, method/round refit)

```
nice -n 5 python3 tools/ml2.py all --jobs 2   # table, cv, fit, stage2, stack, method, verify, export (~8 min)
nice -n 5 python3 tools/ml2.py <stage>        # one stage from the caches in out/ml2_cache/
node tests/test_ml2.js                        # JS page evaluator (src/ml/ml2.js) against the Python reference
```

- **Inputs.** ml.py's feature table (rebuilt), tools/ratings.py's systems (rerun with ratings.json's tuned parameters over
  2009-2025), tools/market.py's market rating (rebuilt from 2013), preufc.json, fightweek.json, and for a second-stage
  test durability.json, oppadj.json, mlrates_oof.json, methodround.json and tools/styles.py's walk-forward matchup terms
  (built here from backtest.json with styles.json's archetypes; screen nested inside each CV fold). `build_db.parse_fights`
  is wrapped so every fight dated 2026-01-01 or later is dropped right after parsing.
- **Protocol.** Choices by time-ordered CV before 2024 (ml.py's blocks; stacks forward-chained 2021-2023), 2024-2025
  scored once, static (fit < 2024) and monthly-rolling refits, everything corner-symmetric.
- **Stacks.** Three page regimes in `page_model.stack`: `noline` (ML v2 logistic + market rating), `line` (closing line
  + ML v2 logistic) and `open` (opener + ML v2 logistic, added by the verifier). Odds typed in before fight night are an
  opener: pass them to `ML2 predict(..., pClose, pOpen)` as `pOpen`, never as the closing line.
- **Verify stage.** Reverses the encoded outcome (ratings.encode, so WHR-rounds' round shares too) and, for the market
  rating, the closing line and result of every fight from the first fight day on/after 2024-06-01. Predictions up to
  and including that day must not move.
- **Outputs.** `data/derived/ml2.json` (CV, results, segments, stacks, method refit, verification, per-fight
  predictions, `page_model`) and `research/model_ml2.md`. Delete `out/ml2_cache/ratings_all.pkl` after ratings.json or
  preufc.json changes (the table stage then reruns the rating systems, about 75 seconds), and
  `out/ml2_cache/styles_block.pkl` after backtest.json or styles.json changes.

## Fight-dynamics component (params.components.dynamics): calibration, acceptance check, ablation

Train-only tools for the engine's dynamics component (research/model_dynamics.md E1-E11). All three refuse fights dated
2024-01-01 or later unless `DYN_ALLOW_VALIDATION=1` (reserved for the v5 validation measurement) and never read 2026.

```
node tools/dynamics_calibrate.js [--iters 5] [--sims 16] [--stride 2]      # re-fit the [dyncal] level factors in params3.js dyn
node tools/dynamics_bt.js --out run.json [--sims 150] [--part k --parts n] [--cfg name='{params}' ...] [--csv eng_{cfg}.csv]
node tools/dynamics_bt.js --merge run.json part0.json part1.json ...
python3 tools/dynamics_ablation.py run.json [--on on --off off]           # paired event-cluster bootstrap scores + base rates
python3 tools/dynamics_check_train.py --out check.json on=eng_on.csv       # tools/dynamics.py engine check on 2019-2023 rounds
```

Inputs are leak-free: frozen pre-fight profiles (backtest_dev.json), walk-forward priors (mlcal_priors_asof.json) and
out-of-fold learned rates (mlrates_oof.json). Large gitignored inputs are read from the main checkout when missing.
`dynamics_calibrate.js` targets: volume, accuracy, takedown attempts and the KO/TKO share of the flag-off engine on the same
fights and seeds (so an ablation measures structure at equal level), knockdowns per fight-minute of the 2019-2023 actuals by
format, and the data's knockdown conversion (0.512). `dynamics_check_train.py` runs `tools/dynamics.py`'s
`engine_check(..., real_period="train")` (output / accuracy dynamic-RE decomposition, knockdown frailty and round profile,
round targets, round correlations, the skip-round knockdown-momentum contrast) against real 2019-2023 rounds only.

v5 merge step 2 (durability + dynamics on together):

```
python3 tools/v5_joint_levels.py run.json report.json   # joint KD / finish level check of a 4-config dynamics_bt run (s1, dur, dyn, both)
```

`tools/v5_joint_levels.py` compares knockdowns per 15 minutes, per fight and per 100 head strikes, knockdowns per 100 standing
head strikes by round, conversion per knockdown, and finish shares and hazards by round (3 and 5 rounds) with the 2019-2023
actuals, using event-cluster bootstrap CIs. It refuses any fight dated 2024 or later. The step-2 tables are in
data/derived/v5_joint_levels_step2.json.

`tools/durrec.js` is the shared helper that gives backtest tools leak-free durability inputs. With
`params.components.durability` on, each backtest matchup gets its durability.json walk-forward record (`opts.dur`) plus
the train-only NORM. It throws rather than fall back to the live fit:
`const DR = require("./durrec.js")(E, ROOT); DR.apply(opts, f.id, swap); DR.assertApplied(m, f.id, opts.params)`.
These tools use it: dynamics_bt.js, dynamics_calibrate.js, mlcal.js, moe_engine_bt.js and v4_levels.js. tools/evalv.js keeps
its own verified copy.

League-average pairs have no fight id. They run durability in relative mode (`params.durability.level: null`), as
tests/test_engine3.js simAvg, v401_kocomp.js and judgecal.js do.

## styles_sos engine component (sub-flags: styles, strength of schedule)

- `tools/sos_wf.py build [--rows rows.json]`: walk-forward opponent quality for every backtest fight (fights before
  2026-01-01 only; `--until ... --production --roster` for the release table) -> `data/derived/sos_wf.json`.
- `tools/styles_sos_offsets.js <priors_asof.json> <out.json>`: per-side predicted rates for 2019-2023 fights (learned
  out-of-fold rates and the plain engine's static expectation), the offsets of the fits below.
- `tools/sos_wf.py fit <rows.json> <offsets.json>`: Poisson / binomial fits of the strength-of-schedule coefficients on
  2019-2023 with leave-one-year-out CV; writes `meta.coef` and `meta.coef_loyo` into `data/derived/sos_wf.json`.
- `tools/styles_sos_ratecheck.py <priors_asof.json> <rows.json> <offsets.json>`: rate-level check of the section-9 style
  blocks on top of the learned and the base rates (2019-2023).
- `tools/styles_sos_ablate.js <priors_asof.json> <out.json> [--sims N --part i --parts n --ml oof|off --configs ...]`:
  train-only engine ablation (both corner orders, common random numbers); `tools/styles_sos_score.py <out.json> <parts...>`
  scores it (winner log loss, soft CE vs the close, 7-bin, method, stat-line deviance, base rates; event-cluster bootstrap).

