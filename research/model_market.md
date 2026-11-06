# Market model: historical UFC betting odds (engine v9 component)

Prepared Friday, November 6, 2026. Tool: `tools/market.py`. Output: `data/derived/market.json`.
Compact source extracts: `data/raw/odds/`. Every table in the results section is printed by
`python3 -I tools/market.py tables` from market.json, so the numbers match the JSON exactly.

Periods follow the project rule. **Tune**: 2019-01-01 to 2023-12-31. **Test (held out)**: 2024-01-01 to
2026-10-31. Every fitted number (no-vig method, slopes, stacking weights, rating parameters, offsets) is fit on
tune only and then scored once on test. Uncertainty: 95% intervals from a cluster bootstrap that resamples
whole events (2,000 resamples), because fights on one card share news, lines and judges.

## 1. Bottom line

1. **Coverage is essentially complete.** There is a consensus closing line for 3,228 of the 3,237 backtest
   fights: all 1,999 tune fights and 1,229 of 1,238 test fights (99.3%). Opening lines cover 1,999 and 1,227 of
   them. Per-book closes from seven US books cover 1,199 tune fights (2021-2023) and 1,223 test fights. The 9
   fights with nothing are undercard bouts of the July 19, 2025 card; BestFightOdds never listed them, and
   neither GitHub dataset has them. Independent reads agree. The scrape and nlbair give identical opening lines
   and closing ranges in 3,169 of 3,181 shared fights. Both fighter pages of a matchup agree in all 3,223 cases.
   The Ultimate UFC Dataset's single-book close sits 0.011 from the consensus on average. (high)
2. **The market sets a high bar.** These numbers cover the 1,212 decisive 2024+ fights with both lines. The
   consensus close scores log loss **0.5912** [0.5705, 0.6118], Brier 0.2025, and accuracy 70.0%
   [67.4%, 72.7%]. The opening line scores 0.6126 and Elo 0.6800. So the close beats Elo by 0.089 log loss
   [0.069, 0.109] and the open by 0.021 [0.012, 0.031]. On the tune fights (1,955) the numbers are: close
   0.6239, open 0.6377, Elo 0.6857. The market got sharper over time: the close scored 0.633 in 2019 and 0.586
   in 2025, while Elo stayed near 0.68. (high)
3. **The favourite-longshot bias is real but modest.** Favourites win more often than the multiplicative
   no-vig price says. The logit slope is b = 1.12 (se 0.07) on tune and 1.16 (se 0.08) on test. Flat bets on
   prices under 30% lost 20-30% at the mean close, while favourites above 70% returned +1% to +2%. Power no-vig,
   chosen on tune, removes most of it: the remaining slope is 1.03 (se 0.07), and test log loss falls from
   0.5912 to 0.5899. (high)
4. **Nothing simple beats the close.** I tried recalibrations and stacks with the open, Elo and the market
   rating. None improves test log loss by more than 0.0016, and every interval includes 0. When Elo is
   stacked with the close, its weight is negative (-0.21, se 0.16). Of nine pre-fight features, only age is
   consistently under-priced: -0.128 log-odds per 5 years of age gap beyond the close on tune (se 0.050), and
   -0.119 on the test refit (se 0.068). But its out-of-sample gain is not established: -0.0013
   [-0.0043, 0.0021]. (high for "nothing simple"; medium for age)
5. **A market rating gives a strong prior when no line exists.** It is a walk-forward Kalman filter on earlier
   closing lines and results, with parameters fit on tune. On 2024+ fights it scores **0.6336** before any line
   is posted, which beats Elo by 0.046 [0.032, 0.060]. With age and weight-move offsets fit on tune it scores
   **0.6221**. That is still 0.021 behind the opening line. (high)
6. **The method and round markets set the bar for v6 and v10.** On 2024+ fights (1,193), the six-way
   method-of-victory market scores 1.476. A baseline of moneyline times walk-forward division base rates scores
   1.579; the difference is [-0.130, -0.075]. For round of finish the market scores 1.160 against 1.208. But
   the market overprices finishes. The two-way goes-to-decision prop predicted 46.4% decisions against 51.1%
   observed on test, and 47.4% against 49.5% on tune. So the engine's finish rates must be calibrated to
   outcomes, not to props. (high for the benchmark; medium for the size of the finish bias)
7. **I found and fixed two data traps.**
   - Some closing ranges contain in-play prices that leak the result. In the 15 affected fights, the raw
     midpoint scores 0.60 against 0.76-0.80 for a clean single-book close. An outcome-blind spread rule
     removes them.
   - Kalshi's last price on BFO is recorded after the result: it scores 0.34 against 0.62 for the consensus
     on the same 270 fights. Prediction-market prices are kept out of the consensus and out of market.json.

   (high)
8. **Model comparisons can be 3 to 4.6 times less noisy.** Scoring the difference between two models against
   the closing line, instead of 0/1 outcomes, cuts its standard error by a factor of 3.2-4.6. That is like
   having 10-20 times as many fights. The sign agreed in every comparison tested. Ship decisions still use
   outcomes. (medium: three comparisons)
9. **Volkanovski vs Gaethje.** The market rating gives Volkanovski 63.5%, or 61.7% after the age and moving-up
   offsets. The posted October openers put him near 37% (research/matchup_market.md). On top of what general
   data support, the market applies about 1.0 log-odds of matchup-specific tax for size and style. The engine
   should keep size as a labeled knob. (medium: one matchup)

## 2. Data: where the odds come from

| Source | What it gives | Window | Licence / terms | How obtained |
|---|---|---|---|---|
| BestFightOdds.com (BFO) event pages | per-book closing lines for the US books BFO lists today (FanDuel, DraftKings, BetMGM, Caesars, BetRivers, BetWay, Unibet), plus props (method, decision, rounds) | per-book data exists from 2021 on; 2019-2020 pages only list books that no longer quote | robots.txt allows everything but /cnadm/ | fetched by this tool, one request every 2-3 s, gzip, cached |
| BFO fighter pages | opening line (first price any book posted), closing range (low and high across books), and BFO's mean-odds series per side (its last point is the mean of the books' closing decimal odds) | all years | same | same |
| nlbair/ufc-data v0.1.1 | BFO opening line and closing range for every UFC fight, keyed by the ufcstats fight id, with a crosswalk to BFO fighter pages | 2013-02-16 to 2026-10-10 | CC BY 4.0, doi:10.5281/zenodo.23458636 | shallow git clone |
| Ultimate UFC Dataset (mdabbert, GitHub shortlikeafox) | one closing moneyline per fighter (it sits inside BFO's closing range 91% of the time, so it is one book's close) | 2010-03-21 to 2026-03-28 | CC BY 4.0 (Kaggle metadata) | shallow git clone |

