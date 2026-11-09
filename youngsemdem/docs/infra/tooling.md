# Tooling and deployment layer (workstream: tooling)

Logic only, no visual design. This layer keeps shared markup in sync and checks pages in a real
browser. It also generates the files that depend on `config.js` (the CSP, the manifest, the
sitemap and the credits), and holds the deploy configuration for Cloudflare Pages, Netlify and
GitHub Pages, plus the service worker. Every tool runs when no pages exist yet.

Nothing here adds a chat assistant, LLM call or "ask" endpoint. `tests/infra/tooling.test.js`
fails if one appears in these files.

## Files

| File | What it is |
|---|---|
| `tools/sync_partials.py` | Copies `partials/*.html` into pages between `<!-- @name -->` and `<!-- /@name -->` markers. Sets `aria-current="page"` and fills the `{{root}}`, `{{site}}` and `{{path}}` tokens. `--check` exits 1 on drift |
| `partials/README.md` | The marker convention, for the design team |
| `tools/check_site.js` | Playwright crawler for root-level pages at 390x844 and 1440x900, with axe-core. Writes `tools/check_report.json` |
| `tools/csp.js` | Builds the Content-Security-Policy from `config.js` and rewrites the CSP line in `_headers` (`--write` or `--check`) |
| `tools/manifest.js` | Copies name, short name, description, lang and colours from `config.js` into `manifest.webmanifest` |
| `tools/read_config.js` | Evaluates `assets/js/config.js` (plus `config.local.js`) in Node. Used by the other tools |
| `tools/make_sitemap.py` | Writes `sitemap.xml` from `site.url` (or `--base`). `--robots` adds the `Sitemap:` line |
| `tools/credits.py` | Writes `CREDITS.md`: every remote photo, video and font, its credit, and every `file:line` that uses it |
| `_headers` | Security headers, the generated CSP, cache rules, and `noindex` (the whole demo, plus internal folders) |
| `_redirects` | `/go/*` short links to the official voting sites (from `config.links.vote`). Portable syntax only |
| `netlify.toml` | Publish `.`, functions `netlify/functions`, forced `/api/*` to `/.netlify/functions/:splat`, and forced 404 for internal folders |
| `robots.txt` | Crawl allowed; `/api/` and internal folders disallowed. `make_sitemap.py --robots` adds the Sitemap line |
| `manifest.webmanifest` | Web app manifest; icons point at placeholder paths in `assets/icons/` |
| `sw.js` | Service worker |
| `assets/js/sw-register.js` | `YSD.sw`: registration rules and hooks |
| `DEPLOY.md`, `README.md`, `package.json`, `.gitignore` | Deploy guide, project readme, npm script shortcuts (no dependencies), ignores |
| `tests/infra/tooling.test.js`, `tests/infra/fixtures/` | Tests and throwaway fixture sites |

## `YSD.sw` (assets/js/sw-register.js)

Load it after `assets/js/config.js` (it also works without config.js). On `window` `load`, it
registers `<site root>/sw.js`, with scope set to the site root, only when every condition below
holds:

1. `location.protocol` is `http:` or `https:` (never `file://`);
2. `'serviceWorker' in navigator`;
3. the URL has no `?sw=0` (a kill switch for debugging);
4. `YSD_CONFIG.pwa.serviceWorker !== false`;
5. not demo mode (`YSD_CONFIG.demo !== false`), unless `YSD_CONFIG.pwa.serviceWorkerInDemo === true`.

When rule 3, 4 or 5 turns registration off, any earlier registration of this site's `sw.js` is
removed and the `ysd-*` caches are deleted. Workers for other apps on the same origin are left
alone. So flipping the config really turns the worker off for returning visitors.

