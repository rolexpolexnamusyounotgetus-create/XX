# Direction A · "Group Chat": rationale

Homepage prototype for the **Young Democrats of Seminole County (YDSC)**, built Mon, Nov 9, 2026. This is a demo awaiting the chapter's sign-off. Every event, person, count and clip that isn't real carries a visible DEMO label.

Files in this folder:

- `index.html`: a full document with semantic landmarks.
- `a.css`: all tokens and components.
- `a.js`: interactions, plain JS with no dependencies.
- `media/`: five demo clips, copied from the repo's `assets/video/`, with small posters.
- `shot-mobile.png`: 390 x 844 viewport, full page, DPR 1.
- `shot-desktop.png`: 1440 x 900 viewport, full page.

There is no build step. Open `index.html` directly or serve the folder.

---

## 1. The idea in one line

The site should feel like the best group chat you're in, crossed with an IG story: someone always knows the deadline, the plan for Thursday is already pinned, and sending an invite takes one tap. Report 05's voice line ("the friend in your group chat who always knows the deadline and always has a good plan for Thursday night", §3) is the whole design brief. Every section is a chat object:

| Section | Chat or story object |
|---|---|
| Hero | A live group thread that types itself out, ending in a Partiful-style invite bubble you can RSVP from |
| Next thing to do | Pinned messages, sorted by deadline |
| Virality | An invite card generator: "Send it to the group chat" |
| Video | Story cards with progress bars, captions and an action chip each |
| Events | Invite cards with "I'm in / Maybe / Can't" |
| Facts | Sticker-like receipts with sources |
| Join | "Get in the chat" |
| Newsletter | A long message bubble from a (demo) member, with a sign-off ritual |

It is loud: saturated full-bleed blocks, die-cut stickers, chunky pressable buttons, kinetic condensed type. It stays legible because every bright colour is a fill under dark ink, never text on cream (report 03 §6 rule).

---

## 2. Palette

The palette is built on report 03's recommended "Celery City Pop" (§6, palette 1). Ultraviolet sits between red and blue. The lime is Sanford's Celery City. Florida tangerine is borrowed from palette 2 as an issue and accent colour. The base is a warmer cream than report 03's `#F6F3FF`, to give the "warm off-white" the direction asks for. There is no red, white and blue, no navy and no garnet or gold (report 03 §8).

### Brand constants (same in both modes)

| Token | Hex | Role |
|---|---|---|
| `--violet` (ultraviolet) | `#6A2BFF` | Hero fill, "me" chat bubbles, Join button |
| `--celery` | `#C8F03C` | Primary CTA fill, ticker, Reel block, highlight text on violet or night |
| `--pink` (bubblegum) | `#FF7AC6` | Join block, sticker fills |
| `--sky` | `#4FD6FF` | Pinned card, stickers |
| `--tangerine` | `#FF8B3D` | DEMO tags, deadline card |
| `--night` | `#170B33` | Ink, dark blocks |
| `--cream` | `#FFF6EA` | Warm off-white |

### Semantic tokens: light / dark

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#FFF6EA` | `#120826` |
| `--surface` | `#FFFFFF` | `#1E1240` |
| `--surface-2` | `#F3EADB` | `#2A1B55` |
| `--text` | `#170B33` | `#FFF6EA` |
| `--muted` | `#574D70` | `#CDC4EA` |
| `--link` / `--focus` | `#4B12D6` | `#C8F03C` |
| `--edge` (card/button borders) | `#170B33` | `#FFF6EA` |
| `--shadow` (hard sticker shadow) | `#170B33` | `#6A2BFF` (neon-on-dark) |
| `--bubble` / `--bubble-text` | `#FFFFFF` / `#170B33` | `#2A1B55` / `#FFF6EA` |
| `--maker-bg`, `--receipts-bg` | `#170B33` | `#0B0519` |

Dark mode is designed rather than inverted. It follows the OS by default, and a header toggle cycles Auto, Light and Dark (stored per viewer). This answers report 08's finding that only 1 of 29 benchmark sites shipped any dark-mode styles (§3.5). Brand-colour blocks keep their fills in dark mode, and hard shadows turn ultraviolet. Surfaces that stay cream or coloured in both themes (the join form, pinned cards) keep ink buttons and light native controls.

### Contrast (WCAG 2.x, computed)

