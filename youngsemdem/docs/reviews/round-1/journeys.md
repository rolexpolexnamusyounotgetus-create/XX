# Round 1 review: end-to-end user journeys

Reviewer lens: **journeys**. I drove real flows in Playwright Chromium on Monday, Nov 9, 2026: at 390 x 844 (touch,
`isMobile`, `hasTouch`) and at 1440 x 900; over http (`tools/check_site.js` server with the `_headers` CSP, port
8731), over `python3 -m http.server` (port 8732) and over `file://`; in EN and ES. I edited no site files. Scripts and
116 screenshots are in the scratchpad:
`/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/journeys/` (screenshots under
`.../journeys/shots/`, scripts `jA.js` to `jH.js`, `jF*.js`, `j404.js`, `jCard.js`, `jToast.js`).

## Summary

The plumbing mostly works. A friend's link is captured on every page, the RSVP sheet is quick, and `referredBy`
carries into the join payload over http, file://, EN and ES. The .ics files are right: TZID America/New_York, a
VTIMEZONE block, Nov 19 at 7 pm, which is 00:00Z on Nov 20 in the Google link, with a 3-hour alarm. The January reminder is
Mon, Jan 4, 2027 at 10:00 am ET. All 13 `data-cfg-href` vote links resolve to config. Pending clips survive a reload
and Forget me wipes localStorage and IndexedDB. Theme persists everywhere. 404 renders from five-level-deep paths.
I found no horizontal overflow on any journey screen and no console errors.

The loop still breaks in the places that matter most for growth and for safety:

1. **Safety (blocking).** An uploaded clip drops every moderation answer. A teen who says "yes, a minor is in this
   clip" and types a guardian email ends up with `needsGuardian:false, consents:[]`, so in production the upload
   skips the guardian gate. The RSVP sheet also collects name and contact with no age screen, which breaks the
   published promise "we never collect info from anyone under 13". And the invite banner names a DEMO event with no
   DEMO label.
2. **The viral loop has holes (major).** A member's own link never carries `from`, so a friend sees "A friend
   invited you", not "Sam invited you". The member card shows the link but has no Copy or Share button. The RSVP
   success screen never offers "get your link", so the "+1 a friend" link has no ref. The squad meter can never
   move in the demo, on one device or two. The language toggle drops the hash and query on 86 of 86 http
   transitions and 84 of 84 file:// ones, so a Spanish-speaking invitee who taps ES loses "Kira te invitó".
3. **Dead ends and confusing steps (major).** Five quiz result chips ("Neighbor check-ins", "New member mixers",
   SunRail, karaoke, picnic) land on "0 events (DEMO) · Nothing matches that one · No events this week" because
   those series sit behind the Dec 15 drop. "Pick your city and issues" lands on a "Join free." hero with step two
   below the fold. The desktop join success leaves a 650 px empty violet void with "Join free." still as the
   headline. `join.html?e=<id>`, the fallback behind every "I'm in", forgets the event.

Fix the three blocking items and the loop items (04, 06, 07, 08, 09). The journeys would then match Partiful on
invites and beat every right-wing site on the closed loop, which none of them have.

## Taps to the key goals (390 x 844, touch)

| Goal | Path | Taps | Note |
|---|---|---|---|
| RSVP from a friend's link | landing "I'm in" → first name → contact → Save my seat | **4** + typing | Partiful-grade. Count rises at once (31 → 33 with +1). |
| Join right after that RSVP | header Join free → name → contact → age → Join | **5** | Name and contact typed a second time (finding 10). Could be 2. |
| Join cold | header Join free → 3 fields → submit | 5 | Newsletter compact form: 4. |
| Make a card (home maker) | first name → Send it to the group chat | **2** | The maker is at about 3,176 px. On the quiz, the card is already rendered: 1 tap to share. |
| Quiz to result | Find your issue, quick mode | 5 from quiz.html, **6 from home** | Show-up quiz: 9. Home "Start the quiz" needs an extra tap (finding 16). |
| Voting plan | Make my plan → 6 answers | 7 (+1 for the .ics) | Works. Plan saved locally. |
| January reminder | Add the January reminder | **1** | Correct .ics (Jan 4, 2027, 10 am ET). |
| Renew info | home "How to renew" or vote hub "Renew online" | **1** | Both go to official links from config. |
| Student-ID card | Send it to the group chat / Save the image | 1 | Without Web Share it saves the PNG (216 KB). |
| Post a clip (upload or link) | file → captions → caption → age → minors → 3 consents → Send | 9 | Age is skipped when the member's age is known. |
| Newsletter → step two saved | 3 fields + submit, then Pick your city → city → issue → Save | 4 + 4 | Step two is below the fold on arrival (finding 11). |
| Forget me | Forget me on this device → Yes, forget me | 2 | Inline confirm. Everything gone, including IndexedDB. |

