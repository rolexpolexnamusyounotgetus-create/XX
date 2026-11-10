/*!
 * data/team.js: the chapter team page for the Young Democrats of Seminole County (YDSC), EN + ES.
 *
 * DEMO DATA (demo:true). Round 1, Nov 10, 2026 (G-ABOUT, genz-brand-18): about.html no longer shows the placeholder
 * names. It renders a compact "Find your seat" grid of role tiles (title, officer or chair, monogram, bio and does[]
 * in a disclosure) and a short "Run for a role" block (runForRole; its button goes to join.html?intent=role while
 * links.contact is ''). name{} stays here for a future filled-seat view and is never shown without consent.
 * Nov 9, 2026 (W7): the treasurer no longer promises a public receipts page
 * (BRIEF 4.9: only if the chapter agrees to publish one). Checker, Nov 9: the president's bio no longer
 * implies a chapter group chat (BRIEF 9), and demoNote no longer repeats the DEMO tag it sits beside.
 * Every name here is an obvious placeholder ("Your President Here"). No real
 * officer is named, on purpose: real names, photos and pronouns go in only with each person's
 * consent, after the chapter signs off. The role list itself is a DEMO structure: YDSC's bylaws and
 * elected board decide the real seats (president, vice president, secretary and treasurer are the
 * usual officer seats; the four chair roles are suggestions).
 *
 * Facts quoted in the copy (membership ages, dues, voting vs non-voting membership) come from YDSC's
 * public ActBlue dues page, which quotes the chapter's membership rules, and carry source + verified
 * in facts[] (written and re-checked against that page on Mon Nov 9, 2026). Chapters are chartered
 * by Florida Young Democrats (docs/research/00).
 *
 * Load: classic script, after assets/js/config.js. No modules, no fetches. Node check:
 *   node -e "global.window={};require('./data/team.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * CONVENTIONS (same as data/civic.js): bilingual text is { en, es }; Spanish is natural, neutral Latin
 * American Spanish, not a word-for-word translation. Links are { key, url, label{} }: render
 * YSD.cfg(key, url); an empty config value means "not configured" (fall back to the join page).
 *
 * TOP LEVEL (window.YSD_DATA.team)
 *   version, demo, verified, note{}, labels{}, tokens{}, roles[] (ROLE, in display order),
 *   runForRole{ eyebrow{}, title{}, body{}, eligibility{}, bigger{}, cta{ label{}, key, url, fallback,
 *   note }, demoNote{} }, facts[] ({ id, claim{}, source, verified, confidence })
 *
 * tokens{}  avatar colour tokens: { '<css var>': { hex, fg, contrast, note } }. Names follow report 03's
 *           recommended "Celery City Pop" palette (docs/research/03, not final yet). Use
 *           var(<token>, <hex>) for the circle and `fg` for the monogram; every pair is at least 4.5:1.
 *           events.js cover.token and levels.js token fields use the same names.
 *
 * ROLE
 *   id            'president' | 'vice-president' | 'secretary' | 'treasurer' | 'communications' |
 *                 'organizing' | 'membership' | 'spanish-outreach' (events.js host.team uses these)
 *   order         display order
 *   seat          'officer' | 'chair'
 *   demo          true (render labels.demo, "DEMO" in both languages, on the card)
 *   status        'placeholder' (render labels.placeholder) | 'filled' | 'open'
 *   title{}       the role name
 *   name{}        PLACEHOLDER display name. Never replace with a real name without consent.
 *   pronouns      null (optional field: show only when the person chooses to share; {en,es} if set)
 *   bio{}         one line, in voice
 *   does[]        [{en,es}] two or three concrete responsibilities, for a role detail view
 *   avatar        { token, monogram (2 letters max, shown in the circle), alt{} }
 *   contact       { key, url } or null (render a "Message this role" link only when set)
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.team = {
  version: 1,
  demo: true,
  verified: "2026-11-09",

  note: {
    en: "DEMO team page. Every name below is a placeholder until the chapter's real board says yes to being listed.",
    es: "Página de equipo DEMO. Todos los nombres de abajo son de relleno hasta que la directiva real del grupo acepte aparecer."
  },

  labels: {
    heading: { en: "Who runs this thing", es: "Quiénes organizan esto" },
    sub: {
      en: "All volunteers. Here's who does what, and how you could do it too.",
      es: "Todas son personas voluntarias. Aquí ves quién hace qué, y cómo podrías hacerlo tú también."
    },
    demo: { en: "DEMO", es: "DEMO" },
    placeholder: { en: "Placeholder name", es: "Nombre de relleno" },
    openSeat: { en: "Open seat", es: "Puesto vacante" },
    officer: { en: "Officer", es: "Directiva" },
    chair: { en: "Chair", es: "Coordinación" },
    pronounsHint: { en: "Pronouns (optional)", es: "Pronombres (opcional)" },
    message: { en: "Message this role", es: "Escríbele a este puesto" },
    whatTheyDo: { en: "What this role does", es: "Qué hace este puesto" }
  },

  tokens: {
    "--violet": { hex: "#6A2BFF", fg: "#FFFFFF", contrast: "6.17:1", note: "white monogram" },
    "--violet-deep": { hex: "#4B12D6", fg: "#FFFFFF", contrast: "8.91:1", note: "white monogram" },
    "--celery": { hex: "#C8F03C", fg: "#140B33", contrast: "14.20:1", note: "ink monogram" },
    "--sky": { hex: "#4FD6FF", fg: "#140B33", contrast: "11.01:1", note: "ink monogram" },
    "--bubblegum": { hex: "#FF7AC6", fg: "#140B33", contrast: "7.86:1", note: "ink monogram" },
    "--orange": { hex: "#FF6B1A", fg: "#140B33", contrast: "6.55:1", note: "ink monogram; report 03 issue colour" },
    "--teal": { hex: "#00B3A6", fg: "#140B33", contrast: "7.11:1", note: "ink monogram; report 03 issue colour" },
    "--ink": { hex: "#140B33", fg: "#F6F3FF", contrast: "17.05:1", note: "paper monogram" }
  },

  roles: [
    {
      id: "president",
      order: 1,
      seat: "officer",
      demo: true,
      status: "placeholder",
      title: { en: "President", es: "Presidencia" },
      name: { en: "Your President Here", es: "Aquí va quien preside" },
      pronouns: null,
      bio: {
        en: "Runs the meetings, keeps them under an hour, and answers messages at reasonable hours.",
        es: "Dirige las reuniones, hace que duren menos de una hora y contesta los mensajes a horas razonables."
      },
      does: [
        { en: "Leads general meetings and sets the agenda with the board", es: "Dirige las reuniones generales y arma la agenda con la directiva" },
        { en: "Speaks for the chapter with Florida Young Democrats and the county party", es: "Representa al grupo ante Florida Young Democrats y el partido del condado" },
        { en: "Makes sure every seat on this page has backup", es: "Se asegura de que cada puesto de esta página tenga quien lo cubra" }
      ],
      avatar: { token: "--violet", monogram: "P", alt: { en: "Placeholder avatar for the president", es: "Avatar de relleno para la presidencia" } },
      contact: null
    },
    {
      id: "vice-president",
      order: 2,
      seat: "officer",
      demo: true,
      status: "placeholder",
      title: { en: "Vice President", es: "Vicepresidencia" },
      name: { en: "Your Vice President Here", es: "Aquí va quien ocupa la vicepresidencia" },
      pronouns: null,
      bio: {
        en: "Covers for the president, keeps the calendar honest, and makes sure every outdoor event has a plan B for rain.",
        es: "Cubre a la presidencia, mantiene el calendario al día y se asegura de que cada evento al aire libre tenga un plan B por si llueve."
      },
      does: [
        { en: "Steps in when the president can't", es: "Toma el mando cuando la presidencia no puede" },
        { en: "Owns the events calendar and the backup plans", es: "Maneja el calendario de eventos y los planes de respaldo" }
      ],
      avatar: { token: "--sky", monogram: "VP", alt: { en: "Placeholder avatar for the vice president", es: "Avatar de relleno para la vicepresidencia" } },
      contact: null
    },
    {
      id: "secretary",
      order: 3,
      seat: "officer",
      demo: true,
      status: "placeholder",
      title: { en: "Secretary", es: "Secretaría" },
      name: { en: "Your Secretary Here", es: "Aquí va quien lleva la secretaría" },
      pronouns: null,
      bio: {
        en: "Takes the notes, sends the recap, and remembers who said they'd bring the extension cord.",
        es: "Toma las notas, manda el resumen y se acuerda de quién dijo que traería la extensión."
      },
      does: [
        { en: "Keeps meeting minutes and sends a plain-language recap", es: "Lleva las actas y manda un resumen en palabras sencillas" },
        { en: "Keeps the member list current and private", es: "Mantiene la lista de miembros al día y en privado" }
      ],
      avatar: { token: "--celery", monogram: "S", alt: { en: "Placeholder avatar for the secretary", es: "Avatar de relleno para la secretaría" } },
      contact: null
    },
    {
      id: "treasurer",
      order: 4,
      seat: "officer",
      demo: true,
      status: "placeholder",
      title: { en: "Treasurer", es: "Tesorería" },
      name: { en: "Your Treasurer Here", es: "Aquí va quien lleva la tesorería" },
      pronouns: null,
      bio: {
        en: "Keeps the receipts: every dollar in, every dollar out, and the paperwork that goes with them.",
        es: "Guarda los recibos: cada dólar que entra, cada dólar que sale y el papeleo que los acompaña."
      },
      does: [
        { en: "Tracks dues, donations and spending", es: "Lleva la cuenta de cuotas, donaciones y gastos" },
        { en: "Reports the numbers to the board in plain words", es: "Le explica las cuentas a la directiva en palabras sencillas" }
      ],
      avatar: { token: "--bubblegum", monogram: "T", alt: { en: "Placeholder avatar for the treasurer", es: "Avatar de relleno para la tesorería" } },
      contact: null
    },
    {
      id: "communications",
      order: 5,
      seat: "chair",
      demo: true,
      status: "placeholder",
      title: { en: "Communications", es: "Comunicaciones" },
      name: { en: "Your Comms Lead Here", es: "Aquí va quien coordina comunicaciones" },
      pronouns: null,
      bio: {
        en: "Runs the socials and the Thursday Letter, and makes sure a real person reviews every member video before it goes up.",
        es: "Maneja las redes y La Carta del Jueves, y se asegura de que una persona de verdad revise cada video de los miembros antes de publicarlo."
      },
      does: [
        { en: "Edits the weekly letter and the event pages", es: "Edita la carta semanal y las páginas de eventos" },
        { en: "Leads the video review queue and creator nights", es: "Coordina la revisión de videos y las noches de creadores" }
      ],
      avatar: { token: "--violet-deep", monogram: "C", alt: { en: "Placeholder avatar for the communications lead", es: "Avatar de relleno para comunicaciones" } },
      contact: null
    },
    {
      id: "organizing",
      order: 6,
      seat: "chair",
      demo: true,
      status: "placeholder",
      title: { en: "Organizing", es: "Organización" },
      name: { en: "Your Organizing Lead Here", es: "Aquí va quien coordina la organización" },
      pronouns: null,
      bio: {
        en: "Plans the shifts, writes the scripts, and pairs every first-timer with a buddy.",
        es: "Planea los turnos, escribe los guiones y le asigna una pareja a cada persona nueva."
      },
      does: [
        { en: "Runs text banks, door-knocking shifts and trainings", es: "Organiza las jornadas de mensajes, las visitas a vecinos y los entrenamientos" },
        { en: "Keeps volunteers safe and within the rules (no forms, no petitions)", es: "Cuida a los voluntarios y que se cumplan las reglas (nada de formularios ni peticiones)" }
      ],
      avatar: { token: "--orange", monogram: "O", alt: { en: "Placeholder avatar for the organizing lead", es: "Avatar de relleno para organización" } },
      contact: null
    },
    {
      id: "membership",
      order: 7,
      seat: "chair",
      demo: true,
      status: "placeholder",
      title: { en: "Membership", es: "Membresía" },
      name: { en: "Your Membership Lead Here", es: "Aquí va quien coordina la membresía" },
      pronouns: null,
      bio: {
        en: "Says hi first. Welcomes new members, runs the mixers, and checks in so nobody drifts off.",
        es: "Es quien saluda primero. Recibe a los miembros nuevos, organiza los encuentros y está pendiente para que nadie se quede por fuera."
      },
      does: [
        { en: "Welcomes new members within a week of joining", es: "Da la bienvenida a cada miembro nuevo en su primera semana" },
        { en: "Runs the January mixer and dues season, including non-voting membership", es: "Organiza el encuentro de enero y la temporada de cuotas, incluida la membresía sin voto" }
      ],
      avatar: { token: "--teal", monogram: "M", alt: { en: "Placeholder avatar for the membership lead", es: "Avatar de relleno para membresía" } },
      contact: null
    },
    {
      id: "spanish-outreach",
      order: 8,
      seat: "chair",
      demo: true,
      status: "placeholder",
      title: { en: "Spanish-language outreach", es: "Difusión en español" },
      name: { en: "Your Spanish Outreach Lead Here", es: "Aquí va quien coordina la difusión en español" },
      pronouns: null,
      bio: {
        en: "Makes sure everything we do works in Spanish too, written by people who actually speak it.",
        es: "Se asegura de que todo lo que hacemos funcione también en español, escrito por gente que de verdad lo habla."
      },
      does: [
        { en: "Reviews every Spanish page, card and letter before it goes out", es: "Revisa cada página, tarjeta y carta en español antes de publicarla" },
        { en: "Hosts Spanish-language workshops and events", es: "Organiza talleres y eventos en español" }
      ],
      avatar: { token: "--ink", monogram: "ES", alt: { en: "Placeholder avatar for the Spanish-language outreach lead", es: "Avatar de relleno para la difusión en español" } },
      contact: null
    }
  ],

  runForRole: {
    eyebrow: { en: "SEATS OPEN", es: "PUESTOS ABIERTOS" },
    title: { en: "Run for a role", es: "Postúlate para un puesto" },
    body: {
      en: "No experience needed, and nobody expects you to know how a board works yet. Thinking about it? Come to a meeting, help with one event, and tell us. We'll pair you with whoever holds the seat now, so you can see what it actually involves before you decide.",
      es: "No necesitas experiencia, y nadie espera que ya sepas cómo funciona una directiva. ¿Lo estás pensando? Ven a una reunión, ayuda en un evento y cuéntanos. Te juntamos con quien tiene el puesto ahora para que veas de qué se trata de verdad antes de decidir."
    },
    eligibility: {
      en: "To vote in chapter elections you need a voting membership: you're 14 to 39, you pay the $20 yearly dues, and you live in Seminole County or go to an accredited high school or college here. Can't pay dues? Non-voting membership still gets you in the room. Ask us how officer elections work and when the next one is.",
      es: "Para votar en las elecciones del grupo necesitas la membresía con voto: tienes de 14 a 39 años, pagas la cuota anual de $20 y vives en el condado de Seminole o estudias aquí en una escuela secundaria, college o universidad acreditada. ¿No puedes pagar la cuota? Con la membresía sin voto igual formas parte. Pregúntanos cómo funcionan las elecciones de la directiva y cuándo es la próxima."
    },
    bigger: {
      en: "And if you ever want to run for something bigger, like a city seat or the school board, we'll help you figure out where to start.",
      es: "Y si algún día quieres postularte para algo más grande, como un puesto en tu ciudad o en la junta escolar, te ayudamos a ver por dónde empezar."
    },
    cta: {
      label: { en: "Tell us you're curious", es: "Cuéntanos que te interesa" },
      key: "links.contact",
      url: "",
      fallback: "join",
      note: "links.contact is empty in config today; send people to the join form (members.js) until the chapter sets a contact."
    },
    demoNote: {
      en: "Example copy. The chapter's bylaws decide how officer elections work.",
      es: "Texto de ejemplo. Los estatutos del grupo deciden cómo funcionan las elecciones de la directiva."
    }
  },

  facts: [
    {
      id: "voting-membership",
      claim: {
        en: "YDSC voting membership goes to dues-paying members who are residents or domiciliaries of Seminole County, or students of a fully accredited high school, college, university or institution of higher learning in Seminole County; voting members can vote and make motions.",
        es: "La membresía con voto de YDSC es para quienes pagan la cuota y residen o tienen domicilio en el condado de Seminole, o estudian en una escuela secundaria, college, universidad o institución de educación superior plenamente acreditada del condado; los miembros con voto pueden votar y presentar mociones."
      },
      source: "https://secure.actblue.com/donate/ydscdues",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "non-voting-membership",
      claim: {
        en: "Non-voting membership is for people who can't pay dues for reasons such as citizenship status or financial hardship.",
        es: "La membresía sin voto es para quienes no pueden pagar la cuota por razones como su situación de ciudadanía o dificultades económicas."
      },
      source: "https://secure.actblue.com/donate/ydscdues",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "member-ages-dues",
      claim: {
        en: "Membership is open to people at least 14 and under 40 who profess and demonstrate allegiance to the principles of the Democratic Party; dues are $20 a year, paid in January unless a member joins later in the year.",
        es: "La membresía está abierta a personas de al menos 14 años y menores de 40 que declaran y demuestran su adhesión a los principios del Partido Demócrata; la cuota es de $20 al año y se paga en enero, salvo que la persona se una más tarde en el año."
      },
      source: "https://secure.actblue.com/donate/ydscdues",
      verified: "2026-11-09",
      confidence: "high"
    }
  ]
};
