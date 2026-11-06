# Natalia Silva: scouting dossier

As of Friday, Nov 6, 2026. She/her. Southpaw, 5'4" with a 65" reach, born Feb 3, 1997 (age 29). Pro record 21-5-1, on a 15-fight win streak (ESPN, Wikipedia, The Independent); UFC record 9-0 (2 KO/TKO, 7 decisions). Team Borracha, Ipatinga, Brazil; taekwondo background. "Dataset" means `data/derived/fighters.json` and the raw ufcstats CSVs, current through Oct 31, 2026.

**Update, Nov 6, 2026 (open network).** The first pass had no web access; status, ranking, booking, injury and appearance below have now been checked on the web (sources at the end). The fight analysis still comes from ufcstats data.

## Current status

- **Title:** UFC women's flyweight champion. She was booked to challenge Valentina Shevchenko at UFC 332 in Salt Lake City (Oct 3, 2026); Shevchenko was injured and vacated on Sep 5, and Silva beat Wang Cong for the vacant title by unanimous decision (48-47, 48-47, 49-46).
- **Path to the title:** wins over Rose Namajunas (Jan 24, 2026, as a replacement for Alexa Grasso), Alexa Grasso (May 10, 2025) and Jessica Andrade (Sep 7, 2024).
- **Ranking:** champion and #4 women's pound-for-pound in the official UFC rankings last updated Nov 3, 2026.
- **Next:** no first defence booked as of Nov 6, 2026. She said she wants to be an "active champion" and named no one (Heavy, via MMA Junkie); she has told Shevchenko to "get in line". Early odds favour Shevchenko (-190) in a possible fight and Silva (-300) against Grasso (Sherdog, Oct 7).
- **Injuries:** none reported after UFC 332; post-fight photos show a small tape strip under her right eye.

## Recent fights

| Date | Opponent | Result | How (ufcstats) |
|---|---|---|---|
| Oct 3, 2026 | Wang Cong | W UD (5 rds) | Won the title. She dropped Wang in round 2 and won the significant strikes 109-98, with 28 of 39 to the body. Wang won the leg exchanges (34 of 56) and closed with 2:39 of control in rounds 4-5. |
| Jan 24, 2026 | Rose Namajunas | W UD 29-28 x3 | 51-26 on strikes, 18 of 24 leg kicks landed. |
| May 10, 2025 | Alexa Grasso | W UD 30-27 x3 | 65-45 on strikes, 64 of the 65 at distance. |
| Sep 7, 2024 | Jessica Andrade | W UD 30-27 x3 | 117-50 on strikes, 38 of 45 to the body. |
| Feb 3, 2024 | Viviane Araujo | W UD 29-28 x3 | Araujo held 6:01 of control on 1 of 9 takedowns. |

## Style

A southpaw kickboxer who fights at range: 95% of her significant attempts come at distance.

- **Volume:** 9.9 attempts and 4.5 landed per minute (decayed), against division norms of 9.2 and 4.0.
- **Targets:** she goes to the body and legs more than most (15% and 11% of attempts) and lands 68% and 83% there. Her head accuracy is 36%, about average.
- **Finishes:** a spinning back kick to the head (Bleda, 2022) and a single punch (Leonardo, 2023).

## Strengths

- **Defence on the feet and mat:** opponents land 38.5% on her, and she stops 89% of takedowns (90% career, 3 of 31).
- **Power:** 0.84 knockdowns per 100 significant head strikes landed, three times the division rate.
- **Body and leg kicking:** accurate work to both targets.
- **Pace:** her output rises through fights.

## Weaknesses

- **Finishing:** her last six wins went to the cards.
- **Control:** grapplers can hold her even when they don't take her down (Araujo).
- **Title experience:** only one five-round fight, and it was close against Wang Cong.

## Durability and cardio

- **Durability:** no knockdowns absorbed in nine UFC fights.
- **Cardio:** a standout. In full rounds of 3-round fights she lands 18.7, 23.6 and 28.5 significant strikes in rounds 1, 2 and 3. In her one five-rounder her pace ran 1.00, 0.81, 1.44, 1.50 and 2.06 of round 1, and she landed 33 in round 5.

## What the numbers say

Decayed Elo is 1722, second in this batch behind Shevchenko. The engine should give her a high-volume distance game, strong body and leg accuracy, elite takedown defence, a late surge and above-average power. She has little offensive wrestling: 0.9 takedowns per 15 min decayed.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/ufc_fight_results.csv`; `data/raw/ufc_fight_stats.csv`
- ufcstats [fighter page](http://ufcstats.com/fighter-details/262d32ebda89efc4) and [UFC 332 event](http://ufcstats.com/event-details/ad3fdba28a7540cf)
- ufcstats fight pages:
  - [Wang Cong](http://ufcstats.com/fight-details/3f804eec9183e597)
  - [Namajunas](http://ufcstats.com/fight-details/d63c9aa4f4873001)
  - [Grasso](http://ufcstats.com/fight-details/0f53eb509d0ffeb9)
  - [Andrade](http://ufcstats.com/fight-details/bcfaf1dd78f12f97)
  - [Araujo](http://ufcstats.com/fight-details/7b1882dc76786d77)
  - [Bleda](http://ufcstats.com/fight-details/33719a2d9c69ed17)
  - [Leonardo](http://ufcstats.com/fight-details/744cbe6e49d4f41c)

## Appearance (checked Nov 6, 2026)

No photo-based likeness sheet exists for her (data/likeness/natalia-silva.json). From the ESPN headshot and full-body cutout with the belt after UFC 332 (files dated Oct 5, 2026) and the May 8, 2025 ESPN cutout; the lettering reads correctly, so they are not mirrored.

- **Build:** compact flyweight; 5 ft 4 in, 65 in reach (ufcstats and ESPN; Wikipedia lists 5 ft 5 in).
- **Hair:** dark brown; long and curly with lighter caramel ends when loose; tight cornrows back into a bun at the crown for fights.
- **Skin:** medium.
- **Tattoos:** none visible on the arms, shoulders, chest or abdomen.
- **Kit:** yellow-and-olive tiger-stripe Brazil kit with DA SILVA in green down the left leg (UFC 315 fight week, May 2025); black-and-gold champion's jersey over black shorts after UFC 332 (fight-night shorts colour not checked). The sim uses corner colours.

## Update sources (Nov 6, 2026)

- UFC 332 and title: https://www.espn.co.uk/mma/story/_/id/49839558/shevchenko-injured-vacates-silva-wang-vie-belt-ufc-332, https://sports.yahoo.com/articles/natalia-silva-crowned-women-flyweight-081224191.html, https://heavy.com/sports/ufc/natalia-silva-whats-next-ufc-332/, https://www.sherdog.com/news/news/Natalia-Silva-vs-Valentina-Shevchenko-odds-UFC-champ-opens-as-underdog-203109
- Record and background: https://en.wikipedia.org/w/index.php?title=Nat%C3%A1lia_Silva_(fighter)&oldid=1380885438 and https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/4054605
- Rankings: https://web.archive.org/web/20261104014009/https://www.ufc.com/rankings and https://ufcrankings.org/
- Photos: https://a.espncdn.com/i/headshots/mma/players/full/4054605.png, https://a.espncdn.com/i/headshots/mma/players/stance/left/4054605.png, https://a.espncdn.com/i/headshots/mma/players/stance/right/4054605.png

Still unconfirmed: her first title defence (none booked) and her fight-night kit at UFC 332.
