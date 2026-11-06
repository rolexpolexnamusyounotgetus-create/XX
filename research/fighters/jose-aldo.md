# Jose Aldo: scouting dossier

As of Friday, Nov 6, 2026. "Dataset" means `data/derived/fighters.json` and the raw ufcstats CSVs, current through Oct 31, 2026.

**Limits of this pass.** The shared web-search budget ran out before Aldo could be searched, and direct page fetches (ESPN, Wikipedia, UFC.com) were blocked from this session. Everything below comes from ufcstats data. His current status (retired or active, rankings, bookings, injuries), pro record and appearance are unverified and marked unknown. A follow-up web pass is needed before the page shows a status line for him.

## Current status (dataset only)

- **Age and frame:** 40 (born Sep 9, 1986), 5'7" with a 70" reach, orthodox.
- **Division:** listed at bantamweight for his recent run, but his last bout was at featherweight.
- **UFC record:** 14-9 (4 KO/TKO, 0 submissions, 10 decisions; losses 4 KO/TKO, 5 decisions).
- **Title history:** 11 UFC featherweight title fights (8-3) from 2011 to 2017, plus a 2020 bantamweight title loss to Petr Yan.
- **Last fight:** a 28-29 x3 decision loss to Aiemann Zahabi at UFC 315 (May 10, 2025). He has had no UFC bout in the 18 months since, through the snapshot.
- **Status:** retired, inactive or booked is **unknown**. Ranking is unknown.

## Recent fights

| Date | Opponent | Result | How (ufcstats) |
|---|---|---|---|
| May 10, 2025 | Aiemann Zahabi (145) | L, UD | Outlanded 99-68 in sig strikes. Aldo dropped Zahabi in R3 but lost every card 28-29. |
| Oct 5, 2024 | Mario Bautista | L, split | He stopped all 10 takedowns but gave up 7:15 of control against the fence. Sig strikes 51-49 to Aldo. |
| May 4, 2024 | Jonathan Martinez | W, UD 30-27 x3 | A comeback win after nearly two years out. Sig strikes 77-52, with 26 of 33 to the body. |
| Aug 20, 2022 | Merab Dvalishvili | L, UD | Merab went 0 for 16 on takedowns but held 5:06 of control and out-threw him 147-67 in sig attempts. |
| Dec 4, 2021 | Rob Font | W, UD (five rounds) | He scored two knockdowns and added 9:06 of his own control. |

## Style

In the UFC data Aldo is a patient counter-striker.

- **Volume:** opponents attempt 10.1 sig strikes per minute against his 7.9, but he lands 45% and held opponents to 41.6% accuracy over his career.
- **Body attack:** 20.7% of his landed strikes go to the body, and he KO'd Jeremy Stephens with body punches in 2018.
- **Kicks and knees:** his older low-kick game is barely present here (6% of attempts to the legs). His clinch knee finished Chad Mendes in 2012.
- **Takedown defence:** elite.

## Strengths

- **Takedown defence:** 91.6% career and 96% time-decayed. Only 9 of 107 UFC attempts against him succeeded.
- **Body work:** accurate body punching.
- **Power:** knockdowns in two of his last five fights (Font, Zahabi).

## Weaknesses

- **Output:** he is out-thrown, and his decayed striking is negative (4.07 landed vs 4.94 absorbed per minute).
- **Cage pressure:** wrestlers can pin him on the fence without completing takedowns.
- **Age:** he is 40 and has lost his last two.

## Durability and cardio

- **Durability:** four UFC KO/TKO losses (McGregor in 13 seconds in 2015, Holloway twice in 2017, Yan in 2020), and three knockdowns absorbed. His time-decayed knockdowns absorbed are low (0.17) because his recent fights went the distance.
- **Cardio:** in 5-round fights his output by round is 1.00, 1.13, 1.07, 0.72 and 0.56 of round 1, a clear late fade.

## What the numbers say

The engine should give Aldo near-immunity to takedowns, a body-heavy target split (17% body attempts, decayed) and decent single-shot power. It should also give him below-average volume and a late-round decline. His decayed Elo is 1645. Against a high-pace opponent he should drop decisions on volume, as the data shows against Zahabi, Merab and Bautista.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/ufc_fight_results.csv`; `data/raw/ufc_fight_stats.csv`
- ufcstats [fighter page](http://ufcstats.com/fighter-details/d0f3959b4a9747e6); fight pages for [Zahabi](http://ufcstats.com/fight-details/891b2faf1bff38ee), [Bautista](http://ufcstats.com/fight-details/3d7d82fff71e395a) and [Martinez](http://ufcstats.com/fight-details/b3d88eaea611a4a8)
- No web sources could be consulted for this fighter in this pass. See the limits note above.
