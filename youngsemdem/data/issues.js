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
 *   colors: { token: { role, onColor } }  colour tokens used below (report 03 "Celery City Pop" plus
 *                            its issue colours). Map each to a CSS custom property, e.g.
 *                            var(--ysd-<token>). onColor = the token to use for text on that fill.
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
 *   eventTags     [tag, ...]  filter for events data (events.html?tag=<tag>)
 *   share         { title {en,es}, text {en,es}, page, hash }  group-chat text; the share module
 *                 appends the URL: YSD.share.native({ title, text, url: YSD.share.url(href) })
 * }
 *
 * Fact = {
 *   id            stable id, referenced from quiz.js as '<issueId>.<factId>'
 *   text          {en, es}  the claim as it should read on the page
 *   stat?         { value: '$1,890', label {en,es} }  big-number treatment for cards (same in both)
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
 *   page          key in pages;  hash? (no '#');  query? ('tag=housing', no '?')
 *   official?     dotted path in YSD_CONFIG for the official link to show next to the button,
 *                 e.g. 'links.vote.voteByMail' (read it with YSD.cfg(path))
 *   demo?         true when the destination is demo content (show the DEMO label)
 * }
 *
 * Dates: calendar dates are 'YYYY-MM-DD' (no time, so no offset). Any date-time added later must
 * be ISO 8601 with the America/New_York offset, e.g. '2026-11-12T19:00:00-05:00'.
 *
 * Checked: Mon, Nov 9, 2026. Re-check every fact before launch and after each legislative session.
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
    vote: ['mail-ballot', 'voter-id', 'register', 'check', 'dates'],
    join: ['volunteer']
  },

  colors: {
    orange:        { role: 'issue fill (housing)', onColor: 'ink' },
    pink:          { role: 'issue fill (heat and insurance)', onColor: 'ink' },
    violet:        { role: 'issue fill (reproductive freedom)', onColor: 'paper' },
    bubblegum:     { role: 'issue fill (LGBTQ+ freedom)', onColor: 'ink' },
    'violet-deep': { role: 'issue fill (schools and reading)', onColor: 'paper' },
    lime:          { role: 'issue fill (wages)', onColor: 'ink' },
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
          stat: { value: '6 in 10', label: { en: 'renters pay 30%+ of income on rent', es: 'hogares que alquilan pagan 30%+ de su ingreso' } },
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
        type: 'event',
        label: { en: 'Find a renters’ night', es: 'Busca una noche para inquilinos' },
        page: 'events',
        query: 'tag=housing',
        demo: true
      },
      moreActions: [
        { type: 'share', label: { en: 'Send this to a friend who rents', es: 'Mándale esto a alguien que alquila' }, page: 'issues', hash: 'housing' },
        { type: 'join', label: { en: 'Join YDSC', es: 'Únete a YDSC' }, page: 'join' }
      ],
      eventTags: ['housing', 'meeting'],
      share: {
        title: { en: 'Rent in Seminole', es: 'El alquiler en Seminole' },
        text: {
          en: 'Median rent in Seminole is $1,890 a month and 6 in 10 renters pay 30%+ of their income on it. It’s not just you. Come to a Young Dems night with me?',
          es: 'El alquiler mediano en Seminole es de $1,890 al mes y 6 de cada 10 inquilinos pagan 30% o más de su ingreso. No eres solo tú. ¿Me acompañas a una noche de los Young Dems?'
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
        en: 'Summers keep getting hotter and insurance keeps getting pricier. Neither one is just the weather.',
        es: 'Los veranos son cada vez más calientes y los seguros cada vez más caros. Ninguna de las dos cosas es solo culpa del clima.'
      },
      facts: [
        {
          id: 'summer-2026',
          text: {
            en: 'Sanford’s summer 2026 averaged 84.1°F, tied for its 4th-hottest on record (records go back to 1948). Orlando had a record 51 days at 95°F or hotter.',
            es: 'El verano de 2026 en Sanford tuvo un promedio de 84.1 °F, empatado como el 4.º más caluroso desde 1948. Orlando tuvo un récord de 51 días a 95 °F o más.'
          },
          stat: { value: '51 days', label: { en: 'at 95°F+ in Orlando, summer 2026', es: 'a 95 °F o más en Orlando, verano de 2026' } },
          source: 'https://www.weather.gov/media/mlb/summary/AugSummer2026.pdf',
          sourceName: 'National Weather Service Melbourne, August 2026 and Summer 2026 Weather Summary, East Central Florida',
          verified: '2026-11-09',
          asOf: 'summer 2026',
          confidence: 'high',
          note: 'Sanford is 1.1°F above normal and ties 2024. Orlando was the 2nd-warmest summer on record (84.5°F); the previous 95°F-day record was 49 days in 1917.'
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
          note: 'Page 20, "Average Premiums Charged". Without wind coverage: $2,372 (homeowners), $785 (condo). Orange County: $3,610.'
        },
        {
          id: 'heat-preemption',
          text: {
            en: 'A 2024 state law (HB 433) stops Florida cities and counties from requiring heat protections for outdoor workers, like guaranteed water breaks, beyond what state or federal law requires.',
            es: 'Una ley estatal de 2024 (HB 433) impide que las ciudades y los condados de Florida exijan protecciones contra el calor para quienes trabajan al aire libre, como pausas garantizadas para tomar agua, más allá de lo que piden las leyes estatales o federales.'
          },
          source: 'https://news.wfsu.org/state-news/2024-04-12/gov-desantis-signs-worker-wage-and-heat-protection-preemptions',
          sourceName: 'WFSU Public Media, "Gov. DeSantis signs worker wage and heat protection preemptions" (Apr 12, 2024)',
          sources: [
            { url: 'https://www.flsenate.gov/Session/Bill/2024/433', name: 'Florida Senate, CS/CS/HB 433 (2024), Employment Regulations: approved Apr 11, 2024, Ch. 2024-80' }
          ],
          verified: '2026-11-09',
          asOf: '2024-07-01',
          confidence: 'high',
          note: 'The Senate bill-page summary mentions only the wage provisions; the heat preemption is described in WFSU and other coverage of the signed bill.'
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
        { type: 'event', label: { en: 'See upcoming events', es: 'Mira los próximos eventos' }, page: 'events', query: 'tag=heat', demo: true },
        { type: 'vote', label: { en: 'Get set for the next election', es: 'Prepárate para la próxima elección' }, page: 'vote', hash: 'dates' }
      ],
      eventTags: ['heat', 'insurance'],
      share: {
        title: { en: 'Heat and insurance in Seminole', es: 'Calor y seguros en Seminole' },
        text: {
          en: 'Average home insurance in Seminole: $3,545 a year. Orlando just had 51 days at 95°F or hotter. Not normal, and not just the weather.',
          es: 'Seguro de vivienda promedio en Seminole: $3,545 al año. Orlando acaba de tener 51 días a 95 °F o más. No es normal, y no es solo el clima.'
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
        en: 'Your body, your doctor, your call. Most Seminole voters said so in 2024.',
        es: 'Tu cuerpo, tu médico, tu decisión. La mayoría en Seminole lo dijo en las urnas en 2024.'
      },
      facts: [
        {
          id: 'six-week-ban',
          text: {
            en: 'Since May 1, 2024, Florida has banned most abortions after six weeks of pregnancy, with limited exceptions.',
            es: 'Desde el 1 de mayo de 2024, Florida prohíbe la mayoría de los abortos después de las seis semanas de embarazo, con pocas excepciones.'
          },
          source: 'https://www.wusf.org/courts-law/2024-05-01/floridas-6-week-abortion-ban-takes-effect-as-doctors-worry-women-will-lose-access-to-health-care',
          sourceName: 'Associated Press via WUSF, "Florida’s 6-week abortion ban takes effect" (May 1, 2024)',
          sources: [
            { url: 'https://www.flsenate.gov/Session/Bill/2023/300', name: 'Florida Senate, SB 300 (2023), Pregnancy and Parenting Support' }
          ],
          verified: '2026-11-09',
          asOf: '2024-05-01',
          confidence: 'high'
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
            en: '(DEMO) Getting members registered and ready for 2028, when every vote on the ballot counts toward that 60%.',
            es: '(DEMO) Ayudar a que cada miembro tenga su inscripción al día para 2028, cuando cada voto en la boleta cuenta para llegar a ese 60%.'
          },
          demo: true
        }
      ],
      action: {
        type: 'vote',
        label: { en: 'Check your voter registration', es: 'Revisa tu inscripción para votar' },
        page: 'vote',
        hash: 'check',
        official: 'links.vote.myVoterRecord'
      },
      moreActions: [
        { type: 'vote', label: { en: 'Renew your mail ballot request', es: 'Renueva tu solicitud de voto por correo' }, page: 'vote', hash: 'mail-ballot', official: 'links.vote.voteByMail' },
        { type: 'share', label: { en: 'Share the Seminole number', es: 'Comparte el dato de Seminole' }, page: 'issues', hash: 'repro' }
      ],
      eventTags: ['repro'],
      share: {
        title: { en: 'Seminole and Amendment 4', es: 'Seminole y la Enmienda 4' },
        text: {
          en: 'In 2024, 60.37% of Seminole voters backed Amendment 4 to protect abortion access. Statewide it fell short of the 60% it needed. Make sure you’re registered for 2028.',
          es: 'En 2024, el 60.37% de los votantes de Seminole apoyó la Enmienda 4 para proteger el acceso al aborto. En todo el estado no llegó al 60% que necesitaba. Revisa que tu inscripción esté al día para 2028.'
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
            en: 'Since May 17, 2023, a Florida law (SB 254) has banned gender-affirming prescriptions and procedures for anyone under 18.',
            es: 'Desde el 17 de mayo de 2023, una ley de Florida (SB 254) prohíbe los tratamientos y procedimientos de afirmación de género para menores de 18 años.'
          },
          source: 'https://www.flsenate.gov/Session/Bill/2023/254',
          sourceName: 'Florida Senate, CS/SB 254 (2023): approved May 17, 2023, Ch. 2023-90',
          verified: '2026-11-09',
          asOf: '2023-05-17',
          confidence: 'high',
          note: 'The bill’s own wording is "sex-reassignment prescriptions and procedures". It also bars certain public funds for these treatments.'
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
          sourceName: 'CBS12 / Sinclair syndicated report, "FDOT pulls rainbow crosswalk at Pulse nightclub overnight" (Aug 20, 2025)',
          verified: '2026-11-09',
          asOf: '2025-08-20',
          confidence: 'high',
          note: 'Seen via the syndicated story and search coverage (several outlets carried it). FDOT cited its policy against "political" markings on state roads.'
        }
      ],
      ydsc: [
        {
          text: {
            en: 'YDSC has raised money for a local charity that supports LGBTQ+ youth, with a musical theatre night in Oviedo.',
            es: 'YDSC ha recaudado fondos para una organización local que apoya a jóvenes LGBTQ+, con una noche de teatro musical en Oviedo.'
          },
          demo: false,
          source: 'https://secure.actblue.com/donate/ydscmusicaltheatre',
          sourceName: 'Young Democrats of Seminole County, ActBlue page for a musical theatre review',
          verified: '2026-11-09',
          confidence: 'med',
          note: 'The page gives June 15 but no year (search snippets suggested 2024). It does not name the charity. Do not name the venue: it is a real business.'
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
        type: 'event',
        label: { en: 'Find a Pride meetup', es: 'Busca un encuentro de Pride' },
        page: 'events',
        query: 'tag=lgbtq',
        demo: true
      },
      moreActions: [
        { type: 'join', label: { en: 'Join YDSC', es: 'Únete a YDSC' }, page: 'join' },
        { type: 'vote', label: { en: 'Check your voter registration', es: 'Revisa tu inscripción para votar' }, page: 'vote', hash: 'check', official: 'links.vote.myVoterRecord' }
      ],
      eventTags: ['lgbtq', 'social'],
      share: {
        title: { en: 'LGBTQ+ freedom in Seminole', es: 'Libertad LGBTQ+ en Seminole' },
        text: {
          en: 'The Young Dems in Seminole have raised money for local LGBTQ+ youth. Ages 14 to 39, everyone welcome. Want to check them out with me?',
          es: 'Los Young Dems de Seminole han recaudado fondos para jóvenes LGBTQ+ de aquí. De 14 a 39 años, con las puertas abiertas para todo el mundo. ¿Me acompañas a conocerlos?'
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
            es: 'En el otoño de 2023, las Escuelas Públicas del Condado de Seminole retiraron más de 30 libros. La mayoría salió porque otros distritos de la Florida Central los habían objetado, no por quejas de padres de Seminole.'
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
          note: 'PEN counts instances (one title removed in two districts counts twice). The Florida Department of Education’s own report lists far fewer (444 titles in 16 counties per Florida Phoenix), partly because it counts only final removal decisions.'
        },
        {
          id: 'school-board-nonpartisan',
          text: {
            en: 'Florida school board races are nonpartisan, so every registered voter can vote in them, independents included.',
            es: 'Las elecciones para la junta escolar en Florida no son partidistas, así que cualquier persona inscrita puede votar en ellas, tenga o no partido.'
          },
          source: 'https://www.flsenate.gov/Laws/Constitution',
          sourceName: 'Constitution of the State of Florida, Article IX, Section 4(a)',
          verified: '2026-11-09',
          asOf: '2026',
          confidence: 'high'
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
            es: '(DEMO) Vamos en grupo a la junta escolar: te avisamos cuándo es la reunión y nos sentamos en grupo.'
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
        { type: 'event', label: { en: 'Find a book swap', es: 'Busca un intercambio de libros' }, page: 'events', query: 'tag=schools', demo: true },
        { type: 'share', label: { en: 'Share with a friend who reads', es: 'Compártelo con alguien que lee' }, page: 'issues', hash: 'schools' }
      ],
      eventTags: ['schools', 'books'],
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
        en: '$15 an hour is the floor now. A single adult here needs about $25.50 to cover the basics.',
        es: 'El mínimo ya es $15 la hora. Una persona sola aquí necesita unos $25.50 para cubrir lo básico.'
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
          note: 'Tipped workers: $11.98 cash wage plus tips (WWSB).'
        },
        {
          id: 'living-wage',
          text: {
            en: 'MIT’s Living Wage Calculator puts the living wage for a single adult with no kids in Seminole at $25.52 an hour.',
            es: 'La calculadora de salario digno del MIT calcula que una persona adulta sin hijos en Seminole necesita $25.52 la hora.'
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
            en: '(DEMO) Free-food first-timer nights, because a meeting you can’t afford to get to isn’t really open.',
            es: '(DEMO) Noches para recién llegados con comida gratis, porque una reunión a la que no puedes darte el lujo de ir no está abierta de verdad.'
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
        { type: 'event', label: { en: 'Find a free-food night', es: 'Busca una noche con comida gratis' }, page: 'events', query: 'tag=social', demo: true }
      ],
      eventTags: ['wages', 'social'],
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
        en: 'Seminole has four SunRail stations, and 7 in 10 of us still drive to work alone.',
        es: 'Seminole tiene cuatro estaciones de SunRail, y 7 de cada 10 todavía vamos al trabajo manejando sin compañía.'
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
            en: 'Riders keep asking for weekend trains. A 2025 estimate put weekend SunRail service at about $26.3 million a year to run, plus about $61.8 million for more locomotives and cab cars.',
            es: 'Los pasajeros siguen pidiendo trenes los fines de semana. Un cálculo de 2025 estimó que operar SunRail los fines de semana costaría unos $26.3 millones al año, más unos $61.8 millones en locomotoras y vagones adicionales.'
          },
          source: 'https://www.clickorlando.com/news/local/2025/07/24/heres-how-much-it-could-cost-to-expand-sunrail-service-to-weekends',
          sourceName: 'WKMG News 6 / ClickOrlando, "Here’s how much it could cost to expand SunRail service to weekends" (Jul 24, 2025)',
          verified: '2026-11-09',
          asOf: '2025-07-24',
          confidence: 'med',
          note: 'A staff estimate reported by local news, not a budget. Context: Seminole County was set to put $11.5 million toward SunRail operating costs as the line moved from state to local control (ClickOrlando, Sep 23, 2025).'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) Ride together: we pick events near a SunRail station and meet on the platform.',
            es: '(DEMO) Vamos en grupo: elegimos eventos cerca de una estación de SunRail y nos vemos en el andén.'
          },
          demo: true
        },
        {
          text: {
            en: '(DEMO) A carpool board for every event, so not having a car never means missing out.',
            es: '(DEMO) Un tablero para compartir auto en cada evento, para que no tener carro nunca te deje fuera.'
          },
          demo: true
        }
      ],
      action: {
        type: 'event',
        label: { en: 'Find an event near SunRail', es: 'Busca un evento cerca de SunRail' },
        page: 'events',
        query: 'tag=transit',
        demo: true
      },
      moreActions: [
        { type: 'clip', label: { en: 'Watch the reel', es: 'Mira los videos' }, page: 'clips' },
        { type: 'share', label: { en: 'Share with your commute buddy', es: 'Compártelo con quien va contigo al trabajo' }, page: 'issues', hash: 'transit' }
      ],
      eventTags: ['transit'],
      share: {
        title: { en: 'Getting around Seminole', es: 'Moverse por Seminole' },
        text: {
          en: 'Seminole has 4 SunRail stations, but only 0.5% of us commute by transit. Riders keep asking for weekend trains. Ride to the next Young Dems thing with me?',
          es: 'Seminole tiene 4 estaciones de SunRail, pero solo el 0.5% va al trabajo en transporte público. La gente sigue pidiendo trenes los fines de semana. ¿Me acompañas al próximo evento de los Young Dems?'
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
            en: 'Decades of wastewater flowing into Lake Jesup’s creeks left it with chronic algae blooms and a thick layer of muck. It has been under a state cleanup plan since 2010.',
            es: 'Décadas de aguas residuales en los arroyos que alimentan el lago Jesup le dejaron floraciones de algas crónicas y una capa gruesa de lodo. Desde 2010 tiene un plan estatal de limpieza.'
          },
          source: 'https://www.sjrwmd.com/streamlines/work-continues-in-the-journey-to-restore-lake-jesup/',
          sourceName: 'St. Johns River Water Management District, "Work continues in the journey to restore Lake Jesup" (undated, read Nov 9, 2026)',
          sources: [
            { url: 'https://floridadep.gov/sites/default/files/jesup-bmap.pdf', name: 'Florida DEP, Final Basin Management Action Plan for the Lake Jesup Basin (April 2010)' }
          ],
          verified: '2026-11-09',
          asOf: '2026',
          confidence: 'high',
          note: 'SJRWMD gives the lake as 8,000 to 16,000 acres depending on water levels. The plan targets nitrogen and phosphorus.'
        },
        {
          id: 'fertilizer-season',
          text: {
            en: 'From June through September, Seminole County allows no nitrogen or phosphorus fertilizer on lawns, because summer storms wash it into lakes. All seven cities have similar rules.',
            es: 'De junio a septiembre, el condado de Seminole no permite fertilizantes con nitrógeno ni fósforo en el césped, porque las tormentas de verano los arrastran a los lagos. Las siete ciudades tienen reglas parecidas.'
          },
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
            en: 'The Wekiva, along Seminole’s western edge, has been a National Wild and Scenic River since Oct 13, 2000.',
            es: 'El Wekiva, en el borde oeste de Seminole, es Río Nacional Silvestre y Escénico desde el 13 de octubre de 2000.'
          },
          source: 'https://www.fws.gov/rivers/river/wekiva',
          sourceName: 'National Wild and Scenic Rivers System, Wekiva River',
          verified: '2026-11-09',
          asOf: '2000-10-13',
          confidence: 'high',
          note: '41.6 designated miles across Orange, Seminole and Lake counties. Wekiwa Springs State Park itself is in Orange County: say "the Wekiva", not "the springs in Seminole".'
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
        label: { en: 'Find a cleanup', es: 'Busca una jornada de limpieza' },
        page: 'events',
        query: 'tag=water',
        demo: true
      },
      moreActions: [
        { type: 'share', label: { en: 'Share with your lake-day crew', es: 'Compártelo con tu grupo de paseos al lago' }, page: 'issues', hash: 'water' },
        { type: 'join', label: { en: 'Join YDSC', es: 'Únete a YDSC' }, page: 'join' }
      ],
      eventTags: ['water', 'cleanup'],
      share: {
        title: { en: 'Clean water in Seminole', es: 'Agua limpia en Seminole' },
        text: {
          en: 'Lake Jesup has been under a state cleanup plan since 2010, and Seminole pauses lawn fertilizer every summer to protect the lakes. Come to a Riverwalk cleanup with me?',
          es: 'El lago Jesup tiene un plan estatal de limpieza desde 2010, y Seminole pausa el fertilizante para césped cada verano para proteger los lagos. ¿Vienes conmigo a una limpieza en el Riverwalk?'
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
      tone: 'bright',
      title: { en: 'Voting rights', es: 'Derecho al voto' },
      short: { en: 'voting rights', es: 'el derecho al voto' },
      hook: {
        en: 'Your mail ballot request runs out Dec 31, and student IDs stop counting at the polls Jan 1. Two quick fixes.',
        es: 'Tu solicitud de voto por correo vence el 31 de diciembre, y desde el 1 de enero la identificación de estudiante ya no sirve para votar. Dos cosas rápidas.'
      },
      hookAfter: {
        date: '2027-01-01',
        en: 'Old mail ballot requests ran out Dec 31, and student IDs no longer count at the polls. Two quick fixes before the next election.',
        es: 'Las solicitudes de voto por correo anteriores vencieron el 31 de diciembre, y la identificación de estudiante ya no sirve para votar. Dos cosas rápidas antes de la próxima elección.'
      },
      facts: [
        {
          id: 'mail-ballot-expires',
          text: {
            en: 'Every Florida mail ballot request on file runs out Dec 31, 2026. To vote by mail in the 2027 city elections or in 2028, request again.',
            es: 'Todas las solicitudes de voto por correo en Florida vencen el 31 de diciembre de 2026. Para votar por correo en las elecciones municipales de 2027 o en 2028, hay que pedirla de nuevo.'
          },
          stat: { value: 'Dec 31', label: { en: 'mail ballot requests run out (2026)', es: 'vencen las solicitudes de voto por correo (2026)' } },
          source: 'https://www.flsenate.gov/Laws/Statutes/2025/101.62',
          sourceName: 'Florida Statutes s. 101.62(1)(a): a request covers elections through the end of the calendar year of the next regularly scheduled general election',
          sources: [
            { url: 'https://voteseminole.gov/how-to-vote/vote-by-mail/', name: 'Seminole County Supervisor of Elections, Vote by Mail (request online or call 407-585-8683)' }
          ],
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          staleAfter: '2026-12-31',
          note: 'Lead ruling (docs/research/00). When Seminole starts accepting 2027-28 requests is not confirmed: ask the SOE (407-585-8683) before giving a start date.'
        },
        {
          id: 'student-id',
          text: {
            en: 'Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it’s being challenged in court). Bring a driver’s license, state ID or passport, and check voteseminole.gov before you go.',
            es: 'Desde el 1 de enero de 2027, Florida deja de aceptar identificaciones de estudiante para votar en persona (la medida está en disputa en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.'
          },
          stat: { value: 'Jan 1', label: { en: 'student IDs stop counting at the polls (2027)', es: 'la identificación de estudiante deja de servir para votar (2027)' } },
          source: 'https://flsenate.gov/Committees/BillSummaries/2026/html/991',
          sourceName: 'Florida Senate, bill summary for CS/CS/HB 991 (2026), Ch. 2026-26, signed Apr 1, 2026',
          sources: [
            { url: 'https://flsenate.gov/Session/Bill/2026/991', name: 'Florida Senate, HB 991 (2026) bill page' },
            { url: 'https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf', name: 'Federal complaint challenging the student-ID ban, filed Oct 16, 2026 (via Democracy Docket)' }
          ],
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          note: 'Required copy shape from docs/research/00: keep this wording. Do not list the full set of accepted IDs from memory; link the county elections office.'
        },
        {
          id: 'citizenship-check',
          text: {
            en: 'Also starting Jan 1, 2027, Florida adds a citizenship check when people register to vote or update their registration. Registering for the first time? Do it early, so there’s time to sort out any questions.',
            es: 'También desde el 1 de enero de 2027, Florida agrega una verificación de ciudadanía cuando alguien se inscribe para votar o actualiza su inscripción. ¿Te vas a inscribir por primera vez? Hazlo con tiempo, por si hay que resolver alguna pregunta.'
          },
          source: 'https://flsenate.gov/Committees/BillSummaries/2026/html/991',
          sourceName: 'Florida Senate, bill summary for CS/CS/HB 991 (2026)',
          sources: [
            { url: 'https://registertovoteflorida.gov/home', name: 'RegisterToVoteFlorida.gov (official registration site)' }
          ],
          verified: '2026-11-09',
          asOf: '2026-11-09',
          confidence: 'high',
          note: 'Senate summary: a check of DHSMV REAL ID citizenship data for new registrants and people updating their registrations, effective Jan 1, 2027. Say it plainly, without fearmongering, and link the official register page (docs/research/00).'
        }
      ],
      ydsc: [
        {
          text: {
            en: '(DEMO) January renewal nights: phones out, and we all renew our mail ballot requests together on the county elections site.',
            es: '(DEMO) Noches de renovación en enero: sacamos el celular y renovamos en grupo la solicitud de voto por correo en la página de elecciones del condado.'
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
        label: { en: 'Renew your mail ballot request', es: 'Renueva tu solicitud de voto por correo' },
        page: 'vote',
        hash: 'mail-ballot',
        official: 'links.vote.voteByMail'
      },
      moreActions: [
        { type: 'vote', label: { en: 'See the new ID rules', es: 'Mira las nuevas reglas de identificación' }, page: 'vote', hash: 'voter-id', official: 'links.vote.countyElections' },
        { type: 'share', label: { en: 'Text 3 friends about Dec 31', es: 'Avísales a 3 amistades del 31 de diciembre' }, page: 'issues', hash: 'voting' }
      ],
      eventTags: ['voting', 'textbank'],
      share: {
        title: { en: 'Two voting changes', es: 'Dos cambios para votar' },
        text: {
          en: 'Heads up: Florida mail ballot requests run out Dec 31, so request again for 2027-28. And from Jan 1, student IDs won’t work at the polls. Bring a driver’s license, state ID or passport.',
          es: 'Ojo: las solicitudes de voto por correo en Florida vencen el 31 de diciembre, así que hay que pedirla otra vez para 2027-28. Y desde el 1 de enero, la identificación de estudiante no sirve para votar. Lleva licencia de conducir, identificación estatal o pasaporte.'
        },
        textAfter: {
          date: '2027-01-01',
          en: 'Heads up: old Florida mail ballot requests ran out Dec 31, so request again before the next election. And student IDs no longer work at the polls. Bring a driver’s license, state ID or passport.',
          es: 'Ojo: las solicitudes de voto por correo anteriores en Florida vencieron el 31 de diciembre, así que hay que pedirla otra vez antes de la próxima elección. Y la identificación de estudiante ya no sirve para votar. Lleva licencia de conducir, identificación estatal o pasaporte.'
        },
        page: 'issues',
        hash: 'voting'
      }
    }
  ]
};
