# Changelog

Each engine version records its held-out numbers here (docs/ROADMAP.md). From v4 on, "validation" means UFC fights from
2024-01-01 to 2025-12-31 (version selection only, profiles frozen before each fight) and "train" 2019-2023; every fight from
2026-01-01 is in the sealed vault (docs/BACKLOG.md "Hidden-data protocol"). Older entries that say "test" meant 2024-01-01 to the
snapshot; that window is retired.

## v5.0.1 (2026-11-07): the v5 review's fixes, validated once and REJECTED; v4 (4.0.0) stays

**Status: rejected by the pre-registered decision rule.** src/ holds v4 (hashes = the v4 entry); the work is frozen in
versions/v5.0.1-rejected/ (`versions/v5.0.1` symlink). Train-side detail: research/v501_fixes.md. Numbers:
data/derived/version_history.json (entry v5.0.1), data/derived/evalv/v5.0.1_{train,val,blend}.json,
v5.0.1_vs_v4_val_decide.json, v5.0.1_vs_v4_val_methodround_paired.json.

Timeline (ET; UTC is 5 hours ahead), all on the night of Nov 6: robustness fixes and the train-side work from about 10:20 pm;
train evaluation 11:32 pm; the pre-registration note 11:33 pm, written before the run; the single validation look 11:33 pm; the
decision 11:35 pm. This is the **second look at 2024-25 for the v5 lineage**. The knockdown and dynamics fixes were motivated by
v5's look and its review, so every 5.0.1-vs-v4 and 5.0.1-vs-5.0.0 validation delta below is an upper bound. The forward ledger
and the vault (with its KD / KO exposure, below) are the clean arbiters.

### The review's issues: reproduced, fixed, and whether behaviour changed

| issue (severity) | reproduced | fix | changes backtest numbers? |
|---|---|---|---|
| Durability and styles research scored the 2026 vault (high) | yes: durability.json held 373 vault records, the 2026 KD series rows and held-out tables over 2024-01-01..2026-10-31 (1,503 fights); styles' test had 1,223 decisive incl. 369 in 2026 | moved to the vault directory (durability_vault.json, durability_verify_vault.json, styles_vault.json, styles_verify_vault.json); held-out tables re-scored on 2024-25 only (tools/durability_heldout_dev.py, durability_verify.py and styles_verify.py with a 2025-12-31 end, styles.py on the 2019-2025 backtest.json); reports redacted with a cleanup banner; durability.py now ends held-out scoring at 2025-12-31 and writes vault records to the vault dir; exposure written into the audit pre-registration (docs/V6_V10_PLAN.md 6.5.3): KD / KO / durability results on the vault are not blind, and v6 calibration must not read these numbers | no (the dev backtest records and every 2008-2023 fit are unchanged; styles' engine coefficients identical) |
| v5's KD base rate has a structural cause: the durability L730 level lags breaks (medium) | yes: on train 2023 is the worst year (+8.6%) | per-year KD / KO checks added to the standard evaluation (baseRatesByYear); the three alternatives compared by a pre-registered forward-chained CV inside 2019-2023 (tools/v501_kdlevel_cv.js): L730 kept (RMSE 0.141 vs 0.149-0.175) | no (incumbent kept; `kdBase` has no set) |
| Base-rate gate tolerances below the sampling noise; KO is a coin flip (medium) | yes: the 2024-25 actual KD SE is 0.039 (12% tolerance = 0.082) | tools/evalv_decide.js: paired version-vs-version base-rate test with event-cluster CIs, tolerance = max(registered, 1.96 x SE of the actual); glove-window sensitivity (information only); pre-registered for 5.0.1 before the look | n/a (rule) |
| 2024-25 looked at many times before v5's look (medium) | yes | data/derived/val_look_ledger.json (every known look per component); v6 components selected by train-only forward-chained CV; deltas quoted as upper bounds | n/a |
| "Out-of-fold" tables in-sample for low-dimensional fitted pieces (low) | yes by code reading: mlrates stack weights fit on pooled cv2019-2023 OOF rows, embed calibration on 2010-2023 walk rows, embed hyperparameter CV and preufc exponents on 2019-2023 | not refit in 5.0.1 (the review scopes it "before any v6 merge"); recorded as a v6 gate: fold-honest stack weights / calibration, then rerun Calibrate A's preufc and embed calls and calB on them | no |
| Stacker engine weight learned on v5's in-sample train rows (low) | yes | the bias is stated next to every engine weight (v5 and 5.0.1); a non-zero no-line weight is not cited as evidence | no |
| Stat-line deviance unconditional; Branch 2 without multiplicity control (low) | yes | per-minute deviance conditioned on the real fight length (devpm_*); Holm over the seven registered secondaries | n/a (rule and reporting) |
| Latent leakage: incomplete durability records fall back to live values (low) | yes (0 of 2,864 records incomplete today) | engine labels src record / partial / computed; evalv, predict_eval and durrec refuse anything but full records | no |
| v4_val.json 10-8 actual stale; b7 stored at 4 decimals (low) | yes | corrected actual written into v4_val.json and the v4 history block (old value kept as actual_before_fix); per-fight b7 / cells now 6 decimals; v4 and v5 looks reproduced deterministically with them (v4_repro_dev_val.json, v5-rejected_repro_dev_val.json; pA identical on all 865 fights) | no |
| NaN rates hang simulate or end fights at t = NaN (high) | yes: dur_string_fields looped past 20 s; NaN strikeScale / tdScale gave 20 of 20 LEG wins at t = NaN | checkTables at the end of matchup (throws naming the table), a total-rate check and a 200,000-event cap per round in simulate, invalid record / pre-UFC / embedding inputs treated as missing | no (bit-identical on train) |
| NaN judge score scores the round for B (medium) | yes: power 'abc' gave B 246 of 300 | non-finite judge power falls back; judgeRound / officialsRound throw on a non-finite score | no |
| String-compared dates let live rosters into pre-2024 bouts (medium) | yes: '6/15/2019' and a Date object picked up the durability and embed rosters | one canonical YYYY-MM-DD in matchupBase (Date / timestamp converted, unparsable strings refused), passed to styles_sos via m.opts; officialsTableFor normalises; tests for every accepted form | no |
| Page build runs a different model from Node (medium) | yes for any v5.x: the parity test fails on versions/v5.0.1 (embed / blend modules not bundled, durability / pre-UFC / embed rosters not loaded) | tests/test_page_parity.js (npm run test:page): bundle vs Node summarize() identical, plus component coverage; passes on the shipped v4 page; build.py notes what a v5+ page must bundle | no (v4 page unaffected) |
| Computed durability path ~9% low on knockdowns (medium) | yes: raw computed chin x power 0.79 vs record 0.94 on the live roster | `v501.durFallback`: normComputedChin / Pow (career sums, live roster, a production constant) and ...S (decayed sums, 2019-2023 sides); test within 2% | no (backtests always use full records) |
| Engine takes a global FightParams before its own (low) | yes | Node requires the sibling params3.js / mlrates.js first; params major version must match; evalv checks every worker's engine / params version | no |
| Invalid odds silently become no-line (low) | yes | FightBlend validates odds (finite, abs >= 100, de-vig in (0, 1)) and refuses with "needs a line" | no (package not part of the rule) |
| Rounds not coerced (low) | yes: '5' leaked as a string, 0 became 3 | integer 1..5, title default only when not given | no |
| Director test never runs the v5 paths (low) | yes | FUZZ=1 mode in tests/test_director3.js (rosters, random flags, officials, SOS pairs, dates); `npm run test:director` runs it; passes on 5.0.1 (600 fights, officials on 360) | no |
| Within-fight noise too large, too little shared; flattens win probabilities (high) | yes: fight-level residual / sim sd 0.90 / 0.88, A-B attempts corr 0.59 vs 0.71, own R1-R3 corr 0.59 vs 0.49; train slope 1.18 | `v501.dynNoise`: formOut 0.21 -> 0.15, arSd 0.32 -> 0.24, arPhi 0.85 -> 0.6, formPace 0.45 -> 0.42, roundPace 0.10 -> 0.15, formAcc 0.43 -> 0.40, chosen by realism distance on 2019-2023; `v501.levels` re-levels output and the joint KD / finish / judging levels | **yes** |

### Train 2019-2023 (tuning data; not a selection criterion)

5.0.1 vs 5.0.0 (deterministic reproduction): winner log loss 0.6542 vs 0.6565, -0.0023 [-0.0050, +0.0005]; calibration slope 1.12 vs
1.18; 7-bin +0.0004 and method +0.0009 (n.s.); KD deviance -0.0041 [-0.0077, -0.0005]. vs v4: winner -0.0093 [-0.0143, -0.0039].
Realism (5.0.1 / real): fight-level noise ratios 0.99 / 0.96 / 0.99 (attempts / landed / accuracy), A-B fight attempts corr 0.705 /
0.710, within-round A-B corr 0.661 / 0.660, own R1-R3 corr 0.508 / 0.490. Per-year gate: 2023 KD per 100 head +8% (5.0.0 +8%, v4
-2%).

### Validation 2024-2025 (the single 5.0.1 look), paired against v4

865 fights, 853 decisive, symmetric, 300 sims per order, common random numbers, ML 100%, 0 failures, 2,000 event-cluster resamples.

| validation 2024-25 | v4 | 5.0.0 | **5.0.1** | 5.0.1 - v4 [95% CI] |
|---|---|---|---|---|
| **Winner log loss** | 0.6324 | 0.6301 | **0.6267** [0.6116, 0.6415] | **-0.0057 [-0.0141, +0.0023]** |
| Brier | 0.2206 | 0.2195 | 0.2180 | -0.0026 [-0.0065, +0.0012] |
| Accuracy | 65.7% | 65.3% | 66.6% | +0.9 pts [-1.4, +3.0] |
| ECE / calibration slope | 0.063 / 1.72 | 0.059 / 1.81 | 0.065 / 1.72 | |
| 7-bin | 1.5712 | 1.5741 | 1.5653 | -0.0060 [-0.0321, +0.0194] |
| Method | 0.9399 | 0.9394 | 0.9400 | +0.0000 [-0.0096, +0.0103] |
| who x how x when (methodround) | 2.0707 | 2.0798 | 2.0590 | -0.0117 [-0.0402, +0.0162] |
| Stat-line deviance sig landed / attempts (Holm) | 21.866 / 43.422 | 21.158 / 42.196 | 21.066 / 42.019 | **-0.80 [-1.22, -0.39] / -1.40 [-2.26, -0.56]** |
| TD / control s / KD (Holm) | 1.806 / 154.12 / 0.652 | 1.758 / 150.00 / 0.651 | 1.763 / 149.78 / 0.653 | **-0.043 [-0.066, -0.020] / -4.34 [-7.23, -1.49]** / +0.002 n.s. |
| Per-minute deviance (real length; information) sig landed / attempts / TD / control / KD | | | | -0.29* / -0.48* / -0.042* / -4.69* / -0.002 (* CI excludes 0) |

vs model S: who x how x when +0.0172 [-0.0097, +0.0444] (v4 +0.0289 and v5 +0.0380, both CIs excluding 0); winner +0.0054
[-0.0029, +0.0140]. 5.0.1 is the first engine level with S on who x how x when.

| base rate (paired test vs v4) | actual | v4 | 5.0.1 | D = abs err new - old [95% CI] | tolerance (max of registered, 1.96 SE) | verdict |
|---|---|---|---|---|---|---|
| KO share | 29.1% | 30.6% | 31.7% | +1.1 pts [-1.0, +1.5] | 2.96 pts | pass |
| SUB share | 16.9% | 17.9% | 18.1% | +0.2 [-0.3, +0.4] | 2.5 | pass |
| R1 / R3 share of 3-round finishes | 52.3 / 17.4% | 51.4 / 18.7% | 54.2 / 17.9% | +0.9 / -0.9 n.s. | 4.6 / 3.8 | pass |
| SD + MD share of decisions | 18.5% | 20.6% | 22.1% | +1.5 [-1.5, +1.7] | 4.0 | pass |
| **KD per 100 head landed** | 0.684 | 0.746 | **0.827** | **+0.081 [+0.059, +0.095]** | 0.082 (abs err 0.143) | **fail** |
| sig landed / TD / control per 15 | 58.1 / 1.41 / 168 | 63.3 / 1.31 / 163 | 61.8 / 1.39 / 174 | -1.51* / -0.08 / +1.3 | 3.5 / 0.14 / 16.8 | pass |

Blend test (MoE stacker refit on 2019-2023 with 5.0.1's train rows, 845 fights): engine weight 0.105 with the close (blend -0.0002
[-0.0011, +0.0008]) and 0.182 without a line (-0.0015 [-0.0031, +0.0003]); both n.s. The weights are learned on train rows that are
in-sample for 5.0.1's train-fit levels, so they are biased upward and are not evidence of value.

### Decision: 5.0.1 is rejected (v4 stays)

- Branch 1 fails: winner -0.0057 [-0.0141, +0.0023].
- Branch 2 fails on its base-rate condition: the winner is not worse and sig landed, attempts, TD and control deviance are better
  after Holm, but KD per 100 head drifts out of tolerance by the paired test (5.0.1's error exceeds v4's with a CI above 0, and the
  error 0.143 exceeds the tolerance 0.082).
- v5's registered rule gives the same verdict (KO and KD out). Re-analysing v5's own look under the 5.0.1 rule also rejects it
  (KD fails; KO passes), as the review predicted.
- Information only (never a rule input): by window, simulated vs actual KD per 100 head is 0.86 / 0.61 (Jan-May 2024), 0.84 / 0.54
  (glove trial, Jun 1-Nov 15, 2024), 0.80 / 0.63 (Nov 16, 2024-Feb 14, 2025) and 0.81 / 0.83 (Feb 15-Dec 31, 2025); by year 0.85 /
  0.57 (2024) and 0.81 / 0.81 (2025). KO share 32.4% / 27.3% (2024), 31.0% / 30.8% (2025). The paired test without the glove window
  passes KD and fails SD+MD.
- Descriptive 5.0.1 vs 5.0.0 on validation: winner -0.0035 [-0.0072, +0.0003], nothing else significant.

### Read this honestly

1. **The dynamics fix worked as designed and helped the winner a little; it did not touch the reason v5 failed.** The noise now
   matches the real fights on train, the train slope fell from 1.18 to 1.12, and 5.0.1 is the best engine yet on 2024-25 winner log
   loss (0.6267) and the first level with model S on who x how x when. None of those gains is significant, and all are upper bounds.
2. **The knockdown excess is a 2024 phenomenon.** 2025 is level; 2024 runs 49% hot. The forward-chained train check found no
   level tracker that predicts year-to-year swings better than L730, so the fix the review hoped for (a smarter level) has no train
   support. The likely real answer is an era / equipment break (the 2024 glove trial and the low early-2024 rate), which is v9's
   tracker and variance-bump work. Choosing a tracker on 2024-25 now would be fitting the failure.
3. **The rule change was requested by the review and pre-registered, and it did not decide anything.** Under either gate the
   verdict is the same; KO stopped being a coin-flip failure, KD is a real one.
4. **The vault is now known to be partly seen.** The durability / styles exposure means KD / KO / durability results on the vault
   cannot confirm anything; winner-level and stat-line questions are unaffected beyond the earlier list.
5. **For v6:** rebuild from versions/v5.0.1-rejected/ (it carries every v5 component plus these fixes, flag-isolated); fix the
   in-sample "OOF" pieces first; keep the per-year gate; ship a page that passes tests/test_page_parity.js; treat the KD level as a
   v9 era question unless train CV finds a tracker.

### Restore and tests (on the restored src/)

- src/engine3.js, params3.js, ml/mlrates.js copied from versions/v4 (sha256 6c661f68..., e16a6481..., b563032d... = the v4 entry);
  tests/test_engine3.js is v4's again; the 5.0.1-engine tests moved to versions/v5.0.1-rejected/tests/.
- `node tests/test_engine3.js 8000`: 69 passed. `node tests/test_director3.js 300`, `NO_ML=1 ... 100` and `FUZZ=1 ... 200` (stock
  matchups on v4): OK. `node tests/test_page_parity.js`: 11 passed (the page bundle = Node on v4).
- On 5.0.1 before the restore: test_engine3 81, test_v501 13, test_v501_guards 29, test_durlevel 8, test_v401 15, test_v5_step2-5,
  test_v5_calA / calB, test_durability, test_dynamics, test_styles_sos, test_officials, test_realism_sens, test_blend_anchor all
  pass; director stock / NO_ML / FUZZ 600 OK.
- src/ml/blend.js keeps the odds validation (1.1.1); src/styles_sos.js and src/ml/embed.js are unchanged and unused by v4.
- New tools: tools/evalv_decide.js, tools/v501_dynfit.js, tools/v501_real_rounds.py, tools/v501_kdlevels.py, tools/v501_kdlevel_cv.js,
  tools/durlevel_fit.js, tools/durability_heldout_dev.py; tools/evalv.js extended (per-minute deviance, per-year / per-window base
  rates, 6-decimal per-fight stats, version checks, record guard).
- Nothing from 2026 was read for any fit or score. Vault files were moved without being read, except two quick structure checks of
  the moved styles file (its decisive-test count, and a field comparison that printed a few pooled 2024-2026 style-modifier
  deviance changes; no KD / KO level). The agent had seen the review's quoted 2026 KD / KO levels; no fit or rule used them.

### Every v5 component: what it does, its train ablation, and where it stands

| component (flag) | what | train ablation (Calibrate A, leave-one-out, soft CE vs the close; + = removing it hurts) | 2024-25 status |
|---|---|---|---|
| v401.emJudge | EM judging weights refit on 2015-2023 cards, judge noise / 10-8 rule refit | -0.0001 (would go off; kept for the protocol: its off state uses cards through 2026-10) | in v5 / 5.0.1 |
| v401.deductions | point deductions | neutral; 7-bin +0.0194 [+0.0067, +0.0345] without them (draws) | in |
| v401.mlLevels | learned-path TD / control / sub levels | -0.0001, levels overshoot with embed: **off** | off |
| v401.tdCap | cumulative takedown-multiplier cap | neutral; kept on secondaries (20 of 3,998 sides) | in |
| v401.koTargets | KO/TKO composition targets from 2019-2023 | neutral; method x round +0.0027 [+0.0001, +0.0051] without | in |
| durability | knockdown chin / power model, absolute L730 level | +0.0009 [+0.0004, +0.0015] | in; its level is the 2024 KD excess |
| dynamics | fight dynamics (pace, AR(1) noise, momentum, KD by round) | +0.0002 n.s. (structure, kept) | in; noise refit in 5.0.1 |
| styles_sos (SOS "wf") | strength of schedule | +0.0009 [+0.0004, +0.0015] vs neither; oppadj instead +0.0005 n.s. | in |
| officials | named judges / referees | not ablated (off; named-judge effects do not predict) | off, opt-in |
| realism_sens | division / format factors + FightEngine.sensitivity | not ablated (factor layer off) | capability only |
| embed | embedding blend of the learned targets | +0.0038 [+0.0030, +0.0047] (largest) | in |
| oppadj | opponent adjustment of the learned targets | off (exclusive with SOS) | off |
| preufc | pre-UFC finish-odds priors for newcomers | +0.0004 [-0.0000, +0.0009]; winner, 7-bin, method worse without | in |
| blend_anchor | FightEngine.predict (the package) | acts only in predict; train OOF vs the simulator alone: winner -0.0229, 7-bin -0.0450 | package scored once with v5 (close 0.5810, beats the close by -0.0067 [-0.0096, -0.0036]); not re-scored for 5.0.1 |
| calB | the joint KD / finish / stoppage / judging level pass | outcome-neutral on train | in (5.0.1 redid it on top of dynNoise) |
| v501.* (5.0.1) | durFallback, dynNoise, levels (kdBase no set) | 5.0.1 vs 5.0.0 on train: winner -0.0023 [-0.0050, +0.0005], KD deviance -0.0041* | validation: rejected (KD) |


