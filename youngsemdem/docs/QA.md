# QA, Spanish and launch tooling (W8)

Four tools check every page against the brief, and one card template set makes link previews. They
all run on Node 22 (Playwright with Chromium for the browser parts) and Python 3 for the partial
sync. None of them needs npm packages, and none of them uses AI.

| Tool | What it does | npm |
|---|---|---|
| `tools/make_es.js` | Writes `es/<page>` from the page's `data-t` keys, hreflang both ways; `--check` finds English left | `npm run es` |
| `tools/make_og.js` (+ `tools/og.html`, `assets/js/cards-og.js`) | Renders 1200 x 630 type-only link-preview PNGs from each page's `ysd:og` meta | `npm run og` |
| `tools/qa.js` | Measures every measurable BRIEF 6b check and every BRIEF 0 non-negotiable, scored per page | `npm run qa` |
| `tools/voice_lint.js` (+ `tools/voice_rules.json`) | Voice and brand-safety rules on HTML and `data/*.js` copy | `npm run voice` |
| `tests/site/w8.test.js` | The W8 acceptance tests, on seeded-defect fixtures | `npm run test:site` |

`npm run preflight` runs, in order: `sync:check`, `check` (check_site.js), `qa`, `voice`,
`es -- --check` and `test` (the infra suites).

## What page builders run

After every meaningful change to your page (here `events.html`):

```sh
python3 tools/sync_partials.py events.html          # fill the partial markers
node tools/make_es.js events.html                   # write es/events.html + hreflang in both files
node tools/make_og.js events.html es/events.html    # write assets/img/og/events.png and og/es/events.png
node tools/voice_lint.js events.html es/events.html data/pages/events.js data/events.js
node tools/make_es.js --check events.html           # 0 untranslated, 0 missing Spanish
node tools/qa.js --pages events.html,es/events.html # every GATE passes
node tools/check_site.js --pages events.html
```

Quick loop while styling: `node tools/qa.js --pages events.html --widths 390 --no-axe --no-perf --no-share`
(about 8 s instead of 15 s). Before you hand off, run the full command without those flags. Generated subpages are
checked the same way: `node tools/qa.js --pages events/trivia-county-edition.html,es/events/trivia-county-edition.html`.

Your acceptance bar (BRIEF 10.4): `make_es.js --check` exits 0, `voice_lint.js` reports 0 errors for
your files, `qa.js` exits 0 for your pages in both languages.

## Conventions the tools rely on

- **Every visible string has a key.** `data-t="key"` on a leaf element (no child elements; split a
  sentence with a link into spans). Attributes: `data-t-content`, `data-t-alt`, `data-t-aria-label`,
  `data-t-placeholder`, `data-t-title`, `data-t-value` (any `data-t-<attr>` works). `key` resolves in
  `data/strings.js` `entries`; `page:key` in `data/pages/<page>.js`. `{tokens}` such as `{soePhone}`
  are filled from `assets/js/config.js`; other `{placeholders}` can't be filled in static HTML.
- **No key needed** for text inside `translate="no"`, inside `lang="es"`, made only of numbers and
  punctuation, or made only of names that are the same in both languages (Sanford, Lake Mary, SunRail,
  Young Dems, YDSC, DEMO, Instagram...: the `NEUTRAL` list in `make_es.js`; add more with `--neutral`).
  "Seminole County" is not neutral: it is "el condado de Seminole".
- **A language link** in the page body (`<a href="es/…">`) needs `data-t` (for example `lang.switch`) so
  the Spanish page shows "English" and points back. `make_es.js` flips its `hreflang`/`lang` to `en`.
