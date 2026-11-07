# Live inputs audit: what the forward package and the page read, and how to refresh it

Sat Nov 7, 2026, about 11:15 am UTC. This is a read-only audit; the only file written in the repo is this report. It covers
the forward package (fwd-4.1 for UFC Vegas 124 tonight, fwd-4.2 / fwd-4.3 for events on or after 2026-11-14) and the page
(build.py + src/ml/pagepredict.js). Nothing was refit, no data/derived file was changed, and nothing in the sealed vault
directory was read or written. The reproduction runs in section 5 used a separate copy of the tools and the raw CSVs in
the session scratchpad, with the vault output redirected to a throwaway folder and then deleted unread.

The goal behind it: keep every model weight frozen, but feed the models inputs that include the latest completed fights
before each card: UFC 334 (Nov 14), the Qatar card (Nov 21), UFC Fight Night 295 (Dec 5) and UFC 335 (Dec 12).

## 1. Findings

1. **The Greco1899 CSVs have no fights after 2026-10-31.** All six files on raw.githubusercontent.com (fetched with
   User-Agent "FightLabSim/1.0") have the same sha256 as `data/raw/*.csv`:

   | file | sha256-16 (remote = local) |
   |---|---|
   | ufc_event_details.csv | 34b43588d55c757a |
   | ufc_fight_details.csv | b3abd2d38a0c4ec1 |
   | ufc_fight_results.csv | c1c3ee8004a205ef |
   | ufc_fight_stats.csv | 873527e4231fc9c7 |
   | ufc_fighter_details.csv | a1f6e4326217fab9 |
   | ufc_fighter_tott.csv | 3296e67941f984cd |

   - The upstream HEAD is `3d4886d`, "2026-11-01 data refresh", committed at 6:02 pm UTC on Sun Nov 1. The newest event
     in it is UFC Fight Night: Moicano vs. Nolan (Oct 31).
   - The repo refreshes once a week, on Sundays at about 6:00 pm UTC. The previous refreshes were on Oct 18 at 6:02 pm,
     Oct 25 at 6:03 pm and Nov 1 at 6:02 pm. The next one, which should carry Vegas 124, is due Sun Nov 8 at about
     6:00 pm UTC.
   - ESPN's UFC scoreboard for Nov 1-7 lists a single event: UFC Fight Night: Cortes Acosta vs. Walker, Nov 7 at 10:00 pm
     UTC, status scheduled. So the only results missing before UFC 334 are tonight's 14 Vegas 124 bouts.
   - ufcstats.com does not resolve from this container. raw.githubusercontent.com, ESPN and BestFightOdds respond. The
     ufcstats half of the two-source rule therefore has to come through the Greco1899 mirror, as `forward_ledger.py score`
     already does.
2. **No fighter booked from UFC 334 to UFC 335 has fought since the snapshot.** In cards_upcoming.json (as of Nov 6,
   9:13 pm UTC):
   - the latest `last_fight` among the booked roster fighters is 2026-10-03;
   - no fighter is booked on two of the upcoming cards.

   So Vegas 124, and each later card, reaches the next cards only indirectly:
   - league-level windows (priors);
   - ratings coupled through the fight graph (WHR, opponent adjustment, embeddings);
   - date conventions (section 3);
   - any late replacement who fought on a card after the snapshot.

   The direct effect of adding tonight's results to UFC 334's inputs is small. What a refresh mainly protects against is
   a late replacement, and it keeps the pipeline exercised for the later cards.
3. **Two inputs are much staler than the snapshot: the embeddings and the debut network ratings.**
   embed_model.json's roster embeddings are its final refit at 2026-01-01. debut.json's `roster_gnet` is as of
   2026-01-01. Neither has seen a single 2026 fight. On the upcoming cards:

   | event | roster fighters | with a 2026 UFC fight | 2026 fights unseen by the embeddings | no embedding at all |
   |---|---|---|---|---|
   | Nov 14, UFC 334 | 23 | 19 | 29 | 1 |
   | Nov 21, Qatar | 21 | 18 | 29 | 2 |
   | Dec 5, UFC Fight Night 295 | 17 | 13 | 15 | 7 |
   | Dec 12, UFC 335 | 21 | 20 | 33 | 3 |

   Training used walk-forward embeddings: a quarterly refit plus a light update after every event. A roster embedding
   10 months past its refit is further from what the stat-line tables were fit on than a light-updated one would be.
   - The embeddings feed the scored stat-line block (fwd-4.2 / 4.3) and the page's stat lines. They do not feed the
     winner `p_a`.
   - `roster_gnet` feeds only a veteran's side in a debut bout. There is one on UFC 334 (Elder vs Sanches), one on the
     Qatar card, three on Dec 5 and three on UFC 335.
