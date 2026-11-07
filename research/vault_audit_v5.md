# Vault audit 1 (the v5 milestone): every frozen model on the sealed 2026 fights

Sat Nov 7, 2026, 4:57 to 5:35 am UTC. Auditor run, first of the two allowed vault openings (docs/BACKLOG.md
"Hidden-data protocol"; docs/V6_V10_PLAN.md 6.5 and 7.1). Scope: the pre-registered AUDIT 1 SCOPE (V6_V10_PLAN 6.5.3
plus 7.1 item 5), with the additions the audit brief lists (ML v1, MoE no-line, round-level WHR, the predict() package,
the props pool, the debut method model). Nothing was tuned: every model is scored as frozen, and the only fits this audit
ran are frozen specifications re-fit on pre-2024 rows to recover objects that were never stored, each reproduced exactly
on 2024-25 first (section 0). One report, no changes after it.

The vault: 373 UFC fights, Jan 24 to Oct 31, 2026, on 38 cards; 369 decisive (3 draws, 1 no-contest). Every fight
has both men with a prior UFC bout (backtest_vault.json's universe). Brackets are 95% event-cluster bootstrap intervals
(2,000 resamples of cards, the same draws for every model, so differences are exactly paired). Negative = better for
losses. Every probability is P(first-named fighter A); every model is corner-symmetric, engines are simulated in both
corner orders (300 sims per order), and calibration slopes are mirrored with no intercept.

## Bottom line

1. **v5 and v5.0.1 vs v4 (descriptive; both stay rejected, the vault never selects).** Winner log loss: v4 0.6429,
   v5 0.6432 (+0.0004 [-0.0124, +0.0122]), v5.0.1 0.6402 (-0.0027 [-0.0156, +0.0100]). Method (KO / SUB / DEC):
   v5 -0.0258 [-0.0478, -0.0056], v5.0.1 -0.0184 [-0.0390, +0.0012]. KD deviance better for both (-0.032, CIs exclude 0);
   the other four stat lines are n.s. On 2026 the v5 lineage's knockdown level is right (KD per 100 head 0.969 / 0.971
   vs actual 0.972; v4 0.783), the opposite of the 2024 glove-trial failure that rejected it. KD / KO levels on the
   vault are "seen-level" (exposure list, item 6), so this cannot confirm a KD / KO claim.
2. **The 2024-25 underconfidence did not persist; it reversed.** The closing line is calibrated (slope 0.96
   [0.67, 1.31]); every production stack's slope is below 1: with the close 0.84 [0.60, 1.13], with the open 0.79
   [0.56, 1.05], and without a line 0.56 [0.38, 0.77], the last clearly over-confident.
3. **Drift rule 6.5.1(a): not met.** The frozen production no-line stack (blindtest_stack.json `model`, absent block,
   = the ledger's `p_a_noline`; column fixed in writing at 4:57 am UTC before any vault-derived file existed) has slope
   **0.561 [0.380, 0.774]**: the point is below 1.15 but the CI excludes 1 (from below), so the switch to h 3, T 1 does
   not fire. Plan 4.2 calls this "inconclusive": no production change; rule (b) keeps running on the forward ledger.
   This is the case research/model_calib.md section 4 item 3 predicted the rule cannot act on (a clearly
   over-sharp stack). Any change to the rule is a v9 question and, under 6.5.2, "not clean on the vault".
4. **The close edge is absent: level with the market.** Production stack with the close minus the close
   +0.0069 [-0.0013, +0.0158]; ML v2 close stack (2019-2023 weights) +0.0039 [-0.0020, +0.0103]. By plan 4.2 the ledger
   and page copy should say "level with the market" (a copy consequence, recorded here, not applied by this audit).
5. **Winner ranking on 2026** (log loss): close 0.6003, ML v2 close stacks 0.603-0.608, production stack + close
   0.6072, open 0.6199, ML v2 open stacks 0.614-0.618, ML v2 blend (static) 0.6242, ML v2 logistic 0.6287, WHR rounds
   0.6343, ML v1 logistic 0.6376, engine v5.0.1 / v4 / v5 0.640-0.643, feature LR 0.6432, market rating 0.6512, no-line
   stacks 0.634-0.664, Elo 0.6868. The production no-line stack is worse than the ML v2 logistic alone, +0.0315
   [+0.0039, +0.0603]; the ML v2 no-line stacks beat it (-0.0197 to -0.0246, CIs exclude 0).
6. **Method side line.** S2 beats S on who x how x when, -0.0277 [-0.0503, -0.0045]; +ml2win adds nothing (+0.0056
   n.s.). With the winner held at the close, the props pool beats S2, 7-bin -0.0324 [-0.0530, -0.0116] (2024-25:
   -0.0172). The debut method model beats division base rates on 105 debut bouts, method given the winner -0.102
   [-0.163, -0.043]. The engines still trail S (v4 +0.071 [+0.025, +0.117]; v5 +0.026, v5.0.1 +0.032, n.s.).
7. **Base rates: 2026 finished more often than any model predicted.** Actual finish 55.6% [49.1, 62.5] (KO 38.4%,
   SUB 17.2%, decision 44.4%), KD per 100 head 0.972; v4 48.3% / 31.0% / 0.783, v5 51.5% / 34.3% / 0.969, S 53.6%
   finish. Standard gloves all year (the trial was Jun 1 - Nov 15, 2024), so the glove-window amendment does not touch
   the vault. The 2026 KO level was visible in aggregate before the seal and is not blind.
8. **Exposures.** The six known pre-seal items (6.5.3) are confirmed, and seven more are listed in section 6. Two of
   them matter for these numbers: v4's EM judging weights were fit on cards through 2026-10 (the vault's decisions), and
   methodround.json already held S / SM cells for every vault fight (its committed note printed the S row this audit
   reproduces: method 0.9629, joint 2.1598).

