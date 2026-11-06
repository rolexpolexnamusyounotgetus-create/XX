# Engine roadmap: v3 to v10

Rule for every version: it ships only if it beats the previous version on the held-out backtest
(UFC fights from 2024-01-01 on, profiles frozen before each fight, never used for tuning), or adds a
capability that is checked against data without making the held-out numbers worse. Each version
records its numbers in docs/CHANGELOG.md: winner log loss, Brier, accuracy, calibration error,
7-bin outcome log loss, and base-rate errors. No version bump for cosmetic work.

| Version | What it adds | Checked by |
|---|---|---|
| v3 | Data-driven any-fighter engine: strike attempts x accuracy vs defense (log5), positions with clinch control and ground sub-positions, knockdown follow-up, judging weights fit on real rounds, walk-forward calibration, Elo baseline | Held-out log loss vs Elo; base rates |
| v4 | Opponent-adjusted skills (iterative strength-of-schedule), tuned time-decay half-life and per-stat prior strengths | Held-out log loss; per-fight strike error |
| v5 | Durability model fit on data: age, weight-class moves, prior KO losses, accumulated damage, layoffs, for chin and power | KD-absorbed calibration by age band and weight move |
| v6 | Fight dynamics fit on round-by-round data: fatigue curves, damage-driven output and accuracy decay, between-round adaptation | Round-by-round output and finish-hazard match |
| v7 | Style-matchup layer: style vectors for every fighter from data plus scouting tags, interaction terms fit on the backtest | Held-out log loss on style-mismatch fights |
| v8 | Officials: per-judge scoring tendencies from 9,000 decisions, per-referee stoppage tendencies, 10-8 rounds | Decision-split and scorecard calibration |
| v9 | Uncertainty and ensembling: parameter uncertainty, fight-night form, stacking with Elo and the market, recalibration | Calibration curves, held-out log loss |
| v10 | Full realism validation per division and per method-by-round, sensitivity analysis for every matchup, and the final product pass | Distribution checks of simulated vs real fights |

The 3D show and the page improve alongside: modern renderer, image-based lighting, post-processing,
likeness avatars from the tale of the tape and the scouting files, technique choices from each
fighter's real style, and a matchup explorer for any two fighters.
