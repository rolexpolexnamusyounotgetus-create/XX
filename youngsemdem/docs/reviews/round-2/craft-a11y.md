# Round 2 review: craft, accessibility and performance

Reviewer lens: craft, accessibility, performance. Reviewed on Tue, Nov 10, 2026 against `docs/BRIEF.md` (§0, §3.9, §6b, §7.10), ruling 00 and round 1's `PLAN.md`. I did not edit any site file.

Evidence lives in the scratchpad: `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/r2ca/` (written as `SCR/` below). The scripts I ran are in `SCR/scripts/`, so any finding can be re-run.

## Summary

The automated floor is excellent. `qa.js --all` passes on 101 of 101 pages with no gate failures. axe found 0 serious or critical issues in 404 page runs and 0 in my 84 extra post-interaction runs (one dark-mode flag turned out to be a false positive). Reduced motion leaves 0 running animations on every page, and every first-view focus ring was present. On a throttled 4G phone our pages score 96 to 100 in the bench. The best benchmark scores 69 (Partiful), and we ship 5 to 55 times fewer bytes than every right-wing and brand site. Nobody on the benchmark list comes close on speed, weight, trackers or axe.

Below that floor, a human pass finds three WCAG 2.2 AA failures that the tools can't see, plus a set of visual defects at widths qa doesn't shoot (320 detail, 768, 1024):

1. **The Reel hijacks the keyboard** (blocking, WCAG 2.1.4, Level A). On `clips.html`, a stray `l` likes a clip and `m` turns the sound on for every video. Space, PageDown, Home and End are captured at document level, and End can never reach the footer.
2. **The site fails text spacing** (blocking, WCAG 1.4.12, Level AA). Apply the WCAG spacing values and the home H1 loses letters ("Local politic"). The post H1 loses "y?". Every Spanish header pushes the Menu button off screen at 390 px. Six pages scroll sideways at 320 px.
3. **The open phone menu hides focus** (blocking, WCAG 2.4.11, Level AA). The menu panel covers 682 of 844 px, but Tab walks on into the page underneath. Focus lands on hero buttons that can't be seen.
4. **Forced colours: no `forced-colors` CSS at all.** In Windows High Contrast, the hamburger icon disappears on every page.
5. **Visual defects.** At 320 px the hero ticket covers "Sanford" and "NOV". At 768 px the tentpole sticker eats the S of "SEMINOLE" on home and events. Equal-height carousels leave voids of up to 270 px (the vote key dates). At 768 px the heroes are the phone layout with half the hero empty.
6. **Focus theft.** The sticker reveal opens on a timer about 1.9 s after the success heading takes focus, on join and the quiz.
7. **Performance has no headroom.** `clips.html` and `post.html` sit at 30 of 30 requests and 446 and 436 KB of the 500 KB budget. §7.10's raw CSS and JS budgets are broken in 8 files.

Round 1 fixes I re-tested in this lens:

| Round 1 item | Status |
|---|---|
| genz-brand-08: toasts and confetti above the dialog | Holds |
| journeys-04: the language link keeps the query | Holds (`events.html?kind=learn` → `es/events.html?kind=learn`) |
| journeys-19: in-page jumps move focus | Holds (vote `#no-party` focuses its h2) |
| journeys-20: named error summary, focus to the summary | Holds on RSVP, join and post |
| journeys-26: Spanish 404 | Holds |
| genz-brand-25: 1440 Reel uses the space | Holds (side rail plus up-next list) |
| Pause button overlapping the ticker | Fixed |

Nothing from round 1 is re-filed.

## What I ran

