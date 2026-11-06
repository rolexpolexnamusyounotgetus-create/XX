# Styles and matchups: style vectors, archetypes and interaction tests (engine v7 component)

Built 2026-11-06 from the ufcstats snapshot through 2026-10-31 by `tools/styles.py`; machine-readable output in `data/derived/styles.json`. Walk-forward throughout: every feature of a backtest fight comes from the two sides' frozen pre-fight sums and the priors of fights before Jan 1 of the fight year; standardisation, clusters, prior strengths, penalties and coefficients are fit on 2019-2023 only; 2024-01-01 onward (1223 decisive fights) is reported, never tuned on.

## Summary

- **Style interactions do not move the winner prediction by a detectable amount.** On top of an engine-free skill model (Elo, age, reach and 29 shrunk skill and style main effects; 2024+ log loss 0.6272, accuracy 0.659, vs Elo alone 0.6805), none of 33 pre-registered matchup terms survives held-out validation (0 survive; 1 consistent in sign but not significant: leg kicker vs opponent who gets leg-kicked). The 8x8 archetype interaction matrix makes held-out log loss worse (+0.0029). Adding every term that looked good in 2019-2023 at once raises 2024+ log loss from 0.6272 to 0.6307.
- **Inside the fight, some matchups are real and measurable.** At the rate level (one row per fighter per fight, X attacking Y, exposure-correct baselines that already contain the engine's log-linear / log5 main effects), terms and blocks are selected and switched on with 2019-2023 data only (fight-clustered z screen, leave-one-year-out CV deviance with a fight bootstrap) and then scored once on 2024+. On by default:
  - `dist_att` (distance significant attempts per standing minute): length_d +0.039/sd, open -0.033/sd, zy_kd_pow -0.024/sd; 2019-2023 CV deviance change -972 (95% CI [-1401, -520]); 2024+ deviance -1.95% (95% CI of the change [-758, -73]).
  - `td_att` (takedown attempts per standing minute): zy_td_int -0.076/sd, length_d -0.081/sd, zy_vol +0.077/sd, zy_td_def -0.093/sd; 2019-2023 CV deviance change -256 (95% CI [-400, -104]); 2024+ deviance -0.93% (95% CI of the change [-195, 33]).
  - `ctrl` (control seconds per minute (quasi-Poisson)): kick_y +0.062/sd, zx_ctrl*zy_octrl -0.069/sd, zy_td_int -0.049/sd; 2019-2023 CV deviance change -3670 (95% CI [-7005, -61]); 2024+ deviance -1.68% (95% CI of the change [-7865, -2035]); a composition check, not applied in the engine (section 9).
  - `ctrl_per_td` (control seconds per takedown landed (duration; quasi-Poisson)): zy_td_def -0.069/sd, zy_sub_int +0.026/sd; 2019-2023 CV deviance change -2564 (95% CI [-4894, -269]); 2024+ deviance -0.81% (95% CI of the change [-3446, -108]).
  - `gnp_att` (ground significant attempts per own control minute): zy_sub_int +0.104/sd, zy_kd_pow +0.086/sd; 2019-2023 CV deviance change -395 (95% CI [-718, -93]); 2024+ deviance -0.77% (95% CI of the change [-493, 81]).
  Selected but off by default (the 2019-2023 CV interval crosses zero): `leg_share` (length_d, zy_press, zy_td_int; 2024+ -1.10%, CI [-247, -20]); `body_share` (open; 2024+ -0.05%, CI [-72, 66]); `kd` (zy_vol; 2024+ -0.20%, CI [-16, 7]); `sub_att` (zy_octrl; 2024+ -0.20%, CI [-19, 11]).
  In words: distance attempts per standing minute x1.04 per +1 sd of length advantage, x0.93 in open-stance fights, x0.98 per +1 sd of defender's knockdown power; takedown attempts per standing minute x0.93 per +1 sd of defender's takedown intent, x0.92 per +1 sd of length advantage, x1.08 per +1 sd of defender's volume, x0.91 per +1 sd of defender's takedown defense; control time per takedown x0.93 per +1 sd of defender's takedown defense, x1.03 per +1 sd of defender's submission intent; ground strikes per top-control minute x1.11 per +1 sd of defender's submission intent, x1.09 per +1 sd of defender's knockdown power.
- **Applied mechanistically, they move win probabilities only slightly.** Feeding the default-on modifiers through an expected-scorecard stand-in for the engine (predicted rates -> expected judging impact) changes win probabilities by a median 1.5 points (max 7.8) and moves 2024+ log loss of the Elo + scorecard model by -0.0015 (CI [-0.0040, 0.0011]); every tune-screened matchup term at once moves it by -0.0007 (CI [-0.0032, 0.0019]). Neither is significant: the gain is in realistic fight statistics, not in a measurable edge on who wins.
- **Recommendation:** apply styles as rate modifiers inside the engine (section 9, exact equations and values); do not add archetype or interaction tweaks to the final win probability; use the archetypes for labels, the director and the page.
- **Archetypes are a continuum.** Silhouette is about 0.09 for every k from 4 to 12, so there are no natural clusters. k = 8 is the most stable of the interpretable solutions (bootstrap adjusted Rand 0.53) and its clusters match expert scouting on the grappling and kicking axes (tag AUCs: top-control 0.98, leg-kicks 0.94, takedown-defense 0.94, volume 0.92), but the attempts-ratio pressure proxy does not match the scouts' 'pressure' or 'counter' tags (AUC 0.47 and 0.51): ufcstats has no cage position.
- **By-product for v9:** the engine-free skill logistic (2024+ log loss 0.6272) is a far stronger benchmark than Elo (0.6805) and a natural stacking input; its coefficients are in `styles.json` (`winner_level.skill_baseline`).

## 1. Data and design

- Fights: 3237 walk-forward backtest entries 2019-01-01 to 2026-10-31 (both men with a prior UFC fight), 3178 decisive; tune 2019-2023, test 2024+ (1223 decisive). Per-fight actual stats by position and target come from `data/raw/ufc_fight_stats.csv` through `tools/build_db.py` (round rows summed per fighter).
- Symmetry: winner models are antisymmetric (every feature is A minus B, no intercept), so the first-named corner, which wins 56% of the time, cannot leak; rate models have one row per side.
- Uncertainty: held-out changes carry 95% intervals from a paired bootstrap over test fights (2000 replicates; both sides of a fight resampled together in the rate models). In the rate models 'z (tune)' is the Wald z on 2019-2023 with a fight-clustered sandwich covariance (the two sides of a fight share pace, duration and the finishing sequence); in the winner models it uses the inverse penalised Hessian. 'z (test only)' refits on 2024+ as a diagnostic and is never used for selection.
- Selection rule, all on 2019-2023: a winner-level term is *screened in* if |z (tune)| >= 2 (likelihood-ratio p < 0.05 for blocks) and leave-one-year-out CV log loss improves. A rate-level term is *screened* if |z (tune)| >= 3 and leave-one-year-out (LOYO) CV deviance improves (the stricter bar allows for about 140 rate tests), and **CV-confirmed** if the LOYO out-of-fold deviance change also has a fight-bootstrap 95% CI below zero. Rate terms are assembled per model by forward addition on LOYO CV, and a block is **on by default** when its joint LOYO CV change has a CI below zero. 2024+ is then scored once and labelled descriptively (**holds**: CI below zero; **same sign**: negative change and the test-only refit agrees; **fails**). Winner-level terms carry the same descriptive 2024+ labels (survives / supported / fails held-out); none is recommended. (The first version of this analysis used the 2024+ intervals to give verdicts, pick terms and switch blocks on; see the verification log.)
- Prior strengths (pseudo-exposure toward the division prior) chosen by leave-one-year-out CV deviance of the rate models on 2019-2023: K_MIN = 10 (grid 5/10/20), K_ATT = 120 (grid 60/120/240), K_TD = 4 (grid 4/8/16), K_HEAD = 60 (grid 60/125/250); K_CTRLTD = 3 takedowns.

## 2. The style vector

Each feature is a log rate ratio or a log-odds difference against the division prior of the fight year, so heavyweights and flyweights sit on one scale; `shr(x)` adds the prior times the pseudo-exposure. Exact code: `Side.features` in `tools/styles.py`. z-scores use the 2019-2023 side means and sds in `styles.json` (`zscore`). Stance comes from the tale of the tape (orthodox, southpaw, switch); reach and height in inches.

| Feature | Meaning | Definition | Note |
|---|---|---|---|
| `vol` | volume | `log( shr(sig_att) / prior_sig_att ), per minute` | pace / volume |
| `press` | pressure proxy | `log( (d_att + K_MIN*p_d) / (od_att + K_MIN*p_d) )` | own distance attempts vs opponents' against him |
| `opp_vol` | output invited | `log( shr(od_att) / p_d_att )` | how much opponents throw at distance against him |
| `acc` | distance accuracy | `logit(shr(d_lnd/d_att; K_ATT)) - logit(p_acc_d)` | log-odds vs division |
| `dfn` | distance defense | `logit(1 - shr(od_lnd/od_att; K_ATT)) - logit(1 - p_acc_d)` | log-odds vs division |
| `sh_d, sh_c, sh_g` | position mix | `logit(shr(pos_att / sig_att; K_ATT)) - logit(prior share)` | distance / clinch / ground share of his attempts |
| `sh_h, sh_b, sh_l` | target mix | `logit(shr(t_att / (h+b+l att); K_ATT)) - logit(prior share)` | head / body / leg share |
| `osh_l` | gets leg-kicked | `same, for leg share of what he absorbs` |  |
| `td_int` | takedown intent | `log( shr(td_att) / p_td_att ), per minute` |  |
| `td_acc` | takedown success | `logit(shr(td_lnd/td_att; K_TD)) - logit(p_td_acc)` |  |
| `td_def` | takedown defense | `logit(1 - shr(otd_lnd/otd_att; K_TD)) - logit(1 - p_td_acc)` |  |
| `ctrl, octrl` | control propensity / time controlled | `log( shr(ctrl or octrl s/min) / prior )` | ufcstats control includes clinch control |
| `ctrl_td, octrl_td` | control per takedown / stuck on bottom | `log( (ctrl + 3*c0)/(td_lnd + 3) / c0 )` | c0 = prior control seconds per takedown |
| `sub_int, osub_int` | submission intent / exposure | `log( shr(sub_att) / prior ), per minute` |  |
| `kd_pow` | knockdown power | `log( shr(kd / h_lnd; K_HEAD) / p_kd )` | knockdowns per landed head strike |
| `chin` | chin (higher = easier to drop) | `log( shr(okd / oh_lnd; K_HEAD) / p_kd )` |  |
| `d_rate, od_rate, td_rate, otd_rate` | per standing minute | `rates over st = min - (ctrl + octrl)/60` | exposure-correct position rates |
| `g_rate` | ground-and-pound rate | `ground attempts per own control minute vs prior` |  |
| `late` | cardio | `minutes-weighted log of rounds 3-4 output ratio from the pace curve, shrunk with 30 pseudo-minutes` |  |
| `kick (derived)` | kicker | `(z_sh_l + z_sh_b) / sqrt(2)` | used as kick_x / kick_y |

Clustering uses the 15 style dimensions `vol, press, sh_d, sh_c, sh_g, sh_h, sh_b, sh_l, td_int, ctrl, sub_int, kd_pow, acc, dfn, opp_vol`, weighted so each group (output, position, target, grappling, power/precision) carries equal total weight.

## 3. Archetypes

k-means (k-means++ starts, 30 restarts) on 1537 snapshots from 2019-2023 (latest per fighter and year, at least 25 decayed minutes). Selection table (bootstrap ARI = agreement of the full-sample solution with solutions fit on bootstrap resamples):

| k | silhouette | bootstrap ARI mean | ARI min |
|---|---|---|---|
| 4 | 0.113 | 0.663 | 0.316 |
| 5 | 0.099 | 0.495 | 0.312 |
| 6 | 0.095 | 0.450 | 0.279 |
| 7 | 0.091 | 0.442 | 0.346 |
| 8 | 0.092 | 0.527 | 0.371 |
| 9 | 0.089 | 0.405 | 0.301 |
| 10 | 0.090 | 0.455 | 0.330 |
| 11 | 0.088 | 0.407 | 0.351 |
| 12 | 0.088 | 0.384 | 0.306 |

Silhouettes near 0.09 mean styles form a continuum; archetypes are labels on it. k = 8 is the most stable solution beyond k = 4 (which only separates grapplers, counter-punchers and two striker types). Centroids (z-scores) and the fighters with the most minutes in each:

| Archetype | n | Most distinctive dimensions (z) | Examples (2019-2023) |
|---|---|---|---|
| wrestler / top-control grappler | 179 | ctrl +1.1, td_int +1.1, sh_g +1.0, sh_h +1.0, sh_d -0.9 | Neil Magny, Demian Maia, Belal Muhammad, Kevin Lee, Randa Markos, Mackenzie Dern |
| clinch-control wrestle-boxer | 207 | opp_vol -1.2, sh_d -1.1, sh_g +1.1, vol -1.1, ctrl +1.0 | Rafael Dos Anjos, Kamaru Usman, Valentina Shevchenko, Derrick Lewis, Tyron Woodley, Leon Edwards |
| pressure volume striker | 153 | sh_h +1.3, sh_b -1.1, sh_l -1.0, kd_pow -0.9, vol +0.7 | Marvin Vettori, Belal Muhammad, Colby Covington, Brandon Moreno, Anthony Rocco Martin, Katlyn Cerminara |
| counter striker | 221 | press -1.1, dfn +0.7, opp_vol +0.5, sh_h +0.5, sh_b -0.4 | Angela Hill, Petr Yan, Dan Ige, Marcin Tybura, Francisco Trinaldo, Loopy Godinez |
| clinch / body-kick all-rounder | 203 | sh_h -1.2, sh_b +1.1, sh_c +1.0, sh_l +0.7, acc +0.7 | Rafael Dos Anjos, Angela Hill, Alexander Volkanovski, Marlon Vera, Kevin Holland, Thiago Santos |
| power brawler | 242 | dfn -0.6, kd_pow +0.5, press +0.5, ctrl -0.4, sh_d +0.4 | Donald Cerrone, Kevin Holland, Anthony Smith, Kelvin Gastelum, Robert Whittaker, Katlyn Cerminara |
| high-volume distance boxer | 165 | sh_d +1.6, ctrl -1.4, sh_c -1.4, sh_g -1.3, opp_vol +1.1 | Max Holloway, Sean Strickland, Andrei Arlovski, Calvin Kattar, Katlyn Cerminara, Ross Pearson |
| rangy kickboxer | 167 | td_int -1.3, ctrl -1.3, sh_l +1.3, sh_h -1.2, acc +1.2 | Israel Adesanya, Joanna Jedrzejczyk, Andrei Arlovski, Ciryl Gane, Jose Aldo, Alexander Volkov |

Soft memberships use an isotropic Gaussian around each centroid (temperature 0.432 in weighted z units); every roster fighter's membership vector and style z-scores are in `styles.json` (`roster`).

## 4. Winner-level tests: do style interactions predict who wins?

Baseline: L2 logistic on A-minus-B differences of Elo, age, reach and the shrunk features `slpm, sapm, acc, dfn, vol, press, td_int, td_acc, td_def, ctrl, octrl, sub_int, osub_int, kd_pow, chin, sh_d, sh_c, sh_g, sh_h, sh_b, sh_l, ctrl_td, octrl_td, winp, fin_w, ko_l, sub_l, lexp, late` (ridge 50 chosen by leave-one-year-out CV). Each matchup term is antisymmetrised, `u_A * v_B - u_B * v_A` on z-scores, so its own main effects stay in the baseline; context terms multiply a skill edge by a symmetric fight context; type terms use z thresholds (type = z > 1).

| Model | 2019-2023 CV log loss | 2024+ log loss | Brier | Accuracy |
|---|---|---|---|---|
| Elo only |  | 0.6805 | 0.2438 | 0.547 |
| Skill baseline | 0.6542 | 0.6272 | 0.2182 | 0.659 |
| Skill baseline + all tune-screened terms |  | 0.6307 | 0.2199 | 0.652 |

Each term added alone to the skill baseline (log-loss changes x 1000; negative = better):

| Term | cols | z (tune) | CV change | 2024+ change | 95% CI | z (test only) | Verdict |
|---|---|---|---|---|---|---|---|
| wrestling vs low takedown defense | 1 | 0.10 | +1.07 | +0.05 | [-0.06, +0.17] | -0.65 | not screened in |
| takedown accuracy vs low takedown defense | 1 | 0.30 | +0.30 | +0.27 | [-0.08, +0.63] | -1.13 | not screened in |
| control vs stuck-on-bottom | 1 | -0.57 | +0.34 | +0.98 | [+0.31, +1.63] | 2.46 | not screened in |
| control vs time on bottom | 1 | -1.95 | -0.32 | +1.35 | [-1.28, +4.05] | 0.31 | not screened in |
| submission threat vs time on bottom | 1 | -1.04 | +0.31 | +0.84 | [-0.60, +2.18] | 0.87 | not screened in |
| submission threat vs submission exposure | 1 | 3.08 | -2.30 | +2.45 | [-1.44, +6.35] | 0.14 | fails held-out |
| kicker vs wrestler | 1 | 0.31 | +0.92 | +0.30 | [-0.12, +0.71] | -1.29 | not screened in |
| pressure vs striking defense | 1 | 0.07 | +0.29 | -0.06 | [-0.14, +0.03] | 1.19 | not screened in |
| pressure vs counter accuracy | 1 | 0.62 | +2.31 | +0.03 | [-0.77, +0.81] | 0.33 | not screened in |
| pressure vs volume | 1 | 1.48 | -0.32 | +1.19 | [-0.58, +2.93] | -0.74 | not screened in |
| volume vs power | 1 | -0.12 | +0.03 | -0.04 | [-0.19, +0.10] | -0.74 | not screened in |
| power vs chin | 1 | 0.62 | +0.22 | -0.74 | [-1.46, +0.00] | 2.00 | not screened in |
| clinch fighter vs distance fighter | 1 | 2.27 | -1.08 | +2.23 | [-1.41, +5.62] | -0.32 | fails held-out |
| ground-and-pound vs time on bottom | 1 | 1.40 | +0.61 | +1.32 | [-0.52, +3.17] | -0.95 | not screened in |
| leg kicker vs opponent who gets leg-kicked | 1 | 2.45 | -1.23 | -0.96 | [-4.06, +2.14] | 1.87 | supported |
| volume vs poor cardio | 1 | 0.52 | +0.37 | -0.02 | [-0.72, +0.65] | 0.48 | not screened in |
| striking edge x distance context | 1 | -0.81 | +0.29 | +0.48 | [-0.45, +1.42] | 0.42 | not screened in |
| striking edge x low-wrestling context | 1 | -0.63 | +0.11 | +0.28 | [-0.56, +1.09] | 0.23 | not screened in |
| grappling edge x wrestling context | 1 | 0.63 | +0.22 | -0.23 | [-1.07, +0.62] | 0.88 | not screened in |
| reach edge x distance context | 1 | -0.89 | -0.18 | +0.73 | [-0.43, +1.93] | 0.13 | not screened in |
| reach x own distance share | 1 | 0.92 | +0.98 | -1.30 | [-2.62, -0.04] | 2.29 | not screened in |
| age gap x five rounds | 1 | -0.02 | +0.86 | +0.00 | [-0.02, +0.03] | 0.15 | not screened in |
| cardio edge x five rounds | 1 | -0.09 | +0.88 | -0.02 | [-0.12, +0.08] | -0.08 | not screened in |
| stance main effects (southpaw, switch) | 2 | LR 2.2 | +0.72 | -0.19 | [-2.29, +1.83] |  | not screened in |
| southpaw vs orthodox (open-stance edge) | 1 | 0.34 | +0.25 | -0.32 | [-0.75, +0.08] | 1.51 | not screened in |
| kicker x open stance | 1 | 0.18 | +1.36 | -0.22 | [-0.46, +0.00] | 1.61 | not screened in |
| wrestler type vs weak takedown defense | 1 | -0.51 | +0.65 | +0.39 | [-0.24, +1.01] | 0.80 | not screened in |
| kicker type vs wrestler type | 1 | -0.16 | +1.20 | -0.02 | [-0.21, +0.18] | -0.08 | not screened in |
| pressure type vs counter type | 1 | -0.80 | +0.14 | +0.40 | [-0.53, +1.29] | 0.61 | not screened in |
| power type vs volume type | 1 | 1.05 | +0.28 | -0.94 | [-2.09, +0.20] | 2.07 | not screened in |
| submission type vs wrestler type | 1 | 1.38 | -0.29 | -0.48 | [-2.20, +1.21] | 1.22 | not screened in |
| archetype main effects | 7 | LR 5.1 | +0.26 | +1.10 | [-0.58, +2.82] |  | not screened in |
| archetype x archetype matrix | 28 | LR 20.6 | -0.26 | +2.90 | [-0.52, +6.25] |  | not screened in |

On top of Elo alone (no skill controls), the terms that pass the screen are: control vs time on bottom (2024+ +1.27, CI [-1.51, +4.10], fails held-out); submission threat vs submission exposure (2024+ +2.41, CI [-0.69, +5.62], fails held-out); clinch fighter vs distance fighter (2024+ +3.14, CI [-0.75, +6.71], fails held-out); leg kicker vs opponent who gets leg-kicked (2024+ -0.66, CI [-3.74, +2.57], supported); age gap x five rounds (2024+ -3.16, CI [-6.62, +0.37], supported); archetype main effects (2024+ -3.78, CI [-7.42, -0.06], survives). Archetype main effects and the age-by-rounds context help Elo because they carry main effects Elo lacks (style and age); once the skill controls are in, they add nothing.

**Style-mismatch fights** (the v7 check in docs/ROADMAP.md). A fight is a mismatch when the weighted style distance between the two men exceeds the 2019-2023 two-thirds quantile (3.27); 432 of 1223 test fights qualify. Separately, 878 test fights pair two different archetypes with both memberships above 0.5.

| Model (2024+ log loss) | Mismatch fights | Other fights | Different confident archetypes |
|---|---|---|---|
| elo | 0.6783 | 0.6817 | 0.6757 |
| skill_baseline | 0.6224 | 0.6298 | 0.6209 |
| skill_baseline+screened_interactions | 0.6266 | 0.6329 | 0.6246 |
| elo+scorecard(none) | 0.6581 | 0.6615 | 0.6544 |
| elo+scorecard(tune_screened) | 0.6566 | 0.6612 | 0.6549 |
| elo+scorecard(tier1) | 0.6554 | 0.6605 | 0.6547 |
| elo+scorecard(default_on) | 0.6566 | 0.6600 | 0.6540 |
| elo+scorecard(all_recommended) | 0.6567 | 0.6612 | 0.6548 |

Mismatch fights are not harder to call, and no interaction model does better on them than the skill baseline. The scorecard models with rate modifiers are slightly better on mismatch fights than without (section 7), within noise.

## 5. Rate-level tests: what styles change inside the fight

One row per fighter per fight (X attacking Y). Each model holds the engine-style main effects (X's own rate and what Y allows, both as log ratios to the division prior; for proportions the log5 pair) with free coefficients, plus one candidate at a time. Exposures are actual position time (standing minutes = fight minutes minus both men's control time), which is what the engine conditions on. A first pass with per-total-minute baselines produced spurious 'matchup' effects (opponent's wrestling or pressure 'raising' distance output) that vanished once rates were per standing minute; exposure has to be right before interactions mean anything.

Base fits (coefficient per sd of the feature; 2024+ deviance explained relative to an intercept-only model):

| Model | Outcome | Main effects (per sd) | Dispersion | 2024+ deviance explained |
|---|---|---|---|---|
| dist_att | distance significant attempts per standing minute | zx_d_rate 0.135, zy_od_rate 0.103 | 10.3 | 28.4% |
| dist_acc | distance accuracy (landed of attempted), log5 baseline | zx_acc 0.135, neg_zy_dfn 0.088 | 3.2 | 21.2% |
| leg_share | leg share of significant attempts | zx_sh_l 0.421, zy_osh_l 0.194 | 6.1 | 25.5% |
| body_share | body share of significant attempts | zx_sh_b 0.276 | 4.0 | 20.2% |
| td_att | takedown attempts per standing minute | zx_td_rate 0.662, zy_otd_rate 0.197 | 5.3 | 30.3% |
| td_acc | takedown success (landed of attempted), log5 baseline | zx_td_acc 0.108, neg_zy_td_def 0.239 | 1.4 | 3.6% |
| ctrl | control seconds per minute (quasi-Poisson) | zx_ctrl 0.441, zy_octrl 0.308 | 130.0 | 24.8% |
| ctrl_per_td | control seconds per takedown landed (duration; quasi-Poisson) | zx_ctrl_td 0.092, zy_octrl_td 0.133 | 123.4 | 4.6% |
| kd | knockdowns per landed head strike | zx_kd_pow 0.334, zy_chin 0.182 | 2.1 | 5.2% |
| sub_att | submission attempts per minute | zx_sub_int 0.559, zy_osub_int 0.337 | 2.3 | 10.2% |
| clinch_att | clinch significant attempts per minute | zx_c_rate 0.338, zy_oc_rate 0.218 | 8.9 | 13.4% |
| gnp_att | ground significant attempts per own control minute | zx_g_rate 0.230 | 14.9 | 3.4% |

Screened and other notable candidates (coefficient per sd of the term; deviance changes summed over fight sides, negative = better; the verdict uses 2019-2023 only, the 2024+ columns are reported after the fact):

| Model | Term | Coef/sd | z (tune, clustered) | LOYO CV change [95% CI] | Verdict (2019-2023) | 2024+ change | 2024+ 95% CI | z (test only) | 2024+ result |
|---|---|---|---|---|---|---|---|---|---|
| dist_att | `zy_kd_pow` | -0.0256 | -3.61 | -198.1 [-440, +40] | screened | -220.6 (-1.02%) | [-376.3, -74.0] | -4.42 | holds |
| dist_att | `open` | -0.0328 | -4.34 | -292.5 [-609, +36] | screened | -66.9 (-0.31%) | [-312.5, +185.4] | -2.26 | same sign |
| dist_att | `x_sp_vs_orth` | -0.0227 | -3.66 | -115.2 [-283, +54] | screened | +35.9 (+0.17%) | [-98.1, +183.8] | -0.87 | fails |
| dist_att | `length_d` | +0.0395 | 9.28 | -512.5 [-737, -290] | cv-confirmed | -157.2 (-0.73%) | [-334.8, +13.0] | 5.21 | same sign |
| dist_acc | `kick_x` | +0.0268 | 3.66 | -35.8 [-100, +29] | screened (own-style, not a matchup) | -45.6 (-0.62%) | [-93.7, +4.0] | 3.25 | same sign |
| leg_share | `zy_td_int` | -0.0507 | -3.19 | -53.0 [-164, +56] | screened | -106.6 (-0.89%) | [-181.2, -37.0] | -4.22 | holds |
| leg_share | `zy_press` | +0.0513 | 3.27 | -51.6 [-162, +55] | screened | -3.5 (-0.03%) | [-74.0, +66.8] | 1.46 | same sign |
| leg_share | `length_d` | -0.0581 | -3.92 | -97.2 [-205, +10] | screened | -54.1 (-0.45%) | [-115.8, +15.4] | -3.44 | same sign |
| body_share | `open` | +0.0466 | 4.04 | -96.2 [-191, -6] | cv-confirmed | -5.1 (-0.05%) | [-72.7, +66.1] | 1.70 | same sign |
| td_att | `zy_td_def` | -0.0673 | -3.12 | -48.5 [-119, +20] | screened | -11.9 (-0.13%) | [-59.8, +34.6] | -1.61 | same sign |
| td_att | `kick_y` | +0.0522 | 2.64 | -24.3 [-69, +22] | not screened in | -63.5 (-0.71%) | [-103.3, -24.7] | 4.37 | holds |
| td_att | `zy_td_int` | -0.0992 | -4.78 | -99.3 [-186, -9] | cv-confirmed | -79.7 (-0.89%) | [-148.7, -9.7] | -4.02 | holds |
| td_att | `zy_vol` | +0.0853 | 3.90 | -51.1 [-121, +18] | screened | +6.3 (+0.07%) | [-55.3, +66.4] | 1.77 | fails |
| td_att | `length_d` | -0.0901 | -4.53 | -74.2 [-147, +3] | screened | -30.2 (-0.34%) | [-94.2, +31.6] | -2.61 | same sign |
| ctrl | `zx_ctrl*zy_octrl` | -0.0654 | -3.19 | -1072.0 [-3227, +1202] | screened | -1902.0 (-0.66%) | [-3640.0, -174.2] | -3.49 | holds |
| ctrl | `zy_td_int` | -0.0536 | -3.02 | -1016.0 [-2851, +852] | screened | -1426.0 (-0.49%) | [-2789.0, -20.3] | -3.17 | holds |
| ctrl | `zy_ctrl` | -0.0385 | -2.05 | -562.8 [-1922, +769] | not screened in | -1231.0 (-0.43%) | [-2264.0, -205.2] | -3.28 | holds |
| ctrl | `kick_y` | +0.0660 | 3.75 | -1792.0 [-3903, +391] | screened | -1695.0 (-0.59%) | [-3382.0, -87.2] | 3.58 | holds |
| ctrl_per_td | `zy_sub_int` | +0.0457 | 3.10 | -928.6 [-2165, +323] | screened | -429.9 (-0.19%) | [-1437.0, +626.0] | 2.11 | same sign |
| ctrl_per_td | `zy_td_def` | -0.0767 | -4.67 | -2263.0 [-4351, -24] | cv-confirmed | -1735.0 (-0.78%) | [-3273.0, -132.0] | -4.09 | holds |
| kd | `zy_vol` | -0.1185 | -3.17 | -10.6 [-25, +4] | screened | -3.9 (-0.20%) | [-15.6, +7.5] | -1.77 | same sign |
| sub_att | `zy_octrl` | +0.1324 | 3.16 | -15.0 [-37, +6] | screened | -4.7 (-0.20%) | [-20.4, +9.5] | 1.86 | same sign |
| gnp_att | `zy_sub_int` | +0.1024 | 4.20 | -242.1 [-474, -6] | cv-confirmed | -145.6 (-0.58%) | [-367.3, +75.3] | 2.56 | same sign |
| gnp_att | `zy_kd_pow` | +0.0841 | 3.53 | -142.5 [-358, +71] | screened | -45.4 (-0.18%) | [-209.7, +117.7] | 1.69 | same sign |

Everything else (115 candidates, listed in `styles.json`) failed the screen. Null results worth stating: no block for distance accuracy, leg-kick share, body share, takedown success, knockdowns per head strike, submission attempts per minute, clinch strikes per minute passes the 2019-2023 CV (a few single terms clear the z screen there, such as the defender's volume on knockdowns per head strike or the defender's time on bottom on submission attempts, but their CV gain is not distinguishable from zero); the log5 / log-linear combination itself shows no interaction (`zx_acc*zy_dfn`, `zx_td_acc*zy_td_def`, `zx_kd_pow*zy_chin`, `zx_d_rate*zy_od_rate` all near zero), so the engine's multiplicative form is adequate (its exponents are another matter, section 6). Southpaw vs orthodox does not change accuracy or knockdowns.

## 6. The modifier set and its size

Per model, screened matchup terms (CV-confirmed first, then by |z|) are added one at a time and kept only if they lower the 2019-2023 LOYO CV deviance given what is already in (this resolves overlapping terms such as open stance vs southpaw-vs-orthodox). Terms built only from the attacker's own style are excluded: they are decomposition corrections, not matchups. A block is **on by default** when its joint LOYO CV deviance change has a fight-bootstrap CI below zero. Nothing in this section was chosen with 2024+ data.

The coefficients are conditional on the main-effect strengths they were fit with: the free main effects imply engine exponents well below 1 for what the defender allows (table below), and refitting the same terms with the main effects fixed at the engine's default `a = b = 1` changes several of them materially (columns 'a=b=1'). Use the 'coef per unit' column with the fitted exponents, or the 'a=b=1' column if the engine keeps `a = b = 1`; do not mix them.

**On by default**

| Rate | Term | Definition | Tier | Coef per term sd | Coef per unit | z (tune, joint) | exp(coef) at +1 sd | Coef per unit (a=b=1) | z (a=b=1) |
|---|---|---|---|---|---|---|---|---|---|
| dist_att | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 1 | +0.0385 | +0.0639 | 8.92 | 1.039 | +0.0524 | 7.27 |
| dist_att | `open` | 1 if one is southpaw and the other orthodox | 2 | -0.0326 | -0.0731 | -4.33 | 0.968 | -0.0676 | -3.88 |
| dist_att | `zy_kd_pow` | defender's knockdown power (z) | 2 | -0.0238 | -0.0238 | -3.39 | 0.976 | -0.0100 | -1.39 |
| dist_att | *block* | 2019-2023 CV -972, CI [-1401, -520]; 2024+ deviance -1.95%, CI [-758, -73] |  |  |  |  |  |  |  |
| td_att | `zy_td_int` | defender's takedown intent (z) | 1 | -0.0763 | -0.0763 | -3.29 | 0.927 | +0.0007 | 0.03 |
| td_att | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 2 | -0.0808 | -0.1340 | -4.02 | 0.922 | -0.0966 | -2.86 |
| td_att | `zy_vol` | defender's volume (z) | 2 | +0.0767 | +0.0767 | 3.15 | 1.080 | +0.1679 | 6.91 |
| td_att | `zy_td_def` | defender's takedown defense (z) | 2 | -0.0933 | -0.0933 | -4.24 | 0.911 | -0.0741 | -3.33 |
| td_att | *block* | 2019-2023 CV -256, CI [-400, -104]; 2024+ deviance -0.93%, CI [-195, 33] |  |  |  |  |  |  |  |
| ctrl | `kick_y` | defender's kick share (z_sh_l + z_sh_b)/sqrt(2) | 2 | +0.0624 | +0.0569 | 3.55 | 1.064 | +0.0432 | 2.59 |
| ctrl | `zx_ctrl*zy_octrl` | attacker's control propensity x defender's time-controlled propensity (z x z) | 2 | -0.0686 | -0.0683 | -3.37 | 0.934 | -0.1708 | -9.25 |
| ctrl | `zy_td_int` | defender's takedown intent (z) | 2 | -0.0490 | -0.0490 | -2.77 | 0.952 | -0.0298 | -1.66 |
| ctrl | *block* | 2019-2023 CV -3670, CI [-7005, -61]; 2024+ deviance -1.68%, CI [-7865, -2035] |  |  |  |  |  |  |  |
| ctrl_per_td | `zy_td_def` | defender's takedown defense (z) | 1 | -0.0690 | -0.0690 | -3.94 | 0.933 | -0.1069 | -6.01 |
| ctrl_per_td | `zy_sub_int` | defender's submission intent (z) | 2 | +0.0264 | +0.0264 | 1.67 | 1.027 | +0.0017 | 0.10 |
| ctrl_per_td | *block* | 2019-2023 CV -2564, CI [-4894, -269]; 2024+ deviance -0.81%, CI [-3446, -108] |  |  |  |  |  |  |  |
| gnp_att | `zy_sub_int` | defender's submission intent (z) | 1 | +0.1041 | +0.1041 | 4.28 | 1.110 | +0.1038 | 4.18 |
| gnp_att | `zy_kd_pow` | defender's knockdown power (z) | 2 | +0.0859 | +0.0859 | 3.57 | 1.090 | +0.0744 | 3.08 |
| gnp_att | *block* | 2019-2023 CV -395, CI [-718, -93]; 2024+ deviance -0.77%, CI [-493, 81] |  |  |  |  |  |  |  |

**Optional (knob, default off)**

| Rate | Term | Definition | Tier | Coef per term sd | Coef per unit | z (tune, joint) | exp(coef) at +1 sd | Coef per unit (a=b=1) | z (a=b=1) |
|---|---|---|---|---|---|---|---|---|---|
| leg_share | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 2 | -0.0490 | -0.0813 | -3.28 | 0.952 | -0.0483 | -1.88 |
| leg_share | `zy_press` | defender's pressure proxy (z) | 2 | +0.0402 | +0.0402 | 2.53 | 1.041 | +0.0228 | 1.36 |
| leg_share | `zy_td_int` | defender's takedown intent (z) | 2 | -0.0417 | -0.0417 | -2.61 | 0.959 | -0.0206 | -1.22 |
| leg_share | *block* | 2019-2023 CV -151, CI [-318, 25]; 2024+ deviance -1.10%, CI [-247, -20] |  |  |  |  |  |  |  |
| body_share | `open` | 1 if one is southpaw and the other orthodox | 1 | +0.0466 | +0.1045 | 4.04 | 1.048 | +0.1040 | 4.01 |
| body_share | *block* | 2019-2023 CV -96, CI [-191, 1]; 2024+ deviance -0.05%, CI [-72, 66] |  |  |  |  |  |  |  |
| kd | `zy_vol` | defender's volume (z) | 2 | -0.1186 | -0.1186 | -3.17 | 0.888 | -0.0781 | -1.89 |
| kd | *block* | 2019-2023 CV -11, CI [-25, 4]; 2024+ deviance -0.20%, CI [-16, 7] |  |  |  |  |  |  |  |
| sub_att | `zy_octrl` | defender's time-controlled propensity (z) | 2 | +0.1323 | +0.1323 | 3.16 | 1.141 | -0.0923 | -2.09 |
| sub_att | *block* | 2019-2023 CV -15, CI [-35, 6]; 2024+ deviance -0.20%, CI [-19, 11] |  |  |  |  |  |  |  |

Implied main-effect exponents of the free fits (coefficient on the raw log-ratio or log-odds feature; the engine default is 1 for both):

| Rate | Attacker's own (a) | What the defender allows (b) |
|---|---|---|
| dist_att | 0.76 | 0.58 |
| td_att | 1.09 | 0.41 |
| ctrl | 0.82 | 0.59 |
| ctrl_per_td | 0.38 | 0.61 |
| gnp_att | 0.60 | n/a |
| leg_share | 0.94 | 0.50 |
| body_share | 0.89 | n/a |
| kd | 0.53 | 0.28 |
| sub_att | 0.59 | 0.33 |

Tier 1 = CV-confirmed alone; tier 2 = screened alone and kept by the forward CV step. Joint z values are lower than the single-term ones where terms share signal. How big the modifiers get across real 2024+ matchups (the modifier part of the linear predictor, log scale for rates and log-odds for shares):

| Rate | p5 | p25 | median | p75 | p95 | median |shift| |
|---|---|---|---|---|---|---|
| dist_att | -0.117 | -0.057 | -0.015 | 0.020 | 0.066 | 0.037 |
| td_att | -0.296 | -0.136 | -0.020 | 0.098 | 0.257 | 0.119 |
| ctrl | -0.177 | -0.069 | -0.005 | 0.060 | 0.160 | 0.065 |
| ctrl_per_td | -0.129 | -0.054 | -0.003 | 0.052 | 0.120 | 0.053 |
| gnp_att | -0.209 | -0.092 | 0.004 | 0.106 | 0.219 | 0.099 |
| leg_share | -0.142 | -0.064 | -0.008 | 0.054 | 0.142 | 0.060 |
| body_share | 0.000 | 0.000 | 0.000 | 0.105 | 0.105 | 0.000 |
| kd | -0.175 | -0.065 | 0.009 | 0.089 | 0.215 | 0.076 |
| sub_att | -0.236 | -0.094 | 0.004 | 0.091 | 0.192 | 0.092 |

So for the default-on blocks a typical matchup moves a rate by 4-13% and the 5% most extreme by up to 35%. Examples (multipliers for Poisson rates, log-odds shifts for shares, all selected blocks including optional ones):

| Attacker vs defender | Attacker archetype (live) | Modifiers |
|---|---|---|
| alexander-volkanovski vs justin-gaethje | counter striker | dist_att x0.96, leg_share +0.03, body_share +0.00, td_att x1.11, ctrl x0.96, ctrl_per_td x0.92, kd x0.96, sub_att x0.80, gnp_att x0.85 |
| justin-gaethje vs alexander-volkanovski | counter striker | dist_att x1.07, leg_share -0.03, body_share +0.00, td_att x0.94, ctrl x0.89, ctrl_per_td x1.00, kd x0.97, sub_att x0.83, gnp_att x0.83 |
| islam-makhachev vs alexander-volkanovski | clinch-control wrestle-boxer | dist_att x0.99, leg_share -0.02, body_share +0.10, td_att x0.95, ctrl x1.15, ctrl_per_td x1.00, kd x0.97, sub_att x0.83, gnp_att x0.83 |
| alexander-volkanovski vs islam-makhachev | counter striker | dist_att x0.89, leg_share -0.06, body_share +0.10, td_att x0.69, ctrl x0.92, ctrl_per_td x0.94, kd x1.43, sub_att x0.78, gnp_att x1.17 |
| alex-pereira vs magomed-ankalaev | rangy kickboxer | dist_att x1.04, leg_share -0.05, body_share +0.00, td_att x0.78, ctrl x0.71, ctrl_per_td x0.96, kd x1.08, sub_att x0.72, gnp_att x1.10 |
| magomed-ankalaev vs alex-pereira | clinch / body-kick all-rounder | dist_att x0.95, leg_share +0.12, body_share +0.00, td_att x1.12, ctrl x1.20, ctrl_per_td x0.90, kd x0.99, sub_att x1.06, gnp_att x1.04 |
| merab-dvalishvili vs sean-o-malley | wrestler / top-control grappler | dist_att x0.93, leg_share +0.24, body_share +0.00, td_att x1.48, ctrl x1.16, ctrl_per_td x1.00, kd x1.03, sub_att x1.06, gnp_att x0.89 |
| sean-o-malley vs merab-dvalishvili | rangy kickboxer | dist_att x1.15, leg_share -0.12, body_share +0.00, td_att x0.74, ctrl x0.55, ctrl_per_td x0.98, kd x0.88, sub_att x0.78, gnp_att x0.79 |
| khamzat-chimaev vs dricus-du-plessis | wrestler / top-control grappler | dist_att x1.02, leg_share +0.01, body_share +0.00, td_att x1.14, ctrl x0.96, ctrl_per_td x1.07, kd x0.92, sub_att x1.05, gnp_att x0.97 |
| dricus-du-plessis vs khamzat-chimaev | power brawler | dist_att x1.02, leg_share -0.10, body_share +0.00, td_att x0.81, ctrl x0.86, ctrl_per_td x0.99, kd x1.09, sub_att x0.86, gnp_att x1.01 |
| ilia-topuria vs max-holloway | counter striker | dist_att x0.97, leg_share +0.20, body_share +0.00, td_att x1.40, ctrl x1.22, ctrl_per_td x0.97, kd x0.88, sub_att x1.06, gnp_att x0.89 |
| max-holloway vs ilia-topuria | rangy kickboxer | dist_att x1.00, leg_share -0.07, body_share +0.00, td_att x0.79, ctrl x0.88, ctrl_per_td x0.85, kd x0.96, sub_att x0.84, gnp_att x1.12 |

## 7. Does the mechanism reach the outcome? (transmission test)

A stand-in for the engine: fit every rate model on 2019-2023, predict each side's per-minute rates from features only (control first, standing share = 1 - both men's control, then distance attempts x accuracy, clinch and ground strikes at prior accuracy, target split, takedowns, knockdowns, submissions), turn them into an expected judging impact per 15 minutes with the EM round-winner weights (head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min, sub attempt 0.85), and add the A-minus-B difference to a winner model. Variants differ only in which modifiers the rate models carry.

| Modifiers | Model | 2024+ log loss | Accuracy | z of impact term | Change vs none [95% CI] | Median / max |dp| (points) |
|---|---|---|---|---|---|---|
| none | elo plus impact | 0.6603 | 0.624 | 6.61 |  |  |
| none | baseline plus impact | 0.6267 | 0.661 | 0.93 |  |  |
| tune_screened | elo plus impact | 0.6596 | 0.621 | 7.04 | -0.0007 [-0.0032, +0.0019] | 1.4 / 8.7 |
| tune_screened | baseline plus impact | 0.6267 | 0.665 | 1.32 | +0.0000 [-0.0007, +0.0007] | 0.3 / 2.2 |
| tier1 | elo plus impact | 0.6587 | 0.619 | 7.00 | -0.0016 [-0.0038, +0.0009] | 1.2 / 8.0 |
| tier1 | baseline plus impact | 0.6266 | 0.662 | 1.00 | -0.0002 [-0.0005, +0.0002] | 0.2 / 1.3 |
| default_on | elo plus impact | 0.6588 | 0.619 | 7.20 | -0.0015 [-0.0040, +0.0011] | 1.5 / 7.8 |
| default_on | baseline plus impact | 0.6267 | 0.666 | 1.35 | +0.0000 [-0.0007, +0.0007] | 0.3 / 2.4 |
| all_recommended | elo plus impact | 0.6596 | 0.620 | 7.04 | -0.0007 [-0.0032, +0.0019] | 1.4 / 8.7 |
| all_recommended | baseline plus impact | 0.6267 | 0.665 | 1.33 | -0.0000 [-0.0007, +0.0007] | 0.3 / 2.2 |

Read: the scorecard alone lifts Elo from 0.6805 to 0.6603 (it is a real, if crude, mechanistic predictor). Modifiers change the scorecard model's 2024+ log loss by at most about 0.002, with intervals that include zero. Every variant's terms were chosen on 2019-2023 only ('tier1' = CV-confirmed terms of the selected blocks, 'default_on' = the on-by-default blocks, 'all_recommended' = every selected block, 'tune_screened' = every screened matchup term without the forward step), so each row is a clean held-out test. On top of the full skill baseline the scorecard adds nothing, as expected: the baseline already holds the same main effects.

Median relative change in the expected per-minute stats from the modifiers (2019-2026 sides): tune_screened: h 4.7%, b 3.4%, l 4.4%, kd 9.8%, td 11.5%, ctrl 6.5%; tier1: h 2.3%, b 3.4%, l 2.2%, kd 2.3%, td 7.0%, ctrl 0.0%; default_on: h 3.6%, b 3.6%, l 3.6%, kd 3.6%, td 11.5%, ctrl 6.5%; all_recommended: h 4.7%, b 3.4%, l 4.4%, kd 9.8%, td 11.5%, ctrl 6.5%.

## 8. Scouting files versus the data

85 fighters in `data/scouting/` have a live profile. The scouting tags are written in 2026 with hindsight, so they cannot be used in a walk-forward backtest; they serve here to check what the data features mean. AUC = chance that a tagged fighter scores higher on the data feature than an untagged one (signed so 1 = agreement).

| Tag | Data feature | Sign | Tagged | AUC |
|---|---|---|---|---|
| top-control | `ctrl` | + | 35 | 0.98 |
| chain-wrestling | `td_int` | + | 11 | 0.96 |
| leg-kicks | `sh_l` | + | 29 | 0.94 |
| takedown-defense | `td_def` | + | 39 | 0.94 |
| volume | `vol` | + | 19 | 0.92 |
| body-work | `sh_b` | + | 34 | 0.89 |
| submissions | `sub_int` | + | 34 | 0.88 |
| chin-concern | `chin` | + | 19 | 0.88 |
| back-takes | `sub_int` | + | 22 | 0.85 |
| cage-wrestling | `td_int` | + | 8 | 0.83 |
| power | `kd_pow` | + | 37 | 0.81 |
| clinch | `sh_c` | + | 21 | 0.79 |
| late-surge | `late` | + | 22 | 0.77 |
| durable | `chin` | - | 33 | 0.77 |
| calf-kicks | `sh_l` | + | 4 | 0.75 |
| rangy | `reach_rel` | + | 24 | 0.74 |
| cardio | `late` | + | 24 | 0.69 |
| fades-late | `late` | - | 4 | 0.69 |
| knees | `sh_c` | + | 8 | 0.62 |
| elbows | `sh_c` | + | 16 | 0.58 |
| head-movement | `dfn` | + | 3 | 0.53 |
| ground-and-pound | `g_rate` | + | 32 | 0.52 |
| counter | `press` | - | 19 | 0.51 |
| jab | `sh_h` | + | 16 | 0.48 |
| pressure | `press` | + | 26 | 0.47 |

What the weakly matched tags line up with instead (best three features by |AUC - 0.5|): **pressure**: sh_l 0.25, otd_int 0.29, otd_rate 0.30; **counter**: ctrl 0.27, kd_pow 0.71, osh_l 0.69; **durable**: ko_l 0.16, chin 0.23, late 0.72; **cardio**: kd_pow 0.23, fin_w 0.27, lexp 0.72; **ground-and-pound**: sh_g 0.85, sh_d 0.18, ctrl 0.77; **power**: kd_pow 0.81, g_rate 0.78, fin_w 0.78.

Scouts' 'pressure' fighters kick the legs less and get fewer takedown attempts against them; nothing in the attempt counts measures walking a man down. Treat `press` as an output-share feature, not as pressure in the coaching sense, and keep the scouting tag for the director. Stance agrees with the tale of the tape for every scouted fighter (orthodox|orthodox 51, southpaw|southpaw 20, switch|switch 14).

Scouting archetype family (rows) against the data archetype (largest live membership):

| Scouting family | wrestler / top-control grappler | clinch-control wrestle-boxer | pressure volume striker | counter striker | clinch / body-kick all-rounder | power brawler | high-volume distance boxer | rangy kickboxer |
|---|---|---|---|---|---|---|---|---|
| all-round | 0 | 3 | 0 | 1 | 3 | 4 | 0 | 1 |
| boxing | 0 | 0 | 1 | 4 | 1 | 2 | 0 | 1 |
| counter | 0 | 1 | 0 | 0 | 0 | 2 | 1 | 1 |
| grappling | 10 | 9 | 3 | 4 | 1 | 1 | 0 | 0 |
| kicking | 0 | 0 | 0 | 0 | 2 | 3 | 1 | 8 |
| power | 0 | 0 | 0 | 1 | 0 | 3 | 1 | 1 |
| pressure | 0 | 0 | 0 | 2 | 0 | 1 | 1 | 0 |
| volume | 0 | 0 | 2 | 1 | 0 | 1 | 2 | 1 |

## 9. Exact recommendation for the engine

1. **Inputs.** For each fighter use the live style z-scores in `styles.json` `roster[slug].z` (built from fighters.json sums with the live division priors and standardised with `zscore.mu/sd` from 2019-2023), or recompute them with `Side.features`. For a backtest fight, compute them from the frozen `S` with `priors_asof[year]` (never the live priors). `kick = (z_sh_l + z_sh_b) / sqrt(2)`. Physical terms use `sd_reach = 4.574` in and `sd_height = 3.740` in.
2. **Where they act.** For attacker X against defender Y, each block adds `s = sum_k c_k * t_k` (`c_k` = 'coef per unit' above, `t_k` = term value) to the linear predictor of one engine rate, after the engine has combined X's and Y's own rates (log-linear / log5):
   - `dist_att` (on): multiply X's distance strike-attempt rate (per standing minute). With the fitted exponents (zx_d_rate 0.76, zy_od_rate 0.58): `s = (+0.0639) * length_d + (-0.0731) * open + (-0.0238) * zy_kd_pow`. If the engine keeps a = b = 1: `s = (+0.0524) * length_d + (-0.0676) * open + (-0.0100) * zy_kd_pow`.
   - `td_att` (on): multiply X's takedown-attempt rate (per standing minute, distance and clinch). With the fitted exponents (zx_td_rate 1.09, zy_otd_rate 0.41): `s = (-0.0763) * zy_td_int + (-0.1340) * length_d + (+0.0767) * zy_vol + (-0.0933) * zy_td_def`. If the engine keeps a = b = 1: `s = (+0.0007) * zy_td_int + (-0.0966) * length_d + (+0.1679) * zy_vol + (-0.0741) * zy_td_def`.
   - `ctrl` (check only, not applied): composition check only (total control per minute): its zy_td_int part is carried by td_att, its zx_ctrl*zy_octrl part is a time-ceiling effect (control cannot exceed the clock) that a finite-time position chain reproduces by itself, and its kick_y part (kickers spend more time controlled) has no carrier, because the defender's kick share on takedown attempts misses the 2019-2023 screen; do not apply. With the fitted exponents (zx_ctrl 0.82, zy_octrl 0.59): `s = (+0.0569) * kick_y + (-0.0683) * zx_ctrl*zy_octrl + (-0.0490) * zy_td_int`. If the engine keeps a = b = 1: `s = (+0.0432) * kick_y + (-0.1708) * zx_ctrl*zy_octrl + (-0.0298) * zy_td_int`.
   - `ctrl_per_td` (on): multiply X's top-control duration per takedown (divide the bottom man's escape / stand-up hazard). With the fitted exponents (zx_ctrl_td 0.38, zy_octrl_td 0.61): `s = (-0.0690) * zy_td_def + (+0.0264) * zy_sub_int`. If the engine keeps a = b = 1: `s = (-0.1069) * zy_td_def + (+0.0017) * zy_sub_int`.
   - `gnp_att` (on): multiply X's ground-strike rate per top-control minute. With the fitted exponents (zx_g_rate 0.60): `s = (+0.1041) * zy_sub_int + (+0.0859) * zy_kd_pow`. If the engine keeps a = b = 1: `s = (+0.1038) * zy_sub_int + (+0.0744) * zy_kd_pow`.
   - `leg_share` (knob, default off): add to the log-odds of X's leg-target share, then rescale head and body to fill the rest. With the fitted exponents (zx_sh_l 0.94, zy_osh_l 0.50): `s = (-0.0813) * length_d + (+0.0402) * zy_press + (-0.0417) * zy_td_int`. If the engine keeps a = b = 1: `s = (-0.0483) * length_d + (+0.0228) * zy_press + (-0.0206) * zy_td_int`.
   - `body_share` (knob, default off): add to the log-odds of X's body-target share. With the fitted exponents (zx_sh_b 0.89): `s = (+0.1045) * open`. If the engine keeps a = b = 1: `s = (+0.1040) * open`.
   - `kd` (knob, default off): multiply knockdown probability per landed head strike. With the fitted exponents (zx_kd_pow 0.53, zy_chin 0.28): `s = (-0.1186) * zy_vol`. If the engine keeps a = b = 1: `s = (-0.0781) * zy_vol`.
   - `sub_att` (knob, default off): multiply submission-attempt rate. With the fitted exponents (zx_sub_int 0.59, zy_osub_int 0.33): `s = (+0.1323) * zy_octrl`. If the engine keeps a = b = 1: `s = (-0.0923) * zy_octrl`.
   For a Poisson rate: `rate *= exp(s)`. For a share: `logit(p) += s`. Products such as `zx_ctrl*zy_octrl` are the product of the two z-scores. `open`, `x_sp_vs_orth` are 0/1 from the listed stances (switch counts as neither). A term whose 'a=b=1' z is below 2 in absolute value is effectively zero under that composition.
