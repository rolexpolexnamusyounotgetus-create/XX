# 03 · Left-leaning design systems that won young people, and what youngsemdem should take from them

*Research for the youngsemdem demo site (Young Seminole Democrats: Seminole County, FL Democrats aged 40 and under). Compiled Monday, November 9, 2026. Every claim links to a source in place and is tagged [high], [med] or [low] for confidence. Hex values marked **measured** come from each organization's live site CSS, pulled on Nov 9, 2026 with a script that reads stylesheets and counts colour and font declarations. They show what the site uses today, which is not always the official brand guide. Contrast ratios were computed with the WCAG 2.x relative-luminance formula.*

---

## Headline

The progressive brands that actually moved young voters share five habits. They look like their place rather than like the party: Mamdani borrowed bodega awnings and taxi yellow, AOC put Spanish on equal footing and chose purple. They are loud and type-first, built on condensed poster gothics and one or two saturated non-flag colours. They are easy to remix: Obama's mark came in 12 identity and 50 state variants, Working Families Party runs on Figma and Canva templates, and Mamdani allowed neighborhood variants. They lead with a concrete material promise (rent, prices, housing) and use tools and video to move people off the screen and onto doors: Mamdani's campaign reports 100,000+ volunteers and about 3 million doors, Die Linke reports 638,000 doors plus a rent-check app used 300,000+ times. And they treat reach as a means: KamalaHQ's roughly 1.5 billion views and the NDP's TikTok fame did not stop youth slippage or collapse. For youngsemdem, that means a poppy, Florida-native, bilingual identity that is neither GOP red nor DNC navy, built for stickers and stories. It should be structured as tokens and templates so members can remix it, and wired so every viral moment ends in a text-keyword sign-up, an RSVP or a shift. Three palettes are proposed below. The recommended lead is **"Celery City Pop"**: ultraviolet `#6A2BFF` plus celery-lime `#C8F03C` on deep-ink `#140B33`. Sanford's historic nickname, the Celery City, gives the lime a local reason to exist. Three Google Fonts pairings are proposed too, the lead being **League Gothic + Atkinson Hyperlegible Next**, with a hand-painted-sign script accent. All three palettes clear WCAG AA when the bright colours are used as fills under dark ink, not as text on white.

---

## Contents

