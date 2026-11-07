# Vault audit 2 (the v10 milestone): the v4 package, the shipped forward package and the v6-v10 side lines on the sealed 2026 fights

Sat Nov 7, 2026, 12:43 pm to 1:06 pm UTC. Auditor run, the **second and last allowed opening** of the sealed vault (the first is
research/vault_audit_v5.md). It follows the audit-2 pre-registration written at the v10 freeze (data/derived/version_history.json
`vault_audits[1]`, 11:34 am UTC, with the v10 review's prewarnings of 12:40 pm) and docs/V6_V10_PLAN.md 6.5 and 6.7. Nothing was tuned.
The only fits are the pre-registered deployment refits through 2025-12-31 (section 0), each first checked against the frozen object it
extends. One report, no changes after it.

**Case that applies: `if_v4_stays`.** v10 was not kept (v10 review, docs/CHANGELOG.md "v10 finish"), v4 is the latest kept version, and
no ratification by Kira of the v10 re-scope or the branch-2 reading was recorded before this run (V6_V10_PLAN 7.1 item 11). So there is
**no confirmatory primary**. The pre-registered headline is descriptive: the open-regime winner log loss of cmp4 (the v4 package) and of
the shipped forward-model package against the opener, with v10, v7 and v6 as side lines paired against cmp4 and v8 at engine level
against v4. The failure criteria are reported for each without a decision. The glove-window label does not apply (v10 not kept; and
every 2026 bout used standard gloves). The case and the headline columns were written into `<vault>/audit2/PRECOMMIT_audit2.txt`
(sha256 d144e2ac11b1fdc0) at 12:43:29 pm UTC, before any audit-2 vault-derived file existed (the first, ml2s2_vault.json, is dated
12:46:15 pm).

The vault: 373 fights, Jan 24 to Oct 31, 2026, 38 cards; 369 decisive (3 draws, 1 no-contest); every fight has both men with a prior UFC
bout. Every fight has a close and an opener; 371 have method props. Brackets are 95% event-cluster bootstrap intervals (20,000 card
resamples, seed 7, tools/predict_score.py; paired differences use the same draws for both sides). Negative = better for losses. Every
probability is P(first-named fighter A); every model is corner-symmetric (engines simulate both corner orders; stacks have no
intercept); calibration slopes are mirrored with no intercept (their intervals use 2,000 card resamples).

## Bottom line

1. **Headline (descriptive): level with the opener.** On 369 decisive fights the opener scores 0.6199. cmp4 (the v4 package with its
   MoE expert stack fit through 2025) scores 0.6213: **+0.0014 [-0.0188, +0.0210]** vs the opener. The shipped forward-model package
   (fwd-4.4: the ML v2 open stack, 2019-2023 weights, on the production ML v2 logistic) scores 0.6150: **-0.0048 [-0.0196, +0.0097]**.
   cmp4 minus the forward package: +0.0063 [-0.0024, +0.0145]. Neither beats the opener; the interval is about +-0.02 (minimum detectable
   effect about 0.03), so failure criterion (i), "CI upper bound > +0.002", is met by both by width alone. The close (0.6003) remains the
   best winner model.
2. **v10 side line: the same winner gain as on 2024-25, not significant.** The v10 package's open winner minus cmp4: **-0.0033 [-0.0110,
   +0.0047]** (2024-25 look: -0.00326 [-0.00653, +0.00004]); the prewarning expected about -0.003 with power about 0.22, and the realised
   SE is 0.0041. Upper bound +0.0047 > +0.002: criterion (i) met. No line: -0.0242 [-0.0420, -0.0058] (cmp4's no-line MoE stack is
   over-sharp, slope 0.56). Close: -0.0006 [-0.0058, +0.0048]. v7 and v6 have the identical winner (the ML v2 blend-head production
   stack), so their winner rows equal v10's.
3. **Method and round: the package cells beat cmp4's clearly, and the props pool does most of it.** Open regime, package as used (props
   pool where the bout has props): v10 minus cmp4 7-bin **-0.0461 [-0.0738, -0.0187]**, method -0.0322 [-0.0532, -0.0112], who x how x
   when -0.0500 [-0.0782, -0.0225]; v7 -0.0467 / -0.0324 / -0.0473. The props pool alone (v10 with vs without props) is -0.0344
   [-0.0571, -0.0123] on 7-bin; without props v10 is -0.0117 [-0.0245, +0.0008] (n.s.). v10's simulator cells add nothing over the v4
   simulator's inside the package (+0.0015 [-0.0016, +0.0045]). The same pattern holds in the no-line, close and close+props regimes.
   **Not clean:** every 7-bin, method and decision-split number on v4's simulator carries v4's all-cards EM judging weights (fit through
   2026-10), and the props pool's and S2's audit-1 numbers were seen.
4. **Stat lines (criterion (ii)): no deviance worse.** v10's engine (= v8's: identical rows, both carry the same stat-line bundle) minus
   v4 on the 10-stat harness: total relative deviance **-0.33% [-1.48%, +0.76%]**; no per-stat deviance worse or better with a CI
   excluding 0. The 2024-25 prewarning (sub-attempt deviance worse) did not recur: -0.0003 [-0.019, +0.017]. Mean absolute error is worse
   for leg landed (+0.061 [+0.013, +0.110]) and sub attempts (+0.009 [+0.004, +0.012]), as on 2024-25. evalv's per-minute control
   deviance is better: -4.88 [-8.23, -1.61]. At engine level the bundle is worse on 7-bin (+0.054 [+0.017, +0.097], Holm-rejected) and
   who x how x when (+0.058 [+0.015, +0.106]); engine winner +0.0017 [-0.0105, +0.0140].
