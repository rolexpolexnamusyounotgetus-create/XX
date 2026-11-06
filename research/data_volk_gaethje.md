# Volkanovski and Gaethje: data fight logs, derived profiles and engine inputs

Friday, November 6, 2026. Every number here comes from the UFC stats snapshot in `data/raw/`
(github.com/Greco1899/scrape_ufc_stats, scraped from ufcstats.com, events through Oct 31, 2026), run through
the scripts named below, unless a line says otherwise. Results after mid-2026 (UFC 324, UFC 325, UFC Freedom
250, UFC 333) come from the dataset. I couldn't re-check them on the web this session: the shared web-search
budget was already used up, and ufcstats.com and f4wonline.com don't resolve from this session's network.
Where the v2 HANDOFF cites a web source for the same fact, I say whether the dataset agrees.

## How to reproduce, and what was built

```
python3 tools/fit_combine.py                     # ~6 s, writes data/derived/combine_fit.json
python3 tools/fighter_report.py "Alexander Volkanovski" --vs "Justin Gaethje" --division Lightweight
python3 tools/fighter_report.py "Any Fighter"    # works for every fighter in the snapshot
python3 tools/fighter_report.py "Max Holloway" --asof 2024-04-12     # frozen, as-of a date
python3 tools/fighter_report.py "Bruno Silva" --only-divisions Middleweight   # splits shared names
```

- `tools/fighter_report.py` (new, generic). Writes `data/derived/fighter_<slug>.json` and `.md`, and with
  `--vs`, `data/derived/matchup_<a>__<b>.json` and `.md`. The profile JSON has: bio (ufcstats height, reach,
  stance, DOB, age as of the date); record by method; a per-fight log with both sides' totals; rates for
  career, last 3 years, last 4 years and time-decayed (half-life 730 days by default); raw sums for each window
  and for half-lives of 365, 730 and 1460 days; chin, power, chin-event and knockdown logs; pace curves;
  division splits; opponent-adjusted indices; division priors with fitted shrinkage strengths; and
  `spec_sums` `C`/`S` vectors in the key names of `docs/ENGINE_V3_SPEC.md` (`min n rds d_att ... r5_lnd_5`,
  plus `s_att/s_lnd` and `r5_min_1..5`, `r5_att_1..5`), so `tools/build_db.py` can reuse it. About 3 seconds
  per run.
- `tools/fit_combine.py` (new). A walk-forward test of how two fighters' rates combine in one fight, with
  shrinkage strength and time-decay half-life tuned on 2012-2023 and scored on 2024-2026 (section 11).
  `fighter_report.py --vs` reads its output.
- Data fixes found on the way. (1) The scrape lists two cards twice under two names ("Noche UFC: Lopes vs.
  Silva" / "UFC Fight Night: Lopes vs. Silva", and the same for "Grasso vs. Shevchenko 2"), with the same 25
  fight URLs. Without a fix those fights count twice. The scripts keep one row per fight URL. (2) "UFC - Road
  to UFC 4.6" has no row in the events file, so it has no date and is dropped. (3) In `DETAILS`, ufcstats
  lists each judge's card loser-first: Volkanovski's 50-45 wins over Holloway read "45 - 50". The reports
  flip the cards so the fighter's own score comes first. (4) The fighter files have 9 duplicate names (e.g.
  Bruno Silva, Michael McDonald). Bouts carry no fighter id, so the report warns on those names and takes
  `--only-divisions`.

Definitions. Minutes = completed rounds at scheduled length plus the final round's clock. "Sig." =
significant strikes. Head/body/leg and distance/clinch/ground are ufcstats' target and position splits.
"Opp." = what opponents did to him. Control time is ufcstats control, which counts clinch control as well
as ground control. KO/TKO includes doctor and corner stoppages. League columns pool every fighter-minute in
the division from Oct 31, 2020 to Oct 31, 2026, counting each bout from both sides.

## 1. Headline findings (all from the data; confidence is about the inference, not the arithmetic)

1. **Volume and defense.** Volkanovski out-lands his opponents by 2.65 sig. strikes a minute over his career
   (5.98 landed, 3.33 absorbed) and by 2.21 over the last 3 years. Gaethje is negative: -0.54 career and
   -1.08 over the last 3 years (4.82 landed, 5.91 absorbed). Opponents land 41.8% of their sig. strikes on
   Volk (44.1% time-decayed) and 49.3% on Gaethje (55.7% over the last 3 years; the lightweight league figure
   is 48.0%). High confidence.