## 0. What was scored, and how each model was kept frozen

| model | frozen object | fit | 2026 inputs (all pre-fight) | reproduction check (on data the model already saw) |
|---|---|---|---|---|
| engines v4 / v5 / v5.0.1 | versions/v4, v5-rejected, v5.0.1-rejected (hashes = version_history.json) | as frozen | tools/evalv.js itself, 17 literal input substitutions (tools/vault_audit1/evalv_vault.js): vault backtest, priors_asof["2026"] (fights 2021-2025), learned rates from the production mlrates.json (fit 2010-2025), v5: durability_vault.json records (fit through 2023) + train NORM, SOS pairs walked through 2026-10 with the 2019-2023 coefficients, embeddings from the 2026-01-01 export (embed_model.json; 39 of 746 sides had no export and get embed.js's zero vector), preufc pre-bout records | mlrates pipeline reproduces every stored 2024-25 dev rate exactly (max abs log ratio 0); SOS pairs before 2026 equal sos_wf.json (0 of 2,864 differ) |
| close / open | market_vault.json | — | power de-vig of the mean US-sportsbook close (5-6 books on BFO event pages; exchanges excluded, so no post-result price); multiplicative no-vig opener; 373 / 373 present, nothing fetched | — |
| Elo | build_db Elo (K 44, boost 1.5) | tuned 2019-2023 | backtest_vault pre-fight Elo | — |
| ML v1 logistic | ml_vault.json `lr_refit` (January refit through 2025; `lr` = fit 2010-2023 reported too) | as frozen | tools/ml.py's own vault export | — |
| ML v2 logistic | ml2.json page_model coefficients (fit 2010-2025); static = fit.pkl `lr|static` (fit 2010-2023) | as frozen | tools/ml2.py's own table builders with the parse cutoff moved to 2026-11-01; rating features from the frozen build's code and parameters (commit b9ac8d7) | refit of the production spec on pre-2026 rows equals page_model to 8.9e-16; static equals ml2.json 2024-25 ml2_lr to 5e-5 (4-dp rounding); rating features equal the frozen ratings_all.pkl exactly |
| ML v2 blend (static) | LR + LightGBM + XGBoost, fit.pkl blend weights | fit < 2024 | trees not stored, so retrained with frozen config, rounds and seeds on rows before 2024 | retrained 2024-25 predictions equal fit.pkl exactly (max diff 0) |
| production stacks | blindtest_stack.json `model` (close), `model_open` (open), absent block (no line); fit through 2025-12-13 | as frozen | experts: market, mkt_rating (market_vault), engine v4 (this audit's run), ml (ML v1 lr_refit), feat_lr (moe_page.json production coef 2010-2025 on side records; counters by moe.py's own loop), elo_sig, elo; src/ml/moe.js | side counters equal out/moe_cache/prep.pkl on 112,640 values (max diff 0) |
| MoE no-line | moe_page.json `model` absent block (h 1.5, T 1.1667) | as frozen | same experts | — |
| ML v2 stacks | forward_models.json ml2_static (weights 2019-2023) and ml2.json page_model.stack (2019-2025) | as frozen | fed the production ML v2 logistic, as the forward ledger does; `_static_static` = static weights fed the static logistic (the 2024-25 configuration) | — |
| WHR (rounds), ratings stack | ratings_vault.json | tuned 2019-2023 | tools/ratings.py's own vault export | equals this audit's walk (max diff 5e-5) |
| predict() package, v4 base | versions/v5-rejected/ml/blend.js rescale / poolCells, v5 params blend (mrWeight 0.3, linear) | as frozen | winner = the production stack by lineKind (engine expert v4); cells = 0.3 x rescaled v4 cells + 0.7 x rescaled SM_refit (close) or S_refit (open, none) | predict() exists only in v5 engines; its point outputs are this deterministic composition |
| S, SM, S_refit, SM_refit | methodround.json per-fight cells | through 2023 / Jan-1 refit through 2025 | stored | — |
| S2, S2 + ml2win | tools/ml2.py stage_method, 2024 fold | fit < 2024 (as validated) | rebuilt with the frozen penalties | the same fold's S equals methodround.json S on 2024-25 and on the vault (max diff 2e-4 = JSON rounding) |
| props pool | src/ml/propspool.js, props.json production parameters (2021-2025) | as frozen | consensus method6 from market_vault (raw per-book 2026 props do not exist in the repo) | on 808 2024-25 fights, market.json method6 vs the pool's own per-book consensus: max abs diff 0.0036 |
| debut method model | src/ml/debut.js, debut.json production (2012-2025) | as frozen | 105 decisive 2026 debut bouts (parse); pre-UFC rates from preufc.json pre-bout snapshots, UFC counts walk-forward, winner input = seeded Elo (preufc_vault; no 2026 lines exist for debut bouts) | approximation: pav from preufc.json's snapshot index instead of debut.py's resolver |

## 1. Engines: v4 (kept) vs v5 and v5.0.1 (rejected; descriptive)

| metric | v4 | v5 | v5.0.1 | v5 - v4 | v5.0.1 - v4 |
|---|---|---|---|---|---|
| winner log loss | 0.6429 [0.6191, 0.6681] | 0.6432 | 0.6402 | +0.0004 [-0.0124, +0.0122] | -0.0027 [-0.0156, +0.0100] |
| Brier | 0.2259 | 0.2259 | 0.2244 | -0.0000 [-0.0057, +0.0056] | -0.0015 [-0.0071, +0.0042] |
| accuracy | 0.640 | 0.637 | 0.654 | -0.003 [-0.033, +0.032] | +0.015 [-0.021, +0.055] |
| calibration slope | 1.22 [0.85, 1.60] | 1.24 [0.89, 1.65] | 1.20 [0.85, 1.59] | | |
| ECE (point) | 0.042 | 0.032 | 0.042 | | |
| 7-bin | 1.6292 | 1.6013 | 1.6035 | -0.0279 [-0.0712, +0.0111] | -0.0257 [-0.0681, +0.0125] |
| method (KO / SUB / DEC) | 0.9781 | 0.9523 | 0.9597 | -0.0258 [-0.0478, -0.0056] | -0.0184 [-0.0390, +0.0012] |
| who x how x when | 2.2304 | 2.1853 | 2.1921 | -0.0450 [-0.0905, -0.0020] | -0.0382 [-0.0821, +0.0055] |
| round given a finish | 1.0594 | 1.0406 | 1.0265 | -0.0188 [-0.0429, +0.0065] | -0.0329 [-0.0608, -0.0063] |
| method given the winner | 0.9458 | 0.9274 | 0.9291 | -0.0184 [-0.0490, +0.0085] | -0.0167 [-0.0460, +0.0105] |

Brier and accuracy differences are evalv's own paired bootstrap (in <vault>/audit1/evalv/*_vault.json); every other
interval is tools/vault_audit1/score_vault.py's.

Stat-line deviance (Poisson, per fighter; `dev` = unconditional totals, `devpm` = conditioned on the real fight length):

| stat | v4 dev | v5 - v4 | v5.0.1 - v4 | v4 devpm | v5 - v4 | v5.0.1 - v4 |
|---|---|---|---|---|---|---|
| sig landed | 24.335 | -0.093 [-1.026, +0.918] | -0.125 [-0.898, +0.731] | 12.151 | +0.071 [-0.318, +0.478] | +0.074 [-0.268, +0.477] |
| sig attempts | 47.935 | -0.095 [-2.001, +1.926] | -0.094 [-1.836, +1.643] | 20.228 | +0.340 [-0.419, +1.124] | +0.370 [-0.393, +1.190] |
| TD landed | 1.865 | -0.034 [-0.076, +0.008] | -0.034 [-0.076, +0.008] | 1.546 | -0.024 [-0.068, +0.018] | -0.029 [-0.071, +0.012] |
| control (s) | 147.37 | -2.33 [-5.68, +0.70] | -2.65 [-6.31, +0.63] | 106.87 | -2.94 [-5.95, +0.01] | -3.27 [-6.23, -0.23] |
| knockdowns | 0.739 | -0.032 [-0.056, -0.007] | -0.032 [-0.058, -0.006] | 1.010 | -0.042 [-0.072, -0.013] | -0.042 [-0.075, -0.012] |

The validation look's clear stat-line gains (sig landed -0.71 / -0.80, attempts -1.23 / -1.40, TD -0.048 / -0.043,
control -4.1 / -4.3 s) are not reproduced on 2026 except for control (same sign, n.s.) and knockdowns.

