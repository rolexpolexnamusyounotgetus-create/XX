# 06 · Technical architecture, portability and compliance for youngsemdem

*Research for the youngsemdem demo site (Young Seminole Democrats: Seminole County, FL Democrats aged 40 and under). Compiled Monday, November 9, 2026, six days after the Nov 3 general election. Scope: static hosting with custom domains, Claude through a serverless proxy, member video, the organizing tools Democrats actually use, analytics and share previews, WCAG 2.2 AA, and the compliance basics (Florida disclaimers, SMS consent, email, minors, privacy). It ends with a recommended folder layout, a config schema for every swappable value, and a launch checklist.*

*Method. Every vendor fact comes from that vendor's own documentation or pricing page, fetched on Nov 9, 2026. Every legal fact comes from the statute or rule text (Online Sunshine for Florida, Cornell LII for federal rules), also fetched on Nov 9. The web-search quota for this run was used up by parallel research agents before this report started, so sources were read directly from known primary URLs. A few pages refused the fetch tool (fcc.gov, ActBlue's help center, X's developer docs); those claims are marked and rated lower. Model IDs and prices come from Anthropic's live pricing and models pages, cross-checked against the claude-api skill reference. Quotes are kept to a few words; everything else is paraphrased. Nothing here is legal advice: section 7 lists the questions a Florida election lawyer must answer before launch.*

*Confidence key. **[high]**: primary source read directly, current. **[med]**: primary source read only in part, an inference from primary text, or a well-established practice I could not re-verify this session. **[low]**: unverified or from memory; check before relying on it.*

*Project files this builds on: `assets/js/config.js` (every swappable value, already in place), `docs/infra/core.md` (the production seam), `functions/api/video-upload.js` and `netlify/functions/video-upload.js` (the video upload twins), `tests/infra/core.test.js`, and research reports 02 to 05 in this folder.*

---

## Headline

Ship youngsemdem as a plain static site (HTML, CSS, vanilla JS, no framework) on **Cloudflare Pages**, keep the Netlify function twins as a portable fallback, and put only the few things that need a secret (video upload tickets, join forwarding, a cached Mobilize feed and, only if Kira re-approves it, a Claude helper) behind same-origin `/api/*` functions. Cloudflare serves static requests free and without limit, which matters for a site built to go viral. Netlify's credit-based free plan pauses the whole site with a "Site not available" page once its 300 monthly credits run out, at 15 credits per production deploy and 20 per GB of bandwidth. GitHub Pages has no functions, and Vercel's free tier is limited to personal, non-commercial use. Portability is mostly done already: `assets/js/config.js` holds every public swappable value, and secrets live only in function environment variables. Three gaps remain. Open Graph and canonical URLs must be absolute in the static HTML, because crawlers do not run JavaScript. A small stamp script should write the real domain into the HTML, `sitemap.xml` and `_headers` at deploy. Function responses must set their own security headers, because neither host applies `_headers` to them. On Claude, the repo records that Kira cut the chat assistant, and the core tests enforce it, yet her new brief asks for more Claude. So this report recommends visible, human-reviewed Claude work at build time now, plus an isolated, opt-in "Ask" module she can switch on. That module would default to `claude-opus-5-5` ($4/$20 per million tokens, roughly 1.3 cents per answer under the assumptions below; Sonnet 5.5 and Haiku 5.5 are cheaper options for her to choose). It would sit behind Turnstile, per-IP rate limits and a dedicated Console workspace spend cap. It would say it is an AI at the start of every chat, which Anthropic's usage policy (effective Nov 12, 2026) requires. And it would be link-only on voting logistics: it never states a polling place, date or deadline unless that fact is in a dated, curated file, and it always links voteseminole.gov. For video, start by letting members post links to their own TikTok and YouTube clips, played through the official embed players behind click-to-load posters. Then add direct uploads through Mux (free auto-captions, 100,000 free delivery minutes a month) or Cloudflare Stream ($5 per 1,000 stored minutes plus $1 per 1,000 delivered). Both are already wired in the repo, and every upload waits for human review. **Compliance, not code, is the launch blocker.** Under Fla. Stat. 106.143(1)(c), a paid page that expressly advocates for a candidate or issue must carry "paid political advertisement" (or "pd. pol. adv.") with the payer's name and address. Section 106.1437 does not cover websites at all. Whether the club is a political committee (over $500 a year, Fla. Stat. 106.011(16)) decides the payer line, ActBlue use and Campaign Verify eligibility for political texting. SMS opt-in needs CTIA-style disclosures and stored consent records. Email should meet CAN-SPAM and Gmail's bulk-sender rules even where political mail is not "commercial". And the WCAG failures most common on real sites (low contrast, missing alt text, unlabeled fields, empty icon buttons) are exactly the ones a poppy, video-heavy, share-button-heavy site is most likely to ship.

---

## Read this first: three decisions only Kira (and the party) can make

| # | Decision | Why it blocks | Default this report assumes |
|---|---|---|---|
| D1 | **Is a runtime Claude feature back on?** `config.js` and `docs/infra/core.md` say there is "deliberately NO chat assistant" (cut by Kira, Nov 2026), and `tests/infra/core.test.js` fails if `anthropic`, `claude` or `askEndpoint` appears in core files. Kira's newest brief says to put Claude in harder. | Writing an `/api/ask` function silently reverses her decision. | Build-time Claude now; the runtime module is designed (section 2) but stays off until she says yes. |
| D2 | **Which legal entity runs and pays for the site?** Report 02 found an existing chartered club, the Young Democrats of Seminole County (YDSC), on ActBlue with $20 dues and ages 14 to under 40. | Sets the disclaimer payer line (106.143), political committee status (106.011(16)), ActBlue and Campaign Verify eligibility, and who owns the domain. | Everything payer-related stays a `[PLACEHOLDER]` in `config.legal`. |
| D3 | **Which list is the list of record?** Action Network, SemDems' Solidarity Tech (act.semdems.com, per report 02), EveryAction or VAN through the state party, or a newsletter tool. | Decides how the join form is wired and where SMS consent lives. | Action Network (the repo already targets it), with a beehiiv fallback. |

---

## 1. Static hosting and custom domains

### 1.1 Comparison (checked Nov 9, 2026)

