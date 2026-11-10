# Round 1: lead triage and fix plan

The lead wrote this on Tue, Nov 10, 2026. Inputs: `genz-brand.md`, `right-wing.md` and `journeys.md`, plus all 73 findings in `findings.json` (4 blocking, 49 major, 20 minor). The copy/facts and craft/accessibility reviewers were stopped. They will review the fixed site in round 2 instead of today's state.

**Already fixed by the lead:**
- `journeys-01`: clip moderation fields.
- `journeys-03`: DEMO tag on the invite banner.
- `right-wing-porch-home`: the porch is now a park pavilion.
- `journeys-17`: the mail voter's calendar title.

Fixers: verify that these still hold. Don't redo them.

**Decision: every finding gets fixed.** Nothing in round 1 is waived. Where a finding asks for new content, build it as DEMO content within the brief's rules. That covers the host kit, merch drop, identity crews, crew map, named series and named video formats.

## Non-negotiables (unchanged)
- BRIEF §0 and ruling 00 apply.
- No AI features.
- DEMO labels in both languages.
- No Native imagery, no candidate names, no alcohol in photos.
- Nothing of value for civic steps. Merch and rewards attach only to organizing: volunteering, hosting, bringing friends to events.
- Mobile first at 390. Must work at 320. Text at least 12 px, tap targets at least 44 px, WCAG 2.2 AA in light and dark, reduced motion respected.
- Static and portable. Works from file://.
- Spanish twins only via `tools/make_es.js`. OG images only via `tools/make_og.js`.

## Colour worlds (genz-brand-01)

Each page gets its own colour world AND its own hero object and silhouette. Don't just swap the fill.

| Page | World | Hero object |
|---|---|---|
| Home | violet (unchanged, §0.5) | the invite and the people photo, bigger (see Home) |
| Events list | celery | the stack of date tickets, with the tentpole night featured |
| Event pages | per-event colours (unchanged) | the invite art, shown first on phones |
| Host kit (new `host.html`) | tangerine | an open "chapter in a box" |
| Vote | lake | the Dec 31 / Jan 1 deadline tiles, shareable |
| Issues | night (unchanged) | the big-number bento |
| Reel (`clips.html`) | night | video first, no hero block |
| Post | sun | a phone-frame preview of your clip |
| Quiz | bubblegum | the type deck |
| Join | sky | the live member card |
| Newsletter | mint | the 7:00 lock screen (keep) |
| About | teal | the Real-or-DEMO game and the crew map |
| 404 | orange | the laptop toy (keep) |
| Legal pages | cream (calm) | none |

G-CORE adds the missing `.section--lake/sun/mint/teal/orange/tangerine` variants, with text colours that pass AA in both themes, plus any shared hero layout helpers. Pages adopt them. Until G-CORE lands, wave-1 pages use page-scoped `x-` styles with the same tokens.

## Groups, waves and exclusive files

**Wave 1** (runs first; provides APIs to wave 2): G-CORE, G-GROWTH, G-VIDEO, G-VOTE.
**Wave 2**: G-HOME, G-EVENTS, G-JOIN, G-ABOUT.

A group edits only its own files. Need something from another group? Use the contracts below, or list it under "Lead requests".

### G-CORE (shared system and tooling)

**Files:**
- `assets/css/tokens.css`, `base.css`, `components.css`, `utilities.css`
- `assets/js/ui.js`, `assets/boot.js`, `assets/js/share.js`, `assets/js/members.js`, `assets/js/cards.js`, `assets/js/store.js`, `assets/js/config.js`
- `partials/*`, `data/strings.js`, `data/stickers.js`, `data/slices/core.js`
- `assets/icons/*`, `assets/img/brand/**`, `manifest.webmanifest`
- `styleguide.html`, `assets/css/pages/styleguide.css`, `assets/js/pages/styleguide.js`
- `tools/*`, except `make_event_pages.js`, `make_quiz_pages.js`, `make_og.js` and the video tool
- `tests/**`, `docs/BUILDERS.md`, `docs/infra/*`

**Findings:**
- `genz-brand-01`: the section variants and helpers.
- `genz-brand-20`: an ownable brand mark.
  - Explore at least 3 SVG marks built on the "Saved Seat" idea: a seat/chair in a speech bubble, a ticket stub with YD, or a celery-stalk Y.
  - Pick the strongest. Apply it to the header/footer partials, the favicon, the PNG icons, the manifest and the default OG images.
  - It must read at 16 px, work in one colour, and contain no Native or flag imagery.