4. **Later-card debutants have no seed.** Seven of them have no entry in any `debutants_*.json` and no preufc.json
   `roster_priors` row: Alik Lorenz, Akbar Abdullaev, Modestino Rodrigues, Ivan Gnizditskiy, Quentin Pasley, Ronald
   Humphrey and Roque Conceição. They would enter at Elo 1500.
   - Debutants files are per-event inputs that are not pinned. Adding them needs no new model version.
   - That makes them the cheapest refresh with a real effect. A debutant's seed moves `p_elo`, and through it
     `p_a_noline` and the no-line `p_a`. It also moves the debut-method sides.
5. **The three largest roster builders reproduce the pinned files exactly at the Oct 31 cutoff with frozen parameters**
   (section 5):
   - fighters.json profiles and priors (3 s);
   - the ML page roster in ml.json (7 s);
   - every system of the ratings.json roster: 11 rating systems plus dims (20 s).

   So an update-only refresh is feasible and testable: the same code at the old cutoff must give the pinned bytes.
6. **Rerunning most builders in place would break a hard rule, refit something, or quietly lose data.** Section 4 has the
   full list. The worst cases:
   - **build_db.py** has no output flag. It rewrites `backtest.json`, `backtest_dev.json`, `priors.json` and
     `elo_report.json` in data/derived. It also writes `backtest_vault.json` into `VAULT_DIR`, whose default is the
     scratchpad `vault` folder, the sealed vault directory.
   - **build_db.py has drifted since the pinned build.** Today's code adds five durability keys to every profile
     (`ko_losses_365`, `kd_absorbed_365`, `last_ko_loss`, `layoff`, `ufc_years`), plus `dur` when durability.json is
     present. versions/v4/ml/mlrates.js `normSide` reads `prof.layoff` when it exists. A profile carrying `layoff`
     (days from the last fight to the snapshot) would replace the date-correct layoff. That would change the learned
     stat-line rates: the engine expert, the simulator model and the stat-line block. The live fighters.json must drop
     those keys.
   - **market.py build** reads `backtest.json` for every post-nlbair fight. Since the vault split, that file ends on
     2025-12-13. A rebuild today would quietly cut the live market rating back from 2026-10-31. It would also re-run the
     parameter grid, rewrite the evaluation blocks and write `market_vault.json` into the vault directory.
7. **Governance.** fwd-4.2 and fwd-4.3 pin 15 data files by hash, all the roster-level files among them. The README says
   "A change to any of them, a roster refresh included, is a new version (fwd-4.3.1 or later). It needs a dated addendum
   here naming the new hashes before its first file." As written today, `predict --fwd 4.3` refuses any refreshed input.
   A refresh therefore needs a pre-registered addendum before UFC 334's lock (Sat Nov 14, 10:00 pm UTC) if it is to apply
   to UFC 334. Otherwise it can only start with a later card (section 6).

## 2. Every input, with its builder and as-of date

"Frozen part" means what was fit or selected on a training window: it must stay byte-identical. "Live part" means state at
the cutoff: what a refresh changes. Hashes are the fwd-4.3 pins (sha256, first 16 hex).

### 2.1 Pinned data files (fwd-4.2 / fwd-4.3) and what reads them

