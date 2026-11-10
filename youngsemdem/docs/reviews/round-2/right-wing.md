# Round 2 review: head-to-head against the right

Reviewer lens: right-wing youth and party websites (TPUSA home, chapters, events, rewards and merch; PragerU;
YRNF; College Republicans (CRNC and CRA); RPOF; Seminole GOP), scored against report 07's ten "must match" items
and BRIEF §6b. Reviewed Tuesday, November 10, 2026, 6:20 to 7:40 am, on the working tree at `2a0ca86`
("integration pass in progress"). No site file was edited.

Evidence lives outside the repo at `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/rw2/`
(called `RW2/` below):

- `RW2/bench/bench.md`, `bench.json`, `screens/*.png`: the `bench_compare.js --throttle 4g` run.
- `RW2/qa.log`, `RW2/qa_report.json`: `tools/qa.js` on eight pages.
- `RW2/shots/*.png` (390 and 1440, light), `RW2/shots2/*.png` (event pages), `RW2/crops/*.png` (slices and close-ups).
- `RW2/text/*.txt`: rendered text of 16 pages; every quotation below comes from these or from the named data file.
- `RW2/scripts/probe*.js`: the measurements (join jump, folds, intent landings, tap targets, series filters, positions).
- `RW2/probe1.json`, `RW2/probe2.json`: raw probe output.
- The right-wing screenshots are report 07's: `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/bench/right-*.png` (called `BENCH/`).
  First screens side by side: `RW2/crops/bench-right-0.png` (TPUSA, Club America, CRNC, AmericaFest, TPUSA Students,
  Pick Up the Mic) and `RW2/crops/bench-right-1.png` (TPUSA merch, CRA, PragerU, RPOF, Seminole GOP, YAF).

---

## Summary

**Round 1's fixes held, and the site now matches or beats the right on eight of report 07's ten items.** Every one
of round 1's 19 right-wing findings was addressed (status table below). The home hero's Join free now lands on the
form with focus in both motion settings. Laptop folds are clear. There is a real chapter-in-a-box (`host.html`),
a monthly tentpole (Seminole Sunday), named video formats, an Open Mic answer to Pick Up the Mic, identity crews,
a crew map, a 14-to-17 path on three pages and public sticker rules before joining. Mechanically, it's now the most
complete youth organizing site in the set. On the website basics the gap is enormous: under 4G throttling our six
pages weigh 0.30 to 0.49 MB against 2.1 to 6.5 MB, contact 0 to 1 outside hosts against TPUSA's 48, show no overlay
against TPUSA's 40% cookie banner, pass axe with 0 serious issues against TPUSA's 18 and RPOF's 16, and are the only
pages in the set with Spanish and dark mode. All 16 qa gates pass on all eight pages I ran.

**Where we still lose or only tie is the desire and consistency layer, the part the right does off-site:**

- **Rewarded organizing: tie.** The rules are public, but the site shows three different perk ladders (home, host,
  join). Inconsistent rules are exactly the opacity we say we beat Patriot Rewards on.
- **Merch: tie.** Drop 01 exists and is honest, but it's a 104-px clip-art strip inside a box at 3,506 px on home,
  and nowhere else. TPUSA and CRNC sell identity; we list it.
- **The chapter ask: under-powered.** The host kit is excellent, but home never offers "start a crew". "Pitch your
  night" is a bare join form that drops the pitch. "Join this crew" signs people up to *start* the crew.
- **The join page itself** puts its form below the first screen on phones (submit at 1,180 px of 844) and on
  laptops. RPOF puts four fields on its first phone screen.
- **The tentpole's own invite page** looks like every other event page, and the December edition advertises snacks
  as part of a mail-ballot renewal pitch. That copy needs a guard (ruling 00; counsel call).
- **Credibility own goals in the Reel:** the "Lake Monroe canvass" clip shows a legible sign for Innisfil, Ontario
  and a "NO SOLICITING" sign. The mail-ballot clip shows the USPS Official Election Mail logo that the events team
  already removed under BRIEF 3.6.
- **Nothing in the lineup speaks to young men** through sport, gaming or fitness, which is where the right's 2024
  youth gains came from (report 07 §1).

No blocking findings. 10 major and 11 minor, below.

**Verdict for Kira.** On the website, we beat every right-wing youth site by a distance that no one will argue with,
and the organizing machine now exists on the page. To beat TPUSA Students and Club America in *desire*, not just
in mechanics, make the rewards one consistent ladder with merch people want to wear, put "start a crew" on home,
and make the Seminole Sunday invite page a poster. Each fix is a few files.

---

## Head-to-head metrics (bench_compare --throttle 4g, right group)

Command: `node tools/bench_compare.js --throttle 4g --local index.html,events.html,vote.html,join.html,quiz.html,clips.html --group right --out RW2/bench`
Generated Tue Nov 10, 2026, 6:23 am. Chromium 153, phone 390x844 (2x), cold cache, 170 ms RTT, 9 Mbps.
axe-core 4.10.2. Full output: `RW2/bench/bench.md`.