## Per-page scores (journeys lens; 90+ = would beat the best benchmark)

| Page | Score | One line |
|---|---|---|
| Event / invite page (`events/<id>.html`) | 80 | Fast RSVP, correct .ics/Google/Outlook, honest counts. The invite banner duplicates the hero, and success has no join hook. |
| Vote hub (`vote.html`) | 82 | Plan, reminder, renew and ID card all work in 1 to 7 taps. A mail voter's plan .ics labels the 7 pm arrival deadline "Vote:". |
| Privacy / Forget me (`privacy.html`) | 84 | A live device inventory and a real wipe (localStorage + IndexedDB). Best-in-class. |
| Home (`index.html`) | 76 | Invite banner, 4-tap RSVP and a 2-tap card maker. The banner shows a demo event with no DEMO tag, and the share feedback is swallowed. |
| Quiz + result pages | 72 | Quick and fun, and the card is pre-rendered. Five "Events made for you" chips dead-end, and `#show-up` doesn't start the quiz. |
| Post / Reel posting (`post.html`, `clips.html`) | 64 | Smooth flow, and the pending card persists. But uploads lose consent, minor and guardian data (blocking). |
| Join + member card (`join.html`) | 62 | `referredBy` carries. No copy button on the card, no `from`, a squad meter that can't move, and a broken desktop success layout. |
| Newsletter → step two (`newsletter.html`) | 66 | 4-tap signup. `#more` lands on the wrong part of the page. |
| Events list, filtered (`events.html?series=`) | 60 | The filter chip works, but several quiz routes end at "0 events" with "No events this week". |
| 404 | 78 | Renders at any depth with a working toy and links. Production Spanish 404 is wired in `netlify.toml`; the local server doesn't mimic it. |
| Global language toggle (every page) | 52 | The right page in 100% of cases. Anchor and query lost in 100% of cases. |

## Findings

Severity follows the brief: blocking = safety, legal, §0, data loss or a broken flow; major = a dead end, a
confusing step, a missing hook or a loss to a named benchmark; minor = polish.

### Blocking

#### journeys-01 · Clip uploads drop every consent, minor and guardian answer (teen-safety gate bypassed)
- **Where:** `post.html` and the post sheet on `clips.html`.
- **Evidence:** As a 16-year-old member I uploaded `test-clip.webm`, ticked captions, answered **Yes** to "Does
  anyone under 18 appear in this clip?", typed `mom@example.com` as the guardian contact and ticked all three
  consents. The stored record (`ysd:clips:local[0]`) reads
  `{"captionsConfirmed":false,"containsMinors":null,"needsGuardian":false,"guardianContactProvided":false,"consents":[]}`.
  The cause is `assets/js/pages/post.js` line 266, `YSD.clips.add(fileIn.files[0], { caption: caption, tags: tags })`:
  none of the moderation fields reach `clips.js`, even though `clips.js` (lines 680 to 749) accepts them. Then
  `clips.upload()` (line 881) checks `if (rec.needsGuardian && !guardian)`, so in production a clip showing a minor
  uploads with no guardian contact, and the moderation queue sees "no consents, no captions". Link submissions
  (`clips:links`) store these fields correctly, so only uploads are broken.
- **Fix:** Pass `{ caption, tags, captionsConfirmed: true, containsMinors: minors, guardianContact: <field value>,
  guardianRequired: guardian, consents }` to `YSD.clips.add`. Add a test to `tests/infra/video.test.js`, or a page
  test, that posts with minors = yes and asserts `needsGuardian === true`.

