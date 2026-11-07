# Fight engine v3: specification

Status: design contract for the v3 rebuild (Nov 6, 2026). The data pipeline, the engine, the calibration
harness, the director, the 3D show and the page all build against this file. When code and this file
disagree, fix one of them in the same change.

**Shipped engine (Nov 7, 2026): v4 (4.0.0)** in src/ (sha256 6c661f68... / e16a6481...), frozen in versions/v4/: the v3 contract
plus the "Engine v4" section below. That is what the page, the forward ledger (fwd-4.2) and the default tools run. The "Engine v5
..." sections and "Engine v5.0.1" at the end describe the components built and measured since; v5 (5.0.0) and v5.0.1 were each
validated once and rejected, so they are not shipped. Their code is in versions/v5.0.1-rejected/ (every component flag-isolated,
each flag off = the version before it), which is the base for v6.

## Goals

1. **Any two fighters.** Every fighter in the UFC stats snapshot gets a profile automatically. Volkanovski
   vs Gaethje at 155 is the default matchup, not a hard-coded one.
2. **Data first.** Fighter skills come from round-level UFC stats (data/raw/), with time decay,
   empirical-Bayes shrinkage toward division priors, and opponent adjustment. Judgment calls stay
   labeled knobs layered on top.
3. **Calibrated and tested out of sample.** Global scales are tuned on a walk-forward backtest
   (profiles frozen before each fight) and reported on later fights the tuning never saw, against an
   Elo baseline. The page shows the honest numbers.
4. **Traceable.** One simulated fight produces an event stream that the director turns into the 3D show.
5. **Fast.** 20,000 five-round fights in a browser Web Worker in a few seconds.

## Files

