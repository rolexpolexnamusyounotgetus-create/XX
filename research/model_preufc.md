# Pre-UFC records (Sherdog) for newcomer prediction

Nov 6, 2026. Tool: `tools/preufc.py`. Output: `data/derived/preufc.json`. Raw pages: `data/raw/sherdog_cache/`
(gitignored, 191 MB, 1,749 fighter pages and 75 fight-finder searches). Data: ufcstats snapshot through
Oct 31, 2026; Sherdog fighter pages fetched Nov 6, 2026 at no more than one request per second
(robots.txt allows all agents; User-Agent `FightLabSim/1.0`).

This is the relaunch of the preufc fit that stopped on the usage cap. The crawl, the parser and a first
evaluation were done; this run added a leakage audit (and fixed the one leak it found), ablations, a stack on
tools/ml.py's probabilities, tuned fades for the finish models, live roster coefficients and this report.

## Bottom line

- **Coverage is complete for the targets.** All 1,711 targets (1,229 roster fighters plus 482 other fighters
  who had a UFC bout with 0-3 prior UFC fights since 2015) resolve to a Sherdog page that contains every one of
  their 12,178 ufcstats bouts. An independent check against Wikidata's Sherdog IDs agrees on 1,102 of 1,105;
  the three differences are Wikidata errors (two point to other fighters' pages, one to a dead page). What I
  cannot measure is how complete Sherdog itself is for small regional shows (see Caveats).
- **The pre-UFC record helps predict newcomer bouts out of sample.** On the 803 decisive 2024+ bouts where at
  least one man had 0-3 prior UFC fights (held out, settings chosen by time-ordered CV on 2015-2023):
  - UFC-stat logistic: 0.6482 -> **0.6336** log loss, **-0.0147 [-0.0214, -0.0081]**, accuracy 61.8% -> 64.5%,
    calibration error 0.046 -> 0.038.
  - Elo seeded at debut with the pre-UFC record: 0.6808 -> **0.6495**, **-0.0313 [-0.0432, -0.0201]**
    (age at debut alone gets -0.006 of that). Across all 1,501 decisive 2024+ bouts the seeded Elo goes
    0.6782 -> 0.6553: veterans' bouts improve too, because their opponents' ratings were seeded better.
  - On top of tools/ml.py's walk-forward ML probabilities (525 backtest bouts 2024+ with a 1-3 fight side):
    0.6315 -> **0.6209**, **-0.0106 [-0.0206, -0.0005]**.
- **It adds nothing to the closing line.** With the BFO close in the model the change is -0.0020
  [-0.0064, +0.0023], and CV on 2015-2023 did not want it either. The market already prices regional
  records. The pre-UFC block closes about a fifth of the UFC-stat model's gap to the close on newcomer bouts
  (0.068 -> 0.054); the rest is information we do not have.
- **It also helps "how".** KO / SUB / DEC for newcomer bouts: METHOD_DELTA. Per-side finish models (win by
  KO, win by submission, lose by KO) all improve; the regional KO rate says the most about power, the
  regional KO-loss rate somewhat less about chin.
- **No leakage found that matters.** The only leak (a network built from pages chosen by who reached the
  UFC later) is fixed; the leaky and strict versions score the same on 2024+ (-0.0003 [-0.0011, +0.0004]).
- **Recommendation:** seed every newcomer in the Elo baseline and the stack with the pre-UFC record (per-fight
  walk-forward probabilities and per-fighter shifts are in preufc.json); add the pre-UFC block to tools/ml.py;
  in the simulator, shift newcomers' power, chin and submission priors by their regional finish rates and
  their overall level by the seeded-Elo shift, fading with UFC experience. Do not add it on top of a market
  line. Details below.

## Data

### What was collected

For each target fighter, the Sherdog pro fight history (result, opponent and opponent page, event, date,
method, round, time), bio (birth date, nationality, locality, association, weight class) and the amateur and
pro-exhibition sections. Each UFC bout gets a snapshot of the record before it:

| Field | Meaning |
|---|---|
| `n w l d nc` | non-UFC pro record before the bout (amateur and exhibitions excluded) |
| `ko_w sub_w dec_w oth_w`, `ko_l sub_l dec_l oth_l` | non-UFC wins and losses by method |
| `streak`, `streak_all`, `lstreak_all`, `l5_w/l5_n` | win streak entering the UFC; overall win/loss streak entering the bout; last-5 non-UFC |
| `years_active`, `age_pro_debut`, `layoff_days`, `n_2y` | career length, age at pro debut, days since last fight, fights in 2 years |
| `promos`, `n_promos`, `last_promo` | promotions (Sherdog event prefix, about 30 big organizations merged by alias) |
| `dwcs_w/dwcs_n` | Dana White's Contender Series (not in ufcstats, counted as pre-UFC) |
| `promo_feed`, `promo_feed_max` | feeder strength: log(1 + 1000 x share of UFC debutants before the bout date who came through the promotion), mean and max over the last 6 non-UFC fights |
| `promo_grad` | the promotion's graduates' win rate in their first 3 UFC bouts dated before the bout (shrunk to 0.5 with 10 pseudo-bouts) |
| `opp_ufc_w/opp_ufc_n` | non-UFC wins / fights against men who already had a UFC bout |
| `net_elo_h`, `opp_wpct_h`, `opp_known_h` | strict walk-forward network Elo and opponents' pre-fight win share (below) |
| `exh_n/exh_w` | pro exhibitions (TUF house fights) |

`fighters[slug]` holds the Sherdog link and bio, `debut` (the record entering the UFC), `current` (as of
today, including fights between or after UFC stints), `snapshots` (one row per UFC bout, columns in
`meta.snapshot_columns`) and `fights` (the full pro list, each row tagged with its ufcstats fight id when it is
a UFC bout).

### How fighters were matched

1. Graph links first: a verified page lists every opponent with a link; an opponent row that matches one of
   the page owner's ufcstats bouts (date within 3 days, similar name) gives that opponent's Sherdog page.
   1,675 fighters resolved this way.
2. Otherwise Sherdog's fight finder (full name, name without suffixes, first + last, last name, nickname),
   candidates ranked by name, nickname and weight: 36 fighters. Four ring names are aliased by hand to the
   legal names Sherdog uses (Loma Lookboonmee, CM Punk, Blood Diamond, Tina Black).
3. A page counts only if its pro history contains the fighter's ufcstats bouts (date within 3 days and a
   similar opponent name): at least min(2, n) and at least half of them. In the final build every one of the
   12,178 ufcstats bouts of the 1,711 fighters is found.