## v5 (2026-11-07): the merged roadmap engine, validated once and REJECTED; v4 (4.0.0) restored

**Status: rejected by the decision rule.** (Update, Nov 7: the review's fixes were measured as v5.0.1 above, also rejected; the
table "Every v5 component" in the v5.0.1 entry lists each component, its train ablation and its status. Re-analysed under v5.0.1's
paired base-rate test, v5's verdict stands: KD fails, KO passes.)
- Timeline (ET; UTC is 5 hours ahead): the validation look ran once at 8:51 pm on Nov 6, paired against v4. The package scoring
  followed at 8:54 pm, and the decision was made at 9:10 pm.
- src/engine3.js, src/params3.js and src/ml/mlrates.js are back to versions/v4/; the hashes match the v4 entry (6c661f68...,
  e16a6481..., b563032d...).
- tests/test_engine3.js and data/derived/v4_levels.json are back to the v4 final commit 122c31a.
- The work is kept in versions/v5-rejected/:
  - the frozen files, unchanged;
  - the thirteen tests that need the v5 engine in src/;
  - the v5-era v4_levels.json;
  - logs.
- `versions/v5` is a symlink to it, so the first vault audit (pre-registered scope: v5 vs v4 paired) and the tools keep working.
- **The current engine is v4.** Results are in data/derived/version_history.json (entry v5: `validation`, `validation.package`,
  `blend`, `methodround_paired_vs_v4`, `decision`) and data/derived/evalv/v5_*.

Setup: `nice -n 5 node tools/evalv.js --version v5 --split val --sims 300 --workers 3 --compare v4`.
- Before the run, a pre-flight check built every one of the 865 validation fights' inputs on versions/v5 with no simulation and
  no outcome read. That covers the OOF learned rates (all from the dev model), durability records, SOS pairs and step-4 inputs.
- The decision rule and the base-rate tolerances were written into the history note before the run.
- The run covered 865 fights: 853 decisive, 857 with an outcome. It was symmetric, with common random numbers, 300 sims per
  order, ML applied to 100% of matchups, 0 failures, and 2,000 event-cluster resamples.

### Validation 2024-2025 (one look), paired against v4

| validation 2024-2025 | v4 | v5 | v5 - v4, paired [95% CI] |
|---|---|---|---|
| **Winner log loss** | 0.6324 [0.6165, 0.6474] | 0.6301 [0.6155, 0.6435] | **-0.0022 [-0.0099, +0.0053]** |
| Brier | 0.2206 | 0.2195 [0.2126, 0.2260] | -0.0011 [-0.0046, +0.0024] |
| Accuracy | 65.7% | 65.3% [62.0, 68.6] | -0.4 pts [-2.8, +2.1] |
| ECE (resampling spread) / calibration slope | 0.063 / 1.72 | 0.059 [0.039, 0.095] / 1.81 [1.52, 2.18] | |
| 7-bin log loss | 1.5712 | 1.5741 [1.5283, 1.6238] | +0.0029 [-0.0224, +0.0287] |
| Method log loss | 0.9399 | 0.9394 [0.9106, 0.9696] | -0.0005 [-0.0107, +0.0100] |
| who x how x when (methodround) | 2.0707 | 2.0798 | +0.0091 [-0.0188, +0.0396] |
| Stat-line deviance: sig landed / attempts | 21.866 / 43.422 | 21.158 / 42.196 | **-0.708 [-1.131, -0.293] / -1.225 [-2.100, -0.376]** |
| Stat-line deviance: TD / control s / KD | 1.806 / 154.12 / 0.652 | 1.758 / 150.00 / 0.651 | **-0.048 [-0.072, -0.025] / -4.12 [-7.22, -1.43]** / -0.001 [-0.015, +0.014] |
| MAE per fighter: sig landed / TD / KD | 25.01 / 1.057 / 0.3206 | 24.43 / 1.049 / 0.3242 | -0.58 [-0.89, -0.25] / -0.008 [-0.016, -0.000] / +0.004 [+0.000, +0.007] |

The methodround metrics come from `methodround.py --score` on 857 fights. The v5 - v4 column is
data/derived/evalv/v5_vs_v4_val_methodround_paired.json.

| validation 2024-2025 | model S | v4 (vs S) | v5 (vs S) | v5 - v4 |
|---|---|---|---|---|
| who x how x when | 2.0418 | 2.0707 (+0.0289 [+0.0015, +0.0575]) | 2.0798 (+0.0380 [+0.0068, +0.0742]) | +0.0091 [-0.0188, +0.0396] |
| method x round | 1.4240 | 1.4327 (+0.0087) | 1.4368 (+0.0128 [-0.0051, +0.0293]) | +0.0041 [-0.0097, +0.0193] |
| method given winner | 0.9073 | 0.9107 (+0.0034) | 0.9063 (-0.0009 [-0.0195, +0.0189]) | -0.0044 [-0.0164, +0.0088] |
| finish vs decision | 0.6593 | 0.6617 | 0.6593 (0.0000) | -0.0024 [-0.0096, +0.0053] |
| winner | 0.6213 | 0.6324 (+0.0111 [+0.0024, +0.0198]) | 0.6301 (+0.0089 [+0.0004, +0.0168]) | -0.0022 [-0.0098, +0.0049] |

| base rate, validation (mlcal tolerance) | actual | v4 | v5 | v5 status |
|---|---|---|---|---|
| KO/TKO share (2 pts) | 29.1% | 30.6% (+1.5) | 31.8% (+2.7) | **newly out** |
| SUB share (1.5 pts) | 16.9% | 17.9% (+1.0) | 18.1% (+1.2) | in |
| R1 / R3 share of 3-round finishes (3 pts) | 52.3 / 17.4% | 51.4 / 18.7% | 54.5 / 17.5% | in |
| SD + MD share of decisions (4 pts) | 18.5% | 20.6% | 20.8% | in |
| KD per 100 head landed (12%) | 0.684 | 0.746 (+9.0%) | 0.830 (+21.3%) | **newly out** |
| sig landed per 15 (6%) | 58.1 | 63.3 (+9.0%) | 61.7 (+6.2%) | out (as v4), closer |
| TD per 15 (10%) / control s per 15 (10%) | 1.41 / 168 | 1.31 (-7.1%) / 163 (-2.9%) | 1.39 (-1.5%) / 174 (+3.5%) | in, closer |
| finish rate / 10-8 share of decision judge-rounds (no tolerance set) | 46.0% / 2.46% | 48.5% / 3.38% | 49.9% / 4.53% | further off |
| finish by round, 3-round / 5-round | 23.7/13.7/7.8; 15.2/16.2/9.5/7.6/2.9 | 24.6/14.4/9.0; 14.5/12.4/10.1/9.2/5.4 | 26.7/13.7/8.6; 19.3/15.6/9.3/7.8/4.5 | |
| decisions UD / SD / MD (n = 459) | 81.5 / 18.1 / 0.4 | 79.4 / 20.1 / 0.5 | 79.2 / 20.0 / 0.9 | |

**Blend test** (tools/evalv_blend.py: MoE linear stacker refit on 2019-2023 with v5's engine rows, scored on 845 fights of
2024-25):

| blend pattern | v4 engine weight | v5 engine weight | v5: with engine | without | with - without [95% CI] |
|---|---|---|---|---|---|
| with the closing line | 0.037 | 0.070 | 0.5787 | 0.5788 | -0.0001 [-0.0007, +0.0005] |
| without a line | 0.000 | 0.088 | 0.5924 | 0.5930 | -0.0006 [-0.0013, +0.0002] |

v5 is the first engine with a non-zero validated weight without a line. Neither blend moves measurably.

### The prediction package (FightEngine.predict), scored once on validation

How it was scored:
- The stacker was refit first: `BLINDTEST_MOE_ENGINE=engine_v5 python3 tools/blindtest.py export --fit-through 2023-12-31
  --stack-out data/derived/blindtest_stack_pre2024_v5.json`.
  - It uses the production stackers' configuration, fit on 2019-2023 out-of-sample rows only.
  - Its engine weight is 0.070 with the close, 0.175 with the opener and 0.088 without a line (the engine_v4 pre-2024 stacker:
    0.04 / 0.09 / 0).
  - The default data/derived/blindtest_stack_pre2024.json is unchanged.
- New tools/predict_eval.js ran `node tools/predict_eval.js --version v5 --split val --stack
  data/derived/blindtest_stack_pre2024_v5.json --kinds close,open,none --anchor --sims 1000`, which took 393 s.
  - It used predict's defaults: 1,000 sims per order, mrWeight 0.30, a linear pool, recalT 1 and the calibrated interval with
    kappa 2.15.
  - Inputs: evalv's matchup inputs plus tools/predictrec.js (walk-forward experts from the blind replay, S / SM cells fit through
    2023, ML v2 rows).
  - 865 fights, 0 failed. lineKind close / open falls back to 'none' on the 9 / 11 fights without that line.
  - The table's paired differences are on the 844 decisive fights that have every benchmark.
  - The plumbing was checked first on 40 and then 20 train fights only (in-sample).

| validation 2024-25 | winner log loss (853 decisive) | Brier | ECE / slope | 7-bin | method | who x how x when (vs S) |
|---|---|---|---|---|---|---|
| **package, closing line** | **0.5810** | 0.1986 | 0.043 / 1.12 | 1.5062 | 0.9271 | 1.9943 (-0.0475 [-0.0675, -0.0279]) |
| **package, opening line** | **0.5868** | 0.2010 | 0.024 / 1.26 | 1.5118 | 0.9286 | 1.9999 (-0.0419 [-0.0582, -0.0264]) |
| **package, no line** | **0.5930** | 0.2039 | 0.037 / 1.29 | 1.5180 | 0.9276 | 2.0060 (-0.0358 [-0.0495, -0.0206]) |
| market close (n=844) | 0.5847 | 0.2002 | 0.025 / 1.11 | | | |
| market open (n=842) | 0.6092 | 0.2107 | 0.029 / 1.31 | | | |
| ML logistic (walk-forward, the stack's `ml`) | 0.6053 | 0.2085 | 0.050 / 1.49 | | | |
| ML v2 logistic (static fit < 2024) | 0.5881 | 0.2011 | 0.047 / 1.46 | | | |
| Elo (walk-forward) | 0.6768 | 0.2421 | 0.021 / 1.14 | | | |
| model S (no line) | 0.6193 | 0.2146 | 0.060 / 1.61 | 1.5504 | 0.9339 | 2.0418 |
| model SM (with the close) | 0.5808 | 0.1983 | 0.018 / 1.15 | 1.5123 | 0.9301 | |
| simulator inside predict (1,000 sims per order) | 0.6278 | 0.2184 | 0.061 / 1.86 | 1.5568 | 0.9368 | 2.0506 (+0.0088 n.s.) |

Paired winner log loss, package minus benchmark:

| package | vs close | vs open | vs ML logistic | vs ML v2 | vs Elo | vs S | vs SM | vs simulator |
|---|---|---|---|---|---|---|---|---|
| closing line | **-0.0067 [-0.0096, -0.0036]** | -0.0311 | -0.0243 [-0.0420, -0.0066] | -0.0071 [-0.0220, +0.0081] | -0.0958 | -0.0384 | +0.0002 [-0.0074, +0.0075] | -0.0469 |
| opening line | -0.0008 [-0.0124, +0.0102] | **-0.0252 [-0.0325, -0.0178]** | -0.0185 [-0.0313, -0.0056] | -0.0013 [-0.0111, +0.0092] | -0.0900 | -0.0326 | +0.0060 [-0.0044, +0.0173] | -0.0410 |
| no line | +0.0054 [-0.0111, +0.0220] | -0.0190 [-0.0341, -0.0044] | -0.0123 [-0.0222, -0.0015] | +0.0049 [-0.0019, +0.0122] | -0.0838 | -0.0264 | +0.0122 [-0.0017, +0.0272] | -0.0349 |

Further results:
- Method and round, against S (paired): 7-bin -0.044 / -0.039 / -0.032 and method -0.007 / -0.005 / -0.006, for close / open /
  none. All 7-bin CIs exclude 0, and the no-line method CI excludes 0.
  - Against SM, the close package is level: 7-bin -0.006 [-0.017, +0.003].
  - Against the simulator alone, the package is better everywhere: 7-bin -0.04 to -0.05, joint -0.04 to -0.06.
- Anchor mode (opts.anchor): same winner. Its cells are level or slightly worse than the plain package's (7-bin 1.5073 / 1.5150
  / 1.5196 vs 1.5062 / 1.5118 / 1.5180). That fits its role, which is fights shown on the page, not scoring.
- Interval coverage of the closing line (calibrated):
  - no line: 77.1% at 80%, 92.9% at 95%; open line: 75.2% / 91.2%. Train out-of-fold was 79.6% / 94.2%, so it is a little narrow
    on 2024-25.
  - With the close as an input, coverage is 92% / 99% (trivially wide).
  - The interval uses moe_page.json's feature LR (coef_valid, fit 2010-2023) for profile noise. Its shrinkage priors are division
    rates 2021-2025; that is a disclosed blemish on the interval width only. Every point estimate used the blind replay's
    walk-forward feat_lr.
- Package KO share 32.6-32.9% vs 29.1% actual. The pool carries the simulator's and S's KO excess.

### Decision: v5 is rejected (v4 restored)

- Branch 1 fails: winner log loss -0.0022 [-0.0099, +0.0053], and the CI includes 0.
- Branch 2 fails on its base-rate condition.
  - v5 is not worse on the winner, and it is clearly better on four stat-line deviances (sig landed, attempts, TD, control; CIs
    exclude 0).
  - But two base rates that v4 kept inside the mlcal tolerances drift out of them:
    - KD per 100 head landed: +21.3% vs 12%.
    - KO/TKO share: +2.7 pts vs 2.
  - 7-bin, method and who x how x when are n.s. either way.

### Read this honestly

1. **Most of the KO miss is the 2024 glove trial, but the rule was applied as written.** This comes from the stored cells of this
   look, with no new simulation; the dates are in research/model_eradrift.md.

   | window | KO share actual | v4 | v5 |
   |---|---|---|---|
   | 2024-01-01..05-31 (n=168) | 30.4% | 31.3% | 33.4% |
   | glove trial 2024-06-01..11-15 (n=217) | 22.1% | 30.7% | 31.9% |
   | 2024-11-16..2025-02-14 (n=80) | 35.0% | 31.3% | 31.1% |
   | 2025-02-15..12-31 (n=392) | 31.1% | 30.1% | 31.1% |

   - Outside the trial, v5's KO share is level with actual (31.7% vs 31.4%).
   - KD per 100 head cannot be split by period without re-simulating, because evalv stores no per-fight KD. eradrift reports an
     actual 0.54 in the trial, 0.68 before it and 0.87 from Feb 15, 2025.
   - Reading the tolerance only outside the trial would be a choice made after seeing the numbers. The registered rule covers the
     whole window, so the verdict stands.
2. **v5's knockdown level moves the wrong way out of sample.**
   - On train, Calibrate B matched KD per 100 head at 0.780 (actual 0.782). On 2024-25, v5 simulates 0.830 while v4 dropped to
     0.746.
   - Hypothesis, not tested: durability's absolute tracked league level (trailing 730 days) carries the high 2022-23 level into
     2024-25, while v4's walk-forward 5-year priors follow the era down.
   - Any fix must be chosen on train or forward-chained CV. 2024-25 has now been seen, and the vault audit is the clean test.
3. **The stat-line gains are real and the winner gain is not.**
   - Four of five deviances improve with CIs excluding 0 (control -4.1 s, sig landed -0.71), and TD and control levels move inside
     tolerance.
   - The winner leans better (-0.0022) but is n.s.
   - v5 is more underconfident than v4 (slope 1.81 vs 1.72) and still trails model S on who x how x when (+0.038, the CI excludes
     0).
4. **The engine is still close to irrelevant for the winner; the package is not.**
   - The blend test gives v5 small weights (0.070 / 0.088), and the blend moves by -0.0001 / -0.0006 (n.s.).
   - The predict package with a closing line beats the close (-0.0067 [-0.0096, -0.0036]). With an opener it ties the close, and
     without a line it is level with the close and with ML v2's logistic.
   - On method x round it beats S on every line kind, but it does not beat SM when the close is available.
   - Those gains come mostly from the stack (market, ML) and S/SM. How much the v5 cells add on 2024-25 was not measured, to avoid
     an extra look at a sub-choice. On train they added -0.005 joint (research/v5_calB.md).
   - The package needs blend_anchor, a v5 component, so the restored v4 has no FightEngine.predict. The page and the forward ledger
     (fwd-4.2 pins versions/v4) are unaffected.
5. **The look was not perfectly clean.** Several v5 ingredients had been scored on 2024-25 before it: embed (-1.67% stat-line
   deviance), preufc (newcomer bouts), and officials, which is off. Every v5 parameter was fit on 2019-2023. The contamination
   would flatter v5, so it does not soften the rejection.
6. **For v6:**
   - Rebuild from versions/v5-rejected/. The components are flag-isolated, and the tests restore with the engine.
   - The knockdown level should track the era on a walk-forward basis (or run durability in relative mode), chosen on train or
     CV only.
   - v6 then makes its own single look. The first vault audit keeps its pre-registered v5 vs v4 paired line.

### Restore and tests (on the restored src/)

- `node tests/test_engine3.js 8000`: 69 passed, 0 failed.
- `node tests/test_director3.js 300`: OK, engine 4.0.0, 300 of 300 matchups with learned rates. `NO_ML=1 ... 100`: OK.
- Still passing: test_mlrates 47 OK, test_mlcal 33, test_v5_calA 14 (frozen fixtures), test_embed OK, test_moe 21, test_mlpage 5,
  test_blindtest_stack PASS, test_ml2 365, test_statdist 3,059, test_calib 14, test_forward_models PASS, test_forward_v42 457,
  test_debut 23, test_finishing 371, test_propspool 732, test_eradrift 2,283.
- Moved to versions/v5-rejected/tests/, because they need the v5 engine in src/ and failed only for that reason: test_v401,
  test_v5_step2..5, test_v5_calB, test_durability, test_dynamics, test_styles_sos, test_officials, test_realism_sens,
  test_blend_anchor, and v5's test_engine3.js.
