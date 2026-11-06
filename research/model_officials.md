# Officials model: judges and referees (v8 component)

Built Nov 6, 2026 (2:40 pm UTC run) by `tools/officials.py` from the ufcstats snapshot through Oct 31, 2026.
Outputs: `data/derived/officials.json` (league judging parameters with standard errors, a per-judge table with
posterior sds, region pools, per-referee multipliers and pools, held-out metrics, and an `engine` block for the
simulator to sample from) and this report. Fold pickles and logs are under `out/officials/` and `out/officials_*.log`
(gitignored). No 2026 fight was used for any fit or score (hidden-data protocol, docs/BACKLOG.md).

@@BOTTOM_LINE@@

## 1. Data

| | |
|---|---|
| Decisions modelled | 3,876 UFC decisions, 2001-01-01 to 2025-12-31, scheduled distance, round stats complete (dropped: 1 deduction text that would not parse, 4 without three cards) |
| Cards | 11,628 (three per fight), 452 named judges |
| Round scores | 3,182 decisions with all three judges' round-by-round scores, 154 with part of the panel, 540 with totals only. Round scores come from `tools/judgerounds.py` (MMA Decisions via the nlbair and Davies GitHub datasets; 99.4% of three-judge fights agree with ufcstats on all three totals) |
| Judge totals | Parsed from ufcstats DETAILS. ufcstats writes each card loser-first (6,655 of 6,657 unanimous cards, research/data_baserates.md); cards are mapped to A (first name in BOUT) and B by the fight's winner; draw cards are unordered and both orientations are allowed. "Point Deducted: ... by <name>" prefixes are parsed and stripped |
| Deductions | Known for 2,975 decisions (MMA Decisions raw vs published round scores, 2013-2025) plus those DETAILS records; latent (0, 1 or 2 points per fighter) elsewhere |
| Round stats | Per-round landed significant strikes to head, body and legs, knockdowns, takedowns landed, control time, submission attempts and reversals for both fighters (A - B differentials) |
| Home | Event country (from the event location) vs each fighter's home countries (Wikidata country-for-sport plus every citizenship, else birth country; CC0). 1,578 of 1,974 fighter names matched (1,543 by name, 35 by date of birth plus surname); both fighters known in 3,209 decisions; exactly one home fighter in 1,457 (963 at US events, 494 abroad) |
| Referees | ufcstats REFEREE column; 8,227 fights with round stats for the stoppage units |

Raw check before any model: in decisions with exactly one home fighter, the home fighter won 285 of 485 abroad
(58.8%) and 470 of 950 at US events (49.5%). The model below asks whether that survives conditioning on the round
stats (it does abroad, see 3.4).

## 2. Method

### 2.1 Judges: a round-level latent model with shared noise

In round r of fight f, judge j scores the round for A when z_jfr > 0, where

```
z_jfr  = exp(n_j) * [ exp(v_j + wV*t) * V_fr + exp(p_j + wK*t) * K_fr + exp(g_j + wG*t) * G_fr + h * home_f + u_fr ] + e_jfr
V      = b_head*dHead + b_body*dBody + b_leg*dLeg          (landed significant strikes, A - B)
K      = b_kd*dKD
G      = b_td*dTD + b_ctrl*dCtrlMin + b_sub*dSubAtt + b_rev*dRev
t      = (year - 2017) / 10
home   = [A is from the event country] - [B is];  h = h_USA at US events, h_abroad elsewhere
u_fr   ~ N(0, s_fr^2), shared by the three judges;  s_fr = sigma_u * exp(-kappa * |core0_fr|)
core0  = exp(wV*t)*V + exp(wK*t)*K + exp(wG*t)*G     (the league judge's stat edge, no home term)
e_jfr  ~ Logistic(0, 1), the judge's own noise
```

The round winner W gets a 10-8 with P = sigmoid(c0 + c_year + c_j + thV*V_W + thK*K_W + thG*G_W + thU*u_W)
(everything oriented to W); a 10-10 has a small fixed probability; point deductions come off the totals.

Judge effects (n sharpness, v volume weight, p knockdown weight, g grappling weight, c 10-8 propensity) are
Gaussian random effects with sds tau_k: the hierarchical part. Every effect is multiplicative on a league weight,
so a judge with p = +0.1 values a knockdown 10.5% more than the league judge, and n = +0.1 is a judge whose own
noise is 10% smaller relative to the evidence (more decisive, agrees more with the stats and the panel).

