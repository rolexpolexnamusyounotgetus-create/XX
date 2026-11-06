# Styles and matchups: style vectors, archetypes and interaction tests (engine v7 component)

Built 2026-11-06 from the ufcstats snapshot through 2026-10-31 by `tools/styles.py`; machine-readable output in `data/derived/styles.json`. Walk-forward throughout: every feature of a backtest fight comes from the two sides' frozen pre-fight sums and the priors of fights before Jan 1 of the fight year; standardisation, clusters, prior strengths, penalties and coefficients are fit on 2019-2023 only; 2024-01-01 onward (1223 decisive fights) is reported, never tuned on.

## Summary

- **Style interactions do not move the winner prediction by a detectable amount.** On top of an engine-free skill model (Elo, age, reach and 29 shrunk skill and style main effects; 2024+ log loss 0.6272, accuracy 0.659, vs Elo alone 0.6805), none of 33 pre-registered matchup terms survives held-out validation (0 survive; 1 consistent in sign but not significant: leg kicker vs opponent who gets leg-kicked). The 8x8 archetype interaction matrix makes held-out log loss worse (+0.0029). Adding every term that looked good in 2019-2023 at once raises 2024+ log loss from 0.6272 to 0.6307.
- **Inside the fight, matchups are real and measurable.** At the rate level (one row per fighter per fight, X attacking Y, exposure-correct baselines that already contain the engine's log-linear / log5 main effects), several style terms pass a tune-period screen and then improve 2024+ deviance with fight-level bootstrap intervals that exclude zero. The blocks recommended on by default:
  - `dist_att` (distance significant attempts per standing minute): zy_kd_pow -0.024/sd, length_d +0.039/sd, open -0.033/sd; 2024+ deviance -1.95% (95% CI of the change [-758, -73]).
  - `leg_share` (leg share of significant attempts): zy_td_int -0.042/sd, length_d -0.049/sd, zy_press +0.040/sd; 2024+ deviance -1.10% (95% CI of the change [-244, -18]).
  - `td_att` (takedown attempts per standing minute): zy_td_int -0.098/sd, length_d -0.080/sd, zy_td_def -0.079/sd, kick_y +0.038/sd (judgment); 2024+ deviance -1.77% (95% CI of the change [-264, -56]).
  - `ctrl` (control seconds per minute (quasi-Poisson)): kick_y +0.062/sd, zx_ctrl*zy_octrl -0.069/sd, zy_td_int -0.044/sd, length_d -0.046/sd; 2024+ deviance -1.81% (95% CI of the change [-8379, -2158]); a composition check, not applied in the engine (section 9).
  - `ctrl_per_td` (control seconds per takedown landed (duration; quasi-Poisson)): zy_td_def -0.077/sd; 2024+ deviance -0.78% (95% CI of the change [-3243, -104]).
  In words: fighters throw about 2.4% less at distance per sd of the opponent's knockdown power; the longer man throws more at distance, kicks the legs less and shoots less; open-stance fights see about 7% fewer distance attempts; everyone kicks the legs less and shoots about 9% less per sd of the opponent's wrestling, and shoots about 8% less per sd of takedown defense, which also cuts control time per takedown by about 7%; kickers get taken down more.
- **Applied mechanistically, they move win probabilities only slightly.** Feeding the modifiers through an expected-scorecard stand-in for the engine (predicted rates -> expected judging impact) changes win probabilities by a median 1.3 points (max 7.3) and moves 2024+ log loss of the Elo + scorecard model by -0.0016 (CI [-0.0040, 0.0007]); the clean variant that uses only the tune-period screen moves it by -0.0001 (CI [-0.0022, 0.0020]). Neither is significant: the gain is in realistic fight statistics, not in a measurable edge on who wins.
- **Recommendation:** apply styles as rate modifiers inside the engine (section 9, exact equations and values); do not add archetype or interaction tweaks to the final win probability; use the archetypes for labels, the director and the page.
- **Archetypes are a continuum.** Silhouette is about 0.09 for every k from 4 to 12, so there are no natural clusters. k = 8 is the most stable of the interpretable solutions (bootstrap adjusted Rand 0.53) and its clusters match expert scouting on the grappling and kicking axes (tag AUCs: top-control 0.98, leg-kicks 0.95, takedown-defense 0.95, volume 0.92), but the attempts-ratio pressure proxy does not match the scouts' 'pressure' or 'counter' tags (AUC 0.48 and 0.52): ufcstats has no cage position.
- **By-product for v9:** the engine-free skill logistic (2024+ log loss 0.6272) is a far stronger benchmark than Elo (0.6805) and a natural stacking input; its coefficients are in `styles.json` (`winner_level.skill_baseline`).

## 1. Data and design

- Fights: 3237 walk-forward backtest entries 2019-01-01 to 2026-10-31 (both men with a prior UFC fight), 3178 decisive; tune 2019-2023, test 2024+ (1223 decisive). Per-fight actual stats by position and target come from `data/raw/ufc_fight_stats.csv` through `tools/build_db.py` (round rows summed per fighter).
- Symmetry: winner models are antisymmetric (every feature is A minus B, no intercept), so the first-named corner, which wins 56% of the time, cannot leak; rate models have one row per side.
- Uncertainty: held-out changes carry 95% intervals from a paired bootstrap over test fights (2000 replicates; both sides of a fight resampled together in the rate models). 'z (tune)' is the Wald z on 2019-2023 (quasi-likelihood dispersion for counts). 'z (test only)' refits on 2024+ as a diagnostic and is never used for selection.
- Selection rule (fixed before looking at 2024+): a winner-level term is *screened in* if |z (tune)| >= 2 (likelihood-ratio p < 0.05 for blocks) and leave-one-year-out CV log loss inside 2019-2023 improves; a rate-level term if |z (tune)| >= 3 and CV deviance improves (the stricter bar allows for about 150 rate tests). A screened term **survives** if its 2024+ change is negative with the 95% CI below zero, is **supported** if the change is negative and the test-only refit has the same sign, else **fails held-out**.
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
| elo+scorecard(tune_screened) | 0.6581 | 0.6613 | 0.6553 |
| elo+scorecard(tier1) | 0.6578 | 0.6615 | 0.6533 |
| elo+scorecard(default_on) | 0.6567 | 0.6598 | 0.6533 |
| elo+scorecard(all_recommended) | 0.6578 | 0.6606 | 0.6547 |

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

Screened-in and other notable candidates (coefficient per sd of the term; deviance change on 2024+, sum over fight sides; negative = better):

| Model | Term | Coef/sd | z (tune) | CV change | 2024+ change | 95% CI | z (test only) | Verdict |
|---|---|---|---|---|---|---|---|---|
| dist_att | `zy_kd_pow` | -0.0256 | -4.63 | -198.1 | -220.6 (-1.02%) | [-376.3, -74.0] | -5.08 | survives |
| dist_att | `kick_x` | +0.0170 | 3.18 | -72.1 | -32.0 (-0.15%) | [-134.1, +67.1] | 1.91 | supported (own-style, not a matchup) |
| dist_att | `open` | -0.0328 | -5.76 | -292.5 | -66.9 (-0.31%) | [-312.5, +185.4] | -3.31 | supported |
| dist_att | `x_sp_vs_orth` | -0.0227 | -3.89 | -115.2 | +35.9 (+0.17%) | [-98.1, +183.8] | -1.04 | fails held-out |
| dist_att | `length_d` | +0.0395 | 7.17 | -512.5 | -157.2 (-0.73%) | [-334.8, +13.0] | 4.35 | supported |
| dist_att | `zy_vol` | -0.0190 | -3.07 | -83.1 | +39.1 (+0.18%) | [-67.7, +149.2] | -0.82 | fails held-out |
| dist_acc | `kick_x` | +0.0268 | 4.27 | -35.8 | -45.6 (-0.62%) | [-96.3, +0.2] | 4.01 | supported (own-style, not a matchup) |
| leg_share | `zy_td_int` | -0.0507 | -3.76 | -53.0 | -106.6 (-0.89%) | [-181.3, -35.0] | -4.81 | survives |
| leg_share | `zy_press` | +0.0513 | 3.79 | -51.6 | -3.5 (-0.03%) | [-74.7, +66.8] | 1.62 | supported |
| leg_share | `length_d` | -0.0581 | -4.16 | -97.2 | -54.1 (-0.45%) | [-120.9, +7.4] | -3.18 | supported |
| body_share | `open` | +0.0466 | 4.98 | -96.2 | -5.1 (-0.05%) | [-74.3, +63.6] | 2.02 | supported |
| td_att | `zy_td_def` | -0.0673 | -3.22 | -48.5 | -11.9 (-0.13%) | [-58.3, +36.2] | -1.63 | supported |
| td_att | `kick_y` | +0.0522 | 2.42 | -24.3 | -63.5 (-0.71%) | [-100.8, -26.4] | 4.38 | not screened in |
| td_att | `zy_td_int` | -0.0992 | -4.54 | -99.3 | -79.7 (-0.89%) | [-152.7, -8.4] | -4.17 | survives |
| td_att | `zy_vol` | +0.0853 | 3.67 | -51.1 | +6.3 (+0.07%) | [-53.6, +66.8] | 1.74 | fails held-out |
| td_att | `length_d` | -0.0901 | -3.97 | -74.2 | -30.2 (-0.34%) | [-90.2, +31.2] | -2.53 | supported |
| ctrl | `zx_ctrl*zy_octrl` | -0.0654 | -3.60 | -1072.0 | -1902.0 (-0.66%) | [-3639.0, -297.7] | -4.06 | survives |
| ctrl | `zy_td_int` | -0.0536 | -3.22 | -1016.0 | -1426.0 (-0.49%) | [-2881.0, -90.1] | -3.53 | survives |
| ctrl | `zy_ctrl` | -0.0385 | -2.27 | -562.8 | -1231.0 (-0.43%) | [-2273.0, -226.2] | -3.61 | not screened in |
| ctrl | `kick_y` | +0.0660 | 4.00 | -1792.0 | -1695.0 (-0.59%) | [-3351.0, -27.9] | 3.74 | survives |
| ctrl | `length_d` | -0.0500 | -3.04 | -403.3 | -568.2 (-0.20%) | [-2017.0, +920.0] | -2.12 | supported |
| ctrl_per_td | `zy_td_def` | -0.0767 | -4.62 | -2263.0 | -1735.0 (-0.78%) | [-3280.0, -184.0] | -3.83 | survives |
| gnp_att | `zy_sub_int` | +0.1024 | 4.09 | -242.1 | -145.6 (-0.58%) | [-376.3, +74.6] | 2.92 | supported |
| gnp_att | `zy_kd_pow` | +0.0841 | 3.50 | -142.5 | -45.4 (-0.18%) | [-214.9, +116.0] | 1.82 | supported |

Everything else (115 candidates, listed in `styles.json`) failed the screen. Null results worth stating: no style term changes distance accuracy, takedown success, knockdowns per landed head strike or submission attempts beyond the main effects; the log5 / log-linear combination itself shows no interaction (`zx_acc*zy_dfn`, `zx_td_acc*zy_td_def`, `zx_kd_pow*zy_chin`, `zx_d_rate*zy_od_rate` all near zero), so the engine's multiplicative composition is adequate. Southpaw vs orthodox does not change accuracy or knockdowns.

## 6. The modifier set and its size

Per model, held-out survivors go in first; held-out-supported matchup terms are then added in order of tune z only if they lower 2019-2023 CV deviance given what is already in (this resolves overlapping terms on tune data). Terms built only from the attacker's own style are excluded: they are decomposition corrections, not matchups. A block is **on by default** when its joint 2024+ deviance change has a CI below zero.

**On by default**

| Rate | Term | Definition | Tier | Coef per term sd | Coef per unit | z (tune, joint) | exp(coef) at +1 sd |
|---|---|---|---|---|---|---|---|
| dist_att | `zy_kd_pow` | defender's knockdown power (z) | 1 | -0.0238 | -0.0238 | -4.35 | 0.976 |
| dist_att | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 2 | +0.0385 | +0.0639 | 7.03 | 1.039 |
| dist_att | `open` | 1 if one is southpaw and the other orthodox | 2 | -0.0326 | -0.0731 | -5.77 | 0.968 |
| dist_att | *block* | 2024+ deviance -1.95%, CI [-758, -73] |  |  |  |  |  |
| leg_share | `zy_td_int` | defender's takedown intent (z) | 1 | -0.0417 | -0.0417 | -3.07 | 0.959 |
| leg_share | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 2 | -0.0490 | -0.0813 | -3.48 | 0.952 |
| leg_share | `zy_press` | defender's pressure proxy (z) | 2 | +0.0402 | +0.0402 | 2.94 | 1.041 |
| leg_share | *block* | 2024+ deviance -1.10%, CI [-244, -18] |  |  |  |  |  |
| td_att | `zy_td_int` | defender's takedown intent (z) | 1 | -0.0980 | -0.0980 | -4.44 | 0.907 |
| td_att | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 2 | -0.0799 | -0.1325 | -3.55 | 0.923 |
| td_att | `zy_td_def` | defender's takedown defense (z) | 2 | -0.0786 | -0.0786 | -3.77 | 0.924 |
| td_att | `kick_y` | defender's kick share (z_sh_l + z_sh_b)/sqrt(2) | 3 | +0.0380 | +0.0346 | 1.78 | 1.039 |
| td_att | *block* | 2024+ deviance -1.77%, CI [-264, -56] |  |  |  |  |  |
| ctrl | `kick_y` | defender's kick share (z_sh_l + z_sh_b)/sqrt(2) | 1 | +0.0619 | +0.0565 | 3.75 | 1.064 |
| ctrl | `zx_ctrl*zy_octrl` | attacker's control propensity x defender's time-controlled propensity (z x z) | 1 | -0.0694 | -0.0690 | -3.84 | 0.933 |
| ctrl | `zy_td_int` | defender's takedown intent (z) | 1 | -0.0444 | -0.0444 | -2.65 | 0.957 |
| ctrl | `length_d` | length advantage: ((reach_X - reach_Y)/sd_reach + (height_X - height_Y)/sd_height) / 2 | 2 | -0.0456 | -0.0757 | -2.78 | 0.955 |
| ctrl | *block* | 2024+ deviance -1.81%, CI [-8379, -2158] |  |  |  |  |  |
| ctrl_per_td | `zy_td_def` | defender's takedown defense (z) | 1 | -0.0767 | -0.0767 | -4.62 | 0.926 |
| ctrl_per_td | *block* | 2024+ deviance -0.78%, CI [-3243, -104] |  |  |  |  |  |

**Optional (knob, default off)**

| Rate | Term | Definition | Tier | Coef per term sd | Coef per unit | z (tune, joint) | exp(coef) at +1 sd |
|---|---|---|---|---|---|---|---|
| body_share | `open` | 1 if one is southpaw and the other orthodox | 2 | +0.0466 | +0.1045 | 4.98 | 1.048 |
| body_share | *block* | 2024+ deviance -0.05%, CI [-73, 62] |  |  |  |  |  |
| gnp_att | `zy_sub_int` | defender's submission intent (z) | 2 | +0.1041 | +0.1041 | 4.15 | 1.110 |
| gnp_att | `zy_kd_pow` | defender's knockdown power (z) | 2 | +0.0859 | +0.0859 | 3.58 | 1.090 |
| gnp_att | *block* | 2024+ deviance -0.77%, CI [-487, 89] |  |  |  |  |  |

Tier 1 = survived alone; tier 2 = supported alone and kept by the tune-CV step; tier 3 = judgment term (kick_y on td_att): it missed the tune screen (z 2.42 < 3) but its 2024+ change has a CI below zero and it carries the total-control model's surviving kicker effect (a decomposition puts that effect on takedown attempts and takedowns landed, not on takedown accuracy, control duration or control without a takedown). Without it the td_att block's 2024+ deviance change is -1.28% (CI [-220, -7]); with it, -1.77%. Joint z values are lower than the single-term ones where terms share signal. How big the modifiers get across real 2024+ matchups (the modifier part of the linear predictor, log scale for rates and log-odds for shares):

| Rate | p5 | p25 | median | p75 | p95 | median |shift| |
|---|---|---|---|---|---|---|
| dist_att | -0.117 | -0.057 | -0.015 | 0.020 | 0.066 | 0.037 |
| leg_share | -0.142 | -0.064 | -0.008 | 0.054 | 0.142 | 0.060 |
| td_att | -0.278 | -0.119 | -0.013 | 0.101 | 0.257 | 0.111 |
| ctrl | -0.190 | -0.074 | -0.004 | 0.070 | 0.185 | 0.072 |
| ctrl_per_td | -0.123 | -0.051 | 0.000 | 0.048 | 0.119 | 0.049 |
| body_share | 0.000 | 0.000 | 0.000 | 0.105 | 0.105 | 0.000 |
| gnp_att | -0.209 | -0.092 | 0.004 | 0.106 | 0.219 | 0.099 |

So a typical matchup moves a rate by 3-10% and the 5% most extreme by 10-25%. Examples (multipliers for Poisson rates, log-odds shifts for shares, all blocks including optional ones):

| Attacker vs defender | Attacker archetype (live) | Modifiers |
|---|---|---|
| alexander-volkanovski vs justin-gaethje | counter striker | dist_att x0.96, leg_share +0.03, body_share +0.00, td_att x1.08, ctrl x1.00, ctrl_per_td x0.96, gnp_att x0.85 |
| justin-gaethje vs alexander-volkanovski | counter striker | dist_att x1.07, leg_share -0.03, body_share +0.00, td_att x0.90, ctrl x0.86, ctrl_per_td x1.02, gnp_att x0.83 |
| islam-makhachev vs alexander-volkanovski | clinch-control wrestle-boxer | dist_att x0.99, leg_share -0.02, body_share +0.10, td_att x0.91, ctrl x1.12, ctrl_per_td x1.02, gnp_att x0.83 |
| alexander-volkanovski vs islam-makhachev | counter striker | dist_att x0.89, leg_share -0.06, body_share +0.10, td_att x0.86, ctrl x0.95, ctrl_per_td x0.92, gnp_att x1.17 |
| alex-pereira vs magomed-ankalaev | rangy kickboxer | dist_att x1.04, leg_share -0.05, body_share +0.00, td_att x0.87, ctrl x0.67, ctrl_per_td x0.93, gnp_att x1.10 |
| magomed-ankalaev vs alex-pereira | clinch / body-kick all-rounder | dist_att x0.95, leg_share +0.12, body_share +0.00, td_att x1.27, ctrl x1.23, ctrl_per_td x0.89, gnp_att x1.04 |
| merab-dvalishvili vs sean-o-malley | wrestler / top-control grappler | dist_att x0.93, leg_share +0.24, body_share +0.00, td_att x1.62, ctrl x1.24, ctrl_per_td x1.05, gnp_att x0.89 |
| sean-o-malley vs merab-dvalishvili | rangy kickboxer | dist_att x1.15, leg_share -0.12, body_share +0.00, td_att x0.62, ctrl x0.51, ctrl_per_td x0.97, gnp_att x0.79 |
| khamzat-chimaev vs dricus-du-plessis | wrestler / top-control grappler | dist_att x1.02, leg_share +0.01, body_share +0.00, td_att x1.07, ctrl x0.96, ctrl_per_td x1.06, gnp_att x0.97 |
| dricus-du-plessis vs khamzat-chimaev | power brawler | dist_att x1.02, leg_share -0.10, body_share +0.00, td_att x0.85, ctrl x0.87, ctrl_per_td x0.97, gnp_att x1.01 |
| ilia-topuria vs max-holloway | counter striker | dist_att x0.97, leg_share +0.20, body_share +0.00, td_att x1.43, ctrl x1.26, ctrl_per_td x0.99, gnp_att x0.89 |
| max-holloway vs ilia-topuria | rangy kickboxer | dist_att x1.00, leg_share -0.07, body_share +0.00, td_att x0.81, ctrl x0.85, ctrl_per_td x0.84, gnp_att x1.12 |

## 7. Does the mechanism reach the outcome? (transmission test)

A stand-in for the engine: fit every rate model on 2019-2023, predict each side's per-minute rates from features only (control first, standing share = 1 - both men's control, then distance attempts x accuracy, clinch and ground strikes at prior accuracy, target split, takedowns, knockdowns, submissions), turn them into an expected judging impact per 15 minutes with the EM round-winner weights (head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min, sub attempt 0.85), and add the A-minus-B difference to a winner model. Variants differ only in which modifiers the rate models carry.

