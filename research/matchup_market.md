# Volkanovski vs Gaethje: matchup status, market, ratings, history

Research pass for engine v3, as of Friday, Nov 6, 2026. Fighters' pronouns are he/him.

## How this was researched, and its limits

- **Stats come from the dataset** (`data/raw/`, ufcstats.com via Greco1899/scrape_ufc_stats, through
  Oct 31, 2026). Every fight stat below was pulled from it with scripts. Treat those numbers as high
  confidence unless ufcstats itself is wrong.
- **News, quotes, rankings and odds come from web search.** WebFetch could not reach any outlet in this
  session (bloodyelbow.com, mmamania.com and fightbookmma.com failed DNS, and the proxy refused
  sherdog.com and combat-edge.com). So every web claim rests on search-result titles and snippets, not
  on full articles I read. Quotes are given as the outlets printed them in those snippets, so check
  them against the articles before anyone quotes them on the page.
- **The search budget ran out partway through** (the 200-call limit is shared by all agents in this
  run). I did not finish these: FightMatrix ranks, Combat Edge's current ratings, named analyst picks,
  Kalshi or Polymarket markets, sharp-book lines (Pinnacle, Circa), and José Aldo's history before the
  UFC. They are marked **unknown** below. A follow-up message can continue the search.
- Confidence tags: **high** (dataset, or several outlets agree and the claim is simple), **medium**
  (one or two outlets, or a snippet summary), **low** (one snippet, ambiguous, or inferred).

---

## 1. Bottom line for the engine

1. **Not booked.** As of Nov 6, 2026 nobody has set a date, venue or contract. Volkanovski wants the
   fight. Dana White says he will do almost anything for Volk, but the decision is Gaethje's. Gaethje
   hasn't spoken in public about it. In late August he said both hands were still hurt and he
   wouldn't fight in 2026. He was weighing retirement. His later September interviews, cited in
   `research/gaethje.md` and not re-checked in the verification pass, say he hadn't decided. They
   also say that if he fights again, he wants Tsarukyan. *(medium-high; see Verification log)*
