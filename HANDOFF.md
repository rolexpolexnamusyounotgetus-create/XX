# Handoff: where the Volk vs Gaethje work stands

Built in one chat on Friday, Nov 6, 2026, between about 1:00 am and 3:10 am ET; extended through Sat Nov 7, 2026.

## Current state (Sat Nov 7, 2026, evening ET) — start here

**Page.** https://claude.ai/artifact/PP5QsWNDwPiqP6m7V3C4JC ("Fight Lab", Version 3). Built from this repo with
`python3 build.py` (output volk-gaethje-simulator.html); checks: `node tests/page_check.js`,
`node tests/test_page_parity.js`, `node tests/test_page_models.js`. Republish with the Artifact tool, same URL.

**Predictions (what is live).**
- Winner: ML v2 stacked with the betting line (src/ml/pagepredict.js on the page; tools/forward_ledger.py/.js for the
  forward test). No line: ML v2 + market rating. Opener or any pre-fight line: the open-trained stack. Close: the
  close-trained stack.
- Method/round: S2 cells scaled to the winner odds; the debut method model for UFC debutants; the props pool when
  method props were captured (forward ledger fwd-4.5).
- Stat lines: statlines P10/P50/P90 bands (src/ml/statdist.js).
- Honest numbers: 2024-25 held-out, ML v2 logistic 0.5887 vs close 0.5854 (tie); with-line stack beat the close by
  -0.0087 (2024-25 only). Sealed 2026 fights (opened twice, now spent): close 0.6003; shipped ML v2 open stack 0.6150
  vs opener 0.6199 -> level with the market. research/vault_audit_v5.md, research/vault_audit_v10.md.

**Engine.** v4 (4.0.0) is the kept engine (src/engine3.js, src/params3.js = versions/v4). v5, v5.0.1, v6 rejected on
their single 2024-25 looks; v7, v8, v9 failed their train gates; v10 kept on branch 2 then reversed on review
(second decisive metric forbidden by docs/V6_V10_PLAN.md 7.1 item 4; re-scope not ratified by Kira; stat-line parts
not on the live path). Every decision with numbers: data/derived/version_history.json, docs/CHANGELOG.md.
Open decision for Kira: the review recorded a path to ratify v10 after the fact (7.1 item 11); Claude recommended
not ratifying (choosing a rule after seeing the result).

**Forward-test ledger (the only clean test left).** data/predictions/README.md (rules; versions fwd-4.1 .. fwd-4.5).
- UFC Vegas 124 (Nov 7) locked under fwd-4.1 (commit 87e0050); pre-lock check kept it (344f100).
- Scoring: `python3 tools/forward_ledger.py score` (two sources: Greco1899 CSVs, refreshed Sundays ~18:00 UTC, + ESPN).
- Before each card: `nice -n 5 python3 tools/live_refresh.py` (inputs only, models frozen; fwd-4.4+), debutant records
  (`python3 tools/debut.py features ... --live`), odds (`tools/odds_upcoming.py`), props (`python3 tools/props.py
  capture`, T-25h..T-8h), then `python3 tools/forward_ledger.py predict --event <date> --fwd auto --sims 20000`.
- Scheduled one-shot tasks on Kira's account do this: score Vegas 124 (Nov 8 19:30 UTC), UFC 334 (Nov 13 21:30 UTC),
  Qatar card (Nov 20 11:00 UTC), Dec 5 card (Dec 4 20:00 UTC), UFC 335 (Dec 11 21:30 UTC).
- Drift monitor: tools/drift_monitor.py (pre-registered rule 6.5.1(b) + level alarms).

