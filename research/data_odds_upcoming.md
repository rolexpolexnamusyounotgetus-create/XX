# Upcoming odds for the forward test (Nov 7 - Dec 20, 2026)

Prepared Friday, November 6, 2026. This covers current moneylines from every publicly readable book
for the UFC cards in the forward-test window. It also has no-vig probabilities (multiplicative, Shin
and power), a consensus, the market open, Pinnacle's timestamped line history, and the books'
method-of-victory and goes-the-distance props.

- Tool: `tools/odds_upcoming.py`.
- Snapshots: `data/predictions/odds_snapshot_<YYYYMMDD-HHMM>.json` (UTC, never overwritten).
- Open-vs-close timeline across all snapshots: `data/derived/odds_upcoming.json`.

These lines are a **forward-test benchmark only**. They are known before each fight, so they can be
compared with (or, if a model version says so explicitly, blended into) a prediction committed at the
same time. They are never a training feature for 2026 fights (hidden-data protocol, `docs/BACKLOG.md`).

## Re-running (before every card, and once after it)

```
python3 -I tools/odds_upcoming.py snapshot      # ~90 requests, ~3.5 min; writes a new snapshot + rebuilds the timeline
python3 -I tools/odds_upcoming.py show          # table of the latest snapshot
python3 -I tools/odds_upcoming.py plan          # recommended capture times per event
python3 -I tools/odds_upcoming.py timeline      # rebuild data/derived/odds_upcoming.json only
python3 -I tools/odds_upcoming.py snapshot --replay 20261106-1015   # rebuild one capture from the raw cache, no network
```

Options: `--since/--until` (default yesterday .. today + 45 days), `--sources`
(default `fightodds,bestfightodds,actionnetwork,covers`), `--history Pinnacle` (books whose full line
history is read; `none` to skip, saving about 30 requests), `--no-fight-detail`, `--skip-wiki`,
`--delay` (seconds between requests, minimum 1.0, default 1.25).

Capture schedule per event, which `plan` prints from the card's lock time:

1. **Any time in fight week.** Gives the line movement.
2. **T-2h before the lock.** The lock is the event's earliest `start_utc` in `cards_upcoming.json`.
   This gives the market at prediction time, the comparison for the ledger file committed before
   the lock (`last_pre_lock` in the timeline).
3. **About T+10h.** The books' archived closing lines, as BFO and fightodds keep them after the bell
   (`archived_close`).

The post-event run still finds the event after BFO's home page and Wikipedia's scheduled list drop it.
It re-reads the BFO event pages and carries over the bouts from the previous snapshot.

Runs so far: 2026-11-06 09:50, 10:02 and 10:15 UTC. All three are the "early fight-week" capture.
All three files were rebuilt from their cached raw pages (`--replay`, same raw data) by the verifier at
about 10:48 UTC, after the fixes in the verification log below. Each keeps its original capture time,
window and live request counts (`meta.rebuilt_from_cache_utc` records the rebuild). Against the files they
replaced, only the exchange fields changed.

## Coverage (snapshot 20261106-1015)

`cards_upcoming.json` (as of 2026-11-06T10:10Z) lists **59 bouts on five cards** in the window.
**29 have moneylines.** Nothing is booked on Nov 28 or Dec 19.

| Event | Date | Lock (UTC) | Bouts | With odds | Books per bout (median) | Props (method / distance) |
|---|---|---|---|---|---|---|
| UFC Fight Night: Cortes-Acosta vs. Walker (Vegas 124) | Nov 7 | 22:00 | 14 | 14 | 21 | 13 of 14 (no props yet for Bashi-Calderon) |
| UFC 334: Gane vs. Hokit | Nov 14 | 22:00 | 12 | 12 | 10 | 2 (main event, co-main) |
| UFC Fight Night: Procházka vs. Stirling (Doha) | Nov 21 | 15:00 | 11 | 1 (6 books) | 6 | 0 |
| UFC Fight Night 295 (Riyadh) | Dec 5 | 12:00 (estimate) | 10 | 0 | - | 0 |
| UFC 335: Oliveira vs. Lopes | Dec 12 | 22:00 | 13 | 2 (13-14 books) | 14 | 0 |

The lines get filled in as the books open each card. Rerun the tool and the new bouts appear.

