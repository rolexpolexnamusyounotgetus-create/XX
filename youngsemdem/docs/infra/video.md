# Video posting infrastructure (workstream: video)

Logic only, no visual design. Members post short clips; the site shows them in a vertical,
TikTok-style feed. In demo mode (`YSD_CONFIG.demo === true`, the default) everything stays in the
browser: files go to IndexedDB, metadata, likes and views to localStorage. With `demo: false` and an
upload endpoint set, the same calls also upload to Cloudflare Stream or Mux through a serverless
function that holds the token.

There is no chat assistant, LLM call or "ask" endpoint in any of these files (Kira cut it);
`tests/infra/video.test.js` fails if one shows up.

## Files

| File | What it holds |
|---|---|
| `assets/js/clips.js` | `YSD.clips`: validation, probing (duration, size, orientation, poster), storage, list/get/like/view/remove, object URLs, the upload seam |
| `assets/js/feed.js` | `YSD.feed`: headless vertical-feed controller (`attach`) and an optional minimal renderer (`mount`) with a marked fallback CSS block |
| `functions/api/video-upload.js` | Cloudflare Pages Function at `/api/video-upload` (ES module, `onRequest`) |
| `netlify/functions/video-upload.js` | Netlify Function (CommonJS `exports.handler`); `netlify.toml` already rewrites `/api/*` to it |
| `data/clips.js` | `window.YSD_DATA.clips`: the demo clips (flagged `demo: true`), with photo credits and fact sources. Generated; do not hand-edit |
| `assets/video/*.mp4`, `*.jpg` | Six demo clips (720x1280 H.264, no audio track, 9-10 s, 0.6-1.3 MB) and their posters (540x960 progressive JPEG, 60 KB or less) |
| `assets/video/make_demo_clips.py` | Rebuilds the clips and `data/clips.js` from Unsplash photos (Pillow + ffmpeg) |
| `tests/infra/video.test.js` | Node and Playwright tests |

## Script order

```html
<script src="assets/js/config.js"></script>   <!-- optional but recommended, first -->
<script src="assets/js/store.js"></script>    <!-- optional: YSD.store / YSD.db -->
<script src="data/clips.js"></script>         <!-- demo clips (any time before list()) -->
<script src="assets/js/clips.js"></script>
<script src="assets/js/feed.js"></script>     <!-- only on pages with a feed -->
```

