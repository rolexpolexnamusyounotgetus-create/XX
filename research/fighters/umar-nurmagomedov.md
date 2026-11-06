# Umar Nurmagomedov: scouting dossier

As of Nov 6, 2026. "Dataset" = `data/derived/fighters.json` (ufcstats snapshot to Oct 31, 2026). Fight numbers re-checked against raw ufcstats rows on Nov 6.

**Research note (updated Nov 6, 2026):** the network was open for this pass. Status, ranking, record, bookings, injuries and appearance were re-checked on the web. The pages on the "Nov 6 re-check" and "Photos" lines under Sources were fetched on Nov 6 unless marked as a search summary; older source lines are as the earlier pass left them. ufc.com returned 403, so the official rankings were read through two mirrors that agree. Fight numbers still come from the ufcstats snapshot of Oct 31, 2026.

## Current status

- **Ranking:** #4 bantamweight in the UFC media-panel rankings (Nov 3, 2026) and #5 in the UFC/Meta algorithmic rankings (Oct 31, 2026).
- **Form:** coming off a KO loss to Song Yadong at 1:48 of round 2 in the UFC Shanghai main event (Aug 29, 2026), the first stoppage loss of his career. He went in as a massive favourite (ESPN called it a massive upset).
- **Record:** 20-2 pro (MMA Junkie, UFCalendar, Wikipedia); 8-2 in the UFC. His only other loss was a title-fight decision to Merab Dvalishvili (UFC 311, Jan 18, 2025).
- **Age and frame:** 30 (born Jan 3, 1996), 5'8", 69" reach, orthodox.
- **Next:** no UFC bout booked. He posted from the gym 10 days after the knockout (Lowkick MMA). His next outing is his Real American Freestyle debut, a freestyle wrestling match (not MMA) against Urijah Faber at RAF Abu Dhabi, Nov 14, 2026, Etihad Arena (MMA Fighting, Oct 2).
- **Injuries:** none reported. No medical suspension from the Shanghai knockout was found in the sources checked.

## Recent fights

| Date | Opponent | Result | How |
|---|---|---|---|
| Aug 29, 2026 | Song Yadong | L, KO R2 1:48 | His one takedown (1 of 3) came off a caught calf kick in R1. In R2 Song stuffed his shots and countered a double-leg with a right hand (mmasucka; UFC.com says uppercut). Sig strikes 13/21 vs 11/23. |
| Jan 24, 2026 | Deiveson Figueiredo | W, UD 30-27 x3 | 2 of 6 takedowns and 4:50 of control. Figueiredo landed 8 sig strikes. |
| Oct 25, 2025 | Mario Bautista | W, UD 30-27 x3 | 11 of 14 takedowns and 10:46 of control, but Bautista dropped him in R2. |
| Jan 18, 2025 | Merab Dvalishvili (title) | L, UD 47-48, 46-49, 47-48 | He landed only 2 of 15 takedowns and was close on the feet (104 vs 111 landed). Merab out-landed him 36-21 in R4. |
| Aug 3, 2024 | Cory Sandhagen | W, UD 50-45, 49-46, 49-46 | 5 of 13 takedowns, 98 landed to 71, and 27 of 39 body strikes. |

## Style

- **Top control:** he lands takedowns and rides long stretches of top position (11:26 vs Almakhan, 10:49 vs Maness, 10:46 vs Bautista).
- **Finishing from top:** he strikes from the top and has two rear-naked choke wins.
- **Range game:** on the feet he leans on body strikes (15.8% of attempts, against a 14.1% average) and picks his shots. He threw 6.3 attempts per minute in the decayed data, against an 8.7 average.

## Strengths

- **Control:** 23 s/min career, about twice the league rate.
- **Hard to hit cleanly:** opponents land only 26.9% of head attempts on him.
- **Takedown defence:** 79%.
- **Scoring wins:** all five of his decision wins since 2022 were wide, with no judge giving the opponent more than one round.

## Weaknesses

- **Getting dropped:** he has been knocked down in three of his last six fights, by Almakhan, Bautista and Song. His decayed rate is 0.47 knockdowns absorbed per 15 min, against a 0.31 prior.
- **Shooting into counters:** the Song KO came as he shot into a counter-puncher who had already stuffed him.
- **Low output:** a volume wrestler (Dvalishvili) out-worked him.