- `python3 build.py <tmp>` builds (10.3 MB). A sandbox load of the page's engine script (params, mlrates, styles_sos.js, then the
  v4 engine) simulates Volkanovski vs Gaethje at 69.0% Volk with learned rates. The published page was not rebuilt.
- tools/blindtest.py now lists engine_v5 as REJECTED, so default exports keep engine_v4. src/styles_sos.js, src/ml/embed.js and
  src/ml/blend.js stay in src/, unused by v4.
- Nothing from 2026 was read. The one new fit (the engine_v5 pre-2024 stacker) used 2019-2023 rows only.

## v5 merge log

Sequential, tested merge of the v5 components onto engine v4.0.0. Every component sits behind its own
`params.components.<name>` flag, and with the flag off the engine reproduces the engine before that step for fixed seeds.
No validation (2024-2025) number is computed in these steps; the Measure stage takes v5's single look.

### Step 1 (Nov 6, 5:00 pm ET): v4.0.1's deferred train-only fixes, `components.v401`

- **Base.** src/engine3.js, src/params3.js and src/ml/mlrates.js matched versions/v4/ by sha256 (the v4 entry in
  data/derived/version_history.json) before any edit.
- **Applied, ported by hand from versions/v4.0.1-rejected/, one sub-flag each (all default on until the Calibrate stage's
  train leave-one-out):**
  - (a) `emJudge`: EM judging weights refit on the 5,519 cards of 2015-2023 (data/derived/judge_em_train.json). The judges'
    noise and 10-8 KD term refit on those weights go with them (data/derived/judgecal_v401.json), and so does the 10-8
    threshold t108 8.31. t108 belongs here, not to (c), because it moved with the weight and noise scale.
  - (b) `deductions`: judge.ded 0.00515 per fighter-round and ded2 0.075, drawn after the last round.
  - (c) `mlLevels`: mlTdLevel 1.067, mlCtrlLevel 1.053 and mlSubLevel 1.083. The same tools/v4_levels.js run gave the
    companion values: kdScale 1.383, kdInstant 0.3623, kdRefStop 0.1807, stko 0.03565, gnpTko 0.03005 and subConvScale
    1.697 (data/derived/v4_levels_v401.json).
  - (d) `tdCap`: mlMaxRatio caps the cumulative takedown-attempt multiplier and the takedown-odds one
    (src/ml/mlrates.js `opts.cumCap`).
  - (e) `koTargets`, new: the self-calibration's KO/TKO composition targets now come from 2019-2023 fights
    (tools/ko_composition.py -> data/derived/ko_composition_pre2024.json).
    - New targets: ground 28.6%, clinch 7.1%, standing stoppage without a KD 7.2%. The old ones were 28 / 12.5 / 7.
    - The clinch target is the big move, and it is a labelling break, not a trend. ufcstats calls 22-26% of strike
      KO/TKOs "In Clinch" in every year from 2015 to 2018, and 5-10% in every year from 2019 to 2023. 2015-2023 together
      gives 14.4%. 2019-2023 was adopted because it is the train window and one labelling regime.
    - tools/v401_kocomp.js turns the targets into factors (`params.v401.koComp`): kdScale x1.11, kdPos[1] (clinch) x0.50,
      gnpTko x1.023, stko x1.051, kdInstant / kdRefStop odds x0.988. Method: refit only the KO block twice, once to the old
      targets and once to the new ones, on league-average LW pairs (train priors, learned rates off, common random numbers).
      KD per head strike and KD-to-finish are held fixed. Each factor is the ratio of the two fits.
    - Train fights, learned rates on, 12 sims each: the clinch share of strike KO/TKOs moves 13.8% -> 8.5% (actual 7.1%).
      Ground moves 25.3 -> 25.8% (actual 28.6), standing without a KD 8.2 -> 8.9% (actual 7.2), and KD per 100 head
      0.790 -> 0.777 (actual 0.782). KO share stays 31.8% (actual 31.7).
- **Mechanics.**
  - The usual params fields hold the flag-on values, and `params.v401.off` holds v4.0.0's.
  - `resolveParams` runs inside `matchupBase`. For each sub-flag that is off it puts v4.0.0's values back, before
    `opts.params`, so an explicit override still wins. The koComp factors are applied after the overrides.
  - New exports: `FightEngine.resolveParams` and `v401Flags`. `deductions` is exported as in v4.0.1.
  - A fight carries `nDed`, and a summary carries `dedPerDecision`, only when deductions are on.
  - The mlrates league-expectation cache key now includes the resolved components flags.
  - Engine VERSION is "5.0.0-dev" and params version "5.0.0-dev.1-selfcal-pre2024"; the freeze sets 5.0.0.
  - The trace format and the API are unchanged otherwise.
- **Conflicts.** None. The step applies to the v4.0.0 base, and the v4.0.1 code was re-applied behind the flags. The
  deductions function, its placement and the `levels` option keep v4.0.1's text. comp/dynamics was built on v4.0.1, so
  this should keep its 3-way merge small.
- **Tests (all pass).**
  - New `node tests/test_v401.js`: 15 passed.
    - v401 off reproduces versions/v4 bit for bit on 450 matchups: whole fight JSON including traces (4,500 fights) and
      45 summaries. Three groups: random pairs with the production learned rates, random pairs on the plain tables, and
      2019-2023 backtest fights in both corner orders with out-of-fold rates.
    - Sub-flags a-d on (koTargets off) reproduce versions/v4.0.1-rejected on 1,000 fights.
    - Every sub-flag changes fights on its own. emJudge and deductions leave each fight unchanged up to the cards.
  - `node tests/test_engine3.js 8000`: 81 passed, 0 failed. The judge-weight check now checks the pre-2024 fit, and
    v4.0.1's deduction, cap and level checks were added with flag-off variants.
  - `node tests/test_director3.js 300`: OK; 300 of 300 matchups ran with learned rates, 8 fights had a deduction.
    `NO_ML=1 ... 100`: OK.
  - `node tests/test_mlrates.js`: 47 checks OK. `node tests/test_mlcal.js`: 33 passed.
- **Draw and MD targets for (b), train 2019-2023, one corner order, 20 sims per fight.** Actual: draws 1.01% of fights,
  MD 2.04% of decisions.

  | config | draws | MD |
  |---|---|---|
  | v4 | 0.28% | 0.56% |
  | (a) alone | 0.28% | 0.59% |
  | (b) alone | 0.67% | 0.96% |
  | all on | 0.60% | 0.95% |

  - Deductions close about half of each gap. 10-10 rounds do not explain the rest: there is 1 in 11,652 judge-rounds in
    2019-2023.
  - Likely causes, for Calibrate: the 2019-2020 10-8 era (judgecal threshold 6.15 vs 6.91), and how 10-8s fall in close
    fights.
  - The card-implied 10-8 share is 4.5% with all on (cards 5.29% on train).
- **Stance freeze: not done, not cheap.**
  - data/raw/ufc_fighter_tott.csv is one current snapshot, with one stance per fighter (2,768 Orthodox, 609 Southpaw,
    219 Switch, 1,023 blank). No earlier record exists in the repo to freeze from.
  - The fix needs an archived tale-of-the-tape snapshot, then a rebuild of backtest_dev.json and of the learned-rate
    tables (mlrates_oof.json, mlrates_dev.json), because stance is a feature.
  - Until then, the small look-ahead stays accepted and documented.
- **For the Calibrate stage.**
  - Pass the sub-flags per arm through `opts.params.components.v401`, for example `{ emJudge: false }`.
  - The tools that rewrite params in place write the usual (flag-on) fields: tools/v4_levels.js --write, tools/judgecal.js
    --write and tests/test_engine3.js --fit --write. Run them with the sub-flag on, or drop a rejected sub-flag first.
  - After a full `--fit --write` with koTargets on, set `params.v401.koComp` to 1.

### Step 2 (Nov 6, 6:00 pm ET): durability, then dynamics (`components.durability`, `components.dynamics`)

- **Base.** The step-1 commit 9656818 (src/engine3.js sha256 271b9b42...). A first run of this step was killed by a container
  restart at ~22:22 UTC after merging both components (autosaves 69b949c..3b7967e). This run re-did the merge independently and
  got the same result: engine3.js byte for byte; params3.js differs only where the earlier run resolved the duplicate key (below).
- **Durability** (scratchpad/components/durability_v4main.patch + durability_evalv_v4main.patch).
  - Merged as a 3-way merge: base versions/v4, ours = step 1, theirs = v4 + the patch, which applies to v4 with no offsets.
  - One conflict, the export line: kept step 1's `deductions` and added `loadDurability`.
  - In params3.js the patch brings its own `components: { durability }` object. Left as is, it would be a second `components`
    key and would silently drop `v401`. It is folded into step 1's `components` block.
  - Settings as verified: flag on, `engineWeight` 0.5, absolute tracked league level (`durability.level` 0.010274, trailing
    730 days), `kdCal` 1.1639618.
  - tools/evalv.js: the walk-forward records plus the train NORM. The evalv patch's hunk is identical to the main patch's.
- **Dynamics** (scratchpad/components/dynamics_v4.0.0_port.patch), applied on top as a 3-way merge with no conflicts.
  - `dyn.stkoHurtGate` stays false.
  - New: the AR(1) autocorrelations `dyn.arPhi` / `dyn.accArPhi` are clipped to [0, 0.999] in `dynTables`. Their valid range
    is [0, 1); phi >= 1 made sqrt(1 - phi^2) NaN. The defaults 0.85 / 0.73 pass through unchanged.
- **Tests adapted to the merge order.**
  - test_durability compares flag off with tests/fixtures/engine3_pre_durability.js, which is the step-1 engine. It switches the
    later components off, and its pure-hazard cases use the resolved kdScale (koComp x1.11).
  - test_dynamics' fixture tests/fixtures/engine3_pre_dynamics.js is step 1 + durability.
  - test_engine3's league-average `simAvg` runs durability in relative mode, so the priors-era self-calibration keeps the
    priors' division level.
- **Leak-free durability inputs in the backtest tools.**
  - New tools/durrec.js, used by tools/dynamics_bt.js, dynamics_calibrate.js, mlcal.js, moe_engine_bt.js and v4_levels.js.
    It gives each backtest matchup its durability.json walk-forward record plus the train NORM, and throws rather than fall back
    to the live fit (2008..2026-10).
  - tools/v401_kocomp.js and judgecal.js run their league-average pairs in relative mode.
  - Other tools still build backtest matchups without records: calibrate.js, statlines_engine.js, oppadj_engine.js,
    mlrates_engine.js and mlcal_verify.js. Before using them with durability on, pass the records through tools/durrec.js.