| Modifiers | Model | 2024+ log loss | Accuracy | z of impact term | Change vs none [95% CI] | Median / max |dp| (points) |
|---|---|---|---|---|---|---|
| none | elo plus impact | 0.6603 | 0.624 | 6.61 |  |  |
| none | baseline plus impact | 0.6267 | 0.661 | 0.93 |  |  |
| tune_screened | elo plus impact | 0.6601 | 0.615 | 6.90 | -0.0001 [-0.0022, +0.0020] | 1.2 / 7.0 |
| tune_screened | baseline plus impact | 0.6268 | 0.661 | 1.22 | +0.0001 [-0.0005, +0.0007] | 0.3 / 1.8 |
| tier1 | elo plus impact | 0.6602 | 0.620 | 6.74 | -0.0001 [-0.0016, +0.0014] | 0.8 / 6.0 |
| tier1 | baseline plus impact | 0.6268 | 0.666 | 1.20 | +0.0001 [-0.0003, +0.0005] | 0.2 / 1.6 |
| default_on | elo plus impact | 0.6587 | 0.620 | 7.03 | -0.0016 [-0.0040, +0.0007] | 1.3 / 7.3 |
| default_on | baseline plus impact | 0.6266 | 0.662 | 1.22 | -0.0001 [-0.0007, +0.0005] | 0.3 / 2.0 |
| all_recommended | elo plus impact | 0.6596 | 0.615 | 7.00 | -0.0007 [-0.0029, +0.0015] | 1.2 / 6.6 |
| all_recommended | baseline plus impact | 0.6267 | 0.661 | 1.19 | +0.0000 [-0.0006, +0.0006] | 0.3 / 2.0 |