| Check | Command or script | Result |
|---|---|---|
| Gates and scores | `node tools/qa.js --all` (320/390/1440, light and dark, scenarios, 4G perf) | 101 pages, 0 with gate failures, 16 of 16 gates on every page. 74 of 74 scenarios ran. 404 axe runs, 0 serious. Reduced motion 0 running everywhere. Focus rings 0 misses. Full output: `SCR/qa_all.txt`, `SCR/qa_report.json` |
| Head-to-head | `node tools/bench_compare.js --throttle 4g` on 13 of our pages plus both benchmark groups | 31 of 31 measured. `SCR/bench/bench.md` |
| DOM semantics, all 100 public pages | `SCR/scripts/sem.js` | 1 `main` and 1 `h1` per page. 0 heading-level skips, 0 unnamed controls, 0 duplicate ids, 0 broken ARIA references, 0 images without alt. `SCR/sem.json` |
| Keyboard tab walk, 16 pages at 390 | `SCR/scripts/tabwalk.js` | No focus loss to body. Rings present everywhere except the date-picker sub-stop. `SCR/tabwalk-390.json` |
| Component keyboard pass | `SCR/scripts/kbd.js`, `keys.js`, `reveal.js` | Covered the menu, theme, Pause motion, RSVP sheet, quiz, feed, ··· sheet, post, join, filters, Forget me, Real-or-DEMO, crew map, laptop toy, maker, language link. Findings 1, 3, 8, 11 and 12 |
| axe on opened and post-interaction states | `SCR/scripts/axestates.js` (28 states × 390 light, 390 dark and 1440 light) | 0 real serious issues; details in "axe on post-interaction states" below. `SCR/axe/axe-states.json` |
| Forced colours | `SCR/scripts/forced.js`, `forced2.js` | `SCR/tiles/forced-a.png`, `forced-b.png`, `forced-c.png` |
| 200% zoom (640 × 400) and WCAG text spacing at 320 and 390 | `SCR/scripts/zoom.js`, `spacing2.js` | Zoom: no overflow, sticky header 16% (clips 30%). Text spacing fails (finding 2) |
| file:// on all 100 pages | `SCR/scripts/filex.js` | 0 console errors and 0 failed requests, except 404 (`<base href="/">`, documented in BRIEF §4.11 as never opened from file://; not filed) |
| CLS re-measure (3 runs each, 4G) | `SCR/scripts/cls.js` | es/post 0.034 and es/issues 0.034 every run. qa's 0.046 on quiz/issue/wages did not reproduce (0.000 × 3) |
| Screenshots at 320, 390, 768, 1024 and 1440, light and dark, 16 pages | `node tools/shoot.js` | `SCR/shots/`, tiles in `SCR/tiles/` |

### qa.js scores by page

Every page scores 16 of 16 gates.

| Pages | 6b measured | Notes |
|---|---|---|
| `index.html`, `es/index.html` | 40/40 | B9 mail card at 988 px (limit 1,000). B10 Reel at 1,525 px. The fold at 1366 × 768 passes |
| `clips.html`, `events.html`, all 17 `events/*.html`, `join.html`, plus their `es/` twins | 32/32 | |
| `404`, `about`, `accessibility`, `conduct`, `content-policy`, `host`, `issues`, `newsletter`, `post`, `privacy`, `quiz`, `teen-safety`, `vote`, all 15 quiz results, plus their `es/` twins | 30/30 | |
| `offline.html`, `es/offline.html` | 29/30 | B16 = 1: no share button, which is fine on an offline page |
| `styleguide.html` | 28/32 | B4 = 1 (3 font files, 129 KB), B16 = 1, B37 = 0 (11 placeholder leftovers). Internal page, not linked from the nav |

### Performance on a 4G phone (qa)

| | Worst page | Every other page |
|---|---|---|
| LCP | 1.74 s (clips, video poster) | 0.63 to 1.45 s |
| CLS | 0.046 (quiz/issue/wages; did not reproduce) | 0.034 and under |
| TBT | 30 ms | |

| Page | First view (gzip-6) | Requests |
|---|---|---|
| Home | 297 KB of 350 | 27 |
| clips | 446 KB of 500 | 30 of 30 |
| post | 436 KB of 500 | 30 of 30 |
| Others | 202 to 304 KB | 20 to 28 |

### Head-to-head (bench, 4G, cold, 390 × 844 @2x)

| | Ours (13 pages) | Best right-wing | Best brand |
|---|---|---|---|
| Score | 96 to 100 | 61 (TPUSA) | 69 (Partiful) |
| Weight | 0.25 to 0.49 MB | 2.08 MB (YRNF) | 2.33 MB (Partiful) |
| Requests | 23 to 30 | 37 (Seminole GOP) | 69 (Partiful) |
| LCP | 0.6 to 1.5 s | 0.7 s (CRA) | 1.0 s (Partiful) |
| axe serious | 0 | 3 (Seminole GOP) | 0 (Rare Beauty, rhode, poppi, e.l.f.) |
| Overlay on first screen | none | 40% cookie banner (TPUSA) | up to 100% pop-ups |

## Per-page scores (craft, accessibility, performance)

90 or more means it would beat the best benchmark on this lens. Every page already beats every benchmark on raw speed and axe. These scores mark what holds each page back from a clean win.