| # | input (file, sha256-16) | read by | built by (tool, command) | as of (last fight / line included) | frozen part | live part (roster-level) |
|---|---|---|---|---|---|---|
| 1 | fighter profiles, Elo, league priors: `fighters.json` df4d868a2195fb4a | ledger JS: engine v4 sides, MoE feat_lr and gate, Elo model, debut sides, methodround S/SM; forward_statlines (MLRates sides, priors, division base rates); page (gzipped roster, engine, every model) | `python3 tools/build_db.py` (5 s) | snapshot 2026-10-31: 8,974 bouts through UFC Fight Night: Moicano vs. Nolan; priors from fights 2018-01-01..2026-10-31; built Nov 6, 9:02 am UTC | Elo K 44, boost 1.5 (grid on 2019-2023 decisive fights); half-life 730 d; roster_since 2021-01-01 | S/C sums, record, `recent` (last 6), n_fights, n_5rd, ko_losses, kd_absorbed, elo, division, last_fight, pace; `priors` |
| 2 | MoE feature-LR expert: `moe_page.json` 34a33d1837e9b912 | ledger JS (feat_lr, gate inputs) | tools/moe.py (lrpage) | weights only, fit on walk-forward snapshots 2010-2025 | everything | none (reads fighters.json profiles at the fight date) |
| 3 | ML page model (experts `ml`, `elo_sig`): `ml.json` 444b7b1e62086cc1 | ledger JS (MLPage) | `python3 tools/ml.py` (full pipeline: CV, GBM, XGB, stacking) | roster snapshot 2026-10-31; built Nov 6, 2:42 pm UTC | page_model coefficients (fit 2010-2025), Platt slope, stack; margin-Elo K 160 / w 0.8 (sig) and K 160 / w 0.9 (judge), tuned on 2010-2023 | `roster` (1,229 fighters x 89 fields) incl. `mr_mu`/`mr_sd` copied from market.json; `page_model.snapshot` |
| 4 | market rating (Kalman): `market.json` 8edb0a6cc9c3ca4f | ledger JS (`mkt_rating`); feeds ml.json and ml2.json rosters | `python3 -I tools/market.py build` | `live_snapshot_stream_to` 2026-10-31; sd drifted to Oct 31; 1,219 roster fighters | sig_m 0.5, tau 0.5/y, v0 1.5, kappa 1.5 (grid on 2019-2023) | `ratings[slug]` = [mu, sd at snapshot, last fight, n] |
| 5 | method-and-round S / SM: `methodround.json` b26b7e373367f346 | ledger JS (head cells, stat-line length grid); page (`MR_GZ`) | `python3 tools/methodround.py` | `js_model.fit_through` 2026-10-31. The coefficients were fit on every fight through the snapshot, 2026 included; research/model_methodround.md documents this. | c6 S / SM, win SM, hazard, decision coefficients and scalers, draw_c, shrink | `js_model.extras` (1,416 fighters: streak, last result, finishing minutes and counts, round-1 finishes, career minutes, mean opponent Elo); `js_model.priors` (live league priors) |
| 6 | learned stat-line rates: `mlrates.json` 6dec930e670f7c70 | engine v4 adapter, forward_statlines, page | tools/mlrates.py | weights only, trained 2010-2025 | everything | none (reads fighters.json profiles and priors; age and layoff at ctx.date) |
| 7 | ML v2 logistic, market-rating term, production stacks: `ml2.json` 0837826dbc05cd1f | ledger JS (ml2_lr, every ml2 stack incl. both primaries); page (`ML2_GZ`, with forward_models weights) | `nice -n 5 python3 tools/ml2.py all` (or `export`) | `page_model.snapshot` 2026-10-31; built Nov 6, 7:51 pm UTC | `page_model.terms` (refit 2010-2025 inside `page_model()` on every export), mr_params, keys, stack | `page_model.roster` (1,229): `v` (from ml.json roster), `r` (4 systems from ratings.json roster), `mr` (market.json), `pre` (preufc.json `current`); `snapshot` |
| 8 | ML v2 stacks fit 2019-2023: `forward_models.json` 20269ec7642c1db8 | ledger (both primaries), page | `tools/forward_models.py` 1.0 | weights only, fit 2019-2023 | everything | none |
| 9 | rating systems and stack: `ratings.json` 5fc4f8a3be14051f | ledger JS (`whr_rounds`, `ratings_stack`); feeds ml2 roster `r` | `python3 tools/ratings.py` | roster at ref_day 2026-10-31 (age and inactivity drift applied to that day); built Nov 6, 8:42 pm UTC | per-system params (coordinate descent on 2019-2023), dims model coefficients and dim_params, stack weights (2019-2023) | `roster` (1,229): elo_ref, elo_k, elo_full, elo_rounds, glicko2, trueskill, trueskill_mov, whr, whr_mov, whr_rounds, whr_hybrid, dims |
| 10 | pre-UFC seeding: `preufc.json` 30111c93e864dfe0 | ledger JS (seed betas, `roster_priors` fallback); feeds ml2 roster `pre` | `python3 tools/preufc.py all` (Sherdog crawl, at most 1 request/s) | Sherdog pages as fetched by Nov 6, 4:07 pm UTC (ufcstats snapshot Oct 31) | `eval.models` seeding betas (refit on 2015-2025 debuts), finish-odds coefficients | `roster_priors` (1,711), `fighters[slug].current` |
| 11 | MoE stacks: `blindtest_stack.json` ded17ce026bbff29 | ledger JS (stack_line / open / noline, moe_noline) | `tools/blindtest.py export` | weights only, fit 2019-2025 | everything | none |
| 12 | debut models: `debut.json` f6709d52292ccc83 | ledger JS (debut method primary, debut_model, debut_path); page (`DEBUT_GZ`) | `python3 tools/debut.py export` | `roster_gnet.as_of` 2026-01-01; model refit 2012-2025 | winner and method models, live_division_base, stacks, adoption | `roster_gnet.fighters` (874: network rating, sd, strength of schedule, mean for men with a UFC bout in 2023-2025) |
| 13 | stat-line tables: `statlines.json` 30c3a959a1a3ac2a | forward_statlines, page | statlines 1.0 | weights only, prod tables refit 2019-2025 | everything | none |
| 14 | embeddings: `embed_model.json` 061d9fba48cc6633 | forward_statlines, page (stat lines, engine `embed` blend) | `python3 tools/embed.py` (CV, walk, final refit) | final refit at 2026-01-01 (`era_date`); no 2026 fight | C, W, V, ua, ud, M, noise, tasks, mlrates_blend | `roster` (1,098 fighters with exposure above 0) |
| 15 | opponent-adjustment factors: `oppadj.json` c27c8c6de3733c59 | forward_statlines, page | `python3 tools/oppadj.py` (`--reuse --cache` loads the grid) | roster fit at snapshot 2026-10-31 (every fight through it) | `chosen` configs (half-life, k), lambda, kappa (tuned 2019-2023) | `roster` factors (1,229) |