5. **Calibration (criterion (iii)).** Mirrored slopes: opener 0.99, close 0.96, forward package 0.87 [0.62, 1.16], **cmp4 open 0.785
   [0.553, 1.040] (outside [0.8, 1.6]: criterion met)**, v10 / v7 / v6 open 0.800 [0.573, 1.056] (inside by 0.0003), v10 engine 1.15.
   Without a line every production-sharpened stack is over-confident: cmp4 0.556 [0.370, 0.765] (the audit-1 production no-line stack:
   0.561), ML v2 production no-line stacks 0.68-0.70, the ledger's 2019-2023 no-line stack 0.80.
6. **Base rates: 2026 finished more often than the engines predict.** Actual finish 55.6% (KO 38.4%, SUB 17.2%). Engines: v4 48.3%
   (KO 31.0%), v10 46.9% (KO 29.0%). The paired fixed-actual test flags v10's KO share as further from the actual than v4's with a CI
   excluding 0 (drift_6_3 and drift_outside: KO only). With the props pool the packages come close: v10 53.8%, v7 53.9%, props pool at
   the close 54.4%; cmp4 50.0%. KD / KO levels on the vault are "seen-level" (6.5.3 (a)) and cannot confirm a KD / KO claim.
7. **Drift rule 6.5.1.** Rule (a) was a one-time audit-1 trigger (not triggered). The production no-line stack is unchanged (h 1.5 with
   its temperature; blindtest_stack.json ded17ce026bbff29, moe_page.json 34a33d1837e9b912). Rule (b) has no forward rows yet
   (data/predictions/drift_monitor.json, 0 rows): not fired.
8. **Contamination.** Nothing in v10 was chosen because of audit 1 (pre-registered). Every number here repeats audit 1's 373 fights;
   the forward package's no-line column (fwd-4.3) was decided after audit 1 and is "not clean on the vault". Full list in section 10.

## 0. What was scored, and how each fit was made

Fits named in the pre-registration ("everything fit through 2025-12-31 by each package's frozen production procedure, NO 2026 data"):

| object | how it was fit through 2025 | check (on data the object already saw) |
|---|---|---|
| cmp4's MoE stacker (`model`, `model_open`, absent block) | tools/blindtest.py's own fit and export code (tools/vault_audit2/cmp_stack_2025.py), cutoff 2026-01-01; rows 2019-2023 = each expert's out-of-sample history; 2024-2025 = the blind replay's walk-forward rows (blindtest.json), as the production export assembles them; engine expert = the v7 engine's (v4 simulator's) evalv rows on fold-honest inputs (2024-25 rows via tools/vault_audit2/evalv_vault2.js --mode dev2425) | the same driver with cutoff 2024-01-01 reproduces data/derived/v7/cmp_stack_v4pkg_fit2023.json exactly (max difference 0); v7's 2024-25 engine rows equal v4_repro_dev_val.json row for row; n_train 2,809, fit_through 2025-12-13 for all three blocks |
| ML v2 head-stack weights (v10 / v7 / v6) | data/derived/v6_stacks.json production block (fit 2019-2025), passed as by_fit_year "2026" | v10's winner equals the blend-head production stack recomputed in Python (max 5e-10) |
| ML v2 inputs | production logistic = ml2.json page_model (fit 2010-2025); production blend = page logistic + LightGBM / XGBoost refit on every decisive fight before 2026 with the frozen configuration (= data/derived/ml2_trees.json) | trees reproduce ml2_trees.json's 40 export vectors (LightGBM 1e-16, XGBoost 6e-8; design rows 7e-16); 7,093 training rows = ml2_trees n_train; logistic equals audit 1's (5e-7) |
| S2 cells (v10 / v7 / v6) | data/derived/mr_s2.json js_model (production S2, fit 2012..2025, hazard 2008..2025), evaluated by tools/methodround_model.js on the vault feature rows; a 2026 row's ML v2 column uses the production logistic | a Python refit of the specification reproduces js_model's coefficients (1e-16); JS reproduces js_model's vectors (3e-16) |
| S / SM cells (cmp4) | methodround.json S_refit / SM_refit (Jan-1 refit through 2025-12-31; never js_model, fit through 2026-10) | an independent refit of S through 2025 agrees to 6.5e-4 (draw-share constant) |
| pool weight w, props pi | tools/v10_gate.py fit rules on the stored records 2019-2025 (data/derived/v10/gate_train.json + look_val.json; v6: data/derived/v6/gate_train.json + look_val.json); deployment, never scored on 2024-25 | the same rule on 2019-2023 / 2021-2023 reproduces every frozen value: w v10 0.20, cmp4 0.20, v7 0.15, v6 0.35; pi 0.47 |
| result through 2025 | **w: v10 0.20, cmp4 0.25, v7 0.20, v6 0.35; pi: v10 0.44, v7 0.44** | |
| stat-line retarget targets (v10 / v8) | tools/v8_targets.js's code path on statlines.json `models.prod` (fit 2019-2025), inputs = production learned rates, the 2026-01-01 embedding export (etas and win logit), oppadj.json snapshots (tools/vault_audit2/targets_vault.js) | the code path reproduces the stored v8 targets from the stored inputs (95,600 values, max relative difference 0) |
| learned stat-line rates (every engine) | the production mlrates.json (fit 2010-2025), audit 1's build `<vault>/audit1/mlrates_vault.json` | audit 1: reproduces every 2024-25 dev rate exactly |
| embedding inputs (v10 / v8 / v6) | the production export at 2026-01-01 (embed_model.json, fit through 2025-12-13); recipe = each frozen package's own rule for any fight dated 2024 or later (fold-honest coef_fh["2024"], fit 2019-2023); 39 of 746 sides (34 fighters) lack a 2026-01-01 vector and get embed.js's zero vector | no recipe fit through 2025 exists (deviation 3) |
| props (v10 / v7 and the props-pool benchmark) | market_vault's consensus method6 (BFO pre-fight method props); props pool benchmark = src/ml/propspool.js with props.json production parameters (fit 2021-2025) | audit 1: the consensus agrees with the pool's own per-book consensus to 0.0036 on 2024-25 |
| v6 extra inputs | durability walk-forward records of durability_vault.json (fit through 2023) + the train NORM, SOS pairs with the 2019-2023 coefficients (audit 1's build) | as audit 1 (deviation 4) |

Production files the auditor refused because their fit reaches 2026, and what replaced them: methodround.json js_model (through
2026-10) -> S_refit / SM_refit; durability.json's live fit (2008..2026-10) -> the vault walk-forward records; the live rosters
(fighters.json, priors.json, ratings.json, ml.json) -> never read (sides come from backtest_vault.json). v4's EM judging weights (fit on
cards through 2026-10) cannot be replaced without a new version: reported as an exposure (section 10).

