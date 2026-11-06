# Alexandre Pantoja: scouting dossier

As of Friday, Nov 6, 2026. "Dataset" means `data/derived/fighters.json` and the raw ufcstats CSVs, current through Oct 31, 2026.

**Limits of this pass.** The shared web-search budget ran out before Pantoja could be searched directly, and direct page fetches were blocked. Fight results and stats come from ufcstats. UFC 323 and UFC 331 context comes from sources cited in the project's `data/scouting/joshua-van.json`, which another agent verified. His current ranking, post-UFC 331 plans, pro record and appearance are unverified.

## Current status

- **Age and frame:** 36 (born Apr 16, 1990), 5'5" with a 67" reach, orthodox. Nickname "The Cannibal".
- **UFC record:** 14-5 (2 KO/TKO, 6 submissions, 6 decisions).
- **Title reign:** he won the flyweight title from Brandon Moreno by split decision at UFC 290 (Jul 8, 2023). He then defended it four times: Brandon Royval (UD, Dec 2023), Steve Erceg (UD, May 2024), Kai Asakura (RNC, Dec 2024) and Kai Kara-France (RNC, Jun 2025).
- **Losing the belt:** he lost the title to Joshua Van at UFC 323 (Dec 6, 2025) when an arm injury ended the fight at 0:26 of round 1 (ufcstats: "Arm injury to Pantoja").
- **Rematch:** he lost to Van by unanimous decision at UFC 331 (Sep 19, 2026). ufcstats cards were 49-46, 48-47 and 50-45. The Van file notes outlets called it a Fight of the Year contender.
- **Unknowns:** ranking, next fight and any new injuries are not verified. Van's next defence is against Manel Kape at UFC 336 (Jan 30, 2027), per the Van file.

## Recent fights

| Date | Opponent | Result | How (ufcstats) |
|---|---|---|---|
| Sep 19, 2026 | Joshua Van (title) | L, UD | He went 5 of 18 on takedowns with 9:11 of control. Van out-landed him 181-147, including 158 head strikes, and scored a knockdown. Sherdog had all judges giving Pantoja R4 and Van R5. |
| Dec 6, 2025 | Joshua Van (title) | L, TKO R1 0:26 | He hurt his arm on the ground early. |
| Jun 28, 2025 | Kai Kara-France (title) | W, RNC R3 1:55 | 3 of 6 takedowns, 7:20 of control and 2 submission attempts. |
| Dec 7, 2024 | Kai Asakura (title) | W, RNC R2 2:05 | He out-landed Asakura 32-17, then took the back. |
| May 4, 2024 | Steve Erceg (title) | W, UD | 9 of 19 takedowns and 8:15 of control. Sig strikes 125-111. |

## Style

Pantoja is a pressure grappler.

- **Grappling:** he chains takedowns (2.8 per 15 min career, 3.7 time-decayed, against a 1.65 flyweight average) into long control phases. That includes 15:51 of control against Royval in their 2023 title fight. Every one of his six submission wins came from the back: five rear-naked chokes and a standing neck crank.
- **Striking:** his target mix is close to the flyweight average. His defence is not: opponents land 53% of their head strikes on him (time-decayed), against a 37.5% division average. He trades freely and accepts damage to get to grappling range.

## Strengths

- **Control and back takes:** elite rates of control (23.8 s/min decayed) and back takes.
- **Submissions:** 0.88 submission attempts per 15 min career.
- **Accuracy:** 52% sig accuracy (decayed), against 45.6% for the division.
- **Experience:** five title wins, including five-round decisions.

## Weaknesses

- **Absorbing damage:** 5.15 sig absorbed per minute (decayed) against a 3.69 flyweight average.
- **Strikers who stay up:** a fast striker who survives the grappling, as Van did, can outwork him over 25 minutes.
- **Takedown success:** 5 of 18 in the rematch.
- **Age and form:** he is 36 and coming off two straight losses.

## Durability and cardio

- **Durability:** he has never been stopped by strikes in the UFC. His only stoppage loss is the arm injury. He has been knocked down twice in 19 UFC fights, once by Van in the rematch.
- **Cardio:** in 5-round fights his output by round is 1.00, 0.92, 1.03, 0.56 and 1.16 of round 1. He keeps going into round 5, with a round-4 dip, in a small sample.

## What the numbers say

The engine should drive Pantoja's chances through grappling: high takedown attempts, long control and back-take submission threats, especially in rounds 2-3. Against him, opponents should land often on the feet. If his takedowns are defended or he loses scrambles, the fight becomes a striking contest he tends to lose. His decayed Elo is 1675.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/ufc_fight_results.csv`; `data/raw/ufc_fight_stats.csv`
- ufcstats [fighter page](http://ufcstats.com/fighter-details/a0f0004aadf10b71); fight pages for [Van 2](http://ufcstats.com/fight-details/568ec6af4008355a), [Van 1](http://ufcstats.com/fight-details/dfa692db6d39330c), [Kara-France](http://ufcstats.com/fight-details/8308464729ea7c40), [Asakura](http://ufcstats.com/fight-details/e761c5009c09b295) and [Erceg](http://ufcstats.com/fight-details/3f419fce8ba8aa0e)
- As cited in `data/scouting/joshua-van.json`: [CBS: UFC 323 result](https://www.cbssports.com/ufc/news/ufc-323-results-highlights-joshua-van-champion-alexandre-pantoja-injury/); [Sherdog: UFC 331 play-by-play](https://www.sherdog.com/news/news/UFC-331-Van-vs-Pantoja-2-playbyplay-results-round-scoring-202850); [Yahoo: UFC 331 live](https://sports.yahoo.com/mma/live/ufc-331-live-results-joshua-van-vs-alexandre-pantoja-2-updates-round-by-round-scoring-and-highlights-181500506.html)
