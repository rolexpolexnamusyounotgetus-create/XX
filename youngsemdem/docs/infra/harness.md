# Review harness (workstream: harness)

Two review tools. `tools/shoot.js` photographs every page of the site at phone and desktop width,
in light and dark, and lays the shots out on one contact sheet per width, so a reviewer can see the
whole site at a glance. `tools/bench_compare.js` measures our pages next to competitor homepages
(right-wing youth groups and Gen Z brands) and writes a JSON report and a markdown leaderboard.

Both tools are for review only. Nothing here ships with the site, and nothing here adds a chat
assistant or LLM call. Output goes to `tools/.cache/`, which git ignores and the hosts never serve
(`tools/` is a 404 on Netlify and noindex in `_headers`).

## Files

| File | What it is |
|---|---|
| `tools/shoot.js` | Full-page screenshots at 390x844 and 1440x900, light and dark, plus contact sheets |
| `tools/bench_compare.js` | Head-to-head metrics for any list of URLs; JSON plus markdown leaderboard |
| `tools/bench_targets.json` | Competitor homepages in two groups, `right` and `brands`, each URL checked on Nov 9, 2026 |
| `tests/infra/harness.test.js` | Tests for both tools against `tests/infra/fixtures/` pages and local stand-ins for blocked sites |
| `package.json` | `npm run shoot` and `npm run bench` |

Needs Node 18+ (22 tested) and Playwright with Chromium, the same as `tools/check_site.js`. There are
no npm dependencies. Both tools serve the site with the local server from `tools/check_site.js`,
with `_headers` applied, so the production Content-Security-Policy is enforced just as on the host.

## Screenshots: `npm run shoot`

```sh
npm run shoot                                   # every root-level page, 390 + 1440, light + dark
npm run shoot -- --pages index.html,join.html   # just these pages
npm run shoot -- --widths 390 --themes dark     # one width, dark only
npm run shoot -- --scale 2 --out ~/Desktop/shots   # retina-sharp, somewhere else
```

| Option | Default | Meaning |
|---|---|---|
| `--pages a.html,b.html` | every root-level `*.html`, `index.html` first | Pages relative to `--root`; sub-folder pages are fine (`events/index.html`) |
| `--out DIR` | `tools/.cache/shots` | Output folder |
| `--widths 390,1440` | `390,1440` | Widths, or `WIDTHxHEIGHT`. 390 means 390x844 and 1440 means 1440x900; other widths get 844 (under 768, emulated as a phone with touch) or 900 |
| `--themes light,dark` | both | Emulates `prefers-color-scheme` |
| `--scale N` | `1` | Device pixel ratio (`2` gives 4x the pixels) |
| `--crop PX` | three screens | How much of each page a contact-sheet thumbnail shows. `0` shows whole pages. The PNG files are never cropped |
| `--root DIR` | the site | Folder to serve |
| `--timeout MS` | `30000` | Page load timeout |
| `--concurrency N` | `3` | Pages shot at once |
| `--no-headers`, `--no-sheet`, `--json`, `--quiet` | | Skip `_headers`; skip the sheets; print the manifest; less output |

For each page, width and theme, the tool loads the page, scrolls through it (so lazy images and
scroll-reveal sections load), scrolls back to the top, waits for every image, for `document.fonts`
and for the network to go quiet, and then takes a full-page shot with CSS animations stopped.
Service workers are blocked so every shot is a fresh load.

Output in `--out`:

- `<page>-<width>-<theme>.png`, for example `index-390-dark.png` and `events__index-1440-light.png`.
- `contact-390.png` and `contact-1440.png`: one card per page with its light and dark thumbnails,
  the page height, and a red note when the page logged console errors or failed. Each has a
  `contact-<width>.html` twin; open it and click a thumbnail for the full-size shot.
- `shots.json`: every shot with its size, HTTP status, image counts (`loaded`, `broken`,
  `pending`), font status, console errors and any failure.

Exit code 0 means every shot was taken, 1 means some failed (they show on the sheet), and 2 means bad
arguments or a crash. With no pages yet, it writes an empty manifest and exits 0.

## Benchmark: `npm run bench`

```sh
npm run bench                                    # index.html vs every competitor
npm run bench -- --group right                   # vs the right-wing group only
npm run bench -- --local all --group none        # all our pages, no competitors
npm run bench -- --only tpusa,glossier --throttle 4g
npm run bench -- --urls https://example.org/,join.html
```

