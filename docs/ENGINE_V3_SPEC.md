# Fight engine v3: specification

Status: design contract for the v3 rebuild (Nov 6, 2026). The data pipeline, the engine, the calibration
harness, the director, the 3D show and the page all build against this file. When code and this file
disagree, fix one of them in the same change.

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

## Invariants the tests check

- Same seed, same matchup, same result (deterministic RNG; no Math.random in the engine).
- Swapping corners swaps the probabilities (within Monte Carlo error).
- A fighter vs his own clone wins about 50% (within error).
- League-average vs league-average reproduces division base rates within tolerances.
- Knobs move outcomes in the stated direction (more chin knob = more KO losses, and so on).
- `simulate(trace=true)` and `simulate(trace=false)` produce the same fight for the same seed.

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
   differentials, using head 0.179, body 0.133, leg 0.105, KD 2.42, TD 0.286, control 0.46/min and sub attempt 0.85 (all 7,550 ufcstats cards).
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
