# Debut path: a dedicated model for UFC bouts with a debutant

Nov 6, 2026. Tool: `tools/debut.py`. Output: `data/derived/debut.json`. JS evaluator: `src/ml/debut.js`.
Ledger hook: `tools/forward_ledger.js --debut-model data/derived/debut.json` (off by default).
Test: `tests/test_debut.js`. Blind-test plugin: `tools/blindtest_plugins/debut.py`.
Data: ufcstats snapshot through Oct 31, 2026 (2026 rows dropped at parse); Sherdog fighter pages
(robots.txt allows all agents; User-Agent `FightLabSim/1.0`; at least 2 s between requests). Raw pages are cached in
`data/raw/sherdog_cache/` (tools/preufc.py's cache, read only) and `data/raw/debut_cache/` (gitignored).

## Bottom line

- **The debut universe.**
  - 1,443 UFC bouts from 2012 to 2025 in which at least one man had 0 prior UFC bouts.
  - 1,414 are decisive and 285 have two debutants. 1,371 have a closing line.
  - The CV years 2019-2023 hold 502 decisive bouts. The single look at 2024-25 holds 172.
- **Winner without a line: big gain in CV, not confirmed by the look.**
  - Forward-chained CV chose a 16-column symmetric logistic. Its columns are a global network rating over every
    Sherdog pro bout, the promotion level, replacement / short-notice / missed-weight flags, the amateur record,
    and the UFC record.
  - CV 2019-2023: **0.6143 vs seeded Elo 0.6683, -0.054 [-0.085, -0.023]** (seeded Elo is the ledger's current
    no-line fallback). Against plain Elo the change is -0.060.
  - About 0.005 of that is selection optimism: with nested selection (blocks, C and tau chosen only on years before
    each scored year) the CV gain is -0.049 [-0.082, -0.016] (verifier, `tools/debut_verify.py cv --nested`).
  - The single 2024-25 look: **0.6402 vs 0.6371, +0.003 [-0.043, +0.049]**, so not confirmed. It led in 2024
    (0.659 vs 0.663) and trailed in 2025 (0.622 vs 0.612).
  - Pooled 2019-2025 (674 bouts; a planning number, never a selection input): -0.039 [-0.066, -0.013]; -0.037
    [-0.063, -0.011] with nested selection.
  - Part of the shortfall is the reference: seeded Elo beat plain Elo by only 0.006 in the CV years but by 0.036 on
    the look. Against plain Elo the debut model is -0.060 in CV and -0.033 [-0.080, +0.012] on the look.
- **With a line, the market stays.**
  - CV admitted the stack [open, debut] (-0.021; robust: -0.018 nested, -0.020 on the verifier's rebuilt network).
  - [close, debut] passed the 0.0005 rule by a hair (-0.0008) as built, but the admission does not survive nested
    selection (+0.0004) or the verifier's independent network rebuild (-0.0004). Read it as rejected.
  - Both stacks fail the plan's CV non-inferiority bound (stack vs line CI upper < +0.001): open +0.003, close +0.010.
  - On the look both are worse than the line alone, and neither difference is significant:
    - open: +0.018 [-0.012, +0.047];
    - close: +0.006 [-0.008, +0.021].
  - The debut model is 0.076 behind the close on 2024-25.
- **How it ends: confirmed.** P(KO / SUB / DEC | winner) beats the division base rates the ledger uses today.

  | metric | CV 2019-2023 (498 bouts) | 2024-25 look (171 bouts) |
  |---|---|---|
  | method given the winner | -0.035 [-0.060, -0.009] | -0.084 [-0.128, -0.040] |
  | method3 (marginal KO / SUB / DEC) | -0.021 [-0.042, +0.002] | **-0.045 [-0.075, -0.017]** |
  | who x how (6 cells) vs the fallback | -0.090 [-0.133, -0.047] | -0.079 [-0.147, -0.014] |

  The fallback in the last row is seeded Elo x division base rates.
- **Decision** (rule corrected by the verifier; the outcome is unchanged). The CV gate decides and the pre-registered
  look can only confirm, with the "not worse" bounds of docs/V6_V10_PLAN.md 6.3 / 7.1.
  - Adopt the debut method model for debut bouts, in place of division base rates. It is fed the ledger's own
    winner probability. CV passes on method given the winner (-0.035 [-0.060, -0.009]); in the adopted setup, with
    the ledger's line fed in, CV also passes on method3 (-0.025 [-0.049, -0.002]). The look confirms.
  - Keep the line, and seeded Elo without a line, for the winner. The no-line model passed CV but the look did not
    confirm it. Both line stacks fail the plan's CV non-inferiority bound, and the close stack fails the robust
    0.0005 rule too.
  - Log the debut model's winner probability as a candidate.
  - `data/derived/debut.json` `model.adoption` records this, and the JS `adopted` block follows it.
  - The builder's first adoption code keyed the method on the look's method3 CI. That was a pre-registered
    secondary ("never decisive"), so it was selection on 2024-25. The verifier re-keyed it on CV.
- **Replacement status is the largest raw gap, but it is not the model's largest signal.**
  - In 2012-2023, in the 398 bouts where exactly one man was a late replacement, the replacement won 28.1%.
    The close gave him 34.3%. In 2024-25: 30.6% won against 34.3% priced (49 bouts).
  - 25.8% of debutants were replacements, against 5.3% of veterans.
  - Inside the model, dropping one column costs this much CV log loss:
    - network rating +0.013, promotion level +0.009, amateur win log-odds +0.008, debut flag +0.006;
    - missed weight +0.0045, replacement +0.004.
  - The flag is public before the bout, so it is not a leak. It is parsed from the current revision of each event's
    Wikipedia article, though. Whether that prose is complete regardless of the outcome cannot be tested.
  - The ledger has to capture it live (`flags_a` / `flags_b`); today's card files carry it only as notice text.
- **What I would not claim.**
  - The look is not clean: tools/preufc.py had already scored seeded Elo on these same 172 bouts.
  - The one-hop opponent pages are not in this model (see Open threads).
  - 172 bouts give a winner CI of about ±0.046, so the look can neither confirm nor rule out a gain of the CV size
    shrunk toward zero.

## Data

**Universe.** Every ufcstats bout dated 2012-01-01 to 2025-12-31 in which a man had 0 prior UFC bouts:

| year | 2012 | 2013 | 2014 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| decisive debut bouts | 83 | 107 | 164 | 81 | 102 | 102 | 101 | 118 | 101 | 82 | 87 | 114 | 84 | 88 |

- **Bouts dated 2026 or later are dropped right after parsing.** `load_universe_strict` wraps
  build_db.parse_fights, and the build asserts the frame has no 2026 date.
- **Every one of the 1,728 debutants has a verified Sherdog page.**
  - tools/preufc.py resolved the 2015+ debutants. This tool's crawl resolved the 197 that preufc had not resolved
    (mostly the 2012-2014 debutants), with preufc's resolver and verification rule.
  - 1,777 pages are parsed in all: the debutants plus 49 roster veterans.

**Per-side inputs.** Every input is walk-forward: dated strictly before the bout.
- UFC walk-forward stats and Elo come from tools/preufc.py ufc_walk and EloRunner (K 44, boost 1.5).
- The pre-UFC snapshot uses preufc's snapshot_feats, StrictNetwork and side_pre. It counts only when the page is
  known at the bout: for debutants, and for men who debuted in 2012 or later. The 49 survivor pages are never used.
- The amateur record and pro exhibitions (TUF) come from the Sherdog page.
- Replacement, short notice (21 days or less), missed weight and catchweight come from data/derived/fightweek.json.
  These are pre-fight facts from Wikipedia event pages.
- The weight-class move is the sign of the change from the previous UFC bout's division.
- Lines are the close (power de-vig) and the open (multiplicative de-vig), assembled by tools/market.py.

## The global network rating

- **The bouts.** Every pro bout I hold: 8,405 UFC bouts (ufcstats) and 23,745 non-UFC rows from the debutants'
  Sherdog pages, deduplicated across pages, for 32,150 in all. Opponents are identified by Sherdog id, so a
  regional opponent who later reached the UFC is one node.
- **When a page counts.** A page enters a fit only from its owner's UFC debut date.
  - The set of debutants' pages is complete, and that set is chosen by facts known at the time.
  - A regional opponent therefore enters through every debutant he fought, but his own later UFC career leaks
    nothing.
- **The model.** Bradley-Terry in logit units, a MAP fit at each Jan 1 cutoff C on the bouts before C.
  - Exponential time decay with half-life h: 2 or 4 years, chosen by CV.
  - Fighter prior: theta ~ N(m_i, 1). m_i is the decayed mean of his promotions' strengths.
  - Promotion strength: mu_g ~ N(0, 2).
  - This is how opponent quality propagates: through shared opponents and through the promotion levels.
- **Rating a fighter at a bout.** A one-fighter MAP over his own rows before the bout date, with opponents rated in
  the Jan 1 fit.
  - Outputs: theta (`g<h>_th`), its posterior sd (`g<h>_sd`), the decayed mean opponent rating (`g<h>_sos`) and
    the prior mean, which is his promotion level (`g<h>_m`).
  - A fit takes about 1.7 s, once BLAS threads are pinned to 1 on the shared box. At C = 2023-01-01 a fit holds
    25,602 decisive bouts.

Promotion strengths at the 2026-01-01 fit (h 4; promotions with at least 150 bouts; `debut.json promotions["4.0"]`):

| promotion | mu | promotion | mu |
|---|---|---|---|
| UFC | 4.18 | Fury FC | 0.76 |
| PFL/WSOF | 2.95 | Cage Warriors | 0.67 |
| ACA | 2.53 | DWCS | 0.64 |
| Bellator | 2.07 | Ring of Combat | 0.43 |
| Rizin | 1.98 | LFA | 0.37 |
| KSW | 1.69 | Titan FC | 0.29 |
| M-1 | 1.49 | Pancrase | 0.05 |
| Brave CF | 1.46 | Jungle Fight | -0.22 |
| Invicta FC | 0.82 | KOTC | -0.70 |

- preufc's alias table splits "BFC | Bellator Fighting Championships" (1.13) from "Bellator" (2.07).
- DWCS sits mid-table because both men in a DWCS bout are prospects. The DWCS win itself enters through the record.

## Forward-chained CV (2019-2023; each year Y fit on 2012..Y-1)

- **The model.** `DebutLR`: a symmetric no-intercept logistic on side differences, preufc.DiffModel's
  construction.
  - Side columns are centred at the training mean; an unknown value enters at the mean.
  - Pre-UFC columns are faded by exp(-n_UFC / tau).
  - The difference A - B is scaled by its training sd.
  - The swap test gives max |p(A,B) + p(B,A) - 1| = 2.2e-16.
- **Greedy block selection.** It starts from core (Elo, debut flag).
  - Each step adds the block with the best pooled CV log loss, with C and tau tuned per candidate.
  - A block enters only if it gains more than 0.0005 (ml2's rule).

| step | pooled CV log loss | ufc | bio | pre | gnet2 | gnet4 | promo2 | promo4 | extra | opp1h |
|---|---|---|---|---|---|---|---|---|---|---|
| core (Elo, debut flag) | 0.66702 | 0.66274 | 0.66566 | 0.65118 | 0.66233 | 0.65536 | 0.66751 | 0.66743 | **0.63613** | 0.66702 |
| + extra | 0.63613 | 0.63350 | 0.63584 | 0.63353 | 0.63442 | **0.63088** | 0.63740 | 0.63795 | | 0.63613 |
| + gnet4 | 0.63088 | 0.62315 | 0.62971 | 0.63170 | | | **0.61653** | 0.61897 | | 0.63088 |
| + promo2 | 0.61653 | **0.61430** | 0.61914 | 0.62841 | | | | | | 0.61653 |
| + ufc (chosen; C 1.0, tau 2) | **0.61430** | | 0.61676 | 0.62552 | | | | | | 0.61430 (stop) |

Every block at once scores 0.62807.

The blocks:
- **extra:** amateur fights and amateur win log-odds, TUF exhibitions, replacement, short notice, missed weight.
- **gnet:** network rating, opponent strength, rating sd.
- **promo:** promotion level.
- **ufc:** UFC fights, win log-odds, finish-win and finished-loss rates.
- **bio:** age, layoff, weight-class move.
- **pre:** preufc's 11-feature core block.
- **opp1h:** one-hop opponent records. These are empty, because no one-hop page was available to the frozen build.

preufc's pre-UFC block helps on its own (0.651 against core's 0.667), but adds nothing once the network rating
and the promotion level are in. The network carries the same record against rated opposition.

**Raw-scale coefficients (fit on 2012-2023).**
- Columns:
  - Elo/100 +0.54; debut -0.69;
  - amateur fights (log) -0.26; amateur win log-odds +0.45; TUF -0.08;
  - short notice -0.20; replacement -0.62; missed weight -0.63;
  - network rating +0.89; opponent strength +0.21; rating sd +0.09; promotion level (h 2) -0.75;
  - UFC fights (log) -0.09; UFC win log-odds -0.29; UFC finish-win rate -0.10; UFC finished-loss rate -1.55.
- **How to read the network terms.** The rating already contains its prior mean (the promotion level). So the pair
  reads as +0.14 x the promotion level, plus +0.89 x performance above it.
- **Both parts are monotone in the raw data.** Debutants facing veterans, 2012-2023:
  - by promotion-level tercile, they win 39.6%, 40.1% and 48.2%;
  - by tercile of rating minus level, they win 36.5%, 41.9% and 49.4%.

CV against the references, on the same rows (paired, 2,000 card resamples):

| comparison | n | debut model | reference | difference |
|---|---|---|---|---|
| vs plain Elo | 502 | 0.61430 | 0.67386 | -0.0596 [-0.0882, -0.0299] |
| vs seeded Elo (ledger no-line fallback) | 502 | 0.61430 | 0.66829 | **-0.0540 [-0.0846, -0.0228]** |
| vs the open | 496 | 0.61246 | 0.62938 | -0.0169 [-0.0461, +0.0118] |
| vs the close | 500 | 0.61299 | 0.57085 | +0.0421 [+0.0112, +0.0730] |

**By year**, debut model vs seeded Elo:

| year | n | debut model | seeded Elo |
|---|---|---|---|
| 2019 | 118 | 0.641 | 0.729 |
| 2020 | 101 | 0.620 | 0.618 |
| 2021 | 82 | 0.626 | 0.684 |
| 2022 | 87 | 0.552 | 0.651 |
| 2023 | 114 | 0.621 | 0.652 |

**By segment**, vs seeded Elo:

| segment | n | difference |
|---|---|---|
| debutant vs veteran | 438 | -0.054 [-0.089, -0.021] |
| two debutants | 64 | -0.053 [-0.131, +0.020] |
| a replacement in the bout | 180 | -0.092 [-0.152, -0.030] |
| no replacement | 322 | -0.033 [-0.068, +0.002] |
| debutant vs a man with 1-3 UFC fights | 241 | -0.080 [-0.126, -0.029] |
| debutant vs a man with 4+ UFC fights | 197 | -0.022 [-0.066, +0.027] |

**Calibration slopes in CV** (both orders pooled; 1 = calibrated):

| model | slope [95% CI] |
|---|---|
| debut model | 0.93 [0.71, 1.19] |
| seeded Elo | 0.78 [0.49, 1.11] |
| close | 1.19 [0.97, 1.43] |

## Stack gate (forward-chained 2021-2023, weights fit on 2019..Y-1 out-of-fold rows)

The stacker is tools/ml2.py's stack_fit, copied verbatim: non-negative logit weights, no intercept, pclip 0.01.

| regime | n | candidates (2021-23 log loss) | decision |
|---|---|---|---|
| no line | 283 | raw debut 0.60103; stack debut 0.60317; stack debut + seeded Elo 0.60475; raw seeded Elo 0.66110 | raw debut model |
| open | 279 | raw open 0.61587; stack open 0.61690; **stack open + debut 0.59458** | debut admitted (-0.0213) |
| close | 282 | raw close 0.55149; stack close 0.54907; **stack close + debut 0.54830** | debut admitted (-0.00077) |

- The close admission is marginal: 0.0008 against a 0.0005 threshold. It is not robust (verifier):
  - The block selection read these same 2021-23 rows. With nested selection the close stack scores 0.54949, a gain of
    +0.0004, so it is rejected.
  - On the verifier's independently rebuilt network columns it scores 0.54863, a gain of -0.0004, also rejected.
  - [open, debut] stays admitted in both runs: -0.0176 nested, -0.0200 on the rebuilt network.
- The plan's non-inferiority check fails, because the CI is wide. That check asks for the paired CI upper bound of
  stack vs raw line to be at most +0.001:
  - close: -0.0032 [-0.0155, +0.0105];
  - open: -0.0213 [-0.0470, +0.0028].

## How it ends: P(KO / SUB / DEC | winner)

- **The model.** A multinomial logit from the winner's point of view, so no corner ordering enters:
  softmax_m(log base_m(division) + a_m + z . b_m), with DEC as the reference.
- **The base rates** come from division shares in the five years before the bout year, shrunk to the league with
  20 pseudo-bouts. They are both the offset and the fallback the ledger uses today.
- **The 14 features:**
  - the winner's pre-UFC KO and submission win rates, and his UFC KO and submission win rates;
  - the loser's pre-UFC KO and submission loss rates, and his UFC KO and submission loss rates;
  - |logit P(win)| (the mismatch); 5 rounds; division weight; women; the debut flags of both men.
  - The pre-UFC rates are faded by exp(-n_UFC / 4) and used only when the page is known at the bout.
- **The winner probability fed in** is the debut model's annual out-of-sample prediction from 2013 (Elo for 2012).
- **Lambda** was chosen by CV from 1 / 10 / 30 / 100 / 300: method3 1.00102 / 1.00024 / **1.00019** / 1.00275 /
  1.00896, so lambda 30.

| metric (CV 2019-2023, 498 bouts) | model | division base | difference |
|---|---|---|---|
| method3 (marginal) | 1.00019 | 1.02110 | -0.0209 [-0.0415, +0.0020] |
| method given the winner | 0.98591 | 1.02110 | **-0.0352 [-0.0603, -0.0091]** |
| who x how (6 cells) vs seeded Elo x base | 1.59902 | 1.68886 | -0.0898 [-0.1329, -0.0466] |

## The single 2024-25 look

The pre-registration was committed at 8c17161, before the look: the choices above, annual walk-forward fits, and
the primary metric (no-line winner vs seeded Elo). The look ran once (`out/debut_cache/holdout.done`); the tool
refuses a second run.

| model (172 decisive bouts) | log loss [95% CI] | accuracy | Brier |
|---|---|---|---|
| debut model (annual walk-forward) | 0.6402 [0.5848, 0.6917] | 65.7% | 0.2230 |
| debut model, static fit through 2023 | 0.6390 [0.5826, 0.6906] | 65.7% | 0.2223 |
| seeded Elo (the ledger's no-line fallback) | 0.6371 [0.5965, 0.6756] | 63.4% | 0.2230 |
| plain Elo | 0.6728 [0.6511, 0.6928] | 57.6% | 0.2400 |
| open (171) | 0.5856 [0.5370, 0.6358] | 69.6% | 0.1997 |
| close (171) | 0.5667 [0.5118, 0.6241] | 71.9% | 0.1924 |
| current fallback: the close when there is one, else seeded Elo | 0.5675 [0.5132, 0.6246] | 71.5% | 0.1927 |

| paired comparison (2024-25) | difference [95% CI] |
|---|---|
| **debut model vs seeded Elo (primary)** | **+0.0032 [-0.0432, +0.0492]** |
| debut model vs plain Elo | -0.0325 [-0.0767, +0.0118] |
| seeded Elo vs plain Elo | -0.0357 [-0.0641, -0.0071] |
| debut model vs open / close | +0.0570 [+0.0056, +0.1094] / +0.0760 [+0.0182, +0.1292] |
| stack [open, debut] vs open | +0.0175 [-0.0125, +0.0472] |
| stack [close, debut] vs close | +0.0059 [-0.0083, +0.0206] |
| stack [debut, seeded Elo] vs debut (not chosen by CV; descriptive) | -0.0056 [-0.0113, +0.0002] |
| CV-frozen production path with a line vs the current fallback | +0.0031 [-0.0124, +0.0182] |

| method (171 bouts) | debut method | fallback | difference |
|---|---|---|---|
| method3 (marginal) | 0.98791 | 1.03299 | **-0.0451 [-0.0751, -0.0173]** |
| method given the winner | 0.94939 | 1.03299 | -0.0836 [-0.1279, -0.0399] |
| who x how vs seeded Elo x division base | 1.58902 | 1.66789 | -0.0789 [-0.1467, -0.0135] |

Calibration slopes on 2024-25 (both orders pooled; 1 = calibrated):

| model | slope [95% CI] | reading |
|---|---|---|
| debut model | 0.81 [0.49, 1.27] | leans overconfident, unlike the CV years' 0.93 |
| seeded Elo | 1.17 [0.70, 1.76] | |
| close | 1.04 [0.72, 1.40] | |

The stacks' 2024 / 2025 weights:
- [open, debut]: 0.48 / 0.69 and 0.71 / 0.54;
- [close, debut]: 0.99 / 0.31 and 1.05 / 0.23.

## Decision and recommendation

The rule (corrected by the verifier; same outcome):
- **The CV gate decides.** It is the plan's cycle-5 acceptance test on forward-chained 2019-2023:
  - no line: the CI against seeded Elo excludes 0;
  - with a line: ml2's 0.0005 rule, and the stack-vs-line CI upper bound below +0.001;
  - method: the CI against division base rates excludes 0 (method given the winner).
- **The single look only confirms**, with the "not worse" bounds of docs/V6_V10_PLAN.md 6.3 / 7.1: winner CI upper
  bound at most +0.002, method at most +0.003.
- **History.** The pre-registration did not state a decision rule. The builder's first adoption code keyed the method
  on the look's method3 CI, a pre-registered secondary that was "never decisive", and so selected on 2024-25. The
  verifier moved the decision to CV (`tools/debut.py` export, `model.adoption.rule`). Every outcome is unchanged.

- **Winner without a line:** keep seeded Elo. CV passed (-0.054, nested -0.049), but the look did not confirm: its
  upper bound is +0.049.
  - The project precedent is the same: linemove's B3 passed the CV rule, was not confirmed, and was not adopted.
  - The debut model is logged as a candidate in the ledger's `debut_path` block.
  - The pooled 2019-2025 number (-0.039 [-0.066, -0.013]; nested -0.037 [-0.063, -0.011]) is the planning figure if
    the forward ledger, or a debut-inclusive vault, later gets to decide.
- **Winner with a line:** keep the line, open or close.
  - Both stacks fail the CV non-inferiority bound: open +0.003, close +0.010.
  - The close stack also fails the robust 0.0005 rule.
  - Both were worse on the look, though neither difference is significant.
- **Method:** adopt the debut method model for bouts with a debutant, replacing the division base rates. It is fed
  the ledger's adopted winner probability (the close, else the open, else seeded Elo).
  - CV, as built: method given the winner -0.035 [-0.060, -0.009] passes. Method3 -0.021 [-0.042, +0.002] does not.
  - CV, as adopted (the ledger's winner probability fed in; verifier, `tools/debut_verify.py method`):
    - method given the winner -0.033 [-0.059, -0.006];
    - method3 -0.025 [-0.049, -0.002].
  - The look confirms both setups (method given the winner -0.083 / -0.086; method3 -0.044 / -0.051, CIs excluding 0).
  - The only difference between the setups is the mismatch feature: CV fed it the debut model's winner probability,
    and the ledger feeds it the line.
  - The production refit computes the mismatch feature from in-sample winner predictions, not out-of-fold ones. The
    ledger replaces them with the line anyway.
- **Making it primary needs a new forward version.** fwd-4.1's pre-registration fixes its debut fallback, so a new
  version (fwd-6 or later) has to pre-register "debut method = tools/debut.py" before a lock. Its debut seeding of
  Elo stays as it is; there is one debut path, not two.

## Integration with the forward ledger

- **The function** is `src/ml/debut.js`: `DebutModel.load(debut.json.model)`.
  - `winner(sideA, sideB)`.
  - `method(sideA, sideB, {division, rounds, pA})`: P(method | each winner), the marginal, and who x how.
  - `predict(sideA, sideB, {division, rounds, p_close, p_open, p_seeded})`: the CV regimes plus an `adopted` block
    that follows `model.adoption`.
  - Side builders: `sideFromProfile` builds a veteran from data/derived/fighters.json, with the debut.json
    `roster_gnet` network columns as of 2026-01-01. `sideFromDebutant` builds a debutant from a
    data/predictions/debutants_*.json entry.
- **The ledger hook** is `node tools/forward_ledger.js input.json --debut-model data/derived/debut.json`.
  - A bout with a debutant gets `r.debut_path`, holding:
    - the debut model's P(a) by regime;
    - the adopted P(a), equal to the ledger's own seeded Elo or line;
    - the adopted method distribution;
    - the sides' sources and their unknown columns.
  - Without the flag, nothing changes. With it, every other output field is byte-identical; the test checks this.
  - Input bouts may carry `flags_a` / `flags_b` = {repl, short, miss, notice_days}. Otherwise the flags are read
    from the debutant entry's `bout.notice` text.
- **Live network columns for a debutant:**
  `python3 tools/debut.py features --href /fighter/<Name-id> --date YYYY-MM-DD --live`.
  - It rates his Sherdog rows against the frozen 2026-01-01 network fits, for both half-lives.
  - The output goes into the entry as a `debut_model` block. The card desk owns that file, so this tool does not
    write it.
  - Without `--live`, rows from 2026 on are dropped, under the hidden-data protocol. A live card's debutant
    usually had his last regional bouts in 2026; with `--live` those rows are inputs, never fit or scored.
  - Verifier fix: without `--live`, the rows used to be decayed to 2026-01-01 instead of the bout date. They are now
    decayed to the bout date, as in training.
- **Today's limits:**
  - The current debutant entries lack the network columns and the amateur win-loss split, so those enter at the
    training mean until `features` runs.
  - Veterans' network columns are frozen at 2026-01-01; their Elo and record are live from fighters.json.
  - Veterans' pre-UFC method rates are not wired (pav = 0), a small departure from training.
- **Example** from the test: Mitch Raposo against debutant Marcos Degli (UFC Vegas 124, Nov 7, 2026), a test input
  with line 0.60 and open 0.58.
  - The adopted no-line P(Raposo) is the ledger's seeded Elo, 0.348.
  - The adopted method marginal is KO 0.253, SUB 0.175, DEC 0.572.

## Protocol and leakage audit

- **2026.** Dropped at parse. The build asserts that no frame date is 2026 or later. No 2026 row was collected into
  the repo or the vault.
- **Selection.** Every model choice comes from forward-chained CV on 2019-2023 with fits on earlier years: blocks,
  C, tau, half-lives, lambda, and the stack structure. The CV stage never fits a 2024-25 row; the swap-test fit was
  restricted to pre-2024 rows for this reason.
  - The adoption decision was first written after the look and keyed the method on a look secondary. The verifier
    re-keyed it on CV, with the same outcome.
  - The CV design was iterated on the same CV years. The promo blocks were added after a first CV run. Nested
    selection prices that at about 0.005 of log loss.
- **The network.**
  - The fit at C uses bouts before C, and only from pages whose owner debuted before C.
  - The fighter's own rows are always strictly before the bout.
  - Pages of debutants debuting after C in the same year wait for the next fit.
  - The 49 roster pages of pre-2012 debutants are excluded (survivor selection).
- **Fight-week flags** are pre-fight facts. Weigh-in misses are known the day before the bout, and every ledger lock
  is after the weigh-ins.
- **Symmetry.** The model has no intercept and uses only antisymmetric differences; swap max 2.2e-16 in Python and
  1e-12 in JS. The method model is written from the winner's point of view.
- **CIs** are event-cluster bootstraps: 2,000 card resamples, paired for differences (calibration slopes: 500
  resamples in CV, 1,000 on 2024-25).
- **The look is not clean.** tools/preufc.py had scored seeded Elo on the same 172 bouts (its "a debutant in the
  bout" subgroup, 0.6370). That is a seen number on the reference side.
- **Reproduction.** The frame rebuilds bit-identically: every one of the 196 columns matched between two builds.

## Open threads

- **The one-hop opponent pages are not in this model.**
  - The crawl ranks every debutant's last 5 pre-UFC opponents, 6,551 pages, at 2 s or more per page. On the shared
    box it ran at 5-10 s per page.
  - It is still running, resumable with `nice -n 5 python3 tools/debut.py crawl --skip-resolve`. The build uses
    only ranks complete for every debutant.
  - Once rank 0 completes, `build` then `cv` gate the opp1h block and the enriched network on 2019-2023 only.
  - That result gets no second 2024-25 look. `export` refuses a post-look CV choice without `--allow-new-cv`.
- **Calibration.** The debut model leaned overconfident on 2024-25 (0.81). A temperature is a CV question for the
  next cycle; it was not fit on the look.
- **Promotion aliases.** "BFC | Bellator Fighting Championships" vs "Bellator" in preufc's alias table splits one
  organization in two.
- **Sherdog completeness** for small shows cannot be measured (as in model_preufc.md).
- **The blind-test plugin** registers nothing on the backtest universe, because that universe excludes debut bouts.
  It is ready for a debut-inclusive replay.

## Reproduce

```
nice -n 5 python3 tools/debut.py build --opp-k 0      # frame + network fits (~1 min); sha256 prefix 00f12a966c82463e
nice -n 5 python3 tools/debut.py cv                   # every CV table above (out/debut_cache/cv.json; debut.json "cv")
nice -n 5 python3 tools/debut.py holdout              # spent: refuses to rerun (--force-rescore-same-choices recomputes it)
nice -n 5 python3 tools/debut.py export               # data/derived/debut.json (holdout, pooled_2019_2025, model, fixtures)
node tests/test_debut.js                              # 23 checks: Python = JS, symmetry, regimes, adopted path, ledger hook
node tests/test_forward_models.js                     # the ledger's own test still passes with the hook
```

The replacement and raw-coefficient facts above come from `DebutLR` refit on 2012-2023 with the chosen config
(`tools/debut.py` load_frame, prep, cfg_cols, DebutLR; 2012-2023 rows only).
