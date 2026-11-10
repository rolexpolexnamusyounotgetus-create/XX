# Page builders: quick start

Read `docs/BRIEF.md` §0, §2, §3, §4.0, your §4.x page spec, §6b, §7 and §10 first, then
`docs/research/00-lead-factcheck.md` (its rulings beat the brief). This page is the short version of how
to build a page with the foundation (F0) and the QA tools (W8). Gatekeeper-checked Mon, Nov 9, 2026.

## 1. Start a page

```sh
cp docs/TEMPLATE.html events.html        # then replace every PAGE with your page name
```

- Set `data-page` on `<html>`, `class="p-<page>"` on `<body>`, and the `seo.<key>.*` keys. Key names
  don't always match file names: home `seo.home`, join `seo.join`, events `seo.events`, event pages
  `seo.eventInvite`, vote `seo.vote`, issues `seo.issues`, **clips `seo.feed`**, post `seo.post`, quiz
  `seo.quiz`, quiz results `seo.quizResult`, newsletter `seo.newsletter`, about `seo.about`, privacy
  `seo.privacy`, accessibility `seo.accessibility`, **404 `seo.notFound`**. Teen safety, clip rules and
  conduct have no `seo.*` keys: W7 puts them in `data/pages/legal.js` (`legal:seo.teenSafety.title`...).
- Titles read "Page · Young Democrats of Seminole County" (BRIEF §4.0; the strings now match).
- Your files: `assets/css/pages/<page>.css` (25 KB raw max, every rule under `.p-<page>`),
  `assets/js/pages/<page>.js` (40 KB raw max, classic script), `data/pages/<page>.js` (page copy):

  ```js
  window.YSD_DATA = window.YSD_DATA || {};
  window.YSD_DATA.pages = window.YSD_DATA.pages || {};
  window.YSD_DATA.pages.events = { 'hero.title': { en: '…', es: '…' }, 'og.alt': { en: '…', es: '…' } };
  ```

- Keep the template's head as is: `og:locale` lives in the page (make_es swaps it), and the `ysd:og` meta
  needs `keys` (or an `es` object) for its text, or the Spanish twin fails `--check`. Fields and
  colours: `docs/QA.md` "The link-preview card".
- Never edit between `<!-- @name -->` markers; `sync_partials.py` refills them. No inline `<script>`,
  no `on*=` handlers, no `style=""` except custom properties (`style="--duo: var(--sky)"`).
- Keep `<div data-invite-landing hidden>` only if the page loads W2's `rsvp.js`; without it qa scores
  B20 = 0 (not a gate).
- Links end in `.html` and are relative. A file over 30 KB loads only on pages that render mostly
  from it; never load a full data file and its slice for the same namespace.

## 2. Components: copy markup from `styleguide.html`

Every class below is shown there in light and dark with copy-paste markup. Highlights and gotchas:

| Group | Classes | Watch out |
|---|---|---|
| Layout | `.wrap` `.section` (`--violet --celery --pink`/`--bubblegum --sky --night --cream`, round 1: `--lake --sun --mint --teal --orange --tangerine`) `.band--serious` `.section-head` `.stack` `.cluster` `.grid` `.snap` `.prose` | Bright and cream bands force light colours (light islands), night forces dark; violet and lake keep the page theme. Each world sets `--world`, `--world-pop` (a fill under ink) and `--world-note` (hand-written words). `.band--serious` (+ `data-tone="calm"`): no stickers, emoji, rotation or confetti |
| Heroes (round 1) | `.hero` `.hero__grid` `.hero__copy` `.hero__title` `.hero__sub` `.hero__actions` `.hero__object` `.hero__pill` `.hero__note` `.hero__fine`; shapes `.hero--split --flip --center --object-first --bleed --compact --poster`; edges `.edge--scallop --zigzag --tilt --arch`; objects `.fan` (a fanned stack), `.device` + `.device__screen` (phone frame) | One world + one shape + one edge + your own hero object per page, so no two first screens share a fill or an outline (genz-brand-01; worlds table in docs/reviews/round-1/PLAN.md). Home stays flat violet |
| Atoms | `.btn` (`--primary --violet --ink --ghost --quiet --sm --lg --block --icon --wrap`, `[data-state]`) `.link` `.eyebrow` `.tag` (`--demo --real --new --serious --stock --wrap`; `.tags--wrap` on a container) `.chip` (`.chip__dot` + `style="--dot: …"`) `.seg` `.switch` `.avatar` `.facepile` | One `.btn--primary` + one other action fully visible at 390 x 664 (B6). `.btn` and `.tag` don't wrap unless you opt in (`--wrap`); every `.btn` inside `.form`, `.sheet` and success panels wraps already |
| Forms | `.form` `.form__row` (`--2`, `--3`) `.field` (`__label __hint __error`) `.field--check` `.choice` `.form__summary` `.consent` | Wrap consent text in a `<span>`; at most 3 required fields; no pre-checked boxes |
| Brand | `.brand` `.sticker[data-sticker]` `.word-sticker` | A `<button>` sticker gets a sourced fact; a `<span>` is decorative. Hand-font word stickers stay out of the first screen (keeps first-view fonts under 80 KB) |
| Cards | `.ticket` `.invite` `.pin` (`--deadline --rule --hangout`, civic pins `data-civic`) `.stat` `.tier` `.story` `.bubble` `.step` `.issue` `.team-card` `.notice` | `.story`: the DEMO clip tag goes in `.story__meta` beside the handle, never on the poster (it hides burned-in titles). `.story__captions` (44 px summary) and `.story__report` (44 px link) are core now |
| Overlays, motion | `.sheet` (`<dialog>`) `.toast` `.unlock` (sticker reveal) `.landing` ("who sent this") `.kinetic` `.rotor` `.ticker` `.countdown` `.confetti` `.reveal` (scroll reveal) | Anything that loops past 5 s sits next to a Pause motion button. Toasts and confetti draw above an open sheet on their own |
| Brand (round 1) | `.brand` `.brand__mark` `.brand__word` (inline SVG in the header partial; `#ysd-word` and `#ysd-swoosh` are reusable with `<use>`) | The Saved Seat ticket + lettered wordmark. Canvas: `YSD.cards.brand`. Files: `assets/img/brand/` (`node tools/make_brand.js`) |