| Page | Score | One line |
|---|--:|---|
| `index.html` | 84 | Fast and vivid. Loses points for the 320 ticket overlap, the 768 tentpole overlap, the H1 clipped under text spacing, and the menu focus |
| `events.html` | 85 | Rich, fast list. Tentpole overlap at 768, seven unnamed "I'm in" toggles, empty hero at tablet width |
| `events/*.html` (17) | 88 | Clean art-first invites with a solid RSVP sheet keyboard flow. Hurt by the shared "I'm in" semantics and the toast over the sheet |
| `host.html` | 84 | Strong kit. Copy-paste texts end in a 95-character UTM link, and the date focus disappears on the picker stop |
| `vote.html` | 82 | Clear and sourced. The first key-dates card is 490 px tall with about 270 px of nothing |
| `issues.html` | 80 | Big numbers. 16.5 phone screens long, voids in the number carousels, 9 identical "Source" toggles |
| `clips.html` | 72 | The best-looking feed, but the single-key shortcuts are a WCAG A failure, and the page sits at 30 of 30 requests |
| `post.html` | 82 | Good stepper and errors. H1 clipped under text spacing, 30 of 30 requests, deterministic CLS 0.034 in Spanish |
| `quiz.html` | 84 | Excellent focus management between questions. No h1 while playing, and the reveal steals focus 1.8 s after the result |
| `quiz/**` results (15) | 88 | Tidy and fast. Horizontal scroll at 320 under text spacing |
| `join.html` | 83 | Best form on the site. The reveal steals focus about 1.9 s after "Your card is live.", plus voids in the rules cards |
| `newsletter.html` | 88 | Rhythm fixed and calm. Minor clamp clipping |
| `about.html` | 85 | Game and map work by keyboard. Seven identical "Start this crew" links, overflow at 320 under text spacing |
| `404.html` | 86 | Delightful toy. Visible "tap me" isn't in the button's name (WCAG 2.5.3) |
| Legal pages (5) | 88 | Calm and solid. Numbered headings read "01Who's behind this?" |
| `offline.html` | 85 | Fine for its job |
| `es/*` | EN − 2 | Same as the English pages, plus the Spanish header overflowing under text spacing |

---

## Findings

Ranked by severity, then by reach.

### craft-a11y-01 · blocking · The Reel's single-key shortcuts fire anywhere on the page, and Home, End, Space and PageDown are hijacked

- **Page:** `clips.html` and `es/clips.html`.
- **WCAG:** 2.1.4 Character Key Shortcuts (Level A), and 2.1.1 in practice.
- **Evidence:** `SCR/scripts/keys.js`, 1440 × 900, focus on `<body>`:
  - `l` → the first clip's like flips to `aria-pressed="true"`.
  - `m` → every `<video>` goes from muted to unmuted, and the status region says "Sound on".
  - Space → toggles playback instead of scrolling.
  - PageDown → jumps to the next clip.
  - End → stops at scrollY 5,907 of 7,486. Pressing End again also stays at 5,907, so a keyboard user can never reach the footer with End.
  - The handler is `onKey` in `assets/js/feed.js:350-369`. It's bound to `document` because `clips.js:248` passes `keyboard: true` (not `'container'`), and the only guard is "feed on screen".
  - `clips.js:265-272` also replays these keys from the intent listener.
  - Speech-input users trigger `l` and `m` by dictating words.
  - The page also prints "Keys: J or K to move, Space to play or pause, L to like." on touch phones, where there is no keyboard (`SCR/tiles/clips-390-dark.png`, column 4).
- **Fix:**
  - Attach with `keyboard: 'container'`, so shortcuts work only when focus is inside the feed. `feed.js` already supports this. Give the feed `tabindex="0"`, `role="region"` and `aria-label="Clips, use J and K to move"`.
  - Never bind Home, End, PageDown or Space at document level.
  - Drop `m` from the letter shortcuts, or require focus on the video. A stray key must never turn sound on.
  - Hide the keys hint under `(hover: none)`.

### craft-a11y-02 · blocking · Text spacing clips headlines, pushes the Spanish Menu button off screen and adds horizontal scroll

