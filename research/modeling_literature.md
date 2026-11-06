# Modeling literature for fight engine v3

Research for the v3 rebuild: how to simulate and forecast MMA fights, with numbers the engine can use.
Written Friday, Nov 6, 2026.

**How this was checked.**
- Every factual claim has a source next to it and a confidence flag: **[H]** high, **[M]** medium, **[L]** low.
- **[D]** marks a number I computed from the UFC stats snapshot in `data/raw/` (ufcstats.com via
  Greco1899/scrape_ufc_stats, through Oct 31, 2026). The scripts are in `research/analysis/` and take
  a few seconds each. A [D] number is as good as the arithmetic and the caveat printed beside it.
- I read the Holmes, McHale & Żychaluk (2023) paper in full: the PDF is hosted on Elsevier's Mendeley
  Data bucket. The other papers I know only through abstracts, highlights and search summaries.
- Limits of this session: WebFetch could not reach most hosts (ScienceDirect, RePEc, Liverpool's
  repository, arXiv, FightMatrix and github.io pages were all blocked), and the shared web-search budget
  ran out near the end. GitHub raw files were reachable, so the open-source projects were read at the
  source. "Unknown" or "not verified" means exactly that.

---

## 0. Summary: the numbers that matter most

| What | Number | Source |
|---|---|---|
| Best achievable winner accuracy (closing line) | 66.5-68.6% favourite win rate; vig-free close log loss 0.606, Brier 0.210 | fightline-ml (4,636 fights, 2016-2026) [M, self-reported README]; UFCalendar (6,210 fights) [L-M]; my calc 6,916 fights: log loss 0.608, Brier 0.2105, favourite 66.6% [D] |
| Published Markov simulator | 61.8% vs bookmaker 61.2% on 327 fights from 2018 | Holmes et al. 2023 [H] |
| Open-source Markov replication | 61.7%, log loss 0.656 (2024-26, 1,475 fights) | FightLab [M] |
| Stats + age logistic (no market) | 63.8%, log loss 0.634 | FightLab [M] |
| Elo alone | 55-56%, log loss 0.680-0.685 | FightLab (0.680), fightline-ml (0.6849), PIGJET (0.6846) [M]; my K=48 Elo: 55.1%, 0.683 [D] |
| Market bias | mild favourite-longshot bias after proportional de-vig: recalibration slope 1.08 [1.01, 1.16] | my calc [D]; fightline-ml reports 1.02-1.11 [M] |
| KD per 100 landed significant head strikes | 0.83 overall (2015+); men 0.84-1.22 by division (0.94 pooled); women 0.27-0.55 | [D] |
| KD to finish | 58% of rounds with a one-sided KD end in a KO/TKO by the KD scorer in that round; 71% of KO/TKO wins include a KD by the winner in the finishing round. ufcstats logs the finishing knockdown itself as a KD, so the KD rate above is a "KD-or-KO" rate (as in Holmes) | [D] |
| Judges, per round (logit per unit of difference) | head 0.176, body 0.135, leg 0.106, KD 2.11, TD 0.336, control-minute 0.443, sub attempt 0.658, reversal 0.305, missed strike −0.004 | my round-level fit from judges' totals, 11,037 cards [D] |
| Judges agree beyond the box score | all three cards give the same round count in 52% of 3-round decisions, vs 34% if judges were independent given the stats (simulation conditioned on the official winner; 31% unconditioned); shared round-noise sd ≈ 2.2 logits (2.0-2.5) | [D] |
| 10-8 rate per judge-round | 6.8% (2019) to 2.0% (2025) | [D]; UFCalendar 6.39% / 2.09% [M] |
| Age | beyond Elo: −0.062 logits per year of age gap, plus −0.040 per year past 34; win minus Elo expectation is −7 points at 34-38 and −16 at 38+ | [D] |
| Chin and power with age (within-fighter) | KD absorbed per head strike ×1.21 at ages over 33 up to 36 and ×1.35 over 36, vs the same fighters at 33 or younger; KD scored ×0.79 and ×0.67 | [D], regression-to-the-mean caveat |
| Moving up one division | win minus Elo expectation −0.5 points (n=478); no extra KO susceptibility | [D] |
| Time decay | best test log loss at a 2-3 year half-life (flat from 1.5 to 4) | [D] |
| Shrinkage for per-minute rates | best at 10-30 pseudo-minutes of division-average fighting | [D]; FightLab uses 40 minutes and 400 landed strikes for KO rates [M] |

---

## 1. Markov-chain and state-space models

### 1.1 Holmes, McHale & Żychaluk (2023), International Journal of Forecasting 39(2), 623-640