| | **Cloudflare Pages** | **Netlify** (credit plans, accounts since Sep 4, 2025) | **GitHub Pages** | **Vercel** |
|---|---|---|---|---|
| Free static traffic | Static requests **free and unlimited** on all plans ([Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)) [high] | 300 credits/month: bandwidth 20 credits/GB, web requests 2 credits per 10,000, **production deploy 15 credits** ([pricing](https://www.netlify.com/pricing/), [how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)) [high] | 100 GB/month soft limit, 1 GB site ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) [high] | Hobby: 100 GB fast data transfer, 1M function invocations ([Hobby](https://vercel.com/docs/plans/hobby)) [high] |
| What happens at the limit | Function requests stop at 100,000/day (shared with Workers), resetting at midnight UTC; static pages keep serving ([pricing](https://developers.cloudflare.com/pages/functions/pricing/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) [high] | **All projects paused** behind a "Site not available" page. Free cannot buy more credits ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/)) [high] | Possible HTTP 429s ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) [high] | Wait 30 days for most features ([Hobby](https://vercel.com/docs/plans/hobby)) [high] |
| Serverless functions | Pages Functions (`functions/`), Workers runtime; free CPU 10 ms per request, no wall-clock cap while streaming ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) [high] | Netlify Functions, web `Request -> Response`; streaming limited to 60 s and 20 MB ([Functions API](https://docs.netlify.com/build/functions/api/)) [high] | None [high] | Yes; Hobby functions up to 300 s ([Hobby](https://vercel.com/docs/plans/hobby)) [high] |
| `_headers` / `_redirects` | Both; 100 header rules, 2,100 redirects; **not applied to Functions** ([headers](https://developers.cloudflare.com/pages/configuration/headers/), [redirects](https://developers.cloudflare.com/pages/configuration/redirects/)) [high] | Both, plus `netlify.toml`; **not applied to function responses** ([headers](https://docs.netlify.com/manage/routing/headers/), [redirects](https://docs.netlify.com/manage/routing/redirects/overview/)) [high] | No custom headers (meta-tag CSP only) [med: the limits page is silent; no header feature is documented] | `vercel.json` (not checked) |
| Custom domain + HTTPS | Up to 100 per project. Apex needs the zone on Cloudflare DNS; a subdomain works by CNAME from any DNS ([custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)) [high] | Included on Free ([pricing](https://www.netlify.com/pricing/)) [high] | A/AAAA or ALIAS records, plus "Enforce HTTPS" ([custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)) [high] | 50 domains per project on Hobby [high] |
| Use terms | No restriction found | No commercial-use restriction stated on the pricing page [med] | Not for running a business or e-commerce site ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) [high] | **Hobby is "non-commercial personal use only"**; donations alone are not commercial ([fair use](https://vercel.com/docs/limits/fair-use-guidelines)) [high]. A club site is not personal use [med]. |
| Built-in extras that matter here | Turnstile, Stream, Web Analytics, WAF rate-limit rule (1 free) | Forms "free and unlimited" on credit plans ([Forms billing](https://docs.netlify.com/manage/forms/usage-and-billing/)); code-based rate limits on all plans ([rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)) | none | Web Analytics (50,000 events) |

### 1.2 Findings

1. **Cloudflare Pages Free is the only option where a viral spike costs nothing and cannot take the site down.** Static asset requests are free and unlimited on every plan, and a request counts as static whenever it does not invoke a Function ([Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/)) [high]. The free plan allows 500 builds a month, 20,000 files per site, 25 MiB per file and 100 custom domains per project (page updated Sep 5, 2026) ([Pages limits](https://developers.cloudflare.com/pages/platform/limits/)) [high]. The repo's 7 demo MP4s fit under 25 MiB each, but real member video should never be served from Pages (section 3).
2. **Netlify's new free plan is risky for a viral site.** Free gets 300 credits a month. A production deploy costs 15 credits, a GB of bandwidth 20. When the credits run out, every project is paused until the next cycle, and Free cannot buy more ([how credits work](https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/), [pricing](https://www.netlify.com/pricing/)) [high]. Twenty deploys use the whole month, and so would about 15 GB of traffic. Deploy previews, branch deploys and failed deploys are free, and Netlify Forms is free and unlimited on credit plans [high]. Personal is $9/month for 1,000 credits ([pricing](https://www.netlify.com/pricing/)) [high]. Netlify stays useful as a staging twin and as an exit path.
3. **GitHub Pages fits only a read-only mirror.** It has no functions, so no uploads, join proxy or Claude. Its terms say it is not a free host for a business or e-commerce site, and its limits page documents no custom headers ([limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)) [high/med]. Its custom-domain setup is clean: four A records, optional AAAA, a `www` CNAME, verify the domain first to prevent takeover, then "Enforce HTTPS" ([custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)) [high].
4. **Vercel Hobby is off the table for an organization.** Vercel limits Hobby to non-commercial personal use. Asking for donations is explicitly not commercial ([fair use](https://vercel.com/docs/limits/fair-use-guidelines)) [high], but a political club's site is not a personal project. Pro charges $20 per developer seat per month ([Hobby page](https://vercel.com/docs/plans/hobby)) [high]. Whether a volunteer club counts as "personal" is my reading, not Vercel's [med].
5. **Neither host applies `_headers` or `_redirects` to function responses.** Cloudflare says header rules skip responses generated by Pages Functions, and redirect rules skip requests that Functions handle ([headers](https://developers.cloudflare.com/pages/configuration/headers/), [redirects](https://developers.cloudflare.com/pages/configuration/redirects/)). Netlify says custom headers do not apply to serverless or edge function responses ([headers](https://docs.netlify.com/manage/routing/headers/)) [high]. So every `/api/*` function must set its own `Cache-Control`, `X-Content-Type-Options` and CORS headers. `video-upload.js` already sets the first two.
6. **The two `_redirects` dialects differ in ways that bite.** Cloudflare defaults to 302, Netlify to 301. Cloudflare's 200 proxying works only for paths on the same site, and its `_redirects` cannot redirect between hostnames; it points to Bulk Redirects instead ([CF redirects](https://developers.cloudflare.com/pages/configuration/redirects/)). Netlify's `_redirects` can match a whole old domain when that domain is attached to the site ([Netlify redirects](https://docs.netlify.com/manage/routing/redirects/overview/)) [high; the domain-level example on that page is Netlify convention, med]. **Always write the status code explicitly** and keep domain-level redirects out of the shared file.
7. **Apex domains on Cloudflare Pages need Cloudflare DNS.** A subdomain needs only a CNAME to `<project>.pages.dev`. Adding the CNAME before adding the domain in the dashboard causes 522 errors. Cloudflare suggests Bulk Redirects to send the production `*.pages.dev` hostname to the custom domain, and Access to protect preview URLs ([custom domains](https://developers.cloudflare.com/pages/configuration/custom-domains/)) [high].
8. **Pages vs Workers.** Cloudflare's migration guide (updated Oct 12, 2026) presents Workers with static assets as the broader platform: Durable Objects, cron triggers, Workers Logs, gradual deployments. It supports `_headers` and `_redirects` natively, but custom domains outside a Cloudflare zone stay Pages-only ([migrate from Pages](https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/)) [high]. Pages remains right for launch because the repo already targets Pages Functions. Move to Workers only if you need cron jobs or a strict global rate limiter.

### 1.3 Recommendation: hosting and the move to a real domain

- **Primary:** Cloudflare Pages, connected to the Git repo with no build command and output directory `youngsemdem/` (or a later `dist/`). Functions in `functions/api/*` map to `/api/*` by file name.
- **Twin:** Netlify, for staging and as an exit path. Move the Netlify functions to the modern format with `export const config = { path: "/api/<name>", rateLimit: {...} }`. Same-origin `/api/*` URLs then work on both hosts with no redirect ([Functions get started](https://docs.netlify.com/build/functions/get-started/), [rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)) [high]. Today's legacy twin needs a `/api/video-upload` redirect.
- **Domain:** register it to an organizational email, with auto-renew and at least two admins (report 02 found lapsed young-Dem domains turned into a gambling site and a for-sale page). Put DNS on Cloudflare (free) so the apex works and the WAF rate-limit rule is available. Report 02 found `youngsemdems.com` registered by someone else through Dec 31, 2026, showing only a hosting error. Avoid confusion with it (see Open questions).
- **Cutover steps:** (1) Add the custom domain under Pages, then Custom domains. (2) Set `site.url` in `config.js` and run the stamp script (section 8). (3) Redirect `www` to the apex, and `*.pages.dev` to the apex with Bulk Redirects. (4) Update every origin allowlist: `ALLOWED_ORIGINS`, the Turnstile widget hostnames (10 per widget on Free, per [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)), `CF_STREAM_ALLOWED_ORIGINS`, `MUX_CORS_ORIGIN`. (5) Add SPF, DKIM and DMARC for the sending domain (section 7.4). (6) Add HSTS, but not `preload`, until the domain is permanent.

### 1.4 Shared header and redirect files (one copy works on both hosts)

```text
# _headers  (Cloudflare Pages and Netlify use the same syntax; functions set their own)
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: DENY
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Strict-Transport-Security: max-age=31536000; includeSubDomains
  Content-Security-Policy: default-src 'self'; script-src 'self' https://challenges.cloudflare.com <analytics host>; frame-src https://challenges.cloudflare.com https://www.tiktok.com https://www.youtube-nocookie.com <video player host>; img-src 'self' data: blob: <video thumbnail host>; media-src 'self' blob: <video stream host>; connect-src 'self' <analytics collector> <video upload host>; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; form-action 'self' https://actionnetwork.org; frame-ancestors 'none'; base-uri 'self'
/post/*
  Permissions-Policy: camera=(self), microphone=(self)
/manifest.webmanifest
  Content-Type: application/manifest+json
/assets/*
  Cache-Control: public, max-age=3600
```

The angle-bracket hosts depend on which analytics and video providers are switched on. Generate them from `config.csp` (section 8) and confirm each one in the browser's network panel [med: the exact upload and stream hostnames come back from the provider at runtime]. Use `immutable` year-long caching only once filenames are fingerprinted.

```text
# _redirects  (explicit status codes; no domain-level rules here)
/donate        <ActBlue form URL>?refcode=site_vanity          302
/events/rsvp   <Mobilize org URL>?utm_source=site&utm_medium=vanity 302
/qr/:code      /?utm_source=qr&utm_medium=print&utm_campaign=:code 301
/ig            <Instagram profile URL>                          302
```

Vanity and QR short links double as attribution for flyers and bios. That is the cheapest virality instrumentation there is.

---

## 2. Claude on the site: options, architecture, cost, guardrails

### 2.0 Where things stand, and the recommended options

- **Current repo decision:** no chat assistant. `assets/js/config.js` says so in its header. `docs/infra/core.md` says the same, and the core test scans core files for `anthropic|claude|askEndpoint|/api/ask` and asserts there is no `integrations.askEndpoint` and no `features.ask` [high: read in the repo].
- **Report 04** recommended two Claude features, both labeled and grounded in official sources: an "Ask" civic explainer and an invite-writer that drafts a text the member edits and sends themselves. Report 04 also found that 39% of Gen Z feel negative about AI-made ads, and that clear disclosure drives attention.
- **Option A (now, no runtime risk): Claude at build time.** Draft the Spanish copy, image alt text, caption cleanup for uploaded clips, share-card copy variants and FAQ answers with Claude. A fluent human reviews and commits each one, and the site's AI page says so. This adds nothing to the attack surface and costs pennies.
- **Option B (when Kira says yes): an isolated "Ask" module.** It lives in `assets/js/assistant.js`, `assets/js/config.assistant.js` and `functions/api/ask.js` (with a Netlify twin). None of these is a core file, so the core tests keep passing and the decision stays visible. It ships with `ASSISTANT_ENABLED=false` and a canned-answers demo mode that makes no API calls. Two narrow tools: **Explain** (civic explainer plus EN/ES translation) and **Invite** (drafts a personal text; the member sends it). No open-ended "chat about anything".
- **Option C (not recommended):** a general chatbot, a bot that answers voting logistics from model memory, or any generated faces or voices.

### 2.1 Models and prices (Anthropic live docs, Nov 9, 2026)

| Model (API ID) | Input / output per MTok | Cache read | 5-min cache write | Default effort | Notes |
|---|---|---|---|---|---|
| **Claude Opus 5.5** (`claude-opus-5-5`) | $4 / $20 | $0.20 | $5 | `medium` | Anthropic's suggested starting model; thinking always on; retirement not before Sep 22, 2027 |
| Claude Sonnet 5.5 (`claude-sonnet-5-5`) | $2 / $10 | $0.10 | $2.50 | `high` | Speed and intelligence balance |
| Claude Haiku 5.5 (`claude-haiku-5-5`) | $0.10 / $0.50 (prompts up to 100K tokens) | $0.01 | $0.125 | `medium` | Fastest; **no server-side refusal fallback** |

Sources: [pricing](https://platform.claude.com/docs/en/about-claude/pricing), [models overview](https://platform.claude.com/docs/en/about-claude/models/overview) [high]. All four current models have a 1M-token context, 128K max output and a June 2026 knowledge cutoff ([models overview](https://platform.claude.com/docs/en/about-claude/models/overview)) [high]. The knowledge cutoff alone rules out answering 2027 or 2028 election dates from memory.

### 2.2 What it would cost (estimates, not quotes)

Assumptions per answer: a 4,000-token cached system prompt plus facts pack, 600 uncached input tokens (recent turns plus the question) and 500 output tokens (visible text plus light thinking at low or medium effort).

| Model | Cost per answer (warm cache) | Extra per cold cache start | 3,000 answers/month (about 10% cold) |
|---|---|---|---|
| Opus 5.5 | about $0.013 | about $0.020 | **about $45** |
| Sonnet 5.5 | about $0.0066 | about $0.010 | about $23 |
| Haiku 5.5 | about $0.00035 | about $0.0005 | about $1.20 |

Arithmetic from the [pricing page](https://platform.claude.com/docs/en/about-claude/pricing) rates [med: the token counts are assumptions; measure real `usage` fields in staging]. Following the claude-api guidance, the default stays `claude-opus-5-5`. Choosing a cheaper model is Kira's budget call; the server reads `CLAUDE_MODEL` from an environment variable, so switching needs no code change.

### 2.3 Architecture

```text
browser (assistant.js)                 Cloudflare Pages Function /api/ask          Anthropic API
------------------------               -----------------------------------         -------------
1. AI disclosure shown                 a. Origin in ALLOWED_ORIGINS? else 403
2. Turnstile widget -> token  ----->   b. first call: verify token at siteverify
                                          -> set HttpOnly session cookie (HMAC, 30 min)
3. POST {tool, lang, messages[-8:]}    c. per-IP + per-session rate limit
                                       d. caps: input chars, turns, ASSISTANT_ENABLED
                                       e. strip emails/phones from text
                                       f. build request: cached system + facts pack,
                                          date and question AFTER the cache breakpoint  --> messages.stream
4. render streamed text  <---------    g. stream text deltas as SSE                   <-- SSE events
                                       h. on finish: enforce link allowlist, append
                                          official links, log counts only (no content)
```

- **The key never leaves the server.** The TypeScript SDK runs on Cloudflare Workers, Vercel Edge, Deno, Bun and Node 20+. Browser use is disabled unless you set `dangerouslyAllowBrowser`, which exists precisely to avoid exposing credentials ([SDK README](https://github.com/anthropics/anthropic-sdk-typescript)) [high]. On Pages, store `ANTHROPIC_API_KEY` as an encrypted secret under Settings, Variables and Secrets, read it from `context.env`, and keep local values in an uncommitted `.dev.vars` ([Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/)) [high].
- **The browser cannot choose the model.** `CLAUDE_MODEL`, `CLAUDE_EFFORT` and `ASSISTANT_MAX_TOKENS` are server environment variables, so a tampered client cannot request an expensive configuration.
- **Netlify twin:** same core logic in `netlify/functions/ask.mjs`, with `config.path = "/api/ask"` and `config.rateLimit`. Streaming works there by returning the upstream body as a `ReadableStream`, but streaming functions stop at **60 seconds** and 20 MB ([Functions API](https://docs.netlify.com/build/functions/api/)) [high]. Keep `max_tokens` modest (about 1,024) so answers finish well inside that.

### 2.4 Streaming

- The Messages API streams server-sent events in a fixed order: `message_start`, then per-block `content_block_start`, `content_block_delta` and `content_block_stop`, then `message_delta` and `message_stop`. `ping` events can appear anywhere. An `error` event such as `overloaded_error` can arrive mid-stream, and new event types may be added, so unknown types must be ignored ([streaming](https://platform.claude.com/docs/en/build-with-claude/streaming)) [high].
- **Cloudflare free-plan caveat:** Workers have no wall-clock limit while streaming, but the free plan allows **10 ms of CPU per request**; the paid plan allows up to 5 minutes ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)) [high]. Waiting on network I/O does not count as CPU, but parsing and re-emitting many events does. Load-test on staging. If CPU-limit errors appear, move the project to the Workers paid plan (price not re-verified this session) [med].
- Sketch of the function core (JavaScript, `@anthropic-ai/sdk`; not built or run):

```js
// functions/api/ask.js (sketch). Guards a-e from 2.3 run before this point.
import Anthropic from "@anthropic-ai/sdk";

export async function onRequestPost({ request, env }) {
  // ...origin, Turnstile/session, rate limit, caps, PII strip...
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const stream = client.beta.messages.stream({
    model: env.CLAUDE_MODEL || "claude-opus-5-5",
    max_tokens: Number(env.ASSISTANT_MAX_TOKENS || 1024),
    output_config: { effort: env.CLAUDE_EFFORT || "low" },   // set explicitly; tune with the eval in 2.7
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",                                     // re-runs a policy decline on Anthropic's recommended model
    system: [{ type: "text", text: SYSTEM_AND_FACTS, cache_control: { type: "ephemeral" } }],
    messages: [...recentTurns, { role: "user", content: `Today is ${todayNY()}.\n\n${question}` }],
  });
  const enc = new TextEncoder();
  const body = new ReadableStream({
    async start(ctrl) {
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
            ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ t: ev.delta.text })}\n\n`));
          }
        }
        const final = await stream.finalMessage();
        if (final.stop_reason === "refusal") ctrl.enqueue(enc.encode(`data: {"refusal":true}\n\n`));
        ctrl.enqueue(enc.encode(`data: ${JSON.stringify({ done: true, links: officialLinksFor(final) })}\n\n`));
      } catch (e) {
        ctrl.enqueue(enc.encode(`data: {"error":"busy"}\n\n`));   // UI falls back to the static FAQ
      } finally { ctrl.close(); }
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
}
```

Notes on the sketch. Server-side `fallbacks` is a beta and should be enabled by default for Opus 5.5; the `"default"` form needs the `server-side-fallback-2026-07-01` header, it is available on the Claude API (not Bedrock, Vertex or Foundry), and Haiku 5.5 has no server-side fallback (claude-api skill reference; [refusals and fallback](https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback)) [med: check the field is typed in the SDK version you pin]. A decline arrives as HTTP 200 with `stop_reason: "refusal"`, so always check it before showing content [high, skill reference]. `officialLinksFor()` is the allowlist step in 2.7. Pages bundles npm dependencies from `package.json` at deploy [med].

### 2.5 Prompt caching

- Opus 5.5 and Sonnet 5.5 cache reads cost 5% of base input ($0.20 and $0.10 per MTok). A 5-minute cache write costs 1.25x base input and a 1-hour write 2x ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) [high].
- The minimum cacheable prefix is 512 tokens on Opus 5.5, Sonnet 5.5 and Haiku 5.5. A shorter prefix silently does not cache (claude-api skill reference, citing the [prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)) [med: confirm on the live page before relying on the exact value].
- Cache reads do not count toward input-tokens-per-minute rate limits ([rate limits](https://platform.claude.com/docs/en/api/rate-limits)) [high].
- **Design rule:** the system prompt and facts pack go first, byte-identical across requests, with one `cache_control` marker. **Today's date, the page context and the question go after the marker.** Putting the date in the system prompt silently breaks caching every day. Bursty, low traffic means many cold starts; at about 2 cents per cold start on Opus, the 1-hour TTL pays off only if a few visitors arrive each hour.

### 2.6 Abuse protection and budget control (layered)

1. **Origin check.** Reject any `Origin` that is not in `ALLOWED_ORIGINS`, as `video-upload.js` already does.
2. **Turnstile.** Free, unlimited challenges, 20 widgets, 10 hostnames per widget, WCAG 2.2 AAA, and usable without hosting on Cloudflare ([plans](https://developers.cloudflare.com/turnstile/plans/)) [high]. Server-side validation is mandatory. Tokens last **300 seconds and are single-use**, and siteverify accepts an `idempotency_key` for safe retries ([server-side validation](https://developers.cloudflare.com/turnstile/get-started/server-side-validation/)) [high]. Because tokens are single-use, verify once per chat, then issue a short-lived HMAC-signed HttpOnly session cookie (about 30 minutes), so a multi-turn chat does not re-challenge on every message.
3. **Rate limits.**
   - **Netlify:** code-based `rateLimit` (`windowLimit`, `windowSize` up to 180 s, `aggregateBy: ["ip","domain"]`) works on all plans, with 2 rules per project on Free. Enforcement can lag up to 10 seconds ([rate limiting](https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/)) [high].
   - **Cloudflare WAF:** the free plan includes 1 rate-limiting rule, counting by IP over a 10-second period with a 10-second block ([WAF rate limiting](https://developers.cloudflare.com/waf/rate-limiting-rules/)) [high]. Point it at `/api/*`.
   - **Workers Rate Limiting binding:** 10- or 60-second periods, approximate and per-location. Its docs do not confirm Pages Functions support ([binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)) [high]. Use it after a move to Workers.
   - **Avoid Workers KV for counters.** Its free tier allows only 1,000 writes a day ([KV limits](https://developers.cloudflare.com/kv/platform/limits/)) [high].
4. **Hard money cap.** Create a dedicated Console workspace (for example "youngsemdem-site") and set a monthly workspace spend limit on it. Limits cannot be set on the default workspace. Once the limit is hit, requests return HTTP 400 `invalid_request_error` until the period resets ([rate limits](https://platform.claude.com/docs/en/api/rate-limits)) [high]. Organization caps by tier are $500 (Start), $1,000 (Build) and $200,000 (Scale) a month [high]. **The function must catch that 400 (and 429s) and fall back to the static FAQ.**
5. **Per-request caps.** Up to 8 recent turns, 1,500 characters per message, `max_tokens` about 1,024, effort `low` or `medium`, and a `ASSISTANT_ENABLED` kill switch.
6. **Privacy by default.** Redact email addresses and phone numbers before sending text to the API. Log only counts, latency, `stop_reason`, token usage and the model. A "flag this answer" button sends a Q&A pair for review only with the visitor's consent.

### 2.7 Guardrails for a political voter-help assistant

**Policy facts that shape the design**

- **Anthropic's Usage Policy (effective Nov 12, 2026)** does not ban political campaigning as such. It bans deceptive or disruptive election uses: false or misleading information about voting procedures, fabricated endorsements, synthetic media that falsely appears to come from a candidate or official, suppressing turnout through deception, and undisclosed automated messages to voters at scale. **Consumer-facing chatbots must disclose that they are AI**, at least at the start of each chat or in the interface ([AUP](https://www.anthropic.com/legal/aup)) [high]. This is a change from Anthropic's Feb 2024 elections post, which said the policy then barred campaigning and that Claude sent US voting questions to TurboVote ([Anthropic, Feb 16, 2024](https://www.anthropic.com/news/preparing-for-global-elections-in-2024)) [high]. The current policy governs, but the redirect-to-authoritative-source pattern is still the right model.
- **Minors.** The AUP defines a minor as anyone under 18. Products that serve minors must follow Anthropic's extra guidelines: age-appropriate safeguards (moderation, monitoring), the child-safety system prompt where provided, compliance with COPPA and similar laws stated publicly, and AI disclosure. Anthropic audits for this ([AUP](https://www.anthropic.com/legal/aup), [guidelines for organizations serving minors](https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors)) [high]. The site targets pre-registration at 16 and YDSC admits members from 14, so plan as if minors will use it.
- **Florida's AI disclaimer law** (Fla. Stat. 106.145, 2024) is narrow. It applies to political ads containing generative-AI content that depicts a real person doing something that did not happen, made with intent to injure a candidate or deceive voters about a ballot issue. Those ads must carry "Created in whole or in part with the use of generative artificial intelligence (AI)" ([106.145](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.145.html)) [high]. The fix is simple: never generate images, audio or video of real people.

**Rules the system prompt should carry**

1. **Identity.** An AI helper (Claude) for a volunteer Democratic club, labeled DEMO while in demo. Not a person, not an official source, not the Supervisor of Elections.
2. **Voting logistics are link-first.** State a date, deadline, location, hour, ID rule or eligibility rule only if it appears in the injected FACTS block, which carries a source URL and a "checked" date for each fact. Otherwise point to the official page: My Voter Record, the polling-place lookup, the vote-by-mail page or the state lookup (already in `config.links.vote`, checked Nov 9, 2026), plus the Seminole SOE phone 407-585-8683. Never guess, even when asked to.
3. **No impersonation, fabricated quotes, endorsements or statistics.** No messages written as if from a candidate or official.
4. **No collecting personal data.** If someone shares data, don't repeat it. No individual persuasion profiles.
5. **Scope.** Seminole County and Florida civics explainers, the club's own pages, EN/ES translation, and invite drafts the member sends personally. Politely decline anything else and offer a human contact.
6. **Answer in the visitor's language**, with Spanish reviewed against the site's glossary. Keep answers short and end with 1 to 3 links.

**Server-side enforcement (do not rely on the prompt alone)**

- **Link allowlist.** Parse URLs in the output. Keep only `voteseminole.gov`, `voteseminole.dolphmap.com`, `dos.fl.gov`, `registration.dos.fl.gov`, `registertovoteflorida.gov` and the site's own domain; strip the rest. Then append the official link block for the detected topic.
- **Facts file.** `data/vote-facts.js` holds each fact with `{text_en, text_es, url, checked: 'YYYY-MM-DD', expires}`. The function drops expired facts before building the prompt, so stale deadlines cannot leak. As of Nov 9, 2026, voteseminole.gov's upcoming-elections page still lists the Nov 3 general, with no 2027 or 2028 dates yet (`config.js` comment) [high: repo].
- **No live web search at launch.** Claude's web search tool costs $10 per 1,000 searches plus tokens ([pricing](https://platform.claude.com/docs/en/about-claude/pricing)) [high]. It can be added later, restricted to the official domains.
- **Eval before launch and after every prompt change.** About 40 EN/ES prompts: "where do I vote", "what's the deadline", "can I vote at 17", "is it too late to request a mail ballot", "write a text from [candidate]", jailbreaks, plus Spanish versions. Pass criteria: no invented date or place, AI disclosure shown, a link on every logistics answer, no impersonation.

---

## 3. Member video: options, moderation, price, launch path

### 3.1 Options

| Option | How it works | Price (Nov 9, 2026) | Pros | Cons |
|---|---|---|---|---|
| **Link-posting + official embeds** | A member pastes a TikTok or YouTube link. The server reads oEmbed and queues it for review. The site plays it through TikTok's Embed Player (`tiktok.com/player/v1/{id}`) or `youtube-nocookie.com` behind a click-to-load poster. | $0 | No storage or transcoding; music rights stay with the platform; matches how Gen Z already posts | Third-party cookies after a click; Instagram needs Meta app review |
| **Mux direct uploads** | The function creates an upload (`cors_origin`, `new_asset_settings`). The browser PUTs the file, resumable with UpChunk. Webhook `video.asset.ready`. | Encoding free; storage $0.003/min/month; delivery $0.001/min after **100,000 free minutes a month**; on-demand **auto-captions included**; Robots "Moderate" $0.001 per sample out of 100,000 free units a month ([pricing](https://www.mux.com/pricing), [direct uploads](https://www.mux.com/docs/guides/upload-files-directly)) [high] | Cheapest at club scale; free captions (WCAG 1.2.2); machine pre-screening | One more vendor; HLS needs a player (hls.js or Mux Player) |
| **Cloudflare Stream direct creator uploads** | The function gets a one-time `uploadURL`. Basic POST up to **200 MB**; tus above that. `maxDurationSeconds` reserves storage until upload. | **$5/month per 1,000 minutes stored** (prepaid blocks) + **$1 per 1,000 minutes delivered**; ingress and encoding free; no free tier listed (page updated Oct 27, 2026) ([pricing](https://developers.cloudflare.com/stream/pricing/), [direct creator uploads](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)) [high] | Same vendor as hosting; AI captions in 12 languages incl. English and Spanish via the API ([captions](https://developers.cloudflare.com/stream/edit-videos/adding-captions/)) [high; cost not stated] | $5 floor; no built-in moderation |
| **Supabase Storage** | Plain file storage | Free: 1 GB storage, **50 MB max file**, 5 GB egress; free projects pause after a week of inactivity; Pro from $25/month ([file limits](https://supabase.com/docs/guides/storage/uploads/file-limits), [pricing](https://supabase.com/pricing)) [high] | Simple | No transcoding or adaptive streaming; 50 MB cap; pausing — poor fit for video |

**Embed facts.**
- **TikTok** marks its oEmbed-based "Embed Videos" product as **deprecated soon** and recommends the Embed Player. The player needs no API key, takes query toggles (autoplay, loop, `closed_caption`, `rel`...), speaks `postMessage` events, and may be rate-limited per domain ([oEmbed](https://developers.tiktok.com/doc/embed-videos/), [Embed Player](https://developers.tiktok.com/doc/embed-player)) [high].
- **Instagram** oEmbed (`graph.facebook.com/instagram_oembed`, 1,000 requests per hour) needs the oEmbed Read feature, which requires App Review and business verification ([Instagram oEmbed](https://developers.facebook.com/docs/instagram-platform/oembed), [oEmbed Read](https://developers.facebook.com/docs/features-reference/oembed-read)) [high]. For a club site, store a poster image and link to the post instead.
- **YouTube's** privacy-enhanced mode (`youtube-nocookie.com`) keeps embedded views out of the viewer's recommendations and serves only non-personalized ads. `cc_load_policy=1` turns captions on by default ([YouTube help](https://support.google.com/youtube/answer/171780)) [high]. YouTube's oEmbed endpoint is `youtube.com/oembed?url=...&format=json` ([oEmbed spec example](https://oembed.com/)) [high].

### 3.2 Moderation and legal hygiene for user video

1. **Nothing is public until a human approves it.** The repo already tags every upload `review: pending` and the feed reads a moderated list [high: repo]. Keep that, and add Mux Robots Moderate as a first-pass flag, never as the approval itself.
2. **Turnstile on upload, plus caps of 180 s and 150 MB** (the function defaults), and a "report this video" button with a stated takedown time.
3. **Consent checkboxes at upload:** "I made this or have the right to post it", "everyone identifiable agreed to be shown" and "nobody under 18 is shown without a parent's OK". No copyrighted music in uploads; music is safer on TikTok links.
4. **Register a DMCA agent** with the US Copyright Office, since the site will store user material. It costs $6 per designation and lapses after **3 years** unless renewed ([DMCA directory](https://www.copyright.gov/dmca-directory/), [FAQ](https://www.copyright.gov/dmca-directory/faq.html)) [high]. Publish the agent's contact details on a `/content-policy` page.
5. **Florida's minors' social media law** (Fla. Stat. 501.1736, 2024) reaches only platforms meeting all four tests: user content; at least 10% of under-16 daily users spending 2+ hours a day; algorithmic selection; and an "addictive" feature such as infinite scroll, push notifications, public like counts, autoplay or live-streaming ([501.1736](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1736.html)) [high]. A club site will not meet the usage threshold [med], but skip the infinite-scroll + autoplay + public-likes + algorithmic-feed combination anyway. It is also kinder design.
6. **Counsel should confirm reporting duties** for illegal content (for example child sexual abuse material) before uploads go live [med: not researched this session].

### 3.3 Simplest launch path

- **Phase 0 (demo, now):** local-only clips (as built) plus the club's own TikTok and YouTube links behind click-to-load posters.
- **Phase 1 (launch):** member link-posting with a review queue (`/api/clip-link`: fetch oEmbed, store pending).
- **Phase 2:** uploads through **Mux** (`VIDEO_PROVIDER=mux`). At about 50 stored minutes and 20,000 views a month, storage costs about $0.15 and delivery stays inside the free 100,000 minutes; captions are free. Cloudflare Stream would cost $5 + about $20 for the same usage. Use Stream if keeping one vendor matters more than about $25 a month [med: arithmetic from list prices]. `functions/api/video-upload.js` already supports both.

---

## 4. Organizing stack integrations

| Tool | What the docs say | How a static site wires to it |
|---|---|---|
| **Action Network** | OSDI/HAL+JSON API at `actionnetwork.org/api/v2`. **API keys are a partner feature**, sent as `OSDI-API-Token`, limited to 4 calls a second ([docs](https://actionnetwork.org/docs)) [high]. The person signup helper upserts by email or phone and applies `add_tags` only if the tags already exist; new people default to **unsubscribed for mobile** unless a status is passed ([person signup helper](https://actionnetwork.org/docs/v2/person_signup_helper)) [high]. The **record submission helper** (`/forms/{id}/submissions`) **accepts browser POSTs with no API key**, records `referrer_data.source`, and can trigger the form's autoresponse ([record submission helper](https://actionnetwork.org/docs/v2/record_submission_helper)) [high]. | **Simplest:** POST straight from the browser to the keyless form-submission endpoint (no proxy, no secret). **Richer:** POST to `/api/join`, which adds the key server-side and calls the person signup helper with tags and custom fields (`ysd_ref_code`, `ysd_referred_by`), as `core.md` already specifies. Send `phone_numbers[].status: "subscribed"` **only** when the SMS box is ticked. |
| **Mobilize** | Public `GET /v1/organizations/:id/events` needs no auth, with filters `timeslot_start=gte_now`, `zipcode`, `max_dist`. **Creating RSVPs through the API is restricted** (request access by email). `referrer.utm_*` fields are stored on attendances. Limits: 15 reads and 5 writes per second per IP ([Mobilize API](https://github.com/mobilizeamerica/api)) [high]. | Fetch the event list in `/api/events` (cached for 10 to 15 minutes) or at build time, render native cards, and link "RSVP" to the Mobilize event page with `utm_source=youngsemdem&utm_medium=site&utm_campaign=<event>`. Browser CORS behavior was not checked, so do not fetch from the browser [med]. |
| **ActBlue** | Contribution forms take `refcode` and `refcode2` URL parameters (and `amount`). The help center refused the fetch tool this session, so the parameter details are from the repo's `share.js` and common practice [med]. Report 02 found YDSC already on ActBlue (`youngsemdems`, `ydscdues`) [high]. | Link out, never iframe. `share.js` already builds `refcode=ref_<member code>` and `refcode2=utm_<source>`. **Never reuse YDSC's forms** in the demo. ActBlue eligibility depends on decision D2. |
| **EveryAction / NGP VAN** | Two database modes: 0 = My Voters (voter file; needs extra permission) and 1 = My Campaign (CRM). The mode is appended to the API key ([NGP VAN getting started](https://docs.ngpvan.com/docs/getting-started)) [high]. Access normally runs through the state party or the county executive committee [low: not verified]. | If the county party uses EveryAction online forms, link or embed them. Never touch voter-file data from the site. |
| **Newsletter** | **Mailchimp Free shrank** to 250 contacts and 500 sends a month (250 a day), with branding ([Mailchimp free](https://mailchimp.com/pricing/free-details/)) [high]. **beehiiv Launch** is free up to 2,500 subscribers with unlimited sends and API access (not the Send API); its referral program starts on a paid plan ([beehiiv pricing](https://www.beehiiv.com/pricing)) [med: the page's tables were partly inconsistent]. Substack was not checked. | If Action Network is the list of record, use its email (one list, one consent record). Otherwise beehiiv: its free subscribe form, or `/api/subscribe` with `BEEHIIV_API_KEY`. |
| **Netlify Forms** (staging) | Free and unlimited on credit plans; needs a static `<form data-netlify="true" name=...>` at deploy time ([Forms billing](https://docs.netlify.com/manage/forms/usage-and-billing/)) [high; detection syntax med]. | Already supported by `formEncoding: 'form'` in `config.js`. Good for the demo on Netlify; not a list of record. |

**The three ways to wire a static form, in order of preference:**
1. **Direct keyless POST** to a vendor endpoint designed for browsers (the Action Network record submission helper).
2. **Same-origin `/api/*` proxy** that holds the key, checks Turnstile and a honeypot (`members.js` already has one), and forwards. Returning `{refCode, id}` lets the server guarantee unique referral codes (`core.md`).
3. **Hosted or embedded vendor form** as a no-JS fallback (`links.actionNetwork`).

---

## 5. Analytics, attribution, share previews and PWA

### 5.1 Privacy-friendly analytics

| Tool | Price | Events | Notes |
|---|---|---|---|
| **Cloudflare Web Analytics** | Free | Page views and visitors; custom events not documented | Collects no personal data; no DNS change or proxy needed ([about](https://developers.cloudflare.com/web-analytics/about/)) [high] |
| **Plausible** | Starter $9/month up to 10k pageviews; Growth $14, Business $19; 30-day trial | Goals, custom events, UTM channel grouping; custom properties on Business | No cookies or persistent identifiers, EU-hosted ([pricing](https://plausible.io/#pricing)) [high] |
| **Fathom** | $15/month up to 100k pageviews; 7-day trial; no free plan | Events count toward pageviews; UTM included | Cookieless ([pricing](https://usefathom.com/pricing)) [high] |

**Recommendation.** Launch with Cloudflare Web Analytics (free, `analytics.provider: 'cloudflare'`) for page views. Add Plausible when the share-loop events start to matter: share tap and success, card render, RSVP, join, clip play, and assistant query, all already emitted by `track.js`. `track.js` already respects DNT and GPC, strips personal-data keys and never sends in demo mode [high: repo].

### 5.2 One attribution scheme across every tool

| Where | Parameter | Value convention |
|---|---|---|
| Site links | `ref` | Member refCode (`KIRA7QX`); last touch wins, 30-day window (`share.attributionDays`) |
| Site links | `utm_source` / `utm_medium` / `utm_campaign` / `utm_content` | `ig`, `tiktok`, `sms`, `qr`, `email` / `social`, `print`, `p2p` / `2026-12-wrapped` / creative id |
| ActBlue | `refcode` / `refcode2` | `ref_<code>` / `utm_<source>` (built by `share.actblue()`) |
| Action Network | `source` (and `referrer_data.source` via API) | `ysd_<utm_source>_<campaign>` |
| Mobilize | `utm_*` (stored on attendances) | Same as the site |
| QR and vanity | `/qr/:code` redirect | Adds `utm_medium=print&utm_campaign=:code` |

### 5.3 Open Graph, X cards, PWA

- **Open Graph** requires `og:title`, `og:type`, `og:image` and `og:url` (canonical), and recommends `og:image:alt`, `og:image:width` and `og:image:height` ([ogp.me](https://ogp.me/)) [high].
  - Write these tags into the static HTML of every shareable page, with **absolute** URLs [med: link-preview crawlers generally do not run JavaScript].
  - Images at 1200x630 are the common convention [med].
  - Add `twitter:card=summary_large_image`. X's documentation refused the fetch tool this session, so the claim that X falls back to OG for title and image is unverified [low].
  - Share cards made in the browser (`cards.js`) are for Web Share and download; link previews need pre-rendered images in `assets/img/og/`.
- **PWA installability (Chrome):**
  - The manifest needs `name` or `short_name`, 192 px and 512 px icons, `start_url`, a `display` of `standalone` (or similar), and no `prefer_related_applications: true`.
  - It must be served over HTTPS, and the user must engage (a click and 30 seconds on the page) ([web.dev install criteria](https://web.dev/articles/install-criteria)) [high].
  - The page does not mention a service worker requirement [med]. The repo now has `sw-register.js`; keep the worker simple, with an offline page and no caching of `/api/*`.
  - Add `theme-color` and an `apple-touch-icon` for iOS.

---

## 6. Accessibility: the WCAG 2.2 AA items most often missed

**Why this matters here.** WebAIM's Feb 2026 scan of the top million home pages found detectable WCAG failures on 95.9% of them, with 56.1 errors per page on average. The most common: **low-contrast text (83.9%)**, **missing alt text (53.1%)**, **missing form labels (51%)**, **empty links (46.3%)**, **empty buttons (30.6%)** and **missing document language (13.5%)** ([WebAIM Million](https://webaim.org/projects/million/)) [high]. Report 02 found only 2 of 22 young-Dem sites passing basic checks. WCAG 2.2 (current W3C edition dated Dec 12, 2024) added 2.4.11 Focus Not Obscured (AA), 2.5.7 Dragging Movements (AA), 2.5.8 Target Size 24x24 CSS px (AA), 3.3.8 Accessible Authentication (AA), 3.2.6 Consistent Help (A) and 3.3.7 Redundant Entry (A), and removed 4.1.1 Parsing ([what's new](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/), [WCAG 2.2](https://www.w3.org/TR/WCAG22/)) [high].

**Checklist tuned to a poppy, video-and-share site**

| SC (level) | The trap on this site | The fix |
|---|---|---|
| 1.4.3 Contrast (AA), 1.4.11 Non-text Contrast (AA) | Celery-lime, hot pink and yellow text on white; ghost buttons | Use bright colours as fills under dark ink (report 03's rule); check every token pair; 3:1 for borders and focus rings |
| 1.1.1 Non-text Content (A) | UGC thumbnails, stickers, share cards | Required alt text at review time (Claude can draft, a human approves); decorative images get `alt=""` |
| 1.3.1 / 3.3.2 Labels or Instructions (A), 1.3.5 Identify Input Purpose (AA) | Placeholder-only fields in a slick join form | Visible `<label>`s; `autocomplete="given-name"`, `email`, `tel` and `postal-code` |
| 2.4.4 Link Purpose (A), 4.1.2 Name, Role, Value (A) | Icon-only share buttons (IG, TikTok, copy) produce empty links and buttons | `aria-label="Share on WhatsApp"`; visually hidden text |
| 3.1.1 Language of Page (A), 3.1.2 Language of Parts (AA) | EN/ES toggle and mixed-language cards | `<html lang>` per page; `lang="es"` on Spanish blocks |
| 1.2.2 Captions (A), 1.2.4 Live Captions (AA), 1.2.5 Audio Description (AA) | Member clips with speech | Mux or Stream auto-captions, human-corrected before publishing; describe key visuals in the caption text |
| 1.4.2 Audio Control (A), 2.2.2 Pause, Stop, Hide (A) | Autoplaying clips, live-ticking counters, marquees | Muted autoplay at most, with a visible pause; pause controls on anything moving for more than 5 seconds |
| 2.3.3 Animation from Interactions (AAA; do it anyway) | Confetti, parallax, sticker bursts | Honour `prefers-reduced-motion` |
| 2.5.8 Target Size (AA) | Tight chip rows and close icons on mobile | At least 24x24 CSS px (44 px is better for thumbs) |
| 2.4.11 Focus Not Obscured (AA), 2.4.7 Focus Visible (AA) | Sticky header, bottom tab bar, cookie or AI-disclosure banner hiding focus | `scroll-padding`; high-contrast focus rings |
| 4.1.3 Status Messages (AA) | "Copied!", "Joined!", counter updates, streamed AI text | `role="status"` / `aria-live="polite"`; don't announce every streamed token, announce on completion |
| 1.4.10 Reflow (AA), 1.4.12 Text Spacing (AA) | Fixed-height poster type, condensed fonts | Must work at 320 CSS px with no sideways scroll |
| 2.5.7 Dragging Movements (AA) | Drag-to-reorder or drag-sticker card editors | Button alternatives |
| 3.3.7 Redundant Entry (A), 3.3.8 Accessible Authentication (AA) | Multi-step join; future member logins | Prefill earlier steps; email magic links rather than puzzles; Turnstile is rated WCAG 2.2 AAA ([Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)) |

---

## 7. Compliance basics

### 7.1 Florida political advertising disclaimers

- **What counts.** A "political advertisement" is a *paid* expression in a communications medium that *expressly advocates* the election or defeat of a candidate or the approval or rejection of an issue. "Communications media" explicitly includes **the Internet**. Excluded: an organization's newsletter that goes only to its members, if the organization existed before the candidate qualified or the issue reached the ballot ([106.011(4), (15)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.011.html)) [high].
- **The rule for a club or committee.** Political ads not paid for by a candidate must prominently carry **"paid political advertisement" or "pd. pol. adv."**, the **name and address of whoever paid**, and **whether the ad and its production were paid for or provided in kind** by the entity publishing it ([106.143(1)(c)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html)) [high]. Party in-kind ads use the wording "paid for in-kind by (name of political party)" and must say who approved them; ads for a partisan candidate must name the party; foreign-language ads may give the required information in that language [high]. No font size is set; the statute says only "prominent" [high].
- **Website-relevant exemptions** (106.143(10), for messages used by a candidate, the candidate's supporters or a political committee): a **paid link of 200 characters or fewer that leads to a compliant website**; graphic links where a disclaimer is impractical and the link leads to a compliant website; **free posts on sites that cost nothing to post on**; **unpaid profiles or accounts where the source is clear**; and certain apps and third-party shares from a compliant campaign site ([106.143](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html)) [high]. The website itself is what those paid links point at, so **it must comply** [med: inference from the statute's structure].
- **106.1437 does not cover websites.** It covers sponsor statements for non-electoral issue ads on billboards, bumper stickers, radio, TV, newspapers, magazines and periodicals only ([106.1437](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.1437.html)) [high]. The brief's assumption that it governs internet ads is not supported by the text.
- **AI depictions:** see 106.145 in 2.7.
- **Political committee threshold.** Two or more people who, in aggregate, accept contributions or make expenditures of **over $500 in a calendar year** to expressly advocate for or against candidates or issues are a political committee ([106.011(16)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.011.html)) [high]. That status brings registration and reporting duties [med: not researched here]. This is decision D2.
- **Federal.** If the club ever became a federal political committee, FEC rules require disclaimers on **all its public websites** and on emails of more than 500 substantially similar messages ([11 CFR 110.11(a)](https://www.law.cornell.edu/cfr/text/11/110.11)) [high for the text; med that it applies only to federally registered committees].
- **What to do.**
  - Put the disclaimer in the footer of **every page and on every share card** that could carry advocacy (`legal.paidFor`, `legal.paidForEs`, `legal.paidForShort`), with wording from counsel.
  - Placeholder shape: `Pd. pol. adv. Paid for by [entity], [street, city, FL ZIP]. [In-kind statement if applicable.]`
  - The demo footer must also say the site is a demo and not affiliated with YDSC or the Seminole County Democratic Executive Committee (SemDems), unless it is.
  - Keep unpaid social posts sourced and clear. Run paid boosts only with the disclaimer, or as 200-character links to the site.

### 7.2 SMS opt-in (TCPA, FTSA, CTIA, 10DLC)

- **Federal rule.** Calls to cell numbers made with an autodialer or an artificial or prerecorded voice need the called party's **prior express consent**. Telemarketing needs **prior express written consent** ([47 CFR 64.1200(a)(1)(iii), (a)(2)](https://www.law.cornell.edu/cfr/text/47/64.1200)) [high]. Political messages are generally not telemarketing [med]. The FCC and the courts have long treated texts as calls under the TCPA [med: fcc.gov refused the fetch tool this session].
  - **Revocation:** consent can be revoked by any reasonable method. Replies such as "stop", "quit", "end", "revoke", "opt out", "cancel" and "unsubscribe" count per se, and requests must be honored within **10 business days** ([64.1200(a)(10)](https://www.law.cornell.edu/cfr/text/47/64.1200)) [high].
  - **Autodialers:** the Supreme Court held in *Facebook v. Duguid* (decided Apr 1, 2021) that an autodialer must use a random or sequential number generator ([opinion](https://www.supremecourt.gov/opinions/20pdf/19-511_p86b.pdf)) [high]. That is why peer-to-peer texting tools exist, but **carriers still demand consent and registration regardless**.
- **Florida's FTSA** (501.059) requires prior express written consent for automated *telephonic sales calls*, meaning solicitations to sell consumer goods, services or credit. A ticked box counts as a signature. Before suing over texts, a person must first reply STOP and allow a **15-day cure period** ([501.059](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.059.html)) [high]. Political and donation texts do not clearly fit "sales call", but the statute does not expressly exclude them [med].
- **CTIA Messaging Principles (May 2023)** — what carriers enforce:
  - Express consent for informational texts; **express written consent** (a form or checked box) for promotional ones. Treat fundraising asks as promotional.
  - A clear call to action naming the program, the sending number, who is sending, opt-in terms and fees, how to opt out, help contact and the **privacy policy linked from the call to action**.
  - A confirmation text on enrollment with program name, help info, opt-out, message frequency and fees.
  - One opt-in per campaign; **no rented, sold or shared lists**.
  - **Record each consent:** timestamp, medium, the exact language shown, campaign, IP address, phone number and identity ([CTIA PDF](https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf)) [high].
- **10DLC political use case.** Campaign Verify verifies candidates, parties, PACs and other 527 committees **registered with the FEC or a state, local or tribal election authority**. It costs **$95 per entity per two-year cycle**, and its tokens unlock the political use case in The Campaign Registry ([Campaign Verify](https://www.campaignverify.org/)) [high]. An unregistered club cannot get a token, which loops back to D2.
- **Sample checkbox** (unchecked by default, never required to join; wording for counsel to approve):
  > ☐ Text me about Young Seminole Democrats events and actions [DEMO]. Recurring automated texts, about 4 a month. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Consent is not a condition of joining or donating. [SMS Terms] [Privacy]

  Store the exact text shown, a version id, the timestamp, IP address, page URL and phone number with the record. Action Network only gets `status: subscribed` for the phone when the box is ticked. Carriers commonly also expect a line that mobile numbers are not shared with third parties for marketing [low: industry practice, not verified this session].

### 7.3 Email: CAN-SPAM and Gmail bulk-sender rules

- **CAN-SPAM** covers commercial messages, meaning those whose primary purpose is advertising a product or service. Its requirements: accurate headers, a non-deceptive subject line, an ad disclosure (for commercial mail), a **valid physical postal address**, a working opt-out honored within **10 business days**, and up to **$53,088 per violating email** ([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business)) [high]. The guide does not address political mail directly, and purely political messages are generally not "commercial" [med]. **Comply anyway:** postal address, one-click unsubscribe, no deceptive subjects.
- **Gmail** requires every sender to use SPF or DKIM, valid forward and reverse DNS, TLS, and a spam rate under 0.3%. Bulk senders (5,000+ messages a day to Gmail) also need SPF, DKIM and DMARC with alignment, plus **one-click unsubscribe** (RFC 8058 headers) and a visible unsubscribe link ([Gmail sender guidelines](https://support.google.com/a/answer/81126)) [high]. Campaign Verify can also verify a sender email domain ([Campaign Verify](https://www.campaignverify.org/)) [high].

### 7.4 Minors

- **COPPA** covers *commercial* sites and services. Nonprofits exempt from Section 5 of the FTC Act are generally not covered, but the FTC encourages them to follow it anyway ([COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)) [high]. A general-audience site may run a **neutral age screen**: free entry of birth month and year, not a "13+ only" dropdown or an "I am over 12" checkbox. Once it learns a user is under 13, COPPA applies. The Rule was amended Apr 22, 2025 (FAQ) [high].
  - The repo's `minAge: 13` and birth-year validation fit this. Make sure the UI is neutral and stores nothing when a user is under 13 (`members.validate` already treats it as a hard error).
- **Pre-registration:** Floridians may pre-register on or after their 16th birthday and vote in elections on or after their 18th ([97.041](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html)) [high]. Link `links.vote.register`.
- **AI with minors:** see 2.7 (Anthropic's guidelines for organizations serving minors).
- **YDSC admits from age 14** (report 02). If the site takes 13- to 17-year-old members, add guardian-friendly copy, no public profiles or faces of minors without a parent's consent, and no SMS to minors without counsel's sign-off [med].

### 7.5 Privacy policy essentials (also required by CTIA for SMS)

Required sections:
1. Who runs the site, and the demo status.
2. What the site collects: join fields, SMS consent records, uploads and captions, Turnstile signals, cookieless analytics, and optional assistant text.
3. Why it collects it.
4. **Who it is shared with:** the list of record (Action Network or another), ActBlue on outbound links, Mobilize, Mux or Cloudflare (video), Cloudflare or Netlify (hosting), Anthropic (if the assistant is on), and the county party, if applicable. Say that the site does not sell data.
5. SMS terms: program name, frequency, HELP and STOP, fees, and no sharing of mobile numbers for marketing.
6. Retention periods.
7. Access, correction and deletion. `members.forget()` exists; give an email route too.
8. Children and age.
9. Security.
10. Do Not Track and Global Privacy Control are honored (`track.js` does this).
11. AI use and disclosure.
12. The user-content policy and the DMCA agent.
13. Contact (`legal.privacyEmail`).
14. Effective date and changes.

Publish it in English and Spanish.

---

## 8. Recommended architecture

### 8.1 Folder layout

```text
youngsemdem/
  index.html  join.html  events.html  clips.html  post.html  vote.html  about.html  404.html
  privacy.html  terms.html  sms-terms.html  content-policy.html  accessibility.html  ai.html
  es/                         # Spanish pages (same names), lang="es"
  manifest.webmanifest  robots.txt  sitemap.xml
  _headers  _redirects        # shared by Cloudflare Pages and Netlify (explicit status codes)
  netlify.toml                # Netlify only: functions dir, Node version
  assets/
    css/   tokens.css (colours, type, spacing as custom properties: the real theme) ...
    js/    config.js            public config, no secrets (core)
           config.local.js      per-environment overrides, git-ignored; config.local.example.js committed
           store.js track.js share.js cal.js cards.js members.js clips.js feed.js sw-register.js   (core)
           assistant.js  config.assistant.js     optional, NOT core, only if D1 = yes
    img/   og/ (1200x630 per page)  icons/ (192, 512, maskable, apple-touch)  stock/ (Unsplash, credited)
    video/ demo clips only (each under 25 MiB)
    fonts/ self-hosted woff2 (optional; or Google Fonts per CSP)
  data/    events.js clips.js counters.js faq.js vote-facts.js (dated, expiring) glossary-es.js
  functions/api/              # Cloudflare Pages Functions -> /api/<name>
           video-upload.js  join.js  events.js  clip-link.js  [ask.js]
  netlify/functions/          # same cores, modern format with config.path = "/api/<name>"
  tools/   stamp-domain.mjs   writes site.url into canonical/OG tags, sitemap.xml, robots.txt
           gen-headers.mjs    builds the CSP in _headers from config.csp + enabled providers
           check-links.mjs    fails on dead official links, missing alt/lang, missing OG tags
  tests/   infra/ (core, video) + new tests for headers, links and the ask guardrails
  docs/    research/ infra/ launch-checklist.md decisions.md
```

**Why this shape.**
- **No framework, no required build:** the site runs from `file://`, `python3 -m http.server` or any static host, and the two `tools/` scripts are the only deploy-time steps.
- **Identical `/api/*` URLs on both hosts** keep the browser host-agnostic.
- **A shared core per function**, copied byte-for-byte into each twin and checked by a test, is the pattern `video-upload.js` already uses.

### 8.2 Config schema (v2): every swappable value

The browser-safe config stays in `assets/js/config.js` (`window.YSD_CONFIG`, deep-merged with any pre-set object), keeping the existing keys and conventions: `''` means not configured, and no secrets. New keys are marked `NEW`. Example values are placeholders. The theme hexes follow report 03's lead palette and stay fallbacks; the CSS tokens are the source of truth.

```js
window.YSD_CONFIG = {
  version: 2,                                   // NEW value (was 1): bump on renamed keys
  env: 'demo',                                  // NEW 'demo' | 'staging' | 'production'
  demo: true,                                   // existing: true = nothing leaves the browser

  org: {
    name: 'Young Seminole Democrats', short: 'YSD', handle: 'youngsemdem',
    legalName: '',                              // NEW entity named in disclaimers (D2)
    parentOrg: { name: '', url: '' },           // NEW charter/affiliation, '' = none claimed
    mailingAddress: '',                         // NEW CAN-SPAM footer + disclaimer address
    email: '',                                  // NEW public contact
    county: 'Seminole County', state: 'Florida', stateCode: 'FL',
    ageCap: 40, minAge: 13, tagline: '...', timezone: 'America/New_York'
  },

  site: {
    url: '',                                    // canonical origin; '' = location.origin (demo)
    canonicalHost: '',                          // NEW e.g. 'youngsemdem.org' (stamp script + redirects)
    altHosts: [],                               // NEW hosts to 301 to canonical (www, *.pages.dev)
    basePath: '',                               // NEW for sub-path deploys
    lang: 'en', locales: ['en', 'es'], defaultLocale: 'en',
    title: '...', description: '...',
    ogImage: '/assets/img/og/default.png', ogImageAlt: '',   // NEW alt
    themeColor: '#140B33',                      // NEW manifest + <meta name=theme-color>
    manifest: '/manifest.webmanifest',          // NEW
    uidDomain: 'youngsemdem'
  },

  theme: { bg: '#140B33', fg: '#FFFFFF', brand: '#6A2BFF', accent: '#C8F03C', pop: '#FF4F8B',
           muted: '#9AA0AA', ink: '#140B33', paper: '#FFFFFF',
           fontDisplay: '"League Gothic", system-ui, sans-serif',
           fontBody: '"Atkinson Hyperlegible Next", system-ui, sans-serif' },

  social: { instagram: { handle: 'youngsemdem', url: '' }, tiktok: {...}, x: {...}, threads: {...},
            bluesky: {...}, facebook: {...}, youtube: {...} },          // url '' = do not render

  links: {
    vote: { register, checkRegistration, stateElections, countyElections, countyRegister,
            myVoterRecord, voteByMail, pollingPlace, earlyVoting, upcomingElections,
            countyPhone, checked: '2026-11-09' },                       // NEW 'checked' date
    actblue: '', actionNetwork: '', mobilize: '', volunteer: '', countyParty: '', contact: '',
    privacy: '/privacy.html', terms: '/terms.html', smsTerms: '/sms-terms.html',     // NEW
    contentPolicy: '/content-policy.html', accessibility: '/accessibility.html',      // NEW
    ai: '/ai.html'                                                                     // NEW
  },

  integrations: {
    formEndpoint: '', formEncoding: 'json', formName: 'join',
    actionNetwork: { endpoint: '', tags: ['youngsemdem-site'],
                     formId: '',                // NEW for the keyless record-submission helper
                     submissionUrl: '',         // NEW https://actionnetwork.org/api/v2/forms/<id>/submissions
                     source: 'ysd_site' },      // NEW default source code
    mobilize: { orgId: '', eventsEndpoint: '/api/events', orgUrl: '' },          // NEW
    actblue: { refcodePrefix: 'ref_', refcode2From: 'utm_source',
               expressLane: false, recurring: false },                           // NEW (share.actblueRefcode stays)
    newsletter: { provider: 'none', embedUrl: '', endpoint: '' },                // NEW 'actionnetwork'|'beehiiv'|'mailchimp'|'none'
    sms: { enabled: false, programName: '', number: '', keyword: '', frequency: '',
           consentVersion: 'sms-v1' },                                           // NEW
    turnstile: { siteKey: '' },                                                  // NEW public site key
    squadEndpoint: '', countersEndpoint: '',
    videoUploadEndpoint: '',
    video: { provider: 'none', linkPosting: true, clipLinkEndpoint: '/api/clip-link',
             embedProviders: ['tiktok', 'youtube'], clickToLoad: true,
             maxSeconds: 180, maxMB: 150, moderation: 'manual' },                 // NEW
    analytics: { provider: 'none', plausibleDomain: '', plausibleSrc: '...',
                 cloudflareToken: '', endpoint: '', respectDoNotTrack: true }
  },

  legal: {
    paidFor: '[PLACEHOLDER] ...', paidForEs: '[PLACEHOLDER] ...',               // NEW Spanish
    paidForShort: '',                          // NEW for share cards
    privacyEmail: '', accessibilityEmail: '',  // NEW accessibilityEmail
    dmcaAgent: { name: '', email: '', address: '', designation: '' },            // NEW
    policiesUpdated: '',                       // NEW YYYY-MM-DD shown on legal pages
    demoNotice: 'Demo site. Not affiliated with any party committee.',           // NEW
    cardFooter: ''
  },

  csp: {                                       // NEW read by tools/gen-headers.mjs, not by pages
    script: [], frame: [], img: [], media: [], connect: [], formAction: ['https://actionnetwork.org']
  },

  share: { utm: {...}, refParam: 'ref', attributionDays: 30, hashtags: ['YoungSemDem'],
           cleanUrl: false, actblueRefcode: 'ysd_site' },
  members: { refCodeStyle: 'name', refNameMax: 5, refRandom: 3, enforceAgeCap: false,
             countyZips: [], keepContactLocally: false, demoSquadMax: 6 },
  cal: { prodId: '...', defaultDurationMin: 120, name: '...' },
  cards: { fonts: [], demoWatermark: true },
  features: { referrals: true, squad: true, cards: true, clips: true, calendar: true,
              demoSquadGrowth: true, demoLiveCounters: true,
              videoUploads: false, clipLinks: true, sms: false }               // NEW last three
};

// assets/js/config.assistant.js (optional, NOT core; loaded only if D1 = yes, before config.js)
window.YSD_CONFIG = Object.assign(window.YSD_CONFIG || {}, {
  assistant: { enabled: false, endpoint: '/api/ask', mode: 'canned',  // 'canned' | 'live'
               tools: ['explain', 'invite'], maxTurns: 8, maxChars: 1500,
               disclosure: { en: '...', es: '...' }, langs: ['en', 'es'] }
});
```

**Server environment variables (secrets and server-only settings; never in `config.js`):**

| Variable | Used by | Notes |
|---|---|---|
| `ALLOWED_ORIGINS` | all functions | Comma list of the canonical origin, staging and preview hosts |
| `TURNSTILE_SECRET_KEY`, `SESSION_HMAC_SECRET` | join, upload, clip-link, ask | Session cookie after one Turnstile pass |
| `ACTION_NETWORK_API_KEY` | join | Sent as `OSDI-API-Token`; partner feature |
| `MOBILIZE_ORG_ID` (non-secret), `MOBILIZE_API_KEY` (only for private events) | events | Cache responses for 10 to 15 minutes |
| `BEEHIIV_API_KEY`, `BEEHIIV_PUBLICATION_ID` | subscribe (if beehiiv) | |
| `VIDEO_PROVIDER`, `MUX_TOKEN_ID`, `MUX_TOKEN_SECRET`, `CF_ACCOUNT_ID`, `CF_STREAM_API_TOKEN`, ... | video-upload | Already documented in the function header |
| `ANTHROPIC_API_KEY`, `CLAUDE_MODEL` (default `claude-opus-5-5`), `CLAUDE_EFFORT`, `ASSISTANT_ENABLED`, `ASSISTANT_MAX_TOKENS` | ask (only if D1 = yes) | Key from a dedicated Console workspace with a spend limit |

---

## 9. Launch checklist

**A. Decisions and ownership**
1. Kira decides D1 (runtime Claude: yes or no) and records it in `docs/decisions.md`. Update `core.md` and the tests only if the answer is yes.
2. The party and counsel settle D2 (entity, committee status, payer line, YDSC relationship) and D3 (list of record).
3. Domain registered to an organizational email, with auto-renew, two or more admins, and DNS on Cloudflare.

**B. Hosting and portability**
4. Pages project connected; Netlify twin deploys as staging. The functions answer at `/api/*` on both.
5. Set `site.url` and `canonicalHost`, then run `tools/stamp-domain.mjs`. Every shareable page has an absolute `og:url`, `og:image` (1200x630) with `og:image:alt`, and `<link rel=canonical>`.
6. `www` and `*.pages.dev` 301 to the apex (Bulk Redirects). Every `_redirects` line carries an explicit status code.
7. `_headers` deployed and the CSP generated from `config.csp` with no console violations. Every function sets its own `Cache-Control: no-store`, `nosniff` and CORS headers.
8. HSTS on, **without** preload. Security headers pass a scanner. `robots.txt` and `sitemap.xml` use the real domain. Staging is `noindex`.
9. Origin allowlists updated: `ALLOWED_ORIGINS`, Turnstile hostnames, Stream `allowedOrigins`, `MUX_CORS_ORIGIN`.

**C. Integrations**
10. Join: keyless Action Network form-submission POST or `/api/join` working end to end. Tags exist in Action Network first. Honeypot plus Turnstile. The refCode comes back from the server.
11. Events: `/api/events` caches Mobilize public events. RSVP links carry `utm_*`.
12. Donate: `links.actblue` points at **our** form; refcodes verified in an ActBlue report.
13. Newsletter provider set; a test signup lands with the consent flag.

**D. Video**
14. Link-posting queue live; TikTok Embed Player and `youtube-nocookie` behind click-to-load posters.
15. Upload provider chosen (Mux recommended) with uploads `review: pending`. Moderator rota named; takedown time published.
16. DMCA agent registered ($6, renew every 3 years) and listed on `/content-policy`.
17. Captions on every published clip, human-corrected.

**E. Claude (only if D1 = yes)**
18. Dedicated Console workspace with a monthly spend limit; the key is stored as an encrypted secret.
19. Turnstile session, WAF and Netlify rate limits, input caps and kill switch tested. Spend-limit 400s and 429s fall back to the static FAQ.
20. AI disclosure at the start of every chat (AUP); `/ai.html` explains what the assistant does and does not do.
21. `vote-facts.js` dated, with expiry. The link allowlist is enforced server-side. The 40-prompt EN/ES eval passes. Minors safeguards in place (Anthropic's guidelines).
22. Logs hold counts only. The opt-in "flag answer" flow works.

**F. Compliance**
23. Disclaimer from counsel in the footer of every page (EN/ES) and on share cards. Demo or non-affiliation notice while in demo.
24. SMS: unchecked opt-in box with the approved CTIA language; consent records stored (timestamp, IP, text version, URL, phone); confirmation text; STOP/HELP tested; 10DLC registered (Campaign Verify token if eligible).
25. Email: SPF, DKIM and DMARC aligned; one-click unsubscribe; postal address in the footer.
26. Neutral age screen; nothing stored for under-13s; pre-registration copy for 16 and 17.
27. Privacy policy, terms, SMS terms, content policy and accessibility statement published (EN/ES), dated, and linked from every form.

**G. Accessibility and quality**
28. Automated scan with zero errors (contrast, alt, labels, empty links and buttons, `lang`), plus a manual keyboard and screen-reader pass (VoiceOver iOS, TalkBack) on join, share, clips and vote.
29. Target size of at least 24 px; focus never hidden by sticky bars; `prefers-reduced-motion` honoured; anything moving can be paused.
30. Works at 320 and 390 px wide with no sideways scroll; Lighthouse PWA installable; offline page works; `/api/*` never cached by the service worker.
31. `demo: false` only after all of the above. Demo-only counters and simulated squads disappear when `demo` is false (built into `store.js` and `members.js`).

---

## Recommendations for the youngsemdem site (summary)

1. **Host on Cloudflare Pages Free with DNS on Cloudflare**, and keep Netlify as staging and the exit path. Do not use Vercel Hobby or GitHub Pages for production.
2. **Close the three portability gaps:** static absolute OG and canonical tags written by `tools/stamp-domain.mjs`, a CSP generated by `tools/gen-headers.mjs`, and security headers set inside every function.
3. **Move the Netlify twins to the modern function format** with `config.path` and `config.rateLimit`, so `/api/*` is identical on both hosts.
4. **Claude:** use it at build time now (Spanish drafts, alt text, captions, copy variants, all human-reviewed and disclosed on `/ai.html`). Build the runtime "Explain + Invite" module isolated from core and switched off until Kira re-approves it. When on: `claude-opus-5-5` by default (her call on cheaper models), server-side key and model, Turnstile session, three rate-limit layers, a workspace spend cap, cached system prompt with the date after the breakpoint, server-side fallbacks, AI disclosure, link-only voting logistics backed by a dated facts file, and a 40-prompt eval.
5. **Video:** launch with link-posting of TikTok and YouTube clips behind click-to-load posters. Add Mux direct uploads next (free captions, effectively free at club scale). Hold everything for human review, and register a DMCA agent.
6. **Organizing stack:** Action Network as the list of record if available (keyless form-submission POST first, then `/api/join` for tags and referral fields). Mobilize public events cached by a function. ActBlue by link with refcodes. One UTM and refcode scheme everywhere.
7. **Analytics:** Cloudflare Web Analytics now, Plausible when event funnels matter. No ad pixels.
8. **Accessibility:** design tokens checked for contrast before any component work. Captions, labels, aria-labels on icon buttons, `lang` on Spanish blocks, 24 px targets and pausable motion are non-negotiable.
9. **Compliance:** get counsel's answers on D2 and the 106.143 wording before `demo: false`. Ship the CTIA-grade SMS consent flow, a bilingual privacy policy, a neutral age screen, and email authentication.

---

## Open questions

1. **Runtime Claude (D1).** Kira cut the assistant earlier in November; her latest brief says to put Claude in harder. Does she want the isolated Explain + Invite module built and switched on, built but off, or not built at all? Who pays for API usage, and what monthly cap?
2. **Entity and money (D2).** Is youngsemdem a pitch to YDSC, a project of the Seminole DEC, or a new group? Will it accept contributions or spend more than $500 a year on express advocacy (Fla. Stat. 106.011(16))? Who is the payer named in the disclaimer, and what exact wording (EN and ES) does counsel approve?
3. **List of record (D3).** Action Network (partner API access needed for the key), SemDems' Solidarity Tech, EveryAction, or beehiiv? Does the party already have a 10DLC political texting program the club should use instead of its own?
4. **Domain.** Which name, and who owns it? `youngsemdems.com` is held by someone else through Dec 31, 2026 (report 02); should the club try to obtain it, or pick a clearly different `.org`?
5. **Minors.** Will 13- to 17-year-olds be invited to join, text, upload or use the assistant? That decides the age floor, SMS rules, video consent and Anthropic's minors safeguards.
6. **Video provider and moderation.** Mux (cheapest, free captions) or Cloudflare Stream (single vendor, $5 floor)? Who moderates, and within what time?
7. **Unverified items to re-check by hand:** ActBlue's refcode documentation (the help center refused automated fetches); X card fallback behavior (docs blocked); fcc.gov texting guidance (403); Netlify Forms spam settings; whether Pages Functions support the Workers Rate Limiting binding; and the Workers paid-plan price.

---

## Sources

*All accessed Monday, November 9, 2026, unless noted. Dates in brackets are the page's own "last updated" or publication date where shown.*

**Anthropic / Claude**
1. Anthropic, Pricing. https://platform.claude.com/docs/en/about-claude/pricing
2. Anthropic, Models overview. https://platform.claude.com/docs/en/about-claude/models/overview
3. Anthropic, Rate limits (spend limits, workspace limits, cache-aware ITPM). https://platform.claude.com/docs/en/api/rate-limits
4. Anthropic, Streaming messages. https://platform.claude.com/docs/en/build-with-claude/streaming
5. Anthropic, Prompt caching (512-token minimum per the claude-api skill reference, cached Oct 6, 2026). https://platform.claude.com/docs/en/build-with-claude/prompt-caching
6. Anthropic, Refusals and fallback (via the claude-api skill reference). https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
7. Anthropic, TypeScript SDK README (supported runtimes, dangerouslyAllowBrowser). https://github.com/anthropics/anthropic-sdk-typescript
8. Anthropic, Usage Policy [effective Nov 12, 2026]. https://www.anthropic.com/legal/aup
9. Anthropic Support, Guidelines for organizations serving minors. https://support.claude.com/en/articles/9307344-responsible-use-of-anthropic-s-models-guidelines-for-organizations-serving-minors
10. Anthropic, Preparing for global elections in 2024 [Feb 16, 2024; updated May 28, 2024]. https://www.anthropic.com/news/preparing-for-global-elections-in-2024

**Cloudflare**
11. Pages limits [Sep 5, 2026]. https://developers.cloudflare.com/pages/platform/limits/
12. Pages headers. https://developers.cloudflare.com/pages/configuration/headers/
13. Pages redirects. https://developers.cloudflare.com/pages/configuration/redirects/
14. Pages custom domains. https://developers.cloudflare.com/pages/configuration/custom-domains/
15. Pages Functions pricing. https://developers.cloudflare.com/pages/functions/pricing/
16. Pages Functions bindings (env vars, secrets). https://developers.cloudflare.com/pages/functions/bindings/
17. Workers limits [Oct 29, 2026]. https://developers.cloudflare.com/workers/platform/limits/
18. Workers Rate Limiting binding. https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/
19. WAF rate limiting rules. https://developers.cloudflare.com/waf/rate-limiting-rules/
20. Workers KV limits. https://developers.cloudflare.com/kv/platform/limits/
21. Migrate from Pages to Workers [Oct 12, 2026]. https://developers.cloudflare.com/workers/static-assets/migration-guides/migrate-from-pages/
22. Turnstile server-side validation. https://developers.cloudflare.com/turnstile/get-started/server-side-validation/
23. Turnstile plans. https://developers.cloudflare.com/turnstile/plans/
24. Cloudflare Web Analytics. https://developers.cloudflare.com/web-analytics/about/
25. Stream pricing [Oct 27, 2026]. https://developers.cloudflare.com/stream/pricing/
26. Stream direct creator uploads. https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
27. Stream captions. https://developers.cloudflare.com/stream/edit-videos/adding-captions/

**Netlify, GitHub, Vercel**
28. Netlify pricing. https://www.netlify.com/pricing/
29. Netlify, How credits work. https://docs.netlify.com/manage/accounts-and-billing/billing/billing-for-credit-based-plans/how-credits-work/
30. Netlify, Billing overview (credit plans for accounts since Sep 4, 2025). https://docs.netlify.com/manage/accounts-and-billing/billing/overview/
31. Netlify, Custom headers. https://docs.netlify.com/manage/routing/headers/
32. Netlify, Redirects overview. https://docs.netlify.com/manage/routing/redirects/overview/
33. Netlify, Functions get started. https://docs.netlify.com/build/functions/get-started/
34. Netlify, Functions API (streaming 60 s, 20 MB; rateLimit). https://docs.netlify.com/build/functions/api/
35. Netlify, Functions usage and billing. https://docs.netlify.com/build/functions/usage-and-billing/
36. Netlify, Rate limiting. https://docs.netlify.com/manage/security/secure-access-to-sites/rate-limiting/
37. Netlify, Forms usage and billing. https://docs.netlify.com/manage/forms/usage-and-billing/
38. GitHub Pages limits. https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits
39. GitHub Pages custom domain. https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
40. Vercel Hobby plan [Sep 14, 2026]. https://vercel.com/docs/plans/hobby
41. Vercel fair use guidelines [Sep 14, 2026]. https://vercel.com/docs/limits/fair-use-guidelines

**Video and embeds**
42. Mux pricing. https://www.mux.com/pricing
43. Mux direct uploads. https://www.mux.com/docs/guides/upload-files-directly
44. Supabase Storage file limits. https://supabase.com/docs/guides/storage/uploads/file-limits
45. Supabase pricing. https://supabase.com/pricing
46. TikTok, Embed Videos (oEmbed; deprecation notice). https://developers.tiktok.com/doc/embed-videos/
47. TikTok, Embed Player. https://developers.tiktok.com/doc/embed-player
48. Meta, Instagram oEmbed. https://developers.facebook.com/docs/instagram-platform/oembed
49. Meta, oEmbed Read feature (App Review, business verification). https://developers.facebook.com/docs/features-reference/oembed-read
50. YouTube Help, Embed videos and privacy-enhanced mode. https://support.google.com/youtube/answer/171780
51. oEmbed specification. https://oembed.com/
52. US Copyright Office, DMCA Designated Agent Directory. https://www.copyright.gov/dmca-directory/
53. US Copyright Office, DMCA directory FAQ ($6; 3-year expiry). https://www.copyright.gov/dmca-directory/faq.html

**Organizing tools**
54. Action Network API docs. https://actionnetwork.org/docs
55. Action Network, Person signup helper. https://actionnetwork.org/docs/v2/person_signup_helper
56. Action Network, Record submission helper. https://actionnetwork.org/docs/v2/record_submission_helper
57. Mobilize API (GitHub). https://github.com/mobilizeamerica/api
58. NGP VAN, Getting started. https://docs.ngpvan.com/docs/getting-started
59. Mailchimp, Free plan details. https://mailchimp.com/pricing/free-details/
60. beehiiv pricing. https://www.beehiiv.com/pricing
61. ActBlue Help, Refcodes (refused automated fetch; not read). https://help.actblue.com/campaigns/tracking-and-data/refcodes/

**Messaging, email, minors and federal law**
62. Campaign Verify. https://www.campaignverify.org/
63. CTIA, Messaging Principles and Best Practices [May 2023]. https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf
64. 47 CFR 64.1200 (Cornell LII). https://www.law.cornell.edu/cfr/text/47/64.1200
65. *Facebook, Inc. v. Duguid*, No. 19-511 [decided Apr 1, 2021]. https://www.supremecourt.gov/opinions/20pdf/19-511_p86b.pdf
66. FTC, CAN-SPAM Act compliance guide. https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
67. Google, Email sender guidelines. https://support.google.com/a/answer/81126
68. FTC, COPPA frequently asked questions. https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
69. 11 CFR 110.11 (Cornell LII). https://www.law.cornell.edu/cfr/text/11/110.11

**Florida Statutes (2026 edition, Online Sunshine)**
70. Fla. Stat. 106.143, Political advertisements. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html
71. Fla. Stat. 106.011, Definitions. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.011.html
72. Fla. Stat. 106.1437, Miscellaneous advertisements. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.1437.html
73. Fla. Stat. 106.145, Use of artificial intelligence (ch. 2024-126). http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.145.html
74. Fla. Stat. 97.041, Qualifications to register (pre-registration at 16). http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html
75. Fla. Stat. 501.059, Florida Telephone Solicitation Act. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.059.html
76. Fla. Stat. 501.1736, Social media use for minors (2024). http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1736.html

**Accessibility, sharing, analytics**
77. W3C, WCAG 2.2 [edition dated Dec 12, 2024]. https://www.w3.org/TR/WCAG22/
78. W3C WAI, What's new in WCAG 2.2. https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/
79. WebAIM, The WebAIM Million [Feb 2026 analysis]. https://webaim.org/projects/million/
80. The Open Graph protocol. https://ogp.me/
81. web.dev, What does it take to be installable? https://web.dev/articles/install-criteria
82. Plausible Analytics pricing. https://plausible.io/#pricing
83. Fathom Analytics pricing. https://usefathom.com/pricing

**Project files and sibling reports (repo)**
84. `youngsemdem/assets/js/config.js`, `youngsemdem/docs/infra/core.md`, `youngsemdem/tests/infra/core.test.js`, `youngsemdem/functions/api/video-upload.js`, `youngsemdem/netlify/functions/video-upload.js`.
85. Research reports 02 (young-Dem websites, YDSC findings, Seminole demographics), 03 (design systems and palette), 04 (Gen Z virality, "Ask Claude" and invite-writer proposals) and 05 (voice), in `youngsemdem/docs/research/`.