Read: the scorecard alone lifts Elo from 0.6805 to 0.6603 (it is a real, if crude, mechanistic predictor). Modifiers change the scorecard model's 2024+ log loss by at most about 0.002, with intervals that include zero; the 'tune_screened' row is the clean test (no 2024+ data used to pick terms) and is flat. On top of the full skill baseline the scorecard adds nothing, as expected: the baseline already holds the same main effects. The held-out period was used once to confirm each rate term, so the tier1 / default_on rows are consistency checks rather than independent tests.

Median relative change in the expected per-minute stats from the modifiers (2019-2026 sides): tune_screened: h 4.9%, b 3.5%, l 4.3%, kd 4.9%, td 11.6%, ctrl 7.3%; tier1: h 2.5%, b 2.4%, l 3.1%, kd 2.5%, td 6.5%, ctrl 6.5%; default_on: h 4.1%, b 3.7%, l 4.5%, kd 4.1%, td 10.3%, ctrl 7.3%; all_recommended: h 4.5%, b 3.2%, l 4.5%, kd 4.5%, td 10.3%, ctrl 7.3%.

## 8. Scouting files versus the data

83 fighters in `data/scouting/` have a live profile. The scouting tags are written in 2026 with hindsight, so they cannot be used in a walk-forward backtest; they serve here to check what the data features mean. AUC = chance that a tagged fighter scores higher on the data feature than an untagged one (signed so 1 = agreement).