**Books seen (29):**

- Sportsbooks: FanDuel, DraftKings, BetMGM, Caesars, BetRivers, Unibet, Betway, HardRock, bet365,
  Fanatics, theScore, Bovada, MyBookie, BetUS, YouWager, BetAnything, Cloudbet.
- Sharp/low-margin: Pinnacle, Circa, Bookmaker, BetOnline, Bet105.
- Exchanges / prediction markets: Polymarket (international book), PolymarketUS (the Polymarket US app,
  BFO's "Polymarket" column), Kalshi, SXBet, ProphetX, 4casters, 4Cx.

Every bout with odds has at least one sharp book. 16 of 29 have Pinnacle, and 26 of 29 have an
exchange.

## Sources and how they are read

All requests use the generic User-Agent `FightLabSim/1.0 (private research)`, with no email.
`robots.txt` is checked at run time by a Google-style matcher (longest match, `*` and `$`). Requests
are at least 1.25 s apart overall. Every raw response is cached gzip'd under
`data/raw/web_cache/<site>/<stamp>/`, which is gitignored. That makes any snapshot rebuildable with
`--replay`.

| Source | What it gives | robots.txt | Requests/run |
|---|---|---|---|
| **fightodds.io** (public GraphQL API the site itself calls, `api.fightodds.io/gql`, with the site's own persisted query texts read from its JS bundle; the 6 MB bundle is fetched once per site deploy and its queries cached) | 24 books per bout incl. Pinnacle, Circa, Bookmaker, BetOnline and 6 exchanges; per book the current line, the **opening line**, best/worst seen; Pinnacle's full timestamped history (`OddsChartQrQuery`) | no rules (site serves its SPA; API host has only Cloudflare content-signal comments, no Disallow) | ~70 (1 event list, 5 event tables, 1 per fight, 2 per fight for history) |
| **bestfightodds.com** event pages | Moneylines for the US books BFO lists today (FanDuel, Caesars, BetRivers, Betway, Unibet; its DraftKings/BetMGM columns are empty right now) plus Polymarket US (stored as `PolymarketUS`) and Kalshi (BFO's Kalshi prices include Kalshi's taker fee); **props** (method, inside the distance, goes to decision, rounds totals, round betting) | all allowed except `/cnadm/` | ~9 |
| **actionnetwork.com** `/ufc/odds` (`__NEXT_DATA__`) | Next card only: DK, FanDuel, BetMGM, bet365, Polymarket, AN's own opener and consensus, scheduled start per bout | `/*?*` disallowed, so no date parameter, next card only; `api.actionnetwork.com` disallows everything and is not used | 1 |
| **covers.com** `/sport/mma/ufc/odds` (oddsshark.com/ufc/odds redirects here) | BetMGM, bet365, DK, FanDuel, Fanatics, BetRivers, Caesars, theScore, HardRock | allowed | 1 |
| **Wikipedia** (`/wiki/` pages only; `/w/` and `/api/` are disallowed) | Scheduled events and cards (fallback when `cards_upcoming.json` is absent) | allowed for `/wiki/` | 6 |
| Not used | ufc.com (403 to this UA), tapology (blocked), oddsshark (redirect), Action Network API (robots) | | |

## Method

**Bout universe and orientation.**

- `data/predictions/cards_upcoming.json` defines the bouts when it exists. Its a/b order is kept, so
  every `p_*` is P(a wins). Each record carries the ledger's
  `bout_id = date:slug_a__slug_b` (slugified name when the slug is null), plus rounds, title, status
  and segment.
- Without the file, the tool falls back to Wikipedia's cards plus any in-window bout an odds site
  lists.
- Source bouts are matched to card bouts by fuzzy names, in either orientation, on the same event
  (±1-2 days, because BFO and AN date by UTC). The matcher handles diacritics, middle names, joined
  given names in another order ("Ko Seok-hyeon" = "Seokhyeon Ko") and the card's `alt_names`.
- BFO splits each card into two event pages by UTC date and keeps stale duplicates (e.g.
  "Jonny Parsons vs Jose Henrique" next to "...vs Jose Souza"). The listing with more books is used
  and the other is recorded in `duplicates_ignored`.
- Source bouts not on the card go to `unmatched_source_bouts`. Today those are five stale listings:
  Nickal-Pyfer on BFO and Covers, Yanez-Diaz, Sadykhov-Nascimento and Barber-Judice on Covers. Each
  is annotated with the reason `cards_upcoming.json` gives for its removal.

**One line per book.**

- Each source/book observation is oriented to (A, B).
- It is rejected when its overround is outside [1%, 15%] for sportsbooks (the lowest real sportsbook
  margin seen is Circa's 3.1%), or outside [-1%, 20%] for exchanges.
- It is also rejected, when 4+ books are present, if its no-vig logit is more than 0.60 from the
  cross-book median.
- Covers is **low trust**: several of its columns carry other markets (e.g. +2200/+3500 under
  "BetMGM"). Its lines must sit within 0.25 logit of the trusted books' median and never set the best
  price.
- A book seen on several sites counts once, preferring fightodds > BFO > Action Network > Covers.
  The other copies stay in `other_source_lines`, and `src_disagree` flags a copy more than 3 points
  off. There are 2 cases in 20261106-1015, and neither is a timing difference (see the verification log):
  Ko-Turman BetRivers (fightodds -714/+475, BFO -1115/+650, unchanged over four reads in 40 minutes)
  and Pavlovich-Pereira HardRock (fightodds -200/+160, Covers -170/+140).
- In 20261106-1015: 613 lines were used (fightodds 518, BFO 47, Covers 34, AN 14), 223 duplicate
  copies were kept for audit and 80 Covers lines were rejected.

**No-vig probabilities.** Implied probabilities are q_i = 1/d_i, with S = Σq. Per book:

- multiplicative `p_mult` = q_A / S;
- **Shin** `p_shin`: p_i = (√(z² + 4(1-z) q_i²/S) - z) / (2(1-z)), with z solved by bisection so
  that Σp = 1. In a two-way market z comes out about equal to the overround;
- power `p_power`: p_i = q_i^k with Σp = 1. This was the best method on the 2019-23 tune period in
  `tools/market.py`.

**Consensus** (`consensus` block, sportsbooks only; exchanges are reported separately and never mixed
in):

| Field | Definition |
|---|---|
| `p_consensus` (headline) | logit-mean of per-book Shin P(A), min and max trimmed when 5+ books |
| `p_{mult,shin,power}_lmean` / `_median` | same per method; medians as a robustness check |
| `p_meandec_mult` | mean of the books' decimal odds per side, then multiplicative devig; the estimator behind the historical close in `data/derived/market.json`, so forward and backtest benchmarks are comparable |
| `p_sharp_shin`, `p_pinnacle_shin` | Pinnacle, Circa, Bookmaker, BetOnline, Bet105 (logit-mean of Shin); Pinnacle alone |
| `p_exchange_mult` | Polymarket, PolymarketUS, Kalshi, SXBet, ProphetX, 4casters, 4Cx (logit-mean of multiplicative no-vig) |
| `best`, `best_overround`, `arb` | best price per side over trusted sportsbooks; arb flagged below -0.2% |
| `sd_books`, `range_books`, `mean_overround` | dispersion and margin |

**Ledger market block** (`market`). This follows the format in `data/predictions/README.md`:
`{source, captured_utc, odds_a, odds_b, p_a_novig}`. It is the **mean of BestFightOdds' sportsbook
lines** (decimal mean converted back to American, multiplicative no-vig), which is the ledger's
definition of the closing benchmark. It falls back to all books when BFO has none.

**Open.** `open.p_open` is the logit-mean of Shin no-vig over fightodds' per-book opening lines
(sportsbooks only). Exchange "openers" are illiquid placeholders (Polymarket -3233/-3233, Kalshi
-1011/-1011) and are ignored. Action Network's own opener is kept beside it.

**Line history.** For Pinnacle (`--history`), both sides' full fightodds histories are merged into
`[t_utc, odds_a, odds_b, p_a_shin]`. Updates within 2 minutes count as one move. The earliest open is
Gane-Hokit and Harrison-Nunes at Pinnacle on 2026-09-20 14:21 UTC; the Nov 7 card opened Nov 1.

**Props** (BFO). `props.raw` keeps per-book prices by prop:

- `decision`, `over_x.5`, `ko_A`, `sub_A`, `dec_A`, `itd_A`, `r1_A` ... `r5_A`, `draw`,
  `ends_r1` ...
- BFO's team index is mapped to A/B, so last names are never guessed.

Summaries built from those prices:

- `two_way`: median over books of the Shin P(yes), where both sides are offered.
- `method.p_method`: each book's six method props plus the draw form one exhaustive market, devigged
  with n-way Shin. The median is taken over books and renormalised, using the ledger keys
  `a_ko, a_sub, a_dec, b_ko, b_sub, b_dec, draw`.
- `p_distance`: the "Fight goes to decision" two-way when offered, else a_dec + b_dec.

**Phase and lock.**

- A bout's start is its segment's `start_utc` from the card file (prelims, main, early_prelims).
  Failing that it is Action Network's scheduled time, then the event lock.
- A capture is `pre_start` or `post_start` relative to that start, judged by the latest fetch time of
  the bout's lines (a run takes about 4 minutes), not the time the run started.
- `pre_lock` is set when those lines were all fetched before the event's earliest start.
- Riyadh has no published times yet. Its lock is a conservative regional estimate (12:00 UTC for
  Middle East cards).

**Timeline** (`data/derived/odds_upcoming.json`). The record per bout:

- `market_open`
- `first_capture`, `last_pre_lock`, `last_pre_start` (with `hours_before_start`) and
  `archived_close`, each holding P(A) by consensus, BFO-ledger, sharp, Pinnacle and exchanges, plus
  the method market and P(distance)
- `book_history.Pinnacle` (open and last pre-start point)
- `move_open_to_last_pts`

Bouts are joined across snapshots by date plus the sorted slug pair, with a fuzzy fallback. A capture
whose a/b order flipped after a card refresh is inverted.

## What the market says right now (snapshot 20261106-1015)

P(A) is the probability that the first-named fighter wins.

| Date | A vs B | Books | P(A) consensus (Shin) | BFO ledger: odds, no-vig | Sharp | Exchanges | Open | Pinnacle open (UTC) | P(distance) |
|---|---|---|---|---|---|---|---|---|---|
| 11-07 | Waldo Cortes-Acosta vs Johnny Walker | 20 | 0.674 | -235/+185, 0.666 | 0.676 | 0.667 | 0.642 | -201/+170 (11-01 23:50) | 0.225 |
| 11-07 | Tatiana Suarez vs Virna Jandiroba | 21 | 0.651 | -205/+165, 0.640 | 0.650 | 0.641 | 0.630 | -168/+143 (11-01 13:20) | 0.715 |
| 11-07 | Davey Grant vs Elijah Smith | 21 | 0.263 | +243/-316, 0.277 | 0.261 | 0.267 | 0.321 | +187/-223 (11-01 23:50) | 0.428 |
| 11-07 | Billy Elekana vs Lucas Fernando | 21 | 0.256 | +246/-323, 0.275 | 0.253 | 0.259 | 0.299 | +212/-255 (11-01 13:20) | 0.404 |
| 11-07 | Priscila Cachoeira vs Nina Nikolija Milošević | 21 | 0.188 | +356/-501, 0.208 | 0.184 | 0.189 | 0.206 | +337/-425 (11-01 13:20) | 0.225 |
| 11-07 | Mitch Raposo vs Marcos Degli | 21 | 0.318 | +188/-237, 0.331 | 0.315 | 0.317 | 0.314 | +199/-238 (11-01 13:20) | 0.460 |
| 11-07 | Keiichiro Nakamura vs Ollie Schmid | 21 | 0.757 | -350/+268, 0.741 | 0.764 | 0.755 | 0.756 | -370/+298 (11-01 13:20) | 0.259 |
| 11-07 | Gabriel Lourenço vs Thomas Petersen | 20 | 0.391 | +139/-175, 0.397 | 0.387 | 0.387 | 0.394 | +142/-167 (11-01 13:20) | 0.364 |
| 11-07 | Karine Silva vs Gabriella Fernandes | 21 | 0.672 | -224/+177, 0.657 | 0.675 | 0.670 | 0.609 | -160/+136 (11-01 13:20) | 0.570 |
| 11-07 | José Mauro Delano vs Murtazali Magomedov | 21 | 0.517 | -119/-103, 0.517 | 0.515 | 0.514 | 0.510 | -119/+102 (11-01 13:20) | 0.418 |
| 11-07 | Austin Bashi vs Carlos Calderon | 20 | 0.823 | -522/+376, 0.800 | 0.828 | 0.807 | 0.802 | -486/+378 (11-05 15:20) |  |
| 11-07 | Mantas Kondratavičius vs Andre Petroski | 20 | 0.729 | -312/+241, 0.721 | 0.726 | 0.721 | 0.727 | -288/+238 (11-01 13:20) | 0.221 |
| 11-07 | Ko Seok-hyeon vs Wellington Turman | 21 | 0.853 | -769/+518, 0.845 | 0.852 | 0.836 | 0.834 | -650/+482 (11-01 13:20) | 0.489 |
| 11-07 | Jonny Parsons vs José Henrique Souza | 20 | 0.321 | +191/-240, 0.327 | 0.319 | 0.319 | 0.373 | +162/-191 (11-01 13:20) | 0.380 |
| 11-14 | Ciryl Gane vs Josh Hokit | 21 | 0.689 | -259/+203, 0.686 | 0.681 | 0.651 | 0.699 | -245/+205 (09-20 14:21) | 0.343 |
| 11-14 | Kayla Harrison vs Amanda Nunes | 21 | 0.628 | -193/+156, 0.627 | 0.625 | 0.618 | 0.644 | -210/+177 (09-20 14:21) | 0.374 |
| 11-14 | Caio Borralho vs Yousri Belgaroui | 16 | 0.588 | -157/+127, 0.581 | 0.585 | 0.585 | 0.561 |  |  |
| 11-14 | Uroš Medić vs Kevin Holland | 16 | 0.614 | -173/+138, 0.602 | 0.604 | 0.621 | 0.594 |  |  |
| 11-14 | Bilal Hasan vs Luis Gurule | 16 | 0.878 | -923/+574, 0.859 | 0.882 | 0.834 | 0.878 |  |  |
| 11-14 | Stephen Thompson vs Charles Radtke | 10 | 0.554 | -129/+104, 0.535 | 0.546 | 0.531 | 0.539 |  |  |
| 11-14 | Drew Dober vs Chris Duncan | 8 | 0.403 | +133/-161, 0.410 | 0.408 | 0.413 | 0.419 |  |  |
| 11-14 | Jim Miller vs Terrance McKinney | 10 | 0.337 | +172/-222, 0.348 | 0.343 | 0.335 | 0.340 |  |  |
| 11-14 | Donte Johnson vs César Almeida | 10 | 0.617 | -184/+150, 0.618 | 0.616 | 0.622 | 0.593 |  |  |
| 11-14 | Jared Gordon vs Melquizael Costa | 10 | 0.234 | +300/-412, 0.237 | 0.228 | 0.210 | 0.233 |  |  |
| 11-14 | Macy Chiasson vs Beatriz Mesquita | 8 | 0.343 | +172/-222, 0.348 | 0.342 | 0.345 | 0.343 |  |  |
| 11-14 | Evan Elder vs Samuel Sanches | 10 | 0.514 | -120/-105, 0.516 | 0.513 | 0.531 | 0.517 |  |  |
| 11-21 | Jiří Procházka vs Navajo Stirling | 6 | 0.436 | +110/-138, 0.451 | 0.436 | | 0.438 | | |
| 12-12 | Charles Oliveira vs Diego Lopes | 13 | 0.576 | -156/+123, 0.577 | 0.571 | | 0.585 | | |
| 12-12 | Sergei Pavlovich vs Alex Pereira | 14 | 0.644 | -203/+160, 0.635 | 0.644 | | 0.614 | | |

Numbers worth knowing (29 bouts, one capture; read them as descriptive, not as tested findings):

- **The books agree closely.** The per-book Shin P(A) has a median sd of 0.7 points across books
  (max 1.8). The median sportsbook margin is 4.8%; at the best available prices it is 2.2%. No real
  arbitrage was found once the stale Covers lines were excluded.
- **The method matters about as much as the book.**
  - Shin vs multiplicative consensus: 0.8 points on average (max 1.8), larger for heavy favourites.
  - Power vs Shin: 0.4 points.
  - Headline consensus vs the BFO ledger block: 1.0 point on average (max 2.3). That is mostly Shin
    vs multiplicative plus BFO's smaller, retail-only book set.
  - When the forward test is scored, compare like with like: `p_meandec_mult` or `market.p_a_novig`
    against the historical `market.json` close, and `p_consensus` as the best current estimate.
- **Sharp books vs the consensus: 0.35 points** on average (max 1.0).
- **Exchanges vs sportsbooks (multiplicative): 1.0 point.** Exchanges price some favourites lower,
  e.g. Gane 0.651 vs 0.689 and Hasan 0.834 vs 0.878.
- **Moves since the open.** The mean absolute move is 1.8 points (max 6.3). 3 of 29 moved more than
  5 points: Karine Silva 0.609 to 0.672, Grant 0.321 to 0.263, and Parsons 0.373 to 0.321. 22 of the
  28 bouts that moved (79%) moved toward the opening favourite.
- **Method market** (15 bouts; 4 retail books for 11 of them, 3 for Nakamura-Schmid, Gane-Hokit and
  Harrison-Nunes, and FanDuel alone for Parsons-Souza; median margin 18% on the 7-way market):
  - Average P(KO) 0.42, P(sub) 0.20, P(decision) 0.38, P(draw) 0.009.
  - Its implied P(A) matches the moneyline consensus within 1.1 points on average.
  - The two P(distance) estimates (two-way prop vs method sum) differ by 1.1 points on average.

## Caveats

- **Exchange identities** (checked Nov 6 against the exchanges' own public APIs). fightodds' "Polymarket"
  is the international Polymarket book: it matched the gamma-api.polymarket.com best asks on 23 of 26
  bouts, and the other 3 were within a cent. BFO's "Polymarket" column is the **Polymarket US** app, its
  header disclosure says so, and its prices are not the international book's. It is stored as
  `PolymarketUS`, a separate exchange. Until the verification it was merged with fightodds'
  Polymarket, which produced 4 false `src_disagree` flags.
  Kalshi on fightodds is the raw ask (it matched the Kalshi API on 20 of 22 bouts). BFO's Kalshi
  column adds Kalshi's taker fee of 0.07 p(1-p). Action Network's "Polymarket" is the international book's mid price, with no
  spread. None of these enter `p_consensus` or the ledger `market` block.
- **Like-for-like benchmark.** `market.p_a_novig` (the mean of BFO's US sportsbooks, multiplicative) uses
  the book set and estimator of `data/derived/market.json`'s primary close definition. `p_meandec_mult` uses the
  same estimator over every sportsbook, offshore included. `market.json` also drops a book more than
  0.15 from the median book; here the cross-book filter is 0.60 logit.

- **Card dependence.** Bouts not in `cards_upcoming.json` are not scored. They are listed in
  `unmatched_source_bouts` so the cards can be refreshed. Replays use the cards file as it is now;
  `meta.card_as_of` records which version.
- **Covers is noisy.** Most of its columns hold other markets or stale prices. It contributes only
  Fanatics and theScore after filtering, and is excluded from best price and arb checks. The column
  mapping was verified against fightodds (Gane-Hokit: Covers' DK -245/+200 and Caesars -235/+195 equal
  fightodds').
- **Thin early markets.** The Doha, UFC 335 and UFC 334 prelim lines come from 6-16 books, mostly
  offshore/retail, with no exchange. Riyadh has no lines yet.
- **Method props are retail-only** (FanDuel, BetRivers, Betway, Unibet on BFO) with about 18% margin
  on the 7-way market. Shin removes more of it from longshots than a proportional devig would. The
  medians are renormalised so the seven keys sum to 1.
- **fightodds.io API.** The tool posts the exact query texts the site's own bundle uses, at the
  site's normal request pattern, and only reads public odds. If the site changes its queries, the
  tool re-reads the bundle. If a query is refused, that source is skipped and the snapshot records
  the error; it never aborts.
- **Timing.** Every book line carries the fetch time of its page (`t`). Sources are read in sequence
  over about 3 minutes, so a cross-source gap of a few points can be timing alone. The 2 flagged in
  20261106-1015 are not: both were stable across reads (verification log).
  fightodds' `oddsOpen` is the first line fightodds recorded for that book, not necessarily the
  book's first offer. Exchange openers are ignored.
- **Start times.** Phases use the card's segment times. Bouts in segment `unknown` use the event's
  earliest start. Riyadh's lock is an estimate until its times are published.
- **Size.** About 260-300 KB per snapshot (one bout per line, so git diffs stay readable). Roughly 15
  snapshots over the window comes to about 4.5 MB.
- **Not validated as a predictor here.** That is `tools/market.py`'s job on the 2019-2025 history.
  This file only collects and cleans; scoring happens after results land
  (`data/predictions/README.md`).

## Verification log

**2026-11-06, about 10:25-10:55 UTC, independent verifier.** Covers `tools/odds_upcoming.py`, the three
snapshots, `data/derived/odds_upcoming.json` and this file. All checks use my own parsers and solvers
(scratch scripts, not the tool's functions): `html.parser` for BFO; my own walkers for the fightodds
GraphQL JSON, Action Network's `__NEXT_DATA__` and the Covers table. A/B orientation was decided by
name-token overlap with the cards file, not by the tool's matcher.

**What was checked**

1. **Parsing against the cached raw pages, every observation in all three captures:**
   - fightodds: 518 lines and 409 opening lines. BFO: 168. Action Network: 63. Covers: 167.
     **0 mismatches.**
   - The ledger `market` block was recomputed from the raw BFO pages: 29 of 29 equal.
   - Pinnacle history: I read the API's `outcome.fighter` for the 32 outcome ids used, and every one is
     the right fighter for its side. The last history point equals the current Pinnacle line on all
     16 bouts.
2. **Live re-fetch at 10:32 UTC.** 26 requests, at least 1.5 s apart, generic User-Agent, robots.txt
   re-read first. The raw pages are in `data/raw/web_cache/<site>/verify_20261106-1032/`, which is
   gitignored.
   - **Random spot check:** 40 (bout, book, source) records from fightodds and BFO, seed 1106. 38 were
     identical; 2 exchange quotes had moved by 0.6 points or less (Borralho on Kalshi, Miller on
     Polymarket).
   - **All 686 fightodds and BFO records:** 668 identical, 18 moved, none by more than 5 points.
   - **8 random fight-detail pages:** all 121 opening lines identical.
   - **Pinnacle history, 2 random bouts:** the first point equals the snapshot's open.
   - **Action Network:** 62 of 63 identical; one moved 0.4 points. **Covers:** 167 of 167 identical.
   - No name or A/B orientation disagrees with the cards file.
3. **Math.** Every per-book multiplicative and Shin no-vig value was recomputed with an independent
   bisection, along with the trimmed logit-mean consensus, `p_meandec_mult`, sharp, exchange and open.
   0 differences above 1e-4. The method market sums to 1 on all 15 bouts.
4. **Props.**
   - BFO prop ids match their labels: 1 "fight goes to decision", 8 "wins by TKO/KO", 9 submission,
     10 inside the distance, 11 decision, 13-17 rounds, 32-35 over/under.
   - Team-to-A/B mapping: on all 324 fighter-specific props, the fighter named in the label matches
     the mapped side. 0 mismatches.
5. **Fight-id matching.**
   - All 29 fightodds listings map to their card bout.
   - BFO's 7 pages: 29 listings used, 1 stale duplicate ignored (Parsons vs "Jose Henrique", 1 book),
     1 removed bout reported (Nickal-Pyfer).
   - None of BFO's 42 future-events listings is a card pairing. Pereira-Adesanya and
     Moreno-Figueiredo share one fighter with a card bout and are correctly not matched.
   - No two bouts on one card are similar enough to be confused.
   - Rematches: none in the window. The timeline keys bouts by date plus slug pair, so a rematch on
     another date stays separate.
   - Same-day events: none in the window, but see fix 2.
   - Namesakes: `ufcstats_id` is attached only when the roster lookup returns the card's own slug.
6. **Coverage.** Every number in the Coverage section and in "What the market says" was re-derived from
   the snapshot, and the market table was re-checked cell by cell. It matched, except for the items
   corrected under fix 5.
7. **Walk-forward safety.**
   - No script or derived file reads the snapshots or the timeline (checked with grep).
   - Every record is a 2026 forward-test bout, labelled benchmark-only, and nothing evaluates on 2026
     fights.
   - The odds are not a feature anywhere. Fix 3 hardens the pre-lock label.
8. **robots.txt and throttle, re-read live.**
   - BFO allows everything except `/cnadm/`.
   - `api.fightodds.io` has only content-signal comments and no rules.
   - Action Network disallows query strings, and the tool uses none.
   - Covers allows `/sport/mma/ufc/odds`.
   - The Fetcher waits at least the delay (minimum 1.0 s, default 1.25 s) before every request,
     robots.txt requests included.
   - For the exchange check: polymarket.com allows everything, and gamma-api.polymarket.com and
     api.elections.kalshi.com have no robots.txt (404).

**Fixes made**

1. **Exchange identity (data).** BFO's "Polymarket" column is the Polymarket US app, not the
   international book. I compared 26 bouts against the gamma-api.polymarket.com and Kalshi APIs:
   - fightodds' Polymarket matched the international book's asks 23 of 26 times;
   - fightodds' Kalshi matched Kalshi's asks 20 of 22 times;
   - BFO's Kalshi matched the fee-inclusive Kalshi price;
   - BFO's "Polymarket" matched neither consistently.

   BFO's column is now the separate exchange `PolymarketUS`, detected from BFO's header disclosure.
   - `p_exchange_mult` changed on 24 bouts, by up to 2.3 points (Johnson-Almeida 0.599 to 0.622).
   - `n_exchange` is up by one on 26 bouts.
   - `src_disagree` cases fell from 6 to 2; the 4 removed were false flags.
   - Lines used rose from 587 to 613.
   - The sportsbook consensus, ledger blocks, opens and props are unchanged.
2. **Matcher robustness (code).**
   - Each source listing is now tried against every event within -1..+2 days, not just the nearest
     one. Before, a BFO main-card page dated the day after its card, on a day that also holds another
     event, went unmatched. A regression test covers this.
   - A listing that matches one of the card file's `removed` pairings at least as well as the
     current bout is no longer attached to it. Real case: "Jake Matthews vs Akbar Abdullaev" was an
     announcement error, and a stale listing of it scores 0.78 against Matthews vs Tahir Abdullayev,
     which the old code accepted.
   - Neither change alters the current snapshots.
3. **Walk-forward (code).** `phase` and `pre_lock` now use the latest fetch time of the bout's lines,
   not the run's start time. Test: run starts 21:58, line read 22:01, lock 22:00. `pre_lock` is now
   false; before, it was true. No effect today, because every capture was about 36 hours before the
   lock.
4. **Replay faithfulness (code).** `--replay` now keeps the original file's `snapshot_utc`, window and
   live request counts, and adds `rebuilt_from_cache_utc`.
   - Before, a replay moved the capture time to the first cached file's mtime (10:15:40 instead of
     10:15:35) and reset the window to the defaults.
   - All three snapshots and the timeline were rebuilt this way. Diffs against the replaced files
     show only the exchange fields from fix 1 plus metadata.
5. **This document.**
   - The `src_disagree` explanation (the remaining two are not timing differences) and the line
     counts.
   - The Hasan exchange value.
   - "76%" is now "22 of the 28 that moved (79%)".
   - The method-market book counts: one bout has only FanDuel.
   - 17 cells of the Exchanges column.
   - The phase/lock wording.
   - Two new caveats: exchange identities and the like-for-like benchmark.

**Open items (not changed)**

- **Ko-Turman BetRivers.** fightodds has -714/+475 and BFO has -1115/+650, with no change across four
  reads from 09:50 to 10:32.
  - fightodds' BetRivers equals BFO's Unibet; both are Kambi books, which often share prices. One of
    the two sites has a stale or mismapped line.
  - The consensus uses the fightodds copy: one book of 21, and the trimmed mean drops the extreme.
  - The BFO copy is in the bout's ledger `market` block, which by definition is BFO's mean (no-vig
    0.845 with it).
  - Recheck this at the T-2h capture.
- **BetOnline's opener for Cortes-Acosta-Walker** is -300/+247, against about -200 elsewhere. It passes
  the 1.0-logit opener filter, and the trimmed mean drops it as the maximum.
- **Riyadh's lock** is still the 12:00 UTC regional estimate. It is meant to err early, the safe
  direction for a lock. Replace it with the real time once the card is published.
