# Audit of the v2 Volk vs Gaethje simulator

Audited Friday, Nov 6, 2026, against commit `e95a852` (v2 as uploaded). Scope: every file in `src/`,
`tests/`, `legacy/`, `build.py` (v2 version), `README.md`, `CLAUDE.md`, `HANDOFF.md`, `CONVERSATION.md`
and `docs/ENGINE_V3_SPEC.md`. Nothing under `src/`, `tests/` or `legacy/` was modified.

**How I checked.** I read the code. I ran the v2 harness (`node tests/test_engine2.js 20000`) and
wrote extra probes of engine2 in Node. I tested v2's assumptions against the UFC stats snapshot in
`data/raw/` (ufcstats.com via Greco1899/scrape_ufc_stats, through Oct 31, 2026), including
walk-forward tests over 5,878 fight-sides. I built the v2 page and rendered it headlessly in
Chromium with SwiftShader, taking 40+ screenshots of the cage and both page widths.

**Confidence tags:** **[high]** measured or read directly from code or data. **[med]** an inference
from measurements, with caveats stated. **[low]** a judgment or an unverified external fact.

**Repo state note [high].** `build.py` at HEAD (commit `eeb164e` when audited; HEAD has since moved
to `e59bc48`, whose `build.py` is unchanged, and the working-tree copy also expects `src/avatar3d.js`)
is already the v3 build script and expects `src/params3.js`, `src/engine3.js` and
`src/director3.js`, which don't exist yet. So `python3 build.py` currently fails with
`FileNotFoundError: src/params3.js`. To audit v2, I built
the page from the v2 commit's `build.py` and sources in the scratchpad. The result was byte-identical
to the committed `volk-gaethje-simulator.html`.

Screenshots, probe scripts and the contact sheet are in
`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/audit/`. The contact
sheet is `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/audit/contact_sheet.png`.
The scripts are listed in the Reproduce section at the end.

---

## TL;DR: the ten things that matter most

| # | Pri | Finding | Evidence | Fix |
|---|---|---|---|---|
| 1 | P0 | **Too few finishes, and the hazard runs the wrong way.** v2's finish hazard *rises* by round; real five-round UFC fights show a *falling* hazard. Fed league-average inputs, v2 finishes 36% of five-rounders vs 58.5% in the data (and fewer in 25 minutes than real three-round fights do in 15: 49.5%). The level gap is the hard evidence; the shape is partly a heterogeneity effect (§0.1). | Data 2015+, n=574: hazard by round .207/.204/.171/.110/.109. v2, league clone: .063/.074/.089/.098/.106. v2, Volk vs Gaethje: .076/.096/.119/.162/.185. Removing v2's damage feedback flattens the clone to .063-.071 (verification log). | KD follow-up state, standing TKO, damage that partly recovers, real heterogeneity. Calibrate to the hazard curve. |
| 2 | P0 | **Knockdowns convert to finishes too rarely.** | Data: 57.0% of rounds with a KD end in that fighter's KO/TKO the same round (n=2,361). v2, measured the same way: 37% (league clone) to 43% (Volk vs Gaethje); 35-39% per KD event. | Model the post-KD sequence explicitly, calibrated to 0.56 (1 KD) and 0.67 (2+ KD), counting the finishing KD as ufcstats does. |
| 3 | P0 | **The strike-rate formula is biased.** It averages landed/min and absorbed/min, then scales by 0.85, a factor tuned on 4 in-sample fights. | Walk-forward, 5,878 fight-sides: v2's formula under-predicts landed strikes by 18.3% (16.9% on 5-round fights). Poisson deviance 13.89 vs 11.59 for shrunk, time-decayed multiplicative rates. | Attempts x accuracy per position, multiplicative rates with log5 on accuracy, shrinkage, 2-year half-life. Delete STRIKE_CAL. |
| 4 | P0 | **Chin is ignored.** The KD chance depends only on the attacker's power; the defender's KD susceptibility exists only as hand-set knobs (`volkChin`, and Gaethje's `mileage`) plus random night form. | KD deviance: power-only 9,027, power x chin 8,845 (k=300, 10,496 fight-sides). For power x chin the best prior strength of those tried is 300 head strikes. | `p = power * chin / p0`, both shrunk with k ≈ 300. |
| 5 | P0 | **The engine is badly overconfident about volume.** Night-to-night form sd is 0.10. | Fight-level landed rates have a log residual sd of 0.58, of which Poisson noise explains 0.15. The extra sd is up to 0.53 for attempts and 0.40 (logit) for accuracy. | Calibrate form sds in the walk-forward backtest. Add a shared pace factor and posterior skill draws. |
| 6 | P0 | **Everything is hard-wired to Volkanovski and Gaethje:** engine constants, knobs, presets, director move tables, 3D specs, mat lettering, HUD copy, sliders, model stack, backtest, page copy. | See section 2 (60+ sites). | Roster JSON, generic knobs (`adjA`/`adjB`), templated copy, data-driven appearance and styles. |
| 7 | P0 | **"Landed" strikes visibly miss.** At distance, every landed punch stops short of its target. | 133 of 133 landed punches stopped a median 0.76 m short (p90 0.95 m); kicks 0.54 m. Pelvis-to-pelvis distance at impact is 1.64 m against an arm length of 0.59-0.63 m. | Derive fighting range from reach and step in on the strike. Measure contact in a test. |
| 8 | P0 | **The backtest can't support the claim made for it.** The chat summary says the engine "scored a little better than the line" (CONVERSATION.md:84); the page prints the Brier and log-loss comparison (app.js:296) with a caveat. | n=7, in-sample (career stats include the predicted fights). Lopes 1 and 2 are identical inputs. STRIKE_CAL was tuned on 4 of these fights. | Walk-forward over 2019-2026 with frozen profiles (already in the v3 spec). |
| 9 | P1 | **Judging is too noisy and partly ill-posed.** | v2 league clone: split decisions 30% vs data 17.6% (five-round, draws excluded on both sides), draws 2.2% of fights vs 0.87%. 4.8% of simulated judges *penalize* power. 10-8s happen only through knockdowns. | Fit weights and noise to the decision split and draw rate. Clip tastes. Add a damage/dominance path to 10-8. |
| 10 | P1 | **The engine and the show don't agree.** Trace mode changes the fight. The HUD control clock comes from the animation. Beats lag the clock badly at high speed. | 1,491 of 2,000 seeds produce a different fight with trace on (engine2.js:235). HUD control 0:26 vs engine 37.6 s in seed 2443 R1. Max beat lag 201 fight-s at 30x (6.2 s at 5x). | No RNG draws inside `if (trace)`. HUD stats from engine totals. Time-warp the show clock to the beat queue. |

---

## 0. Evidence base: data vs v2

### 0.1 League base rates vs v2 (UFC 2015-01-01 to 2026-10-31, five-minute rounds)

| Quantity | Data, 5-round fights | Data, 3-round fights | v2, league-average LW clone (5 rds) | v2, Volk vs Gaethje baseline |
|---|---|---|---|---|
| Fights | 574 | 5,278 | 40,000 sims | 20,000 sims |
| Finish share | **58.5%** | 49.5% | **36.2%** | 49.8% |
| Finishes by round, % of all fights | 20.7 / 16.2 / 10.8 / 5.7 / 5.1 | 25.4 / 15.9 / 8.1 | 6.3 / 6.9 / 7.7 / 7.8 / 7.5 | 7.6 / 8.9 / 9.9 / 11.9 / 11.4 |
| Hazard (P finish \| round reached) | **.207 .204 .171 .110 .109** | .254 .213 .139 | **.063 .074 .089 .098 .106** | **.076 .096 .119 .162 .185** |
| KO/TKO (incl. doctor) / sub / decision | 43.0 / 15.3 / 41.5 | 31.4 / 17.9 / 50.5 | 28.6 / 7.6 / 61.6 (+2.2 draw) | 48.5 / 0.8 / 49.2 (+1.5 draw) |
| Decisions: UD / SD / MD (draws excluded; v2 columns are computed this way) | 79.8 / 17.6 / 2.6 (n=233; 78.2 / 18.5 / 3.4 if the 5 split and majority draws are counted) | 78.5 / 20.0 / 1.4 (77.4 / 20.1 / 2.5 with draws) | 66.6 / 30.2 / 3.2 | 67.4 / 29.6 / 2.9 |
| Draws, share of all fights | 0.87% | 0.83% | 2.1-2.2% | 1.4% |
| 10-8 rounds | 17.6% of judges' cards have a total below 19 x rounds (a 10-8 or a deduction), about 3.8% per round | 12.0% of cards | 4.0% of round cards | 4.1% of round cards |
| KD round ends in that fighter's same-round KO/TKO | 57.0% (1 KD: 56.0%, 2+: 67.0%; n=2,361 rounds, 3- and 5-round formats) | same | 37.2-37.6% per KD-round (1 KD: 37%, 2+: 47-48%); 35.5% per KD event | 42.5% per KD-round (1 KD: 42%, 2+: 51%); 39.4% per KD event |
| KO/TKO with no KD by the winner in the finishing round | 27.6% (n=1,858) | same | only GNP or leg TKO possible: 7.6-7.9% of in-round KO-type finishes (corner stoppages come on top) | 2.2% |
| Landed sig. strikes per fighter-minute | 3.83 (LW 3.94) | | 3.23 from an input of 3.94 (-18%) | |

All **[high]**, with three provisos. The 10-8 proxy also counts point deductions. In "LW clone",
v2's `fighter()` gets league lightweight rates (slpm = sapm 3.94, acc .46, kd15 .318, td15 1.49,
tdAcc .362, tdDef .638, sub15 .40, targets 63/21/16) against itself. The hazard comparison is the
cleanest test of v2's structure, because a clone matchup is its most neutral input.

