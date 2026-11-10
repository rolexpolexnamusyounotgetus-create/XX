# Round 1 review: Gen Z brand desirability

Lens: would a 19-year-old in Oviedo screenshot this page and send it to the group chat? Reviewer pass on
Monday, November 9, 2026, against docs/BRIEF.md (§0, §3, §5, §6b), ruling 00, voice report 05 and the
brand benchmarks in report 08. Reviewer only: no site file was edited.

## Method

- `node tools/shoot.js` on 13 core pages (home, events, events/trivia-county-edition, vote, issues, clips,
  post, quiz, quiz/show-up/hype-captain, join, newsletter, about, 404) at 390 x 844 and 1440 x 900, light
  and dark: 52 full-page shots, 0 failures, 0 console errors. Spanish spot checks (es/index, es/quiz,
  es/events/trivia-county-edition) and four more result pages and four more invite pages.
- Playwright flows at 390: quiz start to result, RSVP sheet to success (with a 150 ms capture to catch the
  confetti), join to member card, the 404 sticker toy, the home card maker, clip poster loading.
- DOM measurements: first-screen word counts, image area, element positions, label counts.
- `node tools/qa.js` (index, quiz, trivia invite; no throttle, no axe): 16/16 gates on all three. Nothing in
  this report contradicts a gate; this lens is about desirability, not compliance.
- Side-by-side composites with the bench captures (Rhode, Rare Beauty, Starface, Poppi, Liquid Death,
  Partiful, Duolingo, Glossier, Skims, Tower 28, Spotify Wrapped, Gymshark, Topicals, e.l.f.).

All evidence paths below are under
`/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/genz/` (written `$G/` below):
`$G/shots/` (full pages), `$G/strips/` (pages cut into phone screens), `$G/flows/` (interaction states),
`$G/compare/` (side-by-sides), `$G/pw/` (the measurement scripts).

## Summary

The craft floor is high. The palette is unmistakable, buttons press like Duolingo's, the kinetic H1, ticker,
reveals and view transitions are tasteful, dark mode is designed (Partiful was the only benchmark with any),
Spanish is real, there are no pop-ups, and the honesty layer is something no brand on the list has. It
already beats every right-wing site and most brand sites on speed, weight, accessibility and trust.

It is not yet desirable. Four patterns hold it back:

1. **One template stamped 13 times.** 9 of 13 core pages open on the identical violet hero (eyebrow pill,
   two-line condensed H1 with a celery second line and a pink swipe, round sticker top-right, celery button
   plus ghost button). Screenshots from different pages are hard to tell apart. Poppi and Starface give every
   product its own colour world; this site has a colour-world system (§3.2 city and issue colourways) and
   uses it on event pages and quiz results only.
2. **Almost no humans.** 7 of 13 pages have no photo at all; the whole site uses 4 Unsplash photos, and the
   one used most is a lake. Every beauty benchmark leads with people (Partiful's laughing friends fill about
   60% of its first screen).
3. **The shareable things are small or buried.** The share card on home renders at 155 x 191 px; the vote
   hub's two-date tiles (the most screenshot-able thing on the site) have no share button until 17,450 px;
   shared quiz results don't say who sent them, and the issue-result OG images cut off mid-sentence.
4. **The dopamine moments don't land.** The RSVP confetti and toast render underneath the modal sheet, so
   nobody sees them; sticker unlocks are a line of toast text on top of the result card; demo clips are
   stock-photo slideshows.

What a 19-year-old would send today: the 404 laptop toy, the quiz type deck ("The Spreadsheet Witch"), the
Dec 31 / Jan 1 tiles on vote, the type-only event posters (KARAOKE NIGHT, CREATOR NIGHT). What they would
not: home, the Reel, post, about. Fixing findings 01 to 20 would move home, the Reel and the quiz into the
80s; nothing here needs a backend.

No blocking findings from this lens. 20 major, 8 minor.

## Per-page scores

0 to 100; 90 or more would beat the best benchmark in its category.

