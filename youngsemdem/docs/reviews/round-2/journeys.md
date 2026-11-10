# Round 2 review: end-to-end user journeys

Reviewer lens: **journeys**. I drove every journey in Playwright Chromium on Tue, Nov 10, 2026 (the brief's "today" is
Mon, Nov 9): at 390 x 844 (touch: `isMobile`, `hasTouch`, real `tap()` calls) and at 1440 x 900, over http (the
`tools/check_site.js` server with the `_headers` CSP, port 8751), over `python3 -m http.server` (port 8752, 404 check
only) and over `file://`, in EN and ES. Web Share was disabled and the clipboard stubbed, so every share went down the
copy/download fallback a desktop or Firefox user gets. I edited no site files.

Scripts, JSON results and 480+ screenshots are in the scratchpad:
`/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/j2/` (scripts `jA.js` to `jI.js`,
`jF2.js`, `jH2.js`, `dbg*.js`; results `out-*.json`; screenshots under `.../j2/shots/`; downloaded cards and .ics
files under `.../j2/dl/`). Below, `shots/` and `dl/` mean those two folders.

Runs: journey A (invite, RSVP, join, card, share, friend) 16 of 16 combinations; B (quiz) 16; C (vote) 16; D (post) 8;
E (newsletter) 8; F (language toggle on all 100 pages with a twin) 4 x 100 transitions; theme, 404 and header CTA;
G (ages 13 / 16 / 45 on join and the RSVP sheet) 32. No page errors and no console errors in any run (the only console
lines are the expected 404 responses on the 404 checks). No horizontal overflow on any journey screen.

## Summary

Round 1's loop is fixed and it holds everywhere I pushed it. A friend's link lands with "Kira invited you", the RSVP
sheet turns into a ticket, "Join free, get my link" joins in one tap with `referredBy: KIRA7QX`, the member card has
Copy, Share, Text and WhatsApp, my own link carries `ref=<code>&from=<name>`, and a second browser context opening
that link sees "Sofia invited you" and joins with `referredBy` = Sofia's code: 16 of 16 combinations (http and file://,
EN and ES, phone and desktop, landing on home or on the event page). The language toggle kept the page, the query and
the anchor on **400 of 400** transitions (round 1: 0 of 170). Theme, 404, header CTA, Forget me, the .ics files and
the 14 config-driven vote links are all correct.

What still stands between this and "better than the best": 

