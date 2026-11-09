# Direction C: "Organizer Arcade"

Homepage prototype for the **Young Democrats of Seminole County (YDSC)**. Built Mon, Nov 9, 2026.
**Status: DEMO.** Events, people, clips, squads, counters and XP are samples, and the page labels them that way.

**The idea in one line:** civic action as a game you play with friends. Every real, small move (renew the mail-ballot
request, save a seat, bring a friend, post a clip) earns XP that flies into a player HUD in the header. It also builds a
weekly streak, unlocks badges and counts for your squad. Then a Spotify-Wrapped-style story card turns your
"organizer era" into something you send to the group chat. The game layer does three jobs: it points people at the
action that matters this week, it rewards friend-to-friend contact, and it gives them a reason to come back next week.

---

## 1. What's here and how to run it

| File | What it is |
|---|---|
| `index.html` | Full HTML document. No build step. Open it directly, or serve the folder with any static server. |
| `c.css` | All styles: tokens, light and dark themes, components, motion, reduced-motion rules. |
| `c-data.js` | Content copied from the project's own data files: `data/quiz.js` (organizer-era quiz, EN + ES), `data/events.js` (first 3 DEMO events) and `data/levels.js` (levels and 8 badges). |
| `c.js` | Behaviour: pixel sprites, XP/HUD, quests, `.ics` files, quiz scoring, animated card with PNG export, reel, RSVP, squad link, forms, theme and ES toggles. |
| `media/` | The project's 6 demo clips (`assets/video/*.mp4`, 720x1280, burned-in captions, "DEMO CLIP" tags) with posters resized to 432x768. |
| `shot-mobile.png`, `shot-desktop.png` | Full-page captures at 390x844 (2x) and 1440x900, light mode. `-dark` versions are a bonus. |

State lives only in `localStorage` (`ydsc-c-demo-v1`). Call `YDSC_C.reset()` in the console to start over.

---

## 2. Palette: "Controller primaries"