**Decision tool, applied descriptively** (tools/evalv_decide.js via tools/vault_audit1/decide_vault.js; no decision is
taken on the vault): v5 vs v4: winner not worse, KD deviance better after Holm (p 0.004), no paired base-rate failure,
but the registered v5 rule fails on the SD + MD share (sim 21.3% vs actual 14.2%, tolerance 4 points). v5.0.1 vs v4:
KD better after Holm, but the paired base-rate test fails on SD + MD (22.3% vs 14.2%; v4 21.1%). These readings are
information only: a component chosen for v6 because of them is "not clean on the vault" (6.5.2).

## 2. Winner benchmarks (369 decisive fights; every model has every fight)

| model | log loss [95% CI] | Brier | accuracy | slope [95% CI] |
|---|---|---|---|---|
| close (power de-vig) | 0.6003 [0.5531, 0.6501] | 0.2055 | 0.715 | 0.96 [0.67, 1.31] |
| close (multiplicative) | 0.5996 [0.5570, 0.6455] | 0.2056 | 0.715 | 1.06 [0.75, 1.43] |
| open | 0.6199 [0.5792, 0.6641] | 0.2142 | 0.663 | 0.99 [0.67, 1.37] |
| Elo | 0.6868 [0.6710, 0.7028] | 0.2467 | 0.550 | 0.71 [0.18, 1.32] |
| strike-share Elo (elo_sig) | 0.6681 [0.6476, 0.6891] | 0.2377 | 0.588 | 0.93 [0.56, 1.35] |
| market rating | 0.6512 [0.6178, 0.6875] | 0.2292 | 0.626 | 0.97 [0.55, 1.45] |
| ML v1 logistic (refit through 2025) | 0.6376 [0.6063, 0.6708] | 0.2233 | 0.631 | 0.95 [0.67, 1.26] |
| ML v1 logistic (fit 2010-2023) | 0.6374 [0.6084, 0.6685] | 0.2232 | 0.640 | 1.02 [0.72, 1.34] |
| feature LR (feat_lr, production) | 0.6432 [0.6108, 0.6764] | 0.2266 | 0.629 | 0.88 [0.61, 1.16] |
| ML v2 logistic (production, 2010-2025) | 0.6287 [0.5909, 0.6707] | 0.2187 | 0.640 | 0.89 [0.62, 1.20] |
| ML v2 logistic (static, 2010-2023) | 0.6276 [0.5927, 0.6658] | 0.2184 | 0.642 | 0.95 [0.66, 1.26] |
| ML v2 blend (static LR + LGB + XGB) | 0.6242 [0.5901, 0.6619] | 0.2168 | 0.661 | 1.00 [0.71, 1.32] |
| WHR (rounds) | 0.6343 [0.6067, 0.6626] | 0.2219 | 0.656 | 1.11 [0.79, 1.50] |
| ratings stack | 0.6344 [0.6052, 0.6638] | 0.2218 | 0.631 | 1.03 [0.73, 1.40] |
| engine v4 | 0.6429 [0.6191, 0.6681] | 0.2259 | 0.640 | 1.22 [0.85, 1.60] |
| production stack + close (`model`) | 0.6072 [0.5567, 0.6608] | 0.2082 | 0.696 | 0.84 [0.60, 1.13] |
| production stack + open (`model_open`) | 0.6201 [0.5736, 0.6718] | 0.2134 | 0.688 | 0.79 [0.56, 1.05] |
| production stack, no line (`p_a_noline`) | 0.6602 [0.5996, 0.7253] | 0.2277 | 0.650 | 0.56 [0.38, 0.77] |
| MoE no-line (moe_page.json) | 0.6641 [0.6036, 0.7296] | 0.2289 | 0.664 | 0.55 [0.37, 0.75] |
| ML v2 close stack, 2019-2023 weights | 0.6042 [0.5560, 0.6562] | 0.2071 | 0.707 | 0.90 [0.64, 1.22] |
| ML v2 open stack, 2019-2023 weights (ledger primary) | 0.6150 [0.5703, 0.6637] | 0.2116 | 0.683 | 0.87 [0.62, 1.16] |
| ML v2 no-line stack, 2019-2023 weights | 0.6356 [0.5929, 0.6834] | 0.2212 | 0.637 | 0.80 [0.53, 1.10] |
| ML v2 close / open / no-line, 2019-2023 weights + static logistic | 0.6033 / 0.6138 / 0.6344 | 0.2068 / 0.2113 / 0.2209 | 0.715 / 0.680 / 0.642 | 0.92 / 0.90 / 0.84 |
| ML v2 close / open / no-line, production weights (2019-2025) | 0.6076 / 0.6181 / 0.6405 | 0.2083 / 0.2125 / 0.2219 | 0.688 / 0.672 / 0.642 | 0.84 / 0.81 / 0.68 [0.46, 0.93] |
| predict() package (v4 base), close / open / none | = the production stack's three rows (P(win) is the stack by lineKind) | | | |

