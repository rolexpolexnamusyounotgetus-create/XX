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
  `targets.json` adds a position and height target for `good.html`.
- `i18n/`: a small site for `make_es.js` (strings, page copy, partials with `-es` variants).
  `index.html` and `events.html` are fully keyed; `untranslated.html` has one English sentence
  with no `data-t`, so `make_es.js --check untranslated.html` must fail.
- `voice/`: `banned.html` and `data/banned.js` hold every banned term the voice rules know, one per
  line; `clean.html` holds copy that must pass.