- `journeys-04`: the language toggle keeps the query (minus ref/utm) and the hash, recomputed on click.
- `journeys-14`: toasts get a priority option, so "Link copied" is never replaced by a sticker toast. Queue them.
- `journeys-19`: in-page jump links move focus to their target.
- `genz-brand-08`, core part: confetti and toasts render above an open `<dialog>`. Use the top layer, or mount inside the open dialog.
- `genz-brand-10`, core part: a sticker unlock reveal component, `YSD.ui.reveal({sticker, title, body, actions})`.
  - A centred collectible moment, sized to the sticker art.
  - Dismissible, focus-managed, and calm under reduced motion.
- `journeys-06`, core part: `YSD.members.reset()` archives the current member into `joins` (squad history is kept) instead of `forget()`. It also clears the member's own ref so the next join isn't credited to the old arrival ref. Document and test it.
- `journeys-08`: `YSD.share.url()` adds `from=<FirstName>` automatically when the current member is 18 or older and has a first name. Never for minors. Test it.
- `journeys-18`, general part: a generic "who sent this" landing, `YSD.ui.landing()`.
  - Runs on any page that has `?ref` or `?from` and doesn't set `data-landing="custom"` on `<body>`.
  - A slim dismissible banner: "Kira sent you this · Join free" (ES: "Kira te mandó esto").
  - Event pages keep rsvp.js's own landing.
- `right-wing-sticker-art`: draw new sticker art so the sticker book has 15 distinct pieces.
  - County-sourced subjects: Oviedo chickens, SunRail, Wekiva springs, cypress, manatee, celery, gator, lake, sun, sky lantern, library card, ballot envelope (no flag), bike, palm, megaphone.
  - Each needs a sourced fact in `data/stickers.js`, EN and ES.
- `right-wing-bench-artifacts`: fix `bench_compare.js` so CLS, weight and share are measured fairly.
- `journeys-26`: `check_site.js`'s server serves `es/404.html` for missing `/es/*` paths.
- Also:
  - Put `seo.home.title` in brand-first form: "Young Democrats of Seminole County · Local politics is a group project".
  - `.kinetic__hi::after` follow-up.
  - Make the footer more compact on phones (two columns of links, smaller legal block, same content).

### G-GROWTH (quiz, maker, cards, member card, characters)

**Files:**
- `quiz.html`, `es/quiz.html`, `quiz/**`, `es/quiz/**`
- `assets/css/pages/quiz.css`, `assets/css/maker.css`
- `assets/js/cards-brand.js`, `assets/js/maker.js`, `assets/js/membercard.js`, `assets/js/pages/quiz.js`, `assets/js/cards-og.js`
- `tools/make_quiz_pages.js`, `tools/make_og.js`
- `data/quiz.js`, `data/levels.js`, `data/sharekit.js`, `data/pages/quiz.js`
- `data/slices/quiz.js`, `data/slices/growth.js`
- `assets/img/characters/**` (new), `assets/img/og/**` (regenerate via make_og)

**Findings:**
- `genz-brand-02`, characters:
  - An illustrated character set in the sticker style, one per show-up type (6), plus one per issue identity.
  - Diverse and fun. No real people, no Native imagery, no candidate likeness.
  - SVG, optimised.
  - Used on quiz result screens, result pages, share cards and OG images. Also available to Join and About at `assets/img/characters/`.
- `genz-brand-11`: richer question screens; hide the cut-off stickers while playing.
- `genz-brand-12`: poster-grade share cards. The character goes big, with type at Wrapped scale.
- `genz-brand-13` and `journeys-23`: static result pages read `?from` and say "Kira got The Hype Captain. What are you?". Their share button shares the quiz with my ref and from, not the static page.
- `genz-brand-14`: issue results become identities with a name per issue (e.g. "The Rent Realist", "The Shade Seeker"; your own better ones, EN and ES).
- `genz-brand-15`: OG images never cut a subline, and each result gets its own character art.
- `journeys-05` and `right-wing-quiz-deadends`, quiz side:
  - Render only series chips with a visible event. Otherwise fall back to `?kind=`.
  - For drop-only series, show "In January's lineup · drops Tue, Dec 15 at noon (DEMO) · Notify me".
- `journeys-07`: the member card gets Copy link and Share buttons, and the visually hidden label is fixed.
- `journeys-08`, `journeys-14`, `journeys-22`, maker and membercard parts:
  - Use `YSD.share.url()`, which carries `from`.
  - "Link copied" feedback uses the priority toast.
  - Copy link copies only the link.
