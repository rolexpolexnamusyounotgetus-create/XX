# Market model: historical UFC betting odds (engine v9 component)

Prepared Friday, November 6, 2026; corrected the same day by an adversarial review (see the Verification log at
the end). Tool: `tools/market.py`. Output: `data/derived/market.json`. Compact source extracts: `data/raw/odds/`.
Every table in the results section is printed by `python3 -I tools/market.py tables` from market.json, so the
numbers match the JSON exactly.

Periods follow the project's hidden-data protocol (docs/BACKLOG.md). **Tune**: 2019-01-01 to 2023-12-31.
**Test** (the protocol's validation years): 2024-01-01 to 2025-12-31. **Vault**: every fight from 2026-01-01 is
never scored here. Every fitted number (no-vig method, slopes, stacking weights, rating parameters, offsets) is fit
on tune only and then scored once on test. Uncertainty: 95% intervals from a cluster bootstrap that resamples whole
events (2,000 resamples), because fights on one card share news, lines and judges.

**Correction.** The first version of this report scored "test" as 2024-01-01 to 2026-10-31, which took in the 373
vault fights of 2026. Every test number below is now 2024-2025 only (843 scored fights instead of 1,212). The 2026
rows are gone from market.json and are written to `market_vault.json` in the vault directory outside the repository,
for the v6/v10 auditor. No fitted parameter changed: all of them were fit on 2019-2023.

## 1. Bottom line

1. **Coverage is essentially complete.** There is a consensus closing line for 2,855 of the 2,864 development
   fights (2019-2025): all 1,999 tune fights and 856 of 865 test fights (99.0%). Opening lines cover 1,999 and 854
   of them. Per-book closes from seven US books cover 1,199 tune fights (2021-2023) and 851 test fights. The 9 fights
   with nothing are undercard bouts of the July 19, 2025 card; BestFightOdds never listed them, and neither GitHub
   dataset has them. Independent reads agree. The scrape and nlbair give identical opening lines and closing ranges
   in 2,827 of 2,839 shared fights. Both fighter pages of a matchup agree in all 3,223 matchups read twice. The
   Ultimate UFC Dataset's single-book close sits 0.011 from the consensus on average. (high)
2. **The market sets a high bar.** These numbers cover the 843 decisive 2024-2025 fights with both lines. The
   consensus close scores log loss **0.5875** [0.5639, 0.6107], Brier 0.2011, and accuracy 69.3%
   [66.0%, 72.4%]. The opening line scores 0.6094 and Elo 0.6770. So the close beats Elo by 0.090 log loss
   [0.067, 0.113] and the open by 0.022 [0.011, 0.033]. On the tune fights (1,955) the numbers are: close
   0.6239, open 0.6377, Elo 0.6857. The market got sharper over time: the close scored 0.633 in 2019 and 0.586
   in 2025, while Elo stayed near 0.68. (high)
3. **The favourite-longshot bias is real but modest.** Favourites win more often than the multiplicative
   no-vig price says. The logit slope is b = 1.12 (se 0.07) on tune and 1.21 (se 0.10) on test. Flat bets on
   prices under 30% lost 21-49% at the mean close. Favourites above 70% returned +1% to +5%, but each of those bands
   is within about 1.5 standard errors of zero, so that is not a proven edge. Power no-vig, chosen on tune, removes
   most of the bias on tune (remaining slope 1.03, se 0.07). On test the power close still has slope 1.11 (se 0.09,
   not significant), and test log loss falls from 0.5875 to 0.5854. (high for the direction; medium for the size)
4. **Nothing simple reliably beats the close.** I tried 17 recalibrations and stacks with the open, Elo and the
   market rating, all fit on tune. The best on test is the close plus the market rating (weight 0.16 on the
   rating): 0.5838, which is -0.0036 [-0.0066, -0.0004] against the multiplicative close. Against the power close
   chosen on tune (0.5854), its gain is only -0.0018 [-0.0036, +0.0000], and it is the best of 17 variants. Treat it
   as a lead. Every other interval includes 0. When Elo is stacked with the close, its weight is negative
   (-0.21, se 0.16). Of nine pre-fight features, only age stands out on tune: -0.128 log-odds per 5 years of age gap
   beyond the close (se 0.050, one of nine features tested). The test refit gives -0.107 (se 0.084), and the
   out-of-sample gain is -0.0010 [-0.0048, 0.0031]. (high for "nothing simple"; low-to-medium for age)
5. **A market rating gives a strong prior when no line exists.** It is a walk-forward Kalman filter on earlier
   closing lines and results, with parameters fit on tune. On 2024-2025 fights it scores **0.6258** before any line
   is posted, which beats Elo by 0.051 [0.036, 0.066]. With age and weight-move offsets fit on tune it scores
   **0.6148**. The raw rating trails the opening line by 0.017 [0.003, 0.031]. With offsets the gap is 0.005
   [-0.008, 0.020], which is not significant. (high)
6. **The method and round markets set the bar for v6 and v10.** On test (826 fights), the six-way
   method-of-victory market scores 1.477. A baseline of moneyline times walk-forward division base rates scores
   1.564; the difference is [-0.116, -0.055]. For round of finish the market scores 1.138 against 1.179. But the
   market overprices finishes: the two-way goes-to-decision prop predicted 47.5% decisions against 54.2% observed
   on test (829 fights). On tune it was 47.4% against 49.5%, which is within about 1.5 standard errors. So the
   engine's finish rates must be calibrated to outcomes, not to props. (high for the benchmark; medium for the size
   of the finish bias, which is clear only in 2024-2025)
7. **I found and fixed two data traps.**
   - Some closing ranges contain in-play prices that leak the result. In the 15 affected development fights (9 tune,
     6 test), the raw midpoint scores 0.60-0.61 against 0.76-0.80 for a clean single-book close. An outcome-blind
     spread rule removes them.
   - Kalshi and Polymarket appear on BFO only for 2026 cards. The first build found that Kalshi's last price was
     recorded after the result. That check scored vault fights, so this review did not repeat it. Exchange prices
     stay out of the consensus and out of market.json regardless.

   (high)