Code pins (versions/v4 engine3.js, params3.js and ml/mlrates.js; src/ml/moe.js, mlpage.js, ml2.js, debut.js, statdist.js and
embed.js; tools/methodround_model.js) are evaluators. They are not inputs and stay frozen.

### 2.2 Per-event inputs (not pinned; each prediction file records their hashes)

| input | file | as of |
|---|---|---|
| card snapshot | data/predictions/cards_upcoming.json | Nov 6, 9:13 pm UTC |
| market at prediction time | data/predictions/odds_snapshot_*.json (newest 20261106-2118); timeline data/derived/odds_upcoming.json | Nov 6, 9:18 pm UTC |
| debutant seeds | data/predictions/debutants_vegas124.json: Degli +128.2, Lourenço +17.4, Calderon -30.4; `also_upcoming`: Sanches +78.6 | Nov 6, 9:13 pm UTC |

### 2.3 Page-only inputs (build.py)

The page inlines these blocks:
- fighters.json (`FIGHTERS_GZ`), mlrates.json (`MLRATES_GZ`), methodround `js_model` (`MR_GZ`);
- ml2 `page_model` with forward_models.json weights (`ML2_GZ`);
- mr_s2.json `js_model` (`S2_GZ`, a308dd8e891aa8bc): fit 2012-2025, no roster;
- statlines, embed_model and the oppadj roster (`STATDIST_GZ`);
- debut.json plus every debutants file (`DEBUT_GZ`);
- calibration.json, version_history.json and page_scorecard.json (display only), and the forward block (cards, odds,
  results; display only).

The page engine is src/params3.js + src/engine3.js, which the engine v10 workflow is editing. Its `embed` and `retarget`
components read the same embed roster and statdist block. src/app.js loads no durability roster.

### 2.4 Inputs the task named that the package does not read

- **durability.json.** It is not read by fwd-4.x: engine v4 has no durability component. The page does not read it
  either, and the pinned fighters.json profiles carry no `dur` or `*_365` fields. Only the frozen v5 / v6 engines read
  it, in evalv runs.
- **Durability records that the package does read.** These are fighters.json `ko_losses` and `kd_absorbed` (v4 chin
  aging) and ML v2 roster fields such as `chin`, `ko_l_rate`, `last1_ko_l` and `kd_absorbed_c` (from ml.json).

## 3. What the newest results would change, feature by feature

"Date-aware" means the frozen evaluator already computes the value at the fight date from a stored anchor, so it is right
for a future date without a refresh, unless the fighter fights in between.