Kira asked for bright primaries, and the direction is an arcade, so the palette borrows the logic of a game
controller's face buttons: **every mechanic has its own colour**, and the colour means the same thing everywhere.
Red is swapped for flamingo pink, so nothing reads as GOP red or flag-blue-and-red. Report 03 has the rule:
leave the flag palette, and treat bright colours as fills under dark ink (report 03 §5 #2, §6).

| Token | Light | Dark | Means |
|---|---|---|---|
| `--blue` | `#3346FF` | `#3346FF` | **Act**: primary buttons. The only fill that carries white text. |
| `--green` | `#2FE07A` | same | **XP and progress**: XP chips, progress bars, done states. |
| `--yellow` | `#FFD60A` | same | **Next and streak**: next-move band, streak/level stickers, focus ring (dark). |
| `--pink` | `#FF5FA8` | same | **Squad and share**: share buttons, squad band, keycap. |
| `--orange` | `#FF8A2A` | same | **IRL events**. |
| `--sky` / `--teal` / lilac | `#6FD6FF` / `#2FD4C4` / `#B9A6FF` | same | Quiz result colour worlds (map to the quiz's celery/sky/violet/teal types). |
| `--ink` | `#15121F` | `#15121F` (text on fills) | Text, 3px borders, hard shadows. |
| `--paper` | `#FFF8EA` | `#110F18` | Page background, with a 22px dot grid (arcade cabinet felt). |
| `--card` | `#FFFFFF` | `#1C1928` | Surfaces. |
| `--text` / `--muted` | `#15121F` / `#595469` | `#FFF8EA` / `#C9C3DA` | Body / secondary text. |
| `--line` / `--shadow-c` | ink / ink | cream `#FFF8EA` / blue `#3346FF` | Borders and offset shadows. In dark mode the shadows turn electric blue, so the chunky blocks keep their depth. |
| `--link` / `--focus` | `#2433D6` / `#3346FF` | `#A9B2FF` / `#FFD60A` | Links and focus rings. |

**WCAG 2.x contrast (computed with the relative-luminance formula):**

| Mode | Pair | Ratio | Grade |
|---|---|---|---|
| Light | ink on paper | 17.45:1 | AAA |
| Light | ink on yellow / green / orange | 13.07 / 10.60 / 7.84:1 | AAA |
| Light | ink on pink | 6.55:1 | AA |
| Light | ink on sky / teal / lilac | 11.19 / 9.96 / 8.75:1 | AAA |
| Light | white on blue (all primary buttons) | 6.07:1 | AA |
| Light | muted on paper / white | 6.86 / 7.25:1 | AA / AAA |
| Light | link on paper | 7.89:1 | AAA |
| Light | body `#2B2738` on yellow band / lede `#2B1626` on pink band | 10.26 / 5.99:1 | AAA / AA |
| Light | yellow on ink (marquee, eyebrows) | 13.07:1 | AAA |
| Dark | text on bg / card | 17.97 / 16.30:1 | AAA |
| Dark | muted on bg / card | 11.13 / 10.09:1 | AAA |
| Dark | link on bg / card | 9.50 / 8.61:1 | AAA |
| Dark | yellow focus ring on bg (non-text, needs 3:1) | 13.46:1 | pass |

**Fails, so used only as decoration or fills:** any bright colour as text on paper; ink on blue (3.04:1); yellow on blue
(4.30:1, never used as small text).

**Distinctness (CIEDE2000; ΔE above 10 reads as clearly different):** pink is ΔE 27.8 from GOP red `#E81B23`, and
orange is 26.1. Blue is ΔE 15.9 from DNCC "Democracy Blue" `#083A90` and 22.1 from the Florida Democrats' navy `#0A3161`.
That is a deliberate family resemblance, but much brighter (report 03 §4). Green is ΔE 15.5 from brat green `#8ACE00`
(report 04 says don't copy brat). Yellow is ΔE 18.3 from FSU gold, and no garnet is used (report 03 §8).

**Measured result:** axe-core 4.x (WCAG 2.0 to 2.2 A/AA) finds **0 violations** at 390px and 1440px, in light and dark.

---

## 3. Fonts (Google Fonts, all SIL OFL, so they can be self-hosted later)

| Role | Family | Why |
|---|---|---|
| Display | **Unbounded** 800 (variable 500 to 900) | Wide, rounded and loud. It reads like a game title card and does the "type-first, loud" job from report 03 §5 #3 in a very different shape from the other two directions' condensed and editorial faces. Has Latin-Extended, so ñ á é í ó ú ¿ ¡ work. |
| Body | **Lexend** 400 to 700 | A readability-focused sans, as Gen-Z for Change uses (report 03 §7 alternates). Friendly geometry that pairs with Unbounded, and it stays comfortable at 17px. |
| HUD / numbers | **Jersey 15** | A pixel face that looks like a sports scoreboard, used for XP, scores, dates and eyebrow labels. It always sits at 15px or larger, and essential information never depends on it alone. |

**Why Jersey 15 and not Pixelify Sans:** v1 used Pixelify Sans. In the screenshots its "5" read as "S" and its "2" read
as "8", so the scoreboard's **27% rendered as "87%"**. I tested ten pixel faces side by side, and Jersey 15 had the
clearest digits.

**No layout jump on font load:** three metric-matched fallback `@font-face`s (local Arial/Liberation Sans with
`size-adjust` 133% / 109.5% / 66%, widths measured in-browser) plus a reserved headline height. With fonts blocked,
the layout is pixel-identical to the loaded one. CLS went from 0.29 to **0.005** (desktop) and **0.001** (mobile).

**Type scale** (fluid, `clamp()`):
- H1 hero: 2.3rem to 5.4rem (37px at 390, 86px at 1440), weight 800, leading 1.02, tracking -0.035em.
- H2 sections: 1.8rem to 3rem. H3 cards: 1.08 to 1.4rem.
- Body: 1.0625rem (17px), leading 1.55, measure 34 to 56em.
- Small and hints: 0.82 to 0.9rem. Buttons: 1rem, bold, sentence case.
- Pixel labels and numbers: 0.95 to 1.3rem, with scoreboard numerals up to 4.6rem.

---

## 4. Shape, layout and motion

**Chunky neo-brutalist blocks:** 3px ink borders, 14 to 24px radii, hard offset shadows (6px on small blocks, 10px on
big ones), a dot-grid background, and slight tilts on stickers and cards. Bands alternate between yellow (next move),
ink (quiz), pink (squad) and blue (join), so the scroll has rhythm. The UI chrome itself stays quiet: ink, paper and
white carry the forms and reading, and the neon goes on heroes, chips and cards (report 08 technique #2, "quiet
chrome, loud content").

**Motion** (all decorative motion stops under `prefers-reduced-motion`, and anything that moves for more than 5
seconds has a pause button, per WCAG 2.2.2):
- **Press buttons:** they lift 2px on hover and sink 5px as the shadow collapses on press (Duolingo; report 08 #9).
- **XP fly:** a "+15 XP" pill arcs from the button you pressed into the header HUD in 0.9s. The HUD bumps, the bar fills,
  and pixel confetti bursts from the source.
- **Level-up card:** springs in when you cross a level threshold (Seed 0, Sprout 100, Sapling 300, Cypress 700,
  Phoenix 1400, from `data/levels.js`).
- **Story card:** four slides, each 3.8s, with Instagram-style progress segments. It pauses on the pause button, and
  tapping the left or right side moves between slides.
- **Hero:** the "start" keycap presses itself every 3.2s, stickers float up and down by 6px, and the XP coins spin.
- **Marquee:** a 40s loop with a pause button. Reduced motion pauses it.
- **Stamps:** "DONE" stamps slam onto finished quests, and badges and week tiles pop in when unlocked.

---

## 5. Photos, video and illustration

**Photos** (Unsplash License, free tier, not Unsplash+; every URL returned HTTP 200 on Nov 9, 2026). The page tags
each one "stock photo, not members":

| Where | Photo | Photographer |
|---|---|---|
| Hero | Friends taking a selfie in a sunny park, `photo-1758275557330-cfd545444dc3` | Vitaly Gariev (@silverkblack) |
| Squad | Volunteer with clipboard, friends cleaning a park, `photo-1758599667729-a6f0f8bd213b` | Vitaly Gariev (@silverkblack) |
| Sunset walk | People on a lakeside path at sunset, `photo-1783676056910-e5f3b27bdcbd` | Richard Burlton (project CREDITS.md) |
| Trivia | Friends at a wooden table during a card game, `photo-1646934280686-768a69c444eb` | Jametlene Reskp (project CREDITS.md) |
| Text bank | Three friends laughing at a phone, `photo-1768299947895-06b676197f74` | Maccy (@jizhidexiaohailang) |

I **rejected** my first hero (a rooftop group selfie). On close inspection it showed a beer bottle, and the chapter
admits members from 14 and runs alcohol-free events (`data/events.js`). I also rejected a palm-tree shot because a
company logo was readable on a shirt.

**Treatment:** thick ink frames, a 1.6° tilt over a tilted, dotted yellow backing card, and game-UI stickers layered on
top: "LV 2 Sprout", "Squad 3/3", "4 weeks in a row", and a "Quest complete" toast. These are illustrative states and
are `aria-hidden`.

**Pixel sprites:** about 20 tiny sprites (12x12 grids, outlined automatically, drawn as crisp SVG `<rect>` runs, no
image files). The local motifs are the level ladder, seed to sprout to sapling to **cypress** to **Phoenix**. That
nods to Big Tree Park's 3,500-year-old cypress The Senator and its clone The Phoenix (report 01 §7). The other motifs
are a mail envelope, a calendar, the sun, an ID card, a chat bubble and a trophy.

**No Native imagery, patterns, feathers or "warrior/tribe" words anywhere** (reports 00, 01 §9, 03 §8). Level names
come from the project's levels file. Squad names are local and playful: Celery City Crew, SunRail Regulars, Chuluota
Porch Club.

**Video:** the project's six demo clips. Each card ends in one action chip, such as "Add the reminder +15" or
"Trivia Thu Nov 19 +10", and the clip only loads when someone taps it (muted, `playsinline`, with controls).

---

## 6. Signature mechanics (all of them work when clicked)

1. **Player HUD in the sticky header.** Shows your level sprite, LV, XP and a mini progress bar, and every action
   anywhere on the page feeds it. This is the Duolingo loop made visible: progress you can see brings people back
   (report 04 A2 and #14; report 08 #35).
2. **Next-move strip.** Three dated, verified actions, in order of urgency:
   - **Add the reminder**, which downloads a real `.ics` all-day event for Fri, Jan 1, 2027. It uses the civic data
     file's renewal copy, the official vote-by-mail link and 407-585-8683.
   - **Save my seat** for the Sat, Nov 14 sunset walk (DEMO).
   - **What ID to bring** after Jan 1, 2027, using the lead's required wording, which notes the court challenge.

   This answers report 02's top finding: be asked personally, with a concrete next step and a date (rank 1). It
   also uses report 04's planning evidence (B5).
3. **Quest log and player card.** Seven quests with XP, time cost and badge hints. The weekly cadence follows
   `data/levels.js` exactly:
   - one action a week keeps the streak;
   - quiet weeks fade silently, and the streak counter only appears at 2 weeks in a row;
   - Thanksgiving week is marked as a rest week;
   - XP never buys anything or decides chapter votes;
   - "check your registration" is honor-system, and the site never asks for voter data.

   Report 04 warns about BeReal-style daily-obligation burnout (A2, D7). Report 07 asks for TPUSA's Patriot Rewards
   mechanic, minus the behind-the-scenes gatekeeping: public criteria, instant badges (07 §5 #4).
4. **"What's your organizer era?" quiz into an animated impact card (the virality mechanic).** The project's own
   8-question quiz is scored by its published rules: the last question counts 1.5x, ties go to the most recent lead,
   and the mix uses largest-remainder percents. The result becomes a 9:16 story card with 4 slides: era, mix, week
   stats, and "your turn" plus a referral code. Two buttons:
   - **Send to the group chat** uses the Web Share API, falling back to the clipboard. The share text comes from the
     quiz data and the link carries `?ref=CODE&utm_*`.
   - **Save image** renders a 1080x1920 PNG on canvas, with the pixel sprite, mix bars and a DEMO tag.

   Sources: Wrapped identity cards, the NYT dialect quiz, STEPPS social currency, and group chats as the place
   sharing actually happens (report 04 A2, B1, B7, B9; report 08 #28 and #30). The card never carries answers, only
   the type and demo XP.
5. **Bring-your-squad link.** Type your first name and you get a readable code (no vowels, no look-alike characters,
   per `config.js`, e.g. `KIRA7QX`). Two buttons: **Copy my link** and **Text it** (Web Share, else `sms:`). Three
   squad slots fill as friends join. In the demo one join is *simulated*, labelled "(simulated, DEMO)", to show the
   +60 XP Plus-One loop. The copy is two-sided ("you both get the sticker pack") and never shows who didn't join. The
   basis: friend-to-friend texting beats broadcast (Outvote: 8.3-point complier effect), Dropbox's two-sided reward,
   and K-factor (report 04 B4, B6, #12).
6. **The Squad Cup (DEMO).** An opt-in squad leaderboard: squad names and city tags only, no people ranked by name, a
   "most improved" trophy, and your own squad's row updating live with your XP. Report 04 #15 and D4 warn that
   shame backfires; report 07 §7 asks for opt-in, first names only, and no points for confronting people.
7. **Partiful-style events.** Each card has big cover art, a tilted date sticker, vibe chips, "who's going" monogram
   faces, the cost, and access details up front. There's a one-tap **Save my seat** form: first name, email or mobile,
   and an optional "anything that would make this easier?" field. On success, a "You" face joins the stack, the
   count goes up, and an **Add to calendar** `.ics` button and a **Text this to a friend** button appear. Report 02
   says only 4 of 22 chapter sites show a working calendar; report 08 calls Partiful the event page to beat.
8. **The Reel plus "Post your 60 seconds."** A swipeable row of vertical clips, each ending in an action chip, led by
   a dashed "post yours" tile. That opens an inline form: paste a TikTok, Reel or Short link, or pick a file that
   stays local in the demo. It validates the link host and has three consent boxes, including the guardian OK for
   anyone under 18, plus the line "a real person watches every video first." The basis is report 06 §3 (link-posting
   first, human review) and report 02 (29% of young people create political content; 0 of 22 chapter sites take
   uploads).
9. **The real scoreboard.** Four real, sourced numbers in arcade high-score type. Each links to its source, the
   unofficial ones are labelled, and the section says "No demo numbers in this one." This beats the right's
   unlinked big-number proof (report 07 §5 #2) and follows report 02 rank 4 (proof that effort matters locally).
10. **Join and the Thursday Letter.**
    - Join has two required fields with visible labels and `autocomplete`. The voting ($20 a year, January) and
      non-voting ($0, hardship or citizenship) choices are equal-weight cards, and choosing either unlocks the same
      "Card Carrier" badge.
    - SMS consent is unchecked, uses CTIA-style wording and links Privacy (report 06 §7.2).
    - "Pay dues on ActBlue" uses the real `ydscdues` link from `config.js`.
    - The newsletter uses the project's Thursday Letter copy and a demo excerpt, with no guilt and no fake urgency.

**Also:** a real **ES toggle** swaps the hero, nav, section heads, next-move copy, the quiz and the events into
Spanish (from the data files, with my own Spanish for the UI strings, flagged for native review). There's a
**designed dark mode** (report 08: only Partiful shipped one), a skip link, a pausable marquee, and a DEMO bar that
can't be dismissed.

---

## 7. How it beats the benchmarks (measured on this prototype, Nov 9, 2026)

| Check | Organizer Arcade | Benchmark |
|---|---|---|
| First-view transfer | **375 KB, 9 requests** (901 KB after a full scroll, before any video tap) | TPUSA home 19.0 MB, start-a-chapter 28.6 MB (07 §2); median Gen Z brand 6.8 MB (08 §3) |
| Layout shift | **CLS 0.001 to 0.005** | Alo 1.37, e.l.f. 1.18, Trump Sneakers 0.71 (07, 08) |
| Modals on first visit | **0** | 9 of 23 brand stores; TPUSA, Trump Store and whitehouse.gov (07 §6 #2; 08 §3) |
| Accessibility | **0 axe violations**, light and dark | 18 of 23 right-wing pages failed axe (07 §6 #3) |
| Spanish | Toggle in the header; quiz and events fully bilingual | 0 of 23 right-wing pages (07 §6 #4) |
| Third-party hosts | **3** (Google Fonts CSS and files, Unsplash images), no ad pixels | TPUSA 49 to 60; median brand 37 (07, 08) |
| Dark mode | Designed, both themes AA+ | 1 of 29 brand sites (08 §3 #5) |
| First-screen ask | Social and free ("Join free +50 XP", "See this week's quests"); Donate sits in the footer as "Chip in (or just come)" | Donate-only first screen on TPUSA mobile (07 §4.1) |
| Fun and desirability | Quiz, story card, XP, streaks, badges, a squad cup, sprites, and a toy-like HUD you can feel | Club America scrapbook, AmFest neon (07); Starface toy-box, Duolingo press buttons (08) |

---

## 8. Voice (report 05)

The voice is the friend in the group chat who knows the deadline. Headlines are sentence case. There are no emoji in
copy (pixel sprites do that job), at most one exclamation mark per screen, and the slang is gaming *mechanics*, not
brand slang: quests, XP and "press start" are UI labels, not "slay" or "bestie".

- **Hero:** "Press start on Seminole County." The sub honestly pairs the county win with the state loss, marks the
  result unofficial, and ends on the plan.
- **Microcopy:** "Came alone? Perfect." "That email's missing an @. Happens to everyone." (report 05 sample line 13).
  "Chip in (or just come)."
- **Serious items stay calm:** the ID rule, the deadline and the scoreboard get no confetti.

---

## 9. Facts on the page, and where they come from

| Claim on the page | Source |
|---|---|
| Seminole voted blue for governor on Nov 3; about 54% (unofficial; certification due Nov 16) | Report 00; [Seminole election-night results](https://enr.electionsfl.org/SEM/4119/Summary/); report 01 §5b |
| Every mail-ballot request runs out Dec 31; renewing covers through 2028 | [F.S. 101.62](https://www.flsenate.gov/Laws/Statutes/2025/101.62); `data/civic.js` (na-renew-reminder-2026); [SOE vote-by-mail](https://voteseminole.gov/how-to-vote/vote-by-mail/) |
| Student IDs stop counting at the polls Jan 1, 2027; being challenged in court | [HB 991 summary](https://flsenate.gov/Committees/BillSummaries/2026/html/991); report 00 (required wording) |
| 1 in 3 Seminole voters is 18 to 40 (124,626); 34% of them are NPA | [SOE District Demographic Analysis, Jul 1, 2026](https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf); report 01 §6c (36.8% and 34.3%, computed) |
| About 27% youth turnout nationally, second-highest midterm in 30 years (early estimate) | [CIRCLE 2026 election hub](https://circle.tufts.edu/2026-election); report 00 |
| Ages 14 to 39; $20 a year in January; non-voting membership for hardship or citizenship status | [ActBlue ydscdues](https://secure.actblue.com/donate/ydscdues); report 00 |
| Sunset about 5:32 pm on Nov 14; event details | `data/events.js` facts[] (all events are DEMO) |

I invented no statistics, quotes or endorsements. No politician is named or pictured; the scoreboard says "the
Democrat" without naming the candidate. Footer: "Paid for by [committee name and address placeholder]" plus a
visible DEMO line.

---

## 10. How it extends to the other pages

The system is tokens plus about ten components: press button, block, sticker, XP chip, pixel sprite, quest row, event
card, story card, leaderboard row and scoreboard tile. Each page reuses them:

- **Events list and event pages:** the event card grows into a full page, with a cover hero, an "Add to calendar /
  Text a friend / +1" bar, a who's-going stack, collect-info fields, a waitlist when full, and a map link.
  `@view-transition` can morph the card into the page.
- **Quests and profile (`/play`):** the player card gets a full page: the badge cabinet with unlock rules, a streak
  calendar, a quest history and a printable member card. Check-in QR codes at events unlock badges (server-checked on
  the real domain).
- **Quiz results (`/era/<type>/`):** six pre-rendered static pages with their own OG images built from the canvas
  card, so a shared result previews correctly in iMessage without JavaScript (report 04 B7).
- **The Reel (`/reel`):** a full vertical feed, with a "Post your 60 seconds" page that goes through the existing
  `functions/api/video-upload.js` review queue.
- **Vote hub (`/vote`):** the next-move strip grows into the 2027-ready voting hub (report 01 §9 #4). It stays in calm
  mode: no XP confetti on legal information, just "done" ticks.
- **Squads (`/squad`):** a "Start a squad" kit, squad pages that show only public meeting places, and the full Squad
  Cup with most-improved.
- **Join and Thursday Letter archive:** the same form components and the letter template from `data/newsletter.js`.
- **Receipts:** scoreboard tiles fed by real chapter numbers once they exist; demo tiles stay labelled.
- **December "Seminole Wrapped":** the story-card engine, fed by a member's real year.

---

## 11. Honest self-critique and open items

- **Game language is a risk.** "Press start", XP and quests are light winks. Overdone, they could read as gimmicky
  for a civic group, or as gamifying something serious. I kept legal and voting information in plain, calm copy
  without confetti. It's worth a five-person gut check with members under 30.
- **The page is long on mobile** (about 16,400px). The quest log (7 rows) and the quiz plus card (about 1,400px) are
  the heaviest parts. A production version could show 4 quests with "see all", and collapse the quiz to a
  start-button card on mobile.
- **On mobile the hero is text-first:** the photo starts just below the first screen. Both CTAs are visible without
  scrolling, but the first screen is mostly type.
- **Demo-only behaviour:** the simulated squad join, the Squad Cup numbers, the going counts, the XP stored in the
  browser and the clip "review queue" are all labelled DEMO. The real system needs a backend for check-ins, referral
  attribution and moderation.
- **Decisions the chapter or counsel needs to make:**
  - Rewards: are non-cash perks for volunteers OK under the chapter's campaign-finance status? (report 07 Q3)
  - Minors: what is the policy on photos, uploads and SMS for members aged 14 to 17? (report 06 §7.4)
  - The final disclaimer wording (Fla. Stat. 106.143).
- **Spanish needs native review.** In particular "Dale play en el condado de Seminole" and the UI strings. Hero
  stickers stay in English.
- **Platform gaps:** Google Fonts and Unsplash should be self-hosted at launch. The demo share URL falls back to
  `youngsemdems.com`, whose ownership isn't confirmed (report 02 §1). Social handles stay unlinked until verified.
