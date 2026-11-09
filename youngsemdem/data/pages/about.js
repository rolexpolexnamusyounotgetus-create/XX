/*!
 * data/pages/about.js: page copy for about.html and 404.html (W7), EN + ES.   STATUS: DRAFT
 *
 * Two namespaces: YSD_DATA.pages.about (data-t="about:key") and YSD_DATA.pages.notFound
 * (data-t="notFound:key"). Plain text only; render with textContent.
 *
 * Facts used here, and where they come from (checked Mon, Nov 9, 2026):
 *   - ages 14 to 39, $20 a year paid in January, non-voting membership for people who can't pay
 *     (money or citizenship status): YDSC dues page, https://secure.actblue.com/donate/ydscdues
 *     (data/team.js facts[], BRIEF 9)
 *   - YDSC is a chapter of the Florida Young Democrats: data/strings.js brand.chapterOf (FYD chapter
 *     list, confidence med; recheck by Apr 1, 2027)
 *   - what the chapter is for (raise young voter turnout, advocate on youth issues, support Democrats
 *     in Seminole): YDSC ActBlue page (config links.actblue), paraphrased (docs/research/01)
 *   - the musical theatre night: data/issues.js (ActBlue ydscmusicaltheatre; no year is claimed)
 *   - Celery City, SunRail's four stations: data/stickers.js facts and sources
 *   - trivia night (Thu, Nov 19, 7 pm, Casselberry, 31 going) and Dani the letter writer: DEMO items
 *     from data/events.js and data/newsletter.js, used here only as examples of DEMO content
 * Everything else on the page (team, crews, counts) is DEMO and says so.
 * Crew names are DEMO ideas (BRIEF 4.9), shown as invitations and never ranked.
 * Checker, Nov 9: 'do.sub' no longer calls the three jobs the chapter's own words (the bodies add detail);
 * 404 source labels get Spanish values; an eighth open crew card invites people to start one.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};

window.YSD_DATA.pages.about = {
  // ---- head
  'seo.title': { en: 'About · Young Democrats of Seminole County', es: 'Quiénes somos · Young Democrats of Seminole County' },
  'og.kicker': { en: 'ABOUT US', es: 'QUIÉNES SOMOS' },
  'og.alt': { en: 'Who the Young Dems are. Young Democrats of Seminole County, ages 14 to 39. DEMO preview.', es: 'Quiénes son los Young Dems. Young Democrats of Seminole County, de 14 a 39 años. Vista previa DEMO.' },

  // ---- hero
  'hero.eyebrow': { en: 'ABOUT · AGES 14 TO 39', es: 'QUIÉNES SOMOS · DE 14 A 39' },
  'hero.line1': { en: "Hi. We're the", es: 'Hola. Somos los' },
  'hero.sub': {
    en: 'The Young Democrats of Seminole County, for anyone 14 to 39. Free hangouts, straight answers about voting, and a seat saved for your friend.',
    es: 'Los Young Democrats of Seminole County, para cualquier persona de 14 a 39 años. Planes gratis, respuestas claras sobre cómo votar y un lugar guardado para quien traigas.'
  },
  'hero.real': { en: "What's real?", es: '¿Qué es real?' },

  // ---- the basics card (all REAL, each row links its source)
  'basics.title': { en: 'The basics', es: 'Lo básico' },
  'basics.who': { en: 'Who', es: 'Quién' },
  'basics.whoV': { en: 'Anyone 14 to 39', es: 'Cualquier persona de 14 a 39' },
  'basics.cost': { en: 'Cost', es: 'Costo' },
  'basics.costV': { en: "$20 a year. Can't pay? You're still in.", es: '$20 al año. ¿No puedes pagar? Igual entras.' },
  'basics.part': { en: 'Part of', es: 'Parte de' },
  'basics.party': { en: 'County party', es: 'Partido del condado' },
  'basics.src': { en: "Checked against the chapter's dues page and the state chapter list on Nov 9, 2026.", es: 'Verificado con la página de cuotas del capítulo y la lista estatal de capítulos el 9 de nov. de 2026.' },
  'basics.duesAria': { en: "Source: the chapter's dues page on ActBlue", es: 'Fuente: la página de cuotas del capítulo en ActBlue' },

  // ---- what we do
  'do.eyebrow': { en: 'WHAT WE DO', es: 'QUÉ HACEMOS' },
  'do.title': { en: 'Three jobs. All local.', es: 'Tres tareas. Todas locales.' },
  'do.sub': { en: "The chapter's ActBlue page names three goals. Here's each one, and what it looks like here.", es: 'La página de ActBlue del capítulo nombra tres metas. Aquí va cada una y cómo se ve en este sitio.' },
  'do.1.title': { en: 'Get young people voting', es: 'Que la gente joven vote' },
  'do.1.body': { en: 'Straight answers on registering, mail ballots and what changes in 2027, with official links only.', es: 'Respuestas claras sobre cómo inscribirte, la boleta por correo y lo que cambia en 2027, solo con enlaces oficiales.' },
  'do.2.title': { en: "Speak up on what we're living", es: 'Alzar la voz sobre lo que vivimos' },
  'do.2.body': { en: "Rent, getting around, school, climate, rights. We bring young people's issues to the people making decisions in Seminole.", es: 'La renta, el transporte, la escuela, el clima, los derechos. Llevamos los temas de la gente joven a quienes toman decisiones en Seminole.' },
  'do.3.title': { en: 'Back Democrats here at home', es: 'Apoyar a los demócratas aquí en casa' },
  'do.3.body': { en: 'From city halls to the statehouse, we help Democrats in Seminole County win, and we have a good time doing it.', es: 'Desde los ayuntamientos hasta el capitolio estatal, ayudamos a que ganen los demócratas del condado de Seminole, y la pasamos bien haciéndolo.' },
  'do.src': { en: "Source: the chapter's ActBlue page", es: 'Fuente: la página de ActBlue del capítulo' },

  // ---- where we fit
  'tree.title': { en: 'Where we fit', es: 'Dónde encajamos' },
  'tree.state': { en: 'State', es: 'Estado' },
  'tree.us': { en: "That's us", es: 'Somos nosotros' },
  'tree.county': { en: 'County party', es: 'Partido del condado' },
  'tree.note': { en: "Neither of them has approved this preview yet.", es: 'Ninguno de los dos ha aprobado todavía esta vista previa.' },

  // ---- a real thing
  'proof.title': { en: 'A real thing YDSC did', es: 'Algo real que hizo YDSC' },
  'proof.body': { en: 'YDSC has hosted a musical theatre night in Oviedo to raise money for a local charity that supports LGBTQ+ youth.', es: 'YDSC organizó una noche de teatro musical en Oviedo a beneficio de una organización local que apoya a jóvenes LGBTQ+.' },
  'proof.src': { en: "Source: the chapter's ActBlue page for the night", es: 'Fuente: la página de ActBlue de esa noche' },
  'photo.alt': { en: 'Two people watching the sunset over a calm lake from a waterfront path', es: 'Dos personas mirando el atardecer sobre un lago tranquilo desde un camino junto al agua' },

  // ---- what's real
  'real.eyebrow': { en: 'THE HONEST PART', es: 'LA PARTE HONESTA' },
  'real.title': { en: "What's real?", es: '¿Qué es real?' },
  'real.sub': {
    en: "This site is a demo, built to show the chapter what its website could be. Some of it is checked fact. A lot of it is made up on purpose so you can see how things would work. Here's exactly which is which.",
    es: 'Este sitio es una demo, hecha para mostrarle al capítulo cómo podría ser su sitio web. Una parte son datos verificados. Mucho está inventado a propósito para que veas cómo funcionaría todo. Aquí te decimos exactamente qué es qué.'
  },
  'legend.title': { en: 'How to read the tags', es: 'Cómo leer las etiquetas' },
  'legend.real': { en: 'Checked against a source, with the date.', es: 'Verificado con una fuente, con la fecha.' },
  'legend.demo': { en: 'Made up for this preview.', es: 'Inventado para esta vista previa.' },
  'legend.draftTag': { en: 'DRAFT', es: 'BORRADOR' },
  'legend.draft': { en: 'Written, but not approved or in effect yet.', es: 'Escrito, pero todavía no aprobado ni vigente.' },
  'legend.stock': { en: 'Models, not members.', es: 'Modelos, no miembros.' },
  'col.real': { en: 'Real', es: 'Real' },
  'col.demo': { en: 'Made up', es: 'Inventado' },
  'col.open': { en: 'Not decided yet', es: 'Todavía sin decidir' },
  'r.1': { en: 'Voting rules, deadlines, dates and official links, checked Nov 9, 2026.', es: 'Las reglas para votar, las fechas límite, las fechas y los enlaces oficiales, verificados el 9 de nov. de 2026.' },
  'r.2': { en: "Membership rules from the chapter's dues page: ages 14 to 39, $20 a year paid in January, and a non-voting membership for people who can't pay.", es: 'Las reglas de membresía de la página de cuotas del capítulo: de 14 a 39 años, $20 al año que se pagan en enero y una membresía sin voto para quienes no pueden pagar.' },
  'r.3': { en: 'The chapter itself. YDSC is real, and the Florida Young Democrats list it as a chapter.', es: 'El capítulo en sí. YDSC es real, y los Florida Young Democrats lo tienen en su lista de capítulos.' },
  'r.4': { en: 'Numbers with a source link next to them. Election results stay marked unofficial until the county certifies them.', es: 'Los números que tienen un enlace a su fuente. Los resultados electorales siguen marcados como no oficiales hasta que el condado los certifique.' },
  'r.5': { en: 'Every sticker fact. Tap a sticker and you get its source.', es: 'Cada dato de los stickers. Toca un sticker y te sale su fuente.' },
  'r.6': { en: 'Links to the county party, the elections office and ActBlue.', es: 'Los enlaces al partido del condado, a la oficina electoral y a ActBlue.' },
  'd.1': { en: 'Every event: dates, venues, hosts and how many are going.', es: 'Cada evento: fechas, lugares, anfitriones y cuántas personas van.' },
  'd.2': { en: "Every person: names, bylines, quotes, the team below and The Thursday Letter's writer.", es: 'Cada persona: nombres, firmas, citas, el equipo de abajo y quien escribe La Carta del Jueves.' },
  'd.3': { en: 'Every clip, and every @demo handle.', es: 'Cada clip y cada usuario @demo.' },
  'd.4': { en: 'Counters and squad numbers. They never tick up by themselves, and each one says DEMO.', es: 'Los contadores y los números de grupos. Nunca suben solos, y cada uno dice DEMO.' },
  'd.5': { en: "City crews. They're ideas waiting for a host, not groups that meet yet.", es: 'Los grupos por ciudad. Son ideas que esperan a alguien que los organice, todavía no se reúnen.' },
  'd.6': { en: 'Forms. Nothing you type leaves your browser.', es: 'Los formularios. Nada de lo que escribes sale de tu navegador.' },
  'n.1': { en: 'The policies (privacy, teen safety, clip rules, conduct, accessibility) are drafts, not legal advice, and not in effect.', es: 'Las políticas (privacidad, seguridad para adolescentes, reglas para clips, conducta, accesibilidad) son borradores, no son asesoría legal y no están vigentes.' },
  'n.2': { en: "The chapter hasn't signed off on this site yet.", es: 'El capítulo todavía no ha aprobado este sitio.' },
  'n.3': { en: 'The "Paid for by" line in the footer is a placeholder until the chapter settles its committee status.', es: 'La línea “Pagado por” del pie de página es provisional hasta que el capítulo defina su estatus de comité.' },
  'n.4': { en: 'The Spanish is written by hand and still waiting for a fluent reviewer.', es: 'El español está escrito a mano y todavía espera la revisión de una persona hablante nativa.' },
  'n.5': { en: "Social accounts stay unlinked until the chapter confirms them, and youngsemdems.com isn't live.", es: 'Las cuentas de redes no se enlazan hasta que el capítulo las confirme, y youngsemdems.com no está activo.' },
  'n.6': { en: "Who moderates clips, who's on the safety team, and whether the chapter publishes its money. We don't promise any of it until the chapter does.", es: 'Quién modera los clips, quién está en el equipo de seguridad y si el capítulo publica sus cuentas. No prometemos nada de eso hasta que el capítulo lo haga.' },
  'n.7': { en: 'Real photos of real members come later, with everyone’s OK. Until then: stock photos, tagged.', es: 'Las fotos reales de miembros reales vienen después, con el permiso de cada persona. Mientras tanto: fotos de archivo, con su etiqueta.' },
  'real.privacy': { en: 'See what this browser saved about you', es: 'Mira lo que este navegador guardó sobre ti' },

  // ---- real or DEMO toy
  'rd.title': { en: 'Real or DEMO? Test yourself.', es: '¿Real o DEMO? Ponte a prueba.' },
  'rd.sub': { en: "Eight things you'll see on this site. Tap your guess. Your score isn't saved anywhere.", es: 'Ocho cosas que vas a ver en este sitio. Toca tu respuesta. Tu puntaje no se guarda en ningún lado.' },
  'rd.realBtn': { en: 'Real', es: 'Real' },
  'rd.demoBtn': { en: 'DEMO', es: 'DEMO' },
  'rd.group': { en: 'Your guess', es: 'Tu respuesta' },
  'rd.right': { en: 'Got it.', es: 'Correcto.' },
  'rd.wrong': { en: 'Not quite.', es: 'Casi.' },
  'rd.score': { en: '{n} of {total} right so far', es: '{n} de {total} correctas hasta ahora' },
  'rd.final': { en: '{n} of {total} right.', es: '{n} de {total} correctas.' },
  'rd.perfect': { en: 'Perfect score. You read this site better than most of us.', es: 'Puntaje perfecto. Lees este sitio mejor que casi todos nosotros.' },
  'rd.done': { en: 'Done. The trick: look for the tag. If it says DEMO, we made it up.', es: 'Listo. El truco: busca la etiqueta. Si dice DEMO, lo inventamos.' },
  'rd.reset': { en: 'Play again', es: 'Jugar otra vez' },
  'rd.1.q': { en: 'Sanford was called the Celery City by about 1900.', es: 'Hacia 1900 a Sanford ya la llamaban la Ciudad del Apio (Celery City).' },
  'rd.1.why': { en: "Real. Sanford's celery farms made its name.", es: 'Real. Sus cultivos de apio le dieron el nombre.' },
  'rd.1.src': { en: 'Source: UCF RICHES', es: 'Fuente: UCF RICHES' },
  'rd.2.q': { en: 'There’s a trivia night in Casselberry on Thu, Nov 19 at 7 pm.', es: 'Hay una noche de trivia en Casselberry el jueves 19 de noviembre a las 7 p. m.' },
  'rd.2.why': { en: 'DEMO. Made up to show how invites work. Every event here is DEMO for now.', es: 'DEMO. Lo inventamos para mostrar cómo funcionan las invitaciones. Por ahora, cada evento aquí es DEMO.' },
  'rd.3.q': { en: 'You can join the Young Dems at 14.', es: 'Te puedes unir a los Young Dems a los 14.' },
  'rd.3.why': { en: "Real. Members are 14 to 39, per the chapter's dues page.", es: 'Real. Los miembros tienen de 14 a 39 años, según la página de cuotas del capítulo.' },
  'rd.3.src': { en: "Source: the chapter's dues page", es: 'Fuente: la página de cuotas del capítulo' },
  'rd.4.q': { en: 'Dani from Casselberry writes The Thursday Letter.', es: 'Dani, de Casselberry, escribe La Carta del Jueves.' },
  'rd.4.why': { en: "DEMO. Dani is a DEMO writer. Real bylines need real people's OK.", es: 'DEMO. Dani es una autora DEMO. Las firmas reales necesitan el permiso de personas reales.' },
  'rd.5.q': { en: 'SunRail stops at four stations in Seminole County.', es: 'SunRail para en cuatro estaciones del condado de Seminole.' },
  'rd.5.why': { en: 'Real. Altamonte Springs, Longwood, Lake Mary and Sanford.', es: 'Real. Altamonte Springs, Longwood, Lake Mary y Sanford.' },
  'rd.5.src': { en: 'Source: SunRail stations', es: 'Fuente: estaciones de SunRail' },
  'rd.6.q': { en: 'Thirty-one people say they’re going to trivia night.', es: 'Treinta y una personas dicen que van a la noche de trivia.' },
  'rd.6.why': { en: 'DEMO. Every count here is DEMO. Nothing ticks up by itself, and nobody fake joins.', es: 'DEMO. Cada conteo aquí es DEMO. Nada sube solo y nadie se une de mentira.' },
  'rd.7.q': { en: "Can't pay the $20 dues? You can still be a member, just without a vote.", es: '¿No puedes pagar la cuota de $20? Igual puedes ser miembro, solo que sin voto.' },
  'rd.7.why': { en: "Real. The dues page offers non-voting membership to people who can't pay, whether it's money or citizenship status.", es: 'Real. La página de cuotas ofrece membresía sin voto a quienes no pueden pagar, ya sea por dinero o por su situación de ciudadanía.' },
  'rd.7.src': { en: "Source: the chapter's dues page", es: 'Fuente: la página de cuotas del capítulo' },
  'rd.8.q': { en: 'Members filmed the clips in the Reel.', es: 'Los miembros grabaron los clips de la sección Clips.' },
  'rd.8.why': { en: "DEMO. They're demo clips made for this preview, posted under @demo handles.", es: 'DEMO. Son clips de demostración hechos para esta vista previa, con usuarios @demo.' },

  // ---- team (cards render from data/team.js)
  'team.eyebrow': { en: 'THE TEAM · DEMO', es: 'EL EQUIPO · DEMO' },
  'team.title': { en: 'Who runs this thing', es: 'Quiénes organizan esto' },
  'team.sub': { en: "Here's who does what. Every name is a placeholder until the real board says yes to being listed.", es: 'Aquí ves quién hace qué. Cada nombre es de relleno hasta que la directiva real acepte aparecer.' },
  'team.noscript': { en: 'Turn on JavaScript to see the eight team roles.', es: 'Activa JavaScript para ver los ocho puestos del equipo.' },
  'run.eyebrow': { en: 'SEATS OPEN', es: 'PUESTOS ABIERTOS' },
  'run.title': { en: 'Run for a role', es: 'Postúlate para un puesto' },
  'run.elig': { en: 'Who can vote in chapter elections?', es: '¿Quién puede votar en las elecciones del grupo?' },

  // ---- city crews (DEMO)
  'crews.eyebrow': { en: 'CITY CREWS · DEMO', es: 'GRUPOS POR CIUDAD · DEMO' },
  'crews.title': { en: 'Find your corner of the county.', es: 'Encuentra tu rincón del condado.' },
  'crews.sub': { en: 'Crews are small groups by city. These are DEMO ideas waiting for someone to host the first hangout. No rankings, no scoreboards. Just neighbors.', es: 'Los grupos son pequeños y por ciudad. Estas son ideas DEMO que esperan a alguien que organice el primer encuentro. Sin rankings ni marcadores. Solo vecinos.' },
  'crews.status': { en: 'Needs a host', es: 'Busca anfitrión' },
  'crews.demo': { en: 'DEMO crew', es: 'Grupo DEMO' },
  'crews.idea': { en: 'First hangout idea', es: 'Idea para el primer encuentro' },
  'crews.cta': { en: 'Start it with us', es: 'Empiézalo con nosotros' },
  'crew.sanford.where': { en: 'Sanford', es: 'Sanford' },
  'crew.sanford.idea': { en: 'A sunset walk on the Riverwalk, then tacos.', es: 'Una caminata al atardecer por el Riverwalk y luego tacos.' },
  'crew.sunrail.where': { en: 'Lake Mary and Longwood', es: 'Lake Mary y Longwood' },
  'crew.sunrail.idea': { en: 'Meet at the station after work and ride one stop together. Weekdays only, like SunRail.', es: 'Verse en la estación después del trabajo y viajar una parada juntos. Solo entre semana, como SunRail.' },
  'crew.chuluota.where': { en: 'Chuluota and east Seminole', es: 'Chuluota y el este de Seminole' },
  'crew.chuluota.idea': { en: "Lemonade on somebody's porch and a sign-making afternoon.", es: 'Limonada en el porche de alguien y una tarde para hacer carteles.' },
  'crew.oviedo.where': { en: 'Oviedo', es: 'Oviedo' },
  'crew.oviedo.idea': { en: "Coffee downtown and a vote-plan swap. Named for Oviedo's legendary chickens.", es: 'Café en el centro e intercambio de planes para votar. El nombre viene de las legendarias gallinas de Oviedo.' },
  'crew.wsprings.where': { en: 'Winter Springs', es: 'Winter Springs' },
  'crew.wsprings.idea': { en: 'A sunset walk by the lake. Gator-watching from a very safe distance.', es: 'Una caminata al atardecer junto al lago. Para ver caimanes desde muy, muy lejos.' },
  'crew.altamonte.where': { en: 'Altamonte Springs', es: 'Altamonte Springs' },
  'crew.altamonte.idea': { en: "Board games and a what's-on-the-ballot explainer night.", es: 'Juegos de mesa y una noche para explicar qué hay en la boleta.' },
  'crew.cassel.where': { en: 'Casselberry', es: 'Casselberry' },
  'crew.cassel.idea': { en: 'Trivia teams of four. Bring the friend who knows too much.', es: 'Equipos de trivia de cuatro. Trae a la persona que se sabe todo.' },
  'crew.yours.tag': { en: 'OPEN SPOT', es: 'LUGAR LIBRE' },
  'crew.yours.name': { en: 'Your crew here', es: 'Tu grupo aquí' },
  'crew.yours.where': { en: 'Anywhere in Seminole County', es: 'En cualquier parte del condado de Seminole' },
  'crew.yours.idea': { en: "Don't see your corner? Pitch a crew for your neighborhood, your school or your bus stop. We'll help you plan the first hangout.", es: '¿No ves tu rincón? Propón un grupo para tu barrio, tu escuela o tu parada de bus. Te ayudamos a planear el primer encuentro.' },
  'crew.yours.cta': { en: 'Pitch a crew', es: 'Propón un grupo' },

  // ---- house rules
  'rules.eyebrow': { en: 'HOUSE RULES', es: 'REGLAS DE LA CASA' },
  'rules.title': { en: 'Come as you are. Be cool to each other.', es: 'Ven como eres. Trata bien a los demás.' },
  'rules.1': { en: 'Argue about ideas, never attack people.', es: 'Discute ideas, nunca ataques a las personas.' },
  'rules.2': { en: 'No doxxing, and no lists of private people.', es: 'Nada de doxeo ni listas de personas privadas.' },
  'rules.3': { en: "Nobody films or posts a minor without a guardian's OK.", es: 'Nadie graba ni publica a un menor sin el permiso de su tutor.' },
  'rules.cta': { en: 'Read the code of conduct', es: 'Lee el código de conducta' },

  // ---- contact (links.contact is '' today: fall back to the join form)
  'contact.title': { en: 'Want to talk to a real person?', es: '¿Quieres hablar con una persona de verdad?' },
  'contact.body': { en: 'Until the chapter picks a public contact, the join form is the way in.', es: 'Hasta que el capítulo elija un contacto público, el formulario para unirte es la forma de entrar.' },
  'contact.bodySet': { en: 'Questions, ideas, or want to host something? Send the chapter a note.', es: '¿Preguntas, ideas o quieres organizar algo? Escríbele al capítulo.' },
  'contact.cta': { en: 'Message the chapter', es: 'Escríbele al capítulo' },
  'share.lead': { en: 'Know someone who keeps asking what the Young Dems actually do?', es: '¿Conoces a alguien que siempre pregunta qué hacen los Young Dems?' }
};

window.YSD_DATA.pages.notFound = {
  'og.kicker': { en: 'ERROR 404', es: 'ERROR 404' },
  'og.alt': { en: 'This page skipped the meeting. Young Democrats of Seminole County. DEMO preview.', es: 'Esta página no llegó a la reunión. Young Democrats of Seminole County. Vista previa DEMO.' },
  'eyebrow': { en: '404 · PAGE NOT FOUND', es: '404 · PÁGINA NO ENCONTRADA' },
  'toy.title': { en: "While you're here, decorate the laptop.", es: 'Ya que estás aquí, decora la laptop.' },
  'toy.sub': { en: 'Tap the sticker to slap it on. Every one comes with a true Seminole fact.', es: 'Toca el sticker para pegarlo. Cada uno trae un dato real de Seminole.' },
  'toy.btn': { en: 'Slap the {name} sticker on the laptop', es: 'Pega el sticker de {name} en la laptop' },
  'toy.tap': { en: 'tap me', es: 'tócalo' },
  'toy.hint': { en: 'Tap the sticker. Facts come out.', es: 'Toca el sticker. Salen datos.' },
  'toy.count': { en: '{n} of {total} stickers found', es: '{n} de {total} stickers encontrados' },
  'toy.done': { en: 'All 10. You know Seminole better than most of us.', es: 'Los 10. Conoces Seminole mejor que casi todos nosotros.' },
  'toy.again': { en: 'Peel them all off', es: 'Despegarlos todos' },
  'toy.source': { en: 'Source: {label}', es: 'Fuente: {label}' },
  // Spanish source labels for data/stickers.js items (its source.label is English only); English pages use the file's label.
  'toy.src.train': { en: 'SunRail stations', es: 'estaciones de SunRail' },
  'toy.src.sun': { en: 'Florida Constitution, Art. X §24', es: 'Constitución de Florida, art. X §24 (en inglés)' },
  'toy.src.heart': { en: 'Code of conduct', es: 'Código de conducta' },
  'toy.src.calendar': { en: 'Events', es: 'Eventos' },
  'toy.src.camera': { en: 'CDC: Disability Impacts All of Us', es: 'CDC: La discapacidad nos afecta a todos (en inglés)' },
  'toy.src.gator': { en: 'Wikipedia: Lake Jesup', es: 'Wikipedia: lago Jesup (en inglés)' },
  'toy.src.chicken': { en: 'Wikipedia: Oviedo', es: 'Wikipedia: Oviedo (en inglés)' },
  'toy.src.cypress': { en: 'Wikipedia: The Senator', es: 'Wikipedia: The Senator (en inglés)' },
  'toy.src.celery': { en: 'UCF RICHES', es: 'UCF RICHES (en inglés)' },
  'toy.src.envelope': { en: 'F.S. 101.62', es: 'Ley de Florida 101.62 (en inglés)' },
  'toy.lid': { en: 'A laptop lid covered in the stickers you found', es: 'La tapa de una laptop cubierta con los stickers que encontraste' },
  'go.home': { en: 'Start from the top.', es: 'Empieza desde el principio.' },
  'go.events': { en: 'Free hangouts all over Seminole.', es: 'Planes gratis por todo Seminole.' },
  'go.vote': { en: 'Your 2027 voting checklist.', es: 'Tu lista para votar en 2027.' },
  'go.join': { en: 'Free, for anyone 14 to 39.', es: 'Gratis, para cualquier persona de 14 a 39.' },
  'share.cta': { en: 'Send the group chat a link that works', es: 'Manda al grupo un enlace que sí funcione' },
  'share.text': { en: 'That link was broken, so here’s the real one: the Young Dems in Seminole. Free hangouts and straight answers about voting.', es: 'Ese enlace no servía, así que aquí va el bueno: los Young Dems de Seminole. Planes gratis y respuestas claras sobre cómo votar.' },
  'share.title': { en: 'Young Democrats of Seminole County', es: 'Young Democrats of Seminole County' }
};