| Page | Score | Would they screenshot it? | One line |
|---|---|---|---|
| Home (`index.html`) | 64 | No | Saturated and fast, but 148 words in the first screen, a 12-section sampler, a thumbnail share card and a stock Reel. |
| Events (`events.html`) | 74 | Maybe | Date-stub hero and "6 more nights, locked" drop tiles are Skims/Owala-grade; duotone photos are muddy and cards are tall. |
| Invite (`events/trivia-county-edition.html`) | 68 | Maybe | Partiful-style RSVP card up top and a real colour world; murky cover below the RSVP, invisible success moment, no story card. |
| Vote (`vote.html`) | 63 | The tiles, yes | Best practical-value first screen on the site; 18,799 px long and the share is at 93% depth. |
| Issues (`issues.html`) | 68 | Maybe | Big-number bento and lines like "You're not bad with money. The math here is just rough." Then 14,092 px of policy brief. |
| Reel (`clips.html`) | 52 | No | Good mechanics (prompt, moderation, action chips), but no video in the first screen, stock slideshows and label clutter. |
| Post (`post.html`) | 48 | No | A long plain form with no preview of your clip and no examples. |
| Quiz (`quiz.html`) | 71 | Yes (the deck) | Fanned type cards and funny type names; the question screens are the flattest screens on the site and the result card is thin. |
| Quiz result (`quiz/show-up/hype-captain.html`) | 60 | No | Big colour and type, but it doesn't know who sent it, and issue results are policy labels. |
| Join (`join.html`) | 70 | Maybe | Live member card with your name and a "YOU'RE IN" stamp; tiers are generic and the first screen leads with dues. |
| Newsletter (`newsletter.html`) | 66 | No | The 7:00 lock-screen hero is charming; the letter is a wall of text. |
| About (`about.html`) | 58 | No | "Real or DEMO? Test yourself" and city crews are great; 2,587 px of disclaimers and 1,307 px of placeholder team cards bury them. |
| 404 (`404.html`) | 82 | Yes | The laptop sticker toy with sourced facts beats Liquid Death's TIMEWASTER on purpose. Let people share the laptop. |

## What already beats the benchmarks (keep it)

- No first-visit modal anywhere (9 of 23 brand stores fire one in 7 s), no cookie wall, 1 outside host.
- Tactile pressable buttons with hard shadows, kinetic H1, ticker with Pause, scroll reveals under `@supports`.
- A designed dark theme in both the media query and the toggle.
- Event pages without photos: type posters in the event colour (`$G/compare/ev-posters.png`), the best art on the site.
- The "6 more nights, locked" drop with mystery ticket stubs (`$G/strips/events-1440-light-s1.png`).
- Quiz type names with a wink ("The Spreadsheet Witch: Give me chaos. I'll give you a tracker.") and "undertones", a shade-finder nod.
- The 404 toy: 10 stickers, each with a sourced Seminole fact (`$G/flows/404-toy-6-light.png`).
- Join: the member card types your name live, then stamps "YOU'RE IN" (`$G/compare/flow-rsvp-join.png`).
- Copy in the small places: "This page skipped the meeting.", "Rent went up again? You're not bad with money.", "Three friends, not 300."

## Findings

Ranked most severe first. Each names the files a fixer would edit.

### genz-brand-01 · major · Nine pages share one hero; no page has its own colour world

- **Pages:** events, vote, clips, post, quiz, join, about, 404 (plus home, which must stay violet).
- **Evidence:** the first hero `<section>` is `section--violet` on index, events, vote, clips, post, quiz, join,
  about and 404 (9 of 13); a pixel at (5, 300) is rgb(106, 43, 255) on all nine. Same composition each time:
  eyebrow pill, 2-line condensed H1 with a celery second line and a bubblegum swipe, round sticker top-right,
  celery primary plus ghost secondary. Side by side: `$G/compare/hero-sameness.png`. Benchmarks:
  Poppi gives each flavour its own full-bleed world; Starface uses a different colour tile per category
  (`$G/compare/home-d-vs-brands.png`). Report 08 technique #1 (colour worlds) is marked P0.
- **Fix:** keep home flat ultraviolet (§0.5). Give every other page its own world from the existing tokens and
  vary the hero composition, not only the fill: Events celery (matches the invite pages), Vote lake blue
  with the orange deadline tile, Reel night (TikTok-dark, video first; see 05), Quiz bubblegum with the deck
  as the hero, Join celery with the member card as the hero, About sky, 404 sun. Swap the round top-right
  sticker for a page-specific hero object (deck, ticket, card, laptop) so each first screen has a different
  silhouette.
- **Files:** events.html, vote.html, clips.html, post.html, quiz.html, join.html, about.html, 404.html (hero
  section classes), assets/css/pages/events.css, vote.css, clips.css, quiz.css, join.css, about.css,
  assets/css/components.css (`.section--*`), then es/ twins via tools/make_es.js.

### genz-brand-02 · major · Site-wide people deficit: 7 of 13 pages have no photo, and the lake is the most-used image

- **Pages:** quiz, result pages, join, vote, issues, newsletter, post, 404 (no photos); home, events, about (few).
- **Evidence (new, beyond the known "people photos small on home"):** visible `<img>` count is 0 on vote,
  issues, clips, post, quiz, quiz result, join, newsletter and 404. Four unique Unsplash photos serve the
  whole site; `1783676056910` (Lake Monroe at sunset, people as tiny silhouettes) appears 84 times in the repo
  and is the cover on the home ticket, the events list, about and the sunset event page. No face is visible
  anywhere except one demo-clip poster. Home's first screen is 8.3% image by area; every other first screen is
  0%. Benchmarks: Partiful (faces fill about 60% of the first screen), Rhode (a face crop), Rare Beauty,
  Fenty, Skims, Topicals all lead with people (`$G/compare/bench-m-4s.png`).
