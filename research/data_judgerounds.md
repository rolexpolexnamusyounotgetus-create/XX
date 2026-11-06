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
| 10-8 or wider | 3.62% of the judge-rounds where deductions are known (N, 2013-2025); 3.54% of all judge-rounds with deductions removed where known (3.81% on published scores); 6.5% of three-judge rounds have at least one 10-8, 1.3% have three |
| 10-10 | 0.09% of judge-rounds |
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
           jurisdiction (N only), validation: {ufc, diffs?}, ufc_note?, ufc_deduction?,
           judges: [{name, id, rounds: [[a, b], ...], total: [a, b], raw?: [[a, b], ...]}]}}
stoppage_unverified   44 partial cards from stoppage fights (D's hand-entered file), not in the rows
```
`rounds` and `total` are published scores, after any point deduction, so they add up to the official
totals. `raw` appears only when a deduction changed a round. It adds the point back, which gives the judge's
own verdict on the round (69 dev fights, one of them from `DEDUCTION_PATCHES`, see the verification log).
`raw_known: false` (the 385 D-only fights) means deductions cannot be separated from 10-8s. `ufc_note` is the
note ufcstats glues onto the first judge's name in DETAILS (41 dev fights, e.g. "Point Deducted: Illegal Knee
by Papazian", "Technical Decision - Eye Poke"), and `ufc_deduction` is the points per side that a deduction
note names (18 fights; null side = unclear). ufcstats notes only a minority of deductions: 13 of the 69 N fights
with deductions carry one, and every one of those 13 agrees with N's raw scores. Slugs come from backtest.json
(2019+), then fightweek.json (build_db's per-bout person resolution, 2012+, which splits namesakes such as
bruno-silva-bulldog and bruno-silva-blindado), then a unique name in the active roster (fighters.json), and
are null otherwise: 3,165 of 3,388 fights have both slugs, most of the rest are 2006-2011 fighters. The
`judges` aggregates span the whole dev period (2006-2025, validation years included), so they are descriptive
only and not walk-forward safe as model inputs; use the `jp_*` columns below.

`judgerounds_rows.json` (columnar; `pd.DataFrame(d["rounds"]["rows"], columns=d["rounds"]["cols"])`)
- `rounds`: 10,692 rows, one per scored round, with 66 columns: fid, date, rnd, sched, mins (length actually
  fought), end_rnd, title, women, wc, winner, src, raw_known, complete, ufc_check, has_stats, ded_A, ded_B
  (points deducted in the round; null when unknown), nJ, nA, nB, nE (judges giving the round to A, to B, or
  even, before deductions), n_wide (judges with a margin of 2+). For A_ and B_ each: sig, head, body, leg,
  dist, clinch, ground, tot and td, each as `_l` landed and `_a` attempted, plus kd, sub (attempts), rev,
  ctrl (seconds).
- `scores`: 31,319 rows, one per judge per round: ri (row index into rounds), jid (MMA Decisions id), pos,
  A, B (published), A_raw, B_raw (before deductions; null when unknown), and the judge's walk-forward history
  on dates strictly before the fight (same-day fights never see each other; null for unnamed judges):
  jp_fights, jp_rounds, jp_wide (10-8 or wider), jp_even (10-10), jp_oa (rounds where the other two judges
  agreed on a winner) and jp_dis (of those, rounds where this judge did not). A shrunk 10-8 propensity is then
  e.g. (jp_wide + 3.6 * k / 100) / (jp_rounds + k). Dev rows only count earlier dev rounds.
- Column roles (also in `meta.column_roles`): winner, nJ/nA/nB/nE, n_wide, ded_A/ded_B, complete and ufc_check
  are computed from the scores themselves, so they are labels, never inputs to a model of the scores. The
  A_/B_ round stats and mins are known only after the round. date, rnd, sched, title, women, wc, jid and the
  jp_* columns are known before the fight.
- A/B order: A (the first name in the ufcstats BOUT string) wins the majority in 56.8% of decisive three-judge
  dev rounds, because ufcstats lists the winner first more often. Mirror A/B when training and evaluating
  (docs/BACKLOG.md, evaluation rule).
- Clean subset: `complete & ufc_check in {agree, agree_partial_panel, totals_agree_names_differ}` keeps
  10,628 of 10,692 rounds. Per the protocol: train on 2019-2023 (3,911 clean rounds, 11,700 judge-rounds),
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
| 4.2%* | 3.0%* | 1.7% | 1.5% | 2.9% | 3.7% | 6.0% | 5.1% | 5.8% | 5.9% | 3.9% | 3.1% | 3.6% | 2.2% | 1.7% |

\* 2011-2012 come almost entirely from D, where deductions cannot be removed. Where they can (N), published
scores overstate the 10-8 share by 0.30 points (3.91% vs 3.62%), so read 2011-2012 as roughly 3.9% and 2.7%.

The 2017 scoring-criteria change (more permissive 10-8s) shows clearly. Since 2021 the rate has fallen back
to 1.7-2.2%. That matches the 4.7% overall and roughly 2.5% for 2024-25 that officials.py inferred from card
totals (docs/BACKLOG.md). The ufcstats-implied number was a little high for 2024-25, so the engine should use
an era-dependent 10-8 rate, not one constant.

**What goes with a 10-8.** Only 17.0% of judges' 10-8s go to a fighter with a knockdown advantage in the
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
  as a 10-8 there (`raw_known: false`, `ded_A`/`ded_B` null). In N, 72 dev rounds carry a deduction, and
  deductions raise the published-score 10-8 share by 0.30 points. Five D-only fights carry a ufcstats deduction
  note (`ufc_deduction`), for example Papazian vs. Elliott 2012, whose round-1 8-10 cards are a 10-9 plus a
  deducted point (Wikipedia confirms it), not three 10-8s.
- N itself can miss a deduction: Martinez vs. Saaiman (UFC 285) had none in N's raw columns although Byrd's
  published round 1 was 9-9. It is patched from a cited source (`DEDUCTION_PATCHES`), and any N round whose
  raw scores give nobody 10 now turns the fight to `raw_known: false` (none left after the patch). A deduction
  from the round loser leaves no such trace and would still be missed.
- 10-10 rounds are rare (0.09%). A few judge-rounds with a margin of 3 or more are real 10-7s or 10-8s after a
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

## Verification log

Verifier pass, Nov 6, 2026. The checks were scripted independently of `tools/judgerounds.py` (own parsers for
N, D, the ufcstats CSVs and Wikipedia), and all requests went out with the project user agent, at most one per
1.1 s, after a robots.txt check.

**What was re-fetched, and what could not be.**
- GitHub raw (robots.txt 404, so allowed): N `ufc_judge_rounds.csv` and D `ufc_round_scores.csv` and
  `ufc_scorecards.csv` were downloaded fresh into a scratch directory. All three SHA-256 prefixes equal
  `FETCHED.json`, so the cache is what the sources publish today.
- Wikipedia (/wiki/ pages only; robots.txt bars /w/ and /api/): `List_of_UFC_events` and 39 event articles (41 fights),
  cached under `data/raw/web_cache/wikipedia/verify_judgerounds/`.
- Press pages that publish official round-by-round cards: foxsports.com (UFC 167) and mmasucka.com (UFC 259),
  cached under `data/raw/web_cache/{foxsports,mmasucka}/`. Yahoo was skipped because its robots.txt bars
  anthropic-ai and ClaudeBot.
- Not fetched:
  - mmadecisions.com, the original source page: its robots.txt bars us, and the network proxy now refuses
    the host.
  - ufcstats.com fight pages: robots.txt is 404, but every page now answers with a JavaScript proof-of-work
    bot challenge ("Checking your browser"), which was not circumvented. One challenge page was fetched and
    deleted. The ufcstats side was checked against the repo's CSV snapshot instead.

**Spot check: 41 fights.** The sample has two parts:
- 30 random dev fights (seed 20261106): 20 from N or N+D, 10 D-only.
- 11 targeted fights:
  - deductions: Martinez vs. Saaiman 2023, Figueiredo vs. Moreno 2020, Leites vs. Marquardt 2008;
  - namesakes: Bruno Silva vs. Dvorak 2020, Pereira vs. Bruno Silva 2022;
  - same-day events (2014-05-31, Berlin and Barueri): Thiago vs. Umalatov, Pesta vs. Magomedov;
  - adjacent-day events: Maynard vs. Guida 2012;
  - a D-only rematch: Silva vs. Franklin 2;
  - one random `differs` fight and one random `totals_agree_names_differ` fight.

| Check | Result |
|---|---|
| Every judge-round vs the fresh N / D rows (198 judge cards; N+D fights checked against both) | 41 / 41 fights identical on published scores. The only difference is the deliberate Saaiman raw patch below. |
| Round stats in `judgerounds_rows.json` vs a fresh parse of `ufc_fight_stats.csv` (131 rounds, 15 stats per side) | 41 / 41 identical |
| Derived row fields (nJ, nA, nB, nE, n_wide, ded_A/B, the published pair in scores) recomputed from the cards | 41 / 41 identical |
| Wikipedia: bout found, winner orientation | 41 found. 40 / 40 winners agree; the remaining one (Lombard vs. Burkman 2015) is NC on both. |
| Wikipedia: card totals | 36 exact; 3 partial panels whose cards are a subset of Wikipedia's; 1 NC with no scores. 1 differs: Rosa vs. Melo 2020, where Wikipedia has 30-27 and both ufcstats and MMA Decisions have 29-27, so Wikipedia is the outlier. |
| Wikipedia on `differs` (Jacare vs. Hermansson 2019) | Wikipedia's 49-45, 48-47, 48-47 matches MMA Decisions. ufcstats has 46-49 for Cleary, so the flag points at a ufcstats typo. |
| Deduction notes on Wikipedia | Figueiredo (round 3) matches N's raw. Saaiman (round 1) was missing in N, now patched. Papazian (round 1, D-only) cannot be separated, as the caveat says. |

**Round-level check against the press (not copies of MMA Decisions).**
- GSP vs. Hendricks, UFC 167 (Fox Sports, which printed the official card): all three judges gave Hendricks
  rounds 2 and 4 and GSP rounds 3 and 5. Round 1 went to GSP from D'Amato and Weeks and to Hendricks from
  Trowbridge. That is 15 of 15 judge-rounds identical, judge names included.
- Blachowicz vs. Adesanya, UFC 259 (MMA Sucka): D'Amato gave Adesanya one round (round 3) for 49-46. Cleary
  gave him round 3 and scored round 5 10-8 for Blachowicz, 49-45. Kamijo gave him round 2 and scored round 5
  10-8, 49-45. That is 15 of 15 identical.
- Jones vs. Reyes (UFC 247) and Volkanovski vs. Holloway 2 (UFC 251) agree with the round structure in search
  summaries: Reyes won round 1 on all three cards and Soliz gave Jones rounds 2-5; Holloway took rounds 1-2,
  Volkanovski took 3 on every card, and only Lethaby gave Holloway round 5. Those pages were not fetched (image
  scorecards or barred sites), so these two are not counted.

**Global checks (all 3,388 dev fights).**
- Identity: A and B equal the ufcstats BOUT order, the date equals the event date, the winner equals OUTCOME,
  every total equals the sum of its rounds, and no row is dated 2026 or later.
- Orientation: in none of the 3,248 decisive decisions with 2 or more cards do most cards favour the ufcstats
  loser.
- Coverage: the by-year table and the 96.4% figure (3,018 / 3,131) reproduce exactly.
- Headline numbers reproduce: 10,692 rounds, 31,319 judge-rounds, 411 judges (47 with 100+ rounds, 14 with
  500+), 22.4% non-unanimous rounds, 14.95% pair disagreement, EM 83.95% vs 78.34% for the sig-strike leader,
  and the clean subset of 10,628 rounds (3,911 / 1,699).
- Two corrections in this note: 11,751 judge-rounds was the unfiltered 2019-2023 count (the clean count is
  11,700), and the 3.62% 10-8 share covers only the fights where deductions are known.

**Fight-id matching.**
- D's URL slug order equals its fighter_1 order in 4,015 of 4,016 decisions. The other one is Luana Santos vs.
  Yana Santos (2026, vault), which the full slug names resolve.
- All 385 D-only matches:
  - surnames agree in 383; the two others are ring names and both are correct (Kimbo Slice = Kevin Ferguson;
    "Macapa" = John Teixeira, whose cards favour Viana as ufcstats says);
  - D's winner equals the ufcstats winner in 367 of 367 checkable fights;
  - 370 are on the same date and 15 one day off (time zones); 284 + 92 agree with ufcstats totals.
- Same-day events (2014-05-31 and 2014-06-28, 50 fights): all are N+D, and the D matcher agrees with N's
  crosswalk.
- The two Bruno Silvas are attached to the right fights. 45 rematch pairs each sit on their own dates.

**Walk-forward.**
- The files are labels (judges' scores) plus in-round stats, so they are safe as training targets.
- The `judges` table, however, aggregates 2006-2025, validation years included, and would leak if used as a
  feature. It is now flagged in `meta.judges_table_note`, and walk-forward `jp_*` columns were added.
- 300 random scores rows were recomputed from scratch (strictly earlier dates, same judge): 0 mismatches.
- Columns derived from the scores (winner, nA/nB/nE, n_wide, ded, ufc_check, complete) are now labelled as
  labels in `meta.column_roles`, together with the 56.8% A-majority bias.
- The verifier read only the vault file's dates (201 fights, 2026-01-24..2026-10-31) to confirm the split.

**Fixes made (tool, outputs and this note).**
1. N missed a deduction in Martinez vs. Saaiman, UFC 285. Byrd's published round 1 was 9-9, which needs a
   deduction, and Wikipedia confirms Saaiman lost 1 point in round 1. `DEDUCTION_PATCHES` adds it back
   (raw 9-10, 10-9, 10-9). A new detector sets `raw_known: false` for any N fight whose raw round gives nobody
   10; none remain.
2. `ufc_note` and `ufc_deduction` come from the ufcstats DETAILS prefix. The cross-check: 13 of 13 notes on N
   fights match N's raw scores, 56 N fights have deductions with no note, and 5 D-only fights have notes.
3. Slugs now also come from fightweek.json: 1,803 fighter sides filled, none changed or lost, and both slugs
   on 3,165 of 3,388 fights (previously 1,971).
4. Walk-forward judge history columns `jp_*` were added to scores, in dev and vault alike.
5. Added `meta.column_roles`, `meta.judges_table_note`, and the report fields
   `deduction_inflation_of_10_8_rate_pp_raw_known` (0.295), `rounds3_majority_to_A` (0.5684) and
   `judge_round_10_8_plus_all_deductions_removed_where_known` (0.0354).
6. JSON writes are atomic (temporary file, then rename), so officials.py never reads a half-written file.
7. This note: the 10-8 wording; 11,751 corrected to 11,700; 71 to 72 rounds and 68 to 69 fights with
   deductions; 10-10 0.10% corrected to 0.09%; 2023 10-8 3.7% corrected to 3.6%; 16.9% corrected to 17.0%;
   a flag on 2011-2012 10-8 rates; the new fields documented.
8. Removed a 14-byte cache file `davies/LICENSE` that held "404: Not Found". D has no license file.

The rebuild changed nothing else: the same 3,388 fights and the same published scores; all other report
numbers moved by less than 0.1 point.