- **Pages:** home (EN/ES), post, every `es/` page (the header), and events, quiz, join, about and quiz results at 320.
- **WCAG:** 1.4.12 Text Spacing (Level AA), which BRIEF §0.4 requires.
- **Evidence:** I injected the WCAG values (`line-height:1.5; letter-spacing:.12em; word-spacing:.16em; p{margin-bottom:2em}`). `SCR/scripts/zoom.js` and `spacing2.js`; screenshot `SCR/tiles/spacing.png`.

  | Where | What breaks |
  |---|---|
  | Home H1 at 390 | `span.kinetic__line` "Local politics" runs to right = 445 px and is clipped to "Local politic". At 320 it reads "Local politi". The "the fun kind" note lands on top of "group" |
  | Home hero at 390 | The eyebrow pill is clipped ("ages 1…"). The rotor bubble and "See what's on" are cut at the right edge |
  | `post.html` H1 | `.x-hl` "something to say?" runs to right = 449 and shows "something to sa" |
  | Spanish header | `button.menu-btn` "Menú" ends at right = 404 px at 390 (r = 328 at 320) on `es/join`, `es/events`, `es/vote`, `es/index` and every other `es/` page. The menu is half off screen and the page scrolls sideways |
  | Page width at 320 | events 371 px, quiz 376, join 353, about 352, `quiz/show-up/hype-captain` 371, `es/index` 393 |

  Causes:
  - `.kinetic__line { white-space:nowrap }` in `assets/css/components.css:562`.
  - `.x-hl { white-space:nowrap }` in `assets/css/pages/clips.css:304`.
  - `.site-header__actions` doesn't let the "Únete gratis" CTA shrink (`components.css:83-107`).
  - `.x-pick` (`quiz.css:61`) and `.x-pack__title` (`join.css:193`) have no `min-width:0` or wrapping.
- **Fix:**
  - Let kinetic lines and highlight spans wrap (`white-space:normal`; keep the marker on `box-decoration-break:clone`).
  - Size the H1 with `clamp()` against the container, not a no-wrap line.
  - In the header, let the CTA give way (for example hide `.site-header__actions .btn--primary` when the header overflows, via a container query or `max-width:359px`).
  - Add `min-width:0; overflow-wrap:anywhere` to card titles.
  - Add a text-spacing pass to `tools/qa.js` so this can't come back.

### craft-a11y-03 · blocking · The open phone menu isn't modal, and Tab walks into hidden content behind it

- **Pages:** every page at phone width (the menu is in `partials/header.html`).
- **WCAG:** 2.4.11 Focus Not Obscured (Minimum) (AA, new in 2.2).
- **Evidence:** `SCR/scripts/kbd.js` (menu); screenshot `SCR/kbd/menu-open-tabbed.png`.
  - With the menu open, the panel is `position:absolute`, top 117 px, height 682 px, on an 844 px screen.
  - After the 15 links plus ES and theme, Tab goes to "Pause motion", "Join free", "See what's on", the sun sticker and "Sunset walk-and-talk on Lake Monroe". All of them sit under the panel, and the focus ring is invisible.
  - `assets/js/ui.js` `ui.menu` (lines 395-410) has no focusout handling. Only Escape (line 1080) and outside clicks close it.
- **Fix:** Pick one.
  - Close the menu on `focusout` when focus leaves the header.
  - Or make the rest of the page `inert` while it's open and return focus to the toggle on close.

  Keep Escape.

### craft-a11y-04 · major · No forced-colours support: the hamburger icon disappears, and state relies on background fills

- **Pages:** every page, worst on phones.
- **Evidence:** `SCR/scripts/forced.js` (`forcedColors: 'active'`); screenshots `SCR/tiles/forced-a.png`, `forced-b.png`, `forced-c.png`.
  - The Menu button renders as an empty circle on every page. `.menu-btn__bars` and its `::before`/`::after` are drawn with `background:currentColor` (`components.css:128`), which forced colours repaint to Canvas.
  - The "38 of 60 seats saved" fill (`rsvp.css`, `.tentpole__seats`) and the quiz progress dots show no progress.
  - `grep forced-colors assets/css` finds 0 rules.
- **Fix:**
  - Add a `@media (forced-colors: active)` block to `components.css`. Bars get `background:ButtonText` with `forced-color-adjust:none`, or become an inline SVG using `currentColor`.
  - Selected chips and the segmented control get `outline:2px solid Highlight`. Progress fills get `background:Highlight`.
  - Add the same for `.x-progress__dots li[aria-current]` in `quiz.css`.

### craft-a11y-05 · major · At 320 px the home hero ticket covers "NOV" and the event's city

