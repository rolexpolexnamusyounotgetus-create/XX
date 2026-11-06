# Pre-UFC records (Sherdog) for newcomer prediction

Nov 6, 2026. Tool: `tools/preufc.py`. Output: `data/derived/preufc.json`. Raw pages: `data/raw/sherdog_cache/`
(gitignored, 191 MB: 1,749 fighter pages and 75 fight-finder searches). Data: ufcstats snapshot through
Oct 31, 2026; Sherdog fighter pages fetched Nov 6, 2026 at no more than one request per second
(robots.txt allows all agents; User-Agent `FightLabSim/1.0`).

This run relaunches the preufc fit that stopped on the usage cap. The crawl, the parser and a first evaluation
were already done. This run added:
- a leakage audit, which found one leak and fixed it;
- the hidden-data protocol (docs/BACKLOG.md): validation on 2024-2025, and the 2026 vault is never fit or
  scored;
- ablations, and a stack on tools/ml.py's probabilities;
- CV-tuned fades for the finish models;
- production roster coefficients;
- this report.

**Review and final relaunch (Nov 6, 4:36 pm to 7:30 pm UTC).**
- A review pass changed three things in tools/preufc.py. Then `eval` was rerun once, and that run is the
  `eval.built` 4:49 pm UTC state of preufc.json.
  - **Calibration now pools both corner orders.** Corner A wins about 57% of decisive bouts, and the old
    corner-A bins and ECE mixed that ordering artefact into calibration.
  - **Paired accuracy differences** now carry card-bootstrap intervals.
  - **The KO/SUB/DEC model centres the pre-UFC rates on training rows.** It used to centre on the mean of
    every row's corner A, test rows included. The test log loss is unchanged at 0.9776.
- This relaunch did not refit or rescore anything. It brings this report in line with that json and
  corrects one claim the first draft made: seeded Elo is **not** better calibrated than plain Elo (see
  Calibration).
- It also ran independent checks: a re-parse, a walk-forward recount, coverage against backtest.json, the
  stored predictions reproducing every validation score, the vault and robots.txt. They are under Audit,
  "Independent checks".

## Bottom line

- **Every target fighter is matched.** All 1,711 targets resolve to a Sherdog page that contains every one of
  their 12,178 ufcstats bouts. The targets are the 1,229 roster fighters plus 482 other fighters who had a UFC
  bout with 0-3 prior UFC fights since 2015. Wikidata's Sherdog IDs agree on 1,102 of 1,105. The three
  differences are Wikidata errors, checked by hand: two point to other fighters' pages and one to a dead page.
  One thing I cannot measure is how complete Sherdog itself is for small regional shows (see Caveats).
- **The pre-UFC record predicts newcomer bouts better.** The test set is the 533 decisive 2024-2025 bouts where
  at least one man had 0-3 prior UFC fights. These were scored once, after every setting was chosen by
  time-ordered CV on 2015-2023:
  - UFC-stat logistic: log loss goes from 0.6498 to **0.6376**, a change of **-0.0122 [-0.0204, -0.0042]**.
    Accuracy goes from 60.4% to 63.8%, a change of +3.4 points [+0.6, +6.3].
  - Elo with each debutant's starting rating set by his pre-UFC record: log loss goes from 0.6792 to
    **0.6526**, a change of **-0.0266 [-0.0404, -0.0147]**. Accuracy goes from 55.5% to 59.8%, a change of
    +4.3 points [+0.5, +8.7]. Age at debut alone accounts for only -0.0045 [-0.0163, +0.0080] of the log-loss
    gain.
  - **Calibration is about level across these models.** With both corner orders pooled, each model's
    calibration slope lies within the others' 95% intervals, and every interval contains 1. Seeded Elo's ECE
    minus plain Elo's ECE is +0.012 [-0.030, +0.057]. The first draft called seeded Elo the best-calibrated
    model, but that came from corner-A ECE and is withdrawn.
  - Across all 1,026 decisive 2024-2025 bouts the seeded Elo goes from 0.6762 to 0.6538. Bouts between
    veterans improve too, because their opponents were rated better.
  - Stacked on tools/ml.py's walk-forward ML probabilities (361 backtest bouts in 2024-2025 with a 1-3 fight
    side): -0.0073 [-0.0196, +0.0052]. CV also prefers adding the block, but the 2024-2025 interval includes
    zero.
- **It adds nothing once the closing line is in the model.** The change is -0.0025 [-0.0082, +0.0036], and
  the 2015-2023 CV did not want the block either. The market already prices regional records. Without a line,
  the pre-UFC block closes about a fifth of the UFC-stat model's gap to the close on newcomer bouts (from
  0.054 to 0.043).
- **It helps predict how the fight ends, by a little.**
  - Per-side finish models, held out: win by KO -0.0123 [-0.0207, -0.0039] and win by submission -0.0138
    [-0.0228, -0.0043]. Lose by KO is -0.0057 [-0.0144, +0.0026], not significant.
  - The joint KO / SUB / DEC model gives -0.0114 [-0.0250, +0.0019] (P 0.96).
  - The regional KO rate is the strongest signal for power. The regional KO-loss rate says much less about
    chin.
- **No leak that matters was left.** The one leak was a network built from pages that were cached because the
  fighter reached the UFC later. It is fixed, and the leaky and strict versions score the same on 2024-2025:
  -0.0004 [-0.0013, +0.0005].