| Member | Type | Meaning |
|---|---|---|
| `YSD.sw.status` | string | `'idle'`, `'file'`, `'unsupported'`, `'disabled'`, `'registering'`, `'registered'`, `'error'` |
| `YSD.sw.reason` | string | Why it is not registered: `'file'`, `'unsupported'`, `'url-kill-switch'`, `'config'`, `'demo'`, or an error message. `''` when registered |
| `YSD.sw.enabled()` | `-> {ok, reason}` | Evaluates the rules above |
| `YSD.sw.register()` | `-> Promise<ServiceWorkerRegistration \| null>` | Registers when `enabled()`, else resolves `null` |
| `YSD.sw.unregister()` | `-> Promise<number>` | Removes this site's registrations, clears its caches, and resolves the count |
| `YSD.sw.update()` | `-> Promise` | Asks the browser to check `sw.js` for a new version |
| `YSD.sw.applyUpdate()` | `void` | Tells a waiting worker to activate (`SKIP_WAITING`) |
| `YSD.sw.url` | string | Absolute URL of `sw.js` |
| `YSD.sw.registration` | object or null | The current registration |

Events, dispatched on `document` through `YSD.emit` (or a CustomEvent if config.js is missing):

| Event | detail | When |
|---|---|---|
| `ysd:sw-registered` | `{scope}` | Registration succeeded |
| `ysd:sw-disabled` | `{reason}` | Registration was skipped |
| `ysd:sw-error` | `{message}` | Registration failed |
| `ysd:sw-update-ready` | `{}` | A new worker is installed while an old one controls the page (show a "refresh" prompt) |
| `ysd:sw-controller` | `{}` | A new worker took control of the page |
| `ysd:network` | `{online}` | The browser went online or offline |

Config keys read (the `pwa` block in `config.js`; the same values are the built-in defaults):
`pwa.serviceWorker` (default `true`), `pwa.serviceWorkerInDemo` (default `false`), `pwa.swUrl`
(default `'sw.js'`).

## sw.js

- **Pages** (navigations): network first. A good 200 response is cached in `ysd-<v>-pages`. The
  cache key has no `?query`, so `?ref=` and `utm_*` share links share one entry. On network failure,
  or after 4 seconds when a cached copy exists, the cached page is served. Lookups also try
  `dir/` and `dir/index.html`, and `/about` and `about.html`. With no cached copy, the worker
  serves `offline.html` (cached at install and again after the first online navigation, if it
  exists). Failing that, it serves a built-in plain page: status 503, `<body data-ysd-offline="builtin">`.
- **Same-origin assets** (js, css, json, webmanifest, images, fonts): stale-while-revalidate in
  `ysd-<v>-assets`, capped at 150 entries (pages at 40).
- **Cross-origin**: only `fonts.googleapis.com`, `fonts.gstatic.com` and `images.unsplash.com`,
  and only CORS responses. Opaque responses are never cached.
- **Never touched**: `/api/*`, `/.netlify/*`, `/cdn-cgi/*`, `sw.js`, non-GET requests, `Range`
  requests, and video or audio files.
- Messages: `{type:'SKIP_WAITING'}`, `{type:'CLEAR_CACHES'}` (stops serving and deletes the
  `ysd-*` caches), and `{type:'VERSION'}` (replies `{version}` on the port).
- `VERSION = 'ysd-v1'`. Bump it on deploys that change assets: old caches are deleted on activate.
  The worker calls `skipWaiting` and `clients.claim` and enables navigation preload.

## Tools: CLI and module API

Exit codes for every tool: `0` ok, `1` drift or errors found, `2` bad input or crash.

### tools/sync_partials.py

```
python3 tools/sync_partials.py [--check] [--diff] [--quiet] [--root DIR] [--partials DIR] [--site URL] [page.html ...]
```

- Pages: every `*.html` under the root, recursively. It skips the top-level folders `tools/`,
  `tests/`, `docs/`, `partials/`, `netlify/`, `functions/`, `vendor/`, `dist/` and `build/`, plus
  hidden folders and `node_modules/`.
- Markers: `<!-- @name -->...<!-- /@name -->`, with spacing inside a marker ignored. Partials can
  nest. When the opening marker sits on its own line, the inserted content takes its indentation.
  Output is idempotent, and CRLF files keep CRLF.