Paired log-loss differences:

| comparison | difference [95% CI] |
|---|---|
| production stack + close - close (**the close edge**) | +0.0069 [-0.0013, +0.0158] |
| ML v2 close stack (2019-2023) - close | +0.0039 [-0.0020, +0.0103] |
| ML v2 close stack (production) - close | +0.0074 [-0.0011, +0.0169] |
| production stack + open - open | +0.0002 [-0.0190, +0.0206] |
| ML v2 open stack (2019-2023) - open | -0.0048 [-0.0190, +0.0101] |
| ML v2 open stack (2019-2023) - production stack + open | -0.0051 [-0.0146, +0.0040] |
| ML v2 no-line (2019-2023) - production no-line stack | -0.0246 [-0.0467, -0.0032] |
| ML v2 no-line (production) - production no-line stack | -0.0197 [-0.0391, -0.0012] |
| production no-line stack - ML v2 logistic | +0.0315 [+0.0039, +0.0603] |
| production no-line stack - close | +0.0599 [+0.0272, +0.0939] |
| open - close | +0.0196 [-0.0014, +0.0415] |
| ML v2 logistic - close | +0.0284 [+0.0049, +0.0537] |
| ML v2 logistic - ML v1 logistic | -0.0089 [-0.0252, +0.0090] |
| ML v2 logistic - Elo | -0.0581 [-0.0928, -0.0199] |
| WHR - Elo | -0.0525 [-0.0766, -0.0271] |
| engine v4 - Elo | -0.0440 [-0.0681, -0.0211] |
| engine v4 - ML v2 logistic | +0.0142 [-0.0182, +0.0430] |
| engine v4 - close | +0.0426 [+0.0022, +0.0816] |