- **Recommendation:**
  - Seed every newcomer's Elo with the pre-UFC record wherever Elo feeds the blend.
  - Add the pre-UFC block to the feature models (tools/ml.py and the ml2 feature union).
  - In the simulator, shift newcomers' power and submission priors by their regional finish rates (chin only
    weakly), and shift their overall level by the seeded-Elo amount. Fade both with UFC experience.
  - Do not add the block on top of a market line.
  - Details are in the Recommendation section.

## Data

### What was collected

For each target fighter I took the Sherdog pro fight history (result, opponent and opponent page, event, date,
method, round and time). I also took the bio (birth date, nationality, locality, association and weight class)
and the amateur and pro-exhibition sections. Each UFC bout gets a snapshot of the record before it:

| Field | Meaning |
|---|---|
| `n w l d nc` | Non-UFC pro record before the bout (amateur fights and exhibitions excluded) |
| `ko_w sub_w dec_w oth_w`, `ko_l sub_l dec_l oth_l` | Non-UFC wins and losses by method |
| `streak`, `streak_all`, `lstreak_all`, `l5_w/l5_n` | Win streak entering the UFC; overall win and loss streaks entering the bout; record in the last 5 non-UFC fights |
| `years_active`, `age_pro_debut`, `layoff_days`, `n_2y` | Years since pro debut, age at pro debut, days since the last fight, fights in the last 2 years |
| `promos`, `n_promos`, `last_promo` | Promotions (from Sherdog event prefixes; about 30 big organizations merged by alias) |
| `dwcs_w/dwcs_n` | Dana White's Contender Series wins and fights. These are not in ufcstats, so they count as pre-UFC |
| `promo_feed`, `promo_feed_max` | Feeder strength. For each promotion: log(1 + 1000 x the share of UFC debutants before the bout date who came through it). Mean and max over the last 6 non-UFC fights |
| `promo_grad` | Win rate of the promotion's graduates in their first 3 UFC bouts, counting bouts dated before this bout. Shrunk toward 0.5 with 10 pseudo-bouts |
| `opp_ufc_w/opp_ufc_n` | Non-UFC wins and fights against men who already had a UFC bout |
| `net_elo_h`, `opp_wpct_h`, `opp_known_h` | Strict walk-forward network Elo and opponents' pre-fight win share (see Walk-forward design) |
| `exh_n/exh_w` | Pro exhibitions (TUF house fights) |

Each `fighters[slug]` entry holds:
- the Sherdog link and bio;
- `debut`: the record entering the UFC;
- `current`: the record as of today, including fights between or after UFC stints;
- `snapshots`: one row per UFC bout, with columns listed in `meta.snapshot_columns`;
- `fights`: the full pro list, with the ufcstats fight id on each UFC bout.

`roster_priors[slug]` holds the per-fighter outputs for the engine (see Recommendation).

### How fighters were matched

1. **Graph links first (1,675 fighters).** A verified page lists every opponent with a link. When an opponent
   row matches one of the page owner's ufcstats bouts (date within 3 days, similar name), that row gives the
   opponent's Sherdog page.
2. **Sherdog's fight finder otherwise (36 fighters).** I searched by full name, name without suffixes, first
   and last name, last name, and nickname. Candidates were ranked by name, nickname and weight. Four ring
   names are mapped by hand to the legal names Sherdog uses: Loma Lookboonmee, CM Punk, Blood Diamond and
   Tina Black.
3. **Verification.** A page counts only if its pro history contains the fighter's ufcstats bouts (date within
   3 days and a similar opponent name): at least min(2, n) of them, and at least half. In the final build all
   12,178 ufcstats bouts of the 1,711 fighters are found.

### Coverage

| Item | Count |
|---|---|
| Targets: roster (fought since 2021) plus every fighter with 0-3 prior UFC bouts in a bout since Jan 1, 2015 | 1,711 |
| Resolved to a verified Sherdog page | 1,711 (100%) |
| ufcstats bouts of those fighters found in their Sherdog histories | 12,178 of 12,178 |
| Same Sherdog ID as Wikidata (P2818), where Wikidata has one | 1,102 of 1,105 (the 3 others are Wikidata errors, checked) |
| Birth date in both sources / within one day | 1,694 / 1,603 (94.6%) |
| Pro fight rows parsed / non-UFC / UFC rows that ufcstats lacks | 35,968 / 23,704 / 86 |
| Non-UFC rows with an event date and a linked opponent page | 100% |
| Fighters with an amateur section (excluded from the record) / with pro exhibitions (TUF) | 854 / 239 |
| Debutants with no pro fight before the UFC | 2 (CM Punk, Mike Jackson) |
| Evaluation sides with 0-3 prior UFC bouts: 2015-2023 / 2024-2025 | 3,720 / 749, all with a record |
| Debut sides: 2015-2023 / 2024-2025 | 1,023 / 197, all with a record |

The UFC's debutants since 2015 are a complete set: every one was crawled. That is why the feeder-strength
and graduate-results features can be computed as of any date in the window.

Veterans who debuted before 2015 are in the data only if they fought in 2021 or later (the roster). So in
2015-2020 rows some veteran opponents have no record. Those are imputed at the mean, with no missing flag,
because being on the roster tracks future success. In 2024-2025 every veteran opponent is on the roster.

