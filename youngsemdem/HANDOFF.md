# YDSC demo site: handoff

This is the demo website for the **Young Democrats of Seminole County (YDSC)**, the chartered chapter for ages 14 to under 40 in Seminole County, Florida. Kira (she/her) is a member and is getting the chapter's sign-off. Claude built it over Nov 9 and 10, 2026, with research, three competing concepts, a judged build brief, parallel builders, independent checkers and two review rounds.

- **Repo:** `rolexpolexnamusyounotgetus-create/XX`, branch `ccr-096cab71-7z1m23`, draft PR #1. Everything lives in this `youngsemdem/` folder and none of the Fight Lab code is touched.
- **Status:** see "Where it stands" at the bottom.

## Pick it up in a new chat
1. Open this repo on branch `ccr-096cab71-7z1m23`, or unzip the site zip Kira was sent.
2. Read `youngsemdem/CLAUDE.md`, which holds the binding rules. Then read this file, `docs/BRIEF.md` (the master spec) and `docs/research/00-lead-factcheck.md` (fact rulings, which override everything else).
3. Run it locally: `cd youngsemdem && python3 -m http.server 8000`, then open http://localhost:8000. Or open `index.html` straight from disk; it works from file:// too.
4. Before you change anything, run the checks listed in `CLAUDE.md` to see the green baseline.

## What's on the site
44 English pages, each with a Spanish twin under `es/`, except the styleguide. That makes 101 HTML files.

| Page | What it does |
|---|---|
| `index.html` | **Home.** "Local politics is a group project." The next event, the mail-ballot countdown, the Reel, the January drop with the Drop 01 merch teaser (earned by organizing only), the quick card maker, the quiz, "This chapter is real", the Nov 3 debrief, and "$20 a year. Or free." |
| `events.html`, `events/*.html` | **Events.** Partiful-style invite pages (17), the Seminole Sunday recurring tentpole, Open Mic, the January lineup drop on Tue, Dec 15 at noon, an under-18 filter, and an RSVP with a neutral age screen, a "you're in" ticket and an "I'm going" story card. |
| `host.html` | **Host a night.** Chapter in a box: rules, a 3-week plan, a checklist, invite texts and cards. |
| `vote.html` | **2027 Ready.** The Dec 31 and Jan 1 dates (shareable), steps by voting method, an answer for independents, an Under-18 block, and official links only. |
| `issues.html` | Nine issues with sourced Seminole numbers, and one action each. |
| `clips.html`, `post.html` | **The Reel.** A video-first feed with EN/ES text captions, 5 named shows, and posting with a phone preview, consents, a minors check and human review. |
| `quiz.html`, `quiz/**` | "How do you show up?" (6 types) and "Find your issue" (9 identities). Illustrated characters, poster share cards, and result pages that greet the friend who sent them. |
| `join.html` | Join in under a minute: 3 required fields, a live member card, under-14/under-18/over-40 paths, intents (host, crew, role, volunteer), identity crews, and public sticker rules. |
| `newsletter.html` | A sample issue of the Thursday Letter. |
| `about.html` | The Real-or-DEMO game, the crew map, city and identity crews, "What's real", and open roles. |
| `privacy`, `accessibility`, `teen-safety`, `content-policy`, `conduct` | DRAFT policies (counsel must review), each with a Forget me button. |
| `404.html` | Decorate the laptop with county stickers, then send a card of it. |
| `offline.html`, `styleguide.html` | Offline fallback; the live component reference. |

## How it's built
- Plain static HTML, CSS and vanilla JS. No build step to deploy: drag the folder onto Netlify or Cloudflare Pages (`DEPLOY.md`).
- `assets/js/config.js` holds every swappable value: links, integrations, legal lines and the demo flag.
- Data lives in `data/*.js`, bilingual, with every fact sourced and dated. Generated subsets go to `data/slices/`.
- Generators:
  - `tools/make_es.js`: Spanish twins
  - `tools/make_event_pages.js`: event pages
  - `tools/make_quiz_pages.js`: quiz result pages
  - `tools/make_og.js`: OG images
  - `tools/make_brand.js`: brand assets
  - `assets/video/render_clips.js`: demo clips
- QA tools:
  - `tools/qa.js`: the gates at 320, 390 and 1440, light and dark, with interaction scenarios
  - `tools/check_site.js`
  - `tools/voice_lint.js`
  - `tools/shoot.js`: screenshots
  - `tools/bench_compare.js`: head-to-head against the right-wing sites and Gen Z brands
- Docs:
  - `docs/BUILDERS.md`: components and helpers
  - `docs/infra/README.md`: module APIs
  - `docs/QA.md`: the gates
  - `docs/LAUNCH_KIT.md`: a 30-day content plan, video scripts and texts
  - `docs/legal/`: policy drafts

