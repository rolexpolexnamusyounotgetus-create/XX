# Deploying the site

Step by step: preflight, the hosts (Cloudflare Pages, Netlify, GitHub Pages), a custom domain,
environment variables for the functions, switching `config.js` from demo to production,
self-hosting fonts and photos, and the launch checklist.

Host facts below were checked against each host's documentation on Mon Nov 9, 2026 (links inline).
Hosts change their dashboards often. If a menu name differs, search their docs for the setting.
For the hosting comparison (cost, free-plan limits and why Cloudflare Pages is the primary), see
`docs/research/06-tech-portability-compliance.md`, section 1.

The site is the `youngsemdem/` folder of this repository. Every path below is relative to it.

---

## 0. Preflight (every deploy)

```sh
cd youngsemdem
npm run preflight      # = sync:check + csp:check + manifest:check + check
npm test               # core, video and tooling tests
```

- `python3 tools/sync_partials.py --check` fails if a page has stale shared markup. Fix it with `npm run sync`.
- `node tools/csp.js --check` fails if `_headers` no longer matches the endpoints in `config.js`. Fix it with `npm run csp`.
- `node tools/manifest.js --check` fails if the manifest name or colours drifted from `config.js`. Fix it with `npm run manifest`.
- `node tools/check_site.js` must end with `0 errors`. Read the warnings, and open `tools/check_report.json` for details.

## 1. What gets deployed

The whole folder is published as is (`publish = "."`). Nothing is built. Folders the site never
links (`tools/`, `tests/`, `docs/`, `partials/`, `functions/`, `netlify/`) also get uploaded,
because neither host has an ignore file for a no-build deploy. They contain no secrets. They are
handled like this:

- `_headers` sends `X-Robots-Tag: noindex, nofollow` for them, on both hosts.
- `robots.txt` disallows them.
- On Netlify, `netlify.toml` answers 404 for them (forced rules). Cloudflare `_redirects` cannot
  send a 404 ([redirects docs](https://developers.cloudflare.com/pages/configuration/redirects/)),
  so on Cloudflare they stay reachable by direct URL.

Pages the design team must still add: **`404.html`** and **`offline.html`**.

- Without a top-level `404.html`, Cloudflare Pages treats the site as a single-page app and answers
  every unknown URL with the home page and a 200 status
  ([serving pages](https://developers.cloudflare.com/pages/configuration/serving-pages/)).
- `sw.js` shows `offline.html` when a visitor is offline. Until that page exists, it shows a plain
  built-in page instead.

## 2. Cloudflare Pages (recommended)

Cloudflare reads `_headers`, `_redirects` and `functions/`. It ignores `netlify.toml` and
`netlify/`.

### 2a. Direct upload with Wrangler (fastest; includes Functions)

Run these from the `youngsemdem/` folder:

```sh
npx wrangler login
npx wrangler pages project create youngsemdems      # once; pick the production branch name it asks for
npx wrangler pages deploy . --project-name youngsemdems
```

Wrangler uploads the folder and compiles `functions/` from the directory you run it in. The
**dashboard drag-and-drop upload does not compile Functions** (Cloudflare lists this as a known
issue), so use Wrangler whenever `/api/*` must work
([direct upload](https://developers.cloudflare.com/pages/get-started/direct-upload/),
[known issues](https://developers.cloudflare.com/pages/platform/known-issues/)). Drag-and-drop is
fine for a static-only preview.

### 2b. Git integration (deploys on every push)

Go to Workers & Pages, then Create, then Pages, then Connect to Git, and pick this repository.

| Setting | Value |
|---|---|
| Framework preset | None |
| Root directory (advanced) | `youngsemdem` (the repository holds other projects) |
| Build command | `exit 0` (Cloudflare's instruction when no preset is used) |
| Build output directory | `/` (the root directory itself) |

([build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/))

After the first deploy, check that Functions were picked up. Open
`https://<project>.pages.dev/api/video-upload`. A JSON reply, even an error, means the function
runs. If you get the home page or a 404 page, the functions folder was not found: recheck the root
directory setting.

### 2c. Behaviour to know

- `/about.html` redirects to `/about`, and `/about` serves `about.html`. Canonical URLs should use
  the extensionless form: `tools/make_sitemap.py` does by default, and so does `{{site}}{{path}}`
  in a partial.
- Neither `_headers` nor `_redirects` applies to Functions responses. The functions set their own
  headers ([headers](https://developers.cloudflare.com/pages/configuration/headers/),
  [redirects](https://developers.cloudflare.com/pages/configuration/redirects/)).
- Limits: 100 header rules, 2,000 characters per `_headers` line, and 2,000 static plus 100
  dynamic redirects. `tests/infra/tooling.test.js` checks the header limits.
- Preview deployments get their own `*.pages.dev` URLs. They are noindex while the demo header is
  in place.

## 3. Netlify (staging twin, or a drag-and-drop demo)

Netlify reads `_headers`, `_redirects` and `netlify.toml`. It ignores `functions/`.
`netlify.toml` points Netlify at `netlify/functions/` and rewrites `/api/*` to them, so the
browser config uses the same `/api/video-upload` URL on both hosts.

### 3a. Drag and drop (Netlify Drop), static only

Drag the `youngsemdem` folder onto <https://app.netlify.com/drop>. You get the static site with
no build ([Netlify Drop](https://docs.netlify.com/start/quickstarts/netlify-drop-quickstart/)).
Treat it as **static only**: Netlify documents Drop for static folders, and users report that
functions do not deploy from it. Use Git or the CLI for `/api/*`, and keep `demo: true` on a Drop
deploy.
Netlify reads `_headers` and `_redirects` from the published folder. Check them after the deploy:

```sh
curl -sI https://<site>.netlify.app/ | grep -i -E 'content-security-policy|x-robots-tag'
```

### 3b. Git deploys

Go to Add new project (older dashboards call it Add new site), then Import an existing project,
and pick this repository. Then:

| Setting | Value |
|---|---|
| Base directory | `youngsemdem` (where `netlify.toml` lives) |
| Build command | empty |
| Publish directory | `.` (set by `netlify.toml`, relative to the base) |
| Functions directory | `netlify/functions` (set by `netlify.toml`) |

### 3c. CLI deploys (static site plus functions, no Git)

```sh
cd youngsemdem
npx netlify-cli login
npx netlify-cli deploy            # draft URL; reads netlify.toml (publish + functions)
npx netlify-cli deploy --prod
```

Notes:
- Redirect order: Netlify runs every `_redirects` rule first, then the `netlify.toml` rules, and
  the first match wins. A non-forced rule does not apply when a file exists at that path
  ([redirects](https://docs.netlify.com/manage/routing/redirects/overview/)). Shared rules stay
  in `_redirects`, and Netlify-only forced rules stay in `netlify.toml`.
- Headers live only in `_headers`. Netlify documents no merge rule for a header that is set in
  both `_headers` and `netlify.toml` ([headers](https://docs.netlify.com/manage/routing/headers/)),
  so `netlify.toml` sets none.
- Netlify's credit-based free plan pauses the whole site when credits run out. Research report 06
  has the numbers. Watch usage if the demo goes viral there.

## 4. GitHub Pages (read-only mirror only)

GitHub Pages serves static files only:

- **No functions**: no uploads and no join proxy, so keep `demo: true`.
- **No `_headers` or `_redirects`**: no CSP header, no noindex header and no `/go/*` short links.
- A branch deploy can publish only the repository root or `/docs`
  ([publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)).
  The site lives in `youngsemdem/`, so publish it with a GitHub Actions workflow that uploads that
  folder (for example `actions/upload-pages-artifact` with `path: youngsemdem`, then
  `actions/deploy-pages`). An Actions deploy does not run Jekyll. A branch deploy does, and Jekyll
  drops files and folders whose names start with `_`, so add an empty `.nojekyll` file there.
- Limits: published sites up to 1 GB, a soft 100 GB per month of bandwidth, and the site must not
  be a free host for a business or for sensitive transactions
  ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)).
- It serves a custom `404.html`.

## 5. Custom domain and DNS

Register the domain to an organization email, with auto-renew and two admins (research report 06,
section 1.3). Then do the steps for your host.

**Cloudflare Pages**
([custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)):
1. In the project, go to Custom domains, then Set up a domain, and enter the domain. **Add it here
   first.** Creating the CNAME before adding the domain in the dashboard makes it fail, usually
   with a 522 error.
2. Subdomain (for example `www.example.org`): add a CNAME at any DNS provider, pointing at
   `<project>.pages.dev`.
3. Apex (`example.org`): the domain must be a zone on the same Cloudflare account. Change the
   registrar's nameservers to Cloudflare's, and Cloudflare then creates the record.

**Netlify**
([external DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/)):
1. Go to Domain management, then Add a domain. Netlify adds both the apex and `www`.
2. Apex: add an ALIAS, ANAME or flattened CNAME record pointing at
   `apex-loadbalancer.netlify.com`. If your DNS provider supports none of those, add an A record
   pointing at `75.2.60.5`.
3. `www` or another subdomain: add a CNAME pointing at `<site>.netlify.app`. Netlify shows the
   exact record under Pending DNS verification.
4. Propagation can take up to a day. HTTPS certificates are issued automatically.

**Then, in the site**
- Set `site.url` in `assets/js/config.js` to `https://<domain>`, with no trailing slash (section 7).
- Run `npm run sync`. Partials that use `{{site}}{{path}}` then get absolute canonical and
  `og:url` values.
- Run `python3 tools/make_sitemap.py --robots` to write `sitemap.xml` and the `Sitemap:` line in
  `robots.txt`.
- Optional: set `ALLOWED_ORIGINS=https://<domain>` for the video function (section 6).

## 6. Environment variables (functions only)

Set these in the host dashboard, never in the repository or in `config.js`. `config.js` ships to
every browser.

- Cloudflare: Pages project, then Settings, then Variables and Secrets. Encrypt the tokens. For
  local `wrangler pages dev`, put them in `youngsemdem/.dev.vars`, which is git-ignored.
- Netlify: Site configuration, then Environment variables, with scope Functions. For local
  `netlify dev`, put them in `.env`, which is git-ignored.

**Video uploads** (`functions/api/video-upload.js` and `netlify/functions/video-upload.js`; the
full table is in `docs/infra/video.md`):

| Variable | Needed for |
|---|---|
| `VIDEO_PROVIDER` | `cloudflare` or `mux` (default: whichever is configured) |
| `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN` | Cloudflare Stream direct creator uploads (token with Stream Edit permission) |
| `CF_STREAM_CUSTOMER_CODE`, `CF_STREAM_REQUIRE_SIGNED_URLS`, `CF_STREAM_ALLOWED_ORIGINS` | optional Stream settings |
| `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET` | Mux direct uploads (Mux Video read and write) |
| `MUX_PLAYBACK_POLICY`, `MUX_VIDEO_QUALITY`, `MUX_CORS_ORIGIN` | optional Mux settings |
| `VIDEO_MAX_BYTES`, `VIDEO_MAX_DURATION_SECONDS` | upload limits (defaults 150 MB, 180 s) |
| `ALLOWED_ORIGINS` | optional comma list of allowed site origins |
| `TURNSTILE_SECRET_KEY` | optional anti-abuse check on upload requests |

**Join form and webhooks.** No join function exists yet. The browser posts to whatever
`integrations.formEndpoint` names:

- **Netlify Forms**: set `formEncoding: 'form'` and `formName`. Configure notifications and
  outgoing webhooks in Netlify, under Forms, then Form notifications. This needs no env var.
- **A hosted form service** (an https endpoint): no env var. Run `npm run csp` so the CSP
  `connect-src` allows its origin.
- **Action Network through your own proxy** (`integrations.actionNetwork.endpoint`): the proxy
  function, still to be written, keeps the Action Network API key in an env var and sends it as
  the `OSDI-API-Token` header. The key never goes in `config.js`.

After changing any endpoint in `config.js`, run `npm run csp`, then redeploy.

## 7. Switching `config.js` from demo to production

`assets/js/config.js` documents every key; `docs/infra/core.md` has the table. For a staging copy,
you can put overrides in `assets/js/config.local.js`, loaded before `config.js`. That file is
git-ignored, so it never deploys from Git. Put production values in `config.js` itself.

1. `site.url`: `https://<domain>` (canonical, share URLs, calendar UIDs, sitemap).
2. Party-controlled links: confirm every `links.*` URL in a browser (ActBlue blocks scripts), then
   uncomment the matching `/go/*` lines in `_redirects` if you want short links.
3. `social.*.url`: only accounts the organization really controls. `''` hides a link.
4. `integrations.*`: the endpoints from section 6, then `analytics.provider` (`cloudflare` or
   `plausible`) with its token or domain.
5. `legal.paidFor` (and any Spanish or short variants core adds): the exact wording from the party
   and counsel (section 9).
6. `demo: false`. Demo baselines, demo clips and simulated squads disappear, and real network
   calls start. The service worker also turns on (`pwa.serviceWorker`, default on outside demo).
7. Run the generators and checks:
   ```sh
   npm run csp && npm run manifest && npm run sync
   python3 tools/make_sitemap.py --robots
   npm run credits
   npm run check:strict
   ```

**Service worker settings** (read by `assets/js/sw-register.js`; change them in the `pwa` block of
`config.js`, or override it in `config.local.js`):

| Key | Default | Meaning |
|---|---|---|
| `pwa.serviceWorker` | `true` | `false` turns the worker off everywhere and unregisters it for returning visitors |
| `pwa.serviceWorkerInDemo` | `false` | Demo deploys change often, so no caching in demo unless this is `true` |
| `pwa.swUrl` | `'sw.js'` | Worker path, relative to the site root |

On each deploy that changes JS, CSS or data, bump `VERSION` in `sw.js` (`ysd-v1`, then `ysd-v2`).
Every old cache is then dropped at once. Pages are always fetched network-first. Assets are served
from cache while they refresh, so without a bump, returning visitors see new assets one page load
later. To kill the worker while debugging, add `?sw=0` to any page URL.

## 8. Self-host fonts and photos before launch

Hotlinked third-party files cost a DNS lookup and a connection each. They also leak visitor IPs to
those hosts, and they break if the host changes. `CREDITS.md` (`npm run credits`) lists every
remote file and where it is used.

**Fonts (Google Fonts)**
1. Download each family's `woff2` files, Latin subset (plus Latin Extended for Spanish
   accents), into `assets/fonts/`. Check each family's license on fonts.google.com; most use the
   SIL Open Font License.
2. Replace the `fonts.googleapis.com` `<link>` with `@font-face` rules (`font-display: swap`) in
   the site CSS. Preload the one or two files used above the fold.
3. Remove the hosts from the CSP. Add this to `config.js`:
   `csp: { remove: { 'style-src': ['https://fonts.googleapis.com'], 'font-src': ['https://fonts.gstatic.com'] } }`,
   or pass `--remove` flags to `tools/csp.js`. Then run `npm run csp`.
4. `assets/fonts/*` is cached for 30 days with `Access-Control-Allow-Origin: *` (`_headers`).
   Rename a file when you replace it.
5. List the font specs in `cards.fonts` in `config.js`, so share cards wait for the fonts.

**Photos (Unsplash and others)**
1. Download each photo at the size you need (`data/clips.js` records a `downloadUrl` for each
   photo it uses). Compress it to WebP or AVIF with a JPEG fallback, and save it under
   `assets/img/`.
2. Point the HTML, CSS and data at the local copies. Keep the photographer and source page next to
   each one: a `photographer` and `page` key in data files, or `data-credit` on the tag.
3. Run `npm run credits`. `CREDITS.md` should list no remote photos, or only the ones you mean to
   keep. Remove `https://images.unsplash.com` from `img-src` the same way as the font hosts.
4. The Unsplash License allows this without attribution; credits are kept anyway
   ([license](https://unsplash.com/license)). Real members' photos need their consent, and for
   minors, a parent's.

## 9. Launch checklist

**Legal and policy** (not legal advice; the party and its counsel decide)
- [ ] **Florida paid-for disclaimer.** Fla. Stat. 106.143 (2026) governs political advertisement
      disclaimers. 106.143(1)(c) requires a non-candidate political ad to carry "paid political
      advertisement" or "pd. pol. adv." with the payer's name and address. 106.143(10) covers
      internet ads, such as short paid links that lead to a compliant website
      ([statute](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html)).
      Get the exact wording, the paying entity and its address from the party and counsel, set
      `legal.paidFor`, and show it in the footer partial on every page and on share cards. Research
      report 06, section 7.1, has the details and decisions (who pays, and political committee
      status).
- [ ] **Privacy policy page**, linked from the footer and from every form. Cover what is collected
      (join form fields, referral codes, video uploads, analytics), where it goes (list tool, video
      provider, analytics provider), retention, contact (`legal.privacyEmail`), and how to delete
      data. Cover minors too: members can be as young as `org.minAge`. Add SMS terms if texting is
      offered (research report 06, sections 7.2 and 7.4).
- [ ] Content policy and moderation for member video: uploads stay `review: pending`
      (`docs/infra/video.md`).
- [ ] Every fact on the site has a dated source. No demo numbers remain (`demo: false`).

**Technical**
- [ ] `404.html` and `offline.html` exist. The PWA icons exist in `assets/icons/`
      (`icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and a favicon is set.
- [ ] `site.url` is set. Run `npm run sync`, `npm run csp` and `npm run manifest`, then
      `python3 tools/make_sitemap.py --robots`.
- [ ] **Delete the `X-Robots-Tag: noindex` line from the `/*` block in `_headers`.** The demo keeps
      it so search engines skip the demo while link previews still work. Keep the noindex rules for
      the internal folders.
- [ ] Every page has a title, a description, an absolute canonical, `og:title`, `og:description`,
      an absolute `og:image` (1200x630) and `twitter:card`. Test a share on each network.
- [ ] Fonts and photos are self-hosted, or a deliberate exception is listed in `CREDITS.md`.
- [ ] Env vars are set for the functions you use, `/api/video-upload` answers JSON, and a host
      rate-limit rule is set on `/api/*`.
- [ ] `npm run check:strict` ends with `0 errors` (axe-core included). `npm test` passes.
- [ ] Bump `VERSION` in `sw.js`.
- [ ] Check the response headers on the live site:
      `curl -sI https://<domain>/ | grep -i -E 'content-security|strict-transport|x-robots'`.
- [ ] The analytics provider is configured and respects Do Not Track and Global Privacy Control
      (`integrations.analytics`).
