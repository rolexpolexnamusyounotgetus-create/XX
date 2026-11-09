# Core infrastructure (workstream: core)

Logic only, no visual design. Every module is a classic script that attaches itself to `window.YSD`.
Each one works from `file://`, from `python3 -m http.server` and on Netlify or Cloudflare Pages. Each
one survives missing browser APIs: no localStorage (private windows), no IndexedDB, no Web Share, no
clipboard, no canvas, no `fetch`. It also survives missing sibling modules.

There is no chat assistant, LLM call or "ask" endpoint anywhere in core, by design (Kira cut it).
`tests/infra/core.test.js` fails if one shows up in these files.

## Files

| File | What it holds |
|---|---|
| `assets/js/config.js` | `window.YSD_CONFIG` (every swappable value, commented) plus the bootstrap helpers `YSD.cfg`, `YSD.emit`, `YSD.log`, `YSD.debug`, `YSD.root` and the `YSD.track` queue stub |
| `assets/js/store.js` | `YSD.store`, `YSD.db`, `YSD.counters`, `YSD.uid` |
| `data/counters.js` | Demo counter baselines (`YSD_DATA.counters`, flagged `demo: true`: made-up numbers) |
| `assets/js/track.js` | `YSD.track` analytics shim |
| `assets/js/share.js` | `YSD.share`: referral capture, share URLs, Web Share and copy, network links, ActBlue |
| `assets/js/cal.js` | `YSD.cal`: RFC 5545 .ics, plus Google and Outlook links |
| `assets/js/cards.js` | `YSD.cards`: canvas share-card engine, helpers, two placeholder templates |
| `assets/js/members.js` | `YSD.members`: join, refCodes, referral attribution, squads, the submit seam |
| `tests/infra/core.test.js` | Node and Playwright tests |

## Script order

```html
<script src="assets/js/config.js"></script>   <!-- first: config + helpers -->
<script src="assets/js/store.js"></script>    <!-- second -->
<script src="data/counters.js"></script>      <!-- any time before counters are read -->
<script src="assets/js/track.js"></script>    <!-- optional; earlier calls are queued and replayed -->
<script src="assets/js/share.js"></script>    <!-- captures ?ref= and utm_* as soon as it runs -->
<script src="assets/js/cal.js"></script>
<script src="assets/js/cards.js"></script>
<script src="assets/js/members.js"></script>
```

Only `config.js` and then `store.js` must come first. A page can leave out any module it does not
use. Without `store.js`, the modules share one in-memory fallback (`YSD._mem`), so share and members
still see the same member.

## Config (`YSD_CONFIG`)

Override without editing the file: define `window.YSD_CONFIG = {...}` before `config.js` loads, for
example in a `config.local.js` or an inline script. The override is deep-merged key by key.
`''` means "not configured": hide the feature. Secrets never go here.

