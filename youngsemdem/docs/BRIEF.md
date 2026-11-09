# YDSC site: master build brief

**Young Democrats of Seminole County (YDSC, "Young Dems").** Demo site, pending the chapter's sign-off.
Written by the creative director and tech lead on **Monday, November 9, 2026**, six days after the Nov 3
general election. This is the one document every builder follows. Where it disagrees with a research
report, a concept, or a judge's note, **this brief wins**, except for the binding rulings in
`docs/research/00-lead-factcheck.md` and Kira's own updates, which win over everything here.

Inputs: research reports 00 to 08 (`docs/research/`), the three concepts and their rationales
(scratchpad `ysd/concepts/A`, `B`, `C`), the three judges' verdicts, and the infra contracts in
`docs/infra/`. Builders do not need to re-read the judges: every judge finding that matters is folded
in below as a decision, a kill, a graft or an acceptance test.

---

## Contents

0. [Decisions at a glance](#0-decisions-at-a-glance)
1. [Positioning](#1-positioning)
2. [Voice](#2-voice)
3. [Design system](#3-design-system)
4. [Site map and page specs](#4-site-map-and-page-specs)
5. [Virality and growth mechanics](#5-virality-and-growth-mechanics)
6. [Video posting spec](#6-video-posting-spec)
6b. [Benchmark bar](#6b-benchmark-bar)
7. [Tech architecture](#7-tech-architecture)
8. [Compliance placeholders](#8-compliance-placeholders)
9. [Verified facts to use, and claims to avoid](#9-verified-facts-to-use-and-claims-to-avoid)
10. [Build plan](#10-build-plan)

---

## 0. Decisions at a glance

**Winner: Concept A, "Group Chat"** (judges: 75, 74 and 80 of 100; B scored 72, 70, 65; C 58, 66, 70).
A has the most ownable visuals (die-cut stickers drawn from the county), the best share plumbing, the
lightest page and the best focus management. We keep its palette, type, stickers, pressable buttons,
kinetic headline and card engine, and we evolve it into a direction called **"Saved Seat"**: the site
is the friend who already saved you a seat. The hero object stops being a fake chat thread and
becomes **the invite** (a graded photo of people, a date ticket, a sticker and one "I'm in" button).

**Non-negotiables** (every page, every pass):

1. **No AI anywhere.** No chatbot, no "Ask" helper, no LLM call (Kira cut it; the infra tests fail if one appears).
2. **Real name, honest labels.** Young Democrats of Seminole County / YDSC / Young Dems. Ages are
   "14 to 39" or "under 40", never "40 and under". Every demo event, person, count and clip says
   DEMO in both languages.
3. **No Native American imagery or language**, no politicians as endorsers, no candidate names on the
   site (write "the Democrat" / "the Republican"), no alcohol in photos, no fabricated quotes,
   stats or social proof (no simulated friend joins, no live-ticking fake counters, no invented view counts).
4. **Mobile first at 390 px, works at 320 px**, no horizontal scroll, no text under 12 px, tap
   targets at least 44 x 44 px, WCAG 2.2 AA in light and dark, reduced motion respected.
5. **No text on gradients, photos or patterns** unless it sits on a solid panel. The hero is flat
   ultraviolet.
6. **Static, portable, fast.** Plain HTML/CSS/vanilla JS, classic scripts, no fetch of local JSON,
   works from `file://`. Home first view at most 350 KB compressed, LCP at most 2.5 s, CLS at most 0.05.
7. **Every viral moment ends offline:** an RSVP, a join, a reminder in the calendar, or a friend invited.
8. **Spanish is a launch feature:** a static `es/` page for every core page, no English left on it.
9. **Footer on every page:** the "Paid for by" placeholder, a visible DEMO label and the not-official line.
10. **Never build a share URL from `location.origin` or a hard-coded domain.** Always `YSD.share.url()`.

**What changes from Concept A** (each item comes from at least one judge):

| Keep from A | Kill from A | Graft from B | Graft from C |
|---|---|---|---|
| Celery City Pop palette, Bricolage + Atkinson, die-cut county stickers, pressable buttons, kinetic H1, card engine, shared RSVP state, `<dialog>` focus handling, Pause motion, sticker facts | The 1,000 px chat thread in the hero; "Join the chat" / "Get in the chat" labels (there is no chat); the purple-to-pink gradient and pink glow behind hero text; the `visibility:hidden` font gate; the "🔥 3" reaction and lowercase slang bubbles; the "¡Vamos!" sticker; `value="Sam"` prefill; the decorative "Message the group" bar; hard-coded `youngsemdems.com` share links; "Every Florida mail ballot request runs out Dec 31" (too broad); candidate names in the receipts card | Golden-hour photo grade + duotone event covers; Cover Star 9:16 card (as "Me, on the cover", ref code printed); the "Nov 3, debriefed." serious band; "$20 a year. Or free." three-tier membership; inline RSVP that collects a name, contact, +1 and access needs; "Remind me in January" .ics; the pending-review clip card; native video controls; the type discipline (no text under 12 px, 320 px layout); og:image; a dated "next drop"; the not-official footer line | The quiz and its result card (renamed, no XP); per-event "Access" paragraphs; metric-matched fallback fonts; "The real scoreboard: no demo numbers in this one"; city crew names without a leaderboard; `aria-invalid`; real routes for legal pages; content-as-data; `es/` with hreflang |

Kills from B and C that builders must not reintroduce: B's rooftop-selfie photo (Unsplash
`1758272134088`, a drink in hand) anywhere on the site; B's magazine issue numbering and folio chrome
on the homepage; B's outline footer wordmark; eager-loaded event photos; C's XP, levels HUD, "+15"
chips on civic actions, simulated friend joins, Squad Cup scores, invented view counts, game-costume
copy ("Press start", "Player select", "Co-op mode", "Bonus round", "era"), the blocking level-up
overlay, 3 px borders on every block, and the event title "Trivia night: how Seminole are you?".

---

## 1. Positioning

### 1.1 One-line promise

**"Your crew for local politics in Seminole County: free hangouts, straight answers about voting,
and a seat saved for your friend."**

Motto (site-wide, already in `data/strings.js` as `brand.motto`): **"Local politics is a group
project."** Spanish: "La política local es un trabajo en equipo."

Why this promise: young Democrats want, in order, to be asked personally with a concrete next step,
friends and fun, low cost and low friction, and proof their effort matters locally (report 02 §5).
No Florida chapter site shows a dated next hangout on its homepage (02 §6). And the biggest group of
Seminole voters aged 18 to 40 is not registered with any party (34.3%; report 01 §6c), so we invite
people in and never scold.

### 1.2 Personas

These are internal design tools. Never put persona names on the site (the site's demo people are
separate and labelled DEMO).

| | **P1 · Sofía, 19, Sanford** "the first-timer" | **P2 · Marcus, 31, Lake Mary** "the regular-in-waiting" | **P3 · Ava, 15, Winter Springs** "the teen maker" |
|---|---|---|---|
| Who | Seminole State student, Puerto Rican family, bilingual, registered NPA (no party). Lives at home, works weekend shifts. Voted for the first time on Nov 3 with her student ID. | Renter, hybrid office job, registered Democrat, votes by mail. Uses a wheelchair. Has never been asked to anything by a local group. | High-school sophomore who posts edits on TikTok. Can join at 14 and pre-register at 16. Her parents are cautious. |
| Grounding | NPA is the largest bloc among 18 to 25 year olds in Seminole (35.2%) (01 §6c). Seminole is 25.4% Hispanic (01 §6a). Student IDs stop counting at the polls on Jan 1, 2027 (00). 82% of Gen Z talk politics with friends; 19% joined a club (02). | 37% of 18 to 34 year olds were never contacted by any campaign or group (CIRCLE, via 02 §5). About half of young adults say their households are struggling (02). Up to 1 in 4 US adults has a disability (CDC, via 04 Part C). Lake Mary has 4,273 voters aged 18 to 40 (01 §6c). | YDSC admits members from 14 (ActBlue dues page). Florida pre-registration at 16 (F.S. 97.041). 29% of young people create political content (02 §5.6). Minors policy: `docs/legal/MINORS_POLICY.md`. |
| Wants | A free, low-pressure first event she can bring a friend to. Plain Spanish for her parents. To know what changes in 2027. | One concrete thing on a weeknight. To know the venue is step-free before he goes. To bring his partner. | To make something (a clip, a card, a quiz result) and be taken seriously. Daytime, alcohol-free events. |
| Fears | Being the only new person. Being quizzed on policy. | A guilt-trip fundraising list. Vague "we'll send details" events. | Her name in a public link. A parent finding out from a stranger. |
| Our hooks | Student-ID card (vote hub), Spanish voter workshop event, a friend's invite link that opens straight onto the event, "First time? Perfect." | Mail-ballot reminder (his pre-Nov 3 request ends Dec 31), Thursday trivia, RSVP sheet with an access field and a +1, the Access paragraph on every event | Post a clip (with guardian consent), the quiz and its 9:16 card, "Me, on the cover", sticker collecting, a random-style referral code |
| Success metric | RSVP from an invite link | RSVP plus calendar add | Clip submitted or card shared |

### 1.3 Naming and handle usage

| Use | Write | Never write |
|---|---|---|
| First mention on a page, legal text, `<title>` suffix | Young Democrats of Seminole County | Young Seminole Democrats, Young Sem Dems, youngsemdem |
| Headlines, buttons, stickers, cards | Young Dems | YSD (that is the code namespace only), "Seminoles", "Noles" |
| Forms, fine print | YDSC | |
| Spanish | los Young Dems ("Únete a los Young Dems"); the full name stays in English | "Jóvenes Demócratas de Seminole" as if it were the name |
| Handle | `youngsemdems` (matches the ActBlue slug and youngsemdems.com) | Social links before the chapter confirms the accounts (`config.social.*.url` stays `''`) |
| Ages | 14 to 39, under 40 | 40 and under |
| Parent party | Seminole County Democrats (semdems.com, office in Longwood) | Anything implying SemDems or FYD approved this site |
| The domain | Do not print youngsemdems.com as a live link: it shows a suspended hosting page (01 §1b). Cards print whatever `YSD.share.url()` returns. | |

---

## 2. Voice

### 2.1 The voice in one line

**The friend in your group chat who always knows the deadline, always has a plan for Thursday, and
never makes you feel bad for asking** (report 05 §3, binding). Written by bylined demo members, not a
celebrity persona. The Service95 letter is a craft reference only: never mention Dua Lipa, her
titles, lyrics or "Service" puns anywhere on the site.

### 2.2 Dials

Warm 9 · Curious 8 · Playful 6 · Urgent 3 (only when a date is real) · Formal 2 · Slang 2 (members
bring it; the brand doesn't) · Snark 1 (never at voters; only at systems).

### 2.3 Twelve rules, condensed

1. Open with a moment, not a mission statement.
2. One person to one person: "I" in letters, "we" for the team, "you" for the reader. Never "the youth", "Gen Z" as a label, or "folks".
3. Warm, not breathless: medium sentences, a short punchline, **at most one exclamation mark per screen**, zero emoji in long copy, one honest superlative per piece.
4. Curate like a friend: 3 to 5 picks, each with a reason; free and cheap first.
5. Good judgement, no lecture. Never tell people how to feel about an election.
6. Explain every acronym the first time, or don't use it. Welcome first-timers out loud.
7. Plain words that translate: rent, bus, ballot, Tuesday, 7 pm, Sanford. No idioms that break in Spanish.
8. **Serious means serious** (the serious template, §2.5).
9. Optimism with receipts: hope backed by checkable facts, and never an invented number.
10. Spotlight people, with consent. Members are agents, not victims.
11. Wink, don't wear the meme. No borrowed artist looks (brat lime plus lowercase Arial is someone else's), no trend-jacking.
12. Rituals over noise: The Thursday Letter, One Thing, The Picks, Spotlight, Ask the Group Chat, the same sign-off forever.

### 2.4 Formatting

- Sentence case for headlines and buttons. Eyebrows and tags: 1 to 3 words, ALL CAPS, letter-spaced. No all-lowercase branding.
- Buttons: verb first, 1 to 4 words.
- Times: "7 pm", "10:30 am" (lowercase, space). Dates: "Thu, Nov 19" or "Thursday, November 19". Always day plus date, never "this Thurs".
- Numbers: numerals in UI. Oxford comma. American spelling. Contractions always.
- Links say where they go ("Check My Voter Record"), never "click here".
- Errors: two sentences max (what happened, what to do), no emoji, never blame the user.
- Emoji: zero in letters, notices, errors and anything serious; at most one in a success toast, at the end of the line, never replacing a word.
- Legal and consent text stays plain and unjoking (08 §8).

### 2.5 Two registers, two templates

| | **Fun template** (default) | **Serious template** (`.band--serious`, `tone: 'calm'` in data) |
|---|---|---|
| Use for | Events, invites, cards, quiz, clips, membership | Election results, the 2027 ID change, rights alerts, anything sad, legal notices |
| Look | Full-bleed brand colours, stickers, pressable buttons, confetti on success | Solid Lake blue band (or cream and ink on long pages), no stickers, no confetti, no emoji, no rotation |
| Copy shape | A hook, the details, one action | **Facts first, then one honest feeling, then one action.** No jokes, no exclamation marks, no donation ask in the same block |

### 2.6 Banned and preferred words

Use the full lists in report 05 §5. The short version, enforced by `tools/voice_lint.js` (§10):

- **Never:** warrior, tribe/tribal (for us), chief, brave(s), powwow, spirit animal, war cry, on the warpath, Noles; slay, yass, no cap, bestie, rizz, delulu, it's giving, understood the assignment, main character, "Gen Z is in the house"; electeds, the base, GOTV, turnout universe, stakeholders, synergy, "most important election of our lifetime"; URGENT, FINAL NOTICE, "we noticed you", fake match claims; crazy, insane, lame; "Latinx" in body copy; "click here"; "40 and under"; "Join the chat" / "Get in the chat"; "era" (as in the old quiz name); Young Sem Dems.
- **Prefer:** show up, save your seat, bring a friend, make a plan, check your registration, renew your mail-ballot request, first time? perfect, come as you are, no experience needed, here's what changed, small wins count.

### 2.7 Ready-to-use lines

All original. Use them verbatim unless a data file already holds an approved variant. Demo people and
events stay labelled DEMO wherever these appear. Spanish is given where the line is a fixed brand or
button string; everything else is translated in the data files and needs native review.

| # | Where | Line |
|---|---|---|
| 1 | Hero H1 | **Local politics is a group project.** / ES: La política local es un trabajo en equipo. |
| 2 | Hero eyebrow | YOUNG DEMOCRATS OF SEMINOLE COUNTY · AGES 14 TO 39 |
| 3 | Hero rotor | We're the friend who [always knows the deadline · has a plan for Thursday · saves you a seat · explains the acronyms · remembers your name]. |
| 4 | Hero sub | Free hangouts, straight answers about voting, and a crew from Sanford to Oviedo. Come as you are. Bring a friend. |
| 5 | Primary CTA | **Join free** / ES: Únete gratis |
| 6 | Secondary CTA | **See what's on** / ES: Mira qué hay |
| 7 | Under the CTAs | Events are free and open to everyone, in any party or none. |
| 8 | RSVP | **I'm in** (opens the sheet) → sheet button **Save my seat** / ES: Me apunto → Guárdame un lugar |
| 9 | Share | **Send it to the group chat** / ES: Mándalo al grupo |
| 10 | Form label | First name (or what you go by) |
| 11 | Form label + hint | Email or mobile — "For your invite and one reminder. Nothing else unless you ask." |
| 12 | Optional field | Anything that would make this easier? Rides, ASL, a quiet corner, kids in tow. (Optional) |
| 13 | Join success | You're in. Your first Thursday Letter lands this week. Go drink some water. |
| 14 | RSVP success | Seat saved. Add it to your calendar so future you remembers too. |
| 15 | Card success | Your card's ready. Send it to one person you'd actually text. |
| 16 | Error (email) | That email's missing an @. Happens to everyone. Try once more? |
| 17 | Error (generic) | That one's on us, not you. Give it a minute and try again. |
| 18 | Empty (events) | Nothing on the calendar this week. Rest counts too. Want to host the next one? We'll help you plan it. |
| 19 | Empty (feed) | No clips here yet. Yours could be first: 60 seconds, filmed vertical, about why you showed up. |
| 20 | Invite text (share) | Trivia in Casselberry, Thu, Nov 19 at 7 pm. It's free and I don't want to be the only new person. Come with? {link} *(in demo, append "(DEMO event)")* |
| 21 | Newsletter intro | Hi, it's Dani from Casselberry (DEMO writer). On election night a guy who'd voted for the first time that morning asked if he could help at our table. He stayed until the polls closed. Most people are one invitation away, so here's yours. |
| 22 | Newsletter sign-off | That's it from me. Text one friend, drink some water. See you Thursday. Dani, for the Young Dems xo |
| 23 | Mail-ballot nudge (required shape, 00) | Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure. |
| 24 | Serious band | **Nov 3, debriefed.** Seminole picked the Democrat for governor, about 54% to 44.5% (unofficial until the county certifies, due Nov 16). Statewide, the Republican won by about a point. If you're tired, that's fair. One thing that helps right now: set your January mail-ballot reminder. |
| 25 | Membership head | **$20 a year. Or free.** |
| 26 | Chip-in (never near serious content) | Got $5 to spare? That's coffee for one volunteer night. Don't have it? Come anyway. |
| 27 | 404 | This page skipped the meeting. Let's get you somewhere useful. |
| 28 | Squad meter | Friends who joined with your link: 0 of 3. Three friends, not 300. |

---

## 3. Design system

### 3.1 Direction: "Saved Seat"

Concept A's loud, sticker-and-colour-block language, with three corrections the judges asked for:

1. **The invite is the hero object**, not a chat mock. It carries the brand's warmth (a graded photo
   of people), its locality (a county sticker) and its action (one "I'm in").
2. **Quiet chrome, loud content** (report 08 technique 2). Hard borders and offset shadows go only on
   things you can tap or collect: buttons, invite and event cards, stickers, the maker preview.
   Long-form surfaces (vote steps, legal pages, the letter, forms) are quiet: hairlines, no offsets.
3. **Flat colour behind text, always.** Gradients and photos are decoration only.

### 3.2 Colour

All colours are CSS custom properties in `assets/css/tokens.css`. Bright colours are **fills under
ink text**, never text on cream (report 03 §6). Dark mode is designed, not inverted, and is defined
twice: under `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { … } }` and
under `:root[data-theme="dark"] { … }`. A header/menu toggle cycles Auto, Light, Dark.

**Palette constants (same in both themes)**

| Token | Hex | Role | Text on it |
|---|---|---|---|
| `--violet` | `#6A2BFF` | Ultraviolet: hero fill, primary brand blocks, white-text buttons | white `#FFFFFF`, cream, celery |
| `--violet-deep` | `#4B12D6` | Links and focus on light surfaces; issue colour | white |
| `--celery` | `#C8F03C` | Celery City lime: primary CTA fill, REAL tags, highlights | ink |
| `--bubblegum` | `#FF7AC6` | Accent fills, marker swipe, stickers | ink |
| `--hotpink` | `#FF4FA3` | Issue colour (`pink` in data) | ink |
| `--sky` | `#4FD6FF` | Secondary fills, pinned cards | ink |
| `--tangerine` | `#FF8B3D` | DEMO tags, deadline cards | ink |
| `--orange` | `#FF6B1A` | Issue colour | ink |
| `--teal` | `#00B3A6` | Issue colour | ink |
| `--mint` | `#7EE081` | Issue colour (`lime` in data; distinct from celery) | ink |
| `--sun` | `#FFD23F` | Sticker fill, highlights | ink |
| `--lake` | `#2236C9` | **Serious band** (Lake blue) | cream |
| `--night` | `#170B33` | Ink: text, dark blocks, hard shadows (light theme) | cream, celery |
| `--cream` | `#FFF6EA` | Warm off-white | ink |

**Semantic tokens**

| Token | Light | Dark | Notes |
|---|---|---|---|
| `--bg` | `#FFF6EA` | `#120826` | page |
| `--surface` | `#FFFFFF` | `#1E1240` | cards, inputs |
| `--surface-2` | `#F3EADB` | `#2A1B55` | wells, hover |
| `--text` | `#170B33` | `#FFF6EA` | |
| `--text-muted` | `#574D70` | `#CDC4EA` | hints, sources, meta |
| `--link` | `#4B12D6` | `#C8F03C` | underlined by default |
| `--focus` | `#4B12D6` | `#C8F03C` | 3 px ring, 2 px offset; on violet and night bands use celery, on bright fills use night |
| `--edge` | `#170B33` | `#FFF6EA` | borders on tappable cards and buttons |
| `--line` | `#E4D9C6` | `#3A2A6B` | hairlines (decorative only) |
| `--shadow` | `#170B33` | `#6A2BFF` | hard offset shadow colour |
| `--on-fill` | `#170B33` | `#170B33` | text on any bright fill, both themes |
| `--error` | `#B3261E` | `#FFB4A8` | error text and borders |
| `--success` | `#1E6B3A` | `#8DE0A6` | success text |
| `--placeholder` | `#6E6488` | `#A79FC2` | input placeholders (never instead of a label) |

**Card engine aliases** (read by `YSD.cards`; they must come from **constants**, not semantic tokens,
so share cards look the same whatever theme the maker uses): `--ysd-bg: var(--cream)`,
`--ysd-fg: var(--night)`, `--ysd-brand: var(--violet)`, `--ysd-accent: var(--bubblegum)`,
`--ysd-pop: var(--celery)`, `--ysd-muted: #574D70`, `--ysd-ink: var(--night)`,
`--ysd-paper: var(--cream)`, `--ysd-font-display`, `--ysd-font-body`.

**Checked contrast pairs** (WCAG 2.x relative luminance, computed Nov 9, 2026)

| Pair | Ratio | Use |
|---|---|---|
| ink `#170B33` on cream `#FFF6EA` | 17.33 | body text |
| ink on white | 18.55 | cards, inputs |
| muted `#574D70` on cream / white / `#F3EADB` | 7.27 / 7.78 / 6.52 | hints, meta |
| link `#4B12D6` on cream / white | 8.33 / 8.91 | links |
| white on violet `#6A2BFF` | 6.17 | hero sub, white buttons |
| cream on violet | 5.77 | hero H1 line 1 |
| celery on violet | 4.70 | hero H1 line 2 (large text; passes AA at any size) |
| ink on celery / sky / bubblegum / tangerine | 14.12 / 10.95 / 7.82 / 7.96 | fills |
| ink on hotpink / orange / teal / mint / sun | 6.09 / 6.51 / 7.07 / 11.37 / 12.85 | issue and sticker fills |
| white on violet-deep | 8.91 | issue chips |
| celery on violet-deep | 6.78 | |
| cream on lake `#2236C9` | 8.04 | serious band |
| cream on night / celery on night | 17.33 / 14.12 | dark blocks |
| error `#B3261E` on cream / success `#1E6B3A` on cream | 6.11 / 6.10 | |
| placeholder `#6E6488` on white | 5.47 | |
| **Dark:** text `#FFF6EA` on `#120826` / `#1E1240` / `#2A1B55` | 18.03 / 16.14 / 14.15 | |
| **Dark:** muted `#CDC4EA` on `#120826` / `#1E1240` / `#2A1B55` | 11.65 / 10.43 / 9.15 | |
| **Dark:** celery link on `#120826` / `#1E1240` | 14.69 / 13.15 | |
| **Dark:** error `#FFB4A8` on `#120826` / success `#8DE0A6` on `#120826` | 11.34 / 12.26 | |

**Decorative only, never text:** celery on cream (1.23), violet on night (3.01), any bright fill as
text on cream or white.

**Issue and event colour map.** `data/issues.js` `color` and `data/events.js` `cover.token` resolve
to these tokens: `orange → --orange`, `pink → --hotpink`, `violet → --violet` (white text),
`bubblegum → --bubblegum`, `violet-deep → --violet-deep` (white text), `lime → --mint`,
`celery → --celery`, `sky → --sky`, `teal → --teal`. Expose each as `--issue-<id>` in issues CSS and as
`--duo` on event covers (`style="--duo: var(--sky)"` is the only allowed inline style pattern).

**City colourways** (crews, tickers, card options): Sanford celery, Lake Mary sky, Oviedo tangerine,
Winter Springs mint, Altamonte Springs bubblegum, Casselberry hotpink, Longwood teal, unincorporated
Seminole violet.

### 3.3 Type

Self-hosted WOFF2 in `assets/fonts/` (all SIL Open Font License; Latin subset covers Spanish
ñ á é í ó ú ü ¿ ¡). Measured Nov 9, 2026 from the Google Fonts CSS API (Latin subset):

| Role | Family | File to ship | Size | Loading |
|---|---|---|---|---|
| Display | **Bricolage Grotesque**, `wdth` 75 to 100, **`wght` 800 only** (no `opsz`) | `bricolage-800-wdth.woff2` | ~40 KB | preload, `font-display: swap` |
| Body / UI | **Atkinson Hyperlegible Next**, `wght` 400 to 800 | `atkinson-next-var.woff2` | ~34 KB | preload, `font-display: swap` |
| Hand accent | **Caveat Brush** | `caveat-brush.woff2` | ~67 KB (subset further if possible) | not preloaded, `font-display: optional`, decorative only |

The full Bricolage axis set is 131 KB, so we ship a single weight: **headlines are always 800**, and
the kinetic H1 animates width, not weight. Buttons and labels use Atkinson 700.

**No font gate.** Delete A's `.js:not(.ready) … visibility:hidden`. Instead, graft C's technique:
metric-matched fallback faces so the swap does not shift layout.

```css
@font-face { font-family: "Bricolage fb"; src: local("Arial Narrow Bold"), local("ArialNarrow-Bold"),
  local("Liberation Sans Narrow Bold"), local("Arial Bold"), local("Liberation Sans Bold");
  size-adjust: <measured>; ascent-override: <measured>; descent-override: <measured>; }
@font-face { font-family: "Atkinson fb"; src: local("Arial"), local("Liberation Sans"), local("Helvetica");
  size-adjust: <measured>; ascent-override: <measured>; descent-override: <measured>; }
--font-display: "Bricolage Grotesque", "Bricolage fb", "Arial Narrow", sans-serif;
--font-body: "Atkinson Hyperlegible Next", "Atkinson fb", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
--font-hand: "Caveat Brush", cursive;
```

The foundation measures `size-adjust` by rendering the same strings in both faces in Playwright and
matching widths, and records the numbers in a comment. Reserve the H1 box height so nothing below it
moves. Target CLS at most 0.05.

**Type scale** (fluid; the minimum on-screen size anywhere is 12 px, and our smallest step is 13 px)

| Token | Size | Face / settings | Use |
|---|---|---|---|
| `--fs-tag` | 13 px | body 700, uppercase, `letter-spacing: .08em` | eyebrows, tags, DEMO/REAL pills |
| `--fs-small` | 15 px | body 400, line-height 1.45 | hints, sources, fine print |
| `--fs-body` | 17 px | body 400, line-height 1.55, max 68ch | body |
| `--fs-lead` | `clamp(19px, 0.5vw + 17px, 22px)` | body 400 | lead copy, hero sub |
| `--fs-h4` | `clamp(20px, 1vw + 16px, 24px)` | display 800, `wdth` 88 | card titles |
| `--fs-h3` | `clamp(24px, 2vw + 16px, 34px)` | display 800, `wdth` 84 | sub-sections, sheet titles |
| `--fs-h2` | `clamp(36px, 4.5vw + 18px, 76px)` | display 800, `wdth` 78, line-height .92 | section titles |
| `--fs-hero` | `clamp(52px, 13vw + 10px, 132px)` | display 800, `wdth` 76, line-height .86 | home H1 (about 61 px at 390) |
| `--fs-stat` | `clamp(56px, 8vw + 24px, 128px)` | display 800, `wdth` 76 | countdown, scoreboard numbers |

Rules: never set body text in the condensed display face; the hand face carries at most a few words
per screen and never essential information; `text-wrap: balance` on headings; ES strings run about
15% longer, so test both.

### 3.4 Space, layout, shape

- **Spacing** (4 px base): `--sp-1` 4, `--sp-2` 8, `--sp-3` 12, `--sp-4` 16, `--sp-5` 24, `--sp-6` 32, `--sp-7` 48, `--sp-8` 64, `--sp-9` 96, `--sp-10` 128.
- **Gutters:** `--gutter-l: max(16px, env(safe-area-inset-left, 0px))`, `--gutter-r` likewise. Container `.wrap`: `width: min(1200px, 100% - var(--gutter-l) - var(--gutter-r))`. Prose max 68ch.
- **Section rhythm:** `padding-block: clamp(48px, 8vw, 112px)`; full-bleed colour bands change down the page (at least three saturated bands on home).
- **Breakpoints:** content-led; check 320, 360, 390, 768, 1024, 1440. Under 360 px the header folds ES and theme into the menu.
- **Radii:** `--r-xs` 6, `--r-sm` 10, `--r-md` 16, `--r-lg` 24, `--r-xl` 36, `--r-pill` 999. Bubbles: 18 px with one 6 px tail corner.
- **Borders:** `--bw: 2px` solid `var(--edge)` on tappable cards and buttons only; `1px var(--line)` hairlines elsewhere.
- **Shadows** (hard offset, no blur): `--sh-press: 0 4px 0 var(--shadow)` (buttons; collapses on `:active`), `--sh-card: 6px 6px 0 var(--shadow)`, `--sh-lift: 10px 10px 0 var(--shadow)` (hero invite only). No shadows on long-form surfaces.
- **Rotation:** tappable cards may sit at ±1 to 2°. Never rotate anything with more than 2 lines of text, and never rotate in the serious template.
- **Horizontal strips** (`.snap`): scroll-snap containers with their own `overflow-x: auto`, a visible next-card peek, and keyboard-reachable items. The page itself never scrolls sideways.

### 3.5 Motion

| Token | Value |
|---|---|
| `--dur-1` / `--dur-2` / `--dur-3` / `--dur-4` | 120 / 220 / 400 / 900 ms |
| `--ease-out` | `cubic-bezier(.2,.8,.2,1)` |
| `--ease-pop` | `cubic-bezier(.2,.9,.3,1.35)` |

- **Signature moment: the kinetic H1.** Each line enters with `font-stretch` (the `wdth` axis) squeezing 100 → 72 → 76, plus `translateY(20px)` and opacity, 900 ms `--ease-pop`, line 2 delayed 120 ms; then a bubblegum marker swipe grows under "group project" (background-size). Lines are explicit spans and each fits on one line at 320 px; the H1 box height is reserved, so CLS stays under 0.05. On desktop hover, the H1 stretches to `wdth` 96.
- **Rotor line:** a flip every 2.6 s, stopping after 4 loops; screen readers get one static sentence (`aria-hidden` on the animated copy).
- **City ticker:** 38 s loop, placed **after** the pinned strip, with a visible 44 px **Pause motion** button that also stops the rotor and any looping sticker. The paused state persists (`prefs:motion`).
- **Press, success:** buttons press down (shadow collapses); stickers wiggle on tap; a CSS confetti burst (at most 1 s) and a toast on RSVP, join and card saved. **Never** confetti in the serious template or next to civic content.
- **Scroll reveals:** `animation-timeline: view()` inside `@supports`, opacity and translate only. Content is visible without JS and without support. Nothing ever waits for JS to become visible.
- **View transitions:** `@view-transition { navigation: auto; }`, off under reduced motion.
- **Reduced motion:** every animation and transition off, ticker becomes a static wrapped list, rotor shows its first phrase, clips never autoplay. `tools/qa.js` asserts 0 running animations.
- **Rules:** transform and opacity only (the H1 width squeeze is the one exception, on a box of reserved size); nothing loops for more than 5 s without the Pause control (WCAG 2.2.2); no parallax.

### 3.6 Photo treatment

- **Golden-hour grade** (B's, graft as `.photo--golden`): a soft-light gradient (sun-yellow top to hot-pink bottom, about 30% alpha), a 118° white gloss sheen, and a faint SVG film grain (inline `data:` SVG, allowed by the CSP). Dark theme: halve the sheen.
- **Duotone event covers** (`.photo--duo`): the image goes `grayscale(1) contrast(1.15)` and multiplies into `--duo` (the event's colour). Each invite gets its own colour world, Partiful-style, and mismatched stock reads as one shoot.
- **People in the first screen:** home's invite ticket shows one golden-hour photo of young people within the first 844 px at 390 px.
- **Choosing photos** (every one, before use): view it. No alcohol or drinks that could read as alcohol (members start at 14 and events are alcohol-free), no politicians, no brand logos, no school uniforms or logos, no Native imagery. Prefer people seen from behind, from the side or small in the frame: Unsplash's Terms (§5) say its license does not cover the images of recognizable people, so recognizable faces get replaced by consented member photos before launch.
- **Candidates** (verify each by eye first): `1529333166437-7750a6dd5a70` (three friends at sunset, from behind), `1511632765486-a01980e01a18` (four friends hugging at sunset, from behind), `1783676056910-e5f3b27bdcbd` (lake at sunset; Richard Burlton), `1646934280686-768a69c444eb` (friends at a table; Jametlene Reskp; check the table for drinks). **Banned:** `1758272134088-d3d58d939d12` (rooftop selfie with a drink).
- **No credit, no photo.** Every `<img>` from Unsplash carries `data-photographer` and `data-source` (the photo page URL) so `tools/credits.py` records it. If a credit cannot be confirmed, don't use the photo.
- **Visible label** on every stock photo: a 13 px `.tag--stock` reading "Stock photo · not members" (ES: "Foto de archivo · no son miembros"), plus descriptive alt text.
- **Text never sits on a photo** except inside a solid panel.
- **Delivery:** `images.unsplash.com/photo-<id>?w=<w>&q=60&auto=format&fit=crop` with `srcset` (320, 640, 960, 1280), explicit `width`/`height`, `loading="lazy"` below the fold, `fetchpriority="high"` and at most 60 KB for the one first-screen photo.
- **OG images are type-only** (no stock faces).

### 3.7 Stickers and illustration

- **Die-cut county stickers** (ported from Concept A's SVG symbols and extended), stored once as SVG strings in `data/stickers.js` so the same art renders inline in the DOM and on canvas as `data:image/svg+xml` (no canvas tainting on `file://`). The white die-cut edge is a CSS `drop-shadow` chain in the DOM and a stroked outline on canvas.

  | id | Motif | Tap-to-learn fact (sourced in `data/stickers.js`) |
  |---|---|---|
  | `celery` | Celery bunch with a violet band | Sanford, "the Celery City" (01 §7; UCF RICHES) |
  | `gator` | Gator peeking out of the water | Lake Jesup's dense gator population (01 §7) |
  | `train` | Commuter-train front | SunRail's four Seminole stops; weekday service (01 §7; events facts) |
  | `chicken` | A chicken | Oviedo's roaming chickens, folklore now that growth ended most of it (01 §7) |
  | `cypress` | A young cypress | The Senator, the Phoenix clone, Big Tree Park in Longwood (01 §7) |
  | `sun` | Sun in sunglasses | Florida's $15 minimum wage since Sep 30, 2026 (01 §8) |
  | `envelope` | Mail-ballot envelope with a check | The mail-ballot rule (F.S. 101.62) in the required wording |
  | `heart` | Heart in a speech bubble | "Come as you are": LGBTQ+, disabled and Spanish-speaking neighbors welcome |
  | `calendar` | Calendar page with a check | "Saved seat": your RSVP |
  | `camera` | Phone camera | Clips: "captions on, always" |

- **Word stickers** (Caveat Brush on a pill): "first time? perfect", "come as you are", "official links only", "captions on, always", "bring a friend", "rest counts too". Spanish pages get Spanish word stickers written natively ("¿primera vez? perfecto", "ven como eres", "solo enlaces oficiales"). No Spanish word stickers on English pages.
- **Interactive stickers** are `<button>`s with a label ("Sticker: celery. Tap for a Seminole fact"); decorative ones are `aria-hidden`.
- **Brand mark:** A's "YD" monogram in a speech bubble (violet with a celery tail) plus the "Young Dems" wordmark in Bricolage 800. No donkey, no flag, no stars and stripes, no garnet and gold.

### 3.8 Component inventory and class conventions

**Conventions**

- BEM-ish, lowercase, hyphenated: `.block`, `.block__element`, `.block--modifier`.
- Layout primitives: `.wrap`, `.section`, `.stack`, `.cluster`, `.grid`, `.snap`, `.prose`. Utilities use the `u-` prefix (`.u-visually-hidden`, `.u-center`). Page-only styles sit under the body class `.p-<page>` (for example `.p-home .hero`).
- State lives in attributes: `[aria-pressed]`, `[aria-expanded]`, `[aria-current]`, `[aria-invalid]`, `[data-state="idle|loading|done|error"]`, `[hidden]`. No `.is-*` classes.
- JS hooks are `data-*` attributes only (`data-rsvp="<eventId>"`, `data-share`, `data-cal`, `data-countdown`, `data-sticker`, `data-t`). Never select styling classes from JS.
- No IDs for styling. No inline styles except CSS custom properties (`style="--duo: var(--sky)"`).
- Every component is shown, in light and dark, with its markup contract, on `styleguide.html` (foundation). Page builders copy markup from there.

**Inventory** (owner: foundation unless noted; "JS" means a behaviour module exists)

| Group | Component (class) | Notes |
|---|---|---|
| Shell | `.demo-banner`, `.site-header` (+ `.menu`), `.site-footer`, `.skip-link`, `.toast-region` | from partials |
| Layout | `.wrap`, `.section` (`--violet`, `--celery`, `--night`, `--cream`, `--pink`, `--sky`), `.band--serious`, `.stack`, `.cluster`, `.grid`, `.snap`, `.prose` | |
| Atoms | `.btn` (`--primary` celery/ink, `--violet`, `--ink`, `--ghost`, `--block`; every size at least 44 px tall), `.link`, `.eyebrow`, `.tag` (`--demo` tangerine, `--real` celery, `--stock`, `--new`, `--serious`), `.chip` (filter and radio chips, at least 44 px), `.swatch`, `.seg` (segmented control), `.switch`, `.avatar`, `.facepile`, `.icon` | |
| Forms | `.field` (label, control, `.field__hint`, `.field__error` with `aria-describedby` and `aria-invalid`), `.field--check`, `.field--choice`, `.form__summary` (error summary that takes focus), `.consent` | |
| Brand | `.sticker` (`--sm/--md/--lg`, `data-sticker`), `.word-sticker`, `.brand` (mark + wordmark) | stickers from `data/stickers.js` |
| Cards | `.ticket` (date stub), `.invite` (`__cover`, `__date`, `__body`, `__meta`, `__access`, `__going`, `__rsvp`; `--hero`, `--compact`), `.pin` (`--deadline`, `--rule`, `--hangout`), `.stat` (number, label, source link), `.tier` (membership), `.story` (vertical clip card), `.bubble` (`--me`), `.step` (vote step), `.issue`, `.team-card`, `.notice` (`--info`, `--warn`, `--draft`) | `.invite` and `.ticket` rendering JS: W2 `eventcard.js`; `.story` JS: W4 `reel.js` |
| Overlays | `.sheet` (native `<dialog>`: bottom sheet on phones, centred on desktop; focus moves in, Escape closes, focus returns), `.toast` (`role="status"`) | RSVP sheet content: W2 |
| Motion | `.ticker` (+ Pause), `.rotor`, `.countdown`, `.confetti` | JS in `ui.js` |
| Features | `.maker` (`__preview`, `__controls`, `__actions`), `.card-preview`, `.membercard`, `.stickerbook`, `.meter` (squad meter), `.quiz` (`__progress`, `__q`, `__opt`, `__result`) | W5 (`assets/css/maker.css`, `quiz.css`) |
| Long-form | `.letter` (newsletter), `.legal` (`__toc`, `__section`), `.faq` (`<details>`) | W6, W7 |

### 3.9 Accessibility rules every component follows

- One `<h1>` per page, no skipped heading levels, landmarks (`header`, `nav`, `main`, `footer`), a visible skip link, `lang` on `<html>` and `lang="es"` on any Spanish snippet inside an English page (and the reverse).
- Visible focus everywhere (3 px ring, 2 px offset, colour per surface, §3.2); `scroll-padding-top` equal to the sticky header so focus is never hidden (2.4.11).
- Targets at least 44 x 44 px (links inside sentences excepted). Text at least 12 px (our floor is 13).
- Forms: visible `<label>`s, correct `autocomplete` and `inputmode`, `aria-invalid="true"` plus `aria-describedby` pointing at both the hint and the error, an error summary that takes focus on submit, never placeholder-only labels, no pre-checked consent.
- Status messages ("Seat saved", "Link copied") go through the shared `role="status"` region.
- Dialogs: native `<dialog>` with `showModal()`; Escape closes; focus returns to the opener. Menu: `aria-expanded`, Escape closes, focus returns.
- Motion: §3.5. Video: §6.
- Reflow at 320 px with no sideways scroll (1.4.10). Zoom never disabled.
- Icon-only buttons have an accessible name. Emoji are never the only label.

---

## 4. Site map and page specs

### 4.0 Global

**Routes** (every core page has an `es/` twin generated by `tools/make_es.js`; generated subpages
have twins written by their own generator)

| Page | File | Owner |
|---|---|---|
| Home | `index.html` | W1 |
| Join | `join.html` | W6 |
| Events | `events.html` | W2 |
| Event / invite view (one per event) | `events/<id>.html` (generated) | W2 |
| Vote hub ("2027 Ready") | `vote.html` | W3 |
| Issues | `issues.html` | W3 |
| Feed ("The Reel") | `clips.html` | W4 |
| Post a clip | `post.html` | W4 |
| Quiz | `quiz.html` + `quiz/show-up/<result>.html`, `quiz/issue/<slug>.html` (generated) | W5 |
| Newsletter sample issue | `newsletter.html` | W6 |
| About / team | `about.html` | W7 |
| Privacy (includes SMS terms at `#privacy-sms`) | `privacy.html` | W7 |
| Accessibility | `accessibility.html` | W7 |
| Teen safety | `teen-safety.html` | W7 |
| Clip rules | `content-policy.html` | W7 |
| Code of conduct | `conduct.html` (new) | W7 |
| Not found | `404.html` | W7 |
| Offline | `offline.html` | F0 |
| Style guide (noindex) | `styleguide.html` | F0 |

File names match the page map in `data/issues.js` and `data/sharekit.js` (`clips.html`, `post.html`,
`quiz.html`, `vote.html`). Links always include `.html` so they work on `file://`.

**Header** (partial). Phones: brand, ES (360 px and up), **Join free** (`.btn--primary`), Menu.
Desktop: brand, Events, Vote, Reel, Quiz, Issues, About, ES, theme, Join free. The menu holds every
page plus The Thursday Letter, Policies, ES and the theme toggle. The ES link points at the
counterpart page (computed by `ui.js` from the current path; static fallback `es/index.html` /
`../index.html`).

**Demo banner** (partial, one line on phones): "DEMO preview for the Young Democrats of Seminole
County, pending the chapter's sign-off. Anything marked DEMO is made up, and forms don't send
anything." with a "What's real?" link to `about.html#whats-real`. ES pages add "Borrador en español,
pendiente de revisión."

**Footer** (partial): nav groups (Do · Learn · About · Policies), parent party link (semdems.com),
social links only when `config.social.*.url` is set, and the legal block in this order:
1. "Paid for by [committee name and address placeholder]" plus a DEMO tag (§8).
2. "Preview for the Young Democrats of Seminole County. Not yet approved by the chapter. Not an official site of the Seminole County Democrats, Florida Young Democrats or any party organization."
3. "People in stock photos are not members and don't endorse anything."
4. "Made in Seminole County." and the year.

**Every page** has: a unique `<title>` ("Events · Young Democrats of Seminole County"), meta
description, `og:title`, `og:description`, `og:image` (+ `og:image:alt`, width, height),
`twitter:card`, canonical and `og:url` (from the head partial), hreflang pairs (written by
`make_es.js`), and one share button with pre-written EN and ES text (`data/strings.js` `share.<page>.*`).
Copy for SEO lives in `data/strings.js` `seo.<page>.*`.

### 4.1 Home (`index.html`, W1)

**Job:** in five seconds, say who we are and hand over one dated thing to do; by the second screen,
the lead civic action; by the third, video. Target page height at 390 px: **at most 9,500 px**
(A was 14,290).

| # | Section | Contents and components | Copy notes |
|---|---|---|---|
| 1 | Hero (`.section--violet`, **flat**) | eyebrow chip (line 2), kinetic H1 (line 1), rotor (line 3), sub (line 4), `.btn--primary` Join free → `#join`, `.btn--ghost` See what's on → `#invites`, reassurance (line 7). Desktop: two columns, the big `.invite--hero` card (tilted polaroid photo, sticker, date ticket, I'm in) on the right. Stickers decorate the edges and never sit behind text. | No gradient, no glow, no pattern under text. No chat thread. |
| 2 | Invite ticket (phones) | `.invite--compact` built by `YSD.events` from the next upcoming event: a golden-hour photo of people (about 120 px tall), DEMO event tag, "Thu, Nov 19 · 7 pm · Casselberry", Free, "{n} going (DEMO)", **I'm in** (opens the RSVP sheet), Details (event page) | Auto-advances when an event passes. |
| 3 | Pinned: the next thing to do | `.snap` strip of up to 3 `.pin` cards from `civic.nextActions` (sorted by priority, filtered by `showFrom`/`showUntil`): (a) **mail-ballot card** with a live countdown ("52 days" on Nov 9, until pre–Nov 3 requests end), line 23, **Add the January reminder** (.ics Mon, Jan 4, 2027, 10 am ET) and **How to renew** (`links.vote.voteByMail`), REAL DEADLINE tag; (b) student-ID card (serious styling, required wording from 00); (c) the next hangout. Each civic card shows "Links checked Nov 9, 2026" and its statute. | The countdown counts to the date old requests end. Never say "deadline to renew", never "you can't renew before Jan 1". |
| 4 | City ticker | `.ticker` of the seven cities plus Geneva, Chuluota and unincorporated Seminole, with Pause motion | |
| 5 | The Reel | `YSD.reel.mount()` (W4): 4 vertical `.story` cards, poster first, captions burned in, each with one action chip; a "Post yours" card; link to `clips.html` | Section label "CLIPS FROM THE GROUP · DEMO". No view counts. |
| 6 | You're invited | 3 `.invite` cards (duotone covers), the drop line "January's lineup drops Tue, Dec 15 at noon (DEMO)" with **Notify me** (.ics), link to `events.html` | |
| 7 | Send it to the group chat | `YSD.maker.mount()` (W5) with templates invite, mail-ballot heads-up, join me, me on the cover; the squad meter (line 28) | |
| 8 | Quiz teaser | "How do you show up?" card with three sample type names and **Start** → `quiz.html` | No XP, no "era". |
| 9 | Nov 3, debriefed | `.band--serious` (line 24), sources linked | Recheck after Nov 16 (§9). Auto-hide after Dec 31, 2026 (`showUntil`). |
| 10 | The real scoreboard | Heading "The real scoreboard: no demo numbers in this one"; 4 `.stat`s, each linked to its source (§9): "More than 1 in 3 Seminole voters are 18 to 40 (the county's own age band)"; "The biggest group of them: no party, 34.3%"; "About 54%: Seminole picked the Democrat for governor (unofficial)"; "About 27%: national youth turnout, an early CIRCLE estimate" | The "18 to 40" label sits in the stat itself so nobody reads it as the membership range. |
| 11 | Join (`#join`) | "$20 a year. Or free." three `.tier`s (§4.2) and the short join form via `YSD.joinForm.mount()` (W6), then the member card on success | Chip-in line 26 sits below, never near §9. |
| 12 | The Thursday Letter | one card: subject line, the first two sentences of the sample letter, "Read the sample issue" → `newsletter.html` | |

**Data:** `data/slices/home.js` (generated by W1 with `tools/slice_data.js`: next 6 events with the
fields `eventcard.js` needs, `civic.nextActions`, the dates and links they reference, the clip list),
`data/pages/home.js` (page copy). Home never loads `data/civic.js`, `data/events.js` or
`data/strings.js` in full.

**Acceptance:**
- At **390 x 664** (Safari's visible area) Join free is fully visible; at 390 x 844 the invite ticket's photo is visible.
- At 390 px: the mail-ballot card's top is at **1,000 px or less**; the Reel's top at **1,688 px or less**; the page is at most 9,500 px tall.
- RSVP from the ticket, the pinned hangout card and the invites card share one state: after a sheet submit, all three show "You're in" and the count rises by 1 (plus the +1) everywhere.
- With `?ref=KIRA7QX&from=Kira&e=<id>` the invite landing banner shows "Kira invited you to …" with I'm in (§5.1).
- All global gates in §6b pass.

### 4.2 Join (`join.html`, W6)

**Job:** join in under a minute, money optional; make membership honest.

Sections: (1) hero "Join free" + `brand.welcome`; (2) **the form** (`YSD.joinForm`): first name,
email or mobile, "How old are you?" (`legal.snippets.ageLabel`/`ageHint`: a neutral age screen; under
14 shows `ageTooYoung` and stores nothing), the hidden honeypot `_hp`, the join notice and privacy
link; (3) step two after success, all optional: city or ZIP, an inline issue picker (the 9 issues as
chips), access needs, SMS opt-in (unchecked, only when a mobile number was given, `legal.snippets.smsConsent`
wording); (4) **"$20 a year. Or free."**: three equal `.tier`s:

| Tier | Price | What it is |
|---|---|---|
| Come to things | $0 | Join the list, come to every event, make cards, post clips |
| Voting member | $20 a year, due in January | Vote and make motions at chapter meetings. Voting members live in Seminole County or go to school here (YDSC's dues page). Pay on ActBlue (`links.dues`) |
| Non-voting member | $0 | For anyone who qualifies but can't pay dues, whatever the reason, money or citizenship status |

(5) "What happens next" (`join.next`, `join.noPressure`); (6) the member card (W5 `YSD.memberCard`)
with your link and the squad meter; (7) the chip-in line (line 26) with `YSD.share.actblue(5)`.

**Acceptance:** 3 required fields at most; `YSD.members.validate` errors render inline with
`aria-invalid`, `aria-describedby` and an error summary that takes focus; an under-18 age gets a
random-style refCode and no `from` name in links; the ref captured on arrival is in the join payload
(`referredBy`); success shows line 13, confetti (not under reduced motion) and the member card; a
static `<form name="join">` exists for Netlify Forms; no tier is pre-selected.

### 4.3 Events (`events.html`) and event / invite pages (`events/<id>.html`), W2

**Events list.** Hero "You're invited" + "First time? Perfect." word sticker; filter chips (kind:
social, learn, volunteer, create; city; "In Spanish"); `.invite` cards in date order (past events
hidden); the **drop**: events after Dec 31, 2026 stay hidden until "January's lineup drops Tue, Dec 15
at noon (DEMO)", then appear automatically by the visitor's clock (`?drop=open` previews them); a
**Notify me** .ics for the drop; **Also this month (REAL)**: the Seminole County Democrats monthly
meeting (second Thursday, 7 to 9 pm, socializing from 6:30 pm; next Thu, Nov 12, 2026, Altamonte
Springs) and the SemDems holiday party (Fri, Dec 11, 2026, 6 to 9 pm), per the state party's events
calendar (report 01 §1a, checked Nov 9, 2026): REAL tag, link out to the party's calendar for RSVP,
no RSVP sheet, no count, auto-hidden after the date; "Want to host the next one?" with a short host
checklist (public venue, alcohol-free, access note, minors policy) and a link to join; empty state
line 18.

**Event page (also the shareable invite view).** One static page per event, generated by
`tools/make_event_pages.js` from `data/events.js` (EN and `es/events/<id>.html`), so link previews
carry the event without JavaScript. Order:
1. **Invite landing banner** (only with `?ref` or `?from`): "Kira invited you" (or "A friend invited you") + I'm in.
2. Duotone cover in the event's colour with the date stub, title, DEMO event tag, stock tag.
3. When (am/pm), where (public place with a map link, or a generic venue), cost (Free), vibe chips, language, alcohol-free, who it's for (ages 14+, guardian note when `ages.guardian`).
4. **RSVP row:** I'm in / Maybe / Can't (`aria-pressed`) → the RSVP sheet (§5.4). Full events show the waitlist.
5. Going count and face pile, "(DEMO)" always beside the number.
6. **Access** paragraph (`accessibility`), what to bring, `notice` / `extraNote` callouts verbatim.
7. Add to calendar (.ics, Google, Outlook), "+1 a friend" (share with ref), "Text this to a friend".
8. "First time? Here's what happens" (3 short steps).
9. Sources disclosure for any fact in the copy (`facts[]`), "Links checked" date.
10. Two related events.

**Data edits W2 makes in `data/events.js`:** rename `trivia-how-seminole-are-you` to id
`trivia-county-edition`, title "Trivia night: Seminole County edition" / "Noche de trivia: edición
condado de Seminole" (nothing else references the old id); add `cover.photo { id, photographer, page }`
per event (verified photos only; with none, the cover is a solid `--duo` block with a sticker);
keep every access paragraph concrete (who it helps, what exactly is offered).

**Acceptance:** each event page has static OG tags and its own OG image
(`assets/img/og/events/<id>.png`, type-only); with JavaScript off the page shows every detail, and
I'm in is a plain link to `join.html?e=<id>` that `rsvp.js` upgrades to the sheet; the
sheet requires first name and contact, and the count only rises after submit; `.ics` times are
correct UTC (Nov 19, 7 pm EST = 00:00Z on Nov 20) with a 3-hour alarm; the trivia rename is complete.

### 4.4 Vote hub, "2027 Ready" (`vote.html`, W3)

**Job:** the trustworthy, bilingual voting toolkit, official links only, every date sourced.

Sections: (1) hero "Ready for 2027" + "Official links only" word sticker + the SOE phone; (2) **the
mail-ballot card** with the countdown, the required copy shape, **Add the January reminder** (.ics
Mon, Jan 4, 2027, 10 am ET; Jan 1 is a holiday, and the office phones are open Mon to Fri, 8 am to
5 pm) and **Renew** (`links.vote.voteByMail`, `mailBallotRequest`), plus "Not sure when 2027 requests
open? The Supervisor of Elections can tell you: 407-585-8683"; (3) the steps from `civic.steps`, each
rendered with `id="<step.id>"` (`register`, `check-registration`, `renew-mail-ballot`, `polling-place`,
`early-voting`, `what-id`, `party-and-primaries`, `problems-at-polls`), each with a "checked" date and
source; the student-ID change uses the serious template and the required wording; (4) **key dates**
(`id="dates"`) from `civic.dates` with `confirmed` / `expected` labels; (5) **make a plan**
(`civic.plan`): when, how, who's coming → .ics + a plan card; (6) **your private checklist**: tick
what you've done (stored locally, never shared, **no points, no stickers, no badges** for civic
steps); (7) "No party? Here's what you can vote in" NPA explainer; (8) FAQ (`civic.faq`) as
`<details>`; (9) share cards for the mail-ballot and student-ID heads-ups (PSA templates via the maker).

**Data edits W3 makes in `data/civic.js`:** the renewal reminder `calendar.date` becomes
`2027-01-04T10:00:00-05:00`, `allDay: false` (copy says "in January"); keep `showFrom`/`showUntil` so
the card flips to "renew now" on Jan 1.

**Acceptance:** every voting link is `YSD.cfg('links.vote.<key>')`, never typed by hand; every hash
in `data/issues.js` `anchors.vote` exists; nothing on the page lists accepted IDs from memory (link the
SOE); the `.ics` reminder is Mon, Jan 4, 2027, 10:00 am ET; `tools/voice_lint.js` finds no "every
request expires" wording.

### 4.5 Feed, "The Reel" (`clips.html`) and Post (`post.html`), W4

See §6 for the full video spec. **Feed page:** a full-height vertical feed (`YSD.feed.attach`), the
weekly prompt at the top ("This week: 60 seconds on why you showed up"), tag filters, the Post button
(opens the post sheet; `post.html` is the same flow as a page for deep links and no-JS), the moderation
promise, a Report button on every clip, and the "Pending review · only you can see this" card for your
own clips. **Acceptance:** §6.

### 4.6 Issues (`issues.html`, W3)

Nine `.issue` sections from `data/issues.js` (`id="<issue id>"`), each with its colour token, sourced
facts, "what we're doing" (DEMO where it is not confirmed), and 1 to 3 actions; serious-tone issues use
the serious template (no stickers, emoji or donate module); a "Find your issue" quiz link (W5); share
a card per issue. Rent, insurance and heat get no local numbers until sourced (01 §10). **Acceptance:**
every fact shows its source on tap; no invented statistic; anchors match `issues.anchors.issues`.

### 4.7 Quiz (`quiz.html`, W5)

Two quizzes from `data/quiz.js`: **"How do you show up?"** (renamed from "What's your organizer era?";
slug `show-up`; 8 questions, 6 types) and **"Find your issue"** (quick mode, 4 questions; full, 7).
One question per screen with progress, big tappable options (44 px+), back and skip, then: one
confident match plus the "undertone", the mix strip, "Not quite you? See your next match", three
actions (from the result's `actions`), matching event series, and the result card (9:16 and 4:5) with
"What's yours?" and your link printed on it. No answers are stored or sent (result only).
**Static result pages** `quiz/show-up/<result>.html` and `quiz/issue/<slug>.html` (EN + ES) with their
own OG tags and images, so a shared result previews properly. **Acceptance:** the reference scorer in
`data/quiz.js` gives the same result as the page for 20 random answer sets; no XP, levels or "era"
anywhere; the share card prints a URL and refCode.

### 4.8 Newsletter sample issue (`newsletter.html`, W6)

The Thursday Letter, issue rendered from `data/newsletter.js`: subject and preheader, The Letter
(bylined DEMO writer, 120 to 200 words, sign-off line 22), One Thing (the mail-ballot action), The
Picks (5, each with a reason, free first), Spotlight (DEMO), Ask the Group Chat, footer (forward to a
friend, share link, Spanish version, unsubscribe note). Archive stubs below; a signup form (the join
form in compact mode). Tones stay separated: the calm letter and the fun picks never share a card.
**Acceptance:** zero emoji and at most one exclamation mark in the letter; every fact links its
source; DEMO labels on writer, spotlight and question.

### 4.9 About / team (`about.html`, W7)

Sections: who we are (chapter of the Florida Young Democrats; parent party Seminole County Democrats
with a link; what the chapter does, from the YDSC ActBlue description, paraphrased); **What's real?**
(`#whats-real`: real = voting facts and links, membership rules from the dues page, sourced stats; DEMO
= events, people, counts, clips, letters); team (`data/team.js` placeholders, "Your President Here",
DEMO); run for a role; **city crews (DEMO)**: Celery City Crew (Sanford), SunRail Regulars (Lake Mary
and Longwood), Chuluota Porch Club, and one per remaining city, shown as invitations, never ranked;
code of conduct link; contact (hidden while `links.contact` is `''`; falls back to the join form).
**Acceptance:** no real officer names; no leaderboard; no promise of a receipts page unless the chapter
agrees to publish one.

### 4.10 Privacy (`privacy.html`), accessibility (`accessibility.html`), teen safety, clip rules, code of conduct (W7)

Render from `data/legal.js` (`pages.privacy`, `pages.accessibility`, `pages.minors` → `teen-safety.html`,
`pages.moderation` → `content-policy.html`; add `pages.conduct` → `conduct.html`, written by W7: be
kind, no harassment, no doxxing or lists of private people, no recording minors without consent, how to
report, who replies and how fast). Each page: a "DRAFT, not legal advice" notice, the TL;DR, a table of
contents, sections with stable ids (SMS terms at `#privacy-sms`), effective date, and the **Forget me on
this device** button (calls `YSD.members.forget()`, clears `rsvp:*`, `maker:*`, `quiz:*`, `stickers`,
and local clips via `YSD.clips.reset()`). **Acceptance:** every `(coming)` label from Concept A is gone;
footer links resolve; Spanish versions exist.

### 4.11 404 (`404.html`, W7)

Line 27, a big sticker you can tap for a fact (the toy), links to Home, Events, Vote, Join. Hosts
serve `404.html` at whatever depth the missing URL had, so relative links would break there: `404.html`
(and `es/404.html`, with `<base href="/es/">`) is the one page that carries `<base href="/">`, so its
partial links and assets resolve from the site root (allowed by the CSP's `base-uri 'self'`; a
sub-path deploy adjusts the base). It is never opened from `file://`. `tools/check_site.js` already
serves it for missing paths.

### 4.12 Offline (`offline.html`, F0) and style guide (`styleguide.html`, F0)

Offline: "You're offline" (`state.offline.*`), what still works (cached pages), a retry button.
Style guide: every component in §3.8 in light and dark, at 390 and 1440, with copy-paste markup.

---

## 5. Virality and growth mechanics

**The loop:** see something (a card in a group chat, a clip, an invite link) → land on a page that
already knows why you came → one tap (I'm in, Join free, Start the quiz) → leave with something to
send (your link, your card, your +1) → a friend lands. Ranked by the research's payoff for a static
site (08 §6, 04 Part E): (1) quiz with identity card, (2) Partiful-grade invites with drops, (3) the
group-chat share layer on every page, (4) the Reel with an action per clip, (5) sticker collecting with
weekly streaks (replacing levels), (6) the weekly clip prompt, (7) honest proof, (8) collectibles,
(9) the delight layer. Each mechanic below lists the demo data model and the production seam.

### 5.1 Referral links, invite landing and the squad meter (W2 landing, W5 meter)

- **Link shape:** `YSD.share.url('<page>', { from: '<FirstName>', e: '<eventId>' })` → `…/events/trivia-county-edition.html?ref=KIRA7QX&from=Kira&utm_source=share&…`. `ref` comes from `YSD.members` (adults: name style; **under 18: random style, and `from` is never added**). `from` is the sender's first name, letters, spaces and hyphens only, at most 20 characters, added only when the sender ticks "Show my first name on the invite" (on by default for adults).
- **Landing state** (`YSD.invite.landing()`, W2, used on every page that has `[data-invite-landing]`): `share.js` captures `ref` on arrival; the banner reads `from` (rendered with `textContent`) and `e`, and shows "Kira invited you to Trivia night, Thu, Nov 19, 7 pm" with I'm in (opens the RSVP sheet with the ref attached) or, without `e`, "Kira invited you to the Young Dems" with Join free. Dismissable; remembers `invite:seen:<ref>`.
- **Attribution:** the captured ref (30-day window, last touch) goes into join payloads (`referredBy`, core) and RSVP payloads (`ref`).
- **Squad meter** (`.meter`, W5): "Friends who joined with your link: n of 3" from `YSD.members.squad()` **filtered to `simulated !== true`**. In the demo only joins on this device count, and the meter says so in a hint. Never render simulated squad members.
- **Production seam:** `integrations.squadEndpoint` (`GET ?ref=CODE → {squad:[{name, joinedAt}]}`, first name and last initial only), already handled by `members.js`.

### 5.2 Share-card maker (W5; `assets/js/maker.js`, `assets/js/cards-brand.js`)

- **Templates** (registered with `YSD.cards.register`): `invite` (an event: date ticket, "Come with me."), `psa-mail` (the mail-ballot heads-up in the required wording) and `psa-id` (student-ID change, serious styling, no stickers), `join` ("Join me"), `cover` ("Me, on the cover": 9:16 magazine cover with your name huge, city, "is here for {issue}", optional selfie that never leaves the device), `quiz-show-up` and `quiz-issue` (from the quiz), `membercard`, `rewind` (§5.6).
- **Sizes:** every template renders **4:5 (1080 x 1350)** and **9:16 (1080 x 1920)**; a size toggle in the maker. OG sizes (1200 x 630) are W8's type-only templates.
- **On every card, every size:** the link (`YSD.ui.prettyLink(YSD.share.url(…))`: no protocol, no `index.html`, no utm, keeps `ref`), the DEMO mark (`cards.demoWatermark`), and the paid-for line (`legal.cardFooter` or the placeholder). The PSA cards also print "Official info: voteseminole.gov".
- **Controls:** template, **first name (required, no prefill)**, city, colourway (5 city/brand colourways), sticker, size, editable message (prefilled in a friend's voice from `data/sharekit.js` `groupChat`), the message shown as one preview bubble. Until a first name is typed, the card shows the generic headline (no "X FROM Y SAYS") and the link carries no ref. **A ref is minted only by joining:** non-members see "Want credit when friends join? Get your link" (first name + email or mobile, `YSD.members.join`), then the card updates.
- **Actions** (all in the click handler, card rendered beforehand): Send it to the group chat (`YSD.cards.share` with the PNG file, falling back to text + link, then copy), Save image, Text it (`sms:`), WhatsApp, Copy link. PNG export at most 1.2 MB (B's was 1.8 MB).
- **Data model:** `maker:draft` (template, size, city, colour, sticker, message; never the selfie), `YSD.counters.bump('cards')` on share (core).
- **Production seam:** none needed (client-side). Pre-rendered OG images for shared pages are §5.8.

### 5.3 Quiz with result cards (W5)

Spec in §4.7. **Data model:** `quiz:<quizId>:result` = `{ resultId, undertone, ts }` only (no answers,
per `data/quiz.js` privacy). Analytics: `quiz_start`, `quiz_complete {quiz, result}`. **Share:** result
page URL with ref; card ends "What's yours? {link}". **Production seam:** none.

### 5.4 Partiful-style invites, RSVP and calendar (W2; `assets/js/rsvp.js`, `assets/js/eventcard.js`)

- **One-tap start, short sheet:** I'm in opens `.sheet` with `events.rsvpForm.fields`: first name (required), email or phone (required, one field, validated with `YSD.members.validate`), +1 (number), access needs (optional), "Show my first name in who's going" (off by default; always off for under-18s), the guardian note on `ages.guardian` events, and the consent line. Maybe and Can't record a status without the sheet and get warm replies ("Rest counts too").
- **After submit:** the count rises (DEMO count + 1 + plus-ones), your initial joins the face pile if you opted in, confetti, toast line 14, and the sheet turns into the success state: Add to calendar (.ics with a 3-hour alarm, Google, Outlook), +1 a friend (share with ref), Text this to a friend. Every `[data-rsvp="<id>"]` control on the page updates (`YSD.rsvp.on`).
- **Data model:** `rsvp:<eventId>` = `{ eventId, status: 'in'|'maybe'|'cant'|'waitlist', firstName, contact, contactType: 'email'|'phone', plusOne, access, showName, ref, from, lang, ts, synced: false, demo: true }`; `YSD.counters.bump('rsvps')` on the first `in`.
- **Drops:** `events.schedule` and the drop rule in §4.3; `drop:notify` remembers the .ics download.
- **Production seam:** `YSD.rsvp.submit(payload)` POSTs JSON to `YSD.cfg('integrations.rsvpEndpoint', '')` (requested from infra, §7.2), else to `integrations.formEndpoint` with `formName: 'rsvp'`, else, when an event has a Mobilize URL, opens it with the ref as `utm_source`. Failed submits queue in `rsvp:queue` and retry on `online`. Contact details never go to analytics.

### 5.5 Member card, sticker book and weekly streak (W5; `assets/js/membercard.js`)

- **Member card:** first name, city colourway, "Member since Nov 2026", your link, the squad meter, your stickers. No member numbers in the demo (a number would be invented).
- **Sticker book** (replaces C's XP and levels; `data/levels.js` is re-skinned): each **organizing** action collects one county sticker, shown on the card with the date: join (`doors-open`), first RSVP and first event (`golden-hour` and friends), bring a friend who joins (`plus-one`, `squad-of-three`), post a clip (`on-camera`), volunteer shift (`shift-done`), attend in a second city (`city-hopper`), make a card, finish the quiz. **Civic steps** (set the reminder, renew, make a plan, check registration) **earn nothing**: they get a private check on the vote hub only. No XP numbers anywhere; no levels HUD; no public leaderboard; nothing of value. The one physical perk the data allows (a sticker at your first event) is an organizing action and shows "Example perk (DEMO)".
- **Weekly streak:** "active weeks" (any organizing action in a Monday-to-Sunday week, New York time), with rest weeks from `levels.streaks.restWeeks` (Thanksgiving week of Nov 23, 2026, the holidays) and grace weeks; quiet weeks fade without a message; nothing ever goes down; no guilt copy (`streaks.never[]`).
- **Data model:** `stickers` = `[{ id, action, ref?, ts }]`, `streak` = `{ weeks: ['2026-11-09', …] }`.
- **Production seam:** check-ins at events (QR) and moderator approvals come from the backend later (`levels.actions[].verify`); the demo marks attend actions "I was there (DEMO)".

### 5.6 Seminole Rewind, the Wrapped-style impact card (W5)

From Thu, Dec 17, 2026, 7 am (`sharekit.proposedPages.rewind.showFrom`) the member card and the maker
offer a `rewind` template: "My 2026 with the Young Dems": events you RSVPd to, cards you made, friends
who joined with your link, stickers collected, in 3 story-sized slides (9:16) plus one 4:5 summary.
Chapter-level totals appear only if real, else they are omitted (never DEMO numbers on a Rewind card).
`?preview=rewind` shows it early for review. Data: local only.

### 5.7 Social-proof counters (all pages; `YSD.counters`)

Show a counter only where it means something and only above a threshold (members 50+, RSVPs per
event 10+); in demo every count carries "(DEMO)" in both languages; **no live ticking** (`ui.js` calls
`YSD.counters.stopLive()` on load) and no counts that reset; each count links to what it counts.
Event going counts come from event data plus your own RSVP. Production: `integrations.countersEndpoint`.

### 5.8 The group-chat share layer (every page; W8 tooling, page owners content)

- Static OG and Twitter tags on every page; **type-only OG images** (1200 x 630, under 150 KB) rendered by `tools/make_og.js` from W8's `assets/js/cards-og.js` templates (`og-page`, `og-event`, `og-quiz`) into `assets/img/og/…` (+ `og/es/…`). Each page declares its image: `<meta name="ysd:og" content='{"template":"og-page","title":"…","kicker":"…"}'>`.
- One share button per page (`[data-share]`, `YSD.share.native` with `share.<page>.*` text), plus copy link, `sms:` and WhatsApp in the share sheet.
- `twitter:card = summary_large_image`. At launch, `tools/make_og.js --absolutize` rewrites `og:image` to absolute URLs from `site.url`.

### 5.9 Weekly clip prompt (W4)

One prompt per week on the feed and in the post sheet ("60 seconds on why you showed up"), from
`data/sharekit.js` `scripts` hooks; "Add yours" pre-fills the tag. Members' clips carry the prompt tag.

### 5.10 What we don't do

Simulated joins or friends; fake or ticking counters; view counts; XP or any reward on voting,
registration or mail-ballot actions; leaderboards of people; countdowns that reset; pop-ups or modals on
a first visit; pre-checked boxes; discount-style capture; voter-registration drives or petition
gathering (F.S. 97.0575 and HB 1205 need a compliance check first); lists of private individuals.

---

## 6. Video posting spec

**Owner:** W4 (`clips.html`, `post.html`, `assets/js/reel.js`, `assets/js/pages/clips.js`,
`assets/js/pages/post.js`, `assets/css/pages/clips.css`). Built on the infra contracts in
`docs/infra/video.md` (`YSD.clips`, `YSD.feed`); W4 does not edit those files or `data/clips.js`.

**Watching**
- Vertical 9:16 cards, **poster first**. The feed autoplays muted only the clip most in view, never under `prefers-reduced-motion`, Save-Data or 2G (feed.js already enforces this); on the home strip, clips play only on tap.
- **Controls:** a visible play/pause button and a mute button (`aria-pressed`, labels that state the action), progress bar, and a native-controls toggle ("Show video controls") for seek; Space, arrows, `m` and `j/k` keys (feed.js). Announce play state changes through the status region only on user action.
- **Captions:** burned in on every demo clip, plus a transcript under each clip ("Read the captions", a `<details>` built from `burnedInText`). Uploads must say they have captions (a checkbox) and the moderation queue checks it.
- **One action chip per clip**, mapped from tags: `vote-by-mail` → `vote.html#renew-mail-ballot`, `explainer` → `vote.html`, `events` / recap tags → the next event, `canvass` → `events.html?kind=volunteer`, default → `join.html`.
- **Counts:** no view counts anywhere. Likes are a heart for your own like (double-tap or button, heart burst on `ysd:feed-like`); no like numbers in demo.
- **Labels:** "DEMO clip" and the `@demo.*` handle on every demo clip; creators shown by handle only.
- **Report** on every clip (`legal.snippets.report` reasons), opening a sheet; in demo it hides the clip locally and says a moderator would review it.

**Posting** (`post.html`, and the same flow in a sheet on `clips.html`)
1. Choose: **upload a file** (`YSD.clips.validate` then `YSD.clips.add`) or **paste a link** to a TikTok, Instagram or YouTube post (hosts `tiktok.com`, `instagram.com`, `youtube.com`, `youtu.be`; anything else gets the specific error "That link isn't from TikTok, Instagram or YouTube", and an empty field gets "Paste a link or pick a video").
2. Caption (max 300, counter), tags (max 8), the weekly prompt tag pre-filled when you came from it.
3. "How old are you?" if the site doesn't know; **"Does anyone under 18 appear in this clip (including you)?"** (`legal.snippets.minorsInClip`) → guardian contact field when yes.
4. Three **unchecked** consent boxes (`legal.snippets.uploadConsent`): I made it or have permission (music too); everyone recognizable agreed; captions or transcript included. The clip rules link.
5. Submit → **the sheet closes**, focus returns to the Post button, and a **"Pending review · only you can see this"** card appears at the top of the feed with your poster (from IndexedDB, object URL), caption and a Remove button; toast: `legal.snippets.uploadPending` ("A person on our team checks every clip, usually within 3 days").
6. `YSD.counters.bump('clips')` after `add()` resolves. Errors use `YSD.clips.messages` copy.

**Demo data:** files in IndexedDB (`ysd` / `blobs`, buckets `clips`, `clip-posters`), metadata in
`clips:local`, likes in `clips:liked` (infra keys). Link-paste submissions stay local as
`{ source: 'local', link, status: 'pending' }` records under a new key `clips:links` (W4).

**Production seam:** `integrations.videoUploadEndpoint: '/api/video-upload'` plus provider env vars
(Cloudflare Stream or Mux direct uploads through `functions/api/video-upload.js` /
`netlify/functions/video-upload.js`); add Turnstile via `YSD.clips.beforeUpload`; a moderation queue
and a named moderator with a response-time promise before any public clip; auto-captions corrected by a
human. **Open item for the infra owner:** the demo clip `demo-sunrail-rally` is built from the banned
rooftop-selfie photo (`1758272134088`); swap it in `assets/video/make_demo_clips.py` and regenerate.

**Acceptance:** keyboard-only post flow works; focus returns after the sheet closes; the pending card
survives a reload (IndexedDB) and disappears with Remove or Forget me; no autoplay under reduced motion;
every clip has a transcript and an action chip; no number of views or likes is rendered in demo.

---

## 6b. Benchmark bar

What the competition does best, and the bar every page is scored against on every review pass.
Sources: report 07 (right-wing youth and campaign sites, measured Nov 9, 2026) and report 08 (Gen Z
beauty, TikTok-shop and brand sites, captured Nov 9, 2026).

**What they do best, and our answer**

| They do best | Who | Our answer (and where) |
|---|---|---|
| One unmistakable action per screen; date + place + register on the first screen | donaldjtrump.com, AmericaFest, CRNC | One primary and one secondary action per screen, the primary is social (Join free, I'm in); event pages put date, place and RSVP first (home §4.1, events §4.3) |
| Big-number proof | TPUSA ("3,500+ / 1,500+"), Hodgetwins | Only real, sourced numbers ("The real scoreboard"), demo counts labelled (§5.7) |
| Chapter-in-a-box, rewarded activism | TPUSA Students, Patriot Rewards | City crews + "host the next one" checklist (about, events); sticker book with public rules, no gatekeeper, nothing of value (§5.5) |
| Tentpole events, shows not posts | AmericaFest, PragerU, TPUSA formats | Monthly drops, named rituals (The Thursday Letter, The Picks, the weekly prompt) |
| Participation formats | Pick Up the Mic, story submissions | Post a clip with consent and moderation (§6) |
| Quiz-style capture, merch as identity | TPUSA merch pop-up, Trump Store | Inline issue picker after joining, no modal; cards and stickers as identity (§5.2) |
| Finders in the top nav, self-sort into roles | Rare Beauty, Tower 28, Merit, Gymshark, Wrapped | Quiz in the nav, result routes to actions (§4.7) |
| Something to collect, a reason to come back on a date | Starface, A24, Owala, Skims | Sticker book, Seminole Rewind, the January drop, Notify me |
| Group-chat voice, tactile buttons, video up front | Partiful, Duolingo, Poppi, Gymshark | Friend-voiced share texts, pressable buttons, the Reel by the third screen |
| Speed and zero trackers | Apple (0 third-party hosts), Summer Fridays | Self-hosted fonts, no trackers, at most 1 outside host |
| A designed dark mode | Partiful (the only one of 29) | Designed dark theme (§3.2) |

**Where they are weak** (we must beat all of these): TPUSA home 19.0 MB and start-a-chapter 28.6 MB on
a phone; Lighthouse performance 30 to 51 on most right-wing org pages; privacy banners covering 21 to
41% of the first screen and full-screen modals on 5 sites; 18 of 23 right-wing pages failing axe;
**0 of 23 offering Spanish**; 8 to 10 ad tags and 49 to 84 outside domains; stale heroes and builder
leftovers; Donate as the only first-screen ask. Brands: 9 of 23 store homes fire a discount pop-up within
about 7 s; median 6.8 MB and 37 third-party hosts; 1 of 29 with dark mode.

**The checklist.** Score each item 0 (absent or failing), 1 (present, generic) or 2 (matches or beats
the named benchmark). 40 items, 80 points. **48+ is desirable, 60+ is the target for launch.** Items
marked **GATE** must score at least 1 or the page fails regardless of total. "All" means every page;
measurement tools are in §10.

| ID | Check | Threshold | Beats / matches | Pages | Measured by |
|---|---|---|---|---|---|
| B1 **GATE** | First-view weight | Home at most 350 KB compressed, other pages at most 500 KB; at most 30 requests | TPUSA 19.0 MB, RPOF 3.6 MB, brand median 6.8 MB | All | `qa.js` (gzip-6 for text) |
| B2 **GATE** | Speed | LCP at most 2.5 s on `bench --throttle 4g` and Lighthouse mobile; CLS at most 0.05; TBT at most 150 ms; Lighthouse perf 95+ on home | Summer Fridays, Apple; TPUSA LCP 3.8 s | All | `bench_compare.js`, Lighthouse |
| B3 | Outside hosts and trackers | At most 1 outside host (images.unsplash.com), 0 trackers | Apple 0; TPUSA 49 to 60 | All | `qa.js` |
| B4 | Fonts | No font file over 60 KB on the critical path; at most 2 preloads; no font gate | report 07 §7 | All | `qa.js` |
| B5 | Who and what | Hero says who and what in 8 words or fewer | A24, Nike, Partiful | Home, landing pages | review |
| B6 **GATE** | First screen | One primary + one secondary action fully visible at 390 x 664; no modal, cookie wall or age gate on first visit | Apple, Partiful; beats TPUSA's 27 to 39% banner | All | `qa.js` |
| B7 | People | A graded photo of young people (labelled stock) within the first 844 px | Rhode, Rare Beauty, TPUSA Students | Home | `qa.js` |
| B8 **GATE** | Colour and contrast | At least 3 saturated full-bleed blocks (home); every text pair at least 4.5:1 (3:1 large), proven by pixel sampling, not only axe | Starface, Poppi (contrast fixed) | All | `qa.js` sampling + axe |
| B9 | Lead civic action | Mail-ballot card top at most 1,000 px at 390 | judges' must-fix | Home | `qa.js` |
| B10 | Video early | Vertical video band top at most 1,688 px at 390 | Poppi, Gymshark | Home | `qa.js` |
| B11 | Finder | Quiz in the top nav; Find your issue quick mode in 6 taps or fewer; ends in a 9:16 card | Rare Beauty, Tower 28 | Quiz, nav | review |
| B12 | Self-sort routes | Result shows 3 tailored actions and event series | Gymshark, Wrapped Clubs | Quiz | review |
| B13 | Collectible | Sticker book on the member card | Starface, A24 | Join, home | review |
| B14 | Weekly cadence | Active weeks with rest weeks, no shaming, no XP numbers, nothing on civic steps | Duolingo; beats Patriot Rewards on transparency | Join, vote | review |
| B15 | Toy that teaches | Tap a sticker, get a sourced fact | Liquid Death TIMEWASTER 5000 | Home, 404 | review |
| B16 | Share layer | Static og:title/description/image/image:alt and twitter:card; one share button with EN and ES text | Wrapped, Partiful | All | `check_site.js`, `qa.js` |
| B17 | Event pages | One link, no account; sheet collects name + contact + +1 + access; opt-in who's going; .ics/Google/Outlook; +1 link; waitlist | Partiful; AmericaFest first screen | Events | `qa.js` flow |
| B18 | Next drop | Dated drop with a time and Notify me .ics; demo dates labelled | Owala, Skims | Home, events | review |
| B19 | Community wall | Weekly prompt, consent, written rules, report button | Rare Beauty, Owala | Clips | review |
| B20 | Closed loop | `?ref` + `from` + `e` landing state; ref in join and RSVP payloads; link printed on every card size | judges' must-fix #1 | All | `qa.js` flow |
| B21 | Video basics | Poster first, captions burned in + transcript, muted by default, play/pause and mute with state, no autoplay under reduced motion or Save-Data | Poppi; beats 20 MB autoplay | Home, clips | `qa.js` |
| B22 | Clip action | Every clip ends in one action chip | Fenty, Tower 28 shoppable video | Home, clips | review |
| B23 | Post path | Moderation promise, 3 unchecked consents, minors question, pending card, sheet closes | judges | Clips, post | `qa.js` flow |
| B24 | Microcopy | Personality on buttons, empty, error, 404 and success; legal stays plain | Partiful, Poppi | All | review + `voice_lint.js` |
| B25 | Spanish parity | An `es/` page for every core page; 0 untranslated strings; hreflang pairs; `lang` correct | beats 0 of 23 right-wing sites | All | `make_es.js --check` |
| B26 | Voice lint | No banned words; at most 1 "!" per screen; no emoji in long copy; am/pm format; no "40 and under" | report 05 | All | `voice_lint.js` |
| B27 | Press and success | Press state and success moment on every primary action; 0 running animations under reduced motion | Duolingo | All | `qa.js` |
| B28 | Signature motion | Kinetic H1 as an enhancement; Pause motion for anything over 5 s | Spotify, Apple | Home | review + `qa.js` |
| B29 | Dark mode | Designed dark theme, both media query and toggle | Partiful | All | `qa.js` both themes |
| B30 **GATE** | Honest proof | Every demo number, person, event and clip labelled DEMO in both languages; no live ticks, simulated joins or view counts; real stats link to sources | beats TPUSA's unlinked numbers | All | `qa.js` `[data-demo]` check + review |
| B31 **GATE** | Accessibility | axe 0 serious/critical in light and dark at 390 and 1440; no text under 12 px; targets at least 44 px; reflow at 320; visible focus; skip link; zoom allowed; `aria-invalid` + `aria-describedby`; status messages announced | beats 18 of 23 failing axe | All | `check_site.js`, `qa.js` |
| B32 | Privacy | 0 trackers; a plain privacy promise beside every form; SMS opt-in unchecked with STOP/HELP | beats RPOF's required phone field | Forms | review |
| B33 **GATE** | Brand safety | No Native imagery or words; no politicians as endorsers; no candidate names; no alcohol in photos; stock photos visibly tagged | report 00 | All | `voice_lint.js` + review |
| B34 | Community safety | Code of conduct in the footer, report on clips, stated moderation time, no lists of private people | beats YR chat scandal, Professor Watchlist | All | review |
| B35 | Come back next week | A visible weekly reason on home (drop, prompt or Letter) | Duolingo, Owala | Home | review |
| B36 | Sign-up friction | At most 3 required fields; SMS optional; preference picker after the first submit | Skims; beats RPOF | Join, home | review |
| B37 | Freshness | Every time-bound item has `showUntil`; "checked" dates on voting links; no placeholder leftovers ("Lorem", "TODO", "Insert/edit link") | beats TP Action's stale promo | All | `qa.js`, `voice_lint.js` |
| B38 | Local layer | City crews, real county-party link, hyper-local events | beats Seminole GOP (no events, no youth path) | About, events | review |
| B39 | Starter kit | "Host the next one" checklist and path | TPUSA chapter kits | Events | review |
| B40 | Free sticker pack | Download the county sticker pack (PNG) after joining | 07 §5.9 | Join | review |

---

## 7. Tech architecture

### 7.1 Folder tree

```
youngsemdem/
  index.html  join.html  events.html  vote.html  issues.html  clips.html  post.html  quiz.html
  newsletter.html  about.html  privacy.html  accessibility.html  teen-safety.html
  content-policy.html  conduct.html  404.html  offline.html  styleguide.html
  events/<id>.html                       generated (W2)
  quiz/show-up/<result>.html  quiz/issue/<slug>.html     generated (W5)
  es/…                                   Spanish twins of everything above (generated)
  assets/
    boot.js                              F0: sets data-theme + .js before paint (outside assets/js on purpose)
    css/tokens.css base.css components.css utilities.css      F0
    css/rsvp.css (W2) maker.css (W5) pages/<page>.css (page owners)
    fonts/*.woff2                        F0
    icons/favicon.svg icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png   F0
    img/og/…  (+ og/es/…)                generated by tools/make_og.js, owned by each page's owner
    js/config.js store.js share.js cal.js cards.js members.js track.js clips.js feed.js sw-register.js   INFRA (do not edit)
    js/ui.js                             F0
    js/rsvp.js eventcard.js              W2
    js/reel.js                           W4
    js/cards-brand.js maker.js membercard.js   W5
    js/joinform.js                       W6
    js/cards-og.js                       W8
    js/pages/<page>.js                   page owners
    video/*.mp4 *.jpg make_demo_clips.py INFRA
  data/
    clips.js counters.js                 INFRA
    civic.js issues.js (W3) events.js (W2) quiz.js levels.js sharekit.js (W5)
    newsletter.js (W6) team.js legal.js (W7) strings.js stickers.js (F0, then lead)
    pages/<page>.js                      page copy, EN + ES (page owners)
    slices/core.js (F0) slices/home.js (W1)
  partials/head.html demo-banner.html demo-banner-es.html header.html header-es.html
           footer.html footer-es.html scripts.html            F0 (README.md is infra)
  tools/  sync_partials.py check_site.js csp.js manifest.js read_config.js make_sitemap.py
          credits.py shoot.js bench_compare.js               INFRA
          fetch_fonts.py slice_data.js                       F0
          make_event_pages.js (W2) make_quiz_pages.js (W5)
          make_es.js make_og.js qa.js voice_lint.js voice_rules.json og.html   W8
  docs/BRIEF.md  docs/TEMPLATE.html (F0)  docs/concepts/A|B|C (F0, reference copies)  docs/QA.md (W8)
  tests/infra/** (INFRA)  tests/site/** (W8)
  functions/ netlify/ netlify.toml _headers _redirects robots.txt manifest.webmanifest sw.js
  DEPLOY.md README.md package.json CREDITS.md                INFRA / generated
```

### 7.2 Config (`assets/js/config.js` → `window.YSD_CONFIG`)

The schema is infra's (`docs/infra/core.md`); page code reads it only through `YSD.cfg(path, fallback)`
and treats `''` as "not configured: hide it". Keys pages use: `demo`, `org.*` (name, short, nickname,
handle, minAge 14, ageCap 39, dues), `site.url` (share base; `''` = where the files are), `site.ogImage`,
`links.vote.*` (verified official links), `links.actblue`, `links.dues`, `links.countyParty`,
`links.mobilize`, `links.contact`, `social.*.url`, `integrations.*`, `legal.paidFor`,
`legal.cardFooter`, `legal.privacyEmail`, `legal.smsNumber`, `sharekit.confirmed`, `features.*`,
`clips.*`, `cards.*`, `share.*`, `members.*`.

**Hand-offs to the infra owner** (the lead applies them; no workstream edits `config.js`):

| Key | New value | Why |
|---|---|---|
| `theme.*` | bg `#FFF6EA`, fg `#170B33`, brand `#6A2BFF`, accent `#FF7AC6`, pop `#C8F03C`, muted `#574D70`, ink `#170B33`, paper `#FFF6EA`, fontDisplay and fontBody stacks from §3.3 | Card and manifest fallbacks match the brand; then run `npm run manifest` |
| `features.demoSquadGrowth` | `false` | Simulated friend joins are fake social proof (judges) |
| `features.demoLiveCounters` | `false` | No live-ticking demo counters |
| `cards.fonts` | `['800 64px "Bricolage Grotesque"', '400 32px "Atkinson Hyperlegible Next"', '700 32px "Atkinson Hyperlegible Next"']` | Cards wait for brand fonts |
| `site.ogImage` | `'assets/img/og/default.png'` | Default share image |
| `site.description` | "Young Democrats in Seminole County, FL, ages 14 to 39: free hangouts, straight answers about voting, and a crew that saves you a seat." | |
| `legal.cardFooter` | `'Paid for by [committee name and address placeholder] · DEMO'` | Disclaimer on every card |
| `integrations.rsvpEndpoint` | `''` (new key) | RSVP production seam (§5.4) |

Until applied, pages stay correct anyway: `ui.js` stops live counters and the squad meter filters
simulated members.

### 7.3 Data files

Classic scripts that assign to `window.YSD_DATA.<name>`; bilingual text is `{ en, es }`; dates are ISO
8601 with the New York offset; facts carry `source`, `verified`, `confidence`. Existing files and their
owners are in the tree above. New:

- `data/pages/<page>.js`: `window.YSD_DATA.pages.<page> = { 'hero.title': { en, es }, … }` (page copy only).
- `data/stickers.js` (F0): `{ items: [{ id, name{}, svg (string), fact{}, source, verified }] }`.
- `data/slices/*.js`: generated by `tools/slice_data.js` (F0) from the full files, keeping the same namespaces (`window.YSD_DATA.events = { …subset }`), with the regenerate command in the file header (`node tools/slice_data.js --rerun data/slices/home.js`). A page loads either a slice or the full file for a namespace, never both. `data/slices/core.js` holds the shared UI strings (`a11y`, `cta`, `form`, `error`, `success`, `toast`, `shareSheet`, `demo`, `lang`, `event`, `count`, `format`, `footer`) and loads on every page.
- **Rule:** a data file over 30 KB loads only on pages that render mostly from it (vote: civic; events: events; quiz: quiz and issues; legal pages: legal).

### 7.4 Partials and the page skeleton

Markers `<!-- @name -->…<!-- /@name -->` filled by `python3 tools/sync_partials.py` (infra), which also
sets `aria-current` and the `{{root}}`, `{{site}}`, `{{path}}` tokens. Never edit between markers.

- `head`: `color-scheme`, `theme-color` `#6A2BFF`, canonical and `og:url` (`{{site}}{{path}}`), `og:site_name`, `og:type`, `twitter:card`, favicon, apple-touch-icon, manifest, the two font preloads, the four core stylesheets, `assets/boot.js`.
- `demo-banner` / `demo-banner-es`, `header` / `header-es`, `footer` / `footer-es` (includes the `role="status"` toast region).
- `scripts`: the core stack in the required order.

```html
<!doctype html>
<html lang="en" data-page="events">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title data-t="seo.events.title">Events · Young Democrats of Seminole County</title>
  <meta name="description" content="…" data-t-content="seo.events.description">
  <meta property="og:title" content="…" data-t-content="seo.events.ogTitle">
  <meta property="og:description" content="…" data-t-content="seo.events.ogDescription">
  <meta property="og:image" content="assets/img/og/events.png">
  <meta property="og:image:alt" content="…" data-t-content="events:og.alt">
  <meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
  <meta name="ysd:og" content='{"template":"og-page","kicker":"THIS MONTH","title":"Free hangouts all over Seminole"}'>
  <!-- @head --><!-- /@head -->
  <link rel="stylesheet" href="assets/css/rsvp.css">
  <link rel="stylesheet" href="assets/css/pages/events.css">
</head>
<body class="p-events">
  <!-- @demo-banner --><!-- /@demo-banner -->
  <!-- @header --><!-- /@header -->
  <main id="main"> … <div data-invite-landing hidden></div> … </main>
  <!-- @footer --><!-- /@footer -->
  <!-- @scripts --><!-- /@scripts -->
  <script src="data/events.js"></script>
  <script src="data/pages/events.js"></script>
  <script src="assets/js/eventcard.js"></script>
  <script src="assets/js/rsvp.js"></script>
  <script src="assets/js/pages/events.js"></script>
</body>
</html>
```

Core stack inside `scripts`: `config.js`, `store.js`, `data/counters.js`, `share.js`, `cal.js`,
`cards.js`, `members.js`, `track.js`, `data/slices/core.js`, `ui.js`, `sw-register.js`. No inline
`<script>` and no inline event handlers (CSP `script-src 'self'`).

### 7.5 Spanish (static `es/` tree)

- Every visible static string in page HTML sits in an element with `data-t="<key>"` (leaf elements only; split sentences that contain links into spans). Attributes use `data-t-aria-label`, `data-t-placeholder`, `data-t-alt`, `data-t-title`, `data-t-content`. Keys without a colon resolve in `data/strings.js`; `page:key` resolves in `data/pages/<page>.js`. Brand names, numbers and untranslatable bits carry `translate="no"`.
- `node tools/make_es.js <page.html>` (W8) writes `es/<page.html>`: replaces every `data-t` text and attribute with the Spanish value, sets `lang="es"`, switches partial markers to their `-es` variants, prefixes asset paths with `../`, keeps page links pointing at Spanish siblings, and writes hreflang (`en`, `es`, `x-default` → English) into both files. `--check` fails on any visible text node not covered by a key ("0 English left"), and on a missing Spanish value.
- JS-rendered text reads `YSD.lang` (from `<html lang>`) and picks `[YSD.lang]` from bilingual data.
- Generated subpages (events, quiz results) are written in both languages by their own generators.
- Spanish is a draft until a fluent reviewer, ideally Puerto Rican, signs off (`reviewedSpanish: false` in the data). The `es` demo banner says so.

### 7.6 Store adapter and storage keys

Infra API (`docs/infra/core.md`): `YSD.store.get/set/update/remove/list/push/on/keys/clear/useAdapter`,
`YSD.db.put/get/all/del/keys/clear/ready`, `YSD.counters.get/bump/on/format/isDemo/stopLive`. The
production seam is `YSD.store.useAdapter({ load, save, remove, subscribe, match })`, so the synchronous
API keeps working on the local cache while the adapter mirrors it.

**Keys taken by infra** (never reuse): `member`, `joins`, `squad:remote`, `ref`, `utm`, `utm:first`,
`counter:*`, `clips:local`, `clips:liked`, `clips:views`, `clips:hidden`.

**New keys** (all through `YSD.store`, so they get the `ysd:` prefix):

| Key | Owner | Shape |
|---|---|---|
| `prefs:theme` | F0 | `'auto' \| 'light' \| 'dark'` (also read by `assets/boot.js` from `localStorage['ysd:prefs:theme']`) |
| `prefs:motion` | F0 | `'paused' \| 'on'` |
| `invite:seen:<ref>` | W2 | timestamp |
| `rsvp:<eventId>` | W2 | §5.4 |
| `rsvp:queue` | W2 | pending submits |
| `drop:notify` | W2 | timestamp |
| `maker:draft` | W5 | §5.2 (never the selfie) |
| `quiz:<quizId>:result` | W5 | `{ resultId, undertone, ts }` |
| `stickers`, `streak` | W5 | §5.5 |
| `vote:checklist`, `vote:plan` | W3 | `{ stepId: ts }`, plan fields (never an address) |
| `clips:links` | W4 | link-paste submissions |

All storage is wrapped in try/catch by the infra modules; pages render correctly with storage blocked
(private windows).

### 7.7 Component JS contracts

Each module is a classic script that attaches to `window.YSD`, tolerates missing siblings, renders
untrusted text with `textContent`, and emits `ysd:*` events through `YSD.emit`. Dependent pages ship the
markup from `styleguide.html` with a no-JS fallback link, so a late module never breaks a page.

| Module (owner) | API |
|---|---|
| `ui.js` (F0) | `YSD.t(key, vars?)`, `YSD.lang`, `YSD.fmt.date(iso, {weekday, time})` → "Thu, Nov 19 · 7 pm", `YSD.fmt.when(start, end)`, `YSD.ui.toast(text, {tone})`, `YSD.ui.sheet.open(el \| id, {opener})` / `.close()`, `YSD.ui.menu`, `YSD.ui.theme.get/set/cycle()`, `YSD.ui.motion.paused()` / `.toggle()`, `YSD.ui.countdown(el)` (reads `data-countdown="YYYY-MM-DD"`, New York time), `YSD.ui.confetti(el)` (no-op under reduced motion), `YSD.ui.prettyLink(url)`, `YSD.ui.langHref()`, `YSD.ui.stickerFacts(root)` (wires `[data-sticker]` buttons). Calls `YSD.counters.stopLive()` on load. |
| `eventcard.js` (W2) | `YSD.events.upcoming({ limit, until, includeDrop })`, `.get(id)`, `.render(event, { variant: 'invite' \| 'compact' \| 'hero' })` → Element, `.cal(event, lang)` → `YSD.cal` event, `.url(event)` → `events/<id>.html` |
| `rsvp.js` (W2) | `YSD.rsvp.open(eventId, { opener, status })`, `.state(eventId)`, `.set(eventId, status)`, `.on(cb) → off`, `.submit(payload)`, `YSD.invite.landing(root?)`; wires every `[data-rsvp]` |
| `reel.js` (W4) | `YSD.reel.mount(el, { limit, sort, showPost, autoplay: false })` |
| `maker.js`, `cards-brand.js` (W5) | `YSD.maker.mount(el, { templates, template, eventId, size })`; templates registered by name (§5.2) |
| `membercard.js` (W5) | `YSD.memberCard.mount(el)`, `YSD.stickers.collect(id, action)`, `.list()`, `YSD.streak.weeks()` |
| `joinform.js` (W6) | `YSD.joinForm.mount(formEl, { compact, onJoined })` |
| `cards-og.js` (W8) | templates `og-page`, `og-event`, `og-quiz` |

### 7.8 PWA, SEO and OG

- Manifest and service worker are infra (`manifest.webmanifest`, `sw.js`, `sw-register.js`; the worker is off in demo and on `file://`). F0 creates the icon files at the paths the manifest already names, plus `apple-touch-icon.png` (180 px) and `favicon.svg`.
- `404.html` and `offline.html` exist (tooling expects both).
- The whole demo is `noindex` (`_headers`); keep it until launch.
- Canonicals and `og:url` come from the head partial; `og:image` is relative in the demo and made absolute at launch (`make_og.js --absolutize`); hreflang from `make_es.js`; `sitemap.xml` from `tools/make_sitemap.py` once `site.url` exists.
- Structured data: `Organization` JSON-LD is not allowed inline (CSP); skip it for the demo.

### 7.9 Analytics

`YSD.track(event, props)` (infra): never sends in demo, drops personal-data keys, respects DNT and GPC.
Events pages send: `rsvp {event, status, referred}`, `rsvp_submitted {mode}`, `invite_landing {event, referred}`,
`quiz_start {quiz}`, `quiz_complete {quiz, result}`, `card_made {template, size}`, `clip_action {clip, target}`,
`sticker_fact {id}`, `drop_notify`, `reminder_add {id}`, `plan_made`, `lang_switch {to}`, `theme {mode}`.
Core already sends `share`, `card_share`, `calendar_add`, `join`, clip events. Launch with Cloudflare Web
Analytics or Plausible (report 06 §5.1), then `npm run csp`.

### 7.10 Performance budget

| Item | Budget |
|---|---|
| Home first view | at most 350 KB compressed (gzip-6 for HTML/CSS/JS/data; raw for fonts and images), at most 30 requests, at most 1 outside host |
| Other pages | at most 500 KB compressed |
| Fonts on the critical path | 2 files, at most 80 KB together |
| CSS | tokens + base + components + utilities at most 60 KB raw; page CSS at most 25 KB raw |
| Page JS (own) | at most 40 KB raw per page; infra stack excluded |
| First-screen photo | at most 60 KB |
| Clips | never preload video; posters only, each at most 60 KB |
| LCP / CLS / TBT | at most 2.5 s / 0.05 / 150 ms |

### 7.11 Deploy steps (demo)

1. `python3 tools/sync_partials.py` → `node tools/make_event_pages.js` → `node tools/make_quiz_pages.js` → `node tools/make_es.js --all` → `python3 tools/sync_partials.py` (again, for the generated pages) → `node tools/make_og.js` → `npm run credits`.
2. `npm run preflight` (sync check, CSP, manifest, `check_site.js`), `node tools/qa.js --all`, `node tools/voice_lint.js`, `npm test` (infra suites).
3. Drag the folder onto Netlify or Cloudflare Pages (no build command; publish directory `.`), or follow `DEPLOY.md`.
4. Launch later (not now): `demo: false`, `site.url`, integrations, analytics, legal copy, remove `noindex`, `make_og.js --absolutize`, `npm run check:strict` (DEPLOY.md §7 and §9).

---

## 8. Compliance placeholders

All of these are placeholders until the chapter and its counsel decide. Nothing here is legal advice.

| Item | What ships in the demo | Where | Basis |
|---|---|---|---|
| Political ad disclaimer | "Paid for by [committee name and address placeholder]" + DEMO tag on every page and every share card | footer partial, `legal.cardFooter` | Fla. Stat. 106.143(1)(c) (report 06 §7.1); final wording ("Pd. pol. adv.", payer name and address, in-kind statement) comes from counsel after the committee-status decision |
| Not approved / not official | Footer lines 2 and 3 (§4.0); `footer.notApproved` placeholder | footer | report 01 §9; brand safety |
| Demo status | Demo banner on every page; "DEMO" on every made-up item in both languages | partials, components | report 00 |
| Email consent | Join notice under the form; one-click unsubscribe promised in the Letter footer | join, newsletter | CAN-SPAM practice, Gmail sender rules (06 §7.3) |
| SMS consent | Unchecked box, `legal.snippets.smsConsent` text (program, frequency, rates, HELP/STOP, not a condition of joining, privacy and SMS terms links), shown only when a mobile number is given; consent version recorded with the member | join step 2 | TCPA, CTIA (06 §7.2); real number needs 10DLC/Campaign Verify, which needs a registered committee |
| Minors | Neutral age question; under 14 stores nothing; under 18 → random refCode, no name in links, "show my name" off, guardian notes on after-dark events and clips with minors | join, RSVP, post | COPPA practice (06 §7.4), `docs/legal/MINORS_POLICY.md` |
| Uploads | Three unchecked consents, minors question, moderation promise, report button, clip rules page | post, clips | `docs/legal/MODERATION_POLICY.md` |
| Privacy | `privacy.html` draft with SMS terms; Forget me on this device; plain privacy promise beside every form ("We never sell your info") | legal pages, forms | 06 §7.5 |
| Nothing of value for voting | No prizes, perks, stickers or points for registering, renewing a mail-ballot request, making a voting plan or voting; physical perks only for organizing actions and never tied to a friend registering or voting | sticker book, vote hub | 52 U.S.C. 10307(c) bars paying or offering to pay for registering or voting in federal elections; Fla. Stat. 104.061 bars giving anything of value to influence a vote (with narrow exceptions). Medium confidence on scope; counsel confirms before launch |
| Registration drives and petitions | None on the site; no "collect signatures" calls to action | events data | F.S. 97.0575 (third-party registration orgs), HB 1205 (2025) petition rules (report 01 §3b) |
| Near polling places | No "hand out water/snacks at the polls" content | copy | F.S. 102.031(4) (150-ft rule; noted in `data/newsletter.js`) |
| Photos | Stock tag, alt text, footer line; recognizable stock faces replaced with consented member photos before launch | all | Unsplash Terms §5 (recognizable people not covered by the license), checked Nov 9, 2026 |
| Money asks | Never on TikTok; never near serious content; never pre-checked recurring; ActBlue links only from config | all | launch kit rule 6; report 07 §8 |

---

## 9. Verified facts to use, and claims to avoid

Re-check every date-bound fact before each review pass. **Recheck dates:** Mon, Nov 16, 2026 (county
certification: update "unofficial" labels and the Nov 3 figures); Tue, Dec 15, 2026 (how the SOE treats
mail-ballot requests made Nov 4 to Dec 31); Jan 1, 2027 (ID rules in effect; status of the lawsuit).

| Fact | Say it like | Source | Checked | Conf. |
|---|---|---|---|---|
| Membership ages | "ages 14 to 39" / "under 40" | [YDSC dues page](https://secure.actblue.com/donate/ydscdues) | Nov 9, 2026 | high |
| Dues and tiers | $20 a year, due in January; non-voting membership for anyone who qualifies but can't pay (money or citizenship status) | same | Nov 9, 2026 | high |
| Voting-member residency | Voting members live in Seminole County or go to school here (the dues page says resident or domiciliary, or a student at an accredited school in the county). **Attach this only to voting membership, never to events or to joining free.** The judges killed B's version because it was unsourced; it is now sourced. | same | Nov 9, 2026 | high |
| Democratic principles | Members stand by the Democratic Party's principles; the page does not mention how you're registered | same; `data/strings.js` `join.noRegistration` | Nov 9, 2026 | high |
| Mail-ballot requests | The required shape (line 23). A request runs through the end of the calendar year of the next regularly scheduled general election. | [F.S. 101.62(1)(a)](https://www.flsenate.gov/Laws/Statutes/2025/101.62); [DOS vote-by-mail](https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/) | Nov 9, 2026 | high (rule); med (how Seminole treats Nov 4 to Dec 31 requests) |
| Countdown | 52 days on Mon, Nov 9 until pre–Nov 3 requests end on Dec 31, 2026 | computed | Nov 9, 2026 | high |
| Student IDs | Required wording from report 00: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court)…" | [HB 991 summary](https://flsenate.gov/Committees/BillSummaries/2026/html/991); [complaint, Oct 16, 2026](https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf) | Nov 9, 2026 | high |
| Citizenship checks | From Jan 1, 2027, Florida checks citizenship for new registrations and updates; register early on the official site | HB 991 (above); `data/strings.js` `nudge.citizenship` | Nov 9, 2026 | high |
| Pre-registration | Florida lets you pre-register at 16 and vote at 18 | [F.S. 97.041](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html) | Nov 9, 2026 | high |
| Registration deadline | Registration closes 29 days before every Florida election | [DOS register](https://dos.fl.gov/elections/for-voters/voter-registration/register-to-vote-or-update-your-information/) (report 05 §10) | Nov 9, 2026 | high |
| SOE contact | Seminole County Supervisor of Elections, 407-585-8683, Mon to Fri, 8 am to 5 pm | [voteseminole.gov](https://voteseminole.gov/); `data/civic.js` | Nov 9, 2026 | high |
| Nov 3 result, Seminole | "Seminole picked the Democrat for governor, about 54% to 44.5% (unofficial until the county certifies, due Nov 16)." No candidate names. | [Florida Phoenix, Nov 3, 2026](https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/); [WFTV county results](https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/) | Nov 9, 2026 | high (unofficial) |
| Nov 3 result, statewide | "Statewide, the Republican won by about a point" (about 50.0% to 48.7%, AP) | same | Nov 9, 2026 | high (unofficial) |
| Certification date | Official returns due noon, Mon, Nov 16, 2026 | [F.S. 102.112](https://www.flsenate.gov/Laws/Statutes/2025/102.112) | Nov 9, 2026 | high |
| Youth turnout, national | "About 27%, an early CIRCLE estimate, the second-highest midterm rate in 30 years"; young voters favored Democrats for the House by about 35 points (estimate) | [CIRCLE 2026 hub](https://circle.tufts.edu/2026-election); [Axios, Nov 5, 2026](https://www.axios.com/2026/11/05/gen-z-voters-2026-midterms-democrats-house) | Nov 9, 2026 | med (early estimates) |
| Young voters in Seminole | "More than 1 in 3 Seminole voters are 18 to 40 (the county's own age band)": 124,626 of 338,692 active voters | [SOE District Demographic Analysis, Jul 1, 2026](https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf) | Nov 9, 2026 | high |
| NPA bloc | "The biggest group of them isn't registered with any party: 34.3%" (Dem 32.7%, Rep 27.4%). Never "most young voters are independents." | same | Nov 9, 2026 | high |
| Hispanic share | Seminole is about 25% Hispanic or Latino (25.4%, ACS 2024); 23.1% speak a language other than English at home | [Census Reporter](https://censusreporter.org/profiles/05000US12117-seminole-county-fl/); [FL EDR profile](https://edr.state.fl.us/Content/area-profiles/county/seminole.pdf) | Nov 9, 2026 | high / med |
| Amendment 4 (2024) | 60.37% yes in Seminole (computed), short of 60% statewide (57.17%) | [SOE 2024 precinct summary](https://voteseminole.gov/wp-content/uploads/2026/06/2024GeneralElection-Official-PrecinctSummary-Groups-Redacted-Public.pdf) | Nov 9, 2026 | high (computed) |
| Seminole schools book removals | "In fall 2023, Seminole County Public Schools pulled more than 30 books, most of them because other Central Florida districts had objected to them, not local parents (CFPublic, Oct 11, 2023)." Always date it to 2023; titles included *Looking for Alaska* and *Thirteen Reasons Why*. | [CFPublic (Central Florida Public Media), Oct 11, 2023](https://www.cfpublic.org/education/2023-10-11/seminole-county-bans-books-challenged-in-other-school-districts) (URL re-opened Nov 9, 2026: "has banned over 30 books so far this school year") | Nov 9, 2026 | high (as reported in 2023) |
| Minimum wage | Florida's minimum wage reached $15 an hour on Sep 30, 2026 | [Fla. Const. Art. X §24](https://www.flsenate.gov/Laws/Constitution) | Nov 9, 2026 | high |
| SunRail | Four Seminole stations: Altamonte Springs, Longwood, Lake Mary, Sanford; weekday service | [SunRail stations](https://sunrail.com/stations/) | Nov 9, 2026 | high |
| Upcoming elections | Nov 2, 2027 city elections (Oviedo confirmed; Lake Mary and Altamonte Springs "expected"); Mar 21, 2028 PPP; Aug 22, 2028 primary; Nov 7, 2028 general | `data/civic.js` `dates` (with sources) | Nov 9, 2026 | high / med ("expected") |
| SemDems events (REAL) | Monthly meeting, second Thursday, 7 to 9 pm (next Thu, Nov 12, 2026, Altamonte Springs); holiday party Fri, Dec 11, 2026, 6 to 9 pm | [Florida Democrats events: SemDems](https://events.floridadems.org/org/seminole-county-democrats) (report 01 §1a) | Nov 9, 2026 | high; recheck before showing |
| Local texture | Sanford the Celery City; Lake Jesup gators; The Senator and the Phoenix at Big Tree Park; Oviedo's chickens as folklore; the Wekiva (Wekiwa Springs State Park is in Orange County) | report 01 §7 | Nov 9, 2026 | med |
| Unsplash license | Free use, no attribution required; the Terms (§5) exclude recognizable people's images and trademarks from the license | [Unsplash License](https://unsplash.com/license); [Unsplash Terms](https://unsplash.com/terms) | Nov 9, 2026 | high |

**Claims to avoid**

- "40 and under"; any membership rule beyond the dues page; "official site of" anything.
- "Every Florida mail-ballot request expires Dec 31" (too broad; Concept A used it); "Dec 31 is the deadline to renew"; "you can't renew before Jan 1".
- A list of accepted voter IDs written from memory (link the SOE instead).
- Candidate names or faces anywhere; any politician as a guest, host or endorser.
- "Most young voters are independents" (largest group, not a majority); "Seminole is blue" as a settled fact (results are unofficial; Trump won Seminole 50.9% to 47.4% in 2024).
- Local rent, insurance or heat numbers (not yet sourced); the Puerto Rican share (not verified); book-removal numbers beyond the CFPublic report above, or that report's 2023 count presented as current.
- Youth-turnout figures as final (they are early estimates); "youthquake".
- "Join the chat" or anything implying a chat exists; promises of a receipts page, rides or ASL unless the chapter confirms they're offered (event copy says "tell us and we'll do our best").
- Wekiwa Springs as "in Seminole"; Oviedo's chickens as a present-day fact.
- Social handles as live links; youngsemdems.com as a working site.
- Any demo number, person, quote, event or clip without the DEMO label.

---

## 10. Build plan

### 10.1 Phases

| Phase | What | Gate to move on |
|---|---|---|
| 0 | **F0 Foundation** (one builder; blocks everyone) | `styleguide.html` passes §10.4 F0 tests; tokens, partials, `ui.js`, fonts and `data/slices/core.js` merged |
| 1 | **W1 to W8 in parallel**, exclusive file ownership | each workstream's acceptance tests pass on its own pages |
| 2 | **Integration** (lead): run every generator, sync, full test suite, cross-page flows | §10.5 integration tests pass |
| 3 | **Review loop** vs the §6b bar until every GATE passes and the score is 60+ on home, events, vote, join | no blocking findings |

### 10.2 The shared foundation (F0), which must exist first

**Start from Concept A's code** (`/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/concepts/A/`:
`index.html`, `a.css`, `a.js`) and refactor it into the token and component system; copy the three
concepts' source and rationales (not the large screenshots) into `docs/concepts/` for reference. B's
golden-hour CSS (`concepts/B/index.html`, `.photo::before/::after`, `.ev-art`) and C's fallback
`@font-face` block (`concepts/C/c.css` lines 10 to 12) are the graft sources.

F0 delivers:
1. `assets/css/tokens.css` (§3.2 to §3.5, light and dark, card aliases), `base.css` (reset, typography, focus, skip link, forms, reduced motion), `components.css` (every §3.8 component F0 owns, plus static styles for `.invite`, `.ticket`, `.pin`, `.story`, `.sheet`, `.tier`, `.stat` so feature owners only add behaviour), `utilities.css`.
2. Fonts: `tools/fetch_fonts.py` downloads the three WOFF2 files named in §3.3 from the Google Fonts CSS API into `assets/fonts/` and records their URLs and licenses; `@font-face` rules with measured fallbacks.
3. `assets/boot.js` (theme before paint) and `assets/js/ui.js` (§7.7).
4. Partials (§7.4), EN and ES, with the demo banner, header (ES folds into the menu under 360 px), footer legal block (§4.0) and status region.
5. `data/stickers.js` (A's seven stickers plus `cypress`, `calendar`, `camera`, each with a sourced fact) and the word-sticker set.
6. `data/strings.js` updates: `cta.join` → "Join free" / "Únete gratis"; `cta.findEra` → "Find your type" / "Descubre tu modo"; new `cta.imIn` "I'm in" / "Me apunto"; `cta.seeWhatsOn` "See what's on" / "Mira qué hay"; anything else in §2.7 that is a shared string. Then `tools/slice_data.js` and `data/slices/core.js`.
7. Icons (`favicon.svg` from the YD bubble mark; PNGs rendered with Playwright), `assets/img/og/default.png` (+ es), `offline.html`, `styleguide.html`, `docs/TEMPLATE.html` (the §7.4 skeleton).

### 10.3 Workstreams and exclusive file ownership

No two workstreams write the same file. Infra files (§7.1, marked INFRA) belong to no workstream.
After F0 merges, the **lead** owns `data/strings.js`, `data/stickers.js`, the partials and the four core
CSS files; a workstream that needs a shared change asks the lead, and meanwhile styles it in its own
page CSS with an `x-` prefix. Generated files are owned by the owner of their source page: `es/<page>`
by the page's owner (written only by `tools/make_es.js`), `assets/img/og/<page>*.png` by the page's
owner (written only by `tools/make_og.js`).

| WS | Name | Files owned (exclusive) |
|---|---|---|
| F0 | Foundation | `assets/css/tokens.css`, `base.css`, `components.css`, `utilities.css`; `assets/fonts/**`; `assets/boot.js`; `assets/js/ui.js`; `assets/icons/**`; `assets/img/og/default.png`, `assets/img/og/es/default.png`; `partials/head.html`, `demo-banner.html`, `demo-banner-es.html`, `header.html`, `header-es.html`, `footer.html`, `footer-es.html`, `scripts.html`; `data/strings.js`, `data/stickers.js`, `data/slices/core.js`; `tools/fetch_fonts.py`, `tools/slice_data.js`; `styleguide.html`, `offline.html`, `es/offline.html`; `docs/TEMPLATE.html`, `docs/concepts/**` |
| W1 | Home | `index.html`, `es/index.html`; `assets/css/pages/home.css`; `assets/js/pages/home.js`; `data/pages/home.js`; `data/slices/home.js`; `assets/img/og/home.png`, `assets/img/og/es/home.png` |
| W2 | Events, RSVP and invites | `events.html`, `es/events.html`, `events/*.html`, `es/events/*.html`; `assets/css/rsvp.css`, `assets/css/pages/events.css`; `assets/js/rsvp.js`, `assets/js/eventcard.js`, `assets/js/pages/events.js`, `assets/js/pages/event.js`; `tools/make_event_pages.js`; `data/events.js`, `data/pages/events.js`; `assets/img/og/events.png`, `assets/img/og/events/**` (+ `og/es/` twins) |
| W3 | Vote hub and issues | `vote.html`, `issues.html`, `es/vote.html`, `es/issues.html`; `assets/css/pages/vote.css`, `issues.css`; `assets/js/pages/vote.js`, `issues.js`; `data/civic.js`, `data/issues.js`, `data/pages/vote.js`, `data/pages/issues.js`; `assets/img/og/vote.png`, `issues.png` (+ es) |
| W4 | Video: Reel and posting | `clips.html`, `post.html`, `es/clips.html`, `es/post.html`; `assets/css/pages/clips.css`; `assets/js/reel.js`, `assets/js/pages/clips.js`, `assets/js/pages/post.js`; `data/pages/clips.js`; `assets/img/og/clips.png`, `post.png` (+ es) |
| W5 | Growth: maker, cards, quiz, stickers, member card | `quiz.html`, `es/quiz.html`, `quiz/**`, `es/quiz/**`; `assets/css/maker.css`, `assets/css/pages/quiz.css`; `assets/js/cards-brand.js`, `assets/js/maker.js`, `assets/js/membercard.js`, `assets/js/pages/quiz.js`; `tools/make_quiz_pages.js`; `data/quiz.js`, `data/levels.js`, `data/sharekit.js`, `data/pages/quiz.js`; `assets/img/og/quiz.png`, `assets/img/og/quiz/**` (+ es) |
| W6 | Join and newsletter | `join.html`, `newsletter.html`, `es/join.html`, `es/newsletter.html`; `assets/css/pages/join.css`, `newsletter.css`; `assets/js/joinform.js`, `assets/js/pages/join.js`, `assets/js/pages/newsletter.js`; `data/newsletter.js`, `data/pages/join.js`, `data/pages/newsletter.js`; `assets/img/og/join.png`, `newsletter.png` (+ es) |
| W7 | About, legal and 404 | `about.html`, `privacy.html`, `accessibility.html`, `teen-safety.html`, `content-policy.html`, `conduct.html`, `404.html` and their `es/` twins; `assets/css/pages/about.css`, `legal.css`; `assets/js/pages/about.js`, `legal.js`; `data/team.js`, `data/legal.js`, `data/pages/about.js`, `data/pages/legal.js`; their OG images (+ es) |
| W8 | QA, i18n and launch tooling | `tools/make_es.js`, `tools/make_og.js`, `tools/og.html`, `tools/qa.js`, `tools/voice_lint.js`, `tools/voice_rules.json`; `assets/js/cards-og.js`; `docs/QA.md`; `tests/site/**` |

**Workstream summaries**

- **W1 Home:** compose §4.1 from the F0 system and the W2/W4/W5/W6 components; the kinetic hero, pinned strip with countdown, ticker, debrief band, scoreboard; generate `data/slices/home.js`. Build with contract markup first; integrate modules as they land.
- **W2 Events, RSVP and invites:** `eventcard.js` and `rsvp.js` (the shared RSVP state, sheet, calendar, invite landing), the events list with filters, the January drop, REAL partner events, the event page generator (EN and ES), the trivia rename and photo picks in `data/events.js`.
- **W3 Vote and issues:** the 2027 Ready hub from `data/civic.js` (steps, dates, plan, private checklist, January 4 reminder), and the issues page from `data/issues.js`.
- **W4 Video:** `reel.js` (home strip and feed cards), the feed page on `YSD.feed`, the post flow on `YSD.clips`, transcripts, action chips, report, the pending card.
- **W5 Growth:** brand card templates in both sizes, the maker UI, the quiz page and its static result pages, the member card, sticker book and streak (re-skinning `data/levels.js`), Seminole Rewind, the squad meter. Data edits: in `data/quiz.js` rename `organizerEra` to "How do you show up?" (title, cta, slug `show-up`; the internal key may stay); in `data/sharekit.js` change "I set a Jan 1 reminder" lines to "I set a reminder for January" so they match the Jan 4, 10 am .ics (online renewal from Jan 1 stays true); in `data/levels.js` mark civic actions as non-collectible and drop XP from anything rendered.
- **W6 Join and newsletter:** `joinform.js` (validation, age screen, step two, SMS consent), the three tiers, the member-card hand-off, the chip-in line, the Thursday Letter sample issue.
- **W7 About, legal and 404:** about with What's real, team placeholders and city crews; the five policy pages from `data/legal.js` (adding `conduct`), Forget me, the 404 toy.
- **W8 QA, i18n and launch tooling:** `make_es.js`, `make_og.js` + `cards-og.js`, `qa.js` (every measurable §6b check), `voice_lint.js`, site tests. **Land `make_es.js`, `make_og.js` and `qa.js` first** (within the first part of phase 1) so page owners can run them.

### 10.4 Acceptance tests per workstream

Every workstream also passes, on its own pages: `python3 tools/sync_partials.py --check`;
`node tools/check_site.js --pages <its pages>` with 0 errors; `node tools/qa.js --pages <its pages>`
with every GATE passing; `node tools/voice_lint.js <its files>` with 0 errors; `node tools/make_es.js
--check <its pages>` with 0 untranslated strings; no console errors from `file://` or `python3 -m
http.server`; `npm test` still green (infra untouched).

| WS | Specific tests |
|---|---|
| F0 | `styleguide.html` renders every §3.8 component in light and dark at 320, 390 and 1440 with 0 axe serious/critical issues and no overflow; all §3.2 pairs re-computed by a script match the table; fonts: 2 preloaded files at most 80 KB together, CLS at most 0.05 with the fallbacks (font loading delayed 3 s in Playwright); theme toggle cycles Auto/Light/Dark with no flash on reload; Pause motion stops the ticker and rotor and persists; `prettyLink` strips protocol, `index.html` and utm but keeps `ref`; the header fits at 320 px (ES in the menu); `data/slices/core.js` regenerates byte-identical with `--rerun` |
| W1 | §4.1 acceptance list; page height at most 9,500 px at 390; RSVP shared-state flow across 3 surfaces; maker requires a first name; `?ref&from&e` landing; home loads no full data file over 30 KB; Lighthouse mobile perf 95+ and LCP at most 2.5 s on 4G throttle |
| W2 | `make_event_pages.js` is idempotent and writes 11 EN + 11 ES pages with valid OG tags; `.ics` UTC times correct for every event; sheet validation and focus (into the name field, Escape closes, focus returns); counts rise only after submit; waitlist on a full event; past events hidden; the drop hides Jan 2027 events until Tue, Dec 15, 2026, 12 pm ET (Playwright clock) and `?drop=open` shows them; REAL partner events link out and hide after their dates; no file still says "how Seminole are you" |
| W3 | Every `issues.anchors` hash exists; every vote link resolves from `links.vote.*`; reminder .ics is `DTSTART;TZID=America/New_York:20270104T100000`; the mail-ballot card copy matches the required shape exactly; checklist stores nothing outside the browser and shows no points; serious template on student-ID and serious issues (no sticker, emoji or confetti inside) |
| W4 | §6 acceptance list; keyboard-only post flow; pending card persists across reload; no autoplay under reduced motion (Playwright `reducedMotion: 'reduce'`); link validation messages for wrong host and empty field; 0 rendered view or like numbers in demo |
| W5 | Cards render at 1080 x 1350 and 1080 x 1920 for every template with the link, DEMO mark and paid-for line visible (pixel check on the PNG); no ref before joining; PNGs at most 1.2 MB; quiz scoring equals the reference scorer on 20 random runs; 15 static result pages (EN + ES) with OG tags; no "era", "XP" or level names rendered; squad meter ignores simulated members; Rewind hidden before Dec 17, 2026, 7 am unless `?preview=rewind` |
| W6 | At most 3 required fields; validation copy and `aria-invalid`/`aria-describedby`; under-14 stores nothing; under-18 gets a random code; ref lands in the join payload; static `<form name="join">` present; SMS box unchecked and only shown with a mobile number; letter has 0 emoji and at most 1 "!" |
| W7 | Every footer link resolves (no "(coming)"); Forget me clears member, `rsvp:*`, `maker:*`, `quiz:*`, `stickers` and local clips; legal pages show DRAFT notices and stable section ids (`#privacy-sms`); 404 works from `events/` depth when served by `check_site.js`; no real officer names |
| W8 | `qa.js` catches each seeded defect in a fixture (11 px text, 40 px target, 335 px overflow at 320, text on a gradient below 4.5:1, a running animation under reduced motion, an unlabeled demo count, a share link containing `localhost` when `site.url` is set, a request to a non-allowlisted host); `make_es.js --check` fails on a fixture with one untranslated node; `make_og.js` writes 1200 x 630 PNGs under 150 KB; `voice_lint.js` flags every banned term in a fixture and passes `data/*.js` after owners fix their copy |

### 10.5 Integration tests (lead, phase 2)

1. Run the §7.11 step 1 pipeline from a clean checkout; `git status` shows only expected generated changes; a second run changes nothing.
2. `npm run preflight`, `node tools/qa.js --all` (320, 390, 1440; light and dark), `node tools/voice_lint.js`, `npm test`.
3. Cross-page flows in Playwright: invite link → event page landing → RSVP → join with the same ref → member card shows the sticker and the squad meter counts the join in a second browser context with the first sender's link; quiz → result card → share fallback copies a link with ref; post a clip → pending card → Forget me removes it.
4. `npm run shoot` contact sheets reviewed; `npm run bench -- --throttle 4g` home and events vs the `right` and `brands` groups.
5. Score home, events, vote, join, quiz and clips on the §6b bar; file findings back to the owning workstream.

### 10.6 Open items outside the workstreams

- **Infra owner:** the §7.2 config hand-offs; swap the banned photo in the `demo-sunrail-rally` clip.
- **Chapter (via Kira):** sign-off; committee status and the paid-for wording; real events, people and photos with consent; social handles; who controls youngsemdems.com; a clip moderator and response time; whether to publish money receipts; native Spanish review.
- **SOE (407-585-8683), by Tue, Dec 15, 2026:** whether requests made Nov 4 to Dec 31, 2026 count for 2027 to 2028; if yes, flip `sharekit.confirmed['soe-2027-requests-open']` and the copy to "renew now".
- **After Mon, Nov 16, 2026:** certified results; update the debrief band, scoreboard and "unofficial" labels.