**Research record.** docs/BACKLOG.md (every verified result, decision and correction, newest near the top of each
section), research/*.md (each with a Verification log), docs/V6_V10_PLAN.md (the selection protocol), docs/ROADMAP.md.
Lab results: adopted = debut method model, statlines, props pool; not adopted = crowd picks, line timing, calibration,
sequence net, Bayesian skill model, finishing tendencies, era drift (glove-trial finding kept).

**3D.** Paused by Kira on Nov 6 (resources moved to prediction). Last pass shipped beard/short-hair caps, skin, body
definition and the women's sports top; per-fighter likeness labs were not run (scripts in archive/).

**Session archive.** archive/2026-11-06_session/ holds the orchestration scripts, component patches and the SPENT 2026
vault (for reproducing the audits only; never for model selection). See its README.

## Engine v4 (Nov 6, 2026 afternoon)

The prediction engine is now v4 (src/engine3.js `VERSION` 4.0.0; frozen copy in versions/v4/, v3 in versions/v3/).
It plays the learned stat-line model's per-matchup rates (FightEngine.loadMLRates), uses priors and self-calibration
from fights before 2024 only, and judges rounds with the EM weights plus noise fit to real judges' rounds. On the
2019-2023 training fights it beats v3 on the winner: log loss 0.6635 vs 0.6716 (paired -0.0081 [-0.0134, -0.0026]),
accuracy 60.5% vs 57.1%.
- **Validation, 2024-2025, one look per version.** v4 beats v3 on winner log loss, 0.6324 vs 0.6424 (paired -0.0100
  [-0.0170, -0.0030], 853 decisive fights), so v4 is kept.
  - Brier and all five stat-line deviances also improve, each with a CI that excludes 0.
  - 7-bin, method and who x how x when are level or slightly better, none significant.
  - Both versions are underconfident on 2024-25 (calibration slope 1.57 for v3, 1.72 for v4).
  - v4 still trails methodround model S: who x how x when +0.029, winner +0.011.
- **Blend test.** The stacker gives the engine weight 0.037 with the closing line (v3: 0) and 0 without a line. The
  blend's log loss moves by -0.0002 [-0.0006, +0.0001], which is not significant.
- **v4.0.1, the review's fixes, was rejected** (one validation look, 11:45 am ET).
  - What it changed: train-only EM judging weights, point deductions, learned-path TD/control/sub levels, and a
    cumulative takedown cap.
  - Validation winner log loss: 0.6289 vs v4's 0.6324, -0.0034 [-0.0073, +0.0008]. Nothing else was significant, so the
    decision rule rejects it.
  - src/ holds v4 again. The work is in versions/v4.0.1-rejected/.
  - Caveat: v4's EM judging weights saw cards through 2026-10. Fixing that is a v5 item (docs/BACKLOG.md
    "Engine v4 review follow-ups").
- **v5, the merged roadmap engine, was rejected too** (one validation look, Nov 6 at 8:51 pm ET).
  - Winner log loss 0.6301 vs v4's 0.6324, -0.0022 [-0.0099, +0.0053]: not significant.
  - Stat lines are better on 4 of 5 stats.
  - Knockdowns per 100 head strikes are +21% and the KO share +2.7 pts against actual. Both are out of tolerance, so the decision
    rule rejects it.
  - src/ holds v4 again. The work is in versions/v5-rejected/ (docs/CHANGELOG.md "v5 (2026-11-07)").
  - Its prediction package (blend P(win) + method x round) scored 0.5810 with the closing line, beating the close by -0.0067
    [-0.0096, -0.0036]. That is recorded for v6.

Details: docs/CHANGELOG.md (v4), docs/BACKLOG.md ("Engine v4 status"), docs/ENGINE_V3_SPEC.md ("Engine v4"),
data/derived/version_history.json.

## The question trail

1. **Volkanovski vs Tsarukyan at 155 next year.** Call: Tsarukyan, roughly 65-35, moderate
   confidence. The Makhachev blueprint with a younger engine: Tsarukyan averages 3.26 takedowns per
   15 minutes to Volk's 1.63, was 24-3 on six straight wins at 30; Volk is 38 and the smaller man.
2. **Volk vs Gaethje, "run the simulations."** v1 was a round-by-round Python Monte Carlo
   (legacy/volk_gaethje_sim.py): Volk 57.4%, Gaethje 41.8%, draws 0.8% over 200,000 fights, with
   scenarios from 46% to 68%. The call then was about 52-48 Volk.
3. **"Animate the model."** v1 became a 2D animated page (legacy/page_v1.src.html), published.
4. **"Go way deeper."** v2: new engine, deeper scouting, research on prediction models and judging,
   a 3D cage, a model stack and a backtest. Republished to the same artifact link.

## Where the numbers landed (v2 engine)

**Baseline, 200,000 fights:** Volkanovski 49.1%, Gaethje 49.4%, draw 1.5%.

| Outcome | Share |
|---|---|
| Volk by KO/TKO | 14.6% |
| Volk by submission | 0.8% |
| Volk by decision | 33.7% |
| Draw | 1.5% |
| Gaethje by decision | 15.0% |
| Gaethje by submission | 0.0% |
| Gaethje by KO/TKO | 34.4% |

Goes the full 25 minutes 50.2%; Volk wins 67.2% of those on the cards. Finishes by round, as a share
of all fights: Volk 2.4, 2.8, 3.1, 3.5, 3.8; Gaethje 5.4, 6.4, 7.3, 8.1, 7.3.

**Scenario presets (60,000 fights each, Volk / Gaethje):** 155-lb tax 37.4 / 61.0; Gaethje's mileage
60.2 / 38.4; Volk wrestles 56.4 / 42.3; Prime Volk 59.4 / 39.3; Gaethje chops calves 52.5 / 46.0;
Judges reward power 41.8 / 56.6; Volume-only judges 54.5 / 44.2.

**Model stack (Volk's chance):** engine v2 about 50% with draws set aside; engine v1 57%; Elo 51%
(Combat Edge: Volk 1879 after UFC 333, Gaethje 1869; no weight-class adjustment); market 36%
(FightOdds.io opening line, Gaethje -200 / Volk +170, margin removed). Blend in log-odds with weights
market 40%, engine 40%, Elo 20%: **Volkanovski 44%, Gaethje 56%.** This replaced the earlier 52-48
Volk call, which shaded the simulations without weighing the market.

**Backtest, seven real fights, engine vs the betting line on the same fight:**

| Fight | Result | Engine: winner's chance | Market: winner's chance |
|---|---|---|---|
| Volkanovski vs Lopes 2, UFC 325, Jan 31, 2026 | Volk, decision | 58% | 57% (-154 / +120) |
| Gaethje vs Pimblett, UFC 324, Jan 24, 2026 | Gaethje, decision | 41% | 34% (Pimblett -210 to -239) |
| Gaethje vs Topuria, UFC Freedom 250, Jun 14, 2026 | Gaethje, corner TKO R4 | 22% | 18% (-600 / +450) |
| Gaethje vs Holloway, UFC 300, Apr 13, 2024 | Holloway, KO R5 | 50% | 41% (-162 / +136) |
| Volkanovski vs Topuria, UFC 298, Feb 17, 2024 | Topuria, KO R2 | 73% | 47% (-120 / +110) |
| Volkanovski vs Evloev, UFC 333, Oct 24, 2026 | Volk, TKO R2 | 39% | 50% (-113 / -113) |
| Volkanovski vs Lopes 1, UFC 314, Apr 12, 2025 | Volk, decision | 58% | 56% (-142 / +120) |

Brier score 0.288 for the engine vs 0.340 for the market; log loss 0.78 vs 0.90; the engine favored
the winner in 4 of 7, the market favorite won 2 with one pick'em. Low confidence: seven fights, mostly
upsets, and the career stats already include these fights. On the four fights with full stats the
strike-rate estimates missed by 15% on average with about 1% bias after the 0.85 scale.

## Research notes

Fighters (UFC career unless noted):
- Volkanovski: 29-4, age 38, 5'6", 71.5" reach, orthodox. 5.99 landed and 3.31 absorbed per minute,
  57% accuracy, 0.30 knockdowns per 15, 1.63 takedowns per 15 at 34%, 67% takedown defense, 0.20
  submission attempts per 15. Targets head 63%, body 11%, legs 26%; positions distance 75%, clinch 9%,
  ground 16%. UFC 16-3. Beat Evloev by TKO at 4:54 of round 2 at UFC 333 (Oct 24, 2026); beat Lopes
  twice by decision. Lost to Makhachev twice at 155 (decision, then a head-kick KO) and was KO'd by
  Topuria. Output rises late: about 7.5 significant strikes a minute in fifth rounds (UFC.com).
- Gaethje: 28-5, age 37 (38 on Nov 14), 5'11", 70" reach, orthodox. 6.29 landed and 6.83 absorbed per
  minute, 0.67 knockdowns per 15, 0.30 takedowns per 15 at 27%, 73% takedown defense, no submission
  attempts. Targets head 63%, body 9%, legs 28%; positions distance 86%, clinch 12%, ground 2%.
  Undisputed lightweight champion after Topuria retired on the stool after four rounds at UFC Freedom
  250 (White House South Lawn, Jun 14, 2026); Topuria out-landed him 97-91 and scored the only
  knockdown. Interim title over Pimblett at UFC 324: 2 knockdowns, 3 of 3 takedowns, 5:55 control,
  out-landed 156-144, cards 48-47, 49-46, 49-46. Holloway out-landed him 181-103 and 62-18 in the
  fifth before the last-second KO at UFC 300. Suspended up to 180 days pending MRIs on his right wrist
  and left knee after Topuria (CSAC).
- Styles: Volk's favorite combination is the one-two, overhand right his best punch, inside low kicks,
  stance switches mid-combination, level-change threats; leans away in the pocket, especially on the
  fence (Sherdog, MMA Sucka). Gaethje throws in bunches (three-two, hooks, overhand right),
  hip-turned leg kicks that set up the head kick that KO'd Poirier, jab and level-change feints;
  dips low into knees and uppercuts (Sherdog, MMA Sucka).
- Status: not booked as of Nov 6, 2026. Dana White said there's little he'd refuse Volk; Gaethje
  hadn't agreed. Volk offered to vacate and fight Tsarukyan if Gaethje retires.

Models and judging:
- Holmes, McHale and Zychaluk, "A Markov chain model for forecasting results of mixed martial arts
  contests," International Journal of Forecasting 39(2), 2023: simulate the fight, compare to bookmakers.
- Holmes, McHale and Zychaluk, European Journal of Operational Research 312(2), 2024: Bayesian
  hierarchical models show individual judges have preferences that can decide bouts.
- ABC MMA scoring clarification (2025 PDF): damage, then dominance, then duration; 10-8 needs
  significant damage; control without damage doesn't count.
- O'Connell's UFC judging analysis: head strikes most valued, knockdowns huge, a takedown about 50
  seconds of control, a submission attempt more than twice a takedown.
- Markets: Robbins, 6,190 UFC fights 2007-2022, no systematic bias (calibration slope CI 0.983-1.08);
  Pinnacle favorites won 66.3% in 2019-2021 (AgentMMA summary).
- Ratings: FightMatrix found nothing better than the high 60s; UFCalendar self-reports 63% favorite
  accuracy and a 0.232 Brier score over 26,261 fights.
- Aggression to the Mean, 2,941 fights: close matchups end about 30% KO/TKO and 40% unanimous decision.

## Sources

- https://www.cbssports.com/ufc/fighter/50037035/alexander-volkanovski/
- https://www.cbssports.com/ufc/fighter/50037034/justin-gaethje/
- https://gidstats.com/fighters/alexander_volkanovski.html
- https://gidstats.com/fighters/justin_gaethje.html
- https://www.ufcalendar.com/events/ufc-325-2026-01-31/alexander-volkanovski-vs-diego-lopes
- https://www.ufcalendar.com/events/ufc-324-2026-01-24/justin-gaethje-vs-paddy-pimblett
- https://www.ufcalendar.com/fighters/alexander-volkanovski
- https://www.sherdog.com/news/articles/Scouting-Report-Alexander-Volkanovski-190414/amp
- https://www.sherdog.com/news/articles/Scouting-Report-Justin-Gaethje-190610
- https://mmasucka.com/opinion/previewing-a-potential-justin-gaethje-vs-alexander-volkanovski-fight/
- https://www.ufc.com/news/main-event-spotlight-ufc-298-volkanovski-vs-topuria
- https://www.f4wonline.com/news/ufc/justin-gaethje-ilia-topuria-ufc-freedom-250-stats-numbers/
- https://themaclife.com/sports/mma/gaethje-handed-medical-suspension-after-title-win/
- https://heavy.com/sports/ufc/justin-gaethje-betting-favorite-alex-volkanovski/
- https://combat-edge.com/fighter/justin-gaethje-901/
- https://combat-edge.com/news/ufc-333-volkanovski-vs-evloev-results/
- https://www.yardbarker.com/mma/articles/alexander_volkanovski_wants_superfight_with_justin_gaethje/s1_17701_44437243
- https://econpapers.repec.org/RePEc:eee:intfor:v:39:y:2023:i:2:p:623-640
- https://econpapers.repec.org/RePEc:eee:ejores:v:312:y:2024:i:2:p:733-745
- https://www.abcboxing.com/wp-content/uploads/2025/08/ABC-MMA-Scoring-Criteira-Clarification-7.2025.pdf
- https://oconnellryan.github.io/ufc-judging-analysis.html
- https://agentmma.com/mma-lab/ufc-favorites-win-rate
- https://www.fightmatrix.com/2019/09/18/tuning-glicko-what-i-learned-confirmed/
- https://www.ufcalendar.com/elo/accuracy
- https://aggression-to-the-mean.github.io/AttM/for-the-people/arts/2021/02/16/How-Accurate-are-Fight-Odds.html
- Backtest lines: heavy.com (UFC 325, Freedom 250 via Volkanovski's prediction piece, UFC 333),
  lowkickmma.com (UFC 324, UFC 300), actionnetwork.com (UFC 298), foxsports.com (UFC 314).

## Open threads

- Real knockdowns-absorbed data per fighter would replace the chin judgment call.
- An out-of-sample backtest: freeze career stats before each fight and test on dozens of bouts.
- Run Tsarukyan through the same engine to revisit the 65-35 call with the new machinery.
- Phone performance tuning (shadow map size, crowd count) after testing on real devices.
- If the fight gets booked, swap in the real line and fight-week news (injuries, weigh-in).

## Page copy: where the plain-English source notes point (page review, Nov 6 evening)

The page no longer shows project paths to visitors. Each plain description maps to these files:

- "Our analysis of UFC results, 2010 to Oct 2026" (age card): research/volkanovski.md, section 2.
- "Our analysis of UFC weight-class moves" (size card, Baseline and 155-lb tax scenarios): research/matchup_market.md, section 7.
- "Rating systems that model layoffs (Glicko variants)" (Ring rust scenario): research/modeling_literature.md, rating baselines.
- "Our analysis of UFC round-by-round data" (Five-round war scenario): docs/BACKLOG.md, Pace.
- "Our analysis of UFC judges' scorecards" (Volume-only judges scenario): docs/BACKLOG.md, Judging.
- Gaethje's mileage, Volk wrestles, Prime Volk, Gaethje chops calves: research/gaethje.md (sections 0, 5, 7) and research/volkanovski.md (sections 5, 8, 11, 13).
- Backtest "Every simulator version": data/derived/version_history.json (tools/evalv.js). "Older check" table: data/derived/calibration.json.
- Forward-test ledger rules: data/predictions/README.md.
- Scouting text that cites research/*.md shows "our research notes" on the page (app.js scrubPaths).
- Gaethje's "GAETHJE" upper-back lettering (data/overrides.json) is kept: Bloody Elbow (Feb 28, 2025 profile) and Sportskeeda's tattoo guide both describe it; the likeness sheet's photos never showed his back. Medium confidence (no back photo checked).