| Tag | Data feature | Sign | Tagged | AUC |
|---|---|---|---|---|
| top-control | `ctrl` | + | 35 | 0.98 |
| chain-wrestling | `td_int` | + | 11 | 0.95 |
| leg-kicks | `sh_l` | + | 27 | 0.95 |
| takedown-defense | `td_def` | + | 37 | 0.95 |
| volume | `vol` | + | 18 | 0.92 |
| body-work | `sh_b` | + | 34 | 0.89 |
| chin-concern | `chin` | + | 19 | 0.88 |
| submissions | `sub_int` | + | 34 | 0.88 |
| back-takes | `sub_int` | + | 22 | 0.84 |
| cage-wrestling | `td_int` | + | 8 | 0.82 |
| power | `kd_pow` | + | 36 | 0.81 |
| clinch | `sh_c` | + | 20 | 0.78 |
| durable | `chin` | - | 33 | 0.76 |
| late-surge | `late` | + | 21 | 0.76 |
| rangy | `reach_rel` | + | 24 | 0.75 |
| calf-kicks | `sh_l` | + | 4 | 0.75 |
| cardio | `late` | + | 22 | 0.70 |
| fades-late | `late` | - | 4 | 0.69 |
| elbows | `sh_c` | + | 16 | 0.58 |
| knees | `sh_c` | + | 7 | 0.58 |
| head-movement | `dfn` | + | 3 | 0.53 |
| counter | `press` | - | 19 | 0.52 |
| ground-and-pound | `g_rate` | + | 31 | 0.51 |
| jab | `sh_h` | + | 16 | 0.48 |
| pressure | `press` | + | 24 | 0.48 |

