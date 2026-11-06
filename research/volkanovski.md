# Alexander Volkanovski: dossier for a 155-lb fight with Justin Gaethje

As of Friday, November 6, 2026. Built for the v3 engine: numbers first, narrative second.

**How to read this file**

- **Dataset** means the UFC stats snapshot in `data/raw/` (ufcstats.com via Greco1899/scrape_ufc_stats,
  current through Oct 31, 2026). Dataset numbers are computed directly and are high confidence unless noted.
  Strike counts are significant strikes ("sig") unless labeled "total". ufcstats control time ("ctrl")
  counts clinch control as well as ground control.
- **Web** claims carry a URL and a confidence flag: **(H)** high, several independent sources agree;
  **(M)** medium, one or two reputable outlets; **(L)** low, single or conflicting source.
- Limits of this pass: direct page fetches to espn.com, sherdog.com and wikipedia.org were blocked from
  this session, and the shared web-search budget ran out near the end. Web claims therefore come from
  search-result summaries of the cited pages; quotes are as those summaries reported them. Anything I could
  not confirm says "unknown".
- Scripts that produced every dataset number are reproducible from the raw CSVs (pandas); the method for
  each table is stated above it.

---

## 1. Snapshot

| Item | Value | Source |
|---|---|---|
| Born | Sep 29, 1988 (age 38.1 on Nov 6, 2026) | Dataset (ufc_fighter_tott) |
| Height / reach / stance | 5'6" / 71" / Orthodox (switches stance often) | Dataset. v2 HANDOFF used 71.5" (UFC.com); ufcstats lists 71" |
| Pro record | 29-4 | [news4jax/AP](https://www.news4jax.com/sports/2026/10/24/alexander-volkanovski-stops-movsar-evloev-in-2nd-round-to-retain-featherweight-title-at-ufc-333/) (M); was 28-4 entering UFC 333 per [UFC Calendar preview](https://www.ufcalendar.com/blog/volkanovski-evloev-how-volkanovski-wins-ufc-333) |
| UFC record | 16-3 (W: 6 KO/TKO, 0 sub, 10 dec; L: 2 KO/TKO, 1 dec) | Dataset (19 UFC fights) |
| Pre-UFC | 13-1 (derived: 29-4 minus 16-3); only pre-UFC loss came in Australia's AFC | [SI](https://www.si.com/fannation/mma/news/ufc-314-alexander-volkanovski-214-lbs-rugby-mma) / search summary (M) |
| Current title | UFC featherweight champion (defended at UFC 333, Oct 24, 2026) | Dataset; [ABC/AP](https://abcnews.com/amp/Sports/wireStory/alexander-volkanovski-stops-movsar-evloev-2nd-round-retain-137543714) (H) |
| Lightweight UFC record | 1-2 (beat Yusuke Kasuya in his 2016 UFC debut at 155; lost twice to Islam Makhachev in 2023) | Dataset |
| Last fight | W, TKO (punches from half guard), R2 4:54, vs Movsar Evloev (20-0), UFC 333, Abu Dhabi | Dataset; [Yahoo](https://sports.yahoo.com/mma/live/ufc-333-live-results-volkanovski-vs-evloev-updates-round-by-round-scoring-for-todays-title-double-header-110000274.html) (H) |
| Camp | Head coach Joe Lopez (Freestyle MMA, Australia); Eugene Bareman (City Kickboxing, Auckland) corners him | [CBS Sports](https://www.cbssports.com/ufc/news/ufc-333-alexander-volkanovski-featherweight-title-history-movsar-evloev/) (M), [Tapology](https://www.tapology.com/fightcenter/fighters/41705-alex-volkanski) (M) |
| Booked next | Nothing booked as of Nov 6, 2026 | [Bloody Elbow, Nov 5, 2026](https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/) (M) |

---

## 2. Age: what 38+ means, from the data and from published analyses

Volkanovski is 38.1 today and would be about 38.3 to 38.7 for a fight between late January and June 2027.
Gaethje (dataset DOB Nov 14, 1988) is about six and a half weeks younger, so **age is close to a wash between
them, but the absolute risk level is not**: both are in the bracket where knockout losses are most common.

### 2a. Dataset: UFC results by age (men and women, 2010 to Oct 2026)

Each row is a fighter-appearance with a known DOB (unique names only; draws and no-contests dropped).
KO-loss = lost by KO/TKO or doctor stoppage.

| Age at fight | Appearances | Win rate | KO-loss rate | KO-win rate | Avg opponent age |
|---|---|---|---|---|---|
| under 25 | 1,095 | 57.8% | 9.7% | 17.7% | 29.5 |
| 25-28 | 2,818 | 55.9% | 12.0% | 17.8% | 30.1 |
| 28-31 | 4,192 | 52.2% | 15.0% | 16.6% | 30.5 |
| 31-34 | 3,595 | 48.0% | 17.1% | 15.6% | 31.0 |
| 34-36 | 1,587 | 43.0% | 20.9% | 14.6% | 31.3 |
| 36-38 | 939 | 43.0% | 23.0% | 14.3% | 32.0 |
| **38-40** | **412** | **36.9%** | **25.5%** | 14.3% | 32.2 |
| 40+ | 248 | 32.7% | 27.8% | 12.5% | 33.0 |

- Men 125 to 155 lb only, age 38+: 172 appearances, 30.8% wins, 25.0% KO losses (vs 55.3% and 11.5% under 30).
- Men's title fights with a fighter aged 37+ since 2010: 44 appearances, 21 wins, 9 KO losses.
- Volkanovski is already an outlier: 2-0 in title fights at 37+ (UFC 325 at 37.3, UFC 333 at 38.1).

### 2b. Dataset: does the chin itself age? (knockdowns per head strike absorbed)

Per fighter-fight since 2010: knockdowns absorbed divided by significant head strikes absorbed.

| Defender age | Head strikes absorbed | KDs absorbed | KDs per 100 head strikes absorbed |
|---|---|---|---|
| under 25 | 23,861 | 155 | 0.65 |
| 25-28 | 66,285 | 502 | 0.76 |
| 28-31 | 104,701 | 883 | 0.84 |
| 31-34 | 96,469 | 845 | 0.88 |
| 34-36 | 42,192 | 432 | 1.02 |
| 36-38 | 26,107 | 261 | 1.00 |
| 38-40 | 13,237 | 135 | 1.02 |
| 40+ | 7,908 | 89 | 1.13 |

Poisson regression (KDs absorbed, offset log head strikes absorbed) on the defender's years past 30 and the
attacker's years past 30, all divisions:

- Defender (chin) coefficient **+0.0396 per year past 30** (SE 0.0057): x1.37 at age 38.
- Attacker (power) coefficient **-0.0361 per year past 30** (SE 0.0070): an older puncher drops people less often.
- Baseline 0.0084 knockdowns per landed head strike when both are 30 or younger.

For Volk vs Gaethje both terms apply to both men, so they roughly cancel in the matchup but raise the
absolute knockdown rate for both relative to a 30-year-old pairing. Caveat: all divisions pooled, and the
oldest buckets are survivors who stayed in the UFC.

### 2c. Dataset: finish rates when both fighters are old

| Bouts (men, 2010+) | n | KO/TKO | Sub | Decision |
|---|---|---|---|---|
| All | 6,629 | 33.8% | 17.8% | 46.9% |
| Both fighters 35+ | 231 | 45.0% | 16.9% | 37.2% |
| 125-155 lb, all | 3,325 | 28.4% | 19.2% | 51.2% |
| 125-155 lb, both 35+ | 59 | 32.2% | 18.6% | 49.2% |
| 5-round bouts, all | 618 | 45.6% | 14.9% | 38.3% |
| 5-round bouts, both 34+ | 71 | 56.3% | 14.1% | 29.6% |

Small samples, heavier divisions dominate the older groups; treat as directional.

### 2d. Published analyses (blog level, not peer reviewed)

- UFC Calendar, 16,429 fights: fighters 37+ won 37.7% and lost by KO in 24.6% of 1,093 fights; no plateau, each
  three-year band worse than the last; among fighters 34+, those with fewer than 300 career head strikes
  absorbed were KO'd in 23.5% of fights; wrestlers aged better.
  [ufcalendar.com](https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed) (M). Volkanovski has absorbed
  632 significant head strikes in the UFC (dataset), so he is in the higher-exposure group.
- AgentMMA, 8,332 bouts: ages 25-27 won 55.2%, 37+ won 37.8%.
  [agentmma.com](https://agentmma.com/mma-lab/ufc-fighter-peak-age) (M)
- Bloody Elbow (2013): sharp rise in KO likelihood after 34; 36-38 more than twice as likely to be KO'd as fighters
  in their early 20s. [bloodyelbow.com](https://bloodyelbow.com/2013/07/18/ufc-going-deeper-into-mma-fighter-longevity-does-age-matter/) (M)
- Both newer analyses report 1,093 fights for the 37+ group, so they likely share data; they are not independent
  confirmations. My dataset table above agrees with their direction and size.

---

## 3. Every fight since 2022 (dataset)

V = Volkanovski, O = opponent. Sig = significant strikes landed/attempted. Ctrl in m:ss.

| Date | Event | Opponent | Class | Result | Method | Rd, time | Sig V | Sig O | KD V/O | TD V | TD O | Ctrl V | Ctrl O |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2022-04-09 | UFC 273 | Chan Sung Jung | FW title | W | KO/TKO, punches to head at distance | R4 0:45 | 138/213 | 48/125 | 1/0 | 4/8 | 0/0 | 2:52 | 0:00 |
| 2022-07-02 | UFC 276 | Max Holloway (3) | FW title | W | UD 50-45 x3 | R5 5:00 | 199/372 | 127/301 | 0/0 | 0/0 | 0/3 | 1:57 | 0:16 |
| 2023-02-11 | UFC 284 | Islam Makhachev | **LW title** | L | UD 48-47, 48-47, 49-46 | R5 5:00 | 70/143 | 57/95 | 1/0 | 0/4 | 4/9 | 2:55 | 7:37 |
| 2023-07-08 | UFC 290 | Yair Rodriguez | FW title | W | KO/TKO, punches to head on ground | R3 4:19 | 66/97 | 40/80 | 0/0 | 7/12 | 0/0 | 7:13 | 0:00 |
| 2023-10-21 | UFC 294 | Islam Makhachev (2) | **LW title** | L | KO/TKO, kick to head at distance | R1 3:06 | 4/6 | 24/29 | 0/1 | 0/0 | 0/1 | 0:49 | 0:19 |
| 2024-02-17 | UFC 298 | Ilia Topuria | FW title | L | KO/TKO, punch to head at distance | R2 3:32 | 47/107 | 35/77 | 0/1 | 0/0 | 0/0 | 0:00 | 0:03 |
| 2025-04-12 | UFC 314 | Diego Lopes | FW title (vacant) | W | UD 49-46, 49-46, 48-47 | R5 5:00 | 158/259 | 63/194 | 0/1 | 1/11 | 0/0 | 1:18 | 0:05 |
| 2026-01-31 | UFC 325 | Diego Lopes (2) | FW title | W | UD 49-46, 49-46, 50-45 | R5 5:00 | 98/160 | 70/158 | 0/0 | 2/7 | 2/5 | 2:49 | 1:50 |
| 2026-10-24 | UFC 333 | Movsar Evloev | FW title | W | KO/TKO, punches to head from half guard | R2 4:54 | 56/110 | 40/65 | 0/0 | 1/2 | 3/7 | 1:44 | 0:46 |

Locations (dataset): UFC 284 Perth; UFC 294 Abu Dhabi; UFC 298 Anaheim; UFC 314 Miami; UFC 325 Sydney; UFC 333 Abu Dhabi.
Layoffs (dataset dates): 119 days between UFC 294 and UFC 298; 420 days between UFC 298 and UFC 314; 294 days to
UFC 325; 266 days to UFC 333.

### 3a. Rates by window (dataset)

Minutes are actual fight time. Strike defense = 1 - opponent sig landed / opponent sig attempted. TD defense =
1 - opponent TDs landed / opponent TD attempts. Ctrl share = control seconds / fight seconds.

| Metric | UFC career (19) | Since 2022 (9) | Since 2024 (4) | Since 2025 (3) | vs Makhachev (2) |
|---|---|---|---|---|---|
| Minutes | 312.9 | 151.6 | 68.4 | 59.9 | 28.1 |
| Sig landed / min | 5.98 | 5.52 | 5.25 | 5.21 | 2.63 |
| Sig absorbed / min | 3.33 | 3.33 | 3.04 | 2.89 | 2.88 |
| Sig attempted / min | 10.51 | 9.68 | 9.29 | 8.83 | 5.30 |
| Sig accuracy | 56.9% | 57.0% | 56.4% | 59.0% | 49.7% |
| Head accuracy | 50.6% | 52.9% | 54.1% | 57.7% | 38.1% |
| Strike defense | 58.2% | 55.2% | 57.9% | 58.5% | 34.7% |
| Opp head accuracy vs him | 33.2% | 34.4% | 34.1% | 34.5% | 55.7% |
| TD landed / 15 | 1.63 | 1.48 | 0.88 | 1.00 | 0.00 |
| TD attempts / 15 | 4.75 | 4.35 | 4.38 | 5.01 | 2.14 |
| TD accuracy | 34.3% | 34.1% | 20.0% | 20.0% | 0% |
| TD defense | 67.3% | 64.0% | 58.3% | 58.3% | 60.0% |
| Opp TD attempts / 15 | 2.49 | 2.47 | 2.63 | 3.01 | 5.34 |
| KD scored / 15 | 0.29 | 0.20 | 0.00 | 0.00 | 0.53 |
| KDs absorbed (count) | 4 | 3 | 2 | 1 | 1 |
| Sub attempts / 15 | 0.19 | 0.10 | 0.22 | 0.25 | 0.00 |
| Ctrl share (him / opp) | 19.7% / 5.3% | 14.3% / 7.2% | 8.5% / 4.0% | 9.8% / 4.5% | 13.3% / 28.2% |
| Target mix head/body/leg | 66/10/24 | 74/10/17 | 77/7/16 | 82/5/14 | 50/30/20 |
| Position mix dist/clinch/ground | 76/8/15 | 83/7/10 | 88/5/8 | 87/4/9 | 82/10/8 |

Notes: UFC.com/ufcstats publish 5.99 landed, 3.31 absorbed (v2 HANDOFF); my dataset recompute gives 5.98 and
3.33, the small gap is rounding of finish times. Previews quoted his TD defense as 68.9%
([UFC Calendar](https://www.ufcalendar.com/blog/volkanovski-evloev-breakdown-ufc-333-takedowns)); the dataset count
through UFC 333 is 35 stuffed of 52 (67.3%).

Control per takedown (dataset, includes clinch control in the numerator): Volk holds 109 s of control per
takedown he lands (34 TDs, 3,694 s). Opponents get 58 s per takedown on him across his career, 32 s since 2025
(5 TDs, 161 s), and Makhachev got 119 s per takedown (4 TDs, 476 s).

---

## 4. Lightweight history

### 4a. UFC debut at 155: Yusuke Kasuya, Nov 26, 2016 (dataset)

W, TKO (punches to head on ground) R2 2:06. Volk landed 50 of 76 sig (45 on the ground), 3 of 3 takedowns, 4:23
control. The only lightweight win of his UFC career, and a decade old. He then moved to featherweight.

### 4b. UFC 284, Feb 11, 2023, Perth: Makhachev def. Volkanovski, UD (48-47, 48-47, 49-46)

Round by round (dataset). Judges' round calls: Cartlidge and Lethaby gave Makhachev rounds 1, 2 and 4 and Volk
rounds 3 and 5; Cleary gave Makhachev rounds 1 to 4 and Volk round 5
([UFC.com scorecards](https://www.ufc.com/news/official-judges-scorecards-ufc-284-makhachev-vs-volkanovski), via
search summary, M).

| Rd | Volk sig | Makh sig | Volk total | Makh total | KD | TD Volk | TD Makh | Ctrl Volk | Ctrl Makh | Volk head/body/leg | Judges |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 11/23 | 10/16 | 14/26 | 18/25 | 0-0 | 0/0 | 1/1 | 0:00 | 2:04 | 4/5/2 | 3-0 Makhachev |
| 2 | 19/34 | 19/32 | 30/48 | 30/44 | 0-0 | 0/0 | 1/2 | 0:53 | 0:57 | 8/7/4 | 3-0 Makhachev |
| 3 | 14/37 | 16/22 | 19/43 | 20/26 | 0-0 | 0/2 | 1/3 | 0:29 | 0:35 | 7/4/3 | 2-1 Volk |
| 4 | 6/13 | 4/9 | 49/66 | 19/24 | 0-0 | 0/0 | 1/1 | 0:00 | 3:25 | 4/1/1 | 3-0 Makhachev |
| 5 | 20/36 | 8/16 | 52/72 | 8/16 | **1-0 Volk** | 0/2 | 0/2 | 1:33 | 0:36 | 14/4/2 | 3-0 Volk |
| Total | 70/143 | 57/95 | 164/255 | 95/135 | 1-0 | 0/4 | 4/9 | 2:55 | 7:37 | 37/21/12 | |

What matters for the engine:

- In the three rounds all judges gave Makhachev (1, 2, 4), Volk out-landed him 36-33 in sig strikes, but Makhachev
  landed 3 of 4 takedowns and held 386 s of control. Control beat volume.
- Round 4: Volk landed only 6 sig but 49 total strikes, nearly all non-significant short shots while Makhachev
  held 3:25 of control. ufcstats "total" strikes overstate offense from bottom.
- Round 5: Volk's best round of the fight: 20-8 sig, the only knockdown (a right hand per
  [Low Kick MMA](https://lowkickmma.com/islam-makhachev-volkanovski-ufc-284), M), stuffed both Makhachev
  takedowns, 1:33 control. This is the prototype "Volk gets stronger late" round.
- Makhachev's head accuracy vs Volk was 50% over the fight (36 of 72 in the dataset head column) vs Volk's career
  opponent average of 33%: the bigger, longer southpaw found him more easily.

### 4c. UFC 294, Oct 21, 2023, Abu Dhabi: Makhachev def. Volkanovski, KO/TKO R1 3:06

Context: Volk replaced Charles Oliveira (cut in sparring) on about 11 days' notice
([CBS Sports](https://www.cbssports.com/mma/news/ufc-294-live-results-islam-makhachev-vs-alexander-volkanovski-updates-highlights-fight-card-start-time/live),
H, sources range 10 to 12 days), and reportedly cut about 26.5 lb in 11 days from roughly 181 lb
([ESPN headline](https://www.espn.com/mma/story/_/id/38681266/), M;
[Boss Hunting](https://www.bosshunting.com.au/sport/ufc/alexander-volkanovski-weight), M).

| Rd | Volk sig | Makh sig | Volk head/body/leg | Makh head/body/leg | Makh dist/clinch/ground | KD | Ctrl Volk | Ctrl Makh |
|---|---|---|---|---|---|---|---|---|
| 1 (3:06) | 4/6 | 24/29 | 0/1/3 | 13/9/2 | 7/8/9 | 0-1 | 0:49 | 0:19 |

- Finish (dataset DETAILS): "Kick to Head At Distance". A left head kick after the two separated from the clinch
  and after Volk stuffed a takedown, then ground punches; referee Marc Goddard stopped it
  ([Yahoo](https://sports.yahoo.com/ufc-294-results-islam-makhachev-203045147.html),
  [Fighters Only](https://www.fightersonlymag.com/latest-news/ufc-294-islam-makhachev-stuns-alexander-volkanovski-with-a-head-kick-ko/), M).
- Makhachev's account: "I showed him first of all low kicks and body kicks and changed to high kick" (as quoted in
  the same coverage, M). I found no source describing Volk ducking or level-changing into it; that detail is unknown.
- Volk landed 4 sig strikes in 3:06, the lowest output of his UFC career.

### 4d. Takeaways from his 155-lb title fights

- With a full camp (UFC 284) he went 25 minutes with the best lightweight of the era, won the striking volume
  70-57 and lost on control. On 11 days' notice and a crash cut (UFC 294) he was stopped in round 1.
- Neither fight tells us much about absorbing a lightweight puncher's volume at distance: Makhachev landed 57 sig
  strikes in fight 1 and Volk was dropped by a kick, not a punch, in fight 2. Gaethje is a different problem: he
  doesn't wrestle (v2 HANDOFF: 0.30 TD per 15), so Volk's control-time weakness at 155 mostly doesn't apply, and his
  chin against a 155-lb puncher's hands is the open question.

---

## 5. Topuria KO (UFC 298) and what changed after

### 5a. The fight, round by round (dataset)

| Rd | Volk sig | Topuria sig | Volk head/body/leg | Topuria head/body/leg | Topuria dist/clinch/ground | KD |
|---|---|---|---|---|---|---|
| 1 | 26/52 | 15/38 | 8/7/**11 of 11** | 4/7/4 | 13/2/0 | 0-0 |
| 2 (3:32) | 21/55 | 20/39 | 13/4/4 | 13/5/2 | 15/2/3 | 0-1 |

- Volk won round 1 on volume (26-15) behind 11 of 11 leg kicks.
- Finish (dataset DETAILS): "Punch to Head At Distance", R2 3:32. Coverage converges on a right hand that landed
  with Volk's back against the cage, followed by a short flurry
  ([Bloody Elbow technique breakdown](https://bloodyelbow.com/2024/02/19/ufc-298-topuria-volkanovski-analysis/),
  [Uproxx](https://uproxx.com/sports/alexander-volkanovski-ilia-topuria-ufc-298-results-highlights), M). Some
  play-by-play calls it a right hook; one live blog mentions a right hand, left hook earlier in the exchange (L).
  Volk later called it "a clean right hand" caught on the chin while trapped (search summary of the same coverage, M).
- This was 119 days after the Makhachev head-kick KO.

### 5b. What changed after

- **Rest.** Right after UFC 298 he said he would "let the head rest" and keep training "clever" for a couple of
  months ([BJPenn](https://bjpenn.com/mma-news/alex-volkanovski/alexander-volkanovski-breaks-silence-after-ufc-298-loss-to-ilia-topuria-im-gonna-let-my-head-rest), M).
  He did not fight again for 420 days (dataset).
- **Regret about the quick turnaround.** He later called taking the Topuria fight soon after the Makhachev KO a
  mistake and said concussion effects left him cautious against Topuria
  ([SEN](https://sen.com.au/news/2025/07/11/volk-regret-aussie-ufc-star-admits-topuria-fight-was-a-silly-decision),
  [MiddleEasy](https://middleeasy.com/mma-news/alexander-volkanovski-opens-up-on-concussion-struggles-after-islam-makhachev-and-ilia-topuria-knockouts/), M).
  He said he went most of 2024 without a training camp and wanted to avoid another quick turnaround
  ([Sportskeeda](https://www.sportskeeda.com/mma/news-alexander-volkanovski-felt-held-hostage-training-schedule-details-return-timeline-prioritizing-rest-recovery), M).
  I found no source confirming formal therapy; his widely covered mental-health comments relate to the first
  Makhachev loss (M). Unknown beyond that.
- **Measurable changes since (dataset, UFC 314 onward vs career):**
  - Output down, accuracy up: 8.83 sig attempts per minute (career 10.51), 59.0% accuracy (career 56.9%), head
    accuracy 57.7% (career 50.6%).
  - Much more head-hunting, far fewer leg kicks: 82% of landed strikes to the head (career 66%), 13.5% to the legs
    (career 24%). Exception: 23 of 36 leg strikes landed vs Lopes in the rematch.
  - Absorbs less: 2.89 sig per minute (career 3.33).
  - Still shoots a lot, lands little: 5.0 TD attempts per 15 at 20% (1 of 11 vs Lopes in fight 1).
  - Wins: three straight title-fight wins, including the first finish since UFC 290.
  - The age-linked worry hasn't gone away: dropped by Lopes in round 2 of UFC 314 (section 7).
- **Topuria's path since:** vacated featherweight, moved to 155, and lost the lightweight title to Gaethje at UFC
  Freedom 250 (Jun 14, 2026) when his corner stopped it after four rounds (dataset; v2 HANDOFF). A Volk-Topuria
  rematch was floated by Volk as a fallback in late October 2026 (search summary, L); nothing booked.

---

## 6. UFC 314 vs Diego Lopes, Apr 12, 2025, Miami: W, UD (49-46, 49-46, 48-47)

Vacant featherweight title after Topuria vacated. Volk was 36.5. Round by round (dataset):

| Rd | Volk sig | Lopes sig | Volk head/body/leg | Lopes head/body/leg | KD | TD Volk | Ctrl Volk / Lopes |
|---|---|---|---|---|---|---|---|
| 1 | 27/44 | 8/22 | 21/2/4 | 5/1/2 | 0-0 | 1/3 | 0:58 / 0:03 |
| 2 | 24/52 | 16/33 | 18/0/6 | 15/1/0 | **0-1 (Lopes)** | 0/2 | 0:20 / 0:02 |
| 3 | 25/45 | 9/37 | 21/1/3 | 7/1/1 | 0-0 | 0/1 | 0:00 / 0:00 |
| 4 | 39/57 | 16/43 | 36/2/1 | 13/2/1 | 0-0 | 0/3 | 0:00 / 0:00 |
| 5 | 43/61 | 14/59 | 40/3/0 | 9/2/3 | 0-0 | 0/2 | 0:00 / 0:00 |
| Total | 158/259 | 63/194 | 136/8/14 | 49/7/7 | 0-1 | 1/11 | 1:18 / 0:05 |

- Knockdown: Lopes dropped him in the closing seconds of round 2 with a jab and overhand right; Volk got up quickly
  ([AOL/AP](https://aol.com/news/alexander-volkanovski-survives-knockdown-beat-060658367.html),
  [Cageside Press](https://cagesidepress.com/2025/04/13/alexander-volkanovski-becomes-two-time-champion-decisions-lopes), M).
  Lopes won round 2 on two of three cards (search summary, M).
- Afterward Volk said he "completely lost vision in my left eye" after that punch, with vision returning gradually
  ([Sportskeeda](https://www.sportskeeda.com/mma/news-alexander-volkanovski-admits-lost-vision-mid-fight-diego-lopes-blow),
  [Bloody Elbow](https://bloodyelbow.com/2025/04/13/alexander-volkanovski-reveals-frightening-moment-he-was-blinded-during-ufc-314-win), M;
  sources disagree whether it was round 2 or round 4, L). Coach Lopez said he "might have broke his hand"
  ([The Mac Life](https://themaclife.com/sports/mma/report-alexander-volkanovski-dealing-with-potential-broken-hand-following-ufc-314-title-win), M;
  whether a fracture was confirmed is unknown).
- Late surge: 82 sig landed in rounds 4-5 vs 51 in rounds 1-2, at 68% accuracy in round 4 and 70% in round 5, while
  Lopes landed 14 of 59 in round 5.

## 7. UFC 325 vs Diego Lopes, Jan 31, 2026, Sydney: W, UD (49-46, 49-46, 50-45)

Volk was 37.3. Round by round (dataset):

| Rd | Volk sig | Lopes sig | Volk head/body/leg | Lopes head/body/leg | TD Volk | TD Lopes | Ctrl Volk / Lopes | Sub att |
|---|---|---|---|---|---|---|---|---|
| 1 | 12/27 | 12/28 | 5/0/7 | 3/2/7 | 0/2 | 0/0 | 0:27 / 0:00 | 0 |
| 2 | 19/30 | 16/34 | 13/0/6 | 9/3/4 | 0/0 | 1/1 | 0:00 / 0:39 | Volk 1 |
| 3 | 21/35 | 17/38 | 21/0/0 | 8/5/4 | 0/2 | 0/0 | 0:00 / 0:00 | 0 |
| 4 | 25/44 | 22/48 | 15/2/8 | 10/7/5 | 0/0 | 0/0 | 0:00 / 0:00 | 0 |
| 5 | 21/24 | 3/10 | 18/1/2 | 3/0/0 | 2/3 | 1/4 | 2:22 / 1:11 | 0 |
| Total | 98/160 | 70/158 | 72/3/23 | 33/17/20 | 2/7 | 2/5 | 2:49 / 1:50 | Volk 1 |

- A closer fight on the feet than the cards (98-70 sig; rounds 1-4 only 77-67). Volk ate 20 leg strikes and 17
  body strikes; Lopes was the first opponent since Makhachev in 2023 to take him down more than once.
- Round 5 was Volk's most one-sided round: 21 of 24 sig, two takedowns, 2:22 control. One search summary described a
  Lopes "fifth-round rally"; the dataset contradicts that (L for the rally claim).
- Injury: coach Joe Lopez said Volk "pulled his shoulder out" about four weeks before the fight and was
  "compromised for the last four weeks with a busted shoulder"; withdrawal was discussed
  ([Bloody Elbow](https://bloodyelbow.com/2026/02/02/alexander-volkanovskis-coach-reveals-injury-compromised-ufc-325-star-ahead-of-diego-lopes-rematch/),
  [Sherdog](https://www.sherdog.com/news/news/Coach-Alexander-Volkanovski-Nearly-Withdrew-from-UFC-325-Main-Event-199989), M;
  one outlet called it a dislocation, L).

---

## 8. UFC 333 vs Movsar Evloev, Oct 24, 2026, Etihad Arena, Abu Dhabi: W, TKO R2 4:54

Featherweight title. Evloev entered 20-0 with every UFC win on the scorecards. Referee Marc Goddard. Betting was
roughly a pick'em ([RG.org](https://rg.org/research/instant-insights/ufc-333-evloevs-4-78-takedowns-per-15-minutes-test-volkanovski), M).
Volk was 38.07, the oldest featherweight title-fight winner in the dataset (featherweight title fights since 2010).

| Rd | Volk sig | Evloev sig | Volk total | Evloev total | Volk head/body/leg | Evloev head/body/leg | Volk dist/clinch/ground | Evloev dist/clinch/ground | TD Volk | TD Evloev | Ctrl Volk / Evloev |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 24/47 | 20/34 | 25/48 | 26/40 | 18/3/3 | 11/6/3 | 22/2/0 | 12/7/1 | 0/1 | **3/4** | 0:18 / 0:31 |
| 2 (4:54) | 32/63 | 20/31 | 36/70 | 36/48 | 30/0/2 | 17/2/1 | 20/1/11 | 19/1/0 | 1/1 | 0/3 | 1:26 / 0:15 |
| Total | 56/110 | 40/65 | 61/118 | 62/88 | 48/3/5 | 28/8/4 | 42/3/11 | 31/8/1 | 1/2 | 3/7 | 1:44 / 0:46 |

- **Round 1.** Evloev landed three takedowns on four attempts, the most any UFC opponent has landed on Volk in a single
  round (dataset; previous max 2), but turned them into only 31 seconds of control (dataset; outlets reported 35 s
  and 50 s, L). Volk got up each time and out-landed him 24-20; all three judges scored the round 10-9 Volk
  ([UFC Calendar](https://www.ufcalendar.com/blog/volkanovski-evloev-breakdown-ufc-333-takedowns), M). Evloev's 7 of 8
  clinch strikes were his best avenue.
- **Round 2.** Volk stuffed all three Evloev shots (underhook plus head-pushing defense, per
  [MMA Sucka](https://mmasucka.com/news/volkanovski-vs-evloev-ufc-333-grappling-breakdown/), M), landed his own
  takedown and 86 s of control, and out-landed Evloev 32-20, 30 of them to the head. Finish: with Evloev backing up
  along the cage, a flush right hand, then heavy punches from top
  ([Yahoo](https://sports.yahoo.com/articles/ufc-333-highlights-volkanovski-decimates-212044863.html), M); dataset
  DETAILS "Punches to Head From Half Guard", six seconds left in the round. No official knockdown was scored.
- **Fight-week illness.** Volk was sick (flu or chest infection by different accounts) and reportedly declined
  medication, including ibuprofen, so as not to feel he had an unfair advantage; his line: "it would've been too easy
  if I wasn't sick" ([Heavy](https://heavy.com/sports/ufc/alexander-volkanovski-reveals-illness-ufc-333/),
  [Sherdog](https://www.sherdog.com/news/news/Alexander-Volkanovski-refused-medication-before-UFC-333-title-win-203364),
  [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-had-a-chest-infection-before-ufc-333-but-refused-to-back-down/), M).
- **Records.** His ninth UFC featherweight title-fight win by dataset count (Holloway x3, Ortega, Jung, Rodriguez,
  Lopes x2, Evloev). Outlets differ on whether that passes or ties Jose Aldo
  ([Yahoo](https://sports.yahoo.com/mma/live/ufc-333-live-results-volkanovski-vs-evloev-updates-round-by-round-scoring-for-todays-title-double-header-110000274.html)
  says surpasses, M). His first finish since UFC 290 (Jul 2023).

---

## 9. Health, injuries, weight, camp

### Health and injury log (most recent first)

| When | What | Source |
|---|---|---|
| Oct 2026 (UFC 333 week) | Sick (flu or chest infection), fought without medication | Heavy, Sherdog, MMA Sucka (M) |
| Post-UFC 333 | No injury reported in the coverage I found; medical suspension unknown | unknown |
| Feb 2026 | Says he has had a long-term eye issue since UFC 314 | [Bloody Elbow, Feb 28, 2026](https://bloodyelbow.com/2026/02/28/alexander-volkanovski-reveals-long-term-eye-issue-while-defending-tom-aspinall-from-harsh-backlash/) (M) |
| Jan 2026 (UFC 325 camp) | Shoulder injury about four weeks out; withdrawal discussed | Bloody Elbow, Sherdog (M) |
| Apr 2025 (UFC 314) | Lost vision in the left eye after the R2 knockdown; possible broken hand (unconfirmed) | Sportskeeda, The Mac Life (M) |
| Oct 2023 | Head-kick KO (concussion effects he later described) | MiddleEasy (M) |
| Jul 2023 | Elbow surgery, about six weeks' recovery; his manager said it had bothered him for over a year | [BJPenn](https://bjpenn.com/mma-news/alex-volkanovski/alexander-volkanovski-has-successful-elbow-surgery-for-unbearable-injury) (M) |
| 2024 (retrospective) | Lopez said Volk fought a title fight with bone fragments in his elbow and little use of the left arm in camp | [Bloody Elbow, Nov 4, 2024](https://bloodyelbow.com/2024/11/04/coach-reveals-alexander-volkanovski-had-bits-of-broken-bone-in-his-elbow-during-his-infamous-ufc-featherweight-title-fight) (M; which fight is unclear) |
| Jul 2022 | Broken left thumb after Holloway 3, about 12 weeks | [ESPN](https://africa.espn.com/mma/story/_/id/34212032/ufc-fighter-alexander-volkanovski-broken-thumb-12-weeks) (M) |
| Dec 2019 | Broken left hand at UFC 245, surgery | [Low Kick MMA](https://www.lowkickmma.com/alexander-volkanovski-undergo-surgery-broken-hand/) (M) |

Pattern for the engine: he has fought through injuries repeatedly and still performed; there is no clean signal
that his recent injuries changed output. The eye issue and two KO losses since 2023 are the durability flags.

### Weight

- Rugby league front-rower at about 214 lb before MMA; turned pro in 2012 competing regionally at 170 lb, settled
  at 145 from about 2014 ([SI](https://www.si.com/fannation/mma/news/ufc-314-alexander-volkanovski-214-lbs-rugby-mma), M).
- Walk-around weight reported around 180-181 lb (2023 and 2025 reports:
  [Boss Hunting](https://www.bosshunting.com.au/sport/ufc/alexander-volkanovski-weight),
  [EssentiallySports](https://www.essentiallysports.com/ufc-mma-news-ufc-314-alexander-volkanovski-vs-diego-lopes-height-reach-walk-around-weight-comparison/), M).
- For UFC 294 he cut about 26.5 lb in 11 days (M). For a planned 155 fight with a full camp the cut would be about
  10 lb smaller than his featherweight cuts (inference from the reported walk-around weight, not a reported fact).
- I found no 2026 statement from him about his walk-around weight or how he'd prepare for 155 (unknown).
- Size vs Gaethje (dataset): 5 inches shorter, 1 inch more reach. Gaethje has fought his whole UFC career at 155.

### Camp and coaches

- Joe Lopez: head coach, Freestyle MMA (Australia); Volk's BJJ black belt is under him (search summary of
  Wikipedia and Tapology, M). Lopez has been the main public voice on his injuries.
- Eugene Bareman: City Kickboxing co-founder, cornered Volk at UFC 333; has compared him to Georges St-Pierre
  ([CBS Sports](https://www.cbssports.com/ufc/news/ufc-333-alexander-volkanovski-featherweight-title-history-movsar-evloev/),
  [MMA News](https://www.mmanews.com/article/alexander-volkanovskis-coach-compares-him-mma-legend), M).
- Lopez on a Gaethje fight: Volk's fight IQ "would be a little bit too much for Justin" (partisan;
  [Yahoo](https://sports.yahoo.com/articles/alex-volkanovski-coach-explains-beat-063437212.html), M).

---

## 10. Stated plans after UFC 333 and the matchmaking picture

- **Gaethje as a retirement fight.** At the UFC 333 post-fight press conference he called a Gaethje superfight
  "something I would retire for", win or lose, and said vacating afterward wouldn't hold up featherweight
  ([theScore](https://www.thescore.com/mma/news/3634621/volkanovski-eyes-gaethje-superfight-thats-something-i-would-retire-for),
  [MMA News](https://mmanews.com/article/volkanovski-would-retire-win-lose-gaethje-superfight),
  [Yardbarker](https://www.yardbarker.com/mma/articles/volkanovski_says_he_would_retire_for_gaethje_bout/s1_17349_44473025), H).
  Exact transcript wording varies by outlet (L on exact words).
- **Tsarukyan if Gaethje retires.** He offered to vacate the featherweight title to fight Arman Tsarukyan for a
  vacant lightweight title if Gaethje retires, and told Ariel Helwani that fight excites him more than Gaethje
  ([Bloody Elbow](https://bloodyelbow.com/2026/10/28/alexander-volkanovski-offers-to-vacate-title-for-more-exciting-lightweight-fight-than-justin-gaethje/),
  [DAZN](https://www.dazn.com/en-US/news/mma/alexander-volkanovski-vacate-ufc-title-arman-tsarukyan-t3r/kb4ja2ubyet01rz8qrfxfwnzp),
  [Yardbarker/MMA Fighting](https://www.yardbarker.com/mma/articles/volkanovski_offers_tsarukyan_vacant_title_fight/s1_17349_44488566), H).
  Tsarukyan has said he'd welcome it (Bloody Elbow, M).
- **Featherweight fallback.** If Gaethje keeps fighting and the superfight isn't made, he named Aljamain Sterling
  (Yardbarker, M). Sterling faces Kevin Vallejos at featherweight on Nov 21, 2026 in Qatar
  ([MMA Insight](https://mmainsight.com/news/aljamain-sterling-vs-kevin-vallejos-booked-for-ufc-fight-night-294),
  [Heavy](https://heavy.com/sports/ufc/kevin-vallejos-aljamain-sterling-ufc-qatar/), M).
- **Retirement horizon.** On The Ariel Helwani Show after UFC 333: "I'm content (with what I've done) now... But I
  want to look after my health" ([Bloody Elbow](https://bloodyelbow.com/2026/10/28/alexander-volkanovski-reveals-how-close-he-is-to-retirement-after-ufc-333/), M).
  He has said for over a year he may have two or three fights left
  ([Yahoo AU](https://au.sports.yahoo.com/alexander-volkanovski-considered-retirement-before-ufc-314-offer-may-only-have-2-or-3-fights-left-013929771.html), M).
- **UFC and Gaethje.** Dana White: "there's not much we're gonna say no to with him"
  ([Yahoo UK](https://uk.sports.yahoo.com/news/alexander-volkanovski-presses-for-justin-gaethje-retirement-fight-after-ufc-333-win-dana-white-reacts-171858455.html), M).
  On Nov 5, 2026 White said the holdup is Gaethje's decision ("what does Justin Gaethje wanna do?"); Gaethje,
  recovering from damage to both hands, said in August he wouldn't fight before 2027
  ([Bloody Elbow](https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/), M).
  No booking, no date. **Any fight is most likely 2027**, with Volk 38.3+.

---

## 11. Style tendencies (sources plus dataset evidence)

| Tendency | What sources say | Dataset evidence |
|---|---|---|
| Stance switching | Switches stance constantly; a shift step of the lead foot sets up angles and counters ([Fight Library](https://fightlibrary.wordpress.com/2023/10/08/alexander-volkanovski-and-the-shifting-of-stance/), M). Breakdowns of the Topuria and Makhachev losses say the switching sometimes gave opponents timing reads (search summary, L) | Not measured by ufcstats |
| Feints | Constant feints and stance changes overloaded Rodriguez's decision-making on kicks ([Bloody Elbow, UFC 290 technique](https://bloodyelbow.com/2023/07/13/ufc-290-technique-volkanovski/), M); feints work because the right hand behind the jab is a real threat (search summary of [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-thoughtful-aggression/) / Sherdog, M) | High attempt volume: 10.5 sig attempts per min career |
| One-two, overhand right | Overhand counter "lying in wait" for Holloway's aggression (search summary of breakdown pieces, M); v2 HANDOFF cited Sherdog for one-two as favorite combination, overhand right as best punch (not re-verified this pass) | 50.6% head accuracy career, 57.7% since 2025 |
| Low kicks | Fast, sudden kicks over power so as not to be countered; step-up inside low kick as the root of his game ([Sherdog scouting](https://www.sherdog.com/news/articles/Scouting-Report-Alexander-Volkanovski-189128), [Fight Primer](https://www.fightprimer.com/advanced-striking-20-alexander-volkanovski-inside-low-kick-footsie), M) | 78% leg-strike accuracy career; leg share 24% career but only 13.5% since 2025; opponent-dependent (75 of 93 vs Holloway 1, 50 of 59 vs Aldo, 11 of 11 in R1 vs Topuria, 23 of 36 vs Lopes 2) |
| Pressure | Closes space gradually, taking room away from kickers (Bloody Elbow UFC 290, M) | Out-landed 8 of 9 opponents since 2022 on sig strikes; finished Evloev with him backing up on the fence |
| Level changes, wrestling | Takedown threat and fast get-ups make grappling a poor route against him (Sherdog scouting, M) | 4.75 TD attempts per 15 career, 34% success; 20% since 2024; 7 of 12 vs Rodriguez; 109 s control per TD landed |
| Top game and finishing | | 4 of his 6 UFC KO/TKO wins came from ground strikes (Kasuya, Kennedy, Rodriguez, Evloev); only Mendes and Jung were finished standing; 0.19 sub attempts per 15, no UFC submission wins |
| Fence work | Topuria caught him with his back on the cage; v2 HANDOFF (Sherdog, MMA Sucka) said he leans away in the pocket, especially on the fence (not re-verified) | Clinch is a small share of his offense (8% career, 4% since 2025) |
| Defense | "Immensely hard to hit" (Sherdog scouting, M) | 58% strike defense; opponents land 33% of head strikes on him (55.7% for Makhachev); 2.02 head strikes absorbed per min, 0.80 body, 0.52 leg |
| Late-fight strength | UFC.com cited about 7.5 sig strikes per min in fifth rounds before UFC 298 (v2 HANDOFF) | Confirmed and updated in section 13: 7.20 per min across all seven fifth rounds through UFC 325 |
| Power | Analysts call lack of power his real disadvantage at 155 ([theScore](https://www.thescore.com/mma/news/2338015), M) | 0.49 KDs per 100 head strikes landed career vs 0.88 featherweight and 0.84 lightweight league averages; no knockdowns scored in his last four fights (277 head strikes landed) |

---

## 12. Chin and durability

### 12a. Every knockdown he has absorbed in the UFC (dataset rounds, strike from DETAILS and coverage)

| # | Date, event | Opponent | Rd | Strike and position | What followed | Sources |
|---|---|---|---|---|---|---|
| 1 | 2018-12-29, UFC 232 | Chad Mendes | 2 | Left hook at distance (Mendes's R2: 10 of 20 at distance, 3 of 4 in clinch, 9 of 20 head) | Recovered, dropped Mendes about 20 s later, won by TKO (punches at distance) at 4:14 | [Bloody Elbow](https://bloodyelbow.com/2025/04/08/alexander-volkanovski-koed-iconic-conor-mcgregor-rival-faster-than-notorious-did), [Quebrada](https://quebrada.net/reviews/best201812.html) (M); one Sherdog account places a knockdown in round 1 (L); dataset records it in round 2 |
| 2 | 2023-10-21, UFC 294 | Islam Makhachev | 1 | Left head kick at distance after a clinch break ("Kick to Head At Distance") | Finished by ground punches, 3:06 | Dataset; Yahoo, Fighters Only (M) |
| 3 | 2024-02-17, UFC 298 | Ilia Topuria | 2 | Right hand with his back near the cage ("Punch to Head At Distance") | Finished by follow-up punches, 3:32 | Dataset; Bloody Elbow, Uproxx (M) |
| 4 | 2025-04-12, UFC 314 | Diego Lopes | 2 | Jab, overhand right at distance, closing seconds (Lopes's R2: 15 of 32 head, all at distance) | Up quickly, bell; lost vision in left eye; won the fight | Dataset; AOL/AP, Cageside Press (M) |

### 12b. Rates

| Window | Head strikes absorbed | KDs absorbed | KDs per 100 head strikes absorbed |
|---|---|---|---|
| UFC career | 632 | 4 | 0.63 |
| Since 2022 | 284 | 3 | 1.06 |
| Since 2023 | 189 | 3 | 1.59 |
| Since UFC 314 KD (Lopes 2 + Evloev) | 61 | 0 | 0 |
| League, featherweight 2015+ (attacker side) | 38,661 landed | | 0.88 |
| League, featherweight 2022+ | | | 1.01 |
| League, lightweight 2022+ | | | 0.99 |
| League, defenders aged 38-40 (all divisions, 2010+) | 13,237 | 135 | 1.02 |

Reading: over his career he has been harder to drop than average (0.63 vs about 0.85-0.9), mostly because he was
almost never dropped from 2016 through 2022 (one knockdown in 12 UFC fights). Since 2023 he has been dropped three
times in 189 head strikes absorbed, 1.6 per 100, above the league rate for his age group. Two of those came from
lightweight-sized or bigger strikers (Makhachev at 155, Topuria who now fights at 155), and the third from Lopes,
a featherweight with knockout power. The small sample (3 events) makes the recent rate very noisy: a 95% Poisson
interval on 3 events is roughly 0.3 to 4.6 per 100.

Both KO losses came in consecutive fights, 119 days apart (Oct 2023, Feb 2024), the second after a short turnaround
he later regretted. He has not been finished in the 32 months since; he was dropped once in that time.

Heaviest rounds absorbed: 37 sig strikes (Holloway, UFC 245 R4, 2019); in his last three fights his worst round was
22 (Lopes, UFC 325 R4).

---

## 13. Late-round output in five-round fights (dataset)

12 five-round UFC fights (UFC 245 onward). Two views: fights that reached round 5 (seven fights, all went to
decision, all rounds full five minutes) and all rounds including partial finishing rounds.

### 13a. Fights that reached round 5 (Holloway 1-3, Ortega, Makhachev 1, Lopes 1-2)

| Round | Minutes | Volk landed / min | Volk attempted / min | Volk accuracy | Opp landed / min | Opp accuracy | Volk ctrl / min (s) |
|---|---|---|---|---|---|---|---|
| 1 | 35 | 4.40 | 8.89 | 49.5% | 3.09 | 41.5% | 2.8 |
| 2 | 35 | 5.34 | 10.00 | 53.4% | 4.11 | 43.8% | 2.8 |
| 3 | 35 | 6.31 | 11.57 | 54.6% | 3.49 | 39.7% | 4.8 |
| 4 | 35 | 6.26 | 10.86 | 57.6% | 4.00 | 45.2% | 5.8 |
| 5 | 35 | **7.20** | 11.89 | **60.6%** | 3.63 | **36.6%** | 9.5 |

Ratio to round 1: **1.00, 1.21, 1.43, 1.42, 1.64**.

Per fight, sig landed by round:

| Fight | R1 | R2 | R3 | R4 | R5 | (R4+R5)/(R1+R2) |
|---|---|---|---|---|---|---|
| UFC 245 Holloway 1 | 27 | 28 | 35 | 36 | 31 | 1.22 |
| UFC 251 Holloway 2 | 19 | 22 | 25 | 34 | 37 | 1.73 |
| UFC 266 Ortega | 30 | 38 | 61 | 35 | 50 | 1.25 |
| UFC 276 Holloway 3 | 28 | 37 | 40 | 44 | 50 | 1.45 |
| UFC 284 Makhachev 1 | 11 | 19 | 14 | 6 | 20 | 0.87 |
| UFC 314 Lopes 1 | 27 | 24 | 25 | 39 | 43 | 1.61 |
| UFC 325 Lopes 2 | 12 | 19 | 21 | 25 | 21 | 1.48 |
| **Pooled** | | | | | | **1.38** |

### 13b. League comparison (same selection: 5-round decisions since 2015, 474 fighter-rounds per round)

| Round | League landed / min | Ratio to R1 | League accuracy |
|---|---|---|---|
| 1 | 3.22 | 1.00 | 44.2% |
| 2 | 3.91 | 1.22 | 45.6% |
| 3 | 3.99 | 1.24 | 45.9% |
| 4 | 4.16 | 1.29 | 46.4% |
| 5 | 4.22 | 1.31 | 46.1% |

League pooled (R4+R5)/(R1+R2) = 1.17. **Volkanovski's late lift is about 18% above the league curve over rounds 4-5
(1.38 vs 1.17) and 25% above it in round 5 alone (1.64 vs 1.31).** Rising output in later rounds is normal in
five-round decisions (round 1 is a feeling-out round); what is unusual is the size of his rise and that his accuracy
climbs and his opponents' accuracy falls at the same time.

### 13c. Other cuts

- All 12 five-round fights, all rounds including partial finishing rounds: 4.41 (58.1 min), 5.48 (53.4), 7.11
  (44.3), 6.38 (35.8), 7.20 (35.0) landed per minute for rounds 1-5.
- Completed rounds only, excluding the Makhachev fights: 4.82, 5.53, 7.54, 7.10, 7.73.
- Still true at 36-37: Lopes 1 went 27, 24, 25, 39, 43; Lopes 2 went 12, 19, 21, 25, 21 (round 5 was 21 of 24 with
  2:22 of control).
- The one exception is the control-heavy Makhachev fight (ratio 0.87), where round 4 was spent under 3:25 of control.
- Caveats: seven fights; selection on fights that went the distance; round 3 is inflated by Ortega (61 landed);
  opponents' fatigue is mixed in with his own pace.

---

## 14. Engine notes (what v3 should take from this)

- Use the **post-2025 strike profile** with decay, not the career one: lower attempt rate (8.8/min), higher accuracy
  (59%), head-heavy targeting (82%), less leg kicking (13.5%), low power (0 KDs in 4 fights). The career profile
  overstates his leg-kick volume and understates his head accuracy.
- **Power is a weakness to model honestly:** 0.49 KDs per 100 head strikes landed career (about 55% of league).
  His finishes come from ground strikes after takedowns or a hurt opponent, not one-punch knockdowns.
- **Chin:** career 0.63 per 100 (better than league) vs recent 1.59 per 100 (worse). With a 300-head-strike prior and
  2-year half-life the shrunk estimate lands near league average; then apply the age term (x1.37 at 38 vs 30) and the
  size term for a featherweight at 155. Two KO losses since Oct 2023.
- **Cardio/pace:** strongest late-round lift in the dataset's top-tier sample; pace ratio 1.00/1.21/1.43/1.42/1.64 vs
  league 1.00/1.22/1.24/1.29/1.31.
- **Grappling vs Gaethje:** Volk's offensive wrestling (5 attempts per 15, 20% recent success, 88-109 s control per
  TD) is a live scoring path; his control-conceded weakness at 155 (Makhachev: 119 s per TD) mostly won't matter
  against a non-wrestler.
- **Leg-kick defense matters:** he absorbs 0.52 leg strikes per minute career, and Lopes landed 20 leg strikes in
  the rematch; Gaethje is a heavy leg kicker (v2 HANDOFF: 28% of his landed strikes to the legs).

## 15. Corrections to the v2 HANDOFF

- Reach: ufcstats lists 71", not 71.5" (UFC.com's figure).
- Evloev's round-1 control: 31 s in the dataset (46 s for the fight), not 35 s.
- "About 7.5 sig strikes a minute in fifth rounds" was correct through UFC 290 (188 landed in five fifth rounds);
  with Lopes 1 and 2 it is 7.20 (252 in seven fifth rounds).
- Volkanovski has three UFC fights at lightweight (1-2), not two: his 2016 debut vs Kasuya was at 155.
- Takedown defense through UFC 333 is 67.3% by dataset count (35 of 52); previews quoted 68.9%.

## 16. Open questions

- Gaethje's decision and timing (hands; said no fight before 2027). Any booking changes every age input.
- Volk's post-UFC 333 medical suspension and whether the eye issue has been formally assessed (unknown).
- Volk's planned weight management for 155 with a full camp (no 2026 statement found).
- Exact strike mechanics of the Makhachev head kick and the Mendes knockdown round (sources conflict; video needed).
- Whether the post-2025 drop in leg-kick usage is a choice or a constraint (hand, shoulder or eye issues).

---

## Sources

Dataset: `data/raw/` ufcstats snapshot (ufc_event_details, ufc_fight_results, ufc_fight_stats, ufc_fighter_tott),
through Oct 31, 2026, from github.com/Greco1899/scrape_ufc_stats.

Web (accessed Nov 6, 2026; claims taken from search-result summaries where direct fetches were blocked):

- https://www.news4jax.com/sports/2026/10/24/alexander-volkanovski-stops-movsar-evloev-in-2nd-round-to-retain-featherweight-title-at-ufc-333/
- https://abcnews.com/amp/Sports/wireStory/alexander-volkanovski-stops-movsar-evloev-2nd-round-retain-137543714
- https://sports.yahoo.com/mma/live/ufc-333-live-results-volkanovski-vs-evloev-updates-round-by-round-scoring-for-todays-title-double-header-110000274.html
- https://sports.yahoo.com/articles/ufc-333-highlights-volkanovski-decimates-212044863.html
- https://www.ufcalendar.com/blog/volkanovski-evloev-breakdown-ufc-333-takedowns
- https://www.ufcalendar.com/blog/volkanovski-evloev-how-volkanovski-wins-ufc-333
- https://mmasucka.com/news/volkanovski-vs-evloev-ufc-333-grappling-breakdown/
- https://rg.org/research/instant-insights/ufc-333-evloevs-4-78-takedowns-per-15-minutes-test-volkanovski
- https://heavy.com/sports/ufc/alexander-volkanovski-reveals-illness-ufc-333/
- https://www.sherdog.com/news/news/Alexander-Volkanovski-refused-medication-before-UFC-333-title-win-203364
- https://mmasucka.com/news/alexander-volkanovski-had-a-chest-infection-before-ufc-333-but-refused-to-back-down/
- https://www.thescore.com/mma/news/3634621/volkanovski-eyes-gaethje-superfight-thats-something-i-would-retire-for
- https://mmanews.com/article/volkanovski-would-retire-win-lose-gaethje-superfight
- https://www.yardbarker.com/mma/articles/volkanovski_says_he_would_retire_for_gaethje_bout/s1_17349_44473025
- https://www.yardbarker.com/mma/articles/volkanovski_offers_tsarukyan_vacant_title_fight/s1_17349_44488566
- https://bloodyelbow.com/2026/10/28/alexander-volkanovski-offers-to-vacate-title-for-more-exciting-lightweight-fight-than-justin-gaethje/
- https://www.dazn.com/en-US/news/mma/alexander-volkanovski-vacate-ufc-title-arman-tsarukyan-t3r/kb4ja2ubyet01rz8qrfxfwnzp
- https://bloodyelbow.com/2026/10/28/alexander-volkanovski-reveals-how-close-he-is-to-retirement-after-ufc-333/
- https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/
- https://uk.sports.yahoo.com/news/alexander-volkanovski-presses-for-justin-gaethje-retirement-fight-after-ufc-333-win-dana-white-reacts-171858455.html
- https://au.sports.yahoo.com/alexander-volkanovski-considered-retirement-before-ufc-314-offer-may-only-have-2-or-3-fights-left-013929771.html
- https://mmainsight.com/news/aljamain-sterling-vs-kevin-vallejos-booked-for-ufc-fight-night-294
- https://heavy.com/sports/ufc/kevin-vallejos-aljamain-sterling-ufc-qatar/
- https://www.cbssports.com/ufc/news/ufc-333-alexander-volkanovski-featherweight-title-history-movsar-evloev/
- https://www.tapology.com/fightcenter/fighters/41705-alex-volkanski
- https://www.mmanews.com/article/alexander-volkanovskis-coach-compares-him-mma-legend
- https://sports.yahoo.com/articles/alex-volkanovski-coach-explains-beat-063437212.html
- https://bloodyelbow.com/2026/02/02/alexander-volkanovskis-coach-reveals-injury-compromised-ufc-325-star-ahead-of-diego-lopes-rematch/
- https://www.sherdog.com/news/news/Coach-Alexander-Volkanovski-Nearly-Withdrew-from-UFC-325-Main-Event-199989
- https://bloodyelbow.com/2026/02/28/alexander-volkanovski-reveals-long-term-eye-issue-while-defending-tom-aspinall-from-harsh-backlash/
- https://aol.com/news/alexander-volkanovski-survives-knockdown-beat-060658367.html
- https://cagesidepress.com/2025/04/13/alexander-volkanovski-becomes-two-time-champion-decisions-lopes
- https://www.sportskeeda.com/mma/news-alexander-volkanovski-admits-lost-vision-mid-fight-diego-lopes-blow
- https://bloodyelbow.com/2025/04/13/alexander-volkanovski-reveals-frightening-moment-he-was-blinded-during-ufc-314-win
- https://themaclife.com/sports/mma/report-alexander-volkanovski-dealing-with-potential-broken-hand-following-ufc-314-title-win
- https://bjpenn.com/mma-news/alex-volkanovski/alexander-volkanovski-breaks-silence-after-ufc-298-loss-to-ilia-topuria-im-gonna-let-my-head-rest
- https://sen.com.au/news/2025/07/11/volk-regret-aussie-ufc-star-admits-topuria-fight-was-a-silly-decision
- https://middleeasy.com/mma-news/alexander-volkanovski-opens-up-on-concussion-struggles-after-islam-makhachev-and-ilia-topuria-knockouts/
- https://www.sportskeeda.com/mma/news-alexander-volkanovski-felt-held-hostage-training-schedule-details-return-timeline-prioritizing-rest-recovery
- https://bloodyelbow.com/2024/02/19/ufc-298-topuria-volkanovski-analysis/
- https://uproxx.com/sports/alexander-volkanovski-ilia-topuria-ufc-298-results-highlights
- https://www.ufc.com/news/official-judges-scorecards-ufc-284-makhachev-vs-volkanovski
- https://lowkickmma.com/islam-makhachev-volkanovski-ufc-284
- https://www.cbssports.com/mma/news/ufc-294-live-results-islam-makhachev-vs-alexander-volkanovski-updates-highlights-fight-card-start-time/live
- https://sports.yahoo.com/ufc-294-results-islam-makhachev-203045147.html
- https://www.fightersonlymag.com/latest-news/ufc-294-islam-makhachev-stuns-alexander-volkanovski-with-a-head-kick-ko/
- https://www.espn.com/mma/story/_/id/38681266/
- https://www.bosshunting.com.au/sport/ufc/alexander-volkanovski-weight
- https://www.essentiallysports.com/ufc-mma-news-ufc-314-alexander-volkanovski-vs-diego-lopes-height-reach-walk-around-weight-comparison/
- https://www.si.com/fannation/mma/news/ufc-314-alexander-volkanovski-214-lbs-rugby-mma
- https://bjpenn.com/mma-news/alex-volkanovski/alexander-volkanovski-has-successful-elbow-surgery-for-unbearable-injury
- https://bloodyelbow.com/2024/11/04/coach-reveals-alexander-volkanovski-had-bits-of-broken-bone-in-his-elbow-during-his-infamous-ufc-featherweight-title-fight
- https://africa.espn.com/mma/story/_/id/34212032/ufc-fighter-alexander-volkanovski-broken-thumb-12-weeks
- https://www.lowkickmma.com/alexander-volkanovski-undergo-surgery-broken-hand/
- https://bloodyelbow.com/2025/04/08/alexander-volkanovski-koed-iconic-conor-mcgregor-rival-faster-than-notorious-did
- https://quebrada.net/reviews/best201812.html
- https://bloodyelbow.com/2023/07/13/ufc-290-technique-volkanovski/
- https://mmasucka.com/news/alexander-volkanovski-thoughtful-aggression/
- https://www.sherdog.com/news/articles/Scouting-Report-Alexander-Volkanovski-189128
- https://www.fightprimer.com/advanced-striking-20-alexander-volkanovski-inside-low-kick-footsie
- https://fightlibrary.wordpress.com/2023/10/08/alexander-volkanovski-and-the-shifting-of-stance/
- https://www.thescore.com/mma/news/2338015
- https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed
- https://agentmma.com/mma-lab/ufc-fighter-peak-age
- https://bloodyelbow.com/2013/07/18/ufc-going-deeper-into-mma-fighter-longevity-does-age-matter/