Reading: on 2026 the frozen with-line stacks are level with the market (close and open), the ML v2 stacks are the
best non-market winners, and the no-line production stacks lose because their production sharpening (recency
weighting h 1.5 plus temperature 1.16-1.17 on top of 2024-25-heavy weights) met a year in which nothing needed
stretching.

## 3. Calibration slopes, the close edge and the drift rule

Mirrored, no-intercept slopes for every model are in the tables above (engines in section 1, winner models in section
2). Summary: the market is calibrated (close 0.96, open 0.99); single models are close to 1 (ML v2 0.89-1.00, ML v1
0.95-1.02, WHR 1.11, engines 1.20-1.24); every production and ML v2 stack is below 1 (the ratings stack, 1.03, is the
exception), and the more a stack was sharpened in production the lower it sits (no-line production 0.56, ML v2 production no-line 0.68, ML v2 2019-2023 no-line 0.80). The 2024-25
pattern (every input underconfident, slopes 1.1-1.7) did not carry into 2026.

**Pre-registered production drift rule 6.5.1(a)** (switch the production no-line stack to h 3, T 1 iff its mirrored
slope has point < 1.15 and a 95% CI that includes 1):

| column | slope [95% CI] | (a) met? | plan 4.2 branch |
|---|---|---|---|
| **primary: production no-line stack** (blindtest_stack.json `model` absent block = ledger `p_a_noline`) | **0.561 [0.380, 0.774]** | **no** (CI excludes 1) | inconclusive |
| secondary: ML v2 production no-line stack (ml2.json page stack; the stack research/model_calib.md simulated) | 0.684 [0.462, 0.929] | no | inconclusive |
| secondary: moe_page.json MoE no-line | 0.547 [0.367, 0.753] | no | inconclusive |
| reference only (not a production stack): ML v2 no-line, 2019-2023 weights | 0.804 [0.532, 1.103] | the wording would be met | — |

**Rule state: NOT TRIGGERED. Production no-line settings stay h 1.5 with their temperature. Rule (b) (forward
ledger, trailing 200 bouts, two consecutive quarters) remains the only live trigger.** The column was named in
<vault>/audit1/PRECOMMIT_drift_column.txt (sha256 4f0c119b4f32c91c, written 4:57:38 am UTC, before any vault-derived
file existed: the first, the learned stat-line rates, was written at 5:00:51 am, and the first winner probability
at about 5:04 am). The readings agree, so the choice of column does not change the state.

**Close edge**: absent (+0.0069 [-0.0013, +0.0158]; the 2024-25 claim was -0.0060 to -0.0096). Pre-registered
consequence (plan 4.2): the ledger and page copy say "level with the market"; cycle 1 keeps its plan.

## 4. Side line (descriptive): method x round cells

All 372 fights with an outcome (draws kept as their own cell). Rows: methodround.json's S (fit through 2023, as stored),
its Jan-1 refits, the rebuilt S2 / S2 + ml2win (fit < 2024), the props pool and S2 composed with the closing line's
winner, and the predict() package's cells.

| model | who x how x when | method | 7-bin | round given finish | method given winner | winner |
|---|---|---|---|---|---|---|
| S (fit through 2023) | 2.1598 [2.0488, 2.2731] | 0.9629 | 1.5882 | 1.0272 | 0.9204 | 0.6356 |
| S_refit (through 2025) | 2.1620 | 0.9642 | 1.5896 | 1.0282 | 0.9204 | 0.6368 |
| SM (close in the model) | 2.1190 | 0.9558 | 1.5475 | 1.0269 | 0.9215 | 0.5936 |
| SM_refit | 2.1242 | 0.9572 | 1.5518 | 1.0280 | 0.9214 | 0.5979 |
| S2 (fit < 2024) | 2.1320 [2.0154, 2.2447] | 0.9503 | 1.5605 | 1.0269 | 0.9101 | 0.6185 |
| S2 + ml2win (fit < 2024) | 2.1377 | 0.9523 | 1.5661 | 1.0270 | 0.9101 | 0.6242 |
| S2 @ close winner | 2.1139 | 0.9490 | 1.5424 | 1.0266 | 0.9101 | 0.6003 |
| props pool @ close winner (370 with props) | 2.0809 [1.9527, 2.2032] | 0.9250 | 1.5080 | 1.0281 | 0.8783 | 0.5976 |
| predict() v4 base: close / open / none | 2.1405 / 2.1525 / 2.1923 | 0.9580 / 0.9590 / 0.9633 | 1.5635 / 1.5754 / 1.6152 | 1.034 | 0.922-0.923 | 0.6072 / 0.6201 / 0.6602 |
| engine v4 / v5 / v5.0.1 | 2.2304 / 2.1853 / 2.1921 | 0.9781 / 0.9523 / 0.9597 | 1.6292 / 1.6013 / 1.6035 | 1.0594 / 1.0406 / 1.0265 | 0.9458 / 0.9274 / 0.9291 | 0.6429 / 0.6432 / 0.6402 |

