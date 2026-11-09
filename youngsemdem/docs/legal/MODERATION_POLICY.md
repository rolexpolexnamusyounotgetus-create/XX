# Clip Rules: content and moderation policy for member clips (DRAFT)

> **DRAFT: not legal advice; have counsel review before launch.**
> Written Monday, November 9, 2026. Not in effect: member uploads are off in the demo. Text in
> `[BRACKETS]` is a placeholder or an open decision; *(proposal)* marks numbers for Kira and the
> board to confirm. The short bilingual page version lives in `data/legal.js` (`pages.moderation`).
> Suggested public URL: `content-policy.html`.

Members can post short vertical clips (up to 3 minutes and 150 MB, per `YSD_CONFIG.clips`) with a
caption, tags and a handle. These rules say what's welcome, what we remove, how review works, and
how to report or appeal.

---

## The short version
<!-- synced word for word with data/legal.js pages.moderation.tldr (EN), Nov 9, 2026. Numbers the sections
     below mark *(proposal)* are still proposals for Kira and the board. Edit both together. -->

- A real person checks every clip before anyone else sees it.
- Bring your voice: opinions, recaps, explainers, jokes, Spanish, all welcome. Disagreeing with politicians, Democrats included, is fine.
- We remove harassment, doxxing, lies about how to vote, impersonation, hate, sexual content, and anything showing a minor without a guardian's OK.
- Review takes up to 3 days. Reports about safety or minors: within 24 hours.
- Report with the Report button or `{privacyEmail}`. Appeal within 14 days.

---

## 1. How does review work?
<!-- page: content-policy.html#moderation-review -->

1. **Checks in your browser.** The site only accepts video files (MP4, MOV, WebM and similar), up
   to 150 MB and 3 minutes (`YSD.clips.validate()`, `check()`).
2. **Bot check.** When Turnstile is on, the upload needs a passing check
   (`functions/api/video-upload.js`, `TURNSTILE_SECRET_KEY`).
3. **Held for review.** Every upload is tagged `review: pending` with the video provider. Nothing
   lists uploads publicly; you see only your own clips until approval
   (`docs/infra/video.md`, "Moderation").
4. **Human decision.** A trained moderator watches the whole clip with sound, reads the caption and
   tags, and approves, asks for a change, or declines. Automated screening tools from our video
   provider may flag clips, but a person always makes the call. Moderators never review their own
   clips or clips from people they're close to.
5. **Captions.** Every approved clip with speech gets captions, machine-made and then corrected by
   a person, before it goes public (see the [Accessibility Statement](ACCESSIBILITY_STATEMENT.md)).
6. **Clips with minors** wait for guardian consent ([Teen Safety Policy](MINORS_POLICY.md),
   section 3.5).

**Turnaround** *(proposal)*: a decision within **3 days** of upload, usually sooner. In the two
weeks before an election, clips about voting get priority. We'll tell you the result on the site
or by email. `[BUILD: the review queue, the approved-list endpoint (/api/clips) and decision
notices do not exist yet; see docs/infra/video.md.]`

## 2. What can I post?
<!-- page: content-policy.html#moderation-welcome -->

- Your take on local and national issues, why you vote, why you joined.
- Event recaps, canvass and tabling clips, behind-the-scenes, trivia night chaos.
- Explainers that point to official sources for voting info.
- Humor, memes, parody and satire that are clearly labeled as such.
- Criticism of public officials, candidates and parties, including Democrats.
- Spanish, Spanglish, Haitian Creole, any language. We may ask for a translation to review it.
- Music, footage and images you made or have the rights to use.

## 3. What gets taken down?
<!-- page: content-policy.html#moderation-removed -->

1. **Harassment and threats.** Bullying, targeted insults, piling on, threats of violence, or
   encouraging others to harass someone. Public figures can be criticized; they can't be
   threatened.
2. **Doxxing and private info.** Home addresses, phone numbers, personal emails, license plates,
   school or workplace of private people, voter-record details, or anything that helps someone
   find a person who doesn't want to be found. That includes your own info in captions.
3. **False info about voting procedures.** Wrong dates, places, hours, ID or eligibility rules,
   mail-ballot steps, "vote by text" hoaxes, or claims meant to keep people from voting. In
   Florida, knowingly using false information to get someone not to vote or register is a
   third-degree felony
   ([Fla. Stat. 104.0615(3)(b), (5)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0104/Sections/0104.0615.html)).
   We may approve a clip about voting only if it links to or matches an official source
   (`YSD_CONFIG.links.vote`: the Florida Division of Elections and the Seminole County Supervisor
   of Elections).
4. **Impersonation.** Pretending to be another person, a candidate, an election official, YDSC,
   the county party or any organization. Parody accounts and clips must say "parody" clearly.
5. **Deceptive AI and deepfakes.** Synthetic or AI-edited video or audio that makes a real person
   appear to say or do something they didn't. Florida requires a disclaimer ("Created in whole or
   in part with the use of generative artificial intelligence (AI).") on political ads with such
   content made to injure a candidate or deceive voters
   ([Fla. Stat. 106.145](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.145.html)).
   We don't approve deceptive deepfakes at all. Obvious, labeled edits (filters, captions, a
   clearly fake meme) are fine.
6. **Hate.** Attacks on people for race, ethnicity, national origin, immigration status, religion,
   sex, gender identity, sexual orientation, disability, age or serious illness. Slurs, dehumanizing
   language, hateful symbols.
7. **Sexual content and nudity.** None. Any sexual content involving a minor is removed at once,
   preserved only as the law requires, and reported to NCMEC's CyberTipline (section 7).