8. **Scoring against the close is a cheap screen, not a measure of skill.** Scoring the difference between two
   models against the closing line, instead of 0/1 outcomes, cuts its standard error by a factor of 3.0-4.6 in six
   comparisons, and the sign agreed in all six. But it rewards closeness to the market. On test, the open beats the
   adjusted rating by 0.017 against the close (se 0.002), but by only 0.005 on outcomes (se 0.007, not
   significant), because the open is by construction near the close. Use it to screen changes during development.
   Gains still have to be shown on outcomes. (medium)
9. **Volkanovski vs Gaethje.** The market rating gives Volkanovski 63.5%, or 61.7% after the age and moving-up
   offsets. This live snapshot runs over every fight through 2026-10-31, as live use needs. The posted October
   openers put him near 37% (research/matchup_market.md). On top of what general data support, the market applies
   about 1.0 log-odds of matchup-specific tax for size and style. The engine should keep size as a labeled knob.
   (medium: one matchup)

## 2. Data: where the odds come from

| Source | What it gives | Window | Licence / terms | How obtained |
|---|---|---|---|---|
| BestFightOdds.com (BFO) event pages | per-book closing lines for the US books BFO lists today (FanDuel, DraftKings, BetMGM, Caesars, BetRivers, BetWay, Unibet), plus props (method, decision, rounds) | per-book data exists from 2021 on; 2019-2020 pages only list books that no longer quote | robots.txt allows everything but /cnadm/ | fetched by this tool, one request every 2-3 s, gzip, cached |
| BFO fighter pages | opening line (first price any book posted), closing range (low and high across books), and BFO's mean-odds series per side (its last point is the mean of the books' closing decimal odds) | all years | same | same |
| nlbair/ufc-data v0.1.1 | BFO opening line and closing range for every UFC fight, keyed by the ufcstats fight id, with a crosswalk to BFO fighter pages | 2013-02-16 to 2026-10-10 | CC BY 4.0, doi:10.5281/zenodo.23458636 | shallow git clone |
| Ultimate UFC Dataset (mdabbert, GitHub shortlikeafox) | one closing moneyline per fighter (it sits inside BFO's closing range 91% of the time, so it is one book's close) | 2010-03-21 to 2026-03-28 | CC BY 4.0 (Kaggle metadata) | shallow git clone |

Also found and not used:

- DanMcInerney/BestfightoddsScraper and similar repositories: scrapers, with no historical data committed.
- About 30 hobby repositories from 2026 that mention UFC odds. I judged them by their descriptions only, which
  point to models or upcoming cards; I did not inspect them in depth.
- Kaggle: downloads need a login, and the Ultimate UFC Dataset there is the same as its GitHub repository.
- fightodds.io: a JavaScript app (its robots.txt URL returns the app shell), and it covers the same books as
  BFO.

The two GitHub datasets above plus BFO itself cover the whole backtest window.