Source: DOI 10.1016/j.ijforecast.2022.01.007; full text read from
https://prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com/05bdcbd7-50e1-4f75-95e5-693192fd2708
(index: https://ideas.repec.org/a/eee/intfor/v39y2023i2p623-640.html). All [H].

**Data.** 4,678 UFC fights from 2001 to 2018 (ESPN and ufcstats.com, scraped in R), 1,680 athletes,
806 of whom had three or fewer fights. Trained on 2001-2017 (4,204 fights, 8,408 fighter
observations) and tested on 2018. Closing odds came from BestFightOdds.

**Simplifications.** Significant strikes only. Distance and clinch strikes are pooled as "standing";
body and leg are pooled as "body". Control time is split into ground and clinch in proportion to
ground techniques (ground strikes, submission attempts, positional advances) versus clinch techniques.

**Skill models.** 13 Bayesian GLMs fitted with `bayesglm` (R package arm): weakly informative Cauchy
priors (scale 10 for the intercept, 2.5 for binary predictors, 2.5/(2·sd) for numeric predictors),
approximate posterior modes by EM. Each
skill has an intercept, an attack effect for fighter i, a defence effect for opponent j, and a
weight-class term (the weight limit in pounds). Exposure enters as an offset:

| Transition | Model | Exposure / trials |
|---|---|---|
| Strike rate | Poisson, log link | total bout seconds |
| Takedown rate | Poisson | stand-time = T − opponent's control − own ground control |
| Submission-attempt rate | Poisson | own ground control time |
| Standing head and body accuracy, ground head and body accuracy, takedown accuracy, submission accuracy | Binomial, logit | attempts |
| Knockdown-or-knockout probability | Binomial, logit | landed head strikes (standing + ground) |
| Target choice (head share), standing and ground | Binomial, logit, **attack term only** | strikes attempted |
| Ground control per takedown | Gamma, log link, attack and defence | per takedown landed |
| Stand-up probability per second | 1 / predicted ground control per takedown | |

- Target choice has no defence term on purpose: the authors treat it as the attacker's own tactic, and
  say a defence term would be biased by opponents who favour one target.
- Fights under one minute were dropped from the work-rate fits.

**Chain.** The time step is one second. Rounds restart standing. States are standing, strike attempt
→ target → land/miss → (head) knockout, takedown attempt → ground control for i or j, and on the
ground strikes, submission attempts (rate × `adj_sm`) → success, and stand-up. Strikes from the bottom
are left out. Two tuned scalars were chosen on 2017 validation: **`adj_ko = 0.4`** (the fraction of
the pooled knockdown-or-KO probability that becomes a KO) and **`adj_sm = 2`** (submission attempts
inflated because real attempts come from a few positions). Each fight was simulated 10,000 times,
drawing transition probabilities from the posteriors so parameter uncertainty carries into the
forecast.

**Judging.** Round-winner logit with no intercept, fitted on mmadecisions.com cards for 2001-2017
(9,377 rounds): significant strikes landed difference **0.172** (se 0.004), takedowns landed
**0.838** (0.028), submission attempts **0.547** (0.052). They simulate three judges per round and
count majorities, so draws can't happen.

**Results (327 test fights, 2018, debutants removed).**
- Accuracy: Markov **61.77%**; Bayesian Bradley-Terry **54.13%**; logistic regression on
  cumulative-stat differences **47.71%**. They blame the logistic's failure on not adjusting for past
  opponents; the attack/defence terms do that.
- Bootstrap over simulations: mean 61.62%, sd 0.53.
- Bookmaker favourite accuracy: 61.16%. Disagreement with the books: 41%.
- Method market: model 38.8% vs bookmaker 32.7%.
- Overround: 4.25% in the result market, 23.38% in the method market.
- Flat stakes on the model's pick returned 10.2% (327 bets; 15.3% with an EV threshold of 0.26).
  The method market returned 26.5% flat (30.3% with a 0.76 threshold). EV staking lost money there.
- Predicted vs actual endings: decision 167 vs 162, KO 103 vs 107, submission 57 vs 57.
- Caveat: one season and a small sample. The ROI figures are noisy.

**Limitations they list.** One ground position; one strike type; no cardio, damage or time effects
("does knockout power fade over the course of a fight"); skills assumed independent; skills not
updated through the test year.

### 1.2 Holmes, McHale & Żychaluk (2024), European Journal of Operational Research 312(2), 733-745

"Detecting individual preferences and erroneous verdicts in mixed martial arts judging using Bayesian
hierarchical models." DOI 10.1016/j.ejor.2023.07.004.
Sources: https://ideas.repec.org/a/eee/ejores/v312y2024i2p733-745.html,
https://www.sciencedirect.com/science/article/pii/S0377221723005428 (abstract and highlights only).

- Individual judges weigh the actions they assess differently. A citing paper's example: some judges
  treat missed significant head strikes as positive, others as negative. [M]
- These preferences can change verdicts. The models can flag likely erroneous decisions and estimate
  who "should" have won. [M]
- Bias: the home-fighter main effect is not significant, but **home × live crowd** is significant and
  positive. Judges also show reputation bias (they favour fighters ranked higher). Fans are less biased
  than judges. [M] (via search summaries of the paper)
- Coefficient tables: unknown (paywalled; not read).
- Fact-check: FightLab's README links a Liverpool-repository copy of this paper
  (https://livrepository.liverpool.ac.uk/id/eprint/3171986), which supports its existence. The
  bullets above come from search summaries and were not re-verified (RePEc, ScienceDirect and the
  Liverpool repository were unreachable, and the search budget was exhausted).

Holmes's Liverpool PhD thesis, "Quantitative Essays on Mixed Martial Arts: A Markov Chain Based
Forecasting Model and Analyses of the Judges" (May 2022), holds both papers
(https://livrepository.liverpool.ac.uk/id/eprint/3166169) [M]. Not read: the host was blocked.

### 1.3 Other state-space work

- **FightLab** (github.com/martineza96/FightLab, README and `src/ufc/markov.py` read) [M]:
  - A simplified Holmes chain on the same ufcstats data. 5-second steps; four positions (distance,
    clinch, A top, B top); Poisson landed strikes per position; per-strike knockdown and KO
    probabilities; ground submission attempts and conversion; takedowns, clinch entry and exit,
    stand-ups and reversals.
  - Rates combine as `league × (A offence / league) × (B allowed / league)`. They are
    recency-weighted (2-year half-life) and shrunk with pseudo-exposure: `k_min = 40` minutes,
    `k_ko = 400` landed strikes, `k_sub = 4` attempts. (40 and 400 are the settings in the README
    and PROJECT_BREAKDOWN, chosen on 2021-23 validation; the `Params` defaults in `markov.py` are
    15 and 150.)
  - Four league multipliers (stand-up, clinch, KO, sub) are fixed-point calibrated to league ground
    share, clinch share, KO rate and submission rate.
  - Test 2024-26 (1,475 fights): **61.7%, log loss 0.656, AUC 0.659**. A logistic on the same rates
    scored 60.0% and 0.665, so simulating beat regressing on the same inputs. A calibrated logistic
    with age, record and strength of schedule beat both (63.8%, 0.634). Adding the Markov log-odds to
    it reached 65.8% and 0.629 on test, but it was not adopted because validation disagreed.
- **Lamas et al. (2024)**, "No-gi Brazilian jiu-jitsu: a Markovian analysis of elite-level combat
  dynamics", International Journal of Sports Science & Coaching
  (https://journals.sagepub.com/doi/10.1177/17479541231210979) [M]. A positional Markov model of
  grappling, useful if v3 adds ground sub-positions. Its transition numbers were not read.
- **FightTracker** (Berthet, arXiv 2312.11067, Dec 2023) [L]. A real-time in-fight win-probability
  tool built on regressions of UFC and MMA Decisions data. Secondary summaries claim about 80%
  accuracy and a 90% ROI over a short live window. Not verified; the PDF was blocked.

### 1.4 How transition rates get estimated (the common recipe)

1. **Exposure accounting.** ufcstats records no time-in-position. Estimate distance time as T minus
   total control; split control into ground and clinch by the share of techniques (strikes,
   takedowns, submission attempts) recorded in each. That is the Holmes and FightLab approach. League
   control share (both fighters, 2019+) is **37.6%** of fight time [D], and it includes clinch control.
2. **Counts on exposure.** Rates are Poisson with log(exposure) as an offset. Probabilities are
   binomial with a logit link. Durations are gamma or exponential (control per takedown landed: league
   **121 s**, 2019+, by division from 98 s at bantamweight to 187 s at women's featherweight [D]).
3. **Attack and defence effects** on the log or logit scale, plus a division term or division
   baselines.
4. **Shrinkage** from priors (Holmes: Cauchy priors on coefficients; FightLab: pseudo-counts).
5. **Global scalars** tuned on validation for what the box score can't identify (KO conversion,
   submission inflation, stand-up and clinch hazards), against league base rates and out-of-sample
   log loss.

---

## 2. Strike modeling: attempts, accuracy, defence, position and target

**Multiplicative attack × defence.** For rates, Poisson log-linear (Holmes; football's Maher/Dixon-Coles
attack/defence idea, which the Holmes paper cites). For probabilities, logit-additive attack and
defence. This is the same "odds-ratio / log5" rule that FightLab and v2 use:
`odds(p_XY) = odds(p_X) · odds(q_Y) / odds(p_league)`. Log5 is usually credited to Bill James.
Background knowledge, not re-verified this session [M].

**Why it beats averaging.** Holmes's logistic on raw cumulative stats scored 47.7% against 61.8% for
the attack/defence Markov model; the authors put the gap down to opponent adjustment [H]. v2 averaged
a fighter's landed/min with the opponent's absorbed/min and then needed a 0.85 fudge. The log-linear
form removes that double counting.

**Separate attempts from accuracy.** Holmes and the v3 spec both do this. The engine needs misses as
events for the director, and judges barely care about misses: −0.004 per missed significant strike
per round, about 2.5% of a landed head strike [D]. Holmes EJOR says judges disagree on whether misses
count at all [M].

**League priors, 2019-2026 rounds** [D] (`research/analysis/league_priors.py`):

| | All | Lightweight | Featherweight |
|---|---|---|---|
| Sig. attempts / fighter-min | 8.48 | 8.84 | 8.81 |
| Sig. landed / fighter-min | 3.99 | 4.19 | 4.09 |
| Accuracy: head / body / leg | 0.384 / 0.702 / 0.817 | 0.390 / 0.697 / 0.829 | 0.381 / 0.694 / 0.796 |
| Accuracy: distance / clinch / ground | 0.432 / 0.737 / 0.721 | 0.436 / 0.736 / 0.715 | 0.430 / 0.740 / 0.713 |
| Attempt mix head / body / leg | 0.764 / 0.142 / 0.093 | 0.764 / 0.149 / 0.087 | 0.764 / 0.142 / 0.094 |
| Attempt mix distance / clinch / ground | 0.872 / 0.065 / 0.063 | 0.869 / 0.061 / 0.070 | 0.882 / 0.058 / 0.060 |
| TD attempts / 15 fighter-min; TD accuracy | 3.85; 0.362 | 4.14; 0.360 | 3.95; 0.377 |
| Sub attempts / 15; reversals / 15 | 0.387; 0.176 | 0.406; 0.148 | 0.494; 0.254 |

**Position and target.**
- Head accuracy is about half of leg accuracy, and clinch and ground accuracy are much higher than
  distance accuracy. So accuracy must be modelled per target (and per position), not as one career
  figure.
- Holmes models the head share as the attacker's choice with no defence term [H]. Use that for the
  target mix. Per-position mixes differ (more body in the clinch, more head on the ground).
- In-fight accuracy is stable by round: 0.437 → 0.446 in 3-round decisions; 0.44 → 0.46 in
  5-rounders [D]. Fatigue doesn't show up as a falling league accuracy.

**Opponent-adjusted estimation.**
- Fit `log E[y_XY] = log e_XY + μ_div + a_X + b_Y` (and its logit analogue) with Gaussian priors on
  a and b. That is a ridge GLM, which is empirical Bayes. Holmes fits it with bayesglm.
- A cheap version in the build step: alternate (backfit) a few passes of
  `a_X = log((Σy + k·μ) / (Σ e·exp(μ + b_opp) + k·μ))` and the same for b, with time-decay weights.

---

## 3. Knockout modeling

### 3.1 Literature

- **Holmes 2023.** Knockdowns and knockouts are pooled as successes over landed head strikes
  (attack = power, defence = chin, plus weight). Then `adj_ko = 0.4` turns that into a KO per landed
  head strike. Body strikes can't knock out [H].
- **FightLab.** Separate per-landed-strike knockdown and KO probabilities, each shrunk with 400
  pseudo-strikes; a league KO multiplier is calibrated to the observed KO rate [M].
- **Hutchison et al. (2014)**, American Journal of Sports Medicine 42(6): 844 fights (matches) at
  numbered UFC events, 2006-2012 (https://journals.sagepub.com/doi/10.1177/0363546514526151) [M;
  details below not re-verified in the fact-check, host blocked]:
  - KOs were about 13% of matches (108) and TKOs about 21% (179).
  - Every KO came from a direct head impact; the mandible was the most common site (53.9%).
  - Video work covered the 30 seconds before stoppages.
- **Repeat knockouts.** "Predictors of two consecutive knockout losses in UFC athletes", The
  Physician and Sportsmedicine 54(3), 2026 (https://pubmed.ncbi.nlm.nih.gov/41674479/) [M]:
  - 705 UFC athletes knocked out between 2015 and 2023: 22.7% had two consecutive KO/TKO losses.
  - Prior KO history was the only independent predictor (OR 1.13, 95% CI 1.020-1.246).
  - A Japanese study of 104 fighters found that fighters concussed in their latest bout had more
    previous KO losses (mean 2.9)
    (https://www.researchgate.net/publication/362236679_Incidence_of_concussions_in_male_mixed_martial_arts_competition_in_relation_to_number_of_matches_and_previous_knockout_losses) [M].
- **Age and knockouts.**
  - Bloody Elbow (2013, 48 fighters): a sharp rise in KO likelihood after 34
    (https://bloodyelbow.com/2013/07/18/ufc-going-deeper-into-mma-fighter-longevity-does-age-matter/) [L].
  - UFCalendar (16,429 fights): fighters 34+ who had absorbed under 300 career head strikes were
    knocked out in 23.5% of fights; it calls age the only smooth monotonic decliner
    (https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed) [L, blog].
- **Per-strike survival curves** by division (Medium):
  https://medium.com/@sezenhs22/how-many-punches-does-it-take-to-knock-someone-out-in-the-ufc-1d52a80a8caa [L].

### 3.2 From the data (2015-2026 unless noted) [D]

**KD per 100 landed significant head strikes, by division** (`research/analysis/base_rates.py`):

| FLW | BW | FW | LW | WW | MW | LHW | HW | W-SW | W-FLW | W-BW | W-FW | All |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0.87 | 0.89 | 0.88 | **0.84** | 1.02 | 0.98 | 1.22 | 0.94 | 0.28 | 0.27 | 0.35 | 0.55 | 0.83 |

(The 2019+ figures are almost the same: LW 0.89, FW 0.88; see `league_priors.py`.) v2's prior of 0.009
per head strike matches lightweight.

**KD → finish.**
- Of 2,306 rounds where only one fighter scored a knockdown, **58.1%** ended in a KO/TKO by that
  fighter in the same round.
- The KD scorer won **85.9%** of those fights.
- **70.9%** of KO/TKO finishes (n=1,907) had at least one KD by the winner in the finishing round. The
  other 29% are standing TKOs or stoppages without a recorded knockdown, so the engine needs a
  "hurt + accumulated damage" stoppage path as well as the knockdown path.
- **What ufcstats counts as a KD.** The knockdown that ends a fight is itself logged as a KD. In 13
  of 15 one-shot finishes since 2015 (≤20 s into the round, ≤3 significant strikes landed by the
  winner) the winner has KD = 1; the two without are injury stoppages. Holloway's KO of Gaethje (UFC
  300, R5) and Topuria's KO of Volkanovski (UFC 298, R2) both show KD = 1 [D]. So the KD rates in this
  section are "KD-or-KO" rates, as Holmes pooled them. The engine should draw one KD event per landed
  head strike at this rate and decide the finish afterwards. A separate per-strike KO path added on
  top would double count.

**Does damage build up within a fight?** Per-strike KD rates by round, for the same pairs:

| Sample | R1 | R2 | R3 | R4 | R5 |
|---|---|---|---|---|---|
| 3-round fights that reached R3 (n=4,026) | 0.57 | 0.31 | 0.42 | | |
| 5-round fights that reached R5 (n=321) | 0.44 | 0.41 | 0.32 | 0.21 | 0.31 |

- Per landed head strike, knockdowns get rarer late in fights, not more common. Head strikes landed
  per round rise (17.0 → 26.9 in that 5-round sample).
- Within each sample, every round except the last is a round that did not end the fight, while the
  last round also includes finishing knockdowns. That inflates the last round (3-round sample: R3
  0.42 > R2 0.31; R5 0.31 > R4 0.21). The clean comparison is between the earlier rounds (R1-R4 in
  the R5 sample: 0.44, 0.41, 0.32, 0.21), and it still declines. Cross-fight selection (pairs with
  durable chins reach R5) can't produce that, because it is the same fights in every round.
- The counts are small: about 24, 30, 24, 17 and 27 knockdowns in R1-R5 of the R5 sample, so each
  round's rate carries about ±20% Poisson error. Treat the decline as suggestive.
- So attacker fatigue, and later volume being lower-power work, outweigh accumulated defender damage
  at league level.
- Engine implication: if v3 adds a damage term that raises the defender's KD risk, it also needs an
  attacker-stamina term on power. Calibrate the pair to this round profile.

**Finish hazard per round started** (KO, SUB):
- 3-round fights (n=5,245): R1 16.8%, 8.6%; R2 13.1%, 8.2%; R3 8.3%, 5.6%. 50.6% go to decision.
- 5-round fights (n=571): R1 16.3%, 4.6%; R2 15.3%, 5.1%; R3 11.1%, 6.1%; R4 7.4%, 3.4%;
  R5 8.3%, 2.6%. 41.5% go to decision.

**Method shares 2015+.** Lightweight: decision 47.3%, KO 34.4%, submission 18.3% (n=852).
Featherweight: 52.4%, 31.8%, 15.9% (n=680). Heavyweight: 38.9%, 48.1%, 13.0%. Women's strawweight:
65.9%, 14.4%, 19.6%.

### 3.3 Chin and power: age and prior knockouts [D] (`research/analysis/age_weight.py`)

KD absorbed per landed head strike absorbed, relative to the division rate ("chin index", higher is
worse), and the same for KDs scored ("power index"). Pooled, 2010+:

| Age | ≤27 | 27-30 | 30-33 | 33-35 | 35-37 | 37-39 | 39+ |
|---|---|---|---|---|---|---|---|
| Chin index (KD absorbed obs/exp) | 0.87 | 0.92 | 1.02 | 1.09 | 1.13 | 1.14 | 1.14 |
| Power index (KD scored obs/exp) | 1.12 | 1.06 | 0.99 | 0.93 | 0.91 | 0.82 | 0.68 |
| KO/TKO loss rate per fight | 11.3% | 13.5% | 16.6% | 18.4% | 21.1% | 24.6% | 24.6% |

**Within-fighter** (the same fighters at age 33.0 or younger vs later, at least 3 fights at that age;
ages are exact, so the script's bins are (0, 33], (33, 36] and over 36):
- Over 33 up to 36 (471 fighters): chin ×**1.21**, power ×**0.79**.
- Over 36 (198 fighters): chin ×**1.35**, power ×**0.67**.
- Caveat: fighters who last past 36 had good early chin luck (0.75 at 33 or younger), so some of this
  is regression to the mean. Treat ×1.2-1.35 as an upper-middle estimate.
- The pooled ratio between ages 27-30 and 35-37 is also about ×1.23.

**Prior UFC KO/TKO losses:**

| Prior KO losses | 0 | 1 | 2 | 3+ |
|---|---|---|---|---|
| Chin index | 0.93 | 1.09 | 1.12 | 1.15 |
| KO loss rate | 13.3% | 17.6% | 22.7% | 25.9% |

This is mostly evidence about the chin, not proof that damage causes the next KO. If the engine
already shrinks a chin estimate from knockdowns absorbed, a separate KO-loss multiplier double counts.
Cap any extra term at about ×1.1-1.15.

---

## 4. Fatigue and pace

- Holmes didn't model cardio, damage or time and listed them as future work [H].
- Time-motion studies:
  - Del Vecchio et al. (2011): activity falls within rounds and across the bout. [M], via
    https://researchonline.ljmu.ac.uk/id/eprint/13541/1/MMA%20Performance%20Research%20in%20ARMSS%20FINAL%20DRAFT.pdf
  - Antonietti et al. (2019), 678 bouts: more standing "preparatory" time as fights go on, read as
    pacing or fatigue. [M], same review.
  - Kirk's thesis on MMA workload uses a sparring sample of six
    (https://knowledge.lancashire.ac.uk/id/eprint/11319/2/Kirk%20Final%20e-Thesis%20%28Master%20Copy%29.pdf) [M].
- Box-score studies find output rising by round:
  - AgentMMA: +18.8% attempts from R1 to R3 in 232 full three-rounders
    (https://agentmma.com/mma-lab/ufc-fight-pace-by-round) [L].
  - The Fight Algorithm: +19% in R3 over 40,210 rounds
    (https://thefightalgorithm.com/articles/fatigue-factor) [L].
- **From the data** [D], landed significant strikes per minute, both fighters, fights that went to
  decision, 2015+:
  - 3 rounds: R1 6.74, R2 7.53 (+12%), R3 7.83 (+16%).
  - 5 rounds (n=237): 6.43, 7.83, 7.98, 8.32, 8.44 (+31% by R5).
  - Takedown attempts and control rise later too: control in 5-round decisions goes 80 s → 105 s per
    round.
  - Accuracy is flat or slightly up.
- **Interpretation.** League output doesn't fade. Round 1 is a feeling-out round, and survivors are
  selected. Fatigue is fighter-specific and relative: who slows compared with their own round 1, and
  compared with the opponent.
- **For the engine:**
  1. A division pace curve as the baseline: round multipliers relative to R1, about
     [1, 1.12, 1.16] for 3 rounds and [1, 1.22, 1.24, 1.29, 1.31] for 5.
  2. Each fighter's late-round ratio relative to that curve, shrunk toward 1 with weights from their
     round-level exposure (v3 spec `pace`, `pace_w`).
  3. Stamina mainly cuts power (see 3.2) and defence, and only secondarily volume.
  4. Body strikes drain stamina: plausible but unmeasured, so keep it a knob with a small default.

---

## 5. Age curves

**Literature.**

| Finding | Source | Conf. |
|---|---|---|
| Win rate ≤24: 57.6% vs 37+: 37.8%. Younger fighter wins 59.3% at a 2+ year gap and 67.1% at an 8+ year gap (8,332 bouts) | https://agentmma.com/mma-lab/ufc-fighter-peak-age | L (blog) |
| Median peak age of 485 retired fighters: 30.6; age is the only monotonic decliner (16,429 fights) | https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed | L (blog) |
| Result minus Elo expectation turns negative at about 31, is clearly negative from 34 and about twice as bad from 38. A 35-year-old's rating runs about 5 points per fight too high, a 40-year-old's about 12. A fighter 8+ years older wins about a third of the time | FightLab `docs/PROJECT_BREAKDOWN.md` (raw.githubusercontent.com/martineza96/FightLab) | M |
| Bookmakers don't fully price youth (or travel) advantages, but out-of-sample returns are rarely significant | Miller & Nichols (2026), Journal of Economics and Finance 50(1), https://link.springer.com/article/10.1007/s12197-026-09757-x | M (abstract) |
| Lighter-division fighters end their elite windows 4-5 years before heavyweights | https://www.fightmatrix.com/2026/10/22/the-age-curve-in-combat-sports-statistical-breakdown-of-apex-performance-windows-across-ufc-divisions/ | L (no visible method) |
| ~~Men below welterweight aged 35+ are winless in UFC title fights~~ Out of date: it could only have held before UFC 314 (Apr 12, 2025). Since then, men aged 35+ have won six title fights below welterweight: Volkanovski at UFC 314 (36), UFC 325 (37) and UFC 333 (38); Pantoja at UFC 317 (35); Gaethje at UFC 324 (interim, 37) and UFC Freedom 250 (37) | https://www.si.com/fannation/mma/news/alex-volkanovski-curse-ufc-314 (original claim); refuted from data/raw title bouts and DOBs [D] | H (refutation) |
| Peak ages by weight class from a rigorous study | not found | unknown |

**From the data** (2010+, both fighters with DOB, `age_weight.py`) [D]:
- **Win rate by age gap** (fighter minus opponent, years); the Elo expectation is about 0.50 in every
  bin:

  | Gap | ≤−8 | −8 to −5 | −5 to −3 | −3 to −1 | ±1 | 1 to 3 | 3 to 5 | 5 to 8 | ≥8 |
  |---|---|---|---|---|---|---|---|---|---|
  | Win rate | 0.674 | 0.603 | 0.563 | 0.541 | 0.500 | 0.459 | 0.437 | 0.397 | 0.326 |

  Matchmakers don't seem to offset age in Elo terms, and Elo doesn't see it.
- **Result minus Elo expectation by age** (≥2 prior fights):

  | Age | ≤24 | 24-27 | 27-30 | 30-32 | 32-34 | 34-36 | 36-38 | 38+ |
  |---|---|---|---|---|---|---|---|---|
  | Residual | +0.149 | +0.063 | +0.051 | +0.007 | −0.010 | −0.070 | −0.064 | −0.161 |

- **Logit** (6,576 fights), win ~ Elo + age gap + years past 34: Elo term 1.12 (se 0.09); **−0.062**
  per year of age gap (se 0.007); **−0.040** per extra year past 34 (se 0.018).
- **Time-decayed stats** (h = 2 y, k = 60): on the same 2,227 test fights (both DOBs known), adding
  the age difference to a rate-difference logistic cuts test log loss from 0.6656 to 0.6523 (paired
  difference −0.0133, se 0.0031). Accuracy rises from 60.3% to 61.4%. (`halflife.py` prints 0.6648
  for the no-age model, but on 2,271 fights. The like-for-like figure is from a fact-check rerun.)
- **For Volkanovski vs Gaethje:** ufcstats gives DOBs of Sep 29, 1988 (Volkanovski) and Nov 14, 1988
  (Gaethje). That is about six weeks apart, so the age-gap term is near zero. But both are past 37,
  so the chin and power aging terms in 3.3 apply to both of them, which raises the KO-loss rate for
  each.

---

## 6. Weight-class movement

- Bloody Elbow (2015): 107 permanent UFC weight changes. The 17 who moved up won 52.38% vs 52.16% for
  movers down, and most did worse in their new division
  (https://bloodyelbow.com/2015/08/05/ufc-fighters-little-success-changing-weight-classes-mma/) [L].
- A social post claims a 43.5% win rate for one-division moves up in 2020-2026 (354 fights) and 32%
  from LW to WW (https://www.threads.com/@rumbleofficialmma/post/DaM5QrfmVOc/) [L, unverified].
  Wagerwire claims 65% [L]. A Sport Journal study of 174 top athletes ties heavier divisions to more
  KO wins, not to the effect of moving
  (https://thesportjournal.org/article/an-analysis-of-weight-and-fighting-styles-as-predictors-of-winning-outcomes-of-elite-mixed-martial-arts-athletes/) [M].
- Champions challenging in a second division won 11 of 27 title bids (secondary summary in the search
  results) [L].
- **From the data** (men; home division = modal division of the last 3 prior UFC fights, at least 2
  prior; 2010+) [D]:

  | Move | n | Win | Elo exp | Win − exp | KO-loss rate | Chin index (vs new division) |
  |---|---|---|---|---|---|---|
  | Down | 387 | 0.450 | 0.492 | −0.042 | 18.9% | 1.375 |
  | Same | 8,776 | 0.504 | 0.505 | −0.001 | 17.8% | 1.015 |
  | Up one | 478 | 0.506 | 0.511 | −0.005 | 15.5% | 0.850 |

  - Sampling error: the binomial se of a win rate is about 2.3 points for n=478 and 2.5 for n=387.
    So "up one" is −0.5 points (95% CI about −5 to +4), and "down" is −4.2 (about −9 to +1), which
    is not significant at 5%.
  - The chin index is relative to the division fought in. In absolute terms (KD per head strike
    absorbed) a mover's risk still rises when the new division's base rate is higher, e.g. LW 0.84 →
    WW 1.02 per 100. From FW (0.88) to LW (0.84) the base rate doesn't rise.
  - Within movers up, home vs up: chin index 0.864 vs 0.850; KO-loss rate 14.4% vs 15.5%.
  - Movers up aged 34+: win − Elo expectation −0.089 (n=155), about the same as the age effect alone
    (−0.07 at 34-38).
  - Division KD rates barely move from 125 to 155 lb (0.84-0.89 per 100 head strikes) and rise only
    at 170+.
- **Implication.**
  - There's no evidence for a large size tax on chin for a featherweight moving to lightweight.
  - v2's "155-lb tax" scenario (Volk chin ×1.35, power ×0.75) is better explained by age, so keep it
    as a labelled scenario, not a default.
  - Use the fight division's baselines and priors. Keep v3's `c_size` small, and fit it on movers
    (`age_weight.py` has the scaffolding).
  - Moving down looks worse, plausibly because of weight cutting or selection (fighters who move down
    are often losing).

---

## 7. Rating systems

| System | Reported performance | Source | Conf. |
|---|---|---|---|
| Elo, K=64, finishes ×1.25 | 56.0% alone, log loss 0.680 (2024-26); adds nothing on top of stats | FightLab | M |
| Elo | log loss 0.6849, Brier 0.246, 55.4% (2016-26, 4,636 fights) | fightline-ml (raw.githubusercontent.com/AnthonyOlakangil/fightline-ml) | M |
| Vanilla Elo / Glicko-2 per division + matchup features | 55.8%, 0.6846 / corner-aware model 60.3%, 0.6588; order-invariant website predictor 60.1%, 0.6637 (6,616 fights 2013+, walk-forward) | PIGJET/ufc-elo README | M |
| Glicko-2 + XGBoost | 61.5% raw vs 57.9% red-corner baseline (1,175 test fights after Oct 2018); Platt scaling improves log loss 0.678 → 0.662 but drops accuracy to 59.3% | XEchosen/ufc-fight-prediction README | M |
| Bayesian Bradley-Terry | 54.1% (2018) | Holmes 2023 | H |
| My Elo K=48 | 55.1%, log loss 0.683, Brier 0.245 (2015+, ≥3 prior fights, n=4,261) | [D] | H |
| UFCalendar Elo; Power Index | 60.1%, Brier 0.270 (17,582 MMA fights); 63%, Brier 0.232 (26,259) | https://www.ufcalendar.com/elo/accuracy, /power-index/accuracy | L (self-reported, all promotions, snapshots differ) |
| FightMatrix Glicko tuning | rating deviation "fairly inconsequential" for MMA, volatility "useless"; best K 150-200 in their Elo; split decision best scored as 0.55 | https://www.fightmatrix.com/2019/09/18/tuning-glicko-what-i-learned-confirmed/ | M |
| FightMatrix "nothing better than the high 60s" (claim in HANDOFF.md) | not verified | | unknown |
| Tennis analogue: Elo came closest to bookmaker prices among published models | Kovalchik (2016), JQAS 12(3) | M (secondhand) |

**Takeaways.**
- In the UFC, ratings alone reach 55-60%. Stats-based models reach 60-64%. The closing line gets
  66-69% (section 8), and nothing public beats it.
- About 70% looks like the practical ceiling. Claims above that (e.g. WarrierRajeev's 72.2%
  "Accuracy (valid)" in its README) look like the leakage FightLab measured: 82-88% with leaky
  features vs 64% honestly [M]. The repo was not audited here. (An earlier draft also cited an
  igordobronx repo at "~85%". Its README couldn't be found in the fact-check, so that figure was
  removed.)
- Use Elo as a baseline and a sanity prior, not as the engine.

---

## 8. Betting market efficiency and calibration

- **fightline-ml** [M]. Walk-forward over 421 events and 4,636 fights (2016-01 to 2026-10). The
  vig-free closing line scored log loss **0.6063**, Brier **0.2096**, AUC 0.732, accuracy **66.7%**,
  ECE 0.024. LightGBM on point-in-time features: 0.6796; Elo: 0.6849.
  - The market-plus-model stack gained only 0.0009 nats. That gain came from the closing line
    recalibrating itself: model weight 0.04-0.08 vs market 1.00-1.10.
  - Proportional de-vig leaves a favourite-longshot bias that a recalibration slope of 1.02-1.11
    undoes.
  - The close beats the open by 0.012 nats (measured on 1,975 development-window fights, 2010-2015).
  - The closing favourite won 66.5% of 6,790 priced decisive fights.
- **My calculation** [D] (`market.py`, on ufc-master.csv from github.com/shortlikeafox/ultimate_ufc_dataset,
  Apache-2.0; closing odds 2010-03-21 to 2026-03-28; 6,916 decisive fights):
  - Mean overround 3.5%. Log loss 0.608, Brier 0.2105, favourite win rate 66.6%.
  - By favourite implied probability: 50-55% → won 50.9%; 60-65% → 62.2%; 70-75% → 74.1%;
    75-80% → **83.1%** (implied 77.5%); 80-85% → 86.4% (82.3%); 85-90% → 90.3% (87.1%).
  - Recalibration slope **1.084** (95% CI 1.011-1.157); 1.115 when fitted symmetrically.
  - Heavy favourites are a little underpriced after proportional de-vig. Use power or Shin de-vig, or
    a fitted slope, before comparing the engine with the market.
  - Year by year, close log loss ranges from 0.52 (2026, partial) to 0.64. Accuracy has been
    67-75% since 2022.
- **Miller & Nichols (2026)**, J. Economics and Finance 50(1), 4,244 observations from tapology.com:
  no favourite-longshot bias; youth and travel edges underpriced; few significant out-of-sample
  returns; "largely an efficient market" [M].
- **Robbins**, "Weak Form Efficiency in Sports Betting Markets" (ECU working paper): a statistically
  significant longshot bias in UFC returns
  (https://myweb.ecu.edu/robbinst/PDFs/Weak%20Form%20Efficiency%20in%20Sports%20Betting%20Markets.pdf) [M].
  The HANDOFF claim "Robbins, 6,190 UFC fights 2007-2022, calibration slope CI 0.983-1.08" was **not
  verified**, and my slope CI excludes 1.
- **Stanhope (2021)**, 961 UFC fights 2019-2020: implied probabilities mostly well calibrated, but
  "favourite by decision" happens more often than priced
  (https://statds.org/events/ucsas2021/posters/ucsas2021_15_Stephen_Stanhope.pdf) [M].
- **Favourite win rates.**
  - AgentMMA: Pinnacle closes, 558 bouts, favourites won 66.31%. Buckets: 60-70% → 64.5%,
    70-80% → 72.9%, 80%+ → 84.6%. Betting every favourite returned −4.68% per unit over 2,122 bouts;
    every underdog −9.99% (https://agentmma.com/mma-lab/ufc-favorites-win-rate) [L-M].
  - UFCalendar, 6,210 fights since 2012: closing favourite 68.6%, opening favourite 66.2%. Fighters
    the line moved toward by more than 10 points won 73.2%
    (https://www.ufcalendar.com/blog/ufc-odds-line-movement-14-year-study) [L-M].
- **Method markets.**
  - Holmes found 23% overround but beat the books there (section 1.1) [H].
  - The odds file above has `r_ko_odds`, `r_sub_odds` and `r_dec_odds`, so v3 can check its method
    probabilities against the market. Not analysed here.
- **Takeaway for the engine.**
  - Score the engine against the de-vigged close on the same fights; it will lose.
  - Blend in log-odds with weights fitted walk-forward. Expect the market weight to dominate.
  - The engine's value is the how (method, round, scenarios) and fights with no line, not beating the
    winner market.

---

## 9. Judging research

**Rules.**
- ABC MMA scoring clarification (July 2025): rounds scored individually for the more effective
  fighter. Damage is the primary criterion, then dominance and duration. Takedowns and positions count
  for what they produce. A 10-8 needs significant damage; control alone isn't enough, and neither is
  an automatic knockdown
  (https://www.abcboxing.com/wp-content/uploads/2025/08/ABC-MMA-Scoring-Criteira-Clarification-7.2025.pdf;
  summaries at https://agentmma.com/mma-lab/ufc-round-judging-criteria) [M]. Commissions adopt it one
  by one.
- The 2017 Unified Rules revision introduced 10-8 guidance built on impact, dominance and duration.
  Background knowledge, not re-verified this session [M].

**Empirical studies.**
- **Holmes 2023 round logit:** ΔSigStr 0.172, ΔTD 0.838, ΔSubAtt 0.547 [H].
- **Holmes EJOR 2024:** judge-level preferences; home bias appears with a live crowd; reputation bias
  [M].
- **Gift (2018)**, Journal of Sports Economics 19(8): live round-by-round judging in Nevada and
  California, 2001-2012. No titleholder bias and none against fighters given point deductions. Bias
  toward larger betting favourites, fighters with insurmountable leads, and the **previous-round
  winner** (https://journals.sagepub.com/doi/abs/10.1177/1527002517702422) [M]. Fact-check: the
  paper's existence, title, journal (vol. 19) and DOI are confirmed by Holmes et al. (2023)'s
  reference list. Holmes et al. also say Gift's round models use titleholder status, betting odds and
  previous-round winner as non-performance variables. The direction of each finding, the sample and
  the issue/pages were not re-verified (host blocked).
- **Feldman (2020)**, Journal of Applied Sport Management 12(2): takedowns landed, knockdowns, sig.
  strikes landed, damage and control raise round-win odds. Secondary summaries say submission attempts
  were not significant (https://trace.tennessee.edu/jasm/vol12/iss2/5) [M].
- **O'Connell (2024 Syracuse senior thesis):** head strikes most valued; knockdowns very impactful; a
  takedown or reversal is worth about 50 s of control; a submission attempt more than twice a takedown
  (https://oconnellryan.github.io/ufc-judging-analysis.html) [L-M, student work].
- **FightLab fight-level judge model** (2,600 decisions): 85.3% agreement with the official result;
  KD ≈ 8.2 strikes, a minute on top ≈ 4.3 strikes, a takedown ≈ 2.3 strikes. Home fighters abroad get
  about +4.6 points more scorecards than their stats earn [M].
- **Berthet (2024)**, arXiv 2401.03280, 4,129 decisions 2003-2023: consensus scoring (judges first,
  then rounds) agrees with standard scoring in 97.53% of bouts. Where they differ, it matches fan
  opinion more often (48.96% vs 43.75%). Single-judge 10-8s drive the differences [M].
- **10-8 frequency:**
  - UFCalendar, 34,509 judged rounds: 6.39% of scored rounds in 2019, 2.09% in 2025. In 51.9% of
    rounds with any 10-8, exactly one judge gave it
    (https://www.ufcalendar.com/blog/the-vanishing-10-8-round) [M].
  - Bloody Elbow: 3.4% in 2001-2012, 7.3% in 2017; 48.9% single-judge
    (https://bloodyelbow.com/2018/02/01/be-analytics-crunching-numbers-2017-10-8-judging-scoring-criteria-ufc-mma-editorial) [M].
- **Round 1 winner:** wins about 68% of fights that reach round 2, and 72% of full-distance decisions
  (https://agentmma.com/mma-lab/ufc-round-one-winner-predict-fight) [L].

**My round-level fit** [D] (`research/analysis/judging.py`).
- **Method.** Each judge's totals (ufcstats lists them loser-first) imply how many rounds that judge
  gave the winner, or a feasible set when 10-8s make it ambiguous. Assume no 10-10s and drop the few
  cards that need one.
- The round-win probability is `logit p_r = β · (winner − loser stats in round r)` with no
  intercept. The card likelihood is P(round count in the feasible set), found by enumerating all 2^R
  round patterns.
- Fitted on 11,037 cards from 2010-2026, with round stats from the snapshot.

| Δ per round | β (se) | in head-strike units | 2010-16 | 2017-24 | 2025-26 |
|---|---|---|---|---|---|
| Head sig. landed | 0.176 (0.003) | 1.00 | 1.00 | 1.00 | 1.00 |
| Body sig. landed | 0.135 (0.004) | 0.77 | 0.91 | 0.71 | 0.79 |
| Leg sig. landed | 0.106 (0.004) | 0.60 | 0.75 | 0.56 | 0.51 |
| Knockdown | 2.106 (0.109) | **12.0** | 10.2 | 13.1 | **15.3** |
| Takedown landed | 0.336 (0.023) | 1.9 | 2.7 | 1.6 | 1.5 |
| Control minute | 0.443 (0.015) | 2.5 | 2.5 | 2.5 | 2.5 |
| Submission attempt | 0.658 (0.042) | 3.7 | 3.5 | 4.5 | 3.2 |
| Reversal | 0.305 (0.070) | 1.7 | 1.7 | 1.8 | 1.9 |
| Missed sig. strike | −0.004 (0.001) | −0.03 | +0.03 | −0.04 | −0.08 |

- **By position** (same fit, 2010-26): distance landed 1.00, clinch 1.14, ground **1.84**, KD 14.4,
  takedown 2.5, control minute 2.9 (distance-strike units).
- **Drift.** Knockdowns gain weight and takedowns lose it across eras, as the 2017 and 2025 guidance
  on damage would predict.
- **10-8 per judge-round**, from the totals: 1.9-3.9% in 2010-16, 6.6% (2017), 6.8% (2019), then
  2.5% (2024), 2.0% (2025), 3.2% (2026 to date). This is close to UFCalendar's reported 6.39% (2019)
  and 2.09% (2025); the UFCalendar page wasn't re-checked in the fact-check.
  - Caveat: inferring 10-8s from totals counts any point deduction as a 10-8 (or misreads it), and
    ufcstats DETAILS mention deductions in only 6 decisions since 2015. So these rates are slight
    upper bounds.
- **Split share of decisions:** 15-26% in 2010-2024, 13.7% in 2025, 13.4% in 2026. Majority
  decisions 0.7-4%.
- **Shared noise** (`judge_noise.py`):
  - In 3,341 three-round decisions with three unambiguous cards, all three judges gave the same round
    count **52.2%** of the time.
  - Independent judges, given the box score, would agree 30.5% of the time (`judge_noise.py`).
    That simulation doesn't condition on the official winner winning, though the observed sample does
    (the fights are oriented winner-minus-loser). Conditioned like-for-like in a fact-check rerun,
    independent judges agree **33.7%** of the time. The simulated share of rounds to the winner,
    0.781, then matches the observed 0.786 (unconditioned it was 0.701).
  - A shared round-level noise term u ~ N(0, σ_u²), with β scaled to keep the marginal fit, matches
    the observed agreement at **σ_u ≈ 2.2** (β ×1.66) when conditioned (σ_u 2.0 → 49.7%, 2.5 →
    54.7%), or at 2.5 (β ×1.78) unconditioned. That puts the inter-judge correlation in round
    "impression" at about 0.6.
  - Judges see a lot the box score doesn't (damage, near-finishes, effective aggression) and they see
    it together. In the engine, part of σ_u can be replaced by engine-only events (hurt/wobble,
    accumulated damage); calibrate the rest.

---

## 10. In-fight adaptation

- Holmes asks "will a fighter attempt more strikes upon losing the previous round?" and leaves it open
  [H].
- **From the data** [D] (`kd_by_round.py`): in 3-round fights reaching R2 (n=4,934), a fighter's R2
  share of attempts ≈ 0.45 × their R1 share (regression to the mean), plus **−0.001** for being
  out-landed in R1. Being behind produces no detectable output adjustment.
- Judges, not fighters, carry momentum: previous-round winner bias (Gift 2018), and R1 winners win
  about 68%.
- In-fight win-probability tools (FightTracker) update on round stats, but that is forecasting, not
  behaviour.
- **For the engine:** keep a small optional "trailing fighter takes risks in the last round" knob,
  default off or tiny. Don't hard-code adaptation. Do model a mild previous-round bias in judges
  (Gift) as part of the shared noise.

---

## 11. Open-source projects worth borrowing from

All read via raw.githubusercontent.com. They are untrusted third-party code: reuse ideas and recompute
the numbers, don't vendor the code.

| Project | What it is | Reported result | Borrow |
|---|---|---|---|
| martineza96/FightLab | Same ufcstats source; logistic predictor + Holmes-style Markov simulator (Python, vectorized; 10k five-rounders in about 0.6 s) | Markov 61.7% / 0.656; predictor 63.8% / 0.634; 7-outcome log loss 1.615-1.599 vs 1.726 base rate | Position-time accounting from control and technique shares; offence × allowed odds ratio; pseudo-exposure shrinkage (40 min, 400 strikes, 4 sub attempts); 2-year half-life; fixed-point calibration of league multipliers; symmetric no-intercept judge model; frozen card reviews |
| AnthonyOlakangil/fightline-ml | Walk-forward model vs vig-free close, leak tests, event-level bootstrap | Market 0.6063 vs model 0.6796 log loss; Elo 0.6849 | Evaluation protocol (point-in-time joins, leakage tests, bootstrap by event, pre-registration); verified closing-odds join; de-vig caveat |
| shortlikeafox/ultimate_ufc_dataset | Closing moneylines plus method odds, 2010-03 to 2026-03 (Apache-2.0) | — | Market benchmark for the v3 backtest (whitelist name, date and odds columns only) |
| PIGJET/ufc-elo | Glicko-2 per division, layoff RD inflation, cross-division offsets, order-invariant predictor | Corner-aware 60.3% / 0.6588; order-invariant 60.1% / 0.6637 (walk-forward 2013+) | Rating baseline design; symmetric predictor |
| XEchosen/ufc-fight-prediction | Hand-written Glicko-2 (R) with layoff and division-change RD, XGBoost on lagged features, Platt scaling | 61.5% raw (59.3% after Platt) vs 57.9% red-corner baseline | RD inflation on division change |
| Greco1899/scrape_ufc_stats | Scraper behind data/raw (GPL-3.0) | — | Refresh path (ufcstats now blocks plain scrapers, per fightline-ml) |
| cflores124/UFC312_FightOutcome_Simulation_2025 | Poisson/binomial Monte Carlo for one card | — | Little |
| WarrierRajeev/UFC-Predictions | ML predictor | 72.2% "Accuracy (valid)" | Cautionary: likely leakage or a random split (not audited) |

---

## 12. Recommended engine v3 design

This fits the contract in `docs/ENGINE_V3_SPEC.md`. Where this section adds or changes something, it
says so.

### 12.1 State space

- **Positions:** `DIST`, `CLINCH(c)` (c = controller, pinning the other on the fence), `TOP(X, pos)`
  with pos ∈ {guard, half, side, mount, back}, and a transient `DOWNED(Y)` after a knockdown (X
  pounces or waves him up). Each round starts at `DIST`.
- **Per-fighter continuous state:** head damage D, leg damage G, stamina S ∈ [0, 1], hurt timer H,
  knockdowns absorbed, and fight-night form draws (output, accuracy, power, chin, cardio, grappling).
- **Time:** continuous-time competing hazards (Gillespie). It is exact, and as fast as Holmes's
  1-second or FightLab's 5-second steps with no discretization error. Recompute hazards after each
  event.

### 12.2 Rate equations (division d, round r, position s, target t)

```
Strike attempts by X:  λ_X(s) = λ̄_d(s) · exp(a_X(s) + b_Y(s)) · pace_d(r) · ρ_X(r) · f_S(S_X) · f_H(H_X) · ε_X^out
   a_X(s) = X's attempt effect; b_Y(s) = attempts Y allows (range control). Log-linear (not v2's average).
Target:   t ~ Multinomial(π_X(s)), attacker-only (Holmes), shrunk toward π̄_d(s).
Landing:  logit p = logit p̄_d(s,t) + α_X(s,t) + δ_Y(s,t) + γ_H·1[Y hurt] − γ_S·(1 − S_Y) + log ε_X^acc
KD (head, landed):
          logit q = logit q̄_d(s) + κ_X + χ_Y + c_chin·Δage_Y − c_pow·Δage_X + c_D·D_Y − c_SA·(1 − S_X) + log ε_X^pow + log ε_Y^chin
   q̄_d ≈ 0.0084 at LW (positions pooled; 0.0083 all divisions, 0.0094 men's divisions, 2015+); split by position in calibration.
   c_D and c_SA calibrated jointly so per-strike KD falls with round as observed (§3.2).
After KD: DOWNED(Y) follow-up; finish hazard calibrated so 58% of one-sided KD rounds end in a
          same-round KO/TKO by the scorer; otherwise Y recovers to guard or stands up.
Standing TKO without KD: hazard per landed head strike while H_Y > 0 and D_Y high; calibrated so
          about 29% of KO/TKOs have no KD by the winner in the finishing round.
Takedown attempts: rate per standing minute exp(μ_td + a^td_X + b^td_Y); clinch multiplier.
          Success: logit = logit p̄_td + α^td_X + δ^td_Y (league 0.36).
Top control duration: exponential or gamma with mean m̄_d · exp(a^ctl_X + b^esc_Y)
          (league mean 121 s per TD landed, 2019+; ufcstats control includes clinch control, so the
          ground share is estimated). Stand-up hazard = 1 / mean (Holmes).
Ground: pass/sweep/stand-up hazards by sub-position; GnP rate per top-minute; sub-attempt rate per
          top-minute × position multiplier (Holmes needed ×2 without positions);
          conversion logit = logit c̄ + α^sub_X + δ^sub_Y (FightLab prior strength 4 attempts).
Clinch: entry hazard from both fighters' clinch propensity (FightLab sqrt rule); exit about 1/25 s
          baseline, tuned to the league clinch share.
Stamina: dS/dt = −(drain_X · pace intensity + body-strike hits · w_b); partial recovery between rounds.
Pace: pace_d(r) = league round multipliers (§4); ρ_X(r) = fighter's late-round ratio shrunk toward 1.
```

### 12.3 Estimating fighter parameters from round-level data

1. **Sums.** Per fighter, sum landed and attempted by position and target, knockdowns for and
   against, takedowns, control, submissions and reversals (the v3 spec's `S` and `C` arrays).
   Estimate position exposures per fight as in §1.4.
2. **Time decay.** Weight each fight by `0.5^(Δdays / h)` with **h = 730-1,100 days**. My sweep put
   the best test log loss at a 2-3 year half-life, flat from 1.5 to 4; no decay was worse (0.6687 vs
   0.6636); FightLab uses 2 years. Decay relative to the forecast date, not the fighter's last fight,
   unless simulating historical primes.
3. **Empirical-Bayes shrinkage toward the fight division's priors.**
   - Per-minute rates, Gamma-Poisson: `r̂ = (y + k·μ_d) / (e + k)`.
   - Probabilities, Beta-binomial: `p̂ = (l + k·p̄_d) / (a + k)`.
   - Estimate k per stat by method of moments: `k = μ / τ²`, where τ² = between-fighter variance of
     true rates = Var(observed rate) − mean(μ / e_i). Or tune k on the walk-forward.
   - Starting values: per-minute rates **10-40 minutes** (my sweep best at 10-30; FightLab 40);
     accuracy by target **50-150 attempts**; KD for and against **300-400 landed head strikes** (v2
     300; FightLab 400); submission conversion **4 attempts**; control per TD **3-5 takedowns**.
   - Use the fight's division for the priors. A one-class move needs no extra size term by default
     (§6).
4. **Opponent adjustment.** Backfit attack and defence effects jointly, with ridge (Gaussian prior)
   penalties equal to the shrinkage above, using the time-decay weights: 3-5 alternating passes of
   the log-linear model `log E[y] = log e + μ_d + a_X + b_Y`. Do it in `tools/build_db.py` so the
   browser engine only reads finished effects. This is what lets Holmes beat raw-stat regression.
5. **Age.**
   - Apply chin and power drift only for the gap between the fighter's age on fight night and the
     decay-weighted mean age of his evidence. The decayed stats already contain most of the decline.
   - Δage = age_fight − ā_evidence.
   - Starting coefficients (fit in calibration): chin `exp(0.04-0.05 per year past 30)`, power
     `exp(−0.05 per year past 30)`. These roughly reproduce ×1.2-1.35 and ×0.67-0.79 at ages over 33
     and over 36 (§3.3).
   - Output and cardio aging: unknown from this research. Leave them neutral, then check the backtest
     residual against age gap; it should come out flat (raw data: −0.062 logits per year beyond Elo).
6. **Prior KO losses.** Feed them into the chin posterior as evidence (as extra KD-absorbed events)
   rather than as a separate multiplier, or cap any extra term at about ×1.15.
7. **Pace.** Per-fighter round-5/round-1 landed ratio, shrunk toward the division curve with
   pseudo-weight of about 3 five-round fights.

### 12.4 Uncertainty

- **Parameter uncertainty.** Each simulated fight draws each skill from its approximate posterior:
  Gamma(y + kμ, e + k) for rates and Beta for probabilities, so a short career gives wide outcomes.
  Holmes sampled posteriors per chain.
- **Fight-night form.** Lognormal output, power, chin and cardio; logit-normal accuracy and grappling.
  v2 used output sd 0.10, power 0.15 and chin 0.12. Re-tune the sds so the walk-forward calibration
  slope is about 1.
- Report Monte Carlo error. At N = 20,000 the sd of a 50% estimate is about 0.35 points.

### 12.5 Judging model

- **Per round, per judge j:**
  `z_j = Σ_k β_k·Δx_k + β_hurt·Δhurt + u_r + η_j`, with u_r ~ N(0, σ_u²) shared and η_j logistic
  (scale 1).
- **Coefficients.** Start from the fitted β (§9), preferably the 2017-2026 or 2025-26 column (KD
  13-15 head-strike units, TD about 1.5, control about 2.5 per minute, ground strikes ×1.8), all scaled
  ×1.6-1.8 because the shared noise is explicit.
- **Engine-only events.** Add "hurt/wobble" with a weight between a landed head strike and a KD, then
  reduce σ_u until **unanimity in 3-round decisions ≈ 52%** and the **split share ≈ 13-20%**.
- **Judge tastes.** Per-judge multipliers on the damage, volume and grappling β, drawn per fight,
  sd 0.15-0.25 on the log scale (Holmes EJOR: preferences differ between judges). Optional home-crowd
  bump for a fighter at home abroad (FightLab +4.6 points; Holmes: only with a live crowd).
- **10-8.** Only when the round winner's margin includes damage: a KD, or hurt plus damage
  dominance. P(10-8 | margin) calibrated to **2-3% of judge-rounds** (2024-26) and about **50%
  single-judge** 10-8s. Control without damage never scores 10-8 (ABC 2025).
- Optional previous-round bias (Gift): a small positive shift toward the previous round's winner.

### 12.6 Validation protocol

- **Walk-forward with frozen snapshots.** For every fight, profiles, priors, k and age terms are built
  only from fights before its date. Tune on 2015-2022 (or 2019-2023 per the spec) and report on 2024+
  untouched. Test leakage like fightline-ml: no feature row may use an event on or after its fight.
- **Metrics.**
  - Winner: log loss, Brier, accuracy, AUC, ECE, calibration curve (10 bins) with fitted slope and
    intercept; target slope 1.
  - 7-outcome log loss: base rate 1.726, best published 1.60-1.62 (FightLab).
  - Method and round: share of KO/SUB/DEC by division; finish hazard by round (§3.2); decision split
    (§9).
  - In-fight counts: landed per minute, takedowns, control, KD per 100 head strikes (§2, §3.2).
  - Per-fight landed-strike error.
- **Benchmarks on the same fights.** Elo (log loss about 0.680-0.685), the stats logistic
  (0.634-0.664), the de-vigged closing line (0.606-0.608, with a recalibration slope of about 1.08),
  and a log-odds blend of engine and market fitted walk-forward.
- **Uncertainty on differences.** Paired per-fight log-loss differences with a bootstrap over events
  (10,000 resamples). Never compare two point estimates by eye.
- **Live checks.** Freeze predictions before each card, as FightLab's card reviews and fightline-ml's
  forward test do. Grade them later. Expect ±25 points of noise on a single card.

### 12.7 Parameters to tune in calibration (global, not per fighter)

Strike-rate scale; KD scale per position; KD follow-up finish hazard; standing-TKO hazard; c_D and
c_SA (damage vs fatigue on power); submission-attempt multiplier (Holmes ×2) and conversion scale;
stand-up and clinch-exit hazards; age chin and power coefficients; form sds; σ_u and judge-taste sd;
10-8 threshold; shrinkage k's; half-life h.

---

## 13. Open questions and what wasn't verified

- Holmes EJOR 2024 coefficient tables, and the size of judge heterogeneity: paywalled, not read.
- O'Connell thesis PDF, FightTracker PDF and Miller & Nichols full text: blocked or paywalled.
- FightMatrix's published accuracy (the HANDOFF "high 60s" claim): not found.
- The HANDOFF Robbins "6,190 fights, slope CI 0.983-1.08" claim: not found. My own recalibration slope
  on 6,916 closing lines is 1.08 [1.01, 1.16].
- A rigorous study of peak age by weight class: none found.
- The exact 2017 Unified Rules 10-8 wording, and the original citation for log5: from background
  knowledge, not re-checked this session (search budget exhausted).
- No public data covers time in position, knockdown follow-up sequences, or "hurt" states, so these
  engine parts can only be calibrated to aggregates.
- The adversarial fact-check (verification log below) could not reach the peer-reviewed hosts either.
  Holmes 2023 and the GitHub projects were checked at source. The other papers' findings stand as
  originally sourced, with the flags given.

## 14. Reproducing the [D] numbers

Run from the project root (Python 3.13, pandas, numpy):

```
python3 -I research/analysis/base_rates.py      # KD per head strike, method shares, KD->finish, pace, finish hazards
python3 -I research/analysis/league_priors.py   # division priors 2019+
python3 -I research/analysis/judging.py         # round-level judge model, 10-8 by year, split share (writes judge_beta.npy)
python3 -I research/analysis/judge_noise.py     # shared judge noise (run judging.py first)
python3 -I research/analysis/age_weight.py      # Elo baseline, age, chin/power, prior KOs, weight-class moves
python3 -I research/analysis/halflife.py        # time-decay half-life and shrinkage sweep
python3 -I research/analysis/kd_by_round.py     # KD per head strike by round, adaptation check
python3 -I research/analysis/market.py PATH/TO/ufc-master.csv   # closing-line calibration (odds file not in repo)
```

---

## References

**Peer-reviewed and working papers**
1. Holmes, B., McHale, I. G., Żychaluk, K. (2023). A Markov chain model for forecasting results of mixed martial arts contests. International Journal of Forecasting 39(2), 623-640. https://doi.org/10.1016/j.ijforecast.2022.01.007 (full text: https://prod-dcd-datasets-public-files-eu-west-1.s3.eu-west-1.amazonaws.com/05bdcbd7-50e1-4f75-95e5-693192fd2708; index: https://ideas.repec.org/a/eee/intfor/v39y2023i2p623-640.html)
2. Holmes, B., McHale, I. G., Żychaluk, K. (2024). Detecting individual preferences and erroneous verdicts in mixed martial arts judging using Bayesian hierarchical models. European Journal of Operational Research 312(2), 733-745. https://doi.org/10.1016/j.ejor.2023.07.004 ; https://ideas.repec.org/a/eee/ejores/v312y2024i2p733-745.html
3. Holmes, B. (2022). Quantitative Essays on Mixed Martial Arts (PhD thesis, University of Liverpool). https://livrepository.liverpool.ac.uk/id/eprint/3166169
4. Gift, P. (2018; online 2017). Performance evaluation and favoritism: Evidence from mixed martial arts. Journal of Sports Economics 19 (issue 8 and pages 1147-1173 not re-verified). https://journals.sagepub.com/doi/abs/10.1177/1527002517702422 (title, journal, volume and DOI as cited in Holmes et al. 2023)
5. Feldman, T. (2020). The Way of the Fight: An Analysis of MMA Judging. Journal of Applied Sport Management 12(2). https://trace.tennessee.edu/jasm/vol12/iss2/5
6. Berthet, V. (2024). Improving MMA judging with consensus scoring: A statistical analysis of MMA bouts from 2003 to 2023. arXiv:2401.03280. https://arxiv.org/abs/2401.03280v1
7. Berthet, V. (2023). FightTracker: Real-time predictive analytics for Mixed Martial Arts bouts. arXiv:2312.11067. https://arxiv.org/abs/2312.11067v1
8. Miller, K. M., Nichols, M. W. (2026). Efficient market insights and favorite-longshot bias in mixed martial arts betting markets. Journal of Economics and Finance 50(1). https://link.springer.com/article/10.1007/s12197-026-09757-x
9. Robbins, T. Weak Form Efficiency in Sports Betting Markets (working paper, East Carolina University). https://myweb.ecu.edu/robbinst/PDFs/Weak%20Form%20Efficiency%20in%20Sports%20Betting%20Markets.pdf
10. Stanhope, S. (2021). UCSAS poster on UFC odds calibration. https://statds.org/events/ucsas2021/posters/ucsas2021_15_Stephen_Stanhope.pdf
11. Hutchison, M. G., et al. (2014). American Journal of Sports Medicine 42(6); a video and competition-data analysis of KOs and TKOs in 844 fights at numbered UFC events, 2006-2012. Exact title not verified (recalled as "Head trauma in mixed martial arts"; host blocked in the fact-check). https://journals.sagepub.com/doi/10.1177/0363546514526151
12. Predictors of two consecutive knockout losses in Ultimate Fighting Championship athletes (2026). The Physician and Sportsmedicine 54(3). https://pubmed.ncbi.nlm.nih.gov/41674479/
13. Incidence of concussions in male mixed martial arts competition in relation to number of matches and previous knockout losses (journal details not verified). https://www.researchgate.net/publication/362236679
14. Lamas, L., et al. (2024). No-gi Brazilian jiu-jitsu: A Markovian analysis of elite-level combat dynamics. Int. J. Sports Science & Coaching. https://journals.sagepub.com/doi/10.1177/17479541231210979
15. Kovalchik, S. (2016). Searching for the GOAT of tennis win prediction. Journal of Quantitative Analysis in Sports 12(3), 127-138. https://doi.org/10.1515/jqas-2015-0059
16. The physical demands of mixed martial arts (review; cites Del Vecchio 2011, Antonietti 2019). https://researchonline.ljmu.ac.uk/id/eprint/13541/1/MMA%20Performance%20Research%20in%20ARMSS%20FINAL%20DRAFT.pdf
17. An analysis of weight and fighting styles as predictors of winning outcomes of elite MMA athletes. The Sport Journal. https://thesportjournal.org/article/an-analysis-of-weight-and-fighting-styles-as-predictors-of-winning-outcomes-of-elite-mixed-martial-arts-athletes/

**Rules**
18. Association of Boxing Commissions (2025). MMA Scoring Criteria Clarification. https://www.abcboxing.com/wp-content/uploads/2025/08/ABC-MMA-Scoring-Criteira-Clarification-7.2025.pdf

**Analyses, blogs and trackers (lower confidence)**
19. O'Connell, R. UFC judging analysis. https://oconnellryan.github.io/ufc-judging-analysis.html
20. UFCalendar: 10-8 study https://www.ufcalendar.com/blog/the-vanishing-10-8-round ; odds study https://www.ufcalendar.com/blog/ufc-odds-line-movement-14-year-study ; aging https://www.ufcalendar.com/blog/when-do-ufc-fighters-get-washed ; accuracy https://www.ufcalendar.com/elo/accuracy , https://www.ufcalendar.com/power-index/accuracy
21. AgentMMA: favourites https://agentmma.com/mma-lab/ufc-favorites-win-rate ; peak age https://agentmma.com/mma-lab/ufc-fighter-peak-age ; pace https://agentmma.com/mma-lab/ufc-fight-pace-by-round ; round 1 https://agentmma.com/mma-lab/ufc-round-one-winner-predict-fight ; judging criteria https://agentmma.com/mma-lab/ufc-round-judging-criteria
22. FightMatrix: Glicko tuning https://www.fightmatrix.com/2019/09/18/tuning-glicko-what-i-learned-confirmed/ ; age curve https://www.fightmatrix.com/2026/10/22/the-age-curve-in-combat-sports-statistical-breakdown-of-apex-performance-windows-across-ufc-divisions/
23. Bloody Elbow: 10-8 https://bloodyelbow.com/2018/02/01/be-analytics-crunching-numbers-2017-10-8-judging-scoring-criteria-ufc-mma-editorial ; longevity https://bloodyelbow.com/2013/07/18/ufc-going-deeper-into-mma-fighter-longevity-does-age-matter/ ; weight changes https://bloodyelbow.com/2015/08/05/ufc-fighters-little-success-changing-weight-classes-mma/
24. The Fight Algorithm, fatigue factor. https://thefightalgorithm.com/articles/fatigue-factor
25. Aggression to the Mean, How Accurate Are Fight Odds. https://aggression-to-the-mean.github.io/AttM/for-the-people/arts/2021/02/16/How-Accurate-are-Fight-Odds.html

**Open-source code and data**
26. FightLab. https://github.com/martineza96/FightLab (README, docs/PROJECT_BREAKDOWN.md, src/ufc/markov.py)
27. fightline-ml. https://github.com/AnthonyOlakangil/fightline-ml
28. ultimate_ufc_dataset (closing odds). https://github.com/shortlikeafox/ultimate_ufc_dataset
29. PIGJET/ufc-elo. https://github.com/PIGJET/ufc-elo
30. XEchosen/ufc-fight-prediction. https://github.com/XEchosen/ufc-fight-prediction
31. Greco1899/scrape_ufc_stats (source of data/raw). https://github.com/Greco1899/scrape_ufc_stats
32. WarrierRajeev/UFC-Predictions. https://github.com/WarrierRajeev/UFC-Predictions

---

## Verification log

Adversarial fact-check, Friday, Nov 6, 2026. I tried to refute each claim, not to confirm it.

**What could be checked.**
- The Holmes et al. (2023) PDF was re-downloaded from the Mendeley bucket and its text extracted.
- The GitHub READMEs and code were read at raw.githubusercontent.com: FightLab (README,
  PROJECT_BREAKDOWN, `markov.py`), fightline-ml, PIGJET, XEchosen, WarrierRajeev, cflores124,
  ultimate_ufc_dataset and the Greco1899 LICENSE.
- Every `research/analysis/*.py` script was re-run on `data/raw`. `market.py` was re-run on a fresh
  copy of `ufc-master.csv`.
- The scripts were read for logic errors. Extra checks went to throwaway scripts in the session
  scratchpad, not the repo.
- Blocked: the shared web-search budget was exhausted before this check started. Crossref, PubMed,
  arXiv, RePEc and the other publisher hosts don't resolve from this session. Peer-reviewed
  findings other than Holmes 2023 could only be checked against what Holmes 2023 and the GitHub
  sources say about them.

**Key claims.**

| # | Claim | Verdict | Note |
|---|---|---|---|
| 1 | Holmes 2023: 61.77% vs bookmaker 61.16%, BT 54.13%, logistic 47.71%; adj_ko 0.4, adj_sm 2; judging logit 0.172 / 0.838 / 0.547; ROI 10.2% and 26.5% | Confirmed | All match Tables 2, 6, 7 and 8 and §7 of the PDF: 327 test fights, 9,377 judged rounds, overrounds 4.25% / 23.38%, method accuracy 38.84 vs 32.72, bootstrap 61.62 (sd 0.53), endings 162/107/57 actual vs 167/103/57 predicted. Minor fix: the Cauchy prior scale is 2.5 for binary and 2.5/(2·sd) for numeric predictors. The PDF is the article-in-press version, so the volume and pages come from the DOI and index. |
| 2 | fightline-ml: close 0.6063 / 0.2096 / 66.7% on 4,636 fights; LightGBM 0.6796; Elo 0.6849; stacking ≈ 0 | Confirmed | README eval table and stacking control (−0.0009 nats, attributed to the market's own recalibration). The summary table had rated this [H]; now [M], since the numbers are self-reported. "Close beats open by 0.012" now notes it was measured on 1,975 fights from 2010-2015. |
| 3 | 6,916 fights: log loss 0.608, Brier 0.2105, fav 66.6%, slope 1.084 [1.011, 1.157]; 75-80% bucket 83.1% | Confirmed | Re-ran exactly. fightline-ml independently verified these as closing lines (3,812 jointly covered fights). The Robbins 6,190-fight claim is still unverified. |
| 4 | KD per 100 head strikes: 0.83 all, 0.94 men, LW 0.84, FW 0.88, LHW 1.22, women 0.27-0.55 | Confirmed | Re-ran; men pooled = 2,399 / 254,443 = 0.943. |
| 5 | 58.1% / 85.9% / 70.9% | Confirmed | Re-ran (n = 2,306 rounds; 1,907 KO/TKO). Added a caveat: ufcstats logs the finishing knockdown as a KD (13 of 15 one-shot finishes, including Holloway-Gaethje and Topuria-Volkanovski), so these are KD-or-KO rates. |
| 6 | KD per 100 head strikes by round, R5 sample 0.44 / 0.41 / 0.32 / 0.21 / 0.31 | Confirmed, reasoning tightened | The numbers reproduce. The doc said "selection can't explain" the decline. More precisely, the last round of each sample is inflated by finishing KDs, and only about 17-30 KDs fall in each round, so the R1-R4 decline is suggestive, not firm. |
| 7 | Round-level judge β (head 0.176 … miss −0.004); KD 10.2 → 15.3 head-strike units; TD 2.7 → 1.5 | Confirmed | Re-ran (11,037 cards). The 2025-26 KD weight has se 0.52 on β 2.98, so 15.3 has a wide interval (se about 2.7 units; 95% about ±5). The era drift is about 2-2.4 se. |
| 8 | Unanimity 52.2% vs 30.5% independent; σ_u ≈ 2.5 | Corrected | 52.2% and 30.5% reproduce, but the simulation didn't condition on the official winner winning, which the observed sample does. Conditioned, independent judges give 33.7% and the winner's round share matches (0.781 vs 0.786 observed). The matching σ_u is ≈ 2.2 (β ×1.66; correlation ≈ 0.6), not 2.5. The conclusion (strong shared judge signal) stands. |
| 9 | 10-8 6.8% (2019), 2.0% (2025); UFCalendar 6.39% / 2.09%; splits 13-14% in 2025-26 | Confirmed for [D]; UFCalendar unverifiable | Re-ran: 6.82%, 2.04%, splits 13.7% / 13.4%. UFCalendar page unreachable. Added a caveat that totals-based inference counts point deductions as 10-8s (ufcstats lists deductions in only 6 decisions since 2015). Majority decisions are 0.7-4%, not 1-4%. |
| 10 | −0.062 per year of gap, −0.040 per year past 34; residual −0.07 / −0.16 | Confirmed | Re-ran (n = 6,576; se 0.007 and 0.018). Elo is walk-forward and pre-fight. |
| 11 | Within-fighter chin ×1.21 / ×1.35, power ×0.79 / ×0.67 | Corrected (labels) | The ratios reproduce, but the bins in `age_weight.py` are exact ages (0, 33], (33, 36], (36, 60], not "34-36" and "37+". Relabelled "over 33 up to 36" and "over 36" throughout. |
| 12 | Up one: 50.6% vs 51.1% (n = 478); chin 0.85 vs 1.02; 0.864 vs 0.850; down −4.2 | Confirmed | Re-ran. Added sampling error (up: CI about −5 to +4 points; down: not significant at 5%). Noted that the chin index is relative to the new division's base rate. |
| 13 | FightLab Markov 61.7% / 0.656; logistic 63.8% / 0.634; Elo 56.0% (1,475 fights) | Confirmed | README tables. FightLab's Elo log loss is 0.680, so the summary range became 0.680-0.685. The README's k_min = 40 and k_ko = 400 differ from the code defaults (15 and 150); noted. |
| 14 | Gift 2018 findings; Holmes EJOR 2024 judge preferences and home × crowd | Unverifiable (existence partly confirmed) | Gift's title, JSE vol. 19 and DOI are confirmed by Holmes 2023's references, which also list his covariates (champion, odds, previous round). FightLab links a Liverpool copy of the EJOR paper. The findings themselves couldn't be re-read. |
| 15 | Half-life 2-3 y best (0.6636-0.6637 vs 0.6687); k 10-30 best | Confirmed, with caveat | Re-ran. Decay vs no decay is real (paired +0.0051, se 0.0018). Between 1.5 and 6 years the differences are at or within about 2 se (1.5 vs 3: +0.0011, se 0.0012). h and k were picked on the test window, with no separate validation. |

**Other corrections from skimming the whole file.**
- §3.1 Hutchison 2014: "844 numbered UFC events" was wrong. The data hold only 98 numbered UFC
  events in 2006-2012 (1,016 fights). 108/844 = 12.8% and 179/844 = 21.2% match the quoted 13% and
  21%, so 844 is the fight count. Fixed.
- §5 SI "men below welterweight aged 35+ are winless in title fights": refuted by the dataset. There
  have been six such wins since Apr 2025, four of them by Volkanovski or Gaethje. Struck through.
- §5 "about half a year apart": the ufcstats DOBs (Sep 29 and Nov 14, 1988) put them about six weeks
  apart. Fixed.
- §5 age in the half-life logistic: the "0.6648 → 0.6523" comparison mixed samples (2,271 vs 2,227
  fights). On the same 2,227 fights it is 0.6656 → 0.6523, with accuracy 60.3% → 61.4%. Fixed.
- §7 / §11 PIGJET: 60.3% / 0.6588 is the corner-aware variant. The order-invariant predictor scores
  60.1% / 0.6637. Fixed.
- §7 / §11 XEchosen: 61.5% is the raw XGBoost accuracy. Platt scaling gives 59.3% (log loss 0.678 →
  0.662), so "Platt-calibrated 61.5%" was wrong. Fixed.
- §7 / §11 igordobronx/fight_predictor_plataform "~85%": no README at raw.githubusercontent.com
  (HEAD, main, master or common name variants). The figure was removed.
- §3.2 and §0: added that ufcstats KD counts include the finishing knockdown (engine implication:
  don't add a separate KO path on top of the KD rate).
- §1.3: noted the FightLab code defaults versus the README settings.

**Not verified (no change in substance, flags kept).** Holmes EJOR 2024 findings; Holmes thesis; the
Gift findings, sample and pages; Feldman 2020; Berthet 2023 and 2024 (arXiv); Miller & Nichols 2026;
Robbins; Stanhope 2021; Hutchison's title, mandible share and other details; the Physician and
Sportsmedicine 2026 study; the Japanese concussion study; Lamas 2024; Kovalchik 2016; the LJMU review;
ABC 2025 criteria; O'Connell; UFCalendar, AgentMMA, FightMatrix, Bloody Elbow, The Fight Algorithm,
Threads, Wagerwire and The Sport Journal figures; the "11 of 27" second-division title bids. All
hosts were unreachable or the search budget was spent. None were found to be wrong, and none were
re-confirmed.
