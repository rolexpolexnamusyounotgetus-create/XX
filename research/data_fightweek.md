# Fight-week context: weigh-ins, bout changes, venue, crowd and home country (UFC 2012-2026)

Prepared Friday, November 6, 2026. Every UFC bout from 2012-01-01 to the snapshot (2026-10-31; 603 events,
7,156 bouts) gets walk-forward-safe fight-week features: weight misses and by how much, catchweight,
late replacements with days of notice, late opponent changes, venue city, country, altitude and time
zone, each fighter's nationality and whether he fought at home, travel and time-zone shift, crowd
policy (COVID closed doors, UFC Apex) and event type. Then a walk-forward check (train 2012-2023,
validate 2024-2025, symmetric, no intercept) of what these add beyond the Elo difference.

- Tool: `tools/fightweek.py` (scraper, cleaner, builder, evaluator).
- Output: `data/derived/fightweek.json` = `{meta, fights: {ufcstats fight id: record}, fighters: {slug: nationality record}}`.
  `meta.eval` holds every number in the walk-forward section; `meta.events` holds per-event venue, crowd and
  Wikipedia link; `meta.fields` defines every field.
- Rerun (no network): `python3 tools/fightweek.py all` (build about 1.5 minutes on this loaded machine,
  eval about 1 minute); `python3 tools/fightweek.py report` prints the tables below;
  `python3 tools/fightweek.py verify` reruns the leakage checks of the verification log (about 2 minutes). Refetch steps
  (cached, polite): `fetch-wiki`, `fetch-geo`, `fetch-sherdog`.
- Size: fightweek.json is about 9.5 MB. It can only be rebuilt from the gitignored page caches (or by
  refetching about 3,000 pages), so keep the JSON under version control or keep the caches.

Confidence legend: **high** = direct count or a large sample; **medium** = depends on text parsing or a
modest sample; **low** = an approximation that could be off for individual fighters.

## Findings

1. **Coverage (high).** 603 of 603 events matched to their Wikipedia article; 7,156 bouts. Weight misses:
   350 fighter-bouts (332 with a size; median 2.5 lb, mean 2.65, max 12; 73 of 4 lb or more),
   rising from 8-14 a year in 2012-2014 to 25-36 a year since 2019. Late replacements: 1,242 sides (one in
   about 17% of bouts), days of notice known for 664 (median 19 days, quartiles 10 / 34; 120 within a
   week, 145 in 8-14 days); opponent changes: 1,150 sides. Catchweight: 412 bouts (70 booked as
   catchweight, 342 after a miss). Nationality for 99.9% of fighter-sides (2,158 of 2,164
   fighters). No crowd: 728 bouts (COVID closed doors); Apex: 1,499; venues at 1,000 m or higher: 297
   bouts in 8 cities (Mexico City 2,240 m the highest).
2. **Late replacements underperform (high).** Beyond Elo and debut, the side that stepped in: -0.30
   log-odds [-0.44, -0.16] (about -7.5 points at even odds); within 14 days' notice -0.63 [-0.92, -0.34].
   Replicates in 2024-2025 (-0.46 [-0.83, -0.10]).
3. **Weight missers underperform (medium).** -0.31 [-0.56, -0.06] in training (won 42.6% vs 50.1%
   expected; 4 lb+ misses 34.5%); 2024-2025 too small to confirm (refit -0.21 [-0.76, +0.33], n = 55).
4. **Home crowd matters outside the USA only (high).** +0.37 [+0.24, +0.51] with a full arena outside the
   USA in training, +0.51 [+0.16, +0.86] refit on 2024-2025; Brazil home side 64.2% vs 52.3% expected
   (2012-2019). Inside the USA the "home" American has drifted to 41.1% vs 50.0% expected in 2020-2023
   (training years, n = 282) and 37.1% vs 51.4% in 2024-2025 (n = 186): an Elo problem with international
   signings (Americans anywhere: -0.16 in 2012-2023, -0.41 in 2024-2025), not a crowd effect. The
   2024-2025 refit (+0.51) is a replication only in part: the US / non-US split was first written down after
   a table that pooled 2020-2025, but a training-only selection (rolling origin inside 2012-2023, table 3)
   picks the same split, so the split does not depend on the validation years.
5. **No signal** from time-zone shift, venue altitude (x Elo), no crowd x Elo or catchweight x Elo;
   altitude adaptation has too few cases (56 training fights) to test.
6. **Value for prediction (medium; small).** Elo + debut + missed + replacement + 14-day + home outside the
   USA: validation log loss 0.6709 vs 0.6773 (dLL -0.0064 [-0.0117, -0.0012]); on a stronger base with an
   experience control, 0.6581 vs 0.6641 (dLL -0.0061 [-0.0113, -0.0009]). Most of the gain is the home
   term: weigh-ins and replacements alone give -0.0028 [-0.0065, +0.0008], a CI that spans zero. A
   training-only selection (table 3) picks home outside the USA plus home inside the USA (-0.0086
   [-0.0141, -0.0032]); the in-USA term is the American rating drift of finding 4, not a crowd effect.
   For scale: the experience control alone (base2) is worth -0.0132, twice the whole fight-week block.

## Coverage by year

Counts are fighter-sides except bouts, catchweight, no crowd, Apex and >= 1000 m (bouts). "with days" =
replacements whose days of notice could be dated; "home sides" = fighter fought in his primary country.

