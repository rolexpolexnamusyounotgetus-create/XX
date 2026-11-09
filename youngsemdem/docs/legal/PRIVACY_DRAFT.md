# Privacy Policy (DRAFT)

> **DRAFT: not legal advice; have counsel review before launch.**
> Written Monday, November 9, 2026 for the youngsemdems demo site. Effective date: none yet (the
> site is a demo). Nothing here is final until a Florida lawyer and the YDSC board have signed off.
> Text in `[BRACKETS]` is a placeholder or a decision still to make. Statements marked
> *(proposal)* are numbers we picked so the draft reads complete: Kira and the board should
> confirm or change them.
>
> The short bilingual version that pages render lives in `data/legal.js` (`pages.privacy`). Keep
> the two in step: change this file first, then the short version.

---

## The short version

- **Demo right now.** On the demo site, everything you type stays in your own browser. Nothing is
  sent to us.
- **On the live site** we collect only what you put in the join form, the texts you sign up for and
  any clips you choose to post.
- **No selling. Ever.** We don't sell, rent or trade your info, and we never share your phone
  number for anyone's marketing.
- **Analytics that don't track you.** No ad pixels, no cookies from us, no personal data in our
  stats. If your browser sends Do Not Track or Global Privacy Control, we skip analytics entirely.
- **Texts only if you tick the box.** Reply STOP any time to stop them.
- **Clips are checked by a real person** before anyone else can see them.
- **14 and up.** We don't accept anyone under 13 at all, and our club starts at 14. Members 14 to 17
  get extra protections ([Teen Safety Policy](MINORS_POLICY.md)).
- **You're in control.** Ask us to see, fix or delete your info at `{privacyEmail}`, or wipe what
  this site saved in your browser with one tap.

---

## 1. Who we are

The **Young Democrats of Seminole County** (YDSC) is a volunteer club for Democrats aged 14 to
under 40 in Seminole County, Florida. This site is run by YDSC volunteers. When this policy says
"we" or "us", it means YDSC.

- Contact for privacy questions: `{privacyEmail}` *(set `legal.privacyEmail` in
  `assets/js/config.js`; it is empty today)*.
- Mailing address: `[MAILING ADDRESS: needed for email and SMS rules; see section 9]`.
- `[COUNSEL: confirm the legal name of the entity that runs the site and is responsible for this
  data (YDSC as an unincorporated club, a committee, or the Seminole County Democratic Executive
  Committee). See README, question C1.]`

## 2. Demo site vs live site

This matters, so it gets its own section.

| | Demo site (now) | Live site (after launch) |
|---|---|---|
| Join form | Saved only in your browser. Not sent anywhere. | Sent to our member list (Action Network or a similar tool). |
| Referral "squad" | Simulated people, clearly labeled as demo. | Real people who joined with your link. |
| Video clips | Saved only on your device. Uploads are off. | Uploaded to our video provider, held for human review. |
| Counters | Made-up demo numbers, labeled as demo. | Real counts, or hidden. |
| Analytics | Never sends anything. | Privacy-friendly page counts (section 6). |

How we know: the site's config has a `demo` switch, and while it is on, the join, counter and
upload code paths make no network calls (`assets/js/members.js` `submit()`, `assets/js/clips.js`
`uploadEnabled()`, `assets/js/track.js` `enabled()`).

## 3. What we collect, and why

### 3.1 When you join

| What | Required? | Why we ask |
|---|---|---|
| First name | Yes | So we know what to call you. |
| Last name | No | Helps us match dues and event sign-ins. |
| Email **or** mobile number | One of the two | To send you club updates. |
| ZIP code | No | To know you're local and invite you to nearby events. |
| Age (or birth year) | Asked | To check you're at least 14 and apply our teen rules if you're under 18. |
| Interests | No | So we invite you to the things you care about. |
| Email and text opt-ins | Your choice | To record what you agreed to receive. |

The site also attaches a few things automatically:

- **Your referral code** (for example `KIRA7QX`: up to five letters of your first name plus random
  characters) so you can invite friends. If you're under 18, your code is random characters only, with
  no part of your name.
- **Who referred you**, if you arrived through a friend's link in the last 30 days.
- **The page you joined from** and any campaign tags in the link (`utm_source`, `utm_medium`,
  `utm_campaign` and similar), so we know which posts and flyers work.
- **The time you joined.**

If you're under 14, the form tells you so and saves nothing (`members.validate()` rejects the
age before anything is stored). A hidden "honeypot" field catches bots; if a bot fills it in,
nothing is saved or sent.

### 3.2 When you sign up for texts

Only if you tick the text box. We keep a **consent record**: your number, the time, the exact
wording you agreed to, the page, and the IP address you used. Phone carriers expect this record
(CTIA Messaging Principles, May 2023, section 5.1.2), and it lets us prove you asked to hear from
us. See section 8 for the text terms. `[BUILD: consent records are not stored anywhere yet; the
join proxy must store them before texting starts.]`

### 3.3 When you post a clip

The video file, a still frame we make from it (the poster), your caption, tags, the handle you
choose, the clip's length, size and shape, and your answers to the consent questions (that you
have the right to post it, that everyone in it agreed, and whether anyone under 18 appears). If
our bot check (Cloudflare Turnstile) is on, it runs when you start an upload. Every upload is
marked "pending review" and is not shown to anyone else until a person approves it
([Clip Rules](MODERATION_POLICY.md)).

### 3.4 When you donate or pay dues