### What a debutant's record looks like (2015-2025, 1,220 decisive debut sides)

- Median pro fights before the UFC: 10 (IQR 7-14). Median losses: one. Undefeated: 32%.
- Median share of wins by finish: 0.79.
- Median age at pro debut: 22.6. Median time from pro debut to UFC debut: 5.1 years.
- Median win streak entering the UFC: 5.
- Contender Series winners went from none in 2015-2016, to 32% of debutants in 2018, to 40-57% in every year
  since 2021.
- The promotions that sent the most UFC debutants since 2015: Contender Series 435, LFA 264, Bellator 140,
  KOTC 95, CFFC 83, PFL/WSOF 80, Cage Warriors 73.

Debutant win rate against men with UFC experience, 2015-2023 only (753 sides; 43.2% overall; 95% intervals):

| Pre-UFC feature | Bucket: win rate (n) |
|---|---|
| Losses before the UFC | 0: 51.2% +- 6.2 (250); 1: 46.2% +- 7.2 (186); 2: 33.6% +- 8.6 (116); 3-4: 34.9% +- 8.3 (126); 5+: 37.3% +- 10.9 (75) |
| Pro fights before the UFC | 0-5: 50.7% (69); 6-9: 45.7% (256); 10-14: 41.2% (221); 15-19: 42.9% (119); 20+: 35.2% (88) |
| Win streak entering the UFC | 0-2: 41.1% (163); 3-5: 37.8% (262); 6-9: 46.0% (248); 10+: 56.2% (80) |
| Contender Series win | no: 39.8% +- 4.0 (563); yes: 53.2% +- 7.1 (190) |
| Feeder strength (`promo_feed`) | <1.5: 42.6% (148); 1.5-2.5: 39.4% (213); 2.5-3.5: 41.4% (220); 3.5+: 50.6% (172) |
| Strict network Elo at debut | <1560: 41.2% (68); 1560-1599: 43.7% (311); 1600-1639: 38.5% (262); 1640+: 53.6% (112) |
| Age at pro debut | <21: 47.6% (252); 21-23: 41.7% (242); 24-26: 36.1% (183); 27+: 50.0% (76) |
| Finish share of wins | <50%: 47.9% (48); 50-74%: 39.7% (237); 75-89%: 42.1% (254); 90%+: 47.2% (214) |

A long record is not a plus: many fights before the UFC mostly means a late signing. The signal is in losses,
the feeder promotion, Contender Series wins and a long current streak.

## Walk-forward design

- **Snapshots.** A UFC bout dated D counts only Sherdog pro fights dated strictly before D. Rows matched to
  ufcstats bouts, and any row from a UFC event, are UFC experience and never part of the non-UFC record.
- **Feeder quality.** A promotion's graduates and their first-3 UFC results count only if the bouts happened
  before D. (A graduate is a UFC debutant who fought in that promotion before his UFC debut.)
- **The leak that was fixed.**
  - The first build rated opponents in a network made of every cached page. Which pages are cached depends on
    the future. A regional opponent who reached the UFC in 2025 has his whole history in that network. One
    who never did has only his fights against cached fighters.
  - `StrictNetwork` rebuilds the network for each calendar year. A bout in year Y uses only the pages of UFC
    debutants whose first UFC bout falls in [2015-01-01, Jan 1 of Y). That is a complete set, chosen by facts
    known before Y. The fighter's own rows are added on top. If his own page is not in that network, his
    rating is a one-sided Elo walk against opponents rated in it.
  - The models use the strict versions. The leaky ones stay in the file as `net_elo` / `opp_wpct` for
    reference.
  - In practice the two network Elos correlate at 0.996, because the network Elo is mostly the fighter's own
    sequence of results. The scores are the same too (see Audit).
- **Splits.**
  - Rows: decisive UFC bouts (draws and no-contests out) with at least one side at 0-3 prior UFC bouts.
  - Train and tune on 2015-2023 (2,569 bouts). Every choice of features, penalty and fade uses time-ordered
    CV over the years 2019-2023: fit on every earlier year, then score year Y.
    - The 2015-2018 rows are only ever fit on, never scored, so every tuning score comes from the 2019-2023
      window the brief and docs/BACKLOG.md set.
    - They are the training set for the 2019 CV fold, and they add debut bouts to the fit of the seeding
      betas.
  - Validation: 2024-01-01 to 2025-12-31 (533 bouts), scored once.
  - The vault (fights from 2026-01-01, 480 bouts) is never fit or scored here. Its pre-fight predictions,
    without results, are in `$PREUFC_VAULT_DIR/preufc_vault.json` outside the repo for the milestone auditor.
  - Confidence intervals come from 2,000 bootstrap resamples of fight dates (whole cards), paired for
    differences.
- **What was looked at before this protocol.** The first run of this tool scored 2024-2026 pooled with the
  leaky network. So did this relaunch's first two evaluation passes, which ran before I found the vault rule
  in docs/BACKLOG.md. None of those numbers is reported here, and preufc.json no longer holds them. Every
  setting was chosen by CV on 2015-2023, both before and after. The network change was made for a leakage
  reason, not a score reason. The auditor should still know that:
  - pooled 2024-2026 aggregates were computed by this tool;
  - the repo's WIP autosave commits from about 11:38 am to 3:17 pm UTC contain them, in preufc.json and in a
    first draft of this report.
