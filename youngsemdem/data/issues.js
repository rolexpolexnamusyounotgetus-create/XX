/*!
 * Young Democrats of Seminole County (YDSC): issue cards.  window.YSD_DATA.issues
 *
 * Nine issue cards for young people in Seminole County, FL, in English and Spanish. Every fact
 * carries a source URL and the date it was checked. The quiz in data/quiz.js ("Find your issue")
 * maps its results to these ids, so keep ids stable.
 *
 * Content rules (docs/research/00 and 05): facts are sourced or absent; anything YDSC has not
 * confirmed it does is flagged demo:true AND says "(DEMO)" in the visible text; no politician is
 * shown as an endorser; no real business hosts a demo event; no Native American imagery or words.
 * Serious topics (tone: 'serious') get the calm template: no confetti, no emoji, no donate module.
 *
 * ---------------------------------------------------------------------------------------------
 * SCHEMA
 *
 * issues = {
 *   version, updated ('YYYY-MM-DD'), lang: ['en','es'],
 *   demo: false              file-level flag: the facts are real; demo bits are flagged one by one
 *   pages: { key: 'file.html' }   page map for every action/share link. Change a file name here once.
 *   esPrefix: 'es/'          Spanish pages live under es/ with the same file names (report 06 §8.1).
 *                            Spanish href = esPrefix + pages[key]. If es/ pages don't exist, use the
 *                            EN page with ?lang=es instead; the hashes are the same.
 *   anchors: { pageKey: [hash, ...] }  every hash this file links to, so page builders create them.
 *                            vote.html hashes are the step ids in data/civic.js (civic.steps[].id),
 *                            plus 'dates' for the election-dates list, so render each step with
 *                            id="<step.id>". issues.html hashes are the issue ids below.
 *   colors: { token: { role, onColor } }  colour token NAMES used below. This file defines no
 *                            colours: the site stylesheet defines each token as a CSS custom
 *                            property, var(--<token>), and pages use that. onColor = the token for
 *                            text on that fill. Token names a stylesheet must define for this file:
 *                              fills: orange, pink, violet, bubblegum, violet-deep, lime, sky, teal,
 *                                     celery
 *                              text:  ink, paper
 *                            data/team.js tokens{} has fallback values for orange, violet,
 *                            violet-deep, bubblegum, sky, teal, celery and ink. pink, lime and paper
 *                            are not defined anywhere yet; report 03 palette 2 ("Springs & Citrus")
 *                            proposes pink and lime, and with its values ink on pink is 5.47:1 and
 *                            ink on lime 14.52:1 (both pass AA). Recheck contrast once the
 *                            stylesheet sets them. The order below keeps similar hues apart.
 *   context: {               shared facts for the issues page header
 *     youngVoters: Fact,     why the page talks to independents
 *     ydsc: { text, source, sourceName, verified, demo:false }   what YDSC says it exists to do
 *   },
 *   items: [ Issue, ... ]    display order = array order
 * }
 *
 * Issue = {
 *   id            stable kebab id (quiz results and share URLs use it as #hash on issues.html)
 *   color, onColor  colour token for the card fill, and the token for text on it
 *   tone          'bright' | 'serious'
 *   title         {en, es}  emoji-free, sentence case
 *   short         {en, es}  2-4 words for quiz copy ("Rent + housing with a hint of transit")
 *   hook          {en, es}  one line, in voice (report 05)
 *   hookAfter?    { date: 'YYYY-MM-DD', en, es }  replaces hook on/after that date (time-bound hooks)
 *   facts         [Fact, ...]  2-3, Seminole or Central Florida first
 *   ydsc          [{ text {en,es}, demo: bool, source?, sourceName?, verified?, confidence? }]
 *                 "What YDSC does". demo:true items describe activities the chapter has NOT
 *                 confirmed; their text starts with "(DEMO)" in both languages. Hide demo items
 *                 when YSD_CONFIG.demo === false.
 *   action        Action  the one concrete next step (links into the site)
 *   moreActions   [Action, ...]  up to 2 more (the Issue Finder shows 3 actions per result)
 *   eventSeries   [series, ...]  data/events.js `series` ids that fit this issue (may be empty). Use
 *                 them to pick related event cards; events.html?series=<id> filters to one.
 *   share         { title {en,es}, text {en,es}, textAfter? {date,en,es}, page, hash }  group-chat
 *                 text, no URL inside; the share module appends it:
 *                 YSD.share.native({ title, text, url: YSD.share.url(href) })
 * }
 *
 * Fact = {
 *   id            stable id, referenced from quiz.js as '<issueId>.<factId>'
 *   text          {en, es}  the claim as it should read on the page
 *   stat?         { value: '$1,890', valueEs?, label {en,es} }  big-number treatment for cards; value is the
 *                 same in both languages unless it has words, then valueEs holds the Spanish ('51 días')
 *   source        URL of the source (open it to check the claim)
 *   sourceEs?     Spanish official page when one exists (most official sources are English-only;
 *                 voteseminole.gov uses a built-in translate widget rather than separate URLs)
 *   sourceName    human-readable citation (publisher, title, date)
 *   sources?      [{ url, name }]  extra sources when a claim rests on more than one
 *   verified      'YYYY-MM-DD'  when we last opened the source and checked the claim
 *   asOf          the data's own vintage ('2024', '2026-03-31', 'summer 2026')
 *   confidence    'high' | 'med'  (report 01 key: high = read in a primary source)
 *   computed?     true when the number is our arithmetic on the source; method says how
 *   method?       how it was computed
 *   note?         caveat for editors (not rendered)
 *   staleAfter?   'YYYY-MM-DD'  hide or rewrite the fact after this date
 * }
 *
 * Action = {
 *   type          'event' | 'vote' | 'share' | 'join' | 'clip' | 'quiz'
 *   label         {en, es}  button text, verb first, sentence case
 *   labelAfter?   { date: 'YYYY-MM-DD', en, es }  replaces label on/after that date
 *   page          key in pages;  hash? (no '#');  query? (no '?')
 *                 Events queries use data/events.js fields: 'series=<series>' (one repeatable
 *                 format, e.g. series=sunrail) or 'kind=<kind>' (social | learn | volunteer |
 *                 create). No query = all events.
 *   official?     dotted path in YSD_CONFIG for the official link to show next to the button,
 *                 e.g. 'links.vote.voteByMail' (read it with YSD.cfg(path))
 *   demo?         true when the destination is demo content (show the DEMO label)
 * }
 *
 * Spanish terms (same as data/civic.js and data/strings.js): "boleta por correo" for the mail
 * ballot and "solicitud de boleta por correo" for the request (Florida's Spanish form DS-DE 160
 * says "boleta de voto por correo"; we drop "de voto" for length); "voto por correo" only as the
 * name of the program or page; "inscripción" for voter registration; "identificación" for ID.
 *
 * Dates: calendar dates are 'YYYY-MM-DD' (no time, so no offset). Any date-time added later must
 * be ISO 8601 with the America/New_York offset, e.g. '2026-11-12T19:00:00-05:00'.
 *
 * LGBTQ+ Gallup fact added Tue, Nov 10, 2026 (round 1, genz-brand-24).
 * Checked: Mon, Nov 9, 2026 (content pass, then an independent re-check of every number and date
 * against the source files: SOE PDFs, Census Reporter API, NWS, OIR, EDR, MIT, bill texts).
 * Re-check every fact before launch and after each legislative session.
 * Corrections vs report 01: HB 1069 (2023) is Ch. 2023-105 per its Senate bill page, not 2023-245.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.issues = {
  version: 1,
  updated: '2026-11-09',
  lang: ['en', 'es'],
  demo: false,

  pages: {
    home: 'index.html',
    issues: 'issues.html',
    quiz: 'quiz.html',
    vote: 'vote.html',
    events: 'events.html',
    join: 'join.html',
    clips: 'clips.html',
    post: 'post.html'
  },
  esPrefix: 'es/',
  anchors: {
    issues: ['housing', 'heat', 'repro', 'lgbtq', 'schools', 'wages', 'transit', 'water', 'voting'],
    vote: ['register', 'check-registration', 'renew-mail-ballot', 'what-id', 'dates'],
    join: ['volunteer']
  },

  colors: {
    orange:        { role: 'issue fill (housing)', onColor: 'ink' },
    pink:          { role: 'issue fill (heat and insurance); no stylesheet defines it yet', onColor: 'ink' },
    violet:        { role: 'issue fill (reproductive freedom)', onColor: 'paper' },
    bubblegum:     { role: 'issue fill (LGBTQ+ freedom)', onColor: 'ink' },
    'violet-deep': { role: 'issue fill (schools and reading)', onColor: 'paper' },
    lime:          { role: 'issue fill (wages); no stylesheet defines it yet', onColor: 'ink' },
    sky:           { role: 'issue fill (transit)', onColor: 'ink' },
    teal:          { role: 'issue fill (water)', onColor: 'ink' },
    celery:        { role: 'issue fill (voting)', onColor: 'ink' }
  },

  context: {
    youngVoters: {
      id: 'young-voters',
      text: {
        en: 'Voters 18 to 40 are 36.8% of Seminole’s active voters (124,626 people). The biggest group among them isn’t Democrats or Republicans: it’s independents (no party affiliation), at 34.3%.',
        es: 'Los votantes de 18 a 40 años son el 36.8% del electorado activo de Seminole (124,626 personas). El grupo más grande entre ellos no son los demócratas ni los republicanos: son los independientes (sin afiliación partidista), con el 34.3%.'
      },
      stat: { value: '36.8%', label: { en: 'of Seminole voters are 18 to 40', es: 'del electorado de Seminole tiene de 18 a 40 años' } },
      source: 'https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf',
      sourceName: 'Seminole County Supervisor of Elections, District Demographic Analysis (active voters, July 1, 2026)',
      verified: '2026-11-09',
      asOf: '2026-07-01',
      confidence: 'high',
      computed: true,
      method: 'Sum of the AGE 18-25, 26-30, 31-35 and 36-40 rows: 124,626 of 338,692 total; NPA 42,710, Dem 40,696, Rep 34,200 of 124,626. The SOE bands end at 40; YDSC membership is 14 to 39.'
    },
    ydsc: {
      text: {
        en: 'YDSC says it’s dedicated to increasing young voter turnout, advocating for issues that affect young people and supporting Democratic candidates in Seminole County.',
        es: 'YDSC dice que se dedica a aumentar la participación de votantes jóvenes, defender los temas que afectan a la gente joven y apoyar a candidatos demócratas en el condado de Seminole.'
      },
      demo: false,
      source: 'https://secure.actblue.com/donate/youngsemdems',
      sourceName: 'Young Democrats of Seminole County, ActBlue page',
      verified: '2026-11-09',
      confidence: 'high'
    }
  },

  items: [
    // ------------------------------------------------------------------------------ housing
    {
      id: 'housing',
      color: 'orange',
      onColor: 'ink',
      tone: 'bright',
      title: { en: 'Rent and housing', es: 'Alquiler y vivienda' },
      short: { en: 'rent + housing', es: 'el alquiler' },
      hook: {
        en: 'Rent went up again? You’re not bad with money. The math here is just rough.',
        es: '¿Te subieron el alquiler otra vez? No es que manejes mal tu dinero. Es que aquí las cuentas no dan.'
      },
      facts: [
        {
          id: 'median-rent',
          text: {
            en: 'Median rent in Seminole County, utilities included, is $1,890 a month. That’s more than Florida’s $1,812.',
            es: 'El alquiler mediano en el condado de Seminole, con servicios incluidos, es de $1,890 al mes. Es más que el de Florida ($1,812).'
          },
          stat: { value: '$1,890', label: { en: 'median rent a month', es: 'alquiler mediano al mes' } },
          source: 'https://censusreporter.org/data/table/?table=B25064&geo_ids=05000US12117,04000US12&primary_geo_id=05000US12117',
          sourceName: 'U.S. Census Bureau, American Community Survey 2024 1-year, table B25064 Median Gross Rent (via Census Reporter)',
          verified: '2026-11-09',
          asOf: '2024',
          confidence: 'high',
          note: 'Margin of error ±$50 for Seminole, ±$9 for Florida. Gross rent = contract rent plus utilities.'
        },
        {
          id: 'rent-burden',
          text: {
            en: 'About 6 in 10 Seminole renters (60.9%) spend 30% or more of their income on rent and utilities. More than 1 in 4 (27.8%) spend half or more.',
            es: 'Cerca de 6 de cada 10 hogares que alquilan en Seminole (60.9%) destinan el 30% o más de sus ingresos al alquiler y los servicios. Más de 1 de cada 4 (27.8%) destina la mitad o más.'
          },
          stat: { value: '6 in 10', valueEs: '6 de cada 10', label: { en: 'renters pay 30%+ of income on rent', es: 'hogares que alquilan pagan 30%+ de su ingreso' } },
          source: 'https://censusreporter.org/data/table/?table=B25070&geo_ids=05000US12117,04000US12&primary_geo_id=05000US12117',
          sourceName: 'U.S. Census Bureau, American Community Survey 2024 1-year, table B25070 Gross Rent as a Percentage of Household Income (via Census Reporter)',
          verified: '2026-11-09',
          asOf: '2024',
          confidence: 'high',
          computed: true,
          method: 'Households paying 30-34.9%, 35-39.9%, 40-49.9% and 50%+ (38,869) divided by renter households with the share computed (66,716 total minus 2,856 not computed = 63,860). 50%+: 17,784 / 63,860. Florida for comparison: 62.1% and 32.1%.'
        },
        {
          id: 'renters-and-homes',
          text: {
            en: '34.9% of Seminole households rent. The median home is worth $424,600, above Florida’s $396,900.',
            es: 'El 34.9% de los hogares de Seminole alquila. La vivienda mediana vale $424,600, más que en Florida ($396,900).'
          },
          stat: { value: '$424,600', label: { en: 'median home value', es: 'valor mediano de una vivienda' } },
          source: 'https://censusreporter.org/profiles/05000US12117-seminole-county-fl/',
          sourceName: 'U.S. Census Bureau, American Community Survey 2024 1-year, tables B25003 and B25077 (via Census Reporter profile)',
          verified: '2026-11-09',
          asOf: '2024',
          confidence: 'high',
          computed: true,
          method: 'Renter share = 66,716 renter-occupied of 190,920 occupied units (B25003). Florida renter share: 32.0%.'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Renters’ nights: compare notes on what everyone pays (no names), learn which county and city meetings touch housing, and pick one to show up to together.',
            es: '(DEMO) Noches para inquilinos: comparamos cuánto paga cada quien (sin nombres), vemos qué reuniones del condado y de las ciudades tocan el tema de vivienda y elegimos una para ir en grupo.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A heads-up text when housing is on a Seminole County Commission agenda, with the time, the place and what’s being decided.',
            es: '(DEMO) Un mensaje de aviso cuando la vivienda esté en la agenda de la Comisión del Condado de Seminole, con la hora, el lugar y lo que se va a decidir.'
          },
          demo: true
        }
      ],
      action: {
        type: 'share',
        label: { en: 'Send this to a friend who rents', es: 'Mándaselo a alguien que alquila' },
        page: 'issues',
        hash: 'housing'
      },
      moreActions: [
        { type: 'event', label: { en: 'See what’s coming up', es: 'Mira lo que viene' }, page: 'events', demo: true },
        { type: 'join', label: { en: 'Join YDSC', es: 'Únete a YDSC' }, page: 'join' }
      ],
      eventSeries: ['mixer'],
      share: {
        title: { en: 'Rent in Seminole', es: 'El alquiler en Seminole' },
        text: {
          en: 'Median rent in Seminole is $1,890 a month, and 6 in 10 renters pay 30% or more of their income on it. It’s not just you. Come to a Young Dems night with me?',
          es: 'El alquiler mediano en Seminole es de $1,890 al mes, y 6 de cada 10 hogares que alquilan pagan el 30% o más de sus ingresos. No es solo cosa tuya. ¿Me acompañas a una noche de los Young Dems?'
        },
        page: 'issues',
        hash: 'housing'
      }
    },

    // ------------------------------------------------------------------- heat and insurance
    {
      id: 'heat',
      color: 'pink',
      onColor: 'ink',
      tone: 'bright',
      title: { en: 'Heat, storms and home insurance', es: 'Calor, tormentas y seguros de vivienda' },
      short: { en: 'heat + insurance', es: 'el calor y los seguros' },
      hook: {
        en: 'Record heat and $3,545-a-year home insurance. How Florida handles both is a choice, not the weather.',
        es: 'Calor récord y un seguro de vivienda de $3,545 al año. Cómo responde Florida a las dos cosas es una decisión, no el clima.'
      },
      facts: [
        {
          id: 'summer-2026',
          text: {
            en: 'Sanford’s summer 2026 averaged 84.1°F, tied for its 4th-hottest on record (records go back to 1948). Orlando had a record 51 days at 95°F or hotter.',
            es: 'El verano de 2026 en Sanford tuvo un promedio de 84.1 °F, empatado como el 4.º más caluroso desde 1948. Orlando tuvo un récord de 51 días a 95 °F o más.'
          },
          stat: { value: '51 days', valueEs: '51 días', label: { en: 'at 95°F+ in Orlando, summer 2026', es: 'a 95 °F o más en Orlando, verano de 2026' } },
          source: 'https://www.weather.gov/media/mlb/summary/AugSummer2026.pdf',
          sourceName: 'National Weather Service Melbourne, August 2026 and Summer 2026 Weather Summary, East Central Florida',
          verified: '2026-11-09',
          asOf: 'summer 2026',
          confidence: 'high',
          note: 'Page "Summer 2026 Average Temperature Statistics/Rankings". Sanford is 1.1°F above normal and ties 2024. Orlando was the 2nd-warmest summer on record (84.5°F); the previous 95°F-day record was 49 days in 1917. Do not use the August table (Sanford 84.4°F, 6th-warmest August): that is the month, not the season. "Record heat" in the hook rests on the Orlando 95°F-day record.'
        },
        {
          id: 'insurance-premium',
          text: {
            en: 'The average homeowners policy in Seminole costs $3,545 a year with wind coverage. For condo owners it’s $1,202.',
            es: 'La póliza promedio de seguro de vivienda en Seminole cuesta $3,545 al año con cobertura de viento. Para dueños de condominio, $1,202.'
          },
          stat: { value: '$3,545', label: { en: 'average home insurance a year', es: 'seguro de vivienda promedio al año' } },
          source: 'https://floir.gov/docs-sf/default-source/property-and-casualty/stability-unit-reports/july-2026-isu-report.pdf',
          sourceName: 'Florida Office of Insurance Regulation, Property Insurance Stability Report, July 1, 2026 (county averages as of March 31, 2026)',
          verified: '2026-11-09',
          asOf: '2026-03-31',
          confidence: 'high',
          note: 'Page 20, "Average Premiums Charged" (traditional policies, MIR data as of March 31, 2026). Without wind coverage: $2,372 (homeowners), $785 (condo). Orange County: $3,610. The same report says the average homeowners premium "decreased in 51 counties from the January report", so do NOT write that insurance is still rising: quote the level, not a trend.'
        },
        {
          id: 'heat-preemption',
          text: {
            en: 'A 2024 state law (HB 433) bars Florida cities and counties from making employers give workers heat protections, like water, shade or cool-down breaks, beyond what state or federal law already requires.',
            es: 'Una ley estatal de 2024 (HB 433) prohíbe que las ciudades y los condados de Florida obliguen a los empleadores a dar protecciones contra el calor, como agua, sombra o pausas para refrescarse, más allá de lo que ya exigen las leyes estatales o federales.'
          },
          source: 'https://www.flsenate.gov/Session/Bill/2024/433/BillText/er/PDF',
          sourceName: 'Florida Legislature, CS/CS/HB 433 (2024), enrolled text: creates s. 448.106, F.S., "Workplace heat exposure requirements" (approved Apr 11, 2024, Ch. 2024-80, effective July 1, 2024)',
          sources: [
            { url: 'https://www.flsenate.gov/Session/Bill/2024/433', name: 'Florida Senate, CS/CS/HB 433 (2024) bill page: approved Apr 11, 2024, Ch. 2024-80' },
            { url: 'https://news.wfsu.org/state-news/2024-04-12/gov-desantis-signs-worker-wage-and-heat-protection-preemptions', name: 'WFSU Public Media, report on the governor signing the worker wage and heat protection preemption bills (Apr 12, 2024)' }
          ],
          verified: '2026-11-09',
          asOf: '2024-07-01',
          confidence: 'high',
          note: 'Enrolled text, s. 448.106(2)(a): a political subdivision may not require an employer "to meet or provide heat exposure requirements not otherwise required under state or federal law"; the defined term covers water consumption, cooling measures, acclimation and recovery periods, training and more. It applies to all employers, not only outdoor work, and cities and counties may still set rules for their own employees (s. 448.106(3)). Do not claim there is no state or federal heat standard without a fresh source.'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Plain-language rundowns, in English and Spanish, of what Tallahassee is doing on insurance and storm costs, with links to the bills themselves.',
            es: '(DEMO) Resúmenes en lenguaje sencillo, en inglés y en español, de lo que hace Tallahassee con los seguros y los costos de las tormentas, con enlaces a los proyectos de ley.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) Water and shade at every summer event we run, and check-in texts on heat advisory days.',
            es: '(DEMO) Agua y sombra en cada evento de verano que organizamos, y mensajes para ver cómo estás en los días de alerta por calor.'
          },
          demo: true
        }
      ],
      action: {
        type: 'share',
        label: { en: 'Send this to whoever just got a renewal letter', es: 'Mándale esto a quien acaba de recibir la renovación de su póliza' },
        page: 'issues',
        hash: 'heat'
      },
      moreActions: [
        { type: 'vote', label: { en: 'See the next election dates', es: 'Mira las próximas fechas de elecciones' }, page: 'vote', hash: 'dates', official: 'links.vote.upcomingElections' },
        { type: 'join', label: { en: 'Join YDSC', es: 'Únete a YDSC' }, page: 'join' }
      ],
      eventSeries: [],
      share: {
        title: { en: 'Heat and insurance in Seminole', es: 'Calor y seguros en Seminole' },
        text: {
          en: 'Average home insurance in Seminole: $3,545 a year. Orlando hit 95°F or hotter on a record 51 days in summer 2026. That’s not just the weather, it’s worth talking about.',
          es: 'Seguro de vivienda promedio en Seminole: $3,545 al año. Orlando llegó a 95 °F o más en 51 días del verano de 2026, un récord. No es solo el clima, y vale la pena hablarlo.'
        },
        page: 'issues',
        hash: 'heat'
      }
    },

    // ------------------------------------------------------------------- reproductive freedom
    {
      id: 'repro',
      color: 'violet',
      onColor: 'paper',
      tone: 'serious',
      title: { en: 'Reproductive freedom', es: 'Libertad reproductiva' },
      short: { en: 'reproductive freedom', es: 'la libertad reproductiva' },
      hook: {
        en: 'Your body, your doctor, your call. In 2024, more than 60% of Seminole voters agreed.',
        es: 'Tu cuerpo, tu médico, tu decisión. En 2024, más del 60% de los votantes de Seminole estuvo de acuerdo.'
      },
      facts: [
        {
          id: 'six-week-ban',
          text: {
            en: 'Since May 1, 2024, Florida has banned most abortions after six weeks of pregnancy. The exceptions are narrow: to save the patient’s life or prevent serious, permanent physical harm; a fatal fetal condition; or rape, incest or human trafficking up to 15 weeks, with documents to prove it.',
            es: 'Desde el 1 de mayo de 2024, Florida prohíbe la mayoría de los abortos después de las seis semanas de embarazo. Las excepciones son muy limitadas: para salvar la vida de la paciente o evitarle un daño físico grave y permanente; una condición fetal mortal; o violación, incesto o trata de personas hasta las 15 semanas, con documentos que lo prueben.'
          },
          source: 'https://www.wusf.org/courts-law/2024-05-01/floridas-6-week-abortion-ban-takes-effect-as-doctors-worry-women-will-lose-access-to-health-care',
          sourceName: 'Associated Press via WUSF, "Florida’s 6-week abortion ban takes effect" (May 1, 2024)',
          sources: [
            { url: 'https://www.flsenate.gov/Session/Bill/2023/300/BillText/er/PDF', name: 'Florida Legislature, SB 300 (2023) enrolled text, s. 390.0111(1)(a)-(d): the exceptions (Ch. 2023-21)' },
            { url: 'https://www.flsenate.gov/Session/Bill/2023/300', name: 'Florida Senate, SB 300 (2023), Pregnancy and Parenting Support: bill page' }
          ],
          verified: '2026-11-09',
          asOf: '2024-05-01',
          confidence: 'high',
          note: 'Exceptions per s. 390.0111(1): (a)-(b) two physicians (or one in an emergency) certify the abortion is needed to save the woman’s life or avert a serious risk of substantial and irreversible physical impairment; (c) two physicians certify a fatal fetal abnormality; (d) rape, incest or human trafficking, gestational age not more than 15 weeks, with a restraining order, police report, medical record or other court order or documentation. Keep this neutral and exact; it is a serious card.'
        },
        {
          id: 'amendment-4-seminole',
          text: {
            en: 'In 2024, 60.37% of Seminole voters said yes to Amendment 4, which would have protected abortion access (151,224 yes to 99,279 no). Statewide it got about 57%, short of the 60% it needed.',
            es: 'En 2024, el 60.37% de los votantes de Seminole votó sí a la Enmienda 4, que habría protegido el acceso al aborto (151,224 a favor y 99,279 en contra). En todo el estado sacó cerca del 57%, menos del 60% que necesitaba.'
          },
          stat: { value: '60.37%', label: { en: 'of Seminole voted yes on Amendment 4 (2024)', es: 'de Seminole votó sí a la Enmienda 4 (2024)' } },
          source: 'https://voteseminole.gov/wp-content/uploads/2026/06/2024GeneralElection-Official-PrecinctSummary-Groups-Redacted-Public.pdf',
          sourceName: 'Seminole County Supervisor of Elections, 2024 General Election Official Precinct Summary',
          sources: [
            { url: 'https://www.wusf.org/politics-issues/2024-11-05/florida-abortion-amendment-falls-short-of-threshold-to-pass', name: 'WUSF, "Florida’s abortion amendment falls short of threshold to pass" (Nov 5, 2024): statewide result' }
          ],
          verified: '2026-11-09',
          asOf: '2024-11-05',
          confidence: 'high',
          computed: true,
          method: 'Sum of Amendment 4 Yes and No across all 82 precincts in the official precinct summary: 151,224 / (151,224 + 99,279) = 60.37%. Matches report 01.'
        },
        {
          id: 'sixty-percent-rule',
          text: {
            en: 'Florida’s constitution needs 60% of the vote to pass an amendment, so a majority isn’t enough.',
            es: 'La constitución de Florida exige el 60% de los votos para aprobar una enmienda, así que una mayoría simple no basta.'
          },
          source: 'https://www.flsenate.gov/Laws/Constitution',
          sourceName: 'Constitution of the State of Florida, Article XI, Section 5(e)',
          verified: '2026-11-09',
          asOf: '2026',
          confidence: 'high'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Plain-language updates on what Florida law says right now, with links to the official text, so nobody has to guess.',
            es: '(DEMO) Actualizaciones en lenguaje sencillo sobre lo que dice la ley de Florida hoy, con enlaces al texto oficial, para que nadie tenga que adivinar.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A registration check-in before every election, so every member who wants to vote can.',
            es: '(DEMO) Una revisión de la inscripción antes de cada elección, para que cada miembro que quiera votar pueda hacerlo.'
          },
          demo: true
        }
      ],
      action: {
        type: 'vote',
        label: { en: 'Check your voter registration', es: 'Revisa tu inscripción para votar' },
        page: 'vote',
        hash: 'check-registration',
        official: 'links.vote.myVoterRecord'
      },
      moreActions: [
        { type: 'vote', label: { en: 'Renew your mail ballot request', es: 'Renueva tu solicitud de boleta por correo' }, page: 'vote', hash: 'renew-mail-ballot', official: 'links.vote.voteByMail' },
        { type: 'share', label: { en: 'Share the Seminole number', es: 'Comparte el dato de Seminole' }, page: 'issues', hash: 'repro' }
      ],
      eventSeries: [],
      share: {
        title: { en: 'Seminole and Amendment 4', es: 'Seminole y la Enmienda 4' },
        text: {
          en: 'In 2024, 60.37% of Seminole voters backed Amendment 4 to protect abortion access. Statewide it got about 57%, short of the 60% it needed. Check that your registration is up to date.',
          es: 'En 2024, el 60.37% de los votantes de Seminole apoyó la Enmienda 4 para proteger el acceso al aborto. En todo el estado sacó cerca del 57%, menos del 60% que necesitaba. Revisa que tu inscripción esté al día.'
        },
        page: 'issues',
        hash: 'repro'
      }
    },

    // ------------------------------------------------------------------------ LGBTQ+ freedom
    {
      id: 'lgbtq',
      color: 'bubblegum',
      onColor: 'ink',
      tone: 'serious',
      title: { en: 'LGBTQ+ freedom', es: 'Libertad LGBTQ+' },
      short: { en: 'LGBTQ+ freedom', es: 'la libertad LGBTQ+' },
      hook: {
        en: 'Everyone in Seminole deserves to be safe, to be respected and to be left alone to live.',
        es: 'Todo el mundo en Seminole merece seguridad, respeto y la libertad de vivir en paz.'
      },
      facts: [
        {
          id: 'sb-254',
          text: {
            en: 'A Florida law signed May 17, 2023 (SB 254) bans gender-affirming prescriptions and procedures for anyone under 18. The only exception: some teens whose prescriptions started before the law took effect.',
            es: 'Una ley de Florida firmada el 17 de mayo de 2023 (SB 254) prohíbe los medicamentos y procedimientos de afirmación de género para menores de 18 años. La única excepción: algunos adolescentes que ya tenían recetas antes de que la ley entrara en vigor.'
          },
          source: 'https://www.flsenate.gov/Session/Bill/2023/254',
          sourceName: 'Florida Senate, CS/SB 254 (2023), Treatments for Sex Reassignment: approved May 17, 2023, effective May 17, 2023, Ch. 2023-90',
          sources: [
            { url: 'https://www.flsenate.gov/Session/Bill/2023/254/BillText/er/PDF', name: 'Florida Legislature, CS/SB 254 (2023) enrolled text: s. 456.52(1) and the exception for prescriptions commenced before, and still active on, the effective date' }
          ],
          verified: '2026-11-09',
          asOf: '2023-05-17',
          confidence: 'high',
          note: 'The bill’s own wording is "sex-reassignment prescriptions and procedures for patients younger than 18". It also bars certain public funds for these treatments and restricts care for adults. Litigation: a federal judge blocked the law in June 2024 (Doe v. Ladapo); an 11th Circuit panel stayed that ruling on Aug 26, 2024, so the state can enforce it while the appeal goes on (The Advocate, Aug 26, 2024). We did not confirm a final appellate ruling; do not describe the case outcome without re-checking.'
        },
        {
          id: 'hb-1069',
          text: {
            en: 'Since July 1, 2023, another state law (HB 1069) has set rules on titles and pronouns in public schools and widened the process for objecting to school books and materials.',
            es: 'Desde el 1 de julio de 2023, otra ley estatal (HB 1069) pone reglas sobre títulos y pronombres en las escuelas públicas y amplía el proceso para objetar libros y materiales escolares.'
          },
          source: 'https://www.flsenate.gov/Session/Bill/2023/1069',
          sourceName: 'Florida Senate, CS/CS/HB 1069 (2023), Education: approved May 17, 2023, Ch. 2023-105',
          verified: '2026-11-09',
          asOf: '2023-07-01',
          confidence: 'high'
        },
        {
          id: 'pulse-crosswalk',
          text: {
            en: 'In August 2025, the Florida Department of Transportation removed the rainbow crosswalk outside the Pulse memorial in Orlando overnight. Orlando’s mayor said the city wasn’t told beforehand.',
            es: 'En agosto de 2025, el Departamento de Transporte de Florida quitó durante la noche el cruce peatonal arcoíris frente al memorial de Pulse en Orlando. El alcalde de Orlando dijo que no avisaron a la ciudad.'
          },
          source: 'https://wjla.com/news/nation-world/fdot-pulls-rainbow-crosswalk-at-pulse-nightclub-overnight-delray-beach-fights-to-save-its-lgbtq-florida-department-of-transportation-pulse-nightclub-removal-orlando-shootingflorida-august-20-2025',
          sourceName: 'CBS12 / Sinclair syndicated report on WJLA, "FDOT pulls rainbow crosswalk at Pulse nightclub overnight" (Aug 21, 2025)',
          verified: '2026-11-09',
          asOf: '2025-08-21',
          confidence: 'high',
          note: 'Article dated Thu, Aug 21, 2025; the crosswalk was removed overnight. Mayor Buddy Dyer said the city was not informed beforehand. FDOT cited its policy against "political" banners and markings on state roads. Pulse is in Orlando (Orange County), not Seminole: keep it framed as Central Florida.'
        },
        {
          id: 'gallup-under-30',
          text: {
            en: 'In Gallup’s 2025 polling, 23% of U.S. adults under 30 said they’re LGBTQ+, compared with 10% of adults 30 to 49. These laws land on a lot of people our age.',
            es: 'En las encuestas de Gallup de 2025, el 23% de los adultos de EE. UU. menores de 30 años dijo ser LGBTQ+, frente al 10% de los adultos de 30 a 49. Estas leyes afectan a mucha gente de nuestra edad.'
          },
          stat: { value: '23%', label: { en: 'of U.S. adults under 30 identify as LGBTQ+', es: 'de los adultos de EE. UU. menores de 30 se identifica como LGBTQ+' } },
          source: 'https://news.gallup.com/poll/702206/lgbtq-identification-holds.aspx',
          sourceName: 'Gallup, "LGBTQ+ Identification Holds at 9% in U.S." by Jeffrey M. Jones (Feb 16, 2026); 2025 telephone interviews with 13,454 U.S. adults',
          verified: '2026-11-10',
          asOf: '2025',
          confidence: 'high',
          staleAfter: '2027-04-30',
          note: 'National, not Seminole: label says "U.S.". Gallup quote: "In the latest data, 23% of adults under age 30 identify as LGBTQ+, compared with 10% of those aged 30 to 49" (3% or less at 50+). Gallup publishes the next update around February each year; recheck then (staleAfter hides the tile number, and the tile falls back to the deliberate words design). Kept last in facts[] so quiz results (first 3 facts) are unchanged. genz-brand-24.'
        }
      ],
      ydsc: [
        {
          text: {
            en: 'YDSC has hosted a musical theatre night in Oviedo to raise money for a local charity that supports LGBTQ+ youth.',
            es: 'YDSC organizó una noche de teatro musical en Oviedo a beneficio de una organización local que apoya a jóvenes LGBTQ+.'
          },
          demo: false,
          source: 'https://secure.actblue.com/donate/ydscmusicaltheatre',
          sourceName: 'Young Democrats of Seminole County, ActBlue page "Young Democrats Musical Theatre Review"',
          verified: '2026-11-09',
          confidence: 'med',
          note: 'The page gives June 15 but no year (search snippets suggested 2024) and says proceeds go to a local charity supporting LGBTQ+ youth without naming it; it does not say how much was raised, so do not claim an amount. The page names the venue (a real business at the Oviedo Mall) and a chapter officer: never name either on the site.'
        },
        {
          text: {
            en: '(DEMO) Pride meetups that are easy to say yes to: all ages 14 to 39, sober-friendly and step-free.',
            es: '(DEMO) Encuentros de Pride a los que es fácil decir que sí: para edades de 14 a 39, sin presión para tomar alcohol y con acceso sin escalones.'
          },
          demo: true
        }
      ],
      action: {
        type: 'join',
        label: { en: 'Join YDSC', es: 'Únete a YDSC' },
        page: 'join'
      },
      moreActions: [
        { type: 'vote', label: { en: 'Check your voter registration', es: 'Revisa tu inscripción para votar' }, page: 'vote', hash: 'check-registration', official: 'links.vote.myVoterRecord' },
        { type: 'share', label: { en: 'Share this with a friend', es: 'Compártelo con alguien' }, page: 'issues', hash: 'lgbtq' }
      ],
      eventSeries: [],
      share: {
        title: { en: 'LGBTQ+ freedom in Seminole', es: 'Libertad LGBTQ+ en Seminole' },
        text: {
          en: 'The Young Dems in Seminole put on a musical theatre night to raise money for a local charity that supports LGBTQ+ youth. They’re 14 to 39. Want to check them out with me?',
          es: 'Los Young Dems de Seminole organizaron una noche de teatro musical a beneficio de una organización local que apoya a jóvenes LGBTQ+. Son de 14 a 39 años. ¿Me acompañas a conocerlos?'
        },
        page: 'issues',
        hash: 'lgbtq'
      }
    },

    // ------------------------------------------------------------ schools and freedom to read
    {
      id: 'schools',
      color: 'violet-deep',
      onColor: 'paper',
      tone: 'bright',
      title: { en: 'Schools and the freedom to read', es: 'Escuelas y libertad para leer' },
      short: { en: 'the freedom to read', es: 'la libertad para leer' },
      hook: {
        en: 'Libraries are for reading, not for emptying.',
        es: 'Las bibliotecas son para leer, no para vaciarlas.'
      },
      facts: [
        {
          id: 'scps-31-books',
          text: {
            en: 'In fall 2023, Seminole County Public Schools pulled more than 30 books. Most were pulled because other Central Florida districts had objected to them, not because Seminole parents complained.',
            es: 'En el otoño de 2023, las Escuelas Públicas del Condado de Seminole retiraron más de 30 libros. La mayoría salió porque otros distritos escolares del centro de Florida los habían objetado, no por quejas de familias de Seminole.'
          },
          stat: { value: '30+', label: { en: 'books pulled in Seminole schools, fall 2023', es: 'libros retirados en escuelas de Seminole, otoño de 2023' } },
          source: 'https://www.cfpublic.org/education/2023-10-11/seminole-county-bans-books-challenged-in-other-school-districts',
          sourceName: 'Central Florida Public Media, "Seminole County bans books challenged in other school districts" (Oct 11, 2023)',
          verified: '2026-11-09',
          asOf: '2023-10-11',
          confidence: 'high',
          note: 'Other coverage (Orlando Sentinel via Yahoo, ClickOrlando) gives the list as 31 titles.'
        },
        {
          id: 'pen-florida',
          text: {
            en: 'PEN America counted 2,304 school book bans in Florida in the 2024-25 school year, the most of any state.',
            es: 'PEN America contó 2,304 prohibiciones de libros en escuelas de Florida durante el año escolar 2024-25, más que en cualquier otro estado.'
          },
          stat: { value: '2,304', label: { en: 'school book bans in Florida, 2024-25', es: 'prohibiciones de libros en escuelas de Florida, 2024-25' } },
          source: 'https://www.fox35orlando.com/news/pen-america-banned-book-report-2025',
          sourceName: 'FOX 35 Orlando, on PEN America’s "Banned in the USA" 2024-25 report (Oct 1, 2025)',
          verified: '2026-11-09',
          asOf: '2024-25 school year',
          confidence: 'med',
          note: 'Re-read Nov 9, 2026: FOX 35 says PEN tracked 6,870 instances nationally in 2024-25 and that Florida was "the No. 1 state". PEN counts instances (one title removed in two districts counts twice). pen.org blocked our checks, so this stays med until read at the source. The Florida Department of Education’s own report lists far fewer (444 titles in 16 counties per Florida Phoenix), partly because it counts only final removal decisions.'
        },
        {
          id: 'school-board-nonpartisan',
          text: {
            en: 'Florida school board races are nonpartisan, so you can vote in them whatever your party, independents included.',
            es: 'Las elecciones para la junta escolar en Florida no son partidistas, así que puedes votar en ellas sin importar tu partido, aunque no tengas ninguno.'
          },
          source: 'https://www.flsenate.gov/Laws/Constitution',
          sourceName: 'Constitution of the State of Florida, Article IX, Section 4(a): school board members "chosen by vote of the electors in a nonpartisan election"',
          verified: '2026-11-09',
          asOf: '2026',
          confidence: 'high',
          note: 'Report 01 §3b: nonpartisan races (school board, judges, city races) are open to every voter. Whether Seminole board seats are voted on countywide or by district was not checked: say nothing more specific without the SOE.'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Banned-book swaps in a public park: bring one, take one, and talk about why it matters.',
            es: '(DEMO) Intercambios de libros prohibidos en un parque público: trae uno, llévate otro y conversemos sobre por qué importa.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A school board buddy system: we tell you when the meeting is, and we sit together.',
            es: '(DEMO) Nadie va sin compañía a la junta escolar: te avisamos cuándo es la reunión y nos sentamos en grupo.'
          },
          demo: true
        }
      ],
      action: {
        type: 'vote',
        label: { en: 'Register or pre-register to vote', es: 'Inscríbete o preinscríbete para votar' },
        page: 'vote',
        hash: 'register',
        official: 'links.vote.register'
      },
      moreActions: [
        { type: 'vote', label: { en: 'See the next election dates', es: 'Mira las próximas fechas de elecciones' }, page: 'vote', hash: 'dates', official: 'links.vote.upcomingElections' },
        { type: 'share', label: { en: 'Share with a friend who reads', es: 'Compártelo con alguien que lee' }, page: 'issues', hash: 'schools' }
      ],
      eventSeries: [],
      share: {
        title: { en: 'Books in Seminole schools', es: 'Libros en las escuelas de Seminole' },
        text: {
          en: 'Seminole schools pulled 30+ books in 2023, mostly over complaints from other counties. School board races are nonpartisan: anyone registered can vote in them.',
          es: 'Las escuelas de Seminole retiraron más de 30 libros en 2023, sobre todo por quejas de otros condados. Las elecciones de la junta escolar no son partidistas: cualquier persona inscrita puede votar.'
        },
        page: 'issues',
        hash: 'schools'
      }
    },

    // --------------------------------------------------------------- wages and cost of living
    {
      id: 'wages',
      color: 'lime',
      onColor: 'ink',
      tone: 'bright',
      title: { en: 'Wages and cost of living', es: 'Sueldos y costo de vida' },
      short: { en: 'wages', es: 'los sueldos' },
      hook: {
        en: '$15 an hour is the floor now. MIT figures a single adult here needs about $25.50 to cover the basics.',
        es: 'El mínimo ya es $15 la hora. Según el MIT, una persona sola aquí necesita unos $25.50 para cubrir lo básico.'
      },
      facts: [
        {
          id: 'minimum-wage-15',
          text: {
            en: 'Florida’s minimum wage reached $15 an hour on Sep 30, 2026. Starting Sep 30, 2027, it adjusts every year for inflation.',
            es: 'El salario mínimo de Florida llegó a $15 la hora el 30 de septiembre de 2026. A partir del 30 de septiembre de 2027 se ajusta cada año según la inflación.'
          },
          stat: { value: '$15', label: { en: 'Florida minimum wage since Sep 30, 2026', es: 'salario mínimo de Florida desde el 30 de sept. de 2026' } },
          source: 'https://www.flsenate.gov/Laws/Constitution',
          sourceName: 'Constitution of the State of Florida, Article X, Section 24(c)',
          sources: [
            { url: 'https://www.mysuncoast.com/2026/09/29/florida-minimum-wage-rises-15-an-hour-sept-30/', name: 'WWSB/ABC7 Sarasota, "Florida minimum wage rises to $15 an hour Sept. 30" (Sep 29, 2026)' }
          ],
          verified: '2026-11-09',
          asOf: '2026-09-30',
          confidence: 'high',
          note: 'Constitution text: "until the Minimum Wage reaches $15.00 per hour on September 30th, 2026. On September 30th of 2027 and on each following September 30th" the rate is adjusted for inflation. Tipped workers: $11.98 cash wage plus tips (WWSB). Update the stat after Sep 30, 2027.'
        },
        {
          id: 'living-wage',
          text: {
            en: 'MIT’s Living Wage Calculator puts the living wage for a single adult with no kids in Seminole at $25.52 an hour.',
            es: 'Según la calculadora de salario digno del MIT, una persona adulta sin hijos en Seminole necesita ganar $25.52 la hora.'
          },
          stat: { value: '$25.52', label: { en: 'living wage an hour, 1 adult, Seminole', es: 'salario digno por hora, 1 adulto, Seminole' } },
          source: 'https://livingwage.mit.edu/counties/12117',
          sourceName: 'MIT Living Wage Calculator, Seminole County, Florida (data updated Feb 15, 2026)',
          verified: '2026-11-09',
          asOf: '2026-02-15',
          confidence: 'high',
          note: 'An estimate of basic costs, not a legal standard. The same page puts typical yearly housing cost for one adult at $20,438.'
        },
        {
          id: 'hospitality-pay',
          text: {
            en: 'In 2024, the average yearly pay in Seminole’s leisure and hospitality jobs (restaurants, hotels, entertainment) was $26,889. Across all jobs it was $65,462.',
            es: 'En 2024, el sueldo anual promedio en los empleos de turismo y hospitalidad de Seminole (restaurantes, hoteles, entretenimiento) fue de $26,889. En todos los empleos, $65,462.'
          },
          stat: { value: '$26,889', label: { en: 'average yearly pay, hospitality jobs', es: 'sueldo anual promedio, hospitalidad' } },
          source: 'https://edr.state.fl.us/Content/area-profiles/county/seminole.pdf',
          sourceName: 'Florida Office of Economic and Demographic Research, Seminole County profile (2024 average annual wage)',
          verified: '2026-11-09',
          asOf: '2024',
          confidence: 'high',
          note: 'Averages include part-time workers, so do not convert to an hourly rate. Florida hospitality average: $37,261.'
        }
      ],
      ydsc: [
        {
          text: {
            en: 'Dues are $20 a year, and anyone who can’t pay can still join as a non-voting member.',
            es: 'La cuota es de $20 al año, y quien no pueda pagarla igual puede unirse como miembro sin voto.'
          },
          demo: false,
          source: 'https://secure.actblue.com/donate/ydscdues',
          sourceName: 'Young Democrats of Seminole County, ActBlue membership dues page',
          verified: '2026-11-09',
          confidence: 'high'
        },
        {
          text: {
            en: '(DEMO) First-timer nights with free food, because nobody should have to spend money to show up.',
            es: '(DEMO) Noches para recién llegados con comida gratis, porque nadie debería tener que gastar dinero para venir.'
          },
          demo: true
        }
      ],
      action: {
        type: 'share',
        label: { en: 'Share the $15 vs $25.52 card', es: 'Comparte la tarjeta de $15 vs $25.52' },
        page: 'issues',
        hash: 'wages'
      },
      moreActions: [
        { type: 'join', label: { en: 'Join for $20, or for free', es: 'Únete por $20, o gratis' }, page: 'join' },
        { type: 'event', label: { en: 'Come to a member mixer', es: 'Ven a un encuentro de miembros' }, page: 'events', query: 'series=mixer', demo: true }
      ],
      eventSeries: ['mixer'],
      share: {
        title: { en: 'Wages in Seminole', es: 'Sueldos en Seminole' },
        text: {
          en: 'Florida’s minimum wage just hit $15. MIT says a single adult in Seminole needs $25.52 an hour. That gap is the whole conversation.',
          es: 'El salario mínimo de Florida acaba de llegar a $15. Según el MIT, una persona sola en Seminole necesita $25.52 la hora. Esa diferencia lo dice todo.'
        },
        page: 'issues',
        hash: 'wages'
      }
    },

    // ----------------------------------------------------------------- transit and SunRail
    {
      id: 'transit',
      color: 'sky',
      onColor: 'ink',
      tone: 'bright',
      title: { en: 'Transit and SunRail', es: 'Transporte y SunRail' },
      short: { en: 'transit', es: 'el transporte' },
      hook: {
        en: 'Four SunRail stations in Seminole. No regular trains on weekends. And 7 in 10 of us drive to work alone.',
        es: 'Cuatro estaciones de SunRail en Seminole. Ningún tren regular los fines de semana. Y 7 de cada 10 vamos al trabajo manejando sin compañía.'
      },
      facts: [
        {
          id: 'sunrail-stations',
          text: {
            en: 'Four of SunRail’s 17 stations are in Seminole: Sanford, Lake Mary, Longwood and Altamonte Springs.',
            es: 'Cuatro de las 17 estaciones de SunRail están en Seminole: Sanford, Lake Mary, Longwood y Altamonte Springs.'
          },
          stat: { value: '4', label: { en: 'SunRail stations in Seminole', es: 'estaciones de SunRail en Seminole' } },
          source: 'https://sunrail.com/stations/',
          sourceName: 'SunRail, Stations',
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high'
        },
        {
          id: 'commute-modes',
          text: {
            en: 'Only 0.5% of Seminole workers commute by public transit. 69.8% drive alone.',
            es: 'Solo el 0.5% de quienes trabajan en Seminole va al trabajo en transporte público. El 69.8% maneja sin compañía.'
          },
          stat: { value: '0.5%', label: { en: 'of Seminole workers commute by transit', es: 'de quienes trabajan en Seminole usa transporte público' } },
          source: 'https://censusreporter.org/data/table/?table=B08301&geo_ids=05000US12117&primary_geo_id=05000US12117',
          sourceName: 'U.S. Census Bureau, American Community Survey 2024 1-year, table B08301 Means of Transportation to Work (via Census Reporter)',
          verified: '2026-11-09',
          asOf: '2024',
          confidence: 'high',
          computed: true,
          method: 'Public transportation 1,319 / 257,291 workers 16+ = 0.51%; drove alone 179,594 / 257,291 = 69.8%. Worked from home: 50,307 (19.6%).'
        },
        {
          id: 'weekend-cost',
          text: {
            en: 'SunRail runs Monday to Friday only. In 2025, SunRail staff estimated that weekend trains would cost about $26.3 million a year to run, plus about $61.8 million for three more locomotives and cab cars.',
            es: 'SunRail funciona solo de lunes a viernes. En 2025, el personal de SunRail calculó que operar trenes los fines de semana costaría unos $26.3 millones al año, más unos $61.8 millones en tres locomotoras y vagones de cabina adicionales.'
          },
          source: 'https://www.clickorlando.com/news/local/2025/07/24/heres-how-much-it-could-cost-to-expand-sunrail-service-to-weekends',
          sourceName: 'WKMG News 6 / ClickOrlando, "Here’s how much it could cost to expand SunRail service to weekends" (Jul 24, 2025)',
          sources: [
            { url: 'https://sunrail.com/help-center/support/maps-schedules/how-often-does-sunrail-run/', name: 'SunRail help center, "How often does SunRail run?": "SunRail currently runs Monday – Friday only" (page updated May 18, 2025; read Nov 9, 2026)' }
          ],
          verified: '2026-11-09',
          asOf: '2025-07-24',
          confidence: 'med',
          note: 'Weekday-only is from SunRail’s own page (high); the dollar figures are a staff estimate ($26,265,000 a year; $61,800,000 capital) presented to the Central Florida Commuter Rail Commission and reported by local news, not a budget (med). The commission chair told News 6 riders want weekend trains. News 6 notes SunRail has "previously offered a special service on weekends or for events", hence "regular" in the hook. Re-check the weekday-only line on sunrail.com before launch. Context from the first content pass, not re-checked: Seminole County was set to put $11.5 million toward SunRail operating costs as the line moved from state to local control (ClickOrlando, Sep 23, 2025).'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Ride together: we hold weeknight events near a SunRail station and meet on the platform.',
            es: '(DEMO) Vamos en grupo: hacemos eventos entre semana cerca de una estación de SunRail y nos vemos en el andén.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A carpool list for every event, so not having a car never means missing out.',
            es: '(DEMO) Una lista para compartir carro en cada evento, para que no tener carro nunca te deje fuera.'
          },
          demo: true
        }
      ],
      action: {
        type: 'event',
        label: { en: 'Find a SunRail social', es: 'Busca una salida en SunRail' },
        page: 'events',
        query: 'series=sunrail',
        demo: true
      },
      moreActions: [
        { type: 'clip', label: { en: 'Watch the reel', es: 'Mira los videos' }, page: 'clips' },
        { type: 'share', label: { en: 'Share with your commute buddy', es: 'Compártelo con quien va contigo al trabajo' }, page: 'issues', hash: 'transit' }
      ],
      eventSeries: ['sunrail'],
      share: {
        title: { en: 'Getting around Seminole', es: 'Moverse por Seminole' },
        text: {
          en: 'Seminole has 4 SunRail stations, no regular weekend trains, and only 0.5% of us take transit to work. Ride to the next Young Dems thing with me?',
          es: 'Seminole tiene 4 estaciones de SunRail, ningún tren regular los fines de semana y solo el 0.5% va al trabajo en transporte público. ¿Me acompañas al próximo evento de los Young Dems?'
        },
        page: 'issues',
        hash: 'transit'
      }
    },

    // ------------------------------------------------------------------ lakes and clean water
    {
      id: 'water',
      color: 'teal',
      onColor: 'ink',
      tone: 'bright',
      title: { en: 'Lakes, rivers and clean water', es: 'Lagos, ríos y agua limpia' },
      short: { en: 'clean water', es: 'el agua limpia' },
      hook: {
        en: 'From Lake Monroe sunsets to the Wekiva, the water is the best thing about living here. Let’s keep it that way.',
        es: 'Desde los atardeceres en el lago Monroe hasta el río Wekiva, el agua es lo mejor de vivir aquí. Hay que cuidarla.'
      },
      facts: [
        {
          id: 'lake-jesup',
          text: {
            en: 'Decades of wastewater pouring into the streams that feed Lake Jesup left it with chronic algae blooms and a thick layer of muck on the bottom. It has had a state cleanup plan since 2010.',
            es: 'Décadas de aguas residuales en los arroyos que alimentan el lago Jesup le dejaron floraciones crónicas de algas y una capa gruesa de lodo en el fondo. Desde 2010 tiene un plan estatal de limpieza.'
          },
          source: 'https://www.sjrwmd.com/streamlines/work-continues-in-the-journey-to-restore-lake-jesup/',
          sourceName: 'St. Johns River Water Management District, "Work continues in the journey to restore Lake Jesup" (undated, read Nov 9, 2026)',
          sources: [
            { url: 'https://floridadep.gov/sites/default/files/jesup-bmap.pdf', name: 'Florida DEP, Final Basin Management Action Plan for the Lake Jesup Basin (April 2010)' }
          ],
          verified: '2026-11-09',
          asOf: '2026',
          confidence: 'high',
          note: 'SJRWMD: "Decades of wastewater discharges to the lake’s tributaries" led to "chronic algal blooms" and "a thick layer of organic muck on the lake bottom"; the lake runs 8,000 to 16,000 acres depending on water levels, and its BMAP was updated in 2019. The DEP plan’s cover is dated April 2010.'
        },
        {
          id: 'fertilizer-season',
          text: {
            en: 'From June through September, Seminole County allows no nitrogen or phosphorus fertilizer on lawns, because summer storms wash it into lakes. All seven cities have similar rules.',
            es: 'De junio a septiembre, el condado de Seminole no permite fertilizantes con nitrógeno ni fósforo en el césped, porque las tormentas de verano los arrastran a los lagos. Las siete ciudades tienen reglas parecidas.'
          },
          stat: { value: 'Jun–Sep', valueEs: 'jun.–sep.', label: { en: 'no nitrogen or phosphorus fertilizer on Seminole lawns', es: 'sin fertilizante con nitrógeno ni fósforo en el césped de Seminole' } },
          source: 'https://seminolecountyfl.gov/departments-services/environmental-services/watershed-management/fertilizer-ordinance',
          sourceName: 'Seminole County, Fertilizer Ordinance',
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          note: 'County page says "June – September" and that each of the seven cities "has adopted a similar ordinance". County training slides give June 1 – September 30. Iron and micronutrient "summer blends" are allowed.'
        },
        {
          id: 'wekiva-wild-scenic',
          text: {
            en: 'The Wekiva River, on Seminole’s west side, has been a National Wild and Scenic River since Oct 13, 2000.',
            es: 'El río Wekiva, en el lado oeste de Seminole, es Río Nacional Silvestre y Escénico desde el 13 de octubre de 2000.'
          },
          source: 'https://www.fws.gov/rivers/river/wekiva',
          sourceName: 'National Wild and Scenic Rivers System, Wekiva River',
          sources: [
            { url: 'https://www.seminolecountyfl.gov/docs/default-source/pdf/WekivaRiverAreaFactSheetNovember2024ADA.pdf', name: 'Seminole County, Wekiva River Area Fact Sheet (Nov 2024): the Wekiva River Protection Area within Seminole County' }
          ],
          verified: '2026-11-09',
          asOf: '2000-10-13',
          confidence: 'high',
          note: '41.6 designated miles (8.1 recreational, 2.1 scenic, 31.4 wild), from the St. Johns River confluence to Wekiwa Springs, plus Rock Springs Run and Black Water Creek. The federal page does not name counties for the river itself; "west side" rests on the county fact sheet and report 01 (med for the exact line). Wekiwa Springs State Park is in Orange County: say "the Wekiva", not "the springs in Seminole".'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Riverwalk and lakeshore cleanups in Sanford: gloves and bags provided, done by lunch.',
            es: '(DEMO) Limpiezas en el Riverwalk y a la orilla del lago en Sanford: ponemos guantes y bolsas, y terminamos antes del almuerzo.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A summer reminder about the fertilizer rules, for renters and homeowners alike.',
            es: '(DEMO) Un recordatorio en verano sobre las reglas de fertilizantes, tanto para quien alquila como para quien es dueño.'
          },
          demo: true
        }
      ],
      action: {
        type: 'event',
        label: { en: 'Walk Lake Monroe with us', es: 'Ven a caminar por el lago Monroe' },
        page: 'events',
        query: 'series=sunset-walk',
        demo: true
      },
      moreActions: [
        { type: 'share', label: { en: 'Share with your lake-day crew', es: 'Compártelo con tu grupo de paseos al lago' }, page: 'issues', hash: 'water' },
        { type: 'join', label: { en: 'Join YDSC', es: 'Únete a YDSC' }, page: 'join' }
      ],
      eventSeries: ['sunset-walk', 'picnic'],
      share: {
        title: { en: 'Clean water in Seminole', es: 'Agua limpia en Seminole' },
        text: {
          en: 'Lake Jesup has had a state cleanup plan since 2010, and every June to September Seminole bans nitrogen and phosphorus lawn fertilizer to protect the lakes. Want to get involved with me?',
          es: 'El lago Jesup tiene un plan estatal de limpieza desde 2010, y cada año, de junio a septiembre, Seminole prohíbe el fertilizante para césped con nitrógeno o fósforo para proteger los lagos. ¿Te animas a participar conmigo?'
        },
        page: 'issues',
        hash: 'water'
      }
    },

    // ------------------------------------------------------------------------- voting rights
    {
      id: 'voting',
      color: 'celery',
      onColor: 'ink',
      // serious: this section carries the 2027 student-ID change, which BRIEF §2.5 puts in the calm
      // template (Lake blue, no sticker, no rotation). Checked Mon, Nov 9, 2026.
      tone: 'serious',
      title: { en: 'Voting rights', es: 'Derecho al voto' },
      short: { en: 'voting rights', es: 'el derecho al voto' },
      hook: {
        en: 'Two dates to know: mail ballot requests made before Nov 3 run out Dec 31, and student IDs stop counting at the polls Jan 1.',
        es: 'Dos fechas para tener en cuenta: las solicitudes de boleta por correo hechas antes del 3 de noviembre vencen el 31 de diciembre, y desde el 1 de enero la identificación de estudiante deja de servir para votar en persona.'
      },
      hookAfter: {
        date: '2027-01-01',
        en: 'New year, new rules: mail ballot requests made before Nov 3, 2026 ran out Dec 31, and student IDs no longer count at the polls. Sort both before the next election.',
        es: 'Año nuevo, reglas nuevas: las solicitudes de boleta por correo hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre, y la identificación de estudiante ya no sirve para votar en persona. Resuelve las dos cosas antes de la próxima elección.'
      },
      facts: [
        {
          id: 'mail-ballot-expires',
          text: {
            en: 'Florida mail ballot requests made before Nov 3, 2026 run out Dec 31, 2026. If yours is one, request again to vote by mail in the 2027 city elections or in 2028. A request made after Nov 3 should last through 2028; check My Voter Record to be sure.',
            es: 'Las solicitudes de boleta por correo en Florida hechas antes del 3 de noviembre de 2026 vencen el 31 de diciembre de 2026. Si la tuya es una de ellas, pide la boleta de nuevo para votar por correo en las elecciones municipales de 2027 o en 2028. Una solicitud hecha después del 3 de noviembre debería durar hasta 2028; revisa My Voter Record para confirmarlo.'
          },
          stat: { value: 'Dec 31', valueEs: '31 de dic.', label: { en: 'requests from before Nov 3 run out (2026)', es: 'vencen las solicitudes de antes del 3 de noviembre (2026)' } },
          source: 'https://www.flsenate.gov/Laws/Statutes/2025/101.62',
          sourceName: 'Florida Statutes s. 101.62(1)(a): a request covers elections through the end of the calendar year of the next regularly scheduled general election',
          sources: [
            { url: 'https://voteseminole.gov/how-to-vote/vote-by-mail/', name: 'Seminole County Supervisor of Elections, Vote by Mail (request online or call 407-585-8683)' }
          ],
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          staleAfter: '2026-12-31',
          note: 'Lead ruling (docs/research/00, corrected Nov 9: requests made before Nov 3, 2026 end Dec 31, 2026; one made after should run through 2028). Statute text re-read Nov 9, 2026: "One request is deemed sufficient to receive a vote-by-mail ballot for all elections through the end of the calendar year of the next regularly scheduled general election." When Seminole starts accepting 2027-28 requests is not confirmed: ask the SOE (407-585-8683) before giving a start date. data/civic.js tells people to renew from Jan 1, 2027.'
        },
        {
          id: 'student-id',
          text: {
            en: 'Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it’s being challenged in court). Bring a driver’s license, state ID, or passport, and check voteseminole.gov before you go.',
            es: 'Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar en persona (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.'
          },
          stat: { value: 'Jan 1', valueEs: '1 de ene.', label: { en: 'student IDs stop counting at the polls (2027)', es: 'la identificación de estudiante deja de servir para votar (2027)' } },
          source: 'https://flsenate.gov/Committees/BillSummaries/2026/html/991',
          sourceName: 'Florida Senate, bill summary for CS/CS/HB 991 (2026), Ch. 2026-26, signed Apr 1, 2026',
          sources: [
            { url: 'https://flsenate.gov/Session/Bill/2026/991', name: 'Florida Senate, HB 991 (2026) bill page' },
            { url: 'https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf', name: 'Federal complaint challenging the student-ID ban, filed Oct 16, 2026 (via Democracy Docket)' }
          ],
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          note: 'Required copy shape from docs/research/00: keep this wording. Do not list the full set of accepted IDs from memory; link the county elections office. Bill history re-read Nov 9, 2026: signed by officers Mar 31, approved by the Governor Apr 1, Ch. 2026-26 filed Apr 2, 2026. Lawsuit: Florida State Conference of Branches and Youth Units of the NAACP v. Byrd, filed Oct 16, 2026; Democracy Docket’s case page listed no ruling as of Nov 9, 2026. Re-check before Jan 1, 2027: if a court blocks the ban, rewrite this fact.'
        },
        {
          id: 'citizenship-check',
          text: {
            en: 'Also starting Jan 1, 2027, Florida adds a citizenship check when people register to vote or update their registration (that part is being challenged in court too). Registering for the first time? Do it early, so there’s time to sort out any questions.',
            es: 'También desde el 1 de enero de 2027, Florida agrega una verificación de ciudadanía cuando alguien se inscribe para votar o actualiza su inscripción (esa parte también está impugnada en los tribunales). ¿Te vas a inscribir por primera vez? Hazlo con tiempo, por si hay que aclarar algo.'
          },
          source: 'https://flsenate.gov/Committees/BillSummaries/2026/html/991',
          sourceName: 'Florida Senate, bill summary for CS/CS/HB 991 (2026)',
          sources: [
            { url: 'https://registertovoteflorida.gov/home', name: 'RegisterToVoteFlorida.gov (official registration site)' },
            { url: 'https://wusf.org/text/politics-issues/2026-04-01/desantis-receives-bills-voter-id-domestic-terrorist-designations', name: 'WUSF, lawsuits filed as HB 991 was signed (Apr 1, 2026): two federal suits over the proof-of-citizenship and verification rules' }
          ],
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          note: 'Senate summary, effective Jan 1, 2027: "a check of Department of Highway Safety and Motor Vehicles (DHSMV) REAL ID data related to citizenship for new voter registration applicants and voters updating registrations." Suits: Florida NAACP and Florida Alliance for Retired Americans (N.D. Fla.); League of Women Voters of Florida and others (S.D. Fla.), per WUSF. A Nov 9, 2026 news search turned up no ruling; check the dockets before launch. Say it plainly, without fearmongering, and link the official register page (docs/research/00).'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) January renewal nights: phones out, and we all renew our mail ballot requests together on the county elections site.',
            es: '(DEMO) Noches de renovación en enero: sacamos el celular y renovamos en grupo la solicitud de boleta por correo en la página de elecciones del condado.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A heads-up for students at Seminole State and UCF before the ID change, with what to bring instead.',
            es: '(DEMO) Un aviso para estudiantes de Seminole State y UCF antes del cambio de identificación, con lo que deben llevar en su lugar.'
          },
          demo: true
        }
      ],
      action: {
        type: 'vote',
        label: { en: 'Renew your mail ballot request', es: 'Renueva tu solicitud de boleta por correo' },
        page: 'vote',
        hash: 'renew-mail-ballot',
        official: 'links.vote.voteByMail'
      },
      moreActions: [
        { type: 'vote', label: { en: 'See the new ID rules', es: 'Mira las nuevas reglas de identificación' }, page: 'vote', hash: 'what-id', official: 'links.vote.countyElections' },
        {
          type: 'share',
          label: { en: 'Text 3 friends about Dec 31', es: 'Avísales a 3 amistades del 31 de diciembre' },
          labelAfter: { date: '2027-01-01', en: 'Text 3 friends about the new rules', es: 'Avísales a 3 amistades de las reglas nuevas' },
          page: 'issues',
          hash: 'voting'
        }
      ],
      eventSeries: ['renew-ready', 'text-bank', 'workshop-es', 'canvass'],
      share: {
        title: { en: 'Two voting changes', es: 'Dos cambios para votar' },
        text: {
          en: 'Heads up: Florida mail ballot requests made before Nov 3 run out Dec 31, so if you asked before then, request again for 2027-28. And from Jan 1, student IDs won’t count at the polls (it’s being challenged in court). Bring a driver’s license, state ID, or passport.',
          es: 'Ojo: las solicitudes de boleta por correo en Florida hechas antes del 3 de noviembre vencen el 31 de diciembre, así que si la pediste antes, pide la boleta de nuevo para 2027-28. Y desde el 1 de enero, la identificación de estudiante deja de servir para votar en persona (hay una demanda en contra). Lleva licencia de conducir, identificación estatal o pasaporte.'
        },
        textAfter: {
          date: '2027-01-01',
          en: 'Heads up: Florida mail ballot requests made before Nov 3, 2026 ran out Dec 31, so request again before the next election. And student IDs no longer count at the polls. Bring a driver’s license, state ID, or passport.',
          es: 'Ojo: las solicitudes de boleta por correo en Florida hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre, así que hay que pedir la boleta otra vez antes de la próxima elección. Y la identificación de estudiante ya no sirve para votar en persona. Lleva licencia de conducir, identificación estatal o pasaporte.'
        },
        page: 'issues',
        hash: 'voting'
      }
    }
  ]
};