- `journeys-16`: `quiz.html#show-up` and `#issue` start that quiz.
- `genz-brand-10`, usage: sticker unlocks use `YSD.ui.reveal` (G-CORE). If it isn't there yet, guard with a toast fallback.
- `right-wing-rewards-hidden`: a public, pre-join "How stickers work" component (`YSD.membercard.rulesPanel(container)`) that Join and Home can mount. It shows the fair rules and the 15 stickers, locked.
- `right-wing-sticker-art`: `levels.js` uses the 15 distinct stickers.
- **New card templates for other groups** (contract; document in the `cards-brand.js` header):
  - `going`: an "I'm going" story card. Data: `{first, eventTitle, when, place, link, colorToken}`. Sizes 1080x1920 and 1080x1350.
  - `laptop`: the 404 decorated laptop. Data: `{stickers:[{id,x,y,r}], link}`. Sizes 1080x1350 and 1080x1080.
  - Both carry the link, the DEMO mark and the paid-for line.
- **Maker quick mode for Home** (contract): `YSD.maker.mountQuick(container, {templates:['invite','psa-mail','cover']})`.
  - A swipeable row of 3 ready-made cards, each at least 320 px wide (4:5), with one first-name field and one Send button.
  - "Customize" opens the full maker. Document it.
- Over-40 "Member card" label in the maker's template picker becomes "Supporter" for supporters.

### G-VIDEO (Reel, post, clips)

**Files:**
- `clips.html`, `post.html`, `es/clips.html`, `es/post.html`
- `assets/css/pages/clips.css`
- `assets/js/reel.js`, `assets/js/pages/clips.js`, `assets/js/pages/post.js`, `assets/js/clips.js`, `assets/js/feed.js`
- `data/pages/clips.js`, `data/slices/clips.js`, `data/clips.js`
- `assets/video/**`

**Findings:**
- `genz-brand-05` and `genz-brand-25`: video first on the Reel at every width. At 1440, the feed plus a side rail.
- `genz-brand-06`, `genz-brand-23`, the Spanish-poster known item: re-make the demo clips in a creator format.
  - Vertical, jump-cut rhythm. Native-looking caption chips drawn as HTML/VTT, NOT burned in, so Spanish works.
  - On-screen sticker overlays from the brand set. A face-forward photo crop or crowd shots. No dated slang.
  - Render clean videos and posters without burned-in titles.
  - Add WebVTT captions in EN and ES, shown by `reel.js` in a TikTok-style caption treatment, plus the transcript.
  - Keep each clip at 1.5 MB or less and each poster at 60 KB or less.
  - Keep `data/clips.js` facts, DEMO and credits accurate. Keep `tests/infra/video.test.js` passing; update it where the format changes on purpose.
- `genz-brand-07`: fewer labels per card. One DEMO tag, one action chip, the rest behind a "···" sheet.
- `genz-brand-19`: post shows a phone-frame preview of the chosen clip (or link), plus 3 example prompts or clips.
- `genz-brand-22`: posters never flash black; preload the next poster.
- `right-wing-shows`: named recurring formats as Reel series, e.g. "60 Seconds on Why", "Pop Quiz: Precinct Edition", "En Español", "Open Mic Night". Your own better names, EN and ES. Shown as series chips and badges.
- `right-wing-sunrail-saturday`: the SunRail clip's chip points at a weekday event or a non-train action. (SunRail runs weekdays only; check data.)
- `journeys-20`: the error summary names each box.
- `journeys-21`: "Post another" keeps the age and minors answers for non-members.
- Verify that `journeys-01` holds.

### G-VOTE (vote hub, issues)

**Files:**
- `vote.html`, `issues.html`, their es twins
- `assets/css/pages/vote.css`, `assets/css/pages/issues.css`
- `assets/js/pages/vote.js`, `assets/js/pages/issues.js`
- `data/civic.js`, `data/issues.js`, `data/pages/vote.js`, `data/pages/issues.js`
- `data/slices/vote.js`, `data/slices/issues.js`

**Findings:**
- `genz-brand-01`: lake world for vote.
- `genz-brand-17`: the Dec 31 / Jan 1 tiles get a share action that renders a card with `YSD.cards`. Shorten the page to 12 phone screens or fewer at 390: collapse the 8 steps, FAQ and sources into accessible disclosures, keep the anchors, and keep every required wording visible.
- `right-wing-npa-depth`: the independent voter's answer within the first 4 screens.
- `right-wing-teen-path`, vote part: an "Under 18?" block.
  - Pre-register at 16.
  - What 16 and 17 year olds can do now.
  - Florida's rule that you vote at 18; verify against official sources and cite them.
  - Teen-safe ways to help.