What the weakly matched tags line up with instead (best three features by |AUC - 0.5|): **pressure**: sh_l 0.22, otd_int 0.30, otd_rate 0.31; **counter**: ctrl 0.27, kd_pow 0.71, osh_l 0.69; **durable**: ko_l 0.16, chin 0.24, late 0.73; **cardio**: kd_pow 0.22, fin_w 0.27, lexp 0.72; **ground-and-pound**: sh_g 0.85, sh_d 0.18, ctrl 0.77; **power**: kd_pow 0.81, g_rate 0.79, fin_w 0.78.

Scouts' 'pressure' fighters kick the legs less and get fewer takedown attempts against them; nothing in the attempt counts measures walking a man down. Treat `press` as an output-share feature, not as pressure in the coaching sense, and keep the scouting tag for the director. Stance agrees with the tale of the tape for every scouted fighter (orthodox|orthodox 49, southpaw|southpaw 20, switch|switch 14).

Scouting archetype family (rows) against the data archetype (largest live membership):

| Scouting family | wrestler / top-control grappler | clinch-control wrestle-boxer | pressure volume striker | counter striker | clinch / body-kick all-rounder | power brawler | high-volume distance boxer | rangy kickboxer |
|---|---|---|---|---|---|---|---|---|
| all-round | 0 | 3 | 0 | 1 | 3 | 4 | 0 | 1 |
| boxing | 0 | 0 | 1 | 4 | 1 | 2 | 0 | 1 |
| counter | 0 | 1 | 0 | 0 | 0 | 2 | 1 | 1 |
| grappling | 10 | 9 | 3 | 4 | 1 | 1 | 0 | 0 |
| kicking | 0 | 0 | 0 | 0 | 2 | 3 | 1 | 8 |
| power | 0 | 0 | 0 | 1 | 0 | 3 | 1 | 1 |
| pressure | 0 | 0 | 0 | 1 | 0 | 1 | 1 | 0 |
| volume | 0 | 0 | 2 | 0 | 0 | 1 | 2 | 1 |