- **Page:** `index.html` and `es/index.html` at 320 px.
- **Evidence:** `SCR/tiles/home-320-card.png` (from `SCR/shots/index-320-light.png`).
  - The date stub ("14 / 4:45 pm") sits on top of the meta line, so "Sat, Nov 14 · 4:45 to 6:15 pm · Sanford" loses "Sanford".
  - The DEMO EVENT tag covers the stub's month "NOV".
  - Cause: the `@media (max-width: 359px)` rule `.p-home .x-tk__stub { position:absolute; right:10px; top:-18px }` in `assets/css/pages/home.css:335`.
  - BRIEF §0.4 requires the page to work at 320.
- **Fix:** At 320, keep the stub in flow (a two-column grid with a 54 px stub) or move it above the title row. Reserve room for the `.x-tk__kick` tag.

### craft-a11y-06 · major · At 700 to 999 px the tentpole sticker covers the S of "SEMINOLE"

- **Pages:** `index.html`, `events.html` and their es twins at 768 (and anywhere in 700-999).
- **Evidence:** `SCR/tiles/home-768-sunday.png`; `SCR/tiles/events-768-light.png`, first column.
  - The calendar sticker (`.tentpole__sticker`, 12vw ≈ 92 px, top/left 20 px) sits on the brand line, which reads "🗓EMINOLE".
  - `.tentpole__brand` grows to `13vw` ≈ 100 px and the poster aligns to the bottom, so the two collide.
  - The rules are in `assets/css/rsvp.css:195-203`.
  - The home override at `home.css:159` only applies below 700 px.
- **Fix:** In `rsvp.css`, give `.tentpole__poster` `padding-top: calc(var(--sticker-size) + 28px)` at those widths, or cap `.tentpole__brand` at `clamp(52px, 9vw, 112px)`, or move the sticker to the bottom-right.

### craft-a11y-07 · major · Equal-height carousel cards leave big empty slabs

- **Pages:** vote (key dates), issues (The numbers), join (sticker rules), home (The next thing to do).
- **Evidence:**
  - `SCR/tiles/vote-dates-both.png`: the first key-dates card (Dec 31) is 490 px tall at 390, and its content ends about 220 px in. That leaves about 270 px of empty card in both themes, on the page whose job is "two dates".
  - `SCR/tiles/issues-390-dark.png`: the rent and heat number cards have about 150 px voids.
  - `SCR/tiles/join-390-dark.png`, column 2: the Doors Open and Saved Seat cards have about 110 px between the text and "LOCKED".
  - Cause: grid and flex scrollers stretch every item to the tallest sibling (`.snap` in `components.css:59`; `.p-vote .x-date` in `vote.css:263` sets `align-content:start` but the card itself stretches).
- **Fix:**
  - Add `align-items:start` on these scrollers, or pin the action to the card bottom and let content define the height.
  - For the vote dates, `align-self:start` on `.x-date`.

### craft-a11y-08 · major · The sticker reveal opens on a timer and steals focus from the success heading

- **Pages:** `join.html` (after joining), `quiz.html` (after a result), home maker (first send).
- **Evidence:** `SCR/scripts/reveal.js`; screenshot `SCR/kbd/join-reveal-no-preference.png`.
  - Join: focus moves to h2 "Your card is live." at 430 ms. At 2,280 ms the `unlock` dialog opens and moves focus to "See your stickers". The same timing holds under reduced motion (124 ms, then 2,286 ms).
  - Quiz: `quiz.js:392` calls `YSD.stickers.act('quiz', { delay: 1800 })`. Focus goes from the result name to the dialog 1.8 s later.
  - In the keyboard pass on join, the dialog appeared mid-Tab and the next 12 Tab presses cycled inside it.
  - Screen-reader users hear the success heading cut off by a dialog announcement.
- **Fix:** Keep the collectible moment, change the trigger.
  - Render the unlock inside the success panel (a sticker tile with a "See your stickers" button), with no focus move.
  - Or make the reveal the success state itself: one focus move, not two.
  - If a dialog stays, open it only on a user action.
- **Files:** `assets/js/membercard.js` (`announce`, line 98), `assets/js/ui.js` (`ui.reveal`), `assets/js/joinform.js`, `assets/js/pages/quiz.js:392`.

### craft-a11y-09 · major · "I'm in" ×7 are toggle buttons that open a dialog and never say which event

