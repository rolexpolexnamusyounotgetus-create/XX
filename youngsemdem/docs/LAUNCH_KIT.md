# Launch kit: "Dec 31, handled"

**Young Democrats of Seminole County (YDSC, "Young Dems").** This is the plan for everything that happens off the website, from launch through Thu, Dec 31, 2026, plus a three-day coda (Jan 1 to 3, 2027).

- **Status:** DRAFT for chapter sign-off. Prepared Mon, Nov 9, 2026.
- **Owner:** the chapter's comms lead (to be named).
- **Machine-usable parts** live in `data/sharekit.js` (key `sharekit`), in English and Spanish: 10 group-chat templates, 12 sticker phrases, 12 script hooks with CTAs and captions, the Bring Three challenge copy, and the link and UTM scheme. Pages render them as "copy this" buttons.
- **Facts.** Every fact used here has an ID like **[mail-expiry]**. Section 12 lists each one with its source and the date it was checked. The same facts, with Spanish claims, are in `data/sharekit.js` under `facts{}`. If a fact here ever disagrees with `data/civic.js`, civic.js wins.
- **Grounded in** `docs/research/` reports 00 (binding rulings), 02, 03, 04, 05 (voice, binding), 06, 07 and 08.

---

## Contents

0. [Read this first: eight rules](#0-read-this-first-eight-rules)
1. [The plan on one page](#1-the-plan-on-one-page)
2. [The 30-day calendar (Dec 2 to 31) and the coda](#2-the-30-day-calendar)
3. [Twelve short-video scripts](#3-twelve-short-video-scripts)
4. [Instagram launch carousel](#4-instagram-launch-carousel-10-slides)
5. [Bring Three: the referral challenge](#5-bring-three-the-referral-challenge)
6. [Ten group-chat templates](#6-ten-group-chat-templates)
7. [The sticker pack](#7-the-sticker-pack-12-stickers)
8. [Seminole Rewind: the December recap](#8-seminole-rewind-the-december-recap)
9. [Press and creator outreach](#9-press-and-creator-outreach)
10. [Measurement, refcodes and UTMs](#10-measurement-refcodes-and-utms)
11. [En español: the top items](#11-en-español-the-top-items)
12. [Facts and sources](#12-facts-and-sources)
13. [Open questions and what isn't verified](#13-open-questions-and-what-isnt-verified)

---

## 0. Read this first: eight rules

1. **Dec 31 is when old requests run out, not a deadline to renew.** Every Florida mail-ballot request made before the Nov 3 election ends Dec 31, 2026 **[mail-expiry]**.
   - Say "requests from before Nov 3," never "every request." Under the state rule, a request made after Nov 3 should already run through 2028.
   - Seminole hasn't said how it's handling requests made Nov 4 to Dec 31 **[mail-renew-jan1]**, so anyone who renews before Jan 1 should check My Voter Record in January.
   - So the December ask is **"set a Jan 1 reminder"** (or "renew in January"), and Jan 1 is **renew day**. Never say people *can't* renew before Jan 1.
   - If the elections office confirms before Dec 31 that Nov-Dec requests count for 2027-28, switch every reminder line to "renew now." The `after`, `variants` and `requires` fields in `data/sharekit.js` are built for that switch.
2. **One action per post.** Through Dec 31 the lead action is the Jan 1 reminder (`vote.html#renew-mail-ballot`). The second is the student-ID change, which uses the calm template and the required wording **[student-id]**.
3. **Invite, never scold.** No-party voters are the biggest group of Seminole voters aged 18 to 40, at about 34% **[npa-18-40]**. That's the biggest group, not a majority, so never write "most young voters are independents." Our events are open to anyone 14 and up, in any party or none **[events-open]**.
4. **DEMO stays visible.** Demo events, counts, people, the simulated squad and any demo Rewind numbers say "DEMO" wherever they appear, in posts too.
5. **Brand safety.**
   - No candidate names or faces, no politician presented as an endorser, and no real officers' names.
   - No real business shown as a host. Use public places (the Sanford Riverwalk, Central Winds Park) or generic venues ("a coworking space in Altamonte").
   - No Native American imagery or language: no feathers, patterns, "tribe," "warrior," "chief," "brave," "powwow" or "spirit animal." Visuals come from the county itself: Lake Monroe, the Riverwalk, celery, cypress, trains and Oviedo's chickens.
   - No school names, logos or uniforms in anything that shows a teen.
6. **Organic posts only.**
   - No paid boosts until counsel settles the chapter's committee status and the disclaimer wording. Free posts on free platforms from accounts that clearly name the chapter are exempt from Florida's ad disclaimer; paid ads are not **[fl-disclaimer-exempt]**.
   - Meta requires authorization and a verified "Paid for by" label on political or social-issue ads **[meta-siep]**.
   - On TikTok, never post a donation link, a dues link or a money ask, never run ads, and never pay a creator **[tiktok-gpppa] [tiktok-branded]**.
7. **Serious stays serious.** Calm posts (the student-ID change, any crisis) get no emoji, no exclamation marks, no trending sound, no jokes and no money ask nearby. Everywhere else, use at most one emoji per post, at the end, and at most one exclamation mark per screen (report 05, section 6).
8. **Two-person check.** Nothing posts until a second person has checked it for four things:
   - facts against section 12;
   - DEMO labels;
   - tone (report 05);
   - minors (`docs/legal/MINORS_POLICY.md`).

---

## 1. The plan on one page

### 1.1 What this campaign is for

Three outcomes by Dec 31, each one countable (section 10):

1. **People set the Jan 1 renewal reminder.** Count calendar adds on the renew step.
2. **People join through a friend.** Count joins with a referral code, and how long it takes a new member's first friend to join.
3. **The site gets shared in private chats.** Count share events by channel, and visits that arrive with a ref code.

There are no invented targets here. Week 1 sets the baseline, and weeks 2 to 4 try to beat it.

**Why it's shaped this way (report 04):**

- **Friends beat broadcast.** In a randomized study, a friend's text raised turnout among compliers by 8.3 points (with a wide margin of error), against well under 1 point for automated texts (B4).
- **Plans and reminders work.** Helping people make a concrete voting plan raised turnout 4.1 points (B5).
- **Sharing happens in group chats and DMs,** so what a link looks like in the chat is the product (B7).
- **Viral spikes fade,** so every week here has a reason to come back (A1).
- **Most people under 30 bump into political news** rather than look for it, so the content has to travel to them (B8).

### 1.2 The arcs

| Week | Dates | Arc | Lead CTA | utm_campaign |
|---|---|---|---|---|
| 1 | Wed, Dec 2 to Sun, Dec 6 | Hello, Seminole | home, `vote#renew-mail-ballot` | `2026-12-launch`, `2026-12-renew` |
| 2 | Mon, Dec 7 to Sun, Dec 13 | Bring Three, the quiz, Spanish-first | `join#bring-three` | `2026-12-bring3` |
| 3 | Mon, Dec 14 to Sun, Dec 20 | Seminole Rewind and the 2027-28 dates | `rewind.html` | `2026-12-rewind` |
| 4 | Mon, Dec 21 to Sun, Dec 27 | Family chats over the holidays | `join#texts` | `2026-12-renew` |
| 5 | Mon, Dec 28 to Thu, Dec 31 | The last four days | `vote#renew-mail-ballot` | `2026-12-renew` |
| Coda | Fri, Jan 1 to Sun, Jan 3 | Renew day, and the ID rule takes effect | `vote#renew-mail-ballot`, `vote#what-id` | `2027-01-renewday` |

### 1.3 Cadence and channels

- **Video (TikTok and Instagram Reels; YouTube Shorts optional).** Post the same vertical file to each, with native captions on each. About five new videos a week; Sundays reuse.
- **Stories (Instagram, plus Facebook if you use it).** Every day, 1 to 4 frames, always with one link sticker.
- **Text (X, Threads, Bluesky).** One post a day, the same words on all three.
  - Each post is 280 characters or fewer, counting the link as 23 characters, the way X counts any link.
  - Long UTM links can count differently on Bluesky (300-character limit) and Threads. If the composer says a post is too long, put the link in a link card instead of the text. Don't cut the UTMs.
  - Use Threads' room for the Rewind thread.
- **The Thursday Letter.** Thursdays at 7 am: Dec 3, 10, 17 (the Rewind edition), 24 (short or skipped: decide by Dec 17 and say so) and 31.
- **Posting times.** Start at 7 pm on weekdays and 11 am on weekends. These are starting guesses, not research findings: move them after week 1 based on your own analytics.
- **Spanish.**
  - Spanish-first videos go out on Day 10 and Day 19.
  - Every link sticker on a renew or student-ID post has an `es/` twin.
  - The family-chat template (gc03) works in either language and shows Spanish first on `es/` pages.
  - The Spanish is written, not translated (section 11).

### 1.4 Roles (a crew of 4 to 6 volunteers can run this)

| Role | Does | Notes |
|---|---|---|
| Comms lead | Schedules, does the final check, flips the serious-mode switch | One backup named |
| Fact checker | Second person on every post: section 12, DEMO labels, tone | Never the person who made the post |
| Filmers (2 to 3) | Shoot the section 3 scripts in their own voice | Film the first batch by Nov 30 |
| Spanish lead | Writes and reviews every Spanish line | A fluent human, not a translation tool |
| Moderators (2 adults) | Comments, DMs, Stories replies, reports | No one-on-one DMs between adult organizers and teens; use group threads with two adults (`MINORS_POLICY.md`) |
| Data lead | The Monday scorecard (section 10) | Needs analytics switched on |

### 1.5 The serious-mode switch

- **Triggers:** a hurricane, a local tragedy, a court order on HB 991, or anything that makes a cheerful post look careless.
- **What happens:**
  1. The comms lead pauses every scheduled post within the hour.
  2. Only calm, factual posts go out: facts first, one honest feeling, one concrete action, with official links.
  3. Bring Three, Rewind, trending sounds and jokes stay paused until the comms lead and one other organizer agree to resume.
- **If a court blocks the student-ID ban:** replace gc02, V02, V12, carousel slide 5, every Day 8, 21 and 30 post and the Jan 1 calm post with the court's actual status the same day. Don't guess at it.

### 1.6 Pre-launch checklist (Mon, Nov 9 to Tue, Dec 1)

- [ ] **Sign-off.** The chapter approves this kit, the site and how we name ourselves ("Young Dems", "YDSC").
- [ ] **Handles.** Florida Young Democrats lists @youngsemdems on Instagram for the chapter. The TikTok, X, Threads and Bluesky handles in `config.js` are placeholders. Confirm or claim each one, then fill in `social.*.url`.
- [ ] **Disclaimer.** Counsel settles committee status and wording (`legal.paidFor`). Every bio names the chapter and links the site, so the source is clear.
- [ ] **Anchors.** Page builders create `join#bring-three`, `join#texts`, `quiz#era` and `quiz#issue` (`sharekit.newAnchors`). The vote hashes are the `data/civic.js` step ids the vote page already renders: `renew-mail-ballot`, `what-id`, `register`, plus `dates`. `rewind.html` is due by Dec 16; if it isn't ready, link to the home page.
- [ ] **Link previews.** Static Open Graph images for vote, join, quiz and events. The link preview is the ad (report 04, #1).
- [ ] **Analytics.** Set `YSD_CONFIG.demo` to false and pick an analytics provider (Plausible, for custom events). Demo mode never sends, so until this is done nothing in section 10 can be counted.
- [ ] **Film ahead.** V01, V02, V03, V04, V06, V11 (on the Riverwalk) and V12, by Nov 30. Keep the raw files.
- [ ] **Spanish review.** The Spanish lead reviews every Spanish string in `data/sharekit.js` and in section 11.
- [ ] **Moderation.** Two named adult moderators, a stated response time, and a report flow.
- [ ] **Consent forms.** An adult release, and a guardian consent form for anyone under 18 on camera.
- [ ] **Sticker art.** The four starter stickers, plus stk01 and stk04, ready by Dec 7.
- [ ] **QR codes.** Generated with the section 10 UTMs.
- [ ] **Rewind counts.** The chapter supplies real 2026 counts by Dec 7, or the Rewind stays DEMO-labeled.
- [ ] **Recheck by Dec 15** (`sharekit.recheck`):
  - how the elections office treats requests made Nov 4 to Dec 31;
  - the status of the HB 991 lawsuit;
  - the certified Nov 3 results;
  - the 2027 city election postings.

---

## 2. The 30-day calendar

**Day 1 is Wed, Dec 2. Day 30 is Thu, Dec 31.** **[locked]** marks a post tied to its date. If launch slips, start on the matching day, keep locked posts on their dates, and drop the skipped unlocked days.

How to read each day:

- **Video** goes to TikTok and Reels. Script numbers refer to section 3.
- **Text** is posted word for word on X, Threads and Bluesky.
- `{url}` is the CTA page, built with the section 10 UTMs:
  - text posts: `utm_content=txt-dNN`;
  - Stories link stickers: `utm_content=story-dNN`;
  - videos: the bio link, `utm_content=bio-vNN`.

### Week 1: Hello, Seminole (Dec 2 to 6)

**Day 1 · Wed, Dec 2 · Hello, Seminole** **[locked]**
- **Video:** V03, "Seminole went blue (for governor)."
- **Feed:** the launch carousel (section 4). Pin it.
- **Stories:**
  1. "We're live." Link sticker to home.
  2. Poll: "Did you know mail-ballot requests from before Nov 3 run out Dec 31?" Yep / Wait, what.
  3. "Send this to one person."
- **Text:** "Hi, Seminole. We're the Young Dems: Democrats under 40 (ages 14 to 39) in Seminole County. Real deadlines, low-key events, and you don't need to be in any party to come. Start here: {url}" **[ages] [events-open]**
- **CTA:** home · `2026-12-launch`

**Day 2 · Thu, Dec 3 · The expiration date** · Thursday Letter
- **Video:** V01, "The expiration date."
- **Stories:**
  1. "The Thursday Letter is out." Link to join.
  2. "(DEMO event) Creator night tonight, 6:30 pm, Altamonte Springs." Link to `events#creator-night-60-seconds`.
  3. Countdown sticker: "Renew day: Jan 1."
- **Text:** "Asked for a Florida mail ballot before Nov 3? That request runs out Dec 31. Renew in January and one request covers you through 2028. Set a Jan 1 reminder: {url}" **[mail-expiry] [mail-renew-jan1] [mail-covers-2028]**
- **CTA:** `vote#renew-mail-ballot` · `2026-12-renew`

**Day 3 · Fri, Dec 4 · The biggest group isn't a party**
- **Video:** V04.
- **Stories:**
  1. Quiz sticker: "Biggest group of Seminole voters 18 to 40?" Democrats / Republicans / No party.
  2. The reveal, with the source line.
- **Text:** "The biggest group of Seminole voters aged 18 to 40 isn't Democrats or Republicans. It's no-party voters: about 34%, by our math from the elections office's July numbers. Any party or none, you're welcome at our events: {url}" **[npa-18-40] [events-open]**
- **CTA:** events · `2026-12-launch`

**Day 4 · Sat, Dec 5 · How Seminole are you?**
- **Video:** V06.
- **Stories:**
  1. Quiz sticker: "Sanford's nickname?" Celery City / Lake City / Sun City.
  2. Link sticker to `quiz#era`.
- **Text:** "Quick one: which Seminole city got its nickname from a vegetable? Sanford, the Celery City, where celery was first planted in 1896. Now find out what kind of organizer you are: {url}" **[celery-city]**
- **CTA:** `quiz#era` · `2026-12-launch`

**Day 5 · Sun, Dec 6 · Low-lift Sunday**
- **Video:** the best approved member take on V01 (with consent), or a re-share of V01.
- **Stories:**
  1. "This week's one thing: set your Jan 1 reminder." Link to `vote#renew-mail-ballot`.
  2. Re-share the countdown.
- **Text:** "Sunday plan, if you vote by mail: put 'renew mail ballot' on Jan 1 in your phone. That's the whole plan. How to renew, and the official link: {url}" **[mail-renew-jan1]**
- **CTA:** `vote#renew-mail-ballot` · `2026-12-renew`

### Week 2: Bring Three, the quiz, Spanish-first (Dec 7 to 13)

**Day 6 · Mon, Dec 7 · Bring Three starts** **[locked]**
- **Video:** V08.
- **Stories:**
  1. "Bring Three starts today." Link to `join#bring-three`.
  2. "Who's your first text going to? Don't tag them. Just text them."
- **Text:** "Starting today: Bring Three. Send your Young Dems link to three people you actually talk to. One joins: a badge. Three: the full sticker pack and a shoutout if you want one. Nobody pays. Through Dec 31: {url}"
- **CTA:** `join#bring-three` · `2026-12-bring3`

**Day 7 · Tue, Dec 8 · What's your organizer era?**
- **Video:** V07.
- **Stories:**
  1. Re-share members' result cards (adults only, with consent).
  2. "Add Yours" sticker: "My organizer era."
- **Text:** "Eight questions, six kinds of organizer: Hype Captain, Group-Chat General, Spreadsheet Witch, Door-Knock Natural, Creator, Plus-One. Which one are you? {url}"
- **CTA:** `quiz#era` · `2026-12-bring3`

**Day 8 · Wed, Dec 9 · Student IDs (calm)**
- **Video:** V02.
- **Stories:** one calm frame with the required wording and a link to `vote#what-id`. No other stickers.
- **Text (required wording):** "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. Details: {url}" **[student-id] [student-id-lawsuit]**
- **CTA:** `vote#what-id` · `2026-12-idrule`

**Day 9 · Thu, Dec 10 · Be the friend who knows** · Thursday Letter
- **Video:** V05.
- **Stories:**
  1. A screenshot of gc01.
  2. A screenshot of gc03.
  3. Link to `join#texts`.
- **Text:** "Be the friend who knows the deadline. We wrote 10 texts you can copy into the group chat (the family chat too), in English and Spanish: {url}"
- **CTA:** `join#texts` · `2026-12-renew`

**Day 10 · Fri, Dec 11 · En español**
- **Video:** V12, Spanish-first with English subtitles.
- **Stories:**
  1. gc03 in Spanish, linking to `es/vote.html#renew-mail-ballot`.
  2. "(DEMO event) Renew-ready party, Sun, Dec 13, 2 pm, Winter Springs."
- **Text:** a two-post thread, Spanish first.
  1. "Dos cambios para votar en Florida. Uno: si pediste la boleta por correo antes del 3 de noviembre, esa solicitud vence el 31 de diciembre. Renuévala en enero y te cubre hasta finales de 2028. Todo en español: {url}"
  2. "Dos: Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
  - Facts: **[mail-expiry] [mail-renew-jan1] [mail-covers-2028] [student-id] [student-id-lawsuit]**
- **CTA:** `es/vote#renew-mail-ballot` · `2026-12-renew`

**Day 11 · Sat, Dec 12 · One thing you'd fix**
- **Video:** V11, filmed earlier on the Sanford Riverwalk.
- **Stories:** question box: "One thing you'd fix in Seminole?" Screen answers before re-sharing them. Never re-share a private person's name or a false claim about voting.
- **Text:** "We asked people on the Sanford Riverwalk one thing they'd fix in Seminole. [Top two answers you actually heard] came up. What's yours? Find your issue in 7 questions: {url}"
  - Fill in the brackets with what people actually said, or cut the sentence.
- **CTA:** `quiz#issue` · `2026-12-launch`

**Day 12 · Sun, Dec 13 · Renew-ready party (DEMO event)** **[locked]**
- **Video:** the best approved member clip from creator night (consent on file).
- **Stories:**
  1. "(DEMO event) Today, 2 to 4 pm, Central Winds Park." Link to `events#renew-ready-party`.
  2. Two or three photos posted after the event, not live: consent checked, and no minors without guardian consent.
- **Text:** "(DEMO event) Renew-ready party today, 2 to 4 pm, at Central Winds Park in Winter Springs. Snacks, music, and we set our Jan 1 reminders together. Bring someone: {url}"
- **CTA:** `events#renew-ready-party` · `2026-12-renew`

### Week 3: Seminole Rewind and the 2027-28 dates (Dec 14 to 20)

**Day 13 · Mon, Dec 14 · Five dates**
- **Video:** V09.
- **Stories:**
  1. Rewind teaser: countdown sticker to Thu, 7 am.
  2. "Add the 2027-28 dates to your calendar." Link to `vote#dates`.
- **Text:** "Five dates for 2027-28: Oct 4, 2027 (registration closes for city elections), Nov 2, 2027 (city elections, if your city votes), then Mar 21, Aug 22 and Nov 7, 2028. Check voteseminole.gov before each: {url}" **[city-2027-reg-deadline] [city-2027-oviedo] [ppp-2028] [primary-2028] [general-2028]**
- **CTA:** `vote#dates` · `2026-12-rewind`

**Day 14 · Tue, Dec 15 · Turning 16?** · Internal recheck day
- **Video:** V10.
- **Stories:** poll: "Know a 16- or 17-year-old?" Yes / I am one. Link to `vote#register`.
- **Internal:** run `sharekit.recheck`. If the elections office now says Nov-Dec 2026 requests carry into 2027, switch the renew copy to "renew now."
- **Text:** "Turning 16, or know someone who is? Florida lets 16- and 17-year-olds pre-register, so they can vote in any election once they're 18. Official link and how: {url}" **[prereg-16]**
- **CTA:** `vote#register` · `evergreen`

**Day 15 · Wed, Dec 16 · Tomorrow: Rewind**
- **Video:** the R1 teaser cut (section 8).
- **Stories:**
  1. Quiz sticker: "How many Seminole voters are 18 to 40?" 64,000 / 124,000 / 210,000. Answer: 124,626 **[share-18-40]**.
  2. Countdown.
- **Text:** "Tomorrow: our 2026 in Seminole, in nine cards. Every number is real or clearly marked DEMO. It lands in The Thursday Letter at 7 am: {url}"
- **CTA:** join (Letter signup) · `2026-12-rewind`

**Day 16 · Thu, Dec 17 · Seminole Rewind drops** · Thursday Letter, Rewind edition **[locked]**
- **Video:** R1 in full.
- **Feed:** the Rewind carousel (car2).
- **Stories:**
  1. Frames 1 to 9: one card each.
  2. Frame 10: "Make your own card." Link to rewind.
- **Text:** a thread. The opener: "Seminole, 2026, rewound. Nine cards. A thread:" Posts 2 to 10 are the card texts in section 8. The closer: "Make your own card (it stays on your phone): {url}"
- **CTA:** `rewind.html` · `2026-12-rewind`

**Day 17 · Fri, Dec 18 · Your card**
- **Video:** a V07 remix: "My 2026: [era], [n] badges, [n] friends brought in." Use real numbers, or DEMO-label them.
- **Stories:** re-share members' personal cards (adults only, with consent).
- **Text:** "Made my Young Dems 2026 card: my organizer era, my badges, the friends I brought in. It's built on your phone, from what you did on the site. Make yours: {url}"
- **CTA:** `rewind.html` · `2026-12-rewind`

**Day 18 · Sat, Dec 19 · Bring Three halftime**
- **Video:** a text-on-screen shoutout montage.
  - Opt-in only.
  - Adults: first name and city.
  - Teens: first name only.
  - In demo mode, use DEMO names.
- **Stories:** shoutout frames, same rules.
- **Text:** "Halftime for Bring Three. Shoutouts on our Stories today for everyone who's brought friends in so far (with their OK). It runs through Thu, Dec 31: {url}"
- **CTA:** `join#bring-three` · `2026-12-bring3`

**Day 19 · Sun, Dec 20 · Low-lift Sunday**
- **Video:** V12 again, or the Spanish cut of V01 (`v01-es`).
- **Stories:** poll: "Set your Jan 1 reminder yet?" Done / Doing it now.
- **Text:** "Quick check before the holidays: if you vote by mail and asked before Nov 3, is the Jan 1 renewal reminder in your phone yet? One button: {url}" **[mail-expiry] [mail-renew-jan1]**
- **CTA:** `vote#renew-mail-ballot` · `2026-12-renew`

### Week 4: Family chats over the holidays (Dec 21 to 27)

**Day 20 · Mon, Dec 21 · Take the date home**
- **Video:** V05 again, with a new caption: "for the family chat."
- **Stories:** gc03 in English and in Spanish, "for the family chat." Link to `join#texts`.
- **Text:** "Going home for the holidays? Take one date with you: Florida mail-ballot requests from before Nov 3 run out Dec 31. Ready-made texts for the family chat, in English and Spanish: {url}" **[mail-expiry]**
- **CTA:** `join#texts` · `2026-12-renew`

**Day 21 · Tue, Dec 22 · Home from college (calm)**
- **Video:** V02, the "home-from-college" variant.
- **Stories:** a calm frame with the required wording. Link to `vote#what-id`.
- **Text:** "Home from college for break? Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. {url}" **[student-id] [student-id-lawsuit]**
- **CTA:** `vote#what-id` · `2026-12-idrule`

**Day 22 · Wed, Dec 23 · Trivia, part 2**
- **Video:** V06, part 2 (section 3).
- **Stories:** quiz sticker: "What grade was the designer of Seminole's first student-designed 'I Voted' sticker in?" 6th / 9th / 12th.
- **Text:** "Seminole trivia: in 2026 the county handed out its first 'I Voted' sticker designed by a student. What grade was the designer in? Sixth. More where that came from, at our events (DEMO events for now): {url}" **[i-voted-sticker]**
- **CTA:** events · `evergreen` (no trivia filter: the only demo trivia night, Nov 19, is over by then)

**Day 23 · Thu, Dec 24 · Christmas Eve: rest** **[locked]**
- **Video:** none.
- **Thursday Letter:** short holiday note, or skipped (say which on Dec 17).
- **Stories:** one frame: "Rest counts too. See you Saturday." No link.
- **Text:** "Rest counts too. However you spend tonight, we hope it's warm. See you Saturday." No link and no ask.

**Day 24 · Fri, Dec 25 · Christmas: rest** **[locked]**
- **Video:** none.
- **Stories:** a Lake Monroe sunset photo, with no people, that you took yourself: "Happy holidays. Felices fiestas."
- **Text:** "Happy holidays from the Young Dems. Felices fiestas." No link.

**Day 25 · Sat, Dec 26 · Next Thursday** **[locked]**
- **Video:** V05 again, captioned "Requests from before Nov 3 run out Thu, Dec 31."
- **Stories:** two countdown stickers: "Pre-Nov 3 requests run out: Dec 31" and "Renew day: Jan 1."
- **Text:** "Mail-ballot requests from before Nov 3 run out Thursday night, Dec 31. Friday, Jan 1, is renew day: one request should cover you through 2028 (check My Voter Record). Reminder and official link: {url}" **[mail-expiry] [mail-covers-2028]**
- **CTA:** `vote#renew-mail-ballot` · `2026-12-renew`

**Day 26 · Sun, Dec 27 · Bring Three: last week**
- **Video:** V08 again, captioned "Ends Thu, Dec 31."
- **Stories:** poll: "Bring Three: where are you at?" 0 / 1 / 2 / 3. Link.
- **Text:** "Bring Three closes Thursday at 11:59 pm. Got one friend in? Two more and the full sticker pack is yours. Texts you can send: {url}"
- **CTA:** `join#bring-three` · `2026-12-bring3`

### Week 5: The last four days (Dec 28 to 31)

**Day 27 · Mon, Dec 28 · Your 2027 calendar**
- **Video:** V09 again: "Put these in your 2027 calendar."
- **Stories:** "Add to your 2027 calendar." Link to `vote#dates`.
- **Text:** "Setting up your 2027 calendar? Add three dates: Jan 1 (renew your mail-ballot request), Oct 4 (registration closes for the Nov 2 city elections) and Nov 2 (city elections, if your city votes). All of them: {url}" **[mail-renew-jan1] [city-2027-reg-deadline] [city-2027-oviedo]**
- **CTA:** `vote#dates` · `2026-12-renew`

**Day 28 · Tue, Dec 29 · This Thursday** **[locked]**
- **Video:** V01, the "this-week" variant.
- **Stories:** countdown. Link to `vote#renew-mail-ballot`.
- **Text:** "This Thursday night, Dec 31, mail-ballot requests from before Nov 3 run out. Friday is renew day, and one request covers you through 2028: {url}" **[mail-expiry] [mail-covers-2028]**
- **CTA:** `vote#renew-mail-ballot` · `2026-12-renew`

**Day 29 · Wed, Dec 30 · Last call** **[locked]**
- **Video:** R1 personal-card montage (members' real cards, with consent).
- **Stories:** two link stickers: rewind and `join#bring-three`.
- **Text:** "Last call for two things: make your 2026 Young Dems card, and get your Bring Three friends in before tomorrow night. Both start here: {url}"
- **CTA:** home · `2026-12-rewind`

**Day 30 · Thu, Dec 31 · Tonight** · Thursday Letter **[locked]**
- **Video:** V01, the "tonight" variant.
- **Thursday Letter:** "Tonight it runs out. Tomorrow you renew."
- **Stories:**
  1. Countdown to midnight, then "Tomorrow morning: renew," with a link.
  2. A calm frame: "Starting tomorrow, Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go."
- **Text:** "Tonight, mail-ballot requests from before Nov 3 run out, ours included. Tomorrow is renew day: one request covers every election through 2028. Set an alarm for the morning, and happy new year: {url}" **[mail-expiry] [mail-covers-2028]**
- **CTA:** `vote#renew-mail-ballot` · `2026-12-renew`

### Coda (Jan 1 to 3, 2027)

**Fri, Jan 1 · Renew day** **[locked]** · `2027-01-renewday`

Before anything posts, open the official request page and check that it takes 2027-28 requests.

- **If it does:**
  - **Video:** V01, "renew-day" variant. You can screen-record the official form, but never show your personal details.
  - **Text:** "Renew day. Florida mail-ballot requests from before Nov 3 ended last night. Renew now and you're covered through 2028. Official link and how: {url}"
- **If it doesn't:**
  - **Stories only.**
  - **Text:** "Renew day, almost: the elections office hasn't confirmed its online form is taking 2027-28 requests yet. We'll post when it does. The official page: {url}"
- **Second post (calm):** "Starting today, Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. {url}" **[student-id] [student-id-lawsuit]**. Before it posts, re-check the court case.

**Sat, Jan 2**
- **Text:** "Did you renew? If you vote by mail, one request now covers every election through 2028. Here's the official link again: {url}"

**Sun, Jan 3**
- **Text:** "Thanks for a good December. Next up (DEMO events for now): a Spanish-language voter workshop on Sat, Jan 9, and a new-member mixer on Wed, Jan 13. See you there: {url}"
- **Thursday Letter, Jan 7:** a gentle note that dues season is here: $20 a year, or join as a non-voting member **[dues]**. Never mention dues on TikTok.

---

## 3. Twelve short-video scripts

Any member can film these, in their own words. The lines below are a starting point, not a script to read. Hooks, CTAs and captions in English and Spanish are in `data/sharekit.js` (`scripts[]`).

**Rules for every video**

- **Format.** Vertical 9:16, 1080 x 1920.
- **Hook.** The first 1.5 seconds carry a visual, the first spoken words and the on-screen text, all at once. TikTok's own guidance asks for the hook in the first six seconds (report 04, B8); we aim tighter.
- **On-screen text.**
  - Keep it in the middle of the frame. Stay out of the bottom third and the right edge, where captions and buttons sit.
  - Use ink on celery or paper on violet. Both pass 4.5:1 (report 03).
- **Captions.** Burn them in, and also switch on the platform's auto-captions. No flashing effects.
- **Sound.** See the presets below. Never name or use a copyrighted song.
- **Safety.**
  - Adults sign a release.
  - Anyone under 18 needs guardian consent, uses a first name only, and shows no school, location or uniform.
  - Post event footage after the event, never live.
  - No candidate names or faces.
  - Don't show anyone's real ballot, voter record or address.
- **Link.** Every video ends on one CTA page. The bio link carries `utm_content=bio-vNN` (section 10).

**Sound presets** (`sharekit.soundPresets`)

| Preset | Use |
|---|---|
| `voice-only` | Your own voice, no music. Best for facts and dates. |
| `library-low` | A calm instrumental from the audio library the account actually has in the app (organization and business accounts often get only the commercial library), kept well under your voice. No lyrics. |
| `trend-licensed` | A trending sound only if it's in the account's in-app library, has no lyrics that fight the message, and is under a week past its peak. Report 04 cites YPulse: most Gen Z think brands have about a week to join a trend. |
| `room-tone` | No music. Natural sound only. For calm topics. |

Platform sound effects (a ding, a whoosh) are fine with any preset.

### V01 · The expiration date · 20 to 25 s · talking head + prop · `voice-only` · bright
- **Hook (0.0 to 1.5 s):** hold an envelope with a hand-drawn "EXP 12/31" sticker next to your face. Say: "Your mail-ballot request has an expiration date." On screen: "Mail-ballot requests from before Nov 3 expire Dec 31."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 6 s | "In Florida, a request lasts through the end of the year of the next general election. If you asked before Nov 3, that's this year: Dec 31." | "Asked before Nov 3? → ends Dec 31" |
| 6 to 12 s | "In January, renew online or by phone with the Supervisor of Elections, the county office that runs voting. One request covers you through 2028." | "January: renew → covered through 2028" |
| 12 to 17 s | "So, one thing today: set a reminder for Jan 1. I'll wait." Set the alarm on camera; phone ding. | "Set a Jan 1 reminder" |
| 17 to 22 s | "The reminder and the official link are in my bio. Send this to whoever you vote with." | "Link in bio" |

- **CTA page:** `vote#renew-mail-ballot`.
- **Facts:** [mail-expiry] [mail-renew-jan1] [mail-covers-2028].
- **Variants** (dated in the data file):
  - "this-week" (Dec 28 to 30);
  - "tonight" (Dec 31);
  - "renew-day" (Jan 1 to 2) and "new-year" (Jan 3 on). Use these two only after confirming the official page takes 2027-28 requests.
- **Spanish cut:** `v01-es`, using the Spanish hook in the data file.

### V02 · Student IDs stop counting Jan 1 · 18 to 22 s · hands-only tabletop · `room-tone` · calm
- **Hook:** hands slide a sample card marked "STUDENT ID (SAMPLE)" onto a table. Voiceover: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls." On screen: "Jan 1, 2027: student IDs stop counting at Florida polls."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 6 s | "It's being challenged in court." | "Being challenged in court" |
| 6 to 13 s | "Bring a driver's license, state ID or passport." Place sample cards marked "SAMPLE." | "Driver's license · state ID · passport" |
| 13 to 18 s | "And check voteseminole.gov before you go." | "voteseminole.gov" |
| 18 to 20 s | "Details in bio." | "Details in bio" |

- **No face needed,** which makes this a good one for members who don't want to be on camera.
- **No real school logos.** Don't list other accepted IDs from memory.
- **Calm template:** no jokes, no music.
- **Variant:** "home-from-college" (Dec 14 to 31).
- **CTA page:** `vote#what-id`.
- **Facts:** [student-id] [student-id-lawsuit].

### V03 · Seminole went blue (for governor) · 20 to 25 s · green screen over your own graphic · `library-low` · bright
- **Hook:** point up at a big card reading "SEMINOLE: BLUE (for governor)." Use a plain county-outline graphic you made yourself. Say: "Seminole County voted blue for governor on Nov 3." On screen: "Seminole voted blue for governor (unofficial until certified)."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 7 s | "About 54 to 45 here, in unofficial returns." | "Seminole: about 54% / 45% (unofficial)" |
| 7 to 12 s | "Statewide went the other way, by less than 2 points." | "Statewide: the other way, by under 2 points" |
| 12 to 18 s | "Next up: city elections. Oviedo votes Nov 2, 2027, and Lake Mary and Altamonte Springs are expected to." | "Nov 2, 2027: Oviedo (confirmed) · Lake Mary, Altamonte Springs (expected)" |
| 18 to 23 s | "Smaller races, fewer voters, more say for each one. We're Democrats under 40, and our events are open to anyone 14 and up. Link in bio." | "Link in bio" |

- **No candidate names or faces.**
- **After certification,** use the official figures and drop "unofficial."
- **Re-check the 2027 dates before posting.** A city race with one qualified candidate comes off the ballot; that happened to Oviedo's seats in 2025.
- **Pride, not gloating.**
- **CTA page:** join.
- **Facts:** [gov-seminole] [gov-statewide] [city-2027-oviedo] [city-2027-expected].

### V04 · The biggest group isn't a party · 18 to 22 s · talking head + props · `voice-only` · bright
- **Hook:** three paper cups labeled DEM, REP and NO PARTY, with the NO PARTY stack tallest. Say: "The biggest group of Seminole voters 18 to 40? Not Democrats. Not Republicans." On screen: "Biggest group of Seminole voters 18-40: no party (NPA)."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 7 s | "It's people with no party: about 34% of active voters 18 to 40, by our math from the elections office's July numbers. Democrats about 33, Republicans about 27." | "No party 34% · Dem 33% · Rep 27% (SOE, July 2026)" |
| 7 to 14 s | "No party? You still vote in November, in city races, and in nonpartisan races like school board. Party primaries in Florida are mostly closed." | "No party = November, city and school board races" |
| 14 to 20 s | "And you don't need a party to come to our events. Find one, link in bio." | "Any party or none · events in bio" |

- **Say "biggest group," never "most."**
- **Primaries detail:** `data/civic.js` steps[party-and-primaries] covers the exceptions (universal primaries); link it rather than explaining it on camera.
- **CTA page:** events.
- **Facts:** [npa-18-40] [events-open] [closed-primaries].

### V05 · POV: the friend who knows the deadline · 12 to 15 s · screen recording of a made-up chat · `trend-licensed` · bright
- **Hook:** on screen, "POV: you're the friend who knows the deadline." A made-up group chat appears, labeled "skit, names are made up." The first bubble reads: "wait our mail ballots EXPIRE??"

| Time | Bubble | Note |
|---|---|---|
| 1.5 to 4 s | You: "the requests do, if we asked before nov 3. they end dec 31." | The fix is gentle |
| 4 to 7 s | You: "renew in jan and it covers us thru 2028" | |
| 7 to 10 s | You: "sending everyone the reminder link" | |
| 10 to 12 s | Friend: "this is why you're the group chat's favorite person" | |
| 12 to 15 s | End card | "Be that friend · texts to copy in bio" |

- **Build the chat in a mockup tool.** Never use a real screenshot or real names or numbers.
- **CTA page:** `join#texts`.
- **Facts:** [mail-expiry] [mail-renew-jan1] [mail-covers-2028].

### V06 · How Seminole are you? · 25 to 30 s · quiz-show talking head · `library-low` · bright
- **Hook:** tap a desk bell, or a pen on a mug. Ask: "Which Seminole city is nicknamed after a vegetable?" On screen: "How Seminole are you? 3 questions, no googling."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 6 s | "Three, two, one..." | countdown |
| 6 to 9 s | "Sanford. The Celery City. Celery first went in the ground there in 1896." | "Sanford: the Celery City (1896)" |
| 9 to 14 s | "How old was The Senator, the cypress in Longwood's Big Tree Park, when it burned in 2012?" | the question |
| 14 to 18 s | "About 3,500 years. A clone called The Phoenix grows there now." | "~3,500 years · The Phoenix grows there now" |
| 18 to 21 s | "How many SunRail stations are in Seminole?" | the question |
| 21 to 25 s | "Four: Sanford, Lake Mary, Longwood, Altamonte Springs." | "4 stations" |
| 25 to 30 s | "Three out of three? You'd crush our trivia night. Zero out of three? Come anyway, we'll put you on a team." | "Our events · link in bio" |

- **Part 2 (Day 22)** swaps in two new questions:
  - "In 2026, Seminole handed out its first 'I Voted' sticker designed by a student. What grade?" Sixth, picked from more than 50 entries. Never name the student.
  - "What lake is the Sanford Riverwalk on?" Lake Monroe.
- **CTA page:** events (not a filter: there's no demo trivia night after Nov 19; if the chapter schedules one, use `events.html?series=trivia`).
- **Facts:** [celery-city] [senator-tree] [sunrail-stations] [i-voted-sticker].

### V07 · A quiz called me a Spreadsheet Witch · 15 to 20 s · reaction + stitch prompt · `trend-licensed` · bright
- **Hook:** hold up your phone with your result card, then turn it back to yourself in mock outrage. Say: "A quiz just called me a Spreadsheet Witch, and I can't even argue." Swap in your own result. On screen: "What's your organizer era?"

| Time | Say | On screen |
|---|---|---|
| 1.5 to 5 s | Read your three strengths, from `data/quiz.js` | your strengths |
| 5 to 10 s | "Six types." Flick through them. | "Hype Captain · Group-Chat General · Spreadsheet Witch · Door-Knock Natural · Creator · Plus-One" |
| 10 to 15 s | "Eight questions. Stitch this with yours. I need to know who the Hype Captain is." | "Take the quiz · link in bio" |

- **Spanish names** are their own jokes, not translations, spelled as in `data/quiz.js`: La Chispa, Modo Admin, Magia en Celdas, Toc, Toc, Luces, Cámara, Acción, and Conoce a Medio Mundo. The Spanish quiz title is "¿Cuál es tu modo de organizar?"
- **CTA page:** `quiz#era`.

### V08 · Three friends. Not 300. · 18 to 22 s · talking head · `voice-only` · bright
- **Hook:** hold up three fingers, with a phone behind you showing three contacts, names blurred. Say: "I'm picking three friends. Not 300. Three." On screen: "Bring Three: Dec 7-31."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 6 s | "Send your Young Dems link to three people you actually talk to." | "3 people you actually talk to" |
| 6 to 11 s | "One joins, you get a badge. Three join: the full sticker pack and a shoutout if you want one." | "1 = badge · 3 = sticker pack + shoutout" |
| 11 to 16 s | "Nobody pays anything, nobody gets spammed, and nobody ever sees who didn't join." | "Free · no spam · private" |
| 16 to 20 s | "Through Dec 31. Get your own link on the site, link in our bio." | "Get your link · bio" |

- **Blur every contact.** Only joining counts (section 5).
- **CTA page:** `join#bring-three`.

### V09 · 2027-28 in five dates · 20 to 25 s · green screen over a calendar · `library-low` · bright
- **Hook:** say "Five dates to save for voting in Seminole in 2027 and 2028." On screen: "5 dates to save: 2027-28."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 5 s | "Oct 4, 2027: registration closes for city elections." | "Oct 4, 2027 · registration closes" |
| 5 to 9 s | "Nov 2, 2027: city elections, if your city votes. Oviedo's confirmed; Lake Mary and Altamonte Springs are expected." | "Nov 2, 2027 · city elections" |
| 9 to 13 s | "Mar 21, 2028: the presidential primary. It's closed: each party votes for its own candidates." | "Mar 21, 2028 · presidential primary" |
| 13 to 17 s | "Aug 22, 2028: the primary. School board and judges are open to every voter." | "Aug 22, 2028 · primary" |
| 17 to 21 s | "Nov 7, 2028: the general election." | "Nov 7, 2028 · general" |
| 21 to 25 s | "Check voteseminole.gov before each one. Every date's in our bio." | "All dates · link in bio" |

- **CTA page:** `vote#dates`.
- **Facts:** [city-2027-reg-deadline] [reg-29] [city-2027-oviedo] [city-2027-expected] [ppp-2028] [primary-2028] [general-2028] [closed-primaries].

### V10 · Turning 16? · 12 to 15 s · talking head · `voice-only` · bright
- **Hook:** say "If you're 16, Florida lets you pre-register to vote. Today." On screen: "16 or 17? Pre-register in Florida."

| Time | Say | On screen |
|---|---|---|
| 1.5 to 6 s | "Then you can vote in any election once you're 18." | "Vote at 18, ready at 16" |
| 6 to 10 s | "Do it on the official Florida site or with the county elections office." | "registertovoteflorida.gov · voteseminole.gov" |
| 10 to 15 s | "Official link in bio." | "Link in bio" |

- **If a teen is on camera:** guardian consent, first name only, no school identifiers.
- **We never collect anyone's registration information.** The official site does that.
- **CTA page:** `vote#register`.
- **Facts:** [prereg-16].

### V11 · One thing you'd fix in Seminole · 30 to 45 s · street interviews · `room-tone` · bright
- **Hook:** on the Sanford Riverwalk, hold the mic out to an adult who already said yes on camera. Ask: "One thing you'd fix in Seminole. Go." On screen: "One thing you'd fix in Seminole?"
- **Beats:** 3 to 5 answers, 4 to 6 seconds each. You mostly listen; a lower third shows a topic tag, and first names only if they agree. Close with your own answer ("Mine's [your answer]"), then: "What's yours? Find your issue, link in bio."
- **Rules:**
  - Ask "Are you 18 or older?" before you roll.
  - Get a signed release.
  - No last names.
  - Crop out kids in the background.
  - Never post an answer that gets a voting rule wrong.
  - Don't argue on camera.
  - A bilingual interviewer can mix languages: subtitle Spanish answers in English, and English answers in Spanish.
- **CTA page:** `quiz#issue`.

### V12 · Lo que cambia en 2027 (Spanish-first) · 28 to 35 s · talking head in Spanish, English subtitles · `voice-only` · calm
- **Hook:** two fingers up. Say: "Dos cosas cambian para votar en Florida, y las dos te pueden afectar." On screen: "2 cambios para votar en 2027."

| Time | Say (Spanish) | On screen |
|---|---|---|
| 1.5 to 12 s | "Uno: si pediste la boleta por correo antes del 3 de noviembre, esa solicitud vence el 31 de diciembre. Renuévala en enero, en línea o al 407-585-8683, y te cubre hasta finales de 2028." | "31 dic: vence · enero: renueva · cubre hasta 2028" |
| 12 to 25 s | "Dos: desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir." | "Identificación de estudiante: no sirve desde el 1 ene 2027" |
| 25 to 32 s | "Toda la información, en español, en el enlace del perfil. Mándaselo al chat de la familia." | "En español · enlace en el perfil" |

- **Spanish first, not a dub.** Link the `es/` page.
- **The elections office has Spanish request forms** (`data/civic.js` links.mailBallotFormPdf.urlEs).
- **CTA page:** `es/vote#renew-mail-ballot`.
- **Facts:** [mail-expiry] [mail-renew-jan1] [mail-covers-2028] [mail-phone] [student-id] [student-id-lawsuit].

---

## 4. Instagram launch carousel (10 slides)

- **Format:** 1080 x 1350 (4:5).
- **Type:** League Gothic for headlines and Atkinson Hyperlegible Next for body text (report 03, Pairing 1).
- **Colors:** Celery City Pop. Every text pair passes 4.5:1.
- **Eyebrows:** ALL CAPS, 1 to 3 words.
- **Exclamation marks:** none anywhere in the carousel.
- **Sources:** each slide carries a small source line.
- **Spanish:** the full Spanish carousel is in section 11.

| # | Eyebrow | Headline | Body | Source line | Visual |
|---|---|---|---|---|---|
| 1 | YOUNG DEMS | Hi, Seminole. | We're the Young Democrats of Seminole County: Democrats under 40, ages 14 to 39. | none | Celery fill, giant ink type, the stk06 "First time? Perfect." sticker slapped on a corner |
| 2 | NOV 3 | Seminole voted blue for governor. | About 54% to 45% here, in unofficial returns. Statewide went the other way, by less than 2 points, so the next one is wide open. | Unofficial until certified. Florida Division of Elections via WFTV. | Violet fill, paper type, your own county outline (no candidates) |
| 3 | UNDER 40 IN SEMINOLE | The biggest group isn't a party. | Among active voters 18 to 40, no-party voters are about 34%, Democrats about 33% and Republicans about 27%. You don't need a party to come hang out. | Seminole Supervisor of Elections, July 1, 2026; percentages computed by us. | Three bars, the no-party bar in celery |
| 4 | HEADS UP | Asked before Nov 3? Your mail-ballot request runs out Dec 31. | It happens every two years. In January, renew online or at 407-585-8683, and one request covers you through 2028. | Fla. Stat. 101.62; voteseminole.gov | Sky fill, the stk01 calendar page |
| 5 | NEW IN 2027 | Student IDs stop counting at the polls. | Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. | HB 991 (2026); voteseminole.gov | Calm: paper fill, ink type, no stickers |
| 6 | WHAT WE DO | Low-key, on purpose. | Trivia nights · Sunset walks on Lake Monroe · Creator nights · Text-a-friend nights · Karaoke. Free, alcohol-free, open to anyone 14 and up. | DEMO lineup while the site is in demo. "Free, alcohol-free, 14 and up" is draft policy until the chapter confirms it. | Bubblegum fill, five small stickers |
| 7 | TAKE THE QUIZ | What's your organizer era? | Hype Captain · Group-Chat General · Spreadsheet Witch · Door-Knock Natural · Creator · Plus-One. Eight questions. Link in bio. | none | Six mini result cards fanned out |
| 8 | BRING THREE | Three friends. Not 300. | Send your link to three people you actually talk to. When they join, you get a badge. At three: the full sticker pack and a shoutout if you want one. Nothing to buy. | Dec 7 to 31 | Three pinky-promise hands (stk04) |
| 9 | WHO IT'S FOR | Ages 14 to 39. Come as you are. | Teens welcome, with rules that keep it safe. English or Spanish. First time? Perfect. | none | stk12, the bilingual speech bubbles |
| 10 | SAVE THIS | Save this for Dec 31. Send it to the group chat. | Join, find events and set your Jan 1 reminder: link in bio. | Demo site · Young Democrats of Seminole County | Violet fill, paper type, a sticker pile |

**Caption:** "Hi, Seminole. We're the Young Dems: Democrats under 40 (ages 14 to 39), and our events are open to anyone 14 and up, any party or none. Swipe for what happened Nov 3, the one date you need (Dec 31), what changes Jan 1, and how to bring three friends. Link in bio." Add 2 hashtags at most, e.g. #SeminoleCounty plus the chapter tag once it's chosen.

**Alt text** (paste it into Instagram's advanced settings for each slide):

1. "Lime slide reading: Hi, Seminole. We're the Young Democrats of Seminole County: Democrats under 40, ages 14 to 39. A sticker says First time? Perfect."
2. "Purple slide: Seminole voted blue for governor on Nov 3, about 54% to 45% in unofficial returns, while the state went the other way by less than 2 points."
3. "Bar chart: among Seminole voters aged 18 to 40, no party 34%, Democrats 33%, Republicans 27%. You don't need a party to come hang out."
4. "Blue slide with a calendar page: your mail-ballot request runs out Dec 31 if you asked before Nov 3. In January, renew online or at 407-585-8683; one request covers you through 2028."
5. "Plain slide: Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go."
6. "Pink slide listing demo events: trivia nights, sunset walks on Lake Monroe, creator nights, text-a-friend nights, karaoke. Free, alcohol-free, open to anyone 14 and up."
7. "Six quiz result cards: Hype Captain, Group-Chat General, Spreadsheet Witch, Door-Knock Natural, Creator, Plus-One."
8. "Two hands making a pinky promise: Bring Three. Send your link to three friends; one joins for a badge, three for the sticker pack and a shoutout."
9. "Two speech bubbles saying Come as you are and Ven como eres: ages 14 to 39, teens welcome, English or Spanish."
10. "Purple slide: save this for Dec 31, send it to the group chat, link in bio."

**Facts:** [gov-seminole] [gov-statewide] [npa-18-40] [mail-expiry] [mail-renew-jan1] [mail-covers-2028] [mail-phone] [student-id] [student-id-lawsuit] [events-open] [ages].

---

## 5. Bring Three: the referral challenge

All copy (steps, rules, progress lines, shoutouts, FAQ) is in `data/sharekit.js` under `referral`, in English and Spanish.

### 5.1 How it works

- **When:** Mon, Dec 7 to Thu, Dec 31 at 11:59 pm. After that it stays on as an evergreen feature, without the shoutouts.
- **The ask:** send your link to three people you actually talk to, one at a time, in your own words or with a template (gc06).
- **What counts:** a friend joins through your link. Voting and non-voting memberships count the same.
- **What doesn't count:** clicks, follows, RSVPs, or anything to do with registering or voting.
- **Attribution** (already built into `assets/js/share.js` and `assets/js/members.js`):
  - Your link carries `?ref=YOURCODE`.
  - The friend's browser keeps the last code it saw for 30 days (`share.attributionDays`).
  - Your own code never counts for you.
  - When the friend joins, `members.join()` records `referredBy`, and they show up in your squad (`YSD.members.squad()`).
  - `data/levels.js` logs one `bring-friend` action per new squad member.
  - In demo mode the simulated squad members are labeled DEMO.

### 5.2 Rewards (none of them costs money)

| At | Who | Reward | Where it lives |
|---|---|---|---|
| Join | Everyone | Starter stickers: stk02, stk06, stk11, stk12 | `sharekit.stickerSets.starter` |
| 1 friend | You and your friend | The **Plus-One** badge for you; the **Bring a friend** sticker (stk04) for both of you | `levels.badges['plus-one']`, `sharekit.stickerSets.friend` |
| 3 friends | You | The **Squad of Three** badge, the full 12-sticker digital pack, an opt-in shoutout, and first pick from the next printed sticker sheet (DEMO until sheets exist) | `levels.badges['squad-of-three']`, `sharekit.stickerSets.pack` |

The reward is two-sided because Dropbox credited a two-sided referral reward with lifting signups, and Skok recommends rewarding both people (report 04, B6). Nothing is cash or worth cash.

### 5.3 Fairness rules

The full text is in `referral.rules`:

1. Nothing costs money or is worth money: no cash, gift cards, raffles or prizes.
2. Only joining counts. This challenge never rewards registering to vote, renewing a mail-ballot request or voting **[usc-10307c]**. (The wording is scoped to the challenge on purpose: `data/levels.js` does give badges for the renewal reminder and for renewing; see 5.5.)
3. Each person counts once, for one inviter. Your own code doesn't count.
4. Real people only. Duplicate or made-up sign-ups just don't count, and we never call anyone out.
5. There's no leaderboard of people. Everyone who reaches three gets the same thing, so there's nothing to gain by beating a friend. This matches `levels.js` (no public leaderboard) and report 04 (shame backfires).
6. You see the first names of friends who joined through your link. Nobody ever sees who didn't.
7. One message per friend. No answer is an answer.
8. Teens can play.
   - Their shoutouts are first name only, with no photo, school or city.
   - We never send money asks to anyone under 18.
9. Badges never expire. Friends who join after Dec 31 still count toward badges, just not toward this round's shoutouts.

### 5.4 Shoutouts

- **Opt-in only.** The box is unchecked by default.
- **Where:** text-only frames on Stories (Day 18, then the Dec 31 Letter).
- **Wording:**
  - Adults: "Shoutout to {name} from {city}..."
  - Teens: "Shoutout to {name}..."
  - Demo mode: "Maya from Oviedo (DEMO)."

### 5.5 Legal guardrails (for editors)

- **No rewards for registering or voting.** Federal law bars paying or offering to pay for registering or voting in elections with federal candidates **[usc-10307c]**.
- **No registration drives.** Florida regulates third-party voter registration (F.S. 97.0575; see the note at the top of `data/quiz.js`). The challenge never involves collecting forms; people use official sites themselves.
- **Ask counsel about `data/levels.js`.** It gives XP, a "Renew-Ready" badge for setting the reminder and a "Renewed" badge for renewing a mail-ballot request. The badges have no money value and run on the honor system, but counsel should review them.
- **Nothing of value for civic steps.** No stickers, merch, raffles or prizes for registering, renewing or voting, or for a friend doing so, so there is no "Renewed through 2028" sticker (stk01). Physical rewards (the printed sticker sheet, the welcome sticker) go only to organizing actions: showing up, volunteering, bringing friends in (docs/research/00).

---

## 6. Ten group-chat templates

The Spanish versions, links, UTM codes, the dated `after` text and editor notes are in `data/sharekit.js` (`groupChat[]`). `{url}` is always the member's own link.

| ID | When | Tone | English text |
|---|---|---|---|
| gc01 | The main one: requests from before Nov 3 run out Dec 31 | calm | "Heads up: if you asked for a mail ballot before Nov 3, that request runs out Dec 31 (mine too). Renew in January and one request covers you through 2028. I set a Jan 1 reminder. Set yours: {url}" |
| gc02 | Student IDs, required wording | calm | "Passing this along: Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. More here: {url}" |
| gc03 | The family chat (EN or ES; Spanish first on es/ pages) | calm | "Family, quick heads-up: if you vote by mail in Florida and asked for your ballot before Nov 3, that request runs out Dec 31. In January, renew online or call your county elections office (Seminole: 407-585-8683). One request covers you through 2028. Details: {url}" |
| gc04 | Invite one friend to one event | bright | "{event}, {when}, in {city}. First time? Perfect, that's the point. Come with me? {url}" (add "(DEMO event)" in front while events are demo) |
| gc05 | Share a quiz result | bright | "Took a quiz on what kind of organizer I'd be and got {result}. It knows me too well. What do you get? {url}" |
| gc06 | The Bring Three ask | bright | "I joined the Young Dems here in Seminole (under 40, good people, things to actually do). There's a Bring Three thing and you're one of my three. No pressure. Here's my link: {url}" |
| gc07 | For the friend in no party | bright | "You don't have to be a Democrat, or in any party, to come to a Young Dems event. Trivia nights, sunset walks, that kind of thing. Want to come with me sometime? {url}" |
| gc08 | Pre-registration at 16 | bright | "Know someone who's 16 or 17? Florida lets them pre-register to vote now, so they can vote in any election once they turn 18. Official link and how: {url}" |
| gc09 | Recruit a member video | bright | "Got 60 seconds and an opinion about Seminole? The Young Dems post member videos, and a real person checks every one before it goes up. Film it vertical: {url}" |
| gc10 | Share Seminole Rewind (from Dec 17) | bright | "The Young Dems put Seminole's 2026 into nine cards. Tap through, then make your own: {url}" |

**Notes**

- **Dated replacements.** gc01 and gc03 switch to their `after` text on Jan 1, once the official form is confirmed to take 2027-28 requests (`after.requires`). Until then the December text stays up; it still reads true in January.
- **Policies the chapter must confirm.** gc07 and gc09 depend on draft policies (`placeholder: 'chapter-confirm'`).
- **How these relate to `data/strings.js`.** The site's own share-button texts live there under `share.*`. These templates are the campaign's copy-this set.

---

## 7. The sticker pack (12 stickers)

**The spec** (`sharekit.stickerSpec`):

- **Digital:** 512 x 512 px transparent PNG with a white keyline, plus WebP copies for WhatsApp. Check WhatsApp's current sticker FAQ for size limits.
- **Print:** 3 in die-cut matte vinyl.
- **QR codes:** go on a separate 2 in black-on-white square, with the short URL printed underneath.
- **Never:**
  - Native imagery;
  - candidate faces;
  - school logos;
  - real business logos, SunRail's included;
  - brand look-alikes.

| ID | Phrase (EN / ES) | Visual | Colors (fill / ink) | Set | Local nod |
|---|---|---|---|---|---|
| stk01 | Renew on Jan 1 / Renueva el 1 de enero | Torn calendar page reading JAN 1, an envelope peeking out | celery / ink | pack (Dec to Feb) | the Dec 31 expiry **[mail-expiry]** |
| stk02 | I know the deadline / Yo sé la fecha | Speech bubble with a tiny ringing alarm clock | violet / paper | starter | the brand's voice line |
| stk03 | Celery City Democrat / Demócrata de Celery City | A celery stalk in round sunglasses | celery / ink | pack | Sanford **[celery-city]** |
| stk04 | Bring a friend / Trae a alguien | Two hands in different skin tones making a pinky promise | bubblegum / ink | friend | Bring Three |
| stk05 | Ask me about my mail ballot / Pregúntame por mi boleta por correo | Envelope with googly eyes waving an ASK ME flag | sky / ink | pack | **[mail-expiry]** |
| stk06 | First time? Perfect. / ¿Primera vez? Perfecto. | A HELLO name tag | paper / ink | starter | hand these out at the door |
| stk07 | Golden hour on Lake Monroe / Hora dorada en el lago Monroe | Sunset over water, sailboat masts in silhouette, no people | bubblegum / ink | pack | Riverwalk; the Golden Hour badge |
| stk08 | The long game / A largo plazo | Young cypress beside an old ringed stump | celery / ink | pack | The Senator and The Phoenix **[senator-tree]** |
| stk09 | Took the train / Llegué en tren | Generic commuter train with a heart headlight (no SunRail branding) | sky / ink | pack | 4 Seminole stations **[sunrail-stations]** |
| stk10 | Oviedo chicken energy / Orgullo de gallo de Oviedo | Strutting rooster with a tiny clipboard | celery / ink | pack | Oviedo's chickens (folklore) **[oviedo-chickens]** |
| stk11 | Sent it to the group chat / Ya lo mandé al chat | Wiggling phone with a check-mark bubble | sky / ink | starter | the reward after any share |
| stk12 | Come as you are. Ven como eres. | Two overlapping speech bubbles, one per language | paper / ink | starter | full bilingual phrases, not token words |

Spanish note on stk10: "gallina" reads as "coward" in much of Latin America, so the Spanish sticker is a proud rooster ("gallo"). It's its own joke, not a translation.

A precedent worth mentioning in posts: Seminole's 2026 "I Voted" sticker was the county's first designed by a student, chosen from more than 50 entries **[i-voted-sticker]**. A member sticker-design vote for the 2027 season fits that precedent (see the Big Tree Park picnic, a DEMO event in `data/events.js`).

---

## 8. Seminole Rewind: the December recap

### 8.1 The idea

- **What it is:** a tap-through set of nine story cards about the chapter's 2026, plus a personal card each member makes on their own phone.
- **Why December:** it rides the year-in-review habit Spotify Wrapped built (report 04, A2 and #16).
- **The name is "Seminole Rewind,"** not "Wrapped": no Spotify name, green, logo or card layout, so nobody thinks we're affiliated. The Spanish name stays "Seminole Rewind," with "Nuestro 2026, en nueve tarjetas" as the subtitle.

### 8.2 The nine cards

Formats: 1080 x 1920 for Stories and Reels, 1080 x 1350 for the feed carousel, and a 1200 x 630 link-preview image for `rewind.html`.

| # | Card text (EN) | Rule |
|---|---|---|
| 1 | "Seminole, 2026, rewound." / "Nine cards. Real numbers, and anything not real yet says DEMO." | Cover |
| 2 | "Nov 3: Seminole voted blue for governor." / "About 54% to 45% here. The state went the other way by less than 2 points." | Use certified figures once posted **[gov-seminole] [gov-statewide]** |
| 3 | "Young voters showed up." / "CIRCLE estimates 27% of young people nationwide (ages 18 to 29) voted, the second-highest midterm youth turnout in 30 years." | National estimate, attributed **[youth-turnout]** |
| 4 | "We're a big slice of Seminole." / "Voters 18 to 40 are 36.8% of the county's active voters: 124,626 people." | **[share-18-40]** |
| 5 | "The biggest group of us isn't a party." / "No-party voters: about 34% of Seminole voters 18 to 40." | **[npa-18-40]** |
| 6 | "Our year, counted." / "{n} members joined · {n} events · {n} cities." | Real counts from the chapter, or DEMO on every number (the `counters.js` baselines are demo) |
| 7 | "Our most common organizer era: {era}." | Only if at least 50 quiz completions were counted (result id only, never answers). Otherwise: "Six organizer eras. Which are you?" Small numbers can backfire (report 04, B3). |
| 8 | Until Dec 31: "The date you know now: Dec 31." / "Mail-ballot requests from before Nov 3 run out. Jan 1: renew, covered through 2028." From Jan 1: "Renewed yet? One request covers you through 2028." | **[mail-expiry] [mail-covers-2028]** |
| 9 | "2027 is a city year." / "Nov 2, 2027: Oviedo votes (Lake Mary and Altamonte Springs expected). Registration closes Oct 4." / Button: "Make your card." | **[city-2027-oviedo] [city-2027-expected] [city-2027-reg-deadline]** |

### 8.3 The personal card

- **Built in the browser** from what this visitor did on the site, using the YSD.store keys:
  - organizer era, if they kept the result;
  - badges earned, by count and the top three names;
  - friends brought in (squad size; DEMO when simulated);
  - weeks active (`levels.js`);
  - one closing line: "Next: renew on Jan 1."
- **Nothing is sent anywhere.** Render it with `YSD.cards` in story (1080 x 1920) and square sizes.
- **Teens' cards** show a first name only.

### 8.4 Timeline

| Date | Step |
|---|---|
| Mon, Dec 7 | Ask the chapter for real 2026 counts (members, events, cities) |
| Thu, Dec 10 | Draft the cards in English and Spanish |
| Fri, Dec 11 | Fact check, Spanish review, DEMO-label check |
| Mon, Dec 14 | Teaser in Stories (Day 13) |
| Wed, Dec 16 | R1 teaser video (Day 15) |
| Thu, Dec 17, 7 am | Drop: Letter, carousel, R1, Stories, thread (Day 16) |
| Fri, Dec 18 | Personal-card push (Day 17) |
| Wed, Dec 30 | Last call (Day 29) |
| Sun, Jan 31 | `rewind.html` stays up, labeled "2026," and gc10 stops showing |

### 8.5 R1 script (Rewind reel) · 20 s · `library-low` · bright
- **Hook (0.0 to 1.5 s):** card 1 slams in with a platform sound effect. Voiceover: "Seminole, 2026, rewound." On screen: the card itself.
- **Body:** cards 2 to 9 at about 2 seconds each, with one spoken line per card.
- **End:** "Make your card. Link in bio."
- **Teaser cut (Day 15):** cards 1, 2 and 9 only, with "Tomorrow, 7 am" on screen.

### 8.6 What to measure

- Stories completion (forward taps and exits per frame);
- R1 average watch time;
- shares and sends;
- `rewind.html` visits by `utm_content`;
- personal cards made (`card_render`) and shared (`card_share`);
- December joins compared with November.

---

## 9. Press and creator outreach

**Rules first**

- **Public contact routes only.** Use newsroom tip forms, public business emails listed on a profile, and public handles. This document never holds personal phone numbers or personal emails. Track contacts in the chapter's own tools, under its privacy policy.
- **No paying or gifting creators.**
  - TikTok bars paid political branded content **[tiktok-branded]**.
  - Anything of value that changes hands would also need a disclosure label and a campaign-finance check by counsel. We offer credit, a seat at creator night and the sticker pack, nothing with money value.
- **Creators speak in their own voice.** Share the facts sheet (section 12) and a script as a starting point, never words to read. Never ask a creator to endorse a candidate.
- **No minors as creators** without guardian consent. No filming on school property or during school time.
- **No business shown as a host.** A food creator's favorite taco truck is their content, not our venue.
- **Corrections:** if a creator gets a voting rule wrong, ask privately and politely for a fix, with the official link.

### 9.1 The tracker template

| Type | Public name or handle (no personal contacts) | Lang | Angle | Ask | We offer | Owner | Status | Last touch | Their post | utm_content | Notes |
|---|---|---|---|---|---|---|---|---|---|---|---|
| (from 9.2) | | EN / ES / both | | | credit, creator night, stickers | | idea / contacted / replied / yes / no / posted | Mon, Dec 7, 2 pm | link | `creator-<slug>` | |

### 9.2 Who to approach (types, not people)

| # | Type | Angle | Ask |
|---|---|---|---|
| 1 | Seminole and Orlando food and cheap-eats creators | "The friend who knows the deadline, and the taco truck" | Stitch V01 in their own voice |
| 2 | Downtown Sanford and Riverwalk lifestyle creators | Celery City pride, golden hour on Lake Monroe | Use stk07 in a sunset post with the Jan 1 reminder |
| 3 | College creators at UCF and Seminole State (adults) | Student IDs stop counting Jan 1, 2027 | Duet V02 (calm) |
| 4 | Bilingual Puerto Rican and Latin American creators in Central Florida | The family chat, in Spanish | Their own take on V12; share gc03 |
| 5 | Local history and "only in Florida" accounts | The Senator and The Phoenix; the Celery City | A V06 trivia collab |
| 6 | Transit and urbanist creators, SunRail riders | 4 Seminole stations | A SunRail social (DEMO event) or a stitch |
| 7 | Outdoors creators: kayaking, the Wekiva, Lake Jesup | Lakes and clean water (issue card) | A water-issue post with the Issue Finder. Wekiwa Springs State Park is in Orange County, so say "the Wekiva." |
| 8 | LGBTQ+ creators in Central Florida | Belonging; the LGBTQ+ freedom issue card | Come to creator night, post a take |
| 9 | Book, teacher and librarian creators (adults, off the clock) | Schools and the freedom to read | An Issue Finder stitch, never filmed at school |
| 10 | Theme-park and hospitality worker creators | Wages and cost of living | A V11-style "one thing you'd fix" |
| 11 | Young-parent creators | Pre-registration at 16; the family chat | Share gc08 and gc03 |
| 12 | Local musicians, DJs, karaoke hosts | Events (DEMO) | Host a karaoke night (no song names in our posts) |
| 13 | Local TV news in the Orlando market (English) | A practical story: mail-ballot requests made before Nov 3 run out Dec 31, and the student-ID change, for young voters | A segment or a quote from a chapter spokesperson the chapter picks |
| 14 | Public radio and nonprofit newsrooms (regional and statewide) | HB 991 explained for young voters, with Spanish | An explainer quote; link to `vote#what-id` |
| 15 | Spanish-language TV, radio and digital outlets in Central Florida | Two changes for 2027, in Spanish (V12) | A Spanish-language interview with a fluent member |
| 16 | Campus media at UCF and Seminole State | Student IDs; Bring Three on campus | A story or a reshare |
| 17 | Community calendars (library, neighborhood, nonprofit) | Events only | List events. Many won't list partisan events, so check each policy first. |

### 9.3 Pitch templates

**Press email** (from the chapter's address; under 150 words):

> **Subject:** Florida mail-ballot requests from before Nov 3 run out Dec 31: a Seminole explainer for young voters
>
> Hi [desk or reporter's public name],
>
> I'm [first name], with the Young Democrats of Seminole County (YDSC), a volunteer group for people 14 to 39. Two things change for Seminole voters this winter, and one of them lands squarely on students:
>
> 1. Every Florida mail-ballot request made before the Nov 3 election runs out Dec 31, 2026 (Fla. Stat. 101.62). One new request in 2027 covers every election through 2028.
> 2. Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (HB 991; it's being challenged in court).
>
> We made plain-language explainers in English and Spanish, linked to the Supervisor of Elections: [link]. A member can talk on camera in either language this week.
>
> Thanks,
> [first name], [role], YDSC

**Creator DM** (public DMs only; one message, no follow-up spam):

> EN: "Hi! I'm [first name] from the Young Dems in Seminole. Your [specific post] is the most Seminole thing I've seen this month. We're trying to get people to set a Jan 1 reminder (Florida mail-ballot requests from before Nov 3 run out Dec 31). Would you make your own version? No script, no payment, just the facts sheet and a seat at our next creator night if you want one."
>
> ES: "¡Hola! Soy [nombre], de los Young Dems de Seminole. Tu [publicación] es lo más Seminole que he visto este mes. Queremos que la gente ponga un recordatorio para el 1 de enero (las solicitudes de boleta por correo en Florida hechas antes del 3 de noviembre vencen el 31 de diciembre). ¿Te animas a hacer tu propia versión? Sin guion y sin pago: te pasamos los datos y, si quieres, un lugar en nuestra próxima noche de creadores."

These DMs use one exclamation mark each, in the greeting. That's the one allowed per screen.

---

## 10. Measurement, refcodes and UTMs

### 10.1 The weekly scorecard (every Monday at 7 pm, covering Mon to Sun)

**Before any of this works:** the site needs `YSD_CONFIG.demo = false` and an analytics provider (Plausible for custom events, report 06, 5.1). Demo mode never sends anything, and `track.js` drops personal-data keys and respects Do Not Track and Global Privacy Control.

| Group | Metric | Definition | Where it comes from |
|---|---|---|---|
| Attention | Views per video | TikTok and Reels views, by script ID | Platform analytics |
| Attention | Watch-through | Average watch time and % watched | Platform analytics |
| Spread | **Sends per 1,000 views** | DM shares plus "send" taps. This leads, not likes: sharing lives in DMs (report 04, B7). | Platform analytics |
| Spread | Saves | Instagram saves per post | Platform analytics |
| Spread | Link taps | Bio and Stories link-sticker taps | Platform analytics |
| Site | Visits by asset | Sessions by `utm_campaign` and `utm_content` | Analytics provider |
| Site | Ref arrivals | `ref_captured` events | `YSD.track` |
| Site | Shares | `share` events with result `shared` or `copied`, by `channel`; `card_share` | `YSD.track` |
| Outcome | **Renew reminders set** | `calendar_add` for the renew reminder (`civic.nextActions` id `na-renew-reminder-2026`; the `levels.js` action `set-renewal-reminder`) | `YSD.track` |
| Outcome | Quiz completions | Result id only | Analytics provider |
| Outcome | **Joins / referred joins** | `join` events, and the share with `referred: true` | `YSD.track` and the form backend |
| Outcome | Clip submissions | Submissions on `post.html` | Upload endpoint |
| Spanish | Spanish reach | Sessions on `es/` pages; Spanish template copies; views of V12 | Analytics provider |
| Loop | **i** | Member share events (shared or copied) ÷ all members that week (dividing by only the members who shared inflates K) | `YSD.track` |
| Loop | **c** | Referred joins ÷ member share events | Backend and `YSD.track` |
| Loop | **K = i × c** | Report 04's rough range for a county club is 0.3 to 0.6. Treat it as a ballpark, not a target. | computed |
| Loop | **Cycle time** | Median days from a member's join to their first referred friend's join | Form backend (`joinedAt`, `referredBy`) |
| Loop | Bring Three ladder | Members at 1, 2 and 3 or more | Backend |
| Trust | Reports, takedowns, moderation time | From the moderation queue | Moderators |
| Trust | DEMO-label misses | Found in review; should always be 0 | Fact checker |
| Trust | Corrections | Posts corrected or deleted | Comms lead |
| Trust | Letter unsubscribes | Per send | Email provider |

**Never count:**

- who didn't join;
- anyone's voting record or registration status;
- individual quiz answers;
- any data about minors beyond what the join form takes.

**The Monday review takes 20 minutes and answers four questions:**

1. What got sent (not liked)?
2. What do we cut?
3. Which fact needs rechecking?
4. Did the Spanish posts land?

### 10.2 The link scheme (matches `assets/js/share.js`)

| Param | Meaning | Values |
|---|---|---|
| `ref` | The member's referral code | Added automatically by `YSD.share.url()` for members. Upper-case letters, digits, `_` and `-`, 2 to 32 characters. Last touch wins; 30-day window; your own code is ignored. |
| `utm_source` | Where the link physically sits | `share` (unknown: copy button or share sheet; the config default), `tiktok`, `ig`, `x`, `threads`, `bluesky`, `facebook`, `yt`, `sms`, `whatsapp`, `telegram`, `email`, `qr`, `press`, `creator` |
| `utm_medium` | Who is sharing | `social` (our account), `p2p` (a member to friends), `print` (always with `qr`), `email`, `creator`, `press` |
| `utm_campaign` | The arc | `2026-12-launch`, `2026-12-renew`, `2026-12-idrule`, `2026-12-bring3`, `2026-12-rewind`, `2027-01-renewday`, `evergreen` |
| `utm_content` | The asset | `v01`..`v12` (plus `-es` or a variant id, e.g. `v01-this-week`), `r1`, `car1-s01`..`car1-s10`, `car2`, `gc01`..`gc10`, `stk01`..`stk12`, `txt-d01`..`txt-d30`, `story-d01`..`story-d30`, `ltr-YYYY-MM-DD`, `bio`, `bio-vNN`, `creator-<slug>` |
| `utm_term` | City, optional | `altamonte-springs`, `casselberry`, `lake-mary`, `longwood`, `oviedo`, `sanford`, `winter-springs`, `unincorporated` |

**Rules**

1. Use lowercase letters, digits and hyphens, 40 characters or fewer per value.
2. Never put a name, email, phone number, school or home city in a UTM. The ref code is the only person-linked parameter, and it's pseudonymous.
3. **Building links in code:**

   ```js
   YSD.share.url(path, { utm_source, utm_medium: 'p2p', utm_campaign, utm_content })
   ```

   share.js adds `ref` and fills any missing `utm_*` from config `share.utm`. For the `YSD.share.links()` buttons, use the key it returns (`sms`, `whatsapp`, `x`, `threads`, `bluesky`, `facebook`, `email`, `telegram`) as `utm_source`. Pass the same code as `channel` to `YSD.share.native()` so the `share` event and the UTM agree.
4. Report 04's `?s=` and `r=` parameters are replaced by `utm_source` and `ref`. Don't add `?s=`.
5. Don't add UTMs to the `/go/*` short links (they redirect straight to official sites; count them in the host's redirect logs) or to any official-site link.
6. **QR codes** point at our own pages, not `/go/*`, so the visit is counted and the page gives context. Example: `vote.html?utm_source=qr&utm_medium=print&utm_campaign=2026-12-renew&utm_content=stk01&utm_term=oviedo#renew-mail-ballot`.
7. **ActBlue** links get `refcode=ref_<CODE>` and `refcode2=utm_<source>` from `YSD.share.actblue()`. None of them go on TikTok, and none sit beside calm posts.

**Examples**

- A member copies gc01: `…/vote.html?utm_source=share&utm_medium=p2p&utm_campaign=2026-12-renew&utm_content=gc01&ref=KIRA7QX#renew-mail-ballot`
- TikTok bio while V01 is pinned: `…/vote.html?utm_source=tiktok&utm_medium=social&utm_campaign=2026-12-renew&utm_content=bio-v01#renew-mail-ballot`
- Day 16 Stories link sticker: `…/rewind.html?utm_source=ig&utm_medium=social&utm_campaign=2026-12-rewind&utm_content=story-d16`

---

## 11. En español: the top items

The Spanish is written for neutral Latin American readers (Puerto Rican, Cuban, Colombian, Venezuelan, Mexican), not translated word for word. A fluent person must review it before launch.

**Terms, as in `data/civic.js` and Florida's Spanish forms:** "solicitud de boleta por correo" (the request), "boleta por correo" (the ballot), "voto por correo" (the method), "inscribirse" (register), "identificación de estudiante" (never "ID" in full sentences), "Supervisor de Elecciones" or "la oficina electoral". The club is "los Young Dems", with the article, as in `data/strings.js`.

- **In `data/sharekit.js`:** every group-chat template, sticker phrase, script hook, CTA and caption, and all the Bring Three copy, in Spanish.
- **Below:** the Spanish carousel and a summary of Bring Three.

### 11.1 Carrusel de lanzamiento (10 diapositivas)

| # | Antetítulo | Título | Texto | Fuente |
|---|---|---|---|---|
| 1 | YOUNG DEMS | Hola, Seminole. | Somos los Young Democrats of Seminole County: demócratas menores de 40, de 14 a 39 años. | — |
| 2 | 3 DE NOV. | Seminole votó azul para gobernador. | Cerca de 54% frente a 45% aquí, según resultados extraoficiales. En el estado ganó el otro partido por menos de 2 puntos, así que la próxima está abierta. | Extraoficial hasta la certificación. División de Elecciones de Florida, vía WFTV. |
| 3 | MENORES DE 40 EN SEMINOLE | El grupo más grande no es un partido. | Entre los votantes activos de 18 a 40 años, los que no tienen partido son cerca del 34%, los demócratas cerca del 33% y los republicanos cerca del 27%. No necesitas partido para venir a pasarla bien. | Supervisor de Elecciones de Seminole, 1 de julio de 2026; porcentajes calculados por nosotros. |
| 4 | OJO | ¿La pediste antes del 3 de noviembre? Tu solicitud de boleta por correo vence el 31 de diciembre. | Pasa cada dos años. En enero, renuévala en línea o al 407-585-8683, y una sola solicitud te cubre hasta finales de 2028. | Ley de Florida 101.62; voteseminole.gov |
| 5 | NUEVO EN 2027 | La identificación de estudiante deja de servir para votar. | Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir. | HB 991 (2026); voteseminole.gov |
| 6 | LO QUE HACEMOS | Sin presión, a propósito. | Noches de trivia · Caminatas al atardecer en el lago Monroe · Noches de creadores · Noches de mensajes · Karaoke. Gratis, sin alcohol y para cualquier persona desde los 14 años. | Programación DEMO mientras el sitio esté en modo demo. "Gratis, sin alcohol, desde los 14" es política en borrador hasta que el capítulo la confirme. |
| 7 | HAZ EL QUIZ | ¿Cuál es tu modo de organizar? | La Chispa · Modo Admin · Magia en Celdas · Toc, Toc · Luces, Cámara, Acción · Conoce a Medio Mundo. Ocho preguntas. Enlace en el perfil. | — |
| 8 | TRAE A TRES | Tres personas. No trescientas. | Manda tu enlace a tres personas con las que de verdad hablas. Cuando se unen, recibes una insignia. Con tres: el paquete completo de stickers y una mención si la quieres. No hay nada que comprar. | Del 7 al 31 de diciembre |
| 9 | PARA QUIÉN ES | De 14 a 39 años. Ven como eres. | Adolescentes bienvenidos, con reglas para que todo sea seguro. En inglés o en español. ¿Primera vez? Perfecto. | — |
| 10 | GUÁRDALO | Guárdalo para el 31 de diciembre. Mándalo al chat. | Únete, busca eventos y pon tu recordatorio del 1 de enero: enlace en el perfil. | Sitio demo · Young Democrats of Seminole County |

**Descripción:** "Hola, Seminole. Somos los Young Dems: demócratas menores de 40 (de 14 a 39 años), y nuestros eventos están abiertos a cualquier persona desde los 14, con partido o sin partido. Desliza para ver qué pasó el 3 de noviembre, la fecha que necesitas (31 de diciembre), lo que cambia el 1 de enero y cómo traer a tres personas. Enlace en el perfil."

### 11.2 Trae a tres, en resumen

- **Qué:** del lunes 7 al jueves 31 de diciembre a las 11:59 p. m., mándale tu enlace a tres personas con las que de verdad hablas, una por una.
- **Qué cuenta:** solo cuenta que alguien se una a los Young Dems con tu enlace. Clics, seguidores o cualquier cosa relacionada con inscribirse o votar no cuentan.
- **Premios:**
  - con una persona, la insignia «Trajiste a alguien», y el sticker «Trae a alguien» para las dos;
  - con tres, la insignia «Grupo de tres», los 12 stickers y una mención si la quieres.
- **Reglas:**
  - nada cuesta dinero ni vale dinero;
  - no hay tabla de posiciones;
  - nadie ve quién no se unió;
  - las menciones de adolescentes van solo con el nombre de pila.

---

## 12. Facts and sources

Every fact below was checked on Mon, Nov 9, 2026. "Via" means the fact was also checked today by another file's owner, and this kit reuses their source.

| ID | Claim (short) | Source | Confidence |
|---|---|---|---|
| mail-expiry | A request lasts from the day it's made through the end of the year of the next general election; requests made before Nov 3, 2026 end Dec 31, 2026, and one made after should run through Dec 31, 2028 | [Fla. Stat. 101.62](https://www.flsenate.gov/Laws/Statutes/2026/101.62); [Division of Elections](https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/) | high |
| mail-renew-jan1 | Renew online, by phone or on a form. A request made after Nov 3 should already run through 2028 (state rule), but Seminole hasn't said how it handles requests made Nov 4 to Dec 31; a request on or after Jan 1, 2027 is the sure one (earlier renewers check My Voter Record) | [voteseminole.gov vote by mail](https://voteseminole.gov/how-to-vote/vote-by-mail/); [Division of Elections](https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/); via `data/civic.js` | med |
| mail-covers-2028 | A 2027 request covers elections through Dec 31, 2028 | [Fla. Stat. 101.62](https://www.flsenate.gov/Laws/Statutes/2026/101.62) (applied to Nov 7, 2028) | high |
| mail-phone | Request by phone at 407-585-8683 | [voteseminole.gov vote by mail](https://voteseminole.gov/how-to-vote/vote-by-mail/) | high |
| student-id | HB 991 removes student IDs from accepted voter ID, effective Jan 1, 2027 | [Senate bill summary](https://flsenate.gov/Committees/BillSummaries/2026/html/991); [bill page](https://flsenate.gov/Session/Bill/2026/991) | high |
| student-id-lawsuit | Federal suit filed Oct 16, 2026 by the Florida NAACP; no ruling listed as of Nov 9 | [Complaint (Democracy Docket)](https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf); [case page](https://www.democracydocket.com/cases/florida-student-id-ban-challenge/); via report 00 | high |
| gov-seminole | Seminole for governor: about 54% D to 45% R, unofficial (54.08 to 44.59 on Nov 9) | [WFTV county results](https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/); [Seminole ENR](https://enr.electionsfl.org/SEM/4119/Summary/) | high (unofficial) |
| gov-statewide | Statewide R won by less than 2 points (about 50.0 to 48.7) | [Florida Phoenix](https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/); [Florida Trend](https://www.floridatrend.com/articles/2026/11/04/donalds-fends-off-jolly-moody-hangs-us-senate-seat/) | high |
| youth-turnout | CIRCLE: 27% youth (18 to 29) turnout (±2), second-highest midterm in 30 years, behind 2018 | [CIRCLE, Nov 5, 2026](https://circle.tufts.edu/latest-research/2026-youth-voter-turnout-second-highest-last-30-years) | high (preliminary) |
| npa-18-40 | Seminole voters 18 to 40: no party 34.3%, Dem 32.7%, Rep 27.4% (July 1, 2026) | [SOE District Demographic Analysis](https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf); computed in report 01, 6c | high |
| share-18-40 | 18 to 40 = 36.8% of 338,692 active voters (124,626) | Same PDF; report 01, 6c | high |
| prereg-16 | Pre-register at 16; vote at 18 | [voteseminole.gov register](https://voteseminole.gov/voters/register-to-vote/); [Fla. Stat. 97.041](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html) | high |
| closed-primaries | Florida primaries: you vote your own party's ballot, except universal primaries; nonpartisan races (school board, judges) are open to all | [Fla. Stat. 101.021](https://www.flsenate.gov/Laws/Statutes/2026/101.021); [Fla. Const.](https://www.flsenate.gov/Laws/Constitution); [SOE 2026 election facts](https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf); via `data/civic.js` | high |
| reg-29 | Registration closes 29 days before each election | [Fla. Stat. 97.055](https://www.flsenate.gov/Laws/Statutes/2026/97.055) | high |
| city-2027-reg-deadline | Registration for the Nov 2, 2027 city elections closes Mon, Oct 4, 2027 (computed) | [Fla. Stat. 97.055](https://www.flsenate.gov/Laws/Statutes/2026/97.055); via `data/civic.js` | high (computed) |
| city-2027-oviedo | Oviedo votes Nov 2, 2027 | [City of Oviedo elections](https://cityofoviedo.net/724/Elections); via `data/civic.js` | high |
| city-2027-expected | Lake Mary and Altamonte Springs expected Nov 2, 2027 | [Yahoo News](https://www.yahoo.com/news/articles/candidates-three-seminole-cities-win-125700315.html); via `data/civic.js` | med |
| ppp-2028 | Presidential primary Tue, Mar 21, 2028 | [Fla. Stat. 103.101](https://www.flsenate.gov/Laws/Statutes/2026/103.101); via `data/civic.js` | high |
| primary-2028 | Primary Tue, Aug 22, 2028 | [Fla. Stat. 100.061](https://www.flsenate.gov/Laws/Statutes/2026/100.061); via `data/civic.js` | high |
| general-2028 | General Tue, Nov 7, 2028 | [Fla. Stat. 100.031](https://www.flsenate.gov/Laws/Statutes/2026/100.031); via `data/civic.js` | high |
| celery-city | Sanford is the Celery City; celery first planted in 1896; on Lake Monroe | [Wikipedia: Sanford](https://en.wikipedia.org/wiki/Sanford,_Florida) | med |
| senator-tree | The Senator, about 3,500 years old, burned January 2012; its clone, The Phoenix, was growing there when the park reopened in March 2014; Lady Liberty about 2,000 years old | [Wikipedia: The Senator](https://en.wikipedia.org/wiki/The_Senator_(tree)) | med |
| sunrail-stations | 4 of SunRail's 17 stations are in Seminole | [SunRail stations](https://sunrail.com/stations/) | high |
| oviedo-chickens | Oviedo was known for chickens roaming downtown; they no longer wander the streets | [Wikipedia: Oviedo](https://en.wikipedia.org/wiki/Oviedo,_Florida) | med |
| i-voted-sticker | 2026 "I Voted" sticker: the county's first student-designed, by a sixth grader, chosen from 50+ entries | [SOE newsletter, May 2026](https://voteseminole.gov/wp-content/uploads/2026/05/Ballots-And-Beyond-Edition-7.pdf) | high |
| events-open | Events open to everyone 14 and up, member or not, any party or none | `data/events.js` policy.ages (draft chapter policy) | med (chapter must confirm) |
| dues | $20 a year, paid in January; non-voting path for those who can't pay | [ActBlue dues page](https://secure.actblue.com/donate/ydscdues); via report 00 | high |
| ages | Members are 14 to under 40 | [ActBlue dues page](https://secure.actblue.com/donate/ydscdues); via report 00 | high |
| tiktok-gpppa | TikTok political accounts: no ads, no monetization, no fundraising solicitation | [TikTok Newsroom, Sep 21, 2022](https://newsroom.tiktok.com/updating-our-policies-for-political-accounts?lang=en) | high |
| tiktok-branded | TikTok bars paid political ads and paid branded political content by creators | [TikTok ads policy](https://ads.tiktok.com/resources/help/article/tiktok-ads-policy-politics-government-and-elections?lang=en) | high |
| meta-siep | Meta: authorization plus a verified "Paid for by" label on political and social-issue ads | [Meta Transparency Center](https://transparency.meta.com/policies/ad-standards/SIEP-advertising/SIEP/) | high |
| fl-disclaimer-exempt | Florida's ad disclaimer exempts free posts and unpaid accounts where the source is clear; paid ads need "Pd. pol. adv." and the payer | [Fla. Stat. 106.143](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html); via report 06, 7.1 | high |
| usc-10307c | Paying or offering to pay for registering or voting in federal elections is a federal crime | [52 U.S.C. 10307 (Cornell LII)](https://www.law.cornell.edu/uscode/text/52/10307) | high |

Background research cited (for the "why," never as public copy): report 04 (Schein et al. on friend texting, Nickerson and Rogers on voting plans, Bond et al. on friends' influence, Skok on loop math, the Morning Consult and YPulse trend data), report 05 (voice), report 07 (right-wing benchmarks) and report 08 (Gen Z brand benchmarks).

---

## 13. Open questions and what isn't verified

**Corrections to the brief**

1. **The brief calls Dec 31 a "renewal deadline."** It's the date requests made before Nov 3 run out, not every request: under the state rule, one made after Nov 3 should already run through 2028. Seminole hasn't said how it's handling those, so this kit asks for a Jan 1 reminder ("renew in January") and flips to "renew now" only after confirmation **[mail-expiry] [mail-renew-jan1]**.
2. **The brief says "most young Seminole voters are independents."** The data says they're the biggest group, at 34.3%, which is a plurality and not a majority **[npa-18-40]**. The copy says "biggest group" throughout.

**Decisions for the chapter or counsel**

3. **Launch date.** The calendar assumes Wed, Dec 2. Confirm, or slide using the **[locked]** rule in section 2.
4. **Handles.** Only @youngsemdems on Instagram is listed (by Florida Young Democrats) for the chapter. The TikTok, X, Threads and Bluesky handles are unverified placeholders.
5. **Committee status and disclaimer** (counsel). This decides whether any boost is ever possible and what the bios and share cards must say.
6. **Draft policies the copy relies on** (chapter):
   - events open to anyone 14 and up, any party (gc07, V04, the carousel);
   - every event free and alcohol-free (carousel slide 6);
   - human review of every clip (gc09);
   - the shoutout rules.
7. **Rewind numbers.** Real 2026 counts are needed from the chapter by Dec 7, or cards 6 and 7 stay DEMO or get swapped out.
8. **Referral codes for teens.** Done: members under 18 always get random-style codes (assets/js/members.js), so a teen's first name never appears in a shared link. Adults get name-based codes (e.g. KIRA7QX) per `members.refCodeStyle`.
9. **`data/levels.js` XP for renewing a mail ballot.** Counsel should review it against vote-incentive rules **[usc-10307c]**. It has no money value, but it's worth a look.

**Things to recheck before they're used**

10. **Certified Nov 3 results.** Switch "about 54% to 45%, unofficial" to the certified figures once the Supervisor of Elections posts them (V03, carousel slide 2, Rewind card 2).
11. **The HB 991 lawsuit.** Recheck before Dec 9, Dec 22, Dec 31 and Jan 1.

**Not verified, or medium confidence**

12. **Cross-file Spanish.** This kit says "los Young Dems" (with the article, like `data/strings.js`); `data/levels.js`, `data/events.js` and `data/newsletter.js` sometimes drop it. Pick one when the Spanish lead reviews.
13. **Sound libraries.** Whether the chapter's TikTok and Instagram accounts get the full music library or only the commercial one depends on the account type; check in the app. The presets assume the restricted library.
14. **Medium-confidence facts:**
    - **[celery-city]**, **[senator-tree]** and **[oviedo-chickens]** rest on Wikipedia;
    - **[city-2027-expected]** rests on one news report;
    - **[mail-renew-jan1]** waits on the elections office.
15. **Platform specs** (WhatsApp sticker limits, safe zones) aren't verified here. Check each platform's current help pages before production.
16. **Posting times** (7 pm weekdays, 11 am weekends) are starting guesses, not findings.