- Tokens in inserted content:
  - `{{root}}`: the relative path to the site root (`""` or `"../"`).
  - `{{site}}`: from `--site`, else `SITE_URL`, else `config.site.url`, with no trailing slash.
    It warns when empty.
  - `{{path}}`: the pretty path: `/`, `/about`, `/events/`.
- `aria-current="page"` goes on links that resolve to the page being written. Only links inside a
  `<nav>` count when the partial has one; otherwise every link in the partial counts.
  `data-no-current` opts a link out.
- Errors (exit 2; the page is not written): unclosed marker, closing marker without an opening
  one, a marker opened twice, or partials that include each other in a loop. A marker with no
  partial file only warns.

### tools/check_site.js

```
node tools/check_site.js [--root DIR] [--pages a.html,b.html] [--out FILE] [--strict] [--no-axe]
  [--axe-file FILE] [--no-headers] [--sw] [--base URL] [--json] [--quiet] [--viewports 390x844,1440x900] [--timeout MS]
```

It serves the root on `127.0.0.1` with a built-in server. The server handles pretty URLs, `Range`
requests and `404.html`, and it applies `_headers` (dropping `upgrade-insecure-requests` and HSTS
locally), so the production CSP is enforced. It opens each root-level page once per viewport. The
mobile viewport uses `isMobile` and touch. Service workers are blocked unless you pass `--sw`.
`--base` crawls a deployed site instead.

| Severity | Checks (`check` id in the report) |
|---|---|
| error | `console-error`, `page-error`, `failed-request` (same-origin, status >= 400 or a network failure; `ERR_ABORTED` ignored), `overflow` (`scrollWidth` beyond the viewport, naming the widest elements), `img-alt`, `title`, `lang`, `viewport`, `broken-link`, `broken-anchor` (same page, crawled pages, or regex ids for other pages), `duplicate-id`, `accessible-name` (links and buttons), `manifest` (missing or invalid JSON), `load`, `axe:<rule>` for serious and critical issues |
| warning | `meta-description`, `canonical` (missing or relative), `og:title`, `og:image` (missing or relative), `og:description`, `twitter:card`, `heading-order` (jumps, first heading not h1, no h1), `tap-target` (under 24x24 CSS px; WCAG 2.2 SC 2.5.8 inline, label and spacing exceptions), `link` (`href="#"`, `javascript:`), `script-order` (config.js first, store.js second), `manifest-icon`, `favicon`, `external-resource`, `axe:<rule>` for moderate and minor issues |

`--strict` turns every warning into an error and adds `noindex` errors for pages that have
`X-Robots-Tag` or meta robots `noindex` (the launch gate). axe-core is loaded from `node_modules`,
else from `tools/.cache/axe-core-4.10.2.min.js`, else downloaded once from cdnjs and cached; if
none works, it is skipped with a note. When no root-level pages exist, the tool prints a note,
writes an empty report and exits 0.

The report (`tools/check_report.json`, git-ignored) looks like this:
`{tool, generatedAt, root, target, viewports[], strict, headersEmulated, axe:{status, source|note, version}, notes[], summary:{pages, errors, warnings, byCheck, seconds}, pages:[{page, url, errors, warnings, issues:[{severity, check, message, viewports[], detail}]}]}`.

Module: `require('./tools/check_site')` exports `run(opts)`, `parseArgs(argv)`,
`parseHeadersFile(text)` (returning `[{pattern, re, set, detach}]`), `headersFor(rules, path)`,
`localizeHeaders(h)`, `createServer(root, {headers})`, `rootPages(root)`, `printReport(report, opts)`
and `AXE_VERSION`.

### tools/csp.js

```
node tools/csp.js [--write | --check] [--root DIR] [--headers FILE] [--video cloudflare|mux|both|none] [--add "dir src..."] [--remove "dir src..."]
```

