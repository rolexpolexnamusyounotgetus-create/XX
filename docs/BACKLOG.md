# Engine backlog (feeds the v4+ cycles)

Findings from verified research that the next engine versions must use. Each line names its source.

## Judging (v4 or v8)
- (v4 review) The all-cards EM fits in the next bullet run from 2015 through 2026-10, which includes the validation
  years and the vault.
  For engine tuning use the train-only refit in data/derived/judge_em_train.json (5,519 cards 2015-2023, from
  tools/judge_em_train.py): head 0.1742, body 0.1271, leg 0.1042, KD 2.164, TD 0.278, control 0.462/min, sub 0.847.
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

- props (lab 4, VERIFIED ~00:50 UTC Nov 7, research/model_props.md): ADOPT PropsPool as the props path in predict()
  (v7), scoped as hygiene: vs S2 cells the pool gains 7-bin -0.0172 [-0.0283, -0.0056] on 2024-25 (CV -0.0175), but
  vs the current 40/60 props blend it is a tie (CV -0.0004, under the 0.0005 rule): one de-vig from raw book prices
  in training and live, forward-chained weight, explicit degrade (no props -> model mix). Round props rejected (keep
  S2 round shapes); props' P(A) adds nothing to the winner stack. Debut-bout pool is a monitored candidate (needs its
  own pre-registered forward version). Decision share drifted up in 2024-25 (54.2% actual vs ~48% predicted by every
  model): add it to the v9 drift monitor; never fit a tilt on 2024-25. Forward: run tools/props.py capture with the
  odds snapshots.
- finishing (lab 4, VERIFIED): NOT adopted. Fighter finishing tendencies fail the forward-chained gate (7-bin
  +0.0007, joint +0.00002); 2024-25 leans its way (joint -0.0085 [-0.0146, -0.0020]) but that window cannot select.
  Monitored candidate only (pre-register as an audit-2 side line). Structural lead for a future pre-registered test:
  the finisher-oriented round model on methodround's hazard columns. DO-NOT-DO: GBM for method|winner; fighter
  early/late/cardio round features; the 2019+ layers (statlines, durability, bayes) inside the method model; wide
  penalty searches for method models.
- LAB 4 SCORECARD: props adopted as hygiene (tie vs incumbent), finishing not adopted. Method/round is close to the
  market's information too; production stays S2 + ML v2 winner + props pool, debut method model for debut bouts.
- FORWARD v4.2 (VERIFIED ~00:15 UTC Nov 7; data/predictions/README.md "Forward model v4.2", pre-registered in
  6011e6f before any code): effective for events dated >= 2026-11-14. Winner primaries as fwd-4.1; debut bouts take
  method / distance / finish round from the debut method model (base rates kept as a scored secondary); debut
  winner model monitored; per-fighter stat-line block (mean, P10/P50/P90 for 7 stats from statdist prod tables)
  scored later against ufcstats per-fight totals. Pinned inputs by sha256 (frozen engine versions/v4); fwd-4.1
  output byte-identical; `--fwd auto` picks the version by event date. Verifier fixed the stat-line CI to resample
  bouts, not fight-sides. A kept v5+ needs its own pre-registered forward version before it governs a card.
- seqnet (lab 3, VERIFIED): NOT adopted anywhere. Deep career-sequence net 0.6193 on 2024-25 (+0.0276 vs ML v2
  blend, +0.0315 vs close); every stack gate rejects it; method x round far worse than S; stat-line term -0.10%
  (tiny). Do-not-do: deep winner models over UFC-only careers (3.7-6.7k fights per refit overfit); revisit only with
  a much larger universe (e.g. regional pre-UFC sequences). Kept as a standing negative baseline plugin.
- bayes (lab 3, VERIFIED): NOT adopted in production stacks (page no-line CV -0.0010 n.s., 2024-25 +0.0007 flat;
  weight 0 next to the close; open stacks reject). Standalone 0.6153 on 2024-25, level with round-level WHR, walk-
  forward clean. Optional uses: ratings-only fallback partner for WHR (2024-25 -0.0045 [-0.0096, +0.0007]) and the
  roster skill means/sds (bayes.json) as opponent-adjusted simulator inputs for KD/chin and grappling rates.
