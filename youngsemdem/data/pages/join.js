/*!
 * data/pages/join.js (W6, round 1 G-JOIN): page copy for join.html (EN + ES), the "join:" strings that
 * assets/js/joinform.js reads (form.*, done.*, step2.*, mc.*, intent.*, crews.*, prefill.*; joinform.js carries
 * a fallback for the core subset), and window.YSD_DATA.joinPicks: the "I want to..." intents and the crews for
 * step two (right-wing-intent-lost, right-wing-identity-crews). newsletter.html loads this file too, so its
 * inline step two shows the same picks.
 *
 * Facts used here: membership is ages 14 to 39 (under 40); dues are $20 a year, due in January; voting members
 * live in Seminole County or go to school here; non-voting membership is free for anyone who qualifies but can't
 * pay, money or citizenship status (YDSC's ActBlue dues page, https://secure.actblue.com/donate/ydscdues,
 * checked Mon, Nov 9, 2026; BRIEF 9). Teen rules mirror data/legal.js pages.minors (random-style codes under 18,
 * no club texts before 18, no one-on-one messages from adult organizers, a guardian's OK for off-site, after-dark
 * or rally events and before a recognizable photo or clip). Pre-registration at 16: F.S. 97.041(1)(b)
 * (https://www.flsenate.gov/Laws/Statutes/2026/97.041), the same source vote.html cites; no reward is attached
 * to it, ever (ruling 00). Line 26 (chip-in) is BRIEF 2.7. Every crew is a DEMO idea waiting for a host.
 * Spanish is a draft until a fluent reviewer signs off.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.join = {
  'og.alt': { en: "Join the Young Dems. Come as you are. Bring a friend. Young Democrats of Seminole County, ages 14 to 39. DEMO preview.", es: "Únete a los Young Dems. Ven como eres. Trae a alguien. Young Democrats of Seminole County, de 14 a 39 años. Vista previa DEMO." },
  'og.kicker': { en: "JOIN FREE", es: "ÚNETE GRATIS" },

  'hero.eyebrow': { en: "YOUNG DEMS · AGES 14 TO 39", es: "YOUNG DEMS · DE 14 A 39 AÑOS" },
  'hero.title': { en: "Join free.", es: "Únete gratis." },
  'hero.kicker': { en: "We saved you a seat.", es: "Te guardamos un lugar." },
  'hero.kickerFrom': { en: "{from} saved you a seat.", es: "{from} te guardó un lugar." },
  'hero.invited': { en: "{from} invited you", es: "{from} te invitó" },
  'hero.invitedAnon': { en: "A friend invited you", es: "Alguien te invitó" },
  'hero.r1': { en: "Under a minute", es: "Menos de un minuto" },
  'hero.r2': { en: "3 questions", es: "3 preguntas" },
  'hero.r3': { en: "Money optional", es: "El dinero es opcional" },
  'hero.secondary': { en: "See what you get", es: "Mira lo que te llevas" },
  'hero.receiptsLabel': { en: "Joining at a glance", es: "Unirte, en resumen" },
  'hero.teen': { en: "14 to 17? Here's how it works", es: "¿De 14 a 17? Así funciona" },
  // after joining (journeys-12): the H1 and kicker switch to the joined state
  'hero.joinedTitle': { en: "You're in, {name}.", es: "Ya eres parte, {name}." },
  'hero.joinedKicker': { en: "Your seat's saved.", es: "Tu lugar está guardado." },
  'hero.joinedLead': { en: "Your card is live. Send your link to one person you'd actually text.", es: "Tu tarjeta ya está activa. Manda tu enlace a una persona a la que de verdad le escribirías." },
  'hero.listedTitle': { en: "You're on the list, {name}.", es: "Ya estás en la lista, {name}." },
  'hero.listedKicker': { en: "Thanks for backing us.", es: "Gracias por apoyarnos." },
  'hero.cardCta': { en: "See your card", es: "Ver tu tarjeta" },
  'teaser.title': { en: "15 stickers to collect", es: "15 stickers para coleccionar" },
  'teaser.body': { en: "For showing up, bringing friends and hosting. Never for voting.", es: "Por ir, traer gente y organizar. Nunca por votar." },

  'pass.kind': { en: "MEMBER", es: "MIEMBRO" },
  'pass.name': { en: "Your name", es: "Tu nombre" },
  'pass.county': { en: "Seminole County", es: "Condado de Seminole" },
  'pass.since': { en: "Member since {month}", es: "Miembro desde {month}" },
  'pass.sinceStatic': { en: "Member since Nov 2026", es: "Miembro desde nov. 2026" },
  // 40 and up join the list as supporters, not members (lead, Nov 9, 2026): assets/js/pages/join.js swaps these in.
  'pass.kindSupporter': { en: "SUPPORTER", es: "SIMPATIZANTE" },
  'pass.sinceSupporter': { en: "Supporter since {month}", es: "Simpatizante desde {month}" },
  'pass.stamp': { en: "You're in", es: "Ya eres parte" },
  'pass.slots': { en: "0 of 15 stickers", es: "0 de 15 stickers" },
  'pass.slotsN': { en: "{n} of 15 stickers", es: "{n} de 15 stickers" },

  // join.html?e=<eventId> (journeys-13): the event this "I'm in" link was for
  'event.kicker': { en: "SAVE YOUR SEAT", es: "GUARDA TU LUGAR" },
  'event.loading': { en: "Getting your invite ready.", es: "Preparando tu invitación." },
  'event.lead': { en: "You came for this one. Tap I'm in to save your seat. Joining is optional.", es: "Viniste por este. Toca Me apunto para guardar tu lugar. Unirte es opcional." },
  'event.leadMember': { en: "You're a member, so the sheet fills itself in. One tap.", es: "Ya eres miembro, así que el formulario se llena solo. Un toque." },
  'event.past': { en: "That one already happened. Here's what's coming up instead.", es: "Ese ya pasó. Mira lo que viene." },
  'event.missing': { en: "We couldn't find that event. It may have moved.", es: "No encontramos ese evento. Puede que haya cambiado." },
  'event.all': { en: "See what's on", es: "Mira qué hay" },
  'event.details': { en: "Event details", es: "Detalles del evento" },
  'event.afterJoin': { en: "Save my seat at {event}", es: "Guárdame un lugar en {event}" },

  'consent.before': { en: "By joining, you'll get updates from YDSC. We never sell your info. See our", es: "Al unirte, recibirás novedades de YDSC. Nunca vendemos tus datos. Consulta nuestra" },
  'consent.link': { en: "Privacy Policy", es: "Política de privacidad" },

  // make it yours (step two, below the hero after joining: journeys-11, journeys-12)
  'more.eyebrow': { en: "ONE MORE STEP", es: "UN PASO MÁS" },

  // what you get (genz-brand-21, right-wing-rewards-hidden)
  'get.eyebrow': { en: "WHAT YOU GET", es: "LO QUE TE LLEVAS" },
  'get.title': { en: "A card, a link, a sticker book.", es: "Una tarjeta, un enlace y un álbum de stickers." },
  'get.sub': { en: "Free the moment you join. Your link gives you credit when friends join. Stickers are for showing up and bringing friends, never for voting.", es: "Gratis desde que te unes. Tu enlace te da crédito cuando alguien se une. Los stickers son por ir y por traer gente, nunca por votar." },
  'card.lockedCta': { en: "Join to get yours", es: "Únete y es tuya" },
  'card.lockedNote': { en: "Preview. Your card shows up here once you join.", es: "Vista previa. Tu tarjeta aparece aquí cuando te unes." },
  'pack.title': { en: "The county sticker pack", es: "El paquete de stickers del condado" },
  'pack.body': { en: "Die-cut stickers drawn from Seminole: celery, a gator, SunRail, an Oviedo chicken, a manatee, a Wekiva kayak and more. Tap one for a local fact.", es: "Stickers troquelados inspirados en Seminole: apio, un caimán, SunRail, una gallina de Oviedo, un manatí, un kayak en Wekiva y más. Toca uno para ver un dato local." },
  'pack.cta': { en: "Download the pack (PNG)", es: "Descargar el paquete (PNG)" },
  'pack.locked': { en: "Unlocks when you join. It's free.", es: "Se desbloquea al unirte. Es gratis." },
  'pack.done': { en: "Sticker pack saved.", es: "Paquete de stickers guardado." },
  'pack.file': { en: "young-dems-sticker-pack.png", es: "young-dems-paquete-de-stickers.png" },
  // the squad meter, honestly (journeys-06): it counts joins credited to your code in this browser's join log
  'squad.title': { en: "Try the squad meter (DEMO)", es: "Prueba el medidor de tu grupo (DEMO)" },
  'squad.body': { en: "In this demo, the meter counts friends who joined with your link in this browser. To watch it move on one phone:", es: "En esta demo, el medidor cuenta a las personas que se unieron con tu enlace en este navegador. Para verlo moverse en un solo teléfono:" },
  'squad.s1': { en: "Open your link.", es: "Abre tu enlace." },
  'squad.s2': { en: "Tap “Not {name}? Start over” and join as a friend.", es: "Toca “¿No eres {name}? Empezar de nuevo” y únete como otra persona." },
  'squad.s3': { en: "Tap “Back to {name}”. One of 3.", es: "Toca “Volver a {name}”. Uno de 3." },
  'squad.open': { en: "Open my link", es: "Abrir mi enlace" },
  'squad.live': { en: "On the live site, friends who join from any phone count.", es: "En el sitio real, cuenta cualquier persona que se una desde cualquier teléfono." },

  // 14 to 17 (right-wing-teen-path, join part)
  'teen.eyebrow': { en: "UNDER 18?", es: "¿MENOS DE 18?" },
  'teen.title': { en: "14 to 17? Here's how it works.", es: "¿De 14 a 17? Así funciona." },
  'teen.sub': { en: "Same club, same short form, a few extra protections. Join free from 14.", es: "El mismo club, el mismo formulario corto y unas protecciones extra. Te unes gratis desde los 14." },
  'teen.code.t': { en: "Your link skips your name", es: "Tu enlace no lleva tu nombre" },
  'teen.code.p': { en: "Under 18, your invite link gets a random code, never your first name.", es: "Si tienes menos de 18, tu enlace de invitación lleva un código al azar, nunca tu nombre." },
  'teen.texts.t': { en: "Email, not texts", es: "Correo, no mensajes de texto" },
  'teen.texts.p': { en: "No club texts before 18. No adult organizer messages you one-on-one: group chats always have two adults.", es: "Sin mensajes de texto del club antes de los 18. Ningún organizador adulto te escribe a solas: los chats de grupo siempre tienen dos personas adultas." },
  'teen.guardian.t': { en: "A grown-up's OK when it matters", es: "El permiso de una persona adulta cuando importa" },
  'teen.guardian.p': { en: "A parent or guardian says yes first for anything off-site, after dark or at a rally, and before we post a photo or clip where you can be recognized.", es: "Tu madre, padre o tutor dice que sí antes de cualquier actividad fuera del local, de noche o en una marcha, y antes de publicar una foto o clip donde se te reconozca." },
  'teen.vote.t': { en: "Pre-register at 16", es: "Preinscríbete a los 16" },
  'teen.vote.p': { en: "Florida lets you pre-register to vote on or after your 16th birthday. That step is yours: no stickers, points or prizes for it, ever.", es: "Florida te deja preinscribirte para votar desde el día en que cumples 16. Ese paso es tuyo: nunca damos stickers, puntos ni premios por eso." },
  'teen.vote.cta': { en: "How pre-registering works", es: "Cómo funciona la preinscripción" },
  'teen.parents': { en: "For parents and guardians: our teen safety rules", es: "Para madres, padres y tutores: nuestras reglas de seguridad" },
  'teen.source': { en: "Pre-registration at 16:", es: "Preinscripción a los 16:" },
  'teen.sourceLink': { en: "F.S. 97.041(1)(b)", es: "F.S. 97.041(1)(b)" },
  'teen.join': { en: "Join free", es: "Únete gratis" },

  'tiers.eyebrow': { en: "MEMBERSHIP", es: "MEMBRESÍA" },
  'tiers.title': { en: "$20 a year. Or free.", es: "$20 al año. O gratis." },
  'tier1.name': { en: "Come to things", es: "Ven a lo que quieras" },
  'tier1.what': { en: "Join the list, come to every event, make cards, post clips.", es: "Únete a la lista, ven a todos los eventos, haz tarjetas y sube clips." },
  'tier1.l1': { en: "The Thursday Letter, once a week", es: "La Carta del Jueves, una vez por semana" },
  'tier1.l2': { en: "Events are open to any party or none", es: "Eventos abiertos a cualquier partido o a ninguno" },
  'tier2.name': { en: "Voting member", es: "Miembro con voto" },
  'tier2.per': { en: "a year, due in January", es: "al año, se paga en enero" },
  'tier2.what': { en: "Vote and make motions at chapter meetings.", es: "Vota y presenta mociones en las reuniones del capítulo." },
  'tier2.cta': { en: "Pay dues on ActBlue", es: "Paga la cuota en ActBlue" },
  'tier3.name': { en: "Non-voting member", es: "Miembro sin voto" },
  'tier3.what': { en: "For anyone who qualifies but can't pay dues, whatever the reason, money or citizenship status.", es: "Para quien cumple los requisitos pero no puede pagar la cuota, sea cual sea la razón: dinero o situación de ciudadanía." },
  'tier3.l1': { en: "No dues, no questions asked", es: "Sin cuota y sin preguntas" },
  'tiers.source': { en: "From YDSC's dues page on ActBlue, checked Nov 9, 2026.", es: "Según la página de cuotas de YDSC en ActBlue, revisada el 9 de noviembre de 2026." },
  'tiers.sourceLink': { en: "See the dues page", es: "Ver la página de cuotas" },

  'next.eyebrow': { en: "AFTER YOU JOIN", es: "DESPUÉS DE UNIRTE" },
  'next.title': { en: "What happens next", es: "Qué sigue" },
  'next.s1.title': { en: "We say hi.", es: "Te saludamos." },
  'next.s1.body': { en: "A short welcome in English or Spanish, your pick. No quiz, no homework.", es: "Una bienvenida corta, en inglés o en español, como prefieras. Sin examen y sin tarea." },
  'next.s2.title': { en: "We invite you to one thing near you.", es: "Te invitamos a algo cerca de ti." },
  'next.s2.body': { en: "A trivia night, a sunset walk, a text bank. Bring a friend so you're not the only new person.", es: "Una noche de trivia, una caminata al atardecer, una jornada de mensajes. Trae a alguien para no ser la única persona nueva." },
  'next.s3.title': { en: "We only send what you asked for.", es: "Solo te mandamos lo que pediste." },
  'next.s3.body': { en: "One letter a week, on Thursdays. Texts only if you tick the box.", es: "Una carta por semana, los jueves. Mensajes de texto solo si marcas la casilla." },
  'next.sticker': { en: "first time? perfect", es: "¿primera vez? perfecto" },
  'next.shareLead': { en: "Know someone who'd come with you? Send them this page.", es: "¿Conoces a alguien que vendría contigo? Mándale esta página." },

  'chip.title': { en: "Got $5 to spare?", es: "¿Te sobran $5?" },
  'chip.body': { en: "That's coffee for one volunteer night. Don't have it? Come anyway.", es: "Eso es el café de una noche de voluntariado. ¿No los tienes? Ven de todos modos." },
  'chip.cta': { en: "Chip in $5", es: "Aporta $5" },

  // joinform.js strings (joinform.js keeps a fallback for the core subset)
  'form.contactHint': { en: "One is enough. For your invites and the Thursday Letter, never more than once a week.", es: "Con uno basta. Para tus invitaciones y la Carta del Jueves, nunca más de una vez por semana." },
  'done.title': { en: "You're in, {name}.", es: "Ya eres parte, {name}." },
  'done.already': { en: "You're already in, {name}.", es: "Ya eres parte, {name}." },
  'done.listed': { en: "You're on the list, {name}.", es: "Ya estás en la lista, {name}." },
  'done.live': { en: "Your card is live.", es: "Tu tarjeta ya está activa." },
  'done.back': { en: "Welcome back.", es: "Qué bueno verte otra vez." },
  'done.reset': { en: "Not {name}? Start over", es: "¿No eres {name}? Empezar de nuevo" },
  'done.resetAsk': { en: "Start over on this phone? {name}'s card, stickers and RSVPs leave this browser. {name}'s join stays on the list.", es: "¿Empezar de nuevo en este teléfono? La tarjeta, los stickers y las confirmaciones de {name} salen de este navegador. Su registro se queda en la lista." },
  'done.resetYes': { en: "Start over", es: "Empezar de nuevo" },
  'done.resetNo': { en: "Keep {name}", es: "Seguir como {name}" },
  'done.switchLabel': { en: "Joined on this phone before:", es: "Ya se unieron en este teléfono:" },
  'done.switch': { en: "Back to {name}", es: "Volver a {name}" },
  'done.resumed': { en: "Back to {name}. Friends who joined with this link here: {count} of 3.", es: "De vuelta, {name}. Personas que se unieron con este enlace aquí: {count} de 3." },
  'done.card': { en: "See your card", es: "Ver tu tarjeta" },
  'done.more': { en: "Pick your city and issues", es: "Elige tu ciudad y tus temas" },
  'done.moreFull': { en: "Pick your city and crew", es: "Elige tu ciudad y tu grupo" },
  'step2.title': { en: "Make it yours", es: "Hazlo tuyo" },
  'step2.sub': { en: "All optional. Skip anything, change it anytime.", es: "Todo es opcional. Sáltate lo que quieras y cámbialo cuando quieras." },
  'step2.issues': { en: "What do you care about? Pick any.", es: "¿Qué te importa? Elige los que quieras." },
  'step2.save': { en: "Save my picks", es: "Guardar mis opciones" },
  'step2.saved': { en: "Saved. We'll only send what matches.", es: "Guardado. Solo te mandamos lo que coincida." },
  'step2.summary': { en: "Your picks", es: "Lo que elegiste" },
  'step2.none': { en: "Nothing picked yet.", es: "Todavía no elegiste nada." },
  'prefill.note': { en: "Filled in from your RSVP on this phone.", es: "Lo llenamos con tu confirmación en este teléfono." },
  'prefill.clear': { en: "Clear", es: "Borrar" },
  'intent.label': { en: "I want to…", es: "Quiero…" },
  'intent.hint': { en: "Pick any. It tells us what to send you first.", es: "Elige lo que quieras. Así sabemos qué mandarte primero." },
  'crews.label': { en: "Find your crew (DEMO)", es: "Encuentra tu grupo (DEMO)" },
  'crews.hint': { en: "Crews are DEMO ideas waiting for a host. Pick any and we'll tell you when one starts. Only the chapter sees this: never your card, never your link.", es: "Los grupos son ideas DEMO que esperan a alguien que los organice. Elige los que quieras y te avisamos cuando empiece uno. Solo lo ve el capítulo: nunca tu tarjeta ni tu enlace." },
  'crews.city': { en: "Your city crew: {crew} (DEMO, needs a host)", es: "Tu grupo de la ciudad: {crew} (DEMO, busca anfitrión)" },
  'crews.cityStart': { en: "Your city crew: {crew} (DEMO). You'd be starting it.", es: "Tu grupo de la ciudad: {crew} (DEMO). Lo empezarías tú." },
  'mc.title': { en: "Your invite link", es: "Tu enlace de invitación" },
  'mc.since': { en: "Member since {month}", es: "Miembro desde {month}" },
  'mc.showName': { en: "Show my first name on my link", es: "Mostrar mi nombre en mi enlace" },
  'mc.squad': { en: "Friends who joined with your link: {count} of 3. Three friends, not 300.", es: "Personas que se unieron con tu enlace: {count} de 3. Tres, no 300." },
  'mc.squadHint': { en: "DEMO: this counts friends who joined with your link in this browser.", es: "DEMO: esto cuenta a quienes se unieron con tu enlace en este navegador." }
};

/*
 * joinPicks: step-two choices (joinform.js). Ids are stable and travel in the join payload:
 *   intent  comma list of intents[].id ('host,volunteer')
 *   crew    the crew someone wants to start (?intent=crew&crew=<id>): a crews[].id or a cityCrews key
 *   crews   comma list of crews[].id someone wants to hear about
 * The city crew names and ids mirror about.html's city crews (G-ABOUT); keep them in sync. aliases maps other
 * spellings a link might use to an id here. Every crew is DEMO: an idea waiting for a host, first hangout in a
 * public place (teen safety rules).
 */