| Option | Default | Meaning |
|---|---|---|
| `--local a.html,b.html` | `index.html` if it exists | Our pages under `--root`. `all` means every root-level page; `none` means none |
| `--group right,brands` | `all` | Groups from the targets file. `none` means ours only |
| `--urls URL,page.html` | | More targets. Anything without `http(s)://` is one of our pages |
| `--only text,text` | | Keep targets whose name or URL contains one of these |
| `--targets FILE` | `tools/bench_targets.json` | Targets file |
| `--out DIR` | `tools/.cache/bench` | Writes `bench.json`, `bench.md` and `screens/*.png` (first screen of each site) |
| `--timeout MS` | `45000` | Wait for DOMContentLoaded. Each site is cut off after this plus 75 seconds |
| `--throttle` | `none` | `4g`: 170 ms round trip, 9 Mbps down and up (the WebPageTest 4G profile). `slow4g`: 150 ms, 1.6 Mbps down, 750 kbps up, 4x CPU slowdown (Lighthouse's mobile values, applied here as plain DevTools throttling, so results are not Lighthouse scores) |
| `--concurrency N` | `2` | Sites measured at once |
| `--no-axe`, `--axe-file FILE`, `--no-shots`, `--json`, `--quiet` | | |

Each target is loaded once, cold, as a phone: 390x844, touch, 2x pixels, a Chrome for Android user
agent (Lighthouse also tests with an Android Chrome agent), light scheme, en-US, New York time,
service workers blocked. The measurement window runs from navigation to the load event, plus up to
5 seconds for the network to go quiet, plus 0.8 seconds. Then the tool reads the page. Nothing is
clicked, typed or submitted, and a bot check is never bypassed: it is reported as blocked.

### What each column means

| Column | How it is measured |
|---|---|
| MB, Req, and the "Weight by type" table | Transfer bytes (encoded body plus headers) and request count from Playwright's network events, including iframes, grouped as document, script, css, image, font, media, xhr/fetch and other. Third-party means a different registrable domain (last two labels of the host) |
| DCL, load, FCP | Navigation Timing and paint entries |
| LCP | `PerformanceObserver` for `largest-contentful-paint` (the last entry before the read). The element is in the "First screen" table |
| CLS | `PerformanceObserver` for `layout-shift`, scored as the largest session window (gaps under 1 s, windows up to 5 s), as Core Web Vitals defines it. Every shift counts: the tool sends no input, and Chromium's phone emulation flags shifts in the first ~500 ms as after-input, which would hide them |
| 1st CTA s | A poller (every 50 ms for 10 s, then every 250 ms) records when the first call to action is visible and on top at its centre point. Never earlier than first paint |
| CTAs on 1st screen | Distinct (by text) calls to action whose centre is visible and unobstructed in the first 390x844 screen |
| Taps <44 | Visible interactive elements smaller than 44x44 CSS px out of all rendered targets on the page. Links inside a sentence and inputs with a 44 px label are exempt. 44 px is Apple's and WCAG 2.5.5 (AAA) size; `tools/check_site.js` gates at the 24 px AA minimum |
| Overflow 390 | The document is wider than 390 px. `clippedByCss` in the JSON says whether `overflow-x: hidden` hides the scrollbar but still cuts content off |
| Img no alt | `<img>` without an `alt` attribute (`alt=""` is fine for decoration) |
| axe serious (contrast) | axe-core 4.10.2 with the WCAG 2.0, 2.1 and 2.2 A and AA rules: critical plus serious nodes, with colour-contrast nodes in brackets. The top rules are in the JSON |
| Overlay on 1st screen | Share of a 6x10 grid of points covered by a fixed-position layer taller than 15% of the screen, labelled pop-up, cookie banner or fixed layer. It is read about a second after load, so pop-ups on a longer timer are missed |
| OG | `og:title` and `og:image` present (partial: some Open Graph tags) |
| Dark | yes if emulating `prefers-color-scheme: dark` darkens the background at four sample points or the body, or lightens the text. always-dark if it is dark to begin with. The JSON also counts `prefers-color-scheme: dark` CSS rules it can read |
| Lang | A language switcher, an `hreflang` link, a link to a Spanish version (`/es/`, `?lang=es`, `es.` host) or a translation widget (Weglot, Google Translate and others). "ES" means Spanish was found |
| Video | `<video>` elements, plus embeds from YouTube, Vimeo, TikTok, Wistia, Mux, Cloudflare Stream and others. "autoplay" when one autoplays |
| Share | Share or copy-link buttons, share-intent links (X, Facebook, WhatsApp, Telegram, Bluesky, Threads, SMS or email with a body), or the page reading `navigator.share`. To see feature detection on desktop Linux Chromium, which has no Web Share, the tool defines a read-only `navigator.share` that returns `undefined` |
| Sign-up fields | Text, email, phone and select fields in the first visible form that has an email or phone field (search and log-in forms are skipped). Checkboxes are counted separately in the JSON. "hidden" means that form is not on screen |

The CTA vocabulary is `CTA_WORDS` in the tool: join, sign up, register, donate, contribute, chip in,
give, volunteer, RSVP, get involved, take action, pledge, subscribe, shop, buy, order, add to bag or
cart, get started, start, try, download, get the app, become a member, apply, book, tickets,
reserve, claim, enroll, create, host, find a chapter, vote, make a plan, and the Spanish únete,
inscríbete, regístrate, dona, donar, donación, contribuye, voluntario or voluntaria, participa,
compra, suscríbete, empieza, vota and reserva. Matches need whole words, the text must be 60
characters or fewer, and cookie, consent, menu, search and sign-in controls are ignored.

### Score

The leaderboard is ordered by a 0 to 100 score so it reads top to bottom. It is a judgment call,
so read the raw columns before quoting it. The weights (in `scoreOf`) are:

| Part | Points | Full marks | Zero |
|---|--:|---|---|
| Page weight | 15 | 0.5 MB or less | 10 MB (log scale between) |
| LCP | 15 | 2.5 s | 4.0 s |
| CLS | 10 | 0.1 | 0.25 |
| First CTA visible | 10 | 1.5 s | 5 s, or none |
| CTA focus | 5 | 1 or 2 distinct CTAs on the first screen (3 gets 4; 4 or 5 get 2) | none, or 6 or more |
| Tap targets | 5 | none under 44 px | half of them under 44 px |
| No overflow | 5 | | overflows at 390 px |
| axe | 15 | no critical or serious nodes | 40 or more |
| Alt text | 5 | every image has alt | 5 or more without |
| Features | 15 | 3 each: Open Graph (title, image, description), dark mode, language toggle, share affordance, sign-up form of 1 to 4 fields (5 or more fields gets 1.5) | |

If axe is skipped, the other parts are scaled up to 100. Blocked and timed-out sites get no score
and are listed under "Not measured" with the reason.

### Read the numbers with care

- **Lab numbers, one load each.** Timings vary from run to run. With `--throttle none`, our pages
  come from 127.0.0.1 and competitors from the internet, so our timings look better than they
  are. Use `--throttle 4g` before quoting a timing. Bytes, requests and the checks are fair as is.
- **Pop-ups and banners come and go.** Many brand sites open an email pop-up or cookie banner on
  a timer or by region, so the overlay, CTA and tap-target numbers can change between runs.
  The screenshots in `screens/` show what the tool saw.
- **Blocked sites.** A site that answers 401, 403, 405, 406, 429 or 503, shows a bot check, or
  cannot be reached through the network proxy is marked blocked. It is not retried and the
  check is not bypassed. `yrnf.com` showed a bot check in the Nov 9 research run but loaded in
  later runs.
- **Heuristics.** The CTA, language, share and sign-up detectors read the page's own DOM. They do
  not see inside cross-origin iframes or closed shadow roots, so a pop-up built in an iframe
  shows up as an overlay, not as a CTA.

### Targets file

`tools/bench_targets.json` has an `about` note, a `verified` date and one array per group of
`{name, url, note}`. On Nov 9, 2026 each URL was fetched with curl, redirects followed, and
the page title checked; each entry is the address the URL settled on. Two requested domains were not
the organization's site:

- `yri.org` is a GoDaddy domain-for-sale page, so the Young Republican National Federation's own
  `yrnf.com` is used.
- `poppi.com` redirects to a domain-for-sale page, so the brand's `drinkpoppi.com` is used.

`right` also lists both national College Republicans organizations (CRNC at `crnc.org` and College
Republicans of America at `uscollegegop.com`). To add a group, add another array; it becomes
`--group <name>`.

## Tests

```sh
node tests/infra/harness.test.js           # about 20 seconds
node tests/infra/harness.test.js bench     # only tests whose name contains "bench"
```

The suite shoots `site-good`, `site-bad` and `site-empty`, plus a page of its own with dark-mode
CSS and a lazy image 3,000 px down. It checks image sizes, the light and dark background pixels,
scale 2, the contact sheets, a missing page (exit 1) and bad arguments (exit 2). For the
benchmark it builds a page with known answers: two identical CTAs, a cookie-banner CTA, an
invisible CTA and one far down the page, a late banner that shifts the layout, tiny buttons, a 600 px
overflow, an image without alt, a video, copy-link and WhatsApp links, a three-field form, an
`hreflang` Spanish link and dark-mode CSS. It measures that page against `site-good` and against
three local servers standing in for blocked competitors: one that never answers (timeout), one
that answers 403 and one that shows a "Just a moment..." bot check. The suite never loads a
competitor site (the one possible download is axe-core from cdnjs, when it is neither installed nor
cached in `tools/.cache/`); to try the real targets, run `npm run bench`.