- **Pages:** events, home, event pages (and es); about; issues.
- **Evidence:** aria snapshot via `SCR/scripts/names.js`.

  | Page | Repeated control names |
  |---|---|
  | events.html | "I'm in" ×7 |
  | index.html | "I'm in" ×5, "Join free" ×5 |
  | about.html | "Start this crew" ×7 |
  | issues.html | "Official site" ×8, "Join YDSC" ×4, plus 9 `<summary>Source</summary>` |

  - Each "I'm in" is `<a role="button" aria-pressed="false" href="join.html?e=…">I'm in</a>` (`assets/js/rsvp.js:801`).
  - A screen reader announces "I'm in, toggle button, not pressed" seven times. Activating it opens a modal dialog rather than toggling anything.
- **Fix:**
  - Remove `aria-pressed`. Add `aria-haspopup="dialog"` and `aria-describedby="<event title id>"`. Keep the RSVPed state in the visible label ("You're in"), which already changes.
  - Crew CTAs: add a visually hidden crew name ("Start this crew: Lake Mary").
  - Issues: label each source toggle and link ("Source for the $1,890 rent number", "Official site: voteseminole.gov").
- **Files:** `assets/js/rsvp.js`, `assets/js/eventcard.js`, `assets/js/pages/about.js` / `about.html`, `assets/js/pages/issues.js` / `issues.html`, `data/pages/about.js`, `data/pages/issues.js`.

### craft-a11y-10 · major · The 404 toy's visible "tap me" isn't part of the button's name

- **Page:** `404.html` and `es/404.html`.
- **WCAG:** 2.5.3 Label in Name (Level A). Low impact, one-line fix.
- **Evidence:**
  - Markup: `<button class="x-toy__btn"…><span class="sticker…"></span><span class="x-toy__tap" aria-hidden="true">tap me</span></button>` (`404.html:130`).
  - The script sets `aria-label="Slap the heart sticker on the laptop"`; in Spanish the visible "tócalo" is likewise missing from the name.
  - A voice user saying "tap me" gets nothing.
- **Fix:** Start the name with the visible words: "Tap me: slap the heart sticker on the laptop" ("Tócalo: pega el sticker…"). Or drop the `aria-label` and use visually hidden text after "tap me".
- **Files:** `assets/js/pages/about.js` (the toy label builder), `data/pages/about.js` (`toy.tap` plus the label key).

### craft-a11y-11 · minor · Pause motion uses aria-pressed and also swaps its label

- **Pages:** home (rotor and ticker), every page with motion.
- **Evidence:**
  - `SCR/scripts/kbd.js` (motion): after Enter, the button reads "Play motion", `aria-pressed="true"`.
  - A screen reader announces "Play motion, toggle button, pressed", which contradicts itself.
  - `assets/js/ui.js:438-447` (`paintMotion`) sets both.
- **Fix:** Pick one pattern. Either keep the label "Pause motion" constant with `aria-pressed`, or keep the label swap and drop `aria-pressed`.

### craft-a11y-12 · minor · No `h1` while the quiz is being played

- **Page:** `quiz.html` and `es/quiz.html`.
- **Evidence:** axe `page-has-heading-one` (moderate) in the mid-quiz state at 390 light and dark and 1440 (`SCR/axe/axe-states.json`, state `quiz.html@mid-quiz`). The hero h1 is hidden while the player shows; the question is an h2.
- **Fix:** Keep a visually hidden h1 ("Which Young Dem are you?") while the player is open, or promote the player title to h1 during play.
- **Files:** `assets/js/pages/quiz.js`, `quiz.html`, `assets/css/pages/quiz.css`.

### craft-a11y-13 · minor · No performance headroom: clips and post at 30 of 30 requests, with §7.10's raw budgets broken

- **Pages:** clips, post, home; the CSS and JS budget files.
- **Request count and weight:**

  | Page | qa first view | Requests | bench (load + 5 s quiet) |
  |---|---|---|---|
  | `clips.html` | 446 KB of 500 | 30 of 30 | 474 KB |
  | `post.html` | 436 KB of 500 | 30 of 30 | 464 KB |
  | `index.html` | 297 KB of 350 | 27 | 342 KB of 350 |

  One more script or poster fails gate B1.

- **§7.10 raw budgets broken:**

  | Budget | Limit | Actual |
  |---|---|---|
  | `tokens` + `base` + `components` + `utilities` | 60 KB | 83.1 KB (`components.css` alone is 64.8 KB) |
  | Page CSS | 25 KB | `home.css` 35.6, `clips.css` 33.2, `vote.css` 26.9, `quiz.css` 25.6, `about.css` 25.3 |
  | Page JS | 40 KB | `pages/quiz.js` 40.6, `pages/vote.js` 40.4 |

