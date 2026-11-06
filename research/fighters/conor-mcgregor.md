# Conor McGregor ("The Notorious"): scouting dossier

As of Nov 6, 2026. Stats are from `data/derived/fighters.json` and the per-round rows in `data/raw/` (ufcstats snapshot through Oct 31, 2026). **No web source could be read this session** (the shared search budget was used up and news hosts were blocked). The UFC 329 injury detail comes from sources cited in `research/fighters/max-holloway.md`. Anything marked *recalled* comes from memory and needs a fact-check.

## Current status

- **Last fight:** TKO loss to Max Holloway at 1:09 of R1, UFC 329 (Jul 11, 2026, Las Vegas, filed at welterweight). ufcstats gives the reason as "McGregor knee injury". The Holloway dossier, citing [ESPN](https://www.espn.com/mma/story/_/id/49308315/ufc-329-live-results-analysis-conor-mcgregor-vs-max-holloway-2) and [Athlon](https://athlonsports.com/mma/ufc-329-conor-mcgregor-max-holloway-fight-ends-devastating-injury-tko), says he buckled his right leg throwing a kick and was stopped soon after. He landed 0 of 6.
- **Layoff before that:** five years. His previous fight ended with a doctor's stoppage after R1 against Poirier at UFC 264 (Jul 10, 2021), widely reported as a broken leg (*recalled*).
- **Titles:** none now. He won the featherweight title (UFC 194, Dec 12, 2015) and the lightweight title (UFC 205, Nov 12, 2016).
- **Next fight, ranking, diagnosis, retirement:** unknown (not verified). The Holloway dossier cites [UFCalendar](https://www.ufcalendar.com/fighters/max-holloway) saying both men have talked about a third fight. He is 38. His UFC record is 10-5.

## Recent fights

| Date | Opponent | Result | How |
|---|---|---|---|
| Jul 11, 2026 | Max Holloway | L TKO R1 1:09 | His own knee/leg injury |
| Jul 10, 2021 | Dustin Poirier | L TKO (doctor) R1 5:00 | Leg injury at the end of R1. He had landed 27 of 38, including 8 of 8 leg strikes; Poirier had 3:18 of top control |
| Jan 23, 2021 | Dustin Poirier | L KO R2 2:32 | Poirier landed 18 of 21 leg strikes (calf kicks), then punches |
| Jan 18, 2020 | Donald Cerrone | W TKO R1 0:40 | Clinch strikes, a knockdown, then ground punches |
| Oct 6, 2018 | Khabib Nurmagomedov | L SUB R4 3:03 | Taken down 3 times, 12:14 controlled, then a rear-naked choke |
| Nov 12, 2016 | Eddie Alvarez | W KO R2 3:04 | Three knockdowns; out-landed him 32-9 |

## Style

He is a southpaw counter-striker with real one-punch power. He scored 13 knockdowns in 15 UFC fights, 3.1 per 100 head strikes landed, roughly 3.5 times the lightweight league rate. Eight of his ten UFC wins are KO/TKO, and five came in round 1. The knockout of Jose Aldo took 13 seconds. The left hand, often thrown as a counter, is his main weapon (*recalled*). A 74-inch reach on a 5 ft 9 in frame backs it up. He works to the body more at featherweight (15 of 30 body strikes vs Mendes), and he will kick the lead leg when it pays: 40 of 45 leg strikes landed against Diaz at UFC 202.

## Strengths

- Knockdown power and head accuracy: 44% on head strikes career (league 39%).
- Durability on the feet: one knockdown absorbed in 15 UFC fights.
- Fast starts and long reach.

## Weaknesses

- Wrestling: opponents average 250 s of control per 15 min against him (league 171). Khabib and Mendes both held him down for long spells.
- Calf kicks: Poirier landed 18 leg strikes in their second fight.
- Submitted twice by rear-naked choke, both times late in fights (Diaz, Khabib).
- Two straight fights have ended with his own leg injuries.

## Durability and cardio

- **Durability:** his chin has held up (0.27 knockdowns per 100 head strikes absorbed), but his legs have not.
- **Cardio:** a long-standing question. Diaz submitted him in R2 (UFC 196) after he slowed (*recalled*), and Khabib finished him in R4. His 5-round pace numbers (1.00, 1.10, 1.19, 1.28, 0.95 of round 1) beyond R2 rest only on Diaz II and Khabib.

## What the numbers say

His career numbers are excellent: 5.27 significant strikes landed per minute at 49.5% accuracy. But they date from 2013-2021, and his time-decayed sums hold only 5.8 minutes. His Elo of 1668 is 15th among active welterweights. fighters.json files him at welterweight because of UFC 329, though most of his career was at 145 and 155. The engine should give him elite early knockdown power, average takedown defence with long control spells once he is taken down, and a heavy discount for inactivity, age and injuries.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/ufc_fight_results.csv`; `data/raw/ufc_fight_stats.csv`
- ufcstats [fighter page](http://ufcstats.com/fighter-details/f4c49976c75c5ab2); fight pages: [Holloway 2026](http://ufcstats.com/fight-details/989760fa75321d69), [Poirier III](http://ufcstats.com/fight-details/7d0ce28ce8a77eb1), [Poirier II](http://ufcstats.com/fight-details/3d3e7dc7b4bf2bc4), [Khabib](http://ufcstats.com/fight-details/3eea92e7f26fb05b), [Alvarez](http://ufcstats.com/fight-details/1d7015553debd1c8), [Aldo](http://ufcstats.com/fight-details/b302e12550278ffd), [Diaz II](http://ufcstats.com/fight-details/648396cc751c730d)
- Cited via `research/fighters/max-holloway.md` (not opened this pass): ESPN and Athlon UFC 329 reports, UFCalendar