| # | Site | Score | MB | Req | DCL s | LCP s | CLS | 1st CTA s | CTAs 1st screen | Taps <44 | Overflow 390 | Img no alt | axe serious (contrast) | Overlay 1st screen | OG | Dark | Lang | Video | Share | Sign-up fields |
|---|---|--:|--:|--:|--:|--:|--:|--:|--:|--:|---|--:|--:|---|---|---|---|---|---|--:|
| 1 | join.html (ours) | 100 | 0.31 | 28 | 1.1 | 0.8 | 0.00 | 1.2 | 1 | 1/67 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | button | 4, phone |
| 2 | index.html (ours) | 97 | 0.35 | 27 | 1.2 | 0.8 | 0.01 | 1.2 | 1 | 0/68 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | button | none |
| 3 | events.html (ours) | 97 | 0.30 | 27 | 1.1 | 0.7 | 0.00 | 1.1 | 2 | 0/76 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | button | none |
| 4 | quiz.html (ours) | 97 | 0.31 | 28 | 1.0 | 0.7 | 0.00 | 1.0 | 1 | 0/50 | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | button | none |
| 5 | clips.html (ours) | 97 | 0.49 | 30 | 1.1 | 1.5 | 0.00 | 1.1 | 1 | 0/90 | no | 0 | 0 (0) | no | yes | yes | yes, ES | yes | button | none |
| 6 | vote.html (ours) | 96 | 0.32 | 25 | 1.2 | 0.6 | 0.00 | 1.2 | 2 | 26/197* | no | 0 | 0 (0) | no | yes | yes | yes, ES | no | button | none |
| 7 | Turning Point USA | 62 | 3.28 | 181 | 2.4 | 0.9 | 0.04 | 2.4 | 1 | 27/50 | no | 2 | 18 (1) | 40% cookie banner | yes | no | no | autoplay | no | none |
| 8 | Young Republican National Federation | 59 | 2.08 | 52 | 2.2 | 3.9 | 0.03 | 2.2 | 1 | 4/6 | no | 0 | 4 (0) | no | yes | always-dark | no | no | no | none |
| 9 | College Republicans of America | 58 | 3.31 | 44 | 1.7 | 0.8 | 0.00 | n/a | 0 | 28/44 | no | 0 | 9 (8) | no | yes | no | no | no | no | 4 |
| 10 | Seminole County Republican Party | 53 | 3.26 | 36 | 2.8 | 4.8 | 0.00 | 2.8 | 2 | 7/17 | no | 0 | 3 (0) | no | partial | no | no | no | no | none |
| 11 | PragerU | 51 | 6.50 | 159 | 1.0 | 10.4 | 0.01 | 1.1 | 0 | 32/83 | no | 3 | 1 (0) | no | yes | no | no | no | no | 2, phone |
| 12 | College Republican National Committee | 51 | 3.74 | 73 | 3.8 | 4.3 | 0.01 | 3.8 | 3 | 4/15 | no | 0 | 4 (1) | 17% cookie banner | yes | no | no | no | no | none |
| 13 | Republican Party of Florida | 45 | 2.18 | 57 | 3.5 | 4.3 | 0.00 | 3.5 | 3 | 6/50 | yes (415px) | 9 | 16 (1) | no | yes | no | no | no | no | 4, phone |

Third-party requests (hosts): ours 0 to 1 (0 to 1); TPUSA 143 (48); PragerU 92 (36); CRNC 70 (9); CRA 43 (6);
YRNF 11 (7); RPOF 9 (4); Seminole GOP 5 (3).

Round 1's three tooling artifacts are fixed. CLS now reads 0.00 to 0.01 (was 0.57 to 0.75). MB is gzipped like the
competitors' (0.30 to 0.49). Share reads "button" (was "no"). \* One new artifact: vote's "26/197" is not real
(finding right-wing-bench-taps). The small elements are checkboxes inside 71x44 labels and opacity-0 radios inside
44-px chips; qa B31 measures "targets 44+".

Notes:

- **TPUSA's weight.** The 3.28 MB recorded here leaves out its autoplay hero video, which didn't download inside
  the measurement window (media 0 KB / 1 request). Report 07's 19.0 MB is the real-user figure.
- **qa.js on eight pages** (`RW2/qa.log`): 16/16 gates on every page. B1 first view: home 296.7 KB / 350
  (round 1: 251.3), events 267.4, vote 285.9, join 278.2, quiz 278.4, clips 445.6 / 500 with 30 / 30 requests,
  host 221.0, about 241.9. B2 at 4G: LCP 0.66 to 1.71 s, CLS 0 to 0.002, TBT 0 to 26 ms. B9: mail-ballot card at
  988 px. B10: Reel at 1,525 px.
- `make_es.js --check --all`: 18 pages, 0 untranslated. `voice_lint.js`: 132 files, 0 errors. No console errors on
  16 pages at 390 (`RW2/probe1.json`), and no horizontal overflow (scrollWidth 390 on all of them).

---

## Round 1 right-wing findings: did the fixes hold?

| Round 1 id | Status | Evidence (round 2) |
|---|---|---|
| porch-home (blocking) | **Held** | about.html: "Chuluota Pavilion Club (needs a host)"; no "porch" anywhere in the rendered text. |
| join-jump | **Held** | Tapping the hero's Join free at 390x844: `#join` top -11 px, first input at 170 to 218 px, focus on `INPUT#jf1-first`. The same with reduced motion (`RW2/probe2.json`, `RW2/crops/jump-no-preference.png`). |
| desktop-fold | **Held** | Home CTAs end at 612 px at 1280x720, 632 at 1366x768, 710 at 1440x900 and 693 at 1536x864. es/index.html: 577 / 599 / 681. |
| chapter-kit | **Held**, residual | `host.html`: house rules, a 3-week plan, a 10-item checklist, a flyer, story card and name-tag maker, five invite texts and a reply promise. The pitch doesn't capture the night: new finding right-wing-pitch. |
| intent-lost | **Held**, residual | 20 links carry `?intent=` (about ×15, events ×1, host ×2, quiz result pages ×2). join.html shows "Join free. Hosting starts here." (EN and ES). "Join this crew" mislabels as start: new finding right-wing-join-crew. |
| quiz-deadends | **Held** | `events.html?series=sunrail` shows "Coming in the January drop · SunRail Social is in January's lineup... JAN 21 5:30 pm · Notify me · Open now, same kind of night:" followed by open events (`RW2/scripts/probe4.js`). |
| no-tentpole | **Held**, residual | Seminole Sunday band on events and home: lock-up, "38 of 60 seats saved (DEMO)", "33 days to go", next dates. Trivia and Open Mic now have 3 dates each. Residuals: right-wing-tentpole-page, right-wing-drop-contradiction, right-wing-series-one-date. |
| shows | **Held**, residual | Five formats with cadence lines: Seminole in 60 (Thursdays), First Time? (Tuesdays), Crew Cam, En español, Open Mic (`RW2/crops/clips-1440-top.png`). Hidden on phones: right-wing-formats-phone. |
| merch | **Partly** | Drop 01 on home only, small: right-wing-merch. |
| rewards-hidden | **Held**, residual | join.html "How stickers work · 15 county stickers, each with a public rule. Organizing earns them. Voting never does." plus a home teaser. The three ladders disagree: right-wing-perks. |
| teen-path | **Held** | join.html "14 to 17? Here's how it works." (random code, no texts, guardian OK, pre-register at 16, F.S. 97.041(1)(b)). vote.html "Under 18?" chip and "14 to 17? Here's your version." events.html filter "Good for under-18s". |
| identity-crews | **Held**, residual | about.html "Crews by who you are": Student crew, Latine and Boricua, LGBTQ+, young parents, shift workers, disability, faith. The young-men gap remains: right-wing-young-men. |
| crew-map | **Held** | A stylised SVG map with 8 city pins, the states "Forming (DEMO)" and "Needs a host", and the note "Stylized map, not to scale. Pins sit at public parks and stations." |
| real-proof | **Held**, too deep | "This chapter is real." with three linked sources, but at 5,522 px of 8,415: right-wing-real-depth. |
| bench-artifacts | **Held** | See the metrics notes. New tap artifact: right-wing-bench-taps. |
| repeat-event | **Held** | The Sunset walk appears once on home (the hero ticket). The invites start with Seminole Sunday. |
| sticker-art | **Held** | join.html's sticker pack shows 18 distinct county pieces (`RW2/crops/join-390-light-00.png`). |
| npa-depth | **Held** | "No party?" is the first hero chip on vote.html, and the block sits at about 1,850 px (screen 3). |
| sunrail-saturday | **Held** | The `@demo.jordan` chip reads "SunRail social drops Dec 15", and the caption says "Trains run weekdays only, so we made it a weeknight". |