- **The link-preview card** is declared in the head, next to `og:image`:

  ```html
  <meta property="og:image" content="assets/img/og/events.png">
  <meta name="ysd:og" content='{"template":"og-page","kicker":"THIS MONTH","title":"Free hangouts all over Seminole","accent":"all over Seminole","keys":{"kicker":"events:og.kicker","title":"seo.events.ogTitle","accent":"events:og.accent"}}'>
  ```

  Templates and fields (all text short; the card fits the title in 3 lines):
  - `og-page`: `kicker`, `title`, `accent` (words of the title drawn in celery, or on a marker on light
    fills), `sub`, `color`, `sticker` (an id from `data/stickers.js`; default `calendar`; `null` for none).
  - `og-event`: `title`, `start` (ISO with offset; month, day, weekday and time are formatted in the
    card's language, New York time), or `month`/`day`/`weekday`/`time`; `place`, `meta`, `cta`, `color`, `sticker`.
  - `og-quiz`: `kicker`, `title` (the result), `sub`, `cta` (default "What's yours?").
  - `color`: `violet` (default), `violet-deep`, `night`, `lake` (the serious template: no sticker, no
    tilt), `celery`, `bubblegum`, `pink`, `sky`, `tangerine`, `orange`, `teal`, `lime`, `sun`.
  - Spanish: give `keys` (resolved per language) or an `es` object with the Spanish text. `make_es.js`
    writes the Spanish literal text into the es page's meta and points its `og:image` at `og/es/`.
  Every card has the paid-for line (config `legal.cardFooter`) and a DEMO tag while `demo` is on.
- **Demo numbers** carry the word DEMO beside them: in the element, its parent, or its card
  (`article`, `li`, `.invite`, `.story`, `.stat`, `.pin`, `.ticket`, `.tier`, `.team-card`, `[data-demo-scope]`).
  Mark made-up values with `data-demo` and qa.js checks each one. Real, sourced numbers sit in a
  `.stat` with its source link, or carry `data-real`.
- **Position hooks** for the home targets: `data-qa="mail-ballot"` on the mail-ballot card and
  `data-qa="reel"` on the Reel section (qa.js also tries `.pin--deadline` and `[data-reel]`).
- **Stock photos**: `data-photographer` and `data-source` on the `<img>`, and a visible `.tag--stock`
  within the photo's card.

## make_es.js

```
node tools/make_es.js [--all | page.html ...] [--check] [--no-sync] [--json] [--quiet] [--strict] [--neutral "A,B"] [--root DIR]
```

- Writes `es/<page>`: Spanish text and attributes from the keys; `<html lang="es">`; partial markers
  `@demo-banner`, `@header`, `@footer` switch to their `-es` partials (any partial with a `-es` file
  does), shared ones (`@head`, `@scripts`) stay; then runs `sync_partials.py` on the new pages.
- Relative URLs: links to pages with a Spanish twin stay as written (they now point at the Spanish
  sibling); everything else (assets, data, manifest, styleguide) gets one more `../`. `<base href="/">`
  (404) becomes `<base href="/es/">`. `og:image` moves to `assets/img/og/es/`; `og:locale` swaps.
- hreflang (`en`, `es`, `x-default` = English) goes into both files after `<!-- /@head -->`: absolute
  from config `site.url` when set, otherwise relative. 404, offline and `noindex` pages get none.
- `--all` = every root-level page except `styleguide.html` and pages with `<html data-es="skip">`.
- Writing only rewrites files that changed, so a second run changes nothing. It exits 0 even when it
  finds problems (it prints them); `--check` (or `--strict`) is the gate.
- `--check` exits 1 on: untranslated text, attribute, meta or `ysd:og` text; a key that is missing or
  has no Spanish; `data-t` on an element with children; a placeholder it can't fill; a missing `-es`
  partial; an `es/` page that is missing or stale; stale hreflang. Warnings only: the English text in
  the page differs from the key's English value ("English differs"), which usually means the page or
  the data file drifted.

## make_og.js

```
node tools/make_og.js [page ...| --pages a,b] [--check] [--samples] [--absolutize [--site URL]] [--raw] [--json] [--root DIR]
```

- Finds every page with `ysd:og` (root, `es/`, `events/`, `quiz/`...), renders the card in Chromium with
  the brand fonts through `tools/og.html`, re-encodes it as a 256-colour PNG (brand fills stay exact;
  cards come out around 30 KB) and writes it where `og:image` points. It only writes under
  `assets/img/og/`, never over F0's `default.png`, and only when the bytes change.
- Fails on: unknown template, invalid JSON, a missing title, an unresolvable key, a PNG over 150 KB or
  not 1200 x 630, `og:image:width/height` that disagree, two pages writing one file differently.
- `--samples` renders every template in sample colours to `tools/.cache/og-samples/` for review.
- `--check` renders nothing: every declared image exists, is 1200 x 630 and under 150 KB.
- `--absolutize` is for launch: with `site.url` set (or `--site`), relative `og:image`,
  `twitter:image` and hreflang URLs become absolute in every page. Run it after the last `make_es.js`.

## qa.js

```
node tools/qa.js [--pages a.html,es/a.html | --all] [--widths 320,390,1440] [--themes light,dark] [--no-axe]
  [--no-throttle] [--no-perf] [--no-share] [--targets FILE] [--allow-hosts a,b] [--concurrency N]
  [--max-samples N] [--out FILE] [--json] [--quiet] [--root DIR]
```

It serves the folder with `tools/check_site.js`'s server and `_headers` applied (so the production
CSP is on), blocks service workers, and opens each page in fresh contexts:

