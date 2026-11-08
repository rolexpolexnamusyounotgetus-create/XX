# Officials component (roadmap v8): `params.components.officials`

Nov 6, 2026. Branch `comp/officials` in worktree `/home/user/XX/.claude/worktrees/wf_5678b8c9-d1e-2` (not pushed).

## Bottom line

- **Built, tested, train-only.** Named judges have per-judge scoring tendencies. The model is hierarchical and
  round-level, fit walk-forward on MMA Decisions judge-rounds, with shared panel noise at the fight and round
  levels and a 10-8 GLMM. Referees have stoppage multipliers. Engine options: `opts.judges`, `opts.referee`,
  `opts.judgePool`. Flag off is bit-for-bit the v4 engine, proven by tests/test_officials.js against the base engine
  file: 4 cases x 160 fights with traces, plus summaries.
- **Real but tiny judge effects.** On held-out real rounds 2019-2023, per-judge effects gain +0.0035 nats per round
  in panel log likelihood over league judges. Per-judge 10-8 propensity gains 57.6 log-lik units over 5 years.
  Referees barely differ: held-out deviance picked tau = 0 for KD follow-up stoppages and ground-and-pound, and
  0.3 for standing TKOs.
- **No measurable gain inside the engine.** Ablation: 2019-2023, 1,999 fights, both corner orders, 300 sims per
  orientation and variant, common random numbers with per-sim seeds, 211-event cluster bootstrap.
  - Per-judge tendencies (jd - lg): winner log loss -0.0001 [-0.0003, +0.0002]; decision-outcome log loss +0.0006
    [-0.0039, +0.0047].
  - Referee (full - jd): -0.0001 [-0.0001, +0.0000].
  - Officials league model vs v4's judgecal judging (lg - off): slightly worse on the decision outcome, +0.0092
    [+0.0002, +0.0176], and on soft-label CE, +0.0005 [+0.0003, +0.0007]. It under-predicts split decisions (17.9%
    vs 19.0% actual; v4 19.5%) and over-predicts majority decisions (2.4% vs 2.0%).
- **Recommendation for v5:** keep the prediction path on v4 judging (`components.officials = false`). Merge the
  code only as an opt-in for named-officials features: real judges and referee in the 3D show, scorecards, and
  "who is judging" scenarios. It earns no validated weight, and the full component is 0.0098 worse on decision
  outcome log loss [-0.0002, +0.0193].

## Base commits and patches

- Worktree start commit: `853ce32`. Its `src/engine3.js` was a mid-edit autosave with no `matchup()`, so it did not
  load. I synced the v4 engine from the main checkout twice:
  - `70142e9`: v4 snapshot 1.
  - `98564b7`: v4 snapshot 2, with judgecal's fitted noise and the fight-level shared judge normal. This is the
    component's base.
- Component commit: `a2ae5cb`. Report commit: on top of it.
- `components/officials.patch`: `git diff 853ce32 comp/officials`, as the brief asks. It includes the two v4 syncs.
- `components/officials_component_only.patch`: `git diff 98564b7 comp/officials`, the component alone. **Apply this
  one on top of v4.** It touches `matchupBase` (one line), `simulate` (four hooks) and the v4 line that draws the
  fight-level judge normal; that line now names the draw `zF` and the arithmetic is unchanged.
- After re-applying on a newer v4, run these two commands:
  - `node tests/test_officials.js --base <that v4 engine3.js> --write-golden`
  - `node tools/officials_engcal.js --write`. The engine-only adjustment depends on the engine's round
    distributions.
## What changed

| File | Change |
|---|---|
| `src/engine3.js` | Officials module (`officialsFor`, `officialsFight`, `officialsRound`, `loadOfficials`, `officialsTableFor`), one line in `matchupBase` (`m.off`), and four small hooks in `simulate` (start-of-fight draws, referee multipliers, the judged round, `fight.officials`). The v4 line that draws the fight-level judge normal now names the draw (`zF`) so the officials model can reuse it; the arithmetic is unchanged. |
| `src/params3.js` | `components: { officials: true }` and an `officials` block: the production league judging model (fit 2019-2023), population sds, ablation switches. |
| `tools/officials_engine.py` | New. Fits the walk-forward judge and referee tables (JAX MAP + Gauss-Hermite; penalized GLMMs), tunes the shrinkage on 2019-2023 held-out years, writes `data/derived/officials_engine.json` and the backtest-keyed `data/derived/officials_bt.json`. Hard guard: nothing on/after 2024-01-01. |
| `tools/officials_ablate.js`, `tools/officials_ablate_report.py` | New. The train-only ablation (sims; metrics with event-cluster bootstrap). |
| `tests/test_officials.js`, `tests/fixtures/officials_off_golden.json` | New. Bit-for-bit flag-off check (against a base engine file or the golden hashes) and 21 focused checks. |
| `docs/ENGINE_V3_SPEC.md` | New section: officials component API, equations, RNG contract. |
| `data/derived/officials_engine.json` (137 KB), `data/derived/officials_bt.json` (563 KB) | New outputs. |

