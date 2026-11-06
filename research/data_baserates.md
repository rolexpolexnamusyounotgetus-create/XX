# League base rates and calibration targets (ufcstats snapshot, 2015-2026)

Prepared Friday, November 6, 2026 for the v3 engine. Every number below is computed from the ufcstats snapshot in `data/raw/` (scraped by github.com/Greco1899/scrape_ufc_stats from ufcstats.com, data through 2026-10-31) by `tools/baserates.py`; machine-readable output is `data/derived/baserates.json` and every table (including ones trimmed here) is regenerated in `data/derived/baserates_tables.md`. Window: UFC bouts on or after 2015-01-01 (5,928 fights, 5,927 with clean round-by-round stats). Rates are per fighter unless a table says otherwise.

Rerun: `python3 tools/baserates.py` (about 20 seconds). Options: `--since 2018-01-01`, `--group "bw=division:Bantamweight"` (any extra group; the `divisions` block already covers every division), `--holdout-from 2023-01-01`, `--out`, `--md`, `--quiet`.

Confidence legend: **high** = direct count from the dataset with a large sample; **medium** = computed from the dataset but needs an assumption (stated) or a small sample; **low** = estimate built on a modeling assumption that could be off by a lot.

## The numbers the engine should hit (summary)

1. **Method split, all UFC 2015+ (high):** KO/TKO 32.2%, submission 17.5%, unanimous 37.9%, split 9.6%, majority 0.7%, draw 0.8%, NC 1.0%. Lightweight finishes more (52.7% vs 50.3%); 5-round bouts finish 58.5%, with KO/TKO 42.5%.
2. **5-round finish hazard (high, n = 571):** conditional on reaching the round, R1 20.8%, R2 20.4%, R3 17.2%, R4 10.8%, R5 10.9%; 41.5% go 25 minutes. Title fights go the distance more often (46.7%); LW+FW 5-rounders less (33.6%, n = 122, medium). Hazard drops by about half after round 3.
3. **Strikes (high):** 57.4 significant strikes landed and 125.2 attempted per 15 minutes per fighter (3.83 / 8.35 per minute), 45.9% accuracy. Accuracy by target: head 37.5%, body 69.1%, leg 81.1%; by position: distance 41.6%, clinch 71.7%, ground 71.8%.
4. **Knockdowns (medium):** 0.95 per 100 landed standing head strikes (bounds 0.91-0.99); lightweight 0.98, title fights 0.70, 5-round fights 0.78. Per 100 landed sig strikes of any kind: 0.52. v2's prior of 0.009 per landed head strike sits between the all-position head rate (0.83 per 100) and the standing bounds.
5. **Knockdown to finish (high):** a fighter-round with a knockdown ends in a finish by that fighter in the same round 61.8% of the time (63.4% at lightweight; 71.2% after two or more knockdowns); the scorer wins the fight 85.4%. 91.0% of distance KO/TKOs and 31.3% of ground KO/TKOs show a winner knockdown in the final round, so the engine should route nearly every standing stoppage through a knockdown event.
6. **Grappling (high for counts, medium for time):** 3.86 takedown attempts and 1.40 landed per 15 (36.3%); 171 control seconds per fighter per 15; raw control per landed takedown 122 s, but a round-level fit attributes only 55 s of control directly to each takedown. Submission attempts 0.40 per 15; 29.6% of attempts end the fight.
7. **Position time (low):** control covers 37.9% of fight time (both fighters). Splitting it, ground is about 29%-33%, clinch control 5%-9%, and distance or neutral clinch 62%. 5-round fights: control 31%.
8. **Pace in 5-round fights (high):** in the 237 5-round fights that went 25 minutes, attempts per minute rise from 7.27 in round 1 to 9.15 in round 5 (x1.26); head strikes landed per minute go from 1.69 to 2.91 while leg strikes fall from 0.79 to 0.51. Knockdowns per 100 standing head strikes fall from 0.43 to 0.20 (this sample has no finishes by construction, so read the level with care). No league-wide fade: tiring has to be fighter-specific.
9. **Round-to-round noise (high):** sig strikes landed per fighter-round: mean 18.5, sd 12.4, variance/mean 8.3 (negative binomial k about 2.6); opponents' outputs in the same round correlate 0.43; a fighter's output correlates 0.58 from one round to the next. Plain Poisson draws are far too tight; the engine needs shared pace and form noise.
10. **Fight-to-fight spread (medium):** after removing fighter and opponent effects, a fighter's log sig-strike output varies 0.45 sd between fights; removing within-fight sampling leaves at most 0.36. v2's output form sd of 0.10 is likely too tight, but this bound still includes style-matchup effects.
11. **Judging (high):** 2,871 decisions: unanimous 78.6%, split 19.9%, majority 1.6% (non-draw); draws 1.6% of decisions. Implied 10-8 rounds (or point deductions) 4.7% of decision rounds, down to about 2.5% in 2024-2025. Judge pairs disagree on at least 13.1% of rounds.
12. **Round-winner weights (medium):** the EM fit on 7,495 judges' cards gives, per landed strike differential, head 0.179, body 0.133, leg 0.105 logits; knockdown 2.42, takedown 0.286, control 0.460 per minute, submission attempt 0.847. In head-strike units: body 0.74, leg 0.59, knockdown 13.5, takedown 1.6, a minute of control 2.6, submission attempt 4.7. Out of sample (decisions from 2023 on) it picks the decision winner 84.1% of the time vs 79.1% for "more sig strikes landed" (Brier 0.110).
13. **Stoppages between rounds (high count, small n):** doctor stoppages 0.76 per 100 fights, corner stoppages 0.13, injury stoppages 0.44; in 5-round fights 1.55, 0.52 and 2.42.

## Data, definitions and checks