Both modules tolerate missing optional modules. Without `store.js`, clips.js uses its own small
localStorage store (same `ysd:` key prefix) and its own IndexedDB database (`ysd-clips`), each with
an in-memory fallback. Without `data/clips.js` the list is simply empty. Paths in data files are
site-relative (`assets/video/x.mp4`) and are resolved against the folder that holds `assets/`
(taken from clips.js's own `src`, falling back to `YSD.root`), so pages in sub-folders and
`file://` work.

## YSD.clips

Blob-touching calls return Promises; like/view/stats are synchronous. A **clip** object:

```js
{
  id, source: 'demo'|'remote'|'local', demo: bool, mine: bool,
  src,            // playable URL: site file, blob: object URL (local) or remote MP4; may be null
  poster,         // image URL or null
  hls, iframe,    // remote playback (production), else null
  type, width, height, orientation: 'vertical'|'horizontal'|'square', aspect, duration, size,
  caption, author: { handle, name, id }, tags: [], createdAt,   // ISO string
  likes, liked, views,
  status: 'ready'|'local'|'uploading'|'processing'|'failed', persisted: bool,
  upload: { provider, id, progress, loaded, total, error, message, uploadedAt } | null,
  available,      // local clips: false if the stored file is gone
  photos, facts,  // demo clips only (credits and sources)
  captions, captionI18n, title, series, lang, color, lqip, showUntil,   // demo clips, round 1 (see Demo content)
  burnedInText    // older demo records only
}
```

Treat `caption`, `author` and `tags` as untrusted text: set them with `textContent`, never
`innerHTML` (the default feed template escapes them).

### Contract

- `add(file, opts) -> Promise<clip>`: validates (type, size, duration, playable), probes, stores the
  file and poster, saves metadata, fires `clip-added`. `opts`: `caption` (trimmed, max 300),
  `author` (`'@handle'`, `'handle'` or `{handle, name}`; default from `YSD.members.current()`),
  `tags` (array or `"#a, b"`; lower-cased, deduped, max 8), the moderation fields (below),
  `upload: false`, `awaitUpload: true` (resolve after the production upload), `onProgress(p)`,
  `signal` (AbortSignal), and any limit override (`maxBytes`, `maxDuration`, ...). Rejects with
  `Error{code, result}` (codes below) and fires `clip-rejected`.
- `list(opts) -> Promise<clip[]>`: this browser's clips + `useSource` clips + demo clips, deduped.
  `opts`: `sort` (`'new'` default, `'top'`, `'trending'`, `'views'`, `'oldest'`), `tag`,
  `author`, `orientation`, `mine: true`, `includeDemo` (default: `YSD_CONFIG.demo`; demo clips never
  show in production unless asked), `includeHidden`, `includeUnavailable`, `limit`, `refresh`.
- `get(id) -> Promise<clip|null>` (hidden and demo clips included).
- `like(id) -> {id, liked, likes, views}`: one like per browser; fires `clip-liked`.
- `remove(id) -> Promise<true>`: local clips: deletes file, poster, metadata and object URLs and
  cancels an upload. Demo/remote clips: hidden in this browser.
- `validate(file, opts) -> {ok, reason, code, type, size}` (synchronous): MIME type, or the file
  extension when the browser reports no MIME (common for `.mov`), size cap, and `opts.duration`
  if you pass one. `reason` is user-facing copy.

### Moderation fields

A person reviews every clip before it goes public (Clip Rules, Teen Safety Policy). The post form
collects four answers and passes them to `add()`; they ride on the stored record and in the upload's
create request:

| `add()` option | Stored on the record (and on `clip` for your own clips) | Create request |
|---|---|---|
| `captionsConfirmed: true` (the poster ticked "my clip has captions") | `captionsConfirmed` (`false` when not given) | `captionsConfirmed` |
| `containsMinors: 'yes' \| 'no'` (or `true`/`false`; anyone under 18 in the clip, the poster included) | `containsMinors` (`'yes'`, `'no'` or `null`) | `containsMinors` (`''` when not answered) |
| `guardianRequired: true` (the poster is under 18) | `needsGuardian` (true when either says so) | `needsGuardian` |
| `guardianContact: 'email or phone'` | only `guardianContactProvided: true`, **never the contact** | `guardianContact`, production only |
| `consents: ['rights', 'people', 'rules']` or `[{id, version}]`, `consentVersion` | `consents: [{id, version, at}]` | `consents` |

- **Consents** take ids from `data/legal.js` `snippets.uploadConsent`. A consent without its own
  `version` gets `opts.consentVersion`, else config `clips.consentVersion`
  (`'clip-consent-2026-11-09-draft'`; bump it whenever the consent wording changes). `at` is when the
  clip was posted. Ids are deduped.
- **The guardian contact is never stored on the device.** In demo mode it is dropped as soon as
  `add()` reads it (nothing is uploaded anyway). In production it is held in memory for this page
  only, sent once in the create request, and forgotten when the endpoint answers; `remove(id)` forgets
  it too. A retry after a reload, or after a successful create, needs it again:
  `upload(id, {guardianContact})`.
- **A clip that needs a guardian is not uploaded without one.** When `needsGuardian` is true and no
  contact is at hand, `upload()` (and `add()` with `awaitUpload`) rejects with `guardian-required`,
  marks the clip `failed` (`upload.error: 'guardian-required'`) and fires `clip-upload-failed`; nothing
  is sent. Ask for the contact and call `retry(id, {guardianContact})`.
- **Server side.** The upload function ignores fields it does not know, so the guardian contact never
  reaches provider metadata. Before launch the review step must store the moderation fields with the
  upload and hold clips with `needsGuardian` until a moderator has guardian consent (see "Before
  launch" below).

### Extras

- `check(file, opts) -> Promise<{ok, reason, code, meta}>`: validate + probe + duration/playability.
- `probe(fileOrUrl, opts) -> Promise<meta>`: never rejects. `meta = {duration, width, height,
  orientation, aspect, playable, poster: Blob|null, posterType, error}`. Uses a hidden muted
  `<video>` and a `<canvas>`; poster at `opts.posterAt` seconds (default min(1 s, 10%)), longest
  side `posterMaxSide` (720), JPEG `posterQuality` (0.82). MediaRecorder WebM files that report an
  Infinity duration are fixed by seeking to the end once.
- `unlike(id)`, `toggleLike(id)`, `liked(id)`, `stats(id)`, `view(id, {force})` (counted once per
  clip per tab session; the feed calls it after 2 s of playback), `unhide(id)`, `unhideAll()`.
- `url(id)`, `posterUrl(id)`: object URL for a stored clip (created once, cached).
  `release(id)`, `releaseAll()`: revoke them (the next `list`/`get` recreates them).
- `upload(id, opts)` / `retry(id, opts)`, `cancelUpload(id)`, `status(id)`, `uploadEnabled()`.
- `useSource(fn, {ttl})`: production feed source, see below.
- `beforeUpload`: optional hook `clip -> extra fields | Promise` merged into the create request
  (e.g. `() => ({ turnstileToken })`).
- `onChange(cb) -> off`: any clip change in this tab or another tab.
- `requestPersist()`: asks the browser to keep stored clips (`navigator.storage.persist`).
- `reset()`: removes this browser's clips, likes, views and hidden flags.
- `limits(opts)`, `messages` (editable copy keyed by code), `resolve(path)`,
  `format.bytes(n)`, `format.duration(sec)`, `orientationOf(w, h)`, `keys`.

### Limits and codes

Defaults: `maxBytes` 150 MB, `maxDuration` 180 s, `minDuration` 0.5 s, `captionMax` 300,
`tagsMax` 8, `probeTimeout` 15 s, `pollInterval` 5 s, `pollTries` 60. Types: mp4, mov
(quicktime), webm, m4v, 3gp/3g2, ogv, mkv. Override per call, or site-wide with an optional
`YSD_CONFIG.clips = { maxBytes, maxDuration, minDuration, captionMax, tagsMax }` block (in config.js,
set to these defaults; keep `maxBytes`/`maxDuration` in step with the upload function's env vars).

Result/error codes: `no-file`, `type`, `empty`, `size`, `duration`, `too-short`, `unplayable`,
`timeout`, `missing`, `demo`, `no-endpoint`, `guardian-required`, `network`, `aborted`,
`create-failed`, `upload-failed`, `interrupted`, `processing-failed`. Copy for each lives in `YSD.clips.messages`.

In demo mode a file the browser cannot play (for example HEVC `.mov` on desktop Chrome) is
rejected as `unplayable`, since it could not be shown. In production it is accepted (the provider
transcodes), with no local preview or duration.

### Events (on `document`, via `YSD.emit`, each prefixed `ysd:`)

`clip-added {clip}`, `clip-rejected {code, reason, name, size}`, `clip-removed {id, hidden}`,
`clip-liked {id, liked, likes, views}`, `clip-view {id, ...}`, `clip-not-persisted {id}` (file kept
in memory only: storage full or private mode), `clip-upload-start {id}`,
`clip-upload-progress {id, loaded, total, progress}` (throttled to about 8 per second),
`clip-uploaded {id, provider, remoteId}`, `clip-upload-failed {id, code, message}`,
`clip-ready {id, playback}`, `clips-changed {reason, id}` (re-render signal).
`YSD.track` gets `clip_add`, `clip_like`, `clip_unlike`, `clip_view`, `clip_upload`, `clip_remove`.

### Storage

YSD.store keys: `clips:local` (array of this browser's clip records, no blobs), `clips:liked`
(`{id: ts}`), `clips:views` (`{id: n}`), `clips:hidden` (`{id: ts}`). YSD.db buckets: `clips`
(the File/Blob) and `clip-posters` (JPEG Blob). If the file only fits in memory, the record is
marked `persisted: false` and dropped on the next page load. Uploads cut off by a page close come
back as `status: 'failed'` with `upload.error: 'interrupted'`; `retry(id)` restarts them.

## YSD.feed

`YSD.feed.attach(container, opts) -> controller` drives any markup that follows this contract:

| Selector / attribute | Role |
|---|---|
| `[data-feed-item]` | one per clip; `data-clip-id="ID"` links likes and views to YSD.clips |
| `video` inside it | muted, loop, playsinline applied; `data-src`, `data-poster` and `<source data-src>` are lazy-loaded |
| `[data-feed-mute]` | toggles sound; `aria-pressed="true"` while muted |
| `[data-feed-play]` | play/pause; `aria-pressed="true"` while playing |
| `[data-feed-like]` | like/unlike; `aria-pressed` reflects the like |
| `[data-feed-likes]`, `[data-feed-views]` | count text, updated in place |
| `[data-feed-progress]` | `<progress>` gets `value`; anything else gets `--ysd-feed-progress` |
| `[data-feed-ignore]` | taps inside never toggle play or like (links, buttons and inputs are ignored anyway) |

State written back for CSS: item `data-feed-active="true"`,
`data-feed-state="idle|loading|playing|paused|ended|error"`, style `--ysd-feed-progress` (0-1);
container `data-feed-muted`, `data-feed-autoplay="on|off"`, `data-feed-index`.

Behaviour: the item most in view (IntersectionObserver, `threshold` 0.6; the container is the root
when it scrolls itself, else the viewport) plays and the others pause. Muted by default; the mute
choice is shared by every feed on the page; if unmuted autoplay is refused the feed re-mutes and
fires `autoplay-blocked`. Keys (document-level while the feed is on screen and no input has focus;
`keyboard: 'container'` limits them to the focused container): ArrowDown/j/PageDown next,
ArrowUp/k/PageUp previous, Space play/pause, m mute, l like, Home/End. A tap toggles play/pause; a
double tap likes (it never unlikes) and the event carries `x`/`y` relative to the item for a heart
burst. The next `preload` items (1) load ahead; items more than `unloadDistance` (4) away drop
their `src` to free decoders. No autoplay under `prefers-reduced-motion: reduce`, Save-Data,
2G connections or `prefers-reduced-data` (posters show; a tap plays). The active clip pauses while
the tab is hidden. A view counts after `viewSeconds` (2) of real playback or half the clip.
New items added to the DOM are picked up automatically (MutationObserver).

Options (defaults): `itemSelector`, `videoSelector`, `threshold`, `autoplay: 'auto'|true|false`,
`muted: true`, `loop: true`, `preload: 1`, `unloadDistance: 4`, `keyboard: true`,
`tapToPause: true`, `doubleTapLike: true`, `doubleTapMs: 300`, `viewSeconds: 2`, `root`,
`scrollBehavior: 'smooth'`, `like: true`, `countViews: true`, and callbacks `onChange`, `onPlay`,
`onPause`, `onLike`, `onView`, `onMute`, `onError`.

Controller: `index` and `muted` (getters), `items()`, `active()`, `goTo(i, {smooth})`, `next()`,
`prev()`, `play()`, `pause()`, `toggle()`, `mute()`, `unmute()`, `toggleMute()`, `setMuted(b)`,
`like(i)`, `refresh()`, `destroy()`, `autoplayAllowed()`, `on(name, cb) -> off`.

Events bubble from the container as `ysd:feed-change`, `-play`, `-pause`, `-mute`, `-like`,
`-view`, `-ended`, `-error`, `-autoplay-blocked`; `detail = {index, item, id, controller, ...}`.

`YSD.feed.mount(container, clips, opts)` renders `opts.template(clip, i)` (HTML string or Element;
default `YSD.feed.template`, which escapes all text) and attaches. With the default template it
injects the FALLBACK STYLES block (`#ysd-feed-fallback-css`, everything under `.ysd-feed-fallback`):
a placeholder the design team replaces, by passing its own template, or `fallbackStyles: false`.
Also: `YSD.feed.instances()`, `YSD.feed.defaults`, `YSD.feed.escape(s)`.

Minimal page:

```html
<div id="feed"></div>
<script>
  YSD.clips.list({ sort: 'trending' }).then(function (clips) { YSD.feed.mount('#feed', clips); });
  document.addEventListener('ysd:feed-like', function (e) { /* heart burst at e.detail.x, e.detail.y */ });
</script>
```

## Production seam

1. Set the provider variables on the host (below), then in `config.js` (or a pre-config):
   `demo: false` and `integrations.videoUploadEndpoint: '/api/video-upload'`.
2. `YSD.clips.add(file)` stores locally, then `POST /api/video-upload` with JSON
   `{action:'create', clientId, filename, size, type, duration, width, height, caption, tags,
   author, ref, captionsConfirmed, containsMinors, needsGuardian, consents, guardianContact?,
   ...beforeUpload()}` (`guardianContact` only when the clip has one; see "Moderation fields"). The function re-checks type, size and duration, verifies
   Turnstile if configured, and asks the provider for a one-time URL:
   `{ok:true, provider, id, uploadUrl, method:'POST'|'PUT', field?, headers?, maxBytes,
   maxDurationSeconds, expiresAt}` or `{ok:false, error, message}` with a 4xx/5xx status.
3. The browser sends the file straight to `uploadUrl` with XMLHttpRequest (progress events):
   Cloudflare = `POST` multipart, field `file` (basic uploads, 200 MB max); Mux = raw `PUT`.
4. The clip becomes `status: 'processing'`; clips.js polls
   `GET /api/video-upload?id=<id>&provider=<p>` -> `{state:'waiting'|'processing'|'ready'|'error',
   playback:{hls, dash, mp4, poster, iframe}}` and on `ready` stores `playback` and fires `clip-ready`.

Environment variables (host dashboard only; never in the repo or config.js):

| Variable | Use |
|---|---|
| `VIDEO_PROVIDER` | `cloudflare` or `mux`; default: whichever is configured, Cloudflare first |
| `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN` | Cloudflare Stream; the token needs the Stream Write (Stream:Edit) permission |
| `CF_STREAM_CUSTOMER_CODE` | optional: builds `customer-<code>.cloudflarestream.com` playback URLs if the API omits them |
| `CF_STREAM_REQUIRE_SIGNED_URLS` | optional `true` (playback then needs signed tokens) |
| `CF_STREAM_ALLOWED_ORIGINS` | optional comma list of sites allowed to embed |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Mux access token (Mux Video read + write) |
| `MUX_PLAYBACK_POLICY` | `public` (default) or `signed` |
| `MUX_VIDEO_QUALITY` | `basic` (default), `plus` or `premium` |
| `MUX_CORS_ORIGIN` | default: the request Origin, else `*` |
| `VIDEO_MAX_BYTES` | default 157286400 (150 MB); capped at 200 MB for Cloudflare basic uploads |
| `VIDEO_MAX_DURATION_SECONDS` | default 180; sent to Cloudflare as `maxDurationSeconds` |
| `ALLOWED_ORIGINS` | optional comma list; other Origins get 403, listed ones get CORS headers |
| `TURNSTILE_SECRET_KEY` | optional; then the create request must carry a valid `turnstileToken` |

API calls used: Cloudflare `POST /client/v4/accounts/{id}/stream/direct_upload` and
`GET /client/v4/accounts/{id}/stream/{uid}`
([direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/),
[API reference](https://developers.cloudflare.com/api/resources/stream/subresources/direct_upload/methods/create/));
Mux `POST /video/v1/uploads`, `GET /video/v1/uploads/{id}`, `GET /video/v1/assets/{id}`
([direct uploads](https://www.mux.com/docs/guides/upload-files-directly)). Checked Nov 9, 2026.

Before launch:

- **Moderation.** Every upload is tagged `review: pending` (Cloudflare `meta`, Mux `passthrough`).
  Nothing lists uploads publicly: each member sees only their own clips. The public feed should
  come from a reviewed list, plugged in with
  `YSD.clips.useSource(() => fetch('/api/clips').then(r => r.json()))` (items shaped like
  `data/clips.js` items: `id`, `src` or `hls`, `poster`, `caption`, `author`, `tags`, `likes`, ...).
  That endpoint and the review step are not built. The create request already carries the
  moderation fields (`captionsConfirmed`, `containsMinors`, `needsGuardian`, `consents` with
  versions, `guardianContact`); the review step must store them with the upload (the guardian
  contact only there, never in provider metadata) and hold `needsGuardian` clips until a moderator
  has guardian consent.
- **Abuse.** The create endpoint is public. Turn on Turnstile (`TURNSTILE_SECRET_KEY` plus a
  `beforeUpload` hook that returns the widget token) and a host rate-limit rule on
  `/api/video-upload`. Mux has no duration cap at upload time: check `duration` in review.
- **Playback.** Safari plays HLS natively; Chrome and Firefox need hls.js (a CDN script, so add it
  to the CSP) or the Cloudflare Stream iframe (`clip.iframe`). Until a clip is `ready`, the
  uploader's own copy plays from its blob: URL.
- **CSP.** `tools/csp.js` already adds the provider hosts (upload, media, image, frame) when
  `videoUploadEndpoint` is set.
- **Likes and views** are per-browser in demo and production. For shared counts, listen for
  `ysd:clip-liked` / `ysd:clip-view` and post them, or use `YSD.counters` with a counters endpoint.

## Demo content

(Round 1, G-VIDEO, Tue Nov 10, 2026; this section was refreshed from `data/clips.js` and
`assets/video/make_demo_clips.py` the same day.)

Eight DEMO clips in five named recurring formats (`data/clips.js` `series`: Seminole in 60, First Time?, Crew Cam,
En español, Open Mic). Each has a fake creator handle (`@demo.maria`, `@demo.jordan`, `@demo.ava`, `@demo.luis`,
`@demo.priya`, `@demo.sam`, `@demo.vale`, `@demo.nia`) and made-up like and view counts that are never shown. They
are flagged `demo: true` and hidden when `YSD_CONFIG.demo` is false.

**Nothing is burned in.** The only word in the picture is a small "DEMO" bug (`burnedIn: ['DEMO']`), and posters
carry no words at all. Captions are data: each clip has `captions.en` and `captions.es` (`{src, label,
translated, cues: [[start, end, text]]}`; `lang` is the language it was made in) plus the same cues as WebVTT files,
`assets/video/<file>.en.vtt` and `<file>.es.vtt`. `assets/js/reel.js` draws the cues as HTML caption chips over
the video in the page language (on by default; the preference is `reel:cc`) and builds the transcript
(`YSD.reel.transcript(clip)`) from the same cues; a translated clip's transcript lists the original too. Demo clip
objects from `YSD.clips` carry `captions`, `captionI18n`, `title`, `series`, `lang`, `color`, `lqip` (a tiny
blurred placeholder) and `showUntil` alongside `photos` and `facts`; `burnedInText` is only set on older records.

| Clip | Format | Claim in the captions | Source (checked Nov 10, 2026) |
|---|---|---|---|
| mail-ballot-renew (until Jan 1, 2027) | Seminole in 60 | Requests made before the Nov 3, 2026 general election end Dec 31, 2026; renew at voteseminole.gov or 407-585-8683 | [Fla. Stat. 101.62](https://www.flsenate.gov/Laws/Statutes/2025/101.62), [Seminole SOE vote by mail](https://voteseminole.gov/how-to-vote/vote-by-mail/) |
| sunrail-rally | Crew Cam | Seminole's SunRail stations: Sanford, Lake Mary, Longwood, Altamonte Springs; SunRail runs Monday to Friday | [SunRail Phase 1 stations](https://corporate.sunrail.com/stations-trains/phase-1-stations/), [SunRail schedule](https://sunrail.com/help-center/support/maps-schedules/how-often-does-sunrail-run/) |
| first-time-voter | First Time? | Bring a current, valid picture ID with a signature | [Fla. Stat. 101.043](https://www.flsenate.gov/Laws/Statutes/2025/101.043), [voter status lookup](https://registration.dos.fl.gov/CheckVoterStatus) |
| lake-monroe-canvass | Crew Cam | none (stand-in lake photo, not Lake Monroe) | n/a |
| precinct-captain | Seminole in 60 | Official Democratic Party reps for your precinct; front-facing voter outreach | [SemDems precinct captain form](https://form.jotform.com/250016464253045) |
| trivia-night-recap | First Time? | none | n/a |
| student-id-2027 (made in Spanish) | En español | HB 991 drops student IDs from the accepted photo IDs from Jan 1, 2027; a federal lawsuit filed Oct 16, 2026 challenges it | [HB 991 bill summary](https://flsenate.gov/Committees/BillSummaries/2026/html/991), [complaint](https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf) |
| why-i-showed-up | Open Mic | none | n/a |

Photos: nine Unsplash photos under the Unsplash License, with URLs, photographers and descriptions in each item's
`photos` in `data/clips.js`. Unsplash allows modification without attribution; credits are kept anyway. People in
the photos are not members and did not endorse anything. Before launch, replace these clips with real member videos
(with consent), or at least drop the stock photos that show recognizable faces.

Rebuild (needs Python 3.9+ with Pillow, ffmpeg and ffprobe, Node 22 with Playwright and Chromium, and network access
to images.unsplash.com):

```sh
python3 assets/video/make_demo_clips.py --cache /tmp/ysd-photos      # all clips, VTT files and data/clips.js
python3 assets/video/make_demo_clips.py --only demo-sunrail-rally     # one clip (comma list allowed)
python3 assets/video/make_demo_clips.py --data-only                   # no render: rewrite the VTT files and data/clips.js
```

Edit `SPECS` in the script, not `data/clips.js`. `assets/video/render_clips.js` renders every frame of a clip's shot
list with `assets/video/stage.js` (creator formats: screen recordings with tap dots, a map with a facecam bubble,
jump cuts and punch-ins, brand stickers popping in) and pipes it into ffmpeg; the script then encodes the MP4
(720x1280 H.264, no audio, `+faststart`, CRF stepped up until it fits 1.5 MB), the poster (540x960 progressive JPEG,
the best quality that fits 60 KB), the lqip and colour, the two VTT files and `data/clips.js`.

## Tests

```sh
node tests/infra/video.test.js          # Node checks + headless Chromium (about 15 s)
node tests/infra/video.test.js --node   # Node checks only
```

Node part: required files present; no assistant/LLM references and no credentials in browser code;
`data/clips.js` flags, handles, credits and sources; each MP4 parsed (H.264, 720x1280, 6-12 s, no
audio track, moov before mdat, at most ~1.5 MB, metadata matches); each poster 540x960, progressive,
at most 60 KB and matching `posterBytes`/`posterWidth`/`posterHeight`; one sentence per transcript line;
clips.js and feed.js loading in a bare VM with and without config/store; the Cloudflare and Netlify
handlers against mocked provider APIs (create, limits, Turnstile, origins/CORS, status mapping,
provider errors that never leak tokens, Mux auth and body). It also checks that the two function
files share a byte-identical core block.

Browser part (local server with a mock upload API, plus `file://`): list/sort/filter and
playback of the demo clips; validate(); probe() on an MP4 and on a MediaRecorder WebM (Infinity
duration, horizontal); duration and unplayable rejection; add/list/get/like/view; persistence across
a reload; remove and hide. Then: no uploads in demo mode; production POST-multipart and PUT uploads
with progress, status polling, failure and retry; the no-store.js fallback; the feed (autoplay,
preload/unload, j/k/Space/m, double-tap like with coordinates, view after 2 s, tap to pause);
reduced motion (no autoplay); escaping of user text; no uncaught page errors.
