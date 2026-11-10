# Direction B: "Sunshine Editorial"

Homepage prototype for the Young Democrats of Seminole County (YDSC, "Young Dems"), built Mon, Nov 9, 2026.

The idea is that the homepage is an issue of a magazine. You get a masthead, an issue number and date, a cover photo with one big cover line, and a contents list whose "page numbers" jump to the sections. Every section is a recurring, named feature, the same way Service95 runs named series (report 05, §1.2): The One Thing, Debrief, The Lineup, Cover Star, The Reel, The Thursday Letter. The colors come from a Florida sunset (tangerine, coral, hot pink, sun yellow), with one hard cut of electric blue. Every photo gets a golden-hour grade. The result should feel glossy, warm and local, never like a party site.

- Files: `index.html` (one self-contained document; CSS and JS inline, no build step), `media/` (5 demo clips and posters copied from the repo's `assets/video/`), `shot-mobile.png` (390 x 844 viewport, full page, 2x), `shot-desktop.png` (1440 x 900, full page). `shot-*-dark.png` and `tools/` (the screenshot, functional, axe and weight scripts) are extras.
- Run locally with `python3 -m http.server` from this folder (file:// also works). The only outside hosts are Google Fonts and images.unsplash.com.

---

## 1. Palette

Bright colors are fills that sit under dark ink. They never carry body text on cream (report 03, §6). The palette has no flag red, no navy and no red-white-blue arrangement. The blue is an electric cobalt in the Mamdani `#2619D1` lineage (report 03, §3), and it shows up once per page, as the "serious" color.

| Token | Light | Dark ("after sunset") | Role |
|---|---|---|---|
| `--paper` | `#FFF3E8` | `#160C14` | page background (cream / deep plum night) |
| `--paper-2` | `#FFE2CC` | `#241520` | Join band, hover fills |
| `--surface` | `#FFFFFF` | `#2B1A26` | cards and forms |
| `--ink` | `#1C0F17` | `#FFF1E6` | text |
| `--muted` | `#6A4A55` | `#C9B3BE` | secondary text |
| `--pink-text` | `#B4135A` | `#FF7FB2` | pink used as text: masthead "Dems", page numbers, errors |
| `--link` | `#2741FF` | `#8E9CFF` | links |
| `--tangerine` | `#FF9A1F` | same | fill |
| `--coral` | `#FF6A55` | same | fill |
| `--pink` (hot pink) | `#FF3D8B` | same | fill, clip action chips, sticker |
| `--sun` | `#FFD23F` | same | fill: marquee, sticker, highlights |
| `--blue` (electric) | `#2741FF` | same | Debrief band and real-event tags |
| `--peach` | `#FFB199` | same | soft fill |
| `--sunset` | gradient `#FFD23F → #FF9A1F → #FF6A55 → #FF3D8B` | same | the One Thing card, footer rule, wordmark sun |

Text that sits on a fill uses a fixed `#1C0F17` in both themes. Text on the blue band uses a fixed `#FFF3E8`.

**WCAG 2.2 contrast of the key pairs** (computed with `tools/contrast.py`, WCAG relative-luminance formula):

| Pair | Ratio | Grade |
|---|---|---|
| ink `#1C0F17` on paper `#FFF3E8` | 17.02 | AAA |
| muted `#6A4A55` on paper | 7.06 | AAA |
| muted on paper-2 `#FFE2CC` | 6.24 | AA |
| pink-text `#B4135A` on paper | 6.05 | AA |
| blue `#2741FF` on paper (links) | 5.85 | AA |
| cream `#FFF3E8` on blue (Debrief body text) | 5.85 | AA |
| white on blue (real-event tag) | 6.39 | AA |
| ink on sun `#FFD23F` | 12.87 | AAA |
| ink on tangerine `#FF9A1F` | 8.76 | AAA |
| ink on coral `#FF6A55` | 6.59 | AA |
| ink on hot pink `#FF3D8B` (Cover Star band, clip chips) | 5.57 | AA |
| ink on peach `#FFB199` | 10.62 | AAA |
| sun on ink (DEMO tags, Reel handles) | 12.87 | AAA |
| placeholder `#8A6F79` on white inputs | 4.54 | AA |
| dark: `#FFF1E6` on `#160C14` | 17.30 | AAA |
| dark: muted `#C9B3BE` on `#160C14` | 9.73 | AAA |
| dark: link `#8E9CFF` on `#160C14` | 7.61 | AAA |
| dark: pink-text `#FF7FB2` on `#160C14` | 8.14 | AAA |
| dark: `#FFF1E6` on surface `#2B1A26` | 14.84 | AAA |

These fail, so they are decorative only: hot pink on cream (about 3.0), white on hot pink (3.34), sun on blue (4.43, large text only). axe-core 4.x (WCAG 2.0 to 2.2 A/AA rules) reports **0 violations** in light and dark mode at 390 and 1440 px (`tools/axe.js`, run after the reveal transitions settle).

## 2. Fonts (Google Fonts, SIL OFL, so they can be self-hosted at launch)

| Role | Family | Settings |
|---|---|---|
| Display: masthead, headlines, numbers, letter sign-off | **Fraunces** (variable: opsz, wght, SOFT, WONK, italic) | opsz 144, weight 800 to 900, SOFT 60 to 100. Italic with WONK 1 is the "script" accent, one phrase per headline ("Come as you are. *Bring a friend.*") |
| Labels: eyebrows, folios, buttons, tags, stickers | **Bricolage Grotesque** (wdth 75 to 100, wght 700 to 800) | wdth 78 to 88, uppercase eyebrows tracked 0.12 to 0.16em |
| Body and UI | **Figtree** 400 to 800 | 17px / 1.55; letter body 18.5px / 1.62 |

This is report 03's Pairing 2 logic (an editorial grotesque, a friendly body face and one serif-italic accent), with Fraunces in place of Instrument Serif. Fraunces gives the soft, wonky, glossy-magazine display that the brief asks for, and its italic covers the "one script word" technique (report 08, technique 4) without a fourth family. All three cover Spanish diacritics. Bricolage is requested without its opsz axis, which cut its file from 131 KB to 78 KB.

**Type scale** (all fluid with `clamp`/`calc`; mobile → desktop):

| Step | Size | Use |
|---|---|---|
| Masthead | `(container width) / 5.2`, so 66px → 235px | "Young *Dems*", fits the width exactly at any viewport |
| Display (h2) | 42 → 104px, line-height .95, tracking -0.028em | section headlines |
| Cover line | 36 → 74px | on the cover photo |
| Stat / countdown | 52 → 128px | 54%, 53 days |
| h3 | 24 → 46px | cards |
| Lead | 19 → 23px | decks |
| Body | 17px (letter 18.5px) | |
| Label | 12 to 15px uppercase | eyebrows, tags, folios |

## 3. Layout

- **Cover:** a folio rule (issue number, "The after-election issue", date), a masthead as wide as the container, and a sub-line ("of Seminole County · ages 14 to 39"). The cover photo carries the cover line and a die-cut "First time? Perfect." sticker. On desktop a polaroid inset and the contents list (deck, two CTAs, contents) sit in the left column.
- **Section rhythm:** each section opens with a numbered black disc, an eyebrow, a hairline rule and a folio note ("Do it this week", "Results unofficial until certified"). The full-bleed color blocks change down the page, the way Poppi gives each flavor its own color world (report 08, technique 1): cream cover → sun-yellow ticker → sunset cards → electric-blue Debrief → cream Lineup with coral/sun/pink cards → pink-to-tangerine Cover Star → ink Reel → peach Join → cream Letter → ink footer.
- **Phones (390px):** single column. The One Thing, Lineup and Reel are horizontal snap strips that scroll inside their own container, so the page never scrolls sideways (`document.documentElement.scrollWidth` = 390, measured). Tap targets are 44px or larger, and the header keeps Join visible at all times.

## 4. Motion

- **Load:** the masthead rises like a sunrise (0.9s), and the "First time?" sticker slaps on with an overshoot.
- **Scroll:** headlines and cards rise in (IntersectionObserver). The cover and letter photos get a slow Ken Burns drift via `animation-timeline: view()` inside `@supports`, now Baseline (report 08, technique 10).
- **Ticker:** a sun-yellow marquee of every city ("Sanford ✦ Lake Mary ✦ … and everywhere in between") with a visible pause button (WCAG 2.2.2).
- **Tactile buttons:** every button has a hard offset shadow that collapses on press (Duolingo, report 08, technique 9).
- **Rewards:** a sticker-slap ("Seat saved", "You're in") appears on RSVP and join success (technique 12).
- **Reduced motion:** `prefers-reduced-motion` turns off every animation and transition, and the marquee becomes a static wrapped list.

## 5. Photo and illustration treatment

- **Golden-hour grade:** a soft-light gradient (sun-yellow top to hot-pink bottom), a 118° white gloss sheen and a faint SVG film grain sit over every editorial photo. Stock photos from different shoots end up looking like one shoot, shot at 6:45 pm.
- **Color-world duotone on event art:** the photo goes grayscale and multiplies into the event's color (coral, sun or pink). This is Partiful's rule that the invite art supplies the color while the chrome stays quiet (report 08, technique 2).
- **Die-cut stickers** (white keyline plus drop shadow) carry the playful asides. There is no illustration system beyond type, stickers and the sun disc. No mascots, no flags, no donkey and no Native motifs. Visual cues come from the place: the sunset, the lake and the list of cities.
- **Labels:** every photo is labeled "Demo photo · Unsplash" and every person, clip and count is labeled demo. The footer says the people in the photos aren't members and don't endorse anything.

**Photos used** (each URL returned HTTP 200 on Nov 9, 2026; checked by eye on contact sheets for fit and for no politicians, no Native imagery and no brand logos):

| Use | Unsplash ID | Content | Credit |
|---|---|---|---|
| Cover | `photo-1758272134088-d3d58d939d12` | diverse friends in a rooftop selfie | Vitaly Gariev (per repo CREDITS.md) |
| Polaroid (desktop) | `photo-1529333166437-7750a6dd5a70` | three friends, arms up at sunset, seen from behind | photographer to confirm |
| Tacos & Talk | `photo-1565299585323-38d6b0865b47` | tacos with lime | photographer to confirm |
| Riverwalk Cleanup | `photo-1783676056910-e5f3b27bdcbd` | two people by a lake at sunset | Richard Burlton (CREDITS.md) |
| Trivia Night | `photo-1646934280686-768a69c444eb` | friends playing cards at a table | Jametlene Reskp (CREDITS.md) |
| Letter | `photo-1511632765486-a01980e01a18` | four friends hugging at sunset, from behind | photographer to confirm |
| Reel posters | repo `assets/video/*.jpg` | demo clips, already labeled "DEMO CLIP" | see repo CREDITS.md |

I rejected a candidate photo of a real politician that turned up in a batch, along with brand-logo images.

## 6. Signature mechanics (all of them work when clicked; checked with `tools/func.js`)

1. **The homepage as an issue.** The masthead, issue number and folio rules, plus a contents list where each cover line ("02 · The one thing: your mail ballot request runs out Dec 31") jumps to its section. Rituals over noise (report 05, principle 12).
2. **The One Thing strip with an honest countdown.** "Your mail ballot request runs out Dec 31." The days-left number is computed live from the date in Eastern time against the real statutory deadline, not a fake timer. "How to re-request" links to voteseminole.gov. "Remind me in January" downloads an `.ics` reminder for Mon, Jan 4, 2027 at 10 am. Next to it: the next hangout, and the Jan 1, 2027 student-ID change in exactly the shape report 00 requires.
3. **Cover Star (the virality mechanic).** A share-card generator: first name, city, "I'm here for…" (8 issues), colorway (Golden, Pink or Blue hour) and an optional selfie that never leaves the device. A 1080 x 1920 magazine cover renders live on a canvas. "Save my cover" downloads a PNG. "Send to the group chat" uses the Web Share API with the image file, and falls back to copying a friend-voiced invite plus link. "Bring three" gives a personal `?ref=name-xxxx` link and three empty squad slots. The card carries "DEMO · ages 14 to 39" so a shared screenshot can't mislead anyone. This is Spotify Wrapped's identity card, adapted for civic action (report 04, A2; report 08, rank 1).
4. **Partiful-grade RSVP.** No account. An inline panel (not a modal) asks for a name (required), a +1 toggle and access needs (rides, ASL, quiet corner, kids). Success shows a sticker, the going count goes up, your initial joins the face pile, and you get "Add to calendar" (`.ics`) and "Invite a friend". Every card shows date, am/pm time, place, Free, access vibes and "who's going (demo)". December's lineup is announced as a dated drop (report 08, rank 2). The real Seminole County Democrats monthly meeting (Thu, Nov 12, 7 pm, Altamonte Springs, open to the public) is included and labeled "Real event", linking to the party calendar (report 01, §1a and rec. 11).
5. **The Reel plus "Post a clip".** Vertical 9:16 cards with posters first. Clips play only on tap (muted, inline, with controls), and each one ends in a single action chip (re-request, RSVP, check registration). "Post a clip" opens an inline form: paste a TikTok, Instagram or YouTube link (validated) or pick a video, an optional caption, and three unchecked consent boxes from report 06, §3.2 (rights, everyone agreed, under-18s need a parent's OK). A "Pending review · only you can see this" card is added to the strip, with the promise that a human watches every clip first.
6. **Membership, honestly, plus the Thursday Letter.** Three tiers: $0 to come to things; $20 a year, paid in January, to vote in the chapter; $0 non-voting membership for anyone who can't pay because of money or citizenship status. The two-field join form adds an optional access-needs field, and a plain privacy promise sits next to it. There is a no-guilt "Got $5 to spare? … Come anyway" chip-in linking to the public ActBlue page. The letter section is a Service95-style letter: a moment from the writer's week, a widening to "we", one action, and the sign-off "See you Thursday. Maya, for the Young Dems xo". Maya is labeled a demo writer.

Also included:

- A working EN/ES toggle that swaps the hero, navigation, CTAs, contents and section heads. The Spanish is my draft, the page says so in a banner, and it needs native review.
- A designed dark mode that follows the OS, with a toggle.
- No modal of any kind.
- No trackers.

## 7. How it reflects the research

- **Voice (05).** The voice is a friend in the group chat who knows the deadline. The hero line is report 05, §9 sample line 1, trimmed: "Come as you are. Bring a friend."
  - Sentence-case headlines, at most one exclamation mark per screen (there are none), and no emoji in long copy.
  - Times are written like "7 pm". Every acronym is explained or avoided.
  - Success, error and empty states reuse §9's patterns: "That email's missing an @. Happens to everyone." and "You're in. Your first letter lands Thursday. Go drink some water."
  - Serious things get the serious register: the Debrief band has facts first, one honest feeling, one action, no confetti and no donation ask (§3, principle 8; §11, rec. 5).
- **Facts (00, 01).** Every claim is from the reports and is linked on the page:
  - Every mail-ballot request expires Dec 31, 2026 (F.S. 101.62(1)(a)).
  - Student IDs stop counting on Jan 1, 2027, under challenge (HB 991; Oct 16 complaint).
  - Seminole picked the Democrat for governor by nearly 10 points (about 54% to 44%, unofficial, certification due Nov 16).
  - Statewide, the Republican won by about 1 point.
  - 34% of Seminole voters aged 18 to 40 are NPA, the largest bloc (SOE, Jul 1, 2026; the SOE's own age band).
  - 27% youth turnout nationally (CIRCLE, preliminary).
  - The SemDems monthly meeting.
  - Dues: $20 a year, paid in January, with a non-voting option.
  - Ages 14 to 39 ("40 and under" appears nowhere).

  No candidate names or faces appear. Independents are invited in ("Independents and the not-yet-sure are welcome"), not scolded (report 00, tone implication).
- **What young Dems want (02, §5).**
  - Asked personally with a dated next step: the One Thing strip and the Lineup.
  - Friends and fun: food, trivia and a cleanup, each with vibe tags.
  - Low cost: free events, a $0 tier and "Come anyway".
  - Proof it matters: real sourced stats, plus a receipts promise.
  - Trustworthy voting info: official links only, "checked Nov 9, 2026".
  - Makeable content: Post a clip and the Cover Star.
  - Representation: access fields, LGBTQ+ and Spanish preferences, the ES toggle.
- **Left design systems (03).**
  - Look like the place, not the party (principle 1): the cities ticker, the Riverwalk, Oviedo's chicken round, Lake Monroe light.
  - Leave the flag palette (principle 2).
  - Type-first and loud (principle 3): the masthead is the logo.
  - Every viral moment ends offline (principle 10): every clip has an action and the cover card points to the next hangout.
  - Palette 3 "Flamingo Sunset" is the closest relative. I warmed it toward Florida dusk and kept its cobalt as the electric blue, and kept the contrast discipline. Report 03 flags that pink-forward palettes risk reading as gendered, so blue, ink and sun carry the Debrief, Reel and Join sections.
- **Virality (04).**
  - Social currency: the cover card.
  - Strong ties: "bring three" and friend-voiced share text ("I just made my Young Dems cover. Come to the next one with me?").
  - Plan-making: calendar files.
  - Practical value: the countdown and reminder.
  - Honest counters: everything labeled demo.
  - No fake urgency: the only countdown is a real legal deadline.
- **Gen Z brand bar (08, §7).**
  - Hero who and what in 8 words or fewer.
  - One primary action above the fold on a 390px phone, with no modal (measured).
  - At least 3 saturated full-bleed colors, with text at 4.5:1 or better.
  - An expressive display face plus a legible body face plus one accent.
  - A share-ready 9:16 card.
  - Event pages with RSVP, who's going, `.ics`, +1 and collect-info-up-front fields.
  - A dated "next drop".
  - A vertical video band in the first screens, each clip with one action, plus a "post yours" path with the moderation promise.
  - Personality microcopy with plain consent text.
  - Press states and success moments.
  - A designed dark mode.
  - Honest proof, accessibility, brand safety, and a reason to come back next week (the Thursday Letter, December's drop).
- **Beating the right-wing sites (07).**

  | Spec from 07 | This page (measured) | Their pages |
  |---|---|---|
  | Primary action on the first mobile screen, social not money | "Count me in" + "See what's on" both on screen at 390 x 844; Donate sits low and secondary | TPUSA home: Donate is the only first-screen ask |
  | No first-visit modals or walls | none | TPUSA, Trump Store, PragerU, whitehouse.gov: modals or banners covering 21 to 41% |
  | Spanish | working toggle (draft) | 0 of 23 |
  | axe violations | 0 (light and dark, 390 and 1440) | 18 of 23 failed |
  | Trackers and outside hosts | 0 trackers; 3 hosts (fonts.googleapis.com, fonts.gstatic.com, images.unsplash.com) | 8 to 10 tags, 49 to 84 domains |
  | Weight | about 503 KB first view on mobile and about 1.2 MB after a full scroll (clips load only on tap) | TPUSA home 19.0 MB |
  | Belonging copy and local layer | "Come as you are", city ticker, real county event, crews of friends | Seminole GOP: no events, no youth path |

## 8. How it extends to the other pages

- **One system:** the masthead, folio rules, numbered section heads, the color-world rule and the sticker or tag kit all become `tokens.css` plus a small component set: `.sec-head`, `.thing`, `.ev`, `.clip`, `.tier`, `.chip`, `.btn`, `.sticker`, `.tag--demo` and `.tag--real`.
- **Event page:** the `.ev` card blown up, Partiful-style. A full-bleed duotone cover in the event's color, a date stub, who's going, the same inline RSVP, the `.ics` and invite actions, a "First time? Here's what happens" block, and access details. Each event gets a static OG image rendered from the same canvas code as Cover Star.
- **Vote hub ("2027 Ready"):** a run of One Thing cards (renew the mail ballot, the ID change, check registration, polling place, key dates). Each card shows a source line, a "checked" date and an `expires` field driven by `data/civic.json`. Serious notices use the blue Debrief template.
- **The Reel page:** the clip strip becomes a grid, with filters by tag and the Post panel kept at the top. Clips render from `data/clips.js` (`YSD.clips`).
- **Cover Star results:** a set of pre-rendered result pages (`/cover/clean-lakes/`) with their own OG tags, so a shared link previews properly without JavaScript (report 04, B7).
- **Letter archive:** each Thursday Letter is an "issue" page with the drop cap, byline and sign-off. The homepage masthead's issue number goes up every week.
- **Join, Receipts, About and Bylaws:** the tier cards and joinform are reused. Receipts is a ledger in the Debrief style (blue, tabular figures in Fraunces).
- **Spanish:** an `/es/` copy of every template via the same `data-i18n` keys, reviewed by native speakers. The cover canvas already renders Spanish lines.
- **Portability:** there is no build step, and the ActBlue and voting links match `assets/js/config.js`. Swapping in the real `site.url` updates the invite links, because `baseUrl()` falls back to youngsemdems.com only when the page is opened from a file.

## 9. Self-critique and what changed between rounds

- **Round 1** (first screenshots):
  - The masthead clipped at 390 and at 1440. I replaced the vw guess with a measured width/size ratio of 4.92 and now size it as container ÷ 5.2.
  - The Cover Star form overflowed to 504px on phones. Fieldset `min-inline-size` and the nowrap referral link were the causes, fixed with `min-width:0` and `minmax(0,1fr)`.
  - Buttons inside the blue and dark bands lost their text, because section link colors beat `.btn`.
  - The empty toast showed up in full-page captures.
  - Phone screenshots past 16,384 device px rendered blank. I now capture in chunks and stitch them.
- **Round 2:**
  - The polaroid stretched to 190 x 428 and covered the cover line, so I gave it `height:auto` and moved it to the top-left.
  - The masthead "g" descender was clipped.
  - The CTAs were pushed below the fold on phones. I changed the cover photo to 6:5 and kept the sub-line to one line, and both CTAs now sit inside the first 844px.
  - Two-line "DAYS TO / GO" and widowed headlines got `text-wrap: balance`.
  - The header wordmark wrapped.
- **Round 3:**
  - Dark mode put the $20 tier's yellow on cream, which I fixed.
  - Error text failed contrast on dark surfaces.
  - axe flagged two accessible-name mismatches and one 4.24:1 folio, all fixed, and axe now reports 0.
  - The canvas cover lines ran into the sun disc.
  - The Lineup now leads with the chapter's own photo events. The real county-party meeting moved to the end as "Also this month". That trades strict date order for a stronger first card, and the real event stays clearly labeled.
- **Honest weak spots:**
  - The cover photo is stock, and it reads as stock despite the grade. Real member photography (with consent) would change the page more than any CSS.
  - The desktop masthead is very large. That is on purpose (A24 or Paper-magazine energy), but a judge might find it heavy.
  - First-view weight is about 503 KB, above report 07's 350 KB goal. The causes are Fraunces' two variable files (about 270 KB) and the hero photo. Self-hosting instanced subsets (opsz 144 and three weights) should get under 350 KB.
  - Bricolage Grotesque's glyphs are hard to tell apart from a generic grotesque at small sizes on the canvas.
  - The Spanish covers only the key strings and is unreviewed.
  - The "Bring three" squad slots don't track anything yet (they say so).
  - Event venues are "TBA" so no real business is implied.

## 10. Open items for the chapter

- Confirm the dues wording, and whether membership votes require residency or a Seminole school.
- Confirm the sign-off "xo", and who signs the letters.
- Supply real events, people, photos and counts to replace every DEMO label.
- Provide the committee name and address for the "Paid for by" line (report 06, §7.1).
- Name a moderator for clips, and set a response time.
- Confirm the social handles before linking them (`config.social.*.url` is empty on purpose).
- Ask the SOE (407-585-8683) when new 2027 to 2028 mail-ballot requests start counting, and adjust the One Thing copy if requests made in Nov or Dec 2026 don't carry over.
- Re-check the Nov 3 figures after certification on Nov 16.
