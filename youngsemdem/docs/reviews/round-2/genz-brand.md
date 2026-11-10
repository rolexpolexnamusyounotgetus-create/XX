# Round 2 review: Gen Z brand desirability

Lens: would a 19-year-old in Oviedo screenshot this page and send it to the group chat? Reviewer pass on the
fixed site (101 pages), dated Monday, November 9, 2026 per the brief (run Tue, Nov 10). Checked against
docs/BRIEF.md (§0, §5, §6b), ruling 00, voice report 05, and report 08 with its benchmark captures. I am a
reviewer only: I edited no site file and committed nothing.

## Method

- `node tools/shoot.js` on 16 pages (home, events, events/seminole-sunday-oviedo, events/trivia-county-edition,
  vote, issues, clips, post, quiz, quiz/show-up/hype-captain, quiz/issue/rent, join, newsletter, about, 404,
  host). Each page at 390 x 844 and 1440 x 900, light and dark: 64 of 64 shots, 0 console errors, `_headers`
  (CSP) applied. Pages were cut into phone-screen strips for reading.
- I ran Playwright flows at 390 over `python3 -m http.server`:
  - the full show-up quiz and the issue quiz, with frames at 150 ms and after the sticker reveal
  - the static result page with `?from=Kira`
  - RSVP sheet to success to "Share my I'm-going card" on two invite pages
  - join to member card
  - the 404 sticker toy
  - post with a real video file picked
  - vote "Send these 2 dates"
  - Spanish first screens (es/index, es/clips, es result page, es Seminole Sunday)
- DOM measurements at 390:
  - page height and section breakdown
  - first-screen words below the header
  - photo area in the first screen and unique photo IDs
  - character images and DEMO mentions
  - hard-offset-shadow boxes, rounded bordered boxes and full-bleed media
  - overlay counts on Reel cards
- Sampled a pixel column on all 16 dark shots, looking for light panels.
- Extracted 1 fps frame strips from 5 of the 8 demo clips with ffmpeg.
- Ran `node tools/qa.js --pages index.html,clips.html,quiz.html`: 16/16 gates on all three. Ran
  `node tools/voice_lint.js`: 132 files, 0 errors. Nothing in this report contradicts a gate.
- Built side-by-side composites with the bench captures: Rhode, Rare Beauty, Starface, Partiful, Poppi, Owala,
  Skims, Gymshark, Topicals, Tower 28, Spotify Wrapped, e.l.f., Duolingo, Apple, Liquid Death, Glossier,
  Summer Fridays, A24 and Alo.
- I did not run `bench_compare.js` for this lens. Weight and speed belong to the other lenses, and round 1's
  numbers still stand.

Evidence lives outside the repo, under
`/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/genz2/` (written `$G/` below):
- `$G/shots/`: full pages
- `$G/strips/`: phone screens; `-r<n>` is four 390 screens per image, `-s<n>` is two 1440 screens
- `$G/flows/`: interaction states
- `$G/frames/`: clip frame strips
- `$G/compare/`: side-by-sides
- `$G/pw/`: the scripts
- `$G/measure-390.json`: raw DOM numbers

## Summary

Round 1's fixes held, and they moved the site a long way. Every page now has its own colour world and its own
hero object. The quiz is close to best in class:
- question screens in rotating colours
- picture tiles
- an honest "Leaning:" chip
- a sticker reveal
- Wrapped-scale poster cards with characters and giant percentages
- identity results ("The Rent Realist", "La Chispa")

Other wins:
- **RSVP:** it now ends on a ticket with a "SEAT SAVED" stamp, and the toast lands above the sheet.
- **Vote:** the Dec 31 / Jan 1 tiles carry a "Send these 2 dates" sheet that renders a 9:16 card with the
  official wording. The page is half its old length.
- **Reel:** it opens on video, snaps, and has caption chips, named formats and an Up Next rail.
- **About:** it leads with the Real-or-DEMO game and a crew map.
- **Join:** it opens on the live member card with the character trio peeking over it.
- **Quality floor:** 0 console errors, 0 horizontal overflow on 16 pages, every QA gate passes.

What still holds it below "as desirable as Rare Beauty, Starface or Partiful":