## Flags and API

- `params.components.officials` (default `true` in this branch). `false` = the engine before the component, bit for bit.
- Sub-switches for ablation: `params.officials.perJudge` (false = every judge is the league judge), `params.officials.referee` (false = referee multipliers 1).
- `FightEngine.loadOfficials(json)` loads `officials_engine.json`; `FightEngine.officialsTableFor(set, date)` picks the latest table year <= the fight year (null before the first table, so no later fit leaks backwards; no date = production table).
- `opts.judges = ["Sal D'Amato", "m318", ...]` (names, ufcstats spellings or MMA Decisions keys `m<id>`; or `{ names, power }`, which keeps the existing `judges.power` knob), `opts.referee = "Herb Dean"`, `opts.judgePool = [[key, weight], ...]`, `opts.officials = <table set> | false`.
- Unknown officials: unnamed judge slots are drawn (without replacement) from the table's recent pool (judges' shares of judge-rounds in the last two window years; `_other` = a new judge); names not in the table get effects drawn from the population sds; an unnamed referee is drawn from the referee pool.
- Output: `fight.officials = { judges, referee, refMult }` when on. Trace format and every other field unchanged; `rec.judges` keeps `[[A, B] x 3]`.
## Equations

**Judges (one round; A - B differentials of the engine's round counts).**

```
V = b_head dHead + b_body dBody + b_leg dLeg                    landed significant strikes by target
K = b_kd dKD + b_head (hurtHS dHurt + judgePower dPow)          knockdowns + the engine-only hurt and power terms (v4's)
G = b_td dTD + b_ctrl dCtrl/60 + b_sub dSubAtt + b_rev dRev
u = sigmaU (sqrt(rhoF) zF + sqrt(1 - rhoF) z_r)                 shared by the panel; zF once per fight, z_r per round
eta_j = exp(n_j) (exp(v_j) V + exp(k_j) K + exp(g_j) G + u) + e_j,   e_j ~ Logistic(0, 1)
judge j: 10-10 with P = p1010; else the round to sign(eta_j) = W, and a 10-8 with
P = sigmoid(c0 + c_j + thV V_W + thK K_W + thG G_W + eps),   eps ~ N(0, sigmaE^2) shared by the panel
```

`(n_j, v_j, k_j, g_j, c_j)` are judge j's sharpness, volume, knockdown, grappling and 10-8 effects, Gaussian random
effects with sds `tau`. The model has no intercept and only antisymmetric features, so it is corner-symmetric.
The logistic own noise is drawn exactly from the normal the v4 code already draws (`logit(Phi(z))`).

**Fit (tools/officials_engine.py).** Table Y uses the clean judge-rounds dated in [Y-5, Y) (complete cards, ufcstats
check agree/partial/names-differ, raw pre-deduction scores where known). MAP with JAX gradients and L-BFGS; the shared
term is integrated by 24-node Gauss-Hermite per round, so the three verdicts of a round are dependent. `tau = m x
(0.15, 0.15, 0.25, 0.20)` (the pre-2019 empirical-Bayes sds of the officials workflow), with m chosen from {0, 0.25, 0.5,
1, 2} by the held-out panel log likelihood of each year 2019..2023 under the table fit before it. The 10-8 part is a
second GLMM given the winner model (year fixed effects, judge effect, shared round effect), with `tau_c` from {0, 0.2,
0.4, 0.8} and the year level used for prediction (`last` year, mean of the last two, window mean) chosen the same way.
`rhoF` (fight-level share of the shared variance) by profile likelihood over each window's fights with the round model
held at its fit.

**Referees (penalized GLMMs on ufcstats fighter-rounds, referee random intercept; fixed effects year, round, 5-round,
division group).** `kdf`: P(knockdown scorer wins by KO/TKO in that round | >= 1 KD), logit -> multiplies the engine's
follow-up stoppage odds `refO`. `stko`: standing KO/TKO without a KD per landed distance + clinch strike, Poisson
offset -> multiplies `stko`. `gnp`: ground KO/TKO without a KD per landed ground strike -> multiplies `gnpTko`. Instant
knockouts are not the referee's call and are unchanged. Each unit's `tau` from {0, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8} by
held-out deviance of 2019..2023 (fit on the five years before each).

## Parameter values (production table 2024 = rows 2019-01-01..2023-12-31) and sources

| Parameter | Value | Source |
|---|---|---|
| b_head, b_body, b_leg | 0.3077, 0.2338, 0.1953 per landed (body 0.76, leg 0.63 head strikes) | fit, 3,911 clean rounds / 11,696 judge-rounds 2019-2023 (judgerounds_rows.json) |
| b_kd | 4.118 (13.4 head strikes) | same; it rose window by window: 2.69 (2014-18), 2.79, 3.55, 3.78, 4.02, 4.12 |
| b_td, b_ctrl, b_sub, b_rev | 0.455 per TD, 0.967 per control minute, 1.408 per sub attempt, 0.527 per reversal | same |
| sigmaU | 2.528 (own noise Logistic, sd 1.81) | same; checks: unanimous rounds 78.6% obs vs 78.9% model; near-even rounds (abs index < 0.5) 59.3% obs vs 61.2% model vs 26.5% for independent judges |
| rhoF (sharedFight) | 0.30 (+35.6 log-lik over 0; 0.35-0.40 in the earlier windows) | profile likelihood; v4 judgecal found 0.33 in its own parametrization |
| 10-8: c0, thV, thK, thG, sigmaE | -10.395 (2023 level), 0.647, 0.545, 1.054, 2.09 | 10-8 GLMM; year levels 2019 -9.01, 2020 -9.44, 2021 -10.09, 2022 -10.74, 2023 -10.40 |
| p1010 | 0.00034 | 2019-2023 judge-rounds |
| tau (n, v, k, g) | 0.075, 0.075, 0.125, 0.10 (multiplier 0.5) | held-out panel log lik per round vs league judges: +0.0028 (m 0.25), +0.0035 (0.5), +0.0016 (1), -0.0078 (2) over 3,911 rounds 2019-2023 |
| tau_c (10-8 propensity) | 0.2, rule "last year" | held-out 10-8 log lik: -1215.9 (tau 0) vs -1158.3 (0.2), -1160.5 (0.4); "last" beat "avg2" and "all" at every tau |
| judges in the production table | 182 (15 with >= 200 window rounds; sd of their effects n 0.037, v 0.044, k 0.037, g 0.066, c 0.096; max abs 0.08, 0.12, 0.10, 0.14, 0.20) | fit |
| referee tau | kdf 0, stko 0.3, gnp 0 | held-out deviance: kdf 0.67391 (0) vs 0.67395 (0.1); stko 0.030252 (0) vs 0.030245 (0.3); gnp 0.15235 (0) vs 0.15240 (0.1) |
| referee multipliers (refs with >= 50 window fights) | stko 0.84 (Mark Smith) .. 1.27 (Chris Tognoni); kdf and gnp 1 | production table |
| hurtHS | judge.hurt / judge.head = 0.8 / 0.179 = 4.47 head strikes | v4 judgment call, kept so the knob behaves the same |
## Train-only ablation (2019-01-01..2023-12-31)

**Setup** (`tools/officials_ablate.js`, `tools/officials_ablate_report.py`; stored in
`data/derived/officials_ablation.json`).

- **Fights:** every backtest_dev fight dated 2019-2023 (1,999). Never 2024+, never 2026.
- **Leak-free inputs:**
  - frozen pre-fight profiles;
  - priors as of Jan 1 of the fight year (`mlcal_priors_asof.json`);
  - out-of-fold ML stat-line rates (`mlrates_oof.json`, folds cv2019..cv2023 trained on earlier years) through
    `opts.ml`;
  - the officials table of the fight's year, fit only on the five years before it;
  - the fight's actual officials from `officials_bt.json`: the referee for 1,997 fights, and the three judges for
    994 of the 1,001 decisions. Other fights sample from the event's judge panel: judges cannot change a finish,
    and finished fights' judges are not recorded.
- **Symmetry:** both corner orders, each scored in its own frame, and the two losses averaged per fight.
- **Common random numbers.** Each simulated fight has its own seed, shared by every variant. The component keeps
  the main RNG stream in step, so variants differ only where officials change an outcome. The test checks this:
  400/400 identical fight paths with a neutral referee. The harness also checks that the `off` variant equals a
  genuinely flag-off matchup, 18/18.
- **Sims:** 300 per orientation and variant. 95% CIs come from a paired bootstrap over 211 events, 2,000
  replicates. Probabilities use sim counts +0.5 per cell.
- **Variants:**
  - `off`: v4 judging (judgecal) and v4 stoppages.
  - `lg`: the officials league judging model, with no per-judge effects and a neutral referee.
  - `jd`: `lg` plus per-judge tendencies.
  - `full`: `jd` plus referee multipliers. This is the component as shipped.
- **Metric notes:**
  - Decision outcome = 7-way among A UD/SD/MD, draw, B MD/SD/UD, on fights that went the distance.
  - Stat-line deviance = Poisson deviance of 10 per-fighter stats, with control in minutes.
  - The actual 10-8 rate is implied from the card totals (19R - total), which counts point deductions as 10-8s.
    The real rate in the judge-round rows is 4.6% for 2019-2023.

**Final run (with the engine-only adjustment `engAdj`):**

| Metric | n | off (v4) | lg | jd | full | lg - off [95% CI] | jd - lg [95% CI] | full - jd [95% CI] | full - off [95% CI] |
|---|---|---|---|---|---|---|---|---|---|
| Winner log loss (decisive) | 1955 | 0.6651 | 0.6655 | 0.6654 | 0.6653 | +0.0003 [-0.0003, +0.0010] | -0.0001 [-0.0003, +0.0002] | -0.0001 [-0.0001, +0.0000] | +0.0002 [-0.0005, +0.0009] |
| Soft-label CE vs closing line | 1999 | 0.6727 | 0.6732 | 0.6731 | 0.6731 | +0.0005 [+0.0003, +0.0007] | -0.0000 [-0.0001, +0.0000] | -0.0000 [-0.0000, +0.0000] | +0.0004 [+0.0002, +0.0006] |
| 7-bin outcome log loss | 1975 | 1.6634 | 1.6642 | 1.6639 | 1.6639 | +0.0008 [-0.0020, +0.0031] | -0.0003 [-0.0018, +0.0011] | +0.0000 [-0.0003, +0.0003] | +0.0005 [-0.0026, +0.0032] |
| Method log loss (KO/SUB/DEC) | 1975 | 0.9705 | 0.9705 | 0.9705 | 0.9706 | +0.0000 [+0.0000, +0.0000] | +0.0000 [+0.0000, +0.0000] | +0.0001 [-0.0002, +0.0003] | +0.0001 [-0.0002, +0.0003] |
| P(decision) log loss | 1975 | 0.6685 | 0.6685 | 0.6685 | 0.6685 | +0.0000 [+0.0000, +0.0000] | +0.0000 [+0.0000, +0.0000] | -0.0000 [-0.0002, +0.0002] | -0.0000 [-0.0002, +0.0002] |
| Decision outcome log loss (7-way | decision) | 1001 | 1.3350 | 1.3442 | 1.3448 | 1.3448 | +0.0092 [+0.0002, +0.0176] | +0.0006 [-0.0039, +0.0047] | -0.0000 [-0.0004, +0.0004] | +0.0098 [-0.0002, +0.0193] |
| Winner log loss on decisions | 981 | 0.6620 | 0.6625 | 0.6625 | 0.6624 | +0.0005 [-0.0014, +0.0025] | +0.0000 [-0.0007, +0.0007] | -0.0001 [-0.0003, +0.0001] | +0.0004 [-0.0018, +0.0025] |
| Unanimous vs split/majority/draw log loss (| decision) | 1001 | 0.5395 | 0.5411 | 0.5407 | 0.5408 | +0.0016 [-0.0016, +0.0048] | -0.0004 [-0.0016, +0.0008] | +0.0001 [-0.0001, +0.0002] | +0.0013 [-0.0020, +0.0047] |
| Stat-line Poisson deviance (per fight, 10 stats x 2) | 1999 | 229.1202 | 229.1202 | 229.1202 | 229.1063 | +0.0000 [+0.0000, +0.0000] | +0.0000 [+0.0000, +0.0000] | -0.0139 [-0.0885, +0.0615] | -0.0139 [-0.0885, +0.0615] |

| Base rate | actual | off (v4) | lg | jd | full |
|---|---|---|---|---|---|
| ko | 31.8% | 32.5% | 32.5% | 32.5% | 32.5% |
| sub | 17.5% | 15.4% | 15.4% | 15.4% | 15.4% |
| decision | 49.7% | 51.5% | 51.1% | 51.1% | 51.1% |
| draw | 1.0% | 0.6% | 1.0% | 1.0% | 1.0% |
| UD|dec | 77.0% | 78.1% | 77.8% | 78.0% | 78.0% |
| SD|dec | 19.0% | 19.5% | 17.9% | 17.6% | 17.6% |
| MD|dec | 2.0% | 1.2% | 2.4% | 2.5% | 2.5% |
| draw|dec | 2.0% | 1.2% | 1.9% | 1.9% | 1.9% |
| 10-8 per judge-round | 5.3% | 5.9% | 5.9% | 6.0% | 6.0% |
| minutes | 11.34 | 11.52 | 11.52 | 11.52 | 11.52 |
| kd per fight | 0.45 | 0.42 | 0.42 | 0.42 | 0.42 |
| finish by round | 23.5/16.7/7.8/0.7/0.6 | 23.0/14.0/9.1/1.1/0.7 | 23.0/14.0/9.1/1.1/0.7 | 23.0/14.0/9.1/1.1/0.7 | 23.0/14.0/9.1/1.1/0.7 |

| non-UD calibration (| decision) | mean predicted | observed | quintiles (pred/obs/n) |
|---|---|---|---|
| off | 22.1% | 23.0% | 16/20/401; 20/23/395; 22/25/405; 24/24/400; 28/23/401 |
| lg | 22.4% | 23.0% | 16/21/401; 20/24/400; 22/24/399; 25/21/401; 29/25/401 |
| jd | 22.2% | 23.0% | 16/21/401; 20/24/399; 22/23/401; 25/22/399; 28/25/402 |
| full | 22.2% | 23.0% | 16/21/401; 20/23/399; 22/24/399; 25/22/402; 28/24/401 |

**First run (raw engine-only hurt and power terms, before `engAdj`).**

- The league model was too unanimous: SD 17.4% of decisions vs 19.0% actual. It was also too 10-8-happy: 6.4% of
  judge-rounds vs 5.3% implied and v4's 5.9%.
- Per-judge effects then hurt the decision outcome: jd - lg +0.0032 [+0.0001, +0.0066].
- Full - off:
  - decision outcome +0.0125 [+0.0023, +0.0224];
  - winner log loss +0.0006 [+0.0001, +0.0013];
  - soft CE +0.0004 [+0.0002, +0.0006].
- Cause: the real panel's shared noise already holds what judges see beyond the counts, so adding the engine's
  explicit hurts and power on top counted that information twice.
- Fix: the engine-only terms enter only as their residual on the count index, and the residual's variance (1.02
  logit^2) is removed from the round-level shared noise. This is the same principle as v4's judgecal. Slopes and
  covariance come from 84,597 judged rounds of simulated 2019-2023 backtest fights; no outcomes are used
  (`tools/officials_engcal.js`).
