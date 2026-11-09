/*!
 * data/events.js: DEMO events for the Young Democrats of Seminole County (YDSC) site, EN + ES.
 *
 * EVERY EVENT HERE IS A DEMO (demo:true). None of these events is scheduled. The going counts,
 * capacities, hosts, perks and venues are made up so the Partiful-style event pages look alive.
 * Pages must show labels.demoEvent on every card and labels.going (which carries "DEMO") next to
 * every count, and hide this whole file when YSD_CONFIG.demo is false.
 *
 * What IS real: the facts quoted in event copy (mail-ballot expiry, the 2027 ID rule, SunRail's
 * weekday-only service, Oviedo's 2027 election, park addresses, sunset times). Each one is in that
 * event's facts[] with a source URL and a verified date (written and then re-checked against the
 * official pages on Mon Nov 9, 2026).
 *
 * MAIL-BALLOT WORDING (matches data/civic.js): one request lasts through the end of the year of the
 * next regular general election (F.S. 101.62(1)(a)). That election was Nov 3, 2026, so requests made
 * BEFORE it end Dec 31, 2026. Say "asked for a mail ballot before Nov 3", not "every request on
 * file": the statute reads as if a request made after Nov 3 would run through 2028, and the
 * Supervisor of Elections hasn't posted how it handles those. Copy follows ruling 00's required shape:
 * "Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set
 * through 2028. Check My Voter Record to be sure."
 *
 * SPANISH TERMS (same as data/civic.js, issues.js, strings.js): "boleta por correo" for the mail
 * ballot and "solicitud de boleta por correo" for the request (Florida's Spanish form DS-DE 160 says
 * "boleta de voto por correo"; we drop "de voto" for length); "voto por correo" only as the name of
 * the program or page; "inscripción" for registration; "identificación" for ID.
 *
 * Load: classic script, after assets/js/config.js. No modules, no fetches. Node check:
 *   node -e "global.window={};require('./data/events.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * BRAND AND SAFETY RULES BAKED IN (docs/research/00, 05; docs/legal/MINORS_POLICY.md)
 *  - Venues are public places (with an address only when an official page confirms it) or generic
 *    venues ("a pizza place near the Longwood SunRail station"). Never name a real business: it
 *    would look like that business is hosting.
 *  - No real people. Hosts are labels.demoHost. No politician is named as a guest or endorser.
 *  - Every event is alcohol-free (members start at 14). ages.guardian:true means under-18s need a
 *    guardian's OK (policy.guardian): every event that ends after dark (afterDark:true) and every
 *    door-knocking shift (MINORS_POLICY: off-site work). Canvassing teens work in pairs, in daylight,
 *    with an adult lead in sight. Rides for under-18s follow the policy's rides rule.
 *  - Nobody collects forms, signatures or personal data at our events: people use official sites.
 *  - No events on Thanksgiving (Nov 26, 2026), Christmas Eve or Day, or New Year's Day (skipDates).
 *  - Copy follows docs/research/05: am/pm times, sentence case, at most one "!" per screen (there are
 *    none here), no emoji in long copy, tone 'calm' events get the calm template.
 *
 * CONVENTIONS (same as data/civic.js)
 *  - Bilingual text is { en, es }. Spanish is written for neutral Latin American readers, not
 *    translated word for word. Placeholders: {url} (share link), {n} (a number), {date}, {city}.
 *    {link} is the site's canonical name for the share link; YSD.fill(text, { link }) in
 *    assets/js/config.js fills both {link} and {url}, so these templates work as they are.
 *  - start/end are ISO 8601 with the America/New_York offset. All events fall between Nov 1, 2026
 *    and Mar 14, 2027, so every offset is EST (-05:00).
 *  - when{} is a ready-made display label ("Sat, Nov 14, 4:45 to 6:15 pm"). Format from start/end
 *    yourself if you prefer; tests/node check compares when{} against start.
 *  - Links are { linkId, key, url, label{}, urlEs? }: linkId names civic.links.<id> in
 *    data/civic.js; key is a dotted path in YSD_CONFIG; render YSD.cfg(key, url).
 *  - facts[] { id, claim{}, source, verified, confidence 'high'|'med'|'low', computed? }. Editors
 *    only; do not render confidence. Show a "Sources" disclosure on the event page if you like.
 *
 * TOP LEVEL (window.YSD_DATA.events)
 *   version, demo, verified, timezone, note{}, labels{}, policy{}, rsvpForm{}, vibes{}, cities{},
 *   coverRules{}, skipDates[], schedule{} (+ schedule.drop: the January drop), partners[] (REAL
 *   SemDems events, link out only), items[] (EVENT, sorted by start)
 *
 * EVENT
 *   id            stable slug; use it for URLs (events.html#<id> or /events/<id>/) and as the YSD.cal id
 *   demo          true
 *   status        'scheduled' (demo) | 'full' | 'cancelled'
 *   series        repeatable format ('sunset-walk', 'trivia', ...). levels.js badges key off it.
 *   kind          'social' | 'learn' | 'volunteer' | 'create'
 *   tone          'fun' | 'calm' (calm: no confetti, no emoji, no donation module beside it)
 *   title{}, tagline{} (one line), description{} (2-5 sentences), notice{}? (required wording,
 *                 show verbatim in a callout), extraNote{}? (safety or consent note, show near RSVP)
 *   start, end    ISO with offset; when{} display label; afterDark (bool: ends after sunset)
 *   city          place id shared with data/civic.js places[] ('sanford', 'lake-mary', ...)
 *   place         { kind 'public'|'generic', name{}, address (string|null: public places only, and
 *                 only when an official page confirms it), mapQuery (string|null: public places only,
 *                 for a maps link), directions{}?, then{}? (second stop, generic), remote (bool),
 *                 source?, verified?, note? (editors only; never render) }
 *   vibes[]       ids from vibes{}
 *   language      ['en'] | ['es'] | ['en','es']: language the event runs in; interpretation{}? note
 *   bring[]       [{en,es}] what to bring
 *   accessibility {en,es}
 *   ages          { min: 14, label{}, guardian (bool: under-18s need a guardian's OK; true for every
 *                 afterDark event and every door-knocking shift) }
 *   alcoholFree   true
 *   cost          { amount: 0, label{} }
 *   host          { label{} (DEMO host, always the same as labels.demoHost), team: role id in data/team.js }
 *   capacity      number (DEMO)
 *   going         number (DEMO): render with labels.going, never alone
 *   cover         { query (stock-photo search hint), alt{} (for the hinted photo), token (CSS colour
 *                 token: the event's --duo colour), sticker (data/stickers.js id drawn on the cover),
 *                 short{} (2 or 3 words for the poster-style cover), photo? { id, photographer,
 *                 photographerHandle, page, width, height, alt{}, verified } (Unsplash photos viewed
 *                 and credited by W2 on Nov 9, 2026; no photo = a solid --duo block with the sticker) }
 *   share         { text{} (friend-text style, ends with {url}), title{} (short, for Web Share title) }
 *   bringFriend   {en,es}: the "+1" line under the RSVP button
 *   calDescription {en,es}: body for the .ics/Google event
 *   links[]       official links shown on the event page
 *   xpActions[]   action ids from data/levels.js this event can award (rsvp, attend, volunteer-shift...)
 *   badgeIds[]    badges in data/levels.js tied to this event
 *   sampleQuestions[]? (trivia only) { q{}, a{}, source, sources?, verified, confidence }
 *   facts[]       { id, claim{}, source, sources?[], verified, confidence, computed? }
 *
 * CALENDAR: build the YSD.cal event per language like this:
 *   { id: e.id, title: e.title[lang] + ' (DEMO)', start: e.start, end: e.end,
 *     location: e.place.name[lang] + ', ' + events.cities[e.city][lang],
 *     address: e.place.address || '', description: e.calDescription[lang], url: <event page URL> }
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.events = {
  version: 1,
  demo: true,
  verified: "2026-11-09",
  timezone: "America/New_York",

  note: {
    en: "These are DEMO events for a preview of the site. None of them is scheduled yet, and the counts are made up.",
    es: "Estos son eventos DEMO para una vista previa del sitio. Ninguno está programado todavía y las cifras son inventadas."
  },

  labels: {
    demo: { en: "DEMO", es: "DEMO" },
    demoEvent: { en: "DEMO event", es: "Evento DEMO" },
    demoHost: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" },
    demoVenue: { en: "DEMO venue", es: "Lugar DEMO" },
    going: { en: "{n} going (DEMO)", es: "{n} van (DEMO)" },
    spotsLeft: { en: "{n} spots left", es: "Quedan {n} lugares" },
    full: { en: "Full. Want a spot if one opens?", es: "Está lleno. ¿Quieres un lugar si se libera uno?" },
    waitlist: { en: "Join the waitlist", es: "Anótame en la lista de espera" },
    rsvp: { en: "Save my seat", es: "Guárdame un lugar" },
    rsvpDone: { en: "Seat saved. We'll send a reminder the day before.", es: "Lugar guardado. Te mandamos un recordatorio el día antes." },
    addToCalendar: { en: "Add to calendar", es: "Agregar al calendario" },
    share: { en: "Text this to a friend", es: "Mándaselo a alguien" },
    getDirections: { en: "Get directions", es: "Cómo llegar" },
    free: { en: "Free", es: "Gratis" },
    whatToBring: { en: "What to bring", es: "Qué llevar" },
    accessibility: { en: "Access", es: "Accesibilidad" },
    whoItsFor: { en: "Who it's for", es: "Para quién es" },
    vibes: { en: "Vibe", es: "Ambiente" },
    host: { en: "Host", es: "Organiza" },
    remote: { en: "Remote option", es: "Opción a distancia" },
    alcoholFree: { en: "Alcohol-free", es: "Sin alcohol" },
    sources: { en: "Where these facts come from", es: "De dónde salen estos datos" },
    inSpanish: { en: "In Spanish", es: "En español" },
    past: { en: "This one already happened.", es: "Este evento ya pasó." },
    empty: {
      en: "No events this week. Rest counts too. Want to host the next one? We'll help you plan it.",
      es: "No hay eventos esta semana. Descansar también cuenta. ¿Quieres organizar el próximo? Te ayudamos a planearlo."
    },
    /* RSVP sheet, RSVP row and invite landing (assets/js/rsvp.js reads these wherever events data loads) */
    youreIn: { en: "You're in", es: "Ya te apuntaste" },
    onWaitlist: { en: "On the waitlist", es: "En la lista de espera" },
    rsvpQuestion: { en: "Are you in?", es: "¿Te apuntas?" },
    you: { en: "You", es: "Tú" },
    maybeSaved: { en: "Marked as a maybe. No pressure, change it anytime.", es: "Quedaste como \"quizás\". Sin presión, lo cambias cuando quieras." },
    cantSaved: { en: "Rest counts too. See you at the next one.", es: "Descansar también cuenta. Nos vemos en el próximo." },
    cleared: { en: "Got it. Your answer is cleared.", es: "Listo. Borramos tu respuesta." },
    waitlistTitle: { en: "Join the waitlist", es: "Anótame en la lista de espera" },
    waitlistSub: { en: "It's full right now. Leave your name and we'll let you know if a spot opens.", es: "Ahora está lleno. Deja tu nombre y te avisamos si se libera un lugar." },
    waitlistDone: { en: "You're on the waitlist. If a spot opens, we'll let you know.", es: "Estás en la lista de espera. Si se libera un lugar, te avisamos." },
    contactInvalid: { en: "That doesn't look like an email or a 10-digit mobile number. Check it once more?", es: "Eso no parece un correo ni un celular de 10 dígitos. ¿Lo revisas otra vez?" },
    shareName: { en: "Show my first name on the invite", es: "Mostrar mi nombre en la invitación" },
    shareNameTeen: { en: "Under 18, your invite links never show your name.", es: "Si tienes menos de 18, tus enlaces nunca muestran tu nombre." },
    plusOneFriend: { en: "+1 a friend", es: "Invita a alguien" },
    bringTitle: { en: "Bring a friend", es: "Trae a alguien" },
    calTitle: { en: "Add it to your calendar", es: "Agrégalo a tu calendario" },
    calIcs: { en: "Calendar file (.ics)", es: "Archivo de calendario (.ics)" },
    calGoogle: { en: "Google", es: "Google" },
    calOutlook: { en: "Outlook.com", es: "Outlook.com" },
    changeRsvp: { en: "Change my RSVP", es: "Cambiar mi respuesta" },
    cantAnymore: { en: "Can't make it anymore", es: "Ya no puedo ir" },
    done: { en: "Done", es: "Listo" },
    notNow: { en: "Not now", es: "Ahora no" },
    demoShare: { en: "(DEMO event)", es: "(Evento DEMO)" },
    invitedBy: { en: "{name} invited you", es: "{name} te invitó" },
    invitedAnon: { en: "A friend invited you", es: "Alguien te invitó" },
    invitedTo: { en: "to {event} · {when}", es: "a {event} · {when}" },
    invitedToUs: { en: "to the Young Dems: free hangouts and straight answers about voting, all over Seminole.", es: "a los Young Dems: encuentros gratis y respuestas claras sobre cómo votar, en todo Seminole." },
    invitedPast: { en: "That one already happened, but there's more coming. Pick another night.", es: "Ese evento ya pasó, pero viene más. Elige otra noche." },
    invitedSub: { en: "Free, no account needed. Save your seat in one tap.", es: "Gratis y sin crear cuenta. Guarda tu lugar con un toque." },
    dismiss: { en: "Dismiss the invite", es: "Cerrar la invitación" },
    newTag: { en: "Just dropped", es: "Recién salido" },
    spotsLeftDemo: { en: "{n} spots left (DEMO)", es: "Quedan {n} lugares (DEMO)" },
    fullDemo: { en: "Full (DEMO)", es: "Lleno (DEMO)" }
  },

  policy: {
    ages: {
      en: "You don't have to be a member, and you don't have to be registered with any party.",
      es: "No tienes que ser miembro ni estar inscrito en ningún partido."
    },
    guardian: {
      en: "Under 18? Events that end after dark, and door-knocking shifts, need a quick OK from a parent or guardian. We'll send the form when you RSVP.",
      es: "¿Tienes menos de 18 años? Para los eventos que terminan de noche y para los turnos de visitas a vecinos necesitas el permiso de tu mamá, tu papá o tu tutor. Te mandamos el formulario cuando confirmes."
    },
    alcohol: {
      en: "All our events are alcohol-free.",
      es: "Todos nuestros eventos son sin alcohol."
    },
    photos: {
      en: "We ask before we post anyone's photo, and a parent or guardian says yes first for anyone under 18. Rather not be in pictures? Tell us at check-in.",
      es: "Pedimos permiso antes de publicar la foto de cualquier persona, y para menores de 18 primero tiene que decir que sí su mamá, papá o tutor. ¿Prefieres no salir en fotos? Avísanos al llegar."
    },
    noForms: {
      en: "We never collect forms, signatures or personal information at events. You do everything yourself on official sites.",
      es: "En nuestros eventos nunca recogemos formularios, firmas ni datos personales. Todo lo haces tú en los sitios oficiales."
    },
    conduct: {
      en: "Be kind, let people finish their sentences, and look out for each other. Anyone who harasses someone is asked to leave.",
      es: "Sé amable, deja que la gente termine de hablar y cuidémonos entre todos. A quien acose a alguien le pediremos que se vaya."
    },
    source: "docs/legal/MINORS_POLICY.md",
    verified: "2026-11-09"
  },

  rsvpForm: {
    note: "Partiful-style: no account, one screen. Field names match YSD.members where they overlap. Demo: nothing is sent.",
    fields: [
      { name: "firstName", type: "text", required: true, label: { en: "What should we call you?", es: "¿Cómo te llamamos?" } },
      { name: "contact", type: "text", required: true, label: { en: "Email or phone, for the reminder", es: "Email o teléfono, para el recordatorio" } },
      { name: "plusOne", type: "number", required: false, label: { en: "Bringing someone? How many? (Optional)", es: "¿Traes a alguien? ¿Cuántas personas? (Opcional)" } },
      {
        name: "access", type: "textarea", required: false,
        label: {
          en: "Anything that would make this easier for you? Rides, ASL, a quiet corner, kids in tow. Tell us and we'll do our best. (Optional)",
          es: "¿Algo que te lo haría más fácil? Transporte, intérprete de lengua de señas, un rincón tranquilo, venir con niños. Cuéntanos y haremos lo posible. (Opcional)"
        }
      },
      { name: "spanish", type: "checkbox", required: false, label: { en: "I'd like someone who speaks Spanish there", es: "Me gustaría que haya alguien que hable español" } },
      { name: "under18", type: "checkbox", required: false, label: { en: "I'm under 18", es: "Tengo menos de 18 años" } }
    ],
    consent: {
      en: "We'll only use this to send you details about this event. You can ask us to delete it anytime.",
      es: "Solo usaremos estos datos para mandarte información de este evento. Puedes pedirnos que los borremos cuando quieras."
    },
    demoNote: {
      en: "DEMO: nothing you type here leaves your browser.",
      es: "DEMO: nada de lo que escribas aquí sale de tu navegador."
    }
  },

  vibes: {
    "first-timers": { en: "First-timer friendly", es: "Ideal si es tu primera vez" },
    outdoors: { en: "Outdoors", es: "Al aire libre" },
    chill: { en: "Low-key", es: "Tranquilo" },
    debrief: { en: "Real talk", es: "Para conversar en serio" },
    social: { en: "Meet people", es: "Para conocer gente" },
    games: { en: "Games", es: "Juegos" },
    music: { en: "Music", es: "Música" },
    learn: { en: "Learn something", es: "Aprende algo" },
    "hands-on": { en: "Hands-on", es: "Manos a la obra" },
    create: { en: "Make stuff", es: "Para crear" },
    volunteer: { en: "Volunteer shift", es: "Turno de voluntariado" },
    "en-espanol": { en: "In Spanish", es: "En español" },
    "remote-ok": { en: "Remote option", es: "Opción a distancia" },
    "kids-welcome": { en: "Kids welcome", es: "Niños bienvenidos" },
    "by-train": { en: "Come by train", es: "Llega en tren" }
  },

  cities: {
    "altamonte-springs": { en: "Altamonte Springs", es: "Altamonte Springs" },
    casselberry: { en: "Casselberry", es: "Casselberry" },
    "lake-mary": { en: "Lake Mary", es: "Lake Mary" },
    longwood: { en: "Longwood", es: "Longwood" },
    oviedo: { en: "Oviedo", es: "Oviedo" },
    sanford: { en: "Sanford", es: "Sanford" },
    "winter-springs": { en: "Winter Springs", es: "Winter Springs" }
  },

  coverRules: {
    en: "Cover photos: stock (Unsplash) or member photos with consent. No real officials or candidates, no Native American imagery, no recognizable minors without guardian consent, no shots that show a real business's name or sign.",
    es: "Fotos de portada: de banco de imágenes (Unsplash) o de miembros con su permiso. Nada de funcionarios ni candidatos reales, nada de imágenes de pueblos indígenas, nada de menores reconocibles sin permiso de su tutor, nada que muestre el nombre o letrero de un negocio real."
  },

  skipDates: [
    { date: "2026-11-26", name: { en: "Thanksgiving", es: "Día de Acción de Gracias" } },
    { date: "2026-12-24", name: { en: "Christmas Eve", es: "Nochebuena" } },
    { date: "2026-12-25", name: { en: "Christmas Day", es: "Navidad" } },
    { date: "2027-01-01", name: { en: "New Year's Day", es: "Año Nuevo" } }
  ],

  schedule: {
    note: "Demo schedule chosen to avoid the holidays above, the Seminole County Democrats' monthly meeting (second Thursday, 6:30 pm social, 7 pm meeting, Altamonte Springs) and their holiday party (Fri, Dec 11), per the Florida Democrats events calendar (checked Nov 9, 2026). The holiday party is NOT listed: it is ticketed, at a private home, and serves beverages, which doesn't fit a 14-and-up site's host rules (lead, Nov 9; the chapter can decide).",
    source: "https://events.floridadems.org/org/seminole-county-democrats",
    verified: "2026-11-09",
    /* The January drop (BRIEF 4.3, 5.4): events that start after `cutoff` stay hidden on the events
       list until `opensAt` by the visitor's clock (events.html?drop=open previews them). DEMO date. */
    drop: {
      demo: true,
      cutoff: "2026-12-31T23:59:59-05:00",
      opensAt: "2026-12-15T12:00:00-05:00",
      label: { en: "January's lineup drops Tue, Dec 15 at noon (DEMO)", es: "La programación de enero sale el mar. 15 de dic. a las 12 p. m. (DEMO)" },
      calTitle: { en: "Young Dems: January's lineup drops (DEMO)", es: "Young Dems: sale la programación de enero (DEMO)" },
      calDescription: {
        en: "DEMO reminder. The Young Dems post January's events at noon today. Pick one and bring a friend.",
        es: "Recordatorio DEMO. Los Young Dems publican los eventos de enero hoy a las 12 p. m. Elige uno y trae a alguien."
      }
    }
  },

  /* REAL events hosted by the Seminole County Democrats (not by YDSC), copied from the Florida
     Democrats events calendar and re-checked on Mon Nov 9, 2026. Pages show them with a REAL tag and a
     link out to the party's page for RSVP: no RSVP sheet, no count. Each one hides itself after `end`.
     Re-check the calendar before every review pass. */
  partners: [
    {
      id: "semdems-meeting-2026-11-12",
      real: true,
      host: { en: "Seminole County Democrats", es: "Seminole County Democrats" },
      title: { en: "SemDems monthly meeting", es: "Reunión mensual de SemDems" },
      start: "2026-11-12T19:00:00-05:00",
      end: "2026-11-12T21:00:00-05:00",
      city: "altamonte-springs",
      detail: {
        en: "Open to the public, second Thursday of every month. People start chatting at 6:30 pm, and the meeting starts at 7.",
        es: "Abierta al público, el segundo jueves de cada mes. La gente empieza a llegar y conversar a las 6:30 p. m., y la reunión empieza a las 7."
      },
      url: "https://events.floridadems.org/event/12198/semdems-monthly-meeting",
      source: "https://events.floridadems.org/event/12198/semdems-monthly-meeting",
      verified: "2026-11-09",
      confidence: "high"
    },
    {
      id: "semdems-meeting-2026-12-10",
      real: true,
      host: { en: "Seminole County Democrats", es: "Seminole County Democrats" },
      title: { en: "SemDems monthly meeting", es: "Reunión mensual de SemDems" },
      start: "2026-12-10T19:00:00-05:00",
      end: "2026-12-10T21:00:00-05:00",
      city: "altamonte-springs",
      detail: {
        en: "Open to the public, second Thursday of every month. December's meeting is at a different address, so check their page.",
        es: "Abierta al público, el segundo jueves de cada mes. La de diciembre es en otra dirección, así que revisa su página."
      },
      url: "https://events.floridadems.org/org/seminole-county-democrats",
      source: "https://events.floridadems.org/org/seminole-county-democrats",
      verified: "2026-11-09",
      confidence: "high"
    }
  ],

  items: [
    {
      id: "sunset-walk-lake-monroe",
      demo: true,
      status: "scheduled",
      series: "sunset-walk",
      kind: "social",
      tone: "calm",
      title: { en: "Sunset walk-and-talk on Lake Monroe", es: "Caminata al atardecer en el lago Monroe" },
      tagline: {
        en: "A slow lap of the lakefront at golden hour, with room to talk about what's next.",
        es: "Una vuelta tranquila por la orilla del lago a la hora dorada, con tiempo para hablar de lo que viene."
      },
      description: {
        en: "A slow, easy walk along the Sanford Riverwalk while the sun drops over Lake Monroe (sunset is around 5:32 pm). We'll talk about what happened on Nov 3, what comes next in 2027, and what you'd want this group to actually do. Feelings welcome, plans optional. Walk the whole way, or hold down a bench with us at the start.",
        es: "Una caminata tranquila por el Riverwalk de Sanford mientras el sol se esconde sobre el lago Monroe (se pone a eso de las 5:32 p. m.). Vamos a hablar de lo que pasó el 3 de noviembre, de lo que viene en 2027 y de lo que te gustaría que este grupo hiciera de verdad. Aquí caben todas las emociones; los planes son opcionales. Camina todo el trayecto o quédate con nosotros en una banca al inicio."
      },
      start: "2026-11-14T16:45:00-05:00",
      end: "2026-11-14T18:15:00-05:00",
      when: { en: "Sat, Nov 14, 4:45 to 6:15 pm", es: "Sáb., 14 de nov., de 4:45 a 6:15 p. m." },
      afterDark: true,
      city: "sanford",
      place: {
        kind: "public",
        name: { en: "Veterans Memorial Park, on Lake Monroe in downtown Sanford", es: "Veterans Memorial Park, a orillas del lago Monroe, en el centro de Sanford" },
        address: null,
        mapQuery: "Veterans Memorial Park, Sanford, FL",
        directions: {
          en: "Meet at the park on the lakefront, then we walk the Riverwalk from there. Look for the celery-green sign (DEMO).",
          es: "Nos vemos en el parque, frente al lago, y desde ahí caminamos por el Riverwalk. Busca el letrero verde apio (DEMO)."
        },
        remote: false,
        source: "https://sanfordfl.gov/?p=70776",
        verified: "2026-11-09"
      },
      vibes: ["outdoors", "debrief", "chill", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Water", es: "Agua" },
        { en: "Shoes you can walk in", es: "Zapatos cómodos para caminar" },
        { en: "A light layer for after sunset", es: "Algo ligero para abrigarte cuando se ponga el sol" },
        { en: "A friend", es: "Alguien que te acompañe" }
      ],
      accessibility: {
        en: "Slow pace, lots of stops. A few of us hold a bench at the start the whole time, so you can join the talk without the walk. Tell us what you need when you RSVP and we'll plan around it.",
        es: "Paso lento y muchas pausas. Algunos nos quedamos todo el tiempo en una banca al inicio, así que puedes sumarte a la conversación sin caminar. Cuéntanos qué necesitas al confirmar y lo planeamos."
      },
      ages: { min: 14, label: { en: "14 and up", es: "Desde 14 años" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "organizing" },
      capacity: 40,
      going: 23,
      cover: {
        query: "golden hour sunset over calm lake with palm trees and a lakefront path",
        alt: { en: "Sunset over a calm lake with palm trees", es: "Atardecer sobre un lago tranquilo con palmeras" },
        token: "--bubblegum",
        sticker: "celery",
        short: { en: "Sunset walk", es: "Caminata al atardecer" },
        photo: {
          id: "1783676056910-e5f3b27bdcbd",
          photographer: "Richard Burlton",
          photographerHandle: "richardworks",
          page: "https://unsplash.com/photos/people-watching-sunset-over-a-calm-lake-I1-hVKIchQo",
          width: 640,
          height: 427,
          alt: {
            en: "Two people stand on a lakeside dock at sunset while others watch the water from the shore",
            es: "Dos personas en un muelle a orillas de un lago al atardecer mientras otras miran el agua desde la orilla"
          },
          verified: "2026-11-09"
        }
      },
      share: {
        title: { en: "Sunset walk on Lake Monroe", es: "Caminata al atardecer en el lago Monroe" },
        text: {
          en: "Sunset walk on Lake Monroe, Sat Nov 14, 4:45 pm. Free, no speeches, just a walk and a real talk about what's next. Come with me? {url}",
          es: "Caminata al atardecer en el lago Monroe, sáb. 14 de nov., 4:45 p. m. Gratis y sin discursos: solo caminar y hablar en serio de lo que viene. ¿Vienes conmigo? {url}"
        }
      },
      bringFriend: {
        en: "Bring the friend you've been texting about the election all week. It's easier to talk side by side.",
        es: "Trae a esa persona con la que llevas toda la semana escribiéndote sobre las elecciones. Es más fácil hablar caminando."
      },
      calDescription: {
        en: "DEMO event. Slow walk on the Sanford Riverwalk at sunset (about 5:32 pm), plus a no-pressure talk about Nov 3 and 2027. Free, 14 and up, alcohol-free.",
        es: "Evento DEMO. Caminata tranquila por el Riverwalk de Sanford al atardecer (cerca de las 5:32 p. m.) y una conversación sin presión sobre el 3 de noviembre y 2027. Gratis, desde 14 años, sin alcohol."
      },
      links: [],
      xpActions: ["rsvp", "attend"],
      badgeIds: ["golden-hour"],
      facts: [
        {
          id: "sunset-2026-11-14",
          claim: {
            en: "Sunset in Sanford (28.80 N, 81.27 W) on Sat, Nov 14, 2026 is at about 5:32 pm EST (5:31:40 pm).",
            es: "En Sanford (28.80 N, 81.27 O), el sábado 14 de noviembre de 2026 el sol se pone a eso de las 5:32 p. m. (5:31:40 p. m., hora del Este)."
          },
          source: "https://api.sunrise-sunset.org/json?lat=28.8003&lng=-81.2731&date=2026-11-14&tzid=America/New_York",
          verified: "2026-11-09",
          confidence: "high",
          computed: "Astronomical calculation; re-checked with the NOAA sunrise/sunset algorithm (5:31:42 pm EST, civil dusk about 5:57 pm)."
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
        }
      ]
    },

    {
      id: "trivia-county-edition",
      demo: true,
      status: "scheduled",
      series: "trivia",
      kind: "social",
      tone: "fun",
      title: { en: "Trivia night: Seminole County edition", es: "Noche de trivia: edición condado de Seminole" },
      tagline: {
        en: "Seven cities, four SunRail stops, one very old tree. Bring a team or join one.",
        es: "Siete ciudades, cuatro estaciones de SunRail y un árbol muy, muy viejo. Trae tu equipo o únete a uno."
      },
      description: {
        en: "Five rounds of questions about the county you live in: the cities, the lakes, the history, and one round on how voting here actually works (no gotchas, promise). Teams of up to 6. Came alone? Perfect. We'll put you on a team with people you'll like.",
        es: "Cinco rondas de preguntas sobre el condado donde vives: las ciudades, los lagos, la historia y una ronda sobre cómo funciona de verdad votar aquí (sin trampas, prometido). Equipos de hasta 6 personas. ¿Vienes sin equipo? Perfecto. Te armamos uno con gente que te va a caer bien."
      },
      start: "2026-11-19T19:00:00-05:00",
      end: "2026-11-19T21:00:00-05:00",
      when: { en: "Thu, Nov 19, 7 to 9 pm", es: "Jue., 19 de nov., de 7 a 9 p. m." },
      afterDark: true,
      city: "casselberry",
      place: {
        kind: "generic",
        name: { en: "A board-game café in Casselberry (DEMO venue)", es: "Un café de juegos de mesa en Casselberry (lugar DEMO)" },
        address: null,
        mapQuery: null,
        remote: false
      },
      vibes: ["games", "social", "first-timers"],
      language: ["en"],
      bring: [
        { en: "A team name (puns encouraged, keep it kind)", es: "Un nombre para tu equipo (con juegos de palabras, pero buena onda)" },
        { en: "Nothing else. Answers go on paper, so phones stay in pockets.", es: "Nada más. Las respuestas van en papel, así que el celular se queda guardado." },
        { en: "Money for food, if you want some", es: "Dinero para comida, si se te antoja algo" }
      ],
      accessibility: {
        en: "Questions are read out loud and shown on a screen. Large-print answer sheets on request. A quieter table in the back if the room gets loud.",
        es: "Las preguntas se leen en voz alta y salen en pantalla. Hojas de respuestas en letra grande si las pides. Hay una mesa más tranquila al fondo por si hay mucho ruido."
      },
      ages: { min: 14, label: { en: "14 and up", es: "Desde 14 años" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free to play", es: "Jugar es gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "membership" },
      capacity: 48,
      going: 31,
      cover: {
        query: "friends laughing around a table with trivia answer sheets and board games",
        alt: { en: "Friends laughing around a table covered in game cards", es: "Un grupo de amigos riéndose alrededor de una mesa con tarjetas de juego" },
        token: "--celery",
        sticker: "gator",
        short: { en: "Trivia night", es: "Noche de trivia" },
        photo: {
          id: "1646934280686-768a69c444eb",
          photographer: "Jametlene Reskp",
          photographerHandle: "reskp",
          page: "https://unsplash.com/photos/a-group-of-people-sitting-around-a-wooden-table-WciYmqSwNAA",
          width: 640,
          height: 360,
          alt: {
            en: "Three friends laughing across a wooden table covered in playing cards",
            es: "Tres amigos se ríen alrededor de una mesa de madera llena de cartas de juego"
          },
          verified: "2026-11-09"
        }
      },
      share: {
        title: { en: "Seminole trivia night", es: "Noche de trivia de Seminole" },
        text: {
          en: "Trivia night about Seminole County, Thu Nov 19, 7 pm in Casselberry. Free. I need a teammate who knows things. {url}",
          es: "Noche de trivia sobre el condado de Seminole, jue. 19 de nov., 7 p. m., en Casselberry. Gratis. Necesito a alguien en mi equipo que sepa cosas. {url}"
        }
      },
      bringFriend: {
        en: "Bring the friend who always wins at trivia, and the one who knows every back road off 17-92.",
        es: "Trae a quien siempre gana en la trivia y a quien se sabe todos los atajos de la 17-92."
      },
      calDescription: {
        en: "DEMO event. Seminole County trivia, teams of up to 6, solo players welcome. Free, 14 and up, alcohol-free.",
        es: "Evento DEMO. Trivia sobre el condado de Seminole, equipos de hasta 6, también si vienes sin equipo. Gratis, desde 14 años, sin alcohol."
      },
      links: [],
      xpActions: ["rsvp", "attend"],
      badgeIds: ["trivia-brain"],
      sampleQuestions: [
        {
          q: { en: "Which Seminole city was nicknamed the Celery City?", es: "¿Qué ciudad de Seminole tenía el apodo de «Celery City», la ciudad del apio?" },
          a: { en: "Sanford", es: "Sanford" },
          source: "https://sanfordfl.gov/visitors/history-and-historic-preservation/",
          sources: ["https://richesmi.cah.ucf.edu/omeka/exhibits/show/origins_of_the_celery_city"],
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          q: { en: "How many SunRail stations are in Seminole County?", es: "¿Cuántas estaciones de SunRail hay en el condado de Seminole?" },
          a: { en: "Four: Altamonte Springs, Longwood, Lake Mary and Sanford", es: "Cuatro: Altamonte Springs, Longwood, Lake Mary y Sanford" },
          source: "https://sunrail.com/stations/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          q: { en: "About how old was The Senator, the cypress in Longwood's Big Tree Park, when it burned in 2012?", es: "¿Más o menos cuántos años tenía The Senator, el ciprés de Big Tree Park en Longwood, cuando se quemó en 2012?" },
          a: { en: "About 3,500 years", es: "Unos 3,500 años" },
          source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
          sources: ["https://en.wikipedia.org/wiki/The_Senator_(tree)"],
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          q: { en: "How many incorporated cities are in Seminole County?", es: "¿Cuántas ciudades incorporadas tiene el condado de Seminole?" },
          a: { en: "Seven", es: "Siete" },
          source: "https://voteseminole.gov/wp-content/uploads/2026/07/Totals-of-Voters-by-Cities.pdf",
          verified: "2026-11-09",
          confidence: "high"
        }
      ],
      facts: [
        {
          id: "sunrail-four-stations",
          claim: {
            en: "Four SunRail stations are in Seminole County: Altamonte Springs, Longwood, Lake Mary and Sanford.",
            es: "Cuatro estaciones de SunRail están en el condado de Seminole: Altamonte Springs, Longwood, Lake Mary y Sanford."
          },
          source: "https://sunrail.com/stations/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "seven-cities",
          claim: {
            en: "Seminole County has seven incorporated cities.",
            es: "El condado de Seminole tiene siete ciudades incorporadas."
          },
          source: "https://voteseminole.gov/wp-content/uploads/2026/07/Totals-of-Voters-by-Cities.pdf",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },

    {
      id: "text-bank-dec-31-heads-up",
      demo: true,
      status: "scheduled",
      series: "text-bank",
      kind: "volunteer",
      tone: "fun",
      title: { en: "Text bank: the Dec 31 heads-up", es: "Jornada de mensajes: el aviso del 31 de diciembre" },
      tagline: {
        en: "Two hours, a laptop or phone, and a friendly script. So nobody gets surprised in 2027.",
        es: "Dos horas, tu laptop o tu celular y un guion amable. Para que nadie se lleve una sorpresa en 2027."
      },
      description: {
        en: "Anyone who asked for a mail ballot before the Nov 3 election has a request that runs out Dec 31, and it's an easy one to miss. Tonight we text Seminole voters a friendly heads-up, in the words we use everywhere: \"Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure.\" New to this? We train you in 15 minutes, and you can make the script sound like you. If someone's not into it, we say thanks and move on. We never argue by text.",
        es: "Quien pidió la boleta por correo antes de las elecciones del 3 de noviembre tiene una solicitud que vence el 31 de diciembre, y es fácil que se pase por alto. Esta noche les mandamos a votantes de Seminole un aviso amable, con las palabras que usamos en todas partes: «¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028. Revisa My Voter Record para confirmarlo.» ¿Es tu primera vez? Te entrenamos en 15 minutos y puedes adaptar el guion a tu manera de hablar. Si a alguien no le interesa, le damos las gracias y seguimos. Nunca discutimos por mensaje."
      },
      start: "2026-12-01T18:30:00-05:00",
      end: "2026-12-01T20:30:00-05:00",
      when: { en: "Tue, Dec 1, 6:30 to 8:30 pm", es: "Mar., 1 de dic., de 6:30 a 8:30 p. m." },
      afterDark: true,
      city: "lake-mary",
      place: {
        kind: "generic",
        name: { en: "A coworking room in Lake Mary (DEMO venue), or from your couch", es: "Una sala de coworking en Lake Mary (lugar DEMO), o desde tu sofá" },
        address: null,
        mapQuery: null,
        remote: true
      },
      vibes: ["volunteer", "remote-ok", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "A charged laptop or phone", es: "Tu laptop o celular con batería" },
        { en: "Your charger", es: "Tu cargador" },
        { en: "Headphones, if you join from home", es: "Audífonos, si te conectas desde casa" }
      ],
      accessibility: {
        en: "Join from home if getting here is hard. The training call has captions on. Take a break whenever you want one.",
        es: "Conéctate desde casa si te cuesta llegar. La llamada de entrenamiento tiene subtítulos activados. Toma un descanso cuando quieras."
      },
      extraNote: {
        en: "Under 18? You're welcome to help write and test the script with an adult lead, and you'll need a guardian's OK because it's an evening event.",
        es: "¿Tienes menos de 18 años? Puedes ayudar a escribir y probar el guion junto a una persona adulta que coordina, y necesitas el permiso de tu tutor porque el evento es de noche."
      },
      ages: { min: 14, label: { en: "14 and up", es: "Desde 14 años" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free, snacks for the in-person crew", es: "Gratis, con algo para picar para quienes vengan en persona" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "organizing" },
      capacity: 25,
      going: 14,
      cover: {
        query: "hands typing on a phone at a table with snacks and laptops, warm light",
        alt: { en: "People texting on phones and laptops around a table", es: "Personas escribiendo en celulares y laptops alrededor de una mesa" },
        token: "--sky",
        sticker: "envelope",
        short: { en: "Text bank", es: "Jornada de mensajes" }
      },
      share: {
        title: { en: "Text bank: the Dec 31 heads-up", es: "Jornada de mensajes: el aviso del 31 de diciembre" },
        text: {
          en: "Text bank Tue Dec 1, 6:30 pm: two hours giving Seminole voters a heads-up that mail-ballot requests made before Nov 3 run out Dec 31. In Lake Mary or from your couch. Join me? {url}",
          es: "Jornada de mensajes el mar. 1 de dic., 6:30 p. m.: dos horas avisándoles a votantes de Seminole que las solicitudes de boleta por correo hechas antes del 3 de noviembre vencen el 31 de diciembre. En Lake Mary o desde tu sofá. ¿Te sumas? {url}"
        }
      },
      bringFriend: {
        en: "Text banking is better with a buddy. Bring one and split the snacks and the list.",
        es: "Mandar mensajes es mejor en compañía. Trae a alguien y se reparten la lista y la comida."
      },
      calDescription: {
        en: "DEMO event. Text bank about Florida's Dec 31 mail-ballot request expiry (requests made before Nov 3, 2026). 15-minute training, in person in Lake Mary or remote. Free.",
        es: "Evento DEMO. Jornada de mensajes sobre el vencimiento, el 31 de diciembre, de las solicitudes de boleta por correo hechas antes del 3 de noviembre de 2026. Entrenamiento de 15 minutos, en persona en Lake Mary o a distancia. Gratis."
      },
      links: [
        { linkId: "voteByMail", key: "links.vote.voteByMail", url: "https://voteseminole.gov/how-to-vote/vote-by-mail/", label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" } }
      ],
      xpActions: ["rsvp", "attend", "volunteer-shift"],
      badgeIds: ["shift-done"],
      facts: [
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
          id: "requests-after-nov-3",
          claim: {
            en: "Seminole voters can request a mail ballot online through the Supervisor of Elections or by phone at 407-585-8683. Under the state's rule, a request made after Nov 3, 2026 should last through 2028. The office hasn't posted how it handles requests made before Jan 1, 2027, so check My Voter Record to be sure.",
            es: "Los votantes de Seminole pueden pedir la boleta por correo en línea con la oficina del Supervisor de Elecciones o por teléfono al 407-585-8683. Según la regla estatal, una solicitud hecha después del 3 de noviembre de 2026 debería valer hasta 2028. La oficina no ha publicado cómo maneja las solicitudes hechas antes del 1 de enero de 2027, así que revisa My Voter Record para confirmarlo."
          },
          source: "https://voteseminole.gov/how-to-vote/vote-by-mail/",
          verified: "2026-11-09",
          confidence: "med"
        }
      ]
    },

    {
      id: "creator-night-60-seconds",
      demo: true,
      status: "full",
      series: "creator-night",
      kind: "create",
      tone: "fun",
      title: { en: "Creator night: film your 60 seconds", es: "Noche de creadores: graba tus 60 segundos" },
      tagline: {
        en: "Bring a phone and one thing you care about. Leave with a video you're proud of.",
        es: "Trae tu celular y algo que te importe. Te vas con un video que te encante."
      },
      description: {
        en: "We'll help you turn a thought into a 60-second vertical video: a hook, a short story, one ask. Ring lights, tripods, a quiet corner for voiceovers, and people who will tell you that take was good (it was). Need an idea? Try the Seminole spot that needs fixing, why you're renewing your mail ballot, or your 10-second why.",
        es: "Te ayudamos a convertir una idea en un video vertical de 60 segundos: un gancho, una historia corta y un solo llamado a la acción. Habrá aros de luz, trípodes, un rincón tranquilo para grabar la voz y gente que te va a decir que esa toma quedó bien (y es verdad). ¿Necesitas una idea? Prueba con el lugar de Seminole que hay que arreglar, por qué vas a renovar tu boleta por correo o tu porqué en 10 segundos."
      },
      extraNote: {
        en: "Your clip is yours. Nothing goes on our site without your OK, a real person reviews every video first, and if you're under 18, a parent or guardian signs off before we post anything where you can be recognized.",
        es: "Tu video es tuyo. Nada se publica en nuestro sitio sin tu permiso, una persona de verdad revisa cada video antes, y si tienes menos de 18 años, tu mamá, papá o tutor tiene que aprobar cualquier publicación donde se te reconozca."
      },
      start: "2026-12-03T18:30:00-05:00",
      end: "2026-12-03T21:00:00-05:00",
      when: { en: "Thu, Dec 3, 6:30 to 9 pm", es: "Jue., 3 de dic., de 6:30 a 9 p. m." },
      afterDark: true,
      city: "altamonte-springs",
      place: {
        kind: "generic",
        name: { en: "A coworking space in Uptown Altamonte (DEMO venue)", es: "Un espacio de coworking en Uptown Altamonte (lugar DEMO)" },
        address: null,
        mapQuery: null,
        remote: false
      },
      vibes: ["create", "hands-on", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Your phone, with some free storage", es: "Tu celular, con espacio libre" },
        { en: "Headphones with a mic, if you have them", es: "Audífonos con micrófono, si tienes" },
        { en: "An outfit you feel good in", es: "Ropa con la que te sientas bien" },
        { en: "One idea (or none, we'll help)", es: "Una idea (o ninguna, te ayudamos)" }
      ],
      accessibility: {
        en: "Step-free room (we'll confirm the venue before it goes live). We'll show everyone how to add captions in their editing app, so every clip is watchable with the sound off.",
        es: "Sala sin escalones (lo confirmamos antes de publicar el lugar). Le enseñamos a todo el mundo a ponerle subtítulos a su video en la app de edición, para que se entienda sin sonido."
      },
      ages: { min: 14, label: { en: "14 and up", es: "Desde 14 años" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "communications" },
      capacity: 20,
      going: 20,
      cover: {
        query: "person filming a vertical video with a phone on a tripod and a ring light",
        alt: { en: "A phone on a tripod in front of a ring light", es: "Un celular en un trípode frente a un aro de luz" },
        token: "--violet",
        sticker: "camera",
        short: { en: "Creator night", es: "Noche de creadores" }
      },
      share: {
        title: { en: "Creator night", es: "Noche de creadores" },
        text: {
          en: "Creator night Thu Dec 3, 6:30 pm in Altamonte: ring lights, tripods and help filming a 60-second video. Free. Come make one with me? {url}",
          es: "Noche de creadores el jue. 3 de dic., 6:30 p. m., en Altamonte: aros de luz, trípodes y ayuda para grabar un video de 60 segundos. Gratis. ¿Hacemos uno juntos? {url}"
        }
      },
      bringFriend: {
        en: "Bring your camera person. Or the friend who always says \"wait, do that again.\"",
        es: "Trae a quien te graba siempre. O a esa persona que siempre dice «espera, hazlo otra vez»."
      },
      calDescription: {
        en: "DEMO event. Film a 60-second vertical video with help, ring lights and tripods. Free, 14 and up, alcohol-free.",
        es: "Evento DEMO. Graba un video vertical de 60 segundos con ayuda, aros de luz y trípodes. Gratis, desde 14 años, sin alcohol."
      },
      links: [],
      xpActions: ["rsvp", "attend", "post-clip"],
      badgeIds: ["on-camera"],
      facts: []
    },

    {
      id: "renew-ready-party",
      demo: true,
      status: "scheduled",
      series: "renew-ready",
      kind: "learn",
      tone: "fun",
      title: { en: "Renew-ready party", es: "Fiesta para dejar lista tu renovación" },
      tagline: {
        en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure.",
        es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028. Revisa My Voter Record para confirmarlo."
      },
      description: {
        en: "Snacks, music, lawn games and a table of people who know this stuff. Bring your phone: we'll help you look up your voter record, fix your address if you've moved, find the one number you'll need, and ask for your mail ballot again on the official site, yourself. Seminole hasn't posted how it handles requests made before New Year's, so set a reminder to check My Voter Record in January and make sure yours shows.",
        es: "Habrá algo para picar, música, juegos al aire libre y una mesa con gente que se sabe todo esto. Trae tu celular: te ayudamos a buscar tu registro de votante, a corregir tu dirección si te mudaste, a encontrar el número que vas a necesitar y a pedir otra vez la boleta por correo en el sitio oficial, por tu cuenta. Seminole no ha publicado cómo maneja las solicitudes hechas antes de Año Nuevo, así que ponte un recordatorio para revisar My Voter Record en enero y confirmar que aparece la tuya."
      },
      extraNote: {
        en: "You do everything yourself on the official site. We never take forms or personal information.",
        es: "Todo lo haces tú en el sitio oficial. Nunca recibimos formularios ni datos personales."
      },
      start: "2026-12-13T14:00:00-05:00",
      end: "2026-12-13T16:00:00-05:00",
      when: { en: "Sun, Dec 13, 2 to 4 pm", es: "Dom., 13 de dic., de 2 a 4 p. m." },
      afterDark: false,
      city: "winter-springs",
      place: {
        kind: "public",
        name: { en: "Central Winds Park", es: "Central Winds Park" },
        address: null,
        mapQuery: "Central Winds Park, Winter Springs, FL",
        directions: {
          en: "At one of the park's picnic pavilions. We'll post which one here; look for the celery-green balloons (DEMO).",
          es: "En uno de los pabellones de picnic del parque. Aquí publicamos cuál; busca los globos verde apio (DEMO)."
        },
        remote: false,
        source: "https://www.winterspringsfl.org/parksrec/park/central-winds-park",
        verified: "2026-11-09",
        note: "The city's park page did not load for us (404 to scripts); search results show it lists a pavilion and 1000 Central Winds Dr. Address left out until someone checks it in a browser."
      },
      vibes: ["outdoors", "hands-on", "kids-welcome", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Your phone", es: "Tu celular" },
        { en: "Know where your Florida driver license or ID card is: you'll need its number (or the last 4 of your Social Security number) to renew", es: "Ten a mano tu licencia de conducir o tu identificación de Florida: vas a necesitar su número (o los últimos 4 dígitos de tu Seguro Social) para renovar" },
        { en: "A blanket or a folding chair", es: "Una manta o una silla plegable" },
        { en: "A friend whose request runs out too", es: "Alguien a quien también se le vence la solicitud" }
      ],
      accessibility: {
        en: "We'll be under a covered pavilion (we'll post which one). Extra folding chairs, a shady spot to sit, and kids are welcome.",
        es: "Vamos a estar en un pabellón techado (aquí publicamos cuál). Llevamos sillas plegables de sobra, hay un lugar con sombra para sentarse y los niños son bienvenidos."
      },
      ages: { min: 14, label: { en: "14 and up (kids welcome with a grown-up)", es: "Desde 14 años (niños bienvenidos con una persona adulta)" }, guardian: false },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "membership" },
      capacity: 60,
      going: 38,
      cover: {
        query: "picnic in a sunny Florida park pavilion with string lights and snacks",
        alt: { en: "A picnic table with snacks under a park pavilion", es: "Una mesa de picnic con comida bajo un pabellón en un parque" },
        token: "--celery",
        sticker: "calendar",
        short: { en: "Renew-ready", es: "Lista para renovar" },
        // No photo: the one we had (Unsplash 1595265616362, return envelopes) shows the USPS Official
        // Election Mail mark, a logo with a stylized flag (BRIEF 3.6). The poster title and sticker carry it.
      },
      share: {
        title: { en: "Renew-ready party", es: "Fiesta para dejar lista tu renovación" },
        text: {
          en: "Renew-ready party Sun Dec 13, 2 pm at Central Winds Park in Winter Springs. If you voted by mail this year, your request runs out Dec 31. Snacks, music, and we get ready together. Come? {url}",
          es: "Fiesta para dejar lista la renovación, dom. 13 de dic., 2 p. m., en Central Winds Park, Winter Springs. Si votaste por correo este año, tu solicitud vence el 31 de diciembre. Comida, música y nos preparamos juntos. ¿Vienes? {url}"
        }
      },
      bringFriend: {
        en: "Bring the friend who voted by mail this year. Their request runs out Dec 31 too.",
        es: "Trae a quien votó por correo este año. Su solicitud también vence el 31 de diciembre."
      },
      calDescription: {
        en: "DEMO event. Renew your Florida mail-ballot request (requests made before Nov 3 end Dec 31, 2026; ask again and you should be set through 2028). Snacks and music. Free.",
        es: "Evento DEMO. Renueva tu solicitud de boleta por correo en Florida (las hechas antes del 3 de noviembre vencen el 31 de diciembre de 2026; pídela de nuevo y debería valer hasta 2028). Comida y música. Gratis."
      },
      links: [
        { linkId: "voteByMail", key: "links.vote.voteByMail", url: "https://voteseminole.gov/how-to-vote/vote-by-mail/", label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" } },
        { linkId: "myVoterRecord", key: "links.vote.myVoterRecord", url: "https://voteseminole.gov/voters/my-voter-record/", label: { en: "Look up my voter record", es: "Buscar mi registro de votante" } }
      ],
      xpActions: ["rsvp", "attend"], // civic steps (renewing, reminders) earn nothing (00, BRIEF 5.5)
      badgeIds: [],
      facts: [
        {
          id: "mail-requests-expire-2026",
          claim: {
            en: "Florida vote-by-mail requests made before the Nov 3, 2026 general election end Dec 31, 2026 (one request lasts through the end of the year of the next regular general election).",
            es: "En Florida, las solicitudes de boleta por correo hechas antes de la elección general del 3 de noviembre de 2026 vencen el 31 de diciembre de 2026 (cada solicitud dura hasta el final del año de la siguiente elección general ordinaria)."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "renew-id-number",
          claim: {
            en: "In-person and phone requests need the voter's Florida driver license number, Florida ID card number or the last four digits of their Social Security number, whichever the Supervisor of Elections can verify. Seminole's online request form asks for the same.",
            es: "Las solicitudes en persona o por teléfono piden el número de licencia de conducir de Florida, el de la tarjeta de identificación de Florida o los últimos cuatro dígitos del Seguro Social, el que la oficina del Supervisor de Elecciones pueda verificar. El formulario en línea de Seminole pide lo mismo."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "requests-after-nov-3",
          claim: {
            en: "Under the state's rule, a mail-ballot request made after the Nov 3, 2026 general election should last through 2028. Seminole's Supervisor of Elections hasn't posted how it handles requests made Nov 4 to Dec 31, 2026, so check My Voter Record in January (or call 407-585-8683) to make sure yours shows.",
            es: "Según la regla estatal, una solicitud de boleta por correo hecha después de la elección general del 3 de noviembre de 2026 debería valer hasta 2028. La oficina del Supervisor de Elecciones de Seminole no ha publicado cómo maneja las solicitudes hechas entre el 4 de noviembre y el 31 de diciembre de 2026, así que revisa My Voter Record en enero (o llama al 407-585-8683) para confirmar que aparece la tuya."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "med"
        }
      ]
    },

    {
      id: "taller-votar-2027",
      demo: true,
      status: "scheduled",
      series: "workshop-es",
      kind: "learn",
      tone: "calm",
      title: { en: "Spanish-language voter workshop: what changed for 2027", es: "Taller en español: votar en 2027 sin sorpresas" },
      tagline: {
        en: "In Spanish, in plain words, with time for every question.",
        es: "En español, en palabras sencillas y con tiempo para todas tus preguntas."
      },
      description: {
        en: "An hour and a half, in Spanish, to catch up on what's new: renewing your mail-ballot request (requests made before Nov 3, 2026 ended Dec 31), which ID to bring now that Florida no longer takes student IDs at the polls, and what the new citizenship check means when you register or update your record. We use the official Spanish-language pages wherever they exist. No question is too basic, and families are welcome.",
        es: "Una hora y media para ponerte al día, en español: cómo renovar tu solicitud de boleta por correo (las hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre), qué identificación llevar ahora que Florida ya no acepta la de estudiante para votar y qué significa la nueva verificación de ciudadanía cuando te inscribes o actualizas tus datos. Usamos las páginas oficiales en español cuando existen. Aquí no hay preguntas tontas, y puedes venir con tu familia."
      },
      notice: {
        en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID, or passport, and check voteseminole.gov before you go.",
        es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir."
      },
      start: "2027-01-09T11:00:00-05:00",
      end: "2027-01-09T12:30:00-05:00",
      when: { en: "Sat, Jan 9, 11 am to 12:30 pm", es: "Sáb., 9 de ene., de 11 a. m. a 12:30 p. m." },
      afterDark: false,
      city: "casselberry",
      place: {
        kind: "generic",
        name: { en: "A community room in Casselberry (DEMO venue)", es: "Un salón comunitario en Casselberry (lugar DEMO)" },
        address: null,
        mapQuery: null,
        remote: false
      },
      vibes: ["en-espanol", "learn", "kids-welcome", "first-timers"],
      language: ["es"],
      interpretation: {
        en: "Runs in Spanish. English interpretation if you ask for it when you RSVP.",
        es: "Se da en español. Hay interpretación al inglés si la pides al confirmar."
      },
      bring: [
        { en: "Your questions", es: "Tus preguntas" },
        { en: "Your phone, to look up your own voter record", es: "Tu celular, para buscar tu propio registro de votante" },
        { en: "Reading glasses, if you use them", es: "Tus lentes para leer, si los usas" },
        { en: "Family, if they want to come", es: "Tu familia, si quiere venir" }
      ],
      accessibility: {
        en: "Large-print handouts. Room for strollers and wheelchairs (we'll confirm the venue). Coffee and something sweet.",
        es: "Materiales en letra grande. Espacio para coches de bebé y sillas de ruedas (lo confirmamos con el lugar). Café y algo dulce."
      },
      ages: { min: 14, label: { en: "14 and up (kids welcome with family)", es: "Desde 14 años (niños bienvenidos con su familia)" }, guardian: false },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "spanish-outreach" },
      capacity: 40,
      going: 22,
      cover: {
        query: "small friendly workshop group around a table with coffee, notebooks and a laptop",
        alt: { en: "A small group talking around a table with coffee and notebooks", es: "Un grupo pequeño conversando alrededor de una mesa con café y libretas" },
        token: "--sky",
        sticker: "calendar",
        short: { en: "Voter workshop", es: "Taller 2027" }
      },
      share: {
        title: { en: "Spanish-language voter workshop", es: "Taller en español: votar en 2027" },
        text: {
          en: "Free Spanish-language voter workshop Sat Jan 9, 11 am in Casselberry: mail ballots, the new ID rules and the new citizenship check, in plain words. Know someone who'd want this? {url}",
          es: "Taller gratis en español el sáb. 9 de enero, 11 a. m., en Casselberry: boleta por correo, las nuevas reglas de identificación y la verificación de ciudadanía, explicado sin enredos. ¿Conoces a alguien a quien le sirva? {url}"
        }
      },
      bringFriend: {
        en: "Bring a parent, a grandparent, a roommate: anyone who'd rather hear this in Spanish.",
        es: "Trae a tu mamá, a tu abuelo, a quien vive contigo: a cualquiera que prefiera escuchar esto en español."
      },
      calDescription: {
        en: "DEMO event. Spanish-language workshop on 2027 voting changes in Florida: mail-ballot renewal, ID at the polls, the citizenship check when you register or update your record. Free.",
        es: "Evento DEMO. Taller en español sobre los cambios de 2027 para votar en Florida: renovación de la solicitud de boleta por correo, identificación para votar y verificación de ciudadanía al inscribirte o actualizar tus datos. Gratis."
      },
      links: [
        { linkId: "voteByMail", key: "links.vote.voteByMail", url: "https://voteseminole.gov/how-to-vote/vote-by-mail/", label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" } },
        { linkId: "mailBallotFormPdf", key: null, url: "https://voteseminole.gov/wp-content/uploads/2025/09/ds-de-160-statewide-vote-by-mail-request-adoption-1.pdf", urlEs: "https://voteseminole.gov/wp-content/uploads/2026/03/ds-de-160-statewide-vote-by-mail-request-adoption-spanish_-04172024.pdf", label: { en: "Paper mail-ballot request form (PDF)", es: "Formulario en papel para pedir la boleta por correo (PDF)" } },
        { linkId: "countyRegister", key: "links.vote.countyRegister", url: "https://voteseminole.gov/voters/register-to-vote/", label: { en: "Seminole's register-to-vote page", es: "Página de inscripción del condado de Seminole" } },
        { linkId: null, key: "links.vote.countyElections", url: "https://voteseminole.gov/", label: { en: "Seminole County Supervisor of Elections", es: "Supervisor de Elecciones del condado de Seminole" } }
      ],
      xpActions: ["rsvp", "attend"],
      badgeIds: ["bridge-builder"],
      facts: [
        {
          id: "student-id-2027",
          claim: {
            en: "HB 991 (Ch. 2026-26), signed Apr 1, 2026, removes student IDs from Florida's list of accepted photo IDs at the polls starting Jan 1, 2027.",
            es: "La HB 991 (Cap. 2026-26), firmada el 1 de abril de 2026, saca la identificación de estudiante de la lista de identificaciones con foto aceptadas para votar en Florida desde el 1 de enero de 2027."
          },
          source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
          sources: ["https://flsenate.gov/Session/Bill/2026/991"],
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "student-id-lawsuit",
          claim: {
            en: "A federal lawsuit filed Oct 16, 2026 challenges the student-ID ban.",
            es: "Una demanda federal presentada el 16 de octubre de 2026 impugna la prohibición de la identificación de estudiante."
          },
          source: "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "citizenship-check-2027",
          claim: {
            en: "Starting Jan 1, 2027, HB 991 requires a check of DHSMV (driver license office) REAL ID data related to citizenship for new registrations and for voters updating their registration.",
            es: "Desde el 1 de enero de 2027, la HB 991 exige revisar los datos de REAL ID del DHSMV (la oficina de licencias de conducir) relacionados con la ciudadanía para las inscripciones nuevas y para quienes actualizan su inscripción."
          },
          source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "mail-requests-expire-2026",
          claim: {
            en: "Florida vote-by-mail requests made before the Nov 3, 2026 general election ended Dec 31, 2026.",
            es: "En Florida, las solicitudes de boleta por correo hechas antes de la elección general del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },

    {
      id: "new-member-mixer-2027",
      demo: true,
      status: "scheduled",
      series: "mixer",
      kind: "social",
      tone: "fun",
      title: { en: "New year, new faces: member mixer", es: "Año nuevo, caras nuevas: encuentro de miembros" },
      tagline: {
        en: "Meet the people, find your thing, ask anything. Pizza's on us (DEMO).",
        es: "Conoce a la gente, encuentra lo tuyo y pregunta lo que quieras. La pizza va por nuestra cuenta (DEMO)."
      },
      description: {
        en: "January is dues month, so this is our big hello. Meet the people who run things, try a few ways to plug in (events, issues, making videos, Spanish-language outreach), and ask whatever you want. Dues are $20 a year, paid in January. Can't pay because of money or citizenship status? Non-voting membership is there for you, and nobody asks for money at the door. There's a renewal table too: renew your mail-ballot request on your own phone, on the official site, with someone there to help.",
        es: "Enero es el mes de las cuotas, así que este es nuestro gran «hola». Conoce a quienes organizan, prueba distintas formas de participar (eventos, causas, videos, difusión en español) y pregunta lo que quieras. La cuota es de $20 al año y se paga en enero. ¿No puedes pagarla por razones económicas o de ciudadanía? La membresía sin voto es para ti, y nadie te va a pedir dinero en la puerta. También habrá una mesa de renovación: renueva tu solicitud de boleta por correo desde tu celular, en el sitio oficial, con alguien al lado para ayudarte."
      },
      start: "2027-01-13T19:00:00-05:00",
      end: "2027-01-13T21:00:00-05:00",
      when: { en: "Wed, Jan 13, 7 to 9 pm", es: "Miér., 13 de ene., de 7 a 9 p. m." },
      afterDark: true,
      city: "longwood",
      place: {
        kind: "generic",
        name: { en: "A pizza place near the Longwood SunRail station (DEMO venue)", es: "Una pizzería cerca de la estación de SunRail de Longwood (lugar DEMO)" },
        address: null,
        mapQuery: null,
        remote: false
      },
      vibes: ["social", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Yourself, as you are", es: "Tú, tal como eres" },
        { en: "A friend", es: "Alguien que te acompañe" },
        { en: "Your Florida license or ID number, if you want to renew your mail-ballot request at the table", es: "El número de tu licencia o identificación de Florida, si quieres renovar tu solicitud de boleta por correo en la mesa" }
      ],
      accessibility: {
        en: "Name tags with optional pronouns. A quieter table for smaller conversations. Vegetarian and gluten-free pizza (DEMO).",
        es: "Etiquetas con tu nombre y pronombres opcionales. Una mesa más tranquila para conversaciones pequeñas. Pizza vegetariana y sin gluten (DEMO)."
      },
      ages: { min: 14, label: { en: "14 to 39 for membership; everyone 14 and up can come", es: "De 14 a 39 años para ser miembro; puede venir cualquier persona de 14 en adelante" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "membership" },
      capacity: 70,
      going: 44,
      cover: {
        query: "group of young adults sharing pizza and laughing at a long table",
        alt: { en: "Friends sharing pizza at a long table", es: "Un grupo compartiendo pizza en una mesa larga" },
        token: "--violet",
        sticker: "heart",
        short: { en: "Member mixer", es: "Encuentro de miembros" }
      },
      share: {
        title: { en: "Young Dems new-member mixer", es: "Encuentro de miembros nuevos de los Young Dems" },
        text: {
          en: "Young Dems new-member mixer, Wed Jan 13, 7 pm in Longwood. Pizza, people and zero pressure. I'll go if you go. {url}",
          es: "Encuentro de miembros nuevos de los Young Dems, miér. 13 de enero, 7 p. m., en Longwood. Pizza, gente buena y cero presión. Voy si tú vas. {url}"
        }
      },
      bringFriend: {
        en: "Bring the friend who keeps saying they should \"get more involved.\" This is the easiest version.",
        es: "Trae a esa persona que siempre dice que quiere «involucrarse más». Esta es la forma más fácil."
      },
      calDescription: {
        en: "DEMO event. Young Dems new-member mixer: meet people, find a way to plug in, renew your mail-ballot request at the table. Free, alcohol-free.",
        es: "Evento DEMO. Encuentro de miembros nuevos de los Young Dems: conoce gente, encuentra cómo participar y renueva tu solicitud de boleta por correo en la mesa. Gratis, sin alcohol."
      },
      links: [
        { linkId: null, key: "links.dues", url: "https://secure.actblue.com/donate/ydscdues", label: { en: "Membership and dues", es: "Membresía y cuotas" } },
        { linkId: "voteByMail", key: "links.vote.voteByMail", url: "https://voteseminole.gov/how-to-vote/vote-by-mail/", label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" } }
      ],
      xpActions: ["rsvp", "attend"], // civic steps earn nothing (00, BRIEF 5.5)
      badgeIds: ["card-carrier"],
      facts: [
        {
          id: "dues-20-january",
          claim: {
            en: "YDSC membership dues are $20 a year, paid during January unless a member joins later in the year.",
            es: "La cuota de membresía de YDSC es de $20 al año y se paga en enero, salvo que la persona se una más tarde en el año."
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
          id: "member-ages",
          claim: {
            en: "Membership is open to people at least 14 and under 40.",
            es: "La membresía está abierta a personas de al menos 14 años y menores de 40."
          },
          source: "https://secure.actblue.com/donate/ydscdues",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },

    {
      id: "sunrail-social-lake-mary",
      demo: true,
      status: "scheduled",
      series: "sunrail",
      kind: "social",
      tone: "fun",
      title: { en: "SunRail social: ride in, meet up, tacos", es: "Encuentro SunRail: llega en tren, conoce gente y tacos" },
      tagline: {
        en: "Meet on the Lake Mary platform after work, then walk to tacos and talk about getting around Seminole.",
        es: "Nos vemos en el andén de Lake Mary al salir del trabajo y caminamos a comer tacos mientras hablamos de cómo moverse por Seminole."
      },
      description: {
        en: "Ride in from Sanford, Longwood, Altamonte Springs or farther, or just drive to the station. We meet on the Lake Mary platform, then walk to a taco spot nearby to talk about buses, trains, sidewalks and what it would take to get around here without a car. SunRail runs weekdays only, so this one's on a Thursday. Check sunrail.com for your train in and your last train home.",
        es: "Llega en tren desde Sanford, Longwood, Altamonte Springs o más lejos, o maneja hasta la estación. Nos encontramos en el andén de Lake Mary y caminamos a una taquería cercana para hablar de autobuses, trenes, aceras y de lo que haría falta para moverse por aquí sin carro. SunRail solo funciona de lunes a viernes, por eso este encuentro es un jueves. Revisa en sunrail.com tu tren de ida y el último de regreso."
      },
      start: "2027-01-21T17:30:00-05:00",
      end: "2027-01-21T19:30:00-05:00",
      when: { en: "Thu, Jan 21, 5:30 to 7:30 pm", es: "Jue., 21 de ene., de 5:30 a 7:30 p. m." },
      afterDark: true,
      city: "lake-mary",
      place: {
        kind: "public",
        name: { en: "Lake Mary SunRail station", es: "Estación de SunRail de Lake Mary" },
        address: "2200 W. Lake Mary Blvd., Lake Mary, FL 32746",
        mapQuery: "Lake Mary SunRail station, 2200 W Lake Mary Blvd, Lake Mary, FL 32746",
        directions: {
          en: "Meet on the platform. Look for the celery-green tote bags (DEMO).",
          es: "Nos vemos en el andén. Busca las bolsas verde apio (DEMO)."
        },
        then: { en: "Then a taco spot within walking distance (DEMO venue)", es: "Después, una taquería a la que se llega caminando (lugar DEMO)" },
        remote: false,
        source: "https://sunrail.com/stations/",
        verified: "2026-11-09"
      },
      vibes: ["by-train", "social", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Train fare (current prices are on sunrail.com)", es: "Para el pasaje del tren (los precios actuales están en sunrail.com)" },
        { en: "Comfy shoes", es: "Zapatos cómodos" },
        { en: "Your best transit complaint", es: "Tu mejor queja sobre el transporte público" }
      ],
      accessibility: {
        en: "The walk to tacos is short and flat. Need a hand getting there, or a ride back to your car? Tell us when you RSVP and we'll sort it out. Under 18? Any ride needs your guardian's written OK, and you're never alone in a car with one adult.",
        es: "La caminata a los tacos es corta y plana. ¿Necesitas ayuda para llegar o que alguien te lleve de vuelta a tu carro? Avísanos al confirmar y lo resolvemos. ¿Tienes menos de 18 años? Cualquier aventón necesita el permiso por escrito de tu tutor, y nunca vas a estar a solas en un carro con una sola persona adulta."
      },
      ages: { min: 14, label: { en: "14 and up", es: "Desde 14 años" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free (food and train fare on your own)", es: "Gratis (la comida y el pasaje corren por tu cuenta)" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "organizing" },
      capacity: 30,
      going: 19,
      cover: {
        query: "commuter train platform at dusk with people waiting, Florida",
        alt: { en: "People waiting on a train platform at dusk", es: "Gente esperando en el andén de un tren al atardecer" },
        token: "--sky",
        sticker: "train",
        short: { en: "SunRail social", es: "Encuentro SunRail" },
        photo: {
          id: "1676304437086-ad9db3b3df66",
          photographer: "Komorebi Photo",
          photographerHandle: "komophoto",
          page: "https://unsplash.com/photos/cs18eMhnmxI",
          width: 640,
          height: 427,
          alt: {
            en: "Railroad tracks running toward an orange sunset between trees and palms",
            es: "Vías de tren que se pierden hacia un atardecer naranja entre árboles y palmeras"
          },
          verified: "2026-11-09"
        }
      },
      share: {
        title: { en: "SunRail social", es: "Encuentro SunRail" },
        text: {
          en: "SunRail social Thu Jan 21, 5:30 pm: meet on the Lake Mary platform, then tacos and a real talk about getting around Seminole. Ride with me? {url}",
          es: "Encuentro SunRail el jue. 21 de enero, 5:30 p. m.: nos vemos en el andén de Lake Mary y luego tacos y una buena conversación sobre cómo moverse por Seminole. ¿Te vienes en el tren conmigo? {url}"
        }
      },
      bringFriend: {
        en: "Bring your commute buddy, or the friend who's never once been on SunRail. Tonight's the night.",
        es: "Trae a quien viaja contigo al trabajo, o a esa persona que nunca se ha subido a SunRail. Hoy es el día."
      },
      calDescription: {
        en: "DEMO event. Meet on the Lake Mary SunRail platform (2200 W. Lake Mary Blvd.), then walk to tacos and talk transit. Free; food and fare on your own.",
        es: "Evento DEMO. Nos vemos en el andén de SunRail de Lake Mary (2200 W. Lake Mary Blvd.) y caminamos a comer tacos y hablar de transporte. Gratis; comida y pasaje por tu cuenta."
      },
      links: [
        { linkId: null, key: null, url: "https://sunrail.com/stations/", label: { en: "SunRail stations and schedules", es: "Estaciones y horarios de SunRail" } }
      ],
      xpActions: ["rsvp", "attend"],
      badgeIds: ["on-the-platform"],
      facts: [
        {
          id: "sunrail-weekdays-only",
          claim: {
            en: "SunRail currently runs Monday to Friday only, every 30 minutes at peak and every 2 to 2.5 hours off-peak.",
            es: "Por ahora SunRail funciona solo de lunes a viernes, cada 30 minutos en horas pico y cada 2 a 2.5 horas fuera de ellas."
          },
          source: "https://sunrail.com/help-center/support/maps-schedules/how-often-does-sunrail-run/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "lake-mary-station-address",
          claim: {
            en: "The Lake Mary SunRail station is at 2200 W. Lake Mary Blvd., Lake Mary, FL 32746.",
            es: "La estación de SunRail de Lake Mary está en 2200 W. Lake Mary Blvd., Lake Mary, FL 32746."
          },
          source: "https://sunrail.com/stations/",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "sunrail-four-stations",
          claim: {
            en: "Four SunRail stations are in Seminole County: Altamonte Springs, Longwood, Lake Mary and Sanford.",
            es: "Cuatro estaciones de SunRail están en el condado de Seminole: Altamonte Springs, Longwood, Lake Mary y Sanford."
          },
          source: "https://sunrail.com/stations/",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },

    {
      id: "oviedo-2027-neighbor-shift",
      demo: true,
      status: "scheduled",
      series: "canvass",
      kind: "volunteer",
      tone: "fun",
      title: { en: "Oviedo votes Nov 2: neighbor check-in shift", es: "Oviedo vota el 2 de noviembre: turno de visitas a los vecinos" },
      tagline: {
        en: "Knock doors in pairs, help neighbors get their mail ballots sorted, and get to know your city's 2027 election.",
        es: "Toca puertas en pareja, ayuda a tus vecinos con su boleta por correo y conoce la elección municipal de 2027."
      },
      description: {
        en: "Oviedo's next city election, for mayor and one city council seat, is Tue, Nov 2, 2027. Today we knock doors in pairs with two simple asks: did you know mail-ballot requests from before Nov 3, 2026 ended Dec 31, and is your registration up to date? Neighbors take care of it themselves on the official site; we bring the heads-up and a QR code. City races are open to every voter in the city, whatever their party, so this shift is about voting, not about a candidate. Short training at the start, a buddy for everyone, done by lunch.",
        es: "Las próximas elecciones municipales de Oviedo, para la alcaldía y un puesto del concejo, son el martes 2 de noviembre de 2027. Hoy tocamos puertas en parejas con dos preguntas sencillas: ¿sabías que las solicitudes de boleta por correo hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre? ¿Tu inscripción está al día? Cada vecino lo resuelve por su cuenta en el sitio oficial; nosotros llevamos el aviso y un código QR. En las elecciones municipales vota todo el que esté inscrito en la ciudad, sin importar su partido, así que este turno es para animar a votar, no para hacer campaña por nadie. Entrenamiento corto al inicio, una pareja para cada quien y terminamos a la hora del almuerzo."
      },
      extraNote: {
        en: "We don't collect signatures, forms or anyone's personal information. Under 18? You'll need a guardian's OK for door-knocking. Teens knock in pairs with an adult lead in sight, in daylight, and nobody goes inside anyone's home.",
        es: "No recogemos firmas, formularios ni datos personales de nadie. ¿Tienes menos de 18 años? Para tocar puertas necesitas el permiso de tu tutor. Los adolescentes van en parejas con una persona adulta a la vista, de día, y nadie entra a la casa de nadie."
      },
      start: "2027-01-30T09:30:00-05:00",
      end: "2027-01-30T12:30:00-05:00",
      when: { en: "Sat, Jan 30, 9:30 am to 12:30 pm", es: "Sáb., 30 de ene., de 9:30 a. m. a 12:30 p. m." },
      afterDark: false,
      city: "oviedo",
      place: {
        kind: "public",
        name: { en: "Center Lake Park", es: "Center Lake Park" },
        address: "299 Center Lake Lane, Oviedo, FL 32765",
        mapQuery: "Center Lake Park, 299 Center Lake Lane, Oviedo, FL 32765",
        directions: {
          en: "Meet near the playground. Look for the celery-green clipboards (DEMO).",
          es: "Nos vemos cerca del área de juegos. Busca las tablillas verde apio (DEMO)."
        },
        remote: false,
        source: "https://cityofoviedo.net/1230/Parks-and-Facilities",
        verified: "2026-11-09"
      },
      vibes: ["volunteer", "outdoors", "hands-on", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Water", es: "Agua" },
        { en: "Sunscreen and a hat", es: "Protector solar y gorra" },
        { en: "Shoes for walking", es: "Zapatos para caminar" },
        { en: "A charged phone", es: "El celular con batería" }
      ],
      accessibility: {
        en: "Not up for walking? Run the check-in table in the park, or text neighbors from a bench. Every role counts as a shift.",
        es: "¿No tienes ganas de caminar? Atiende la mesa de registro en el parque o mándales mensajes a los vecinos desde una banca. Cualquier tarea cuenta como turno."
      },
      ages: { min: 14, label: { en: "14 and up (under 18: guardian's OK, and teens knock with an adult lead)", es: "Desde 14 años (menores de 18: con permiso del tutor y acompañados por una persona adulta)" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "organizing" },
      capacity: 30,
      going: 16,
      cover: {
        query: "two volunteers with clipboards walking a sunny suburban sidewalk",
        alt: { en: "Two volunteers with clipboards on a sunny sidewalk", es: "Dos voluntarios con tablillas en una acera soleada" },
        token: "--celery",
        sticker: "chicken",
        short: { en: "Neighbor shift", es: "Turno de vecinos" },
        photo: {
          id: "1555636222-cae831e670b3",
          photographer: "FilterGrade",
          photographerHandle: "filtergrade",
          page: "https://unsplash.com/photos/suburban-street-with-houses-and-palms-4T4AcGJvARQ",
          width: 640,
          height: 424,
          alt: {
            en: "A sunny suburban street lined with palm trees and tile-roof houses",
            es: "Una calle soleada de casas con techos de teja y palmeras"
          },
          verified: "2026-11-09"
        }
      },
      share: {
        title: { en: "Oviedo neighbor check-in shift", es: "Turno de visitas a vecinos en Oviedo" },
        text: {
          en: "Oviedo votes Nov 2, 2027. Sat Jan 30, 9:30 am, I'm knocking doors to help neighbors renew their mail-ballot requests. Be my door buddy? {url}",
          es: "Oviedo vota el 2 de noviembre de 2027. El sáb. 30 de enero, 9:30 a. m., voy a tocar puertas para ayudar a los vecinos a renovar su solicitud de boleta por correo. ¿Me acompañas? {url}"
        }
      },
      bringFriend: {
        en: "Everyone knocks in pairs, so bring your pair.",
        es: "Aquí todo el mundo va en pareja, así que trae a la tuya."
      },
      calDescription: {
        en: "DEMO event. Door-knocking in pairs in Oviedo ahead of the Nov 2, 2027 city election: mail-ballot renewal and registration check-ins. Meet at Center Lake Park, 299 Center Lake Lane. Free. Under 18: guardian's OK needed.",
        es: "Evento DEMO. Visitas en pareja en Oviedo antes de la elección municipal del 2 de noviembre de 2027: renovación de la solicitud de boleta por correo y revisión de la inscripción. Nos vemos en Center Lake Park, 299 Center Lake Lane. Gratis. Menores de 18: con permiso del tutor."
      },
      links: [
        { linkId: "oviedoElections", key: null, url: "https://cityofoviedo.net/724/Elections", label: { en: "City of Oviedo elections", es: "Elecciones de la Ciudad de Oviedo" } },
        { linkId: "voteByMail", key: "links.vote.voteByMail", url: "https://voteseminole.gov/how-to-vote/vote-by-mail/", label: { en: "Seminole's vote-by-mail page", es: "Página de voto por correo de Seminole" } }
      ],
      xpActions: ["rsvp", "attend", "volunteer-shift"],
      badgeIds: ["shift-done"],
      facts: [
        {
          id: "oviedo-election-rule",
          claim: {
            en: "Oviedo holds regular city elections on the first Tuesday after the first Monday in November every year; terms are two years, and the seats up in 2027 are Mayor and Council Member Group 1.",
            es: "Oviedo celebra elecciones municipales ordinarias el primer martes después del primer lunes de noviembre de cada año; los periodos son de dos años, y en 2027 se eligen la alcaldía y el puesto del Grupo 1 del concejo."
          },
          source: "https://cityofoviedo.net/724/Elections",
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "oviedo-nov-2-2027",
          claim: {
            en: "That rule puts Oviedo's 2027 election on Tue, Nov 2, 2027.",
            es: "Con esa regla, la elección de Oviedo de 2027 cae el martes 2 de noviembre de 2027."
          },
          source: "https://cityofoviedo.net/724/Elections",
          verified: "2026-11-09",
          confidence: "high",
          computed: "First Tuesday after the first Monday (Nov 1, 2027). The city page does not print the 2027 date yet."
        },
        {
          id: "city-races-open",
          claim: {
            en: "Seminole's city elections are nonpartisan. In cities that elect at large, like Oviedo, all voters registered within the city limits can vote in each contest.",
            es: "Las elecciones municipales de Seminole no son partidistas. En las ciudades que eligen a todos sus puestos por voto general, como Oviedo, todos los votantes inscritos dentro de los límites de la ciudad pueden votar en cada contienda."
          },
          source: "https://voteseminole.gov/faqs/",
          sources: ["https://voteseminole.gov/wp-content/uploads/2026/04/UPDATED2026-Election-Facts.pdf"],
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "mail-requests-expire-2026",
          claim: {
            en: "Florida vote-by-mail requests made before the Nov 3, 2026 general election ended Dec 31, 2026.",
            es: "En Florida, las solicitudes de boleta por correo hechas antes de la elección general del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },

    {
      id: "karaoke-love-and-protest",
      demo: true,
      status: "scheduled",
      series: "karaoke",
      kind: "social",
      tone: "fun",
      title: { en: "Love songs and protest songs: karaoke night", es: "Canciones de amor y de protesta: noche de karaoke" },
      tagline: {
        en: "Valentine's weekend starts here. Duets encouraged, talent optional.",
        es: "El fin de semana de San Valentín empieza aquí. Los duetos se aplauden; el talento es opcional."
      },
      description: {
        en: "Sing a love song, a protest song, or, if you dare, a love song about Seminole County. Songs in Spanish very welcome. We keep the list moving so everyone who wants a turn gets one, and nobody has to sing to come hang out.",
        es: "Canta una canción de amor, una de protesta o, si te atreves, una canción de amor al condado de Seminole. Las canciones en español son más que bienvenidas. Mantenemos la lista en movimiento para que todos los que quieran cantar tengan su turno, y nadie tiene que cantar para venir a pasarla bien."
      },
      start: "2027-02-12T19:00:00-05:00",
      end: "2027-02-12T21:30:00-05:00",
      when: { en: "Fri, Feb 12, 7 to 9:30 pm", es: "Vie., 12 de feb., de 7 a 9:30 p. m." },
      afterDark: true,
      city: "sanford",
      place: {
        kind: "generic",
        name: { en: "A karaoke room in downtown Sanford (DEMO venue)", es: "Un salón de karaoke en el centro de Sanford (lugar DEMO)" },
        address: null,
        mapQuery: null,
        remote: false
      },
      vibes: ["music", "social", "first-timers"],
      language: ["en", "es"],
      bring: [
        { en: "Your go-to song, and a backup", es: "Tu canción favorita y una de repuesto" },
        { en: "A duet partner", es: "Alguien para cantar a dúo" },
        { en: "Earplugs, if you like it quieter", es: "Tapones para los oídos, si prefieres menos ruido" }
      ],
      accessibility: {
        en: "Lyrics on a big screen. A quieter corner away from the speakers. Sign up for a song on paper or by text.",
        es: "La letra sale en una pantalla grande. Hay un rincón más tranquilo lejos de los altavoces. Te anotas para cantar en papel o por mensaje."
      },
      ages: { min: 14, label: { en: "14 and up", es: "Desde 14 años" }, guardian: true },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "membership" },
      capacity: 40,
      going: 27,
      cover: {
        query: "friends singing karaoke together under colorful lights",
        alt: { en: "Two friends singing into microphones under colorful lights", es: "Dos amigos cantando con micrófonos bajo luces de colores" },
        token: "--bubblegum",
        sticker: "sun",
        short: { en: "Karaoke night", es: "Noche de karaoke" }
      },
      share: {
        title: { en: "Karaoke night", es: "Noche de karaoke" },
        text: {
          en: "Karaoke night Fri Feb 12, 7 pm in downtown Sanford: love songs and protest songs. I already picked our duet. {url}",
          es: "Noche de karaoke el vie. 12 de febrero, 7 p. m., en el centro de Sanford: canciones de amor y de protesta. Ya escogí nuestro dueto. {url}"
        }
      },
      bringFriend: {
        en: "Bring your duet partner. Don't have one yet? You will by 9 pm.",
        es: "Trae a tu pareja de dueto. ¿Todavía no tienes? A las 9 p. m. ya vas a tener."
      },
      calDescription: {
        en: "DEMO event. Karaoke night in downtown Sanford: love songs, protest songs, songs in Spanish. Free, 14 and up, alcohol-free.",
        es: "Evento DEMO. Noche de karaoke en el centro de Sanford: canciones de amor, de protesta y en español. Gratis, desde 14 años, sin alcohol."
      },
      links: [],
      xpActions: ["rsvp", "attend"],
      badgeIds: ["mic-check"],
      facts: []
    },

    {
      id: "big-tree-long-game-picnic",
      demo: true,
      status: "scheduled",
      series: "picnic",
      kind: "create",
      tone: "fun",
      title: { en: "The long game: picnic at Big Tree Park", es: "Pensar a largo plazo: picnic en Big Tree Park" },
      tagline: {
        en: "Snacks, sticker design and some very old trees. A good place to plan 2027.",
        es: "Algo para picar, diseño de stickers y unos árboles muy, muy viejos. Buen lugar para planear 2027."
      },
      description: {
        en: "Big Tree Park is where The Senator, a bald cypress about 3,500 years old, stood until it burned in 2012. A clone called The Phoenix grows there now, and Lady Liberty, about 2,000 years old, still stands nearby. It's a good place to talk about the long game. Bring a blanket. We'll bring snacks, markers and blank sticker sheets so you can design a sticker for our 2027 season, and members vote on the winner (DEMO).",
        es: "En Big Tree Park estuvo The Senator, un ciprés calvo de unos 3,500 años, hasta que se quemó en 2012. Hoy crece ahí un clon llamado The Phoenix, y cerca sigue en pie Lady Liberty, de unos 2,000 años. Es buen lugar para hablar de lo que se construye a largo plazo. Trae una manta; nosotros llevamos algo para picar, marcadores y hojas de stickers en blanco para que diseñes un sticker para nuestra temporada 2027, y los miembros votan por el ganador (DEMO)."
      },
      start: "2027-02-20T10:00:00-05:00",
      end: "2027-02-20T12:00:00-05:00",
      when: { en: "Sat, Feb 20, 10 am to noon", es: "Sáb., 20 de feb., de 10 a. m. a 12 del mediodía" },
      afterDark: false,
      city: "longwood",
      place: {
        kind: "public",
        name: { en: "Big Tree Park", es: "Big Tree Park" },
        address: "761 General Hutchison Pkwy., Longwood, FL 32750",
        mapQuery: "Big Tree Park, 761 General Hutchison Parkway, Longwood, FL 32750",
        directions: {
          en: "We'll set up close to the parking area so it's a short walk. Look for the celery-green blanket (DEMO).",
          es: "Nos ponemos cerca del estacionamiento para que la caminata sea corta. Busca la manta verde apio (DEMO)."
        },
        remote: false,
        source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
        verified: "2026-11-09",
        note: "County page lists hours as daily, 8 am to dusk."
      },
      vibes: ["outdoors", "create", "kids-welcome", "chill"],
      language: ["en", "es"],
      bring: [
        { en: "A blanket", es: "Una manta" },
        { en: "Water", es: "Agua" },
        { en: "Sunscreen", es: "Protector solar" },
        { en: "Your doodling hand", es: "Tus ganas de dibujar" }
      ],
      accessibility: {
        en: "Short walk from parking. Need a chair? Tell us when you RSVP and we'll bring one.",
        es: "Caminata corta desde el estacionamiento. ¿Necesitas una silla? Avísanos al confirmar y te llevamos una."
      },
      ages: { min: 14, label: { en: "14 and up (kids welcome with a grown-up)", es: "Desde 14 años (niños bienvenidos con una persona adulta)" }, guardian: false },
      alcoholFree: true,
      cost: { amount: 0, label: { en: "Free", es: "Gratis" } },
      host: { label: { en: "DEMO host", es: "Equipo anfitrión (DEMO)" }, team: "communications" },
      capacity: 50,
      going: 29,
      cover: {
        query: "towering bald cypress trees and a wooden boardwalk in a Florida forest",
        alt: { en: "Tall cypress trees beside a wooden boardwalk", es: "Cipreses altos junto a un sendero de madera" },
        token: "--celery",
        sticker: "cypress",
        short: { en: "Big Tree picnic", es: "Picnic en Big Tree" }
      },
      share: {
        title: { en: "Picnic at Big Tree Park", es: "Picnic en Big Tree Park" },
        text: {
          en: "Picnic at Big Tree Park in Longwood, Sat Feb 20, 10 am: snacks, sticker design and the story of a 3,500-year-old cypress. Come plan 2027 with me? {url}",
          es: "Picnic en Big Tree Park, Longwood, el sáb. 20 de febrero, 10 a. m.: algo para picar, diseño de stickers y la historia de un ciprés de 3,500 años. ¿Planeamos 2027 juntos? {url}"
        }
      },
      bringFriend: {
        en: "Bring the friend who draws on everything. We need their sticker.",
        es: "Trae a esa persona que dibuja en todo. Necesitamos su sticker."
      },
      calDescription: {
        en: "DEMO event. Picnic and sticker design at Big Tree Park, 761 General Hutchison Pkwy., Longwood. Free, kids welcome.",
        es: "Evento DEMO. Picnic y diseño de stickers en Big Tree Park, 761 General Hutchison Pkwy., Longwood. Gratis, niños bienvenidos."
      },
      links: [],
      xpActions: ["rsvp", "attend"],
      badgeIds: [],
      facts: [
        {
          id: "senator-phoenix",
          claim: {
            en: "The Senator, an approximately 3,500-year-old bald cypress in Longwood's Big Tree Park, was lost to fire in January 2012. A clone of The Senator named The Phoenix was planted near the park's playground.",
            es: "The Senator, un ciprés calvo de unos 3,500 años en Big Tree Park de Longwood, se perdió en un incendio en enero de 2012. Cerca del área de juegos del parque se plantó un clon de The Senator llamado The Phoenix."
          },
          source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
          sources: ["https://en.wikipedia.org/wiki/The_Senator_(tree)"],
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "senator-dates",
          claim: {
            en: "The fire was reported on Jan 16, 2012, and Big Tree Park reopened on Mar 2, 2014 after almost a year closed for renovation.",
            es: "El incendio se reportó el 16 de enero de 2012, y Big Tree Park reabrió el 2 de marzo de 2014 tras casi un año cerrado por renovación."
          },
          source: "https://en.wikipedia.org/wiki/The_Senator_(tree)",
          verified: "2026-11-09",
          confidence: "med"
        },
        {
          id: "lady-liberty",
          claim: {
            en: "Lady Liberty, The Senator's sister tree, is an approximately 2,000-year-old bald cypress that still stands in Big Tree Park.",
            es: "Lady Liberty, el árbol hermano de The Senator, es un ciprés calvo de unos 2,000 años que sigue en pie en Big Tree Park."
          },
          source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
          sources: ["https://en.wikipedia.org/wiki/The_Senator_(tree)"],
          verified: "2026-11-09",
          confidence: "high"
        },
        {
          id: "big-tree-address",
          claim: {
            en: "Big Tree Park is at 761 General Hutchison Parkway, Longwood (Seminole County parks page).",
            es: "Big Tree Park está en 761 General Hutchison Parkway, Longwood (página de parques del condado de Seminole)."
          },
          source: "https://www.seminolecountyfl.gov/locations/big-tree-park.stml",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    }
  ]
};