1. **Everything is a bordered card with a hard shadow, and nothing is full-bleed.**
   - Home has 47 hard-shadow boxes and 57 rounded bordered boxes; events has 72 and 86; about has 63 and 86.
   - No measured page has a single edge-to-edge photo, video or poster.
   - The benchmarks that feel expensive (Rhode, Skims, A24, Partiful's hero photo) give one image the whole
     width. Poppi gives one colour and one object the whole screen.
   - The sticker-card motif is the brand, but at this density it reads as busy rather than iconic (r2-05).
2. **The long pages are still long.**
   - Issues is 13,915 px at 390 (16.5 screens), down 1% from round 1.
   - Events is 11,748 px, with 770 px cards.
   - Join is 8,188 px and shows the member card twice.
   - The best bits sit inside the length (r2-01, r2-02, r2-08).
3. **The peak moments hand you small artefacts.**
   - The "I'm going" card exists, but at the moment of RSVP it is an 85 x 140 px thumbnail (r2-04).
   - Locked stickers are grey at 55% opacity, so the collectible looks dead before you join (r2-07).
4. **The share loop stops one step short.** A friend who arrives on Kira's quiz link gets "Kira got The Hype
   Captain. Your turn". After they finish, nothing pairs their result with Kira's (r2-03). That duo moment
   (Spotify Blend, Wrapped Clubs) is the cheapest viral hook still missing, and it needs no backend.

No blocking findings from this lens: 9 major, 13 minor. Fixing r2-01 to r2-05 would put quiz, invite, vote and
404 above 85 and lift home, events and issues into the 80s.

## Round 1 findings: did the fixes hold?

| R1 id | Status | Evidence (round 2) |
|---|---|---|
| 01 colour worlds | Held | Each hero has its own fill and object: celery tickets, lake date tiles, bubblegum deck, sky member card, mint lock screen, teal game, orange laptop, tangerine box (`$G/compare/desk-1.png`, `desk-2.png`). The shared type skeleton remains (r2-14, minor). |
| 02 people deficit | Partly, as far as a demo can go | 16 character SVGs appear on quiz, 7 on results and 6 on about; there are characters on home and join. Photos: home has 1 unique photo, and vote, issues, quiz, join, newsletter, about and 404 have none. Real photos are the chapter's call (not re-filed). |
| 03 home first screen | Partly | "the fun kind" annotation, a 24 px bubble, and the sub moved below the CTAs. Still 108 first-screen words (148 in R1) and a from-behind photo at 25% of the screen (r2-09). |
| 04 home sampler | Held | 8 bands plus ticker and outro; the quick maker shows a 320+ px "Come with me." card. |
| 05 Reel opens without video | Held | The first clip starts at y = 175 px at 390, with full-height snap on touch. |
| 06 demo clips | Partly | Creator formats now: a map with a facecam bubble, a scoreboard reveal, a phone flow. But the phone "screen recording" is grey skeleton bars, there are white flash frames, and the play button sits on the face (r2-06). |
| 07 Reel label clutter | Partly | One DEMO chip per card, but it is stacked with a series chip, a 96 px sticker, a play button, a caption box and a 4-button rail (r2-06). |
| 08 RSVP success moment | Held | The toast renders above the dialog; the ticket and stamp are the hero (`$G/compare/rsvp-flow.png`). |
| 09 "I'm going" card | Held, undersized | Present, but shown at 85 x 140 px (r2-04). |
| 10 sticker unlock | Held | A centred "NEW STICKER · Called It" reveal with a burst (`$G/compare/quiz-reveal.png`). |
| 11 quiz question screens | Held | 8 colour worlds, picture tiles, the Leaning chip and a press pop (`$G/compare/quiz-play.png`, `quiz-play2.png`). |
| 12 quiz share card | Held | A poster card with the character and 35% / 19% numerals (`$G/compare/quiz-cards.png`). |
| 13 result pages know the sender | Held | "Kira got The Hype Captain. Your turn: 8 questions, about a minute." (`$G/flows/result-from.png`). |
| 14 issue identities | Held on the quiz | Not carried to the issues page (r2-01). |
| 15 quiz OG images | Held | A whole subline and per-result character art, in EN and ES (`$G/compare/og.png`). |
| 16 duotone / art first | Partly | Seminole Sunday leads with a type poster and the RSVP in the first screen. The trivia photo strip still doesn't read (r2-21). |
| 17 vote share and length | Held | A sheet with a 9:16 card; 9,694 px (18,799 in R1). |
| 18 about | Held | 7,428 px (10,579 in R1); the game is in the first screen. |
| 19 post preview | Held, undersized | A phone frame exists, but it is 175 px wide, below the fold, with the tag over the clip (r2-16). |
| 20 brand mark | Held | The ticket "YD" mark in the header, footer and OG images. |
| 21 join leads with dues | Held | The secondary is "See what you get". |
| 22 black poster flash | Not re-tested | — |
| 23 dated slang | Held | "the sticker is going on everything", "one very loud tiebreaker". |
| 24 LGBTQ+ tile | Held | "23% U.S." The same missing-art pattern now shows on the quiz's reproductive-freedom tile (r2-19). |
| 25 Reel at 1440 | Held | A formats rail on the left and Up Next on the right (`$G/strips/clips-1440-dark-s0.png`). |
| 26 newsletter wall | Held | Pull quote, Picks cards, One Thing card. |
| 27 series names | Held | Trivia Thursday, Seminole Sunday, Open Mic Live, Heads-up Tuesday; Spanish "Domingo en Seminole". |
| 28 share the 404 laptop | Held | "Send my laptop" (`$G/compare/join-flow.png`, last frame). |

## Per-page scores

0 to 100; 90 or more would beat the best benchmark in its category. Round 1 scores are in brackets.

| Page | Score | Would they screenshot it? | One line |
|---|---|---|---|
| Home (`index.html`) | 76 (64) | Maybe, the maker card | The hero lands now: annotation, bubble, ticket. Still 108 first-screen words, 47 boxed cards and not one full-bleed moment. |
| Events (`events.html`) | 75 (74) | Maybe, the Seminole Sunday poster | Celery world, ticket stack, tentpole and named series. Then 5,388 px of 770 px cards, with the tentpole listed twice. |
| Invite (`events/seminole-sunday-oviedo.html`) | 79 (68) | Yes, the SEAT SAVED ticket | Type poster plus RSVP in the first screen and a great stamp moment. The going card is a thumbnail, and the page runs 7 screens. |
| Vote (`vote.html`) | 80 (63) | Yes, the 2-dates card | Best civic page on any site in the set. It wants one scroll-driven moment. |
| Issues (`issues.html`) | 67 (68) | No | Same 16-screen brief, nine identical blocks. The quiz's identities and characters never show up here. |
| Reel (`clips.html`) | 72 (52) | Maybe | Video first with real creator mechanics. Overlays crowd the faces, and the phone clip is a wireframe. |
| Post (`post.html`) | 70 (48) | No | Sun world, an examples strip and a stepper. The preview of your own clip is small and hidden below the fold. |
| Quiz (`quiz.html`) | 86 (71) | Yes | The deck, colour worlds, picture tiles and poster cards. Missing the duo payoff. |
| Quiz result (`quiz/show-up/hype-captain.html`) | 76 (60) | Yes (via its card) | Knows the sender and has character art, but doesn't show the card that was shared. |
| Join (`join.html`) | 77 (70) | Yes, the YOU'RE IN card | Live card hero and stamp. The card repeats, locked stickers are grey, and the page runs 9.7 screens. |
| Newsletter (`newsletter.html`) | 74 (66) | Maybe, the 7:00 lock screen | Rhythm fixed. Picks and Spotlight are text-only; the letter glares cream in dark mode. |
| About (`about.html`) | 77 (58) | Maybe, Real or DEMO | Game first, crew map, identity crews. The roles grid is still an org chart. |
| 404 (`404.html`) | 85 (82) | Yes | The laptop toy now shares as a card. |

Host kit (`host.html`) was spot-checked at the hero only (tangerine "Host a night." with an open-box
illustration); it isn't scored.

## What already beats the benchmarks (keep it)

- **The quiz flow end to end.**
  - Rare Beauty's finder has 4 steps and a product grid. Ours has 8 coloured screens, picture tiles, a live
    "Leaning:" chip, a sticker reveal and a poster card with honest computed percentages.
  - Sources: `$G/compare/quiz-vs-finders.png`, `quiz-play.png`, `quiz-cards.png`.
- **Vote's "Send these 2 dates" sheet.** Both / Dec 31 only / Jan 1 only, story or post, official wording
  printed. This is practical value made shareable, and no right-wing or brand site has an equivalent
  (`$G/compare/share-moments.png`).
- **The RSVP ticket:** "ADMIT SOFIA", the SEAT SAVED stamp slapping on, and the date stub
  (`$G/compare/rsvp-flow.png`).
- **The type-poster event art.** Seminole Sunday as a night poster with the chicken sticker, and the
  "Can't buy it. Earn it." merch drop.
- **Identity naming:**
  - EN: The Rent Realist, The Card-Carrying Reader, The SunRail Romantic, The Lake Keeper
  - ES: La Chispa
  - These are Touchland/Liquid Death-grade names.
- **About's Real-or-DEMO game.** It turns the honesty layer into play; no brand does this.
- **Dark mode:** designed on 15 of 16 pages. Partiful is still the only benchmark with any.
- **Spanish carries the energy:** "Domingo en Seminole", "La Chispa", "Mira qué hay" (`$G/compare/es-first.png`).

## Findings

Most severe first. Each one names the files a fixer would edit.

### genz-brand-r2-01 · major · Issues is still a 16-screen policy brief, and the quiz identities never show up there

- **Page:** issues (EN and ES).
- **Evidence:**
  - 13,915 px at 390 (14,092 in round 1, so 1% shorter).
  - The `x-issues` block alone is 10,561 px: nine identical sub-templates, each with a coloured card, a "THE
    NUMBERS" carousel, "WHAT WE'RE DOING" bullets and "ONE THING YOU CAN DO" with 3 or 4 stacked buttons
    (`$G/strips/issues-390-light-r0.png` to `-r3.png`).
  - The number cards are carousel cells of equal height, so short facts float in empty space. The rent card
    carries 4 lines in a 300 px card (`$G/compare/issues-vs-duolingo-apple.png`, third frame).
  - The quiz built 8 identity characters (`assets/img/characters/issue/*.svg`) and names ("The Rent Realist",
    "The Lake Keeper"), but `issues.html`, `assets/js/pages/issues.js` and `data/pages/issues.js` reference
    neither (0 matches for "characters").
  - Only 3 of the 9 issue cards carry any sticker.
  - Duolingo and Apple's Compare explain with one big visual per idea. Starface's bento is the whole page, not
    the entrance to a document.
- **Fix:**
  - Make each issue one compact identity card, in this order: the character, the identity name above the plain
    issue name, one giant sourced number, the hook line, one primary action.
  - Put the rest ("See the 3 numbers", "What we're doing") behind a disclosure or a bottom sheet with its
    anchor.
  - Keep reproductive freedom in the calm template, with no character.
  - Make the hero bento tiles open those sheets.
  - Target 8 screens or fewer (about 6,700 px) at 390. Every source stays one tap away.
- **Files:**
  - issues.html
  - assets/js/pages/issues.js, assets/css/pages/issues.css
  - data/pages/issues.js, data/slices/issues.js
  - es/issues.html via tools/make_es.js

### genz-brand-r2-02 · major · The events list is 14 screens, and every card is a phone screen tall

- **Page:** events.
- **Evidence:**
  - 11,748 px at 390; the "Pick a night" section alone is 5,388 px.
  - Each event card is about 770 px tall. The poster panel (the best art on the site) gets about 200 px of
    that; the rest is a bullet list, tags, a facepile and two buttons (`$G/strips/events-390-light-r1.png`).
  - The page has 72 hard-shadow boxes.
  - The Renew-Ready Party appears in the tentpole band and again in the list.
  - Partiful's discovery, Skims' drops and Owala's Color Drop list many items per screen and give one hero the
    big treatment (`$G/compare/events-vs-partiful-owala-skims.png`).
- **Fix:**
  - Keep the full poster card for the featured night only.
  - Render the rest as ticket rows of about 200 px each:
    - date stub on the left
    - the poster as a 96 px square thumbnail (type plus sticker)
    - title and one meta line
    - I'm in
  - Group the rows under sticky "This week / Next week / December" date rails.
  - Drop the tentpole instance from the list.
  - Target 7 screens or fewer at 390.
- **Files:**
  - events.html
  - assets/js/pages/events.js, assets/js/eventcard.js, assets/css/pages/events.css
  - data/pages/events.js
  - es/events.html via tools/make_es.js

### genz-brand-r2-03 · major · The quiz never pays off the friend who sent it (no duo moment)

- **Pages:** quiz, quiz/show-up/*, quiz/issue/* (EN and ES).
- **Evidence:**
  - Arriving via `?from=Kira` shows "Kira got The Hype Captain. Your turn" (`$G/flows/result-from.png`), and
    the share URL carries only `ref` and `from` (assets/js/pages/quiz.js header, lines 10 and 57-60).
  - After the friend finishes, the result page and card never mention Kira again.
  - Spotify's Blend and Wrapped Clubs exist because "you + me" is more shareable than "me" (report 08 §6
    rank 1, "Wrapped Clubs").
- **Fix:**
  - Add the sharer's type to the share URL (`t=hype`). It is not personal data, so it is safe on minors'
    random-code links too.
  - On the result, show a duo panel: "You + Kira = The Planning Committee" (or "You + your friend" when there
    is no `from`).
  - Write 21 short pair lines (15 pairs plus 6 same-type), EN and ES, voice-checked.
  - Offer a duo card (both characters side by side, both type names, the link, DEMO and the paid-for line) as
    a new cards-brand template.
  - Carry `t` through the static result pages' landing.
- **Files:**
  - assets/js/pages/quiz.js, assets/js/cards-brand.js (new `quiz-duo` template)
  - data/quiz.js (duo lines), data/pages/quiz.js
  - tools/make_quiz_pages.js
  - es twins via tools/make_es.js

### genz-brand-r2-04 · major · At the RSVP peak, the "I'm going" card is an 85 x 140 px thumbnail

- **Pages:** every invite page, plus events and home (any RSVP).
- **Evidence:**
  - `[data-rsvp-card-preview]` measures 85 x 140 px beside "Share my I'm-going card", inside a beige box under
    the ticket (`$G/compare/rsvp-vs-partiful.png`).
  - The toast repeats the sheet's own line: rsvp.js:760 toasts `success.rsvp.title + success.rsvp.body`
    ("Seat saved. Add it to your calendar so future you remembers too.") while rsvp.js:379 prints the same
    body under the ticket.
  - "Can't make it anymore" sits in the success footer (rsvp.js:439), so a cancel link is the last thing in the
    happiest moment.
  - Wrapped makes the story card the whole screen. Partiful's peak shows you in the guest list.
- **Fix:**
  - After the stamp lands, let the ticket flip (or swipe) to the 9:16 going card at 280 px or wider, with
    "Post it to your story" as the primary action and the calendar buttons second.
  - Shorten the toast to "You're in." or drop it while the sheet is open.
  - Move "Can't make it anymore" into "Change my RSVP".
  - Keep it static under reduced motion and on calm events.
- **Files:**
  - assets/js/rsvp.js (`showDone`, the card group), assets/css/rsvp.css
  - data/strings.js (`success.rsvp.*`), data/events.js (`rsvpForm` labels)

### genz-brand-r2-05 · major · Everything is a bordered card with a hard shadow; no page has a full-bleed moment

- **Pages:** all, worst on home, events, about and issues.
- **Evidence:**
  - Measured at 390 (elements at least 60 x 40 px):

    | Page | Hard-offset shadows | Rounded bordered boxes |
    |---|---|---|
    | Home | 47 | 57 |
    | Events | 72 | 86 |
    | About | 63 | 86 |
    | Issues | 45 | 46 |

  - Full-bleed media (an image or video at viewport width and taller than 300 px): 0 on every page measured.
  - Info cards, FAQ rows, number cards, locked sticker tiles and buttons all wear the same 2 px border and the
    same offset shadow, so the eye has no hierarchy.
  - Report 08 technique #2 ("quiet chrome, loud content", P0) and #6 (giant type over full-bleed images).
  - Rhode, Skims and A24 give one image the full width. Poppi gives one colour and one object the whole screen.
  - Partiful's hero is a single photo of two friends.
  - Composites: `$G/compare/home-vs-brands-m.png` and `$G/compare/desk-1.png`.
- **Fix:**
  - Reserve the border plus hard shadow for interactive and collectible objects only: tickets, cards,
    stickers, primary buttons.
  - Flatten secondary containers (fact cards, FAQ, "what we're doing", number cards) to a fill or a hairline.
  - Give each page one unboxed, edge-to-edge moment:
    - home: the Seminole Sunday poster or the first clip, full bleed
    - events: the tentpole poster, full bleed
    - issues: one giant number in type across the full width
    - about: the crew map, full bleed
  - Add a shadow token tier (`--shadow-hard` for objects, none for containers) so pages can't drift back.
- **Files:**
  - assets/css/components.css (`.card`, `.panel`, shadow utilities), assets/css/tokens.css
  - assets/css/pages/home.css, events.css, issues.css, about.css, join.css

### genz-brand-r2-06 · major · Reel overlays crowd the faces, and the demo footage still reads as a template

- **Pages:** clips, home Reel strip, post examples.
- **Evidence:**
  - The first Reel card (390 x 724) carries 6 overlays plus the caption:

    | Overlay | Size (px) |
    |---|---|
    | caption box | 292 x 74 |
    | DEMO · STOCK PHOTO chip | 180 x 28 |
    | series chip | 108 x 44 |
    | play button | 76 x 76 |
    | sticker burst | 96 x 96 |
    | rail | 46 x 214 |

  - The play button lands on the precinct-captain face (forehead), and the caption box covers her mouth. On
    Nia's clip the megaphone sticker sits beside her eye (`$G/strips/clips-390-light-r0.png`).
  - In the video itself (`$G/frames/`):
    - the mail-ballot "phone screen recording" is grey skeleton bars with no readable text, so it reads as a
      loading state, not a creator's screen capture (`mail-ballot-renew.png`)
    - the trivia clip has two white flash frames (`two.png`, row 2, frames 5 and 8)
  - TikTok and Reels keep the picture clean: a right rail and a bottom caption, nothing over the face
    (`$G/compare/clips-vs-poppi-gymshark-topicals.png`).
- **Fix:**
  - Add a face-safe zone per clip (`safe: {x, y, w, h}` in SPECS, copied to data/clips.js) and lay out
    overlays outside it.
  - Merge the series name into the DEMO chip line ("DEMO · stock · Seminole in 60").
  - Drop the poster sticker (stickers already pop in inside the video).
  - Make the whole card tap-to-play, with a small play glyph bottom-left.
  - Re-render the phone flow with readable mocked UI text: the real step names, labelled DEMO, no
    voteseminole.gov branding.
  - Replace the white flashes with hard cuts.
- **Files:**
  - assets/js/reel.js, assets/css/pages/clips.css, assets/css/pages/home.css
  - assets/video/make_demo_clips.py (SPECS), assets/video/stage.js
  - data/clips.js (regenerated)

### genz-brand-r2-07 · major · Locked stickers look dead, so the collectible isn't desirable before you join

- **Pages:** join ("How stickers work"), home (sticker teaser), member card.
- **Evidence:**
  - assets/css/maker.css:194 sets
    `.rules__item[data-state="locked"] .rules__art { filter: grayscale(1) …; opacity: .55 }`.
  - At 390 each locked tile is about 165 x 290 px: a 60 px grey icon at the top, an empty middle and "LOCKED"
    at the bottom (`$G/strips/join-390-light-r0.png` frame 4, `$G/strips/index-390-light-r1.png` frame 3).
  - Starface's blind box and Topicals' card flip make the locked state the tease. A grey, half-transparent
    sticker says "you can't have this".
- **Fix:**
  - Show locked stickers in full colour, with a peel-corner overlay and a small lock badge, or as brand-colour
    mystery silhouettes with a "?" that tilts on tap.
  - Write each rule as a micro-dare ("Bring 1 friend to a night").
  - Shrink tiles to about 120 px in a swipeable row.
  - Keep "Voting never earns anything" exactly as is.
- **Files:**
  - assets/js/membercard.js (`rulesPanel`), assets/css/maker.css
  - assets/css/pages/join.css, assets/css/pages/home.css

### genz-brand-r2-08 · major · Join repeats itself and runs almost 10 screens

- **Page:** join.
- **Evidence:**
  - 8,188 px at 390 in 7 sections.
  - The member card appears twice before you join: the live hero card at about 600 px, and a dashed "YOUR
    NAME" preview again in "What you get" at about 1,800 px.
  - The 15-sticker grid ("The county sticker pack") is followed directly by "How stickers work" with the same
    15 stickers again (`$G/strips/join-390-light-r0.png`).
  - Skims and e.l.f. keep sign-up to one screen plus perks (`$G/compare/join-vs-elf-skims-starface.png`).
- **Fix:**
  - Delete the second card preview and point at the hero card ("That card up top is yours. It saves the
    second you join.").
  - Merge the pack and the rules into one panel.
  - Make the $20 tiers a compact two-tile row.
  - Keep the 14-to-17 block, trimmed to its three tape cards.
  - Target 6 screens or fewer.
- **Files:**
  - join.html
  - assets/js/pages/join.js, assets/css/pages/join.css
  - data/pages/join.js
  - es/join.html via tools/make_es.js

### genz-brand-r2-09 · major · Home's first screen still talks too much, and its only photo shows no faces

- **Page:** home.
- **Evidence:**
  - 108 words in the first 844 px below the header at 390. Round 1 had 148; the benchmarks have 12 to 25
    (Partiful about 20, Duolingo 13, Rhode about 12).
  - Home's only photo (Unsplash `1529333166437`, three people from behind with hands up at sunset) fills 25%
    of the first screen.
  - The first screen says DEMO four times: the banner, the "Stock photo · not members" chip, "DEMO EVENT" and
    "23 going (DEMO)" (`$G/strips/index-390-light-r0.png`).
  - Rare Beauty, Rhode and Partiful lead with a face or a close crop (`$G/compare/home-vs-brands-m.png`).
  - I'm not asking for member photos; that is the chapter's call.
- **Fix:**
  - Keep the H1, "the fun kind", the bubble, the two CTAs and the ticket.
  - Move "Events are free…" under the ticket.
  - Crop the photo tighter (4:5, the hands and the sun filling the frame) or pick a labelled stock image with
    faces.
  - Merge "Stock photo · not members" and "DEMO EVENT" into one chip ("DEMO event · stock photo"), which keeps
    B30.
  - Aim for 60 words or fewer.
- **Files:**
  - index.html
  - assets/css/pages/home.css, assets/js/pages/home.js
  - data/pages/home.js

### genz-brand-r2-10 · minor · The shared result page doesn't show the card that was shared

- **Pages:** quiz/show-up/*.html, quiz/issue/*.html (EN and ES).
- **Evidence:**
  - With `?from=Kira`, the page shows the banner and the hero character, but the 4:5 poster card Kira posted
    appears nowhere on the 2,818 px page.
  - The friend tapped a card preview and lands on a different composition (`$G/flows/result-from.png`).
- **Fix:**
  - When `from` is present, show the type's poster card at the top as "Kira's card" (a pre-rendered 4:5 PNG
    from make_og or the cards-brand template), then "Your turn".
- **Files:** tools/make_quiz_pages.js, assets/js/pages/quiz.js, assets/css/pages/quiz.css.

### genz-brand-r2-11 · minor · No scroll-driven moment anywhere; long civic pages have no signature motion

- **Pages:** vote, issues.
- **Evidence:**
  - 0 uses of `animation-timeline` or `view-timeline` in assets/css.
  - Report 08 technique #10 proposes a "How your mail ballot travels" scrolly. Apple's pages are the
    benchmark.
- **Fix:**
  - On vote, add one `@supports (animation-timeline: view())` explainer: the envelope moves request → mailbox
    → ballot → drop box, and each step lights as you scroll. It is static under reduced motion and must keep
    the required wording.
  - On issues, count the big numbers up on view (static under reduced motion).
- **Files:** assets/css/pages/vote.css, assets/js/pages/vote.js, vote.html, assets/css/pages/issues.css.

### genz-brand-r2-12 · minor · In dark mode, the letter is a 1,756 px cream glare panel

- **Page:** newsletter.
- **Evidence:**
  - A pixel column at x = 4 in `$G/shots/newsletter-390-dark.png` is rgb(255, 246, 234) from y = 1,540 to
    3,296. That is the only light run across all 16 dark shots (`$G/compare/dark-390.png`, last frame).
  - The cause: `.section--cream` sits in the forced-light list at assets/css/tokens.css:128.
- **Fix:**
  - Give the letter a warm dark "paper" in dark mode: deep plum paper, cream text, and a drop cap and pull
    quote at AA.
  - Or drop `.section--cream` from the letter and let it follow the theme.
- **Files:** newsletter.html, assets/css/pages/newsletter.css, assets/css/tokens.css.

### genz-brand-r2-13 · minor · Newsletter Picks and Spotlight are text-only

- **Page:** newsletter.
- **Evidence:**
  - Each Pick card is a numeral, a tag, a title and 5 lines of text.
  - The Spotlight avatar is an "M" monogram.
  - The page is 9,563 px.
  - Summer Fridays and A24's zine give each recommendation an image
    (`$G/compare/newsletter-vs-summerfridays-a24.png`, `$G/strips/newsletter-390-light-r1.png`).
- **Fix:**
  - Give each Pick a county sticker (or a photo only where the subject reads).
  - Give the Spotlight a drawn avatar in the character style, labelled DEMO.
  - Turn "Past letters" into a 3-chip row.
- **Files:** assets/js/pages/newsletter.js, data/newsletter.js, assets/css/pages/newsletter.css.

### genz-brand-r2-14 · minor · Hero composition is still one template

- **Pages:** all core pages.
- **Evidence:**
  - Colour worlds and objects now differ (R1 01 held). But 11 of 13 first screens share one composition:
    - an eyebrow pill
    - a 2-to-3-line condensed H1 with a highlighted last word
    - two pill buttons
    - the object at the right (1440) or below (390)
  - Sources: `$G/compare/desk-1.png`, `desk-2.png`.
  - Poppi and Liquid Death vary the layout itself: a full-bleed product, a type-only poster, video.
- **Fix:** break the template on three pages.
  - Quiz: the fanned deck full width, with the H1 overprinted on a solid panel.
  - Vote: the two date tiles as 60% of the hero, with the H1 smaller.
  - 404: the laptop toy first, with the headline as its caption.
- **Files:**
  - quiz.html, vote.html, 404.html
  - assets/css/pages/quiz.css, assets/css/pages/vote.css, assets/css/pages/about.css

### genz-brand-r2-15 · minor · Home's Pause button sits on top of the chat bubble

- **Page:** home (390 and 1440).
- **Evidence:**
  - The "Pause motion" button (x 330–374, y 403–447) overlaps `.x-bubble` (x 16–374, y 349–431) by
    44 x 28 px. It reads as a glitch on the hero's best line (`$G/strips/index-390-light-r0.png`, frame 1).
  - This is new; it is not the known ticker item.
- **Fix:** dock the control outside the bubble (below its right edge, or in the hero corner), styled like the
  ticker's control.
- **Files:** assets/css/pages/home.css, assets/js/pages/home.js.

### genz-brand-r2-16 · minor · The post preview is small, below the fold, and covered by its tag

- **Page:** post.
- **Evidence:**
  - After a video is picked at 390, `.x-phone` is 175 x 284 px at y = 1,065, below the 844 px fold.
  - The "DEMO PREVIEW · NOT UPLOADED" tag (126 x 78 px) covers the top of the clip, where the face is
    (`$G/compare/share-moments.png`, third frame).
- **Fix:**
  - Scroll the preview into view on pick and size it at 260 px or wider.
  - Move the tag to a strip under the phone.
  - Overlay the caption as it's typed.
- **Files:** assets/js/pages/post.js, assets/css/pages/clips.css, post.html.

### genz-brand-r2-17 · minor · "Two very shareable cards" tells instead of shows; the six types are a 2,062 px stack

- **Page:** quiz.
- **Evidence:**
  - `stage.title` is "Two quizzes, two very shareable cards" (data/pages/quiz.js:26). Calling your own thing
    shareable is ad copy.
  - "Meet all 6 types" stacks six full-width cards over 2,062 px at 390 (`$G/strips/quiz-390-light-r0.png`).
- **Fix:**
  - Use something like "Two quizzes. One card that's a little too you." (voice-check it).
  - Make the types a swipeable fanned deck (reuse the hero deck) or a 2-column grid of 160 px cards.
- **Files:** data/pages/quiz.js, assets/js/pages/quiz.js, assets/css/pages/quiz.css.

### genz-brand-r2-18 · minor · About's "Find your seat" is still an org chart

- **Page:** about.
- **Evidence:**
  - Eight white bordered boxes ("President / Officer +", "Treasurer / Officer +"), 1,179 px at 390.
  - The character strip above them is 210 px wide (`$G/strips/about-390-light-r1.png`, frames 2 and 3).
- **Fix:**
  - Turn the roles into a swipeable deck of role cards in the quiz style. Each card gets a show-up character
    that fits the role (Spreadsheet Witch → Treasurer, Group-Chat General → Communications), a one-line "you'd
    like this if…" and "I'm curious".
  - Use no names.
- **Files:**
  - about.html
  - assets/js/pages/about.js, assets/css/pages/about.css
  - data/team.js, data/pages/about.js

### genz-brand-r2-19 · minor · The quiz's reproductive-freedom tile looks like missing art

- **Page:** quiz (issues grid).
- **Evidence:**
  - Among nine issue tiles, eight have a character; "Reproductive freedom" is a bare purple tile of the same
    size (`$G/strips/quiz-390-light-r1.png`, frame 2).
  - This is the same "missing data" read as round 1's LGBTQ+ tile.
- **Fix:**
  - Keep it in the calm register, but make the plainness deliberate: a solid lake or ink tile with a short
    line ("Your body, your doctor, your call.") at the same type size as the identity names.
  - No sticker, no character.
- **Files:** assets/js/pages/quiz.js (issue grid), assets/css/pages/quiz.css, data/quiz.js.

### genz-brand-r2-20 · minor · Invite pages run 7 screens, and the facepile is initials

- **Pages:** events/*.html.
- **Evidence:**
  - seminole-sunday-oviedo is 6,002 px at 390.
  - "More nights like this" adds two full 800 px event cards (`$G/strips/events__seminole-sunday-oviedo-390-light-r1.png`).
  - The going row is "K R S +31" in coloured letter circles.
  - Partiful's invite is about 2 screens, with a guest list that has avatars (`$G/compare/rsvp-vs-partiful.png`).
- **Fix:**
  - Render "More nights" as the compact ticket rows from r2-02.
  - Draw the facepile with county sticker art instead of letters. That adds no invented faces, and the count
    keeps "(DEMO)".
- **Files:**
  - tools/make_event_pages.js
  - assets/js/eventcard.js (`fillGoing`), assets/css/pages/events.css, assets/css/rsvp.css

### genz-brand-r2-21 · minor · Photo invite strips still don't read

- **Pages:** events/trivia-county-edition.html and the other photo covers.
- **Evidence:**
  - The trivia cover is a 360 x 150 px green duotone strip of a table. Hands and cards are unreadable, and the
    stock chip plus gator sticker cover about a third of it (`$G/compare/events-first.png`, last frame).
  - Round 1's rule was "a photo only when its subject reads at 120 px".
- **Fix:**
  - Switch trivia to the type poster (as Seminole Sunday does), or crop to hands and cards with `cover.lift`.
- **Files:** data/events.js (`cover.photo`, `cover.lift`), tools/make_event_pages.js, assets/css/components.css (`.photo--duo`).

### genz-brand-r2-22 · minor · Seminole Rewind, the Wrapped moment, has no teaser

- **Pages:** home, join (success), member card.
- **Evidence:**
  - The `rewind` template exists and opens Thu, Dec 17, 2026, 7 am (assets/js/cards-brand.js:80).
  - No HTML page mentions it (0 matches for "Rewind" in *.html).
  - Skims' "coming soon" and Owala's drops show that a dated reveal is a reason to come back (B35).
- **Fix:**
  - Add a "Seminole Rewind · Thu, Dec 17 at 7 am" chip with Notify me (.ics) to the home drop band and the join
    success card.
  - Label it as the site's own feature date, and keep "no DEMO numbers on a Rewind card".
- **Files:**
  - index.html, assets/js/pages/home.js, data/pages/home.js
  - assets/js/pages/join.js, data/pages/join.js

## Report 08's top 10 techniques: status

| # | Technique | Round 2 status | Finding |
|---|---|---|---|
| 1 | Finder and self-sort ending in a share card | Excellent; missing the duo payoff and the sender's card on landing | r2-03, r2-10 |
| 2 | Event drops and Partiful-grade invites | Drop, tentpole and ticket success are strong; the list is long and the going card small | r2-02, r2-04, r2-20 |
| 3 | Group-chat share layer | Strong: vote 2-dates card, quiz cards, laptop card, quick maker | — |
| 4 | Home Reel with one action per clip | Present and video-first; overlays and the skeleton phone clip | r2-06 |
| 5 | Levels and streaks (sticker book) | Rules are public; locked stickers look dead | r2-07 |
| 6 | Community wall and weekly prompt | Prompt, examples and stepper; the preview is small | r2-16 |
| 7 | Ask Claude chip | Correctly absent (ruling 00) | n/a |
| 8 | Receipts in the nav | "What's real?" game and "This chapter is real" strip | keep |
| 9 | Collectibles | Member card, sticker reveal, laptop card; Rewind has no teaser | r2-07, r2-22 |
| 10 | Tactile delight within budget | Press, kinetic H1, stamp, reveal; no scroll-driven moment; too many hard shadows | r2-05, r2-11 |

## Known items and chapter decisions, not filed

- Committee status and paid-for wording, real member photos and video in place of labelled stock, native
  Spanish sign-off, counsel review of the policy drafts and perk ladder, a cross-device squad meter, and
  Lighthouse LCP noise.
- Round 1 known items: the long footer on phones, and the ticker Pause overlapping city names. The home rotor
  overlap in r2-15 is a different element.

## Evidence index (`$G/`)

| Topic | Files |
|---|---|
| First screens at 1440 | `compare/desk-1.png` (home, events, Seminole Sunday, vote, issues, join), `compare/desk-2.png` (result, rent result dark, newsletter, about, 404, host) |
| Home vs beauty | `compare/home-vs-brands-m.png`, `strips/index-390-light-r0.png`, `r1.png`, `r2.png` |
| Events and invites | `compare/events-first.png`, `compare/events-vs-partiful-owala-skims.png`, `strips/events-390-light-r1.png`, `strips/events__seminole-sunday-oviedo-390-light-r1.png` |
| RSVP | `compare/rsvp-flow.png`, `compare/rsvp-vs-partiful.png`, `compare/share-moments.png` |
| Quiz | `compare/quiz-play.png`, `compare/quiz-play2.png`, `compare/quiz-reveal.png`, `compare/quiz-cards.png`, `compare/quiz-vs-finders.png`, `flows/result-from.png` |
| Reel | `strips/clips-390-light-r0.png`, `r1.png`, `strips/clips-1440-dark-s0.png`, `s3.png`, `frames/*.png`, `compare/clips-vs-poppi-gymshark-topicals.png` |
| Issues | `strips/issues-390-light-r0.png` to `r3.png`, `compare/issues-vs-duolingo-apple.png` |
| Join and 404 | `compare/join-flow.png`, `compare/join-vs-elf-skims-starface.png`, `strips/join-390-light-r0.png`, `r1.png` |
| Newsletter | `strips/newsletter-390-light-r0.png` to `r2.png`, `compare/newsletter-vs-summerfridays-a24.png` |
| About | `strips/about-390-light-r0.png`, `r1.png`, `compare/about404-vs-liquiddeath-glossier.png` |
| Post | `strips/post-390-light-r0.png`, `strips/post-1440-light-s0.png`, `compare/post-vs-rarebeauty-alo.png` |
| Dark mode | `compare/dark-390.png` |
| Spanish | `compare/es-first.png` |
| OG images | `compare/og.png` |
| Raw numbers | `measure-390.json`; scripts in `pw/` (`measure.js`, `motif.js`, `checks3.js`, `quizflow.js`, `flows2.js`) |