---

## The ten "must match" items (report 07 §5): verdicts with evidence

| # | Item (their best) | Verdict | Evidence |
|---|---|---|---|
| 1 | One unmistakable action per screen (donaldjtrump.com; AmericaFest; CRNC Join / Start a chapter) | **Beat** (except join.html) | qa B6 first screens: home "Join free" + "See what's on"; events "See what's on" + "Host a night"; vote "Check My Voter Record" + "Make my plan"; quiz "Find my type" + "Find my issue"; host "Pitch your night" + "See the 3-week plan"; about "Join free" + "Find your crew". There are no overlays. TPUSA's only first-screen ask is Donate, under a 40% banner (`BENCH/right-tpusa-mobile.png`). **Loss:** join.html's own form is below the first screen on phones and laptops (right-wing-join-fold). |
| 2 | Proof at scale (TPUSA 3,500+ / 1,500+ / 12,000+; CRA dot-map; CRNC "since 1892") | **Tie** (beat on honesty, small on scale) | "This chapter is real." (FYD chapter list, dues page, the musical-theatre night on ActBlue, "All three checked Tue, Nov 10, 2026") plus "The real scoreboard: no demo numbers in this one", every number linked. Every count says DEMO. But the real strip sits at 5,522 px (screen 7) and there's no chapter-scale number. That can only come from the chapter, and inventing one would break §0.3. |
| 3 | Chapter-in-a-box (start-a-chapter form, kits, 90+ field reps, chapter map, summit) | **Match**, close to beat | `host.html` is more useful and safer than TPUSA's kits: house rules ("A public place... Never someone's home", "Two adults on site whenever anyone under 18 comes"), a dated 3-week plan, a checklist, a card maker, invite texts and "A crew guide replies within 3 days (DEMO promise)". It loses on capture (the pitch is a bare join form), on home presence (no "start a crew" on home) and on the crew join/start mix-up. |
| 4 | Rewarded activism (Patriot Rewards: points, merch, VIP) | **Tie** | The public rules before joining beat Patriot Rewards' discretionary payouts ("Voting steps never earn stickers or anything else"). But home, host and join each show a different perk ladder (right-wing-perks). |
| 5 | Tentpole events with real urgency (AmericaFest Dec 17-20; PragerU gala) | **Match** | The Seminole Sunday band on events.html and home has a lock-up, date ticket, "38 of 60 seats saved (DEMO)", "33 days to go" and the next two dates. The drop has "35 days to go" and "Notify me". But the tentpole's own invite page is generic, the drop and tentpole contradict each other on January, and the December edition's snacks copy needs a guard. |
| 6 | Shows, not posts (Prove Me Wrong, Culture Apothecary, PragerU shelves) | **Match** | Five named formats with cadence and clip counts in the 1440 rail, a series chip on every clip, and EN/ES WebVTT caption chips. On phones the formats sit behind an icon. Each format has 1 or 2 DEMO clips. |
| 7 | Participation formats (Pick Up the Mic; story and creator applications) | **Beat** | "Open Mic: 3 Minutes, Your Take · One Saturday afternoon a month (DEMO) · 3 dates" with "No experience needed, no heckling, and the mic is for neighbors, not politicians", Post a clip with consents and moderation, and Creator night. It's the kind answer to a debate stage. |
| 8 | Quiz-style capture (TPUSA merch modal "Tell us what drives you"; Trump Store) | **Beat** | Inline, no modal, "We don't save your answers. If you share, only your result goes with it." 6 types and 9 issue identities with characters. The result pages' series links now fall back to a drop teaser plus open events. |
| 9 | Merch as identity (Never Surrender sneakers, CRNC merch ticker, TPUSA store) | **Tie** | Drop 01, "Can't buy it. Earn it.", has an honest edition size ("Edition of 100 each, tees XS to 4XL... All DEMO, pending the chapter's lawyer") and "Nothing is ever given for registering, renewing or voting." But it's a 104-px art strip at 3,506 px on home only, with no mockup and no back print. CRNC opens with SHOP NEW MERCH (`BENCH/right-crnc-mobile.png`). |
| 10 | Belonging-first copy and sub-brands (YAF "There's a place for you here"; Club America; RPOF coalitions; YR job board) | **Beat**, one gap | 7 identity crews plus city crews on a map; a teen path on join, vote and events; "Come as you are. Bring a friend."; "first time? perfect"; "Events are free and open to everyone, in any party or none." The gap: nothing for the sport, gaming and fitness audience the right courts (right-wing-young-men). |

**Report 07 §6 (their weaknesses):** we beat all ten. Weight, walls, accessibility, Spanish, donor-first framing,
trackers, freshness ("Links checked Nov 9, 2026", post-election debrief) and community safety (house rules, code of
conduct, report on clips, "No doxxing, and no lists of private people") are all measured above. Platform mismatch
stays neutral by design: the social links wait for the chapter's confirmation.