2. **Opponent-adjusted** (leave-one-out against each opponent's other UFC fights): Volk lands 1.53x what his
   opponents usually absorb and absorbs 0.74x what they usually land. Gaethje lands 1.55x but absorbs 1.45x.
   So both hit opponents harder than those opponents' norms, and only Volk also takes less than their norms.
   High confidence.
3. **Chin, recent.** Knockdowns absorbed per 100 sig. head strikes absorbed: Volk 0.63 career, but **1.59
   over the last 4 years** (3 knockdowns in 189 head strikes: Makhachev's head kick, Topuria, Lopes at UFC
   314). Gaethje is 0.52 career and **0.72 over the last 4 years** (2 in 279: Holloway, Topuria). Shrunk
   toward the division (k = 224 head strikes, fitted): Volk last 4y 1.24 vs featherweight 0.94 (1.32x
   league); Gaethje 0.82 vs lightweight 0.95 (0.86x). Time-decayed: Volk 0.91 (0.97x), Gaethje 0.85 (0.89x).
   On a per-strike basis the data reads Gaethje as the more durable of the two now. Medium confidence: five
   events in total, and Volk's came against elite strikers (selection).
4. **Power.** Knockdowns per 100 sig. head strikes landed: Gaethje 1.07 career, 0.99 over the last 4 years
   (division 0.95). Volk 0.49 career, 0.28 over the last 4 years, 0.21 time-decayed; shrunk, about 0.52-0.56.
   That puts Volk at roughly 0.55-0.6x league per head strike and Gaethje at about 1.07x. Four of Volk's six
   KO/TKO wins came from ground strikes (Kasuya, Kennedy, Rodriguez, Evloev), so the engine needs his
   ground-and-pound finishing more than standing knockdown power. High confidence on the counts, medium on
   the interpretation (Volk lands many jabs and low-power shots).
5. **Pace.** In fights that reached round 5, Volk's sig. landed per minute rises from 4.40 in round 1 to 7.20
   in round 5 (1.64x). The featherweight league curve is 1.32x at round 5, so Volk rises well above it.
   Gaethje's three five-round fights that reached round 5 go 4.33 to 5.94 (1.37x; lightweight league 1.31x).
   The v2 engine had Gaethje fading ([1.05, 1.00, 0.98, 0.97, 0.93]); the data doesn't show a fade in his
   output, though n = 3. Medium confidence.
6. **Gaethje's leg kicks have almost disappeared.** Leg-strike attempts per minute by fight: 4.29, 2.86,
   3.67 (2017-18); 0.53, 0.44, 0.25 in his last three fights (Fiziev 2, Pimblett, Topuria). His leg share of
   sig. attempts is 14.9% career and 7.7% over the last 3 years. v2's "gaeLeg 0.18" knob and the "Gaethje
   chops calves" preset (0.32) sit well above his recent behavior. High confidence on the trend, unknown cause.
7. **Grappling.** Volk attempts 4.75 takedowns per 15 career (4.33 decayed) and lands 34% (20% over the last
   3 years). Gaethje defends 73% (74% decayed) and is taken down rarely (opponents attempt 2.2 per 15). The
   walk-forward fit projects Volk at about 3.0 takedown attempts per 15 against Gaethje and about 30% success:
   roughly 0.9 takedowns landed per 15 and 1.5 over 25 minutes. Volk at lightweight was controlled for
   245 seconds per 15 (Makhachev), against 23 at featherweight. Medium confidence.
8. **Head-to-head projection** (section 10, tuned shrinkage and decay, lightweight league): Volk lands about
   6.1-7.2 sig. strikes a minute on Gaethje across windows and decompositions, and Gaethje about 3.8-4.4 on
   Volk. Over 25 minutes that's roughly 150-180 to 95-110. A knockdown per landed head strike is about 0.45-0.62
   per 100 for Volk and 0.83-1.10 for Gaethje, so naive knockdowns per 25 minutes come out close: Volk 0.51-0.63,
   Gaethje 0.63-0.74. Volk's volume edge is offset by Gaethje's per-strike power and Volk's recent chin
   numbers. That is the core tension the engine has to resolve. Medium confidence.
9. **How to combine rates** (section 11, 6,976 training and 2,048 test fighter-fights, walk-forward). The
   pure log-linear rule `league x (x / league) x (y_allowed / league)`, applied after shrinking each
   fighter's rate toward the division, beat both the fitted exponents and the v2 average out of sample for
   strike attempts, landed strikes, accuracy (log5) and knockdowns per head strike. For takedown attempts
   and takedown accuracy the fitted exponents won. The v2 average under-predicts high-pace pairs by about
   25-30%. Predictions ran 5% high in 2024-2026 (observed / predicted 0.95 for both strike attempts and
   landed strikes), so a global strike scale of about 0.95 belongs in calibration (v2 used 0.85 on a
   different formula). High confidence for the method comparison.
10. **Age** (men, 2010-2026, cross-sectional): knockdowns absorbed per 100 head strikes absorbed rise about
    3.7% a year after age 30 (SE 0.8%); knockdowns scored per head strike fall about 2.8% a year (SE 1.0%).
    At 38 that is about 1.34x and 0.80x the age-30 rates. Both men are 37-38 as of the snapshot (Volk 38,
    born Sep 29, 1988; Gaethje 37, born Nov 14, 1988, per ufcstats), so age roughly cancels head to head,
    but it matters against league priors. Medium confidence: survivor and selection effects pull both ways.

## 2. Bio and record (dataset)

| | Alexander Volkanovski | Justin Gaethje |
|---|---|---|
| ufcstats height / reach / stance | 66 in / 71 in / Orthodox | 71 in / 70 in / Orthodox |
| DOB (age at Oct 31, 2026) | Sep 29, 1988 (38) | Nov 14, 1988 (37; 38 on Nov 14, 2026) |
| UFC record in the data | 16-3 (KO/TKO 6, dec 10; losses KO/TKO 2, dec 1) | 11-5 (KO/TKO 7, dec 4; losses KO/TKO 3, sub 2) |
| UFC fights / five-round / title | 19 / 12 / 12 | 16 / 12 / 4 |
| Divisions | Featherweight 15, Lightweight 3, Catch Weight 1 | Lightweight 16 |
| Last fight | Oct 24, 2026, UFC 333, W TKO R2 4:54 vs Evloev | Jun 14, 2026, UFC Freedom 250, W corner stoppage after R4 vs Topuria |
| UFC minutes with stats | 312.9 | 202.2 |

Pro records. The HANDOFF gives 29-4 (Volk) and 28-5 (Gaethje), citing CBS Sports and gidstats. The UFC part
of each matches the dataset (16-3 and 11-5) if their pre-UFC records were 13-1 and 17-0. That is consistent
with what I know of their pre-UFC careers (Gaethje's first loss was to Alvarez in his second UFC fight), but
I couldn't re-fetch either source today. Medium confidence.

## 3. Alexander Volkanovski: fight log

Decision details are the three judges' cards with this fighter's score first.

| # | Date | Event | Opponent | Class | Res | Method | Detail | Rd | Time | Sched |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2016-11-26 | UFC Fight Night: Whittaker vs. Brunson | Yusuke Kasuya | Lightweight | W | KO/TKO | Punches to Head On Ground | 2 | 2:06 | 3 |
| 2 | 2017-06-10 | UFC Fight Night: Lewis vs. Hunt | Mizuto Hirota | Featherweight | W | U-DEC | 30-27, 30-27, 30-27 | 3 | 5:00 | 3 |
| 3 | 2017-11-18 | UFC Fight Night: Werdum vs. Tybura | Shane Young | Catch Weight | W | U-DEC | 30-27, 30-26, 30-26 | 3 | 5:00 | 3 |
| 4 | 2018-02-10 | UFC 221: Romero vs. Rockhold | Jeremy Kennedy | Featherweight | W | KO/TKO | Punches to Head From Half Guard | 2 | 4:57 | 3 |
| 5 | 2018-07-14 | UFC Fight Night: Dos Santos vs. Ivanov | Darren Elkins | Featherweight | W | U-DEC | 30-27, 29-28, 29-28 | 3 | 5:00 | 3 |
| 6 | 2018-12-29 | UFC 232: Jones vs. Gustafsson 2 | Chad Mendes | Featherweight | W | KO/TKO | Punches to Head At Distance | 2 | 4:14 | 3 |
| 7 | 2019-05-11 | UFC 237: Namajunas vs. Andrade | Jose Aldo | Featherweight | W | U-DEC | 30-27, 30-27, 30-27 | 3 | 5:00 | 3 |
| 8 | 2019-12-14 | UFC 245: Usman vs. Covington | Max Holloway | Featherweight (title) | W | U-DEC | 48-47, 48-47, 50-45 | 5 | 5:00 | 5 |
| 9 | 2020-07-11 | UFC 251: Usman vs. Masvidal | Max Holloway | Featherweight (title) | W | S-DEC | 48-47, 47-48, 48-47 | 5 | 5:00 | 5 |
| 10 | 2021-09-25 | UFC 266: Volkanovski vs. Ortega | Brian Ortega | Featherweight (title) | W | U-DEC | 49-46, 50-45, 50-44 | 5 | 5:00 | 5 |
| 11 | 2022-04-09 | UFC 273: Volkanovski vs. The Korean Zombie | Chan Sung Jung | Featherweight (title) | W | KO/TKO | Punches to Head At Distance | 4 | 0:45 | 5 |
| 12 | 2022-07-02 | UFC 276: Adesanya vs. Cannonier | Max Holloway | Featherweight (title) | W | U-DEC | 50-45, 50-45, 50-45 | 5 | 5:00 | 5 |
| 13 | 2023-02-11 | UFC 284: Makhachev vs. Volkanovski | Islam Makhachev | Lightweight (title) | L | U-DEC | 47-48, 47-48, 46-49 | 5 | 5:00 | 5 |
| 14 | 2023-07-08 | UFC 290: Volkanovski vs. Rodriguez | Yair Rodriguez | Featherweight (title) | W | KO/TKO | Punches to Head On Ground | 3 | 4:19 | 5 |
| 15 | 2023-10-21 | UFC 294: Makhachev vs. Volkanovski 2 | Islam Makhachev | Lightweight (title) | L | KO/TKO | Kick to Head At Distance | 1 | 3:06 | 5 |
| 16 | 2024-02-17 | UFC 298: Volkanovski vs. Topuria | Ilia Topuria | Featherweight (title) | L | KO/TKO | Punch to Head At Distance | 2 | 3:32 | 5 |
| 17 | 2025-04-12 | UFC 314: Volkanovski vs. Lopes | Diego Lopes | Featherweight (title) | W | U-DEC | 49-46, 49-46, 48-47 | 5 | 5:00 | 5 |
| 18 | 2026-01-31 | UFC 325: Volkanovski vs. Lopes 2 | Diego Lopes | Featherweight (title) | W | U-DEC | 49-46, 49-46, 50-45 | 5 | 5:00 | 5 |
| 19 | 2026-10-24 | UFC 333: Volkanovski vs. Evloev | Movsar Evloev | Featherweight (title) | W | KO/TKO | Punches to Head From Half Guard | 2 | 4:54 | 5 |

### Per-fight totals, both sides

| # | Opponent | Min | Sig for | Sig ag | Head for | Head ag | Body for | Body ag | Leg for | Leg ag | Dist for | Dist ag | Clinch for | Clinch ag | Ground for | Ground ag | KD for-ag | TD for | TD ag | Ctrl for | Ctrl ag | Sub for-ag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Yusuke Kasuya | 7.10 | 50/76 | 4/10 | 47/71 | 2/6 | 2/3 | 2/4 | 1/2 | 0/0 | 2/7 | 3/8 | 3/3 | 1/2 | 45/66 | 0/0 | 0-0 | 3/3 | 1/2 | 4:23 | 1:40 | 0-0 |
| 2 | Mizuto Hirota | 15.00 | 87/139 | 46/149 | 55/97 | 39/139 | 9/13 | 2/5 | 23/29 | 5/5 | 46/93 | 42/142 | 18/20 | 2/5 | 23/26 | 2/2 | 1-0 | 4/7 | 0/5 | 5:18 | 0:23 | 0-0 |
| 3 | Shane Young | 15.00 | 68/114 | 18/81 | 36/78 | 11/67 | 11/13 | 5/10 | 21/23 | 2/4 | 40/71 | 15/75 | 14/25 | 3/6 | 14/18 | 0/0 | 0-0 | 5/14 | 1/1 | 8:21 | 0:16 | 0-0 |
| 4 | Jeremy Kennedy | 9.95 | 73/120 | 8/25 | 57/103 | 7/24 | 10/10 | 1/1 | 6/7 | 0/0 | 4/9 | 1/18 | 5/8 | 0/0 | 64/103 | 7/7 | 0-0 | 2/3 | 0/3 | 7:55 | 0:27 | 0-0 |
| 5 | Darren Elkins | 15.00 | 100/144 | 82/172 | 76/118 | 66/147 | 11/13 | 15/24 | 13/13 | 1/1 | 81/118 | 67/148 | 18/25 | 15/24 | 1/1 | 0/0 | 2-0 | 2/12 | 1/6 | 3:25 | 0:59 | 3-0 |
| 6 | Chad Mendes | 9.23 | 54/124 | 28/51 | 36/91 | 16/37 | 10/19 | 6/7 | 8/14 | 6/7 | 46/113 | 24/46 | 5/8 | 4/5 | 3/3 | 0/0 | 1-1 | 0/0 | 3/4 | 0:08 | 0:45 | 0-0 |
| 7 | Jose Aldo | 15.00 | 95/176 | 29/79 | 28/93 | 19/63 | 17/24 | 7/12 | 50/59 | 3/4 | 67/147 | 26/76 | 28/29 | 3/3 | 0/0 | 0/0 | 0-0 | 0/3 | 0/1 | 4:26 | 0:07 | 0-0 |
| 8 | Max Holloway | 25.00 | 157/303 | 134/303 | 67/178 | 85/233 | 15/32 | 32/44 | 75/93 | 17/26 | 156/302 | 132/301 | 1/1 | 2/2 | 0/0 | 0/0 | 0-0 | 0/4 | 0/0 | 0:44 | 0:02 | 0-0 |
| 9 | Max Holloway | 25.00 | 137/272 | 102/268 | 64/161 | 44/167 | 6/10 | 27/46 | 67/101 | 31/55 | 136/265 | 95/258 | 1/6 | 7/10 | 0/1 | 0/0 | 0-0 | 3/9 | 0/0 | 1:26 | 0:00 | 0-0 |
| 10 | Brian Ortega | 25.00 | 214/353 | 88/234 | 146/270 | 59/193 | 20/26 | 20/26 | 48/57 | 9/15 | 158/254 | 82/225 | 3/6 | 6/9 | 53/93 | 0/0 | 0-0 | 0/0 | 2/5 | 3:51 | 0:54 | 0-3 |
| 11 | Chan Sung Jung | 15.75 | 138/213 | 48/125 | 102/171 | 31/103 | 10/13 | 9/11 | 26/29 | 8/11 | 116/185 | 44/121 | 10/12 | 4/4 | 12/16 | 0/0 | 1-0 | 4/8 | 0/0 | 2:52 | 0:00 | 0-0 |
| 12 | Max Holloway | 25.00 | 199/372 | 127/301 | 152/316 | 64/213 | 19/24 | 42/59 | 28/32 | 21/29 | 175/340 | 109/283 | 24/32 | 18/18 | 0/0 | 0/0 | 0-0 | 0/0 | 0/3 | 1:57 | 0:16 | 0-0 |
| 13 | Islam Makhachev | 25.00 | 70/143 | 57/95 | 37/96 | 36/72 | 21/33 | 18/20 | 12/14 | 3/3 | 58/125 | 45/82 | 6/10 | 12/13 | 6/8 | 0/0 | 1-0 | 0/4 | 4/9 | 2:55 | 7:37 | 0-0 |
| 14 | Yair Rodriguez | 14.32 | 66/97 | 40/80 | 48/69 | 13/49 | 4/5 | 11/14 | 14/23 | 16/17 | 25/45 | 38/77 | 4/6 | 0/0 | 37/46 | 2/3 | 0-0 | 7/12 | 0/0 | 7:13 | 0:00 | 0-0 |
| 15 | Islam Makhachev | 3.10 | 4/6 | 24/29 | 0/1 | 13/16 | 1/1 | 9/11 | 3/4 | 2/2 | 3/5 | 7/11 | 1/1 | 8/9 | 0/0 | 9/9 | 0-1 | 0/0 | 0/1 | 0:49 | 0:19 | 0-0 |
| 16 | Ilia Topuria | 8.53 | 47/107 | 35/77 | 21/68 | 17/53 | 11/22 | 12/16 | 15/17 | 6/8 | 44/102 | 28/70 | 3/5 | 4/4 | 0/0 | 3/3 | 0-1 | 0/0 | 0/0 | 0:00 | 0:03 | 0-0 |
| 17 | Diego Lopes | 25.00 | 158/259 | 63/194 | 136/225 | 49/171 | 8/14 | 7/13 | 14/20 | 7/10 | 142/237 | 59/185 | 7/11 | 3/8 | 9/11 | 1/1 | 0-1 | 1/11 | 0/0 | 1:18 | 0:05 | 0-0 |
| 18 | Diego Lopes | 25.00 | 98/160 | 70/158 | 72/118 | 33/98 | 3/6 | 17/33 | 23/36 | 20/27 | 88/149 | 66/152 | 3/4 | 3/4 | 7/7 | 1/2 | 0-0 | 2/7 | 2/5 | 2:49 | 1:50 | 1-0 |
| 19 | Movsar Evloev | 9.90 | 56/110 | 40/65 | 48/101 | 28/50 | 3/4 | 8/9 | 5/5 | 4/6 | 42/90 | 31/55 | 3/4 | 8/9 | 11/16 | 1/1 | 0-0 | 1/2 | 3/7 | 1:44 | 0:46 | 0-0 |

## 4. Justin Gaethje: fight log

Decision details are the three judges' cards with this fighter's score first.

| # | Date | Event | Opponent | Class | Res | Method | Detail | Rd | Time | Sched |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 2017-07-07 | The Ultimate Fighter: Redemption Finale | Michael Johnson | Lightweight | W | KO/TKO | Knees to Head In Clinch | 2 | 4:48 | 5 |
| 2 | 2017-12-02 | UFC 218: Holloway vs. Aldo 2 | Eddie Alvarez | Lightweight | L | KO/TKO | Knee to Head In Clinch | 3 | 3:59 | 3 |
| 3 | 2018-04-14 | UFC Fight Night: Poirier vs. Gaethje | Dustin Poirier | Lightweight | L | KO/TKO | Punch to Head In Clinch | 4 | 0:33 | 5 |
| 4 | 2018-08-25 | UFC Fight Night: Gaethje vs. Vick | James Vick | Lightweight | W | KO/TKO | Punch to Head In Clinch | 1 | 1:27 | 5 |
| 5 | 2019-03-30 | UFC Fight Night: Barboza vs. Gaethje | Edson Barboza | Lightweight | W | KO/TKO | Punch to Head At Distance | 1 | 2:30 | 5 |
| 6 | 2019-09-14 | UFC Fight Night: Cowboy vs. Gaethje | Donald Cerrone | Lightweight | W | KO/TKO | Punch to Head At Distance | 1 | 4:18 | 5 |
| 7 | 2020-05-09 | UFC 249: Ferguson vs. Gaethje | Tony Ferguson | Lightweight (title) | W | KO/TKO | Punch to Head At Distance | 5 | 3:39 | 5 |
| 8 | 2020-10-24 | UFC 254: Khabib vs. Gaethje | Khabib Nurmagomedov | Lightweight (title) | L | SUB | Triangle Choke From Bottom Guard | 2 | 1:34 | 5 |
| 9 | 2021-11-06 | UFC 268: Usman vs. Covington 2 | Michael Chandler | Lightweight | W | U-DEC | 29-28, 29-28, 30-27 | 3 | 5:00 | 3 |
| 10 | 2022-05-07 | UFC 274: Oliveira vs. Gaethje | Charles Oliveira | Lightweight | L | SUB | Rear Naked Choke | 1 | 3:22 | 5 |
| 11 | 2023-03-18 | UFC 286: Edwards vs. Usman 3 | Rafael Fiziev | Lightweight | W | M-DEC | 29-28, 29-28, 28-28 | 3 | 5:00 | 3 |
| 12 | 2023-07-29 | UFC 291: Poirier vs. Gaethje 2 | Dustin Poirier | Lightweight | W | KO/TKO | Kick to Head At Distance | 2 | 1:00 | 5 |
| 13 | 2024-04-13 | UFC 300: Pereira vs. Hill | Max Holloway | Lightweight | L | KO/TKO | Punch to Head At Distance | 5 | 4:59 | 5 |
| 14 | 2025-03-08 | UFC 313: Pereira vs. Ankalaev | Rafael Fiziev | Lightweight | W | U-DEC | 29-28, 29-28, 29-28 | 3 | 5:00 | 3 |
| 15 | 2026-01-24 | UFC 324: Gaethje vs. Pimblett | Paddy Pimblett | Lightweight (title) | W | U-DEC | 48-47, 49-46, 49-46 | 5 | 5:00 | 5 |
| 16 | 2026-06-14 | UFC Freedom 250 | Ilia Topuria | Lightweight (title) | W | KO/TKO | toCorner Stoppage | 4 | 5:00 | 5 |

### Per-fight totals, both sides

| # | Opponent | Min | Sig for | Sig ag | Head for | Head ag | Body for | Body ag | Leg for | Leg ag | Dist for | Dist ag | Clinch for | Clinch ag | Ground for | Ground ag | KD for-ag | TD for | TD ag | Ctrl for | Ctrl ag | Sub for-ag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Michael Johnson | 9.80 | 104/174 | 91/200 | 62/124 | 47/146 | 6/8 | 40/48 | 36/42 | 4/6 | 77/138 | 78/176 | 27/36 | 12/21 | 0/0 | 1/3 | 0-0 | 0/0 | 1/3 | 0:06 | 0:34 | 0-0 |
| 2 | Eddie Alvarez | 13.98 | 122/237 | 155/356 | 69/180 | 113/299 | 16/17 | 36/49 | 37/40 | 6/8 | 106/218 | 128/325 | 15/16 | 24/28 | 1/3 | 3/3 | 0-1 | 0/1 | 1/2 | 0:06 | 0:20 | 0-0 |
| 3 | Dustin Poirier | 15.55 | 115/212 | 174/351 | 56/143 | 142/314 | 9/12 | 21/26 | 50/57 | 11/11 | 98/194 | 162/338 | 17/18 | 12/13 | 0/0 | 0/0 | 0-0 | 0/0 | 0/5 | 1:04 | 0:06 | 0-0 |
| 4 | James Vick | 1.45 | 7/15 | 10/20 | 3/8 | 3/9 | 2/3 | 5/8 | 2/4 | 2/3 | 6/14 | 10/20 | 0/0 | 0/0 | 1/1 | 0/0 | 1-0 | 0/0 | 0/0 | 0:04 | 0:00 | 0-0 |
| 5 | Edson Barboza | 2.50 | 20/35 | 13/32 | 13/28 | 6/21 | 2/2 | 3/5 | 5/5 | 4/6 | 12/22 | 11/30 | 8/13 | 2/2 | 0/0 | 0/0 | 1-0 | 0/0 | 0/0 | 0:44 | 0:00 | 0-0 |
| 6 | Donald Cerrone | 4.30 | 40/61 | 17/52 | 27/44 | 12/45 | 0/2 | 4/6 | 13/15 | 1/1 | 36/55 | 17/52 | 2/3 | 0/0 | 2/3 | 0/0 | 1-0 | 0/0 | 0/0 | 0:04 | 0:00 | 0-0 |
| 7 | Tony Ferguson | 23.65 | 143/197 | 136/296 | 100/153 | 64/212 | 13/14 | 36/43 | 30/30 | 36/41 | 143/197 | 136/296 | 0/0 | 0/0 | 0/0 | 0/0 | 0-0 | 0/0 | 0/0 | 0:00 | 0:00 | 0-0 |
| 8 | Khabib Nurmagomedov | 6.57 | 29/45 | 26/80 | 12/26 | 18/72 | 2/4 | 7/7 | 15/15 | 1/1 | 29/45 | 25/79 | 0/0 | 0/0 | 0/0 | 1/1 | 0-0 | 0/0 | 2/3 | 0:14 | 0:55 | 0-1 |
| 9 | Michael Chandler | 15.00 | 116/183 | 103/245 | 83/143 | 64/199 | 7/12 | 28/35 | 26/28 | 11/11 | 102/164 | 99/241 | 5/5 | 4/4 | 9/14 | 0/0 | 1-0 | 0/0 | 1/6 | 1:37 | 0:03 | 0-0 |
| 10 | Charles Oliveira | 3.37 | 21/33 | 30/47 | 13/22 | 18/32 | 3/3 | 11/13 | 5/8 | 1/2 | 15/26 | 20/34 | 6/7 | 8/10 | 0/0 | 2/3 | 1-1 | 0/0 | 0/1 | 0:13 | 0:39 | 0-2 |
| 11 | Rafael Fiziev | 15.00 | 103/171 | 97/169 | 81/142 | 38/100 | 14/15 | 52/61 | 8/14 | 7/8 | 84/147 | 81/151 | 19/24 | 16/18 | 0/0 | 0/0 | 0-0 | 1/3 | 0/0 | 0:05 | 0:00 | 0-0 |
| 12 | Dustin Poirier | 6.00 | 41/66 | 27/52 | 23/48 | 21/46 | 7/7 | 4/4 | 11/11 | 2/2 | 38/63 | 25/49 | 2/2 | 2/3 | 1/1 | 0/0 | 1-0 | 0/0 | 0/0 | 0:01 | 0:00 | 0-0 |
| 13 | Max Holloway | 24.98 | 103/199 | 181/309 | 44/121 | 62/149 | 26/42 | 62/91 | 33/36 | 57/69 | 103/199 | 181/308 | 0/0 | 0/1 | 0/0 | 0/0 | 0-1 | 0/0 | 0/0 | 0:00 | 0:00 | 0-0 |
| 14 | Rafael Fiziev | 15.00 | 72/134 | 68/119 | 56/117 | 20/61 | 9/9 | 43/52 | 7/8 | 5/6 | 41/92 | 49/100 | 26/34 | 14/14 | 5/8 | 5/5 | 1-0 | 0/3 | 2/2 | 1:32 | 0:40 | 0-0 |
| 15 | Paddy Pimblett | 25.00 | 144/254 | 156/311 | 120/222 | 83/221 | 15/21 | 48/63 | 9/11 | 25/27 | 102/198 | 140/284 | 20/27 | 16/27 | 22/29 | 0/0 | 2-0 | 3/3 | 0/5 | 5:55 | 0:48 | 0-0 |
| 16 | Ilia Topuria | 20.00 | 91/192 | 97/162 | 79/175 | 55/112 | 8/12 | 37/45 | 4/5 | 5/5 | 73/167 | 68/125 | 15/21 | 22/29 | 3/4 | 7/8 | 0-1 | 0/5 | 1/3 | 1:32 | 2:32 | 0-0 |

Fight-level checks against the HANDOFF's web-sourced claims:
- UFC Freedom 250: Topuria out-landed Gaethje 97-91 in sig. strikes and scored the only knockdown (round 2,
  when Topuria landed 44 to Gaethje's 12). That matches the HANDOFF (F4W). Gaethje landed 0 of 5 takedowns,
  and the result is filed as KO/TKO, "toCorner Stoppage", round 4 at 5:00.
- UFC 300: Holloway out-landed him 181-103, and 62-18 in round 5. Matches the HANDOFF.
- UFC 324: the HANDOFF line "out-landed 156-144" reads as if Gaethje out-landed Pimblett. In the data
  **Pimblett out-landed Gaethje 156-144 in sig. strikes**; Gaethje led total strikes 200-170 and had the 2
  knockdowns, 3 of 3 takedowns and 5:55 control. Cards 48-47, 49-46, 49-46 match. **Correction to the
  HANDOFF.**

## 5. Rates side by side (career, last 3 years, time-decayed, lightweight league)

| Rate | Alexander Volkanovski career | Alexander Volkanovski last 3y | Alexander Volkanovski decayed | Justin Gaethje career | Justin Gaethje last 3y | Justin Gaethje decayed | Lightweight league |
|---|---|---|---|---|---|---|---|
| Fights with stats | 19 | 4 | 19 | 16 | 4 | 16 | - |
| Minutes | 312.9 | 68.4 | 82.3 | 202.2 | 85.0 | 70.8 | - |
| Sig. landed / min (SLpM) | 5.98 | 5.25 | 5.47 | 6.29 | 4.82 | 5.37 | 4.32 |
| Sig. absorbed / min (SApM) | 3.33 | 3.04 | 3.28 | 6.83 | 5.91 | 5.91 | 4.32 |
| Sig. attempted / min | 10.51 | 9.29 | 9.62 | 10.92 | 9.17 | 9.80 | 9.01 |
| Opp. sig. attempted / min | 7.98 | 7.22 | 7.44 | 13.86 | 10.60 | 11.08 | 9.01 |
| Sig. accuracy | 56.90% | 56.45% | 56.90% | 57.56% | 52.63% | 54.83% | 47.97% |
| Opp. sig. accuracy vs him (1 - defense) | 41.79% | 42.11% | 44.06% | 49.30% | 55.72% | 53.37% | 47.97% |
| Strike differential / min | 2.65 | 2.21 | 2.20 | -0.54 | -1.08 | -0.54 | 0.00 |
| Head accuracy | 50.64% | 54.10% | 52.75% | 49.59% | 47.09% | 49.49% | 39.62% |
| Opp. head accuracy vs him | 33.25% | 34.14% | 35.08% | 37.59% | 40.52% | 39.57% | 39.62% |
| Distance accuracy | 53.78% | 54.67% | 54.47% | 54.93% | 48.63% | 51.23% | 44.27% |
| Opp. distance accuracy vs him | 39.18% | 39.83% | 41.16% | 47.16% | 53.61% | 50.84% | 44.27% |
| Head share of sig. attempts | 73.75% | 80.50% | 78.10% | 76.81% | 81.51% | 82.38% | 76.38% |
| Body share of sig. attempts | 8.67% | 7.23% | 7.38% | 8.29% | 10.78% | 9.01% | 15.09% |
| Leg share of sig. attempts | 17.58% | 12.26% | 14.52% | 14.90% | 7.70% | 8.61% | 8.53% |
| Distance share of sig. landed | 76.38% | 88.02% | 82.28% | 83.79% | 77.80% | 79.17% | 80.18% |
| Clinch share of sig. landed | 8.39% | 4.46% | 6.00% | 12.75% | 14.88% | 14.39% | 9.51% |
| Ground share of sig. landed | 15.23% | 7.52% | 11.72% | 3.46% | 7.32% | 6.44% | 10.31% |
| Leg kicks absorbed / min | 0.51 | 0.54 | 0.56 | 0.88 | 1.08 | 0.85 | 0.64 |
| Knockdowns / 15 | 0.29 | 0.00 | 0.13 | 0.67 | 0.53 | 0.64 | 0.39 |
| Knockdowns absorbed / 15 | 0.19 | 0.44 | 0.25 | 0.30 | 0.35 | 0.33 | 0.39 |
| KD per 100 sig. head landed (power) | 0.49 | 0.00 | 0.21 | 1.07 | 1.00 | 1.07 | 0.95 |
| KD absorbed per 100 sig. head absorbed (chin) | 0.63 | 1.57 | 0.87 | 0.52 | 0.91 | 0.75 | 0.95 |
| Takedowns attempted / 15 | 4.75 | 4.38 | 4.33 | 1.11 | 1.94 | 1.96 | 4.29 |
| Takedowns landed / 15 | 1.63 | 0.88 | 1.31 | 0.30 | 0.53 | 0.55 | 1.53 |
| Takedown accuracy | 34.34% | 20.00% | 30.20% | 26.67% | 27.27% | 27.86% | 35.61% |
| Opp. takedowns attempted / 15 | 2.49 | 2.63 | 2.97 | 2.23 | 1.77 | 2.06 | 4.29 |
| Takedown defense | 67.31% | 58.33% | 61.33% | 73.33% | 70.00% | 74.08% | 64.39% |
| Control seconds / 15 | 177 | 77 | 127 | 59 | 95 | 92 | 174 |
| Controlled seconds / 15 | 47 | 36 | 53 | 29 | 42 | 45 | 174 |
| Sub. attempts / 15 | 0.19 | 0.22 | 0.17 | 0.00 | 0.00 | 0.00 | 0.40 |
| Opp. sub. attempts / 15 | 0.14 | 0.00 | 0.09 | 0.22 | 0.00 | 0.12 | 0.40 |

Volkanovski's own table compares him with the featherweight league (2020-2026): SLpM 4.12, accuracy 47.3%,
head accuracy 38.9%, knockdowns per 100 head strikes landed 0.94, takedown attempts 4.06 per 15 at 38.3%,
control 169 s per 15. Full tables are in `data/derived/fighter_alexander-volkanovski.md` and
`data/derived/fighter_justin-gaethje.md`.

Against the v2 inputs: the career rates match the HANDOFF's ufcstats figures within rounding (Volk 5.98 /
3.33 / 56.9% / 0.29 KD per 15 / 1.63 takedowns per 15 at 34% / 67% takedown defense; Gaethje 6.29 / 6.83 /
57.6% / 0.67 / 0.30 at 27% / 73%). The target splits differ. v2 used landed shares of head 63 / body 11 / leg
26 (Volk) and 63 / 9 / 28 (Gaethje). This dataset gives landed shares of 65.6 / 10.2 / 24.2 and 66.2 / 10.9 /
22.9 career. Over the last 3 years they are 77.2 / 7.0 / 15.9 and 72.9 / 14.1 / 12.9: both men have moved
toward the head. Attempt shares, which v3 needs because it models attempts times accuracy, are head 78 / body 7
/ leg 15 (Volk, decayed) and 82 / 9 / 9 (Gaethje, decayed).

## 6. Chin, power and defense

### Volkanovski

| Window | KD absorbed | Sig. head absorbed | KD per 100 head absorbed | Shrunk (EB) | KD scored | Sig. head landed | KD per 100 head landed | Shrunk (EB) |
|---|---|---|---|---|---|---|---|---|
| career | 4.00 | 632.0 | 0.63 | 0.71 | 6.00 | 1228.0 | 0.49 | 0.56 |
| last4y | 3.00 | 189.0 | 1.59 | 1.24 | 1.00 | 362.0 | 0.28 | 0.54 |
| last3y | 2.00 | 127.0 | 1.57 | - | 0.00 | 277.0 | 0.00 | - |
| decayed | 1.39 | 159.2 | 0.87 | 0.91 | 0.70 | 326.1 | 0.21 | 0.52 |

Chin events (knockdowns absorbed plus KO/TKO losses with no knockdown recorded) per 100 sig. head strikes absorbed: career 4 in 632 = 0.63; last4y 3 in 189 = 1.59; last3y 2 in 127 = 1.57.

Fights with knockdowns: 2017-06-10 Mizuto Hirota 1-0 (W U-DEC); 2018-07-14 Darren Elkins 2-0 (W U-DEC); 2018-12-29 Chad Mendes 1-1 (W KO/TKO); 2022-04-09 Chan Sung Jung 1-0 (W KO/TKO); 2023-02-11 Islam Makhachev 1-0 (L U-DEC); 2023-10-21 Islam Makhachev 0-1 (L KO/TKO); 2024-02-17 Ilia Topuria 0-1 (L KO/TKO); 2025-04-12 Diego Lopes 0-1 (W U-DEC).

Finish losses: 2023-10-21 Islam Makhachev KO/TKO R1 3:06 (Kick to Head At Distance; KD absorbed 1); 2024-02-17 Ilia Topuria KO/TKO R2 3:32 (Punch to Head At Distance; KD absorbed 1).

Division baseline (Featherweight, 2020-10-31 to 2026-10-31): 0.94 KD per 100 sig. head strikes landed. Shrinkage: beta-binomial prior strength k fit by maximum likelihood over 923 fighters in the same sex group and window (at least 20 head strikes, each against his division's rate): chin k = 223.9 head strikes absorbed (95% [177.8, 281.8]; between-fighter sd 0.64 per 100; Featherweight-only fit 266.1); power k = 237.1 head strikes landed (95% [188.4, 316.2]; sd 0.62 per 100; division-only 251.2). Decayed counts are weighted.

### Gaethje

| Window | KD absorbed | Sig. head absorbed | KD per 100 head absorbed | Shrunk (EB) | KD scored | Sig. head landed | KD per 100 head landed | Shrunk (EB) |
|---|---|---|---|---|---|---|---|---|
| career | 4.00 | 766.0 | 0.52 | 0.62 | 9.00 | 841.0 | 1.07 | 1.04 |
| last4y | 2.00 | 279.0 | 0.72 | 0.82 | 4.00 | 403.0 | 0.99 | 0.98 |
| last3y | 2.00 | 220.0 | 0.91 | - | 3.00 | 299.0 | 1.00 | - |
| decayed | 1.55 | 206.4 | 0.75 | 0.85 | 3.02 | 282.9 | 1.07 | 1.02 |

Chin events (knockdowns absorbed plus KO/TKO losses with no knockdown recorded) per 100 sig. head strikes absorbed: career 5 in 766 = 0.65; last4y 2 in 279 = 0.72; last3y 2 in 220 = 0.91.
KO/TKO losses with no knockdown recorded: 2018-04-14 Dustin Poirier (R4, Punch to Head In Clinch).

Fights with knockdowns: 2017-12-02 Eddie Alvarez 0-1 (L KO/TKO); 2018-08-25 James Vick 1-0 (W KO/TKO); 2019-03-30 Edson Barboza 1-0 (W KO/TKO); 2019-09-14 Donald Cerrone 1-0 (W KO/TKO); 2021-11-06 Michael Chandler 1-0 (W U-DEC); 2022-05-07 Charles Oliveira 1-1 (L SUB); 2023-07-29 Dustin Poirier 1-0 (W KO/TKO); 2024-04-13 Max Holloway 0-1 (L KO/TKO); 2025-03-08 Rafael Fiziev 1-0 (W U-DEC); 2026-01-24 Paddy Pimblett 2-0 (W U-DEC); 2026-06-14 Ilia Topuria 0-1 (W KO/TKO).

Finish losses: 2017-12-02 Eddie Alvarez KO/TKO R3 3:59 (Knee to Head In Clinch; KD absorbed 1); 2018-04-14 Dustin Poirier KO/TKO R4 0:33 (Punch to Head In Clinch; KD absorbed 0); 2020-10-24 Khabib Nurmagomedov SUB R2 1:34 (Triangle Choke From Bottom Guard; KD absorbed 0); 2022-05-07 Charles Oliveira SUB R1 3:22 (Rear Naked Choke; KD absorbed 1); 2024-04-13 Max Holloway KO/TKO R5 4:59 (Punch to Head At Distance; KD absorbed 1).

Division baseline (Lightweight, 2020-10-31 to 2026-10-31): 0.95 KD per 100 sig. head strikes landed. Shrinkage: beta-binomial prior strength k fit by maximum likelihood over 923 fighters in the same sex group and window (at least 20 head strikes, each against his division's rate): chin k = 223.9 head strikes absorbed (95% [177.8, 281.8]; between-fighter sd 0.65 per 100; Lightweight-only fit 223.9); power k = 237.1 head strikes landed (95% [188.4, 316.2]; sd 0.63 per 100; division-only 446.7). Decayed counts are weighted.

Reading these:
- Fitted shrinkage strengths (beta-binomial, maximum likelihood over 923 men with at least 20 head strikes,
  Oct 2020 to Oct 2026, each against his division's rate): chin k = 224 head strikes absorbed (95% interval
  178-282), power k = 237 head strikes landed (188-316). v2 used 300 for power. The between-fighter sd of the
  true rate is about 0.65 per 100 at a league mean near 0.95, so chins genuinely vary about 2:1 across the
  middle of the league.
- The walk-forward predictive optimum is heavier: k = 500 head strikes with no time decay (section 11). For
  forecasting the next fight, use 500. The 224 describes career-level spread.
- Chin events, counting KO/TKO losses with no knockdown recorded: Gaethje adds Poirier 1 (round 4, punch
  in the clinch), giving 5 in 766 career (0.65 per 100). Volk has none to add.
- Defense: opponents' sig. accuracy against Volk is 41.8% career, 47.1% over the last 4 years, 44.1%
  decayed. Head-strike accuracy against him is 33.3% career and 35.1% decayed (league 38.9-39.6%). Against
  Gaethje: 49.3% career and 55.7% over the last 3 years, with head accuracy 37.6% and 40.5%. Gaethje's
  defense has worsened. Opponents landed at least 50% on him in each of his last seven fights (Oliveira
  64%, Fiziev 57%, Poirier 52%, Holloway 59%, Fiziev 57%, Pimblett 50%, Topuria 60%).

## 7. Pace curves (five-round fights)

### Volkanovski

**All five-round fights (rounds weighted by minutes fought)**

| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 12 | 58.1 | 4.41 | 1.00 | 8.35 | 52.78% | 3.22 | 45.61% | 2.39 | 1.41 | 0.224 |
| 2 | 11 | 53.4 | 5.48 | 1.24 | 10.24 | 53.56% | 3.86 | 45.88% | 3.41 | 1.61 | 0.243 |
| 3 | 9 | 44.3 | 7.11 | 1.61 | 12.52 | 56.76% | 3.75 | 40.59% | 4.92 | 1.56 | 0.226 |
| 4 | 8 | 35.8 | 6.38 | 1.45 | 10.97 | 58.16% | 3.97 | 45.22% | 4.50 | 1.51 | 0.168 |
| 5 | 7 | 35.0 | 7.20 | 1.63 | 11.89 | 60.58% | 3.63 | 36.60% | 5.51 | 1.11 | 0.429 |

**Only fights that reached round 5 (same fights in every row)**

| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 7 | 35.0 | 4.40 | 1.00 | 8.89 | 49.52% | 3.09 | 41.54% | 2.26 | 1.57 | 0.171 |
| 2 | 7 | 35.0 | 5.34 | 1.21 | 10.00 | 53.43% | 4.11 | 43.77% | 2.77 | 2.06 | 0.057 |
| 3 | 7 | 35.0 | 6.31 | 1.44 | 11.57 | 54.57% | 3.49 | 39.74% | 4.29 | 1.40 | 0.171 |
| 4 | 7 | 35.0 | 6.26 | 1.42 | 10.86 | 57.63% | 4.00 | 45.16% | 4.43 | 1.49 | 0.171 |
| 5 | 7 | 35.0 | 7.20 | 1.64 | 11.89 | 60.58% | 3.63 | 36.60% | 5.51 | 1.11 | 0.429 |

**Three-round fights, for comparison**

| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 7 | 35.0 | 4.86 | 1.00 | 9.11 | 53.29% | 2.11 | 40.88% | 2.94 | 1.29 | 0.457 |
| 2 | 7 | 31.3 | 7.48 | 1.54 | 12.34 | 60.62% | 2.72 | 36.32% | 4.95 | 1.44 | 0.416 |
| 3 | 4 | 20.0 | 6.15 | 1.27 | 9.40 | 65.43% | 2.80 | 36.84% | 3.85 | 1.60 | 0.650 |

**Featherweight league, five-round fights (2020-2026)**: landed/min vs R1 by round: R1 1.00, R2 1.31, R3 1.34, R4 1.55, R5 1.32

### Gaethje

**All five-round fights (rounds weighted by minutes fought)**

| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 12 | 51.6 | 6.30 | 1.00 | 10.91 | 57.73% | 6.70 | 47.59% | 3.72 | 2.01 | 0.058 |
| 2 | 8 | 32.4 | 6.58 | 1.05 | 10.88 | 60.51% | 7.26 | 52.22% | 4.48 | 1.51 | 0.093 |
| 3 | 5 | 25.0 | 4.76 | 0.76 | 8.68 | 54.84% | 5.56 | 48.26% | 2.72 | 1.20 | 0.000 |
| 4 | 5 | 20.6 | 5.84 | 0.93 | 10.27 | 56.87% | 6.86 | 57.55% | 4.04 | 0.92 | 0.097 |
| 5 | 3 | 13.6 | 5.94 | 0.94 | 10.27 | 57.86% | 7.11 | 48.02% | 4.69 | 0.81 | 0.000 |

**Only fights that reached round 5 (same fights in every row)**

| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 3 | 15.0 | 4.33 | 1.00 | 7.20 | 60.19% | 6.07 | 57.59% | 2.80 | 0.93 | 0.000 |
| 2 | 3 | 15.0 | 5.80 | 1.34 | 8.40 | 69.05% | 5.67 | 51.83% | 4.00 | 1.20 | 0.133 |
| 3 | 3 | 15.0 | 4.27 | 0.98 | 8.40 | 50.79% | 6.27 | 47.00% | 2.33 | 0.93 | 0.000 |
| 4 | 3 | 15.0 | 6.20 | 1.43 | 10.00 | 62.00% | 7.07 | 55.21% | 4.20 | 1.00 | 0.067 |
| 5 | 3 | 13.6 | 5.94 | 1.37 | 10.27 | 57.86% | 7.11 | 48.02% | 4.69 | 0.81 | 0.000 |

**Three-round fights, for comparison**

| Round | Fights | Minutes | Sig. landed/min | vs R1 | Sig. att/min | Acc. | Absorbed/min | Opp. acc. | Head l/min | Leg l/min | TD att/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 4 | 20.0 | 5.70 | 1.00 | 11.15 | 51.12% | 6.95 | 45.72% | 3.35 | 1.70 | 0.100 |
| 2 | 4 | 20.0 | 6.85 | 1.20 | 12.70 | 53.94% | 7.30 | 46.79% | 4.90 | 0.95 | 0.050 |
| 3 | 4 | 19.0 | 8.53 | 1.50 | 13.06 | 65.32% | 7.27 | 50.55% | 6.53 | 1.32 | 0.211 |

**Lightweight league, five-round fights (2020-2026)**: landed/min vs R1 by round: R1 1.00, R2 1.20, R3 1.08, R4 1.10, R5 1.31

Engine use. Divide each fighter's curve by his division's league curve to get a personal cardio ratio, then
shrink it (`pace_ratio` and `pace_w` in the profile JSON hold landed per minute relative to round 1, with minutes
as weights). Volk's late-round rise is real and large. His fifth-round accuracy (60.6%) is his best, and
opponents' accuracy against him drops to 36.6%. Gaethje's curve rests on three fights (Ferguson, Holloway,
Pimblett), so it should shrink hard toward the lightweight curve. The "all five-round fights" rows mix
compositions (early finishes drop out of later rounds); prefer the "reached round 5" rows.

## 8. Volkanovski at lightweight vs featherweight

| Division | Fights | Record | Dates | Min | SLpM | SApM | Acc. | Opp. acc. | KD/15 | KD abs/15 | Chin /100 | TD att/15 | TD acc. | TD def. | Ctrl s/15 | Ctrled s/15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Catch Weight | 1 | 1-0-0 | 2017-11-18 to 2017-11-18 | 15.0 | 4.53 | 1.20 | 59.65% | 22.22% | 0.00 | 0.00 | 0.00 | 14.00 | 35.71% | 0.00% | 501 | 16 |
| Featherweight | 15 | 14-1-0 | 2017-06-10 to 2026-10-24 | 262.7 | 6.39 | 3.58 | 56.93% | 41.21% | 0.29 | 0.17 | 0.53 | 4.45 | 33.33% | 71.79% | 155 | 23 |
| Lightweight | 3 | 1-2-0 | 2016-11-26 to 2023-10-21 | 35.2 | 3.52 | 2.41 | 55.11% | 63.43% | 0.43 | 0.43 | 1.96 | 2.98 | 42.86% | 58.33% | 208 | 245 |

- Lightweight in the data means three fights: Kasuya (Nov 2016, his UFC debut) and Makhachev twice (Feb
  and Oct 2023). Without Kasuya it is a two-fight Makhachev sample, so it measures "Volk vs the best
  lightweight grappler of the era", not "Volk at 155".
- In those two Makhachev fights, Volk landed 74 sig. strikes and absorbed 81 in 28.1 minutes. Makhachev's
  accuracy against him was 65% (81 of 124), against 41% for his featherweight opponents. He was controlled for 7:56 (7:37 in the first fight)
  and absorbed 4 of 10 takedowns. In the first fight he out-landed Makhachev 70-57 and scored the only
  knockdown, but lost a unanimous decision (47-48, 47-48, 46-49).
- Opponent-adjusted over all three lightweight fights, he landed 1.97x what those opponents usually absorb
  (1.55x at featherweight),
  but their accuracy against him was 1.15x their norm (0.90x at featherweight). The useful signal for v3 is
  the defensive one, with low confidence (n = 2). The size term in `ENGINE_V3_SPEC.md`
  (`c_size * (lbs_fight - lbs_home) / 10` on chin and power) should come from a league-wide fit of fighters
  changing divisions, not from these fights.

## 9. Common opponents and links

#### Ilia Topuria

| Fighter | Date | Result | Method | Rd | Time | Sig for | Sig ag | SLpM | SApM | Acc. | Opp. acc. | Head for | Head ag | KD for-ag | TD for | TD ag | Ctrl for | Ctrl ag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Alexander Volkanovski | 2024-02-17 | L | KO/TKO | 2 | 3:32 | 47/107 | 35/77 | 5.51 | 4.10 | 43.90% | 45.50% | 21/68 | 17/53 | 0-1 | 0/0 | 0/0 | 0:00 | 0:03 |
| Justin Gaethje | 2026-06-14 | W | KO/TKO | 4 | 5:00 | 91/192 | 97/162 | 4.55 | 4.85 | 47.40% | 59.90% | 79/175 | 55/112 | 0-1 | 0/5 | 1/3 | 1:32 | 2:32 |

Pooled vs Ilia Topuria: Alexander Volkanovski 8.5 min, SLpM 5.51, SApM 4.10, KD 0-1; Justin Gaethje 20.0 min, SLpM 4.55, SApM 4.85, KD 0-1.

#### Max Holloway

| Fighter | Date | Result | Method | Rd | Time | Sig for | Sig ag | SLpM | SApM | Acc. | Opp. acc. | Head for | Head ag | KD for-ag | TD for | TD ag | Ctrl for | Ctrl ag |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Alexander Volkanovski | 2019-12-14 | W | U-DEC | 5 | 5:00 | 157/303 | 134/303 | 6.28 | 5.36 | 51.80% | 44.20% | 67/178 | 85/233 | 0-0 | 0/4 | 0/0 | 0:44 | 0:02 |
| Alexander Volkanovski | 2020-07-11 | W | S-DEC | 5 | 5:00 | 137/272 | 102/268 | 5.48 | 4.08 | 50.40% | 38.10% | 64/161 | 44/167 | 0-0 | 3/9 | 0/0 | 1:26 | 0:00 |
| Alexander Volkanovski | 2022-07-02 | W | U-DEC | 5 | 5:00 | 199/372 | 127/301 | 7.96 | 5.08 | 53.50% | 42.20% | 152/316 | 64/213 | 0-0 | 0/0 | 0/3 | 1:57 | 0:16 |
| Justin Gaethje | 2024-04-13 | L | KO/TKO | 5 | 4:59 | 103/199 | 181/309 | 4.12 | 7.24 | 51.80% | 58.60% | 44/121 | 62/149 | 0-1 | 0/0 | 0/0 | 0:00 | 0:00 |

Pooled vs Max Holloway: Alexander Volkanovski 75.0 min, SLpM 6.57, SApM 4.84, KD 0-0; Justin Gaethje 25.0 min, SLpM 4.12, SApM 7.24, KD 0-1.

Makhachev is not a common opponent: Gaethje has never fought him. Links through him and others are below.

Alexander Volkanovski fought X, X fought Y, Y fought Justin Gaethje. Results are from the first-named fighter's side in each column.

| X | Alexander Volkanovski vs X | X vs Y | Y | Y vs Justin Gaethje |
|---|---|---|---|---|
| Brian Ortega | W U-DEC R5 (2021) | L KO/TKO R4 (2018) | Max Holloway | W KO/TKO R5 (2024) |
| Max Holloway | W U-DEC R5 (2019); W S-DEC R5 (2020); W U-DEC R5 (2022) | L U-DEC R5 (2019) | Dustin Poirier | W KO/TKO R4 (2018); L KO/TKO R2 (2023) |
| Yair Rodriguez | W KO/TKO R3 (2023) | L U-DEC R5 (2021) | Max Holloway | W KO/TKO R5 (2024) |
| Islam Makhachev | L U-DEC R5 (2023); L KO/TKO R1 (2023) | W SUB R2 (2022) | Charles Oliveira | W SUB R1 (2022) |
| Chan Sung Jung | W KO/TKO R4 (2022) | L KO/TKO R3 (2023) | Max Holloway | W KO/TKO R5 (2024) |
| Islam Makhachev | L U-DEC R5 (2023); L KO/TKO R1 (2023) | W SUB R5 (2024) | Dustin Poirier | W KO/TKO R4 (2018); L KO/TKO R2 (2023) |
| Ilia Topuria | L KO/TKO R2 (2024) | W KO/TKO R3 (2024) | Max Holloway | W KO/TKO R5 (2024) |
| Max Holloway | W U-DEC R5 (2019); W S-DEC R5 (2020); W U-DEC R5 (2022) | L KO/TKO R3 (2024) | Ilia Topuria | L KO/TKO R4 (2026) |
| Ilia Topuria | L KO/TKO R2 (2024) | W KO/TKO R1 (2025) | Charles Oliveira | W SUB R1 (2022) |
| Max Holloway | W U-DEC R5 (2019); W S-DEC R5 (2020); W U-DEC R5 (2022) | W U-DEC R5 (2025) | Dustin Poirier | W KO/TKO R4 (2018); L KO/TKO R2 (2023) |
| Max Holloway | W U-DEC R5 (2019); W S-DEC R5 (2020); W U-DEC R5 (2022) | L U-DEC R5 (2026) | Charles Oliveira | W SUB R1 (2022) |

Takeaways. Volk handled Holloway three times at featherweight (6.57 landed and 4.84 absorbed per minute
over 75 minutes, no knockdowns either way). Gaethje lost to Holloway at lightweight, absorbing 7.24 a minute
and a last-second knockdown. Topuria knocked out Volk in 8.5 minutes and knocked down Gaethje, but Gaethje
won on the stool after round 4. Common-opponent evidence favors Volk on volume and defense, and neither man
showed a chin edge against Topuria.

## 10. Head-to-head projection (lightweight, five rounds)

Each fighter's rate is first shrunk toward the projection division with the pseudo-exposure k that tools/fit_combine.py tuned walk-forward, using the time-decay half-life that won for that rate (sig_att_pm k=40, half-life 1460, sig_lnd_pm k=40, half-life 730, sig_acc k=300, half-life 730, td_att_pm k=30, half-life 1460, td_acc k=50, half-life none, kd_per_head k=500, half-life none). Per-minute rates then combine log-linearly: league x (attacker / league) x (defender allows / league); accuracies combine by log5 on odds against the division. 'Fitted' rows use the regression exponents (sig_att_pm a=1.0281, b=0.8896, sig_lnd_pm a=1.0965, b=0.9845, sig_acc a=1.0921, b=0.7992, td_att_pm a=1.2811, b=0.6077, td_acc a=0.6397, b=1.2853, kd_per_head a=1.1246, b=0.9124). Out of sample (2024 onward) the pure rule beat the fitted exponents for strikes, accuracy and knockdowns, and the fitted rule won for takedowns, so those are the recommended rows. Expected totals ignore finishes, damage and fatigue.

| Projected rate | Alexander Volkanovski on Justin Gaethje | Justin Gaethje on Alexander Volkanovski |
|---|---|---|
| Attacker sig. attempts / min, shrunk | 9.86 | 9.84 |
| Defender sig. attempts allowed / min, shrunk | 11.26 | 8.03 |
| Sig. attempted / min (log-linear) | 12.31 | 8.77 |
| Sig. attempted / min (fitted exponents) | 12.50 | 9.24 |
| Attacker accuracy, shrunk | 54.44% | 52.76% |
| Defender accuracy allowed, shrunk | 51.88% | 45.35% |
| Sig. accuracy (log5) | 58.29% | 50.13% |
| Sig. accuracy (fitted) | 58.77% | 51.79% |
| Sig. landed / min = att x acc | 7.18 | 4.40 |
| Sig. landed / min (log-linear on landed) | 6.30 | 4.18 |
| Sig. landed / min (fitted) | 6.66 | 4.44 |
| Sig. landed / min (v2 average, raw) | 6.41 | 4.81 |
| Head share of attempts | 75.78% | 79.76% |
| Head accuracy (log5) | 48.43% | 43.24% |
| Body share of attempts | 8.11% | 8.90% |
| Body accuracy (log5) | 72.62% | 70.39% |
| Leg share of attempts | 16.11% | 11.33% |
| Leg accuracy (log5) | 81.77% | 81.69% |
| Head strikes landed / min | 4.52 | 3.02 |
| Attacker power, KD per 100 head landed (shrunk) | 0.62 | 1.03 |
| Defender chin, KD per 100 head absorbed (shrunk) | 0.69 | 0.77 |
| KD per 100 head landed (power x chin) | 0.45 | 0.83 |
| Same, with the EB (career-dispersion) k | 0.37 | 0.79 |
| Naive KD per 25 min | 0.51 | 0.63 |
| Takedown attempts / 15 (fitted) | 2.96 | 1.30 |
| Takedown attempts / 15 (log-linear) | 2.62 | 1.47 |
| Takedown accuracy (fitted) | 30.05% | 31.61% |
| Takedown accuracy (log5) | 31.46% | 32.10% |
| Takedowns landed / 15 | 0.89 | 0.41 |
| Control s per TD (own history) | 109 | 199 |
| Sub. attempts / 15 | 0.15 | 0.04 |
| Expected sig. landed over the full distance | 179 | 110 |
| Expected head strikes landed, full distance | 113 | 76 |
| Expected takedowns landed, full distance | 1.48 | 0.68 |

Sensitivity to the rate window (same formula; `--window career | last3y | decayed`):

| Window | Volk sig. landed/min on Gaethje (att x acc) | Gaethje on Volk | Volk KD per 100 head landed | Gaethje KD per 100 head landed | Volk naive KD / 25 min | Gaethje naive KD / 25 min | Volk TD landed / 15 | Gaethje TD landed / 15 |
|---|---|---|---|---|---|---|---|---|
| tuned (default) | 7.18 | 4.40 | 0.45 | 0.83 | 0.51 | 0.63 | 0.89 | 0.41 |
| career | 8.59 | 4.85 | 0.45 | 0.83 | 0.59 | 0.64 | 0.96 | 0.25 |
| last 3 years | 6.12 | 3.80 | 0.60 | 1.10 | 0.62 | 0.74 | 0.87 | 0.59 |
| decayed, half-life 2 years | 6.30 | 4.21 | 0.62 | 0.97 | 0.63 | 0.73 | 0.96 | 0.64 |

Shade the strike rows down about 5% for the 2024-2026 bias (observed / predicted 0.95). These are rates
before damage, fatigue, position and finishes, which are the engine's job.

## 11. How rates combine: walk-forward fit (engine parameters)

Setup (`tools/fit_combine.py`). Every UFC fight from 2012 on with round stats where both men had at least
15 earlier UFC minutes. Each man's rates come from earlier fights only, shrunk toward his division with
pseudo-exposure k. Models: count rates are Poisson with exposure (minutes, or landed head strikes for
knockdowns), `log E[y/exp] = log L + c + a log(x/L) + b log(y_allowed/L)`; probabilities are binomial logit
on the same form. The shrinkage k and the time-decay half-life (none, 1460, 730 or 365 days) are tuned on
2012-2023 by the pure rule's deviance. The exponents (a, b, c) are fit on 2012-2023. Everything is scored on
2024-01-01 to 2026-10-31.

| Rate | Tuned k | Half-life | a | b | c | Test deviance: pure / fitted / v2 average / league only | Observed / predicted (pure) | High-high pairs: observed / pure / average |
|---|---|---|---|---|---|---|---|---|
| Sig. attempts per minute | 40 min | 1460 d | 1.03 | 0.89 | +0.04 | **42,812** / 43,962 / 46,881 / 57,530 | 0.948 | 5,583 / 5,864 / 4,188 |
| Sig. landed per minute | 40 min | 730 d | 1.10 | 0.98 | +0.04 | **24,026** / 24,702 / 26,128 / 31,158 | 0.954 | 2,765 / 2,951 / 2,102 |
| Sig. accuracy | 300 att. | 730 d | 1.09 | 0.80 | +0.03 | **7,926** / 7,994 / 8,410 / 9,892 | 0.999 | - |
| Takedown attempts per minute | 30 min | 1460 d | 1.28 | 0.61 | -0.09 | 5,318 / **5,076** / 5,905 / 7,634 | 1.009 | 794 / 862 / 524 |
| Takedown accuracy | 50 att. | none | 0.64 | 1.29 | -0.04 | 2,432 / **2,418** / 2,457 / 2,535 | 0.985 | - |
| KD per landed head strike | 500 head | none | 1.12 | 0.91 | -0.04 | **1,496.6** / 1,497.0 / 1,526 / 1,593 | 0.958 | 14 / 12.0 / 7.9 |

(6,976 training and 2,048 test fighter-fights. "High-high" = attacker and defender both at least 1.25x the
league rate.)

What this means for v3:
- Use the pure log-linear rule for strike attempts, landed strikes and knockdowns, and log5 for accuracy,
  after shrinking each rate with the tuned k. `ENGINE_V3_SPEC.md` already specifies this; these numbers
  support it.
- For takedowns, use the fitted exponents. The attacker's takedown rate matters more than what the defender
  usually allows (a = 1.28, b = 0.61). For takedown success the defender's defense matters about twice as
  much as the attacker's accuracy (a = 0.64, b = 1.29).
- Accuracy needs heavy shrinkage (300 attempts at a 2-year half-life, 800 undecayed). Per-minute volumes
  need about 40 minutes. Takedown accuracy needs 50 attempts. Knockdown rates need 500 head strikes.
- A 2-4 year half-life helps strike rates a little (pure-rule test deviance 42,812 at 1460 days vs 43,388
  undecayed for attempts; 24,026 at 730 days vs 24,241 for landed strikes). For knockdowns and takedown
  accuracy no decay (or 4 years) is as good. The spec's single 730-day half-life is a reasonable default;
  the per-rate half-lives above are better.
- On high-pace pairs (relevant because Gaethje's opponents attempt 11-14 strikes a minute), the pure rule
  over-predicts by about 5-7% and the v2 average under-predicts by about 25-30%.

## 12. Audit of v2 inputs against the data

| v2 setting | v2 value | Data says | Suggested v3 treatment |
|---|---|---|---|
| Landing rate | average of SLpM and SApM x 0.85 | Average under-predicts high-pace pairs ~25-30%; pure rule best out of sample, 5% high in 2024-26 | Pure log-linear, global scale ~0.95 in calibration |
| KD prior | 0.009 per landed head strike, worth 300 | LW 0.0095, FW 0.0094; EB k 224-237, predictive k 500 | p0 = division rate, k = 500 for forecasting |
| Volk chin knob (multiplies his KD risk; >1 = more KD-prone; Gaethje 1.0) | 1.15 | Volk/Gaethje shrunk chin ratio: career 1.15x, decayed 1.07x, last 4 years 1.51x. Volk vs FW league: last 4y 1.32x, decayed 0.97x | Data sets both chins; age term and a recent window carry the decline |
| Volk power knob | 0.85 | Shrunk 0.52-0.56 vs 0.94 = 0.55-0.6x league per head strike | Data-driven power; GnP finishing separate |
| Gaethje power | career KD 0.67 per 15 | 1.07 KD per 100 head landed (1.07x league) | Data-driven |
| Volk pace | [0.94, 0.98, 1.00, 1.04, 1.10] | Reached-R5 fights: 1.00, 1.21, 1.44, 1.42, 1.64 vs R1; FW league 1.00, 1.31, 1.34, 1.55, 1.32 | Personal ratio vs league curve, shrunk |
| Gaethje pace | [1.05, 1.00, 0.98, 0.97, 0.93] (fade) | 1.00, 1.34, 0.98, 1.43, 1.37 (n = 3); LW league 1.00, 1.20, 1.08, 1.10, 1.31 | Shrink hard to league; no fade evidence |
| Targets (landed shares) | Volk 63/11/26, Gaethje 63/9/28 | Decayed attempt shares Volk 78/7/15, Gaethje 82/9/9 | Attempts x accuracy per target from data |
| gaeLeg knob | 0.18 (preset 0.32) | Leg share of attempts 7.7% last 3y, 0.25-0.53 leg attempts/min in last 3 fights | Default to data, keep the knob |
| volkTd / gaeTd | 3.0 / 1.5 attempts per 15 | Projected 2.96 / 1.30 with the fitted takedown model | Data-driven |
| HANDOFF UFC 324 line | "out-landed 156-144" | Pimblett out-landed Gaethje 156-144 (sig.); Gaethje led total 200-170 | Fix the copy |

## 13. Open questions

- The size term for a featherweight at 155 can't be learned from Volk's two Makhachev fights. It needs a
  league-wide fit of fighters who move up a division (change in KD absorbed per head strike, opponents'
  accuracy, control absorbed).
- The age effect in section 1 is cross-sectional. A within-fighter fit (fighter fixed effects) would separate
  aging from selection.
- Knockdowns per head strike treat all head strikes alike. Distance head strikes vs clinch and ground head
  strikes, or a power-shot proxy, may separate Volk's jab volume from real power.
- No web verification was possible this session (search budget exhausted; ufcstats.com and f4wonline.com
  unreachable). If ufcstats.com is allowed in the environment's network settings, re-check UFC 333 and UFC
  Freedom 250 directly.
- Fight-week facts (booking status, injuries, Gaethje's post-Topuria medical suspension) are outside this
  dataset. The HANDOFF says the fight wasn't booked as of Nov 6, 2026; unknown whether that has changed.

## Sources

- Dataset: github.com/Greco1899/scrape_ufc_stats snapshot in `data/raw/` (ufcstats.com), events through
  Oct 31, 2026. All per-fight, rate, pace, chin, power, age and fit numbers.
- Derived files: `data/derived/fighter_alexander-volkanovski.{json,md}`,
  `data/derived/fighter_justin-gaethje.{json,md}`,
  `data/derived/matchup_alexander-volkanovski__justin-gaethje.{json,md}`, `data/derived/combine_fit.json`.
- Cross-referenced, not re-fetched this session (cited in HANDOFF.md):
  https://www.f4wonline.com/news/ufc/justin-gaethje-ilia-topuria-ufc-freedom-250-stats-numbers/ (Freedom 250
  totals; the dataset agrees), https://www.ufcalendar.com/events/ufc-324-2026-01-24/justin-gaethje-vs-paddy-pimblett
  (UFC 324), https://www.cbssports.com/ufc/fighter/50037035/alexander-volkanovski/ and
  https://www.cbssports.com/ufc/fighter/50037034/justin-gaethje/ (pro records 29-4 and 28-5),
  https://combat-edge.com/news/ufc-333-volkanovski-vs-evloev-results/ (UFC 333; the dataset agrees: TKO R2 4:54).
