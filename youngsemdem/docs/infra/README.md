# Infra index and API cheat-sheet

This page is for the people building pages. It lists every infrastructure module, the order to load
them in, and the calls you will actually use. Full details are in each workstream's doc:
[core.md](core.md) (config, store, share, cal, cards, members, track), [video.md](video.md) (clips,
feed, upload functions) and [tooling.md](tooling.md) (deploy files, service worker, checks). The shared
page modules and every contract the round-1 groups exported (Tue, Nov 10, 2026) are in
[Round 1 contracts](#round-1-contracts-tue-nov-10-2026) below.

All of it is logic with no visual design. Modules emit `ysd:*` DOM events and read colours from CSS
custom properties, so the design team styles everything from CSS. The site has no chat assistant,
no LLM call and no "ask" endpoint (Kira cut it), and the test suites fail if one appears.

## Modules

| File | Global | What it does | Doc |
|---|---|---|---|
| `assets/js/config.js` | `YSD_CONFIG`, `YSD.cfg/emit/fill/log/debug/root/track` (queue stub) | Every swappable value, plus bootstrap helpers | core |
| `assets/js/store.js` | `YSD.store`, `YSD.db`, `YSD.counters`, `YSD.uid` | localStorage key/value store, IndexedDB blob store, social-proof counters | core |
| `data/counters.js` | `YSD_DATA.counters` | Demo counter baselines (made-up numbers, flagged `demo: true`) | core |
| `assets/js/share.js` | `YSD.share` | `?ref=`/`utm_*` capture, share URLs, Web Share with copy fallback, network links, ActBlue | core |
| `assets/js/cal.js` | `YSD.cal` | `.ics` files, Google and Outlook links | core |
| `assets/js/cards.js` | `YSD.cards` | Canvas share cards (story 1080x1920, square 1080x1080, wide 1200x630) | core |
| `assets/js/members.js` | `YSD.members` | Join, refCodes, referral attribution, squads, submit seam | core |
| `assets/js/track.js` | `YSD.track` | Analytics shim (never sends in demo) | core |
| `data/clips.js` | `YSD_DATA.clips` | Six demo clips (generated; flagged `demo: true`) | video |
| `assets/js/clips.js` | `YSD.clips` | Member video clips: validate, probe, store, list, like, upload seam | video |
| `assets/js/feed.js` | `YSD.feed` | Headless vertical video feed for any markup with `data-feed-*` attributes | video |
| `assets/js/sw-register.js` | `YSD.sw` | Service worker registration (off on `file://` and in demo) | tooling |
| `functions/api/video-upload.js`, `netlify/functions/video-upload.js` | (server) | Direct-upload tickets for Cloudflare Stream or Mux | video |

## Load order

Paste this at the end of `<body>`, and drop any line a page does not need. `config.js` must come
first and `store.js` second. Every other module tolerates the others being missing. Load
`store.js` on every page that uses clips, so that all pages store clip files in the same IndexedDB
database.

```html
<script src="assets/js/config.js"></script>
<script src="assets/js/store.js"></script>
<script src="data/counters.js"></script>
<script src="assets/js/share.js"></script>      <!-- captures ?ref= as soon as it runs -->
<script src="assets/js/cal.js"></script>
<script src="assets/js/cards.js"></script>
<script src="assets/js/members.js"></script>
<script src="assets/js/track.js"></script>      <!-- replays calls queued before it loaded -->
<script src="data/clips.js"></script>
<script src="assets/js/clips.js"></script>
<script src="assets/js/feed.js"></script>
<script src="assets/js/sw-register.js"></script>
<script src="assets/js/<your-page>.js"></script> <!-- page code: a file, never inline -->
```

`tests/infra/fixtures/integration.html` loads exactly this stack, and `tests/infra/integration.test.js`
checks it under the production CSP and from `file://`.

## Rules for page code

- **Static and portable.** Use classic scripts only (no ES modules) and never `fetch()` local JSON.
  Data lives in `data/*.js`. Pages must work from `file://`, `python3 -m http.server`, Netlify and
  Cloudflare Pages.
- **No inline `<script>`.** The CSP is `script-src 'self'`. Inline styles are allowed. A new
  external host (fonts, analytics, a player) goes through `tools/csp.js`.
- **Paths.** Resolve site-relative paths against `YSD.root`, which ends in `/`. It works on `file://`,
  in sub-folders and on sub-path deploys. `YSD.share.url()` already does this.
- **`''` means not configured.** Hide the feature. This covers `social.*.url`, `links.mobilize`,
  `links.actionNetwork` and `legal.privacyEmail`, and also `share.actblue()` returning `''`.
- **User gestures.** Call `YSD.share.native()` and `YSD.cards.share()` straight from the click
  handler, and render the card before the click. Browsers block both without a fresh gesture.
- **Untrusted text.** Clip captions, handles and tags, member names, and anything from the URL go
  in with `textContent`, never `innerHTML`.
- **Demo honesty.** Demo data is flagged `demo: true`. Label simulated squad members
  (`simulated: true`) and demo clips (`demo: true`) in the UI. `YSD.counters.isDemo(name)` tells you
  when a number is made up.
- **Counters pages bump.** Core bumps `members` (on join), `shares` (on `share.native`) and `cards`
  (on `cards.share`). Pages bump `pledges`, `rsvps`, `volunteers`, `letters`, and `clips` after
  `YSD.clips.add()` resolves.
- **Pages tooling expects** (`tools/check_site.js`): `404.html`, `offline.html`, a favicon and
  `assets/icons/icon-192.png`, `icon-512.png` and `icon-maskable-512.png`. If joins use Netlify
  Forms, a static `<form name="join">` must exist in the deployed HTML.

## Cheat-sheet

### Config helpers (config.js)

```js
YSD.cfg('integrations.formEndpoint', '')   // dotted read with fallback
YSD.emit('name', detail)                    // CustomEvent 'ysd:name' on document
YSD.fill(template, vars)                    // fill share-text placeholders (below)
YSD.root                                    // site root URL, trailing slash
YSD.debug / YSD.log(...)                    // ?debug=1 turns logging on for the tab
```

`YSD.fill(template, vars)` fills the `{placeholders}` in data-file copy. `{link}` is the canonical
name for the share link; `{url}` (still used by `data/civic.js`, `events.js`, `levels.js` and
`sharekit.js`) gets the same value, `vars.link || vars.url`. Every other `{key}` comes from `vars`.
A placeholder with no value (`undefined` or `null`) stays in the text, so you can spot an unfilled
template and skip it. It returns plain text: render it with `textContent`.

```js
const link = YSD.share.url('vote.html#renew-mail-ballot');
YSD.fill(badge.share.text[lang], { link });              // '... Set yours: https://…?ref=KIRA7QX'
YSD.fill(strings['share.pledge.sms'][lang], { link });   // {link} templates work the same way
YSD.fill(levels.labels.toNext[lang], { n: 40, level: 'Sprout' });
```

Config blocks: `demo`, `org`, `site`, `social`, `links` (`links.vote.*` are verified official
voting links), `integrations`, `legal`, `sharekit` (`confirmed` launch-kit switches), `theme`,
`share`, `members`, `cal`, `cards`, `clips`, `pwa`, `features`. To override, set `window.YSD_CONFIG = {...}` in a file loaded before `config.js`
(it is deep-merged).

### YSD.store, YSD.db, YSD.counters (store.js)

```js
YSD.store.get(key, fallback)        YSD.store.set(key, value) -> value
YSD.store.update(key, fn, fb) -> v  YSD.store.remove(key)
YSD.store.list(name) -> []          YSD.store.push(name, item, {max}) -> item (+id, ts)
YSD.store.on(key | '*', (value, {key, oldValue, source: 'local'|'remote'|'adapter'}) => {}) -> off
YSD.store.keys()  .clear()  .backend ('localStorage'|'memory')  .useAdapter({load, save, remove, subscribe, match})

await YSD.db.put(bucket, id, blobOrObject)   await YSD.db.get(bucket, id) -> value | null
await YSD.db.all(bucket) -> [values]         await YSD.db.del(bucket, id)
await YSD.db.keys(bucket)  .clear(bucket)    await YSD.db.ready() -> 'indexeddb' | 'memory'

YSD.counters.get(name)   YSD.counters.bump(name, n = 1) -> new value
YSD.counters.on(name | '*', (value, name) => {}) -> off
YSD.counters.format(12500) -> '12.5K'   .isDemo(name)   .all()   .refresh() -> Promise
```

### YSD.share (share.js)

```js
YSD.share.ref()                 // referral code that brought this visitor (30-day window), or null
YSD.share.utm()                 // {utm_source, ...} of the last visit with tags
YSD.share.url('join.html', {utm_medium: 'sms'})   // absolute URL with MY refCode + default utm
YSD.share.url()                 // this page, own query kept, ref/utm/click ids dropped
YSD.share.url(path, {ref: false, utm: false})     // plain link
// adults' links also carry from=<FirstName> (members.setShareName(false) or {from: false} turns it off;
// never for members under 18). YSD.share.from() -> 'Sam' | ''
await YSD.share.native({title, text, url, files}) // 'shared' | 'copied' | 'cancelled' | 'failed'
await YSD.share.copy(text) -> boolean
YSD.share.links(text, url, {subject, hashtags, via})
  // -> {sms, whatsapp, x, threads, bluesky, facebook, email, telegram}
YSD.share.actblue(25)           // ActBlue URL, refcode=ref_<referrer>, refcode2=utm_<source>; '' if unset
YSD.share.actblue(25, {mine: true})               // credit MY code (for donate links people share)
```

### YSD.members (members.js)

```js
const v = YSD.members.validate({firstName, lastName, email, phone, zip, age, interests, emailOptIn, smsOptIn});
// v = {ok, errors: {field: 'required'|'invalid'|'too_young'|...}, warnings, clean}
const me = YSD.members.join(profile);  // sync; {id, refCode: 'KIRA7QX', referredBy, joinedAt, demo, ...}
await me.submitted;                    // {ok, mode: 'demo'|'form'|'actionnetwork'|'none', ...}
YSD.members.current()  .isMember()  .referredBy()
YSD.members.squad() -> [{id, name, firstName, joinedAt, demo, simulated, source}]
YSD.members.onSquad((squad, added) => {}) -> off      YSD.members.forget()
YSD.members.reset() -> archived entry   // "Not Sam? Start over": keeps the join log, clears ref, stickers, streak,
                                        // RSVPs and rsvp:last, re-captures ?ref (round 1, journeys-06)
YSD.members.archived()  .resume(id)     // "Back to Sam" on the same device (one-device squad demo)
YSD.members.shareName() .setShareName(on) .shareParams() -> {ref, from}
```

`join()` throws an Error with `code: 'YSD_INVALID'` and `.errors` when the profile is invalid, so
call `validate()` first. Members under 18 (by `age` or `birthYear`) always get a random-style
refCode such as `B7KQ2M`, whatever `members.refCodeStyle` says, so a teen's first name never
appears in links they share. A filled honeypot field (`_hp` or `bot-field`) returns a fake member and
stores nothing.

### YSD.cal (cal.js)

```js
const ev = {id, title, start: '2026-11-14T10:00:00-05:00', end, location, address, description, url, alarm};
YSD.cal.download(ev)        // saves <slug>.ics; true when started
YSD.cal.google(ev)          // Google Calendar URL       YSD.cal.outlook(ev, {office: true})
YSD.cal.links(ev)           // {google, outlook, office365, ics (data: URL)}
YSD.cal.ics(ev) -> Blob     YSD.cal.text(ev | [evs]) -> RFC 5545 text (CRLF, folded, escaped)
```

`'YYYY-MM-DD'` makes an all-day event (its `end` is the last day, inclusive). A time with no offset
is read as New York time.

### YSD.cards (cards.js)

```js
YSD.cards.register('my-card', (ctx, data, env) => { /* env: {width, height, scale, theme, h} */ }, {size: 'story'});
const canvas = await YSD.cards.render('joined', {name, refCode, url}, {size: 'story'});  // or {width, height}
// a template that draws its own DEMO mark: register(name, draw, {demoMark: false}) or render(..., {demoMark: false})
await YSD.cards.share(canvas, {title, text, url, filename})  // 'shared'|'downloaded'|'cancelled'|'failed'
await YSD.cards.toBlob(canvas)   YSD.cards.download(canvas, 'card.png')   YSD.cards.sizes
// helpers (also on YSD.cards.h): roundRect, wrapText, fitText, font, gradient, sticker,
// loadImage (crossOrigin), cover, waitForFonts
```

Theme: each key reads `--ysd-card-<key>`, then `--ysd-<key>`, then `YSD_CONFIG.theme`. The keys are
`bg fg brand accent pop muted ink paper font-display font-body`. The built-in `joined` and `pledge`
templates are placeholders: register your own under the same names.

Brand (round 1, genz-brand-20): `YSD.cards.brand.mark(ctx, x, y, size, {body, ink, edge, mono})`,
`.word(ctx, x, y, height, {fill, swoosh}) -> width`, `.lockup(ctx, x, y, height, {mark, word}) -> width` and
`.paths` draw the Saved Seat ticket and the lettered wordmark with Path2D (no fonts, no images). Card
templates use these instead of drawing their own "YD" bubble. `tools/make_brand.js` builds the icons, the
brand SVG files and the default OG image from the same paths.

### YSD.track (track.js)

```js
YSD.track('pledge_taken', {issue: 'transit'})   // false in demo; logs with ?debug=1
YSD.track.history()   .enabled()   .pageview()
```

Personal-data keys (email, phone, name, zip, age and the like) are dropped, and Do Not Track and
GPC are respected.

### YSD.clips (clips.js)

```js
const v = YSD.clips.validate(file)            // sync {ok, reason (user-facing copy), code}
const clip = await YSD.clips.add(file, {caption, author, tags})  // rejects Error{code, result}
// moderation (video.md): {captionsConfirmed, containsMinors: 'yes'|'no', guardianRequired, guardianContact, consents: ['rights','people','rules']}
// the guardian contact is never stored; production sends it once in the create request
const clips = await YSD.clips.list({sort: 'new'|'top'|'trending'|'views'|'oldest', tag, mine, limit})
await YSD.clips.get(id)    await YSD.clips.remove(id)    // demo/remote clips are hidden, not deleted
YSD.clips.like(id) -> {id, liked, likes, views}          // sync; also unlike, toggleLike, liked(id)
YSD.clips.onChange(cb) -> off        YSD.clips.messages  // editable copy keyed by result code
```

A clip has `id, source ('demo'|'remote'|'local'), demo, mine, src, poster, caption, author
{handle, name}, tags, likes, liked, views, duration, orientation, status, createdAt`. Local clips
play from `blob:` URLs that clips.js creates and revokes itself.

### YSD.feed (feed.js)

```html
<div id="feed">                                   <!-- scroll box (or the page scrolls) -->
  <article data-feed-item data-clip-id="ID">
    <video data-src="assets/video/x.mp4" data-poster="assets/video/x.jpg"></video>
    <button data-feed-like>Like <span data-feed-likes></span></button>
    <button data-feed-mute>Sound</button>        <!-- also data-feed-play, data-feed-views, data-feed-progress -->
  </article>
</div>
```

```js
const feed = YSD.feed.attach('#feed', {autoplay: 'auto', preload: 1});
feed.index  feed.muted  feed.next()  feed.prev()  feed.goTo(i)  feed.toggleMute()  feed.destroy()
document.addEventListener('ysd:feed-like', (e) => heartBurst(e.detail.x, e.detail.y));
YSD.feed.mount('#feed', clips)   // optional minimal renderer + marked fallback CSS (design replaces it)
```

The feed writes its state back as attributes for CSS: `data-feed-active`, `data-feed-state`,
`data-feed-muted`, `data-feed-autoplay` and `--ysd-feed-progress`. Keys are arrows, j/k, Space and
m. A double tap likes. It never autoplays under reduced motion or Save-Data.

### YSD.sw (sw-register.js)

`YSD.sw.status` is one of `'file' | 'disabled' | 'registering' | 'registered' | ...`. The object
also has `enabled()`, `register()`, `unregister()`, `update()` and `applyUpdate()`. Listen for
`ysd:sw-update-ready` to show a "refresh" prompt.

## Round 1 contracts (Tue, Nov 10, 2026)

Every contract the round-1 groups exported, read from the code on Tue, Nov 10, 2026. The header comment of each
file is the full contract; this is the cheat-sheet. Guard optional modules (`if (YSD.maker && YSD.maker.mountQuick)`,
`YSD.cards.has('going')`) so a page still works when a file is missing.

### Shared page modules

| File | Global | Owner | Load after |
|---|---|---|---|
| `assets/js/ui.js` | `YSD.t`, `YSD.fmt`, `YSD.ui` | G-CORE | the scripts partial loads it (after the infra stack and `data/slices/core.js`) |
| `assets/js/eventcard.js` | `YSD.events` | G-EVENTS | core stack + `data/events.js` or `data/slices/events.js` |
| `assets/js/rsvp.js` (+ `assets/css/rsvp.css`) | `YSD.rsvp`, `YSD.invite` | G-EVENTS | eventcard.js and the events data |
| `assets/js/cards-brand.js` | `YSD.brandCards` (templates registered on `YSD.cards`) | G-GROWTH | cards.js, ui.js; `data/slices/growth.js` for copy |
| `assets/js/maker.js` (+ `assets/css/maker.css`) | `YSD.maker` | G-GROWTH | cards-brand.js |
| `assets/js/membercard.js` | `YSD.memberCard` (alias `YSD.membercard`), `YSD.stickers`, `YSD.streak`, `YSD.squadMeter`, `YSD.rewind` | G-GROWTH | core stack + growth slice + `data/stickers.js` |
| `assets/js/reel.js` (loads `assets/css/reel.css` itself) | `YSD.reel` | G-VIDEO | core stack, `data/clips.js`, `assets/js/clips.js` |
| `assets/js/joinform.js` | `YSD.joinForm` | G-JOIN | core stack (members, ui); `data/pages/join.js` for step two picks |

| Contract | Where | Who uses it |
|---|---|---|
| Colour worlds and the hero system | `components.css`, `tokens.css` | every page (worlds table below) |
| `YSD.ui.toast(text, {tone, timeout, priority, replace})` | ui.js | maker, membercard, rsvp, every copy or share result |
| `YSD.ui.reveal({...})` | ui.js | membercard (sticker unlocks), styleguide |
| `YSD.ui.landing({force})` | ui.js | every page opened with `?ref` or `?from` |
| `YSD.ui.jump(el \| '#id', {focus, scroll, smooth})` | ui.js | every same-page link, home's hero buttons, events, joinform's `#more` |
| `YSD.share.url(path, params)` adds `from` | share.js | every share link |
| `YSD.members.reset(opts)` / `.archived()` / `.resume(id)` | members.js | join ("Not Sam? Start over", "Back to Sam") |
| `YSD.cards.brand.mark/word/lockup/paths` | cards.js | every card template, `tools/make_brand.js` |
| `YSD.brandCards` `going`, `laptop`, `character(kind, id)` | cards-brand.js | rsvp (I'm going), 404 (laptop), quiz cards and OG |
| `YSD.maker.mountQuick(el, opts)` | maker.js | home |
| `YSD.membercard.rulesPanel(el, opts)` | membercard.js | join, home |
| `YSD.reel.mount(el, opts)` / `.card(clip, opts)` / `.series(id)` | reel.js | home strip, clips feed |
| `YSD.rsvp.open(eventId, opts)` and `rsvp:last` | rsvp.js | join (`?e=` opens the sheet; joinform prefills from `rsvp:last`); the sheet itself on events, event pages and home |
| `YSD.joinForm.mount(form, opts)` and `.urlIntent()` | joinform.js | join, newsletter, home |
| `YSD.events.series/seriesList/tentpole/renderTentpole/isTeen` | eventcard.js | events, event pages, home, join, rsvp.js, the invite card |

### Colour worlds and the hero system (CSS, G-CORE)

```html
<section class="section section--tangerine hero hero--split edge--zigzag" aria-labelledby="x-title">
  <div class="wrap hero__grid">
    <div class="hero__copy">
      <p class="hero__pill">Chapter in a box</p>
      <h1 class="hero__title" id="x-title">Host a night.</h1>
      <p class="hero__sub">…</p>
      <div class="hero__actions"><a class="btn btn--primary btn--lg" href="#">…</a> <a class="btn btn--ghost" href="#">…</a></div>
      <p class="hero__fine">…</p>
    </div>
    <div class="hero__object">the page's own object: .fan (ticket stack), .device > .device__screen, a card, the laptop</div>
  </div>
</section>
```

- **Worlds:** `.section--violet`, `--celery`, `--pink` (= `--bubblegum`), `--sky`, `--lake`, `--sun`, `--mint`,
  `--teal`, `--orange`, `--tangerine`, `--night`, `--cream`. The bright fills and cream are light islands
  (tokens.css): ink text and light cards inside them in both themes, with a night border top and bottom. Night is a
  dark island. Violet and lake take cream text and keep the page theme for the cards inside them.
- **World tokens** on every band: `--world` (the band colour), `--world-pop` (an accent fill that always sits under
  ink text, 6:1 or better), `--world-note` (a few hand-written words: celery on violet, lake and night; violet-deep
  on the bright fills), plus `--link`, `--focus`, `--shadow` and a `--text-muted` picked for 4.5:1 or better.
- **Shapes:** `.hero--split` (copy | object from 900 px), `--flip` (object left), `--center`, `--object-first`
  (object above the copy on phones), `--bleed` (object runs off the right edge), `--compact`, `--poster` (giant type).
- **Edges** (the band's bottom silhouette): `.edge--scallop`, `--zigzag`, `--tilt`, `--arch`.
- **Parts:** `.hero__grid .hero__copy .hero__title .hero__sub .hero__actions .hero__object .hero__pill .hero__note`
  (hand font, never essential) `.hero__fine`; objects `.fan` (a fanned stack of three) and `.device` +
  `.device__screen` (a phone frame). One world, one shape, one edge and the page's own object, so no two first
  screens share a fill or an outline.

| Page | World | Hero object |
|---|---|---|
| Home | violet | the invite and the people photo |
| Events list | celery | the stack of date tickets, tentpole night featured |
| Event pages | each event's colour | the invite art, first on phones |
| Host kit (`host.html`) | tangerine | an open "chapter in a box" |
| Vote | lake | the Dec 31 / Jan 1 deadline tiles |
| Issues | night | the big-number bento |
| Reel (`clips.html`) | night | video first, no hero block |
| Post | sun | a phone-frame preview of your clip |
| Quiz | bubblegum | the type deck |
| Join | sky | the live member card |
| Newsletter | mint | the 7:00 lock screen |
| About | teal | the Real-or-DEMO game and the crew map |
| 404 | orange | the laptop toy |
| Legal pages | cream | none |

### YSD.ui (ui.js, G-CORE)

```js
YSD.ui.toast(text, {tone: 'success'|'info'|'error', timeout, priority: 'high'|'normal'|'low', replace}) -> <p.toast>
  // queued, one at a time. 'high' (share/copy results, errors) interrupts and the interrupted toast comes back;
  // 'low' (sticker notes) waits; replace: true swaps out a same-or-lower toast at once. Toasts fired in the same
  // task come out most important first. With a modal <dialog> open, the toast shows inside it.
YSD.ui.toast.clear()   YSD.ui.toast.pending() -> [texts]
YSD.ui.reveal({sticker | art, title, body, kicker, actions: [{label, href | onClick, primary, close}], closeLabel, ring, civic})
  // -> Promise<'dismiss' | 'action:<i>' | 'toast'>. A centred modal <dialog class="unlock">, at most 2 actions plus
  // "Nice"; Escape or a tap outside closes; queued; static under reduced motion. civic/calm or no <dialog>: a low toast.
YSD.ui.landing({force}) -> <aside.landing> | null   // "Kira sent you this · Join free"; runs on load with ?ref/?from.
  // Off with <body data-landing="custom">, or when rsvp.js fills a [data-invite-landing] box; hidden for your own
  // link and once dismissed (store 'invite:seen:<ref | from-name>').
YSD.ui.jump(el | '#id', {focus, scroll, smooth}) -> the focused element (the target or its first heading) | null
  // opens closed <details> around it, scrolls (respects motion), moves focus; same-page links do it on their own
YSD.ui.topDialog() -> the open modal <dialog> | null
YSD.ui.langHref(lang?, {bare})   // this page in the other language, query and place kept
```

Events: `ysd:reveal {sticker, title}`, `ysd:reveal-close {sticker, result}`, `ysd:landing {ref, from}`.

### YSD.share, YSD.members, YSD.cards.brand (G-CORE)

- `YSD.share.url(path, params)` adds `from=<FirstName>` when the link carries my code and I'm 18 or older with a
  first name; never for minors or an unknown age; off with `{from: false}` or `members.setShareName(false)`.
  `YSD.share.from() -> 'Sam' | ''`. Details: [YSD.share](#ysdshare-sharejs) above and core.md.
- `YSD.members.reset(opts) -> archived entry | null`, `.archived() -> [{id, refCode, firstName, joinedAt,
  archivedAt}]`, `.resume(id) -> member | null`: see [YSD.members](#ysdmembers-membersjs) above.
  `opts.also` adds keys to clear (prefixes like `'quiz:*'` work), `opts.keep` keeps some of the default ones.
- `YSD.cards.brand.mark(ctx, x, y, size, {body, ink, edge, mono})`, `.word(ctx, x, y, height, {fill, swoosh}) ->
  width`, `.lockup(ctx, x, y, height, {mark, word}) -> width`, `.paths`: see [YSD.cards](#ysdcards-cardsjs).

### YSD.brandCards (cards-brand.js, G-GROWTH)

```js
YSD.brandCards.render(name, data, {size: 'portrait' | 'story' | 'square'}) -> Promise<canvas>
  // portrait 1080x1350, story 1080x1920, square 1080x1080; wraps YSD.cards.render. Guard with YSD.cards.has(name).
YSD.brandCards.render('going', {first, eventTitle, when, place, link, colorToken, lang, demo, sticker}, {size: 'story'})
  // "I'm going" story card (story or portrait). first '' for under-18s or unknown; colorToken 'sky' | '--sky' |
  // 'var(--sky)' | 'issue-sky' (violet fallback); demo: false only for a real event.
YSD.brandCards.render('laptop', {stickers: [{id, x, y, r, size}], link, total = 10, lang}, {size: 'portrait'})
  // the 404 laptop (portrait or square). x, y: sticker centre on the lid from 0 to 1; r: degrees; size: share of
  // the lid width (default 0.2). Prints "6 of 10 Seminole stickers found".
YSD.brandCards.character(kind, resultId) -> 'show-up/hype-captain' | 'issue/rent' | ''   // art path under
  // assets/img/characters/ ('' = no art); YSD.brandCards.characterSvg(path) -> the SVG string from characters.js
YSD.brandCards.templates  .available(name, now?)  .path(name, data)  .sizes  .world(name)  .marks(canvas)  .copy(key, lang)
```

Every card prints the link, the DEMO mark (while `demo` is on) and the paid-for line. The character set lives in
`assets/img/characters/<kind>/<slug>.svg` and `assets/img/characters/characters.js` (`YSD_DATA.characters`).

### YSD.maker.mountQuick and YSD.membercard.rulesPanel (G-GROWTH)

```js
const q = YSD.maker.mountQuick(el, {templates: ['invite', 'psa-mail', 'cover'], eventId, size: 'portrait', onCustomize(template) {}});
  // -> {el, state, select(template), canvas(), render(), destroy()}. A swipeable row of ready-made 4:5 cards (each
  // at least 320 px wide), one optional first-name field and one Send button; "Customize" calls onCustomize or
  // opens the full maker in a sheet. Out-of-window templates drop out (psa-mail ends Jan 1, 2027); 'join' fills in.
  // Markup .mq, .mq__row, .mq__card[aria-pressed], .mq__controls, root [data-maker-quick]. Needs maker.css.
const r = YSD.membercard.rulesPanel(el, {heading: 'h2' | 'h3', id: 'how-stickers-work', max, href, cta: false, eyebrow: false});
  // -> {el, refresh(), destroy()}. The public "How stickers work": every rule, the 15 stickers (locked until
  // collected), the DEMO perk ladder for organizing only, and "Voting steps never earn stickers or anything else".
  // max: show only the first N stickers plus a link (href, default join.html#how-stickers-work).
YSD.stickers.act(action, {ref, series, city, lang, delay, quiet}) -> [sticker ids collected now]   // organizing
  // actions only (civic ones earn nothing); delay (ms) holds the reveal back (the quiz uses 1800 so the result lands first)
```

### YSD.reel (reel.js, G-VIDEO)

```js
const ctl = YSD.reel.mount(el, {limit: 4, sort: 'new', showPost: true, postHref: 'post.html', moreHref: 'clips.html', series: ''});
  // -> {el, clips, ready: Promise, feed, render(), destroy(), attach()}. Strip cards play only on tap, muted.
YSD.reel.card(clip, {variant: 'strip' | 'feed', index, total, moreHref}) -> <article class="story x-rc" data-reel-card>
YSD.reel.series() -> [{id, name, blurb, cadence, sticker, color}]   YSD.reel.series(id) -> one format | null
YSD.reel.seriesBadge(id, {href, button, cls}) -> <a | button | span class="x-rc__series">
YSD.reel.cues(clip, lang) -> [[start, end, text]]   .transcript(clip, {open}) -> <details class="story__captions">
YSD.reel.captionsOn() / .setCaptions(bool)   // the caption overlay preference, store 'reel:cc' (default on)
YSD.reel.action(clip)  .info(clip)  .more(clip, opener, {feed})  .share(clip)  .prompt(date?)  .whenFeed()  .whenCss()
```

Formats (`data/clips.js` `series`): Seminole in 60, First Time?, Crew Cam, En español, Open Mic. Captions are
the clip's cues in EN and ES, drawn as HTML caption chips over the video in the page language, with the same cues
in `assets/video/<clip>.<lang>.vtt` and in the transcript (nothing burned in). No view or like numbers render.
Events: `ysd:reel-report {id, clip, opener}`, `ysd:reel-rendered {el, count}`, `ysd:reel-controls {id, on}`,
`ysd:reel-how {opener}`.

### YSD.rsvp and rsvp:last (rsvp.js, G-EVENTS)

```js
YSD.rsvp.open(eventId, {opener, status}) -> <dialog> | null   // null for an unknown id: keep your plain link
  // works on any page that loads eventcard.js, rsvp.js, rsvp.css and the events data (data/slices/events.js is
  // enough); join.html?e=<id> calls it. Already in? It opens the success state.
YSD.rsvp.last() -> {firstName, contact, contactType, eventId, ts} | null   // store 'rsvp:last'
YSD.rsvp.state(id)  .set(id, status)  .count(id)  .on(cb)  .submit(payload)  .refresh(id?)  .shareUrl(id)  .shareText(id)
YSD.invite.landing(root?)   // the [data-invite-landing] banner; one slim "Kira invited you" line on event pages
```

`rsvp:last` is saved on every I'm in and waitlist (never the age) for join.html's prefill, and
`YSD.members.reset()` clears it. The sheet asks the age as a free number (skipped when known); under 14 stores
and sends nothing (`ysd:rsvp-too-young`); 14 to 17 derives under18. Success turns the sheet into a ticket and offers
the `going` card. Events: `ysd:rsvp {eventId, record}`, `ysd:rsvp-submitted {eventId, status, mode}`,
`ysd:invite-landing {eventId, ref, from}`.

### YSD.joinForm (joinform.js, G-JOIN)

```js
const c = YSD.joinForm.mount(formEl, {
  compact, step2Inline, step2 /* Element | '#sel' */, headingLevel /* 2 | 3 */, titles: {done, already},
  moreHref: '#more', source: 'join' | 'home' | 'newsletter', card /* Element | null */, cardHref: '#card',
  prefill: true,   // first name and contact from 'rsvp:last' (else the newest 'rsvp:<id>') while nobody has joined
  intent: true,    // read ?intent=host|crew|role|volunteer and &crew=<id>: heading + a pre-ticked "I want to..." box
  onJoined(member, {isNew, compact, resumed}) {}, onSaved(member) {}
});  // -> {form, root, member(), reset(), showStep2(opts), intent()}
YSD.joinForm.urlIntent() -> {intent: 'host' | 'crew' | 'role' | 'volunteer' | '', crew: '<id>' | ''}
YSD.joinForm.parseContact(s)  .parseAge(s)  .mountAll()
```

Every `form[data-join-form]` without `[data-join-manual]` mounts on its own; an empty form gets the standard three
fields. The payload adds `intent` (comma list), `crew`, `crews`, `city`, `interests`, `langPref`, `access`,
`guardianEmail` (14 to 17) and the SMS consent fields. "Not {name}? Start over" calls `YSD.members.reset()`, then
offers "Back to {name}". Events: `ysd:join-form-joined`, `-saved`, `-too-young`, `-reset`, `-step2`.

### YSD.events: series and the tentpole (eventcard.js, G-EVENTS)

```js
YSD.events.series(idOrEvent) -> {id, name, short, recurs, blurb} | null   // page language; recurs carries "(DEMO)"
YSD.events.seriesName(idOrEvent, {short})
YSD.events.seriesList({withDates}) -> [{...series, next: event | null, dates: [event], locked}]   // locked: drop events only
YSD.events.tentpole() -> {id, name, recurs, tagline, eyebrow, next: event | null, editions: [event]}
  // next = the next visible edition by the visitor's clock; eyebrow "This month's big one" / "Next big one"
YSD.events.renderTentpole(event, {level, lang, eager}) -> <article class="tentpole">   // CSS in rsvp.css
YSD.events.isTeen(event)          // true when under-18s need no guardian form: the "Good for under-18s" filter and tag
YSD.events.fillSeats(box, event)  .calLocation(event)  .duoDefs()  .duoMarkup()   // seats bar, .ics LOCATION, two-tone photo map
```

Event data adds `series`, `tentpole: true`, `ages {guardian, min}` and `cover.photo.card: false`; the series and
tentpole definitions live in `data/events.js` (`series{}`, `tentpole{}`), and `data/slices/events.js` carries them.

## DOM events (all on `document`, prefixed `ysd:`)

| From | Events |
|---|---|
| share | `ref`, `copied`, `share` |
| store | `counter`, `storage-full`, `store-error`, `db-fallback` |
| members | `joined`, `member-submitted`, `member-submit-failed`, `squad`, `forgot`, `member-reset`, `member-updated` |
| ui | `toast`, `sheet-open`, `sheet-close`, `menu`, `theme`, `motion`, `sticker-fact`, `reveal`, `reveal-close`, `landing`, `ui-ready` |
| cards | `card-rendered`, `card-share`, `card-error` |
| cal | `calendar`, `calendar-error` |
| track | `track` |
| clips | `clip-added`, `clip-rejected`, `clip-removed`, `clip-liked`, `clip-view`, `clip-not-persisted`, `clip-upload-start`, `clip-upload-progress`, `clip-uploaded`, `clip-upload-failed`, `clip-ready`, `clips-changed` |
| feed (bubble from the container) | `feed-change`, `feed-play`, `feed-pause`, `feed-mute`, `feed-like`, `feed-view`, `feed-ended`, `feed-error`, `feed-autoplay-blocked` |
| sw | `sw-registered`, `sw-disabled`, `sw-error`, `sw-update-ready`, `sw-controller`, `network` |
| rsvp (page module) | `rsvp`, `rsvp-submitted`, `rsvp-too-young`, `invite-landing` |
| maker, membercard | `maker-render`, `maker-share`, `sticker` |
| reel | `reel-report`, `reel-rendered`, `reel-controls`, `reel-how` |
| joinform | `join-form-joined`, `join-form-saved`, `join-form-too-young`, `join-form-reset`, `join-form-step2` |

## Storage names already taken

- **localStorage** (prefix `ysd:`): `member`, `joins`, `squad:remote`, `ref`, `utm`, `utm:first`,
  `counter:*`, `clips:local`, `clips:liked`, `clips:views`, `clips:hidden`, `prefs:theme`, `prefs:motion`,
  `invite:seen:<ref | from-name>` (a dismissed "who sent this" line; rsvp.js and ui.js share it). Cleared by
  `members.reset()`: `stickers`, `streak`, `stickers:log`, `rsvp:<id>`, `rsvp:last`.
- **localStorage, page modules (round 1):** `rsvp:queue` (unsent RSVPs; reset keeps it), `maker:draft` (never
  the name or photo), `reel:cc`, `clips:links`, `quiz:<quizId>:result`, `drop:notify`, `merch:notify`,
  `host:check`, `vote:plan`, `vote:method`, `vote:checklist`.
- **sessionStorage:** `ysd:debug`, `ysd:clip-viewed:*`.
- **IndexedDB:** `ysd` (store `blobs`, buckets `clips` and `clip-posters`). `ysd-clips` is only
  used when a page loads clips.js without store.js.
- **Caches:** `ysd-*` (sw.js).

Choose new key names outside these.

## Going live (one line each; details in the docs)

1. `demo: false` and `site.url: 'https://<domain>'` in config. Demo counters, squads and clips
   then disappear.
2. **Joins:** set `integrations.formEndpoint` or an Action Network proxy endpoint. The proxy is not
   built yet ([core.md](core.md)).
3. **Squads and counters:** `integrations.squadEndpoint` and `countersEndpoint` (not built yet).
4. **Video:** set the provider env vars plus `integrations.videoUploadEndpoint: '/api/video-upload'`.
   Moderation, Turnstile and rate limits are still to do ([video.md](video.md)).
5. **Analytics:** `integrations.analytics`, then `node tools/csp.js --write`.
6. **Party copy and links:** `legal.paidFor`, `legal.privacyEmail`, `legal.smsNumber`,
   `legal.mailingAddress`, social URLs, and confirmed ActBlue/Mobilize links.
7. **Launch gate:** delete the `X-Robots-Tag: noindex` line in `_headers`, then run
   `npm run check:strict` ([tooling.md](tooling.md), `DEPLOY.md`).

## Tests

```sh
node tests/infra/core.test.js         # config, store, share, cal, cards, members, track (Node + Chromium)
node tests/infra/video.test.js        # clips, feed, upload functions, demo media
node tests/infra/tooling.test.js      # deploy files, CSP, sw, partials, sitemap, credits, check_site
node tests/infra/integration.test.js  # every module on one page under the real CSP, plus file://
```

Each suite needs Node 22 and Playwright with Chromium, and exits 1 on any failure.