**Matching.** Matching uses dates, names and prices only, never results, so it runs over all 3,237 backtest
fights (the 373 vault fights included); the counts in this paragraph cover all of them. nlbair rows join on the
ufcstats fight id directly (3,183 backtest fights; its first fighter is always the backtest's A). BFO matchups and
Ultimate UFC Dataset rows are matched on the event date (BFO often lists a card a day later, so plus or minus 2 days)
and both names (accent, suffix and order insensitive fuzzy similarity of at least 0.72 for the weaker of the two
names); a candidate can serve only one fight. The BFO scrape is matched in four passes, each outcome-blind:

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

**Coverage, honestly.** There is a close for 2,855 of 2,864 development fights (99.7%): all 1,999 tune fights and 856
of 865 test fights. There is an opening line for 1,999 and 854 of them.

- **Per-book closes** (seven US books) exist for 1,199 tune fights, all in 2021-2023, and 851 test fights.
- **2019-2020 closes** are BFO's mean of the books it tracked then, mostly offshore books. So the tune close
  mixes two book sets. Where both exist, they agree to within 0.003 in probability on average (table 4.5).
- **Missing entirely:** 9 undercard bouts of July 19, 2025. BFO never listed them, and nlbair and the Ultimate
  UFC Dataset have nothing either.
- **Method and round props** cover 1,233 tune and 838 test fights (2021 on).
- **Kalshi and Polymarket** appear only on 2026 (vault) cards. They are never used.

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
  which one each fight uses. Kalshi and Polymarket are never part of it.
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
far from the median book are dropped. I picked the 0.20 threshold after seeing the leak in all years (the first build
looked at 2024-2026 too), so treat it as a data-cleaning choice rather than a tuned parameter; the tune years alone
show the same pattern (9 fights). The effect on the headline is small (about +0.001 log loss) but it removes a bias in
the market's favour.

## 3. Method

Everything is in `tools/market.py build`:

1. Assemble every representation per backtest fight (nlbair open and range, BFO open, range, mean series and
   per-book closes, Ultimate UFC Dataset close), orient to the backtest's A/B, apply the cleaning rule, choose open
   and close as above. Rows for fights from 2026-01-01 (the vault) carry no result and go only to the vault file.
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
| **tune** | 1999 | 1999 | 1999 | 100.0% | 1199 | |
| **test** | 865 | 854 | 856 | 99.0% | 851 | |

### 4.2 Headline: decisive fights with both an opening and a closing line

| Period | Model | n | Log loss [95% CI] | Brier [95% CI] | Accuracy [95% CI] | ECE |
|---|---|---|---|---|---|---|
| tune | Elo (K 44) | 1955 | 0.6857 [0.6790, 0.6924] | 0.2464 [0.2431, 0.2496] | 0.549 [0.527, 0.569] | 0.0230 |
| tune | Opening line | 1955 | 0.6377 [0.6258, 0.6497] | 0.2235 [0.2179, 0.2291] | 0.637 [0.616, 0.658] | 0.0188 |
| tune | Closing line | 1955 | 0.6239 [0.6106, 0.6370] | 0.2173 [0.2112, 0.2232] | 0.649 [0.629, 0.669] | 0.0323 |
| tune | Market rating (no line needed) | 1955 | 0.6541 | 0.2314 | 0.610 | 0.0122 |
| tune | Market rating + age and weight-move offsets | 1955 | 0.6455 | 0.2274 | 0.629 | 0.0236 |
| test | Elo (K 44) | 843 | 0.6770 [0.6684, 0.6854] | 0.2422 [0.2380, 0.2463] | 0.547 [0.519, 0.577] | 0.0350 |
| test | Opening line | 843 | 0.6094 [0.5901, 0.6286] | 0.2108 [0.2019, 0.2197] | 0.668 [0.643, 0.694] | 0.0455 |
| test | Closing line | 843 | 0.5875 [0.5639, 0.6107] | 0.2011 [0.1907, 0.2114] | 0.693 [0.660, 0.724] | 0.0395 |
| test | Market rating (no line needed) | 843 | 0.6258 | 0.2181 | 0.655 | 0.0498 |
| test | Market rating + age and weight-move offsets | 843 | 0.6148 | 0.2131 | 0.665 | 0.0462 |

| Period | Close - Elo (LL) | Close - Open (LL) | Open - Elo (LL) | Rating - Elo (LL) | Rating - Open (LL) |
|---|---|---|---|---|---|
| tune | -0.0618 [-0.0748, -0.0494] | -0.0138 [-0.0218, -0.0062] | -0.0480 [-0.0590, -0.0367] | -0.0316 [-0.0413, -0.0222] | +0.0164 [0.0061, 0.0257] |
| test | -0.0895 [-0.1129, -0.0665] | -0.0219 [-0.0330, -0.0109] | -0.0676 [-0.0866, -0.0483] | -0.0511 [-0.0661, -0.0355] | +0.0165 [0.0032, 0.0308] |

### 4.3 Market rating

Parameters (chosen on tune): {'sig_m': 0.5, 'tau_per_year': 0.5, 'v0': 1.5, 'mu0': 0.0, 'kappa_result': 1.5}. Stream: {'fights': 6302, 'with_close': 6279, 'from': '2013-02-16', 'to': '2025-12-13'}. Best five grid points: [[[0.5, 0.5, 1.5, 1.5], 0.6541], [[0.5, 0.5, 1.0, 2.0], 0.6541], [[0.35, 0.5, 1.0, 2.0], 0.6542], [[0.5, 0.35, 1.0, 2.0], 0.6542], [[0.5, 0.5, 1.5, 2.0], 0.6542]].

| Period | Predicting the close (logit RMSE / corr): rating | opening line |
|---|---|---|
| tune | 0.513 / 0.696 | 0.364 / 0.859 |
| test | 0.588 / 0.748 | 0.381 / 0.904 |

What the close adds beyond the rating (OLS of logit(p_close) - logit(p_rating) on A-minus-B features, no intercept; fit on tune): tune coef [b, se] {'moved_up': [-0.0723, 0.035], 'moved_down': [0.049, 0.0347], 'age_per_5y': [-0.1632, 0.0101]}; test refit {'moved_up': -0.1722, 'moved_down': 0.0257, 'age_per_5y': -0.2401}; movers in tune 376; test logit RMSE vs close {'rating': 0.5857, 'rating+adj': 0.5319}; test outcome LL {'rating': 0.6259, 'rating+adj': 0.6146, 'n': 845}.


### 4.4 No-vig method (closing and opening lines; same fights as the headline)

| Method | Close LL tune | Close LL test | Open LL tune | Open LL test |
|---|---|---|---|---|
| mult | 0.6239 | 0.5875 | 0.6377 | 0.6094 |
| add | 0.6234 | 0.5861 | 0.6373 | 0.6077 |
| power | 0.6232 | 0.5854 | 0.6371 | 0.6069 |
| shin | 0.6234 | 0.5861 | 0.6373 | 0.6077 |
| odds_ratio | 0.6234 | 0.5860 | 0.6373 | 0.6076 |

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
| test | bfo_mean vs range_mid | 837 | 0.5857 | 0.5858 | 0.0030 |
| test | bfo_mean vs uud | 723 | 0.5885 | 0.5882 | 0.0080 |
| test | range_mid vs uud | 723 | 0.5885 | 0.5882 | 0.0093 |
| test | bfo_mean vs books_mean | 834 | 0.5857 | 0.5857 | 0.0003 |
| test | books_mean vs books_avgnv | 840 | 0.5875 | 0.5875 | 0.0002 |
| test | books_mean vs books_median | 840 | 0.5875 | 0.5876 | 0.0026 |
| test | books_mean vs uud | 726 | 0.5906 | 0.5899 | 0.0082 |
| test | books_mean vs range_mid | 834 | 0.5857 | 0.5858 | 0.0031 |

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

**test** (n 845): favourites won 0.692 vs implied 0.667; slope-only b = 1.214 (se 0.102); favourite intercept+slope a = -0.052 (se 0.138), b = 1.271 (se 0.185); opening-line slope b = 1.307 (se 0.119); median overround close 1.0463, open 1.0455.

| Favourite p | n | Mean implied | Won | 95% CI |
|---|---|---|---|---|
| 0.50-0.55 | 104 | 0.525 | 0.548 | [0.452, 0.640] |
| 0.55-0.60 | 140 | 0.575 | 0.621 | [0.539, 0.698] |
| 0.60-0.65 | 138 | 0.626 | 0.587 | [0.503, 0.666] |
| 0.65-0.70 | 174 | 0.675 | 0.672 | [0.600, 0.738] |
| 0.70-0.75 | 104 | 0.723 | 0.788 | [0.700, 0.856] |
| 0.75-0.80 | 86 | 0.774 | 0.814 | [0.719, 0.882] |
| 0.80-0.85 | 65 | 0.821 | 0.923 | [0.832, 0.967] |
| 0.85-0.90 | 30 | 0.871 | 0.900 | [0.744, 0.965] |
| 0.90-1.00 | 4 | 0.913 | 1.000 | [0.510, 1.000] |

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
| test | 0.0-0.2 | 99 | 0.160 | 0.081 | -0.487 (0.177) | -0.456 (99) |
| test | 0.2-0.3 | 190 | 0.254 | 0.200 | -0.245 (0.111) | -0.188 (189) |
| test | 0.3-0.4 | 312 | 0.346 | 0.365 | +0.005 (0.075) | +0.052 (312) |
| test | 0.4-0.5 | 244 | 0.447 | 0.410 | -0.126 (0.068) | -0.083 (240) |
| test | 0.5-0.6 | 244 | 0.553 | 0.590 | +0.017 (0.055) | +0.043 (240) |
| test | 0.6-0.7 | 312 | 0.654 | 0.635 | -0.073 (0.040) | -0.052 (312) |
| test | 0.7-0.8 | 190 | 0.746 | 0.800 | +0.025 (0.037) | +0.044 (189) |
| test | 0.8-1.0 | 99 | 0.840 | 0.919 | +0.050 (0.032) | +0.066 (99) |
| all | 0.0-0.2 | 215 | 0.164 | 0.102 | -0.373 (0.130) | -0.367 (175) |
| all | 0.2-0.3 | 554 | 0.258 | 0.211 | -0.221 (0.064) | -0.174 (400) |
| all | 0.3-0.4 | 1057 | 0.350 | 0.353 | -0.029 (0.041) | -0.008 (783) |
| all | 0.4-0.5 | 972 | 0.446 | 0.447 | -0.046 (0.034) | -0.019 (651) |
| all | 0.5-0.6 | 976 | 0.553 | 0.553 | -0.045 (0.028) | -0.013 (651) |
| all | 0.6-0.7 | 1057 | 0.649 | 0.647 | -0.044 (0.022) | -0.013 (783) |
| all | 0.7-0.8 | 554 | 0.743 | 0.789 | +0.017 (0.022) | +0.039 (400) |
| all | 0.8-1.0 | 215 | 0.836 | 0.898 | +0.029 (0.024) | +0.049 (175) |

### 4.8 Recalibration and stacking (fit on 2019-2023, scored on 2024-2025)

| Variant | Coefficients on logit scale [b, se] | LL tune | LL test | Test LL - close (95% CI) |
|---|---|---|---|---|
| close_mult |  | 0.6239 | 0.5875 | +0.0000 [0.0000, 0.0000] |
| close_slope | p_close_mult +1.120 (0.074) | 0.6232 | 0.5853 | -0.0022 [-0.0048, 0.0005] |
| close_power |  | 0.6232 | 0.5854 | -0.0021 [-0.0042, 0.0002] |
| close_power_slope | p_close_power +1.033 (0.069) | 0.6231 | 0.5850 | -0.0025 [-0.0054, 0.0006] |
| close+open | p_close_mult +0.990 (0.137); p_open +0.174 (0.154) | 0.6229 | 0.5855 | -0.0019 [-0.0048, 0.0010] |
| close+elo | p_close_mult +1.159 (0.080); elo -0.208 (0.163) | 0.6228 | 0.5862 | -0.0012 [-0.0048, 0.0023] |
| close+open+elo | p_close_mult +1.002 (0.137); p_open +0.222 (0.158); elo -0.253 (0.166) | 0.6223 | 0.5870 | -0.0005 [-0.0043, 0.0036] |
| open_mult |  | 0.6377 | 0.6094 | +0.0219 [0.0109, 0.0330] |
| open+elo | p_open +1.185 (0.091); elo -0.183 (0.163) | 0.6366 | 0.6079 | +0.0204 [0.0099, 0.0318] |
| elo |  | 0.6857 | 0.6770 | +0.0895 [0.0665, 0.1129] |
| market_rating |  | 0.6541 | 0.6258 | +0.0384 [0.0232, 0.0531] |
| market_rating_adj |  | 0.6455 | 0.6148 | +0.0273 [0.0132, 0.0419] |
| market_rating_adj+elo | p_mrating_adj +1.202 (0.101); elo -0.291 (0.169) | 0.6443 | 0.6113 | +0.0238 [0.0091, 0.0393] |
| market_rating_slope | p_mrating +1.122 (0.096) | 0.6537 | 0.6224 | +0.0350 [0.0200, 0.0495] |
| market_rating+elo | p_mrating +1.278 (0.119); elo -0.409 (0.179) | 0.6524 | 0.6213 | +0.0338 [0.0194, 0.0483] |
| close+market_rating | p_close_mult +1.041 (0.099); p_mrating +0.158 (0.131) | 0.6228 | 0.5838 | -0.0036 [-0.0066, -0.0004] |
| open+market_rating | p_open +0.915 (0.107); p_mrating +0.407 (0.126) | 0.6343 | 0.5998 | +0.0123 [0.0023, 0.0227] |
| close_fav_a_b | a -0.103 (0.086); b +1.250 (0.133) | 0.6229 | 0.5852 | -0.0023 [-0.0056, 0.0012] |

n: {'tune': 1955, 'test': 843}

### 4.9 Does anything known before the fight beat the close? (one feature at a time, plus all)

| Feature (A minus B) | Tune coef (se) | Test refit coef (se) | Test LL change vs close+slope (95% CI) |
|---|---|---|---|
| age | -0.1284 (0.0504) | -0.1072 (0.0835) | -0.0010 [-0.0048, 0.0031] |
| reach_in | +0.0166 (0.0153) | +0.0039 (0.0242) | +0.0002 [-0.0016, 0.0020] |
| height_in | +0.0321 (0.0199) | +0.0067 (0.0323) | +0.0003 [-0.0018, 0.0025] |
| log_ufc_fights | +0.0080 (0.0576) | -0.0224 (0.0930) | +0.0000 [-0.0002, 0.0002] |
| ko_losses | +0.0332 (0.0332) | +0.0319 (0.0514) | -0.0002 [-0.0019, 0.0013] |
| kd_absorbed | +0.0296 (0.0219) | +0.0043 (0.0335) | +0.0003 [-0.0019, 0.0024] |
| elo_logit | -0.2076 (0.1625) | +0.1655 (0.2550) | +0.0009 [-0.0007, 0.0026] |
| weight_move | -0.1055 (0.1126) | +0.0104 (0.1984) | +0.0002 [-0.0008, 0.0012] |
| southpaw | -0.0117 (0.0877) | -0.0322 (0.1436) | -0.0000 [-0.0002, 0.0001] |
| all nine | see json | see json | +0.0010 [-0.0052, 0.0072] |

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
| test | BetMGM | 636 | 0.5903 | 0.5893 | [-0.0006, 0.0027] |
| test | BetRivers | 830 | 0.5863 | 0.5860 | [-0.0013, 0.0021] |
| test | BetWay | 838 | 0.5879 | 0.5878 | [-0.0033, 0.0028] |
| test | Caesars | 828 | 0.5883 | 0.5873 | [-0.0008, 0.0027] |
| test | DraftKings | 633 | 0.5846 | 0.5854 | [-0.0031, 0.0015] |
| test | FanDuel | 837 | 0.5879 | 0.5883 | [-0.0017, 0.0008] |
| test | Unibet | 328 | 0.6024 | 0.6027 | [-0.0020, 0.0014] |

### 4.11 Soft-label scoring: model differences scored on outcomes (hard) vs on the closing line (soft)

| Period | Pair | Hard diff (se) | Soft diff (se) | se ratio hard/soft |
|---|---|---|---|---|
| tune (n 1955) | market_rating - elo | -0.0316 (0.0047) | -0.0218 (0.0012) | 3.8 |
| tune (n 1955) | market_rating_adj - market_rating | -0.0086 (0.0020) | -0.0039 (0.0005) | 4.18 |
| tune (n 1955) | open - market_rating_adj | -0.0078 (0.0051) | -0.0125 (0.0011) | 4.56 |
| test (n 843) | market_rating - elo | -0.0511 (0.0077) | -0.0382 (0.0025) | 3.03 |
| test (n 843) | market_rating_adj - market_rating | -0.0111 (0.0027) | -0.0074 (0.0008) | 3.46 |
| test (n 843) | open - market_rating_adj | -0.0054 (0.0073) | -0.0167 (0.0020) | 3.67 |

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

### 4.13 Segments (closing line)

| Segment | n | LL | Brier | Acc |
|---|---|---|---|---|
| title_tune | 93 | 0.6064 | 0.2089 | 0.677 |
| title_test | 38 | 0.6021 | 0.2094 | 0.632 |
| five_round_tune | 241 | 0.6366 | 0.2237 | 0.627 |
| five_round_test | 105 | 0.6214 | 0.2175 | 0.648 |
| womens_tune | 359 | 0.6304 | 0.2202 | 0.635 |
| womens_test | 146 | 0.5715 | 0.1936 | 0.740 |
| heavyweight_tune | 157 | 0.5965 | 0.2043 | 0.707 |
| heavyweight_test | 48 | 0.5786 | 0.1987 | 0.625 |

### 4.14 Line movement (no-vig, open to close)

| Period | n | Mean abs move | Median abs move | Share moving > 5 pts | Favourite flips |
|---|---|---|---|---|---|
| tune | 1955 | 0.0632 | 0.0517 | 0.518 | 247 |
| test | 843 | 0.0650 | 0.0549 | 0.543 | 108 |

### 4.15 Method-of-victory and round markets (per-book closes, 2021 on)

| Period | n | 6-way LL market (power) | market (mult) | market rescaled to moneyline | moneyline x division base rates | base rates only | uniform | Market - baseline (95% CI) | Books |
|---|---|---|---|---|---|---|---|---|---|
| tune | 1203 | 1.5560 | 1.5591 | 1.5561 | 1.6479 | 1.7218 | 1.7918 | [-0.1171, -0.0659] | 4.84 |
| test | 826 | 1.4770 | 1.4841 | 1.4779 | 1.5638 | 1.6687 | 1.7918 | [-0.1162, -0.0546] | 4.74 |

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

**test goes to decision**: market LL 0.6516 / Brier 0.2297 vs base rate LL 0.6841 / Brier 0.2455 (n 829; predicted 0.475, observed 0.542).
**test round of finish** (rounds 1..K + decision, n 828): market LL 1.1384 (mult 1.1464) vs base rates 1.1789.

| Class | Predicted share | Observed share |
|---|---|---|
| A_KO | 0.183 | 0.159 |
| A_SUB | 0.103 | 0.097 |
| A_DEC | 0.246 | 0.289 |
| B_KO | 0.161 | 0.133 |
| B_SUB | 0.086 | 0.071 |
| B_DEC | 0.220 | 0.251 |

### 4.16 Cleaning: stale or in-play prices in the closing range

Rule: closing range spread (implied-probability gap between low and high price of a side) > 0.2 marks the range and BFO mean as contaminated; per-book lines more than 0.15 from the median book are dropped. Fights left with no close: {'tune': 0, 'test': 0}; books dropped 12 in 12 fights.

| Period, range spread | n | LL raw range midpoint | LL single-book close (UUD) | LL open | LL chosen close |
|---|---|---|---|---|---|
| tune_0-0.05 | 1481 | 0.6201 | 0.6203 | 0.6364 | 0.6199 |
| tune_0.05-0.1 | 334 | 0.6331 | 0.6352 | 0.6437 | 0.6326 |
| tune_0.1-0.2 | 20 | 0.6628 | 0.6741 | 0.6685 | 0.6433 |
| tune_0.2-1.01 | 9 | 0.6010 | 0.7645 | 0.7244 | 0.7603 |
| test_0-0.05 | 606 | 0.5653 | 0.5653 | 0.5909 | 0.5655 |
| test_0.05-0.1 | 110 | 0.7004 | 0.7000 | 0.7062 | 0.7010 |
| test_0.1-0.2 | 7 | 0.8396 | 0.8098 | 0.7748 | 0.8210 |
| test_0.2-1.01 | 6 | 0.6072 | 0.7996 | 0.7518 | 0.8332 |

### 4.17 Data checks

- bfo_open_equals_nlbair_open: [2827, 2839]
- bfo_range_equals_nlbair_range: [2827, 2839]
- bfo_mean_vs_event_page_books_mean_abs_diff: {'n': 2035, 'mean': 0.0017, 'p95': 0.0068, 'share_lt_0.005': 0.9071}
- uud_vs_close_abs_diff: {'n': 2587, 'mean': 0.0109, 'p95': 0.0315}
- diag: {'nlbair_matched': 3183, 'uud_matched': 2689, 'bfo_matchups': 9960, 'bfo_matched_pass0_crosswalk': 3170, 'bfo_matched_pass1_names': 36, 'bfo_matched_pass2_rescheduled': 13, 'bfo_matched_pass3_undated': 6, 'bfo_matched': 3225, 'bfo_two_pages_agree': {'true': 3223}}

## 5. Recommendation for the engine (exact)

### 5.1 Benchmarks every engine version must report (2024-2025 validation)

Score on the same fights, joined on the backtest id. Use decisive fights only for the winner metrics, and
orient on the backtest's A (the metrics are symmetric). 2026 fights are the vault: they are scored only in the
v6/v10 audits, from `market_vault.json` in the vault directory, never from market.json.

| Target | Fights | Log loss | Brier | Accuracy | market.json field |
|---|---|---|---|---|---|
| Closing line, power no-vig | 843 | 0.5854 | 0.2005 | 0.693 | `p_power_close` |
| Closing line, multiplicative no-vig | 843 | 0.5875 | 0.2011 | 0.693 | `p_novig_close` |
| Opening line | 843 | 0.6094 | 0.2108 | 0.668 | `p_novig_open` |
| Market rating + offsets (no line needed) | 843 | 0.6148 | 0.2131 | 0.665 | `p_market_rating_adj` |
| Market rating | 843 | 0.6258 | 0.2181 | 0.655 | `p_market_rating` |
| Elo (K 44) | 843 | 0.6770 | 0.2422 | 0.547 | backtest `elo` |
| Six-way method of victory | 826 | 1.4770 | | | `method6` |
| Goes to decision | 829 | 0.6516 | 0.2297 | | `p_dec` |
| Round of finish (rounds 1..K + decision) | 828 | 1.1384 | | | `round_dist` |

Ship rules this implies:

- Each version must beat Elo (0.677) on these fights.
- A no-line engine should aim at the market rating (0.626, or 0.615 with offsets).
- The v9 stack must not do worse than the close when a close exists.

### 5.2 The market probability (whenever a line exists)

1. Consensus decimal odds. Take each US sportsbook's two-way price. Drop any book whose overround falls
   outside 0.98-1.25, or whose no-vig p is more than 0.15 from the median book's. Then d_A = mean of the kept books' decimal odds for A, and the same for
   d_B. Never use Kalshi or Polymarket prices scraped after the event.
2. Implied probabilities: q_A = 1/d_A and q_B = 1/d_B.
3. Power no-vig. Solve q_A^k + q_B^k = 1 for k by bisection on [0.05, 20]. Then
   **p_mkt = q_A^k / (q_A^k + q_B^k)**. No further favourite-longshot correction is fitted: the tune slope on
   the power close is 1.03 (se 0.07). On 2024-2025 it is 1.11 (se 0.09, not significant), so recheck it at each
   release.
4. If you use multiplicative no-vig instead (p = q_A / (q_A + q_B)), apply **p* = sigmoid(1.12 * logit p)**,
   the tune fit (se 0.074).
5. For an opening line (one book, often weeks out), use multiplicative no-vig and then
   **p* = sigmoid(1.14 * logit p)** (tune, se 0.082).

### 5.3 v9 stacking (engine + market)

    logit p_final = b_m * logit(p_mkt) + b_e * logit(p_engine) + b_age * (age_A - age_B) / 5

- **Fit:** logistic regression without an intercept (so the corner label cannot matter) on the engine's
  walk-forward predictions for 2019-2023. Score once on 2024-2025.
- **Starting values from this report:** b_m = 1.0 with power no-vig (1.12 with multiplicative). b_e = 0: the
  Elo analogue got -0.21 (se 0.16) with no test gain. b_age = -0.128 (se 0.050).
- **Keep b_e** only if it is positive on tune and the 2024-2025 log-loss gain has a 95% interval that excludes 0.
- **Keep b_age** only if the engine's own age effect does not already absorb it.
- **When only an opening line exists,** use the open in place of p_mkt. The test also supports adding the
  market rating: logit p = 0.915 * logit(p_open) + 0.407 * logit(p_rating) (fit on tune, se 0.107 and 0.126)
  scored 0.5998 against 0.6094 for the open alone on 2024-2025, a difference of -0.0096 [-0.0149, -0.0043].

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
The age term (se 0.010) is the market pricing age that the rating cannot see. The 2024-2025 refit agrees (-0.240).

**Live use.** `market.json.ratings[slug] = [mu, sd, last fight date, fights seen]` is drifted to the snapshot.
For any two fighters, p = sigmoid((mu_A - mu_B) / sqrt(1 + pi (sd_A^2 + sd_B^2) / 8)), then the offsets.
Stack with the engine as in 5.3, with p_rating_adj in place of p_mkt; the Elo analogue got b = 1.20 for the
rating and -0.29 for Elo.

**Caution.** Rating levels across divisions are tied only by fighters who change division, so cross-division
matchups are the least reliable (section 1, item 9).

### 5.5 Using the market while developing v4-v8

Score candidate changes on tune fights by cross-entropy against the power-no-vig close:
CE = -[p_close log p_model + (1 - p_close) log(1 - p_model)]. Rank changes by the mean difference. Its
standard error is 3.0-4.6 times smaller than with outcomes (table 4.11). It measures distance from the market,
not skill, so it overrates anything built from market prices (the open looks 0.017 better than the adjusted
rating against the close, but only 0.005 better on outcomes, which is not significant). Use it as a screen.
Confirm the final choice on outcomes and on 2024-2025.

Do not tune toward the market where it is biased:

- It prices favourites slightly too low (section 1, item 3).
- It prices finishes too high (section 1, item 6).
- It under-prices age.

### 5.6 Method and round targets (v6, v10)

- **Score** the engine's six-way method distribution [A_KO, A_SUB, A_DEC, B_KO, B_SUB, B_DEC] against
  `method6` on the same fights. KO includes doctor stoppages; DQs, draws and no-contests are excluded.
- **Score** P(decision) against `p_dec`, and the round of finish against `round_dist`.
- **Market shares are not targets.** On 2024-2025 the market predicted 34.4% KO and 18.9% submissions, against
  29.2% and 16.8% observed; the decision share was 46.6% predicted against 54.0% observed.
- **Engine calibration** of finishes belongs to outcomes (research/data_baserates.md).

## 6. Caveats

- **The opening line is one book's first price.** It is often posted weeks out at low limits, and its time
  stamp was not collected. "Close minus open" mixes information arrival with limit size.
- **The consensus is not a sharp book.** It is the mean of US recreational books (2021 on) or of BFO's mixed
  book list (2019-2020). BFO no longer lists Pinnacle, Circa or other sharp books, so a sharp close would
  likely score a little better than 0.588. The test close is also sharper than the tune close (0.588 vs
  0.624); Elo hardly moves between the periods, so the gain is the market's own.
- **The cleaning thresholds were chosen by inspection.** The 0.20 range spread and the 0.15 book deviation
  were set after seeing the leak, though they are applied without looking at outcomes. Residual in-play
  prices could remain in ranges narrower than 0.20. The tune years alone show the leak (9 fights).
- **Matching is name and date based** except where nlbair's crosswalk exists. Matching added 55 fights
  beyond the crosswalk; a few could be wrong. The 12 opening-line disagreements with nlbair are listed by
  the tool's checks.
- **The market rating ignores size and style** except through the tune-fit offsets, and it lags for long
  layoffs (its sd grows with the gap). The Volkanovski vs Gaethje gap shows its limits across divisions.
- **The age finding is one of nine features tested.** It keeps its sign on the test refit (-0.107, se 0.084),
  but its out-of-sample log-loss gain is not significant, so treat it as a hypothesis for v5.
- **2026 prices that encode results sit in the raw extract.** `data/raw/odds/bfo_event_lines.csv` keeps the
  Kalshi and Polymarket rows of 2026 cards, which were recorded after the fights, and backtest.json still holds 2026
  results. Development agents must read backtest_dev.json and never the 2026 rows of these files.
- **Props need all six method prices** at one or more books (an average of 4.5-4.8 books). How books grade
  DQs and technical decisions can differ from the classes used here.
- **Legal and terms.** BFO's robots.txt allows these pages. The fetch made about 1,840 requests at one every 2-3
  seconds with a desktop browser User-Agent. Raw pages stay in a local cache and are not committed. The
  compact extracts in data/raw/odds/ are factual prices with source credit.

## 7. Reproduce

```
python3 -I tools/market.py fetch --cache ~/.cache/xx-market   # about 1.5 hours the first time (polite BFO fetch)
python3 -I tools/market.py props --cache ~/.cache/xx-market   # seconds (reads the cache)
python3 -I tools/market.py build --props                      # about 30 s; also writes <vault dir>/market_vault.json
python3 -I tools/market.py tables                             # the tables in section 4
```

Credit: odds data from BestFightOdds.com; nlbair/ufc-data (Bair 2026, CC BY 4.0); Ultimate UFC Dataset (mdabbert,
CC BY 4.0); fight results from ufcstats.com via the project's backtest.

## Verification log

Adversarial review, Friday, November 6, 2026 (afternoon), replacing the verifier that the usage limit cut off. I
assumed the headline was inflated until shown otherwise and re-ran it with fresh code
(`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/mkt_review/verify.py`, about 6 s).
That code reads only `data/derived/backtest_dev.json` (fights before 2026-01-01), the raw extracts and market.json.
It never reads 2026 results. The vault export was compared with the old 2026 rows for equality only; no outcome was
read.

**Fixed: the vault was scored (major).** `TEST` was `('2024-01-01', '2099-12-31')` on `backtest.json`, so every test
number, table 4.1-4.17 and the Kalshi check scored the 373 vault fights of 2026. That breaks the hidden-data protocol.
The fix in `tools/market.py`:
- `TEST` now ends 2025-12-31, and `period_of` labels 2026+ as `vault`.
- Vault rows carry no result, never enter a score, and are written to `market_vault.json` in the vault directory
  (`--vault-dir`, the same default as tools/make_vault.py).
- market.json's per-fight table now holds the 2,855 development fights only.
- Scored market-rating predictions come from a filter run that stops at 2025-12-31.
- The live `ratings` snapshot still runs over all fights, and its meta says it is for live use only.

After the rebuild, all 2,855 development rows and the ratings are identical to the first build, and the 373 vault
rows equal the old 2026 rows. Downstream inputs (ml.py, moe.py, methodround.py, ratings.py) are therefore unchanged
for 2019-2025. Only their 2026 lookups now come back empty, as the protocol wants.

What the fix changed in the 2024-2025 benchmarks:

| Benchmark | First build (2024-2026) | Corrected (2024-2025) |
|---|---|---|
| Fights scored | 1,212 | 843 |
| Close, multiplicative no-vig | 0.5912 | 0.5875 |
| Close, power no-vig | 0.5899 | 0.5854 |
| Opening line | 0.6126 | 0.6094 |
| Market rating | 0.6336 | 0.6258 |
| Market rating + offsets | 0.6221 | 0.6148 |
| Elo | 0.6800 | 0.6770 |
| Six-way method | 1.4762 | 1.4770 |
| Goes to decision | 0.6464 | 0.6516 |
| Round of finish | 1.1600 | 1.1384 |

**Fixed: over-claims in section 1.**
- Item 3 presented favourites' +1% to +2% as a return. Each band is within about 1.5 standard errors of zero.
- On 2024-2025 the power close keeps slope 1.11 (se 0.09); before, the text implied the bias was fully removed.
- Item 4: on 2024-2025 close + market rating beats the multiplicative close (-0.0036 [-0.0066, -0.0004]). Against the
  tune-chosen power close it gains only -0.0018 [-0.0036, +0.0000], and it is the best of 17 variants, so it is a
  lead. The report now says so.
- Item 8 claimed soft-label scoring was "like 10-20 times as many fights". It measures distance from the market. On
  test, the open beats the adjusted rating by 0.017 against the close but by only 0.005 on outcomes (not
  significant). The claim is now worded as a screen.
- Smaller edits: a duplicated matching sentence; a note that the matching counts cover all 3,237 fights (matching is
  outcome-blind); "age replicates" is now "keeps its sign".

**Re-derived independently (all pass).**
- *Orientation.* I rebuilt 2,045 per-book consensus closes from `bfo_event_lines.csv`, with my own name matching
  for the corner order. None differs from market.json by more than 0.01. nlbair's first fighter is the backtest's A
  in every row. Its range midpoint correlates 0.994 with the close. The 9 sign disagreements are all explained:
  in-play ranges (Allen-Yusuff, Blanchfield-Fiorot), nlbair's reversed Kelleher-Croom, and wide stale ranges. In each
  case the chosen close agrees with the open.
- *Headline.* Fresh code reproduces every tune and 2024-2025 figure in tables 4.2-4.4 to 4 decimals. Scoring with the
  corners swapped gives identical numbers for every model.
- *Symmetry.* No fitted model has an intercept. The favourite intercept is fit in favourite orientation, which is
  symmetric. Code read.
- *Leakage probes.*
  1. A book's deviation from the other books, regressed on the outcome residual, gives slope 0.09 on tune and 0.51 on
     test. Leaked results would push it far above 1.
  2. The consensus close against an independent single-book close (the Ultimate UFC Dataset, matched by my own
     code) is within ±0.004 log loss in every year from 2019 to 2025. In-play prices would give the consensus an edge
     it does not have.
  3. 2,845 BFO matchups are dated within 0 to +1 day of the fight. Three are not (Gautier-Valentin -7 days,
     Dalby-Salikhov +7 days after a reschedule, Oliveira-Dariush on a "potential fights" page), and 5 are undated.
     Two spot checks match published pre-fight lines: Oliveira-Dariush closes at Dariush -140, against -145 to -154 in
     the press ([Action Network](https://www.actionnetwork.com/mma/ufc-289-odds-picks-predictions-charles-oliveira-vs-beneil-dariush-betting-preview-june-10),
     [theScore](https://thescore.com/mma/news/2660883)). Pereira-Adesanya 2 closes at Adesanya -139 / Pereira +119,
     against DraftKings -140/+120 ([Action Network](https://www.actionnetwork.com/mma/ufc-287-odds-picks-predictions-alex-pereira-vs-israel-adesanya-betting-preview-april-9)).
  4. No matchup serves two fights.
- *Market rating.* I re-implemented it from the equations in 5.4, with the stream cut at 2025-12-31. It reproduces all
  2,855 stored predictions within 0.0001 (4-decimal rounding). So each prediction uses only earlier fights, and no
  2026 data. No fighter appears twice on one date. The parameters and offsets are fit on tune (code read).
- *Pre-fight features.* Age is taken at the fight date. The home division comes from earlier fights only (build_db
  `mode_recent`). Elo is pre-fight, and K was chosen on 2019-2023 (elo_report.json). Height, reach and stance are
  current snapshot values, a minor static look-ahead.
- *Props.*
  - The A side's three method prices sum to the A moneyline (correlation 0.995), so the orientation is right.
  - `p_dec` correlates 0.997 with the method decision share and 0.999 with the round props' decision cell, so yes
    and no are not swapped.
  - The base rates come from `priors_asof[year]`, which uses fights before January 1 of that year.
  - Method6, goes-to-decision and round log losses all reproduce.
- *No-contests and draws.* The 55 non-decisive development fights have rows but never enter winner scores. Draws
  count as decisions for goes-to-decision. DQs and no-contests are left out of round of finish.
- *Extra intervals from my bootstrap (2,000-4,000 event resamples).* Close + rating minus power close: -0.0018
  [-0.0036, +0.0000]. Open + rating minus open: -0.0096 [-0.0149, -0.0043]. Adjusted rating minus open: +0.0054
  [-0.0082, +0.0200].

**Open, not fixed here.**
- The repo's `backtest.json` and `data/raw/odds/bfo_event_lines.csv` still hold 2026 results and 2026 exchange prices
  recorded after the fights. The vault is sealed only by convention.
- The Kalshi finding was made on vault fights and is not re-verified.
- The 0.20 spread and 0.15 book cut-offs were chosen after looking at every year, 2026 included. They are applied
  without outcomes; their effect is about 0.001.
- Six closes come from BFO's undated pages. They may be stale, though both spot checks matched.
- Tools that scored market.json's 2026 rows quote 2024-2026 numbers until they are rerun. Example: ml.py's "2024+"
  comparison with the close.

Reproduce: `python3 -I tools/market.py build --props` (about 30 s), then `python3 -I tools/market.py tables`, then
`python3 -I <scratchpad>/mkt_review/verify.py /home/user/XX`.