| feature family | where it lives | date-aware? | what a new completed fight changes |
|---|---|---|---|
| Elo (`elo` model, MoE expert, ML features, debut sides) | fighters.json `elo` | no inactivity drift in the model | participants only (online update); K and boost re-selected on an unchanged window give the same 44 / 1.5 |
| margin Elo `elo_sig`, `elo_judge`, `elo_chg3` | ml.json roster | no | participants only; tuned K and w unchanged (2010-2023 window) |
| Glicko-2, TrueSkill, Elo variants | ratings.json roster | drift is applied to ref_day = snapshot, not to the fight date | participants' mu and sd; everyone's drift moves if ref_day moves |
| WHR (whr, whr_mov, whr_rounds, whr_hybrid) | ratings.json roster | same, ref_day | WHR re-solves the whole history: every fighter connected to a new fight shifts a little, including fighters who did not fight. Params w2, vf and s0 stay frozen. |
| ratings stack | ledger computes it from roster members | inherits the members | through the members only; weights frozen |
| dims (off/def per dimension) | ratings.json roster | sd grows to ref_day | participants; dims coefficients frozen |
| market rating (Kalman) | market.json ratings; ml.json `mr_*`; ml2 roster `mr` | sd drifted to the snapshot; ml2 inflates it further by days after `page_model.snapshot`; the ledger's MoE expert uses the stored sd | participants: mu and var updated by the closing line and the result; everyone's sd re-drifted to the new snapshot (capped at 2 v0) |
| experience: n, log_n, n5, ntitle, years_ufc | fighters.json n_fights / n_5rd; ml.json roster | years_ufc yes (anchored at the snapshot); the rest no | participants |
| layoff, log_layoff | computed from last_fight / `_last_fight` | yes (MoE, MLRates, ML page, ML v2, methodround_model) | participants' last-fight anchor. Caveat: a profile with a `layoff` key would override MLRates (section 1, finding 6) |
| streaks, last-3 form: streak, last1_win, last3_win, win_form, MoE streak / last3 | ml.json roster; fighters.json `recent`; methodround extras | no | participants |
| rolling stats: decayed rates (half-life 730 d), form (365 d), shrunk to live 5-year priors | fighters.json S/C (MoE re-decays S to the fight date); ml.json roster | MoE yes; ML roster no (values as of the snapshot) | participants' rates; every fighter's shrinkage target moves slightly with the 5-year live-prior window |
| age at the fight date | dob / `_dob` | yes everywhere except ratings.json drift (age at ref_day) | nothing (fight-independent) |
| weight-class move, new class | ml.json `_prev_lbs` / `_lbs_fought`, fight lbs | yes | participants who fought at a new weight |
| fighter division (home) | fighters.json `division` (modal division of the last 3 years); ml.json `_division`; ratings, oppadj | no | movers; the division picks the priors and oppadj roster factors |
| league priors | fighters.json `priors` (2018-01-01..snapshot); ml.py live priors (5 years); methodround `js_model.priors` | no | all divisions, by a tiny amount (about 12 to 14 bouts added to a window of about 4,000) |
| MLRates and stat-line inputs | fighters.json profile and priors; embed roster; oppadj roster | age and layoff yes | through the profile, the embeddings and the oppadj factors |
| embeddings | embed_model.json roster | era term yes (embed.js uses the fight date) | every fighter with a 2026 fight (light update); a new fighter gets an embedding once his exposure is above 0 |
| opponent adjustment | oppadj.json roster | no | participants and, through the walk fit, their opponents' quality |
| durability records | fighters.json ko_losses, kd_absorbed; ML roster chin / KO fields | no | participants |
| pre-UFC and debut seeds | preufc.json; debutants_*.json; debut.json roster_gnet | seeds are fixed at the UFC debut | not UFC results; new debutants need entries; veterans' non-UFC fights are not tracked |
| methodround extras | methodround.json `js_model.extras` | no | participants (streak, last result, finishing minutes, opponent Elo mean) |

## 4. Which builders can run with a later cutoff without refitting

