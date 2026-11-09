# Infra index and API cheat-sheet

This page is for the people building pages. It lists every infrastructure module, the order to load
them in, and the calls you will actually use. Full details are in each workstream's doc:
[core.md](core.md) (config, store, share, cal, cards, members, track), [video.md](video.md) (clips,
feed, upload functions) and [tooling.md](tooling.md) (deploy files, service worker, checks).

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
await YSD.cards.share(canvas, {title, text, url, filename})  // 'shared'|'downloaded'|'cancelled'|'failed'
await YSD.cards.toBlob(canvas)   YSD.cards.download(canvas, 'card.png')   YSD.cards.sizes
// helpers (also on YSD.cards.h): roundRect, wrapText, fitText, font, gradient, sticker,
// loadImage (crossOrigin), cover, waitForFonts
```

Theme: each key reads `--ysd-card-<key>`, then `--ysd-<key>`, then `YSD_CONFIG.theme`. The keys are
`bg fg brand accent pop muted ink paper font-display font-body`. The built-in `joined` and `pledge`
templates are placeholders: register your own under the same names.

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

## DOM events (all on `document`, prefixed `ysd:`)

| From | Events |
|---|---|
| share | `ref`, `copied`, `share` |
| store | `counter`, `storage-full`, `store-error`, `db-fallback` |
| members | `joined`, `member-submitted`, `member-submit-failed`, `squad`, `forgot` |
| cards | `card-rendered`, `card-share`, `card-error` |
| cal | `calendar`, `calendar-error` |
| track | `track` |
| clips | `clip-added`, `clip-rejected`, `clip-removed`, `clip-liked`, `clip-view`, `clip-not-persisted`, `clip-upload-start`, `clip-upload-progress`, `clip-uploaded`, `clip-upload-failed`, `clip-ready`, `clips-changed` |
| feed (bubble from the container) | `feed-change`, `feed-play`, `feed-pause`, `feed-mute`, `feed-like`, `feed-view`, `feed-ended`, `feed-error`, `feed-autoplay-blocked` |
| sw | `sw-registered`, `sw-disabled`, `sw-error`, `sw-update-ready`, `sw-controller`, `network` |

## Storage names already taken

- **localStorage** (prefix `ysd:`): `member`, `joins`, `squad:remote`, `ref`, `utm`, `utm:first`,
  `counter:*`, `clips:local`, `clips:liked`, `clips:views`, `clips:hidden`.
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