#### journeys-02 · The RSVP sheet collects name and contact with no age screen, contradicting the published minors policy
- **Where:** Every "I'm in" (`assets/js/rsvp.js` `build()`).
- **Evidence:** The join form screens age neutrally: at 13 it shows "Members need to be at least 14. We didn't
  save anything you typed" and stores only the inviter's `ysd:ref`. The RSVP sheet, which also collects
  personal info, asks nothing about age. Its only age control is the checkbox "I'm under 18", which the FTC FAQ
  that `docs/legal/MINORS_POLICY.md` cites calls *not* a neutral screen. A 12-year-old who taps "I'm in" on a
  friend's link has first name and phone stored in `ysd:rsvp:<id>`; in production `YSD.rsvp.submit` POSTs them. The
  policy shown on `teen-safety.html` says: "we never collect info from anyone under 13" and "Under 13: Not accepted.
  We don't collect any info."
- **Fix:** Add the same free-entry "How old are you?" field (`legal.snippets.ageLabel`/`ageHint`). Skip it when the
  member record has an age. Under 14: show `ageTooYoung`, store and send nothing. 14 to 17: set `under18` from the
  age and drop the checkbox. Brief §5.4 specified the checkbox, so note the change in `docs/BRIEF.md` §5.4 too.
- **Files:** `assets/js/rsvp.js`, `data/events.js` (`rsvpForm.fields`), `data/slices/core.js` (reuse the join age
  strings), `docs/BRIEF.md`.

#### journeys-03 · The invite banner names a demo event and a person with no DEMO label (§0.2, B30 gate)
- **Where:** `[data-invite-landing]` on home, events and every event page, in EN and ES.
- **Evidence:** It renders "Kira invited you · to Trivia night: Seminole County edition · Thu, Nov 19 · 7 to 9 pm ·
  Free, no account needed" and in ES "Kira te invitó a Noche de trivia: edición condado de Seminole · jue 19 de nov".
  There is no DEMO tag anywhere in the banner (`shots/a-home-landing-390.png`). The site banner above it says
  "Anything marked DEMO is made up", which implies that what isn't marked is real. On home, nothing below the
  banner on the first screen labels the event either. The RSVP sheet and event hero do carry "DEMO EVENT", so this
  is the one gap.
- **Fix:** Add `tag tag--demo` ("DEMO event" / "Evento DEMO") inside `.invite-landing__what` whenever
  `event.demo !== false`.
- **Files:** `assets/js/rsvp.js` (`landing()`), `assets/css/rsvp.css`.

### Major

#### journeys-04 · The language toggle drops the anchor and the query on every page, so the invite and the filters are lost in Spanish
- **Evidence:** `jF.js` opened all 43 EN pages and their ES twins with a real section hash and clicked the header
  ES/EN link: 86 of 86 over http and 84 of 84 over file:// (404 excluded) kept the page but lost the hash. With a
  query: `events/trivia-county-edition.html?ref=KIRA7QX&from=Kira&e=trivia-county-edition` → ES →
  `es/events/trivia-county-edition.html` with no banner (the "Kira invited you" landing is gone).
  `events.html?series=trivia` → `es/events.html` (filter gone). `vote.html#renew-mail-ballot` → `es/vote.html` (lands
  at the top). The cause is `assets/js/ui.js` `ui.langHref()`, which does `split('#')[0].split('?')[0]` and is
  computed once on load. Sofía's persona (a bilingual first-timer whose parents read Spanish) is exactly who taps
  ES after opening a friend's link.
- **Fix:** Keep `location.search` minus `ref`/`utm_*` (ref is already captured), so `e`, `from`, `series`, `kind`
  and `tag` survive. Append the current hash. Recompute on `hashchange` and on pointerdown/click of `[data-lang-link]`
  (at click time, use the id of the nearest section in view so the reader stays in place).
- **Files:** `assets/js/ui.js`.