## 9. Exact recommendation for the engine

1. **Inputs.** For each fighter use the live style z-scores in `styles.json` `roster[slug].z` (built from fighters.json sums with the live division priors and standardised with `zscore.mu/sd` from 2019-2023), or recompute them with `Side.features`. For a backtest fight, compute them from the frozen `S` with `priors_asof[year]` (never the live priors). `kick = (z_sh_l + z_sh_b) / sqrt(2)`. Physical terms use `sd_reach = 4.574` in and `sd_height = 3.740` in.
2. **Where they act.** For attacker X against defender Y, each block adds `s = sum_k c_k * t_k` (`c_k` = 'coef per unit' above, `t_k` = term value) to the linear predictor of one engine rate, after the engine has combined X's and Y's own rates (log-linear / log5):
   - `dist_att` (on): multiply X's distance strike-attempt rate (per standing minute), with `s = (-0.0238) * zy_kd_pow + (+0.0639) * length_d + (-0.0731) * open`.
   - `leg_share` (on): add to the log-odds of X's leg-target share, then rescale head and body to fill the rest, with `s = (-0.0417) * zy_td_int + (-0.0813) * length_d + (+0.0402) * zy_press`.
   - `td_att` (on): multiply X's takedown-attempt rate (per standing minute, distance and clinch), with `s = (-0.0980) * zy_td_int + (-0.1325) * length_d + (-0.0786) * zy_td_def + (+0.0346) * kick_y`.
   - `ctrl` (check only, not applied): composition check only (total control per minute): its zy_td_int and length_d parts are carried by td_att, its kick_y part by td_att's kick_y term, and its zx_ctrl*zy_octrl part is a time-ceiling effect (control cannot exceed the clock) that a finite-time position chain reproduces by itself; do not apply, with `s = (+0.0565) * kick_y + (-0.0690) * zx_ctrl*zy_octrl + (-0.0444) * zy_td_int + (-0.0757) * length_d`.
   - `ctrl_per_td` (on): multiply X's top-control duration per takedown (divide the bottom man's escape / stand-up hazard), with `s = (-0.0767) * zy_td_def`.
   - `body_share` (knob, default off): add to the log-odds of X's body-target share, with `s = (+0.1045) * open`.
   - `gnp_att` (knob, default off): multiply X's ground-strike rate per top-control minute, with `s = (+0.1041) * zy_sub_int + (+0.0859) * zy_kd_pow`.
   For a Poisson rate: `rate *= exp(s)`. For a share: `logit(p) += s`. Products such as `zx_ctrl*zy_octrl` are the product of the two z-scores. `open`, `x_sp_vs_orth` are 0/1 from the listed stances (switch counts as neither).