- **Fix:**
  - On clips and post: merge `reel.css` into `clips.css`, defer `feed.js` / `cards*.js` until first use, and load the post examples' posters lazily. Target 26 requests or fewer.
  - Split the home and clips CSS into above-the-fold and lazy parts.
  - Move styleguide-only and maker-only rules out of `components.css`.
  - Or ask the lead to formally re-baseline §7.10.

### craft-a11y-14 · minor · Deterministic layout shift of 0.034 on Spanish post and issues

- **Pages:** `es/post.html`, `es/issues.html` (also visible on the English pages at smaller values).
- **Evidence:** `SCR/scripts/cls.js`, 3 runs each at 4G.
  - `es/post`: 0.033 at about 1.2 s, every run. The sources are `.x-examples`, `.lead` and `.btn-row`.
  - `es/issues`: 0.018 plus 0.016 from `.x-chip` and `.x-sheet`.
  - That's 68% of the 0.05 gate, and it's consistent, so it's real.
  - Likely cause: the examples strip and the bento mount after the fonts, so longer Spanish lines re-wrap.
- **Fix:** Reserve height for `.x-examples` and the bento (`min-height` or `aspect-ratio`), or render them server-side in the HTML.
- **Files:** `assets/css/pages/clips.css` (post section), `assets/js/pages/post.js`, `assets/css/pages/issues.css`, `assets/js/pages/issues.js`.

### craft-a11y-15 · minor · Host kit copy-paste texts end in a 95-character UTM URL

- **Page:** `host.html` and `es/host.html`.
- **Evidence:**
  - `SCR/shots/host-390-dark.png`, column 4: each of the four invite texts and the access note ends with `http://…/events.html?utm_source=share&utm_medium=social&utm_campaign=youngsemdems`, which wraps to three lines.
  - These are "Invite texts that sound like you", but a friend reading one sees a marketing link.
  - The card maker already prints a pretty link (`127.0.0.1:…/events/renew-ready-party.html`).
  - Cause: `link()` at `assets/js/pages/host.js:27`.
- **Fix:** Use a copy-paste link without utm (a `YSD.share.url(path, {utm:false})` option in `assets/js/share.js`), keeping `ref`.

### craft-a11y-16 · minor · The RSVP success toast lies over the sheet header and repeats the sheet's own sentence

- **Pages:** every RSVP surface.
- **Evidence:**
  - `SCR/axe/rsvp-cancel-dark.png`: the toast "Seat saved. Add it to your calendar so future you remembers too." covers the top 80 px of the dialog edge and the DEMO banner.
  - The sheet prints "Add it to your calendar so future you remembers too." 380 px lower.
- **Fix:** Skip the toast when the sheet itself shows the success (or make it say only "Seat saved."), and dock `.toast-region--dialog` to the bottom inside the sheet.
- **Files:** `assets/js/rsvp.js`, `assets/css/components.css` (`.toast-region--dialog`).

### craft-a11y-17 · minor · At 768 px the heroes are the phone layout with half the hero empty

- **Pages:** home, events (also join and about) at 700-999 px.
- **Evidence:**
  - `SCR/tiles/index-768-light.png`: the polaroid is about 380 px, centred under the CTAs, with the right half of the violet hero empty beside the H1.
  - `SCR/tiles/events-768-light.png`: the ticket stack is about 160 px wide on the left, with 55% of the celery hero empty.
  - Tablets and small laptops are where judges and chapter boards often look.
- **Fix:** Add a two-column hero at `min-width:700px` (text left, art right), as the 1440 layout already does.
- **Files:** `assets/css/pages/home.css`, `assets/css/pages/events.css` (also `join.css`, `about.css`).

### craft-a11y-18 · minor · The phone footer uses three cramped link columns

- **Pages:** every page at 390 (from `partials/footer.html`).
- **Evidence:**
  - `SCR/tiles/index-390-light.png`, last column: "Seminole County Democratic Party" wraps to 4 lines and "Supervisor of Elections" to 2.
  - The columns are ragged and the gutters are tight.
  - Round 1's plan asked for two columns of links on phones.
- **Fix:** Use `grid-template-columns:repeat(2, minmax(0,1fr))` below 480 px in `.site-footer__nav`, and shorten the county-party label to "Seminole Democrats" with the full name in `title` (or keep it full width).
- **File:** `assets/css/components.css`.