- Result: per-judge effects moved from harmful to neutral, and 10-8s from 6.4% to 5.9%.

**Reading.**

- The officials effects are real on real rounds. In this engine they are too small to change winner, method or
  stat-line metrics: the winner, soft-CE, method, P(decision) and stat-line CIs all sit within +-0.001 of zero for
  the per-judge and referee increments.
- The only measurable difference is the league judging model itself. v4's judgecal was calibrated with this
  engine in the loop: it removes the hurt/power residual variance from the shared sd and fits the 10-8 threshold to
  2021-2023 rounds. It matches the decision split slightly better than the officials model fit purely on real rounds.
- Per-judge 10-8 propensity and sharpness are the largest judge effects: sd 0.10 and 0.04 among the 15 judges with
  200+ window rounds. Even so they do not move decision-type calibration measurably.

**Volk vs Gaethje** (production table, live date, judges and referee drawn from the pools, 20,000 fights, seed 7):
- Flag on: P(Volk) 0.6129 vs 0.6146 off. Decisions UD 81.0 / SD 17.0 / MD 1.1 / draw 0.9 vs off 80.4 / 18.2 / 0.9 / 0.5.
- 10-8 per judge-round: 4.1% on vs 6.5% off.
- CPU cost of the flag: about 3-5% (6,000-fight summaries after warm-up).

