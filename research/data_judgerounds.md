# Round-by-round judges' scores (judgerounds)

Built Nov 6, 2026 by `tools/judgerounds.py`. Outputs: `data/derived/judgerounds.json` (cards per fight) and
`data/derived/judgerounds_rows.json` (the round-level training set for the v8 judging model). Both hold fights
before 2026-01-01 only; the 201 decisions from 2026 went to the vault directory outside the repo
(`judgerounds_vault.json`, `judgerounds_rows_vault.json`, next to `backtest_vault.json`), per the hidden-data
protocol. Every number below is from the dev period (2006-2025) unless it says otherwise.

## Headline

| | |
|---|---|
| Decisions with round-by-round cards | 3,388 (2006-2025); 3,229 with all three judges |
| Scored rounds / judge-rounds | 10,692 / 31,319 (10,199 rounds with three judges) |
| Judges | 411 (47 with 100+ rounds, 14 with 500+) |
| Coverage of ufcstats decisions | 96.4% for 2013-2025 (3,018 of 3,131); 100% for 2022-2024; thin before 2011 |
| Totals vs ufcstats DETAILS | 99.41% of three-judge fights agree on all three totals (3,210 / 3,229); 99.38% of cards (9,627 / 9,687); partial panels 231 / 234 cards |
| Two independent copies of MMA Decisions | 27,591 of 27,591 overlapping rounds identical (2,939 fights) |
| Our fight matcher vs the other dataset's crosswalk | 3,229 of 3,229 same ufcstats fight |
| 10-8 or wider | 3.62% of judge-rounds (deductions removed); 6.5% of rounds have at least one 10-8; 1.3% have three |
| 10-10 | 0.10% of judge-rounds |
| Round disagreement | 22.4% of three-judge rounds are not unanimous on the winner (22.2% 2-1 splits, 0.2% involve a 10-10); a random pair of judges disagrees on 14.95% of rounds |

## Where the data came from, and why not mmadecisions.com itself