| builder | in-place rerun | why | update-only path (frozen weights) | verified |
|---|---|---|---|---|
| tools/build_db.py | no | Rewrites backtest.json, backtest_dev.json, priors.json and elo_report.json; writes backtest_vault.json to VAULT_DIR (default: the scratchpad vault). Code drift adds 5 durability keys plus `dur`. | Filter / update only. Elo K re-selected on an unchanged 2019-2023 window gives the same 44 / 1.5; `--priors-until` exists if the priors are to stay at Oct 31. Run it with RAW, OUT and VAULT_DIR redirected (a wrapper, since OUT has no flag), keep only fighters.json and drop the five `*_365` / layoff / ufc_years keys and `dur`. | Yes: at Oct 31 it reproduces all 1,229 pinned profiles and the priors exactly, except for the extra keys and meta.built / meta.notes (3 s). |
| tools/ml.py | no | A full run refits every model (CV, GBM, XGB, stacking) and rewrites the evaluation blocks. `--stage2 --page-only` still refits the page logistic. | `get_table()` pieces only: `load_all`, `run_elo`, margin Elo (re-tuned on 2010-2023: same K and w), `build_table`, `roster_features`. Splice the roster into a copy of ml.json, add `mr_mu` / `mr_sd` from the live market ratings, set `page_model.snapshot`. | Yes: 1,229 rows identical on every field at Oct 31 (`mr_*` are added at export from market.json, by design) (7 s). |
| tools/ratings.py | no | `main` re-tunes (coordinate descent), refits dims and stack, scores 2024-25 and writes ratings_vault.json to the vault directory. | The tool's own leak-check path: `load_data`, `prepare`, `run_system(D, kind, stored params)` for each system, `run_dims(D, stored dim_params)`, `roster_states(..., ref_day)`. Write only the roster into a copy of ratings.json. | Yes: all 11 systems plus dims identical to the pinned roster (no value differs by more than 1e-4) (20 s). |
| tools/market.py | no | `build` re-runs the parameter grid. It rebuilds the live stream from backtest.json, which lost its 2026 rows at the vault split, so the live rating would quietly regress from Oct 31. It rewrites the evaluation blocks and writes market_vault.json to the vault directory. | Incremental Kalman continuation from the stored state, which is Markov and so sufficient. For each new fight: var at the fight = min(sd^2 + tau^2 x days since snapshot / 365.25, 2 v0); then `run_rating`'s line update (multiplicative no-vig close, clipped to [0.02, 0.98]) and result update with frozen params; then re-drift every sd to the new snapshot. Exact up to the 4-decimal rounding of the stored mu and sd. Edge: an opponent outside the stored roster restarts at (mu0, v0). | Not run (it would need 2026 closes). The algebra is in section 4.1. |
| tools/methodround.py | no | `export_js_model` refits c6, win, hazard and decision on every fight through the snapshot. | Recompute `extras` (and `priors` from the live league priors) from the tool's walk-forward state through the cutoff; copy the coefficients, scalers, draw_c and fit_through byte-for-byte. | Not run. |
| tools/ml2.py | no | `export` calls `page_model()`, which refits the logistic (deterministic on rows up to 2025, but still a refit) and needs the stage caches. | Splice a new `page_model.roster` built the way `page_model()` builds it, using the existing `keys`, `rating_systems` and `pre_keys`: `v` from the live ml.json roster, `r` from the live ratings roster, `mr` from the live market ratings, `pre` from preufc.json `current`. Set `snapshot` to the cutoff. Leave terms, stack and test_vectors untouched. | Not run (the inputs it splices are verified above). |
| tools/embed.py | no | The final refit fits the loadings and the embeddings jointly; CV and walk are hours of work. | The walk's own between-refit step: a light update (`Fit(..., warm=final state, who=fighters who fought)`, loadings frozen) after each event from 2026-01-01 to the cutoff, with no quarterly refit. Needs the full 2026-01-01 state for every fighter (embed.json or the embed cache), not only embed_model.json's 4-decimal roster. This is a new semantics and must be pre-registered. | Not run. |
| tools/debut.py | no | `export` refits the production model on 2012-2025. | `GlobalNet.rate(rows through the cutoff, D, frozen fit F)` for every veteran with a UFC bout in 2023 or later. Opponent ratings stay at the fitted network; a newcomer opponent gets the prior. Alternatively keep as_of 2026-01-01. | Not run. |
| tools/oppadj.py | no | Grid (or `--reuse` of a cached grid), test scoring and snapshot rewrite, all in one output file. | `walk_count` / `walk_binom` at T = cutoff + 1 with the frozen `chosen` configs, then `multi_factors` with the frozen lambda and kappa, on the live fighters.json S and live priors. Write the roster block only. | Not run. |
| tools/preufc.py | no | Crawl plus build plus eval refits the seeding betas. | Per event, the card desk's `debutants_*.json`: Sherdog page, `parse_fighter`, snapshot features, `side_pre`, and the live betas from preufc.json. Not pinned; the README allows it. | Already the practice (debutants_vegas124.json). |
| mlrates, moe, statlines, forward_models, blindtest_stack, mr_s2 | none needed | weights only | none | none |

### 4.1 Market rating continuation (why it is exact)

`run_rating` keeps, per fighter, [mu, var, last date, n] and nothing else. market.json stores mu and
sd = sqrt(min(var + tau^2 x gap_snapshot, 2 v0)), with gap_snapshot measured from the fighter's last fight to the snapshot.

- **Uncapped fighters.** At the next fight the filter uses min(var + tau^2 x gap_total, 2 v0), which equals
  min(sd^2 + tau^2 x (fight - snapshot), 2 v0).
- **Capped fighters (sd = sqrt(3) = 1.7321).** They are still capped at the next fight.

So the stored block continues the stream exactly. Replaying the 2026 stream is unnecessary, and the 2026 rows of
data/raw/odds/bfo_event_lines.csv, which encode results and are off limits to dev agents, never need to be read.

