/*!
 * data/newsletter.js: "The Thursday Letter", the weekly YDSC newsletter: one full sample issue,
 * three archive stubs, and the signup copy. EN + ES.
 *
 * DEMO DATA (demo:true). The newsletter doesn't exist yet. The bylined writer (Dani), the spotlight
 * member (Marisol), the reader question and the archive issues are invented for the demo and must
 * render with labels.demo. No real person is quoted. No politician is named.
 *
 * What IS real: every fact in the copy (the Nov 3 result in Seminole, marked unofficial; the Dec 31
 * mail-ballot expiry; the sunset time; Big Tree Park; the book, podcast and show in The Picks). Each
 * one is in issue.facts[] (or an archive item's facts[]) with a source URL and a verified date
 * (checked Mon Nov 9, 2026).
 *
 * Voice: docs/research/05 section 8 template (a Service95-style letter, adapted and renamed; never
 * mention the inspiration on the site). Letter 120-200 words in English (report 05 sections 6 and 8;
 * Spanish runs about 15% longer), zero emoji, no exclamation marks,
 * one self-answered question at most, opens on a moment, closes with "I hope..." and the ritual
 * sign-off. Serious and fun content sit in separate sections (tone field). The letter's demo scene
 * stays away from polling places on purpose: within 150 feet of a polling place only Supervisor of
 * Elections staff and volunteers may give voters items (F.S. 102.031(4)), so no "handing out water".
 *
 * Mail-ballot wording and Spanish terms follow data/events.js and data/civic.js: "asked for a mail
 * ballot before Nov 3" (not "every request on file"); "boleta por correo" / "solicitud de boleta por
 * correo"; "voto por correo" only as a page or program name.
 *
 * Load: classic script, after assets/js/config.js. No modules, no fetches. Node check:
 *   node -e "global.window={};require('./data/newsletter.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * CONVENTIONS (same as data/civic.js): bilingual text is { en, es } (Spanish is written, not
 * translated word for word); ISO 8601 with the America/New_York offset; links are
 * { linkId, key, url, label{} } (render YSD.cfg(key, url)); facts[] { id, claim{}, source, sources?,
 * verified, confidence }. Placeholders: {name}, {date}.
 *
 * TOP LEVEL (window.YSD_DATA.newsletter)
 *   version, demo, verified, name{}, tagline{}, cadence{}, signoff{}, sections{}, labels{},
 *   signup{}, issue{} (ISSUE), archive[] (ARCHIVE ITEM, newest first)
 *
 * sections{}  the recurring section names, in order: letter, inside, oneThing, picks, spotlight,
 *             askGroupChat, footer. Each { title{}, eyebrow{} }. Keep the same names every week.
 * signoff{}   the ritual: ritual{} line, then template{} with {name}. Same every issue, forever.
 *
 * ISSUE
 *   id, number, demo, date (send time), subject{}, preheader{}, tone ('calm' for the letter: the
 *   week after an election)
 *   letter      { byline{ name, city, label{} }, paragraphs[] ({en,es}), wordCount{ en, es },
 *                 ritual{}, signature{} }  (render byline label "DEMO writer" visibly)
 *   inside[]    { en, es, section }  "what's inside" bullets, each pointing at a section id
 *   oneThing    { title{}, body{}, deadline (ISO, all-day: the local midnight that starts the last
 *                 day, same convention as civic.js allDay; show the date only), deadlineAllDay: true,
 *                 cta{ label{}, calendar{ id, title{}, description{}, date (ISO), allDay } }, link{},
 *                 factIds[] }
 *   picks[]     { id, kind 'place'|'book'|'podcast'|'show', title{}, creator{}?, detail{}?, reason{},
 *                 event? (events.js id), link?{ url, label{} }, factIds[] }  (free and nearby first)
 *   spotlight   { demo, name, city, label{} (render it: carries "DEMO member"), headline{},
 *                 body{} (80-120 words), event? (events.js id), consentNote (editors only) }
 *   askGroupChat { demo, label{} (render it: "DEMO question"), q{}, a{}, factIds[] }
 *   footer      { forward{}, languageSwitch{}, unsubscribe{}, why{}, demoNote{}, paidForKey }
 *   facts[]     { id, claim{}, source, sources?[], verified, confidence, computed?, note? }
 *
 * ARCHIVE ITEM  { id, number, demo, date, title{}, blurb{}, tone, facts[]? }  (demo: true = render
 *                 labels.demoIssue, "DEMO issue" / "Edición DEMO", on the item)
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.newsletter = {
  version: 1,
  demo: true,
  verified: "2026-11-09",

  name: { en: "The Thursday Letter", es: "La Carta del Jueves" },
  tagline: {
    en: "One letter a week from the Young Dems: the deadline you need, the plan for this week, and a few good things.",
    es: "Una carta por semana de los Young Dems: la fecha que necesitas, el plan de la semana y algunas cosas buenas."
  },
  cadence: {
    day: "thursday",
    time: "7:00 am",
    perWeek: 1,
    promise: {
      en: "Every Thursday morning. Never more than once a week.",
      es: "Todos los jueves por la mañana. Nunca más de una vez por semana."
    }
  },
  signoff: {
    ritual: { en: "See you Thursday.", es: "Nos vemos el jueves." },
    template: { en: "{name}, for the Young Dems xo", es: "Un abrazo, {name}, de parte de los Young Dems" },
    note: "Recommended option (a) from docs/research/05 section 7, with the casual name 'Young Dems' (docs/research/00). Keep it identical every week."
  },

  sections: {
    letter: { title: { en: "The Letter", es: "La carta" }, eyebrow: { en: "THIS WEEK", es: "ESTA SEMANA" } },
    inside: { title: { en: "What's inside", es: "En esta carta" }, eyebrow: { en: "INSIDE", es: "ADENTRO" } },
    oneThing: { title: { en: "One Thing", es: "Una sola cosa" }, eyebrow: { en: "ONE THING", es: "UNA SOLA COSA" } },
    picks: { title: { en: "The Picks", es: "Recomendados" }, eyebrow: { en: "THE PICKS", es: "RECOMENDADOS" } },
    spotlight: { title: { en: "Spotlight", es: "En primer plano" }, eyebrow: { en: "SPOTLIGHT", es: "EN PRIMER PLANO" } },
    askGroupChat: { title: { en: "Ask the Group Chat", es: "Pregúntale al chat" }, eyebrow: { en: "ASK US", es: "PREGÚNTANOS" } },
    footer: { title: { en: "Before you go", es: "Antes de irte" }, eyebrow: { en: "", es: "" } }
  },

  labels: {
    demo: { en: "DEMO", es: "DEMO" },
    demoIssue: { en: "DEMO issue", es: "Edición DEMO" },
    demoWriter: { en: "DEMO writer", es: "perfil DEMO" },
    demoMember: { en: "DEMO member", es: "miembro DEMO" },
    archive: { en: "Past letters", es: "Cartas anteriores" },
    readIssue: { en: "Read this letter", es: "Leer esta carta" },
    issueNumber: { en: "No. {n}", es: "N.º {n}" },
    sources: { en: "Where these facts come from", es: "De dónde salen estos datos" },
    unofficial: { en: "Unofficial until certified", es: "No oficial hasta la certificación" }
  },

  signup: {
    headline: { en: "One letter a week. The deadlines, the plans, the good stuff.", es: "Una carta por semana. Las fechas límite, los planes y lo bueno." },
    emailLabel: { en: "Email", es: "Email" },
    emailHelper: {
      en: "One letter a week, never more, and you can unsubscribe anytime.",
      es: "Una carta por semana, nunca más, y te puedes dar de baja cuando quieras."
    },
    languageLabel: { en: "Language", es: "Idioma" },
    button: { en: "Count me in", es: "Cuenta conmigo" },
    success: {
      en: "You're in. Your first letter lands Thursday. Go drink some water.",
      es: "Listo, ya estás. Tu primera carta llega el jueves. Ve y tómate un vaso de agua."
    },
    errorEmail: {
      en: "That email's missing an @. Happens to everyone. Try once more?",
      es: "A ese email le falta la @. Nos pasa a todos. ¿Lo intentas otra vez?"
    },
    demoNote: { en: "DEMO: no emails are sent.", es: "DEMO: no se envían correos." }
  },

  issue: {
    id: "2026-11-12",
    number: 4,
    demo: true,
    date: "2026-11-12T07:00:00-05:00",
    tone: "calm",
    subject: {
      en: "Mail-ballot requests from before Nov 3 run out Dec 31 (plus a sunset walk Saturday)",
      es: "Las solicitudes de boleta por correo de antes del 3 de noviembre vencen el 31 de diciembre (y una caminata al atardecer el sábado)"
    },
    preheader: {
      en: "One reminder to set, five picks for a slow weekend, and a first-time voter who stayed to help.",
      es: "Un recordatorio para poner, cinco recomendaciones para un fin de semana tranquilo y un votante primerizo que se quedó a ayudar."
    },

    letter: {
      byline: {
        name: "Dani",
        city: "casselberry",
        label: { en: "Dani from Casselberry (DEMO writer)", es: "Dani, de Casselberry (perfil DEMO)" }
      },
      paragraphs: [
        {
          en: "Hi, it's Dani from Casselberry (DEMO writer). On election night I was at our text-bank table, refilling the chip bowl and answering a \"where do I vote?\" text, when a guy about my age asked if he could help. He'd voted for the first time that morning. He stayed until the polls closed at 7, sending strangers the official link like he'd been doing it for years.",
          es: "Hola, soy Dani, de Casselberry (perfil DEMO). La noche de las elecciones estaba en nuestra mesa de mensajes, rellenando el plato de papitas y contestando un «¿dónde voto?», cuando un muchacho más o menos de mi edad me preguntó si podía ayudar. Había votado por primera vez esa misma mañana. Se quedó hasta que cerraron las urnas a las 7, mandándoles el enlace oficial a desconocidos como si llevara años haciéndolo."
        },
        {
          en: "By the unofficial count, Seminole voted blue for governor, about 54% to 45%, while the state went the other way by about a point. The county files its official results by Mon, Nov 16. I'm proud of this county and tired at the same time. If you're somewhere else entirely, that makes sense too.",
          es: "Según el conteo no oficial, Seminole votó azul para gobernador, más o menos 54 % a 45 %, mientras que el estado se fue para el otro lado por cerca de un punto. El condado entrega sus resultados oficiales a más tardar el lunes 16 de noviembre. Siento orgullo por este condado y cansancio a la vez. Si tú estás en otro lugar, también tiene sentido."
        },
        {
          en: "So this week is for breathing, plus one small, unglamorous task. If you asked for a mail ballot before Nov 3, that request runs out Dec 31. Set a reminder for Jan 1 now, and renewing will be quick. (Details below.)",
          es: "Así que esta semana es para respirar, y para una tarea pequeña y nada glamorosa. Si pediste la boleta por correo antes del 3 de noviembre, esa solicitud vence el 31 de diciembre. Ponte ya un recordatorio para el 1 de enero y renovarla te va a tomar muy poco. (Los detalles, más abajo.)"
        },
        {
          en: "Also inside: a sunset walk on Lake Monroe Saturday, five picks for a slow weekend, and Marisol (DEMO member), who rewrote our text-bank script on her first night.",
          es: "Además: una caminata al atardecer en el lago Monroe el sábado, cinco recomendaciones para un fin de semana tranquilo y Marisol (miembro DEMO), que reescribió nuestro guion de mensajes en su primera noche."
        },
        {
          en: "I hope you find something here that feels like yours.",
          es: "Ojalá encuentres aquí algo que sientas tuyo."
        }
      ],
      wordCount: { en: 200, es: 233 },
      ritual: { en: "See you Thursday.", es: "Nos vemos el jueves." },
      signature: { en: "Dani, for the Young Dems xo", es: "Un abrazo, Dani, de parte de los Young Dems" },
      factIds: ["seminole-governor-unofficial", "official-returns-nov-16", "mail-requests-expire-2026"]
    },

    inside: [
      { en: "One Thing: set your Jan 1 mail-ballot renewal reminder", es: "Una sola cosa: pon tu recordatorio del 1 de enero para renovar la boleta por correo", section: "oneThing" },
      { en: "The Picks: two outdoor spots, a book, a podcast in Spanish and a show", es: "Recomendados: dos lugares al aire libre, un libro, un pódcast en español y una serie", section: "picks" },
      { en: "Spotlight: Marisol (DEMO member), who rewrote our text-bank script", es: "En primer plano: Marisol (miembro DEMO), que reescribió nuestro guion de mensajes", section: "spotlight" },
      { en: "Ask the Group Chat: \"I'm NPA. Is this group even for me?\"", es: "Pregúntale al chat: «Me inscribí sin partido. ¿Este grupo es para mí?»", section: "askGroupChat" }
    ],

    oneThing: {
      title: { en: "Set your Jan 1 renewal reminder", es: "Pon tu recordatorio para renovar el 1 de enero" },
      body: {
        en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Starting Jan 1, one new request covers every election through 2028. Set the reminder now, then renew online or at 407-585-8683 with your Florida license or ID number, or the last 4 of your Social Security number. Renewing sooner? Check My Voter Record in January to be sure.",
        es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Desde el 1 de enero, una sola solicitud nueva te cubre en todas las elecciones hasta 2028. Ponte el recordatorio ahora y luego renuévala en línea o al 407-585-8683 con el número de tu licencia o identificación de Florida, o los últimos 4 dígitos de tu Seguro Social. ¿La renuevas antes? Revisa My Voter Record en enero para confirmarlo."
      },
      deadline: "2026-12-31T00:00:00-05:00",
      deadlineAllDay: true,
      cta: {
        label: { en: "Add the reminder", es: "Agregar el recordatorio" },
        calendar: {
          id: "renew-mail-ballot-reminder",
          title: { en: "Renew my mail-ballot request", es: "Renovar mi solicitud de boleta por correo" },
          description: {
            en: "Requests made before Nov 3, 2026 ended Dec 31. Renew online on Seminole's vote-by-mail page (voteseminole.gov) or call 407-585-8683 on a weekday. Have your Florida license or ID number, or the last 4 digits of your Social Security number.",
            es: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre. Renueva la tuya en línea en la página de voto por correo de Seminole (voteseminole.gov) o llama al 407-585-8683 un día entre semana. Ten a mano el número de tu licencia o identificación de Florida, o los últimos 4 dígitos de tu Seguro Social."
          },
          date: "2027-01-01T00:00:00-05:00",
          allDay: true,
          note: "Mirrors data/civic.js nextActions 'na-renew-reminder-2026'.calendar; if civic's object is loaded on the page, use it so the text never drifts. Pass start: date.slice(0, 10) to YSD.cal ('YYYY-MM-DD' is all-day)."
        }
      },
      link: { linkId: "voteByMail", key: "links.vote.voteByMail", url: "https://voteseminole.gov/how-to-vote/vote-by-mail/", label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" } },
      factIds: ["mail-requests-expire-2026", "new-request-covers-2028", "renew-how"]
    },

    picks: [
      {
        id: "pick-riverwalk",
        kind: "place",
        title: { en: "The Riverwalk in Sanford, about 20 minutes before sunset", es: "El Riverwalk de Sanford, unos 20 minutos antes del atardecer" },
        reason: {
          en: "It's free, it's right on Lake Monroe, and on Saturday the sun sets around 5:32 pm. We'll be the group by Veterans Memorial Park with the celery-green sign (DEMO).",
          es: "Es gratis, está justo a orillas del lago Monroe y el sábado el sol se pone a eso de las 5:32 p. m. Somos el grupo junto a Veterans Memorial Park con el letrero verde apio (DEMO)."
        },
        event: "sunset-walk-lake-monroe",
        factIds: ["sunset-2026-11-14", "veterans-park-lake-monroe"]
      },
      {
        id: "pick-big-tree-park",
        kind: "place",
        title: { en: "Big Tree Park in Longwood", es: "Big Tree Park, en Longwood" },
        reason: {
          en: "Go see The Phoenix, a clone of The Senator, the roughly 3,500-year-old cypress lost to fire in 2012. Lady Liberty, about 2,000 years old, still stands nearby. Open daily, 8 am to dusk. A short walk, and a good metaphor for this week.",
          es: "Ve a conocer a The Phoenix, un clon de The Senator, el ciprés de unos 3,500 años que se perdió en un incendio en 2012. Cerca sigue en pie Lady Liberty, de unos 2,000 años. Abre todos los días, de 8 a. m. hasta el atardecer. Una caminata corta y una buena metáfora para esta semana."
        },
        factIds: ["senator-phoenix", "big-tree-hours"]
      },
      {
        id: "pick-hope-in-the-dark",
        kind: "book",
        title: { en: "Hope in the Dark: Untold Histories, Wild Possibilities", es: "Esperanza en la oscuridad (Hope in the Dark)" },
        creator: { en: "Rebecca Solnit", es: "Rebecca Solnit" },
        detail: { en: "Book, Haymarket Books (updated edition, 2016; first published 2004)", es: "Libro. En español lo publicó Capitán Swing (2017); el original en inglés es de Haymarket Books (edición actualizada de 2016)" },
        reason: {
          en: "A short book that makes the case for hope as something you do, not something you wait to feel. Readable in a weekend, and it holds up on a rough news week. Check your library before you buy it.",
          es: "Un libro corto que defiende la esperanza como algo que se hace, no como algo que uno espera sentir. Se lee en un fin de semana y aguanta bien una semana de malas noticias. Búscalo en tu biblioteca, en español o en inglés, antes de comprarlo."
        },
        factIds: ["hope-in-the-dark"]
      },
      {
        id: "pick-radio-ambulante",
        kind: "podcast",
        title: { en: "Radio Ambulante", es: "Radio Ambulante" },
        creator: { en: "Created by Daniel Alarcón; distributed by NPR since 2016", es: "Creado por Daniel Alarcón; lo distribuye NPR desde 2016" },
        detail: { en: "Podcast, in Spanish", es: "Pódcast en español" },
        reason: {
          en: "Long-form stories from across Latin America, told in Spanish. Good for a drive down 17-92, or for sending to the relative who keeps asking what you're listening to.",
          es: "Historias largas de toda América Latina, contadas en español. Ideal para un viaje por la 17-92, o para mandárselo a ese familiar que siempre te pregunta qué estás escuchando."
        },
        factIds: ["radio-ambulante"]
      },
      {
        id: "pick-abbott-elementary",
        kind: "show",
        title: { en: "Abbott Elementary", es: "Abbott Elementary" },
        creator: { en: "Created by Quinta Brunson; ABC", es: "Creada por Quinta Brunson; ABC" },
        detail: { en: "TV comedy, premiered Dec 7, 2021", es: "Comedia de televisión en inglés, estrenada el 7 de diciembre de 2021" },
        reason: {
          en: "A comedy about teachers making a public school work with almost nothing. It's funny, and it makes a better case for paying attention to school board races than we ever could.",
          es: "Una comedia sobre maestras y maestros que sacan adelante una escuela pública con casi nada. Es divertida y convence mejor que nosotros de prestarle atención a las elecciones de la junta escolar."
        },
        factIds: ["abbott-elementary"]
      }
    ],

    spotlight: {
      demo: true,
      name: "Marisol",
      city: "sanford",
      label: { en: "Marisol from Sanford (DEMO member)", es: "Marisol, de Sanford (miembro DEMO)" },
      headline: { en: "She made our script sound like a person", es: "Hizo que nuestro guion sonara como una persona" },
      body: {
        en: "Marisol (DEMO member), a nursing student from Sanford, had never sent a political text in her life when a friend talked her into a text bank in October with a promise of snacks. By the end of the night she'd rewritten our opening line so it sounded like a neighbor, not a robot, and we've used her version ever since. Her favorite reply came from a woman who wrote back to ask where to check her registration. On Tue, Dec 1, Marisol is training the next group of first-timers in Lake Mary, in English and Spanish. Bring questions. She likes them.",
        es: "Marisol (miembro DEMO), estudiante de enfermería de Sanford, nunca había mandado un mensaje político en su vida cuando una amiga la convenció de ir a una jornada de mensajes en octubre con la promesa de que habría algo para picar. Al final de la noche ya había reescrito nuestra primera línea para que sonara como una vecina y no como un robot, y desde entonces usamos su versión. Su respuesta favorita fue la de una señora que le escribió para preguntar dónde revisar su registro. El martes 1 de diciembre, Marisol va a entrenar en Lake Mary al próximo grupo de principiantes, en inglés y en español. Trae tus preguntas. Le encantan."
      },
      event: "text-bank-dec-31-heads-up",
      consentNote: "Demo person. A real spotlight runs only with the member's written consent (and a guardian's for anyone under 18)."
    },

    askGroupChat: {
      demo: true,
      label: { en: "DEMO question", es: "Pregunta DEMO" },
      q: {
        en: "I'm registered NPA. Is this group even for me?",
        es: "Me inscribí sin partido (NPA). ¿Este grupo es para mí?"
      },
      a: {
        en: "Yes. Our events are open to everyone 14 and up, whatever's on your voter card, and you don't have to join anything to come. You'd have company: among Seminole voters 18 to 40, no party affiliation is the most common choice. One thing worth knowing: Florida's party primaries are closed, so NPA voters skip most primary races. You still vote in the nonpartisan ones on that same ballot, like school board and judges, and on everything in November. Come to one thing and see how it feels.",
        es: "Sí. Nuestros eventos están abiertos a todas las personas de 14 años en adelante, sin importar lo que diga tu tarjeta de votante, y no tienes que unirte a nada para venir. Y no estarías sola ni solo: entre los votantes de Seminole de 18 a 40 años, no tener partido es la opción más común. Algo que conviene saber: en Florida las primarias de partido son cerradas, así que quienes no tienen partido no votan en la mayoría de esas contiendas. Pero sí votan en las no partidistas de esa misma boleta, como la junta escolar y los jueces, y en todo lo de noviembre. Ven a algo y ve qué tal te sientes."
      },
      factIds: ["npa-most-common-18-40", "npa-primaries", "nonpartisan-races"]
    },

    footer: {
      forward: {
        en: "Know someone who'd like this? Forward it. Honestly, that's how this grows.",
        es: "¿Conoces a alguien a quien le gustaría? Reenvíaselo. La verdad, así es como esto crece."
      },
      languageSwitch: { en: "Leer en español", es: "Read in English" },
      unsubscribe: {
        en: "Unsubscribe in one tap. Sad to see you go, glad you were here.",
        es: "Date de baja con un solo toque. Nos da pena verte ir, y qué bueno que estuviste."
      },
      why: {
        en: "You're getting this because you joined the Young Dems list. One letter a week, on Thursdays, never more.",
        es: "Te llega esta carta porque te uniste a la lista de los Young Dems. Una carta por semana, los jueves, nunca más."
      },
      demoNote: { en: "DEMO issue: nothing is emailed, and the people in it are made up.", es: "Edición DEMO: no se envía por correo y las personas que aparecen son inventadas." },
      paidForKey: "legal.paidFor"
    },

    facts: [
      {
        id: "seminole-governor-unofficial",
        claim: {
          en: "Unofficial Nov 3, 2026 returns show David Jolly (D) at about 54.1% to Byron Donalds (R) at about 44.6% in Seminole County, while Donalds won statewide (about 50.0% to 48.7%, AP).",
          es: "Los resultados no oficiales del 3 de noviembre de 2026 dan a David Jolly (D) cerca del 54.1 % frente a Byron Donalds (R) con cerca del 44.6 % en el condado de Seminole, mientras que Donalds ganó a nivel estatal (cerca del 50.0 % contra 48.7 %, según AP)."
        },
        source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
        sources: ["https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/"],
        verified: "2026-11-09",
        confidence: "high",
        note: "Re-read on WFTV's unofficial results page on Nov 9: Seminole Jolly 54.08%, Donalds 44.59%; statewide Donalds 50.02%, Jolly 48.71% (margin 1.31 points). Florida Phoenix/AP per the lead's check (docs/research/00; blocked to our fetch). Keep the 'unofficial' label until certification."
      },
      {
        id: "official-returns-nov-16",
        claim: {
          en: "County canvassing boards must file official returns by noon on the 13th day after the general election: Mon, Nov 16, 2026.",
          es: "Las juntas de escrutinio de los condados deben entregar los resultados oficiales antes del mediodía del día 13 después de la elección general: el lunes 16 de noviembre de 2026."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2025/102.112",
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "mail-requests-expire-2026",
        claim: {
          en: "A Florida vote-by-mail request covers elections through the end of the calendar year of the next regularly scheduled general election. That election was Nov 3, 2026, so requests made before it end Dec 31, 2026.",
          es: "En Florida, una solicitud de boleta por correo cubre las elecciones hasta el final del año calendario de la siguiente elección general ordinaria. Esa elección fue el 3 de noviembre de 2026, así que las solicitudes hechas antes vencen el 31 de diciembre de 2026."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "new-request-covers-2028",
        claim: {
          en: "A new request made in 2027 lasts through Dec 31, 2028, the end of the year of the next regular general election (Nov 7, 2028).",
          es: "Una solicitud nueva hecha en 2027 dura hasta el 31 de diciembre de 2028, el final del año de la siguiente elección general ordinaria (7 de noviembre de 2028)."
        },
        source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "renew-how",
        claim: {
          en: "Seminole voters can request mail ballots online through the Supervisor of Elections or by phone at 407-585-8683. In-person and phone requests need a Florida driver license number, Florida ID card number or the last four digits of the Social Security number (F.S. 101.62(1)(b)); the online form asks for the same.",
          es: "Los votantes de Seminole pueden pedir la boleta por correo en línea con la oficina del Supervisor de Elecciones o por teléfono al 407-585-8683. Las solicitudes en persona o por teléfono piden el número de licencia o de tarjeta de identificación de Florida, o los últimos cuatro dígitos del Seguro Social (F.S. 101.62(1)(b)); el formulario en línea pide lo mismo."
        },
        source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
        sources: ["https://www.flsenate.gov/Laws/Statutes/2026/101.62"],
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "sunset-2026-11-14",
        claim: {
          en: "Sunset in Sanford on Sat, Nov 14, 2026 is at about 5:32 pm EST.",
          es: "En Sanford, el sábado 14 de noviembre de 2026 el sol se pone a eso de las 5:32 p. m., hora del Este."
        },
        source: "https://api.sunrise-sunset.org/json?lat=28.8003&lng=-81.2731&date=2026-11-14&tzid=America/New_York",
        verified: "2026-11-09",
        confidence: "high",
        computed: "Re-checked with the NOAA sunrise/sunset algorithm: 5:31:42 pm EST."
      },
      {
        id: "veterans-park-lake-monroe",
        claim: {
          en: "Veterans Memorial Park sits on the shore of Lake Monroe in Sanford.",
          es: "Veterans Memorial Park está a orillas del lago Monroe, en Sanford."
        },
        source: "https://sanfordfl.gov/?p=70776",
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "senator-phoenix",
        claim: {
          en: "The Senator, an approximately 3,500-year-old bald cypress in Big Tree Park, Longwood, was lost to fire in January 2012; a clone named The Phoenix was planted near the park's playground; Lady Liberty, The Senator's sister tree, is about 2,000 years old.",
          es: "The Senator, un ciprés calvo de unos 3,500 años en Big Tree Park, Longwood, se perdió en un incendio en enero de 2012; cerca del área de juegos del parque se plantó un clon llamado The Phoenix; Lady Liberty, el árbol hermano de The Senator, tiene unos 2,000 años."
        },
        source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
        sources: ["https://en.wikipedia.org/wiki/The_Senator_(tree)"],
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "big-tree-hours",
        claim: {
          en: "Big Tree Park, 761 General Hutchison Parkway, Longwood, is open daily from 8 am to dusk.",
          es: "Big Tree Park, en 761 General Hutchison Parkway, Longwood, abre todos los días de 8 a. m. hasta el atardecer."
        },
        source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "hope-in-the-dark",
        claim: {
          en: "Hope in the Dark: Untold Histories, Wild Possibilities is by Rebecca Solnit (184 pages); Haymarket Books published an updated edition with a new introduction and afterword on Mar 15, 2016. Nation Books first published it in 2004, and Capitán Swing published the Spanish translation, Esperanza en la oscuridad, in 2017.",
          es: "Hope in the Dark: Untold Histories, Wild Possibilities es de Rebecca Solnit (184 páginas); Haymarket Books publicó una edición actualizada, con nueva introducción y epílogo, el 15 de marzo de 2016. Nation Books lo publicó por primera vez en 2004, y Capitán Swing publicó la traducción al español, Esperanza en la oscuridad, en 2017."
        },
        source: "https://www.haymarketbooks.org/books/791-hope-in-the-dark",
        sources: ["https://openlibrary.org/works/OL12443W/Hope_in_the_Dark", "https://openlibrary.org/books/OL35629120M"],
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "radio-ambulante",
        claim: {
          en: "Radio Ambulante is a Spanish-language narrative podcast about Latin America, created primarily by the Peruvian writer Daniel Alarcón (CEO Carolina Guerrero is also a co-founder) and distributed weekly by NPR since 2016.",
          es: "Radio Ambulante es un pódcast narrativo en español sobre América Latina, creado principalmente por el escritor peruano Daniel Alarcón (la directora ejecutiva, Carolina Guerrero, también es cofundadora) y distribuido cada semana por NPR desde 2016."
        },
        source: "https://en.wikipedia.org/wiki/Radio_Ambulante",
        verified: "2026-11-09",
        confidence: "med"
      },
      {
        id: "abbott-elementary",
        claim: {
          en: "Abbott Elementary, created by Quinta Brunson, is an ABC comedy set in an underfunded Philadelphia public school; it premiered Dec 7, 2021.",
          es: "Abbott Elementary, creada por Quinta Brunson, es una comedia de ABC ambientada en una escuela pública de Filadelfia con pocos recursos; se estrenó el 7 de diciembre de 2021."
        },
        source: "https://abc7ny.com/abbott-elementary-teachers-sitcom-abc/11308388/",
        sources: ["https://en.wikipedia.org/wiki/Abbott_Elementary", "https://billypenn.com/2021/11/05/abbott-elementary-philadelphia-schools-quinta-brunson-abc/"],
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "npa-most-common-18-40",
        claim: {
          en: "Of 124,626 Seminole voters aged 18 to 40 in the Supervisor of Elections' July 1, 2026 report, 34.3% had no party affiliation, 32.7% were Democrats and 27.4% Republicans.",
          es: "De los 124,626 votantes de Seminole de 18 a 40 años en el informe del Supervisor de Elecciones del 1 de julio de 2026, el 34.3 % no tenía afiliación partidista, el 32.7 % era demócrata y el 27.4 % republicano."
        },
        source: "https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf",
        verified: "2026-11-09",
        confidence: "high",
        computed: "Summed the AGE 18-25, 26-30, 31-35 and 36-40 rows of the county table: 124,626 voters; NPA 42,710, Dem 40,696, Rep 34,200."
      },
      {
        id: "npa-primaries",
        claim: {
          en: "To vote in a party's primary, a Florida voter must have been a member of that party for at least 29 days before the primary; in the general election, voters of any affiliation, including no party, may vote for any candidate on their ballot.",
          es: "Para votar en la primaria de un partido en Florida, hay que ser miembro de ese partido al menos 29 días antes de la primaria; en la elección general, votantes de cualquier afiliación, incluso sin partido, pueden votar por cualquier candidato de su boleta."
        },
        source: "https://voteseminole.gov/faqs/",
        verified: "2026-11-09",
        confidence: "high"
      },
      {
        id: "nonpartisan-races",
        claim: {
          en: "Seminole's 2026 election facts sheet lists school board, judicial, soil and water and city races as nonpartisan; the school board and circuit judge races were set for the Aug 18 primary ballot.",
          es: "La hoja de datos electorales de Seminole de 2026 indica que las contiendas de la junta escolar, de jueces, de conservación de suelos y agua y de las ciudades son no partidistas; las de la junta escolar y de jueces de circuito iban en la boleta de la primaria del 18 de agosto."
        },
        source: "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf",
        verified: "2026-11-09",
        confidence: "high"
      }
    ]
  },

  archive: [
    {
      id: "2026-11-05",
      number: 3,
      demo: true,
      date: "2026-11-05T07:00:00-05:00",
      tone: "calm",
      title: { en: "The week after: what we know, and what can wait", es: "La semana después: lo que sabemos y lo que puede esperar" },
      blurb: {
        en: "A short letter for a long week: what we know so far (results stay unofficial until certified), a no-pressure debrief, and the one thing that can wait until you're ready.",
        es: "Una carta corta para una semana larga: lo que sabemos hasta ahora (los resultados son no oficiales hasta que se certifiquen), una conversación sin presión y la única tarea que puede esperar hasta que tengas ganas."
      },
      facts: [
        {
          id: "official-returns-nov-16",
          claim: {
            en: "Official county returns are due by noon on the 13th day after the general election (Nov 16, 2026).",
            es: "Los resultados oficiales del condado se entregan antes del mediodía del día 13 después de la elección general (16 de noviembre de 2026)."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2025/102.112",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },
    {
      id: "2026-10-29",
      number: 2,
      demo: true,
      date: "2026-10-29T07:00:00-04:00",
      tone: "fun",
      title: { en: "Early voting ends Sunday. Here's a plan for Tuesday.", es: "La votación anticipada termina el domingo. Aquí va un plan para el martes." },
      blurb: {
        en: "Early voting in Seminole runs through Sun, Nov 1, 7 am to 7 pm. Three questions to make your plan: when, how, and who you're going with.",
        es: "La votación anticipada en Seminole va hasta el domingo 1 de noviembre, de 7 a. m. a 7 p. m. Tres preguntas para armar tu plan: cuándo, cómo y con quién vas."
      },
      facts: [
        {
          id: "early-voting-2026-general",
          claim: {
            en: "For the Nov 3, 2026 general election, Seminole offered early voting Oct 19 to Nov 1, 7 am to 7 pm.",
            es: "Para la elección general del 3 de noviembre de 2026, Seminole ofreció votación anticipada del 19 de octubre al 1 de noviembre, de 7 a. m. a 7 p. m."
          },
          source: "https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },
    {
      id: "2026-10-22",
      number: 1,
      demo: true,
      date: "2026-10-22T07:00:00-04:00",
      tone: "fun",
      title: { en: "What's on the back of your ballot", es: "Lo que viene al reverso de tu boleta" },
      blurb: {
        en: "The three statewide amendments in plain words, with links to the official text, plus five ways to spend a Saturday in Seminole.",
        es: "Las tres enmiendas estatales en palabras sencillas, con enlaces al texto oficial, y cinco planes para un sábado en Seminole."
      },
      facts: [
        {
          id: "three-amendments-2026",
          claim: {
            en: "Florida's Nov 3, 2026 ballot carried three constitutional amendments placed there by the Legislature; each needed 60% to pass.",
            es: "La boleta de Florida del 3 de noviembre de 2026 traía tres enmiendas constitucionales propuestas por la Legislatura; cada una necesitaba el 60 % para aprobarse."
          },
          source: "https://cbs12.com/news/local/florida-november-ballot-3-proposed-constitutional-amendments-heres-what-they-do-homestead-exemptions-budget-stabilization-fund-rainy-day-fund-agricultural-property-taxes-voters-need-to-know",
          sources: ["https://www.fox13news.com/news/florida-midterm-election-results-2026-amendments-1-2-3"],
          verified: "2026-11-09",
          confidence: "med"
        }
      ]
    }
  ]
};