Also searched and not used: DanMcInerney/BestfightoddsScraper (a scraper, no data), several 2026 hobby repos
with odds for upcoming cards only, Kaggle mirrors (need a login), fightodds.io (a JavaScript app; its
robots.txt URL returns the app shell, and BFO already covers the same books). Only the two GitHub datasets above
had historical lines for the whole backtest window.

**Matching.** nlbair rows join on the ufcstats fight id directly (3,183 backtest fights; its first fighter is
always the backtest's A). BFO matchups and Ultimate UFC Dataset rows are matched on the event date (BFO often
lists a card a day later, so plus or minus 2 days) and both names (accent, suffix and order insensitive fuzzy
similarity of at least 0.72 for the weaker of the two names); a candidate can serve only one fight. Results:
nlbair rows join on the ufcstats fight id directly (3,183 backtest fights; its first fighter is always the
backtest's A). The BFO scrape is matched in four passes, each outcome-blind:

- **Pass 0, crosswalk (3,170 fights).** nlbair names the BFO page of one fighter and which ufcstats fighter
  owns it. That BFO URL plus a date within 3 days joins the matchup, so BFO's own spellings cannot break it
  (Bobby Green for King Green, Ronaldo Souza for Jacare, Yana Kunitskaya for Yana Santos, Heili Alateng,
  Patricio Freire and others).
- **Pass 1, names (36).** Event date within 2 days and both names fuzzy-matched. The weaker of the two names
  needs a similarity of at least 0.72; matching ignores accents, suffixes and name order.
- **Pass 2, rescheduled fights (13).** The same two names within 10 days, with similarity of at least 0.9.
  BFO keeps the original date when a fight is moved.
- **Pass 3, undated matchups (6).** BFO left these on its undated Future Events and Potential Fights pages
  (Poirier vs Chandler, Adesanya vs Pereira 2, Topuria vs Mitchell, Zhang vs Esparza, Oliveira vs Dariush,
  and one more). Each is placed in time by the dates of the matchups with the nearest BFO ids, and the fight
  must fall 45 days before to 730 days after that date.

In all, 3,225 of 3,237 fights match. Four renamed fighters need an alias for name matching (Tecia Torres,
Brianna van Buren, Joanne Calderwood, Katlyn Chookagian). The Ultimate UFC Dataset matched 2,689 fights on
date and names.

In 12 shared fights the scraped opening line differs from nlbair's. Where it can be checked, the scrape agrees
with the independent single-book close and nlbair does not. Example: Kelleher vs Croom, where nlbair has the
sides reversed. So the scraped values take precedence.

**Coverage, honestly.** There is a close for 3,228 of 3,237 backtest fights (99.7%): all 1,999 tune fights and 1,229 of 1,238
test fights. There is an opening line for 1,999 and 1,227 of them.

- **Per-book closes** (seven US books) exist for 1,199 tune fights, all in 2021-2023, and 1,223 test fights.
- **2019-2020 closes** are BFO's mean of the books it tracked then, mostly offshore books. So the tune close
  mixes two book sets. Where both exist, they agree to 0.003 in probability (table 4.5).
- **Missing entirely:** 9 undercard bouts of July 19, 2025. BFO never listed them, and nlbair and the Ultimate
  UFC Dataset have nothing either.
- **Method and round props** cover 1,233 tune and 1,209 test fights (2021 on).
- **Kalshi and Polymarket** appear only in 2026 (270 and 166 scored fights) and are not usable (table 4.10).

BestFightOdds' opening line is one book's first price. The per-book history behind it (time stamps, limits)
was not fetched.

**Definitions.**
- *Open*: the first line BFO lists for the fight. It is one book's price, often posted weeks out at low limits, so
  it is the market's first guess, not a bettable consensus.
- *Close*: a consensus closing line (decimal odds per side averaged across books, then converted to American).
  Precedence: (1) the mean of at least 3 US sportsbooks' closes on the BFO event page, after dropping any book
  whose no-vig probability is more than 0.15 from the median book; (2) BFO's mean-odds series end point (both
  fighter pages) when the closing range is clean; (3) 1-2 US books; (4) the decimal midpoint of a clean closing
  range (nlbair's method); (5) the Ultimate UFC Dataset close when its overround is 0.99-1.15. The `src` field says
  which one each fight uses. Kalshi and Polymarket are never part of it (table 4.10).
- *No-vig*: `p_novig_*` in market.json is multiplicative, p_A = (1/d_A) / (1/d_A + 1/d_B). The tune-chosen method
  (power) is stored as `p_power_close`. With two outcomes Shin's method equals the additive method exactly (a
  known identity, and a check on the code).
- *Scored fights*: decisive results only (A or B won). Draws and no-contests stay in market.json but are not scored.
  The headline compares models on the same fights: decisive, with both an open and a close.

