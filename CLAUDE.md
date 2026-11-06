# Volk vs Gaethje Simulator

Kira's fight-modeling project: a position-based Monte Carlo engine for a hypothetical
Alexander Volkanovski vs Justin Gaethje lightweight fight (5 x 5 min, 155 lb), a 3D cage that
replays one simulated fight, a live 20,000-fight tally with knobs, a model stack, a backtest and a
scouting report. Built with Claude in one overnight chat on Nov 6, 2026.

The built page is published as a private claude.ai artifact (title "Volk vs Gaethje Simulator"):
https://claude.ai/artifact/UiJenoPYvSSoRF8SPZLBJR
Claude Code edits and builds it here. Republishing to that link happens from a Claude chat with the
Artifact tool: pass the link and the rebuilt volk-gaethje-simulator.html.

## Read first

- HANDOFF.md: findings, final numbers, decisions, research and sources, open threads.
- CONVERSATION.md: the original chat, Kira's messages and Claude's replies.

## Layout

- src/engine2.js: the fight engine (no DOM, runs in Node, the browser and a Web Worker).
- src/director.js: turns one traced engine fight into an animation script (moves, misses, play-by-play).
- src/rig3d.js: articulated fighter rig built from primitives, with two-bone IK for arms and legs.
- src/arena3d.js: renderer, octagon, fence, crowd, lights, camera flashes, stools.
- src/show3d.js: runtime choreography: footwork, strikes, takedowns, knockdowns, referee, cameras, replays.
- src/app.js: page controller: HUD, play-by-play, judges' cards, tally worker, knobs, charts, model stack, backtest.
- src/page.src.html: markup and CSS with /*__ENGINE__*/-style placeholders for the scripts.
- build.py: inlines src/ into volk-gaethje-simulator.html (the published file).
- tests/test_engine2.js: presets, calibration stats and the seven-fight backtest.
- tests/dev3d.html, tests/dev3d_live.html, tests/shots.py: 3D pose grid and live time-lapse renders.
- tests/func_check.py: headless functional check of the built page.
- vendor/three.min.js: three.js r128 for the local dev pages (the page itself loads it from cdnjs).
- legacy/: v1, the round-by-round model (Python original, JS port, 2D page, port test).

## Commands

- Build: `python3 build.py`
- Engine tests and backtest: `node tests/test_engine2.js 30000` (about 15 seconds)
- Dev pages: `python3 -m http.server 8000` from the root, then open /tests/dev3d.html or /tests/dev3d_live.html#kd (also #td, #ko, #dec)
- Headless checks: `python3 tests/func_check.py`, `python3 tests/shots.py poses`, `python3 tests/shots.py live ko` (need Playwright)

## How the pieces fit

1. `FightEngine.volkGaethje(knobs)` builds a matchup (A = Volkanovski, blue; B = Gaethje, red).
2. `FightEngine.simulate(matchup, rng, trace)` plays one fight. With trace=true each round carries an
   event list: hit/kd/hurt/fin (with target, position, damage and stamina snapshots), clinch, break,
   td, tdx, up, sub, subx, reset, plus judges' scores and any corner stoppage.
3. `FightDirector.build(fight, seed)` assigns moves (jab, cross, hook, calf kick, knee, ground strike...),
   adds visual-only misses at career accuracy, chains combinations and writes play-by-play.
4. `FightShow.Show` schedules beats on a fight clock (speed = fight seconds per real second), runs pair
   footwork while standing, transitions modes (stand, clinch, top, bottom, down, ko, sit, walk,
   celebrate, raised, ref, refstop), fires hooks (onBeat, onText, onClock, onPhase, onRoundEnd,
   onFinish, onDecision, onReplay, onResult, onImpact) and records a ring buffer for replays.
5. `app.js` turns hooks into the HUD and runs the tally in a blob Web Worker built from the inline
   engine script's own text (falls back to main-thread chunks, and to a text-only show without WebGL).

## Engine conventions

- Continuous-time Markov chain per round; states 0 distance, 1 clinch, 2 A on top, 3 B on top.
- Landing rate = average of attacker's landed/min and defender's absorbed/min, x STRIKE_CAL 0.85.
- Knockdowns per landed head strike: career rate shrunk toward a 0.009 prior worth 300 head strikes.
- Fight-night form per fight: output sd 0.10, power sd 0.15, chin sd 0.12 (lognormal).
- Judging: damage-weighted strikes (head 1, body 0.8, leg 0.55, ground 0.85), knockdown 12, wobble 4,
  takedown 3, control 0.06 per second, submission attempt 7; per-judge power and grappling tastes.
- Knob defaults: volkChin 1.15, volkPow 0.85, volkOut 0.95, mileage 0, judgePower 0.25, volkTd 3.0,
  gaeTd 1.5, gaeLeg 0.18. Every judgment call should stay a labeled knob.
- After any engine change, rerun tests/test_engine2.js and update the numbers in HANDOFF.md and in the
  page copy that quotes them.

## 3D gotchas learned the hard way

- three.js r128 has no CapsuleGeometry; capsules are LatheGeometry with points ordered bottom to top.
- The floor ShapeGeometry is rotated -PI/2 on X; the canvas texture maps world (X, Z) to canvas (x, y).
- IK: bones point down local -Y; the solver builds world quaternions from a basis (Y along the bone,
  Z toward the pole) and converts to local. Feet and gloves keep their own orientation.
- Stepping feet are locked during kicks and shots, or the planted foot jumps when the kick ends.
- Close, replay and center cameras are clamped inside the fence; the cage camera snaps to a panel
  center so posts never block it.
- Headless Chrome uses software WebGL and crawls. To test the flow, call show.frame(1/30) in a loop
  with arena.render stubbed out (see tests/func_check.py). window.VGSim exposes { show, newFight }.

## Page rules (claude.ai artifact host)

- One self-contained HTML file. No doctype, html, head or body tags: the host wraps the page in a
  skeleton that pads :root for safe areas and adds `[hidden]{display:none!important}`.
- `<title>` and `<meta name="claude:viewport-fit-sides" content="cover">` at the top; side gutters use
  `max(16px, env(safe-area-inset-left/right, 0px))`.
- Scripts only from the CDN allowlist (cdnjs preferred, pinned versions); stylesheets only from Google
  Fonts. Blob Web Workers are fine; network fetches, downloads, print and dialogs are not.
- Every color is a token on :root with dark values under `@media (prefers-color-scheme: dark)
  :root:not([data-theme="light"])` and again under `:root[data-theme="dark"]`. Body sets its background.
- Must work at 390px wide with no horizontal page scroll; wide tables scroll in their own container.
- Footer keeps "A model of the matchup, not a forecast, and not betting advice."

## Working with Kira

- Be direct and execution-oriented; she welcomes clarifying questions when refining plans.
- Check current facts on the web and cite sources; flag confidence; never invent stats or quotes.
- Times in am/pm.