- `genz-brand-24`: the LGBTQ+ tile gets a real sourced number or a deliberate non-number design that doesn't look missing.
- Verify that `journeys-17` holds. Mail plan event wording must not invite a late ballot.

### G-HOME (wave 2)

**Files:** `index.html`, `es/index.html`, `assets/css/pages/home.css`, `assets/js/pages/home.js`, `data/pages/home.js`, `data/slices/home.js`.

**Findings:**
- `genz-brand-03`: first screen reads H1, the big chat-bubble rotor, then two buttons.
  - Add a hand-font "the fun kind" note by "group project".
  - The hero sub goes below the CTAs on phones.
  - Bring the people photo up to at least 40% of the hero art on phones (from-behind or crowd stock is fine, labelled).
- `genz-brand-04`: about 8 big moments, not 12. Use maker quick mode (G-GROWTH). Merge the scoreboard into the debrief band. The Letter becomes a strip.
- `right-wing-join-jump`: Join free lands on the form (scroll after lazy mount, or make the target stable).
- `right-wing-desktop-fold`: CTAs visible on 1280x720 and 1366x768.
- `right-wing-real-proof`: a "This chapter is real" strip with verified facts only (ruling 00 and report 02):
  - chartered with Florida Young Democrats
  - dues page on ActBlue
  - meets with the Seminole County Democrats
  - Link each source.
- `right-wing-merch`: a DEMO merch drop teaser (sticker sheet, tee, tote).
  - Earned by organizing (host, volunteer, bring 3 friends), never by civic steps.
  - "Notify me" downloads an .ics or stores locally.
- `right-wing-no-tentpole`: feature the tentpole series (G-EVENTS data).
- `right-wing-repeat-event`: the same event never repeats on home.
- `genz-brand-07`: home Reel strip clutter.
- Pause button overlapping the ticker (known item).
- Mount the public sticker rules (`YSD.membercard.rulesPanel`) or link to it.

### G-EVENTS (wave 2)

**Files:**
- `events.html`, `es/events.html`, `events/*.html`, `es/events/*.html`
- `host.html`, `es/host.html` (new)
- `assets/css/pages/events.css`, `assets/css/pages/host.css` (new), `assets/css/rsvp.css`
- `assets/js/rsvp.js`, `assets/js/eventcard.js`, `assets/js/pages/events.js`, `assets/js/pages/event.js`, `assets/js/pages/host.js` (new)
- `tools/make_event_pages.js`
- `data/events.js`, `data/pages/events.js`, `data/pages/host.js` (new), `data/slices/events.js`

**Findings:**
- `journeys-02` (blocking): the neutral age field in the RSVP sheet.
  - Use `legal.snippets.ageLabel` and `ageHint`. Skip it when `member.age` is known.
  - Under 14: show `ageTooYoung`, store nothing, send nothing.
  - 14 to 17: derive under18 and drop the checkbox.
  - Update BRIEF §5.4 accordingly. The lead allows this one BRIEF edit.
- `journeys-09`: the RSVP success state invites "Get your own invite link: join free (10 seconds)". It saves `{firstName, contact}` to store key `rsvp:last` for Join's prefill (G-JOIN reads it).
- `journeys-13`, contract for G-JOIN: export `YSD.rsvp.open(eventId)`, so join.html can open the RSVP for `?e=`.
- `journeys-15`: on event pages the invite banner doesn't repeat the title, date and button. It becomes a slim "Kira invited you" line.
- `journeys-24`: the .ics LOCATION doesn't repeat the city.
- `journeys-25`: the banner shows the place.
- `genz-brand-08`: a visible success moment. The sheet closes into a celebratory state on the page, or the sheet morphs into a ticket "You're in" with confetti above it.
- `genz-brand-09`: an "I'm going" story card at the peak, using the `going` template (G-GROWTH contract). Guard with `YSD.cards.has('going')`.
- `genz-brand-16`: fix the duotone mud (lighter grade, or photos only where the subject reads). On phones the invite art comes first, the RSVP right after.
- `genz-brand-27` and `right-wing-no-tentpole`: give series brand names in EN and ES, e.g. "Trivia Thursday: Seminole Edition", "Sunset Walk Club", "First-Timer Friday". Make at least one recurring tentpole with multiple dates, e.g. monthly "Seminole Saturday" or "Third Thursday". Keep the January drop rules.
- `right-wing-quiz-deadends` and `journeys-05`, events side: an empty filtered list shows the drop card plus Notify me, and fixes the "this week" copy.
- `right-wing-chapter-kit`: a new `host.html`, "Host a night (chapter in a box)".
  - What hosting means and the host rules (public place, alcohol-free, 14+).
  - A 3-week timeline and a checklist.
  - Downloadable share cards and a flyer, via `YSD.cards`.
  - Copy-paste invite texts (sharekit). A "we'll reply within 3 days (DEMO promise)" contact (link to `join.html?intent=host`).
  - Organizing rewards (merch eligible).
  - Add it to the header nav only if the core nav has room. Otherwise link it from events, about and home, and ask the lead to add it to the footer.
