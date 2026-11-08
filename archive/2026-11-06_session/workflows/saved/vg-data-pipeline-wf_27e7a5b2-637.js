export const meta = {
  name: 'vg-data-pipeline',
  description: 'Build tools/build_db.py: fighter profiles, walk-forward backtest snapshots, division priors and Elo from the UFC stats snapshot; then verify',
  phases: [
    { title: 'Build', detail: 'one builder writes the pipeline and outputs' },
    { title: 'Verify', detail: 'independent recomputation and leakage audit' },
  ],
}
const ROOT = '/home/user/XX'
const CTX = `Context: today is Nov 6, 2026. Project: ${ROOT}, a Monte Carlo MMA fight simulator being rebuilt as v3 (general, data-driven, any two UFC fighters; default matchup Volkanovski vs Gaethje at 155 lb, 5 rounds). READ ${ROOT}/docs/ENGINE_V3_SPEC.md FIRST: it is the contract, especially "Profile format", the sum keys, and "Calibration and validation". The UFC stats snapshot is in ${ROOT}/data/raw/ (ufc_event_details.csv EVENT,URL,DATE,LOCATION; ufc_fight_results.csv EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL; ufc_fight_stats.csv EVENT,BOUT,ROUND,FIGHTER,KD,SIG.STR.,SIG.STR. %,TOTAL STR.,TD,TD %,SUB.ATT,REV.,CTRL,HEAD,BODY,LEG,DISTANCE,CLINCH,GROUND with "x of y" strings and CTRL "m:ss"; ufc_fight_details.csv EVENT,BOUT,URL; ufc_fighter_details.csv FIRST,LAST,NICKNAME,URL; ufc_fighter_tott.csv FIGHTER,HEIGHT,WEIGHT,REACH,STANCE,DOB,URL). Many string fields carry trailing spaces: strip everything. OUTCOME "W/L" maps to the two names in BOUT ("A vs. B") in order; "D/D" draw; "NC/NC" no contest. ufcstats CTRL counts clinch control as well as ground control. Nine names in tott belong to two different people (e.g. Bruno Silva, Jean Silva, Mike Davis): handle them explicitly (disambiguate by weight class/era if you can, otherwise exclude those names from the roster and backtest and list them in meta). Python 3.13 with pandas and numpy is available (no scipy). Do not touch ${ROOT}/src, ${ROOT}/tests, ${ROOT}/legacy, ${ROOT}/research or files under ${ROOT}/tools other than the ones named here. No git commits.`

const BUILD = `${CTX}

TASK: write ${ROOT}/tools/build_db.py (run as: python3 tools/build_db.py from ${ROOT}; finishes in under ~3 minutes) that produces:

1. ${ROOT}/data/derived/fighters.json exactly in the spec's profile format: meta (source, snapshot date = last event date, built timestamp, half_life_days = 730 default via --half-life, keys = the ordered list of sum keys, ambiguous_names), priors (per division, plus "ALL"), fighters keyed by slug (lowercase, hyphenated, ascii). Include every sum key from the spec, in both S (decayed to the snapshot date) and C (career). Roster = fighters with at least one UFC fight on or after 2021-01-01 (keep everyone else out of this file to keep it small). Fields per fighter: name, nick (from fighter_details), dob (ISO), height_in, reach_in (null if "--"), stance, division (most frequent division over his last 3 years of fights, else career), divisions counts, record (w,l,d,nc,ko_w,sub_w,dec_w,ko_l,sub_l,dec_l; KO includes doctor stoppage and corner stoppage; DQ counts as w/l with its own method, Overturned counts as NC), last_fight, n_fights, n_5rd, ko_losses (career KO/TKO losses), kd_absorbed (career), elo (current, see 4), pace and pace_w (sig strikes landed per minute by round number in his 5-round fights, relative to his round-1 rate, with the minutes in each round as weights; if he has no 5-round fights, use his 3-round fights for rounds 1-3 and null for 4-5), recent (last 6 fights: date, opp, res W/L/D/NC, method short text, rd, time, wc, title true/false). Write it compactly (no indentation; round floats to 3-4 significant digits) so the file stays small; print its size.

2. ${ROOT}/data/derived/priors.json: division-level league rates computed from fights on or after 2018-01-01 for each division (Flyweight, Bantamweight, Featherweight, Lightweight, Welterweight, Middleweight, Light Heavyweight, Heavyweight, Women's Strawweight, Women's Flyweight, Women's Bantamweight, Women's Featherweight, Catch Weight, Open Weight) and ALL: the same sum keys aggregated per fighter-minute (i.e. the average fighter's sums per minute, accuracies as landed/attempted ratios, kd per head landed, td success, ctrl per td landed, sub conversion, finish method split by round, pace curves for 3- and 5-round fights, minutes per fight, and "lbs" for the weight limit: 125/135/145/155/170/185/205/265/115/125/135/145). The same priors object goes inside fighters.json.

3. ${ROOT}/data/derived/backtest.json: walk-forward snapshots. Process all fights chronologically; before applying a fight, snapshot both fighters' decayed sums AS OF THAT FIGHT DATE (decay relative to that date, built only from earlier fights — no leakage of the fight itself or later fights), plus age in years at the fight, n prior UFC fights, prior ko_losses and kd_absorbed, prior pace, home division at that time, height/reach/stance, pre-fight Elo. Emit entries for fights dated 2019-01-01 or later where both fighters have >= 1 prior UFC fight and neither name is ambiguous. Entry: { id (ufcstats fight id from URL), date, event, division, rounds (scheduled), title, A: {slug, name, age, n, ko_losses, kd_absorbed, elo, home, height_in, reach_in, stance, pace, S:[...] }, B: {...}, result: { winner "A"|"B"|"D"|"NC", method (normalized: KO, SUB, UD, SD, MD, DRAW, DQ, NC, DOC (doctor stoppage), CNC), round, time_s, detail }, actual: { A: {sig_lnd, sig_att, kd, td_lnd, td_att, ctrl, sub_att, h_lnd, b_lnd, l_lnd}, B: {...}, minutes } }. A = first name in BOUT. Write compactly; print count and size.

4. Elo: walk-forward Elo over all UFC fights since 1994 (initial 1500; K grid over e.g. 24..64 and an optional K boost for a fighter's first 5 UFC fights; choose by log loss on 2019-2023 decisive fights; report 2024+ log loss/Brier/accuracy of the chosen Elo). Store pre-fight Elo in backtest entries, current Elo in fighters.json, and write ${ROOT}/data/derived/elo_report.json with the chosen K, the grid results and the 2024+ metrics.

5. ${ROOT}/data/overrides.json if it does not exist: { "fighters": { "alexander-volkanovski": { "appearance": {...} }, "justin-gaethje": { "appearance": {...} } }, "manual": {} } with neutral placeholder appearance fields (skin, hair, beard, shorts, trim, glove) copied from the v2 SPECS in ${ROOT}/src/show3d.js (search for "SPECS").

Parsing notes: fight seconds = (ROUND-1)*round_len + TIME for finished fights (round_len from TIME FORMAT, usually 5 min; handle "3 Rnd + OT (5-5-5-5)", "1 Rnd + OT (12-3)", "No Time Limit" etc. reasonably or skip pre-2001 formats); per-round minutes for the round-level stats rows = 5 except the last round of a finished fight = TIME. Division from WEIGHTCLASS: strip "UFC", "Interim", "Title", "Bout", "Tournament", ordinal season words like "Ultimate Fighter ... " etc.; title = "Title" in WEIGHTCLASS. Exclude rounds with missing stats gracefully. Print a summary at the end: number of fights parsed, roster size, backtest entries, Volkanovski's and Gaethje's career sig strikes landed per minute and absorbed per minute, takedown accuracy and defense, KD for/against (these should be close to ufcstats career numbers: Volkanovski about 6.0 landed / 3.3 absorbed per min; Gaethje about 6.3 / 6.8 — investigate if far off).

Also write ${ROOT}/tools/README.md documenting the pipeline, outputs and how to add or override a fighter. Run the script, fix all errors, and return a report.`

