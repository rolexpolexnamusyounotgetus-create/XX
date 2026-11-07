# Engine v5.0.1: the v5 review's fixes (train-side work)

Nov 7, 2026. Engine 5.0.1 = engine 5.0.0 (the v5 merge, frozen in versions/v5-rejected/) plus the fixes of the v5 review. Every
behaviour change was chosen on TRAIN 2019-2023 only; nothing dated 2024 or later was simulated or scored before the single
validation look, and no 2026 fight was read. The validation look and the decision are in docs/CHANGELOG.md (v5.0.1) and
data/derived/version_history.json (entry v5.0.1): **rejected**, so src/ holds v4 again and this work is frozen in
versions/v5.0.1-rejected/.

## 1. What changed, and how each change was chosen

| Change | Where | Chosen on | Effect on backtest numbers |
|---|---|---|---|
| Input guards: finite / non-negative rate tables (matchup throws naming the field), a total-rate check and a 200,000-event cap in simulate, invalid durability / pre-UFC / embedding inputs treated as missing, judge power and NaN round scores, canonical dates, integer rounds 1-5, params loaded from the sibling file with a major-version check | src/engine3.js (no flag) | code review and the reviewer's probes | none: 1,999 train fights x 2 orders x 300 sims bit-identical to 5.0.0 |
| `components.v501.durFallback`: the computed chin / power fallback re-levelled to the record path | params v501.set.durFallback; tools/durlevel_fit.js | 2019-2023 backtest sides (decayed-sum path) and the live roster (career-sum path, a production constant like normChin) | none on backtests (every record is complete and harnesses refuse anything else); page / newcomers only |
| `components.v501.dynNoise`: within-fight output noise refit | params v501.set.dynNoise; tools/v501_dynfit.js | realism distance to the real 2019-2023 fights | yes |
| `components.v501.levels`: outLevel and the joint knockdown / finish / judging level pass redone on top of dynNoise | params v501.set.levels; tools/v5_calB_levels.js | 2019-2023 actuals | yes (small) |
| `components.v501.kdBase`: the knockdown base of the durability component | tools/v501_kdlevel_cv.js | pre-registered forward-chained CV inside 2019-2023 | none: the incumbent (trailing 730 days) was kept, so there is no set |

## 2. Within-fight noise (dynNoise)

The review found 5.0.0's per-fighter output noise too large and too little of it shared (formOut 0.21, arSd 0.32, arPhi 0.85,
formPace 0.45, formAcc 0.43), which flattened win probabilities (train calibration slope 1.18 vs v4's 1.06). Harness:
tools/v501_dynfit.js simulates every 2019-2023 backtest fight in both orders with evalv's leak-free inputs and traces it (16 sims
per order), and computes the review's statistics for the simulation and for the real fights (tools/v501_real_rounds.py, ufcstats
round rows of the same 1,999 fights).

Selection: the smallest standardized distance to the real values over seven targets (fight-level residual-to-within-sd ratios for
sig attempts, sig landed and logit accuracy; the corr of A and B log attempts in 3-round decisions; the within-round corr of A and B
attempts; own sig-landed corr R1-R2 and R1-R3), each scaled by its real-data CI half-width. 19 configurations in three grids;
the winner (I4) was also best with the eighth target (own log-attempts corr R1-R2), which no configuration matches.

| statistic (train, full rounds / 3-round decisions) | real | 5.0.0 | 5.0.1 (dynNoise + levels) |
|---|---|---|---|
| round sig landed mean | 19.80 | 19.71 | 19.78 |
| round sig landed sd / NB k | 12.64 / 2.80 | 16.94 / 1.45 | 15.67 / 1.73 |
| within-round corr A vs B, attempts | 0.660 | 0.561 | 0.661 |
| own sig landed corr R1-R2 / R1-R3 | 0.571 / 0.490 | 0.635 / 0.592 | 0.557 / 0.508 |
| own log attempts corr R1-R2 | 0.574 | 0.528 | 0.449 |
| fight level: real residual sd / sim within-fight sd, attempts / landed / accuracy | 1 / 1 / 1 | 0.896 / 0.878 / 0.949 | 0.992 / 0.959 / 0.987 |
| corr of A and B log fight attempts (3-round decisions) | 0.710 | 0.593 | 0.705 |

