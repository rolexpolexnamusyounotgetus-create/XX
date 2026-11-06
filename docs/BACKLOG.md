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

## Research tooling note
- Agents launched before the network opened hit DNS failures in WebFetch and a shared web-search cap
  (about 200 calls per turn). With unrestricted network, research agents should fetch pages with curl
  (generic User-Agent) and fall back to https://html.duckduckgo.com/html/?q=<query> for search when the
  WebSearch budget runs out. Re-verify items flagged "unverified" in data/scouting/*.json this way.

## Prediction status after the ML-core round (verified, Nov 6 ~11:00 UTC)
- Final probability = stacked blend (research/model_moe.md, src/ml/moe.js, data/derived/moe_page.json):
  with the closing line it is level-to-slightly-better than the line (pooled 2021-2025 out-of-sample:
  -0.0019 log loss [-0.0042, +0.0004]; 2024-25 alone -0.0060 [-0.0088, -0.0035]); without a line it beats
  the best single model on both 2021-23 (-0.0071 [-0.0136, -0.0006]) and 2024-25 (-0.0124/-0.0138).
- The simulator (engine v3) gets weight 0 in every validated blend pattern: for the winner it adds nothing
  beyond the feature model + Elo + market. It beats Elo on 2024-25 (-0.030 [-0.048, -0.012]) but only
  ~0.006 on 2019-23 and loses to Elo in 2020, 2022 and 2023. The plain parameter search (tools/mlcal) found
  nothing better than self-calibration; the Elo-skill hook was the best lead (n.s.).
- Architecture from here: the blend decides the winner; the simulator explains how and when, with its
  method/round distribution rescaled to the blend (MoE.winnerFactors). Engine versions v4+ must (1) earn a
  non-zero validated weight in the blend, and (2) beat the method/round benchmark (tools/methodround).
  Most promising: feed the ML stat-line model (tools/mlrates) into the simulator's matchup rates, and the
  Elo/ratings skill hook into accuracy/takedown odds.
- Contamination to fix in v4: params3's [selfcal] scales were fit to league rates pooled 2018-01..2026-10
  (includes validation years and the vault; averages only, no per-fight results). Build train-only priors
  (2018-2023) for tuning; rebuild production priors on all data at release.
- The v3 calibration stage was briefed before the vault split, so its report may include one look at
  2024-2026. No tuning used it; from v4 on, selection uses 2024-2025 only and the vault stays shut until
  the v6/v10 audits.
- Every input became underconfident in 2024-25 (the market too: calibration slopes 1.1-1.7). Recalibrate
  on recent data (temperature/recency weighting) at each release.

## Verified component results (Nov 6, 11:00-12:00 UTC round) -> engine cycles v4-v6
- ML stat-line model (tools/mlrates.py, src/ml/mlrates.js, research/model_mlrates.md), VERIFIED: beats engine
  v3's own rates on 12 of 18 per-fight stats (2024-25); feeding it into the simulator improves winner log loss
  0.6465 -> 0.6239 on 2024-25 (-0.0226 [-0.0311, -0.0136]) and pooled 2019-2025 out-of-sample 0.6661 -> 0.6553
  (-0.0108 [-0.0159, -0.0055]), better in all seven years. -> v4 core.
- Durability (tools/durability.py, research/model_durability.md): chin +6.0%/yr at all ages (no knee at 30)
  + 2.1%/UFC year; power -2.8%/yr past 30; KO loss in last 365 d x1.156, older x1.046; last fight KO loss
  x1.163; layoff >= 2 y x0.64; five-round x0.905, title x0.883; no size tax (confirmed on 7,982 fights);
  fighter chin/power multipliers with Gamma(3,3) priors; 2024 glove-trial dip and 2026 KD surge in the league
  level (track trailing 730-day level). Volk chin 1.07 (0.50-1.83) power 0.67; Gaethje chin 0.81 power 0.90.
  -> v5.
- Dynamics (tools/dynamics.py, research/model_dynamics.md; verifier was cut off by the usage limit):
  output barely decays with damage; shared fight-level pace sd 0.37 (engine 0.10); per-fighter AR(1) round
  noise 0.68/0.31; accuracy form sd 0.29 logit (engine 0.12); no adaptation after losing a round; KD momentum
  (scorer eases off, dropped man throws more); KD hazard per head strike falls by round [1, .57, .37] /
  [1, .65, .405, .29, .29] and does NOT rise with damage; KD-to-finish ~0.52 declining by round. Engine v3
  gaps: round-to-round output corr 0.19 vs 0.53 real, fight-level output sd 0.25 vs 0.50, KO rate in 5-round
  R3-5 0.10 vs 0.04-0.07. Exact parameter recipe E1-E11 in the report. -> v6.
- Market (tools/market.py, data/derived/market.json, research/model_market.md; VERIFIED after a fix, Nov 6 pm):
  the first build scored 2024-2026 (vault included); now dev-only, 2026 rows exported to the vault dir. Closing
  line for 2,855/2,864 dev fights; benchmarks on 2024-2025 (843 fights): close (power no-vig) 0.5854, open 0.6094,
  market rating 0.6258 (+offsets 0.6148), Elo 0.6770; method6 1.4770; p_dec 0.6516; round 1.1384. Walk-forward
  Kalman "market rating" works as a no-line prior. Soft-label scoring against the close is 3-4.6x less noisy but
  rewards closeness to the market: a screen only. Volk-Gaethje: market rating 63.5% Volk vs ~37% openers.
- ML benchmark (tools/ml.py; verifier cut off): logistic 0.6156 on 2024+ (66.6% accuracy) vs Elo 0.6799;
  ties the open line, 0.023 behind the close; stack Elo+ML+market rating 0.6071. Engine v3 adds nothing to the
  stack. Gap to the close concentrated in newcomers (0.051 log loss when a fighter has 1-2 UFC fights).
- Method/round (tools/methodround.py, verified): model S beats division base rates on method by -0.0445
  [-0.062, -0.027]; 7-bin 1.5643 (SM 1.5243); ties the market's method props in a 40/60 blend. It is the
  yardstick for the simulator's method/round output.
- Judges' rounds (tools/judgerounds.py, verified): 10,692 rounds / 31,319 judge-rounds 2006-2025 from
  public MMA Decisions-derived datasets; 22.4% of rounds not unanimous; shared judge noise needed; 10-8s 3.6%.
- Failed mid-run on the usage cap, to relaunch: oppadj fit, officials fit, ratings fit, preufc fit, embed fit;
  verifiers for dynamics, market, ml, fightweek; 3D reviews/fixes; page UI/QA reviews/fix; v3 calibrate/
  reviews/fix; asset clip conversion + verify; scouting and likeness checkers.