## Risks and interactions with other components

1. **Judging calibration is engine-dependent.** `engAdj` (slopes and residual covariance of the engine-only terms)
   must be re-measured whenever another component changes round stat distributions: dynamics (round output
   correlation, pace), durability (hurts and knockdowns), styles. Run `node tools/officials_engcal.js --write`
   after merging them.
2. **Replaces v4 judging when on.** judgecal's `sharedSd`, `sharedFight`, `indSd`, `t108` and `t108kd` are unused;
   tastes are not drawn. The `judges.power` knob and v4's hurt weight still enter, through the residualized K term.
3. **RNG contract.** The component relies on v4's draw order:
   - the 9 taste normals;
   - the fight-level judge normal (`zF`);
   - 1 + 3 normals per judged round.
   A component that adds main-stream draws before or inside judging keeps working, but it breaks the "same path"
   property that makes the CRN comparisons tight. Judge picks and 10-8 / 10-10 draws use a second stream seeded
   from the start-of-fight normals.
4. **Backtest officials.** Judges are recorded only for decisions. Finished fights sample from the event's panel.
   This cannot leak an outcome, because judges cannot cause a finish, but it means the per-judge signal is
   measured on decisions only. Seven decisions without three named judges also use the event pool.
5. **Referee model is thin.**
   - KD-to-stoppage (`kdf`) and ground-and-pound effects shrank to zero; only standing-TKO multipliers vary
     (0.84-1.27 for referees with 50+ fights).
   - `kdf`, a same-round finish odds ratio, is applied to the follow-up stoppage odds only; instant KOs are not the
     referee's call.
   - Doctor stoppages and deductions are not modeled.
