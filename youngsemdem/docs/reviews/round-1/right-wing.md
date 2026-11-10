# Round 1 review: head-to-head against the right

Reviewer lens: right-wing youth and party websites (TPUSA home, chapters, events and rewards; PragerU; YRNF;
College Republicans (CRNC and CRA); RPOF; Seminole GOP), scored against report 07's ten "must match" items and
BRIEF §6b. Reviewed Monday, November 9, 2026, at 12:20 to 1:30 pm, on the working tree at `3cbb603` plus
uncommitted changes. No site file was edited.

Evidence lives outside the repo at `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/rw-review/`
(called `RW/` below):

- `RW/bench/bench.md`, `RW/bench/bench.json`, `RW/bench/screens/*.png`: the `bench_compare.js --throttle 4g` run.
- `RW/qa.log`, `RW/qa_report.json`: `tools/qa.js` on the same six pages.
- `RW/shots/*.png`, `RW/shots1440/*.png`, `RW/crops/*.png`: our pages at 390 and 1440.
- `RW/text/*.txt`: the rendered text of each page, which every quotation below comes from.
- `RW/scripts/*.js`: the probes behind each measurement (CLS, the anchor jump, the fold, series filters, links).
- The right-wing screenshots are report 07's: `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/bench/right-*.png` (called `BENCH/` below).

---

## Summary

**On the website itself, we already beat every right-wing site measured, and by a lot.** Against the right group
under 4G throttling, our six pages weigh 225 to 289 KB gzipped (qa), load with 0 to 1 outside hosts (TPUSA: 48),
pass axe with 0 serious issues (TPUSA: 18; RPOF: 16), show no overlay (TPUSA: a 40% cookie banner), have no
horizontal overflow (RPOF: 415 px on a 390 px phone), and every one has a Spanish twin, a dark theme and Open
Graph tags (no right-wing site has Spanish or dark mode). On phones the first screen gives one social primary
action and one secondary, while TPUSA and PragerU lead with Donate. The vote hub is the most credible voting page
in the set. The quiz beats TPUSA's merch-quiz pop-up on every axis. All 16 qa gates pass on all six pages.

**Where we lose is the machine around the website: the reasons to belong, organize and come back.** Report 07's
headline was that the right wins young people "away from its websites" through chapters, kits, rewards, merch,
tentpoles and shows. That is exactly where this build is thinnest:

- **Chapter-in-a-box: lose.** "Host one" is a four-box checklist and a button to a plain join form. There's no kit,
  no human and no pitch form. All 11 host, crew and run-for-a-role links lose the visitor's intent.
- **Merch and collectibles: lose.** There's no wearable or physical identity object and no merch drop. The sticker
  book's 15 stickers share 9 pieces of art.
- **Shows, not posts: lose.** The Reel is six DEMO clips under topic filters, with no named recurring format
  and no open-mic format.
- **Tentpoles: tie.** The January drop is excellent, but no event is a tentpole, every series has a single date,
  and 10 of 15 quiz results link to empty, locked series.
- **Rewarded organizing: tie.** The rules are public and fairer than Patriot Rewards, but nobody sees them until
  after joining, and the only payoff is one DEMO sticker.
- **Belonging and sub-brands: tie.** There are city crews only, no teen path to rival Club America, and no identity
  crews to rival RPOF's coalitions or TPUSA's women's summit.

There are also two flow defects on the most important button. On phones, the hero's Join free scrolls to the
scoreboard, not the form (`#join` ends 630 px down and the first field at 821 px of 844). On every common laptop
size, the home hero buttons sit below the fold. One safety contradiction is blocking: a DEMO crew's "first
hangout idea" is on "somebody's porch", which breaks the site's own rule "A public place... Never someone's home"
for a 14-and-up group.

**Verdict for Kira.** As a website, it's ready to embarrass every right-wing youth site on speed, honesty,
accessibility and Spanish. As an organizing product, it matches TPUSA's mechanics on paper but not yet in
desire: there's nothing to wear, nothing to host with, no show to follow and no big night to circle. Fix the 1
blocking and 14 major findings below and it's a clear win on all ten items.

---

## Head-to-head metrics (bench_compare --throttle 4g, right group)

Command: `node tools/bench_compare.js --local index.html,events.html,vote.html,join.html,quiz.html,clips.html --group right --throttle 4g`
Generated Mon Nov 9, 2026, 12:27 pm. Chromium 153, phone 390x844 (2x), cold cache, 170 ms RTT, 9 Mbps.
axe-core 4.10.2. Full output: `RW/bench/bench.md`.