2. **Market: Gaethje about 63%, Volkanovski about 37%** with the margin removed. There are four
   early prices from three sources, posted Oct 24–25, 2026 (Lucky Rebel's date is unknown):
   Gaethje -180 to -200, Volk +155 to +170. FightOdds.io is an odds site, not a sportsbook, and
   which book its opener came from is unknown. The +157 row is BetOnline's line as one outlet
   printed it, not a separate book. Every no-vig method puts Volk between 34.9% and 37.9%. *(medium:
   these rest on search snippets, which the verification pass could not re-read)*
3. **Ratings lean Volk before any size adjustment.** Combat Edge Elo: Volk 1879, Gaethje 1869 (v2
   research, not re-checked this pass), which is about 51% Volk. A UFC-only Elo I built on the
   dataset has Volk 1682 and Gaethje 1621, about 59% Volk. That Elo is weak, though: its favorite won
   55.6% of 3,644 fights since 2010. So the market prices about **0.57 log-odds** against Volk on top of
   Combat Edge's Elo. That gap is the market's size, age and style tax.
4. **Size tax: weak in the data overall, real but noisy at the top.** In 383 men's fights where a
   fighter moved up one class to face a home fighter of that class, the move cost nothing measurable
   once Elo is controlled for: +0.03 log-odds, se 0.10. Featherweight to lightweight alone is +0.14,
   se 0.24, n=74. Featherweight champions at 155 against elite lightweights went **4-8, where Elo
   expected 6.3 wins**. Their significant-strike differential fell by about 1.4 per minute, weighted
   by minutes, compared with their featherweight careers. Volk's 0-2 against Makhachev is part of that
   record.
5. **Common opponents split.** Holloway favors Volk: Volk went 3-0 and out-landed him by 1.73 a
   minute over 75 minutes. Gaethje was out-landed by 3.12 a minute and knocked out with one second
   left. Topuria favors Gaethje: Topuria KO'd Volk in 2024, and Gaethje beat Topuria by corner stoppage
   in 2026. But Topuria out-landed Gaethje 97-91 and scored the only knockdown. Makhachev is
   Volk-only. Through shared opponents (Poirier, Oliveira) it reads about neutral.

---

## 2. Is the fight booked? Timeline of statements

| Date (2026) | Who | What was said or reported | Source | Conf. |
|---|---|---|---|---|
| Before UFC 333 (Oct 24) | Volkanovski | Pitched a superfight with Gaethje: "That's something I would retire for." *Verification note: `research/volkanovski.md` and `research/gaethje.md` place this line at the UFC 333 post-fight press conference ([theScore](https://www.thescore.com/mma/news/3634621/volkanovski-eyes-gaethje-superfight-thats-something-i-would-retire-for)). The pre-fight pitch itself is supported by MMAmania's "after UFC 333" headline in the next row. When the quote was said is unverified* | [Yahoo](https://sports.yahoo.com/articles/alexander-volkanovski-wants-superfight-justin-150000227.html), [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-justin-gaethje-ufc-333-superfight-retirement/) | high (pitch), low (quote timing) |
| Before UFC 333 | Dana White | Open to it: "it's hard to say no to a guy like that" | [MMAmania](https://www.mmamania.com/ufc-news/481203/dana-white-open-to-alexander-volkanovskis-proposed-gaethje-superfight-after-ufc-333-its-hard-to-say-no-to-a-guy-like-that) | high |
| Oct 24 (UFC 333, Abu Dhabi) | Volkanovski | Beat Evloev by TKO at 4:54 of round 2, then called for Gaethje again as a "double retirement" fight: win or lose, he retires. Said he was ill that week (flu or chest infection) and refused all medication | [Yahoo](https://sports.yahoo.com/articles/alexander-volkanovski-insists-lightweight-title-170100012.html), [Athlon](https://athlonsports.com/mma/ufc-333-alexander-volkanovski-illness-michael-jordan-flu-game-justin-gaethje-last-dance), [Heavy](https://heavy.com/sports/ufc/alexander-volkanovski-reveals-illness-ufc-333/), [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-had-a-chest-infection-before-ufc-333-but-refused-to-back-down/); result in dataset | high (result), medium (illness details) |
| Oct 24 (post-fight press conference) | Dana White | Called Volk an "absolute stud" and "built different"; "there's not much we're gonna say no to with him." No dates, no contracts | [MMAmania](https://www.mmamania.com/ufc-333-fight-card-start-time-live-stream-volkanovski-vs-evloev/481925/dana-white-reacts-to-absolute-stud-alexander-volkanovskis-ufc-333-win-just-f-king-built-different), [Yahoo](https://sports.yahoo.com/mma/article/alexander-volkanovski-presses-for-justin-gaethje-retirement-fight-after-ufc-333-win-dana-white-reacts-171858455.html), [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-justin-gaethje-superfight-dana-white-ufc-333/) | high |
| Oct 24 (21:10 UTC) | FightOdds.io | Posted opening odds: Volk +170, Gaethje -200 (see section 5) | [X post](https://x.com/FightOdds_io/status/2114102147243450379) | high |
| Oct 26 | Tsarukyan | Open to fighting Volk for the title; expects Gaethje's decision soon | [Bloody Elbow](https://bloodyelbow.com/2026/10/26/arman-tsarukyan-open-to-alexander-volkanovski-title-fight-as-he-expects-justin-gaethje-decision-soon/) | medium |
| About Oct 27–28 | Chael Sonnen (analyst) | Called the double-retirement fight "one of the dumbest ideas I've ever heard": "Who does that help? Why would anybody book that fight?" | [F4W](https://www.f4wonline.com/news/ufc/chael-sonnen-alexander-volkanovski-justin-gaethje-ufc-superfight-dumb-idea/), [BJPenn.com](https://www.bjpenn.com/mma-news/ufc/justin-gaethje-vs-alexander-volkanovski-is-one-of-the-dumbest-ideas-ive-ever-heard-says-ufc-analyst/), [Sportskeeda](https://www.sportskeeda.com/mma/news-who-help-chael-sonnen-slams-alexander-volkanovski-s-desire-fight-justin-gaethje-lightweight) | high |
| About Oct 28 ("Wednesday" after UFC 333, per the snippet) | Volkanovski | Told MMA Fighting he'd fight Tsarukyan for a vacant belt if Gaethje won't fight him. Said Tsarukyan has earned first claim to a title shot, and "you ain't holding me down." Would at least vacate the 145 belt if either fight happens | [MMAmania](https://www.mmamania.com/ufc-news/482335/alex-volkanovski-says-hell-fight-arman-tsarukyan-if-justin-gaethje-wont), [Yardbarker](https://www.yardbarker.com/mma/articles/volkanovski_offers_tsarukyan_vacant_title_fight/s1_17349_44488566), [MMA Sucka](https://mmasucka.com/news/you-aint-holding-me-down-alexander-volkanovski-welcomes-arman-tsarukyans-wrestling-in-bold-lightweig/), [Sherdog](https://www.sherdog.com/news/news/Alexander-Volkanovski-open-to-fighting-Arman-Tsarukyan-for-UFC-gold-203404) | medium (exact date inferred) |
| Late Oct | Tsarukyan | Would fight Volk, whom he called "old" with a "bad chin." Said Gaethje is ducking him and the UFC will tell him what's next by the end of November | [MMA Sucka](https://mmasucka.com/news/volkanovski-vs-tsarukyan-ufc-lightweight-wrestling-feud-makhachev/), search snippets summarizing [Boxing News](https://boxingnews.com/news/white-gaethje-decision-volkanovski-fight) | medium |
| Late Oct | Marcos da Matta (Tsarukyan's coach) | Welcomes a Volk title fight; if Gaethje defends, Arman is the No. 1 contender who most deserves the shot | [Sherdog](https://www.sherdog.com/news/news/Arman-Tsarukyans-coach-welcomes-Alexander-Volkanovski-UFC-title-fight-203447), [Yahoo](https://sports.yahoo.com/articles/arman-tsarukyans-coach-welcomes-alexander-191208024.html) | medium |
| Late Oct | Renato Moicano | Would rather see Volk vs Gaethje: "I would rather watch Volk than Arman, to be completely honest" | [Heavy](https://heavy.com/sports/ufc/gaethje-vs-volkanovski-instead-of-tsarukyan/), [Boxing News](https://boxingnews.com/news/moicano-tsarukyan-volkanovski-gaethje-ufc) | medium |
| Oct 29 | Jean Silva / Volk's coach | Volk's head coach said Silva doesn't deserve a title shot and wants Volk vs the Sterling–Vallejos winner. Silva fired back; he wants Volk to stay at 145 and believes Gaethje won't retire | [Bloody Elbow](https://bloodyelbow.com/2026/10/29/jean-silva-fires-back-at-alexander-volkanovskis-coach-who-said-he-doesnt-deserve-title-shot/), [MMA Sucka](https://mmasucka.com/news/jean-silva-doesnt-want-alexander-volkanovski-to-move-up-believes-justin-gaethje-wont-retire/) | medium |
| About Oct 30 | Insider report | UFC still plans Volk vs Jean Silva or the Vallejos–Sterling winner. UFC is also working on Gaethje vs Tsarukyan | [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-vs-justin-gaethje-possibility-appears-to-have-disappeared-amidst-talks-about-j/) | low–medium (unnamed insider) |
| Reported Nov 5 (Jim Rome Show) | Dana White | Would "pretty much do anything" for Volk. On Gaethje: "He's gonna have to pull the trigger one way or the other, see if he wants to retire or continue to fight." "We're talking to him, but we'll figure it out." Backed a 2027 date | [Bloody Elbow, Nov 5](https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/), [Cageside Press, Nov 5](https://cagesidepress.com/2026/11/05/white-open-volk-gaethje-waiting-lightweight-champs/), [BJPenn.com](https://www.bjpenn.com/mma-news/ufc/dana-white-presses-justin-gaethje-pull-trigger-alexander-volkanovski/), [Heavy](https://heavy.com/sports/ufc/dana-white-alex-volkanovski-justin-gaethje/), [NY Fights](https://nyfights.com/featured/alexander-volkanovski-justin-gaethje-ufc-2/) | high (gist), medium (exact wording) |
| Early Nov | Dana White (headline) | "Golf or UFC? Justin Gaethje must 'decide what he's gonna do'" | [Yahoo](https://sports.yahoo.com/articles/golf-ufc-justin-gaethje-must-122856281.html), [Yardbarker](https://www.yardbarker.com/mma/articles/gaethje_must_decide_between_golf_and_ufc/s1_17349_44519048) | medium |

**Gaethje's side.** His most widely re-reported update was a late-August 2026 SI interview, but it
was not his last. `research/gaethje.md` cites later interviews (not re-checked in the verification
pass). In mid-September he ruled out the rest of 2026, citing a knee bone bruise
([AgentMMA](https://agentmma.com/news/90201-justin-gaethje-rules-out-fighting-for-remainder-of-2026-due-to-injuries)).
In a September interview with Andrew Schulz he said that if he fights again it will be Tsarukyan, that he
hasn't decided, and "I want to keep my faculties"
([MMAmania](https://www.mmamania.com/latest-news/474425/justin-gaethje-weighs-retirement-ahead-of-possible-arman-tsarukyan-title-defense-i-want-to-keep-my-faculties)).
*(medium)* Both came before Volk's Oct 24 callout. In the August interview he said: "I still can't
punch anything." Both hands were still hurt from the Topuria fight. He ruled out fighting in 2026 and pointed to 2027 if he doesn't retire. He said he'd put the pros and
cons on paper and decide with his family: "This has never been about money for me. It's about
health… I want kids." He also mentioned revenge fights with Oliveira and Holloway. *(medium-high:
[Bloody Elbow, Aug 29](https://bloodyelbow.com/2026/08/29/justin-gaethje-still-cant-punch-over-two-months-after-damaging-his-hands-on-ilia-topurias-face/),
[Yahoo](https://sports.yahoo.com/articles/justin-gaethje-reveals-ongoing-hand-055830458.html),
[Athlon](https://athlonsports.com/mma/justin-gaethje-injury-ufc-white-house-fight-ilia-topuria),
[BJPenn.com](https://www.bjpenn.com/mma-news/ufc/justin-gaethje-remains-sidelined-until-2027-amid-injury-update-both-of-my-hands-are-still-hurt/))*.
After the Topuria fight he got a medical suspension of up to 180 days, pending MRIs on his right
wrist and left knee. *(medium:
[The Mac Life](https://themaclife.com/sports/mma/gaethje-handed-medical-suspension-after-title-win/), from v2)*.
Sources disagree on who issued it. v2 said the CSAC. `research/gaethje.md` cites
[F4W](https://www.f4wonline.com/news/ufc/ufc-freedom-250-medical-suspensions/): the list came from
the ABC and CSAC's Andy Foster shared it. *(low on the issuer)*
I found no statement from Gaethje or his team responding to the Volk proposal. **Unknown** whether
his team has replied in private. White says talks are ongoing.

**Booking odds: unknown.** I found no prop or prediction market on whether the fight happens.

---

## 3. Lightweight picture

| Item | Status as of Nov 6, 2026 | Source | Conf. |
|---|---|---|---|
| Champion | **Justin Gaethje.** Won the interim title over Pimblett at UFC 324 (Jan 24, 2026; UD 48-47, 49-46, 49-46). Became undisputed when Topuria's corner stopped the fight after round 4 at UFC Freedom 250 (Jun 14, 2026, White House South Lawn). No defense scheduled | dataset; [Al Jazeera](https://www.aljazeera.com/sports/2026/6/11/ilia-topuria-vs-justin-gaethje-title-fight-at-ufc-freedom-250-all-to-know) | high |
| Media-panel top 5 (Nov 3, 2026) | 1 Ilia Topuria, 2 Arman Tsarukyan, 3 Charles Oliveira, 4 Max Holloway, 5 Paddy Pimblett. Ruffy is No. 10. The Meta algorithmic rankings (introduced June 2026) have the same top five per UFCalendar | [UFCalendar](https://www.ufcalendar.com/rankings/lightweight), [ufcrankings.org](https://ufcrankings.org/), [Home of Fight](https://www.homeoffight.com/ufc-rankings) | medium (aggregators, not ufc.com) |
| Tapology (its own system) | Gaethje 1, Topuria 2, Oliveira 3, Tsarukyan 4 or 5 | [Tapology](https://www.tapology.com/rankings/ufc/ultimate-fighting-championship-mens-lightweight-155-pounds) | low |
| Tsarukyan | 6 straight UFC wins per the dataset, most recently Hooker (arm-triangle, R2 3:34, Nov 22, 2025) and Ruffy (elbow in the clinch, R1 4:56, UFC 331, Sep 19, 2026). Wants the title shot, says Gaethje is ducking him, expects word by the end of November | dataset; [Bloody Elbow](https://bloodyelbow.com/2026/10/26/arman-tsarukyan-open-to-alexander-volkanovski-title-fight-as-he-expects-justin-gaethje-decision-soon/) | high (fights), medium (claims) |
| Topuria | Lost the title to Gaethje by corner stoppage after R4. Reported 180-day medical suspension; wants a rematch; no fight announced. One snippet says he lost vision in both eyes by round 4 | [Yahoo](https://sports.yahoo.com/articles/ilia-topuria-handed-6-month-220016561.html), [next-fight.com](https://next-fight.com/en/fighter/ilia-topuria) | medium (suspension), low (vision detail) |
| Makhachev | **Welterweight champion, not at 155.** Beat Della Maddalena (UD 50-45 x3, UFC 322, Nov 15, 2025) and Machado Garry (UD 49-46, 49-46, 48-47, UFC 330, Aug 15, 2026). Next is expected to be the winner of Prates vs Morales for the interim welterweight title (UFC 336, Toronto, Jan 30, 2027), probably mid-2027. Said Oct 31 that his next fight will be "one of the last" of his career | dataset; [Al Jazeera, Oct 31](https://www.aljazeera.com/sports/2026/10/31/islam-makhachev-ufc-welterweight-title-one-of-last-fight-prates-morales), [theScore](https://www.thescore.com/mma/news/3639613/makhachev-next-fight-will-be-one-of-the-last-in-my-career) | high (fights), medium (plans) |
| Other recent results (dataset) | Oliveira beat Gamrot (sub R2, Oct 11, 2025) and Holloway (UD 50-45 x3, 20:49 of control, UFC 326, Mar 7, 2026). Pimblett beat Saint Denis (sub R1 0:52, UFC 329, Jul 11, 2026). Holloway beat McGregor at welterweight (UFC 329, R1 1:09, McGregor knee injury). Tom Nolan KO'd Moicano (Oct 31, 2026) | dataset | high |

What the UFC could book next at 155, per the reports above: Gaethje vs Volk (White open; Gaethje
undecided), Gaethje vs Tsarukyan (the UFC is reportedly working on it), a Gaethje–Topuria rematch
(Topuria wants it but is suspended), or a vacant-title fight Volk vs Tsarukyan if Gaethje retires
(both say yes).

---

## 4. Featherweight picture after UFC 333

| Item | Status | Source | Conf. |
|---|---|---|---|
| Champion | **Volkanovski.** Second reign: won the vacant title over Lopes (UFC 314, Apr 12, 2025), then beat Lopes again (UFC 325, Jan 31, 2026) and Evloev (UFC 333, Oct 24, 2026). Counting both reigns, outlets call Evloev his seventh title defense | dataset; [Yardbarker](https://www.yardbarker.com/mma/articles/volkanovski_eyes_lightweight_after_seventh_title_defense/s1_17349_44470696) | high |
| Top of the rankings (Nov 3) | Evloev, Lopes, Murphy, Sterling, in that order, after the event (Meta and media boards per UFCalendar) | [UFCalendar](https://www.ufcalendar.com/rankings), [Yahoo](https://sports.yahoo.com/articles/got-next-alexander-volkov-sails-155621131.html) | medium |
| Contenders (dataset) | **Jean Silva**: beat Arnold Allen (UD, Jan 24, 2026) and Jose Delgado (sub R3, Sep 12, 2026); lost to Lopes (Sep 13, 2025). **Kevin Vallejos**: 4-0 since 2025, latest a KO of Josh Emmett (Mar 14, 2026). **Aljamain Sterling**: beat Ortega and Zalal (5-round decisions). **Lerone Murphy**: lost a majority decision to Evloev (Mar 21, 2026). **Diego Lopes**: TKO'd Steve Garcia at Freedom 250 | dataset | high |
| Likely next | UFC reportedly plans Volk vs Silva, or the winner of Vallejos vs Sterling ("UFC Qatar" in November, **exact date unknown**) | [MMA Sucka](https://mmasucka.com/news/alexander-volkanovski-vs-justin-gaethje-possibility-appears-to-have-disappeared-amidst-talks-about-j/) | low–medium |
| Market on Volk at 145 | BetOnline: Volk -115, Jean Silva -105, which is 51.1% to 48.9% no-vig | [Sherdog](https://www.sherdog.com/news/news/Petr-Yan-favored-in-2-rematches-Volkanovski-underdog-to-Gaethje-203356) | medium |

---

## 5. Betting market

### Every Volkanovski vs Gaethje line found

Implied probability is 100/(odds+100) for plus odds and |odds|/(|odds|+100) for minus odds.
Multiplicative no-vig divides each side's implied probability by their sum. I also show additive,
power and Shin no-vig. For a two-way market these differ by about 1 point.

| Line | Posted | Volk | Gaethje | Implied Volk / Gaethje | Overround | No-vig Volk (mult.) | additive | power | Shin | No-vig Gaethje (mult.) | Source | Conf. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| FightOdds.io opener | Oct 24, 2026, 21:10 UTC (decoded from the X post ID) | +170 | -200 | 0.370 / 0.667 | 3.7% | **0.357** | 0.352 | 0.349 | 0.352 | 0.643 | [X post](https://x.com/FightOdds_io/status/2114102147243450379), [Heavy](https://heavy.com/sports/ufc/justin-gaethje-betting-favorite-alex-volkanovski/) | high |
| BetOnline.ag opener | about Oct 25, 2026 (Gambling911 page dated Oct 25) | +160 | -180 | 0.385 / 0.643 | 2.7% | **0.374** | 0.371 | 0.369 | 0.371 | 0.626 | [Sherdog](https://www.sherdog.com/news/news/Petr-Yan-favored-in-2-rematches-Volkanovski-underdog-to-Gaethje-203356), [Gambling911](https://gambling911.com/ufc-226-betting-odds) (verification note: this URL's slug names UFC 226, a 2018 event, so the link may be wrong or an evergreen page; don't lean on it), [Boxing News](https://boxingnews.com/news/yan-favored-omalley-rematch-volkanovski-underdog), [FightBook](https://www.fightbookmma.com/betonline-ufc-336-title-fight-odds-potential-matchups/) | high |
| BetOnline.ag opener as MMAmania printed it | about Oct 25, 2026 | +157 | -180 | 0.389 / 0.643 | 3.2% | 0.377 | 0.373 | 0.371 | 0.373 | 0.623 | [MMAmania](https://www.mmamania.com/ufc-odds/481818/latest-ufc-odds-justin-gaethje-opens-betting-favorite-smash-alex-volkanovski-not-by-much) | medium (one outlet; most say +160) |
| Lucky Rebel early line | late Oct 2026 (exact date unknown) | +155 | -180 | 0.392 / 0.643 | 3.5% | **0.379** | 0.375 | 0.373 | 0.375 | 0.621 | [FightBook](https://www.fightbookmma.com/alexander-volkanovski-justin-gaethje-odds-superfight/) | medium |

**Consensus:** the mean multiplicative no-vig across the four rows is **Volk 0.372, Gaethje 0.628**.
That mean counts BetOnline twice (+160 and +157). With one row per source (FightOdds.io 0.357,
BetOnline +160 0.374, Lucky Rebel 0.379) it is **0.370**. Use 0.374 (BetOnline at +160) as the
single best opener: it has the lowest margin and the most outlets confirm it. All de-vig methods give
0.349 to 0.379. *(arithmetic re-checked in the verification pass; the prices themselves were not
re-read)*

**Movement:** none found. No book has posted an updated line since the openers, which makes sense with
no bout agreement. **Unknown** for DraftKings, FanDuel, BetMGM, Bovada, Pinnacle, Circa, Kalshi and
Polymarket: searches found no listing, and the budget ran out before more targeted searches.

How the FightOdds.io date was found: X post IDs are Snowflake IDs, where the timestamp in ms equals
(id >> 22) + 1288834974657. Status 2114102147243450379 decodes to 2026-10-24 21:10:04 UTC, which is
right after UFC 333's main event in Abu Dhabi.

### Related lines (market context)

| Line | Odds | No-vig | Source | Conf. |
|---|---|---|---|---|
| Volk vs Jean Silva (145), BetOnline | Volk -115 / Silva -105 | Volk 0.511 | [Sherdog](https://www.sherdog.com/news/news/Petr-Yan-favored-in-2-rematches-Volkanovski-underdog-to-Gaethje-203356) | medium |
| Volk vs Evloev (UFC 333), pre-fight line (timing unknown; neither source says it was the closing line) | about -113 / -113 (pick'em) | 0.50 | [Sherdog: "Volkanovski & Evloev even"](https://www.sherdog.com/news/news/UFC-333-odds-Volkanovski-Evloev-even-Yan-favored-in-trilogy-203230); v2 HANDOFF.md | medium |
| Volk vs Tsarukyan / Gaethje vs Tsarukyan | no line found | unknown | search returned none | n/a |
| Gaethje vs Topuria (Freedom 250), from v2 | Gaethje +450 / Topuria -600 | Gaethje 0.175 | v2 HANDOFF.md (heavy.com) | medium |
| Gaethje vs Holloway (UFC 300), from v2 | Gaethje -162 / Holloway +136 | Gaethje 0.593 | v2 HANDOFF.md (lowkickmma.com) | medium |
| Volk vs Topuria (UFC 298), from v2 | Volk -120 / Topuria +110 | Volk 0.534 | v2 HANDOFF.md (actionnetwork.com) | medium |

What the market is saying: it priced Volk as a coin flip at 145 against Evloev and Jean Silva, but at
about 37% against Gaethje at 155. If Volk's level at 145 is roughly "even with the best 145
contenders," the market's whole 155 penalty sits in the matchup and the weight class. Topuria is a
reference point. The market made him a -600 favorite over Gaethje at 155, about 4.7-to-1 once the
margin is removed (82.5% no-vig), and he lost. The 155 market has been on the wrong side of this
exact matchup type, a former featherweight champion against Gaethje, both times it came up: Holloway in 2024 (won as a 41% dog) and Topuria in
2026 (lost as an 82% favorite). Two fights prove nothing about calibration, but they do warn against
letting the market's size discount run unchecked.

---

## 6. Ratings, models and picks

### Ratings

| System | Volkanovski | Gaethje | Implied Volk | Source | Conf. |
|---|---|---|---|---|---|
| Combat Edge Elo, pre-UFC 333 | 1865 (Evloev 1861) | n/a | n/a | [Combat Edge compare page](https://combat-edge.com/compare/alexander-volkanovski-6782-vs-movsar-evloev-2158/) | medium (snippet) |
| Combat Edge Elo, post-UFC 333 | 1879 | 1869 | **0.514** (1/(1+10^(-10/400))) | v2 research: [Combat Edge Gaethje](https://combat-edge.com/fighter/justin-gaethje-901/), [Combat Edge UFC 333 results](https://combat-edge.com/news/ufc-333-volkanovski-vs-evloev-results/); not re-checked this pass | medium |
| UFC-only Elo built on the dataset (this pass; K=40 for a fighter's first 5 UFC fights, then 24; start 1500; no weight-class term) | 1682 | 1621 | 0.586 | dataset; scripts in scratchpad | high (as computed); low as a predictor: favorite won 55.6%, Brier 0.245 on 3,644 fights since 2010 |
| Modern Combat Martial Arts "elo-v1.1" (pre-UFC 333) | 1620.5 (different scale) | unknown | unknown | [MCMA](https://mcmasystem.com/ufc-333-volkanovski-vs-evloev-preview-and-model-forecast/) | low |
| UFCalendar Power Index | 1895 or 1935 (snippet doesn't say which fighter has which) | unknown | unknown | [UFCalendar](https://www.ufcalendar.com/events/ufc-333-2026-10-24/alexander-volkanovski-vs-movsar-evloev) | low |
| mma-elo.com ("ELO Almanac") | 1739 (stale: shows 15-3, age 37) | unknown | unknown | [mma-elo.com](https://mma-elo.com/fighter/alexander-volkanovski) | low |
| FightMatrix | **unknown.** The lightweight list (issue 11/01/2026, release #1048) exists, but the snippet was garbled and I couldn't read the order | unknown | unknown | [FightMatrix lightweight](https://www.fightmatrix.com/mma-ranks/lightweight/) | n/a |

Dataset Elo for context (same build): Makhachev 1718, Holloway 1667, Sterling 1664, Oliveira 1663,
Evloev 1645, Topuria 1640, Tsarukyan 1638, Murphy 1622, Pimblett 1615, Jean Silva 1610, Lopes 1594,
Vallejos 1584, Ruffy 1559.

**Market minus Elo.** logit(0.514) - logit(0.374) = 0.056 - (-0.515) = **0.57 log-odds** against Volk
beyond Combat Edge Elo, or about 0.86 beyond the dataset Elo. Neither Elo has a weight-class term, so
this gap is a direct read on the size, age and style discount the market applies.

### Expert and fighter picks

- **No named analyst or fighter pick on who wins Volk vs Gaethje turned up** before the search budget
  ran out. **Unknown.** What I did find is about whether the fight should happen:
  - Chael Sonnen: against booking it ("one of the dumbest ideas I've ever heard"). *(high;
    [F4W](https://www.f4wonline.com/news/ufc/chael-sonnen-alexander-volkanovski-justin-gaethje-ufc-superfight-dumb-idea/))*
  - Renato Moicano: wants Volk vs Gaethje over Gaethje vs Tsarukyan. *(medium;
    [Heavy](https://heavy.com/sports/ufc/gaethje-vs-volkanovski-instead-of-tsarukyan/))*
  - Justin Barrasso (Undisputed newsletter): "Volk-Gaethje is the fight to make." *(medium; title only;
    [Substack](https://undisputed.substack.com/p/volk-gaethje-is-the-fight-to-make))*
  - Tsarukyan's take on Volk at 155: "old," "bad chin." *(medium;
    [MMA Sucka](https://mmasucka.com/news/volkanovski-vs-tsarukyan-ufc-lightweight-wrestling-feud-makhachev/))*
  - Bloody Elbow, Oct 28: Volk "told he should replicate Max Holloway after posing 'dumbest idea ever'."
    Who said it and what "replicate Holloway" means are **unknown** from the title.
    *([Bloody Elbow](https://bloodyelbow.com/2026/10/28/alexander-volkanovskis-told-he-should-replicate-max-holloway-after-posing-dumbest-idea-ever/))*
- **Volk on Gaethje before UFC 300 (2024).** Headline: "Justin Gaethje probably beats Max Holloway at
  UFC 300, but it won't be 'a whitewash'"
  ([Yahoo AU](https://au.sports.yahoo.com/alexander-volkanovski-justin-gaethje-probably-203009685.html)).
  A later headline says he switched his pick "for one key reason"
  ([Bloody Elbow, Apr 8, 2024](https://bloodyelbow.com/2024/04/08/alexander-volkanovski-switches-his-pick-for-max-holloway-vs-justin-gaethje-for-one-key-reason)).
  Which way he switched is **unknown** from the title. *(medium)*
- **Volk on Topuria vs Gaethje (2026):** he published a prediction
  ([Heavy](https://heavy.com/sports/ufc/alexander-volkanovski-predicts-topuria-vs-gaethje/)); its
  content is **unknown** this pass.

---

## 7. History: featherweight champions at 155 (and lightweight champions at 145)

All records and stats below are UFC-only, from the dataset. "Diff" is the significant-strike
differential per minute (landed minus absorbed).

### Featherweight champions who fought at lightweight

| Fighter | Lightweight fights (date, event, result) | Record at 155 | Diff/min at 155 vs at 145 | Notes |
|---|---|---|---|---|
| **Conor McGregor** (FW champ Dec 2015) | W Alvarez, KO R2, UFC 205, Nov 12, 2016 (title). L Khabib, sub R4, UFC 229, Oct 6, 2018 (title). L Poirier, TKO R2, UFC 257, Jan 23, 2021. L Poirier, doctor stoppage R1, UFC 264, Jul 10, 2021 | 1-3 | -0.62 vs +2.51 | Also 1-1 vs Diaz and 1-0 vs Cerrone at 170; lost to Holloway at 170 (UFC 329, Jul 11, 2026, knee injury R1) |
| **Max Holloway** (FW champ 2017–19) | L Poirier, UD, UFC 236, Apr 13, 2019 (interim title; 46-49 x3). W Gaethje, KO R5 4:59, UFC 300, Apr 13, 2024. W Poirier, UD, UFC 318, Jul 19, 2025. L Oliveira, UD 45-50 x3, UFC 326, Mar 7, 2026 | 2-2 | +1.46 vs +2.44 | Never knocked out at 155. Against Oliveira he was controlled for 20:49 of 25 minutes and landed 26 significant strikes |
| **Alexander Volkanovski** (FW champ 2019–24, 2025–) | W Kasuya, TKO R2, Nov 26, 2016 (UFC debut, pre-title). L Makhachev, UD 47-48, 47-48, 46-49, UFC 284, Feb 11, 2023 (title). L Makhachev, KO R1 3:06 (head kick), UFC 294, Oct 21, 2023 (title; short notice per v2 research) | 1-2 (0-2 as champion) | +1.11 vs +2.81 (155 includes Kasuya) | Takedowns absorbed rose to 2.13 per 15 at 155 vs 0.63 at 145. Of the 5 at 155, 4 were Makhachev's and 1 was Kasuya's (corrected in the verification pass; the earlier text said all came from Makhachev) |
| **Ilia Topuria** (FW champ 2024–25) | W Herbert, KO R2, Mar 19, 2022 (pre-title). W Oliveira, KO R1 2:27, UFC 317, Jun 28, 2025 (vacant title). L Gaethje, corner stoppage after R4, UFC Freedom 250, Jun 14, 2026 (title) | 2-1 | +0.56 vs +0.95 | Won the 155 title (as McGregor did) and lost his first defense. His only UFC knockdown absorbed was against Herbert (R1, 2022). Against Gaethje he scored the only knockdown and still lost |
| **José Aldo** (FW champ 2010–15) | **No UFC lightweight fights** in the dataset (his UFC fights were at 145 and 135). His fights at 155 before the UFC: **unknown**, not verified this pass | n/a | n/a | |

**Summary.** Against elite lightweights (the 12 fights in the table above, not counting the
pre-title wins over Kasuya and Herbert), featherweight champions went **4-8. The dataset Elo
expected 6.27 wins.** That's about 2.3 wins short, roughly 1.3 standard deviations for 12 fights, so it
points to a tax but doesn't prove one. Weighted by minutes, their significant-strike differential at
155 was **about 1.43 per minute lower** than at 145. By fighter: Holloway -0.98, Volkanovski -1.70,
McGregor -3.13, Topuria -0.39. Their 155 opponents were also much tougher, so part of that drop is
opponent quality, not size.

### Lightweight champions who dropped to featherweight (the reverse)

| Fighter | Record at 145 | Featherweight title fights | Diff/min at 145 vs at 155 |
|---|---|---|---|
| Frankie Edgar (LW champ 2010–12) | 8-5 | 0-3 (L Aldo twice, L Holloway) | +1.04 vs +1.19 |
| BJ Penn (LW champ 2008–10) | 0-3 (L Edgar TKO 2014, L Y. Rodriguez TKO 2017, L Siver MD 2017) | none | -5.02 vs +1.12 (ages 35–38) |
| Anthony Pettis (LW champ 2013–15) | 1-1 (W Oliveira sub 2016; L Holloway TKO R3, UFC 206, interim title) | 0-1 | -1.09 vs -0.57 |

Going down wasn't a free lunch either. Edgar was competitive but never won the 145 title. Penn's
results are mostly age.

### What the whole dataset says about moving up one class

Method: a UFC-only Elo (above), and each fighter's "home" division, meaning his most frequent
division over the four years before the fight, with at least 2 fights there. I kept men's fights where
the two homes are one class apart and the fight is in the bigger man's home division. Then I fit a
logistic regression of the smaller man's win on logit(Elo expectation).

| Sample | n | Smaller man win rate | Elo-expected | Intercept: size effect in log-odds at equal Elo (se) | KO/TKO-loss rate, smaller man |
|---|---|---|---|---|---|
| All one-class moves, men, all years | 383 | 0.522 | 0.512 | **+0.03 (0.10)** | 0.170 |
| All one-class moves since 2015 | 334 | 0.536 | 0.514 | +0.08 (0.11) | n/a |
| 145-home vs 155-home at 155 | 74 | 0.554 | 0.511 | +0.14 (0.24) | 0.189 |
| Elite FW champions at 155 (table above) | 12 | 0.333 | 0.523 | about -0.8 (very wide) | 0.333 (4 of 12) |

Note on the last row: 4 of the 8 losses were KO/TKO: McGregor vs Poirier twice (the second a doctor
stoppage), Volk vs Makhachev 2, and Topuria vs Gaethje by corner stoppage. For comparison, KO/TKO ends 33.7% of featherweight fights
and 29.2% of lightweight fights (fighters with matching home divisions in the dataset), which is
roughly 17% and 15% a fight for each fighter.

Power and chin for the same 383-fight sample, compared with the same fighters at home:

| | Knockdowns scored per 1,000 head strikes landed | Knockdowns absorbed per 1,000 head strikes absorbed | Share of significant strikes landed |
|---|---|---|---|
| Moving up one class (383 fights) | 13.6 | 8.4 | 0.505 |
| Same fighters at home (918 fights) | 10.2 | 8.2 | 0.520 |
| Ratio up / home | 1.33 | **1.02** | |

Reading it: across the whole population, I can't measure a chin tax for moving up one class
(1.02x). The smaller men even score more knockdowns per head strike, likely because of selection:
fighters who move up tend to be big for their old class and confident in their power, and many of
the moves are permanent. The population result and the elite result disagree. The likely
reason is that at the top, the bigger division's champions and contenders (Khabib, Makhachev,
Poirier, Oliveira, Gaethje) are grapplers or punchers whose strengths grow with size, while the
average lightweight isn't. For the engine, make the size tax a labeled knob with a modest default
(section 10), not a hard-coded big penalty.

---

## 8. Common opponents (dataset stats)

### Max Holloway: Volkanovski 3-0, Gaethje 0-1

| Fight | Result | Sig. strikes landed/att (acc.) | Per min | KD | TD | Control | Targets landed (head/body/leg) |
|---|---|---|---|---|---|---|---|
| UFC 245, Dec 14, 2019 (145) | Volk UD (48-47, 48-47, 50-45) | Volk 157/303 (52%); Holloway 134/303 (44%) | 6.28 vs 5.36 | 0-0 | Volk 0/4 | 0:44 vs 0:02 | Volk 67/15/75; Holloway 85/32/17 |
| UFC 251, Jul 11, 2020 (145) | Volk SD (48-47, 47-48, 48-47) | Volk 137/272 (50%); Holloway 102/268 (38%) | 5.48 vs 4.08 | 0-0 | Volk 3/9 | 1:26 vs 0:00 | Volk 64/6/67; Holloway 44/27/31 |
| UFC 276, Jul 2, 2022 (145) | Volk UD (50-45 x3) | Volk 199/372 (53%); Holloway 127/301 (42%) | 7.96 vs 5.08 | 0-0 | Volk 0/0; Holloway 0/3 (corrected from "0/0") | 1:57 vs 0:16 | Volk 152/19/28; Holloway 64/42/21 |
| UFC 300, Apr 13, 2024 (155, BMF) | Holloway KO R5 4:59 | Holloway 181/309 (59%); Gaethje 103/199 (52%) | 7.24 vs 4.12 | Holloway 1 | 0/0 | 0:00 | Holloway 62/62/57; Gaethje 44/26/33 |

- Volk vs Holloway over 75 minutes: out-landed him 493-363, **+1.73 a minute**, with heavy leg kicking
  in the first two fights (75 and 67 leg strikes landed). Volk won rounds 4 and 5 on volume in fights
  2 and 3: 34-24 and 37-23 in fight 2, 44-31 and 50-19 in fight 3.
- Gaethje vs Holloway over 25 minutes: out-landed 181-103, **-3.12 a minute**. Holloway landed 62
  body and 57 leg strikes. Gaethje had his best round in R4 (35-35), then was out-landed 62-18 in R5
  and knocked out with one second left. Neither man tried a takedown.
- Caveat: Holloway at 155 in 2024 was not Holloway at 145 in 2019–22. His differential was +2.44 a
  minute at 145 and +1.46 at 155. Even so, Holloway gave Gaethje more trouble than he ever gave Volk.

### Ilia Topuria: Volkanovski 0-1, Gaethje 1-0

| Fight | Result | Sig. strikes (acc.) | Per min | KD | TD | Control | Targets (head/body/leg) |
|---|---|---|---|---|---|---|---|
| UFC 298, Feb 17, 2024 (145) | Topuria KO R2 3:32 | Volk 47/107 (44%); Topuria 35/77 (45%) | 5.51 vs 4.10 | Topuria 1 | 0/0 | 0:00 vs 0:03 | Volk 21/11/15; Topuria 17/12/6 |
| UFC Freedom 250, Jun 14, 2026 (155) | Gaethje by corner stoppage after R4 | Topuria 97/162 (60%); Gaethje 91/192 (47%) | 4.85 vs 4.55 | Topuria 1 (R2) | Topuria 1/3; Gaethje 0/5 | 2:32 vs 1:32 | Topuria 55/37/5; Gaethje 79/8/4 |

- By round at Freedom 250 (Topuria first): R1 29-32; R2 44-12 plus the knockdown and 2:02 of control;
  R3 **7 of 15** vs Gaethje 22 of 36; R4 17-25. Topuria stopped throwing in R3, and his corner stopped
  it after R4.
- Volk out-landed Topuria 47-35 before the knockout. One clean shot decided it.
- Transitive reading favors Gaethje, but weakly. The two fights were 28 months apart in different
  divisions. Gaethje out-landed Topuria in three of four rounds but lost the total 91-97, because of
  round 2 (44-12 plus the only knockdown).

### Islam Makhachev: Volkanovski 0-2; Gaethje never fought him

| Fight | Result | Sig. strikes (acc.) | Total strikes | KD | TD | Control |
|---|---|---|---|---|---|---|
| UFC 284, Feb 11, 2023 (155, title) | Makhachev UD (48-47, 48-47, 49-46) | Volk 70/143 (49%); Makhachev 57/95 (60%) | Volk 164; Makhachev 95 | Volk 1 (R5) | Makhachev 4/9; Volk 0/4 | Makhachev 7:37; Volk 2:55 |
| UFC 294, Oct 21, 2023 (155, title) | Makhachev KO R1 3:06 (head kick) | Volk 4/6; Makhachev 24/29 (83%) | Volk 11; Makhachev 39 | Makhachev 1 | Makhachev 0/1 | Makhachev 0:19; Volk 0:49 |

- In fight 1, rounds 1 and 4 were Makhachev's grappling rounds: 2:04 and 3:25 of control, one takedown
  each. Round 5 was Volk's: 20-8 in significant strikes, a knockdown, and 1:33 of control.
- Shared Makhachev opponents with Gaethje:
  - **Poirier.** Makhachev won by D'Arce, R5 2:42 (UFC 302, 2024), with 5 of 16 takedowns and 10:23 of
    control. Gaethje lost to Poirier by TKO R4 in 2018 (out-landed 174-115) and won the 2023 rematch by
    head-kick KO in R2.
  - **Oliveira.** Makhachev won by arm-triangle, R2 (UFC 280, 2022), with 5:05 of control. Oliveira
    beat Gaethje by RNC in R1 (UFC 274, 2022) after a knockdown each way.
  - **Khabib** (Makhachev's training partner and the closest stylistic proxy). He submitted Gaethje
    with a triangle in R2 (UFC 254, 2020). Gaethje had landed 15 of 15 leg kicks.
- Reading: Gaethje has lost to both elite grapplers he faced (Khabib, Oliveira), and Volk has lost
  twice to the elite grappler he faced. Neither Makhachev link tells us much about a striking matchup
  between these two. Gaethje doesn't wrestle much (0.30 takedowns per 15 in the dataset), so Volk's
  155 problem (takedowns) mostly doesn't apply here. His other 155 problem (one clean shot, as in
  Makhachev 2 and Topuria) does.

### Other links

- **Poirier** (Holloway 1-1 at 155; Gaethje 1-1): at UFC 318 Holloway out-landed Poirier 198-109 over
  25 minutes. Gaethje's two Poirier fights were a firefight loss and a 6-minute KO win.
- **Oliveira** (beat Holloway 50-45 x3 at 155 with 20:49 of control; submitted Gaethje in R1;
  lost to Topuria by KO in R1): elite lightweight grappling took Holloway out of the fight entirely.

---

## 9. Recent form fights (dataset)

| Fight | Result | Sig. strikes | KD | TD | Control | Notes |
|---|---|---|---|---|---|---|
| Volk vs Lopes 1, UFC 314, Apr 12, 2025 | Volk UD (49-46, 49-46, 48-47) | Volk 158/259 (61%) vs 63/194 (32%) | Lopes 1 (R2) | Volk 1/11 | 1:18 vs 0:05 | Volk 39-16 and 43-14 in R4 and R5 |
| Volk vs Lopes 2, UFC 325, Jan 31, 2026 | Volk UD (49-46, 49-46, 50-45) | 98/160 (61%) vs 70/158 (44%) | 0-0 | Volk 2/7; Lopes 2/5 | 2:49 vs 1:50 | R5 21-3 with 2 takedowns |
| Volk vs Evloev, UFC 333, Oct 24, 2026 | Volk TKO R2 4:54 | 56/110 (51%) vs 40/65 (62%) | 0-0 | Evloev 3/7 (3 in R1); Volk 1/2 | 1:44 vs 0:46 | Volk out-landed him 32-20 in R2 and finished from half guard |
| Gaethje vs Fiziev 2, UFC 313, Mar 8, 2025 | Gaethje UD (29-28 x3) | 72/134 vs 68/119 | Gaethje 1 | Fiziev 2/2; Gaethje 0/3 | 1:32 vs 0:40 | Fiziev 43 body strikes landed |
| Gaethje vs Pimblett, UFC 324, Jan 24, 2026 | Gaethje UD (48-47, 49-46, 49-46) | 144/254 (57%) vs 156/311 (50%) | Gaethje 2 | Gaethje 3/3; Pimblett 0/5 | 5:55 vs 0:48 | Lost the volume count but won on knockdowns and takedowns |
| Gaethje vs Topuria, Freedom 250, Jun 14, 2026 | Gaethje by corner stoppage after R4 | 91/192 vs 97/162 | Topuria 1 | Gaethje 0/5; Topuria 1/3 | 1:32 vs 2:32 | see section 8 |

Knockdowns absorbed in the UFC (dataset): **Volk 4** (Mendes 2018 R2, Makhachev 2023 R1, Topuria 2024
R2, Lopes 2025 R2), two of which led to KO losses. **Gaethje 4** (Alvarez 2017 R3, Oliveira 2022 R1,
Holloway 2024 R5, Topuria 2026 R2), two of which led to KO losses.

Pace in 5-round fights, significant strikes landed per minute by round (dataset):
- Volk: R1 4.41 (n=12), R2 5.48 (11), R3 7.11 (9), R4 6.38 (8), **R5 7.20 (7)**. His output climbs.
- Gaethje: R1 6.30 (n=12), R2 6.58 (8), R3 4.76 (5), R4 5.84 (5), R5 5.94 (3). His output fades
  after round 2, on small samples.

Physicals (dataset `ufc_fighter_tott.csv`): Volk 5'6", 71" reach, orthodox, born Sep 29, 1988 (38).
Gaethje 5'11", 70" reach, orthodox, born Nov 14, 1988 (37; 38 on Nov 14, 2026).

---

## 10. Numbers for the engine

- **Market prior for Volk:** 0.374 (BetOnline opener, no-vig). The consensus is 0.372, or 0.370 with
  one row per source. The range is 0.349–0.379 across sources and methods. The market weight in the
  stack should use the consensus.
- **Rating prior:** Combat Edge Elo, Volk 1879 vs Gaethje 1869, gives 0.514. Re-check before shipping.
  The dataset UFC-only Elo gives 0.586; use it only as a weak baseline (55.6% favorite accuracy).
- **Market minus Elo gap:** 0.57 log-odds against Volk (Combat Edge basis). If the engine's size, age
  and style knobs, set together, move Volk's chance by much less than that from an Elo-like baseline,
  the knobs disagree with the market. Say so on the page; don't hide it.
- **Size-tax knob (145 to 155):** the population estimate is about 0 (+0.03 ± 0.10 log-odds; chin
  ratio 1.02). The elite estimate is about -0.8, n=12, very wide. **Suggested default -0.25 log-odds
  equivalent, knob range 0 to -0.8.** In a mechanistic engine, apply it as a chin-susceptibility
  multiplier of about 1.10–1.15 on the smaller man plus a power multiplier of about 1.05–1.10 on the
  bigger man, and tune both so the matchup moves by about 6 points at a coin flip. Label it a judgment
  call.
- **Strike differential shift at 155 for featherweight champions:** -1.43 per minute, weighted by
  minutes (confounded with opponent quality). Useful as a sanity check on the size knob's effect on
  the volume battle.
- **KO/TKO base rates:** 33.7% of featherweight fights and 29.2% of lightweight fights between
  same-home fighters end by KO/TKO. A smaller man moving up one class loses by KO/TKO in 17.0% of
  fights (n=383).
- **Round pace multipliers** (landed per minute relative to R1): Volk 1.00, 1.24, 1.61, 1.45, 1.63;
  Gaethje 1.00, 1.04, 0.76, 0.93, 0.94. Shrink both toward the division curve. Gaethje's late-round
  samples are 5, 5 and 3 rounds.
- **Common-opponent volume check:** against Holloway, Volk +1.73 per minute (75 min) and Gaethje -3.12
  per minute (25 min). A matchup engine that has Gaethje out-landing Volk on average would contradict
  the only shared volume evidence.

---

## 11. Data notes for the pipeline (found while doing this)

- **Duplicate bouts.** `ufc_fight_results.csv` lists some bouts twice under different event names,
  such as "Noche UFC: Lopes vs. Silva" and "UFC Fight Night: Lopes vs. Silva" (same fight-details
  URL). Only one of the two names exists in `ufc_event_details.csv`, so 27 rows come back without a
  date. They are 14 under "UFC Fight Night: Lopes vs. Silva", 11 under "UFC Fight Night: Grasso vs.
  Shevchenko 2" and 2 under "UFC - Road to UFC 4.6". The "Noche UFC: ..." names are the ones that
  *do* exist in the event file (corrected in the verification pass). **Dedupe on URL** before joining to events. Fight stats have the same duplication.
- **Decision scores.** In `DETAILS`, each judge's score is written "loser - winner": in 9,493 of 9,510
  unanimous-decision scores the second number is the higher one, whatever order the names are in.
  In a split decision, the dissenting judge's score reads higher-first.
- **pandas 3 string dtype.** Text columns load as the string dtype, not `object`, so an
  `if dtype == object: strip()` guard silently skips them. Strip every non-numeric column.
- **Corner stoppages** show as `METHOD = KO/TKO`, `TIME = 5:00`, with `DETAILS` "toCorner Stoppage".
  Injury stoppages put the reason in `DETAILS`, for example "toMcGregor knee injury".

---

## 12. Open questions

- Has Gaethje or his team replied to the Volk proposal since White's Nov 5 comments? Will the UFC tell
  Tsarukyan by the end of November as he expects?
- What are Combat Edge's current ratings for both men, and FightMatrix's ranks? Not re-checked
  this pass.
- Have any analysts or fighters made named picks for Volk vs Gaethje? None found this pass.
- Are there lines at sharper books (Pinnacle, Circa) or prediction markets (Kalshi, Polymarket), and
  any market on whether the fight is booked? None found.
- Did Aldo fight at 155 before the UFC? Not verified.
- Topuria's "lost vision in both eyes" detail rests on one snippet. Confirm it or drop it.
- The elite size-tax sample is 12 fights. Rerun once the v3 Elo (with pre-UFC records or a stronger
  rating) exists. The dataset Elo used here is weak.

---

## Sources

Dataset: `/home/user/XX/data/raw/` (Greco1899/scrape_ufc_stats, from ufcstats.com, through Oct 31,
2026). Scripts: `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/`
(load.py, records.py, common.py, sizetax.py, sizetax2.py, champs.py, kd.py, novig.py, elotune.py,
recent.py).

Web (seen via search results; full pages could not be fetched in this session):

- https://bloodyelbow.com/2026/11/05/justin-gaethje-vs-alexander-volkanovski-dana-white-reveals-whats-holding-up-superfight/
- https://cagesidepress.com/2026/11/05/white-open-volk-gaethje-waiting-lightweight-champs/
- https://www.bjpenn.com/mma-news/ufc/dana-white-presses-justin-gaethje-pull-trigger-alexander-volkanovski/
- https://heavy.com/sports/ufc/dana-white-alex-volkanovski-justin-gaethje/
- https://nyfights.com/featured/alexander-volkanovski-justin-gaethje-ufc-2/
- https://www.sportskeeda.com/mma/news-dana-white-suggests-justin-gaethje-holding-super-fight-vs-alexander-volkanovski
- https://mmasucka.com/news/dana-white-wants-alexander-volkanovski-vs-justin-gaethje-but-is-waiting-on-gaethjes-decision/
- https://sports.yahoo.com/articles/golf-ufc-justin-gaethje-must-122856281.html
- https://www.yardbarker.com/mma/articles/gaethje_must_decide_between_golf_and_ufc/s1_17349_44519048
- https://www.mmamania.com/ufc-news/481203/dana-white-open-to-alexander-volkanovskis-proposed-gaethje-superfight-after-ufc-333-its-hard-to-say-no-to-a-guy-like-that
- https://www.mmamania.com/ufc-333-fight-card-start-time-live-stream-volkanovski-vs-evloev/481925/dana-white-reacts-to-absolute-stud-alexander-volkanovskis-ufc-333-win-just-f-king-built-different
- https://sports.yahoo.com/mma/article/alexander-volkanovski-presses-for-justin-gaethje-retirement-fight-after-ufc-333-win-dana-white-reacts-171858455.html
- https://mmasucka.com/news/alexander-volkanovski-justin-gaethje-superfight-dana-white-ufc-333/
- https://sports.yahoo.com/articles/alexander-volkanovski-wants-superfight-justin-150000227.html
- https://mmasucka.com/news/alexander-volkanovski-justin-gaethje-ufc-333-superfight-retirement/
- https://sports.yahoo.com/articles/alexander-volkanovski-insists-lightweight-title-170100012.html
- https://athlonsports.com/mma/ufc-333-alexander-volkanovski-illness-michael-jordan-flu-game-justin-gaethje-last-dance
- https://heavy.com/sports/ufc/alexander-volkanovski-reveals-illness-ufc-333/
- https://mmasucka.com/news/alexander-volkanovski-had-a-chest-infection-before-ufc-333-but-refused-to-back-down/
- https://agentmma.com/news/92025-volkanovski-says-he-refused-medication-despite-assurances-it-was-allowed-after-u
- https://www.yardbarker.com/mma/articles/volkanovski_eyes_lightweight_after_seventh_title_defense/s1_17349_44470696
- https://www.mmamania.com/ufc-news/482335/alex-volkanovski-says-hell-fight-arman-tsarukyan-if-justin-gaethje-wont
- https://www.yardbarker.com/mma/articles/volkanovski_offers_tsarukyan_vacant_title_fight/s1_17349_44488566
- https://mmasucka.com/news/you-aint-holding-me-down-alexander-volkanovski-welcomes-arman-tsarukyans-wrestling-in-bold-lightweig/
- https://www.sherdog.com/news/news/Alexander-Volkanovski-open-to-fighting-Arman-Tsarukyan-for-UFC-gold-203404
- https://bloodyelbow.com/2026/10/26/arman-tsarukyan-open-to-alexander-volkanovski-title-fight-as-he-expects-justin-gaethje-decision-soon/
- https://mmasucka.com/news/volkanovski-vs-tsarukyan-ufc-lightweight-wrestling-feud-makhachev/
- https://www.sherdog.com/news/news/Arman-Tsarukyans-coach-welcomes-Alexander-Volkanovski-UFC-title-fight-203447
- https://sports.yahoo.com/articles/arman-tsarukyans-coach-welcomes-alexander-191208024.html
- https://boxingnews.com/news/white-gaethje-decision-volkanovski-fight
- https://boxingnews.com/news/moicano-tsarukyan-volkanovski-gaethje-ufc
- https://heavy.com/sports/ufc/gaethje-vs-volkanovski-instead-of-tsarukyan/
- https://www.f4wonline.com/news/ufc/chael-sonnen-alexander-volkanovski-justin-gaethje-ufc-superfight-dumb-idea/
- https://www.bjpenn.com/mma-news/ufc/justin-gaethje-vs-alexander-volkanovski-is-one-of-the-dumbest-ideas-ive-ever-heard-says-ufc-analyst/
- https://www.sportskeeda.com/mma/news-who-help-chael-sonnen-slams-alexander-volkanovski-s-desire-fight-justin-gaethje-lightweight
- https://bloodyelbow.com/2026/10/28/alexander-volkanovskis-told-he-should-replicate-max-holloway-after-posing-dumbest-idea-ever/
- https://bloodyelbow.com/2026/10/29/jean-silva-fires-back-at-alexander-volkanovskis-coach-who-said-he-doesnt-deserve-title-shot/
- https://mmasucka.com/news/jean-silva-doesnt-want-alexander-volkanovski-to-move-up-believes-justin-gaethje-wont-retire/
- https://mmasucka.com/news/alexander-volkanovski-vs-justin-gaethje-possibility-appears-to-have-disappeared-amidst-talks-about-j/
- https://undisputed.substack.com/p/volk-gaethje-is-the-fight-to-make
- https://bloodyelbow.com/2026/08/29/justin-gaethje-still-cant-punch-over-two-months-after-damaging-his-hands-on-ilia-topurias-face/
- https://sports.yahoo.com/articles/justin-gaethje-reveals-ongoing-hand-055830458.html
- https://athlonsports.com/mma/justin-gaethje-injury-ufc-white-house-fight-ilia-topuria
- https://www.bjpenn.com/mma-news/ufc/justin-gaethje-remains-sidelined-until-2027-amid-injury-update-both-of-my-hands-are-still-hurt/
- https://themaclife.com/sports/mma/gaethje-handed-medical-suspension-after-title-win/
- https://www.aljazeera.com/sports/2026/6/11/ilia-topuria-vs-justin-gaethje-title-fight-at-ufc-freedom-250-all-to-know
- https://sports.yahoo.com/articles/ilia-topuria-handed-6-month-220016561.html
- https://next-fight.com/en/fighter/ilia-topuria
- https://www.aljazeera.com/sports/2026/10/31/islam-makhachev-ufc-welterweight-title-one-of-last-fight-prates-morales
- https://www.thescore.com/mma/news/3639613/makhachev-next-fight-will-be-one-of-the-last-in-my-career
- https://www.ufcalendar.com/rankings/lightweight
- https://www.ufcalendar.com/rankings
- https://ufcrankings.org/
- https://www.homeoffight.com/ufc-rankings
- https://www.tapology.com/rankings/ufc/ultimate-fighting-championship-mens-lightweight-155-pounds
- https://sports.yahoo.com/articles/got-next-alexander-volkov-sails-155621131.html
- https://x.com/FightOdds_io/status/2114102147243450379
- https://heavy.com/sports/ufc/justin-gaethje-betting-favorite-alex-volkanovski/
- https://www.mmamania.com/ufc-odds/481818/latest-ufc-odds-justin-gaethje-opens-betting-favorite-smash-alex-volkanovski-not-by-much
- https://www.sherdog.com/news/news/Petr-Yan-favored-in-2-rematches-Volkanovski-underdog-to-Gaethje-203356
- https://gambling911.com/ufc-226-betting-odds
- https://boxingnews.com/news/yan-favored-omalley-rematch-volkanovski-underdog
- https://www.fightbookmma.com/betonline-ufc-336-title-fight-odds-potential-matchups/
- https://www.fightbookmma.com/alexander-volkanovski-justin-gaethje-odds-superfight/
- https://www.sherdog.com/news/news/UFC-333-odds-Volkanovski-Evloev-even-Yan-favored-in-trilogy-203230
- https://combat-edge.com/compare/alexander-volkanovski-6782-vs-movsar-evloev-2158/
- https://combat-edge.com/fighter/justin-gaethje-901/ (v2)
- https://combat-edge.com/news/ufc-333-volkanovski-vs-evloev-results/ (v2)
- https://mcmasystem.com/ufc-333-volkanovski-vs-evloev-preview-and-model-forecast/
- https://www.ufcalendar.com/events/ufc-333-2026-10-24/alexander-volkanovski-vs-movsar-evloev
- https://mma-elo.com/fighter/alexander-volkanovski
- https://www.fightmatrix.com/mma-ranks/lightweight/
- https://au.sports.yahoo.com/alexander-volkanovski-justin-gaethje-probably-203009685.html
- https://bloodyelbow.com/2024/04/08/alexander-volkanovski-switches-his-pick-for-max-holloway-vs-justin-gaethje-for-one-key-reason
- https://heavy.com/sports/ufc/alexander-volkanovski-predicts-topuria-vs-gaethje/

---

## Verification log

Adversarial check run Nov 6, 2026. The checker set out to refute claims, not confirm them.

**Limits of this pass.** The web-search budget (200 calls, shared by all agents in the run) was
already used up when this check started. WebFetch could not reach bloodyelbow.com or
cagesidepress.com (DNS failure: the hosts aren't in this session's allowed network). So **no web
claim was independently re-searched.** Web claims are graded only on internal consistency, against
`HANDOFF.md`, `research/gaethje.md` and `research/volkanovski.md`. Those files partly draw on the same
search results, so agreement between them is weak evidence. Every dataset number was recomputed from
`data/raw/` with fresh scripts (deduped on URL; names stripped). The size-tax and Elo scripts were
re-run from copies (`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/fcm/`), and every no-vig figure was recomputed independently.

| # | Claim | Verdict | Note |
|---|---|---|---|
| 1 | Not booked as of Nov 6; White (Jim Rome, reported Nov 5) says it hinges on Gaethje's retire-or-fight decision | unverifiable | Couldn't re-search or fetch either cited article. `research/gaethje.md` and `research/volkanovski.md` also find no booking. Nothing contradicts it |
| 2 | FightOdds.io opener Gaethje -200 / Volk +170; post at 21:10 UTC Oct 24 | partly confirmed | The Snowflake decode is right: (2114102147243450379 >> 22) + 1288834974657 ms = 2026-10-24 21:10:04 UTC. The dataset confirms UFC 333 was Oct 24 in Abu Dhabi. The prices are unverifiable this pass but match v2's HANDOFF.md. "Right after the main event" is an inference: the event start time wasn't checked. FightOdds.io is an odds site, not a book (wording fixed in section 1) |
| 3 | BetOnline -180/+160 (~Oct 25); MMAmania printed +157; Lucky Rebel -180/+155 | unverifiable | Not re-searched. Warning sign: the cited Gambling911 URL slug is "ufc-226-betting-odds", a 2018 event (flagged in place). +157 is one outlet's version of the same BetOnline line, so it's not independent |
| 4 | No-vig Volk 35.7–37.9%; consensus 37.2%; 34.9–37.9% across methods | confirmed (arithmetic) | Recomputed multiplicative, additive, power and Shin. They match to 3 decimals. Overrounds are 3.7%, 2.7%, 3.2% and 3.5%. Mean of the four rows = 0.3719. The four rows double-count BetOnline; one row per source gives 0.370 (added). Market-minus-Elo 0.571 and 0.862 log-odds both check |
| 5 | Late Aug: both hands hurt, "still can't punch anything"; ruled out 2026; weighing retirement | corrected (framing) | The quote and the injury are unverifiable this pass, but URL slugs from several outlets agree. The file called August his "last"/"latest" update, which `research/gaethje.md` contradicts. It cites a mid-September statement ruling out 2026 (knee bone bruise) and a September Schulz interview: "if he fights again it will be Tsarukyan", undecided. Both corrected in section 1 and "Gaethje's side". The suspension issuer is also disputed (CSAC vs ABC per F4W), now flagged |
| 6 | Nov 3 media rankings: champ Gaethje; 1 Topuria, 2 Tsarukyan, 3 Oliveira, 4 Holloway, 5 Pimblett | unverifiable | Not re-searched. `research/gaethje.md` gives the same order from the same aggregators, so this isn't independent. ufc.com wasn't checked |
| 7 | Makhachev WW champ (UD over Machado Garry, UFC 330, Aug 15, 2026); next vs the Prates–Morales interim winner (UFC 336, Jan 30, 2027); "one of the last" | partly confirmed | Dataset: UFC 330, Aug 15, 2026, Makhachev UD 49-46, 49-46, 48-47. UFC 322, Nov 15, 2025: UD 50-45 x3 over Della Maddalena. The dataset is consistent with a Prates–Morales contender fight: Prates beat Della Maddalena (May 2, 2026) and Morales beat Brady (Nov 15, 2025). The UFC 336 date, venue, interim status and quote are unverifiable this pass |
| 8 | Volk out-landed Holloway 493-363 over 75 min (+1.73/min); Holloway out-landed Gaethje 181-103 (62-18 in R5), KO at 4:59 R5 | confirmed | 157+137+199 = 493; 134+102+127 = 363; 130/75 = 1.733. UFC 300: 181-103, R5 62-18, R4 35-35, KO R5 4:59. Separate error found in the same table: at UFC 276, Holloway went 0 of 3 on takedowns, not "0/0" (fixed) |
| 9 | Freedom 250: Topuria out-landed Gaethje 97-91, only KD (R2); Gaethje 0/5 TD; Topuria's corner stopped it after R4 | confirmed (dataset) | 97/162 vs 91/192. KD Topuria R2. TD Gaethje 0/5, Topuria 1/3. Control 2:32 vs 1:32. Rounds 29-32, 44-12, 7-22, 17-25. Results file: KO/TKO, R4 5:00, "Corner Stoppage", Topuria L |
| 10 | FW champions vs elite LWs 4-8, Elo expected 6.27 | confirmed (as computed) | Recomputed from the dataset Elo: 12 fights, 4 wins, sum of expectations 6.267. About 1.3 SD short. Inference stays low-confidence (n=12) |
| 11 | 383 one-class-up fights: +0.03 log-odds (se 0.10); KD-absorbed rate 1.02x home | confirmed (as computed) | Re-ran: intercept +0.025 (se 0.105); 145→155 +0.144 (se 0.242, n=74); since 2015 +0.080 (0.113, n=334); chin ratio 1.02, power 1.33; KO/TKO-loss 0.170; FW/LW same-home KO shares 0.337/0.292. Elo check: favorite won 0.556, Brier 0.2452, n=3,644 |
| 12 | Combat Edge Elo after UFC 333: Volk 1879, Gaethje 1869; before: Volk 1865, Evloev 1861 | unverifiable | Not re-checked; the post-fight values come only from v2's HANDOFF.md. 1/(1+10^(-10/400)) = 0.514 checks. A +14 gain from beating a near-equal opponent implies K ≈ 28, which is plausible |
| 13 | BetOnline Volk -115 / Jean Silva -105 | unverifiable | Not re-searched. No-vig 0.511 checks |
| 14 | Each fighter knocked down 4 times in the UFC; 2 of each led to KO losses | confirmed | Volk was dropped by Mendes 2018 (Volk won), Makhachev 2023 (KO loss), Topuria 2024 (KO loss) and Lopes 2025 (Volk won). Gaethje was dropped by Alvarez 2017 (KO loss), Oliveira 2022 (sub loss), Holloway 2024 (KO loss) and Topuria 2026 (Gaethje won). Gaethje's third UFC KO loss (Poirier 2018) came without a recorded knockdown |

**Other checks on the rest of the file.**

- **Confirmed from the dataset:**
  - Records and judges' scores for every fight in sections 3, 4, 7, 8 and 9. This covers Gaethje–Pimblett 48-47, 49-46, 49-46 and Makhachev–Volk 1 48-47, 48-47, 49-46.
  - The Freedom 250, UFC 298, UFC 284/294, UFC 302, UFC 280, Poirier–Gaethje 1 and Khabib–Gaethje (15 of 15 leg kicks) stat lines.
  - Recent-form rows: Lopes 1 and 2, Evloev, Fiziev 2, Pimblett.
  - Round-pace figures for both men (Volk 4.41/5.48/7.11/6.38/7.20; Gaethje 6.30/6.58/4.76/5.84/5.94) and their ratios.
  - Gaethje 0.30 TD per 15. Physicals: 5'6", 71", born Sep 29, 1988; 5'11", 70", born Nov 14, 1988.
  - Tsarukyan's 6-fight streak. Topuria's only UFC knockdown absorbed (Herbert).
  - All dataset Elo values. Minutes-weighted differential drop -1.43/min. Per-fighter diffs.
  - Edgar 8-5, Penn 0-3 and Pettis 1-1 at 145.
  - Volk's "seventh title defense" (5 + 2) and his 2016 Kasuya win at 155.
- **Corrected:**
  - Volk's takedowns absorbed at 155: 4 of 5 were Makhachev's, 1 was Kasuya's (the file said all were Makhachev's).
  - UFC 276 takedowns: Holloway went 0/3.
  - Data note: the 11 undated rows are under "UFC Fight Night: Grasso vs. Shevchenko 2", not "Noche UFC: ..." (that name is the one the event file has).
  - Volk–Evloev -113/-113 was labeled "closing", but neither source says so; now "pre-fight, timing unknown".
  - Topuria at -600 is 6-to-1 as posted; 4.7-to-1 is the no-vig figure (clarified).
  - "Featherweight champion against Gaethje" changed to "former featherweight champion": Holloway in 2024 and Topuria in 2026 no longer held the 145 belt.
- **Confirmed data notes:** 9,493 of 9,510 unanimous-decision scores (after URL dedupe) read loser–winner. pandas is 3.0.5 and loads text as `str`. Fight stats are duplicated under both event aliases (64 and 52 rows).
- **Flagged, unresolved:**
  - Timing of Volk's "That's something I would retire for" line. This file says before UFC 333; `research/volkanovski.md` and `research/gaethje.md` say the post-fight press conference.
  - Lucky Rebel's posting date is unknown.
  - Every quote and price in sections 2–6 still rests on search snippets that nobody has read in full.
- **To redo once web access returns:** booking status after Nov 5, the Nov 3 rankings on ufc.com, the four Volk–Gaethje prices and any line movement, Combat Edge's current ratings, UFC 336's card and date, and Gaethje's latest public statement.
