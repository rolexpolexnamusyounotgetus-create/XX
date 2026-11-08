export const meta = {
  name: 'vg-research-sweep',
  description: 'Research Volkanovski/Gaethje, fight-sim modeling, UFC base rates, audit v2, and scout 3D assets; adversarially fact-check each dossier',
  phases: [
    { title: 'Research', detail: '8 parallel researchers write dossiers into research/' },
    { title: 'Verify', detail: 'one skeptic per dossier re-checks key claims and fixes the file' },
  ],
}

const ROOT = '/home/user/XX'
const SCRATCH = '/tmp/claude-0/-home-user-XX/4b441402-ee46-53a7-b3cc-cf59c11a22cb/scratchpad'
const PRE = `Context: today is Friday, November 6, 2026. You are helping rebuild a Monte Carlo MMA fight simulator for a hypothetical Alexander Volkanovski vs Justin Gaethje fight at lightweight (155 lb, 5 x 5-minute rounds). The project lives in ${ROOT} (read ${ROOT}/HANDOFF.md and ${ROOT}/CLAUDE.md for what v2 found; v2 engine is ${ROOT}/src/engine2.js). The next version (v3) will be a data-driven, general engine that can simulate ANY two fighters, so research should produce numbers the engine can use, not just narrative.
A full UFC stats snapshot is at ${ROOT}/data/raw/ (from github.com/Greco1899/scrape_ufc_stats, scraped from ufcstats.com, current through Oct 31, 2026): ufc_event_details.csv (EVENT,URL,DATE,LOCATION), ufc_fight_results.csv (EVENT,BOUT,OUTCOME,WEIGHTCLASS,METHOD,ROUND,TIME,TIME FORMAT,REFEREE,DETAILS,URL; OUTCOME like "W/L" refers to the two names in BOUT in order; DETAILS holds judges' totals for decisions and finish details like "Punch to Head At Distance"), ufc_fight_stats.csv (one row per fighter per round: KD, SIG.STR. "x of y", SIG.STR. %, TOTAL STR., TD "x of y", TD %, SUB.ATT, REV., CTRL "m:ss", HEAD, BODY, LEG, DISTANCE, CLINCH, GROUND all "x of y"), ufc_fight_details.csv, ufc_fighter_details.csv, ufc_fighter_tott.csv (HEIGHT, WEIGHT, REACH, STANCE, DOB). Python 3.13 with pandas and numpy is installed; node 22 is installed. Strings in the CSVs have stray trailing spaces; strip them. Join events to fights on the EVENT name (stripped) to get dates.
Rules: check facts before writing them. For anything factual and current, search the web (load the WebSearch tool with ToolSearch query "select:WebSearch" and use mode "standard", or "extended" for niche/recent facts; use WebFetch if you have it) and cite the URL next to each claim. Flag confidence (high/medium/low). Never invent stats, quotes, studies or odds; write "unknown" when you can't confirm. Note that events after mid-2026 are beyond most training data, so verify them on the web or in the dataset rather than recalling. Use they/them for any person whose pronouns aren't established; the fighters' are he/him. Do not modify anything under ${ROOT}/src, ${ROOT}/tests or ${ROOT}/legacy. Do not run git commands that change history (no commit, no push).`

