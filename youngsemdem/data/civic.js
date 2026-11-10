/*!
 * data/civic.js: voting-help data for the Young Democrats of Seminole County (YDSC) site, EN + ES.
 *
 * REAL GUIDANCE, NOT DEMO (demo:false). Every date, rule and link was checked against official
 * sources on Mon Nov 9, 2026 (verified: '2026-11-09'), then re-checked the same day by a second
 * reader (statutes, SOE pages, DOS pages and case trackers re-fetched; copy, Spanish and schema
 * reviewed). There are no demo people, counts or quotes in
 * this file. The vote hub, the home "next thing to do" strip, countdowns and the make-a-plan card
 * render from it. Owner of the facts: whoever edits this file must re-verify before changing a date.
 *
 * Load: classic script, after assets/js/config.js. No modules, no fetches. Node check:
 *   node -e "global.window={};require('./data/civic.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * CONVENTIONS
 *  - Bilingual text is { en, es }. The Spanish is written for neutral Latin American readers, not
 *    translated word for word; it carries the same facts and links. Placeholders look like {name}.
 *    {url} is the share link; {link} is the site's canonical name for it, and YSD.fill(text, { link })
 *    in assets/js/config.js fills both {link} and {url}.
 *    Spanish terms, as Florida's official Spanish forms and pages use them: "voto por correo" (the
 *    method and the SOE page), "boleta por correo" (the ballot), "solicitud de boleta por correo" (the
 *    request), "inscribirse / inscripción" (registering), "registro de votante" (the voter record),
 *    "votación anticipada" (early voting), "Supervisor de Elecciones" (the SOE). Keep them consistent.
 *  - Times are ISO 8601 with the America/New_York offset (EDT -04:00 or EST -05:00, checked for each
 *    local date). allDay:true means `date` is the local midnight that starts that day: show the date,
 *    never a time. A deadline with a clock time (5 pm) has allDay:false and the exact instant.
 *  - Every factual item has `source` (one URL) and `verified` ('YYYY-MM-DD'). Extra URLs go in
 *    `sources` (array). `confidence` ('high' | 'med' | 'low') is our read of the sourcing, for editors;
 *    do not render it. sourceTitles maps every URL to a readable name for footnotes.
 *  - Links are { key, url, label, urlEs? }. `key` is a dotted path in YSD_CONFIG (assets/js/config.js,
 *    links.vote.*), or null when config has no key for that URL yet. Render the href with
 *    YSD.cfg(link.key, link.url) so a config override wins. `urlEs` is an official Spanish version
 *    (usually a Spanish PDF from the Supervisor of Elections) when one exists. Steps and FAQ answers
 *    reference links by name: linkIds: ['voteByMail', ...] -> civic.links.voteByMail.
 *  - `expires`: the instant after which an entry must stop rendering in countdowns and strips.
 *  - Calendar (assets/js/cal.js): pass { id: 'ysd-civic-' + entry.id, title, start, end, description,
 *    url, alarm }. For allDay entries pass start: entry.date.slice(0, 10) (YSD.cal reads 'YYYY-MM-DD'
 *    as all-day). YSD.cal takes one alarm: use the first value of remindersMinutesBefore.
 *  - Computed dates say so: computed: { rule, from, note{} }. Always show computed.note (or
 *    labels.computed) next to a computed date, and never drop the "confirm" advice.
 *  - status: 'confirmed' (set by law or an official page) | 'expected' (likely, not yet posted).
 *    Always show labels.expected next to an expected item.
 *  - tone: 'serious' items (rules that could cost someone a vote, problems at the polls) get the calm
 *    template: no emoji, no exclamation marks, no confetti, no donation module beside them.
 *  - Copy rules: docs/research/05 (voice) and 00 (binding rulings). The student-ID copy shape in
 *    changes[student-id].copy is required wording from 00; keep it verbatim.
 *
 * TOP LEVEL (window.YSD_DATA.civic)
 *   version, demo, verified, timezone, recheck{ by, what{} }, disclaimer{}, labels{}
 *   office          the Seminole County Supervisor of Elections (SOE): name, phone, address, links
 *   hotlines[]      { id, name{}, use{}, phone, tel, vanity?, alt[]?, languages[], hours{}?, runBy?,
 *                     nonpartisan?, linkId, source, sources?, verified, confidence, note? (editors only) }
 *   places[]        { id, name{}, kind 'city'|'unincorporated'|'unknown', next2027 'confirmed'|'expected'|
 *                     'none-known'|'unknown', electionIds[], note{}?, source?, verified?, confidence? }
 *                     (plan builder + date scope; a place with a note carries the note's source)
 *   links{}         { <linkId>: { key, url, urlEs?, label{}, note? (editors only) } } every URL the
 *                     steps use, by name
 *   nextActions[]   the home "next thing to do" strip (NEXT ACTION), windows in date order
 *   nextActionFallback { short{}, cta{} }  shown when no nextActions entry matches
 *   dates[]         elections, deadlines, expiries, rule changes (DATE ENTRY), sorted by date
 *   changes[]       "what changed" explainers (CHANGE ENTRY)
 *   steps[]         action steps (STEP ENTRY)
 *   faq[]           { id, q{}, a{}, linkIds[], tags[], source, sources?, verified, confidence }
 *   plan{}          make-a-plan builder definition (PLAN)
 *   research[]      evidence behind the plan and pledge card (do not quote numbers in UI copy
 *                   without the citation)
 *   sourceTitles{}  { <url>: { en, es, publisher } }
 *
 * DATE ENTRY
 *   id, kind: 'election' | 'registration-deadline' | 'mail-ballot-deadline' | 'expiry' | 'rule-change'
 *   title{}, short{} (one line for the home strip), detail{}? (a sentence or two for the hub)
 *   planName{}? (elections only: mid-sentence name with its article, "the 2028 general election")
 *   date (ISO), end? (ISO, elections: polls close), allDay (bool), time{}? (display label)
 *   scope[]: place ids from places[] or ['all'] (every Seminole voter)
 *   status, statusNote{}?, computed?{ rule: 'reg29'|'reg29-holiday'|'mail12'|'statute-date', from, note{} }
 *   closedPrimary? (bool), earlyVoting?{ guaranteed, minimum?{start,end}, maximum?{start,end},
 *     actual?: null (fill when the SOE posts it), note{}, source, sources[]? }
 *   mailBallotsSent?{ start, end, note{}, source }  (window the SOE mails domestic ballots, computed)
 *     In earlyVoting and mailBallotsSent, start and end are the first and last DAYS of the window
 *     (inclusive), written as the local midnight that starts each day. Show dates only.
 *   priority 1 (headline) | 2 | 3 (minor), countdown (bool: OK for a countdown widget),
 *   calendar (bool: OK to offer as .ics via YSD.cal), stepId?, changeId?, appliesTo[]? (election ids)
 *   source, sources[]?, verified, confidence, expires, editorNote? (for editors; never render)
 *   For the home "next thing to do" strip, use nextActions[] (below), not dates[].
 *
 * NEXT ACTION (home strip)
 *   id, showFrom, showUntil (ISO window), scope[] (place ids or 'all'), priority (1 beats 2),
 *   expectedFor[]? (place ids for which the related election is only expected: show labels.expected),
 *   short{}, cta{ label{}, stepId? | linkId? | plan: true | calendar: true (offer `calendar`; stepId
 *   is then the secondary link) }, dateId? (countdown target),
 *   calendar?{ title{}, description{}, date, end?, allDay } (optional reminder to offer; a timed reminder
 *   has allDay:false and an end), source, verified
 *   Pick: entries whose window contains now and whose scope matches the visitor's place (unknown
 *   place: 'all' entries only, plus any city entry if you show a city picker); lowest priority
 *   number wins; ties go to the earlier showUntil. Nothing matches: use nextActionFallback.
 *
 * CHANGE ENTRY ("what changed")
 *   id, eyebrow{}, title{}, copy{}? (required wording), short{}, body[] (array of {en,es} paragraphs),
 *   phases[]?{ from?, until?, short{} } (pick the phase whose window contains now; else use short),
 *   effective (ISO), showFrom, showUntil, tone, stepId, linkIds[],
 *   facts[]{ claim{}, source, verified, confidence }, verified
 *
 * STEP ENTRY
 *   id, order, title{}, summary{}, minutes? (rough time, only where an official page says "a few
 *   minutes"; currently unused), how[] ({en,es} bullets, in order), extra[]?{ id, title{}, body{} }
 *   (sub-cards: pre-register, deadlines, return rules), cta{ label{}, linkId }, linkIds[],
 *   dateIds[]? (related dates), hotlineIds[]? (hotlines to list as call buttons), tone,
 *   facts[]{ claim{}, source, verified, confidence }, verified
 *
 * PLAN (make-a-plan builder; see plan.howItWorks)
 *   questions[]{ id, prompt{}, help{}?, type 'single', optionsFrom? 'places'|'dates', filter?,
 *     options[]{ id, label{}, note{}?, stepId?, outcome? }, showIf?{ questionId: [optionIds] } }
 *     optionsByMethod (question 'when'), optionNotes / notes (keyed by option id)
 *   outcomes{ <id>: { title{}, body{}, deadlineLine{}?, stepIds[] } }   ids: plan | under-18 | helper
 *   labels{ method, when, getThere, with }: lowercase phrases for templates (option labels are
 *     sentence-case button text; never paste them into templates)
 *   pledge{ statement{ <outcome>: {} }, button{}, consent{}, wall{ optIn, display, counterName } }
 *   outputs{ card, calendar{ ..., description, descriptionMail }, textToSelf, textToSelfMail, invite,
 *     inviteMail }: the *Mail variants replace the others when method is 'mail'; placeholders are
 *     listed in howItWorks
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.civic = {
  version: 1,
  demo: false,
  verified: "2026-11-09",
  timezone: "America/New_York",

  recheck: {
    by: "2026-12-15",
    what: {
      en: "Before Jan 1, 2027: how the SOE treats mail-ballot requests made Nov 4 to Dec 31, 2026 (state rule says they run through 2028), any court order on HB 991, the SOE's ID page (still the pre-2027 list on Nov 9), and whether the SOE has posted the 2027 city elections. Before each election: dates, early-voting sites and hours, and every link.",
      es: "Antes del 1 de enero de 2027: cómo trata la oficina electoral las solicitudes de boleta por correo hechas entre el 4 de noviembre y el 31 de diciembre de 2026 (según la regla estatal, sirven hasta 2028), cualquier orden judicial sobre la HB 991, la página de identificaciones de la oficina (al 9 de noviembre seguía con la lista anterior a 2027) y si ya publicó las elecciones municipales de 2027. Antes de cada elección: fechas, sitios y horarios de votación anticipada, y todos los enlaces."
    }
  },

  disclaimer: {
    en: "We're the Young Democrats of Seminole County, a volunteer group, not the elections office. We checked every date and rule on this page against official sources on Nov 9, 2026. Before you act on one, confirm it at voteseminole.gov or call 407-585-8683.",
    es: "Somos los Young Democrats of Seminole County, un grupo de voluntarios, no la oficina electoral. Revisamos cada fecha y regla de esta página en fuentes oficiales el 9 de noviembre de 2026. Antes de actuar, confírmala en voteseminole.gov o llama al 407-585-8683."
  },

  labels: {
    computed: {
      en: "Computed by us from Florida law. Confirm with the Supervisor of Elections.",
      es: "Lo calculamos nosotros según la ley de Florida. Confírmalo con la oficina del Supervisor de Elecciones."
    },
    computedReg: {
      en: "Computed from Florida's 29-day registration rule. Confirm with the Supervisor of Elections.",
      es: "Calculado con la regla de Florida de los 29 días para inscribirse. Confírmalo con la oficina del Supervisor de Elecciones."
    },
    computedMail: {
      en: "Computed from Florida's 12-day mail-ballot rule. Confirm with the Supervisor of Elections.",
      es: "Calculado con la regla de Florida de los 12 días para la boleta por correo. Confírmalo con la oficina del Supervisor de Elecciones."
    },
    expected: {
      en: "Expected. The elections office hasn't posted it yet.",
      es: "Previsto. La oficina electoral todavía no lo ha publicado."
    },
    confirmed: { en: "Confirmed", es: "Confirmado" },
    inEffect: { en: "In effect", es: "Vigente" },
    lastChecked: { en: "Last checked {date}", es: "Revisado el {date}" },
    source: { en: "Source", es: "Fuente" },
    sources: { en: "Sources", es: "Fuentes" },
    today: { en: "Today", es: "Hoy" },
    tomorrow: { en: "Tomorrow", es: "Mañana" },
    daysLeft: { en: "{n} days", es: "{n} días" },
    oneDayLeft: { en: "1 day", es: "1 día" },
    officialLink: { en: "Official site", es: "Sitio oficial" },
    inSpanish: { en: "In Spanish", es: "En español" },
    notOfficial: {
      en: "Volunteer guide, not the elections office.",
      es: "Guía de voluntarios, no de la oficina electoral."
    }
  },

  office: {
    id: "soe",
    name: { en: "Seminole County Supervisor of Elections", es: "Supervisor de Elecciones del Condado de Seminole" },
    plain: { en: "the county office that runs voting", es: "la oficina del condado que organiza las elecciones" },
    phone: "407-585-8683",
    vanity: "407-585-VOTE",
    tel: "+14075858683",
    email: "elections@voteseminole.gov",
    address: "1500 E. Airport Blvd., Sanford, FL 32773",
    mailingAddress: "P.O. Box 1479, Sanford, FL 32772",
    hours: { en: "Mon to Fri, 8 am to 5 pm", es: "De lunes a viernes, de 8 a. m. a 5 p. m." },
    linkId: "countyElections",
    source: "https://voteseminole.gov/contact-us/",
    sources: [
      "https://voteseminole.gov/voters/my-voter-record/",
      "https://voteseminole.gov/how-to-vote/vote-by-mail/",
      "https://voteseminole.gov/voters/voter-guide-rights-responsibilities/"
    ],
    verified: "2026-11-09",
    confidence: "high"
  },

  hotlines: [
    {
      id: "soe",
      name: { en: "Seminole County Supervisor of Elections", es: "Supervisor de Elecciones del Condado de Seminole" },
      use: {
        en: "Your registration, mail ballot, polling place, or anything about voting in Seminole.",
        es: "Tu inscripción, tu boleta por correo, tu lugar de votación o cualquier duda sobre votar en Seminole."
      },
      phone: "407-585-8683",
      vanity: "407-585-VOTE",
      tel: "+14075858683",
      languages: [],
      hours: { en: "Mon to Fri, 8 am to 5 pm", es: "De lunes a viernes, de 8 a. m. a 5 p. m." },
      linkId: "countyElections",
      source: "https://voteseminole.gov/contact-us/",
      sources: ["https://voteseminole.gov/voters/my-voter-record/"],
      verified: "2026-11-09",
      confidence: "high",
      note: "Office hours only; phone languages aren't posted (poll workers assist in your preferred language). 407-708-7705 on voteseminole.gov is the fax, not a phone line."
    },
    {
      id: "fl-elections",
      name: {
        en: "Florida Division of Elections voter assistance hotline",
        es: "Línea de ayuda al votante de la División de Elecciones de Florida"
      },
      use: {
        en: "State-level help with registration and voting questions, in English or Spanish.",
        es: "Ayuda del estado con preguntas sobre inscripción y votación, en inglés o en español."
      },
      phone: "1-866-308-6739",
      tel: "+18663086739",
      languages: ["en", "es"],
      hours: {
        en: "Mon to Fri, 8 am to 5 pm, with longer hours around statewide deadlines and Election Day",
        es: "De lunes a viernes, de 8 a. m. a 5 p. m., con horario extendido en fechas límite estatales y el día de las elecciones"
      },
      linkId: "stateContact",
      source: "https://dos.fl.gov/elections/contacts/contact-us/",
      sources: ["https://dos.fl.gov/elections/contacts/frequently-asked-questions/faq-voter-registration/"],
      verified: "2026-11-09",
      confidence: "high",
      note: "Checked on the Division's contact page (page updated Oct 29, 2026: Voter/Election Assistance Hotline, toll-free, Mon-Fri 8 am-5 pm ET, extended hours during statewide elections) and its voter registration FAQ (\"in English and Español\"). Both load in a browser; plain scripts sometimes get blocked."
    },
    {
      id: "election-protection",
      name: { en: "Election Protection hotline (nonpartisan)", es: "Línea de Protección Electoral (no partidista)" },
      use: {
        en: "Free, nonpartisan help if something goes wrong when you try to vote.",
        es: "Ayuda gratuita y no partidista si algo sale mal cuando intentas votar."
      },
      phone: "866-687-8683",
      vanity: "866-OUR-VOTE",
      tel: "+18666878683",
      alt: [
        { lang: "es", phone: "888-839-8682", vanity: "888-VE-Y-VOTA", tel: "+18888398682" }
      ],
      languages: ["en", "es"],
      runBy: "Lawyers' Committee for Civil Rights Under Law (administers the national Election Protection coalition)",
      nonpartisan: true,
      linkId: "electionProtection",
      source: "https://866ourvote.org/",
      verified: "2026-11-09",
      confidence: "high"
    }
  ],

  places: [
    { id: "altamonte-springs", kind: "city", name: { en: "Altamonte Springs", es: "Altamonte Springs" }, next2027: "expected", electionIds: ["city-2027-lake-mary-altamonte"] },
    { id: "casselberry", kind: "city", name: { en: "Casselberry", es: "Casselberry" }, next2027: "unknown", electionIds: [] },
    { id: "lake-mary", kind: "city", name: { en: "Lake Mary", es: "Lake Mary" }, next2027: "expected", electionIds: ["city-2027-lake-mary-altamonte"] },
    { id: "longwood", kind: "city", name: { en: "Longwood", es: "Longwood" }, next2027: "unknown", electionIds: [] },
    { id: "oviedo", kind: "city", name: { en: "Oviedo", es: "Oviedo" }, next2027: "confirmed", electionIds: ["city-2027-oviedo"] },
    {
      id: "sanford", kind: "city", name: { en: "Sanford", es: "Sanford" }, next2027: "unknown", electionIds: [],
      note: {
        en: "Sanford's 2026 city races ran with the August primary, not in November.",
        es: "En 2026, las elecciones municipales de Sanford fueron con la primaria de agosto, no en noviembre."
      },
      source: "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf",
      verified: "2026-11-09",
      confidence: "high"
    },
    { id: "winter-springs", kind: "city", name: { en: "Winter Springs", es: "Winter Springs" }, next2027: "unknown", electionIds: [] },
    {
      id: "unincorporated", kind: "unincorporated",
      name: {
        en: "Outside city limits (unincorporated Seminole, like Geneva or Chuluota)",
        es: "Fuera de los límites de una ciudad (zona no incorporada de Seminole, como Geneva o Chuluota)"
      },
      next2027: "none-known", electionIds: [],
      note: {
        en: "No city election. About half of Seminole voters live outside any city.",
        es: "No hay elección municipal. Cerca de la mitad de los votantes de Seminole vive fuera de los límites de una ciudad."
      },
      source: "https://voteseminole.gov/wp-content/uploads/2026/07/Totals-of-Voters-by-Cities.pdf",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "not-sure", kind: "unknown",
      name: { en: "Not sure (your voter record shows it)", es: "No sé (aparece en tu registro de votante)" },
      next2027: "unknown", electionIds: []
    }
  ],

  links: {
    register: {
      key: "links.vote.register",
      url: "https://registertovoteflorida.gov/home",
      label: { en: "Register or update online", es: "Inscríbete o actualiza tus datos en línea" },
      note: "Florida Division of Elections online system; has an English/Spanish toggle on the same URL. Blocks scripted checks: test in a browser."
    },
    countyRegister: {
      key: "links.vote.countyRegister",
      url: "https://voteseminole.gov/voters/register-to-vote/",
      label: { en: "Seminole's register-to-vote page", es: "Página de inscripción del condado de Seminole" }
    },
    registrationFormPdf: {
      key: "links.vote.registrationFormPdf",
      url: "https://voteseminole.gov/wp-content/uploads/2026/02/1s-2040-form-ds-de-39-eng-nonfillable-20240424.pdf",
      urlEs: "https://voteseminole.gov/wp-content/uploads/2026/03/1s-2040-form-ds-de-39-spn-nonfillable-revised-20240424-202419.pdf",
      label: { en: "Paper registration form (PDF)", es: "Formulario de inscripción en papel (PDF)" }
    },
    myVoterRecord: {
      key: "links.vote.myVoterRecord",
      url: "https://voteseminole.gov/voters/my-voter-record/",
      label: { en: "Look up my voter record", es: "Buscar mi registro de votante" }
    },
    checkRegistration: {
      key: "links.vote.checkRegistration",
      url: "https://registration.dos.fl.gov/CheckVoterStatus",
      label: { en: "Florida's statewide voter lookup", es: "Búsqueda estatal de votantes de Florida" },
      note: "Loads with a browser user agent (checked 2026-11-09); bare scripts may get a 403."
    },
    voteByMail: {
      key: "links.vote.voteByMail",
      url: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
      label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" }
    },
    mailBallotRequest: {
      key: "links.vote.mailBallotRequest",
      url: "https://seminole.electionsfl.org/vrservices/mbrs",
      label: { en: "Request a mail ballot online", es: "Pedir la boleta por correo en línea" },
      note: "The 'Request Ballot' button on the SOE vote-by-mail page. Loads with a browser user agent (checked 2026-11-09); bare scripts may get a 403. Config key: links.vote.mailBallotRequest."
    },
    mailBallotFormPdf: {
      key: "links.vote.mailBallotFormPdf",
      url: "https://voteseminole.gov/wp-content/uploads/2025/09/ds-de-160-statewide-vote-by-mail-request-adoption-1.pdf",
      urlEs: "https://voteseminole.gov/wp-content/uploads/2026/03/ds-de-160-statewide-vote-by-mail-request-adoption-spanish_-04172024.pdf",
      label: { en: "Paper mail-ballot request form (PDF)", es: "Formulario en papel para pedir la boleta por correo (PDF)" }
    },
    trackBallot: {
      key: "links.vote.trackBallot",
      url: "https://voteseminole.ballottrax.net/voter/",
      label: { en: "Track my mail ballot", es: "Rastrear mi boleta por correo" },
      note: "TrackMyMailBallot (BallotTrax), linked from the SOE vote-by-mail page. Config key: links.vote.trackBallot."
    },
    mailCureFormPdf: {
      key: "links.vote.mailCureFormPdf",
      url: "https://voteseminole.gov/wp-content/uploads/2026/03/VOTE-BY-MAIL-CURE-AFFIDAVIT-dsde-139-eng-07-2019.pdf",
      urlEs: "https://voteseminole.gov/wp-content/uploads/2026/03/VOTE-BY-MAIL-CURE-AFFIDAVIT-dsde139_spa.pdf",
      label: { en: "Mail-ballot signature fix form (PDF)", es: "Formulario para corregir la firma de la boleta por correo (PDF)" }
    },
    pollingPlace: {
      key: "links.vote.pollingPlace",
      url: "https://voteseminole.dolphmap.com/",
      label: { en: "Find my polling place", es: "Encontrar mi lugar de votación" }
    },
    earlyVoting: {
      key: "links.vote.earlyVoting",
      url: "https://voteseminole.gov/how-to-vote/early-voting/",
      label: { en: "Early-voting sites and hours", es: "Sitios y horarios de votación anticipada" }
    },
    upcomingElections: {
      key: "links.vote.upcomingElections",
      url: "https://voteseminole.gov/elections/upcoming-elections/",
      label: { en: "Upcoming elections (official)", es: "Próximas elecciones (oficial)" }
    },
    electionReady: {
      key: "links.vote.electionReady",
      url: "https://voteseminole.gov/voters/are-you-election-ready/",
      label: { en: "What ID to bring (official)", es: "Qué identificación llevar (oficial)" },
      note: "SOE 'Are you Election Ready?' page: ID, polling place, mail ballot return. Its ID list is the pre-2027 list until the SOE updates it. Config key: links.vote.electionReady."
    },
    whatToExpect: {
      key: "links.vote.whatToExpect",
      url: "https://voteseminole.gov/how-to-vote/what-to-expect-at-the-polls/",
      label: { en: "What to expect at the polls", es: "Qué esperar al votar en persona" },
      note: "Config key: links.vote.whatToExpect."
    },
    voterRights: {
      key: "links.vote.voterRights",
      url: "https://voteseminole.gov/voters/voter-guide-rights-responsibilities/",
      label: { en: "Voter Bill of Rights", es: "Derechos del votante" }
    },
    soeFaq: {
      key: "links.vote.soeFaq",
      url: "https://voteseminole.gov/faqs/",
      label: { en: "Elections office FAQ", es: "Preguntas frecuentes de la oficina electoral" }
    },
    countyElections: {
      key: "links.vote.countyElections",
      url: "https://voteseminole.gov/",
      label: { en: "voteseminole.gov", es: "voteseminole.gov" }
    },
    stateElections: {
      key: "links.vote.stateElections",
      url: "https://dos.fl.gov/elections/",
      label: { en: "Florida Division of Elections", es: "División de Elecciones de Florida" }
    },
    stateContact: {
      key: "links.vote.stateContact",
      url: "https://dos.fl.gov/elections/contacts/contact-us/",
      label: { en: "Division of Elections contacts", es: "Contactos de la División de Elecciones" },
      note: "Loads with a browser user agent (checked 2026-11-09); bare scripts may be blocked."
    },
    electionProtection: {
      key: "links.vote.electionProtection",
      url: "https://866ourvote.org/",
      label: { en: "866-OUR-VOTE (Election Protection)", es: "888-VE-Y-VOTA (Protección Electoral, en español)" },
      note: "Nonpartisan; administered by the Lawyers' Committee for Civil Rights Under Law."
    },
    oviedoElections: {
      key: "links.vote.oviedoElections",
      url: "https://cityofoviedo.net/724/Elections",
      label: { en: "City of Oviedo elections", es: "Elecciones de la Ciudad de Oviedo" }
    },
    hb991: {
      key: "links.vote.hb991",
      url: "https://flsenate.gov/Session/Bill/2026/991",
      label: { en: "HB 991 (2026) on the Florida Senate site", es: "HB 991 (2026) en el sitio del Senado de Florida" }
    },
    stateVoteByMail: {
      key: "links.vote.stateVoteByMail",
      url: "https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/",
      label: { en: "Florida's vote-by-mail rules (state)", es: "Reglas del voto por correo en Florida (estado)" },
      note: "Division of Elections page; states that a request covers elections from the date it was submitted through the end of the calendar year of the next general election. Has a Spanish page selector."
    },
    electionWorkers: {
      key: "links.vote.electionWorkers",
      url: "https://voteseminole.gov/elections/become-an-election-worker/",
      label: { en: "Become an election worker (Seminole)", es: "Trabajar en las elecciones (Seminole, en inglés)" },
      note: "voteseminole.gov/ElectionWorkers redirects here (checked 2026-11-10). The page lists training and a full Election Day; the 2026 Voter Guide (p. 26) adds 'a registered or pre-registered voter in Seminole County'. No minimum hiring age is stated anywhere, so copy says 'ask'. Not in config yet: lead request to add links.vote.electionWorkers."
    },
    schoolPrograms: {
      key: "links.vote.schoolPrograms",
      url: "https://voteseminole.gov/community-news-and-the-office/school-programs/",
      label: { en: "School programs (Seminole elections office)", es: "Programas escolares (oficina electoral de Seminole, en inglés)" },
      note: "Says the office registers and pre-registers high school students 'starting at age 16' and 'can present to your class or set up a registration station at your school' (checked 2026-11-10). Not in config yet: lead request to add links.vote.schoolPrograms."
    }
  },

  nextActions: [
    {
      id: "na-renew-reminder-2026",
      showFrom: "2026-11-09T00:00:00-05:00",
      showUntil: "2027-01-01T00:00:00-05:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "Asked for a mail ballot before Nov 3? That request runs out Dec 31. Set a reminder to renew it in January, and one request covers you through 2028.",
        es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Ponte un recordatorio para renovarla en enero: una sola solicitud te cubre hasta finales de 2028."
      },
      cta: { label: { en: "Add the reminder", es: "Agregar el recordatorio" }, calendar: true, stepId: "renew-mail-ballot" },
      calendar: {
        title: { en: "Renew my mail-ballot request", es: "Renovar mi solicitud de boleta por correo" },
        description: {
          en: "Requests made before Nov 3, 2026 ended Dec 31. Renew online on Seminole's vote-by-mail page (voteseminole.gov) or call 407-585-8683, Mon to Fri, 8 am to 5 pm. Have your Florida license or ID number, or the last 4 digits of your Social Security number.",
          es: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre. Renueva la tuya en línea en la página de voto por correo de Seminole (voteseminole.gov) o llama al 407-585-8683, de lunes a viernes, de 8 a. m. a 5 p. m. Ten a mano el número de tu licencia o identificación de Florida, o los últimos 4 dígitos de tu Seguro Social."
        },
        // Mon, Jan 4, 2027, 10 am ET (BRIEF §4.4): Jan 1 is a holiday and the SOE phones are open
        // Mon to Fri, 8 am to 5 pm, so the reminder fires on the first business morning. Copy says
        // "in January"; online renewal works from Jan 1 too.
        date: "2027-01-04T10:00:00-05:00",
        end: "2027-01-04T10:30:00-05:00",
        allDay: false
      },
      dateId: "mail-requests-expire-2026",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      verified: "2026-11-09"
    },
    {
      id: "na-student-id-2026",
      showFrom: "2026-11-09T00:00:00-05:00",
      showUntil: "2027-01-01T00:00:00-05:00",
      scope: ["all"],
      priority: 2,
      short: {
        en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go.",
        es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      cta: { label: { en: "What ID to bring", es: "Qué identificación llevar" }, stepId: "what-id" },
      dateId: "id-rules-2027",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      verified: "2026-11-09"
    },
    {
      id: "na-renew-2027",
      showFrom: "2027-01-01T00:00:00-05:00",
      showUntil: "2028-03-09T17:00:00-05:00",
      scope: ["all"],
      priority: 2,
      short: {
        en: "Mail-ballot requests from before Nov 3, 2026 ended Dec 31, 2026. Renew once and you're covered for every election through 2028, including your city's if it has one.",
        es: "Las solicitudes de boleta por correo hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Renueva la tuya una vez y te cubre en todas las elecciones hasta finales de 2028, incluida la de tu ciudad si tiene una."
      },
      cta: { label: { en: "Renew my request", es: "Renovar mi solicitud" }, stepId: "renew-mail-ballot" },
      dateId: "ppp-2028-mail-deadline",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      verified: "2026-11-09"
    },
    {
      id: "na-city-2027-check",
      showFrom: "2027-08-01T00:00:00-04:00",
      showUntil: "2027-10-05T00:00:00-04:00",
      scope: ["oviedo", "lake-mary", "altamonte-springs"],
      expectedFor: ["lake-mary", "altamonte-springs"],
      priority: 1,
      short: {
        en: "Your city votes Nov 2. Registration closes Mon, Oct 4. Check yours now: just your name and date of birth.",
        es: "Tu ciudad vota el 2 de noviembre. La inscripción cierra el lunes 4 de octubre. Revisa la tuya ahora: solo necesitas tu nombre y tu fecha de nacimiento."
      },
      cta: { label: { en: "Check my registration", es: "Revisar mi inscripción" }, stepId: "check-registration" },
      dateId: "city-2027-reg-deadline",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      verified: "2026-11-09"
    },
    {
      id: "na-city-2027-plan",
      showFrom: "2027-10-05T00:00:00-04:00",
      showUntil: "2027-11-03T00:00:00-04:00",
      scope: ["oviedo", "lake-mary", "altamonte-springs"],
      expectedFor: ["lake-mary", "altamonte-springs"],
      priority: 1,
      short: {
        en: "Nov 2 is your city election. Make your plan: when, how, and who's coming with you.",
        es: "El 2 de noviembre es la elección de tu ciudad. Arma tu plan: cuándo, cómo y quién va contigo."
      },
      cta: { label: { en: "Make my plan", es: "Armar mi plan" }, plan: true },
      dateId: "city-2027-oviedo",
      source: "https://cityofoviedo.net/724/Elections",
      verified: "2026-11-09"
    },
    {
      id: "na-ppp-2028-register",
      showFrom: "2027-11-03T00:00:00-04:00",
      showUntil: "2028-02-23T00:00:00-05:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "Want a say in who gets the presidential nomination? Florida's Mar 21, 2028 primary is for registered Democrats and Republicans. Registration and party changes close Tue, Feb 22.",
        es: "¿Quieres tener voz en quién gana la candidatura presidencial? La primaria de Florida del 21 de marzo de 2028 es para quienes están inscritos como demócratas o republicanos. La inscripción y los cambios de partido cierran el martes 22 de febrero."
      },
      cta: { label: { en: "How primaries work", es: "Cómo funcionan las primarias" }, stepId: "party-and-primaries" },
      dateId: "ppp-2028-reg-deadline",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/103.101",
      verified: "2026-11-09"
    },
    {
      id: "na-ppp-2028-plan",
      showFrom: "2028-02-23T00:00:00-05:00",
      showUntil: "2028-03-22T00:00:00-04:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "Registered as a Democrat or Republican? Make your plan for the Mar 21 presidential primary.",
        es: "¿Te inscribiste como demócrata o republicano? Arma tu plan para la primaria presidencial del 21 de marzo."
      },
      cta: { label: { en: "Make my plan", es: "Armar mi plan" }, plan: true },
      dateId: "ppp-2028",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/103.101",
      verified: "2026-11-09"
    },
    {
      id: "na-primary-2028-register",
      showFrom: "2028-03-22T00:00:00-04:00",
      showUntil: "2028-07-25T00:00:00-04:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "Next up: the Aug 22 primary. Nonpartisan races like school board and judges are open to every voter. Registration closes Mon, Jul 24.",
        es: "Lo que sigue: la primaria del 22 de agosto. Las contiendas no partidistas, como la junta escolar y los jueces, están abiertas a todos los votantes. La inscripción cierra el lunes 24 de julio."
      },
      cta: { label: { en: "Check my registration", es: "Revisar mi inscripción" }, stepId: "check-registration" },
      dateId: "primary-2028-reg-deadline",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.061",
      verified: "2026-11-09"
    },
    {
      id: "na-primary-2028-plan",
      showFrom: "2028-07-25T00:00:00-04:00",
      showUntil: "2028-08-23T00:00:00-04:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "Aug 22 is primary day. Make your plan, then send it to the group chat.",
        es: "El 22 de agosto es la primaria. Arma tu plan y mándalo al chat del grupo."
      },
      cta: { label: { en: "Make my plan", es: "Armar mi plan" }, plan: true },
      dateId: "primary-2028",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.061",
      verified: "2026-11-09"
    },
    {
      id: "na-general-2028-register",
      showFrom: "2028-08-23T00:00:00-04:00",
      showUntil: "2028-10-11T00:00:00-04:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "The general election is Nov 7, 2028. Registration closes Tue, Oct 10. Check yours, and send this to one friend who just moved.",
        es: "Las elecciones generales son el 7 de noviembre de 2028. La inscripción cierra el martes 10 de octubre. Revisa la tuya y mándale esto a alguien que se acaba de mudar."
      },
      cta: { label: { en: "Check my registration", es: "Revisar mi inscripción" }, stepId: "check-registration" },
      dateId: "general-2028-reg-deadline",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      verified: "2026-11-09"
    },
    {
      id: "na-general-2028-plan",
      showFrom: "2028-10-11T00:00:00-04:00",
      showUntil: "2028-11-08T00:00:00-05:00",
      scope: ["all"],
      priority: 1,
      short: {
        en: "Nov 7 is the general election. Make your plan, then bring someone with you.",
        es: "El 7 de noviembre son las elecciones generales. Arma tu plan y lleva a alguien contigo."
      },
      cta: { label: { en: "Make my plan", es: "Armar mi plan" }, plan: true },
      dateId: "general-2028",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.031",
      verified: "2026-11-09"
    }
  ],

  nextActionFallback: {
    short: {
      en: "Check your registration before the next deadline. All it takes is your name and date of birth.",
      es: "Revisa tu inscripción antes de la próxima fecha límite. Solo necesitas tu nombre y tu fecha de nacimiento."
    },
    cta: { label: { en: "Check my registration", es: "Revisar mi inscripción" }, stepId: "check-registration" }
  },

  dates: [
    {
      id: "mail-requests-expire-2026",
      kind: "expiry",
      title: { en: "Mail-ballot requests from before Nov 3 run out", es: "Vencen las solicitudes de boleta por correo de antes del 3 de noviembre" },
      short: {
        en: "Asked for a mail ballot before the Nov 3 election? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure.",
        es: "¿Pediste la boleta por correo antes de las elecciones del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028. Revisa My Voter Record para confirmarlo."
      },
      detail: {
        en: "One request lasts from the day you make it through the end of the year of the next regular general election. That election was Nov 3, 2026, so requests made before it end Dec 31, 2026.",
        es: "Una solicitud dura desde el día en que la haces hasta el final del año de las siguientes elecciones generales ordinarias. Esas elecciones fueron el 3 de noviembre de 2026, así que las solicitudes hechas antes vencen el 31 de diciembre de 2026."
      },
      date: "2026-12-31T00:00:00-05:00",
      allDay: true,
      scope: ["all"],
      status: "confirmed",
      priority: 1,
      countdown: true,
      calendar: true,
      stepId: "renew-mail-ballot",
      changeId: "mail-ballot-expiry",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      sources: [
        "https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/",
        "https://voteseminole.gov/how-to-vote/vote-by-mail/",
        "https://cityofoviedo.net/724/Elections"
      ],
      verified: "2026-11-09",
      confidence: "high",
      expires: "2027-01-01T00:00:00-05:00"
    },
    {
      id: "id-rules-2027",
      kind: "rule-change",
      title: { en: "Student IDs stop counting at the polls", es: "La identificación de estudiante deja de servir para votar" },
      short: {
        en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go.",
        es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      detail: {
        en: "The same law, HB 991, also starts a citizenship check for new registrations and record updates that day.",
        es: "La misma ley, la HB 991, también empieza ese día a verificar la ciudadanía en las inscripciones nuevas y en los cambios de datos."
      },
      date: "2027-01-01T00:00:00-05:00",
      allDay: true,
      scope: ["all"],
      status: "confirmed",
      statusNote: {
        en: "Signed into law Apr 1, 2026. A federal lawsuit filed Oct 16, 2026 challenges the student-ID part. No ruling as of Nov 9, 2026.",
        es: "Se firmó como ley el 1 de abril de 2026. Una demanda federal presentada el 16 de octubre de 2026 impugna la parte de la identificación de estudiante. Sin fallo al 9 de noviembre de 2026."
      },
      priority: 1,
      countdown: true,
      calendar: true,
      stepId: "what-id",
      changeId: "student-id",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: [
        "https://www.flsenate.gov/Laws/Statutes/2026/101.043",
        "https://flsenate.gov/Session/Bill/2026/991",
        "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf",
        "https://www.democracydocket.com/cases/florida-student-id-ban-challenge/"
      ],
      verified: "2026-11-09",
      confidence: "high",
      expires: "2027-01-02T00:00:00-05:00"
    },
    {
      id: "license-citizenship-2027",
      kind: "rule-change",
      title: {
        en: "Florida licenses and IDs start showing citizenship",
        es: "Las licencias e identificaciones de Florida empiezan a indicar la ciudadanía"
      },
      short: {
        en: "By July 1, 2027, Florida driver licenses and ID cards issued to U.S. citizens have to show citizenship status.",
        es: "Para el 1 de julio de 2027, las licencias de conducir y tarjetas de identificación de Florida emitidas a ciudadanos estadounidenses deben indicar la ciudadanía."
      },
      date: "2027-07-01T00:00:00-04:00",
      allDay: true,
      scope: ["all"],
      status: "confirmed",
      priority: 3,
      countdown: false,
      calendar: false,
      changeId: "citizenship-check",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      verified: "2026-11-09",
      confidence: "high",
      expires: "2027-07-02T00:00:00-04:00"
    },
    {
      id: "city-2027-reg-deadline",
      kind: "registration-deadline",
      title: {
        en: "Last day to register for the Nov 2, 2027 city elections",
        es: "Último día para inscribirte para las elecciones municipales del 2 de noviembre de 2027"
      },
      short: {
        en: "Voting in a city election on Nov 2, 2027? Registration closes Mon, Oct 4, 2027.",
        es: "¿Votas en una elección municipal el 2 de noviembre de 2027? La inscripción cierra el lunes 4 de octubre de 2027."
      },
      date: "2027-10-04T00:00:00-04:00",
      allDay: true,
      scope: ["oviedo", "lake-mary", "altamonte-springs"],
      appliesTo: ["city-2027-oviedo", "city-2027-lake-mary-altamonte"],
      status: "confirmed",
      statusNote: {
        en: "The Oviedo election is confirmed. Lake Mary and Altamonte Springs are expected.",
        es: "La elección de Oviedo está confirmada. Las de Lake Mary y Altamonte Springs están previstas."
      },
      computed: {
        rule: "reg29",
        from: "city-2027-oviedo",
        note: {
          en: "29 days before Nov 2, 2027 is Mon, Oct 4, 2027 (not a holiday). Computed by us; confirm with the Supervisor of Elections.",
          es: "29 días antes del 2 de noviembre de 2027 es el lunes 4 de octubre de 2027 (no es feriado). Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "register",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/683.01", "https://cityofoviedo.net/724/Elections"],
      verified: "2026-11-09",
      confidence: "med",
      expires: "2027-10-05T00:00:00-04:00"
    },
    {
      id: "city-2027-mail-deadline",
      kind: "mail-ballot-deadline",
      title: {
        en: "Last day to ask for a mailed ballot for the Nov 2, 2027 city elections",
        es: "Último día para pedir que te envíen la boleta por correo para las elecciones municipales del 2 de noviembre de 2027"
      },
      short: {
        en: "Want your city ballot mailed? Your request has to arrive by 5 pm Thu, Oct 21, 2027.",
        es: "¿Quieres tu boleta municipal por correo? Tu solicitud tiene que llegar antes de las 5 p. m. del jueves 21 de octubre de 2027."
      },
      date: "2027-10-21T17:00:00-04:00",
      allDay: false,
      time: { en: "5 pm", es: "5 p. m." },
      scope: ["oviedo", "lake-mary", "altamonte-springs"],
      appliesTo: ["city-2027-oviedo", "city-2027-lake-mary-altamonte"],
      status: "confirmed",
      statusNote: {
        en: "The Oviedo election is confirmed. Lake Mary and Altamonte Springs are expected.",
        es: "La elección de Oviedo está confirmada. Las de Lake Mary y Altamonte Springs están previstas."
      },
      computed: {
        rule: "mail12",
        from: "city-2027-oviedo",
        note: {
          en: "Florida law: requests to have a ballot mailed are due by 5 pm on the 12th day before the election. Computed by us; confirm with the Supervisor of Elections.",
          es: "Ley de Florida: la solicitud para que te envíen la boleta por correo vence a las 5 p. m. del día 12 antes de la elección. Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "renew-mail-ballot",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      sources: ["https://voteseminole.gov/elections/upcoming-elections/"],
      verified: "2026-11-09",
      confidence: "med",
      expires: "2027-10-21T17:00:00-04:00"
    },
    {
      id: "city-2027-oviedo",
      kind: "election",
      planName: { en: "the Oviedo city election", es: "la elección municipal de Oviedo" },
      title: { en: "Oviedo city election", es: "Elección municipal de Oviedo" },
      short: {
        en: "Oviedo votes for mayor and City Council Group 1 on Tue, Nov 2, 2027. Polls open 7 am to 7 pm.",
        es: "Oviedo elige alcalde o alcaldesa y el puesto del Grupo 1 del Concejo Municipal el martes 2 de noviembre de 2027. Se vota de 7 a. m. a 7 p. m."
      },
      detail: {
        en: "Oviedo holds regular city elections every year on the first Tuesday after the first Monday in November, and the city lists the mayor and Group 1 seats as up in 2027 (both are two-year terms). If only one candidate qualifies for a seat, that race comes off the ballot, which is what happened to these same seats in 2025.",
        es: "Oviedo celebra elecciones municipales ordinarias todos los años, el primer martes después del primer lunes de noviembre, y la ciudad indica que en 2027 se eligen la alcaldía y el puesto del Grupo 1 (ambos con períodos de dos años). Si solo una persona se postula para un puesto, esa contienda sale de la boleta, como pasó con estos mismos puestos en 2025."
      },
      date: "2027-11-02T07:00:00-04:00",
      end: "2027-11-02T19:00:00-04:00",
      allDay: false,
      time: { en: "7 am to 7 pm", es: "7 a. m. a 7 p. m." },
      scope: ["oviedo"],
      status: "confirmed",
      earlyVoting: {
        guaranteed: false,
        actual: null,
        note: {
          en: "Florida doesn't require early voting for a city-only election. The Supervisor of Elections or the city decides, so watch voteseminole.gov.",
          es: "Florida no exige votación anticipada en una elección solo municipal. La decide la oficina del Supervisor de Elecciones o la ciudad, así que revisa voteseminole.gov."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.657"
      },
      priority: 1,
      countdown: true,
      calendar: true,
      stepId: "polling-place",
      source: "https://cityofoviedo.net/724/Elections",
      sources: [
        "https://www.yahoo.com/news/articles/candidates-three-seminole-cities-win-125700315.html",
        "https://voteseminole.gov/faqs/",
        "https://voteseminole.gov/elections/upcoming-elections/"
      ],
      verified: "2026-11-09",
      confidence: "high",
      expires: "2027-11-03T00:00:00-04:00"
    },
    {
      id: "city-2027-lake-mary-altamonte",
      kind: "election",
      planName: { en: "the Nov 2, 2027 city election", es: "la elección municipal del 2 de noviembre de 2027" },
      title: {
        en: "Lake Mary and Altamonte Springs city elections (expected)",
        es: "Elecciones municipales de Lake Mary y Altamonte Springs (previstas)"
      },
      short: {
        en: "Expected on Tue, Nov 2, 2027: Lake Mary commission Seats 2 and 4, and Altamonte Springs commission Districts 1 and 3.",
        es: "Previstas para el martes 2 de noviembre de 2027: los puestos 2 y 4 de la comisión de Lake Mary y los distritos 1 y 3 de la comisión de Altamonte Springs."
      },
      detail: {
        en: "Commissioners in both cities serve two-year terms, and these seats were last filled in 2025, without opposition. The elections office hasn't posted any 2027 elections yet. We'll confirm when it does.",
        es: "En las dos ciudades los comisionados tienen períodos de dos años, y estos puestos se llenaron por última vez en 2025, sin oposición. La oficina electoral todavía no ha publicado ninguna elección de 2027. Lo confirmaremos cuando lo haga."
      },
      date: "2027-11-02T07:00:00-04:00",
      end: "2027-11-02T19:00:00-04:00",
      allDay: false,
      time: { en: "7 am to 7 pm", es: "7 a. m. a 7 p. m." },
      scope: ["lake-mary", "altamonte-springs"],
      status: "expected",
      earlyVoting: {
        guaranteed: false,
        actual: null,
        note: {
          en: "Florida doesn't require early voting for a city-only election. The Supervisor of Elections or the city decides.",
          es: "Florida no exige votación anticipada en una elección solo municipal. La decide la oficina del Supervisor de Elecciones o la ciudad."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.657"
      },
      priority: 2,
      countdown: false,
      calendar: false,
      stepId: "polling-place",
      source: "https://www.yahoo.com/news/articles/candidates-three-seminole-cities-win-125700315.html",
      sources: [
        "https://voteseminole.gov/elections/upcoming-elections/",
        "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf"
      ],
      verified: "2026-11-09",
      confidence: "med",
      expires: "2027-11-03T00:00:00-04:00"
    },
    {
      id: "ppp-2028-reg-deadline",
      kind: "registration-deadline",
      title: {
        en: "Last day to register or change party for the Mar 21, 2028 presidential primary",
        es: "Último día para inscribirte o cambiar de partido para la primaria presidencial del 21 de marzo de 2028"
      },
      short: {
        en: "Registration and party changes for the presidential primary close Tue, Feb 22, 2028.",
        es: "La inscripción y los cambios de partido para la primaria presidencial cierran el martes 22 de febrero de 2028."
      },
      date: "2028-02-22T00:00:00-05:00",
      allDay: true,
      scope: ["all"],
      appliesTo: ["ppp-2028"],
      status: "confirmed",
      computed: {
        rule: "reg29-holiday",
        from: "ppp-2028",
        note: {
          en: "29 days before is Mon, Feb 21, 2028, Washington's Birthday, a Florida legal holiday, so the books close the next day. Computed by us; confirm with the Supervisor of Elections.",
          es: "29 días antes es el lunes 21 de febrero de 2028, natalicio de Washington, feriado legal en Florida, así que la inscripción cierra al día siguiente. Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "register",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/683.01", "https://voteseminole.gov/voters/register-to-vote/"],
      editorNote: "97.055(2): if the 29th day is a Sunday or legal holiday, books close the next day. Precedent: in 2024, Feb 19 (Washington's Birthday) moved PPP book closing to Tue, Feb 20, 2024 (Florida DOS 2024 election dates; Broward and Brevard SOE notices).",
      verified: "2026-11-09",
      confidence: "med",
      expires: "2028-02-23T00:00:00-05:00"
    },
    {
      id: "ppp-2028-mail-deadline",
      kind: "mail-ballot-deadline",
      title: {
        en: "Last day to ask for a mailed ballot for the presidential primary",
        es: "Último día para pedir que te envíen la boleta por correo para la primaria presidencial"
      },
      short: {
        en: "Need your presidential primary ballot mailed? Your request has to arrive by 5 pm Thu, Mar 9, 2028. A request made after Nov 3, 2026 already covers it.",
        es: "¿Necesitas que te envíen la boleta de la primaria presidencial? Tu solicitud tiene que llegar antes de las 5 p. m. del jueves 9 de marzo de 2028. Si la pediste después del 3 de noviembre de 2026, ya está cubierta."
      },
      date: "2028-03-09T17:00:00-05:00",
      allDay: false,
      time: { en: "5 pm", es: "5 p. m." },
      scope: ["all"],
      appliesTo: ["ppp-2028"],
      status: "confirmed",
      computed: {
        rule: "mail12",
        from: "ppp-2028",
        note: {
          en: "Florida law: requests to have a ballot mailed are due by 5 pm on the 12th day before the election. Computed by us; confirm with the Supervisor of Elections.",
          es: "Ley de Florida: la solicitud para que te envíen la boleta por correo vence a las 5 p. m. del día 12 antes de la elección. Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "renew-mail-ballot",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      verified: "2026-11-09",
      confidence: "med",
      expires: "2028-03-09T17:00:00-05:00"
    },
    {
      id: "ppp-2028",
      kind: "election",
      planName: { en: "the 2028 presidential primary", es: "la primaria presidencial de 2028" },
      title: { en: "Presidential preference primary", es: "Primaria de preferencia presidencial" },
      short: {
        en: "Florida's presidential primary is Tue, Mar 21, 2028. It's closed: Democrats vote in the Democratic race, Republicans in the Republican one.",
        es: "La primaria presidencial de Florida es el martes 21 de marzo de 2028. Es cerrada: los demócratas votan en la contienda demócrata y los republicanos, en la republicana."
      },
      detail: {
        en: "State law puts it on the third Tuesday in March of a presidential election year, and the Legislature can move it, so we'll recheck. Only the two major parties hold one, and a party with just one candidate doesn't appear on the ballot. Registered with no party or a minor party? The presidential primary won't be on your ballot.",
        es: "La ley estatal la fija el tercer martes de marzo de cada año de elecciones presidenciales, y la Legislatura puede cambiarla, así que lo volveremos a revisar. Solo la celebran los dos partidos principales, y un partido con un solo candidato no aparece en la boleta. ¿Te inscribiste sin partido o en un partido minoritario? La primaria presidencial no estará en tu boleta."
      },
      date: "2028-03-21T07:00:00-04:00",
      end: "2028-03-21T19:00:00-04:00",
      allDay: false,
      time: { en: "7 am to 7 pm", es: "7 a. m. a 7 p. m." },
      scope: ["all"],
      status: "confirmed",
      statusNote: {
        en: "Set by state law. The Legislature can change it before 2028.",
        es: "Fijada por ley estatal. La Legislatura puede cambiarla antes de 2028."
      },
      computed: {
        rule: "statute-date",
        from: null,
        note: {
          en: "Third Tuesday in March 2028, per state law, and the Florida Division of Elections lists Mar 21, 2028. Seminole's elections office hasn't posted 2028 dates yet.",
          es: "Tercer martes de marzo de 2028, según la ley estatal, y la División de Elecciones de Florida indica el 21 de marzo de 2028. La oficina electoral de Seminole aún no ha publicado las fechas de 2028."
        }
      },
      closedPrimary: true,
      earlyVoting: {
        guaranteed: true,
        minimum: { start: "2028-03-11T00:00:00-05:00", end: "2028-03-18T00:00:00-04:00" },
        maximum: { start: "2028-03-06T00:00:00-05:00", end: "2028-03-19T00:00:00-04:00" },
        actual: null,
        note: {
          en: "Florida requires early voting at least from the 10th to the 3rd day before (Mar 11 to 18). Seminole may add days, from Mar 6 up to Mar 19. Computed by us; the elections office posts the real dates.",
          es: "Florida exige votación anticipada por lo menos del día 10 al día 3 antes de la elección (del 11 al 18 de marzo). Seminole puede añadir días, desde el 6 hasta el 19 de marzo. Lo calculamos nosotros; la oficina electoral publica las fechas reales."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.657"
      },
      mailBallotsSent: {
        start: "2028-02-10T00:00:00-05:00",
        end: "2028-02-17T00:00:00-05:00",
        note: {
          en: "By law, the elections office mails requested ballots 40 to 33 days before (Feb 10 to 17). Computed by us.",
          es: "Por ley, la oficina electoral envía las boletas solicitadas entre 40 y 33 días antes (del 10 al 17 de febrero). Lo calculamos nosotros."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62"
      },
      priority: 1,
      countdown: true,
      calendar: true,
      stepId: "party-and-primaries",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/103.101",
      sources: [
        "https://dos.fl.gov/elections/for-voters/quick-facts-presidential-preference-primary/",
        "https://www.flsenate.gov/Laws/Statutes/2026/101.021",
        "https://voteseminole.gov/faqs/",
        "https://floridaphoenix.com/2024/03/20/chair-nikki-fried-defends-democratic-partys-move-to-cancel-primary-desantis-ridiculed-the-move/"
      ],
      editorNote: "Fla. Stat. 103.101(1) excludes minor parties; 103.101(4) keeps a one-candidate party off the ballot. That happened to the Democratic PPP in 2024 (Florida Phoenix, Mar 20, 2024). Don't use that example in site copy without the chapter's OK; confirm both parties' 2028 candidate lists after Nov 30, 2027.",
      verified: "2026-11-09",
      confidence: "high",
      expires: "2028-03-22T00:00:00-04:00"
    },
    {
      id: "primary-2028-reg-deadline",
      kind: "registration-deadline",
      title: {
        en: "Last day to register or change party for the Aug 22, 2028 primary",
        es: "Último día para inscribirte o cambiar de partido para la primaria del 22 de agosto de 2028"
      },
      short: {
        en: "Registration and party changes for the August primary close Mon, Jul 24, 2028.",
        es: "La inscripción y los cambios de partido para la primaria de agosto cierran el lunes 24 de julio de 2028."
      },
      date: "2028-07-24T00:00:00-04:00",
      allDay: true,
      scope: ["all"],
      appliesTo: ["primary-2028"],
      status: "confirmed",
      computed: {
        rule: "reg29",
        from: "primary-2028",
        note: {
          en: "29 days before Aug 22, 2028 is Mon, Jul 24, 2028 (not a holiday). Computed by us; confirm with the Supervisor of Elections.",
          es: "29 días antes del 22 de agosto de 2028 es el lunes 24 de julio de 2028 (no es feriado). Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "register",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      sources: ["https://voteseminole.gov/voters/register-to-vote/"],
      verified: "2026-11-09",
      confidence: "med",
      expires: "2028-07-25T00:00:00-04:00"
    },
    {
      id: "primary-2028-mail-deadline",
      kind: "mail-ballot-deadline",
      title: {
        en: "Last day to ask for a mailed ballot for the August primary",
        es: "Último día para pedir que te envíen la boleta por correo para la primaria de agosto"
      },
      short: {
        en: "Need your August primary ballot mailed? Ask by 5 pm Thu, Aug 10, 2028.",
        es: "¿Necesitas que te envíen la boleta de la primaria de agosto? Pídela antes de las 5 p. m. del jueves 10 de agosto de 2028."
      },
      date: "2028-08-10T17:00:00-04:00",
      allDay: false,
      time: { en: "5 pm", es: "5 p. m." },
      scope: ["all"],
      appliesTo: ["primary-2028"],
      status: "confirmed",
      computed: {
        rule: "mail12",
        from: "primary-2028",
        note: {
          en: "Florida law: requests to have a ballot mailed are due by 5 pm on the 12th day before the election. Computed by us; confirm with the Supervisor of Elections.",
          es: "Ley de Florida: la solicitud para que te envíen la boleta por correo vence a las 5 p. m. del día 12 antes de la elección. Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "renew-mail-ballot",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      verified: "2026-11-09",
      confidence: "med",
      expires: "2028-08-10T17:00:00-04:00"
    },
    {
      id: "primary-2028",
      kind: "election",
      planName: { en: "the Aug 22, 2028 primary", es: "la primaria del 22 de agosto de 2028" },
      title: { en: "Primary election", es: "Elecciones primarias" },
      short: {
        en: "Florida's primary is Tue, Aug 22, 2028. Party races are closed, but nonpartisan races like school board and judges are open to every voter.",
        es: "La primaria de Florida es el martes 22 de agosto de 2028. Las contiendas de partido son cerradas, pero las no partidistas, como la junta escolar y los jueces, están abiertas a todos los votantes."
      },
      detail: {
        en: "State law puts the primary on the Tuesday 11 weeks before the general election. If every candidate for an office is from the same party and the winner faces no one in November, every voter can vote in that race.",
        es: "La ley estatal fija la primaria el martes 11 semanas antes de las elecciones generales. Si todos los candidatos a un cargo son del mismo partido y el ganador no tendrá oponente en noviembre, todos los votantes pueden votar en esa contienda."
      },
      date: "2028-08-22T07:00:00-04:00",
      end: "2028-08-22T19:00:00-04:00",
      allDay: false,
      time: { en: "7 am to 7 pm", es: "7 a. m. a 7 p. m." },
      scope: ["all"],
      status: "confirmed",
      computed: {
        rule: "statute-date",
        from: "general-2028",
        note: {
          en: "11 weeks before Nov 7, 2028, per state law. The elections office hasn't posted 2028 dates yet.",
          es: "11 semanas antes del 7 de noviembre de 2028, según la ley estatal. La oficina electoral aún no ha publicado las fechas de 2028."
        }
      },
      closedPrimary: true,
      earlyVoting: {
        guaranteed: true,
        minimum: { start: "2028-08-12T00:00:00-04:00", end: "2028-08-19T00:00:00-04:00" },
        maximum: { start: "2028-08-07T00:00:00-04:00", end: "2028-08-20T00:00:00-04:00" },
        actual: null,
        note: {
          en: "Florida requires early voting at least from the 10th to the 3rd day before (Aug 12 to 19). Seminole may add days, from Aug 7 up to Aug 20. For the 2026 primary, Seminole offered only the minimum. Computed by us; the elections office posts the real dates.",
          es: "Florida exige votación anticipada por lo menos del día 10 al día 3 antes de la elección (del 12 al 19 de agosto). Seminole puede añadir días, desde el 7 hasta el 20 de agosto. En la primaria de 2026, Seminole ofreció solo el mínimo. Lo calculamos nosotros; la oficina electoral publica las fechas reales."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.657",
        sources: ["https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf"]
      },
      mailBallotsSent: {
        start: "2028-07-13T00:00:00-04:00",
        end: "2028-07-20T00:00:00-04:00",
        note: {
          en: "By law, the elections office mails requested ballots 40 to 33 days before (Jul 13 to 20). Computed by us.",
          es: "Por ley, la oficina electoral envía las boletas solicitadas entre 40 y 33 días antes (del 13 al 20 de julio). Lo calculamos nosotros."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62"
      },
      priority: 1,
      countdown: true,
      calendar: true,
      stepId: "party-and-primaries",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.061",
      sources: [
        "https://www.flsenate.gov/Laws/Statutes/2026/101.021",
        "https://www.flsenate.gov/Laws/Constitution",
        "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf"
      ],
      verified: "2026-11-09",
      confidence: "high",
      expires: "2028-08-23T00:00:00-04:00"
    },
    {
      id: "general-2028-reg-deadline",
      kind: "registration-deadline",
      title: {
        en: "Last day to register for the Nov 7, 2028 general election",
        es: "Último día para inscribirte para las elecciones generales del 7 de noviembre de 2028"
      },
      short: {
        en: "Registration for the 2028 general election closes Tue, Oct 10, 2028.",
        es: "La inscripción para las elecciones generales de 2028 cierra el martes 10 de octubre de 2028."
      },
      date: "2028-10-10T00:00:00-04:00",
      allDay: true,
      scope: ["all"],
      appliesTo: ["general-2028"],
      status: "confirmed",
      computed: {
        rule: "reg29-holiday",
        from: "general-2028",
        note: {
          en: "29 days before is Mon, Oct 9, 2028, Columbus Day and Farmers' Day, a Florida legal holiday, so the books close the next day. Computed by us; confirm with the Supervisor of Elections.",
          es: "29 días antes es el lunes 9 de octubre de 2028, Día de la Raza y del Agricultor (Columbus Day and Farmers' Day), feriado legal en Florida, así que la inscripción cierra al día siguiente. Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "register",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/683.01"],
      verified: "2026-11-09",
      confidence: "med",
      expires: "2028-10-11T00:00:00-04:00"
    },
    {
      id: "general-2028-mail-deadline",
      kind: "mail-ballot-deadline",
      title: {
        en: "Last day to ask for a mailed ballot for the 2028 general election",
        es: "Último día para pedir que te envíen la boleta por correo para las elecciones generales de 2028"
      },
      short: {
        en: "Need your November ballot mailed? Ask by 5 pm Thu, Oct 26, 2028.",
        es: "¿Necesitas que te envíen la boleta de noviembre? Pídela antes de las 5 p. m. del jueves 26 de octubre de 2028."
      },
      date: "2028-10-26T17:00:00-04:00",
      allDay: false,
      time: { en: "5 pm", es: "5 p. m." },
      scope: ["all"],
      appliesTo: ["general-2028"],
      status: "confirmed",
      computed: {
        rule: "mail12",
        from: "general-2028",
        note: {
          en: "Florida law: requests to have a ballot mailed are due by 5 pm on the 12th day before the election. Computed by us; confirm with the Supervisor of Elections.",
          es: "Ley de Florida: la solicitud para que te envíen la boleta por correo vence a las 5 p. m. del día 12 antes de la elección. Lo calculamos nosotros; confírmalo con la oficina del Supervisor de Elecciones."
        }
      },
      priority: 2,
      countdown: true,
      calendar: true,
      stepId: "renew-mail-ballot",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      verified: "2026-11-09",
      confidence: "med",
      expires: "2028-10-26T17:00:00-04:00"
    },
    {
      id: "general-2028",
      kind: "election",
      planName: { en: "the 2028 general election", es: "las elecciones generales de 2028" },
      title: { en: "General election", es: "Elecciones generales" },
      short: {
        en: "The 2028 general election is Tue, Nov 7, 2028. Every registered voter gets a full ballot, any party or none.",
        es: "Las elecciones generales de 2028 son el martes 7 de noviembre de 2028. Todos los votantes inscritos reciben la boleta completa, con o sin partido."
      },
      detail: {
        en: "President, Congress, state and county races, and ballot questions. Florida holds its general election on the first Tuesday after the first Monday in November of even-numbered years.",
        es: "Presidencia, Congreso, cargos estatales y del condado, y preguntas en la boleta. Florida celebra las elecciones generales el primer martes después del primer lunes de noviembre de los años pares."
      },
      date: "2028-11-07T07:00:00-05:00",
      end: "2028-11-07T19:00:00-05:00",
      allDay: false,
      time: { en: "7 am to 7 pm", es: "7 a. m. a 7 p. m." },
      scope: ["all"],
      status: "confirmed",
      computed: {
        rule: "statute-date",
        from: null,
        note: {
          en: "First Tuesday after the first Monday in November 2028, per state law.",
          es: "Primer martes después del primer lunes de noviembre de 2028, según la ley estatal."
        }
      },
      earlyVoting: {
        guaranteed: true,
        minimum: { start: "2028-10-28T00:00:00-04:00", end: "2028-11-04T00:00:00-04:00" },
        maximum: { start: "2028-10-23T00:00:00-04:00", end: "2028-11-05T00:00:00-04:00" },
        actual: null,
        note: {
          en: "Florida requires early voting at least from the 10th to the 3rd day before (Oct 28 to Nov 4). Seminole may add days, from Oct 23 up to Nov 5. For the 2026 general, Seminole offered the full 14 days. Computed by us; the elections office posts the real dates.",
          es: "Florida exige votación anticipada por lo menos del día 10 al día 3 antes de la elección (del 28 de octubre al 4 de noviembre). Seminole puede añadir días, desde el 23 de octubre hasta el 5 de noviembre. En las elecciones generales de 2026, Seminole ofreció los 14 días completos. Lo calculamos nosotros; la oficina electoral publica las fechas reales."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.657",
        sources: ["https://voteseminole.gov/how-to-vote/early-voting/"]
      },
      mailBallotsSent: {
        start: "2028-09-28T00:00:00-04:00",
        end: "2028-10-05T00:00:00-04:00",
        note: {
          en: "By law, the elections office mails requested ballots 40 to 33 days before (Sep 28 to Oct 5). Computed by us.",
          es: "Por ley, la oficina electoral envía las boletas solicitadas entre 40 y 33 días antes (del 28 de septiembre al 5 de octubre). Lo calculamos nosotros."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62"
      },
      priority: 1,
      countdown: true,
      calendar: true,
      stepId: "polling-place",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/100.031",
      sources: ["https://voteseminole.gov/faqs/"],
      verified: "2026-11-09",
      confidence: "high",
      expires: "2028-11-08T00:00:00-05:00"
    },
    {
      id: "mail-requests-expire-2028",
      kind: "expiry",
      title: { en: "This cycle's mail-ballot requests run out", es: "Vencen las solicitudes de boleta por correo de este ciclo" },
      short: {
        en: "Requests made between the Nov 3, 2026 and Nov 7, 2028 elections end Dec 31, 2028. Then you renew again.",
        es: "Las solicitudes hechas entre las elecciones del 3 de noviembre de 2026 y las del 7 de noviembre de 2028 vencen el 31 de diciembre de 2028. Después, se renueva otra vez."
      },
      date: "2028-12-31T00:00:00-05:00",
      allDay: true,
      scope: ["all"],
      status: "confirmed",
      priority: 3,
      countdown: false,
      calendar: false,
      stepId: "renew-mail-ballot",
      changeId: "mail-ballot-expiry",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      sources: ["https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/"],
      verified: "2026-11-09",
      confidence: "med",
      editorNote: "Med because Seminole hasn't said how it treats requests made Nov 4 to Dec 31, 2026; the statute and the DOS page say they run through 2028.",
      expires: "2029-01-01T00:00:00-05:00"
    }
  ],

  changes: [
    {
      id: "mail-ballot-expiry",
      eyebrow: { en: "HEADS UP", es: "OJO" },
      title: { en: "Mail-ballot requests from before Nov 3 run out Dec 31", es: "Las solicitudes de boleta por correo hechas antes del 3 de noviembre vencen el 31 de diciembre" },
      short: {
        en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure.",
        es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028. Revisa My Voter Record para confirmarlo."
      },
      phases: [
        {
          until: "2027-01-01T00:00:00-05:00",
          short: {
            en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure.",
            es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028. Revisa My Voter Record para confirmarlo."
          }
        },
        {
          from: "2027-01-01T00:00:00-05:00",
          until: "2029-01-01T00:00:00-05:00",
          short: {
            en: "Requests made before Nov 3, 2026 ended Dec 31, 2026. One new request covers every election through Dec 31, 2028.",
            es: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Una nueva te cubre en todas las elecciones hasta el 31 de diciembre de 2028."
          }
        }
      ],
      body: [
        {
          en: "In Florida, one mail-ballot request lasts from the day you make it through the end of the year of the next regular general election. That election was Nov 3, 2026, so every request made before it ends Dec 31, 2026. That's the law, not a glitch, and it happens every two years.",
          es: "En Florida, una solicitud de boleta por correo dura desde el día en que la haces hasta el final del año de las siguientes elecciones generales ordinarias. Esas elecciones fueron el 3 de noviembre de 2026, así que todas las solicitudes hechas antes vencen el 31 de diciembre de 2026. Es la ley, no un error, y pasa cada dos años."
        },
        {
          en: "Renew online, by phone at 407-585-8683, or on a signed paper form. One new request covers every election through Dec 31, 2028, including a 2027 city election if your city has one.",
          es: "Renueva la tuya en línea, por teléfono al 407-585-8683 o con un formulario en papel firmado. Una nueva solicitud te cubre en todas las elecciones hasta el 31 de diciembre de 2028, incluida una elección municipal en 2027 si tu ciudad tiene una."
        },
        {
          en: "Renewing before Jan 1? Under the state's rule, a request made after Nov 3 should already count through 2028. Seminole hasn't posted how it's handling these yet, so look yourself up on My Voter Record in January and make sure your request shows.",
          es: "¿La renuevas antes del 1 de enero? Según la regla del estado, una solicitud hecha después del 3 de noviembre ya debería servir hasta finales de 2028. Seminole todavía no ha publicado cómo las está manejando, así que búscate en My Voter Record en enero y confirma que tu solicitud aparezca."
        }
      ],
      effective: "2026-12-31T00:00:00-05:00",
      showFrom: "2026-11-09T00:00:00-05:00",
      showUntil: "2028-11-08T00:00:00-05:00",
      tone: "calm",
      stepId: "renew-mail-ballot",
      linkIds: ["voteByMail", "mailBallotRequest", "myVoterRecord", "stateVoteByMail"],
      facts: [
        {
          claim: {
            en: "One request covers all elections through the end of the calendar year of the next regularly scheduled general election.",
            es: "Una solicitud cubre todas las elecciones hasta el final del año calendario de las siguientes elecciones generales ordinarias."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "The Florida Division of Elections says a request covers all elections from the date it was submitted through the end of the calendar year of the next regularly scheduled general election, so a request made after Nov 3, 2026 should run through Dec 31, 2028.",
            es: "La División de Elecciones de Florida indica que una solicitud cubre todas las elecciones desde la fecha en que se presentó hasta el final del año calendario de las siguientes elecciones generales ordinarias, así que una solicitud hecha después del 3 de noviembre de 2026 debería servir hasta el 31 de diciembre de 2028."
          },
          source: "https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/",
          verified: "2026-11-09",
          confidence: "med"
        },
        {
          claim: {
            en: "Seminole voters can request a mail ballot online or by phone at 407-585-8683.",
            es: "Los votantes de Seminole pueden pedir la boleta por correo en línea o por teléfono al 407-585-8683."
          },
          source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Last cycle, Oviedo told residents that all vote-by-mail requests expired on 12/31/2024.",
            es: "En el ciclo anterior, Oviedo avisó que todas las solicitudes de boleta por correo vencieron el 31/12/2024."
          },
          source: "https://cityofoviedo.net/724/Elections",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "As of Nov 9, 2026, Seminole's elections office hasn't said how it handles requests made Nov 4 to Dec 31, 2026.",
            es: "Al 9 de noviembre de 2026, la oficina electoral de Seminole no ha dicho cómo maneja las solicitudes hechas entre el 4 de noviembre y el 31 de diciembre de 2026."
          },
          source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "student-id",
      eyebrow: { en: "NEW IN 2027", es: "NUEVO EN 2027" },
      title: { en: "Student IDs stop counting at the polls", es: "La identificación de estudiante deja de servir para votar" },
      copy: {
        en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go.",
        es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      short: {
        en: "From Jan 1, 2027, a student ID won't get you through check-in. Bring a driver's license, state ID, or passport.",
        es: "Desde el 1 de enero de 2027, la identificación de estudiante no sirve para votar. Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte."
      },
      body: [
        {
          en: "That means any card a school issues, even a public college or university, like a UCF or Seminole State ID. Debit and credit cards, and retirement-center, neighborhood-association, and public-assistance IDs, come off the list too. One addition: a U.S. passport card now counts.",
          es: "Eso incluye cualquier tarjeta emitida por una escuela o institución educativa, aunque sea pública, como la de UCF o Seminole State. También salen de la lista las tarjetas de débito y crédito, y las identificaciones de residencias de jubilados, asociaciones de vecinos y asistencia pública. Una novedad: ahora también sirve la tarjeta pasaporte de EE. UU."
        },
        {
          en: "At check-in you need photo and signature ID. One card with both works. If your photo ID has no signature, bring a second ID that has one. No ID? You can still vote a provisional ballot.",
          es: "Cuando te presentas a votar necesitas una identificación con foto y firma. Una sola tarjeta con las dos sirve. Si tu identificación con foto no tiene firma, lleva otra que sí la tenga. ¿Sin identificación? Igual puedes votar con una boleta provisional."
        },
        {
          en: "The new list also applies to the ID you send to fix a signature problem on a mail or provisional ballot.",
          es: "La nueva lista también se aplica a la identificación que envías para corregir un problema de firma en una boleta por correo o provisional."
        },
        {
          en: "On Oct 16, 2026, the Florida NAACP's branches and youth units sued in federal court to block the student-ID ban. As of Nov 9, 2026 there's no ruling, so plan as if the change happens. We'll update this if a court steps in.",
          es: "El 16 de octubre de 2026, las ramas y unidades juveniles de la NAACP de Florida demandaron en un tribunal federal para frenar la prohibición de la identificación de estudiante. Al 9 de noviembre de 2026 no hay fallo, así que planifica como si el cambio fuera a aplicarse. Actualizaremos esto si un tribunal interviene."
        }
      ],
      effective: "2027-01-01T00:00:00-05:00",
      showFrom: "2026-11-09T00:00:00-05:00",
      showUntil: "2028-11-08T00:00:00-05:00",
      tone: "serious",
      stepId: "what-id",
      linkIds: ["electionReady", "whatToExpect", "countyElections", "hb991"],
      facts: [
        {
          claim: {
            en: "HB 991 (Ch. 2026-26) removes student, retirement-center, neighborhood-association, and public-assistance IDs from the accepted photo IDs, effective Jan 1, 2027.",
            es: "La HB 991 (Cap. 2026-26) elimina de las identificaciones con foto aceptadas las de estudiante, residencias de jubilados, asociaciones de vecinos y asistencia pública, a partir del 1 de enero de 2027."
          },
          source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "The Governor approved HB 991 on Apr 1, 2026.",
            es: "El gobernador aprobó la HB 991 el 1 de abril de 2026."
          },
          source: "https://flsenate.gov/Session/Bill/2026/991",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "The new ID list excludes any identification card issued by an educational institution, even a government one.",
            es: "La nueva lista excluye cualquier tarjeta de identificación emitida por una institución educativa, aunque sea pública."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.043",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "The bill also removes debit and credit cards, adds the passport card, and applies the same list to provisional and mail-ballot cure affidavits.",
            es: "La ley también elimina las tarjetas de débito y crédito, añade la tarjeta pasaporte y aplica la misma lista a las declaraciones para corregir boletas provisionales y por correo."
          },
          source: "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "A federal complaint filed Oct 16, 2026 (S.D. Fla.) by the Florida State Conference of Branches and Youth Units of the NAACP challenges the student-ID ban; the case page lists no ruling as of Nov 9, 2026.",
            es: "Una demanda federal presentada el 16 de octubre de 2026 (Distrito Sur de Florida) por la Conferencia Estatal de Ramas y Unidades Juveniles de la NAACP de Florida impugna la prohibición; la página del caso no muestra fallo al 9 de noviembre de 2026."
          },
          source: "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Florida requires photo and signature ID at the polls; without it, you vote a provisional ballot.",
            es: "Florida exige identificación con foto y firma para votar en persona; sin ella, votas con una boleta provisional."
          },
          source: "https://voteseminole.gov/how-to-vote/what-to-expect-at-the-polls/",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "citizenship-check",
      eyebrow: { en: "NEW IN 2027", es: "NUEVO EN 2027" },
      title: { en: "Registrations and updates get a citizenship check", es: "Las inscripciones y los cambios de datos pasan por una verificación de ciudadanía" },
      short: {
        en: "From Jan 1, 2027, Florida checks citizenship when you register or update your record. It starts with driver-license records; if those can't confirm it, the elections office checks other records and may ask you for proof.",
        es: "Desde el 1 de enero de 2027, Florida verifica la ciudadanía cuando te inscribes o actualizas tu registro. Empieza con los registros de licencias de conducir; si con eso no se confirma, la oficina electoral revisa otros registros y puede pedirte un comprobante."
      },
      body: [
        {
          en: "Only U.S. citizens can vote in Florida, and that isn't new. What's new: starting Jan 1, 2027, when you register, or update your name, address, or party, the state checks your citizenship against driver-license and state ID records.",
          es: "Solo los ciudadanos estadounidenses pueden votar en Florida, y eso no es nuevo. Lo nuevo: desde el 1 de enero de 2027, cuando te inscribes o actualizas tu nombre, dirección o partido, el estado verifica tu ciudadanía con los registros de licencias de conducir e identificaciones estatales."
        },
        {
          en: "If those records can't confirm it, or you don't have a Florida license, state ID, or Social Security number, the Supervisor of Elections checks other government sources and may ask you for proof, like a U.S. birth certificate, a U.S. passport, or a naturalization certificate.",
          es: "Si esos registros no lo confirman, o si no tienes licencia de Florida, identificación estatal ni número de Seguro Social, la oficina del Supervisor de Elecciones revisa otras fuentes del gobierno y puede pedirte un comprobante, como un acta de nacimiento de EE. UU., un pasaporte estadounidense o un certificado de naturalización."
        },
        {
          en: "Registered by the deadline but still not confirmed when you go to vote? You'll get a provisional ballot. It counts if your citizenship is verified, or you bring proof to the elections office by 5 pm on the second day after the election.",
          es: "¿Te inscribiste a tiempo pero aún no te han confirmado cuando vas a votar? Te darán una boleta provisional. Cuenta si verifican tu ciudadanía o si llevas el comprobante a la oficina electoral antes de las 5 p. m. del segundo día después de la elección."
        },
        {
          en: "Already registered? Keep your address current and open mail from the elections office. If you get a notice, answer it by the date on it, and call 407-585-8683 with any questions.",
          es: "¿Ya te inscribiste? Mantén tu dirección al día y abre el correo de la oficina electoral. Si te llega un aviso, contéstalo antes de la fecha que indica y llama al 407-585-8683 si tienes preguntas."
        },
        {
          en: "Several federal lawsuits challenge these rules. As of Nov 9, 2026, we haven't found any court order pausing them.",
          es: "Varias demandas federales impugnan estas reglas. Al 9 de noviembre de 2026 no encontramos ninguna orden judicial que las suspenda."
        }
      ],
      effective: "2027-01-01T00:00:00-05:00",
      showFrom: "2026-11-09T00:00:00-05:00",
      showUntil: "2028-11-08T00:00:00-05:00",
      tone: "calm",
      stepId: "register",
      linkIds: ["register", "countyRegister", "myVoterRecord"],
      facts: [
        {
          claim: {
            en: "Effective Jan 1, 2027, registration requires a check of DHSMV REAL ID data related to citizenship for new applicants and voters updating registrations.",
            es: "Desde el 1 de enero de 2027, la inscripción incluye una verificación de los datos REAL ID del DHSMV sobre ciudadanía para nuevos solicitantes y votantes que actualizan su registro."
          },
          source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "If an applicant has no Florida license, ID or SSN, or DHSMV records don't show citizenship, the supervisor must verify citizenship using state and federal sources.",
            es: "Si el solicitante no tiene licencia, identificación de Florida ni número de Seguro Social, o los registros del DHSMV no muestran la ciudadanía, el supervisor debe verificarla con fuentes estatales y federales."
          },
          source: "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Accepted proof includes a U.S. birth certificate (original or certified copy), a valid U.S. passport, a naturalization certificate, a consular Report of Birth Abroad, or a Florida license or ID that shows citizenship.",
            es: "Los comprobantes aceptados incluyen el acta de nacimiento de EE. UU. (original o copia certificada), un pasaporte estadounidense vigente, un certificado de naturalización, un informe consular de nacimiento en el extranjero o una licencia o identificación de Florida que indique la ciudadanía."
          },
          source: "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "An applicant whose citizenship isn't verified by the time they vote gets a provisional ballot, counted if citizenship is verified or proof is presented by 5 pm on the second day after the election.",
            es: "Quien no tenga la ciudadanía verificada al momento de votar recibe una boleta provisional, que cuenta si se verifica la ciudadanía o si presenta el comprobante antes de las 5 p. m. del segundo día después de la elección."
          },
          source: "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Two lawsuits filed Apr 1, 2026 and a third filed Sep 1, 2026 challenge HB 991's citizenship rules; they now sit in the Southern District of Florida, and the case tracker lists motions and a trial date but no order pausing the law as of Nov 9, 2026.",
            es: "Dos demandas presentadas el 1 de abril de 2026 y una tercera del 1 de septiembre de 2026 impugnan las reglas de ciudadanía de la HB 991; ahora están en el Distrito Sur de Florida, y el registro del caso muestra mociones y una fecha de juicio, pero ninguna orden que suspenda la ley al 9 de noviembre de 2026."
          },
          source: "https://www.democracydocket.com/cases/florida-citizenship-requirement-challenge-unidosus/",
          sources: [
            "https://wusf.org/text/politics-issues/2026-04-01/desantis-receives-bills-voter-id-domestic-terrorist-designations",
            "https://www.democracydocket.com/cases/florida-citizenship-requirement-challenge/"
          ],
          verified: "2026-11-09",
          confidence: "med"
        }
      ],
      verified: "2026-11-09"
    }
  ],

  steps: [
    {
      id: "register",
      order: 1,
      title: { en: "Register or update your info", es: "Inscríbete o actualiza tus datos" },
      summary: {
        en: "A few minutes online. The same form works for first-timers, new addresses, and party changes.",
        es: "Unos minutos en línea. El mismo formulario sirve para inscribirte por primera vez, cambiar de dirección o cambiar de partido."
      },
      how: [
        {
          en: "Go to RegisterToVoteFlorida.gov (it has an English and Spanish version). Have your Florida driver license or ID card handy.",
          es: "Entra en RegisterToVoteFlorida.gov (tiene versión en inglés y en español). Ten a mano tu licencia de conducir o tarjeta de identificación de Florida."
        },
        {
          en: "Changing your name or signature, or no Florida license or ID? Use the paper form from the Supervisor of Elections (in English or Spanish), sign it, and mail it or drop it off in Sanford.",
          es: "¿Cambias tu nombre o tu firma, o no tienes licencia ni identificación de Florida? Usa el formulario en papel de la oficina del Supervisor de Elecciones (en inglés o en español), fírmalo y envíalo por correo o entrégalo en Sanford."
        },
        {
          en: "To vote in Seminole you need to be a U.S. citizen, live in Seminole County, and be 18 (16 to pre-register). The official page lists the rest.",
          es: "Para votar en Seminole tienes que ser ciudadano estadounidense, vivir en el condado de Seminole y tener 18 años (16 para preinscribirte). La página oficial explica el resto."
        },
        {
          en: "Give it up to two weeks, then look yourself up to make sure it went through.",
          es: "Espera hasta dos semanas y luego búscate en el sistema para confirmar que quedó."
        }
      ],
      extra: [
        {
          id: "pre-register",
          title: { en: "16 or 17? Pre-register", es: "¿Tienes 16 o 17? Preinscríbete" },
          body: {
            en: "Florida lets you pre-register from your 16th birthday. It turns active on your 18th birthday and the elections office mails you a voter card. If you turn 18 between the deadline and Election Day and pre-registered before the deadline, you can vote in that election.",
            es: "Florida te deja preinscribirte desde que cumples 16 años. Tu inscripción se activa el día que cumples 18 y la oficina electoral te envía tu tarjeta de votante. Si cumples 18 entre la fecha límite y el día de las elecciones, y te preinscribiste antes de la fecha límite, puedes votar en esa elección."
          }
        },
        {
          id: "deadline",
          title: { en: "The 29-day rule", es: "La regla de los 29 días" },
          body: {
            en: "Registration closes 29 days before each election, or the next day if that's a Sunday or legal holiday. Florida has no same-day registration. Address and name updates still work after the deadline; a party change made after it won't count for that primary.",
            es: "La inscripción cierra 29 días antes de cada elección, o al día siguiente si ese día es domingo o feriado legal. En Florida no te puedes inscribir el mismo día de la elección. Los cambios de dirección y de nombre se pueden hacer después de la fecha límite; un cambio de partido hecho después no cuenta para esa primaria."
          }
        }
      ],
      cta: { label: { en: "Register or update", es: "Inscribirme o actualizar" }, linkId: "register" },
      linkIds: ["register", "countyRegister", "registrationFormPdf", "myVoterRecord"],
      dateIds: ["city-2027-reg-deadline", "ppp-2028-reg-deadline", "primary-2028-reg-deadline", "general-2028-reg-deadline"],
      tone: "calm",
      facts: [
        {
          claim: {
            en: "The online application registers first-time voters, updates addresses within Florida, changes party, and requests a new voter card; name or signature updates, or problems with the online form, go on the paper application (English and Spanish), by mail or in person.",
            es: "La solicitud en línea sirve para inscribirse por primera vez, actualizar la dirección dentro de Florida, cambiar de partido y pedir una nueva tarjeta de votante; los cambios de nombre o firma, o los problemas con el formulario en línea, se resuelven con la solicitud en papel (en inglés y en español), por correo o en persona."
          },
          source: "https://voteseminole.gov/voters/register-to-vote/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "You can pre-register on or after your 16th birthday and vote in any election on or after your 18th birthday.",
            es: "Puedes preinscribirte desde que cumples 16 años y votar en cualquier elección a partir de que cumples 18."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/97.041",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Pre-registration becomes active on your 18th birthday; if that birthday falls between the deadline and Election Day and you pre-registered before the deadline, you can vote.",
            es: "La preinscripción se activa al cumplir 18; si cumples entre la fecha límite y el día de las elecciones y te preinscribiste antes de la fecha límite, puedes votar."
          },
          source: "https://voteseminole.gov/voters/register-to-vote/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Books close on the 29th day before each election (next day if a Sunday or legal holiday); name and address updates are still allowed; party changes after book closing don't apply to that primary.",
            es: "La inscripción cierra el día 29 antes de cada elección (al día siguiente si es domingo o feriado legal); se permiten cambios de nombre y dirección; los cambios de partido después del cierre no aplican a esa primaria."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/97.055",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "RegisterToVoteFlorida.gov is available in English and Spanish (state FAQ, 2018 edition; the system was rebuilt in 2023).",
            es: "RegisterToVoteFlorida.gov está disponible en inglés y en español (preguntas frecuentes del estado, edición de 2018; el sistema se renovó en 2023)."
          },
          source: "https://dos.fl.gov/media/698338/ovr-faq-spanish.pdf",
          verified: "2026-11-09",
          confidence: "med"
        },
        {
          claim: {
            en: "New registrations may take up to two weeks to appear in the lookup.",
            es: "Las inscripciones nuevas pueden tardar hasta dos semanas en aparecer en el sistema."
          },
          source: "https://voteseminole.gov/voters/my-voter-record/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "From Jan 1, 2027, online applicants without a Florida license or ID get a pre-filled form to print, sign, and deliver.",
            es: "Desde el 1 de enero de 2027, quien se inscribe en línea sin licencia ni identificación de Florida recibe un formulario prellenado para imprimir, firmar y entregar."
          },
          source: "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "check-registration",
      order: 2,
      title: { en: "Check your registration", es: "Revisa tu inscripción" },
      summary: {
        en: "All it takes is your name and date of birth. Do it before every deadline and any time you move.",
        es: "Solo necesitas tu nombre y tu fecha de nacimiento. Hazlo antes de cada fecha límite y cada vez que te mudes."
      },
      how: [
        {
          en: "Look yourself up on My Voter Record with your first name, last name, and date of birth.",
          es: "Búscate en My Voter Record (Mi registro de votante) con tu nombre, apellido y fecha de nacimiento."
        },
        {
          en: "It shows whether you're registered, your address, your mail-ballot request, where you vote, and your sample ballot.",
          es: "Ahí ves si tu inscripción está activa, tu dirección, tu solicitud de boleta por correo, dónde votas y tu boleta de muestra."
        },
        {
          en: "Registered somewhere else in Florida? Use the state's lookup.",
          es: "¿Tu inscripción es de otra parte de Florida? Usa la búsqueda del estado."
        },
        {
          en: "Renewed or replaced your Florida license since July 31, 2024? Your license number may have changed. Update your voter record so an online mail-ballot request matches.",
          es: "¿Renovaste o reemplazaste tu licencia de Florida desde el 31 de julio de 2024? Puede que tu número haya cambiado. Actualiza tu registro de votante para que coincida cuando pidas la boleta por correo en línea."
        }
      ],
      cta: { label: { en: "Look me up", es: "Buscarme" }, linkId: "myVoterRecord" },
      linkIds: ["myVoterRecord", "checkRegistration", "register"],
      tone: "calm",
      facts: [
        {
          claim: {
            en: "My Voter Record looks you up by first name, last name and date of birth and shows registration status, address, mail-ballot requests, polling place and sample ballot.",
            es: "My Voter Record te busca por nombre, apellido y fecha de nacimiento y muestra tu estado de inscripción, dirección, solicitudes de boleta por correo, lugar de votación y boleta de muestra."
          },
          source: "https://voteseminole.gov/voters/my-voter-record/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "If you renewed your license or ID since July 31, 2024, your number may have changed; update your registration before an online mail-ballot request.",
            es: "Si renovaste tu licencia o identificación desde el 31 de julio de 2024, tu número puede haber cambiado; actualiza tu inscripción antes de pedir la boleta por correo en línea."
          },
          source: "https://voteseminole.gov/voters/are-you-election-ready/",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "renew-mail-ballot",
      order: 3,
      title: { en: "Renew your mail-ballot request", es: "Renueva tu solicitud de boleta por correo" },
      summary: {
        en: "Requests made before Nov 3, 2026 end Dec 31. One new request covers 2027 and 2028.",
        es: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencen el 31 de diciembre. Una nueva te cubre en 2027 y 2028."
      },
      how: [
        {
          en: "Request online through the Supervisor of Elections, or call 407-585-8683 (Mon to Fri, 8 am to 5 pm). Doing it before Jan 1? Check My Voter Record in January to make sure it shows.",
          es: "Pídela en línea con la oficina del Supervisor de Elecciones o llama al 407-585-8683 (de lunes a viernes, de 8 a. m. a 5 p. m.). ¿La pides antes del 1 de enero? Revisa My Voter Record en enero para confirmar que aparezca."
        },
        {
          en: "Have one number ready: your Florida driver license number, your Florida ID card number, or the last four digits of your Social Security number.",
          es: "Ten a mano uno de estos números: el de tu licencia de conducir de Florida, el de tu tarjeta de identificación de Florida o los últimos cuatro dígitos de tu Seguro Social."
        },
        {
          en: "Want it sent somewhere other than the address on your record, like a dorm? That request has to be in writing, with your signature, by mail, fax, or email.",
          es: "¿Quieres que te la envíen a una dirección distinta de la de tu registro, como una residencia estudiantil? Esa solicitud tiene que ser por escrito y con tu firma, por correo, fax o email."
        },
        {
          en: "Once your ballot is printed, track it like a package.",
          es: "Cuando tu boleta ya esté impresa, puedes rastrearla como si fuera un paquete."
        }
      ],
      extra: [
        {
          id: "twelve-day",
          title: { en: "The 12-day rule", es: "La regla de los 12 días" },
          body: {
            en: "To have a ballot mailed for an election, your request has to reach the elections office by 5 pm on the 12th day before that election.",
            es: "Para que te envíen la boleta de una elección, tu solicitud tiene que llegar a la oficina electoral antes de las 5 p. m. del día 12 antes de esa elección."
          }
        },
        {
          id: "return",
          title: { en: "Getting it back on time", es: "Devolverla a tiempo" },
          body: {
            en: "Your voted ballot has to arrive by 7 pm on Election Day. Postmarks don't count. Mail it, drop it at the elections office in Sanford during business hours, or use a secure ballot intake station at an early-voting site during early-voting hours. Close to Election Day, dropping it off in person is the safer bet. On Election Day itself, the Sanford office is the only drop-off spot, until 7 pm.",
            es: "Tu boleta votada tiene que llegar antes de las 7 p. m. del día de las elecciones. El matasellos no cuenta. Envíala por correo, entrégala en la oficina electoral en Sanford en horario de oficina o déjala en una estación segura de recepción de boletas en un sitio de votación anticipada, durante ese horario. Si falta poco para el día de las elecciones, es más seguro entregarla en persona. El mismo día de las elecciones, solo se recibe en la oficina de Sanford, hasta las 7 p. m."
          }
        },
        {
          id: "cure",
          title: { en: "Forgot to sign?", es: "¿Se te olvidó firmar?" },
          body: {
            en: "If you forget to sign the envelope or your signature doesn't match, the elections office sends you a notice. Get the fix form back to the office by 5 pm on the second day after the election (in person, by mail, fax, or email), and your vote can still count.",
            es: "Si se te olvida firmar el sobre o tu firma no coincide, la oficina electoral te envía un aviso. Haz que el formulario de corrección llegue a la oficina antes de las 5 p. m. del segundo día después de la elección (en persona, por correo, fax o email) y tu voto todavía puede contar."
          }
        },
        {
          id: "who-can-ask",
          title: { en: "Who can ask for you", es: "Quién puede pedirla por ti" },
          body: {
            en: "You, or a family member or legal guardian if you directly ask them to.",
            es: "Tú, o un familiar o tu tutor legal si tú se lo pides directamente."
          }
        }
      ],
      cta: { label: { en: "Renew my request", es: "Renovar mi solicitud" }, linkId: "voteByMail" },
      linkIds: ["voteByMail", "mailBallotRequest", "mailBallotFormPdf", "trackBallot", "mailCureFormPdf", "myVoterRecord"],
      dateIds: ["mail-requests-expire-2026", "city-2027-mail-deadline", "ppp-2028-mail-deadline", "primary-2028-mail-deadline", "general-2028-mail-deadline"],
      tone: "calm",
      facts: [
        {
          claim: {
            en: "Requests by phone or in person need a Florida driver license number, Florida ID number or the last four digits of the SSN; written requests must be signed and include one of them.",
            es: "Las solicitudes por teléfono o en persona requieren el número de licencia de Florida, de identificación de Florida o los últimos cuatro dígitos del Seguro Social; las solicitudes escritas deben ir firmadas e incluir uno de ellos."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "The deadline to request a ballot be mailed is 5 pm local time on the 12th day before an election.",
            es: "La fecha límite para pedir que envíen la boleta es a las 5 p. m., hora local, del día 12 antes de la elección."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Only the voter, or a family member or guardian directly instructed by the voter, can request a mail ballot.",
            es: "Solo el votante, o un familiar o tutor que el votante haya autorizado directamente, puede pedir la boleta por correo."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Ballots must be received by 7 pm on Election Day (postmarks don't count); return by mail, at the office during business hours, or at secure intake stations at early-voting sites during early-voting hours; a different delivery address needs a signed request; signature cures are due 5 pm on the second day after the election.",
            es: "Las boletas deben llegar antes de las 7 p. m. del día de las elecciones (el matasellos no cuenta); se devuelven por correo, en la oficina en horario laboral o en las estaciones seguras de los sitios de votación anticipada en su horario; otra dirección de envío requiere solicitud firmada; las correcciones de firma vencen a las 5 p. m. del segundo día después de la elección."
          },
          source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "On Election Day, mail ballots may only be turned in at the Supervisor of Elections office, before 7 pm; the office is open Mon to Fri, 8 am to 5 pm.",
            es: "El día de las elecciones, las boletas por correo solo se pueden entregar en la oficina del Supervisor de Elecciones, antes de las 7 p. m.; la oficina abre de lunes a viernes, de 8 a. m. a 5 p. m."
          },
          source: "https://voteseminole.gov/faqs/",
          sources: ["https://voteseminole.gov/contact-us/"],
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "polling-place",
      order: 4,
      title: { en: "Find your polling place", es: "Encuentra tu lugar de votación" },
      summary: {
        en: "On Election Day you vote at one assigned spot, based on your home address. Look it up before every election.",
        es: "El día de las elecciones votas en un solo lugar asignado según tu dirección. Búscalo antes de cada elección."
      },
      how: [
        {
          en: "Find it with the address lookup map, or on your voter record, voter card, or sample ballot.",
          es: "Encuéntralo en el mapa de búsqueda por dirección, o en tu registro de votante, tu tarjeta de votante o tu boleta de muestra."
        },
        {
          en: "Polls are open 7 am to 7 pm. In line at 7 pm? Stay in line. You still get to vote.",
          es: "Se vota de 7 a. m. a 7 p. m. ¿Estás en la fila a las 7 p. m.? Quédate. Igual puedes votar."
        },
        {
          en: "Moved? Update your address first. Your polling place follows your home address.",
          es: "¿Te mudaste? Actualiza primero tu dirección. Tu lugar de votación depende de tu domicilio."
        },
        {
          en: "Early voting is different: during early voting you can use any Seminole early-voting site.",
          es: "La votación anticipada es distinta: durante ese período puedes votar en cualquier sitio de votación anticipada de Seminole."
        }
      ],
      cta: { label: { en: "Find my polling place", es: "Encontrar mi lugar" }, linkId: "pollingPlace" },
      linkIds: ["pollingPlace", "myVoterRecord", "earlyVoting"],
      tone: "calm",
      facts: [
        {
          claim: {
            en: "On Election Day you vote at your assigned neighborhood polling place, determined by your residential address and shown on your voter card, sample ballot or voter record.",
            es: "El día de las elecciones votas en el lugar asignado a tu vecindario, según tu dirección, y aparece en tu tarjeta de votante, tu boleta de muestra o tu registro."
          },
          source: "https://voteseminole.gov/voters/are-you-election-ready/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Polls in Seminole are open 7 am to 7 pm on Election Day.",
            es: "En Seminole se vota de 7 a. m. a 7 p. m. el día de las elecciones."
          },
          source: "https://voteseminole.gov/faqs/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Voters in line at the official closing of the polls have the right to vote.",
            es: "Quien está en la fila al cierre oficial tiene derecho a votar."
          },
          source: "https://voteseminole.gov/voters/voter-guide-rights-responsibilities/",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "early-voting",
      order: 5,
      title: { en: "Vote early", es: "Vota por adelantado" },
      summary: {
        en: "Open to every registered voter, at any Seminole early-voting site. The most popular way to vote here.",
        es: "La votación anticipada está abierta a todos los votantes inscritos, en cualquier sitio de Seminole. Es la forma más popular de votar aquí."
      },
      how: [
        {
          en: "During early voting you can use any Seminole early-voting site, wherever you live in the county.",
          es: "Durante la votación anticipada puedes ir a cualquier sitio de Seminole, vivas donde vivas en el condado."
        },
        {
          en: "In elections with state or federal races, Florida requires early voting at least from the 10th to the 3rd day before Election Day, 8 to 12 hours a day. Seminole can add days: for Nov 3, 2026 it ran Oct 19 to Nov 1, 7 am to 7 pm.",
          es: "En elecciones con cargos estatales o federales, Florida exige votación anticipada por lo menos del día 10 al día 3 antes de las elecciones, de 8 a 12 horas al día. Seminole puede añadir días: para el 3 de noviembre de 2026 fue del 19 de octubre al 1 de noviembre, de 7 a. m. a 7 p. m."
        },
        {
          en: "In 2026, most early-voting sites were public libraries, plus the elections office and the Oviedo Aquatic Center. Sites can change, so check the list each time.",
          es: "En 2026, la mayoría de los sitios de votación anticipada fueron bibliotecas públicas, además de la oficina electoral y el Oviedo Aquatic Center. Los sitios pueden cambiar, así que revisa la lista cada vez."
        },
        {
          en: "A city-only election, like Nov 2, 2027, doesn't have to offer early voting. Watch voteseminole.gov for what's offered.",
          es: "Una elección solo municipal, como la del 2 de noviembre de 2027, no está obligada a tener votación anticipada. Revisa voteseminole.gov para saber qué se ofrece."
        },
        {
          en: "Bring the same ID you'd bring on Election Day. You can also drop off a mail ballot there during early-voting hours.",
          es: "Lleva la misma identificación que el día de las elecciones. También puedes dejar ahí tu boleta por correo durante el horario de votación anticipada."
        }
      ],
      cta: { label: { en: "See sites and hours", es: "Ver sitios y horarios" }, linkId: "earlyVoting" },
      linkIds: ["earlyVoting", "upcomingElections"],
      tone: "calm",
      facts: [
        {
          claim: {
            en: "Early voting is open to all registered voters; during early voting you can vote at any Seminole site regardless of precinct; it is the most popular way to vote in Seminole.",
            es: "La votación anticipada está abierta a todos los votantes inscritos; en ese período puedes votar en cualquier sitio de Seminole sin importar tu precinto; es la forma más popular de votar en Seminole."
          },
          source: "https://voteseminole.gov/how-to-vote/early-voting/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Early voting runs at least the 10th through the 3rd day before an election with state or federal races, 8 to 12 hours a day; supervisors may add the 15th-11th and 2nd days; for other elections it is at the supervisor's discretion.",
            es: "La votación anticipada va por lo menos del día 10 al día 3 antes de una elección con cargos estatales o federales, de 8 a 12 horas diarias; el supervisor puede añadir los días 15 al 11 y el día 2; en otras elecciones queda a su criterio."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.657",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "2026 general early voting: Oct 19 to Nov 1, 7 am to 7 pm, at the SOE office, five branch libraries and the Oviedo Aquatic Center.",
            es: "Votación anticipada de las generales de 2026: del 19 de octubre al 1 de noviembre, de 7 a. m. a 7 p. m., en la oficina electoral, cinco bibliotecas y el Oviedo Aquatic Center."
          },
          source: "https://voteseminole.gov/how-to-vote/early-voting/",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "what-id",
      order: 6,
      title: { en: "What ID to bring", es: "Qué identificación llevar" },
      summary: {
        en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go.",
        es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      how: [
        {
          en: "Florida asks for photo and signature ID. One card with both works, like a Florida driver license. If your photo ID has no signature, bring a second ID that has one.",
          es: "Florida pide identificación con foto y firma. Una sola tarjeta con las dos sirve, como la licencia de conducir de Florida. Si tu identificación con foto no tiene firma, lleva otra que sí la tenga."
        },
        {
          en: "From Jan 1, 2027: no student IDs, including cards from public colleges and universities, and no debit or credit cards.",
          es: "Desde el 1 de enero de 2027: no se aceptan identificaciones de estudiante, ni siquiera las de instituciones educativas públicas, ni tarjetas de débito o crédito."
        },
        {
          en: "Forgot your ID? Don't leave. You can vote a provisional ballot.",
          es: "¿Se te olvidó la identificación? No te vayas. Puedes votar con una boleta provisional."
        },
        {
          en: "For the full, current list, check the Supervisor of Elections before you go.",
          es: "Para ver la lista completa y al día, revisa la página de la oficina del Supervisor de Elecciones antes de ir."
        }
      ],
      cta: { label: { en: "Check the ID list", es: "Ver la lista de identificaciones" }, linkId: "electionReady" },
      linkIds: ["electionReady", "whatToExpect", "countyElections"],
      dateIds: ["id-rules-2027"],
      tone: "serious",
      facts: [
        {
          claim: {
            en: "Florida requires photo and signature identification at the polls; one ID with both, or two that together meet the requirement; otherwise a provisional ballot.",
            es: "Florida exige identificación con foto y firma para votar en persona; una con las dos, o dos que juntas cumplan el requisito; si no, boleta provisional."
          },
          source: "https://voteseminole.gov/how-to-vote/what-to-expect-at-the-polls/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "From Jan 1, 2027 the accepted photo IDs exclude cards issued by an educational institution.",
            es: "Desde el 1 de enero de 2027 las identificaciones con foto aceptadas excluyen las emitidas por instituciones educativas."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.043",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "HB 991 removes debit and credit cards and student IDs from the accepted IDs.",
            es: "La HB 991 elimina las tarjetas de débito y crédito y las identificaciones de estudiante de la lista aceptada."
          },
          source: "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "party-and-primaries",
      order: 7,
      title: { en: "Closed primaries: should you pick a party?", es: "Primarias cerradas: ¿te conviene escoger un partido?" },
      summary: {
        en: "Your call, and either way you're welcome here. Here's the honest trade-off.",
        es: "Tú decides, y de cualquier forma aquí tienes tu lugar. Esto es lo que ganas y lo que dejas en cada caso."
      },
      how: [
        {
          en: "You don't have to pick a party to register. No party affiliation (NPA) is a real choice. Among Seminole voters 18 to 40, it's the most common one.",
          es: "No tienes que escoger un partido para inscribirte. Inscribirte sin afiliación partidista (NPA) es una opción válida. Entre los votantes de Seminole de 18 a 40 años, es la más común."
        },
        {
          en: "Florida's party primaries are closed: you only get the primary ballot of the party you're registered with. That includes the presidential primary on Mar 21, 2028.",
          es: "Las primarias de partido en Florida son cerradas: solo recibes la boleta primaria del partido en el que te inscribiste. Eso incluye la primaria presidencial del 21 de marzo de 2028."
        },
        {
          en: "NPA voters still vote in every general election, in nonpartisan races like school board, judges and city races, and in a primary race where every candidate is from one party and the winner faces no one in November.",
          es: "Los votantes NPA igual votan en todas las elecciones generales, en las contiendas no partidistas como la junta escolar, los jueces y las elecciones municipales, y en una contienda primaria donde todos los candidatos son del mismo partido y el ganador no tendrá oponente en noviembre."
        },
        {
          en: "The trade-off: joining a party lets you help pick its nominees. Staying NPA keeps you unaffiliated, and you sit out partisan primaries. Neither changes how you vote in November.",
          es: "Lo que ganas y lo que dejas: si te afilias a un partido, ayudas a escoger sus candidatos. Si sigues como NPA, no tienes afiliación y no votas en las primarias de partido. Ninguna de las dos opciones cambia cómo votas en noviembre."
        },
        {
          en: "Changing party? You can do it any time. To count for a primary, it has to be done before registration closes, 29 days ahead.",
          es: "¿Quieres cambiar de partido? Lo puedes hacer cuando quieras. Para que cuente en una primaria, tiene que hacerse antes de que cierre la inscripción, 29 días antes."
        },
        {
          en: "We're the Young Democrats, so yes, we'd love to see you in the Democratic primary. Either way, you're welcome at everything we do.",
          es: "Somos los Young Democrats, así que sí, nos encantaría verte votar en la primaria demócrata. De cualquier forma, tienes un lugar en todo lo que hacemos."
        }
      ],
      cta: { label: { en: "Update my party", es: "Actualizar mi partido" }, linkId: "register" },
      linkIds: ["register", "countyRegister", "myVoterRecord"],
      dateIds: ["ppp-2028-reg-deadline", "ppp-2028", "primary-2028-reg-deadline", "primary-2028"],
      tone: "calm",
      facts: [
        {
          claim: {
            en: "In a primary, a voter may vote only the ballot of the party in their registration.",
            es: "En una primaria, el votante solo puede votar la boleta del partido que aparece en su inscripción."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.021",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "If all candidates for an office have the same party affiliation and the winner will have no opposition in the general election, all qualified voters may vote in that primary.",
            es: "Si todos los candidatos a un cargo tienen la misma afiliación partidista y el ganador no tendrá oposición en las elecciones generales, todos los votantes pueden votar en esa primaria."
          },
          source: "https://www.flsenate.gov/Laws/Constitution",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "You don't have to choose a party to register; to vote in a party's primary you must be registered with it at least 29 days before; in general elections anyone can vote for any candidate.",
            es: "No tienes que escoger partido para inscribirte; para votar en la primaria de un partido debes estar inscrito en él al menos 29 días antes; en las generales cualquiera puede votar por cualquier candidato."
          },
          source: "https://voteseminole.gov/voters/register-to-vote/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Of 124,626 active Seminole voters aged 18 to 40 on July 1, 2026, 42,710 (34.3%) had no party affiliation, 40,696 (32.7%) were Democrats and 34,200 (27.4%) Republicans (shares computed by us from the SOE file).",
            es: "De 124,626 votantes activos de Seminole de 18 a 40 años al 1 de julio de 2026, 42,710 (34.3 %) no tenían afiliación partidista, 40,696 (32.7 %) eran demócratas y 34,200 (27.4 %) republicanos (porcentajes calculados por nosotros con el archivo de la oficina electoral)."
          },
          source: "https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "School board and circuit judge races were nonpartisan and on the August primary ballot in 2026.",
            es: "En 2026, las contiendas de la junta escolar y de jueces de circuito fueron no partidistas y estuvieron en la boleta de la primaria de agosto."
          },
          source: "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      verified: "2026-11-09"
    },
    {
      id: "problems-at-polls",
      order: 8,
      title: { en: "If something goes wrong at the polls", es: "Si algo sale mal al votar" },
      summary: {
        en: "Don't leave without voting. You have rights, and there are people whose whole job is to help.",
        es: "No te vayas sin votar. Tienes derechos, y hay gente cuyo trabajo es ayudarte."
      },
      how: [
        {
          en: "Start with a poll worker. They're trained to ask how they can help, and they can assist in your preferred language.",
          es: "Empieza por el personal electoral. Está capacitado para preguntarte cómo te puede ayudar y puede atenderte en tu idioma preferido."
        },
        {
          en: "Not on the list, no ID, or a question about your registration? You have the right to an explanation and to vote a provisional ballot. You can give the elections office proof you're eligible until 5 pm on the second day after the election.",
          es: "¿No apareces en la lista, no tienes identificación o hay dudas sobre tu inscripción? Tienes derecho a una explicación y a votar con una boleta provisional. Puedes llevar a la oficina electoral pruebas de que puedes votar hasta las 5 p. m. del segundo día después de la elección."
        },
        {
          en: "Made a mistake on your ballot? Ask for a new one before you cast it. You can get up to two replacements.",
          es: "¿Te equivocaste en la boleta? Pide otra antes de depositarla. Te pueden dar hasta dos de reemplazo."
        },
        {
          en: "In line when polls close at 7 pm? Stay in line. You still get to vote.",
          es: "¿Estás en la fila cuando cierran a las 7 p. m.? Quédate en la fila. Igual puedes votar."
        },
        {
          en: "No campaigning or handing out political material within 150 feet of the entrance. If someone's doing it, tell a poll worker.",
          es: "Nadie puede hacer campaña ni repartir material político a menos de 150 pies (unos 45 metros) de la entrada. Si alguien lo hace, avísale al personal electoral."
        },
        {
          en: "Still stuck? Call the Supervisor of Elections at 407-585-8683, the Florida Division of Elections hotline at 1-866-308-6739 (English and Spanish), or the nonpartisan Election Protection line at 866-OUR-VOTE (866-687-8683). In Spanish: 888-VE-Y-VOTA (888-839-8682).",
          es: "¿Sigues con el problema? Llama a la oficina del Supervisor de Elecciones al 407-585-8683, a la línea de la División de Elecciones de Florida al 1-866-308-6739 (inglés y español) o a la línea no partidista de Protección Electoral al 888-VE-Y-VOTA (888-839-8682), en español. En inglés: 866-OUR-VOTE (866-687-8683)."
        }
      ],
      hotlineIds: ["soe", "fl-elections", "election-protection"],
      cta: { label: { en: "Know your rights", es: "Conoce tus derechos" }, linkId: "voterRights" },
      linkIds: ["voterRights", "whatToExpect", "electionProtection", "stateContact"],
      tone: "serious",
      facts: [
        {
          claim: {
            en: "Voter Bill of Rights: assistance in voting, up to two replacement ballots, an explanation and a provisional ballot if registration or identity is in question, and voting if in line at closing.",
            es: "Derechos del votante: ayuda para votar, hasta dos boletas de reemplazo, una explicación y una boleta provisional si se cuestiona tu inscripción o identidad, y votar si estás en la fila al cierre."
          },
          source: "https://voteseminole.gov/voters/voter-guide-rights-responsibilities/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "A person casting a provisional ballot may present written evidence of eligibility until 5 pm on the second day after the election.",
            es: "Quien vota con boleta provisional puede presentar pruebas escritas de que puede votar hasta las 5 p. m. del segundo día después de la elección."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.048",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "No solicitation within 150 feet of a polling place entrance, early-voting site or secure ballot intake station; poll workers ask voters how they can help and assist in their preferred language.",
            es: "Prohibido hacer proselitismo a menos de 150 pies de la entrada de un lugar de votación, un sitio de votación anticipada o una estación segura de boletas; el personal electoral pregunta cómo ayudar y atiende en el idioma preferido."
          },
          source: "https://voteseminole.gov/how-to-vote/what-to-expect-at-the-polls/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "Election Protection (866-OUR-VOTE; Spanish 888-VE-Y-VOTA) is a national, nonpartisan coalition administered by the Lawyers' Committee for Civil Rights Under Law.",
            es: "Protección Electoral (866-OUR-VOTE; en español 888-VE-Y-VOTA) es una coalición nacional no partidista administrada por el Lawyers' Committee for Civil Rights Under Law."
          },
          source: "https://866ourvote.org/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          claim: {
            en: "The Florida Division of Elections voter assistance hotline is 1-866-308-6739 (toll-free; English and Spanish).",
            es: "La línea de ayuda al votante de la División de Elecciones de Florida es el 1-866-308-6739 (gratuita; inglés y español)."
          },
          source: "https://dos.fl.gov/elections/contacts/contact-us/",
          verified: "2026-11-09",
          confidence: "med"
        }
      ],
      verified: "2026-11-09"
    }
  ],

  faq: [
    {
      id: "faq-preregister",
      q: { en: "I'm 16. Can I register?", es: "Tengo 16 años. ¿Me puedo inscribir?" },
      a: {
        en: "Yes. Florida lets you pre-register from your 16th birthday, and it turns into a full registration on your 18th. If you turn 18 between the registration deadline and Election Day, you can vote as long as you pre-registered before the deadline.",
        es: "Sí. Florida te deja preinscribirte desde que cumples 16, y se convierte en una inscripción completa cuando cumples 18. Si cumples 18 entre la fecha límite y el día de las elecciones, puedes votar siempre que te hayas preinscrito antes de la fecha límite."
      },
      linkIds: ["register", "countyRegister"],
      tags: ["register", "under-18"],
      source: "https://voteseminole.gov/voters/register-to-vote/",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/97.041"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-party-required",
      q: { en: "Do I have to pick a party?", es: "¿Tengo que escoger un partido?" },
      a: {
        en: "No. You can register with no party affiliation (NPA). The catch: Florida's party primaries are closed, so NPA voters don't vote in them. You still vote in every general election and in nonpartisan races.",
        es: "No. Te puedes inscribir sin afiliación partidista (NPA). El detalle: las primarias de partido en Florida son cerradas, así que los votantes NPA no votan en ellas. Igual votas en todas las elecciones generales y en las contiendas no partidistas."
      },
      linkIds: ["countyRegister"],
      tags: ["party", "primaries"],
      source: "https://voteseminole.gov/voters/register-to-vote/",
      sources: ["https://voteseminole.gov/faqs/"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-npa-ballot",
      q: { en: "I'm NPA. What can I actually vote on?", es: "Soy NPA. ¿En qué puedo votar?" },
      a: {
        en: "Every race in a general election, nonpartisan races like school board, judges and city races, and ballot questions. You can also vote in a primary race when every candidate is from one party and the winner faces no one in November.",
        es: "En todas las contiendas de las elecciones generales, en las no partidistas como la junta escolar, los jueces y las municipales, y en las preguntas de la boleta. También puedes votar en una contienda primaria cuando todos los candidatos son del mismo partido y el ganador no tendrá oponente en noviembre."
      },
      linkIds: ["countyRegister"],
      tags: ["party", "primaries", "independents"],
      source: "https://www.flsenate.gov/Laws/Constitution",
      sources: ["https://voteseminole.gov/faqs/", "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-college",
      q: { en: "I go to school out of town. Where should I register?", es: "Estudio fuera de la ciudad. ¿Dónde me inscribo?" },
      a: {
        en: "Pick one place as your legal residence, home or school, and register there; you can't be registered and voting in two places at once. Staying registered in Seminole? Ask for your mail ballot to be sent to your school address, in writing, with your signature.",
        es: "Escoge un solo lugar como tu residencia legal, la casa de tu familia o donde estudias, e inscríbete ahí; no puedes estar inscrito y votar en dos lugares a la vez. ¿Sigues con tu inscripción en Seminole? Pide que te envíen la boleta por correo a tu dirección de estudiante, por escrito y con tu firma."
      },
      linkIds: ["voteByMail", "mailBallotFormPdf"],
      tags: ["students", "vote-by-mail"],
      source: "https://voteseminole.gov/faqs/",
      sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-moved",
      q: { en: "I moved. What do I do?", es: "Me mudé. ¿Qué hago?" },
      a: {
        en: "Update your address on RegisterToVoteFlorida.gov; address updates go through even after the registration deadline. Do it fast if you vote by mail: mail ballots aren't forwarded.",
        es: "Actualiza tu dirección en RegisterToVoteFlorida.gov; los cambios de dirección se aceptan incluso después de la fecha límite de inscripción. Hazlo pronto si votas por correo: las boletas no se reenvían."
      },
      linkIds: ["register", "myVoterRecord"],
      tags: ["register", "vote-by-mail"],
      source: "https://voteseminole.gov/faqs/",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/97.055"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-reregister",
      q: { en: "Do I have to register again before every election?", es: "¿Tengo que inscribirme de nuevo antes de cada elección?" },
      a: {
        en: "No. Once you're registered in Seminole, you stay on the rolls unless you move out of the county or lose your voting rights. Your mail-ballot request is different: that one has to be renewed.",
        es: "No. Una vez que te inscribes en Seminole, sigues en el padrón electoral a menos que te mudes fuera del condado o pierdas tu derecho al voto. La solicitud de boleta por correo es distinta: esa sí hay que renovarla."
      },
      linkIds: ["myVoterRecord"],
      tags: ["register"],
      source: "https://voteseminole.gov/faqs/",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-check",
      q: { en: "How do I know I'm actually registered?", es: "¿Cómo confirmo que mi inscripción está activa?" },
      a: {
        en: "Look yourself up on My Voter Record with your name and date of birth. New registrations can take up to two weeks to show up.",
        es: "Búscate en My Voter Record con tu nombre y fecha de nacimiento. Las inscripciones nuevas pueden tardar hasta dos semanas en aparecer."
      },
      linkIds: ["myVoterRecord", "checkRegistration"],
      tags: ["register"],
      source: "https://voteseminole.gov/voters/my-voter-record/",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-mail-expire",
      q: { en: "I already asked for a mail ballot. Am I set for 2027?", es: "Ya pedí la boleta por correo. ¿Me sirve para 2027?" },
      a: {
        en: "Depends on when you asked. Before the Nov 3, 2026 election: no, that request ends Dec 31, 2026, so renew it in January and you're covered through Dec 31, 2028. After Nov 3: under the state's rule it should already run through 2028, but check My Voter Record in January to be sure.",
        es: "Depende de cuándo la pediste. Antes de las elecciones del 3 de noviembre de 2026: no, esa solicitud vence el 31 de diciembre de 2026; si la renuevas en enero, te cubre hasta el 31 de diciembre de 2028. Después del 3 de noviembre: según la regla del estado ya debería servir hasta finales de 2028, pero revisa My Voter Record en enero para confirmarlo."
      },
      linkIds: ["voteByMail", "mailBallotRequest", "myVoterRecord"],
      tags: ["vote-by-mail", "2027"],
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      sources: ["https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/", "https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09",
      confidence: "med"
    },
    {
      id: "faq-mail-number",
      q: { en: "What do I need to request a mail ballot?", es: "¿Qué necesito para pedir la boleta por correo?" },
      a: {
        en: "Your name, address, date of birth, and one number: your Florida driver license number, Florida ID number, or the last four digits of your Social Security number. Request online or call 407-585-8683.",
        es: "Tu nombre, dirección, fecha de nacimiento y un número: el de tu licencia de conducir de Florida, el de tu identificación de Florida o los últimos cuatro dígitos de tu Seguro Social. Pídela en línea o llama al 407-585-8683."
      },
      linkIds: ["mailBallotRequest", "voteByMail"],
      tags: ["vote-by-mail"],
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
      sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-postmark",
      q: { en: "Does a postmark count for my mail ballot?", es: "¿Cuenta el matasellos de mi boleta por correo?" },
      a: {
        en: "No. It has to arrive by 7 pm on Election Day. Running late? Drop it at the elections office in Sanford during business hours, or at an early-voting site during early-voting hours. On Election Day itself, the Sanford office is the only drop-off spot.",
        es: "No. Tiene que llegar antes de las 7 p. m. del día de las elecciones. ¿Se te hace tarde? Entrégala en la oficina electoral en Sanford en horario de oficina, o en un sitio de votación anticipada durante ese horario. El mismo día de las elecciones, solo se recibe en la oficina de Sanford."
      },
      linkIds: ["voteByMail", "trackBallot"],
      tags: ["vote-by-mail"],
      source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
      sources: ["https://voteseminole.gov/faqs/"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-student-id",
      q: { en: "Can I use my UCF or Seminole State ID to vote?", es: "¿Puedo votar con mi identificación de UCF o de Seminole State?" },
      a: {
        en: "Not from Jan 1, 2027. Florida stops accepting student IDs at the polls, including public college and university cards (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go.",
        es: "No a partir del 1 de enero de 2027. Florida deja de aceptar identificaciones de estudiante para votar, incluidas las de instituciones educativas públicas (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      linkIds: ["electionReady", "countyElections"],
      tags: ["id", "students", "2027"],
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.043",
      sources: [
        "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
        "https://www.democracydocket.com/cases/florida-student-id-ban-challenge/"
      ],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-no-id",
      q: { en: "What if I forget my ID or I'm not on the list?", es: "¿Y si se me olvida la identificación o no aparezco en la lista?" },
      a: {
        en: "You can still vote a provisional ballot. Then you have until 5 pm on the second day after the election to give the elections office proof you're eligible.",
        es: "Igual puedes votar con una boleta provisional. Después tienes hasta las 5 p. m. del segundo día después de la elección para llevar a la oficina electoral pruebas de que puedes votar."
      },
      linkIds: ["whatToExpect", "voterRights"],
      tags: ["id", "problems"],
      source: "https://voteseminole.gov/faqs/",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/101.048"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-poll-hours",
      q: { en: "When are the polls open?", es: "¿A qué hora abren los lugares de votación?" },
      a: {
        en: "7 am to 7 pm on Election Day. If you're in line at 7 pm, stay: you still get to vote. Early-voting hours are set for each election.",
        es: "De 7 a. m. a 7 p. m. el día de las elecciones. Si estás en la fila a las 7 p. m., quédate: igual puedes votar. El horario de votación anticipada se fija para cada elección."
      },
      linkIds: ["pollingPlace", "earlyVoting"],
      tags: ["election-day"],
      source: "https://voteseminole.gov/faqs/",
      sources: ["https://voteseminole.gov/voters/voter-guide-rights-responsibilities/"],
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-ballot-photo",
      q: { en: "Can I take a picture of my ballot?", es: "¿Puedo tomarle una foto a mi boleta?" },
      a: {
        en: "Yes, your own ballot, and only yours. Florida bans other photos in the voting room and early-voting area, so save the group selfie for outside.",
        es: "Sí, a tu propia boleta y solo a la tuya. Florida prohíbe otras fotos en la sala de votación y en el área de votación anticipada, así que deja la selfie en grupo para afuera."
      },
      linkIds: ["whatToExpect"],
      tags: ["election-day"],
      source: "https://www.flsenate.gov/Laws/Statutes/2026/102.031",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-2027-election",
      q: { en: "Is there an election where I live in 2027?", es: "¿Hay elecciones donde vivo en 2027?" },
      a: {
        en: "Oviedo votes on Nov 2, 2027. Lake Mary and Altamonte Springs are expected the same day. Other cities and unincorporated areas: nothing posted yet. The next scheduled countywide election is the Mar 21, 2028 presidential primary, for registered Democrats and Republicans.",
        es: "Oviedo vota el 2 de noviembre de 2027. Se esperan elecciones en Lake Mary y Altamonte Springs ese mismo día. En las demás ciudades y zonas no incorporadas, todavía no hay nada publicado. La próxima elección programada en todo el condado es la primaria presidencial del 21 de marzo de 2028, para quienes se inscribieron como demócratas o republicanos."
      },
      linkIds: ["upcomingElections", "oviedoElections"],
      tags: ["2027", "dates"],
      source: "https://cityofoviedo.net/724/Elections",
      sources: [
        "https://www.yahoo.com/news/articles/candidates-three-seminole-cities-win-125700315.html",
        "https://voteseminole.gov/elections/upcoming-elections/",
        "https://www.flsenate.gov/Laws/Statutes/2026/103.101"
      ],
      verified: "2026-11-09",
      confidence: "med"
    },
    {
      id: "faq-public-record",
      q: { en: "Is my voter registration public?", es: "¿Mi inscripción de votante es pública?" },
      a: {
        en: "Mostly, yes. Your registration becomes public record except your driver license number, Social Security number, and signature. Some occupations can ask to keep their information private.",
        es: "En su mayoría, sí. Tu inscripción es un registro público, salvo tu número de licencia de conducir, tu número de Seguro Social y tu firma. Algunas profesiones pueden pedir que su información sea privada."
      },
      linkIds: ["soeFaq"],
      tags: ["privacy", "register"],
      source: "https://voteseminole.gov/faqs/",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "faq-voter-card",
      q: { en: "Do I need my voter card to vote?", es: "¿Necesito mi tarjeta de votante para votar?" },
      a: {
        en: "No. It just confirms your registration and shows your precinct and polling place. Bring photo and signature ID instead.",
        es: "No. Solo confirma tu inscripción y muestra tu precinto y lugar de votación. Lo que sí debes llevar es una identificación con foto y firma."
      },
      linkIds: ["myVoterRecord", "electionReady"],
      tags: ["election-day", "id"],
      source: "https://voteseminole.gov/faqs/",
      verified: "2026-11-09",
      confidence: "high"
    }
  ],

  plan: {
    id: "make-a-plan",
    version: 1,
    title: { en: "Make your voting plan", es: "Arma tu plan para votar" },
    intro: {
      en: "A few quick taps: when, how, and who's coming. You get a calendar reminder and a card for the group chat. Your address never goes on it.",
      es: "Unos toques rápidos: cuándo, cómo y con quién. Te llevas un recordatorio para el calendario y una tarjeta para el chat del grupo. Tu dirección nunca aparece en ella."
    },
    privacy: {
      en: "Your plan stays in this browser unless you choose to share it.",
      es: "Tu plan se queda en este navegador, a menos que decidas compartirlo."
    },
    howItWorks: "Ask questions in order, skipping any whose showIf doesn't match. 'where' filters the election options to dates[] entries with kind 'election', scope matching the place (or 'all'), status 'confirmed' or 'expected', and expires > now; show labels.expected on expected ones and optionNotes under the option. 'status' can end early with an outcome (under-18, helper); otherwise the outcome is 'plan'. Placeholders: {firstName} (optional field), {city} (places[].name), {electionTitle} (date.title), {election} (date.planName, includes its article, for mid-sentence use), {electionDate} (date formatted like 'Tue, Nov 2, 2027' / 'martes 2 de noviembre de 2027'), {method} (labels.method), {when} (labels.when), {getThere} (labels.getThere), {with} (labels.with, first person), {deadlineTitle} and {deadlineShort} (title and short of the next unexpired deadline whose appliesTo includes the election: the registration deadline if status is not-yet or not-sure, the mail deadline if method is mail, else the registration deadline), {url} (share URL). Never put a street address, birth date or party on any output. Calendar via YSD.cal, card via YSD.cards, share text via YSD.share.",
    questions: [
      {
        id: "where",
        type: "single",
        optionsFrom: "places",
        prompt: { en: "Where do you live?", es: "¿Dónde vives?" },
        help: {
          en: "Your city decides which local races you get.",
          es: "Tu ciudad define qué contiendas locales te tocan."
        }
      },
      {
        id: "election",
        type: "single",
        optionsFrom: "dates",
        filter: { kind: "election", matchScopeTo: "where", statuses: ["confirmed", "expected"], notExpired: true },
        prompt: { en: "Which election are you planning for?", es: "¿Para qué elección estás planificando?" },
        help: {
          en: "We show the ones on your ballot that are coming up next.",
          es: "Te mostramos las próximas que estarán en tu boleta."
        },
        optionNotes: {
          "ppp-2028": {
            en: "Closed primary: only registered Democrats and Republicans get presidential candidates on their ballot.",
            es: "Primaria cerrada: solo quienes se inscribieron como demócratas o republicanos tienen candidatos presidenciales en su boleta."
          },
          "city-2027-lake-mary-altamonte": {
            en: "Expected, not yet posted. We'll update this when the elections office confirms.",
            es: "Prevista, aún no publicada. La actualizaremos cuando la oficina electoral la confirme."
          }
        }
      },
      {
        id: "status",
        type: "single",
        prompt: { en: "Are you registered to vote?", es: "¿Ya te inscribiste para votar?" },
        options: [
          { id: "registered", label: { en: "Yes", es: "Sí" } },
          {
            id: "not-sure", label: { en: "Not sure", es: "No sé" }, stepId: "check-registration",
            note: { en: "Totally normal. You can check with just your name and date of birth.", es: "Es normal. Lo puedes revisar solo con tu nombre y tu fecha de nacimiento." }
          },
          {
            id: "not-yet", label: { en: "Not yet", es: "Todavía no" }, stepId: "register",
            note: { en: "We'll put the registration deadline in your plan.", es: "Pondremos la fecha límite de inscripción en tu plan." }
          },
          { id: "under-18", label: { en: "I'm under 18", es: "Tengo menos de 18" }, outcome: "under-18", stepId: "register" },
          { id: "cant-vote", label: { en: "I can't vote, but I want to help", es: "No puedo votar, pero quiero ayudar" }, outcome: "helper" }
        ]
      },
      {
        id: "method",
        type: "single",
        showIf: { status: ["registered", "not-sure", "not-yet"] },
        prompt: { en: "How do you want to vote?", es: "¿Cómo quieres votar?" },
        options: [
          {
            id: "mail", label: { en: "By mail", es: "Por correo" }, stepId: "renew-mail-ballot",
            note: {
              en: "Request it first (requests made before Nov 3, 2026 end Dec 31, 2026). It has to arrive back by 7 pm on Election Day.",
              es: "Primero pídela (las solicitudes hechas antes del 3 de noviembre de 2026 vencen el 31 de diciembre de 2026). Tiene que llegar de vuelta antes de las 7 p. m. del día de las elecciones."
            }
          },
          {
            id: "early", label: { en: "Early, in person", es: "Por adelantado, en persona" }, stepId: "early-voting",
            note: {
              en: "Any Seminole early-voting site. City-only elections may not have early voting.",
              es: "Cualquier sitio de votación anticipada de Seminole. Las elecciones solo municipales pueden no tenerla."
            }
          },
          {
            id: "election-day", label: { en: "On Election Day", es: "El día de las elecciones" }, stepId: "polling-place",
            note: {
              en: "At your assigned polling place, 7 am to 7 pm.",
              es: "En tu lugar de votación asignado, de 7 a. m. a 7 p. m."
            }
          }
        ]
      },
      {
        id: "when",
        type: "single",
        showIf: { method: ["mail", "early", "election-day"] },
        prompt: { en: "When works for you?", es: "¿Cuándo te queda bien?" },
        optionsByMethod: {
          "mail": [
            { id: "mail-same-day", label: { en: "The day it arrives", es: "El mismo día que llegue" } },
            { id: "mail-weekend", label: { en: "The first weekend after it arrives", es: "El primer fin de semana después de que llegue" } },
            { id: "mail-week-early", label: { en: "With at least a week to spare", es: "Con por lo menos una semana de margen" } }
          ],
          "early": [
            { id: "early-first", label: { en: "The first day it opens", es: "El primer día que abra" } },
            { id: "early-weekday", label: { en: "A weekday, on a break", es: "Un día entre semana, en un descanso" } },
            { id: "early-weekend", label: { en: "The last weekend before Election Day", es: "El último fin de semana antes de las elecciones" } }
          ],
          "election-day": [
            { id: "ed-morning", label: { en: "Morning, before work or class", es: "En la mañana, antes del trabajo o las clases" } },
            { id: "ed-midday", label: { en: "Around lunch", es: "A la hora del almuerzo" } },
            { id: "ed-evening", label: { en: "After work or class (before 7 pm)", es: "Después del trabajo o las clases (antes de las 7 p. m.)" } }
          ]
        },
        notes: {
          "early-weekend": {
            en: "Check the hours for that election: in 2026, Seminole's general-election early voting ran through the Sunday before.",
            es: "Revisa el horario de esa elección: en 2026, la votación anticipada de las generales en Seminole llegó hasta el domingo anterior."
          },
          "mail-week-early": {
            en: "Close to Election Day, dropping it off in person is the safer bet.",
            es: "Si falta poco para el día de las elecciones, es más seguro entregarla en persona."
          }
        }
      },
      {
        id: "getThere",
        type: "single",
        showIf: { method: ["early", "election-day"] },
        prompt: { en: "How will you get there?", es: "¿Cómo vas a llegar?" },
        options: [
          { id: "walk-bike", label: { en: "Walk or bike", es: "Caminando o en bici" } },
          { id: "drive", label: { en: "Drive", es: "Manejando" } },
          { id: "ride-friend", label: { en: "Ride with a friend", es: "Con alguien que me lleve" } },
          { id: "transit", label: { en: "Bus or train", es: "En bus o tren" } },
          {
            id: "figuring-out", label: { en: "Still figuring it out", es: "Todavía no sé" },
            note: {
              en: "Ask your group chat. Someone's probably going anyway.",
              es: "Pregunta en tu chat del grupo. Seguro alguien va de todos modos."
            }
          }
        ]
      },
      {
        id: "with",
        type: "single",
        showIf: { status: ["registered", "not-sure", "not-yet"] },
        prompt: { en: "Who's coming with you?", es: "¿Quién va contigo?" },
        options: [
          { id: "solo", label: { en: "Just me", es: "Solo yo" } },
          { id: "friend", label: { en: "A friend", es: "Un amigo o amiga" } },
          { id: "household", label: { en: "Roommates or family", es: "Mis compañeros de casa o mi familia" } },
          { id: "group-chat", label: { en: "The group chat", es: "El chat del grupo" } }
        ]
      }
    ],
    outcomes: {
      "plan": {
        title: { en: "You've got a plan", es: "Ya tienes un plan" },
        body: {
          en: "{electionTitle}, {electionDate}. You're voting {method}, {when}.",
          es: "{electionTitle}, {electionDate}. Vas a votar {method}, {when}."
        },
        deadlineLine: {
          en: "Next deadline: {deadlineShort}",
          es: "Próxima fecha límite: {deadlineShort}"
        },
        stepIds: ["check-registration", "what-id"]
      },
      "under-18": {
        title: { en: "Future voter, present tense", es: "Votante del futuro, desde ya" },
        body: {
          en: "At 16 you can pre-register, and it turns on by itself at 18. Until then, the most useful thing you can do is help one person who can vote make their plan.",
          es: "A los 16 te puedes preinscribir, y la inscripción se activa sola a los 18. Mientras tanto, lo más útil que puedes hacer es ayudar a una persona que sí puede votar a armar su plan."
        },
        stepIds: ["register"]
      },
      "helper": {
        title: { en: "You count here", es: "Aquí cuentas" },
        body: {
          en: "Voting is one way in, not the only one. Help a friend make their plan, and come to our next meetup.",
          es: "Votar es una forma de participar, no la única. Ayuda a alguien a armar su plan y ven a nuestra próxima reunión."
        },
        stepIds: []
      }
    },
    labels: {
      method: {
        "mail": { en: "by mail", es: "por correo" },
        "early": { en: "early, in person", es: "por adelantado, en persona" },
        "election-day": { en: "on Election Day", es: "el día de las elecciones" }
      },
      when: {
        "mail-same-day": { en: "the day it arrives", es: "el mismo día que llegue" },
        "mail-weekend": { en: "the first weekend after it arrives", es: "el primer fin de semana después de que llegue" },
        "mail-week-early": { en: "with at least a week to spare", es: "con por lo menos una semana de margen" },
        "early-first": { en: "on the first day of early voting", es: "el primer día de votación anticipada" },
        "early-weekday": { en: "on a weekday break during early voting", es: "un día entre semana, en un descanso, durante la votación anticipada" },
        "early-weekend": { en: "the last weekend before Election Day", es: "el último fin de semana antes de las elecciones" },
        "ed-morning": { en: "in the morning, before work or class", es: "en la mañana, antes del trabajo o las clases" },
        "ed-midday": { en: "around lunch", es: "a la hora del almuerzo" },
        "ed-evening": { en: "after work or class, before 7 pm", es: "después del trabajo o las clases, antes de las 7 p. m." }
      },
      getThere: {
        "walk-bike": { en: "walking or biking", es: "caminando o en bici" },
        "drive": { en: "driving", es: "manejando" },
        "ride-friend": { en: "riding with a friend", es: "con alguien que me lleva" },
        "transit": { en: "by bus or train", es: "en bus o tren" },
        "figuring-out": { en: "ride still to be sorted", es: "todavía viendo cómo llegar" }
      },
      with: {
        "solo": { en: "solo", es: "por mi cuenta" },
        "friend": { en: "with a friend", es: "con un amigo o amiga" },
        "household": { en: "with my people at home", es: "con la gente de mi casa" },
        "group-chat": { en: "with the group chat", es: "con el chat del grupo" }
      }
    },
    pledge: {
      statement: {
        "plan": {
          en: "I'm in. I've got a plan to vote in {election}.",
          es: "Cuenten conmigo. Tengo un plan para votar en {election}."
        },
        "under-18": {
          en: "I'm in. I'll pre-register as soon as I can, and help someone vote in the meantime.",
          es: "Cuenten conmigo. Me voy a preinscribir en cuanto pueda y, mientras tanto, voy a ayudar a alguien a votar."
        },
        "helper": {
          en: "I'm in. I'll help a friend make their voting plan.",
          es: "Cuenten conmigo. Voy a ayudar a alguien a armar su plan para votar."
        }
      },
      button: { en: "I'm in", es: "Cuenten conmigo" },
      consent: {
        en: "Show my first name, last initial, and city on the pledge wall. (Optional. You can take it down anytime.)",
        es: "Mostrar mi nombre, la inicial de mi apellido y mi ciudad en el muro de compromisos. (Opcional. Lo puedes quitar cuando quieras.)"
      },
      wall: {
        optIn: true,
        display: "firstName lastInitial, city",
        counterName: "pledges"
      }
    },
    outputs: {
      card: {
        eyebrow: { en: "MY VOTING PLAN", es: "MI PLAN PARA VOTAR" },
        title: { en: "{electionTitle}", es: "{electionTitle}" },
        lines: [
          { en: "{electionDate}", es: "{electionDate}" },
          { en: "Voting {method}, {when}", es: "Voto {method}, {when}" },
          { en: "Going {with}", es: "Voy {with}" }
        ],
        footer: { en: "Make yours: {url}", es: "Arma el tuyo: {url}" },
        alt: {
          en: "Voting plan card: {electionTitle}, {electionDate}, voting {method}.",
          es: "Tarjeta de plan para votar: {electionTitle}, {electionDate}, voto {method}."
        },
        rule: "No street address, no birth date, no party on the card. Under-18 and helper outcomes use pledge.statement instead of the lines."
      },
      calendar: {
        title: { en: "Vote: {electionTitle}", es: "Votar: {electionTitle}" },
        titleMail: { en: "Mail ballot must ARRIVE by 7 pm today ({electionTitle}). Mail it a week early.", es: "La boleta por correo tiene que LLEGAR hoy antes de las 7 p. m. ({electionTitle}). Envíala una semana antes." },
        description: {
          en: "My plan: {method}, {when}, {with}. Bring photo and signature ID. Polls: 7 am to 7 pm. Check details at voteseminole.gov or call 407-585-8683.",
          es: "Mi plan: {method}, {when}, {with}. Lleva identificación con foto y firma. Horario: 7 a. m. a 7 p. m. Revisa los detalles en voteseminole.gov o llama al 407-585-8683."
        },
        descriptionMail: {
          en: "My plan: {method}, {when}. My ballot has to reach the elections office by 7 pm on Election Day; postmarks don't count. Track it or check details at voteseminole.gov, or call 407-585-8683.",
          es: "Mi plan: {method}, {when}. Mi boleta tiene que llegar a la oficina electoral antes de las 7 p. m. del día de las elecciones; el matasellos no cuenta. Rastréala o revisa los detalles en voteseminole.gov, o llama al 407-585-8683."
        },
        remindersMinutesBefore: [10080, 1440],
        deadlineEvent: {
          title: { en: "Deadline: {deadlineTitle}", es: "Fecha límite: {deadlineTitle}" },
          description: { en: "{deadlineShort}", es: "{deadlineShort}" },
          remindersMinutesBefore: [10080, 1440]
        },
        mailEvent: {
          daysBefore: 7,
          time: "10:00",
          minutes: 30,
          title: { en: "Mail your ballot today ({electionTitle})", es: "Envía hoy tu boleta por correo ({electionTitle})" },
          description: {
            en: "Mail your voted ballot today. It has to reach the elections office by 7 pm on Election Day; postmarks don't count. From here on, dropping it off in person is the safer bet: the elections office in Sanford during business hours, or a secure ballot intake station at an early-voting site during early-voting hours. Check details at voteseminole.gov or call 407-585-8683.",
            es: "Envía hoy tu boleta votada. Tiene que llegar a la oficina electoral antes de las 7 p. m. del día de las elecciones; el matasellos no cuenta. A partir de ahora, es más seguro entregarla en persona: en la oficina electoral en Sanford en horario de oficina, o en una estación segura de recepción de boletas en un sitio de votación anticipada, durante ese horario. Revisa los detalles en voteseminole.gov o llama al 407-585-8683."
          },
          remindersMinutesBefore: [0]
        },
        rule: "Election event from the date entry (date to end). Add a second event for the deadline picked for {deadlineTitle}. Respect each entry's allDay flag. For mail voters, the election event is the return deadline (7 pm Election Day), titled with titleMail ('must ARRIVE by 7 pm') and described with descriptionMail, and a third event, mailEvent, lands daysBefore days earlier at its time (New York time) so the reminder to mail it comes a week ahead, never on the deadline itself (journeys-17)."
      },
      textToSelf: {
        en: "My voting plan for {election} ({electionDate}): {method}, {when}, {with}. Bring photo and signature ID. {url}",
        es: "Mi plan para votar en {election} ({electionDate}): {method}, {when}, {with}. Lleva identificación con foto y firma. {url}"
      },
      textToSelfMail: {
        en: "My voting plan for {election} ({electionDate}): {method}, {when}. It has to reach the elections office by 7 pm on Election Day. {url}",
        es: "Mi plan para votar en {election} ({electionDate}): {method}, {when}. Tiene que llegar a la oficina electoral antes de las 7 p. m. del día de las elecciones. {url}"
      },
      invite: {
        en: "I'm voting {when} in {election} ({electionDate}). Come with me? Make your plan here: {url}",
        es: "Voy a votar {when} en {election} ({electionDate}). ¿Vienes conmigo? Arma tu plan aquí: {url}"
      },
      inviteMail: {
        en: "I'm voting by mail in {election}. Want to fill ours out together? Make your plan here: {url}",
        es: "Voy a votar por correo en {election}. ¿Llenamos las boletas juntos? Arma tu plan aquí: {url}"
      }
    },
    researchIds: ["plan-making", "pledging"]
  },

  research: [
    {
      id: "plan-making",
      finding: {
        en: "In a 2008 field experiment (N = 287,228), helping people form a voting plan (when, where, how) raised turnout 4.1 percentage points among those contacted, and 9.1 points in single-voter households; a standard encouragement call had no significant effect.",
        es: "En un experimento de campo de 2008 (N = 287,228), ayudar a las personas a armar un plan para votar (cuándo, dónde, cómo) aumentó la participación 4.1 puntos porcentuales entre los contactados, y 9.1 puntos en hogares con un solo votante; una llamada de ánimo estándar no tuvo efecto significativo."
      },
      citation: "Nickerson, D. W., & Rogers, T. (2010). Do You Have a Voting Plan? Psychological Science, 21(2).",
      source: "https://doi.org/10.1177/0956797609359326",
      verified: "2026-11-09",
      confidence: "high",
      use: "Why the builder asks when, how and with whom. Fine to cite on an 'about this tool' note with the link."
    },
    {
      id: "pledging",
      finding: {
        en: "In campus experiments, pledging to vote raised turnout 3.7 points among all subjects and 5.6 points among people who had never voted before.",
        es: "En experimentos en universidades, comprometerse a votar aumentó la participación 3.7 puntos entre todos los participantes y 5.6 puntos entre quienes nunca habían votado."
      },
      citation: "Costa, M., Schaffner, B. F., & Prevost, A. (2018). Walking the walk? Experiments on the effect of pledging to vote on youth turnout. PLOS ONE.",
      source: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5973556/",
      verified: "2026-11-09",
      confidence: "high",
      use: "Why the plan ends with an optional pledge."
    }
  ],

  sourceTitles: {
    "https://www.flsenate.gov/Laws/Statutes/2026/101.62": { en: "Fla. Stat. 101.62 (2026), vote-by-mail requests", es: "Estatuto de Florida 101.62 (2026), solicitudes de boleta por correo", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/97.055": { en: "Fla. Stat. 97.055 (2026), when registration closes", es: "Estatuto de Florida 97.055 (2026), cierre de la inscripción", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/97.041": { en: "Fla. Stat. 97.041 (2026), who can register; pre-registration at 16", es: "Estatuto de Florida 97.041 (2026), quién puede inscribirse; preinscripción a los 16", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/101.043": { en: "Fla. Stat. 101.043 (2026), ID required at the polls (as amended by HB 991)", es: "Estatuto de Florida 101.043 (2026), identificación para votar (reformado por la HB 991)", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/101.021": { en: "Fla. Stat. 101.021 (2026), closed primaries", es: "Estatuto de Florida 101.021 (2026), primarias cerradas", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/101.048": { en: "Fla. Stat. 101.048 (2026), provisional ballots", es: "Estatuto de Florida 101.048 (2026), boletas provisionales", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/101.657": { en: "Fla. Stat. 101.657 (2026), early voting", es: "Estatuto de Florida 101.657 (2026), votación anticipada", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/102.031": { en: "Fla. Stat. 102.031 (2026), order at the polls; ballot photos; 150-foot zone", es: "Estatuto de Florida 102.031 (2026), orden en los lugares de votación; fotos de la boleta; zona de 150 pies", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/103.101": { en: "Fla. Stat. 103.101 (2026), presidential preference primary", es: "Estatuto de Florida 103.101 (2026), primaria de preferencia presidencial", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/100.061": { en: "Fla. Stat. 100.061 (2026), primary election date", es: "Estatuto de Florida 100.061 (2026), fecha de la primaria", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/100.031": { en: "Fla. Stat. 100.031 (2026), general election date", es: "Estatuto de Florida 100.031 (2026), fecha de las elecciones generales", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Statutes/2026/683.01": { en: "Fla. Stat. 683.01 (2026), legal holidays", es: "Estatuto de Florida 683.01 (2026), feriados legales", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Laws/Constitution": { en: "Florida Constitution, Art. VI, s. 5(b) (universal primary)", es: "Constitución de Florida, Art. VI, sec. 5(b) (primaria universal)", publisher: "The Florida Senate" },
    "https://flsenate.gov/Committees/BillSummaries/2026/html/991": { en: "Senate bill summary: CS/CS/HB 991 (2026), Elections", es: "Resumen del Senado: CS/CS/HB 991 (2026), Elecciones", publisher: "The Florida Senate" },
    "https://flsenate.gov/Session/Bill/2026/991": { en: "HB 991 (2026) bill page and history", es: "HB 991 (2026): página y trámite del proyecto", publisher: "The Florida Senate" },
    "https://www.flsenate.gov/Session/Bill/2026/991/Analyses/h0991z1.GOS.PDF": { en: "HB 991 final bill analysis (Apr 2, 2026)", es: "Análisis final de la HB 991 (2 de abril de 2026)", publisher: "Florida House of Representatives" },
    "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf": { en: "Complaint, Fla. State Conf. of Branches and Youth Units of the NAACP v. Byrd (S.D. Fla., Oct 16, 2026)", es: "Demanda, Fla. State Conf. of Branches and Youth Units of the NAACP v. Byrd (Distrito Sur de Florida, 16 de octubre de 2026)", publisher: "Democracy Docket (court filing copy)" },
    "https://www.democracydocket.com/cases/florida-student-id-ban-challenge/": { en: "Case page: Florida student ID ban challenge", es: "Página del caso: impugnación de la prohibición de la identificación de estudiante en Florida", publisher: "Democracy Docket" },
    "https://www.democracydocket.com/cases/florida-citizenship-requirement-challenge-unidosus/": { en: "Case page: Florida citizenship requirement challenge (UnidosUS v. Byrd, consolidated)", es: "Página del caso: impugnación del requisito de ciudadanía en Florida (UnidosUS v. Byrd, casos unificados)", publisher: "Democracy Docket" },
    "https://www.democracydocket.com/cases/florida-citizenship-requirement-challenge/": { en: "Case page: Florida citizenship requirement challenge (NAACP, filed Apr 1, 2026)", es: "Página del caso: impugnación del requisito de ciudadanía en Florida (NAACP, presentada el 1 de abril de 2026)", publisher: "Democracy Docket" },
    "https://wusf.org/text/politics-issues/2026-04-01/desantis-receives-bills-voter-id-domestic-terrorist-designations": { en: "Lawsuits filed after the governor signs HB 991 (Apr 1, 2026)", es: "Demandas tras la firma de la HB 991 (1 de abril de 2026)", publisher: "WUSF" },
    "https://voteseminole.gov/how-to-vote/vote-by-mail/": { en: "Vote by mail", es: "Voto por correo (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/voters/register-to-vote/": { en: "Register to vote or update your record", es: "Inscripción y actualización (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/voters/my-voter-record/": { en: "My voter record and where to vote", es: "Mi registro de votante y dónde votar (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/voters/are-you-election-ready/": { en: "Are you election ready? (ID, polling place, returns)", es: "¿Listo para votar? Identificación, lugar de votación, devolución (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/how-to-vote/what-to-expect-at-the-polls/": { en: "What to expect at the polls", es: "Qué esperar al votar (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/how-to-vote/early-voting/": { en: "Early voting", es: "Votación anticipada (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/elections/upcoming-elections/": { en: "Upcoming elections", es: "Próximas elecciones (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/faqs/": { en: "Elections office FAQs", es: "Preguntas frecuentes de la oficina electoral (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/contact-us/": { en: "Contact the elections office (phone, office hours, address)", es: "Contacto de la oficina electoral: teléfono, horario y dirección (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/voters/voter-guide-rights-responsibilities/": { en: "Voter guide, Voter Bill of Rights", es: "Guía y derechos del votante (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf": { en: "2026 Election Facts (PDF; Spanish edition linked from Upcoming elections)", es: "Detalles de las elecciones de 2026 (PDF; hay edición en español en Próximas elecciones)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/wp-content/uploads/2026/07/Totals-of-Voters-by-Cities.pdf": { en: "Totals of Voters by Cities, July 1, 2026 (PDF): 167,246 of 338,525 active voters live outside any city", es: "Total de votantes por ciudad, 1 de julio de 2026 (PDF): 167,246 de 338,525 votantes activos viven fuera de las ciudades", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf": { en: "District Demographic Analysis, July 1, 2026 (PDF)", es: "Análisis demográfico por distrito, 1 de julio de 2026 (PDF)", publisher: "Seminole County Supervisor of Elections" },
    "https://floridaphoenix.com/2024/03/20/chair-nikki-fried-defends-democratic-partys-move-to-cancel-primary-desantis-ridiculed-the-move/": { en: "Florida Democrats' 2024 presidential primary was canceled with one candidate (Mar 20, 2024)", es: "La primaria presidencial demócrata de 2024 en Florida se canceló con un solo candidato (20 de marzo de 2024)", publisher: "Florida Phoenix" },
    "https://cityofoviedo.net/724/Elections": { en: "City of Oviedo: Elections", es: "Ciudad de Oviedo: Elecciones (en inglés)", publisher: "City of Oviedo" },
    "https://www.yahoo.com/news/articles/candidates-three-seminole-cities-win-125700315.html": { en: "Candidates in three Seminole cities win seats without opposition (Sep 5, 2025)", es: "Candidatos en tres ciudades de Seminole ganan sin oposición (5 de septiembre de 2025)", publisher: "Orlando Sentinel via Yahoo News" },
    "https://dos.fl.gov/media/698338/ovr-faq-spanish.pdf": { en: "Online voter registration FAQ, Spanish edition (PDF)", es: "Preguntas frecuentes sobre la inscripción en línea (PDF, en español)", publisher: "Florida Department of State" },
    "https://dos.fl.gov/elections/contacts/contact-us/": { en: "Division of Elections: contact us", es: "División de Elecciones: contacto (en inglés)", publisher: "Florida Department of State" },
    "https://dos.fl.gov/elections/for-voters/voting/vote-by-mail/": { en: "Division of Elections: vote-by-mail (when a request expires)", es: "División de Elecciones: voto por correo (cuándo vence una solicitud)", publisher: "Florida Department of State" },
    "https://dos.fl.gov/elections/for-voters/quick-facts-presidential-preference-primary/": { en: "Division of Elections: presidential preference primary quick facts (next PPP Mar 21, 2028)", es: "División de Elecciones: datos sobre la primaria de preferencia presidencial (la próxima es el 21 de marzo de 2028; en inglés)", publisher: "Florida Department of State" },
    "https://dos.fl.gov/elections/contacts/frequently-asked-questions/faq-voter-registration/": { en: "Division of Elections: voter registration FAQ", es: "División de Elecciones: preguntas frecuentes sobre inscripción (en inglés)", publisher: "Florida Department of State" },
    "https://866ourvote.org/": { en: "Election Protection: 866-OUR-VOTE", es: "Protección Electoral: 866-OUR-VOTE y 888-VE-Y-VOTA", publisher: "Election Protection coalition (Lawyers' Committee for Civil Rights Under Law)" },
    "https://doi.org/10.1177/0956797609359326": { en: "Nickerson & Rogers, Do You Have a Voting Plan? (Psychological Science, 2010)", es: "Nickerson y Rogers, Do You Have a Voting Plan? (Psychological Science, 2010)", publisher: "SAGE / Association for Psychological Science" },
    "https://pmc.ncbi.nlm.nih.gov/articles/PMC5973556/": { en: "Costa, Schaffner & Prevost, Walking the walk? (PLOS ONE, 2018)", es: "Costa, Schaffner y Prevost, Walking the walk? (PLOS ONE, 2018)", publisher: "PLOS ONE via PubMed Central" },
    "https://www.flsenate.gov/Laws/Statutes/2026/102.012": { en: "Fla. Stat. 102.012(2) (2026), who can serve on an election board (includes pre-registered voters)", es: "Estatuto de Florida 102.012(2) (2026), quién puede trabajar en una mesa electoral (incluye a los preinscritos)", publisher: "The Florida Senate" },
    "https://voteseminole.gov/wp-content/uploads/2026/07/Seminole-County-2026-Voter-Guide-Update-1.pdf": { en: "Seminole County 2026 Voter Guide (PDF), p. 26: Become an Election Worker", es: "Guía del votante 2026 del Condado de Seminole (PDF), p. 26: trabajar en las elecciones", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/elections/become-an-election-worker/": { en: "Become an election worker", es: "Trabajar en las elecciones (en inglés)", publisher: "Seminole County Supervisor of Elections" },
    "https://voteseminole.gov/community-news-and-the-office/school-programs/": { en: "Community engagement and school programs", es: "Programas escolares y comunitarios (en inglés)", publisher: "Seminole County Supervisor of Elections" }
  }
};