- **Models.**
  - `elo`: walk-forward Elo over every UFC bout since 1994 (K 44, boost 1.5 for the first 5 bouts; the
    tools/build_db.py rule). It matches backtest_dev.json's Elo to rounding.
  - `base`: symmetric no-intercept logistic on side differences of:
    - Elo, age, reach and height;
    - log UFC fights, UFC win log-odds, and UFC finish-win and finished-loss rates;
    - layoff;
    - shrunk, decayed UFC rates: strikes landed and absorbed per minute, accuracy, defense, takedowns per 15,
      takedown accuracy and defense, submission attempts, knockdowns for and against, and control for and
      against.
  - `base+pre` and `elo+pre`: the same models plus the 11-feature core pre-UFC block. The block is win
    log-odds, log fights, finish-win and finished-loss rates, streak, feeder strength, graduates' results,
    wins over UFC fighters, strict network Elo, Contender Series win, and age at pro debut. Each feature is
    multiplied by exp(-n_UFC / tau) so it fades with UFC experience.
    - CV chose the core block over the 20-feature set, with C 0.01 and tau 8. Pre-UFC information is still
      worth about half its debut weight after 5-6 UFC fights.
  - `elo_seed_*`: Elo whose debut rating is 1500 + beta . z, where z is the standardized pre-UFC record at
    debut (plus age at debut in the `+age` variant).
    - beta minimizes the Elo log loss of the newcomer bouts in the training years. The fit differentiates
      through every Elo update.
    - Every later update follows the normal Elo rule.
  - `gbm_*`: LightGBM with corner-swap augmentation, for reference.

## Results: who wins (2024-2025 newcomer bouts, 533)

ECE below is the 10-bin calibration error with both corner orders pooled. The corner-A version, which the
first draft reported, is in brackets.

| Model | Log loss [95% CI] | Brier | Accuracy | ECE (corner A) |
|---|---|---|---|---|
| Elo | 0.6792 [0.6678, 0.6908] | 0.2432 | 55.5% | 0.016 (0.046) |
| Elo seeded with age at debut | 0.6747 [0.6558, 0.6948] | 0.2407 | 58.2% | 0.015 (0.043) |
| Elo seeded with pre-UFC record | 0.6508 [0.6337, 0.6671] | 0.2298 | 60.0% | 0.036 (0.039) |
| **Elo seeded with pre-UFC record + age** (chosen by CV) | **0.6526 [0.6340, 0.6703]** | 0.2306 | 59.8% | 0.029 (0.035) |
| Elo + pre-UFC (logistic) | 0.6529 [0.6379, 0.6668] | 0.2305 | 60.0% | 0.042 (0.046) |
| UFC-stat logistic (`base`) | 0.6498 [0.6309, 0.6685] | 0.2293 | 60.4% | 0.035 (0.054) |
| **base + pre-UFC** | **0.6376 [0.6172, 0.6561]** | **0.2237** | **63.8%** | 0.026 (0.053) |
| LightGBM base / + pre-UFC | 0.6644 / 0.6516 | 0.2344 / 0.2289 | 60.4% / 62.3% | 0.040 / 0.024 |

Plain Elo's low ECE comes mostly from its predictions sitting near 0.5, not from better calibration: 874 of
its 1,066 mirrored rows fall in 0.4-0.6. ECE favours flat models, so compare calibration with the slopes in
the Calibration paragraph below.

Paired differences (negative = better):

| Comparison | Mean [95% CI] | P(better) |
|---|---|---|
| base + pre-UFC minus base | **-0.0122 [-0.0204, -0.0042]** | 1.00 |
| base + pre-UFC minus Elo | -0.0416 [-0.0602, -0.0245] | 1.00 |
| seeded Elo (pre + age) minus Elo | **-0.0266 [-0.0404, -0.0147]** | 1.00 |
| seeded Elo (age only) minus Elo | -0.0045 [-0.0163, +0.0080] | 0.77 |
| Elo + pre-UFC minus Elo | -0.0263 [-0.0374, -0.0161] | 1.00 |
| seeded Elo (pre + age) minus base | +0.0029 [-0.0131, +0.0195] | 0.36 |
| LightGBM + pre-UFC minus LightGBM base | -0.0127 | |

Paired accuracy differences (positive = better; same card bootstrap):

| Comparison | Mean [95% CI] | P(better) |
|---|---|---|
| base + pre-UFC minus base | **+3.4 points [+0.6, +6.3]** | 0.99 |
| seeded Elo (pre + age) minus Elo | **+4.3 points [+0.5, +8.7]** | 0.98 |
| seeded Elo (pre only) minus Elo | +4.5 points [+0.8, +8.1] | 0.99 |
| Elo + pre-UFC minus Elo | +4.5 points [+0.8, +8.3] | 0.99 |

With one rating per fighter and nothing else, the seeded Elo comes within noise of the full UFC-stat logistic
on newcomer bouts. Its calibration is level with plain Elo's (next paragraph).

Subgroups (test log loss):