3. **Control.** Control in the engine comes from takedowns (`td_att`, success unchanged) and how long the top man keeps the position (`ctrl_per_td`). The total `ctrl` block is the check: an engine with `td_att` and `ctrl_per_td` on should reproduce its direction (more control against kickers, less in wrestler-vs-wrestler fights, less for the longer man, and a sub-multiplicative ceiling when a heavy controller meets a man who is often controlled). Applying it on top would count those effects twice.
4. **Knob.** Expose one `styleMatchups` knob in [0, 1.5], default 1, that scales every `s`; 0 reproduces the pure skill composition. Optional blocks get their own toggle, default off.
5. **Labels.** Show the scouting archetype where a scouting file exists and the data archetype otherwise (with its membership); the data names describe centroids, and the attempts-ratio 'pressure' axis can label a forward-moving fighter who gets out-thrown (Gaethje) as a counter striker.
6. **Do not** add archetype-pair or interaction terms to the final win probability; none survived held-out validation and the combined set made 2024+ log loss worse. Do not use the scouting tags as numeric inputs in backtests (hindsight); use them for the director's technique choices and the page.
7. **Calibration order.** The modifiers were fit with free main-effect coefficients, so they are close to orthogonal to the engine's own prior strengths and exponents; recheck the default-on blocks with the engine's per-fight stat errors after v4 retunes those (expected change: small).
8. **Validation target for v7.** With the modifiers on, the engine's simulated per-fight stats should reproduce the 2024+ rate-level gains above (distance attempts, leg share, takedown attempts, control), and its 2024+ winner log loss should be no worse than without them; that is the ship criterion, given that the winner-level effect is below what 1223 fights can detect.

## 10. Caveats

- Power: with 1223 held-out fights the paired bootstrap SE of a log-loss change is about 0.001-0.002, so winner-level matchup effects smaller than about 0.003 are invisible. The rate-level tests have far more information per fight, which is why they detect effects the winner tests cannot.
- ufcstats lacks cage position, feints, stance switches within fights, technique labels and per-target attempts by position; pressure, counter-punching and kick types can only be proxied.
- Control time includes clinch control; standing minutes are approximate (min minus both men's control).
- Stance, reach and height are the current tale of the tape, applied to past fights.
- The 2024+ period confirmed the rate terms and was then reused for the transmission and mismatch tables; the 'tune_screened' variant is the only fully clean held-out test of the procedure.
- The skill baseline's main effects are style features too (shares, intents); a model without them would let interactions absorb main effects. The 'on top of Elo alone' table shows what that looks like.

## 11. Reproduce

```
python3 tools/styles.py              # about 5 minutes on 4 cores (prior-strength grid, 2000 bootstrap draws)
python3 tools/styles.py --report-only   # re-render this file from data/derived/styles.json
```

Needs numpy and pandas; reuses `tools/build_db.py` (parse_fights, build_vectors) for the per-fight vectors.