- **Fix:** three tracks. (1) Before launch: one consented member shoot at golden hour (Riverwalk, a SunRail
  platform, a trivia table), 20 frames, so heroes can carry real faces. (2) For the demo now, without
  licensing risk: an illustrated character set drawn in the sticker style (one character per quiz type,
  faces allowed because they are drawings), used on the quiz, results, join and the about crews. That is
  Duolingo's move and fits the die-cut look. (3) Verify 6 to 8 more from-behind, hands-only or crowd photos
  (hands holding a ticket stub, a sticker-covered laptop, a picnic blanket from above) so the lake stops
  standing in for people.
- **Files:** data/events.js (`cover.photo`), data/stickers.js (or a new character set in the same format),
  quiz.html, join.html, about.html, assets/js/pages/quiz.js, assets/css/pages/quiz.css, join.css, about.css,
  CREDITS.md via tools/credits.py.

### genz-brand-03 · major · Home's first screen is dense, and its funniest line is set at body size

- **Page:** home.
- **Evidence:** 148 words in the first 844 px at 390 (about 134 below the banner and header). The benchmark
  first screens carry about 12 to 25 words (Partiful about 20, Duolingo 13, Rhode about 12). The rotor ("We're
  the friend who always knows the deadline.") is the line with the most personality, and it renders at 17 px in a
  239 x 34 px bubble under a 61 px H1. "Local politics is a group project." puts two homework words in the
  H1, and nothing lands the wink that everyone hates group projects. Crop: `$G/compare/home-hero-crop.png`;
  full: `$G/strips/index-390-light-r0.png`. (The small photo is a known item and is not re-filed.)
- **Fix:** keep the brief's H1 verbatim, and land the joke with a Caveat Brush annotation of two or three words
  ("the fun kind") hand-drawn beside "group project" (the hand face is allowed for a few decorative words).
  Promote the rotor to the hero's second object: a real chat bubble at 24 to 28 px, full width, directly under
  the H1. On phones, move the hero sub below the CTAs so the first screen reads as H1, bubble, two buttons.
- **Files:** index.html, assets/css/pages/home.css, data/pages/home.js, es/index.html (regenerated).

### genz-brand-04 · major · Home is a 12-section sampler, and the share card (the viral engine) is a thumbnail

- **Page:** home.
- **Evidence:** 12 bands in 8,146 px (hero, ticket, next thing, ticker, Reel, invites, maker, quiz, debrief,
  scoreboard, join, letter). The card maker's preview renders at 155 x 191 px at 390 and 310 x 383 px at 1440,
  inside a 1,104 px (390) / 1,559 px (1440) section with 10 / 26 visible controls
  (`$G/flows/home-maker-390.png`, `$G/strips/index-1440-light-s2.png`). On Spotify Wrapped and Partiful the
  artefact is the hero and the controls are a footnote.
- **Fix:** on home, show the card full width (at least 320 px wide at 4:5) in a swipeable row of three ready-made
  cards (Come with me, the mail-ballot heads-up, Me on the cover), with one first-name field and one Send button;
  put the rest behind "Customize" or a link to the full maker. Merge "The real scoreboard" into the debrief
  band or move it to issues and about, and turn the Thursday Letter card into a one-line strip, so home is
  about 8 big moments rather than 12 small ones.
- **Files:** index.html, assets/js/pages/home.js, assets/js/maker.js (a compact carousel mode),
  assets/css/maker.css, assets/css/pages/home.css, data/pages/home.js.

### genz-brand-05 · major · The Reel opens with no video

- **Page:** clips.
- **Evidence:** the first clip's top is at 736 px at 390 (302 x 540 px), so 0 px of video shows in the
  390 x 664 Safari view and 108 of 540 px at 844 (`$G/strips/clips-390-light-r0.png`). The first screen is
  hero, prompt card, moderation note and filter chips. TikTok and Reels open on video; Poppi and Gymshark put
  9:16 video in the first screen; Topicals made WATCH a nav destination
  (`$G/compare/clips-vs-poppi-gymshark-topicals.png`).
- **Fix:** collapse the intro to one sticky line ("The Reel · DEMO", a "This week: 60 seconds on why you showed
  up" chip that opens the prompt sheet, a filter icon). Start the first clip directly under the header and make
  the feed full-height snap. Move the moderation promise into a "How the Reel works" sheet linked from the bar.
  feed.js already handles muted autoplay rules.
- **Files:** clips.html, assets/css/pages/clips.css, assets/js/pages/clips.js, data/pages/clips.js.

### genz-brand-06 · major · Demo clips are stock-photo slideshows nobody would post

- **Pages:** clips, home Reel.
- **Evidence:** all six posters are stock photos with a centred drop-shadow title: a suburban house ("What's a
  precinct captain?"), envelopes ("Mail ballot PSA"), empty train tracks ("SunRail to the rally"), an "I VOTED"
  sticker ("POV: first time voter"); one shows a face (`$G/compare/reel-posters.png`). A Ken Burns pan over
  a stock house is not a creator format.
- **Fix:** re-cut the demo clips in native formats that need no recognizable faces: (1) a phone screen recording,
  "Renew your mail ballot in 40 seconds", with tap dots and the required wording; this is the most forwardable
  clip and needs no model. (2) A green-screen explainer, "What's a precinct captain?", over a Seminole map
  with stickers popping in. (3) "POV: your first trivia night", hands and table only, with a scoreboard reveal.
  (4) "3 free things in Seminole this weekend", a listicle with sticker transitions. (5) SunRail footage from
  the window with the four Seminole stop names. Use TikTok-native captions (boxed white text with ink stroke,
  word-by-word pop) and a hook in the first 2 seconds. No dates in burned-in text that go stale.
- **Files:** assets/video/make_demo_clips.py (SPECS), assets/video/*.mp4 and *.jpg (regenerated),
  data/clips.js (regenerated).

### genz-brand-07 · major · Reel cards are buried in labels

- **Pages:** home Reel, clips.
- **Evidence:** each home Reel card (197 x 346 px poster) carries five items underneath: DEMO CLIP pill,
  "Stock photo · not members" pill, action button, "Read the captions", "Report". The poster above already burns
  in "DEMO CLIP" (`$G/strips/index-390-light-r0.png`, `$G/strips/index-1440-light-s1.png`). On clips, the card
  DOM renders the stock tag twice plus DEMO CLIP, four rail buttons, the action and the captions disclosure.
  The orange pills compete with the content they label.
- **Fix:** one merged chip per card ("DEMO · stock photo") in one fixed corner, which keeps B30. Move Report into
  the rail (a flag already exists there on clips), turn "Read the captions" into a CC icon on the rail that opens
  the transcript, and leave the action chip as the only thing under the clip.
- **Files:** assets/js/reel.js, assets/css/pages/clips.css, assets/css/pages/home.css,
  assets/css/components.css (`.tag--stock`, `.tag--demo`).

### genz-brand-08 · major · The RSVP success moment is invisible, and the success sheet is a utility list

- **Pages:** every invite page, events, home (any RSVP).
- **Evidence:** `YSD.ui.confetti` appends to `<body>` at z-index 95, but the RSVP sheet is a modal `<dialog>` in
  the top layer, so the burst draws underneath it: 150 ms after submit, `elementFromPoint` at a confetti bit
  returns `DIV.rsvp-done__hero` inside the dialog. The success toast (top 750 px) is covered by the sheet's
  footer button. The 150 ms capture shows neither (`$G/compare/rsvp150.png`; script `$G/pw/confetti.js`). The
  done state is "Seat saved." plus a small date stub and six buttons. Partiful's equivalent is a celebratory
  "You're going" with you in the guest list.
- **Fix:** render confetti and toasts inside the open dialog (`document.querySelector('dialog[open]') ||
  document.body` as the host). Make the ticket the hero of the done state: a big stub with "SOFIA +1" and a
  "SEAT SAVED" stamp slapping on (join.css already has an `x-stamp` keyframe), your initial dropping into the
  facepile, then the calendar and +1 actions. Static under reduced motion; never on calm events.
- **Files:** assets/js/ui.js (confetti and toast host), assets/js/rsvp.js (`showDone`), assets/css/rsvp.css,
  assets/css/components.css.

### genz-brand-09 · major · No "I'm going" story card at the moment of RSVP

- **Pages:** invite pages, events, home.
- **Evidence:** the RSVP done state offers "+1 a friend" (a link) and "Text this to a friend", but no image;
  rsvp.js never calls `YSD.cards`. The maker has an `invite` template, but it lives in a separate section on
  home only. Partiful and Spotify both hand you a story asset at the peak moment. Report 08 §6 ranks this pair
  (#2 and #3) in the top three.
- **Fix:** add "Make my I'm-going card" to the done state, opening the maker in compact mode with
  `template: 'invite'`, the event pre-selected and the first name already typed (9:16 default), so one more
  tap posts it to a story.
- **Files:** assets/js/rsvp.js, assets/js/maker.js (compact mount inside a sheet), assets/css/rsvp.css,
  data/events.js (`rsvpForm` labels EN and ES).

### genz-brand-10 · major · Sticker unlocks are a line of toast text, landing on top of the result

- **Pages:** quiz result, join, anywhere a sticker is earned.
- **Evidence:** finishing the quiz shows "New sticker: Called It." as a toast that covers the share-card preview
  (`$G/compare/flow-quiz.png`, third frame). membercard.js line 134 only calls `YSD.ui.toast`. The collectible
  has no reveal; Starface's blind box and Topicals' card flip are the reveal.
- **Fix:** a one-second sticker slap-in (the sticker art itself at about 120 px, peel and land, `x-slap` already
  exists in quiz.css) in the top corner, away from the card, captioned "Called It · on your card" with a "See
  your stickers" link. Static badge under reduced motion, nothing on civic steps.
- **Files:** assets/js/membercard.js, assets/js/ui.js, assets/css/components.css, data/levels.js
  (`stickerCollected` copy).

### genz-brand-11 · major · The quiz question screens are the flattest screens on the site

- **Page:** quiz.
- **Evidence:** cream background, white A to F pills, a thin celery progress bar; no colour, art or reaction per
  answer (`$G/compare/flow-quiz.png`, `$G/compare/quiz-vs-finders.png`). The quiz is report 08's number-one
  payoff technique. During play, a strip of the hero deck with half-cut stickers stays visible under the header
  and reads as a glitch.
- **Fix:** give each question a full-bleed colour world (rotate celery, sky, bubblegum, tangerine, mint,
  violet); make the chosen answer pop (scale, shadow collapse, a small sticker wiggle) before advancing; turn 2
  or 3 questions into picture tiles built from the stickers (Lake Monroe vs SunRail vs Big Tree); add an honest,
  computed "Leaning: The Spreadsheet Witch" line from question 4 on. Scroll the player so its top sits under
  the header, and hide the deck while playing.
- **Files:** assets/js/pages/quiz.js, assets/css/pages/quiz.css, data/quiz.js (picture options), data/pages/quiz.js.

### genz-brand-12 · major · The quiz share card is thin where Wrapped is a poster

- **Pages:** quiz result (in-page and the maker), result pages.
- **Evidence:** the 4:5 card has the type name, a small "Hit record. Keep it local." pill, a small sticker and a
  thin mix bar, with a large empty band in the middle (`$G/compare/quiz-result-scroll.png`, frame b). Spotify
  Wrapped cards are one giant number or image per card.
- **Fix:** make the type's sticker (or character, see 02) the hero art at about 45% of the card width; set the
  type name huge; turn the top two mix shares into giant numerals ("27% Creator, 19% Hype Captain", computed from
  the answers, so honest); put the tagline in a chat bubble; keep the link, DEMO and paid-for line at the
  bottom. The 9:16 version adds a "What's yours?" sticker over the link.
- **Files:** assets/js/cards-brand.js (`quiz-show-up`, `quiz-issue` templates), assets/css/maker.css.

### genz-brand-13 · major · Shared result pages don't know who sent them

- **Pages:** quiz/show-up/*.html, quiz/issue/*.html and their es/ twins.
- **Evidence:** none of the 15 result pages has `[data-invite-landing]` or loads rsvp.js, so a friend opening
  Kira's link sees the generic "Someone sent you their result. Here's what it means, and here's yours in about a
  minute." (`$G/strips/quiz__show-up__hype-captain-390-light-r0.png`). The share URL already carries `from`
  for adults.
- **Fix:** with `?from=Kira` (letters only, rendered with `textContent`, never for under-18 links, which never
  carry `from`): "Kira got The Hype Captain. Your turn: 8 questions, about a minute." with Find my type. Without
  `from`, keep today's line.
- **Files:** tools/make_quiz_pages.js (emit the landing slot and script), assets/js/rsvp.js
  (`YSD.invite.landing` without an event) or a small landing in assets/js/pages/quiz.js, data/pages/quiz.js
  (EN and ES strings).

### genz-brand-14 · major · Issue-finder results are policy labels, not identities

- **Pages:** quiz (issue mode), quiz/issue/*.html.
- **Evidence:** the result card headline is "My Seminole issue: rent." (data/quiz.js line 346); the OG reads
  "YOUR MATCH / Rent + housing" (`$G/compare/og-quiz.png`). People post who they are (report 04 §B9), not
  "my issue is wages".
- **Fix:** give each result a local identity name above the plain issue name, voice-checked, with serious
  issues kept plain: "Team Lake Monroe" (clean water), "Team SunRail" (transit), "Team Library Card" (freedom
  to read), "Team Shade Tree" (heat and insurance), "Team Roommates" (rent), "Team Payday" (wages), "Team
  Ballot Ready" (voting rights), "Team Come As You Are" (LGBTQ+). Reproductive freedom stays "Reproductive
  freedom" in the calm template. Keep the sourced number as the subline.
- **Files:** data/quiz.js (`results.*.card`), tools/make_quiz_pages.js, assets/js/cards-brand.js,
  assets/js/cards-og.js, es/ twins (regenerated).

### genz-brand-15 · major · Quiz OG images cut their subline mid-sentence and all use one generic illustration

- **Pages:** every quiz result page (EN and ES).
- **Evidence:** in the `og-quiz` template, assets/js/cards-og.js line 465 draws `wrap(ctx, sub, colW)[0]`, the
  first wrapped line only, and drops the rest. Rent, Wages and Transit read "One minute, everyday questions, one
  match. Take the" and the Spanish rent image drops "Haz el quiz." (`$G/compare/og-quiz.png`,
  `$G/compare/og-quiz2.png`). All 15 result OGs share the same three-toggle drawing instead of the type's own
  sticker, and the issue OGs use a generic sub instead of the result's number. In a group chat the preview is
  the product (report 04 §B7).
- **Fix:** allow two sub lines (reserve the height) or fit the text to width; draw the type's sticker from
  data/stickers.js at about 300 px instead of the toggles; for issue results, use the card subline ("Median rent
  here: $1,890 a month."). Regenerate.
- **Files:** assets/js/cards-og.js (`ogQuiz`), tools/make_quiz_pages.js (sub text), assets/img/og/quiz/** and
  assets/img/og/es/quiz/** via tools/make_og.js.

### genz-brand-16 · major · Duotone turns dark photos to olive mud, and the invite art sits below the RSVP on phones

- **Pages:** trivia, sunrail, sunset, picnic and other photo invite pages; events list; home invites.
- **Evidence:** `.photo--duo` is grayscale plus `mix-blend-mode: multiply` into `--duo` (components.css lines
  308 to 310). Multiply can only darken, so the dark trivia interior (`1646934280686`) becomes near-black olive
  with unreadable faces (`$G/compare/trivia-duotone-crop.png`). On phones the cover's top is at 753 px, below
  the title and RSVP card (`$G/compare/invite-vs-partiful.png`). The photo-free type posters are the best art
  on the site (`$G/compare/ev-posters.png`).
- **Fix:** use a true two-tone map (shadows to `--night`, highlights to `--duo`) with an inline SVG
  `feComponentTransfer` filter, or lift levels before the multiply; add a per-photo `cover.lift`. Use a photo
  only when its subject reads at 120 px; otherwise use the type poster. On phones, show a 160 to 200 px cover
  strip with the date stub above the title, keeping I'm in inside 664 px.
- **Files:** assets/css/components.css (`.photo--duo`), tools/make_event_pages.js, assets/css/pages/events.css,
  data/events.js (`cover.photo`, new `cover.lift`).

### genz-brand-17 · major · Vote: the most screenshot-able tiles have no share button, and the page is 22 screens long

- **Page:** vote.
- **Evidence:** the Dec 31 / Jan 1 tiles sit in the first screen (`$G/strips/vote-390-light-r0.png`), but the
  PSA share cards start at 15,141 px and the only `[data-share]` button is at 17,450 px of 18,799 px. The steps
  run from 4,325 to 7,705 px.
- **Fix:** put a "Send these 2 dates" button right under the tiles that opens the `psa-mail` / `psa-id` maker
  in a sheet at 9:16 (the serious styling stays on psa-id, with no confetti). Collapse the steps into a "How do
  you want to vote?" switch (by mail / early / on Election Day) showing 3 steps each, and aim for 10,000 px or
  less.
- **Files:** vote.html, assets/js/pages/vote.js, assets/css/pages/vote.css, data/pages/vote.js.

### genz-brand-18 · major · About reads like terms and conditions plus an unfinished org chart

- **Page:** about.
- **Evidence:** 10,579 px at 390. "What's real?" runs from 3,862 to 6,449 px (2,587 px of bullet lists), and
  "Who runs this thing" is 1,307 px of eight "Your President Here" placeholder cards; the page has 34 "DEMO"
  mentions (`$G/strips/about-390-light-r1.png`, `-r2.png`). The best bits, the "Real or DEMO? Test yourself"
  game and the city crews (Celery City Crew, SunRail Regulars), are buried between them.
- **Fix:** turn "What's real?" into three tiles (REAL / DEMO / NOT DECIDED YET), each with a count and a
  details disclosure, in 900 px or less. Replace the team grid with one "Seats open" card listing the roles as
  chips plus "Tell us you're curious". Move the city crews up, right after "Three jobs". Target 7,000 px.
- **Files:** about.html, assets/js/pages/about.js, assets/css/pages/about.css, data/pages/about.js, data/team.js.

### genz-brand-19 · major · Posting a clip is a long plain form with no preview and no examples

- **Page:** post (and the post sheet on clips).
- **Evidence:** 4,462 px of form fields with no visual (`$G/strips/post-390-light-r0.png`); post.js has no
  object-URL preview of the chosen file. Every upload flow Gen Z uses shows the clip while you write the
  caption, and Rare Beauty and Alo show UGC to inspire it.
- **Fix:** after a file is picked, show it in a 9:16 phone frame (object URL, never uploaded) with the caption
  overlaid as you type and a DEMO tag. Above the form, add a 3-poster "Good ones look like this" strip. Keep the
  three unchecked consents and the minors question exactly as they are, in plain words.
- **Files:** post.html, assets/js/pages/post.js, assets/css/pages/clips.css, data/pages/clips.js.

### genz-brand-20 · major · No ownable mark: the logo reads as a generic chat-app badge

- **Pages:** all (header, footer, cards, OG images, icons).
- **Evidence:** the mark is "YD" in a violet speech bubble and the wordmark is Bricolage Grotesque 800 set as
  plain type (partials/header.html line 4); the footer's giant "Young Dems" is the same font. Every leader in
  report 08 owns a mark or face (Starface's smiley, Liquid Death, Spotify Mix, Duolingo's feather and Duo);
  technique #3 asks for a custom lettered wordmark.
- **Fix:** draw a lettered "Young Dems" wordmark SVG (custom Y and D, a celery underline swoosh that echoes
  the marker swipe) and use it everywhere the brand appears. Optionally give the celery sticker a simple face
  as the brand's "big yellow": it signs the 404, empty states and the Thursday Letter P.S. (the mascot is an open
  question for Kira, report 08 §10.1).
- **Files:** partials/header.html, partials/header-es.html, partials/footer.html, partials/footer-es.html,
  assets/css/components.css (`.brand`), assets/icons/favicon.svg and PNG icons, assets/js/cards-brand.js and
  assets/js/cards-og.js (brand lockup), then tools/sync_partials.py.

### genz-brand-21 · minor · Join's first screen leads with dues

- **Page:** join.
- **Evidence:** the hero's only other action is "See how dues work" (`$G/strips/join-390-light-r0.png`).
- **Fix:** lead with the collectible: "See what you get" (your card and the sticker pack), and keep the dues
  link in the tiers band.
- **Files:** join.html, data/pages/join.js, es/join.html (regenerated).

### genz-brand-22 · minor · Reel posters flash black when swiped in

- **Pages:** home Reel, clips.
- **Evidence:** posters are set by an IntersectionObserver; after a full scroll of home, cards 3 and 4 in the
  horizontal strip still had `poster=""` (mail-ballot-renew, first-time-voter), and the full-page shots show
  black frames (`$G/strips/clips-390-light-r0.png`, frames 3 and 4). Video background is #0B0519.
- **Fix:** give each clip card its dominant colour (or a tiny inline blurred placeholder) as its background
  from data/clips.js, and observe the strip with a horizontal rootMargin.
- **Files:** assets/js/reel.js, assets/css/pages/clips.css, assets/css/pages/home.css, data/clips.js (via
  assets/video/make_demo_clips.py).

### genz-brand-23 · minor · Dated slang and clichés in clip captions

- **Pages:** clips, home Reel.
- **Evidence:** "POV: you just voted for the first time and the sticker hits different." (data/clips.js line
  160) and "new friends, questionable team names, zero regrets." (line 317). The voice dials allow slang at 2
  (members bring it), and report 05 warns against slang cosplay; "hits different" reads as 2021.
- **Fix:** "POV: you just voted for the first time and the sticker is going on everything."; "Trivia night
  recap: new friends, questionable team names, one very loud tiebreaker." Update the ES captions to match.
- **Files:** assets/video/make_demo_clips.py (SPECS captions), data/clips.js (regenerated).

### genz-brand-24 · minor · The LGBTQ+ freedom tile is the only bento tile without a number

- **Page:** issues.
- **Evidence:** the jump-tile grid leads with a big number on every tile ($1,890, 51 days, 60.37%, 30+, $15)
  except LGBTQ+ freedom (`$G/strips/issues-390-light-r0.png`), so it reads as missing data.
- **Fix:** use a sourced number if one exists; otherwise make it a deliberate words tile (the heart sticker
  and "Come as you are") styled so it looks intentional.
- **Files:** assets/js/pages/issues.js (jump tiles), assets/css/pages/issues.css, data/issues.js.

### genz-brand-25 · minor · The Reel at 1440 leaves almost half the viewport as empty night

- **Page:** clips.
- **Evidence:** a single 420 px clip column with a caption panel leaves about 45% of the width empty
  (`$G/strips/clips-1440-light-s0.png`, `-s1.png`).
- **Fix:** add an "Up next" rail of the next three posters on the right, or a two-up layout at 1280 px and wider.
- **Files:** assets/css/pages/clips.css, assets/js/pages/clips.js.

### genz-brand-26 · minor · The Thursday Letter is a wall of text

- **Page:** newsletter.
- **Evidence:** the letter runs from 1,600 to 2,883 px at 390, broken up only by a drop cap
  (`$G/strips/newsletter-390-light-r0.png`).
- **Fix:** add one pull quote ("He stayed until the polls closed.") and one inline sticker or photo moment.
  The letter itself stays calm: no emoji, one exclamation mark at most.
- **Files:** newsletter.html, assets/js/pages/newsletter.js, assets/css/pages/newsletter.css, data/newsletter.js.

### genz-brand-27 · minor · Recurring formats have generic series names

- **Pages:** events, quiz results ("Events made for you").
- **Evidence:** the series chips read "Trivia nights", "Karaoke nights", "Member mixers", "Creator nights"
  (`$G/strips/quiz__show-up__hype-captain-390-light-r0.png`). The event titles are good; the series are not
  brands. Report 08 technique #18: named formats get repeated.
- **Fix:** give each series an ownable name and use it on the cards, chips and the drop, for example "SunRail
  Social" (already in a title), "Riverwalk Hour", "Big Tree Picnic Club", "Creator Night" (already set as a
  poster). Voice-check against report 05 and §2.6.
- **Files:** data/events.js (series labels EN and ES), data/pages/events.js, assets/js/eventcard.js.

### genz-brand-28 · minor · The 404 laptop can't be shared as a card

- **Page:** 404.
- **Evidence:** the toy ends in "Send the group chat a link that works", which shares the page, not the laptop
  you decorated (`$G/flows/404-toy-6-light.png`).
- **Fix:** add "Send my laptop" to render the decorated lid as a 4:5 card with "6 of 10 Seminole stickers
  found" and the link. It's the one toy here people will want to show off.
- **Files:** assets/js/pages/about.js (toy), assets/js/cards-brand.js (new template), data/pages/about.js.

## Report 08's top 10 techniques: status

| # | Technique | Status | Finding |
|---|---|---|---|
| 1 | Finder and self-sort ending in a share card | Present; the card is thin, the landing isn't personalised, the OG is broken, and issue results aren't identities | 11 to 15 |
| 2 | Event drops and Partiful-grade invites | The drop is strong; the success moment is hidden and there is no story card | 08, 09, 16 |
| 3 | Group-chat share layer | Present on every page; the quiz OGs are broken and vote's share is buried | 15, 17 |
| 4 | Home Reel with one action per clip | Present; stock content and label clutter | 05 to 07 |
| 5 | Levels and streaks (now the sticker book) | Present; reward moments are text-only | 10 |
| 6 | Community wall and weekly prompt | Present; the post flow has no preview | 19 |
| 7 | Ask Claude chip | Correctly absent (cut by ruling 00) | n/a |
| 8 | Receipts in the nav | Replaced by "What's real?" and the scoreboard; about buries it | 18 |
| 9 | Collectibles | Sticker pack, member card, 404 laptop; no reveal, the laptop isn't shareable | 10, 28 |
| 10 | Tactile delight layer within budget | Strong (press, kinetic H1, ticker, view transitions) | keep |

Catalog techniques that are also missing or weak: #1 colour worlds (01), #3 ownable display face or wordmark
(20), #14 a leader vertical video (a DEMO "hey, I'm the chair" clip belongs in the re-cut, 06), #18 named
formats (27), #10 scroll-driven explainers (a "how your mail ballot travels" scrolly on vote would fit 17).

## Known items, not re-filed

Home Lighthouse LCP, long footer on phones, small people photos on home (finding 02 adds site-wide evidence
beyond home), English burned into Reel posters on es pages, rsvp.js double focus, the 1511632765486 bottle
photo, the seo.home.title format, the ticker Pause button overlapping city names.

## Evidence index

- Hero sameness: `$G/compare/hero-sameness.png`
- Home vs benchmarks: `$G/compare/home-d-vs-brands.png`, `$G/compare/bench-m-4s.png`, `$G/compare/home-hero-crop.png`
- Home maker: `$G/flows/home-maker-390.png`
- Reel: `$G/compare/clips-vs-poppi-gymshark-topicals.png`, `$G/compare/reel-posters.png`, `$G/compare/clips-poster-load.png`
- RSVP and join: `$G/compare/flow-rsvp-join.png`, `$G/compare/rsvp150.png`
- Quiz: `$G/compare/flow-quiz.png`, `$G/compare/quiz-result-scroll.png`, `$G/compare/quiz-vs-finders.png`, `$G/compare/results-first.png`
- OG images: `$G/compare/og.png`, `$G/compare/og-quiz.png`, `$G/compare/og-quiz2.png`
- Invites: `$G/compare/invite-vs-partiful.png`, `$G/compare/trivia-duotone-crop.png`, `$G/compare/ev-posters.png`
- Dark mode: `$G/compare/dark-d.png`
- Spanish spot check: `$G/compare/es-first.png`
- 404: `$G/flows/404-toy-6-light.png`, `$G/compare/404-vs-liquiddeath.png`
- Join: `$G/compare/join-vs-brands.png`
- Full pages and phone strips: `$G/shots/*.png`, `$G/strips/*.png`