| Group | n | Elo | base | base + pre | seeded Elo (pre + age) |
|---|---|---|---|---|---|
| A debutant in the bout | 172 | 0.6728 | 0.6626 | 0.6495 | **0.6370** |
| Newcomers with 1-3 UFC fights (no debutant) | 361 | 0.6823 | 0.6436 | **0.6319** | 0.6601 |
| Both men newcomers | 216 | 0.6811 | 0.6416 | **0.6360** | 0.6435 |
| Newcomer vs veteran (4+ fights) | 317 | 0.6779 | 0.6553 | **0.6386** | 0.6589 |

The seeding matters most at the debut (0.036 better than Elo). It still helps once a fighter has 1-3 UFC
fights (0.022). From the second UFC fight on, the UFC-stat model with the pre-UFC block is the better tool.

Every decisive 2024-2025 bout (does seeding hurt anyone?):

| Set | n | Elo | seeded (age) | seeded (pre) | seeded (pre + age) |
|---|---|---|---|---|---|
| All decisive 2024-2025 bouts | 1,026 | 0.6762 (55.8%) | 0.6686 | 0.6532 | 0.6538 (59.8%) |
| Backtest rule (both men >= 1 prior UFC bout) | 854 | 0.6769 (55.0%) | 0.6701 | 0.6557 | 0.6572 (59.1%) |

**Calibration on 2024-2025.** Each bout is counted in both corner orders (1,066 rows from 533 bouts), so the
bins are symmetric.

Calibration slopes come from a no-intercept logit refit on the mirrored rows; 1 is perfect and above 1 means
underconfident. Intervals are 1,000 card resamples, computed in this relaunch from the stored
`predictions[fid]`, which reproduce every validation log loss above to 4 decimals.

| Model | Slope [95% CI] | ECE, mirrored |
|---|---|---|
| Elo | 1.04 [0.63, 1.49] | 0.016 |
| Seeded Elo (pre + age) | 1.16 [0.84, 1.49] | 0.029 |
| base | 1.17 [0.85, 1.51] | 0.035 |
| base + pre | 1.23 [0.99, 1.52] | 0.026 |

- Seeded Elo's ECE minus plain Elo's ECE: +0.012 [-0.030, +0.057]. No model is measurably better or worse
  calibrated than another at this sample size.
- The three sharper models lean underconfident (slopes 1.16-1.23), as every input in the project does on
  2024-2025 (docs/BACKLOG.md). Plain Elo sits near 1 because its predictions barely move from 0.5. A
  temperature fit on recent years is part of the release recalibration.

Bins (predicted / observed, n), both corner orders pooled:
- **Seeded Elo (pre + age):** 0.255/0.250 (56), 0.354/0.313 (166), 0.453/0.479 (309), 0.547/0.521 (309),
  0.645/0.687 (166), 0.745/0.750 (56); plus 2 rows at each tail.
- **base + pre:** 0.171/0.000 (12), 0.259/0.260 (77), 0.358/0.312 (170), 0.451/0.438 (274), 0.549/0.562 (274),
  0.642/0.688 (170), 0.741/0.740 (77), 0.829/1.000 (12).
- **Elo:** 0.272/0.167 (12), 0.365/0.417 (84), 0.455/0.462 (411), 0.540/0.533 (463), 0.635/0.583 (84),
  0.728/0.833 (12).

**What carries the weight.**
- **base + pre**, coefficients per SD of the side difference: feeder strength +0.115, finish-win rate +0.089,
  finished-loss rate -0.088, wins over UFC fighters +0.061, network Elo +0.056, Contender Series win +0.048,
  win log-odds +0.046, age at pro debut -0.030.
- **Own record only.** An ablation keeps the record and drops the promotion and network terms. It keeps
  -0.0111 of the -0.0122 gain. Adding feeder strength and graduates' results back without the network Elo
  scores 0.6356, level with the main model (see Audit).
- **Seeded Elo, fit on 2015-2023** (Elo points per SD): network Elo +41.9, age at UFC debut -38.4, log fights
  -29.3, feeder strength +20.5, finished-loss rate -17.5, finish-win rate +16.0, win log-odds -15.8,
  Contender Series +10.3, wins over UFC fighters +9.7, graduates' results +9.3, streak +4.3. Win log-odds has
  a negative weight only because it is collinear with network Elo.

### Stacked on tools/ml.py

ml.json holds out-of-fold probabilities for 2019-2023 backtest bouts (annual expanding refits). It also holds
2024-2025 probabilities from models fit on 2010-2023; the vault is not in ml.json. Backtest bouts require a
prior UFC fight from both men, so the rows here are bouts with a 1-3 fight side: 931 out-of-fold and 361
validation. The stack is a symmetric logistic on logit(p) plus the faded pre-UFC block. C and tau are chosen
by year-ahead CV inside the out-of-fold rows.

| Source | Raw | Calibrated (CV / test) | + pre-UFC (CV / test) | + pre minus calibrated [95% CI], P |
|---|---|---|---|---|
| ML (`ml`) | 0.6328 | 0.6472 / 0.6333 | 0.6453 / 0.6260 | -0.0073 [-0.0196, +0.0052], 0.87 |
| ML stack with Elo and market rating (`stack`) | 0.6105 | 0.6363 / 0.6110 | 0.6390 / 0.6065 | -0.0045 [-0.0139, +0.0048], 0.82 |

- **Plain ML.** CV wants the block (0.6453 against 0.6472) and the test moves the same way, but the
  interval includes zero.
- **ml.py's stack.** The stack already holds the Kalman market rating, and CV on 2020-2023 did not want the
  block, so it stays out.