#### journeys-05 · "Events made for you" sends five quiz results to an empty list
- **Evidence:** Door-Knock Natural → first chip "Neighbor check-ins" → `events.html?series=canvass` → "Only showing
  Neighbor check-ins × · **0 events (DEMO)** · Nothing matches that one · No events this week. Rest counts too."
  (`shots/b-http-phone-en-show-up-04-events-filtered.png`). Mapping `data/quiz.js` to `data/events.js`: `canvass`,
  `mixer`, `sunrail`, `karaoke`, `picnic` and `workshop-es` exist only in 2027, so they are hidden until the Dec 15
  drop. Affected: Door-Knock Natural (first chip), Plus-One (first two chips), Hype Captain (2 of 3), Creator
  (2 of 3), Spreadsheet Witch (1 of 3), and the issue results Rent and housing, Wages (only chip: mixer) and
  Transit (only chip: sunrail). The "Start here" action "Try a neighbor check-in shift" goes to the same empty
  page. The empty-state copy is also wrong in context ("this week").
- **Fix:** In `assets/js/pages/quiz.js`, only render series chips that have a visible event (the same filter
  `nextEvent()` already uses). Fall back to `?kind=`. For a series that exists only after the drop, render "Back in
  January's lineup (drops Tue, Dec 15 at noon, DEMO) · Notify me". In `assets/js/pages/events.js`, when a
  `?series=` filter is empty but drop events match, show the drop card and Notify me .ics *inside* the empty state,
  with copy like "Neighbor check-ins come back in January's lineup".
- **Files:** `assets/js/pages/quiz.js`, `assets/js/pages/events.js`, `data/pages/events.js`, `data/quiz.js` (if
  series need re-mapping).

#### journeys-06 · The squad meter can never move in the demo, and "Start over" corrupts attribution
- **Evidence:**
  - Two browser contexts: Sam joins (ref `SAM78D`); a friend opens Sam's link in a second context and joins with
    `referredBy: "SAM78D"`. Sam's meter still reads "0 of 3" with the hint "DEMO: only joins on this device count,
    and nobody here is simulated."
  - The same device: Sam's link in a new tab shows "You're already in, Sam." (the own-code capture is ignored).
    "Not Sam? Start over" calls `YSD.members.forget()`, which deletes the whole `joins` log (Sam's entry
    included) and restores the arrival ref `KIRA7QX`. Ana then joins with **`referredBy: "KIRA7QX"`, not Sam's
    code**, and Sam's record is gone.
  - So there is no path in the demo that fills the meter. A reviewer will think it's broken, and the "Plus-One"
    and "Squad of Three" stickers are unreachable.
  - Start over also leaves Sam's stickers, streak and RSVPs for the next person.
- **Fix:**
  - `joinform.js` `reset()`: archive the previous member into `joins` (keep the log) instead of
    `members.forget()`, and clear `ref` when it equals the previous member's own arrival code.
  - When a second person joins on the same device through the first member's link, their `referredBy` should be
    that link's ref. Either re-capture `ref` from the current URL after Start over, or stop ignoring an own-code
    ref once the member is forgotten.
  - Clear stickers, streak and RSVPs on Start over, or ask first.
  - Reword the hint so it describes a reachable demo ("DEMO: to try it, open your link in another tab, tap 'Not
    Sam? Start over' and join as a friend.").
- **Files:** `assets/js/joinform.js`, `assets/js/members.js`, `assets/js/share.js` (`captureRef` own-code rule),
  `assets/js/membercard.js`, `data/sharekit.js` (`meter.demoHint`).

#### journeys-07 · The member card shows your link but you can't copy or share it from the card
- **Evidence:** The card section (`#card`, at about 5,481 px on phone; "See your card" jumps there) prints
  `127.0.0.1:8731/join.html?ref=SAM78D` in a `<code>`. Its only actions are "Member card · Save image" and "Reset
  DEMO stickers" (`out.cardActions`), with nothing to copy or send next to the link. A visually hidden prefix reads
  "Copy link: " before the `<code>`, so a screen reader announces a copy control that doesn't exist. The only share
  button on the page ("Send it to the group chat") sits in the "What happens next" section about 440 px above the
  card (`shots/a-joined-card-crop.png`).
- **Fix:** Add "Copy my link" and "Send it to the group chat" buttons right under the link on the card
  (`YSD.share.copy` / `YSD.ui.share({page:'join', url})`), plus `sms:` and WhatsApp like the maker. Drop the fake
  "Copy link:" label or make the link a real button. The `fallbackCard()` in `joinform.js` already has this pattern.
- **Files:** `assets/js/membercard.js`, `assets/css/maker.css`.

#### journeys-08 · Adult members' links never carry `from`, so friends see "A friend invited you"
- **Evidence:** The member card link, the join-page share, the home maker after "Get your link" and quiz result
  shares all produce `...?utm_source=share&...&ref=SAM6M5` with no `from`. The friend's landing reads "A friend
  invited you to the Young Dems" (`shots/a2-http-phone-en-friend-landing.png`). Only the RSVP "+1" link adds
  `from=Sam`. Brief §5.1: `from` is added "when the sender ticks 'Show my first name on the invite' (on by default
  for adults)". The W5 member card has no such toggle; the W6 fallback card had one.