window.YSD_DATA.joinPicks = {
  intents: [
    { id: 'host',
      label: { en: "Host a night", es: "Organizar una noche" },
      title: { en: "Hosting starts here.", es: "Organizar empieza aquí." },
      check: { en: "I want to host a night", es: "Quiero organizar una noche" },
      note: { en: "Join first. We'll reply within 3 days with the host kit and a date that works (DEMO promise).", es: "Únete primero. Te respondemos en 3 días con el kit para organizar y una fecha que te sirva (promesa DEMO)." } },
    { id: 'crew',
      label: { en: "Start a crew", es: "Empezar un grupo" },
      title: { en: "Let's start your crew.", es: "Empecemos tu grupo." },
      titleNamed: { en: "Let's get {crew} going.", es: "Pongamos en marcha {crew}." },
      check: { en: "I want to start a crew", es: "Quiero empezar un grupo" },
      checkNamed: { en: "I want to start {crew} (DEMO)", es: "Quiero empezar {crew} (DEMO)" },
      note: { en: "Join first. We'll help you plan the first hangout in a public place and reply within 3 days (DEMO promise).", es: "Únete primero. Te ayudamos a planear el primer encuentro en un lugar público y te respondemos en 3 días (promesa DEMO)." } },
    { id: 'role',
      label: { en: "Hear about chapter roles", es: "Saber de los cargos del capítulo" },
      title: { en: "Curious about a role? Good.", es: "¿Te llama un cargo? Bien." },
      check: { en: "I'm curious about a chapter role", es: "Me interesa un cargo del capítulo" },
      note: { en: "Join first. We'll send you what the open roles involve. No pressure, no speech required (DEMO).", es: "Únete primero. Te mandamos lo que implica cada cargo abierto. Sin presión y sin discursos (DEMO)." } },
    { id: 'volunteer',
      label: { en: "Volunteer at events", es: "Ser voluntario en eventos" },
      title: { en: "Volunteers make the night happen.", es: "Gracias a quien ayuda, la noche sale bien." },
      check: { en: "I want to volunteer at events", es: "Quiero ser voluntario en eventos" },
      note: { en: "Join first. We'll send you the next shift near you. Two hours is plenty.", es: "Únete primero. Te mandamos el próximo turno cerca de ti. Dos horas bastan." } }
  ],
  crews: [
    { id: 'students', color: 'sky', name: { en: "Student crew", es: "Grupo de estudiantes" }, sub: { en: "High school, Seminole State, UCF or anywhere", es: "Secundaria, Seminole State, UCF o donde sea" } },
    { id: 'latine', color: 'tangerine', name: { en: "Latine and Boricua crew", es: "Grupo latino y boricua" }, sub: { en: "Spanish first, Spanglish welcome", es: "En español primero, spanglish bienvenido" } },
    { id: 'lgbtq', color: 'bubblegum', name: { en: "LGBTQ+ crew", es: "Grupo LGBTQ+" }, sub: { en: "Queer, trans, questioning and friends", es: "Queer, trans, en duda y amistades" } },
    { id: 'parents', color: 'sun', name: { en: "Young parents", es: "Madres y padres jóvenes" }, sub: { en: "Kids welcome, daytime plans", es: "Niños bienvenidos, planes de día" } },
    { id: 'shift', color: 'mint', name: { en: "Shift workers", es: "Trabajo por turnos" }, sub: { en: "Service, retail and hospitality: late starts, weekend plans", es: "Servicio, tiendas y hostelería: planes tarde y de fin de semana" } },
    { id: 'disability', color: 'teal', name: { en: "Disability caucus", es: "Grupo de personas con discapacidad" }, sub: { en: "Access first, plans made with you", es: "Accesibilidad primero, planes hechos contigo" } },
    { id: 'faith', color: 'violet', name: { en: "Faith crew", es: "Grupo de fe" }, sub: { en: "Any faith, or still figuring it out", es: "Cualquier fe, o todavía buscando" } }
  ],
  cityCrews: {
    sanford: { name: "Celery City Crew", city: 'sanford' },
    sunrail: { name: "SunRail Regulars", city: 'lake-mary' },
    chuluota: { name: "Chuluota Pavilion Club", city: 'seminole' },
    oviedo: { name: "The Chicken Crossing", city: 'oviedo' },
    wsprings: { name: "Lake Jesup Lookouts", city: 'winter-springs' },
    altamonte: { name: "Altamonte Weeknighters", city: 'altamonte-springs' },
    cassel: { name: "The Casselberry Table", city: 'casselberry' }
  },
  // step-two city id -> its city crew
  cityToCrew: { sanford: 'sanford', 'lake-mary': 'sunrail', longwood: 'sunrail', oviedo: 'oviedo', 'winter-springs': 'wsprings', 'altamonte-springs': 'altamonte', casselberry: 'cassel', seminole: 'chuluota' },
  aliases: {
    student: 'students', ucf: 'students', 'seminole-state': 'students', latino: 'latine', latina: 'latine', latinx: 'latine', boricua: 'latine',
    'latino-boricua': 'latine', queer: 'lgbtq', 'lgbtq-plus': 'lgbtq', lgbt: 'lgbtq', 'young-parents': 'parents', parent: 'parents',
    'shift-workers': 'shift', service: 'shift', hospitality: 'shift', disabled: 'disability', access: 'disability', 'disability-caucus': 'disability',
    'celery-city': 'sanford', 'lake-mary': 'sunrail', longwood: 'sunrail', 'winter-springs': 'wsprings', altamonte: 'altamonte',
    'altamonte-springs': 'altamonte', casselberry: 'cassel', 'east-seminole': 'chuluota'
  }
};
