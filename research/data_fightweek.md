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
- Rerun (no network): `python3 tools/fightweek.py all` (build about 1.5 minutes on this loaded machine, eval about
  30 seconds). Refetch steps (cached, polite): `fetch-wiki`, `fetch-geo`, `fetch-sherdog`.

Confidence legend: **high** = direct count or a large sample; **medium** = depends on text parsing or a
modest sample; **low** = an approximation that could be off for individual fighters.

## Findings

__FINDINGS__

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
  "weighin_text": {"A": the sentence the miss came from}                                   # when a miss was found
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
For a chain the cue can be the first withdrawal, so days are an upper bound there. 665 of 1,244
replacement sides carry days; recent articles often say only "replaced by".

**Venue, altitude, time (high for venues).** City, region and country come from ufcstats LOCATION;
Open-Meteo's geocoder gives the city's elevation and IANA zone (best hit by admin region and population;
Quebec City and Macau needed fixes; New Orleans has no GeoNames elevation and is set to 2 m). UTC offsets
are taken on the event date with zoneinfo, so daylight time is right. Cities at 1,000 m or higher: Mexico
City 2,240 m (96 bouts), Salt Lake City 1,299 m (61), Denver 1,609 m (46), Brasilia 1,136 m (36), Calgary
1,048 m (24), Rio Rancho 1,610 m (13), Albuquerque 1,511 m (11), Broomfield 1,644 m (10).

**Crowd and event type (high).** `crowd = none` when the Wikipedia infobox attendance reads "None (behind
closed doors)" (every UFC Apex card from May 2020 to mid-2021, Jacksonville May 2020, Fight Island 2020,
Brasilia March 2020), `limited` for the January 2021 Abu Dhabi cards (about 2,000 fans), else `full`.
`venue.apex` marks the small-cage UFC/Meta Apex (1,499 bouts). The crowd policy is announced before
fight night; the attendance number itself is not used. Event type: `numbered_ppv` (UFC ### through 2025),
`numbered` (2026 Paramount era, no PPV), `fight_night` (Fight Night, UFC on FOX/FX/Fuel/ESPN/ABC, Noche
UFC, UFC Macao), `tuf_finale`, `special` (UFC Freedom 250). `card_segment` normalizes the results-table
heading to main_card / prelims / early_prelims / single_card.

**Nationality (medium-high; 87% of 2012-2026 fighters).** People are ufcstats persons from
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

__EVAL__

## Caveats

__CAVEATS__

## For the engine and the backlog

__BACKLOG__
