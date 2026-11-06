# Justin Gaethje: dossier for a 155-lb fight with Alexander Volkanovski

As of Friday, November 6, 2026. Written for the v3 engine (any-fighter, data-first), so every section ends in numbers the engine can use.

**How to read this.** "Dataset" means the ufcstats.com snapshot in `data/raw/` (Greco1899/scrape_ufc_stats, through Oct 31, 2026). All per-minute numbers are computed from it by me (round-level rows, fight time from the result's round and time). Web facts carry a source link and a confidence tag: **[high]** = dataset or several independent outlets agree, **[med]** = one or two outlets or a search-engine summary of the page, **[low]** = single secondary report or conflicting reports. WebFetch was blocked in this session for espn.com, sports.yahoo.com and forbes.com, so web claims come from search-result summaries of the cited pages, not full-page reads. The search budget ran out before I could check the round-by-round judges' scores for UFC 324; those are marked unknown.

---

## 0. Bottom line for the engine

1. **Champion, inactive, undecided.** Gaethje is the undisputed UFC lightweight champion after Ilia Topuria's corner stopped their fight at the end of round 4 at UFC Freedom 250 (White House South Lawn, Jun 14, 2026) [high]. He has said he won't fight again in 2026 (knee bone bruise, both hands still hurt), hasn't decided whether to retire, and has named Arman Tsarukyan as the opponent if he does fight again. Nothing is booked. Dana White says a Volkanovski fight is up to Gaethje [med-high].
2. **Age and mileage.** Born Nov 14, 1988 (dataset; Wikipedia), so 37 today and **38 on Nov 14, 2026** [high]. 202.2 UFC minutes, **1,381 significant strikes absorbed (766 to the head)** in 16 UFC fights, plus a 17-0 pre-UFC run (WSOF and regional) that the dataset doesn't cover.
3. **Current form (2-year half-life, dataset):** 5.37 significant strikes landed per minute, 5.91 absorbed, 54.8% accuracy, 46.6% defense, 9.8 attempts per minute against 11.1 by opponents, 0.64 knockdowns per 15 min, 0.55 takedowns per 15 at 28%, 74% takedown defense, 0 submission attempts ever.
4. **Style has moved.** Leg kicks have nearly vanished: **3.0 landed per minute in 2017-19 down to 0.33 in 2025-26** (6.5% of his landed strikes, against 23% career). He now wrestles a little: 4 of 15 takedowns career, all since 2023, including 3 of 3 and 5:55 of control against Pimblett.
5. **Where he gets hurt now: the body.** Since 2023, **39% of the significant strikes he absorbs land on the body**, against 22% for the division (LW 2021-26 dataset). Topuria's only knockdown came from body shots; Fiziev landed 52 and 43 body strikes on him; Holloway 62.
6. **Chin.** Four official knockdowns absorbed in 16 UFC fights (Alvarez, Oliveira, Holloway, Topuria; one of them to the body per web reports, which ufcstats can't confirm). Three KO/TKO losses (Alvarez, Poirier 1, Holloway) and two submission losses (Khabib, Oliveira). Per head strike absorbed, his knockdown rate is **0.52 per 100 (0.39 per 100 counting head-shot knockdowns only)**, against **0.95 per 100 head strikes landed** across the division: an above-average chin on the record, shrunk to **0.58-0.68x the prior** (career) or **0.73-0.91x** (2-year decay). Age and mileage argue for pushing that back toward 1.0.
7. **Pace holds over 25 minutes.** In the five 5-round fights that reached round 4, his landed-per-minute by round relative to round 1 is **1.00, 1.11, 0.91, 1.11, 1.13**; opponents' landed on him goes 1.00, 1.01, 0.76, 0.94, 0.97. No sign of a late fade on paper; the Holloway fifth (out-landed 62-18) is the exception, and it came at the end of a fight he was losing.

---

## 1. Identity and physicals

| Item | Value | Source |
|---|---|---|
| Name, nickname | Justin Gaethje, "The Highlight" | dataset (`ufc_fighter_details.csv`) [high] |
| Date of birth | Nov 14, 1988; 37 now, 38 on Nov 14, 2026 | dataset; [Wikipedia](https://en.wikipedia.org/wiki/Justin_Gaethje) [high] |
| Hometown | Safford, Arizona; began wrestling at 4 | [Monster Energy](https://www.monsterenergy.com/en-us/mma/justin-gaethje/) [med] |
| Height, reach, stance | 5'11", 70", orthodox | dataset [high] |
| Wrestling | University of Northern Colorado; NCAA Division I All-American in 2010 (7th at 157 lb, 5-2 at the championships), the school's first D-I All-American since 1970; UNC Hall of Fame. Some outlets say "two-time All-American"; the school's materials support one. | [UNC Hall of Fame](https://uncbears.com/honors/hall-of-fame/justin-gaethje/83), [InterMat](https://intermatwrestle.com/articles.html/college/at-large-berth-to-all-american-status-for-gaethje-r71930) [high on 2010 All-American; low on "two-time"] |
| Coach | Trevor Wittman (ONX, Colorado) | [Sportskeeda](https://sportskeeda.com/mma/news-justin-gaethje-details-unique-training-method-trevor-whittman-transformed-way-fights), [ONX](https://onxsports.com/blogs/inside-the-onx-lab-honing-champions/top-mma-counter-strikes) [high] |
| Size vs Volkanovski | Gaethje 5'11" / 70" reach; Volkanovski 5'6" / 71" (dataset), a natural featherweight. Gaethje is 5 inches taller; Volkanovski's listed reach is an inch longer. | dataset [high] |

## 2. Record and title status

- **Pro record: 28-5** [high] ([UFCalendar](https://www.ufcalendar.com/fighters/justin-gaethje), official rankings list via [ufcrankings.org](https://ufcrankings.org/)). He entered the UFC 17-0 as the WSOF lightweight champion (17 + 11 = 28 wins, consistent with 28-5; "only champion in the title's history" is unverified) ([CBS](https://www.cbssports.com/mma/news/tuf-25-results-justin-gaethje-makes-thunderous-ufc-debut-tkos-michael-johnson), [Cageside Press](https://cagesidepress.com/2017/07/08/tuf-25-finale-results-justin-gaethje)) [high].
- **UFC record: 11-5** (dataset) [high]. Wins: 7 KO/TKO (Johnson, Vick, Barboza, Cerrone, Ferguson, Poirier 2, Topuria by corner stoppage), 4 decisions (Chandler, Fiziev twice, Pimblett), 0 submissions. Losses: 3 KO/TKO (Alvarez, Poirier 1, Holloway), 2 submissions (Khabib, Oliveira), 0 decisions.
- **Since 2021: 6-2** (Chandler W, Oliveira L, Fiziev W, Poirier W, Holloway L, Fiziev W, Pimblett W, Topuria W).
- **Titles:** interim lightweight champion twice (UFC 249 over Ferguson, May 2020; UFC 324 over Pimblett, Jan 24, 2026) ([Cageside Press](https://cagesidepress.com/2026/01/25/ufc-324-justin-gaethje-bloodies-paddy-pimblett-wins-second-interim-title), [MDJ/AP wire](https://www.mdjonline.com/sports/wire/justin-gaethje-dominates-paddy-pimblett-to-win-2nd-interim-lightweight-title/article_7f3c3ff3-d1b2-5db7-805f-3878f3e202d3.html)) [high]; BMF title (won from Poirier at UFC 291, lost to Holloway at UFC 300) [high]; **undisputed lightweight champion since UFC Freedom 250, Jun 14, 2026** ([CBS](https://www.cbssports.com/ufc/news/ufc-white-house-live-updates-results-freedom-250-highlights-ilia-topuria-justin-gaethje/live/), [Field Level Media](https://fieldlevelmedia.com/recap/justin-gaethje-stuns-ilia-topuria-at-ufc-freedom-250/), [MMA Mania](https://www.mmamania.com/ufc-white-house-2026-fight-card-start-time-full-results-dana-white-conor-mcgregor-cbs-mma/450593/ufc-white-house-results-justin-gaethje-breaks-ilia-topuria-to-finally-become-undisputed-champion)) [high].
- **Why there was an interim belt:** Topuria stepped away in late 2025 for personal reasons; the UFC made Gaethje vs Pimblett for the interim title at UFC 324 with the winner to face Topuria ([ESPN](https://africa.espn.com/mma/ufc/story/_/id/47122547/lightweights-justin-gaethje-paddy-pimblett-scheduled-fight), [LowKick](https://www.lowkickmma.com/paddy-pimblett-vs-justin-gaethje-for-interim-ufc-gold-made-official-for-ufc-324/)) [med-high].
- **Champion now:** Gaethje. The rankings updated Nov 3, 2026 list him as champion with Topuria #1, Tsarukyan #2, Oliveira #3, Holloway #4, Pimblett #5 ([ufcrankings.org](https://ufcrankings.org/), matched by [UFCalendar](https://www.ufcalendar.com/rankings/lightweight)) [med: unofficial mirrors of the media-panel list]. I found no report that he has vacated.

## 3. Every UFC fight, with dataset stats

Dataset (ufcstats). Sig = significant strikes landed, G = Gaethje, O = opponent. TD shown landed/attempted. Ctrl = control time (ufcstats counts clinch control as well as ground control).

### 3a. Results and totals

| Date | Opponent | Res | Method | Rd/Time | Min | Sig (G-O) | Sig att (G-O) | KD (G-O) | TD (G - O) | Ctrl G / O | Head/Body/Leg landed by G | Head/Body/Leg absorbed |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2017-07-07 | Michael Johnson | W | KO/TKO (knees to head in clinch) | R2 4:48 | 9.8 | 104-91 | 174-200 | 0-0 | 0/0 - 1/3 | 0:06 / 0:34 | 62/6/36 | 47/40/4 |
| 2017-12-02 | Eddie Alvarez | L | KO/TKO (knee to head in clinch) | R3 3:59 | 14.0 | 122-155 | 237-356 | 0-1 | 0/1 - 1/2 | 0:06 / 0:20 | 69/16/37 | 113/36/6 |
| 2018-04-14 | Dustin Poirier | L | KO/TKO (punch to head in clinch) | R4 0:33 | 15.6 | 115-174 | 212-351 | 0-0 | 0/0 - 0/5 | 1:04 / 0:06 | 56/9/50 | 142/21/11 |
| 2018-08-25 | James Vick | W | KO/TKO (punch to head in clinch) | R1 1:27 | 1.4 | 7-10 | 15-20 | 1-0 | 0/0 - 0/0 | 0:04 / 0:00 | 3/2/2 | 3/5/2 |
| 2019-03-30 | Edson Barboza | W | KO/TKO (punch to head at distance) | R1 2:30 | 2.5 | 20-13 | 35-32 | 1-0 | 0/0 - 0/0 | 0:44 / 0:00 | 13/2/5 | 6/3/4 |
| 2019-09-14 | Donald Cerrone | W | KO/TKO (punch to head at distance) | R1 4:18 | 4.3 | 40-17 | 61-52 | 1-0 | 0/0 - 0/0 | 0:04 / 0:00 | 27/0/13 | 12/4/1 |
| 2020-05-09 | Tony Ferguson | W | KO/TKO (punch to head at distance), interim title | R5 3:39 | 23.6 | 143-136 | 197-296 | 0-0 | 0/0 - 0/0 | 0:00 / 0:00 | 100/13/30 | 64/36/36 |
| 2020-10-24 | Khabib Nurmagomedov | L | Submission (triangle from bottom guard), title | R2 1:34 | 6.6 | 29-26 | 45-80 | 0-0 | 0/0 - 2/3 | 0:14 / 0:55 | 12/2/15 | 18/7/1 |
| **2021-11-06** | Michael Chandler | W | Decision, unanimous (29-28, 29-28, 30-27) | R3 5:00 | 15.0 | 116-103 | 183-245 | 1-0 | 0/0 - 1/6 | 1:37 / 0:03 | 83/7/26 | 64/28/11 |
| **2022-05-07** | Charles Oliveira | L | Submission (rear-naked choke) | R1 3:22 | 3.4 | 21-30 | 33-47 | 1-1 | 0/0 - 0/1 | 0:13 / 0:39 | 13/3/5 | 18/11/1 |
| **2023-03-18** | Rafael Fiziev | W | Decision, majority (29-28, 29-28, 28-28) | R3 5:00 | 15.0 | 103-97 | 171-169 | 0-0 | 1/3 - 0/0 | 0:05 / 0:00 | 81/14/8 | 38/52/7 |
| **2023-07-29** | Dustin Poirier | W | KO (head kick at distance), BMF title | R2 1:00 | 6.0 | 41-27 | 66-52 | 1-0 | 0/0 - 0/0 | 0:01 / 0:00 | 23/7/11 | 21/4/2 |
| **2024-04-13** | Max Holloway | L | KO (punch to head at distance), BMF title | R5 4:59 | 25.0 | 103-181 | 199-309 | 0-1 | 0/0 - 0/0 | 0:00 / 0:00 | 44/26/33 | 62/62/57 |
| **2025-03-08** | Rafael Fiziev | W | Decision, unanimous (29-28 x3) | R3 5:00 | 15.0 | 72-68 | 134-119 | 1-0 | 0/3 - 2/2 | 1:32 / 0:40 | 56/9/7 | 20/43/5 |
| **2026-01-24** | Paddy Pimblett | W | Decision, unanimous (48-47, 49-46, 49-46), interim title | R5 5:00 | 25.0 | 144-156 | 254-311 | 2-0 | 3/3 - 0/5 | 5:55 / 0:48 | 120/15/9 | 83/48/25 |
| **2026-06-14** | Ilia Topuria | W | KO/TKO (corner stoppage after R4), undisputed title | R4 5:00 | 20.0 | 91-97 | 192-162 | 0-1 | 0/5 - 1/3 | 1:32 / 2:32 | 79/8/4 | 55/37/5 |

Judges' totals are from the dataset's DETAILS field. Fights since 2021 are bold.

### 3b. Rates per fight

| Date | Opponent | Landed/min | Absorbed/min | Sig acc | Sig def | Att/min | Opp att/min | Head abs/min | Body abs/min | Leg abs/min | Leg kicks landed/min |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2017-07-07 | Michael Johnson | 10.61 | 9.29 | 60% | 54% | 17.8 | 20.4 | 4.80 | 4.08 | 0.41 | 3.67 |
| 2017-12-02 | Eddie Alvarez | 8.72 | 11.08 | 51% | 56% | 16.9 | 25.5 | 8.08 | 2.57 | 0.43 | 2.65 |
| 2018-04-14 | Dustin Poirier | 7.40 | 11.19 | 54% | 50% | 13.6 | 22.6 | 9.13 | 1.35 | 0.71 | 3.22 |
| 2018-08-25 | James Vick | 4.83 | 6.90 | 47% | 50% | 10.3 | 13.8 | 2.07 | 3.45 | 1.38 | 1.38 |
| 2019-03-30 | Edson Barboza | 8.00 | 5.20 | 57% | 59% | 14.0 | 12.8 | 2.40 | 1.20 | 1.60 | 2.00 |
| 2019-09-14 | Donald Cerrone | 9.30 | 3.95 | 66% | 67% | 14.2 | 12.1 | 2.79 | 0.93 | 0.23 | 3.02 |
| 2020-05-09 | Tony Ferguson | 6.05 | 5.75 | 73% | 54% | 8.3 | 12.5 | 2.71 | 1.52 | 1.52 | 1.27 |
| 2020-10-24 | Khabib Nurmagomedov | 4.42 | 3.96 | 64% | 68% | 6.9 | 12.2 | 2.74 | 1.07 | 0.15 | 2.28 |
| 2021-11-06 | Michael Chandler | 7.73 | 6.87 | 63% | 58% | 12.2 | 16.3 | 4.27 | 1.87 | 0.73 | 1.73 |
| 2022-05-07 | Charles Oliveira | 6.24 | 8.91 | 64% | 36% | 9.8 | 14.0 | 5.35 | 3.27 | 0.30 | 1.49 |
| 2023-03-18 | Rafael Fiziev | 6.87 | 6.47 | 60% | 43% | 11.4 | 11.3 | 2.53 | 3.47 | 0.47 | 0.53 |
| 2023-07-29 | Dustin Poirier | 6.83 | 4.50 | 62% | 48% | 11.0 | 8.7 | 3.50 | 0.67 | 0.33 | 1.83 |
| 2024-04-13 | Max Holloway | 4.12 | 7.24 | 52% | 41% | 8.0 | 12.4 | 2.48 | 2.48 | 2.28 | 1.32 |
| 2025-03-08 | Rafael Fiziev | 4.80 | 4.53 | 54% | 43% | 8.9 | 7.9 | 1.33 | 2.87 | 0.33 | 0.47 |
| 2026-01-24 | Paddy Pimblett | 5.76 | 6.24 | 57% | 50% | 10.2 | 12.4 | 3.32 | 1.92 | 1.00 | 0.36 |
| 2026-06-14 | Ilia Topuria | 4.55 | 4.85 | 47% | 40% | 9.6 | 8.1 | 2.75 | 1.85 | 0.25 | 0.20 |

### 3c. Notes on the fights since 2021 (web)

- **Chandler, UFC 268 (Nov 6, 2021).** Unanimous decision (29-28, 29-28, 30-27) ([MMADecisions](https://mmadecisions.com/decision/12701/Justin-Gaethje-vs-Michael-Chandler)) [high]. Chandler stumbled Gaethje badly with right hands in a wild first round (Sherdog's 2021 Round of the Year), Gaethje finished that round strong and took over ([Sherdog](https://m.sherdog.com/news/articles/Sherdogs-2021-Round-of-the-Year-183929), [CBS](https://www.cbssports.com/mma/news/ufc-268-results-highlights-justin-gaethje-earns-decision-in-fight-of-the-year-contender-vs-michael-chandler)) [high]. Dataset: Gaethje's only KD came in R2, where he also had 1:09 of control and 8 ground strikes.
- **Oliveira, UFC 274 (May 7, 2022).** Oliveira missed weight by half a pound and was stripped; only Gaethje could win the belt. Gaethje dropped Oliveira early with a right hand, Oliveira dropped Gaethje with a right, took his back and choked him at 3:22 of R1 ([Cageside Press](https://cagesidepress.com/2022/05/08/ufc-274-results-justin-gaethje-vs-charles-oliveira), [UFC.com](https://www.ufc.com/news/ufc-274-oliveira-vs-gaethje-namajunas-esparza-2-results-highlights-winner-interviews)) [high]. Dataset: one KD each, Oliveira 2 sub attempts. Some write-ups describe two Gaethje knockdowns; ufcstats has one [low on the second].
- **Fiziev 1, UFC 286 (Mar 18, 2023).** Majority decision (29-28, 29-28, 28-28, dataset). Gaethje won it with a 53-38 third round (dataset). Fiziev landed 52 body strikes, the most any opponent has landed to his body apart from Holloway.
- **Poirier 2, UFC 291 (Jul 29, 2023).** Head kick KO at 1:00 of R2 for the BMF title ([CBS](https://www.cbssports.com/mma/news/ufc-291-live-results-dustin-poirier-vs-justin-gaethje-updates-highlights-fight-card-start-time/live)) [high]. A technical breakdown notes he stays heavy on the front foot, which feeds his low kicks ([The MMA Draw](https://themmadraw.com/p/ufc-291-technical-breakdown-did-justin)) [med].
- **Holloway, UFC 300 (Apr 13, 2024).** See section 4.
- **Fiziev 2, UFC 313 (Mar 8, 2025).** Fiziev replaced Dan Hooker (broken hand) on about 10 days' notice; three rounds; unanimous 29-28 x3 ([ESPN](https://africa.espn.com/mma/story/_/id/44031380/rafael-fiziev-stepping-face-justin-gaethje-ufc-313), [Bloody Elbow](https://bloodyelbow.com/2025/02/26/justin-gaethjes-replacement-revealed-for-ufc-313-after-dan-hooker-pulls-out-of-fight-with-injury)) [high]. Dataset: Gaethje's KD came in R2; he went 0 for 3 on takedowns and Fiziev 2 for 2.
- **Pimblett, UFC 324 (Jan 24, 2026)** and **Topuria, UFC Freedom 250 (Jun 14, 2026).** See section 4.

## 4. Round by round: UFC 300, UFC 324, UFC Freedom 250

Dataset tables, then what the web adds. "G dist/clinch/ground" = significant strikes landed by position.

### UFC 300 vs Max Holloway (Apr 13, 2024, BMF title, Holloway KO at 4:59 of R5)

| Rd | Sig G (att) | Sig Holloway (att) | KD G-O | G head/body/leg | Holloway head/body/leg |
|---|---|---|---|---|---|
| 1 | 12 (26) | 25 (39) | 0-0 | 4/2/6 | 10/5/10 |
| 2 | 18 (26) | 30 (53) | 0-0 | 6/3/9 | 4/13/13 |
| 3 | 20 (38) | 29 (53) | 0-0 | 5/9/6 | 6/13/10 |
| 4 | 35 (60) | 35 (61) | 0-0 | 18/11/6 | 15/9/11 |
| 5 | 18 (49) | 62 (103) | 0-1 | 11/1/6 | 27/22/13 |
| **Total** | **103 (199)** | **181 (309)** | **0-1** | 44/26/33 | 62/62/57 |

All strikes at distance; no takedowns, no control. What happened:
- R1: Holloway's spinning back kick near the horn broke Gaethje's nose ([Las Vegas Sun](https://lasvegassun.com/news/2024/apr/13/ufc-300-live-coverage-historic-fight-card-off-to-f/)) [med; one outlet places the spinning kick at the end of R2].
- R2-R3: Holloway out-landed him 59-38 with heavy body and leg work (26 body, 23 leg) (dataset).
- R4: Gaethje's best round, 35-35 with 18 head strikes; he hurt Holloway with a right hand. Some reports say he dropped Holloway; **ufcstats records no knockdown** ([Review-Journal](https://www.reviewjournal.com/?p=3033676)) [med that he hurt him; low on a knockdown].
- Cards after four rounds: Holloway 39-37, 39-37, 38-38 ([Sportskeeda, official scorecards](https://www.sportskeeda.com/mma/news-ufc-300-official-scorecards-one-judge-bmf-fight-tied-charles-oliveira-s-split-decision-loss)) [med-high].
- R5: Holloway out-landed him 62-18 (22 to the body); with about 10 seconds left Holloway pointed to the center of the cage, they traded, and a right hand knocked Gaethje face-first at 4:59 ([CBS](https://www.cbssports.com/mma/news/ufc-300-results-highlights-max-holloway-scores-brutal-last-second-knockout-of-justin-gaethje-in-bmf-fight), [Cageside Press](https://cagesidepress.com/2024/04/14/max-holloway-kos-justin-gaethje-in-final-second-of-ufc-300s-bmf-fight-in-electrifying-moment)) [high].
- Lesson for the engine: a high-volume, durable striker who mixes body and legs (Holloway threw 309 significant strikes) out-landed him 1.76 to 1 at distance. His usual edge, accuracy and power, did not produce a knockdown in 25 minutes.

### UFC 324 vs Paddy Pimblett (Jan 24, 2026, interim title, Gaethje by unanimous decision)

| Rd | Sig G (att) | Sig Pimblett (att) | KD G-O | TD G - O | Ctrl G / O | G head/body/leg | Pimblett head/body/leg | G dist/clinch/ground | Total str G-O |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 27 (45) | 37 (65) | 1-0 | 0/0 - 0/1 | 1:01 / 0:00 | 23/3/1 | 17/12/8 | 22/1/4 | 40-38 |
| 2 | 32 (50) | 22 (47) | 1-0 | 2/2 - 0/0 | 2:23 / 0:00 | 30/2/0 | 9/7/6 | 13/5/14 | 52-25 |
| 3 | 24 (53) | 41 (78) | 0-0 | 0/0 - 0/0 | 0:00 / 0:00 | 16/3/5 | 21/11/9 | 24/0/0 | 25-42 |
| 4 | 32 (54) | 35 (58) | 0-0 | 1/1 - 0/1 | 1:26 / 0:00 | 27/3/2 | 19/14/2 | 21/7/4 | 44-36 |
| 5 | 29 (52) | 21 (63) | 0-0 | 0/0 - 0/3 | 1:05 / 0:48 | 24/4/1 | 17/4/0 | 22/7/0 | 39-29 |
| **Total** | **144 (254)** | **156 (311)** | **2-0** | **3/3 - 0/5** | **5:55 / 0:48** | 120/15/9 | 83/48/25 | 102/20/22 | **200-170** |

- **Correction to the v2 notes:** Pimblett out-landed Gaethje in significant strikes, **156-144**; Gaethje led total strikes 200-170 and had both knockdowns, all three takedowns and 5:55 of control (dataset) [high]. Official total strikes 200 of 313 vs 170 of 326 match the dataset.
- Cards 48-47 (Mike Bell), 49-46 (Derek Cleary), 49-46 (Sal D'Amato) (dataset; [UFC.com scorecards](https://www.ufc.com/news/ufc-324-scorecards-judges-gaethje-vs-pimblett)) [high]. Which rounds each judge gave Pimblett: **unknown** (Bell gave him two, the others one; round 3, which Pimblett won 41-24 on strikes, is the likely common one, unverified). Pimblett called it "a draw" ([LowKick](https://www.lowkickmma.com/paddy-pimblett-is-pissed-off-over-justin-gaethje-decision-thats-a-draw/)) [high on the quote headline].
- R1: a hard body shot and an uppercut produced the first knockdown ([MDJ/AP](https://www.mdjonline.com/sports/wire/justin-gaethje-dominates-paddy-pimblett-to-win-2nd-interim-lightweight-title/article_7f3c3ff3-d1b2-5db7-805f-3878f3e202d3.html)) [med].
- R2: two takedowns, 2:23 of control, 14 ground strikes, then a second knockdown just before the bell; TNT Sports says replays showed an eye poke before the knockdown punch ([TNT Sports](https://www.tntsports.co.uk/mixed-martial-arts/ufc/2026/ufc-324-live-stream-paddy-pimblett-justin-gaethje_sto23262812/story.shtml)) [med].
- R3: Pimblett's best round, 41-24, with body and leg kicks (dataset).
- R4-R5: Gaethje took them back on strikes (32-35 and 29-21) and control (dataset).
- Market: Pimblett opened about -185 and closed about -225 to -238 ([MMAOddsBreaker](https://www.mmaoddsbreaker.com/fight-odds/opening-odds/160887-opening-betting-odds-for-ufc-324-gaethje-vs-pimblett/), [LowKick](https://www.lowkickmma.com/ufc-324-betting-odds-why-paddy-pimblett-never-lost-his-favorite-status-for-ufc-324-showdown/)) [med].

### UFC Freedom 250 vs Ilia Topuria (Jun 14, 2026, White House South Lawn, undisputed title, Gaethje by corner stoppage after R4)

| Rd | Sig G (att) | Sig Topuria (att) | KD G-O | TD G - O | Ctrl G / O | G head/body/leg | Topuria head/body/leg | Topuria dist/clinch/ground | Total str G-O |
|---|---|---|---|---|---|---|---|---|---|
| 1 | 32 (68) | 29 (58) | 0-0 | 0/3 - 0/0 | 0:00 / 0:00 | 30/2/0 | 19/7/3 | 25/4/0 | 35-29 |
| 2 | 12 (35) | 44 (60) | 0-1 | 0/1 - 0/0 | 0:00 / 2:02 | 11/1/0 | 19/24/1 | 29/10/5 | 13-52 |
| 3 | 22 (36) | 7 (15) | 0-0 | 0/0 - 0/1 | 0:47 / 0:05 | 19/2/1 | 5/2/0 | 3/4/0 | 31-10 |
| 4 | 25 (53) | 17 (29) | 0-0 | 0/1 - 1/2 | 0:45 / 0:25 | 19/3/3 | 12/4/1 | 11/4/2 | 40-20 |
| **Total** | **91 (192)** | **97 (162)** | **0-1** | **0/5 - 1/3** | **1:32 / 2:32** | 79/8/4 | 55/37/5 | 68/22/7 | **119-111** |

- **Result:** KO/TKO, corner stoppage at 5:00 of R4 (dataset: "Corner Stoppage", referee Marc Goddard) [high]. Topuria's corner waved it off between rounds 4 and 5 ([Yahoo via search](https://sports.yahoo.com/mma/live/ufc-freedom-250-results-justin-gaethje-shocks-ilia-topuria-pulls-off-ultimate-us-upset-on-white-house-lawn-060000480.html), [Heavy](https://heavy.com/sports/ufc/justin-gaethje-shocks-stops-ilia-topuria/)) [high]. One live blog called it an RTD; same thing in practice.
- R1: Gaethje survived an early body-shot barrage and landed 30 head strikes; 0 of 3 on takedowns (dataset; [Cageside Press](https://cagesidepress.com/2026/06/15/ufc-freedom-250-justin-gaethje-breaks-ilia-topuria-to-claim-undisputed-gold/)) [med-high].
- R2: Topuria's round, 44-12. **Body shots (a liver shot, by several accounts) dropped Gaethje**; Topuria took mount and hunted an armbar and a triangle, and Gaethje recovered and survived ([Sports Talk Florida](https://sportstalkflorida.com/ufc-fighting/ufc-freedom-250-results-justin-gaethje-stuns-ilia-topuria-for-lightweight-title/), [CBS](https://www.cbssports.com/ufc/news/ufc-white-house-live-updates-results-freedom-250-highlights-ilia-topuria-justin-gaethje/live/)) [high on body-shot knockdown]. Dataset: Topuria 24 body strikes landed in the round, 2:02 control, 5 ground strikes, but **0 submission attempts recorded**.
- R3: Gaethje 22-7. Topuria's eyes were swelling shut; the cageside doctor examined him before R4 ([Cageside Press](https://cagesidepress.com/2026/06/15/ufc-freedom-250-justin-gaethje-breaks-ilia-topuria-to-claim-undisputed-gold/), [HITC](https://www.hitc.com/doctor-points-to-questionable-moment-during-ilia-topurias-tko-loss-at-ufc-freedom-250/)) [med-high]. One outlet says Gaethje dropped Topuria with a right hand in R3; **ufcstats records no Gaethje knockdown in the fight** [low on that knockdown]. Topuria said he had lost sight in both eyes ([Bleacher Report](https://bleacherreport.com/articles/25440894-ilia-topuria-lost-sight-both-eyes-tko-loss-gaethje-ufc-white-house-wants-rematch-fight)) [med]; when it happened is reported inconsistently (this file's earlier summary said by the end of R2; `research/matchup_market.md` has a snippet saying by R4) [low on the round]. Merab Dvalishvili's claim of an eye poke is second-hand and unverified ([MMA Sucka](https://mmasucka.com/news/merab-dvalishvili-reveals-ilia-topuria-fought-with-compromised-vision-after-first-round/)) [low].
- R4: Gaethje 25-17; a knee to the ribs late in the round left Topuria in visible pain ([Newsfirst](https://newsfirst.lk/2026/06/15/gaethje-survives-war-breaks-topuria-claims-lightweight-crown-in-epic-comeback)) [med].
- Aftermath: Topuria went to hospital; fractures to both orbital bones, no surgery needed ([The Mac Life](https://themaclife.com/sports/mma/ilia-topuria-transported-to-hospital-following-damaging-defeat-to-justin-gaethje-at-white-house-event/), [LowKick](https://lowkickmma.com/ilia-topuria-injury-update-orbital-fracture-confirmed-after-justin-gaethje-loss)) [med-high].
- Market: Gaethje was about +400 to +450 in fight week (Topuria -535 to -600 at DraftKings), with other books from +360 to +525 ([LowKick](https://www.lowkickmma.com/fight-week-odds-ilia-topuria-vs-justin-gaethje-at-the-ufc-white-house-event/), [Casino.org](https://casino.org/news/sports-betting-ufc-freedom-250-results)) [med]. Closing line: unknown.
- Regulation: the event was on federal land and was regulated with the Association of Boxing Commissions (ABC), not a state commission; the D.C. commission objected ([Fightful](https://www.fightful.com/mma/association-of-boxing-commissions-to-serve-as-regulatory-advisors-for-ufc-white-house-event/), [MMA Mania](https://www.mmamania.com/ufc-white-house-2026-fight-card-start-time-full-results-dana-white-conor-mcgregor-cbs-mma/429964/sneaky-ufc-circumnavigates-dc-commission-taps-abc-regulate-freedom-250-fights-white-house-event)) [high]. Bouts count on pro records.

## 5. Health, suspension, retirement talk

**Medical suspension (Freedom 250).** 180 days, or until MRIs on his **right wrist and left knee** are cleared, plus 45 days of mandatory rest ([F4W](https://www.f4wonline.com/news/ufc/ufc-freedom-250-medical-suspensions/), [Forbes](https://www.forbes.com/sites/brianmazique/2026/06/17/justin-gaethje-handed-6-month-suspension-after-ufc-freedom-250-win-over-topuria/), [NY Fights](https://nyfights.com/mma/ilia-topuria-and-justin-gaethje-return-ufc/)) [med-high: read from search summaries, Forbes was blocked]. The list came from the ABC and was shared by CSAC executive director Andy Foster, which is why some outlets (e.g. [The Mac Life](https://themaclife.com/sports/mma/gaethje-handed-medical-suspension-after-title-win/)) call it a California suspension [med; note that `research/matchup_market.md` still says "CSAC suspended him", so the issuer is disputed inside this project]. **The v2 note "(CSAC)" should read "ABC list, shared by CSAC's Andy Foster."** 180 days from Jun 14 runs to about **Dec 11, 2026**. Topuria got 180 days or clearance by an oral and maxillofacial surgeon, plus 60 days for the TKO ([F4W](https://www.f4wonline.com/news/ufc/ufc-freedom-250-medical-suspensions/)) [high].

**MRI results, surgery, clearance:** I found **no public MRI result, no surgery and no clearance** as of Nov 6, 2026 ([Delinquent MMA](https://delinquentmma.com/gaethje-injury-update-retirement-2027/) reports no surgical timeline) [med: absence of reports].

**Injury statements (in order):**
- August 2026: told Sports Illustrated "I still can't punch anything"; both hands still hurt; out until 2027 ([MiddleEasy](https://middleeasy.com/mma-news/justin-gaethje-both-hands-hurt-sit-out-2026), [BJPenn.com](https://www.bjpenn.com/mma-news/ufc/justin-gaethje-remains-sidelined-until-2027-amid-injury-update-both-of-my-hands-are-still-hurt/), [Yardbarker](https://www.yardbarker.com/mma/articles/gaethje_says_he_wont_return_until_2027/s1_17349_44240583)) [med-high]. Some outlets say "broken" hands; the quoted word is "hurt" [low on "broken"].
- Mid-September 2026: ruled out fighting again in 2026; a deep (bone) bruise in his knee that he says he has carried since Christmas 2025, through both 2026 fights ([AgentMMA](https://agentmma.com/news/90201-justin-gaethje-rules-out-fighting-for-remainder-of-2026-due-to-injuries), [LowKick](https://www.lowkickmma.com/justin-gaethje-opens-up-on-injuries-that-will-keep-him-out-until-2027/)) [med-high]. Engine note: he beat Pimblett and Topuria with that knee.

**Retirement talk:**
- Background: in June 2025 his manager Ali Abdelaziz said Gaethje would consider retiring if his next fight wasn't for the title; Tsarukyan mocked it ([Sherdog](https://www.sherdog.com/news/news/Arman-Tsarukyan-Reacts-to-Justin-Gaethjes-Retirement-Threat-197288)) [med].
- Right after Freedom 250, on Joe Rogan's podcast: "Right now, I'm planning on it" (fighting again) ([ESPN](https://www.espn.com/mma/story/_/id/49129829/ufc-lightweight-champion-justin-gaethje-planning-fight-again)) [med-high]; said nothing in him feels like it's over and that he had promised his mother not to decide that night ([LowKick](https://www.lowkickmma.com/ufc-hall-of-famer-wants-justin-gaethje-to-retire-but-the-highlight-wont/)) [med]. Georges St-Pierre said he should retire ([MMA News](https://www.mmanews.com/article/georges-st-pierre-says-justin-gaethje-should-retire-after-ufc-freedom-250-win-what-else-does-he-want-to-accomplish)) [med].
- Late September 2026 (Andrew Schulz interview): if he fights again it will be Tsarukyan; "right now, I need to rest"; undecided; "I want to keep my faculties" ([MMA Mania](https://www.mmamania.com/latest-news/474425/justin-gaethje-weighs-retirement-ahead-of-possible-arman-tsarukyan-title-defense-i-want-to-keep-my-faculties), [news.am](https://sport.news.am/eng/news/169186/justin-gaethje-if-i-fight-again-my-opponent-will-be-tsarukyan.html), [Yardbarker](https://www.yardbarker.com/mma/articles/gaethje_says_he_hasnt_decided_on_retirement/s1_17349_44297653)) [med; exact date unverified]. He said he will weigh it like a business decision, pros and cons on paper ([BJPenn.com](https://www.bjpenn.com/mma-news/justin-gaethje/ufc-champion-justin-gaethje-provides-update-on-possible-mma-retirement/)) [med].
- **Latest (to Nov 6):** no public response to Volkanovski's callout found ([Cageside Press, Nov 5](https://cagesidepress.com/2026/11/05/white-open-volk-gaethje-waiting-lightweight-champs/), [Bloody Elbow, Nov 5](https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/)) [med].

## 6. What's next and whether anything is booked

- **Booked: nothing** as of Nov 6, 2026 ([UFCalendar](https://www.ufcalendar.com/fighters/justin-gaethje), [Cageside Press](https://cagesidepress.com/2026/11/05/white-open-volk-gaethje-waiting-lightweight-champs/)) [high].
- **Tsarukyan:** Gaethje's own stated choice if he fights again ([MMA Sucka](https://mmasucka.com/news/justin-gaethje-says-arman-tsarukyan-would-be-his-next-fight-by-years-end/), [SI](https://www.si.com/fannation/mma/news/justin-gaethje-reveals-who-he-will-fight-next-in-ufc-title-defense)) [med-high]. White has not promised Tsarukyan the shot [med].
- **Volkanovski:** after beating Movsar Evloev at UFC 333 (Oct 24, 2026), Volkanovski called for a champion-vs-champion fight at 155: "If they wanted to give me that opportunity, I would retire. Win or lose, retire." ([AgentMMA](https://agentmma.com/news/91994-volkanovski-says-he-d-retire-after-a-superfight-with-gaethje-win-or-lose), [theScore](https://www.thescore.com/mma/news/3634621/volkanovski-eyes-gaethje-superfight-thats-something-i-would-retire-for), [Heavy](https://heavy.com/sports/ufc/justin-gaethje-challenged-by-alexander-volkanovski/)) [high]. He had floated it on a podcast in mid-October and later told MMA Junkie he isn't necessarily retiring after his next fight [med]. Dana White, Nov 5: "I don't know yet... We're talking to him, but we'll figure it out," and Gaethje has to "pull the trigger" ([BJPenn.com](https://www.bjpenn.com/mma-news/ufc/dana-white-presses-justin-gaethje-pull-trigger-alexander-volkanovski/), [Sportskeeda](https://www.sportskeeda.com/mma/news-dana-white-suggests-justin-gaethje-holding-super-fight-vs-alexander-volkanovski)) [med-high].
- **Topuria rematch:** Topuria wants it ("We will have our rematch"); White said a Gaethje rematch or a Pimblett fight both interest him; Topuria's return date is disputed (late 2026 vs 2027) ([LowKick](https://www.lowkickmma.com/ilia-topuria-dana-white-fight-gaethje-paddy/), [LowKick](https://www.lowkickmma.com/ilia-topuria-no-ufc-return-2026/)) [med]. Gaethje doubts it's next ([UFCFight.net](https://ufcfight.net/justin-gaethje-doubts-ilia-topuria-rematch-next/)) [low-med].
- **Market for Volk-Gaethje:** Gaethje opened -200, Volkanovski +170 (FightOdds.io via [Heavy](https://heavy.com/sports/ufc/justin-gaethje-betting-favorite-alex-volkanovski/)) [med]. Date: the FightOdds.io X post cited in `research/matchup_market.md` (status ID 2114102147243450379) decodes to Oct 24, 2026, 21:10 UTC, the day of UFC 333 [med on the date; the post's content was not re-read].
- **Earliest realistic return:** 2027 by his own account; the suspension runs to about Dec 11, 2026 unless the MRIs clear sooner. A fight in Q1-Q2 2027 would have him at 38, 7-12 months after Freedom 250. His layoffs since 2021 average about 8 months.

## 7. Style tendencies (data first, then sources)

All rates from the dataset; LW baseline = all men's lightweight fights Jan 1, 2021 to Oct 31, 2026 in the dataset (409 fights, 8,293 fighter-minutes): 4.33 landed and 9.04 attempted per minute, 47.9% accuracy, 0.39 knockdowns per 15, 0.95 knockdowns per 100 head strikes landed, 1.52 takedowns per 15 at 35.6%, 2.9 minutes of control per 15; landed mix head 63% / body 22% / legs 15%.

| Trait | Gaethje | LW baseline | Read |
|---|---|---|---|
| Accuracy (sig) | 57.6% career; 54.5% since 2023 | 47.9% | well above average, every era |
| Defense (sig) | 50.7% career; **44.2% since 2023** | 52.1% | below average and falling |
| Landed / absorbed per min | 6.29 / 6.83 career; 5.23 / 5.91 since 2023 | 4.33 / 4.33 | high-action both ways |
| Knockdowns per 15 | 0.67 career (9 KDs) | 0.39 | about 1.7x the division |
| KDs per 100 head strikes landed | 1.07 | 0.95 | slightly above average per shot; the KD edge is mostly volume times accuracy |
| Takedown defense | 73% (8 of 30) | 64% (1 - 0.356) | solid; Khabib 2/3 and Fiziev 2/2 are the breaches |
| Takedowns per 15 | 0.30 career, 0.57 since 2023 | 1.52 | situational, increasing |
| Submission attempts | 0 in 202 min | | none, ever, in the UFC |

**Leg kicks.** His signature, historically: calf and low kicks "harder (and from a closer range) than just about anyone" ([Face Punching](https://facepunching.substack.com/p/the-barely-controlled-chaos-of-justin)) [med]; they chewed up Poirier's lead leg in 2018 ([Sherdog](https://www.sherdog.com/news/news/Dustin-Poirier-Digs-Deep-in-Knockout-of-Justin-Gaethje-at-UFC-on-Fox-29-135015), [UFC.com](https://www.ufc.com/news/poirier-finishes-gaethje-another-fight-night-performance)) [high]. **But the volume has collapsed** (dataset): leg kicks landed per minute 3.01 (2017-19), 1.56 (2020-22), 1.13 (2023-24), **0.33 (2025-26)**; share of his landed strikes 35% to 25% to 21% to **6.5%**. Against Pimblett he landed 9 leg strikes in 25 minutes; against Topuria, 4 in 20. Part of this is opponent-specific (kick-catchers, counter-punchers) and part may be the knee. The v3 profile should use decayed target shares (head 74%, body 12%, legs 14%) with a labeled "leg" knob, not the career 23-28%.

**Pressure and power punching.** Forward pressure, heavy on the front foot, throws in bunches ([The MMA Draw](https://themmadraw.com/p/ufc-291-technical-breakdown-did-justin), [Combat Wrap-Up](https://combatwrapup.substack.com/p/highlighting-the-highlight)) [med]. Head-hunting has grown: 83% of his landed strikes went to the head in 2025-26 (dataset). After the Alvarez and Poirier losses he and Wittman made him more methodical, picking moments instead of brawling every second ([Face Punching](https://facepunching.substack.com/p/the-barely-controlled-chaos-of-justin), [Combat Wrap-Up](https://combatwrapup.substack.com/p/highlighting-the-highlight)) [med]. The data agrees: attempts per minute fell from 15.4 (2017-19) to about 9.5 since 2020, now close to the LW average of 9.0; opponents' attempts at him fell from 21.3 to 9.9 per minute.

**Head movement and low dips.** v2 cited Sherdog's scouting report and MMA Sucka for level-change feints and a tendency to dip low into knees and uppercuts ([Sherdog](https://www.sherdog.com/news/articles/Scouting-Report-Justin-Gaethje-190610), [MMA Sucka](https://mmasucka.com/opinion/previewing-a-potential-justin-gaethje-vs-alexander-volkanovski-fight/)) [low-med: carried over from v2, not re-read this session]. Supporting evidence in the record: two of his three KO losses and his debut-fight danger came from knees and punches in the clinch (Alvarez knee to the head in the clinch; Poirier punches in the clinch). Wittman's own description of their counter-striking: a long hook to bait the guard and a feinted overhand to make opponents lean back ([ONX](https://onxsports.com/blogs/inside-the-onx-lab-honing-champions/top-mma-counter-strikes)) [low: promotional piece].

**Wrestling.** NCAA D-I All-American base (section 1). Defensively it shows up as tie-ups, downblocks, underhooks and whizzers rather than blast doubles ([Combat Wrap-Up](https://combatwrapup.substack.com/p/highlighting-the-highlight)) [med]. Offensively, 4 of 15 career, all since 2023, and 11 attempts in 2025-26 alone; the 3-for-3, 5:55-control night against Pimblett is the outlier, then 0 for 5 against Topuria (dataset).

**Clinch.** 12.7% of his landed strikes career, 19.9% in 2025-26 (dataset): more clinch work lately, including the Topuria knee.

**Body vulnerability.** Share of absorbed strikes landing on his body: 32% career, **39% since 2023** vs 22% LW. Opponents who invested in the body all had success: Alvarez (body work set up the knee, [CBS](https://www.cbssports.com/mma/news/ufc-218-results-highlights-eddie-alvarez-scores-tko-victory-over-justin-gaethje)) [high], Fiziev (52 and 43), Holloway (62), Pimblett (48), Topuria (37, including the knockdown).

**How Volkanovski's tools map onto this (Gaethje side only).** Pressure plus low kicks were his traditional answer to shorter, mobile strikers, but he barely kicks the legs now. The fighters who beat or troubled him recently out-volumed him at distance and went to the body (Holloway, Topuria R2, Pimblett R3). He hasn't been taken down and controlled by a striker-wrestler since Khabib; the data says his takedown defense is good but not airtight (Fiziev 2/2 in 2025).

## 8. Chin and durability

### 8a. Every knockdown absorbed in the UFC (dataset, with web detail)

| # | Fight | Round | What the dataset shows in that round | What dropped him (web) | Outcome |
|---|---|---|---|---|---|
| 1 | Eddie Alvarez, UFC 218, Dec 2, 2017 | R3 | Alvarez landed 40 sig (34 head); 10 in the clinch, 3 on the ground; 1 takedown | Knee to the head in the clinch after sustained body work ([Fightful](https://www.fightful.com/mma/ufc-218-eddie-alvarez-defeats-justin-gaethje-sick-knee), [CBS](https://www.cbssports.com/mma/news/ufc-218-results-highlights-eddie-alvarez-scores-tko-victory-over-justin-gaethje)) [high] | TKO loss, 3:59 R3 (UFC.com lists 3:53) |
| 2 | Charles Oliveira, UFC 274, May 7, 2022 | R1 | Oliveira landed 30 sig (18 head, 11 body); 8 in the clinch; 2 sub attempts | Right hand at distance, then back take ([Cageside Press](https://cagesidepress.com/2022/05/08/ufc-274-results-justin-gaethje-vs-charles-oliveira)) [high] | Submission loss (RNC), 3:22 R1 |
| 3 | Max Holloway, UFC 300, Apr 13, 2024 | R5 | Holloway landed 62 sig (27 head, 22 body), all at distance | Right hand at distance with one second left ([CBS](https://www.cbssports.com/mma/news/ufc-300-results-highlights-max-holloway-scores-brutal-last-second-knockout-of-justin-gaethje-in-bmf-fight)) [high] | KO loss, 4:59 R5 |
| 4 | Ilia Topuria, Freedom 250, Jun 14, 2026 | R2 | Topuria landed 44 sig (24 body); 10 in the clinch, 5 on the ground; 2:02 control | Body shots (liver) at close range ([Sports Talk Florida](https://sportstalkflorida.com/ufc-fighting/ufc-freedom-250-results-justin-gaethje-stuns-ilia-topuria-for-lightweight-title/), [CBS](https://www.cbssports.com/ufc/news/ufc-white-house-live-updates-results-freedom-250-highlights-ilia-topuria-justin-gaethje/live/)) [high] | Survived mount; won by corner stoppage after R4 |

Not in ufcstats but reported: Michael Johnson "dropped" him in R1 of his debut ([Cageside Press](https://cagesidepress.com/2017/07/08/tuf-25-finale-results-justin-gaethje)) [low; ufcstats has 0 KD for Johnson].

### 8b. Finishes against him

- **KO/TKO losses (3):** Alvarez (knee in clinch, R3, 2017); Poirier 1 (a left hand, then a barrage of punches; ufcstats: punch to head in clinch; 0:33 of R4, 2018, after 174 significant strikes absorbed in 15.6 min; [UFC.com](https://www.ufc.com/news/poirier-finishes-gaethje-another-fight-night-performance)) [high]; Holloway (right hand, 4:59 of R5, 2024).
- **Submission losses (2):** Khabib (triangle from bottom guard after a takedown, 1:34 of R2, 2020); Oliveira (RNC after a knockdown, R1, 2022).
- **Chandler was a win**, not a loss: a unanimous decision after Gaethje was badly stumbled in R1.
- No decision losses in the UFC; he has never been out-pointed over a full fight there.

### 8c. Hurt without being dropped (web)

Johnson R1 (2017); Alvarez body work R1-R2 (2017); Poirier R3-R4 (2018); Chandler R1 (2021, Sherdog's Round of the Year); Holloway R1 (spinning kick, broken nose) and R5 (2024); Topuria R1 body barrage (2026). Pimblett won R3 at UFC 324 41-24 on strikes (2026); I found no report that Gaethje was hurt in it [low].

### 8d. Chin numbers for the engine

- Head strikes absorbed: 766 career; KDs absorbed 4 (3 from head shots, 1 from body shots). ufcstats does not record what caused a knockdown; the body-shot attribution of the Topuria knockdown comes from web reports only, so treat the "head-only" figures below as conditional on it [med].
- KD absorbed per 100 head strikes absorbed: **0.52** all KDs, **0.39** head-shot KDs only; LW baseline 0.95 per 100 head strikes landed; whole UFC 2021-26 0.80.
- Shrunk with k = 300 head strikes at p0 = 0.0095 (k is the v2 engine's prior strength in `src/engine2.js`; the v3 spec leaves k to params): **0.68x** (all KDs) / **0.58x** (head-only) on career data; **0.91x / 0.73x** with the 730-day half-life (decayed head absorbed 206, decayed KDs 1.55).
- KDs absorbed per 15 min: 0.30 career, 0.33 decayed.
- Cumulative damage: 1,381 significant (1,439 total) strikes absorbed in 202 UFC minutes; 766 to the head. Three fights of 155-181 significant absorbed (Alvarez, Poirier 1, Holloway) plus Pimblett at 156.
- Judgment: the record says above-average chin; age 38, the KO in his last 5-round loss, three KO losses, and four 150-plus-strike fights argue for an age and mileage term. I'd start the engine at the decayed estimate (about 0.8-0.9x prior) before age, and let the spec's age and KO-loss terms push it toward or past 1.0 [judgment].

## 9. Output and pace by round in 5-round fights

Dataset. Five 5-round fights reached round 4: Poirier 2018 (ended 0:33 of R4), Ferguson 2020 (ended 3:39 of R5), Holloway 2024, Pimblett 2026, Topuria 2026 (four full rounds). Rates per minute of fight time in that round.

| Round | Fights | Minutes | G att/min | G landed/min | G acc | Opp att/min | Opp landed/min | G def | G head/body/leg landed per min | Absorbed head/body/leg per min | KD G-O |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 5 | 25.0 | 9.60 | 5.24 | 54.6% | 13.92 | 7.32 | 47.4% | 3.40 / 0.48 / 1.36 | 4.32 / 1.84 / 1.16 | 1-0 |
| 2 | 5 | 25.0 | 9.84 | 5.80 | 58.9% | 13.84 | 7.36 | 46.8% | 3.96 / 0.56 / 1.28 | 3.84 / 2.00 / 1.52 | 1-1 |
| 3 | 5 | 25.0 | 8.68 | 4.76 | 54.8% | 11.52 | 5.56 | 51.7% | 2.72 / 0.84 / 1.20 | 2.92 / 1.48 / 1.16 | 0-0 |
| 4 | 5 | 20.6 | 10.27 | 5.84 | 56.9% | 11.92 | 6.86 | 42.4% | 4.04 / 0.88 / 0.92 | 3.94 / 1.95 / 0.97 | 0-0 |
| 5 | 3 | 13.6 | 10.27 | 5.94 | 57.9% | 14.82 | 7.11 | 52.0% | 4.69 / 0.44 / 0.81 | 3.52 / 2.27 / 1.32 | 0-1 |

- **Pace ratio vs R1, Gaethje landed:** 1.00, 1.11, 0.91, 1.11, 1.13 (weights in minutes: 25, 25, 25, 20.6, 13.6). Attempts: 1.00, 1.03, 0.90, 1.07, 1.07.
- **Opponents' landed on him vs R1:** 1.00, 1.01, 0.76, 0.94, 0.97.
- **LW 5-round baseline (both fighters, 2021-26):** landed per minute by round relative to R1: 1.00, 1.18, 1.11, 1.09, 1.40 (35 fights; small, selected sample: fights that reach R5 skew toward the man who is winning). Gaethje's curve is flatter than the division's but shows no fade.
- Fifth rounds individually: Ferguson 34-14 (he was winning), Holloway 18-62 (losing, KO'd), Pimblett 29-21 (winning). Accuracy holds in a 55-59% band in every round (54.6% to 58.9%).
- Across all 16 UFC fights (3- and 5-rounders) his landed per minute by round is 6.13, 6.68, 6.39, 5.84, 5.94.
- Engine read: give him a near-flat cardio curve (about 1.0-1.1 in rounds 2, 4, 5), not a fade; his defense is the variable that slips (42% in round 4).

## 10. Damage absorbed per minute, over time

Dataset, by era (minutes in parentheses):

| Era | Fights (min) | Landed/min | Absorbed/min | Head abs/min | Body abs/min | Leg abs/min | Total strikes abs/min | Sig def | Opp att/min | KD abs |
|---|---|---|---|---|---|---|---|---|---|---|
| 2017-19 | 6 (47.6) | 8.57 | 9.67 | 6.79 | 2.29 | 0.59 | 9.94 | 54.5% | 21.3 | 1 |
| 2020-22 | 4 (48.6) | 6.36 | 6.07 | 3.38 | 1.69 | 1.01 | 6.15 | 55.8% | 13.8 | 1 |
| 2023-24 | 3 (46.0) | 5.37 | 6.63 | 2.63 | 2.57 | 1.44 | 6.63 | 42.5% | 11.5 | 1 |
| 2025-26 | 3 (60.0) | 5.12 | 5.35 | 2.63 | 2.13 | 0.58 | 6.03 | 45.8% | 9.9 | 1 |

- **Head damage per minute fell by more than half after 2019** (6.79 to about 2.6) as fights slowed down, but sig defense also fell (55% to 43-46%): opponents throw less at him and land a larger share.
- **Body damage per minute has not fallen** (2.1-2.6 since 2023).
- **Opponent-adjusted (dataset, each opponent's UFC fights before facing Gaethje):** opponents landed **1.09x** their usual rate on him since 2023 (1.40x career, minute-weighted), and he landed **1.30x** what his opponents usually absorb since 2023 (1.64x career). Method: minute-weighted mean of per-fight ratios, opponents' earlier UFC fights excluding Gaethje. A ratio of sums gives 1.08x / 1.25x since 2023 and 1.32x / 1.58x career, so the method choice moves these by up to 0.08. The chaotic 2017-18 version is gone; the current one is closer to neutral defensively with a clear offensive edge.
- Per fight since 2021, absorbed per minute: Chandler 6.87, Oliveira 8.91, Fiziev 6.47, Poirier 4.50, Holloway 7.24, Fiziev 4.53, Pimblett 6.24, Topuria 4.85.

## 11. Engine parameters (Gaethje-specific)

| Name | Value | Meaning | Source |
|---|---|---|---|
| dob | 1988-11-14 | age 38 from Nov 14, 2026 | dataset, Wikipedia |
| height_in / reach_in / stance | 71 / 70 / Orthodox | physicals | dataset |
| home_division | Lightweight (155) | no size tax at 155 | dataset |
| record | 28-5 pro; UFC 11-5 (ko_w 7, dec_w 4, sub_w 0; ko_l 3, sub_l 2, dec_l 0) | results | dataset, UFCalendar |
| ufc_minutes | 202.2 (decayed 70.8) | exposure | dataset, half-life 730 d |
| slpm | 6.29 career / 5.37 decayed / 5.23 since 2023 | sig landed per min | dataset |
| sapm | 6.83 / 5.91 / 5.91 | sig absorbed per min | dataset |
| sig_att_pm | 10.92 / 9.80 / 9.59 | sig attempts per min | dataset |
| opp_sig_att_pm | 13.86 / 11.08 / 10.59 | attempts thrown at him per min | dataset |
| acc | 0.576 / 0.548 / 0.545 | sig accuracy | dataset |
| def | 0.507 / 0.466 / 0.442 | 1 - opp landed / opp attempted | dataset |
| target_mix_landed | career 0.66/0.11/0.23; decayed 0.74/0.12/0.14; 2025-26 0.83/0.10/0.065 | head/body/leg share of his landed | dataset |
| acc_by_target | head 0.50, body 0.73-0.76, leg 0.87-0.88 | accuracy per target | dataset |
| position_mix_landed | career 0.84/0.13/0.03; decayed 0.79/0.14/0.06 | distance/clinch/ground | dataset |
| absorbed_mix | career 0.55/0.32/0.13; since 2023 0.45/0.39/0.16 | head/body/leg share of what lands on him | dataset |
| kd15 | 0.67 career / 0.64 decayed | knockdowns scored per 15 | dataset |
| kd_per_head_landed | 0.0107 raw; shrunk power ratio 1.09x (career), 1.06x (decayed) vs p0 0.0095 | power | dataset; k = 300 (v2 engine value) |
| kd_abs_per_head_abs | 0.0052 raw (0.0039 head-shot only); shrunk chin ratio 0.68x/0.58x career, 0.91x/0.73x decayed (the head-only figure assumes the Topuria knockdown was from body shots, a web claim ufcstats can't confirm) | chin before age/KO-loss terms | dataset; k = 300 (v2 engine value) |
| ko_losses / kd_absorbed | 3 / 4 | career inputs for chin aging | dataset |
| td15 / td_acc | 0.30 / 0.27 career; 0.55 / 0.28 decayed | takedown offense | dataset |
| td_def | 0.733 career (8 of 30); 0.741 decayed | takedown defense | dataset |
| ctrl15 / octrl15 | 0.99 / 0.49 min career; 1.54 / 0.74 decayed | control per 15 for / against | dataset |
| sub15 / opp_sub15 | 0 / 0.22 | submission attempts for / against | dataset |
| pace (landed vs R1) | [1.00, 1.11, 0.91, 1.11, 1.13], weights [25, 25, 25, 20.6, 13.6] | cardio curve, 5-round fights reaching R4 | dataset |
| opp_pace_vs_him | [1.00, 1.01, 0.76, 0.94, 0.97] | what lands on him by round | dataset |
| absorb_ratio_opp_adj | 1.09 since 2023 (1.40 career) | opponents land this multiple of their norm on him | dataset |
| offense_ratio_opp_adj | 1.30 since 2023 (1.64 career) | he lands this multiple of what opponents usually absorb | dataset |
| layoff_days | 145 on Nov 6, 2026 (last fight 2026-06-14) | ring rust / healing | dataset |
| injury knobs | hands: both "still hurt" as of Aug; knee bone bruise since Dec 2025; MRIs not reported | suggests labeled pow / out / leg knobs, default neutral | web [med] |

LW 2021-26 priors from the same dataset for the shrinkage: 4.33 landed and 9.04 attempted per minute, 0.479 accuracy, 0.39 KD per 15, 0.0095 KD per head strike landed, 1.52 TD per 15 at 0.356, 2.89 min control per 15, landed mix 0.63/0.22/0.15. Method split for LW fights since 2021: KO/TKO 36.9% (+1.5% doctor stoppage), submission 18.3%, unanimous decision 32.8%, split 7.6%, majority 2.2%.

## 12. Corrections and discrepancies vs the v2 notes

1. **Suspension issuer:** HANDOFF says CSAC. The event was regulated with the ABC; the suspension list came from the ABC and was shared by CSAC's Andy Foster (F4W). [med-high]
2. **UFC 324 strikes:** HANDOFF "out-landed 156-144" reads as if Gaethje out-landed Pimblett. Dataset: Pimblett 156, Gaethje 144 significant; Gaethje 200-170 in total strikes. [high]
3. **Leg kicks:** HANDOFF's 28% legs (UFC.com career) overstates current use; 2025-26 is 6.5% of landed, decayed 14%. ufcstats career split is 66/11/23, not 63/9/28 (different source and method). [high]
4. **Knockdowns that ufcstats doesn't count:** Gaethje on Holloway in R4 at UFC 300 and on Topuria in R3 at Freedom 250 (some outlets), and Johnson on Gaethje in 2017. Use ufcstats counts in the engine. [high on what ufcstats shows]
5. **"KO losses: Chandler?"** in the brief: Chandler was a Gaethje win by unanimous decision. [high]
6. **Topuria submission attempts in R2:** reported by outlets, recorded as 0 by ufcstats. [high on the dataset value]
7. **Event date:** some sites list Freedom 250 as Jun 15 (UTC); the dataset and US coverage say Jun 14, 2026. [high]

## 13. Open questions

- Gaethje's MRI results on the right wrist and left knee, and whether any surgery is planned: unknown.
- His decision on fighting again, and whether he would take Volkanovski over Tsarukyan: unknown; no public answer to Volkanovski's Oct 24 callout found.
- Round-by-round judges' scores at UFC 324 and the cards through three and four rounds at Freedom 250: unknown (search budget ran out).
- Whether the leg-kick drop is tactical (opponent-specific) or physical (the knee): unknown; worth a knob with both readings.
- Closing lines for Freedom 250 and for any Volk-Gaethje booking: unknown.

## Sources

Dataset
- ufcstats.com via github.com/Greco1899/scrape_ufc_stats, snapshot in `/home/user/XX/data/raw/` through Oct 31, 2026 (all computed stats in this file).

Status, health and what's next
- https://www.ufcalendar.com/fighters/justin-gaethje
- https://ufcrankings.org/
- https://www.ufcalendar.com/rankings/lightweight
- https://www.f4wonline.com/news/ufc/ufc-freedom-250-medical-suspensions/
- https://www.forbes.com/sites/brianmazique/2026/06/17/justin-gaethje-handed-6-month-suspension-after-ufc-freedom-250-win-over-topuria/
- https://nyfights.com/mma/ilia-topuria-and-justin-gaethje-return-ufc/
- https://themaclife.com/sports/mma/gaethje-handed-medical-suspension-after-title-win/
- https://www.bjpenn.com/mma-news/ufc/justin-gaethje-remains-sidelined-until-2027-amid-injury-update-both-of-my-hands-are-still-hurt/
- https://middleeasy.com/mma-news/justin-gaethje-both-hands-hurt-sit-out-2026
- https://www.yardbarker.com/mma/articles/gaethje_says_he_wont_return_until_2027/s1_17349_44240583
- https://agentmma.com/news/90201-justin-gaethje-rules-out-fighting-for-remainder-of-2026-due-to-injuries
- https://www.lowkickmma.com/justin-gaethje-opens-up-on-injuries-that-will-keep-him-out-until-2027/
- https://delinquentmma.com/gaethje-injury-update-retirement-2027/
- https://www.espn.com/mma/story/_/id/49129829/ufc-lightweight-champion-justin-gaethje-planning-fight-again
- https://www.lowkickmma.com/ufc-hall-of-famer-wants-justin-gaethje-to-retire-but-the-highlight-wont/
- https://www.mmanews.com/article/georges-st-pierre-says-justin-gaethje-should-retire-after-ufc-freedom-250-win-what-else-does-he-want-to-accomplish
- https://www.mmamania.com/latest-news/474425/justin-gaethje-weighs-retirement-ahead-of-possible-arman-tsarukyan-title-defense-i-want-to-keep-my-faculties
- https://sport.news.am/eng/news/169186/justin-gaethje-if-i-fight-again-my-opponent-will-be-tsarukyan.html
- https://www.yardbarker.com/mma/articles/gaethje_says_he_hasnt_decided_on_retirement/s1_17349_44297653
- https://www.bjpenn.com/mma-news/justin-gaethje/ufc-champion-justin-gaethje-provides-update-on-possible-mma-retirement/
- https://www.sherdog.com/news/news/Arman-Tsarukyan-Reacts-to-Justin-Gaethjes-Retirement-Threat-197288
- https://mmasucka.com/news/justin-gaethje-says-arman-tsarukyan-would-be-his-next-fight-by-years-end/
- https://www.si.com/fannation/mma/news/justin-gaethje-reveals-who-he-will-fight-next-in-ufc-title-defense
- https://cagesidepress.com/2026/11/05/white-open-volk-gaethje-waiting-lightweight-champs/
- https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/
- https://www.bjpenn.com/mma-news/ufc/dana-white-presses-justin-gaethje-pull-trigger-alexander-volkanovski/
- https://www.sportskeeda.com/mma/news-dana-white-suggests-justin-gaethje-holding-super-fight-vs-alexander-volkanovski
- https://agentmma.com/news/91994-volkanovski-says-he-d-retire-after-a-superfight-with-gaethje-win-or-lose
- https://www.thescore.com/mma/news/3634621/volkanovski-eyes-gaethje-superfight-thats-something-i-would-retire-for
- https://heavy.com/sports/ufc/justin-gaethje-challenged-by-alexander-volkanovski/
- https://heavy.com/sports/ufc/justin-gaethje-betting-favorite-alex-volkanovski/
- https://www.lowkickmma.com/ilia-topuria-dana-white-fight-gaethje-paddy/
- https://www.lowkickmma.com/ilia-topuria-no-ufc-return-2026/
- https://ufcfight.net/justin-gaethje-doubts-ilia-topuria-rematch-next/

UFC Freedom 250
- https://www.cbssports.com/ufc/news/ufc-white-house-live-updates-results-freedom-250-highlights-ilia-topuria-justin-gaethje/live/
- https://sports.yahoo.com/mma/live/ufc-freedom-250-results-justin-gaethje-shocks-ilia-topuria-pulls-off-ultimate-us-upset-on-white-house-lawn-060000480.html
- https://fieldlevelmedia.com/recap/justin-gaethje-stuns-ilia-topuria-at-ufc-freedom-250/
- https://heavy.com/sports/ufc/justin-gaethje-shocks-stops-ilia-topuria/
- https://www.mmamania.com/ufc-white-house-2026-fight-card-start-time-full-results-dana-white-conor-mcgregor-cbs-mma/450593/ufc-white-house-results-justin-gaethje-breaks-ilia-topuria-to-finally-become-undisputed-champion
- https://cagesidepress.com/2026/06/15/ufc-freedom-250-justin-gaethje-breaks-ilia-topuria-to-claim-undisputed-gold/
- https://sportstalkflorida.com/ufc-fighting/ufc-freedom-250-results-justin-gaethje-stuns-ilia-topuria-for-lightweight-title/
- https://newsfirst.lk/2026/06/15/gaethje-survives-war-breaks-topuria-claims-lightweight-crown-in-epic-comeback
- https://www.hitc.com/doctor-points-to-questionable-moment-during-ilia-topurias-tko-loss-at-ufc-freedom-250/
- https://bleacherreport.com/articles/25440894-ilia-topuria-lost-sight-both-eyes-tko-loss-gaethje-ufc-white-house-wants-rematch-fight
- https://mmasucka.com/news/merab-dvalishvili-reveals-ilia-topuria-fought-with-compromised-vision-after-first-round/
- https://themaclife.com/sports/mma/ilia-topuria-transported-to-hospital-following-damaging-defeat-to-justin-gaethje-at-white-house-event/
- https://lowkickmma.com/ilia-topuria-injury-update-orbital-fracture-confirmed-after-justin-gaethje-loss
- https://www.lowkickmma.com/fight-week-odds-ilia-topuria-vs-justin-gaethje-at-the-ufc-white-house-event/
- https://casino.org/news/sports-betting-ufc-freedom-250-results
- https://www.fightful.com/mma/association-of-boxing-commissions-to-serve-as-regulatory-advisors-for-ufc-white-house-event/
- https://www.mmamania.com/ufc-white-house-2026-fight-card-start-time-full-results-dana-white-conor-mcgregor-cbs-mma/429964/sneaky-ufc-circumnavigates-dc-commission-taps-abc-regulate-freedom-250-fights-white-house-event

UFC 324
- https://www.ufc.com/news/ufc-324-scorecards-judges-gaethje-vs-pimblett
- https://www.mdjonline.com/sports/wire/justin-gaethje-dominates-paddy-pimblett-to-win-2nd-interim-lightweight-title/article_7f3c3ff3-d1b2-5db7-805f-3878f3e202d3.html
- https://www.tntsports.co.uk/mixed-martial-arts/ufc/2026/ufc-324-live-stream-paddy-pimblett-justin-gaethje_sto23262812/story.shtml
- https://cagesidepress.com/2026/01/25/ufc-324-justin-gaethje-bloodies-paddy-pimblett-wins-second-interim-title
- https://www.lowkickmma.com/paddy-pimblett-is-pissed-off-over-justin-gaethje-decision-thats-a-draw/
- https://www.mmaoddsbreaker.com/fight-odds/opening-odds/160887-opening-betting-odds-for-ufc-324-gaethje-vs-pimblett/
- https://www.lowkickmma.com/ufc-324-betting-odds-why-paddy-pimblett-never-lost-his-favorite-status-for-ufc-324-showdown/
- https://africa.espn.com/mma/ufc/story/_/id/47122547/lightweights-justin-gaethje-paddy-pimblett-scheduled-fight
- https://www.lowkickmma.com/paddy-pimblett-vs-justin-gaethje-for-interim-ufc-gold-made-official-for-ufc-324/

UFC 300 and earlier fights
- https://lasvegassun.com/news/2024/apr/13/ufc-300-live-coverage-historic-fight-card-off-to-f/
- https://www.sportskeeda.com/mma/news-ufc-300-official-scorecards-one-judge-bmf-fight-tied-charles-oliveira-s-split-decision-loss
- https://www.cbssports.com/mma/news/ufc-300-results-highlights-max-holloway-scores-brutal-last-second-knockout-of-justin-gaethje-in-bmf-fight
- https://cagesidepress.com/2024/04/14/max-holloway-kos-justin-gaethje-in-final-second-of-ufc-300s-bmf-fight-in-electrifying-moment
- https://www.reviewjournal.com/?p=3033676
- https://africa.espn.com/mma/story/_/id/44031380/rafael-fiziev-stepping-face-justin-gaethje-ufc-313
- https://bloodyelbow.com/2025/02/26/justin-gaethjes-replacement-revealed-for-ufc-313-after-dan-hooker-pulls-out-of-fight-with-injury
- https://www.cbssports.com/mma/news/ufc-291-live-results-dustin-poirier-vs-justin-gaethje-updates-highlights-fight-card-start-time/live
- https://cagesidepress.com/2022/05/08/ufc-274-results-justin-gaethje-vs-charles-oliveira
- https://www.ufc.com/news/ufc-274-oliveira-vs-gaethje-namajunas-esparza-2-results-highlights-winner-interviews
- https://mmadecisions.com/decision/12701/Justin-Gaethje-vs-Michael-Chandler
- https://m.sherdog.com/news/articles/Sherdogs-2021-Round-of-the-Year-183929
- https://www.cbssports.com/mma/news/ufc-268-results-highlights-justin-gaethje-earns-decision-in-fight-of-the-year-contender-vs-michael-chandler
- https://www.ufc.com/news/poirier-finishes-gaethje-another-fight-night-performance
- https://www.sherdog.com/news/news/Dustin-Poirier-Digs-Deep-in-Knockout-of-Justin-Gaethje-at-UFC-on-Fox-29-135015
- https://www.cbssports.com/mma/news/ufc-218-results-highlights-eddie-alvarez-scores-tko-victory-over-justin-gaethje
- https://www.fightful.com/mma/ufc-218-eddie-alvarez-defeats-justin-gaethje-sick-knee
- https://cagesidepress.com/2017/07/08/tuf-25-finale-results-justin-gaethje
- https://www.cbssports.com/mma/news/tuf-25-results-justin-gaethje-makes-thunderous-ufc-debut-tkos-michael-johnson

Biography and style
- https://en.wikipedia.org/wiki/Justin_Gaethje
- https://uncbears.com/honors/hall-of-fame/justin-gaethje/83
- https://intermatwrestle.com/articles.html/college/at-large-berth-to-all-american-status-for-gaethje-r71930
- https://www.monsterenergy.com/en-us/mma/justin-gaethje/
- https://facepunching.substack.com/p/the-barely-controlled-chaos-of-justin
- https://combatwrapup.substack.com/p/highlighting-the-highlight
- https://themmadraw.com/p/ufc-291-technical-breakdown-did-justin
- https://sportskeeda.com/mma/news-justin-gaethje-details-unique-training-method-trevor-whittman-transformed-way-fights
- https://onxsports.com/blogs/inside-the-onx-lab-honing-champions/top-mma-counter-strikes
- https://www.sherdog.com/news/articles/Scouting-Report-Justin-Gaethje-190610 (cited in v2, not re-read)
- https://mmasucka.com/opinion/previewing-a-potential-justin-gaethje-vs-alexander-volkanovski-fight/

## Verification log

Adversarial check, Nov 6, 2026, by a second reviewer. **Limits:** the shared web-search budget for this run was used up before this check started, and WebFetch could not resolve f4wonline.com, sportstalkflorida.com or cbssports.com (outside this session's allowed network). So no web claim in this file was re-read. Every dataset claim below was recomputed independently from `data/raw/` (stripped strings, events joined on name, fight minutes from the result's round and time). Web-only claims are marked **unverifiable here**: not wrong, just not independently confirmed. Nothing under `src/`, `tests/` or `legacy/` was changed.

**Confirmed from the dataset (recomputed):**
- All 16 UFC results, dates, methods, rounds, times and referees in 3a; UFC record 11-5 (KO/TKO wins 7, decisions 4; losses 3 KO/TKO, 2 submissions); 6-2 since 2021. Both interim title wins (UFC 249, UFC 324) and the Freedom 250 "UFC Lightweight Title Bout" are labeled in `WEIGHTCLASS`. No lightweight title bout after Jun 14, 2026 through Oct 31, so the dataset shows no title change by fight. It can't show a vacancy.
- Freedom 250: KO/TKO, R4 5:00, Marc Goddard, details "Corner Stoppage". Sig. strikes 91-97 (Topuria), only knockdown Topuria's (R2), TD 0/5 vs 1/3, control 1:32 / 2:32. All round rows in the section 4 table match. Topuria 0 submission attempts recorded.
- UFC 324: sig. strikes 144-156 (Pimblett), total 200-170 (attempts 313 and 326), KD 2-0, TD 3/3, control 5:55 / 0:48. Cards 48-47 (Bell), 49-46 (Cleary), 49-46 (D'Amato) in `DETAILS`. The snapshot lists each judge's score loser-first. All round rows match.
- UFC 300: 103-181, R5 18-62, KO at 4:59 of R5, no Gaethje knockdown in any round. Holloway's R5 landed strikes were all at distance: 62 of 102 at distance, plus 0 of 1 in the clinch.
- Totals: 202.15 min; 1,271 landed; 1,381 absorbed (766 head, 437 body, 178 leg); 1,439 total strikes absorbed; 9 KDs scored, 4 absorbed; TD 4/15 for, 8/30 against; opponents' submission attempts 3 (0.22 per 15).
- Leg kicks: 143 / 47.58 min = 3.01 per min (2017-19); 76 / 48.59 = 1.56; 52 / 45.98 = 1.13; 20 / 60.0 = 0.33 (2025-26). Leg share 35.0% falls to 6.5%; career 22.9%.
- Body share absorbed since 2023: 246 / 626 = 39.3%; career 31.6%. LW 2021-26 landed mix 63.1 / 22.2 / 14.7.
- LW 2021-26 baseline: 4.33 landed and 9.04 attempted per min, 47.9%, 0.39 KD per 15, 0.95 KD per 100 head landed (whole UFC 0.80), 1.52 TD per 15 at 35.6%, 2.89 min control per 15, method split as stated. The fight count is **409**, not 405 (corrected above). The fighter-minutes (8,293) match.
- Chin: 4/766 = 0.52 per 100, 3/766 = 0.39. The shrunk ratios 0.68x / 0.58x (career) and 0.91x / 0.73x (decayed head absorbed 206, KDs 1.55) reproduce with k = 300 and p0 = 0.0095. k = 300 comes from the v2 engine, not the v3 spec (wording corrected).
- Decayed (730-day half-life, reference Oct 31): 5.37 / 5.91 per min, 54.8% / 46.6%, 9.8 / 11.08 attempts, 0.64 KD per 15, 0.55 TD per 15 at 27.9%, 74.1% TDD, mix 0.744 / 0.120 / 0.136, 70.8 min. Since 2023: 5.23 / 5.91, 54.5% / 44.2%, 0.57 TD per 15. Career accuracy by target: head 0.496, body 0.760, leg 0.884. Positions 0.838 / 0.127 / 0.035; clinch share 19.9% in 2025-26.
- Era table (section 10) reproduces. Opponents' attempts in 2017-19 compute to 21.2 per min, not 21.3: a rounding difference, left as is.
- Opponent-adjusted ratios 1.09 / 1.30 (since 2023) and 1.40 / 1.64 (career) reproduce only as a minute-weighted mean of per-fight ratios with Gaethje excluded from the opponents' priors. A ratio of sums gives 1.08 / 1.25 and 1.32 / 1.58 (method note added).
- Pace in the five 5-round fights reaching R4: minutes 25 / 25 / 25 / 20.55 / 13.63. Landed ratios vs R1 are 1.00 / 1.11 / 0.91 / **1.11** / 1.13 (R4 is 5.839 / 5.240 = 1.114, so the earlier 1.12 is corrected in three places). Attempts 1.00 / 1.03 / 0.90 / 1.07 / 1.07; opponents 1.00 / 1.01 / 0.76 / 0.94 / 0.97; defense by round 47.4 / 46.8 / 51.7 / 42.4 / 52.0%. All 16 fights by round: 6.13 / 6.68 / 6.39 / 5.84 / 5.94. LW 5-round curve: R2 is **1.18**, not 1.19 (35 fights; corrected). Accuracy band corrected to 54.6-58.9%.
- Other dataset spot checks: Chandler R2 KD with 1:09 control and 8 ground strikes; Fiziev 1 R3 53-38; Fiziev 2 R2 KD, Gaethje 0/3 TD, Fiziev 2/2; Ferguson R5 34-14; Alvarez R3 40 sig (34 head, 10 clinch, 3 ground, 1 TD); Oliveira R1 30 sig (18 head, 11 body, 8 clinch, 2 sub attempts). Volkanovski 5'6", 71" reach, DOB Sep 29, 1988; Gaethje 5'11", 70", DOB Nov 14, 1988; UFC 333 (Oct 24, 2026) Volkanovski def. Evloev, KO/TKO R2 4:54. 180 days from Jun 14 is Dec 11; Jun 14 to Nov 6 is 145 days; the average gap between fights since 2021 is 7.9 months.

**Unverifiable here (web-only; left in place with their tags):**
- That body shots caused Topuria's knockdown, that Topuria's corner (not the doctor) made the call, the R2 mount and submission attempts, the orbital fractures, and the ABC regulating Freedom 250.
- The suspension terms (180 days or MRI clearance on right wrist and left knee, plus 45 days) and the issuer. ABC-shared-by-Foster in this file conflicts with "CSAC" in `research/matchup_market.md` and HANDOFF. The tag was downgraded from [high] to [med-high] because the sources were read only through search summaries.
- No MRI result, surgery or clearance; "both hands still hurt" (Aug); the knee bone bruise since Christmas 2025; ruling out 2026. `research/matchup_market.md` independently cites a Bloody Elbow (Aug 29) report that he "still can't punch", which agrees, but neither file's sources were re-read. Absence-of-report claims stay [med] at best.
- Nothing booked; Tsarukyan as his named choice; undecided on retirement; Dana White's Nov 5 comments; the Nov 3 rankings; Volkanovski's "retire" quote (tagged [high] above but not re-checked).
- Opening line Gaethje -200 / Volkanovski +170 (FightOdds.io). The only independent check possible was decoding the cited X post ID: Oct 24, 2026, 21:10 UTC, added above.
- UFC 300 cards after four rounds (39-37, 39-37, 38-38), the spinning-kick broken nose, and the R4 "knockdown" some outlets report. The 38-38 card agrees with this reviewer's pre-cutoff recollection, which is not a citation.
- NCAA placing (7th, 2010), UNC Hall of Fame, "only WSOF lightweight champion" (softened above), Sherdog's 2021 Round of the Year, Alvarez time "3:53" on UFC.com, Pimblett's "draw" quote, the UFC 324 and Freedom 250 betting lines.

**Refuted:** none of the 12 key claims. Corrections were small: a pace ratio (1.12 to 1.11), the LW R2 pace ratio (1.19 to 1.18), the LW fight count (405 to 409), the accuracy band, the source of k = 300, one confidence tag, and the round of Topuria's vision loss (now flagged as inconsistent).

**Still to do with web access:** re-read the F4W and Forbes suspension pieces for the issuer and the 45-day term; a Freedom 250 recap for the knockdown's cause; the Heavy or FightOdds odds post; and any news on Gaethje's status after Nov 5.