Money goes through **ActBlue**, not through this site. We never see your card number. ActBlue
collects what it needs (name, contact details and, where the law requires it, address, employer
and occupation) and sends the recipient a report about your contribution
([ActBlue Privacy Policy](https://www.actblue.com/legal-privacy/), effective Oct 1, 2026).
Donate links on our site add a code (`refcode`) that shows which member's link or which campaign
sent you, so we can thank the right people.

### 3.5 When you just browse

- **Our host** (Cloudflare Pages or Netlify) handles your IP address to deliver the pages, like
  every website, and may keep short security logs under its own policy.
- **Analytics**, only on the live site, only without personal data (section 6).
- `[DEMO NOTE: some demo pages may load photos from Unsplash or fonts from Google Fonts, which see
  your IP address. DEPLOY.md section 8 plans to self-host them before launch.]`

We don't use ad pixels, retargeting, social media trackers or fingerprinting.

## 4. What this site saves in your browser

The site keeps some things on your own device using your browser's storage (`localStorage`,
`sessionStorage` and IndexedDB). This is how the demo works without a server. **The site's own
code sets no cookies.**

| Saved on your device | What it's for | How long |
|---|---|---|
| Your member profile (if you join) | Remembers you joined, your referral code, your squad | Until you clear it. On the live site, your email, phone and ZIP are removed from the browser once they reach our list. |
| A small join log (first name, last initial, codes) | Builds your referral squad | Until you clear it |
| The referral code from a link you opened, and campaign tags | Credits the friend who invited you | Counts for 30 days |
| Your clips (video and poster), likes, views, hidden clips | Plays your clips and remembers your likes | Until you delete them |
| Counter values | Shows club counts | Until you clear it |
| A debug switch and "already viewed" marks | Testing, and counting each view once | Until you close the tab |
| Cached pages and files (live site only) | Faster loads and an offline page | Replaced on each site update |

**Wipe it:** the site offers a "Forget me on this device" button `[DESIGN: add it to the
privacy page and the join confirmation; it calls YSD.members.forget() and YSD.clips.reset()]`.
Clearing site data in your browser settings also works. Wiping your browser does not delete what
we already have on the live site: for that, see section 13.

**Other sites' cookies.** When you use ActBlue, Action Network, Mobilize, a video player or the
bot check, those services may set their own cookies under their own policies.

## 5. How we use your info

- To welcome you, send updates you asked for, and invite you to events and volunteer shifts.
- To track dues and voting membership under the club's bylaws.
- To show you your referral squad and credit invites.
- To review, caption and publish clips you post.
- To keep the site safe: block bots, stop abuse, and follow the law.
- To learn, in totals only, which pages and posts work.

We don't use your info for ad targeting, and we don't give it to anyone to train AI models. There
is no AI chatbot on this site.

## 6. Analytics, Do Not Track and Global Privacy Control

- The demo never sends analytics (`track.js`: `enabled()` is false while `demo` is on).
- The live site will use **Cloudflare Web Analytics** (which "does not collect or use your
  visitors' personal data", per [Cloudflare](https://developers.cloudflare.com/web-analytics/about/))
  and may later add **Plausible**, which sets no cookies and stores no raw IP addresses
  ([Plausible data policy](https://plausible.io/data-policy)).
- Before any event is sent, our code drops fields that look like personal data (email, phone, name,
  address, ZIP, age, birth date, IP and similar) and keeps only short, simple values.
- If the club ever switches to its own ("custom") analytics endpoint, the referral code that
  brought a visitor is sent with events (`track.js`, `rec.ref`). Referral codes start with a
  member's first name, so we treat them as personal data `[COUNSEL: or drop ref from analytics;
  README, question P4]`.
- **Invite codes in links.** Plausible keeps the `ref` query parameter as a traffic source and
  strips other non-UTM parameters ([Plausible docs](https://plausible.io/docs/custom-query-params)),
  so its reports would show how many visits each member's invite link brought. That says nothing
  about who the visitors are, but it does tie traffic to a member's code. `[DECIDE: accept and
  disclose, or rename share.refParam (for example to "invite") so Plausible drops it. README, P4.]`
- **If your browser sends Do Not Track or Global Privacy Control, we send no analytics at all**
  (`integrations.analytics.respectDoNotTrack`, on by default).

## 7. Who we share with

**We don't sell, rent or trade your info.** We share it only with services that help us run the
club, under their own privacy policies, and only what each needs:

| Service | What it gets | Why |
|---|---|---|
| Action Network (or the list tool we choose) | Join form, consent flags, referral code, who referred you | Our member list and email. Action Network says it usually acts as a "processor" following the organizer's instructions ([Privacy Policy](https://actionnetwork.org/privacy), revised Feb 26, 2026). |
| Our texting provider `[TBD]` | Phone number, first name, consent record | To send texts you asked for |
| Mux or Cloudflare Stream | Your clip, caption, tags, handle | To store, caption and play clips |
| Cloudflare Turnstile | Technical signals from your browser (IP, browser type) | To block bots ([Turnstile Privacy Addendum](https://www.cloudflare.com/turnstile-privacy-policy/), updated June 18, 2025) |
| Cloudflare Pages or Netlify | Your IP address and page requests | Hosting |
| Cloudflare Web Analytics or Plausible | No personal data | Page counts |
| ActBlue | What you give ActBlue directly, plus the referral code in the link | Donations and dues |
| Mobilize | Only what you enter on Mobilize | Event RSVPs |

**Other Democratic groups.** We will not share your info with other organizations, including the
county party, Florida Young Democrats or Young Democrats of America, unless you say yes or the law
requires it. `[DECIDE: does the YDSC charter or the county party require sharing the roster? If
so, say exactly who and what here. README, question P2.]`

**Your mobile number is never shared with anyone for their marketing.** Text opt-in lists are
never rented, sold or shared (CTIA Messaging Principles 5.1.4).

**The law.** We may share info if a court or the law requires it, or to protect someone's safety,
including reporting suspected child abuse (section 11).

**Your referral squad.** If you join through a friend's link, that friend may see your first name
and last initial in their squad. Members under 18 appear by first name only *(proposal; needs a
change in the squad code)*.

## 8. Text messages (SMS terms)

- **Program:** `{orgShort}` texts about events, volunteer shifts and voting reminders.
- **How often:** recurring automated texts, up to 4 a month *(proposal)*, a few more in the weeks
  before an election.
- **Cost:** message and data rates may apply. We never charge for texts.
- **Stop any time:** reply STOP (or QUIT, END, CANCEL, UNSUBSCRIBE, REVOKE, OPT OUT). We send one
  confirmation and nothing after that. Federal rules say opt-outs must be honored within 10
  business days ([47 CFR 64.1200(a)(10)](https://www.law.cornell.edu/cfr/text/47/64.1200)); we aim
  for right away.
- **Help:** reply HELP or write to `{privacyEmail}`.
- **Not required:** you never have to agree to texts to join, come to events or donate.
- **Your number stays with us:** never shared for anyone's marketing.
- **Under 18:** see the [Teen Safety Policy](MINORS_POLICY.md). *(Proposal: no texts to members
  under 18 at launch.)*

The sign-up box is unchecked by default, and the exact wording is kept in `data/legal.js`
(`snippets.smsConsent`) so the record of what you saw stays exact.

## 9. Email

Every email has a one-click unsubscribe link and our mailing address. CAN-SPAM's rules (a valid
postal address, opt-outs honored within 10 business days) are written for commercial email
([FTC guide](https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business));
political email is generally outside them, and we follow them anyway.

## 10. Clips you post

- Nothing you upload is public until a person on our moderation team approves it.
- You can delete your clip from your device at any time. To take down a published clip, use the
  report button or email `{privacyEmail}`; we remove your own clip within 3 days *(proposal)*, and
  within 24 hours if it shows someone under 18.
- Don't put personal details in captions (yours or anyone else's).
- Full rules: [Clip Rules](MODERATION_POLICY.md).

## 11. Kids and teens

- **Under 13: never.** The federal children's privacy law (COPPA) treats anyone under 13 as a
  child ([16 CFR 312.2](https://www.law.cornell.edu/cfr/text/16/312.2)). COPPA covers commercial
  sites; nonprofits are generally outside it, but the FTC encourages them to follow it
  ([FTC COPPA FAQ](https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions)),
  and we do. Our join form asks for age in a neutral way and stores nothing for anyone under 14.
  If we learn we have info from someone under 13, we delete it.
- **14 to 17:** welcome. Extra rules cover photos, video, texts and events:
  [Teen Safety Policy](MINORS_POLICY.md).
- **Parents and guardians** can ask to see or delete their teen's info at `{privacyEmail}`.

## 12. How long we keep things *(proposals)*

| Data | Kept for |
|---|---|
| Member record | While you're a member. Each January (dues time) we remove people who asked to leave or who haven't been active for 2 years. |
| Text consent records | 5 years after your last text from us. Federal claims generally have a 4-year time limit ([28 U.S.C. 1658(a)](https://www.law.cornell.edu/uscode/text/28/1658)), so this lets us prove consent. |
| Text and email opt-outs | Kept (number or email and date only) so we never contact you again |
| Clips not approved | Deleted within 30 days of the decision |
| Published clips | Until you or the people in it ask us to remove it, or 2 years after posting, whichever comes first |
| Guardian consent forms | While the photo or clip is up, plus 1 year |
| Reports and moderation notes | 1 year, unless the law requires longer (section 11 and the Clip Rules) |
| Anything from someone under 13 | Deleted as soon as we know |
| Analytics | Totals only; no personal data to keep |

## 13. Your choices and rights

You can ask us to:

- **See** the info we have about you.
- **Fix** anything that's wrong.
- **Delete** your info. We also tell our list, texting and video services to delete it. We keep only
  what the law requires and a do-not-contact entry so we don't contact you again.
- **Stop** emails (unsubscribe link) or texts (reply STOP) at any time.

Email `{privacyEmail}`. We reply within 3 business days and finish within 30 days *(proposal)*.
We may ask a question or two to confirm it's really you. Florida's consumer data privacy law
(Fla. Stat. 501.701 and following) applies only to large for-profit companies, so it does not
cover us ([501.702(9)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.702.html));
we offer these rights anyway.

## 14. Security

- HTTPS everywhere. Secret keys stay in the host's server settings, never in the site's code.
- Only named volunteers can reach the member list, each with their own login and two-factor
  authentication *(proposal)*. We remove access when someone steps down.
- We collect as little as we can, and on the live site we remove your contact details from your
  browser after they reach our list.
- **Being on a Democratic club's list says something about your politics.** We treat the list as
  sensitive: it is never posted or shown in public.
- If a breach puts your info at risk, we'll tell you as quickly as we can and within 30 days.
  Florida's breach law sets that deadline for businesses and other commercial entities
  ([Fla. Stat. 501.171(4)](http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html));
  it may not reach a volunteer club, and we follow it anyway.

## 15. Changes

When we change this policy, we update the date at the top and say what changed. If a change
affects how we use info you already gave us, we'll ask you first.

## 16. Contact

`{privacyEmail}` · `[MAILING ADDRESS]` · Seminole County, Florida.

---

## Notes for counsel (not for the public page)

**Laws and documents this draft relies on** (all checked Nov 9, 2026):

- COPPA Rule, 16 CFR 312.2 (child = under 13; nonprofits exempt under FTC Act section 5 are not
  "operators"; photos and video with a child's image or voice are personal information).
  https://www.law.cornell.edu/cfr/text/16/312.2
- FTC, Complying with COPPA: FAQ (nonprofits; neutral age screens; Rule amended Apr 22, 2025).
  https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions
- TCPA rules, 47 CFR 64.1200(a)(1)(iii), (a)(10), (a)(12). https://www.law.cornell.edu/cfr/text/47/64.1200
- FCC Report and Order FCC 26-67 on consent revocation (adopted Sept 30, 2026; published Oct 26,
  2026 at 91 FR 67219; effective Nov 25, 2026, per a law-firm summary; the 10-business-day honor
  period is unchanged). Secondary source, **[med]**:
  https://www.nelsonmullins.com/insights/alerts/fcc-download/all/fcc-adopts-overhaul-of-tcpa-consent-revocation-rules-revoke-all-narrowed-exclusive-opt-out-methods-permitted-and-fraud-alert-exemption-expanded
- Florida Telephone Solicitation Act, Fla. Stat. 501.059 (covers "telephonic sales calls"; a
  checked box counts as a signature; STOP and a 15-day cure before suit over texts).
  http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.059.html
- CTIA Messaging Principles and Best Practices (May 2023): calls to action 5.1.1, consent records
  5.1.2, confirmation 5.1.2.1, no shared lists 5.1.4, privacy policy linked from the call to action
  5.2.1. https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf
- FTC, CAN-SPAM Act: A Compliance Guide for Business.
  https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business
- Florida Information Protection Act, Fla. Stat. 501.171 ("covered entity" is a commercial entity;
  30-day notice; reasonable security; disposal).
  http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html
- Florida Digital Bill of Rights, Fla. Stat. 501.702(9) (controllers are for-profit with over
  $1 billion in revenue). http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.702.html
- 28 U.S.C. 1658(a) (4-year default limit). https://www.law.cornell.edu/uscode/text/28/1658
- Vendor policies: ActBlue (effective Oct 1, 2026) https://www.actblue.com/legal-privacy/ ·
  Action Network (revised Feb 26, 2026) https://actionnetwork.org/privacy · Cloudflare Web
  Analytics https://developers.cloudflare.com/web-analytics/about/ · Plausible
  https://plausible.io/data-policy · Turnstile Privacy Addendum (June 18, 2025)
  https://www.cloudflare.com/turnstile-privacy-policy/

**Code that backs each claim:** see `docs/legal/README.md`, "Claims and the code behind them".