6. **Tables are train-only by design.** Production table 2024 = rows 2019-2023, and 2024-2025 fights use it as
   well. For the release, rebuild with a later `--max-date`; the tool asserts <= 2024-01-01 unless `--allow` is
   given. Before 2019 no table exists, so pre-2019 backtests fall back to the params defaults (fit 2019-2023), which
   would leak; nothing evaluates pre-2019.
7. **Page.** Without `officials_engine.json` loaded (137 KB), the flag-on engine draws judges from the population
   sds and uses neutral referees. To show real officials, the page would inline the table and pass `opts.judges` /
   `opts.referee`; `fight.officials` carries the names.
8. **Data provenance.** Judge-rounds come from `judgerounds_rows.json`: nlbair/ufc-data, CC BY 4.0, and
   martindavies-code/ufc-judging-analysis, which has no license file, so do not redistribute D-only rows. The
   officials workflow's `data/derived/officials.json` was not used: its final tables are fit on all data through
   2025, and it is not in the verified list. Its findings agree with this fit: small judge effects, best shrinkage
   multiplier 0.5, referee taus near 0.
9. **Tests.**
   - tests/test_engine3.js: 66 passed, flag on by default.
   - tests/test_director3.js: OK.
   - tests/test_officials.js: 23 passed, including the bit-for-bit flag-off check against the golden hashes of the
     `98564b7` engine.