| Pass | What it measures |
|---|---|
| 390 light | First view: gzip-6 bytes for text and raw bytes for fonts and images, request count, outside hosts (requests and CSP-blocked attempts), fonts, video downloads. DOM: text under 12 px, targets under 44 px (inline links in sentences excepted; a checkbox counts with its label), overflow, contrast, DEMO labels, live-ticking numbers, view counts, footer and banner, voice rules on the rendered text, English left (es pages), stock-photo tags, skip link, zoom, status region, aria-invalid wiring, page height and positions, full-bleed colour blocks. Then dark (contrast and axe), the `[data-theme="dark"]` toggle, and the first screen at 390 x 664 |
| 320 and 1440 | Overflow, text size, targets, contrast in light and dark; at 1440 also axe, focus rings on the first six Tab stops, and the press state of `.btn--primary` (`:active` forced through DevTools) |
| reduced motion | `prefers-reduced-motion: reduce`: running animations and playing video must be 0 |
| 4g | LCP, CLS (largest session window) and TBT at 170 ms RTT, 9 Mbps (the bench's `4g`) |
| share | `site.url` forced to `https://qa.invalid`; every share link (`sms:`, `mailto:` with a body, WhatsApp, X, Threads, Bluesky, Facebook, Telegram), `data-share-url`, Web Share payload and copied text after clicking each `[data-share]` must not point at localhost, 127.0.0.1, the page's own origin, `file://` or youngsemdems.com. Pages with `[data-invite-landing]` also get `?ref=QATEST7&from=Kira&e=<first data-rsvp>` and must show the landing with "Kira" and capture the ref |

**Contrast.** Text on a flat fill is checked from computed colours (every text node, both themes,
every width). Text on a gradient, an image or overlapping a photo, video or sticker with no solid panel
between is pixel-sampled: qa.js screenshots the text box, hides the text, screenshots again, and
measures the text colour against the background pixels under the glyphs (10th percentile). Up to 30
such elements per width and theme (`--max-samples`).

**Scores.** 2 meets the 6b threshold, 1 present but short of it, 0 failing, "review" when a person has
to judge it (B5, B11 to B15, B17 to B19, B22, B23, B24's personality, B28's kinetic H1, B32, B34 to
B36, B38 to B40, N7), "n/a" when the page has nothing to measure. The table prints "6b measured X/Y":
the points on the items it could measure. Review items still count toward the 80-point bar.

**GATEs** (exit 1 when any scores 0): B1, B2, B6, B8, B30, B31, B33 and the non-negotiables N1 to N6
and N8 to N10:

| ID | Fails when |
|---|---|
| N1 | AI wording on the page ("AI assistant", "chatbot", "Ask the AI") or a request to an LLM API or `/api/ask|chat|assistant|llm` |
| N2 | "40 and under" (and Spanish variants), "Young Sem Dems" or other wrong names |
| N3 | B30 or B33 fails |
| N4 | overflow at any width, text under 12 px, targets under 44 px, axe serious/critical, a contrast failure, or motion under reduced motion |
| N5 | text straight on a gradient or background image, or over a photo/video/sticker with no solid panel and non-uniform pixels under it (a marker swipe under a few words is allowed; B8 checks its contrast) |
| N6 | first view over budget, LCP/CLS/TBT over budget, ES modules, inline `<script>`, or a fetch of local JSON |
| N8 | an English page with no `es/` twin, English left on a Spanish page, or the wrong `lang` |
| N9 | the footer lacks "Paid for by" / "Pagado por", a visible DEMO label or the not-official line; or no visible demo banner |
| N10 | a share payload built from the origin, localhost or a hard-coded domain |
| B1 | over 350 KB (home) or 500 KB, or over 30 requests |
| B2 | 4G LCP over 2.5 s, CLS over 0.05 or TBT over 150 ms (`--no-throttle` measures without the throttle and says so; `--no-perf` skips it and scores "review") |
| B6 | at 390 x 664 there isn't a fully visible `.btn--primary` plus a second, different action, or an overlay covers the screen |
| B8 | any contrast failure, or (home) fewer than 3 saturated full-bleed blocks at 390 |
| B30 | a `[data-demo]` element or a count ("23 going", "120 members") with no DEMO beside it; a view count; a number that changes on its own; no demo banner; a claim to avoid |
| B31 | text under 12 px, targets under 44 px, overflow, axe serious/critical (390 and 1440, light and dark), zoom disabled, no skip link, broken `aria-invalid`; scores 1 for no status region, not exactly one h1, or no visible focus ring |
| B33 | Native imagery words, candidate names, alcohol words (copy or alt text), a stock photo without its visible tag or its credit attributes |

**Targets.** Defaults live in `DEFAULT_TARGETS` at the top of `qa.js` (`es/<page>` uses the English
page's entry). Home: 350 KB, mail-ballot card top at most 1,000 px and Reel top at most 1,688 px at
390, page at most 9,500 px, 3 colour blocks, a people photo in the first 844 px. Every page: 500 KB
and 30 requests. Override or add with `--targets file.json`, same shape:
`{"events.html": {"maxHeight": 7000, "positions": [{"id": "B9", "label": "First invite", "selectors": ["[data-qa=\"first-invite\"]"], "maxTop": 900}]}}`.

**Output.** A scored table per page, then a summary; the full report (every finding with selector and
where it showed up) in `tools/.cache/qa_report.json`. `--quiet` prints only failing rows.
A full page takes about 15 s; `--all` runs two pages at a time (`--concurrency`).

## voice_lint.js

```
node tools/voice_lint.js [files or folders ...] [--json] [--quiet] [--strict] [--only rule,rule] [--rules FILE] [--root DIR]
```

Default targets: every page (root, `es/`, `events/`, `quiz/`), `partials/*.html`, `data/*.js` and
`data/pages/*.js` (not `data/slices/`, not `styleguide.html`). HTML is linted by block (so "Join
<b>the chat</b>" is one phrase), plus `alt`, `aria-label`, `title`, `placeholder`, button `value`,
meta description, og/twitter text and the `ysd:og` text. Data files are linted per `en`/`es` string
with its key path; editor fields (`note`, `source`, `sourceTitles`, `use`, ids, URLs) and lists of words
to avoid (`never`, `avoid`, `banned`...) are skipped. Language comes from `<html lang>`, a `lang`
attribute, or the `en`/`es` key.

Rules are data in `tools/voice_rules.json` (id, severity, the gate it feeds, language, regex patterns,
allow patterns, message, suggestion). `\b` in a pattern is a Unicode word boundary, so accented words
work. Beyond the word rules: more than one "!" per section (data: per string), any "!" in serious copy
(`.band--serious`, `tone: 'serious'|'calm'`), emoji in letters, errors, notices, legal, SEO, serious or
long copy, more than one emoji anywhere, or an emoji that doesn't end its line.

Errors exit 1; warnings ("the base", "hurry", "7pm", "receipts page"...) are for a person to judge.

## Tests

`node tests/site/w8.test.js` (about a minute) copies each fixture to a temp folder and checks:

- `make_es.js` builds the twin (text, attributes, meta, tokens, `../` paths, Spanish sibling links, the
  language link, og:image, ysd:og, og:locale, `-es` partials synced, hreflang both ways), is
  byte-identical on a second run, and `--check` fails on the fixture page with one untranslated
  sentence (naming its line), on a missing Spanish value and on a stale twin;
- `make_og.js` writes 1200 x 630 PNGs under 150 KB for EN and ES (pixel-checked for the violet fill and
  the ink band), writes nothing on a second run, renders all three templates, refuses paths outside
  `assets/img/og/`, and `--absolutize` makes og:image and hreflang absolute;
- `qa.js` passes `good.html` and `es/good.html` on every gate and catches each seeded defect in its own
  page: 11 px text, a 40 px target, a 335 px block that overflows at 320, text on a gradient below
  4.5:1, an animation under reduced motion, an unlabeled demo count, a share link with localhost (and
  one built from `location.origin`) when `site.url` is set, and a request to a host that isn't allowlisted;
- `voice_lint.js` flags every banned term in the EN, ES and data fixtures on its line, every rule fires
  somewhere, skip lists hold, and the brief's approved lines (2.7) pass with 0 errors and 0 warnings;
  it also prints what `data/*.js` still has for owners (`W8_STRICT_DATA=1` makes that a failure).

## Known limits

- Pixel sampling needs the text to be on screen; elements inside closed dialogs or collapsed
  `<details>` are skipped (they are invisible until opened).
- The English detector on Spanish pages is a stopword count: it catches sentences and common UI words
  ("Join free", "Menu"), not single unusual English words. `make_es.js --check` is the exact test.
- The demo-count check knows social-proof nouns (going, members, RSVPs, joined, views, likes...); a
  number in another shape needs `data-demo` to be checked.
- Flows that need real data (RSVP sheet fields, the post flow) are W2's and W4's own tests; qa.js
  scores them "review".