| year | bouts | missed weight | with lbs | replacements | with days | <=14 d | opp. changes | catchweight | sides with nat. | home sides | no crowd | Apex | >=1000 m |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2012 | 341 | 8 | 6 | 75 | 10 | 3 | 69 | 11 | 680 | 390 | 0 | 0 | 21 |
| 2013 | 386 | 12 | 8 | 71 | 21 | 5 | 67 | 12 | 767 | 455 | 0 | 0 | 0 |
| 2014 | 503 | 14 | 13 | 95 | 22 | 11 | 89 | 14 | 1002 | 549 | 0 | 0 | 33 |
| 2015 | 473 | 16 | 16 | 88 | 62 | 17 | 80 | 18 | 945 | 491 | 0 | 0 | 21 |
| 2016 | 493 | 18 | 13 | 103 | 100 | 32 | 87 | 23 | 984 | 496 | 0 | 0 | 38 |
| 2017 | 457 | 20 | 20 | 67 | 61 | 21 | 65 | 23 | 913 | 453 | 0 | 0 | 24 |
| 2018 | 474 | 22 | 22 | 72 | 67 | 23 | 68 | 22 | 947 | 472 | 0 | 0 | 25 |
| 2019 | 516 | 29 | 28 | 85 | 71 | 23 | 79 | 28 | 1032 | 501 | 0 | 0 | 12 |
| 2020 | 456 | 33 | 33 | 96 | 74 | 48 | 86 | 46 | 912 | 446 | 373 | 220 | 25 |
| 2021 | 509 | 32 | 32 | 103 | 62 | 25 | 99 | 36 | 1018 | 487 | 355 | 355 | 0 |
| 2022 | 511 | 25 | 25 | 81 | 32 | 14 | 75 | 37 | 1022 | 477 | 0 | 246 | 12 |
| 2023 | 520 | 34 | 33 | 89 | 29 | 16 | 83 | 45 | 1038 | 448 | 0 | 197 | 11 |
| 2024 | 517 | 36 | 35 | 83 | 20 | 9 | 79 | 36 | 1032 | 425 | 0 | 201 | 36 |
| 2025 | 520 | 25 | 25 | 63 | 16 | 7 | 57 | 33 | 1040 | 385 | 0 | 142 | 12 |
| 2026 | 480 | 26 | 23 | 71 | 17 | 11 | 67 | 28 | 960 | 364 | 0 | 138 | 27 |
| **all** | **7156** | **350** | **332** | **1242** | **664** | **265** | **1150** | **412** | **14292** | **6839** | **728** | **1499** | **297** |

## The record

```
"6d7244be5589953c": {                      # ufcstats fight id (same ids as backtest.json)
  "date", "event", "A", "B" (slugs, ufcstats order), "division", "title",
  "missed_weight": {"A": lbs over | 0 | null, "B": ...},   # 0 = no miss reported; null = miss of unknown size
  "missed": {"A": bool, "B": bool}, "weighed": {"A": scale weight when given, ...},
  "catchweight": {"is": bool, "lbs": agreed limit | null, "why": "booked" | "weight miss" | null},
  "short_notice": {"A": days of notice | null, ...},       # set only for a late replacement
  "replacement": {"A": bool, ...},                          # stepped in for a withdrawn fighter
  "opp_change": {"A": days | -1 (date unknown) | null, ...},# kept his slot, opponent replaced
  "venue": {"city", "country", "iso3", "altitude_m", "apex"},
  "home": {"A": bool | null, ...}, "home_any": {...}, "nat": {"A": ISO3 | null, ...},
  "tz_shift_h": {...}, "travel_km": {...}, "home_elev_m": {...},
  "no_crowd": bool, "crowd": "none" | "limited" | "full", "event_type", "card_segment", "bout_order", "n_bouts",
  "notes": ["B late replacement (33 days, dated)", ...],
  "sources": {"wiki": "https://en.wikipedia.org/wiki/UFC_249", "ufcstats_event": id},
  "change_detail": {"B": {"role", "days", "basis", "short_notice_phrase", "booked_vs"}},   # when a change was found
  "weighin_text": {"A": the sentence the miss came from},                                  # when a miss was found
  "miss_limit": {"A": {"lbs": 156, "basis": "division named in the weigh-in text"}}         # limit used for the size
}
"fighters": {"justin-gaethje": {"name", "ufcstats_id", "iso3", "how", "countries", "country_name",
             "home_point": {"basis", "tz", "lat", "lon", "elevation_m"},
             "sources": {"wikidata": {...}, "sherdog": {"nationality", "birthplace", "association", "page"}}}}
```

The file carries no results. It includes 2026 bouts (features only); the evaluation never touches them.

## Sources and how they were fetched

| Source | What it gives | Access rule followed |
|---|---|---|
| en.wikipedia.org `/wiki/List_of_UFC_events` and 601 event articles | venue, city, attendance (infobox); Background prose on bout changes and weigh-ins; results table (card segment, weight class, footnotes) | robots.txt disallows `/w/` and `/api/` (the action and REST APIs) for generic agents, so the tool reads the allowed article HTML under `/wiki/`. 1 request per 1.1 s. |
| geocoding-api.open-meteo.com | latitude, longitude, elevation (GeoNames), IANA time zone for the 151 venue cities, one reference city per country, 77 training-camp cities and the Sherdog birthplaces | no robots.txt (404). `api.open-meteo.com` disallows everything and is not used. 1 request per 1.1 s. |
| data/raw/wikidata_mma_people.csv + altlabels (already in the repo, Wikidata CC0, fetched earlier by tools/officials.py) | country for sport (P1532), citizenship (P27), birth country, Sherdog id, UFC.com slug, DOB | query.wikidata.org disallows `/sparql`, so it was not re-queried. |
| www.sherdog.com fighter pages | nationality, birthplace, association (camp) | robots.txt allows all. tools/preufc.py was crawling Sherdog at the same time; this tool reads preufc's cache first and sets its own gap from preufc's observed request rate (its cache writes in the last 30 s) so the combined rate stays under about 0.95 requests per second. |
| Not used | Tapology (robots.txt bars AI agents by name), ufc.com (403 for the generic agent) | |