The base policy: `default-src 'self'`; `script-src 'self'` (no inline); `style-src 'self'
'unsafe-inline' https://fonts.googleapis.com`; `font-src 'self' data: https://fonts.gstatic.com`;
`img-src 'self' data: blob: https://images.unsplash.com`; `media-src 'self' data: blob:`;
`connect-src 'self'`; `worker-src 'self' blob:`; `manifest-src`, `frame-src`, `frame-ancestors`,
`form-action` and `base-uri` all `'self'`; `object-src 'none'`; `upgrade-insecure-requests`.

Hosts added from config:

- The origin of each cross-origin endpoint in `integrations.{formEndpoint, actionNetwork.endpoint,
  squadEndpoint, countersEndpoint, videoUploadEndpoint, analytics.endpoint}`. Same-origin paths are
  covered by `'self'`.
- Video provider hosts when `videoUploadEndpoint` is set. Cloudflare Stream adds
  `*.videodelivery.net` and `*.cloudflarestream.com`. Mux adds `*.mux.com` and
  `storage.googleapis.com`. The choice comes from `integrations.videoProvider` or `--video`; the
  default is both.
- Plausible or Cloudflare Web Analytics hosts, matching `analytics.provider`.
- Turnstile when `integrations.turnstileSiteKey` is set.
- `YSD_CONFIG.csp` (`{directive: [sources]}` plus `remove: {directive: [sources]}`).

Module: `basePolicy()`, `buildPolicy(conf, {video, add, remove})`, `serialize(policy)`,
`syncHeaders(text, csp)` and `VIDEO_HOSTS`.

### tools/manifest.js, tools/read_config.js

- `node tools/manifest.js [--write | --check] [--root DIR]`. Module: `buildManifest(current, conf)`.
  It sets `name` from `org.name`, `short_name` from `org.nickname`, else `org.short`,
  `description` from `site.description`, `lang` from `site.lang`, and `background_color` and
  `theme_color` from `theme.bg` and `theme.brand` (hex values only). Every other key is kept.
- `node tools/read_config.js [--root DIR] [--pre FILE]... [--no-local] [dotted.path]` prints JSON.
  Module: `readConfig(root, {override, pre, local})` returns a plain object, or `null` when there is
  no `config.js`. `cfg(conf, path, fallback)` reads a value.

### tools/make_sitemap.py

```
python3 tools/make_sitemap.py [--base URL] [--root DIR] [--out FILE] [--style pretty|html] [--robots] [--no-lastmod] [--print]
```

- The base comes from `--base`, else `SITE_URL`, else `config.site.url`. With none, it exits 2:
  the demo has no domain yet.
- Pages: like sync_partials, minus `404.html`, `offline.html`, files whose names start with `_`,
  and noindex pages.
- `<loc>`: the page's absolute same-origin canonical, else the pretty URL (or `.html` with
  `--style html`).
- `<lastmod>`: the git commit date, else the file's modification time.

### tools/credits.py

```
python3 tools/credits.py [--check] [--json] [--root DIR] [--out FILE]
```

- It scans `.html`, `.css`, `.js`, `.json`, `.webmanifest` and `.svg` files outside `tools/`,
  `tests/`, `docs/`, `netlify/`, `functions/` and `vendor/`.
- Media found: Unsplash, Google Fonts (families parsed from `css2?family=`), Pexels, Pixabay,
  Wikimedia, YouTube thumbnails, Giphy, and any URL ending in a media extension. `example.*`
  hosts are skipped.
- Credits are read from the same object literal (`photographer`, `author`, `artist`, `creator`,
  `credit`, `photographerHandle`, `page`, `license`, `licenseUrl`), from `data-credit`,
  `data-photographer`, `data-license` or `data-source` attributes in HTML, or from
  `/* credit: ... */` comments in CSS.