| # | Site | Score | MB | Req | DCL s | LCP s | CLS | 1st CTA s | CTAs 1st screen | Taps <44 | Overflow 390 | Img no alt | axe serious (contrast) | Overlay 1st screen | OG | Dark | Lang | Video | Share | Sign-up fields |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|---|---|---|---|---|---|--:|
| 1 | index.html (ours) | 93 | 0.63* | 28 | 1.4 | 0.7 | 0.00 | 0.7 | 1 | 0/64 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | no* | none |
| 2 | join.html (ours) | 86 | 0.59* | 28 | 1.2 | 0.7 | 0.57* | 0.7 | 1 | 1/52 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | no* | 4, phone |
| 3 | clips.html (ours) | 85 | 0.69* | 27 | 1.2 | 1.4 | 0.68* | 0.6 | 2 | 0/83 | no | 0 | 0 (0) | no | yes | yes | yes, ES | yes | button | none |
| 4 | events.html (ours) | 83 | 0.66* | 28 | 1.2 | 0.8 | 0.70* | 0.8 | 2 | 0/65 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | no* | none |
| 5 | quiz.html (ours) | 83 | 0.64* | 27 | 1.2 | 0.7 | 0.70* | 0.7 | 1 | 0/49 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | no* | none |
| 6 | vote.html (ours) | 82 | 0.72* | 25 | 1.3 | 0.7 | 0.75* | 0.7 | 1 | 0/254 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | no* | none |
| 7 | Turning Point USA | 66 | 2.59 | 160 | 2.6 | 1.1 | 0.04 | 1.1 | 1 | 27/50 | no | 2 | 18 (1) | 40% cookie banner | yes | no | no | autoplay | no | none |
| 8 | Young Republican National Federation | 59 | 2.08 | 52 | 2.6 | 4.3 | 0.03 | 1.4 | 1 | 4/6 | no | 0 | 4 (0) | no | yes | always-dark | no | no | no | none |
| 9 | College Republicans of America | 58 | 3.31 | 44 | 1.7 | 1.0 | 0.00 | n/a | 0 | 28/44 | no | 0 | 9 (8) | no | yes | no | no | no | no | 4 |
| 10 | Seminole County Republican Party | 56 | 3.33 | 37 | 2.5 | 4.8 | 0.00 | 1.5 | 2 | 7/17 | no | 0 | 3 (0) | no | partial | no | no | no | no | none |
| 11 | College Republican National Committee | 53 | 3.70 | 73 | 3.8 | 4.2 | 0.01 | 3.0 | 3 | 4/15 | no | 0 | 4 (1) | 17% cookie banner | yes | no | no | no | no | none |
| 12 | Republican Party of Florida | 49 | 2.36 | 58 | 3.3 | 4.5 | 0.00 | 2.0 | 3 | 6/50 | yes (415px) | 9 | 16 (1) | no | yes | no | no | no | no | 4, phone |
| 13 | PragerU | 41 | 6.41 | 159 | 2.4 | 11.1 | 1.00 | 1.2 | 0 | 31/82 | no | 3 | 0 (0) | no | yes | no | no | no | no | 2, phone |

Third-party requests (hosts): ours 0 to 2 (0 to 1); TPUSA 123 (48); PragerU 92 (36); CRNC 70 (9); CRA 43 (6);
YRNF 11 (7); RPOF 10 (4); Seminole GOP 5 (3). YRNF loaded this time (report 07 had it blocked).

**\* Three columns understate us. These are tooling artifacts, verified (finding right-wing-bench-artifacts):**

- **CLS 0.57 to 0.75** on five of our pages is not real. With the bench's own init script injected,
  `RW/scripts/cls.js` shows a single shift of 0.696 at 720 ms where `body.p-join` moves from y 8 to y 0: the
  browser's default 8 px body margin, laid out because the bench's CTA poller forces a layout before our four
  render-blocking stylesheets arrive. Without the poller the same page measures 0.000 on 4G. qa.js's own 4G pass
  measures CLS 0 to 0.005 on all six pages. A rerun of the bench reproduced it: index 0.57, join 0.75, events 0.72.
- **MB**: the local server sends files uncompressed, while competitors' bytes are compressed transfer. qa's
  gzip-6 first-view figures are home 251.3 KB, events 242.2, vote 249.3, join 225.5, quiz 238.7, clips 288.5,
  all inside the 350 and 500 KB budgets.
- **Share "no"** on five pages: each has a share button (qa B16: "1 share button(s)"), but it reads
  "Send it to the group chat", and the bench's `shareRe` only matches "share", "compartir" and "copy link".

qa.js on the same six pages (`RW/qa.log`): **16/16 gates pass on every page**. Home 40/40 measured 6b points.
B2 at 4G: home LCP 0.79 s, CLS 0.005, TBT 0 ms. B9: mail-ballot card at 983 px. B10: Reel at 1,523 px.

Note on TPUSA's weight: report 07 measured 19.0 MB on Nov 9. Today's bench recorded 2.59 MB because the
autoplay hero video (media 0 KB / 1 request) didn't download inside the measurement window. Report 07's number is
the real-user one.

---

## The ten "must match" items (report 07 §5): verdicts with evidence