**Cleaning: stale and in-play prices.** BFO's closing range sometimes contains a price a book posted after the
fight started (Arnold Allen vs Sodiq Yusuff, April 2021: Allen's range runs from -3500 to +135). Such a price
leaks the result. In the fights whose range spans more than 0.20 in implied probability, the raw range midpoint
scores like a prophet while an independent single-book close scores like an ordinary line (table 4.16). The rule
is outcome-blind in use: a range wider than 0.20 is not used, nor is BFO's mean for that fight, and per-book lines
far from the median book are dropped. I picked the 0.20 threshold after seeing the leak in all years, so treat it
as a data-cleaning choice rather than a tuned parameter; the tune years alone show the same pattern (9 fights).
The effect on the headline is small (about +0.001 log loss on test) but it removes a bias in the market's favour.

## 3. Method

Everything is in `tools/market.py build`:

1. Assemble every representation per backtest fight (nlbair open and range, BFO open, range, mean series and
   per-book closes, Ultimate UFC Dataset close), orient to the backtest's A/B, apply the cleaning rule, choose open
   and close as above.
2. Score Elo (the backtest's pre-fight Elo, K 44), the open, the close and the market rating on the same fights:
   log loss, Brier, accuracy (ties count half), and ECE (expected calibration error over 0.05-wide favourite bins).
3. Compare no-vig methods (multiplicative, additive, power, Shin, odds ratio), closing-line representations, and
   recalibrations: a symmetric slope logit p' = b logit p, a favourite intercept and slope, and stacking with the
   open, Elo and the market rating, all by logistic regression without an intercept (so the corner label cannot
   matter), fit on tune, scored on test, with a bootstrap interval on the test difference.
4. Favourite-longshot bias: calibration by favourite probability band, the slope b, and flat-stake ROI by implied
   probability band at the mean close and at the best US book.
5. Market efficiency: does anything known before the fight (age, reach, height, experience, KO losses, knockdowns
   absorbed, Elo, a weight-class move, stance) predict the result beyond the close? One feature at a time and all
   nine, fit on tune, scored on test; the test refit is shown only to see whether a sign persists.
6. Market rating: a walk-forward Kalman filter on fighters' closing lines and results (table 4.3; equations in section 5).
7. Props: six-way method of victory, goes to decision, and round of finish, from per-book closing prop prices
   (2021 on), against walk-forward base rates (table 4.15).
8. Soft-label scoring: how much less noisy model comparisons become when scored against the closing line instead
   of 0/1 outcomes (section 4.11).

## 4. Results

### 4.1 Coverage by year (backtest fights)

| Year | Fights | Open | Close | Close share | Per-book closes | Close source |
|---|---|---|---|---|---|---|
| 2019 | 393 | 393 | 393 | 100.0% | 0 | bfo_mean 392, uud 1 |
| 2020 | 352 | 352 | 352 | 100.0% | 0 | bfo_mean 351, range_mid 1 |
| 2021 | 427 | 427 | 427 | 100.0% | 379 | bfo_books 378, bfo_mean 49 |
| 2022 | 422 | 422 | 422 | 100.0% | 419 | bfo_books 418, bfo_mean 4 |
| 2023 | 405 | 405 | 405 | 100.0% | 401 | bfo_books 401, bfo_mean 3, range_mid 1 |
| 2024 | 433 | 432 | 433 | 100.0% | 429 | bfo_books 427, bfo_mean 5, uud 1 |
| 2025 | 432 | 422 | 423 | 97.9% | 422 | bfo_books 422, bfo_mean 1 |
| 2026 | 373 | 373 | 373 | 100.0% | 372 | bfo_books 371, bfo_mean 1, range_mid 1 |
| **tune** | 1999 | 1999 | 1999 | 100.0% | 1199 | |
| **test** | 1238 | 1227 | 1229 | 99.3% | 1223 | |

### 4.2 Headline: decisive fights with both an opening and a closing line

| Period | Model | n | Log loss [95% CI] | Brier [95% CI] | Accuracy [95% CI] | ECE |
|---|---|---|---|---|---|---|
| tune | Elo (K 44) | 1955 | 0.6857 [0.6790, 0.6924] | 0.2464 [0.2431, 0.2496] | 0.549 [0.527, 0.569] | 0.0230 |
| tune | Opening line | 1955 | 0.6377 [0.6258, 0.6497] | 0.2235 [0.2179, 0.2291] | 0.637 [0.616, 0.658] | 0.0188 |
| tune | Closing line | 1955 | 0.6239 [0.6106, 0.6370] | 0.2173 [0.2112, 0.2232] | 0.649 [0.629, 0.669] | 0.0323 |
| tune | Market rating (no line needed) | 1955 | 0.6541 | 0.2314 | 0.610 | 0.0122 |
| tune | Market rating + age and weight-move offsets | 1955 | 0.6455 | 0.2274 | 0.629 | 0.0236 |
| test | Elo (K 44) | 1212 | 0.6800 [0.6726, 0.6876] | 0.2436 [0.2399, 0.2473] | 0.548 [0.524, 0.573] | 0.0221 |
| test | Opening line | 1212 | 0.6126 [0.5945, 0.6313] | 0.2119 [0.2039, 0.2202] | 0.667 [0.644, 0.689] | 0.0331 |
| test | Closing line | 1212 | 0.5912 [0.5705, 0.6118] | 0.2025 [0.1932, 0.2116] | 0.700 [0.674, 0.727] | 0.0421 |
| test | Market rating (no line needed) | 1212 | 0.6336 | 0.2215 | 0.646 | 0.0365 |
| test | Market rating + age and weight-move offsets | 1212 | 0.6221 | 0.2163 | 0.661 | 0.0367 |

| Period | Close - Elo (LL) | Close - Open (LL) | Open - Elo (LL) | Rating - Elo (LL) | Rating - Open (LL) |
|---|---|---|---|---|---|
| tune | -0.0618 [-0.0748, -0.0494] | -0.0138 [-0.0218, -0.0062] | -0.0480 [-0.0590, -0.0367] | -0.0316 [-0.0413, -0.0222] | +0.0164 [0.0061, 0.0257] |
| test | -0.0888 [-0.1086, -0.0693] | -0.0214 [-0.0309, -0.0118] | -0.0674 [-0.0847, -0.0502] | -0.0464 [-0.0604, -0.0320] | +0.0210 [0.0086, 0.0332] |

### 4.3 Market rating

Parameters (chosen on tune): {'sig_m': 0.5, 'tau_per_year': 0.5, 'v0': 1.5, 'mu0': 0.0, 'kappa_result': 1.5}. Stream: {'fights': 6773, 'with_close': 6750, 'from': '2013-02-16', 'to': '2026-10-31'}. Best five grid points: [[[0.5, 0.5, 1.5, 1.5], 0.6541], [[0.5, 0.5, 1.0, 2.0], 0.6541], [[0.35, 0.5, 1.0, 2.0], 0.6542], [[0.5, 0.35, 1.0, 2.0], 0.6542], [[0.5, 0.5, 1.5, 2.0], 0.6542]].

| Period | Predicting the close (logit RMSE / corr): rating | opening line |
|---|---|---|
| tune | 0.513 / 0.696 | 0.364 / 0.859 |
| test | 0.580 / 0.762 | 0.401 / 0.892 |

What the close adds beyond the rating (OLS of logit(p_close) - logit(p_rating) on A-minus-B features, no intercept; fit on tune): tune coef [b, se] {'moved_up': [-0.0723, 0.035], 'moved_down': [0.049, 0.0347], 'age_per_5y': [-0.1632, 0.0101]}; test refit {'moved_up': -0.1676, 'moved_down': 0.0412, 'age_per_5y': -0.239}; movers in tune 376; test logit RMSE vs close {'rating': 0.5773, 'rating+adj': 0.5197}; test outcome LL {'rating': 0.6336, 'rating+adj': 0.622, 'n': 1214}.


### 4.4 No-vig method (closing and opening lines; same fights as the headline)

| Method | Close LL tune | Close LL test | Open LL tune | Open LL test |
|---|---|---|---|---|
| mult | 0.6239 | 0.5912 | 0.6377 | 0.6126 |
| add | 0.6234 | 0.5902 | 0.6373 | 0.6116 |
| power | 0.6232 | 0.5899 | 0.6371 | 0.6112 |
| shin | 0.6234 | 0.5902 | 0.6373 | 0.6116 |
| odds_ratio | 0.6234 | 0.5902 | 0.6373 | 0.6115 |

Chosen on tune: **power**.

### 4.5 Closing-line representations (pairwise, common fights, multiplicative no-vig)

| Period | Pair | n | LL first | LL second | Mean abs diff in p |
|---|---|---|---|---|---|
| tune | bfo_mean vs range_mid | 1944 | 0.6234 | 0.6238 | 0.0030 |
| tune | bfo_mean vs uud | 1834 | 0.6224 | 0.6234 | 0.0114 |
| tune | range_mid vs uud | 1835 | 0.6229 | 0.6236 | 0.0126 |
| tune | bfo_mean vs books_mean | 1161 | 0.6174 | 0.6170 | 0.0027 |
| tune | books_mean vs books_avgnv | 1169 | 0.6179 | 0.6179 | 0.0002 |
| tune | books_mean vs books_median | 1169 | 0.6179 | 0.6179 | 0.0032 |
| tune | books_mean vs uud | 1085 | 0.6128 | 0.6136 | 0.0097 |
| tune | books_mean vs range_mid | 1161 | 0.6170 | 0.6179 | 0.0053 |
| test | bfo_mean vs range_mid | 1205 | 0.5893 | 0.5893 | 0.0032 |
| test | bfo_mean vs uud | 812 | 0.5815 | 0.5808 | 0.0084 |
| test | range_mid vs uud | 812 | 0.5814 | 0.5808 | 0.0096 |
| test | bfo_mean vs books_mean | 1202 | 0.5893 | 0.5895 | 0.0009 |
| test | books_mean vs books_avgnv | 1208 | 0.5907 | 0.5907 | 0.0003 |
| test | books_mean vs books_median | 1208 | 0.5907 | 0.5908 | 0.0030 |
| test | books_mean vs uud | 815 | 0.5833 | 0.5823 | 0.0085 |
| test | books_mean vs range_mid | 1202 | 0.5895 | 0.5893 | 0.0036 |

### 4.6 Calibration of the closing line (favourite side)

**tune** (n 1955): favourites won 0.648 vs implied 0.641; slope-only b = 1.120 (se 0.074); favourite intercept+slope a = -0.103 (se 0.086), b = 1.250 (se 0.133); opening-line slope b = 1.141 (se 0.082); median overround close 1.0458, open 1.0403.

| Favourite p | n | Mean implied | Won | 95% CI |
|---|---|---|---|---|
| 0.50-0.55 | 332 | 0.526 | 0.491 | [0.438, 0.544] |
| 0.55-0.60 | 398 | 0.576 | 0.580 | [0.531, 0.628] |
| 0.60-0.65 | 399 | 0.625 | 0.664 | [0.616, 0.709] |
| 0.65-0.70 | 346 | 0.674 | 0.639 | [0.587, 0.688] |
| 0.70-0.75 | 238 | 0.725 | 0.756 | [0.698, 0.806] |
| 0.75-0.80 | 126 | 0.771 | 0.833 | [0.759, 0.888] |
| 0.80-0.85 | 86 | 0.820 | 0.884 | [0.799, 0.936] |
| 0.85-0.90 | 27 | 0.868 | 0.889 | [0.719, 0.962] |
| 0.90-1.00 | 3 | 0.909 | 0.667 | [0.208, 0.939] |

**test** (n 1214): favourites won 0.699 vs implied 0.668; slope-only b = 1.164 (se 0.083); favourite intercept+slope a = +0.144 (se 0.113), b = 1.010 (se 0.144); opening-line slope b = 1.186 (se 0.093); median overround close 1.0468, open 1.0429.

| Favourite p | n | Mean implied | Won | 95% CI |
|---|---|---|---|---|
| 0.50-0.55 | 161 | 0.524 | 0.590 | [0.513, 0.663] |
| 0.55-0.60 | 198 | 0.575 | 0.646 | [0.578, 0.710] |
| 0.60-0.65 | 197 | 0.627 | 0.609 | [0.539, 0.675] |
| 0.65-0.70 | 226 | 0.675 | 0.664 | [0.600, 0.722] |
| 0.70-0.75 | 152 | 0.724 | 0.776 | [0.704, 0.835] |
| 0.75-0.80 | 132 | 0.773 | 0.795 | [0.719, 0.855] |
| 0.80-0.85 | 91 | 0.822 | 0.890 | [0.809, 0.939] |
| 0.85-0.90 | 51 | 0.869 | 0.922 | [0.815, 0.969] |
| 0.90-1.00 | 6 | 0.911 | 0.833 | [0.436, 0.970] |

### 4.7 Favourite-longshot bias: flat-stake ROI by implied probability (both sides of every fight)

| Period | Implied band | Sides | Mean implied | Won | ROI at mean close (se) | ROI at best US book (n) |
|---|---|---|---|---|---|---|
| tune | 0.0-0.2 | 116 | 0.166 | 0.121 | -0.275 (0.188) | -0.251 (76) |
| tune | 0.2-0.3 | 364 | 0.259 | 0.217 | -0.209 (0.079) | -0.162 (211) |
| tune | 0.3-0.4 | 745 | 0.352 | 0.348 | -0.044 (0.048) | -0.047 (471) |
| tune | 0.4-0.5 | 728 | 0.446 | 0.459 | -0.019 (0.040) | +0.018 (411) |
| tune | 0.5-0.6 | 732 | 0.553 | 0.541 | -0.066 (0.032) | -0.046 (411) |
| tune | 0.6-0.7 | 745 | 0.648 | 0.652 | -0.032 (0.026) | +0.013 (471) |
| tune | 0.7-0.8 | 364 | 0.741 | 0.783 | +0.012 (0.028) | +0.034 (211) |
| tune | 0.8-1.0 | 116 | 0.834 | 0.879 | +0.011 (0.035) | +0.025 (76) |
| test | 0.0-0.2 | 148 | 0.158 | 0.101 | -0.327 (0.170) | -0.248 (148) |
| test | 0.2-0.3 | 284 | 0.253 | 0.215 | -0.187 (0.093) | -0.136 (282) |
| test | 0.3-0.4 | 423 | 0.347 | 0.362 | -0.005 (0.065) | +0.041 (423) |
| test | 0.4-0.5 | 359 | 0.448 | 0.379 | -0.193 (0.055) | -0.157 (355) |
| test | 0.5-0.6 | 359 | 0.552 | 0.621 | +0.073 (0.044) | +0.103 (355) |
| test | 0.6-0.7 | 423 | 0.652 | 0.638 | -0.066 (0.034) | -0.044 (423) |
| test | 0.7-0.8 | 284 | 0.747 | 0.785 | +0.004 (0.031) | +0.027 (282) |
| test | 0.8-1.0 | 148 | 0.842 | 0.899 | +0.024 (0.029) | +0.042 (148) |
| all | 0.0-0.2 | 264 | 0.162 | 0.110 | -0.304 (0.126) | -0.249 (224) |
| all | 0.2-0.3 | 648 | 0.257 | 0.216 | -0.200 (0.060) | -0.147 (493) |
| all | 0.3-0.4 | 1168 | 0.351 | 0.353 | -0.030 (0.039) | -0.005 (894) |
| all | 0.4-0.5 | 1087 | 0.447 | 0.432 | -0.077 (0.032) | -0.063 (766) |
| all | 0.5-0.6 | 1091 | 0.553 | 0.567 | -0.020 (0.026) | +0.023 (766) |
| all | 0.6-0.7 | 1168 | 0.649 | 0.647 | -0.044 (0.021) | -0.014 (894) |
| all | 0.7-0.8 | 648 | 0.744 | 0.784 | +0.009 (0.021) | +0.030 (493) |
| all | 0.8-1.0 | 264 | 0.838 | 0.890 | +0.018 (0.022) | +0.037 (224) |

### 4.8 Recalibration and stacking (fit on 2019-2023, scored on 2024+)

| Variant | Coefficients on logit scale [b, se] | LL tune | LL test | Test LL - close (95% CI) |
|---|---|---|---|---|
| close_mult |  | 0.6239 | 0.5912 | +0.0000 [0.0000, 0.0000] |
| close_slope | p_close_mult +1.120 (0.074) | 0.6232 | 0.5896 | -0.0015 [-0.0039, 0.0008] |
| close_power |  | 0.6232 | 0.5899 | -0.0012 [-0.0033, 0.0010] |
| close_power_slope | p_close_power +1.033 (0.069) | 0.6231 | 0.5897 | -0.0014 [-0.0042, 0.0015] |
| close+open | p_close_mult +0.990 (0.137); p_open +0.174 (0.154) | 0.6229 | 0.5899 | -0.0013 [-0.0040, 0.0016] |
| close+elo | p_close_mult +1.159 (0.080); elo -0.208 (0.163) | 0.6228 | 0.5898 | -0.0014 [-0.0044, 0.0016] |
| close+open+elo | p_close_mult +1.002 (0.137); p_open +0.222 (0.158); elo -0.253 (0.166) | 0.6223 | 0.5903 | -0.0009 [-0.0046, 0.0027] |
| open_mult |  | 0.6377 | 0.6126 | +0.0214 [0.0118, 0.0309] |
| open+elo | p_open +1.185 (0.091); elo -0.183 (0.163) | 0.6366 | 0.6117 | +0.0205 [0.0100, 0.0309] |
| elo |  | 0.6857 | 0.6800 | +0.0888 [0.0693, 0.1086] |
| market_rating |  | 0.6541 | 0.6336 | +0.0424 [0.0291, 0.0558] |
| market_rating_adj |  | 0.6455 | 0.6221 | +0.0310 [0.0183, 0.0440] |
| market_rating_adj+elo | p_mrating_adj +1.202 (0.101); elo -0.291 (0.169) | 0.6443 | 0.6196 | +0.0284 [0.0157, 0.0422] |
| market_rating_slope | p_mrating +1.122 (0.096) | 0.6537 | 0.6315 | +0.0403 [0.0269, 0.0535] |
| market_rating+elo | p_mrating +1.278 (0.119); elo -0.409 (0.179) | 0.6524 | 0.6301 | +0.0389 [0.0254, 0.0526] |
| close+market_rating | p_close_mult +1.041 (0.099); p_mrating +0.158 (0.131) | 0.6228 | 0.5895 | -0.0016 [-0.0045, 0.0012] |
| open+market_rating | p_open +0.915 (0.107); p_mrating +0.407 (0.126) | 0.6343 | 0.6071 | +0.0159 [0.0061, 0.0260] |
| close_fav_a_b | a -0.103 (0.086); b +1.250 (0.133) | 0.6229 | 0.5909 | -0.0003 [-0.0034, 0.0031] |

n: {'tune': 1955, 'test': 1212}

### 4.9 Does anything known before the fight beat the close? (one feature at a time, plus all)

| Feature (A minus B) | Tune coef (se) | Test refit coef (se) | Test LL change vs close+slope (95% CI) |
|---|---|---|---|
| age | -0.1284 (0.0504) | -0.1189 (0.0682) | -0.0013 [-0.0043, 0.0021] |
| reach_in | +0.0166 (0.0153) | +0.0013 (0.0199) | +0.0002 [-0.0011, 0.0017] |
| height_in | +0.0321 (0.0199) | +0.0198 (0.0272) | -0.0001 [-0.0019, 0.0016] |
| log_ufc_fights | +0.0080 (0.0576) | -0.0579 (0.0762) | +0.0001 [-0.0001, 0.0002] |
| ko_losses | +0.0332 (0.0332) | +0.0452 (0.0419) | -0.0004 [-0.0017, 0.0008] |
| kd_absorbed | +0.0296 (0.0219) | +0.0054 (0.0270) | +0.0003 [-0.0015, 0.0022] |
| elo_logit | -0.2076 (0.1625) | -0.0624 (0.2088) | +0.0001 [-0.0013, 0.0015] |
| weight_move | -0.1055 (0.1126) | +0.0913 (0.1637) | +0.0005 [-0.0004, 0.0013] |
| southpaw | -0.0117 (0.0877) | -0.0010 (0.1196) | +0.0000 [-0.0001, 0.0001] |
| all nine | see json | see json | -0.0002 [-0.0050, 0.0049] |

### 4.10 Each book (and prediction market) vs the consensus close on the same fights

| Period | Book | n | LL book | LL consensus | Book - consensus (95% CI) |
|---|---|---|---|---|---|
| tune | BetMGM | 1017 | 0.6172 | 0.6158 | [0.0000, 0.0029] |
| tune | BetRivers | 1025 | 0.6142 | 0.6146 | [-0.0021, 0.0016] |
| tune | BetWay | 1214 | 0.6199 | 0.6200 | [-0.0014, 0.0013] |
| tune | Caesars | 1029 | 0.6140 | 0.6137 | [-0.0010, 0.0017] |
| tune | DraftKings | 1006 | 0.6129 | 0.6124 | [-0.0015, 0.0027] |
| tune | FanDuel | 1165 | 0.6193 | 0.6183 | [-0.0012, 0.0030] |
| tune | Unibet | 1017 | 0.6139 | 0.6143 | [-0.0015, 0.0009] |
| test | BetMGM | 658 | 0.5892 | 0.5882 | [-0.0007, 0.0029] |
| test | BetRivers | 1197 | 0.5902 | 0.5898 | [-0.0010, 0.0017] |
| test | BetWay | 1205 | 0.5914 | 0.5906 | [-0.0016, 0.0028] |
| test | Caesars | 1194 | 0.5903 | 0.5896 | [-0.0008, 0.0024] |
| test | DraftKings | 633 | 0.5846 | 0.5854 | [-0.0031, 0.0015] |
| test | FanDuel | 1202 | 0.5908 | 0.5916 | [-0.0018, 0.0002] |
| test | Kalshi | 270 | 0.3400 | 0.6192 | [-0.3418, -0.2212] |
| test | Polymarket | 166 | 0.5988 | 0.6091 | [-0.0351, 0.0115] |
| test | Unibet | 695 | 0.6004 | 0.6004 | [-0.0012, 0.0012] |

### 4.11 Soft-label scoring: model differences scored on outcomes (hard) vs on the closing line (soft)

| Period | Pair | Hard diff (se) | Soft diff (se) | se ratio hard/soft |
|---|---|---|---|---|
| tune (n 1955) | market_rating - elo | -0.0316 (0.0047) | -0.0218 (0.0012) | 3.8 |
| tune (n 1955) | market_rating_adj - market_rating | -0.0086 (0.0020) | -0.0039 (0.0005) | 4.18 |
| tune (n 1955) | open - market_rating_adj | -0.0078 (0.0051) | -0.0125 (0.0011) | 4.56 |
| test (n 1212) | market_rating - elo | -0.0464 (0.0069) | -0.0396 (0.0021) | 3.31 |
| test (n 1212) | market_rating_adj - market_rating | -0.0114 (0.0022) | -0.0077 (0.0007) | 3.4 |
| test (n 1212) | open - market_rating_adj | -0.0096 (0.0067) | -0.0135 (0.0021) | 3.19 |

### 4.12 By year (closing line, all decisive fights with a close)

| Year | n | Close LL | Close acc | Open LL | Elo LL |
|---|---|---|---|---|---|
| 2019 | 388 | 0.6327 | 0.621 | 0.6512 | 0.6983 |
| 2020 | 343 | 0.6301 | 0.650 | 0.6345 | 0.6842 |
| 2021 | 415 | 0.6391 | 0.622 | 0.6546 | 0.6812 |
| 2022 | 419 | 0.6041 | 0.673 | 0.6140 | 0.6794 |
| 2023 | 390 | 0.6148 | 0.677 | 0.6346 | 0.6860 |
| 2024 | 429 | 0.5891 | 0.706 | 0.6151 | 0.6770 |
| 2025 | 416 | 0.5857 | 0.678 | 0.6035 | 0.6771 |
| 2026 | 369 | 0.5996 | 0.715 | 0.6199 | 0.6868 |

### 4.13 Segments (closing line)

| Segment | n | LL | Brier | Acc |
|---|---|---|---|---|
| title_tune | 93 | 0.6064 | 0.2089 | 0.677 |
| title_test | 51 | 0.6448 | 0.2274 | 0.627 |
| five_round_tune | 241 | 0.6366 | 0.2237 | 0.627 |
| five_round_test | 147 | 0.6379 | 0.2242 | 0.639 |
| womens_tune | 359 | 0.6304 | 0.2202 | 0.635 |
| womens_test | 199 | 0.5590 | 0.1881 | 0.754 |
| heavyweight_tune | 157 | 0.5965 | 0.2043 | 0.707 |
| heavyweight_test | 78 | 0.6074 | 0.2086 | 0.641 |

### 4.14 Line movement (no-vig, open to close)

| Period | n | Mean abs move | Median abs move | Share moving > 5 pts | Favourite flips |
|---|---|---|---|---|---|
| tune | 1955 | 0.0632 | 0.0517 | 0.518 | 247 |
| test | 1212 | 0.0658 | 0.0540 | 0.532 | 153 |

### 4.15 Method-of-victory and round markets (per-book closes, 2021 on)

| Period | n | 6-way LL market (power) | market (mult) | market rescaled to moneyline | moneyline x division base rates | base rates only | uniform | Market - baseline (95% CI) | Books |
|---|---|---|---|---|---|---|---|---|---|
| tune | 1203 | 1.5560 | 1.5591 | 1.5561 | 1.6479 | 1.7218 | 1.7918 | [-0.1171, -0.0659] | 4.84 |
| test | 1193 | 1.4762 | 1.4830 | 1.4768 | 1.5785 | 1.6806 | 1.7918 | [-0.1302, -0.0745] | 4.49 |

**tune goes to decision**: market LL 0.6570 / Brier 0.2326 vs base rate LL 0.6923 / Brier 0.2494 (n 1217; predicted 0.474, observed 0.495).
**tune round of finish** (rounds 1..K + decision, n 1213): market LL 1.1939 (mult 1.1974) vs base rates 1.2332.

| Class | Predicted share | Observed share |
|---|---|---|
| A_KO | 0.189 | 0.180 |
| A_SUB | 0.105 | 0.102 |
| A_DEC | 0.247 | 0.287 |
| B_KO | 0.164 | 0.144 |
| B_SUB | 0.085 | 0.084 |
| B_DEC | 0.211 | 0.204 |

**test goes to decision**: market LL 0.6464 / Brier 0.2273 vs base rate LL 0.6827 / Brier 0.2448 (n 1199; predicted 0.464, observed 0.511).
**test round of finish** (rounds 1..K + decision, n 1198): market LL 1.1600 (mult 1.1667) vs base rates 1.2080.

| Class | Predicted share | Observed share |
|---|---|---|
| A_KO | 0.192 | 0.180 |
| A_SUB | 0.105 | 0.100 |
| A_DEC | 0.240 | 0.273 |
| B_KO | 0.165 | 0.141 |
| B_SUB | 0.085 | 0.070 |
| B_DEC | 0.213 | 0.235 |

### 4.16 Cleaning: stale or in-play prices in the closing range

Rule: closing range spread (implied-probability gap between low and high price of a side) > 0.2 marks the range and BFO mean as contaminated; per-book lines more than 0.15 from the median book are dropped. Fights left with no close: {'tune': 0, 'test': 0}; books dropped 13 in 13 fights.

| Period, range spread | n | LL raw range midpoint | LL single-book close (UUD) | LL open | LL chosen close |
|---|---|---|---|---|---|
| tune_0-0.05 | 1481 | 0.6201 | 0.6203 | 0.6364 | 0.6199 |
| tune_0.05-0.1 | 334 | 0.6331 | 0.6352 | 0.6437 | 0.6326 |
| tune_0.1-0.2 | 20 | 0.6628 | 0.6741 | 0.6685 | 0.6433 |
| tune_0.2-1.01 | 9 | 0.6010 | 0.7645 | 0.7244 | 0.7603 |
| test_0-0.05 | 667 | 0.5603 | 0.5600 | 0.5877 | 0.5605 |
| test_0.05-0.1 | 136 | 0.6731 | 0.6727 | 0.6876 | 0.6732 |
| test_0.1-0.2 | 9 | 0.7593 | 0.7326 | 0.6810 | 0.7432 |
| test_0.2-1.01 | 6 | 0.6072 | 0.7996 | 0.7518 | 0.8332 |

### 4.17 Data checks

- bfo_open_equals_nlbair_open: [3169, 3181]
- bfo_range_equals_nlbair_range: [3169, 3181]
- bfo_mean_vs_event_page_books_mean_abs_diff: {'n': 2407, 'mean': 0.0018, 'p95': 0.0065, 'share_lt_0.005': 0.9115}
- uud_vs_close_abs_diff: {'n': 2677, 'mean': 0.0109, 'p95': 0.0316}
- diag: {'nlbair_matched': 3183, 'uud_matched': 2689, 'bfo_matchups': 9960, 'bfo_matched_pass0_crosswalk': 3170, 'bfo_matched_pass1_names': 36, 'bfo_matched_pass2_rescheduled': 13, 'bfo_matched_pass3_undated': 6, 'bfo_matched': 3225, 'bfo_two_pages_agree': {'true': 3223}}

## 5. Recommendation for the engine (exact)

### 5.1 Benchmarks every engine version must report (2024+ held-out)

Score on the same fights, joined on the backtest id. Use decisive fights only for the winner metrics, and
orient on the backtest's A (the metrics are symmetric).

| Target | Fights | Log loss | Brier | Accuracy | market.json field |
|---|---|---|---|---|---|
| Closing line, power no-vig | 1,212 | 0.5899 | 0.2020 | 0.700 | `p_power_close` |
| Closing line, multiplicative no-vig | 1,212 | 0.5912 | 0.2025 | 0.700 | `p_novig_close` |
| Opening line | 1,212 | 0.6126 | 0.2119 | 0.667 | `p_novig_open` |
| Market rating + offsets (no line needed) | 1,212 | 0.6221 | 0.2163 | 0.661 | `p_market_rating_adj` |
| Market rating | 1,212 | 0.6336 | 0.2215 | 0.646 | `p_market_rating` |
| Elo (K 44) | 1,212 | 0.6800 | 0.2436 | 0.548 | backtest `elo` |
| Six-way method of victory | 1,193 | 1.4762 | | | `method6` |
| Goes to decision | 1,199 | 0.6464 | 0.2273 | | `p_dec` |
| Round of finish (rounds 1..K + decision) | 1,198 | 1.1600 | | | `round_dist` |

Ship rules this implies:

- Each version must beat Elo (0.680) on these fights.
- A no-line engine should aim at the market rating (0.634, or 0.622 with offsets).
- The v9 stack must not do worse than the close when a close exists.

### 5.2 The market probability (whenever a line exists)

1. Consensus decimal odds. Take each US sportsbook's two-way price and drop any book whose no-vig p is more
   than 0.15 from the median book's. Then d_A = mean of the kept books' decimal odds for A, and the same for
   d_B. Never use Kalshi or Polymarket prices scraped after the event.
2. Implied probabilities: q_A = 1/d_A and q_B = 1/d_B.
3. Power no-vig. Solve q_A^k + q_B^k = 1 for k by bisection on [0.05, 20]. Then
   **p_mkt = q_A^k / (q_A^k + q_B^k)**. No further favourite-longshot correction is needed: the tune slope on
   the power close is 1.03 (se 0.07).
4. If you use multiplicative no-vig instead (p = q_A / (q_A + q_B)), apply **p* = sigmoid(1.12 * logit p)**,
   the tune fit (se 0.074).
5. For an opening line (one book, often weeks out), use multiplicative no-vig and then
   **p* = sigmoid(1.14 * logit p)** (tune, se 0.082).

### 5.3 v9 stacking (engine + market)

    logit p_final = b_m * logit(p_mkt) + b_e * logit(p_engine) + b_age * (age_A - age_B) / 5

- **Fit:** logistic regression without an intercept (so the corner label cannot matter) on the engine's
  walk-forward predictions for 2019-2023. Score once on 2024+.
- **Starting values from this report:** b_m = 1.0 with power no-vig (1.12 with multiplicative). b_e = 0: the
  Elo analogue got -0.21 (se 0.16) with no test gain. b_age = -0.128 (se 0.050).
- **Keep b_e** only if it is positive on tune and the 2024+ log-loss gain has a 95% interval that excludes 0.
- **Keep b_age** only if the engine's own age effect does not already absorb it.
- **When only an opening line exists,** use the open in place of p_mkt. The test also supports adding the
  market rating: logit p = 0.915 * logit(p_open) + 0.407 * logit(p_rating) scored 0.6071 against 0.6126 for
  the open alone, a difference of [-0.0091, -0.0016] (fit on tune).

### 5.4 No-line prior: the market rating (exact)

**State.** Each fighter has (mu, v) on the log-odds scale. A new fighter starts at mu = 0, v = 1.5.

**Before each fight.** Add drift: v = min(v + 0.5^2 * years since the fighter's last fight, 3.0). Then predict

    m = mu_A - mu_B,  s2 = v_A + v_B,  p = sigmoid(m / sqrt(1 + pi * s2 / 8))

**Line update** (closing no-vig p, multiplicative):

    z = logit(clip(p_close, 0.02, 0.98)),  S = s2 + 0.5^2,  r = z - m
    mu_A += (v_A / S) r,  mu_B -= (v_B / S) r,  v_A *= 1 - v_A / S,  v_B *= 1 - v_B / S

**Result update** (y = 1 if A won, 0 if B won, 0.5 for a draw; kappa = 1.5):

    m' = mu_A - mu_B,  p' = sigmoid(m'),  g = y - p',  h = p'(1 - p'),  D = 1 + kappa h (v_A + v_B)
    mu_A += kappa v_A g / D,  mu_B -= kappa v_B g / D,  v_A *= 1 - kappa v_A h / D,  v_B *= 1 - kappa v_B h / D

**Parameters.** These were chosen on tune from a grid: sigma_m 0.5, tau 0.5 per year, v0 1.5, kappa 1.5.
The best five grid points all score within 0.0001 log loss of each other. The filter runs over every UFC fight
since 2013 (nlbair's closes for the fights outside the backtest).

**Offsets** (what the close adds beyond the rating, fit on tune):

    logit p_adj = logit p - 0.072 (up_A - up_B) + 0.049 (down_A - down_B) - 0.163 (age_A - age_B) / 5

up = 1 when the fight is in a heavier division than the fighter's home division; down = 1 when it is lighter.
The age term (se 0.010) is the market pricing age that the rating cannot see. The test refit agrees (-0.239).

**Live use.** `market.json.ratings[slug] = [mu, sd, last fight date, fights seen]` is drifted to the snapshot.
For any two fighters, p = sigmoid((mu_A - mu_B) / sqrt(1 + pi (sd_A^2 + sd_B^2) / 8)), then the offsets.
Stack with the engine as in 5.3, with p_rating_adj in place of p_mkt; the Elo analogue got b = 1.20 for the
rating and -0.29 for Elo.

**Caution.** Rating levels across divisions are tied only by fighters who change division, so cross-division
matchups are the least reliable (section 1, item 9).

### 5.5 Using the market while developing v4-v8

Score candidate changes on tune fights by cross-entropy against the power-no-vig close:
CE = -[p_close log p_model + (1 - p_close) log(1 - p_model)]. Rank changes by the mean difference. Its
standard error is 3.2-4.6 times smaller than with outcomes (table 4.11). Confirm the final choice on outcomes
and on 2024+.

Do not tune toward the market where it is biased:

- It prices favourites slightly too low (section 1, item 3).
- It prices finishes too high (section 1, item 6).
- It under-prices age.

### 5.6 Method and round targets (v6, v10)

- **Score** the engine's six-way method distribution [A_KO, A_SUB, A_DEC, B_KO, B_SUB, B_DEC] against
  `method6` on the same fights. KO includes doctor stoppages; DQs, draws and no-contests are excluded.
- **Score** P(decision) against `p_dec`, and the round of finish against `round_dist`.
- **Market shares are not targets.** On 2024+ the market predicted 35.7% KO and 19.0% submissions, against
  32.1% and 17.0% observed; the decision share was 45.3% predicted against 50.8% observed.
- **Engine calibration** of finishes belongs to outcomes (research/data_baserates.md).

## 6. Caveats

- **The opening line is one book's first price.** It is often posted weeks out at low limits, and its time
  stamp was not collected. "Close minus open" mixes information arrival with limit size.
- **The consensus is not a sharp book.** It is the mean of US recreational books (2021 on) or of BFO's mixed
  book list (2019-2020). BFO no longer lists Pinnacle, Circa or other sharp books, so a sharp close would
  likely score a little better than 0.590. The test close is also sharper than the tune close (0.591 vs
  0.624); Elo hardly moves between the periods, so the gain is the market's own.
- **The cleaning thresholds were chosen by inspection.** The 0.20 range spread and the 0.15 book deviation
  were set after seeing the leak, though they are applied without looking at outcomes. Residual in-play
  prices could remain in ranges narrower than 0.20. The tune years alone show the leak (9 fights).
- **Matching is name and date based** except where nlbair's crosswalk exists. Matching added 55 fights
  beyond the crosswalk; a few could be wrong. The 12 opening-line disagreements with nlbair are listed by
  the tool's checks.
- **The market rating ignores size and style** except through the tune-fit offsets, and it lags for long
  layoffs (its sd grows with the gap). The Volkanovski vs Gaethje gap shows its limits across divisions.
- **The age finding is one of nine features tested.** It replicates in sign and size on the test refit,
  but its out-of-sample log-loss gain is not significant, so treat it as a hypothesis for v5.
- **Props need all six method prices** at one or more books (an average of 4.5-4.8 books). How books grade
  DQs and technical decisions can differ from the classes used here.
- **Legal and terms.** BFO's robots.txt allows these pages. The fetch made 1,829 requests at one every 2-3
  seconds with a desktop browser User-Agent. Raw pages stay in a local cache and are not committed. The
  compact extracts in data/raw/odds/ are factual prices with source credit.

## 7. Reproduce

```
python3 -I tools/market.py fetch --cache ~/.cache/xx-market   # about 1.5 hours the first time (polite BFO fetch)
python3 -I tools/market.py props --cache ~/.cache/xx-market   # seconds (reads the cache)
python3 -I tools/market.py build --props                      # about 3 minutes (rating grid + bootstraps)
python3 -I tools/market.py tables                             # the tables in section 4
```

Credit: odds data from BestFightOdds.com; nlbair/ufc-data (Bair 2026, CC BY 4.0); Ultimate UFC Dataset (mdabbert,
CC BY 4.0); fight results from ufcstats.com via the project's backtest.