- Font files (`fonts.gstatic.com`, or any `.woff`/`.woff2`/`.ttf`/`.otf` URL) are credited to their
  family, not to a photographer: the family, `license`, `copyright` and `specimen` come from the
  same object (`assets/fonts/fonts.json` records them for each self-hosted file), else the family is
  guessed from the URL. They are listed under Fonts (Family, Source, Credit, License, Used in) and
  never count as missing credits.
- `--check` compares with the existing file, ignoring the date. Re-run it whenever a page adds or
  removes remote media (the home page's photo, for example).

## Deploy files: decisions

- **One header source.** Netlify reads both `_headers` and `[[headers]]` in `netlify.toml` and
  documents no merge rule between them. Both hosts comma-join a header that several matching
  rules set. So all headers live in `_headers`, and each header name comes from one rule per path:
  `/*` carries the security headers, and cache rules sit on separate folders. A test enforces this.
- **Cache.** File names are not fingerprinted, so `assets/js`, `assets/css` and `data` revalidate
  on every load (`max-age=0, must-revalidate`, answered with a 304 from the ETag). Images, icons
  and video are cached for 7 days with stale-while-revalidate, fonts for 30 days. `sw.js` is
  `no-cache`.
- **Demo is noindex.** `X-Robots-Tag: noindex` on `/*` keeps the demo out of search results while
  link-preview bots can still fetch pages (`robots.txt` allows crawling). Delete the line at launch;
  `check_site.js --strict` fails until you do.
- **`_redirects` is portable.** It uses explicit status codes, no `!`, no 404 rules and no query
  matching. Netlify-only forced rules live in `netlify.toml`. `/go/register`, `/go/check`,
  `/go/vote-by-mail`, `/go/polling-place`, `/go/early-voting`, `/go/my-voter-record`,
  `/go/elections` and `/go/soe` mirror `config.links.vote`, and a test fails on drift.
  `/go/donate` and `/go/events` are commented out until the party confirms the URLs.
- **`/api/*` is the same on both hosts.** Cloudflare maps `functions/api/<name>.js` to
  `/api/<name>`. `netlify.toml` rewrites `/api/*` to `/.netlify/functions/:splat` (forced), so
  `videoUploadEndpoint: '/api/video-upload'` works on both.

## Production seam

Going from demo to launch takes only config changes plus these generators (full steps in
`DEPLOY.md`, sections 7 and 9):

1. Set `site.url`, then run `npm run sync` (for `{{site}}{{path}}` canonicals) and
   `python3 tools/make_sitemap.py --robots`.
2. Set the endpoints and analytics, then run `npm run csp`. Set the org name and theme colours,
   then run `npm run manifest`.
3. Set `demo: false`. The service worker turns on by default (`pwa.serviceWorker`).
4. Delete `X-Robots-Tag: noindex` from `/*` in `_headers`, bump `VERSION` in `sw.js`, run
   `npm run credits`, and pass `npm run check:strict`.

## How to test

```sh
node tests/infra/tooling.test.js           # all tooling tests (about 15 s; Node 22 + Playwright + Python 3.11)
node tests/infra/tooling.test.js sw csp    # only tests whose name contains "sw" or "csp"
npm run preflight                          # the real site: sync, CSP, manifest and page checks
```

The tests cover:

- the deploy files: limits, overlaps, syntax, and config drift for `_redirects` and the manifest;
- csp, manifest and read_config, as units and through the CLI;
- `sync_partials.py`: drift, fills, `aria-current`, the tokens, idempotency, CRLF, and error exits;
- `make_sitemap.py` and `credits.py`, on temp copies of the fixtures;
- `check_site.js` against `fixtures/site-good` (0 errors and 0 warnings under a strict CSP),
  `fixtures/site-bad` (every check fires), and `fixtures/site-empty`;
- `sw.js` with `sw-register.js` in Chromium: registration, network-first pages, query-insensitive
  page cache, stale-while-revalidate assets, offline cached page, offline `offline.html` and the
  built-in fallback, `/api/` never cached, demo-mode unregistration with cache cleanup, and
  `file://`.