### Where a young independent finds us more credible

- **vote.html's "No party? Here's what you can vote in."** at screen 3: "You vote in · Every race in every general
  election · Nonpartisan races... You sit out · Party primaries, including the presidential primary on Mar 21, 2028",
  then "We're the Young Democrats, so yes, we'd love to see you in the Democratic primary. Either way, you're welcome
  at everything we do." Seminole GOP's top voter content is a party slate (`BENCH/right-seminolegop-mobile.png`).
  No right-wing site addresses NPA voters at all.
- **"Real events from the county party · The Seminole County Democrats run these, not us. RSVP on their page."**
  This separation, plus the not-official footer, reads as integrity. The YR chat scandal and the disbanded UF
  College Republicans chapter (report 07 §4.2, §4.3) have made that scarce on the right.
- **"Nov 3, debriefed."** gives unofficial-until-certified numbers with three sources and "If you're tired, that's fair."
  TP Action was still running pre-election promos six days later (report 07 §4.1).
- **What breaks credibility today:** the Innisfil / No Soliciting clip, three perk ladders, a "locked" January that
  already has an open event with 34 going, and snacks pitched next to a mail-ballot renewal (findings below).

### Where they'd find us more fun

- The quiz cast ("The Spreadsheet Witch: Give me chaos. I'll give you a tracker."), the Real-or-DEMO game, the host
  kit's flyer and name-tag maker, Open Mic, Seminole Sunday and the sticker book. It's kind fun, not *Prove Me
  Wrong* dunk content.
- **Weak spots:** nothing to wear that you'd actually want yet, and no pickup game, controller night or run club.
  That's where the right's young-male audience lives (Nelk, Hodgetwins; report 07 §4.9).

---

## Per-page scores (0 to 100; 90 or more would beat the best right-wing benchmark for that page type)

