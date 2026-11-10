# 02 · What young Democrats want from their websites, and what chapter sites actually deliver

*Research for the youngsemdem demo site (Young Seminole Democrats: Seminole County, FL Democrats aged 40 and under). Compiled Monday, November 9, 2026, six days after the Nov 3 general election. Every claim links to its source and is tagged [high], [med] or [low] for confidence.*

*Method. I audited 22 live websites plus 1 site that renders only with JavaScript and 5 dead or lapsed domains. I also checked 9 Florida county chapters for any standalone site. Homepages were fetched on Nov 9, 2026. Where a site allowed scripted downloads, its raw HTML was scanned with a script (platform, links, images without alt text, skip links, Open Graph tags, language links, text-to-join keywords, copyright years); those results are marked **measured** and rated [high]. Nine sites, most of them on Squarespace, block scripted downloads, so they were read through a page-reader tool and rated [med]. The audit covers homepages and their visible navigation only, not every inner page, so "not found" means not found on the homepage or in the menu. Alt-text counts are an upper bound, because decorative images may correctly have empty alt text.*

*Confidence key. **[high]**: primary source or measured directly, recent. **[med]**: reputable secondary report, an organization's own claim, read through a page reader, or older primary data. **[low]**: vendor survey seen only in summary, or a single unverified source.*

---

## Headline

Young Democrats say they want four things from a political group: to be asked personally, to have friends and fun, to see that their effort changes something local, and to join cheaply and easily. The evidence is strong. CIRCLE found that 37% of 18-34-year-olds, and 59% of 2024 non-voters, were never contacted by any campaign or group. Only 19% of Gen Z registered voters joined a political club or group last year, yet 82% talk politics with friends and family. Half of young adults say their households are struggling or barely secure. Chapter websites deliver almost none of this. Across 22 audited sites, donating works on 18, but only 4 show a working events calendar, 1 embeds video, 1 has a real Spanish toggle, and 2 pass basic accessibility checks. Three Squarespace chapter sites show an unconfigured newsletter form that cannot collect emails. The larger chapters' old domains have lapsed into a gambling site, a for-sale page and an expired-site notice. In Florida, only 3 of the 9 county chapters checked (Pinellas, Hillsborough, Jacksonville) have a standalone site, and each has broken pieces. The rest live on ActBlue pages, the state party's event calendar and Instagram. **Seminole already has a chartered chapter**, the Young Democrats of Seminole County (YDSC). It has $20 dues and ages 14 to under 40, but no working website was found. Its likely domain, youngsemdems.com, is registered through Dec 31, 2026 and shows only a hosting error page. So youngsemdem's opening is clear: be the first Florida young-Dem site that shows the next hangout with a date and one-tap RSVP. It should welcome people bilingually, make joining free or pay-what-you-can, prove local impact, and let members share and post. It also needs settling with YDSC early, before any brand or domain decision.

---

## Contents