---

## Independent verification (Nov 6, 2026, about 4:30 pm UTC)

**Verdict: no bugs found, and the patch is unchanged.** For the v5 prediction path the answer is **include = false**:
keep `components.officials` off. It is fine to merge the code as an opt-in that defaults to off, for named-officials
features in the show and the scorecards; that use does not need a validated weight.

**Where the checks ran:** worktree `/home/user/XX/.claude/worktrees/wf_5678b8c9-d1e-3`, branch `verify/officials`.
- `2f25fd1` = `officials.patch` applied on base `853ce32`. Its tree is identical to `comp/officials` (`b60a908`).
- `3eb9f38` = the verifier scripts in `tools/officials_verify/` (not part of the patch).

### What was checked
- **Flag off is bit for bit the base engine.**
  - The builder's `tests/test_officials.js --base <98564b7 engine3.js>` passes 23/23.
  - My own check (`bitid.js`): 80 random roster pairs from fighters.json, the 12 divisions, 3 and 5 rounds, ML rates
    loaded in alternate pairs, officials options present (named, unknown, `{power}`), seeds x trace on/off. 1,920 fights
    plus 8 `summarize()` hashes, each compared across three engines:
    - the 98564b7 base;
    - the patch with the flag off globally;
    - the patch with the flag on by default, turned off through `opts.params`, with the officials tables loaded.
    Result: 0 mismatches.
  - Against the main checkout's current final-v4 `engine3.js` + `params3.js`: I applied the src part of
    `officials_component_only.patch` (it applies cleanly; params hunk offset 7 lines) and ran the same check. 800 fights
    plus 4 summaries, 0 mismatches.
- **Values against their sources.**
  - Betas: an independent no-intercept marginal logistic fit on the 2019-2023 clean judge-rounds (3,911 rounds) gives
    head 0.1766, body 0.1306, leg 0.1082, kd 2.30, td 0.262, ctrl 0.530/min, sub 0.811, rev 0.339. The table's betas
    times the probit attenuation implied by sigmaU (0.558) give 0.1718, 0.1306, 0.1091, 2.30, 0.254, 0.540, 0.787,
    0.294. All agree within 3%, rev within 15%.
  - Rates: unanimity 78.1% observed vs 78.9% model. Near-even rounds 58.4% vs 61.0%, so the model is slightly too
    unanimous there. P(10-10) 0.00034 and the real 10-8 rate 4.45% both confirmed.
  - The tuning numbers reproduce from the stored tuning tables: +0.0035 nats per round; 57.6 log-lik for tau_c 0.2;
    the referee deviances.
  - engAdj re-measured with `tools/officials_engcal.js --fights 200 --n 30`: aH 0.016, aP -0.117, residual variance
    0.95 (stored: 1.02). Consistent.
