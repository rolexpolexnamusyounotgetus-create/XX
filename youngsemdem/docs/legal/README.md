# docs/legal: policy drafts for the youngsemdems site

> **DRAFT: not legal advice; have counsel review before launch.**
> Drafted Monday, November 9, 2026 by the policy workstream. Every legal citation below was read
> at its source on Nov 9, 2026 (2026 Florida Statutes on Online Sunshine, Cornell LII for federal
> law, agency and vendor pages). Nothing here is in effect, and none of it has been reviewed by a
> lawyer or by a fluent Spanish reviewer yet.

## What's here

| File | What it is | Audience |
|---|---|---|
| `PRIVACY_DRAFT.md` | Full privacy policy draft, including SMS terms and retention | Counsel, the YDSC board, Kira |
| `MINORS_POLICY.md` | Teen Safety Policy: ages, photos and video of minors, DMs and texts, events, reporting | Counsel, the board, every adult volunteer |
| `MODERATION_POLICY.md` | Clip Rules: what's welcome, what's removed, review times, reports, strikes, appeals, DMCA | Counsel, moderators |
| `ACCESSIBILITY_STATEMENT.md` | WCAG 2.2 AA target, what's built in, known limitations, how to get help, response times | Counsel, design, the public |
| `../../data/legal.js` | Short, page-ready versions of all four in **English and Spanish**, plus form copy and the 106.143 disclaimer placeholder (`window.YSD_DATA.legal`) | Page builders |

The `.md` files are the long versions with citations and `[BRACKETED]` open items. `data/legal.js`
is what pages render. **Change the `.md` first, then mirror it in `data/legal.js`, and bump
`updated` there.**

## How to use it on pages

1. **Load it** like any data file, after `config.js`:
   `<script src="data/legal.js"></script>`. It is a classic script with no functions and no
   network calls, and it parses in Node with a stub `window` (tested; see "Tests").