Need a shared component changed? Ask the lead (section 6) and meanwhile style an `x-` prefixed class in
your page CSS. State lives in attributes (`aria-pressed`, `data-state`, `hidden`), never `.is-*`; JS
selects `data-*` hooks, never styling classes.

## 3. `ui.js` helpers you'll use

`YSD.t(key, vars)`, `YSD.t.plural(key, n)`, `YSD.lang` · `YSD.fmt.date(iso, {time: true})` → "Thu, Nov 19 ·
7 pm", `YSD.fmt.when(start, end)`, `YSD.fmt.days('2026-12-31')` (New York time) · `YSD.ui.toast(text,
{tone})` (through the one status region) · `YSD.ui.sheet.open(el, {opener})` · `YSD.ui.countdown(el)`
· `YSD.ui.confetti(el)` (no-op under reduced motion, Pause motion and civic or serious content) ·
`YSD.ui.form.errors(form, {field: code})` / `.clear(form)` · `YSD.ui.prettyLink(url)` · `YSD.ui.share()` ·
`YSD.ui.stickers(root)` / `.stickerFacts(root)` · `YSD.ui.ready(fn)`.

Round 1 additions (G-CORE, Nov 10, 2026):

- `YSD.ui.toast(text, {tone, priority, replace})` queues instead of replacing. `priority: 'high'` for share,
  copy and error results (interrupts; the interrupted toast comes back), `'low'` for sticker notes (waits).
  `replace: true` swaps at once (sticker facts). Toasts asked for in the same task come out most important first.
- `YSD.ui.reveal({sticker, title, body, actions: [{label, href | onClick, primary}], ring, civic})` -> Promise:
  the sticker unlock moment (centred, sized to the art, focus-managed, Escape or tap outside closes, static
  under reduced motion, queued). `civic: true` falls back to a toast: nothing celebrates a civic step.
- `YSD.ui.landing()` runs on every page opened with `?ref` or `?from`: "Kira sent you this · Join free".
  Opt out with `<body data-landing="custom">` (quiz results that say "Kira got The Hype Captain") or by
  keeping rsvp.js's `[data-invite-landing]` box (events, home).
- `YSD.ui.jump(el | '#id')` scrolls, opens any closed `<details>` around the target and moves focus to it (or
  its first heading). Same-page links do this on their own; `[data-no-jump]` opts out. Collapsed sections keep
  working anchors (a `#renew-mail-ballot` link opens its disclosure).
- `YSD.ui.langHref()` and the header ES/EN link keep the query and the place on the page.
- `YSD.ui.topDialog()` -> the open modal `<dialog>`.
- Links: `YSD.share.url()` adds `from=<FirstName>` for adult members (journeys-08); `YSD.members.reset()`
  is "Start over" (journeys-06). See `docs/infra/README.md`. Declarative hooks: `[data-share]`,