| paired | who x how x when | method | 7-bin | method given winner |
|---|---|---|---|---|
| S2 - S | -0.0277 [-0.0503, -0.0045] | -0.0127 [-0.0236, -0.0009] | -0.0277 [-0.0504, -0.0045] | -0.0103 [-0.0231, +0.0025] |
| S2 + ml2win - S | -0.0221 [-0.0499, +0.0086] | -0.0107 [-0.0215, +0.0010] | -0.0221 [-0.0500, +0.0086] | -0.0103 [-0.0231, +0.0025] |
| S2 + ml2win - S2 | +0.0056 [-0.0052, +0.0175] | +0.0020 [-0.0004, +0.0047] | +0.0056 [-0.0052, +0.0175] | 0 |
| S_refit - S | +0.0022 [-0.0119, +0.0174] | +0.0012 | +0.0014 | 0.0000 |
| props pool - S2, same winner (close) | -0.0324 [-0.0530, -0.0116] | -0.0248 [-0.0439, -0.0057] | **-0.0324 [-0.0530, -0.0116]** | -0.0324 [-0.0533, -0.0112] |
| engine v4 - S | +0.0706 [+0.0254, +0.1166] | +0.0152 [-0.0132, +0.0417] | +0.0409 [-0.0031, +0.0855] | +0.0254 [-0.0068, +0.0588] |
| engine v5 - S | +0.0256 [-0.0092, +0.0641] | -0.0106 [-0.0335, +0.0123] | +0.0131 [-0.0183, +0.0458] | +0.0070 [-0.0204, +0.0348] |
| engine v5.0.1 - S | +0.0324 [-0.0058, +0.0719] | -0.0032 [-0.0250, +0.0188] | +0.0153 [-0.0193, +0.0510] | +0.0087 [-0.0191, +0.0388] |
| engine v4 - S2 + ml2win | +0.0927 [+0.0454, +0.1408] | +0.0259 [-0.0003, +0.0522] | +0.0630 [+0.0183, +0.1068] | +0.0357 [+0.0047, +0.0697] |
| predict() close - SM_refit | +0.0163 [+0.0042, +0.0293] | +0.0008 | +0.0116 [-0.0008, +0.0252] | +0.0017 |
| predict() close - engine v4 | -0.0898 [-0.1325, -0.0411] | -0.0201 [-0.0352, -0.0048] | -0.0657 [-0.1066, -0.0215] | -0.0227 [-0.0401, -0.0052] |