| Pair | Ratio | Grade |
|---|---|---|
| Text `#170B33` on cream `#FFF6EA` | 17.33:1 | AAA |
| Muted `#574D70` on cream | 7.27:1 | AAA |
| Link `#4B12D6` on cream | 8.33:1 | AAA |
| Ink on celery `#C8F03C` | 14.12:1 | AAA |
| Ink on sky `#4FD6FF` | 10.95:1 | AAA |
| Ink on tangerine `#FF8B3D` | 7.96:1 | AAA |
| Ink on bubblegum `#FF7AC6` | 7.82:1 | AAA |
| White on ultraviolet `#6A2BFF` | 6.17:1 | AA |
| Cream on ultraviolet (hero H1, line 1) | 5.77:1 | AA |
| Hero subhead `#F1ECFF` on ultraviolet | 5.34:1 | AA |
| Celery on ultraviolet (H1 line 2, 54-132 px) | 4.70:1 | AA (AA large at any size) |
| Hero small print `#E4DCFF` on ultraviolet | 4.70:1 | AA |
| Cream on night `#170B33` | 17.33:1 | AAA |
| Celery on night | 14.12:1 | AAA |
| Section subhead `#D9D1F2` on night | 12.68:1 | AAA |
| Reel subhead `#2F2A10` on celery | 10.95:1 | AAA |
| Join subhead `#3A1530` on bubblegum | 6.66:1 | AA |
| **Dark:** text `#FFF6EA` on `#120826` | 18.03:1 | AAA |
| **Dark:** muted `#CDC4EA` on `#120826` | 11.65:1 | AAA |
| **Dark:** link celery on `#120826` | 14.69:1 | AAA |
| **Dark:** text on surface `#1E1240` | 16.14:1 | AAA |
| **Dark:** bubble text on `#2A1B55` | 14.15:1 | AAA |

Two pairs are decorative only and never carry text: celery on cream (1.23:1) and violet on night (3.01:1). An axe-core 4.x scan (WCAG 2.0 to 2.2 A and AA rules) of the rendered page found **0 violations in both light and dark mode**.

---

## 3. Type

All three families are served by the Google Fonts CSS API under the SIL Open Font License, so they can be self-hosted at launch. All include Latin Extended, so ñ á é í ó ú ü ¿ ¡ are covered. This is report 03's pairing 2 display face with pairing 1's body face.

| Role | Family | Why |
|---|---|---|
| Display | **Bricolage Grotesque** (variable: opsz 12-96, wdth 75-100, wght 200-800) | A condensed poster gothic at `font-stretch: 75-80%`. This is the type-first, loud lineage report 03 §5 (principle 3) finds in winning youth campaigns, but with a quirky contemporary feel rather than League Gothic's old-poster one. The width axis is what makes the kinetic type possible (§5 below). |
| Body / UI | **Atkinson Hyperlegible Next** (200-800) | Braille Institute low-vision legibility: accessibility as a brand value (report 03 pairing 1). Body text is 17 px at a line-height of 1.55. |
| Accent | **Caveat Brush** | A hand-marker voice for word stickers ("¡Vamos!", "come as you are") and the letter sign-off. At most a few words per screen, and never essential information (report 03 §7 rule for script accents). |

The fonts load non-blocking, and the hero copy waits up to 1.5 s for them so the font swap cannot shift layout. Production plan: self-host, subset and preload the two critical WOFF2 files.

### Type scale (fluid, `clamp()`)

| Step | Size | Use |
|---|---|---|
| -1 | 14 px | Tags, fine print, sources |
| 0 | 17 px | Body |
| 1 | 20 px | Subheads, lead copy |
| 2 | 22-28 px | Card titles, rotor line |
| 3 | 28-44 px | Dialog and success titles |
| 4 | 40-76 px | Section titles (wdth 78%, wght 800, line-height .92) |
| 5 | 54-132 px | Hero H1 (wdth 76%, wght 800, line-height .86; 64-80 px on phones) |

Headlines and buttons use sentence case (report 05 §6). Eyebrows and tags use 1-3 word ALL CAPS, letter-spaced. There is no all-lowercase branding (report 05 §6), and no emoji in long-form copy.

---

## 4. Components and shape language

