# 00 - Lead fact-check notes (read before writing any copy)

Checked by the lead on Mon Nov 9, 2026, after reports 01-06 landed. These rulings override anything looser in the reports or the brief.

## The org
- The site is for the **Young Democrats of Seminole County (YDSC)**, the real chartered chapter. Kira confirmed this on Nov 9, 2026 and is getting the chapter's sign-off. Short: YDSC; casual: "Young Dems". Handle: `youngsemdems`. Florida Young Democrats lists the Instagram handle @youngsemdems for the chapter (report 01). Treat it as theirs, but don't link it until the chapter confirms it.
- Membership is **ages 14 to under 40**, per YDSC's ActBlue dues page and the Florida Young Democrats charter. Write "14 to 39" or "under 40". Never write "40 and under".
- Dues are $20 a year, paid in January. A non-voting membership is open to anyone who can't pay. Public ActBlue pages: `youngsemdems` (donate) and `ydscdues` (dues); both are in `assets/js/config.js`.
- **The AI assistant is cut.** No chatbot, no "Ask" helper, no LLM features on the site. This overrides report 06's suggestion of an opt-in Claude module.

## Election results: usable, with "unofficial" until certified
- **Seminole County went for the Democrat for governor.** David Jolly took about 54.1% to Byron Donalds' 44.6% in Seminole (WFTV: 54.08% to 44.59%), per unofficial returns. Round to "about 54% to 45%" in copy. Statewide, Donalds won about 50.0% to 48.7% (AP). Copy may say "Seminole voted blue for governor on Nov 3" and should mark the figures unofficial until certified.
  - [Florida Phoenix, Nov 3, 2026](https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/)
  - [WFTV county results](https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/)
  - [Seminole SOE unofficial summary](https://voteseminole.gov/wp-content/uploads/2026/11/Unofficial1.pdf). This PDF covers only part of the vote count, so don't quote its percentages.
- **Young voters nationally, Nov 3, 2026**: CIRCLE (Tufts) estimates youth (18-29) turnout at about 27%, the second-highest midterm rate in 30 years after 2018. Young voters favored Democrats in House races by about 35 points, up from 14 in 2024. These are early estimates, and outlets differ slightly on subgroup figures, so attribute them to CIRCLE and call them estimates. ([Axios, Nov 5, 2026](https://www.axios.com/2026/11/05/gen-z-voters-2026-midterms-democrats-house); [WJLA/Sinclair](https://wjla.com/news/nation-world/young-voters-help-deliver-democratic-wave-but-their-support-may-be-fleeting-midterm-elections-2026-congress-majority-economy-cost-of-living); [CIRCLE 2026 election hub](https://circle.tufts.edu/2026-election))
- Report 01's 2024 comparison (Trump 50.9 to 47.4 in Seminole) and its numbers on 18-40 voters (36.8% of 338,692 active voters; NPA 34.3%, Dem 32.7%, Rep 27.4%) are sourced there. **Implication for tone: most young Seminole voters are independents. Invite them in; don't scold them.**

## Voting rules: the copy hooks, verified
- **Mail-ballot requests made BEFORE Nov 3, 2026 expire Dec 31, 2026. A request made after Nov 3 should run through 2028.** CORRECTED by the content checkers; my first ruling said "every request expires Dec 31", which is too broad. A request is valid through the end of the calendar year of the next regularly scheduled general election after it is made ([F.S. 101.62(1)(a)](https://www.flsenate.gov/Laws/Statutes/2025/101.62)). For any request made between the Nov 2024 and Nov 3, 2026 general elections, that means Dec 31, 2026. For one made after Nov 3, 2026, it means Dec 31, 2028. Seminole's elections office hasn't said how it handles requests made Nov 4 to Dec 31, 2026; recheck by Dec 15.
  - Required copy shape: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure."
  - Link `links.vote.voteByMail` and `links.vote.myVoterRecord`. This stays the site's lead action through 2027.
  - No prizes, merch or anything of value for registering, renewing or voting (52 U.S.C. 10307(c); Florida's vote-buying law). Badges and XP may *celebrate* civic steps, but no rewards with value. Physical rewards go only to organizing actions (volunteering, bringing friends to events), and none are tied to a friend registering or voting. Counsel should confirm before launch.
- **Student IDs stop counting at the polls on Jan 1, 2027.** HB 991, Ch. 2026-26, was signed Apr 1, 2026. It removes student, retirement-center, neighborhood-association and public-assistance IDs from the acceptable photo IDs (s. 101.043). That provision takes effect Jan 1, 2027 ([Senate bill summary](https://flsenate.gov/Committees/BillSummaries/2026/html/991); [bill page](https://flsenate.gov/Session/Bill/2026/991)). A federal lawsuit filed Oct 16, 2026 challenges the student-ID ban ([complaint via Democracy Docket](https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf)).
  - Required copy shape: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go."
  - Don't list the full set of accepted IDs from memory. Link the county elections office instead.
- HB 991 also adds citizenship verification for new registrations from Jan 1, 2027. Say it plainly, without fearmongering, and link the official register page.
- **Next dates.** Use them only with these labels:
  - Nov 2, 2027 city elections: Oviedo confirmed. Lake Mary and Altamonte Springs are likely; label them "expected".
  - Mar 21, 2028: presidential preference primary.
  - Aug 22, 2028: primary.
  - Nov 7, 2028: general election.
  - Re-check every date against voteseminole.gov before launch. Keep them all in one data file with `verified` and `source` fields.

## Conventions (lead decisions, Nov 9)
- Share-text placeholders: `{link}` is canonical. The site's fill helper also replaces `{url}`, so older data files keep working.
- In Spanish, the brand takes the article: "los Young Dems" ("Únete a los Young Dems"). Use the full name "Young Democrats of Seminole County" untranslated.
- Every demo item says DEMO in both languages: "Evento DEMO", never only "de muestra".
- Members under 18 get random-style referral codes, so a teen's first name never appears in links they share.

## Brand safety
- No Native American imagery or language. The county is named for the Seminole people, so the visuals come from the county itself: Lake Monroe, the Sanford Riverwalk, SunRail, Oviedo's chickens, the Celery City.
- Demo people, events, clips and counters are labelled DEMO. Don't use real officers' names. Don't present any politician as an endorser.
- Footer, until the chapter settles its committee status: "Paid for by [committee name and address placeholder]". Report 06 has the F.S. 106.143 wording for when that question is settled.