**Reading it [med].** The falling league hazard comes partly from heterogeneity: fragile matchups
end early, durable ones survive. A single matchup in a good engine can have a flatter curve. But
v2 run on league-average inputs should reproduce the league curve, and it inverts it. Two mechanisms
in engine2.js cause this: head damage accumulates with no recovery (`dH`, lines 196 and 225-230,
only stamina recovers at line 277), and the multiplicative `(1 + dH/200)` KD term (line 200). On
top of that, per-fight variance is too small to create realistic heterogeneity (section 1.14).

*Verification [high]:* in a scratch copy of engine2.js with the standing `(1 + dH/200)` term, the
`0.0022 dH` finish term and the `x1.12` per-KD chin decay removed, the league clone's hazard is
.063/.063/.066/.071/.067 (finish share 28.9%) and Volk vs Gaethje's is .068/.070/.075/.084/.079.
So damage feedback does produce the rising curve, and it also supplies about a fifth of the
clone's finishes and a third of Volk vs Gaethje's (49.8% falls to 32.5%). A stricter comparison than the five-round column: the clone is a league-average pair, and
v2 finishes 36% of them in 25 minutes while real three-round fights finish 49.5% in 15.

### 0.2 Walk-forward test of the strike-rate formula

Each fight-side from 2018-2026 where both fighters had at least 15 prior UFC minutes. Prediction of
fighter X's significant strikes landed per minute from data before the fight date only.
League constants (2012+): 3.72 landed/min, 8.22 attempted/min, accuracy .453.

| Inputs | Formula | Poisson deviance per fight | Total bias | Minute-weighted log RMSE |
|---|---|---|---|---|
| Career, raw | v2 average `(slpm_X + sapm_Y)/2` | 12.15 | -3.8% | .598 |
| Career, raw | **v2 average x 0.85 (v2 as shipped)** | **13.89** | **-18.3%** | .595 |
| Career, raw | multiplicative `slpm_X * sapm_Y / L` | 15.46 | -1.3% | .648 |
| Career, shrunk (k=30 min, 150 att) | multiplicative | 11.99 | -3.1% | .591 |
| Career, shrunk | attempts x log5 accuracy | 12.13 | -3.0% | .594 |
| 2-yr half-life, shrunk | **multiplicative** | **11.59** | **-0.8%** | .594 |
| 2-yr half-life, shrunk | **attempts x log5 accuracy** | 11.72 | -0.5% | .596 |

**[high]** for the numbers. Takeaways:
- STRIKE_CAL 0.85 is the single worst choice in the table.
- The raw multiplicative form is *worse* than averaging, because averaging is accidental shrinkage.
  Multiplicative only wins once rates are shrunk and time-decayed.
- Attempts x accuracy predicts landed strikes about as well as multiplicative rates (11.72 vs 11.59).
  The reason to switch is structural (misses as events, accuracy modifiers for fatigue, damage and
  position), not a gain in landed-strike accuracy.
- On 5-round fights only (n=822 fight-sides), v2's formula is still biased -16.9%.
- combo.py tried only k = 30 min and a 730-day half-life. A verification sweep (k = 5, 15, 30, 60,
  120 min x half-life 365, 730, 1,460 days, no decay) found 30 min / 730 days best at 11.59, with
  1,460 days at k = 30-60 within 0.06 and no decay at best 11.79 **[high]**. So the defaults hold,
  but the optimum is shallow.

### 0.3 Chin test (walk-forward, 2016-2026, 10,496 fight-sides)

KD counts are modeled as Poisson with exposure = head strikes landed in the fight. Inputs are prior
decayed sums (730-day half-life). League KD per landed head strike p0 = 0.0086 (2012+).

| Prior strength k (head strikes) | League only | Power only | Chin only | Power x chin / p0 |
|---|---|---|---|---|
| 100 | 9,322.5 | 9,020.4 | 9,138.0 | 8,891.5 |
| **300** | 9,322.5 | 9,027.2 | 9,124.6 | **8,845.1** |
| 600 | 9,322.5 | 9,111.9 | 9,184.4 | 8,979.8 |
| 1000 | 9,322.5 | 9,173.3 | 9,226.5 | 9,079.8 |

**[high].** Over the league baseline, chin alone cuts deviance by 198 and power alone by 295, so
chin carries about two-thirds as much information as power; together they cut 477. For power x chin,
300 is the best of the four strengths tried. For power alone, which is v2's structure, k = 100 is
marginally better than 300 (9,020 vs 9,027), so v2's KD_PRIOR_N = 300 is near-optimal rather than
optimal (and v2 applies it to undecayed career sums). KD_PRIOR = 0.009 is close to the data's 0.0083
(2015+) and 0.0086 (2012+).

### 0.4 Night-to-night variance (overdispersion)

These use residuals from the best rate model (2-year half-life, shrunk, multiplicative):

| Quantity | Residual sd | Pure sampling noise | Implied extra sd (form + unmodeled matchup) | v2 |
|---|---|---|---|---|
| log landed/min (n=4,710, expected landed ≥ 20) | 0.583 | 0.146 | **0.565** | `FORM_OUT` 0.10 |
| log attempts/min (n with expected attempts ≥ 40) | 0.542 | 0.099 | **0.533** | 0.10 |
| logit accuracy (attempts ≥ 40) | 0.451 | 0.206 | **0.401** | none |

**[high]** numbers, **[med]** interpretation. The extra sd is an *upper bound* on night form,
because it also contains style interactions the rate model misses. Even if half of it is model
error, v2's 0.10 is several times too small. This matters for this matchup: v2's "Volk wins 67% of
the fights that go the distance" rests on a volume edge the engine treats as near-certain.

*Like-for-like check [high]:* the same decomposition on v2's own output (one fighter's landed
strikes in simulated fights that go 25 minutes, 20,000 sims each) gives a log sd of 0.163 with
Poisson 0.111, so an extra sd of 0.119 for the league clone, and 0.148 / 0.086 / 0.121 for Volk vs
Gaethje. Positional swings and damage add only about 0.02 on top of `FORM_OUT`, against up to
0.565 in the data. (The "67%" figure re-runs as 66.9% of 25-minute fights including draws, 69.0%
of decisions excluding them; 40,000 sims.)

### 0.5 Volkanovski and Gaethje in the dataset vs engine2's constants

v2's career constants (engine2.js:34-37) match the dataset's career totals to within 0.02 a minute
(Gaethje's rates exactly; Volk's are 5.99/3.31 vs 5.98/3.33 in the data) **[high]**:

| | Volkanovski, data | v2 | Gaethje, data | v2 |
|---|---|---|---|---|
| UFC fights, minutes | 19, 312.9 | mins 313 | 16, 202.2 | mins 202 |
| Sig. landed / absorbed per min | 5.98 / 3.33 | 5.99 / 3.31 | 6.29 / 6.83 | 6.29 / 6.83 |
| Accuracy / defense | .569 / .582 | .57 / .59 (unused) | .576 / .507 | .576 / .51 (unused) |
| KD per 15 / KD absorbed per 15 | .288 / .192 | .30 / not used | .668 / .297 | .67 / not used |
| KD per landed head / KD absorbed per opp. head landed | .0049 / .0063 | (prior-shrunk .0060) / none | .0107 / .0052 | .0107 / none |
| TD per 15, attempts per 15, acc, def | 1.63, 4.75, .343, .673 | 1.63, (4.79), .34, .68 | 0.30, 1.11, .267, .733 | 0.30, (1.11), .27, .73 |
| Head / body / leg share of landed | .656 / .102 / .242 | .63 / .11 / .26 | .662 / .109 / .229 | .63 / .09 / .28 |
| Distance / clinch / ground share | .764 / .084 / .152 | .75 / .09 / .16 | .838 / .128 / .035 | .86 / .12 / .02 |

Differences in target and position splits come from v2 using GidStats rather than ufcstats
(HANDOFF.md:66-72 lists GidStats-style splits; sources at HANDOFF.md:106-107).

**Correction (verification pass) [high].** The slider hint (app.js:27) reads "Share of his strikes
at distance aimed at the legs. Career 28%; 6% against Pimblett", and the engine applies `leg` only to
distance strikes (engine2.js:75-77, :184). On that distance-only basis ufcstats gives Gaethje 27.3%
career (very close to 28%) and 8.8% against Pimblett (9 of 102 distance strikes landed). The 22.9%
and 6.2% (9 of 144) figures are shares of *all* landed strikes. So the hint's "28%" is roughly right
for what the knob means, and it is the "6%" that uses the wrong denominator. The real engine flaw is
broader: v2 feeds all-strike target splits (`head`/`body`/`leg`) into the distance-only target draw,
which understates leg shares at distance (Volk: v2 .26 vs ufcstats .316 of distance strikes landed).
Note also that the baseline knobs replace data values: Volk's takedown attempts become 3.0 per 15
(data 4.75), Gaethje's 1.5 (data 1.11), Gaethje's leg share 0.18, plus `volkPow` 0.85, `volkOut`
0.95 and `volkChin` 1.15 (engine2.js:39, :89-96). These are labeled judgment calls, not fits.