## 5. Reproduction checks run for this audit

Everything ran in a scratch tree: a copy of tools/build_db.py, ml.py and ratings.py, the six Oct 31 CSVs and copies of
the pinned fighters.json, market.json, preufc.json and ratings.json.
- `VAULT_DIR` pointed to a throwaway folder that was deleted unread.
- The repo's data/derived was never written.

| check | result |
|---|---|
| `VAULT_DIR=<throwaway> python3 -I tools/build_db.py` vs pinned fighters.json | sha256-16 fad356b06d80ddae vs df4d868a2195fb4a. `priors` identical. 1,229 slugs identical. Every pinned profile field identical. Extra keys in every profile: kd_absorbed_365, ko_losses_365, last_ko_loss, layoff, ufc_years. elo_report `chosen` identical (K 44, boost 1.5, 5 boost fights). |
| ml.py `load_all`, `run_elo`, `tune_margin_elo` + `margin_elo`, `build_table`, `roster_features` vs ml.json `roster` | margin Elo re-tuned to K 160 / w 0.8 (sig) and K 160 / w 0.9 (judge), the same as ml.json `tuning.margin_elo`. All 1,229 rows equal to ml.json at its 6-significant-digit rounding on every field; `mr_mu` / `mr_sd` come from market.json at export. |
| ratings.py `load_data`, `prepare`, `run_system` with ratings.json stored params (11 systems), `run_dims` with stored dim_params, `roster_states(ref_day = last day)` vs ratings.json `roster` | 1,229 fighters, no value differing by more than 1e-4 |

Re-run recipe: copy the tools and the raw CSVs into an empty folder, set `VAULT_DIR`, and call the functions above. Each
check took 3 to 20 seconds.

## 6. Recommendations

1. **Pre-register before refreshing.** A refreshed input under fwd-4.3 is refused by design. Write a dated "live inputs"
   addendum (fwd-4.3.1) to data/predictions/README.md before the first file that uses it. It should name:
   - **Frozen files.** The weight files keep their fwd-4.3 hashes: moe_page, mlrates, forward_models, blindtest_stack,
     statlines, versions/v4 and the evaluators.
   - **Live files.** fighters.json, ml.json, market.json, methodround.json, ml2.json, ratings.json and oppadj.json, plus
     embed_model.json and debut.json if the catch-up in item 5 is adopted. Each is a copy of the pinned file with only
     its live keys (section 2.1) replaced, read from `data/derived/live/<cutoff>/` and listed in a manifest.
   - **Key-level guards.** Every frozen key in a live file must hash the same as in the pinned file. Examples:
     ml.json `page_model`, ml2.json `page_model.terms` and `stack`, methodround.json `js_model` minus `extras` and
     `priors`, ratings.json `systems`.
   - **Builder code hashes**, and the zero-diff test: the live builders at cutoff 2026-10-31 must reproduce the pinned
     live keys (section 5 shows this holds today for three of them).
   - **Cutoff rule.** Each event uses the newest Greco1899 refresh before its lock that passes the two-source check.
     Each prediction file records the manifest path and sha256.
   - **Statement of use.** Forward results enter only as state updates, never as tuning (rule 5).
2. **The UFC 334 decision is Kira's.** There are two options:
   - **(a)** Write the addendum and the tooling before Sat Nov 14, 10:00 pm UTC, and refresh UFC 334 from the Nov 8
     Greco1899 refresh.
   - **(b)** Keep UFC 334 on the fwd-4.3 pinned inputs and start the live version with the Qatar card. No UFC 334
     fighter fought after Oct 31, so (b) costs little on that card. If a late replacement who fought on Nov 7 joins
     UFC 334, (a) becomes worth it.