1. **Two blocking items.** (a) A 14 to 17 year old who RSVPs with a mobile number is promised "your invite and one
   reminder" by text and, for after-dark events, "a quick guardian form", although the minors policy says no texts to
   under-18s at launch and the sheet never asks for a guardian contact. The join form already handles this ("Texts
   are for members 18 and older for now"); the RSVP sheet and its one-tap join don't. (b) The sticker reveal is a
   modal `<dialog>` (`showModal()`) that fires 2.6 s after the quiz result and after every card share or save,
   blocks the page, hides the "Link copied" confirmation, tells guests "It's on your card now" when they have no card,
   and says "you sent it to someone" after a mere Save image. BRIEF §0 lists "the blocking level-up overlay" as a kill.
2. **The peak moments leak value (major).** The RSVP sheet's join hook sits 371 px below the fold under a sticky
   Done bar. The newsletter success is a dead end. 7 of 9 issue quiz results get the same three generic "events made
   for you" chips, and those `?kind=` links land on the events hero, 1,884 px above the list. The printed links on the
   shareable cards are broken in two ways: the I'm-going card's link runs off the card, and Spanish names print as
   `from=Sof%C3%ADa` / `Jos%C3%A9+Mar%C3%ADa` on the member card and its PNG. The Dec 31 card's tile text collides
   with its date line. The post flow says "Clip sent. A person on our team checks every clip, usually within 3 days"
   in a demo that sends nothing, with no DEMO label.

Fix the 2 blocking and 9 major items and every journey would score 85 to 95 against Partiful (invite), Rare Beauty
and Glossier (sharing), Vote.org (plan) and every right-wing site (none of which closes the loop at all).

## Round 1 fixes: verified

| Round 1 | Status in round 2 | Evidence |
|---|---|---|
| 01 clip moderation fields | Holds. A 16-year-old with a minor in the clip gets the guardian field; the gate's `needsGuardian:true` check passes and Forget me wipes the blob store. | `out-jD-all.json` |
| 02 RSVP age screen | Holds. 13 shows the kind too-young state, stores only the inviter's `ysd:ref`, clears what was typed (EN/ES, http/file). | `out-jG-all.json`, `shots/g-http-en-rsvp-13.png` |
| 03 DEMO on the invite banner | Holds ("DEMO EVENT" / "EVENTO DEMO"). | `shots/x1-home-invite-phone.png` |
| 04 language toggle keeps query and anchor | **Fixed: 400 of 400** (http desk 100/100, http phone 100/100, file desk and file phone 100/100 each, the two 404 pages skipped on file:// since 404.html is served-only). | `jF-*.log`, `out-jF-*.json` |
| 05 quiz chips dead-end | Fixed for `?series=` (drop-only series now say "in January's lineup · Notify me"). New problem: issue results fall back to generic `?kind=` chips (finding journeys-quiz-issue-events-generic). | `out-jB-all.json` |
| 06 squad meter / Start over | Holds (gate flow). Cross-device counting is a known chapter item; not re-filed. | `out-jA-all.json` (`meter`) |
| 07 copy/share on the member card | Fixed: Send it to the group chat, Copy my link, Text it, WhatsApp, name toggle. | `shots/a-http-en-phone-home-06-card.png` |
| 08 `from` on adult links | Fixed everywhere I looked (card, +1, maker, quiz share). Never on under-18 links. | `out-jA-all.json`, `out-jG-all.json` |
| 09 RSVP success join hook | Exists and works in one tap, but is buried (journeys-rsvp-join-hook-buried). | `shots/a-http-en-phone-home-03-done.png` |
| 10 join prefill from the RSVP | Holds (name + contact, never age). | gate flow |
| 11 `#more` / step two | Fixed: the newsletter opens step two inline and focuses it (`jf5-s2` at 80 px). | `out-jE-all.json` |
| 12 desktop join success void | Fixed (headline "You're in, Marcus.", no void). | `shots/h-join-desk-success-top.png` |
| 13 `join.html?e=` | Fixed ("SAVE YOUR SEAT · Sunset walk-and-talk… · I'm in"). | `shots/h-join-e.png` |
| 14 toast queue | Mostly fixed; "Link copied" now shows, but ~3 s late and a stale toast replays (minor). | `jH2.js` output |
| 15 compact banner on event pages | Fixed ("Kira invited you" + dismiss). | `shots/x1-event-invite-phone.png` |
| 16 `#show-up` / `#issue` start the quiz | Fixed (player visible on arrival). | `out-jB-all.json` (`afterCta`) |
| 17 mail plan .ics | Fixed: "Mail ballot must ARRIVE by 7 pm today", plus "Mail your ballot today" Oct 26 at 10 am, plus the Oct 21 5 pm request deadline. | `out-jC-all.json` |
| 18 who-sent-this landing | Fixed on quiz results ("Kira got The Hype Captain. Your turn: 8 questions, about a minute."), join, vote, post, 404. | `shots/b-static-landing-phone.png` |
| 19 jump focus | Holds (Make my plan focuses `plan-title`; step two focuses its heading). | `out-jC-all.json` |
| 20/21 post errors, Post another | Holds (age kept for "Post another"). | `out-jD-all.json` |
| 22 Copy link copies only the link | Fixed. | `out-jB-all.json` (`copyLink`) |
| 23 static result share | Fixed (shares the quiz with my ref and from). | — |
| 24/25 .ics LOCATION, banner place | Fixed ("· Casselberry"). | — |
| 26 Spanish 404 locally | Fixed (`/es/nada` and `/es/events/x/y/z.html` serve "Esta página no llegó a la reunión."). | `out-jF2.json` |

## Taps to the key goals (390 x 844, touch)

Taps count every button tap and every field focus; typing is extra.

| Goal | Path | Taps | vs round 1 | Note |
|---|---|---|---|---|
| RSVP from a friend's link | banner "I'm in" → name → contact → age → Save my seat | **5** | 4 → 5 | The age field is policy (journeys-02). Partiful is 3. |
| Join right after that RSVP | "Join free, get my link" (in the sheet) | **1** + scroll 371 px | 5 → 1 | The button is below the fold under a sticky Done (journeys-rsvp-join-hook-buried). |
| See my card after that | close the sheet → header "Your card" | 2 | — | The sheet never shows your own link or card. |
| Copy my own link | card "Copy my link" | 1 | n/a → 1 | Link carries `ref` + `from`. |
| Join cold | header Join free → 3 fields → Join | 5 | 5 | |
| Make a card (home quick maker) | first name → Send it to the group chat | **2** (+1 to dismiss the sticker modal) | 2 → 3 | The maker sits at 4,559 px (5.4 screens). |
| Quiz to result | home "Start the quiz" → 8 answers | 9 (show-up), 5 (issue, quick) | 9 / 6 → 9 / 5 | Plus 1 to dismiss the "Called It" modal. |
| Share the result | Send it to the group chat | 1 (+1 to dismiss "Card Maker") | 1 → 2 | |
| Voting plan + .ics | Make my plan → 6 or 7 answers → Add it to my calendar | 8 to 9 | 8 | |
| January reminder | Dec 31 tile → Add the January reminder | 2 (1 from the mail block) | 1 | Jan 4, 2027, 10:00 am ET, `TZID=America/New_York`. |
| Renew info | vote "Renew online" (request form) / home "How to renew" (info page) | 1 | 1 | |
| Student-ID card | Send these 2 dates → Jan 1 only → Send it to the group chat | 3 | 1 → 3 | Saves a 1080 x 1920 PNG (254 KB). |
| Post a clip (upload) | file → Next → caption → captions box → Next → age → minors → 3 consents → Send | **11** | 9 → 11 | The stepper added 2 taps. |
| Newsletter → step two saved | 3 fields + Subscribe (5 with the hero jump), then Pick → city → issue → Save | 5 + 4 | 4 + 4 | |
| Forget me | Forget me on this device → Yes, forget me | 2 | 2 | localStorage empty, IndexedDB `ysd/blobs` 0, header back to "Join free". |

## Per-page scores (journeys lens; 90+ = would beat the best benchmark)

| Page / journey | R1 | R2 | One line |
|---|---|---|---|
| Global language toggle (every page) | 52 | **96** | 400 of 400 transitions keep page, query (minus utm/ref) and anchor, and land on the anchor. |
| Theme toggle and header CTA | — | 92 | Auto → Light → Dark persists across EN/ES/deep pages; "Join free" → "Your card"/"Tu tarjeta" on every page, both transports. |
| Privacy / Forget me | 84 | 88 | Real wipe (localStorage + IndexedDB), pending clips gone, header resets. |
| Vote hub | 82 | 84 | Plan, .ics (TZID, VTIMEZONE, alarms), reminder and 14/14 config links all right; the Dec 31 card text collides and single cards say "2 DATES". |
| 404 | 78 | 85 | Works from 5-level paths in EN and ES, links work, toy works. |
| Event / invite page | 80 | 82 | Ticket success and going card are Partiful-grade; the join hook is buried, the going card's link is clipped, teen RSVPs promise texts. |
| Home (invite landing) | 76 | 80 | Banner, one-tap RSVP and the quick maker work; a second event's "I'm in" competes under the banner; the sticker modal interrupts the maker. |
| Events list, filtered | 60 | 78 | `?series=` jumps to "Only showing … · 1 event (DEMO)"; `?kind=` lands on the hero. |
| Join + member card | 62 | 76 | Ref carries in 16/16, card has every action; Spanish names print percent-encoded, every default card says "Elsewhere in Seminole", Save image triggers a blocking modal. |
| Post / Reel posting | 64 | 74 | Upload + TikTok link, pending cards survive reload, Forget me wipes all; "Clip sent" with no DEMO, 11 taps. |
| Quiz + result pages | 72 | 72 | Sharing with ref + from works and result pages greet the friend; two blocking modals per run and generic events for 7 of 9 issue results. |
| Newsletter → step two | 66 | 70 | 5 taps and inline step two; the success state is a dead end for the loop. |

## Findings

Severity follows the task: blocking = safety, legal, §0, ruling 00, broken flow; major = loses to a benchmark,
confusing step, dead end, missing hook, cringe; minor = polish.

### Blocking

#### journeys-teen-rsvp-texts · A teen's RSVP promises texts and a guardian form the policy says we can't send
- **Where:** the RSVP sheet on every event page and the home invite banner, and its one-tap "Join free, get my link".
- **Evidence:** Age 16, mobile `407-555-0199`, Trivia night (ends 9 pm). Before submit the sheet shows the contact
  hint "For your invite and one reminder. Nothing else unless you ask." and the guardian note "Under 18? This one ends
  after dark or involves door-knocking, so we'll send a quick guardian form after you RSVP." There is no guardian
  contact field. The stored record is `{contactType:"phone", contact:"+14075550199", under18:true}`, and in production
  `YSD.rsvp.submit` POSTs it. Tapping "Join free, get my link" then joins the 16-year-old with `phone:+14075550199`
  and shows only "You're in. Your +1 link and your text now carry your own code." (`shots/g-http-en-rsvp-16-joined.png`).
  Compare join.html with the same inputs: "Texts are for members 18 and older for now." plus an optional guardian
  email. `docs/legal/MINORS_POLICY.md` §4: "Texts to members under 18. Proposal: none at launch" (TCPA consent is
  open question M3); §5.3: guardian permission for anything after dark. So the RSVP promises a text reminder to a
  minor, and a guardian form with no lawful channel to deliver it. Same in ES, http and file://.
- **Fix:** When the age is 14 to 17 and the contact is a phone: swap the hint for `teen.noTexts` ("Texts are for
  members 18 and older, so we'll email instead: add an email, or a guardian's email"), and ask for an optional
  guardian email (the same field join.html uses) on events where `ages.guardian` is set. Never store or send the
  phone as a reminder channel for under-18s (`reminder:false` in the payload). In `joinFromRsvp`, show the same teen
  note and guardian-email option the join form shows. Reword `ageGuardian` to say where the form goes.
- **Files:** `assets/js/rsvp.js` (`syncTeen`, `onSubmit`, `joinFromRsvp`), `data/events.js` (`labels.ageGuardian`,
  new teen contact label), `data/strings.js` (`form.rsvp.contact.hint` teen variant), `data/slices/core.js`,
  `data/slices/events.js` (regenerate).

#### journeys-reveal-blocking-modal · The sticker reveal is the "blocking level-up overlay" §0 killed, and it misfires
- **Where:** quiz result, quiz/maker/member-card share and Save image, home quick maker; every page with
  `membercard.js`.
- **Evidence:**
  - `YSD.ui.reveal` calls `dlg.showModal()` (`assets/js/ui.js` ~line 887). Playwright's taps on "Copy link" and
    "Copiar mi enlace" right after a share timed out after 30 s with "`<dialog open class="unlock">` intercepts
    pointer events".
  - Quiz: the result renders, then 2.6 s later the modal "NEW STICKER · Called It · See your stickers · Nice" covers
    the type name and character (`shots/b-http-en-phone-show-up-03-reveal.png`). Tapping "Send it to the group chat"
    opens a second modal, "Card Maker" (`shots/b-http-en-phone-show-up-04b-after-share-modal.png`). Two dismiss
    taps per quiz, both at the peak.
  - The "Message copied" toast sits behind the modal, so the user can't tell the share worked (round 1's journeys-14,
    reintroduced).
  - Guest on home (not joined): quick maker → Send → "Card Maker … It's on your card now." There is no card;
    "See your stickers" goes to join.html#card, which shows "Join to get yours".
  - Member card "Save image" (no share at all) earns "You made a card and sent it to someone you'd actually text."
    (`rule: { action: "share-card" }` counts saves).
  - BRIEF §0 kill list: "C's XP, levels HUD, … the blocking level-up overlay".
- **Fix:**
  - Make the reveal non-modal: an inline collectible chip that slides into the result or card area, or `dlg.show()`
    with no backdrop and no focus steal, auto-dismissing like a toast. Never during a share or copy confirmation.
  - Guests get a quiet toast ("Join to keep your stickers").
  - Award Card Maker on a completed share only. Make its copy honest for saves ("You made a card.").
- **Files:** `assets/js/ui.js` (`ui.reveal`), `assets/js/membercard.js` (`announce`, guest branch), `data/levels.js`
  (`card-maker` rule and desc, `labels.onYourCard`), `assets/css/components.css` (reveal styles),
  `data/slices/growth.js` (regenerate).

### Major

#### journeys-rsvp-join-hook-buried · "Want credit when friends come?" is 371 px below the fold, under a sticky Done
- **Evidence:** After "Save my seat" at 390 x 844 the sheet shows the ticket, the going card and a sticky footer
  (Done / Change my RSVP / Can't make it anymore). "Join free, get my link" starts at 1,215 px in an 844 px
  viewport (1,279 px in ES; 1,050 px of 900 at 1440), after Calendar, Google, Outlook, +1 a friend, Text this to a
  friend and the name switch (`shots/a-http-en-phone-home-03-done.png`, `-04-joined-in-sheet.png`). The most visible
  action is Done. After joining, the sheet says "You're in. Your +1 link and your text now carry your own code."
  (also as a toast) but never shows the code, the link or the card. This is the brief's RSVP → join loop step and the
  only place a first-timer gets their own link.
- **Fix:** Put the join block straight under the ticket, above the going card, as one line with the button ("Get
  your own invite link · 1 tap"). Collapse the three calendar buttons into one "Add to calendar" with a menu. After
  joining, swap the block for the printed link + Copy + "See your card".
- **Files:** `assets/js/rsvp.js` (`build()` order, `joinFromRsvp` done state), `assets/css/rsvp.css`, `data/events.js`
  (labels).

#### journeys-es-encoded-names-on-card · Accented names print as `Sof%C3%ADa` on the member card and its PNG
- **Evidence:** ES join as "José María": the on-page card prints `127.0.0.1:8751/es/join.html?ref=JOSEMP2H&from=Jos%C3%A9+Mar%C3%ADa`.
  The saved PNG prints the same under "Ven conmigo →" (`dl/es-young-dems-member-card.png`). As "Sofía":
  `…&from=Sof%C3%ADa`. Seminole is 25.4% Hispanic, and Sofía is the brief's persona P1. `ui.prettyLink()` strips
  utm_* but never decodes, and keeps `from`.
- **Fix:** In `prettyLink`, `decodeURIComponent` each kept value for display, turn `+` into a space, and drop `from`
  from printed links (the code is enough to type). Or print only `host/join?ref=CODE`. The copied URL can stay encoded.
- **Files:** `assets/js/ui.js` (`ui.prettyLink`), `assets/js/membercard.js` (line ~323), `assets/js/cards-brand.js`
  (lines ~294, ~660), `assets/js/maker.js` (`pretty`), `assets/js/joinform.js` (line ~283).

#### journeys-going-card-link-clipped · The I'm-going story card's link runs off the card
- **Evidence:** `dl/going-im-going-trivia-county-edition.png` (1080 x 1920): the "Come with me →" box prints
  `127.0.0.1:8751/events/trivia-county-edition.html?ref=SOFIAXV2&from=Sofia&e=trivia-co…`, and the line runs past
  the box edge under the gator sticker. On the real domain it is still about 90 characters. This is the brief's
  peak-moment share artifact (genz-brand-09), and Rare Beauty and Partiful story cards print a short, readable handle.
- **Fix:** Print a short form (`youngsemdems.com/e/trivia?ref=SOFIAXV2`, or the pretty path without `from` and `e`),
  shrink the font to fit the box width, and keep the sticker clear of the link box.
- **Files:** `assets/js/cards-brand.js` (`going` template link line), `assets/js/rsvp.js` (link passed to the card),
  `assets/js/ui.js` (`prettyLink`).

#### journeys-dates-card-collision · The Dec 31 share card's tile text overlaps its date line; single cards say "2 DATES"
- **Evidence:** "Dec 31 only" card (`dl/dates-mail-ydsc-mail-heads-up.png`): "mail-ballot requests from before
  Nov 3" wraps, and "end" lands on the underline and on top of "THU · 2026". Both single cards ("Dec 31 only",
  "Jan 1 only", `dl/dates-id-ydsc-id-heads-up.png`) carry the kicker "2 DATES · SEMINOLE VOTERS". This is the site's
  lead civic action (ruling 00) on its most shareable card. Same in ES.
- **Fix:** In `tile()`, measure the wrapped tile text and push the weekday/year line below its last baseline (or
  shrink the line). Use a single-date kicker (`card.kickerOne`: "HEADS-UP · SEMINOLE VOTERS") when `kind !== 'both'`.
- **Files:** `assets/js/pages/vote.js` (`tile`, `drawCard`, kicker around line 522), `data/pages/vote.js`
  (`card.kicker`, new `card.kickerOne`), `data/slices/vote.js` (regenerate).

#### journeys-quiz-issue-events-generic · 7 of 9 issue results get the same three generic "events made for you"
- **Evidence:** On the static result pages and in the live quiz, `freedom-to-read`, `heat-insurance`, `lgbtq-freedom`,
  `rent`, `reproductive-freedom`, `transit` and `wages` all render the same chips: "Learn something
  (?kind=learn) · Hang out (?kind=social) · Pitch in (?kind=volunteer)". Their mapped series are drop-only, so the
  journeys-05 fallback kicks in. "Made for you" that is identical for every result reads as broken, and the Rent
  Realist's "learn" list is 1 event (the Renew-Ready Party; the Spanish workshop is hidden until the Dec 15 drop). Only clean water and voting rights get series chips.
  Show-up results are fine (each gets at least one open series). `out-jB-all.json`, `dbgChips.js` output.
- **Fix:** Map every issue to at least one open series (Trivia Thursday, Sunset Walk Club, Heads-Up Tuesday,
  Renew-Ready Party, Open Mic, Creator Night, Seminole Sunday) as well as its January one: for example, rent → Open
  Mic plus Seminole Sunday, transit → Trivia Thursday, wages → Heads-Up Tuesday. Then name the chip with the reason
  ("Open Mic: bring your rent story").
- **Files:** `data/quiz.js` (issue `eventSeries`), `assets/js/pages/quiz.js` (`seriesBlock` fallback copy),
  `tools/make_quiz_pages.js` (regenerate `quiz/**` and `es/quiz/**`), `data/slices/quiz.js`.

#### journeys-kind-filter-lands-top · `events.html?kind=` lands on the hero, 1,884 px above the filtered list
- **Evidence:** At 390, `events.html?series=creator-night` scrolls to `scrollY 1804` with "Only showing Creator Night
  × · 1 event (DEMO)" in view. `events.html?kind=learn` and `?kind=social` stay at `scrollY 0` on "You're invited."
  (`shots/b-http-en-phone-issue-06-events.png`). The filter is applied silently 2.2 screens down. Every issue-result
  chip, plus "Find a room to fill" on The Hype Captain, uses `?kind=`. A first-timer sees the generic events page and
  wonders whether the tap did anything.
- **Fix:** Treat `?kind=`, `?tag=` and `?city=` like `?series=`: scroll to `#lineup`, focus the count, and show the
  same "Only showing Learn ×" chip.
- **Files:** `assets/js/pages/events.js`.

#### journeys-post-success-not-demo · "Clip sent." and "a person checks within 3 days" in a demo that sends nothing
- **Evidence:** After "Send for review": the heading "Clip sent." and the body "Thanks! Your clip is in review. A
  person on our team checks every clip, usually within 3 days. Only you can see it until then." The same text shows
  as a toast. The pending card says "PENDING REVIEW · ONLY YOU CAN SEE THIS … A person on our team checks every clip,
  usually within 3 days." Neither has DEMO (`shots/d-http-en-phone-04-done.png`, `-06-reload.png`). The step before
  said "DEMO: your clip stays on this device. Nothing is uploaded", and the site banner says "Forms don't send
  anything". The RSVP ("DEMO event: your RSVP stays in this browser") and the newsletter ("DEMO: nothing left this
  browser") both tell the truth at success. §0.2 honest labels.
- **Fix:** In demo mode, title it "Clip saved (DEMO)", say "On the live site a person reviews it within 3 days.
  Here, it stays on this device.", and add a DEMO tag to each pending card.
- **Files:** `assets/js/pages/post.js` (done state, demo branch), `data/pages/clips.js` (`post.doneTitle`, done body,
  pending copy), `data/strings.js` (`success.clip.title`, `toast.clipSent`), `data/slices/clips.js`.

#### journeys-newsletter-success-dead-end · Newsletter signup makes you a member, then offers nothing to do next
- **Evidence:** After Subscribe the card reads "You're in, Sofi. Your first Thursday Letter lands Thursday morning.
  Now go drink some water." plus two DEMO notes, "Pick your city and issues" and "Not Sofi? Start over"
  (`shots/e-http-en-phone-02-done.png`). The visitor now has a member record and a ref code (the header says "Your
  card"), but the success state shows no link, no "Send your link", no card and no next event. §0.7: "Every viral
  moment ends offline: an RSVP, a join, a reminder, or a friend invited." Glossier's and Rare Beauty's signup success
  pivots straight into a share or a referral. After saving picks, "Pick your city and issues" stays on screen above
  "Your picks: Sanford · Edit".
- **Fix:** Add "See your card" (`data-card-href`) and a one-line next event with "I'm in" to the compact success.
  Hide the Pick button once picks are saved. Merge the two DEMO notes into one.
- **Files:** `newsletter.html` (form `data-card-href`), `assets/js/joinform.js` (compact `done` row, step-two button
  state), `assets/js/pages/newsletter.js`, `data/pages/newsletter.js`.

#### journeys-card-default-elsewhere · Every default member card says "Elsewhere in Seminole"
- **Evidence:** Anyone who joins without picking a city (every RSVP joiner, every cold join, since step two is
  optional) gets "Sofia · Elsewhere in Seminole · Member since Nov 2026" on the page and on the PNG. In ES: "Otra
  parte de Seminole" (`shots/a-http-en-phone-home-06-card.png`, `dl/teen-young-dems-member-card.png`). The join
  hero's pass says "SEMINOLE COUNTY" seconds earlier. "Elsewhere" reads as "not from around here" on the identity
  object people are asked to share. `membercard.js` defaults `city` to `'seminole'`, whose label is "Elsewhere in
  Seminole".
- **Fix:** With no city picked, print "Seminole County" (or nothing) and add a "Pick your city" chip on the page.
  Keep "Elsewhere in Seminole" only for someone who picks it.
- **Files:** `assets/js/membercard.js` (line ~247 default, line ~318 `cityName`), `data/sharekit.js` (cities),
  `data/slices/growth.js`.

### Minor

#### journeys-toast-timing · Toasts cover the sheet title, "Link copied" is ~3 s late, and stale toasts replay
After joining in the sheet, I tapped "+1 a friend". "Link copied. Paste it anywhere." appeared at 3.0 s, then the
older "Seat saved. Add it to your calendar…" came back at 5.3 s (`jH2.js`). While a sheet is open, the toast sits on
the sheet's H1 "You're in, Sofia." (`shots/a-http-en-phone-home-03-done.png`, `shots/a-http-es-desk-event-03-done.png`).
**Fix:** a copy result pre-empts other toasts; drop queued toasts older than about 4 s; anchor toasts to the bottom
while a dialog is open. **Files:** `assets/js/ui.js` (toast queue), `assets/css/components.css`.

#### journeys-card-polish · "1 STICKERS SO FAR" and "ACTIVE WEEKS 0"
The member card PNG reads "1 STICKERS SO FAR" / "1 STICKERS HASTA AHORA" (`dl/teen-young-dems-member-card.png`). The
fresh card shows "ACTIVE WEEKS 0", a dispiriting zero on day one. **Fix:** singular/plural keys; hide stats at 0 or
say "Week 1". **Files:** `data/sharekit.js` (`stickers` label), `assets/js/cards-brand.js`, `assets/js/membercard.js`,
`data/levels.js` (`activeWeeks`).

#### journeys-teen-card-name · The under-18 member card PNG prints the first name; the under-18 going card doesn't
A 15-year-old's saved card shows "Ava" in poster type (`dl/teen-young-dems-member-card.png`). rsvp.js drops the name
from under-18 going cards, and persona P3's fear is "her name in a public link". **Fix:** for under-18s, print the
name only after an explicit "Put my name on the card" toggle (off by default), matching the link rule.
**Files:** `assets/js/membercard.js`, `assets/js/cards-brand.js`.

#### journeys-home-invite-competing-event · Under the trivia invite, home pushes a different event's "I'm in"
`index.html?ref=KIRA7QX&from=Kira&e=trivia-county-edition` shows the banner's "I'm in" for Trivia (Nov 19), then the
hero's "NEXT UP · Sunset walk-and-talk · I'm in" (Nov 14) one screen later. Two events, two identical buttons, for
someone who was invited to one. **Fix:** when `e` names an upcoming event, the hero invite shows that event.
**Files:** `assets/js/pages/home.js`.

#### journeys-invite-banner-copy · "Save your seat in one tap" (it's 3 fields), also on full events and after RSVP
`labels.invitedSub` says "Free, no account needed. Save your seat in one tap." The sheet asks name, contact and age,
the line stays after you RSVP, and it shows on the full Creator night whose button says "Join the waitlist".
**Fix:** "Free, no account. Takes 20 seconds."; a waitlist variant; hide once `state(e)` exists.
**Files:** `data/events.js` (`labels.invitedSub`), `assets/js/rsvp.js` (`landing()`).

#### journeys-rsvp-note-tonight · SunRail social's RSVP note says "Tonight's the night." two months out
The sheet for the Jan 21 SunRail social reads "Bring your commute buddy, or the friend who's never once been on
SunRail. Tonight's the night." **Fix:** drop the last sentence (EN and ES). **Files:** `data/events.js` (line ~1529),
`data/slices/events.js`.

#### journeys-post-toast-duplicate · The post success toast repeats the success body word for word
Screen readers hear it twice, and it covers "Post another" at 390 (`shots/d-http-en-phone-04-done.png`).
**Fix:** a short toast ("Saved for review (DEMO)") or none, since the panel already has focus.
**Files:** `assets/js/pages/post.js`.

#### journeys-newsletter-copy · "DEMO: nothing left this browser" reads as "nothing is left", plus a random sign-off
"Nothing left this browser" parses as "there's nothing left in this browser". "Now go drink some water." also closes
the join success on join.html, where it reads as a non sequitur. **Fix:** "DEMO: nothing was sent from this browser."
Keep the water line for the letter only. **Files:** `data/strings.js` (`success.join.demo`, `success.join.signoff`),
`data/slices/core.js`.

#### journeys-rsvp-under14-copy · The RSVP's too-young message talks about "members"
At age 13 the RSVP sheet says "Members need to be at least 14." It's an event, not a membership. **Fix:** an RSVP
variant: "Our events are for ages 14 and up. We didn't save anything you typed." **Files:** `assets/js/rsvp.js`
(`showYoung`), `data/events.js` labels.

#### journeys-rsvp-supporter-note · Joining from the RSVP at 40+ says "You're in", not "supporter"
Age 45 → "Join free, get my link" → "You're in. Your +1 link and your text now carry your own code." join.html says
"Members are 14 to 39, so you're on the list as a supporter." **Fix:** reuse `success.join.supporter` in
`joinFromRsvp` for 40+. **Files:** `assets/js/rsvp.js`, `data/events.js` (labels).

#### journeys-320-sticker-covers-credit · At 320 px the hero sticker covers "members" in the stock-photo label
On `sunset-walk-lake-monroe`, `trivia-county-edition`, `sunrail-social-lake-mary` and `oviedo-2027-neighbor-shift`
(EN and ES) at 320, the round sticker sits on "Stock photo · not members", leaving "…not member" visible
(`shots/h-credit-320-events_sunset_walk_lake_monroe_html.png`). It's the honesty label for the photo.
**Fix:** at ≤360 px, shrink the sticker or move the credit chip left/up. **Files:** `assets/css/pages/event.css`,
`tools/make_event_pages.js` (if the markup order changes).

#### journeys-join-cold-seat-saved · A cold join says "Your seat's saved." with no event
After joining from join.html with no RSVP, the H1 reads "You're in, Marcus. Your seat's saved."
(`shots/h-join-desk-success-top.png`), which reads like an RSVP confirmation. "Your card is live" also appears twice.
**Fix:** use "Your seat's saved" only when an RSVP exists; otherwise "Your link is ready." **Files:** `data/pages/join.js`
(`hero.joinedKicker`), `assets/js/pages/join.js`.

#### journeys-vote-renew-label · Two "renew" buttons, two destinations
The mail block's "Renew online" opens the county request form (`links.vote.mailBallotRequest`). Step 3's "Renew my
request" opens the vote-by-mail info page (`links.vote.voteByMail`), so it costs one or two more taps off-site.
**Fix:** label step 3 "How renewing works", or point it at the request form like the mail block.
**Files:** `vote.html` (step 3), `data/civic.js` (step CTA), `data/pages/vote.js`.

## Not re-filed (known items or by design)

- The second browser context's join is credited (`referredBy: SOFIA23N`, 16 of 16), but Sofia's meter stays "0 of 3":
  the squad meter counts this browser only (known chapter/backend item).
- `python3 -m http.server` shows Python's own 404 page; production and the check_site server serve the site's 404.
- RSVP asking everyone's age is the journeys-02 policy decision.

## What already works (keep it)

- Invite → RSVP → join → card → own link → friend, 16 of 16 combinations, with `ref` and `from` right at every hop
  and the friend's landing naming the sender ("Sofia invited you", "Sofía te invitó").
- The RSVP ticket ("ADMIT SOFIA · SEAT SAVED"), the pre-rendered I'm-going card, and the count rising only after submit.
- Quiz shares carry `ref` + `from`, and the static result page greets the friend with "Kira got The Hype Captain.
  Your turn". "Copy link" copies only the link.
- Vote plan .ics: `TZID=America/New_York` with a VTIMEZONE; in-person Nov 2, 2027 at 7:00 am; mail: arrive-by 7 pm
  on Nov 2, mail-it Oct 26 at 10 am, request deadline Oct 21 at 5 pm; registration deadline Oct 4 (all-day). The
  January reminder is Jan 4, 2027 at 10:00 am ET, and the Google link has `20270104T150000Z`.
- Post: a generated 3 s MP4 (47 KB) and a TikTok link both post. Two pending cards survive reload, Forget me leaves
  `localStorage` empty and `ysd/blobs` at 0, and the header goes back to "Join free".
- Ages: 13 stores nothing but the inviter's code; 16 gets a random code (`PRS7ND`) with no `from` and "Texts are for
  members 18 and older for now" on join.html; 45 gets "You're on the list" and a SUPPORTER card.
- 404 from `nope`, `events/nope.html`, `a/b/c/d/e/f.html`, `es/nada`, `es/events/x/y/z.html` in the right language,
  with working links. The theme persists across 4 pages in both languages and both transports.

## Evidence index (under `.../scratchpad/j2/`)

- Invite: `shots/x1-home-invite-phone.png`, `shots/x1-event-invite-phone.png`, `shots/x1-event-invite-desk.png`;
  sheet `shots/a-http-en-phone-home-02-sheet.png`; ticket `shots/a-http-en-phone-home-03-done.png`; joined
  `shots/a-http-en-phone-home-04-joined-in-sheet.png`; card `shots/a-http-en-phone-home-06-card.png`; friend
  `shots/a-http-es-phone-event-08-friend-land.png`; desktop sheet `shots/a-http-es-desk-event-03-done.png`.
- Cards: `dl/going-im-going-trivia-county-edition.png`, `dl/es-young-dems-member-card.png`,
  `dl/teen-young-dems-member-card.png`, `dl/dates-mail-ydsc-mail-heads-up.png`, `dl/dates-id-ydsc-id-heads-up.png`.
- Quiz: `shots/b-http-en-phone-show-up-03-reveal.png`, `shots/b-http-en-phone-show-up-04-result.png`,
  `shots/b-http-en-phone-show-up-crash.png` (the Card Maker modal blocking Copy link),
  `shots/b-http-en-phone-issue-06-events.png`, `shots/b-static-landing-phone.png`.
- Vote: `shots/c-http-en-phone-mail-02-plan-out.png`, `shots/c-http-en-phone-mail-03-id-sheet.png`; .ics files
  under `dl/`.
- Post: `shots/d-http-en-phone-01-first.png`, `-03-step3.png`, `-04-done.png`, `-06-reload.png`, `-08-forgot.png`.
- Newsletter: `shots/e-http-en-phone-02-done.png`, `shots/e-http-en-phone-04-step2-saved.png`.
- Ages: `shots/g-http-en-join-16-phone.png`, `shots/g-http-en-rsvp-16-joined.png`, `shots/g-http-en-rsvp-13.png`.
- 404 and theme: `shots/f-404-*.png`, `shots/f-theme-*-privacy-dark.png`. Join `?e=`: `shots/h-join-e.png`.