| # | Item (their best) | Verdict | Evidence |
|---|---|---|---|
| 1 | One unmistakable action per screen (donaldjtrump.com three buttons; AmericaFest date + place + Register now; CRNC Join / Start a chapter) | **Beat on phones, lose on laptops** | 390x664: "Join free" + "See what's on", no overlay (qa B6), against TPUSA's Donate under a 40% banner (`BENCH/right-tpusa-mobile.png`). At 1366x768 the hero buttons start at 845 px; at 1440x900 they span 852 to 908 px (`RW/scripts/fold.js`, `RW/crops/index-1440-top.png`). AmericaFest's desktop Register now sits at about y 795 of 900 (`BENCH/right-tpusa-amfest-desktop.png`). The primary CTA also mis-scrolls on phones (finding 2). |
| 2 | Proof at scale (TPUSA 3,500+ / 1,500+ / 12,000+; CRA chapter dot-map) | **Tie (honest, but looks small)** | Every count says DEMO (qa B30 = 2), and "The real scoreboard" links each source. But home never shows that the chapter itself is real: the Florida Young Democrats listing and the real musical-theatre night are only on about.html. The same Sunset walk appears at y 683, 1,065 and 2,698. All seven crews say "Needs a host", and there's no map to answer CRA's (`BENCH/right-cra-mobile.png`). |
| 3 | Chapter-in-a-box (start-a-chapter form, free kits, 90+ field reps, chapter map, summit) | **Lose** | events.html#host: four rules plus "Join free to pitch it", which goes to `join.html`. No kit, no template, no reply promise. about.html: "Until the chapter picks a public contact, the join form is the way in." All 11 host, crew and role links go to a bare `join.html` (`RW/scripts/links.js`). |
| 4 | Rewarded activism (Patriot Rewards: points for organizing, merch and VIP payouts) | **Tie** | The criteria beat Patriot Rewards on fairness: 15 stickers, each with a public rule, and "Voting steps never earn stickers or anything else". But they're visible only after joining (`RW/crops/joined-04.png`); before that, join.html says only "a sticker book". The one payoff is "EXAMPLE PERK (DEMO): A welcome sticker at your first event". 15 stickers share 9 pieces of art. |
| 5 | Tentpole events with real urgency (AmericaFest Dec 17-20; PragerU gala) | **Tie** | The January drop beats them honestly: six locked tickets, "January's lineup drops Tue, Dec 15 at noon (DEMO)", Notify me .ics, a 36-day countdown (`RW/crops/events-390-light-02.png`, `-03.png`). But all five Nov-Dec events get the same card, none is a poster-grade night, and every `series` has one date. Quiz results link to locked series that show "0 events (DEMO)... Rest counts too." |
| 6 | Shows, not posts (Prove Me Wrong, Culture Apothecary, PragerU's streaming shelves) | **Lose** | clips.html: "6 CLIPS" under the filters "All · Voting help · Hangouts · Volunteer · This week's prompt". There's no named recurring format. The rituals (The Thursday Letter, the weekly prompt) are text, not video. |
| 7 | Participation formats (Pick Up the Mic, story submissions, creator program) | **Match** | The Post a clip flow has three unchecked consents, the minors question, a pending card and "A person on our team checks every clip, usually within 3 days" (qa B21 = 2). Creator night (DEMO) is a create format. There's no speak-up or open-mic format (folded into finding 11). |
| 8 | Quiz-style capture (TPUSA merch modal "Tell us what drives you"; Trump Store "Who are you shopping for?") | **Beat** | Inline, no modal: "No sign-up, no wrong answers, nothing saved but your result." Six types, nine issues, 9:16 cards and static result pages with OG tags. The issue picker comes after joining (step 2). Only the dead-end series links drag it down (finding 10). |
| 9 | Merch as identity (Never Surrender sneakers, Trump 2028 hats, CRNC merch ticker, TPUSA store) | **Lose** | No merch anywhere (`grep -ri merch` finds only legal notes). The identity objects are digital: the member card, the sticker pack PNG and share cards. CRNC opens with a "SHOP NEW MERCH" ticker (`BENCH/right-crnc-mobile.png`). |
| 10 | Belonging-first copy and sub-brands (YAF "There's a place for you here"; CRNC "since 1892"; Club America; RPOF coalitions) | **Tie** | The lines are strong: "Come as you are. Bring a friend.", "Events are free and open to everyone, in any party or none.", "first time? perfect", and "Not registered as a Democrat? The membership rule... doesn't mention how you're registered." But crews are city-only, and the 14-to-17 path is one FAQ ("I'm 16. Can I register?") at about 13,600 px on vote.html. Club America scored highest in report 07 (25/35). |

Report 07 §6 (their weaknesses) also checks out: on weight, walls, accessibility, Spanish, donor-first framing,
trackers, freshness and community safety we **beat** all of them, with the measurements above. On "platform
mismatch" we're neutral: the social links are rightly empty until the chapter confirms the accounts.

### Where a young independent finds us more credible

- Every voting claim carries a statute or official link plus "Links checked Nov 9, 2026". The Seminole GOP's top
  voter content is a party slate (`BENCH/right-seminolegop-mobile.png`); RPOF's is an "Official voter guide" banner.
- "No party? Here's what you can vote in." is honest and accurate ("Nonpartisan races, like school board, judges
  and city races... A primary race where every candidate is from one party..."). No right-wing site addresses
  NPA voters at all. It's buried at 12,223 px, though (finding right-wing-npa-depth).
- No trackers, no cookie banner, no Donate-first screen. Election results are labelled "unofficial until the county
  certifies, due Nov 16". The DEMO and REAL tags, plus the "Real or DEMO? Test yourself" toy on about, read as
  integrity, which the YR chat scandal and the UF College Republicans disbanding have made scarce on the right.

### Where they'd find us more fun

- The quiz types ("The Spreadsheet Witch: Give me chaos. I'll give you a tracker."), the cards and "Me, on the
  cover", sticker facts, trivia. It's kind fun, not TPUSA's *Prove Me Wrong* dunk content.
- The weak spots: nothing to wear, nothing to binge, nothing huge to circle on a calendar. Those are where the
  right's youth audience actually lives (report 07 §1).

---

## Per-page scores (0 to 100; 90 or more would beat the best right-wing benchmark for that page type)

| Page | Score | Best right-wing comparator | One line |
|---|--:|---|---|
| index.html | 82 | TPUSA home; CRNC; donaldjtrump.com | Fastest, cleanest first screen in the set on phones; loses on laptops (CTAs below fold), on the Join free jump, and on proof that the chapter is real. |
| events.html | 76 | AmericaFest; TPUSA events | The drop is better than anything on the right; there's no tentpole, the host kit is thin, and series filters dead-end. |
| events/trivia-county-edition.html | 84 | AmericaFest | Title, date, place and I'm in on the first screen at a fraction of AmericaFest's weight; no poster energy. |
| vote.html | 88 | Seminole GOP voter guide; RPOF voter guide | The most credible voting page in the set, sourced and bilingual; 22 screens long, with the NPA and 16-year-old answers buried. |
| join.html | 82 | RPOF join form; Club America | Three fields, honest tiers, a member card and sticker pack; rewards hidden until after joining, no host or crew intent, nothing to wear. |
| quiz.html | 86 | TPUSA merch quiz modal | Beats the quiz capture outright: no modal, nothing stored, great types. |
| quiz/show-up/*, quiz/issue/* | 74 | n/a | Lovely result pages; 10 of 15 link to empty, locked series (rent, transit and wages to nothing else). |
| clips.html | 77 | TPUSA shows; PragerU | The moderation and safety promises beat everyone; no named shows, no open mic. |
| about.html | 72 | CRA chapter map; YAF; Club America | The honesty section is exemplary; crews are a list of "Needs a host", there's no map and no human, and one crew idea breaks the safety rules. |
| es/index.html | 82 | (no right-wing site has Spanish) | Full parity (make_es: 0 untranslated); inherits the home issues. |

---

## Findings

Ordered by severity. Each names the files a fixer edits; regenerate `es/` twins with `node tools/make_es.js`
after EN or data edits. The known open items (Lighthouse LCP, long footer, small people photos, English in Reel
posters, rsvp.js double focus, the bottle photo, seo.home.title, the ticker pause button) aren't re-filed.

### Blocking

**right-wing-porch-home · about.html, crews: a DEMO crew's first hangout is at "somebody's porch"**
- Evidence: about.html renders "DEMO CREW / Chuluota Porch Club / Chuluota and east Seminole / FIRST HANGOUT IDEA /
  Lemonade on somebody's porch and a sign-making afternoon." (`RW/text/about.html.txt`; source
  `data/pages/about.js:171`, ES "Limonada en el porche de alguien"). The same site tells hosts "Every Young Dems
  event checks these four boxes... 1 A public place. A park, a library room, a café anyone can walk into. Never
  someone's home." (events.html#host). `data/events.js` deliberately leaves out the real SemDems holiday party
  because it is "at a private home... which doesn't fit a 14-and-up site's host rules". Report 07 §7 requires
  "public meeting venues only, never members' homes."
- Why it matters: membership starts at 14. A crew idea that contradicts our own teen safety rule is exactly the
  liability we use against the right (report 07 §6.9). A parent who reads both pages will notice.
- Fix: rewrite `crew.chuluota.idea` (EN and ES) to a public venue, e.g. "Lemonade at a park pavilion in
  Chuluota and a sign-making afternoon." The "Porch Club" name can stay as a vibe. Then regenerate es/about.html.
  Files: `data/pages/about.js`, `about.html`, `es/about.html`.

### Major

**right-wing-join-jump · index.html: the hero's Join free scrolls to the scoreboard, not the form**
- Evidence (`RW/scripts/joinjump2.js`, 390x844, normal motion): tapping `main a[href="#join"]` smooth-scrolls to
  y 5,087, but the page grows from 8,146 to 8,798 px during the scroll as the Reel and maker groups mount
  (`home.js` IntersectionObserver, rootMargin 500 px). `#join` ends at 630 px from the top and the first input
  at 821 px of an 844 px screen. The visitor sees "The real scoreboard", not the form (`RW/jump-1500.png`).
  Focus stays on `BODY`. With reduced motion it lands correctly (`#join` at 80 px).
  `home.js:281-287` preloads only the target's own lazy group, not the groups above it.
- Benchmark: RPOF puts its join form on the first screen; donaldjtrump.com's "Join us" goes straight to a form.
- Fix: on a click to `#join`, load every lazy group above the target, wait for them to resolve, then
  `scrollIntoView` and focus the first-name input (or reserve each lazy section's mounted height with
  `min-height` / `contain-intrinsic-size`). Re-test both motion settings, plus es/index.html.
  Files: `assets/js/pages/home.js`, `assets/css/pages/home.css`.

**right-wing-desktop-fold · index.html at laptop sizes: hero CTAs are below the fold**
- Evidence (`RW/scripts/fold.js`): "Join free" and "See what's on" sit at top 845 px at 1366x768, 836 at
  1280x720, 852 to 908 at 1440x900 and 862 at 1536x864. es/index.html: 826 at 1366x768. The eyebrow chip starts
  at 335 px whatever the viewport height, leaving about 215 px of empty purple above it (`RW/crops/index-1440-top.png`).
  qa's B6 checks only 390x664, so this passes the gate.
- Benchmark: AmericaFest desktop shows the lock-up, date, place and REGISTER NOW within 900 px
  (`BENCH/right-tpusa-amfest-desktop.png`); donaldjtrump.com shows its three buttons on one screen.
- Fix: size the hero to the viewport (`min-height: calc(100svh - header)`, content centred, H1 `clamp()` with a
  `vh` term, much less top padding) so the CTAs clear the fold by 80 px or more at 1366x768. Add a 1366x768
  first-screen check to qa. Files: `assets/css/pages/home.css`, `tools/qa.js`.

**right-wing-chapter-kit · events.html#host, about.html: there's no chapter-in-a-box**
- Evidence: the #host section is "Want to host the next one? Got an idea for a night? We'll help you plan it.",
  four rules, and "Join free to pitch it", which goes to `join.html`. There's nothing to download, no template,
  no timeline, no reply promise. about.html: "Want to talk to a real person? Until the chapter picks a public
  contact, the join form is the way in." qa B39 ("Starter kit") is "review", and I'd score it 1 of 2.
- Benchmark: TPUSA Students has a start-a-chapter form under the hero, free themed activism kits, a theme library,
  "90+ full-time Field Representatives", a chapter map and a summit (`BENCH/right-tpusa-startachapter-mobile.png`,
  `BENCH/right-tpusa-clubamerica-mobile.png`). Report 07 §5.3 sets our bar: a kit in English and Spanish, a
  first-meetup checklist, and a named human who replies within 48 hours.
- Fix: turn #host into a "Crew kit" block. (1) Downloadable EN and ES assets: a flyer template, a paper sign-in
  sheet (first names only, no minors' contacts), a first-hangout run-of-show, an access-note template, a share
  card. (2) A three-question pitch (city, kind of night, rough date) that carries `intent=host` into the join
  form. (3) A stated reply promise from a role, not a name, labelled DEMO until the chapter commits, e.g.
  "Your crew guide replies within 2 days (DEMO)". Files: `events.html`, `data/pages/events.js`,
  `assets/js/pages/events.js`, `assets/css/pages/events.css`, new `assets/kit/` files, `about.html`,
  `data/pages/about.js`.

**right-wing-intent-lost · 11 host, crew and role links all land on a bare join form**
- Evidence (`RW/scripts/links.js`): about.html "Start it with us" ×7, "Pitch a crew" and "Tell us you're curious"
  (run for a role) all go to `join.html`; events.html "Join free to pitch it" goes to `join.html`; the quiz result
  "Offer to host or emcee a night" goes to `../../join.html`. The join form asks first name, contact and age,
  then city, issues, language and access (`RW/text/join-after.txt`). There's no host, crew or role choice. The
  `WANTS` list in `joinform.js:81` ('students', 'lgbtq', 'spanish'...) never renders, because the issues list
  always wins (`joinform.js:389-390`).
- Benchmark: CRNC's first screen separates "Join a chapter" from "Start a chapter" (`BENCH/right-crnc-mobile.png`).
  TPUSA has separate forms for chapter, kit, creator program and story.
- Fix: pass intent in the URL (`join.html?intent=host&crew=sanford`, `?intent=role`, `?intent=crew`). Have
  joinform show a matching heading and a pre-ticked step-two chip ("I want to host a night", "I'm curious about a
  role", "Start a crew in {city}"), and store it in the payload. Add those three chips to step two.
  Files: `about.html`, `events.html`, `data/quiz.js` (result actions), `tools/make_quiz_pages.js`,
  `assets/js/joinform.js`, `data/strings.js`, `assets/js/pages/join.js`.

**right-wing-quiz-deadends · 10 of 15 quiz results link to empty, locked event series**
- Evidence (`RW/scripts/series.js`, grep of `quiz/*/*.html`): `events.html?series=karaoke`, `mixer`, `sunrail`,
  `picnic`, `canvass` and `workshop-es` all render "Only showing Karaoke nights × / 0 events (DEMO) / Nothing
  matches that one / No events this week. Rest counts too. Want to host the next one?" Those series are
  scheduled (karaoke Feb 12, mixer Jan 13 and so on) but sit behind the Dec 15 drop. The rent, transit and
  wages results link **only** to locked series. Hype Captain's "Events made for you" lists Karaoke nights and
  Member mixers, and both are empty. The copy is also wrong for the case: nothing is "this week".
- Benchmark: TPUSA's Pick Up the Mic and events pages always lead to a dated list.
- Fix: when a filtered series has only locked items, show its teaser ticket: "Karaoke is in January's lineup.
  It drops Tue, Dec 15 at noon (DEMO). Notify me (.ics)." Then show the next open event of the same kind
  underneath. Have the quiz generator prefer open series and fall back to the drop wording.
  Files: `assets/js/pages/events.js`, `data/pages/events.js`, `data/quiz.js`, `tools/make_quiz_pages.js`.

**right-wing-no-tentpole · events.html, index.html: no tentpole night, and no series recurs**
- Evidence: the five Nov-Dec events (sunset walk, trivia, text bank, creator night, renew-ready party) use
  identical cards (`RW/crops/events-390-light-0*.png`). Each `series` in `data/events.js` has exactly one dated
  item (`?series=trivia` shows "1 event (DEMO)"). Nothing says "every third Thursday". The home invites
  section is a carousel of equal cards.
- Benchmark: AmericaFest's neon lock-up, "December 17-20, Phoenix Convention Center" and REGISTER NOW
  (`BENCH/right-tpusa-amfest-mobile.png`). Pick Up the Mic's gig poster (`BENCH/right-tpusa-pickupthemic-mobile.png`).
  Report 07 §5.5: "a monthly Seminole tentpole plus weekly small hangouts."
- Fix: add `tentpole: true` and a `recurs` label to the data. Make the Renew-ready party (Dec 13, capacity 60)
  December's tentpole and give it a poster-grade band on events.html and home: big duotone lock-up, date ticket,
  a DEMO capacity bar, countdown, its own OG art. Show recurrence on the series cards ("Trivia · third Thursday,
  monthly (DEMO)") and give at least trivia a second dated instance. Files: `data/events.js`,
  `assets/js/eventcard.js`, `assets/js/pages/events.js`, `events.html`, `assets/css/pages/events.css`,
  `assets/js/pages/home.js`, `assets/css/pages/home.css`, `tools/make_event_pages.js`, `tools/make_og.js`.

**right-wing-shows · clips.html, home Reel: no named recurring formats, no open mic**
- Evidence: clips.html shows "6 CLIPS" under the filters "All / Voting help / Hangouts / Volunteer / This week's
  prompt". The clips are standalone (`@demo.sam` trivia recap, `@demo.priya` precinct captain, a PSA, a POV and
  so on), and none belongs to a named, scheduled format. The only ritual on video is the weekly prompt.
- Benchmark: TPUSA's shows shelf (*Culture Apothecary*, *Prove Me Wrong*, *Turning Point Tonight*,
  *TPUSA Originals*, `BENCH/right-tpusa-mobile-full.jpg`); PragerU's streaming shelves
  (`BENCH/right-prageru-mobile.png`); Pick Up the Mic. Report 07 §5.6 and §5.7.
- Fix: add a `series` field to clips with two or three named formats and a cadence line, e.g. "Seminole in 60"
  (explainers, Thursdays), "First Time?" (first-timer stories) and "En español" (a Spanish-first segment), all
  DEMO-labelled. Render them as shelves on clips.html and as a small series badge on home Reel cards. Add a
  monthly "Open mic: 3 minutes, your take (DEMO)" event, the kind answer to Pick Up the Mic.
  Files: `data/clips.js`, `assets/js/reel.js`, `assets/js/pages/clips.js`, `data/pages/clips.js`,
  `assets/css/pages/clips.css`, `data/events.js`.

**right-wing-merch · site-wide: no merch or wearable identity, no merch drop**
- Evidence: no merch, tee, tote or hoodie anywhere on a rendered page. A grep finds only legal notes and one
  event line, "Look for the celery-green tote bags (DEMO)". The identity objects are digital: the member card,
  the sticker pack PNG and share cards.
- Benchmark: CRNC's first screen is a "SHOP NEW MERCH" ticker (`BENCH/right-crnc-mobile.png`); TPUSA's merch
  store (`BENCH/right-tpusa-merch-mobile.png`); the sold-out Never Surrender sneaker drop (report 07 §4.6).
  Report 07 §5.9 sets our bar: "small, local, member-designed drops (city-specific designs, bilingual lines,
  inclusive sizing) with honest edition sizes."
- Fix: add a DEMO "Drop 01" band to home (near the invites drop) and to events: one member-designed piece
  (e.g. a Celery City crewneck with "La política local es un trabajo en equipo" on the back), "Edition of 100
  (DEMO)", sizes XS to 4XL, a preorder or Notify me .ics through `YSD.cal`, and "Designed by a member (DEMO)".
  Any free item goes only for organizing actions, never civic ones (ruling 00), with a counsel note.
  Files: `index.html`, `data/pages/home.js`, `assets/css/pages/home.css`, `events.html`, `data/pages/events.js`,
  `assets/js/cal.js` (reuse), `data/strings.js`.

**right-wing-rewards-hidden · join.html, index.html: sticker rules hidden until after joining, almost no payoff**
- Evidence: before joining, join.html says only "A member card with your first name, an invite link that gives
  you credit when friends join, and a sticker book. Stickers are for showing up and bringing friends, never for
  voting." After joining, `RW/crops/joined-04.png` shows the full book: 15 stickers, each with a public rule
  ("Squad of Three: Three friends join through your link", "The Long Game: Be active in 10 different weeks").
  The only tangible reward anywhere is "EXAMPLE PERK (DEMO): A welcome sticker at your first event".
- Benchmark: Patriot Rewards publishes its criteria and pays out chapter games, custom merch and VIP conference
  access (report 07 §4.1). Our rules are fairer (instant, public, nothing for voting), but a visitor can't see
  that before deciding to join.
- Fix: render the sticker book as a locked preview on join.html (and a three-sticker teaser on home near the
  quiz), with every rule visible and "Voting steps never earn stickers" kept. Add a DEMO perk ladder for
  organizing only, pending counsel per ruling 00: Squad of Three gets first pick of seats at the tentpole;
  The Long Game gets the next drop item. Files: `join.html`, `assets/js/pages/join.js`,
  `assets/js/membercard.js`, `data/levels.js`, `data/pages/join.js`, `index.html`, `data/pages/home.js`.

**right-wing-teen-path · join.html, vote.html, events.html: no Club America-grade path for ages 14 to 17**
- Evidence: the only teen-specific voting content is the FAQ "I'm 16. Can I register?" (accurate: "Florida lets
  you pre-register from your 16th birthday..."), in vote.html's FAQ at about 13,600 px. Join asks "How old are
  you?" with "We ask so we can follow our teen safety rules." There's no event filter for daytime or
  guardian-note events and no "what you can do at 14" section.
- Benchmark: Club America is a whole high-school brand (scrapbook look, free kit, chapter finder, a pledge for
  under-18s, parental resources) and scored highest in report 07's judgment table (25/35;
  `BENCH/right-tpusa-clubamerica-mobile.png`). Persona P3 (Ava, 15) is one of our three.
- Fix: add a "14 to 17? Here's your version" band on join.html and in the home membership section: what you
  can do at 14, pre-register at 16 (as a step card on vote.html, with no reward attached), daytime events, how
  the guardian note works, and a link to teen-safety for parents. Add a "Daytime / under-18 friendly" chip to
  the events filters. Files: `join.html`, `data/pages/join.js`, `vote.html`, `data/pages/vote.js`,
  `data/civic.js` (step), `events.html`, `assets/js/pages/events.js`, `data/pages/events.js`, `index.html`.

**right-wing-identity-crews · about.html, join step two: crews are city-only**
- Evidence: about.html's "CITY CREWS · DEMO" lists seven city crews and "Your crew here". There are no
  identity crews. Step two offers nine issues and three languages. The `WANTS` chips for 'students' and 'lgbtq'
  exist in code but never render (see right-wing-intent-lost).
- Benchmark: RPOF lists 10 identity coalitions (Hispanic and Latino, moms, educators...); TPUSA runs a Young
  Women's Leadership Summit; YAF's headline speaks to feeling out of place. Report 07 §5.10: crews "for Latino
  and Boricua members, LGBTQ+ members, disabled members, students, young parents and hospitality workers".
- Fix: add four or five DEMO identity crews beside the city crews (e.g. "Seminole State and UCF students",
  "Boricua and Latino crew, in Spanish first", "LGBTQ+ crew", "Young parents (kids welcome)", "Service and
  hospitality shift workers (late starts)"), each with a public-venue first hangout and the same "Needs a host"
  honesty. Make them pickable in join step two. Files: `about.html`, `data/pages/about.js`,
  `assets/js/pages/about.js`, `assets/css/pages/about.css`, `assets/js/joinform.js`, `data/strings.js`.

**right-wing-crew-map · about.html: no map, and every crew says "Needs a host"**
- Evidence: seven crew cards in a list, each ending "Needs a host / Start it with us". No map or locator, and
  no crew is mentioned on home or after choosing a city in join step two.
- Benchmark: CRA's chapter dot-map is report 07's "strong at-a-glance proof device" (`BENCH/right-cra-mobile.png`);
  Club America has a chapter finder.
- Fix: add a simple SVG map of Seminole with a pin per crew at a public landmark (Riverwalk, Lake Mary station,
  downtown Oviedo...), with a state per pin: "Forming (DEMO)" or "Needs a host". Show one or two as an example
  of an active crew, clearly DEMO, so the chapter sees the finished design. After a city pick in step two, show
  "Your crew: Celery City Crew (DEMO)". Files: `about.html`, `data/pages/about.js`, `assets/js/pages/about.js`,
  `assets/css/pages/about.css`, `assets/js/joinform.js`.

**right-wing-real-proof · index.html: home never shows that the chapter itself is real**
- Evidence: everything people- or org-related on home is DEMO. "The real scoreboard" holds county facts (1 in 3+
  voters are 18 to 40, 34.3% no party, about 54%, about 27%), not facts about us. The real proof lives only on
  about.html: "YDSC is real, and the Florida Young Democrats list it as a chapter", "A real thing YDSC did:
  YDSC has hosted a musical theatre night in Oviedo to raise money for a local charity that supports LGBTQ+
  youth", and the dues page.
- Benchmark: CRNC's "The best party on campus since 1892"; TPUSA's three big numbers. A skeptical independent
  needs one beat of "this is a real group" before the DEMO-heavy middle.
- Fix: add a three-item REAL strip to home under the hero or above the scoreboard: "A real chapter of the Florida
  Young Democrats", "Members from 14, dues optional", and "We've raised money for LGBTQ+ youth in Oviedo", each
  linked to its source with the checked date. Files: `index.html`, `data/pages/home.js`, `data/slices/home.js`,
  `assets/css/pages/home.css`.

**right-wing-bench-artifacts · tools: the head-to-head table Kira will show understates us on three columns**
- Evidence: see the asterisked notes under the metrics table. CLS reads 0.57 to 0.75 against 0 to 0.005 in qa and
  a clean probe (`RW/scripts/cls.js`: `body.p-join [8,836]->[0,844]`, 0.6957 at 720 ms, only with the bench's
  poller). MB reads 0.58 to 0.70 uncompressed against competitors' compressed bytes, while qa gzip is 225 to
  289 KB. Share reads "no" because `shareRe` (bench_compare.js:532) doesn't match "Send it to the group chat".
- Why major: B2 is a GATE "measured by bench_compare.js", and this table goes in front of the chapter. As
  printed, it says our pages shift 15 times more than TPUSA's.
- Fix: (1) ignore layout shifts that happen before first contentful paint, or start the CTA poller after
  `DOMContentLoaded`. (2) gzip text responses in the local server (or report qa's gzip figure for ours).
  (3) add `group chat|grupo|mándalo` to `shareRe`. Belt and braces: an inline `body{margin:0}` in the head partial.
  Files: `tools/bench_compare.js`, `tools/check_site.js`, `partials/head.html`.

### Minor

**right-wing-repeat-event · index.html: the same Sunset walk appears three times**
- Evidence (`RW/scripts/repeat.js`): "Sunset walk-and-talk on Lake Monroe" at y 683 (hero ticket), y 1,065
  (the third pinned card, x 710) and y 2,698 (the first invites card). Scrolling down, you meet it twice in the
  first three screens.
- Benchmark: TPUSA's "Latest & upcoming" carousel shows several different events (`BENCH/right-tpusa-mobile-full.jpg`).
- Fix: start the invites carousel and the pinned "next hangout" card from the event after the hero's.
  Files: `assets/js/pages/home.js`, `data/slices/home.js`.

**right-wing-sticker-art · 15 stickers, 9 pieces of art**
- Evidence: `data/levels.js` `art:` values: heart ×3 (Saved Seat, Squad of Three, Bridge Builder); train ×2
  (On the Platform, City Hopper); camera ×2 (On Camera, Card Maker); cypress ×2 (Shift Done, The Long Game);
  sun ×2 (Golden Hour, Called It). Visible in `RW/crops/joined-04.png`.
- Benchmark: collectibles drive desire through unique art (Starface; report 08), and that's our answer to
  Patriot Rewards merch.
- Fix: draw six more county stickers (e.g. Lake Jesup gator boat, Riverwalk lamp, Big Tree stump, Oviedo
  chicken with a megaphone, a SunRail ticket, a bilingual speech bubble) so each sticker is unique.
  Files: `data/stickers.js`, `data/levels.js`, `assets/js/cards-brand.js`.

**right-wing-npa-depth · vote.html: the independent's answer sits 14 screens down**
- Evidence (`RW/scripts/voteh.js`): page height 18,799 px at 390. "No party? Here's what you can vote in." is at
  12,223 px and the FAQ "I'm NPA. What can I actually vote on?" at about 13,600. The hero's jump links are "Check
  My Voter Record / Make my plan / What changed". Most young Seminole voters are NPA (ruling 00).
- Fix: add a "No party?" jump chip to the hero, or move the NPA block to directly after "Two rules change on
  Jan 1, 2027". Files: `vote.html`, `data/pages/vote.js`, `assets/js/pages/vote.js`.

**right-wing-sunrail-saturday · clips: a SunRail clip's action chip points to a Saturday event**
- Evidence: `@demo.jordan`: "Took SunRail to the rally. No parking, no stress. Who is riding next time?" with
  the chip "Next hangout: Sat, Nov 14". SunRail's regular service runs weekdays (our own crew card says
  "Weekdays only, like SunRail"). A local will catch this. Confidence: high that regular service is weekdays;
  special weekend runs happen, so check before quoting it.
- Fix: map SunRail-tagged clips to the SunRail social (Thu, Jan 21) teaser, or to the next weekday event.
  Files: `assets/js/reel.js`, `data/clips.js`.

---

## Notes for Kira (not findings)

- The hero H1 "Local politics is a group project." is binding (BRIEF §2.7 line 1). Against YAF's "Feel out of
  place as a conservative at your school? There's a place for you here." it's cleverer but colder: it names the
  task, not the visitor's feeling, and for students "group project" can mean "I'll do all the work". The rotor
  and "Come as you are. Bring a friend." carry the belonging well. Worth one gut check with two or three
  19-year-olds before launch. No change is filed.
- Everything we beat the right on (speed, no trackers, accessibility, Spanish, honest DEMO labels, community
  safety) is invisible unless we say it. A single footer-level line ("No trackers. Every page in Spanish. A person
  checks every clip.") would turn our engineering into a visible brand promise.