1. [Seminole context: there is already a chapter](#1-seminole-context-there-is-already-a-chapter)
2. [The audit: sample and feature matrix](#2-the-audit-sample-and-feature-matrix)
3. [What is broken or dated](#3-what-is-broken-or-dated)
4. [What the best sites do well](#4-what-the-best-sites-do-well)
5. [What young Democrats actually want, ranked with evidence](#5-what-young-democrats-actually-want-ranked-with-evidence)
6. [Demand vs supply: the gaps no chapter site fills](#6-demand-vs-supply-the-gaps-no-chapter-site-fills)
7. [Recommendations: 10 must-haves and 10 delights for youngsemdem](#7-recommendations-10-must-haves-and-10-delights-for-youngsemdem)
8. [Open questions](#8-open-questions)
9. [Sources](#9-sources)

---

## 1. Seminole context: there is already a chapter

This matters more than any feature, so it comes first.

- **The Young Democrats of Seminole County (YDSC) exists and takes money through ActBlue.** The page says its mission is raising young voter turnout, advocating on youth issues and backing Democratic candidates in the county. It lists no website or contact details ([ActBlue: youngsemdems](https://secure.actblue.com/donate/youngsemdems)) [high]. The ActBlue slug `youngsemdems` is nearly identical to this project's working handle, `youngsemdem`.
- **Dues and eligibility.** YDSC dues are **$20 a year, paid in January**. Voting membership is open to dues-paying residents of Seminole County and students at Seminole schools. Members who cannot pay, for example because of citizenship status or financial hardship, can join as non-voting members. The age range is **14 to under 40** ([ActBlue: ydscdues](https://secure.actblue.com/donate/ydscdues)) [high]. Kira's brief says "40 and under", so the cutoff needs a decision (see Open questions).
- **Activity.** YDSC ran a musical theatre revue fundraiser on June 15 (year not stated) at Imagine Performing Arts Center in Oviedo, with a $20 suggested donation and proceeds going to a local charity for LGBTQ+ youth ([ActBlue: ydscmusicaltheatre](https://secure.actblue.com/donate/ydscmusicaltheatre)) [high]. A web search turned up a Sept 13, 2026 YDSC general meeting, 4:00 to 5:00 pm at the SemDems office in Longwood with a Google Meet option. I could not open that listing directly, and no later YDSC meeting appears on the state party calendar ([Florida Democrats events: Seminole](https://events.floridadems.org/org/seminole-county-democrats)) [med].
- **Domain status (RDAP lookups, Nov 9, 2026).** `youngsemdems.com` was registered on Dec 31, 2017 through GoDaddy, points to HostGator name servers and **expires Dec 31, 2026**. It returns only a hosting page reading "Contact Support". The owner is private, so it may or may not be YDSC [high for the registration facts; low for ownership]. `youngsemdem.com`, `youngsemdem.org` and `youngsemdems.org` returned "not found" from their registries, which suggests they are unregistered [med].
- **The parent party site (semdems.com) does not list the Young Dems.** Its "Club and Caucus Pages" menu shows other clubs but no YDSC link (read through a page reader) [med]. It does have useful local assets: a 2026 **Spanish-language voter guide PDF** (measured: `SemDems-Voter-Guide-2026-SPANISH.pdf`) [high]; a GTranslate machine-translation widget (measured) [high]; RSVPs through **Solidarity Tech** at act.semdems.com (measured) [high]; and a monthly **Disability Caucus** on Zoom ([Florida Democrats events: Seminole](https://events.floridadems.org/org/seminole-county-democrats)) [high]. Several post-election homepage posts still asked people to vote for candidates whose races were over [med].
- **Florida party infrastructure runs on Solidarity Tech.** The county parties of Seminole (act.semdems.com), Orange, Pinellas, Duval and Palm Beach all host event and sign-up pages on Solidarity Tech subdomains. The state party's events site gathers them into one calendar ([Orange DEC on Solidarity Tech](https://orange-dec.solidarity.tech/), [Pinellas DEC](https://pinellas-dec.solidarity.tech/hd61monthly), [Duval DEC](https://duval-dec.solidarity.tech/), [Palm Beach DEC](https://palm-beach-dec.solidarity.tech/professional-democrats-mixer-relaunch-of-caucus)) [high]. A youngsemdem site that feeds events into the same system avoids a separate data silo.

**Implication.** A public site called "Young Seminole Democrats" would be easy to confuse with YDSC. Before anything leaves demo mode, Kira needs to say whether this is a pitch to YDSC's board, a new group, or a personal demo. The demo should never use YDSC's name, ActBlue links or dues text as its own.

---

## 2. The audit: sample and feature matrix

### 2.1 Florida county chapters: who has a site at all

| County | Standalone site? | Where the chapter actually lives online | Evidence |
|---|---|---|---|
| **Seminole** (YDSC) | None found | ActBlue pages; a meeting listed on the state party calendar; youngsemdems.com shows only a hosting error | §1 [high] |
| **Orange** (YDOC) | None found | Solidarity Tech meeting pages under the county party, ActBlue, state party calendar | [YDOC meeting page](https://orange-dec.solidarity.tech/young-democrats-of-orange-county-monthly-meeting), [state calendar listing](https://events.floridadems.org/event/19001/young-democrats-of-orange-county-monthly-meeting) [high] |
| **Miami-Dade** | None found | Directory listings only (Blue Voter Guide); leaders named in older news | [Blue Voter Guide](https://bluevoterguide.org/endorser-org/Miami-Dade_Young_Dems/FL/5803) [med] |
| **Broward** | None found | Directory listing only | [Blue Voter Guide](https://bluevoterguide.org/endorser-org/Broward_Young_Democrats/FL/4203) [med] |
| **Palm Beach** | None found | The old pbcyd.org domain no longer resolves; there is an old Squarespace blog and a county-party youth committee page built on Canva | [Canva youth committee site](https://pbcycc.my.canva.site) [med] |
| **Leon** | None found | Blogspot blog with posts from 2007-2008 | [lcyd.blogspot.com](https://lcyd.blogspot.com/2007/06) [high] |
| **Pinellas** (PCYD) | Yes (Wix) | pinellasyoungdems.org; membership on ActBlue at $25 ("end-of-year sale") | [site](https://www.pinellasyoungdems.org/), [ActBlue](https://secure.actblue.com/donate/joinpcyd) [high] |
| **Hillsborough** | Yes (Squarespace, inferred) | hillsyoungdems.com | [site](https://hillsyoungdems.com/) [med] |
| **Duval** (Jacksonville YD) | Yes (Squarespace, inferred) | jaxyoungdems.org | [site](https://www.jaxyoungdems.org/) [med] |

So 3 of 9 have a site. The statewide Florida Young Democrats site points to a "Find Your Chapter" page but showed no chapters on its homepage ([floridayoungdems.com](https://www.floridayoungdems.com/)) [med].

The state party's calendar also shows how un-curated recurring listings get. Orange County's Young Dems monthly meeting is listed for **Thursday, Nov 26, 2026, which is Thanksgiving Day** ([listing](https://events.floridadems.org/event/19001/young-democrats-of-orange-county-monthly-meeting)) [high]. Its share buttons offer Facebook, X, Bluesky and LinkedIn, but no WhatsApp, text or Instagram, the channels young people actually use to share (measured) [high].

### 2.2 The feature matrix (22 sites)

Legend: **●** present and working · **◐** partial, link-out only, or not surfaced on the homepage · **○** not found · **✕** present but broken · **–** not measured (the site blocked scripted fetches)

"A11y" here means only two quick checks: a skip link, and the share of images with alt text. ● means a skip link and at least 90% of images with alt text; ✕ means neither.

| # | Organization (type) | Events | Join/dues | Volunteer | Newsletter | Voter tools | Endorse | Run pipeline | Prof dev | Social | Merch | Donate | Video | Blog/news | Spanish | A11y | Platform |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | [Young Democrats of America](https://yda.org/) (national) | ◐ | ◐ | ◐ | ● | ○ | ○ | ● | ◐ | ○ | ● | ✕ | ○ | ◐ | ○ | ◐ | WordPress |
| 2 | [Florida Young Democrats](https://www.floridayoungdems.com/) (state) | ◐ | ◐ | ○ | ○ | ○ | ◐ | ◐ | ○ | ○ | ○ | ● | ○ | ○ | ○ | – | Squarespace* |
| 3 | [Pinellas County YD](https://www.pinellasyoungdems.org/) (FL) | ◐ | ◐ | ● | ○ | ○ | ○ | ○ | ○ | ◐ | ○ | ● | ○ | ○ | ○ | ✕ | Wix |
| 4 | [Jacksonville YD](https://www.jaxyoungdems.org/) (FL) | ◐ | ◐ | ○ | ✕ | ◐ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ◐ | ○ | ✕ | Squarespace* |
| 5 | [Hillsborough YD](https://hillsyoungdems.com/) (FL) | ✕ | ◐ | ◐ | ✕ | ✕ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ✕ | Squarespace* |
| 6 | [Seminole County Democratic Party](https://semdems.com/) (FL, parent) | ● | ● | ● | ● | ● | ● | ○ | ○ | ◐ | ○ | ● | ○ | ● | ◐ | ✕ | WordPress |
| 7 | [Texas Young Democrats](https://www.texasyds.com/) (state) | ◐ | ◐ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ◐ | ◐ | ◐ | Wix |
| 8 | [Young Democrats of Arizona](https://www.ydaz.org/) (state) | ◐ | ○ | ○ | ◐ | ○ | ◐ | ○ | ○ | ○ | ○ | ✕ | ○ | ◐ | ○ | – | Squarespace* |
| 9 | [Pennsylvania Young Democrats](https://payoungdems.org/) (state) | ○ | ◐ | ● | ○ | ◐ | ○ | ○ | ○ | ○ | ○ | ● | ○ | ○ | ○ | ✕ | Squarespace |
| 10 | [Brooklyn Young Democrats](https://brooklynyoungdems.org/) (NYC) | ◐ | ◐ | ○ | ✕ | ○ | ● | ○ | ◐ | ○ | ○ | ◐ | ○ | ◐ | ○ | – | Squarespace* |
| 11 | [Manhattan Young Democrats](https://manhattanyoungdems.org/) (NYC) | ● | ● | ◐ | ● | ◐ | ○ | ○ | ◐ | ◐ | ○ | ● | ○ | ● | ○ | ◐ | unknown |
| 12 | [YD of North Carolina](https://ydnc.org/) (state) | ○ | ● | ○ | ● | ○ | ○ | ○ | ● | ○ | ○ | ● | ○ | ◐ | ○ | ◐ | WordPress |
| 13 | [San Francisco YD](https://www.sfyd.org/) (CA) | ◐ | ● | ○ | ○ | ◐ | ● | ○ | ◐ | ● | ○ | ● | ○ | ○ | ○ | ● | Squarespace |
| 14 | [San Diego County YD](https://www.sdyoungdems.com/) (CA) | ● | ◐ | ● | ◐ | ◐ | ● | ◐ | ● | ● | ● | ● | ○ | ○ | ○ | ● | Squarespace |
| 15 | [Orange County YD](https://www.ocyd.org/) (California) | ◐ | ◐ | ○ | ○ | ● | ◐ | ○ | ○ | ○ | ○ | ● | ○ | ◐ | ○ | – | Squarespace* |
| 16 | [High School Democrats of America](https://hsdems.org/) | ◐ | ◐ | ◐ | ○ | ○ | ○ | ○ | ◐ | ◐ | ○ | ● | ○ | ✕ | ● | ✕ | Framer |
| 17 | [Voters of Tomorrow](https://votersoftomorrow.org/) | ◐ | ◐ | ● | ◐ | ● | ○ | ○ | ◐ | ○ | ● | ● | ○ | ● | ○ | ✕ | WordPress |
| 18 | [Gen-Z for Change](https://genzforchange.org/) | ○ | ○ | ○ | ○ | ◐ | ● | ○ | ○ | ○ | ○ | ● | ◐ | ◐ | ◐ | ◐ | custom |
| 19 | [NextGen America](https://nextgenamerica.org/) | ○ | ◐ | ● | ● | ● | ○ | ○ | ○ | ○ | ● | ● | ○ | ● | ○ | ✕ | WordPress + Next.js |
| 20 | [Run for Something](https://runforsomething.net/) | ● | ● | ● | ● | ○ | ● | ● | ◐ | ◐ | ● | ● | ○ | ● | ○ | ✕ | WordPress |
| 21 | [Sunrise Movement](https://www.sunrisemovement.org/) | ◐ | ● | ◐ | ◐ | ○ | ◐ | ○ | ● | ○ | ● | ● | ● | ● | ◐ | ◐ | WordPress |
| 22 | [March for Our Lives](https://marchforourlives.org/) | ○ | ● | ◐ | ● | ● | ○ | ○ | ● | ○ | ● | ● | ○ | ● | ○ | ◐ | WordPress |

\* Squarespace inferred: these sites returned Squarespace's standard 403 page to scripted requests, and their page structure (folder menus, newsletter blocks) matches Squarespace [med]. Pennsylvania's domain redirects to `payd.squarespace.com`, which confirms it [high].

Not in the matrix: **College Democrats of America** ([collegedemocratsofamerica.com](https://collegedemocratsofamerica.com/)). Its homepage now ships as an 8 KB Angular single-page app with no visible text until JavaScript runs. A leftover developer comment in the HTML says it replaced an older Squarespace site (measured) [high]. Its Open Graph tags are set, so link previews still work, but crawlers and no-JS readers see nothing. Its older domain, collegedems.com, redirects to a democrats.org/cda/ page that returns "Page not found" (measured) [high]. CDA's president reported 100,000+ members on about 500 campuses in Feb 2026 ([Brown Daily Herald](https://www.browndailyherald.com/article/2026/02/vaddula-27-im-the-president-of-the-college-democrats-of-america-young-people-are-key-to-the-success-of-the-democratic-party)) [med, self-reported].

### 2.3 Supply counts (22 sites)

| Feature | Working (●) | Partial (◐) | Broken (✕) | None (○) |
|---|---|---|---|---|
| Donate | **18** | 1 | 2 | 1 |
| Join / dues | 7 | 13 | 0 | 2 |
| Newsletter | 7 | 4 | **3** | 8 |
| Volunteer | 7 | 6 | 0 | 9 |
| Merch | 7 | 0 | 0 | 15 (6 of them show an empty cart icon) |
| Blog / news | 7 | 8 | 1 | 6 |
| Endorsements | 6 | 4 | 0 | 12 |
| Voter tools | 5 | 6 | 1 | 10 |
| **Events calendar** | **4** | 12 | 1 | 5 |
| Professional development | 4 | 7 | 0 | 11 |
| Social / hangouts | **2** | 5 | 0 | 15 |
| Run-for-office pipeline | 2 | 2 | 0 | 18 |
| **Accessibility basics** | **2** | 7 | 9 | (4 not measured) |
| **Spanish** | **1** (HSDA toggle: English, Español, 中文) | 4 | 0 | 17 |
| **Video on the homepage** | **1** (Sunrise) | 1 | 0 | 20 |
| Text-to-join keyword | 1 (Sunrise) | – | – | 21 |
| Share cards, quiz, member video uploads, AI helper | 0 | – | – | 22 |

Reading: the sites are built to **take money**, not to **welcome a newcomer to a hangout next Thursday**. That is the reverse of what the evidence in §5 says young people want.

---

## 3. What is broken or dated

These are concrete failure modes for youngsemdem to design out.

**Broken money and RSVP paths**
- **YDA's "$50" donate button sends $10.** The preset buttons' ActBlue links read amount=5, 10, **10**, 100 and 250 for labels $5, $10, **$50**, $100 and $250 (measured from the HTML) [high].
- **Young Democrats of Arizona swapped two links.** "Click here to RSVP" goes to ActBlue, while "Click here to DONATE" goes to a Partiful event. The contact mailto points to `email@email.com`, the footer reads © 2024, and the endorsements still carry 2024-cycle titles ([ydaz.org](https://www.ydaz.org/), page reader) [med].
- **Voters of Tomorrow's "Join a Chapter" points to a staging domain**, `votersoftomorr.wpengine.com/chapters/` (measured) [high].

**Forms that cannot collect anything**
- **Jacksonville, Hillsborough and Brooklyn** all display Squarespace's unconfigured-newsletter message (the form "needs a storage option"), so visitors cannot sign up. The three were read independently and reported identical text ([Jax](https://www.jaxyoungdems.org/), [Hillsborough](https://hillsyoungdems.com/), [Brooklyn](https://brooklynyoungdems.org/)) [med].
- Hillsborough also shows a "Login Account" link that points to "#", a "VOTER REGISTERATION" graphic with no link, and "Upcoming Events" with no events [med].

**Lapsed domains (portability warnings)**
- **lacyd.org**, LA County Young Democrats' former domain (archived copy from 2011 cited on [Wikipedia](https://en.wikipedia.org/wiki/Los_Angeles_County_Young_Democrats); [archive](https://web.archive.org/web/20110301081859/http://www.lacyd.org/index.php)), now serves an Indonesian-language online gambling site (measured page title) [high]. The chapter now uses lacyd.nationbuilder.com [med].
- **gomyd.com**, listed as Manhattan Young Democrats' website on [Idealist](https://www.idealist.org/en/nonprofit/238dd0b74b1f4073a2465cd74ab87914-manhattan-young-democrats-new-york), now redirects to a HugeDomains for-sale page (measured) [high for the redirect, med that it was MYD's]. MYD now runs manhattanyoungdems.org.
- **miyoungdems.org**, the domain in a Young Democrats of Michigan contact email on a 2025 [ActBlue page](https://secure.actblue.com/donate/2025-demsgiving), shows "Squarespace - Website Expired" (measured) [high for the page, med for ownership].
- **payoungdems.org** redirects visitors to the builder subdomain `payd.squarespace.com` instead of serving on its own domain (measured) [high].

**Stale content signals**
- Jacksonville footer: © 2015-2022 [med]. YDNC's newest homepage post is dated **Nov 7, 2024**, two years old (measured) [high]. Voters of Tomorrow's footer reads © 2025 while its assets are dated 2026 [med]. Texas YD and Pinellas use image file names (`IMG_6057.jpeg`, `PCYD_logo (1).png`) as alt text [med]. Florida Young Democrats' logo file is named "Untitled (Google Form).png", and its Facebook and Instagram handles don't match (flayoungdems vs flyoungdems) [med].
- **Builder residue.** Six sites show an empty shopping-cart icon with no store: Florida YD, Hillsborough, Arizona, Pennsylvania, Orange County CA and SF YD [med]. Navigation is duplicated on most builder sites [med].
- **No dates.** Most chapter homepages show no dated item at all, so a visitor cannot tell whether the group is alive [med].

**Accessibility**
- Across the 14 sites whose HTML was scanned, images without alt text ranged from 0 of 32 (San Diego) to 6 of 6 (Voters of Tomorrow) and 12 of 16 (NextGen) (measured) [high]. Gen-Z for Change's page has no `lang` attribute (measured) [high]. This matches the web as a whole: the 2026 WebAIM Million found detectable WCAG 2 failures on **95.9%** of the top million home pages, up from 94.8%. The most common were low-contrast text (83.9%), missing alt text (53.1%) and missing form labels (51%) ([WebAIM Million 2026](https://webaim.org/projects/million/)) [high].

---

## 4. What the best sites do well

- **San Diego County YD: the most complete chapter site.** It has a calendar plus "Meetings and Socials", a fixed meeting rhythm (the fourth Tuesday), a résumé bank, a jobs and internships board, a volunteer tracker, Get Trained, a merch store, endorsements, a sponsors page, a skip link and alt text on all 32 images ([sdyoungdems.com](https://www.sdyoungdems.com/), measured and page reader) [high]. Its weakness: no dues or join steps on the homepage, and no upcoming dates.
- **Manhattan YD: dues as a small monthly habit, with a pay-it-forward tier.** Standard membership is **$6/month**. A **$10+/month "Superstar" tier** also sponsors a member for whom dues would be a burden ([ActBlue: myd-membership](https://secure.actblue.com/donate/myd-membership)) [high]. It has a clean newsletter form with spam protection, monthly events on Mobilize and a blog ([manhattanyoungdems.org](https://manhattanyoungdems.org/), page reader) [med].
- **NYC clubs: the party is the product.** Manhattan YD's late-October 2025 party drew a couple hundred people with no speeches or panels. The one planned act was a drag performance and dance competition, and gift bags carried QR codes to register to vote and join a local chapter ([City & State NY, Nov 4, 2025](https://www.cityandstateny.com/politics/2025/11/new-york-citys-young-democrats-want-put-party-back-party/409298/)) [high].
- **SF YD: proof at a glance.** A "Fast Facts" strip shows 250+ members, founding year 1947, 16+ events a year and its affiliations. Three cards (Become a member, Donate, Attend an event) carry the page ([sfyd.org](https://www.sfyd.org/), page reader) [med].
- **Sunrise: a home in the movement, plus SMS.** It has a hub finder with clear tiers: chapters need 30+ active members, community hubs have 5 to 30, and student hubs at least 5. It offers welcome calls ([Sunrise hubs](https://sunrisemovement.org/hubs)) [med: tier rules seen in search excerpts of that page], a text-to-join keyword ("Text GND to 88504", measured) [high] and the only embedded homepage video in the sample (measured) [high].
- **Run for Something: the pipeline done right.** Signing up takes a name, email and ZIP. It offers an Apply path, a Local Office Guide, a candidate directory, an online community and Mobilize events ([runforsomething.net](https://runforsomething.net/), page reader) [med].
- **NextGen America: voter tools up front.** Registration, polling-place lookup and "make a plan to vote" are on the homepage, with an impact claim that names a year: 1.6 million young voters registered since 2013 ([nextgenamerica.org](https://nextgenamerica.org/), measured) [high that the claim appears; med for the number itself].
- **HSDA: languages and a group chat.** It has an English, Español and 中文 toggle (measured) [high], a three-step "start or join a chapter" path, and a "Join the National Groupchat" Slack invite ([hsdems.org](https://hsdems.org/)) [med].
- **Gen-Z for Change: tools, not pages.** It builds single-purpose tools, such as its bilingual FIGHT (PODER) toolkit (measured), and runs a Spanish-language initiative, Gen-Z X El Cambio ([genzforchange.org](https://genzforchange.org/)) [high]. Its weak spot is that there is no way to join or sign up.
- **Brooklyn YD: an open endorsement process.** A dedicated page explains its 2026 endorsement process, alongside its 2025 results ([brooklynyoungdems.org](https://brooklynyoungdems.org/), page reader) [med].
- **Young Democrats of Arizona uses Partiful**, the Gen Z invite app, for an event RSVP (even though the link is mislabeled) [med]. That is evidence that chapters are already reaching for consumer-grade event tools.

---

## 5. What young Democrats actually want, ranked with evidence

Ranked by strength of evidence × how directly a website can serve it.

### 1. To be asked personally, with a concrete next step

- In CIRCLE's post-2024 poll (Ipsos, Nov 14-26, 2024, n=2,064, ages 18-34), only 63% were contacted at least once by any campaign or group. That means about **37% were never contacted, rising to 59% of non-voters**. The never-contacted share was 48% for youth without college experience, against 29% for those with it ([CIRCLE, Jan 15, 2025](https://circle.tufts.edu/latest-research/2024-poll-barriers-issues-economy)) [high].
- **48% of non-voters** heard little or nothing about how to vote ([same](https://circle.tufts.edu/latest-research/2024-poll-barriers-issues-economy)) [high]. Among non-voters who saw little registration information, 13% gave lack of information as their main reason for not voting. Among those who saw some or a lot, only 2% did ([CIRCLE, Jul 31, 2025](https://circle.tufts.edu/latest-research/barriers-and-hardships-why-some-youth-didnt-vote-2024)) [high].
- YDA's own chapter advice: greet every first-timer, collect contact details, make sure they know the next activity before they leave, and send a recap within a day ([YDA blog](https://yda.org/blog/new-faces-at-your-chapter-meeting-heres-how-to-keep-them-coming-back/)) [med: from 2017, but still sound].
- **Website implication:** every page should end in one clear ask with a date ("Trivia, Thu Nov 19, 7:00 pm, Lake Mary: RSVP"), plus a follow-up path such as text, email or "bring a friend".

### 2. Friends, belonging and fun in real life

- **Only 19% of Gen Z registered voters joined a club or group addressing a political issue** in the past year, while **82% talked politics with family and friends**, 38% volunteered and 70% felt encouraged by mutual-aid networks ([HIT Strategies for URGE, Aug 27, 2026](https://urge.org/wp-content/uploads/2026/08/HIT_URGE_Press-Memo-2026-Young-Voter-Poll.pdf); n=2,950 registered voters 18-29, Jun 24-Jul 9, 2026, opt-in panel) [med]. The conversation already happens. The club is what's missing.
- **25% of US men aged 15-34** reported feeling lonely "a lot of the previous day", against 17% of other adults and an OECD median of 15% for young men. The figure for US women 15-34 was 18% ([Gallup, May 20, 2025](https://news.gallup.com/poll/690788/younger-men-among-loneliest-west.aspx)) [high].
- Event-industry surveys point the same way. Eventbrite's January 2026 study reports 74% of Gen Z rating in-person experiences as more important than digital ones ([Business Wire, Jan 14, 2026](https://www.businesswire.com/news/home/20260114088488/en)) [low: vendor survey seen in summary only].
- Organizers say this outright. NYC's young Dem clubs set out to make newcomers feel they belong and to offer a normal social life in hard political times ([City & State](https://www.cityandstateny.com/politics/2025/11/new-york-citys-young-democrats-want-put-party-back-party/409298/)) [high]. Pinellas's site stresses socials and days of action, many low- or no-cost ([pinellasyoungdems.org](https://www.pinellasyoungdems.org/)) [med].
- **Website implication:** lead with social events, giving each a vibe, a cost (ideally "free") and "who'll be there" cues. In the audit, only 2 of 22 sites present social events properly.

### 3. Low cost and low friction, because money and time are tight

- **49% of 18-29-year-olds** say their household is struggling or has limited financial security. The figure is 57% for those without a degree or enrollment and 59% for Hispanic respondents ([Harvard Youth Poll, Fall 2026, fielded Sep 30-Oct 7, 2026, in English and Spanish](https://iop.harvard.edu/youth-poll/latest-poll)) [high].
- **95%** of Gen Z voters are concerned about housing costs, and **76%** say they are struggling to pay bills or only just covering them ([HIT/URGE](https://urge.org/wp-content/uploads/2026/08/HIT_URGE_Press-Memo-2026-Young-Voter-Poll.pdf)) [med].
- Financially struggling youth are less likely to take part in a local group (about 19%, against about 30% of financially stable youth). CIRCLE's findings point to flexible commitments and covering participation costs ([CIRCLE, Sep 30, 2025](https://circle.tufts.edu/latest-research/youth-are-taking-civic-action-need-opportunities-and-support-overcome-socioeconomic)) [high].
- Among youth who skipped registering because they were busy or missed the deadline, 29% often struggle to meet basic needs, against 14% of youth overall ([CIRCLE, Jul 31, 2025](https://circle.tufts.edu/latest-research/barriers-and-hardships-why-some-youth-didnt-vote-2024)) [high].
- **Website implication:** free-to-join (or pay-what-you-can) membership with a visible hardship path, as in Manhattan's Superstar tier and YDSC's non-voting category. Add 1-hour and remote volunteer options, and keep forms short.

### 4. Proof that their effort matters, locally

- **70%** of youth who believe their vote matters are extremely likely to vote, against 31% of those who don't. **29%** say they would take part more if they felt their vote and voice mattered ([CIRCLE with When We All Vote, May 21, 2026](https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy); n=5,549, ages 18-29) [high].
- In the same survey, youth asked what would change their participation chose: less corporate influence and money in politics (48%), candidates or parties that better represent their generation (41%), and follow-through on promises (41%) ([same](https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy)) [high].
- CIRCLE's recommendations include investing in youth engagement beyond swing states, including local elections, and giving youth evidence that their vote matters ([same](https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy)) [high]. Run for Something's founder says young people want local officials who deliver visible, concrete results ([The Nation, Apr 7, 2026](https://www.thenation.com/article/politics/young-democrats-amanda-litman-run-for-something-gen-z-millenials-youth-elections/)) [med].
- **Website implication:** a "receipts" page showing what the group did, with real numbers only. Add local-government explainers (county commission, city councils, school board) and a clear funding page, because young people distrust money in politics.

### 5. Trustworthy, plain-language voting and local information

- Among 2024 non-voters, 14% said lack of information was the main reason. Among unregistered youth, 12% did not know how to register or had trouble with forms. Young people of color were almost twice as likely to report registration trouble ([CIRCLE, Jan 15, 2025](https://circle.tufts.edu/latest-research/2024-poll-barriers-issues-economy)) [high].
- Young adults trust **local news organizations (65%)** more than national news organizations (51%) or social media sites (50%) ([Pew, Dec 3, 2025](https://www.pewresearch.org/journalism/2025/12/03/young-adults-and-the-future-of-news/)) [high]. **77%** of young people have checked whether something they saw online was true ([CIRCLE, May 12, 2025](https://circle.tufts.edu/latest-research/youth-rely-digital-platforms-need-media-literacy-access-political-information)) [high].
- Only 34% of 18-29-year-olds expect the 2026 elections to be fair and accurate ([Harvard Youth Poll, Fall 2026](https://iop.harvard.edu/youth-poll/latest-poll)) [high].
- **Website implication:** voter tools that link straight to official sources, such as the Seminole Supervisor of Elections and the state registration site (already set up in `assets/js/config.js` → `links.vote`). Every explainer should show a "last checked" date and its source.

### 6. Content where they already are, in formats they can share and make

- **45%** of young people get political information from social posts by organizations they follow, 43% from traditional news and 40% from news outlets' social posts ([CIRCLE, May 21, 2026](https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy)) [high].
- **43%** of adults under 30 regularly get news on TikTok, 41% on YouTube, 41% on Facebook and 40% on Instagram. One caution: young adults are *less* likely than older adults to prefer watching news, and more likely to prefer reading or listening ([Pew, Dec 3, 2025](https://www.pewresearch.org/journalism/2025/12/03/young-adults-and-the-future-of-news/)) [high]. So video should sit alongside text, not replace it.
- **29%** have made their own political content at least sometimes after seeing political content, and 10% do it often or all the time ([CIRCLE, May 12, 2025](https://circle.tufts.edu/latest-research/youth-rely-digital-platforms-need-media-literacy-access-political-information)) [high]. Members are creators, and a site can give them a stage.
- **Website implication:** a moderated member video wall, captions on everything, share cards for every event, and copy written to be screenshotted. Only 1 of 22 audited sites embeds video, and none accepts member uploads.

### 7. A path to lead, and to run

- Run for Something's pipeline passed **250,000** potential candidates as of Jan 20, 2026 ([RFS press release](https://runforsomething.net/rfs-press/rfs-pipeline-surpasses-250000/)) [med: self-reported]. It reports **80,000 sign-ups in 2025**, more than its whole total from Trump's first term ([The Nation, Apr 7, 2026](https://www.thenation.com/article/politics/young-democrats-amanda-litman-run-for-something-gen-z-millenials-youth-elections/)) [med].
- Wealthier youth are twice as likely as struggling youth to have pursued office ([CIRCLE, Sep 30, 2025](https://circle.tufts.edu/latest-research/youth-are-taking-civic-action-need-opportunities-and-support-overcome-socioeconomic)) [high]. The barriers named are cost, time and not knowing the mechanics, such as ballot access and budgets ([The Nation](https://www.thenation.com/article/politics/young-democrats-amanda-litman-run-for-something-gen-z-millenials-youth-elections/)) [med].
- Florida's young organizers make the case for peer-led outreach. The founder of a Florida youth PAC said young people organizing young people is the most efficient approach ([Palm Beach Post via Yahoo, Feb 3, 2024](https://www.yahoo.com/news/young-democrats-form-pac-push-100319811.html)) [med].
- **Website implication:** a leadership ladder (show up → host → lead → run) and a "run local" explainer. In the audit, only 2 of 22 sites have a pipeline.

### 8. Career and skills value

- 86% of Gen Z professionals say in-person networking is vital for career growth ([Freeman / Harris Poll, Gen Z Report 2025](https://www.freeman.com/wp-content/uploads/2025/01/Freeman-Gen-Z-Report-2025_FINAL.pdf)) [med: vendor survey].
- Chapters already offer this offline and on a few sites: San Diego's résumé bank and jobs board, YDNC's jobs board, SF YD's workshops ([sdyoungdems.com](https://www.sdyoungdems.com/), [ydnc.org](https://ydnc.org/), [sfyd.org](https://www.sfyd.org/)) [med]. 64% of 18-29s see AI replacing jobs as a serious threat to their finances ([Harvard Youth Poll, Fall 2026](https://iop.harvard.edu/youth-poll/latest-poll)) [high], so skills and networks are a real draw.
- **Website implication:** a skills and opportunities board (internships, campaign jobs, mentor coffees). Label demo entries clearly as demo.

### 9. Seeing themselves represented: bilingual, LGBTQ+, disabled, all welcome

- Seminole County is about **24% Hispanic**: 24.3% in Census QuickFacts' 2024 estimates ([QuickFacts](https://www.census.gov/quickfacts/fact/table/seminolecountyflorida/PST045224)) [med: seen via search; the page blocked direct fetch] and 23.9% in Data USA's 2024 figures ([Data USA](https://datausa.io/profile/geo/seminole-county-fl)) [med]. The Harvard Youth Poll is fielded in English and Spanish, and 59% of Hispanic respondents report financial strain ([Harvard](https://iop.harvard.edu/youth-poll/latest-poll)) [high].
- **62%** of Gen Z voters worry about being mistreated or denied opportunities because of part of their identity, and 78% are concerned about discrimination against transgender people ([HIT/URGE](https://urge.org/wp-content/uploads/2026/08/HIT_URGE_Press-Memo-2026-Young-Voter-Poll.pdf)) [med]. LGBTQ youth report higher intent to vote: 66% extremely likely, against 56% overall ([CIRCLE, May 21, 2026](https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy)) [high].
- More than 1 in 4 US adults (over 70 million) report a disability ([CDC, Jul 16, 2024](https://www.cdc.gov/media/releases/2024/s0716-Adult-disability.html)) [high]. SemDems already runs a monthly Disability Caucus ([state party calendar](https://events.floridadems.org/org/seminole-county-democrats)) [high].
- **Website implication:** a real English/Spanish toggle with human-reviewed copy (only HSDA has one in the sample), visible LGBTQ+ inclusion, and access information on every event (step-free entry, parking, sober-friendly, captions).

### 10. A door for independents and the not-yet-sure

- CIRCLE calls for nonpartisan paths to engagement and "political homes" for independents, the least engaged group: only 38% are extremely likely to vote, against 68% of Democrats ([CIRCLE, May 21, 2026](https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy)) [high]. Among independent likely voters under 30, 55% favored Democrats this fall ([Harvard Youth Poll](https://iop.harvard.edu/youth-poll/latest-poll)) [high].
- Florida had 3,345,188 no-party-affiliation voters out of 13,672,122 active voters as of Sep 30, 2026 ([Florida Division of Elections](https://dos.fl.gov/elections/data-statistics/voter-registration-statistics/voter-registration-reports/voter-registration-by-party-affiliation/)) [med: figures via search summary; the page blocked direct fetch].
- **Website implication:** "Anyone can come to trivia" social events open to all, while voting membership follows the chapter's bylaws. Use plain-language "why Democrats" pages rather than insider jargon.

**Context for after the election.** CIRCLE's early estimate puts 2026 youth turnout at **27%**, the second-highest midterm in 30 years, and about 30% across 14 battleground states including Florida. Young voters backed Democratic House candidates **66% to 31%** ([CIRCLE, Nov 5, 2026](https://circle.tufts.edu/latest-research/2026-youth-voter-turnout-second-highest-last-30-years)) [high; preliminary, to be revised in spring 2027]. Only 33% of 18-29s said in early October that they would definitely vote ([Harvard](https://iop.harvard.edu/youth-poll/latest-poll)) [high]. The post-election months are when a club either keeps these voters or loses them.

**AI caution, since Claude is in the brief.** 64% of 18-29s see AI replacing jobs as a serious financial threat ([Harvard](https://iop.harvard.edu/youth-poll/latest-poll)) [high], and 81% of Gen Z voters are concerned that AI is making it harder to get a job ([HIT/URGE](https://urge.org/wp-content/uploads/2026/08/HIT_URGE_Press-Memo-2026-Young-Voter-Poll.pdf)) [med]. Any AI feature should be clearly labeled, optional and plainly useful, and never stand in for people.

---

## 6. Demand vs supply: the gaps no chapter site fills

| What young Dems want (rank) | Best evidence | Audited sites that deliver it well | Gap for youngsemdem to own |
|---|---|---|---|
| Be asked, with a next step (1) | 37% never contacted; 59% of non-voters | 4/22 have a working events calendar; no Florida chapter shows a dated next event on its homepage | **"Next up" strip** with date, place, cost and one-tap RSVP, plus a follow-up |
| Friends and fun (2) | 19% joined a club, 82% talk politics with friends | 2/22 present social events | **Social-first calendar** with vibe tags and first-timer notes |
| Low cost, low friction (3) | 49% financially strained | Only MYD (Superstar tier) and YDSC (non-voting tier) address hardship | **Free or pay-what-you-can join** in under 60 seconds |
| Proof it matters locally (4) | 70% vs 31% likely to vote by efficacy | 0/22 show local impact receipts | **Receipts page** (real numbers only) and local-government explainers |
| Trustworthy voting info (5) | 14% of non-voters lacked info; local news most trusted | 5/22 have working voter tools | **Seminole voter toolkit** linking to official sources, with "last checked" dates |
| Shareable, makeable content (6) | 45% get info from orgs' posts; 29% create | 1/22 embeds video; 0 share cards; 0 member uploads | **Member video wall** with moderation and captions, and share cards everywhere |
| Lead and run (7) | 250,000+ in the RFS pipeline | 2/22 have a pipeline | **Leadership ladder** and "run local" explainer |
| Career value (8) | 86% say networking is vital (vendor) | 4/22 offer professional development | **Opportunities board** and mentor coffees |
| Representation (9) | 24% Hispanic county; 62% worry about identity bias | 1/22 has a Spanish toggle; 2/22 pass basic accessibility | **Real EN/ES, WCAG 2.2 AA, access info on events** |
| Door for independents (10) | Independents least engaged | 0/22 address non-members directly | **"Come as you are" events and plain-language explainers** |

**Further gaps the audit exposed**
1. **Text-to-join.** Only Sunrise has one, though it suits tabling and QR codes at parties (City & State's QR gift bags show it working offline) [high].
2. **Newcomer onboarding.** No site explains what happens at a first meeting, even though YDA's own retention advice is exactly that [med].
3. **Maintenance by design.** Stale footers, 2024 posts, swapped links and lapsed domains all show that chapter sites decay when volunteers rotate out [high]. A site needs dated content that expires, data files instead of hand-edited pages, and domain ownership held by the organization.
4. **Safety for minors.** YDSC admits members from age 14 ([ActBlue: ydscdues](https://secure.actblue.com/donate/ydscdues)) [high], yet no audited chapter site states a photo, video or SMS policy for minors. This matters for any member-upload feature.
5. **Share-readiness.** Pinellas has no `og:image` (measured) [high], and the state party calendar offers no WhatsApp or text share option [high]. Event links pasted into group chats preview badly or not at all.

---

## 7. Recommendations: 10 must-haves and 10 delights for youngsemdem

These are written for the demo but structured to port to a real domain. Where the repo already has a hook, the relevant file is named.

### 10 must-haves

1. **"Next up" event strip and a full calendar.** Show the next 1-3 events on the homepage with date, time (am/pm), neighborhood, cost, a vibe tag and one-tap RSVP, plus an add-to-calendar `.ics` download and a map link (`assets/js/cal.js`). Each event gets a "First time? Here's what happens" note. *Why:* rank 1-2; only 4/22 sites do this.
2. **Join in 60 seconds, money optional.** Ask for name, email, ZIP or city and interests; phone only with explicit SMS consent text. Show dues openly, with a free or hardship path and a pay-it-forward tier modeled on MYD's Superstar. Keep the age range consistent with whatever cutoff is decided. Use placeholder dues in demo mode and never YDSC's real $20 form. *Why:* rank 3; MYD and YDSC precedents.
3. **Text-to-join keyword and QR code** for parties and tabling (demo keyword only until a real SMS vendor is wired up). *Why:* only Sunrise has one; City & State's QR gift bags.
4. **Seminole voter toolkit, EN/ES.** Check registration, request vote-by-mail, polling place, early voting and upcoming elections, all linking to official pages already verified in `config.js` (`links.vote.*`), plus a "make a plan" card. Show "last checked" dates. *Why:* rank 5; 10/22 sites have no voter tools at all.
5. **A real Spanish toggle (not a machine widget),** with human-reviewed copy, `hreflang` and `lang` attributes, and Spanish share texts. Build on the existing `site.locales: ['en','es']`. *Why:* rank 9; 1/22 sites have one; SemDems relies on a GTranslate widget plus a PDF.
6. **Volunteer menu sorted by time and skill:** 1 hour, from your couch, creative (design, video, translation), and leadership roles. *Why:* rank 3; flexible commitments help struggling youth take part (CIRCLE).
7. **A newsletter that actually works, with a public archive,** in the brand voice, plus SMS opt-in that meets TCPA consent rules. Test the form end to end before launch. *Why:* 3/22 sites have dead newsletter forms; 8/22 have none.
8. **Group-chat-ready sharing.** Every event and page gets a pre-rendered Open Graph image, a Web Share button with pre-written English and Spanish messages, and copy-link, `sms:` and WhatsApp fallbacks (`assets/js/share.js`, `assets/js/cards.js`; see report 04). *Why:* rank 6; Pinellas has no og:image, and the state calendar has no text or WhatsApp share.
9. **Accessibility and inclusion baseline: WCAG 2.2 AA.** That means skip link, alt text, 4.5:1 text contrast, visible focus, labeled forms, captions on all video, `prefers-reduced-motion`, optional pronoun fields and access details on every event. *Why:* rank 9; 9 of the 18 sites checked fail basic checks; WebAIM's 95.9% failure rate.
10. **Trust and portability layer.** Include About, leadership, bylaws, an endorsement-process page (as Brooklyn has), a funding page, privacy policy and the legal disclaimer (placeholder in `config.js` → `legal.paidFor`). Content carries "updated" dates and expiry. The site stays static HTML/CSS/JS with data in `data/*.js`, integrations stay behind `config.js` switches, and the domain is registered to an organizational email with auto-renew and at least two admins. *Why:* the lacyd.org, gomyd.com, miyoungdems.org and payoungdems.org lessons, plus stale content across the sample.

### 10 delights

1. **Member video wall with moderated uploads** (`assets/js/clips.js`, `data/clips.js`). Short vertical clips such as "why I vote", event recaps and explainers, all captioned. A consent checkbox, a rule that minors (14-17) need guardian consent, and admin approval before anything is public. *Why:* rank 6; 29% of young people create political content; 0/22 sites accept uploads.
2. **"Receipts" board.** Doors knocked, voters registered, events held and local wins, using real data only, with demo figures flagged `demo:true` and never shown as real. *Why:* rank 4.
3. **Bring-3-friends ladder.** Personal invite links, a "your squad" view and friend RSVPs (`integrations.squadEndpoint`). *Why:* rank 1-2; 82% already talk politics with friends; relational evidence is in report 04.
4. **Social calendar with personality.** Recurring formats with vibe tags (chill, loud, sober-friendly, kid-friendly, outdoors), such as trivia, friendship-bracelet nights, pickleball, drag bingo, lake cleanups and Sanford brewery nights. These are illustrative demo events labeled as demo. *Why:* rank 2; the NYC party model.
5. **Organizer-type quiz with share cards** ("Which kind of organizer are you?"), with pre-rendered 9:16 and 4:5 results (see report 04). *Why:* identity-plus-sharing mechanics; 0/22 sites have one.
6. **"Run local" explorer.** Explains what county and city offices do and what it takes to run (filing, cost, time), links to Run for Something, and offers a demo "coffee with a mentor" request. Real office data must be verified before launch. *Why:* rank 7.
7. **Opportunities board.** Internships, campaign jobs, a résumé drop and mentor coffees, copying San Diego's and YDNC's model. *Why:* rank 8.
8. **"Ask" helper powered by Claude, if it stays in scope** (see Open question 2). Plain-language explainers of local government and voting rules with links to official sources, plus English↔Spanish translation and help drafting an invite text. Clearly labeled as AI, never impersonating people, never giving individual voting advice. *Why:* rank 5 and 9; it must be framed around utility because of young people's AI skepticism.
9. **"Seminole Wrapped" in December.** A recap card set of the group's year that members can share (see report 04). *Why:* shareable proof of impact (rank 4 and 6).
10. **Sticker and merch drop** with downloadable sticker packs and phone wallpapers. Merch can be earned by volunteering rather than only bought, a Mamdani-campaign idea covered in report 03. *Why:* 7/22 sites sell merch; none ties it to participation.

**Two things to avoid, learned from the audit:** builder residue (empty carts, duplicated menus, placeholder emails, swapped links), and a homepage that asks for money before it says hello. Money buttons work on 18 of 22 sites. Hello, with a date, works on 4.

---

## 8. Open questions

1. **Relationship with YDSC (critical).** Is youngsemdem a pitch to the existing Young Democrats of Seminole County, a new group, or a personal demo? Who owns `youngsemdems.com` (it expires Dec 31, 2026)? Can the demo link to YDSC's ActBlue or meetings, or must it stay generic? The name "Young Seminole Democrats" is close enough to cause confusion.
2. **Is an AI helper in scope?** The brief asks to integrate Claude, but the comment at the top of `youngsemdem/assets/js/config.js` says the chat assistant was cut by Kira in Nov 2026. Delight 8 assumes Kira confirms one way or the other.
3. **Age cutoff and floor.** Kira says "40 and under". YDSC says 14 to under 40. YDA says under 36. Pennsylvania YD says 40 and under, and Georgia's join page reportedly says 14 to 40 (seen only in search results). `config.js` uses `ageCap: 40` and `minAge: 13`. Which rule governs?
4. **Minors policy.** If members can be 14-17, what is the policy on photos, video uploads, SMS and DMs? This needs a written rule before member uploads go live.
5. **Event and contact tooling.** Should youngsemdem plug into SemDems' Solidarity Tech (act.semdems.com) so Seminole has one list, or use Mobilize, Action Network (as `config.js` assumes) or Partiful? This decides whether "one-tap RSVP" stays on-site.
6. **Legal disclaimer.** What disclaimer wording does a county Young Dems website need under Fla. Stat. 106.143, and who is the paying entity? This needs the party's counsel.
7. **Spanish reviewer and other languages.** Who reviews the Spanish copy? Is Haitian Creole, Portuguese or Vietnamese wanted? Seminole language-at-home data was not verified here, because the Census API needs a key and QuickFacts blocked direct fetch.
8. **Election dates to populate the voter toolkit.** As of Nov 9, 2026, the Seminole SOE lists no 2027 or 2028 dates (noted in `config.js`). Municipal election dates for Sanford, Lake Mary, Oviedo, Winter Springs, Altamonte Springs, Casselberry and Longwood need verifying with the SOE.
9. **Data for Progress.** No 2025-2026 Data for Progress poll focused on young voters turned up. The newest found is its Oct 22, 2024 Young Voters Report ([DFP](https://dataforprogress.org/memos/10/21/2024-young-voters-report-young-voters-are-enthusiastic-to-vote-strongly-prefer-harris-to-trump)). If Kira wants DFP numbers specifically, they need a direct request or a newer release.
10. **CIRCLE's 2026 non-voter analysis** is promised "in the coming weeks" ([CIRCLE, Nov 5, 2026](https://circle.tufts.edu/latest-research/2026-youth-voter-turnout-second-highest-last-30-years)). Revisit this report when it lands, especially for contact rates in 2026.
11. **Not assessed:** the Young Democrats of Georgia site (youngdemsga.org) was blocked by this session's network, and Manhattan's and LA County's sites were read only through a page reader.

---

## 9. Sources

**Seminole and Florida**
1. Young Democrats of Seminole County, ActBlue page. https://secure.actblue.com/donate/youngsemdems
2. YDSC membership dues ($20), ActBlue. https://secure.actblue.com/donate/ydscdues
3. YDSC Musical Theatre Review fundraiser, ActBlue. https://secure.actblue.com/donate/ydscmusicaltheatre
4. Florida Democrats events: Seminole County Democrats (accessed Nov 9, 2026). https://events.floridadems.org/org/seminole-county-democrats
5. Seminole County Democratic Party homepage (measured Nov 9, 2026). https://semdems.com/
6. SemDems 2026 Spanish voter guide (PDF). https://semdems.com/wp-content/uploads/2026/09/SemDems-Voter-Guide-2026-SPANISH.pdf
7. SemDems monthly meeting RSVP on Solidarity Tech. https://act.semdems.com/semdems-monthly-meeting
8. Florida Democrats events: Young Democrats of Orange County monthly meeting (Nov 26, 2026). https://events.floridadems.org/event/19001/young-democrats-of-orange-county-monthly-meeting
9. Orange County DEC on Solidarity Tech, YDOC meeting page. https://orange-dec.solidarity.tech/young-democrats-of-orange-county-monthly-meeting
10. Florida Young Democrats homepage. https://www.floridayoungdems.com/
11. Pinellas County Young Democrats homepage (measured). https://www.pinellasyoungdems.org/
12. Pinellas YD membership, ActBlue. https://secure.actblue.com/donate/joinpcyd
13. Jacksonville Young Democrats homepage. https://www.jaxyoungdems.org/
14. Hillsborough Young Dems homepage. https://hillsyoungdems.com/
15. Leon County Young Democrats blog (2007). https://lcyd.blogspot.com/2007/06
16. Palm Beach County Democrats youth committee (Canva site). https://pbcycc.my.canva.site
17. Blue Voter Guide, Miami-Dade Young Dems listing. https://bluevoterguide.org/endorser-org/Miami-Dade_Young_Dems/FL/5803
18. Blue Voter Guide, Broward Young Democrats listing. https://bluevoterguide.org/endorser-org/Broward_Young_Democrats/FL/4203
19. Palm Beach Post via Yahoo News, "Young Democrats form a PAC to push turnout in 2024" (Feb 3, 2024). https://www.yahoo.com/news/young-democrats-form-pac-push-100319811.html
20. Florida Division of Elections, voter registration by party affiliation. https://dos.fl.gov/elections/data-statistics/voter-registration-statistics/voter-registration-reports/voter-registration-by-party-affiliation/
21. U.S. Census Bureau QuickFacts, Seminole County, FL. https://www.census.gov/quickfacts/fact/table/seminolecountyflorida/PST045224
22. Data USA, Seminole County, FL. https://datausa.io/profile/geo/seminole-county-fl

**Audited national, state and city sites**
23. Young Democrats of America (measured). https://yda.org/
24. YDA blog, "New faces at your chapter meeting? Here's how to keep them coming back" (2017). https://yda.org/blog/new-faces-at-your-chapter-meeting-heres-how-to-keep-them-coming-back/
25. Texas Young Democrats (measured). https://www.texasyds.com/
26. Young Democrats of Arizona. https://www.ydaz.org/
27. Pennsylvania Young Democrats (redirects to payd.squarespace.com). https://payoungdems.org/
28. Brooklyn Young Democrats. https://brooklynyoungdems.org/
29. Manhattan Young Democrats. https://manhattanyoungdems.org/
30. Manhattan Young Democrats membership tiers, ActBlue. https://secure.actblue.com/donate/myd-membership
31. Idealist listing for Manhattan Young Democrats (gomyd.com). https://www.idealist.org/en/nonprofit/238dd0b74b1f4073a2465cd74ab87914-manhattan-young-democrats-new-york
32. Young Democrats of North Carolina (measured). https://ydnc.org/
33. San Francisco Young Democrats (measured). https://www.sfyd.org/
34. San Diego County Young Democrats (measured). https://www.sdyoungdems.com/
35. Orange County (CA) Young Democrats. https://www.ocyd.org/
36. College Democrats of America (measured). https://collegedemocratsofamerica.com/
37. Brown Daily Herald, op-ed by the CDA president (Feb 2026). https://www.browndailyherald.com/article/2026/02/vaddula-27-im-the-president-of-the-college-democrats-of-america-young-people-are-key-to-the-success-of-the-democratic-party
38. High School Democrats of America (measured). https://hsdems.org/
39. Voters of Tomorrow (measured). https://votersoftomorrow.org/
40. Gen-Z for Change (measured). https://genzforchange.org/
41. NextGen America (measured). https://nextgenamerica.org/
42. Run for Something (measured). https://runforsomething.net/
43. Sunrise Movement (measured). https://www.sunrisemovement.org/
44. Sunrise Movement, hubs. https://sunrisemovement.org/hubs
45. March for Our Lives (measured). https://marchforourlives.org/
46. Wikipedia, Los Angeles County Young Democrats (cites the archived lacyd.org). https://en.wikipedia.org/wiki/Los_Angeles_County_Young_Democrats
47. Internet Archive, lacyd.org (Mar 1, 2011). https://web.archive.org/web/20110301081859/http://www.lacyd.org/index.php
48. Young Democrats of Michigan, 2025 Demsgiving ActBlue page (miyoungdems.org contact). https://secure.actblue.com/donate/2025-demsgiving

**Organizer reporting**
49. City & State New York, "New York City's young Democrats want to put the party back in party" (Nov 4, 2025). https://www.cityandstateny.com/politics/2025/11/new-york-citys-young-democrats-want-put-party-back-party/409298/
50. The Current (GA), "Georgia's young Democrats gather in Statesboro to discuss a fresh path" (Sep 8, 2025). https://thecurrentga.org/2025/09/08/georgias-young-democrats-gather-in-statesboro-to-discuss-a-fresh-path/
51. The Nation, interview with Amanda Litman of Run for Something (Apr 7, 2026). https://www.thenation.com/article/politics/young-democrats-amanda-litman-run-for-something-gen-z-millenials-youth-elections/
52. Run for Something, "RFS pipeline surpasses 250,000" (Jan 20, 2026). https://runforsomething.net/rfs-press/rfs-pipeline-surpasses-250000/

**Youth research**
53. CIRCLE, "2026 Youth Voter Turnout Second-Highest for a Midterm Election in the Last 30 Years" (Nov 5, 2026). https://circle.tufts.edu/latest-research/2026-youth-voter-turnout-second-highest-last-30-years
54. CIRCLE with When We All Vote, "Youth Are Likely to Vote in 2026, But Want to See Big Changes in Democracy" (May 21, 2026). https://circle.tufts.edu/latest-research/youth-are-likely-vote-2026-want-see-big-changes-democracy
55. CIRCLE, Post-2024 Election Youth Poll: barriers, issues, economy (Jan 15, 2025). https://circle.tufts.edu/latest-research/2024-poll-barriers-issues-economy
56. CIRCLE, "Barriers and Hardships: Why Some Youth Didn't Vote in 2024" (Jul 31, 2025). https://circle.tufts.edu/latest-research/barriers-and-hardships-why-some-youth-didnt-vote-2024
57. CIRCLE, "Youth Rely on Digital Platforms, Need Media Literacy to Access Political Information" (May 12, 2025). https://circle.tufts.edu/latest-research/youth-rely-digital-platforms-need-media-literacy-access-political-information
58. CIRCLE, "Youth Are Taking Civic Action but Need Opportunities and Support to Overcome Socioeconomic Barriers" (Sep 30, 2025). https://circle.tufts.edu/latest-research/youth-are-taking-civic-action-need-opportunities-and-support-overcome-socioeconomic
59. Harvard Youth Poll, 53rd edition, Fall 2026 (fielded Sep 30-Oct 7, 2026). https://iop.harvard.edu/youth-poll/latest-poll
60. Pew Research Center, "Young Adults and the Future of News" (Dec 3, 2025). https://www.pewresearch.org/journalism/2025/12/03/young-adults-and-the-future-of-news/
61. HIT Strategies for URGE, 2026 Gen Z voter poll memo (Aug 27, 2026). https://urge.org/wp-content/uploads/2026/08/HIT_URGE_Press-Memo-2026-Young-Voter-Poll.pdf
62. Data for Progress, 2024 Young Voters Report (Oct 22, 2024). https://dataforprogress.org/memos/10/21/2024-young-voters-report-young-voters-are-enthusiastic-to-vote-strongly-prefer-harris-to-trump
63. Gallup, "Younger Men in the U.S. Among the Loneliest in West" (May 20, 2025). https://news.gallup.com/poll/690788/younger-men-among-loneliest-west.aspx
64. Eventbrite Social Study 2026, Business Wire release (Jan 14, 2026; vendor survey). https://www.businesswire.com/news/home/20260114088488/en
65. Freeman and The Harris Poll, Gen Z Report 2025 (vendor survey, PDF). https://www.freeman.com/wp-content/uploads/2025/01/Freeman-Gen-Z-Report-2025_FINAL.pdf
66. CDC, "CDC Data Shows Over 70 Million U.S. Adults Reported Having a Disability" (Jul 16, 2024). https://www.cdc.gov/media/releases/2024/s0716-Adult-disability.html
67. WebAIM, The WebAIM Million, 2026 edition. https://webaim.org/projects/million/