- **Fix:** Add the "Show my first name on my link" toggle (default on for 18+, forced off under 18) to the member
  card and the maker, store it on the member, and pass `from` from one helper (say
  `YSD.members.shareParams()`) everywhere a member link is built.
- **Files:** `assets/js/membercard.js`, `assets/js/maker.js`, `assets/js/pages/join.js`, `assets/js/pages/quiz.js`,
  `assets/js/members.js`.

#### journeys-09 · The RSVP success screen has no "join / get your link" hook, so the +1 link carries no ref
- **Evidence:** After "Seat saved." the sheet offers calendar, "+1 a friend", "Text this to a friend", Done, Change
  and Can't (`shots/a-http-phone-en-index_html-04-rsvp-done.png`). Nothing invites the person to join or get their
  link. The +1 link is
  `events/trivia-county-edition.html?utm_source=share&...&e=trivia-county-edition&from=Sam`: **no ref**, so anyone
  Sam brings can't be credited to Sam. To join, the user has to find the header button themselves (1 extra tap, a
  new page, then retyping everything). This is the brief's loop step "RSVP → join" (§5) and B20.
- **Fix:** In the success state, add a "Want credit when friends come? Get your link: one more question (age)"
  block that calls `YSD.members.join` with the RSVP's name and contact plus an age field, then refreshes the +1
  and sms links so they carry the new ref.
- **Files:** `assets/js/rsvp.js`, `assets/css/rsvp.css`, `data/events.js` or `data/slices/core.js` (copy, EN + ES).

#### journeys-10 · The join form ignores the name and contact the visitor just gave in the RSVP
- **Evidence:** After an RSVP as Sam / sam@example.com, `join.html#join-form` showed
  `firstName=, contact=, age=` (`out.prefill`). The user types both again: 5 taps instead of 2. The reverse works
  already: the RSVP sheet pre-fills from the member record (the 16-year-old test showed
  `firstName=Ava, contact=+14075550199`).
- **Fix:** In `joinform.js` `mount()`, when there's no member, pre-fill `firstName` and `contact` from the most
  recent `rsvp:*` record on this device. The values are the visitor's own (never made up), and age stays blank as
  policy requires.
- **Files:** `assets/js/joinform.js`.

#### journeys-11 · Newsletter "Pick your city and issues" lands on the "Join free." hero; step two is below the fold
- **Evidence:** After the 4-tap signup, the success panel's button goes to `join.html#more`. There is no
  `id="more"` on the page, so the browser stays at `scrollY 0` with focus on `<body>`. The first screen shows
  "Join free. We saved you a seat." and "You're already in, Sofi." Step two ("Make it yours") starts at 933 px
  (`shots/e-http-phone-en-22-03-step2.png`). The same happens in ES over file://.
- **Fix:** Give the step-two form `id="more"` (or scroll it into view and focus its first chip in `joinform.js`
  line 581, after `paintStep2(me)`). Better still, show step two inline on the newsletter page so the person never
  leaves.
- **Files:** `assets/js/joinform.js`, `join.html`.

#### journeys-12 · Desktop join success: 650 px of empty violet, and "Join free." is still the headline
- **Evidence:** At 1440 x 900, after submitting, the hero section grows from 665 to 1,777 px because step two
  renders inside the right column. The left column is vertically centred, so the H1 "Join free. We saved you a
  seat." drops to 835 px and the first screen is a blank violet void next to the card
  (`shots/join-desk-after-top.png`). It looks broken on the most important success screen.