| File | Role |
|---|---|
| data/raw/*.csv | UFC stats snapshot (Greco1899/scrape_ufc_stats, from ufcstats.com), through Oct 31, 2026 |
| tools/build_db.py | Parses the CSVs. Writes data/derived/fighters.json (roster for the page), data/derived/backtest.json (walk-forward snapshots), data/derived/priors.json, Elo ratings |
| src/params3.js | Calibrated global parameters (UMD: `module.exports` in Node, `self.FightParams` in the browser). Rewritten by tools/calibrate.js |
| src/engine3.js | The engine (UMD: `module.exports` / `self.FightEngine`). No DOM. Reads `FightParams` |
| tools/calibrate.js | Walk-forward backtest and parameter tuning. Writes src/params3.js and data/derived/calibration.json |
| tests/test_engine3.js | Unit and sanity tests, base-rate checks, Volk vs Gaethje presets |
| data/scenarios.json | Matchup-specific scenario presets (knob sets with notes and sources) |
| data/overrides.json | Hand-entered tweaks: appearance for the 3D rigs, nicknames, manual fighters not in the data |

In the built page the engine script tag (`id="engine-src"`) holds params3.js followed by engine3.js, so
the tally Web Worker can be built from that one script's text. The roster is inlined as JSON in
`<script type="application/json" id="fighters-db">`.

## Profile format (data/derived/fighters.json)

```jsonc
{
  "meta": { "source": "...", "snapshot": "2026-10-31", "built": "...", "half_life_days": 730,
            "keys": ["min", "d_att", ...] },          // order of the sums arrays below
  "priors": { "Lightweight": { "lbs": 155, ...rates }, "Featherweight": {...}, "ALL": {...} },
  "fighters": {
    "alexander-volkanovski": {
      "name": "Alexander Volkanovski", "nick": "The Great", "dob": "1988-09-29",
      "height_in": 66, "reach_in": 71, "stance": "Orthodox",
      "division": "Featherweight",                      // most frequent division over the last 3 years
      "divisions": { "Featherweight": 14, "Lightweight": 2 },
      "record": { "w": 16, "l": 4, "d": 0, "nc": 0, "ko_w": 4, "sub_w": 1, "dec_w": 11, "ko_l": 3, "sub_l": 0, "dec_l": 1 },
      "last_fight": "2026-10-24", "n_fights": 20, "n_5rd": 12,
      "ko_losses": 3, "kd_absorbed": 4,                 // career, for chin aging
      "elo": 1880,
      "S": [ ...decayed sums in meta.keys order ],
      "C": [ ...career (undecayed) sums in meta.keys order ],
      "pace": [1.00, 1.02, 0.99, 1.05, 1.12], "pace_w": [12, 12, 10, 9, 9],   // landed/min by round vs round 1, with weights
      "recent": [ { "date": "2026-10-24", "opp": "Movsar Evloev", "res": "W", "method": "KO/TKO", "rd": 2, "time": "4:54", "wc": "Featherweight" } ]
    }
  }
}
```

**Sum keys** (X = this fighter, o* = what opponents did to X), all summed over UFC fights, each fight
weighted by `0.5 ^ (days_before_snapshot / half_life)` in `S` and by 1 in `C`:

- `min` minutes fought; `n` fights; `rds` rounds started
- strikes thrown by X: `d_att d_lnd c_att c_lnd g_att g_lnd` (distance, clinch, ground), `h_att h_lnd b_att b_lnd l_att l_lnd` (head, body, leg), `t_att t_lnd` (total strikes incl. non-significant)
- the same absorbed by X: `od_att od_lnd oc_att oc_lnd og_att og_lnd oh_att oh_lnd ob_att ob_lnd ol_att ol_lnd ot_att ot_lnd`
- `kd okd` knockdowns scored / absorbed
- `td_att td_lnd otd_att otd_lnd` takedowns attempted / landed, by X and against X
- `ctrl octrl` control seconds (ufcstats control time counts clinch control as well as ground control)
- `sub_att osub_att rev orev` submission attempts and reversals
- `ko_w ko_l sub_w sub_l dec_w dec_l` results (KO includes doctor and corner stoppages)
- `r5_min r5_lnd_1..r5_lnd_5` minutes and landed in each round of 5-round fights (for the pace curve)

Profiles are only rates once the engine divides by exposure and shrinks toward priors (below), so the
same code handles a current profile and a frozen backtest snapshot.

**Manual fighters** (not in the data, or to override): `data/overrides.json` may give a fighter a
`rates` block in ufcstats career format (`slpm sapm acc def td15 tdAcc tdDef sub15 kd15 head body leg
dist clinch ground mins`); the engine converts it to pseudo-sums.

## Matchup construction: `FightEngine.matchup(profA, profB, opts)`

`opts = { division: "Lightweight", rounds: 5, title: true, date: "2026-11-06", adjA: {...}, adjB: {...}, judges: {...}, params: {...overrides} }`

1. **Shrinkage.** For each rate, `rate = (events + k * prior_rate * exposure_unit) / (exposure + k * exposure_unit)`
   with prior strength `k` from params (in minutes for per-minute rates, attempts for accuracies,
   landed head strikes for KD rates). Priors are the fight division's league rates.
2. **Exposure.** Per-minute strike rates are per minute of the relevant position. Standing minutes are
   estimated as `min - (ctrl + octrl) / 60 * ground_share`; clinch and ground rates are per minute of
   control. These estimates are approximate; global scales absorb the bias in calibration.
3. **Combination.** Rates combine log-linearly (Poisson style): `rate_XY = prior * (r_X / prior) ^ a * (r_Y_against / prior) ^ b`,
   default `a = b = 1`. Probabilities combine by log5 on odds:
   `log5(p_X, q_Y, league) = o(p_X) * o(q_Y) / o(league)`, where `q_Y` is what opponents achieve against Y.
   This replaces v2's average of landed/min and absorbed/min.
4. **Strikes are attempts times accuracy.** Each fighter gets attempt rates per position and accuracy
   per target (head, body, leg), so misses are real engine events.
5. **Power and chin.** KD per landed head strike: `p = p0 * (kd_X / p0)^powExp * (chin_Y / p0)^chinExp` with both
   shrunk (exponents fit by the walk-forward knockdown regression); chin is also aged (`exp(c_age * max(0, age - age0))`), worsened by prior KO losses
   (`(1 + c_ko) ^ ko_losses`, capped), and taxed for size when the fight division is heavier than the
   fighter's home division (`exp(c_size * (lbs_fight - lbs_home) / 10)`; the same term boosts the bigger
   man's power). All coefficients come from data fits in tools/ (see calibration) with defaults in params.
6. **Cardio.** Per-fighter late-round output ratio from `pace` (shrunk toward the division curve).
7. **Grappling.** Takedown attempts per standing minute (clinch multiplier), success by log5 of
   `td_lnd/td_att` vs opponents' success against Y; top-control duration from control seconds per
   takedown landed (top skill) vs control conceded per takedown absorbed (bottom escape); submission
   attempt rate per top minute and conversion `sub_w / sub_att` vs defense `sub_l / osub_att`, shrunk.
8. **Knobs.** `adjA` / `adjB` multiply: `out` (strike attempts), `acc` (accuracy, on odds), `pow`
   (knockdown power), `chin` (KD susceptibility, >1 = easier to drop), `cardio` (drain, >1 = tires
   faster), `tdAtt`, `tdDef`, `leg` (leg-kick share override 0..1), `sub`. `judges.power` sets the
   judges' extra credit for heavy shots. Every knob defaults to neutral (1, or null for overrides).

## Simulation: `FightEngine.simulate(m, rng, trace)`

Continuous-time event simulation per round, with competing exponential clocks recomputed after each
event (rates depend on state, stamina, damage, mobility, hurt status, round pace).

**States.** `0` distance, `1` clinch (with a controller who pins the other on the fence), `2` A on top,
`3` B on top. Ground sub-positions while on top: `guard`, `half`, `side`, `mount`, `back`; the top man
passes or takes the back at a rate set by his grappling vs the bottom man's; the bottom man sweeps,
reverses or stands up. Position modifies ground-strike rate, damage, submission rate and finish risk.

**Per-fighter state.** head damage, leg damage, body damage, stamina (0..1), hurt timer, knockdowns
absorbed, fight-night form draws (output, accuracy, power, chin, cardio, grappling; lognormal or
logit-normal with calibrated sds).

**Events.**
- Strike attempt by X at the current position, target drawn from X's target mix (state-specific mixes in
  clinch and on the ground), landed with the matchup accuracy times modifiers (hurt defender, defender's
  stamina, leg damage).
- A landed head strike adds damage scaled by X's power draw; knockdown with probability `p` above times
  modifiers (accumulated damage, hurt, stamina, position). A big shot that doesn't drop him can hurt him
  (hurt timer: output down, defense down). A knockdown starts a follow-up: the attacker pounces (or
  waves him up), ground strikes with a referee-stoppage hazard, until the downed man recovers to guard or
  his feet. Conversion is calibrated to the data's KD-to-finish rate.
- Standing TKO without a knockdown: a stoppage hazard per landed head strike while the defender is hurt
  and accumulated damage is high.
- Body strikes drain stamina. Leg strikes add leg damage: less mobility, less output and power, more
  exposure to strikes; rare leg-kick TKO.
- Clinch entry and exit; takedown attempts (distance and clinch; success sends the shooter on top in
  guard or half); stand-ups and sweeps; passes; submission attempts by position (and guillotines on
  failed shots), with success by the conversion log5 above.
- Ground-and-pound TKO hazard per landed ground head strike, by sub-position.
- Between rounds: stamina recovers partly; corner and doctor stoppage hazards from accumulated damage
  (doctor: cut proxy from head damage).

**Pace.** Output follows the division pace curve by round times the fighter's cardio ratio times stamina.

**Judging.** Each round, each fighter's impact score is a weighted sum of what he did, with weights from
the logistic round-winner fit on the data (head, body, leg landed, knockdowns, takedowns, control
seconds, submission attempts, ground strikes) plus `judges.power` weighting by landed power. The
difference is in logit units. Each of three judges gets a fight-level taste (power vs volume vs
grappling) and adds shared and individual noise, calibrated so unanimous/split/majority decision and
10-8 frequencies match the data. 10-8 needs a big damage margin (knockdowns or near-finish), per the
ABC criteria.

## Output

`simulate` returns:

```js
{ winner: "A" | "B" | "D", method: "KO" | "TKO" | "GNP" | "LEG" | "SUB" | "CORNER" | "DOC" | "UD" | "SD" | "MD" | "DRAW",
  detail: "Punch to Head At Distance",   // ufcstats-style finish detail or decision summary
  round: 1..5, t: seconds into the round, cards: [[A, B] x 3],
  totals: { A: {...}, B: {...} },         // attempts/landed by target and position, kd, td, tda, ctrl, sub, rev
  form: { A: {...}, B: {...} },
  rounds: trace ? [ { r, ev: [...], st: {A, B}, judges: [[a, b] x 3], fin, stoppage, endState } ] : null }
```

`bucket(f)`: 0..6 = A KO/TKO, A sub, A dec, draw, B dec, B sub, B KO/TKO (KO/TKO includes GNP, LEG,
CORNER, DOC).

`summarize(m, N, seed)` returns `{ n, bins[7], pA, pB, pD, finA[rounds], finB[rounds], dist, distA,
methods{}, avg: { A: {...per-fight stats}, B: {...} }, kd15, ctrl15 }` and is what both the worker and the
tests use.

## Trace events (for the director)

Every event has `t` (seconds into the round), `k` (kind), `w` ("A" or "B", the actor), `s` (state after
the event: 0..3) and, where it applies, `pos` (ground sub-position), `tg` (0 head, 1 body, 2 leg),
`loc` ("dist" | "clinch" | "ground"), and snapshots `dA dB` (head damage), `gA gB` (leg damage),
`sA sB` (stamina).

| k | meaning |
|---|---|
| `miss` | strike attempt that missed |
| `hit` | landed strike |
| `hurt` | landed strike that hurt him without dropping him |
| `kd` | knockdown |
| `fin` | finishing strike (with `how`: KO, TKO, GNP, LEG) |
| `clinch` / `break` | clinch entered (w = initiator) / broken |
| `td` / `tdx` | takedown landed / stuffed |
| `pass` | top man improves position (`pos` = new sub-position) |
| `sweep` | bottom man reverses to top |
| `up` | bottom man (w) stands up |
| `sub` / `subx` | submission finished / defended (with `name`) |
| `recover` | downed man recovers after a knockdown |
| `reset` | referee restarts standing |

v2 kinds keep their meanings, so the director's v2 mapping still applies.

## Calibration and validation (tools/calibrate.js)

- **Backtest set:** every UFC fight from 2019-01-01 to 2026-10-31 where both men had at least one
  earlier UFC fight; each side's profile is the snapshot built only from fights before that date.
- **Split:** tune on 2019-2023; report on 2024-01-01 onward (never tuned on).
- **Metrics:** winner log loss and Brier (draws and no-contests excluded), accuracy, calibration bins;
  7-bin outcome log loss; league base-rate match (method split, finish rate by round, KD per 100 head
  strikes landed, takedown accuracy, control per 15, decision split); per-fight landed-strike error.
- **Baselines:** walk-forward Elo (K and home-free, tuned on the same split), a "more UFC wins" naive
  pick, and the engine-Elo blend.
- **Tuned parameters:** strike-rate scale, KD scale, prior strengths, form sds, KD-to-finish follow-up,
  GNP TKO hazard, submission scales, getup scale, judge noise, age/size/KO-loss chin coefficients.
- **Scheme (v3, tools/calibrate.js):** stage 1 is a dampened fixed point on train data targets:
  - volume scales are moment-matched;
  - KO share sets `koAll`, SUB share sets submission conversion, the 5-round finish rate sets `caution5`, and the
    unanimous share sets individual judge noise;
  - per-fight landed-rate and accuracy dispersion vs the engine's spread set `form.out`, `form.pace` and `form.acc`;
  - the round-1 share of finishes sets the power/chin form spread;
  - a Poisson regression of actual on predicted knockdowns sets `powExp`, `chinExp`, the age, KO-loss and size coefficients.

  Stage 2 is coordinate descent with shrinking steps on the remaining levers, accepting a step only beyond 2 Monte
  Carlo sd of the objective. `ctrlScale` (control-target scale) is the get-up scale.
- **Output:** src/params3.js (values) and data/derived/calibration.json (metrics, calibration bins,
  base-rate table) for the page's backtest panel.

## Component: realism_sens (params.components.realism_sens)

Off reproduces the engine without it, bit for bit for the same seed (tests/test_realism_sens.js). Shipped OFF
(verifier, Nov 6): on v4.0.1 final the learned-rate levels (mlTdLevel, mlCtrlLevel, mlSubLevel) already close the
takedown / control / submission-attempt gaps these factors were built for, division KO / KD spreads do not carry
across 2019-2021 vs 2022-2023, and only the 5-round KD factor (fmt["5"].kd ~1.3) holds out of fold. The flag gates the
factors only; `sensitivity` and `rateSd` work either way. Refit (`tools/realism.js fit`) after any change to KO / SUB /
KD / TD levels before turning it on.

- **Realism factors.** `params.realism.div[division]` and `params.realism.fmt[rounds]` multiply the `[selfcal]`
  division factors (`att kd ko sub ctrl td`) inside `matchup()`; they are fit on 2019-2023 walk-forward backtest
  fights by `tools/realism.js fit` (empirical-Bayes shrunk toward 1). Because the learned-rate adapter re-levels its
  targets to the engine's own league expectation, built with the same factors, they reach learned-rate matchups too.
  `m.realism` holds the factors in effect; `FightEngine.realismFactors(p, division, rounds)` returns them.
- **Sensitivity.** `FightEngine.sensitivity(m, opts)` returns tornado data: P(win) and the method shares at -z / +z sd
  of each knob (`out acc pow chin cardio tdAtt tdDef sub` per fighter, judges' power) and of each fighter's key profile
  rates (posterior sds from `FightEngine.rateSd(m, i)`), each variant rebuilt with the matchup's own options and replayed
  on the same per-fight seeds (common random numbers). Items carry `lo`, `hi`, `dPA`, `dPWin` (signed to "good for
  him"), `swing` and the paired Monte Carlo `se`, sorted by swing. Options: `n` (1000), `seed`, `z` (1), `kinds`,
  `sides`, `keys`, `sd` overrides, `onProgress`. Knob sds: `params.realism.knobSd`, else the fight-night form sds.
- **Profile-rate sds.** `rateSd`: sd(log rate) = sqrt(phi / I) with I = the fighter's events + the shrinkage prior's
  pseudo-events; sd(logit p) = sqrt(phi / (n p (1 - p))); phi = `params.realism.disp` (per-fight over-dispersion
  against the out-of-fold learned rates, `tools/realism.js disp`); pow / chin scaled by `powExp` / `chinExp`.
- **v5 merge (step 3).** Re-applied by hand on the v5 tree (the re-issued patch is against v4.0.1 main 1f30636). The shipped
  `div` / `fmt` factors were fit on v4.0.1, so the layer stays off until a refit on the v5 engine. `sensitivity` rebuilds its
  variants through the public `matchup` (so styles_sos applies to them as to `m`) and keeps an officials name list.
- **Matchup objects** carry the two resolved profiles as a non-enumerable `m._src` for the rebuilds.

## Invariants the tests check

- Same seed, same matchup, same result (deterministic RNG; no Math.random in the engine).
- Swapping corners swaps the probabilities (within Monte Carlo error).
- A fighter vs his own clone wins about 50% (within error).
- League-average vs league-average reproduces division base rates within tolerances.
- Knobs move outcomes in the stated direction (more chin knob = more KO losses, and so on).
- `simulate(trace=true)` and `simulate(trace=false)` produce the same fight for the same seed.
- `params.components.<name>` off reproduces the engine without that component (same seed, same fights).

## Engine v4 (Nov 6, 2026)

v4 keeps the v3 contract above (API, trace format, profiles, buckets, summarize) and the file names
(src/engine3.js, src/params3.js; `FightEngine.VERSION` is "4.0.0"). Frozen copies of every measured version live in
versions/v<N>/ (engine3.js, params3.js and, from v4, ml/mlrates.js). Three changes:

1. **Learned stat-line rates inside the engine.** `FightEngine.loadMLRates(json)` loads the mlrates model
   (data/derived/mlrates.json; tools/mlrates.py, research/model_mlrates.md) through src/ml/mlrates.js (`MLRates`,
   resolved as `self.MLRates` in a browser / worker or `require("./ml/mlrates.js")` in Node). When a model is loaded,
   `matchup()` builds the v3 tables (`matchupBase()`) and then re-targets them with `MLRates.applyToMatchup` at the
   engine's own league level: attempts by position and target, accuracy by target and position, KD per landed head
   strike (and the TKO hazards built on it), takedown attempts and success, control (occupancy refit), submissions and
   reversals. Knobs still act on top. Options:
   - `opts.ml === false`: plain base tables (what every v3-style check and the self-calibration use);
   - `opts.ml = { pred: { A, B, base? } }`: precomputed per-side rates in this call's corner order (leak-free backtests:
     data/derived/mlrates_oof.json); `base` (league rates of the shrinkage division) is filled in from the matchup's
     priors when missing;
   - `opts.mlModel` / `opts.ml = { model }`: another model handle; `opts.mlParts`: adapter parts to switch off.
   - params `mlWeight` (blend of learned vs base tables, 1 = learned) and `mlMaxRatio` (cap on any multiplier, 4).
   The matchup carries `mlApplied`, `ml` (targets, ratios) and `mlPred`. No model loaded = base tables (Node default).
   The page loads the production model; the adapter is part of the engine script, so the tally worker built from that
   script's text has it, and the page posts the model JSON to the worker (it also receives each matchup with the
   learned tables already applied).
2. **Train-only priors.** `tools/build_db.py --priors-until DATE` restricts the live league priors to fights before DATE
   (default: every fight, production); `--priors-only --priors-out FILE` writes just that file.
   data/derived/priors_dev.json = fights 2018-01-01..2023-12-31. The `[selfcal]` values (global scales and the per-division
   factors) were re-fit to it: `node tests/test_engine3.js 8000 --fit --write --priors data/derived/priors_dev.json`.
   Backtest shrinkage keeps the walk-forward `priors_asof[year]` (data/derived/mlcal_priors_asof.json).
3. **Judging.** `FightEngine.judgeRound` scores each round. Each judge's z = EM round-winner logit of the
   differentials, using head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min and sub attempt 0.85. These are the earlier 7,495-card EM run over ufcstats cards from 2015 through 2026-10
   (the params comment says 7,550). That window includes the validation years and the vault: v4's judging weights are not
   train-only. The train-only refit on 2015-2023 cards (data/derived/judge_em_train.json) shipped in v4.0.1, which was
   rejected (docs/CHANGELOG.md), and is a v5 item.
   Engine-only terms are added: hurt 0.8 and judges.power x head x power-weighted damage. Then come shared noise and individual noise.
   - The shared noise has a fight-level part, `sharedFight`: one draw per fight that persists across rounds.
   - Fight-level tastes are off (`tasteSd` 0). A judge who dissents twice in a fight does so in either direction equally often.
   - A judge scores 10-8 when |z| > t108 - t108kd x min(2, winner's KD edge).
   tools/judgecal.js fits sharedSd, indSd, sharedFight, t108 and t108kd by maximum likelihood. It uses the 2019-2023 rounds in data/derived/judgerounds_rows.json only (train years).
   - The engine uses the 2021-2023 10-8 threshold, the latest train era.
   - The engine's sharedSd is reduced by the residual variance of its hurt/power terms.
   - The fit and its checks are in data/derived/judgecal.json.
4. **Train-only re-tune.** The mlcal search over 11 global scales (tools/mlcal_spec_engine4.json, learned rates on via
   tools/mlcal_hooks/ml_oof_v4.js, `--no-val`) adopted nothing: no finalist beat the self-calibrated set on both train
   windows. tools/v4_levels.js then matched four levels on 2019-2023 fights with the learned rates on: kdScale, the
   KO conversion group, subConvScale and judge.t108. Targets: knockdowns per landed head strike, KO and submission
   shares, and a 3.6% 10-8 share. Output in data/derived/v4_levels.json.

**Standard evaluation (from v4 on).** `node tools/evalv.js --version v<N>` evaluates versions/v<N>/ on
backtest_dev.json. Fights are symmetric (both corner orders averaged), use common random numbers and walk-forward
priors, and take out-of-fold learned rates when the engine has them.
- TRAIN = 2019-2023, VALIDATION = 2024-2025.
- Metrics: winner log loss, Brier, accuracy, ECE, calibration slope, 7-bin and method log loss, and methodround's
  who x how x when (paired vs model S). Also per-fight stat-line deviance and a base-rate table, all with event-cluster bootstrap CIs.
- The blend test (tools/evalv_blend.py) refits the MoE stacker with the version's engine probabilities.
- Validation numbers are computed once per version (`--split val` refuses a second look) and stored in data/derived/version_history.json.

## Engine v5 component: durability (`params.components.durability`)

Replaces the power and chin block (item 5 above) with the knockdown model of research/model_durability.md
(tools/durability.py, data/derived/durability.json). With the flag false, `matchup()` is the engine before the component
bit for bit (v5 merge step 2: the step-1 engine; tests/test_durability.js, tests/test_v5_step2.js). The hook runs after the base tables and the learned rates (`applyDurability` in
engine3.js) and rewrites `m.kd`, `m.gnp`, `m.stko` and `m.dw`; `simulate()` and the trace format are unchanged.

- Knockdown hazard per landed standing head strike, i on j: `kdCal * kdScale * base_ij * rel_ij`, with
  `base_ij = level * exp(const + division + five * [5 rounds] + title * [title])` (league level tracked by
  `params.durability.level`; backtests pass the walk-forward base of each record) and
  `rel_ij = (C_j * P_i * knobs)^(1 - w) * engRel_ij^w`. `C = chin_cov * chin_re`, `P = pow_cov * pow_re`;
  `chin_cov` prices defender age (+6.4%/yr at every age), knockdowns absorbed and KO/TKO losses (recent 365 days and
  older), `pow_cov` attacker age (-4.0%/yr past 30); `chin_re` / `pow_re` are walk-forward Gamma(3) / Gamma(2.5)
  fighter multipliers. `engRel` is the engine's own knockdown structure relative to its division level (v3 ratios or
  the v4 learned rates); `w = params.durability.engineWeight` (0.5). GNP and standing TKO hazards scale with
  `sqrt(rel_ij)` (mean 1 after NORM), damage per head strike with the blended power ratio.
- Inputs per side: `opts.dur = { A, B, base }` (corner order of the call), `prof.dur`, the roster registered with
  `FightEngine.loadDurability(durability.json)`, else computed from the profile (`age`/`dob`, `ko_losses`,
  `ko_losses_365`, `kd_absorbed`, `kd_absorbed_365`; tools/build_db.py writes the recency fields) with `chin_re` /
  `pow_re` from career sums (`fallbackEB`). The roster is the live fit, so it is applied only to matchups dated on or
  after its snapshot (`meta.snapshot`); a hand-made profile (`manualProfile`) without an age is the reference age, not
  the data's "age unknown" term.
- Backtests and the version evaluation (tools/evalv.js) must pass `opts.dur` from `durability.json` `backtest[id]`
  (strict walk-forward: 2019-2023 entries fit on 2008..Y-1, 2024-2025 entries on 2008-2023; `base` =
  `p_A / (C_B P_A)`, geometric mean of both directions) and the train-only NORM (`norm_*_backtest_2019_2023`).
  Without them the computed fallback uses the live-fit terms (2008..2026-10) and the Oct 2026 level.
- `params.durability.level = null` switches to relative mode (the engine's own division level times context, C x P
  divided by NORM). Size (`sizeChin`, `sizePow`, default 0) and the withdrawn first-version terms (`withdrawn`:
  layoff, last-fight KO, years in the UFC; neutral) stay labeled knobs. `m.dur` carries every input and factor;
  `explain()` prints them.

## Engine v5 component: fight dynamics (`params.components.dynamics`)

Recipe E1-E11 of research/model_dynamics.md (tools/dynamics.py, data/derived/dynamics.json), values in `params.dyn`.
With the flag false the engine is the one before the component bit for bit (v5 merge step 2: step 1 + durability;
tests/test_dynamics.js, tests/test_v5_step2.js). `matchup()` adds `m.dyn` (null when off): per-round tables built by
`dynTables`. `simulate()` then uses them in place of the plain engine's terms; the trace format is unchanged.

- Output: league pace curve by format (`pace3` / `pace5`) x own late-round ratio (prior strength `kPace` 45) x the
  opponent's ratio^`paceMutual` (0.4), x `outLevel`; fight-level form `formPace` / `formOut`, an AR(1) round noise per
  man (`arSd`, `arPhi`, valid range [0, 1)) and an accuracy AR(1) (`accArSd`, `accArPhi`); accuracy profile shifts
  attenuated by `accProfA` / `accProfB`.
- Knockdowns: per landed standing strike `kdRound3` / `kdRound5` x `kdLevel3` / `kdLevel5` by round, replacing the
  damage, stamina, pace and 5-round caution terms (the per-strike hazard `m.kd`, durability's when that flag is on,
  is unchanged). Conversion after a knockdown: odds x `convLevel` x exp(`convRound` (r - 1)). Non-knockdown stoppages:
  `stkoScale` / `gnpScale` x exp(`noKdRound` (r - 1)), damage slopes `stkoBase` / `gnpDmg`; `stkoHurtGate` (default
  false) is a labeled alternative for the standing TKO round shape.
- Between rounds: knockdown momentum for the next round (`momScorer*`, `momDropped*`), grappling carry-over (`tdCtrlOpp`,
  `tdTdl`, `distCtrlOpp`) inside a takedown-attempt round curve (`tdRound3` / `tdRound5`, `tdLevel`); `lostAcc` (E5)
  is a knob, default off.
- Both components scale knockdowns: durability through `durability.kdCal`, dynamics through `dyn.kdLevel3/5`. They are
  one level, set in one joint pass (v5 Calibrate stage); never re-match them separately.


## Component: styles_sos (src/styles_sos.js; flag `params.components.styles_sos`)

Runs once at the end of `FightEngine.matchup()`, after the rate tables are final (base tables, or the learned
stat-line rates of v4), only when the flag is truthy; `false` reproduces the engine without it bit-for-bit
(tests/test_styles_sos.js strips the `[styles_sos]` hook lines and compares tables, traced fights and summaries).
Sub-flags `{ styles, sos, newcomer }`; knobs in `params.stylesSOS`. Records its work on `m.stylesSOS`.

- **styles** (roadmap v7): research/model_styles.md section 9 rate modifiers. Per attacker X vs defender Y,
  `s = sum c_k t_k` from the defender's style z-scores (styles.py `Side.features` on the profile's sums and the
  matchup prior `m.P`), length advantage and open stance. `dist_att`: `m.dRate x e^s`; `td_att`: `m.tdD/tdCC/tdCU x e^s`
  (after the occupancy fit); `ctrl_per_td`: the bottom man's `upPos/swPos / e^s`; `gnp_att`: `m.gPos/gRate x e^s`.
  Coefficient set `styleSet` ("ab1" default, "fit"), knob `styleScale` (or `opts.styleMatchups`, 0..1.5), per-path
  block list `styleBlocks: {ml: [...], base: [...]}`.
- **sos**: one-step walk-forward strength of schedule (tools/sos_wf.py, data/derived/sos_wf.json). Inputs `opts.sos =
  {A, B}` (then only it: a side it lacks is neutral), `prof.sos`, or `StylesSOS.loadSOS(table)` by slug, the table only
  for bouts dated after its `meta.roster_asof` (a backtest that omits `opts.sos` runs neutral, never on later fights):
  per stat `[q, w]` of what his opponents allowed (`a`) and produced (`o`). Backtest harnesses pass
  `opts.sos = sos_wf.fights[id]` with A/B swapped together with the corners. Multiplier `exp(beta_a (bias_a(X) - c_a) + beta_o (bias_o(Y) - c_o))`, `bias = q w / (w + k)`, on
  `m.dRate`, distance `m.accO`, `m.tdD/tdCC/tdCU`, `m.tdO/tdOC`, `m.kd`; coefficients per path (learned rates / base).
  `sosSource: "oppadj"` uses the verified tools/oppadj.py factors instead (`prof.oppadj`; base tables via engine R in
  `fighterRates`, learned rates via `(F_off,X F_def,Y)^beta` on the final tables).
- **newcomer**: accepted and ignored (pre-UFC priors not implemented).
- Defaults: sub-flag `styles` off, `sos` on with source "wf". With `styles` switched on, the style blocks default to none
  on the learned-rate path and all four on the base tables.

## Officials component (roadmap v8; `params.components.officials`)

Off (false): the engine is bit-for-bit the engine without it (tests/test_officials.js checks fights, traces and
summaries against the base engine). On: named judges and the referee, with tendencies fit walk-forward by
tools/officials_engine.py (data/derived/officials_engine.json, loaded with `FightEngine.loadOfficials(json)`; table Y is
fit only on the five years before Y, table 2024 = 2019-2023 is the production table).

- `opts.judges = [name or "m<id>", x3]` (or `{ names, power }`, which keeps the `judges.power` knob), `opts.referee =
  name`, `opts.judgePool = [[key, weight], ...]` (sample the judges from an event's panel), `opts.officials` (a table set
  to use instead of the loaded one, or `false`). Unnamed slots are drawn from the table's recent pool; names missing
  from the table get effects drawn from the population sds.
- Judging per round (A - B differentials): `eta_j = exp(n_j) (exp(v_j) V + exp(k_j) K + exp(g_j) G + u) + e_j`, with
  `V` landed head/body/leg, `K` knockdowns plus the engine-only hurt and power terms, `G` takedowns, control,
  submission attempts and reversals; `u` shared by the panel (a fight-level part and a round part), `e_j` Logistic(0, 1).
  10-8 for the winner W: `sigmoid(c0 + c_j + thV V_W + thK K_W + thG G_W + eps)`, `eps` shared; 10-10 at a small rate.
- Referee: multipliers on the follow-up stoppage odds after a knockdown, the standing-TKO hazard and the
  ground-and-pound TKO hazard.
- RNG: the main stream keeps the v4 draw count (the nine start-of-fight taste normals, the fight-level judge normal,
  1 + 3 normals per judged round), so flag-on and flag-off fights with one seed share the fight path until officials
  change an outcome; judge picks and 10-8 / 10-10 draws use a second stream seeded from the start-of-fight normals.
- Output: each fight carries `officials: { judges: [names], referee, refMult }` when the flag is on. Trace format unchanged.
- v5 (merge step 3): `components.officials` is false in params3.js, so the prediction path keeps the v4 judging
  (with the `components.v401` judging fixes). Opt-in per call to show real officials: `opts.params = { components: {
  officials: true } }` with `opts.judges` / `opts.referee`. Named-judge effects are off (`params.officials.perJudge:
  false`, docs/BACKLOG.md OFFICIALS): every judge scores as the league judge, and the names are still drawn and recorded.

## Engine v5 merge step 4: the learned stat-line path and newcomer priors (`components.embed`, `.oppadj`, `.preufc`)

All three act only with their inputs, so the page path without rosters is unchanged; each flag off reproduces the engine before
it bit for bit (tests/test_v5_step4.js). Backtest tools get leak-free inputs from tools/mlpathrec.js.

- **embed** (on; `embedTargets`, research/model_embed.md "Integration recipe"). Before the adapter (src/ml/mlrates.js
  `applyToMatchup`) re-targets the tables, each learned target t of side X (attacking Y) becomes
  `link(rate_t) = b0 + b1 link(mlrates rate_t) + b2 eta[task(t)]` (log links for per-minute rates, ctrl on minutes per minute
  and kd_h, capped at 0.5; logit for accuracies). `eta` = the embedding model's task predictors for X against Y
  (`params.embed.tasks` order); `params.embed.recipe` = embed_model.json `mlrates_blend.targets` (fit on mlrates' 2019-2023
  out-of-fold rows; b2 = 0 for rev, acc_g, td_acc, kd_h). The arithmetic equals src/ml/embed.js `blendMLRates`.
  Inputs: `opts.embed = { etaA, etaB, recipe? }` (corner order of the call), else the roster registered with
  `FightEngine.loadEmbed(embed_model.json)` by slug (zero vector = division average) for bouts dated on or after its as-of date
  (2026-01-01). The matchup carries `m.embed = { src, recipe, raw: {A, B} }` and `m.mlPred` holds the blended targets.
- **oppadj** (off; `oppadjTargets`, research/model_oppadj.md item 3). After the blend: counts d_att, c_att, g_att, td_att, ctrl
  x `(F_off,X F_def,Y)^beta`, h/b/l attempts scaled with the total attempt change, accuracies acc_h, acc_l and td_acc on odds;
  `params.oppadj.beta` = oppadj.json `ml_path_beta` (kd, body accuracy, submissions 0). Factors: `opts.oppadj = { A, B }`, else
  `prof.oppadj`. matchupBase refuses `components.oppadj` together with `components.styles_sos` sos (any source): never stack the
  two schedule adjustments. topSkill / escWeak are not applied (untested combination in the reference).
- **preufc** (on; `applyPreUFC`, research/model_preufc.md item 3), after durability. For a side with at most `maxUfc` (3) prior
  UFC fights, from his non-UFC pro record entering the bout: KO rate (ko_w + 0.3) / (n + 2), sub rate (sub_w + 0.2) / (n + 2),
  KO-loss rate (ko_l + 0.2) / (n + 2); odds multipliers M_pow = (KO rate / 0.3433)^0.601, M_sub = (sub rate / 0.2466)^0.627,
  M_chin = (KO-loss rate / 0.0436)^0.244, each faded by exp(-n_UFC / 8). Hazards: X's kd, gnp and stko x M_pow,X^s_pow x
  M_chin,Y^s_chin; X's submission attempt tables (subTPos, subBPos, gillo) x M_sub,X^s_sub. `params.preufc.scale` (pow 1.007,
  sub 1.314, chin 0.991; tools/preufc_scale.js on league-average pairs) makes the simulated per-fight finish odds move by M.
  Inputs: `opts.preufc = { A, B }` with `{ n, ko_w, sub_w, ko_l, n_ufc }` (null = none), else `prof.preufc`, else the roster of
  `FightEngine.loadPreUFC(preufc.json)` (current non-UFC record + UFC count) for bouts dated on or after its ufcstats snapshot.
  Refused together with styles_sos `newcomer` (the older stub). The matchup carries `m.preufc = { src, mult, hazard }`.
- New exports: `loadEmbed`, `embedBlend`, `oppadjSide`, `loadPreUFC`, `preufcMult`. Trace format and API otherwise unchanged.

## Engine v5 merge step 5: the prediction package (`components.blend_anchor`, FightEngine.predict)

`FightEngine.predict(profA, profB, opts)` (marked block at the end of src/engine3.js; src/ml/blend.js `FightBlend`) returns the
final package. It never touches matchup / simulate / summarize / explain; with the flag off it returns
`summarize(FightEngine.matchup(profA, profB, opts), sims, seed)`'s own numbers (tests/test_v5_step5.js, tests/test_blend_anchor.js).

- **Winner (the ML v2 package).** A stacker in src/ml/moe.js's format over the experts engine (this simulator, both corner
  orders), feat_lr (moe_page.json `feat`), elo, ml + elo_sig (ml.json page model), mkt_rating (market.json ratings) and market
  (the line); any expert can be passed in `opts.experts`. The production stacker is data/derived/blindtest_stack.json, and
  `opts.lineKind` picks its block explicitly: `'close'` = the close-trained `model` (line de-vigged by the power method),
  `'open'` = the open-trained `model_open` (proportional de-vig), `'none'` = the shared no-line block (temperature 1.161 of its
  own). A line without `lineKind` is refused, and so is `'open'` with a stacker that has no `model_open`. ML v2's page logistic
  and page stacks (src/ml/ml2.js, ml2.json page_model) are reported as `ml2` (the lineKind-matched stack in `ml2.p`);
  `opts.winner = 'ml2'` makes that stack the headline. Then `sigm(recalT logit p)` with recalT 1.
- **Method x round.** The simulator's cells (Jeffreys-smoothed) rescaled to P(win) (draw share and within-winner mix kept),
  pooled linearly with the method/round model rescaled the same way: `w rescale(sim) + (1 - w) rescale(S)`, w = 0.15; SM
  (S + the line) only with a closing line.
- **Anchor mode** (`opts.anchor`): skill offset s split +-s/2 on accuracy odds (x0.5), takedown success (x1) and knockdown power
  (x1, mean-preserving), solved so the simulator's own P(A) matches the package; `anchor.adjA / adjB` reproduce it for a traced
  fight. **Interval:** profile-noise bootstrap through the feature LR, inflated by kappa 1.65.
- **Corner order.** Seeds and the interval's draws follow a canonical fighter order, and the B-A run swaps every side-specific
  input (adjA/adjB, ml, dur, sos, embed etaA/etaB, oppadj, preufc), so predict(B, A) is the exact mirror of predict(A, B).
- **Backtests** (`opts.backtest = true`): the loaded production stacker, the loaded S model and the live rosters are refused.
  The caller passes a stacker fit on 2023 or earlier with its fit_through (`opts.stack`; data/derived/blindtest_stack_pre2024.json
  from `tools/blindtest.py export --fit-through 2023-12-31`), walk-forward cells (`opts.mrCells`, or false) and walk-forward
  experts; a train-window fight inside the stacker's fit needs `opts.inSample = true`; 2026 dates are refused.
  tools/predictrec.js builds these inputs per backtest fight and corner order.
- New exports: `predict`, `loadBlend({ stack, feat, mlPage, market, ml2, methodRound, data })`.

## Engine v5 Calibrate B: the joint level pass (`components.calB`) and the 5.0.0 freeze

- `params.calB.set` holds the levels of the ONE joint knockdown / finish / stoppage / judging pass (tools/v5_calB_levels.js,
  train 2019-2023 only; research/v5_calB.md): `dyn.kdLevel3` 0.6772, `dyn.kdLevel5` 0.5656, `dyn.convLevel` 1.0966,
  `dyn.stkoScale` 0.6587, `dyn.gnpScale` 0.4322, `judge.t108` 8.176. The usual fields keep the values before the pass.
- resolveParams puts the set in when `components.calB` is on (default), BEFORE the v401 put-backs and the opts.params
  overrides: a v401 sub-flag that is off still restores v4.0.0's value of a field it owns (emJudge off -> t108 8.555), and an
  explicit override always wins. `components.calB: false` reproduces the Calibrate A engine bit for bit (tests/test_v5_calB.js);
  `components: false` leaves the set out.
- Targets: KD per 15 minutes and per 100 head landed by format (one knockdown scale per format; durability.kdCal held), same-round
  strike finish per knockdown 0.512, the KO/TKO share, and the card-implied 10-8 share of 2021-2023 decisions. Checks: KD per
  100 standing head by round, finish share by round (3 and 5 rounds), KO / SUB / DEC, decision split, draws.
- The prediction package was rebuilt on this engine: `blend.mrWeight` 0.3, `blend.anchor.slope0` 0.771, `blend.boot.inflate`
  2.15 (tools/blend_anchor_bt.js + blend_anchor_eval.js, 2019-2023 only).
- Engine VERSION 5.0.0, params "5.0.0-selfcal-pre2024", frozen in versions/v5/ (engine3.js, params3.js, styles_sos.js,
  mlpathrec.js, ml/mlrates.js, ml/embed.js, ml/blend.js, ml/moe.js, ml/ml2.js, ml/mlpage.js). The API and trace format are
  unchanged.

## Engine v5.0.1 (Nov 7, 2026; validated once and rejected; versions/v5.0.1-rejected/)

v5.0.1 = 5.0.0 + the v5 review's fixes (docs/CHANGELOG.md v5.0.1, research/v501_fixes.md). The API and the trace format are
unchanged (a round's `ded` key and the fight's `nDed` appear only with a point deduction, as before).

**Input contract (no flag; bit-identical to 5.0.0 for valid inputs on the 2019-2023 backtest):**
- `matchup()` checks every rate table simulate() reads (dRate, cRate, gRate, gBot, the takedown, sub-position, knockdown, damage,
  stoppage, drain, accuracy and mixture tables, pace / finR / kdPace, the dynamics tables) after durability, pre-UFC and the
  styles_sos hook: each value must be a finite number >= 0, else it throws `matchup table <name>[i] = <value>`. `judgePower` must
  be finite.
- `simulate()` throws if the total event rate is not in [0, Infinity) and caps a round at 200,000 events (a backstop; real rounds
  have a few hundred).
- Durability records: a field counts only when it is a finite positive number; `m.dur.A.src` / `B.src` is "record" (all four
  fields from the record), "partial" or "computed". Backtest harnesses (tools/evalv.js, predict_eval.js, durrec.js) refuse
  anything but complete records ("record" on both sides).
- Pre-UFC records with a count that is not a finite number >= 0, and multipliers that are not finite and positive, are missing.
  A non-finite embedding predictor (or target) leaves that target unblended.
- Judges: `opts.judges.power` falls back to `params.judge.power` unless it is a finite number; judgeRound / officialsRound throw
  on a non-finite score (a NaN used to score the round for corner B).
- Dates: `opts.date` is normalised once to "YYYY-MM-DD" (ISO strings with or without a time part, "YYYY/MM/DD", Date objects and
  millisecond timestamps; anything else throws) and that canonical value drives every leak guard (durability, embedding and
  pre-UFC rosters, styles_sos through `m.opts`, officials tables). A string-compared US date once let 2026 rosters into 2019 bouts.
- Rounds: an integer 1..5 (strings are coerced); the title default (5, else 3) applies only when `opts.rounds` is absent.
- Params: in Node the engine requires its sibling params3.js and ml/mlrates.js before looking at the global object, and refuses
  params whose major version differs from VERSION (`params.allowVersionMismatch` overrides). evalv.js also checks every worker's
  engine / params version.
- src/ml/blend.js 1.1.1: a market line counts only when the odds are finite with |odds| >= 100 and de-vig to a probability in
  (0, 1); otherwise `lineKind` 'close' / 'open' refuses with "needs a line".

**`components.v501`** (true / false / an object of sub-flags, each on unless false; `params.v501.set[sub]` holds the new values and
goes in after the calB set, before the v401 put-backs and opts.params overrides; off = 5.0.0, tests/test_v501.js):
- `durFallback`: the computed chin / power fallback (profiles without a durability record) multiplied by normComputedChin / Pow
  (career sums, production profiles: 1.1786 / 1.0125, fit on the live roster) or normComputedChinS / PowS (decayed sums, backtest
  snapshots: 0.9566 / 1.0043, fit on 2019-2023 sides), so its chin x power matches the record path within 2% (tools/durlevel_fit.js,
  tests/test_durlevel.js). Page / newcomers only.
- `dynNoise`: dyn.formOut 0.15, arSd 0.24, arPhi 0.6, formPace 0.42, roundPace 0.15, formAcc 0.40 (5.0.0: 0.21, 0.32, 0.85, 0.45,
  0.10, 0.43), chosen by realism distance to the real 2019-2023 fights (tools/v501_dynfit.js).
- `levels`: dyn.outLevel 1.0201, kdLevel3 0.67504, kdLevel5 0.56512, convLevel 1.10682, stkoScale 0.66495, gnpScale 0.4363,
  judge.t108 7.72547 (the joint level pass redone on top of dynNoise; tools/v5_calB_levels.js, data/derived/v501_levels.json).
- `kdBase`: no set. A pre-registered forward-chained check inside 2019-2023 kept the durability records' trailing 730-day league
  level (tools/v501_kdlevel_cv.js, data/derived/v501_kdlevel_cv.json).

**Evaluation contract from v5.0.1 on** (tools/evalv.js, tools/evalv_decide.js): per-minute stat-line deviance conditioned on the
real fight length; base rates by year (train gate) and by dated window (validation, information only); per-fight outputs at 6
decimals with simulated stats; the decision rule's branch 2 counts a secondary metric only after a Holm adjustment over the seven
registered metrics, and a base rate drifts out of tolerance only when |new - actual| - |old - actual| has an event-cluster CI
above 0 and |new - actual| exceeds max(registered tolerance, 1.96 SE of the actual). tests/test_page_parity.js checks that the
page's ENGINE bundle runs the same model as Node and that every component the page's params switch on is shipped.