- **Leakage.** None found.
  - `officials_engine.json`: max_date 2024-01-01; tables 2019-2024, each with window [Y-5, Y-1].
  - `officials_bt.json`: 2,512 fights, 2019-01-19..2023-12-16.
  - The fit tool drops rows on or after max_date at load. It still reads the raw ufcstats CSVs, which contain later
    fights, before filtering, as build_db does.
  - My harness asserts that every fight uses its own year's table: 3,998 checks.
  - Hyperparameters were chosen on 2019-2023 itself: the shrinkage multiplier, tau_c, the 10-8 year rule, referee tau
    and engAdj. That is allowed in train, but it makes the flag-on train numbers mildly optimistic.
  - Named judges exist only for decisions. That leaks no outcome, because judges cannot cause a finish. The `pool`
    variant below never names judges, and it scores the same.
- **Corner symmetry.**
  - Round level: `officialsRound` with differentials x vs -x and non-zero judge effects, 200,000 rounds x 5 cases. P(win
    round), P(10-8) and P(10-10) are equal within Monte Carlo error.
  - The fight-level test in test_officials passes.
  - The code has no corner-specific terms.
- **Fuzz** (`fuzz.js`). Inputs:
  - 500 random roster pairs x 40 sims = 20,000 fights;
  - every division including catch and open weight; 3 and 5 rounds;
  - dates 2014..2026 or none (so before the first table, inside the tables, and after);
  - named, unknown and garbage judges, and pool entries with NaN or 0 weights;
  - `opts.officials = false`, tables unloaded, `judges.power` up to 2.

  Results:
  - no NaN or Infinity, and no exceptions;
  - every judge-round is 10-10, 10-9 or 10-8, and every method matches its cards;
  - the director built 500/500 fights;
  - a forced p1010 = 0.5 run builds through the director 40/40;
  - the slowest fight took 383 ms (a load spike; there are no loops that can hang).
- **Tests on the patched tree with the flag on:** test_engine3 66/66; test_director3 OK; test_officials 23/23.
- **Speed.** CPU seconds per `summarize()` of 20,000 five-round fights, Volk vs Gaethje, ML on, median of 3 runs on a
  machine at load 40-70:

  | Engine | CPU s |
  |---|---|
  | base | 2.04 |
  | patch, flag off | 1.98 |
  | patch, flag on (judges drawn from the pool) | 2.19 |
  | patch, flag on (named officials) | 2.07 |

  Flag off has no regression. Flag on costs about +5-10%.

### Independent train ablation (fresh seeds, my own harness and scoring)

`tools/officials_verify/vablate.js` + `vscore.py`.

**Inputs.** As in v4's `tools/evalv.js`: backtest profiles; priors as of Jan 1 of the fight year; out-of-fold ML rates
`{pred}`.

**Fights and sims.**
- All 1,999 backtest_dev fights dated 2019-2023.
- Both corner orders, 300 sims each per variant, pooled in the data's orientation.
- Common random numbers: a fresh seed per simulated fight, with a different salt from the builder's.
- Every variant is built through params, not by editing the matchup object.
- Paired 95% CIs from a bootstrap over 211 events, 2,000 resamples.

**Variants.**
- `off` = v4 judging.
- `lg` = the league officials model, neutral referee.
- `full` = as shipped.
- `pool` = as shipped, but judges are always sampled from the event's panel.

