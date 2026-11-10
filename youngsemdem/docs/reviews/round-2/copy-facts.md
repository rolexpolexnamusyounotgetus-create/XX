# Round 2 review: copy, facts and Spanish

Lens: every rendered word in English and Spanish, checked against `data/*.js`, ruling 00 (`docs/research/00-lead-factcheck.md`), BRIEF §0, §2 and §9, and the voice guide (report 05). Reviewed Tue, Nov 10, 2026, 6:45 to 9:30 am (the brief's "today" is Mon, Nov 9; the browser clock said Nov 10, so the countdowns below read 51, 33 and 35 days, which is correct for Nov 10). Working tree at `d4172e0`. No site file was edited.

**Evidence** lives outside the repo at `/tmp/claude-0/-home-user-XX/1b1d734e-7ece-5247-bd39-6725f8e29b5b/scratchpad/cf2/` (called `CF2/` below):

- `CF2/dump/<page>.txt`: `document.body.innerText` for all 101 pages after JS ran, with every `<details>` opened, plus dialog and `[hidden]` text, alts, aria-labels, `<title>`, meta and OG text (Playwright, 390 px, http).
- `CF2/flows/*.txt`: interactive states, EN and ES: RSVP sheet, bad-email error, success ticket, going card and the under-14 path; join at ages 21, 16, 45 and 12; both quizzes played to the result and the sticker reveal; newsletter signup; post with empty submit; friend landings (`?from=Kira&ref=…`) on an event, vote, a quiz result and join.
- `CF2/shots/*.png`: crops of each finding as rendered.
- `CF2/dl/h0991.txt`: text of the HB 991 final bill analysis, used to check the ID list.

**Tool baseline** (read-only runs): `voice_lint` 132 files, 0 errors. `make_es --check --all` 18 pages, 0 untranslated. No console errors in the dumps. Weekday checker: every weekday-plus-date pair on all 101 pages matches the calendar (2026 to 2028). That includes the holiday shifts the vote page gets right: Feb 22, 2028 (Presidents' Day) and Oct 10, 2028 (Columbus Day), both Florida legal holidays under F.S. 683.01.

---

## Summary

The copy is the strongest part of the site. The voice holds across 101 pages:

- 1 exclamation mark site-wide (on a success state)
- 0 emoji in rendered copy
- 0 banned words
- no candidate names anywhere in visible text
- DEMO on every demo count, person, venue and clip, in both languages

The facts I re-checked on the web today all hold:

- Seminole for governor 54.08% to 44.59% (WFTV)
- statewide 50.02% to 48.71%
- CIRCLE's 27% youth turnout
- three statewide amendments in 2026
- HB 991 removes debit and credit cards and adds the passport card (final bill analysis)
- the license-citizenship deadline of Jul 1, 2027
- the student-ID suit has no ruling yet
- the SemDems meetings on Thu Nov 12 and Thu Dec 10
- certification by noon on the 13th day (Mon, Nov 16)
- SunRail runs weekdays only
- Sanford was called the Celery City as early as 1900

The writing would beat every right-wing benchmark on plain words and honesty today.

It is not yet at "as close to perfect as possible", for five reasons:

1. **Four ruling-00 or legal slips.**
   - The vote page's step summary says flatly "One new request covers 2027 and 2028", which drops the required "should" and the My Voter Record check.
   - A 2027 deadline tile wears a **CONFIRMED** badge over two cities that ruling 00 says must read "expected".
   - The Spanish meta and share texts name the club "los jóvenes demócratas del condado de Seminole", which goes against ruling 00's own example, "Únete a los Young Dems".
   - The site sends high schoolers to "Pay dues on ActBlue", whose form makes every payer attest "I am at least eighteen years old". It still shows that button to a member it knows is 16.
2. **One honesty line is false in English and nonsense in Spanish.** The "What's real" card says "The Spanish is written by hand". In Spanish that becomes "escrito a mano", which means handwritten.
3. **The Spanish quiz names don't work as identities.** "Kira sacó Conoce a Medio Mundo" reads as "Kira pulled 'Go meet half the world'". The show-up quiz's names mix an imperative, an interjection and nouns, with English Title Case. This is the most shared surface on the site.
4. **Term drift.**
   - The tentpole event has 2 English names and 3 Spanish names, some on the same card.
   - "Open Mic" means two different things: a 3-minute live night and a 60-second Reel format.
   - In Spanish, "grupo" means the chapter, a crew and the group chat.
   - A seat is "guardado", "reservado" or "apartado" depending on the screen.
   - The perk ladder says hosting earns the sticker sheet (home) and the tote (host kit).
5. **Promises the About page says we don't make.** "Usually within 3 days" for clip review is shown unlabeled on the Reel and Post pages, while About says "Who moderates clips… We don't promise any of it until the chapter does."

**Counts:** 30 findings, 5 blocking, 13 major, 12 minor. The fixes are mostly one-line data edits.

**Round 1:** no copy reviewer ran in round 1, so there are no copy findings to re-verify. I checked the round-1 fixes that touch copy, and they held:

- `right-wing-sunrail-saturday`: the SunRail clip now says "Trains run weekdays only, so we made it a weeknight."
- `journeys-17`: the mail plan never invites a late ballot.
- `genz-brand-14`: the issue identities render on result pages; reproductive freedom stays plain on purpose.
- `genz-brand-27`: the series have names.
- `journeys-03` / `journeys-15`: the slim "Kira invited you" line has no unlabeled event.
- The teen RSVP: the "show my name" toggle is hidden and disabled for a 15-year-old (verified in the DOM, `CF2/flows/rsvp-teen-done.png`).

---

## Facts re-verified today (Nov 10, 2026)

| Claim on the site | Where | Check | Result |
|---|---|---|---|
| Seminole picked the Democrat, about 54% to 45%, unofficial | home, newsletter | [WFTV county table](https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/): 105,232 (54.08%) to 86,756 (44.59%); statewide 50.02 to 48.71 | holds |
| About 27% national youth turnout, early CIRCLE estimate | home | [CIRCLE 2026 hub](https://circle.tufts.edu/2026-election); [Fortune, Nov 6](https://fortune.com/2026/11/06/gen-z-young-voters-midterms-democrats-economy-iran-war/) | holds |
| Official returns due Mon, Nov 16 | home, newsletter | [F.S. 102.112(2)](https://www.flsenate.gov/Laws/Statutes/2025/102.112): "no later than noon on the 13th day" | holds |
| Seminole hasn't posted how it treats Nov 4 to Dec 31 requests | vote, events | [SOE vote-by-mail page](https://voteseminole.gov/how-to-vote/vote-by-mail/) still only says "Requests received now will apply to the November 3 General Election" | holds |
| Student-ID suit filed Oct 16, no ruling | vote, issues | [Democracy Docket case page](https://www.democracydocket.com/cases/florida-student-id-ban-challenge/); no ruling found | holds |
| HB 991 drops debit/credit cards, adds the passport card | vote | Final bill analysis (`CF2/dl/h0991.txt`, lines 283 to 290). The Senate summary omits it, but the analysis lists it | holds |
| Licenses show citizenship by Jul 1, 2027 | vote dates | [Senate summary](https://flsenate.gov/Committees/BillSummaries/2026/html/991): "by July 1, 2027 … include the person's citizenship status" (new issuance or renewal) | holds, but the title is imprecise (finding 27) |
| SemDems meetings Thu Nov 12 and Thu Dec 10, 7 to 9 pm, Altamonte Springs; Dec at a different address | events | [Florida Dems calendar](https://events.floridadems.org/org/seminole-county-democrats): 624 Bills Ln (Nov) and 830 Magnolia Dr (Dec) | holds |
| Three statewide amendments on Nov 3 | newsletter archive | [FOX 35](https://www.fox35orlando.com/news/florida-voter-guide-proposed-amendment); [CBS12](https://cbs12.com/news/florida/florida-november-ballot-3-proposed-constitutional-amendments-heres-what-they-do-homestead-exemptions-budget-stabilization-fund-rainy-day-fund-agricultural-property-taxes-voters-need-to-know) | holds |
| SunRail runs weekdays only | issues, Reel, events | [SunRail help page](https://sunrail.com/help-center/support/maps-schedules/how-often-does-sunrail-run/) | holds |
| Celery City by about 1900 | About game | [UCF RICHES](https://richesmi.cah.ucf.edu/omeka/exhibits/show/origins_of_the_celery_city/the_early_years/citrus): "as early as 1900" | holds |
| Dues $20, paid in January "(or when you join)"; non-voting for "money or citizenship status"; voting members include high-school students | join, home, About | [ActBlue ydscdues](https://secure.actblue.com/donate/ydscdues): "unless a member joins later in the year"; "cannot pay dues for any reason, such as citizenship status, financial hardship"; **contributor attestations include "I am at least eighteen years old"** | holds, but leads to finding 2 |
| "It has hosted a musical theatre night in Oviedo to raise money for LGBTQ+ youth" | home proof strip, About, issues | [ActBlue ydscmusicaltheatre](https://secure.actblue.com/donate/ydscmusicaltheatre): a ticket page, "15 June", no year, "Imagine Performing Arts Center (located in the Ovideo Mall)", proceeds to "a local charity that supports our LGBTQ+ youth" | overstated (finding 15) |
| What-we-do "straight from the chapter's own ActBlue page" | About | [ActBlue youngsemdems](https://secure.actblue.com/donate/youngsemdems): "increasing young voter turnout", "advocating for issues that affect young people", "supporting democratic candidates in Seminole County" | paraphrase presented as a quote (finding 28) |

---

## Per-page scores (copy, facts and Spanish lens)

90 or more means it would beat the best benchmark on this lens.

| Page | EN | ES | One line |
|---|---|---|---|
| Home `index.html` | 84 | 74 | Voice and facts are excellent. Filler headings ("The next thing to do"), the tentpole's name drift and three clumsy Spanish lines in the lead mail-ballot and debrief blocks hold it back. |
| Events list | 80 | 74 | Real SemDems listings are verified. Series naming is chaotic, Seminole Sunday is missing from its own shelf, and the Spanish has a subjunctive slip. |
| Event pages (17) | 85 | 79 | Best long-form copy on the site (trivia, renew-ready, text bank). The under-14 message talks about membership on an RSVP, and the Spanish success state mixes verbs. |
| Host kit | 76 | 70 | Great structure. The flagship invite text ships "at 7 pm, A library meeting room", the perks contradict Home, and the Spanish has "propónla". |
| Vote | 86 | 82 | Dense, sourced, precise. Two ruling-00 slips (the step summary and the CONFIRMED badge) keep it below 90. |
| Issues | 88 | 74 | Excellent receipts. The Spanish keeps English glosses in the source lines and mixes "mail ballot" hyphenation. |
| Reel `clips.html` | 81 | 77 | Captions honest and bilingual. An unlabeled 3-day review promise, and "Open Mic" collides with the event series. |
| Post | 80 | 77 | Clear steps. The same 3-day promise appears again, unlabeled. |
| Quiz + 30 result pages | 84 | 64 | EN questions are fun and specific. The ES show-up type names fail as identities, and one answer breaks agreement ("Terminan"). |
| Join | 80 | 75 | Warm and quick. The dues path for under-18s hits ActBlue's 18+ attestation, "Latine" is used, and "hostelería" is a Spain-ism. |
| Newsletter | 90 | 85 | The voice reference done right. Small mismatch between the preview question and the actual question. |
| About | 78 | 66 | Real-or-DEMO is a great device. "Written by hand" / "escrito a mano" is false and broken, and a paraphrase is labelled "straight from". |
| Legal (5) | 80 | 76 | Plain and humane. The teen policy allows alcohol in a "separate, ID-checked area", which contradicts "alcohol-free, always". |
| 404 | 86 | 84 | Charming. "0 of 10 stickers" next to the site's 15-sticker book is a small confusion. |
| Offline | 82 | 82 | Fine. "Forms won't send until then" is odd on a demo where forms never send. |

---

## Findings

Ids are `copy-facts-NN`. Each one gives the current text, the proposed text and the files to edit. Spanish twins come only from `node tools/make_es.js`; quiz pages from `tools/make_quiz_pages.js`; event pages from `tools/make_event_pages.js`; slices from `node tools/slice_data.js --all`.

### Blocking

**copy-facts-01: The vote step summary drops ruling 00's hedge (EN and ES).**

- Where: vote.html, "How do you want to vote?", step 2 summary. Screenshot: `CF2/shots/vote-step2-en.png`.
- Current EN: "Requests made before Nov 3, 2026 end Dec 31. One new request covers 2027 and 2028."
- Current ES: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencen el 31 de diciembre. Una nueva te cubre en 2027 y 2028."
- Why it matters:
  - Ruling 00 says a request made after Nov 3 "should run through 2028", that Seminole hasn't said how it handles Nov 4 to Dec 31 requests, and requires the shape "…you should be set through 2028. Check My Voter Record to be sure."
  - The same page's own "Why does it end?" block hedges correctly. This summary is the line most people read.
- Proposed EN: "Requests made before Nov 3, 2026 end Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure."
- Proposed ES: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencen el 31 de diciembre. Pídela otra vez y deberías quedar cubierto hasta 2028. Revisa My Voter Record (tu registro de votante) para confirmarlo."
- Files: `data/civic.js` (line 1768, step `renew-mail-ballot` summary), `data/slices/vote.js` (regenerate), `es/vote.html` (make_es).

**copy-facts-02: Under-18 members are sent to an ActBlue dues form that makes them attest they are 18 or older.**

- Where: join.html "Voting member" tier, index.html tier cards, About "Who can vote in chapter elections?". Evidence: `CF2/shots/join-dues-en.png`, `CF2/flows/join2-en-16.txt` (line 234: "Pay dues on ActBlue" still shows after a 16-year-old joins, while "Chip in $5" is correctly hidden).
- Current EN:
  - "Voting members pay dues and live in Seminole County or go to school here (high school, college or university)." followed by [Pay dues on ActBlue].
  - About: "you're 14 to 39, you pay the $20 yearly dues, and you live in Seminole County or go to an accredited high school or college here."
- Why it matters:
  - The ActBlue dues page's contributor rules read "I am a U.S. citizen or lawfully admitted permanent resident" and "I am at least eighteen years old."
  - The copy explicitly invites high schoolers to become voting members through that button. A 14 to 17-year-old who follows it must make a false attestation on a political contribution form.
  - That is a legal and trust risk for the chapter, and it goes against the site's own teen policy ("We never aim donation asks at members under 18").
- Proposed EN, under the dues button: "ActBlue asks everyone who pays to confirm they're 18 or older and a U.S. citizen or green-card holder. Under 18, or can't confirm that? Join free now, and ask us about other ways to pay dues."
- Also: for a member the site knows is under 18 (`member.age < 18`), swap the button for "Ask about paying dues" (link to join.html?intent=role), as joinform.js already does for "Chip in $5".
- Proposed ES: "ActBlue pide que quien paga confirme que tiene 18 años o más y que es ciudadano o residente permanente de EE. UU. ¿Tienes menos de 18 o no puedes confirmarlo? Únete gratis ahora y pregúntanos por otras formas de pagar la cuota."
- Files: `data/strings.js` (membership tier copy, around lines 1630 to 1640), `data/pages/join.js` (`tier2.*`), `data/pages/home.js` (`tier2.*`), `data/pages/about.js` (chapter-elections answer), `assets/js/joinform.js` (hide or swap the dues CTA for known minors), `join.html`, `index.html`, es twins.

**copy-facts-03: "The Spanish is written by hand" is misleading, and "escrito a mano" means handwritten.**

- Where: About, "What's real?" > "Not decided yet". Screenshots: `CF2/shots/about-written-by-hand-en.png`, `CF2/shots/about-escrito-a-mano-es.png`.
- Current EN: "The Spanish is written by hand and still waiting for a fluent reviewer."
- Current ES: "El español está escrito a mano y todavía espera la revisión de una persona hablante nativa."
- Why it matters:
  - This card exists to be scrupulously honest. The Spanish was drafted in this build, not by a human translator, and HANDOFF says it "has not had a human review."
  - In Spanish the line literally claims the text was handwritten with a pen. A Spanish-speaking reviewer will read it as a joke or a machine slip, on the one card meant to build trust.
- Proposed EN: "The Spanish is a draft. No fluent speaker has reviewed it yet."
- Proposed ES: "El español es un borrador. Todavía no lo ha revisado una persona que lo hable con fluidez."
- Files: `data/pages/about.js` (`n.4`), `data/slices/about.js`, `es/about.html`.

**copy-facts-04: A "CONFIRMED" badge sits over Lake Mary and Altamonte Springs, which ruling 00 says must read "expected".**

- Where: vote.html Key dates, the Oct 4, 2027 tile (and its "Show all 17 dates" siblings for Oct 21 and Nov 2). Screenshot: `CF2/shots/vote-oct4-confirmed.png`.
- Current: badge "CONFIRMED", chip "FOR: OVIEDO, LAKE MARY, ALTAMONTE SPRINGS", then "Computed from Florida's 29-day registration rule. Confirm with the Supervisor of Elections. The Oviedo election is confirmed. Lake Mary and Altamonte Springs are expected."
- Why it matters:
  - Ruling 00: "Lake Mary and Altamonte Springs are likely; label them 'expected'". It allows these dates "only with these labels".
  - The biggest label on the tile says the opposite, and the date itself is computed, not confirmed by the SOE.
- Proposed: badge "COMPUTED" (ES "CALCULADA"), chip "FOR: OVIEDO · EXPECTED: LAKE MARY, ALTAMONTE SPRINGS" (ES "PARA: OVIEDO · PREVISTAS: LAKE MARY, ALTAMONTE SPRINGS"), and keep the two notes.
  - Alternative: split into two tiles, Oviedo (computed) and Lake Mary/Altamonte (expected).
- Files: `data/civic.js` (`city-2027-reg-deadline`, `city-2027-mail-deadline` status and scope), `assets/js/pages/vote.js` (badge for computed/expected), `data/pages/vote.js` (badge labels), `data/slices/vote.js`, `es/vote.html`.

**copy-facts-05: Spanish meta and share texts name the club "los jóvenes demócratas del condado de Seminole".**

- Where:
  - es/index.html `<meta description>` and OG
  - es/join.html OG
  - es/about.html OG
  - share texts in `data/strings.js` (lines 856, 1012, 1271, 1282)
- Current ES:
  - "Únete a los jóvenes demócratas del condado de Seminole. Toma menos de un minuto…" (join OG)
  - "Me uno a los jóvenes demócratas del condado de Seminole…" (share)
  - "Los jóvenes demócratas del condado de Seminole, de 14 a 39 años…" (home OG)
- Why it matters:
  - Ruling 00 (Conventions): "In Spanish, the brand takes the article: 'los Young Dems' ('Únete a los Young Dems'). Use the full name 'Young Democrats of Seminole County' untranslated."
  - BRIEF §1.3 bans the translated name "as if it were the name". These are exactly the share previews people see in WhatsApp.
- Proposed ES:
  - "Únete a los Young Dems del condado de Seminole. Toma menos de un minuto y nadie espera que lo sepas todo el primer día."
  - "Me uno a los Young Dems del condado de Seminole. Menos de un minuto, ven como eres y trae a alguien. {link}"
  - "Los Young Dems del condado de Seminole, de 14 a 39 años. Reuniones, ayuda para votar que se entiende y un lugar guardado para ti."
  - Descriptive uses can stay, but only after the brand: "¿Ya viste a los Young Dems? Son los jóvenes demócratas del condado de Seminole…"
- Files: `data/strings.js` (lines 266, 856, 1012, 1271, 1282, 1386, 1391, 1405, 1506), `data/slices/core.js`, es twins (make_es), OG images (`tools/make_og.js`) if the OG card text uses them.

### Major

**copy-facts-06: The Spanish show-up quiz names don't read as identities.**

- Where: es/quiz.html result, 6 static result pages, home quiz strip, share texts, cards. Screenshot: `CF2/shots/quiz-from-es.png`. Flows: `CF2/flows/quiz-es-show-up.txt`.
- Current ES:
  - "Conoce a Medio Mundo" (The Plus-One)
  - "Toc, Toc" (Door-Knock Natural)
  - "Luces, Cámara, Acción" (Creator)
  - "Magia en Celdas" (Spreadsheet Witch)
  - "La Chispa" (Hype Captain)
  - the quiz title "¿Cuál es tu modo de organizar?"
  - rendered examples: "Kira sacó Conoce a Medio Mundo. Te toca…" and "Toc, Toc, con Conoce a Medio Mundo de fondo"
- Why it matters:
  - "Conoce a Medio Mundo" is an imperative ("Go meet half the world"). As a giant H1 above a button that also starts with "Conoce los 6 modos", it reads like another call to action.
  - The forms are mixed (imperative, interjection, phrase, noun) and use English Title Case, which Spanish doesn't. The EN names are all "The X".
  - "¿Cuál es tu modo de organizar?" is heavier and more political than "How do you show up?"
  - This is the most shareable object on the site; Kira's virality bar starts here.
- Proposed ES:
  - quiz title: "¿Cómo te sumas tú?"
  - names, all article plus noun in sentence case:
    - La Chispa (keep)
    - El Puente (Plus-One: the one who connects people)
    - La Puerta Abierta (Door-Knock Natural)
    - La Cámara (Creator)
    - La Bruja del Excel (Spreadsheet Witch, a playful, recognizable phrase in LatAm)
    - El Chat Central (Group-Chat General)
  - Rendered examples become "Kira sacó El Puente. Te toca: 8 preguntas, más o menos un minuto." and "La Puerta Abierta, con un toque de El Puente".
  - Also sentence-case the issue identities: "Ojo al alquiler", "Sombrita, por favor", "Ven como eres", "Boleta lista".
- Files: `data/quiz.js` (type names around line 768, `ui` title), `data/pages/home.js` (`quiz.t1` to `quiz.t3`), `data/sharekit.js` (line 1081 list), `data/pages/quiz.js`, `tools/make_quiz_pages.js`, then regenerate `quiz/**`, `es/quiz/**` and OG (`tools/make_og.js`).

**copy-facts-07: Spanish grammar and spelling slips that a native reader stops on.**

| Where | Current | Proposed |
|---|---|---|
| es/events.html share band | "¿Conoces a alguien que necesita plan para el jueves?" | "¿Conoces a alguien que necesite un plan para el jueves?" (subjunctive after an indefinite antecedent) |
| es quiz Q3, answer after "Tú…" | "Terminan conversando 20 minutos" | "Terminas conversando 20 minutos" |
| es/host.html plan, twice | "Elígela y propónla" / "Propónla con el botón de abajo" | "Elígela y proponla" / "Proponla con el botón de abajo" (no accent: propón + la is a palabra llana) |
| es/host.html checklist counter | "0 de 10 listas" (reads as "lists") | "0 de 10 hechas" |
| es RSVP success | "¿Quieres que cuente cuando vengan tus amigos?" (ambiguous: count or tell) | "¿Quieres que te den crédito cuando vengan tus amistades?" |
| es/join.html sticker rule | "Cualquier 10, en cualquier orden. Los descansos nunca reinician esta." | "Las 10 que sean, en cualquier orden. Tomarte un descanso nunca reinicia el conteo." |
| es sticker name | "Le atinó" | "Le atinaste" (second person like the other rules) |

- Evidence: `CF2/shots/events-subj-es.png`, `CF2/shots/host-proponla-es.png`, `CF2/flows/quiz-es-show-up.txt`, `CF2/flows/rsvp2-es-22.txt`.
- Files: `data/pages/events.js` (`share.title`), `data/quiz.js` (line 533), `data/pages/host.js` (`plan.1.*`, checklist count), `data/events.js` (RSVP join-invite strings), `data/levels.js` (sticker rules and names), slices, es twins.

**copy-facts-08: The tentpole event has 2 English and 3 Spanish names, sometimes on one card.**

- Where: home "You're invited" band, events.html tentpole band and card, event page. Screenshots: `CF2/shots/home-tentpole-en.png`, `CF2/shots/home-tentpole-es.png`.
- Current EN: art "Renew-Ready Party", card title "Renew-ready party", card eyebrow "RENEW-READY", series shelf "Renew-Ready Party".
- Current ES: art "Fiesta lista para renovar" (literally "a party that is ready to renew"), title "Fiesta para dejar lista tu renovación", eyebrow "LISTA PARA RENOVAR".
- Proposed:
  - EN: one name everywhere, "Renew-Ready Party" (series) with the card title "Renew-Ready Party", or sentence case everywhere.
  - ES: one name everywhere, "Fiesta para renovar tu boleta" (eyebrow "RENOVAR BOLETA").
- Files: `data/events.js` (series `renew-ready` line 350, event title and kicker for `renew-ready-party`), `data/quiz.js` (line 206), `tools/make_event_pages.js` output, slices, es twins.

**copy-facts-09: In Spanish, "grupo" means three different things.**

- Where:
  - chapter: "Cada tarjeta dice DEMO hasta que el grupo la apruebe" (cards) and "Ejemplos que el grupo todavía no aprueba" (join perks)
  - crew: "Encuentra tu grupo (DEMO)", "Grupo de estudiantes"
  - group chat: every "Mándalo al grupo"
  - Elsewhere the chapter is "el capítulo" ("El capítulo todavía no la aprueba", footer).
- Why it matters: "the group hasn't approved it" next to "find your group" next to "send it to the group" is genuinely confusing, and BRIEF §2.4 asks for one term per thing.
- Proposed: chapter = "el capítulo" everywhere ("Cada tarjeta dice DEMO hasta que el capítulo la apruebe"); crew = "crew" or "círculo" ("Encuentra tu círculo (DEMO)", "Círculo de estudiantes"); group chat = "el chat del grupo" ("Mándalo al chat del grupo").
- Files: `data/sharekit.js` (line 335 `demoNote`), `data/levels.js` (line 100 `rulesPerksNote`), `data/pages/join.js` (crews), `data/pages/about.js` (crews), `data/strings.js` (share button ES), slices, es twins.

**copy-facts-10: The site gives two conflicting timings for its own lead action (renew now, or in January).**

- Where:
  - home and vote: "Add the January reminder"; .ics title "Renew my mail-ballot request" on Mon, Jan 4
  - events: the Dec 13 "Renew-ready party" helps people "ask for your mail ballot again on the official site" in December
  - issues: "(DEMO) January renewal nights"
- Why it matters: someone who renews at the Dec 13 party gets a Jan 4 calendar alert telling them to renew again. The site never states the simple rule ruling 00 supports.
- Current .ics: title "Renew my mail-ballot request"; description "Requests made before Nov 3, 2026 ended Dec 31. Renew online…"
- Proposed .ics title: "Check or renew my mail-ballot request" (ES "Revisar o renovar mi solicitud de boleta por correo").
- Proposed .ics description, prepended: "Already asked again in Nov or Dec? Look yourself up on My Voter Record and make sure it shows. Haven't yet? Renew now: …"
- Proposed lead card sub-line (home, vote): "Ask now or in January. Either way, check My Voter Record in January."
- Files: `data/civic.js` (`na-renew-reminder-2026` calendar, short), `data/pages/home.js` (`mail.*`), `data/pages/vote.js`, `data/issues.js` (voting-rights "What we're doing"), slices, es twins.

**copy-facts-11: The perk ladder contradicts itself between Home and the host kit.**

- Where: home Drop 01 (`CF2/shots/home-drop-en.png`) and host.html "Hosts get the good stuff" (`CF2/shots/host-perks-en.png`).
- Current, Home: "The Young Dems tee: Bring 3 friends… The celery tote: Finish one volunteer shift. The county sticker sheet: Host a night."
- Current, host kit: "Hosting counts as a volunteer shift… Host a night and you unlock the Shift Done sticker and the celery tote from the next merch drop (DEMO perk)."
- Also the host kit says "Hosts get first pick of seats at the next Seminole Sunday", while Join says "The Long Game: First pick of seats at the next big night."
- Why it matters: perks are the one place where precise wording protects the chapter (52 U.S.C. 10307(c) framing), and counsel will review one ladder, not two.
- Proposed: pick one table and use it everywhere, e.g. "Host a night → the county sticker sheet. Finish a volunteer shift (a text bank, a door-knocking shift or a table) → the celery tote. Three friends join with your link → the tee."
  - Host kit line: "Host a night and you unlock the county sticker sheet from the next drop (DEMO perk). Hosting also counts toward Shift Done."
- Files: `data/pages/home.js` (`drop1.*`), `data/pages/host.js` (`perks.*`), `data/levels.js` (perks), slices, es twins.

**copy-facts-12: Unlabeled service promises that About says we don't make.**

- Where:
  - post.html hero ("A person on our team checks every clip before it goes public, usually within 3 days", `CF2/shots/post-3days-en.png`)
  - Reel "How the Reel works" ("Usually within 3 days")
  - the post success state ("…usually within 3 days")
  - host access note ("Need something else, like a ride or ASL? Tell us when you RSVP and we will plan around it.")
  - es taller page ("Hay interpretación al inglés si la pides al confirmar.")
- Why it matters:
  - About: "Who moderates clips … We don't promise any of it until the chapter does."
  - BRIEF §9 lists "promises of … rides or ASL unless the chapter confirms" under claims to avoid ("tell us and we'll do our best").
  - The host kit already labels its own promise "(DEMO promise)".
- Proposed:
  - "A person on our team checks every clip before it goes public (review time: DEMO, set by the chapter)."
  - "Usually within 3 days (DEMO promise)."
  - "Need something else, like a ride or ASL? Tell us when you RSVP and we'll do our best."
  - ES: "Si necesitas interpretación al inglés, pídela al confirmar y haremos lo posible."
- Files: `data/pages/clips.js` (`post.sub`, `rules.check.body`), `data/strings.js` (line 720), `data/legal.js` (line 741), `data/pages/host.js` (`texts.5`), `data/events.js` (`taller-votar-2027` language note), slices, es twins.

**copy-facts-13: The host kit's flagship invite text ships a broken sentence and clashes with the chapter's own trivia night.**

- Where: host.html "Invite texts that sound like you". Screenshot: `CF2/shots/host-invite-text-en.png`.
- Current, before any input: "I'm hosting Study night on Thu, Nov 19 at 7 pm, A library meeting room in Oviedo. It's free and I need at least one familiar face. Come with? (DEMO event)" (the group-chat and reminder texts repeat ", A library meeting room").
- Why it matters:
  - Capital "A" mid-sentence, and no "at" before the place.
  - The sample slot is the same night and hour as the site's own Trivia night (Thu, Nov 19, 7 pm), so the kit's own example breaks its rule of not competing.
  - This is the text people paste into group chats.
- Proposed sample: night "a study night", place "a library meeting room", date Tue, Nov 24.
- Proposed templates:
  - "I'm hosting {night} on {date} at {time}, at {place} in {city}. It's free and I'd love one familiar face. Come with? (DEMO event) {link}"
  - Group chat: "{night}: {date}, {time}, at {place} in {city}…"
  - ES "Una sala de la biblioteca" becomes "una sala de la biblioteca", with "en {place}".
- Files: `data/pages/host.js` (`cards.placePh`, `cards.samplePlace`, `texts.1` to `texts.3`, sample date), `assets/js/pages/host.js` (sample defaults), es twin.

**copy-facts-14: "Open Mic" names two different things, and series labels drift card to card.**

- Where: events.html cards and shelf, event pages, Reel formats, home Reel strip.
- Current:
  - Event series "Open Mic: 3 Minutes, Your Take" (card badge "OPEN MIC LIVE", eyebrow "OPEN MIC", title "Open mic: 3 minutes, your take").
  - Reel format "Open Mic": "Your take, 60 seconds, filmed vertical."
  - Trivia cards: one says "TRIVIA NIGHT" and the next "TRIVIA THURSDAY" for the same series.
  - "Seminole in 60" is both a Reel format and "Seminole in 60: Creator Night".
  - ES mirrors all of this ("Micrófono abierto" for both).
- Why it matters: a friend who taps "Open Mic" in the Reel expecting the Saturday night gets a 60-second clip format. Series names are meant to be ownable brands (genz-brand-27), and three spellings of each undo that.
- Proposed:
  - Rename the Reel format "Your Take (60s)" (ES "Tu opinión en 60").
  - Keep "Open Mic" for the live night, with one card badge "OPEN MIC" and one title "Open Mic: 3 minutes, your take".
  - Every card eyebrow uses the series `short` name: "TRIVIA THURSDAY", "OPEN MIC", "CREATOR NIGHT", "HEADS-UP TUESDAY", "SEMINOLE SUNDAY".
- Files: `data/events.js` (series `short`, event `kicker` fields), `data/clips.js` and `data/pages/clips.js` (format names), `data/pages/home.js` (reel chips), `assets/js/eventcard.js` (eyebrow source), slices, event pages, es twins.

**copy-facts-15: The "REAL · NO DEMO IN THIS ONE" proof overstates its source.**

- Where: home "This chapter is real." (and the same claim on About and Issues).
- Current EN: "It has hosted a musical theatre night in Oviedo to raise money for LGBTQ+ youth." with "All three checked Tue, Nov 10, 2026." About says the same facts were "Checked … on Nov 9, 2026."
- Current ES: "Organizó una noche de teatro musical en Oviedo para recaudar fondos para jóvenes LGBTQ+."
- Why it matters:
  - The source is a ticket page for a revue "on 15 June" with no year. It proves the event was planned and ticketed, not that it took place.
  - The money went to "a local charity that supports our LGBTQ+ youth", not to young people directly.
  - On the one strip that promises zero demo, every word has to match the source, and the check date should match About's.
- Proposed EN: "It put on a musical theatre revue at the Oviedo Mall, with proceeds going to a local charity that supports LGBTQ+ youth."
- Proposed ES: "Organizó una revista de teatro musical en el Oviedo Mall, con lo recaudado para una organización local que apoya a jóvenes LGBTQ+."
- Use one date: "Checked Nov 10, 2026."
- Files: `data/pages/home.js` (`real.p3`, `real.checked`), `data/pages/about.js` (`proof.body`, checked line), `data/issues.js` (lines 547, 578), slices, es twins.

**copy-facts-16: The Seminole Sunday tentpole is missing from "Find your night", and its January and February dates show while "January's lineup" is locked.**

- Where: events.html, the tentpole band vs. the shelf vs. the drop.
- Current:
  - Band: "One big Sunday a month, 2 to 4 pm (DEMO) · Sun, Jan 24 · Oviedo, Sun, Feb 21 · Longwood"
  - Lineup: "10 more nights, locked / January's lineup drops Tue, Dec 15 at noon (DEMO)"
  - The shelf lists "Renew-Ready Party · 1 date" and "Big Tree Picnic Club · 1 date", but no "Seminole Sunday · 3 dates".
- Why it matters: the tentpole is the recurring brand. Leaving it off its own "same name, new crowd" shelf, while publishing two of the "locked" dates, makes the drop look arbitrary.
- Proposed:
  - Add the shelf card "Seminole Sunday · 3 dates · One big free Sunday a month, a different park each time. Next: Sun, Dec 13".
  - Band line: "Next: Sun, Dec 13 · Winter Springs. January and February parks drop Tue, Dec 15 at noon (DEMO)." Or keep the dates and say "(dates set, details drop Dec 15)".
- Files: `data/events.js` (tentpole and series shelf membership), `assets/js/pages/events.js` (shelf builder and tentpole line), `data/pages/events.js`, slices, es twin.

**copy-facts-17: Three clumsy Spanish lines in Home's two most serious blocks.**

- Where: es/index.html, the countdown pin and the debrief. Screenshots: `CF2/shots/home-countdown-es.png`, `CF2/shots/home-debrief-es.png`.

| Current | Proposed |
|---|---|
| "51 días / hasta el jue. 31 de dic., cuando vencen las de antes del 3 de nov." ("las de antes" has no noun) | "51 días / para que venzan, el jue. 31 de dic., las solicitudes hechas antes del 3 de nov." (the vote page's wording) |
| "Si te sientes con cansancio, es válido." | "Si sientes cansancio, es normal." |
| "La programación de enero sale el mar. 15 de dic. a las 12 p. m. (DEMO)" | "…sale el mar. 15 de dic. al mediodía (DEMO)" (EN says "at noon"; "12 p. m." is ambiguous to many readers) |

- Files: `data/pages/home.js` (`mail.until`, `debrief.p2`), `data/events.js` or `data/strings.js` (drop line, used on several pages), slices, es twins.

**copy-facts-18: English source glosses and dates are left on Spanish pages.**

- Where: es/issues.html (about 20 source lines), es/quiz/issue/*.html, es/privacy.html, es/teen-safety.html, es/conduct.html. Evidence: `CF2/dump/es__issues.txt` lines 96, 124, 146, 176, 227, 289, 424, 472, 488, 500.
- Current ES:
  - "WFSU Public Media, report on the governor signing the worker wage and heat protection preemption bills (Apr 12, 2024)"
  - "St. Johns River Water Management District, 'Work continues…' (undated, read Nov 9, 2026)"
  - "U.S. Census Bureau, American Community Survey 2024 1-year, tables B25003 and B25077 (via Census Reporter profile)"
  - "Plausible custom query parameters (keeps ref, source and utm_*)"
- Why it matters: §0.8 says "no English left". Original-language titles of English sources can stay; the descriptive glosses, dates and "via" notes are site copy and must be Spanish. `make_es --check` passes only because source lines are exempt.
- Proposed ES:
  - "WFSU Public Media, nota sobre la firma de las leyes que impiden normas locales de salario y de protección contra el calor (12 de abril de 2024)"
  - "St. Johns River Water Management District, 'Work continues in the journey to restore Lake Jesup' (sin fecha; leído el 9 de nov. de 2026)"
  - "…tablas B25003 y B25077 (vía el perfil de Census Reporter)"
- Files: `data/issues.js` (sources: add `es` glosses), `data/legal.js` (source labels), `assets/js/pages/issues.js` and `assets/js/pages/legal.js` if the gloss is built in code, slices, es twins.

### Minor

**copy-facts-19: Filler and repeated headings on Home.**

| Current | Proposed |
|---|---|
| eyebrow "DO ONE THING" + H2 "The next thing to do" (says the same thing twice) | eyebrow "DO ONE THING" + H2 "Two dates. Five minutes." (ES "Dos fechas. Cinco minutos.") |
| H2 "Send it to the group chat" over the card maker (the same words as the share button on every page) | "Make the card your group chat actually opens." (ES "Haz la tarjeta que tu grupo sí va a abrir.") |
| "REAL · NO DEMO IN THIS ONE" then, two sections later, "The real scoreboard: no demo numbers in this one" | keep the first; second becomes "The real scoreboard" |
| "1 in 3+ / Seminole voters are 18 to 40" (Issues shows 36.8% for the same number) | "More than 1 in 3" (ES "Más de 1 de cada 3") |

- Files: `data/pages/home.js` (`pins.title`, maker heading, `score.*`), slice, es twin.

**copy-facts-20: The under-14 RSVP message talks about membership, and thanks twice with an exclamation mark.**

- Where: any event RSVP with age 12. Evidence: `CF2/flows/rsvp-under14.txt`.
- Current EN: "Thanks for wanting to come / … Thanks for your interest! Members need to be at least 14. We didn't save anything you typed."
- Proposed EN: "You're a little early / Our events are for ages 14 and up, so we didn't save anything you typed. Everything on this site is still yours to read, and we'll save you a seat at 14."
- Proposed ES: "Llegaste un poco antes / Nuestros eventos son desde los 14 años, así que no guardamos nada de lo que escribiste. Puedes seguir leyendo todo el sitio, y a los 14 te guardamos un lugar."
- Keep the join-page version about membership.
- Files: `data/legal.js` (`snippets.ageTooYoung`, add an event variant), `assets/js/rsvp.js` (use the event variant), `data/strings.js` mirror.

**copy-facts-21: RSVP microcopy breaks BRIEF's ready lines and repeats itself.**

- The error reads "That email doesn't look right. Check for a missing @ or a typo." BRIEF §2.7 line 16 is "That email's missing an @. Happens to everyone. Try once more?", and the newsletter already uses it. Use the BRIEF line wherever the @ is missing, and keep "doesn't look right" for other typos.
- The success sheet shows "Add it to your calendar so future you remembers too." twice, plus the same line in the toast (`CF2/flows/rsvp2-en-22.txt`). Keep it once, in the ticket, and make the toast "Seat saved. See you there." (`toast.rsvpSaved` already exists).
- Spanish uses three verbs for one state: "LUGAR GUARDADO" (stamp), "Lugar reservado." (toast) and "38 de 60 lugares apartados". Use "guardado" everywhere, to match the CTA "Guárdame un lugar".
- Files: `data/strings.js` (`error.email.invalid`, `success.rsvp.title`, `toast.rsvpSaved` ES), `data/events.js` (`rsvpDone`, `seats`), `assets/js/rsvp.js` (which line goes in the toast).

**copy-facts-22: "Latine" in the English crew name.**

- Where: join step two and About crews.
- Current: "Latine and Boricua crew". The Spanish is already "Grupo latino y boricua".
- Why it matters: report 05 §5 prefers "Latino/Latina/Hispanic" and flags "Latinx" (4% use, Pew 2024). "Latine" is even less known and reads as insider language to the Puerto Rican persona (P1).
- Proposed: "Latino and Boricua crew" (or "Latina, Latino and Boricua crew").
- Files: `data/pages/join.js` (line 220), `data/pages/about.js` (line 149), es twins.

**copy-facts-23: Spain-isms and gendered defaults in "neutral Latin American" Spanish.**

| Current | Proposed |
|---|---|
| "Servicio, tiendas y hostelería" (join, About crews) | "Restaurantes, tiendas y hoteles" |
| "La música y el altavoz" (quiz Q7) | "La música y la bocina" |
| "Marisol va a entrenar en Lake Mary al próximo grupo" | "va a capacitar" |
| "…pedir tu boleta por correo otra vez, tú mismo" (series blurb) | "…por tu cuenta" |
| "No estás solo" (host kit) | "No te dejamos sin apoyo" |
| "23 van (DEMO)" | "Van 23 (DEMO)" |

- Also: "Gafetes" is Mexico-specific; "etiquetas con tu nombre" travels better.
- Files: `data/pages/join.js`, `data/pages/about.js`, `data/quiz.js` (line 578), `data/newsletter.js`, `data/events.js` (series `renew-ready` blurb, `going` string), `data/pages/host.js`, slices, es twins.

**copy-facts-24: Spanish typography is inconsistent within single pages.**

- Weekday and month abbreviations appear both with and without periods on one screen: "sáb 14 de nov" vs "jue. 31 de dic." vs "mar. 15 de dic." (es/index). RAE abbreviations take the period: "sáb. 14 de nov." everywhere.
- Percent spacing differs: "34.3%" vs "54 %" (es/index). Pick one (RAE: "54 %") and apply it in the number formatter.
- "MIEMBRO DESDE NOV 2026" vs "MIEMBRO DESDE NOV. 2026" on the same join page.
- Quotes: «¿CUÁL ES TU MODO…?» on result pages vs “NOS VEMOS ALLÁ” in the quiz. Pick one.
- Files: `assets/js/ui.js` or the shared date and number formatter (`YSD.cal`/`YSD.ui` format helpers), `assets/js/membercard.js`, `tools/make_quiz_pages.js`, `data/quiz.js`.

**copy-facts-25: The official tool has three Spanish names.**

- Current: "Revisa tu registro de votante para confirmarlo" (home, Reel PSA); "Revisa My Voter Record para confirmarlo" (vote, newsletter); "My Voter Record (Mi registro de votante)" (step 1); "Buscar mi registro de votante" (button). The page people land on is titled in English.
- Proposed: first mention on each page "My Voter Record (tu registro de votante)", then "My Voter Record". The button stays "Buscar mi registro en My Voter Record".
- Files: `data/strings.js` (`nudge.mailBallot.text` ES), `data/civic.js`, `data/pages/home.js`, `data/clips.js` (captionI18n ES), `data/newsletter.js`.

**copy-facts-26: English typos and consistency slips.**

| Current | Proposed |
|---|---|
| "If anyone under 18 RSVPd" (host plan) | "RSVP'd" |
| "Who is riding next time?" (SunRail clip) | "Who's riding next time?" (contractions always, report 05 §6) |
| "so you know who is coming" (host) | "who's coming" |
| "mail ballot request" 13 times, "mail-ballot request" 16 times | hyphenate as a modifier everywhere ("mail-ballot request") |
| "musical theatre" ×3 | "musical theater" (American spelling, BRIEF §2.4), unless quoting the ActBlue title |
| "See our Privacy Policy" | "See our privacy policy" (sentence case, matches the footer "Privacy") |
| newsletter preview "Ask the Group Chat: 'I'm NPA. Is this group even for me?'" vs the question "I'm registered NPA. Is this group even for me?" | match them |
| "That's the reel for now" / "Watch the reel" | "That's the Reel for now" / "Watch the Reel" (it's the brand name) |
| "A chapter of the Florida Young Democrats. / FYD chapter list" | "Florida Young Democrats chapter list" (rule 6: no unexplained acronyms) |

- Files: `data/pages/host.js`, `data/clips.js`, `data/issues.js`, `data/civic.js`, `data/pages/home.js`, `data/pages/about.js`, `data/strings.js`, `data/newsletter.js`, `data/pages/clips.js`.

**copy-facts-27: The 2027 license tile title says something the bill doesn't.**

- Current: "Florida licenses and IDs start showing citizenship · Thu, Jul 1, 2027 · CONFIRMED".
- Why it matters: HB 991 says "by July 1, 2027, a driver license or Florida identification card, whether a new issuance or a renewal … must include the legal status". It is a deadline, and it covers new and renewed cards only, not every license.
- Proposed: "New and renewed Florida licenses must show citizenship by this date" (ES "Las licencias nuevas y renovadas de Florida deben indicar la ciudadanía a más tardar en esta fecha").
- Files: `data/civic.js` (`license-citizenship-2027` title), slice, es twin.

**copy-facts-28: About calls a paraphrase "straight from" the ActBlue page.**

- Current: "Three jobs. All local. Straight from the chapter's own ActBlue page." Then "From city halls to the statehouse, we help Democrats in Seminole County win, and we have a good time doing it."
- The source says "increasing young voter turnout", "advocating for issues that affect young people" and "supporting democratic candidates in Seminole County". "City halls to the statehouse" and "a good time" are ours.
- Proposed: "Three jobs. All local. Based on the chapter's own ActBlue page, which says YDSC is 'dedicated to increasing young voter turnout, advocating for issues that affect young people and supporting Democratic candidates in Seminole County.'" Or keep the paraphrase and say "In our words".
- Files: `data/pages/about.js` (`do.sub`, `do.3.*`), slice, es twin.

**copy-facts-29: The teen-safety draft allows alcohol that every public page rules out.**

- Current, teen-safety §05: "Events teens attend are alcohol-free or keep alcohol in a separate, ID-checked area."
- Events: "Every event is free, alcohol-free…". Host rules: "Alcohol-free. Always." Event pages: "All our events are alcohol-free."
- The policy content belongs to counsel. The contradiction is a copy problem, because a parent reads both.
- Proposed: "Our events are alcohol-free, always. Giving alcohol to anyone under 21 is a crime in Florida."
- Files: `data/legal.js` (teen-safety events section), es twin.

**copy-facts-30: Small number and label mismatches that make readers recount.**

- Vote: "Pick one and get your 3 steps." sits right above "Your private checklist: 0 of 8 done." Proposed: "Pick one and get your 3 steps, plus 5 good-to-knows. Tick them off as you go…"
- 404: "0 of 10 stickers found" on a site whose sticker book says "15 county stickers". Proposed: "0 of 10 laptop stickers found".
- Offline: "forms won't send until then" on a demo where forms never send. Proposed: "This page will load once you're back online."
- Events: "Free and open to everyone 14 and up" vs Home "Events are free and open to everyone, in any party or none" (BRIEF line 7). Proposed Home: "Events are free and open to everyone 14 and up, in any party or none."
- Files: `data/pages/vote.js` (`steps.sub`), `data/pages/about.js` or the 404 data (laptop counter), `data/strings.js` (offline), `data/pages/home.js` (`hero.note`), es twins.

---

## Checks that passed, for the record

- **DEMO labels:** every count ("23 going (DEMO)", "38 of 60 seats saved (DEMO)"), venue ("DEMO venue" / "Lugar DEMO"), person ("Dani from Casselberry (DEMO writer)"), crew, clip handle (@demo.*) and perk ("EXAMPLE PERK (DEMO)") carries DEMO in both languages. A scan of every "N going / N van / N seats" string found none unlabelled outside the styleguide.
- **Legal placeholders:** the footer's "Paid for by [committee name and address placeholder] DEMO" / "Pagado por [nombre y dirección del comité: pendiente] DEMO" and the not-official line are on all 101 pages. Policies say DRAFT and "not in effect" in both languages.
- **No candidate names** in any rendered text. The only hit is a source URL slug inside an `href` on the styleguide.
- **Ruling-00 required shapes:** the mail-ballot line and the student-ID line appear verbatim on home, vote, events, the Reel PSA, the newsletter and issues, in EN and ES. The only exception is finding 01.
- **Voice:** 1 exclamation mark (post success), 0 emoji, 0 banned words, plain words, "Rest counts too", "first time? perfect". The serious debrief stays serious.
- **Dates:** every weekday is correct. The countdowns read 51 (Dec 31), 33 (Dec 13) and 35 (Dec 15) on Nov 10. The 12-day and 29-day computations are right, including the legal-holiday shifts.
