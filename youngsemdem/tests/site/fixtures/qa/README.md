# tests/site/fixtures

Fixture sites for `tests/site/w8.test.js` (W8 acceptance tests, BRIEF 10.4). The test copies each one
to a temp folder (and adds the real infra scripts `assets/js/config.js`, `store.js`, `share.js`), so
nothing here is ever written to.

- `qa/`: `good.html` (+ `es/good.html`) passes every measurable gate. Each `defect-*.html` is
  `good.html` plus exactly one seeded defect, named in its `<title>` and in a comment:
  11 px text, a 40 px target, a 335 px block that overflows at 320, text on a gradient below
  4.5:1, an animation that runs under reduced motion, an unlabeled demo count, share links built
  from localhost and `location.origin`, and a request to a host that is not allowlisted.
  Defect pages carry `data-es="skip"` so they don't also fail the Spanish-twin gate.
  `targets.json` adds a position and height target for `good.html` and the scenarios below.
  Newer checks: `sampled.html` passes with a marker swipe under h1 words, a caption over a sticker
  button's SVG, a colour that fades in after load and a card whose background lags the theme switch
  (qa.js must pixel-sample the first two and let the last two settle); `states.html` passes with a
  bottom bar that shows only after a scroll (about 15% of the screen), an invite landing built from
  block elements (B20 must read "Kira invited you to Trivia night") and a panel that a scenario opens.
  Seeded defects: `defect-marker.html` (ink on a dark marker, about 2:1), `defect-sticky-bar.html`
  (a bottom bar covering about 35% after a scroll), `defect-scenario.html` (11 px text and a 30 px
  button only once the panel is open), `defect-source-path.html` (JS writes "data/civic.js" into the
  page) and `es/defect-english.html` (JS writes an English sentence into a Spanish page; "My Voter
  Record" and DEMO in a Spanish sentence must stay allowed).
  Round 1 (Nov 10, 2026): `states.html`'s "Show the plan" also opens a reveal `<dialog>` 0.9 s later with 11 px
  fine print inside, so its `panel` scenario passes only because a `dismiss` step closes it (the test re-runs it
  without the step and expects a failure); its `from` scenario loads the page with `query: "?from=Kira"`.
  `defect-fold.html` is `good.html` with a 640 px art block above the hero from 1024 px up: fine at 390 x 664,
  but its hero actions sit below a 1366 x 768 screen, so its `fold` target fails B6 (`good.html` has the same
  target and passes).
- `i18n/`: a small site for `make_es.js` (strings, page copy, partials with `-es` variants).
  `index.html` and `events.html` are fully keyed; `untranslated.html` has one English sentence
  with no `data-t`, so `make_es.js --check untranslated.html` must fail.
- `voice/`: `banned.html` and `data/banned.js` hold every banned term the voice rules know, one per
  line; `clean.html` holds copy that must pass.