- **Source.** ufcstats.com via github.com/Greco1899/scrape_ufc_stats, snapshot in `data/raw/` (see /home/user/XX/data/raw). Fight results, per-round per-fighter stats and event dates are joined on the stripped EVENT and BOUT strings. (high)
- **Cleaning notes** (all handled in the script, all listed in `meta.notes`): 25 fights appear twice under two event names (same fight URL); kept the copy whose event has a date, dropped the copies under ['UFC Fight Night: Grasso vs. Shevchenko 2', 'UFC Fight Night: Lopes vs. Silva']; 1 event(s) missing from ufc_event_details.csv; dates imputed from the neighbouring event in results order: ['UFC - Road to UFC 4.6']; dropped 2 rows with duplicate (EVENT, BOUT): ['Kazushi Sakuraba vs. Marcus Silveira']; 1 fights excluded from stats-based measures (round rows missing, unparsed numbers, unmatched names or non-5-minute rounds). The duplicated events would otherwise have double-counted 25 fights and broken the stats join (four stat rows per round). (high)
- **Judges' scores are written loser-first.** In DETAILS every unanimous decision since 2015 reads low-high (6,655 of 6,657 cards since 2015; the two exceptions are a 28-28 card in Cummins vs Blachowicz, UFC 210, and a 29-28 dissent in Trinaldo vs Parke, Fight Night Condit vs Alves, both apparently mislabeled as unanimous), and in split decisions exactly one card in three (561 of 1,683) reads high-low, whatever order the BOUT string lists the fighters. So `a - b` in DETAILS is (fight loser's score) - (fight winner's score). The script relies on this. (high)
- **Spot check against public reporting.** Topuria vs Gaethje (UFC Freedom 250): Topuria 97 sig landed, Gaethje 91, one Topuria knockdown, recorded as KO/TKO round 4, 5:00, "Corner Stoppage" with Gaethje the winner, matching HANDOFF.md. Gaethje vs Holloway (UFC 300): Holloway 181, Gaethje 103, matching. Gaethje vs Pimblett (UFC 324): Gaethje 2 knockdowns, 3 of 3 takedowns, 5:55 control, but **Pimblett out-landed Gaethje 156-144** in this data; HANDOFF.md says Gaethje out-landed him 156-144, which looks like a transposition to fix. (high, dataset)
- **Fight time** = (ROUND - 1) x 300 + TIME for formats with all-5-minute rounds; 2015+ is almost entirely "3 Rnd (5-5-5)" and "5 Rnd (5-5-5-5-5)", plus 37 TUF overtime bouts. Per-15 rates divide by fighter-time (each round counted once per fighter). (high)
- **Method buckets.** KO/TKO includes "TKO - Doctor's Stoppage" and corner stoppages (ufcstats writes these as KO/TKO with DETAILS "toCorner Stoppage"); NC = Overturned and Could Not Continue; DQ separate; draws come from OUTCOME D/D. Finish rate excludes NC, DQ and other. (high)
- **Control time.** ufcstats does not publish a definition in the files. Secondary sources describe FightMetric/ufcstats control as ground top or back position plus pinning the opponent on the fence in the clinch (Bloody Elbow glossary and analysis via search results; UFCalendar notes clinch control varies by stat-keeper: https://www.ufcalendar.com/glossary/control-time ; AgentMMA: https://agentmma.com/mma-lab/ufc-control-time-explained ; Bloody Elbow 2015 analysis: https://bloodyelbow.com/2015/06/30/mma-be-analytics-ufc-octagon-cage-size-finishes-knockouts-submissions-decisions ). So CTRL is treated as an upper bound on ground time. (medium)
- **Significant strikes.** All distance strikes count; in the clinch and on the ground only power strikes count (https://www.ufcalendar.com/glossary/significant-strike). Head/body/leg and distance/clinch/ground are two separate tallies of the same strikes; ufcstats does not give their cross-tab. (medium: secondary source)
- **Group definitions:** `all`: every UFC bout on or after --since; `lightweight`: WEIGHTCLASS names Lightweight (non-title, title, interim, TUF finals); `featherweight`: WEIGHTCLASS names Featherweight, men only; `five_round`: TIME FORMAT starts with '5 Rnd'; `title`: WEIGHTCLASS matches 'UFC ... Title Bout' (undisputed and interim, men and women; TUF / Road to UFC tournament finals excluded); `lw_fw_five_round`: lightweight or featherweight, 5-round.

## 1. Method split

| Group | Fights | KO/TKO | of which doctor | corner | Sub | U-DEC | S-DEC | M-DEC | Draw | NC | DQ | Finish rate |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 5928 | 32.2% | 0.8% | 0.1% | 17.5% | 37.9% | 9.6% | 0.7% | 0.8% | 1.0% | 0.2% | 50.3% |
| Lightweight | 866 | 34.1% | 1.5% | 0.3% | 18.1% | 36.0% | 9.0% | 1.0% | 0.8% | 0.7% | 0.2% | 52.7% |
| Featherweight (men) | 688 | 31.5% | 0.7% | 0.1% | 15.7% | 40.1% | 9.7% | 1.2% | 1.0% | 0.7% | 0.0% | 47.6% |
| 5-round bouts | 579 | 42.5% | 1.6% | 0.5% | 15.2% | 32.1% | 7.1% | 1.0% | 0.7% | 1.2% | 0.2% | 58.5% |
| UFC title bouts | 228 | 36.8% | 0.9% | 0.4% | 15.8% | 36.0% | 7.5% | 0.9% | 1.8% | 0.9% | 0.4% | 53.3% |
| LW+FW 5-round bouts | 123 | 49.6% | 3.3% | 0.8% | 16.3% | 28.5% | 4.1% | 0.8% | 0.0% | 0.8% | 0.0% | 66.4% |

KO/TKO breakdown, all UFC 2015+: by strikes 1823, doctor 45, corner 8, injury 26, other between-round stoppages 3, unspecified 2. LW+FW 5-round bouts (n = 123) are the closest league analogue to a Volkanovski-Gaethje main event; half of them ended by KO/TKO, but the sample is small (medium).

## 2. Finish hazard by round

"Conditional" is finishes in the round divided by fights that started it; "per minute" divides by minutes actually fought in that round. NC/DQ are excluded; draws count as going the distance. 95% Wilson intervals show how thin the division-level 5-round samples are.

**All UFC 2015+, 3 Rnd (5-5-5)** (n = 5248, went the distance 50.6%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 5248 | 1332 | 880 | 452 | 25.4% | 25.4% (24%-27%) | 0.0576 |
| 2 | 3916 | 832 | 513 | 319 | 15.9% | 21.2% (20%-23%) | 0.0467 |
| 3 | 3084 | 426 | 255 | 171 | 8.1% | 13.8% (13%-15%) | 0.0295 |

**All UFC 2015+, 5 Rnd (5-5-5-5-5)** (n = 571, went the distance 41.5%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 571 | 119 | 93 | 26 | 20.8% | 20.8% (18%-24%) | 0.0463 |
| 2 | 452 | 92 | 69 | 23 | 16.1% | 20.4% (17%-24%) | 0.0448 |
| 3 | 360 | 62 | 40 | 22 | 10.9% | 17.2% (14%-21%) | 0.0372 |
| 4 | 297 | 32 | 22 | 10 | 5.6% | 10.8% (8%-15%) | 0.0225 |
| 5 | 265 | 29 | 22 | 7 | 5.1% | 10.9% (8%-15%) | 0.0230 |

**Lightweight, 3 Rnd (5-5-5)** (n = 787, went the distance 49.2%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 787 | 210 | 142 | 68 | 26.7% | 26.7% (24%-30%) | 0.0613 |
| 2 | 577 | 131 | 86 | 45 | 16.6% | 22.7% (19%-26%) | 0.0503 |
| 3 | 446 | 59 | 33 | 26 | 7.5% | 13.2% (10%-17%) | 0.0282 |

**Lightweight, 5 Rnd (5-5-5-5-5)** (n = 63, went the distance 23.8%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 63 | 17 | 13 | 4 | 27.0% | 27.0% (18%-39%) | 0.0605 |
| 2 | 46 | 15 | 10 | 5 | 23.8% | 32.6% (21%-47%) | 0.0769 |
| 3 | 31 | 7 | 3 | 4 | 11.1% | 22.6% (11%-40%) | 0.0521 |
| 4 | 24 | 4 | 2 | 2 | 6.3% | 16.7% (7%-36%) | 0.0360 |
| 5 | 20 | 5 | 4 | 1 | 7.9% | 25.0% (11%-47%) | 0.0562 |

**Featherweight (men), 3 Rnd (5-5-5)** (n = 619, went the distance 53.3%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 619 | 152 | 104 | 48 | 24.6% | 24.6% (21%-28%) | 0.0555 |
| 2 | 467 | 85 | 52 | 33 | 13.7% | 18.2% (15%-22%) | 0.0393 |
| 3 | 382 | 52 | 29 | 23 | 8.4% | 13.6% (11%-17%) | 0.0293 |

**Featherweight (men), 5 Rnd (5-5-5-5-5)** (n = 59, went the distance 44.1%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 59 | 10 | 10 | 0 | 16.9% | 16.9% (9%-28%) | 0.0370 |
| 2 | 49 | 11 | 9 | 2 | 18.6% | 22.4% (13%-36%) | 0.0494 |
| 3 | 38 | 9 | 7 | 2 | 15.3% | 23.7% (13%-39%) | 0.0527 |
| 4 | 29 | 2 | 2 | 0 | 3.4% | 6.9% (2%-22%) | 0.0142 |
| 5 | 27 | 1 | 1 | 0 | 1.7% | 3.7% (1%-18%) | 0.0074 |

**UFC title bouts, 5 Rnd (5-5-5-5-5)** (n = 225, went the distance 46.7%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 225 | 36 | 29 | 7 | 16.0% | 16.0% (12%-21%) | 0.0349 |
| 2 | 189 | 35 | 24 | 11 | 15.6% | 18.5% (14%-25%) | 0.0402 |
| 3 | 154 | 25 | 15 | 10 | 11.1% | 16.2% (11%-23%) | 0.0343 |
| 4 | 129 | 11 | 8 | 3 | 4.9% | 8.5% (5%-15%) | 0.0175 |
| 5 | 118 | 13 | 8 | 5 | 5.8% | 11.0% (7%-18%) | 0.0230 |

**LW+FW 5-round bouts, 5 Rnd (5-5-5-5-5)** (n = 122, went the distance 33.6%)

| Round | Reached | Finishes | KO/TKO | Sub | Share of all fights | Conditional on reaching (95% CI) | Per minute |
|---|---|---|---|---|---|---|---|
| 1 | 122 | 27 | 23 | 4 | 22.1% | 22.1% (16%-30%) | 0.0490 |
| 2 | 95 | 26 | 19 | 7 | 21.3% | 27.4% (19%-37%) | 0.0623 |
| 3 | 69 | 16 | 10 | 6 | 13.1% | 23.2% (15%-34%) | 0.0524 |
| 4 | 53 | 6 | 4 | 2 | 4.9% | 11.3% (5%-23%) | 0.0238 |
| 5 | 47 | 6 | 5 | 1 | 4.9% | 12.8% (6%-25%) | 0.0268 |

Within the round (in-round finishes; corner/doctor stoppages at 5:00 excluded):

| Group | n | 0-1 min | 1-2 | 2-3 | 3-4 | 4-5 | Last 10 s | First 30 s | Median s |
|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 2903 | 14.1% | 20.4% | 22.3% | 19.3% | 23.9% | 5.0% | 5.2% | 162 |
| Lightweight | 442 | 14.7% | 21.3% | 23.3% | 18.8% | 21.9% | 5.4% | 5.2% | 156 |
| Featherweight (men) | 318 | 16.7% | 21.7% | 16.0% | 20.8% | 24.8% | 4.1% | 7.5% | 167 |
| 5-round bouts | 322 | 15.5% | 19.3% | 22.4% | 20.2% | 22.7% | 5.3% | 7.1% | 158 |
| UFC title bouts | 117 | 16.2% | 13.7% | 17.1% | 22.2% | 30.8% | 6.8% | 5.1% | 184 |
| LW+FW 5-round bouts | 77 | 18.2% | 15.6% | 22.1% | 19.5% | 24.7% | 9.1% | 10.4% | 158 |

Uniform timing would put 20% in each minute, 3.3% in the last 10 seconds and 10% in the first 30. Finishes are slow to start (first minute 14.1%) and spike at the horn (last 10 s 5.0%). Submissions are rarer still in the first minute (6.1%) than KO/TKOs (18.5%). (high)

## 3. How fights are finished

| Group | n | distance | clinch | ground | unknown | Punch | Kick | Knee | Elbow | Slam | Head | Body | Leg | Sub to strikes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 1823 | 60.1% | 12.3% | 27.5% | 0.0% | 77.1% | 8.6% | 6.3% | 7.6% | 0.5% | 93.0% | 5.5% | 0.7% | 0.1% |
| Lightweight | 277 | 58.1% | 13.4% | 28.5% | 0.0% | 78.3% | 9.0% | 7.2% | 4.7% | 0.7% | 92.1% | 6.1% | 0.7% | 0.0% |
| Featherweight (men) | 204 | 66.7% | 8.3% | 25.0% | 0.0% | 77.9% | 8.3% | 5.9% | 6.9% | 1.0% | 92.6% | 5.9% | 0.5% | 0.0% |
| 5-round bouts | 219 | 58.9% | 12.3% | 28.8% | 0.0% | 81.7% | 8.2% | 3.2% | 6.4% | 0.5% | 97.3% | 1.8% | 0.0% | 0.5% |
| UFC title bouts | 80 | 60.0% | 8.8% | 31.2% | 0.0% | 80.0% | 11.2% | 3.8% | 3.8% | 1.2% | 93.8% | 3.8% | 0.0% | 0.0% |
| LW+FW 5-round bouts | 51 | 64.7% | 13.7% | 21.6% | 0.0% | 86.3% | 3.9% | 2.0% | 7.8% | 0.0% | 100.0% | 0.0% | 0.0% | 0.0% |

Ground sub-positions (All UFC 2015+):

| Sub-position | n | Share of strike KO/TKOs |
|---|---|---|
| distance | 1055 | 57.9% |
| ground (unspecified) | 226 | 12.4% |
| clinch | 225 | 12.3% |
| mount | 90 | 4.9% |
| back control | 74 | 4.1% |
| half guard | 44 | 2.4% |
| guard | 44 | 2.4% |
| distance (implied) | 41 | 2.2% |
| crucifix | 12 | 0.7% |
| side control | 7 | 0.4% |
| bottom (striker on bottom) | 5 | 0.3% |

Submission types and positions (All UFC 2015+, n = 1040):

| Type | n | Share |
|---|---|---|
| Rear-naked choke | 453 | 43.6% |
| Guillotine | 177 | 17.0% |
| Armbar | 101 | 9.7% |
| Arm triangle | 99 | 9.5% |
| Triangle | 51 | 4.9% |
| D'Arce | 37 | 3.6% |
| Anaconda | 29 | 2.8% |
| Kimura | 23 | 2.2% |
| Neck crank | 13 | 1.2% |
| Heel hook | 12 | 1.2% |
| Other | 10 | 1.0% |
| Kneebar | 9 | 0.9% |
| Von Flue | 6 | 0.6% |
| Twister | 4 | 0.4% |

| Position | n | Share |
|---|---|---|
| back | 488 | 46.9% |
| bottom (submitter on bottom) | 170 | 16.3% |
| top | 166 | 16.0% |
| ground (unspecified) | 166 | 16.0% |
| standing | 33 | 3.2% |
| unspecified | 17 | 1.6% |

Parsing: position from "At Distance", "In Clinch", "On Ground" or "From <position>"; spinning back fists, spinning back kicks and flying knees with no position are treated as distance. Submission position is coded from the submitter's point of view ("From Bottom Guard", "After Drop to Guard" = bottom; rear-naked chokes = back). (high)

## 4. Strike rates and accuracy

| Group | Sig landed | Sig att | Acc | Head l/a | Body l/a | Leg l/a | Dist l/a | Clinch l/a | Ground l/a | Total landed |
|---|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 57.44 | 125.20 | 45.9% | 36.19 / 96.44 | 11.98 / 17.33 | 9.26 / 11.43 | 44.71 / 107.46 | 6.49 / 9.06 | 6.24 / 8.68 | 80.47 |
| Lightweight | 58.98 | 128.06 | 46.1% | 37.23 / 98.51 | 12.53 / 18.34 | 9.22 / 11.21 | 46.17 / 110.03 | 6.06 / 8.54 | 6.75 / 9.49 | 79.90 |
| Featherweight (men) | 59.36 | 131.17 | 45.3% | 37.70 / 101.50 | 12.17 / 17.78 | 9.49 / 11.89 | 47.38 / 114.31 | 5.79 / 8.12 | 6.19 / 8.73 | 80.61 |
| 5-round bouts | 59.83 | 126.57 | 47.3% | 37.92 / 97.41 | 11.97 / 16.90 | 9.95 / 12.27 | 48.83 / 111.76 | 5.45 / 7.40 | 5.55 / 7.41 | 80.00 |
| UFC title bouts | 59.52 | 125.13 | 47.6% | 37.71 / 96.00 | 11.73 / 16.48 | 10.08 / 12.64 | 47.87 / 109.63 | 5.87 / 7.95 | 5.78 / 7.55 | 82.72 |
| LW+FW 5-round bouts | 71.19 | 148.22 | 48.0% | 46.97 / 115.97 | 13.32 / 18.95 | 10.90 / 13.30 | 60.35 / 133.53 | 4.74 / 6.30 | 6.10 / 8.38 | 85.69 |

| Group | Head acc | Body acc | Leg acc | Dist acc | Clinch acc | Ground acc | Landed head/body/leg | Landed dist/clinch/ground |
|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 37.5% | 69.1% | 81.1% | 41.6% | 71.7% | 71.8% | 63%/21%/16% | 78%/11%/11% |
| Lightweight | 37.8% | 68.3% | 82.3% | 42.0% | 71.0% | 71.1% | 63%/21%/16% | 78%/10%/11% |
| Featherweight (men) | 37.1% | 68.5% | 79.8% | 41.4% | 71.3% | 70.9% | 64%/21%/16% | 80%/10%/10% |
| 5-round bouts | 38.9% | 70.8% | 81.1% | 43.7% | 73.7% | 74.9% | 63%/20%/17% | 82%/9%/9% |
| UFC title bouts | 39.3% | 71.2% | 79.7% | 43.7% | 73.7% | 76.6% | 63%/20%/17% | 80%/10%/10% |
| LW+FW 5-round bouts | 40.5% | 70.3% | 82.0% | 45.2% | 75.3% | 72.8% | 66%/19%/15% | 85%/7%/9% |

Divide per-15 numbers by 15 for ufcstats-style per-minute rates (league SLpM about 3.83). Body and leg strikes land far more often than head strikes because head strikes are where defense concentrates; this is the per-target accuracy split the v3 spec asks for. (high)

## 5. Knockdowns and finishing hazards

| Group | KD | KD/15 | per 100 standing head landed (range) | per 100 head landed | per 100 sig landed | P(finish same round given KD) | 1 KD | 2+ KD | P(scorer wins) | KO-by-strikes with winner KD in final round |
|---|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 2605 | 0.299 | 0.95 (0.91-0.99) | 0.83 | 0.52 | 61.8% | 60.9% | 71.2% | 85.4% | 73.8% |
| Lightweight | 380 | 0.314 | 0.98 (0.93-1.02) | 0.84 | 0.53 | 63.4% | 61.0% | 89.7% | 85.0% | 75.8% |
| Featherweight (men) | 341 | 0.333 | 1.00 (0.96-1.05) | 0.88 | 0.56 | 57.5% | 56.7% | 65.5% | 85.3% | 79.3% |
| 5-round bouts | 317 | 0.263 | 0.78 (0.76-0.81) | 0.69 | 0.44 | 60.3% | 59.6% | 65.6% | 86.5% | 73.5% |
| UFC title bouts | 121 | 0.235 | 0.70 (0.68-0.73) | 0.62 | 0.39 | 52.4% | 51.6% | 57.1% | 82.9% | 63.7% |
| LW+FW 5-round bouts | 73 | 0.313 | 0.74 (0.72-0.77) | 0.67 | 0.44 | 61.8% | 60.3% | 80.0% | 85.3% | 76.5% |

| Group | Ground KO per 100 ground landed | Standing KO per 100 standing head landed | Standing KO without KD per 100 standing head |
|---|---|---|---|
| All UFC 2015+ | 0.923 | 0.483 | 0.049 |
| Lightweight | 0.967 | 0.509 | 0.049 |
| Featherweight (men) | 0.788 | 0.451 | 0.038 |
| 5-round bouts | 0.941 | 0.385 | 0.049 |
| UFC title bouts | 0.840 | 0.320 | 0.058 |
| LW+FW 5-round bouts | 0.772 | 0.407 | 0.061 |

Reading the columns: the standing-head denominator is bounded because ufcstats gives head and position totals but not their cross-tab (lower bound max(HEAD - GROUND, 0), upper bound min(HEAD, DISTANCE + CLINCH)); the point value is the midpoint and the range is shown. "P(finish same round given KD)" counts fighter-rounds with at least one knockdown that ended in a finish by the knockdown scorer in that round; the knockdown itself is often the finish. The last table gives per-strike stoppage hazards: ground KO/TKOs per 100 landed ground sig strikes (any target), standing KO/TKOs per 100 landed standing head strikes, and standing stoppages with no recorded knockdown (rare: 0.049 per 100). (medium)

## 6. Takedowns, control and submissions

| Group | TD landed/15 | TD att/15 | TD acc | CTRL s/15 | CTRL s per TD | Sub att/15 | Sub att per ctrl min (per est. ground min) | Sub conversion | Rev/15 |
|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 1.40 | 3.86 | 36.3% | 170.7 | 121.7 | 0.405 | 0.142 (0.165) | 29.6% | 0.168 |
| Lightweight | 1.49 | 4.13 | 36.1% | 175.1 | 117.4 | 0.427 | 0.146 (0.164) | 30.4% | 0.148 |
| Featherweight (men) | 1.53 | 4.11 | 37.3% | 164.7 | 107.4 | 0.479 | 0.174 (0.202) | 22.0% | 0.237 |
| 5-round bouts | 1.12 | 3.28 | 34.1% | 139.1 | 124.2 | 0.252 | 0.109 (0.128) | 28.9% | 0.085 |
| UFC title bouts | 1.25 | 3.59 | 34.8% | 142.4 | 114.0 | 0.245 | 0.103 (0.120) | 28.6% | 0.091 |
| LW+FW 5-round bouts | 1.00 | 2.95 | 34.0% | 121.9 | 121.5 | 0.326 | 0.160 (0.178) | 26.3% | 0.073 |

"CTRL s per TD" is total control divided by takedowns landed; it overstates post-takedown control because control also comes from clinch pins, scrambles and knockdown follow-ups. Submission conversion is submission wins divided by all recorded attempts; the finishing attempt is itself counted (99.9% of submission wins show a winner attempt in the final round). (high for counts, medium for the per-minute denominators)

## 7. Share of fight time by position

| Group | CTRL share of fight time | Est. ground (alt) | Est. clinch control (alt) | Distance or neutral | s CTRL per clinch att | s per ground att | s per TD | R2 |
|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 37.9% | 32.6% (29.1%) | 5.3% (8.8%) | 62.1% | 3.1 | 4.2 | 54.7 | 0.30 |
| Lightweight | 38.9% | 34.7% (30.6%) | 4.2% (8.3%) | 61.1% | 2.5 | 4.1 | 56.6 | 0.29 |
| Featherweight (men) | 36.6% | 31.6% (27.9%) | 5.0% (8.7%) | 63.4% | 3.1 | 4.0 | 52.6 | 0.37 |
| 5-round bouts | 30.9% | 26.3% (23.6%) | 4.6% (7.3%) | 69.1% | 3.4 | 3.9 | 54.9 | 0.36 |
| UFC title bouts | 31.6% | 27.1% (24.9%) | 4.5% (6.7%) | 68.4% | 3.1 | 3.8 | 52.5 | 0.33 |
| LW+FW 5-round bouts | 27.1% | 24.4% (21.9%) | 2.6% (5.2%) | 72.9% | 2.2 | 3.2 | 60.9 | 0.44 |

Method: at round level, total control (both fighters) is regressed with no intercept on clinch sig attempts, ground sig attempts and takedowns landed. Clinch control is the clinch-attempt term; the rest of control is ground. The alternative in brackets uses control per clinch attempt from rounds with no ground strikes and no takedowns (5.8 s per attempt) as an upper bound for clinch control. The fit explains only R2 = 0.30 of round control, so treat these shares as rough; calibrate the engine to control seconds per 15 and to the landed-strike position split, which are measured directly. Neutral clinch and scrambles fall into "distance or neutral". (low)

## 8. Round-level distributions

| Group | Stat | n | Mean | SD | Var/mean | NB k | P10 | P50 | P90 | P(0) |
|---|---|---|---|---|---|---|---|---|---|---|
| All UFC 2015+ | sig_l | 22892 | 18.52 | 12.37 | 8.26 | 2.55 | 5 | 16 | 35 | 0.8% |
| All UFC 2015+ | sig_a | 22892 | 41.10 | 25.09 | 15.32 | 2.87 | 12 | 38 | 75 | 0.1% |
| All UFC 2015+ | head_l | 22892 | 11.44 | 9.53 | 7.93 | 1.65 | 2 | 9 | 24 | 3.2% |
| All UFC 2015+ | body_l | 22892 | 4.00 | 3.84 | 3.69 | 1.49 | 0 | 3 | 9 | 14.0% |
| All UFC 2015+ | leg_l | 22892 | 3.09 | 3.58 | 4.14 | 0.98 | 0 | 2 | 8 | 25.7% |
| All UFC 2015+ | td_l | 22892 | 0.46 | 0.82 | 1.47 | 0.97 | 0 | 0 | 1 | 68.5% |
| All UFC 2015+ | ctrl | 22892 | 56.44 | 74.64 | 98.72 | 0.58 | 0 | 20 | 180 | 31.6% |
| Lightweight | sig_l | 3156 | 18.93 | 12.79 | 8.64 | 2.48 | 5 | 17 | 36 | 0.8% |
| Lightweight | sig_a | 3156 | 41.84 | 26.23 | 16.44 | 2.71 | 11 | 38 | 75 | 0.1% |
| Lightweight | head_l | 3156 | 11.74 | 10.03 | 8.58 | 1.55 | 2 | 9 | 24 | 3.5% |
| Lightweight | body_l | 3156 | 4.15 | 3.83 | 3.54 | 1.63 | 0 | 3 | 9 | 13.4% |
| Lightweight | leg_l | 3156 | 3.04 | 3.54 | 4.13 | 0.97 | 0 | 2 | 8 | 25.6% |
| Lightweight | td_l | 3156 | 0.49 | 0.83 | 1.42 | 1.16 | 0 | 0 | 2 | 66.8% |
| Lightweight | ctrl | 3156 | 58.38 | 76.49 | 100.20 | 0.59 | 0 | 21 | 186 | 31.3% |
| Featherweight (men) | sig_l | 2732 | 19.21 | 12.68 | 8.37 | 2.61 | 5 | 17 | 36 | 0.7% |
| Featherweight (men) | sig_a | 2732 | 42.99 | 24.82 | 14.32 | 3.23 | 13 | 41 | 75 | 0.2% |
| Featherweight (men) | head_l | 2732 | 12.01 | 9.54 | 7.57 | 1.83 | 2 | 10 | 24 | 2.3% |
| Featherweight (men) | body_l | 2732 | 4.03 | 3.79 | 3.57 | 1.57 | 0 | 3 | 9 | 12.8% |
| Featherweight (men) | leg_l | 2732 | 3.17 | 3.56 | 4.00 | 1.06 | 0 | 2 | 8 | 25.4% |
| Featherweight (men) | td_l | 2732 | 0.51 | 0.88 | 1.50 | 1.03 | 0 | 0 | 2 | 66.1% |
| Featherweight (men) | ctrl | 2732 | 54.85 | 71.46 | 93.08 | 0.60 | 0 | 23 | 169 | 28.7% |
| 5-round bouts | sig_l | 3270 | 19.33 | 12.49 | 8.08 | 2.73 | 6 | 17 | 36 | 0.9% |
| 5-round bouts | sig_a | 3270 | 41.61 | 24.22 | 14.10 | 3.18 | 13 | 38 | 74 | 0.1% |
| 5-round bouts | head_l | 3270 | 12.01 | 9.98 | 8.29 | 1.65 | 2 | 10 | 25 | 3.7% |
| 5-round bouts | body_l | 3270 | 3.99 | 3.80 | 3.62 | 1.52 | 0 | 3 | 9 | 13.3% |
| 5-round bouts | leg_l | 3270 | 3.33 | 3.65 | 4.00 | 1.11 | 0 | 2 | 8 | 23.2% |
| 5-round bouts | td_l | 3270 | 0.37 | 0.72 | 1.43 | 0.84 | 0 | 0 | 1 | 73.6% |
| 5-round bouts | ctrl | 3270 | 46.01 | 71.11 | 109.91 | 0.42 | 0 | 7 | 163 | 41.8% |
| UFC title bouts | sig_l | 1406 | 19.01 | 12.35 | 8.02 | 2.71 | 5 | 17 | 35 | 1.3% |
| UFC title bouts | sig_a | 1406 | 40.83 | 23.75 | 13.82 | 3.19 | 12 | 37 | 72 | 0.1% |
| UFC title bouts | head_l | 1406 | 11.78 | 10.25 | 8.93 | 1.49 | 2 | 9 | 25 | 4.8% |
| UFC title bouts | body_l | 1406 | 3.86 | 3.56 | 3.29 | 1.69 | 0 | 3 | 9 | 13.2% |
| UFC title bouts | leg_l | 1406 | 3.37 | 3.67 | 4.00 | 1.12 | 0 | 2 | 8 | 22.3% |
| UFC title bouts | td_l | 1406 | 0.41 | 0.78 | 1.49 | 0.84 | 0 | 0 | 1 | 71.1% |
| UFC title bouts | ctrl | 1406 | 47.39 | 72.06 | 109.57 | 0.44 | 0 | 9 | 172 | 39.9% |
| LW+FW 5-round bouts | sig_l | 618 | 23.06 | 14.37 | 8.95 | 2.90 | 8 | 21 | 39 | 0.2% |
| LW+FW 5-round bouts | sig_a | 618 | 48.83 | 25.97 | 13.81 | 3.81 | 17 | 47 | 80 | 0.0% |
| LW+FW 5-round bouts | head_l | 618 | 14.99 | 11.30 | 8.52 | 1.99 | 4 | 13 | 29 | 1.1% |
| LW+FW 5-round bouts | body_l | 618 | 4.41 | 4.34 | 4.27 | 1.35 | 1 | 3 | 9 | 8.7% |
| LW+FW 5-round bouts | leg_l | 618 | 3.66 | 3.93 | 4.23 | 1.14 | 0 | 2 | 9 | 20.6% |
| LW+FW 5-round bouts | td_l | 618 | 0.33 | 0.70 | 1.47 | 0.71 | 0 | 0 | 1 | 76.5% |
| LW+FW 5-round bouts | ctrl | 618 | 39.40 | 66.53 | 112.36 | 0.35 | 0 | 3 | 137 | 47.6% |

| Group | Corr(A, B) sig landed in a round | Corr(round r, r+1) same fighter | P(KD by fighter in a round) |
|---|---|---|---|
| All UFC 2015+ | 0.430 | 0.584 | 3.70% |
| Lightweight | 0.463 | 0.594 | 3.80% |
| Featherweight (men) | 0.372 | 0.597 | 4.65% |
| 5-round bouts | 0.345 | 0.587 | 3.27% |
| UFC title bouts | 0.363 | 0.559 | 3.41% |
| LW+FW 5-round bouts | 0.244 | 0.613 | 4.05% |

Full 5-minute rounds only. "NB k" is the negative-binomial size that matches the mean and variance (var = mu + mu^2 / k). Control is zero-inflated: about a third of fighter-rounds have none. (high)

## 9. Corner, doctor and injury stoppages

| Group | Fights | Doctor | per 100 | Corner | per 100 | Injury | per 100 |
|---|---|---|---|---|---|---|---|
| All UFC 2015+ | 5928 | 45 | 0.76 | 8 | 0.13 | 26 | 0.44 |
| Lightweight | 866 | 13 | 1.50 | 3 | 0.35 | 2 | 0.23 |
| Featherweight (men) | 688 | 5 | 0.73 | 1 | 0.15 | 6 | 0.87 |
| 5-round bouts | 579 | 9 | 1.55 | 3 | 0.52 | 14 | 2.42 |
| UFC title bouts | 228 | 2 | 0.88 | 1 | 0.44 | 1 | 0.44 |
| LW+FW 5-round bouts | 123 | 4 | 3.25 | 1 | 0.81 | 5 | 4.07 |

| Group | Between-round stoppages (KO/TKO at 5:00, non-strike) | per 100 fights | By kind |
|---|---|---|---|
| All UFC 2015+ | 43 | 0.73 | doctor 27, corner 8, injury 3, between_rounds_other 3, unspecified 2 |
| Lightweight | 10 | 1.15 | doctor 7, corner 3 |
| Featherweight (men) | 6 | 0.87 | doctor 4, corner 1, unspecified 1 |
| 5-round bouts | 12 | 2.07 | doctor 7, corner 3, injury 1, unspecified 1 |
| UFC title bouts | 3 | 1.32 | doctor 2, corner 1 |
| LW+FW 5-round bouts | 4 | 3.25 | doctor 3, corner 1 |

Corner or doctor stoppage by round, 5-round fights (all UFC):

| Round | Reached | Corner/doctor stoppages | Rate |
|---|---|---|---|
| 1 | 579 | 1 | 0.17% |
| 2 | 457 | 2 | 0.44% |
| 3 | 363 | 3 | 0.83% |
| 4 | 299 | 5 | 1.67% |
| 5 | 266 | 1 | 0.38% |

Corner stoppages are rare: 8 since 2015 in this data, one of them Topuria's retirement against Gaethje. Injury stoppages ("toKnee Injury" etc.) are more common in 5-round fights in this sample (14 of 579), but the count is small. (high count, medium as a rate)

## 10. Pace curve

**all full rounds**

| Round | Fighter-rounds | Sig landed/min | Sig att/min | Acc | Att vs R1 | Head/Body/Leg landed/min | TD att/15 | TD acc | CTRL s/round | KD per 100 standing head |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 916 | 3.33 | 7.30 | 45.6% | 1.000 | 1.81/0.74/0.78 | 2.80 | 36.8% | 42.3 | 0.49 |
| 2 | 730 | 3.97 | 8.49 | 46.7% | 1.163 | 2.44/0.83/0.69 | 2.95 | 36.3% | 45.5 | 0.44 |
| 3 | 606 | 4.02 | 8.58 | 46.9% | 1.176 | 2.55/0.81/0.66 | 3.51 | 32.6% | 44.5 | 0.28 |
| 4 | 544 | 4.15 | 8.80 | 47.2% | 1.206 | 2.74/0.83/0.58 | 3.30 | 33.4% | 49.2 | 0.20 |
| 5 | 474 | 4.22 | 9.16 | 46.1% | 1.255 | 2.91/0.79/0.51 | 3.99 | 29.8% | 52.3 | 0.20 |

**went distance only** (n fights = 237)

| Round | Fighter-rounds | Sig landed/min | Sig att/min | Acc | Att vs R1 | Head/Body/Leg landed/min | TD att/15 | TD acc | CTRL s/round | KD per 100 standing head |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 474 | 3.22 | 7.27 | 44.2% | 1.000 | 1.69/0.74/0.79 | 2.75 | 32.3% | 40.0 | 0.43 |
| 2 | 474 | 3.91 | 8.59 | 45.6% | 1.181 | 2.32/0.84/0.76 | 2.91 | 34.6% | 41.5 | 0.51 |
| 3 | 474 | 3.99 | 8.69 | 45.9% | 1.195 | 2.48/0.82/0.69 | 3.43 | 31.2% | 41.6 | 0.25 |
| 4 | 472 | 4.16 | 8.97 | 46.4% | 1.234 | 2.72/0.84/0.60 | 3.26 | 33.3% | 46.8 | 0.21 |
| 5 | 472 | 4.22 | 9.15 | 46.1% | 1.259 | 2.91/0.80/0.51 | 4.01 | 29.8% | 52.5 | 0.20 |

**LW+FW 5-round fights, went distance only** (n fights = 41)

| Round | Fighter-rounds | Sig landed/min | Sig att/min | Acc | Att vs R1 | TD att/15 | CTRL s/round |
|---|---|---|---|---|---|---|---|
| 1 | 82 | 3.76 | 8.60 | 43.8% | 1.000 | 2.34 | 29.3 |
| 2 | 82 | 4.95 | 10.59 | 46.7% | 1.231 | 2.20 | 29.8 |
| 3 | 82 | 4.77 | 10.14 | 47.0% | 1.180 | 2.71 | 36.6 |
| 4 | 82 | 5.04 | 10.66 | 47.3% | 1.240 | 3.18 | 35.0 |
| 5 | 82 | 4.92 | 10.52 | 46.8% | 1.224 | 3.95 | 44.7 |

**3-round fights, for comparison (all full rounds)**

| Round | Fighter-rounds | Sig landed/min | Sig att/min | Acc | Att vs R1 | TD att/15 | CTRL s/round |
|---|---|---|---|---|---|---|---|
| 1 | 7928 | 3.41 | 7.65 | 44.6% | 1.000 | 3.70 | 55.6 |
| 2 | 6242 | 3.82 | 8.44 | 45.2% | 1.104 | 3.87 | 58.2 |
| 3 | 5324 | 3.92 | 8.78 | 44.6% | 1.148 | 4.40 | 61.6 |

Full rounds only. The went-the-distance sample holds the same fights in every round, so its curve is free of survivorship; the all-rounds table mixes in fights that ended later. In both, output rises through the fight, head-hunting rises, leg kicks fade, and takedown attempts rise while their success falls. 3-round fights show the same climb. (high for direction, medium for the LW+FW sample)

## 11. Judging

Decisions parsed: 2871 (8613 cards). Unanimous 78.6%, split 19.9%, majority 1.6% of non-draw decisions; draws 1.6% of decisions. Judges disagree on the winner in 21.4% of decisions; cards are not identical in 59.1%. Minimum pairwise round disagreement: 13.1% of rounds. Implied 10-8 (or deduction) per round: 4.69% (3-rd 4.75%, 5-rd 4.24%); cards with one: 12.5%; decisions with at least one such card: 19.2%.

Card patterns, 3 rounds (winner's score first):

| Card | n | Share |
|---|---|---|
| 29-28 | 3640 | 46.8% |
| 30-27 | 2762 | 35.5% |
| 28-29 | 462 | 5.9% |
| 30-26 | 390 | 5.0% |
| 29-27 | 258 | 3.3% |
| 30-25 | 98 | 1.3% |
| 27-30 | 51 | 0.7% |
| 28-28 | 37 | 0.5% |
| 29-26 | 33 | 0.4% |
| 28-27 | 20 | 0.3% |
| 30-24 | 9 | 0.1% |
| 27-29 | 4 | 0.1% |

Card patterns, 5 rounds (winner's score first):

| Card | n | Share |
|---|---|---|
| 48-47 | 200 | 28.7% |
| 49-46 | 197 | 28.3% |
| 50-45 | 142 | 20.4% |
| 50-44 | 37 | 5.3% |
| 47-48 | 34 | 4.9% |
| 49-45 | 27 | 3.9% |
| 48-46 | 26 | 3.7% |
| 50-43 | 8 | 1.1% |
| 46-49 | 7 | 1.0% |
| 47-47 | 6 | 0.9% |
| 49-44 | 5 | 0.7% |
| 48-44 | 3 | 0.4% |

Implied 10-8 per round by year:

| Year | Cards | Per round |
|---|---|---|
| 2015 | 645 | 3.65% |
| 2016 | 735 | 4.48% |
| 2017 | 669 | 7.12% |
| 2018 | 657 | 4.85% |
| 2019 | 831 | 7.12% |
| 2020 | 678 | 6.54% |
| 2021 | 762 | 5.07% |
| 2022 | 711 | 3.74% |
| 2023 | 735 | 5.05% |
| 2024 | 837 | 2.51% |
| 2025 | 753 | 2.50% |
| 2026 | 600 | 3.74% |

10-8 rounds are inferred from card totals: each 10-9 round sums to 19, so 19 x rounds minus the card total counts 10-8 rounds, but point deductions reduce totals the same way, so these are upper bounds on 10-8s. The 2017 jump lines up with the ABC's revised 10-8 criteria that took effect January 1, 2017 (reported by BJPenn.com, https://bjpenn.com/mma-news/mma-judging-criteria/new-mma-judging-criteria-finalized-implemented-2017 , and Rotowire, https://www.rotowire.com/mma/article/mma-barometer-29118 ; medium). A Bloody Elbow analysis reported 10-8s in 7.3% of 2017 rounds vs 3.4% in 2001-2012 (via search summary of https://bloodyelbow.com/2018/02/01/be-analytics-crunching-numbers-2017-10-8-judging-scoring-criteria-ufc-mma-editorial ; page not fetched, medium); this data's implied 7.1% for 2017 decision rounds is consistent. The rate has fallen to about 2.5% in 2024-2025 (high, this data).

Most frequent judges:

| Judge | Cards | Years | Dissent rate | Implied 10-8 per round | Mean margin to winner |
|---|---|---|---|---|---|
| Sal D'amato | 959 | 2015-2026 | 5.8% | 4.65% | 1.98 |
| Derek Cleary | 663 | 2015-2026 | 6.6% | 5.28% | 1.87 |
| Chris Lee | 542 | 2015-2026 | 7.4% | 4.91% | 1.87 |
| Mike Bell | 539 | 2015-2026 | 6.9% | 4.96% | 1.76 |
| Junichiro Kamijo | 409 | 2015-2026 | 5.1% | 3.63% | 1.88 |
| Eric Colon | 390 | 2015-2026 | 5.4% | 3.45% | 1.84 |
| Ron McCarthy | 278 | 2015-2026 | 5.4% | 4.40% | 1.86 |
| Tony Weeks | 249 | 2015-2026 | 6.8% | 4.42% | 1.88 |
| Ben Cartlidge | 249 | 2015-2026 | 4.0% | 6.40% | 1.95 |
| David Lethaby | 195 | 2018-2026 | 5.1% | 6.36% | 2.03 |
| Adalaide Byrd | 182 | 2015-2026 | 10.4% | 5.31% | 1.75 |
| Clemens Werner | 148 | 2016-2026 | 2.0% | 4.91% | 2.09 |
| Dave Tirelli | 143 | 2015-2026 | 9.1% | 3.58% | 1.99 |
| Dave Hagen | 137 | 2015-2022 | 8.8% | 5.41% | 1.77 |
| Marcos Rosales | 118 | 2015-2021 | 11.9% | 3.70% | 1.64 |
| Mark Collett | 116 | 2015-2026 | 4.3% | 3.31% | 1.88 |
| Doug Crosby | 110 | 2015-2022 | 9.1% | 6.14% | 1.87 |
| Rick Winter | 102 | 2015-2026 | 11.8% | 2.88% | 1.85 |
| Anders Ohlsson | 95 | 2017-2026 | 8.4% | 5.19% | 1.79 |
| Glenn Trowbridge | 84 | 2015-2020 | 8.3% | 8.40% | 1.86 |
| Evan Field | 84 | 2015-2026 | 8.3% | 8.53% | 2.05 |
| Jeff Mullen | 83 | 2016-2017 | 4.8% | 4.69% | 1.78 |
| Paul Sutherland | 82 | 2015-2026 | 8.5% | 4.80% | 1.93 |
| Howard Hughes | 77 | 2015-2024 | 6.5% | 6.28% | 1.87 |
| Vito Paolillo | 74 | 2020-2026 | 8.1% | 3.95% | 1.91 |

"Dissent rate" is the share of a judge's cards that went against the majority (the loser's card in a split, the drawn card in a majority decision). Overall 7.0% of cards dissent; 359 distinct judges appear. Judges with high dissent rates and enough cards (Adalaide Byrd, Marcos Rosales, Rick Winter at 10-12%) are candidates for per-judge noise if the engine ever models named judges. (high)

## 12. Round-winner model

Logistic regression without intercept (the model is symmetric: swap corners and the sign flips), implemented with Newton/IRLS in numpy. Features are per-round differentials, fighter A minus fighter B.

- **Clean subset**: 499 decisions where all three cards were 30-27 or 50-45 for the winner, so every round's winner is known (1541 rounds). These are lopsided fights, so the fit sees few close rounds and its slopes are too steep (it is overconfident on new data, see holdout).
- **EM on all cards**: every judge's card whose total implies only 10-9 rounds (7,495 cards, 2,651 fights). The card fixes how many rounds each fighter won but not which; the E-step computes each round's posterior under the current model by enumerating the possible round assignments, the M-step is a weighted logistic fit. This uses split and close decisions too and is the recommended source of judging weights.

**Clean subset (every card 30-27 / 50-45)**: 499 fights, 1541 rounds

_target features_ (in-sample round accuracy 94.0%)

| Feature | Coef | SE | Head-strike equivalents |
|---|---|---|---|
| head_l | 0.4114 | 0.0291 | 1.00 |
| body_l | 0.3095 | 0.0334 | 0.75 |
| leg_l | 0.2865 | 0.0319 | 0.70 |
| kd | 2.8116 | 0.8504 | 6.83 |
| td_l | 0.6514 | 0.1507 | 1.58 |
| ctrl_min | 0.8817 | 0.1058 | 2.14 |
| sub | 1.3420 | 0.3956 | 3.26 |

**EM on all 10-9-only cards**: 7495 cards from 2651 fights

_target features_

| Feature | Coef | Head-strike equivalents |
|---|---|---|
| head_l | 0.1793 | 1.00 |
| body_l | 0.1327 | 0.74 |
| leg_l | 0.1051 | 0.59 |
| kd | 2.4210 | 13.51 |
| td_l | 0.2860 | 1.60 |
| ctrl_min | 0.4604 | 2.57 |
| sub | 0.8472 | 4.73 |

_position features_

| Feature | Coef | Head-strike equivalents |
|---|---|---|
| dist_l | 0.1370 | 1.00 |
| clinch_l | 0.1578 | 1.15 |
| ground_l | 0.2745 | 2.00 |
| kd | 2.2942 | 16.75 |
| td_l | 0.2847 | 2.08 |
| ctrl_min | 0.4121 | 3.01 |
| sub | 0.8889 | 6.49 |

_extended features_

| Feature | Coef | Head-strike equivalents |
|---|---|---|
| head_l | 0.1740 | 1.00 |
| body_l | 0.1301 | 0.75 |
| leg_l | 0.1026 | 0.59 |
| sig_miss | -0.0076 | -0.04 |
| nonsig_l | 0.0205 | 0.12 |
| kd | 2.3845 | 13.70 |
| td_l | 0.3668 | 2.11 |
| td_miss | -0.0967 | -0.56 |
| ctrl_min | 0.4625 | 2.66 |
| sub | 0.8753 | 5.03 |
| rev | 0.3346 | 1.92 |

Holdout: models fit on decisions before 2023-01-01, tested on 962 later decisions (target features, three independent judges).

| Model | Accuracy | Brier | Log loss |
|---|---|---|---|
| EM, all 10-9 cards | 84.1% | 0.110 | 0.342 |
| Clean subset | 84.2% | 0.127 | 0.555 |
| More sig strikes landed | 79.1% | - | - |

EM model calibration on the holdout (P(first-listed fighter wins the decision)):

| Bin | n | Mean predicted | Observed |
|---|---|---|---|
| 0.0-0.1 | 248 | 2.2% | 5.2% |
| 0.1-0.2 | 60 | 15.2% | 21.7% |
| 0.2-0.3 | 48 | 24.7% | 27.1% |
| 0.3-0.4 | 41 | 34.5% | 48.8% |
| 0.4-0.5 | 35 | 44.3% | 51.4% |
| 0.5-0.6 | 33 | 55.6% | 60.6% |
| 0.6-0.7 | 42 | 65.6% | 66.7% |
| 0.7-0.8 | 58 | 75.0% | 67.2% |
| 0.8-0.9 | 66 | 85.7% | 71.2% |
| 0.9-1.0 | 331 | 98.0% | 96.7% |

Clean-subset position and extended variants are in `data/derived/baserates_tables.md`. Readings: body strikes count about three-quarters of a head strike and leg strikes about 0.6; ground strikes count about double a distance strike in the position fit (they come with dominant position); a knockdown is worth 13-17 landed head strikes; a takedown about 1.6-2.1; a minute of control about 2.6-3.0; a submission attempt about 5-6.5. Missed strikes carry essentially no credit (aggression is not rewarded per se), and missed takedowns cost a little. The model is well calibrated at the extremes but overconfident in the middle bands (10-40% and 70-90%), which is what you expect when three judges are treated as independent: the engine's judges need a shared noise component (and a per-fight taste term) on top of individual noise, tuned to the split-decision rate and the 13% pairwise round disagreement. (medium)

Compared with v2's judging weights (head 1, body 0.8, leg 0.55, ground 0.85, knockdown 12, takedown 3, control 0.06 per second = 3.6 per minute, submission attempt 7): body and leg are close; knockdown is close; v2 overweights takedowns (3 vs about 1.6-2.1) and submission attempts (7 vs about 5), slightly overweights control, and underweights ground strikes (0.85 vs about 2 in the position fit, which partly reflects top position itself).

## 13. Divisions (priors for any matchup)

| Division | Fights | KO/TKO | Sub | Dec | SLpM | Sig acc | Head/Body/Leg acc | KD/15 | KD per 100 st. head | P(fin given KD) | TD/15 | TD acc | CTRL s/15 | CTRL/TD | Sub/15 | Sub conv |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Women's Strawweight | 372 | 14.5% | 19.6% | 65.7% | 4.06 | 44.6% | 36%/69%/78% | 0.106 | 0.32 | 48.4% | 1.34 | 36.5% | 186 | 139 | 0.421 | 27.8% |
| Women's Flyweight | 286 | 17.1% | 19.6% | 63.3% | 4.00 | 43.3% | 35%/68%/79% | 0.099 | 0.29 | 57.4% | 1.30 | 39.0% | 182 | 140 | 0.422 | 27.5% |
| Women's Bantamweight | 222 | 19.8% | 18.0% | 62.0% | 3.65 | 45.6% | 37%/70%/79% | 0.116 | 0.41 | 53.7% | 1.22 | 38.8% | 216 | 177 | 0.376 | 28.8% |
| Women's Featherweight | 30 | 23.3% | 20.0% | 56.7% | 3.60 | 47.5% | 37%/73%/80% | 0.183 | 0.69 | 50.0% | 0.94 | 28.2% | 193 | 206 | 0.244 | 50.0% |
| Flyweight | 366 | 23.5% | 22.1% | 54.0% | 3.44 | 44.4% | 36%/68%/79% | 0.289 | 1.02 | 53.2% | 1.75 | 36.7% | 179 | 103 | 0.628 | 22.9% |
| Bantamweight | 636 | 27.0% | 17.8% | 54.4% | 3.86 | 44.6% | 36%/67%/80% | 0.322 | 1.01 | 56.1% | 1.55 | 34.1% | 156 | 100 | 0.421 | 27.4% |
| Featherweight | 688 | 31.5% | 15.7% | 52.4% | 3.96 | 45.3% | 37%/68%/80% | 0.333 | 1.00 | 57.5% | 1.53 | 37.3% | 165 | 107 | 0.479 | 22.0% |
| Lightweight | 866 | 34.1% | 18.1% | 47.3% | 3.93 | 46.1% | 38%/68%/82% | 0.314 | 0.98 | 63.4% | 1.49 | 36.1% | 175 | 117 | 0.427 | 30.4% |
| Welterweight | 821 | 34.5% | 16.6% | 48.3% | 3.71 | 45.6% | 37%/69%/82% | 0.361 | 1.17 | 59.2% | 1.32 | 36.0% | 167 | 127 | 0.338 | 33.1% |
| Middleweight | 684 | 38.9% | 17.8% | 42.2% | 3.74 | 47.2% | 39%/70%/82% | 0.350 | 1.13 | 65.9% | 1.35 | 35.7% | 163 | 120 | 0.392 | 32.5% |
| Light Heavyweight | 441 | 46.9% | 16.8% | 35.3% | 3.84 | 49.4% | 41%/72%/82% | 0.441 | 1.46 | 72.5% | 1.19 | 34.6% | 160 | 134 | 0.308 | 43.5% |
| Heavyweight | 444 | 46.8% | 12.8% | 38.8% | 3.75 | 49.7% | 41%/76%/86% | 0.340 | 1.11 | 77.6% | 1.10 | 38.3% | 163 | 148 | 0.222 | 45.6% |
| Catch Weight | 72 | 26.4% | 23.6% | 49.3% | 4.36 | 47.1% | 39%/68%/82% | 0.301 | 0.87 | 48.4% | 1.64 | 42.9% | 168 | 103 | 0.433 | 37.0% |

These are the division priors the v3 spec's shrinkage step needs (SLpM, accuracies by target, KD rates, takedown rate and accuracy, control, submission rate and conversion). Full per-division blocks with all fields are in `baserates.json` under `divisions`. Women's divisions knock down roughly a third as often per landed head strike as men's. (high; women's featherweight n = 30 is small)

## 14. Trends by year

| Year | Fights | Finish rate | KO/TKO | Sub | Sig landed/15 | Sig acc | TD att/15 | TD acc | CTRL s/15 | KD per 100 st. head |
|---|---|---|---|---|---|---|---|---|---|---|
| 2015 | 473 | 52.4% | 32.8% | 18.6% | 47.14 | 43.5% | 4.37 | 34.8% | 196 | 1.12 |
| 2016 | 493 | 49.4% | 31.0% | 18.1% | 50.13 | 43.1% | 3.82 | 38.0% | 176 | 1.13 |
| 2017 | 457 | 50.2% | 31.9% | 17.5% | 56.02 | 43.1% | 3.67 | 36.9% | 160 | 1.08 |
| 2018 | 474 | 51.3% | 31.9% | 19.0% | 55.97 | 43.8% | 3.71 | 36.1% | 166 | 1.02 |
| 2019 | 516 | 45.7% | 29.7% | 15.5% | 56.42 | 43.9% | 3.41 | 35.6% | 159 | 0.93 |
| 2020 | 456 | 49.4% | 30.5% | 18.0% | 60.10 | 47.5% | 3.66 | 37.0% | 167 | 0.86 |
| 2021 | 509 | 48.8% | 33.6% | 14.3% | 62.06 | 47.3% | 3.77 | 36.7% | 173 | 0.76 |
| 2022 | 511 | 53.0% | 33.5% | 19.2% | 61.96 | 47.4% | 3.93 | 37.9% | 174 | 1.01 |
| 2023 | 520 | 51.3% | 30.6% | 19.6% | 62.26 | 48.0% | 3.80 | 35.6% | 175 | 0.85 |
| 2024 | 517 | 45.0% | 28.4% | 16.1% | 59.71 | 47.2% | 3.82 | 36.6% | 171 | 0.69 |
| 2025 | 520 | 50.3% | 32.5% | 17.5% | 56.88 | 47.2% | 4.20 | 35.1% | 168 | 0.96 |
| 2026 | 482 | 57.7% | 40.0% | 17.4% | 59.37 | 47.8% | 4.24 | 35.7% | 166 | 1.17 |

Strike volume rose about 30% from 2015 to 2021 and has been flat since; accuracy jumped in 2020. Knockdown rate per landed head strike drifts (0.69 to 1.17 by year), so calibration should weight recent years or include a year term. 2026 so far is a high-finish year (KO/TKO 40.0%). (high)

## 15. Fight-night form

| Stat | Fighter-fights | Fighters | Residual SD (log) | Poisson SD | Within-fight SD | Implied form SD | Fighter effect SD | Opponent effect SD |
|---|---|---|---|---|---|---|---|---|
| sig_landed | 2680 | 407 | 0.448 | 0.157 | 0.270 | 0.358 | 0.349 | 0.375 |
| sig_attempted | 2680 | 407 | 0.416 | 0.103 | 0.250 | 0.332 | 0.336 | 0.351 |

full rounds only, fighter-fights with >= 2 full rounds; two-way fixed effects (fighter output, opponent allowance) on log mean per-round count; fighters and opponents with >= 4 such fights. resid_sd_log is the calibration target for between-fight spread; implied_form_sd removes the sampling noise implied by round-to-round variance inside the fight. It still holds style-matchup interaction, so it is an upper bound on pure night-to-night form.

Use the residual SD as the calibration target: the engine's fighter-vs-fighter simulations should spread each fighter's fight-level output by about this much once matchup effects are in. The implied form SD is an upper bound on pure night-to-night form. (medium)

## Engine parameters (recommended defaults)

| Parameter | Value | JSON block |
|---|---|---|
| KD per landed standing head strike | 0.0095 (LW 0.0098, title 0.0070) | knockdowns |
| P(same-round finish by scorer given KD) | 0.618 (LW 0.634) | knockdowns |
| Ground KO/TKO per landed ground sig strike | 0.0092 | knockdowns |
| Standing stoppage without KD per landed standing head strike | 0.00049 | knockdowns |
| Takedown accuracy | 0.363 (5-round 0.341) | grappling |
| Ground control per landed takedown (fit) | 55 s (raw ctrl/TD 122 s) | position_time |
| Submission attempts per estimated ground minute | 0.165 | grappling |
| Submission conversion (attempt -> finish) | 0.296 | grappling |
| Estimated ground / clinch-control share of time | 0.326 / 0.053 | position_time |
| 5-round conditional finish rate R1-R5 | 0.208, 0.204, 0.172, 0.108, 0.109 | hazard |
| Corner/doctor stoppage per round reached, 5-round R1-R5 | 0.0017, 0.0044, 0.0083, 0.0167, 0.0038 | stoppages |
| Pace (attempts vs R1), 5-round went-distance | 1.000, 1.181, 1.195, 1.234, 1.259 | pace_curve |
| Round sig-landed NB k | 2.55 | round_dist |
| Corr of opponents' sig landed in a round | 0.430 | round_dist |
| Between-fight residual SD, log sig landed | 0.448 (form upper bound 0.358) | form |
| Decision type shares U / S / M | 0.786 / 0.199 / 0.016 | judging |
| Implied 10-8 per decision round | 0.0469 (2024-25 about 0.025) | judging |
| Round logit weights (EM): head, body, leg, KD, TD, ctrl/min, sub | 0.179, 0.133, 0.105, 2.421, 0.286, 0.460, 0.847 | round_model |

All of these are also in `baserates.json` under `engine_targets`, keyed by group, so the engine can read the division or format that matches the fight.

## Caveats and open questions

- Control time mixes clinch and ground; the position-time split is a rough decomposition (R2 about 0.3). A play-by-play source would settle it.
- The head-by-position cross-tab is missing, so standing-head knockdown rates carry a +/-4% bound.
- Implied 10-8 counts include point deductions; ufcstats does not flag deductions in these files.
- The round model ignores 10-8 cards, treats judges as independent given stats, and cannot see damage that ufcstats does not count (cuts, visible hurt, octagon control). Its slope is a lower bound on how decisive judges are about clearly won rounds.
- Lightweight and featherweight 5-round samples are small (63 and 59 fights); use the all-5-round or title curves with a division multiplier rather than the raw division curves.
- KD rate per landed head strike falls in later rounds and is lower in title fights; whether that is fatigue, elite chins or selection is not separable here.
- The Road to UFC 4.6 card (two fights) is missing from the event file; its date was imputed from the neighbouring event.
- Web checks were limited to the sources cited above; the session's web search budget ran out before O'Connell's judging analysis could be re-checked, so the v2 comparison uses v2's own constants only.

## Sources

- ufcstats.com data via https://github.com/Greco1899/scrape_ufc_stats (snapshot in data/raw, through Oct 31, 2026)
- Control time definitions: https://www.ufcalendar.com/glossary/control-time ; https://agentmma.com/mma-lab/ufc-control-time-explained ; https://bloodyelbow.com/2015/06/30/mma-be-analytics-ufc-octagon-cage-size-finishes-knockouts-submissions-decisions (search summaries; pages not fetched)
- Significant strike definition: https://www.ufcalendar.com/glossary/significant-strike (search summary)
- 2017 10-8 criteria: https://bjpenn.com/mma-news/mma-judging-criteria/new-mma-judging-criteria-finalized-implemented-2017 ; https://www.rotowire.com/mma/article/mma-barometer-29118 ; https://bloodyelbow.com/2018/02/01/be-analytics-crunching-numbers-2017-10-8-judging-scoring-criteria-ufc-mma-editorial (search summaries; pages not fetched)
- Event date check for the renamed Noche UFC card (Sep 13, 2025): https://en.wikipedia.org/wiki/UFC_Fight_Night:_Lopes_vs._Silva ; https://www.ufc.com/event/ufc-fight-night-september-13-2025