## Durability and cardio

- **Durability:** one KO loss and three knockdowns absorbed in 10 UFC fights, though rarely hit cleanly.
- **Cardio:** he went five rounds twice (Sandhagen, Dvalishvili) without a visible fade in the data. The five-round sample is small (10-15 minutes per round).

## What the numbers say

Decayed rates: he lands 3.37 per minute and absorbs 1.97, with 21.9 s/min of control and 3.9 takedowns per 15 min at 47%. His attempt split is 76.8% head, 15.2% body and 8.0% leg. His Elo is 1687. In the engine he should win most rounds through control against opponents with ordinary takedown defence. He needs a damage multiplier on his chin that the low absorbed-strike rate would otherwise hide. Against heavy counter-punchers with good takedown defence (Song, Yan), his losing path is a single clean shot on the entry.

## Appearance

No photo-based likeness sheet exists for him. Read from ESPN's UFC Shanghai fight-week headshot and stance shot (Last-Modified Aug 27, 2026) and an ESPN stance shot from Jan 2025. These replace the earlier unverified recall.

- **Hair:** very short dark brown, close-cropped all over.
- **Facial hair:** short dark beard, heaviest under the jaw, with a thin moustache.
- **Skin:** light.
- **Tattoos:** none visible on the chest, torso, arms or legs (front views; back not seen).
- **Kit:** white UFC Shanghai fight-kit shorts (Aug 2026) and red fight-kit shorts (Jan 2025). Corner colour wins in the sim.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/` ufcstats CSVs; ufcstats [fighter page](http://ufcstats.com/fighter-details/2b6fc1c02736833d); fight pages: [Song](http://ufcstats.com/fight-details/228fefc6923c40a5), [Figueiredo](http://ufcstats.com/fight-details/6c9f4799990c3c33), [Bautista](http://ufcstats.com/fight-details/e69f9b4b9cae12a4), [Dvalishvili](http://ufcstats.com/fight-details/f39941b3743bf18c), [Sandhagen](http://ufcstats.com/fight-details/33655fd07cfbe034), [Almakhan](http://ufcstats.com/fight-details/dcf5014e56649c2f)
- Via other repo dossiers (not opened this pass): [ESPN: Song KOs Umar](https://www.espn.com/mma/story/_/id/49762250/song-yadong-kos-umar-nurmagomedov-massive-ufc-upset-shanghai); [UFC Shanghai results](https://www.ufc.com/news/ufc-shanghai-results-nurmagomedov-vs-song); [mmasucka breakdown](https://mmasucka.com/opinion/how-song-yadong-beat-umar-nurmagomedov-breaking-down-the-ufc-shanghai-main-event-knockout/)
- Nov 6 re-check: [UFCalendar profile](https://www.ufcalendar.com/fighters/umar-nurmagomedov); [UFCalendar rankings](https://www.ufcalendar.com/rankings/bantamweight) (media panel Nov 3, Meta Oct 31); [ufcrankings.org](https://ufcrankings.org/bantamweight/) (media panel, Nov 5); [MMA Fighting: RAF Abu Dhabi vs Faber](https://www.mmafighting.com/raf-wrestling/513680/umar-nurmagomedov-vs-urijah-faber-set-for-raf-abu-dhabi); [Bloody Elbow, Oct 2](https://bloodyelbow.com/2026/10/02/umar-nurmagomedov-announces-return-to-action-after-brutal-ko-on-show-that-clashes-with-ufc-334/) (search summary); [Lowkick MMA: back in the gym](https://www.lowkickmma.com/umar-nurmagomedov-training-song-yadong-loss/); [MMA Junkie: statement and record](https://mmajunkie.usatoday.com/story/sports/ufc/2026/08/29/umar-nurmagomedov-statement-ufc-shanghai-knockout-loss/91528342007/) (search summary); [Wikipedia](https://en.wikipedia.org/wiki/Umar_Nurmagomedov)
- Photos: [ESPN headshot](https://a.espncdn.com/i/headshots/mma/players/full/4569549.png), [stance left](https://a.espncdn.com/i/headshots/mma/players/stance/left/4569549.png), [stance right](https://a.espncdn.com/i/headshots/mma/players/stance/right/4569549.png)
