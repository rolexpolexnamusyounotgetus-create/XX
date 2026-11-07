# Era drift and league-level tracking (task key: eradrift)

Nov 7, 2026, about 1:10 am UTC. Tool: `tools/eradrift.py`. Output: `data/derived/eradrift.json` (walk-forward levels by
month 2012-01..2026-01, current levels, candidate offsets, single-look results). Evaluator: `src/ml/eradrift.js`, checked
by `tests/test_eradrift.js` (2,283 checks against the export's test vectors). Blind-test plugin:
`tools/blindtest_plugins/eradrift.py` (`eradrift_m2`, `eradrift_static`, both experimental). Pre-registration:
`data/derived/eradrift_prereg.json`, commit 53ca073 at 00:53:16 UTC; the single 2024-25 look ran at 00:53:19-00:53:30
and wrote a lock file. Caches: `out/eradrift_cache/` (gitignored). Every number below is printed by
`python3 tools/eradrift.py summary` (it reads the JSON and refits nothing). Section 5 is the only table read after the
look, and it is descriptive.

Protocol (docs/BACKLOG.md; docs/V6_V10_PLAN.md sections 5-6):
- Fights dated 2026-01-01 or later are dropped at parse: `build_db.parse_fights` is wrapped by tools/ml2.py, and every
  stage asserts it. The keyed inputs (statlines_oof.json, the S2 fold predictions) are read for dates before
  2026-01-01 only. No 2026 row was collected, so nothing went to the vault.
- Every choice was made by rolling-origin or forward-chained CV inside 2012-2023: tracker family, half-life, Kalman
  variances, division and format scopes, breaks, which splits and stats are adjusted at all.
  - The method adjustment also had to pass the stack-style gate: nested forward-chained 2021-2023 with tools/ml2.py's
    0.0005 rule.
  - 2024-01-01..2025-12-31 was scored once, after the committed pre-registration.
- Corner symmetry:
  - No tracker reads the corner.
  - The method offsets act the same way on both winners' decision-vs-finish, KO-vs-SUB and round-1 splits, and
    P(A wins) is ML v2's and is never changed.
  - Python asserts mirror(adjust(swap)) = adjust to 2.5e-16 on every row. The JS test asserts it again (1e-12), plus
    the six-class P(A) invariance.
- Brackets are 95% card-cluster bootstrap CIs (2,000 resamples), paired for differences. Statline rows are clustered
  by fight date, because the OOF file carries no card id.

## Bottom line

1. **League stat levels are worth tracking; the outcome mix is not (before 2024).** Rolling-origin CV 2012-2023, with
   the config chosen on 2012..Y and scored on Y+1, against methodround's own 5-year calendar window with the same
   division layer:
   - **The trackers win on every stat level:**

     | stat | nested gain per fight vs the 5-year window |
     |---|---|
     | sig landed per minute | -0.044 [-0.055, -0.032] |
     | sig attempted | -0.012 [-0.017, -0.007] |
     | control | -0.010 [-0.018, -0.003] |
     | TD attempts | -0.006 [-0.010, -0.002] |
     | sub attempts | -0.004 [-0.008, -0.0002] |
     | 10-8 share | -0.008 [-0.015, -0.001] |
     | KD per 100 head strikes | -0.0016 [-0.0031, -0.0002] |

   - **No tracker beats the 5-year window on the outcome mix**: decision, KO and SUB shares, UD/SD/MD, round-1 share
     of finishes, 3- vs 5-round decision share. The best nested results range from -0.0005 to +0.010, all n.s. or worse.
     Before 2024 the year-to-year swings in decision share (46.6-54.0% in the method universe) were noise around a
     slowly moving level.
2. **2024-25 (one look) confirms three trackers and contradicts none.**
   - **Confirmed vs the 5-year window:**
     - KO share -0.0042 [-0.0069, -0.0015];
     - KD per 100 head -0.0071 [-0.0137, -0.0010];
     - 10-8 share -0.035 [-0.055, -0.015]. Tracked 3.70 / 2.54 per 100 judged rounds vs actual 2.49 / 2.45; the
       5-year window says 5.53 / 4.51.
   - **Sig strike pace: n.s. and leaning worse**, +0.0066 [-0.0016, +0.0150]. The pace that rose from 3.06 to
     4.15 per fighter-minute over 2014-2023 fell to 3.98 in 2024 and 3.79 in 2025. The tracker (4.35 at Jan 1, 2024)
     sat near engine v4's level, so tracking alone would not have prevented the +9% sig-landed drift. The current
     tracked level (4.01, from Jan 1, 2026) does include the fall.
3. **Level-adjusting the production method model (S2 + ML v2 winner) fails the gate. Production is unchanged.**
   - **Gate result.** Nested forward-chained 2021-2023 (1,235 fights): 7-bin -0.00007 [-0.00167, +0.00144]; joint
     +0.00050 [-0.00151, +0.00246]. The model already carries a 5-year division prior and a year trend, and its
     decision-share residual has almost no year-to-year persistence.
   - **CV-final configuration.** It keeps only a round-1 shape tracker, which was +0.0022 [-0.0014, +0.0063] (joint)
     on 2024-25.
4. **The 2024-25 decision-share miss is the 2024 glove trial, not a persistent drift.** This is descriptive, read
   after the look, and selects nothing.
   - **Production missed.** It predicted 48.4% decisions in both years; the actual shares were 56.1% (2024) and
     52.0% (2025) in the method universe.
   - **League table by glove period:**

     | period | decisions | KO | KD per 100 head |
     |---|---|---|---|
     | new glove (Jun 1-Nov 15, 2024; announced Apr 12) | 59.4% [54.5, 64.6] | 23.1% | 0.54 |
     | Jan-May 2024 | 51.4% | 32.7% | 0.68 |
     | old gloves again from Feb 15, 2025 | 49.0% [44.5, 53.8] | 32.8% | 0.87 |

   - **The fast tracker helped.** The pre-registered descriptive candidate M2 (a 3-month half-life decision-vs-finish
     tracker on the model's own residuals) gained 7-bin -0.0055 [-0.0098, -0.0013] on 2024-25. It moved the predicted
     share to 51.5% and caught about 40% of the gap. It cannot be promoted: it failed the 0.0005 rule in CV (-0.00045
     pooled 2016-2023; better in 5 of 8 years), and the effect it caught was a dated equipment change that has since
     been reversed.
5. **Statline level offsets: two stats confirmed, two contradicted.** CV 2021-2023 adopted six per-stat mean
   offsets under statlines' own rule.
   - **Confirmed on 2024-25 (enabled in eradrift.js):** leg strikes attempted, -0.0015 [-0.0044, +0.0014], and
     landed, -0.0041 [-0.0079, -0.0003].
   - **Contradicted (withdrawn):** clinch attempted, +0.0036 [+0.0012, +0.0062], and clinch landed, +0.0026
     [+0.0003, +0.0050].
   - **Not confirmed (shipped off, monitored):** ground landed and TD attempts, both with a point estimate above 0.
   - **Unchanged:** sig landed, control, KD and sub attempts. No tracker beat "none" in CV, and their offsets are 0
     by construction.
   - **Caveat.** The layer overpredicts several stats in 2024-25 (sig landed 0.98 / 0.95, control 0.94 / 0.93, body
     landed 0.90 / 0.85 realised/predicted), but CV gave no warning: 2021-2023 ratios were about 1.00.
6. **For the v9 drift monitor** (section 7): keep the pre-registered winner drift rule (V6_V10_PLAN 6.5.1) exactly as
   it is until audit 1. Run a separate level channel:
   - engine league levels from this tool's chosen trackers;
   - documented, announced breaks treated as variance interventions, never as fitted tilts;
   - the method cells left static, with M2 scored as a forward-ledger side column;
   - alarms that call for a review, never an automatic tilt.

## 1. What was built

**League table.** Every UFC fight 2001-02-23..2025-12-13 with a 3- or 5-round format: 8,224 fights, all with ufcstats
per-fight totals, and 3,896 decisions with three cards. Built from `build_db.parse_fights` + `build_vectors` with the
vault wrapper. Targets (17), each a share (Bernoulli) or a rate with an exposure (NB2 with a method-of-moments shape
fit on pre-2012 fights):

| key | target | exposure / universe |
|---|---|---|
| dec, ko, sub | decision (incl. draw), KO/TKO (incl. doctor), submission share | fights with KO/SUB/DEC/draw (DQ/NC out) |
| dec3, dec5 | decision share by format | 3- / 5-round bouts |
| sd_dec, md_dec | split / majority decisions | UD+SD+MD decisions |
| r1_fin3, r1_fin5, late_fin3 | round-1 share of finishes (3 / 5 rounds), round-3 share (3 rounds) | finishes |
| kd100 | knockdowns | per head strike landed (both sides) |
| slpm, sapm | sig strikes landed / attempted | per fighter-minute |
| tdpm, subpm | takedown / submission attempts | per fighter-minute (shown x15) |
| ctrlpm | control seconds | per fighter-minute |
| r108 | card-implied 10-8 rounds (evalv.js definition: 19 x judged rounds - card sum) | per judged round |

**Tracker families** (each card predicted from fights on strictly earlier days):
- **static**: expanding mean since 2001.
- **win5**: the calendar window [Jan 1 of Y-5, Jan 1 of Y), as in methodround's division priors.
- **ew**: exponentially weighted, half-life 0.25-5 years.
- **kal**: a local-level Kalman filter on the logit or log scale, fit with an exact Laplace/EKF step per fight.
  - State: the league era level (random walk, q per year), plus division effects shrunk to the league (prior sd 0.15
    or 0.3, optional drift), plus a card-level event-noise state (sd 0 or 0.1) that is created and dropped with each
    card.
- **+div** (for static / win5 / ew): a slow division deviation (half-life 3 or 10 years) shrunk to the league by
  30 or 150 fights, added to the league level.
- **+brk**: documented structural breaks (below) as interventions:
  - Kalman: Var(level) += vb at the effective date;
  - EW: the fast sums are multiplied by (1 - phi).
  Each break moves only the targets fixed for it a priori, from what changed.

**Structural breaks.** Each break enters only from its effective date and was announced before it. Sources were
checked by web search on Nov 7, 2026. The cagesidepress.com, bloodyelbow.com and ufc.com pages could not be fetched
from this session, so those rows rest on search-result summaries (medium confidence). Dates agree across sources.

| key | effective (announced) | what | targets | sources |
|---|---|---|---|---|
| usada2015 | 2015-07-01 (Feb 2015) | UFC Anti-Doping Program run by USADA begins | KO/SUB/dec shares, KD, pace, grappling, round shape | usada.org first-round update; ABC7 Feb 2015 |
| rules2017 | 2017-01-01 (ABC vote Aug 2016) | Unified Rules judging criteria rewrite; 10-8 = dominance, damage/impact, duration | r108, SD, MD | Bloody Elbow Jan 2, 2017 interview; J. Sports Analytics (doi 10.3233/JSA-200478) |
| nofans2020 / fans2021 | 2020-03-14 / 2021-04-24 (announced Mar 16, 2021) | events without fans; full crowds back at UFC 261 | SD, MD, r108, decision shares | CBS Sports, Cageside Press (Mar 2021) |
| gloves2024 | 2024-06-01 (Apr 12, 2024) | redesigned UFC glove from UFC 302 | KO, decision, KD, pace, round shape | Sherdog Apr 12, 2024; Wikipedia UFC 302; CBS Sports |
| abcrules2024 | 2024-11-01 (ABC vote Jul 23, 2024) | 12-6 elbows legal, "grounded" redefined, where adopted | KO, KD, round shape | ESPN; CBS Sports; combatsportslaw.com Jan 31, 2024 |
| oldgloves2024 | 2024-11-16 (Nov 12, 2024) | old glove back from UFC 309 | as gloves2024 | Cageside Press Nov 13, 2024; ESPN |
| oldgloves2025 | 2025-02-15 (that broadcast) | old gloves for every fighter from UFC Vegas 102 | as gloves2024 | Bloody Elbow Feb 15, 2025; theScore |

Full URLs are in `BREAKS` (tools/eradrift.py) and in eradrift.json `meta.breaks`. Only usada2015, rules2017 and the two
crowd breaks fall inside the CV years, so CV could choose the intervention mechanism but never the size of a 2024 effect.

**Model-level trackers.** The same filters run on the production models' own out-of-fold residuals:
- **Method model.** S2 + ML v2 winner, rebuilt per annual fold 2014-2024 exactly as tools/ml2.py's method stage
  (reproduces ml2's CV 2020-2023 joint 2.14070 and 7-bin 1.60642 to the fifth decimal; the plugin's static bins equal
  tools/finishing.py's reproduction exactly on all 2,864 fights). Three logit offsets are tracked:
  - **fin**: P(finish | winner), applied to both winners, so P(A wins) is untouched;
  - **ko**: P(KO | finish, winner);
  - **r1**: P(round 1 | finish), by format.

  Grid:
  - EW: half-life 0.25-4 y, prior strength 50/200/800 fights, vintage weight rho 0/0.5/1 for residuals of an older
    fold model.
  - Kalman: q 0.005-0.08, event noise 0/0.1, rho, breaks vb 0.02/0.1.
  - Division and format scopes, with deviations shrunk to the league offset.

  Folds 2014-2015 only warm the trackers; CV years are 2016-2023.
- **Statlines layer.** Per-stat log offsets on the NB mean (logit offset on the control share), fit on
  statlines_oof.json fight-sides (2020 warms up; CV 2021-2023; folds fit on 2019..Y-1). Grid: EW and Kalman as above,
  with prior strength in fight-side equivalents.

## 2. League trackers: rolling-origin CV 2012-2023

Loss per observation. "nested" = the config chosen on 2012..Y and scored on Y+1 (2014-2023). The references carry the
same division layer, with the best division setting picked on the pooled CV, which favours the references.

| target | chosen (pooled CV) | CV chosen | CV win5+div | CV static+div | nested - win5+div [CI] | n |
|---|---|---|---|---|---|---|
| dec | win5+div(3,30) | 0.68340 | 0.68340 | 0.68548 | +0.00038 [-0.00053, +0.00130] | 5551 |
| ko | ew(h=5)+div(3,30) | 0.61142 | 0.61189 | 0.61156 | -0.00002 [-0.00108, +0.00105] | 5551 |
| sub | win5+div(3,150) | 0.47548 | 0.47548 | 0.47755 | +0.00106 [+0.00010, +0.00209] | 5551 |
| dec3 | win5+div(3,30) | 0.68428 | 0.68428 | 0.68665 | +0.00046 [-0.00049, +0.00141] | 5022 |
| dec5 | ew(h=1)+div(3,30)+brk(phi=0.5) | 0.65335 | 0.65362 | 0.66157 | +0.00290 [-0.00390, +0.01023] | 529 |
| sd_dec | win5+div(3,150) | 0.51728 | 0.51728 | 0.51788 | +0.00098 [-0.00085, +0.00290] | 2708 |
| md_dec | ew(h=5)+div(3,150)+brk(phi=0.5) | 0.08159 | 0.08180 | 0.08178 | +0.00127 [-0.00112, +0.00377] | 2708 |
| r1_fin3 | ew(h=2)+div(10,150)+brk(phi=0.8) | 0.69134 | 0.69308 | 0.69273 | -0.00053 [-0.00295, +0.00185] | 2477 |
| r1_fin5 | ew(h=0.25)+div(3,30)+brk(phi=0.8) | 0.66586 | 0.67961 | 0.66833 | +0.00972 [-0.00507, +0.02422] | 322 |
| late_fin3 | ew(h=2)+div(10,150) | 0.43900 | 0.43967 | 0.44047 | +0.00135 [-0.00066, +0.00344] | 2477 |
| kd100 | ew(h=5)+div(10,30) | 1.01120 | 1.01293 | 1.01220 | -0.00155 [-0.00306, -0.00018] | 5602 |
| slpm | kal(q=0.002,se=0)+brk(vb=0.05) | 4.87645 | 4.92483 | 4.98688 | -0.04363 [-0.05477, -0.03201] | 5639 |
| sapm | kal(q=0.002,se=0.1)+div(0.15,0) | 5.63918 | 5.65497 | 5.68293 | -0.01219 [-0.01728, -0.00698] | 5639 |
| tdpm | ew(h=0.5)+div(3,30)+brk(phi=0.8) | 2.47071 | 2.47803 | 2.47991 | -0.00612 [-0.00970, -0.00246] | 5639 |
| ctrlpm | kal(q=0.002,se=0.1)+div(0.15,0) | 6.89035 | 6.90759 | 6.93867 | -0.01038 [-0.01767, -0.00265] | 5639 |
| subpm | kal(q=0.03,se=0.1)+div(0.3,0.002) | 1.17250 | 1.17947 | 1.19746 | -0.00411 [-0.00800, -0.00017] | 5639 |
| r108 | kal(q=0.03,se=0) | 0.84301 | 0.85295 | 0.85099 | -0.00783 [-0.01512, -0.00103] | 2752 |

**Reading the table.**
- **Division layers matter, but they are not drift.** Against league-only references, the outcome-mix trackers look
  0.01-0.02 better. All of that is division composition (heavyweight KOs, flyweight decisions). Against
  references that carry the same division layer, the gain disappears.
- **Stat levels moved steadily 2012-2023.** Sig landed per fighter-minute went 3.33 → 4.15; KD per 100 head
  1.05 → 0.75 (0.68 in 2021); TD attempts per 15 4.2-4.4 → 3.4 (2019) → 3.8; the 10-8 share 2-3% → 7.1% (2017
  and 2019, after the criteria rewrite) → 3.9-5.0%. A 5-year window lags these moves by 2-3 years. Year-level predictions
  are in eradrift.json `cv` / trackers.json `year_err`.
- **Breaks earned a place in five of the chosen configs (slpm, tdpm, dec5, md_dec, round shape).** All of these
  rest on usada2015 and the crowd breaks, since only those fall in the CV years.

## 3. League trackers on 2024-25 (single look)

Chosen minus the win5+div reference. Levels are in display units: % for shares; per fighter-minute, per 15 min, per
100 head landed or per 100 judged rounds for rates.

| target | chosen - win5 [CI] | verdict | 2024 actual / chosen / win5 | 2025 actual / chosen / win5 |
|---|---|---|---|---|
| dec | 0 (same config) | n.s. | 54.99 / 50.46 / 50.46 | 49.71 / 49.80 / 49.80 |
| ko | -0.00418 [-0.00692, -0.00151] | confirmed | 28.77 / 31.82 / 32.04 | 32.69 / 32.20 / 32.56 |
| sub | 0 (same config) | n.s. | 16.24 / 17.51 / 17.51 | 17.60 / 17.66 / 17.66 |
| dec3 | 0 (same config) | n.s. | 55.70 / 50.89 / 50.89 | 50.00 / 49.86 / 49.86 |
| dec5 | +0.01056 [-0.00466, +0.02626] | n.s. | 49.09 / 47.21 / 46.55 | 47.06 / 47.89 / 50.46 |
| sd_dec | 0 (same config) | n.s. | 23.84 / 18.72 / 18.72 | 13.83 / 19.76 / 19.76 |
| md_dec | -0.00008 [-0.00096, +0.00076] | n.s. | 0.71 / 2.09 / 1.97 | 0.40 / 1.64 / 1.79 |
| r1_fin3 | -0.00370 [-0.01281, +0.00468] | n.s. | 48.02 / 50.39 / 51.05 | 57.08 / 57.13 / 50.49 |
| r1_fin5 | +0.02167 [-0.01019, +0.05033] | n.s. | 25.00 / 34.29 / 32.58 | 33.33 / 30.79 / 28.56 |
| late_fin3 | -0.00157 [-0.00612, +0.00277] | n.s. | 20.30 / 16.04 / 15.47 | 13.73 / 15.79 / 16.03 |
| kd100 | -0.00710 [-0.01366, -0.00096] | confirmed | 0.615 / 0.810 / 0.791 | 0.857 / 0.806 / 0.757 |
| slpm | +0.00660 [-0.00162, +0.01503] | n.s. | 3.980 / 4.246 / 4.027 | 3.792 / 4.093 / 4.075 |
| sapm | +0.00214 [-0.00267, +0.00710] | n.s. | 8.431 / 8.891 / 8.641 | 8.041 / 8.629 / 8.594 |
| tdpm | -0.00150 [-0.00712, +0.00357] | n.s. | 3.817 / 3.869 / 3.773 | 4.200 / 3.987 / 3.848 |
| ctrlpm | +0.00165 [-0.00813, +0.01194] | n.s. | 11.38 / 11.46 / 11.26 | 11.21 / 11.04 / 11.42 |
| subpm | +0.00141 [-0.00583, +0.00863] | n.s. | 0.366 / 0.429 / 0.400 | 0.363 / 0.382 / 0.406 |
| r108 | -0.03483 [-0.05521, -0.01471] | confirmed | 2.49 / 3.70 / 5.53 | 2.45 / 2.54 / 4.51 |

- **Verdicts.** Pre-registered: deployment falls back to win5+div for a contradicted target. None was contradicted;
  KO share, KD rate and the 10-8 share were confirmed.
- **Break interventions, descriptive.** Applying the 2024-25 breaks (gloves on, ABC rules, gloves off) to the best
  plain EW or Kalman config changed the 2024-25 loss as follows:
  - decision share -0.0031 [-0.0059, -0.0002];
  - 3-round decisions -0.0024 [-0.0060, +0.0013] and SD -0.0028 [-0.0072, +0.0010];
  - SUB share +0.0016 [+0.0002, +0.0029];
  - KO and KD flat.

  This is not a selection result. It does say the intervention mechanism re-learned the post-glove level faster on
  the target the brief cares most about.

## 4. Method model (S2 + ML v2 winner)

**Gate** (nested forward-chained 2021-2023: config per split chosen on 2016..Y-1, "none" unless it gains > 0.0005 on
the split's own metric; 1,235 fights):

| metric | nested adjusted - static [CI] |
|---|---|
| 7-bin (primary for fin + ko) | -0.00007 [-0.00167, +0.00144] |
| joint (primary for r1) | +0.00050 [-0.00151, +0.00246] |
| method3 | -0.00021 [-0.00179, +0.00125] |
| finish | -0.00016 [-0.00172, +0.00130] |

- **Picks by gate year.**
  - fin: none (2021), then EW 0.25 y + division (2022, 2023; train gains -0.0005 / -0.0007).
  - ko: none every year.
  - r1: Kalman with breaks every year, because its train gain came from 2016-2020; it then lost on the gate years.
- **CV-final configuration (2016-2023):** fin none (-0.00045, under the rule), ko none (-0.00016), r1 Kalman (q 0.005,
  event noise 0.1, rho 0.5, vb 0.1). Since the gate failed, production does not change, and
  `EraDrift.adjustCells` is the identity unless a candidate is named.

**2024-25, single look** (pre-registered descriptive candidates; static 7-bin 1.5171, the ml2 number):

| candidate (vs static) | 7-bin | method3 | finish | joint | round given finish |
|---|---|---|---|---|---|
| M1 CV-final (r1 only) | 0 | 0 | 0 | +0.0022 [-0.0014, +0.0063] | +0.0048 [-0.0030, +0.0136] |
| M2 fast decision tracker | -0.0055 [-0.0098, -0.0013] | -0.0055 [-0.0100, -0.0011] | -0.0056 [-0.0100, -0.0012] | -0.0055 [-0.0098, -0.0013] | 0 |
| M3 = M1 + M2 | -0.0055 [-0.0098, -0.0013] | -0.0055 [-0.0100, -0.0011] | -0.0056 [-0.0100, -0.0012] | -0.0034 [-0.0099, +0.0031] | +0.0048 [-0.0030, +0.0136] |

Decision share, mean predicted vs actual, in the method universe (2016-2023 shows the nested M2; 2024-25 the fixed M2):

| year | n | actual | static | M2 |
|---|---|---|---|---|
| 2016 | 385 | 0.525 | 0.464 | 0.464 |
| 2017 | 347 | 0.490 | 0.514 | 0.514 |
| 2018 | 368 | 0.489 | 0.503 | 0.503 |
| 2019 | 391 | 0.540 | 0.504 | 0.504 |
| 2020 | 346 | 0.526 | 0.523 | 0.523 |
| 2021 | 419 | 0.523 | 0.508 | 0.508 |
| 2022 | 421 | 0.466 | 0.516 | 0.502 |
| 2023 | 395 | 0.489 | 0.488 | 0.492 |
| 2024 | 428 | 0.561 | 0.484 | 0.515 |
| 2025 | 429 | 0.520 | 0.484 | 0.515 |

- **M2 in the CV years** (per year, finish loss vs static): 2016 -0.0028, 2017 +0.0016, 2018 +0.0006, 2019 -0.0009,
  2020 -0.0001, 2021 -0.0012, 2022 -0.0015, 2023 +0.0011. Pooled 2016-2023: -0.00045, under the 0.0005 rule. Its
  2024-25 gain is a confirmation-window number, and the window has been used heavily, so it cannot promote M2. M2
  is a monitored candidate, in the same position as finishing.
- **The 2024 decision-share residual (+7.7 points) is about 3 SE**, and 2016 had a +6.1-point year. Both 2016 and
  2024 are positive surprises after which the residual came back toward 0 the next year. That pattern is what makes
  trackers fail the gate.

## 5. League levels by glove period (descriptive, read after the look)

| period | cards | decision % | KO % | SUB % | KD per 100 head | sig landed / fighter-min | 10-8 per 100 judged rounds |
|---|---|---|---|---|---|---|---|
| 2022 | 42 | 47.0 [42.1, 51.6] | 33.7 | 19.3 | 0.889 [0.781, 1.007] | 4.13 | 3.89 |
| 2023 | 43 | 48.7 [44.8, 52.4] | 31.2 | 20.0 | 0.751 [0.646, 0.863] | 4.15 | 5.00 |
| 2024 old gloves (Jan 1-May 31) | 17 | 51.4 [46.6, 55.9] | 32.7 | 15.9 | 0.681 [0.537, 0.823] | 4.03 | 3.38 |
| new gloves (Jun 1-Nov 15, 2024) | 21 | 59.4 [54.5, 64.6] | 23.1 | 17.5 | 0.538 [0.422, 0.664] | 3.95 | 2.12 |
| transition (Nov 16, 2024-Feb 14, 2025) | 8 | 52.0 [43.9, 60.8] | 36.3 | 11.8 | 0.722 [0.532, 0.952] | 3.86 | 1.36 |
| 2025 old gloves (from Feb 15) | 38 | 49.0 [44.5, 53.8] | 32.8 | 18.2 | 0.872 [0.768, 0.982] | 3.79 | 2.53 |

- **The decision surplus is a new-glove effect.** During the new-glove months, decisions ran 8-10 points above the
  months before and after, with 10 points fewer KOs and KD per 100 head 0.54 vs 0.68 / 0.87. This matches the
  durability note's "KD frailty halving in the 2024 glove trial".
- **Most of 2024-25's +6-point decision miss is that window.** With old gloves in 2025, decisions are back at 49%.
- **This is consistent with a glove effect but does not prove one.** It is observational, 21 cards, with a possible
  card-mix confound.
- **Sig strike pace and the 10-8 share fall steadily across all periods** (4.15 → 3.79 per fighter-minute; 5.0 → 2.5
  per 100 judged rounds). That is the real drift for the engine's levels.

## 6. Statlines layer (per-stat mean offsets)

NLL per fight-side. "nested" = the choice made on 2021, scored on 2022, then made on 2021-22, scored on 2023.

| stat | CV best | CV gain [CI] | years better | CV rule | nested 2022-23 | 2024-25 (best cfg) [CI] | verdict | realised / predicted 2024 / 2025 |
|---|---|---|---|---|---|---|---|---|
| sig_att | ew(h=0.25,n0=800,rho=1.0) | -0.00011 [-0.00106, +0.00093] | 1/3 | - | +0.00346 | +0.00043 [-0.00002, +0.00089] | - | 1.000 / 0.980 |
| sig_lnd | none | 0 | 0/3 | - | 0 | 0 | - | 0.977 / 0.950 |
| h_att | ew(h=0.25,n0=800,rho=1.0) | -0.00049 [-0.00164, +0.00064] | 2/3 | - | +0.00324 | +0.00046 [-0.00006, +0.00105] | - | 1.018 / 1.003 |
| h_lnd | ew(h=0.25,n0=800,rho=1.0) | -0.00014 [-0.00157, +0.00120] | 2/3 | - | +0.00229 | +0.00053 [+0.00002, +0.00106] | - | 1.017 / 0.992 |
| b_att | ew(h=0.25,n0=800,rho=0.0) | -0.00023 [-0.00119, +0.00080] | 2/3 | - | 0 | -0.00365 [-0.00551, -0.00186] | - | 0.944 / 0.893 |
| b_lnd | ew(h=0.25,n0=800,rho=0.0) | -0.00022 [-0.00121, +0.00084] | 1/3 | - | 0 | -0.00861 [-0.01157, -0.00589] | - | 0.901 / 0.851 |
| **l_att** | ew(h=2.0,n0=200,rho=0.0) | -0.00330 [-0.00605, -0.00029] | 3/3 | adopt | -0.00063 | -0.00154 [-0.00437, +0.00140] | confirmed | 0.924 / 0.921 |
| **l_lnd** | ew(h=2.0,n0=200,rho=0.0) | -0.00267 [-0.00502, -0.00007] | 3/3 | adopt | -0.00167 | -0.00409 [-0.00785, -0.00031] | confirmed | 0.901 / 0.895 |
| d_att | none | 0 | 0/3 | - | +0.00252 | 0 | - | 0.999 / 0.977 |
| d_lnd | ew(h=0.25,n0=200,rho=0.0) | -0.00104 [-0.00387, +0.00177] | 1/3 | - | +0.00043 | -0.00025 [-0.00229, +0.00173] | - | 0.977 / 0.944 |
| c_att | ew(h=0.5,n0=50,rho=0.5) | -0.00708 [-0.01209, -0.00244] | 2/3 | adopt | -0.00822 | +0.00360 [+0.00123, +0.00620] | contradicted | 0.921 / 1.011 |
| c_lnd | ew(h=1.0,n0=50,rho=0.5) | -0.00357 [-0.00754, +0.00004] | 2/3 | adopt | 0 | +0.00261 [+0.00031, +0.00495] | contradicted | 0.889 / 0.985 |
| g_att | ew(h=0.25,n0=800,rho=0.0) | -0.00088 [-0.00208, +0.00030] | 2/3 | - | 0 | +0.00076 [-0.00108, +0.00243] | - | 1.055 / 1.017 |
| g_lnd | ew(h=0.5,n0=50,rho=1.0) | -0.00102 [-0.00239, +0.00030] | 2/3 | adopt | -0.00040 | +0.00019 [-0.00310, +0.00320] | not confirmed | 1.068 / 1.013 |
| kd | ew(h=2.0,n0=800,rho=0.0) | -0.00043 [-0.00148, +0.00057] | 2/3 | - | 0 | +0.00016 [-0.00062, +0.00092] | - | 0.867 / 1.072 |
| td_att | kal(q=0.002,se=0.05,rho=0.5) | -0.00107 [-0.00297, +0.00077] | 2/3 | adopt | +0.00052 | +0.00057 [-0.00125, +0.00245] | not confirmed | 0.945 / 1.033 |
| td_lnd | ew(h=0.25,n0=200,rho=0.5) | -0.00077 [-0.00226, +0.00070] | 2/3 | - | 0 | +0.00023 [-0.00144, +0.00186] | - | 0.959 / 1.010 |
| ctrl | none | 0 | 0/3 | - | 0 | 0 | - | 0.939 / 0.933 |
| sub_att | none | 0 | 0/3 | - | 0 | 0 | - | 0.920 / 0.897 |
| rev | ew(h=2.0,n0=800,rho=0.5) | -0.00024 [-0.00176, +0.00147] | 1/3 | - | 0 | +0.00005 [-0.00132, +0.00151] | - | 0.907 / 0.942 |

- **What ships.**
  - The pre-registration defined two outcomes: confirmed (point < 0) and contradicted (CI above 0, withdrawn).
  - For the two adopted stats that were neither (ground landed, TD attempts), I took the conservative reading after
    the look: shipped off, monitored. This removes adjustments and never adds one.
  - Enabled: l_att, l_lnd.
  - The clinch offsets had chased the 2022-23 rise in ufcstats clinch counts (realised/predicted 1.14 / 1.28), which
    reversed in 2024 (0.92 / 0.89).
- **Deployment.** The enabled configs use rho = 0: residuals of an older vintage get weight 0. So a statlines table
  refit through 2025 ("prod") starts 2026 with offset 0 (`prod_2026`). The offsets act only once forward residuals
  of the prod tables accumulate; the fwd-4.2 statline block scores exactly those. Until then, adjustStatMeans changes
  only dev-vintage (backtest) means.
- **The v8/v9 stat-line primaries are untouched by construction.** sig_lnd, control and TD landed are not adjusted.

## 7. Recommendations for the v9 drift monitor

1. **Do not change the pre-registered winner drift rule** (V6_V10_PLAN 6.5.1: no-line stack h 1.5 / T, switching to
   h 3 / T 1 only on audit-1 rule (a) or ledger rule (b)) before audit 1. Nothing here touches it. The level monitor
   below is a separate channel with its own triggers. It never reacts to audit 1, and it never moves the winner
   stack.
2. **Engine league levels** (cycle 4, work item 1, tools/levels_wf.py): take the levels from eradrift.json
   (`EraDrift.level` / `current`) with the chosen trackers, instead of the lagged 5-year calendar window.
   - **Pace** (slpm / sapm): Kalman with q 0.002. It beat the window by 0.044 / 0.012 nats per fight in nested CV,
     but was n.s. and leaning worse on 2024-25. Pair it with a 2024-25-aware review at the v9 look; never tune it on
     2024-25.
   - **KD**: EW h 5 + division, confirmed. **10-8**: Kalman q 0.03, confirmed, strongly. **TD attempts**: EW h 0.5 +
     breaks. **Control**: Kalman.
   - **Current levels** (Jan 1, 2026, league):

     | level | value |
     |---|---|
     | sig landed | 4.01 per fighter-minute (60.2 per 15) |
     | KD | 0.82 per 100 head landed |
     | TD attempts | 4.13 per 15 |
     | control | 11.5 s per fighter-minute |
     | 10-8 rounds | 2.87 per 100 judged rounds |
     | decisions | 50.3% |
     | KO/TKO | 32.0% |

   - Division levels are in `levels[*].div`. Do not run a second KD scale next to durability's tracked league level:
     feed one or the other into the joint KD pass.
3. **Breaks as interventions, never as tilts.** When a dated, pre-announced change happens (equipment, rules,
   judging criteria), add variance to the affected level trackers at the effective date (vb about 0.05 on the logit
   or log scale, or phi 0.5-0.8 for EW). Then log the break in the ledger metadata with its source. Never fit a
   persistent offset from the window the change covered.
   - Reason: the 2024 decision surplus came and went with the glove trial (section 5). A tilt fit to 2024-25 would
     now be wrong in the other direction.
4. **Method cells stay static.** Every method model in the project missed 2024's decision share; the miss is
   transient (section 5), and no level adjustment passes the gate. Add M2 as a forward-ledger side column (not
   primary) in the next pre-registered fwd version. It restarts at offset 0 on the prod model (rho 0) and learns from
   forward cards only.
5. **Alarms (to pre-register in the v9 version entry, before the v9 look and independent of audit 1).** Over the
   forward ledger's trailing 200 bouts, compute calibration-in-the-large for decision share, KO share and the round-1
   share of finishes, and the realised/predicted ratio for sig landed, control, TD attempts and KD.
   - **Alarm rule.** Fire if the 95% CI of the gap excludes 0 for two consecutive quarters. This is the same
     two-quarter construction as rule 6.5.1(b), so the two channels cannot fire on different clocks.
   - **What an alarm does.** It opens a review that may pre-register a new candidate. It never auto-applies a tilt.
   - **Engine levels follow their trackers automatically**: they are inputs, not decisions.
6. **Vault discipline for the trackers.** The exported levels stop at 2025-12-31. Updating them with 2026 cards reads
   the vault, so forward use must restart from the 2025-12-31 state, with the January-November 2026 gap treated as
   unobserved (the Kalman variance grows by q x gap, the EW sums decay). Do this until audit 2 unseals 2026.

## 8. Files and commands

```
nice -n 5 python3 tools/eradrift.py league     # 1 s
nice -n 5 python3 tools/eradrift.py trackers   # ~70 s (out/eradrift_cache/trackers.json)
nice -n 5 python3 tools/eradrift.py base       # ~15 s (asserts the ml2 reproduction)
nice -n 5 python3 tools/eradrift.py method     # ~25 s (out/eradrift_cache/method.json)
nice -n 5 python3 tools/eradrift.py stat       # ~4 min (out/eradrift_cache/stat.json)
nice -n 5 python3 tools/eradrift.py prereg     # data/derived/eradrift_prereg.json is the committed copy (53ca073)
nice -n 5 python3 tools/eradrift.py holdout --dry   # code check on 2023, no lock
nice -n 5 python3 tools/eradrift.py holdout    # refuses to rerun once out/eradrift_cache/holdout.lock exists
nice -n 5 python3 tools/eradrift.py periods    # descriptive glove-period table (needs the lock)
nice -n 5 python3 tools/eradrift.py export     # data/derived/eradrift.json (asserts snapshot runs == scored runs)
python3 tools/eradrift.py summary              # every table above
node tests/test_eradrift.js                    # 2,283 checks
python3 tools/blindtest.py list | grep eradrift
```

- **Reproducing from a clean cache.** The holdout lock lives in the cache, so a fresh rebuild reruns the one look with
  identical inputs. It reproduces the same numbers; it is not new evidence.
- **eradrift.json contents.**
  - `levels`: month-start step functions, league and division, plus the current level.
  - `method.candidates`: walk-forward offsets by month for the dev vintage, and `prod_2026`.
  - `stat`: per-stat offsets.
  - `cv` / `stat_cv` / `holdout`: summaries.
  - `periods`.
  - `fights`: static and M2 7-bin cells for 2019-2025, used by the plugin.
  - `test_vectors`.

## 9. Caveats

- **The method grid is modest.** It has EW and Kalman offsets on three splits with division and format scopes. It
  does not refit S2 with tracked levels as features in place of the 5-year priors. That is the next structural
  variant, and it must pass the same gate.
- **Statline CV has only three years** (2021-2023), on folds trained from 2019 only. Two of the six CV adoptions
  were contradicted on 2024-25. Treat statline offsets as fragile.
- **Card ids.** The statline bootstrap clusters by fight date, not by card; on the few days with two cards this
  narrows CIs slightly.
- **Break sources.** Four of the seven breaks rest on search-result summaries, because their pages could not be
  fetched here. Effective dates agree across independent outlets. The 2017 rules date is the ABC effective date;
  adoption varied by commission.
- **Selection inside the tracker CV.** The references (win5 / static) get their best division setting from the pooled
  CV, and the chosen tracker is the pooled-CV best. The nested column is the honest estimate of the selection
  procedure.
- **Section 5 is observational.** The glove-period split was read after the look. It informs the monitor design
  (breaks as interventions) and selects nothing.
