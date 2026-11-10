# Teen Safety Policy: members under 18 (DRAFT)

> **DRAFT: not legal advice; have counsel review before launch.**
> Written Monday, November 9, 2026. Not in effect. Text in `[BRACKETS]` is a placeholder or an open
> decision. Items marked *(proposal)* are our suggested rules for Kira and the YDSC board to adopt,
> change or drop. The short bilingual page version lives in `data/legal.js` (`pages.minors`).

YDSC's own rule is that members are **14 to under 40** (YDSC dues page on ActBlue, cited in
`docs/research/02-young-dem-websites.md`; mirrored in `assets/js/config.js` as `org.minAge: 14`).
So some members are teenagers. This policy is how we keep them safe online and at events. It
applies to every YDSC officer, volunteer and member, and to anyone under 18 who shows up in our
photos, clips or events, member or not.

---

## The short version
<!-- synced word for word with data/legal.js pages.minors.tldr (EN), Nov 9, 2026. Numbers the sections
     below mark *(proposal)* are still proposals for Kira and the board. Edit both together. -->

- Under 14? You can't join yet. Our club starts at 14, and we never collect info from anyone under 13.
- Teens 14 to 17 are welcome to join, learn, volunteer and come to events.
- No last names, no schools, no locations in anything we post that shows a teen.
- A parent or guardian says yes before we post a photo or clip where a teen can be recognized.
- No one-on-one DMs between adult organizers and teen members. Group chats with two adults, always.
- Two adults at anything teens attend. No adult is ever alone with a teen.
- No alcohol for anyone under 21.

---

## 1. Who can join?
<!-- page: teen-safety.html#minors-ages -->