The task said to scrape mmadecisions.com. Its robots.txt (last updated 2025-03-04, a ditig.com template) lists
76 search-engine crawlers with an empty `Disallow:` and then ends with `User-agent: *` / `Disallow: /`.
Our agent ("FightLabSim/1.0 (private research)") is not on the list, so every page is off limits to us
(confirmed with Python's `urllib.robotparser`). One request to the home page went out together with the
robots.txt check, before the file was read; nothing from it was kept, and no other mmadecisions page was
fetched. The other sites that publish round scores are also closed to us: ufc.com answers 403 even for
robots.txt (its official scorecards are images anyway), ESPN's APIs answer 403 and its robots.txt bars
`anthropic-ai`, and Tapology bars `anthropic-ai`, `Claude-Web` and `Claudebot`.

So the round scores come from two datasets that other people already built from MMA Decisions and published on
GitHub. We downloaded them from raw.githubusercontent.com (no robots.txt there, 1.1 s between requests). Raw
files are cached under `data/raw/web_cache/github/{nlbair,davies}/`, which is gitignored, with SHA-256
prefixes in `FETCHED.json` (written by `--fetch`). One request went to Zenodo's `/api/records/` endpoint, which
its robots.txt disallows, before that file had been read; the response was not used.

| Key | Dataset | What we use | License |
|---|---|---|---|
| N | nlbair/ufc-data v0.1.1 (Noah Bair, Oct 18, 2026; doi:10.5281/zenodo.23458636) | `ufc_judge_rounds.csv`: 29,937 judge-round rows, 3,189 decisions, 2013-02-16..2026-10-10, keyed by ufcstats fight id, with published and pre-deduction scores; `id_crosswalk_all.csv`; `judge_names.csv` | CC BY 4.0: cite Bair (2026), and credit MMA Decisions and ufcstats.com |
| D | martindavies-code/ufc-judging-analysis (Martin Davies, weekly updates through UFC 333, Oct 24, 2026) | `ufc_round_scores.csv` + `ufc_scorecards.csv`: 4,016 decisions back to 1996 (3,525 with round tables), published scores keyed by MMA Decisions decision id; `stoppage_scorecards.json` (48 hand-entered cards from stoppage fights) | No license file. We use it for private research and credit it. Do not redistribute the D-only rows without asking the author. |

The facts underneath both datasets are the official commission scorecards as listed by MMA Decisions. Neither
dataset has the media scores that MMA Decisions shows, so the optional `media_scores` field is absent.

## Method

1. **ufcstats side.** Fights, outcome, method, round and time, format, referee and DETAILS come from
   `data/raw/ufc_fight_results.csv` (duplicate Noche UFC rows dropped as in build_db.py), and dates and
   locations from `ufc_event_details.csv`. A = the first name in `BOUT` and B = the second, which is the
   order used everywhere in the project.
2. **N to ufcstats.** N already carries the ufcstats fight id. The author matched each decision on event
   date (with one day of slack), names and all three card totals. Scores are flipped to A/B using
   `primary_is_f1`. Checking the primary name against A or B agrees in 3,189 of 3,189 fights.
3. **D to ufcstats.** We wrote our own matcher for D. The two names come from the MMA Decisions URL slug
   (`Petr-Yan-vs-Merab-Dvalishvili`). The candidates are every ufcstats fight at events on the same day or
   one day either side. Each candidate is scored by fuzzy name similarity in both orientations, with
   accents, nicknames, reordered or run-together names (`Heili Alateng` / `Alatengheili`) and one ring name
   (Kimbo Slice = Kevin Ferguson) handled, plus small bonuses for a decision method and for matching card
   totals. All 4,016 D decisions match. On the 3,229 that N also covers, the matched fight is N's fight
   every time. Each fighter's scores go to A or B by name, not by assuming D's fighter 1 is the winner.
4. **Merge.** If N has the fight, N is used, because it records deductions. D fills the rest: mostly
   2006-2012, plus 28 from 2013 on (15 of them in 2013, where N starts on Feb 16). On the 2,939 overlapping dev fights, all 27,591 judge-rounds are
   identical in the two sources, judges matched by MMA Decisions id. Six unnamed judges were paired by
   their round sequence.
5. **Judges.** Judges are identified by their MMA Decisions id, which is the same in N and D. Names follow
   N's spelling. Each judge's ufcstats spellings ("Mike Bell" for Michael Bell, "Sal D'amato") are counted
   from name-matched cards and stored in `judges[id].ufcstats_names`, which joins this data to the
   judges' totals in DETAILS (officials.py). The 42 judge-rounds by "Unknown Judge" keep `id: null`.
   Several unknown judges are never pooled into one fake person.
6. **Validation against ufcstats.** DETAILS lists every card loser-first. With A as the winner a card
   "x - y" is B = x, A = y, and with B as the winner A = x, B = y. Draws and overturned fights are
   compared unordered. Notes that ufcstats glues onto the first judge's name ("Point Deducted: Low Blow by
   WatsonRichard Bertrand") are stripped. Each MMA Decisions card is paired with a ufcstats card by judge
   name. If either name is missing, the totals decide the pairing. The result goes in
   `validation.ufc` / `ufc_check`:
   - agree: 3,194 fights. All three totals match, judge by judge.
   - agree_partial_panel: 156 fights. Only one or two judges have round tables, and they match.
   - totals_agree_names_differ: 16 fights. The three totals match, but ufcstats and MMA Decisions credit
     them to different judges. This is a name-attribution conflict between the sources; which one is
     right is unknown.
   - differs: 19 fights. Most differ by one point on one card, which N's own release notes also report
     (12 such fights). This group also holds three 2011 fights where D kept only round 1 and one
     overturned fight (Abdul-Malik vs Brundage, 2025: MMA Decisions has the original three-round cards,
     ufcstats the two-round technical draw).
   - differs_partial_panel: 3 fights.
7. **Completeness.** A card set is `complete` when every judge scored the same rounds 1..R and R fits how
   the fight ended: the scheduled number of rounds if it went the distance, otherwise the stoppage round
   or the one before it. 3,384 of 3,388 fights are complete. The four that are not are the three 2011
   round-1-only fights from D and Rothwell vs Hunt 2011, where D has one judge with only round 2.
8. **Round stats.** ufcstats per-round rows are joined on (event, bout) to the fight id and on fighter
   name to A/B. Every one of the 10,692 scored rounds has stats for both fighters.

## The two files

`judgerounds.json`
```
meta      sources, checks (all numbers above), report_dev (summaries), split
judges    {mmad_id: {name, ufcstats_names, fights, rounds, first, last, share_10_8_plus, share_10_10, dissent_rate}}
fights    {ufcstats_fight_id: {date, event, loc, A, B, A_slug, B_slug, winner (A/B/D/NC), method, sched,
           end_round, end_time, title, wc, referee, src (N | N+D | D), mmad_id, raw_known, complete,
           jurisdiction (N only), validation: {ufc, diffs?},
           judges: [{name, id, rounds: [[a, b], ...], total: [a, b], raw?: [[a, b], ...]}]}}
stoppage_unverified   44 partial cards from stoppage fights (D's hand-entered file), not in the rows
```
`rounds` and `total` are published scores, after any point deduction, so they add up to the official
totals. `raw` appears only when a deduction changed a round. It adds the point back, which gives the judge's
own verdict on the round (68 dev fights). `raw_known: false` (the 385 D-only fights) means deductions cannot
be separated from 10-8s. Slugs come from backtest.json (2019+) or from a unique roster name in fighters.json,
and are null otherwise.

`judgerounds_rows.json` (columnar; `pd.DataFrame(d["rounds"]["rows"], columns=d["rounds"]["cols"])`)
- `rounds`: 10,692 rows, one per scored round, with 66 columns: fid, date, rnd, sched, mins (length actually
  fought), end_rnd, title, women, wc, winner, src, raw_known, complete, ufc_check, has_stats, ded_A, ded_B
  (points deducted in the round; null when unknown), nJ, nA, nB, nE (judges giving the round to A, to B, or
  even, before deductions), n_wide (judges with a margin of 2+). For A_ and B_ each: sig, head, body, leg,
  dist, clinch, ground, tot and td, each as `_l` landed and `_a` attempted, plus kd, sub (attempts), rev,
  ctrl (seconds).
- `scores`: 31,319 rows, one per judge per round: ri (row index into rounds), jid (MMA Decisions id), pos,
  A, B (published), A_raw, B_raw (before deductions; null when unknown).
- Clean subset: `complete & ufc_check in {agree, agree_partial_panel, totals_agree_names_differ}` keeps
  10,628 of 10,692 rounds. Per the protocol: train on 2019-2023 (3,911 clean rounds, 11,751 judge-rounds),
  validate on 2024-2025 (1,699 clean rounds).

## Coverage by year (decisions with round cards / ufcstats decisions)

| 2005 | 2006 | 2007 | 2008 | 2009 | 2010 | 2011 | 2012 | 2013 | 2014 | 2015 |
|---|---|---|---|---|---|---|---|---|---|---|
| 0/19 | 3/52 | 6/62 | 19/64 | 44/92 | 54/124 | 99/147 | 132/158 | 158/179 | 234/247 | 216/221 |

| 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 (vault) |
|---|---|---|---|---|---|---|---|---|---|---|
| 224/248 | 209/224 | 211/229 | 265/277 | 223/226 | 255/256 | 239/239 | 248/248 | 281/281 | 255/256 | 201 fights |

Before about 2010, MMA Decisions mostly lists only card totals (D has 491 such decisions). The ceiling there
is the source, not the matching.

## What the data says (dev period)

**10-8 rounds by year** (share of judge-rounds 10-8 or wider, deductions removed where known):

| 2011 | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 4.2% | 3.0% | 1.7% | 1.5% | 2.9% | 3.7% | 6.0% | 5.1% | 5.8% | 5.9% | 3.9% | 3.1% | 3.7% | 2.2% | 1.7% |

The 2017 scoring-criteria change (more permissive 10-8s) shows clearly. Since 2021 the rate has fallen back
to 1.7-2.2%. That matches the 4.7% overall and roughly 2.5% for 2024-25 that officials.py inferred from card
totals (docs/BACKLOG.md). The ufcstats-implied number was a little high for 2024-25, so the engine should use
an era-dependent 10-8 rate, not one constant.

**What goes with a 10-8.** Only 16.9% of judges' 10-8s go to a fighter with a knockdown advantage in the
round. A round winner with a knockdown advantage gets a 10-8 10.9% of the time, against 3.2% without one.
The median significant-strike margin is 19 in 10-8 rounds and 6 in 10-9 rounds. 10-8s rise through the fight:
at least one judge gives a 10-8 in 3.9% of round 1s, 6.4% of round 2s and 9.1% of round 3s (8.5% in rounds 4
and 5). Remember these are all fights that went the distance.

**Disagreement.**
- In three-judge rounds, 77.6% are unanimous on the winner (3-round fights 77.5%, 5-round fights 78.2%).
- By era: 2006-12 79.4%, 2013-16 75.7%, 2017-22 77.9%, 2023-25 78.3%.
- A pair of judges disagrees on 14.95% of rounds. BACKLOG gave "at least 13.1%" from totals, and the direct
  number is a little higher.
- Unanimity and accuracy depend strongly on how lopsided the stats are. Using the existing EM round-winner
  logit from BACKLOG (head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min, sub attempt
  0.85), never refit here:

| abs(EM logit) | rounds | majority agrees with EM | unanimous |
|---|---|---|---|
| 0-0.5 | 1,609 | 58.2% | 57.2% |
| 0.5-1 | 1,578 | 71.1% | 61.9% |
| 1-2 | 2,552 | 84.8% | 73.9% |
| 2-3 | 1,763 | 95.1% | 86.8% |
| 3+ | 2,692 | 98.7% | 96.4% |

- Overall the EM weights pick the majority winner in 84.0% of decisive three-judge rounds (82.9% for
  2019-2023), against 78.3% for "more significant strikes landed". This matches the 84.1% holdout figure in
  BACKLOG, so the join and the orientation are right.
- Even in near-even rounds (abs(EM) < 0.5) the panel is unanimous 57% of the time. Three independent coin
  flips would be unanimous 25% of the time. So judges share a lot of noise, in the stats they all see beyond
  ufcstats counts, as BACKLOG already suspected ("judges need shared noise"). The v8 model needs a
  round-level shared effect, and these rows identify it directly.

**Judges.** Among the 21 judges with 300+ rounds, the 10-8 share runs from 1.2% (Cardo Urso) to 5.9% (David
Lethaby), with a median of 3.7%. The dissent rate runs from 6.1% (Clemens Werner) to 10.6% (Lethaby). The
dissent rate is how often the other two judges agree and this judge differs. Some of the 10-8 spread is era,
since Lethaby debuted in 2018 and Urso stopped in 2019, so per-judge effects should be fit with year terms. Most
rounds: Sal D'Amato 3,311, Derek Cleary 2,170, Chris Lee 1,930, Michael Bell 1,648, Junichiro Kamijo 1,417,
Eric Colón 1,165, Tony Weeks 1,010.

## Caveats

- The D-only fights (2006-2012 and 28 later ones) have no deduction information, so a deducted 10-9 shows up
  as a 10-8 there (`raw_known: false`, `ded_A`/`ded_B` null). In N, 71 dev rounds carry a deduction.
- 10-10 rounds are rare (0.10%). A few judge-rounds with a margin of 3 or more are real 10-7s or 10-8s after a
  deduction.
- `stoppage_unverified` (44 matched fights) is D's hand-entered file with no cited source. One spot check
  agrees with the press: UFC 264, where two judges had Poirier 10-8 after round 1. The file is still excluded
  from the rows. Use it only after verifying it.
- Two community datasets that copy the same site are not independent of MMA Decisions. Their 100% agreement
  shows they parsed it the same way, not that MMA Decisions is right. The independent check is ufcstats
  DETAILS (99.4% agreement on totals).
- `totals_agree_names_differ` fights: the per-judge identity in those 16 fights is uncertain. Drop them for
  per-judge models if that matters.
- Coverage before 2011 is thin and leans toward later events. Do not fit era effects for 2006-2010 from this
  file.
- The "first" and "last" dates in the judge table use dev data only, so a judge who debuted in 2026 is not
  listed.

## Rebuild

```
python3 tools/judgerounds.py --fetch     # download any missing source files (about 20 requests, 1.1 s apart)
python3 tools/judgerounds.py             # build (about 1 CPU-minute; pandas + numpy only)
python3 tools/judgerounds.py --refresh   # re-download everything (D updates weekly; N is versioned)
```
Options: `--vault-from 2026-01-01`, `--vault-dir <dir outside the repo>`. To refresh the vault with new
events, re-download D (`--refresh`). D picks up new UFC events every Monday, and N only on releases.

Sources to credit: Bair, N. (2026), UFC Data: scorecards, round statistics, and betting odds, 2013 to 2026
(v0.1.1), Zenodo, doi:10.5281/zenodo.23458636 (CC BY 4.0). Davies, M. (2026), ufc-judging-analysis, GitHub.
Also MMA Decisions (mmadecisions.com) and ufcstats.com.