Packages (tools/vault_audit2/harness_vault.js = tools/predict_harness.js with 16 literal input substitutions, 300 simulations per corner
order, common random numbers seeded by fight id, kinds close / open / none, 0 failed fights). Each frozen directory was copied and only
two constants of its ml/blend.js were changed (the backtest guard's vault date and the stacker fit-through limit 2023-12-31 ->
2025-12-31); engine3.js, params3.js and every other ml/ file are byte-identical (`<vault>/audit2/pkgs/manifest.json`).

| package | frozen files | winner | method x round cells |
|---|---|---|---|
| cmp4 (the v4 package) | versions/v7-gate-failed engine with params.blend {winner 'stack', mrModel 'S', debut / statDist / props off} (simulator = v4's, tests/test_v7.js) | MoE expert stack by line regime, fit through 2025 (engine expert = its own simulator) | w x simulator + (1 - w) x S / SM (SM with the close) |
| v10 | versions/v10-rejected (= versions/v10) | ML v2 blend-head stack by regime, production weights | w x v10 simulator + (1 - w) x S2, then the props pool where the bout has props |
| v7 | composed from the v10 run exactly as tools/v10_gate.py's v10_simv4 variant (v10's winner and S2, cmp4's v4-simulator cells), props on and off | same as v10 | w x v4 simulator + (1 - w) x S2, props pool |
| v6 | versions/v6-rejected | same as v10 (identical inputs) | w x v6 simulator + (1 - w) x S2 |
| v8 (engine only) | versions/v8-gate-failed, every flag on, summarize | engine | engine |
| v4 engine | versions/v4, summarize (evalv) | engine | engine |
| shipped forward package (fwd-4.4 = fwd-4.3 models) | forward_models.json ml2_static weights (fit 2019-2023) on the production ML v2 logistic; any captured line goes to the open stack; no line -> the ML v2 no-line stack | as stated | - |

Wiring checks: cmp4's p recomputed from the stack, experts, line and its own simulator P(A) (max 6e-10 over 1,119 fight x regime rows);
v10 = v6 = v7 winner (0 difference); v8 engine rows = v10 engine rows (identical); v4 engine rows identical to audit 1's.

## 1. Headline (pre-registered, descriptive): open regime vs the opener

369 decisive fights, 38 cards, every fight with an opener (market_vault p_novig_open, multiplicative no-vig of BFO's opening line).

| model | log loss [95% CI] | Brier | accuracy | ECE | slope [95% CI] |
|---|---|---|---|---|---|
| opener | 0.6199 [0.5799, 0.6624] | 0.2142 | 0.663 | 0.039 | 0.99 [0.68, 1.35] |
| **cmp4 (v4 package), open** | **0.6213** [0.5737, 0.6727] | 0.2139 | 0.697 | 0.063 | **0.785** [0.553, 1.040] |
| **shipped forward package, open** | **0.6150** [0.5705, 0.6628] | 0.2116 | 0.683 | 0.028 | 0.875 [0.621, 1.157] |
| close (reference) | 0.6003 [0.5530, 0.6500] | 0.2055 | 0.715 | 0.049 | 0.96 [0.67, 1.30] |

| paired | difference [95% CI] | MC SE of bounds | clustered normal CI | Brier difference |
|---|---|---|---|---|
| cmp4 - opener | **+0.0014 [-0.0188, +0.0210]** | 0.0002 / 0.0002 | [-0.0187, +0.0216] (SE 0.0103) | -0.0004 [-0.0088, +0.0076] |
| forward package - opener | **-0.0048 [-0.0196, +0.0097]** | 0.0001 / 0.0002 | [-0.0198, +0.0101] (SE 0.0076) | -0.0026 [-0.0087, +0.0034] |
| cmp4 - forward package | +0.0063 [-0.0024, +0.0145] | | [-0.0024, +0.0149] | +0.0022 [-0.0013, +0.0056] |
| v10 (= v7 = v6) - cmp4 | -0.0033 [-0.0110, +0.0047] | 0.0001 / 0.0001 | [-0.0113, +0.0047] (SE 0.0041) | -0.0015 [-0.0046, +0.0017] |

Descriptive sensitivity (never the headline): without the 7 isolated BFO openers that audit 1's recomputation listed (two of them are
clear reversals), n 362: opener 0.6100, cmp4 0.6175 (+0.0075 [-0.0103, +0.0256]), forward package 0.6110 (+0.0010 [-0.0122, +0.0142]),
v10 - cmp4 -0.0029 [-0.0107, +0.0053]. The reading does not change: both packages are level with the opener.

## 2. Side lines vs cmp4, by regime (descriptive)

Winner rows: 369 decisive fights; cells rows: 372 fights with an outcome (draws in DEC); round given a finish: 207 finishes. v10 / v7
are scored as used (props pool where the bout has props: 371 of 373); "np" = props off. Columns: winner log loss, 7-bin, method (KO /
SUB / DEC), who x how x when (joint cell), round given a finish, method given the winner.

**Open regime** (levels: cmp4 0.6213 / 1.5755 / 0.9577 / 2.1513; v10 0.6180 / 1.5294 / 0.9255 / 2.1013)

| contrast | winner | 7-bin | method | joint | round given finish | method given winner |
|---|---|---|---|---|---|---|
| v10 - cmp4 | -0.0033 [-0.0110, +0.0047] | **-0.0461 [-0.0738, -0.0187]** | **-0.0322 [-0.0532, -0.0112]** | **-0.0500 [-0.0782, -0.0225]** | -0.0039 [-0.0076, -0.0002] | -0.0412 [-0.0656, -0.0175] |
| v10np - cmp4 | -0.0033 | -0.0117 [-0.0245, +0.0008] | -0.0047 [-0.0129, +0.0036] | -0.0156 [-0.0285, -0.0033] | -0.0037 [-0.0078, +0.0001] | -0.0072 [-0.0167, +0.0017] |
| v7 - cmp4 | -0.0033 | -0.0467 [-0.0746, -0.0190] | -0.0324 [-0.0536, -0.0114] | -0.0473 [-0.0752, -0.0194] | -0.0011 [-0.0025, +0.0002] | -0.0418 [-0.0664, -0.0179] |
| v7np - cmp4 | -0.0033 | -0.0132 [-0.0266, +0.0001] | -0.0054 [-0.0130, +0.0021] | -0.0137 [-0.0272, -0.0003] | -0.0009 [-0.0021, +0.0003] | -0.0091 [-0.0188, +0.0000] |
| v6 - cmp4 | -0.0033 | -0.0133 [-0.0309, +0.0050] | -0.0095 [-0.0190, -0.0000] | -0.0138 [-0.0345, +0.0082] | -0.0018 [-0.0103, +0.0070] | -0.0089 [-0.0220, +0.0042] |
| v10 - v10np (props pool) | 0 | -0.0344 [-0.0571, -0.0123] | -0.0276 [-0.0486, -0.0067] | -0.0344 [-0.0571, -0.0123] | -0.0001 | -0.0340 [-0.0569, -0.0119] |
| v10np - v7np (v10 vs v4 simulator cells) | 0 | +0.0015 [-0.0016, +0.0045] | +0.0007 [-0.0018, +0.0032] | -0.0019 [-0.0063, +0.0026] | -0.0029 [-0.0064, +0.0005] | +0.0019 [-0.0012, +0.0050] |

**No line** (levels: cmp4 0.6621 / 1.6160 / 0.9622; v10 0.6379 / 1.5493 / 0.9282)

| contrast | winner | 7-bin | method | joint |
|---|---|---|---|---|
| v10 - cmp4 | **-0.0242 [-0.0420, -0.0058]** | -0.0666 [-0.1007, -0.0326] | -0.0340 [-0.0551, -0.0128] | -0.0706 [-0.1055, -0.0359] |
| v10np - cmp4 | -0.0242 | -0.0324 [-0.0532, -0.0112] | -0.0058 [-0.0144, +0.0027] | -0.0364 [-0.0577, -0.0149] |
| v7 - cmp4 | -0.0242 | -0.0672 [-0.1016, -0.0328] | -0.0342 [-0.0555, -0.0130] | -0.0678 [-0.1023, -0.0333] |
| v6 - cmp4 | -0.0242 | -0.0340 [-0.0595, -0.0082] | -0.0109 [-0.0206, -0.0014] | -0.0346 [-0.0625, -0.0057] |

**Close** (levels: cmp4 0.6079 / 1.5630 / 0.9565; v10 0.6073 / 1.5189 / 0.9253)

| contrast | winner | 7-bin | method | joint |
|---|---|---|---|---|
| v10 - cmp4 | -0.0006 [-0.0058, +0.0048] | -0.0441 [-0.0703, -0.0184] | -0.0312 [-0.0524, -0.0101] | -0.0481 [-0.0747, -0.0218] |
| v10np - cmp4 | -0.0006 | -0.0099 [-0.0215, +0.0016] | -0.0038 [-0.0136, +0.0055] | -0.0138 [-0.0254, -0.0023] |
| v7 - cmp4 | -0.0006 | -0.0447 [-0.0710, -0.0188] | -0.0314 [-0.0526, -0.0102] | -0.0453 [-0.0715, -0.0193] |
| v6 - cmp4 | -0.0006 | -0.0114 [-0.0272, +0.0048] | -0.0084 [-0.0188, +0.0020] | -0.0120 [-0.0304, +0.0075] |

**Close + props** (370 fights with an outcome and method props, 367 decisive): v10 - cmp4 7-bin -0.0443 [-0.0705, -0.0183], method
-0.0315 [-0.0525, -0.0103], joint -0.0482 [-0.0748, -0.0217], winner -0.0002 [-0.0055, +0.0054]; v7 - cmp4 7-bin -0.0447 [-0.0711,
-0.0185]; props effect inside v10 (v10 - v10np) -0.0345 [-0.0570, -0.0124], inside v7 -0.0336 [-0.0560, -0.0117]. Soft CE vs the close
(a screen, never a metric): v10 +0.0011 [+0.0007, +0.0016] vs cmp4.

Both cmp4 and the props-off packages over-predict decisions (P(decision) 0.50 vs 0.443 actual); with the props pool v10 predicts 0.462.

## 3. Engines and stat lines: v10 / v8 vs v4 (the pre-registered stat-line secondary)

**10-stat harness** (tools/vault_audit2/stat_vault.js = tools/v10_stat_gate.js with vault inputs; arms of one engine file with common
random numbers, seed 10 as the v10 look; arm cmp4 = every v8 flag off = engine 4.0.0; scored with tools/v8_gate.py, 20,000 resamples,
smoothing prior from the gate's 2021-2023 train fights). v8's file gives rows identical to v10's.

| stat (Poisson deviance per fighter) | v4 level | v10 (= v8) - v4 [95% CI] |
|---|---|---|
| **total relative deviance** (mean over 10 stats, each / v4's mean) | | **-0.33% [-1.48%, +0.76%]** |
| sig landed | 24.35 | -0.015 [-0.556, +0.541] |
| sig attempts | 47.79 | +0.266 [-0.825, +1.326] |
| head landed | 19.16 | +0.061 [-0.368, +0.496] |
| body landed | 7.27 | -0.034 [-0.165, +0.097] |
| leg landed | 5.65 | +0.084 [-0.003, +0.170] |
| knockdowns | 0.738 | -0.0015 [-0.0153, +0.0123] |
| TD landed | 1.858 | -0.019 [-0.072, +0.031] |
| TD attempts | 2.994 | -0.064 [-0.188, +0.060] |
| control (s) | 147.2 | -2.51 [-6.52, +1.37] |
| sub attempts | 0.870 | -0.0003 [-0.0188, +0.0169] |

No deviance is worse (or better) with a CI excluding 0: **failure criterion (ii) not met** for v10 or v8. Mean absolute error: leg landed
+0.061 [+0.013, +0.110] and sub attempts +0.0086 [+0.0044, +0.0124] worse, control +1.73 s [-0.20, +3.59] n.s. 80% PIT coverage (v4 ->
v10): TD attempts 0.68 -> 0.80, TD landed 0.71 -> 0.77, control 0.77 -> 0.81, leg landed 0.77 -> 0.80, sig attempts 0.82 -> 0.84; every other stat within 0.02.

**evalv** (tools/vault_audit2/evalv_vault2.js, seed 1, 300 sims per order; its own 2,000-resample paired CIs) v10 - v4: winner +0.0017
[-0.0105, +0.0133]; 7-bin +0.0545 [+0.0183, +0.0944]; method +0.0065 [-0.0068, +0.0189]; deviance sig landed +0.034, attempts +0.216,
TD -0.042 [-0.091, +0.008], control -3.15 [-7.07, +0.68], KD +0.001 (all n.s.); per-minute control -4.88 [-8.23, -1.61]; KD MAE -0.0042
[-0.0075, -0.0012]. evalv_decide (descriptive): winner not worse; Holm family: 7-bin worse (rejected), nothing better; paired base-rate
test fails on KO.

Engine method side (cells, 372 fights): v10 engine - v4 engine: 7-bin +0.0544 [+0.0169, +0.0969], joint +0.0578 [+0.0146, +0.1059],
method given the winner +0.0164 [+0.0018, +0.0305]; v4 engine - S: joint +0.0684 [+0.0309, +0.1064].

## 4. Winner benchmarks (369 decisive fights)

| model | log loss [95% CI] | Brier | accuracy | slope [95% CI] |
|---|---|---|---|---|
| close (power de-vig) | 0.6003 [0.5530, 0.6500] | 0.2055 | 0.715 | 0.96 [0.67, 1.30] |
| methodround SM (close in the model; refit 2025) | 0.5979 | 0.2048 | 0.702 | 0.95 [0.69, 1.25] |
| ML v2 close stack, 2019-2023 weights (lr head) | 0.6042 | 0.2071 | 0.707 | 0.90 [0.64, 1.20] |
| ML v2 close stack, production (blend head = v10) / (lr head) | 0.6073 / 0.6076 | 0.2081 / 0.2083 | 0.702 / 0.688 | 0.84 / 0.84 |
| cmp4, close | 0.6079 | 0.2084 | 0.699 | 0.84 [0.59, 1.13] |
| forward package, close (open stack fed the close) | 0.6105 | 0.2093 | 0.683 | 0.81 [0.57, 1.08] |
| forward package, open | 0.6150 | 0.2116 | 0.683 | 0.87 [0.62, 1.16] |
| ML v2 open stack, production (blend / lr) | 0.6180 / 0.6181 | 0.2124 / 0.2125 | 0.675 / 0.672 | 0.80 / 0.81 |
| opener | 0.6199 | 0.2142 | 0.663 | 0.99 [0.68, 1.35] |
| cmp4, open | 0.6213 | 0.2139 | 0.697 | 0.785 [0.553, 1.040] |
| methodround S2 (production) / S (refit 2025) | 0.6221 / 0.6368 | 0.2161 / 0.2231 | 0.658 / 0.631 | 0.94 / 1.05 |
| ML v2 blend (production) | 0.6260 [0.5881, 0.6653] | 0.2173 | 0.664 | 0.93 [0.65, 1.23] |
| ML v2 logistic (production) | 0.6287 [0.5906, 0.6682] | 0.2187 | 0.640 | 0.90 [0.62, 1.20] |
| forward package, no line (ML v2 no-line stack, 2019-2023 weights) | 0.6356 | 0.2212 | 0.637 | 0.80 [0.53, 1.12] |
| ML v2 no-line stack, production (blend = v10 / lr) | 0.6379 / 0.6405 | 0.2208 / 0.2219 | 0.667 / 0.642 | 0.70 / 0.68 |
| engine v4 / v10 | 0.6429 / 0.6445 | 0.2259 / 0.2264 | 0.640 / 0.637 | 1.22 [0.84, 1.65] / 1.15 [0.79, 1.56] |
| cmp4, no line | 0.6621 [0.6015, 0.7245] | 0.2284 | 0.658 | 0.556 [0.370, 0.765] |
| Elo | 0.6868 [0.6716, 0.7025] | 0.2467 | 0.550 | 0.71 [0.19, 1.33] |

Paired: cmp4 close - close +0.0076 [-0.0005, +0.0159] and the ML v2 close stacks +0.0039 to +0.0074 (all n.s.: level with the market,
as audit 1 found); opener - close +0.0196 [-0.0020, +0.0422]; cmp4 no line - forward no line +0.0265 [+0.0048, +0.0476]; cmp4 no line -
ML v2 logistic +0.0334 [+0.0052, +0.0609]; ML v2 blend - logistic -0.0027 [-0.0070, +0.0017]; ML v2 logistic - Elo -0.0581 [-0.0933,
-0.0217]; engine v4 - close +0.0426 [+0.0025, +0.0815]; forward no line - close +0.0353 [+0.0123, +0.0587].

## 5. Method x round side line (S, S2, props pool, debut)

| model (cells as scored; 372 fights) | winner | 7-bin | method | joint | round given finish | method given winner |
|---|---|---|---|---|---|---|
| S (refit through 2025) | 0.6368 | 1.5896 | 0.9642 | 2.1620 | 1.0282 | 0.9204 |
| SM (refit through 2025) | 0.5979 | 1.5518 | 0.9571 | 2.1242 | 1.0280 | 0.9214 |
| S2 (production, fit 2012..2025) | 0.6221 | 1.5653 | 0.9536 | 2.1376 | 1.0280 | 0.9111 |
| S2 at the close winner | 0.6003 | 1.5436 | 0.9515 | 2.1160 | 1.0278 | 0.9111 |
| props pool at the close winner (370 with props) | 0.5976 | 1.5075 | 0.9250 | 2.0811 | 1.0291 | 0.8776 |
| cmp4 close / v10 close (package) | 0.6079 / 0.6073 | 1.5630 / 1.5189 | 0.9565 / 0.9253 | 2.1389 / 2.0908 | 1.0312 / 1.0276 | 0.9217 / 0.8795 |
| engine v4 / v10 | 0.6429 / 0.6445 | 1.6292 / 1.6836 | 0.9781 / 0.9846 | 2.2304 / 2.2881 | 1.0594 / 1.0485 | 0.9458 / 0.9622 |

Paired: S2 - S joint -0.0244 [-0.0488, -0.0001], method -0.0105 [-0.0212, -0.0003] (audit 1, S2 fit < 2024: -0.0277); props pool - S2 at
the same close winner 7-bin -0.0339 [-0.0562, -0.0116], method -0.0274 [-0.0493, -0.0054] (audit 1: -0.0324); cmp4 close - SM (25% of
the v4 simulator mixed in) joint +0.0146 [+0.0022, +0.0277], winner +0.0099 [+0.0003, +0.0192]; v10 close - props pool at the close
7-bin +0.0094 [-0.0008, +0.0204] n.s.

Who x how x when against model S (tools/methodround.py --score on the vault): v10 package -0.058 [-0.107, -0.011] open, -0.069 [-0.115,
-0.023] close, -0.039 [-0.086, +0.009] none; v7 open -0.056 [-0.104, -0.007]; v6 open -0.022 n.s.; cmp4 -0.008 / -0.021 / +0.032 (open /
close / none, n.s.); S2 -0.022 [-0.054, +0.007]; engines v4 +0.071 [+0.022, +0.114], v10 +0.128 [+0.053, +0.209].

**Debut method model** (debut bouts only; frozen debut.json f6709d52292ccc83, unchanged since audit 1): re-run with audit 1's tool, the
result is identical to audit 1's: 105 bouts, method given the winner 0.9737 vs division base rates 1.0761, -0.1024 [-0.1635, -0.0432].
These are seen fights.

## 6. Base rates vs actual (372 fights with an outcome)

| | actual 2026 | engine v4 | engine v10 | cmp4 open | v10 open (props) | v10np open | v7 open | v6 open | S | S2 | props pool at close |
|---|---|---|---|---|---|---|---|---|---|---|---|
| finish | 55.6% | 48.3% | 46.9% | 50.0% | 53.8% | 49.7% | 53.9% | 51.3% | 50.2% | 50.2% | 54.4% |
| KO / TKO | 38.4% | 31.0% | 29.0% | 32.6% | 35.5% | 32.3% | 35.6% | 34.0% | 33.1% | 33.1% | 36.3% |
| submission | 17.2% | 17.3% | 17.9% | 17.3% | 18.3% | 17.4% | 18.3% | 17.3% | 17.2% | 17.1% | 18.1% |
| decision (draws in) | 44.4% | 51.7% | 53.1% | 50.1% | 46.2% | 50.3% | 46.1% | 48.8% | 49.8% | 49.8% | 45.6% |
| finish R1 / R2 / R3, 3-rounders (n 330) | 31.2 / 15.5 / 8.2 | 24.8 / 14.4 / 9.0 | 24.2 / 14.1 / 8.7 | 25.7 / 15.9 / 8.1 | 27.7 / 17.2 / 8.6 | 25.6 / 15.9 / 8.0 | 27.7 / 17.2 / 8.6 | 27.2 / 15.6 / 8.2 | 25.8 / 16.4 / 7.7 | 25.8 / 16.4 / 7.7 | 28.0 / 17.7 / 8.3 |

Engine-only rates (evalv): KD per 100 head strikes 0.972 actual vs v4 0.783 / v10 0.804; UD / SD / MD 85.8 / 11.7 / 2.5% actual vs v4
78.9 / 20.7 / 0.4, v10 79.7 / 20.0 / 0.3; 10-8 share 3.61% vs 2.99 / 2.77%; sig landed per 15 min 58.24 vs 58.81 / 55.64; TD per 15
1.474 vs 1.351 / 1.404; control s per 15 min 167.0 vs 159.5 / 168.4. The pre-registered powered base-rate test (tools/evalv_decide.js
fixed_actual block, actual held fixed), v10 vs v4: **KO drifts** (drift_6_3 and drift_outside true: 29.0% vs v4 31.0% vs actual 38.4%,
further from the actual with a CI excluding 0); SUB, round-1 and round-3 shares, SD + MD, KD per 100 head, TD, control and sig landed
per 15: no drift. The paired sensitivity test agrees (KO only). Standard gloves all year; the glove-window amendment never applies to the
vault. KD / KO levels are seen-level descriptives (6.5.3 (a)).

## 7. Drift rule (6.5.1) state

- Rule (a): evaluated once, at audit 1, on the production no-line stack: 0.561 [0.380, 0.774], NOT TRIGGERED. Audit 2 has no rule-(a)
  trigger and changes no setting.
- Production no-line stack: unchanged since audit 1 (h 1.5 with its temperature; file hashes above).
- Rule (b): data/predictions/drift_monitor.json (built 10:54 am UTC Nov 7): trigger column `p_a_noline` (the ML v2 no-line stack from
  fwd-4.3), 0 forward rows, not fired; the tracked MoE no-line column likewise.
- Vault slopes of the no-line columns (descriptive): cmp4 0.556, ML v2 production stacks 0.684 (lr) / 0.697 (blend), the ledger's
  2019-2023 no-line stack 0.804 [0.531, 1.121].

## 8. Per-segment numbers (descriptive only; open regime, winner log loss)

| segment | fights | cmp4 - opener | forward - opener | v10 - cmp4 |
|---|---|---|---|---|
| 3-round | 331 | -0.0050 [-0.0273, +0.0166] | -0.0108 [-0.0265, +0.0047] | -0.0037 [-0.0112, +0.0041] |
| 5-round | 42 | +0.0519 [-0.0064, +0.1080] | +0.0413 [-0.0103, +0.0935] | -0.0008 [-0.0229, +0.0228] |
| women | 54 | -0.0625 [-0.1374, +0.0095] | -0.0524 [-0.1238, +0.0105] | +0.0067 [-0.0094, +0.0231] |
| men | 319 | +0.0122 [-0.0070, +0.0310] | +0.0031 [-0.0118, +0.0179] | -0.0050 [-0.0133, +0.0040] |
| opener favourite >= 70% | 121 | -0.0034 [-0.0423, +0.0317] | -0.0088 [-0.0419, +0.0198] | -0.0052 [-0.0154, +0.0053] |
| opener favourite < 70% | 252 | +0.0038 [-0.0188, +0.0265] | -0.0029 [-0.0201, +0.0139] | -0.0024 [-0.0120, +0.0076] |

## 9. Failure criteria, stated in advance (reported; no decision under `if_v4_stays`)

| package | (i) open winner CI upper > +0.002 | (ii) any stat-line deviance worse, CI excluding 0 | (iii) slope outside [0.8, 1.6] |
|---|---|---|---|
| cmp4 vs the opener | **met** (upper +0.0210) | n/a (cmp4's simulator is the v4 reference) | **met** (0.785) |
| forward package vs the opener | **met** (upper +0.0097) | n/a | not met (0.875) |
| v10 vs cmp4 | **met** (upper +0.0047) | not met (no stat) | not met (0.8003) |
| v7 vs cmp4 | **met** (same winner) | not pre-registered (v4 simulator) | not met (0.8003) |
| v6 vs cmp4 | **met** (same winner) | not pre-registered | not met (0.8003) |
| v8 engine vs v4 engine | (engine winner +0.0017 [-0.0105, +0.0140]) | not met | not met (1.146) |

Criterion (i) is met everywhere because the vault cannot resolve a 0.002 bound (paired SE 0.004-0.010); none of the point estimates is
worse than its comparator by more than +0.0014.

## 10. Not clean on the vault, and the exposure list (rule 6.5.2; pre-registered list attached)

**Chosen because of audit 1:** nothing in v10 (pre-registered: the v10 gate protocol, branch 4.2). fwd-4.3's no-line primary (the ML v2
no-line stack, the forward package's no-line column here) was decided after audit 1 showed the MoE no-line stack losing to it: **not
clean on the vault**; its clean test is the forward ledger.

**Seen on the vault in audit 1** (their audit-2 numbers repeat audit 1's fights): the v4 engine (identical rows), the props pool and the
debut method model (identical result), S / S2 (S2 now the production fit), the ML v2 frozen stacks and logistic, the close and the
opener, the production no-line stack.

**Not clean (judging fit on vault cards):** method, 7-bin, joint and SD + MD numbers of every package or engine on v4's simulator (cmp4,
v10, v7, v8, the v4 engine) use v4's EM judging weights fit on ufcstats cards through 2026-10.

**Exposures attached** (V6_V10_PLAN 6.5.3 and the audit-2 pre-registration):
1. methodround's committed note printed 2026 rows for S and SM (n 372), and methodround.json held S / SM / S_refit / SM_refit cells for
   every vault fight before the seal (cmp4's cells are these S_refit / SM_refit).
2. The durability note gave the 2026 KD level and KO share.
3. preufc ran three evaluations pooled over 2024-2026.
4. The first market and ML builds scored 2024-2026, including the Kalshi check.
5. styles' 2024+ window ran through 2026-10.
6. The Nov 7 durability / styles cleanup: 2026 KD-level series, KO share, observed / expected and walk-forward vault records sat in the
   repo for about 17 hours and were read by later agents; KD / KO / durability results on the vault are seen-level for every version.
7. v4's all-cards EM judging weights (through 2026-10).
8. Audit 1 itself (same 373 fights; every audit-1 number was visible to the v6-v10 builders), and audit 1's additional items: oppadj.json
   walk-forward vault snapshots (used here for the v10 / v8 retarget targets), preufc.json snapshots dated through 2026-10 (used by v6's
   newcomer component), fightweek.json 2026 rows, live tables through Oct 31, 2026, and data/raw holding every 2026 result and line.

## Deviations and caveats

1. **Sample size.** 369 decisive fights on 38 cards: winner log-loss intervals about +-0.05, paired about +-0.008 (package vs package)
   to +-0.02 (package vs the opener). Every winner comparison here is underpowered; the cells comparisons with the props pool are not.
2. **cmp4's stacker rows for 2024-2025.** "Extended to 2025" combines the per-year recipe (engine expert = the v4 simulator's
   fold-honest evalv rows) with the production export's 2024-2025 row assembly (the blind replay's walk-forward expert rows). The
   2024-2025 engine rows came from a DEV evalv run of the v7 engine on 2024-25 (outputs outside the repo; identical to v4's stored rows);
   their 2024-25 scores were not used.
3. **Embeddings.** The walk-forward snapshots (embed.json) stop before 2026, so every 2026 bout uses the production export at
   2026-01-01 without in-year updates (as audit 1 did for v5); 39 of 746 sides (34 fighters) have no 2026-01-01 vector (zero vector). The blend recipe
   is each frozen package's own rule for fights from 2024 on (fit through 2023); no recipe fit through 2025 exists, and none was fit.
4. **v6.** Its durability inputs are the vault walk-forward records fit through 2023 (no through-2025 records exist) with the train NORM,
   and its SOS pairs use the 2019-2023 coefficients, both as audit 1 ran v5; v6 is a descriptive side line.
5. **v7 is composed, not run.** v7's package = v10's winner and S2 cells with the v4 simulator's cells (tools/v10_gate.py's
   v10_simv4 variant; the v10 gate's wiring checks show v10's winner = v7's ml2stack rows and cmp4 = v7's gate cmp4). Its w and pi are
   refit on 2019-2025 like the others. v7's frozen params carry w 0.15 / pi 0.47 (fit through 2023).
6. **Props.** Per-book 2026 props are not in the repository: the packages and the props-pool benchmark read market_vault's consensus
   method6 (as audit 1).
7. **Stat-line targets.** The 2026 inputs of the statlines table (learned rates, etas, win logit, oppadj factors) are the production
   analogues of the 2024-25 inputs; the statlines `prod` table is the deployment refit through 2025. On the live path the v10 package's
   stat-line components never run (prewarning), so these numbers describe the backtest harness only.
8. **v8 at engine level.** v8 and v10 give identical engine rows (v10 = the v4 simulator + v8's bundle as shipped), so the v8 side line
   equals v10's engine line.
9. **Two seeds.** evalv runs use seed 1, the 10-stat harness seed 10 (as the v10 look), the package harness seeds by fight id; stat-line
   numbers therefore differ slightly between section 3's two blocks.
10. **Not run.** A card-by-card walk-forward inside 2026 (not applicable: no per-card refit was kept). Nothing was fetched from the web.

## Reproduce

Every number comes from `<vault>/audit2/score_vault2.json` (sha256_16 18bbd94754fb2621), written by `bash tools/vault_audit2/run_all.sh`
(about 4 minutes on 3 workers at nice 5). `<vault>` = /tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/vault
(outside the repo; every per-fight vault output stays there). Steps, in order: ml2s2_vault.py, targets_vault.js, evalv_vault2.js
(dev2425, v7), cmp_stack_2025.py, harness_vault.js (v10, cmp4, v6), evalv_vault2.js (vault: v4, v10, v8), stat_vault.js (v10, v8),
decide_vault.js, aux_vault.js, audit 1's debut_vault.py into a scratch root, score_vault2.py.

Tool hashes (sha256, first 16): tools/vault_audit2/ ml2s2_vault.py da7e8e53bd7c39c9, targets_vault.js 1a84ed36a63aad96, evalv_vault2.js
fd63505e0c2db380, cmp_stack_2025.py f5b961cf7182c92f, harness_vault.js 5fabb36674a36177, predictrec_vault.js 285c6b65297e6374,
mlpathrec_vault.js c1df7692a56409f6, stat_vault.js 230c9e29356b572e, decide_vault.js 791a73e971d8c0c2, aux_vault.js 28f97fac00d356ea,
score_vault2.py 83b009c349143dce; wrapped tools: predict_harness.js f1c3c16e94d81ec3, evalv.js 568682718bf9fef1, v10_stat_gate.js
e04f8f60f7aacb70, evalv_decide.js 31a31a1c69a01faf, blindtest.py 523b41db1c6690f5, predict_score.py f72bc230ed46c26d, v7_gate.py
09fb338e2ca780ea, v8_gate.py 455c18f7423a1cd6, v10_gate.py 9acc2f6abac84e85. Inputs: backtest_vault 747e6ff5d28def51, market_vault
2620efc2c5bcbab3, durability_vault 464fcffae24f6b90, preufc_vault 42272a6088451302 (all equal to audit 1's); cmp_stack_v4pkg_fit2025
8e11112a47cc81a7, ml2s2_vault 1f02401761b6e61d, statlines_targets_vault 86fed2aa6f7b04ed, harness_vault d3611ad91dfb87d9; repo files
v6_stacks 44130c57c22196f6, mr_s2 a308dd8e891aa8bc, methodround b26b7e373367f346, props 6870d44c20cc2e99, statlines 30c3a959a1a3ac2a,
ml2_trees a732f9f6f6cd84d5, ml2 0837826dbc05cd1f, forward_models 20269ec7642c1db8, blindtest 3c319b769aed309b. The full list is
score_vault2.json `inputs_sha256_16`.