- LAB 3 SCORECARD: 7 projects, all verified. Adopted: debut METHOD model, statlines. Not adopted: crowd, linemove,
  calib, seqnet, bayes. Conclusion: winner-level gains on top of ML v2 + the line are exhausted with public data;
  remaining value is in method/round (debuts, props), stat lines, and newcomers.
- debut (lab 3, VERIFIED ~23:40 UTC, research/model_debut.md): ADOPT the debut METHOD model for bouts with a UFC
  debutant (replaces division base rates; fed the ledger's winner probability: close, else open, else seeded Elo).
  2024-25 (172 decisive debut bouts, one look): marginal KO/SUB/DEC 0.9879 vs 1.0330 (-0.045 [-0.075, -0.017]);
  method given the winner -0.084 [-0.128, -0.040]; who x how -0.079 [-0.147, -0.014]; CV -0.033 [-0.059, -0.006].
  WINNER unchanged (line where there is one, seeded Elo without): the debut winner model's CV gain (-0.049 nested)
  was not confirmed on 2024-25 (+0.003 [-0.046, +0.050]); log it as a monitored candidate (--debut-model). It is
  overconfident (slope 0.81). Going primary needs a new forward version pre-registered before a lock (fwd-6+).
- statlines (lab 3, VERIFIED, research/model_statlines.md): ADOPT as the distributional stat-line layer
  (src/ml/statdist.js, P10/P50/P90 per fighter, mixed over the fight-length distribution) and as v8's retarget
  target. 2024-25 (one look): better log score than the NB baseline on all 19 stats with CIs excluding 0; 80% band
  coverage 0.77-0.82; vs engine v4 unconditional deviance: control -6.2 s [-10.7, -2.5], sig landed -0.75 [-1.31,
  -0.14], TD landed -0.058 [-0.089, -0.027]; engine's 80% bands far too narrow for TD attempts (0.52 coverage) and
  control (0.68). No winner use (zero stack weight; CV rejects).
- crowd (lab 3, VERIFIED): NOT adopted. Public consensus panels (RotoWire, Money MMA; Tapology's robots.txt
  disallows Claude crawlers, so it was not scraped) fail the forward-chained 2021-23 gate in every stack (0 of 60
  variants pass; best gain -0.0003) and in the method model; 2024-25 agrees (all within +-0.0013, n.s.). Crowd
  alone 0.6370 on 268 fights: beats Elo, loses to ML v2, level with the open. A permission-granted Tapology export
  is the only route to a fuller test (tools/crowd.py import_csv).
- linemove (lab 3, VERIFIED): NOT adopted; keep fwd-4.1 routing (any pre-lock consensus line, T-24h included ->
  open-trained stack, multiplicative de-vig; true close -> close-trained, power). The consensus/T-k stack passed
  CV but its pre-registered 2024-25 primary was contradicted (+0.0041 [+0.0017, +0.0066]). DO-NOT-DO: train stacks
  on consensus/T-k lines; add movement or dispersion on top of the close. The stacks differ mainly in ML v2 weight
  (open 0.58 / consensus 0.39 / close 0.33) and 2024-25 rewards ML v2 weight: a drift question, not line timing.
  Opener CLV +0.060 [+0.046, +0.073]: the model leads the market early (descriptive, not a betting system). Future
  data: archive timestamped consensus + per-book snapshots at T-7d/72h/24h/6h/close in the forward ledger.
- calib (lab 3, VERIFIED ~23:00 UTC, research/model_calib.md): NO recalibration enters production (every spec
  {type: none}; Calib.apply is the identity; src/ml/calib.js + tests/test_calib.js ship as plumbing). No recency,
  per-card, annual-temperature or segment scheme beats the incumbents by > 0.0005 on the forward-chained 2021-23
  gate. 2024-25 (pre-registered, one look): close stack vs close -0.0096 [-0.0141, -0.0052]; open -0.0043 n.s.;
  no-line +0.0013 n.s. Descriptive only: a per-card trailing temperature would have helped no-line -0.0047 on
  2024-25 (already-seen window: judge it only on the forward ledger / audit 2). Proposed v9 refinements to the
  pre-registered drift rule (one-sided test, longer ledger window, named column) AFTER audit 1 only.
- OWNER REDIRECT (Nov 6 ~22:00 UTC): resources move from the 3D game to ML / stats / prediction. 3D pass 3 was
  stopped after its systemic round (beard/short-hair caps, skin, body definition, women's sports top shipped;
  likeness labs not run). Prediction lab round 3 launched (scratchpad/wf_predict_lab3.js, four workflows): crowd
  (community picks), linemove (line timing/trajectories, T-24h stacks), seqnet (deep career-sequence model), bayes
  (hierarchical dynamic skill model), calib (drift/recalibration), debut (debut-universe model), statlines
  (distributional stat-line models). Each: CV-gated on <= 2023, scored once on 2024-25, adversarially verified.
  Adopted experts enter production through v6 (scratchpad/wf_engine_v6_v10.js).
- PRE-REGISTERED (Nov 6 ~21:55 UTC, before vault audit 1 is read; docs/V6_V10_PLAN.md 6.5 and 7.1): the production
  drift rule (no-line stack keeps h 1.5 and its temperature; switches to h 3, T 1 only if audit 1's mirrored slope
  for the frozen production no-line stack is < 1.15 with a CI including 1, or the forward ledger's trailing-200
  slope CI includes 1 for two consecutive quarters; nothing else reacts to audit 1); the audit-1 -> audit-2
  contamination rule (full vault both times; anything chosen because of audit 1 is flagged "not clean on the
  vault" in audit 2); AUDIT 1 SCOPE: v5 vs v4 paired; benchmarks close, open, Elo, ML v2 logistic, frozen ML v2
  stacks (model, model_open, no-line) and S2 / S2+ml2win method cells as a descriptive side line; calibration
  slopes; the close edge; base-rate table; and the list of known pre-seal 2026 exposures (V6_V10_PLAN 6.5.3).

## Research tooling note
- Agents launched before the network opened hit DNS failures in WebFetch and a shared web-search cap
  (about 200 calls per turn). With unrestricted network, research agents should fetch pages with curl
  (generic User-Agent) and fall back to https://html.duckduckgo.com/html/?q=<query> for search when the
  WebSearch budget runs out. Re-verify items flagged "unverified" in data/scouting/*.json this way.

## Prediction status after the ML-core round (verified, Nov 6 ~11:00 UTC)

**Current (Nov 6, 2:20 pm ET):**
- **The current engine is v4 (4.0.0), in src/ and versions/v4/.** v4.0.1 (the v4 review's fixes) was validated
  once and rejected by the decision rule. Its work is in versions/v4.0.1-rejected/; see docs/CHANGELOG.md v4.0.1.
- Validation 2024-2025 winner log loss (853 decisive fights, symmetric, 300 sims per order):
  - v3 0.6424; v4 0.6324 (vs v3 -0.0100 [-0.0170, -0.0030], kept).
  - v4.0.1 0.6289 (vs v4 -0.0034 [-0.0073, +0.0008]). Its 7-bin (-0.0004), method (+0.0010) and all stat-line
    deviances are n.s., so it was rejected.
  - Brier: v4 0.2206, v4.0.1 0.2189. Calibration slope 1.72 / 1.77: still underconfident.
- The engine trails methodround model S on validation:
  - v4: who x how x when +0.029 [+0.0015, +0.0575], winner +0.011 [+0.002, +0.020].
  - v4.0.1: who x how x when +0.028 [+0.008, +0.048], winner +0.008 [-0.001, +0.016].
- Blend: the engine's validated weight is 0.037 with the closing line for v4 (0.002 for v4.0.1) and 0 without a line.
  The blend's log loss does not move measurably (v4 -0.0002 [-0.0006, +0.0001]). The blend still decides the winner.
- Known contamination in the current engine:
  - v4's EM judging weights were fit on cards through 2026-10, which covers the validation years and the vault.
  - The train-only refit is data/derived/judge_em_train.json. It was rejected along with v4.0.1, so v5 must carry it.
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
- ML benchmark (tools/ml.py, data/derived/ml.json, research/model_ml.md; VERIFIED after a fix, Nov 6 pm): the
  first build scored 2024-2026 (vault included) and fit the page model through the snapshot; now 2024-2025 only,
  page model fit before 2026, 2026 pre-fight predictions exported to the vault dir (ml_vault.json). On 2024-2025
  (854 fights): logistic 0.6062 (67.9%) vs Elo 0.6769; ties the open (-0.0055 [-0.022, 0.011]), 0.018 behind the
  close; stack Elo+ML+market rating 0.5935 (845); open+ML beats the open by 0.021, close+ML the close by 0.0055
  [0.0026, 0.0080]. Engine v3 adds nothing. Gap to the close concentrated in newcomers (0.036 with 1-2 UFC fights).
  No look-ahead found (self-leak perturbation test, joins, corner symmetry all clean).
- Method/round (tools/methodround.py, verified): model S beats division base rates on method by -0.0445
  [-0.062, -0.027]; 7-bin 1.5643 (SM 1.5243); ties the market's method props in a 40/60 blend. It is the
  yardstick for the simulator's method/round output.
- Judges' rounds (tools/judgerounds.py, verified): 10,692 rounds / 31,319 judge-rounds 2006-2025 from
  public MMA Decisions-derived datasets; 22.4% of rounds not unanimous; shared judge noise needed; 10-8s 3.6%.
- Failed mid-run on the usage cap, to relaunch: oppadj fit, officials fit, ratings fit, preufc fit, embed fit;
  verifiers for dynamics, market, ml, fightweek; 3D reviews/fixes; page UI/QA reviews/fix; v3 calibrate/
  reviews/fix; asset clip conversion + verify; scouting and likeness checkers.

## Engine v4 status (Nov 6: validated once and kept)
- v4 = learned stat-line rates inside the engine (FightEngine.loadMLRates / opts.ml), train-only priors
  (data/derived/priors_dev.json via tools/build_db.py --priors-until 2024-01-01) with the self-calibration re-run on
  them, EM judging with noise and 10-8 rule fit on 2019-2023 judges' rounds (tools/judgecal.js), train-only level
  matching with the learned rates on (tools/v4_levels.js). The mlcal global-scale search (TRAIN, --no-val) found nothing
  that beats the self-calibrated set on both train windows. Frozen: versions/v4/; v3 reference: versions/v3/.
- TRAIN (2019-2023, symmetric, 300 sims per order, paired vs v3): winner log loss 0.6635 vs 0.6716 (-0.0081 [-0.0134,
  -0.0026]), Brier -0.0040, accuracy +3.4 pts; 7-bin +0.0074 [-0.0092, +0.0254] and method -0.0018 (both n.s.);
  stat-line deviance better on landed, attempts, takedowns and control. Details: docs/CHANGELOG.md v4,
  data/derived/version_history.json.
- VALIDATION 2024-2025, one look per version (v3 first, then v4 paired against it). 853 decisive fights, symmetric,
  300 sims per order, 2,000 event-cluster resamples.
  - Winner log loss: v3 0.6424, v4 0.6324, paired -0.0100 [-0.0170, -0.0030]. **v4 kept** (decision rule branch 1).
  - Brier -0.0046 [-0.0080, -0.0013]. Accuracy 65.7% vs 64.2% (+1.5 pts [-1.0, +3.9]).
  - 7-bin -0.0171 [-0.0343, +0.0018] and who x how x when -0.0171 [-0.0368, +0.0043], both n.s.; method -0.0006 n.s.
  - Stat-line deviance better on all five stats, CIs excluding 0 (sig landed -0.97, attempts -1.89, TD -0.145,
    control -10.3, KD -0.016).
  - Calibration slope 1.72 vs 1.57 and ECE 0.063 vs 0.054: both underconfident on 2024-25, v4 a little more.
  - v4 still trails methodround model S: joint +0.029 [+0.0015, +0.0575], winner +0.011 [+0.002, +0.020].
- Blend test: the engine's first non-zero validated weight, 0.037, with the closing line only. Blend log loss
  0.5786 vs 0.5788 without the engine (-0.0002 [-0.0006, +0.0001], n.s.). Weight 0 without a line, where `ml` already
  carries the learned rates. The engine still adds nothing measurable to the winner. v5 must earn this through
  method/round, not through the winner. Details: docs/CHANGELOG.md v4, data/derived/version_history.json.
- Validation base-rate drift (actual / v4):
  - sig landed per 15: 58.1 / 63.3, +9.0%, out of the 6% tolerance; v3 is +9.9%. The league pace fell from 61.1 on
    train, and the walk-forward priors lag it.
  - KD per 100 head: 0.684 / 0.746 (+9.0%; v3 +4.8%). This is the 2024 glove-trial dip plus v4_levels' kdScale.
  - 10-8 share: 2.46% / 3.38% (v3 4.96%). evalv's 'actual' was 6.28% until a judged-rounds fix. Fight
    b959e2c1d16ff832 (Cejudo vs Song) is a 5-round bout that ended as a technical decision in round 3, so the data is
    right and tools/build_db.py needs no change.
  - A recency-weighted league level (durability's trailing 730-day level) is a v5 item.
- Known gaps for v5/v6:
  - 5-round finish timing: sim 14.5/12.8/10.4/9.3/5.4% by round vs 17.3/16.5/9.5/5.3/4.9% on train.
  - 3-round finish timing is off too. On train, round 2 is 14.5% vs 16.7% (z -2.5) and round 3 is 9.1% vs 7.5%
    (z +2.5). Add it to the v6 dynamics targets.
  - Simulated decisions: UD 76-79% vs 80% in the judges' rounds (fight-level coherence beyond the shared
    fight-level noise).
  - Draws and MD:
    - v4's t108 8.555 cut draws about 4x: train P(draw) 0.24% vs 1.01% actual, MD 0.5% vs 2.0%. v3 had 1.4% MD with no
      deductions.
    - v4.0.1's deductions plus t108 8.31 got 0.64% draws and 1.0% MD; it was rejected.
    - Add draw and MD shares to the judging targets in v5.
  - The hurt weight of 0.8 in judging is a judgment call.

## Engine v4 review follow-ups (Nov 6, after v4.0.1 was rejected) -> v5
- Carry v4.0.1's train-only fixes into v5 (versions/v4.0.1-rejected/), measured inside v5's single look:
  - the EM judging weights refit on 2015-2023 cards (data/derived/judge_em_train.json; tools/judge_em_train.py);
  - judgecal refit with point deductions;
  - learned-path levels for TD attempts, control and sub attempts (mlTdLevel, mlCtrlLevel, mlSubLevel);
  - the cumulative mlMaxRatio cap on the takedown multipliers (v4 compounds it past x4 on 20 of 3,998 train sides).
- Take the self-calibration's KO/TKO composition targets (ground 28%, clinch 12.5%, standing without a KD 7%) from
  pre-2024 fights. They come from the all-years base-rate table now.
- Attribution: the reviewer's train ablation puts the whole v4 gain on the learned rates. EM judging, the priors_dev
  self-calibration and v4_levels are neutral to slightly negative. Before v5's look, run a train-only leave-one-out of
  each, plus a "v3 params + learned rates" arm, and keep only what helps on train.
- Component work reports train/CV numbers only. Never choose components by their 2024-25 results: both v4 ingredients
  had been scored on 2024-25 before v4's look.
- Backtest sides take height, reach and stance from the current tale of the tape (tools/build_db.py, sides[tag]).
  Stance is a learned-rate feature, so this is a tiny look-ahead. It is accepted and documented; freezing stance from
  the earliest record is the cheap fix.
- Volkanovski vs Gaethje with the production learned rates: the engine gives 69.4% Volk (61.3% with the rates off,
  v3 62.8%), against about 37% in the no-vig openers. The page's final probability stays on the blend.
- Hidden-data note: evalv drops every 2026 fight on load; methodround --score now takes --backtest
  data/derived/backtest_dev.json and a date window; tuning and the self-calibration used only pre-2024 data.

- CORRECTION (dynamics verifier, Nov 6 ~15:00 UTC): research/model_dynamics.md was fixed after a look-ahead in
  its judges' round label and acceptance targets taken from the 2024-25 validation window. Use the corrected
  recipe in that file (train-window targets; form.vol cut to 0.5 at most, not 0.3; KD momentum next round:
  scorer x0.92, dropped man about x0.95, not x1.05; 5-round late KO rate gap is ~1.6-2x, not 2-3x, and the
  current engine at 0.073 closes most of it; own-output AR(1) did not replicate on 2024-25 (0.68 -> ~0.45);
  kPace 45 vs 15 is within noise). Treat the old "E1-E11" values above as superseded.
- CORRECTION (ml verifier): on 2024-25 only, the logistic model scores 0.6062 [0.5902, 0.6230] (67.9%) vs Elo
  0.6769; ties the opening line; 0.018 behind the close; close + ML beats the close by 0.0055 [0.0026, 0.0080].
- CORRECTION (fightweek verifier): fight-week features add -0.0064 [-0.0117, -0.0012] validation log loss on top
  of Elo, mostly from the home-crowd-outside-the-USA term; weight misses and short-notice replacements alone are
  within noise. Experience alone is worth twice the whole fight-week block.
- PROTOCOL FIX: backtest.json now holds 2019-2025 only (2026 sealed outside the repo); tools/build_db.py enforces
  it on every rebuild (--include-vault only for audits).
- EMBEDDINGS (verified, research/model_embed.md): stat-line gain is real — adding the embedding blend to the
  mlrates stat-line model lowers mean relative deviance over 18 targets by -1.67% [-2.11, -1.24] on 2024-25
  (newcomers -1.51%); use src/ml/embed.js blendMLRates in the engine's ML-rate path (v5 merge). Winner head:
  0.6336 vs Elo 0.6769 alone, but train-only CV rejects it on top of the no-line stack, the ratings stack, the
  close and close + stack; keep it only on top of the opening line (-0.0088 [-0.0143, -0.0036]) and the ML
  logistic alone. Tuned rating systems in data/derived/ratings.json score 0.618-0.623 on 2024-25 (Elo 0.677):
  use them in the stacks once the ratings verifier signs off.
- OPPADJ (verified, research/model_oppadj.md): per-fight deviance on 2024-25 vs the engine's raw rates —
  takedown attempts -11.5%, control -7.9%, control/TD -6.7%, distance attempts -5.4%, TD success -3.9%, leg acc
  -3.4%, head acc -3.3%, ground attempts -2.9% (CIs exclude 0); KD, body accuracy and submissions do not improve
  (keep them off). Still gains on top of mlrates. Winner log loss ~-0.003 in every period, not significant
  alone. Engine recipe and the ML-path recipe (scale ML targets by (F_off*F_def)^beta) are in the report.
- OFFICIALS (verified with one claim dropped, research/model_officials.md): the home-abroad judging term plus the
  closeness shape improve 7-class decision log loss -0.0120 [-0.0200, -0.0048] on 2024-25 (significant only
  there). NAMED-JUDGE EFFECTS DO NOT PREDICT (they make decision-winner log loss worse in all three windows):
  ship them OFF by default; keep shared judge noise and the home-abroad term.

## v5 component verdicts so far (Nov 6, ~19:00 UTC)
- durability: INCLUDE (verified). Flag on, engineWeight 0.5, absolute tracked league level, kdCal re-matched to
  1.1640 on frozen v4; train: soft CE vs close -0.0008 [-0.0015, -0.0001], 7-bin -0.0072, method -0.0040; winner
  n.s. Use the evalv wiring in scratchpad/components/durability_evalv_v4main.patch for validation.
- blend_anchor: INCLUDE (verified, two bugs fixed, patch re-issued against v4 final 122c31a). FightEngine.predict
  = blend P(win) + rescaled/pool method x round + intervals (kappa 1.65); anchor mode for shown fights; recalT = 1.
  Train OOF vs simulator alone: winner -0.0229, soft CE -0.0191, 7-bin -0.0450, method -0.0122. Validation/vault
  runs must pass a stacker fit on 2023 or earlier and walk-forward method/round cells, not production defaults.
- officials: code behind the flag only, OFF in the prediction path (no metric improves; league model slightly
  worse on decision outcome). Opt-in for showing real officials.
- styles_sos: builder recommends include with SOS on from "wf", style blocks OFF on the learned-rate path
  (they double-count), newcomer off until preufc verified; soft CE -0.0010 [-0.0018, -0.0001], stat lines -0.48%.
  sosSource "oppadj" gives better stat lines (-0.8 to -3.3%) at +0.0011 soft CE; do not stack the two.
  VERIFIED (~20:00 UTC): INCLUDE SOS from "wf" only; style blocks OFF; newcomer sub-flag off. Harnesses pass
  opts.sos from data/derived/sos_wf.json with the corners swapped for the mirrored order, and use meta.coef for
  2024-25 (fit <= 2023).
- realism_sens: VERIFIED (~20:00 UTC): INCLUDE as capability: FightEngine.sensitivity (tornado data, CRN),
  tools/realism.js, the mlrates cache fix. The division/format factor layer stays OFF (no train gain).
- dynamics: VERIFIED (~21:40 UTC, independent harness, 500 sims/fight): INCLUDE flag on as structure/realism.
  On v4.0.0 (port patch): soft CE vs close -0.0017 [-0.0025, -0.0008], KD deviance -0.059 (both significant);
  7-bin and who-x-how-x-when lean worse n.s. Round correlation 0.54 (real 0.56), KD per head strike by round and
  5-round finish timing now match. Weak: 3-round R2 KO hazard low, 5-round R1 KO high, late submissions high.
  Merge conditions: one joint KD level pass with durability; rebuild blend_anchor cells with the flag on.
- v5 MERGE LAUNCHED ~21:45 UTC (scratchpad/wf_v5_merge.js, run wf_5a28d719-790): five sequential tested merge
  steps -> train leave-one-out ablation -> joint level pass + re-tune + freeze -> single validation look ->
  review -> decide -> first vault audit.
  - Step 1 done (~22:00 UTC; docs/CHANGELOG.md "v5 merge log"): v4.0.1's fixes behind components.v401 sub-flags
    emJudge / deductions / mlLevels / tdCap / koTargets, all on by default. Flag off = v4.0.0 bit for bit (tests/test_v401.js).
  - New finding for (e): ufcstats labels 22-26% of strike KO/TKOs "In Clinch" in 2015-2018 and 5-10% from 2019 on, so the
    clinch composition target drops from 12.5% to 7.1%.
  - Train draws and MD are still about half of actual with deductions on: 0.60% vs 1.01% of fights, MD 0.95% vs 2.04% of
    decisions.
  - Stance freeze is not cheap: there is one tale-of-the-tape snapshot and no history.
  - Step 2 done (~23:00 UTC; docs/CHANGELOG.md "v5 merge log"): components.durability and components.dynamics, both on, each
    flag off = the engine before it bit for bit (tests/test_v5_step2.js).
    - First joint KD / finish check, train only (tools/v5_joint_levels.py): KD per 15 is 0.612 vs 0.611 actual (3 rounds) and
      0.519 vs 0.500 (5 rounds). Conversion is 0.510 vs 0.512 per KD; the 3-round KO share is 30.7% vs 30.7%.
    - So the one joint level pass is within noise; no level was moved.
    - League-average plain-table KO shares run 0.4-3.1 pts low, so the selfcal re-fit is a job for Calibrate.
  - Step 3 done (~23:20 UTC; docs/CHANGELOG.md "v5 merge log"): components.styles_sos (sos "wf" on, styles and newcomer off),
    components.officials (off; opt-in per call, named-judge effects off) and components.realism_sens (off; factors fit on
    v4.0.1) with FightEngine.sensitivity. Each flag off = the engine before it bit for bit (tests/test_v5_step3.js), and a
    strict check runs against step 2's own params.
    - SOS acts only with opts.sos. Backtest tools get the pairs from tools/sosrec.js: sos_wf.json, corners swapped, LOYO
      coefficients on train and meta.coef on 2024-25. tools/evalv.js has its own copy, and versions/v5/ must include
      styles_sos.js.
  - Step 4 done (~00:05 UTC Nov 7; docs/CHANGELOG.md "v5 merge log"): components.embed (on), components.oppadj (off; refused
    together with styles_sos sos) and components.preufc (on), each flag off = the engine before it bit for bit
    (tests/test_v5_step4.js, incl. a strict check on step 3's own params). Inputs for backtests: tools/mlpathrec.js.
    - embed confirmed on train before leaving it on: leave-one-year-out mean relative deviance over 18 targets -0.72% [-0.97,
      -0.49] vs recalibrated, -0.42% [-0.68, -0.16] vs raw learned rates; engine winner -0.0042 [-0.0074, -0.0011], stat lines
      better (tools/embed_blend_loyo.py, tools/v5_step4_check.js).
    - preufc vs embed on train: method -0.0060 [-0.0115, -0.0005], newcomer KO-win -0.0092 [-0.0168, -0.0014] (exponents fit on
      2015-2023, not out of sample on train). oppadj vs SOS: nothing significant; Calibrate picks one.
    - versions/v5/ must also include ml/embed.js and mlpathrec.js.
- blindtest harness (VERIFIED ~21:10 UTC, research/model_blindtest.md "Verification log"): independent no-cache
  replay, own scorer and own stacker reproduce every headline. MoE stack + close 0.5774 vs close 0.5854
  (-0.0081 [-0.0125, -0.0036], ahead on 56 of 84 cards); no-line stack ties the close (+0.0001); removing the
  simulator from either stack changes log loss by only +0.0005 to +0.0009. Real corner-swap guard, gated-stacker
  fold fix and cache-key fixes added; blindtest_stack.json re-exported with an open-trained `model_open` block
  (fed-open control: a close-trained stack fed an opener costs +0.0102 [+0.0057, +0.0145]). Gaps: newcomers (the
  no-line stack is overconfident on debut-heavy bouts), and the forward ledger must choose model vs model_open by
  how close to the bell the line was captured.
- ratings (VERIFIED ~20:55 UTC, research/model_ratings.md; two tiny defects fixed, four write-up claims corrected):
  round-level WHR is the best single system on 2024-25, 0.6170 [0.6015, 0.6332] (Elo 0.6769); stack (WHR rounds +
  Glicko-2 + dims) 0.6112; ratings_plus 0.6043 (keep OFF the page: negative weights on correlated Elo logits).
  Still 0.016-0.030 behind the close; close + WHR logit beats the close by 0.0031 [0.0006, 0.0058]. ML v2 already
  uses four of these systems. Simulator skill input: WHR-rounds mean/sd as overall skill, dims as opponent-adjusted
  rates; no second age term. Every rating system is UNDERCONFIDENT on 2024-25 (calibration slope ~1.05 -> 1.28-1.47;
  the close only 1.03 -> 1.11): a property of the period, not a leak. No tempering yet; recheck on the vault audit
  and the forward ledger before adopting one.
- preufc (VERIFIED 7:55 pm UTC; both gains reproduce with independent code, no leak; plan with the pooled
  2019-2025 numbers, about 60% of the 2024-25 headline): seeded Elo for newcomers 0.6792 -> 0.6526 on 2024-25 newcomer bouts
  (-0.0266 [-0.0404, -0.0147]); UFC-stat logistic + pre-UFC block -0.0122 [-0.0204, -0.0042]; adds nothing on
  top of the closing line. Use seeded Elo in the blend, the faded pre-UFC block in ML models, and finish-odds
  multipliers as simulator newcomer priors.