| Metric | n | off | lg | full | pool | full - off [95% CI] | lg - off | full - lg |
|---|---|---|---|---|---|---|---|---|
| Winner log loss (decisive) | 1952 | 0.6648 | 0.6650 | 0.6651 | 0.6651 | +0.0003 [-0.0003, +0.0010] | +0.0002 [-0.0003, +0.0008] | +0.0001 [-0.0002, +0.0004] |
| Soft-label CE vs close | 1999 | 0.6712 | 0.6716 | 0.6717 | 0.6717 | **+0.0004 [+0.0002, +0.0006]** | +0.0004 [+0.0002, +0.0005] | +0.0001 [-0.0000, +0.0001] |
| 7-bin log loss | 1972 | 1.6549 | 1.6560 | 1.6556 | 1.6561 | +0.0007 [-0.0029, +0.0039] | +0.0011 [-0.0027, +0.0044] | -0.0004 [-0.0017, +0.0007] |
| Method log loss | 1972 | 0.9674 | 0.9674 | 0.9675 | 0.9675 | +0.0001 [-0.0001, +0.0003] | 0 | +0.0001 [-0.0001, +0.0003] |
| P(decision) log loss | 1972 | 0.6693 | 0.6693 | 0.6694 | 0.6694 | +0.0001 [-0.0000, +0.0003] | 0 | +0.0001 [-0.0000, +0.0003] |
| Decision outcome (7-way, given a decision) | 1001 | 1.3248 | 1.3332 | 1.3312 | 1.3323 | +0.0065 [-0.0064, +0.0185] | +0.0084 [-0.0050, +0.0204] | -0.0019 [-0.0055, +0.0016] |
| UD vs not (given a decision) | 1001 | 0.5364 | 0.5376 | 0.5370 | 0.5381 | +0.0006 [-0.0027, +0.0040] | +0.0013 [-0.0020, +0.0046] | -0.0006 [-0.0019, +0.0007] |
| Winner log loss on decisions | 981 | 0.6640 | 0.6636 | 0.6635 | 0.6635 | -0.0005 [-0.0014, +0.0005] | -0.0004 [-0.0012, +0.0004] | -0.0001 [-0.0005, +0.0004] |
| Stat-line Poisson deviance | 1999 | 228.508 | 228.508 | 228.539 | 228.543 | +0.031 [-0.035, +0.094] | 0 | +0.031 [-0.035, +0.094] |

| Base rate | actual | off | lg | full | pool |
|---|---|---|---|---|---|
| KO/TKO (incl. DOC) / SUB / decision / draw | 31.7 / 17.5 / 49.7 / 1.0% | 32.6 / 15.4 / 51.4 / 0.6% | 32.6 / 15.4 / 51.0 / 1.0% | 32.6 / 15.4 / 50.9 / 1.0% | 32.6 / 15.4 / 51.0 / 1.0% |
| UD / SD / MD / draw, given a decision | 77.0 / 19.0 / 2.0 / 2.0% | 78.2 / 19.4 / 1.3 / 1.2% | 77.9 / 17.7 / 2.5 / 1.9% | 78.1 / 17.4 / 2.5 / 2.0% | 78.1 / 17.4 / 2.5 / 1.9% |
| 10-8 per judge-round in decisions (actual: 19R - total, counts deductions) | 5.3% | 6.9% | 6.9% | 7.0% | 7.0% |
| Minutes per fight; KD per fight | 11.34; 0.446 | 11.51; 0.419 | 11.51; 0.419 | 11.51; 0.419 | 11.51; 0.419 |
| Finish share by round R1..R5 | 23.5/16.7/7.8/0.7/0.6 | 23.0/14.0/9.2/1.1/0.7 | 23.0/14.0/9.2/1.1/0.7 | 23.1/14.0/9.2/1.1/0.7 | 23.1/14.0/9.2/1.1/0.7 |

**What the ablation says.**
- It replicates the builder's run. No metric improves.
- The soft-label CE against the closing line is worse, with a CI that excludes 0: +0.0004.
- The decision outcome is worse but not significantly here: +0.0065 (the builder had +0.0098).
- Split decisions are under-predicted: 17.4% vs 19.0% actual; v4 has 19.4%.
- The draw and majority-decision shares get closer to actual, but that does not outweigh the split-decision miss.
- Per-judge and referee increments are within ±0.002 everywhere.
- Never naming judges (`pool`) changes nothing measurable, so the named-judges protocol is not driving any of these
  results.

### Notes for the merge (not bugs; nothing changed in the patch)
1. **Referee standing-TKO multipliers are not centred.** They are exp(random effect). Pool-weighted, their mean is
   1.01-1.05 per table, so flag on raises the standing-TKO hazard by about 1-5%. That is negligible at about 7% of
   KO/TKOs. If the component is ever turned on, divide by the pool mean.
2. **The stko tau of 0.3 has almost no support.** It rests on a held-out deviance gain of 0.02% (0.030252 to
   0.030245). Referee effects are effectively zero.
3. **The 10-8 model overshoots when fed engine rounds.** About 7% of judge-rounds in train decisions come out 10-8,
   against 4.45% in real 2019-2023 judge-rounds. The main checkout's final v4 retuned t108 to 8.555 for a 3.5% share.
   The officials c0 would need the same engine-in-the-loop recalibration.
4. **Two pieces are tied to the 98564b7 snapshot.** The golden fixture and engAdj were built on it, and the final v4
   params differ (kdScale 1.391, kdInstant, kdRefStop, stko, gnpTko, subConvScale, t108). After re-applying, run
   `node tests/test_officials.js --base <v4 engine3.js> --write-golden` and `node tools/officials_engcal.js --write`.
   If merged as an opt-in, set `components.officials: false` in params3.js, so the page and the tally keep the v4
   numbers that the page copy quotes.
