/*!
 * data/pages/about.js: page copy for about.html and 404.html (W7; G-ABOUT round 1, Nov 10, 2026), EN + ES.
 * STATUS: DRAFT
 *
 * Two namespaces: YSD_DATA.pages.about (data-t="about:key") and YSD_DATA.pages.notFound
 * (data-t="notFound:key"). Plain text only; render with textContent.
 *
 * Facts used here, and where they come from (checked Mon, Nov 9, 2026 unless noted):
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
 *   - crew map landmarks (checked Tue, Nov 10, 2026; all public parks or stations): Sanford Riverwalk
 *     (docs/research/01 §7); Lake Mary and Longwood SunRail stations (sunrail.com/stations); Cranes Roost
 *     Park, Altamonte Springs (274 Cranes Roost Blvd); Lake Concord Park, Casselberry (city park by City
 *     Hall); Central Winds Park, Winter Springs (1000 Central Winds Dr, on Lake Jesup); Center Lake Park,
 *     Oviedo on the Park (cityofoviedo.net/1230/Parks-and-Facilities); Lake Mills Park, Chuluota (county
 *     park with pavilions, seminolecountyfl.gov/locations/lake-mills-park.stml).
 * Everything else on the page (roles, crews, counts) is DEMO and says so.
 *
 * CREWS (right-wing-identity-crews, right-wing-crew-map). Every crew is a DEMO idea: a first hangout in a
 * public place (BRIEF host rules: public, alcohol-free, 14+), never someone's home. Ids match
 * data/pages/join.js joinPicks (G-JOIN), so "Start this crew" links carry them:
 *   join.html?intent=crew&crew=<id>
 *   city crews:     sanford (Celery City Crew), sunrail (SunRail Regulars: Lake Mary and Longwood),
 *                   altamonte (Altamonte Weeknighters), cassel (The Casselberry Table),
 *                   wsprings (Lake Jesup Lookouts), oviedo (The Chicken Crossing),
 *                   chuluota (Chuluota Pavilion Club: Chuluota and east Seminole)
 *   identity crews: students, latine, lgbtq, parents, shift, disability, faith (names as in joinPicks)
 *   pitch a crew:   join.html?intent=crew (no id)
 * Two city crews are shown as "Forming (DEMO)" (sanford, oviedo) so the chapter sees the finished design;
 * the rest say "Needs a host". Crew names are DEMO ideas (BRIEF 4.9), shown as invitations, never ranked.
 * Real or DEMO game strings: rd.*; the "why" lines no longer start with "Real."/"DEMO." (the tag says it).
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};

window.YSD_DATA.pages.about = {
  // ---- head
  'seo.title': { en: 'About · Young Democrats of Seminole County', es: 'Quiénes somos · Young Democrats of Seminole County' },
  'og.kicker': { en: 'ABOUT US', es: 'QUIÉNES SOMOS' },
  'og.alt': { en: 'Who the Young Dems are. Young Democrats of Seminole County, ages 14 to 39. DEMO preview.', es: 'Quiénes son los Young Dems. Young Democrats of Seminole County, de 14 a 39 años. Vista previa DEMO.' },

  // ---- hero (teal world; the Real or DEMO deck is the hero object)
  'hero.eyebrow': { en: 'ABOUT · AGES 14 TO 39', es: 'QUIÉNES SOMOS · DE 14 A 39' },
  'hero.line1': { en: "Hi. We're the", es: 'Hola. Somos los' },
  'hero.sub': {
    en: 'The Young Democrats of Seminole County, for anyone 14 to 39. Free hangouts, straight answers about voting, and a seat saved for your friend.',
    es: 'Los Young Democrats of Seminole County, para cualquier persona de 14 a 39 años. Planes gratis, respuestas claras sobre cómo votar y un lugar guardado para quien traigas.'
  },
  'hero.crews': { en: 'Find your crew', es: 'Busca tu grupo' },
  'hero.note': { en: 'can you tell?', es: '¿lo adivinas?' },

  // ---- real or DEMO deck
  'rd.title': { en: 'Real or DEMO?', es: '¿Real o DEMO?' },
  'rd.sub': { en: 'Eight things from this site. Which did we make up?', es: 'Ocho cosas de este sitio. ¿Cuáles inventamos?' },
  'rd.realBtn': { en: 'Real', es: 'Real' },
  'rd.demoBtn': { en: 'DEMO', es: 'DEMO' },
  'rd.group': { en: 'Your guess', es: 'Tu respuesta' },
  'rd.right': { en: 'Got it.', es: 'Correcto.' },
  'rd.wrong': { en: 'Not quite.', es: 'Casi.' },
  'rd.count': { en: '{n} of {total}', es: '{n} de {total}' },
  'rd.next': { en: 'Next card', es: 'Siguiente' },
  'rd.last': { en: 'See my score', es: 'Ver mi puntaje' },
  'rd.big': { en: '{n}/{total}', es: '{n}/{total}' },
  'rd.score': { en: '{n} of {total} right so far', es: '{n} de {total} correctas hasta ahora' },
  'rd.final': { en: '{n} of {total} right.', es: '{n} de {total} correctas.' },
  'rd.perfect': { en: 'Perfect score. You read this site better than most of us.', es: 'Puntaje perfecto. Lees este sitio mejor que casi todos nosotros.' },
  'rd.done': { en: 'The trick: look for the tag. If it says DEMO, we made it up.', es: 'El truco: busca la etiqueta. Si dice DEMO, lo inventamos.' },
  'rd.share': { en: 'Dare a friend', es: 'Reta a alguien' },
  'rd.shareText': { en: "I got {n} of {total} on the Young Dems' Real or DEMO game. Your turn.", es: 'Saqué {n} de {total} en el juego ¿Real o DEMO? de los Young Dems. Te toca.' },
  'rd.shareTitle': { en: 'Real or DEMO? · Young Dems', es: '¿Real o DEMO? · Young Dems' },
  'rd.reset': { en: 'Play again', es: 'Jugar otra vez' },
  'rd.1.q': { en: 'Sanford was called the Celery City by about 1900.', es: 'Hacia 1900 a Sanford ya la llamaban la Ciudad del Apio (Celery City).' },
  'rd.1.why': { en: "Sanford's celery farms made its name.", es: 'Sus cultivos de apio le dieron el nombre.' },
  'rd.1.src': { en: 'Source: UCF RICHES', es: 'Fuente: UCF RICHES' },
  'rd.2.q': { en: 'There’s a trivia night in Casselberry on Thu, Nov 19 at 7 pm.', es: 'Hay una noche de trivia en Casselberry el jueves 19 de noviembre a las 7 p. m.' },
  'rd.2.why': { en: 'Made up to show how invites work. Every event here is DEMO for now.', es: 'Lo inventamos para mostrar cómo funcionan las invitaciones. Por ahora, cada evento aquí es DEMO.' },
  'rd.3.q': { en: 'You can join the Young Dems at 14.', es: 'Te puedes unir a los Young Dems a los 14.' },
  'rd.3.why': { en: "Members are 14 to 39, per the chapter's dues page.", es: 'Los miembros tienen de 14 a 39 años, según la página de cuotas del capítulo.' },
  'rd.3.src': { en: "Source: the chapter's dues page", es: 'Fuente: la página de cuotas del capítulo' },
  'rd.4.q': { en: 'Dani from Casselberry writes The Thursday Letter.', es: 'Dani, de Casselberry, escribe La Carta del Jueves.' },
  'rd.4.why': { en: "Dani is a DEMO writer. Real bylines need real people's OK.", es: 'Dani es una autora DEMO. Las firmas reales necesitan el permiso de personas reales.' },
  'rd.5.q': { en: 'SunRail stops at four stations in Seminole County.', es: 'SunRail para en cuatro estaciones del condado de Seminole.' },
  'rd.5.why': { en: 'Altamonte Springs, Longwood, Lake Mary and Sanford.', es: 'Altamonte Springs, Longwood, Lake Mary y Sanford.' },
  'rd.5.src': { en: 'Source: SunRail stations', es: 'Fuente: estaciones de SunRail' },
  'rd.6.q': { en: 'Thirty-one people say they’re going to trivia night.', es: 'Treinta y una personas dicen que van a la noche de trivia.' },
  'rd.6.why': { en: 'Every count here is DEMO. Nothing ticks up by itself, and nobody fake joins.', es: 'Cada conteo aquí es DEMO. Nada sube solo y nadie se une de mentira.' },
  'rd.7.q': { en: "Can't pay the $20 dues? You can still be a member, just without a vote.", es: '¿No puedes pagar la cuota de $20? Igual puedes ser miembro, solo que sin voto.' },
  'rd.7.why': { en: "The dues page offers non-voting membership to people who can't pay, whether it's money or citizenship status.", es: 'La página de cuotas ofrece membresía sin voto a quienes no pueden pagar, ya sea por dinero o por su situación de ciudadanía.' },
  'rd.7.src': { en: "Source: the chapter's dues page", es: 'Fuente: la página de cuotas del capítulo' },
  'rd.8.q': { en: 'Members filmed the clips in the Reel.', es: 'Los miembros grabaron los clips de la sección Clips.' },
  'rd.8.why': { en: "They're demo clips made for this preview, posted under @demo handles.", es: 'Son clips de demostración hechos para esta vista previa, con usuarios @demo.' },

  // ---- crews (DEMO): map + city crews + crews by who you are
  'crews.eyebrow': { en: 'CREWS · DEMO', es: 'GRUPOS · DEMO' },
  'crews.title': { en: 'Find your crew.', es: 'Encuentra tu grupo.' },
  'crews.sub': { en: 'Small groups by city and by who you are. All DEMO ideas until someone hosts. No rankings, just neighbors.', es: 'Grupos pequeños por ciudad y por quién eres. Todos son ideas DEMO hasta que alguien organice. Sin rankings, solo vecinos.' },
  'map.cap': { en: 'Stylized map, not to scale. Pins sit at public parks and stations. Tap one.', es: 'Mapa ilustrado, no está a escala. Los puntos marcan parques y estaciones públicas. Toca uno.' },
  'map.forming': { en: 'Forming (DEMO)', es: 'Formándose (DEMO)' },
  'map.needs': { en: 'Needs a host', es: 'Busca anfitrión' },
  'pin.forming': { en: '(forming, DEMO)', es: '(formándose, DEMO)' },
  'pin.needs': { en: '(needs a host)', es: '(busca anfitrión)' },
  'crews.demo': { en: 'DEMO crew', es: 'Grupo DEMO' },
  'crews.near': { en: 'Meets near', es: 'Se reúne cerca de' },
  'crews.idea': { en: 'First hangout idea:', es: 'Idea para el primer encuentro:' },
  'crews.status': { en: 'Needs a host', es: 'Busca anfitrión' },
  'crews.forming': { en: 'Forming · DEMO', es: 'Formándose · DEMO' },
  'crews.formingNote': { en: 'A DEMO host is planning the first hangout.', es: 'Una persona anfitriona DEMO está planeando el primer encuentro.' },
  'crews.cta': { en: 'Start this crew', es: 'Empieza este grupo' },
  'crews.join': { en: 'Join this crew', es: 'Súmate a este grupo' },
  'crews.host': { en: 'Hosting the first hangout? Get the host kit', es: '¿Vas a organizar el primer encuentro? Mira el kit' },
  'crew.sanford.where': { en: 'Sanford', es: 'Sanford' },
  'crew.sanford.spot': { en: 'the Sanford Riverwalk', es: 'el Sanford Riverwalk' },
  'crew.sanford.idea': { en: 'A sunset walk on the Riverwalk, then tacos.', es: 'Una caminata al atardecer por el Riverwalk y luego tacos.' },
  'crew.sunrail.where': { en: 'Lake Mary and Longwood', es: 'Lake Mary y Longwood' },
  'crew.sunrail.spot': { en: 'the Lake Mary and Longwood SunRail stations', es: 'las estaciones de SunRail de Lake Mary y Longwood' },
  'crew.sunrail.idea': { en: 'Meet at the station after work and ride one stop together. Weekdays only, like SunRail.', es: 'Verse en la estación después del trabajo y viajar una parada juntos. Solo entre semana, como SunRail.' },
  'crew.chuluota.where': { en: 'Chuluota and east Seminole', es: 'Chuluota y el este de Seminole' },
  'crew.chuluota.spot': { en: 'Lake Mills Park', es: 'Lake Mills Park' },
  'crew.chuluota.idea': { en: 'Lemonade at a park pavilion and a sign-making afternoon.', es: 'Limonada en un pabellón del parque y una tarde para hacer carteles.' },
  'crew.oviedo.where': { en: 'Oviedo', es: 'Oviedo' },
  'crew.oviedo.spot': { en: 'Center Lake Park', es: 'Center Lake Park' },
  'crew.oviedo.idea': { en: "Coffee downtown and a vote-plan swap. Named for Oviedo's legendary chickens.", es: 'Café en el centro e intercambio de planes para votar. El nombre viene de las legendarias gallinas de Oviedo.' },
  'crew.wsprings.where': { en: 'Winter Springs', es: 'Winter Springs' },
  'crew.wsprings.spot': { en: 'Central Winds Park', es: 'Central Winds Park' },
  'crew.wsprings.idea': { en: 'A sunset walk by the lake. Gator-watching from a very safe distance.', es: 'Una caminata al atardecer junto al lago. Para ver caimanes desde muy, muy lejos.' },
  'crew.altamonte.where': { en: 'Altamonte Springs', es: 'Altamonte Springs' },
  'crew.altamonte.spot': { en: 'Cranes Roost Park', es: 'Cranes Roost Park' },
  'crew.altamonte.idea': { en: "A weeknight lap around the lake, then a what's-on-the-ballot explainer.", es: 'Una vuelta al lago entre semana y luego una explicación de qué hay en la boleta.' },
  'crew.cassel.where': { en: 'Casselberry', es: 'Casselberry' },
  'crew.cassel.spot': { en: 'Lake Concord Park', es: 'Lake Concord Park' },
  'crew.cassel.idea': { en: 'Trivia in the park, teams of four. Bring the friend who knows too much.', es: 'Trivia en el parque, equipos de cuatro. Trae a la persona que se sabe todo.' },
  'who.title': { en: 'Crews by who you are', es: 'Grupos según quién eres' },
  'who.sub': { en: 'Countywide, always somewhere public. Pick one, or start one.', es: 'En todo el condado, siempre en un lugar público. Elige uno o empieza uno.' },
  'crews.countywide': { en: 'Countywide', es: 'Todo el condado' },
  'crew.students.name': { en: 'Student crew', es: 'Grupo de estudiantes' },
  'crew.students.sub': { en: 'High school, Seminole State, UCF or anywhere', es: 'Secundaria, Seminole State, UCF o donde sea' },
  'crew.students.idea': { en: 'Coffee near campus and a quick how-to-vote-as-a-student explainer.', es: 'Café cerca del campus y una explicación rápida de cómo votar siendo estudiante.' },
  'crew.latine.name': { en: 'Latine and Boricua crew', es: 'Grupo latino y boricua' },
  'crew.latine.sub': { en: 'Spanish first, Spanglish welcome', es: 'En español primero, spanglish bienvenido' },
  'crew.latine.idea': { en: 'A café meetup and a voting Q&A in Spanish, with English help on hand.', es: 'Un encuentro en un café con preguntas y respuestas sobre cómo votar, en español y con ayuda en inglés.' },
  'crew.lgbtq.name': { en: 'LGBTQ+ crew', es: 'Grupo LGBTQ+' },
  'crew.lgbtq.sub': { en: 'Queer, trans, questioning and friends', es: 'Queer, trans, en duda y amistades' },
  'crew.lgbtq.idea': { en: "A picnic in a public park and a chat about what's on the next city ballot.", es: 'Un pícnic en un parque público y una charla sobre qué hay en la próxima boleta de la ciudad.' },
  'crew.parents.name': { en: 'Young parents', es: 'Madres y padres jóvenes' },
  'crew.parents.sub': { en: 'Kids welcome, daytime plans', es: 'Niños bienvenidos, planes de día' },
  'crew.parents.idea': { en: 'A Saturday morning playground meetup. Coffee for the grown-ups, bubbles for the kids.', es: 'Un encuentro el sábado por la mañana en un parque infantil. Café para los grandes y burbujas para los niños.' },
  'crew.shift.name': { en: 'Shift workers', es: 'Trabajo por turnos' },
  'crew.shift.sub': { en: 'Service, retail and hospitality: late starts, weekend plans', es: 'Servicio, tiendas y hostelería: planes tarde y de fin de semana' },
  'crew.shift.idea': { en: 'A late breakfast for everyone who closed last night.', es: 'Un desayuno tarde para quienes cerraron anoche.' },
  'crew.disability.name': { en: 'Disability caucus', es: 'Grupo de personas con discapacidad' },
  'crew.disability.sub': { en: 'Access first, plans made with you', es: 'Accesibilidad primero, planes hechos contigo' },
  'crew.disability.idea': { en: "A library meeting room with captions, seating and a quiet corner, planned by the people who'll use it.", es: 'Una sala de la biblioteca con subtítulos, asientos y un rincón tranquilo, planeada por quienes la van a usar.' },
  'crew.faith.name': { en: 'Faith crew', es: 'Grupo de fe' },
  'crew.faith.sub': { en: 'Any faith, or still figuring it out', es: 'Cualquier fe, o todavía buscando' },
  'crew.faith.idea': { en: 'Coffee and a conversation about values and local issues.', es: 'Café y una conversación sobre valores y temas locales.' },
  'crew.yours.tag': { en: 'OPEN SPOT', es: 'LUGAR LIBRE' },
  'crew.yours.name': { en: 'Your crew here', es: 'Tu grupo aquí' },
  'crew.yours.where': { en: 'Anywhere in Seminole County', es: 'En cualquier parte del condado de Seminole' },
  'crew.yours.idea': { en: "Don't see your corner? Pitch a crew for your neighborhood, your school or your bus stop. We'll help you plan the first hangout.", es: '¿No ves tu rincón? Propón un grupo para tu barrio, tu escuela o tu parada de bus. Te ayudamos a planear el primer encuentro.' },
  'crew.yours.cta': { en: 'Pitch a crew', es: 'Propón un grupo' },

  // ---- what we do + the basics (REAL)
  'do.eyebrow': { en: 'WHAT WE DO', es: 'QUÉ HACEMOS' },
  'do.title': { en: 'Three jobs. All local.', es: 'Tres tareas. Todas locales.' },
  'do.sub': { en: "Straight from the chapter's own ActBlue page.", es: 'Tal como lo dice la página de ActBlue del capítulo.' },
  'do.1.title': { en: 'Get young people voting', es: 'Que la gente joven vote' },
  'do.1.body': { en: 'Straight answers on registering, mail ballots and what changes in 2027, with official links only.', es: 'Respuestas claras sobre cómo inscribirte, la boleta por correo y lo que cambia en 2027, solo con enlaces oficiales.' },
  'do.2.title': { en: "Speak up on what we're living", es: 'Alzar la voz sobre lo que vivimos' },
  'do.2.body': { en: "Rent, getting around, school, climate, rights. We bring young people's issues to the people making decisions in Seminole.", es: 'La renta, el transporte, la escuela, el clima, los derechos. Llevamos los temas de la gente joven a quienes toman decisiones en Seminole.' },
  'do.3.title': { en: 'Back Democrats here at home', es: 'Apoyar a los demócratas aquí en casa' },
  'do.3.body': { en: 'From city halls to the statehouse, we help Democrats in Seminole County win, and we have a good time doing it.', es: 'Desde los ayuntamientos hasta el capitolio estatal, ayudamos a que ganen los demócratas del condado de Seminole, y la pasamos bien haciéndolo.' },
  'do.src': { en: "Source: the chapter's ActBlue page", es: 'Fuente: la página de ActBlue del capítulo' },
  'basics.title': { en: 'This part is real', es: 'Esto sí es real' },
  'basics.who': { en: 'Who', es: 'Quién' },
  'basics.whoV': { en: 'Anyone 14 to 39', es: 'Cualquier persona de 14 a 39' },
  'basics.cost': { en: 'Cost', es: 'Costo' },
  'basics.costV': { en: "$20 a year. Can't pay? You're still in.", es: '$20 al año. ¿No puedes pagar? Igual entras.' },
  'basics.part': { en: 'Part of', es: 'Parte de' },
  'basics.party': { en: 'County party', es: 'Partido del condado' },
  'basics.src': { en: "Checked against the chapter's dues page and the state chapter list on Nov 9, 2026. Neither group has approved this preview yet.", es: 'Verificado con la página de cuotas del capítulo y la lista estatal de capítulos el 9 de nov. de 2026. Ninguno de los dos ha aprobado todavía esta vista previa.' },
  'proof.title': { en: 'A real thing YDSC did', es: 'Algo real que hizo YDSC' },
  'proof.body': { en: 'YDSC has hosted a musical theatre night in Oviedo to raise money for a local charity that supports LGBTQ+ youth.', es: 'YDSC organizó una noche de teatro musical en Oviedo a beneficio de una organización local que apoya a jóvenes LGBTQ+.' },
  'proof.src': { en: "Source: the chapter's ActBlue page for the night", es: 'Fuente: la página de ActBlue de esa noche' },

  // ---- what's real (night band): three tiles, each a disclosure
  'real.eyebrow': { en: 'THE HONEST PART', es: 'LA PARTE HONESTA' },
  'real.title': { en: "What's real?", es: '¿Qué es real?' },
  'real.sub': {
    en: 'This site is a demo for the chapter. Some of it is checked fact, and a lot is made up on purpose. Open a tile to see which is which.',
    es: 'Este sitio es una demo para el capítulo. Una parte son datos verificados y mucho está inventado a propósito. Abre una ficha para ver qué es qué.'
  },
  'col.real': { en: 'Real', es: 'Real' },
  'col.realOne': { en: 'Checked against a source, with a date.', es: 'Verificado con una fuente, con la fecha.' },
  'col.demo': { en: 'Made up', es: 'Inventado' },
  'col.demoOne': { en: 'Events, people, counts, clips, crews and forms.', es: 'Eventos, personas, conteos, clips, grupos y formularios.' },
  'col.open': { en: 'Not decided yet', es: 'Todavía sin decidir' },
  'col.openOne': { en: 'Waiting on the chapter.', es: 'Depende del capítulo.' },
  'col.more': { en: 'See the list', es: 'Ver la lista' },
  'r.1': { en: 'Voting rules, deadlines, dates and official links, checked Nov 9, 2026.', es: 'Las reglas para votar, las fechas límite, las fechas y los enlaces oficiales, verificados el 9 de nov. de 2026.' },
  'r.2': { en: "Membership rules from the chapter's dues page: ages 14 to 39, $20 a year paid in January, and a non-voting membership for people who can't pay.", es: 'Las reglas de membresía de la página de cuotas del capítulo: de 14 a 39 años, $20 al año que se pagan en enero y una membresía sin voto para quienes no pueden pagar.' },
  'r.3': { en: 'The chapter itself. YDSC is real, and the Florida Young Democrats list it as a chapter.', es: 'El capítulo en sí. YDSC es real, y los Florida Young Democrats lo tienen en su lista de capítulos.' },
  'r.4': { en: 'Numbers with a source link next to them. Election results stay marked unofficial until the county certifies them.', es: 'Los números que tienen un enlace a su fuente. Los resultados electorales siguen marcados como no oficiales hasta que el condado los certifique.' },
  'r.5': { en: 'Every sticker fact. Tap a sticker and you get its source.', es: 'Cada dato de los stickers. Toca un sticker y te sale su fuente.' },
  'r.6': { en: 'Links to the county party, the elections office and ActBlue.', es: 'Los enlaces al partido del condado, a la oficina electoral y a ActBlue.' },
  'd.1': { en: 'Every event: dates, venues, hosts and how many are going.', es: 'Cada evento: fechas, lugares, anfitriones y cuántas personas van.' },
  'd.2': { en: "Every person: names, bylines, quotes and The Thursday Letter's writer.", es: 'Cada persona: nombres, firmas, citas y quien escribe La Carta del Jueves.' },
  'd.3': { en: 'Every clip, and every @demo handle.', es: 'Cada clip y cada usuario @demo.' },
  'd.4': { en: 'Counters and squad numbers. They never tick up by themselves, and each one says DEMO.', es: 'Los contadores y los números de grupos. Nunca suben solos, y cada uno dice DEMO.' },
  'd.5': { en: "Crews, even the ones marked Forming. They're ideas waiting for a host, not groups that meet yet.", es: 'Los grupos, incluso los que dicen Formándose. Son ideas que esperan a alguien que los organice, todavía no se reúnen.' },
  'd.6': { en: 'Forms. Nothing you type leaves your browser.', es: 'Los formularios. Nada de lo que escribes sale de tu navegador.' },
  'n.1': { en: 'The policies (privacy, teen safety, clip rules, conduct, accessibility) are drafts, not legal advice, and not in effect.', es: 'Las políticas (privacidad, seguridad para adolescentes, reglas para clips, conducta, accesibilidad) son borradores, no son asesoría legal y no están vigentes.' },
  'n.2': { en: "The chapter hasn't signed off on this site yet.", es: 'El capítulo todavía no ha aprobado este sitio.' },
  'n.3': { en: 'The "Paid for by" line in the footer is a placeholder until the chapter settles its committee status.', es: 'La línea “Pagado por” del pie de página es provisional hasta que el capítulo defina su estatus de comité.' },
  'n.4': { en: 'The Spanish is written by hand and still waiting for a fluent reviewer.', es: 'El español está escrito a mano y todavía espera la revisión de una persona hablante nativa.' },
  'n.5': { en: "Social accounts stay unlinked until the chapter confirms them, and youngsemdems.com isn't live.", es: 'Las cuentas de redes no se enlazan hasta que el capítulo las confirme, y youngsemdems.com no está activo.' },
  'n.6': { en: "Who moderates clips, who's on the safety team, and whether the chapter publishes its money. We don't promise any of it until the chapter does.", es: 'Quién modera los clips, quién está en el equipo de seguridad y si el capítulo publica sus cuentas. No prometemos nada de eso hasta que el capítulo lo haga.' },
  'n.7': { en: 'Real photos of real members come later, with everyone’s OK. Until then: stock photos, tagged.', es: 'Las fotos reales de miembros reales vienen después, con el permiso de cada persona. Mientras tanto: fotos de archivo, con su etiqueta.' },
  'legend.title': { en: 'How to read the tags', es: 'Cómo leer las etiquetas' },
  'legend.real': { en: 'Checked against a source, with the date.', es: 'Verificado con una fuente, con la fecha.' },
  'legend.demo': { en: 'Made up for this preview.', es: 'Inventado para esta vista previa.' },
  'legend.draftTag': { en: 'DRAFT', es: 'BORRADOR' },
  'legend.draft': { en: 'Written, but not approved or in effect yet.', es: 'Escrito, pero todavía no aprobado ni vigente.' },
  'legend.stock': { en: 'Models, not members.', es: 'Modelos, no miembros.' },
  'real.privacy': { en: 'See what this browser saved about you', es: 'Mira lo que este navegador guardó sobre ti' },

  // ---- roles (render from data/team.js; no names, no "open seat" claims about the real board)
  'team.eyebrow': { en: 'ROLES · DEMO', es: 'PUESTOS · DEMO' },
  'team.title': { en: 'Find your seat.', es: 'Encuentra tu puesto.' },
  'team.sub': { en: 'The jobs that keep a chapter running. Real names go up only when the board says yes.', es: 'Los puestos que mantienen al capítulo andando. Los nombres reales aparecen solo cuando la directiva dice que sí.' },
  'team.quiz': { en: 'Not sure where you fit? Take the 1-minute quiz', es: '¿No sabes dónde encajas? Haz el quiz de un minuto' },
  'team.noscript': { en: 'Turn on JavaScript to see the eight roles.', es: 'Activa JavaScript para ver los ocho puestos.' },
  'run.eyebrow': { en: 'SEATS OPEN', es: 'PUESTOS ABIERTOS' },
  'run.title': { en: 'Run for a role', es: 'Postúlate para un puesto' },
  'run.elig': { en: 'Who can vote in chapter elections?', es: '¿Quién puede votar en las elecciones del grupo?' },
  'run.lead': { en: "No experience needed. Help with one event, tell us you're curious, and we'll pair you with whoever holds the seat now.", es: 'No necesitas experiencia. Ayuda en un evento, cuéntanos que te interesa y te juntamos con quien tiene el puesto ahora.' },
  'run.more': { en: 'How it works', es: 'Cómo funciona' },

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
  // a round is 10 stickers drawn from the 18 in data/stickers.js, so "Peel them all off" deals a new mix
  'toy.done': { en: 'All 10. You know Seminole better than most of us.', es: 'Los 10. Conoces Seminole mejor que casi todos nosotros.' },
  'toy.again': { en: 'Peel them off, deal 10 more', es: 'Despégalos y salen 10 más' },
  'toy.source': { en: 'Source: {label}', es: 'Fuente: {label}' },
  // Spanish source labels for the first ten data/stickers.js items; data/stickers.js now carries { en, es }
  // labels for every sticker, so these only win on Spanish pages and can go once the lead confirms the file's.
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
  // genz-brand-28: "Send my laptop" renders the decorated lid as a 4:5 card (cards-brand.js `laptop` template)
  'toy.send': { en: 'Send my laptop', es: 'Manda mi laptop' },
  'toy.sendHint': { en: 'Slap on a sticker first.', es: 'Primero pega un sticker.' },
  'toy.sendText': { en: "I decorated a laptop with Seminole County stickers on the Young Dems' 404 page: {n} of {total} found. Decorate yours.", es: 'Decoré una laptop con stickers del condado de Seminole en la página 404 de los Young Dems: {n} de {total} encontrados. Decora la tuya.' },
  'toy.sendTitle': { en: 'My laptop, Seminole edition', es: 'Mi laptop, edición Seminole' },
  'toy.saved': { en: 'Card saved. Send it to the group chat.', es: 'Tarjeta guardada. Mándala al grupo.' },
  'toy.failed': { en: "Couldn't make the card. Try again in a second.", es: 'No se pudo crear la tarjeta. Intenta otra vez en un momento.' },
  'go.home': { en: 'Start from the top.', es: 'Empieza desde el principio.' },
  'go.events': { en: 'Free hangouts all over Seminole.', es: 'Planes gratis por todo Seminole.' },
  'go.vote': { en: 'Your 2027 voting checklist.', es: 'Tu lista para votar en 2027.' },
  'go.join': { en: 'Free, for anyone 14 to 39.', es: 'Gratis, para cualquier persona de 14 a 39.' },
  'share.cta': { en: 'Send a link that works', es: 'Manda un enlace que sí funcione' },
  'share.text': { en: 'That link was broken, so here’s the real one: the Young Dems in Seminole. Free hangouts and straight answers about voting.', es: 'Ese enlace no servía, así que aquí va el bueno: los Young Dems de Seminole. Planes gratis y respuestas claras sobre cómo votar.' },
  'share.title': { en: 'Young Democrats of Seminole County', es: 'Young Democrats of Seminole County' }
};
