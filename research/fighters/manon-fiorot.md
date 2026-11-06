# Manon Fiorot ("The Beast"): scouting dossier

As of Nov 6, 2026. Stats: `data/derived/fighters.json` and `data/raw/` (ufcstats snapshot to Oct 31, 2026). **No web source was reachable this session** (search budget spent, news hosts blocked). *Recalled* marks memory that needs a fact-check.

## Current status

- **Last fight:** lost to Alexa Grasso by unanimous decision, 28-29 x3, at Noche UFC (Sep 12, 2026, Glendale). She was dropped in R1.
- **Before that:** stopped Jasmine Jasudavicius with ground punches at 1:14 of R1 (Oct 18, 2025, Vancouver). Lost a 47-48 x3 decision to Valentina Shevchenko for the flyweight title at UFC 315 (May 10, 2025, Montreal).
- **Division context (dataset):** Natalia Silva won a women's flyweight title bout over Wang Cong at UFC 332 (Oct 3, 2026).
- **Titles:** none.
- **Ranking, next fight, injuries:** unknown (not verified). She is 36, French with a karate background (*recalled*), and her UFC record is 8-2.

## Recent fights

| Date | Opponent | Result | How |
|---|---|---|---|
| Sep 12, 2026 | Alexa Grasso | L UD 28-29 x3 | Dropped and out-landed 33-21 in R1, then edged R2 (24-23) and R3 (27-24). Landed 72 of 226; 19 of 26 to the body |
| Oct 18, 2025 | Jasmine Jasudavicius | W TKO R1 1:14 | 16 of 27 landed, the last 8 on the ground |
| May 10, 2025 | Valentina Shevchenko | L UD 47-48 x3 | Clinch game: 29 of 33 clinch strikes, 35 of 37 to the body, 7:07 of control. But 1 of 12 takedowns, 17 of 19 Shevchenko leg strikes absorbed, and dropped in R4 |
| Mar 30, 2024 | Erin Blanchfield | W UD 50-45 x3 | Landed 172 of 359 and stuffed all 3 takedowns. Out-landed her 88-64 over R4-R5 |
| Sep 2, 2023 | Rose Namajunas | W UD | Out-landed 60-58 on 225 attempts but won 30-27, 29-28 x2. Stuffed 6 of 6 takedowns |

## Style

She is a volume striker. She throws 13.6 significant strikes per minute over her career, about 1.5 times the flyweight average, mostly punches to the head with a busy body attack. Body strikes are 12% of her attempts but 23% of what she lands. Against Shevchenko she switched to the clinch: 29 of 33 clinch strikes and 35 of 37 body strikes landed. ufcstats does not say whether those were knees or punches. She kicks the legs rarely. Her three KO/TKO wins all came when she swarmed a hurt opponent.

## Strengths

- Output: she lands 5.56 significant strikes per minute career (division 3.98).
- Takedown defence: 87.5% career. Opponents average 44 s of control per 15 min against her (decayed; division 180).
- Late rounds: she out-landed both five-round opponents in R5.

## Weaknesses

- Accuracy: 39% decayed (division 43%). She lands only about a quarter of her head strikes against good movers (51 of 196 vs Grasso, 39 of 197 vs Namajunas).
- Leg-kick defence: 0.81 leg strikes absorbed per minute, decayed (division 0.63).
- Her own takedowns: 9 of 31.
- Sharp counter-punchers drop her: once each by Shevchenko and Grasso.

## Durability and cardio

- **Durability:** no KO losses, but two knockdowns absorbed, both in her two losses. That is 0.65 per 100 head strikes absorbed (division 0.25).
- **Cardio:** a clear strength. Her output in five-round fights runs 1.00, 0.95, 1.05, 1.46 and 1.46 of round 1, against a division curve of 1.00, 0.90, 1.01, 1.14, 1.32. That is two fights only.

## What the numbers say

Her Elo is 1672, fourth among active flyweights, behind Shevchenko (1750), Silva (1722) and Blanchfield (1676), all three of whom she has fought. The engine should give her very high volume, below-average accuracy, near-immunity to takedowns, a pace that holds or rises late, and modest single-shot power (1 knockdown scored in 10 UFC fights). Against counter-strikers, or opponents who kick her legs, she should lose close decisions. Against fighters who need takedowns she should win on volume.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/ufc_fight_results.csv`; `data/raw/ufc_fight_stats.csv`
- ufcstats [fighter page](http://ufcstats.com/fighter-details/34ff304266360297); fight pages: [Grasso](http://ufcstats.com/fight-details/d9712b45c094730e), [Jasudavicius](http://ufcstats.com/fight-details/c82acd7b17915591), [Shevchenko](http://ufcstats.com/fight-details/9e9d1764a015f313), [Blanchfield](http://ufcstats.com/fight-details/e6d4fdad2b3422d1), [Namajunas](http://ufcstats.com/fight-details/4eaf54ad3c82b6fa), [Silva vs Wang](http://ufcstats.com/fight-details/3f804eec9183e597)