2. **Make four pages** (design owns the markup; suggested slugs are in each page's `slug`):
   `privacy.html`, `teen-safety.html`, `content-policy.html`, `accessibility.html`. Render
   `title`, `tldr` (as "The short version"), then each `section` (`heading` plus `body` blocks:
   `p`, `list`, `steps`, `note`, `links`). Use `section.id` as the anchor. Show `banner` at the top
   while `status === 'draft'`, and `labels.notYetEffective` while `effective` is `''`.
3. **Fill tokens** (`{org}`, `{orgShort}`, `{minAge}`, `{privacyEmail}`, `{mailingAddress}`,
   `{smsNumber}`, `{dmcaAgent}`, `{soePhone}`) from `YSD_CONFIG` with the 8-line `legalText()`
   helper in the header of `data/legal.js`. Unset values fall back to visible
   `[... set before launch]` placeholders, which is deliberate for the demo.
4. **Render as text.** Strings are plain text: use `textContent`. Link `links[].page` to that page's
   `slug` (resolve against `YSD.root`), and `links[].href` as-is.
5. **Footer:** link the four pages in `order` with each page's `short` label on every page, plus
   `snippets.demoNotice` while `YSD_CONFIG.demo` is true. The paid-for line still comes from
   `YSD_CONFIG.legal.paidFor` (core owns it); `disclaimer.placeholder` shows counsel the shape.
6. **Forms** (copy is in `snippets`):
   - Join: `ageLabel` and `ageHint` (a neutral age screen: free entry, no hint at the minimum, no
     pre-fill), `ageTooYoung` after `validate()` returns `too_young`, `guardianLabel` and
     `guardianHint` when age is 14 to 17, `emailConsent`, `smsConsent.label` (unchecked by default;
     hide for under-18s and show `smsConsent.teenNote`), and `joinNotice` linking to the privacy
     page. Send `smsConsent.version` and the exact label shown with the join so the server can
     store the consent record.
   - Clip upload: the three `uploadConsent` boxes (all required), the `minorsInClip` question with
     `guardianContact` when the answer is yes, and `uploadPending` after upload.
   - Each clip: a `report` control with the `reasons` list.
   - Privacy page and join confirmation: a `forgetMe` button that calls `YSD.members.forget()` and
     `YSD.clips.reset()`.
   - Events: `eventPhotoNotice` on RSVP pages and check-in signs, `safetyLine` on event pages.

**Spanish.** Spanish uses informal *tú*, matching the voice guide's toggle copy ("¿Prefieres leer
en español?"). It was written in full, not machine-translated, but it still needs a fluent human
reviewer before launch (`reviewedSpanish: false`). STOP and HELP stay in English in the SMS copy;
ask the texting provider whether Spanish keywords are also honored before adding any.

## Claims and the code behind them

The policies promise only what the code does today, or they flag the gap. Check this table again
whenever one of these files changes.

| Policy claim | Where it's true | Status |
|---|---|---|
| Demo sends nothing (joins, counters, uploads, analytics) | `members.js` `submit()` returns `mode: 'demo'`; `clips.js` `uploadEnabled()`; `track.js` `enabled()`; `store.js` counters | True |
| Under-14 ages are rejected and nothing is stored | `members.validate()` sets `errors.age = 'too_young'`; `join()` throws before `sset('member')` | True |
| Honeypot: bots' joins are not stored or sent | `members.join()` `_hp` / `bot-field` branch | True |
| Join payload fields | `members.js` `formPayload()` and `anPayload()` (adds ref code, referrer, page, utm_*) | True |
| Phone is "subscribed" only when the SMS box is ticked | `anPayload()`: `status: m.smsOptIn ? 'subscribed' : 'unsubscribed'` | True |
| Contact details removed from the browser after a live submit | `markSynced()` deletes email, phone, ZIP unless `members.keepContactLocally` | True |
| Site code sets no cookies | No `document.cookie` anywhere in `assets/js/` | True (re-check if a script is added) |
| Browser storage list | `docs/infra/README.md`, "Storage names already taken" | True |
| Invite code counts for 30 days | `share.attributionDays: 30` | True |
| Invite code = up to 5 letters of first name + random | `members.makeRefCode()`, `members.refNameMax: 5` | True |
| Squad shows first name + last initial | `members.squad()` | True; **teen first-name-only is a proposal, not built** |
| Analytics drop personal-data keys | `track.js` `clean()` and its `PII` list | True |
| Do Not Track and GPC turn analytics off | `track.js` `dnt()` with `respectDoNotTrack: true` | True |
| Custom analytics endpoint receives the ref code that brought the visitor; Plausible would keep `?ref=` as a source | `track.js` `rec.ref`; Plausible query-parameter docs | True: disclosed (question P4) |
| Uploads held as `review: pending`; no public listing | `functions/api/video-upload.js` metadata; `docs/infra/video.md` | True; review queue **not built** |
| Clip limits: 150 MB, 3 minutes | `YSD_CONFIG.clips`, `VIDEO_MAX_*` env vars | True |
| Turnstile on uploads | `TURNSTILE_SECRET_KEY` in the upload function | Optional; off until configured |
| "Forget me" wipes browser data | `YSD.members.forget()`, `YSD.clips.reset()` | Functions exist; **button not built** |
| Feed never autoplays under reduced motion or data saver; keyboard controls | `feed.js` `reducedMotionOn()`, `saveDataOn()`, key handling | True |
| Automated accessibility checks | `tools/check_site.js` (axe-core, 390 and 1440 px) | True |
| Demo clips have no audio; on-screen text stored as text | `data/clips.js` `audio: false`, `burnedInText` | True |

**Promised but not built yet** (each is a launch blocker for the feature it covers):

1. Server-side SMS consent records (timestamp, IP, exact text and version, page, phone) and a texting provider.
2. Guardian contact field on the join form for ages 14 to 17; guardian consent tracking for clips.
3. Teen first-name-only display in squads (`members.js` and the squad endpoint).
4. "Forget me" button; Report control on clips; clip review queue, approved list (`/api/clips`) and decision notices.
5. Location metadata stripping for still photos (video is re-encoded by the provider).
6. `legal.privacyEmail`, a mailing address and a DMCA agent. Suggested new config keys for core:
   `legal.mailingAddress`, `legal.smsNumber`, `legal.dmcaAgent` (tokens already read them).

## Proposals for Kira and the board

These numbers make the drafts read complete. They are choices, not legal requirements.

| Topic | Proposal |
|---|---|
| Clip review | Decision within 3 days |
| Urgent reports (threats, doxxing, minors, sexual content) | Hide at once, review within 24 hours |
| Takedown on request | Own clip or clip showing you: 3 days. Anything showing a minor: 24 hours |
| Appeals | File within 14 days; two other moderators answer within 7 days |
| Strikes | Repeated problems pause uploads for 30 days |
| Privacy requests | Reply within 3 business days, finish within 30 days |
| Accessibility requests | Reply within 2 business days; fix or alternative within 10; voting deadlines same day |
| Retention | Members until 2 years inactive (January review); SMS consent 5 years after last text; declined clips 30 days; published clips 2 years; guardian forms while content is up + 1 year; reports 1 year |
| SMS | Up to 4 a month; **no texts to under-18s at launch**; 9:00 am to 8:00 pm only if teen texting is ever approved |
| Teens | Guardian consent for photos, clips, off-site events; two-adult rule (adults 21+); background checks for regular youth leads; no minors in fundraising imagery |
| Moderators | At least two, one an officer; quarterly totals published |

## Open questions for counsel

**Entity and disclaimer**
- **C1.** Which legal entity runs the site and controls member data: YDSC as an unincorporated
  club, a registered political committee, or the Seminole County Democratic Executive Committee?
  The privacy policy, SMS registration and DMCA agent all need that name.
- **D1.** Final Fla. Stat. 106.143(1)(c) wording, payer name and address, and the in-kind
  statement. Does the site carry express advocacy that makes pages "political advertisements"
  (106.011(15) requires a *paid* expression)? Is the club over the $500 political committee
  threshold (106.011(16))?
- **D2.** For Spanish pages, may the disclaimer be given only in Spanish (106.143(9) allows the
  required information "in the language used"), and is "Anuncio político pagado" acceptable, or
  should the English "pd. pol. adv." stay?
- **D3.** Do member clips the club shares or boosts need the disclaimer? Does Fla. Stat. 106.145
  (AI disclaimer) reach a member's clip republished by the club?

**Privacy and SMS**
- **P1.** Does the Florida Telephone Solicitation Act (501.059, "telephonic sales calls") reach dues
  or donation texts? We treat them as needing written consent anyway.
- **P2.** Does the YDSC charter, the county party, Florida Young Democrats or Young Democrats of
  America require sharing the roster? The draft promises no sharing without a yes.
- **P3.** The FCC's consent-revocation order (FCC 26-67, published Oct 26, 2026 at 91 FR 67219)
  reportedly takes effect Nov 25, 2026 and lets senders designate exclusive opt-out methods;
  the 10-business-day honor period is unchanged **[med: law-firm summary, primary text not read]**.
  Anything to change in the SMS terms?
- **P4.** Should referral codes (which start with a member's first name) be treated as personal
  data? Two leaks to decide on: `track.js` sends `ref` to a custom endpoint, and Plausible keeps
  the `?ref=` query parameter as a traffic source (https://plausible.io/docs/custom-query-params),
  so its reports would list visits per member code. Fix options for core: drop `ref` from custom
  events, and rename `share.refParam` (for example to `invite`) so Plausible strips it.
- **P5.** Florida's breach law (501.171) covers "commercial" entities. The draft commits to its
  30-day notice anyway. Agree?
- **P6.** Retention: is 5 years for SMS consent records right, given the 4-year federal default
  (28 U.S.C. 1658) and the FTSA?

**Minors**
- **M1.** Is guardian consent needed for 14- to 17-year-olds just to join and receive email? The
  draft says no (minimal data, no texts), and yes for photos, clips, travel and texts.
- **M2.** Does Fla. Stat. 540.08 (parent consent for a minor's likeness used for "trade" or
  "commercial or advertising" purposes) reach recruiting or fundraising posts by a political club?
  The draft asks for guardian consent for every post either way.
- **M3.** Can a 14- to 17-year-old give TCPA consent alone? Should the club ever text minors?
- **M4.** Background checks: which provider, what consent forms, and who must be screened?
- **M5.** Can minors pay dues through ActBlue, and do contribution rules for minors apply to dues?
  (Not researched.)
- **M6.** Confirm 501.1736 (HB 3) does not reach the site, given the Oct 14, 2026 Eleventh Circuit
  decision **[med: news reports]**, and that 501.1735 (online platforms "predominantly accessed by
  children") does not either.

**Moderation**
- **R1.** Is a club site that stores uploads through Mux or Cloudflare a "provider" under
  18 U.S.C. 2258A/2258E(6)? The draft commits to reporting to NCMEC either way and preserving
  only as the law requires.
- **R2.** DMCA agent: whose name and address? Register ($6, renews every 3 years) before uploads open.
- **R3.** Any Section 230 or defamation guidance for moderators deciding on clips about
  candidates?

## Open questions for Kira

1. Approve or change the proposals table above, especially "no texts to under-18s at launch".
2. Page names: "Teen Safety Policy" and "Clip Rules" (friendlier) vs. "Minors Policy" and
   "Content Policy". Slugs can change in `data/legal.js`.
3. Who are the youth safety officer, the moderators and the privacy contact? A shared inbox
   (privacy@ or hello@) should exist before launch.
4. Who is the fluent Spanish reviewer, and should Spanish follow Puerto Rican usage?
5. Should the tests in the scratch check below move into `tests/infra/` (tooling owns that folder)?

## Tests

A Node check (written for this workstream, kept out of the repo so it doesn't collide with other
workstreams' tests) loads `data/legal.js` in a bare `vm` context with a stub `window`, runs
`node --check`, and verifies: JSON-clean data with no functions; every string has non-empty `en`
and `es` with no HTML and the same tokens in both; every `{token}` is defined and every token is
used; blocks have exactly one known key; page links resolve and hrefs are `https:` or `tel:`;
section ids are unique; every page's sources resolve and every source is used; the draft banner
wording; the SMS consent copy includes STOP, HELP, rates and frequency in both languages; the
confirmation text fits 160 characters; and token filling works against the real `config.js`. On
Nov 9, 2026: **2,417 checks passed, 0 failed; 253 bilingual strings; 37 sources.**

Quick manual check from the site root:

```sh
node -e "const vm=require('vm'),fs=require('fs');const w={};vm.runInNewContext(fs.readFileSync('data/legal.js','utf8'),{window:w});const L=w.YSD_DATA.legal;console.log(L.status,Object.keys(L.pages).join(' '))"
```

## Sources (all read Nov 9, 2026)

**Florida Statutes (2026 edition, Online Sunshine)**
- 106.143, political advertisements: (1)(c) wording, payer, in-kind; (9) other languages; (10) internet exemptions. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html
- 106.011, definitions: (4) communications media incl. the Internet; (15) political advertisement (paid, express advocacy); (16) political committee, over $500. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.011.html
- 106.145, generative AI disclaimer in political ads. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.145.html
- 104.0615(3)(b), (5), false information to deter voting, third-degree felony. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0104/Sections/0104.0615.html
- 97.041(1)(b), pre-registration at 16. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html
- 97.0575, third-party voter registration organizations. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.0575.html
- 743.07(1), age of majority 18. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0743/Sections/0743.07.html
- 540.08(1), (4), (6), name or likeness; parent or guardian consent for minors. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0540/Sections/0540.08.html
- 934.03(2)(d) and 934.02(2), all-party consent; public meetings excluded. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html · http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.02.html
- 562.11(1)(a), alcohol and persons under 21. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0562/Sections/0562.11.html
- 39.201(1)(a), any person must report suspected child abuse to the central abuse hotline. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0039/Sections/0039.201.html
- 501.1736, social media use for minors (four-part platform test). http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1736.html
- 501.1735, protection of children in online spaces (history ch. 2026-52). http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1735.html
- 501.171, Florida Information Protection Act. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html
- 501.702(9), Florida Digital Bill of Rights controller definition. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.702.html
- 501.059, Florida Telephone Solicitation Act. http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.059.html

**Federal law and agencies**
- 16 CFR 312.2 (COPPA definitions). https://www.law.cornell.edu/cfr/text/16/312.2
- FTC, Complying with COPPA: FAQ (B.5 nonprofits; H.3 neutral age screens; H.6 actual knowledge; Rule amended Apr 22, 2025). https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- 47 CFR 64.1200(a)(1)(iii), (a)(10), (a)(12) (TCPA). https://www.law.cornell.edu/cfr/text/47/64.1200
- FCC 26-67 summary (Nelson Mullins) **[med]**. https://www.nelsonmullins.com/insights/alerts/fcc-download/all/fcc-adopts-overhaul-of-tcpa-consent-revocation-rules-revoke-all-narrowed-exclusive-opt-out-methods-permitted-and-fraud-alert-exemption-expanded
- FTC, CAN-SPAM compliance guide. https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- 18 U.S.C. 2258A and 2258E. https://www.law.cornell.edu/uscode/text/18/2258A · https://www.law.cornell.edu/uscode/text/18/2258E
- 28 U.S.C. 1658(a). https://www.law.cornell.edu/uscode/text/28/1658
- US Copyright Office, DMCA designated agent FAQ. https://www.copyright.gov/dmca-directory/faq.html

**Industry, standards and services**
- CTIA Messaging Principles and Best Practices (May 2023; text extracted and read). https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf
- W3C, WCAG 2.2 (Recommendation, Dec 12, 2024 edition). https://www.w3.org/TR/WCAG22/
- W3C WAI, Developing an Accessibility Statement. https://www.w3.org/WAI/planning/statements/
- Florida DCF, Abuse Hotline (1-800-962-2873; web reporting). https://www.myflfamilies.com/services/abuse/abuse-hotline
- NCMEC CyberTipline. https://report.cybertip.org/
- 988 Suicide & Crisis Lifeline. https://988lifeline.org/
- ActBlue Privacy Policy (effective Oct 1, 2026). https://www.actblue.com/legal-privacy/
- Action Network Privacy Policy (revised Feb 26, 2026). https://actionnetwork.org/privacy
- Cloudflare Web Analytics. https://developers.cloudflare.com/web-analytics/about/
- Plausible data policy, and custom query parameters (keeps `ref`, `source` and `utm_*`). https://plausible.io/data-policy · https://plausible.io/docs/custom-query-params
- Cloudflare Turnstile Privacy Addendum (June 18, 2025) and overview. https://www.cloudflare.com/turnstile-privacy-policy/ · https://developers.cloudflare.com/turnstile/
- Florida HB 3 litigation, news report **[med]**. https://floridaphoenix.com/2026/10/14/appeals-court-lifts-block-on-florida-law-restricting-social-media-access-for-teens/

**Repo**
- `assets/js/config.js`, `store.js`, `members.js`, `track.js`, `share.js`, `clips.js`, `feed.js`,
  `sw.js`, `functions/api/video-upload.js`, `docs/infra/*.md`, `DEPLOY.md`,
  `docs/research/06-tech-portability-compliance.md` (sections 3.2, 5.1, 6 and 7),
  `docs/research/02-young-dem-websites.md` (YDSC ages 14 to under 40, dues).