- **Fix:** `align-items: start` on the join hero grid. Move step two and the picks below the hero, full width, or
  into the next section. Swap the H1 to the joined state ("You're in, {name}.") once a member exists.
- **Files:** `assets/css/pages/join.css`, `join.html`, `assets/js/pages/join.js`.

#### journeys-13 · `join.html?e=<id>`, the fallback behind every "I'm in", forgets the event
- **Evidence:** `join.html?e=trivia-county-edition` with JS on shows the generic join page. Nothing mentions Trivia
  night, no RSVP sheet opens, and joining doesn't save the seat. With `?ref&from&e`, the banner there says "Kira
  invited you to the Young Dems" and also ignores `e`. Every "I'm in" ships as this link (`rsvp.js` contract). It's
  what a phone user gets after long-press → "Open in new tab", or when JS is slow or blocked.
- **Fix:** On `join.html`, read `?e`. If the event exists, show "Save your seat at Trivia night, Thu, Nov 19" with
  the RSVP sheet (load `eventcard.js`, `rsvp.js` and the events slice), or RSVP automatically on join with the same
  name and contact.
- **Files:** `assets/js/pages/join.js`, `join.html`, `data/slices/join.js` (events subset), `assets/js/rsvp.js`
  (`landing()` on the join page).

#### journeys-14 · Share fallback feedback is swallowed: "Send it to the group chat" shows only "New sticker: Card Maker."
- **Evidence:** Without the Web Share API (Chrome on Linux, Firefox desktop, and this headless run), the home
  maker's "Send it to the group chat" copies the message to the clipboard. A MutationObserver on `.toast-region`
  recorded exactly one toast, `["New sticker: Card Maker."]`; "Link copied" never appears, because the sticker
  toast replaces it. The quiz result share behaves the same. The user can't tell anything was copied.
- **Fix:** Queue toasts instead of replacing them, or merge the two into "Copied. Paste it in the group chat · New
  sticker: Card Maker". Fire the sticker toast after the share result's toast has had its time.
- **Files:** `assets/js/ui.js` (`ui.toast` queue), `assets/js/membercard.js` (sticker toast), `assets/js/maker.js`.

#### journeys-15 · On an event page, the invite banner duplicates the hero and pushes the cover off the first screen
- **Evidence:** At 390 px, `events/trivia-county-edition.html?ref&from&e` shows the banner's "I'm in" at 317 px, then
  the hero H1 at 546 px, then the page's own "I'm in" at 750 px. That's two identical CTAs, and the title and date
  appear twice, in the first 844 px. The cover photo (people) sits below them
  (`shots/a3-http-phone-event-first.png`). Partiful's invite view shows the inviter as a small line on the invite
  itself.
- **Fix:** On event pages (`body.p-event` with `e` equal to this event), render a compact banner variant: avatar +
  "Kira invited you" + dismiss, no title, date or button. The hero's RSVP row is the action.
- **Files:** `assets/js/rsvp.js` (`landing()` variant), `assets/css/rsvp.css`.

#### journeys-16 · "Start the quiz" and "Find my type" links don't start the quiz
- **Evidence:** `quiz.html#show-up` and `quiz.html#issue` (used by the home quiz section, the static result pages'
  primary CTA, and the issues page) scroll to the picker (`scrollY 958` / `1437`) with the player hidden and focus on
  `<body>`. Only an in-page click starts it. That's an extra tap and a "did it work?" moment. Quick mode is labelled
  "Quick match (4 taps)" but takes 6 from home.
- **Fix:** In `assets/js/pages/quiz.js`, on load with `#show-up` or `#issue` (and on `hashchange`), call the same
  start routine as `[data-quiz-start]` and move focus to question 1.
- **Files:** `assets/js/pages/quiz.js`.

#### journeys-17 · A mail voter's plan .ics puts a "Vote:" event at 7 pm on Election Day, the minute the ballot must already have arrived
- **Evidence:** A plan for Altamonte Springs → registered → by mail → "the day it arrives" downloads
  `my-voting-plan.ics` with `DTSTART;TZID=America/New_York:20271102T190000` and
  `SUMMARY:Vote: Lake Mary and Altamonte Springs city elections (expected)` (the alarm is 7 days before). Someone
  glancing at the calendar sees "Vote 7 pm". The description says the ballot "has to reach the elections office
  by 7 pm", but the title and time say the opposite.