### Coverage

| Item | Count |
|---|---|
| Targets: roster (fought since 2021) + every fighter with 0-3 prior UFC bouts in a bout since Jan 1, 2015 | 1,711 |
| Resolved to a verified Sherdog page | 1,711 (100%) |
| ufcstats bouts of those fighters found in their Sherdog histories | 12,178 of 12,178 |
| Same Sherdog ID as Wikidata (P2818), where Wikidata has one | 1,102 of 1,105 (3 Wikidata errors, checked) |
| Birth date on both sources / within one day | 1,694 / 1,603 (94.6%) |
| Pro fight rows parsed / non-UFC / UFC rows ufcstats lacks | 35,968 / 23,704 / 86 |
| Non-UFC rows with a dated event and a linked opponent page | 100% |
| Fighters with an amateur section (excluded from the record) / pro exhibitions (TUF) | 854 / 239 |
| Debutants with no pro fight before the UFC | 2 (CM Punk, Mike Jackson) |
| Evaluation sides with 0-3 prior UFC bouts, 2015-2023 / 2024+ | 3,720 / 1,125, all with a record |
| Debut sides, 2015-2023 / 2024+ | 1,023 / 327, all with a record |

The UFC's debutants since 2015 are a complete set: every one was crawled, so the feeder-strength and
graduate-results features can be computed as of any date in the window. Veterans who debuted before 2015 are
in the data only if they fought in 2021 or later (the roster), so in 2015-2020 rows some veteran opponents
have no record (imputed at the mean, with no missing flag, because being on the roster tracks future
success). In 2024+ every veteran opponent is on the roster.