- **Version note.** These numbers use the ml.json rebuilt at 2:42 pm UTC under the vault rule. A pass
  against the earlier, pooled 2024-2026 ml.json is not reported.
- **Better route.** Put the block into the feature model itself, not on top of its output. ml.py's own
  newcomer gap to the close is 0.036 with 1-2 UFC fights (docs/BACKLOG.md), and this stack has only 931
  training rows.

### Against the closing line (524 newcomer bouts with a clean BFO close)

| Model | Log loss [95% CI] | Accuracy | Minus close [95% CI] |
|---|---|---|---|
| Closing line (no-vig) | 0.5924 [0.5601, 0.6247] | 67.9% | |
| Close, recalibrated | 0.5926 | 67.9% | +0.0002 [-0.0033, +0.0040] |
| Close + pre-UFC | 0.5901 | 68.7% | -0.0023 [-0.0088, +0.0050] |
| Close + base + pre-UFC | 0.5871 | 69.3% | -0.0053 [-0.0150, +0.0048] |
| base + pre-UFC (no market) | 0.6350 | 64.1% | +0.0426 [+0.0151, +0.0713] |
| base (no market) | 0.6467 | 60.9% | +0.0543 [+0.0260, +0.0838] |

Close + pre-UFC minus the recalibrated close: -0.0025 [-0.0082, +0.0036], P 0.80. CV on 2015-2023 preferred
the plain close.

## Results: how it ends

**KO / SUB / DEC for decisive newcomer bouts.** The model is a multinomial logistic. Its inputs are the
division, a five-round flag, both men's UFC finish rates and, in the `+ pre-UFC` version, both men's faded
pre-UFC finish rates (KO, SUB, KO-loss, SUB-loss, finish and finished). There are 2,562 training bouts and 531
test bouts. CV chose C and tau.

| Model | CV log loss | 2024-2025 log loss [95% CI] |
|---|---|---|
| Division base rates | | 1.0193 |
| UFC finish rates | 1.0083 | 0.9890 [0.9568, 1.0239] |
| + pre-UFC finish rates (C 0.3, tau 8) | 0.9929 | 0.9776 [0.9405, 1.0162] |

These are the numbers after the review fix: the pre-UFC rates are now centred on training rows over both
corners. The fix moved the CV score by 0.0001 and left the test score unchanged.

- The difference is -0.0114 [-0.0250, +0.0019], P 0.96.
- Finish vs decision alone: 0.6754 goes to 0.6688 (base rate 0.6933).
- The pre-UFC terms point the expected way:
  - the summed, centred regional KO rate has coefficient +0.64 on the KO outcome and -0.45 on the
    submission outcome;
  - the regional submission rate has +0.67 on the submission outcome;
  - the regional finished-loss rate has -1.15 on the decision outcome: men who were often finished regionally
    are in fewer decisions.

**Per-side finish models.** Each newcomer side (0-3 prior UFC bouts; 3,720 train, 749 test) gets a logistic
with division, the five-round flag, the side's and the opponent's UFC rates, and log(pre-UFC rate / mean),
faded by exp(-n/tau). CV chose tau = 8 for all three, which is the top of the {1, 2, 4, 8} grid.

| Target | Train rate | Test rate | UFC-only | + pre-UFC | Difference [95% CI] | Exponents (own, opponent) |
|---|---|---|---|---|---|---|
| Win by KO | 15.8% | 17.4% | 0.4357 | 0.4235 | **-0.0123 [-0.0207, -0.0039]** | own KO rate 0.60, opponent's KO-loss rate 0.25 |
| Win by submission | 9.5% | 9.2% | 0.2993 | 0.2855 | **-0.0138 [-0.0228, -0.0043]** | own sub rate 0.63, opponent's sub-loss rate 0.19 |
| Lose by KO | 15.5% | 15.8% | 0.4195 | 0.4138 | -0.0057 [-0.0144, +0.0026] | own KO-loss rate 0.24, opponent's KO rate 0.61 |

The two directions agree:
- **Power.** A man's regional KO rate moves his KO-win odds with exponent 0.60. It moves his opponent's
  KO-loss odds with exponent 0.61.
- **Chin.** A man's regional KO-loss rate counts about 0.24-0.25 both ways. So the regional record is a much
  better guide to power than to chin.

Held-out check by tercile of the side's own pre-UFC rate:

| Target | Tercile (pre-UFC rate) | Actual | UFC-only prediction | + pre-UFC prediction |
|---|---|---|---|---|
| KO win | low (0.19) | 10.7% | 14.5% | 11.8% |
| KO win | high (0.59) | 24.5% | 18.7% | 23.1% |
| Sub win | low (0.05) | 4.5% | 8.6% | 3.9% |
| Sub win | high (0.39) | 16.9% | 10.1% | 12.6% |
| KO loss | low (0.013) | 13.6% | 15.9% | 14.5% |
| KO loss | high (0.090) | 18.9% | 17.2% | 21.1% |

## Audit

Each check below was scored once on 2024-2025, with settings chosen by CV on 2015-2023.