- **Fix:** For `method === 'mail'`, title it "Mail ballot must ARRIVE by 7 pm (postmarks don't count)" and add a
  separate "Mail your ballot today" event about 7 days earlier (or "the day it arrives"), so the alarm and the
  event agree.
- **Files:** `assets/js/pages/vote.js` (`renderOut` calendar block), `data/civic.js` (`plan.outputs.calendar` titles,
  EN + ES).

#### journeys-18 · Shared quiz, clip and vote links open with no "who sent this" landing
- **Evidence:** `quiz.html`, `vote.html`, `clips.html`, `post.html` and all 15 `quiz/**` result pages have no
  `[data-invite-landing]`. Opening `quiz.html?ref=KIRA7QX&from=Kira` captures the ref (good) but shows nothing.
  The quiz result card is the brief's #1 viral mechanic (§5, 08 §6). A friend arriving on
  `quiz/show-up/door-knock-natural.html?ref=…` sees someone's result with no "Kira got The Door-Knock Natural.
  What's yours?" banner. B20 lists "All" pages.
- **Fix:** Add the `[data-invite-landing]` container to these pages, plus a result-aware string on quiz result
  pages ("{from} got {result}. What's yours? Find my type"). Load `rsvp.js`'s `landing()`, or split it into a
  small `invite.js` that pages without events can load.
- **Files:** `quiz.html`, `vote.html`, `clips.html`, `post.html`, `tools/make_quiz_pages.js` (regenerate `quiz/**`
  and `es/quiz/**`), `assets/js/rsvp.js` (or a new `assets/js/invite.js`), `data/slices/core.js` (copy).

### Minor

#### journeys-19 · In-page jumps don't move focus
"See your card", the header "Your card", the vote hero's "Make my plan" and the newsletter's "Send me the letter"
change the hash but leave focus on `<body>` (`out.afterSeeCard.focus`, `out.afterHero.focus`). Keyboard and screen
reader users start from the top again. **Fix:** a generic handler in `ui.js` for same-page `a[href^="#"]` that
focuses the target heading (`tabindex="-1"`). **Files:** `assets/js/ui.js`.

#### journeys-20 · The post form's error summary is a wall of seven, with three identical lines
Pasting a non-TikTok link and tapping Send lists "That link isn't from TikTok, Instagram or YouTube…" plus six
other errors, including "Tick this box to post your clip." three times without saying which box. **Fix:** name
each consent in its message ("Tick 'I made it or have permission'"); on first submit, consider validating only the
step the user is on. **Files:** `assets/js/pages/post.js`, `data/pages/clips.js`.

#### journeys-21 · "Post another" forgets the age and minors answers for non-members
After one post, the second form asks the age again (`form2State.age: ""`). **Fix:** keep the age for the session
(not stored), or offer to join so it's remembered. **Files:** `assets/js/pages/post.js`.

#### journeys-22 · "Copy link" copies the whole message, not the link
The maker and quiz "Copy link" put "(DEMO event) Sunset walk-and-talk… Come with me? http://…" on the clipboard.
**Fix:** copy the URL only, or relabel it "Copy message". **Files:** `assets/js/maker.js`.