### What a debutant's record looks like (2015-2026, 1,350 decisive debut sides)

Median 10 pro fights before the UFC (IQR 7-14), median one loss, 32% undefeated, median finish share of wins
0.79, median age at pro debut 22.5, median 5.1 years from pro debut to UFC debut, median win streak 5.
Contender Series winners went from none in 2015-2016 to 32% of debutants in 2018 and 40-57% since 2021.
The promotions that sent the most debutants since 2015: Contender Series 435, LFA 264, Bellator 140,
KOTC 95, CFFC 83, PFL/WSOF 80, Cage Warriors 73.

Debutant win rate against men with UFC experience, 2015-2023 only (753 sides; overall 43.2%; 95% intervals):

| Pre-UFC feature | Bucket: win rate (n) |
|---|---|
| Losses before the UFC | 0: 51.2% +- 6.2 (250); 1: 46.2% +- 7.2 (186); 2: 33.6% +- 8.6 (116); 3-4: 34.9% +- 8.3 (126); 5+: 37.3% +- 10.9 (75) |
| Pro fights before the UFC | 0-5: 50.7% (69); 6-9: 45.7% (256); 10-14: 41.2% (221); 15-19: 42.9% (119); 20+: 35.2% (88) |
| Win streak entering | 0-2: 41.1% (163); 3-5: 37.8% (262); 6-9: 46.0% (248); 10+: 56.2% (80) |
| Contender Series win | no: 39.8% +- 4.0 (563); yes: 53.2% +- 7.1 (190) |
| Feeder strength (promo_feed) | <1.5: 42.6% (148); 1.5-2.5: 39.4% (213); 2.5-3.5: 41.4% (220); 3.5+: 50.6% (172) |
| Strict network Elo at debut | <1560: 41.2% (68); 1560-1599: 43.7% (311); 1600-1639: 38.5% (262); 1640+: 53.6% (112) |
| Age at pro debut | <21: 47.6% (252); 21-23: 41.7% (242); 24-26: 36.1% (183); 27+: 50.0% (76) |
| Finish share of wins | <50%: 47.9% (48); 50-74%: 39.7% (237); 75-89%: 42.1% (254); 90%+: 47.2% (214) |

Long records are not a plus: many fights before the UFC mostly means a late signing. Losses, the feeder
promotion, Contender Series wins and a long current streak carry the signal.

## Walk-forward design

- **Snapshots.** A UFC bout dated D counts only Sherdog pro fights dated strictly before D; rows matched to
  ufcstats bouts, and any UFC-promoted row, are UFC experience and never part of the non-UFC record.
- **Feeder quality.** Graduates (debutants who fought in a promotion before their UFC debut) and their
  first-3 UFC results are counted only if they happened before D.
- **The leak that was fixed.** The first build rated opponents in a network made of every cached page. Which
  pages are cached depends on the future: a regional opponent who reached the UFC in 2025 has his whole
  history in that network, one who never did has only his fights against cached fighters. `StrictNetwork`
  rebuilds the network per calendar year: a bout in year Y uses only pages of UFC debutants whose first UFC
  bout falls in [2015-01-01, Jan 1 of Y), a complete set chosen by facts known before Y, plus the fighter's
  own rows (a one-sided Elo walk against opponents rated in that network when his own page is not in it).
  The models use the strict versions; the leaky ones stay in the file as `net_elo` / `opp_wpct` for
  reference. In practice the two network Elos correlate at 0.996 (the network Elo is mostly the fighter's
  own result sequence), and the scores are the same (Audit).