1. [US case studies](#1-us-case-studies)
2. [International case studies](#2-international-case-studies)
3. [Side-by-side table](#3-side-by-side-table)
4. [The baseline to break from](#4-the-baseline-to-break-from-what-democrats-and-the-gop-look-like-today)
5. [Distillation: 14 transferable principles](#5-distillation-14-transferable-principles)
6. [Three candidate palettes (with WCAG)](#6-three-candidate-palettes)
7. [Three Google Fonts type pairings](#7-three-google-fonts-type-pairings)
8. [What to avoid](#8-what-to-avoid)
9. [Recommendations for the youngsemdem site](#9-recommendations-for-the-youngsemdem-site)
10. [Open questions](#10-open-questions)
11. [Sources](#11-sources)

---

## 1. US case studies

Each card covers who designed it, colour, type, image style, motion, tone, the signature digital mechanic, what measurably worked, and the lesson for youngsemdem.

### 1.1 Zohran Mamdani, NYC mayor, 2025 (the current benchmark)

- **Designers.** Forge, a two-person Philadelphia co-op: Aneesh Bhoopathy led brand and identity, Phil Ditzler built the original site ([Inquirer, Jun 25, 2025](https://www.inquirer.com/politics/nation/zohran-mamdani-brand-design-forge-philadelphia-20250625.html)) [high]. Matthew Hinders-Anderson drew a custom "Zohran" wordmark font, a layered colour font with shadow and serif styles. Kara McCurdy shot the photography ([PRINT, Daily Heller, May 6, 2026](https://www.printmag.com/daily-heller/the-daily-heller-typecasting-zohran-mondami/)) [high]. The current zohranfornyc.com footer reads "Made with Middle Seat" on Middle Seat's `ms-launchpad` WordPress theme (measured) [high]. The same vendor theme also runs floridadems.org and workingfamilies.org, a point that matters for youngsemdem in §4.
- **Colour.** Cobalt and marigold with red, chosen to echo taxi and MTA yellow and to twist Democratic blue ([Inquirer](https://www.inquirer.com/politics/nation/zohran-mamdani-brand-design-forge-philadelphia-20250625.html)) [high]. Yellow was picked partly because it carries little partisan baggage ([PRINT](https://www.printmag.com/daily-heller/the-daily-heller-typecasting-zohran-mondami/)) [high]. **Measured:** blue `#2619D1`, red `#E81900`, marigold `#FFAB00`, ink `#13110C`, off-white `#FCFBFA` [high that these are the site's dominant colours]. Marigold on cobalt measures 5.17:1, which passes AA.
- **Type.** Hand-lettered wordmark (built from Boheld) with Union Gothic in several widths and a Coffee Service script accent ([Fonts In Use](https://fontsinuse.com/uses/78381/zohran-for-new-york-city-campaign-graphics)) [high]. Current site CSS loads `Zohran`, `Union Gothic`, `coffee-service` and `ibm-plex-serif` (measured) [high].
- **Image style.** Drop shadows and a vintage, comic-book feel that evokes hand-painted shop signs. References include old Bollywood posters, bodegas, yellow cabs, hot dog and halal carts ([AP via Fortune, Nov 8, 2025](https://fortune.com/2025/11/08/zohran-mamdani-campaign-graphic-design-hot-dogs-bodegas-bollywood/)) [high]. Bhoopathy summed it up as "Succinctly, it's New York."
- **Tone.** Direct-to-camera, funny and specific. The January 2025 "halalflation" video turned $10 chicken-over-rice into an affordability argument ([New Republic](https://newrepublic.com/article/197359/zohran-mamdani-food-campaign-success)) [med].
- **Signature mechanics.** Multilingual short video: ranked-choice explainers in Hindi/Urdu using Bollywood references, plus Bengali, Spanish and Arabic content ([Al Jazeera, Jul 17, 2025](https://www.aljazeera.com/economy/2025/7/17/how-zohran-mamdani-reached-a-multilingual-multicultural-new-york)) [med]. Neighborhood variants of the design were allowed as long as they kept the palette. Volunteer materials came in eight languages, and merch could be earned by canvassing ([Inquirer](https://www.inquirer.com/politics/nation/zohran-mamdani-brand-design-forge-philadelphia-20250625.html)) [high]. Unofficial fan merch ("Hot Girls for Zohran") spread the look further. A marketing professor credited the playful design with creating something supporters "wanted to wear and share" ([AP via Fortune](https://fortune.com/2025/11/08/zohran-mamdani-campaign-graphic-design-hot-dogs-bodegas-bollywood/)) [high].
- **What measurably worked.** CIRCLE estimates youth (18-29) turnout of 28% in the general, with about 75% backing Mamdani. For scale, roughly 8% of 18-34s voted in the 2013 mayoral race ([CIRCLE, Nov 5, 2025, revised Nov 12](https://circle.tufts.edu/latest-research/young-voters-power-mamdani-victory-shape-key-2025-elections)) [high]. The campaign reports 104,400 volunteers and about 3 million doors ([Nation of Change, Nov 5, 2025](https://www.nationofchange.org/2025/11/05/zohran-mamdanis-movement-victory-reshapes-new-york-politics)) [med, campaign-reported]. National DSA membership went from about 50,700 (Oct 2024) to about 92,900 (Dec 2025) ([City & State, Jan 2026](https://www.cityandstateny.com/politics/2026/01/dsas-membership-nearly-doubled-start-mamdani-campaign/410966/)) [med, DSA-reported].
- **Lesson.** Design from the local street, not from the party kit. Let members remix it. Put the funniest, most specific cost-of-living video at the center.

### 1.2 Alexandria Ocasio-Cortez, NY-14, 2018 (Tandem NYC)

- **Designers.** Tandem NYC (Scott Starrett, Shaun Gillen) with 24-year-old designer Maria Arenas ([Typeroom, Nov 14, 2018](https://www.typeroom.eu/alexandria-ocasio-cortez-x-tandem-when-radical-politics-meet-radical-design-victory-ensues)) [high].
- **Colour.** Deep purple `#3C2D82`, mustard `#EDC93F`, Democrat-blue accent `#0842A3`. The purple was the candidate's request, a blend of red and blue ([F Newsmagazine, Jul 20, 2018](https://fnewsmagazine.com/?p=72721)) [high]. Mustard on purple measures 6.89:1.
- **Type.** Norwester (logotype), Metropolis (supporting), Roboto Slab (deliverables). All are open-licensed, and the article frames that choice as a values statement ([F Newsmagazine](https://fnewsmagazine.com/?p=72721)) [high]. Typeroom confirms Norwester and Metropolis [high]. Adobe's claim that the campaign used Gotham conflicts with this and is rejected here.
- **Image style.** Upward-slanted name lettering. References include the Cesar Chavez and Dolores Huerta United Farm Workers posters, union badges and Rosie the Riveter, with a heroic portrait staged like a film poster ([Typeroom](https://www.typeroom.eu/alexandria-ocasio-cortez-x-tandem-when-radical-politics-meet-radical-design-victory-ensues)) [high].
- **Bilingual by design.** The name uses an opening exclamation mark (a Spanish convention) with stars, and the site and collateral are bilingual ([F Newsmagazine](https://fnewsmagazine.com/?p=72721)) [high].
- **Mechanic.** A low-budget documentary-style launch video, "The Courage to Change," made by Means of Production, a two-person Detroit studio of DSA activists. Reported reach runs from about 1 million YouTube views to about 3 million across platforms, depending on source and date ([Filmmaker Magazine](https://filmmakermagazine.com/?p=105857); [Novara Media, Mar 4, 2020](https://novaramedia.com/2020/03/04/revolution-and-chill-the-anticapitalist-streaming-service-thats-netflix-for-the-99/)) [med on existence and impact, low on the exact count].
- **Lesson.** Purple and yellow showed that a Democrat can leave red-white-blue and gain energy. Bilingual should be designed in from day one, not translated afterward.

### 1.3 Bernie Sanders, 2016 and 2020

- **Designers.** Wide Eye (Ben Ostrower) made the logo in under a week in late 2014. It first appeared around March 2015 ([AIGA Eye on Design, Mar 23, 2020](https://eyeondesign.aiga.org/how-bernie-sanders-built-a-new-language-for-democratic-socialism/)) [high].
- **Colour.** Patriotic red, white and blue, with the star deliberately not set in red to avoid socialist symbolism ([AIGA](https://eyeondesign.aiga.org/how-bernie-sanders-built-a-new-language-for-democratic-socialism/)) [high]. **Measured today:** blue `#0070CC`, dark blue `#00324D`, red `#F51E47` [high for the current site].
- **Type.** Jubilat slab serif, which Ostrower called "incredibly friendly," paired with Gibson. Today's site also loads FatFrank and Marydale (measured) [high].
- **Tone.** Friendly Americana. The wave lines suggest a movement, and the brand avoided the usual socialist tropes of fists, chains and sharp angles ([AIGA](https://eyeondesign.aiga.org/how-bernie-sanders-built-a-new-language-for-democratic-socialism/)) [high].
- **Mechanic.** Today: "Not me. Us." plus SMS opt-in (text to 67760) and tour-event finders (measured) [high].
- **Worked.** Exit polls put Sanders at about 71% of under-30 primary voters in 2016. CIRCLE counted 2 million+ under-30 votes across 21 primaries ([PBS NewsHour](https://www.pbs.org/newshour/amp/politics/sanders-banked-on-young-voters-heres-how-the-numbers-have-played-out)) [med].
- **Lesson.** A radical platform can wear a warm, approachable face. Consistency over years builds recognition.

### 1.4 Harris 2024: KamalaHQ and the "brat" moment

- **Design.** The Harris/Walz identity came from Wide Eye Creative. It is set in Sans Plomb (a condensed gothic from Lift Type) with Balto, and Decimal on the store ([Fonts In Use](https://www.fontsinuse.com/uses/63052/harris-walz-2024-us-presidential-campaign)) [high; sources disagree on the exact cut].
- **The brat moment.** After Charli XCX posted "kamala IS brat," @KamalaHQ copied the album look: all-lowercase low-res type on lime green ([Daily Dot](https://dailydot.com/debug/kamala-harris-charli-xcx-brat-green/)) [high]. Brat green is widely cited as `#8ACE00` ([The Nightly/NYT](https://thenightly.com.au/politics/brat-green-aka-hex-8ace00-you-cant-escape-this-colour-thanks-to-charlie-xcx-c-15494520)) [med]. Some Charli fans objected ([Al Jazeera, Jul 23, 2024](https://www.aljazeera.com/amp/news/2024/7/23/kamala-is-brat-the-viral-pop-meme-driving-the-harris-election-campaign)) [high].
- **Mechanic.** A dozen mostly under-30 staffers worked under clear rules, with a five-minute objection window and only "existential" problems escalated. Flaherty said the error rate was no worse than under heavy review. He defined authenticity as something the candidate would plausibly do ([Rachel Karten interview with Rob Flaherty, Apr 30, 2025](https://www.linkinbio.news/p/what-did-we-learn-from-kamala-hq)) [high]. The account reportedly had about 5M followers and about 1.5B views versus Trump's 12M and 1B ([NZ Herald](https://nzherald.co.nz/business/could-feral-25-year-olds-win-the-us-election-for-kamala-harris/LZIRZNZ3XRCCHHZSBTWNBK5MDE)) [med].
- **What happened with youth.** CIRCLE's final estimates: youth turnout 47%, Harris +4 to +6 among 18-29s. Young women went Harris 58-41 and young men Trump 56-42. The economy was the top youth issue at 40% ([CIRCLE](https://circle.tufts.edu/2024-election)) [high]. Flaherty's own read: owned social mostly reached engaged voters, and the campaign was a "last-mile" marketer that could not shift culture on its own ([Karten](https://www.linkinbio.news/p/what-did-we-learn-from-kamala-hq)) [high].
- **Lesson.** Speed under guardrails is a real advantage. Borrowed pop-culture equity peaks fast and does not replace a material promise or year-round cultural work. Do not copy brat green.

### 1.5 Obama 2008 (the classic lesson)

- **Design.** Sender LLC (Sol Sender, Amanda Gentry, Andy Keene) built the "O" as a rising sun, a new day. Campaign designers John Slabyk and Scott Thomas then made versions for **12 identity groups and all 50 states**, including a rainbow-stripe LGBT version ([Wikipedia: Obama logo](https://en.wikipedia.org/wiki/Obama_logo)) [high]. Shepard Fairey's self-initiated "Hope" stencil (red, beige, blues) was adopted by the campaign and matched the logo palette ([Art Institute of Chicago](https://www.artic.edu/artworks/229396/barack-obama-hope-poster)) [high].
- **Mechanic.** My.BarackObama.com let supporters form local groups, create events and run personal fundraising pages, which seeded field work before staff arrived ([Mother Jones, Jan 2009](https://www.motherjones.com/politics/2009/01/i-obot/)) [med].
- **Worked.** Obama won 66% of under-30s, the widest age gap since exit polls began in 1972. 25% of young voters were contacted by the campaign versus 13% for McCain, and 28% of battleground youth attended an event ([Pew, Nov 13, 2008](https://www.pewresearch.org/politics/2008/11/13/young-voters-in-the-2008-election/)) [high].
- **Lesson.** One master mark with many community variants. A self-serve organizing hub turns fans into hosts.

### 1.6 Sunrise Movement

- **Measured.** Yellow `#FFD800` (primary), near-black green `#061A0B`, cream `#FDF5E1`, purple `#871B78`, orange `#E13F01`, pale green `#D6E7D5`. Type: Konsole Expanded/Compact (display) with Source Sans Pro [high for the current site]. Dark ink on yellow measures 12.99:1.
- **Art.** Tandem made commissioned Green New Deal posters (a 2020 Poster House record lists Tandem, Starrett, Arenas) ([Poster House](https://collection-open.posterhouse.org/?p=17575)) [med]. Independent artists sell posters that fund Sunrise.
- **Mechanics (measured).** "Text GND to 88504" SMS keyword, EveryAction forms, ActBlue, toolkits and campaign pages [high].
- **Lesson.** One unmistakable hero colour (yellow) plus dark ink. A text keyword as the primary call to action.

### 1.7 Working Families Party (WFP)

- **Measured.** Purple `#481F82`, coral-red `#F3563C`, acid lime `#EAF96E`, with `pf_venue_condensed` display type, Helvetica Neue and Inter [high for the current site]. Lime on purple measures 10.19:1.
- **Brand.** The 2020 rebrand leans on a bold, energetic typographic style ([WFP on Medium, Oct 5, 2020](https://medium.com/@WorkingFamilies/a-brand-to-meet-this-moment-ff305380a6aa)) [med]. Creative director Laura Beth Pelner runs a **Figma and Canva template system** so staff can produce on-brand social, video and canvass materials themselves, "democratizing design" to solve a capacity problem ([Campaigns & Elections, Aug 15, 2022](https://campaignsandelections.com/creative/how-one-designer-has-adopted-a-template-model-to-unleash-her-partys-creativity)) [high].
- **Mechanics (measured).** "Text WFP to 30403," Mobilize event embeds, ActBlue, AOS scroll animations and carousels [high].
- **Lesson.** Templates scale a small team. A volunteer org like youngsemdem needs this more than a big party does.

### 1.8 Democratic Socialists of America (DSA)

- **Mark.** A red rose (with fist), descended from DSOC and the Socialist International emblem ([Wikiwand: DSA](https://wikiwand.com/en/articles/Democratic_Socialists_of_America)) [med]. The dsausa.org site blocked automated reads, so colours are **not measured**.
- **Worked.** Membership nearly doubled during the Mamdani run ([City & State](https://www.cityandstateny.com/politics/2026/01/dsas-membership-nearly-doubled-start-mamdani-campaign/410966/)) [med].
- **Lesson.** A simple emblem that members can draw by hand travels. The real engine is the chapter structure, not the logo.

### 1.9 Gen-Z for Change

- **Measured.** Forma DJR Display (Adobe Fonts), Lexend, Antipol; ink `#231F20`, cream `#F8F7F3`, red `#EF4347`, blue `#4065AF`, plus orange, gold and green accents [high]. It uses a collaborator-logo marquee that pauses on hover (measured).
- **Mechanics.** It describes itself as "social media, advocacy, and code": a coalition of hundreds of creators claiming 500M+ combined followers, plus digital advocacy tools. Its bilingual FIGHT (PODER) immigrant-rights toolkit reports 44 videos, 3M+ views and 44,000+ emails sent (site, measured Nov 9, 2026) [med, self-reported]. The White House briefed Gen-Z for Change creators on Ukraine in 2022 ([Tubefilter, Mar 11, 2022](https://tubefilter.com/2022/03/11/white-house-briefs-tiktok-stars-kahlil-greene-ukraine/)) [high].
- **Lesson.** Run a creator network and build small, single-purpose tools (send an email, find a rally). Do not just publish pages.

### 1.10 Voters of Tomorrow (VoT)

- **Measured.** Navy `#072243`, sky `#0DA2E6`, red-pink `#F9495F`, green `#04B35D`, lilac `#B080C3`, midnight `#000F1D`. "Now" display face with Poppins [high].
- **Mechanics.** Chapters (claims 25 states), a "Gen Z Agenda," SMS opt-in, Mobilize, Action Network and ActBlue. It claims 11,000+ members and 32 million voter contacts in 2024 (site, Nov 9, 2026) [med, self-reported].
- **Lesson.** Chapter-in-a-box onboarding and a published youth agenda give people a reason to join beyond vibes.

### 1.11 Run for Something (RFS)

- **Design.** Champions Design (Jennifer Kinon) built a 2017 identity toolkit "primarily in the digital realm," with protest-inspired type ([Champions Design](https://www.championsdesign.com/new/work/run-for-something)) [high]. **Measured:** BerninaSans Compressed with PT Serif [high].
- **Worked (self-reported).** It says it has helped elect 1,600+ young leaders and has a pipeline of 250,000+ potential candidates ([runforsomething.net](https://runforsomething.net/), Nov 9, 2026) [med].
- **Lesson for a 40-and-under club.** A "Run for local office" path (school board, soil and water, city commission) is a high-value page.

### 1.12 March for Our Lives (MFOL)

- **Measured.** Area Normal (Blaze Type, via Adobe Fonts), Matter Mono, Trim Poster; blue `#3384FF`, orange `#FF6914`, yellow `#FFCD1E`, lime `#BDFF32` on black and white. Its homepage has a scrolling "End Gun Violence •" marquee [high].
- **Origin.** The 2018 logo came from Den of Thieves, and ThoughtMatter made march posters ([Poster House](https://posterhouse.org/blog/hot-poster-gossip-thoughtmatter-edition/)) [med].
- **Mechanics (measured).** Action hub, membership, merch, voter resources and a 2026-2030 strategic plan [high].
- **Lesson.** A youth-led org can look like a streetwear brand and still be serious. Monospace "data" type works for receipts and accountability content.

---

## 2. International case studies

### 2.1 UK Labour, 2024

- **System.** Poppins, introduced at Conference 2023 and chosen as tested to read as honest and clear. Labour Red `#E4003B`, off-black `#121212`, and a "missions" secondary palette: Growth Pink `#E5007D`, Green Energy `#3AAA35` (the PDF prints "#3aa35"; RGB 58/170/53 gives #3AAA35), NHS Blue `#1D71B8`, Policing Yellow `#F39407`, Opportunity Purple `#662381`. The rule is not to combine too many colours at once ([Labour Brand Guidelines, PDF, uploaded Feb 2026](https://labour.org.uk/wp-content/uploads/2026/02/3502_25-Labour-Brand-Guidelines-3-updated.pdf)) [high].
- **TikTok.** Short meme-format clips were widely covered as the UK's first "TikTok election" ([UCM peer-reviewed study](https://revistas.ucm.es/index.php/ESMP/en/article/view/107103)) [med]. Critics called the memes fake to young eyes ([Novara Media, Jul 1, 2024](https://novaramedia.com/2024/07/01/we-can-spot-fakery-a-mile-off-labours-memes-are-an-insult-to-young-voters/)) [med].
- **Youth result.** Among 18-24s, young women voted Green at nearly twice the rate of young men, 23% vs 12% ([YouGov, Jul 8, 2024](https://yougov.com/en-gb/articles/49978-how-britain-voted-in-the-2024-general-election)) [high].
- **Lesson.** A tidy system with coloured "mission" sub-brands is useful (youngsemdem can colour-code issues). Meme-jacking without substance reads as an uncle using new slang.

### 2.2 Momentum (UK), 2017

- **Measured.** Neue Haas Grotesk Display; red `#E20613`, hot pink `#FF0F80`; NationBuilder [high].
- **Mechanic.** Shareable comedic videos built and tested by a volunteer social team. In the campaign's last week only about 5.3% of Momentum video viewers already "liked" Corbyn's page, so the videos reached beyond the bubble ([OpenLearn](https://www.open.edu/openlearn/society-politics-law/politics/how-did-facebook-likes-help-labour-the-ballot-box)) [med]. One video passed 7.6M views ([IBTimes UK](https://www.ibtimes.co.uk/jeremy-corbyns-viral-revolution-momentums-savvy-social-media-strategy-hailed-1625760)) [med, self-reported reach].
- **Lesson.** Comedy built for sharing reaches people who do not follow you, which is the whole point.

### 2.3 Australian Greens, 2022

- **Measured.** Anton (display), Roboto Condensed, Nunito Sans. Greens `#008C44`, `#005F27`, `#00A651`; accents orange `#E67509`, magenta `#B12F7D`, purple `#662D91` [high].
- **Mechanics.** An improvisational meme culture: a "Greems" Facebook group linked from the party site, and Young Greens brainstorming TikToks on Discord ([Crikey, May 10, 2022](https://www.crikey.com.au/2022/05/10/australian-greens-social-media-federal-election/)) [med]. Housing-first door-knocking in Brisbane ([Green Left](https://greenleft.org.au/node/72323)) [med].
- **Worked.** 36.0% of Australians under 35 voted Greens versus 18.1% Coalition ([ANU, Biddle & McAllister, Jun 20, 2022](https://polis.cass.anu.edu.au/files/docs/2025/6/Explaining_the_2022_election_result.pdf)) [high].
- **Lesson.** Give your most online members a sanctioned sandbox (Discord or a group chat) and point the energy at one material issue: rent and housing.

### 2.4 Australian Labor, 2025

- **Measured.** Untitled Sans, Helvetica Neue Extended Black Condensed and Gotham; reds `#E53641` and `#C31F2F` [high].
- **Mechanic.** The "influencer election": youth podcasts and creator access. One analysis credits Albanese's official TikTok with about 5M views, roughly 4x Dutton's and 5x Bandt's ([Mediaweek/Fabulate](https://www.mediaweek.com.au/fabulate-anthony-albaneses-land-with-younger-voters-as-dutton); [AdNews](https://www.adnews.com.au/news/albanese-leads-tiktok-engagement-in-influencer-election)) [med; vendor methodology].
- **Lesson.** Go on other people's channels (local creators and podcasts), not just your own.

### 2.5 New Zealand Labour, 2017 ("Let's do this")

- **Design.** The slogan swapped the bland "A fresh approach" for "Let's do this." New billboards on white rather than red read as fresher and more modern ([Newshub, Aug 2017](https://www.newshub.co.nz/home/election/2017/08/jacinda-ardern-reveals-labour-s-new-campaign-slogan-let-s-do-this.html)) [high]. Augusto made the first ad in about two weeks ([Augusto](https://www.augusto.co.nz/work/labour-2017-election-campaign)) [high].
- **Youth.** Enrolled 18-24 turnout rose from 62.7% to 69.3% ([Electoral Commission](https://elections.nz/media-and-news/2017/election-turnout-up-for-all-age-groups)) [high]. Population-based analyses say the real rise was negligible ([Democracy Project](https://democracyproject.nz/2017/11/03/bryce-edwards-youthquake-fails-to-shake-nz/)) [med].
- **Lesson.** A short, optimistic imperative ("Let's do this") travels. Do not over-claim a "youthquake," because the denominator matters.

### 2.6 Canada's NDP (cautionary)

- **Measured.** Orange `#F58220`, lavender accent `#E0CCFA`; Roboto, Montserrat, Bebas Neue, Source Serif Pro (a Bootstrap base) [high].
- **TikTok.** Jagmeet Singh's 15-second videos drew millions of views in 2021 ([SCMP](https://www.scmp.com/news/world/united-states-canada/article/3148789/tiktok-factor-jagmeet-singh-woos-canadas-youth-2021)) [med]. The party's own review warned that the TikTok fame made him look "less serious" ([CBC](https://www.cbc.ca/lite/story/1.6614306)) [med]. In 2025 the NDP fell from 24 seats to 7 and lost official party status ([Global News](https://globalnews.ca/news/11153632/canada-election-ndp-jagmeet-singh-results-future)) [high]. Government-device TikTok bans also exposed the platform risk ([The Conversation](https://theconversation.com/canadas-decision-to-ban-tiktok-from-government-devices-is-bad-news-for-the-ndps-election-strategy-200980)) [med].
- **Lesson.** Being fun without being credible does not last. Own your email and SMS list rather than renting an algorithm.

### 2.7 Germany: Die Linke, 2025 (non-English)

- **Measured.** Work Sans with Inter on a Bootstrap base. Site colours are mostly black and white, so the party's red brand colour was **not verified** [med].
- **Mechanics.**
  - Heidi Reichinnek's TikTok clips reached millions ([ZDF heute, Feb 24, 2025](https://www.zdfheute.de/politik/deutschland/bundestagswahl-2025-linke-afd-junge-waehler-100.html)) [high].
  - **638,123 doors** knocked against a 100,000 target. Members carried two service tools, a rent-gouging calculator and a heating-bill check. The tone was "revolutionary friendliness," built on a few core demands: rent cap, prices, wealth tax ([Rosa-Luxemburg-Stiftung, Feb 25, 2025](https://www.rosalux.de/en/news/id/53139/how-die-linke-turned-the-tide)) [med, party-authored].
  - The rent app has been used about 303,500 times in 36 cities, found about 198,000 rents apparently over the legal limit, and generated about 10,000 reports to authorities ([dpa via extraETF, Jul 9, 2026](https://extraetf.com/de/news/dpa-afx/linke-10000-mieter-alarmieren-uber-wucher-app-die-amter--1783571828-00961-1783571825408)) [med].
- **Worked.** 26% of 18-24s voted Linke, the largest party in that group (AfD 21%). The party rose from about 3% in polls to 8.8% ([ZDF](https://www.zdfheute.de/politik/deutschland/bundestagswahl-2025-linke-afd-junge-waehler-100.html); [RLS](https://www.rosalux.de/en/news/id/53139/how-die-linke-turned-the-tide)) [high]. A political scientist cautions that social media was part of the strategy, not the primary cause.
- **Lesson.** **Tools beat posts.** A useful calculator gives every volunteer a reason to knock and every visitor a reason to share.

### 2.8 Brazil: Lula 2022 and the youth-registration wave (non-English)

- **Mechanics.**
  - "Faz o L" ("do the L") was a hand gesture plus slogan that worked as a meme ([Wikipedia](https://en.wikipedia.org/wiki/Faz_o_L)) [med].
  - A cross-celebrity push (Anitta, Juliette, Mark Ruffalo, Leonardo DiCaprio and others) urged 16-17-year-olds to get voter cards ([Global Voices, May 2, 2022](https://globalvoices.org/2022/05/02/brazilian-artists-campaign-to-mobilize-youth-to-vote-in-upcoming-elections/)) [high].
  - Young people ran largely independent social trends for Lula ([nss magazine](https://www.nssmag.com/en/lifestyle/47424/did-young-people-make-the-difference-in-lula-s-re-election)) [med].
- **Worked.** 2,116,781 registered 16-17-year-olds, about 51% above 2018 ([Poder360](https://www.poder360.com.br/eleicoes/brasil-ganhou-2-milhoes-de-jovens-eleitores-em-2022/)) [high]. The online registration portal also helped, so the celebrity effect cannot be isolated.
- **Lesson.** A dead-simple body gesture or hashtag gives fans a way to participate with zero design skill. Pair it with a deadline-driven civic task (register by X).

### 2.9 Chile: Gabriel Boric 2021 (non-English)

- **Mechanics.** Fan communities organized themselves ("Kpopers x Boric," "Swifties x Boric") and the campaign told its story in heavily visual terms ([El Mostrador, Dec 22, 2021](https://www.elmostrador.cl/noticias/pais/2021/12/22/la-epica-que-le-dieron-las-rrss-a-la-campana-del-presidente-electo-que-lo-llevo-hasta-corea-del-sur/)) [med]. No reliable source on the campaign's designers or palette was found.
- **Worked.** Turnout rose in every age group in the runoff. 68% of women under 30 voted Boric ([DecideChile](https://decidechile.cl/api/media/file/ELECCIONES-PRESIDENCIALES-2021-DECIDECHILE.pdf)) [med]. Boric won about 56% ([Dazed](https://www.dazeddigital.com/politics/article/55114/1/4-young-chileans-on-what-gabriel-boric-presidential-win-means-to-them)) [high].
- **Lesson.** Invite fandoms in by name ("Swifties for…") and give them assets. Do not try to own them.

---

## 3. Side-by-side table

| Org (year) | Core colours (hex) | Type | Signature mechanic | Youth result (source) |
|---|---|---|---|---|
| Mamdani (2025) | `#2619D1` `#FFAB00` `#E81900` `#13110C` (measured) | Custom Zohran, Union Gothic, Coffee Service script | Multilingual lo-fi video, neighborhood variants, merch earned by canvassing | ~75% of youth, 28% youth turnout ([CIRCLE](https://circle.tufts.edu/latest-research/young-voters-power-mamdani-victory-shape-key-2025-elections)) |
| AOC (2018) | `#3C2D82` `#EDC93F` `#0842A3` | Norwester, Metropolis, Roboto Slab (open fonts) | Bilingual identity, doc-style launch video | Primary upset (video credited; counts vary) |
| Sanders (2016/20) | `#0070CC` `#00324D` `#F51E47` (measured today) | Jubilat + Gibson | Consistent friendly Americana, SMS keyword | ~71% of under-30 primary voters, 2016 ([PBS](https://www.pbs.org/newshour/amp/politics/sanders-banked-on-young-voters-heres-how-the-numbers-have-played-out)) |
| Harris/KamalaHQ (2024) | brat `#8ACE00` (borrowed) | Sans Plomb + Balto | Rapid-response meme team, 5-min approvals | Youth Harris +4 to +6, men −14 ([CIRCLE](https://circle.tufts.edu/2024-election)) |
| Obama (2008) | red, beige, blues (Fairey); hex not documented | not confirmed here | Modular logo (12 groups, 50 states), MyBO | 66% of under-30s ([Pew](https://www.pewresearch.org/politics/2008/11/13/young-voters-in-the-2008-election/)) |
| Sunrise | `#FFD800` `#061A0B` `#FDF5E1` `#871B78` | Konsole, Source Sans Pro | "Text GND to 88504" | n/a |
| WFP | `#481F82` `#F3563C` `#EAF96E` | PF Venue Condensed, Inter | Figma/Canva template system | n/a |
| Gen-Z for Change | `#EF4347` `#4065AF` `#F8F7F3` `#231F20` | Forma DJR, Lexend | Creator coalition and advocacy tools | self-reported reach |
| Voters of Tomorrow | `#072243` `#0DA2E6` `#F9495F` `#04B35D` | Now + Poppins | Chapters, Gen Z Agenda | self-reported contacts |
| MFOL | `#3384FF` `#FF6914` `#FFCD1E` `#BDFF32` | Area, Matter Mono, Trim Poster | Marquee, action hub, merch | n/a |
| UK Labour (2024) | `#E4003B` and mission colours | Poppins | Mission sub-palettes, meme clips | Young women Green 23% vs men 12% ([YouGov](https://yougov.com/en-gb/articles/49978-how-britain-voted-in-the-2024-general-election)) |
| Momentum (2017) | `#E20613` `#FF0F80` | Neue Haas Grotesk Display | Shareable comedy video | 5.3% of viewers already fans ([OpenLearn](https://www.open.edu/openlearn/society-politics-law/politics/how-did-facebook-likes-help-labour-the-ballot-box)) |
| Aus. Greens (2022) | `#008C44` `#00A651` `#E67509` `#B12F7D` | Anton, Roboto Condensed, Nunito Sans | Meme group plus Discord, housing door-knock | 36% of under-35s ([ANU](https://polis.cass.anu.edu.au/files/docs/2025/6/Explaining_the_2022_election_result.pdf)) |
| NDP (2021-25) | `#F58220` | Montserrat, Bebas Neue, Roboto | TikTok leader | Fame did not hold: 7 seats in 2025 |
| Die Linke (2025) | red (unverified); site black/white | Work Sans, Inter | Rent calculator and 638k doors | 26% of 18-24s ([ZDF](https://www.zdfheute.de/politik/deutschland/bundestagswahl-2025-linke-afd-junge-waehler-100.html)) |

---

## 4. The baseline to break from: what Democrats and the GOP look like today

- **DNC Convention 2024:** "Democracy Blue" `#083A90`, red `#FF343E`, cream `#FEF9EC`, Chicago Blue `#73BCFF` ([DNCC press kit PDF](https://demconvention.com/wp-content/uploads/2024/07/ElectronicPressKit-DNCC-2024-2024-1.pdf)) [high].
- **Florida Democratic Party (measured):** navy `#0A3161` dominates, with flag red `#B31942`. Rubik and Acronym on a Middle Seat theme [high].
- **Young Democrats of America (measured):** red `#E33C1C`, blues `#0856A4` and `#024685`; Roboto, Open Sans, Lato [high].
- **flyoungdems.org, Florida Young Democrats (measured):** Squarespace with Roboto and Montserrat, coral `#F0523D`, sky `#00B2FF` [high].
- **DNC (measured):** HEX Franklin and Tiempos, near-black navy `#000C2E` [high].
- **GOP red:** commonly given as `#E81B23`. No official guide was found ([Brand Palettes](https://brandpalettes.com/republican-party-logo-gop-u-colors/)) [low].

**Takeaway.** The local and national Democratic default is navy plus flag red on a generic theme. Mamdani, WFP and the Florida Democrats run on the same vendor themes, so the plumbing is a commodity and the identity is the differentiator. A static youngsemdem site can match the function and beat the look.

---

## 5. Distillation: 14 transferable principles

1. **Look like the place, not the party.** Mamdani used bodega and taxi vernacular. AOC used Bronx and Latino poster heritage. Obama made 50 state variants. *Apply:* draw from Seminole County itself, never tribal imagery. Sanford was "The Celery City" by about 1900 ([UCF RICHES](https://richesmi.cah.ucf.edu/omeka/exhibits/show/origins_of_the_celery_city)) [high]. Add Lake Monroe and Lake Jesup water, springs, SunRail-era commuting, Florida sunsets and citrus.
2. **Leave the flag palette and say why.** AOC's purple meant red and blue together. Mamdani's yellow was chosen as not politically loaded. *Apply:* a single non-flag hero colour plus dark ink, with a short "why our colours" line in the brand page.
3. **Type-first and loud.** Condensed gothics recur: Union Gothic, Norwester, Sans Plomb, Anton, Bebas. Harris and WFP were deliberately type-first. *Apply:* a condensed display face for headlines and stickers, a highly legible sans for body.
4. **One master mark, many variants.** Obama made 12 groups and 50 states; Mamdani allowed neighborhood versions. *Apply:* a YSD wordmark with city variants (Sanford, Lake Mary, Oviedo, Winter Springs, Altamonte, Casselberry, Longwood) and community variants (Pride, Latine/Boricua, Disability Pride, HBCU alumni, union), each reviewed by people from that community.
5. **Bilingual by design.** AOC gave Spanish equal prominence, Mamdani's volunteer materials came in eight languages, Gen-Z for Change built FIGHT/PODER. Seminole County is about 24% Hispanic ([Data USA, 2024](https://datausa.io/profile/geo/seminole-county-fl)) [med]. *Apply:* ES toggle on every page, Spanish-first social cards, the inverted ¡ ¿ treated as design elements, and type families tested for Spanish diacritics (all recommended fonts include Latin and Latin-Extended).
6. **Make it wearable and remixable.** Merch earned by canvassing (Mamdani), WFP's Figma and Canva templates, Fairey's fan poster adopted by Obama. *Apply:* a public "Remix Kit" page with sticker sheets, IG story and TikTok cover templates, phone wallpapers and a printable door hanger. Merch should be earned through shifts, not only bought.
7. **Lo-fi and person-first beats polish.** AOC's documentary launch, Mamdani's direct-to-camera clips. Authenticity means something the person would plausibly do ([Flaherty](https://www.linkinbio.news/p/what-did-we-learn-from-kamala-hq)). *Apply:* vertical video shot on phones, captions burned in, real members (demo-labeled for now), no stock-footage montages.
8. **Speed with guardrails.** KamalaHQ used clear rules and a 5-minute objection window. *Apply:* a one-page content code, pre-approved templates, and two named approvers with a short SLA so the club can respond the same day.
9. **Tools beat posts.** Die Linke's rent check (303k uses), Gen-Z for Change's action tools, Obama's MyBO. *Apply:* small utilities. "Am I registered / vote-by-mail status" links out to the Seminole Supervisor of Elections. Add "What's on my ballot / who represents me," "Run for local office" and a "Make my sticker" generator. Florida-specific accuracy needs a separate legal check.
10. **Every viral moment ends offline.** Mamdani's reported 3M doors, Die Linke's 638k, Greens door-knocking, Obama's 25% youth contact rate. *Apply:* every page and video carries one clear next step: text keyword, RSVP (Mobilize-style) or shift sign-up. Track conversions, not likes.
11. **Give the fandom a sandbox.** The Greens' "Greems" group and Discord, Boric's Kpopers and Swifties, Lula's youth-run trends, Gen-Z for Change's creator coalition. *Apply:* a members' Discord or group chat, a local-creator program, and "____ for YSD" fan-collection assets that fans can name.
12. **Reach is not votes.** KamalaHQ had ~1.5B views and still lost ground with young men. The NDP's TikTok fame ended in collapse. NZ's "youthquake" was disputed. *Apply:* the success metrics are new members, RSVPs, shifts completed and registrations assisted. Follower counts are vanity.
13. **Substance first, vibe second.** The economy was the top youth issue at 40% in 2024 ([CIRCLE](https://circle.tufts.edu/2024-election)). Mamdani ran on affordability, Die Linke on rent and prices, the Greens on housing. *Apply:* lead the homepage with 3 concrete local fights (for example housing costs, insurance and utility bills, transit), written as plain promises, not slogans.
14. **Joy is a strategy, and it must also reach young men.** Obama's "new day," "Let's do this," Die Linke's "revolutionary friendliness," Bernie's friendliness. CIRCLE shows a 31-point youth gender gap in 2024. *Apply:* an optimistic, funny tone. Include imagery and topics that speak to young men (jobs and trades, sports nights, gaming, car and insurance costs) without bro-pandering.

---

## 6. Three candidate palettes

Rules shared by all three, drawn from the case studies and the contrast math:

- Bright colours act as **fills** under dark ink text. They never carry body text on white or cream, where most of them fail.
- Use one hero colour per screen, as Labour's guide and Sunrise's yellow both show.
- Every colour is a CSS custom property, with dark-mode values defined.
- No pure red. Distance from GOP red and from DNC/FDP navy was checked with CIEDE2000 (ΔE above 10 reads as clearly different).
- Thresholds: AA for normal text is 4.5:1, AA for large text (24px, or 18.66px bold) and UI components is 3:1, AAA is 7:1 ([W3C WCAG 2.2, 1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)).

### Palette 1 · "Celery City Pop" (recommended lead)

Ultraviolet sits in the AOC and WFP "between red and blue" purple lineage, pushed brighter for Gen Z. Celery-lime nods to Sanford's Celery City past and to the acid-lime wave (WFP `#EAF96E`, MFOL `#BDFF32`, brat) without copying `#8ACE00`: ΔE 10.1 from brat green.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#140B33` | text and dark surfaces |
| `--paper` | `#F6F3FF` | page background |
| `--violet` | `#6A2BFF` | hero fill, buttons with white text |
| `--celery` | `#C8F03C` | hero fill, stickers, highlights under ink |
| `--sky` | `#4FD6FF` | secondary fill (cards, tags) |
| `--bubblegum` | `#FF7AC6` | accent (Pride, fan collections) |
| `--violet-deep` | `#4B12D6` | links and text on light backgrounds |
| `--muted` | `#5A5370` | secondary text |

**Contrast (computed):**

| Pair | Ratio | Grade |
|---|---|---|
| ink on paper | 17.05:1 | AAA |
| ink on celery | 14.20:1 | AAA |
| ink on sky | 11.01:1 | AAA |
| ink on bubblegum | 7.86:1 | AAA |
| white on violet | 6.17:1 | AA |
| violet text on paper | 5.64:1 | AA |
| violet-deep on paper | 8.14:1 | AAA |
| celery on violet-deep | 6.78:1 | AA |
| celery on violet | 4.70:1 | AA |
| muted on paper | 6.6:1 | AA |

**Fails** (decorative only): celery, sky or bubblegum as text on paper or white (1.2 to 2.4:1), and violet on ink (3.02:1, large text only).

**Dark mode:** swap paper and ink and lift violet to `#A98BFF` (6.95:1 on ink). Celery, sky and bubblegum on ink all pass AAA.

**Distinctness:** ΔE from GOP red is 33-70 for every colour (bubblegum, the closest, is 32.8); violet is ΔE 19 from DNCC blue and violet-deep ΔE 15.

**Colour-blind note:** violet against celery differs strongly in lightness, so it holds for deutan and protan viewers. Never encode meaning by violet vs sky alone.

### Palette 2 · "Springs & Citrus"

Florida water (springs, Lake Monroe) plus orange blossom and a hot-pink accent. It is the warmest and most "summer" option.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#15122B` | text |
| `--paper` | `#FFF7E8` | background (warm cream) |
| `--teal` | `#00B3A6` | hero fill under ink |
| `--orange` | `#FF6B1A` | hero fill under ink |
| `--pink` | `#FF3E8A` | accent fill |
| `--lime` | `#D7F25C` | highlight and sticker fill |
| `--teal-deep` | `#007A72` | links and text on light backgrounds |
| `--muted` | `#5B5670` | secondary text |

**Contrast:**

| Pair | Ratio | Grade |
|---|---|---|
| ink on paper | 17.10:1 | AAA |
| ink on lime | 14.52:1 | AAA |
| ink on teal | 6.94:1 | AA |
| ink on orange | 6.39:1 | AA |
| ink on pink | 5.47:1 | AA |
| teal-deep on paper | 4.90:1 | AA |
| paper on teal-deep | 4.90:1 | AA |
| muted on paper | 6.55:1 | AA |

**Fails:** orange, teal or pink as text on cream (2.5 to 3.1:1), and white on orange.

**Dark mode:** teal, orange, pink and lime on ink all pass (5.5 to 14.5:1), but teal-deep on ink fails, so use teal for links in dark mode.

**Distinctness:** orange is ΔE 18 from GOP red. Keep orange off any red-white-blue arrangement, and pair it with teal.

**Brand-safety note:** FSU uses turquoise for Seminole Heritage games and patchwork-inspired textiles ([FSU](https://webdav.fsu.edu/seminole-tribe/presence.html)) [med]. With this palette, never put teal into banded or zig-zag patchwork-like patterns.

### Palette 3 · "Flamingo Sunset"

Flamingo pink and sunset orange with an electric cobalt. The cobalt keeps a thread of Democratic blue the way Mamdani's `#2619D1` did, but it is much brighter than navy.

| Token | Hex | Role |
|---|---|---|
| `--ink` | `#111015` | text |
| `--paper` | `#FFF3E6` | background |
| `--flamingo` | `#FF4FA3` | hero fill under ink |
| `--sunset` | `#FF8A00` | hero fill under ink |
| `--cobalt` | `#2B35F0` | buttons with white text, links |
| `--mint` | `#7CF2C4` | highlight fill |
| `--flamingo-deep` | `#C2186B` | pink text on light backgrounds |
| `--muted` | `#5A5560` | secondary text |

**Contrast:**

| Pair | Ratio | Grade |
|---|---|---|
| ink on paper | 17.33:1 | AAA |
| ink on mint | 13.85:1 | AAA |
| ink on sunset | 8.02:1 | AAA |
| white on cobalt | 7.32:1 | AAA |
| cobalt on paper | 6.69:1 | AA |
| ink on flamingo | 6.22:1 | AA |
| mint on cobalt | 5.35:1 | AA |
| flamingo-deep on paper | 5.28:1 | AA |

**Fails:** sunset on cobalt (3.10:1, large text only), cobalt on flamingo (2.4:1), white on flamingo (3.04:1, large text only).

**Dark mode:** lift cobalt to `#8C8FFF` (6.75:1 on ink). Flamingo is 6.22:1 on ink.

**Distinctness:** flamingo is ΔE 27 and sunset ΔE 29 from GOP red; cobalt is ΔE 14 from DNCC blue, a deliberate family resemblance.

**Risk:** pink-forward can read as gendered. Balance it with cobalt and mint in content aimed at young men.

**Recommendation:** lead with **Palette 1** for the brand. Borrow Palette 2's orange and teal as **issue colours** in the Labour "missions" manner: for example housing `#FF6B1A`, climate and water `#00B3A6`, rights `#FF7AC6`, voting `#C8F03C`. Avoid red, white and blue, navy, garnet and gold.

---

## 7. Three Google Fonts type pairings

All of these are served by the Google Fonts CSS API (verified Nov 9, 2026), include Latin and Latin-Extended subsets (so Spanish ñ á é í ó ú ü ¿ ¡ are covered), and are licensed under the SIL Open Font License. That means they can be **self-hosted** as WOFF2 when the site moves to a real domain, with no third-party dependency.

### Pairing 1 (recommended) · League Gothic + Atkinson Hyperlegible Next, with a Yellowtail accent

- **Lineage.** League Gothic is a condensed poster gothic in the Union Gothic, Norwester and Sans Plomb family that keeps recurring in winning campaigns, and it is variable-width (75-100). Atkinson Hyperlegible Next comes from the Braille Institute and is designed for low-vision legibility ([Braille Institute](https://www.brailleinstitute.org/freefont/)). It turns accessibility into a brand value, much as AOC's open fonts signalled values. Yellowtail stands in for Mamdani's Coffee Service hand-painted-sign script and should be used for one word per screen at most ("¡Vamos!", "Let's go").
- **WCAG and readability notes.**
  - Use League Gothic only at 32px and up, in caps or title case, with letter-spacing of 0.01 to 0.02em.
  - Never set body text in a condensed face.
  - Body text at 17-18px with line-height 1.5 or more, and paragraph width of 45-75 characters.
  - The script accent must never carry essential information; give it a plain-text equivalent.
- **Snippet.**
  ```css
  /* demo: Google Fonts; production: self-host the same files */
  @import url("https://fonts.googleapis.com/css2?family=League+Gothic:wdth@75..100&family=Atkinson+Hyperlegible+Next:wght@200..800&family=Yellowtail&display=swap");
  :root{--font-display:"League Gothic",Impact,"Arial Narrow",sans-serif;--font-body:"Atkinson Hyperlegible Next",system-ui,sans-serif;--font-script:"Yellowtail",cursive;}
  ```

### Pairing 2 · Bricolage Grotesque + Figtree, with an Instrument Serif italic accent

- **Character.** Bricolage Grotesque is quirky and editorial, with optical-size, width and weight axes. It suits a magazine or newsletter feel, which fits a Service95-style editorial voice. Figtree is a friendly geometric body face. An Instrument Serif italic can mark "notes from the team" and pull quotes.
- **Notes.** Bricolage's tight optical sizes look best at 40px and up. Use the `opsz` axis automatically (`font-optical-sizing:auto`). Figtree reads well at 16-18px, and its x-height is generous. Keep italics to short spans for dyslexic readers.
- **Snippet.** `family=Bricolage+Grotesque:opsz,wdth,wght@12..96,75..100,200..800&family=Figtree:wght@300..900&family=Instrument+Serif:ital@0;1`

### Pairing 3 · Archivo (Expanded and Condensed) + Archivo (Normal), with Space Grotesk for data

- **Character.** One variable superfamily with a width axis from 62 to 125. Use 125 (expanded) for loud wide headlines with a Y2K and streetwear feel like MFOL's poster faces, 62 (condensed) for tags and stickers, and 100 for body. One file means fewer bytes and simpler self-hosting. Space Grotesk's numerals suit vote counts, dates and receipts, a nod to MFOL's monospace accountability styling.
- **Notes.** Expanded caps eat horizontal space, so cap headlines at about 3 words per line on 390px phones. Body text stays at width 100 and 17px or more.
- **Snippet.** `family=Archivo:wdth,wght@62..125,100..900&family=Space+Grotesk:wght@400..700`

**Alternates if a different personality is wanted:** Anton or Bebas Neue (poster), Unbounded (wide and rounded, Gen Z), Big Shoulders Display (Chicago-poster condensed), Lexend (readability, as Gen-Z for Change uses).

---

## 8. What to avoid

- **Native American imagery, motifs, words and colour codes.** "Seminole" is the name of sovereign nations. Avoid:
  - patchwork bands, chickees, feathers, arrowheads and "tribe" or "warrior" copy;
  - FSU's "Noles" association and its garnet and gold (commonly given as `#782F40` and `#CEB888`) [med];
  - the four-colour set of black, yellow, white and red arranged as quadrants or bands, which the Tribe's seal reportedly uses as medicine colours [low; verify with the Tribe].
  Write the name in full ("Young Seminole County Democrats" or "Young Dems of Seminole County") at first mention, so the geography is clear.
- **Flag clichés and generic navy:** stars-and-stripes, eagles, navy-and-red gradients (see §4).
- **Copying borrowed equity.** Brat green, lowercase low-res Arial and other meme formats date quickly and can annoy the original fandom. Riff on the energy, never the asset.
- **Meme-jacking without substance.** Critics said Labour's 2024 memes read as fake. Every meme needs a payload (a fact, a date, an action).
- **Polished stock-photo diversity.** Use candid, phone-shot imagery. Unsplash-style photos are fine for the demo, but label demo people as demo and never imply that a stock model is a member or endorser.
- **Fake endorsements, AI likenesses of real politicians, or fabricated testimonials.** Florida and federal disclaimer rules apply to anything paid; check them before launch.
- **Bright colour as text on white** (it fails WCAG; see §6). Avoid auto-moving marquees and carousels without a pause control: WCAG 2.2.2 requires one for motion over 5 seconds, as Gen-Z for Change's hover-pause marquee shows. Respect `prefers-reduced-motion`.
- **Over-claiming a youthquake.** Report numbers with denominators (NZ 2017 lesson).
- **Platform dependency.** TikTok bans and algorithm changes can erase reach overnight (NDP lesson). Make email and SMS the backbone.
- **Soviet or propaganda pastiche.** Bernie's designer avoided a red star on purpose. Heroic-worker poster style can work (AOC) but needs a light, warm hand.

---

## 9. Recommendations for the youngsemdem site

1. **Adopt Palette 1 and Pairing 1** as the default design tokens in one `tokens.css` file (colours, type, spacing, radii, shadows) with light and dark values. Issue colours are a Labour-style secondary set. The whole brand should be swappable by editing one file, which keeps it portable.
2. **Hero:** a full-bleed celery or violet block with a giant League Gothic headline, one concrete local promise, and one call to action ("Text JOIN to [short code]"). Use a placeholder short code and keyword in the demo, clearly marked. A marquee of the seven city names with a pause control sits underneath.
3. **Mark system:** a YSD wordmark with city and community variants (principle 4) and a downloadable **Remix Kit** (principle 6). Include a client-side "Make my sticker" generator (name + city → PNG) for shareable identity, so no server is needed.
4. **Clips wall for video:**
   - vertical 9:16 cards, muted autoplay only when in view and only if `prefers-reduced-motion` is not set;
   - captions required (WCAG 1.2.2);
   - a moderated "submit a clip" form with consent and likeness release;
   - start with TikTok, Instagram and YouTube Shorts embeds, and leave an adapter for Mux or Cloudflare Stream later.
5. **Tools, not just pages (principle 9):** link out to official Seminole County Supervisor of Elections lookups (registration, vote-by-mail, polling place), add a "Run for local office" explainer, and an events page with a Mobilize-style RSVP slot. Integrations (ActBlue, Mobilize, Action Network/EveryAction, SMS) belong in a config object, never hard-coded.
6. **Claude in the site:** put it where it removes friction. A bilingual "Ask YSD" helper should answer only from site content and linked official sources and should always link to the Supervisor of Elections for voting logistics. A caption and translation assistant (EN↔ES) can help volunteers, along with a template-filling "remix my post" tool. Hard rules: no impersonating real people, no generated endorsements, and visible "AI-assisted" labels. The API key belongs in a serverless function, never in the browser.
7. **Share-native everywhere:** per-page Open Graph and Twitter images in brand colours, Web Share API buttons, copy-ready captions in EN and ES, and UTM-tagged links so conversions can be measured (principle 12).
8. **Copy tone:** warm, cheeky, specific and optimistic ("Let's do this"-style imperatives), bilingual, never doom-first. The Dua Lipa/Service95 voice study belongs to a separate report; this design system leaves room for an editorial "newsletter" module built on Pairing 2's Instrument Serif italic if it is wanted.

---

## 10. Open questions

1. Will a Seminole Tribe of Florida contact, or a local Native advisor, review the name, the palette and the "avoid" list? Recommended before public launch.
2. Will Kira and the club pick Palette 1 (violet and celery) or the warmer Palette 2? A quick 5-person preference test with members under 30 would settle it.
3. Which official name: "Young Seminole County Democrats," "Seminole Young Dems" or the "youngsemdem" handle? Is the club chartered under the Seminole DEC or Florida Young Democrats? That affects disclaimers and ActBlue eligibility.
4. Does the club already have an SMS short code or keyword, a Mobilize account or an Action Network group? If not, the demo uses placeholders.
5. How far should Spanish go (full parity vs key pages)? Is Haitian Creole or Vietnamese also wanted? Language-at-home data for Seminole County should be verified (the Census API needed a key; Data USA did not report it).
6. Is anyone available to approve content at speed (principle 8)? Without named approvers, the rapid-response mechanic will not work.
7. Brand checks: FSU's exact brand hexes, and whether the Tribe's seal colours are as reported, were not verified against official guides here.

---

## 11. Sources

1. CIRCLE (Tufts), "Young Voters Power Mamdani Victory, Shape Key 2025 Elections," Nov 5, 2025 (rev. Nov 12). https://circle.tufts.edu/latest-research/young-voters-power-mamdani-victory-shape-key-2025-elections
2. Philadelphia Inquirer, on Forge and Mamdani's brand, Jun 25, 2025. https://www.inquirer.com/politics/nation/zohran-mamdani-brand-design-forge-philadelphia-20250625.html
3. Steven Heller, "The Daily Heller: Typecasting Zohran Mamdani," PRINT, May 6, 2026. https://www.printmag.com/daily-heller/the-daily-heller-typecasting-zohran-mondami/
4. Fonts In Use, "Zohran for New York City campaign graphics." https://fontsinuse.com/uses/78381/zohran-for-new-york-city-campaign-graphics
5. AP via Fortune, on Mamdani's bodega and Bollywood design, Nov 8, 2025. https://fortune.com/2025/11/08/zohran-mamdani-campaign-graphic-design-hot-dogs-bodegas-bollywood/
6. Al Jazeera, "How Zohran Mamdani reached a multilingual, multicultural New York online," Jul 17, 2025. https://www.aljazeera.com/economy/2025/7/17/how-zohran-mamdani-reached-a-multilingual-multicultural-new-york
7. Nation of Change, on Mamdani's movement victory (campaign volunteer and door figures), Nov 5, 2025. https://www.nationofchange.org/2025/11/05/zohran-mamdanis-movement-victory-reshapes-new-york-politics
8. The New Republic, "The Secret Ingredient to Zohran Mamdani's Success." https://newrepublic.com/article/197359/zohran-mamdani-food-campaign-success
9. City & State NY, "DSA's membership nearly doubled since the start of the Mamdani campaign," Jan 2026. https://www.cityandstateny.com/politics/2026/01/dsas-membership-nearly-doubled-start-mamdani-campaign/410966/
10. zohranfornyc.com, live CSS measured Nov 9, 2026. https://www.zohranfornyc.com/
11. F Newsmagazine (SAIC), on AOC's campaign design, Jul 20, 2018. https://fnewsmagazine.com/?p=72721
12. Typeroom, "Alexandria Ocasio-Cortez x Tandem," Nov 14, 2018. https://www.typeroom.eu/alexandria-ocasio-cortez-x-tandem-when-radical-politics-meet-radical-design-victory-ensues
13. Filmmaker Magazine, on Means of Production. https://filmmakermagazine.com/?p=105857
14. Novara Media, "Revolution and Chill," Mar 4, 2020. https://novaramedia.com/2020/03/04/revolution-and-chill-the-anticapitalist-streaming-service-thats-netflix-for-the-99/
15. AIGA Eye on Design, "How Bernie Sanders Built a New Language for Democratic Socialism," Mar 23, 2020. https://eyeondesign.aiga.org/how-bernie-sanders-built-a-new-language-for-democratic-socialism/
16. PBS NewsHour, "Sanders banked on young voters. Here's how the numbers have played out," 2016. https://www.pbs.org/newshour/amp/politics/sanders-banked-on-young-voters-heres-how-the-numbers-have-played-out
17. berniesanders.com, live CSS measured Nov 9, 2026. https://berniesanders.com/
18. Daily Dot, on Kamala Harris, Charli XCX and brat green, Jul 2024. https://dailydot.com/debug/kamala-harris-charli-xcx-brat-green/
19. The Nightly (NYT reprint), "Brat green, aka hex #8ACE00." https://thenightly.com.au/politics/brat-green-aka-hex-8ace00-you-cant-escape-this-colour-thanks-to-charlie-xcx-c-15494520
20. Fonts In Use, "Harris/Walz 2024 US Presidential Campaign," Sep 5, 2024. https://www.fontsinuse.com/uses/63052/harris-walz-2024-us-presidential-campaign
21. Rachel Karten, "What Did We Learn From Kamala HQ?" (interview with Rob Flaherty), Apr 30, 2025. https://www.linkinbio.news/p/what-did-we-learn-from-kamala-hq
22. NZ Herald, "Could feral 25-year-olds win the US election for Kamala Harris?" 2024. https://nzherald.co.nz/business/could-feral-25-year-olds-win-the-us-election-for-kamala-harris/LZIRZNZ3XRCCHHZSBTWNBK5MDE
23. CIRCLE (Tufts), "The Youth Vote in 2024" (final estimates Apr 2025). https://circle.tufts.edu/2024-election
24. Al Jazeera, "'Kamala is brat': The viral pop meme driving the Harris election campaign," Jul 23, 2024. https://www.aljazeera.com/amp/news/2024/7/23/kamala-is-brat-the-viral-pop-meme-driving-the-harris-election-campaign
25. Wikipedia, "Obama logo." https://en.wikipedia.org/wiki/Obama_logo
26. Pew Research Center, "Young Voters in the 2008 Election," Nov 13, 2008. https://www.pewresearch.org/politics/2008/11/13/young-voters-in-the-2008-election/
27. Art Institute of Chicago, Shepard Fairey, "Barack Obama 'Hope' Poster." https://www.artic.edu/artworks/229396/barack-obama-hope-poster
28. Mother Jones, "I, Obot," Jan 2009. https://www.motherjones.com/politics/2009/01/i-obot/
29. sunrisemovement.org, live CSS measured Nov 9, 2026. https://www.sunrisemovement.org/
30. Poster House collection, "Overcome History to Protect the Future" (Sunrise/Tandem, 2020). https://collection-open.posterhouse.org/?p=17575
31. workingfamilies.org, live CSS measured Nov 9, 2026. https://workingfamilies.org/
32. Campaigns & Elections, "How One Designer Has Adopted a Template Model to Unleash Her Party's Creativity," Aug 15, 2022. https://campaignsandelections.com/creative/how-one-designer-has-adopted-a-template-model-to-unleash-her-partys-creativity
33. Working Families Party, "A Brand to Meet This Moment," Medium, Oct 5, 2020. https://medium.com/@WorkingFamilies/a-brand-to-meet-this-moment-ff305380a6aa
34. Wikiwand, "Democratic Socialists of America" (logo history). https://wikiwand.com/en/articles/Democratic_Socialists_of_America
35. genzforchange.org, live site measured Nov 9, 2026. https://genzforchange.org/
36. Tubefilter, "The White House wants influential young TikTok stars to spread its message about Ukraine," Mar 11, 2022. https://tubefilter.com/2022/03/11/white-house-briefs-tiktok-stars-kahlil-greene-ukraine/
37. votersoftomorrow.org, live site measured Nov 9, 2026. https://votersoftomorrow.org/
38. runforsomething.net, live site measured Nov 9, 2026. https://runforsomething.net/
39. Champions Design, "Run for Something." https://www.championsdesign.com/new/work/run-for-something
40. marchforourlives.org, live site measured Nov 9, 2026. https://marchforourlives.org/
41. Poster House, "Hot Poster Gossip: ThoughtMatter Edition." https://posterhouse.org/blog/hot-poster-gossip-thoughtmatter-edition/
42. Labour Party, Brand Guidelines (PDF, uploaded Feb 2026). https://labour.org.uk/wp-content/uploads/2026/02/3502_25-Labour-Brand-Guidelines-3-updated.pdf
43. YouGov, "How Britain voted in the 2024 general election," Jul 8, 2024. https://yougov.com/en-gb/articles/49978-how-britain-voted-in-the-2024-general-election
44. Estudios sobre el Mensaje Periodístico (UCM), "From Message to Vibe: TikTok and Hybrid Political Communication in the 2024 UK Election." https://revistas.ucm.es/index.php/ESMP/en/article/view/107103
45. Novara Media, "'We Can Spot Fakery a Mile Off': Labour's Memes Are an Insult to Young Voters," Jul 1, 2024. https://novaramedia.com/2024/07/01/we-can-spot-fakery-a-mile-off-labours-memes-are-an-insult-to-young-voters/
46. OpenLearn, "How did Facebook likes help Labour at the ballot box?" https://www.open.edu/openlearn/society-politics-law/politics/how-did-facebook-likes-help-labour-the-ballot-box
47. IBTimes UK, "Jeremy Corbyn's viral revolution: Momentum's savvy social media strategy hailed," 2017. https://www.ibtimes.co.uk/jeremy-corbyns-viral-revolution-momentums-savvy-social-media-strategy-hailed-1625760
48. N. Biddle and I. McAllister, "Explaining the 2022 Australian Federal Election Result," ANU, Jun 20, 2022. https://polis.cass.anu.edu.au/files/docs/2025/6/Explaining_the_2022_election_result.pdf
49. Crikey, on the Australian Greens' social media (the "Greems"), May 10, 2022. https://www.crikey.com.au/2022/05/10/australian-greens-social-media-federal-election/
50. Green Left, "Greens campaign manager: Three reasons why we did so well in Brisbane." https://greenleft.org.au/node/72323
51. Mediaweek, on the Fabulate analysis of the 2025 campaign's TikTok reach. https://www.mediaweek.com.au/fabulate-anthony-albaneses-land-with-younger-voters-as-dutton
52. AdNews, "Albanese leads TikTok engagement in 'influencer election'," 2025. https://www.adnews.com.au/news/albanese-leads-tiktok-engagement-in-influencer-election
53. Newshub, "Jacinda Ardern reveals Labour's new campaign slogan: Let's do this," Aug 2017. https://www.newshub.co.nz/home/election/2017/08/jacinda-ardern-reveals-labour-s-new-campaign-slogan-let-s-do-this.html
54. Augusto, "Labour 2017 Election Campaign." https://www.augusto.co.nz/work/labour-2017-election-campaign
55. NZ Electoral Commission, "Election turnout up for all age groups," 2017. https://elections.nz/media-and-news/2017/election-turnout-up-for-all-age-groups
56. Bryce Edwards, "'Youthquake' fails to shake NZ," Democracy Project, Nov 3, 2017. https://democracyproject.nz/2017/11/03/bryce-edwards-youthquake-fails-to-shake-nz/
57. South China Morning Post, "The TikTok factor: Jagmeet Singh woos Canada's youth in 2021 election campaign." https://www.scmp.com/news/world/united-states-canada/article/3148789/tiktok-factor-jagmeet-singh-woos-canadas-youth-2021
58. CBC, "The NDP suffered from a credibility gap in 2021 — and Singh's TikToks may not have helped." https://www.cbc.ca/lite/story/1.6614306
59. Global News, "What next for the NDP after party loses leader, seats and official status?" Apr 2025. https://globalnews.ca/news/11153632/canada-election-ndp-jagmeet-singh-results-future
60. The Conversation, "Canada's decision to ban TikTok from government devices is bad news for the NDP's election strategy," 2023. https://theconversation.com/canadas-decision-to-ban-tiktok-from-government-devices-is-bad-news-for-the-ndps-election-strategy-200980
61. ZDF heute, on why Die Linke and AfD scored with young voters, Feb 24, 2025. https://www.zdfheute.de/politik/deutschland/bundestagswahl-2025-linke-afd-junge-waehler-100.html
62. Rosa-Luxemburg-Stiftung (I. Schwerdtner, J. van Aken), "How Die Linke Turned the Tide," Feb 25, 2025. https://www.rosalux.de/en/news/id/53139/how-die-linke-turned-the-tide
63. dpa-AFX via extraETF, on 10,000 tenants reporting through the rent app, Jul 9, 2026. https://extraetf.com/de/news/dpa-afx/linke-10000-mieter-alarmieren-uber-wucher-app-die-amter--1783571828-00961-1783571825408
64. Global Voices, "Brazilian artists campaign to mobilize youth to vote in upcoming elections," May 2, 2022. https://globalvoices.org/2022/05/02/brazilian-artists-campaign-to-mobilize-youth-to-vote-in-upcoming-elections/
65. Poder360, "Brasil ganhou 2 milhões de jovens eleitores em 2022." https://www.poder360.com.br/eleicoes/brasil-ganhou-2-milhoes-de-jovens-eleitores-em-2022/
66. Wikipedia, "Faz o L." https://en.wikipedia.org/wiki/Faz_o_L
67. nss magazine, "Did young people make the difference in Lula's re-election?" https://www.nssmag.com/en/lifestyle/47424/did-young-people-make-the-difference-in-lula-s-re-election
68. El Mostrador, on the social-media story of Boric's campaign, Dec 22, 2021. https://www.elmostrador.cl/noticias/pais/2021/12/22/la-epica-que-le-dieron-las-rrss-a-la-campana-del-presidente-electo-que-lo-llevo-hasta-corea-del-sur/
69. DecideChile, "Elecciones Presidenciales 2021" (PDF). https://decidechile.cl/api/media/file/ELECCIONES-PRESIDENCIALES-2021-DECIDECHILE.pdf
70. Dazed, "4 young Chileans on what Gabriel Boric's presidential win means to them." https://www.dazeddigital.com/politics/article/55114/1/4-young-chileans-on-what-gabriel-boric-presidential-win-means-to-them
71. DNCC 2024 Electronic Press Kit (PDF). https://demconvention.com/wp-content/uploads/2024/07/ElectronicPressKit-DNCC-2024-2024-1.pdf
72. floridadems.org, yda.org, flyoungdems.org and democrats.org, live CSS measured Nov 9, 2026. https://www.floridadems.org/ · https://www.yda.org/ · https://www.flyoungdems.org/ · https://democrats.org/
73. Brand Palettes, "Republican Party (GOP) logo colors" (unofficial). https://brandpalettes.com/republican-party-logo-gop-u-colors/
74. UCF RICHES, "Origins of the Celery City (1877-1913)." https://richesmi.cah.ucf.edu/omeka/exhibits/show/origins_of_the_celery_city
75. Florida State University, "Seminole Presence on Campus." https://webdav.fsu.edu/seminole-tribe/presence.html
76. Data USA, "Seminole County, FL" (2024 ACS). https://datausa.io/profile/geo/seminole-county-fl
77. W3C, "Understanding SC 1.4.3: Contrast (Minimum)," WCAG 2.2. https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html
78. Braille Institute, "Atkinson Hyperlegible Font." https://www.brailleinstitute.org/freefont/
79. Google Fonts specimens (availability and subsets verified via the CSS API, Nov 9, 2026): League Gothic https://fonts.google.com/specimen/League+Gothic · Atkinson Hyperlegible Next https://fonts.google.com/specimen/Atkinson+Hyperlegible+Next · Yellowtail https://fonts.google.com/specimen/Yellowtail · Bricolage Grotesque https://fonts.google.com/specimen/Bricolage+Grotesque · Figtree https://fonts.google.com/specimen/Figtree · Instrument Serif https://fonts.google.com/specimen/Instrument+Serif · Archivo https://fonts.google.com/specimen/Archivo · Space Grotesk https://fonts.google.com/specimen/Space+Grotesk