Readings: S2 confirms on 2026 (2024-25: -0.0303 joint vs S); the ML v2 winner reweighting, which added -0.006 on
2024-25 (S2 + ml2win - S -0.0367), does not help the cells this year (ML v2's winner is weaker than the close in 2026); the props pool confirms its 2024-25 gain at roughly twice the
size; mixing 30% of the v4 simulator into predict()'s cells costs +0.016 against SM_refit alone (the 0.3 weight was
the Calibrate-B v5 setting; the engine's method shape is the weak part). The S and SM rows are not blind (exposure 1).

**Debut method model** (105 decisive 2026 bouts with a debutant, 128 debutant sides, 33 cards; winner input seeded
Elo): method given the winner 0.9737 [0.8656, 1.0791] vs division base rates 1.0761, **-0.1024 [-0.1635, -0.0432]**;
marginal KO / SUB / DEC with the seeded-Elo winner 1.0112 vs 1.0761, -0.0649 [-0.1106, -0.0218] (2024-25: -0.084 and
-0.045). Actual mix in these bouts: KO 47.6%, SUB 18.1%, decision 34.3%; the model predicted 36.8 / 15.3 / 47.9 and
the base rates 33.6 / 17.1 / 49.3, so both under-predict finishes and the model less so.

## 5. Base rates vs actual

| | actual 2026 [95% CI] | v4 | v5 | v5.0.1 | S | S2 | props pool @ close | 2025 old gloves (actual) |
|---|---|---|---|---|---|---|---|---|
| finish | 55.6% [49.1, 62.5] | 48.3% | 51.5% | 51.5% | 53.6% | 53.5% | 55.8% | 51.0% |
| KO / TKO | 38.4% [32.2, 45.4] | 31.0% | 34.3% | 34.3% | 35.2% | 35.5% | 37.2% | 32.8% |
| submission | 17.2% [13.4, 21.1] | 17.3% | 17.1% | 17.2% | 18.5% | 18.0% | 18.5% | |
| decision (draws included) | 44.4% [37.5, 50.9] | 51.7% | 48.6% | 48.5% | 46.4% | 46.6% | 44.3% | 49.0% |
| finish by round, 3-rounders (n 330): R1 / R2 / R3 | 31.2 / 15.5 / 8.2% | 24.8 / 14.4 / 9.0 | 28.7 / 13.9 / 8.4 | 28.4 / 14.0 / 8.6 | 27.8 / 17.5 / 7.9 | 27.7 / 17.4 / 7.9 | 29.0 / 18.1 / 8.2 | |
| finish by round, 5-rounders (n 42): R1-R5 | 14.3 / 21.4 / 14.3 / 2.4 / 9.5% | 12.6 / 12.2 / 10.0 / 9.1 / 5.2 | 18.7 / 15.3 / 9.0 / 7.6 / 4.7 | 18.3 / 15.1 / 9.2 / 7.6 / 4.8 | 20.9 / 15.8 / 10.2 / 6.2 / 4.7 | 20.7 / 15.7 / 10.1 / 6.1 / 4.7 | | |
| KD per 100 head strikes landed | 0.972 [0.795, 1.167] | 0.783 | 0.969 | 0.971 | | | | 0.87 |
| decisions: UD / SD / MD (n 162) | 85.8 / 11.7 / 2.5% | 78.9 / 20.7 / 0.4 | 78.7 / 20.5 / 0.9 | 77.7 / 21.3 / 1.1 | | | | |
| 10-8 share of judged rounds (card-implied) | 3.61% | 2.99% | 4.13% | 4.18% | | | | |
| sig landed per 15 min (one fighter) | 58.24 | 58.81 | 57.45 | 57.58 | | | | |
| takedowns per 15 min | 1.474 | 1.351 | 1.421 | 1.417 | | | | |
| control seconds per 15 min | 166.98 | 159.49 | 169.65 | 169.33 | | | | |

**Glove-window note.** Every 2026 bout used the standard UFC gloves: the redesigned glove ran only from Jun 1 to Nov
15, 2024 (UFC 302 to UFC 309) and the old gloves returned for every fighter from Feb 15, 2025 (research/model_eradrift.md,
sourced: Sherdog, Cageside Press, Bloody Elbow, ESPN; not re-checked on the web for this audit). The glove-window
amendment (V6_V10_PLAN 7.1 item 9) excludes only the 2024 trial dates, so it never applies to the vault. The 2025
column is the eradrift note's old-glove window (Feb 15 - Dec 31, 2025). 2026 continues the upward finish / KO / KD
trend; the engines, S and S2 all sit low on finishes, the props pool sits on it. By plan 4.2 this is "consistent with a
level shift" and may raise cycle 4's method offsets in priority, with the justification kept on the train-period drift
and audit 2's method result for that component flagged not clean (the KO level was public before the seal; exposure
items 2 and 6).

## 6. Exposures of 2026 data before this audit

Known pre-seal items (V6_V10_PLAN 6.5.3), each confirmed:

1. methodround's committed note prints 2026 rows for S and SM (n 372): its "2026 | 372 | 0.9629 | ... | 2.1598" row is
   exactly the S method / joint loss scored here, and data/derived/methodround.json holds S / SM / S_refit / SM_refit cells
   for all 373 vault fights. The S and SM rows of section 4 are therefore not blind.
2. The durability note gave the 2026 KD level and KO share.
3. preufc ran three evaluations pooled over 2024-2026.
4. The first market and ML builds scored 2024-2026, including the Kalshi check (Kalshi's recorded price was post-result;
   exchanges are excluded from every close used here).
5. styles' 2024+ window ran through 2026-10.
6. (Nov 7 addition) durability / styles research scored held-out tables on 2024-01-01..2026-10-31 and sat in the repo
   for about 17 hours, read by later agents (moved to the vault directory on Nov 7). KD / KO-level and durability
   results on the vault are "seen-level" for every version in both audits.

Found by this audit (none of them was used to choose anything here):

7. **Engine v4's EM judging weights** (judge.head / body / leg / kd / td / ctrlMin / sub) were fit on ufcstats cards
   2015-01-01..2026-10-31, i.e. on the vault's decisions (version_history.json v4 notes, 19:15 Nov 6; impact measured
   small on train, +0.0005). v4's vault winner and decision-split numbers carry that in-sample piece; v5 / v5.0.1 use the
   train-only weights. It also reaches every stack that uses `engine_v4` as an expert (small weights).
8. data/derived/oppadj.json holds walk-forward pre-fight factors for all 373 vault fights (no results).
9. data/derived/preufc.json holds pre-bout Sherdog snapshots dated through 2026-10-31; a fighter's later 2026 snapshot
   encodes the result of his earlier 2026 bouts where those were non-UFC.
10. data/derived/fightweek.json holds 480 fight-week rows for 2026 bouts (weigh-in, replacement, travel; no results).
11. Live tables built through the Oct 31, 2026 snapshot encode 2026 results: fighters.json / priors.json (profiles,
    records, Elo), ratings.json's roster, ml.json's roster, market.json ratings, methodround.json's js_model (fit through
    2026-10), durability.json's live fit (coef_live, 2008..2026-10). Backtests refuse them; any reader can see them.