- **Chat bubbles.** 18 px radius with one 6 px "tail" corner. White bubbles carry 2 px ink outlines; "me" bubbles are ultraviolet with white text.
- **Neo-sticker cards.** 2.5 px ink border, 20-36 px radii and a hard offset shadow (`6-12px 6-12px 0`). Cards sit at slight rotations (±1-2°), like stuck-on paper.
- **Pressable buttons.** Duolingo-style pressable pills (report 08 technique 10, "tactile delight") with a 4 px hard shadow that collapses on press. Every target is at least 44 px.
- **Die-cut stickers.** Seven original SVG stickers drawn for this site from Seminole's own motifs, never tribal imagery (00-lead-factcheck, brand safety; report 01 §9.9):
  - a celery bunch with a violet band (Sanford, the Celery City)
  - a gator peeking out of the water (Lake Jesup)
  - a commuter-train front (SunRail's four Seminole stops)
  - a chicken (Oviedo folklore)
  - a heart in a chat bubble
  - a sun in sunglasses
  - a mail-ballot envelope with a check

  The white die-cut edge is a chain of CSS `drop-shadow` filters.
- **Word stickers.** Handwritten pills: "¡Vamos!", "official links only", "captions on, always", "first time? perfect", "come as you are".
- **DEMO tags.** Tangerine pills on every placeholder (events, counts, clips, the chat, the perk). REAL tags are celery, used on the one real event.

---

## 5. Motion

| Motion | Spec | Purpose |
|---|---|---|
| **Kinetic H1** | Each line enters with the width axis squeezing from 100% to 72% to 76% and weight from 300 to 800, then a pink marker swipe under "that shows up." Duration .9 s, overshoot easing `cubic-bezier(.2,.9,.3,1.35)`. On hover, the H1 stretches to 96% width. | Signature moment; variable type as the brand's personality |
| **Rotor line** | "We're the friend who [always knows the deadline / has a plan for Thursday / saves you a seat / reads the agenda first / texts you back]". A 3D flip every 2.6 s, stopping after 4 loops. Screen readers get the full sentence once. | Voice from report 05, kinetic |
| **Chat replay** | Messages fade and slide in, about 650 ms apart. They keep their final positions, so there's no layout shift. Ends on a typing indicator. | The "group chat" premise in 6 seconds |
| **Section titles** | Squash-and-stretch entrance on scroll (transform only). | Kinetic type carried through the page |
| **City ticker** | All seven cities plus Geneva, Chuluota and unincorporated Seminole, on a 38 s loop. | Local pride; marquee |
| **Press, hover, success** | Buttons press down; stickers wiggle on tap; confetti on RSVP, join, save and share; a chat-bubble toast. | Report 08 desirability items 21-22 |

Accessibility of motion:

- A visible **Pause motion** button (in the ticker) stops the ticker, rotor, typing dots and chat replay (WCAG 2.2.2).
- `prefers-reduced-motion` shows everything immediately with no animation, and the ticker becomes a static, wrapped list.
- Measured CLS on load is **0.0007** (mobile) and **0.0002** (desktop).

---

## 6. Photo and illustration treatment

Photos are Unsplash stand-ins that show diverse young people, golden Florida-ish light and friends together. Each URL was checked for HTTP 200 on Nov 9, 2026, then viewed to confirm content. None shows an identifiable politician or any Native imagery. One candidate was rejected because it showed a former president.

The photos never sit full-bleed behind text. They appear inside cards (event covers with a colour-multiply tint and a dark gradient under the headline), in a tilted polaroid-style frame on the join block, and as a luminosity-blended texture on the "Post a clip" card. The hero is type, chat and stickers with no stock photo, so the first screen can't read as generic stock.

The video posters are the repo's own generated demo clips (`@demo.*` creators, DEMO CLIP watermark, burned-in captions).

Photos used (Unsplash License):

| Photo ID | Used for | Credit |
|---|---|---|
| `1543269865-cbf427effbad` | Trivia invite cover | Not yet recorded |
| `1783676056910-e5f3b27bdcbd` | Riverwalk cleanup cover (a lake path, not Lake Monroe) | Richard Burlton, per repo CREDITS.md |
| `1607748862156-7c548e7e98f4` | Join block | Not yet recorded |
| `1554080353-a576cf803bda` | "Post a clip" card | Not yet recorded |

Unsplash's site was behind a bot wall from this environment, so the three missing credits must be recorded from each photo's unsplash.com page before launch.

Every photo is labelled as a stock stand-in in its alt text, and the footer says the people shown are not members and don't endorse anything.

---

## 7. Signature mechanics (all working in the prototype)

1. **Invite card generator: "Send it to the group chat."** This is the virality loop.
   - Pick a template: a Trivia invite (demo event), a mail-ballot PSA (a real deadline) or "Join me".
   - Enter a first name and pick a city, a colourway (5) and a sticker (6). A 1080 x 1350 canvas card updates live.
   - The card carries the brand chip, the DEMO watermark, the details ticket, the ref link and a disclaimer line, because report 06 §7.1 asks for one on every share card.
   - Actions:
     - **Send to the group chat**: Web Share with the image file if supported, else text and link, else copy to clipboard.
     - **Save image**: a PNG download.
     - **Text it**: an `sms:` link with the pre-written message.
     - **WhatsApp**: a `wa.me` link.
     - **Copy**: copies the squad link.
   - The editable message is pre-written in the report 05 voice. The squad link is `youngsemdems.com/?ref=NAME+3` (no vowels, no look-alike characters, matching `config.members`).
   - A "0 of 3 friends in" squad meter shows the bring-three ladder, with a demo-labelled two-sided perk (report 04 #12; Schein et al.'s friend-text effect, report 04 B4).
2. **Shared RSVP state.** "I'm in" in the hero chat bubble, the pinned card and the event card is one state. The count changes everywhere (demo count, labelled), with confetti and a toast. "Maybe" and "Can't" get their own warm replies ("Rest counts too"). The **.ics** download works, with a 3-hour alarm. "+1 a friend" shares a pre-written invite.
3. **Pinned "next thing to do" strip:**
   - a **live countdown** to Dec 31, 2026, computed in Seminole's timezone
   - the 2027 student-ID rule in the lead's required wording
   - the next hangout (demo), with RSVP and calendar buttons
   - pre-registration at 16

   Each voting card links only to official sources and cites its statute.
4. **The Reel.** Vertical story cards with progress bars, burned-in captions and a CC badge. Clips play on tap only (muted, inline) and pause when scrolled away. Each clip ends in one action chip (report 08 technique 16). The **Post a clip** card opens a `<dialog>`: paste a TikTok, Instagram or YouTube link or upload a file, then tick three consent boxes (made it, everyone agreed, parent OK for under-18s; report 06 §3.2). It validates, and promises human review before anything goes live. In the demo nothing uploads.
5. **Inline issue picker** in the join form, with eight local issues. It echoes the choices in handwriting and carries them into the success state. This replaces the right's pop-up quiz capture (report 07 §5.8).
6. **Hidden sticker facts.** Tap any sticker for a sourced Seminole fact (celery, gators, SunRail, Oviedo chickens, the $15 minimum wage, mail ballots) or a "come as you are" note. This is report 08's toy-that-teaches (item 10) and report 04's delight layer (#23).
7. **Spanish toggle (ES/EN)** in the header swaps the first screen, nav, pinned strip, card generator, section heads and share texts. The cards themselves render in Spanish, and `<html lang>` changes. These are drafts pending native-speaker review, as labelled in the footer.

---

## 8. How it reflects the research

| Research finding | Where it shows up |
|---|---|
| Young Dems want to be **asked, with a concrete dated next step** (02 §5.1; 37% never contacted) | The hero "next up" notification, the pinned strip and every event card give a date, time (am/pm), place and cost, plus one-tap RSVP |
| **Friends and fun** (02 §5.2; only 19% joined a club but 82% talk politics with friends) | The whole chat metaphor, social-first invites, "who's going" stacks |
| **Low cost, low friction** (02 §5.3) | Two required join fields; dues shown openly ($20/yr in January) with the non-voting path for anyone who can't pay; a no-guilt chip-in line ("Don't have it? Come anyway", 05 line 20) |
| **Trustworthy voting info** (02 §5.5; 01 §3a) | Official links only, statute citations, "Links checked Nov 9, 2026", and a "confirm with the Supervisor of Elections" line on mail-ballot timing (01 §10 open question 4) |
| **Most young Seminole voters are independents** (01 §6c: NPA 34.3%; 00 tone note) | "Not a registered Democrat? Come anyway" stat card; "Events are open to everyone" |
| **Lead action through 2027: mail-ballot renewal** (00; F.S. 101.62) | Pinned card 1, the countdown, the PSA card template, the first clip's action chip, the chat thread |
| **Student-ID rule from Jan 1, 2027** (00 required copy shape) | Pinned card 2, word for word, plus "UCF and Seminole State, this one's for you" |
| **Seminole voted blue for governor, unofficial** (00; 01 §5b) | Chat thread plus a receipt card: "about 54% to 44.5%, unofficial until certified (due Nov 16); statewide, Donalds won". Motivating without gloating (01 rec 6) |
| **Look like the place, not the party** (03 principle 1) | Celery, gator, SunRail, chickens, the Riverwalk, a city ticker; no flags, donkeys or navy |
| **Group-chat sharing; strong ties beat broadcast** (04 B4, B7) | Invite generator, `sms:` and WhatsApp links, a squad link, "+1 a friend" |
| **Plan and pledge** (04 B5) | RSVP plus .ics with an alarm; PSA cards |
| **Honest counters** (04 #7, Part D.5) | Every count is tagged DEMO COUNT or demo; no fake urgency, no countdown that resets (the only countdown is a statutory date) |
| **Partiful is the event page to beat** (08 §4) | Cover art, date sticker, host line, access tags (step-free, sober-friendly, kids welcome), going stack, three-way RSVP, calendar, +1 |
| **Voice** (05 §§3-6, 9) | Opens on moments rather than missions; "I" in the letter, "we" for the team; sentence case; one exclamation per screen at most; am/pm; plain words; serious facts stated plainly; sample lines adapted ("Go drink some water", "That email's missing an @. Happens to everyone"); rituals named in 05 §7 ("The Thursday Letter", sign-off "See you Thursday. Maya, for the Young Dems xo") |
| **Inclusion** (02 §5.9) | Real ES toggle; access notes on every event; "Rides, ASL, a quiet corner, kids in tow" field; LGBTQ+ safety and abortion access in the issue picker; the "come as you are" sticker fact names LGBTQ+, disabled and Spanish-speaking people |
| **Brand safety** (00; 03 §8; 05 §5 banned list) | No Native imagery or language; no politicians as endorsers (candidates are named only as sourced election results); a grep found none of the banned words ("warrior", "tribe", "40 and under", slang cosplay, "click here") |
| **AI cut** (Kira's update) | No chatbot, "Ask" helper or LLM feature anywhere |

### Beating the right-wing benchmarks (report 07), measured

| Measure | This prototype | Benchmarks (07 §2) |
|---|---|---|
| First-view transfer | **357 KB** (Lighthouse total byte weight, mobile) | TPUSA home 19.0 MB; start-a-chapter 28.6 MB; Seminole GOP 3.2 MB |
| Requests | 8-9 on first view | 40-561 |
| Outside domains | 3 (Google Fonts ×2, images.unsplash.com); none for ads or analytics | TPUSA 49-60; Trump Store 84 |
| Lighthouse mobile | Perf 79-88 over 8 runs (noisy shared machine, simulated slow 4G); **Accessibility 100**; Best Practices 96; SEO 100; TBT 42-420 ms; CLS ~0 | Perf 27-97; a11y 57-100 |
| axe WCAG 2.2 AA | **0 violations**, light and dark | 18 of 23 pages failed at least one rule |
| First-screen walls | None: no modal, no cookie banner (no trackers), no age gate | Privacy banners covered 21-41% of the first screen; full-screen modals on 5 sites |
| First-screen actions (mobile) | One primary (Join the chat), one secondary (See what's on), plus the next hangout; Donate is lower down | Donate-only on TPUSA's phone home |
| Spanish | Header toggle (drafts) | 0 of 23 |
| Zoom, lang, skip link | Zoom allowed, `lang` set and switched, visible skip link | Zoom disabled on two; `lang` missing on one; 9 of 23 have a skip link |

TPUSA's tactics (activism kits, rewards, tentpole events, merch identity) turn into honest equivalents: the squad ladder with a public perk, monthly invites, member clips and stickers. There are no watchlists, no "warrior" framing and no pre-checked anything (07 §8).

### Standing next to the Gen Z brands (report 08)

- Partiful's chat-bubble hero and invite pages.
- Poppi's colour worlds and vertical clips.
- Starface's toy-box saturation and stickers.
- Duolingo's pressable buttons and claims linked to evidence (statute and SOE links).
- A real dark mode, which almost none of them have.
- None of their pop-ups, trackers or 6.8 MB median weight.

Against the 08 §7 desirability bar, every hard gate is met (items 2, 3, 5, 24, 25, 28). The only gap is item 27, Ask Claude, which is cut by Kira's decision.

---

## 9. Verified facts used on the page

All of these come from reports 00 and 01:

- Membership is 14 to 39. Dues are $20 a year, paid in January, with a non-voting membership for those who can't pay. ActBlue links come from `config.js`.
- Every Florida mail-ballot request expires Dec 31, 2026 (F.S. 101.62(1)(a)).
- From Jan 1, 2027, student IDs stop counting at the polls (HB 991), and the provision is being challenged in court (Oct 16, 2026 complaint).
- Pre-registration opens at 16 (F.S. 97.041).
- In Seminole, Jolly took about 54% to Donalds' 44.5%, unofficial, with certification due Nov 16. Statewide, Donalds won.
- Voters aged 18 to 40 are 36.8% of Seminole's active voters (124,626 of 338,692). NPA voters are 34.3% of that group, the largest bloc (SOE, Jul 1, 2026).
- SemDems' monthly meeting is Thu, Nov 12, 7 to 9 pm, with socializing from 6:30 pm, in Altamonte Springs, per the state party calendar. It's marked REAL and links to that calendar.
- SunRail has four Seminole stations; Sanford is the Celery City; Lake Jesup has dense gator populations; Florida's minimum wage reached $15 on Sep 30, 2026.

"18 to 40" appears only as the county's own voter-data band, labelled as such. Membership copy always says "14 to 39".

---

## 10. How it extends to the other pages

- **Tokens and components are portable.** Every colour is a `--token` with dark values. The repeatable parts are chat bubbles, pinned cards, invite cards, story cards, word stickers, die-cut stickers, pressable buttons and DEMO/REAL tags. That's enough for every page without new primitives.
- **Events page.** The invite card becomes the template. Each event gets its own static page with an OG image rendered from the same canvas engine, a fuller "who's going" list, a "First time? Here's what happens" note, and a calendar feed.
- **Vote hub, "2027 Ready" (01 rec 4).** Pinned-card stack per task with live countdowns from one `data/civic.json` (with `verified` and `source` fields), each card shareable through the PSA template. Bilingual at `/es/`.
- **Join and membership.** The same two-field form, followed by a numbered member card from the generator (report 04 #13) and the squad view.
- **Clips page.** The Reel at full width, weekly prompts with "Add yours"-style chains, and moderated submissions (repo `functions/api/video-upload.js`).
- **Letter archive.** Each issue renders as a long chat bubble with the same sign-off. The Picks show as a list of five bubbles.
- **Crews and city pages.** City colourways for the stickers and ticker. A city-scoped chat header ("Young Dems · Oviedo").
- **Serious-news template** (05 §3.8 and rec 5). Same type, but cream and ink only: no stickers, no confetti, no emoji, no donation module.
- **Share cards.** The canvas engine already writes 1080 x 1350. Add 1080 x 1920 story and 1200 x 630 link-preview sizes, and pre-render them at build time for OG tags.

---

## 11. Self-critique and open items

- **Fun versus fact balance.** Members' chat bubbles are lowercase and casual by design, while brand copy stays sentence case. The chat uses two emoji in UI bubbles, within report 05's "UI moments only" rule. If the chapter finds the demo chat too cute, it can be cut to three messages.
- **Page length.** The mobile page is about 14,300 px across nine sections. It's long but scannable (pinned and events come early). The receipts band could move to the vote hub if the chapter wants a shorter homepage.
- **Performance gap.**
  - Lighthouse lab performance of 79-88 misses report 07's 95+ stretch target.
  - LCP is about 3.7 s on simulated slow 4G, because the hero waits for web fonts so the font swap can't shift layout. Measured CLS on load is about 0.
  - The fix is self-hosted, subset and preloaded fonts at launch (report 03 notes all three can be self-hosted).
- **Spanish** is draft-quality and covers the first screen, the key strings and the share cards. It needs native, ideally Puerto Rican, review and full parity at `/es/`.
- **Unconfirmed before launch:**
  - SMS terms and privacy links are placeholders.
  - The "Paid for by" line awaits the committee decision (report 06 §7.1).
  - The squad link uses the intended domain `youngsemdems.com`, which currently shows a suspended page.
  - Social handles are not linked until the chapter confirms them.
- **Photos:** three Unsplash photographer credits are still to be recorded, and stock should be swapped for consented member photos as soon as the chapter has them.