`[data-countdown]`, `[data-sheet-open]`, `[data-rotor]`, `[data-ticker]`, `[data-sticker]`,
`[data-cfg-href="links.x"]`, `[data-year]`. Infra calls (`YSD.share.url()`, `YSD.cal`, `YSD.cards`,
`YSD.members`, `YSD.store`): `docs/infra/README.md`. Share links always come from `YSD.share.url()`.

## 4. Bilingual text

- **Static HTML:** every visible string sits in a leaf element with `data-t="key"` (`data/strings.js`) or
  `data-t="<page>:key"` (`data/pages/<page>.js`). Attributes: `data-t-content`, `-alt`, `-aria-label`,
  `-placeholder`, `-title`. Split sentences around links into spans. Brand names and numbers get
  `translate="no"`. Write the English text in the page too (make_es warns when it drifts from the key).
- **Spanish page:** never hand-edit `es/<page>.html`; `make_es.js` writes it, swaps in the `-es` partials and
  adds hreflang to both files. `styleguide.html` has no Spanish twin by design.
- **JS-rendered text:** `YSD.t('events:card.going')`, or pick `item.title[YSD.lang]` from bilingual data.
  At runtime only `data/slices/core.js` (a11y, cta, form, error, success, toast, demo, lang, event,
  count, format, footer, tag, brand) and your loaded files exist. Anything else from `data/strings.js`
  (169 KB, never load it whole) goes into a page slice. `[data-share]` reads `share.<page>.sms` and
  `seo.<page>.ogTitle`, so a page with a share button needs them in its slice, and clips uses
  `data-share="feed"`:

  ```sh
  # spec.json anywhere outside the site (your scratchpad); the slice stores it in its own header
  echo '{"name":"events","pick":[{"file":"data/strings.js","ns":"strings","map":"entries",
    "match":["share.events.*","seo.events.ogTitle"],"drop":["note","confidence"]}]}' > "$SCRATCH/events-slice.json"
  node tools/slice_data.js --spec "$SCRATCH/events-slice.json" --out data/slices/events.js   # later: --rerun data/slices/events.js
  ```

  Load it after the `@scripts` marker, before `data/pages/<page>.js`.

## 5. Before you report done (BRIEF §10.4, in this order)

```sh
python3 tools/sync_partials.py PAGE.html
node tools/make_es.js PAGE.html
node tools/make_og.js PAGE.html es/PAGE.html
python3 tools/sync_partials.py --check
node tools/voice_lint.js PAGE.html es/PAGE.html data/pages/PAGE.js <your data files>    # 0 errors
node tools/make_es.js --check PAGE.html                                                 # exit 0
node tools/check_site.js --pages PAGE.html,es/PAGE.html      # 0 errors except links to pages not built yet
node tools/qa.js --pages PAGE.html,es/PAGE.html              # exit 0: every GATE passes (about 15 s a page)
node -e "const {chromium}=require('playwright');(async()=>{const b=await chromium.launch();const p=await b.newPage();const e=[];p.on('console',m=>m.type()==='error'&&e.push(m.text()));p.on('pageerror',x=>e.push(String(x)));for(const f of process.argv.slice(1)){await p.goto('file://'+require('path').resolve(f));await p.waitForTimeout(800)}console.log(e.length?e:'file:// clean');await b.close();process.exit(e.length?1:0)})()" PAGE.html es/PAGE.html
npm test                                                     # infra: see the known failures below
```

Quick loop while styling: `node tools/qa.js --pages PAGE.html --widths 390 --no-axe --no-perf --no-share`.
Then shoot it (`node tools/shoot.js --pages PAGE.html,es/PAGE.html`), look at the contact sheets at 390
and 1440 in both themes, fix, and look again. Home also needs `data-qa="mail-ballot"` and `data-qa="reel"`.
`npm test` also runs the shared UI suite (`tests/infra/ui.test.js`, chained from core.test.js). Brand assets:
`node tools/make_brand.js` (and `--check`).

## 6. The ownership and Lead request rule

- Write only the files BRIEF §10.3 gives your workstream (plus `es/` twins and OG images through the
  tools, and your own `data/slices/<page>.js`). Never edit `assets/js/config.js` or other infra files,
  `data/strings.js`, `data/stickers.js`, the partials, the four core CSS files, `tools/`, `docs/BRIEF.md`
  or `docs/research/`.
- Need a change there? Add it under **"Lead requests"** in your report: the file, the exact change and
  why. Work around it meanwhile (an `x-` class, a page-data string).
- Don't commit or push; the lead does. No AI features of any kind. Every made-up number, person, event
  and clip says DEMO in both languages. No candidate names. Times read "7 pm" (Spanish "7 p. m.").
  Nothing of value for registering, renewing or voting.