**Likelihood.** A card with round scores contributes its observed round-outcome sequence (B10-8, B10-9, 10-10,
A10-9, A10-8 per round). A card known only by its total contributes the sum over every round-outcome sequence with
that total (deductions latent unless known), so the round-level likelihood is marginalised exactly rather than
approximated by EM (research/data_baserates.md used EM on 10-9-only cards). The three cards of a fight are joined
through the shared round noise u, integrated by Gauss-Hermite quadrature (10 nodes) round by round; every
consistent (card 1, card 2, card 3) sequence triple is enumerated (7 fights with more than 6,200 triples are
dropped). Fit: MAP by preconditioned L-BFGS with JAX gradients; the random-effect sds by empirical Bayes on the
training window times a multiplier tuned on 2019-2023; posterior sds of judge effects from the observed
information (outer product of per-fight scores) plus the prior precision; Laplace standard errors for the league
parameters. The model has no intercept and every term is antisymmetric in A and B, so it cannot learn ufcstats'
winner-first listing (docs/BACKLOG.md evaluation rule).

**The closeness term (new in this run).** Six structural variants of the league model (with home, no named judges)
were compared on the tuning window and the held-out window (section 3.2). Letting the shared noise sd depend on
the stat edge (kappa) was the only change that helped on both. The fitted kappa is negative: lopsided rounds carry
more shared noise than even ones, which means the round-winner curve has heavier tails than logistic-normal
(rounds that are lopsided on the ufcstats counts go the other way a little more often than a constant-noise model
allows). Every fold was then refit with it, warm-started from the base folds.

### 2.2 Referees: penalised random-intercept GLMs

Each unit is a GLM with fixed effects for division group, era (quadratic in year), round, five-round format and
title fights (plus unit-specific terms), and a referee random intercept u_ref ~ N(0, tau^2):

| Unit | Rows | Outcome | Family |
|---|---|---|---|
| kd_finish | fighter-rounds with >= 1 KD (3,255) | the KD scorer finishes by KO/TKO in that round | logistic; adds 2+ KDs, opponent also scored a KD, log standing strikes |
| kd_single | KD-round KO finishes (1,792) | the finishing blow is a single strike (DETAILS singular: "Punch", "Kick", "Knee"...), i.e. stopped on the knockdown blow with no follow-up: the short end of time-from-KD-to-stoppage | logistic |
| kd_follow | same 1,792 | ground strikes the finisher landed in that round: the follow-up a referee allows before stepping in (ufcstats has no KD timestamps, so the KD-to-stoppage time itself is not observable) | quasi-Poisson (dispersion 6.9) |
| stand_tko | fighter-rounds without a KD, with standing strikes landed (34,444) | standing TKO without a knockdown | Poisson with offset log(standing sig strikes landed) |
| gnp_tko | fighter-rounds without a KD, with ground strikes landed (11,261) | ground-and-pound stoppage | Poisson with offset log(ground sig strikes landed) |
| any_ko | fights (8,227) | KO/TKO from strikes | logistic |
| doctor | fights | doctor stoppage | logistic |
| dq | fights | disqualification | logistic |
| deduction | decisions with known deductions (2,975, 2013-2025) | any point deduction | logistic |

Shrinkage: tau by Laplace marginal likelihood (empirical Bayes) on all data, and separately tau tuned by
held-out loss on 2019-2023 (fit before 2019). Held-out check: yearly refits (fit on everything before each test
year), scored on 2024-2025.

## 3. Walk-forward design

| Fold | Fit on | Scored on | Role |
|---|---|---|---|
| tune22 | decisions before 2022 | 2022-2023 (485) | primary tuning fold (two-year horizon, like a yearly refit): picks the judge-effect shrinkage |
| tune | before 2019 | 2019-2023 (1,243) | secondary tuning fold (five-year horizon) |
| test | before 2024, frozen | 2024-01-01 to 2025-12-31 (534) | held-out validation (version selection only, per docs/BACKLOG.md) |
| test25 | before 2025 | 2025 (255) | yearly-refit check |
| final | before 2026 | none | the published tables |

Bootstrap intervals resample whole events (a card shares its judges and referees), 2,000 draws.

@@RESULTS@@
