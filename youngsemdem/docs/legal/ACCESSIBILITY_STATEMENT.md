# Accessibility Statement (DRAFT)

> **DRAFT: not legal advice; have counsel review before launch.**
> Written Monday, November 9, 2026 for the youngsemdems demo site. The site has **not** had a
> full accessibility audit yet, so this statement describes our target, what we've built in, and
> what we know falls short. Update the "Known limitations" list after every `npm run check` and
> every manual test. *(proposal)* marks service levels for Kira and the board to confirm. The
> short bilingual page version lives in `data/legal.js` (`pages.accessibility`).

---

## The short version

- **Our goal:** every page meets **WCAG 2.2 Level AA**.
- **Where we are:** a demo, not yet fully tested. Some things don't work well yet, listed below.
- **Stuck?** Email `{privacyEmail}` and tell us the page and the problem. We'll reply within
  2 business days and fix it or get you the info another way within 10 business days
  *(proposal)*.
- **Voting deadline today?** Tell us it's urgent and we answer the same day. You can also call the
  Seminole County Supervisor of Elections at `{soePhone}`.

---

## 1. Our commitment

The Young Democrats of Seminole County want everyone in the county to be able to join, learn,
show up and post, including people who use screen readers, keyboards, switch devices,
captions, magnification, voice control or plain-language reading, and people who read in Spanish.

## 2. The standard we aim for

**Web Content Accessibility Guidelines (WCAG) 2.2, Level AA**, the W3C Recommendation (current
edition dated Dec 12, 2024: https://www.w3.org/TR/WCAG22/). WCAG 2.2 added criteria that matter
on a phone-first site like ours: Focus Not Obscured (2.4.11), Dragging Movements (2.5.7), Target
Size of at least 24 by 24 CSS pixels (2.5.8), Consistent Help (3.2.6), Redundant Entry (3.3.7) and
Accessible Authentication (3.3.8).

**Conformance status:** not yet assessed. We'll say "partially conforms" or "conforms" only after
an audit (automated plus manual) backs it up.

## 3. What we've built in

These are true of the site's code today (file references are for the team):

- **Automated checks on every page** at phone (390 x 844) and desktop (1440 x 900) sizes:
  missing alt text, missing page language, links and buttons without names, duplicate ids,
  heading order, tap-target size, sideways overflow, plus axe-core's serious and critical rules
  (`tools/check_site.js`, `npm run check`; `npm run check:strict` is the launch gate).
- **Video feed you can drive with a keyboard:** arrow keys or j/k to move, Space to play or pause,
  m for sound; buttons report their state to screen readers with `aria-pressed`
  (`assets/js/feed.js`).
- **No surprise motion:** clips never autoplay when your device asks for reduced motion or data
  saving, and they start muted (`feed.js`).
- **No puzzles to prove you're human.** The bot check (Cloudflare Turnstile, when it's on) works
  without a visual puzzle; at most it may ask you to tick a checkbox. Cloudflare states that
  Turnstile is WCAG 2.2 AA compliant (https://developers.cloudflare.com/turnstile/).
- **Text you can read in two languages.** Pages are built for English and Spanish
  (`site.locales: ['en', 'es']`), with the page language set so screen readers switch voices.
- **Captions** on every published member clip that has speech, corrected by a person before it
  goes up ([Clip Rules](MODERATION_POLICY.md)). Demo clips have no audio track; their on-screen
  text is also stored as text (`burnedInText` in `data/clips.js`) so pages can show it.
- **Untrusted text is shown as text**, so captions and names can't inject broken markup
  (`docs/infra/README.md`, "Rules for page code").
- **Works without the extras:** pages work from a plain file, without the service worker, and
  without the share or clipboard features when a browser lacks them.

## 4. Known limitations (Nov 9, 2026)

We know about these. Some are fixed before launch, some depend on other services.

1. **No full audit yet.** The demo pages are still being designed and built. No manual keyboard
   or screen-reader pass (VoiceOver on iPhone, TalkBack on Android, NVDA on Windows) has been done.
2. **Share cards are pictures.** The "I joined" and pledge cards are images drawn on a canvas. When
   you share one, the words in it are not readable by a screen reader unless the app you share to
   lets you add alt text. The same words are always on the page as text.
3. **Clips you post from your own device in the demo** have no captions, because uploads and
   captioning are off in the demo.
4. **Moving demo numbers.** In the demo, some counters tick up while the page is open, and
   simulated squad members appear over time. These must be pausable and announced politely, not
   on every change `[DESIGN: confirm before launch; WCAG 2.2.2 and 4.1.3]`. They disappear on the
   live site.
5. **Spanish is still being reviewed.** Spanish text needs review by a fluent human reviewer
   before launch. Some pages may be English only during the demo.
6. **Other services we link to are not ours.** ActBlue (donations and dues), Action Network
   (sign-ups), Mobilize (events), the Florida voter registration site, and the Seminole County
   Supervisor of Elections' sites and polling-place map have their own accessibility. If one of
   them blocks you, tell us and we'll help another way.
7. **Calendar files** (.ics) open in your calendar app, which controls how accessible they are.
8. **Video players from providers** (Mux or Cloudflare Stream) on the live site have not been
   tested yet.

## 5. Get help or ask for another format

Tell us what you need and we'll make it work: the information in plain text, large print, in
Spanish, read to you over the phone, or help filling in a form.

- **Email:** `{privacyEmail}` `[SET: a monitored inbox; consider a separate access@ alias]`
- **Phone or text:** `[PHONE: optional, if the club has a number]`
- **Include:** the page address, what you were trying to do, what happened, and the device,
  browser and assistive technology you use, if you know.

**Response times** *(proposal)*:

| | Time |
|---|---|
| We reply | within 2 business days |
| Fix, or the same info another way | within 10 business days |
| Time-sensitive voting question (a deadline today or tomorrow) | same day, pointing you to official help |

For accessible voting itself (accessible ballots, help at the polls, mail ballots), the official
source is the **Seminole County Supervisor of Elections**: https://voteseminole.gov/, phone
`{soePhone}` (number checked Nov 9, 2026, in `YSD_CONFIG.links.vote.countyPhone`).

## 6. Not happy with our answer?

Ask for your message to go to the YDSC president or board, and we'll answer in writing within
10 business days *(proposal)*.

## 7. How we test

- Before launch: `npm run check:strict` with zero errors, then a manual keyboard pass and a
  screen-reader pass on join, share, clips, events and voting info.
- After launch: the automated check on every deploy, and a manual pass each quarter and before
  each election *(proposal)*.
- We review this statement every January and whenever a big feature ships.

## 8. Compatibility

Built for current versions of Safari (iPhone and Mac), Chrome (Android and desktop), Firefox and
Edge. Older browsers get a simpler experience: the pages still load, some extras turn off.

---

**Sources** (checked Nov 9, 2026): W3C, WCAG 2.2 (https://www.w3.org/TR/WCAG22/); W3C WAI,
Developing an Accessibility Statement (https://www.w3.org/WAI/planning/statements/), which
recommends a commitment, the standard used, contact details, known limitations and the measures
taken. Repo: `tools/check_site.js`, `assets/js/feed.js`, `assets/js/config.js`, `data/clips.js`,
`docs/infra/tooling.md`.