3. **Control.** Control in the engine comes from takedowns (`td_att`, success unchanged) and how long the top man keeps the position (`ctrl_per_td`). The total `ctrl` block is the check: an engine with `td_att` and `ctrl_per_td` on should reproduce its direction for wrestler-vs-wrestler fights (less control) and the sub-multiplicative ceiling when a heavy controller meets a man who is often controlled. It will not reproduce the kicker effect (more control against kickers), which no on-block carries. Applying the `ctrl` block on top would count the other effects twice.
4. **Knob.** Expose one `styleMatchups` knob in [0, 1.5], default 1, that scales every `s`; 0 reproduces the pure skill composition. Optional blocks get their own toggle, default off.
5. **Labels.** Show the scouting archetype where a scouting file exists and the data archetype otherwise (with its membership); the data names describe centroids, and the attempts-ratio 'pressure' axis can label a forward-moving fighter who gets out-thrown (Gaethje) as a counter striker.
6. **Do not** add archetype-pair or interaction terms to the final win probability; none survived held-out validation and the combined set made 2024+ log loss worse. Do not use the scouting tags as numeric inputs in backtests (hindsight); use them for the director's technique choices and the page.
7. **Calibration order.** The modifiers are not orthogonal to the engine's exponents: with the main effects fixed at a = b = 1, the defender's-wrestling term on takedown attempts vanishes and the control ceiling term more than doubles (section 6). Ship them together with the exponents they were fit with (v4 should start its exponent search from the implied values above), or use the a = b = 1 column while the engine keeps a = b = 1; refit the modifiers by rerunning this tool whenever v4 changes the exponents or the prior strengths.
8. **Validation target for v7.** With the modifiers on, the engine's simulated per-fight stats should reproduce the 2024+ rate-level gains above (distance attempts per standing minute, takedown attempts per standing minute, control time per takedown, ground strikes per top-control minute), and its 2024+ winner log loss should be no worse than without them; that is the ship criterion, given that the winner-level effect is below what 1223 fights can detect.

