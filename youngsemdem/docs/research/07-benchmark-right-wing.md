# 07 · Competitive teardown: right-wing youth and campaign websites

*Research for the youngsemdem demo site (Young Seminole Democrats: Seminole County, FL Democrats aged 40 and under). Compiled Monday, November 9, 2026, six days after the Nov 3 general election. Every claim links to its source and carries a confidence tag. The point of this file is to learn from the strongest opposing youth operations and beat them on quality. It describes them as they are, without mockery.*

*Method. On Nov 9, 2026 I loaded 26 pages from 24 organizations in headless Chromium (Playwright 1.63) at 390 x 844 (iPhone user agent, 2x pixels) and 1440 x 900, with a cold cache. For each page I recorded bytes transferred, request count, paint timings, layout shift and long tasks. I also counted the links and buttons visible on the first screen, noted overlays such as cookie banners, modals and age gates, checked for email and phone fields, video, a Spanish option and a skip link, and listed ad and analytics tags from the network log. On the mobile view I ran an axe-core 4.14 scan (WCAG 2.0 to 2.2, A and AA), and I ran Lighthouse 13.6 (mobile, default simulated throttling) on 21 pages. Three sites refused automated browsers. **gop.com** returned 403. **yrnf.com** showed a "Checking your browser" page, so I read it with a page reader instead. **rondesantis.com** showed a Cloudflare "Just a moment" challenge; it let the browser through once, on desktop, and redirected to floridafreedomfund.com. The Wayback Machine (web.archive.org) could not be reached from this environment, so the 2024 Trump campaign site is described from news reports. The test machine was shared with other jobs, so treat millisecond timings as lab values [med]. Bytes, requests, tags, overlays and axe results are direct measurements [high]. Screenshots are stored outside the repo at `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/bench/right-<slug>-mobile.png` and `-desktop.png` (full-page JPEGs alongside; blocked sites are suffixed `-BLOCKED`).*

*Confidence key. **[high]**: measured directly or a primary source, recent. **[med]**: reputable secondary report, an organization's own claim, or a third-party estimate. **[low]**: single unverified source, or modeled data such as Similarweb's free tier.*

---

## Headline

The right's youth machine wins young people **away from its websites**, through campus tours, creators, podcasts, merch and big events. Its websites are mostly donor and store front doors, and that gap is youngsemdem's opening. Turning Point USA (TPUSA) is the clear leader. It claims more than 1,500 college chapters and 3,500 high school chapters, backed by 90-plus field reps. It runs a points-for-activism rewards program, free "activism kits", a chapter map, and an open-mic campus format ("Pick Up the Mic") that it says is growing from 50 events last spring to more than 300 this fall. Its event and merch pages are among the most Gen Z-fluent designs in politics. But the pages are heavy and cluttered. On a phone, the TPUSA home page transferred **19.0 MB** and its start-a-chapter page **28.6 MB**, mostly autoplay video. Lighthouse performance scores ran 32 to 51. A privacy banner covers 27 to 39% of the first screen, and every TPUSA page I measured loaded 8 to 10 ad and analytics tags. Across all 23 pages that loaded, **none offered Spanish**, most failed basic automated accessibility checks, and several showed visible polish bugs: a builder's placeholder menu, a headline cut off at phone width, "Insert/edit link" used as a page title, a 2020 copyright. Local Republican sites are thin. The Seminole GOP site has no social links and no youth path, and no website was found for the Central Florida Young Republicans chapter that covers Seminole. Similarweb's modeled data suggests these websites draw older visitors (largest groups 35 to 65+), even where the organizations' video audiences are young. Meanwhile the field is moving toward Democrats: CIRCLE estimates young voters chose Democrats for the House by 35 points on Nov 3. **youngsemdem should copy the mechanics, not the build.** That means one clear action per screen, real social proof, a chapter-in-a-box, rewarded activism, tentpole events, video and participation formats, merch drops and belonging-first copy. It should then beat them on what they neglect: a page under 0.5 MB, no modals, WCAG 2.2 AA, full Spanish, privacy-first analytics, a hyper-local calendar and visible community safety.

---

## Contents