const RESEARCH_SCHEMA = {
  type: 'object',
  properties: {
    file: { type: 'string', description: 'absolute path of the markdown file you wrote' },
    summary: { type: 'string', description: '8-20 sentence summary of the most engine-relevant findings, with numbers' },
    key_claims: {
      type: 'array',
      description: 'the 6-15 most important factual claims a skeptic should re-check',
      items: { type: 'object', properties: { claim: { type: 'string' }, source: { type: 'string' }, confidence: { type: 'string' } }, required: ['claim', 'source', 'confidence'] },
    },
    engine_params: {
      type: 'array',
      description: 'concrete numbers the v3 engine should use (name, value, unit/meaning, source)',
      items: { type: 'object', properties: { name: { type: 'string' }, value: { type: 'string' }, meaning: { type: 'string' }, source: { type: 'string' } }, required: ['name', 'value', 'meaning', 'source'] },
    },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['file', 'summary', 'key_claims', 'engine_params', 'open_questions'],
}

const VERIFY_SCHEMA = {
  type: 'object',
  properties: {
    checked: {
      type: 'array',
      items: { type: 'object', properties: { claim: { type: 'string' }, verdict: { type: 'string', enum: ['confirmed', 'corrected', 'refuted', 'unverifiable'] }, note: { type: 'string' }, source: { type: 'string' } }, required: ['claim', 'verdict', 'note'] },
    },
    edits_made: { type: 'string', description: 'what you changed in the file, or "none"' },
    reliability: { type: 'string', description: 'overall verdict on the dossier: high / medium / low, and why' },
  },
  required: ['checked', 'edits_made', 'reliability'],
}

const ITEMS = [
  {
    key: 'volk',
    file: `${ROOT}/research/volkanovski.md`,
    prompt: `Write a deep, current dossier on Alexander Volkanovski as of Nov 6, 2026, focused on what matters for a 155-lb fight with Justin Gaethje. Cover: record and UFC record now; age (DOB) and what research says about fighters 38+; every fight since 2022 with result, method, round/time, and the key stats (use the dataset for numbers: sig strikes landed/attempted each way, knockdowns scored/absorbed, takedowns, control time); his two lightweight fights vs Islam Makhachev (UFC 284 and UFC 294) in detail, round by round from the dataset; the Topuria KO loss and what changed after; UFC 314 and UFC 325 vs Diego Lopes; UFC 333 vs Movsar Evloev (Oct 24, 2026) in detail, round by round; current health/injury news, weight-cut commentary, camp (City Kickboxing / Freestyle MMA), coaches; his stated plans after UFC 333 (155-lb move, Gaethje, vacating, Tsarukyan); his style tendencies with sources (stance switching, feints, one-two, leg kicks, pressure, level changes, fence work, defensive habits, how he's been hurt); chin/durability evidence (all knockdowns absorbed in UFC, with the strike and position from the DETAILS/rounds); late-round output trend (compute from the dataset: his sig strikes landed per minute by round number across all his 5-round fights). Write it to the given file as clean markdown with a sources list.`,
    verify: `Re-check the fight results, dates, methods and round/times against the dataset and the web; recompute at least 5 of the stat claims yourself from ${ROOT}/data/raw; confirm the current-news claims (health, plans, quotes) with independent searches. Fix wrong claims in the file in place and append a "## Verification log" section.`,
  },
  {
    key: 'gaethje',
    file: `${ROOT}/research/gaethje.md`,
    prompt: `Write a deep, current dossier on Justin Gaethje as of Nov 6, 2026, focused on what matters for a 155-lb fight with Alexander Volkanovski. Cover: record and UFC record now; age (DOB Nov 14, 1988 per dataset — verify); title status (interim title at UFC 324 vs Paddy Pimblett, then UFC Freedom 250 vs Ilia Topuria on Jun 14, 2026 — verify exactly how that ended and who is champion now); every fight since 2021 with result, method, round/time, key stats from the dataset; UFC 300 vs Max Holloway round by round; UFC 324 and Freedom 250 round by round; medical suspension details (CSAC? MRIs on right wrist and left knee), any surgery or clearance news, retirement talk and latest statements; who he is expected to fight next (Tsarukyan? Volkanovski?) and whether anything is booked; style tendencies with sources (leg kicks, pressure, power combinations, head movement, low dips, takedown defense, wrestling background, how he has been hurt/finished); chin and durability evidence (all knockdowns absorbed in UFC with strike/position from the dataset, KO losses: Alvarez, Poirier 1, Chandler? Oliveira submission, Holloway KO); output and pace by round in his 5-round fights (compute from dataset); damage absorbed per minute trend over time. Write it to the given file as clean markdown with a sources list.`,
    verify: `Re-check every result/date/method against the dataset and the web, especially Freedom 250 and the current title picture; recompute at least 5 stat claims yourself from ${ROOT}/data/raw; confirm injury/suspension/retirement claims with independent searches. Fix wrong claims in the file in place and append a "## Verification log" section.`,
  },
  {
    key: 'matchup',
    file: `${ROOT}/research/matchup_market.md`,
    prompt: `Research the current state of a possible Volkanovski vs Gaethje fight as of Nov 6, 2026: is it booked or rumored, what Dana White / UFC / either camp said most recently (with dates), the lightweight division picture (champion, top 5 rankings, Tsarukyan, Makhachev's status, Topuria's status), and the featherweight picture after UFC 333. Then the betting market: every line you can find for Volkanovski vs Gaethje (opening lines, any updates, which books, dates), and convert each to no-vig probabilities. Then expert and model picks: Combat Edge Elo or other rating sites (Volk and Gaethje ratings now), FightMatrix rankings, analyst predictions, fighter predictions — with sources. Then history: featherweight champions moving up to 155 (e.g., BJ Penn reverse, Conor McGregor, Frankie Edgar down, Jose Aldo at 155, Max Holloway at 155 vs Poirier and Gaethje, Volk vs Makhachev) — results, and what that says about the size tax. Common-opponent analysis: Holloway (Volk 3-0, Gaethje lost by KO), Topuria (Volk KO'd, Gaethje won by corner stoppage), Makhachev, and any others; pull the key stats from the dataset for each of those fights. Write to the given file with a sources list.`,
    verify: `Independently re-search the booking status, the latest quotes and every betting line; recompute any no-vig conversions; recheck the weight-class history results. Fix wrong claims in place and append a "## Verification log" section.`,
  },
  {
    key: 'models',
    file: `${ROOT}/research/modeling_literature.md`,
    prompt: `Research the best methods for simulating and forecasting MMA fights, to design engine v3. Find and summarize (with citations and the key numbers): Markov-chain / state-space MMA models (Holmes, McHale & Zychaluk, IJF 2023; EJOR 2024 judging paper) and how they estimate transition rates; strike modeling with attempts and accuracy vs defense (log5 / Bradley-Terry style), per position and target; knockout modeling (knockdown probability per head strike, power, chin, damage accumulation, age and chin decline); fatigue and pace models; age curves in MMA (peak ages by weight class, decline after 35, studies on older fighters' win rates and KO loss rates); weight-class movement effects (moving up: win rate, KO susceptibility); rating systems for MMA (Elo/Glicko/TrueSkill, FightMatrix findings, best achievable accuracy ~65-70%), betting market efficiency in MMA (favorite-longshot bias, calibration studies); judging research (ABC criteria, how sig-strike differential / knockdowns / takedowns / control map to round wins, 10-8 frequency, judge heterogeneity, home bias); in-fight adaptation; open-source MMA simulators or prediction projects worth borrowing from (GitHub), and their reported accuracy. End with a concrete "recommended engine v3 design" section: state space, rate equations, how to estimate fighter parameters from round-level data with shrinkage toward weight-class priors (empirical Bayes), opponent adjustment, time decay, uncertainty (fight-night form), judging model, and validation protocol (walk-forward backtest, Brier, log loss, calibration curves). Write to the given file with a references list.`,
    verify: `Verify that every cited paper/source exists with the stated authors, venue, year and finding (search for each one). Remove or correct anything that can't be found. Check that numerical claims match the sources. Fix in place and append a "## Verification log" section.`,
  },
  {
    key: 'baserates',
    file: `${ROOT}/research/data_baserates.md`,
    prompt: `Compute league base rates and calibration targets from the dataset in ${ROOT}/data/raw with pandas. Write a reusable script at ${ROOT}/tools/baserates.py that prints/writes everything, and save machine-readable output to ${ROOT}/data/derived/baserates.json. Cover, for (a) all UFC 2015-01-01 onward, (b) lightweight bouts, (c) featherweight bouts, (d) 5-round bouts (TIME FORMAT starts with "5 Rnd"), (e) title bouts: number of fights; method split (KO/TKO incl. doctor/corner, submission, U-DEC, S-DEC, M-DEC, draw/NC); finish hazard by round (share of fights finished in each round, and conditional on reaching the round); finish position from DETAILS ("At Distance", "In Clinch", "On Ground", "From Mount", etc.) and strike type ("Punch", "Kick", "Knee", "Elbow"); per-15-minute rates for sig strikes landed and attempted by position (distance/clinch/ground) and by target (head/body/leg); accuracy by position and target; knockdowns per 100 landed sig HEAD strikes at distance+clinch (and per 100 landed sig strikes overall); probability a knockdown leads to a finish in the same round; takedowns attempted/landed per 15 and accuracy; control seconds per landed takedown; submission attempts per 15 and per minute of ground control, and sub attempt -> finish conversion; share of fight time in each position (estimate ground time from CTRL); round-level stats distributions (mean and sd of sig strikes landed per round per fighter). Judging: parse DETAILS judge scores for decisions; frequency of 10-8 rounds implied (e.g. totals like 30-26), unanimous vs split shares, how often judges disagree; per-judge counts for the most frequent judges. Also fit a simple round-winner model where possible: use decisions where every judge's total is the max (e.g. 30-27 / 50-45 for all three) so each round's winner is known, and fit a logistic regression (numpy only, implement it) of round winner on differentials: sig strikes landed (head/body/leg separately if possible), knockdowns, takedowns, control seconds, sub attempts. Report coefficients. Also: corner/doctor stoppage rates, and how strike rates change by round number in 5-round fights (pace curve). Write the findings to the given markdown file with tables.`,
    verify: `Independently recompute at least 8 headline numbers from the raw CSVs with your own fresh code (do not reuse ${ROOT}/tools/baserates.py), especially: lightweight method split, 5-round finish hazard by round, knockdowns per 100 landed head strikes, takedown accuracy, and the round-winner regression coefficients' signs/magnitudes. Look for parsing bugs (e.g. "---" values, draws/NC, overtime formats, OUTCOME order, events with trailing spaces). Fix errors in the markdown/script/JSON in place and append a "## Verification log" section.`,
  },
  {
    key: 'fightlog',
    file: `${ROOT}/research/data_volk_gaethje.md`,
    prompt: `Build complete, data-driven fight logs and derived profiles for Volkanovski and Gaethje from ${ROOT}/data/raw with pandas. Write a reusable script ${ROOT}/tools/fighter_report.py "<Fighter Name>" that works for ANY fighter and outputs a markdown report + JSON (${ROOT}/data/derived/fighter_<slug>.json). For each fighter: every UFC fight (date, event, opponent, weight class, result, method, round, time, rounds format) with per-fight totals for both sides (sig landed/attempted, by target head/body/leg, by position distance/clinch/ground, KD for/against, TD landed/attempted for/against, control time for/against, sub attempts for/against); career and last-3-years per-minute rates; time-decayed (half-life 2 years) rates; knockdowns absorbed per 100 sig head strikes absorbed (chin metric) for career and for the last 4 years; knockdowns scored per 100 sig head strikes landed (power metric); opponents' sig strike accuracy against them (defense); output per minute by round number in 5-round fights (pace curve); how their stats differ at lightweight vs featherweight (Volk); common opponents (Holloway, Topuria, Makhachev, any others) with side-by-side stats; and a head-to-head projection table of the raw rates that an engine would use. Write the findings to the given file.`,
    verify: `Recompute independently (fresh code, not ${ROOT}/tools/fighter_report.py) at least 8 numbers: each fighter's career sig strikes landed/absorbed per minute, KD absorbed and scored, TD accuracy and defense, and the per-round pace in their 5-round fights. Check that the fighter-name matching does not mix in other fighters with similar names and that both sides of each bout are attributed correctly. Fix errors in place and append a "## Verification log" section.`,
  },
  {
    key: 'audit',
    file: `${ROOT}/research/audit_v2.md`,
    prompt: `Audit the existing v2 project in ${ROOT} thoroughly ("go through all of this"): read every file in src/, tests/, build.py, legacy/ and the docs. Produce a prioritized critique: (1) modeling flaws in src/engine2.js (e.g. landing rate = average of attacker landed/min and defender absorbed/min instead of attempts x accuracy vs defense; no misses in the engine; only 4 states; hard-coded Volk/Gaethje; KD and finish heuristics; judging formula; corner stoppage; form noise; anything statistically wrong), with what to do instead; (2) generality: everything hard-coded to these two fighters across engine, director, show and app that blocks adding new fighters; (3) code quality, performance and bugs in the 3D show (src/show3d.js, rig3d.js, arena3d.js), director and app; (4) a visual-quality assessment: build the page (python3 build.py) and render it headlessly with node + playwright (require('playwright') works from any directory; chromium.launch() needs no options; pass args ['--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist']). The page loads three.js from cdnjs which is NOT reachable here, so write a local wrapped copy under ${SCRATCH}/audit/ that replaces the cdnjs URL with file://${ROOT}/vendor/three.min.js and wraps it in a doctype/html/head/body skeleton (see tests/func_check.py for how). Fast-forward the fight via window.VGSim.show.frame(1/30) loops as func_check.py does, and take screenshots (deviceScaleFactor 1) of the cage at several moments plus the full page at 1280px and 390px wide; save them in ${SCRATCH}/audit/ and look at them. Describe concretely what looks amateurish and what would most improve it (character models, materials, lighting, environment, camera, animation, HUD, layout). Write the audit to the given file with specific file:line references.`,
    verify: `Spot-check the audit: open the referenced file:line locations and confirm each claimed flaw is real (not a misreading). Look at the screenshots in ${SCRATCH}/audit/ yourself and confirm the visual assessment. Remove or correct false claims, add any important flaws that were missed, and append a "## Verification log" section.`,
  },
  {
    key: 'assets',
    file: `${ROOT}/research/assets.md`,
    prompt: `Scout and download the best freely licensed assets to elevate the 3D fight scene. Constraints: the final page is a claude.ai artifact; it can load scripts only from cdnjs.cloudflare.com, cdn.jsdelivr.net/npm, unpkg.com (exact pinned versions); other files must be embedded (data: URIs, 16 MB page cap) or shipped as supporting files next to the page. From THIS machine, only raw.githubusercontent.com, api.github.com (maybe) and the npm registry (registry.npmjs.org; use "npm pack <pkg>@<ver>" or curl tarballs) are reachable; polyhaven.com, ambientcg.com, quaternius.com, cdnjs and jsdelivr are NOT reachable from here (but the published page can still load jsdelivr scripts in the user's browser). Use web search to find candidates, then download them via raw.githubusercontent.com or npm into ${SCRATCH}/assets_candidates/ and verify each file actually downloads and parses. Priorities: (1) a rigged, realistic-ish human male character (glTF/GLB) with a standard humanoid skeleton that we can recolor (shorts, gloves, skin tones) and drive with our own IK — strongly prefer CC0/public domain (e.g. Quaternius, MakeHuman exports, Kenney) and report the license of anything Mixamo-derived (three.js example models Xbot/Ybot/Soldier/Michelle) honestly; list bone names and vertex/triangle counts and file size for each candidate (parse the GLB JSON chunk with a small node script); (2) a small CC0 HDRI/environment for image-based lighting (e.g. Poly Haven files mirrored in the three.js repo under examples/textures/equirectangular — check license) and whether three's RoomEnvironment could replace it; (3) CC0 PBR textures for canvas mat, chain-link fence, padding, skin detail; (4) fighting animation clips (CC0) if any exist (punches, kicks, guard idle, knockdown) — retargetable to the chosen skeleton; (5) which three.js version to use: compare staying on r128 (UMD three.min.js on cdnjs; GLTFLoader and postprocessing exist as non-module files at cdn.jsdelivr.net/npm/three@0.128.0/examples/js/...) vs upgrading to a modern ES-module three (e.g. 0.16x/0.17x on jsdelivr with an import map) — list exact URLs and confirm the files exist via the npm tarball contents. Write a recommendation with sizes, licenses (quote the license text location), and the exact download URLs, in the given markdown file. Keep candidates in ${SCRATCH}/assets_candidates/ with a manifest.json (file, source URL, license, size).`,
    verify: `Re-verify licenses of every recommended asset from the primary source (license file in the repo or package, author page via web search). Confirm the downloaded files exist in ${SCRATCH}/assets_candidates/, match the stated sizes, and parse (for GLB: valid header and JSON chunk; list skins/animations). Flag any asset whose license is unclear or Mixamo-restricted. Fix the recommendations in place and append a "## Verification log" section.`,
  },
]

phase('Research')
const PICK = Array.isArray(args) && args.length ? ITEMS.filter((it) => args.includes(it.key)) : ITEMS
log('items: ' + PICK.map((it) => it.key).join(', '))
const results = await pipeline(
  PICK,
  (it) => agent(`${PRE}\n\nTASK (${it.key}): ${it.prompt}\n\nWrite your output file to: ${it.file} (create parent folders as needed). Return the structured summary.`, { label: `research:${it.key}`, phase: 'Research', schema: RESEARCH_SCHEMA }),
  (res, it) => {
    if (!res) return null
    const claims = (res.key_claims || []).map((c, i) => `${i + 1}. ${c.claim} [source: ${c.source}; conf: ${c.confidence}]`).join('\n')
    return agent(`${PRE}\n\nYou are an adversarial fact-checker. Another researcher wrote ${it.file}. Your job is to try to REFUTE its claims, not to confirm them; assume errors exist until you've checked. ${it.verify}\n\nThe researcher's key claims:\n${claims}\n\nAlso skim the whole file for anything else that looks wrong or unsupported. Return the structured verdicts.`, { label: `verify:${it.key}`, phase: 'Verify', schema: VERIFY_SCHEMA })
      .then((v) => ({ key: it.key, file: it.file, research: res, verify: v }))
  },
)
return results.filter(Boolean).map((r) => ({
  key: r.key,
  file: r.file,
  summary: r.research.summary,
  engine_params: r.research.engine_params,
  open_questions: r.research.open_questions,
  reliability: r.verify ? r.verify.reliability : 'not verified',
  corrections: r.verify ? r.verify.checked.filter((c) => c.verdict !== 'confirmed') : [],
  edits: r.verify ? r.verify.edits_made : '',
}))