**Recency matters [high].** Since 2022, Volk lands 5.51/min with a .552 defense rate and has absorbed
3 KDs in 284 opponent head strikes landed. Gaethje lands 5.26 and absorbs 6.00 with a .439 defense
rate. With a 730-day half-life and shrinkage (k = 30 min; k = 300 head strikes), as of Nov 6, 2026:

| | Volkanovski | Gaethje |
|---|---|---|
| slpm / sapm | 5.00 / 3.40 | 4.88 / 5.26 |
| Power (KD per head landed) | .0052 | .0096 |
| Chin (KD absorbed per head absorbed) | .0086 | .0081 |
| Implied landed/min in this matchup (multiplicative) | **7.07** (v2: 5.18) | **4.45** (v2: 4.08) |
| Implied P(KD per landed head strike) | Volk on Gaethje .0050 (v2 .0044) | Gaethje on Volk .0097 (v2 .0104) |

Before any weight-class adjustment. These are illustrations for v3, not v3's final inputs **[med]**.

**Per-round pace in 5-round fights [high, small samples].**
- Volk landed/min by round: 4.41, 5.48, 7.11, 6.38, 7.20 (fights reaching each round: 12, 11, 9, 8, 7).
  Relative to R1 that's 1.00, 1.24, 1.61, 1.45, 1.63; v2's `pace` (engine2.js:35) is 0.94…1.10.
- Gaethje: 6.30, 6.58, 4.76, 5.84, 5.94 (n = 12, 8, 5, 5, 3); v2 is 1.05…0.93.
- League, in 238 five-round fights that went 25 minutes: attempts by round relative to R1 are 1.00,
  1.17, 1.19, 1.23, 1.26 and accuracy .441-.463. Pace rises on average, so an assumed late fade
  needs evidence. In 3-round fights that went the distance: 1.00, 1.09, 1.14.
- These are selection-affected (fights that end early drop out of later rounds).

---

## 1. Modeling flaws in `src/engine2.js`

Each item: what's wrong, evidence, and what to do instead. "Spec ✓" means `docs/ENGINE_V3_SPEC.md`
already plans the fix; "Spec gap" means it doesn't yet.

### 1.1 Landing rate = average of landed/min and absorbed/min x 0.85 (P0)
- **Where:** engine2.js:11-12 (`STRIKE_CAL = 0.85`), :68-69 (`lamA = (A.slpm + B.sapm)/2 * STRIKE_CAL * outA / 60`).
- **Problems:**
  - **Additive is not a generative model [med].** A defender who absorbs nothing still gets hit
    at half the attacker's rate.
  - **The 0.85 factor is circular [high].** It was tuned on 4 fights that are also in the career
    stats. League-wide it creates an 18% under-prediction (§0.2). In a league-clone run, v2 lands
    3.23/min from inputs of 3.94.
  - **Time-base mismatch [high, from code].** `slpm` is per total fight minute and includes ground
    and clinch strikes. v2 applies it per *standing* second (:160) and 0.85x in the clinch (:163),
    then adds a separate ground-strike rate (`gnp` 3.4-3.6/min, :166-168). Ground strikes are
    double counted, and grapplers' standing volume is overstated. Volk's career landed strikes are
    15% ground strikes.
  - **No shrinkage or recency [high].** Raw career totals, equally weighted from 2016 to 2026.
- **Instead:**
  - Per-position attempt rates per minute *in that position*, with accuracy by target via
    `log5(acc_X, oppAcc_Y, league)`.
  - Shrink rates toward division priors (k ≈ 30 minutes, ≈ 150 attempts for accuracy) and apply a
    730-day half-life (§0.2 best). No global scale unless a walk-forward calibration says so.
  - Spec ✓ (steps 1-4 of matchup construction). Spec gap: put the measured k values and half-life
    in as defaults, and add a test that league-vs-league reproduces 3.8-3.9 landed per fighter-minute.

### 1.2 No misses in the engine (P0)
- **Where:** `fighter()` stores `acc` and `def` (:25), but nothing ever reads them (grep confirms)
  **[high]**. Only landed strikes are events (:181-231).
- **Effects:**
  - The director invents misses visually (director.js:110-124). They use hard-coded `ACC`
    (director.js:5) times a 0.6 fudge, so the cage shows about 0.45 misses per landed strike for
    Volk against a real 0.75, i.e. 60% of his real misses. Misses are generated only for distance
    strikes (director.js:114), where his real rate is 0.86 misses per landed (distance accuracy
    .538), so the cage shows closer to half (verification pass).
  - 25% of the fake misses are credited to the *other* fighter (director.js:119), and their targets
    follow a fixed 70/12/18 split (director.js:120).
  - Misses can't cost stamina, can't feed the judges' aggression criterion, and can't drive the
    HUD's accuracy numbers.
