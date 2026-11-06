# Engine backlog (feeds the v4+ cycles)

Findings from verified research that the next engine versions must use. Each line names its source.

## Judging (v4 or v8)
- Use the EM round-winner fit over all 7,495 cards with only 10-9 rounds (research/data_baserates.md,
  data/derived/baserates.json): per landed differential head 0.179, body 0.133, leg 0.105, knockdown 2.42,
  takedown 0.286, control 0.46 per minute, submission attempt 0.85. In head-strike units: body 0.74,
  leg 0.59, KD 13.5, TD 1.6, control 2.6/min, sub attempt 4.7. Holdout 2023+ accuracy 84.1% vs 79.1% for
  "more sig strikes". It is overconfident in the middle bands, so judges need shared noise.
  v3 started from the clean-subset fit (head 0.411 ... KD 2.81), whose KD weight is about half as large
  in head-strike units.
- Decisions: unanimous 78.6%, split 19.9%, majority 1.6% of non-draw decisions; implied 10-8 rounds 4.7%
  of decision rounds (about 2.5% in 2024-25); judge pairs disagree on at least 13.1% of rounds.
- ufcstats writes judges' totals loser-first (6,655 of 6,657 unanimous cards).

## Variance (v3 calibration / v9)
- Round sig landed per fighter: mean 18.5, sd 12.4 (negative binomial k about 2.55); the two fighters'
  output in a round correlates 0.43 (shared pace).
- Between-fight log output sd 0.45 after fighter and opponent effects; pure form at most 0.36 (v2 used 0.10).

## Knockdowns and finishes (v5)
- KD per landed standing head strike 0.0095 (LW 0.0098, FW 0.0100, 5-round 0.0078, title 0.0070).
- A knockdown round ends in the scorer's finish 61.8% (2+ KDs 71.2%); the scorer wins the fight 85.4%.
- Standing stoppage without a KD: 0.00049 per landed standing head strike. Ground KO: 0.0092 per landed
  ground sig strike.
- Age (league Poisson fit, research/volkanovski.md): KD susceptibility +4.0% per year past 30 (SE 0.6%),
  knockdown power -3.6% per year past 30; p0 = 0.00844 with both fighters 30 or younger.
- Size (research/matchup_market.md): moving up one class shows no measurable penalty after an Elo control
  (+0.03 log-odds, se 0.10, n=383); KD absorbed per head strike unchanged (ratio 1.02); FW champions vs
  elite LW 4-8 vs 6.3 expected. Keep size as a labeled knob, default modest.

## Grappling and positions (v4/v6)
- Control per landed takedown: raw 122 s, but a round-level fit credits about 55 s to the takedown itself.
- Control covers 37.9% of fight time: ground about 29-33%, clinch control 5-9%, distance about 62%.
- Sub attempts 0.40 per 15, 29.6% end the fight; 0.165 attempts per estimated ground minute.

## Pace (v6)
- 5-round fights that went the distance: attempts 1.00, 1.18, 1.20, 1.23, 1.26 by round; leg kicks fade,
  head strikes rise; KD per head strike falls by about half late.
- Volkanovski: landed/min ratios 1.00, 1.24, 1.61, 1.45, 1.63 (n = 12, 11, 9, 8, 7 rounds).
  Gaethje: 1.00, 1.04, 0.76, 0.93, 0.94 (n = 12, 8, 5, 5, 3); shrink hard.

## Market (v9)
- Volk vs Gaethje openers Oct 24-25, 2026: FightOdds.io -200/+170, BetOnline -180/+160, Lucky Rebel
  -180/+155; no-vig Volk 37.2% average (34.9-37.9%).

## Evaluation rule (all versions)
- ufcstats lists the winner first more often than not: the first-named fighter (A) wins 56.3% of decisive
  backtest fights (2019-2026; 53.8-58.5% by year). Any model with an intercept or an A/B-ordered feature
  can learn the ordering and inflate the score. Every evaluation must be symmetric: score each fight in
  both orientations (or randomly swap corners with a fixed seed), and fit stacking/blend/Elo-scale models
  without an intercept on mirrored data.

## Hidden-data protocol (from v4 on)
- Train/tune: 2019-01-01..2023-12-31. Validation (version selection only): 2024-01-01..2025-12-31.
- Vault: every fight from 2026-01-01 (about 370), split out by tools/make_vault.py into a directory outside
  the repo. Building/tuning agents use data/derived/backtest_dev.json and must never evaluate on 2026
  fights; a separate auditor opens the vault only at milestones (v6 and v10) and reports once.
- Forward test: before each upcoming UFC card, commit the current version's predictions to
  data/predictions/ (git history is the timestamp); score them after the results land.