#### journeys-23 · A static result page's share button shares someone else's result URL
On `quiz/show-up/door-knock-natural.html`, "Send it to the group chat" copies "Two quick quizzes… Take one and
tell me what you get. …/quiz/show-up/door-knock-natural.html". The friend's friend lands on a stranger's result.
**Fix:** link to `quiz.html` here. **Files:** `tools/make_quiz_pages.js` (or the page's `data-share` target),
`assets/js/pages/quiz.js`.

#### journeys-24 · The RSVP .ics LOCATION repeats the city
`LOCATION:A board-game café in Casselberry (DEMO venue)\, Casselberry`. **Fix:** skip the city when the venue name
already contains it. **Files:** `assets/js/eventcard.js` (`cal()`).

#### journeys-25 · The invite banner omits the place
"Kira invited you to Trivia night · Thu, Nov 19 · 7 to 9 pm". There's no "Casselberry". The brief's banner shape
and the AmericaFest/Partiful first screens lead with date + place, and place is the first thing a first-timer
asks. **Fix:** append `· {city}`. **Files:** `assets/js/rsvp.js`.

#### journeys-26 · The local test server serves the English 404 for /es/ paths
Production is fine: `netlify.toml` sends `/es/*` to `es/404.html`, and Cloudflare serves the nearest 404. But
`tools/check_site.js` `createServer()` always serves the root `404.html`, so QA never exercises the Spanish 404
and a regression there would go unseen. **Fix:** serve `es/404.html` for missing `/es/` paths. **Files:**
`tools/check_site.js`.

## What already works (keep it)

- `?ref` capture on every page, with the ref captured on arrival frozen into `member.referredBy` (http, file://,
  EN, ES). The RSVP payload carries `ref` and `from`. `from` is sanitised (`<img onerror…>` rendered as "I img srcx
  onerroraler").
- The RSVP count rises only after submit, with plus-ones (31 → 33). Maybe/Can't give warm toasts without a sheet.
  "Can't make it anymore" brings the count back down.
- Event .ics: correct UTC conversion, VTIMEZONE, 3-hour alarm, `(DEMO)` in the summary. The January reminder is
  Jan 4, 2027 at 10 am ET with Spanish text on ES.
- Ages: 13 stores nothing personal, with a kind message and focus on it. 16 gets a random code (`WRRH5K`), no `from`
  on the +1 link, the RSVP "show my name" forced off, "Texts are for members 18 and older", and an optional
  guardian email. 45 gets "You're on the list" and a SUPPORTER card, never "member".
- Header CTA: "Join free" → "Your card" / "Tu tarjeta" after joining, on every page tested (root, `events/`,
  `quiz/issue/`, `es/quiz/show-up/`), over http and file://.
- Theme: Auto → Light → Dark → Auto persists across pages and languages over http and file://.
- Forget me: an inline confirm, a live inventory, localStorage and IndexedDB cleared, pending cards gone.
- No horizontal overflow on any journey screen at 390 or 1440. No console errors or page errors in any run.

## Evidence index (screenshots)

All paths are under `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/journeys/shots/`.

- Invite landing, home 390: `a-home-landing-390.png`. Event 390: `a3-http-phone-event-first.png`. Event 1440:
  `a-http-desk-en-events_trivia_county_edition_html-01-landing.png`.
- RSVP sheet / errors / done: `a-http-phone-en-index_html-02-sheet.png`, `-03-sheet-errors.png`, `-04-rsvp-done.png`.
  Desktop sheet: `a-http-desk-en-events_trivia_county_edition_html-02-sheet.png`.
- Join success 390: `a-http-phone-en-index_html-06-joined.png`. Full page: `-06b-joined-full.png`. Card crop:
  `a-joined-card-crop.png`. Desktop void: `join-desk-after-top.png`.
- Friend's landing (no `from`): `a2-http-phone-en-friend-landing.png`. After "See your card":
  `a2-http-phone-en-see-card.png`.
- Quiz: `b-http-phone-en-show-up-03-result.png`, `-03b-result-full.png`. Dead end:
  `b-http-phone-en-show-up-04-events-filtered.png`.
- Vote: `c-http-phone-en-01-first.png`, `c2-http-phone-en-plan-out.png`, `c-http-phone-en-04-psa.png`.
- Post: `d-http-phone-en-post-webm-02-filled.png`, `-03-done.png`, `-04-reload.png`, `-05-clips.png`.
  Sheet: `d-http-phone-en-clips-mp4-*.png`.
- Newsletter → step two: `e-http-phone-en-22-02-done.png`, `e-http-phone-en-22-03-step2.png`.
- Ages: `g-http-phone-en-age13.png`, `g-http-phone-en-age16.png`, `g-http-phone-en-age45.png` (and `-es-`).
- Theme dark after navigation: `f-theme-*-dark-esvote.png`. 404 deep paths: `404-*.png`.
- Home maker: `card-home-http-phone-en.png`, `card-getlink-form.png`, `card-getlink-done.png`.
