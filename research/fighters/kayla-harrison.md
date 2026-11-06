# Kayla Harrison: scouting dossier

As of Friday, Nov 6, 2026. She/her. Listed as southpaw by ufcstats, 5'8" with a 66" reach, born Jul 2, 1990 (age 36). Pro record 19-1 (ESPN; talkSPORT); UFC record 3-0 (2 submissions, 1 decision). American Top Team. Two-time Olympic judo champion (2012, 2016) and two-time PFL lightweight tournament winner. "Dataset" means `data/derived/fighters.json` and the raw ufcstats CSVs, current through Oct 31, 2026.

**Update, Nov 6, 2026 (open network).** The first pass had no web access; title, booking, ranking, health and appearance below have now been checked on the web (sources at the end). The fight analysis still comes from ufcstats data.

## Current status

- **Title:** UFC women's bantamweight champion (confirmed). She won the belt with a kimura from side control at 4:55 of round 2 against Julianna Pena at UFC 316 in Newark (Jun 7, 2025), still her last fight.
- **Next:** her first defence, against the returning Amanda Nunes, in the co-main event of UFC 334 at Madison Square Garden, New York, on Sat Nov 14, 2026 (main event Gane vs. Hokit). Joselyne Edwards is the backup fighter. The Independent quoted Betway at 1/2 Harrison, 13/8 Nunes.
- **Why she has been out:** the Nunes fight was first set for UFC 324 (Jan 24, 2026). Nine days out she had surgery in New York for herniated discs in her neck, a two-level cervical fusion, after weeks of arm pain and weakness; the UFC postponed the fight rather than rebook Nunes (Yahoo Sports, Jan 15; talkSPORT). Her ATT coach Anderson Franca said she spent months unable to train and returned to full training in late August (Sherdog, Sep 18). She says she feels "awesome" now but doubted she would ever feel like herself again (Heavy, Oct 12), and has a visible neck scar.
- **Future:** she has talked about retiring after the Nunes fight but has not decided (MMA Sucka, Oct 22).
- **Ranking:** champion and #2 women's pound-for-pound (behind Shevchenko) in the official UFC rankings last updated Nov 3, 2026.

## Recent fights

| Date | Opponent | Result | How (ufcstats) |
|---|---|---|---|
| Jun 7, 2025 | Julianna Pena | W sub R2 4:55 | Won the title. Pena landed 9 significant strikes to her 30. She landed 2 of 3 takedowns, held 6:05 of control and finished with a kimura. |
| Oct 5, 2024 | Ketlen Vieira | W UD 30-27, 30-27, 29-28 | Landed 2 of 8 takedowns but held 7:54 of control. Won the strikes 55-24, 36 of them in the clinch or on the ground. |
| Apr 13, 2024 | Holly Holm | W sub R2 1:47 | UFC debut. She landed 51 significant strikes to 2 (42 on the ground) and finished with a rear-naked choke. |

## Style

A control grappler. She won Olympic judo gold in 2012 and 2016 (Sherdog; Wikipedia's UFC 334 page).

- **Game plan:** she closes to the clinch, takes the fight down and stays on top. Her control is 533 s per 15 min (decayed), against a division 222.
- **Strikes:** 68% of her landed significant strikes come in the clinch or on the ground.
- **Finishes:** both are submissions from dominant positions: a rear-naked choke after taking Holm's back, and a kimura from side control on Pena.

## Strengths

- **Control and top pressure:** opponents have held her for 6 s per 15 min.
- **Takedown defence:** opponents are 0 of 2.
- **Defence on the feet:** opponents land 1.1 significant strikes per minute on her at 34%.
- **Submissions:** 0.95 attempts per 15 min.

## Weaknesses

- **Sample:** tiny (3 fights, 31.7 minutes).
- **Takedown accuracy:** 39% decayed (2 of 8 vs Vieira).
- **Distance striking:** unproven against an elite striker.
- **Layoff and neck:** out since Jun 2025, with a two-level neck fusion in Jan 2026; Nunes is her first fight back.

## Durability and cardio

- **Durability:** no knockdowns absorbed, but the sample is far too small to judge.
- **Cardio:** her only three-round fight (Vieira) went the full 15 minutes with 7:54 of control. Her round 2 output was 2.8 times round 1 against Pena, a one-fight figure.

## What the numbers say

Decayed Elo is 1619, held down by the short UFC record rather than by results. The engine should give her extreme control, low exposure on the feet and submission finishes from top. Because the record is so short, her rates should shrink firmly toward the women's bantamweight prior.

## Sources

- Dataset: `data/derived/fighters.json`; `data/raw/ufc_fight_results.csv`; `data/raw/ufc_fight_stats.csv`
- ufcstats [fighter page](http://ufcstats.com/fighter-details/1af1170ed937cba7) and [UFC 316 event](http://ufcstats.com/event-details/18c49685296c60e6)
- ufcstats fight pages:
  - [Pena](http://ufcstats.com/fight-details/81b84b34f0357fa5)
  - [Vieira](http://ufcstats.com/fight-details/9ea124a13d071186)
  - [Holm](http://ufcstats.com/fight-details/b1ac165326d8f29e)

## Appearance (checked Nov 6, 2026)

No photo-based likeness sheet exists for her (data/likeness/kayla-harrison.json). From the ESPN headshot with the belt (file dated Oct 7, 2025, photo from UFC 316) and full-body cutouts (files dated Jun 5 and Jun 10, 2025; the lettering reads correctly, so they are not mirrored). She has not fought since, so there is no newer fight photo.

- **Build:** tall and very muscular for bantamweight, broad shoulders; 5 ft 8 in, 66 in reach (ufcstats).
- **Hair:** golden to dark blonde with darker roots; tight cornrows straight back for fights; long and wavy when loose.
- **Skin:** light.
- **Tattoos:** none visible on the arms, shoulders, chest, abdomen or legs. A surgical scar on the neck is reported (talkSPORT) but not seen in a photo.
- **Kit:** royal-blue Venum sports bra and shorts with a dark tiger-stripe pattern, blue wrist tape, at UFC 316. The sim uses corner colours.

## Update sources (Nov 6, 2026)

- UFC 334: https://sports.yahoo.com/articles/ufc-334-gane-vs-hokit-140804675.html, https://en.wikipedia.org/w/index.php?title=UFC_334&oldid=1383923531, https://bloodyelbow.com/2026/10/29/kayla-harrison-vs-amanda-nunes-gets-official-backup-fighter-for-ufc-334-as-ailin-perez-misses-out/
- Neck injury and recovery: https://sports.yahoo.com/articles/ufc-324-title-super-fight-114153142.html, https://talksport.com/mma/4641894/kayla-harrison-neck-surgery-amanda-nunes-return-ufc-334/, https://www.sherdog.com/news/news/Kayla-Harrison-back-in-full-training-for-Amanda-Nunes-after-emergency-surgery-202854, https://heavy.com/sports/ufc/kayla-harrison-health-update-ufc-334/
- Retirement talk: https://mmasucka.com/news/kayla-harrison-contemplating-retirement-following-ufc-334/
- Rankings: https://web.archive.org/web/20261104014009/https://www.ufc.com/rankings and https://ufcrankings.org/
- Record and gym: https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes/4332765
- Photos: https://a.espncdn.com/i/headshots/mma/players/full/4332765.png, https://a.espncdn.com/i/headshots/mma/players/stance/left/4332765.png, https://a.espncdn.com/i/headshots/mma/players/stance/right/4332765.png

Still unconfirmed: the exact surgery date (reported the day before the Jan 15 announcement), how the neck fusion affects her grappling, and any decision on retirement.