Chosen values: formOut 0.15, arSd 0.24, arPhi 0.6, formPace 0.42, roundPace 0.15, formAcc 0.40. The fight-level noise now matches
the data, more of it is shared, and round-to-round persistence is closer. Left for v6: the round-level spread (sd 15.7 vs 12.6) is
between-matchup heterogeneity and finish selection, not form noise, and log-attempt persistence (0.45 vs 0.57) cannot be matched
together with landed persistence in this parametrisation.

## 3. Levels redone (levels)

Less noise raised realised sig landed per 15 by 1.9% (62.5 vs 61.4) and moved the 10-8 share, so outLevel was re-matched to keep
5.0.0's realised output (1.039 -> 1.0201) and the one joint level pass of Calibrate B was rerun on top (tools/v5_calB_levels.js fit,
six damped iterations + a 200-sim final run; data/derived/v501_levels.json): kdLevel3 0.6772 -> 0.6750, kdLevel5 0.5656 -> 0.5651,
convLevel 1.0966 -> 1.1068, stkoScale 0.6587 -> 0.6650, gnpScale 0.4322 -> 0.4363, t108 8.176 -> 7.7255. Final train fit: KD per 100
head 0.778 (actual 0.782), conversion 0.511 (0.512), KO 31.7% (31.7%), 10-8 share 4.67% of 2021-23 decision judge-rounds (4.71%),
MD 1.24% of decisions (2.04%; 5.0.0 1.05%), draws 0.75% (1.01%).

## 4. The knockdown base (kdBase): forward-chained CV inside 2019-2023