- **Splits.** Rows: decisive UFC bouts (draws and no-contests out) with at least one side at 0-3 prior UFC
  bouts. Train/tune 2015-2023 (2,569 bouts), with time-ordered CV years 2019-2023 (fit on every earlier year,
  score year Y) for every choice of features, penalty and fade. Test 2024-01-01 to 2026-10-31 (803 bouts).
  Confidence intervals: 2,000 bootstrap resamples of fight dates (cards), paired for differences.
- **Second look at 2024+.** The first run of this tool scored 2024+ with the leaky network. This run changed
  the network for a leakage reason, not a score reason, and chose every setting by CV again, but the 2024+
  numbers below are a second look at the held-out years.
- **Models.**
  - `elo`: walk-forward Elo over every UFC bout since 1994 (K 44, first-5-bout boost 1.5, the tools/build_db.py
    rule; matches backtest.json's Elo to rounding).
  - `base`: symmetric no-intercept logistic on side differences of Elo, age, reach, height, log UFC fights,
    UFC win log-odds, UFC finish-win and finished-loss rates, layoff and shrunk decayed UFC rates (strikes
    landed and absorbed per minute, accuracy, defense, takedowns per 15, takedown accuracy and defense,
    submission attempts, knockdowns for and against, control for and against).
  - `base+pre` / `elo+pre`: the same plus the pre-UFC block (core set: win log-odds, log fights, finish-win
    and finished-loss rates, streak, feeder strength, graduates' results, wins over UFC fighters, strict network
    Elo, Contender Series win, age at pro debut), each multiplied by exp(-n_UFC / tau) so it fades with UFC
    experience. CV chose the core set over the 20-feature set, C 0.01 and tau 8 (pre-UFC information is still
    useful after 4-6 UFC fights).
  - `elo_seed_*`: Elo whose debut rating is 1500 + beta . z(pre-UFC record at debut [+ age at debut]); beta is
    fit by minimizing the Elo log loss of the newcomer bouts in the training years, differentiating through
    every Elo update; every later update is the normal Elo rule.
  - `gbm_*`: LightGBM with corner-swap augmentation (reported, not recommended: it overfits at this size).

## Results: who wins (2024+ newcomer bouts, 803)

| Model | Log loss [95% CI] | Brier | Accuracy | Calibration error |
|---|---|---|---|---|
| Elo | 0.6808 [0.6701, 0.6923] | 0.2439 | 55.7% | 0.039 |
| Elo seeded with age at debut | 0.6751 [0.6582, 0.6924] | 0.2407 | 58.7% | 0.039 |
| Elo seeded with pre-UFC record | 0.6493 [0.6332, 0.6658] | 0.2289 | 60.6% | 0.047 |
| **Elo seeded with pre-UFC record + age** | **0.6495 [0.6324, 0.6664]** | 0.2290 | 60.9% | **0.029** |
| Elo + pre-UFC (logistic) | 0.6490 [0.6354, 0.6632] | 0.2287 | 60.8% | 0.052 |
| UFC-stat logistic (base) | 0.6482 [0.6308, 0.6666] | 0.2283 | 61.8% | 0.046 |
| **base + pre-UFC** | **0.6336 [0.6154, 0.6525]** | **0.2217** | **64.5%** | 0.038 |
| LightGBM base / + pre-UFC | 0.7066 / 0.6946 | 0.2467 / 0.2426 | 60.9% / 62.3% | 0.088 / 0.077 |

Paired differences (negative = better):

| Comparison | Mean [95% CI] | P(better) |
|---|---|---|
| base + pre-UFC minus base | **-0.0147 [-0.0214, -0.0081]** | 1.00 |
| base + pre-UFC minus Elo | -0.0473 [-0.0640, -0.0315] | 1.00 |
| seeded Elo (pre + age) minus Elo | **-0.0313 [-0.0432, -0.0201]** | 1.00 |
| seeded Elo (age only) minus Elo | -0.0058 [-0.0152, +0.0038] | 0.88 |
| Elo + pre-UFC minus Elo | -0.0318 [-0.0422, -0.0224] | 1.00 |
| seeded Elo (pre + age) minus base | +0.0013 [-0.0127, +0.0157] | 0.42 |

The seeded Elo, with one rating per fighter and nothing else, matches the full UFC-stat logistic on newcomer
bouts and is the best calibrated model here.

Subgroups (test log loss):

| Group | n | Elo | base | base + pre | seeded Elo (pre + age) |
|---|---|---|---|---|---|
| A debutant in the bout | 278 | 0.6709 | 0.6526 | 0.6335 | 0.6299 |
| Newcomers with 1-3 UFC fights (no debutant) | 525 | 0.6860 | 0.6459 | 0.6336 | 0.6600 |
| Both men newcomers | 322 | 0.6754 | 0.6394 | 0.6303 | 0.6379 |
| Newcomer vs veteran (4+ fights) | 481 | 0.6844 | 0.6541 | 0.6357 | 0.6573 |

The seeding matters most at the debut (0.0410 better than Elo) and still helps with 1-3 UFC fights (0.0260).

Every decisive 2024+ bout (does seeding hurt anyone?):

| Set | n | Elo | seeded (age) | seeded (pre) | seeded (pre + age) |
|---|---|---|---|---|---|
| All decisive 2024+ bouts | 1,501 | 0.6782 (56.0%) | 0.6707 | 0.6557 | 0.6553 (60.1%) |
| Backtest rule (both men >= 1 prior UFC bout) | 1,223 | 0.6799 (54.9%) | 0.6729 | 0.6601 | 0.6610 (59.3%) |

Calibration on 2024+ (10 bins, predicted vs observed): seeded Elo 0.264/0.167 (n 18), 0.364/0.342 (79),
0.459/0.500 (204), 0.550/0.562 (233), 0.648/0.687 (198), 0.741/0.739 (69); base + pre 0.258/0.308 (39),
0.356/0.327 (107), 0.450/0.462 (169), 0.550/0.595 (232), 0.644/0.664 (149), 0.744/0.844 (90),
0.830/0.875 (16). Both are mildly underconfident at the top, as most models are on 2024+.

What carries the weight (base + pre coefficients, per SD of the side difference): feeder strength +0.115,
finish-win rate +0.089, finished-loss rate -0.089, wins over UFC fighters +0.061, network Elo +0.056,
Contender Series win +0.048, win log-odds +0.046, age at pro debut -0.031. Seeded Elo, held-out fit (Elo
points per SD): network Elo +41.9, age at UFC debut -38.4, log fights -29.3, feeder strength +20.5,
finished-loss rate -17.5, finish-win rate +16.0, win log-odds -15.8 (collinear with network Elo),
Contender Series +10.3, wins over UFC fighters +9.7, graduates' results +9.3, streak +4.3.

### On top of tools/ml.py

ml.json has out-of-fold probabilities for 2019-2023 backtest bouts (annual expanding refits) and 2024+
probabilities from models fit on 2010-2023. Backtest bouts require a prior UFC fight from both men, so the
rows here are bouts with a 1-3 fight side (931 out-of-fold, 525 test). Stack: symmetric logistic on
logit(p) plus the faded pre-UFC block, C and tau by year-ahead CV inside the out-of-fold rows.

| Source | raw | calibrated (CV / test) | + pre-UFC (CV / test) | + pre minus calibrated [95% CI], P |
|---|---|---|---|---|
| ML (`ml`) | 0.6311 | 0.6472 / 0.6315 | 0.6453 / **0.6209** | **-0.0106 [-0.0206, -0.0005]**, 0.98 |
| ML stack with Elo and market rating (`stack`) | 0.6125 | 0.6363 / 0.6129 | 0.6390 / 0.6059 | -0.0070 [-0.0149, +0.0006], 0.96 |

For the plain ML the CV and the test agree. For tools/ml.py's stack (which already holds the Kalman market
rating) CV on 2020-2023 did not want the block, so by the rule it stays out; 2024+ leans the other way, which
is a reason to retest it once more years are in, not to add it now.