### craft-a11y-19 · minor · `issues.html` runs 16.5 phone screens, with three to four buttons under "One thing you can do"

- **Page:** `issues.html` and `es/issues.html`.
- **Evidence:**

  | Page | Height at 390 | Phone screens (844 px) |
  |---|--:|--:|
  | `issues.html` | 13,915 px | 16.5 |
  | `es/issues.html` | 15,266 px | 18.1 |
  | `events.html` | 11,748 px | 13.9 |
  | `host.html` | 11,078 px | 13.1 |
  | `privacy.html` | 10,238 px | 12.1 |

  - Vote was capped at 12 screens in round 1; issues wasn't.
  - Each issue's "One thing you can do" stacks 3 to 4 buttons (`SCR/tiles/issues-390-dark.png`).
- **Fix:** Collapse "The numbers" and "What we're doing" into disclosures (as vote did), and keep one primary action plus one link per issue.
- **Files:** `issues.html`, `assets/css/pages/issues.css`, `assets/js/pages/issues.js`, `data/pages/issues.js`.

### craft-a11y-20 · minor · Legal headings read "01Who's behind this?"

- **Pages:** `privacy.html` and the other legal pages (EN/ES).
- **Evidence:** `SCR/sem.json` outline for privacy: "h2 01Who's behind this?", "h2 02Is anything being sent right now?"… The number pill is a sibling span with no space and no `aria-hidden` (`assets/js/pages/legal.js:121`).
- **Fix:** Add `aria-hidden="true"` to `.legal__num` (the list order already conveys it), or add a visually hidden separator.
- **File:** `assets/js/pages/legal.js`.

### craft-a11y-21 · minor · The date and time inputs lose their focus ring on the picker stop

- **Page:** `host.html` (any `input[type=date|time]`).
- **Evidence:**
  - `SCR/tabwalk-390.json`, host stops 30 and 34: the field's outline computes to `none` when focus is on the calendar or clock sub-button.
  - Only Chrome's tiny icon highlight shows (`SCR/focus/host-date-light.png`).
- **Fix:** Add `:where(input[type=date], input[type=time]):focus-within { outline:3px solid var(--focus); outline-offset:1px }` in `assets/css/base.css`.

## Checked and fine

- **axe on post-interaction states:** 0 real serious issues across 28 states (menu open; the clips ···, filter, prompt, how, post and report sheets; vote dates sheet; all 39 vote disclosures open; RSVP errors and success; events empty filter; join errors and joined plus reveal; post errors and step 2; mid-quiz; issue result; Real-or-DEMO answered; Forget me confirm; laptop decorated; host cards drawn; newsletter errors; `?ref` landings; ES variants).
- **The one flag was a false positive:** axe reported 1.22:1 contrast on "Can't make it anymore" in the dark RSVP success state. Visually it's cream on night (`SCR/axe/rsvp-cancel-dark.png`); axe read the celery ticket scrolled underneath the sticky footer. To keep audits clean, give `.rsvp-sheet` footer an explicit `background-color`.
- **Live regions:** the toast `role=status`, the events count, the vote checklist count, the host checklist progress, the about game score, the laptop facts and the Reel play/pause/sound announcements are all present and fire.
- **Dialogs:** every sheet opens with focus inside, Tab is contained, Escape closes, and focus returns to the opener (it lands on the updated "You're in" button after an RSVP).
- **Errors:** forms move focus to the error summary, and `aria-invalid` plus `aria-describedby` are wired (RSVP, join, post, newsletter).
- **Quiz:** focus moves to each new question heading. Option letters are `aria-hidden`. Picture options have names.
- **Images:** alt text is specific and honest ("Three friends seen from behind, arms up, watching the sun set from a rooftop"). Decorative characters use `alt=""`.
- **Video:** muted by default, no autoplay under reduced motion, captions as HTML chips plus a transcript in the ··· sheet, and `aria-label` on every video.
- **Zoom:** at 200% (640 × 400) there is no overflow, and the sticky header covers 16% (30% on clips with its bar).
- **Dark mode:** no unthemed white areas in 16 pages × 5 widths. The cream surfaces in dark (bubble, ticket, sheet buttons) read as deliberate.
- **Colour worlds** hold in both themes.
- **file://:** 0 errors on 98 pages (404 excluded by design, BRIEF §4.11).
