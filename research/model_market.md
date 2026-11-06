# Market model: historical UFC betting odds (engine v9 component)

Prepared Friday, November 6, 2026. Tool: `tools/market.py`. Output: `data/derived/market.json`.
Compact source extracts: `data/raw/odds/`. Every table in the results section is printed by
`python3 -I tools/market.py tables` from market.json, so the numbers match the JSON exactly.

Periods follow the project rule. **Tune**: 2019-01-01 to 2023-12-31. **Test (held out)**: 2024-01-01 to
2026-10-31. Every fitted number (no-vig method, slopes, stacking weights, rating parameters, offsets) is fit on
tune only and then scored once on test. Uncertainty: 95% intervals from a cluster bootstrap that resamples
whole events (__BOOT__ resamples), because fights on one card share news, lines and judges.

## 1. Bottom line

__BOTTOM__

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
__MATCH__

**Coverage, honestly.** __COVERAGE__

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

__TABLES__

## 5. Recommendation for the engine (exact)

__RECO__

## 6. Caveats

__CAVEATS__

## 7. Reproduce

```
python3 -I tools/market.py fetch --cache ~/.cache/xx-market   # about 1.5 hours the first time (polite BFO fetch)
python3 -I tools/market.py props --cache ~/.cache/xx-market   # seconds (reads the cache)
python3 -I tools/market.py build --props                      # about 3 minutes (rating grid + bootstraps)
python3 -I tools/market.py tables                             # the tables in section 4
```

Credit: odds data from BestFightOdds.com; nlbair/ufc-data (Bair 2026, CC BY 4.0); Ultimate UFC Dataset (mdabbert,
CC BY 4.0); fight results from ufcstats.com via the project's backtest.