| Check | CV LL | Test LL | Minus base [95% CI] | Minus main model [95% CI] |
|---|---|---|---|---|
| Main model: base + core pre-UFC block, strict network | 0.6538 | 0.6376 | -0.0122 [-0.0204, -0.0042] | |
| Same settings with the leaky full network | | 0.6372 | | -0.0004 [-0.0013, +0.0005] |
| Own record only (no promotion or network terms) | 0.6548 | 0.6386 | -0.0111 [-0.0194, -0.0030] | +0.0011 [-0.0064, +0.0085] |
| Record + promotion quality (no network) | 0.6537 | 0.6356 | -0.0142 [-0.0226, -0.0061] | -0.0020 [-0.0069, +0.0030] |
| Pre-UFC block on newcomer sides only (veterans' records ignored) | 0.6549 | 0.6407 | -0.0090 [-0.0172, -0.0012] | +0.0031 [-0.0017, +0.0078] |
| Seeded Elo from own record + age only | | 0.6608 | Elo: -0.0184 [-0.0320, -0.0057] | seeded main: +0.0082 [+0.0008, +0.0155] |

- **The leak was not what drove the result.** The strict and full networks score the same.
- **The gain does not depend on the network or on veterans' records.**
  - Most of it survives with the fighter's own record alone, so it does not depend on the opponent network.
  - It also survives when every veteran's pre-UFC record is ignored, so the uneven veteran coverage before
    2021 does not drive it.
- **Promotion quality matters for seeding.** Feeder strength, graduates' results and wins over UFC fighters
  add 0.008 to the seeded Elo.
- **Other checks.**
  - The Elo here reproduces backtest_dev.json's pre-fight Elo to rounding (max 0.5 points).
  - Corner symmetry holds by construction: no intercept, and features enter as side differences.
  - Newcomer sides have 100% coverage in both train and test, so missing newcomer records cannot leak.

### Independent checks (final relaunch, Nov 6, about 7:10 pm UTC)

These checks were written from scratch in a scratch directory and do not reuse tools/preufc.py's parser or
feature code. None of them refits or rescores a model.

| Check | Result |
|---|---|
| Every backtest.json side with fewer than 4 prior UFC fights (2019-2025) has a preufc snapshot for that exact fight id | **1,740 of 1,740**; the prior-UFC-fight count agrees on all |
| Roster (fighters.json) fighters in `fighters` and in `roster_priors` | 1,229 of 1,229 |
| Walk-forward recount: for every snapshot, count non-UFC W/L/D rows dated strictly before the bout | **12,178 of 12,178** snapshots match on n, w and l |
| Non-UFC rows dated on the same day as a UFC bout of the same fighter | 0 |
| Independent BeautifulSoup re-parse of 82 cached pages (80 random, seed 7, plus Volkanovski and Gaethje): totals by W/L/D/NC, and the record, KO and sub wins entering the UFC | 82 of 82 identical |
| Volkanovski / Gaethje entering the UFC | 13-1 (8 KO, 3 sub), 10-fight streak / 17-0 (14 KO, 1 sub), both match their Sherdog pages |
| Stored `predictions[fid]` (split = test) against ufcstats winners | Elo 0.6792, seeded 0.6526, base 0.6498, base + pre 0.6376: identical to the tables |
| Dates in `predictions` | 2019-01-19 to 2025-12-13; no 2026 fight |
| Vault export | `preufc_vault.json` in the session vault directory outside the repo (pre-fight probabilities only), written by the same 4:49 pm UTC eval |
| Raw cache in git | `data/raw/sherdog_cache/` matched by .gitignore line 20; 0 tracked files |
| Sherdog robots.txt (re-fetched Nov 6, 7 pm UTC) | `User-agent: * / Allow: /` |

Scripts: `check_parse.py` and `calib_slope.py` in this session's scratchpad. They are not part of the repo.

## Recommendation for the engine and the ensemble

1. **Elo baseline and the blend (v9 / MoE).** Replace the plain-Elo input with the seeded Elo. It is better on
   every 2024-2025 subset and hurts no one: all bouts go from 0.6762 to 0.6538. The pieces are in
   preufc.json:
   - Walk-forward probabilities for every dev backtest bout: `seeded_elo_backtest[fid]`. 2019-2023 use the
     CV-year fits; 2024-2025 use the fit on 2015-2023.
   - For a new fighter: debut rating = 1500 + sum_k beta_k (x_k - mu_k) / sd_k. The production
     coefficients are in `eval.models["seeded_elo_live (...)"]`, refit on 2015-2025 debuts with the vault
     excluded. In Elo points per SD: network Elo +48.2, log fights -33.8, age at UFC debut -32.5, feeder
     strength +19.3, finished-loss rate -16.3, finish-win rate +15.7, graduates' results +13.2, wins over UFC
     fighters +12.7, Contender Series +12.5.
   - Per-fighter values: `roster_priors[slug].elo_debut_shift` (SD across fighters about 69 points). The Elo
     update rule itself does not change.
2. **Feature models (tools/ml.py, ml2).**
   - Add the core pre-UFC block as side features times exp(-n/tau), and let the model's own CV pick tau
     (8 in the base logistic here, 2 in the stack).
   - Snapshots are keyed by (slug, ufcstats fight id) in `fighters[slug].snapshots`. Use `side_pre()` in
     tools/preufc.py for the exact transforms.
   - Expected gain on newcomer bouts: 0.007-0.012 log loss. The 2024-2025 interval includes zero when the
     block is stacked on ml.py's output. Out-of-fold stacked probabilities are in
     `predictions[fid].p_ml_pre`.
3. **Simulator newcomer priors (v5 durability / skill hooks).** The engine shrinks each rate toward the
   division prior. For a newcomer, move that prior.
   - **Power** (knockdown power prior): multiply by (pre-UFC KO rate / 0.343)^0.60.
   - **Submission threat** (attempt and conversion priors): multiply by (pre-UFC sub rate / 0.247)^0.63.
   - **Chin:** at most a weak multiplier, (pre-UFC KO-loss rate / 0.044)^0.24. The interval for the KO-loss
     model includes zero.
   - **Fade:** raise each multiplier to exp(-n_UFC / 8).
   - **Scale:** these are odds multipliers on per-fight finish probabilities, not per-strike rates. Use them
     as starting values, and refit one scale per knob in the engine's 2019-2023 calibration.
   - Per-fighter values: `roster_priors[slug].finish_odds_multipliers` (`at_debut` and `now`).
   - Rates are smoothed: KO (ko_w + 0.3) / (n + 2), sub (sub_w + 0.2) / (n + 2), KO-loss (ko_l + 0.2) / (n + 2).
4. **Simulator overall level.** Turn the seeded-Elo shift d into a log-odds shift of d x ln(10) / 400 (100
   points = 0.58). Apply it through the engine's skill hook, which docs/BACKLOG.md names as the most promising
   lead: Elo/ratings skill into accuracy and takedown odds. Fade it by exp(-n_UFC / 8), and fit the mapping
   scale on 2019-2023 newcomer bouts.
5. **When a market line is present,** add no pre-UFC term.
6. **Volkanovski vs Gaethje.** Both are long past the newcomer stage: 19 and 16 UFC bouts in the data, so
   the pre-UFC weight is exp(-19/8) = 0.09 and exp(-16/8) = 0.14. The pre-UFC block barely moves this
   matchup.
   - Volkanovski entered the UFC 13-1 (8 KO, 3 sub; Australian Fighting Championship was his most frequent promotion); debut shift
     +26 Elo points.
   - Gaethje entered the UFC 17-0 (14 KO, 1 sub; 10 of those fights in WSOF, where he was champion); debut shift +117 Elo points. His
     KO-power multiplier was 1.60 at his debut and is 1.07 now.
7. **Upkeep.** Run `python3 tools/preufc.py crawl` before each card so new debutants are resolved, then run
   `build`. Cached pages are never re-fetched, so a cached fighter who fights on the regional scene after
   Nov 6, 2026 needs his page deleted from the cache before the next crawl. A `--refresh` option would be
   the clean fix; it is not built yet.

## Caveats

- **Sherdog's own completeness is not measured.**
  - Every UFC bout is on the matched pages, but regional fights missing from Sherdog are missing here too.
  - Sherdog sometimes files as pro some fights that others call amateur, and the reverse.
  - Amateur records (854 fighters have one) are left out entirely; they might carry signal for fighters with
    short pro records.
- **Opponent quality is thin.**
  - Opponents' records come only from fights between crawled fighters; the strict network has 22,336 fights.
  - A 2024-2025 debutant has on average fewer than one opponent with 3+ known fights. So `opp_wpct_h` is
    mostly missing and not in the core block.
  - A one-hop crawl of opponents' pages (14,401 opponents not yet crawled, about 4 hours at 1 request per
    second) is the next data step if the engine needs regional strength of schedule.