12. data/raw/ (the ufcstats CSV snapshot through 2026-10-31 and data/raw/odds) contains every 2026 result and line;
    the protection is the parse-time 2026 filters in each tool, not the files.
13. This report and the vault_audits entry: every number above is now visible to v6-v10 builders (6.5.2 applies).

## 7. Contamination bookkeeping for audit 2 (rule 6.5.2)

Nothing in production changes because of this audit: rule (a) did not fire, and the close-edge readout is a copy
change. To be listed in audit 2 as "not clean on the vault" if they happen: any change to the drift rule (its column,
its one-sided test, its threshold) motivated by section 3; any priority or component change for KD / KO / finish levels
or method offsets motivated by section 5; any re-bundling of v5 components justified by section 1's KD / method
numbers or the descriptive evalv_decide reading; any change to predict()'s mrWeight, the props pool or the debut model
motivated by section 4; any change to the no-line stacks' sharpening (h, temperature, production refits) motivated by
section 2.

## 8. Reproduce

Every number comes from files under the vault directory written by these commands (repository root; ~3 minutes
total on 3 workers). `bash tools/vault_audit1/run_all.sh` runs them in order:

```
nice -n 5 python3 tools/vault_audit1/mlrates_vault.py
nice -n 5 python3 tools/vault_audit1/sos_vault.py
nice -n 5 node tools/vault_audit1/evalv_vault.js --version v4 --sims 300 --workers 3
nice -n 5 node tools/vault_audit1/evalv_vault.js --version v5 --sims 300 --workers 3 --compare v4
nice -n 5 node tools/vault_audit1/evalv_vault.js --version v5.0.1 --sims 300 --workers 3 --compare v4
git worktree add --detach <vault>/audit1/wt_b9ac8d7 b9ac8d7     # + symlink data/derived/backtest.json into it
nice -n 5 python3 tools/vault_audit1/ratings_ml2_vault.py --worktree <vault>/audit1/wt_b9ac8d7
nice -n 5 python3 tools/vault_audit1/ml2_vault.py
nice -n 5 python3 tools/vault_audit1/sides_vault.py
node tools/vault_audit1/models_vault.js
node tools/vault_audit1/predict_vault.js
node tools/vault_audit1/props_vault.js
nice -n 5 python3 tools/vault_audit1/debut_vault.py
node tools/vault_audit1/decide_vault.js --new v5 --old v4
node tools/vault_audit1/decide_vault.js --new v5.0.1 --old v4
nice -n 5 python3 tools/vault_audit1/score_vault.py       # every table: <vault>/audit1/score_vault.json
```

`<vault>` = /tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault (outside the repo; the
scripts never write inside it, and per-fight vault outputs stay there). Engine runs use evalv's common random numbers
(seed 1), so they are deterministic. Input hashes (sha256, first 16): backtest_vault 747e6ff5d28def51, market_vault
2620efc2c5bcbab3, ml_vault e090d67a5fc24ae5, ratings_vault 2a5d50b14e099bb3, preufc_vault 42272a6088451302,
durability_vault 464fcffae24f6b90; tools/evalv.js f4a78c13d689dba5, blindtest_stack.json ded17ce026bbff29, moe_page.json
34a33d1837e9b912, forward_models.json 20269ec7642c1db8, ml2.json 0837826dbc05cd1f, mlrates.json 6dec930e670f7c70,
embed_model.json 061d9fba48cc6633, methodround.json b26b7e373367f346, props.json 6870d44c20cc2e99, debut.json
f6709d52292ccc83. Output: score_vault.json 934a98c558210aa5.

## Deviations and caveats

- **Sample size.** 369 decisive fights on 38 cards: winner CIs are about +-0.05 and paired CIs +-0.01 to +-0.03, as
  plan 4.2 expected; most engine comparisons are n.s. by construction.
- **predict() "v4 base"** is a composition, not a predict() call: v4 has no predict(), and predict()'s point outputs
  are the stack plus pooled cells. The interval and the anchor mode were not scored. P(win) equals the stack's rows
  exactly; the cells use evalv's 300-sim engine cells instead of predict's 1,000-sim smoothing.
- **Embeddings (v5 engines).** The production embedding export (2026-01-01) was used for every 2026 bout, without the
  walk's in-year fighter updates (the page does the same); 39 of 746 sides (2026 debutants fighting again in 2026)
  had no export and got the zero vector.
- **Props.** Raw per-book 2026 props are not in the repository, so the pool reads market.py's consensus method6 (agrees
  with the pool's own consensus to 0.0036 on 2024-25); the distance prop is not used by the chosen spec.
- **Debut.** Sides are rebuilt for the method model only (pre-UFC rates, UFC counts); pav comes from preufc.json's
  snapshot index, and the winner input is seeded Elo because the vault holds no lines for debut bouts.
- **Rating features of the frozen ML v2 build** needed commit b9ac8d7's ratings.py and ratings.json (today's files give
  features up to 0.33 logit apart); a throwaway git worktree was used and removed.
- **Not run:** a card-by-card walk-forward inside 2026 (no per-card refit is part of any frozen model); stat-line
  distribution coverage (statlines layer; not in the audit-1 scope).