The review traced v5's out-of-sample knockdown excess to the durability component's absolute level: the trailing 730-day league
level sets it, and that level lags breaks (it carried the 2022 high into 2023; on train, 2023 was v5's worst year at +8.6%). The
review asked to compare, by forward-chained CV inside 2019-2023, the engine's priors-based level, L730 shrunk toward a long-run
level, and a longer window. The rule was written into tools/v501_kdlevel_cv.js before it ran:

- candidates: A L730 (incumbent), B relative mode (the engine's walk-forward priors level), C L1460, D L1825, E sqrt(L730 x level
  since 2008); levels per fight from tools/v501_kdlevels.py (strictly earlier fight days, data/derived/kd_levels_wf.json);
- each test year 2020-2023 re-matches the knockdown scale on 2019..y-1 only, then predicts KD per 100 head landed in year y;
- primary: RMSE of log(predicted / actual) over the four years; secondary: per-fight KD Poisson deviance on the test years;
- A is replaced only if the best RMSE is at most 0.9 x A's and its deviance is not worse.

| candidate | RMSE | 2023 error | test KD deviance | 2020 / 2021 / 2022 / 2023 predicted (actual 0.753 / 0.660 / 0.861 / 0.771) |
|---|---|---|---|---|
| **A L730 (kept)** | **0.141** | +11.4% | 1468.0 | 0.787 / 0.769 / 0.703 / 0.864 |
| B relative (priors level) | 0.175 | -4.2% | 1468.8 | 0.843 / 0.819 / 0.672 / 0.739 |
| C L1460 | 0.159 | +1.6% | 1469.6 | 0.826 / 0.807 / 0.687 / 0.783 |
| D L1825 | 0.162 | +2.1% | 1468.9 | 0.824 / 0.825 / 0.695 / 0.787 |
| E shrunk toward since-2008 | 0.149 | +8.6% | 1464.4 | 0.816 / 0.808 / 0.715 / 0.840 |

The incumbent has the lowest RMSE, so it stays and kdBase has no set. Year-to-year swings in the league level (0.66 to 0.86 KD per
100 head) dominate every tracker; on four test years no window wins clearly, and the 2023 pseudo-holdout alone would have picked
another one. That is information for v6, not a reason to switch here. (The validation look then showed the 2024-25 excess
persists: section 6.)

## 5. Train numbers (5.0.1 vs 5.0.0 and v4; tuning data, not a selection criterion)

`node tools/evalv.js --version v5.0.1 --split train` (1,999 fights, 300 sims per order) and tools/evalv_decide.js against
deterministic reproductions of 5.0.0's and v4's train runs (identical per-fight pA to the stored runs):

| train 2019-2023 | v4 | 5.0.0 | 5.0.1 | 5.0.1 - 5.0.0 [95% CI] | 5.0.1 - v4 [95% CI] |
|---|---|---|---|---|---|
| winner log loss | 0.6635 | 0.6565 | 0.6542 | -0.0023 [-0.0050, +0.0005] | -0.0093 [-0.0143, -0.0039] |
| calibration slope | 1.06 | 1.18 | 1.12 | | |
| 7-bin | 1.6710 | 1.6345 | 1.6349 | +0.0004 [-0.0057, +0.0071] | -0.0361, p < 0.001 |
| method | 0.9672 | 0.9578 | 0.9587 | +0.0009 [-0.0033, +0.0048] | -0.0085 |
| KD deviance | 0.715 | 0.700 | 0.696 | -0.0041 [-0.0077, -0.0005] | -0.019 |
| who x how x when vs S | | +0.0236 | +0.0163 [-0.0008, +0.0345] | | |

Per-year KD per 100 head / KO share on train (the Calibrate gate the review asked for; 2023 is the pseudo-holdout):

| year | actual KD / KO | 5.0.1 | 5.0.0 | v4 |
|---|---|---|---|---|
| 2019 | 0.872 / 32.5% | 0.837 / 32.1% | 0.835 / 32.0% | 0.863 / 33.1% |
| 2020 | 0.753 / 29.2% | 0.757 / 30.9% | 0.754 / 31.0% | 0.804 / 32.5% |
| 2021 | 0.660 / 32.7% | 0.752 / 31.7% | 0.753 / 31.6% | 0.803 / 33.1% |
| 2022 | 0.861 / 33.0% | 0.721 / 30.8% | 0.719 / 31.1% | 0.713 / 31.2% |
| 2023 | 0.771 / 30.9% | 0.833 / 32.6% | 0.836 / 32.9% | 0.754 / 31.6% |

The gate flags 2023 (+8% KD for 5.0.x, -2% for v4) as the review predicted; the forward-chained check (section 4) found no
tracker that does better over 2020-2023, so it is recorded and passed on to v6.

## 6. Validation (the single 5.0.1 look; details in docs/CHANGELOG.md)

Winner log loss 0.6267 vs v4 0.6324, paired -0.0057 [-0.0141, +0.0023] (n.s.); four stat-line deviances better after Holm; KD per
100 head 0.827 vs 0.684 actual fails the paired base-rate test, so 5.0.1 is rejected. By window (information only) the knockdown
excess is all in 2024 (sim 0.85 vs actual 0.57); 2025 is level (0.81 vs 0.81).

## 7. Reproduce

    python3 tools/v501_real_rounds.py
    node tools/v501_dynfit.js --engine-dir versions/v5.0.1 --sims 16 --params '{}'           # realism statistics
    python3 tools/v501_kdlevels.py && node tools/v501_kdlevel_cv.js --engine-dir versions/v5.0.1 --sims 100
    node tools/durlevel_fit.js --engine-dir versions/v5.0.1
    node tools/evalv.js --version v5.0.1 --split train          # train block of the history entry
    node tools/evalv_decide.js --new data/derived/evalv/v5.0.1_val.json --old data/derived/evalv/v4_repro_dev_val.json