- `right-wing-teen-path`, events part: a "Good for under-18s" filter or tag, based on event data (guardian notes per the minors policy).
- Events list colour world: celery.

### G-JOIN (wave 2)

**Files:**
- `join.html`, `newsletter.html`, their es twins
- `assets/css/pages/join.css`, `assets/css/pages/newsletter.css`
- `assets/js/joinform.js`, `assets/js/pages/join.js`, `assets/js/pages/newsletter.js`
- `data/pages/join.js`, `data/newsletter.js`, `data/pages/newsletter.js`
- `data/slices/join.js`, `data/slices/newsletter.js`

**Findings:**
- `journeys-06`: "Not {name}? Start over" uses `YSD.members.reset()` (G-CORE). Make the squad meter honest and able to move: count joins credited to my code in this browser's `joins` log, and say so.
- `journeys-10`: prefill from `rsvp:last`.
- `journeys-11`: `#more` scrolls to step two and focuses it.
- `journeys-12`: the desktop success layout has no void, and the headline changes after joining.
- `journeys-13`: `join.html?e=<id>` shows the event and offers the RSVP via `YSD.rsvp.open`.
- `right-wing-intent-lost`: `?intent=host|crew|role|volunteer` preselects an "I want to…" option in step one or two and carries it in the payload. Add the option to the form.
- `right-wing-rewards-hidden`: mount the public sticker rules before joining.
- `right-wing-teen-path`, join part: an "Under 18? Here's how it works" block (guardian, no SMS, random code, pre-register at 16 link).
- `right-wing-identity-crews`, join part: step two adds identity crews (students, Latine/Boricua, LGBTQ+, young parents, shift workers, disability caucus, faith), from `data/pages/join.js`.
- `genz-brand-21`: the hero's secondary action isn't about money ("See what you get" or "Bring a friend").
- `genz-brand-26`: the letter gets rhythm: pull quote, picks as cards, the One Thing as a card.
- Colour worlds: join sky, newsletter mint.

### G-ABOUT (wave 2)

**Files:**
- `about.html`, `404.html`
- `privacy.html`, `accessibility.html`, `teen-safety.html`, `content-policy.html`, `conduct.html`
- es twins of all of the above
- `assets/css/pages/about.css`, `assets/css/pages/legal.css`
- `assets/js/pages/about.js`, `assets/js/pages/legal.js`
- `data/team.js`, `data/legal.js`, `data/pages/about.js`, `data/pages/legal.js`, `data/slices/about.js`

**Findings:**
- `genz-brand-18`: lead with the Real-or-DEMO game and the crews. Compress the disclaimers into one honest "What's real" card with a disclosure. Team cards become a compact "Open roles" grid.
- `right-wing-identity-crews`: identity crews alongside the city crews.
- `right-wing-crew-map`: an SVG crew map of Seminole County.
  - Approximate city positions are fine; label it a stylised map, not to scale.
  - Each crew is a dot that opens its card.
  - "Start this crew" links to `join.html?intent=crew&crew=<id>`.
  - No map tiles, no copyrighted base maps.
- `genz-brand-28`: the 404 laptop shares an image of your decorated laptop via the `laptop` card template (G-GROWTH contract). Guard with `YSD.cards.has('laptop')`.
- Verify that `right-wing-porch-home` holds.
- Colour worlds: about teal, 404 orange, legal cream.

## Every group, before reporting done
1. Fix every finding assigned to you, plus anything you find that breaks §0.
2. Regenerate es twins, OG images and slices as needed. Run `python3 tools/sync_partials.py` if partials changed.
3. Run these:
   - `node tools/qa.js --pages <your pages>`: every GATE passes, with scenarios.
   - `node tools/voice_lint.js <your files>`: 0 errors.
   - `node tools/make_es.js --check <your pages>`
   - `node tools/check_site.js --pages <your pages>`
   - `npm test`
   - No console errors on file:// or http.
4. Shoot your pages at 390 and 1440, light and dark. Look at them with Read next to the relevant benchmark screenshots in `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/bench/`. Iterate until it would win the comparison.
5. Report:
   - finding id → what changed (file list)
   - test summary lines
   - before/after page scores
   - contracts you exported
   - Lead requests
