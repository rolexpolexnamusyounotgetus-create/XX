# Engine and prediction cycles v6-v10: plan

**Status: DRAFT.** Written Nov 6, 2026, about 9:30 pm UTC. Two things it waits on:
1. The v5 validation measurement on 2024-25 (one look). This plan's targets are stated relative to v5.
2. Vault audit 1 on the sealed 2026 fights. docs/BACKLOG.md calls this the v6 milestone; it runs after the v5 look
   and before any v6 work.

Re-read sections 4 and 6 once both results are in, and before the v6 look is pre-registered.

**How this was written.** Nothing was run and no repo file other than this one was changed. Sources:
- docs/BACKLOG.md, docs/ROADMAP.md, docs/CHANGELOG.md, docs/ENGINE_V3_SPEC.md;
- data/derived/version_history.json and data/predictions/README.md (forward ledger, fwd-4.1 pre-registration);
- every research/model_*.md and data_*.md note that the brief names;
- the v5 component reports in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/components/`.
  Below they are called `components/<name>.md`.

docs/BACKLOG.md was re-read after its 9:38 pm UTC update, which marked dynamics verified and launched the v5 merge.

It merges the planner outputs into one ranked list. Only two of the three planner outputs arrived, and the second
was cut off partway (see Gaps). Numbers are quoted as the sources print them: paired difference [95% event-cluster
bootstrap CI], negative = better for losses.

---

## 0. The short version

- **Not much verified gain is left, and most of it is already known.** Approximate sizes of what remains:

  | target | remaining gain |
  |---|---|
  | winner | 0.002-0.006 log loss, depending on the line regime |
  | 7-bin and method | 0.005-0.02 |
  | stat-line deviance | 1-3% |

- **Most winner and method candidates have already been scored on 2024-25.** That covers the ML v2 stacks, the S2
  cells, the props blend, the embeddings, the pre-UFC models and the per-card refits. So a v6 or v7 look on 2024-25
  mainly checks that the wiring is right; it is not new evidence. The clean tests are the train-only gate before
  each look, vault audit 2 and the forward ledger.
- **What 853 decisive fights can detect.** Stat-line gains of about 1% or more. Open-regime and no-line winner gains
  of about 0.004-0.005. Close-regime winner gains need about 0.003, which is above what is left. 7-bin and method
  gains of the expected size usually cannot be detected (section 2).
- **Ranked cycles:**

  | rank | slot | cycle |
  |---|---|---|
  | 1 | v6 | ML v2 prediction heads inside FightEngine.predict(), with line routing and a predict harness |
  | 2 | v7 | market props for how and when |
  | 3 | v8 | stat-line fidelity |
  | 4 | v9 | walk-forward levels, drift and calibration, with the joint level pass by format |
  | 5 | v10 | newcomer path and explainer coherence, which leave every scored backtest number unchanged; then the freeze for audit 2 |

- **Pre-register two rules now, before anyone reads audit 1** (section 6.5):
  - the production drift rule;
  - the rule that anything chosen because of audit 1 is flagged as not clean in audit 2. Both audits use the same
    roughly 370 vault fights.

---

## 1. Starting point (verified numbers)

| item | number | source |
|---|---|---|
| Engine v4 validation winner log loss (853 decisive) | 0.6324 vs v3 0.6424, -0.0100 [-0.0170, -0.0030] | version_history.json v4 |
| v4 calibration slope / ECE on 2024-25 | 1.72 / 0.063 (underconfident) | version_history.json v4 |
| v4 7-bin / method | 1.5712 / 0.9399 | version_history.json v4 |
| v4 stat-line deviance: sig landed / attempts / TD / control / KD | 21.87 / 43.42 / 1.806 / 154.1 / 0.652 | version_history.json v4 |
| v4 vs methodround model S on validation: joint / winner | +0.029 [+0.0015, +0.0575] / +0.011 [+0.002, +0.020] | CHANGELOG v4 |
| Engine weight in the validated blend | 0.037 with the close, 0 without; blend log loss -0.0002 [-0.0006, +0.0001] | CHANGELOG v4 |
| Removing the simulator from the blind-test stacks | +0.0009 [-0.0012, +0.0028] no line, +0.0005 [-0.0005, +0.0014] close | research/model_blindtest.md |
| Closing / opening line, 2024-25 | 0.5854 (845) / 0.6094 (843) | research/model_market.md |
| ML v2 logistic / blend (CV choice), static | 0.5887 / 0.5918 (854) | research/model_ml2.md |
| ML v2 stacks, static: no line / open / close | 0.5898 / 0.5812 / 0.5766 | research/model_ml2.md §4, §6 |
| Current MoE experts, static: no line / open / close | 0.5949 / 0.5852 / 0.5788 | research/model_ml2.md §6 |
| With-line ML v2 stack vs the close | 2024-25 -0.0087 [-0.0134, -0.0041]; 2021-23 alone -0.0015 [-0.0061, +0.0030] | research/model_ml2.md §4 |
| S2+ml2win vs S, 2024-25: 7-bin / method | 1.5171 vs 1.5538, -0.0367 [-0.0511, -0.0218] / 0.9298 vs 0.9360 | research/model_ml2.md §7 |
| Calibration slopes on 2024-25 | ML v2 1.40-1.45 (out of fold 1.00); ratings 1.28-1.47 (about 1.0 on 2019-23); close 1.11; stacks 1.06-1.23 | model_ml2, model_ratings, model_blindtest |

**v5 component verdicts** (docs/BACKLOG.md; train 2019-23 only):

| component | verdict and train evidence |
|---|---|
| durability | Include. Soft CE vs close -0.0011 [-0.0016, -0.0005]; 7-bin -0.0073 [-0.0139, -0.0011]; method -0.0042 [-0.0075, -0.0009]; round -0.0042 [-0.0073, -0.0010]; winner n.s. Source: components/durability.md, third pass |
| blend_anchor | Include. predict() package vs the simulator alone: winner -0.0229, 7-bin -0.0450, method -0.0122. Pool weight 0.15 (flat over 0.10-0.35). S rescaled alone vs the pool: +0.0014 [-0.0016, +0.0046], n.s. Source: components/blend_anchor.md |
| styles_sos | Include, as SOS "wf" only. Soft CE -0.0012 [-0.0019, -0.0005]; TD attempts, TD landed and control stat lines better; style blocks off |
| realism_sens | Include as a capability: sensitivity tornado and tools/realism.js. Factor layer off; only the 5-round KD factor (about 1.3) holds out of fold |
| officials | Code only, off in the prediction path. League model +0.0092 worse on decision outcome |
| dynamics | Verified about 9:40 pm UTC, on an independent harness at 500 sims per fight: include, flag on, as structure and realism. On v4.0.0: soft CE -0.0017 [-0.0025, -0.0008] and KD deviance -0.059, both significant; 7-bin and who x how x when lean worse, n.s. Round-to-round correlation 0.54 (real 0.56); KD per head strike by round and 5-round finish timing now match. Weak spots: 3-round R2 KO hazard low, 5-round R1 KO high, late submissions high. Merge conditions: one joint KD level pass with durability, and blend_anchor cells rebuilt with the flag on. Source: docs/BACKLOG.md as of 9:38 pm UTC |

The v5 merge was launched at about 9:45 pm UTC (docs/BACKLOG.md). Its steps, in order:
1. five sequential, tested merge steps;
2. a train leave-one-out ablation;
3. a joint level pass, re-tune and freeze;
4. the single validation look;
5. review and decision;
6. the first vault audit.

**Forward ledger.** fwd-4.1 was pre-registered at about 9:15 pm UTC. Primary `p_a` = `ml2_stack_open` (open-trained
weights for any line captured before the lock). Debutants get the line, seeded Elo, and division base rates for
the method. Source: data/predictions/README.md.

**Sample sizes in the validation window.** The counts differ by metric:

| set | fights |
|---|---|
| decisive (evalv winner) | 853 of 865 |
| decisive (ML/blind universe) | 854 |
| with an outcome (7-bin, method) | 857 |
| with a close | 845 |
| with both lines | 843 |
| with method props | 830 |
| five-round | 105 |
| event clusters | 84 cards |

The vault holds about 370 backtest fights; methodround's committed note shows 372 for 2026. Both universes exclude
debut bouts.

---

## 2. What 2024-25 (and the vault) can detect

**Method.** Approximate minimum detectable effect (MDE) at 80% power, two-sided 5%: about 2.8 x SE, with SE taken
from an observed paired CI of a comparable difference on these fights. For the vault, scale by sqrt(853/372), about
1.5. These are approximations, not power simulations.

| metric and comparison | observed paired CI it is scaled from | MDE 2024-25 | MDE vault |
|---|---|---|---|
| Winner, close regime, stack vs stack | ML v2 vs MoE experts, ±0.0022 | ~0.003 | ~0.0047 |
| Winner, open regime | ±0.0026 | ~0.0037 | ~0.0057 |
| Winner, no line | ±0.0036 | ~0.0051 | ~0.0077 |
| Winner, engine summarize vs summarize | v4.0.1 vs v4 ±0.004; v4 vs v3 ±0.007 | 0.006-0.010 | 0.009-0.015 |
| 7-bin, package or engine | S2 vs S ±0.015; v4.0.1 vs v4 ±0.019 | 0.021-0.027 | 0.032-0.041 |
| Method (KO/SUB/DEC) | v4.0.1 vs v4 ±0.0055; S2 vs S ±0.0076 | 0.008-0.011 | 0.012-0.017 |
| 7-bin when only method given the winner changes | S2 vs S method given winner ±0.010 | ~0.015 | ~0.022 |
| Stat-line deviance: sig landed / attempts / control | v4.0.1 vs v4: ±0.165 / ±0.32 / ±1.08 s | ~0.24 / ~0.46 / ~1.5 s (about 1% of level) | about 1.5% of level |
| 5-round subset (105 fights), line stack | ±0.0068 to ±0.0135 | 0.010-0.019 | none: too few |

**What follows from the table.**
- **A 5-round cell decides nothing.** Not in validation, and not in the vault.
- **The close regime is out of reach.** A real close-regime winner gain of 0.002 has about 40% power on 2024-25 and
  about 20% on the vault.
- **Stat lines are the most detectable target.** A 2% stat-line gain is detected almost surely.
- **Power does not apply to already-seen components.** For anything already scored on 2024-25, the look mostly
  reproduces a known number. "Power" there only measures how likely a wiring error is to show up.

---

## 3. The five cycles, ranked by expected gain per cost

| rank | cycle | slot | pre-registered primary metric (protocol) | expected effect vs previous version | approx. power on 2024-25 | already scored on 2024-25? | cost |
|---|---|---|---|---|---|---|---|
| 1 | Prediction heads in predict() | v6 | Open-regime winner log loss (branch 1) | open -0.004 (about -0.014 if v5 feeds openers to close-trained weights); no line -0.005; close -0.002; 7-bin -0.005 to -0.012 | open ~0.85, no line ~0.8, close ~0.4, 7-bin ~0.25 | yes, every ingredient | 6-9 agent-h; ~1 CPU-h |
| 2 | Market props for how and when | v7 | 7-bin in the close+props regime (branch 2); winner held fixed, so this is method given the winner | 7-bin -0.005 to -0.015; method -0.003 to -0.009 | 0.15-0.8 (about 0.5 at -0.010) | partly (blend vs props on 830 fights) | 3-4 h; <15 CPU-min |
| 3 | Stat-line fidelity | v8 | Control deviance (branch 2); attempts and landed secondary | control -1.5 to -4 s; attempts -0.4 to -1.0; landed -0.1 to -0.3 | 0.7-1 for control and attempts if the train gap transfers | embeddings yes; retarget and TD-intent draw no | 5-7 h; 1-2 CPU-h |
| 4 | Levels, drift, walk-forward calibration, joint level pass by format | v9 | Sig-landed deviance plus the base-rate drift table (branch 2) | sig landed -0.2 to -0.4 if the +9% drift survives v5; no-line winner -0.001 to -0.003 | 0.65-1 on sig landed; winner ~0.1 | per-card refits yes (blind replay); levels no | 6-8 h; ~1 CPU-h |
| 5 | Newcomer path, explainer coherence, freeze | v10 | Capability rule: backtest-universe predictions bit-identical | debut bouts outside the scored universe (method vs base rates about -0.03 to -0.04 per debut bout); scored numbers unchanged | not measurable on the backtest or the vault | the pre-UFC numbers, yes | 8-12 h; ~1 CPU-h |

**Why this order.**
- **Rank 1** is the only verified winner gain left, and it is the base every later cycle is measured against.
- **Rank 2** is cheap and builds on rank 1's S2 cells. Its best clean evidence is weaker than it looks (see below).
- **Rank 3** is the cycle most likely to pass the decision rule, but it does not move winner or method.
- **Rank 4** is mostly insurance, plus a level fix. It comes after rank 3 because the stat-line retarget and the
  level passes interact, and the re-levelling should happen once.
- **Rank 5** leaves every scored number unchanged, so it is the safest change right before the final audit.

**Cost caveat.** Costs are the planners' estimates. The shared machine has run at load 26-50 all day, so treat them
as optimistic.

### Cycle 1 (v6): ML v2 heads inside predict(), line routing, predict harness

**Merges:**
- planner 1 v6 (ML v2 stacks, S2 cells, routing);
- planner 2 v10 item 5 (a predict harness in evalv);
- blend_anchor's conditions 2 and 4 (score predict, not summarize; refit pool weight, slope0 and engine weight on
  the merged engine);
- the routing finding behind the forward ledger's pre-registration.

**Goal.** FightEngine.predict() returns the verified ML v2 family, so every scored regime runs the best verified
heads:
- **Winner.** One stack per line regime:

  | regime | stack |
  |---|---|
  | no line | ML v2 + market rating, half-life 1.5 y |
  | open | open + ML v2 logistic |
  | close | market + ML v2 |

- **Method and round.** S2+ml2win cells replace S in the simulator/S pool. The pool weight w is refit on the v5
  engine.
- **Routing.**
  - Any line not known to be the true close goes to open-trained weights.
  - Close-trained weights are used only for true closing lines: backtests and results pages.
  - No hours-to-bell knob. The ledger's supporting check found open-trained weights at least as good at the
    open/close midpoint.

**Evidence:**

| claim | numbers | source |
|---|---|---|
| No-line ML v2 stack vs current experts | CV 2021-23 0.62854 vs 0.63646; 2024-25 0.5898 vs 0.5949, -0.0051 [-0.0086, -0.0015] | research/model_ml2.md §4, §6 |
| Open regime | CV 0.62275 vs 0.62840; 2024-25 0.5812 vs 0.5852, -0.0041 [-0.0066, -0.0014] | same |
| Close regime | CV 0.61614 vs 0.61922; 2024-25 0.5766 vs 0.5788, -0.0022 [-0.0043, +0.0001] | same |
| Blind replay, ML v2 as an extra MoE expert | no line -0.0038 [-0.0085, +0.0013]; close -0.0018 [-0.0040, +0.0006] | research/model_blindtest.md |
| Close-trained weights fed an opener | +0.0099 [+0.0064, +0.0133] (ML v2); +0.0102 [+0.0057, +0.0145] (MoE) | model_ml2, model_blindtest |
| Close-trained minus open-trained, fed the open/close logit midpoint | +0.0065 [+0.0033, +0.0095]. A supporting check, **not verified** | data/predictions/README.md |
| S2+ml2win vs S | CV 2020-23: 7-bin -0.0325 [-0.0439, -0.0204], method -0.0075 [-0.0141, -0.0009]. 2024-25: 7-bin -0.0367, method given winner -0.0072 [-0.0176, +0.0031] | model_ml2 §7 |
| How much of that is the winner | S + the ML v2 winner alone: 7-bin -0.0298 [-0.0398, -0.0193] | model_ml2 §7 |
| Pool vs rescaled simulator | 7-bin -0.0223 [-0.0317, -0.0126]; S alone vs pool +0.0014 n.s. | components/blend_anchor.md |

v5 already rescales S to the MoE winner. So over v5, the method gain is roughly the S2 method-given-winner term
(-0.007, n.s.) plus the effect of a sharper winner. Expect well under the -0.0367 above.

**Work:**
1. Wire ML v2's page stacks into predict() through `opts.moe` (or a new `opts.winner`):
   - validation and vault runs use the at-or-before-2023 weights from tools/ml2.py;
   - the page uses `page_model.stack`.
2. Pre-register "score what ships": the JS logistic-based stacks.
   - CV preferred the blend-based no-line stack, 0.62854 vs 0.62984.
   - 2024-25 favoured the logistic, but that is one look and not a reason to switch.
   - Build a JS tree evaluator only if it is cheap.
3. Port the S2+ml2win evaluator to JS by extending tools/methodround_model.js, fed through `opts.mrCells`:
   - backtests use walk-forward `fights[id]` cells;
   - live use takes roster inputs.
4. Refit on the v5 engine, forward-chained on 2019-23: pool weight w, slope0 and the engine expert weight.
5. Add an explicit line-type field (`none`, `open`, `close`) to predict() and the ledger. Add a routing test proving
   an opener never reaches close-trained weights.
6. **Predict harness.** Extend tools/evalv.js (or add a companion) to score predict()'s package in all three
   regimes, plus soft CE vs the close as a screen.
   - Both corner orders.
   - At-or-before-2023 stackers and walk-forward cells, never production defaults.
   - The v5 package must be scored in the same harness and regimes, paired, as part of this look.

**Train-only acceptance test (binding, run before the look).** Forward-chained 2021-23: stack weights fit on
2019..Y-1 out-of-fold rows and scored on year Y. ML v2 uses annual out-of-fold logits; S2 uses methodround's fold
cells. The v6 package is paired against the v5 package on the same fights. Pass only if all hold:
- Open and no-line winner improve with CIs excluding 0, and each point estimate is at least -0.001 (2x the 0.0005
  rule). ML v2's blocks were CV-chosen on years that include 2021-23, so the gate is optimistic.
- Close is not worse: CI upper bound ≤ +0.0005.
- 7-bin improves with a CI excluding 0. Method is not worse: upper ≤ +0.002.
- Corner swap: max |p(A,B) + p(B,A) - 1| < 1e-12.
- JS and Python cells agree to 1e-9 on 40 pairs. Flag-off identity holds.

**Validation target.**
- **Primary (branch 1):** open-regime winner log loss vs v5's package on the same 843 fights. Expected -0.004.
  - If v5's harness fed openers to the close-trained MoE weights, expect about -0.014, because routing then also
    removes the +0.010 penalty.
- **Why open is the primary.** It is the regime the forward ledger and the page actually run, and its paired CI is
  the tightest of the three that has a real effect left.
- **Secondary:**
  - no line: about -0.005 (0.5949 to about 0.590);
  - close: about -0.002, expected n.s.;
  - 7-bin -0.005 to -0.012, method -0.002 to -0.006, both likely n.s.;
  - calibration slope per regime.

**Protocol.** Decision rule branch 1 on the pre-registered regime. It is a confirmation look: every ingredient has
been scored on 2024-25.

**Risks:**
- If v5's harness already passed ML v2 stacks or S2 cells, this cycle shrinks to routing plus whatever is missing.
- ML v2 depends on the builds of ratings.json, preufc.json and market.json. Clear the ml2 cache on any rebuild.
- The production no-line weights are sharper than the validated ones (sum 1.42 vs 1.26). See the drift rule in 6.5.
- Page size: ml2.json `page_model` is about 1.1 MB, and S2 JS inputs come on top.

### Cycle 2 (v7): market props for how and when

**Merges:** planner 1 v7. Planner 2 has no counterpart.

**Goal.** When method, distance and round props are posted, method given the winner and round given a finish come
from a log-linear pool of S2 cells and the de-vigged props. A decision-share debias is fit on train. The winner
stays with cycle 1's stack, bit-identical.

**Evidence (clean window only):**

| claim | numbers | source |
|---|---|---|
| Props carry much method information | 6-way method: tune 1.5560 vs moneyline x base rates 1.6479 [-0.117, -0.066]; 2024-25 1.4770 vs 1.5638 | research/model_market.md §4.15 |
| S2+ml2win vs props, 2024-25 (830 fights) | method +0.0017 [-0.0146, +0.0168]; 7-bin +0.0117 [-0.0167, +0.0396] | research/model_ml2.md §7 |
| 40/60 blend vs props, 2024-25 | method -0.0071 [-0.0136, -0.0007]; 7-bin -0.0127 [-0.0248, -0.0007]. Weight chosen on 2021-23 | model_ml2 §5, §7 |
| The market over-prices finishes | P(decision) predicted 47.4% vs 49.5% observed on tune (about 1.5 SE); 47.5% vs 54.2% on 2024-25 | model_market §1 item 6 |

**Not citable as validation evidence:** methodround's "props beat SM on method given the winner by +0.0277
[+0.0078, +0.0480]" (+0.0264 on the current market.json), and its round-given-finish tie. Their held-out window is
2024-01-01 to 2026-10-31, which contains the vault.
- On clean data, S2 ties the props on method, and the blend beats both.
- The method-given-winner gain is therefore plausible but **not verified on a clean window**.

**Work:**
1. Build 7-bin and round cells from per-book props: market.json per-book closes for 2021+, and
   data/raw/odds/bfo_event_props.csv.
2. Use one de-vig everywhere. Training used power de-vig averaged over US books. tools/odds_upcoming.py applies
   Shin to the 7-way retail method market (about 18% margin). Pick one and use it in training, the ledger and the
   page.
3. Fit pool weights separately for method given the winner, round given a finish and P(decision), forward-chained
   on 2021-23.
4. Fit a P(decision) logit shift on 2021-23 outcomes only, as a labeled knob.
5. Add `predict(opts.props)`. With no props, the package is unchanged.
6. The ledger captures props with the moneyline: same snapshot, recorded hours before the lock.
7. Pin the market.json build hash. The methodround SM-vs-market gap moved between builds.

**Train-only acceptance test.** Forward folds on tune fights with props: fit 2021 and score 2022; fit 2021-22 and
score 2023. About 1,203 tune fights have per-book props. LOYO is a secondary check. Pass if:
- 7-bin vs cycle 1's close-regime cells has a CI excluding 0 (the winner is fixed, so this is method given the
  winner);
- method is not worse;
- round given a finish is not worse by more than 0.002;
- P(decision) is within 2 points of observed on the scored folds;
- winner log loss is bit-identical to v6.

**Validation target.** Close+props regime, branch 2, primary 7-bin: expected -0.005 to -0.015 vs v6. Secondary:
method -0.003 to -0.009, and P(decision) within 2 points of the 2024-25 actual. MDE for a change in method given the
winner alone is about 0.015, so a pass is less likely than not even if the effect is real. The no-line and open
regimes are unchanged.

**Risks:**
- Only two forward folds.
- Ledger props come from the prediction-time snapshot, about T-25h to T-8h, not closing props.
- Books per fight average 4.7-4.8.
- A finish debias fit on train (2.1 points) under-corrects if the 2024-25 shift persists, and fitting it on 2024-25
  is not allowed.
- No props exist for a hypothetical matchup until they post.

### Cycle 3 (v8): stat-line fidelity

**Merges:** planner 2 v6 (realised-rate retarget, TD-intent draw, PIT diagnostics) and planner 1 v10 part 1 (the
embeddings blend in the learned-rate path and in predict()'s `mlPred`).

**Goal.** The simulator's realised stat lines, which the page shows and the judges score, should be at least as
good as the best verified stat-line model, with an honest per-fight spread.

**Evidence:**

| claim | numbers | source |
|---|---|---|
| The engine loses information between its learned inputs and its realised lines (train 2019-23, v4 final) | ML static rates beat the realised lines: sig attempts -0.249 [-0.406, -0.085], sig landed -0.114 [-0.199, -0.024], head -0.112 [-0.188, -0.032], leg -0.042 [-0.076, -0.009], control -2.15 s [-3.11, -1.20]. No stat worse | components/blend_anchor.md, verifier ablation |
| Embeddings on top of mlrates, train time-ordered CV 2019-23 | control -1.90%, distance accuracy -1.92%, head accuracy -1.83%, TD attempts -1.63%, head attempts -1.28%. 14 of 18 targets kept | research/model_embed.md (stat-line table) |
| Same on 2024-25 (already seen) | -1.67% [-2.11, -1.24] over 18 targets; newcomers -1.51% | research/model_embed.md |
| SOS "wf", already in v5 (train) | TD attempts -1.13%, TD landed -0.77%, control -0.70% | components/styles_sos.md |
| TD attempts too narrow per fight | 74% of real values inside the simulated 80% band, 16% above P90 | components/realism_sens.orig.md. Builder's report on an in-flight engine; **not re-verified** |
| Stat lines are detectable | v4 vs v3: all five stat deviances significant on validation (control -10.3 [-14.0, -6.6]) | CHANGELOG v4 |
| Lesson from v4.0.1 | Matching the means of skewed counts worsened MAE: TD +0.017, control +1.48 s | CHANGELOG v4.0.1 |

**Work:**
1. Run `tools/realism.js report` on the merged v5, train only. Tabulate realised per-minute rates against the ML
   targets by stat and position.
2. Retarget pass in matchup():
   - a common-random-number pilot of 200 sims per order;
   - a damped per-side correction of attempts by position, accuracy odds, TD attempt rate and the control target;
   - 1-2 iterations, capped by mlMaxRatio, cached per matchup;
   - KD, conversion and stoppage levers untouched.
3. Use `FightEmbed.blendMLRates` with the CV-selected 14-target recipe in the learned-rate adapter and in
   `mlPred`. Backtests use the fight's snapshot vectors, never roster vectors.
4. Add a fight-level, mean-preserving lognormal TD-intent draw, with sd fit to the train PIT.
5. Add per-stat PIT coverage to evalv as a reported, pre-registered diagnostic.
6. One flag per sub-part. Ablate against SOS "wf" and mlTdLevel / mlCtrlLevel so overlaps are measured, not
   assumed.

**Train-only acceptance test.** 2019-23, 1,999 fights, both orders, common random numbers, out-of-fold mlrates and
embed snapshots, leave-one-out per sub-part. Keep a sub-part only if:
- total 10-stat Poisson deviance improves (CI < 0), with no single stat worse;
- TD and control MAE are not worse beyond the CI;
- TD-attempt PIT: inside the 80% band ≥ 0.78, above P90 ≤ 0.12;
- winner, 7-bin and method CI upper bounds ≤ +0.002;
- KO/SUB/DEC shares, KD per 100 head, TD per 15 and control per 15 stay inside the mlcal tolerances.

**Validation target.** Branch 2, with control deviance as the pre-registered primary.

| metric | expected change | v4 level | MDE |
|---|---|---|---|
| control | -1.5 to -4 s | 154.1 | ~1.5 s |
| attempts (secondary) | -0.4 to -1.0 | 43.4 | ~0.46 |
| sig landed (secondary) | -0.1 to -0.3 | 21.9 | ~0.24 |

- Winner, 7-bin and method within ±0.002.
- These expectations extrapolate the train gap above and are untested for the retarget and the TD draw.

**Risks:**
- Double counting with SOS "wf" and the learned-path levels.
- More landed strikes raise KD counts: recheck KD per 100 head and the finish rate.
- MAE can worsen on skewed counts.
- The embed matrices add 0.2-0.5 MB to the page.
- No effect on outcome metrics, since the simulator's winner weight is about 0.

### Cycle 4 (v9): walk-forward levels, drift and calibration, with the joint level pass by format

**Merges:**
- planner 2 v7 (era levels, walk-forward judging);
- planner 1 v8 (per-card stack refits, method-head level offsets, drift monitor);
- the level-type items of planner 2 v9: durability's five-round double count, the doctor/corner rate and the joint
  level pass by format;
- planner 1 v10 part 2 (round-cell pool by format), as a flagged test only.

**Goal.**
- Simulated pace, accuracy, grappling, KD and scoring follow trailing walk-forward league levels instead of a lagged
  5-year calendar window.
- The method head's KO/SUB/DEC levels track the same level.
- predict()'s stack weights are refit before every card from earlier fights only.
- A pre-registered rule governs the production recency stretch.

**Evidence:**

| claim | numbers | source |
|---|---|---|
| Validation drift (v4, actual vs simulated) | sig landed per 15 58.1 vs 63.3 (+9.0%); KD per 100 head 0.684 vs 0.746 (+9.0%); finish 46.0% vs 48.5%; decisions 54.0% vs 51.5% | CHANGELOG v4 |
| Drift exists inside train | KD per 100 head 0.751 (2019-21) vs 0.822 (2022-23) while the simulation stays flat; period-fit division factors push it further off out of fold (\|gap\| +0.037) | components/realism_sens.md |
| League KD level moves | 8.25 per 1,000 head strikes in the year before the 2024 glove trial, 5.95 during it, 8.98 after; L730 won tuning narrowly (4,339.1 vs 4,342.6 for L365) | research/model_durability.md §6 |
| Judging drifts | KD weight up 79% per decade. 10-8 rate per judge-round inside train: 5.9% (2019), 6.0% (2020), 4.0%, 3.1%, 3.6% (2023) | research/model_officials.md §3.4, §3.6 |
| The "last year" 10-8 rule (train) | held-out 10-8 log lik: "last" beat "avg2" and "all" at every tau | components/officials.md, parameter table |
| Recency helps the stack a little | rolling origin inside 2019-23: h=1 + temperature 0.6350 vs none 0.6365, -0.0014 [-0.0033, +0.0005]; the fitted temperature rose 0.94 → 0.98 → 1.05 | components/blend_anchor.md, Recalibration (c) |
| Per-card refits (validation window, already seen) | no-line stack refit per card vs frozen: -0.0047 [-0.0113, +0.0025], slope 1.06 vs 1.31. ML v2 stacks rolling vs static: no line 0.5875 vs 0.5898 | model_blindtest, model_ml2 |
| Production stretch risk | if 2026 looks like 2019-23, the sharp production no-line weights cost 0.013 (0.6556 vs 0.6425). Fit through T and scored on T+1, they under-stretched in 2023, 2024 and 2025 | research/model_moe.md |
| No second temperature on top of per-card refits | moe_noline_rt +0.0005, moe_close_rt -0.0001 | model_blindtest |
| Five-round level problems (train) | durability's five/title terms on top of caution5: 5-round KD per fight 0.448 vs 0.547 actual. Doctor/corner after R3/R4 2.4% / 4.5% simulated vs 1.2% / 0.7% real (3 events in 301 rounds). 5-round KD per 100 head about 25% low; a format factor of about 1.3 holds out of fold | components/durability.md, dynamics.md, realism_sens.md |

**Work:**
1. **tools/levels_wf.py.** Trailing league levels per date, from fights strictly before each date:
   - sig attempts, accuracy by target, TD attempts and accuracy, control, sub attempts, and KD (reusing durability's
     tracker);
   - league-pooled, with fixed division ratios;
   - the engine takes `opts.level`, and the mlrates `leagueExpect` re-levels to it (add it to the cache key).
2. **Walk-forward judging.** Per-year EM weights from judge_em_train-style windows ending at Y-1, shrunk toward the
   multi-year fit. A per-year 10-8 threshold set by the "last year" rule.
3. **Method-head offsets.** Walk-forward offsets on the 6-class intercepts, symmetric by side, from trailing
   365/730-day shares, shrunk with pseudo-fights. Tie them to the same KD level so the head and the simulator see
   one level.
4. **Per-card refits.** predict()'s weight provider refits per card, reusing tools/blindtest.py's per-card refits,
   with the half-life chosen on train.
5. **The drift rule.** Pre-registered in section 6.5 of this plan.
6. **Joint level pass by format, once:**
   - remove durability's five/title terms where caution5, r1Caution5 and kdLevel5 already act;
   - fit doctor/corner per-round-reached rates on fights up to 2023 with a strong prior;
   - add the 5-round format KD factor only if the gap is still more than 2 SE after the pass;
   - fit KD by format, KO/SUB shares and conversion jointly. Never two independent KD scales.
7. **Flagged, off unless they pass on train:**
   - a within-round hazard ramp;
   - format-specific simulator-vs-S2 pool weights for round cells, tested only if the v5 engine now beats S2 on
     round given a finish on train (v4 was +0.0153 [+0.0039, +0.0264] worse than S).

**Train-only acceptance test.** Rolling origin: window and half-life chosen on 2019-20, confirmed on 2021-23, levels
always from earlier fights. Pass if all hold:
- Year-level base-rate error falls (CI < 0 on 2021-23) for sig landed per 15, accuracy, KD per 100 head, TD and
  control per 15, and finish rate.
- Sig-landed deviance on 2021-23 improves (CI < 0). Total stat deviance is not worse.
- Per-card stacks beat annual-static stacks on 2021-23 no-line log loss (point ≤ -0.002 or CI excluding 0), and no
  regime is worse.
- Method-head offsets beat static intercepts on method log loss pooled over 2015-23 cards (CI excluding 0).
- Replayed over 2015-23, the drift rule fires at most once.
- 5-round R4 KO-type and R5 SUB hazard CIs cover the real values, and doctor/corner is ≤ 1.5x the 2019-23 rate.
- Winner, 7-bin and method upper bounds ≤ +0.002.

**Validation target.** Branch 2, with sig-landed deviance as the primary:
- expected -0.2 to -0.4, if the +9% drift survives v5 (MDE about 0.24). A 9% mean bias on about 40 landed strikes
  per fighter-fight adds about 0.3 deviance units, my rough calculation;
- base rates: sig landed per 15 within ±4%, KD per 100 head within ±5%, finish rate within ±1.5 points;
- no-line winner -0.001 to -0.003, below the MDE.

Its main value is insurance, and the look cannot measure insurance. Branch 2 can fail even if the work is right.

**Risks:**
- The decision to fix drift was informed by the v4 validation base-rate table, a mild selection. The train gate is
  binding.
- Noise in small divisions: pool the league level.
- Double counting with durability's level and with mlrates' year feature.
- The rule reacts with a lag.
- The 2026 KO surge (about 40% KO/TKO) is known in aggregate from the durability note. It must never be used to
  justify the tracker or to set its window.

### Cycle 5 (v10): newcomer path, explainer coherence, then the freeze for audit 2

**Merges:**
- planner 1 v9 (the debut path);
- planner 2 v10 (anchor direction from data, calibrated cell and stat-line bands, the final realism report);
- the freeze and the audit-2 pack.

**Goal.**
- Bouts with a debutant get a real path in predict() and in the forward ledger. Today the ledger gives them the
  line, seeded Elo, and division base rates for the method.
- The traced fight shown on the page is coherent with predict()'s numbers.
- None of this changes a scored backtest prediction.

**Evidence:**

| claim | numbers | source |
|---|---|---|
| Seeded Elo for newcomers (0-3 prior fights) | pooled 2019-25 -0.0156 [-0.0246, -0.0064]; 2019-23 CV years alone -0.0115 [-0.0224, -0.0001] | research/model_preufc.md |
| UFC-stat logistic + pre-UFC block | 2019-23 -0.0061 [-0.0121, -0.0003]; pooled -0.0078 [-0.0127, -0.0028] | same |
| How it ends, newcomer bouts (2024-25, seen) | KO/SUB/DEC: base rates 1.0193, UFC finish rates 0.9890, + pre-UFC 0.9776. Per-side win by KO -0.0123 [-0.0207, -0.0039], win by SUB -0.0138 [-0.0228, -0.0043] | same |
| On top of a line | -0.0025 [-0.0082, +0.0036]: nothing | same |
| No-line stack runs hot on newcomers | slope 0.81 on 258 bouts; +0.0166 vs the close | model_blindtest |
| The anchor needs better grounding | the anchor mix was picked among 4 on a third of train; an accuracy-only anchor worsened sig landed +0.215 [+0.017, +0.414]; raw interval covers the close only 55% at nominal 80% (hence kappa 1.65); per-fight width carries little information (corr 0.03) | components/blend_anchor.md |
| The anchor is stretched on the page fight | Volkanovski vs Gaethje with the opener needs \|s\| 1.36 against a train p90 of 0.92: Volk power x0.41, accuracy odds x0.71 | components/blend_anchor.md |

**Work:**
1. **Debut universe.** 2015-2025 dev decisive bouts with a 0-prior side, using preufc's strict snapshots and
   presence rule.
   - Out-of-fold ML v2 predictions on debut rows.
   - A forward-chained no-line debut stack: seeded Elo, pre-UFC logistic, ML v2.
   - Debut method cells from preufc's per-side finish models, or S2 extended with faded pre-UFC rates, replacing the
     ledger's base-rate method.
   - With a line, no pre-UFC term on top of it.
   - New fwd version in the ledger. Coordinate with fwd-4.1's debut seeding so there are not two versions.
2. **Explainer.**
   - Estimate the anchor direction on train: regress actual-minus-simulated stat residuals on the
     blend-minus-simulator logit gap, LOYO.
   - Optional: a second anchor on finish propensity.
   - Calibrate method x round and stat-line 80% bands kappa-style on train.
   - Run the full tools/realism.js report by division and format.
   - Produce the sensitivity tornado per matchup.
   - Add build.py slots for blend.js, moe/ml2 JSON and the S2 evaluator, within the page-size budget.
3. **Freeze.** Write the audit-2 pre-registration (section 6.7) before the v10 look.

**Train-only acceptance test:**
- **Debut, forward-chained 2019-23:**
  - the no-line winner beats seeded Elo (the ledger's current fallback) with a CI excluding 0;
  - method beats division base rates with a CI excluding 0;
  - with a line, line plus the debut model is not worse than the line alone (upper < +0.001);
  - backtest-universe predictions are bit-identical.
- **Explainer, LOYO:**
  - anchored cells within a median total variation of 0.02 of the package;
  - P(finish) within 0.01;
  - stat-line 80% bands cover 78-82% per stat;
  - the P(win) 80% interval covers the close 77-83% per fold;
  - corner symmetry holds.

**Validation target.** Capability rule:
- every scored 2024-25 number is identical to v9's (bit-identical on the backtest universe; the explainer does not
  move predict()'s point outputs);
- the debut path is reported on the 2024-25 debut universe as a capability check. It is not clean: preufc scored
  2024-25, and three of its earlier evaluations pooled 2024-2026.

**Risks:**
- The debut-only sample is small; the planner's estimate is about 170 decisive 2024-25 debut bouts, unverified.
- Sherdog completeness for small shows cannot be measured.
- Age may be counted twice, since the ratings carry a newcomer age prior.
- The vault has no debut bouts, so only the forward ledger tests this path.
- Page size.

---

## 4. Branches

### 4.1 If v5 is kept vs rejected

| | v5 kept | v5 rejected |
|---|---|---|
| Base for v6 | v5's predict() package | v4 (summarize only). predict() does not exist in the current engine, so v6 = v4 + blend_anchor + cycle 1 |
| Judging contamination | gone (v5 carries the train-only EM weights) | v4's EM weights were fit on cards through 2026-10: validation years and the vault. v6 must carry judge_em_train.json. Under a gain-only rule that hygiene can be rejected again (the v4.0.1 precedent), so Kira's call on a hygiene branch (section 7) becomes urgent |
| v5 components | measured | Use v5's train leave-one-out to decide what re-enters. Durability (train 7-bin -0.0073, method -0.0042) re-enters inside v6's single look. Dynamics and SOS "wf" re-enter only as realism capabilities that are not worse. Do not re-measure v5 as such: that would be an extra look |
| Scored object | | If v5 failed on summarize metrics while its package improved, the rule judged the wrong object. Pre-register for v6 on that the package is the primary scored object (section 7) |
| Cycle 4 scope | depends on whether v5's joint durability+dynamics pass closed the 5-round KD gap (train 0.448 vs 0.547 per fight) without the R1 overshoot (0.144 vs 0.105). If it did, cycle 4 drops the format items | cycle 4 keeps the format items and the dynamics level pass |
| Cycle 3 | ablate embeddings against SOS "wf" | SOS "wf" is absent, so the overlap test is moot |

### 4.2 Vault audit 1: does the 2024-25 underconfidence persist?

**Read the size of the vault first.** The engine slope CI on 853 fights was about ±0.35 (1.72 [1.39, 2.09]). On
about 370 fights, expect about ±0.5. **The most likely outcome is "inconclusive"**, and the default must be written
for it.

| audit 1 shows (mirrored slope of the frozen production no-line stack, 95% CI) | response | what stays fixed |
|---|---|---|
| Persists: CI excludes 1, point ≥ 1.2 | Keep the production recency settings (no line: h 1.5 with T 1.17 for MoE; ML v2 production weights sum 1.42). Cycle 4's per-card refits gain priority. **Do not fit a temperature on 2024-25**; this overrides research/model_ratings.md recommendation 4. Validation looks keep using at-or-before-2023 fits and will keep showing slopes above 1. That is expected, not a reason to change them | the at-or-before-2023 validation protocol |
| Reverts: point < 1.15 and CI includes 1 | Apply the pre-registered production switch (section 6.5): no-line stack h 1.5 → 3, temperature → 1. This is the fallback the moe and ML v2 notes already name. Expect the with-line edge over the close to shrink to the 2021-23 level (-0.0015 n.s.) and stop claiming it. Audit 2 cannot evaluate the switch cleanly (same fights); the forward ledger does | cycle order, primary metrics |
| Inconclusive (anything else; most likely) | No production change. The drift rule keeps running on forward-ledger outcomes only | everything |

**Two other audit-1 readouts that may move priorities only:**
- **Close edge.** If the with-line stack's edge over the close is absent on the vault, the ledger and page copy say
  "level with the market", and cycle 1 keeps its plan.
- **Method level.** If S, S2 or the engine misses the 2026 method mix in a way consistent with a level shift,
  cycle 4's method offsets move up in priority. But:
  - the justification must stay the train-period drift;
  - the 2026 KO surge was already visible in aggregate before the vault was sealed;
  - audit 2's method result for that component is then flagged as not clean.

---

## 5. Do-not-do list

**Protocol:**
- Do not tune, select or temper anything on 2024-25, and do not read 2026 fights outside the two audits.
  "Production refit through 2025 by a pre-registered procedure" is deployment, not selection. It is never scored on
  2024-25.
- Do not take a validation look without a new version entry, and do not give a component a second look of its own.
- Do not choose components by their 2024-25 numbers in research notes. That includes:
  - the model_dynamics §7.1 columns;
  - the embed, oppadj and officials validation deltas;
  - ratings_plus;
  - the ML v2 logistic-vs-blend gap;
  - the S3 2024-25 row.
- Do not cite the first-build "held-out 2024+" results of methodround (1,229 fights through 2026-10, 372 of them in
  2026), durability (2024 through 2026-10) or styles (1,223 fights through 2026-10) as validation evidence. This
  includes methodround's props-vs-SM method-given-winner gap, its "S yearly refit vs frozen", and its 5-round round-1
  KO calibration.
- Do not score validation or vault runs with production defaults: moe_page.json is refit through 2025 (T 1.17);
  methodround `js_model` is fit through 2026-10-31; roster-only extras.
- Do not use roster-table fallbacks in backtests (SOS or oppadj by slug, `prof.dur` without a date guard), and do
  not use live fighters.json profiles for past fights.
- Do not use vault audit 1 numbers to set any parameter. Only the pre-registered rules in 6.5 may react to it.
- Do not use forward-ledger results to choose components.
- Do not use soft CE vs the close as a decision metric. It is a screen; it rewards closeness to the market.
- Do not fit targets from all-years tables, such as baserates.json for 2015-2026 (the doctor/corner rates, the
  KO/TKO composition).

**Winner:**
- Do not spend a cycle earning the simulator winner weight:
  - validated weight 0.037 with the close and 0 without;
  - removing it from the stacks costs +0.0005 / +0.0009;
  - the mlcal search found nothing.
- Do not add style interactions or the archetype matrix to the winner:
  - 0 of 33 terms survive; the archetype matrix is +0.0029;
  - the ML v2 nested screen is -0.00049 in stack CV, under the 0.0005 rule.
- Do not add the 2019+-only sources to ML v2 (durability, oppadj, mlrates out of fold, methodround S): CV gain at
  most -0.0004.
- Do not add fight-week features (block CV -0.0002), the pre-UFC block on top of a line (-0.0025 [-0.0082, +0.0036])
  or the embeddings head on top of the stacks or the close (train CV rejects it).
- Do not build gated MoE, GBM meta-learners, or segment-specific stackers or temperatures:
  - the gate collapsed to constant weights;
  - moe_noline_nt +0.0011;
  - the seeded-Elo expert in the stack +0.0005.
- Do not add line movement on top of the close: +open -0.0019 [-0.0048, +0.0010]; 0 of 17 variants significant.
- Never feed an opener or a moving line to close-trained weights: +0.0099 / +0.0102. Do not add a capture-time
  switch without new train evidence.
- Do not add a second temperature on top of per-card recency stacks (+0.0005 / -0.0001). Do not adopt a temperature
  fit on 2019-23, where ML v2's out-of-fold slope is 1.00. Do not fix 2024-25 underconfidence inside the engine.
- Do not use ratings_plus on the page: post hoc, with negative weights on correlated Elo logits.

**Method and judging:**
- Do not use S3 (S2 + durability + style z) for method: +0.0044 joint in CV.
- Do not calibrate finish rates to the method props. The market over-prices finishes; calibrate to outcomes.
- Do not mix de-vig methods between training and live props.
- Keep officials off the prediction path:
  - named-judge effects worsen the decision winner in all three windows;
  - the league model is +0.0092 worse;
  - referee taus are about 0.
- Do not add the home-abroad judging term on the strength of 2024-25: -0.0105 there, +0.0043 on 2019-23.

**Simulator:**
- Do not add damage-driven KD hazard or output decay: KD per strike -4% per 10 head strikes absorbed (SE 4%); output
  +0.1% per 10.
- Do not model between-round adaptation in output or takedowns: -0.9% (SE 0.9%).
- Do not use KD momentum x1.05 for the dropped man; the corrected value is about x0.95. Do not cut dyn.vol to 0.3;
  train supports at most 0.5.
- Do not narrow individual form sds to "true" fight-night form (method x round +0.0108 [+0.0001, +0.0214]). Do not
  chase the fighters' output correlation (0.63 vs 0.85).
- Do not turn on the division realism factor layer: the spread is unstable across periods. Use the 5-round KD factor
  only if a gap above 2 SE remains after the joint pass.
- Do not run two independent KD level scales (dynamics kdLevel3/5 and durability kdCal). Use one joint level pass.
- Do not match the means of skewed counts by level alone without checking MAE and PIT (the v4.0.1 lesson).
- Do not apply style blocks on the learned-rate path (+0.37% stat lines). Do not stack SOS "oppadj" on SOS "wf"
  (+0.0011 soft CE). Keep oppadj's KD/chin, body-accuracy and submission factors off.
- Do not bring back durability's removed covariates: layoff, last-fight KO, quick return, tenure, career head
  strikes absorbed. Do not add a size tax: none was found on 7,982 fights, so size stays a labeled knob.
- Do not build cage-position or ground sub-position realism the data cannot check. The pressure proxy has AUC
  0.47 / 0.51.
- Do not anchor through accuracy alone (sig landed +0.215).

---

## 6. Selection protocol for v6-v10

### 6.1 Look budget

- **Five looks, one per version (v6-v10),** on 2024-25. Each is recorded in version_history.json, and tools/evalv.js
  refuses a second look at the same files. A version that fails still spends its look; v4.0.1 is the precedent.
- **Re-bundling.** A component that passed its train gate but sat in a failed version may be re-bundled into the
  next version once. It is then measured only inside that version's look.
- **Multiplicity.** Five looks on the same 853 fights, each with several metrics, inflate the chance of a false
  keep. The countermeasure is one pre-registered primary metric per look (6.2). Secondaries are reported and never
  decisive.

### 6.2 Pre-registration per look

Written into the version entry before the look runs:
1. **The scored object.** predict()'s package is primary. summarize() is used for stat lines and base rates.
2. **The primary regime** (no line, open, close, or close+props) **and the one primary metric**, with its branch.
3. **The secondaries.** Reported only.
4. **The train-gate result**, which must already have passed.
5. **The expected effect and the MDE** from section 2.
6. **What counts as failure.**
7. **Whether the look is a confirmation look,** meaning the ingredient was already scored on 2024-25. If so, an
   improvement is claimed only after vault audit 2 and the forward ledger.

### 6.3 Decision rule

**Current text** (version_history.json, v4.0.1 decision): "keep if validation winner log loss beats the previous
version with a paired 95% CI excluding 0, or is not worse and clearly better on 7-bin / method / stat-line deviance
(CI excluding 0) without base-rate drift". The ROADMAP's capability rule adds: a new capability checked against
data, with held-out numbers not worse.

**Proposed clarifications, for Kira to accept or change:**
- **"Not worse"** means the CI upper bound is at most: winner +0.002, 7-bin +0.005, method +0.003, each stat-line
  deviance +0.5% of its level.
- **"Base-rate drift"** means an mlcal-tolerance rate moves out of tolerance, or further from actual with a CI
  excluding 0.
- **Branch 2** is decided on the pre-registered primary metric only, not on whichever of eight metrics happens to
  pass.

### 6.4 Forward ledger

- **The only fully clean test,** but a slow one:
  - about 10-14 bouts per card;
  - about 70 bouts by Dec 20;
  - a paired log-loss CI against the market of roughly ±0.03-0.05.
- **It detects gross failure,** not the gains in this plan: a pipeline bug, a calibration blow-up, newcomer
  over-confidence.
- **It never selects components.**
- **Every kept engine version gets a new fwd version string,** pre-registered in data/predictions/README.md before
  the next lock (fwd-4.1 → fwd-6 ...):
  - v7 adds props capture;
  - v10 adds the debut path.
- **It is the clean test for anything chosen because of audit 1** (6.5).

### 6.5 Rules to pre-register now, before audit 1 is read

1. **Production drift rule.**
   - Default: the production no-line stack keeps h 1.5 and its temperature.
   - It switches to h 3 and T 1 if either holds:
     - (a) audit 1's mirrored slope for the frozen production no-line stack has point < 1.15 and a 95% CI that
       includes 1;
     - (b) the forward ledger's trailing-200-bout slope has a CI that includes 1 for two consecutive quarters.
   - No other setting reacts to audit 1.
   - Cycle 4's monitor implements (b) and records it in the ledger metadata.
2. **Audit 1 → audit 2 contamination rule.** Both audits use the same roughly 370 vault fights.
   - Any component, setting or priority chosen or changed because of an audit-1 number is listed in the audit-2
     report as "not clean on the vault".
   - Its clean test is the forward ledger.
   - Kira may instead split the vault: for example, audit 1 on January-June 2026 and audit 2 on July-October 2026.
     That keeps the two tests independent at roughly half the power each (section 7).
3. **Audit 1 scope.** Audit 1 should report:
   - v5 vs v4 paired, and both against the benchmarks: close, open, Elo, ML v2 logistic, frozen ML v2 stacks;
   - calibration slopes;
   - the close edge;
   - the base-rate table.

   It should also list the known pre-seal exposures of 2026 data:
   - methodround's committed note prints 2026 rows (n 372) for S and SM;
   - the durability note gives the 2026 KD level and KO share;
   - preufc ran three evaluations pooled over 2024-2026;
   - the first market and ml builds scored 2024-2026, including the Kalshi check;
   - styles' 2024+ window runs through 2026-10.
   - (Added Nov 7, 2026 by the v5.0.1 cleanup, before audit 1; v5 review.) The durability research (first commit 09:46 UTC Nov 6,
     after the protocol at 09:29) and the styles research (built 10:59 UTC) scored their held-out tables on 2024-01-01..2026-10-31,
     and `durability.json` held 373 walk-forward records of vault fights plus 2026 rows of its KD level series (2026H1, 2026H2),
     and the durability report quoted the 2026 KO share, an observed / expected ratio for 2026 and a Nov 2025-Oct 2026 KD rate.
     All of it sat in the repo for about 17 hours and was read by later agents, including the v5 review and the v5.0.1 agent (the
     review quotes the 2026 KD levels, KO share and O/E). Moved out on Nov 7: those items, the old `durability_verify.json`,
     `styles.json` and `styles_verify.json` are in the vault directory (`durability_vault.json`, `durability_verify_vault.json`,
     `styles_vault.json`, `styles_verify_vault.json`); the held-out tables were re-scored on 2024-25 only, and the reports were
     redacted. Consequences, pre-registered: (a) **KD / KO-level and durability results on the vault are not blind** for any
     version, in either audit, so the audit reports them as "seen-level" descriptives and they cannot confirm a KD / KO / durability
     claim; (b) **v6+ calibration must not read these numbers** (no KD / KO level, window or durability base may be chosen with them;
     the v5.0.1 knockdown-base check was run on 2019-2023 only, with a rule written before it ran, and kept the incumbent);
     (c) winner-level, stat-line and judging questions are unaffected beyond the items above.

   So the vault is close to clean for winner-level questions about new packages, but not for method or KD levels.

### 6.6 Look schedule and what each look can show

| look | primary | likely result, honestly |
|---|---|---|
| v6 | open-regime winner | passes if wired correctly (seen numbers) |
| v7 | 7-bin, close+props | about a coin flip, even if the effect is mid-range and real |
| v8 | control deviance | likely passes if the train gap transfers |
| v9 | sig-landed deviance and drift | passes only if v5 left the +9% drift |
| v10 | capability | identical numbers by construction |

### 6.7 Audit 2 pre-registration (frozen at the v10 freeze, before the v10 look)

- **Packages.**
  - v10 vs v5, paired; v4 as a reference.
  - Benchmarks: close, open, Elo, ML v2 logistic, frozen ML v2 stacks, S and S2.
- **Fits.** Everything fit through 2025-12-31 by the frozen production procedure, with no 2026 data. If v9's
  per-card refit was kept, a card-by-card walk-forward inside 2026, run once by the auditor, is a pre-registered
  secondary.
- **Regimes.** No line, open, close, and close+props where the vault has props. The market.json 2026 rows were
  exported to the vault directory; confirm props are among them before freezing.
- **Primary.** Open-regime winner log loss, v10 minus v5.
  - Expected cumulative gain: about -0.004 to -0.006 (power about 0.5).
  - If v5 fed openers to close-trained weights, about -0.014 (power high).
- **Secondaries.**
  - no-line and close winner;
  - 7-bin and method in each regime;
  - round given a finish;
  - stat-line deviances (expected to be the clearest pass);
  - calibration slope;
  - base-rate table;
  - the drift rule's state;
  - per-segment numbers as descriptive only.
- **Failure criteria, stated in advance:**
  - primary CI upper bound > +0.002;
  - any stat-line deviance worse with a CI excluding 0;
  - calibration slope outside [0.8, 1.6].
- **Report rules.** One report, no changes after it, and the exposure list from 6.5 attached.

---

## 7. Decisions needed from Kira before the v6 look

1. **Primary regime and metric per look.**
   - Recommended: open-regime winner for v6, 7-bin in close+props for v7, control deviance for v8, sig-landed
     deviance for v9, capability for v10.
   - Planner 1 preferred the no-line winner for v6.
2. **Scored object.** predict()'s package (recommended) or summarize().
3. **Hygiene branch.** Should a change that removes known contamination (for example, train-only judging weights) be
   kept if it is not worse? v4.0.1 shows the gain-only rule rejects hygiene.
4. **The "not worse" tolerances** in 6.3.
5. **Audit 1 side line.** Should audit 1 also score the frozen, already-verified ML v2 stacks and S2 cells as a
   pre-registered side line? Planner 1 asked this.
6. **Vault split.** Split the vault into two independent halves, or accept the contamination rule in 6.5?
7. **ML v2 trees vs logistic.** Build a JS tree evaluator, or ship and score the logistic? CV prefers the blend by
   0.0013 in stack CV.


### 7.1 Decisions taken (Nov 6, 2026, ~21:55 UTC, before vault audit 1 is read)

Kira's standing instruction is to proceed without asking, so Claude took these; Kira can override any of them
before the look it governs (an override after a look is read counts as selection and is recorded as such).

1. **Primary regime and metric per look: the recommended set.** v6 open-regime winner log loss; v7 7-bin in
   close+props; v8 control deviance; v9 sig-landed deviance (with the drift monitor); v10 capability (identical
   scored numbers by construction). Everything else is a secondary, reported and never decisive.
2. **Scored object: predict()'s package** is primary; summarize() is scored for stat lines and base rates.
3. **Hygiene branch: yes.** A change whose stated purpose is removing a known contamination or leak (for example
   train-only judging weights, stance frozen from the earliest record) is kept when it is "not worse" by 6.3 on the
   look's primary metric and causes no base-rate drift. The look still counts; the entry is labelled "hygiene".
4. **"Not worse" tolerances: as proposed in 6.3** (CI upper bound winner +0.002, 7-bin +0.005, method +0.003,
   stat-line deviance +0.5% of level); branch 2 is decided on the pre-registered primary only.
5. **Audit 1 side line: yes.** Audit 1 also scores the frozen, already-verified ML v2 stacks (close-trained
   "model", open-trained "model_open", no-line) and the S2 / S2+ml2win method cells, fit through 2023 or through
   2025 exactly as frozen, as a pre-registered descriptive side line. Nothing is tuned on it.
6. **Vault: not split.** Both audits use the full sealed 2026 set; the 6.5 contamination rule applies (anything
   chosen or changed because of an audit-1 number is flagged "not clean on the vault" in audit 2, and its clean
   test is the forward ledger). Reason: at ~370 fights a half-vault cannot detect the expected 0.004-0.006 gain.
7. **ML v2 trees vs logistic:** ship the logistic now (it is what the page can evaluate); v6 builds a JS tree
   evaluator and, if the exported trees fit the page budget (<= 1 MB gzipped), the CV choice (the LR + LightGBM +
   XGBoost blend) becomes the production winner head. The choice follows CV, never 2024-25.
8. **Rules 6.5.1 (production drift rule) and 6.5.2 (contamination rule) are hereby pre-registered** exactly as
   written in 6.5, together with the audit-1 scope in 6.5.3 plus item 5 above.

9. **Amendment (Nov 7, ~05:00 UTC, before the v6 look; VALIDATION-INFORMED, recorded as such).** v5 and v5.0.1 both
   failed the decision rule only on the base-rate condition, through knockdown/KO levels inside the documented 2024
   glove trial (new gloves Jun 1 - Nov 15, 2024; research/model_eradrift.md). v5.0.1's KD per 100 head was 0.85 vs
   0.57 actual in 2024 but 0.81 vs 0.81 in 2025. An engine calibrated to standard gloves cannot pass a full-window
   KD/KO tolerance without being tuned to the trial, which the protocol forbids. So, for v6-v10 only (never applied
   back to v5 / v5.0.1): the base-rate condition of the decision rule is evaluated on the 2024-25 window EXCLUDING
   Jun 1 - Nov 15, 2024 (the announced trial dates), and the full-window base-rate table is still reported next to
   it. Every primary and secondary loss metric (winner, 7-bin, method, stat lines) keeps the full window. Rationale:
   an announced, temporary equipment change is exogenous to every model fit before 2024; v9's era work treats it as
   a logged variance bump, not a level. This amendment was written after two looks showed the problem, so any
   version kept because of it is flagged "kept under the glove-window amendment" in its entry and in audit 2.

10. **Amendment (Nov 7, ~08:00 UTC, after the v6 look, before any v7 work; the v6 review).** Binding for v7-v10 gates and
    looks. Items (c) and (d) are VALIDATION-INFORMED (the review read the v6 look's design and realised SE), recorded as
    such; none was chosen with a 2024-25 outcome of a v7 candidate, and none reacts to audit 1.
    - (a) **Comparator committed first, gate run once.** The gate's comparator definition (packages, input pipelines,
      stackers) is written into a protocol file and committed before any gate run; the binding gate runs once
      (tools/predict_harness.js --binding --protocol). Development runs are labelled non-binding and never decide.
      Reason: the v6 gate passed only under a comparator definition chosen after two failing runs (relabelled "failed as
      first run; passes only under a comparator chosen after the failure", version_history.json v6). Consequence: cycle
      1's parts are not gate-passed for the 6.1 re-bundle; they may enter v7 only through v7's own gate.
    - (b) **An honest comparator.** The comparator package gets year-by-year inputs exactly like the candidate: its
      per-year engine rows are rebuilt with the fold-honest learned-rate table and embedding recipe, its per-year stackers
      (cmp_stack_<version>_fit<Y-1>) refit on those rows, and both packages are fed the same honest inputs. The v6 gate gave
      the v5.0.1 package pooled weights, a leave-one-year-out recipe and stackers fit on rows built from them.
    - (c) **One refit schedule.** Both packages use the same refit schedule in gate and look: either both static fits
      through 2023, or both walk-forward (the candidate then uses ML v2's rolling rows). v6's look paired a static ML v2
      head against comparator experts refit before each card inside 2024-25.
    - (d) **Power from the gate.** The primary's MDE and power come from the train gate's paired SE for the same contrast,
      scaled by sqrt(n_gate / n_look) (python3 tools/predict_score.py power); the expected effect comes from the comparator
      actually used; power below 0.5 is stated in the pre-registration. v6's borrowed figure (power 0.85) was 0.26 by this
      rule.
    - (e) **Bootstrap precision.** Gate and look CIs use 20,000 event-cluster resamples (seed 7) with the Monte Carlo SE of
      each bound reported; a bound within 2 Monte Carlo SE of its threshold is marginal and is decided by the clustered
      normal bound (tools/predict_score.py).
    - (f) **Tests and ledger.** A pre-registration lists by name every test it tolerates failing (no narrowed voiding
      rule); the version's row in data/derived/val_look_ledger.json is committed before the look (the harness checks HEAD).
    - (g) **Live parity and deployment levels.** A version that carries the durability component passes
      tools/live_parity.js (live vs backtest knockdown base, KD per 100 head and finish rate within 10% on train pairs)
      before it serves the page or the ledger. Its live level, terms and norms follow this deployment rule, fixed now
      before any number is computed: level = the L730 tracker ending 2025-12-31; terms = the same Poisson fit with the
      data cut at 2025-12-31 at parse; norms = the exposure-weighted means of the live chin and power factors over
      2024-2025. It is deployment, never scored on 2024-25, and reads no 2026 fight (v6's level and terms_live did:
      trailing 730 days at Oct 31, 2026 and a fit through 2026-10-31).
    - (h) **The engine side of the prediction package.** An engine with predict() refuses, rather than silently returning
      the one-order summarize, when blend_anchor is on but FightBlend is missing; manualProfile keeps n_fights 0; the
      package bundles src/ml/blend.js 1.2.1 or later (line fallback, debut detection, the ml2stack interval with its own
      kappa).

---

## 8. Considered, not in the five

| idea | why not now | when to revisit |
|---|---|---|
| Per-fighter finishing tendencies in the simulator (planner 2 v8) | v4 vs S on train: method given winner +0.0150, method3 +0.0103 [+0.0018, +0.0195]; on validation +0.003, n.s. Expected method gain about -0.004, below the MDE of about 0.01. predict()'s method shape is about 85% S/S2 | if the v5 or v6 pool weight refit rises well above 0.15, or the S2 port leaves a simulator-vs-S2 gap on train |
| Within-round hazard ramp; 3-round R2/R3 shares (planner 2 v9) | Evidence is the realism builder's report on an in-flight engine, not re-verified. Expected round-given-finish gain about -0.004, n.s. | flagged sub-part of cycle 4 |
| Format-specific round-cell pool (planner 1 v10) | 243 train 5-round fights. Needs the v5 engine to beat S2 on round given a finish first | flagged test in cycle 4 |
| Two-dimensional anchor on finish propensity (planner 2 v10) | Explainer only. Can force extreme knobs on big simulator-vs-market gaps | optional in cycle 5 |
| Clinch-vs-distance style term (ML v2 open thread 6) | Screened in by every fold, but below the deployment rule and absent on 2024-25 | forward ledger only, as a descriptive check |

---

## Gaps (self-critique: missing or unverified)

**Inputs to this plan:**
- **One planner is missing.** Only two of the three planner outputs arrived, and the second was cut off inside its
  open questions. A third angle, for example a market-first or a realism-first angle with different priorities, was
  not merged.
- **v5's numbers do not exist yet.** All targets are relative to an unmeasured v5. Also unknown:
  - whether v5's predict harness already uses ML v2 stacks or S2 cells;
  - whether it scores an open regime;
  - whether it feeds openers to close-trained weights.

  Any of these changes cycle 1's expected effect by up to 0.01.
- **The dynamics verdict is known only through the backlog.** docs/BACKLOG.md marked dynamics verified at about
  9:40 pm UTC, after this plan's first draft. Its 7-bin and joint scores lean worse (n.s.), and its weak spots (3-round
  R2 KO low, 5-round R1 KO high, late submissions high) overlap cycle 4's format items. I did not read the
  verifier's full write-up.
- **evalv does not score predict() today.** That is blend_anchor's condition 2, and I found no `predict` call in
  tools/evalv.js. If v5 shipped without a predict harness, v5's look did not measure the package, and v6 must build
  the harness before its look.
- **The component reports live in the session scratchpad.** That directory is not in the repo and may not survive
  the session. Copy them into the repo before relying on this plan's citations.
- **Audit 1's pre-registration.** I did not see whether it exists, or whether it already fixes things that section
  6.5 proposes.

**Evidence quality:**
- **Cycle 2's best evidence includes vault fights.** The verified props-beat-stats gap on method given the winner
  comes from methodround's 2024-2026-10 window. On the clean 2024-25 window there is only "S2 ties props on method,
  the 40/60 blend beats both". The method-given-winner gain of a pooled cell set is not verified on a clean window.
- **Cycle 3's gains are extrapolations.** They extend the train gap between ML static rates and realised lines; the
  retarget pass has never been run.
- **The TD-intent spread evidence and the within-round timing evidence are unverified.** Both come from the realism
  builder's report on an in-flight engine.
- **The debut universe size is an estimate.** About 170 decisive 2024-25 bouts is the planner's number. preufc's 533
  "newcomer" bouts include sides with 1-3 prior fights, and I found no verified count of pure debut bouts.
- **The vault size is not checked.** About 370 is from docs/BACKLOG.md and methodround's 2026 row count. I did not
  open the vault.

**Approximations in this plan:**
- **MDEs and powers are rough.** They are scaled from observed paired CIs of other comparisons, not power
  simulations. Cycle-specific correlations could make them tighter or looser.
- **The +0.3 sig-landed deviance attributed to the +9% drift** is a back-of-envelope Poisson calculation.
- **Costs are planner estimates** on a heavily loaded shared machine.

**Unresolved design issues:**
- **De-vig mismatch for props.** Training uses power de-vig averaged over US books; the live capture applies Shin to
  retail-only method markets. Unresolved, and it affects cycle 2's live behaviour.
- **The two audits share one vault.** Section 6.5 handles this with a contamination rule or an optional split, but
  either choice costs something: cleanliness or power.
- **The forward ledger cannot judge anything in this plan within 2026.** About 70 bouts by Dec 20.
- **Page constraints are not costed.** Page size (ML v2 page model about 1.1 MB plus S2, embed and moe JSON) and the
  JS tree-evaluator question.
- **The Volkanovski vs Gaethje page fight.** It sits where the stacks and the simulator disagree most (anchor |s|
  1.36, beyond the train p90). None of the five cycles directly addresses how the page should present that
  disagreement, beyond cycle 5's anchor work.