| Page | Round 1 | Round 2 | Best right-wing comparator | One line |
|---|--:|--:|---|---|
| index.html | 82 | **88** | TPUSA home; CRNC; donaldjtrump.com | The fastest, clearest first screen in the set at every width, with a real strip, tentpole and merch; no "start a crew" moment, merch is small, real proof is deep. |
| events.html | 76 | **87** | AmericaFest; TPUSA events | A tentpole band, named series, an honest drop, real county events and a host band; the January lock contradicts the open Jan 24, and 11 of 13 series say "1 date". |
| events/renew-ready-party.html (tentpole) | 84* | **80** | AmericaFest | Date, place and RSVP on the first screen at a fraction of the weight; no Seminole Sunday poster, seat bar or countdown, and snacks copy next to the civic step. (*round 1 scored the trivia page) |
| host.html | n/a | **87** | TPUSA Students start-a-chapter; Club America kit | More useful and safer than TPUSA's kits; the pitch drops the night's details, and its perks contradict home and join. |
| vote.html | 88 | **92** | Seminole GOP voter guide; RPOF voter guide | The most credible voting page in the set: NPA at screen 3, an under-18 block, sourced dates; small layout voids. |
| join.html | 82 | **82** | RPOF join form; Club America | Public rules, teen block and an honest perk list before joining; the form starts below the first screen on phones and laptops, and the crew intent is mislabelled. |
| quiz.html | 86 | **91** | TPUSA merch quiz modal | Beats the quiz capture outright: inline, nothing stored, characters and identities. |
| quiz/show-up/*, quiz/issue/* | 74 | **85** | n/a | The dead ends are gone (drop teaser plus open events); not re-reviewed beyond the links. |
| clips.html | 77 | **83** | TPUSA shows; PragerU | Named formats, EN/ES captions, safety promises; the canvass clip's Innisfil / No Soliciting signs and the USPS mark are own goals, and the formats are hidden on phones. |
| about.html | 72 | **87** | CRA chapter map; YAF; Club America | Map, identity crews, the Real-or-DEMO game and an honest real card; "Join this crew" means start, and there's still no human contact. |
| es/index.html | 82 | **87** | (no right-wing site has Spanish) | Full parity (0 untranslated); inherits home's gaps. |

---

## Findings

Ordered by severity. Each finding names the files a fixer edits. Regenerate `es/` twins with
`node tools/make_es.js`, event pages with `tools/make_event_pages.js`, and quiz pages with
`tools/make_quiz_pages.js` after EN or data edits. Known open items and chapter or counsel decisions (committee
wording, real photos, native-speaker sign-off, policy and perk-ladder counsel review, cross-device squad meter,
Lighthouse LCP noise) are not re-filed.

### Major

**right-wing-join-fold · join.html: the join form starts below the first screen on phones and laptops**
- Evidence (`RW2/scripts/probe5.js`):
  - Submit button top at 1,180 px at 390x844 (es 1,201) and 1,218 at 360x740 (es 1,282).
  - The first field label sits at about 785 px. At 390x664 no field is visible (`RW2/crops/join-390-light-00.png`).
  - Laptops: submit top at 861 px at 1366x768 and 857 at 1280x720, both below the fold; at 1440x900 it spans 865 to
    921 px, so it's cut off (`RW2/crops/join-1440-top.png`).
  - The first screen's only on-page button is the secondary "See what you get". The primary is the header pill.
- Benchmark: RPOF's first phone screen is a four-field join form (`BENCH/right-rpof-mobile.png`); donaldjtrump.com's
  "Join us" goes straight to a form. Our dedicated join page is slower to the first field than RPOF's home page.
- Fix:
  - On phones, put the member-card form directly under the H1 and "We saved you a seat."
  - Move the three check chips and "See what you get" below the form, and shrink or overlap the character row.
  - Targets: first input top at or above 480 px and submit bottom at or above 844 px at 390x844; submit fully visible
    at 1366x768 (less hero padding; move the "15 stickers to collect" card under the form on desktop).
  - Add a join check to qa B6 (first field visible at 390x664).
- Files: `join.html`, `assets/css/pages/join.css`, `data/pages/join.js`, `tools/qa.js`, `es/join.html` (via make_es).

**right-wing-perks · index.html, host.html, join.html: three different perk ladders**
- Evidence:
  - Home Drop 01: "The Young Dems tee · Bring 3 friends: three join with your link. The celery tote · Finish one
    volunteer shift. The county sticker sheet · Host a night." (`data/pages/home.js:150-155`)
  - host.html "Merch goes to organizers": "Shift Done · Host a night and you unlock the Shift Done sticker and the
    celery tote... Squad of Three · ...the Young Dems tee... First pick · Hosts get first pick of seats at the next
    Seminole Sunday" (`data/pages/host.js:151-156`).
  - join.html "Perks for organizing (DEMO)": First Night → "A welcome sticker at your first event"; Squad of Three →
    tee; Shift Done → tote; The Long Game → "First pick of seats at the next big night" (`data/levels.js:356, 432,
    463, 539`).
  - So hosting earns a sticker sheet (home) or a tote plus first pick (host), while first pick belongs to The Long
    Game (join). The "county sticker sheet" perk doesn't exist in `levels.js` at all.
- Benchmark: Patriot Rewards is discretionary, paid out "at the discretion of field reps" (report 07 §4.1). Our whole
  edge is public, fixed criteria. Three versions of the rules is the opacity we claim to beat, and a skeptical
  member will screenshot it.
- Fix:
  - Make `data/levels.js` the single source, and render home's Drop 01 and host's perks from it (perk plus rule), not
    from page strings.
  - Pick one mapping. Suggestion: hosting counts as Shift Done (tote); Squad of Three (tee); a hosting-specific
    sticker for the sticker sheet; The Long Game (first pick).
  - Keep "pending counsel" in every place it appears.
- Files: `data/levels.js`, `data/pages/home.js`, `data/pages/host.js`, `index.html`, `host.html`,
  `assets/js/pages/home.js`, `assets/js/pages/host.js`, `assets/js/membercard.js` (rulesPanel), es twins.

**right-wing-pitch · host.html: "Pitch your night" is a bare join form that drops the pitch**
- Evidence:
  - Both buttons are `href="join.html?intent=host"` (`host.html:107`, `:297`).
  - The same page's card maker already collects the night's name, date, time, city and public place, but none of
    it travels with the pitch.
  - join.html then says: "Hosting starts here. I want to host a night. Join first. We'll reply within 3 days with the
    host kit and a date that works (DEMO promise)." It promises the kit the visitor has just read.
  - A member who already joined is routed through the join form again.
- Benchmark: TPUSA Students' start-a-chapter page puts a chapter form right under the hero
  (`BENCH/right-tpusa-startachapter-mobile.png`), and CRNC splits Join from Start (`BENCH/right-crnc-mobile.png`).
  Report 07 §5.3 and round 1 asked for a three-question pitch.
- Fix:
  - Add "Send this pitch" under "Draw my cards". It carries night, date, city and place (as URL params, or a
    `host:pitch` key in `YSD.store`) into join's intent box, shows them as a summary, and stores them in the payload.
  - For members, skip join: show "Pitch sent (DEMO). A crew guide replies within 3 days."
  - Change the intent copy to "We'll reply within 3 days to lock a date and a place."
- Files: `host.html`, `assets/js/pages/host.js`, `data/pages/host.js`, `assets/js/joinform.js`, `data/pages/join.js`,
  es twins.

**right-wing-join-crew · about.html → join.html: "Join this crew" signs people up to start it**
- Evidence:
  - The forming Celery City Crew card says "A DEMO host is planning the first hangout." Its button "Join this crew"
    (`href="join.html?intent=crew&crew=sanford"`) lands on "Join free. Let's get Celery City Crew going.", with a
    pre-ticked "I want to start Celery City Crew (DEMO)" and "We'll help you plan the first hangout"
    (`RW2/scripts/probe7.js`).
  - The same happens with The Chicken Crossing (Oviedo). Only "Start this crew" should produce this copy.
- Benchmark: CRNC's first screen has two distinct buttons, "Join a chapter" and "Start a chapter"
  (`BENCH/right-crnc-mobile.png`).
- Fix:
  - Add a join-crew intent for forming crews (for example `intent=crew&crew=sanford&as=member`).
  - joinform shows "You're on the list for Celery City Crew (DEMO). The host sends the first hangout."
  - Only `Start this crew` uses the start copy.
- Files: `about.html`, `assets/js/pages/about.js`, `data/pages/about.js`, `assets/js/joinform.js`,
  `data/pages/join.js`, `es/about.html`, `es/join.html`.

**right-wing-home-crew · index.html: home never offers "start a crew" or "find your crew"**
- Evidence:
  - home's only links to `host.html` are inline in Drop 01's fine print ("The county sticker sheet · Host a night." at
    3,624 px) and in the footer.
  - There is no link to the crews or map at all: "a crew from Sanford to Oviedo" in the hero sub is plain text.
  - The header nav is Events, Vote, Reel, Quiz, Issues, About.
- Benchmark:
  - CRNC's first screen is "Join a chapter / Start a chapter".
  - TPUSA home repeats "Join a chapter" under its proof numbers (report 07 §4.1).
  - TPUSA Students' menu exposes start a chapter, kits and rewards.
  - BRIEF §6b says the host kit is "linked from about, events, home and the footer".
- Fix:
  - Add a home moment between the tentpole and Drop 01: "Find your crew or start one", with a mini crew map (or three
    crew chips: the nearest forming crew, an identity crew, "Start one") and two buttons, "Find your crew"
    (about.html#crews) and "Host a night" (host.html).
  - Link the hero sub's "crew" to `about.html#crews`.
  - Lead decision: consider "Crews" or "Host" in the desktop header (`partials/header.html`).
- Files: `index.html`, `data/pages/home.js`, `assets/css/pages/home.css`, `assets/js/pages/home.js`,
  `data/slices/home.js`, `partials/header.html` (lead), `es/index.html`.

**right-wing-tentpole-page · events/renew-ready-party.html, events/seminole-sunday-oviedo.html: the tentpole's invite page looks like every other event page**
- Evidence:
  - Shared invites land here (§0.7). The first screen (`RW2/crops/events__renew-ready-party-top.png`) is the standard
    small dark ticket ("DEC 13 · 2 pm · RENEW-READY"), the title, the RSVP and "38 going (DEMO)".
  - The tentpole assets from events and home (the SEMINOLE SUNDAY lock-up, "38 of 60 seats saved", "33 days to go",
    the next two dates) are missing. The only tentpole marker is a small "Seminole Sunday · The monthly big one" chip
    at about 800 px.
  - Desktop (`RW2/crops/events__renew-ready-party-1440.png`) has a "RENEW-READY" poster but no Seminole Sunday brand.
  - On events.html, "Find your night" lists 13 series but not Seminole Sunday. Its card is "Renew-Ready Party · 1 date".
- Benchmark: AmericaFest's event page is the poster: the neon lock-up, "December 17-20, 2026 · Phoenix Convention
  Center" and REGISTER NOW, all on the first screen (`BENCH/right-tpusa-amfest-mobile.png`).
- Fix:
  - In `make_event_pages.js`, when `tentpole: true`, render the Seminole Sunday lock-up as the hero art (reuse the
    events band component), put the seat bar and countdown beside the RSVP, and add a "next Sundays" strip.
  - Add Seminole Sunday as the first card in Find your night, with its 3 dates.
- Files: `tools/make_event_pages.js`, `assets/js/pages/event.js`, `assets/css/pages/events.css`, `assets/css/rsvp.css`,
  `assets/js/pages/events.js`, `data/events.js`, `data/pages/events.js`, `events/*.html` and `es/events/*.html` (regen).

**right-wing-renew-snacks · events.html, events/renew-ready-party.html, share text, .ics: snacks pitched as part of a mail-ballot renewal (ruling 00, counsel call)**
- Evidence:
  - events.html series card: "Renew-Ready Party · Snacks, music and help asking for your mail ballot again, yourself,
    on the official site."
  - Share text: "...That request ends Dec 31. Snacks, music, and we get ready together. Come? {url}"
  - .ics description: "Renew your Florida mail-ballot request (...). Snacks and music. Free."
  - All three are in `data/events.js` (the renew-ready series near line 350 and event lines 950 to 1025).
  - The host perk "Hosts get first pick of seats at the next Seminole Sunday" attaches seat priority to the same
    event, which also shows "38 of 60 seats saved".
  - Ruling 00: "No prizes, merch or anything of value for registering, renewing or voting (52 U.S.C. 10307(c);
    Florida's vote-buying law)." Refreshments offered to everyone aren't payment. But copy that sells snacks
    as part of the renewal pitch reads as an inducement, and the federal definition of "vote" covers action
    "prerequisite to voting" (52 U.S.C. 10310(c)(1)). Confidence: medium; this is a counsel call, not a ruling.
  - The site's own careful line ("You do everything yourself on the official site. We never take forms or personal
    information.") shows the team knows the risk area.
- Benchmark: report 07 §6.9 and §8. Our edge over the right is that we don't create screenshots like this.
- Fix:
  - Lead with the help: "Bring your phone; we'll help you renew yourself on the official site."
  - Put food in its own sentence with a guard: "Snacks are for everyone who stops by, renewing or not. Nothing is
    handed out for renewing."
  - Drop "Snacks" from the share text and the .ics; keep "Free".
  - Don't put a seat bar or seat-priority perk on a civic-help event ("Everyone gets help, no RSVP needed"), or make
    a different Seminole Sunday the "first pick" example.
  - Add this to counsel's perk-ladder review.
- Files: `data/events.js`, `data/pages/events.js`, `data/pages/host.js` (`perks.3.d`), `data/pages/home.js`,
  `tools/make_event_pages.js` (regen), es twins.

**right-wing-merch · index.html (and join, host, events): Drop 01 is clip-art in a box, on one page**
- Evidence:
  - Drop 01 is a card inside the "Next drop" box at 3,506 px on home. The product art is a 104-px-wide strip of three
    small drawings (`RW2/crops/home-drop.png`).
  - There is no mockup, no name for the design, and no visual of "our line on the back in English and Spanish",
    which the copy promises. There's no designer card and no edition counter.
  - It's absent from events.html, join.html (where the perk ladder lives, as text) and host.html (text).
  - "Notify me" is shared with the lineup reminder.
- Benchmark: CRNC opens with a SHOP NEW MERCH ticker (`BENCH/right-crnc-mobile.png`); TPUSA's merch store
  (`BENCH/right-tpusa-merch-mobile.png`); the sold-out Never Surrender drop (report 07 §4.6). Kira's bar is "as
  desirable as the hottest Gen Z brands", and nobody wants a 104-px tee.
- Fix:
  - Give Drop 01 its own full-bleed band, in its own colour world.
  - Show a big front and back tee mockup with the bilingual line legible ("Local politics is a group project" /
    "La política local es un trabajo en equipo"), with the tote and sticker sheet as product tiles.
  - Add "Edition of 100 · DEMO", a "Designed by a member (DEMO)" card with a sketch, the earn rules as chips from
    `levels.js`, and its own Notify me .ics ("Drop 01 · Tue, Dec 15 at noon").
  - Reuse the same art as thumbnails in join's perk ladder and host's perks, and add an "I'm earning the tee" share
    card.
  - Mind the home budget (right-wing-budget).
- Files: `index.html`, `data/pages/home.js`, `assets/css/pages/home.css`, `assets/js/pages/home.js`, new
  `assets/img/merch/*.svg`, `join.html`, `data/pages/join.js`, `assets/css/pages/join.css`, `host.html`,
  `data/pages/host.js`, `assets/css/pages/host.css`, `assets/js/cards-brand.js`.

**right-wing-young-men · events, crews: nothing for the sport, gaming and fitness audience the right courts**
- Evidence:
  - The 13 named series: trivia, sunset walk, text bank, creator night, open mic, renew party, the Spanish workshop,
    welcome mixer, SunRail social, canvass, "Love & Protest Karaoke" and the picnic club, plus Seminole Sunday.
  - The crews: 8 city crews plus students, Latine and Boricua, LGBTQ+, young parents, shift workers, disability and
    faith.
  - Nothing involves a ball, a controller, a run or a game on a screen.
- Benchmark: report 07 §1. In 2024, young men backed Trump 56 to 42 after the Nelk / Full Send podcast playbook
  ("Send the Vote" targeted 1.1 million inactive men aged 18 to 34). Hodgetwins' proof-plus-giveaways loop is aimed at
  the same audience (`BENCH/right-hodgetwins-mobile.png`). In 2026, young men swung to 59 to 37 Democratic (CIRCLE,
  via report 07), so this audience is in play, and our lineup gives them no door.
- Fix: add two or three DEMO series, all at public venues, alcohol-free and 14 and up. Don't gender-label them; let
  the format do the work.
  - "Pickup Sunday": pickup basketball or soccer at a public county court.
  - "Controller Club": a Mario Kart or Smash bracket in a library meeting room.
  - "Riverwalk Run Club": a Saturday 5K on the Sanford Riverwalk.
  - Add a matching "Run and ball crew" or "Gamers crew".
  - Map the Hype Captain and Plus-One quiz results to them.
- Files: `data/events.js`, `tools/make_event_pages.js`, `tools/make_og.js`, `data/pages/about.js`, `about.html`,
  `data/pages/join.js`, `data/quiz.js`, `tools/make_quiz_pages.js`.

**right-wing-reel-own-goals · clips.html, home Reel, events: stock frames that contradict their captions and our photo rule**
- Evidence:
  - (a) `@demo.luis` "Things I didn't expect at my first canvass", caption "Sunset canvass by Lake Monroe. Knocked
    doors, met neighbors, stayed for the sky." The poster shows a legible municipal sign, "Innisfil · Launch Dock ·
    15 minute docking only... 705-436-3710 · innisfil.ca" (Innisfil, Ontario), and a red **"NOTICE · NO SOLICITING"**
    sign, on a canvassing clip (`assets/video/lake-monroe-canvass.jpg`, `RW2/crops/canvass-sign.png`).
  - `data/clips.js:609` itself says "Stand-in, not Lake Monroe", but the caption claims Lake Monroe. The same photo is
    the Sunset walk event cover (`data/events.js:492`).
  - (b) The `@demo.maria` mail-ballot PSA uses Unsplash 1595265616362 (`data/clips.js:226`,
    `assets/video/make_demo_clips.py:69`): election envelopes with the USPS "Official Election Mail" logo and
    "Business Reply Mail" (`RW2/crops/clips-390-light-00.png`, `-01.png`).
  - It's the exact photo the events team removed because it "shows the USPS Official Election Mail mark, a logo with a
    stylized flag (BRIEF 3.6)" (`data/events.js:1007`).
- Benchmark: report 07 §6.7. The right's sloppy details ("Insert/edit link" as an H1, "Home New") are a weakness we
  exploit. A Canadian town sign and "NO SOLICITING" on our canvass clip is the same kind of screenshot, pointed at us.
- Fix:
  - Re-crop the canvass scenes to exclude both signs (or swap the photo), and drop "by Lake Monroe" from the caption
    unless the frame is Lake Monroe. Re-crop the sunset cover the same way.
  - Replace the envelope scene with the existing calendar-31 art or an unbranded envelope, then re-render.
- Files: `assets/video/make_demo_clips.py`, `assets/video/render_clips.js`, `assets/video/lake-monroe-canvass.{mp4,jpg}`,
  `assets/video/mail-ballot-renew.{mp4,jpg}`, `data/clips.js`, `data/events.js`, `CREDITS.md` (via `tools/credits.py`).

### Minor

**right-wing-drop-contradiction · events.html, home, events/seminole-sunday-oviedo.html: a "locked" January that's already open**
- Evidence:
  - events.html says "10 more nights, locked · January's lineup drops Tue, Dec 15 at noon (DEMO)" and "10 events
    (DEMO), locked until the drop".
  - But the tentpole card directly above lists "Sun, Jan 24 · Oviedo, Sun, Feb 21 · Longwood".
  - The Jan 24 page is open with RSVP: "34 going (DEMO)... Part of January's lineup, which drops Tue, Dec 15 at noon
    (DEMO). You can save a seat now."
  - The SunRail teaser also shows "JAN 21 · 5:30 pm".
- Benchmark: PragerU's "Deadline extended. Last chance to register!" (`BENCH/right-prageru-mobile.png`). Report 07 §8:
  "Use honest urgency only."
- Fix: say it outright ("Seminole Sundays are announced early; everything else drops Dec 15") and count 9 locked, or
  hide Jan 24 until the drop.
- Files: `data/events.js`, `data/pages/events.js`, `assets/js/pages/events.js`, `assets/js/pages/home.js`,
  `tools/make_event_pages.js`.

**right-wing-series-one-date · events.html "Find your night": 11 of 13 series say "1 date"**
- Evidence: "Every night here has a name, so you can find the one that feels like yours and come back to it." Then
  11 cards read "1 date" and 7 read "Next one drops Dec 15 (DEMO)". The badge advertises one-offs.
- Fix: hide the count when it's 1 and show a cadence instead ("Monthly (DEMO)"); give every series a `recurs`
  label; lead with the recurring series.
- Files: `assets/js/pages/events.js`, `data/events.js`, `data/pages/events.js`.

**right-wing-formats-phone · clips.html, home Reel: the named shows are hidden on phones**
- Evidence: at 390 the five formats sit behind the "Formats and filters" icon button. The first screen is one clip
  with a small series chip (`RW2/crops/clips-390-light-00.png`). At 1440 they're a rail with cadence lines
  (`RW2/crops/clips-1440-top.png`). The home Reel strip has no formats row.
- Benchmark: TPUSA's shows shelf and PragerU's catalog shelves are visible modules (`BENCH/right-prageru-mobile.png`).
- Fix: on phones, add a horizontal chip row under "The Reel" ("Seminole in 60 · Thursdays", "First Time? ·
  Tuesdays"...), and a one-line formats row above the home Reel strip.
- Files: `clips.html`, `assets/js/pages/clips.js`, `assets/css/pages/clips.css`, `index.html`,
  `assets/js/pages/home.js`.

**right-wing-real-depth · index.html: the "This chapter is real" strip sits at screen 7**
- Evidence: the real strip is at 5,522 px of 8,415 at 390 (`RW2/scripts/probe8.js`), after the Reel, tentpole, drop,
  card maker and quiz. A skeptical visitor meets 20+ DEMO labels first.
- Benchmark: CRNC's belonging and proof line, "The best party on campus since 1892", is its hero
  (`BENCH/right-crnc-mobile.png`).
- Fix: add one REAL line to the hero sub, linked ("A real chapter of the Florida Young Democrats ✓"), or move the
  strip directly under the "Do one thing" row.
- Files: `index.html`, `data/pages/home.js`, `assets/css/pages/home.css`, `es/index.html`.

**right-wing-invite-texts · host.html: template grammar in EN and ES, and UTM tags in person-to-person texts**
- Evidence:
  - EN: "I'm hosting Study night on Thu, Nov 19 at 7 pm, A library meeting room in Oviedo."
  - ES: "Voy a organizar Noche de estudio el jue 19 de nov a las 7 p. m., Una sala de la biblioteca en Oviedo." and
    "Gracias por venir a Noche de estudio." That's a capital letter mid-sentence, a missing article and "jue" without
    its period.
  - Every text ends in a 100-character link carrying `?utm_source=share&utm_medium=social&utm_campaign=youngsemdems`
    (`assets/js/config.js:295`). Marketing tags inside a text to a friend, from the site that sells "no trackers".
- Fix: lowercase the sample place and join it with "at" / "en"; give the night's name an article or quotes in ES
  ("Voy a organizar una «Noche de estudio»"); drop utm_medium and utm_campaign from person-to-person texts (`ref`
  already attributes).
- Files: `data/pages/host.js`, `assets/js/pages/host.js`, `assets/js/config.js`, `es/host.html`.

**right-wing-bench-taps · tools/bench_compare.js: vote.html reads 26/197 small taps; it's a measurement artifact**
- Evidence (`RW2/scripts/probe3.js`): the "small" targets are 8 "Done" checkboxes (24x24 inside 71x44 labels), 8
  visually hidden plan radios (opacity 0, inside 44-px chip labels) and inline source links. qa B31 reports "targets
  44+". In the table Kira shows, vote sits beside TPUSA's 27/50, and round 1 read 0/254.
- Fix: measure an input by its label's box when the label wraps it or points at it, skip `opacity:0` inputs whose
  label is at least 44 px, and exempt links in source lines. Add a fixture.
- Files: `tools/bench_compare.js`, `tests/site/w8.test.js`.

**right-wing-budget · index.html, clips.html: little headroom left under the B1 gate**
- Evidence: home's first view is 296.7 KB of 350 in qa (round 1: 251.3) and 342 KB in the gzip bench (98%). Clips:
  445.6 KB of 500, with 30 of 30 requests. Report 07 §7: home at most 350 KB and 30 requests. The fixes above
  (crew moment, merch band) would break the gate.
- Fix: before adding them, lazy-load below-fold modules' JS and art (maker, rulesPanel, merch art) on intersection,
  use an SVG sprite for the stickers, and defer or merge one script on clips to get under 30 requests.
- Files: `index.html`, `assets/js/pages/home.js`, `data/slices/home.js`, `clips.html`, `assets/js/pages/clips.js`.

**right-wing-wins-invisible · site-wide: the things we beat the right on are never said**
- Evidence: no page says "No ad trackers. No pop-ups. Every page in Spanish. A person checks every clip." join says
  only "We never sell your info." The right loads 8 to 10 ad tags, shows 17 to 40% cookie banners, and 0 of 23 pages
  offer Spanish (report 07 §2). Round 1 raised this as a note; it's still absent.
- Fix: add one promise line to the footer and one under join's privacy line, EN and ES.
- Files: `partials/footer.html`, `data/strings.js`, `join.html`, `data/pages/join.js` (then `tools/sync_partials.py`).

**right-wing-about-human · about.html: no human, though host.html promises one**
- Evidence: about.html says "Want to talk to a real person? Until the chapter picks a public contact, the join form is
  the way in." host.html says "A crew guide replies within 3 days (DEMO promise)." Club America advertises "90+
  full-time Field Representatives"; report 07 §5.3 asks for "a named human who replies within 48 hours".
- Fix: use the same DEMO role on about ("A crew guide (DEMO) answers within 3 days"), with an action to
  `join.html?intent=role` or a contact intent. Keep the chapter-decision note.
- Files: `data/pages/about.js`, `about.html`, `assets/js/pages/about.js`.

**right-wing-prompt-full · clips.html: the weekly prompt's help points to a full event**
- Evidence: the prompt sheet says "Want a hand filming it? Creator night: film your 60 seconds, Thu, Dec 3 · 6:30 pm in
  Altamonte Springs (DEMO event)". events.html shows that event as "FULL (DEMO) · Join the waitlist".
- Fix: when the helper event is full, say so and offer the waitlist or the next open create event (Open mic, Sat,
  Dec 5).
- Files: `assets/js/pages/clips.js`, `data/pages/clips.js`.

**right-wing-vote-voids · vote.html: empty space in two carousels at 390**
- Evidence (`RW2/crops/vote-390-light-01.png`, `-02.png`): the "14 to 17" card row leaves about 180 px empty under
  "Pre-register" before "Join free", and the first key-dates card ("DEC 31... Source: Fla. Stat. 101.62") has about
  270 px of blank card below its content. Both read as broken next to the polish elsewhere.
- Fix: let the scroller cards size to their own content (`align-items: start`), or equalise by trimming the tallest
  card.
- Files: `assets/css/pages/vote.css`.

---

## Notes for Kira (not findings)

- **Proof at scale stays a tie until the chapter gives us numbers.** TPUSA's "3,500+" and CRNC's "since 1892" beat us
  on size. We can't invent a member count or a founding year (§0.3). Two or three real numbers from the chapter
  (founding year, members, nights held in 2026), each with a source, would turn item 2 into a clear win.
- **Reproductive freedom** is the only issue tile without a character or identity name. `data/quiz.js:62` says this
  was deliberate. It reads as a gap on the grid (`RW2/crops/quiz-390-light-01.png`), so a deliberate design
  treatment, rather than an empty tile, would read as a choice.
- Everything else the round 1 report asked for is on the page. The remaining work is mostly consistency and
  desire, not missing mechanics.
