# 08 - Benchmark teardown: the Gen Z brand sites youngsemdem has to feel as good as

Research brief for the Young Seminole Democrats (youngsemdem) demo site. Prepared Monday, November 9, 2026, six days after the Nov 3, 2026 general election. Scope: a hands-on teardown of 33 brand home pages (Gen Z beauty, TikTok-era lifestyle and drink brands, and the most-talked-about brand sites overall), current evidence on which of them are hot with Gen Z, a catalog of 47 techniques translated into civic action, the 10 with the best payoff for a static site, and a scoring checklist for judges.

This report builds on, and tries not to repeat, [04 - Gen Z brands and virality](04-genz-brands-virality.md) (the science of sharing, anti-patterns, 23 mechanics), [03 - Left design systems](03-left-design-systems.md) (palettes and type) and [05 - Voice](05-voice-dua-lipa.md) (copy voice). Where those reports already carry a source, this one cites it briefly.

**Confidence key** (same as report 04): **[high]** primary source, our own direct observation, or a recent peer-reviewed study; **[med]** reputable secondary reporting, a company's own claim, or older primary data; **[low]** vendor blog, single unverified source, or a figure seen only in a summary. "Observed" means we saw it on the live site during our capture on Sunday, Nov 8, 2026, from 9:48 to 10:00 pm ET (02:48-03:00 UTC on Nov 9). Live sites change daily, so treat observations as a snapshot.

---

## Headline summary

The most electrifying Gen Z brand sites are not the prettiest. They are the ones that hand visitors a **game** to play (a shade finder, a routine builder, a "which one are you" self-sort), something to **collect** (a mystery compact, a color drop, a points tier), a reason to **come back on a date** (a drop, a "coming soon", a waitlist), and a voice that sounds like a group chat (lowercase heads, "omg hi :)", a HELL YES button). They also keep the interface quiet so that products, people and user content can be loud. Current evidence still puts e.l.f. on top of teen cosmetics (about a third of mentions in Piper Sandler's fall 2026 survey), with Medicube the first K-beauty brand in the teen skincare top 10. TikTok Shop beauty sales grew 82% year over year (about $980M in Q2 2026), led by Medicube and Dr. Melaxin. But 94% of brands score lower on trust with Gen Z than with US adults overall, so tricks backfire. Our captures show the gap youngsemdem can win: 9 of the 23 store home pages fired a discount-for-email pop-up in the first seven seconds, the median mobile home page weighed 6.8 MB (Poppi's: 38 MB), the median page loaded scripts from 37 third-party hosts, and only 1 of 29 (Partiful) shipped any dark-mode styles. The sites that felt best (Partiful, Duolingo, Apple, Spotify Wrapped, Starface) led with the product, not a pop-up. youngsemdem should copy the mechanics (an issue finder with a shareable card, Partiful-grade event pages released as monthly drops, a vertical video reel, organizer levels with weekly challenges, a moderated community wall, an Ask Claude chip with suggested prompts, and a "receipts" tab in the main nav) and skip the dark patterns (pop-ups, fake scarcity, tracker sprawl). It should also beat every brand here on speed, dark mode, Spanish and accessibility.

---

## Contents

1. Who is hot with Gen Z right now (evidence)
2. Method and capture log
3. Cross-site patterns, by the numbers
4. Brand-by-brand teardown
5. Technique catalog: 47 techniques with civic adaptations
6. The 10 techniques with the highest payoff for a static site
7. The desirability bar: a checklist judges can score
8. What not to copy
9. Recommendations for youngsemdem
10. Open questions
11. Sources

---

## 1. Who is hot with Gen Z right now (evidence)

### 1.1 Survey and sales evidence, 2025-2026