### Against the closing line (771 newcomer bouts with a clean BFO close)

| Model | Log loss [95% CI] | Accuracy | minus close [95% CI] |
|---|---|---|---|
| Closing line (no-vig) | 0.5764 [0.5492, 0.6040] | 69.4% | |
| Close, recalibrated | 0.5751 | 69.4% | -0.0012 [-0.0042, +0.0018] |
| Close + pre-UFC | 0.5732 | 70.0% | -0.0032 [-0.0082, +0.0017] |
| Close + base + pre-UFC | 0.5726 | 70.7% | -0.0038 [-0.0122, +0.0046] |
| base + pre-UFC (no market) | 0.6302 | 65.0% | +0.0538 [+0.0309, +0.0749] |
| base (no market) | 0.6441 | 62.3% | +0.0677 [+0.0444, +0.0904] |

Close + pre minus recalibrated close: -0.0020 [-0.0064, +0.0023], P 0.82; CV preferred the plain close.

## Results: how it ends

METHOD_BLOCK

## Audit

AUDIT_BLOCK

## Recommendation for the engine and the ensemble

ENGINE_BLOCK

## Caveats

- **Sherdog's own completeness is not measured.** Every UFC bout is on the matched pages, but regional fights
  missing from Sherdog would be missing here too, and Sherdog sometimes files fights others call amateur as
  pro (and the reverse). Amateur records (854 fighters have one) are excluded entirely; they might carry
  signal for fighters with short pro records.
