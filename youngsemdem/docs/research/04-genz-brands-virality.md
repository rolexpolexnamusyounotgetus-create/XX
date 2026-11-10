# 04 - Gen Z brands, virality mechanics and web UX for youngsemdem

Research brief for the Young Seminole Democrats (youngsemdem) demo site. Prepared Monday, November 9, 2026, six days after the Nov 3, 2026 general election. Scope: what the brands Gen Z loves actually do, the evidence on why things spread, what young people expect from a website, what to avoid, and a prioritized catalog of virality and engagement mechanics that can run on a static site and port cleanly to a real domain.

Confidence key: **[high]** primary source or peer-reviewed study, recent; **[med]** reputable secondary reporting, a company's own claim, or older primary data; **[low]** vendor blog, single unverified source, or paywalled data seen only in summary. Numbers are quoted as the source reported them; where sources conflict, that is called out.

---

## Headline summary

The brands that win with Gen Z in 2025-2026 are not the most polished; they are the ones that hand people something to *be* or *say* (Spotify Wrapped's identity cards, Partiful's meme invites, Duolingo's streaks and unhinged owl), make sharing a one-tap act that lands in private group chats, and keep earning attention after the viral spike fades. The data is sobering on that last point: in Morning Consult's 2026 ranking, 19 of the 25 brands that grew fastest the year before lost ground, and BeReal shows how a daily-obligation novelty can collapse. The strongest civic evidence points the same way: messages from friends move turnout far more than mass messages (an 8.3-point complier effect for friend-to-friend texts versus well under one point for automated texts), making a concrete plan and pledging both raise turnout, and showing people that their friends acted beats generic information. Gen Z also punishes the opposite: 71% saw brands using slang and trends in the past month and they are the generation most likely to call it cringe; 18-34-year-old Democrats call party fundraising email mostly annoying; 39% of Gen Z feel negative about AI-made ads. So youngsemdem should be a fast, mobile-first, accessible, dark-mode-aware site whose every page is "group-chat ready" (static Open Graph previews, Web Share, pre-written texts), built around a few identity-and-action loops (a quiz with shareable result cards, Partiful-style event pages, plan-and-pledge cards, a vertical video wall with moderated uploads, a "bring three friends" ladder, and a December "Seminole Wrapped"), with Claude used visibly and honestly for utility (explain, translate, draft an invite) rather than for fake people or imagery, and with zero guilt-trip, fake-urgency or fake-counter patterns.

---

## Part A - What Gen Z's favorite brands are doing

### A1. Who is actually winning right now

- **Viral spikes fade; habits and treats last.** Morning Consult's *Fastest Growing Brands 2026* (fieldwork May 15-Aug 15, 2026 vs the same window in 2025; 2,801 brands) found only 14% of brands grew purchase consideration, a five-year low, and 19 of the 25 fastest growers from the prior year lost ground. Among Gen Z adults the fastest growers were Cutwater (+15.5 points), Energizer (+8.5), DayQuil (+8.3), Hot Pockets (+8.2) and Monopoly (+7.6). The overall No. 1 was Mr. Pibb after a Nov 5, 2025 relaunch, and the report notes that more people now use AI tools to research products ([Morning Consult 2026 PDF](https://s3.amazonaws.com/media.mediapost.com/uploads/MORNING_CONSULT_Fastest_Brands_2026.pdf); [report page](https://morningconsult.com/reports/fastest-growing-brands-2026)). **[high]** Lesson for youngsemdem: plan for the *second* week after a viral moment (retention loops, recurring events), not just the spike.
- **Gen Z's 2024 list was dominated by cheap treats and platforms.** Advil ranked first among Gen Z, over half the top 20 were food and drink, and TikTok, Meta and Epic Games also appeared ([Morning Consult, Dec 10, 2024](https://intel.morningconsult.com/mc-content/analysis/gen-z-and-millennials-fastest-growing-brands)). **[high]**
- **TikTok is the default app for teens, the pipeline for the 18-29 base.** In Piper Sandler's Fall 2025 survey (10,969 teens), 46% named TikTok their favorite app, ahead of Instagram (31%) and Snapchat (14%) ([Piper Sandler, Oct 9, 2025](https://www.pipersandler.com/news/piper-sandler-completes-50th-semi-annual-teen-survey)). **[high]** Secondary coverage of the Fall 2026 survey (fielded Aug 3-Sep 14, 2026, about 9,000 teens) reports TikTok at 48% ([roic.ai, Oct 13, 2026](https://www.roic.ai/news/piper-sandler-teen-survey-tiktok-roblox-and-beauty-lead-as-snapchat-and-netflix-lag-10-13-2026); [Retail Dive](https://retaildive.com/news/teen-spending-grows-trade-athletic-apparel-fashion-piper-sandler/833565)). **[low-med]** e.l.f. was again teens' favorite cosmetics brand in Spring 2026 per secondary reports ([Stocktwits, Mar 5, 2026](https://stocktwits.com/news-articles/markets/equity/nike-elf-beauty-drpepper-reign-supreme-among-us-teens/ch6anJvR31p)). **[med]**
- **"Gets me" = understands my worldview and respects my budget.** YPulse's April 2026 ranking of brands Gen Z say "get them" includes TikTok, YouTube, Instagram Reels, Instagram, McDonald's and Spotify; the top reasons were reflecting their lifestyle and worldview, and affordability ([YPulse, Apr 29, 2026](https://www.ypulse.com/article/2026/04/29/the-top-10-brands-gen-z-say-gets-them/)). **[med, paywalled full list]**

**Synthesis.** Gen Z brand love clusters around (1) platforms that personalize and let you express yourself, (2) low-cost comfort, and (3) brands with a built-in self-expression or participation mechanic. For a volunteer political club this translates to: be personal, be free and low-friction, give people a role and a card to show it.

### A2. Brand playbook: what to steal and what to skip

| Brand | What they do that works | Mechanic youngsemdem can steal | Evidence |
|---|---|---|---|
| **Spotify Wrapped** | Turns private data into a tap-through story of 9:16 cards that say something about *you*; share cards are pre-built for Stories. 2025 edition: 200M engaged users in about 24 hours (vs about 62 hours in 2024), up 19% YoY, and about 500M shares on day one, up 41% (shares include native shares, downloads and screenshots) ([MBW, Dec 8, 2025](https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase)). For 2019 Wrapped the team built a server-side card renderer and pre-generated about 535 million images ([Spotify Engineering](https://engineering.atspotify.com/2020/9/spotify-unwrapped-2019-how-we-built-an-in-app-experience-just-for-you)). | Quiz result cards, pledge cards and a December "Seminole Wrapped" in 9:16 and 4:5. Pre-render cards at build time. | [high] company-reported |
| **Duolingo** | Streaks, leagues and a mascot with a chaotic voice. Learners with a 7-day streak were 2.4x more likely to return the next day (correlational) ([Duolingo blog, Nov 19, 2020](https://blog.duolingo.com/improving-the-streak/)). Former CPO Jorge Mazal reports leaderboards raised overall learning time 17% and tripled highly engaged learners; DAU grew 4.5x over four years ([Lenny's Newsletter, Feb 28, 2023](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)). Its social lead has described treating the comment section as the creative brief ([The Drum, Feb 25, 2025](https://www.thedrum.com/news/2025/02/25/duolingo-s-tiktok-mastermind-its-unhinged-social-strategy-and-killing-its-mascot)). | Weekly (not daily) action streaks; friendly city-vs-city board; a recurring character or voice; mine comments for content. | [med-high] company-reported |
| **Partiful** | Link-first invites with meme cover art (including a free brat-parody birthday invite), RSVP with no app required, visible guest lists. Sensor Tower estimated about 500K MAU in Q1 2025, up 400% YoY; the company said it added 2M users ([CNBC via NBC New York](https://www.nbcnewyork.com/news/business/money-report/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple/6231135/)). | Event pages people actually forward: fun cover, one-tap RSVP, "who's going", add-to-calendar, +1 link. | [med] estimates |
| **e.l.f.** | First branded TikTok campaign built on an original song ("Eyes. Lips. Face.", 2019), which invited mass UGC and later became a full-length track ([e.l.f. release, Oct 11, 2019](https://investor.elfbeauty.com/stock-and-financial/press-releases/landing-news/2019/10-11-2019-073719954); [Fast Company](https://www.fastcompany.com/90849928/elf-beauty-entertainment-super-bowl)). View and video totals vary widely by source. | A short original audio hook plus a duet/stitch prompt for each campaign. | [med]; counts [low] |
| **Liquid Death** | Absurdist, metal-show branding on the most boring product (canned water) with a values angle (anti-plastic); valued at $1.4B in 2024 ([Fortune, Mar 15, 2024](https://fortune.com/2024/03/15/liquid-death-ceo-mike-cessario-interview-beverage-unicorn-water-beer/)). | Make dull civic things (registering, county meetings, poll-worker shifts) feel like merch drops. | [med] |
| **Rare Beauty** | Mission is structural, not a campaign: 1% of sales to the Rare Impact Fund for mental health, launched July 2020 with a $100M, 10-year goal ([Rare Beauty](https://rarebeauty.com/blogs/rare-impact/rare-impact-fund)). Tone is gentle and self-accepting. | Put specific, checkable community-care commitments on the site (e.g., every event lists accessibility and whether there is childcare); mental-health-aware tone after a hard election. | [high] |
| **Glossier** | Grew out of the Into The Gloss blog; reader comments informed products ([summary](https://d2c-growth-talk.beehiiv.com/p/glossier-from-startup-to-cult-beauty-brand)). Often-repeated "90% of growth from fans" figures are untraceable. | Crowdsource the agenda: "What should we fight for in Seminole?" with public results. | [low-med] |
| **Telfar** | "Not for you, for everyone." When bots and resellers made bags scarce, the 2020 Bag Security Program opened a 24-hour window to pre-order any bag in any quantity, made to order ([Refinery29, Aug 2020](https://www.refinery29.com/en-us/2020/08/9969813/telfar-shopping-bag-security-program-24-hour-preorder)). | Inclusive access over fake scarcity: everyone gets a founding-member card; no "only 3 spots left" theatre. | [high] |
| **Crocs** | Jibbitz charms turn a commodity shoe into a self-expression canvas. | Sticker/badge customization on member cards and avatars. | [low] for figures; mechanic well known |
| **Depop** | Peer-to-peer marketplace that was over 90% under-26 at Etsy's 2021 acquisition ([The Verge, Jun 2, 2021](https://www.theverge.com/2021/6/2/22464572/etsy-targets-gen-z-shoppers-with-1-6-billion-depop-acquisition)). | Members-as-creators: member-made sticker and poster designs, voted on. | [med] |
| **BeReal** (caution) | Random daily prompt, two-minute window, "authentic" pitch. Apptopia estimated DAU fell 61%, from about 15M (Oct 2022) to under 6M (Mar 2023) ([Dazed](https://www.dazeddigital.com/life-culture/article/61166/1/why-did-bereal-fail-social-media-instagram-authenticity)); the company disputed third-party estimates ([Gizmodo](https://gizmodo.com/bereal-userbase-continues-to-shrink-similarweb-1850887998)). | Lesson: a daily obligation without fresh content burns out. Use weekly cadence. | [med] |
| **Poppi** (caution) | Sent branded vending machines to 32 influencers before the 2025 Super Bowl; the backlash centered on excess given to people who already had reach ([NBC LA](https://nbclosangeles.com/the-scene/poppi-vending-machines-influencers-controversy/3630948/)). PepsiCo still bought the brand for $1.95B. | Lesson for a Dem club: never look flashy with money. Show receipts and frugality. | [med] |
| **Arc / The Browser Company** | Loved for design delight and personality; Arc development stopped in May 2025 and Atlassian agreed to buy the company for about $610M ([Engadget, Sep 2025](https://www.engadget.com/big-tech/atlassian-is-buying-arc-maker-the-browser-company-for-610-million-145236236.html)). | Delight (micro-animations, easter eggs) is a bonus; build on boring, durable, portable tech. | [med] |
| **Brat summer / Kamala HQ** | Charli XCX posted "kamala IS brat" on July 21, 2024; the campaign renamed its account Kamala HQ with a lime-green, lowercase banner mirroring the album ([Al Jazeera, Jul 23, 2024](https://www.aljazeera.com/news/2024/7/23/kamala-is-brat-the-viral-pop-meme-driving-the-harris-election-campaign)). Collins made "brat" its 2024 Word of the Year ([CNN, Nov 1, 2024](https://amp.cnn.com/cnn/2024/11/01/style/brat-word-of-the-year-collins-dictionary-intl-scli)). Young voters still shifted toward Trump in 2024 while favoring Harris overall ([Tufts Now, Nov 12, 2024](https://now.tufts.edu/2024/11/12/young-voters-shifted-toward-trump-still-favored-harris-overall)). | Speed and meme-native design get attention; they do not replace contact and organizing. Do not copy the brat look in late 2026: it is two years old and someone else's brand. | [high] |

---

## Part B - The science of why things spread

### B1. STEPPS: a checklist for every page

Jonah Berger's *Contagious* packages six drivers of word of mouth as STEPPS: Social currency, Triggers, Emotion, Public, Practical value, Stories ([Knowledge at Wharton](https://knowledge.wharton.upenn.edu/article/contagious-jonah-berger-on-why-things-catch-on/); [book page](https://jonahberger.com/books/contagious/)). **[high]** Applied to youngsemdem:

| Driver | Meaning | Site feature |
|---|---|---|
| Social currency | Sharing makes me look smart, funny or in the know | Quiz result cards, founding-member number, insider "what's actually on the county agenda" explainers |
| Triggers | Frequent cues bring the idea to mind | Calendar feeds, recurring weekly prompt, tying posts to things people already do (game days, Wrapped season, first-of-month) |
| Emotion | High-arousal feelings travel | Joy, pride, awe, righteous energy; not despair |
| Public | Visible behavior gets copied | Opt-in "who's going" lists, pledge walls, stickers, profile frames |
| Practical value | Useful info gets forwarded | "How to register in 60 seconds", "What's on your ballot", Spanish versions |
| Stories | Ideas ride inside narratives | Member spotlights (real, consented), short vertical video stories |

### B2. Emotion: arousal beats sadness

Berger and Milkman analyzed which New York Times articles made the most-emailed list over three months and ran lab experiments: content evoking high-arousal emotions (awe, anger, anxiety) spread more; low-arousal sadness spread less; positive content spread more overall ([Berger & Milkman, JMR 2012, PDF](https://faculty.wharton.upenn.edu/wp-content/uploads/2011/11/Virality.pdf)). **[high]** Implication: lead with awe, humor and collective pride ("look what 40 of us did in Sanford on a Tuesday") and channel anger into a specific action. Anxiety also spreads but is the raw material of the fundraising-email genre young Democrats say they hate (Part D).

### B3. Social proof is powerful, and it cuts both ways

- In a 14,341-person artificial music market, showing download counts increased both inequality and unpredictability of which songs won ([Salganik, Dodds & Watts, Science 2006](https://www.cs.toronto.edu/~bor/303s19/docs/salganik_dodds_watts.pdf)). **[high]**
- In a petition experiment, the effect of telling people how many others had signed varied with the number shown and was strongest above one million ([Margetts et al., European Political Science Review 2011](https://www.cambridge.org/core/journals/european-political-science-review/article/social-information-and-political-participation-on-the-internet-an-experiment/2E60A67C9A457DC66B884E87CBA8E941)). **[high]** For a small county club, "12 people signed" can *depress* action. Show counts only when they are meaningful, or frame small numbers as founding status.
- In a 61-million-person Facebook experiment in 2010, an Election Day message showing faces of friends who had voted raised turnout; the information-only message had no measurable effect; about 340,000 extra votes were estimated, much of it through close friends ([Bond et al., Nature 2012](https://sparq.stanford.edu/sites/g/files/sbiybj19021/files/media/file/bond_et_al._2012_-_a_61-million-person_experiment_in_social_influence_political_mobilization.pdf); [UC San Diego release](https://today.ucsd.edu/story/facebook_fuels_the_friend_vote)). **[high]** Friends, not crowds, are the lever.

### B4. Strong ties: friend-to-friend beats broadcast

A randomized study of the Outvote app in the 2018 midterms estimated that a friend's text raised turnout among compliers by 8.3 percentage points (95% CI 1.2 to 15.3; intent-to-treat 2.09 points), against a meta-analytic average of 0.44 points for automated texting ([Schein et al., WWW '21](https://www.cs.columbia.edu/~blei/papers/ScheinVafaSridharVeitchQuinnMoffetBleiGreen2021.pdf)). **[high, wide CI]** CIRCLE found that 59% of young nonvoters were never contacted by any organization in 2024, and 48% of youth without college experience were never contacted ([CIRCLE, Jan 15, 2025](https://circle.tufts.edu/latest-research/2024-poll-barriers-issues-economy)). **[high]** The site's central job is to make members good at contacting their own friends. Context for the moment: CIRCLE's preliminary estimate puts 2026 midterm youth (18-29) turnout at 27% (plus or minus 2), the second-highest midterm in 30 years, with 66% of young voters backing Democratic House candidates ([CIRCLE, Nov 2026](https://circle.tufts.edu/2026-election)). **[high, preliminary]** There is energy to retain; the post-election weeks are when a club either converts it into habits or loses it.

### B5. Commitment and planning

- A 2008 phone experiment (N = 287,228) found that helping people make a voting plan (when, where, how) raised turnout 4.1 points overall and about 9.1 points among people who were the only eligible voter in their household ([Nickerson & Rogers, Psychological Science 2010](https://toddrogers.scholars.harvard.edu/publications/do-you-have-voting-plan-implementation-intentions-voter-turnout-and-organic)). **[high]**
- Pledging to vote on college campuses raised turnout 3.7 points overall and 5.6 points among first-time voters ([Costa, Schaffner & Prevost, PLOS ONE 2018](https://pmc.ncbi.nlm.nih.gov/articles/PMC5973556/)). **[high]**

### B6. Loop math: K-factor and cycle time

Viral coefficient K = invites sent per user x conversion rate of those invites; K above 1 compounds on its own, and shortening the cycle time (join to friend joins) usually matters more than raising K ([David Skok, For Entrepreneurs](https://www.forentrepreneurs.com/lessons-learnt-viral-marketing/)). **[high, definitional]** Skok also recommends rewarding both inviter and invitee and removing invite friction.

- **Dropbox:** Drew Houston's deck credits a two-sided referral incentive with permanently raising signups 60%, with referrals at 35% of daily signups ([Startup Lessons Learned, 2010](https://www.slideshare.net/gueste94e4c/dropbox-startup-lessons-learned-3836587)). **[med-high]**
- **Robinhood:** a pre-launch waitlist where referrals moved you up the line reportedly reached close to 1M people ([Viral Loops](https://viral-loops.com/blog/how-robinhood-got-1-million-users/)). **[low-med, vendor]** Critics note people dislike waiting and the tactic transfers poorly ([Medium critique](https://medium.com/@laurensdebo/why-startups-should-think-twice-about-referral-priority-waitlists-f4dca1e1a1a2)). For a political club, use the position number as status, not as a pressure gate.

A realistic target for a county club is not K > 1; it is K around 0.3-0.6 with a short cycle, which still multiplies every event and post.

### B7. Where sharing actually happens: DMs and group chats

- Instagram head Adam Mosseri has repeatedly said more photos and videos are shared in DMs than in Stories, and more in Stories than in Feed ([Business Insider](https://www.businessinsider.nl/instagram-head-adam-mosseri-on-the-paradigm-shift-from-posting-in-public-to-sharing-in-private)). **[med]**
- A Giphy survey reported by Axios found that 79% share major life updates with their group chats before their families, and 90% before posting on social media ([Axios, Oct 21, 2025](https://www.axios.com/2025/10/21/giphy-group-chats-gen-z-survey)). **[med, seen via summary]**
- **What a link looks like in the chat is the product.** Apple's Messages previews read Open Graph tags, do **not** run JavaScript or follow meta redirects, want images at least 900 px wide (icons at least 108 px), cap the page's main resource at 1 MB and associated assets at 10 MB, autoplay a directly linked MP4 in `og:video`, and advise keeping text out of preview images and the site name out of `og:title` ([Apple TN3156, Apr 30, 2024](https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages)). **[high]** Open Graph requires `og:title`, `og:type`, `og:image`, `og:url` and recommends `og:image:alt` with every image ([ogp.me](https://ogp.me/)). **[high]**
- The Web Share API (`navigator.share`) opens the phone's native share sheet with title, text, URL or files; it needs HTTPS and a user tap, and is not supported everywhere, so a copy-link fallback is required ([MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)). **[high]**

Consequence for a static site: personalized results must exist as real, pre-rendered pages with their own OG tags (e.g., `/quiz/canvass-gremlin/`), because a JavaScript-rendered result will preview as the generic homepage.

### B8. Short-form vertical video and remix culture

- 39% of U.S. adults 18-29 regularly get news on TikTok (Aug 24-30, 2026 survey), down from 43% in 2025; 20% of all adults do ([Pew, Oct 19, 2026](https://www.pewresearch.org/short-reads/2026/10/19/1-in-5-americans-regularly-get-news-on-tiktok/)). **[high]**
- 70% of under-30s say they mostly bump into political news rather than seek it out; 38% regularly get news from news influencers; 50% have at least some trust in information from social media ([Pew, Dec 3, 2025](https://www.pewresearch.org/journalism/2025/12/03/young-adults-and-the-future-of-news/)). **[high]** Content must travel to people; few will come to a county club's homepage on their own.
- YouTube says Shorts average over 200 billion daily views ([YouTube blog, Cannes 2025](https://blog.youtube/news-and-events/neal-mohan-cannes-2025/)). **[high as a company claim]**
- TikTok's own creative guidance: vertical 9:16, sound on, at least 720p, keep text inside the UI safe zone, put the hook up front (its help center says within the first 6 seconds) ([TikTok creative best practices](https://ads.tiktok.com/help/article/creative-best-practices)). **[high]**
- Remix is native: TikTok launched Stitch in September 2020 so creators can clip up to five seconds of another video into their own, with attribution ([TikTok Newsroom](https://newsroom.tiktok.com/en-us/new-on-tiktok-introducing-stitch)); Instagram's "Add Yours" sticker (Nov 2021) creates public chains of responses to a prompt ([TechCrunch](https://techcrunch.com/2021/11/01/instagram-rolls-out-an-add-yours-sticker-in-stories-to-create-threads-users-can-respond-to/)). **[high]**
- On iOS, inline video autoplays only when muted and marked `playsinline` ([WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/)). **[high]**
- For member uploads without exposing API keys, Cloudflare Stream issues one-time upload URLs (basic POST up to 200 MB, tus for larger or resumable) ([Cloudflare docs](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)). **[high]**

### B9. Quizzes and identity results

The New York Times' 2013 dialect quiz ("How Y'all, Youse and You Guys Talk") was reported as the paper's most popular page that year ([Christian Science Monitor, 2014](https://csmonitor.com/The-Culture/Verbal-Energy/2014/0306/Accents-that-put-us-all-over-the-map)). **[med]** Combined with Wrapped's identity cards, the pattern is clear: people share results that describe them, especially local and slightly funny ones.

---

## Part C - Gen Z and young-millennial web UX expectations

youngsemdem's band (40 and under) spans Gen Z and younger millennials. Design the voice for Gen Z, the utility for both.

1. **Mobile-first and fast.** Google's 2016 research found 53% of mobile visits are abandoned if a page takes over 3 seconds ([Think with Google](https://www.thinkwithgoogle.com/consumer-insights/consumer-trends/mobile-site-load-time-statistics/)). **[med, old but directionally durable]** Target Core Web Vitals "good" at the 75th percentile: LCP at or under 2.5 s, INP at or under 200 ms, CLS at or under 0.1 ([web.dev](https://web.dev/articles/vitals)). **[high]** About 4 in 10 U.S. teens say they are online almost constantly ([Pew, Dec 9, 2025](https://www.pewresearch.org/internet/2025/12/09/teens-social-media-and-ai-chatbots-2025/)). **[high]** Apple's 1 MB main-resource limit for previews is another reason to keep HTML lean.
2. **Dark mode, done right.** In a Nielsen Norman Group survey of 115 mobile users, about a third used dark mode, a third light, a third both; NN/g recommends following the OS setting by default, optionally adding a toggle, and testing contrast in both modes ([NN/g, Aug 27, 2023](https://www.nngroup.com/articles/dark-mode-users-issues/)). **[med, small n]** Widely repeated "73% of Gen Z prefer dark mode" figures could not be traced to a primary source. **[low]**
3. **Accessible poppy colour.** 94.8% of the top million home pages had detectable WCAG failures in 2025, and low-contrast text (79.1%) was the most common ([WebAIM Million 2025](https://webaim.org/projects/million/2025)). **[high]** Poppy palettes are exactly where contrast fails: pair neon fills with near-black text, check every token pair at 4.5:1, and respect `prefers-reduced-motion` for all confetti and marquee effects. The CDC reports up to 1 in 4 (28.7%) U.S. adults have a disability ([CDC](https://www.cdc.gov/disability-and-health/articles-documents/disability-impacts-all-of-us-infographic.html)). **[high]**
4. **Authenticity over polish, and honest AI.** Adults 18-29 are heavy AI users (66% use chatbots, 31% daily) yet the most pessimistic age group: 48% expect AI to hurt society, 14% expect it to help ([Pew, Jun 17, 2026](https://www.pewresearch.org/internet/2026/06/17/how-opinions-and-use-of-ai-differ-by-age/)). **[high]** In IAB's 2026 study, 39% of Gen Z felt negative about AI-generated ads (vs 20% of millennials), 30% called brands using them inauthentic, and clear disclosure was the third-biggest driver of attention ([IAB, Jan 15, 2026](https://www.iab.com/insights/the-ai-ad-gap-widens/)). **[high]** Use Claude for visible, labeled utility; never for fake members, faces or testimonials.
5. **Privacy.** 73% of U.S. adults feel little or no control over data companies collect, and among those aware of AI, 70% have little or no trust in companies to use it responsibly ([Pew, Oct 18, 2023](https://www.pewresearch.org/internet/2023/10/18/how-americans-view-data-privacy/)). **[high]** Political affiliation is sensitive: collect the minimum, no ad pixels by default, cookie-free analytics, plain-language privacy page.
6. **Multilingual by default.** USAFacts, using 2024 Census estimates, puts Seminole County's Hispanic share at 25.4% ([USAFacts](https://usafacts.org/data/topics/people-society/population-and-demographics/our-changing-population/state/florida/county/seminole-county)). **[med, verify against Census QuickFacts]** Spanish share cards and pre-written Spanish texts should ship with the English ones, reviewed by a fluent human.
7. **Low-attention, pass-along reading.** Given Pew's finding that most young adults stumble onto political news, every page needs a 5-second takeaway, a single primary action and a share button visible without scrolling on a 390 px screen.

---

## Part D - Anti-patterns to design out

1. **Fellow-kids cringe.** In Morning Consult's Oct 2024 survey, 71% of Gen Z (13-27) had seen brands use slang or trends in the past month; 42% liked it and 32% did not; Gen Z were 14 points more likely than millennials to call it cringey and more likely to say brands misunderstood the trend; across adults, 35% wanted less of it vs 12% more ([Morning Consult, Dec 9, 2024](https://intel.morningconsult.com/mc-content/analysis/brands-social-media-trends)). **[high]** YPulse reports most Gen Z think brands have about a week to join a trend before it feels stale ([YPulse, Apr 3, 2025](https://www.ypulse.com/article/2025/04/03/how-fast-brands-need-to-move-on-viral-trends-according-to-gen-z/)). **[med]** Political precedent: the Clinton campaign's Dec 2015 "like your abuela" listicle triggered #NotMyAbuela ([NBC News](https://www.nbcnews.com/politics/2016-election/clinton-s-abuela-pitch-latinos-prompts-twitter-backlash-n485166)). **[high]** Rule: let members write the slang; the site speaks plainly and warmly, and is funny about local specifics rather than borrowed memes.
2. **Guilt-trip fundraising.** A Nov 2022 Civiqs survey of Democratic-voting Democrats and independents found 59% of 18-34-year-olds get too many impersonal emails and texts they never signed up for, 67% would opt out of all of them if they could, and 50% called Democratic fundraising emails mostly annoying vs 5% mostly helpful ([Election Law Blog](https://electionlawblog.org/?p=133146); [Daily Kos, commissioner](https://www.dailykos.com/stories/2022/11/18/2136904/-DOOOOM-Everyone-voting-for-Democrats-hates-how-Democrats-have-been-doing-email)). **[med]** A Princeton-led analysis of 2020-cycle political email found manipulative tactics (fake reply threads, clickbait, misleading match claims) were the norm, not the exception ([Mathur et al.](https://bstewart.scholar.princeton.edu/publications/manipulative-tactics-are-norm-political-emails-evidence-100k-emails-2020-us)). **[high]** ActBlue added standards for matching claims in Aug 2025 ([ActBlue](https://www.actblue.com/posts/holding-the-line-our-progress-on-account-use-policy-enforcement/)), yet 400% match emails were still being reported in Nov 2025 ([Sludge, Nov 6, 2025](https://readsludge.com/2025/11/06/the-democrats-wont-stop-spamming/)). **[med]**
3. **Dark patterns.** The FTC's 2022 staff report flags fake countdown timers, false scarcity, hidden or delayed disclosures, pre-checked or trick consents, and hard-to-cancel flows, and notes harms compound when combined ([FTC, Sep 2022](https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf)). **[high]** No pre-checked recurring donations, no fake deadlines, unsubscribe in one tap.
4. **Shame-based social pressure.** Mailing people their neighbors' voting records raised turnout 8.1 points but prompted many households to call and ask to be removed ([Gerber, Green & Larimer, APSR 2008](https://isps.yale.edu/sites/default/files/publication/2012/12/ISPS08-001.pdf)). **[high]** Leaderboards celebrate participation; they never name non-participants.
5. **Fake or tiny counters.** Fabricated numbers are a deceptive pattern; tiny real numbers can backfire (Margetts et al.). In the demo, every counter must carry a visible "demo data" label.
6. **AI slop.** See Part C item 4. No AI-generated "members", photos of "volunteers", or endorsement quotes.
7. **Daily-obligation fatigue.** BeReal's decline (Part A). Weekly cadence beats daily nagging for a volunteer org.
8. **Flexing money.** Poppi (Part A). Receipts and frugality are on-brand for a grassroots club.
9. **Borrowed or appropriated identity.** Per the project's brand-safety rules: no Native American imagery or "warrior/tribe" language around the Seminole name; no copied artist branding (brat lime plus lowercase Arial is Charli XCX's and dated); no real politicians' faces presented as endorsers.

---

## Part E - Prioritized catalog: 23 mechanics for a static site

**Priority:** P0 = build into the demo now; P1 = build now if time allows, else first post-launch sprint; P2 = later or after real-domain launch. **Effort:** S (hours), M (a day or two), L (needs a backend service).

### Summary table

| # | Mechanic | Priority | Effort | Main lever | Primary metric |
|---|---|---|---|---|---|
| 1 | Group-chat-ready links (static OG/Twitter tags + share images on every page) | P0 | S-M | Public, cycle time | Preview CTR from shared links |
| 2 | "Send it to the group chat" share sheet with pre-written texts | P0 | S | Friction, strong ties | Shares per visitor; arrivals per share |
| 3 | Identity quiz with pre-rendered result pages and 9:16 cards | P0 | M | Social currency | Share rate per result; quiz-start rate from shared results |
| 4 | Partiful-style event pages (no-account RSVP, who's going, .ics, +1 link) | P0 | M | Public, strong ties | RSVP rate; invites per RSVP; show-up rate |
| 5 | Make-a-plan tool (when, where, how) with calendar and text-yourself | P0 | S-M | Implementation intentions | Plans completed; calendar adds |
| 6 | Pledge card ("I'm in") with opt-in public wall | P0 | S-M | Commitment, public | Pledges; pledge-card shares |
| 7 | Honest, threshold-gated social-proof counters | P0 | S | Social proof | Conversion with vs without counter |
| 8 | Vertical video wall ("The Reel") with lightweight embeds | P0 | M | Short-form video | Play rate; completion; tap-through to action |
| 9 | Moderated member video submissions ("Post your take") | P1 | M-L | UGC, remix | Submissions; approval rate; UGC views |
| 10 | Weekly prompt chain (#SemDem prompt, Add Yours style) with templates | P1 | S | Triggers, UGC | Participating posts; prompt-page visits |
| 11 | Poster and sticker generator (own palette, URL watermark) | P1 | M | Public, practical value | Downloads; watermark-URL arrivals |
| 12 | "Bring three" friend ladder with two-sided, non-cash rewards | P1 | M | Referral loop | K = i x c; cycle time |
| 13 | Founding-member numbered card | P0 | S-M | Social currency | Signup conversion; card shares |
| 14 | Weekly action streaks with a freeze | P1 | M | Habit | W1/W4 member retention |
| 15 | Friendly city-vs-city board (Sanford, Oviedo, Lake Mary...) | P2 | M | Competition | Actions by city; breadth of cities active |
| 16 | "Seminole Wrapped" (December year-in-review stories + personal card) | P1 | M | Identity, timing | Story views; shares; new signups in December |
| 17 | Calendar subscribe feed and reminder opt-ins | P0 | S | Triggers | Subscriptions; reminder-to-attendance |
| 18 | Ask Claude: labeled civic explainer and translator | P1 | L | Practical value | Questions answered; helpful rate; handoff to action |
| 19 | Claude invite-writer (drafts a personal text the user edits and sends) | P1 | L | Strong ties, friction | Drafts to shares |
| 20 | Low-cadence newsletter with forward-to-a-friend and no guilt | P1 | S-M | Practical value | Opens/clicks; unsubscribes; forwards |
| 21 | No-guilt chip-in page with receipts | P1 | S | Trust | Donation conversion; recurring retention |
| 22 | QR-everything for physical spaces (stickers, flyers, tables) | P0 | S | Triggers, public | Scans per placement |
| 23 | Delight layer (easter eggs, confetti on actions, alt dark-mode copy) | P2 | S | Emotion | Return visits; social mentions |

### Detailed entries

**1. Group-chat-ready links (P0)**
- *What:* every page ships static `og:title` (no site name), `og:description`, `og:image` (1200x630, at least 900 px wide), `og:image:alt`, `og:url`, `og:site_name`, `og:locale` (and `es_US` variants), `twitter:card=summary_large_image`; video pages add a direct MP4 `og:video`.
- *Why:* most sharing is private messaging (B7). Apple previews read OG tags and run no JavaScript ([TN3156](https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages)); a good preview is the ad. **[high]**
- *How:* a build script (Node + Satori or Playwright screenshotting an HTML template) generates per-page images from page front-matter; keep big, minimal type (Apple advises little or no text; a short headline in very large type is a reasonable compromise, test it). `SITE_URL` lives in one config file so absolute OG URLs switch when the real domain arrives.
- *Measure:* arrivals with `?s=` share parameters by channel; manual QA matrix (iMessage, WhatsApp, Instagram DM, Discord, X) before each launch.

**2. "Send it to the group chat" share sheet (P0)**
- *What:* one button calling `navigator.share()` with a pre-written, editable message in the site's voice (English and Spanish), plus fallbacks: copy link, `sms:` link, WhatsApp link, and "save image" for cards.
- *Why:* Skok: friction and cycle time dominate loop growth; Mosseri and the Giphy survey show sharing lives in DMs and group chats. **[high/med]**
- *How:* feature-detect Web Share (HTTPS and a user tap required, per [MDN](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share)); append `?s=<channel>&r=<anon-ref>` to URLs; never auto-send anything.
- *Measure:* share-button taps, `share()` promise resolutions, arrivals per share (proxy for c in K = i x c).

**3. Identity quiz with result cards (P0)**
- *What:* a 6-8 question, 60-second quiz ("What kind of Seminole Dem are you?") with 6-8 affectionate archetypes (e.g., The Canvass Gremlin, The Policy Girlie, The Group-Chat Mayor, The Clipboard Romantic), each mapped to one concrete next action.
- *Why:* Wrapped-style identity sharing (Part A) and the NYT quiz pattern (B9); STEPPS social currency. **[high/med]**
- *How:* pure client-side scoring; each archetype also exists as a static page (`/quiz/<type>/`) with its own OG image, so a shared result previews correctly without JS; card export via canvas in 1080x1920 and 1080x1350; Spanish versions. Results are never stored server-side unless the user signs up.
- *Measure:* completion rate, share rate per archetype, quiz starts from result pages (the loop), action clicks per archetype.

**4. Partiful-style event pages (P0)**
- *What:* each event has a page with a playful cover, plain-language "what, when, where, who it's for", accessibility and childcare notes, one-tap RSVP (first name plus phone or email, no account), optional first-name-only "who's going", add-to-calendar (.ics and Google link), and a "+1 / bring a friend" link.
- *Why:* Partiful's link-first, no-app flow (Part A); Bond et al. show friends' visible participation moves people. **[med/high]**
- *How:* events live in `data/events.json` (or Markdown front-matter) and render to static pages; RSVP posts to a swappable form adapter (Netlify Forms, Formspree, or a Cloudflare Worker + D1/Supabase). Demo events are labeled "demo".
- *Measure:* RSVP/view, +1 links sent per RSVP, show-up rate (check-in QR at the door).

**5. Make-a-plan tool (P0)**
- *What:* three taps: when (early, mail, Election Day), how you'll get there, who you're going with; output is a calendar event, a text-to-self, and a shareable "my plan" card (no personal address on it).
- *Why:* plan-making raised turnout 4.1 points, about 9 among single-voter households ([Nickerson & Rogers](https://toddrogers.scholars.harvard.edu/publications/do-you-have-voting-plan-implementation-intentions-voter-turnout-and-organic)). **[high]**
- *How:* static page; election dates pulled from a single config file sourced from the Seminole County Supervisor of Elections (verify before publishing; dates are not asserted here).
- *Measure:* plans completed, calendar adds, plan-card shares; post-election self-report.

**6. Pledge card with opt-in wall (P0)**
- *What:* "I'm in for 2027-28" pledge that generates a card with first name and city; optional inclusion on a public wall.
- *Why:* pledging raised turnout 3.7 points, 5.6 among first-time voters ([Costa et al.](https://pmc.ncbi.nlm.nih.gov/articles/PMC5973556/)); public commitment plus friend visibility (Bond). **[high]**
- *How:* same card engine as #3; wall shows first name + initial + city only with explicit consent; follow-up reminder references the pledge.
- *Measure:* pledges, share rate, later actions by pledgers vs non-pledgers.

**7. Honest, threshold-gated counters (P0)**
- *What:* counters ("312 Seminole friends are in") only appear past a threshold; below it, frame as founding status ("Be one of the first 100").
- *Why:* social information helps at scale and can depress action when small (Margetts); fabricated counts are deceptive (FTC). **[high]**
- *How:* counts come from the real data source; demo mode shows a "demo data" badge.
- *Measure:* A/B conversion with counter shown vs hidden once real traffic exists.

**8. Vertical video wall, "The Reel" (P0)**
- *What:* a swipeable 9:16 grid of 15-60 s clips (member explainers, event recaps), captions on, sound off by default with a tap to unmute.
- *Why:* 39% of 18-29s regularly get news on TikTok ([Pew 2026](https://www.pewresearch.org/short-reads/2026/10/19/1-in-5-americans-regularly-get-news-on-tiktok/)); Shorts scale; TikTok's own creative rules. **[high]**
- *How:* self-hosted H.264 MP4 with poster images and `autoplay muted playsinline loop` for previews ([WebKit](https://webkit.org/blog/6784/new-video-policies-for-ios/)); TikTok/Instagram/YouTube embeds behind a click-to-load facade so third-party scripts do not hurt speed or privacy; WebVTT captions; each clip page has `og:video`.
- *Measure:* play rate, average watch percentage, tap-through to the linked action, shares per clip.

**9. Moderated member video submissions (P1)**
- *What:* "Post your take": members upload a short vertical clip or paste a TikTok/IG link, tick consent and a content-rules box, and it goes into a review queue before publishing.
- *Why:* Stitch and Add Yours show remix and response are native behaviors ([TikTok](https://newsroom.tiktok.com/en-us/new-on-tiktok-introducing-stitch); [TechCrunch](https://techcrunch.com/2021/11/01/instagram-rolls-out-an-add-yours-sticker-in-stories-to-create-threads-users-can-respond-to/)). **[high]**
- *How:* demo: link-paste form only. Real domain: Cloudflare Stream one-time upload URLs minted by a Worker ([docs](https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/)), or Mux equivalent; human approval required; 18+ attestation; takedown contact.
- *Measure:* submissions/week, approval rate, median time to approve, views of member clips vs org clips.

**10. Weekly prompt chain (P1)**
- *What:* one prompt per week ("Show us the Seminole spot that needs fixing", "Your 10-second why"), with a template, a hashtag and a gallery of approved responses.
- *Why:* Add Yours chains and e.l.f.'s UGC-from-a-hook pattern; STEPPS triggers via a fixed weekday. **[high/med]**
- *How:* static prompt page per week from a data file; downloadable story template; gallery fed by #9.
- *Measure:* responses per prompt, prompt-page visits, new followers.

**11. Poster and sticker generator (P1)**
- *What:* type a line, pick a palette and layout, get a story-size or square poster with a small `youngsemdem` URL watermark.
- *Why:* the 2024 brat-generator wave showed how easy-to-remix templates spread ([example listing](https://www.producthunt.com/products/brat-text-generator-5)); STEPPS public and practical value. **[med]**
- *How:* canvas rendering, own brand palette and type (not artist look-alikes), profanity filter, Spanish templates; no server needed.
- *Measure:* generations, downloads, arrivals via the watermark short URL.

**12. "Bring three" friend ladder (P1)**
- *What:* after any action, invite three specific friends; milestones (1, 3, 10 friends joined) unlock non-cash, two-sided perks (both people get the sticker pack or a reserved seat at the next social).
- *Why:* friend contact is the strongest lever measured (Schein et al. 8.3-point CACE); Dropbox's two-sided incentive; Skok on rewarding both sides. **[high/med-high]**
- *How:* anonymous ref code in URLs, attributed at signup; counts in the form backend; never reveal who did not join.
- *Measure:* i (invites per member), c (joins per invite), K = i x c, median cycle time in days.

**13. Founding-member numbered card (P0)**
- *What:* signup returns "You're member #127", a card in the member's chosen colour and stickers.
- *Why:* Robinhood-style position as status (without the queue pressure); Telfar-style "for everyone"; Crocs-style customization. **[low-med]**
- *How:* sequential number from the backend (demo: clearly labeled sample); card via the shared engine.
- *Measure:* signup conversion, card share rate.

**14. Weekly action streaks (P1)**
- *What:* do one small civic action a week (read a 2-minute explainer, text a friend, attend anything) to keep a streak; one free "freeze" a month.
- *Why:* Duolingo's streak and its decoupling of streaks from heavier goals raised streak holders; leaderboards and streaks were core to its growth ([Duolingo](https://blog.duolingo.com/improving-the-streak/); [Mazal](https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth)); BeReal warns against daily obligation. **[med-high]**
- *How:* localStorage for anonymous visitors, synced on signup; weekly cadence; gentle reminders only if opted in.
- *Measure:* week-1 and week-4 retention, actions per active member.

**15. City-vs-city board (P2)**
- *What:* a friendly board of actions by city (Sanford, Lake Mary, Oviedo, Winter Springs, Altamonte Springs, Casselberry, Longwood, unincorporated).
- *Why:* Duolingo leagues raised learning time 17% (company-reported); competition with ingroups. Shame backfires ([Gerber et al.](https://isps.yale.edu/sites/default/files/publication/2012/12/ISPS08-001.pdf)). **[med]**
- *How:* aggregate counts only, celebrate most-improved, no individual naming; launch once there is enough real activity to avoid the small-number problem.
- *Measure:* actions by city, number of cities with weekly activity.

**16. Seminole Wrapped (P1, December 2026)**
- *What:* a tap-through 9:16 story of the chapter's 2026 (real counts only: events held, doors, new members) plus a personal card for members ("You showed up 4 times; your archetype: The Clipboard Romantic").
- *Why:* Wrapped's scale and share behavior (Part A); timing piggybacks the cultural trigger; Spotify's 2025 Wrapped launched Dec 3, 2025 ([MBW](https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase)). **[high]**
- *How:* static story pages with swipe/tap; personal cards generated from member records at build time (pre-render like Spotify did), linked by private URL.
- *Measure:* story completion, shares, December signups vs November.

**17. Calendar feed and reminders (P0)**
- *What:* "Subscribe to our calendar" (.ics feed), per-event calendar buttons, opt-in SMS or email reminders.
- *Why:* STEPPS triggers; plan-making evidence. **[high]**
- *How:* build the .ics feed from `events.json`; reminders through the form/email provider.
- *Measure:* subscriptions, reminder opt-ins, reminded vs not-reminded attendance.

**18. Ask Claude civic helper (P1)**
- *What:* a clearly labeled "Ask (AI, powered by Claude)" panel for plain-language explainers ("What does the county commission actually do?"), translation to Spanish, and "where do I find X" help, with links to official sources.
- *Why:* 66% of 18-29s use chatbots and 31% daily, but they are the most skeptical age group ([Pew 2026](https://www.pewresearch.org/internet/2026/06/17/how-opinions-and-use-of-ai-differ-by-age/)); disclosure helps with Gen Z ([IAB](https://www.iab.com/insights/the-ai-ad-gap-widens/)). **[high]**
- *How:* static site calls a small serverless proxy (Cloudflare Worker or similar) that holds the API key, applies a system prompt (stay factual, cite official links, decline to impersonate candidates or invent quotes, route voting-logistics questions to the Supervisor of Elections), rate-limits, and logs no personal data; static FAQ fallback when the API is off (the demo can run in a "canned answers" mode). Model choice and pricing should be checked against current Anthropic docs at build time.
- *Measure:* questions per visit, thumbs-up rate, flagged answers, tap-through to an action.

**19. Claude invite-writer (P1)**
- *What:* "Help me invite Jess": pick event, relationship and vibe; Claude drafts a short, personal-sounding text that the user edits and sends through #2.
- *Why:* friend-to-friend contact is the strongest lever (B4); drafting removes the blank-page friction. AI used for drafting, with the human sending, is the least authenticity-threatening use. **[high/med]**
- *How:* same proxy as #18; never sends on the user's behalf; no storage of friends' names.
- *Measure:* drafts generated, drafts shared, RSVPs attributed to invite links.

**20. Low-cadence newsletter (P1)**
- *What:* a short, personality-forward newsletter (the voice work lives in the copy brief) at a promised cadence, with "forward to a friend" and a one-click unsubscribe.
- *Why:* 18-34 Democrats find party email mostly annoying (Part D); 56% of under-30s count someone writing their own news newsletter as a journalist ([Pew, Dec 3, 2025](https://www.pewresearch.org/journalism/2025/12/03/young-adults-and-the-future-of-news/)), so a personal, useful letter can earn trust. **[med/high]**
- *How:* signup form on every page; subject lines without fake urgency; plain-text-friendly template that survives dark-mode email clients.
- *Measure:* open and click rates, unsubscribe rate per send, forwards and referral signups.

**21. No-guilt chip-in page with receipts (P1)**
- *What:* a donate page that says exactly what money buys (e.g., "$15 = 100 stickers"), shows a running receipts list, no pre-checked recurring box, no fake matches or deadlines.
- *Why:* Mathur et al., Civiqs, FTC (Part D); Poppi's backlash on visible excess. **[high/med]**
- *How:* link out to the club's compliant payment processor; receipts from a data file; confirm compliance questions (Open questions).
- *Measure:* conversion, average gift, recurring retention, complaint rate.

**22. QR everywhere (P0)**
- *What:* every flyer, sticker and event table has a QR code to a specific page with placement tags.
- *Why:* triggers and public visibility in physical space; closes the offline-to-online loop. **[med]**
- *How:* static QR images generated at build time; short, readable fallback URL printed under each code (black on white so dark-mode cameras read it, per [NN/g](https://www.nngroup.com/articles/dark-mode-users-issues/)).
- *Measure:* scans per placement, scan-to-action rate.

**23. Delight layer (P2)**
- *What:* small surprises: confetti on RSVP (respecting reduced motion), alternate copy in dark mode, a hidden sticker for people who find the easter egg.
- *Why:* high-arousal positive emotion spreads (Berger & Milkman); delight is a brand signature (Duolingo, Arc). **[med]**
- *How:* CSS and a few lines of JS; off when `prefers-reduced-motion` is set.
- *Measure:* return visits, social mentions, screenshots shared.

### Measurement plan (applies to all)

- **Analytics:** cookie-free, privacy-respecting analytics with custom events (share tap, share success, quiz complete, RSVP, plan made, pledge, video play, Claude query). No ad pixels by default.
- **Attribution:** `?s=` (channel) and `r=` (anonymous referrer code) on every shared URL; record first-touch only at signup.
- **Loop health:** weekly i, c, K and median cycle time; share rate per page; percentage of arrivals that come from shares.
- **Retention:** week-1 and week-4 return of members; actions per active member per month.
- **Outcome proxies:** RSVP-to-attendance, plans made, pledges, and (after future elections) self-reported voting among pledgers.
- **Demo honesty:** a site-wide `DEMO_MODE` flag adds "demo data" badges to counters, events, people and videos.

### Portability notes

- Keep content in data files (`events.json`, `quiz.json`, `prompts.json`, `videos.json`) and render to static HTML so any host works.
- One `site.config` holds `SITE_URL`, languages, form endpoints and the Claude proxy URL; OG images and the .ics feed regenerate from it.
- Wrap forms, video uploads and the AI proxy behind small adapters so the demo can use free tiers and the real domain can swap providers without touching pages.

---

## Recommendations for youngsemdem (short list)

1. Make **"group-chat ready"** the definition of done for every page: static OG tags, a tested preview image, a Web Share button with a pre-written English and Spanish message.
2. Ship **three identity-and-action loops** in the demo: the archetype quiz, Partiful-style events, and plan-plus-pledge cards, all sharing one card engine.
3. Build a **vertical video wall now** and a **moderated upload path** that runs as link-paste in the demo and Cloudflare Stream (or similar) on the real domain.
4. Center the site on **friend-to-friend action**: the "bring three" ladder and the Claude invite-writer, never mass blasts.
5. Use **Claude visibly and honestly** for explaining, translating and drafting; label it, cite official sources, and never use it to create people, faces, quotes or endorsements.
6. Write the **anti-pattern rules into the design system**: no fake urgency, no pre-checked boxes, no fabricated or tiny counters, no shaming leaderboards, no borrowed artist branding, no Native imagery.
7. Design the **second week**: weekly prompts, weekly streaks, a calendar feed, and a December "Seminole Wrapped", because viral spikes fade (19 of 25 last-year winners lost ground).
8. Treat **contrast, speed and dark mode** as P0: neon palettes with near-black text checked at 4.5:1, LCP at or under 2.5 s on a mid-range phone, follow the OS theme with an optional toggle, and reduced-motion support for every animation.

---

## Open questions

1. **Compliance:** Is youngsemdem a chartered club under the Seminole County Democratic Executive Committee or Florida Young Democrats, or its own political committee? That decides required disclaimers on pages and share cards, donation handling, and data rules. Needs a Florida election-law check before anything goes live.
2. **Next elections:** Which dates are next for Seminole voters (municipal, special, 2028 primaries)? The plan tool and pledge copy need dates verified with the Supervisor of Elections.
3. **Moderation capacity:** Who approves member videos, wall entries and prompt responses, and within what time? Without a named moderator, ship link-paste only.
4. **Age floor:** Is membership 18-40 only, or do high-school members participate? Under-18 uploads and data collection raise extra obligations; the safest default is 18+ for uploads.
5. **Claude budget and governance:** Who pays for API usage on the real domain, what rate limits apply, and who reviews flagged answers?
6. **Spanish review:** Who is the fluent human reviewer for Spanish copy and share texts? Is Haitian Creole or Portuguese also needed (not researched here)?
7. **Real counts:** Once real, how many members and events does the club have? This sets counter thresholds and whether a city board makes sense.
8. **Data provider:** Which form and database provider does Kira want for the real domain (cost, data ownership, export)?
9. **Fall 2026 teen data:** The Piper Sandler Fall 2026 figures here come from secondary coverage; confirm against the full report if they are quoted on the site.

---

## Sources

1. Morning Consult, *Fastest Growing Brands 2026* (PDF, fieldwork May-Aug 2026) - https://s3.amazonaws.com/media.mediapost.com/uploads/MORNING_CONSULT_Fastest_Brands_2026.pdf ; report page https://morningconsult.com/reports/fastest-growing-brands-2026
2. Morning Consult, "Gen Z and millennials' fastest growing brands" (Dec 10, 2024) - https://intel.morningconsult.com/mc-content/analysis/gen-z-and-millennials-fastest-growing-brands
3. Morning Consult, brands using social media trends and slang (Dec 9, 2024) - https://intel.morningconsult.com/mc-content/analysis/brands-social-media-trends
4. Piper Sandler, "Completes 50th Semi-Annual Teen Survey" (Oct 9, 2025) - https://www.pipersandler.com/news/piper-sandler-completes-50th-semi-annual-teen-survey
5. roic.ai, Piper Sandler Fall 2026 teen survey coverage (Oct 13, 2026) - https://www.roic.ai/news/piper-sandler-teen-survey-tiktok-roblox-and-beauty-lead-as-snapchat-and-netflix-lag-10-13-2026 ; Retail Dive - https://retaildive.com/news/teen-spending-grows-trade-athletic-apparel-fashion-piper-sandler/833565
6. Stocktwits, Spring 2026 Piper Sandler coverage (Mar 5, 2026) - https://stocktwits.com/news-articles/markets/equity/nike-elf-beauty-drpepper-reign-supreme-among-us-teens/ch6anJvR31p
7. YPulse, "The Top 10 Brands Gen Z Say Gets Them" (Apr 29, 2026) - https://www.ypulse.com/article/2026/04/29/the-top-10-brands-gen-z-say-gets-them/
8. YPulse, "How Fast Brands Need to Move on Viral Trends, According to Gen Z" (Apr 3, 2025) - https://www.ypulse.com/article/2025/04/03/how-fast-brands-need-to-move-on-viral-trends-according-to-gen-z/
9. Music Business Worldwide, Spotify Wrapped 2025 results (Dec 8, 2025) - https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase
10. Spotify Engineering, "Spotify Unwrapped 2019: How We Built an In-App Experience Just for You" (Sep 2020) - https://engineering.atspotify.com/2020/9/spotify-unwrapped-2019-how-we-built-an-in-app-experience-just-for-you
11. Duolingo blog, "Improving the streak" (Nov 19, 2020) - https://blog.duolingo.com/improving-the-streak/
12. Jorge Mazal, "How Duolingo reignited user growth," Lenny's Newsletter (Feb 28, 2023) - https://www.lennysnewsletter.com/p/how-duolingo-reignited-user-growth
13. The Drum, Duolingo's TikTok strategy (Feb 25, 2025) - https://www.thedrum.com/news/2025/02/25/duolingo-s-tiktok-mastermind-its-unhinged-social-strategy-and-killing-its-mascot
14. CNBC via NBC New York, "Meet Partiful" - https://www.nbcnewyork.com/news/business/money-report/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple/6231135/
15. e.l.f. Beauty press release, "Eyes. Lips. Face." song (Oct 11, 2019) - https://investor.elfbeauty.com/stock-and-financial/press-releases/landing-news/2019/10-11-2019-073719954 ; Fast Company - https://www.fastcompany.com/90849928/elf-beauty-entertainment-super-bowl
16. Fortune, Liquid Death CEO interview (Mar 15, 2024) - https://fortune.com/2024/03/15/liquid-death-ceo-mike-cessario-interview-beverage-unicorn-water-beer/
17. Rare Beauty, Rare Impact Fund - https://rarebeauty.com/blogs/rare-impact/rare-impact-fund
18. D2C Growth Talk, Glossier summary - https://d2c-growth-talk.beehiiv.com/p/glossier-from-startup-to-cult-beauty-brand
19. Refinery29, Telfar Bag Security Program (Aug 2020) - https://www.refinery29.com/en-us/2020/08/9969813/telfar-shopping-bag-security-program-24-hour-preorder
20. The Verge, Etsy acquires Depop (Jun 2, 2021) - https://www.theverge.com/2021/6/2/22464572/etsy-targets-gen-z-shoppers-with-1-6-billion-depop-acquisition
21. Dazed, "Why did BeReal fail?" - https://www.dazeddigital.com/life-culture/article/61166/1/why-did-bereal-fail-social-media-instagram-authenticity ; Gizmodo - https://gizmodo.com/bereal-userbase-continues-to-shrink-similarweb-1850887998
22. NBC Los Angeles, Poppi vending machine controversy (Feb 2025) - https://nbclosangeles.com/the-scene/poppi-vending-machines-influencers-controversy/3630948/
23. Engadget, Atlassian buys The Browser Company (Sep 2025) - https://www.engadget.com/big-tech/atlassian-is-buying-arc-maker-the-browser-company-for-610-million-145236236.html
24. Al Jazeera, "'Kamala is brat'" (Jul 23, 2024) - https://www.aljazeera.com/news/2024/7/23/kamala-is-brat-the-viral-pop-meme-driving-the-harris-election-campaign
25. CNN, Collins Word of the Year "brat" (Nov 1, 2024) - https://amp.cnn.com/cnn/2024/11/01/style/brat-word-of-the-year-collins-dictionary-intl-scli
26. Tufts Now, young voters in 2024 (Nov 12, 2024) - https://now.tufts.edu/2024/11/12/young-voters-shifted-toward-trump-still-favored-harris-overall
27. Knowledge at Wharton, "Contagious: Jonah Berger on Why Things Catch On" - https://knowledge.wharton.upenn.edu/article/contagious-jonah-berger-on-why-things-catch-on/ ; book page - https://jonahberger.com/books/contagious/
28. Berger & Milkman, "What Makes Online Content Viral?" JMR 2012 (PDF) - https://faculty.wharton.upenn.edu/wp-content/uploads/2011/11/Virality.pdf
29. Salganik, Dodds & Watts, Science 2006 (PDF) - https://www.cs.toronto.edu/~bor/303s19/docs/salganik_dodds_watts.pdf
30. Margetts, John, Escher & Reissfelder, European Political Science Review 2011 - https://www.cambridge.org/core/journals/european-political-science-review/article/social-information-and-political-participation-on-the-internet-an-experiment/2E60A67C9A457DC66B884E87CBA8E941
31. Bond et al., "A 61-million-person experiment," Nature 2012 (PDF) - https://sparq.stanford.edu/sites/g/files/sbiybj19021/files/media/file/bond_et_al._2012_-_a_61-million-person_experiment_in_social_influence_political_mobilization.pdf ; UC San Diego release - https://today.ucsd.edu/story/facebook_fuels_the_friend_vote
32. Schein et al., "Assessing the Effects of Friend-to-Friend Texting on Turnout in the 2018 US Midterm Elections," WWW '21 (PDF) - https://www.cs.columbia.edu/~blei/papers/ScheinVafaSridharVeitchQuinnMoffetBleiGreen2021.pdf
33. CIRCLE, 2024 post-election poll on contact and barriers (Jan 15, 2025) - https://circle.tufts.edu/latest-research/2024-poll-barriers-issues-economy
34. CIRCLE, 2026 election youth turnout estimate (Nov 2026) - https://circle.tufts.edu/2026-election
35. Nickerson & Rogers, "Do You Have a Voting Plan?" Psychological Science 2010 - https://toddrogers.scholars.harvard.edu/publications/do-you-have-voting-plan-implementation-intentions-voter-turnout-and-organic
36. Costa, Schaffner & Prevost, "Walking the walk?" PLOS ONE 2018 - https://pmc.ncbi.nlm.nih.gov/articles/PMC5973556/
37. Gerber, Green & Larimer, "Social Pressure and Voter Turnout," APSR 2008 (PDF) - https://isps.yale.edu/sites/default/files/publication/2012/12/ISPS08-001.pdf
38. David Skok, "Lessons Learned - Viral Marketing," For Entrepreneurs - https://www.forentrepreneurs.com/lessons-learnt-viral-marketing/
39. Drew Houston, "Dropbox: Startup Lessons Learned" (2010 slides) - https://www.slideshare.net/gueste94e4c/dropbox-startup-lessons-learned-3836587
40. Viral Loops, Robinhood waitlist case study - https://viral-loops.com/blog/how-robinhood-got-1-million-users/ ; critique - https://medium.com/@laurensdebo/why-startups-should-think-twice-about-referral-priority-waitlists-f4dca1e1a1a2
41. Apple, TN3156 "Create rich previews for Messages" (Apr 30, 2024) - https://developer.apple.com/documentation/technotes/tn3156-create-rich-previews-for-messages
42. The Open Graph protocol - https://ogp.me/
43. MDN, Navigator.share() - https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share
44. Business Insider, Adam Mosseri on private sharing - https://www.businessinsider.nl/instagram-head-adam-mosseri-on-the-paradigm-shift-from-posting-in-public-to-sharing-in-private
45. Axios, Giphy group chat survey (Oct 21, 2025) - https://www.axios.com/2025/10/21/giphy-group-chats-gen-z-survey
46. Pew Research Center, "1 in 5 Americans regularly get news on TikTok" (Oct 19, 2026) - https://www.pewresearch.org/short-reads/2026/10/19/1-in-5-americans-regularly-get-news-on-tiktok/
47. Pew Research Center, "Young Adults and the Future of News" (Dec 3, 2025) - https://www.pewresearch.org/journalism/2025/12/03/young-adults-and-the-future-of-news/
48. Pew Research Center, "Teens, Social Media and AI Chatbots 2025" (Dec 9, 2025) - https://www.pewresearch.org/internet/2025/12/09/teens-social-media-and-ai-chatbots-2025/
49. Pew Research Center, "How opinions and use of AI differ by age" (Jun 17, 2026) - https://www.pewresearch.org/internet/2026/06/17/how-opinions-and-use-of-ai-differ-by-age/
50. IAB, "The AI Ad Gap Widens" (Jan 15, 2026) - https://www.iab.com/insights/the-ai-ad-gap-widens/
51. YouTube Official Blog, Neal Mohan at Cannes Lions 2025 - https://blog.youtube/news-and-events/neal-mohan-cannes-2025/
52. TikTok for Business, creative best practices - https://ads.tiktok.com/help/article/creative-best-practices
53. TikTok Newsroom, "Introducing Stitch" (Sep 3, 2020) - https://newsroom.tiktok.com/en-us/new-on-tiktok-introducing-stitch
54. TechCrunch, Instagram "Add Yours" sticker (Nov 1, 2021) - https://techcrunch.com/2021/11/01/instagram-rolls-out-an-add-yours-sticker-in-stories-to-create-threads-users-can-respond-to/
55. WebKit, "New video policies for iOS" (2016) - https://webkit.org/blog/6784/new-video-policies-for-ios/
56. Cloudflare Stream, Direct creator uploads - https://developers.cloudflare.com/stream/uploading-videos/direct-creator-uploads/
57. Christian Science Monitor on the NYT dialect quiz (Mar 2014) - https://csmonitor.com/The-Culture/Verbal-Energy/2014/0306/Accents-that-put-us-all-over-the-map
58. Think with Google, mobile site load time statistics - https://www.thinkwithgoogle.com/consumer-insights/consumer-trends/mobile-site-load-time-statistics/
59. web.dev, Web Vitals - https://web.dev/articles/vitals
60. Nielsen Norman Group, "Dark Mode: How Users Think About It and Issues to Avoid" (Aug 27, 2023) - https://www.nngroup.com/articles/dark-mode-users-issues/
61. WebAIM, The WebAIM Million 2025 - https://webaim.org/projects/million/2025
62. CDC, Disability Impacts All of Us - https://www.cdc.gov/disability-and-health/articles-documents/disability-impacts-all-of-us-infographic.html
63. Pew Research Center, "How Americans View Data Privacy" (Oct 18, 2023) - https://www.pewresearch.org/internet/2023/10/18/how-americans-view-data-privacy/
64. USAFacts, Seminole County, FL population and demographics - https://usafacts.org/data/topics/people-society/population-and-demographics/our-changing-population/state/florida/county/seminole-county
65. Election Law Blog on the Civiqs/Civic Shout survey (Nov 2022) - https://electionlawblog.org/?p=133146 ; Daily Kos (commissioner) - https://www.dailykos.com/stories/2022/11/18/2136904/-DOOOOM-Everyone-voting-for-Democrats-hates-how-Democrats-have-been-doing-email
66. Mathur et al., "Manipulative tactics are the norm in political emails" - https://bstewart.scholar.princeton.edu/publications/manipulative-tactics-are-norm-political-emails-evidence-100k-emails-2020-us
67. ActBlue, account use policy enforcement progress (2025) - https://www.actblue.com/posts/holding-the-line-our-progress-on-account-use-policy-enforcement/ ; Sludge (Nov 6, 2025) - https://readsludge.com/2025/11/06/the-democrats-wont-stop-spamming/
68. FTC staff report, "Bringing Dark Patterns to Light" (Sep 2022, PDF) - https://www.ftc.gov/system/files/ftc_gov/pdf/P214800+Dark+Patterns+Report+9.14.2022+-+FINAL.pdf
69. NBC News, Clinton "abuela" backlash (Dec 2015) - https://www.nbcnews.com/politics/2016-election/clinton-s-abuela-pitch-latinos-prompts-twitter-backlash-n485166
70. Product Hunt, example "brat text generator" listing - https://www.producthunt.com/products/brat-text-generator-5