- **Instead:** every strike attempt is an event; `miss` is a trace kind. Spec ✓ ("Strikes are
  attempts times accuracy"; `miss` event).

### 1.3 Only four states, with no sub-positions or KD follow-up (P0/P1)
- **Where:** engine2.js:2 and :159-169: states are distance, clinch, A on top, B on top.
- **Problems [high, from code]:**
  - No clinch controller or cage position.
  - No guard / half / side / mount / back; ground-strike rate is fixed at 3.4-3.6/min whatever the
    position (:35, :37, :166-168).
  - The top fighter can never improve position; the bottom fighter's only escape is a single
    exponential "get up" clock with a hand-set mean (`getUp` 35 s / 45 s; :35, :37, :166).
  - After a non-finishing knockdown, the state resets to *distance* (:227). There is no "downed"
    state where the attacker pounces and lands ground strikes under a referee-stoppage hazard,
    which is how most KD finishes happen.
- **Instead:** add a downed state (KD follow-up) and ground sub-positions with pass / sweep / stand
  rates fit from control seconds per takedown and per takedown absorbed. Spec ✓ (sub-positions,
  KD follow-up, `recover` event).

### 1.4 Hard-coded fighters and knobs (P0)
- **Where:**
  - engine2.js:34-37: VOLK and GAETHJE literals, including hand-set non-data fields `gnp`,
    `getUp`, `ctrl`, `subDef`, `drain`, `pace`.
  - :39: DEFAULT_KNOBS named `volkChin`, `gaeLeg` and so on.
  - :40-49: presets.
  - :89-96: `volkGaethje()` maps those knobs onto `matchup()`.
  - `matchup()` (:64-86) is generic, but any other fighter silently gets defaults for `gnp`, `getUp`,
    `drain` and `pace`. The backtest fighters in tests/test_engine2.js:57-61 do.
- **Instead:** profiles from the data pipeline; generic `adjA`/`adjB` knobs; scenario presets in
  `data/scenarios.json`. Spec ✓.

### 1.5 Knockdown model (P0)
- **Where:** `kdPerHead` (:58-61), `m.kdA = kA * 0.85` (:71), the pKD multipliers (:200-201), the
  finish coin flip (:205), hurt (:207-209).
- **Problems:**
  - **Chin is missing** (§0.3) **[high]**. The defender's KD susceptibility only enters through
    hand-set knobs (`durA` from `volkChin`; `durB` from Gaethje's `mileage`, engine2.js:92-93) and
    random night form (`cA`/`cB`), never from data.
  - **Undocumented extra 0.85** on the KD rate (:71) **[high]**.
  - **Head strikes are approximated** as `slpm * mins * head` (:59), which counts ground head
    strikes and uses a career share. The data has exact head-landed counts.
  - **Compounding modifiers.** `(1 + dH/200) x 1.6 (rocked) x (1 + 0.3(1-S)) x (1 + 0.8(1-mob)) x
    (0.75 + 0.25 mob)` are uncalibrated, and `dH` never recovers between rounds. That produces the
    rising hazard in §0.1 **[high]**.
  - **KD to finish is one instant coin flip,** `pf = 0.28 + 0.0022 dH (+0.15 if rocked)`, capped at
    0.68 (:205). Measured the same way as the data (share of a fighter's KD rounds that end in his
    KO/TKO that round, finishing KD included), v2 converts 37% (league clone) to 43% (Volk vs
    Gaethje), vs 57% in the data; per KD event it is 35-39% **[high]**. Note for calibration:
    ufcstats counts the finishing knockdown as a KD, and 70% of KD rounds are the fight's last round
    (81% of those convert), so the 57% target mixes instant finishes with follow-up finishes. v3
    must count KDs the same way.
  - **Hurt is defined as `roll < 2.5 x pKD`** (:207), so wobbles are always exactly 1.5x knockdowns.
    Arbitrary **[high]**.
  - **No standing TKO without a knockdown.** The data has 27.6% of KO/TKOs without a winner KD in
    the finishing round **[high]**.
  - **No body-shot KO,** which is about 5% of KO/TKO finishes: 101 of 1,858 finish details name a
    body strike (the two largest, 28 "Punch to Body At Distance" and 25 "Kick to Body At Distance",
    are 2.9% on their own; knees to the body add 24) **[high for the count; med as a share of
    true body KOs, since details are free text]**.
- **Instead:**
  - `p = p0 * (power_X/p0) * (chin_Y/p0)`, both shrunk with k ≈ 300; aging, prior-KO and size terms
    fit from data.
  - An explicit post-KD sequence calibrated to 0.56 / 0.67 same-round conversion.
  - A standing-TKO hazard while the defender is hurt and damage is high.
  - Damage that partly recovers between rounds.
  - Target the league hazard curve (§0.1) in the league-vs-league test.
  - Spec ✓ for most of this. Spec gap: between-round damage recovery and the explicit hazard-curve target.

### 1.6 Damage, stamina and mobility scales are uncalibrated (P1)
- **Head damage:**
  - Each landed head strike adds `w = sqrt(kdPerHead/0.0075)` (:72); a KD adds +14, a hurt +5
    (:225-230). It never decays.
  - The same `w` sets the judges' power credit (:266), so "power" counts twice.
- **Stamina [high, from code and the trace probe]:**
  - Drain is 0.00016-0.00024 per second (:35, :37, :176), about 5% per round. Body shots take
    `0.006 w` each (:215), and half recovers between rounds (:277).
  - Output depends on stamina only through `0.82 + 0.18 S` (:155). Median stamina at the end of
    round 5 is .87 (Volk) and .83 (Gaethje) in 5,000 traced fights, so the output cost peaks at about
    2-3% (corrected from "roughly 1%" in the verification pass).
  - So the HUD's "Gas tank" is cosmetic, and the hand-set `pace` arrays do all the late-round work.
- **Mobility:** `mob = 1 - 0.006 dL`, floored at 0.6 (:154). Leg TKO hazard `0.003 (dL-30)/10`
  per leg strike (:219). Plausible, but the data has 11 leg-kick TKOs out of 1,858 three- and
  five-round KO/TKOs since 2015 (0.6%; 1,872 in all formats) **[high]**. v2's Volk vs Gaethje LEG finishes are 0.18% of fights, which is fine.
- **Instead:** fit pace curves from the data (division curve plus a shrunk per-fighter ratio, Spec ✓).
  Make stamina matter through attempt rate and accuracy, and fit its size so late-round accuracy
  and pace match §0.5 **[med]**.

### 1.7 Clinch is constant for everyone (P1)
- **Where:** engine2.js:9 (`CL_ENTRY = 0.45/60`, `CL_EXIT = 1/15`), :10 (`CLINCH_TGT`).
- **Problem:** the fighters' clinch shares (Gaethje 12.8%, Volk 8.4% of landed strikes) and their
  clinch control never enter. The clinch "initiator" (:235) is a coin flip used only for animation.
- **Instead:** clinch entry rate from clinch-strike and clinch-control exposure; a controller who
  pins the other on the fence; clinch accuracy from the data (.716 league). Spec ✓.

### 1.8 Takedowns (P2)
- `log5` with LEAGUE_TD_ACC 0.37 (:8, :79-80) is sound; the data gives .363 (2015+) **[high]**.
- Problems:
  - Attempts per 15 total minutes are applied per standing second (:78, :161).
  - The attempt rate is backed out from `td15 / tdAcc` (:30) even though the data has attempts
    directly. Minor.
  - In the clinch, attempts are x1.5 and success x1.15 (:164, :237). Unfitted.
- **Instead:** attempts per standing minute by position (distance vs clinch) from data, if derivable
  (ufcstats doesn't split TD attempts by position; fit a single clinch multiplier) **[med]**.

### 1.9 Submissions: structural zeros and flat conversion (P1)
- **Where:** `m.subA = sub15/900*6` (:81), a magic x6 per top-second; `pSubA = 0.22 x subDef` (:82),
  a flat 22% scaled only by the defender's hand-set `subDef` (Gaethje 0.8, everyone else 1).
  Attempts only happen from top position (:166-168): no guard submissions from the bottom and no
  guillotines or back takes off scrambles.
- **Problem:** Gaethje's `sub15 = 0` means he *never* attempts a submission. In 5,000 simulated
  fights he made 0 attempts **[high]**. League LW/FW five-rounders end by submission 16% of the
  time (n=123, 2015+) **[high]**.
- **Instead:** shrink attempt rates per top minute toward the prior; conversion and defense via
  log5 of `sub_w / sub_att` and `sub_l / osub_att`; guillotines on failed shots. Spec ✓.

### 1.10 Judging (P1)
- **Where:** engine2.js:259-273.
- **What's good [high for the arithmetic; low for the source match]:** A takedown (3) equals 50 s of
  control at 0.06/s, and a submission attempt (7) is more than twice a takedown. That mirrors v2's
  own summary of the O'Connell analysis (HANDOFF.md:94-95), so the "consistency" is by construction;
  the analysis itself (oconnellryan.github.io) could not be fetched in the verification pass (host
  not allowed in this session) and is unverified here.
- **Problems:**
  1. **Negative power tastes [high].** `jGam = gamma + 0.15 N(0,1)` (:141) is unclipped, so at the
     default gamma 0.25 about 4.8% of simulated judges score power *negatively*.
  2. **Too much noise [high].** Shared 0.05 x total plus individual 0.09 x (iA+iB) + 1 (:264, :268)
     gives about 30% split decisions and about 2% draws on neutral matchups, vs 17.6-20% (draws
     excluded) and 0.85% in the data.
  3. **10-8s need a knockdown gap [high].** `big` (:269) makes a 10-8 impossible for a dominant
     grappling round or a lopsided damage round without a KD. That contradicts the ABC criteria
     (damage, dominance, duration) that the page itself cites. The overall 10-8 frequency (about 4%
     of round cards) happens to match the data proxy (about 3.8% per round).
  4. **"Damage" is strike counts,** not the accumulated damage state the engine already tracks.
  5. **Judges never see attempts.**
- **Instead:**
  - Fit round-scoring weights on data. ufcstats has no per-round judge scores, but card totals
    constrain round winners: 30-27 means 3-0, 29-28 means 2-1. A likelihood over round-winner
    combinations works.
  - Calibrate shared and individual noise to the UD/SD/MD split, the draw rate and the 10-8
    frequency.
  - Clip tastes. Spec ✓ (logistic fit, calibrated noise). Spec gap: the card-total likelihood
    method, since per-round scores aren't in the data.

### 1.11 Corner stoppage (P2)
- **Where:** engine2.js:278-288: `ps = clip((dH-100)/400, 0, 0.3) + 0.06 x (KD taken - 1)`.
- **Problem:** uncalibrated. It gives 1.4% corner stoppages in Volk vs Gaethje. Data: KO/TKO at
  exactly 5:00 is 1.0% of KO/TKOs, and doctor stoppages are 0.74% of all fights since 2015
  **[high]**. Some doctor stoppages are between rounds; the dataset doesn't separate corner from
  doctor cleanly.
- **Instead:** a hazard calibrated to those base rates, with a doctor (cut) path. Spec ✓.

### 1.12 Fixed five rounds (P1)
- **Where:** engine2.js:143, :147, :172, :278 hard-code 5 x 300 s.
- **Problem:** three-round fights can't be simulated, so the 5,278 three-round fights can't be used
  for calibration and most matchups can't be run.
- **Instead:** `opts.rounds`. Spec ✓.

### 1.13 Trace mode changes the fight (P0 for reproducibility)
- **Where:** engine2.js:235 calls `rng.u()` *inside* `if (trace)` to pick a clinch initiator.
- **Effect [high]:** `simulate(seed, trace=true)` and `simulate(seed, trace=false)` differ in
  winner, method, round or time for **1,491 of 2,000 seeds**. The tally (trace off) and the cage
  fight (trace on) come from different random streams. You can't replay "fight #k of the tally".
- **Instead:** never draw from the engine RNG inside trace-only code; use a separate RNG for
  cosmetic choices. Spec ✓ (invariant listed); add it to the tests.

### 1.14 Form noise is too small and independent (P0)
- **Where:** engine2.js:16, :133-136: lognormal sds of 0.10 (output), 0.15 (power), 0.12 (chin),
  drawn independently per fighter.
- **Problems:** §0.4 shows night-to-night output variation of up to 0.53 log-sd and accuracy up to
  0.40 logit-sd. There is also no *parameter uncertainty*: Gaethje's 202 UFC minutes give a wide
  posterior that v2 treats as known. Real fights also share a pace factor (both fighters busy or
  both cautious).
- **Instead:**
  - Draw each fighter's skills from their shrinkage posterior once per simulated fight.
  - Draw night form for output, accuracy, power, chin, cardio and grappling.
  - Add a shared fight-pace factor.
  - Fit all sds in the walk-forward backtest (log loss on winner and method).
  - Spec ✓ for calibrated form sds. Spec gap: posterior skill draws and the shared pace factor.

### 1.15 Bookkeeping (P2)
- **[high]** throughout:
  - A finishing KD isn't counted in `st.kdA` (:223 breaks before the KD increment at :225), so
    simulated KD rates under-read against career KD rates.
  - Draws get method "UD"/"MD"/"SD" (:295), which works with `bucket()` but confuses consumers.
  - `fight.form` reports `chinA: 1/cA` (:144), so the HUD's form chip "chin +x%" means *sturdier*,
    while the "Volk's chin" knob above 1.00 means *easier to drop*. One word, two opposite
    directions in the same UI.

### 1.16 The backtest is in-sample (P0, it's on the page)
- **Where:** tests/test_engine2.js:55-90; page copy at page.src.html:465-476; HANDOFF.
- **Problems [high]:**
  - n = 7.
  - Career stats include the predicted fights (stated, but still leakage).
  - Volkanovski vs Lopes 1 and 2 use *identical inputs* (both 58%), so they aren't independent
    observations.
  - STRIKE_CAL was tuned on four of these fights, then the "15% RMS, 1% bias" strike error was
    reported on the same four.
  - Brier and log loss vs the market on 7 fights have no statistical power. The chat summary's "it
    scored a little better than the line" (CONVERSATION.md:84; the page itself shows the numbers with
    a caveat, page.src.html:476, app.js:296) isn't supported.
- **Instead:** walk-forward with frozen profiles, tune on 2019-2023, report on 2024+, with Elo and
  market baselines where lines exist. Spec ✓.

### 1.17 The model stack (P1, app.js:226-263)
- **Problems:**
  - The weights (market 40%, engine 40%, Elo 20%) are subjective.
  - The engine and Elo use overlapping information but are pooled as independent.
  - The market number is an opening line of unknown date for an unbooked fight (hard-coded 0.357,
    app.js:226 and page.src.html:413-415).
  - The Elo pair (1879 vs 1869) is hard-coded with no weight-class adjustment.
  - The "Fight engine v2" row plots `engineRaw` (draws count against Volk) while the blend uses
    `engine` (draws removed) (app.js:142, :236). They don't match.
  - **[high]** for the code facts. I did **not** re-verify the market or Elo values here; they come
    from v2's HANDOFF.
- **Instead:** fit stacking weights on the walk-forward set (log loss), label each input's date, and
  make the market input editable.

---

## 2. Generality: everything that blocks a new matchup

Each row needs to change before "any two fighters" works **[high, from code]**.

| File:line | Hard-coded item | v3 replacement |
|---|---|---|
| engine2.js:34-37 | VOLK and GAETHJE stat literals plus hand-set `gnp`, `getUp`, `ctrl`, `subDef`, `drain`, `pace` | profiles from `data/derived/fighters.json`; derived ground and pace params |
| engine2.js:39-49 | knob names (`volkChin`, `gaeLeg`…) and presets | generic `adjA`/`adjB`; `data/scenarios.json` keyed by matchup |
| engine2.js:89-96, :306 | `volkGaethje()` and `VOLK`/`GAETHJE` exports | `matchup(profA, profB, opts)` only |
| engine2.js:143, :147, :172, :278 | 5 rounds of 300 s | `opts.rounds` |
| director.js:4-5 | `NAMES`, `SHORT`, `ACC` | from profiles (name, short name) and matchup accuracy |
| director.js:6-19 | per-fighter MOVES tables (jab/cross/hook mix, kicks, KD punches) | derive from data (target mix, position mix, leg share) plus style archetypes picked from stats |
| director.js:72-104 | text templates hard-code "his" | pronoun field per fighter (needed for women's divisions) |
| director.js:26 | sub names random regardless of position | sub names by position and grip |
| show3d.js:554-558 | SPECS A/B: height 1.68/1.80, build, skin, shorts, hair, beard | per-fighter appearance from `height_in`, `reach_in`, stance plus `data/overrides.json` (skin tone, hair, shorts) |
| show3d.js:564-566 | both actors orthodox (`stance = 1`) | stance from `ufc_fighter_tott.csv` (Orthodox, Southpaw, Switch) |
| show3d.js:648 | `power = b.who === "B" ? 1.15 : 0.95` (Gaethje hits harder in the animation) | from the matchup's power estimates |
| arena3d.js:44-46 | mat text "155" and "FIVE ROUNDS · MONTE CARLO" | from opts (weight, rounds) |
| arena3d.js:52 | mat band "VOLKANOVSKI · GAETHJE" | from fighter names |
| app.js:8 | NAMES / SHORT | profiles |
| app.js:21-31 | SLIDERS: Volk/Gaethje knobs with matchup-specific hint text | generic knob panel per corner; hints templated from data |
| app.js:63, :93, :507 | `E.volkGaethje(knobs)` in worker, fallback and cage fight | `E.matchup(rosterA, rosterB, opts)`; the worker needs the roster entries in its message |
| app.js:119-121, :131, :185-186, :195, :204, :219-221 | chart labels and aria text with names | templated |
| app.js:226, :238 | model stack: v1 0.574, Elo 1879/1869, market 0.357 | per-matchup inputs (Elo computed by the pipeline; market optional and dated) |
| app.js:273-281 | backtest rows and probabilities hard-coded (stale whenever the engine changes) | `data/derived/calibration.json` from the walk-forward run |
| app.js:311-314 | scouting stack bars with literal percentages | profiles |
| app.js:444, :450-455 | HUD copy ("Five rounds · 155 lb", "Cards for Volk", "…for Volkanovski") | templated; `onDecision` should name the winner (today it says "for Volkanovski" even when Gaethje wins) |
| page.src.html:1-3, :289-306 | title, meta description, masthead, corner cards, records, ages | templated from profiles; DOB-based ages |
| page.src.html:413-415 | market marker at `left:35.7%` and line copy | per matchup, optional |
| page.src.html:479-527, :565-597 | scouting table and narrative, method copy quoting Volk/Gaethje numbers, sources list | profile-driven tables; narrative only for curated matchups (overrides) |
| tests/test_engine2.js:42-53, :57-72 | presets and hand-entered backtest fighters | pipeline snapshots |
| tests/dev3d_live.html:23-36 | seed search tied to `volkGaethje` | generic |

A matchup picker (two searchable roster selects, filtered by division) belongs on the page once the
above is done.

---

## 3. Code quality, performance and bugs

### 3.1 show3d.js (1,031 lines)
- **Strikes don't reach (P0) [high].**
  - What happens: standing range is `1.68 + rnd*0.3` m pelvis to pelvis (:875). Lunges only
    subtract 0.16-0.32 m for punches and 0.3-0.68 m for kicks (:250-268, :895). Arm IK clamps to
    reach (rig3d.js:182), so the glove stops in the air.
  - Measured over a full five-round fight: punch gap median 0.758 m, p90 0.954 m, 100% over 15 cm
    (n=133). Kick gap median 0.539 m (n=62). Clinch strikes connect (median 1.1 cm). A verification
    rerun of measure.js gave 0.760 / 0.991 / 0.585 m with the same counts; the exact values move
    because the show draws from `Math.random`. Screenshot k09 shows a landed punch short of the
    face; c03 shows the standing range.
  - Fix: set range from the attacker's reach (shoulder offset + arm length + opponent head
    offset), roughly 0.9-1.1 m pelvis to pelvis for punches by my estimate **[med]**. Step in on the
    strike; snap the defender's head back on impact. Add a unit check that landed strikes come
    within about 5 cm.
- **The knockdown follow-up whiffs (P1) [high].** While someone is downed, `target = max(target,
  1.15)` (:896). So the two follow-up "hammer" strikes (:754-755, `lungeTo 0.55`) can never close
  the distance; the attacker swings at air above his own head (screenshot k03).
- **The show isn't deterministic (P1) [high].** `this.rnd = Math.random` (:577), random `phase`
  (:58), camera cut timing (:477) and shake (:517) use `Math.random`. A seed reproduces the engine
  fight but not the animation, so a visual bug can't be reproduced from a seed. Fix: a seeded RNG
  from `script.seed`.
- **Beats lag the clock (P1) [high].**
  - The fight clock always advances (:963). Beats wait on `canStart` (:633-643), with at most 6
    dispatches per frame (:965).
  - Measured max lag between a landed beat's engine time and the show clock: 6.2 fight-s at 5x and
    **201 fight-s at 30x**. At 30x the bug clock reaches 0:00 while the round's strikes are still
    queued. The takedown at engine t=95 s in seed 2443 was dispatched at 105.3 s.
  - Fix: slow or stop the show clock when the queue backs up (time warp), or batch-resolve beats
    (count without animating) above a speed threshold.
- **The referee clutters and clips (P1) [high, screenshots].** `updateRef` (:921-935) keeps the
  referee 1.9-2.4 m from the pair on the side *away* from the camera, so he sits right behind the
  fighters in most shots (c02, c04, k01 overlap, c11 foreground). No collision avoidance.
- **Fighters interpenetrate** in the clinch, the shot and the sprawl (k05). No capsule push-out.
- **Decision ceremony (P1) [high].** Fighters at x = ±0.75 m with the referee at 0 (:849). The
  "ring" camera orbits (:506) and can frame them from behind, and the end-of-round card covers them
  (d02).
- **Camera occlusion (P1) [high].** The "high" camera at (0, 11.5, 9.5) (:505) looks through the
  overhead truss, so a black beam crosses the top of the intro and break shots (c01, k08). The
  "wide" camera can put the top rail across the fighters' torsos (c04). There's no occlusion test
  against the fence, truss or referee.
- **Dead and no-op code (P2) [high]:**
  - `tw = (cond ? 1 : 1) * d.twist` and `dirSign = cond ? 1 : 1` (:309-310).
  - `type: b.fin ? "gnp" : "gnp"` (:660); `onDone: fin ? null : null` (:691).
  - `lastHit` is written (:420) and never read.
- **Monolith (P2).** One IIFE mixes choreography, pose library, camera director, replay buffer and
  scheduler, with dense single-letter pose fields (`hl`, `hpl`, `hw`, `hwk`, `hwp`, `fp`, `fpole`)
  and magic numbers throughout. v3 should split it into pose library, choreographer (beats to
  actions), camera director and replay.
- **Allocations (P2).** `new V3()` at 15 sites, mostly per event. `due`/`keep` arrays are rebuilt
  every frame while timers exist (:951-953). Negligible: show logic measured 0.09-0.11 ms per frame
  with rendering stubbed.
- **Replay buffer (P2).** 420 frames regardless of frame rate (:525): 7 s at 60 fps, 14 s at 30 fps.
  The replay windows (-1.6 s to +0.9 s) fit, but a fixed-duration buffer would be more robust.

### 3.2 rig3d.js
- **Rig.STRIDE = 16*7 (:213)** must stay in sync with `this.nodes` (:131-133) by hand. Use
  `this.nodes.length * 7` (P2) **[high]**.
- **About 38 separate meshes per fighter rig and about 32 for the referee** (count of `add`/`ell`/
  `cap` calls, :71-127), each a draw call plus a shadow draw. Measured `renderer.info.render`: 102-170
  calls and about 262-273k triangles per frame at 786x442 **[high]**. By my seat-count arithmetic,
  the instanced crowd (about 1,400 lathe pawns x 176 triangles) makes up about 90% of the triangles
  **[med]**. One skinned mesh per fighter would cut calls to about 3-6 and remove joint gaps.
- **Materials:** one MeshStandardMaterial per part type (:30-50). No normal or roughness maps, no
  clearcoat (sweat), no subsurface approximation.

### 3.3 arena3d.js
- **Unused light [high].** `crowdLight` intensity 0, never changed (:220).
- **The crowd is lit by the cage lights.** Hemisphere 0.42 plus two directional fills plus rim
  points (:97-110), and the fog starts at 15 m (:92) while the crowd sits 7.4-17.5 m out (:195-196).
  The stands render as bright as the fighters.
- **Mat texture is 1024² over about 9.3 m** (:115-116), about 110 px/m. Lettering blurs in
  close-ups. `repaintMat` repaints the whole canvas when the font loads.
- **Chain-link fence** is an alpha-tested canvas texture (:66-78, :142-143) that shimmers and moirés
  at distance (c04 foreground).
- **Hard-coded mat text** (§2).
- **Fine as is:** octagon geometry and corner math (:7-9) and the camera-flash Points (:223-253).

### 3.4 director.js
- **Moves, misses and commentary are matchup-specific** (§2, §1.2).
- **Leg-kick finishes always become "calf"** (:63).
- **Combination text** (:79-84) only triggers on three landed strikes within 2.2 s. Fine.
- **Submission names are random from a list of four** (:101), regardless of position.
- **"Up" events** credit the correct (bottom) fighter. OK.
- **Two RNGs.** The director uses its own mulberry32 seeded from `seed ^ 0x5bd1e995` (:28-31, :47),
  so its choices are deterministic. Good, but it's a separate generator from the engine's sfc32
  (engine2.js:98-120). Document both or share one.

### 3.5 app.js
- **HUD control comes from the animation (P1) [high].** `cur.ctrl` grows while the *animated* state
  is "ground" (:437), not from engine `st.ctrlA`. Seed 2443 R1: HUD 0:26 vs engine 37.6 s (what the
  judges scored).
- **Overlays use wall-clock timers (P2) [high].** Toasts and round cards hide on `setTimeout`
  (:405-413), independent of show speed, pause or slow motion. A paused show still clears its toast.
- **Copy errors:** `onDecision` says "…for Volkanovski" whatever the result (:455). `onRoundEnd`
  says "Cards for Volk" (:450) (P2).
- **Model stack inconsistency** (§1.17) (P2).
- **Diagram label collision (P2) [high, screenshot p01_part3].** "clinch: about 0.45 a minute"
  (:329, x=140) runs into the "On the ground" box (:339), so it renders "…0.45 a minut".
- **What's done well:** the worker is built from the engine script's text (:82-91) with chunking,
  cancellation (`cur = d.id`) and a main-thread fallback, plus a text-only `TextShow` when there's
  no WebGL (:474-493). Keep these in v3.
- **Accessibility (P2):** the play-by-play is `aria-live="polite"` (page.src.html:386). At 10-30x
  it floods screen readers; throttle to big moments.

### 3.6 page.src.html and build.py (v2)
- **three.js r128 from cdnjs** (page.src.html:606). It's old: no CapsuleGeometry, legacy
  color-management API. A newer three.js would help, but which versions the allowlisted CDNs host,
  and whether newer releases still ship a non-module build, are **unverified in this audit (search
  budget exhausted) [low]**. If v3 moves to ES modules (`<script type="module">` with jsdelivr),
  the blob-worker trick still works because the engine has no three.js dependency.
- **Layout:** stage `aspect-ratio` 4:3 below 700 px and 16:9 above (:99-100). Fine, but on phones
  the fighters are only about 100-110 px tall in mid and clinch shots (m01, p02_part0), and wide
  shots would put them near 60 px by scaling from the desktop wide shot (corrected from "about
  70 px").
- **v2 build.py** is minimal and correct (guards against `</script` and duplicate placeholders).

### 3.7 tests/
- **test_engine2.js has no assertions.** It prints numbers, so nothing fails when the engine
  regresses. The backtest is in-sample (§1.16). No invariant tests: determinism, trace parity
  (violated, §1.13), corner swap, clone 50%, knob directions. Spec ✓ lists all of these.
- **func_check.py writes preview.html into the project root** (:21-22; gitignored) and asserts
  nothing.
- **shots.py and the dev3d pages** are useful visual harnesses. Keep them, retargeted to v3.

### 3.8 legacy/
- **v1 (volk_gaethje_sim.py, engine_v1.js)** is a round-level Poisson model with the same averaging
  flaw (`lamV = (slpm + sapm)/2`). It also averages takedown success (`pTDV = (tdacc + 1 - tddef)/2`),
  which v2 fixed with log5. It's a reference only; nothing in v3 should depend on it.
  `test_engine_v1.js` checks the JS port against Python within 0.3 pt. Fine as an archive.

---

## 4. Visual-quality assessment

**Rendered with:** headless Chromium with SwiftShader WebGL, `deviceScaleFactor` 1. Page at
1280x900 (stage 786x442) and 390x844 (stage 358x268). Fight seeds chosen deterministically by
patching `crypto.getRandomValues`: 2443 (round-1 clinch, KD and takedown, round-2 Volk KO) and 8
(five-round Volk decision). Fast-forwarded with `show.frame(1/30)` and rendering stubbed, then one
real frame per screenshot.

**Harness caveat [high].** Toasts and round cards that stay up in some screenshots ("ROCKED ·
VOLK", "ROUND 2", "IT'S OVER") are harness artifacts: those overlays use wall-clock timers, and the
fast-forward doesn't advance wall time. The camera chip text is also stale because I disabled the
app's rAF loop. Neither counts against the design. The 390 px full-page capture also stitched part
of the page twice (a Playwright mobile full-page artifact); `scrollWidth` was 390, so there's no
horizontal scroll.

### 4.1 What looks amateurish (by category, with screenshots)

**Character models (worst) [high]**
- Fighters are stacks of ellipsoids and lathe capsules (rig3d.js:71-127) and read as wooden artist's
  mannequins or ball-jointed dolls. Elbow and knee joints show visible gaps and seams (c06, k04, k10).
- Faces are featureless eggs with a nose bump; hair is a hemisphere cap and the beard a dark blob
  (c03, c06).
- Gloves are black spheres. Shorts flare like a skirt (c06). Feet are flat ellipsoids.
- Both fighters share nearly the same skin tone (0xd9a383 vs 0xd59a7c) and build (1.07 vs 1.0); shorts
  color is the main tell, helped a little by height (1.68 vs 1.80 m), hair color and Volk's beard
  blob (show3d.js:555-556).
- The referee is the same mannequin in gray: a segmented, "Michelin-man" torso with bare
  ball-joint shoulders (k10, c11).

**Animation [high]**
- At distance, strikes never touch the target (§3.1; k09, c03). This alone breaks credibility.
- Knockdown follow-up strikes swing at air (k03).
- Shot and sprawl interpenetrate (k05). The clinch reads vaguely, with arms clipping torsos (k01).
- The ground position is ambiguous: the "closed guard" pose has the top fighter kneeling beside
  the hips rather than inside the guard (k06, k07).
- Celebrations are stick-straight arms (c11, k10). Footwork is a slow orbit at constant range with
  no feints, level changes, stance switches (Volk's trademark per the scouting notes) or retreats.

**Materials and lighting [high]**
- The canvas is blown-out near-white with no fabric texture, logos or edge falloff (c02, k06).
- Skin is matte plastic with no sweat sheen. No environment reflections.
- Lighting is flat and high-key: the crowd is as bright as the cage, so there's no figure-ground
  separation. The red and blue corner posts glow like neon pillars, and the colored corner
  triangles on the mat look like UI decals (c01, c05, c11).

**Environment [high]**
- The crowd is about 1,400 identical lathe "pawns" in tidy rows, too bright and too close. From
  above, they read as bowling pins (k08). They don't move except for camera flashes.
- No cage-side tables, officials, cornermen, cameras, screens, walkway or LED ring.
- Posts are bare cylinders. The chain-link moirés. The overhead "lamps" are white boxes with no
  light cones.

**Camera [high]**
- Shot selection is reasonable (wide, mid, cage-side, overhead for the ground, replays).
- Framing problems:
  - The overhead truss crosses the high shot (c01, k08).
  - The top rail cuts across the fighters in wide shots (c04).
  - The referee sits in the background of most shots and in the foreground of the result shot (c11).
  - The decision ceremony is framed from behind (d02).
  - Ground and overhead shots leave the fighters at about 20% of frame height (k06, k07).
  - On phones the fighters are about 100-110 px tall in mid and clinch shots (m01) and smaller in
    wide shots: the stage is small, and `narrow` *widens* the FOV on top of that
    (show3d.js:495-507).

**HUD and overlays [med]**
- The score bug, play-by-play, meters and cards are clean and legible (p01_part0).
- They're data-dashboard styled rather than broadcast styled: no lower thirds, no stat cards
  between rounds, no tale of the tape.
- The "Gas tank" meter barely moves (§1.6). Round and decision cards cover the action center frame
  (k08, d02).

**Page layout [med]**
- A light SaaS-dashboard page with a dark video well. The 3D feed is about 60% of the content
  width at 1280 and doesn't feel like the hero.
- "How the engine works" leaves the right 45% of the panel empty at 1280 (p01_part3), and the
  diagram label collides (§3.5).
- The masthead type is strong. At 390, the deck controls wrap into three rows and the stage is
  small, but nothing overflows (p02_part0).

### 4.2 What would most improve it, in order of impact per effort

1. **Make contact real (small effort, huge payoff).** Range from reach, step-in lunges, head snap on
   impact, and a test that landed strikes come within about 5 cm. Fix the post-KD distance floor so
   follow-ups land.
2. **Replace the primitive rigs with a skinned humanoid (GLB) and an animation set.**
   - One base mesh, scaled per fighter from height and reach, with skin tone, hair, beard and
     shorts color from overrides.
   - Keep the figures generic, not likenesses (the footer already says "stylized figures, not
     likenesses"; keep it that way to avoid impersonation).
   - Drive it with clips (stance idle and footwork, jab, cross, hooks, uppercut, overhand, body
     shots, round, calf and head kicks, knees, double-leg, sprawl, guard and half and mount and
     back poses, ground strikes, KO falls, stand-up, celebration). Layer the existing IK on top
     for aim and contact.
   - Embed it as a compressed data URI; the page limit is 16 MB. Candidate CC0 sources include
     Quaternius characters and Poly Haven / ambientCG materials and HDRIs, but **licenses were not
     re-verified in this run; check each asset's license before embedding [low].** Mixamo
     redistribution terms are uncertain; avoid embedding Mixamo files unless verified **[low]**.
3. **Light it like a fight broadcast.**
   - Strong overhead key with a falloff vignette on the canvas; separate dark lighting for the
     crowd (exclude it from the key via layers or darker materials; earlier fog).
   - An environment map for specular on skin and gloves; clearcoat sweat.
   - Softer colored rims; no neon posts.
   - Optional post-processing: bloom on lamps, vignette, slight depth of field on replays.
4. **Environment set dressing.**
   - A 2-4K canvas texture with generic Octagon-style center branding and fabric normal map.
   - Padded black posts and a gloss top rail; a mipmapped or geometric fence that fades with
     distance.
   - Cage door, officials' tables, cornermen at the breaks, a crowd of billboard impostors with
     varied silhouettes, darker values and pops on big moments, and screens.
5. **Broadcast camera language.**
   - A main elevated hard camera outside the cage at a fixed bearing; two handheld cage-side
     cameras shooting through the fence with the fence soft.
   - Overhead only for the ground, framed tight.
   - Occlusion checks against the rail, truss and referee; referee kept off-axis.
   - Reaction close-ups after knockdowns; a decision shot from the front.
   - On narrow screens, frame by fighter separation instead of widening the FOV.
6. **Animation logic.** Footwork with angles, feints and stance switches from style data; clinch
   pinning on the fence; real ground positions with transitions; capsule collision push-out;
   referee step-in and wave-off choreography.
7. **HUD and layout.**
   - Broadcast lower thirds; between-round stat cards from *engine* totals; overlays timed on the
     show clock.
   - A full-bleed dark hero for the cage with a matchup picker; a tale of the tape from profiles.
   - Fix the diagram and the empty half-panel.

---

## 5. How this audit maps onto docs/ENGINE_V3_SPEC.md

The spec already covers most engine items (sections 1.1-1.5, 1.7, 1.9-1.13, 1.16). Gaps worth
adding to the spec:

1. **Measured defaults:** shrinkage k ≈ 30 min for rates, ≈ 150 attempts for accuracy (not swept),
   ≈ 300 head strikes for KD power x chin (100-300 for power alone); half-life 730 days. The rate k
   and half-life were best of a 5 x 4 grid in the verification sweep (§0.2), with a shallow optimum.
2. **A league hazard-curve target** for the league-vs-league test (5 rds: .207/.204/.171/.110/.109;
   3 rds: .254/.213/.139), plus KD conversion targets (.56 / .67) and the 27.6% share of KO/TKO
   without a KD.
3. **Between-round damage recovery** (v2 has none; it's the main cause of the inverted hazard).
4. **Posterior skill draws per simulated fight and a shared fight-pace factor,** in addition to
   night form. Form-sd upper bounds: §0.4.
5. **Judging fit from card totals,** because ufcstats has no per-round judge scores. Calibration
   targets (five-round, draws excluded): UD/SD/MD .80/.18/.03, draws 0.85-0.87% of fights, 10-8
   per round about 4%.
6. **A seeded show RNG** (`script.seed`) so animation and camera are reproducible.
7. **Contact geometry:** fighting range derived from reach; a landed-strike contact test.
8. **HUD stats from engine totals,** never from animation state; show clock time-warp when beats back up.
9. **Pronoun field** per fighter for commentary templates.
10. **Pipeline data quirks** (next section).

---

## 6. Data pipeline notes (for tools/build_db.py)

All **[high]**:

- **Event names don't always match** between `ufc_fight_results.csv` and `ufc_event_details.csv`.
  Results say "UFC Fight Night: Lopes vs. Silva" and "UFC Fight Night: Grasso vs. Shevchenko 2";
  the event file says "Noche UFC: …". "UFC - Road to UFC 4.6" is missing from the event file.
  Without an alias map, 27 result rows (124 stat rows) get no date.
- **One duplicate bout:** "UFC - Ultimate Japan", Sakuraba vs Silveira, appears as both W/L and
  NC/NC.
- **pandas 3.0.5 is installed,** and string columns use the `str` dtype, not `object`. Strip with a
  non-numeric check, not `dtype == object`.
- **The per-round sum of `secs` over both fighters is twice the fight time.** Easy to double count.
- **CTRL is "--" in older fights;** treat it as missing, not zero.
- **ufcstats CTRL counts clinch control as well as ground control** (the spec notes this).
- **TD attempts aren't split by position;** clinch-vs-distance takedown rates need a fitted
  multiplier.

---

## Reproduce

All scripts are in `/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/audit/`.
Python scripts run with `python3 -I`.

| Script | What it does |
|---|---|
| `load.py`, `build_rounds.py` | Tidy round table with opponent columns (`rounds.pkl`, `res.pkl`) |
| `fighters.py` | Volk and Gaethje career, recent and per-round tables (§0.5) |
| `league.py`, `league2.py` | League base rates, KD conversion, finish hazards, decisions, 10-8 proxy, pace (§0.1) |
| `combo.py` | Walk-forward strike-rate formula comparison and overdispersion (§0.2, §0.4) |
| `chin.py` | Walk-forward KD power and chin test (§0.3) |
| `vg.py` | Decayed, shrunk Volk and Gaethje power, chin and rates |
| `v2stats.js`, `parity.js` | v2 KD conversion, 10-8, decision split, hazard; trace parity; negative judge tastes; Gaethje sub zero |
| `v2/` | v2 page rebuilt from commit e95a852 (identical to the committed page) |
| `preview_v2.html` | Wrapped page using `file:///home/user/XX/vendor/three.min.js` |
| `shoot.js`, `shoot2.js` | Cage and full-page screenshots |
| `measure.js` | Strike contact-gap measurement |
| `hudctrl.js`, `hudctrl2.js` | Beat-lag measurement and HUD control check |

Key screenshots:

| Moment | Files |
|---|---|
| Contact sheet | `contact_sheet.png` |
| Live exchanges | `c02_live_wide.png`, `c03_live_mid_or_cage.png`, `k09_finish_fall.png` |
| Clinch | `k01_clinch.png` (`c04_clinch.png` is named for the clinch but shows the pair apart; it is the top-rail framing example) |
| Knockdown | `k02_knockdown_fall.png`, `k03_kd_followup.png`, `k04_kd_replay.png` |
| Takedown and ground | `k05_shoot.png`, `k06_ground.png`, `k07_ground_gnp.png` |
| Break, finish, result | `k08_corner_break.png`, `k10_finish_ref.png`, `c11_result.png` |
| Decision | `d02_decision_raise.png` |
| Camera modes | `c12_cam_cageside.png`, `c13_cam_overhead.png`, `c14_cam_free.png` |
| Phone stage | `m01_stage_390.png` |
| Full pages | `p01_full_1280.png` (and `p01_part0-3.png`), `p02_full_390.png` (and parts) |

---

## Verification log

Adversarial fact-check, Friday, Nov 6, 2026. Every key claim was re-derived independently where
possible (my own pandas loaders on `data/raw/`, my own engine probes) rather than by re-reading the
audit's scripts; where only the audit's scripts could measure something (walk-forward, chin, 3D), I
read them for leakage and bugs and re-ran them. All 14 screenshots on the contact sheet plus m01,
p01_part0, p01_part3 and p02_part0 were inspected directly. Probe scripts are in
`/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad/verify/`
(`base.py`, `v2.py`-`v6.py`, `sim.js`, `disp.js`, `ksweep.py`, `eng_nodmg.js`). Nothing under
`src/`, `tests/` or `legacy/` was modified, and no git history was changed.

### Verdicts on the key claims

| # | Claim | Verdict | Notes |
|---|---|---|---|
| 1 | 574 five-round fights, 58.5% finishes, by round 20.7/16.2/10.8/5.7/5.1, hazard .207/.204/.171/.110/.109 | Confirmed | Independent loader (Noche UFC alias, NC excluded, duplicate dropped) reproduces every figure. Interpretation softened: the level gap is the hard evidence; the falling shape is partly heterogeneity. |
| 2 | v2 league clone 36.2% finishes (28.6/7.6/61.6, draw 2.2), hazard .063 to .106; Volk vs Gaethje .076 to .185 | Confirmed | 40,000-sim reruns: 36.5% and 36.9% (two seeds), hazard .066-.068 to .107-.108; Volk vs Gaethje 49.75%, .076 to .185. Mechanism confirmed: removing damage feedback flattens the hazard (§0.1). |
| 3 | 57.0% KD-round conversion (56.0 / 67.0, n=2,361); v2 converts 35-40% | Corrected | Data figures confirmed exactly. The v2 figure was per KD *event*; measured per KD-round like the data, v2 is 37% (clone) to 43% (Volk vs Gaethje). Conclusion unchanged. |
| 4 | 27.6% of 1,858 KO/TKOs had no winner KD in the finishing round | Confirmed | 1,858 of 1,858 winner rows matched by name. |
| 5 | Walk-forward 5,878 fight-sides: v2 formula -18.3%, deviance 13.89; shrunk decayed multiplicative 11.59, -0.8% | Confirmed | combo.py re-run reproduces every table cell; no look-ahead in the cumulative or decayed sums (league constants use all 2012+ data, a negligible leak). Added: k and half-life were not tuned by the audit; my sweep finds 30 min / 730 d best of a 5 x 4 grid. |
| 6 | Chin cuts KD deviance 9,027 to 8,845 at k=300; 300 beats 100/600/1000 | Confirmed, with a correction | Numbers reproduce. "300 is best" holds for power x chin only; for power alone (v2's structure) 100 edges 300. "Chin adds about as much as power" corrected to about two-thirds. |
| 7 | Landed log residual sd 0.583, Poisson 0.146, extra 0.565; attempts 0.533; accuracy 0.401; v2 FORM_OUT 0.10 | Confirmed | Re-run reproduces. Added a like-for-like check: v2's own simulated extra sd is about 0.12. |
| 8 | engine2.js:235 draws `rng.u()` only under trace; 1,491 of 2,000 seeds differ | Confirmed | Code read and parity.js re-run: 1,491. |
| 9 | 133 landed distance punches stop a median 0.758 m short (p90 0.954), kicks 0.539, clinch about 1 cm | Confirmed (values vary by run) | Rerun: 0.760 / 0.991 / 0.585 m, clinch 1.1 cm, pelvis distance 1.65 m. Code at show3d.js:875, :895-896 and rig3d.js:182 matches. The show uses `Math.random`, so exact values move. |
| 10 | HUD control from animation (app.js:437); seed 2443 R1 HUD 0:26 vs engine 37.6 s | Confirmed | hudctrl2.js rerun shows 0:26; my engine run gives ctrlA 37.6 s (takedown at 95 s, up at 133 s). |
| 11 | Beat lag up to 201 fight-s at 30x, 6.2 at 5x | Confirmed | hudctrl.js rerun: 201.2 and 6.2. Those two runs use the seeds after 2443 in the patched list, not 2443. The "takedown at 95 s dispatched at 105.3 s" detail was not re-measured. |
| 12 | Decisions UD 78.2 / SD 18.5 / MD 3.4, draws 0.87%; v2 about 30% SD, 1.4-2.2% draws; 4.8% negative judge tastes | Corrected | The data split counted the 5 draws (3 split, 2 majority) as SD/MD while v2's excluded draws. Like-for-like: 79.8 / 17.6 / 2.6 (n=233). v2: SD 28.8% (Volk vs Gaethje), 29.8-30.4% (clone); draws 1.44% / 2.2%. Negative tastes: P(Z < -1.667) = 4.78%, confirmed. |
| 13 | v2 career stats match ufcstats exactly; Gaethje leg share 22.9% not 28%; 6.2% vs Pimblett | Corrected | Volk 312.9 min and 19 fights, Gaethje 202.2 min and 16 fights confirmed; Volk's rates differ by 0.01-0.02 (5.99/3.31 vs 5.98/3.33), so "within rounding", not "exactly". The leg-share point misread the hint: it describes distance strikes, where ufcstats gives 27.3% career and 8.8% vs Pimblett. |
| 14 | build.py at HEAD (eeb164e) fails on src/params3.js; v2 rebuilt from e95a852 is byte-identical | Confirmed, commit updated | HEAD is now e59bc48 (same build.py); `python3 build.py <scratch path>` still raises FileNotFoundError for src/params3.js. My own `git archive e95a852` rebuild is byte-identical (`cmp`) to both the committed and working-tree page. |

### Other corrections made in the body

- TL;DR #8 and §1.16: the "scored a little better than the line" quote is from CONVERSATION.md:84,
  not the page; the page shows the numbers with a caveat.
- TL;DR #4 and §1.5: defender KD susceptibility also enters via Gaethje's `mileage` knob (`durB`)
  and random night form.
- §1.5: body-strike KO/TKOs are about 5% (101 of 1,858), not about 3%.
- §1.6: stamina's output effect peaks at about 2-3%, not about 1%.
- §1.9: submission conversion is 22% times the defender's `subDef`, not identical for everyone.
- §1.10: the O'Connell "consistency" is by construction (v2's weights came from HANDOFF's summary)
  and the source was not reachable here **[low]**.
- §1.12 and §2: the 5 x 300 s hard-coding is at engine2.js:143, :147, :172, :278 (line 290 is not
  part of it).
- §4.1 and §3.6: phone-stage fighters are about 100-110 px tall in mid and clinch shots, not about
  70 px; skin and build are near-identical but height, hair and beard also differ.
- §5: calibration targets restated with draws excluded; shrinkage defaults described as swept for
  rates only.

### Visual assessment check

Confirmed from the images: landed punch visibly short (k09); knockdown follow-up winding up far from
the downed fighter (k03); shot and sprawl overlap (k05); ambiguous ground position (k06, k07); truss
across the high shot (c01, k08); top rail across the fighters (c04); referee in the background of
most shots and in the foreground of the result (c02, k01, c11); round and decision cards over the
action (d02, k08); stick-straight celebration arms (c11, k10); segmented referee torso (k10, c11);
featureless faces, hair caps, beard blob and black-sphere gloves (c06); crowd of identical pawns
(c01, k08); diagram label clipped to "0.45 a minut" and the empty right half of the panel
(p01_part3); deck controls wrapping at 390 px with no overflow (p02_part0). Toast and card
persistence is a harness artifact, as the audit says. "Framed from behind" in d02 is plausible but
hard to confirm because the faces have no features. The interpenetration in k05 is likely but
partly occluded.

### Important flaws the audit missed (added to the body where noted)

1. **Target splits applied to the wrong denominator** (added to §0.5). v2 applies all-strike target
   shares to distance strikes only, which understates leg kicks at distance (Volk .26 vs .316).
2. **Baseline knobs override data** (added to §0.5): Volk's TD attempts 3.0 per 15 vs 4.75 in the
   data, Gaethje's 1.5 vs 1.11, leg share 0.18, plus the power, output and chin "tax". These are
   labeled judgments, but none is fitted.
3. **KD definition for calibration** (added to §1.5): ufcstats counts the finishing KD, and 70% of
   KD rounds are the fight's last round, so v3 has to count KDs the same way for the 0.56 / 0.67
   targets to mean anything.
4. **Bottom-position and scramble submissions don't exist** (added to §1.9).
5. **Fake misses are fewer than stated** (added to §1.2), because they only cover distance strikes,
   where accuracy is lower.
6. **Judges' power credit uses career power (`m.wA`, engine2.js:266), not the night's power form
   `qA`**, so a fighter with a big power night is not scored as harder-hitting. Minor.
7. **Working-tree note:** `src/page.src.html` has an uncommitted 24-line change (v3 script and JSON
   placeholders) relative to HEAD. The audit's page line numbers refer to e95a852 and still line up,
   because the insertions come after line 606.

### Not verified

- Market (0.357) and Elo (1879 vs 1869) inputs, which come from v2's HANDOFF. The arithmetic
  -200 / +170 to 35.7% after removing the margin checks out.
- Asset licenses (Quaternius, Poly Haven, ambientCG, Mixamo) and newer three.js builds on the
  allowed CDNs. The audit already marks these [low]. The session's web-search budget was exhausted
  and oconnellryan.github.io is not reachable from this session.
- Crowd seat count (about 1,400) behind the "90% of triangles" estimate; only the arithmetic was
  checked.