1. [Context: where the right is winning, and where it is not](#1-context-where-the-right-is-winning-and-where-it-is-not)
2. [Measured scorecard](#2-measured-scorecard)
3. [Judgment scorecard](#3-judgment-scorecard)
4. [Site-by-site teardown](#4-site-by-site-teardown)
5. [The 10 things they do that youngsemdem must match or beat](#5-the-10-things-they-do-that-youngsemdem-must-match-or-beat)
6. [The 10 weaknesses youngsemdem can exploit](#6-the-10-weaknesses-youngsemdem-can-exploit)
7. ["Beat them by" specs](#7-beat-them-by-specs)
8. [Do not copy](#8-do-not-copy)
9. [Recommendations for youngsemdem](#9-recommendations-for-youngsemdem)
10. [Open questions](#10-open-questions)
11. [Sources](#11-sources)

---

## 1. Context: where the right is winning, and where it is not

**The youth vote swung back hard in 2026, but the right's infrastructure is bigger than ever.**

- **Nov 3, 2026 results.** CIRCLE estimates youth turnout (ages 18 to 29) at 27%, matching 2022 and the second-highest midterm youth turnout in 30 years. Young voters chose Democrats for the House **66% to 31% (D+35)**, up from D+14 in 2024. Young women voted 70% Democratic and young men 59% to 37% Democratic. In 2024, by contrast, young men backed Trump 56% to 42% (AP VoteCast). CIRCLE flags these as preliminary NORC figures ([CIRCLE 2026 election hub](https://circle.tufts.edu/2026-election)) [high for what CIRCLE published; the estimates themselves are preliminary].
- **Mood going in.** A May 2026 Times/Siena poll found 76% of young voters disapproved of President Trump, up 10 points in about a year ([Boston Globe, Sept 11, 2026](https://www.bostonglobe.com/2026/09/11/nation/republican-midterm-convention-influencers/)) [med].
- **Florida stayed red at the top.** Republican Byron Donalds won the governor's race by about 1.3 points with 98% counted ([WPTV](https://www.wptv.com/news/political/elections-local/republican-byron-donalds-wins-election-for-governor-in-florida)) [high]. Republicans hold roughly a 1.5 million voter registration edge statewide ([WLRN, Oct 19, 2026](https://www.wlrn.org/government-politics/2026-10-19/florida-democrats-see-minor-gain-but-republicans-keep-large-1-5-million-edge-with-registered-voters)) [high]. Seminole County went the other way: Democrats carried it on unofficial returns, and independents (NPA) are the largest bloc among voters under 40 (see `01-seminole-local.md`, §6) [high, per that file].
- **TPUSA after Charlie Kirk.** Charlie Kirk was shot and killed on Sept 10, 2025 while speaking at Utah Valley University. The TPUSA board unanimously named his widow, Erika Kirk, CEO and board chair ([CBS News](https://www.cbsnews.com/news/erika-kirk-charlie-kirk-widow-turning-point-usa-ceo/)) [high]. TPUSA said it received more than 32,000 inquiries about new campus chapters within 48 hours of his death and cited higher totals later. These counts are self-reported and unverified ([Campus Reform](https://campusreform.org/article/32000-requests-new-tpusa-campus-chapters-filed-since-charlie-kirks-death/28627); [Fox News](https://www.foxnews.com/politics/this-turning-point-tpusa-says-campus-chapter-requests-surge-over-37000-after-kirks-assassination)) [med]. AmericaFest 2025 in Phoenix drew about 31,000 people, roughly a third of them students ([Religion News Service](https://religionnews.com/2025/12/20/at-amfest-turning-point-usa-leaders-leverage-kirks-martyrdom-to-rally-young-voters/)) [med]. TPUSA's YouTube channel grew from 3.3 million to 3.9 million subscribers in the week after his death ([Fox Business, Sept 16, 2025](https://www.foxbusiness.com/politics/charlie-kirks-social-media-platforms-gain-millions-followers-subscribers-since-assassination)) [med].
- **Campus format at scale.** TPUSA said it held 50 "Pick Up the Mic" events in spring 2026 and expected more than 300 in the fall. It describes the program as a "farm system" for new conservative speakers ([The National Desk, Aug 28, 2026](https://thenationaldesk.com/news/americas-news-now/battle-for-young-voters-intensifies-ahead-of-midterms-tpusa-shares-strategy-november-charlie-kirk-hasan-piker)) [med]. Featured speakers include Riley Gaines and Chloe Cole ([Daily Signal, July 12, 2026](https://www.dailysignal.com/2026/07/12/charlie-kirk-mic/)) [med].
- **Creators and platforms.** The RNC opened its first TikTok account in early 2026 ([RNC press release, Feb 6, 2026](https://gop.com/press-release/icymi-fox-news-rnc-rolls-out-powerful-new-tiktok-strategy-to-win-over-key-demographic-after-trumps-2024-success); the page blocked my fetch, so this comes from search listings) [med]. At its midterm convention in Dallas in September 2026, the party credentialed more than 100 creators, gave them prime seats and a filming platform, and hosted a TikTok after-party ([Boston Globe](https://www.bostonglobe.com/2026/09/11/nation/republican-midterm-convention-influencers/)) [med]. The White House TikTok account launched Aug 19, 2025 ([ABC13](https://abc13.com/post/white-house-joins-tiktok-delaying-enforcement-sale-ban-law/17594566/)) [high]. By July 2026 it had about 7 million followers, and Trump's personal account about 16.6 million per Social Blade ([IBTimes UK, July 7, 2026](https://www.ibtimes.co.uk/donald-trump-taylor-swift-more-followers-tiktok-1807203)) [med].
- **The 2024 bro-podcast playbook.** Trump's first podcast appearance was on the Nelk Boys' *Full Send* in March 2022. In 2024 the Nelk-linked "Send the Vote" project said it spent about $20 million targeting 1.1 million inactive male voters aged 18 to 34. It also said its site drew more than 2 million visitors and that 110,000 people asked for voting reminders ([Fox News, Nov 29, 2024](https://www.foxnews.com/politics/inside-how-podcasters-courted-young-male-voters-ahead-trumps-massive-win)) [med: self-reported figures].
- **Gen Z women are a growth target too.** Fortune reports that TPUSA draws young conservative women through TikTok, Erika Kirk as a role model, and women-only events such as the Young Women's Leadership Summit ([Fortune, Dec 19, 2025](https://fortune.com/2025/12/19/i-was-like-wow-if-erika-can-do-it-i-can-do-it-tiktok-and-turning-point-draw-in-conservative-gen-z-women/)) [med].

**The website gap.** Similarweb's free tier models the following audiences for September 2026. It is modeled data, so treat it as directional only [low].

| Site | Similarweb visits figure (label: "Total visits last 3 months") | Largest age group | Top channel |
|---|---|---|---|
| tpusa.com | 421.3K | 35 to 44 | Organic search 52.5% |
| tpusastudents.com | 41K | 55 to 64 | Organic search 35.5% |
| gop.com | 387.4K | 55 to 64 | Organic search 52.2% |
| prageru.com | 2.8M | 65+ | Display ads 33.0% |
| yaf.org | 55.1K | 35 to 44 | Organic search 52.7% |
| officialhodgetwins.com | 90K | 25 to 34 | Direct 26.2% |
| florida.gop | 8.5K | no data | Organic search 56.7% |

Sources: [tpusa.com](https://www.similarweb.com/website/tpusa.com/), [tpusastudents.com](https://www.similarweb.com/website/tpusastudents.com/), [gop.com](https://www.similarweb.com/website/gop.com/), [prageru.com](https://www.similarweb.com/website/prageru.com/), [yaf.org](https://www.similarweb.com/website/yaf.org/), [officialhodgetwins.com](https://www.similarweb.com/website/officialhodgetwins.com/), [florida.gop](https://www.similarweb.com/website/florida.gop/).

PragerU says 60% of its YouTube viewers are under 35 ([PragerU About](https://www.prageru.com/about)) [med: self-reported], yet Similarweb's largest age group for its website is 65+. If both are roughly right, the young audience watches on platforms while older supporters visit, donate and shop on the site. Only one store in the table, a fitness-and-merch brand, skews 25 to 34. **No right-wing organization has a website that is itself a youth hangout. youngsemdem can be one.**

---

## 2. Measured scorecard

Mobile view (390 px) unless noted; measured Nov 9, 2026. "Above-fold CTAs" counts visible links or buttons on the first screen with action words (donate, join, shop, register, watch and so on). "Ad + analytics tags" counts distinct ad pixels, analytics and marketing scripts seen in network requests. "n/m" means not measured. axe counts are rules failed / elements affected.

<!--TABLE_MEASURED-->

Notes on the table:

- **Blocked:** gop.com (403 to the headless browser, curl and the page reader), yrnf.com (bot check), rondesantis.com (Cloudflare challenge; passed once on desktop) [high].
- **Florida Freedom Fund** (where rondesantis.com redirected on the one successful load): 3.1 MB and 141 requests on desktop, Lighthouse not run. It loaded Meta, X and Google Ads pixels and had a phone field with SMS terms. Its only H1 heading read "Insert/edit link", a text-editor leftover [high].
- **Where the bytes go:** autoplay background video. Media made up 15.0 MB of TPUSA home's 19.0 MB, 22.6 MB of the start-a-chapter page's 28.6 MB, 9.2 MB on AmericaFest, and about 55 MB of whitehouse.gov's 59.3 MB [high].
- **Layout shift:** gettrumpsneakers.com scored a cumulative layout shift of 0.71 in my run, well past Google's 0.25 "poor" line, so products jump as the page loads [high]. Trump Store scored 0.16 [high].
- **Third-party hosts:** TPUSA pages contacted 49 to 60 outside domains, Trump Store 84 and Hodgetwins 58 [high].

---

## 3. Judgment scorecard

My scores, from 1 (weak) to 5 (best in class), each based on the measured evidence above and the screenshots. **Conversion** means a clear primary action with low friction. **Belonging** covers identity, peers and local community. **Culture** covers video, design and meme fluency. **Capture** means email, SMS or quiz data collection. **Speed** is weight and Lighthouse performance. **Access** is accessibility and Spanish. **Trust** covers freshness, polish and safety.

| Site | Conversion | Belonging | Culture | Capture | Speed | Access | Trust | Total /35 | One-line verdict |
|---|---|---|---|---|---|---|---|---|---|
| TPUSA home | 3 | 4 | 4 | 2 | 1 | 2 | 3 | 19 | Big-number proof and shows, buried under a 19 MB video hero and a privacy banner; Donate is the only first-screen ask on phones |
| TPUSA Students (start a chapter, Pick Up the Mic) | 4 | 5 | 5 | 3 | 1 | 2 | 3 | 23 | The best youth recruiting design on the right (real students, poster type, app, kits, rewards) at 9 to 29 MB a page |
| Club America (high school) | 4 | 5 | 5 | 2 | 2 | 4 | 3 | 25 | Scrapbook aesthetic, weekly poll, chapter map, free kit, a pledge for under-18s; the only TPUSA page with zero axe errors |
| AmericaFest 2026 | 5 | 4 | 5 | 2 | 1 | 3 | 4 | 24 | Date, place and "Register now" on the first screen; neon event poster; 17 MB |
| TPUSA merch | 4 | 3 | 4 | 5 | 2 | 3 | 3 | 24 | Quiz pop-up asks what drives you; free-shipping threshold, buy-now-pay-later, 10 ad and analytics tags |
| Turning Point Action | 4 | 3 | 3 | 4 | 2 | 1 | 2 | 19 | Election-travel promo with lodging still up after the election; zoom disabled, no `lang` attribute, H1 reads "RioSlum Studio" |
| Young Republican National Federation | 3 | 3 | 1 | 1 | ? | ? | 2 | 10+ | "Recruit. Train. Elect." plus a job board, but no events, no email capture, © 2025; blocks automated browsers |
| Florida Federation of Young Republicans | 2 | 2 | 1 | 1 | 3 | 1 | 1 | 11 | © 2020, no H1, zoom disabled, Lighthouse accessibility 57 |
| CRNC | 4 | 4 | 3 | 1 | 2 | 3 | 2 | 19 | "The best party on campus since 1892" is a great belonging line; the H1 is a merch slogan |
| College Republicans of America | 2 | 3 | 2 | 2 | 4 | 3 | 2 | 18 | Chapter dot-map is useful; the first screen is a July 2025 press release |
| Young America's Foundation | 3 | 5 | 3 | 3 | 2 | 1 | 3 | 20 | Strongest belonging headline on the right; 130 elements fail axe |
| PragerU | 4 | 3 | 4 | 4 | 1 | 4 | 3 | 23 | Polished streaming catalog and premium tier; event modal covers the first screen |
| PragerU Kids | 4 | 2 | 4 | 4 | 1 | 3 | 3 | 21 | Civics-for-kids sign-up modal; approved for supplemental classroom use in Florida |
| donaldjtrump.com | 5 | 1 | 1 | 1 | 5 | 4 | 3 | 20 | Three buttons in 216 KB; maximum clarity, zero community |
| whitehouse.gov (government) | 3 | 2 | 4 | 4 | 1 | 4 | 3 | 21 | Email modal on load; links TikTok, Truth Social and Rumble; 59 MB on a phone |
| Trump Store | 4 | 1 | 2 | 5 | 1 | 2 | 3 | 18 | 10%-off quiz pop-up, Black Friday urgency, 561 requests, 84 outside domains |
| Trump Sneakers (licensed) | 4 | 1 | 2 | 2 | 1 | 2 | 3 | 15 | Add-to-cart on the first screen; severe layout shift |
| Republican Party of Florida | 4 | 3 | 2 | 5 | 3 | 2 | 1 | 20 | Join form on the first screen and identity coalitions; 415 px layout on a 390 px phone, 15 H1s, builder placeholder menu in the markup |
| Seminole County GOP | 2 | 2 | 1 | 1 | 3 | 3 | 2 | 14 | Volunteer list and voter guide; no social links, no events on the home page, page title "Home New" |
| Hodgetwins store | 4 | 3 | 3 | 5 | 2 | 2 | 3 | 22 | Big-number social proof, SMS capture, giveaways |
| Full Send (Nelk) | 3 | 1 | 3 | 3 | 2 | 2 | 3 | 17 | 21+ nicotine age gate; the political crossover lives in the podcast, not the site |
| Riley Gaines | 3 | 2 | 2 | 2 | 3 | 4 | 3 | 19 | A book shop with a pop-up; her movement work happens on tours and with partner organizations |

---

## 4. Site-by-site teardown

### 4.1 Turning Point USA ecosystem

**tpusa.com (home).** The first screen is a looping video and a three-line H1 tribute: "Charlie's vision. America's future. The fight continues." On a phone, the only first-screen actions are two Donate buttons (header and hero), and a privacy notice covers the bottom 39% [high]. Further down: big-number proof ("3,500+ Club America schools", "1,500+ college chapters", "12,000+ faith groups"), "Join a chapter" buttons, a "Latest & upcoming" events carousel, a shows shelf (*Culture Apothecary*, *Prove Me Wrong*, *Turning Point Tonight*, *TPUSA Originals*) and a news feed [high: screenshot]. It runs WordPress with the NitroPack optimizer and loads Meta, TikTok, X, Bing, Google Ads, Hotjar and Simpli.fi tags. Even so, it links to no TikTok account; it links Rumble, YouTube, Instagram, X, Facebook and a Linktree [high]. axe: 17 links with no accessible name, plus one contrast failure. Lighthouse: performance 51, accessibility 91, total blocking time 6.7 s [high: lab]. The menu also offers a news-tip form, a "submit student story" form and an influencer application ([TPUSA influencer form](https://tpusa.com/influencerapp/)) [high].

**tpusa.com/events.** H1: "Home of the largest and most impactful events in the movement". The page is 6.1 MB with 11 unlabeled links. The first screen again offers only Donate on mobile [high].

**tpusastudents.com/startachapter and /pickupthemic.** This is TPUSA's most youth-native design: real students walking on a campus, heavy display type with outlined letters, an orange-to-red gradient, "Download our app" and "Donate" buttons, and a chapter form right under the hero [high: screenshot]. The menu exposes the whole funnel: start a chapter, order an activism kit, an activism theme library, "Flag the Classroom", the chapter leadership summit, tours, Pick Up the Mic, Patriot Rewards, "Legacy chapters", a campus speakers bureau, a creator program, a register-to-vote checker and a story submission form ([TPUSA Students](https://www.tpusastudents.com/patriotrewards)) [high]. Pick Up the Mic uses a gig-poster look: brush lettering, halftone, a red-white-blue blur [high: screenshot]. The cost is weight. The start-a-chapter page transferred 28.6 MB on mobile and 30 MB on desktop, mainly one background video. Lighthouse performance was 32, with a 13.3 s LCP [high].

**Patriot Rewards** is a gamified incentive program for chartered chapters. Chapters can be rewarded for meetings and events with "notable attendance", tabling to collect student IDs, using weekly activism themes, referring conference attendees, finding leads for new chapters, signing up local business sponsors, posting regularly on social media and submitting stories. Rewards include chapter games, custom merch and VIP experiences at national conferences. They are handed out in spring and fall windows, at the discretion of field reps who must be updated weekly. TPUSA "reserves the right" to change or withhold rewards ([Patriot Rewards](https://www.tpusastudents.com/patriotrewards)) [high]. **Activism kits** are free themed boxes ordered online: a 250th-birthday kit plus register to vote, hunting, free speech, Texas, "Love your land", USA, 2A, Constitution and "Retro" kits ([Activism kits](https://www.tpusastudents.com/activismkits)) [high].

**clubamerica.com (high school).** This is the most teen-coded design in the set. Lined and grid notebook paper, polaroids pinned at angles, marker scribbles and arrows, and a hand-lettered "Become a future winner, risk taker, leader" [high: screenshot]. It claims "3,500+ high school chapters" and "90+ full-time Field Representatives". It offers a free Club America kit, a "Take our weekly poll" module, a "Find a chapter" map, a "Pledge to register" path for students not yet 18, and parental resources ([Club America](https://www.clubamerica.com/)) [high: on-site claims; counts self-reported]. axe found no violations and Lighthouse accessibility was 100. Performance was 47, mainly from the video hero and scripts [high]. Note that TPUSA's own home page describes Club America members as "anti-woke warriors" [high]. That is language youngsemdem must never use, both for tone and because of our brand-safety rule on "warrior" language (the county's name is shared with the Seminole Tribe of Florida).

**amfest.com (AmericaFest 2026).** A model event landing page: a neon "AmericaFest 2026" lock-up over a microphone and boxing-ring lights, the tagline "Restore the culture", **"December 17-20, 2026, Phoenix Convention Center"**, and a large "Register now" button, all on the first screen [high: screenshot]. The H1 repeats the name, place and dates, which is good for search and screen readers. Weaknesses: 17.4 MB on mobile, Lighthouse performance 37 with 10.2 s of blocking time, and four axe rules failed (prohibited ARIA, contrast, an untitled iframe, a scroll region that can't be reached by keyboard) [high].

**tpusamerch.com (Shopify).** Within seconds a full-screen modal reads "Your voice matters. Tell us what drives you and join the movement", with three buttons: "Faith & family", "Freedom of speech", "Maintaining tradition" [high: screenshot]. This is quiz-style data capture: the shopper tells the store what they care about, and every answer is a segment for later emails. The page also shows a free-shipping threshold ($75), new-arrival and tote CTAs, reviews and buy-now-pay-later options. It loads Klaviyo, Meta, TikTok, Snap, X, Bing and Google Ads. It made 486 requests, and axe found 14 contrast failures. The H1 is a product slogan ("Better with butter") [high].

**tpaction.com (Turning Point Action, the political arm).** On Nov 9 the first screen still promoted "The 2026 Freedom Ticket: vote freedom down the line" and "Travel to AZ, NH, or NV to save America", noting that lodging was provided and offering registration [high: screenshot]. Both are pre-election calls to action left up six days after the vote. An email form ("Subscribe for TPAction news, updates, and events") and an app download sit above the fold. Accessibility is the weakest in the TPUSA family: the viewport disables pinch-zoom (`user-scalable=no`), the `<html>` element has no `lang` attribute, 54 focusable elements sit inside hidden regions, and the H1 reads "RioSlum Studio". Lighthouse accessibility was 66 [high]. For background: in 2024 Turning Point Action ran a ballot-chasing operation with a voter-data app built by Superfeed, a company tied to Turning Point leaders. AP reported thin data protections and skepticism from Republican operatives ([AP via WKMG, Oct 7, 2024](https://www.clickorlando.com/news/politics/2024/10/07/turning-point-wants-to-revolutionize-how-republicans-turn-out-voters-some-are-skeptical/)) [med].

### 4.2 Young Republicans

**yrnf.com (Young Republican National Federation).** It blocks headless browsers with a "Checking your browser" page [high]. Read through a page reader, the home page leads with "Recruit. Train. Elect." and offers "Become a member", a WinRed donation link, state chapters, "Deployments", events and a "YR Job Board" on republicanjobs.gop. It lists no events, has no email or SMS signup and no video, and is marked © 2025 ([yrnf.com](https://yrnf.com/)) [med]. The job board is a smart value offer for under-40 professionals. Context: in October 2025 Politico published leaked messages from a Telegram group of state Young Republican leaders containing racist and violent content. The national federation called for those involved to resign; several did, and at least one state federation disbanded ([Axios, Oct 15, 2025](https://www.axios.com/2025/10/15/young-republicans-racist-chat-resign-call)) [high].

**floridayrs.org (Florida Federation of Young Republicans).** A dated WordPress and Elementor template with a crest logo, a stock Florida-flag graphic, "Empowering Florida's Next Generation of GOP Leaders" and "Join us today" [high: screenshot]. It is marked © 2020, has no H1, disables zoom (`maximum-scale=1`), has no Open Graph image, and scored 57 for Lighthouse accessibility [high]. Several old domains (floridayr.com, floridayr.org) still frame it with an HTML 4 frameset [high].

**Central Florida Young Republicans (covers Seminole).** The Florida GOP's June 2024 charter announcement lists a Central Florida chapter for Seminole, Orange and Osceola counties among 17 chapters, and the state group claims more than 1,000 members ([RPOF, June 13, 2024](https://florida.gop/rpof_young_republicans/)) [high that it says so]. In August 2024 the state group opened an Orlando headquarters and said it was recruiting young hospitality workers at Disney and Universal. It also said it had grown from 8 chapters and 300 members in 2022 to 20 chapters and over 1,000 members ([Fox News, Aug 4, 2024](https://www.foxnews.com/politics/gop-chair-young-republicans-hope-flip-democratic-florida-county-open-chapter-hq-orlando)) [med]. I found no website for the Central Florida chapter; likely domains were parked, for sale or unresolved [med]. **Takeaway: the local right-wing youth competitor in Seminole has no web presence to beat. The bar is set by national TPUSA design, not by local sites.**

### 4.3 College Republicans

**crnc.org (College Republican National Committee).** A Squarespace site. Its hero reads "The best party on campus since 1892", with "Join a chapter" and "Start a chapter" over a photo grid of members, and a scrolling "Shop new merch" ticker above [high: screenshot]. It is short: 109 words and about 3 phone screens. The H1 is "Gear up" (merch), and there is no copyright line. Lighthouse: performance 44, accessibility 92 [high]. It has no events, no email field and no video [high].

**uscollegegop.com (College Republicans of America, the CRNC's rival since 2019-2025).** A clean Webflow site. A US map with a dot for each chapter is a strong at-a-glance proof device. But the first screen is the July 4, 2025 announcement that nine state federations had chartered with CRA, which is 16 months old [high: screenshot; [CRA](https://www.uscollegegop.com/news/july-4-2025)]. It scored the best Lighthouse performance among the organization sites (88), with almost no blocking script [high]. In Florida, the Florida Federation of College Republicans disbanded the University of Florida chapter in March 2026 after a photo of a presumed member giving a Nazi salute circulated. The UF chapter said it had chartered with CRA instead ([GNV Info](https://www.gnvinfo.com/we-are-not-going-anywhere-uf-college-republicans-appears-defiant-amid-disbandment/)) [med]. The Florida federation's own domain, ffcr.org, returned a hosting error page [high].

### 4.4 Young America's Foundation (bonus: the other big campus group)

**yaf.org.** The best belonging headline on the right: "Feel out of place as a conservative at your school? There's a place for you here." Below it are two pill buttons, "Learn more" and "Get our newsletter" [high: screenshot]. The page runs long (18 phone screens), is marked © 2025, and has the most automated accessibility failures in the set: 88 links with no accessible name and 32 contrast failures (130 elements in all). Lighthouse performance was 46 [high].

### 4.5 PragerU and PragerU Kids

**prageru.com.** A streaming-service layout: a dark theme, show shelves, a search box, "Premium + PragerUnited" (a paid tier) and Donate. On load, a gala modal ("Deadline extended. Last chance to register!") covers most of the first screen [high: screenshot]. It claims more than 13 billion lifetime views, 5.5 million daily video views, and that 60% of its YouTube viewers are under 35 ([PragerU About](https://www.prageru.com/about)) [med: self-reported]. It has no H1. axe found no violations on mobile and Lighthouse accessibility was 100, but performance was 31 (8.8 s LCP, 3.5 s blocking). It loads Reddit, LinkedIn, Meta, X and Google Ads tags plus Segment [high].

**prageru.com/kids.** "The leader in wholesome, patriotic edutainment", with cartoon shows. A full-screen "Civics 101 for kids and teens: join for free" modal appears on load [high: screenshot]. Florida was the first state to approve PragerU Kids for optional supplemental classroom use. PragerU's outreach director told WBUR it has partnerships with 11 states, while Texas board members disputed any Texas approval ([WBUR On Point, Feb 18, 2026](https://www.wbur.org/onpoint/2026/02/18/prageru-conservative-push-into-american-classrooms)) [med]. The page transferred 10.6 MB. Lighthouse performance was 30, and the recorded LCP was over a minute, an outlier I would recheck [med].

### 4.6 Trump and MAGA web presence

**donaldjtrump.com (now).** A one-screen splash: a "Trump Vance, Make America Great Again! 2026" sign graphic and three red pill buttons, **Donate now / Join us / Shop now**. It is paid for by Never Surrender, Inc., a PAC rather than a candidate committee [high: screenshot and footer text]. The page is 216 KB in 6 requests, Lighthouse performance 97 and accessibility 100, with no axe violations. It is the fastest and clearest page in the set and has no community at all [high].

**The 2024 campaign (from reporting).** In late May 2024 the campaign launched "Trump Force 47", a neighborhood organizing program for door-knocking, calling, poll watching and house parties ([Trump campaign release](https://donaldjtrump.com/news/e0b9941e-5b15-4c13-b191-f501f36410f7)) [med]. In June it announced "Swamp the Vote USA", an RNC early-vote and mail-vote push with pledge-to-vote and yard-sign sign-ups ([Florida Phoenix, June 4, 2024](https://floridaphoenix.com/2024/06/04/trump-touts-swamp-the-vote-usa-rnc-plan-to-rally-behind-vote-by-mail-efforts/)) [med]. I could not screenshot the 2024 site because the Wayback Machine was unreachable from here.

**whitehouse.gov (a government site, included because it is now a core Trump channel).** An app-download ticker, then two stacked modals on load. One is a policy promo; the other is an email capture headed "Welcome to the Golden Age!" with a single email field and "Join now" [high: screenshot]. It links to TikTok, Truth Social, Rumble, YouTube, Instagram, X and Facebook, and offers iOS and Android apps. It transferred **59.3 MB** on mobile, about 55 MB of it video. axe found no violations [high].

**trumpstore.com (the Trump Organization's store).** A "You've got 10% off. Who are you shopping for today? Myself / Someone else" quiz modal, an "Early Black Friday, up to 50% off" banner, and a cookie notice behind it [high: screenshot]. The store sold "Trump 2028" hats for $50 from April 2025 ([GMA](https://www.goodmorningamerica.com/news/story/trump-store-offers-trump-2028-hat-amid-tease-that-the-president-could-again-run-for-office-121137005)) [high]. It made 561 requests to 84 outside domains, including Taboola and Criteo. axe found 21 contrast failures and 12 undersized tap targets [high].

**gettrumpsneakers.com (licensed, sold by a third party).** The "Never Surrender" gold high-tops launched at $399 at Sneaker Con Philadelphia in February 2024. The 1,000-pair run sold out fast, which made limited-edition drop urgency a political merch move. The seller says it uses Trump's name under paid license and is not owned by him ([WLRN/NPR, Feb 19, 2024](https://www.wlrn.org/national-politics/2024-02-19/what-to-know-about-the-debut-of-trumps-399-golden-high-top-sneakers); [FOX 35](https://www.fox35orlando.com/news/trumps-399-never-surrender-sneakers-sell-out-hours-after-release)) [high]. Today the first screen is a product grid with four "Add to cart" buttons. Measured layout shift was 0.71, 8 of 40 images lack alt text, and 27 elements fail contrast [high].

**gop.com.** Blocked (403) for every automated method I tried [high].

### 4.7 Ron DeSantis and the Republican Party of Florida

**rondesantis.com → floridafreedomfund.com.** Behind a Cloudflare challenge. On the one load that passed, it redirected to the Florida Freedom Fund, a DeSantis-linked state political committee that he said would back candidates in the 2026 cycle ([Florida Politics](https://floridapolitics.com/archives/718470-ron-desantis-ready-to-wade-into-2026-fights-with-familiar-political-committee)) [med]. The page is a navy-tinted photo of DeSantis with a serif "Florida Freedom Fund" lock-up, a mission line, and links for mission statement, contact, scheduling requests and donate [high: screenshot]. There is no youth or volunteer path. The H1 is "Insert/edit link" [high].

**florida.gop (RPOF).** Conversion-heavy and capture-heavy. The first screen has a red "Official voter guide" bar, Contribute and Shop buttons, and "Keep Florida winning" over a Trump photo with a four-field join form (first name, last name, email, zip) [high: screenshot]. Further down are a chip-in block ($10 / $25 / $50 / $100 / other), "Get involved with your local GOP", and coalition pages: agriculture, educators, faith, first responders, Hispanic and Latino, Jewish, moms, pro-life, Second Amendment and veterans. There is no youth coalition. The footer newsletter form requires a phone number and links SMS terms [high]. Quality problems: the layout is **415 px wide on a 390 px phone**, so the "WINNING" headline is clipped; the page has 15 H1s; 9 images lack alt text; and the main menu markup contains a page builder's default "Dropdown" with placeholder links (`href="#"`) such as "Prebuilt checkout" and "Libraries and SDKs". I did not confirm whether that dropdown shows on screen [high that it is in the markup]. The site is English-only, even with a Hispanic and Latino coalition.

### 4.8 Seminole County Republican Party

**seminolegop.org.** WordPress. At 390 px the "SEMINOLEGOP" wordmark is cut off by two stacked buttons, "Take action" and "Contribute" [high: screenshot]. The hero is a 250th-anniversary eagle and flag image, followed by the Nov 3 Republican voter guide. The page text covers party history and platform, a "How you can get involved" list (door knock, poll watch, sign wave, committee work, voter registration, phone banking), "Register as a Republican today", a member gallery and links to local clubs ([seminolegop.org](https://seminolegop.org/)) [high]. The browser title is "Home New - Seminole GOP", the H1 is "Our Rules & Resolutions", and there are no social links, no events on the home page and no youth path. An accessibility-widget plugin is installed, and axe found only 2 rules failed (a link with no name and small tap targets). It is light on tracking (Google tags only) [high]. **Takeaway: in Seminole, the Republican web presence a young voter would find is a party-administration site.**

### 4.9 Viral right-leaning creator brands

**officialhodgetwins.com (Hodgetwins, Shopify).** A "Damn good gun gear" carousel (a concealed-carry waist pack), then a proof strip: "72K+ 5-star reviews / 780K+ orders to date / $3 million+ given away" [high: screenshot; numbers self-reported]. Below that are product tiles for best sellers, supplements, apparel and gear, and a "Giveaways" section. It uses Postscript for SMS marketing and Klaviyo for email, offers buy-now-pay-later, and loads Microsoft Clarity session recording [high]. The main YouTube channel had about 3.4 to 3.65 million subscribers in 2025 ([vidIQ](https://vidiq.com/youtube-stats/channel/@hodgetwins1776/)) [med]. Lesson: **proof numbers plus giveaways plus SMS** is a complete loop for this audience.

**fullsend.com (Nelk Boys).** It now opens with a 21+ age gate for nicotine pouches ("Age verification required", plus a nicotine warning). Behind it is a subscribe-and-save store [high: screenshot]. The Nelk political crossover (Trump on *Full Send*, the "Send the Vote" project) lives in podcasts and on a separate site, not on this store ([Fox News](https://www.foxnews.com/politics/inside-how-podcasters-courted-young-male-voters-ahead-trumps-massive-win)) [med]. Under-21 visitors cannot get in.

**rileygaines.com (Squarespace).** A book-sales site: an announcement bar and a pop-up both push "Swimming Against the Current" with "Buy now", plus links to TikTok, Instagram, X and YouTube [high: screenshot]. In December 2025 OutKick, part of Fox, signed her to a multi-year podcast deal and relaunched her show as *The Riley Gaines Show* ([Deseret News, Dec 22, 2025](https://www.deseret.com/politics/2025/12/22/riley-gaines-outkick-podcast-transgender-athletes)) [med]. Her campus tours now run with TPUSA's Pick Up the Mic ([Daily Signal](https://www.dailysignal.com/2026/07/12/charlie-kirk-mic/)) [med]. **Domain hygiene lesson:** rileygainescenter.org, which 2023-2024 campus-tour coverage pointed to, now redirects through unrelated domains (measured Nov 9, 2026) [high]. I did not load the destination.

---

## 5. The 10 things they do that youngsemdem must match or beat

1. **One unmistakable action per screen.** donaldjtrump.com is three buttons. AmericaFest puts date, place and "Register now" on the first screen, and CRNC has "Join a chapter / Start a chapter" [high]. *Match:* every youngsemdem screen gets one primary and one secondary action. *Beat:* make the primary action social (RSVP to a hangout, join a crew), not a money ask.
2. **Proof at scale, in big numbers.** TPUSA shows "3,500+ / 1,500+ / 12,000+", Hodgetwins "72K+ reviews / 780K+ orders", and CRA a chapter dot-map [high]. *Beat:* only real, live, local numbers ("23 going Thursday", "4 crews in Oviedo"), each linked to the thing it counts. Demo numbers are labeled "Demo".
3. **Chapter-in-a-box.** TPUSA offers a start-a-chapter form, free themed kits, a theme library, 90+ field reps, a chapter map and a summit ([Club America](https://www.clubamerica.com/); [kits](https://www.tpusastudents.com/activismkits)) [high]. *Beat:* a "Start a crew" kit for any Seminole city, campus or workplace: downloadable templates in English and Spanish, a first-meetup checklist, and a named human who replies within 48 hours.
4. **Rewarded activism.** Patriot Rewards scores meetings, tabling, social posts, story submissions and referrals, and pays out merch and VIP conference access ([Patriot Rewards](https://www.tpusastudents.com/patriotrewards)) [high]. *Beat:* transparent, self-serve progress. Public criteria, instant badges and streaks for civic actions (check your registration, bring a friend, post a clip, host a hangout), with no gatekeeper deciding behind the scenes.
5. **Tentpole events with real urgency.** AmericaFest Dec 17-20 has a countdown feel. PragerU's gala says "Deadline extended", and TP Action offered paid-lodging travel to swing states [high]. *Beat:* a monthly Seminole tentpole plus weekly small hangouts, each with honest capacity counters, add-to-calendar, times in am/pm, accessibility notes and one-tap RSVP.
6. **Shows, not posts.** TPUSA brands recurring formats (*Prove Me Wrong*, *Culture Apothecary*, *Turning Point Tonight*), PragerU is built like a streaming service, and TPUSA and Turning Point Action have apps [high]. *Beat:* two or three recurring youngsemdem formats with names (for example a 60-second "Seminole in a Minute" news clip, a member-hosted "Hot Take Hour", a Spanish-first segment), served as light vertical clips.
7. **Participation formats.** Pick Up the Mic puts students on the mic, and TPUSA collects story submissions, influencer applications and creator-program sign-ups ([influencer form](https://tpusa.com/influencerapp/)) [high]. *Beat:* "Post your take" vertical-video uploads with consent and moderation, a creator crew application, and a monthly open-mic night where anyone can speak, not a debate stage built to embarrass someone.
8. **Quiz-style data capture.** The TPUSA merch pop-up asks "Tell us what drives you", and Trump Store asks "Who are you shopping for today?" [high]. *Beat:* an inline "What do you care about?" picker (rent, climate, abortion access, transit, LGBTQ+ safety, jobs) that personalizes the home page and emails right away. No modal, and asked only after the visitor engages.
9. **Merch as identity.** Limited sneaker drops sold out, "Trump 2028" hats, CRNC's merch ticker, and TPUSA's store with free-shipping thresholds ([WLRN/NPR](https://www.wlrn.org/national-politics/2024-02-19/what-to-know-about-the-debut-of-trumps-399-golden-high-top-sneakers); [GMA](https://www.goodmorningamerica.com/news/story/trump-store-offers-trump-2028-hat-amid-tease-that-the-president-could-again-run-for-office-121137005)) [high]. *Beat:* small, local, member-designed drops (city-specific designs, bilingual lines, inclusive sizing) with honest edition sizes, plus a free digital sticker pack for joining.
10. **Belonging-first copy and sub-brands for different ages.** YAF: "There's a place for you here." CRNC: "The best party on campus since 1892." Club America's scrapbook look is aimed at teens, and RPOF has identity coalitions. Young Republicans offer a job board [high]. *Beat:* belonging-first headlines in the Service95-style voice (see `05-voice-dua-lipa.md`), "crews" for Latino and Boricua members, LGBTQ+ members, disabled members, students, young parents and hospitality workers, and a young-professional jobs and skills board.

---

## 6. The 10 weaknesses youngsemdem can exploit

1. **Heavy, slow phones-last pages.** TPUSA home is 19.0 MB, start-a-chapter 28.6 MB, AmericaFest 17.4 MB and whitehouse.gov 59.3 MB on mobile. Lighthouse performance was 30 to 51 on most organization pages [high]. On a weak signal at a bus stop in Sanford, these pages crawl or burn data. *Exploit:* a home page under 350 KB with Lighthouse performance of 95 or higher.
2. **Walls on the first screen.** Privacy banners cover 27 to 41% of the first screen on TPUSA and Trump Sneakers. Full-screen modals appear on TPUSA merch, Trump Store, whitehouse.gov (two stacked), PragerU and PragerU Kids, and Full Send opens with a 21+ age gate [high]. *Exploit:* zero modals on a first visit. If the site uses no ad pixels, it may not need a consent banner at all (confirm with counsel).
3. **Accessibility failures.** 20 of 23 pages failed at least one axe rule. Examples: 88 unnamed links on YAF, 17 on TPUSA home; contrast failures on 68 elements at Full Send, 27 at Trump Sneakers, 21 at Trump Store. Zoom is disabled on Turning Point Action and FFYR, the `lang` attribute is missing on Turning Point Action, and RPOF overflows a 390 px screen. Only 8 of 23 had a skip link [high]. *Exploit:* zero axe violations on every template, both color modes at AA, zoom allowed and a visible skip link.
4. **No Spanish anywhere.** None of the 23 pages offered Spanish, including RPOF, which has a "Hispanic & Latino" coalition [high]. Seminole is 25.4% Hispanic and its ballot is bilingual (`01-seminole-local.md`) [high]. *Exploit:* full English and Spanish parity, reviewed by native speakers, with a toggle in the header.
5. **Built for donors, not young people.** On phones, Donate or Contribute is the only first-screen action on TPUSA home, TPUSA events and Seminole GOP, and the first button on donaldjtrump.com [high]. Similarweb's largest age groups for these websites are 35 to 65+ [low]. *Exploit:* lead with hangouts, crews and the issue picker; keep Donate visible but secondary.
6. **Platform mismatch.** TPUSA home loads a TikTok ad pixel but links no TikTok account. Only 5 of 23 pages link TikTok at all (TPUSA merch, PragerU, PragerU Kids, whitehouse.gov, Riley Gaines). Rumble, Facebook and X dominate [high]. *Exploit:* TikTok and Instagram-native share cards, story-ready vertical images, and embeds that load only on tap.
7. **Stale content and visible polish bugs.** Examples: Turning Point Action's election-travel promo six days after the vote; CRA's 16-month-old hero; © 2020 on FFYR and © 2025 on YAF and YRNF; "Insert/edit link" and "RioSlum Studio" as H1s; "Home New" as a page title; RPOF's builder placeholder menu and clipped headline; a dead state college federation domain; and a former tour domain that now redirects to unrelated sites [high]. *Exploit:* a freshness system (expiry dates on every item, a post-election mode, "updated" stamps, automated link and domain checks).
8. **Heavy ad tracking.** Each TPUSA page loads 8 to 10 ad and analytics tags (Meta, TikTok, X, Bing, Google Ads, Hotjar, Simpli.fi, HubSpot) and contacts 49 to 60 outside domains. Trump Store reaches 84, including Taboola and Criteo [high]. *Exploit:* privacy-first analytics, no ad pixels, three or fewer outside domains, and a plain-language promise ("we don't sell or share your data") stated on the join form.
9. **Trust and safety liabilities.** Examples: the Young Republican leaked-chat scandal (October 2025), the disbanded UF College Republicans chapter (March 2026), the CRNC and CRA split, and reporting that professors named on TPUSA's Professor Watchlist received threats ([Axios](https://www.axios.com/2025/10/15/young-republicans-racist-chat-resign-call); [GNV Info](https://www.gnvinfo.com/we-are-not-going-anywhere-uf-college-republicans-appears-defiant-amid-disbandment/); [WBEZ/Sun-Times](https://chicago.suntimes.com/the-watchdogs/2025/09/19/illinois-professors-watchlist-charlie-kirk-turning-point-usa); [WUSF/NPR](https://www.wusf.org/2025-09-26/professors-on-turning-point-usas-watchlist-tell-their-stories)) [high/med]. *Exploit:* a visible code of conduct, report buttons, a moderation response-time promise, and a rule that the site never publishes lists of private individuals.
10. **Thin local layer and one-way sites.** Seminole GOP has no social links, no events on the home page and no youth path. Central Florida YR has no site. YRNF and FFYR list no events. TPUSA's rewards are decided behind the scenes. No site shows member-made content on the page itself, and I detected no chat or help assistant on any of them (via known chat-widget scripts) [high/med]. *Exploit:* a hyper-local calendar, crew pages for each city, a member clip wall, and a Claude-powered "Ask" helper that answers voting and logistics questions with sources (see `06-tech-portability-compliance.md`).

---

## 7. "Beat them by" specs

Concrete targets for the youngsemdem build. Each line names the benchmark it beats.

**Performance (beats TPUSA's 19 to 29 MB and Lighthouse 32 to 51)**
- Home page: **350 KB or less** transferred before any user-started video, **30 requests or fewer**, Lighthouse mobile **performance 95+**, LCP **2.0 s or less**, total blocking time **150 ms or less**, CLS **0.05 or less**. Event and crew pages: 500 KB or less.
- Background video: optional, **1.5 MB or less**, 6 s or shorter, muted, pauses when off screen, and replaced by a poster under `prefers-reduced-motion` or `Save-Data`. Clips play only on tap. Captions are always on.
- Images: AVIF or WebP with explicit width and height (no layout shift), lazy-loaded below the fold. No web font over 60 KB.

**Conversion (beats Donate-only first screens and modal walls)**
- Exactly **one primary and one secondary action on the first mobile screen**, plus a sticky bottom action bar (RSVP or Join) after the first scroll.
- **No modals on a first visit.** A consent banner, if counsel says one is needed, may cover no more than 15% of the screen and never covers the primary action.
- Join form: **two required fields** (first name, plus email or mobile), with visible labels, the right `autocomplete` values and the right keyboard type on phones. Zip and the issue picker are optional and come after the first submit.

**Capture and messaging (beats RPOF's required phone field and the merch quiz modal)**
- Phone is always optional. SMS uses a keyword opt-in plus a web form with explicit, unchecked consent text covering message frequency, "msg & data rates may apply", and STOP and HELP, plus double opt-in (compliance details in `06-tech-portability-compliance.md`).
- The issue picker is inline, has 6 to 8 options, and personalizes the home page right away. Answers are stored only with consent.
- Recurring-donation boxes are **never pre-checked** (see §8).

**Accessibility and language (beats 20 of 23 pages failing axe, and 0 of 23 offering Spanish)**
- **0 axe violations** (WCAG 2.2 AA) on every template in light and dark mode; tap targets of 24 px or more; zoom allowed; `lang` set, with `hreflang` linking each English and Spanish pair; a visible skip link.
- **100% of core pages in Spanish** at launch (home, events, join, voting help, crews, FAQ), reviewed by native speakers, at their own `/es/` URLs.

**Belonging and proof (beats static big numbers and opaque rewards)**
- Every event card shows date, time (am/pm), place, cost (free), an accessibility note, a live RSVP count, add-to-calendar (ICS) and a share card.
- Proof numbers must be real and must link to what they count. Demo data is labeled "Demo" in the interface.
- Badges and streaks have public criteria and are earned instantly. Crew leaderboards are opt-in and show first names only. There are no points for confronting or posting about specific people.
- A "Start a crew" kit in English and Spanish (PDF plus editable templates), a crew map that shows **public meeting venues only**, never members' homes, and a named human reply within 48 hours.

**Culture and video (beats Rumble-first links and 20 MB autoplay)**
- A member clip wall of vertical clips, 60 s or shorter, with posters of 60 KB or less; "Post your take" upload with consent checkboxes and a moderation queue.
- Share cards (1080 x 1920 story and 1200 x 630 link preview) for every event, issue and clip; TikTok and Instagram handles in the header.
- Two or three named recurring formats, published on a schedule.

**Merch (beats sell-out drops and discount pop-ups, honestly)**
- Drop pages with a countdown, a stated edition size, preorder, inclusive sizes and member credit for designs. A free digital sticker pack for joining. No fake scarcity.

**Privacy, freshness and trust (beats 49 to 84 outside domains and stale heroes)**
- **No ad pixels**, privacy-first analytics, **3 or fewer outside domains** on the home page, and a short privacy promise on the join form.
- Every time-bound item has an expiry date; the site switches automatically into a "post-election" mode; weekly automated checks for links, copyright year and domain renewal; no placeholder text ever ships (a build check fails on "Lorem", "Insert/edit link", "Home New" and similar leftovers).
- A code of conduct linked in the footer, a report button on every user post, a stated moderation response time, and no publishing of lists of private individuals.

---

## 8. Do not copy

- **Pre-checked recurring donations.** In 2020 the Trump campaign's WinRed forms used pre-checked weekly and "money bomb" boxes. The New York Times reported $122 million in refunds, and the FEC voted 6-0 to recommend that Congress ban the practice. ActBlue and WinRed both used pre-checked recurring boxes at the time ([NYT reprint via Boston.com, Apr 4, 2021](https://www.boston.com/news/politics/2021/04/04/how-trump-steered-supporters-into-unwitting-donations); [Mediaite on the FEC vote](https://www.mediaite.com/news/fec-recommends-ban-on-shady-fundraising-tactic-used-by-trump-almost-like-theft)) [med]. youngsemdem: always unchecked, with recurring giving shown clearly as a separate choice.
- **Watchlists and tip lines aimed at individuals.** Reporting links listing on TPUSA's Professor Watchlist to threats against faculty ([WBEZ/Sun-Times](https://chicago.suntimes.com/the-watchdogs/2025/09/19/illinois-professors-watchlist-charlie-kirk-turning-point-usa)) [med]. youngsemdem never publishes lists of private people.
- **Stacked modals and renewed deadlines.** These erode trust with a skeptical young audience. Use honest urgency only.
- **"Warrior" and battle framing.** It conflicts with the brand-safety rules for a county that shares its name with sovereign tribal nations, and with the hopeful, inclusive voice.
- **Disabling zoom, missing `lang`, placeholder text and ad-pixel sprawl** (see §6).

---

## 9. Recommendations for youngsemdem

1. **Make the home page a hangout, not a donation page.** First screen: the next local hangout (date, time, place, live RSVP count) and "Join a crew". Donate goes lower.
2. **Ship a "Start a crew" kit and crew map** as the youngsemdem version of TPUSA's chapter-in-a-box, with a 48-hour human reply and public venues only.
3. **Launch transparent, self-serve rewards** (badges and streaks for civic actions) to match Patriot Rewards without the behind-the-scenes gatekeeping.
4. **Run one tentpole a month and two or three named video formats.** Build event pages to the AmericaFest standard (date, place and action on the first screen) at about 3% of its page weight.
5. **Use an inline issue picker instead of pop-up quizzes,** and personalize the home page and messages from it.
6. **Go fully bilingual at launch.** No right-wing competitor offers Spanish, and Seminole is one quarter Hispanic.
7. **Set and enforce budgets:** 350 KB home page, Lighthouse 95+, 0 axe violations, 3 or fewer outside domains, no modals, no ad pixels. Add these as CI checks.
8. **Build in community safety:** a code of conduct, moderation, a report button and no target lists. Say it on the site; it is a selling point against current right-wing youth brands.
9. **Plan merch drops** as member-designed, local, bilingual and honest about edition sizes, plus a free digital sticker pack.
10. **Add the Claude "Ask" helper** for voting logistics, events and crews, with sources. No competitor has two-way help.

---

## 10. Open questions

1. **Blocked sites.** gop.com, yrnf.com and rondesantis.com need a manual check in a normal browser. Should someone with a regular laptop capture them?
2. **Field data.** These are lab measurements on a shared machine. Do we want Chrome UX Report (CrUX) field data for these origins (needs an API key) or a WebPageTest run for cleaner timing comparisons?
3. **Rewards and the law.** Are prizes or merch for volunteers allowed under campaign-finance rules for whatever entity runs youngsemdem (a party club, a PAC or a nonprofit)? Counsel should confirm before any rewards launch.
4. **Under-18 path.** Club America offers a pledge for students under 18. Do we want a pre-registration-at-16 flow (Florida allows it; see `01-seminole-local.md`), and how do we handle minors' data (COPPA applies under 13; see `06-tech-portability-compliance.md`)?
5. **TikTok numbers.** I could not verify a current follower count for the main TPUSA TikTok account, or for local Republican groups. Is a manual platform check worth doing?
6. **2024 campaign site.** The Wayback Machine was unreachable from here. Should someone pull archived screenshots of donaldjtrump.com from fall 2024 for the design team?
7. **Co-branding with YDSC.** The existing Young Democrats of Seminole County (see `02-young-dem-websites.md`) could help supply the human crew contacts that a chapter-in-a-box promise depends on.
8. **Similarweb.** The free tier's figures are modeled and inconsistent for small sites. Is a paid traffic tool worth it, or should we rely on our own analytics after launch?

---

## 11. Sources

All accessed Nov 9, 2026 unless noted. Measurements of live sites were taken the same day; the raw data (JSON per page per viewport, Lighthouse summaries) sits beside the screenshots in the scratch folder named in the Method note.

1. CIRCLE (Tufts), 2026 Election hub: https://circle.tufts.edu/2026-election
2. Boston Globe, "Republican midterm convention influencers," Sept 11, 2026: https://www.bostonglobe.com/2026/09/11/nation/republican-midterm-convention-influencers/
3. WPTV, "Republican Byron Donalds wins election for governor in Florida," Nov 2026: https://www.wptv.com/news/political/elections-local/republican-byron-donalds-wins-election-for-governor-in-florida
4. WLRN / News Service of Florida, Florida registration, Oct 19, 2026: https://www.wlrn.org/government-politics/2026-10-19/florida-democrats-see-minor-gain-but-republicans-keep-large-1-5-million-edge-with-registered-voters
5. CBS News, "Erika Kirk named new CEO of Turning Point USA," Sept 2025: https://www.cbsnews.com/news/erika-kirk-charlie-kirk-widow-turning-point-usa-ceo/
6. Campus Reform, "Over 32,000 requests for new TPUSA campus chapters," Sept 2025: https://campusreform.org/article/32000-requests-new-tpusa-campus-chapters-filed-since-charlie-kirks-death/28627
7. Fox News, TPUSA chapter requests surge, Sept 2025: https://www.foxnews.com/politics/this-turning-point-tpusa-says-campus-chapter-requests-surge-over-37000-after-kirks-assassination
8. Religion News Service, AmericaFest 2025, Dec 20, 2025: https://religionnews.com/2025/12/20/at-amfest-turning-point-usa-leaders-leverage-kirks-martyrdom-to-rally-young-voters/
9. Fox Business, social-media growth after Kirk's death, Sept 16, 2025: https://www.foxbusiness.com/politics/charlie-kirks-social-media-platforms-gain-millions-followers-subscribers-since-assassination
10. The National Desk, "Battle for young voters intensifies," Aug 28, 2026: https://thenationaldesk.com/news/americas-news-now/battle-for-young-voters-intensifies-ahead-of-midterms-tpusa-shares-strategy-november-charlie-kirk-hasan-piker
11. Daily Signal, "Why I'm Picking Up the Mic," July 12, 2026: https://www.dailysignal.com/2026/07/12/charlie-kirk-mic/
12. RNC press release on TikTok, Feb 6, 2026 (blocked to my fetcher; seen in search listings): https://gop.com/press-release/icymi-fox-news-rnc-rolls-out-powerful-new-tiktok-strategy-to-win-over-key-demographic-after-trumps-2024-success
13. ABC13, "White House joins TikTok," Aug 2025: https://abc13.com/post/white-house-joins-tiktok-delaying-enforcement-sale-ban-law/17594566/
14. IBTimes UK, Trump and White House TikTok followers, July 7, 2026: https://www.ibtimes.co.uk/donald-trump-taylor-swift-more-followers-tiktok-1807203
15. Fox News, "Inside how podcasters courted young male voters," Nov 29, 2024: https://www.foxnews.com/politics/inside-how-podcasters-courted-young-male-voters-ahead-trumps-massive-win
16. Fortune, TikTok, Turning Point and Gen Z women, Dec 19, 2025: https://fortune.com/2025/12/19/i-was-like-wow-if-erika-can-do-it-i-can-do-it-tiktok-and-turning-point-draw-in-conservative-gen-z-women/
17. Similarweb, tpusa.com (Sept 2026): https://www.similarweb.com/website/tpusa.com/
18. Similarweb, tpusastudents.com: https://www.similarweb.com/website/tpusastudents.com/
19. Similarweb, gop.com: https://www.similarweb.com/website/gop.com/
20. Similarweb, prageru.com: https://www.similarweb.com/website/prageru.com/
21. Similarweb, yaf.org: https://www.similarweb.com/website/yaf.org/
22. Similarweb, officialhodgetwins.com: https://www.similarweb.com/website/officialhodgetwins.com/
23. Similarweb, florida.gop: https://www.similarweb.com/website/florida.gop/
24. PragerU, About: https://www.prageru.com/about
25. TPUSA Students, Patriot Rewards: https://www.tpusastudents.com/patriotrewards
26. TPUSA Students, Activism kits: https://www.tpusastudents.com/activismkits
27. Club America (TPUSA): https://www.clubamerica.com/
28. TPUSA, influencer application: https://tpusa.com/influencerapp/
29. AP via WKMG, "Turning Point wants to revolutionize how Republicans turn out voters," Oct 7, 2024: https://www.clickorlando.com/news/politics/2024/10/07/turning-point-wants-to-revolutionize-how-republicans-turn-out-voters-some-are-skeptical/
30. Young Republican National Federation, home page (read via page reader): https://yrnf.com/
31. Axios, Young Republicans leaked chat, Oct 15, 2025: https://www.axios.com/2025/10/15/young-republicans-racist-chat-resign-call
32. Republican Party of Florida, Florida Young Republicans charter, June 13, 2024: https://florida.gop/rpof_young_republicans/
33. Fox News, Florida Young Republicans Orlando HQ, Aug 4, 2024: https://www.foxnews.com/politics/gop-chair-young-republicans-hope-flip-democratic-florida-county-open-chapter-hq-orlando
34. College Republicans of America, July 4, 2025 announcement: https://www.uscollegegop.com/news/july-4-2025
35. GNV Info, UF College Republicans disbandment, Mar 2026: https://www.gnvinfo.com/we-are-not-going-anywhere-uf-college-republicans-appears-defiant-amid-disbandment/
36. WBUR On Point, PragerU in classrooms, Feb 18, 2026: https://www.wbur.org/onpoint/2026/02/18/prageru-conservative-push-into-american-classrooms
37. Trump campaign, "Team Trump launches Trump Force 47," May 2024: https://donaldjtrump.com/news/e0b9941e-5b15-4c13-b191-f501f36410f7
38. Florida Phoenix, "Trump touts Swamp the Vote USA," June 4, 2024: https://floridaphoenix.com/2024/06/04/trump-touts-swamp-the-vote-usa-rnc-plan-to-rally-behind-vote-by-mail-efforts/
39. Good Morning America, Trump Store "Trump 2028" hat, Apr 2025: https://www.goodmorningamerica.com/news/story/trump-store-offers-trump-2028-hat-amid-tease-that-the-president-could-again-run-for-office-121137005
40. WLRN / NPR, Trump's $399 sneakers, Feb 19, 2024: https://www.wlrn.org/national-politics/2024-02-19/what-to-know-about-the-debut-of-trumps-399-golden-high-top-sneakers
41. FOX 35 Orlando, sneakers sell out: https://www.fox35orlando.com/news/trumps-399-never-surrender-sneakers-sell-out-hours-after-release
42. Florida Politics, DeSantis and the Florida Freedom Fund: https://floridapolitics.com/archives/718470-ron-desantis-ready-to-wade-into-2026-fights-with-familiar-political-committee
43. Seminole County Republican Party, home page: https://seminolegop.org/
44. vidIQ, Hodge Twins channel stats (2025): https://vidiq.com/youtube-stats/channel/@hodgetwins1776/
45. Deseret News, Riley Gaines and OutKick, Dec 22, 2025: https://www.deseret.com/politics/2025/12/22/riley-gaines-outkick-podcast-transgender-athletes
46. Chicago Sun-Times / WBEZ, Illinois professors on the watchlist, Sept 19, 2025: https://chicago.suntimes.com/the-watchdogs/2025/09/19/illinois-professors-watchlist-charlie-kirk-turning-point-usa
47. WUSF / NPR, professors on TPUSA's watchlist, Sept 26, 2025: https://www.wusf.org/2025-09-26/professors-on-turning-point-usas-watchlist-tell-their-stories
48. Boston.com (reprinting the New York Times), "How Trump steered supporters into unwitting donations," Apr 4, 2021: https://www.boston.com/news/politics/2021/04/04/how-trump-steered-supporters-into-unwitting-donations
49. Mediaite, FEC recommends ban on pre-checked recurring donations: https://www.mediaite.com/news/fec-recommends-ban-on-shady-fundraising-tactic-used-by-trump-almost-like-theft

**Measured sites** (Playwright, axe-core and Lighthouse runs on Nov 9, 2026): tpusa.com, tpusa.com/events, tpusastudents.com/startachapter, tpusastudents.com/pickupthemic, clubamerica.com, amfest.com, tpusamerch.com, tpaction.com, yrnf.com (blocked), floridayrs.org, crnc.org, uscollegegop.com, yaf.org, prageru.com, prageru.com/kids, donaldjtrump.com, gop.com (blocked), whitehouse.gov, trumpstore.com, gettrumpsneakers.com, rondesantis.com (challenge; redirected to floridafreedomfund.com once), florida.gop, seminolegop.org, officialhodgetwins.com, fullsend.com, rileygaines.com.