## 10. Caveats

- Power: with 1223 held-out fights the paired bootstrap SE of a log-loss change is about 0.001-0.002, so winner-level matchup effects smaller than about 0.003 are invisible. The rate-level tests have far more information per fight, which is why they detect effects the winner tests cannot.
- ufcstats lacks cage position, feints, stance switches within fights, technique labels and per-target attempts by position; pressure, counter-punching and kick types can only be proxied.
- Control time includes clinch control; standing minutes are approximate (min minus both men's control).
- Stance, reach and height are the current tale of the tape, applied to past fights.
- All selection uses 2019-2023 (a revision made in verification; the first version selected on 2024+). The 2024+ period is reused for several descriptive tables (single-term labels, transmission, mismatch), so read the many 2024+ numbers as one family, not as independent confirmations. A stricter out-of-time split (screen 2019-2021, confirm 2022-2023) confirms fewer single terms; see the verification log.
- The skill baseline's main effects are style features too (shares, intents); a model without them would let interactions absorb main effects. The 'on top of Elo alone' table shows what that looks like.

## 11. Reproduce

```
python3 tools/styles.py              # about 5 minutes on 4 cores (prior-strength grid, 2000 bootstrap draws)
python3 tools/styles.py --report-only   # re-render this file from data/derived/styles.json
```

Needs numpy and pandas; reuses `tools/build_db.py` (parse_fights, build_vectors) for the per-fight vectors. The independent re-check (statsmodels, scikit-learn) is `python3 tools/styles_verify.py`, which writes `data/derived/styles_verify.json`; rerun `python3 tools/styles.py --report-only` afterwards to refresh the verification log below.

## Verification log

Adversarial review of this analysis, Nov 6, 2026. The independent code is `tools/styles_verify.py` (statsmodels GLMs with fight-clustered covariance, scikit-learn logistic regression on corner-swapped data, its own design matrices, z constants and bootstraps); its output is `data/derived/styles_verify.json`. The sections above already reflect the fixes listed here.

**Verdict.** The features and joins have no look-ahead leakage, and the headline numbers reproduce exactly. But the first version used the 2024+ test period to give rate-term verdicts, pick terms (including a 'judgment' term), and switch blocks on. It also overstated the z of symmetric terms. Both are fixed: all selection now uses 2019-2023 only. With clean selection, distance attempts (length, open stance, the opponent's power) and control per takedown (the opponent's takedown defense) keep held-out gains. The takedown-attempt block's held-out gain halves and its interval reaches zero. Leg share drops to optional, and ground-and-pound turns on. The winner-level null result stands. The modifier coefficients turned out to depend on the engine's composition exponents, so the recommendation now gives both coefficient sets.

### Checks that passed

| Check | Result |
|---|---|
| Fighter order (A/B vs per-fight vectors) | 6474 sides: sig. attempts, control and takedown attempts match the backtest's own `actual` in all but 0; opponent parts consistent in all but 0 fights |
| Pre-fight freezing of S | 4934 consecutive appearances satisfy S(next) = (S + this fight) x decay; 0 look like the fight was already inside S |
| Other walk-forward inputs (code reading of build_db.walk) | Elo is pre-fight; pace / cardio comes from the pre-fight accumulator; age is at the fight date; priors_asof uses fights before Jan 1 of the fight year; z constants, clusters, ridges and prior strengths are fit on 2019-2023 |
| Feature formulas | my own arithmetic for d_rate, td_int, td_def, kd_pow, sh_l on 600 random sides: max difference 7e-16 |
| z constants | recomputed from 2019-2023 sides: max difference 4e-05 sd |
| Draws, no-contests, cards | excluded from winner models (3178 decisive of 3237); kept in rate models (their stats are real); judges' cards are not used, so the loser-first order cannot bite |
| Rate blocks (fresh statsmodels refit) | every selected block's coefficients reproduce (max difference 5e-06 per sd) and so do the 2024+ deviance changes (max difference 3.1e-05 percentage points); the bootstrap CIs agree within resampling noise |
| Winner level (fresh scikit-learn fit) | Elo 0.6807, skill baseline 0.6272 (LOYO-chosen C = 0.01) vs the report's 0.6805 / 0.6272; lift over Elo -0.0535, CI [-0.0677, -0.0390]. The three tune-screened interactions change 2024+ log loss by +0.0020, +0.0018, -0.0010; all three together by +0.0026 (CI [-0.0029, +0.0081]). The null result stands. Age carries most of the lift (dropping it costs +0.0152); it is computed from date of birth at the fight date |
| Is 'less output against power' just being hurt or short fights? | No. The opponent's-power coefficient on distance attempts is -0.0239 per sd on all minutes, -0.0240 on completed rounds only, and -0.0249 (z -3.12) on completed rounds before any knockdown either way. It is pre-emptive caution, not the engine's hurt state counted twice |

### Problems found and fixed

1. **Selection on the test period (the main flaw).** Verdicts ('survives' = 2024+ CI below zero, 'supported' = negative 2024+ change and the test refit agrees) decided which terms went in. A tier-3 'judgment' term (the defender's kick share on takedown attempts, tune z 2.4 < 3) was added because its 2024+ CI was below zero. Blocks were switched on when their joint 2024+ CI was below zero. So the reported block gains were partly fit to the test set. The fix moves every decision onto 2019-2023: a fight-clustered z screen, then a leave-one-year-out out-of-fold deviance change with a fight-bootstrap CI for terms (CV-confirmed) and for blocks (on by default). The forward step is unchanged, there are no judgment terms, and 2024+ is scored once. Effect on the blocks (2024+ deviance change, my refit):

| Rate | First version (test-selected) | 2024+ | After fix (tune-selected) | 2024+ | Status after fix |
|---|---|---|---|---|---|
| dist_att | zy_kd_pow, length_d, open | -1.95% [-742, -98] | length_d, open, zy_kd_pow | -1.95% [-751, -83] | on |
| leg_share | zy_td_int, length_d, zy_press | -1.10% [-252, -24] | length_d, zy_press, zy_td_int | -1.10% [-240, -24] | optional (tune CV CI crosses zero) |
| td_att | zy_td_int, length_d, zy_td_def, kick_y | -1.77% [-260, -51] | zy_td_int, length_d, zy_vol, zy_td_def | -0.93% [-196, +33] | on |
| ctrl | kick_y, zx_ctrl*zy_octrl, zy_td_int, length_d | -1.81% [-8521, -2218] | kick_y, zx_ctrl*zy_octrl, zy_td_int | -1.68% [-7719, -1950] | check only (on by tune CV) |
| ctrl_per_td | zy_td_def | -0.78% [-3358, -106] | zy_td_def, zy_sub_int | -0.81% [-3465, -33] | on |
| gnp_att | optional: zy_sub_int, zy_kd_pow |  | zy_sub_int, zy_kd_pow | -0.77% [-494, +108] | on |
| body_share | optional: open |  | open | -0.05% [-74, +59] | optional (tune CV CI crosses zero) |
| kd | optional: none |  | zy_vol | -0.20% [-16, +7] | optional (tune CV CI crosses zero) |
| sub_att | optional: none |  | zy_octrl | -0.20% [-19, +10] | optional (tune CV CI crosses zero) |

2. **Mis-specified uncertainty.** The rate-model z treated the two sides of a fight as independent, with quasi-likelihood dispersion. Fight-clustered sandwich z (now used for the screen) against the first version's z: dist_att/zy_kd_pow -4.63 -> -3.61; dist_att/open -5.76 -> -4.34; dist_att/length_d +7.17 -> +9.28; leg_share/zy_td_int -3.76 -> -3.19; leg_share/zy_press +3.79 -> +3.27; body_share/open +4.98 -> +4.04; td_att/zy_td_int -4.54 -> -4.78; ctrl/zx_ctrl*zy_octrl -3.60 -> -3.19; ctrl/length_d -3.04 -> -2.49; ctrl_per_td/zy_td_def -4.62 -> -4.67; dist_acc/kick_x +4.27 -> +3.66. Symmetric opponent terms lose 15-35% of their z; antisymmetric physical terms gain. The numpy sandwich in `styles.py` matches statsmodels (max |z difference| 0.00).

3. **'Close to orthogonal to the engine's exponents' was false.** The modifiers were fit next to free main-effect coefficients, which imply exponents well below the engine's default a = b = 1 for what the defender allows. Refitting the same terms with the main effects fixed at a = b = 1 (offset) changes them materially (coefficient per term sd, free -> a = b = 1): dist_att: length_d +0.039 -> +0.032, open -0.033 -> -0.030, zy_kd_pow -0.024 -> -0.010; td_att: zy_td_int -0.076 -> +0.001, length_d -0.081 -> -0.058, zy_vol +0.077 -> +0.168, zy_td_def -0.093 -> -0.074; ctrl: kick_y +0.062 -> +0.047, zx_ctrl*zy_octrl -0.069 -> -0.172, zy_td_int -0.049 -> -0.030; ctrl_per_td: zy_td_def -0.069 -> -0.107, zy_sub_int +0.026 -> +0.002; gnp_att: zy_sub_int +0.104 -> +0.104, zy_kd_pow +0.086 -> +0.074. Section 6 and section 9 now carry the implied exponents and both coefficient sets; `styles.py` and this check agree on the a = b = 1 values (max difference 1e-05 per unit).

4. **Smaller items.** The module defaults K_TD = 8 and K_HEAD = 125 contradicted the comment saying they were the tuned values (4 and 60). `main()` re-tunes them, so results were unaffected, but `--no-shrink-tune` would have used the wrong values; they are corrected. Report claims that no style term touches knockdowns or submissions were softened: with clustered z, single terms clear the screen there, but no block passes the tune CV. The analyst's summary quoted scouting AUCs from an earlier run (e.g. leg-kicks 0.95 vs 0.94 in the report); the report's numbers are generated from the JSON.

### What remains uncertain (stated, not fixable with this data)

- **A stricter split confirms fewer single terms.** Screening on 2019-2021 and confirming on 2022-2023 (about 700 fights) confirms only dist_att/length_d; leg_share/zy_td_int, leg_share/open, td_acc/zy_ctrl, ctrl/zx_ctrl*zy_octrl, ctrl/kick_y, ctrl_per_td/zy_td_def, kd/zy_vol, clinch_att/zy_press, gnp_att/zy_kd_pow do not confirm there (deviance change >= 0 or the 2022-2023 refit flips sign), although several of them hold on 2024+. Single-term evidence is noisy from year to year; the block-level tune CV, which pools five years, is the steadier guide.
- **Per-year forward chaining** (fit on all earlier years from 2019, score the next year; deviance change, negative = better): dist_att 21:-301 22:-169 23:-139 24:+5 25:-216 26:-205 (better in 5 of 6); td_att 21:-75 22:-55 23:+9 24:+3 25:-7 26:-82 (better in 4 of 6); ctrl 21:-1543 22:+392 23:+618 24:-1074 25:-1858 26:-1831 (better in 4 of 6); ctrl_per_td 21:-919 22:-227 23:+264 24:-755 25:-834 26:-193 (better in 5 of 6); gnp_att 21:-57 22:+20 23:-128 24:-239 25:+2 26:+64 (better in 3 of 6); leg_share 21:+3 22:+10 23:-47 24:-37 25:-45 26:-53 (better in 4 of 6); body_share 21:-31 22:-11 23:-19 24:-15 25:+12 26:-5 (better in 5 of 6); kd 21:-5 22:-0 23:+1 24:+1 25:-2 26:-3 (better in 4 of 6); sub_att 21:-4 22:-5 23:+2 24:-8 25:-5 26:+9 (better in 4 of 6).
- **Winner-level transmission is still not significant.** Clean default-on modifiers through the expected-scorecard stand-in: -0.0015 log loss, CI [-0.0040, +0.0011]; every screened term: -0.0007, CI [-0.0032, +0.0019].
- Stance, reach and height are the current tale of the tape applied to past fights, a mild look-ahead that matters mainly for the stance terms. Archetypes and scouting AUCs were checked by code reading only (k-means and standardisation fit on 2019-2023; scouting tags are hindsight and used descriptively); they do not feed the engine numbers.