const VERIFY = `${CTX}

You are an adversarial reviewer of ${ROOT}/tools/build_db.py and its outputs in ${ROOT}/data/derived/ (fighters.json, priors.json, backtest.json, elo_report.json). Assume there are bugs until you've checked. With FRESH code of your own (not importing build_db.py):
1. Recompute Volkanovski's and Gaethje's career C sums for at least 10 keys (min, d_lnd, h_lnd, oh_lnd, kd, okd, td_att, td_lnd, ctrl, sub_att) and compare with fighters.json.
2. Leakage audit: pick 5 backtest entries (include Volkanovski vs Evloev 2026-10-24 and Gaethje vs Topuria 2026-06-14 if present) and verify each side's snapshot excludes that fight and all later fights (e.g. recompute n and min from earlier fights only, and check the decay is relative to the fight date).
3. Check OUTCOME/BOUT order handling on draws, NCs and overturned results; check that the ambiguous-name handling does not silently merge two people; check division parsing on title bouts, interim titles, women's divisions and catch weights; check fight-minute computation on finished fights and on overtime formats.
4. Check the priors look sane (e.g. lightweight sig strikes landed per minute per fighter ~3.5-4.5, head accuracy ~35-45%, leg accuracy ~70%+, td accuracy ~35-40%, KD per 100 head landed ~1-2) and that the Elo grid search used only 2019-2023 for selection.
5. Check JSON validity, sizes, and that fighters.json follows docs/ENGINE_V3_SPEC.md (keys order in meta.keys matches the arrays).
Fix every bug you find directly in tools/build_db.py, rerun it, and re-check. Return a report of what you checked, what was wrong, and what you fixed.`

const REPORT = { type: 'object', properties: {
  status: { type: 'string' },
  outputs: { type: 'array', items: { type: 'object', properties: { file: { type: 'string' }, size_bytes: { type: 'number' }, note: { type: 'string' } }, required: ['file', 'note'] } },
  key_numbers: { type: 'string', description: 'roster size, backtest entries, Volk/Gaethje headline rates, Elo K and 2024+ metrics, priors highlights' },
  issues: { type: 'array', items: { type: 'string' } },
}, required: ['status', 'outputs', 'key_numbers', 'issues'] }

phase('Build')
const built = await agent(BUILD, { label: 'build:pipeline', phase: 'Build', schema: REPORT })
phase('Verify')
const verified = await agent(VERIFY + `\n\nThe builder reported:\n${JSON.stringify(built, null, 1)}`, { label: 'verify:pipeline', phase: 'Verify', schema: REPORT })
return { built, verified }