User-Agent `FightLabSim/1.0 (private research)`. Raw pages are cached under `data/raw/web_cache/<site>/`
(gitignored) and never re-fetched; parsed article JSON is memoized in `data/raw/web_cache/wikipedia/_parsed/`
and Sherdog bios in `data/raw/web_cache/sherdog/_bios_memo.json`.

## Method

**Event matching (high).** ufcstats events are matched to rows of "List of UFC events" by date (603 of
603: 570 same date, 33 one day apart with a similar name, mostly Asia/Oceania cards dated in local time).
Two ufcstats event names kept a scrapped headliner (Blanchfield vs. Barber, Jung vs. Ige); the date match
handles both. Rowspans in the list table are expanded.

**Name matching (medium-high).** Article text is accent-folded. Each card fighter matches by full name in
either order (family-name-first for East Asian names), by trailing name parts ("de Lima"), by first + last,
or by surname alone when the surname is unique on the card or the full name appears in the same
paragraph. Event names such as "UFC on ESPN: Santos vs. Hill" are masked so headliners named inside them
are not mentions. Nine ufcstats single-token names (Rongzhu, Alatengheili, ...) carry hand aliases
(Zhu Rong, Heili Alateng). A renamed fighter (ufcstats "Veronica Hardy", Wikipedia "Veronica Macedo") is
caught when the "replaced by X" name shares her first name.

**Weight misses (medium-high).** In narrative paragraphs (Background, notes, not the lead), a sentence
with a weigh-in trigger ("weighed in at", "came in heavy", "missed weight", "N pounds over",
"failed to make weight", fines "for missing weight") assigns the miss to the nearest card fighter named
before the trigger (lists such as "X, Y and Z missed weight" take all of them; "He/She/Both fighters"
take the previous sentence's subject; no fighter across a clause break such as "but after"; not the
object of "surrendered ... to X"). Amounts: an explicit "N pounds over" (digits, words, "half a",
"one and a half", fractions) wins; else scale weight minus the limit, where the limit is the division
named in the sentence ("over the bantamweight non-title fight limit"), else the agreed catchweight, else
the ufcstats weight class, else the Wikipedia weight class, else a stated "limit of N", else the
opponent's listed division; non-title bouts add the 1 lb allowance. "Respectively" lists assign in order.
A sentence with only "weighed in at W" counts only if W is over the limit; "missed on the first attempt
but made weight" is dropped. Misses in bouts that were then scrapped do not reach a ufcstats bout.

