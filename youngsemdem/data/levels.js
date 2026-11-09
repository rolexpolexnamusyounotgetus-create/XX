/*!
 * data/levels.js: organizer levels, XP, badges and weekly streaks for the YDSC site, EN + ES.
 *
 * DEMO MODE (demo:true). The system is real design, but in the demo everything is stored only in the
 * visitor's browser, check-ins are simulated, and the perks are examples the chapter hasn't approved.
 * Pages must show labels.demo on the progress card and demoMode{} somewhere a visitor can read it.
 *
 * Design rules (docs/research/04 #12 and #14, 08 #20/#35, 05 voice; docs/legal/MINORS_POLICY.md):
 *  - Points come from real actions only, on a WEEKLY cadence (no daily obligation).
 *  - Streaks never guilt-trip: quiet weeks fade without a message, holiday weeks are skipped, and XP,
 *    levels, badges and total active weeks NEVER go down. See streaks.never[] for banned patterns.
 *  - XP never buys anything, never becomes money, and never decides chapter votes or who can run.
 *  - No public leaderboard of people. A city board, if built, shows city totals only.
 *  - Self-reported actions (mail-ballot renewal, registration check, membership choice) are honor
 *    system: never ask for voter data, ID numbers or screenshots.
 *  - Money never unlocks anything: the membership badge counts voting and non-voting the same.
 *
 * Load: classic script, after assets/js/config.js. No modules, no fetches. Node check:
 *   node -e "global.window={};require('./data/levels.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * CONVENTIONS (same as data/civic.js): bilingual text is { en, es }; ISO 8601 dates with the
 * America/New_York offset; placeholders {n}, {name}, {level}, {badge}, {url}. facts[] / basis[]
 * entries carry source + verified + confidence (editors only; do not render confidence).
 *
 * TOP LEVEL (window.YSD_DATA.levels)
 *   version, demo, verified, timezone, note{}, labels{}, demoMode{}, rules[], storage{},
 *   levels[] (LEVEL), levelsWhy{}, actions[] (ACTION), badges[] (BADGE), streaks{}, copy{},
 *   demoProfile{}, basis[]
 *
 * LEVEL   { id, order, name{}, minXp, blurb{}, perk{} (DEMO example), token }
 *         Current level = highest minXp <= total XP. Progress bar: (xp - minXp) / (next.minXp - minXp).
 *
 * ACTION  { id, label{}, how{}, xp, limit{ count, per }, verify, hook, available?{ from, until },
 *           demoHow{}, facts[]? }
 *   per      'lifetime' | 'event' | 'friend' | 'week' | 'year' | 'cycle' | 'election' | 'shift' | 'clip'
 *            ('cycle' = the 2027-28 mail-ballot cycle; 'week' resets Monday 12 am New York time)
 *   verify   'automatic' (the site sees it happen) | 'check-in' (QR or code at the event; simulated
 *            in demo) | 'moderator' (a person approves it) | 'self-report' (honor system)
 *   hook     where the page should listen, using the core modules in docs/infra/core.md
 *
 * BADGE   { id, name{}, desc{}, unlock{} (human-readable rule), rule{} (machine-readable),
 *           available?{ from, until }, token, icon (art hint), share{ text{}, urlKey?, url? } }
 *   rule.type:
 *     'count'            { action, min }          count of logged actions
 *     'attend-series'    { series, min }          attended events whose events.js series matches
 *     'attend-language'  { lang, min }            attended events that run in that language ONLY
 *                                                 (events.js language[] is exactly [lang]); most
 *                                                 events are ['en','es'] and must not count
 *     'attend-distinct'  { field: 'city', min }   attended events in N distinct events.js cities
 *     'active-weeks'     { min }                  total active weeks, any order
 *     'flag'             { flag }                 a one-off self-reported flag (see storage.flags)
 *   share.text ends with {url}. Use YSD.share.url() for site links, or YSD.cfg(share.urlKey, share.url)
 *   when the badge points to an official page.
 *
 * LEVELS WHY  levelsWhy{ title{}, body{}, facts[] }   BASIS  basis[] { id, claim{}, source, sources?[],
 *   verified, confidence, via } (research behind the design; editors only, never render)
 * STREAKS  streaks{ unit, weekStartsOn, timezone, rules{}, graceWeeks, fadeAfterQuietWeeks,
 *   restWeeks[{ weekOf (Monday, 'YYYY-MM-DD' local), name{} }], show{}, reminders{}, milestones[],
 *   never[] }. A streak counts consecutive active weeks, where up to graceWeeks quiet weeks in a row
 *   don't break it (they just don't add to it) and rest weeks are skipped entirely.
 * DEMO PROFILE  demoProfile{ demo, note, name{}, city, xp, level, activeWeeks, streak, badges[],
 *   log[{ action, xp, ref?, demo? }] } (xp must equal the sum of log xp)
 *
 * Mail-ballot wording follows data/civic.js and events.js: requests made before the Nov 3, 2026
 * election end Dec 31, 2026; Spanish "solicitud de boleta por correo".
 *
 * Interop: events.js items list xpActions[] and badgeIds[]; team.js tokens{} defines the colour tokens.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.levels = {
  version: 1,
  demo: true,
  verified: "2026-11-09",
  timezone: "America/New_York",

  note: {
    en: "Organizer levels: small, real actions add up, one week at a time. No pressure, no penalties.",
    es: "Niveles de organización: acciones pequeñas y reales que suman, semana a semana. Sin presión y sin castigos."
  },

  labels: {
    heading: { en: "Your level", es: "Tu nivel" },
    demo: { en: "DEMO", es: "DEMO" },
    xp: { en: "{n} XP", es: "{n} XP" },
    toNext: { en: "{n} XP to {level}", es: "Te faltan {n} XP para {level}" },
    maxLevel: { en: "Top level. Now help someone else get here.", es: "Nivel máximo. Ahora ayuda a alguien más a llegar." },
    badges: { en: "Badges", es: "Insignias" },
    locked: { en: "Not yet", es: "Todavía no" },
    unlocked: { en: "Unlocked {date}", es: "Desbloqueada el {date}" },
    howToEarn: { en: "How to earn XP", es: "Cómo ganar XP" },
    perWeek: { en: "up to {n} a week", es: "hasta {n} por semana" },
    honorSystem: { en: "Honor system", es: "Confiamos en tu palabra" },
    iDidIt: { en: "I did it", es: "Ya lo hice" },
    iWasThere: { en: "I was there (demo)", es: "Estuve ahí (demo)" },
    shareBadge: { en: "Share this badge", es: "Compartir esta insignia" },
    resetDemo: { en: "Reset demo progress", es: "Reiniciar el progreso de muestra" },
    perkDemo: { en: "Example perk (demo)", es: "Beneficio de ejemplo (demo)" }
  },

  demoMode: {
    title: { en: "How this works in the demo", es: "Cómo funciona en la demo" },
    points: [
      {
        en: "Everything here lives only in this browser while the site is in demo mode. Nothing is sent anywhere.",
        es: "Mientras el sitio está en modo demo, todo esto se guarda solo en este navegador. No se envía nada a ningún lado."
      },
      {
        en: "Event check-ins are simulated: after an event starts, its page shows an \"I was there (demo)\" button. On the real site, check-in is a QR code at the door.",
        es: "Los registros de asistencia son simulados: cuando empieza un evento, su página muestra un botón «Estuve ahí (demo)». En el sitio real, te registras con un código QR en la entrada."
      },
      {
        en: "Simulated friends in your demo squad count toward the friend badges, so you can see how they work. Anything they unlock is labeled DEMO.",
        es: "Las amistades simuladas de tu grupo de muestra cuentan para las insignias de invitar, así ves cómo funcionan. Todo lo que desbloqueen dice DEMO."
      },
      {
        en: "Perks are examples. The chapter hasn't approved them yet.",
        es: "Los beneficios son ejemplos. El grupo todavía no los ha aprobado."
      },
      {
        en: "You can reset your demo progress anytime.",
        es: "Puedes reiniciar tu progreso de muestra cuando quieras."
      }
    ]
  },

  rules: [
    { en: "XP comes from real actions. It never buys anything and never turns into money.", es: "Los XP salen de acciones reales. Nunca compran nada ni se convierten en dinero." },
    { en: "Levels don't decide chapter votes or who can run for a role.", es: "Los niveles no deciden los votos del grupo ni quién se puede postular a un puesto." },
    { en: "XP, levels, badges and your total active weeks never go down.", es: "Los XP, los niveles, las insignias y tu total de semanas activas nunca bajan." },
    { en: "No public leaderboard of people. Your progress is yours to share or not.", es: "No hay una tabla pública con nombres. Tu progreso es tuyo: lo compartes si quieres." },
    { en: "Self-reported actions run on the honor system. We never ask for voter information, ID numbers or screenshots.", es: "Las acciones que reportas tú funcionan con base en la confianza. Nunca pedimos datos de votante, números de identificación ni capturas de pantalla." },
    { en: "Share cards show your first name only, with no photo, unless you choose otherwise.", es: "Las tarjetas para compartir muestran solo tu nombre de pila, sin foto, a menos que tú decidas otra cosa." }
  ],

  storage: {
    note: "Suggested YSD.store keys. They do not collide with the core keys listed in docs/infra/core.md. Keep the log as the source of truth and compute XP, levels, badges and streaks from it, so limits can be enforced and nothing is double-counted.",
    keys: {
      log: "levels:log",
      badges: "levels:badges",
      flags: "levels:flags",
      seen: "levels:seen"
    },
    logEntry: "{ id, action, at (ISO), ref? (event id, clip id, friend id, election id), demo? (true for simulated check-ins or simulated friends) }",
    flags: ["membership-chosen"]
  },

  levels: [
    {
      id: "seed",
      order: 1,
      name: { en: "Seed", es: "Semilla" },
      minXp: 0,
      blurb: {
        en: "You're here. Everything starts small, even a 3,500-year-old cypress.",
        es: "Ya llegaste. Todo empieza pequeño, hasta un ciprés de 3,500 años."
      },
      perk: { en: "A welcome sticker at your first event", es: "Un sticker de bienvenida en tu primer evento" },
      token: "--celery"
    },
    {
      id: "sprout",
      order: 2,
      name: { en: "Sprout", es: "Brote" },
      minXp: 100,
      blurb: {
        en: "You showed up. Honestly, that's the hard part.",
        es: "Llegaste. La verdad, eso es lo más difícil."
      },
      perk: { en: "First pick from the sticker sheet", es: "Escoges primero de la hoja de stickers" },
      token: "--sky"
    },
    {
      id: "sapling",
      order: 3,
      name: { en: "Sapling", es: "Arbolito" },
      minXp: 300,
      blurb: {
        en: "You're a regular now. People save you a seat.",
        es: "Ya eres de la casa. Te guardan un lugar."
      },
      perk: { en: "Pick a round topic at trivia night", es: "Escoges el tema de una ronda en la noche de trivia" },
      token: "--bubblegum"
    },
    {
      id: "cypress",
      order: 4,
      name: { en: "Cypress", es: "Ciprés" },
      minXp: 700,
      blurb: {
        en: "Deep roots. You bring people with you, and they stay.",
        es: "Raíces profundas. Traes gente contigo y se queda."
      },
      perk: { en: "Choose one of the Picks in the Thursday Letter", es: "Escoges una de las recomendaciones de La Carta del Jueves" },
      token: "--violet"
    },
    {
      id: "phoenix",
      order: 5,
      name: { en: "Phoenix", es: "Fénix" },
      minXp: 1400,
      blurb: {
        en: "Named for The Phoenix, the young clone of The Senator growing in Big Tree Park. You're how this keeps going.",
        es: "Se llama así por The Phoenix, el clon joven de The Senator que crece en Big Tree Park. Gracias a ti, esto sigue."
      },
      perk: { en: "Co-host an event with us, or write a Guest Letter", es: "Organizas un evento con nosotros o escribes una carta invitada" },
      token: "--violet-deep"
    }
  ],

  levelsWhy: {
    title: { en: "Why trees?", es: "¿Por qué árboles?" },
    body: {
      en: "Longwood's Big Tree Park was home to The Senator, a bald cypress about 3,500 years old, until a fire took it in 2012. A clone called The Phoenix now grows near the park's playground, and Lady Liberty, about 2,000 years old, still stands nearby. Slow growth, deep roots, coming back after a loss: that's the whole idea.",
      es: "En Big Tree Park, en Longwood, estaba The Senator, un ciprés calvo de unos 3,500 años, hasta que un incendio acabó con él en 2012. Hoy crece cerca del área de juegos un clon llamado The Phoenix, y cerca sigue en pie Lady Liberty, de unos 2,000 años. Crecer despacio, echar raíces profundas y volver después de una pérdida: de eso se trata."
    },
    facts: [
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
      }
    ]
  },

  actions: [
    {
      id: "join",
      label: { en: "Join", es: "Unirte" },
      how: { en: "Join the Young Dems list.", es: "Únete a la lista de Young Dems." },
      xp: 50,
      limit: { count: 1, per: "lifetime" },
      verify: "automatic",
      hook: "YSD.members.join() / document event ysd:joined (first join only)",
      demoHow: { en: "Join with the demo form. Nothing is sent.", es: "Únete con el formulario de muestra. No se envía nada." }
    },
    {
      id: "rsvp",
      label: { en: "RSVP", es: "Confirmar asistencia" },
      how: { en: "Save your seat at an event.", es: "Guarda tu lugar en un evento." },
      xp: 10,
      limit: { count: 1, per: "event" },
      verify: "automatic",
      hook: "events page RSVP submit (ref = event id); also bump YSD.counters 'rsvps'",
      demoHow: { en: "RSVP to any demo event.", es: "Confirma en cualquier evento de muestra." }
    },
    {
      id: "attend",
      label: { en: "Show up", es: "Llegar" },
      how: { en: "Check in at an event.", es: "Regístrate al llegar a un evento." },
      xp: 40,
      limit: { count: 1, per: "event" },
      verify: "check-in",
      hook: "QR check-in at the door (production); 'I was there (demo)' button after the event's start (demo). ref = event id",
      demoHow: { en: "After a demo event's start time, tap \"I was there (demo)\" on its page.", es: "Cuando empiece un evento de muestra, toca «Estuve ahí (demo)» en su página." }
    },
    {
      id: "bring-friend",
      label: { en: "Bring a friend", es: "Traer a alguien" },
      how: { en: "A friend joins through your link.", es: "Alguien se une con tu enlace." },
      xp: 60,
      limit: { count: 1, per: "friend" },
      verify: "automatic",
      hook: "YSD.members.onSquad((squad, added) => ...) : one log entry per added member id; set demo:true when member.simulated",
      demoHow: { en: "Simulated demo friends show up in your squad over time and count here, labeled DEMO.", es: "Con el tiempo aparecen amistades simuladas en tu grupo de muestra y cuentan aquí, marcadas como DEMO." }
    },
    {
      id: "set-renewal-reminder",
      label: { en: "Set your renewal reminder", es: "Poner tu recordatorio de renovación" },
      how: { en: "Add the Jan 1 reminder to renew your mail-ballot request.", es: "Agrega el recordatorio del 1 de enero para renovar tu solicitud de boleta por correo." },
      xp: 15,
      limit: { count: 1, per: "lifetime" },
      verify: "automatic",
      hook: "calendar add for civic.nextActions 'na-renew-reminder-2026' (YSD.track 'calendar_add' / ysd:calendar)",
      available: { from: "2026-11-09T00:00:00-05:00", until: "2027-01-01T00:00:00-05:00" },
      demoHow: { en: "Tap \"Add the reminder\" on the voting hub or the renew-ready event.", es: "Toca «Agregar el recordatorio» en la sección de votación o en el evento de renovación." },
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
      label: { en: "Renew your mail ballot", es: "Renovar tu boleta por correo" },
      how: { en: "Renew your mail-ballot request for 2027-28, then tap \"I did it\".", es: "Renueva tu solicitud de boleta por correo para 2027-28 y luego toca «Ya lo hice»." },
      xp: 50,
      limit: { count: 1, per: "cycle" },
      verify: "self-report",
      hook: "'I did it' button on the renew step (civic.steps 'renew-mail-ballot'); never ask for proof",
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
      label: { en: "Make a voting plan", es: "Hacer tu plan para votar" },
      how: { en: "Finish the make-a-plan tool for an upcoming election.", es: "Completa la herramienta para armar tu plan en una próxima elección." },
      xp: 20,
      limit: { count: 1, per: "election" },
      verify: "automatic",
      hook: "civic.plan builder completion (ref = election date id)",
      demoHow: { en: "Finish the plan builder on the voting hub.", es: "Completa el armador de planes en la sección de votación." }
    },
    {
      id: "check-registration",
      label: { en: "Check your registration", es: "Revisar tu registro" },
      how: { en: "Look up your voter record on the official site, then tap \"I did it\".", es: "Busca tu registro de votante en el sitio oficial y luego toca «Ya lo hice»." },
      xp: 15,
      limit: { count: 1, per: "year" },
      verify: "self-report",
      hook: "'I did it' button next to the civic.links.myVoterRecord link",
      demoHow: { en: "Tap \"I did it\" after checking. Honor system.", es: "Toca «Ya lo hice» después de revisar. Confiamos en tu palabra." }
    },
    {
      id: "post-clip",
      label: { en: "Post a clip", es: "Publicar un video" },
      how: { en: "Get a 60-second video approved for the site.", es: "Logra que aprueben tu video de 60 segundos para el sitio." },
      xp: 30,
      limit: { count: 2, per: "week" },
      verify: "moderator",
      hook: "YSD.clips upload approved by a moderator (ref = clip id); see docs/infra/video.md",
      demoHow: { en: "In the demo, a submitted clip counts right away and is labeled DEMO.", es: "En la demo, un video enviado cuenta de inmediato y aparece como DEMO." }
    },
    {
      id: "share-card",
      label: { en: "Share a card", es: "Compartir una tarjeta" },
      how: { en: "Share a card (event, pledge, badge or quiz result) with someone.", es: "Comparte una tarjeta (de evento, compromiso, insignia o resultado de quiz) con alguien." },
      xp: 10,
      limit: { count: 3, per: "week" },
      verify: "automatic",
      hook: "YSD.cards.share() returns 'shared' or 'downloaded' (ysd:card-share)",
      demoHow: { en: "Share or download any card.", es: "Comparte o descarga cualquier tarjeta." }
    },
    {
      id: "volunteer-shift",
      label: { en: "Volunteer shift", es: "Turno de voluntariado" },
      how: { en: "Finish a shift: a text bank, door-knocking, or a table at an event.", es: "Completa un turno: jornada de mensajes, visitas a vecinos o una mesa en un evento." },
      xp: 80,
      limit: { count: 1, per: "shift" },
      verify: "check-in",
      hook: "shift lead checks you in at the end (production); 'I was there (demo)' on events whose xpActions include volunteer-shift (demo)",
      demoHow: { en: "Tap \"I was there (demo)\" on a text bank or door-knocking event.", es: "Toca «Estuve ahí (demo)» en una jornada de mensajes o de visitas a vecinos." }
    }
  ],

  badges: [
    {
      id: "doors-open",
      name: { en: "Doors Open", es: "Puertas abiertas" },
      desc: { en: "Your first event. The rest is easier.", es: "Tu primer evento. Lo demás es más fácil." },
      unlock: { en: "Go to your first event.", es: "Ve a tu primer evento." },
      rule: { type: "count", action: "attend", min: 1 },
      token: "--celery",
      icon: "open door",
      share: {
        text: {
          en: "Went to my first Young Dems thing. Low-key, good people. Next one's with me: {url}",
          es: "Fui a mi primer evento de Young Dems. Tranquilo y con gente buena. Al próximo vienes conmigo: {url}"
        }
      }
    },
    {
      id: "plus-one",
      name: { en: "Plus-One", es: "Trajiste a alguien" },
      desc: { en: "Someone joined because you asked. That's the whole game.", es: "Alguien se unió porque tú le pediste. De eso se trata todo." },
      unlock: { en: "One friend joins through your link.", es: "Una persona se une con tu enlace." },
      rule: { type: "count", action: "bring-friend", min: 1 },
      token: "--sky",
      icon: "two speech bubbles",
      share: {
        text: {
          en: "A friend joined Young Dems because I asked. You're next, obviously: {url}",
          es: "Alguien se unió a Young Dems por invitación mía. Obvio, sigues tú: {url}"
        }
      }
    },
    {
      id: "squad-of-three",
      name: { en: "Squad of Three", es: "Grupo de tres" },
      desc: { en: "Three friends in. You're the group chat's favorite person.", es: "Tres amistades adentro. Eres la persona favorita del chat." },
      unlock: { en: "Three friends join through your link.", es: "Tres personas se unen con tu enlace." },
      rule: { type: "count", action: "bring-friend", min: 3 },
      token: "--bubblegum",
      icon: "three stacked stickers",
      share: {
        text: {
          en: "Three of my friends joined Young Dems through my link. Make it four? {url}",
          es: "Tres amistades se unieron a Young Dems con mi enlace. ¿Hacemos cuatro? {url}"
        }
      }
    },
    {
      id: "renew-ready",
      name: { en: "Renew-Ready", es: "Lista la renovación" },
      desc: { en: "Your Jan 1 reminder is set. Future you says thanks.", es: "Tu recordatorio del 1 de enero está listo. Tu yo del futuro te lo agradece." },
      unlock: { en: "Add the Jan 1 mail-ballot renewal reminder (Nov 9 to Dec 31, 2026).", es: "Agrega el recordatorio del 1 de enero para renovar tu boleta por correo (del 9 de noviembre al 31 de diciembre de 2026)." },
      rule: { type: "count", action: "set-renewal-reminder", min: 1 },
      available: { from: "2026-11-09T00:00:00-05:00", until: "2027-01-01T00:00:00-05:00" },
      token: "--celery",
      icon: "calendar page with a check",
      share: {
        text: {
          en: "My Florida mail-ballot request runs out Dec 31, and so does yours if you asked for one before Nov 3. I set a Jan 1 reminder to renew. Set yours: {url}",
          es: "Mi solicitud de boleta por correo en Florida vence el 31 de diciembre, y la tuya también si la pediste antes del 3 de noviembre. Ya puse un recordatorio para renovarla el 1 de enero. Pon el tuyo: {url}"
        },
        urlNote: "Link to the site's renew step (civic.steps 'renew-mail-ballot') with YSD.share.url()."
      }
    },
    {
      id: "renewed",
      name: { en: "Renewed", es: "Renovada" },
      desc: { en: "Mail-ballot request renewed, so you're covered through 2028.", es: "Solicitud de boleta por correo renovada: te cubre hasta finales de 2028." },
      unlock: { en: "Renew your mail-ballot request for 2027-28 and tap \"I did it\". Honor system.", es: "Renueva tu solicitud de boleta por correo para 2027-28 y toca «Ya lo hice». Confiamos en tu palabra." },
      rule: { type: "count", action: "renew-mail-ballot", min: 1 },
      available: { from: "2027-01-01T00:00:00-05:00", until: "2029-01-01T00:00:00-05:00" },
      token: "--violet",
      icon: "envelope with a check",
      share: {
        text: {
          en: "Renewed my mail-ballot request: it covers me through 2028. The old ones ran out Dec 31. Renew yours: {url}",
          es: "Ya renové mi solicitud de boleta por correo: me cubre hasta finales de 2028. Las anteriores vencieron el 31 de diciembre. Renueva la tuya: {url}"
        },
        urlKey: "links.vote.voteByMail",
        url: "https://voteseminole.gov/how-to-vote/vote-by-mail/"
      }
    },
    {
      id: "plan-made",
      name: { en: "Plan Made", es: "Plan hecho" },
      desc: { en: "When, how and who you're going with. Done.", es: "Cuándo, cómo y con quién vas. Listo." },
      unlock: { en: "Make a voting plan for an upcoming election.", es: "Haz tu plan para votar en una próxima elección." },
      rule: { type: "count", action: "make-plan", min: 1 },
      token: "--sky",
      icon: "checklist",
      share: {
        text: {
          en: "Made my plan for the next election: when, how, and who I'm going with. Make yours: {url}",
          es: "Ya hice mi plan para la próxima elección: cuándo, cómo y con quién voy. Haz el tuyo: {url}"
        }
      }
    },
    {
      id: "golden-hour",
      name: { en: "Golden Hour", es: "Hora dorada" },
      desc: { en: "Sunset on Lake Monroe, in good company.", es: "Atardecer en el lago Monroe, en buena compañía." },
      unlock: { en: "Come to a sunset walk on Lake Monroe.", es: "Ven a una caminata al atardecer en el lago Monroe." },
      rule: { type: "attend-series", series: "sunset-walk", min: 1 },
      token: "--bubblegum",
      icon: "sun setting over water",
      share: {
        text: {
          en: "Watched the sun go down over Lake Monroe with the Young Dems. Next walk, you're coming: {url}",
          es: "Vi el atardecer sobre el lago Monroe con Young Dems. A la próxima caminata vienes: {url}"
        }
      }
    },
    {
      id: "on-the-platform",
      name: { en: "On the Platform", es: "En el andén" },
      desc: { en: "You took the train to a meetup. Respect.", es: "Llegaste en tren a un encuentro. Bien hecho." },
      unlock: { en: "Come to a SunRail social.", es: "Ven a un encuentro SunRail." },
      rule: { type: "attend-series", series: "sunrail", min: 1 },
      token: "--sky",
      icon: "train at a platform",
      share: {
        text: {
          en: "Took SunRail to a Young Dems meetup. Next time, ride with me: {url}",
          es: "Fui en SunRail a un encuentro de Young Dems. La próxima, vamos juntos en el tren: {url}"
        }
      }
    },
    {
      id: "trivia-brain",
      name: { en: "Trivia Brain", es: "Cerebro de trivia" },
      desc: { en: "You know more about Seminole County than strictly necessary.", es: "Sabes más del condado de Seminole de lo estrictamente necesario." },
      unlock: { en: "Play a trivia night.", es: "Juega en una noche de trivia." },
      rule: { type: "attend-series", series: "trivia", min: 1 },
      token: "--celery",
      icon: "lightbulb with a pencil",
      share: {
        text: {
          en: "I now know more about Seminole County than is strictly necessary. My trivia team needs you: {url}",
          es: "Ahora sé más del condado de Seminole de lo estrictamente necesario. Mi equipo de trivia te necesita: {url}"
        }
      }
    },
    {
      id: "mic-check",
      name: { en: "Mic Check", es: "Probando, probando" },
      desc: { en: "You sang, or cheered loudly for someone who did. Both count.", es: "Cantaste, o aplaudiste a todo pulmón a quien cantó. Las dos cosas cuentan." },
      unlock: { en: "Come to a karaoke night.", es: "Ven a una noche de karaoke." },
      rule: { type: "attend-series", series: "karaoke", min: 1 },
      token: "--bubblegum",
      icon: "microphone",
      share: {
        text: {
          en: "Sang at Young Dems karaoke. No recordings exist, and that's final. Next one: {url}",
          es: "Canté en el karaoke de Young Dems. No hay grabaciones y punto. El próximo: {url}"
        }
      }
    },
    {
      id: "on-camera",
      name: { en: "On Camera", es: "En cámara" },
      desc: { en: "Your 60 seconds are live. Someone needed to hear it.", es: "Tus 60 segundos ya están publicados. Alguien necesitaba escucharlo." },
      unlock: { en: "Get your first clip approved for the site.", es: "Logra que aprueben tu primer video para el sitio." },
      rule: { type: "count", action: "post-clip", min: 1 },
      token: "--violet",
      icon: "phone on a tripod",
      share: {
        text: {
          en: "My 60-second video is up on the Young Dems site. Watch it, then make yours: {url}",
          es: "Mi video de 60 segundos ya está en el sitio de Young Dems. Míralo y luego haz el tuyo: {url}"
        }
      }
    },
    {
      id: "shift-done",
      name: { en: "Shift Done", es: "Turno cumplido" },
      desc: { en: "Your first volunteer shift. The clipboard suits you.", es: "Tu primer turno de voluntariado. La tablilla te queda bien." },
      unlock: { en: "Finish your first volunteer shift: a text bank, door-knocking or a table.", es: "Completa tu primer turno: jornada de mensajes, visitas a vecinos o una mesa." },
      rule: { type: "count", action: "volunteer-shift", min: 1 },
      token: "--orange",
      icon: "clipboard",
      share: {
        text: {
          en: "Did my first volunteer shift with the Young Dems. Two hours, good people, real snacks. Come to the next one: {url}",
          es: "Hice mi primer turno de voluntariado con Young Dems. Dos horas, gente buena y algo rico para picar. Ven al próximo: {url}"
        }
      }
    },
    {
      id: "bridge-builder",
      name: { en: "Bridge Builder", es: "Puentes" },
      desc: { en: "You showed up for the Spanish-language side of the work.", es: "Te sumaste al trabajo en español." },
      unlock: { en: "Come to an event that runs in Spanish, like the voter workshop.", es: "Ven a un evento que se hace en español, como el taller para votantes." },
      rule: { type: "attend-language", lang: "es", min: 1 },
      token: "--teal",
      icon: "bridge",
      share: {
        text: {
          en: "Went to a Spanish-language event with the Young Dems. Know someone who'd want the next one? {url}",
          es: "Fui a un evento en español con Young Dems. ¿Conoces a alguien a quien le sirva el próximo? {url}"
        }
      }
    },
    {
      id: "city-hopper",
      name: { en: "City Hopper", es: "De ciudad en ciudad" },
      desc: { en: "Three Seminole cities and counting.", es: "Tres ciudades de Seminole, y contando." },
      unlock: { en: "Come to events in 3 different Seminole cities.", es: "Ve a eventos en 3 ciudades distintas de Seminole." },
      rule: { type: "attend-distinct", field: "city", min: 3 },
      token: "--orange",
      icon: "map pin trio",
      share: {
        text: {
          en: "Three Seminole cities, three Young Dems events. Pick the next city: {url}",
          es: "Tres ciudades de Seminole, tres eventos de Young Dems. Escoge la próxima ciudad: {url}"
        }
      }
    },
    {
      id: "card-carrier",
      name: { en: "Card Carrier", es: "Con carné" },
      desc: { en: "You picked your membership. Voting or non-voting, it counts the same here.", es: "Escogiste tu membresía. Con voto o sin voto, aquí cuenta igual." },
      unlock: { en: "Choose a voting membership (with dues) or a non-voting membership, and tap \"I did it\".", es: "Escoge la membresía con voto (con cuota) o sin voto, y toca «Ya lo hice»." },
      rule: { type: "flag", flag: "membership-chosen" },
      token: "--violet-deep",
      icon: "member card",
      share: {
        text: {
          en: "I'm officially a Young Dem for 2027. Ages 14 to 39, come join: {url}",
          es: "Ya soy oficialmente de Young Dems en 2027. Si tienes de 14 a 39 años, únete: {url}"
        }
      },
      facts: [
        {
          id: "member-paths",
          claim: {
            en: "YDSC offers voting membership (dues-paying, Seminole residents or students) and non-voting membership for people who can't pay dues; members are at least 14 and under 40.",
            es: "YDSC ofrece membresía con voto (con cuota, para residentes o estudiantes de Seminole) y membresía sin voto para quienes no pueden pagar; los miembros tienen al menos 14 años y menos de 40."
          },
          source: "https://secure.actblue.com/donate/ydscdues",
          verified: "2026-11-09",
          confidence: "high"
        }
      ]
    },
    {
      id: "long-game",
      name: { en: "The Long Game", es: "A largo plazo" },
      desc: { en: "Ten weeks of showing up, at your own pace.", es: "Diez semanas participando, a tu ritmo." },
      unlock: { en: "Be active in 10 different weeks. Any 10, in any order. Breaks never reset this one.", es: "Participa en 10 semanas distintas. Cualquier 10, en cualquier orden. Los descansos nunca reinician esta." },
      rule: { type: "active-weeks", min: 10 },
      token: "--violet",
      icon: "cypress tree rings",
      share: {
        text: {
          en: "Ten weeks of showing up with the Young Dems, at my own pace. Here's to the long game: {url}",
          es: "Diez semanas participando con Young Dems, a mi ritmo. Por lo que se construye a largo plazo: {url}"
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
        en: "A week counts when you do any one thing from the XP table, Monday through Sunday.",
        es: "Una semana cuenta cuando haces cualquier cosa de la tabla de XP, de lunes a domingo."
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
        en: "After 3 quiet weeks in a row, the streak counter quietly goes back to zero. No message, no alert. Your XP, level, badges and total active weeks stay exactly where they were.",
        es: "Después de 3 semanas seguidas sin actividad, el contador de la racha vuelve a cero sin hacer ruido. Sin mensajes ni alertas. Tus XP, tu nivel, tus insignias y tu total de semanas activas se quedan exactamente igual."
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
    xpToast: { en: "+{n} XP", es: "+{n} XP" },
    levelUp: {
      en: "You're a {level} now. Thanks for showing up.",
      es: "Ahora eres {level}. Gracias por estar."
    },
    badgeUnlocked: {
      en: "New badge: {badge}.",
      es: "Nueva insignia: {badge}."
    },
    firstWeek: { en: "First active week. Nice.", es: "Primera semana activa. Bien." },
    streak: { en: "{n}-week streak. Good rhythm.", es: "Racha de {n} semanas. Buen ritmo." },
    milestone: { en: "{n}-week streak. That's a habit now.", es: "Racha de {n} semanas. Eso ya es costumbre." },
    totalWeeks: { en: "{n} active weeks so far", es: "{n} semanas activas hasta ahora" },
    welcomeBack: { en: "Welcome back. Your {n} active weeks are all still here.", es: "Qué bueno verte. Tus {n} semanas activas siguen aquí." },
    restWeek: { en: "Holiday week. It doesn't count against anything.", es: "Semana de fiestas. No cuenta en contra de nada." },
    weeklyCapReached: { en: "That's the most XP this one gives in a week. It still counts as a good thing to do.", es: "Ya llegaste al máximo de XP semanal por esto. Igual vale la pena hacerlo." },
    noBadgesYet: {
      en: "No badges yet. The first one takes a single event.",
      es: "Todavía no tienes insignias. La primera sale con un solo evento."
    }
  },

  demoProfile: {
    demo: true,
    note: "For screenshots and the empty-state preview only. Label it DEMO wherever it renders.",
    name: { en: "Demo member", es: "Miembro de muestra" },
    city: "oviedo",
    xp: 360,
    level: "sapling",
    activeWeeks: 5,
    streak: 3,
    badges: ["doors-open", "plus-one", "renew-ready", "golden-hour", "shift-done"],
    log: [
      { action: "join", xp: 50 },
      { action: "rsvp", xp: 10, ref: "sunset-walk-lake-monroe" },
      { action: "attend", xp: 40, ref: "sunset-walk-lake-monroe" },
      { action: "set-renewal-reminder", xp: 15 },
      { action: "share-card", xp: 10 },
      { action: "share-card", xp: 10 },
      { action: "rsvp", xp: 10, ref: "text-bank-dec-31-heads-up" },
      { action: "attend", xp: 40, ref: "text-bank-dec-31-heads-up" },
      { action: "volunteer-shift", xp: 80, ref: "text-bank-dec-31-heads-up" },
      { action: "bring-friend", xp: 60, demo: true },
      { action: "make-plan", xp: 20 },
      { action: "check-registration", xp: 15 }
    ]
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
        en: "In a randomized study of the Outvote app (2018 midterms), a text from a friend raised turnout among compliers by an estimated 8.3 points (95% CI 1.2 to 15.3), which is why bringing a friend earns more XP than anything except a volunteer shift.",
        es: "En un estudio aleatorio de la app Outvote (2018), un mensaje de una amistad subió la participación en unos 8.3 puntos estimados entre quienes efectivamente lo recibieron por haber sido asignados (IC 95 %: 1.2 a 15.3); por eso traer a alguien da más XP que cualquier otra acción, salvo un turno de voluntariado."
      },
      source: "https://www.cs.columbia.edu/~blei/papers/ScheinVafaSridharVeitchQuinnMoffetBleiGreen2021.pdf",
      verified: "2026-11-09",
      confidence: "high",
      via: "docs/research/04-genz-brands-virality.md"
    }
  ]
};
