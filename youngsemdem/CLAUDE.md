# YDSC demo site (youngsemdem/)

This folder is the demo website for the **Young Democrats of Seminole County (YDSC)**, the chartered chapter for ages 14 to under 40 in Seminole County, Florida. Kira (she/her) is a member and is getting the chapter's sign-off. It has nothing to do with the Fight Lab code elsewhere in this repo, and the repo-root CLAUDE.md does not apply here, except its general working rules. Start with `HANDOFF.md`.

## Binding rules (never break these)
- **Name and ages.** Use "Young Democrats of Seminole County", "YDSC" or "Young Dems". The handle is `youngsemdems`. Ages are "14 to 39" or "under 40", never "40 and under".
- **No AI features of any kind.** Kira cut the chat assistant. The infra tests fail if one appears.
- **Facts.** Every fact comes from `data/*.js` (each has a source and a verified date) and from `docs/research/00-lead-factcheck.md`, which overrides everything else. The mail-ballot wording is fixed: requests made before Nov 3, 2026 end Dec 31, 2026; a new request should run through 2028; check My Voter Record. Student IDs stop counting at the polls on Jan 1, 2027 (HB 991, which is being challenged in court).
- **DEMO labels.** Every demo person, event, count, clip and quote says DEMO in English and Spanish. Never invent stats, quotes, endorsements or social proof.
- **Content limits.**
  - No Native American imagery or language.
  - No candidate names ("the Democrat" / "the Republican").
  - No alcohol in photos. Never use Unsplash photo 1758272134088.
- **Nothing of value for civic steps** (registering, renewing, voting; 52 U.S.C. 10307(c)). Merch and perks attach only to organizing.
- **Accessibility and layout.** Mobile first at 390 px, working at 320 px. Text at least 12 px, tap targets at least 44 px, WCAG 2.2 AA in light and dark, reduced motion respected, no horizontal scroll.
- **Static and portable.** Plain HTML/CSS/vanilla JS with classic scripts. No ES-module imports and no fetch() of local data. It must work from file://, from `python3 -m http.server`, and on Netlify or Cloudflare Pages.
- **Every page footer carries:**
  - the "Paid for by [placeholder]" line
  - the DEMO label
  - the not-official line
- **Spanish twins.** Every page has a Spanish twin under `es/`, generated only by `node tools/make_es.js` from `data-t` keys. Never hand-edit `es/*.html`.

## How it's built
- Shared header, footer and banner live in `partials/`. They are synced into pages by `python3 tools/sync_partials.py [pages]`.
- Design tokens and components are in `assets/css/`. The live reference is `styleguide.html`; usage notes are in `docs/BUILDERS.md`.
- Module APIs are documented in `docs/infra/README.md`:
  - `YSD.store`, `YSD.members`, `YSD.share`, `YSD.cal`, `YSD.cards`
  - `YSD.clips`, `YSD.feed`
  - `YSD.ui`, `YSD.rsvp`, `YSD.maker`, `YSD.membercard`, `YSD.reel`, `YSD.joinForm`
- One file holds every swappable value: `assets/js/config.js`.
- Data is in `data/*.js` (classic scripts assigning `window.YSD_DATA`). Generated subsets are in `data/slices/`, written by `node tools/slice_data.js`.
- Generated pages:
  - `events/*.html` from `tools/make_event_pages.js`
  - `quiz/**` from `tools/make_quiz_pages.js`
  - OG images from `tools/make_og.js`
  - demo clips from `assets/video/render_clips.js`

## Before you call anything done
```
python3 tools/sync_partials.py --check
node tools/make_es.js --check --all
node tools/slice_data.js --all --check
node tools/voice_lint.js
node tools/check_site.js
node tools/qa.js --all        # every GATE must pass (320/390/1440, light and dark, scenarios)
npm test                      # infra suites
node tests/site/w8.test.js    # QA-tool fixtures
```
To look at pages, run `node tools/shoot.js --pages <pages>`, which writes screenshots and contact sheets. For a head-to-head against the right-wing and Gen Z brand benchmarks, run `node tools/bench_compare.js --throttle 4g`.

## Working with Kira
Be direct and execution-oriented. Check current facts on the web and cite sources; flag confidence. Times in am/pm.