- **Joint knockdown / finish level check** (TRAIN 2019-2023 only; first look, no parameter changed).
  - Setup: 1,999 fights, both corner orders, 50 sims each (100 per fight per configuration), common random numbers. Leak-free
    inputs throughout: frozen profiles, as-of priors, OOF learned rates, durability walk-forward records + train NORM.
  - Tools: tools/dynamics_bt.js with four configurations, then the new tools/v5_joint_levels.py. Tables are in
    data/derived/v5_joint_levels_step2.json.
  - Actual ranges are 95% event-cluster bootstrap intervals.
  - Configurations: s1 = both off (step 1), dur = durability only, dyn = dynamics only, both = the step-2 defaults.

  | train 2019-2023 | actual [95% CI] | s1 | dur | dyn | both |
  |---|---|---|---|---|---|
  | KD per 15 min, 3 rounds (1,752 fights) | 0.611 [0.562, 0.663] | 0.656 | 0.665 | 0.598 | **0.612** |
  | KD per 15 min, 5 rounds (247) | 0.500 [0.408, 0.602] | 0.384 | 0.378 | 0.513 | **0.519** |
  | KD per fight, all | 0.445 [0.416, 0.476] | 0.458 | 0.460 | 0.438 | **0.445** |
  | KD per 100 head landed, all | 0.782 [0.721, 0.848] | 0.774 | 0.785 | 0.747 | 0.765 |
  | strike finish per KD, same round (data 0.512) | | 0.467 | 0.469 | 0.508 | **0.510** |
  | KD per 100 standing head by round, 3 rds (real 1.47 / 0.74 / 0.44) | | 1.35 / 0.84 / 0.64 | 1.38 / 0.85 / 0.65 | 1.41 / 0.70 / 0.43 | **1.45 / 0.72 / 0.44** |
  | same, 5 rds (real 1.22 / 1.01 / 0.54 / 0.28 / 0.42) | | 0.70 / 0.59 / 0.47 / 0.39 / 0.37 | 0.68 / 0.57 / 0.47 / 0.40 / 0.36 | 1.19 / 0.94 / 0.50 / 0.32 / 0.31 | **1.19 / 0.92 / 0.50 / 0.32 / 0.35** |

  The real by-round rates come from dynamics.json targets_by_round.train, which covers all UFC rounds 2019-2023.

  | finish share by round, train | actual | s1 | dur | dyn | both |
  |---|---|---|---|---|---|
  | 3 rds, any finish (1,729) | 24.4 / 16.7 / 7.5 = 48.6 | 25.1 / 14.5 / 9.1 | 25.6 / 14.4 / 9.1 | 25.6 / 13.8 / 8.9 | 25.8 / 13.8 / 9.0 = 48.7 |
  | 3 rds, KO class | 16.1 / 10.3 / 4.2 = 30.7 | 16.4 / 9.2 / 5.5 | 16.7 / 9.1 / 5.5 | 17.1 / 8.4 / 4.7 | 17.5 / 8.5 / 4.8 = 30.7 |
  | 3 rds, SUB | 8.3 / 6.4 / 3.3 = 18.0 | 8.7 / 5.3 / 3.6 | 8.8 / 5.3 / 3.7 | 8.5 / 5.5 / 4.2 | 8.3 / 5.4 / 4.3 = 18.0 |
  | 5 rds, any finish (243) | 17.3 / 16.5 / 9.5 / 5.3 / 4.9 = 53.5 | 14.4 / 12.9 / 9.9 / 9.2 / 5.4 | 14.3 / 12.8 / 10.5 / 9.5 / 5.4 | 19.5 / 15.4 / 9.7 / 8.1 / 4.4 | 19.5 / 15.9 / 9.8 / 8.0 / 4.8 = 58.0 |
  | 5 rds, KO class | 11.9 / 13.6 / 6.2 / 3.3 / 4.5 = 39.5 [33.2, 46.0] | 37.4 | 37.9 | 42.5 | 15.3 / 12.2 / 7.1 / 5.8 / 3.0 = 43.5 |
  | 5 rds, SUB | 5.3 / 2.9 / 3.3 / 2.1 / 0.4 = 14.0 | 14.3 | 14.6 | 14.6 | 4.2 / 3.7 / 2.7 / 2.1 / 1.8 = 14.5 |

  - **The knockdown levels hold jointly on train.** Both on, the implied single re-match factor is x0.999 for 3 rounds
    [0.918, 1.084 from the actuals' CI] and x0.964 for 5 rounds [0.786, 1.161]. Matched by kdLevel alone, kdLevel3 stays 0.655
    and kdLevel5 goes 0.559 -> ~0.539. Matched by kdCal alone, kdCal goes 1.164 -> ~1.156 overall.
    - Why: dynamics' kdLevel3/5 were matched to these actuals with durability off. Durability moves knockdowns by only -2% to
      +2% (dur vs s1, both vs dyn, by format), inside the noise.
    - This is no reason to re-scale now. Calibrate still runs the one joint pass.
  - **Conversion is on target**: 0.510 per KD against 0.512. The 3-round KO share matches the data (30.7 vs 30.7), and overall
    both equals dur within 0.2 pts, so the dynamics rule "KO share = the flag-off engine" still holds. convLevel and the
    stko/gnp scales need no provisional change.
  - **Known misfits persist with both on**, as dynamics.md reported:
    - 3-round R2 KO hazard 0.114 vs 0.136 real; R3 0.079 vs 0.072.
    - 5-round R1 KO hazard 0.153 vs 0.119; 5-round KO share 43.5% vs 39.5% (inside the actuals' CI).
    - Late submissions: 3-round R3 SUB hazard 0.071 vs 0.056; 5-round R5 0.038 vs 0.008.
    - Non-knockdown stoppages are a smaller share of strike KO/TKOs than the step-1 targets: standing 6.5% vs 7.2%, ground
      (no KD) 18.4% vs all ground 28.6%. The definitions differ, so read these as descriptive.
- **League-average self-calibration (tests/test_engine3.js).**
  - With both on, the plain-table league-average pairs run low on the KO share by 0.4-3.1 pts per division (mean -1.65). Step 1
    alone is -0.79 and step 1 + durability -1.11.
  - Heavyweight is at 39.9% vs 43.0%, 0.1 pt past the old +/-3 pts.
  - Real fights with the learned rates are on target (table above), so the levels were not moved for the league-average check.
    Instead, the share checks (finish / KO / SUB) now allow the larger of +/-3 pts and the target's own sampling SE,
    sqrt(p(1-p)/n). Heavyweight's n of 186 gives an SE of 3.6 pts on the KO share. Of the checked divisions, only HW (KO,
    finish) and the women's FLY and STRAW (finish) get more than 3 pts.
  - This follows the v4 precedent of the KD tolerance, documented in the test. The Calibrate stage should re-fit the
    self-calibration (`--fit`) with both components on, and can restore a flat +/-3.
- **Tests (all pass).**
  - `node tests/test_v5_step2.js`: 16 passed (new).
    - Durability + dynamics off reproduce the step-1 engine bit for bit. Dynamics off reproduces step 1 + durability bit for
      bit. Each covers 450 matchups: whole fight JSON incl. traces, 4,500 fights, 45 summaries and explain() outputs. Three
      groups: random pairs with the production learned rates and the live roster, plain tables, and 2019-2023 backtest fights in
      both corner orders with OOF rates + durability records.
    - Each flag changes fights. Both on keep the matchup keys and the trace format.
    - Out-of-range arPhi is clipped.
  - `node tests/test_engine3.js` (N 20,000): 81 passed, 0 failed. Before the tolerance change: 80 / 1, the Heavyweight KO share.
  - `node tests/test_director3.js 300`: OK, and `NO_ML=1 ... 100`: OK.
  - `node tests/test_mlrates.js`: 47 OK. `node tests/test_v401.js`: 15 passed.
  - `node tests/test_durability.js`: 34 OK. `node tests/test_dynamics.js`: 23 passed. `node tests/test_mlcal.js`: 33 passed.
    - On the first try test_mlcal failed. The interrupted run's tools/mlcal.js required durrec.js next to the worker file,
      which is a temp-dir snapshot. Fixed: the pool passes the repo's durrec path and root.
- **For the Calibrate stage.**
  - Run ONE joint knockdown level pass: kdCal or kdLevel3/5, never both as free scales. This check says the current pair is
    already within noise on train.
  - Re-fit the league-average self-calibration with both components on.
  - Re-check the 5-round between-round doctor/corner stoppages, a base-engine issue. Consider `durability.caution5`, null by
    default, against the 5-round R1 KO excess.
  - blend_anchor's method x round cells must be rebuilt with dynamics on.
  - Page copy quoting engine numbers is refreshed only after the levels are final.
    - Volk vs Gaethje, 5 x 5 title, learned rates, live durability roster, 20,000 fights: Volk wins 68.8% at step 1, 68.5%
      with durability, 62.8% with dynamics and 62.4% with both.
    - Finish rate 37.5% -> 47.9%; KD per 15 0.174 -> 0.257.
    - The verifier's v4.0.0 figures for dynamics alone were 69.3% -> 63.9%.
  - Nothing from 2024-25 was scored, and no 2026 fight was read.

### Step 3 (Nov 6, 6:20 pm ET): styles_sos, officials, realism_sens

- **Base.** The step-2 commit 8317287 (src/engine3.js sha256 0760f47b..., which was also the working tree when the step began).
  Each component went in as a 3-way merge in this order: styles_sos, officials, realism_sens. The frozen pre-component engines are
  kept as tests/fixtures/engine3_pre_styles_sos.js (= 8317287), engine3_pre_officials.js and engine3_pre_realism.js.
- **(a) styles_sos** (scratchpad/components/styles_sos.onmain.patch).
  - Merge base: 7e93291 ("Engine v4 kept"), the only commit where every hunk applies; its engine and params equal versions/v4.
  - engine3.js, params3.js, build.py and test_engine3.js merged without conflicts. ENGINE_V3_SPEC.md and tools/README.md had
    append/append conflicts; both sides were kept.
  - The patch's own `components: {}` key would again have shadowed `v401` / `durability` / `dynamics`. It is folded into the
    single components block.
  - Shipped as verified: `styles_sos: { styles: false, sos: true, newcomer: false }`, `stylesSOS.sosSource: "wf"`.
  - SOS acts only when a caller passes `opts.sos`; no profile carries `sos`. So the page and every tool that passes no pairs are
    exactly step 2 (tested on 400 fights).
  - **Harness wiring.** New tools/sosrec.js passes each backtest fight's sos_wf.json pair, with A/B swapped together with the
    corners, plus coefficients:
    - train fights: `meta.coef_loyo[year]` (out-of-year, the learned rates' OOF policy);
    - 2024-2025: `meta.coef`, fit on 2019-2023 (= the module's SOS_COEF);
    - fights dated 2026-01-01 or later are refused, and so is a fight without a pair.
  - Wired into tools/evalv.js (its own copy, `sosOpts`; it refuses a frozen copy without styles_sos.js and asserts SOS was
    applied), officials_engcal.js, realism.js, dynamics_bt.js, dynamics_calibrate.js, mlcal.js, moe_engine_bt.js and
    v4_levels.js.
  - The freeze must copy src/styles_sos.js into versions/v5/ next to engine3.js.
  - tests/test_styles_sos.js, adapted to the merge:
    - the source check is now strip([styles_sos] lines) of the merged engine == the step-2 engine;
    - `components: false` now switches every v5 component off, so the plain engine gets the same override.
- **(b) officials** (scratchpad/components/officials_component_only.patch; base 98564b7, whose engine3.js = versions/v4).
  - Four add/add conflicts, each resolved by keeping both sides: `m.dyn` + `m.off` in matchupBase; the deductions function +
    the officials block; dynamics' `cpre` cards snapshot + the officials / v4 judging dispatch; both export sets.
  - The RNG contract holds on the step-2 engine: 9 start normals, then 1 + 3 per judged round. Deductions are still drawn after
    the cards.
  - Shipped: `components.officials: false`, so the prediction path keeps the v4 judging with the v401 fixes. Named-judge effects
    are off (`officials.perJudge: false`, BACKLOG OFFICIALS).
  - Opt-in per call to show real officials: `opts.params.components.officials = true` with `opts.judges` / `opts.referee`. It is
    deliberately not switched on by named judges alone, so flag off stays bit-identical for every input.
  - Following officials.md "Base commits and patches":
    - the golden was rewritten against engine3_pre_officials.js (`--write-golden`);
    - `engAdj` was re-measured on the current engine by tools/officials_engcal.js `--write`. Train 2019-2023 only (500 fights x
      2 orders x 60 sims), now with durrec + sosrec inputs: aH 0.01897, aP -0.0931, vHH 0.42062, vHP 0.58684, vPP 30.37291. Only
      the opt-in path uses it.
  - test_officials' two tendency checks now switch perJudge on explicitly. A new check shows the default makes two different
    panels score identically.
- **(c) realism_sens** (scratchpad/components/realism_sens.patch, against v4.0.1 1f30636), re-applied by hand.
  - Applied: `compOn`, `realismFactors` + the `dvf` hook + `m._src` / `m.realism` in matchupBase, `sensitivity` / `rateSd` /
    `knobSd`, the exports, the `realism` params block (factors fit on v4.0.1), `components.realism_sens: false`, test_engine3's
    simAvg (realism off, kept with step 2's relative durability), the new test and fixture, tools/realism.js, spec and README.
  - **mlrates cache fix:** step 1 had already added the components flags to the `leagueExpect` key; `m.realism` is now added too.
  - Two merge fixes in `sensitivity`:
    - variants rebuild through the public `api.matchup`; the internal `matchup` would have dropped styles_sos from every variant;
    - an officials name array in `opts.judges` is carried as `{ names }`, not garbled by the for-in copy.
  - tools/realism.js now uses durrec + sosrec (smoke-run on 2023, 395 fights, 0 errors).
  - The digest fixture was rewritten against the pre-realism engine.
- **Version labels.** Engine VERSION stays "5.0.0-dev". The params label is "5.0.0-dev.3-selfcal-pre2024".
- **Tests (all pass).**
  - New `node tests/test_v5_step3.js`: 28 passed. Three references, each over 450 matchups: whole fight JSON incl. traces
    (4,500 fights), 45 summaries and explain() outputs.
    - all three off = step 2;
    - officials + realism off = step 2 + styles_sos;
    - realism off = + officials.
    - The groups are random pairs with learned rates + roster + random `opts.sos` + named officials, plain tables, and 2019-2023
      backtest fights x 2 corner orders with OOF rates, durability records and walk-forward SOS pairs.
    - A strict group runs the step-2 engine on 8317287's own params3.js and mlrates.js: 300 matchups, 0 mismatches.
    - Also checked: each flag changes fights, SOS with no input is a no-op, sosrec mirrors under a corner swap, the officials
      opt-in, and sensitivity rebuilds keep SOS and the officials names.
  - `node tests/test_engine3.js` (N 20,000): 81 passed. `node tests/test_director3.js 300`: OK, 300 of 300 matchups with learned
    rates; `NO_ML=1 ... 100`: OK.
  - test_mlrates 47 OK, test_v401 15, test_v5_step2 16, test_durability 34 OK, test_dynamics 23, test_mlcal 33,
    test_styles_sos 42, test_officials 24, test_realism_sens 45 (46 with `--ref-dir`).
  - Also pass: test_moe 21, test_mlpage 5, test_calib 14, test_statdist, test_forward_models, test_blindtest_stack.
  - `python3 build.py <tmp>` builds with StylesSOS in the engine script. The published page was not rebuilt.
  - An evalv `--dev` train smoke run (4 sims) ran 1,999 fights with 0 failures and SOS applied, and its output was deleted. Its
    numbers are not a measurement.
- **For the next stages.**
  - The calibration slope moves with SOS on (verifier: 1.026 -> 1.014 on the learned path), so recalibrate with it on.
  - Never stack sosSource "oppadj" with "wf".
  - Refit `realism` (tools/realism.js fit) on v5 before ever turning realism_sens on.
  - If officials is ever turned on, re-level its 10-8 c0 (it overshoots on engine rounds) and centre the referee standing-TKO
    multipliers.
  - calibrate.js, statlines_engine.js, oppadj_engine.js, mlrates_engine.js and mlcal_verify.js still pass neither durability
    records nor SOS pairs.
  - Nothing from 2024-25 was scored, no 2026 fight was read, and the only number fit here (engAdj) used 2019-2023 fights.

### Step 4 (Nov 6, 7:05 pm ET): the learned stat-line path and newcomer priors (`components.embed`, `.oppadj`, `.preufc`)

- **Base.** The step-3 commit df75ccd (src/engine3.js sha256 0862fbf0..., params3.js 48265239..., mlrates.js 40d87006...; the
  working tree matched). No component patch existed for this step (scratchpad/components has none for embed, oppadj or preufc),
  so the three were implemented by hand from the verified recipes and their reference code, in this order, freezing the engine
  before each: tests/fixtures/engine3_pre_step4.js (= df75ccd), engine3_pre_oppadj.js (+ embed), engine3_pre_preufc.js
  (+ oppadj). src/ml/mlrates.js and src/styles_sos.js are unchanged; no other component's lines were touched.
- **(a) embed, ON** (engine3.js `embedTargets`; research/model_embed.md "Integration recipe").
  - Before the adapter re-targets the tables, each learned target becomes link(rate) = b0 + b1 link(mlrates rate) + b2
    eta[task] with the exported CV-selected recipe (embed_model.json `mlrates_blend.targets`, copied into `params.embed.recipe`
    with the model's task order; b2 = 0 for rev, acc_g, td_acc, kd_h). Same arithmetic as src/ml/embed.js `blendMLRates`, bit
    for bit (and the Python outputs to 5e-16).
  - Inputs: `opts.embed = { etaA, etaB, recipe? }`, else a roster loaded with the new `FightEngine.loadEmbed(embed_model.json)`
    for bouts dated on or after 2026-01-01 only. `m.embed` records the source and the raw learned targets; `m.mlPred` now holds
    what the simulator plays.
  - **Train confirmation before leaving it on** (tools/embed_blend_loyo.py -> data/derived/embed_blend_loyo.json; 3,998
    directed 2019-2023 rows: mlrates_oof.json, the etas exactly as the engine path computes them, the 18 targets' counts):
    - The full 2019-2023 refit reproduces the exported recipe (max |b difference| 0.0003), so the inputs match the research's.
    - Each year scored by the recipe refit without it: mean relative deviance over 18 targets **-0.72% [-0.97, -0.49]** vs the
      recalibrated rates (the embedding's own gain; research LOYO column reproduced per target, e.g. distance attempts -1.01%,
      control -1.92%, head accuracy -1.69%) and **-0.42% [-0.68, -0.16]** vs the raw learned rates the engine used before
      (the b2 = 0 recalibration alone costs +0.30% out of year). Attackers with 1-3 UFC fights: -0.32% [-0.73, +0.10].
    - Engine level (tools/v5_step4_check.js, all 1,999 train fights x 2 orders x 300 sims, common random numbers, evalv's
      inputs and metrics, vs embed off): winner log loss -0.0042 [-0.0074, -0.0011]; per-fight deviance sig landed -0.31
      [-0.46, -0.16], sig attempts -0.72 [-1.05, -0.39], control -1.61 [-2.91, -0.35]; 7-bin -0.0063, method -0.0007, TD and
      KD n.s.
  - Backtests use leave-one-year-out coefficients on train fights (`coef_loyo[year]`; the exported recipe is fit on all of
    2019-2023) and the exported recipe on 2024-2025, the learned rates' out-of-fold policy, as SOS does.
- **(b) oppadj, OFF** (engine3.js `oppadjTargets`; research/model_oppadj.md item 3, the ML-path recipe).
  - After the blend: target x (F_off,X F_def,Y)^beta for d_att, c_att, g_att, td_att, ctrl (h/b/l attempts follow the total),
    on odds for acc_h, acc_l, td_acc; `params.oppadj.beta` = oppadj.json `ml_path_beta`; knockdowns, body accuracy and
    submissions stay 0. Equal to tools/oppadj_engine.js `adjTargets` on all 3,998 train sides (relative 2e-16). topSkill /
    escWeak are not applied (the reference left them out, so that combination is untested).
  - **Never stacked with SOS**: matchupBase throws when `components.oppadj` is on with `components.styles_sos` sos on (any
    source, so also the sosSource "oppadj" approximation). The Calibrate arm is `{ oppadj: true, styles_sos: { sos: false } }`.
  - For the Calibrate ablation only (train, 300 sims per order, vs embed with SOS "wf"): winner +0.0016 [-0.0013, +0.0045],
    7-bin +0.0066 [-0.0013, +0.0144], method +0.0016, sig landed deviance -0.12 [-0.31, +0.06], control -0.85 [-2.28, +0.56].
    Nothing significant either way; no choice was made here.
- **(c) preufc, ON** (engine3.js `applyPreUFC`; research/model_preufc.md item 3, the verified recipe).
  - For sides with at most 3 prior UFC fights, from the non-UFC record entering the bout: odds multipliers M_pow = (KO rate /
    0.3433)^0.601, M_sub = (sub rate / 0.2466)^0.627, M_chin = (KO-loss rate / 0.0436)^0.244, faded by exp(-n_UFC / 8). The
    research report rounds these to 0.343 / 0.247 / 0.044 and 0.60 / 0.63 / 0.24; params use preufc.json's exact
    `eval.side_finish` values. preufc.json's own roster block differs from them by up to 0.006 at very small rates (it was
    evidently exported from a slightly different fit); the eval constants are the recipe's.
  - Applied after durability as hazard multipliers: X's kd, gnp, stko x M_pow,X^s x M_chin,Y^s; X's submission attempt tables
    x M_sub,X^s. The scales (pow 1.007, sub 1.314, chin 0.991) come from tools/preufc_scale.js: league-average pairs on the
    train priors, 40,000 sims per config, 3 divisions x 2 formats, so the simulated per-fight finish odds move by M (no outcome
    is fit). The Calibrate stage may refit them on 2019-2023 newcomer bouts (and try tau 16, as the report suggests).
  - Inputs: `opts.preufc = { A, B }` ({ n, ko_w, sub_w, ko_l, n_ufc }), else `prof.preufc`, else a roster loaded with the new
    `FightEngine.loadPreUFC(preufc.json)` for bouts dated on or after its ufcstats snapshot (2026-10-31). All 1,261 train
    newcomer sides have a pre-bout record whose UFC count equals backtest_dev's `n`.
  - The styles_sos `newcomer` sub-flag is the older unimplemented stub: the engine refuses it together with preufc.
  - Train check vs embed alone (300 sims per order, common random numbers): method -0.0060 [-0.0115, -0.0005], 7-bin -0.0084
    [-0.0168, +0.0002], KD deviance -0.0078 [-0.0127, -0.0027], KO-win log loss per newcomer side -0.0092 [-0.0168, -0.0014];
    winner -0.0003 and the stat lines n.s. Caveat: the recipe's exponents were fit on 2015-2023 newcomer sides, so 2019-2023
    is not out of sample for them.
  - Not done here (out of this step's scope): the seeded-Elo level shift (it belongs in the winner blend) and WHR-rounds / dims
    skill inputs (optional; no second age term).
- **Harness.** New tools/mlpathrec.js gives backtest fights all three inputs (embed.json snapshots + quarterly refits and the
  leave-one-year-out coefficients, oppadj.json snapshots, preufc.json snapshots), A/B swapped with the corners, 2026 refused, a
  missing snapshot refused. Wired into tools/evalv.js (which prefers a frozen copy's own mlpathrec.js + ml/embed.js and records
  the helper's hash and the step-4 flags in its meta), dynamics_bt.js, dynamics_calibrate.js, mlcal.js, moe_engine_bt.js,
  officials_engcal.js, realism.js and v4_levels.js, each with an assertion that the input was applied. evalv smoke runs on
  train: the step-4 engine and the frozen versions/v4 both ran 1,999 fights with 0 failures (outputs deleted; not
  measurements). **The freeze must copy src/ml/embed.js and tools/mlpathrec.js into versions/v5/ (ml/embed.js, mlpathrec.js),
  next to styles_sos.js.**
- **Version labels.** Engine VERSION stays "5.0.0-dev"; params label "5.0.0-dev.4-selfcal-pre2024".
- **Tests (all pass).**
  - New `node tests/test_v5_step4.js`: 45 passed. Four references, each over 450 matchups (random pairs with learned rates,
    the durability roster, random SOS and step-4 inputs; plain tables; 2019-2023 backtest fights x 2 corner orders with OOF
    rates, durability records, SOS pairs and the step-4 walk-forward inputs): whole fight JSON incl. traces (4,500 fights), 45
    summaries and explain() outputs, 0 mismatches.
    - all three off = step 3; oppadj + preufc off = step 3 + embed; preufc off = + oppadj, with oppadj off and on (SOS off);
    - strict: the step-3 engine on df75ccd's own params3.js and mlrates.js, 300 matchups, 0 mismatches.
    - Also: each flag changes fights; default params with no step-4 input (the page path) = step 3 bit for bit; the blend =
      blendMLRates; the backtest etas reproduce the snapshots' win logits (2.4e-3, export rounding); mlpathrec corner swap,
      leave-one-year-out vs exported recipe, 2026 refused; oppadj = adjTargets and refuses SOS; pre-UFC constants, formula and
      hazards; roster leak guards; trace format with everything on; sensitivity() rebuilds keep the inputs.
  - `node tests/test_engine3.js` (N 20,000): 81 passed. `node tests/test_director3.js 300`: OK, 300 of 300 with learned rates;
    `NO_ML=1 ... 100`: OK.
  - test_mlrates 47 OK, test_v401 15, test_v5_step2 16, test_v5_step3 28, test_durability 34 OK, test_dynamics 23, test_mlcal
    33, test_styles_sos 42, test_officials 24, test_realism_sens 45, test_embed OK, test_moe 21, test_mlpage 5, test_calib 14,
    test_statdist 3,059 checks, test_forward_models PASS, test_blindtest_stack PASS.
  - `python3 build.py <tmp>` builds (10.4 MB). The published page was not rebuilt; the page loads neither roster, so it plays
    exactly step 3.
- **Volkanovski vs Gaethje** (5 x 5 title, production learned rates, live durability roster, 20,000 fights; information only):
  62.1% Volk on the page path; 62.2% with the embedding roster loaded (finish 47.3% -> 49.1%, KD per 15 0.251 -> 0.262).
  Neither man is a newcomer, so preufc does not apply.
- **For the next stages.**
  - Calibrate: pick SOS "wf" or oppadj by train soft CE + stat lines (never both); include embed and preufc in the
    leave-one-out; optionally refit `params.preufc.scale` / tau on 2019-2023 newcomer bouts.
  - Release: refit the embed blend on 2019-2025 out-of-fold rows and rerun tools/embed.py (research/model_embed.md); wire
    loadEmbed / loadPreUFC into src/app.js if the page should use them.
  - calibrate.js, statlines_engine.js, oppadj_engine.js, mlrates_engine.js and mlcal_verify.js still pass no step-4 inputs.
  - Nothing from 2024-25 was scored, no 2026 fight was read, and every number fit here (the leave-one-year-out blend
    coefficients) used 2019-2023 fights; the preufc scales use train priors and no outcomes.

### Step 5 (Nov 6, 7:30 pm ET): blend_anchor and the prediction package (`components.blend_anchor`, FightEngine.predict)

- **Base.** The step-4 commit 6210f69 (src/engine3.js sha256 f93ff8d1..., params3.js 9ed290d7..., mlrates.js 40d87006...; the
  working tree matched). Frozen as tests/fixtures/engine3_pre_blend_anchor.js.
- **Applied.** scratchpad/components/blend_anchor.patch (re-issued against v4 final 122c31a: the component plus the verifier's two
  fixes) with `git apply --3way`.
  - New files went in clean: src/ml/blend.js, tests/test_blend_anchor.js, tools/blend_anchor_{prep.py,bt.js,eval.js},
    data/derived/blend_anchor{,_dev}.json, research/model_blend_anchor.md.
  - Conflicts:
    - engine3.js: the end-of-file append, styles_sos's public-matchup wrapper vs the marked blend_anchor block. Both kept,
      wrapper first.
    - tools/README.md: append/append, both kept.
    - params3.js: the patch's own `components: { blend_anchor }` key would have been a second `components` key and dropped
      every earlier flag. Folded into the single block. The `blend` settings block is kept as verified: mrWeight 0.15, linear
      pool, recalT 1, anchor 0.5 / 1 / 1 with slope0 0.86, kappa 1.65.
  - Merge fix: the flag-off path of predict now calls the public `api.matchup` instead of the internal `matchup`, which would
    have dropped styles_sos (SOS inputs).
  - Merge fix: `FightBlend.swapOpts`, which builds the mirrored B-A run, now also swaps the v5 per-call inputs: `dur`, `sos`,
    `embed` (etaA/etaB), `oppadj` and `preufc`. Without it, predict's B-A run gave each fighter the other's durability record,
    SOS pair, embedding etas and pre-UFC record. The test now checks that the B-A matchup equals the harness's own swapped
    matchup on 24 train fights.
- **Winner blend upgraded to the verified ML v2 package** (src/ml/blend.js 1.1.0).
  - The production stacker is data/derived/blindtest_stack.json in src/ml/moe.js's format, replacing moe_page.json.
    `opts.lineKind` chooses its block explicitly:
    - `'close'`: the close-trained `model`, line de-vigged by the power method;
    - `'open'`: the open-trained `model_open`, proportional de-vig as in market.json p_novig_open;
    - `'none'`: the shared no-line block.
  - Refused: a line without lineKind, a lineKind without a line, `'open'` on a stacker without `model_open` (e.g. legacy
    moe_page.json), and unknown kinds.
  - `FightEngine.loadBlend({ stack, feat, mlPage, market, ml2, methodRound })` loads the same experts tools/forward_ledger.js
    computes:
    - feat_lr from moe_page.json `feat`;
    - ml + elo_sig from the ml.json page model;
    - mkt_rating from market.json ratings;
    - engine = the simulator, both corner orders.
  - ML v2's page logistic and page stacks (src/ml/ml2.js) are returned as `ml2`; `ml2.p` is the lineKind-matched stack.
    `opts.winner = 'ml2'` makes it the headline. The default headline is the stack.
  - SM is used only with a closing line; an opener goes to S, the same close-vs-open rule as the stack.
  - Anchor mode, the interval (kappa 1.65) and recalT 1 are unchanged. The stack's no-line block carries its own temperature.
  - A legacy `moe` key still loads as a stacker without an open-trained block.
- **Backtests can no longer use production defaults** (`opts.backtest = true`).
  - The loaded stack, the S model (fit through 2026-10) and every live roster are refused.
  - Required: `opts.stack` with a fit_through on or before 2023-12-31 and before the fight. A train-window fight inside it needs
    an explicit `opts.inSample`.
  - Also required: `opts.mrCells` (walk-forward cells, or false). A live ML v2 handle and dates from 2026-01-01 on are refused.
  - New `python3 tools/blindtest.py export --fit-through 2023-12-31` writes data/derived/blindtest_stack_pre2024.json.
    - It uses the production stackers' configuration and expert map (`model` + `model_open`) and is fit on the 1,955 decisive
      2019-2023 fights' out-of-sample expert rows only. Nothing from 2024-25 is read; no blind scores are copied.
    - All three blocks are fit through 2023-12-16. No-line temperature 1.043.
    - Full-pattern weights: close market 0.86 / mkt_rating 0.11 / ml 0.14 / feat_lr 0.04 / engine 0.04; no line mkt_rating
      0.85 / ml 0.56 / feat_lr 0.03 / engine 0; open market 0.74 / mkt_rating 0.21 / ml 0.33 / engine 0.09.
    - The engine expert is engine_v4. Re-export with v5's own train rows once they exist.
  - New tools/predictrec.js builds predict's backtest inputs per fight and corner order:
    - the pre-2024 stacker;
    - the line;
    - walk-forward experts: 2019-2023 from ml.json oof, blend_anchor_dev.json and market.json; 2024-25 from the blind replay's
      blindtest.json rows, each fit_through checked;
    - methodround.json S / SM cells fit before the fight, mirrored with the corners;
    - ML v2 rows with the 2019-2023 page-stack weights from forward_models.json.
  - tools/blend_anchor_bt.js now passes the durrec / sosrec / mlpathrec inputs and asserts them on both corner orders. Smoke run:
    50 train fights, 0 errors.
- **Version labels.** Engine VERSION stays "5.0.0-dev"; params label "5.0.0-dev.5-selfcal-pre2024".
- **Tests (all pass).**
  - New `node tests/test_v5_step5.js`: 34 passed.
    - Identity against the step-4 engine, with blend_anchor off AND on: 450 matchups each. Whole fight JSON incl. traces (4,500
      fights), 45 summaries and explain() outputs.
    - Groups: random pairs with learned rates, the durability roster and random SOS + step-4 inputs; plain tables; 2019-2023
      backtest fights x 2 corner orders with every walk-forward input.
    - With the flag off, predict = summarize of the step-4 engine (45 calls).
    - Strict: the step-4 engine on 6210f69's own params3.js and mlrates.js, 300 matchups, 0 mismatches.
    - Package: the stack block and p per lineKind equal MoE.load(blindtest_stack[, 'model_open']).predict on the reported
      experts. Exact corner symmetry for every kind (p, 7 bins, calibrated interval). ML v2 equals src/ml/ml2.js. Also checked:
      winner 'ml2', the refusals, the swaps, a corner-symmetric backtest predict with every v5 input, the backtest guard and
      predictrec.
  - `node tests/test_blend_anchor.js`: 64 passed (the flag-on section now loads blindtest_stack.json and checks the open block).
  - `node tests/test_blindtest_stack.js`: PASS for both exports, 180 vectors each, 2.2e-16. The pre-2024 file's fit_through is
    checked.
  - `node tests/test_engine3.js 20000`: 81 passed. `node tests/test_director3.js 300`: OK, 300 of 300 matchups with learned rates;
    `NO_ML=1 ... 100`: OK.
  - test_mlrates 47 OK, test_v401 15, test_v5_step2 16, test_v5_step3 28, test_v5_step4 45, test_durability 34 OK, test_dynamics
    23, test_mlcal 33, test_styles_sos 42, test_officials 24, test_realism_sens 45, test_embed OK, test_moe 21, test_mlpage 5,
    test_calib 14, test_statdist 3,059, test_forward_models PASS, test_ml2 365, test_forward_v42 457, test_debut 23,
    test_finishing 371, test_propspool 732.
- **Volkanovski vs Gaethje** (information only; 5 x 5 title, production learned rates and durability roster, 10,000 fights per
  corner order, opener +160 / -180):

  | lineKind | P(Volk) | stack block | simulator | ML v2 page stack | 80% calibrated |
  |---|---|---|---|---|---|
  | none | 79.2% | no-line | 62.6% | 75.9% | 61-90% |
  | open | 55.8% | model_open | 62.6% | 58.3% | 44-67% |
  | close (same odds, for comparison) | 48.1% | model | 62.6% | 51.3% | 42-55% |

  - Finish 49-52%.
  - The no-line number leans on the market rating (63.5%, built from his featherweight lines) and the ML page model (67%).
- **For the next stages.**
  - Calibrate: rebuild the method x round cells only after the final flags are fixed. Run tools/blend_anchor_bt.js plain ->
    blend_anchor_eval.js targets -> pilot -> anchor -> report on train, then refit mrWeight (0.15) and slope0 (0.86) on them.
    The current values were fit on the v4 engine.
  - Measure: evalv scores summarize, not predict.
    - To score the package, call predict with tools/predictrec.js inputs: the pre-2024 stacker on 2024-25, per-year stackers or
      an explicit in-sample flag on train.
    - First re-export the pre-2024 stacker with v5's train rows: BLINDTEST_MOE_ENGINE=engine_v5 after evalv writes
      data/derived/evalv/v5_*.json. The stacker fit reads train rows only.
    - The blend test's MoE refit is separate and unchanged.
  - Freeze: copy src/ml/blend.js together with ml/moe.js, ml/ml2.js and ml/mlpage.js into versions/v5/ml/.
    - blend.js requires ../../tools/methodround_model.js, which a frozen copy cannot reach.
    - With a frozen copy, pass method/round handles or cells (backtests always pass cells).
  - Release / page: build.py has no slot for src/ml/blend.js, src/ml/ml2.js or the stack JSONs, so the page does not call
    predict yet (verifier condition 3). The forward ledger keeps its own pre-registered routing (fwd-4.1 / 4.2).
  - Nothing from 2024-25 was scored and no 2026 fight was read. The one new fit (the pre-2024 stacker export) used only
    2019-2023 rows.

### Calibrate A (Nov 6, 8:00 pm ET): leave-one-out train ablation, v5's default flags

- **Base.** The step-5 commit 5251206 (src/engine3.js sha256 923ffd1b..., params3.js b63ee9ab...; the working tree matched). The
  engine code is unchanged by this step; only params3.js's components block, comments and label changed.
- **Ablation** (research/v5_train_ablation.md; new tools/v5_train_ablation.js, v5_train_ablation_mr.py, v5_train_ablation_report.py).
  - TRAIN 2019-2023 only: 1,999 backtest_dev fights, both corner orders, 300 sims per order and arm. One seed per simulated fight,
    the same in every arm (common random numbers that survive differing rng use, e.g. deductions after the last round).
  - evalv's leak-free inputs, each asserted per arm: as-of priors, OOF learned rates, durrec, sosrec, mlpathrec.
  - 13 arms: all on, all minus each component or v401 sub-flag, oppadj instead of SOS, and the reviewer's "v3 params + learned
    rates". A confirmation run against the final defaults added v3pj (v3 params with the v5 judging).
  - Metrics: soft-label CE vs the closing line (primary), winner, 7-bin, method, methodround's method x round and who x how x when
    (its own scorer), stat-line deviance per target and total, base rates. Paired arm - all, 2,000 event-date cluster resamples.
  - The decision rule was written into the report before the full run (neutral band 0.0005 on the primary).
- **Result** (arm without the component minus all on; > 0 = it helps):

  | component | soft CE vs close | best secondary | decision |
  |---|---|---|---|
  | embed | +0.0038 [+0.0030, +0.0047] | who x how x when +0.0150 [+0.0026, +0.0285] | on |
  | durability | +0.0009 [+0.0004, +0.0015] | 7-bin +0.0065 [+0.0020, +0.0108] | on |
  | SOS (vs neither) | +0.0009 [+0.0004, +0.0015] | 7-bin +0.0133 [+0.0041, +0.0243] | on; oppadj instead +0.0005 [-0.0001, +0.0012]: off |
  | preufc | +0.0004 [-0.0000, +0.0009] | method x round +0.0071 [+0.0021, +0.0123]; winner +0.0034 [+0.0015, +0.0051] | on |
  | dynamics (structure) | +0.0002 [-0.0005, +0.0009] | none either way | on |
  | v401 deductions | +0.0000 [+0.0000, +0.0001] | 7-bin +0.0194 [+0.0067, +0.0345] | on |
  | v401 tdCap | +0.0000 [-0.0000, +0.0001] | 7-bin +0.0002 [+0.0000, +0.0004] | on |
  | v401 koTargets | +0.0001 [-0.0001, +0.0003] | method x round +0.0027 [+0.0001, +0.0051] | on |
  | v401 mlLevels | -0.0001 [-0.0005, +0.0004] | none | **off** |
  | v401 emJudge | -0.0001 [-0.0002, -0.0000] | none (7-bin -0.0006 n.s.) | on, protocol exception |
  | v3 params + learned rates | v3p -0.0001 [-0.0006, +0.0005]; v3pj +0.0001 [-0.0003, +0.0005] vs final | | v4 set stays |

- **Defaults set in src/params3.js** (label "5.0.0-dev.6-selfcal-pre2024"): `components.v401.mlLevels: false`; everything else as
  merged. officials and realism_sens stay off and blend_anchor on (not ablated: off already / predict only).
  - mlLevels off: neutral on the primary and on every secondary. With embed on, its learned-path levels overshoot: TD per 15
    1.380 vs 1.306 actual, control 172 vs 163 s, SUB share 18.1% vs 17.5%. Off gives 1.300, 164 s and 17.5%, with KO 31.7% vs
    31.7% actual.
  - emJudge stays on against the rule's verdict. Its off state is v4's EM weights, fit on cards through 2026-10 (the validation
    years and the vault), so it is not admissible under the hidden-data protocol. The train-only weights cost 0.0001 of soft CE.
  - The final set is exactly the `-mlLevels` arm. The confirmation run reproduces it to the last digit.
- **Disclosed deviations.**
  - The verdict code treats |delta| < 1e-9 as 0. Without that, a float-rounding method delta of -3e-18 would have turned
    deductions off.
  - The v3pj arm was added after the main run.
- **Tests (all pass).**
  - New `node tests/test_v5_calA.js`: 13 passed.
    - Engine byte-identical to step 5, and only components and the label differ in params.
    - Step 5's components passed explicitly reproduce the step-5 engine on step 5's own params (fixture params3_pre_calA.js) bit
      for bit over 450 matchups. The groups are random pairs with learned rates, roster, SOS and step-4 inputs; plain tables; and
      2019-2023 backtest fights x 2 orders with every walk-forward input. Each compares whole fight JSON incl. traces, summaries
      and explain().
    - New defaults = the step-5 engine with the new block (300 matchups), and components: false is identical.
  - Fixtures that predate the change now pin v401.mlLevels to their state (on):
    - the strict groups of test_v5_step3 / 4 / 5;
    - test_realism_sens' stored digest;
    - test_officials' golden.
  - test_v401's default check and test_engine3's mlLevels / koTargets checks name the sub-flag explicitly.
  - `node tests/test_engine3.js 20000`: 81 passed. `node tests/test_director3.js 300`: OK, 300 of 300 with learned rates, and
    `NO_ML=1 ... 100`: OK.
  - test_mlrates 47 OK, test_v401 15, test_v5_step2 16, test_v5_step3 28, test_v5_step4 45, test_v5_step5 34, test_durability 34,
    test_dynamics 23, test_mlcal 33, test_styles_sos 42, test_officials 24, test_realism_sens 45, test_blend_anchor 64, test_embed
    OK, test_moe 21, test_mlpage 5, test_calib 14, test_statdist 3,059, test_forward_models PASS, test_blindtest_stack PASS,
    test_ml2 365, test_forward_v42 457, test_debut 23, test_finishing 371, test_propspool 732.
  - `python3 build.py <tmp>` builds (10.4 MB). The published page was not rebuilt.
- **Volkanovski vs Gaethje** (information only; 5 x 5 title, production learned rates and durability roster, 20,000 fights):
  62.8% Volk with the step-5 defaults, 62.1% with these; finish 48.2% -> 48.5%.
- **For the next stages.**
  - Calibrate B: run the joint KD level pass and the league-average selfcal re-fit with these flags. KD per 100 head is 0.759 vs
    0.782 actual on train.
    - mlLevels off puts v4.0.0's kdScale, kdInstant, kdRefStop, stko, gnpTko and subConvScale back.
    - tools/v4_levels.js --write and test_engine3 --fit --write write the flag-on fields, which the default path no longer reads.
  - Rebuild blend_anchor's method x round cells with these defaults, then refit mrWeight / slope0.
  - Misfits no flag fixes:
    - 3-round finish timing: R2 13.6% vs 16.7%, R3 8.9% vs 7.5%;
    - 5-round R4 7.9% vs 5.3%;
    - draws 0.59% vs 1.01%, MD 0.9% vs 2.0%;
    - 10-8 share 4.5% vs 5.3%.
  - Nothing from 2024-25 was simulated or scored, and no 2026 fight was read. No parameter was fit: the step chose flags only.

### Calibrate B (Nov 6, 8:50 pm ET): the joint level pass, the global-scale re-tune, blend_anchor rebuilt, v5 frozen as 5.0.0

- **Base.** The Calibrate A commit 2e24835 (src/engine3.js sha256 923ffd1b..., params3.js 416c863c...; the working tree matched).
  Frozen as tests/fixtures/engine3_pre_calB.js and params3_pre_calB.js. TRAIN 2019-2023 only throughout (research/v5_calB.md, rules
  written before each run).
- **(1) ONE joint level pass, new flag `components.calB` (on).** tools/v5_calB_levels.js: all 1,999 train fights x 2 orders, one
  seed per simulated fight, evalv's leak-free inputs asserted; damped fixed point, one lever per target, durability.kdCal held
  (one knockdown scale per format). The values sit in `params.calB.set`; resolveParams applies them before the v401 put-backs and
  the overrides, so calB off = the Calibrate A engine bit for bit and a v401 sub-flag that is off still restores its own fields.
  data/derived/v5_calB_levels.json.

  | lever -> target | before | after | target value |
  |---|---|---|---|
  | dyn.kdLevel3 -> KD per 15 / per 100 head, 3 rounds | 0.655 (0.595 / 0.791) | 0.6772 (0.613 / 0.815) | 0.611 / 0.814 |
  | dyn.kdLevel5 -> same, 5 rounds | 0.559 (0.504 / 0.621) | 0.5656 (0.509 / 0.627) | 0.500 / 0.641 |
  | dyn.convLevel -> strike finish per KD | 1.045 (0.505) | 1.0966 (0.511) | 0.512 |
  | dyn.stkoScale / gnpScale -> KO share | 0.733 / 0.481 (31.7%) | 0.6587 / 0.4322 (31.8%) | 31.7% |
  | judge.t108 -> 10-8 share of decision judge-rounds (cards) | 8.31 (4.47%) | 8.176 (4.75%) | 4.71% (2021-23; 2019-23 5.29%) |

  - KD per 100 head landed 0.759 -> 0.780 (actual 0.782). KD per 100 standing head by round now matches: 3 rounds 1.47 / 0.71 / 0.44
    (real 1.47 / 0.74 / 0.44). KO / SUB / DEC 31.8 / 17.5 / 50.7 (real 31.7 / 17.5 / 50.8).
  - Not fixable by levels (documented for v6 / v8): 3-round finish timing 25.9 / 13.5 / 8.8% vs 24.4 / 16.7 / 7.5% (R2 below the
    actual's interval for KO and SUB alike); 5-round R4 8.0% vs 5.3%; MD 1.0% vs 2.0% and draws 0.62% vs 1.01% (MDs do not follow
    10-8s in the 2019-2023 cards; a threshold giving 6.6% 10-8s lifts MDs only to 1.3%).
  - Paired train effect (tools/v5_train_ablation.js --arms all,-calB, 300 sims per order; calB off minus on): soft CE vs close +0.0001
    [-0.0000, +0.0002], winner +0.0002 n.s., 7-bin -0.0001 n.s., method 0, method x round -0.0008 n.s., who x how x when -0.0042
    [-0.0120, +0.0007], stat lines -0.07% [-0.12, -0.01]. Outcome-neutral: a realism calibration, not a score gain.
- **(2) Global-scale re-tune with tools/mlcal: nothing adopted.** New `"inject": "overrides"` mode in tools/mlcal.js: the old full-tree
  injection would have silently undone v401.mlLevels off and the calB set, so its "current" set was not the shipped engine; the new
  mode bases candidates on the engine's effective defaults (FightEngine.resolveParams, koComp held out) and passes only changed
  leaves. tools/mlcal_spec_engine5.json (strikeScale, accScale, tdScale, tdOddsScale, ctrlScale, subAttScale, subConvScale,
  mlWeight; the knockdown / finish levels stay with the joint pass), `--no-val`, 1,300 tuning / 672 confirmation fights. Tuning-window
  gains up to -0.022 did not survive confirmation: best confirmed 1.5321 vs baseline 1.5323 (pre-registered bar 0.002), worse on
  winner and base rates. data/derived/mlcal_candidates_v5.json.
- **(3) blend_anchor rebuilt on the final engine** (blend_anchor_bt.js plain -> eval targets -> pilot -> anchor -> eval report, 2019-2023;
  data/derived/blend_anchor.json rewritten): `blend.mrWeight` 0.15 -> **0.30** (LOYO optimum, per fold 0.30-0.40), `blend.anchor.slope0`
  0.86 -> **0.771** (se 0.014), `blend.boot.inflate` 1.65 -> **2.15** (smaller bootstrap sd; out of fold 79.6% / 94.2% cover of the
  close). Package vs simulator alone (LOYO): winner -0.0143, soft CE -0.0123, 7-bin -0.0235, joint -0.0407 (all intervals exclude 0);
  joint 2.1368 (v4-engine cells 2.1415). The v5 cells now add to S in the pool (S alone +0.0053 joint, +0.0076 7-bin, +0.0044 method).
- **(4) Freeze.** Engine VERSION "5.0.0", params "5.0.0-selfcal-pre2024". versions/v5/: engine3.js (951a7e63ce43...), params3.js
  (bebc8d052fdb...), styles_sos.js, mlpathrec.js, ml/{mlrates (unchanged since v4), embed, blend, moe, ml2, mlpage}.js. versions/README.md
  has the row.
- **Tests (all pass).**
  - New `node tests/test_v5_calB.js`: 18 passed. Fixtures = 2e24835's files; engine = Calibrate A + the [calB] lines; params change
    only where listed; calB off = the Calibrate A engine on its own params over 450 matchups (random pairs with learned rates, roster,
    SOS + step-4 inputs; plain tables; 2019-2023 backtest fights x 2 orders with every walk-forward input: whole fight JSON incl.
    traces, summaries, explain()); calB on = the Calibrate A engine with the set as an override (300 matchups); components false
    identical; resolveParams order (emJudge off still restores t108 8.555; overrides win); fights change; trace keys unchanged.
  - Tests comparing with engines that predate calB now pin `calB: false`, as Calibrate A pinned mlLevels: test_v5_step3 / 4 / 5 (OFF
    objects, page-path checks, strict groups), test_dynamics (flag-off identity; the stkoHurtGate check reads the resolved
    stkoScale), test_realism_sens (stored digest), test_officials (golden). test_v5_calA now checks the Calibrate A transition on the
    frozen 2e24835 files. test_v5_step5 accepts the rebuilt blend settings. Two tolerances, both explained in the test: test_engine3's
    ground-landed check 40% -> 50% (Volkanovski vs Gaethje +37% -> +42% over base from the higher KD level's follow-up flurries) and
    test_realism_sens' att-direction check per fight-minute (per fight x1.09 because the att 1.2 fights now end sooner; per minute x1.16).
  - `node tests/test_engine3.js 20000`: 81 passed. `node tests/test_director3.js 300`: OK, 300 of 300 with learned rates; `NO_ML=1 ... 100`:
    OK. test_mlrates 47 OK, test_v401 15, test_v5_step2 16, step3 28, step4 45, step5 34, calA 14, calB 18, test_durability 34 OK,
    test_dynamics 23, test_mlcal 33, test_styles_sos 42, test_officials 24, test_realism_sens 45, test_blend_anchor 64, test_embed OK,
    test_moe 21, test_mlpage 5, test_calib 14, test_statdist 3,059, test_forward_models PASS, test_blindtest_stack PASS, test_ml2 365,
    test_forward_v42 457, test_debut 23, test_finishing 371, test_propspool 732, test_eradrift 2,283.
  - `python3 build.py <tmp>` builds (10.4 MB). The published page was not rebuilt.
- **Standard evaluation, TRAIN only** (`tools/evalv.js --version v5 --split train --sims 300 --compare v4`; version_history.json v5 entry:
  train block, validation null). Winner log loss 0.6565 [0.6472, 0.6666] (v5 - v4 -0.0070 [-0.0119, -0.0020]); Brier 0.2324 (-0.0031
  [-0.0057, -0.0007]); accuracy 60.4%; ECE 0.011, slope 1.18; 7-bin 1.6345 (-0.0365 [-0.0540, -0.0198]); method 0.9578 (-0.0093
  [-0.0175, -0.0013]); who x how x when 2.1759 (vs S +0.0236 [+0.0060, +0.0425]; vs v4 -0.0272 [-0.0488, -0.0064]); method x round 1.4906
  (vs S +0.0096 n.s.); stat-line deviance better than v4 on TD, control and KD (intervals exclude 0), sig landed / attempts n.s. The blend
  test is a validation measurement: left to the Measure stage (train-only dry check, stacker 2019-2022 scored on 2023: engine weight
  0.25 / 0.38, blend not better on 2023, +0.0032 / +0.0038 n.s.; v4 the same).
- **Volkanovski vs Gaethje** (information only; 5 x 5 title, production learned rates and durability roster, 20,000 fights, seed 11):
  62.1% Volk with calB off, 62.8% on (Monte Carlo noise about 0.3 pts); finish 48.5% -> 48.6%.
- **For the Measure stage.** evalv `--split val` on versions/v5 (one look). Re-export the pre-2024 stacker with v5's train rows
  (BLINDTEST_MOE_ENGINE=engine_v5, train rows only) before scoring the package with tools/predictrec.js. Nothing from 2024-25 was
  simulated or scored here, no 2026 fight was read, and every number fit here used 2019-2023 fights only.

## v4.0.1 (2026-11-06): the v4 review's fixes, REJECTED; v4 (4.0.0) restored

**Status: rejected by the decision rule.** The validation look ran once, at 11:45 am ET, paired against v4. The
decision was made at 2:20 pm ET.
- src/engine3.js, src/params3.js and src/ml/mlrates.js are back to versions/v4/; the hashes match the v4 entry.
- tests/test_engine3.js, data/derived/judgecal.json and data/derived/v4_levels.json are back to the v4 final
  commit 122c31a.
- The work is kept in versions/v4.0.1-rejected/: engine, params, adapter, its test file, its fits and its run logs.
  `versions/v4.0.1` is a symlink to it, because agents were still reading that path.
- **The current engine is v4.**
- Tests on the restored v4: `node tests/test_engine3.js 8000` gives 69 passed, 0 failed. `node tests/test_director3.js 200`
  passes with the learned rates on (200 of 200 matchups applied) and with `NO_ML=1`.

### What v4.0.1 changed (all fit on train data, 2019-2023)

Each review issue was first reproduced on train data or file metadata. No new validation numbers were computed.

1. **Judge weights were fit on cards through the vault.**
   - Reproduced: v4's judge.head/body/leg/kd/td/ctrlMin/sub are the EM round-winner fit over ufcstats cards from 2015-01-01
     through 2026-10-31 (data/derived/baserates.json meta), so they include the validation years and the 2026 vault.
   - Fix: refit on the 5,519 cards of 2015-2023 only (tools/judge_em_train.py -> data/derived/judge_em_train.json,
     last card 2023-12-16). New weights: head 0.1742, body 0.1271, leg 0.1042, KD 2.164, TD 0.278, control 0.462/min,
     sub 0.847. Then tools/judgecal.js was re-run: shared sd 1.357, fight share 0.340, individual sd 1.053, t108kd -0.859.
2. **Draws and majority decisions were too rare.**
   - Reproduced on train: mean simulated P(draw) was 0.98% for v3 and 0.24% for v4, against an actual 1.01%. Majority
     decisions were 0.5% for v4 against an actual 2.0%.
   - Fix: point deductions (judge.ded 0.00515 per fighter-round, ded2 0.075 two-point share; judgecal on 2019-2023
     decision rounds). They are drawn after the last round, so every fight is unchanged up to the cards, and t108 was
     re-levelled to 8.31.
   - Result on train: P(draw) 0.64%, MD 1.0%.
3. **Takedowns and control ran low with the learned rates on.**
   - Reproduced on train: TD per 15 was 1.225 against 1.306 actual (-6.2%), and control per 15 was 154.5 s against 163.0 s
     (-5.2%).
   - Fix: learned-path levels mlTdLevel 1.067, mlCtrlLevel 1.053 and mlSubLevel 1.083. tools/v4_levels.js was re-run on
     all 1,999 train fights.
   - Result on train: 1.306 and 163.3 s.
4. **The mlMaxRatio cap compounded.**
   - Reproduced on train: v4 caps each of three refit steps, so the takedown-attempt multiplier went past x4 on
     20 of 3,998 sides, up to x6.28.
   - Fix: the cap applies to the cumulative multiplier and to the TD-odds one. Result: 0 of 3,998 sides past the cap.

### Validation 2024-2025 (one look)

Setup: 865 fights (853 decisive), symmetric, 300 sims per order, 2,000 event-cluster resamples, paired against v4 on
the same fights.

| validation 2024-2025 | v4 | v4.0.1 | v4.0.1 - v4, paired [95% CI] |
|---|---|---|---|
| **Winner log loss** | 0.6324 [0.6165, 0.6474] | 0.6289 [0.6137, 0.6435] | **-0.0034 [-0.0073, +0.0008]** |
| Brier | 0.2206 | 0.2189 [0.2118, 0.2257] | -0.0017 [-0.0038, +0.0002] |
| Accuracy | 65.7% | 66.7% [63.5, 69.9] | +0.9 pts [-1.2, +3.2] |
| ECE (resampling spread) / calibration slope | 0.063 / 1.72 | 0.071 [0.044, 0.106] / 1.77 [1.45, 2.18] | |
| 7-bin log loss | 1.5712 | 1.5708 [1.5349, 1.6098] | -0.0004 [-0.0232, +0.0149] |
| Method log loss | 0.9399 | 0.9409 [0.9130, 0.9707] | +0.0010 [-0.0046, +0.0063] |
| who x how x when (methodround; model S 2.0418) | 2.0707 | 2.0699 (vs S +0.0281 [+0.0075, +0.0476]) | -0.0008 [-0.0248, +0.0184] |
| Stat-line deviance: sig landed / attempts | 21.866 / 43.422 | 21.817 / 43.364 | -0.049 [-0.212, +0.117] / -0.058 [-0.384, +0.258] |
| Stat-line deviance: TD / control s / KD | 1.806 / 154.12 / 0.652 | 1.798 / 153.71 / 0.653 | -0.008 [-0.019, +0.004] / -0.41 [-1.52, +0.63] / +0.001 [-0.003, +0.006] |
| MAE per fighter: TD / control s | 1.057 / 111.1 | 1.074 / 112.6 | +0.017 [+0.013, +0.021] / +1.48 [+0.96, +2.04] |

| base rate, validation | actual | v4 | v4.0.1 |
|---|---|---|---|
| finish / KO / SUB | 46.0 / 29.1 / 16.9% | 48.5 / 30.6 / 17.9% | 48.7 / 30.3 / 18.5% |
| KD per 100 head landed | 0.684 | 0.746 | 0.746 |
| decisions UD / SD / MD (n=459) | 81.5 / 18.1 / 0.4 | 79.4 / 20.1 / 0.5 | 79.6 / 19.5 / 0.9 |
| 10-8 share of decision judge-rounds (cards) | 2.46% | 3.38% | 4.60% (deductions counted as on the cards) |
| sig landed / TD per 15 | 58.1 / 1.41 | 63.3 / 1.31 | 63.4 / 1.40 |
| control s per 15 | 168 | 163 | 173 |

**Blend test:**
- With the line: engine weight 0.002 (v4 had 0.037). Log loss 0.57881 vs 0.57883, a difference of -0.00002.
- Without a line: weight 0. tools/evalv_blend.py now reports that case as exactly level.

**Decision: rejected.**
- Branch 1 fails: the winner log loss CI includes 0.
- Branch 2 fails: no 7-bin, method or stat-line deviance CI excludes 0.
- Base rates add nothing in its favour. The 10-8 share moves further from actual (4.60% vs 2.46%, v4 3.38%), while
  TD and control move closer. The MAE on TD and control is worse with CIs that exclude 0, on both windows. The likely
  reason is that matching the mean level lifts the prediction for these skewed counts further above their median.

### Train 2019-2023 (tuning data, not a selection criterion)

| train | v4 | v4.0.1 | paired [95% CI] |
|---|---|---|---|
| Winner log loss | 0.6635 | 0.6646 | +0.0011 [-0.0017, +0.0038] |
| 7-bin log loss | 1.6710 | 1.6538 | **-0.0172 [-0.0330, -0.0034]** |
| Method log loss | 0.9672 | 0.9685 | +0.0013 [-0.0019, +0.0047] |
| who x how x when | 2.2031 | 2.1901 | -0.0130 [-0.0299, +0.0016] |
| ECE / calibration slope | 0.019 / 1.06 | 0.010 / 1.01 | |
| P(draw) (actual 1.01%) / MD share (actual 2.0%) | 0.24% / 0.5% | 0.64% / 1.0% | |
| 10-8 share (cards 5.29%) / TD per 15 (1.306) / control per 15 (163.0) | 3.46% / 1.225 / 154.5 | 4.67% / 1.306 / 163.3 | |

### Read this honestly

1. **These were fixes, and the decision rule judges gains.**
   - The 7-bin gain on train came almost entirely from draws. Validation has 4 draws in 857 fights, so it cannot show.
   - Nothing else moved on either window.
   - Rejecting v4.0.1 keeps v4's protocol flaw in the current engine: its EM judging weights saw decision cards through
     2026-10, which covers the validation years and the vault.
   - The measured effect of that flaw is small. The reviewer's train test with pre-2023 weights moved winner log loss
     +0.0005. On validation, v4.0.1, which carries the clean weights, was not worse than v4.
   - It still matters for the v6 vault audit. **v5 must start from v4 plus the train-only judging weights**
     (data/derived/judge_em_train.json), the cumulative cap, deductions with draw and MD targets, and the
     learned-path levels. They then get measured inside v5's one look, not with an extra look of their own.
2. **v4.0.1 used one extra validation look.** It is recorded as its own entry in data/derived/version_history.json, with
   a note.
3. **Kept, because they do not change v4's behaviour:**
   - tests/test_director3.js now loads the production learned rates (the page's path) and checks that the per-round
     judges' scores add up to the cards. `NO_ML=1` runs the base tables.
   - tools/evalv_blend.py reports a weight-0 engine as level, not as an optimizer-tolerance "effect".
   - tools/evalv.js counts deductions in the simulated 10-8 share (engines without deductions are unaffected).
   - src/director3.js and src/app.js pass through and show `rd.ded` when an engine provides it (inert on v4).
   - The tools: tools/judge_em_train.py, tools/methodround_paired.py, and tools/judgecal.js and tools/v4_levels.js with
     their deduction and learned-path levers. Running v4_levels.js now rewrites src/params3.js with the new levers, so
     do that only for v5.
4. **Review items left open (in docs/BACKLOG.md):**
   - The self-calibration's KO/TKO composition targets come from the all-years base-rate table.
   - The v4 gain is attributable to the learned rates alone. v5 needs a train-only leave-one-out of EM judging, the
     priors_dev self-calibration and v4_levels, plus a "v3 params + learned rates" arm.
   - 3-round finish timing is off: round 2 14.5% vs 16.7%, round 3 9.1% vs 7.5% on train.
   - Backtest sides use the current stance, height and reach (accepted, documented).
   - Volkanovski vs Gaethje is 69.4% Volk in the engine against about 37% in the market. The page's final probability
     stays on the blend.

## v4 (2026-11-06): learned stat-line rates in the engine, train-only priors, EM judging, the standard evaluation

Status: **validated and kept** (Nov 6, about 10:25 am ET). Each version had exactly one validation look (2024-2025),
v3 first and then v4 paired against it: `node tools/evalv.js --version v3 --split val` and
`node tools/evalv.js --version v4 --split val --compare v3`. Both runs also ran the blend test.
- On validation, v4 beats v3 on winner log loss with a paired 95% CI that excludes 0: -0.0100 [-0.0170, -0.0030].
  That meets the first branch of the decision rule, so v4 keeps its number.
- Results are in data/derived/version_history.json (`validation`, `blend`, `decision`) and data/derived/evalv/.
- Frozen files: versions/v3/ (copied before any v4 edit) and versions/v4/ (engine3.js, params3.js, ml/mlrates.js).

### Validation 2024-2025 (one look per version) and the decision

Setup:
- 865 fights: 853 decisive, 857 with an outcome (DQ and no contests are dropped).
- Symmetric: both corner orders, 300 sims per order, common random numbers, walk-forward priors.
- v4 uses the dev model's learned rates for 2024-2025 (trained 2010-2023; `src: dev` in mlrates_oof.json). v3 has no
  learned rates.
- CIs come from 2,000 event-cluster bootstrap resamples (400 for ECE and slope). Paired differences are on the same fights.

| validation 2024-2025 | v3 | v4 | v4 - v3, paired [95% CI] |
|---|---|---|---|
| **Winner log loss** | 0.6424 [0.6272, 0.6577] | 0.6324 [0.6165, 0.6474] | **-0.0100 [-0.0170, -0.0030]** |
| Brier | 0.2252 [0.2180, 0.2326] | 0.2206 [0.2130, 0.2277] | -0.0046 [-0.0080, -0.0013] |
| Accuracy | 64.2% [60.7, 67.9] | 65.7% [62.2, 69.2] | +1.5 pts [-1.0, +3.9] |
| ECE (10 bins, mirrored; resampling spread) | 0.054 [0.033, 0.088] | 0.063 [0.038, 0.097] | |
| Calibration slope (mirrored, no intercept) | 1.57 [1.24, 1.95] | 1.72 [1.39, 2.09] | |
| 7-bin log loss | 1.5883 [1.5484, 1.6299] | 1.5712 [1.5277, 1.6201] | -0.0171 [-0.0343, +0.0018] |
| Method (KO/SUB/DEC) log loss | 0.9405 [0.9112, 0.9713] | 0.9399 [0.9103, 0.9702] | -0.0006 [-0.0108, +0.0097] |
| Stat-line deviance per fighter: sig landed | 22.831 [21.130, 24.597] | 21.866 [20.272, 23.521] | -0.965 [-1.329, -0.621] |
| Stat-line deviance per fighter: sig attempts | 45.310 [41.787, 49.121] | 43.422 [40.075, 46.940] | -1.889 [-2.778, -1.048] |
| Stat-line deviance per fighter: takedowns | 1.951 [1.820, 2.099] | 1.806 [1.682, 1.949] | -0.145 [-0.198, -0.097] |
| Stat-line deviance per fighter: control s | 164.39 [154.95, 174.45] | 154.12 [144.19, 164.46] | -10.27 [-14.00, -6.64] |
| Stat-line deviance per fighter: knockdowns | 0.668 [0.623, 0.722] | 0.652 [0.612, 0.697] | -0.016 [-0.031, -0.003] |
| MAE per fighter: sig landed / attempts / TD / control s / KD | 25.74 / 52.64 / 1.125 / 116.7 / 0.322 | 25.01 / 51.00 / 1.057 / 111.1 / 0.321 | -0.73 [-1.01, -0.46] / -1.64 [-2.20, -1.07] / -0.068 [-0.084, -0.052] / -5.57 [-7.04, -4.18] / -0.001 [-0.004, +0.002] |

The methodround metrics are scored by `tools/methodround.py --score` on 857 fights. Each version's column shows the
difference from model S. The v4 - v3 column comes from the same scoring code, paired (data/derived/evalv/v4_vs_v3_val_methodround_paired.json).

| validation 2024-2025 | model S | v3 (vs S) | v4 (vs S) | v4 - v3 [95% CI] |
|---|---|---|---|---|
| who x how x when (joint) | 2.0418 | 2.0877 (+0.0460 [+0.0216, +0.0682]) | 2.0707 (+0.0289 [+0.0015, +0.0575]) | -0.0171 [-0.0368, +0.0043] |
| method given winner | 0.9073 | 0.9192 (+0.0119 [-0.0019, +0.0260]) | 0.9107 (+0.0034 [-0.0108, +0.0182]) | -0.0085 [-0.0213, +0.0039] |
| method x round | 1.4240 | 1.4329 (+0.0089 [-0.0074, +0.0235]) | 1.4327 (+0.0087 [-0.0092, +0.0253]) | -0.0002 [-0.0114, +0.0113] |
| round given finish | 1.0601 | 1.0642 (+0.0041 [-0.0155, +0.0217]) | 1.0625 (+0.0023 [-0.0172, +0.0205]) | -0.0018 [-0.0131, +0.0105] |
| finish vs decision | 0.6593 | 0.6603 (+0.0010 [-0.0090, +0.0110]) | 0.6617 (+0.0024 [-0.0089, +0.0134]) | +0.0014 [-0.0059, +0.0085] |
| KO vs SUB | 0.6017 | 0.6095 (+0.0078 [-0.0069, +0.0236]) | 0.6052 (+0.0035 [-0.0126, +0.0205]) | -0.0043 [-0.0186, +0.0100] |
| winner | 0.6213 | 0.6424 (+0.0211 [+0.0109, +0.0315]) | 0.6324 (+0.0111 [+0.0024, +0.0198]) | -0.0100 [-0.0173, -0.0029] |

| base rate, validation | actual | v3 | v4 |
|---|---|---|---|
| finish rate | 46.0% | 48.2% | 48.5% |
| KO/TKO share | 29.1% | 30.6% | 30.6% |
| submission share | 16.9% | 17.7% | 17.9% |
| decision share | 54.0% | 51.8% | 51.5% |
| finish by round, 3-round fights (n=752) | 23.7/13.7/7.8 | 24.3/14.3/9.0 | 24.6/14.4/9.0 |
| finish by round, 5-round fights (n=105) | 15.2/16.2/9.5/7.6/2.9 | 14.7/12.9/10.3/9.2/5.4 | 14.5/12.4/10.1/9.2/5.4 |
| KD per 100 head landed | 0.684 | 0.717 (+4.8%) | 0.746 (+9.0%) |
| decisions UD / SD / MD (n=459) | 81.5 / 18.1 / 0.4 | 79.6 / 19.0 / 1.4 | 79.4 / 20.1 / 0.5 |
| 10-8 share of judge-rounds in decisions (cards) | 2.46% (6.28% before the fix below) | 4.96% | 3.38% |
| sig landed per 15 (per fighter) | 58.1 | 63.9 (+9.9%) | 63.3 (+9.0%) |
| takedowns per 15 | 1.41 | 1.35 | 1.31 |
| control s per 15 | 168 | 167 | 163 |

Checked against the mlcal objective tolerances (KO 2 pts, SUB 1.5 pts, R1 and R3 share of 3-round finishes 3 pts,
SD+MD share 4 pts, KD 12%, TD 10%, control 10%), everything is in tolerance for both versions except sig landed per 15.
That one is 9.0% high for v4 and 9.9% for v3, against a 6% tolerance.
- The cause is a league-level shift: train 61.1 per 15, validation 58.1. The 5-year walk-forward priors lag it.
- v4 is no further off than v3 on any rate in that list except two, both still inside tolerance: KD per 100 head
  (+9.0% vs +4.8%; tools/v4_levels.js raised kdScale on train, and 2024 had the glove-trial KD dip) and TD per 15
  (-7.1% vs -4.3%).

**Blend test** (tools/evalv_blend.py):
- Method: the MoE linear stacker, no intercept, was refit on 2019-2023 with each version's engine probabilities and
  scored on 2024-2025. Both arms cover the same 845 fights.

| blend pattern | v3 engine weight | v4 engine weight | v4: log loss with engine | without | with - without [95% CI] |
|---|---|---|---|---|---|
| with the closing line | 0.000 | 0.037 | 0.5786 | 0.5788 | -0.0002 [-0.0006, +0.0001] |
| without a line | 0.000 | 0.000 | 0.5930 | 0.5930 | 0.0000 |

- v4's weights with the line: market 0.863, market rating 0.106, ml 0.142, feature LR 0.039, engine 0.037, Elo 0.
- Without a line: market rating 0.854, ml 0.555, feature LR 0.026, engine 0.

**Decision: v4 is kept.**
- Winner log loss improves on validation with a paired CI that excludes 0 (first branch of the rule).
- Brier and all five stat-line deviances improve too, each with a CI that excludes 0.
- 7-bin (-0.0171), who x how x when (-0.0171) and method (-0.0006) point the right way but are not significant.

Read this honestly:
1. **The engine still adds almost nothing to the blend.** It earns its first non-zero validated weight (0.037, with
   the line only), but the blend's validation log loss does not move measurably (-0.0002, CI includes 0).
   - The BACKLOG goal "earn a non-zero validated weight" is met only on paper.
   - Without a line, the learned stat-line model enters through `ml` directly, and the engine is redundant with it.
2. **v4 still trails methodround model S.** It is behind on who x how x when (+0.029, CI just excludes 0) and on the
   winner (+0.011). The gap to S is smaller than v3's on both (v3: +0.046 and +0.021).
3. **Calibration worsened slightly.**
   - ECE 0.063 vs 0.054; calibration slope 1.72 vs 1.57.
   - Both versions are underconfident on 2024-2025, as every input was (BACKLOG "Prediction status").
   - v4 separates winners from losers better (lower log loss and Brier) but is more underconfident than v3. Its
     probabilities need a recency temperature at release.
4. **v3's validation numbers are flattered.** Its [selfcal] scales saw all-years league averages, 2024-2025 included,
   so the real v4 margin is, if anything, a little larger.
5. **Added after the v4 review: v4's own validation look was not fully clean.**
   - Both main ingredients had been scored on 2024-2025 before the look:
     - the learned rates in the simulator (research/model_mlrates.md: 0.6465 -> 0.6239);
     - the train-only self-calibration (data/derived/mlcal_val_ledger.json entry 9087f41436d7d4b9).
   - The EM judging weights and the self-calibration's KO/TKO composition targets come from all-years tables.
   - The train window alone supports v4: -0.0081 [-0.0134, -0.0026], negative in all five years.
   - The v6 vault audit is the first clean out-of-sample test of the v4 bundle.
   - The reviewer's train-only ablation puts the whole gain on the learned rates. The other v4 changes are neutral to
     slightly negative there and were never ablated.

Evaluation fixes made after the look (data side only: no re-simulation, no metric or decision input changes):
- **10-8 base rate.** tools/evalv.js computed the 'actual' 10-8 share from the scheduled number of rounds.
  - A 2025 technical draw (08c04f18b0f58d71, cards over 2 rounds) added 19 phantom points per card.
  - So did a fight stored as 5 rounds but judged over 3 (b959e2c1d16ff832, 2025-02-22), at 38 per card.
  - Together they lifted the 2024-2025 'actual' from 2.46% to 6.28%. Judged rounds now come from each card's total.
  - Train (5.29%) is unchanged. The stored files carry `r108.actual_fixed` and a note.
- **Correction (v4 review): not a data issue.** b959e2c1d16ff832 is Cejudo vs Song: a 5-round bout that ended as a
  technical decision after an eye poke in round 3 (raw ufcstats: 'Technical Decision - Eye Poke by Song', '5 Rnd').
  `rounds: 5` is right, and tools/build_db.py needs no change. evalv now takes judged rounds from the card totals.

### What changed vs v3

1. **The learned stat-line model runs inside the engine.**
   - `FightEngine.loadMLRates(json)` loads data/derived/mlrates.json through src/ml/mlrates.js.
   - When a model is loaded, `matchup()` = `matchupBase()` (the v3 tables) plus `MLRates.applyToMatchup` at the
     engine's own league level.
   - `opts.ml === false` keeps the base tables. `opts.ml = { pred }` takes precomputed per-side rates (the leak-free
     backtest path). `params.mlWeight` and `params.mlMaxRatio` are the new params.
   - The page: build.py puts src/ml/mlrates.js in the engine script, so the tally worker built from that script's text
     has the adapter. src/app.js posts the model JSON to the worker; the worker also receives every matchup with the
     learned tables applied. Headless check: v4 engine with the native model, a 20,000-fight tally in the background
     thread with ML stat lines on, no console errors.
   - src/ml/mlrates.js `leagueExpect` now calls `matchupBase` with `ml: false`, so there is no recursion. Its cache key
     carries the per-call params overrides, so a tuner's strikeScale change is no longer masked by a cached league level.
2. **Train-only priors.**
   - `tools/build_db.py --priors-until 2024-01-01 --priors-only --priors-out data/derived/priors_dev.json` builds them
     from fights 2018-01-01..2023-12-31 (Lightweight 406 fights vs 608 in the production priors).
   - The engine's self-calibration was re-run on them (`tests/test_engine3.js --fit --write --priors ...`): global
     scales and every `div.*` factor.
   - tests/test_engine3.js now checks base rates against these priors by default.
3. **Judging.**
   - EM round-winner weights: head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min, sub attempt 0.85.
     The engine-only hurt weight is 0.8.
     - Correction (v4 review): these come from the earlier 7,495-card run, not the 7,550-card fit cited in the params
       comment. Both runs cover cards from 2015 through 2026-10, so they are **not train-only**: they include the
       validation years and the vault. Only the noise and 10-8 terms below are train-only.
     - The train-only refit (tools/judge_em_train.py) shipped in v4.0.1, which was rejected; see above.
   - tools/judgecal.js fit the noise and the 10-8 rule by maximum likelihood on the 3,883 judges' rounds of 2019-2023
     (data/derived/judgerounds_rows.json):
     - shared sd 1.53 and individual sd 1.08;
     - a fight-level share of the shared noise of 0.28 (LR 101: panel residuals correlate about 0.12 between rounds of a
       fight);
     - no fight-level judge tastes: a judge who dissents twice in a fight goes either way equally often (37 vs 40);
     - 10-8 threshold 6.29 (2019-2020) / 7.07 (2021-2023). The threshold rises by 1.087 per KD of edge: t108kd = -1.087
       enters as t108 - t108kd x min(2, KD edge). A KD-edge round winner gets a 10-8 13% of the time, not the 23% the
       z margin alone implies.
   - On the real rounds the fitted judges reproduce:
     - non-unanimous rounds 22.6% (data 21.3%);
     - pair disagreement 15.1% (14.2%);
     - majority agrees with the EM leader 81.7% (82.9%);
     - 10-8 share 4.5% / 3.7% (4.5% / 3.6%);
     - 10-8 given a KD edge 13.5% (13.1%).
     Decisions come out UD 76.5% vs 80.3%, the one gap left.
   - In the engine, sharedSd is 1.416 (the hurt/power terms' residual variance taken out) and sharedFight 0.33.
4. **Re-tune on TRAIN only.**
   - tools/mlcal.py with tools/mlcal_spec_engine4.json: 11 global scales including mlWeight, learned rates on through
     tools/mlcal_hooks/ml_oof_v4.js, 20 TPE + 16 CMA trials, `--no-val`.
     - No finalist beat the self-calibrated set on both train windows: baseline tuning 1.5596 / confirmation 1.5573;
       best finalists 1.5667 / 1.5551 and 1.5487 / 1.5680.
     - Nothing was adopted (data/derived/mlcal_candidates_v4.json).
   - tools/v4_levels.js then matched four levels on 1,000 train fights with the learned rates on: kdScale 1.236 ->
     1.391, KO conversion x0.89 on odds, subConvScale 1.488 -> 1.847, t108 7.07 -> 8.555. The self-calibrated league level
     ran about 10% low on knockdowns per landed head strike on real fights, and the engine's rounds, with hurts, gave
     6.9% 10-8s against 3.6%.

### The standard evaluation (tools/evalv.js, new)

- Fights are symmetric (both corner orders), with common random numbers, 300 sims per order, walk-forward priors and
  out-of-fold learned rates.
- CIs come from a 2,000-resample event-cluster bootstrap.
- methodround `--score` gives the who x how x when metrics, paired against model S.
- There is also a stat-line deviance and a base-rate table.
- The blend test is tools/evalv_blend.py: the MoE linear stacker refit with the version's engine, then the validated
  engine weight and the validation log loss with and without the engine. It only runs on the validation run; its
  plumbing was checked train-only with `--dry` (fit 2019-2022, score 2023).
- Results: data/derived/evalv/, data/derived/version_history.json.

### Train numbers (2019-2023; tuning data for both versions, so not a selection criterion)

| train 2019-2023 (1,952 decisive of 1,999 fights) | v3 | v4 | v4 - v3, paired [95% CI] |
|---|---|---|---|
| Winner log loss | 0.6716 [0.6620, 0.6814] | 0.6635 [0.6529, 0.6740] | -0.0081 [-0.0134, -0.0026] |
| Brier | 0.2394 [0.2349, 0.2441] | 0.2355 [0.2304, 0.2405] | -0.0040 [-0.0065, -0.0012] |
| Accuracy | 0.5710 [0.5501, 0.5912] | 0.6053 [0.5817, 0.6290] | +0.0343 [+0.0163, +0.0524] |
| 7-bin log loss | 1.6636 [1.6350, 1.6929] | 1.6710 [1.6320, 1.7098] | +0.0074 [-0.0092, +0.0254] |
| Method (KO/SUB/DEC) log loss | 0.9690 [0.9462, 0.9929] | 0.9672 [0.9436, 0.9923] | -0.0018 [-0.0087, +0.0059] |
| ECE (10 bins, mirrored) | 0.0181 | 0.0187 | |
| Calibration slope (mirrored, no intercept) | 0.926 [0.741, 1.111] | 1.059 [0.894, 1.292] | |
| Stat-line deviance per fighter: sig landed | 24.302 [23.053, 25.492] | 23.681 [22.487, 24.885] | -0.621 [-0.931, -0.321] |
| Stat-line deviance per fighter: sig attempts | 50.607 [48.156, 53.044] | 49.318 [46.923, 51.668] | -1.289 [-1.939, -0.616] |
| Stat-line deviance per fighter: takedowns | 1.856 [1.780, 1.941] | 1.740 [1.660, 1.822] | -0.116 [-0.150, -0.081] |
| Stat-line deviance per fighter: control s | 164.526 [157.959, 171.090] | 156.470 [149.458, 163.351] | -8.056 [-10.534, -5.356] |
| Stat-line deviance per fighter: knockdowns | 0.721 [0.689, 0.756] | 0.715 [0.684, 0.748] | -0.006 [-0.015, +0.003] |
| who x how x when log loss (model S 2.1523) | 2.1984 (+0.0461 [+0.0301, +0.0625]) | 2.2031 (+0.0508 [+0.0322, +0.0701]) | +0.0047 |
| method (methodround) log loss (model S 0.9569) | 0.9690 (+0.0121 [+0.0039, +0.0206]) | 0.9672 (+0.0103 [+0.0018, +0.0195]) | -0.0018 |
| method x round log loss (model S 1.4811) | 1.5001 (+0.0191 [+0.0087, +0.0297]) | 1.4977 (+0.0167 [+0.0054, +0.0283]) | -0.0024 |
| round given finish log loss (model S 1.0620) | 1.0787 (+0.0167 [+0.0048, +0.0284]) | 1.0773 (+0.0153 [+0.0039, +0.0264]) | -0.0014 |

| base rate (train) | actual | v3 | v4 |
|---|---|---|---|
| finish rate | 49.2% | 49.6% | 49.2% |
| KO/TKO share | 31.7% | 32.1% | 32.3% |
| submission share | 17.5% | 17.4% | 16.9% |
| decision share | 50.8% | 50.4% | 50.8% |
| finish by round, 3-round fights | 24.4/16.7/7.5 | 25.3/14.5/9.2 | 25.1/14.5/9.1 |
| finish by round, 5-round fights | 17.3/16.5/9.5/5.3/4.9 | 15.3/13.2/10.4/9.2/5.4 | 14.5/12.8/10.4/9.3/5.4 |
| KD per 100 head landed | 0.782 | 0.788 | 0.784 |
| decisions UD / SD / MD | 78.6 / 19.4 / 2.0 | 79.4 / 19.2 / 1.4 | 79.3 / 20.2 / 0.5 |
| 10-8 share of judge-rounds in decisions | 5.29% (cards; 4.5% 2019-23 and 3.6% 2021-23 in the judges' rounds) | 5.09% | 3.46% |
| sig landed per 15 (per fighter) | 61.1 | 61.0 | 61.7 |
| takedowns per 15 | 1.31 | 1.31 | 1.23 |
| control s per 15 | 163 | 164 | 155 |

Read: on train, v4 beats v3 on the winner and on every stat line except knockdowns (tie). The 7-bin, method and
who-x-how-x-when scores are level with v3, and both trail methodround model S there. v3's train numbers are flattered
too: its walk-forward stage was tuned on these fights, and its [selfcal] values saw all-years league rates. The 5-round
finish curve is still off in both versions (too few early finishes, too many in R3-R4); that is v6 (dynamics).

## v3 (2026-11-06): data-driven any-fighter engine, walk-forward calibrated

### What changed vs v2

v2 was a hand-built Volkanovski vs Gaethje simulator:
- Its constants, knobs, presets, director tables, 3D specs and page copy were all hard-wired to those two fighters.
- Strike rates averaged career landed/min with absorbed/min and multiplied by `STRIKE_CAL = 0.85`, a factor tuned on 4
  in-sample fights. The audit found that formula under-predicts landed strikes by 18% walk-forward.
- Night-to-night form spreads were tiny (output 0.10, power 0.15, chin 0.12).
- It finished 36% of five-round fights against 58% in the data, with a hazard that rose by round.
- Knockdowns converted to same-round finishes 37% of the time against 57% in the data.
- Its "backtest" was 7 in-sample fights (research/audit_v2.md).

v3 (src/engine3.js, src/params3.js, docs/ENGINE_V3_SPEC.md) replaces all of that:
- **Any two fighters.** 1,229 profiles in data/derived/fighters.json, built from round-level ufcstats data.
  - Sums are time-decayed (730-day half-life) and shrunk toward the fight division's priors.
  - Profiles become rates only inside the engine, so a live profile and a frozen backtest snapshot go through the same code.
- **Matchup construction.** Attacker and defender rates combine log-linearly; probabilities combine by log5 on odds.
  - Strikes are attempts times accuracy, by target (head/body/leg) and position (distance, clinch, ground), so misses are real events.
  - Clinch entry and stand-up hazards are fit per pair, so simulated control and clinch time match the pair's data-implied targets.
- **Fight model.** Ground sub-positions (guard, half, side, mount, back) with passes, escapes, sweeps and stand-ups.
  - Knockdowns come from power x chin with age, prior-KO-loss and size factors. A knockdown leads to an instant KO or a follow-up with a referee-stop hazard.
  - Also modeled: hurt states; standing, ground-and-pound and leg-kick TKOs; position-specific submissions plus guillotines on stuffed shots; doctor and corner stoppages; stamina and pace curves.
- **Judging.** Three judges use the round-winner logistic weights fit on real rounds, with fight-level tastes, shared and individual noise, and 10-8 rules.
- **Trace.** The trace keeps the v2 event kinds, so src/director.js still works.
- **Calibration and validation.** tools/calibrate.js (new) does the walk-forward calibration and validation described below.

This entry also adds four tunable hooks to the engine and params. Each defaults to neutral, and the engine VERSION stays 3.0.0:
- `powExp` and `chinExp`: exponents on the shrunk power and chin ratios.
- `ctrlScale`: a global control-target scale, the inverse of a get-up scale.
- `caution5`: a knockdown / GNP / submission-conversion factor in every round of 5-round fights.

### How it was calibrated (tools/calibrate.js)

`node tools/calibrate.js [--quick] [--final-only] [--no-write] [--budget=MIN] [--n=N] [--nfinal=N]` uses worker_threads, one per core.

**Data.** Every entry of data/derived/backtest.json: 3,237 UFC fights from 2019-01-01 to 2026-10-31 in which both men had an
earlier UFC fight.
- Each side is the snapshot built only from fights before that date.
- Division priors come from `priors_asof[year]`: the 5 years before Jan 1 of the fight's year, so nothing from the
  fight's year or later leaks in. fighters.json priors include test fights and are kept for live use only.
- **Split:** train 2019-2023, 1,955 decisive fights (1,972 with a known method, draws included). Test 2024-01-01 on, 1,223 decisive (1,229).
- Every fight is simulated with fixed per-simulation seeds.
- Everything is corner-symmetric, because ufcstats lists the winner first 56% of the time:
  - no model has an intercept;
  - calibration bins count every fight in both orientations;
  - the blend is a no-intercept logistic regression.

**Why not plain coordinate descent on log loss.** In a continuous-time event simulation, common random numbers stay
shared only for the first few events. The Monte Carlo sd of the train objective was 0.003 even at 150 simulations per
fight, as large as most parameter effects. So tuning ran in two stages.

**Stage 1: fixed point on train data targets.** Eight dampened iterations at N=80 per fight:
- **Volumes (moment-matched):** strike attempts, accuracy, KD per landed head strike, takedown attempts and accuracy,
  control and submission attempts per minute.
- **Outcome shares:**
  - the KO share sets `koAll`, which scales instant-KO and referee-stop odds plus the standing and GNP TKO hazards;
  - the SUB share sets submission conversion;
  - the 5-round finish rate sets `caution5`;
  - the unanimous share of decisions sets the individual judge noise.
- **Per-fight dispersion (new):** the engine's predictive spread of each fighter's landed rate and accuracy is
  widened until it matches how far real fights fall from the engine's mean.
  - The part of the error the two fighters share goes to the shared fight pace; the rest goes to individual form.
- **Finish timing:** the round-1 share of 3-round finishes sets the power/chin form spread.
- **Knockdown regression (new):** a Poisson regression of actual knockdowns on the engine's predicted knockdowns (as an
  offset), with power ratio, opponent chin ratio, ages past 34, prior KO losses and weight moves as covariates.
  - It updates `powExp`, `chinExp`, `chinAge`, `powAge`, `chinKO` and `sizeChin`, each coefficient shrunk by its precision.

**Stage 2: coordinate descent with shrinking steps** on the train objective. The objective is winner log loss +
0.5 x 7-bin log loss + base-rate drift penalties (finish rate in 3 and 5 rounds, KO and SUB shares, KD/100, unanimous share).
- It covered the levers without a direct data target: judge-noise scale, fight volatility, 5-round round-1 caution and
  pacing, and the standing and GNP TKO hazards.
- A step had to beat 2 Monte Carlo sd at N=150. None did, so those levers keep the builder's values.
  stko and gnpTko are still rescaled through `koAll`.

**Final evaluation.** N=1,000 simulations per fight on train and test, with fresh seeds. Compute was 37.7 minutes on 4
cores at a load average of 45-50 from other jobs.

### Tuned values (src/params3.js, tagged `[walkfwd 2026-11-06]`)

| parameter | before | after | driven by |
|---|---|---|---|
| form.out (output sd) | 0.15 | 0.357 | per-fight landed-rate dispersion (ratio 2.07 -> 1.00) |
| form.pace (shared pace sd) | 0.10 | 0.329 | A/B residual covariance (0.117 data vs 0.046 sim -> matched) |
| form.acc (accuracy logit sd) | 0.12 | 0.478 | per-fight accuracy dispersion (ratio 2.44 -> 1.00) |
| form.pow = form.chin | 0.45 | 0.316 | round-1 share of 3-round finishes |
| judge.indSd | 1.206 | 1.975 | unanimous share of decisions (82.5% -> 79.4%, data 78.6%) |
| chinExp / powExp | 1 / 1 | 0.546 / 1.104 | knockdown regression (opponent-chin coefficient -0.39 +- 0.13 at the start) |
| powAge | 0.03 | 0.115 | knockdown regression (power past 34: -0.097 +- 0.028 per year at the start) |
| chinKO | 0.04 | 0.124 (cap 1.15 kept) | knockdown regression |
| sizeChin | 0.05 | 0 | knockdown regression (moving up: -0.16 +- 0.08; no extra knockdowns absorbed) |
| chinAge | 0.04 | 0.041 | knockdown regression (no change needed) |
| kdInstant / kdRefStop | 0.376 / 0.190 | 0.318 / 0.153 | KO share (`koAll` 0.771; stko 0.0446 -> 0.0344, gnpTko 0.032 -> 0.0247) |
| subConvScale | 1.385 | 1.619 | SUB share |
| caution5 (new) | 1 | 0.626 | 5-round finish rate (63.6% -> 53.6%, data 53.5%) |
| strikeScale / accScale / kdScale | 1.063 / 0.950 / 1.232 | 1.107 / 1.021 / 1.246 | attempts / accuracy / KD per 100 head landed |
| tdScale / tdOddsScale / subAttScale / ctrlScale | 1.008 / 0.904 / 1.073 / 1 | 0.972 / 0.910 / 1.042 / 1.004 | takedown / submission / control rates |

Unchanged: judge.sharedSd 1.1, form.vol 0.6, form.grap 0.3, r1Caution5 0.75, drainSchedExp 0.2, per-division factors
(`div`).

Effect on the train objective: 1.592 -> 1.508. Winner log loss 0.681 -> 0.672, 7-bin 1.707 -> 1.672, drift penalty
0.057 -> 0. The noise-corrected train calibration slope went from 0.76 (overconfident) to about 1.0.

### Numbers

Winner metrics exclude draws and no-contests. ECE uses 10 bins over both corner orientations. Slope is a
no-intercept logistic recalibration slope: below 1 means overconfident, above 1 means underconfident.

**Held-out test, 2024-01-01 to 2026-10-31** (n = 1,223 decisive; 1,229 for 7-bin):

| model | log loss | Brier | accuracy | ECE | slope | 7-bin log loss |
|---|---|---|---|---|---|---|
| engine v3 | **0.6480** | **0.2281** | **64.0%** | 4.5% | 1.37 | **1.605** |
| Elo (scale 515 fit on train) | 0.6805 | 0.2438 | 55.0% | 1.8% | 1.28 | 1.717 (Elo x train method split) |
| blend (0.830 x engine logit + 1.173 x Elo diff / 400) | 0.6453 | 0.2268 | 63.0% | 3.9% | 1.47 | - |
| naive: more prior UFC wins | 0.6928 | 0.2498 | 53.3% | 3.1% | - | - |
| coin flip | 0.6931 | 0.2500 | 50% | - | - | - |

**Test slices:**

| slice | n | engine LL | Elo LL | blend LL | engine accuracy |
|---|---|---|---|---|---|
| 2024-2025 (the validation window from v4 on) | 854 | 0.6434 | 0.6783 | 0.6399 | 65.0% |
| 2026 (the vault from v4 on) | 369 | 0.6586 | 0.6857 | 0.6579 | 61.7% |
| 3-round fights | 1,076 | 0.645 | 0.681 | - | 65.2% |
| 5-round fights | 147 | 0.670 | 0.675 | - | 55.1% |

**Train, 2019-2023** (n = 1,955), at the tuned values:

| model | log loss | Brier | accuracy | ECE | slope | 7-bin log loss |
|---|---|---|---|---|---|---|
| engine | 0.6721 | 0.2396 | 57.7% | 1.8% | 0.92 | 1.661 |
| Elo | 0.6851 | 0.2460 | 54.9% | 0.7% | 1.00 | 1.739 |
| blend | 0.6688 | 0.2381 | 58.9% | 0.6% | 1.00 | - |

**Before vs after tuning, on test.** The builder's self-calibrated parameters scored log loss 0.6584, Brier 0.2329,
accuracy 61.5%, ECE 1.7%, slope 0.94 and 7-bin 1.630.
- That read used N=100 simulations per fight. Monte Carlo noise inflates log loss by about 1/(2N), so the comparable
  winner log loss is about 0.654, against 0.648 after tuning. The comparable 7-bin is about 1.60, about the same as after.
- So tuning bought about 0.006 nats of winner log loss, 0.005 of Brier and 2.5 points of accuracy on test.
- It cost calibration error: ECE 1.7% -> 4.5%, because the tuned engine is underconfident in 2024+ (see caveats).

**Per division (test):** the engine beats Elo in 9 of 11 divisions.
- **Engine ahead:** LW 0.654 vs 0.676; MW 0.634 vs 0.676; FW 0.655 vs 0.692; BW 0.665 vs 0.691; WW 0.630 vs 0.693;
  FLW 0.646 vs 0.681; Women's Strawweight 0.609 vs 0.680; Women's Flyweight 0.635 vs 0.658; Women's Bantamweight 0.598 vs 0.687.
- **Elo ahead:** Light Heavyweight (0.695 vs 0.662, n=83) and Heavyweight (0.687 vs 0.671, n=79).

**Base rates, simulated vs actual:**

| | train sim | train actual | test sim | test actual |
|---|---|---|---|---|
| finish rate | 49.6% | 49.2% | 48.4% | 48.9% |
| finish rate, 5 rounds | 53.6% | 53.5% | 51.9% | 54.4% |
| KO/TKO / SUB / decision | 32.1 / 17.4 / 49.4 | 31.7 / 17.5 / 49.8 | 31.0 / 17.4 / 50.6 | 31.9 / 17.0 / 50.5 |
| 3 rounds: finished in R1 / R2 / R3 | 25.3 / 14.5 / 9.2 | 24.4 / 16.7 / 7.5 | 24.5 / 14.4 / 9.1 | 26.0 / 14.2 / 8.0 |
| 5 rounds: R1 / R2 / R3 / R4 / R5 | 15.4 / 13.2 / 10.4 / 9.2 / 5.4 | 17.3 / 16.5 / 9.5 / 5.3 / 4.9 | 14.6 / 12.7 / 10.3 / 9.2 / 5.2 | 15.0 / 17.7 / 10.9 / 6.1 / 4.8 |
| unanimous / split / majority (of decisions) | 79.4 / 19.2 / 1.4 | 78.6 / 19.4 / 2.0 | 79.6 / 19.1 / 1.4 | 82.6 / 16.4 / 1.0 |
| KD per 100 head strikes landed | 0.785 | 0.781 | 0.731 | 0.768 |
| sig. landed / attempted per 15 per fighter | 61.0 / 130.9 | 61.1 / 131.0 | 63.4 / 129.4 | 58.1 / 122.8 |
| takedowns landed per 15, accuracy | 1.31, 36.5% | 1.31, 36.5% | 1.37, 35.9% | 1.43, 35.9% |
| control seconds per 15 | 163 | 163 | 166 | 168 |

**Per-fight stat error (test).** Each fighter-side's simulated rate per minute is multiplied by the actual fight
minutes and compared with the division-average rate.
- Significant strikes landed: MAE 18.2 against 20.3 for the division average; RMSE 25.1 against 27.8; correlation 0.45; bias +9.3%.
- Takedowns landed: MAE 1.04 against 1.18; correlation 0.41; bias -4.5%.

**Volkanovski vs Gaethje** (Lightweight, 5 rounds, title, 20,000 fights, seed 20261106, current profiles, src/params3.js
as written):
- **Win:** Volkanovski 63.3%, Gaethje 35.9%, draw 0.7%. Elo alone gives 57.2% (1802 vs 1737); the blend gives 66.0%.
- **Outcome bins:**

  | Volk KO/TKO | Volk sub | Volk dec | draw | Gaethje dec | Gaethje sub | Gaethje KO/TKO |
  |---|---|---|---|---|---|---|
  | 14.9% | 4.0% | 44.5% | 0.7% | 17.3% | 2.2% | 16.4% |

- **Finishes by round:**

  | | R1 | R2 | R3 | R4 | R5 |
  |---|---|---|---|---|---|
  | Volkanovski | 3.8% | 4.1% | 4.4% | 4.0% | 2.6% |
  | Gaethje | 5.7% | 4.3% | 3.2% | 3.6% | 1.8% |

- **Distance:** 62.5% go the distance (UD 81%, SD 16%).
- **Knockdowns:** per landed standing head strike, Gaethje 1.27% vs Volkanovski 0.54%.
- **Doctor and corner stoppages:** 5.3% of fights. These run high in general: the sim gives 1.6% doctor + corner
  stoppages on train fights vs 0.6% doctor stoppages in the data, where corner stoppages are filed under KO/TKO.
- **Change from before:** before the walk-forward tuning the same matchup gave Volk 62.9%, but with only 41% going the distance. The tuned engine
  keeps the winner split and moves about 21 points from finishes to decisions, mostly through `caution5` (5-round
  fights) and the lower chin exponent.

**Tests:** `node tests/test_engine3.js` passes 42 of 42 with the tuned values. That includes the league-average
base-rate checks for all 8 checked divisions: Lightweight finish 52.3% vs 52.7% data, KO 34.1% vs 35.6%, SUB 18.1%
vs 17.1%, KD/100 head landed 0.889 vs 0.875.

### Caveats (honest)

1. **The test period is more predictable than train, and the tuned engine is underconfident there.** Its test slope is
   1.37, so its probabilities should be stretched, and ECE is 4.5%. Elo with a train-fit scale shows the same shift
   (slope 1.28), so it is a period effect more than an engine one. Before tuning the engine was sharper and better
   calibrated on test (ECE 1.7%) but had worse log loss, Brier and accuracy. Recalibrating on train does not fix this,
   because on train the engine is already calibrated (slope 0.92). A v9 recalibration should be fit on the 2024-2025
   validation window.
2. **Stage 2 changed nothing.** The judge-noise scale, fight volatility, 5-round pacing and the standing/GNP TKO split
   could not be distinguished from Monte Carlo noise (objective sd 0.003 at N=150). They stay at the builder's values.
3. **5-round finishes are spread too evenly by round.** Round 4 is over-predicted (9.2% of fights vs 5.3% train and
   6.1% test) and round 2 under-predicted (13% vs 17-18%). The total is right on train and 2.5 points low on test.
4. **Strike volume is 9% high on test.** UFC fights in 2024-2026 had fewer attempts (122.8 vs 131.0 per 15) and the
   division priors lag (the 5 years before the fight's year). The volume scales were matched on 2019-2023.
5. **The widened form spreads are not pure night-to-night form.** form.out 0.36, pace 0.33 and acc 0.48 were fit to how
   far real fights fall from the engine's mean, so they include the engine's own prediction error. That is the right
   width for calibrated outcomes, but a single simulated fight is now noisier than a typical real fight between two
   known quantities.
6. **The per-division factors (`div`) leak a little base-rate information.** They come from the builder's
   league-average self-calibration against fighters.json priors, which include 2024+ fights. That is rates only, not
   per-fight outcomes.
7. **The Elo baseline itself was tuned on 2019-2023** (K 44, boost 1.5 in data/derived/elo_report.json). Its scale was refit
   here (515). The blend weights also come from train.
8. **v3 used the 2026 slice once,** as the v3 task specified (test = 2024-01-01 on). From v4 on that slice is the sealed
   vault (docs/BACKLOG.md), so later versions should compare on the 2024-2025 numbers above.
9. **Volkanovski vs Gaethje disagrees with the market.** The openers (Oct 24-25, 2026; docs/BACKLOG.md) have Gaethje
   a -180 to -200 favourite, 37% no-vig for Volk. The engine has Volk 63%, Elo 57%. The engine's edge for Volk comes
   from his landed-volume and accuracy rates. The market may be pricing things the stats see only partly (age 38, three
   KO losses, the move up; the knockdown regression found no extra knockdown risk for moving up across 3,950
   fighter-sides). Treat the engine number as the stats view, not a betting line.
10. **Monte Carlo:** N=1,000 per fight inflates log loss by about 0.0005. Debutants are excluded from the backtest, since both men need a
    prior UFC fight.