## Decisions, and why
- **The real chapter, real rules.** The site uses the chapter's real name, the handle `youngsemdems`, ages 14 to 39 (the chapter's dues page says "under 40"), and $20 a year or free (non-voting membership for hardship). Its public ActBlue pages are in config.
- **No AI.** Kira cut the chat assistant, and the tests enforce that.
- **Facts are law.** Ruling 00 governs:
  - **Mail ballots:** a request made before Nov 3, 2026 ends Dec 31, 2026. A new request should run through 2028. Check My Voter Record.
  - **Student IDs:** they stop counting at the polls on Jan 1, 2027 (HB 991), and the change is being challenged in court.
  - **Election figures:** Seminole voted for the Democrat for governor, about 54% to 45% (unofficial until certified).
  - **Independents:** they are the biggest group of young voters here, so the tone invites rather than scolds.
- **Nothing of value for civic steps.** 52 U.S.C. 10307(c) rules this out. Badges can celebrate, but merch and perks attach only to organizing.
- **Honest demo.** Every demo person, event, count, clip and quote is labelled DEMO in both languages. The site never invents social proof, and it names no candidates. Photos are stock, labelled, with no alcohol and no Native imagery.
- **Design:** "Saved Seat".
  - Concept A ("Group Chat") won all three judges, then was evolved.
  - Each page has its own colour world: violet home, celery events, tangerine host kit, lake vote, night Reel, sun post, bubblegum quiz, sky join, mint newsletter, teal about, orange 404.
  - The brand mark is a ticket stub ("your seat, saved") with a lettered "Young Dems".
- **Beat the right on what they neglect.** Their pages run 2 to 40 MB, with pop-ups, no Spanish and poor accessibility. Ours are about 0.3 MB per first view, with no pop-ups, full Spanish and WCAG 2.2 AA. We match their best mechanics: clear asks, events and tentpoles, a host kit, rewarded organizing and merch.

## The paper trail
| Where | What |
|---|---|
| `docs/research/01-08` | Sourced research: Seminole facts, the young-Dem chapter audit, left design systems, Gen Z brands and virality, the voice guide, tech and compliance, the right-wing teardown, the Gen Z brand and beauty teardown |
| `docs/concepts/` | The three original concepts |
| `docs/BRIEF.md` | The master spec, including the §6b benchmark bar |
| `docs/reviews/round-1/` | Five-lens review reports, 73 findings and the fix plan |
| `docs/reviews/round-2/` | Round-2 reviews, and fixes if any |

## Before launch: the chapter's decisions (via Kira)
1. **Sign-off,** and who owns **youngsemdems.com**. It expires Dec 31, 2026; renew it.
2. **Committee status,** which sets the "Paid for by" wording (F.S. 106.143) and whether texting is allowed.
3. **Real content:** real events, officers, photos and videos with consent, to replace every DEMO item. The Real-or-DEMO game on About lists them.
4. **Spanish:** review by a native Spanish speaker. It is written in neutral Latin American Spanish and has not had a human review.
5. **Counsel review** of `docs/legal/*` (privacy, teen safety, clip rules, conduct) and of the perk ladder.
6. **Accounts and integrations:**
   - social handles (only Instagram @youngsemdems is confirmed, via Florida Young Democrats)
   - an SMS number
   - Action Network or a form endpoint
   - Mobilize
   - a clip moderator and a response time
   - analytics
7. **Policies the copy assumes:** every event is free, alcohol-free and 14+; a human reviews every clip.

## Dated re-checks
- **After Mon, Nov 16, 2026:** certified results. Update the debrief, the scoreboard and the "unofficial" labels.
- **By Tue, Dec 15, 2026:**
  - Ask the elections office (407-585-8683) whether requests made Nov 4 to Dec 31 count for 2027 and 2028. If yes, set `sharekit.confirmed['soe-2027-requests-open']`.
  - The January drop opens at noon.
- **Before Jan 1, 2027:** check the student-ID lawsuit; if a court blocks the ban, rewrite that copy. On Jan 1, the vote copy flips to the 2027 wording (built in, clock-based).
- **As events pass:** rerun `node tools/slice_data.js --all` and `node tools/make_event_pages.js`. Home's event slice empties after Jan 21, 2027 unless new events are added.

## Where it stands
Updated Tue, Nov 10, 2026.
- **Built:** all pages in EN and ES. Two review rounds, with fixes from 8 parallel groups plus an integration gate.
- **Integration gate (after round 1):**
  - `qa.js --all`: 101 pages, 0 gate failures
  - 170/170 cross-page flow checks (http and file://, EN and ES)
  - `npm test` green: core 435, video 693, tooling 26, integration 188
  - site tests 35/0
  - `check_site`: 0 errors
  - `voice_lint`: 0 errors
- **Round 2:** see `docs/reviews/round-2/` and the final summary appended below.
