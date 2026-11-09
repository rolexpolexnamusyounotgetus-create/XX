/*!
 * data/levels.js: the sticker book and weekly streak for the YDSC site, EN + ES.   window.YSD_DATA.levels
 *
 * Re-skinned Nov 9, 2026 (BRIEF 5.5, 10.3 W5). The old organizer levels, XP and badges are gone:
 * there are no points, no level names and no HUD. What is left:
 *   - a STICKER BOOK: each ORGANIZING action (joining, a first RSVP, showing up, bringing a friend,
 *     a clip, a volunteer shift, making a card, finishing a quiz) collects one county sticker, shown on
 *     the member card with the date it was collected;
 *   - CIVIC STEPS (the January mail-ballot reminder, renewing, a voting plan, checking your
 *     registration) are listed in actions[] with kind 'civic' and collectible: false. They earn
 *     nothing, ever: they get a private check on the vote hub only (52 U.S.C. 10307(c);
 *     docs/research/00). Nothing in this file is a reward with value;
 *   - a WEEKLY STREAK counted in "active weeks" (any organizing action, Monday to Sunday, New York
 *     time), with rest weeks and grace weeks, and no guilt copy (streaks.never[]).
 *
 * DEMO MODE (demo:true). Everything is stored only in the visitor's browser; event check-ins are
 * simulated ("I was there (DEMO)"); the one physical perk is an example the chapter hasn't approved
 * and always shows labels.perkDemo. Simulated squad members never count toward anything.
 *
 * Load: classic script, after assets/js/config.js. No modules, no fetches. assets/js/membercard.js
 * reads it (or the sticker-book part of data/slices/growth.js). Node check:
 *   node -e "global.window={};require('./data/levels.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * TOP LEVEL (window.YSD_DATA.levels)
 *   version, demo, verified, timezone, note{}, labels{}, demoMode{}, rules[], storage{},
 *   actions[] (ACTION), stickers[] (STICKER), streaks{}, copy{}, demoProfile{}, basis[]
 *
 * ACTION   { id, kind ('organizing' | 'civic'), collectible (false for every civic step), label{},
 *            how{}, limit{ count, per }, verify, hook, available?{ from, until }, demoHow{}, facts[]? }
 *   verify   'automatic' (the site sees it happen) | 'check-in' (QR or code at the event; simulated
 *            in demo) | 'moderator' (a person approves it) | 'self-report' (honor system)
 *   Ids are stable: data/events.js xpActions[] lists the action ids an event can log (the field name
 *   is historical; nothing awards points).
 *
 * STICKER  { id, art (a data/stickers.js item id), ring (colour token), name{}, desc{}, unlock{},
 *            rule{}, perk?{} (DEMO example, organizing only), share{ text{} } }
 *   rule.type:
 *     'count'            { action, min }          logged organizing actions of that kind
 *     'attend-series'    { series, min }          attended events whose events.js series matches
 *     'attend-language'  { lang, min }            attended events that run in that language ONLY
 *     'attend-distinct'  { field: 'city', min }   attended events in N distinct events.js cities
 *     'active-weeks'     { min }                  total active weeks, any order
 *   share.text ends with {url} (YSD.fill fills {link} and {url}). Stickers are the only collectibles;
 *   data/events.js badgeIds[] refer to these ids.
 *
 * STREAKS  streaks{ unit, weekStartsOn, timezone, rules{}, graceWeeks, fadeAfterQuietWeeks,
 *   restWeeks[{ weekOf (Monday, 'YYYY-MM-DD' local), name{} }], show{}, reminders{}, milestones[],
 *   never[] }. A streak counts consecutive active weeks; up to graceWeeks quiet weeks in a row don't
 *   break it (they just don't add to it) and rest weeks are skipped entirely.
 * DEMO PROFILE  demoProfile{ demo, note, name{}, city, stickers[], activeWeeks } (screenshots only)
 * BASIS    basis[] { id, claim{}, source, sources?[], verified, confidence, via } (research behind the
 *   design; editors only, never render)
 *
 * Mail-ballot wording follows data/civic.js and docs/research/00: requests made before the Nov 3,
 * 2026 election end Dec 31, 2026; one made after Nov 3 should run through 2028 (check My Voter
 * Record); Spanish "solicitud de boleta por correo".
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.levels = {
  version: 2,
  demo: true,
  verified: "2026-11-09",
  timezone: "America/New_York",

  note: {
    en: "Your sticker book: every organizing thing you do adds one county sticker. Nothing to lose, nothing to buy.",
    es: "Tu álbum de stickers: cada cosa que haces para organizar suma un sticker del condado. No hay nada que perder ni nada que comprar."
  },

  labels: {
    heading: { en: "Your sticker book", es: "Tu álbum de stickers" },
    demo: { en: "DEMO", es: "DEMO" },
    collected: { en: "{n} of {total} stickers", es: "{n} de {total} stickers" },
    got: { en: "Got it {date}", es: "Lo tienes desde el {date}" },
    locked: { en: "Not yet", es: "Todavía no" },
    howTo: { en: "How to get it", es: "Cómo conseguirlo" },
    honorSystem: { en: "Honor system", es: "Confiamos en tu palabra" },
    iWasThere: { en: "I was there (DEMO)", es: "Estuve ahí (DEMO)" },
    shareSticker: { en: "Share this sticker", es: "Compartir este sticker" },
    resetDemo: { en: "Reset DEMO stickers", es: "Reiniciar los stickers DEMO" },
    perkDemo: { en: "Example perk (DEMO)", es: "Beneficio de ejemplo (DEMO)" },
    civicNote: {
      en: "Voting steps never earn stickers or anything else. They get a private check on the voting page, just for you.",
      es: "Los pasos para votar nunca dan stickers ni nada más. Tienen una marca privada en la página de votación, solo para ti."
    },
    activeWeeks: { en: "Active weeks", es: "Semanas activas" },
    streak: { en: "In a row", es: "Seguidas" }
  },

  demoMode: {
    title: { en: "How this works in the demo", es: "Cómo funciona en la demo" },
    points: [
      {
        en: "Everything here lives only in this browser while the site is in demo mode. Nothing is sent anywhere.",
        es: "Mientras el sitio está en modo demo, todo esto se guarda solo en este navegador. No se envía nada a ningún lado."
      },
      {
        en: "Event check-ins are simulated: after an event starts, its page shows an \"I was there (DEMO)\" button. On the real site, check-in is a QR code at the door.",
        es: "Los registros de asistencia son simulados: cuando empieza un evento, su página muestra un botón «Estuve ahí (DEMO)». En el sitio real, te registras con un código QR en la entrada."
      },
      {
        en: "Only friends who join with your link on this device count in the demo. Nobody is simulated.",
        es: "En la demo solo cuentan las personas que se unen con tu enlace en este dispositivo. No hay personas simuladas."
      },
      {
        en: "Perks are examples. The chapter hasn't approved them yet.",
        es: "Los beneficios son ejemplos. El grupo todavía no los ha aprobado."
      },
      {
        en: "You can reset your DEMO stickers anytime.",
        es: "Puedes reiniciar tus stickers DEMO cuando quieras."
      }
    ]
  },

  rules: [
    { en: "Stickers come from organizing: showing up, bringing friends, making things. They never buy anything and never turn into money.", es: "Los stickers salen de organizar: llegar, traer gente, crear cosas. Nunca compran nada ni se convierten en dinero." },
    { en: "Voting steps never earn stickers. Registering, renewing a mail-ballot request and voting are yours, and they stay private.", es: "Los pasos para votar nunca dan stickers. Inscribirte, renovar tu solicitud de boleta por correo y votar son cosa tuya, y quedan en privado." },
    { en: "Stickers and your total active weeks never go down.", es: "Los stickers y tu total de semanas activas nunca bajan." },
    { en: "No public ranking of people. Your sticker book is yours to share or not.", es: "No hay una clasificación pública de personas. Tu álbum es tuyo: lo compartes si quieres." },
    { en: "Self-reported actions run on the honor system. We never ask for voter information, ID numbers or screenshots.", es: "Las acciones que reportas tú funcionan con base en la confianza. Nunca pedimos datos de votante, números de identificación ni capturas de pantalla." },
    { en: "Share cards show your first name only, with no photo, unless you choose otherwise.", es: "Las tarjetas para compartir muestran solo tu nombre de pila, sin foto, a menos que tú decidas otra cosa." }
  ],

  storage: {
    note: "YSD.store keys (BRIEF 7.6). The sticker list is the source of truth; each sticker is collected once. The streak keeps the Monday (New York) of every week with an organizing action.",
    keys: { stickers: "stickers", streak: "streak", log: "stickers:log" },
    stickerEntry: "{ id, action, ref?, ts }",
    streakEntry: "{ weeks: ['2026-11-09', ...] }",
    logEntry: "{ action, ref?, series?, city?, lang?, ts } (organizing actions only, so series and city stickers can be worked out; civic steps are never logged here)"
  },

  actions: [
    {
      id: "join",
      kind: "organizing",
      collectible: true,
      label: { en: "Join", es: "Unirte" },
      how: { en: "Join the Young Dems list.", es: "Únete a la lista de los Young Dems." },
      limit: { count: 1, per: "lifetime" },
      verify: "automatic",
      hook: "YSD.members.join() / document event ysd:joined (first join only)",
      demoHow: { en: "Join with the DEMO form. Nothing is sent.", es: "Únete con el formulario DEMO. No se envía nada." }
    },
    {
      id: "rsvp",
      kind: "organizing",
      collectible: true,
      label: { en: "RSVP", es: "Confirmar asistencia" },
      how: { en: "Save your seat at an event.", es: "Guarda tu lugar en un evento." },
      limit: { count: 1, per: "event" },
      verify: "automatic",
      hook: "YSD.rsvp.on (first status 'in' per event; ref = event id)",
      demoHow: { en: "RSVP to any DEMO event.", es: "Confirma en cualquier evento DEMO." }
    },
    {
      id: "attend",
      kind: "organizing",
      collectible: true,
      label: { en: "Show up", es: "Llegar" },
      how: { en: "Check in at an event.", es: "Regístrate al llegar a un evento." },
      limit: { count: 1, per: "event" },
      verify: "check-in",
      hook: "QR check-in at the door (production); 'I was there (DEMO)' after the event's start (demo): YSD.stickers.act('attend', { ref, series, city, lang })",
      demoHow: { en: "After a DEMO event's start time, tap \"I was there (DEMO)\" on its page.", es: "Cuando empiece un evento DEMO, toca «Estuve ahí (DEMO)» en su página." }
    },
    {
      id: "bring-friend",
      kind: "organizing",
      collectible: true,
      label: { en: "Bring a friend", es: "Traer a alguien" },
      how: { en: "A friend joins through your link.", es: "Alguien se une con tu enlace." },
      limit: { count: 1, per: "friend" },
      verify: "automatic",
      hook: "YSD.members.onSquad: count members where simulated !== true (never count simulated ones)",
      demoHow: { en: "In the demo, only joins with your link on this device count.", es: "En la demo solo cuentan las personas que se unen con tu enlace en este dispositivo." }
    },
    {
      id: "post-clip",
      kind: "organizing",
      collectible: true,
      label: { en: "Post a clip", es: "Publicar un video" },
      how: { en: "Get a 60-second video approved for the site.", es: "Logra que aprueben tu video de 60 segundos para el sitio." },
      limit: { count: 2, per: "week" },
      verify: "moderator",
      hook: "YSD.clips upload approved by a moderator (ref = clip id); demo: document event ysd:clip-added",
      demoHow: { en: "In the demo, a submitted clip counts right away and is labeled DEMO.", es: "En la demo, un video enviado cuenta de inmediato y aparece como DEMO." }
    },
    {
      id: "share-card",
      kind: "organizing",
      collectible: true,
      label: { en: "Make a card", es: "Hacer una tarjeta" },
      how: { en: "Make a card (an invite, your cover or a quiz result) and send or save it.", es: "Haz una tarjeta (una invitación, tu portada o un resultado del quiz) y envíala o guárdala." },
      limit: { count: 3, per: "week" },
      verify: "automatic",
      hook: "YSD.cards.share() returns 'shared' or 'downloaded' (document event ysd:card-share)",
      demoHow: { en: "Send or save any card.", es: "Envía o guarda cualquier tarjeta." }
    },
    {
      id: "quiz",
      kind: "organizing",
      collectible: true,
      label: { en: "Finish a quiz", es: "Terminar un quiz" },
      how: { en: "Finish \"How do you show up?\" or \"Find your issue\".", es: "Termina «¿Cuál es tu modo de organizar?» o «Encuentra tu tema»." },
      limit: { count: 1, per: "lifetime" },
      verify: "automatic",
      hook: "quiz.html result screen (YSD.stickers.act('quiz', { ref: quizId }))",
      demoHow: { en: "Finish either quiz.", es: "Termina cualquiera de los dos quizzes." }
    },
    {
      id: "volunteer-shift",
      kind: "organizing",
      collectible: true,
      label: { en: "Volunteer shift", es: "Turno de voluntariado" },
      how: { en: "Finish a shift: a text bank, door-knocking, or a table at an event.", es: "Completa un turno: jornada de mensajes, visitas a vecinos o una mesa en un evento." },
      limit: { count: 1, per: "shift" },
      verify: "check-in",
      hook: "shift lead checks you in at the end (production); 'I was there (DEMO)' on events whose xpActions include volunteer-shift (demo)",
      demoHow: { en: "Tap \"I was there (DEMO)\" on a text bank or door-knocking event.", es: "Toca «Estuve ahí (DEMO)» en una jornada de mensajes o de visitas a vecinos." }
    },
    {
      id: "set-renewal-reminder",
      kind: "civic",
      collectible: false,
      label: { en: "Set your January reminder", es: "Poner tu recordatorio de enero" },
      how: { en: "Add the January reminder (Mon, Jan 4, 10 am) to renew your mail-ballot request. A private check on the voting page; nothing else.", es: "Agrega el recordatorio de enero (lunes 4 de enero, 10 a. m.) para renovar tu solicitud de boleta por correo. Una marca privada en la página de votación; nada más." },
      limit: { count: 1, per: "lifetime" },
      verify: "automatic",
      hook: "calendar add for civic.nextActions 'na-renew-reminder-2026' (vote hub private checklist only)",
      available: { from: "2026-11-09T00:00:00-05:00", until: "2027-01-01T00:00:00-05:00" },
      demoHow: { en: "Tap \"Add the January reminder\" on the voting page.", es: "Toca «Agregar el recordatorio de enero» en la página de votación." },
      facts: [
        {
          id: "mail-requests-expire-2026",
          claim: {
            en: "Florida vote-by-mail requests made before the Nov 3, 2026 general election end Dec 31, 2026.",
            es: "En Florida, las solicitudes de boleta por correo hechas antes de la elección general del 3 de noviembre de 2026 vencen el 31 de diciembre de 2026."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },
    {
      id: "renew-mail-ballot",
      kind: "civic",
      collectible: false,
      label: { en: "Renew your mail ballot", es: "Renovar tu boleta por correo" },
      how: { en: "Renew your mail-ballot request for 2027-28. A private check on the voting page; nothing else.", es: "Renueva tu solicitud de boleta por correo para 2027-28. Una marca privada en la página de votación; nada más." },
      limit: { count: 1, per: "cycle" },
      verify: "self-report",
      hook: "'I did it' on the renew step (civic.steps 'renew-mail-ballot'); vote hub private checklist only; never ask for proof",
      available: { from: "2027-01-01T00:00:00-05:00", until: "2029-01-01T00:00:00-05:00" },
      demoHow: { en: "Tap \"I did it\" on the renew step. Honor system.", es: "Toca «Ya lo hice» en el paso de renovación. Confiamos en tu palabra." },
      facts: [
        {
          id: "new-request-covers-2028",
          claim: {
            en: "A request made in 2027 covers elections through the end of the calendar year of the next regularly scheduled general election (Nov 7, 2028), so through Dec 31, 2028.",
            es: "Una solicitud hecha en 2027 cubre las elecciones hasta el final del año de la siguiente elección general ordinaria (7 de noviembre de 2028), es decir, hasta el 31 de diciembre de 2028."
          },
          source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },
    {
      id: "make-plan",
      kind: "civic",
      collectible: false,
      label: { en: "Make a voting plan", es: "Hacer tu plan para votar" },
      how: { en: "Finish the make-a-plan tool for an upcoming election. A private check on the voting page; nothing else.", es: "Completa la herramienta para armar tu plan en una próxima elección. Una marca privada en la página de votación; nada más." },
      limit: { count: 1, per: "election" },
      verify: "automatic",
      hook: "civic.plan builder completion (vote hub private checklist only)",
      demoHow: { en: "Finish the plan builder on the voting page.", es: "Completa el armador de planes en la página de votación." }
    },
    {
      id: "check-registration",
      kind: "civic",
      collectible: false,
      label: { en: "Check your registration", es: "Revisar tu registro" },
      how: { en: "Look up your voter record on the official site. A private check on the voting page; nothing else.", es: "Busca tu registro de votante en el sitio oficial. Una marca privada en la página de votación; nada más." },
      limit: { count: 1, per: "year" },
      verify: "self-report",
      hook: "'I did it' next to the civic.links.myVoterRecord link (vote hub private checklist only)",
      demoHow: { en: "Tap \"I did it\" after checking. Honor system.", es: "Toca «Ya lo hice» después de revisar. Confiamos en tu palabra." }
    }
  ],

  stickers: [
    {
      id: "doors-open",
      art: "heart",
      ring: "bubblegum",
      name: { en: "Doors Open", es: "Puertas abiertas" },
      desc: { en: "You joined. Come as you are.", es: "Te uniste. Ven como eres." },
      unlock: { en: "Join the Young Dems (free).", es: "Únete a los Young Dems (es gratis)." },
      rule: { type: "count", action: "join", min: 1 },
      share: {
        text: {
          en: "I joined the Young Dems in Seminole. Free, under 40, good people. Come with me: {url}",
          es: "Me uní a los Young Dems en Seminole. Gratis, menores de 40, gente buena. Ven conmigo: {url}"
        }
      }
    },
    {
      id: "saved-seat",
      art: "calendar",
      ring: "sky",
      name: { en: "Saved Seat", es: "Lugar guardado" },
      desc: { en: "Your first RSVP. Future you says thanks.", es: "Tu primera confirmación. Tu yo del futuro te lo agradece." },
      unlock: { en: "RSVP to your first event.", es: "Confirma tu primer evento." },
      rule: { type: "count", action: "rsvp", min: 1 },
      share: {
        text: {
          en: "Saved my seat at a Young Dems thing. Save yours next to me: {url}",
          es: "Ya guardé mi lugar en un evento de los Young Dems. Guarda el tuyo a mi lado: {url}"
        }
      }
    },
    {
      id: "first-night",
      art: "celery",
      ring: "celery",
      name: { en: "First Night", es: "Primera noche" },
      desc: { en: "Your first event. The rest is easier.", es: "Tu primer evento. Lo demás es más fácil." },
      unlock: { en: "Go to your first event.", es: "Ve a tu primer evento." },
      rule: { type: "count", action: "attend", min: 1 },
      perk: { en: "A welcome sticker at your first event", es: "Un sticker de bienvenida en tu primer evento" },
      share: {
        text: {
          en: "Went to my first Young Dems thing. Low-key, good people. Next one's with me: {url}",
          es: "Fui a mi primer evento de los Young Dems. Tranquilo y con gente buena. Al próximo vienes conmigo: {url}"
        }
      }
    },
    {
      id: "golden-hour",
      art: "sun",
      ring: "sun",
      name: { en: "Golden Hour", es: "Hora dorada" },
      desc: { en: "Sunset on Lake Monroe, in good company.", es: "Atardecer en el lago Monroe, en buena compañía." },
      unlock: { en: "Come to a sunset walk on Lake Monroe.", es: "Ven a una caminata al atardecer en el lago Monroe." },
      rule: { type: "attend-series", series: "sunset-walk", min: 1 },
      share: {
        text: {
          en: "Watched the sun go down over Lake Monroe with the Young Dems. Next walk, you're coming: {url}",
          es: "Vi el atardecer sobre el lago Monroe con los Young Dems. A la próxima caminata vienes: {url}"
        }
      }
    },
    {
      id: "on-the-platform",
      art: "train",
      ring: "tangerine",
      name: { en: "On the Platform", es: "En el andén" },
      desc: { en: "You took the train to a meetup. Respect.", es: "Llegaste en tren a un encuentro. Bien hecho." },
      unlock: { en: "Come to a SunRail social.", es: "Ven a un encuentro SunRail." },
      rule: { type: "attend-series", series: "sunrail", min: 1 },
      share: {
        text: {
          en: "Took SunRail to a Young Dems meetup. Next time, ride with me: {url}",
          es: "Fui en SunRail a un encuentro de los Young Dems. La próxima, vamos juntos en el tren: {url}"
        }
      }
    },
    {
      id: "trivia-brain",
      art: "gator",
      ring: "mint",
      name: { en: "Trivia Brain", es: "Cerebro de trivia" },
      desc: { en: "You know more about Seminole County than strictly necessary.", es: "Sabes más del condado de Seminole de lo estrictamente necesario." },
      unlock: { en: "Play a trivia night.", es: "Juega en una noche de trivia." },
      rule: { type: "attend-series", series: "trivia", min: 1 },
      share: {
        text: {
          en: "I now know more about Seminole County than is strictly necessary. My trivia team needs you: {url}",
          es: "Ahora sé más del condado de Seminole de lo estrictamente necesario. Mi equipo de trivia te necesita: {url}"
        }
      }
    },
    {
      id: "plus-one",
      art: "chicken",
      ring: "sky",
      name: { en: "Plus-One", es: "Trajiste a alguien" },
      desc: { en: "Someone joined because you asked. That's the whole idea.", es: "Alguien se unió porque tú le pediste. De eso se trata todo." },
      unlock: { en: "One friend joins through your link.", es: "Una persona se une con tu enlace." },
      rule: { type: "count", action: "bring-friend", min: 1 },
      share: {
        text: {
          en: "A friend joined Young Dems because I asked. You're next, obviously: {url}",
          es: "Alguien se unió a los Young Dems por invitación mía. Obvio, sigues tú: {url}"
        }
      }
    },
    {
      id: "squad-of-three",
      art: "heart",
      ring: "hotpink",
      name: { en: "Squad of Three", es: "Grupo de tres" },
      desc: { en: "Three friends in. You're the group chat's favorite person.", es: "Tres amistades adentro. Eres la persona favorita del chat." },
      unlock: { en: "Three friends join through your link.", es: "Tres personas se unen con tu enlace." },
      rule: { type: "count", action: "bring-friend", min: 3 },
      share: {
        text: {
          en: "Three of my friends joined Young Dems through my link. Make it four? {url}",
          es: "Tres amistades se unieron a los Young Dems con mi enlace. ¿Hacemos cuatro? {url}"
        }
      }
    },
    {
      id: "on-camera",
      art: "camera",
      ring: "violet",
      name: { en: "On Camera", es: "En cámara" },
      desc: { en: "Your 60 seconds are live. Someone needed to hear it.", es: "Tus 60 segundos ya están publicados. Alguien necesitaba escucharlo." },
      unlock: { en: "Get your first clip approved for the site.", es: "Logra que aprueben tu primer video para el sitio." },
      rule: { type: "count", action: "post-clip", min: 1 },
      share: {
        text: {
          en: "My 60-second video is up on the Young Dems site. Watch it, then make yours: {url}",
          es: "Mi video de 60 segundos ya está en el sitio de los Young Dems. Míralo y luego haz el tuyo: {url}"
        }
      }
    },
    {
      id: "shift-done",
      art: "cypress",
      ring: "orange",
      name: { en: "Shift Done", es: "Turno cumplido" },
      desc: { en: "Your first volunteer shift. The clipboard suits you.", es: "Tu primer turno de voluntariado. La tablilla te queda bien." },
      unlock: { en: "Finish your first volunteer shift: a text bank, door-knocking or a table.", es: "Completa tu primer turno: jornada de mensajes, visitas a vecinos o una mesa." },
      rule: { type: "count", action: "volunteer-shift", min: 1 },
      share: {
        text: {
          en: "Did my first volunteer shift with the Young Dems. Two hours, good people, real snacks. Come to the next one: {url}",
          es: "Hice mi primer turno de voluntariado con los Young Dems. Dos horas, gente buena y algo rico para picar. Ven al próximo: {url}"
        }
      }
    },
    {
      id: "city-hopper",
      art: "train",
      ring: "teal",
      name: { en: "City Hopper", es: "De ciudad en ciudad" },
      desc: { en: "Three Seminole cities and counting.", es: "Tres ciudades de Seminole, y contando." },
      unlock: { en: "Come to events in 3 different Seminole cities.", es: "Ve a eventos en 3 ciudades distintas de Seminole." },
      rule: { type: "attend-distinct", field: "city", min: 3 },
      share: {
        text: {
          en: "Three Seminole cities, three Young Dems events. Pick the next city: {url}",
          es: "Tres ciudades de Seminole, tres eventos de los Young Dems. Escoge la próxima ciudad: {url}"
        }
      }
    },
    {
      id: "bridge-builder",
      art: "heart",
      ring: "teal",
      name: { en: "Bridge Builder", es: "Puentes" },
      desc: { en: "You showed up for the Spanish-language side of the work.", es: "Te sumaste al trabajo en español." },
      unlock: { en: "Come to an event that runs in Spanish, like the voter workshop.", es: "Ven a un evento que se hace en español, como el taller para votantes." },
      rule: { type: "attend-language", lang: "es", min: 1 },
      share: {
        text: {
          en: "Went to a Spanish-language event with the Young Dems. Know someone who'd want the next one? {url}",
          es: "Fui a un evento en español con los Young Dems. ¿Conoces a alguien a quien le sirva el próximo? {url}"
        }
      }
    },
    {
      id: "card-maker",
      art: "camera",
      ring: "bubblegum",
      name: { en: "Card Maker", es: "Hiciste tu tarjeta" },
      desc: { en: "You made a card and sent it to someone you'd actually text.", es: "Hiciste una tarjeta y se la mandaste a alguien a quien de verdad le escribes." },
      unlock: { en: "Make a card and send or save it.", es: "Haz una tarjeta y envíala o guárdala." },
      rule: { type: "count", action: "share-card", min: 1 },
      share: {
        text: {
          en: "Made my own Young Dems card. Make yours: {url}",
          es: "Hice mi propia tarjeta de los Young Dems. Haz la tuya: {url}"
        }
      }
    },
    {
      id: "quiz-done",
      art: "sun",
      ring: "celery",
      name: { en: "Know Thyself", es: "Te conoces" },
      desc: { en: "You took a quiz and it called you out, kindly.", es: "Hiciste un quiz y te describió, con cariño." },
      unlock: { en: "Finish either quiz.", es: "Termina cualquiera de los dos quizzes." },
      rule: { type: "count", action: "quiz", min: 1 },
      share: {
        text: {
          en: "Took the Young Dems quiz and it knows me too well. Your turn: {url}",
          es: "Hice el quiz de los Young Dems y me conoce demasiado. Te toca: {url}"
        }
      }
    },
    {
      id: "long-game",
      art: "cypress",
      ring: "mint",
      name: { en: "The Long Game", es: "A largo plazo" },
      desc: { en: "Ten weeks of showing up, at your own pace.", es: "Diez semanas participando, a tu ritmo." },
      unlock: { en: "Be active in 10 different weeks. Any 10, in any order. Breaks never reset this one.", es: "Participa en 10 semanas distintas. Cualquier 10, en cualquier orden. Los descansos nunca reinician esta." },
      rule: { type: "active-weeks", min: 10 },
      share: {
        text: {
          en: "Ten weeks of showing up with the Young Dems, at my own pace. Here's to the long game: {url}",
          es: "Diez semanas participando con los Young Dems, a mi ritmo. Por lo que se construye a largo plazo: {url}"
        }
      }
    }
  ],

  streaks: {
    unit: "week",
    weekStartsOn: "monday",
    timezone: "America/New_York",
    rules: {
      activeWeek: {
        en: "A week counts when you do any one organizing thing (join, RSVP, show up, bring a friend, post a clip, make a card), Monday through Sunday.",
        es: "Una semana cuenta cuando haces cualquier cosa para organizar (unirte, confirmar, llegar, traer a alguien, publicar un video, hacer una tarjeta), de lunes a domingo."
      },
      streak: {
        en: "Your streak counts your active weeks in a row. A quiet week or two doesn't break it.",
        es: "Tu racha cuenta tus semanas activas seguidas. Una o dos semanas sin actividad no la rompen."
      },
      quietWeeks: {
        en: "Miss a week or two? Nothing happens. Your streak just waits for you; quiet weeks don't add to it, and they don't take anything away.",
        es: "¿Se te pasó una semana o dos? No pasa nada. Tu racha te espera: las semanas sin actividad no le suman, pero tampoco le quitan nada."
      },
      fade: {
        en: "After 3 quiet weeks in a row, the streak counter quietly goes back to zero. No message, no alert. Your stickers and total active weeks stay exactly where they were.",
        es: "Después de 3 semanas seguidas sin actividad, el contador de la racha vuelve a cero sin hacer ruido. Sin mensajes ni alertas. Tus stickers y tu total de semanas activas se quedan exactamente igual."
      },
      restWeeks: {
        en: "Holiday weeks are rest weeks. They never count as quiet weeks.",
        es: "Las semanas de fiestas son de descanso. Nunca cuentan como semanas sin actividad."
      }
    },
    graceWeeks: 2,
    fadeAfterQuietWeeks: 3,
    restWeeks: [
      { weekOf: "2026-11-23", name: { en: "Thanksgiving week", es: "Semana de Acción de Gracias" } },
      { weekOf: "2026-12-21", name: { en: "Christmas week", es: "Semana de Navidad" } },
      { weekOf: "2026-12-28", name: { en: "New Year's week", es: "Semana de Año Nuevo" } }
    ],
    show: {
      en: "Show the current streak only when it's 2 or more. Always show total active weeks. Never show a countdown, a timer or an \"at risk\" state.",
      es: "Muestra la racha actual solo cuando sea de 2 o más. Muestra siempre el total de semanas activas. Nunca muestres cuentas regresivas, temporizadores ni un estado de «en riesgo»."
    },
    reminders: {
      en: "Reminders are opt-in, at most one a week, and only about an upcoming event. Never about the streak.",
      es: "Los recordatorios son solo si los activas, máximo uno por semana, y solo sobre un próximo evento. Nunca sobre la racha."
    },
    milestones: [4, 8, 12],
    never: [
      { en: "\"Your streak is about to end\" or any warning before a week closes", es: "«Tu racha está por terminar» o cualquier aviso antes de que cierre la semana" },
      { en: "\"Don't lose your progress\" or anything that implies progress can be lost", es: "«No pierdas tu progreso» o cualquier cosa que sugiera que el progreso se puede perder" },
      { en: "Countdown timers, red warning states, broken or dying flames, sad mascots", es: "Cuentas regresivas, estados de alerta en rojo, llamas apagándose, mascotas tristes" },
      { en: "Any message sent because you missed a week", es: "Cualquier mensaje enviado porque no participaste una semana" },
      { en: "Notifications late at night (nothing after 9 pm)", es: "Notificaciones tarde en la noche (nada después de las 9 p. m.)" },
      { en: "Comparing you with friends by name", es: "Compararte con amistades por nombre" },
      { en: "Paying, donating or spending anything to keep or repair a streak", es: "Pagar, donar o gastar cualquier cosa para mantener o recuperar una racha" }
    ]
  },

  copy: {
    stickerCollected: { en: "New sticker: {sticker}.", es: "Sticker nuevo: {sticker}." },
    firstWeek: { en: "First active week. Nice.", es: "Primera semana activa. Bien." },
    streak: { en: "{n}-week streak. Good rhythm.", es: "Racha de {n} semanas. Buen ritmo." },
    milestone: { en: "{n}-week streak. That's a habit now.", es: "Racha de {n} semanas. Eso ya es costumbre." },
    totalWeeks: { en: "{n} active weeks so far", es: "{n} semanas activas hasta ahora" },
    welcomeBack: { en: "Welcome back. Your {n} active weeks are all still here.", es: "Qué bueno verte. Tus {n} semanas activas siguen aquí." },
    restWeek: { en: "Holiday week. It doesn't count against anything.", es: "Semana de fiestas. No cuenta en contra de nada." },
    noStickersYet: {
      en: "No stickers yet. The first one takes a single tap: join, RSVP or finish a quiz.",
      es: "Todavía no tienes stickers. El primero sale con un toque: únete, confirma o termina un quiz."
    }
  },

  demoProfile: {
    demo: true,
    note: "For screenshots and the empty-state preview only. Label it DEMO wherever it renders.",
    name: { en: "DEMO member", es: "Miembro DEMO" },
    city: "oviedo",
    activeWeeks: 5,
    stickers: ["doors-open", "saved-seat", "first-night", "golden-hour", "quiz-done"]
  },

  basis: [
    {
      id: "duolingo-streak",
      claim: {
        en: "Duolingo reports that learners who reach a 7-day streak are 2.4 times more likely to keep using the app the next day (company-reported, correlational).",
        es: "Duolingo informa que quienes llegan a una racha de 7 días tienen 2.4 veces más probabilidades de seguir usando la app al día siguiente (dato de la empresa, correlación)."
      },
      source: "https://blog.duolingo.com/improving-the-streak/",
      verified: "2026-11-09",
      confidence: "med",
      via: "docs/research/04-genz-brands-virality.md"
    },
    {
      id: "bereal-daily-fatigue",
      claim: {
        en: "Third-party estimates (Apptopia, via Dazed) put BeReal's daily users down about 61%, from about 15 million in Oct 2022 to under 6 million in Mar 2023; the company disputed the estimates. Lesson: daily obligations burn out, so this system is weekly.",
        es: "Estimaciones de terceros (Apptopia, citada por Dazed) indican que los usuarios diarios de BeReal bajaron cerca de un 61 %, de unos 15 millones en octubre de 2022 a menos de 6 millones en marzo de 2023; la empresa cuestionó esas cifras. Lección: las obligaciones diarias cansan, por eso este sistema es semanal."
      },
      source: "https://www.dazeddigital.com/life-culture/article/61166/1/why-did-bereal-fail-social-media-instagram-authenticity",
      sources: ["https://gizmodo.com/bereal-userbase-continues-to-shrink-similarweb-1850887998"],
      verified: "2026-11-09",
      confidence: "med",
      via: "docs/research/04-genz-brands-virality.md"
    },
    {
      id: "ftc-dark-patterns",
      claim: {
        en: "The FTC's Sept 2022 staff report on dark patterns, Bringing Dark Patterns to Light, calls out countdown timers that make people believe an offer is time-limited when it isn't.",
        es: "El informe del personal de la FTC de septiembre de 2022 sobre patrones oscuros, Bringing Dark Patterns to Light, señala los temporizadores que hacen creer que una oferta tiene tiempo limitado cuando no es así."
      },
      source: "https://www.ftc.gov/news-events/news/press-releases/2022/09/ftc-report-shows-rise-sophisticated-dark-patterns-designed-trick-trap-consumers",
      sources: ["https://www.ftc.gov/system/files/ftc_gov/pdf/P214800%20Dark%20Patterns%20Report%209.14.2022%20-%20FINAL.pdf"],
      verified: "2026-11-09",
      confidence: "high",
      via: "docs/research/04-genz-brands-virality.md"
    },
    {
      id: "shame-backfires",
      claim: {
        en: "In a 2006 Michigan field experiment, mailing households their neighbors' voting records raised turnout 8.1 points, but many households called to ask to be removed from future mailings; this system celebrates participation and never names who didn't act.",
        es: "En un experimento de campo en Michigan en 2006, enviarles a los hogares el historial de votación de sus vecinos subió la participación 8.1 puntos, pero muchos hogares llamaron para pedir que los sacaran de futuros envíos; este sistema celebra la participación y nunca señala a quien no participó."
      },
      source: "https://www.povertyactionlab.org/evaluation/social-pressure-and-voter-turnout-united-states",
      sources: ["https://doi.org/10.1017/S000305540808009X"],
      verified: "2026-11-09",
      confidence: "high",
      via: "docs/research/04-genz-brands-virality.md"
    },
    {
      id: "friend-ask",
      claim: {
        en: "In a randomized study of the Outvote app (2018 midterms), a text from a friend raised turnout among compliers by an estimated 8.3 points (95% CI 1.2 to 15.3), which is why bringing a friend gets two stickers of its own (Plus-One and Squad of Three).",
        es: "En un estudio aleatorio de la app Outvote (2018), un mensaje de una amistad subió la participación en unos 8.3 puntos estimados entre quienes efectivamente lo recibieron por haber sido asignados (IC 95 %: 1.2 a 15.3); por eso traer a alguien tiene dos stickers propios (Trajiste a alguien y Grupo de tres)."
      },
      source: "https://www.cs.columbia.edu/~blei/papers/ScheinVafaSridharVeitchQuinnMoffetBleiGreen2021.pdf",
      verified: "2026-11-09",
      confidence: "high",
      via: "docs/research/04-genz-brands-virality.md"
    }
  ]
};