| Signal | What it says | Date | Conf. |
|---|---|---|---|
| Piper Sandler teen survey, fall 2026 (about 9,000 teens aged 13-19) | e.l.f. is again the top cosmetics brand with about one-third share. Medicube is the first K-beauty skincare brand in the top 10 (No. 6). Teen girls' beauty spending rose 7% to a survey-high 23% of their wallet. Alo is named among popular athletic brands for girls, and Lululemon lost mindshare for a fifth straight survey ([Retail Dive](https://retaildive.com/news/teen-spending-grows-trade-athletic-apparel-fashion-piper-sandler/833565)) | Oct 21, 2026 | [med]: secondary coverage of a paywalled survey |
| Piper Sandler fall 2025 infographic | Top cosmetics: e.l.f. 36%, Rare Beauty 8%, Maybelline 6%. Top skincare: CeraVe 32%, The Ordinary 10% ([Piper Sandler PDF](https://www.pipersandler.com/sites/default/files/document/TS_Fall25_Infographic.pdf)) | Oct 2025 | [med]: seen via search summary |
| TikTok Shop beauty (Charm.io data) | Beauty GMV about $980M in Q2 2026, up 82% year over year. Medicube did $62.8M in the quarter. Top indie brands for the 12 months to June 2026: Dr. Melaxin $142.2M, Based Bodyworks $50.6M, Bask and Lather $29M ([Beauty Independent](https://www.beautyindependent.com/indie-beauty-brands-surpassed-500-million-on-tiktok-shop-in-the-past-year/); [Tubefilter](https://www.tubefilter.com/2026/07/29/tiktok-shop-whatnot-beauty-sales-indie-brands/amp/)) | Jul 27-29, 2026 | [med]: third-party estimates |
| TikTok Shop livestreams, H1 2026 | Top 10 beauty live sellers did more than $83M, led by Medicube (about $19.4M), Dr. Melaxin ($13.3M), Tarte ($10.2M) and Based ($8.7M). Sephora launched on TikTok Shop in September 2026 with monthly "Drop Shop" livestreams ([Beauty Independent](https://beautyindependent.com/10-beauty-sellers-dominating-tiktok-shop-livestreaming)) | Sep 24, 2026 | [med] |
| Dr. Melaxin UK | Moved into 196 Boots stores after more than £19M of TikTok Shop UK sales in under a year ([Retail Times](https://www.retailtimes.co.uk/dr-melaxin-expands-into-196-boots-stores-following-19m-tiktok-shop-uk-success/)) | 2026 | [med] |
| Morning Consult, Gen Z brand trust 2026 | 94% of tracked brands score lower on net trust with Gen Z than with all adults. Brands that over-index with Gen Z include TikTok (+15.4), Crocs, CapCut, Fenty Beauty (+8.4) and Jarritos. YouTube is the most-trusted brand among Gen Z ([Morning Consult](https://morningconsult.com/articles/gen-z-brand-trust-2026)) | Jun 2026 | [high] |
| YPulse, "brands that get them" | The top brands are video platforms, McDonald's and Spotify. The reasons are a reflected worldview and prices that fit their budgets ([YPulse](https://www.ypulse.com/article/2026/04/29/the-top-10-brands-gen-z-say-gets-them/)) | Apr 29, 2026 | [med]: paywalled list |

### 1.2 Money follows the heat: 2025 deals as proof of brand pull

| Brand | Deal or scale | Source | Conf. |
|---|---|---|---|
| Rhode | Bought by e.l.f. for up to $1B ($800M at close plus up to $200M earnout), on $212M in net sales for the 12 months to Mar 31, 2025 | [e.l.f. release, May 28, 2025](https://investor.elfbeauty.com/stock-and-financial/press-releases/landing-news/2025/05-28-2025-210536607) | [high] |
| Poppi | Bought by PepsiCo for $1.95B ($1.65B net of tax benefits), closed May 2025 | [PepsiCo](https://www.pepsico.com/newsroom/press-releases/2025/pepsico-completes-acquisition-of-poppi-accelerating-strategic-portfolio-transformation) | [high] |
| Touchland | Bought by Church & Dwight for $700M plus up to $180M, on $130M in net sales; called the fastest-growing US hand-sanitizer brand | [Business Wire, May 12, 2025](https://www.businesswire.com/news/home/20250512684279/en) | [high] |
| Olipop | Valued at $1.85B in a $50M Series C; reported more than $400M in 2024 sales | [NBC News, Feb 2025](https://www.nbcnews.com/business/business-news/prebiotic-soda-brand-olipop-valued-1point85-billion-latest-funding-rcna191894) | [med] |
| Skims | Valued at $5B in a $225M raise on Nov 12, 2025; on track for more than $1B in sales; NikeSKIMS launched in 2025 | [Fortune](https://fortune.com/2025/11/12/kim-kardashian-skims-valuation-5-billion-fundraising-expansion-partnerships-worth/) | [high] |
| Stanley | About $750M in 2023 revenue, up from about $70M in 2019 | [CNBC, Dec 23, 2023](https://www.cnbc.com/2023/12/23/how-a-40-ounce-cup-turned-stanley-into-a-750-million-a-year-business.html) | [med] |
| Starface | About $90M a year in sales | [CNBC via NBC LA](https://www.nbclosangeles.com/news/business/money-report/how-starface-turned-pimple-patches-into-a-business-bringing-in-90-million-a-year/3584447/) | [med] |
| Liquid Death | Valued at $1.4B in 2024; sold about $3M of merch in 2021 | [Fortune, Mar 15, 2024](https://fortune.com/2024/03/15/liquid-death-ceo-mike-cessario-interview-beverage-unicorn-water-beer/); [Modern Retail, Jan 24, 2022](https://www.modernretail.co/startups/cult-following-how-liquid-death-sold-3m-worth-of-merch-last-year/) | [med] |

**Synthesis.** For 2026 the strongest Gen Z pull sits with e.l.f. (and now Rhode), Rare Beauty, Fenty (the trust leader), Medicube and the TikTok Shop natives (Dr. Melaxin, Based), Starface, Touchland, Owala/Stanley, Poppi/Olipop, Skims and Alo. Outside beauty, the reference sites remain Spotify Wrapped, Duolingo and Partiful (report 04 covers their numbers), with Liquid Death, A24, Nike, Apple and Red Bull as craft benchmarks. **[med]**

---

## 2. Method and capture log

**How we captured.** We used a Node Playwright 1.63 script with Chromium, a realistic user agent, US English and New York time. Each home page was shot at **390x844 (2x, touch)** and **1440x900**, about 6 seconds after the load event, with no clicks, so pop-ups appear as a first-time visitor would see them. For mobile we then scrolled the whole page and took a full-page capture capped at 14,000 px. A DOM scrape recorded fonts in use, colors by painted area, headings, nav and button labels, videos, dark-mode and reduced-motion CSS rules, and third-party hosts. We used Chrome DevTools Protocol counters to record bytes transferred by type, and PerformanceObserver to record LCP and CLS.

**Caveats.**
- LCP was measured from a data-center connection through a proxy, unthrottled, so real phones will be slower. Use it only to rank sites against each other. **[med]**
- Page weight is the total after a full scroll, including lazy images and video. It is a fair comparison of how heavy each page is. **[high]**
- Stylesheets served cross-origin cannot be read, so the dark-mode and reduced-motion counts are lower bounds. **[med]**
- Some sites blocked automated browsers. Where that happened, we say so and skip the teardown rather than guess.

**Files.** Screenshots are stored outside the repo in `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/bench/`:
- `brand-<slug>-mobile.png` and `brand-<slug>-desktop.png` for each site
- full-page mobile captures in `full/`
- contact sheets in `sheets/`
- raw numbers in `metrics.json`
- the capture script is `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/ysd/tools_bench/shoot.js`

### 2.1 Capture log

| Slug | URL | Result | Mobile weight (full scroll) | LCP, lab | Display type in use | Signature colors (observed) | First-visit interrupt |
|---|---|---|---|---|---|---|---|
| rarebeauty | rarebeauty.com | OK | 6.0 MB | 0.7 s | Ogg serif + Neue Haas Unica + "Rare Script" | cream #FDF6F0, plum #6F0936, cobalt #2852C3 | 10%-off email modal + cookies |
| rhode | rhodeskin.com | OK | 11.2 MB | 3.4 s | Swiss + Rektorat Heavy (lowercase) | greige #F1F0ED, taupe #67645E, black | cookie bar |
| fenty | fentybeauty.com | OK | 19.6 MB | 2.2 s | Brown | white, black, pink #FDCBD4 | large cookie panel |
| glossier | glossier.com | OK | 8.7 MB | 1.6 s | Apercu | #F7F7F7, blush #FBD1DA | merch promo modal |
| elf | elfcosmetics.com | OK | 6.4 MB | 2.3 s | Futura Now | white, black, violet #5D15D3 | 15%-off email modal |
| summerfridays | summerfridays.com | OK | 1.8 MB | 0.9 s | Futura PT + Pinyon Script | slate #5C7899, terracotta #C1947F, rose #B86373 | 15%-off yes/no modal |
| soldejaneiro | soldejaneiro.com | OK | 8.7 MB | 1.0 s | Knockout + Morning Memories Script | forest-black #212722, sun yellow #FFB600 | SMS 10%-off modal |
| starface | starface.world | OK | 5.9 MB | 0.9 s | ABC Diatype Rounded + GT Pressura Mono | black, #FDFF00, #F275D4, #00F900, #00A4EB | cookie bar |
| bubble | hellobubble.com | **Blocked** (Cloudflare 403) | n/a | n/a | n/a | n/a | bot check |
| topicals | mytopicals.com | OK | 6.2 MB (31.5 MB desktop) | 1.0 s | Chalet + ITC Garamond | white, near-black | "Match 3 cards" game modal |
| tower28 | tower28beauty.com | OK | 7.2 MB | 1.2 s | Cooper Lt + Scto Grotesk | flame #D74015, brick #872626, cream | cookie bar |
| merit | meritbeauty.com | OK | 5.6 MB | 5.4 s | Adobe Caslon + Akzidenz | black, bone #F9F8F5 | free-bag email modal |
| touchland | touchland.com | OK | 4.1 MB | 1.4 s | Moulin + Neue Haas | white, holiday red #B40104 | privacy modal |
| medicube | medicube.us | OK | 18.7 MB | 1.7 s | Inter + EB Garamond | white, black | cookie bar + chat bubble |
| poppi | drinkpoppi.com | OK | **38.2 MB** | 2.6 s | custom display + text | magenta #EC008C, cyan #00AEEF, yellow #FFF200 | email/SMS modal |
| olipop | drinkolipop.com | OK | 13.5 MB | 1.9 s | Windsor + Ano | cream #FFF6EA, green #008168, pink #FFB8B3 | cookie panel |
| owala | owalalife.com | OK | 3.8 MB | 1.5 s | Gilroy | white, denim #5E7A99, cobalt #293A8F | privacy panel |
| stanley | stanley1913.com | OK | 16.6 MB | 0.8 s | Stanley Favorit (custom) | white, #101010, ice #CFE6F4 | cookie panel |
| skims | skims.com | OK | 6.2 MB | 1.2 s | T-Star + Inter | white, espresso #2D2A26 | "Never miss a drop" modal |
| djerfavenue | djerfavenue.com | Partial (region selector only) | 1.2 MB | 3.0 s | Founders Grotesk | white, powder blue | cookie wall + region gate |
| alo | aloyoga.com | OK | 25.3 MB | 2.8 s | Proxima Nova | white, black, mauve #CAB7BF | rewards bar |
| gymshark | gymshark.com | OK | 17.2 MB | 3.3 s | Plaak + SN Skandia | grey #DEE0E3, black | cookie panel |
| liquiddeath | liquiddeath.com | OK | 8.9 MB | 2.1 s | Acumin Pro (condensed) | black, white, can colors | "Wanna cheat..." email modal |
| nike | nike.com | OK | 8.7 MB | **9.1 s** | Nike Futura + Helvetica Now | white, #111111 | "Only in the Nike App" banner |
| apple-iphone | apple.com/iphone | OK | 2.5 MB | 3.2 s | SF Pro | #F5F5F7, blue #0071E3 | none |
| spotify-wrapped | newsroom.spotify.com/2025-wrapped | OK | 19.8 MB | 1.8 s | Spotify Mix (Wide/Narrow) | lilac #9691FF, red #FF4834, mustard #DAB503 | none |
| a24 | a24films.com | OK | 6.8 MB | 1.0 s | Neue Montreal | white, #0E0E0D | cookie panel |
| jacquemus | jacquemus.com | **Blocked** (403 mobile; desktop showed a maintenance page) | n/a | n/a | n/a | n/a | n/a |
| partiful | partiful.com | OK | 4.8 MB | 0.8 s | "Partiful Janky Inter Display" + TWK Lausanne | #111111, #F7F7F7 (color comes from invites) | none |
| duolingo | duolingo.com | OK | 3.7 MB | 2.0 s | feather + duolingo-sans (custom) | green #58CC02, sky #1CB0F6 | none |
| redbull | redbull.com/us-en | OK | 4.3 MB | 1.5 s | Bull VF (custom variable) | navy #00162B, #F8F8F8 | terms/privacy modal |
| based | based.com (Based Bodyworks) | OK | 4.5 MB | 1.0 s | Based Display/Text | near-black #0A0A0A, gold #F2D49B | none detected |
| drmelaxin | shop.drmelaxinbeauty.com | **Failed** (404 at shop root) | n/a | n/a | n/a | n/a | n/a |

All rows are **[high]** as observations of one visit.

---

## 3. Cross-site patterns, by the numbers

Sample: the 29 reachable home pages (Bubble, Jacquemus, Dr. Melaxin and Djerf Avenue excluded).

1. **Pop-ups are the norm on store sites and absent on the most-loved product sites.** 9 of 23 store home pages opened an email or SMS capture modal within about seven seconds: Rare Beauty, e.l.f., Summer Fridays, Sol de Janeiro, Topicals, Merit, Poppi, Skims and Liquid Death. Most offered a discount. None of the six non-store benchmarks did: Apple, Spotify Wrapped, A24, Partiful, Duolingo and Red Bull. Nearly every site also showed a cookie banner. **[high, observed]** The lesson is that the sites people rave about lead with the thing itself. The best pop-ups were at least on-brand: a match-3 card game (Topicals), a drop-preference picker (Skims), a "HELL YES" button (Liquid Death) and an "i've been good" button (Poppi).
2. **The pages are heavy.** The median mobile home page weighed **6.8 MB** after a full scroll, with **2.8 MB of JavaScript**. Nine pages exceeded 10 MB: Poppi 38.2, Alo 25.3, Spotify Wrapped 19.8, Fenty 19.6, Medicube 18.7, Gymshark 17.2, Stanley 16.6, Olipop 13.5 and Rhode 11.2. The lightest were Summer Fridays (1.8), Apple (2.5), Duolingo (3.7), Owala (3.8), Touchland (4.1), Red Bull (4.3), Based (4.5) and Partiful (4.8). **[high]** Speed is not cosmetic: a Google-commissioned Deloitte study across 37 brands found that a 0.1 s mobile speed-up went with 8.4% more retail conversions. The finding is correlational ([web.dev](https://web.dev/case-studies/milliseconds-make-millions)). **[med]**
3. **Layout stability is often poor.** Six pages exceeded the 0.1 "good" CLS threshold during our scroll: Alo 1.37, e.l.f. 1.18, Skims 0.58, Medicube 0.46, Rhode 0.14 and Nike 0.13. Nike's lab LCP was 9.1 s, driven by a hero video. **[med]**: our scroll was scripted, so lazy-load shifts count.
4. **Tracker sprawl.** The median page loaded resources from **37 third-party hosts**, and several hit our cap of 60. Apple loaded **zero**. **[high]** For a political organization, a near-zero tracker count is both faster and a values statement.
5. **Dark mode is almost nowhere.** Only Partiful (1 of 29) shipped a `prefers-color-scheme` rule we could read. **[med]**: cross-origin sheets are unreadable. youngsemdem can stand out simply by designing a real dark theme.
6. **Reduced motion is half-handled.** 21 of 29 pages contained at least one `prefers-reduced-motion` rule, often from a library, while 13 auto-played video. **[med]**
7. **Video is standard.** 18 of 29 pages used video, and 13 auto-played it. Poppi and Gymshark put **9:16 vertical clips** straight onto the home page, and Topicals made "WATCH" a top-level nav item. **[high]**
8. **Finders and missions earn top-nav slots.** Rare Beauty's main nav is just SHOP / SHADE FINDER / RARE IMPACT. Tower 28 and Merit put "Find My Shade" in the nav. Medicube has "FIND YOUR ROUTINE" and "AMBASSADOR". Liquid Death lists "COUNTRY CLUB" and a toy page called "TIMEWASTER 5000". **[high]**
9. **Collabs are everywhere.** We saw Warby Parker x Rare Beauty, Fenty x CASETiFY, JELL-O x Tower 28, Hello Kitty x Starface, Hello Kitty/Kuromi/Crocs x Touchland, Harry Potter x Owala, NikeSKIMS (on both Skims and Nike), and Medicube's tie-in with a Hulu reality show. **[high]**
10. **Sold-out states become waitlists.** Rhode swaps "BUY" for "JOIN THE WAITLIST" in the product grid. Summer Fridays and Nike show "Notify Me". Skims opens with "Never miss a drop" and a preference picker. **[high]**
11. **Every leader has an ownable typeface.** Examples are Spotify Mix, Duolingo's "feather", Partiful's deliberately janky Inter, Stanley Favorit, Red Bull's "Bull VF" and Starface's rounded grotesk with a monospace. **[high]**
12. **Lowercase is the Gen Z register.** Rhode's product heads ("prep", "blush", "glaze"), all of Starface, Poppi's section heads and Duolingo's "free. fun. effective." are lowercase. **[high]**

---

## 4. Brand-by-brand teardown

Each entry gives what we observed, then the evidence of heat, then the lesson. All observations are from the Nov 8, 2026 capture **[high]**; evidence confidence is marked inline.

### Gen Z beauty

- **Rare Beauty.**
  - *Seen:* soft cream and plum palette with a serif display and one script word per heading ("This is *Your* Community", "Make an *impact*", "Shade *Finder*"). The main nav is SHOP / SHADE FINDER / RARE IMPACT. A four-step Foundation Shade Finder has a "MATCH ME" button and a Fair-to-Deep gradient strip. A UGC block invites people to tag a routine hashtag to be featured. A mental-health block says 1% of sales goes to the Rare Impact Fund. The footer links "Shade Match Live Chat", "Made Accessible" and "UGC Terms of Service". The site claims the Soft Pinch blush sells every four seconds worldwide (brand claim).
  - *Heat:* No. 2 teen cosmetics brand in fall 2025 (8%) **[med]**.
  - *Lesson:* make the finder and the mission equal to "Shop", and govern UGC with written terms.
- **Rhode.**
  - *Seen:* greige minimalism, a huge serif-free hero line ("Edited, efficacious, intentional."), and one-word lowercase product names in a heavy display ("prep", "tint", "glaze"). "JOIN THE WAITLIST" replaces "BUY" right in the product grid. Autoplaying product loops.
  - *Heat:* $212M in trailing sales and a $1B sale to e.l.f. **[high]**; Sephora debut in Sept 2025 ([Puck](https://puck.news/fashion/2025/9/rhodes-debut-blew-the-doors-off-sephora)) **[med]**. Waitlist sizes are widely repeated but conflict across sources **[low]**.
  - *Lesson:* restraint plus scarcity plus one-word naming. A sold-out state is an opt-in.
- **Fenty Beauty.**
  - *Seen:* an "Ask AI" chip in the main nav with suggested prompts (current deals, find my foundation). The page also loads a Google agentic-applications script, which suggests a Google-powered assistant **[med]**. Other buttons: "FIND YOUR SHADE", "LEAVE A SUGGESTION", "SHOP ON TIKTOK", "BUILD YOUR LIST". Slang product naming ("Lipz Like Riri", "Dealz", "Hunniez") and a CASETiFY collab.
  - *Heat:* the Gen Z trust over-indexer (+8.4) **[high]**. Its AI selfie shade finder recommends a foundation shade from a skin analysis ([Fenty](https://fentybeauty.com/en-bg/pages/you-did-that)) **[med]**.
  - *Lesson:* an AI helper works best as a chip with ready-made questions, next to a classic finder.
- **Glossier.**
  - *Seen:* pale grey and pink, Apercu throughout, and identity merch as content ("Hot Take Tumbler", "Deal With It Playing Cards", "Balm Dotcom Keychain"). The footer links Into The Gloss, Glossier Events and a Student Discount. The page loads Findation, a shade-matching tool.
  - *Heat:* a community-born brand; the often-quoted growth figures are untraceable (report 04) **[low-med]**.
  - *Lesson:* merch with in-jokes is a cheap form of identity.
- **e.l.f.**
  - *Seen:* emoji wayfinding in the nav ("🔥 What's Hot", "🎁 Gifts", "💄 Makeup"). A "NEW REWARDS JUST DROPPED!" block with "SIGN IN TO REDEEM". A "customize your kit" offer and a "What are you shopping for?" picker in the pop-up. Worst CLS in the sample (1.18).
  - *Heat:* No. 1 teen cosmetics brand two years running **[med]**. Loyalty members drive almost 80% of elfcosmetics.com sales ([Glossy](https://www.glossy.co/beauty/how-e-l-f-cosmetics-drove-a-125-increase-in-monthly-active-app-users)) **[med]**.
  - *Lesson:* loyalty is the engine; emoji makes a nav scannable.
- **Summer Fridays.**
  - *Seen:* the lightest page (1.8 MB). Muted slate, terracotta and rose palette. "Discover Our Community Favorites", "NOTIFY ME" on sold-out items, "JOIN THE SELF-CARE CLUB Rewards", and an "Eczema-Safe Essentials" category.
  - *Heat:* the Lip Butter Balm is a TikTok staple; we found no verified sales figures **[low]**.
  - *Lesson:* calm, fast and community-named.
- **Sol de Janeiro.**
  - *Seen:* condensed uppercase Knockout plus a script for "Limited Edition", a "NEW DROPS" rail, "BUILD YOUR ROUTINE", "SHOP BY SCENT", "SOL PASSPORT REWARDS" and a Portuguese "OLÁ" greeting. The pop-up is SMS-first.
  - *Heat:* its scent quiz is linked even from TikTok Shop listings ([scent directory](https://soldejaneiro.com/pages/scent-directory)) **[high]**. Gen Z collects its scents ([Glossy, 2023](https://www.glossy.co/pop/glossy-pop-newsletter-gen-z-wants-to-smell-like-dessert/)) **[med]**.
  - *Lesson:* routine builders plus a second-language greeting that feels like home.
- **Starface.**
  - *Seen:* the most saturated palette in the sample (black, #FDFF00, hot pink, #00F900, cyan) in big rounded tiles, a bento grid on desktop, and all-lowercase copy. A mystery-compact collab with Hello Kitty asks which limited-edition cutie you'll get. A mascot letter in monospace from "big yellow" opens with "omg hi :)". A Discord icon sits in the footer, plus an ELLE award badge and UGC faces wearing star patches.
  - *Heat:* about $90M a year **[med]**.
  - *Lesson:* a toy-box palette, a mascot voice and blind-box collecting.
- **Bubble.** Our capture was blocked by a Cloudflare bot check. *Evidence:* the brand was built with teen focus groups and co-creation ([Glossy](https://www.glossy.co/beauty/bubbles-shai-eisenman-on-creating-the-gen-z-beauty-brand-of-the-moment)) **[med]**. *Lesson:* co-create the agenda with members.
- **Topicals.**
  - *Seen:* "WATCH" in the top nav with Mux-streamed video, the line "Why so serious? Let's make flare-ups fun instead.", a "NEW DROP" bar, and a "Try your luck: match 3 cards" pop-up game. A 1% commitment appears on the site.
  - *Heat:* gives 1% of profits to mental-health organizations ([Daily Bruin, 2022](https://dailybruin.com/2022/11/14/qa-ucla-alumnuss-skin-care-company-focuses-on-wellness-mental-health-advocacy/)) **[med]**.
  - *Lesson:* video as a destination, and gamified reveals.
- **Tower 28.**
  - *Seen:* flame orange with a Cooper serif. "Find My Shade" in the nav, plus both "Take Shade Quiz" and "Send a Selfie" (human matching), a "Tower 28 IRL" section and a JELL-O collab.
  - *Heat:* the founder runs the Clean Beauty Summer School, a grant program for BIPOC founders ([Tower 28](https://www.tower28beauty.com/blogs/sensitive-content/clean-beauty-summer-school)) **[high]**.
  - *Lesson:* pair a quiz with a human, and back the brand with a real program.
- **Merit.** *Seen:* quiet luxury in Caslon and Akzidenz, "Find My Shade" in the nav, and a free-bag pop-up. The slowest lab LCP among the beauty sites (5.4 s). *Lesson:* restraint only works if it is fast.
- **Touchland.**
  - *Seen:* a stack of collabs (Hello Kitty, Kuromi, Crocs), sets with personality names ("THE MAIN CHARACTER SET"), and "Rewards" in a four-item nav.
  - *Heat:* a $700M+ acquisition and the fastest-growing brand in its category **[high]**.
  - *Lesson:* name bundles like identities.
- **Medicube.**
  - *Seen:* nav items "AGE-R", "AMBASSADOR", "FIND YOUR ROUTINE" and "Trending on Social"; skin-concern product lines color-coded ("Red Line" for acne-prone skin); a Hulu reality-show tie-in hero; subscribe-and-save.
  - *Heat:* No. 6 teen skincare brand, $62.8M of TikTok Shop sales in Q2 2026, and No. 1 beauty livestream seller **[med]**.
  - *Lesson:* ambassadors and livestreams, plus color-coded tracks.

### TikTok Shop breakouts (2026)

- **Based Bodyworks** (based.com).
  - *Seen:* dark-by-default near-black and gold, the line "Because confidence shouldn't come at the cost of your health.", "Get Your Routine", "Shop Safely" and guides.
  - *Heat:* No. 2 indie beauty brand on TikTok Shop ($50.6M) **[med]**.
  - *Lesson:* a dark theme reads as premium to young men.
- **Dr. Melaxin.** The shop root returned 404 to us. *Heat:* No. 1 indie TikTok Shop beauty brand ($142.2M) **[med]**. Its success is platform-native: video, livestream and deep discount days, not its website.

### TikTok-era lifestyle and drinks

- **Poppi.**
  - *Seen:* every flavor gets its own full-bleed color world, with a scrolling marquee ("pop, fizz, be merry ✦ 'tis the season"), a winking-smiley mascot, a 9:16 hero video, and a vertical founder clip in a phone frame ("message from our founder"). Lowercase heads ("variety is the spice of life", "let's be friends", "we're popping up near you"). "sip. play. win." invites fans to join challenges on TYB. The footer links "college" and "find poppi". The heaviest page in the sample (38 MB).
  - *Heat:* a $1.95B PepsiCo deal **[high]**.
  - *Lesson:* color worlds, founder video and challenges. Then cut the weight.
- **Olipop.** *Seen:* cream and green with a Windsor serif, "Our Yetis are back!" (seasonal mascots), "Find Your Flavor", "Shop by fiber line" and an "Earn Rewards" link. *Heat:* a $1.85B valuation **[med]**. *Lesson:* seasonal mascots and a flavor finder.
- **Owala.**
  - *Seen:* sub-nav chips "FreeSip® Family / Color Drop / Customize", the line "Hydration, Hogwarts-style.", brand-word puns ("Owalafy It", "Happy Owaladays", "Owala Crew"), a #Owala Instagram feed and "Join the Club". A light 3.8 MB page.
  - *Heat:* limited color drops often sell out within an hour, per a marketer quoted by [Fortune, Mar 15, 2025](https://fortune.com/2025/03/15/owala-water-bottle-gen-z-explosion/) **[low-med]**.
  - *Lesson:* a recurring, named drop format plus a configurator.
- **Stanley.**
  - *Seen:* the lines "The hunt is on" and "Who's on your list?", "Make it one of a kind" with "Customize Now" (personalization), and an SMS short code.
  - *Heat:* the Target-exclusive pink drop of January 2024 sold out within minutes, with scuffles reported ([NBC News](https://www.nbcnews.com/business/stanley-cup-hype-rcna132372)) **[med]**.
  - *Lesson:* personalization sells, and frenzy can turn ugly. Never manufacture it.
- **Skims.**
  - *Seen:* the pop-up "NEVER MISS A DROP" asks you to select your preferences. A "COMING SOON: THE NIKESKIMS WAFFLE RACER" teaser. Uppercase heavy T-Star type.
  - *Heat:* a $5B valuation **[high]**. The Fendi collab reportedly drew 300K waitlist sign-ups and $1M in its first minute ([Hypebeast](https://hypebeast.com/2021/11/kim-kardashian-skims-fendi-collaboration-made-one-million-usd-in-one-minute-report)) **[low-med]**. The page also loads Sierra, an AI customer-service agent **[med]**.
  - *Lesson:* a "coming soon" date plus opt-in by interest.
- **Djerf Avenue.**
  - *Seen:* only a cookie wall and a region selector reached our crawler, which is friction in itself.
  - *Evidence:* fans call themselves "Angels" and community input shapes the brand ([Vogue Scandinavia](https://www.voguescandinavia.com/articles/matilda-djerf-djerf-avenue-next-chapter); [Inside Retail, Oct 26, 2026](https://insideretail.com.au/business/we-are-building-this-brand-together-matilda-djerf-on-the-power-of-community-202610)) **[med]**. In Dec 2024 the founder apologized after a Swedish report on workplace treatment ([AP via ABC News](https://abcnews.go.com/Business/wireStory/fashion-influencer-matilda-djerf-apologizes-report-created-toxic-116920267)) **[high]**.
  - *Lesson:* a community name is powerful. A brand that rests on one personality carries founder risk, so youngsemdem should feature many members, not one face.
- **Alo.**
  - *Seen:* a "GET REWARDS WITH alo access" bar, "AS SEEN ON YOU" (UGC), "SHOP BY COLOR", "SHOP BY ACTIVITY", "NEW TO ALO?" and the worst CLS (1.37).
  - *Heat:* named by teen girls among popular athletic brands (fall 2026) **[med]**. Its Roblox "Sanctuary" passed 118M visits ([Glossy](https://www.glossy.co/fashion/fashion-briefing-how-alo-yoga-is-using-roblox-to-get-gen-z-to-its-stores)), and NFC stickers in stores unlock in-game items ([Retail Dive](https://www.retaildive.com/news/alo-yoga-roblox-sticker-rewards-wellness-campaign-digital-wearables/738629)) **[med]**.
  - *Lesson:* bridge IRL and digital with scannable stickers.
- **Gymshark.**
  - *Seen:* "How do you train?" tabs (Lifting, HIIT, Running, Pilates). The IRL teaser "We're Opening A Gym" names a date and place (Jan 2027, Wynwood Miami) and asks if you're coming. Lifting Club tees with city names. Guides, Refer a Friend, Student and Military discounts, a "Submit a Fake" counterfeit-report link, and 9:16 banner videos.
  - *Heat:* Gymshark66, a 66-day habit challenge that now runs in its app ([Gymshark](https://support.gymshark.com/en/articles/13224296-gymshark66)) **[high]**; hashtag-view claims of 193M+ are from a marketing blog ([Whito](https://whito.co.uk/stolen-with-pride/gymshark/)) **[low]**.
  - *Lesson:* self-sort by identity, and announce IRL dates as a question.

### The most electrifying brand sites

- **Liquid Death.**
  - *Seen:* pun-names everywhere ("Rest in Peach", "Mango Chainsaw", "Dead Billionaire"). The nav includes "COUNTRY CLUB" and "TIMEWASTER 5000" (a toy page). A "Death to Plastic Bottles" mission block, "KILLER MERCH" and a "Death Peddlers United / Sell Liquid Death" call to action. "FOR A GOOD TIME CALL" shows real follower counts (about 7.5M Instagram, 7.2M TikTok). The pop-up's button reads "HELL YES", and even the email consent line is joke-voiced.
  - *Heat:* its Country Club (sign over your "soul" for perks) had more than 200,000 members by 2022, per [Modern Retail](https://www.modernretail.co/startups/cult-following-how-liquid-death-sold-3m-worth-of-merch-last-year/) **[med]**.
  - *Lesson:* make the boring thing funny. Keep legal consent plain.
- **Nike.**
  - *Seen:* condensed uppercase heroes, "Join Us", "Notify Me", an "Only in the Nike App" banner and NikeSKIMS in the main nav. The slowest LCP in the sample (9.1 s).
  - *Lesson:* member-gated drops drive sign-ups. App-gating content would be friction for youngsemdem.
- **Apple (iPhone hub).**
  - *Seen:* a product-icon sub-nav, "Compare", "Guided Shopping", "Explore the lineup", zero third-party hosts, 2.5 MB, a 31,000 px page and 50 running animations.
  - *Technique:* Apple's product pages scrub image sequences on scroll ([CSS-Tricks](https://css-tricks.com/lets-make-one-of-those-fancy-scrolling-animations-used-on-apple-product-pages/)) **[high]**. Native CSS scroll-driven animation became Baseline in Oct 2026 once Firefox 159 shipped it ([web.dev, Oct 29, 2026](https://web.dev/blog/web-platform-10-2026)) **[high]**.
  - *Lesson:* compare tables, scroll storytelling, no trackers.
- **Spotify Wrapped (2025 hub).**
  - *Seen:* kinetic type art in a custom variable family (Mix Wide/Narrow), with sections "Find Your Wrapped Club", "Start Your Wrapped Party" and "2025 Wrapped Data Explained".
  - *Heat:* 200M engaged users in 24 hours ([MBW](https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase)) **[med]**. 2025 added Clubs, Wrapped Party and Listening Age ([Axios, Dec 3, 2025](https://www.axios.com/2025/12/03/spotify-wrapped-2025-new-features)) **[high]**. Spotify Engineering wrote that even a 0.1% failure rate would mean millions of broken stories ([Spotify Engineering, Mar 2026](https://engineering.atspotify.com/2026/3/inside-the-archive-2025-wrapped)) **[high]**.
  - *Lesson:* archetype clubs, group mode, and a page that explains how your data is used.
- **A24.**
  - *Seen:* editorial monochrome, a 111 px headline at -4 px tracking over a full-bleed still, a nav of FILM / TV / MUSIC / LIVE / NOTES / SHOP, plus Membership, App and Auctions. 936 DOM nodes.
  - *Evidence:* AAA24 membership includes a zine, a birthday gift, drops and discounts ([AAA24 FAQ](https://aaa24.a24films.com/page/all-access-faqs)) **[high]**.
  - *Lesson:* let the art carry the color; membership can be a zine.
- **Jacquemus.** Blocked for us (403, then a maintenance page). *Evidence:* its April 2023 CGI clip of giant Bambino bags driving through Paris drew about 840K Instagram likes ([Glossy](https://www.glossy.co/fashion/fashion-briefing-videos-of-things-that-never-happened-are-dominating-fashion-marketing/); [Hypebeast](https://hypebeast.com/2023/4/jacquemus-bambino-bag-cars-paris-watch-info)) **[med]**. *Lesson:* surreal "could this be real?" visuals travel. A civic group must label anything synthetic.
- **Partiful.**
  - *Seen:* black-and-white chrome where all the color comes from user invite art, a deliberately "janky" custom Inter, and a hero of group-chat bubbles ending in "party @ mine?". "ONE LINK. EVERYONE'S IN." "Create for free / Takes 30 seconds." Feature cards: Collect Info Upfront (Instagram, song requests, dietary needs), Build Hype Early (guest list, comments, photos), Text Blast Your Guests, and city discovery. A press-quote carousel and a Google Play badge.
  - *Heat:* Google Play Best App of 2024; Sensor Tower estimated about 500K MAU in Q1 2025, up 400% ([CNBC via NBC NY](https://www.nbcnewyork.com/news/business/money-report/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple/6231135/)) **[med]**.
  - *Lesson:* this is the event page to beat.
- **Duolingo.**
  - *Seen:* chunky 3D press buttons, a lowercase rounded custom face in brand green, illustrated characters, "backed by science" linking to research, "stay motivated" (streaks, reminders, mascot), and 30+ site languages in the footer. The DOM is heavy (28,849 nodes).
  - *Heat:* the Feb 2025 "dead Duo" stunt drew a company-reported 1.7B impressions in two weeks ([Fast Company](https://www.fastcompany.com/91313082/duolingo-dead-duo-owl-social-media-campaign); [NPR](https://npr.org/2025/02/26/nx-s1-5309785/duolingo-owl-mascot-lives)) **[med]**.
  - *Lesson:* tactile UI, a mascot, and claims that link to their evidence.
- **Red Bull.**
  - *Seen:* the home page is a media hub (Stories, Events, Athletes, Red Bull TV), with recap headlines such as "Red Bull Jukebox Nashville 2026: What went down", and a custom variable font. Light (4.3 MB).
  - *Lesson:* be a publisher of your own scene. Event recaps are content.

---

## 5. Technique catalog: 47 techniques with civic adaptations

Each row gives who does it (observed unless a source is given), why it works, and exactly how youngsemdem adapts it. "P0" marks the techniques we would build into the demo now.

### A. Color and type systems

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 1 | **Color worlds**: each product gets its own full-bleed color | Poppi (flavors), Starface (category tiles), Liquid Death (cans) | Instant recognition, scroll rhythm, and screenshots look like the brand | Give each **issue track and each city** a colorway from the Celery City Pop palette (report 03). Cards, event pages and stickers inherit it. **P0** |
| 2 | **Quiet chrome, loud content** | Partiful (monochrome UI, colorful invites), A24, Apple | User content and photos carry the color, and nothing clashes | Keep nav, forms and long reading on ink/paper. Spend the neon on heroes, cards, stickers and member posters. **P0** |
| 3 | **An ownable display face** | Spotify Mix, Duolingo feather, Partiful "Janky Inter", Stanley Favorit, Bull VF | Type is the cheapest asset a brand can own | Self-host League Gothic + Atkinson Hyperlegible Next (report 03). Draw one custom lettered wordmark. |
| 4 | **One script accent word** | Rare Beauty ("Your", "impact", "Finder"), Sol de Janeiro, Summer Fridays | Adds a human hand and emphasis | Yellowtail on one word per screen ("*vamos*", "*you*"). Never put essential information in the script. |
| 5 | **Lowercase register** | Rhode, Starface, Poppi, Duolingo | Reads like a text message, not a press release | Lowercase section heads and sticker text via CSS `text-transform`; write the source text in normal case. |
| 6 | **Giant editorial type over full-bleed images** | A24 (111 px), Nike, Spotify Wrapped | Poster energy, readable at a glance on a phone | Hero lines like "seminole's not done" at `clamp()` sizes over member photos (demo, credited). |

### B. Motion and micro-interactions

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 7 | **Kinetic wordmark or hero loop** | Spotify Wrapped 2025 header loops | Signals "alive" in the first second | An SVG/CSS animated wordmark under 50 KB that stops under `prefers-reduced-motion`. |
| 8 | **Marquee ticker** | Poppi | Cheap motion that also carries news | "next up: trivia night thu 7 pm ✦ registro en español ✦ new reel" with a pause control (WCAG 2.2.2). **P0** |
| 9 | **Tactile, chunky press buttons** | Duolingo (3D buttons that press down), e.l.f. emoji nav | Makes tapping feel like a game | A press state (translateY plus shadow collapse) on every primary button; 44 px minimum targets. **P0** |
| 10 | **Scroll-driven storytelling** | Apple product pages ([CSS-Tricks](https://css-tricks.com/lets-make-one-of-those-fancy-scrolling-animations-used-on-apple-product-pages/)) | Turns explanation into a reveal | "How your mail ballot travels" and "your first county commission meeting" as scrolly explainers using `animation-timeline: view()` inside `@supports`, now Baseline ([web.dev](https://web.dev/blog/web-platform-10-2026)). |
| 11 | **App-like page transitions** | Cross-document view transitions: Chrome 126+, Safari 18.2+, partial in Firefox ([Chrome docs](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document); [caniuse](https://caniuse.com/cross-document-view-transitions)) | A static multi-page site feels like an app | `@view-transition { navigation: auto; }` plus shared element names for the card that opens an event. Degrades to plain navigation. |
| 12 | **Reward burst on completion** | Duolingo celebrations, Topicals' match-3 reveal, Starface mystery reveal | Fires the dopamine at the moment of action | A sticker-slap animation and card reveal on RSVP, pledge or quiz finish (replaced by a static badge under reduced motion). **P0** |

### C. Storytelling and content

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 13 | **Mission in the top nav** | Rare Beauty (RARE IMPACT), Liquid Death (Death to Plastic), Topicals (1%) | Values become a destination, not a footer link | A **"Receipts"** tab: what the club actually did, dated and sourced, with real numbers only. In the demo, label every number as demo. **P0** |
| 14 | **Founder or leader vertical video** | Poppi's founder clip in a phone frame | A face and a voice build trust faster than text | A 30-second "hey, I'm the chair" clip, played by a demo person and labeled DEMO. Swap in a real member at launch. |
| 15 | **Brand as publisher** | Red Bull (Stories/Events/Athletes/TV), A24 (Notes), Spotify's Wrapped hub | Content gives people a reason to return without a sale | Information architecture of **Stories / Events / People / Reel / Receipts**. Event recaps are posts. |
| 16 | **Guides and compare tables** | Gymshark guides, Apple "Compare", Duolingo "backed by science" | Practical value gets forwarded (STEPPS, report 04) | "Compare ways to vote" (mail, early, Election Day) and "first county meeting" guides, each linked to the Supervisor of Elections or the county. |
| 17 | **Collab drops** | Warby Parker x Rare Beauty, Fenty x CASETiFY, JELL-O x Tower 28, Hello Kitty x Starface/Touchland, Harry Potter x Owala, NikeSKIMS | Borrowed audiences and novelty | **Local collabs**: a sticker series with a Seminole artist, a trivia night at a local coffee shop. In the demo, use clearly fictional partner names, no licensed IP, and no real businesses implied as endorsers. |
| 18 | **Pun-powered naming systems** | Liquid Death ("Rest in Peach"), Owala ("Owalafy It"), Fenty, Poppi bundles ("Crowd Pleasers") | Names are memes people repeat | Name recurring formats: "Ballot Brunch", "Precinct Pop-Up", "Commission Watch Party". Test them against report 05's voice rules and avoid borrowed dialect. |

### D. UGC, creators and community

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 19 | **Tag-to-be-featured loop** | Rare Beauty, Owala (#Owala feed), Alo ("As seen on you"), Starface UGC | Recognition is the reward, and every post advertises | A weekly prompt with a curated wall. Consent checkbox and written UGC terms, as Rare Beauty has. **P0** |
| 20 | **Challenges for points** | TYB challenges used by Rare Beauty, Glossier and Poppi ([Dash Social](https://dashhudson.com/blog/try-your-best-tyb)); Gymshark66 | Small, concrete asks build a habit | "Civic challenges" (attend a meeting, register a friend, post a take) earn badges and levels, never cash. |
| 21 | **Ambassador or rep program** | Liquid Death (Death Peddlers United), Medicube (Ambassador), Poppi (college link) | Turns fans into distribution | "Bring YSD to your campus or workplace": a captain sign-up with a starter kit (stickers, QR flyer, talking points). |
| 22 | **Members shape the product** | Bubble's teen co-creation, Fenty's "Leave a suggestion", Djerf's community input | Ownership drives loyalty | A "what should we fight for next?" box. Show tallies only above an honest threshold (report 04 #7). |
| 23 | **IRL-to-digital bridge** | Alo NFC stickers unlock Roblox items; Gymshark's dated gym opening; Poppi "popping up near you"; Tower 28 IRL | Physical moments feed online identity | A QR sticker at each event unlocks a badge on the member card (code word in the demo; server-checked code on the real domain), plus a "where we'll be this month" list. |
| 24 | **Community channel link** | Starface (Discord in footer) | Belonging lives in chats | Link to a moderated group chat with a code of conduct and named moderators (open question). |

### E. Video

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 25 | **9:16 video on the home page** | Poppi, Gymshark, Topicals ("WATCH" in nav) | Native to how Gen Z watches | A "Reel" band on the home page with poster-first lazy loading via `YSD.clips`/`YSD.feed`, captions on, and no sound by default. **P0** |
| 26 | **Actionable video** | Fenty and Tower 28 load Tolstoy shoppable video; Olipop loads Videowise | The video ends in a button | Every clip carries one action chip (RSVP, register, share), pre-filled. |
| 27 | **Live as a channel** | Medicube and Dr. Melaxin livestreams; Sephora's "Drop Shop" lives | Real-time events create urgency honestly | A monthly live Q&A treated as an event, with the replay cut into reel clips. |

### F. Quizzes and finders

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 28 | **Shade finder in a few steps** | Rare Beauty ("Match me", 4 steps), Tower 28 (quiz plus "Send a Selfie"), Merit, Fenty AI shade finder, Glossier (Findation) | Personalization in under a minute, and the result feels like *yours* | An **Issue Finder**: 4 taps → your issue colorway card plus 3 local actions this month. 9:16 and 4:5 cards via `YSD.cards`. **P0** |
| 29 | **Routine builder** | Sol de Janeiro "Build your routine", Medicube "Find your routine", Based "Get your routine" | Turns a product into a habit | "Your 15-minute civic week": pick slots and actions, get a calendar file via `YSD.cal`. |
| 30 | **Self-sort by identity** | Gymshark "How do you train?", Spotify Wrapped Clubs, Alo "shop by activity" | People choose a role they like being | "How do you show up?": talker, maker, planner, host, driver, online. Each role has its own page and starter tasks. **P0** |
| 31 | **AI assistant with suggested prompts** | Fenty "Ask AI" chip with prompts; Skims loads Sierra | Prompts remove blank-page anxiety | An **Ask Claude** chip with 3 suggested questions ("how do I vote by mail in Seminole?", "what does the county commission do?", "help me invite a friend"). Answers are labeled as AI, cite official sources, and offer a human. |

### G. Drops, countdowns and honest scarcity

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 32 | **A drop calendar** | Owala Color Drop, Sol de Janeiro "NEW DROPS", Skims "coming soon" | A known date is a reason to come back | A monthly **event drop** at a fixed time, with a "notify me" calendar file. Deadline drops only with dates verified from the Supervisor of Elections. **P0** |
| 33 | **Sold out becomes a waitlist** | Rhode inline "Join the waitlist", Summer Fridays and Nike "Notify me" | Converts disappointment into an opt-in | A full event offers "get a spot when one opens"; an English-only resource offers "notify me when the Spanish version is live". |
| 34 | **Mystery or blind-box collectibles** | Starface mystery compact, Topicals' card reveal | Surprise drives return visits and screenshots | A random sticker on your member card per action, all equally available. No paid odds, no rarity tiers that shame. |

### H. Loyalty, referral and membership

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 35 | **Points and tiers** | e.l.f. Beauty Squad (members drive about 80% of site sales, [Glossy](https://www.glossy.co/beauty/how-e-l-f-cosmetics-drove-a-125-increase-in-monthly-active-app-users)), Alo Access, Sol Passport, Summer Fridays Self-Care Club | Progress is visible, and status is social | **Organizer levels** for real actions with weekly streaks and a freeze. Level names are an open question (avoid "warrior/tribe"). Rewards are stickers, early RSVP and front-row seats at trivia night. **P0** |
| 36 | **Membership as a club with a zine** | A24 AAA24 (zine, birthday gift, drops); Liquid Death Country Club | Belonging plus perks, wrapped in a story | A free numbered founding-member card with a quarterly digital zine (event recaps, member spotlights with consent). |
| 37 | **Refer a friend** | Gymshark, Rhode, Medicube | Two-sided rewards spread through strong ties | The "bring three" ladder from report 04 #12, with non-cash rewards. |

### I. Copy voice and microcopy

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 38 | **Personality in tiny places** | Liquid Death "HELL YES", Poppi "i've been good", Partiful "Takes 30 seconds" and "Your social life will thank you" | Buttons and empty states are where voice is felt | Buttons like "i'm in" and "count me in", playful 404 and empty states, a friendly success message. **Keep consent and legal text plain**: Liquid Death's joke consent line is not for a political group. **P0** |
| 39 | **A mascot with a voice** | Starface "big yellow", Duolingo's Duo, Olipop Yetis, Poppi smiley | A character can say things a brand can't | Optional local mascot, for example a celery stalk nodding to Sanford's "Celery City" past (report 03 palette). Never Native imagery or any figure that echoes tribal identity. Open question. |
| 40 | **A second-language greeting on top of full parity** | Sol de Janeiro "OLÁ", Duolingo's 30+ site languages | Feels like home | Full Spanish parity (Seminole is 25.4% Hispanic, [Census Reporter](https://censusreporter.org/profiles/05000US12117-seminole-county-fl/)), plus warm bilingual flourishes, reviewed by native speakers. **P0** |

### J. Conversion and friction

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 41 | **No pop-up on first visit** | Apple, Spotify, Partiful, Duolingo, A24 (vs 9 of 23 stores that interrupt) | The product is the pitch | No modal in the first visit; an inline join card after the first scroll. A compact cookie notice only if real cookies are used. **P0** |
| 42 | **Preference picker at sign-up** | Skims ("select your preference"), e.l.f. ("What are you shopping for?") | Fewer, more relevant messages lower opt-outs | "What do you want from us?" checkboxes (events, volunteering, Spanish, LGBTQ+, campus) with up to 3 fields. |
| 43 | **Time-to-value microcopy and 3 steps** | Partiful ("Takes 30 seconds"; Create / RSVP / Stay on the same page) | Lowers the perceived cost | "Join in 20 seconds" and a 3-step "how YSD works" strip. |
| 44 | **Identity discounts as inclusion** | Gymshark Student and Military, Glossier and e.l.f. Student | Signals "this is for people like you" | "Everything is free, always", with accessibility, transit, childcare and Spanish availability listed on every event. |

### K. Page speed and trust

| # | Technique | Who | Why it works | youngsemdem adaptation |
|---|---|---|---|---|
| 45 | **A light page** | Summer Fridays 1.8 MB, Apple 2.5 MB, Duolingo 3.7 MB (vs Poppi 38 MB) | Speed goes with conversion ([web.dev](https://web.dev/case-studies/milliseconds-make-millions)) | Budget: home under 1.5 MB on first view, 150 KB of JS, LCP 2.5 s or less on throttled 4G, CLS 0.1 or less. **P0** |
| 46 | **A third-party diet** | Apple (0 hosts) vs a median of 37 | Privacy and speed in one move | No ad pixels. Self-host fonts in production. Use first-party `YSD.track` only. **P0** |
| 47 | **Real proof only** | Partiful's press carousel and store ratings, Starface's ELLE badge, Liquid Death's real follower counts | Third-party proof beats self-praise | Real press and real counts once they exist; in the demo, an obviously labeled placeholder. No fabricated quotes or endorsements. |

---

## 6. The 10 techniques with the highest payoff for a static site

These are ranked by expected engagement payoff divided by effort on a static, no-login demo that ports to a real domain. Each builds on modules already in the repo (`YSD.cards`, `YSD.share`, `YSD.cal`, `YSD.clips`/`YSD.feed`, `YSD.members`, `YSD.counters`; see `docs/infra/core.md` and `video.md`).

| Rank | Technique (catalog #) | Why it pays off | Effort | Primary metric |
|---|---|---|---|---|
| 1 | **Issue Finder + "How do you show up?" self-sort, each ending in a share card** (28, 30) | Finders top the nav at Rare Beauty, Tower 28 and Merit; Wrapped's Clubs and Gymshark's self-sort show that people share who they are. One quiz feeds sharing, roles and the action queue | M | Quiz completion; share rate per result; quiz starts from shared cards |
| 2 | **Event drops + Partiful-grade event pages** (32, 33, 43) | A known date brings people back; one-link RSVP with no account, who's going, collect-info-upfront fields (accessibility, Spanish, childcare) and a calendar file match the best event UX Gen Z uses | M | RSVPs per page view; calendar adds; waitlist joins |
| 3 | **A group-chat share layer on every page** (report 04 #1-2) | Each technique above only spreads if the link preview and pre-written text are good | S | Shares per visitor; arrivals per share |
| 4 | **Home-page vertical Reel with one action per clip** (25, 26) | Poppi, Gymshark and Topicals put 9:16 video up front; an action chip turns watching into doing | M | Play rate; clip-to-action tap rate |
| 5 | **Organizer levels with weekly challenges and streak freeze** (20, 35, 37) | e.l.f.'s members drive about 80% of its site sales; TYB-style challenges make the asks small; weekly cadence avoids BeReal-style burnout (report 04) | M | Weekly 1 and week 4 retention; challenges completed per member |
| 6 | **Community wall with a weekly prompt** (19, 22) | Recognition is the reward, and each post advertises; written UGC terms keep it safe | S-M (moderation is the cost) | Submissions; approval time; views of featured posts |
| 7 | **Ask Claude chip with suggested prompts and a human handoff** (31) | Fenty puts its AI in the main nav with ready-made questions; Tower 28 and Rare Beauty pair tools with humans. Kira asked for Claude, and suggested prompts make it usable | M-L (needs `functions/api` on the real domain; canned answers in the demo) | Questions asked; helpful votes; handoff to an action |
| 8 | **"Receipts" in the main nav** (13, 47) | Rare Beauty, Liquid Death and Topicals put the mission at nav level; Gen Z's low baseline trust (94% of brands) rewards proof | S | Receipts page views; scroll depth; donations or sign-ups from that page |
| 9 | **Collectibles: numbered member card, mystery stickers, local collab drops** (34, 36, 17) | Starface's blind box, Owala's color drops and A24's membership show that collecting keeps people coming back | S-M | Card creations and shares; sticker unlocks per member |
| 10 | **A tactile delight layer inside a hard performance budget** (8, 9, 11, 12, 45, 46) | Duolingo's press buttons, Poppi's ticker, view transitions and a completion burst make it feel premium; the budget keeps it faster than every brand here | S-M | Return-visit rate; LCP/CLS field data; zero third-party hosts |

**Build notes.**
- Ship 1, 2, 3, 8 and 10 first. They need no moderation or backend.
- Ship 4, 6 and 9 once a named moderator exists.
- Run 7 as canned demo answers until the API budget and governance questions are settled (report 04, open questions).
- Never present demo counters as real. `data/counters.js` already flags every baseline as demo.

---

## 7. The desirability bar: a checklist judges can score

Score each item **0** (absent), **1** (present but generic) or **2** (matches or beats the named benchmark). There are 30 items, for a maximum of **60 points**.

**Bands:** 48 or more is *desirable*; 36-47 is *solid*; under 36 is *not yet*.

**Hard gates:** items 2, 3, 5, 24, 25 and 28 must each score at least 1. A 0 on any of them fails the build regardless of total.

### A. First five seconds (on a 390 px phone)
1. The hero says who and what in 8 words or fewer, over bold type art or a real-feeling scene (benchmarks: A24, Nike, Partiful).
2. One primary action is visible without scrolling, and **no modal appears on first visit** (Apple, Spotify, Partiful, Duolingo).
3. The palette is unmistakable: at least 3 saturated brand colors as full-bleed blocks, and **every text pair is at least 4.5:1** (Starface, Poppi, with contrast fixed).
4. An expressive display face plus a highly legible body face, with at most one accent face (Spotify, Duolingo, Rare Beauty).
5. **Speed:** home under 1.5 MB on first view, LCP 2.5 s or less on throttled 4G, CLS 0.1 or less (Summer Fridays, Apple).

### B. Identity and play
6. A finder or quiz reachable from the top nav, 6 taps or fewer, ending in a share-ready 9:16 card (Rare Beauty, Tower 28).
7. A self-sort into roles or clubs that routes to tailored next steps (Gymshark, Spotify Wrapped Clubs).
8. A collectible: numbered member card, sticker, badge or mystery reveal (Starface, A24).
9. Levels or streaks for real actions on a weekly cadence, with a freeze and no shaming (Duolingo, e.l.f.).
10. One toy page that still teaches something true, such as county trivia or ballot bingo (Liquid Death's TIMEWASTER 5000).

### C. Social and sharing
11. Every page has a tested OG image, a Web Share button and pre-written English and Spanish text (Wrapped, Partiful).
12. Event pages: one link, no-account RSVP, opt-in "who's going", a calendar file, a +1 link and collect-info-upfront fields (Partiful).
13. A visible "next drop" with a date and time, and a notify-me option, **using verified dates only** (Owala, Skims).
14. A community wall with a weekly prompt, consent and written UGC terms (Rare Beauty, Owala).

### D. Video and creators
15. A vertical video band in the first two screens, poster-first, captioned and silent by default (Poppi, Gymshark).
16. Every clip ends in one action chip (Fenty and Tower 28's shoppable video).
17. A "post yours" path (link paste in the demo) with the moderation promise stated.

### E. Voice
18. Microcopy has personality on buttons, empty states, errors, the 404 page and success messages, while **consent and legal text stay plain** (Partiful, Poppi).
19. Spanish parity, not a token translation; bilingual flourishes sit on top of full translation (Sol de Janeiro, Duolingo).
20. The voice matches report 05: no slang cosplay, no guilt, no fake urgency.

### F. Motion and polish
21. Every primary action has a press state and a success moment, all honoring `prefers-reduced-motion` (Duolingo).
22. One signature motion moment (kinetic wordmark, ticker or scroll-driven reveal), added as an enhancement (Spotify, Apple).
23. A designed dark mode, not an inverted one (Partiful was the only benchmark that had any).

### G. Trust, inclusion and safety
24. **Honest proof only:** real or clearly labeled demo counts, no countdown timers that reset, no fake scarcity (Telfar's made-to-order model, report 04).
25. **Accessibility:** keyboard paths, visible focus, alt text, captions, 44 px targets, WCAG 2.2 AA, and motion controls ([W3C 2.3.3](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)).
26. Zero third-party trackers by default and a privacy note in plain words (Apple).
27. Ask Claude is labeled as AI, offers suggested prompts, cites official sources and offers a human (Fenty plus Tower 28).
28. **Brand safety:** no Native imagery or "warrior/tribe" language, no real politicians shown as endorsers, and every demo person and event labeled demo.

### H. Retention
29. A visible reason to come back next week on the home page: a prompt, a drop or a streak (Duolingo, Owala).
30. Low-friction sign-up of 3 fields or fewer with a preference picker; SMS optional (Skims).

---

## 8. What not to copy

- **Discount pop-ups in the first seconds** (9 of 23 stores). A civic group has no discount to offer, and the modal blocks the very first impression. **[high]**
- **Very heavy pages and layout jumps:** Poppi at 38 MB, Alo's and e.l.f.'s CLS above 1, Nike's 9 s LCP. **[high]**
- **Tracker sprawl** (a median of 37 hosts). It is wrong for a political organization handling voter-adjacent data. **[high]**
- **Gates before content:** Djerf Avenue's region selector and cookie wall, Nike's app-only content. **[high]**
- **Joke-voiced legal consent** (Liquid Death). It is funny for a water brand, but risky for a political club where consent must be unambiguous. **[high]**
- **Manufactured frenzy:** Stanley's Target drop ended in scuffles ([NBC News](https://www.nbcnews.com/business/stanley-cup-hype-rcna132372)). Use honest capacity limits and waitlists instead. **[med]**
- **One-face brands:** Djerf Avenue's founder controversy shows the risk of centering one person ([AP](https://abcnews.go.com/Business/wireStory/fashion-influencer-matilda-djerf-apologizes-report-created-toxic-116920267)). Feature many members. **[high]**
- **Borrowed IP and dialect:** Hello Kitty and Harry Potter collabs are licensed; Fenty's slang belongs to Fenty; brat green belongs to 2024 (report 04). Make local equivalents. **[high]**
- **Unlabeled synthetic visuals:** Jacquemus-style fake out-of-home works for fashion, but a civic group must label anything AI-made or CGI. **[high]**

---

## 9. Recommendations for youngsemdem

1. **Adopt the desirability bar (section 7) as the definition of done** and score every page before publishing. The hard gates (no first-visit modal, contrast, speed, honest proof, accessibility, brand safety) are non-negotiable.
2. **Lead with play, not a pitch.** Put the Issue Finder and "How do you show up?" in the main nav beside Events, Reel and Receipts, the way Rare Beauty sets SHOP / SHADE FINDER / RARE IMPACT side by side.
3. **Run the calendar like a brand drop.** Publish the monthly event lineup at a fixed time with notify-me calendar files and waitlists, using Partiful-grade event pages with accessibility, Spanish and childcare fields up front.
4. **Make video the second screen of the home page**: a 9:16 Reel with posters, captions and one action per clip, built on the existing `YSD.clips` and `YSD.feed`.
5. **Build organizer levels with weekly challenges and collectible stickers**, all tied to real actions, with a streak freeze and no cash or paid odds.
6. **Use quiet chrome and loud content**: ink and paper for UI and reading, and the Celery City Pop colors for heroes, cards, city and issue colorways, and stickers, checked at 4.5:1.
7. **Ship Claude as an "Ask Claude" chip with three suggested questions.** Label it, make it cite official sources, offer a human handoff, and use canned answers in the demo.
8. **Beat the brands on craft.** Home under 1.5 MB, zero third-party trackers, a designed dark mode, cross-document view transitions, scroll-driven explainers behind `@supports`, and reduced-motion fallbacks everywhere.
9. **Write the voice into the tiny places** (buttons, empty states, 404, success messages) and keep legal text plain. Draft every line in English and Spanish together.
10. **Keep everything honest and safe**: demo labels on people, events and counters; no fabricated quotes or partners; no Native imagery; no real politicians as endorsers.

---

## 10. Open questions

1. **Organizer level names and a mascot.** Does Kira want a local mascot (for example a Sanford "Celery City" celery character) and playful level names? Both need a quick check with members so they read as fun, not cringe, and stay clear of tribal associations.
2. **Moderation capacity.** Who approves wall posts and video submissions, and how fast? Without a named moderator, ship link-paste only (report 04).
3. **Real dates.** Which upcoming dates (municipal elections, registration deadlines, county meetings) can be verified with the Supervisor of Elections for the drop calendar? Until verified, the demo should use events only, labeled demo.
4. **Claude on the real domain.** Who pays for API usage, what rate limits apply, and who reviews flagged answers? This decides whether the Ask Claude chip is live or canned at launch.
5. **Merch and collabs.** Is there budget or a local artist for a real sticker series? Collab partners must be real and consenting before launch; the demo uses fictional names.
6. **Fall 2026 teen data.** The Piper Sandler fall 2026 figures here come from Retail Dive's summary; confirm against the full report before quoting them on the site.
7. **Blocked benchmarks.** Bubble, Jacquemus and Dr. Melaxin blocked or failed our crawler, and Djerf Avenue showed only a region gate. A manual phone check could fill these gaps if judges want them.
8. **Field speed data.** Our LCP numbers are lab-only. If a PageSpeed Insights or CrUX key becomes available, re-run with real-user data for the benchmark sites and for youngsemdem itself.

---

## 11. Sources

1. Retail Dive, "Teen spending grows..." (Piper Sandler fall 2026), Oct 21, 2026. https://retaildive.com/news/teen-spending-grows-trade-athletic-apparel-fashion-piper-sandler/833565
2. Piper Sandler, Taking Stock With Teens fall 2025 infographic (PDF), Oct 2025. https://www.pipersandler.com/sites/default/files/document/TS_Fall25_Infographic.pdf
3. Beauty Independent, "Indie Beauty Brands Surpassed $500M On TikTok Shop In The Past Year," Jul 27, 2026. https://www.beautyindependent.com/indie-beauty-brands-surpassed-500-million-on-tiktok-shop-in-the-past-year/
4. Tubefilter, TikTok Shop and Whatnot beauty sales, Jul 29, 2026. https://www.tubefilter.com/2026/07/29/tiktok-shop-whatnot-beauty-sales-indie-brands/amp/
5. Beauty Independent, "The 10 Beauty Sellers Dominating TikTok Shop Livestreaming," Sep 24, 2026. https://beautyindependent.com/10-beauty-sellers-dominating-tiktok-shop-livestreaming
6. Retail Times, Dr. Melaxin expands into 196 Boots stores, 2026. https://www.retailtimes.co.uk/dr-melaxin-expands-into-196-boots-stores-following-19m-tiktok-shop-uk-success/
7. Morning Consult, "Gen Z Brand Trust" 2026, Jun 2026. https://morningconsult.com/articles/gen-z-brand-trust-2026
8. YPulse, "The top 10 brands Gen Z say get them," Apr 29, 2026. https://www.ypulse.com/article/2026/04/29/the-top-10-brands-gen-z-say-gets-them/
9. e.l.f. Beauty, agreement to acquire rhode, May 28, 2025. https://investor.elfbeauty.com/stock-and-financial/press-releases/landing-news/2025/05-28-2025-210536607
10. Puck, "Rhode's debut blew the doors off Sephora," Sep 2025. https://puck.news/fashion/2025/9/rhodes-debut-blew-the-doors-off-sephora
11. PepsiCo, completes acquisition of poppi, May 2025. https://www.pepsico.com/newsroom/press-releases/2025/pepsico-completes-acquisition-of-poppi-accelerating-strategic-portfolio-transformation
12. Business Wire, Church & Dwight to acquire Touchland, May 12, 2025. https://www.businesswire.com/news/home/20250512684279/en
13. NBC News, Olipop valued at $1.85 billion, Feb 2025. https://www.nbcnews.com/business/business-news/prebiotic-soda-brand-olipop-valued-1point85-billion-latest-funding-rcna191894
14. Fortune, Skims valued at $5 billion, Nov 12, 2025. https://fortune.com/2025/11/12/kim-kardashian-skims-valuation-5-billion-fundraising-expansion-partnerships-worth/
15. CNBC, how a 40-ounce cup turned Stanley into a $750 million business, Dec 23, 2023. https://www.cnbc.com/2023/12/23/how-a-40-ounce-cup-turned-stanley-into-a-750-million-a-year-business.html
16. NBC News, Stanley cup hype, Jan 2024. https://www.nbcnews.com/business/stanley-cup-hype-rcna132372
17. Fortune, Owala water bottle Gen Z explosion, Mar 15, 2025. https://fortune.com/2025/03/15/owala-water-bottle-gen-z-explosion/
18. CNBC via NBC Los Angeles, how Starface built a $90 million a year business. https://www.nbclosangeles.com/news/business/money-report/how-starface-turned-pimple-patches-into-a-business-bringing-in-90-million-a-year/3584447/
19. Fortune, Liquid Death CEO interview ($1.4B valuation), Mar 15, 2024. https://fortune.com/2024/03/15/liquid-death-ceo-mike-cessario-interview-beverage-unicorn-water-beer/
20. Modern Retail, how Liquid Death sold $3M of merch, Jan 24, 2022. https://www.modernretail.co/startups/cult-following-how-liquid-death-sold-3m-worth-of-merch-last-year/
21. Glossy, how e.l.f. drove a 125% increase in app users (loyalty share of sales). https://www.glossy.co/beauty/how-e-l-f-cosmetics-drove-a-125-increase-in-monthly-active-app-users
22. Fenty Beauty, AI shade finder page. https://fentybeauty.com/en-bg/pages/you-did-that
23. Sol de Janeiro, scent directory and fragrance quiz. https://soldejaneiro.com/pages/scent-directory
24. Glossy, "Gen Z wants to smell like dessert" (Sol de Janeiro), Jan 2023. https://www.glossy.co/pop/glossy-pop-newsletter-gen-z-wants-to-smell-like-dessert/
25. Glossy, Bubble founder Shai Eisenman interview. https://www.glossy.co/beauty/bubbles-shai-eisenman-on-creating-the-gen-z-beauty-brand-of-the-moment
26. Daily Bruin, Topicals founder Q&A, Nov 14, 2022. https://dailybruin.com/2022/11/14/qa-ucla-alumnuss-skin-care-company-focuses-on-wellness-mental-health-advocacy/
27. Tower 28, "Introducing: Clean Beauty Summer School." https://www.tower28beauty.com/blogs/sensitive-content/clean-beauty-summer-school
28. Hypebeast, Skims x Fendi reportedly made $1M in one minute, Nov 2021. https://hypebeast.com/2021/11/kim-kardashian-skims-fendi-collaboration-made-one-million-usd-in-one-minute-report
29. Vogue Scandinavia, Matilda Djerf and Djerf Avenue's next chapter. https://www.voguescandinavia.com/articles/matilda-djerf-djerf-avenue-next-chapter
30. Inside Retail, "We are building this brand together," Oct 26, 2026. https://insideretail.com.au/business/we-are-building-this-brand-together-matilda-djerf-on-the-power-of-community-202610
31. AP via ABC News, Matilda Djerf apologizes after workplace report, Dec 2024. https://abcnews.go.com/Business/wireStory/fashion-influencer-matilda-djerf-apologizes-report-created-toxic-116920267
32. Glossy, how Alo Yoga is using Roblox to get Gen Z to its stores, Jan 2025. https://www.glossy.co/fashion/fashion-briefing-how-alo-yoga-is-using-roblox-to-get-gen-z-to-its-stores
33. Retail Dive, Alo Yoga Roblox sticker rewards. https://www.retaildive.com/news/alo-yoga-roblox-sticker-rewards-wellness-campaign-digital-wearables/738629
34. Gymshark support, "What is Gymshark66?" https://support.gymshark.com/en/articles/13224296-gymshark66
35. Whito, "Stolen with pride: Gymshark." https://whito.co.uk/stolen-with-pride/gymshark/
36. CSS-Tricks, Jurn van Wissen, "Let's Make One of Those Fancy Scrolling Animations Used on Apple Product Pages," May 2020. https://css-tricks.com/lets-make-one-of-those-fancy-scrolling-animations-used-on-apple-product-pages/
37. web.dev, "New to the web platform in October" (scroll-driven animations Baseline), Oct 29, 2026. https://web.dev/blog/web-platform-10-2026
38. Chrome for Developers, cross-document view transitions. https://developer.chrome.com/docs/web-platform/view-transitions/cross-document
39. Can I use, cross-document view transitions. https://caniuse.com/cross-document-view-transitions
40. Music Business Worldwide, Spotify Wrapped 200M engaged users in 24 hours, Dec 8, 2025. https://www.musicbusinessworldwide.com/spotify-wrapped-campaign-hit-200m-engaged-users-in-24-hours-a-19-yoy-increase
41. Axios, Spotify Wrapped 2025 new features, Dec 3, 2025. https://www.axios.com/2025/12/03/spotify-wrapped-2025-new-features
42. Spotify Engineering, "Inside the Archive: The Tech Behind Your 2025 Wrapped Highlights," Mar 2026. https://engineering.atspotify.com/2026/3/inside-the-archive-2025-wrapped
43. Spotify Newsroom, 2025 Wrapped hub (observed). https://newsroom.spotify.com/2025-wrapped/
44. A24, AAA24 All Access FAQs. https://aaa24.a24films.com/page/all-access-faqs
45. Glossy, "Videos of things that never happened are dominating fashion marketing" (Jacquemus). https://www.glossy.co/fashion/fashion-briefing-videos-of-things-that-never-happened-are-dominating-fashion-marketing/
46. Hypebeast, Jacquemus Bambino bag cars in Paris, Apr 2023. https://hypebeast.com/2023/4/jacquemus-bambino-bag-cars-paris-watch-info
47. CNBC via NBC New York, "Meet Partiful." https://www.nbcnewyork.com/news/business/money-report/meet-partiful-the-gen-z-party-planning-staple-thats-taking-on-apple/6231135/
48. Fast Company, Duolingo dead Duo campaign. https://www.fastcompany.com/91313082/duolingo-dead-duo-owl-social-media-campaign
49. NPR, "Duolingo's owl mascot is alive after all," Feb 26, 2025. https://npr.org/2025/02/26/nx-s1-5309785/duolingo-owl-mascot-lives
50. Dash Social, "Try Your Best (TYB), explained." https://dashhudson.com/blog/try-your-best-tyb
51. web.dev / Deloitte, "Milliseconds make millions." https://web.dev/case-studies/milliseconds-make-millions
52. W3C, Understanding WCAG 2.2 SC 2.3.3 Animation from Interactions. https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html
53. Census Reporter, Seminole County, FL profile. https://censusreporter.org/profiles/05000US12117-seminole-county-fl/
54. Live home pages observed Nov 8, 2026, 9:48-10:00 pm ET: rarebeauty.com, rhodeskin.com, fentybeauty.com, glossier.com, elfcosmetics.com, summerfridays.com, soldejaneiro.com, starface.world, mytopicals.com, tower28beauty.com, meritbeauty.com, touchland.com, medicube.us, drinkpoppi.com, drinkolipop.com, owalalife.com, stanley1913.com, skims.com, aloyoga.com, gymshark.com, liquiddeath.com, nike.com, apple.com/iphone, a24films.com, partiful.com, duolingo.com, redbull.com/us-en, based.com (screenshots and metrics in the scratchpad bench folder listed in section 2).