- **Opponent quality is thin.** Opponents' records come only from fights between crawled fighters (the strict
  network has 22,336 fights). Only 0.9 opponents per 2024+ debutant have 3+ known fights, so `opp_wpct_h`
  is mostly missing and not in the core set; a deeper crawl of opponents' pages (one hop) would cost about
  10,000 requests (3 hours at 1/s) and is the obvious next data step if the engine needs better regional
  strength-of-schedule.
- **Promotion names are heuristic.** Sherdog event prefixes are merged by about 30 aliases; small
  promotions with colliding acronyms are separated by the long name when the event title carries it. Feeder
  strength depends on the share of UFC debutants a promotion sends, which is robust to the odd split.
- **Veterans in 2015-2020.** Pre-2015 debutants are only in the data if they fought in 2021 or later. Their
  missing records are imputed at the mean; the newcomer-sides-only ablation, which ignores every veteran's
  pre-UFC record, keeps most of the gain.
- **One test set, looked at twice.** See the walk-forward design note.
- **The gap to the market remains.** Newcomer bouts are still where the market beats every model by the
  most (0.054 log loss); camp quality, injuries, short-notice context and film are not in any feature here.

## Reproduce

```
python3 tools/preufc.py crawl     # only needed for new fighters; cached pages are never re-fetched
python3 tools/preufc.py build     # parse the cache -> data/derived/preufc.json (15 s)
python3 tools/preufc.py eval      # walk-forward evaluation, audit, predictions, roster priors (15-30 min)
python3 tools/preufc.py report    # markdown tables from preufc.json
```

`--extra-since` defaults to 2015-01-01 (the target and training window used here).

Sources: Sherdog fighter pages, e.g. https://www.sherdog.com/fighter/Alexander-Volkanovski-101527 and
https://www.sherdog.com/fighter/Justin-Gaethje-46648 (pro histories); Wikidata property P2818 (Sherdog
fighter ID) via data/raw/wikidata_mma_people.csv for the cross-check; ufcstats via data/raw/*.csv; BFO
closing lines via nlbair/ufc-data (CC BY 4.0, cached by tools/market.py); tools/ml.py's data/derived/ml.json.