3. **One live tool, outside data/raw and data/derived proper.** A new tools/live_inputs.py should:
   - fetch the Greco1899 CSVs (User-Agent "FightLabSim/1.0") into `data/derived/live/<cutoff>/raw/` and record the
     upstream commit and file hashes;
   - leave data/raw untouched: its table-cache keys feed every dev tool;
   - check each new bout against ESPN's scoreboard (winner; method class KO/TKO, SUB or decision; round). A bout that
     fails stays out of the live inputs and is listed, and so does an event whose ufcstats round stats are incomplete;
   - run the section 4 update-only paths in this order: fighters.json, market (incremental), ratings roster, ml.json
     roster (+ mr), ml2 roster, methodround extras, oppadj roster, [embed light updates, debut gnet];
   - write `manifest.json`: as_of (last event included), built UTC, sources, each output's sha256, the frozen parameters
     copied, guard results, and per-booked-fighter old vs new values for diagnosis only;
   - never write data/derived/*.json, backtest*, *_oof*, version_history.json, research tables or the vault directory;
   - get committed before `predict`. `forward_ledger.py` already refuses a dirty data/derived.
4. **Odds for the market update.** Use only closing lines of completed fights, captured before the bout:
   - the BFO sportsbook mean, multiplicative no-vig. That is `p_close_mult`'s construction, the same as results.json
     `closing_odds` and odds_upcoming.json `last_pre_start` / `archived_close`, excluding exchanges and anything in-play;
   - a bout without a clean close updates by its result only, as the filter already does when the line is missing.
5. **Embeddings and debut network ratings: decide explicitly.** Catching them up to the cutoff (light updates with frozen
   loadings; `rate()` against the frozen network) is the larger input refresh: 29 unseen 2026 fights on UFC 334 alone.
   It is also closer to how the stat-line tables and the debut model were trained (walk-forward inputs). But it is a new
   builder semantics, so it needs its own line in the addendum. Leaving both at 2026-01-01 is also defensible; say which.
6. **Keep the current date conventions in the first live version.** That means:
   - ratings `ref_day` = the cutoff;
   - market sd drifted to the cutoff;
   - ml2 `snapshot` = the cutoff;
   - league priors recomputed through the cutoff, as the builders do today.

   Then the only change is newer data. Moving ratings drift to the event date would match training better, but it
   changes the inputs of fighters who did not fight, so it is a separate pre-registered choice. If the addendum prefers
   frozen priors instead, `build_db --priors-until 2026-11-01` keeps them at the pinned values.
7. **Seed the seven unseeded debutants now.** Use debutants files for the Qatar, Dec 5 and UFC 335 cards (Lorenz,
   Abdullaev, Rodrigues, Gnizditskiy, Pasley, Humphrey, Conceição), committed before each event's prediction file. This
   needs no version change.
8. **Timing per card.** Greco1899 refreshes Sundays at about 6:00 pm UTC; each lock is the card's earliest start_utc.

   | card | results needed | available (expected) | lock | window |
   |---|---|---|---|---|
   | UFC 334, Nov 14 | Vegas 124 (Nov 7) | Sun Nov 8, ~6:00 pm UTC | Sat Nov 14, 10:00 pm UTC | ~6 days |
   | Qatar, Nov 21 | + UFC 334 | Sun Nov 15, ~6:00 pm UTC | Sat Nov 21, 3:00 pm UTC | ~5.9 days |
   | UFC Fight Night 295, Dec 5 | + Qatar (and any Nov 28 card; none listed as of Nov 6) | Sun Nov 22, ~6:00 pm UTC | no start_utc yet: the tool falls back to 12:00 am UTC Dec 5 | ~11 days |
   | UFC 335, Dec 12 | + Dec 5 | Sun Dec 6, ~6:00 pm UTC | Sat Dec 12, 10:00 pm UTC | ~6 days |

   - If the Greco1899 refresh slips, use the previous cutoff; the manifest's as_of says which. Do not fill the gap with
     ESPN rows: ESPN has no ufcstats round stats, so the profile sums would be inconsistent.
   - Add start_utc for the Dec 5 card when the card is next refreshed.
9. **Do not run any of these in place:**
   - `tools/build_db.py`, `tools/ml.py`, `tools/ratings.py`, `tools/market.py build`, `tools/methodround.py`,
     `tools/ml2.py export|all`, `tools/embed.py`, `tools/debut.py export`, `tools/oppadj.py`, `tools/preufc.py build|eval`;
   - `tools/blindtest.py export` and `tools/forward_models.py`: those two are weights, and rerunning them is a refit.
10. **The page is out of scope here.** No change was made to src/app.js, build.py or the published page. When the live
    inputs exist, a build overlay (for example `python3 build.py --live data/derived/live/<cutoff>`) can inline them, and
    the page copy should show the inputs' as-of date. That is a later, separate change.

## 7. Scope notes

- src/engine3.js, src/params3.js and src/ml/blend.js (the engine v10 workflow) were read only to list what the page
  engine consumes. Nothing in them was changed.
- No dev, backtest or evaluation file was modified (backtest*.json, *_oof.json, version_history.json, research tables),
  and the vault directory was not opened. The only network reads were the six Greco1899 CSVs, the upstream commit list
  (a metadata-only clone), ESPN's Nov 1-7 scoreboard, and reachability probes of ufcstats.com and bestfightodds.com.