8. **Minors without consent.** Anyone under 18 who can be recognized, without the guardian consent
   in the [Teen Safety Policy](MINORS_POLICY.md). Also no last names, school identifiers or
   location tags for minors, even with consent.
9. **Violence and danger.** Gore, glorifying violence, dangerous stunts, self-harm content (if
   you're struggling, call or text **988**, the Suicide and Crisis Lifeline).
10. **Illegal activity.** Selling drugs or weapons, underage drinking, vandalism, or anything that
    breaks the law.
11. **Secret recordings.** Recording someone's private conversation without everyone's consent
    (Florida generally requires all parties' consent:
    [Fla. Stat. 934.03(2)(d)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html)).
    Speeches and public meetings are fine.
12. **Copyright.** Music, shows, or other people's footage you don't have rights to. TikTok and
    Instagram sounds are licensed for those apps, not for our site.
13. **Spam and scams.** Ads, links to sell things, crypto, giveaways, chain posts, or fundraising for
    other causes or candidates unless the board approved it.
14. **Fake engagement.** Buying likes or views, or posting the same clip over and over.

Clips that break a rule are declined (before they go up) or removed (after). If only part of a
clip is a problem, we may ask you to trim, blur or recaption it instead. We don't edit your words
for you.

## 4. How do I report a clip?
<!-- page: content-policy.html#moderation-report -->

- Tap **Report** on any clip `[BUILD: add a report control to the feed; feed.js exposes data-feed-*
  hooks]`, or email `{privacyEmail}` with the clip link and what's wrong.
- Reports can be anonymous. We never tell the uploader who reported.
- **Response times** *(proposal)*:
  - Threats, doxxing, a minor shown without consent, sexual content, or someone in danger:
    we hide the clip as soon as we see the report and review within **24 hours**.
  - Everything else: within **3 days**.
- **If someone is in danger, call 911 first.** Suspected child abuse goes to the Florida Abuse
  Hotline, 1-800-962-2873 ([Fla. Stat. 39.201](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0039/Sections/0039.201.html)).
- **People in a clip** can ask us to take it down even if no rule was broken. If it shows you, we
  remove it within 3 days; if it shows a minor, within 24 hours *(proposal)*.

## 5. What if I break a rule?
<!-- page: content-policy.html#moderation-strikes (the page puts strikes and appeals under one heading: "What if I break a rule, or think you got it wrong?") -->

| What happened | What we do |
|---|---|
| First minor problem | Clip declined or removed, with a note explaining which rule |
| Repeated problems | Uploads paused for 30 days *(proposal)* |
| Serious harm (threats, doxxing, sexual content, deceptive voting info, content with minors without consent) | Upload access removed right away; we may report to the authorities |

## 6. What if I think you got it wrong?
<!-- page: content-policy.html#moderation-strikes -->

- Disagree with a decision? Reply to the decision notice or email `{privacyEmail}` within
  **14 days**. Say why you think we got it wrong.
- **Two moderators who weren't part of the first decision** review it and answer within **7 days**
  *(proposal)*. Their decision is final.
- Appeals are not available for content we must remove or report by law.

## 7. What about copyright and the law?
<!-- page: content-policy.html#moderation-copyright -->

- **Child sexual abuse material.** Federal law requires "providers" of electronic communication or
  remote computing services that learn of apparent child sexual exploitation to report it to
  NCMEC's CyberTipline as soon as reasonably possible, and treats a report as a request to preserve
  the material for one year
  ([18 U.S.C. 2258A](https://www.law.cornell.edu/uscode/text/18/2258A),
  [2258E(6)](https://www.law.cornell.edu/uscode/text/18/2258E)). Whether a club site that stores
  uploads through Mux or Cloudflare is a "provider" is a question for counsel; we report either
  way (https://report.cybertip.org/).
- **Copyright (DMCA).** To use the DMCA safe harbor for stored user content, a site designates an
  agent with the US Copyright Office: $6 per designation, and it expires after 3 years unless
  renewed ([Copyright Office FAQ](https://www.copyright.gov/dmca-directory/faq.html);
  17 U.S.C. 512(c)(2)). Our agent: `[DMCA AGENT NAME, ADDRESS, EMAIL: register before uploads go
  live]`. Send notices there with the clip link, the work you own, your contact details and a
  good-faith statement. Uploaders can send a counter-notice. Repeat infringers lose upload access.
- **Political ads.** A clip the club pays to boost, or that expressly advocates for a candidate or
  issue and is paid for, can be a "political advertisement" that needs the Fla. Stat. 106.143
  disclaimer ([106.011(15)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.011.html)).
  We don't boost member clips without the disclaimer `[COUNSEL: README, question D3]`.
- **Law enforcement** requests go to the board and counsel. We share only what the law requires.

## 8. Moderator norms
<!-- not on the public page (content-policy.html) -->

- At least two trained moderators on the rota; one is an officer *(proposal)*.
- Moderators follow this policy and the Teen Safety Policy, keep a short log of each decision
  (clip id, rule, date, moderator), and keep reporters' names private.
- No moderating your own clips, your friends', or anyone you have a conflict with.
- Moderators can step away from disturbing content and hand it to someone else. Nobody reviews
  sexual content involving minors: hide it, report it, and tell the board.
- Each quarter we post simple totals: clips reviewed, approved, declined, removed, appeals
  *(proposal)*.

---

**Sources** (checked Nov 9, 2026): Fla. Stat. 104.0615, 106.145, 934.03, 39.201, 106.011 (2026
Florida Statutes, Online Sunshine); 18 U.S.C. 2258A and 2258E (Cornell LII); US Copyright Office
DMCA Designated Agent FAQ; NCMEC CyberTipline. Repo: `assets/js/clips.js`,
`functions/api/video-upload.js`, `docs/infra/video.md`.