| Age | Status |
|---|---|
| Under 13 | Not accepted. We don't collect any info. |
| 13 | Not accepted (below the club's minimum of 14). |
| 14 to 17 | Welcome as members, with the protections in this policy. |
| 18 and up | Adult members. Adults who work with teens follow this policy too. |

**Why 13 matters.** The federal Children's Online Privacy Protection Act (COPPA) and the FTC's rule
define a child as **anyone under 13** ([16 CFR 312.2](https://www.law.cornell.edu/cfr/text/16/312.2)).
COPPA "applies to commercial websites and online services"; nonprofits are generally outside it,
but the FTC encourages them to give children the same protections
([FTC COPPA FAQ, B.5](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)).
We go further: our minimum age is 14.

**How the site checks.** The join form asks for age (or birth year) as a free-entry field, which is
what the FTC calls a neutral age screen; a "13+ only" drop-down or an "I am over 12" checkbox
would not be neutral (FTC COPPA FAQ, H.3). If the age is under 14, the form shows a friendly
message and stores nothing (`members.validate()` returns `too_young` before anything is saved).
`[DESIGN: do not pre-fill the age or offer only allowed ages; do not tell people which number to
type.]` If we ever learn we hold info from someone under 13, we delete it right away.

**Why 18 matters.** In Florida the "disability of nonage" ends at 18
([Fla. Stat. 743.07(1)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0743/Sections/0743.07.html)),
so a parent or legal guardian gives consent for a minor wherever this policy asks for consent.

## 2. How does joining work at 14 to 17?
<!-- page: teen-safety.html#minors-joining -->

- Teens join with the same short form as everyone: first name, email or phone, and the optional
  fields. Nothing extra is required just to join and get emails.
- We ask for a **parent or guardian contact** (name and email or phone) only when a teen wants to
  do something that needs it: appear in a photo or clip, travel to an off-site event, or receive
  texts *(proposal)*. `[BUILD: the join form has no guardian field yet. Add an optional
  "guardian email" field shown when age is 14 to 17; members.js keeps extra form fields as-is.]`
- **Referral squads show teens by first name only** *(proposal)*. Today the squad shows a first
  name and last initial for everyone. `[BUILD: members.js and the squad endpoint need an
  age-aware display name.]`
- **Dues and money.** We never aim donation asks at members under 18. A teen who can't or
  shouldn't pay dues can use the club's non-voting membership path (YDSC dues page).
  `[COUNSEL: can 14- to 17-year-olds pay dues through ActBlue, and do any contribution rules for
  minors apply to dues? Not researched for this draft.]`

## 3. What are the rules for photos and video of teens?
<!-- page: teen-safety.html#minors-photos -->

These rules cover club accounts, the website, the clip feed, share cards, flyers and anything a
YDSC volunteer posts "for the club". They apply whether a teen is a member or not.

1. **Consent first.** Before we post a photo or clip where someone under 18 can be recognized, we
   need (a) the teen's own OK and (b) written consent from a parent or legal guardian. A form,
   an email reply or a signed sheet counts. We keep the consent with the photo's record.
   - *Why:* Florida law already requires a parent's or guardian's consent to use a minor's name or
     likeness "for purposes of trade or for any commercial or advertising purpose"
     ([Fla. Stat. 540.08(1), (6)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0540/Sections/0540.08.html)).
     Fundraising and recruiting posts can look like advertising, and we would rather not argue
     about the line, so we ask every time.
2. **No last names.** Ever. First name only, or no name.
3. **No school identifiers.** No school names, mascots, logos, uniforms, ID badges, school buildings
   or signs, team jerseys, grade levels or class schedules in the image, caption or tags.
4. **No location tagging.** No geotags, location stickers or check-ins. We strip location data
   (EXIF/GPS) from files before posting `[BUILD: the upload path does not strip metadata yet; the
   video provider re-encodes video, but still photos need a strip step]`. We post event photos
   **after** the event, not live, and we never show a teen's home, street or car plate.
5. **Guardian contact for uploads featuring minors.** When a member uploads a clip and says
   someone under 18 appears in it (or a moderator spots one), the clip stays in review until a
   moderator has **contacted the guardian** using the contact on file or given by the uploader, and
   received consent. A checkbox alone is not enough. No guardian reply, no posting. *(Proposal: a
   clip waits at most 14 days, then it is deleted.)*
6. **Teens posting themselves.** Same rule: a 14- to 17-year-old who uploads a clip of themselves
   needs guardian consent before it goes public. They can still keep it on their own device.
7. **Crowd shots.** At public events we frame photos to avoid featuring minors who haven't
   consented, and we blur or crop them when we can't. Florida's likeness law has an exception for
   someone photographed "solely as a member of the public" and not named (540.08(4)(c)); we still
   avoid it when teens are involved.
8. **No minors in money asks.** Photos or clips of minors are never used in donation, dues or
   fundraising posts *(proposal)*.
9. **Audio.** Florida generally requires **all parties' consent** to record a private conversation
   ([Fla. Stat. 934.03(2)(d)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html));
   talk at a public meeting is not covered ([934.02(2)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.02.html)).
   Don't record anyone's private conversation without their OK, and for teens, their guardian's.
10. **Take it down, no questions.** If a teen or their guardian asks us to remove a photo or clip,
    we take it down within 24 hours *(proposal)* and confirm when it's gone. Consent can be
    withdrawn at any time.
11. **Personal phones.** Volunteers who take photos of teens at events send them to the club's
    shared folder and delete them from personal phones and personal accounts within 7 days
    *(proposal)*.

## 4. Can adult organizers DM teens?
<!-- page: teen-safety.html#minors-online -->

- **No private one-on-one messages** between adult organizers (18+) and teen members, on any app.
  Use group chats or channels with **at least two adult organizers** in them, or copy the
  guardian. Organizers don't send friend or follow requests to teen members from personal
  accounts *(proposal)*.
- **Keep it on the record.** Club business goes through club channels that other organizers can
  see. No disappearing-message apps with teens.
- **Texts to members under 18.** *Proposal: none at launch.* If counsel later approves a teen
  texting program: guardian consent plus the teen's own opt-in, event logistics and safety
  messages only, never fundraising, and only between 9:00 am and 8:00 pm Eastern. STOP and HELP
  work the same for everyone.
  - *Background:* federal rules require prior express consent for autodialed or prerecorded calls
    to cell phones, texts included ([47 CFR 64.1200(a)(1)(iii)](https://www.law.cornell.edu/cfr/text/47/64.1200)),
    and carriers expect content that meets age-gating rules (CTIA Messaging Principles, May 2023,
    5.3.1). Whether a 14- to 17-year-old can give that consent alone is a question for counsel
    (README, question M3).
- **Never ask a teen** for home address, school, schedule, social security number or photos
  outside club activities.

## 5. How do you keep events safe?
<!-- page: teen-safety.html#minors-events -->

1. **Two-adult rule.** At least two adult organizers (21 or older *(proposal)*) at every event or
   activity a minor attends. No adult is ever alone with a minor: not in a room, not in a car, not
   on a call.
2. **A named safety lead** at each event knows which minors are attending, has their guardian
   contacts, and is the person to tell if something's wrong.
3. **Guardian permission** (a simple form) for anything off-site, after dark, out of the county,
   overnight, or at a protest or rally *(proposal)*.
4. **Canvassing and tabling.** Teens work in pairs with an adult team lead in sight or on the same
   block, in daylight, and never enter anyone's home. Teens can talk about pre-registration and
   share the official online links (Floridians may pre-register at 16 and vote at 18:
   [Fla. Stat. 97.041(1)(b)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html)).
   Nobody, teen or adult, collects paper registration forms for the club unless counsel has
   cleared it: groups that collect or handle applications must register as third-party voter
   registration organizations and face fines for late forms
   ([Fla. Stat. 97.0575](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.0575.html)).
5. **Rides.** No adult drives a minor who isn't their own family member unless a second adult or
   another teen is in the car and the guardian has said yes in writing *(proposal)*.
6. **Alcohol.** Events that teens attend are alcohol-free, or keep alcohol in a separate,
   ID-checked area. Nobody gives, buys or serves alcohol to anyone under 21: in Florida that's a
   crime ([Fla. Stat. 562.11(1)(a)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0562/Sections/0562.11.html),
   a second-degree misdemeanor for a first offense). Same for cannabis, vapes and tobacco.
7. **Overnight trips** (conventions, trainings): guardian consent, adult chaperones, minors room
   only with minors of a similar age, and never with an adult who is not their parent or guardian.
8. **Background checks.** Adults who regularly lead youth activities complete a background check
   and this policy's training before they do *(proposal)*. `[COUNSEL: which check, who pays, and
   what consent forms are needed.]`
9. **Code of conduct.** Everyone at YDSC events treats each other with respect. Harassment,
   romantic or sexual contact between an adult and a minor, and sharing sexual content with a
   minor are grounds for immediate removal and a report to the authorities.

## 6. What if something's wrong?
<!-- page: teen-safety.html#minors-report; the page's #minors-parents ("Parents and guardians: what can you ask for?") draws on sections 2, 3 and 6 -->

- **Someone in danger right now:** call **911**.
- **Suspected child abuse, abandonment or neglect:** in Florida, **any person** who knows or has
  reasonable cause to suspect it must report it immediately to the central abuse hotline
  ([Fla. Stat. 39.201(1)(a)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0039/Sections/0039.201.html)).
  **Florida Abuse Hotline: 1-800-962-2873** (1-800-96-ABUSE), 24/7, or online at
  https://reportabuse.myflfamilies.com/s/ (not for emergencies)
  ([Florida DCF](https://www.myflfamilies.com/services/abuse/abuse-hotline)). Report first; tell
  the club's safety lead after. You don't need proof, and you don't need anyone's permission.
- **Sexual exploitation of a child online** (images, grooming): report to NCMEC's CyberTipline,
  https://report.cybertip.org/ or 1-800-843-5678. Don't download, screenshot or forward the
  material.
- **Anything else that worries you** (a pushy DM, a photo posted without consent): tell the safety
  lead or email `{privacyEmail}`. We follow up within 24 hours *(proposal)*.
- **No retaliation** against anyone who reports in good faith.

## 7. Florida's teen social media laws (for counsel)
<!-- not on the public page (teen-safety.html) -->

- **Fla. Stat. 501.1736** (HB 3, 2024) bars "social media platforms" from letting under-14s hold
  accounts and requires parental consent for 14- and 15-year-olds. A platform must meet **all four**
  tests: user content; at least 10% of daily active users under 16 spending 2 or more hours a day on
  it; algorithms that analyze user data to select content; and at least one "addictive" feature
  (infinite scroll, push notifications about activity, public likes or shares, autoplay video or
  live-streaming)
  ([501.1736](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1736.html)).
  A club site is very unlikely to meet the usage test. The clip feed already has autoplay and like
  counts, so we should **not** add an algorithmic "for you" ranking, infinite scroll or push
  notifications on top. Litigation status: news reports say the Eleventh Circuit vacated the
  preliminary injunction on Oct 14, 2026 and the State says it will enforce the law **[med:
  secondary sources only]** ([Florida Phoenix](https://floridaphoenix.com/2026/10/14/appeals-court-lifts-block-on-florida-law-restricting-social-media-access-for-teens/)).
- **Fla. Stat. 501.1735** (Protection of Children in Online Spaces; "child" means under 18) applies
  to an "online platform" (a social media platform, online game or online gaming platform) likely
  to be predominantly accessed by children
  ([501.1735](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1735.html),
  history note ch. 2026-52). A club site is not one, but we follow its spirit: collect only what a
  feature needs, no precise location data about minors, no dark patterns.

## 8. Training and sign-off
<!-- not on the public page (teen-safety.html) -->

- Every officer and every adult who works with teens reads this policy and confirms it in writing
  each year *(proposal)*.
- The board names a **youth safety officer** who keeps consent forms, answers guardian questions
  and reviews this policy each January.

---

**Sources** (all checked Nov 9, 2026): 16 CFR 312.2; FTC COPPA FAQ; Fla. Stat. 743.07, 540.08,
934.02, 934.03, 97.041, 97.0575, 562.11, 39.201, 501.1736, 501.1735 (2026 Florida Statutes, Online
Sunshine); 47 CFR 64.1200; CTIA Messaging Principles (May 2023); Florida DCF Abuse Hotline page;
NCMEC CyberTipline. Full URLs are inline above and in `docs/legal/README.md`.