- **Promotion names come from a heuristic.** Sherdog event prefixes are merged with about 30 aliases. Small
  promotions with colliding acronyms are told apart by the long name when the event title includes it.
  Feeder strength depends on the share of UFC debutants a promotion sends, so an odd split does not move it
  much.
- **Veterans in 2015-2020 rows.** Fighters who debuted before 2015 are in the data only if they fought in
  2021 or later. Their missing records are imputed at the mean. The newcomer-sides-only ablation, which
  ignores every veteran's record, keeps most of the gain.
- **The finish-model fade hit the top of its grid** (tau = 8). Regional finishing tendencies may last longer
  than this; try tau 16 or no fade when the engine refits these.
- **The gap to the market remains.** Newcomer bouts are still where the closing line beats every model by
  the most (0.043 log loss after this block). Camp quality, injuries, short-notice context and film are not
  in any feature here.

## Reproduce

```
python3 tools/preufc.py crawl     # only needed for new fighters; cached pages are never re-fetched
python3 tools/preufc.py build     # parse the cache -> data/derived/preufc.json (about 15 s)
python3 tools/preufc.py eval      # CV, validation, audit, predictions, roster priors, vault export (15-45 min)
python3 tools/preufc.py report    # markdown tables from preufc.json
```

`--extra-since` defaults to 2015-01-01, the target and training window used here. Set `PREUFC_VAULT_DIR` to
move the vault export.

Sources:
- Sherdog fighter pages (pro histories), for example
  https://www.sherdog.com/fighter/Alexander-Volkanovski-101527 and
  https://www.sherdog.com/fighter/Justin-Gaethje-46648.
- Wikidata property P2818 (Sherdog fighter ID), via data/raw/wikidata_mma_people.csv, for the cross-check.
- ufcstats, via data/raw/*.csv.
- BFO closing lines, via nlbair/ufc-data (CC BY 4.0, cached by tools/market.py).
- tools/ml.py's data/derived/ml.json.