**Bout changes (medium).** A paragraph's first booking sentence (`was expected / scheduled / set / linked
to face`, `a bout between X and Y`, `pulled out of a scheduled bout against`) names who was booked
(text up to the first withdrawal word). For a final bout (P, Q): P booked and Q named later -> P
`opp_change`, Q `replacement` (or also `opp_change` when Q was booked against someone else on the card in
another paragraph); neither booked but both named later in replacement sentences -> both replacements (a
chain); both booked -> no change (bouts moved from another event stay unflagged). A replacement named in a
separate paragraph ("The UFC announced on April 6 that Nurmagomedov would be replaced by Gaethje") is
linked when P's booking paragraph shows a withdrawal and never names Q. When the Wikipedia article
cannot tell who stepped in (UFC 189: the paragraph never names Chad Mendes), nothing is flagged.

**Days of notice (medium-low).** From the sentence where the newcomer first appears, walking back to the
booking sentence, the first cue wins: "on N days'/weeks' notice" (less than / just over adjust by 1-2
days), "N days/weeks before the event", day of the event (0), weigh-in day or eve (1), fight week (4),
an explicit date ("on April 6", "6 April"), part of a month ("in late May" = 25th, early = 5th, mid =
15th), a bare month (15th). Dates of events ("originally planned to take place on April 18", "on
November 16 at UFC Fight Night") are skipped; "One week later, he was replaced" shifts an earlier date.
For a chain the cue can be the first withdrawal, so days are an upper bound there. 664 of 1,242
replacement sides carry days; recent articles often say only "replaced by".

**Venue, altitude, time (high for venues).** City, region and country come from ufcstats LOCATION;
Open-Meteo's geocoder gives the city's elevation and IANA zone (best hit by admin region and population;
Quebec City and Macau needed fixes; New Orleans has no GeoNames elevation and is set to 2 m). UTC offsets
are taken on the event date with zoneinfo, so daylight time is right. Cities at 1,000 m or higher: Mexico
City 2,240 m (96 bouts), Salt Lake City 1,299 m (61), Denver 1,609 m (46), Brasilia 1,136 m (36), Calgary
1,048 m (24), Rio Rancho 1,610 m (13), Albuquerque 1,511 m (11), Broomfield 1,644 m (10).

**Crowd and event type (high).** `crowd = none` when the Wikipedia infobox attendance reads "None (behind
closed doors)" (every UFC Apex card from May 2020 through 2021, Jacksonville May 2020, Fight Island 2020,
Brasilia March 2020), `limited` for the January 2021 Abu Dhabi cards (about 2,000 fans), else `full`.
`venue.apex` marks the small-cage UFC/Meta Apex (1,499 bouts). The crowd policy is announced before
fight night; the attendance number itself is not used. Event type: `numbered_ppv` (UFC ### through 2025),
`numbered` (2026 Paramount era, no PPV), `fight_night` (Fight Night, UFC on FOX/FX/Fuel/ESPN/ABC, Noche
UFC, UFC Macao), `tuf_finale`, `special` (UFC Freedom 250). `card_segment` normalizes the results-table
heading to main_card / prelims / early_prelims / single_card.

**Nationality (medium-high; 2,158 of 2,164 fighters of 2012-2026).** People are ufcstats persons from
tools/build_db.py (same slugs as fighters.json). Wikidata items match by Sherdog id, UFC.com slug, name or
alias with DOB agreement, or DOB + surname. Sherdog pages come from preufc's resolver, the Wikidata Sherdog
id (`/fighter/x-<id>` redirects to the page), or a name search verified against the fighter's ufcstats
bouts (preufc's rule: at least min(2, n) bouts matched by date and opponent). Primary country: Wikidata
country for sport > Sherdog nationality > a single Wikidata citizenship > citizenship that is also the
birth country > birth country. `countries` keeps all of them; `home_any` uses that set (dual nationals).
Historic states map to successors (SUN -> RUS, YUG/SCG -> SRB).

**Home point for travel (low).** Camp first (Sherdog association mapped through a hand table of 77
camps with known locations: American Top Team -> Coconut Creek, Jackson-Wink -> Albuquerque, Elevation
Fight Team -> Denver, City Kickboxing -> Auckland, Team Lakay -> Baguio, ...), else the Sherdog birthplace
when it lies in the primary country, else the reference city of the primary country (the city of its most
populous time zone; USA = Chicago as a coast compromise, Russia = Moscow). `tz_shift_h` = absolute
difference of UTC offsets on the event date, wrapped to 12; `travel_km` = great-circle distance;
`home_elev_m` = elevation of the camp or birthplace. Sherdog shows the current camp, so a fighter who
moved camps gets today's camp for old fights; travel numbers are rough by design.

## Validation (hand audit)

Two random samples of event articles were read against the extraction (seeds 11 and 23 in a scratch
script; the sentences quoted below are from the cached articles).

- **Weight misses, 45 events with weigh-in text, 54 misses on bouts that took place.** After the fixes below,
  54 of 54 found, no false positives; every size the text gives (or implies through a scale weight) is
  reproduced; two misses with no number in the text keep a null size. The first pass had one false
  positive (UFC Fight Night: Vera vs. Cruz: "expected to meet at UFC on ESPN: Santos vs. Hill, but after Lipski
  missed weight" was pinned on Angela Hill; fixed by masking event names and refusing a subject across
  "but after") and one miss (ufcstats "Rongzhu" for Wikipedia "Zhu"; fixed by the alias table), plus three
  sizes left empty (bouts that ufcstats or Wikipedia relabelled "Catchweight (189 lb)" after the miss, so
  the catchweight was taken as the limit; fixed by measuring against the division named in the weigh-in
  sentence) and one wrong size ("four pounds and one and a half pounds over ... respectively" read 1.0 for
  1.5; fixed). Misses in bouts that were then cancelled (Ladd 2022, Ulanbekov 2024, Cummings 2014,
  Penne 2019, Ansaroff 2015, Benitez 2021) correctly reach no bout. (high for 2015+, medium for 2012-2014,
  when articles are terser: 8-15 misses a year then vs 25-37 since 2019)
- **Bout changes, 13 events, 32 change sides (16 pairs) extracted.** All 16 pairings right (who stepped in,
  whose opponent changed). Days: 1 wrong (Lemos vs. Granger, 35 days taken from the date of a different
  event; fixed by skipping "<date> at UFC ..."), 1 an upper bound (Choi vs. Zalal: 22 days is the first
  withdrawal of a two-step chain), the rest match the text. Missed: 2 (UFC 169 Faber for Cruz, introduced
  only as "Stepping up to replace Cruz was Urijah Faber" with Barao outside the booking sentence; UFC 189
  Mendes, never named in the paragraph). Recall about 16 of 18; precision of pairings about 100%.
  Fighters moved from another bout on the same card are sometimes labelled `replacement` when the move is
  told inside one paragraph (UFC 189 Thatch, UFC 150 Roberts). (medium)
- **Spot checks of famous cases (high):** UFC 196 Diaz for dos Anjos 11 days; UFC 249 Gaethje for
  Nurmagomedov 33 days (April 6 announcement, May 9 card), Cruz for Aldo 31 days; UFC 251 Masvidal for
  Burns 8 days (ufcstats dates the Abu Dhabi card July 11); UFC Fight Night: Santos vs. Teixeira Birchak for
  Colares in fight week (4); UFC 160 Hunt for Overeem 77 days, Nurmagomedov 158.5 lb at lightweight (2.5 over).
- **Crowd (high):** every 2020-03-14 to 2021 Apex, Jacksonville and Fight Island card reads `none`; the
  three January 2021 Etihad Arena cards read `limited`; UFC 261 (April 24, 2021) is the first `full` card.

## Walk-forward check: do these features predict results beyond Elo?

**Setup.** Decisive UFC fights (no draws, no contests) 2012-01-01..2025-12-31 with both fighters
resolved; train 2012-2023 (5,522 fights), validate 2024-2025 (1,026). 2026 is never touched. Elo is
tools/build_db.py's walk-forward rating (K 44, boost 1.5 for a fighter's first 5 UFC fights, chosen on
2019-2023), entered as the Elo logit (Ra - Rb) x ln(10)/400. Every feature is an A minus B difference
(missed weight = 1 if A missed, -1 if B missed), the logistic has no intercept and is fit on mirrored data
(each fight in both orientations), so the A/B ordering bias (A wins 56%) cannot leak in. Standard errors
are for the unique fights (the mirrored Hessian doubled). The base model is Elo + debut (first UFC fight).
Each feature is added alone (table 1), then in a few small models (table 2). "val dLL" is the change in
mean validation log loss against the base (negative = better), with a paired bootstrap 95% CI (2,000
resamples). "val refit" re-estimates the coefficient on 2024-2025 alone as a replication check; it is not
used to pick anything.

Effects in probability terms: at even odds, b log-odds moves the win probability by about b/4
(b = -0.30 is about -7.5 points; +0.37 is about +9 points).

**Table 1. One feature at a time (log-odds per unit of the A - B difference).**

| feature (added to Elo + debut) | b (log-odds) | 95% CI, train 2012-23 | z | sides != 0 | val dLL | 95% CI | val refit b [95% CI], n |
|---|---|---|---|---|---|---|---|
| missed | -0.308 | [-0.559, -0.057] | -2.4 | 256 | -0.0004 | [-0.0025, +0.0018] | -0.21 [-0.76, +0.33], 55 |
| missed_lbs | -0.122 | [-0.205, -0.039] | -2.9 | 257 | -0.0005 | [-0.0027, +0.0017] | -0.09 [-0.27, +0.10], 58 |
| replacement | -0.304 | [-0.444, -0.163] | -4.2 | 914 | -0.0029 | [-0.0058, +0.0002] | -0.46 [-0.83, -0.10], 135 |
| repl_le14d | -0.625 | [-0.916, -0.335] | -4.2 | 229 | -0.0005 | [-0.0027, +0.0018] | -0.45 [-1.54, +0.64], 16 |
| opp_change | +0.304 | [+0.163, +0.444] | 4.2 | 914 | -0.0029 | [-0.0058, +0.0002] | +0.46 [+0.10, +0.83], 135 |
| opp_change_le14d | +0.658 | [+0.358, +0.958] | 4.3 | 217 | -0.0005 | [-0.0027, +0.0020] | +0.45 [-0.64, +1.54], 16 |
| home | +0.045 | [-0.033, +0.124] | 1.1 | 2560 | +0.0008 | [-0.0001, +0.0018] | -0.14 [-0.32, +0.04], 490 |
| home_x_fullcrowd | +0.101 | [+0.014, +0.188] | 2.3 | 2096 | +0.0013 | [-0.0003, +0.0030] | -0.13 [-0.36, +0.09], 328 |
| home_x_nocrowd_or_apex | -0.204 | [-0.389, -0.019] | -2.2 | 464 | -0.0004 | [-0.0030, +0.0021] | -0.15 [-0.47, +0.16], 162 |
| home_fullcrowd_outside_usa | +0.373 | [+0.239, +0.507] | 5.5 | 915 | -0.0040 | [-0.0081, +0.0002] | +0.51 [+0.16, +0.86], 142 |
| home_fullcrowd_in_usa | -0.105 | [-0.221, +0.010] | -1.8 | 1181 | -0.0025 | [-0.0038, -0.0012] | -0.63 [-0.93, -0.32], 186 |
| usa_national | -0.157 | [-0.237, -0.078] | -3.9 | 2514 | -0.0053 | [-0.0087, -0.0021] | -0.41 [-0.61, -0.22], 451 |
| tz_shift_per6h | -0.057 | [-0.136, +0.023] | -1.4 | 4523 | +0.0007 | [-0.0006, +0.0020] | +0.06 [-0.10, +0.23], 867 |
| altitude_adapted_at_altitude | +0.083 | [-0.449, +0.616] | 0.3 | 56 | -0.0000 | [-0.0002, +0.0003] | +0.04 [-1.17, +1.25], 11 |
| elo_x_nocrowd | +0.060 | [-0.462, +0.582] | 0.2 | 683 | +0.0000 | [-0.0000, +0.0001] | n/a, 0 |
| elo_x_altitude_km | +0.283 | [-0.181, +0.747] | 1.2 | 5234 | +0.0002 | [-0.0010, +0.0016] | -0.12 [-0.94, +0.71], 1000 |
| elo_x_catchweight | -0.238 | [-0.986, +0.510] | -0.6 | 298 | +0.0002 | [-0.0004, +0.0008] | +0.39 [-1.13, +1.91], 67 |
| elo_x_any_replacement | +0.475 | [+0.034, +0.916] | 2.1 | 909 | -0.0012 | [-0.0029, +0.0004] | +1.11 [-0.04, +2.25], 133 |

**Table 2. Models (validation 2024-2025).** `base2` adds log(1 + prior UFC fights) as a control:
experienced fighters underperform their Elo (age and decline), which by itself cuts validation log loss
from 0.6773 to 0.6641. The fight-week features keep their size on top of it.

| model | val log loss | val Brier | delta log loss [95% CI] |
|---|---|---|---|
| base: elo + debut | 0.6773 | 0.2423 | - |
| base2: elo + debut + log prior UFC fights | 0.6641 | 0.2359 | - |
| robust: base2 + missed + replacement + repl_le14d (delta vs base2) | 0.6613 | 0.2345 | -0.0028 [-0.0064, +0.0008] vs base2 |
| robust_intl: base2 + missed + replacement + repl_le14d + home outside USA (delta vs base2) | 0.6581 | 0.2329 | -0.0061 [-0.0113, -0.0009] vs base2 |
| full: elo + debut + missed + replacement + repl_le14d + home x crowd | 0.6757 | 0.2414 | -0.0016 [-0.0067, +0.0032] vs base |
| full_all: every feature except opp_change and plain home | 0.6757 | 0.2416 | -0.0015 [-0.0066, +0.0037] vs base |
| pair: replacement + repl_le14d | 0.6748 | 0.2411 | -0.0025 [-0.0054, +0.0005] vs base |
| full_nohome: elo + debut + missed + replacement + repl_le14d | 0.6745 | 0.2409 | -0.0028 [-0.0065, +0.0008] vs base |
| full_intl: elo + debut + missed + replacement + repl_le14d + home outside USA | 0.6709 | 0.2392 | -0.0064 [-0.0117, -0.0012] vs base |

**What holds up.**

- **Late replacements lose more than their rating says (high).** In training, the side that stepped in won
  39.5% of the time against an Elo expectation of 47.8% (n = 914); with 14 days' notice or less, 30.6%
  vs 46.6% (n = 229). Controlling Elo and debut: -0.30 log-odds [-0.44, -0.16]; the 14-day part adds
  another -0.44 on top of the general -0.20 (table 2). It replicates in 2024-2025 (refit -0.46 [-0.83,
  -0.10], n = 135) and improves validation log loss on its own (-0.0029, CI just touching 0). `opp_change`
  is the mirror image (the opponent who kept his slot), so it carries the same information.
- **Missing weight costs about 0.27-0.31 log-odds (medium).** Missers won 42.6% vs 50.1% expected (n = 256);
  misses of 4 lb or more 34.5% (n = 55). The size of the miss (per lb) adds little beyond the flag. In
  2024-2025 the refit is -0.21 [-0.76, +0.33] (n = 55): direction holds, size uncertain.
- **Home crowd outside the USA is a large, stable edge (high).** With a full arena outside the USA, the home
  fighter gets +0.37 log-odds [+0.24, +0.51] in training (z 5.5) and +0.51 [+0.16, +0.86] when refit on
  2024-2025 alone. Brazil is the strongest case (home side 64.2% vs 52.3% expected, n = 310, 2012-2019;
  57.1%, n = 21, 2020-2023; 73.9%, n = 23, 2024-2025); other non-US countries 56.1% (n = 512, 2012-2019),
  73.6% (n = 72, 2020-2023) and 62.2% (n = 119, 2024-2025) against about 51-52% expected.
- **"Home" inside the USA is not a home effect (medium).** US venues with one American: 49.2% vs 49.8%
  expected in 2012-2019 (n = 899), but 41.1% vs 50.0% in 2020-2023 (n = 282, still training years) and
  37.1% vs 51.4% in 2024-2025 (n = 186). The same drift shows for
  Americans anywhere (`usa_national`: -0.16 [-0.24, -0.08] in training, -0.41 [-0.61, -0.22] refit on
  2024-2025, and on its own it improves validation log loss by -0.0053 [-0.0087, -0.0021]). The likely
  cause is the rating, not the crowd: international signings arrive stronger than a 1500 Elo debut implies, and since 2020 more of them come
  through the regional circuits of Russia, Brazil, Georgia and Central Asia. This belongs in the rating
  model (a nationality or regional-record prior), not in a fight-week home bonus.
- **No home edge without a crowd (medium).** Home x (no crowd or Apex) is -0.20 [-0.39, -0.02]. Almost all
  of those fights are Americans at the Apex or Jacksonville, so this mixes the missing crowd with the US
  drift above; the closed-door cards abroad (Fight Island 2020, Brasilia March 2020) had too few local
  fighters for a clean test. Treat the home bonus as zero when there is no crowd.

**What does not show up (all CIs span zero).** Time-zone shift (-0.06 per 6 hours [-0.14, +0.02]);
altitude for camp- or birth-place-adapted fighters at venues of 1,000 m or more (56 training fights,
+0.08 [-0.45, +0.62]: too few to say); Elo x altitude, Elo x no crowd, Elo x catchweight. Elo x "any
replacement in the bout" is +0.47 [+0.03, +0.92] in training (the favorite wins more often when the
card was reshuffled) but not significant in the multi-feature model.

**Best candidate.** Elo + debut + missed + replacement + replacement within 14 days + home (full crowd,
outside the USA): validation log loss 0.6709 vs 0.6773 (dLL -0.0064 [-0.0117, -0.0012]); on top of
base2: 0.6581 vs 0.6641 (dLL -0.0061 [-0.0113, -0.0009]). The US / non-US split was first proposed after a
period and country table that pooled 2020-2025; the verification pass therefore repeated the choice with
training data only (table 3: rolling origin, fit on the years before Y, score Y = 2016..2023). On that
criterion every model with the split beats every pooled-home model, and the pick is the split with both
terms (CV 0.67862 vs 0.68058 for weigh-ins and replacements alone). The training data show the reversal on
their own: home side in the USA 41.1% vs 50.0% expected in 2020-2023; outside-USA coefficient +0.38
(2012-2016), +0.26 (2017-2019), +0.79 (2020-2023); in-USA -0.02, -0.03, -0.38. A model with the pooled
home x crowd flags instead gains nothing on 2024-2025 (-0.0016 [-0.0067, +0.0032]), because of the US
drift.

**Table 3. Training-only selection** (`meta.eval.train_only_selection`; rolling-origin log loss on
2016-2023 decides; the validation columns are shown for every candidate but nothing is chosen on them;
`usa_national` rows are a rating correction and are not eligible as the fight-week pick).

| candidate (train-only selection) | rolling CV log loss 2016-23 | val log loss | val dLL vs base [95% CI] |
|---|---|---|---|
| base | 0.68207 | 0.6773 | +0.0000 [+0.0000, +0.0000] |
| base2 (+ log prior fights) | 0.67812 | 0.6641 | -0.0132 [-0.0183, -0.0080] |
| S0: base + missed + replacement + repl_le14d | 0.68058 | 0.6745 | -0.0028 [-0.0065, +0.0008] |
| S0 + home | 0.68135 | 0.6753 | -0.0019 [-0.0056, +0.0017] |
| S0 + home x full crowd | 0.68072 | 0.6759 | -0.0014 [-0.0053, +0.0025] |
| S0 + home x full crowd + home x no crowd/Apex | 0.68033 | 0.6757 | -0.0016 [-0.0067, +0.0032] |
| S0 + home full crowd outside USA | 0.67879 | 0.6709 | -0.0064 [-0.0117, -0.0012] |
| S0 + home outside USA + home in USA (pick) | 0.67862 | 0.6687 | -0.0086 [-0.0141, -0.0032] |
| S0 + usa_national | 0.67936 | 0.6697 | -0.0075 [-0.0125, -0.0027] |
| S0 + home outside USA + usa_national | 0.67844 | 0.6683 | -0.0090 [-0.0146, -0.0034] |

## Caveats

- **Wikipedia is the only source for weigh-ins and bout changes.** Recall is near complete for misses
  since 2015 in the audit; 2012-2014 articles are terser and probably under-report small misses. A miss
  that Wikipedia does not mention reads `missed = false`. Bout changes that the article tells without
  naming the newcomer in the booking paragraph are missed (UFC 189). Days of notice exist for 53% of
  replacements and are approximate: "late May" is the 25th, a bare month the 15th, fight week 4 days; in
  a chain of replacements the date can be the first withdrawal (an upper bound). The article text is
  today's revision; edits after the event could in principle add colour to upsets, but the facts used
  (who was booked, who replaced whom, scale weights) are pre-fight facts.
- **Nationality is a 2026 snapshot** of slow-moving facts (country for sport, Sherdog flag). Dual nationals
  get one primary country (Wikidata country for sport first); `home_any` and `countries` keep the rest.
  99.9% of 2012-2026 sides have a nationality; the rest (mostly one- or two-fight fighters without a
  Wikidata item or a resolvable Sherdog page) read `home = null`, which the evaluation treats as not home.
- **Home point for travel is rough (low).** Sherdog lists today's camp, sometimes a short training camp
  rather than the fighter's base (Volkanovski shows City Kickboxing, Auckland, though he lives in
  Wollongong); camp locations are a hand table of 77 gyms; otherwise birthplace or the country's reference
  city (USA = Chicago). Time-zone shift carried no signal here, possibly because of this noise.
- **Altitude is the venue city's elevation** (GeoNames through Open-Meteo), not the arena's; altitude
  adaptation is the camp or birthplace elevation (>= 1,000 m; an elevation is known for 14,038 sides); only 56 training
  fights pair an adapted and a non-adapted fighter at altitude, far too few to test.
- **Crowd** comes from Wikipedia's infobox attendance; Apex cards after 2021 are `full` with `apex = true`
  (small invited audiences), so use the Apex flag for the small venue.
- **Evaluation**: one Elo specification; the 14-day threshold and the US split were chosen by looking at the
  data (the US split after a table that included 2024-2025; a training-only rolling selection picks the same
  split, table 3; the 14-day threshold is not the training-CV optimum, 10 days is, and the difference is
  noise); bootstrap CIs on 1,026 validation fights are wide and cover validation sampling only, not the
  uncertainty of the training fit. The coefficients are for "beyond Elo + debut", so they partly absorb what Elo misses about the same
  fighters (a replacement is often a newcomer with a thin record; the experience control in base2 leaves
  the replacement effect at -0.20 / -0.44).

## For the engine and the backlog

- **Replacement penalty (v4+, high):** a fighter who steps in late: -0.20 log-odds, and -0.44 more with 14
  days' notice or less (total about -0.65, roughly -15 points at even odds); his opponent is the mirror.
  Use `fightweek.json` `replacement` / `short_notice` for historical fights; for an upcoming card the
  same fields are known before the weigh-ins. In the engine this maps naturally to a fight-night form
  draw (output and cardio) for the replacement rather than a flat probability shift.
- **Weight miss (v4+, medium):** -0.27 to -0.28 log-odds for the fighter who misses (larger misses, 4 lb+, look
  worse); known about 30 hours before the fight. Keep it as a labelled knob in the engine (stamina hit).
- **Home crowd (v4+, high outside the USA):** +0.37 log-odds (about +9 points at even odds) for the local
  fighter with a full arena outside the USA (Brazil strongest); zero at the Apex, behind closed doors and
  inside the USA.
- **Rating model (not fight-week, for the Elo/priors owner):** two drifts showed up as side results:
  experienced fighters underperform Elo (log prior UFC fights -0.23 per unit, val log loss 0.6773 ->
  0.6641), and Americans underperform Elo, increasingly (-0.16 in 2012-2023, -0.41 in 2024-2025). Both
  deserve a proper test in the main model (age, regional-record priors for international signings).
- **No engine knob needed** for time-zone shift or venue altitude on current evidence (travel distance is
  stored but was not tested separately; it tracks the time-zone shift closely);
  keep the fields for interaction tests (cardio x altitude for 5-round fights at Mexico City / Salt Lake
  City / Denver) once a stamina model exists.

## Verification log

Adversarial re-check, Friday, November 6, 2026 (afternoon), after the first verifier was cut off by a usage
limit. Brief: assume the headline results are inflated or wrong; look for look-ahead, corner-order
exploitation, bad joins, post-result text, over-claimed precision and code bugs; recompute with fresh code.
Scratch scripts (own Elo, own features, scikit-learn fits) stayed outside the repo; the reusable parts are
now `python3 tools/fightweek.py verify` and `meta.eval.train_only_selection`.

**Verdict.** No look-ahead or corner-order leakage found, and the numbers reproduce with independent code.
What was wrong: the report and the JSON were out of step (stale numbers, no `meta.eval`), the headline value
was overstated (most of it is the home term; weigh-ins and replacements alone do not clear zero on
2024-2025), the home split had been read off a table that included the validation years, and two
reporting bugs. All fixed below; the effects stay small (-0.006 to -0.009 validation log loss).

1. **Stale artifact (fixed).** The tool was patched after the report was written (year and TUF pages read
   only from the event's own section; weigh-in parser fixes) and `fightweek.json` was rebuilt at 11:36
   without `eval`, so `meta.eval`, which the report cites for every number, was missing. Rebuilt (a second
   build gives identical `fights` and `fighters`), re-ran `eval`, and regenerated every table and prose
   number. What moved: misses 355 -> 350 (sized 322 -> 332), replacements 1,244 -> 1,242, opponent changes
   1,154 -> 1,150, catchweight 418 -> 412; the miss coefficient -0.299 -> -0.308 and its 2024-2025 refit
   -0.08 (n = 56) -> -0.21 (n = 55); the headline dLL -0.0060 -> -0.0064 (base2 version -0.0057 -> -0.0061).
2. **Independent recomputation (passed).** Own Elo (K 44, x1.5 for the first 5 UFC fights) matches
   build_db's pre-fight ratings to 2e-13. All 7,156 records match build_db's persons and dates in ufcstats
   order (0 slug mismatches, 0 swapped pairs). A wins 58.5% of the training fights and 54.9% of the
   validation fights, so order would matter, but every fitted model is exactly symmetric (flipping every
   validation fight returns 1 - p). Mirrored no-intercept fits with scikit-learn and a different bootstrap
   seed reproduce the tool: replacement -0.304 (+-0.140), full_intl dLL -0.0064 [-0.0115, -0.0011],
   robust_intl -0.0061 [-0.0112, -0.0008], full_nohome -0.0028 [-0.0063, +0.0009], base2 -0.0132.
3. **Corner order in the text parsers (passed).** The bout-change parser has an order-dependent branch (the
   cross-paragraph pass tries side A as the fighter who kept his slot first), which could pin replacements
   on B, the usual loser. Test: rerun the weigh-in and bout-change parsers on all 603 events with every
   bout's A and B swapped, and with the card order reversed: 0 differences across 358 weigh-in and 2,392
   change records.
4. **Result text leaking into features (passed, one gap).** Wikipedia's results tables and payout lists
   name the winner first, and some articles have post-fight sections. Results-table rows only attach the card
   segment, weight class and footnotes to a bout (bout-level, not side-level). Rerunning the parsers without
   post-fight sections (payouts, bonuses, reception, controversies, fight write-ups, brackets) changes 2
   records, both pre-fight facts that happen to sit in a payout section (UFC 157: Burrell fined for missing
   weight; TUF: A Champion Will Be Crowned Finale: Daly at 118 lb, the "explicit" flag only). A scan of every
   stored weigh-in sentence for result words finds 3 hits, all "undefeated". Not testable here: edits made
   to an article after the event (only today's revision is cached; old revisions sit under `/w/`, which
   robots.txt disallows).
5. **Validation-set selection (fixed).** The US / non-US home split was proposed after a table that pooled
   2020-2025. The eval now repeats the choice with training data only (rolling origin inside 2012-2023,
   table 3): every split model beats every pooled-home model, and the pick (home outside plus home inside
   the USA) scores -0.0086 [-0.0141, -0.0032] on 2024-2025; the outside-only model -0.0064. The reversal is
   in the training years: home side in the USA 41.1% vs 50.0% expected in 2020-2023, outside-USA
   coefficient +0.79 in 2020-2023. The descriptive country tables now keep 2020-2023 and 2024-2025 apart.
6. **Over-claimed precision (fixed in the text).** Finding 6 now says that weigh-ins and replacements alone
   give -0.0028 [-0.0065, +0.0008] (CI spans zero) and that the experience control alone (-0.0132) is
   twice the whole fight-week block; finding 4's "replicated" is qualified as described in item 5.
7. **Hidden-data protocol (tightened).** The eval never scored a 2026 fight, but it ran Elo over 2026
   results that only 2026 rows would use; it now stops at 2025-12-31 (numbers unchanged). Training spans
   2012-2023, wider than the protocol's 2019-2023 tuning window (older data, not hidden data); refit on
   2019-2023 only: full_intl -0.0061 [-0.0113, -0.0008], full_nohome -0.0027 [-0.0067, +0.0016],
   robust_intl -0.0056 [-0.0108, -0.0004]: same picture. `fightweek.json` holds 480 bouts from 2026
   (features only, no results). Their A/B order is ufcstats order, which leans winner-first, so anyone using
   those rows must keep the symmetric-evaluation rule. The raw ufcstats CSVs in `data/raw/` already contain
   the 2026 results, so this file adds no new exposure.
8. **Code bugs (fixed).** `full_all` contained `home` together with `home_x_fullcrowd` and
   `home_x_nocrowd_or_apex`, an exact linear dependence, so its printed coefficients and CIs belonged to
   an unidentified model (its predictions were unaffected); `home` is dropped. The validation refit of a
   feature that never occurs in 2024-2025 (`elo_x_nocrowd`) printed "+0.00 [+0.00, +0.00]" from a NaN
   square root; it now prints n/a.
9. **Spot audit of validation-year features (passed).** I read 14 random 2024-2025 replacement sides and
   14 random 2024-2025 misses against their source sentences, and all 28 are right (for example UFC 298:
   Dern replaced Suarez against Lemos; UFC 302: Romanov replaced Volkov against Almeida; Dariush 157.2 lb at
   UFC 322).
10. **Left as caveats (not fixable here).** Wikipedia is the only source for weigh-ins and bout changes
    (2012-2014 recall is lower). Days of notice are approximate and unknown for 47% of replacements, and
    `replacement` includes long-notice replacements. Nationality and camp are 2026 snapshots; the camp feeds
    only travel and time-zone shift, which carry no signal. The 14-day threshold is not the training-CV
    optimum (10 days is, and the gap is noise).