| Key | Contents |
|---|---|
| `demo` | `true`: all state stays in the browser; no joins, counters or uploads are sent. Demo-only data is flagged `demo: true`. |
| `org` | `name` (Young Democrats of Seminole County), `short` (YDSC), `nickname`, `handle` (`youngsemdems`), `parent`, `county`, `state`, `stateCode`, `ageCap: 39` and `minAge: 14` (YDSC's dues page: 14 to under 40), `dues`, `tagline` (PLACEHOLDER), `timezone`. Set by the lead on Nov 9, 2026; tests check the shape, not these values. |
| `site` | `url` (`''` = use where the files are; set this to the real origin in production), `lang`, `locales`, `defaultLocale`, `title`, `description`, `ogImage`, `uidDomain` (calendar UID domain while `url` is `''`) |
| `social` | `{instagram, tiktok, x, threads, bluesky, facebook, youtube}: {handle, url}`. Handles are PLACEHOLDERS. `url: ''` means do not render a link. |
| `links.vote` | Official voting links, verified on the web (see below) |
| `links` | `actblue` and `dues` (YDSC's public ActBlue pages; the chapter confirms before launch), `countyParty` (semdems.com); `actionNetwork`, `mobilize`, `volunteer`, `contact`: empty placeholders |
| `integrations` | `formEndpoint`, `formEncoding` (`json` or `form`), `formName`, `actionNetwork {endpoint, tags}`, `squadEndpoint`, `countersEndpoint`, `videoUploadEndpoint`, `analytics {provider, plausibleDomain, plausibleSrc, cloudflareToken, endpoint, respectDoNotTrack}` |
| `legal` | `paidFor` (PLACEHOLDER, Fla. Stat. 106.143 wording to come from the party), `privacyEmail`, `smsNumber` and `mailingAddress` (`''` until set; data/legal.js and data/strings.js show a placeholder), `cardFooter` |
| `sharekit` | `confirmed: {}`: launch-kit switches. A data/sharekit.js item with `requires: '<id>'` renders only when `confirmed['<id>'] === true` (e.g. `'soe-2027-requests-open'`) |
| `theme` | Fallback colours and fonts (PLACEHOLDER hexes): `bg fg brand accent pop muted ink paper fontDisplay fontBody` |
| `share` | `utm` defaults, `refParam: 'ref'`, `attributionDays: 30`, `hashtags`, `cleanUrl: false`, `actblueRefcode` |
| `members` | `refCodeStyle` (`name` or `random`; members under 18 always get `random`), `refNameMax`, `refRandom`, `enforceAgeCap`, `countyZips` (`[]` = no check), `keepContactLocally`, `demoSquadMax` |
| `cal` | `prodId`, `defaultDurationMin: 120`, `name` |
| `cards` | `fonts` (CSS font specs to wait for), `demoWatermark` |
| `clips` | Video limits read by clips.js: `maxBytes` (150 MB), `maxDuration` (180 s), `minDuration`, `captionMax`, `tagsMax` |
| `pwa` | Service worker switches read by sw-register.js: `serviceWorker: true`, `serviceWorkerInDemo: false`, `swUrl: 'sw.js'` |
| `features` | `referrals`, `squad`, `cards`, `clips`, `calendar`, `demoSquadGrowth`, `demoLiveCounters` |

### Official voting links (checked Mon Nov 9, 2026)

| Key | URL | Check |
|---|---|---|
| `register` | https://registertovoteflorida.gov/home | The exact link on voteseminole.gov's register page. The site returns 404 to scripts (bot protection), so check it in a real browser. |
| `checkRegistration` | https://registration.dos.fl.gov/CheckVoterStatus | 200, "State of Florida Voter Lookup". dos.fl.gov's old link 301-redirects here. |
| `stateElections` | https://dos.fl.gov/elections/ | 200 |
| `countyElections` | https://voteseminole.gov/ | 200 |
| `countyRegister` | https://voteseminole.gov/voters/register-to-vote/ | 200 |
| `myVoterRecord` | https://voteseminole.gov/voters/my-voter-record/ | 200 |
| `voteByMail` | https://voteseminole.gov/how-to-vote/vote-by-mail/ | 200 |
| `mailBallotRequest` | https://seminole.electionsfl.org/vrservices/mbrs | 200; the "Request Ballot" button on the vote-by-mail page. A JavaScript form: test it in a browser |
| `trackBallot` | https://voteseminole.ballottrax.net/voter/ | 200; TrackMyMailBallot (BallotTrax), linked from the vote-by-mail page. A JavaScript app |
| `electionReady` | https://voteseminole.gov/voters/are-you-election-ready/ | 200, "Are you Election Ready?". Its ID list is the pre-2027 one until the SOE updates it |
| `whatToExpect` | https://voteseminole.gov/how-to-vote/what-to-expect-at-the-polls/ | 200, "What to Expect at the Polls" |
| `stateVoteByMail` | https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/ | 200, Division of Elections; states the request-lifetime rule |
| `pollingPlace` | https://voteseminole.dolphmap.com/ | 200; linked from My Voter Record |
| `earlyVoting` | https://voteseminole.gov/how-to-vote/early-voting/ | 200 |
| `upcomingElections` | https://voteseminole.gov/elections/upcoming-elections/ | 200 |
| `countyPhone` | 407-585-8683 | From voteseminole.gov (407-708-7705 there is the fax) |

### Bootstrap helpers (config.js)

- `YSD.cfg(path, fallback)`: reads a dotted path.
- `YSD.emit(name, detail)`: dispatches a `ysd:<name>` CustomEvent on `document`.
- `YSD.fill(template, vars)`: fills share-text placeholders. `{link}` and `{url}` both get
  `vars.link || vars.url`; any other `{key}` comes from `vars`; a placeholder with no value is left
  as-is. See [README.md](README.md#config-helpers-configjs).
- `YSD.log(...)`: logs only when `YSD.debug` is on.
- `YSD.debug`: true after `?debug=1`; it stays on for the tab session, and `?debug=0` turns it off.
- `YSD.root`: the site root URL with a trailing slash, taken from config.js's own `src`. It is
  correct on `file://`, on localhost and under a sub-path. Resolve asset paths against it.
- `YSD.track`: a queue stub until track.js loads.

## API

### YSD.store (localStorage, in-memory fallback; keys stored as `ysd:<key>`, values JSON)

- `get(key, fallback)`
- `set(key, value) -> value`
- `update(key, fn, fallback) -> next`
- `remove(key)`
- `list(name) -> array`
- `push(name, item, {max: 1000}) -> stored item`. Plain objects get `id` and `ts` when missing.
- `on(key | '*', cb(value, {key, oldValue, source})) -> unsubscribe`. `source` is `'local'`
  (same tab), `'remote'` (another tab, through the `storage` event) or `'adapter'`.
- `keys()` and `clear()`: only this site's `ysd:` keys.
- `useAdapter(adapter) -> Promise`: the production seam (see below).
- Also: `backend` (`'localStorage'` or `'memory'`), `persistent`, `prefix`, `uid(prefix)`.
- On quota overflow, writes stay readable from memory and `ysd:storage-full` fires once.

### YSD.db (IndexedDB `ysd` / `blobs`; every call returns a Promise and never rejects)

- `put(bucket, id, value) -> id`. The value can be a Blob, a File or a cloneable object.
- `get(bucket, id) -> value | null`
- `all(bucket) -> values`, oldest first
- `keys(bucket) -> ids`
- `del(bucket, id) -> true`
- `clear(bucket) -> count`
- `ready() -> 'indexeddb' | 'memory'`

If IndexedDB is missing, blocked or slow to open (4 seconds), the in-memory fallback takes over.
A failed write falls back to memory and emits `ysd:db-fallback`.

### YSD.counters

- `get(name)` and `bump(name, n = 1) -> new value`
- `on(name | '*', cb(value, name)) -> unsubscribe`. It fires for same-tab and other-tab changes and
  also emits `ysd:counter`.
- `all()`, `names()`, `refresh() -> Promise`, `format(n)` (`12500 -> "12.5K"`), `baseline(name)`,
  `isDemo(name)`, `startLive(opts)`, `stopLive()`, `resetDemo()`

How the value is computed: baseline + local bumps + demo live ticks. The baseline is
`YSD_DATA.counters.items[name].base` plus `perDay` growth since `epoch`, in demo only. Demo
baselines read as 0 when `demo` is false, so made-up social proof cannot reach production. With
`countersEndpoint` set and `demo: false`, the server value is used and bumps are POSTed. Live ticks
(demo only, `features.demoLiveCounters`) add 1 every 7 to 22 seconds while the tab is visible, at
most 40 per page view. They are stored under `counter:sim:*`.

Core bumps `members` on a first join, `shares` when `share.native` returns shared or copied, and
`cards` when `cards.share` returns shared or downloaded. Other pages bump `pledges`, `rsvps`,
`volunteers`, `clips` and `letters` themselves.

### YSD.share

- `captureRef() -> {captured, ref, utm}`. Runs automatically when share.js loads. It stores the
  `?ref=` code (case-insensitive, stored upper-case; last touch wins; my own code is ignored) and
  `utm_*` (`utm` holds the last touch, `utm:first` the first, which is never replaced).
- `ref() -> code | null`: the captured code while inside `share.attributionDays`.
- `utm() -> {utm_source, ...}`
- `myCode()`, `normCode(c)`, `root()`
- `url(path, params) -> absolute URL`. Relative and `/` paths resolve against `site.url`, or
  against `YSD.root` when `site.url` is empty. It adds my refCode and the default `share.utm`.
  Empty `path` means the current page, which keeps its own query minus ref, utm, debug and ad click
  ids. In `params`, a value of `null` or `false` removes that param. `ref: false` drops my code,
  `ref: 'X'` uses another code, and `utm: false` drops the default utm tags.
- `native({title, text, url, files, count, channel}) -> 'shared' | 'copied' | 'cancelled' | 'failed'`.
  Uses Web Share; files the browser cannot share are dropped. With no Web Share, or on any error
  other than AbortError, it copies `"text url"` instead. `'failed'` (an addition to the contract)
  means even the copy was refused. **Call it directly inside a click handler**, because browsers
  require a user gesture.
- `copy(text) -> Promise<boolean>`: the Clipboard API, then an `execCommand` fallback.
- `links(text, url, {subject, hashtags, via}) -> {sms, whatsapp, x, threads, bluesky, facebook, email, telegram}`.
  The formats come from each platform's docs, checked 2026-11-09: X `x.com/intent/tweet`, Threads
  `threads.com/intent/post`, Bluesky `bsky.app/intent/compose`.
- `actblue(amount, extra) -> URL`, or `''` when `links.actblue` is empty. `refcode` is
  `ref_<referrer code>`; with `extra.mine` it uses my code instead (for donate links people share);
  with neither, it falls back to `share.actblueRefcode`. `refcode2` is `utm_<source>`. Any other
  `extra` keys become params. Send `express_lane` and `recurring` only when ActBlue has enabled
  them for the account.

### YSD.cal

event = `{id, title, start, end, location, address, description, url, alarm, status, sequence}`

- `start` and `end` are ISO strings with an offset. A string with no offset counts as New York wall
  time.
- `'YYYY-MM-DD'` means an all-day event, and its `end` is the last day, inclusive.
- With no `end`, the event lasts `cal.defaultDurationMin`.
- An invalid `start` makes `text` and `ics` throw a `TypeError`. `google`, `outlook` and
  `dataUrl` return `''` instead, and `download` returns false.

Functions:

- `text(event | events, {name, method, now}) -> string`
- `ics(...) -> Blob` (`text/calendar;charset=utf-8`)
- `dataUrl(event) -> data: URL`
- `download(event, filename) -> boolean` (default file name: `<slug>.ics`)
- `google(event)`: `calendar.google.com/calendar/render?action=TEMPLATE`, UTC dates and `ctz`
- `outlook(event, {office})`: the `outlook.live.com` or `outlook.office.com` deeplink. Microsoft
  does not document this format.
- `links(event) -> {google, outlook, office365, ics}`

ICS details:

- CRLF line endings.
- TEXT escaping of `\ ; , newline`.
- Lines fold at 75 octets without splitting UTF-8 sequences.
- `DTSTART;TZID=America/New_York` with a VTIMEZONE built on the US rules in force since 2007.
- `UID` is `<id>@<domain>`: the `site.url` host when set, else `site.uidDomain`, else the page host. With
  no id, a stable hash of title and start replaces `<id>`.
- `DTSTAMP`, `STATUS`, `SEQUENCE`, and an optional `VALARM`.

### YSD.cards

- `register(name, drawFn(ctx, data, env), {size, fonts})`. `env` holds `{width, height, scale,
  theme, h, canvas, demo, name}`; `scale` is `min(w, h) / 1080`. `drawFn` may return a Promise.
- `render(name, data, {size: 'story' | 'square' | 'wide', width, height, theme, el, fonts}) -> Promise<HTMLCanvasElement>`
- `toBlob(canvas, type, quality) -> Promise<Blob>`
- `share(canvas, {title, text, url, filename, count}) -> 'shared' | 'downloaded' | 'cancelled' | 'failed'`
- `download(canvasOrBlob, filename)`
- `theme(el, overrides)`, `sizes`, `has(name)`, `list()`, `isTainted(img)`

Helpers, available as `YSD.cards.h.*` and directly on `YSD.cards`:

- `roundRect(ctx, x, y, w, h, r, {fill, stroke, lineWidth})`
- `wrapText(ctx, text, x, y, maxWidth, lineHeight, {maxLines, ellipsis, draw}) -> {lines, width, height, truncated}`
- `fitText(ctx, text, maxWidth, {max, min, weight, family, maxLines, lineHeight, maxHeight}) -> {size, font, lines, lineHeight}`
- `font(size, weight, family)`
- `gradient(ctx, x0, y0, x1, y1, stops)`
- `sticker(ctx, text, x, y, {bg, fg, size, rotate, ...})`
- `loadImage(src)`: uses crossOrigin `anonymous`. On `file://`, prefer data: or blob: images,
  because other images taint the canvas.
- `cover(ctx, img, x, y, w, h)`
- `waitForFonts(specs, timeoutMs)`

**Theme from CSS.** For each theme key, the engine reads `--ysd-card-<kebab-key>`, then
`--ysd-<kebab-key>` (for example `--ysd-brand`, `--ysd-font-display`), then the `YSD_CONFIG.theme`
hex. The design team restyles cards from CSS without touching the engine.

**Built-in templates.** `joined` takes `{name, refCode, url, headline, sub, sticker}`. `pledge`
takes `{pledge, name, count, countLabel, headline, sticker}`. Both are neutral PLACEHOLDERS with
placeholder copy; replace them or register new ones under the same names. In demo mode a small
DEMO mark is drawn (`cards.demoWatermark`).

### YSD.members

- `validate(profile) -> {ok, errors, warnings, clean}`
  - Fields: `firstName` (or `name`) is required, plus `email` or `phone`. `zip` is checked as 5 or
    9 digits. `age` or `birthYear` is checked against `minAge` (hard error) and `ageCap` (warning
    only, unless `members.enforceAgeCap`).
  - Phones are normalised to `+1XXXXXXXXXX`.
  - Extra string, number and boolean fields pass through.
- `join(profile) -> member {id, refCode, referredBy, firstName, ..., joinedAt, demo, synced}`
  - Synchronous: the member is stored at once.
  - `member.submitted` is a non-enumerable `Promise<{ok, mode, status?, reason?, fallbackUrl?}>`.
  - Throws an Error with `code: 'YSD_INVALID'` and `.errors` when the profile is invalid, so call
    `validate()` first.
  - Joining again updates the profile and keeps the id and refCode.
  - A filled honeypot (`_hp` or `bot-field`) returns a fake member and stores nothing.
- `current()`, `isMember()`
- `referredBy() -> code | null`: frozen at join; before joining, it returns the captured ref.
- `squad({now}) -> [{id, name, firstName, joinedAt, referredBy, demo, simulated, source}]`. It
  merges three sources: local joins referred by my code, the cached server squad, and (demo only)
  simulated members.
- `refreshSquad() -> Promise<squad>`, `onSquad(cb(squad, added)) -> unsubscribe`
- `submit(member) -> Promise`, `retry()`, `makeRefCode(profile)`, `forget()`, `shareUrl(path, params)`

**RefCodes.** Up to 5 ASCII letters of the first name plus 3 characters, for example `KIRA7QX`.
With the `random` style it is 6 characters, for example `B7KQ2M`. Members under 18 (by `age` or
`birthYear`) always get the random style, whatever `refCodeStyle` says, so a teen's first name
never appears in links they share. The random characters exclude
vowels, so codes cannot spell words, and look-alikes (0/O, 1/I/L).

**Demo squad growth.** Simulated members appear about 45 seconds, 2.5 minutes, 10 minutes, 40
minutes, 2 hours and 6 hours after joining, at most `members.demoSquadMax`. The schedule is
deterministic per refCode. Each simulated member is flagged `{demo: true, simulated: true,
source: 'demo'}` and has a placeholder name; label them in the UI. They never appear when `demo`
is false or when `features.demoSquadGrowth` is off.

### YSD.track(event, props)

- Returns true when the event was sent.
- Demo mode never sends. Every call records to `YSD.track.history()`, emits `ysd:track` and logs
  to the console with `?debug=1`.
- Props are cleaned before sending: primitives only, strings up to 200 characters, at most 30 keys,
  and personal-data keys (email, phone, name, address, zip, age, ...) dropped.
- Do Not Track and Global Privacy Control are respected by default.
- Also: `pageview()`, `enabled()`, `clean(props)`.

Events core sends:

- `ref_captured {ref}`
- `share {result, method, channel}`
- `card_render`
- `card_share {result}`
- `calendar_add {method, id}`
- `join {referred, demo}`
- `join_update`
- `join_submitted {mode}`
- `forget`

## DOM events (on `document`, prefixed `ysd:`)

| Event | Fired when |
|---|---|
| `ref` | A referral code was captured |
| `copied` | Text was copied to the clipboard |
| `share` | `share.native` finished |
| `counter` | A counter changed |
| `joined` | A member joined or updated their profile |
| `member-submitted`, `member-submit-failed` | The network submit finished |
| `squad` | The squad grew: `{squad, added}` |
| `forgot` | `members.forget()` ran |
| `card-rendered`, `card-share`, `card-error` | Card render, share or export events |
| `calendar`, `calendar-error` | An .ics download started or failed |
| `track` | `YSD.track` was called |
| `storage-full`, `store-error`, `db-fallback` | Storage problems |

## Store keys

- `member`
- `joins` (local join log)
- `squad:remote`
- `ref`, `utm`, `utm:first`
- `counter:<name>`, `counter:sim:<name>`, `counter:remote:<name>`, `counter:pending:<name>`

Do not reuse these names for anything else.

## Production seam (going live)

1. Set `demo: false` and `site.url: 'https://<real domain>'`. Share URLs, calendar UIDs and the
   ActBlue refcode then follow the real domain; no code changes are needed.
2. **Joins.** Do one of the following:
   - Set `integrations.formEndpoint`. It receives a POST of JSON `{id, refCode, referredBy,
     firstName, lastName, email, phone, zip, age, interests, emailOptIn, smsOptIn, joinedAt,
     source, utm_*, ...extra form fields}`. With `formEncoding: 'form'` it is urlencoded instead,
     with `form-name`, which suits Netlify Forms; Netlify also needs a static `<form name="join">`
     in the HTML at deploy time.
   - Or set `integrations.actionNetwork.endpoint` to your serverless proxy. The proxy adds the
     `OSDI-API-Token` header from a server env var and forwards the body (person signup helper,
     with `custom_fields.ysd_ref_code` and `ysd_referred_by`, plus `add_tags`) to
     `https://actionnetwork.org/api/v2/people/`.
   Either way, a 2xx response marks the member synced and drops email, phone and ZIP from the
   browser copy (unless `members.keepContactLocally`). A JSON reply `{refCode, id}` replaces the
   local refCode, so the server can guarantee uniqueness. Failed submits stay unsynced and are
   retried on the next page load and on the `online` event. No proxy function exists yet; core
   does not own `functions/`.
3. **Squads.** `integrations.squadEndpoint`: `GET ?ref=CODE -> {squad: [{id, name, joinedAt}]}`.
   Return first name and last initial only.
4. **Counters.** `integrations.countersEndpoint`: `GET -> {name: number}`, and
   `POST {name, n} -> {name: number}`.
5. **Synced key/value state.** `YSD.store.useAdapter({load, save, remove, subscribe, match})`. The
   synchronous API keeps working on the local cache while the adapter mirrors it.
6. **Analytics.** `integrations.analytics.provider` is one of:
   - `plausible`: `plausibleDomain`, `plausibleSrc`
   - `cloudflare`: `cloudflareToken` (page views only)
   - `custom`: `endpoint`, which receives a POST of `{event, props, ts, path, ref}` as text/plain
     JSON through `sendBeacon`

   The CSP must allow the chosen script host.
7. Replace `legal.paidFor` with the party's wording before launch, and set `legal.privacyEmail`.

## How to test

```sh
node tests/infra/core.test.js          # Node sandbox + headless Chromium (Playwright), about 2 seconds
node tests/infra/core.test.js --node   # Node only
```

The Node part runs every module in a `vm` sandbox with no DOM. It covers:

- config schema and merge; store, db and counters on their memory backends
- ICS shape: CRLF, folding at 75 octets with UTF-8 safety, escaping, VTIMEZONE, UID, DST
  conversion; New York offsets compared with `Intl` for every hour of 2026 to 2030
- Google and Outlook links; share URLs, links and ActBlue; members validation, refCodes and the
  squad simulation
- the production submit seam against a fake `fetch` (form, urlencoded, Action Network, failure,
  nothing configured)
- track privacy and DNT; each module loading alone; a scan for assistant or LLM code

The browser part starts a throwaway HTTP server on 127.0.0.1 and covers:

- ref capture, localStorage and IndexedDB (Blob round-trip), counters, cross-tab `on()`
- join and attribution; Web Share success, cancel and NotAllowed fallback; the clipboard
- .ics and card downloads; card rendering with CSS-variable theming; `toBlob`
- simulated squad growth and live counters under Playwright's fake clock
- a simulated private window (storage throws, no IndexedDB), quota overflow and `?debug=1` logging
- a full run over `file://`
- no page errors and no external requests in demo mode

The suite exits 1 on any failure.
