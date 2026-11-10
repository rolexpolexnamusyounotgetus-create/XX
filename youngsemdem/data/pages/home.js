/*!
 * data/pages/home.js: page copy for index.html (home), EN + ES. Owner: W1; rebuilt by G-HOME (round 1, Nov 10, 2026).
 * window.YSD_DATA.pages.home  keyed strings ('hero.l1': { en, es }), read with YSD.t('home:<key>') and by
 *                             tools/make_es.js for data-t="home:<key>". data/slices/home.js copies the keys
 *                             home.js renders at runtime (js.*, hangout.*, count.*), so the page loads the slice
 *                             only: after editing, run node tools/slice_data.js --rerun data/slices/home.js
 *
 * Facts used here (docs/research/00-lead-factcheck.md wins over the brief):
 *  - Mail ballot: ruling 00's required shape, word for word ("Asked for a mail ballot before Nov 3? That
 *    request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be
 *    sure."), F.S. 101.62(1)(a). The countdown counts to Thu, Dec 31, 2026, the day pre-Nov 3 requests
 *    end; never "deadline to renew". The reminder .ics is Mon, Jan 4, 2027, 10 am ET (data/civic.js).
 *  - Student IDs: ruling 00's required wording (data/strings.js nudge.studentId.text), HB 991 summary.
 *  - Nov 3: Seminole picked the Democrat for governor, about 54% to 45% (ruling 00 rounding; WFTV
 *    54.08% to 44.59%), unofficial until certification due Mon, Nov 16 (F.S. 102.112); statewide the
 *    Republican won by about a point (AP via Florida Phoenix). No candidate names.
 *  - Scoreboard: 124,626 of 338,692 active Seminole voters are 18 to 40 (SOE District Demographic
 *    Analysis, Jul 1, 2026), NPA 34.3% of them; about 54% for the Democrat in Seminole links WFTV's county
 *    table (unofficial); CIRCLE's early estimate of about 27% youth turnout (CIRCLE 2026 hub).
 *  - "This chapter is real" (right-wing-real-proof), each re-opened Tue, Nov 10, 2026:
 *      the Florida Young Democrats' current-chapters page lists Seminole County (floridayoungdems.com/current-chapters;
 *      officer names on that page are never copied here);
 *      YDSC's dues page: $20 a year, paid in January, ages 14 to under 40, non-voting membership for anyone who
 *      "cannot pay dues for any reason" (secure.actblue.com/donate/ydscdues);
 *      YDSC's ActBlue page for a musical theatre revue in Oviedo for a local charity that supports LGBTQ+ youth,
 *      June 15, no year stated, so the copy says "has hosted" (secure.actblue.com/donate/ydscmusicaltheatre).
 *    Left out on purpose: "meets with the Seminole County Democrats". The only trace is a Sun, Sep 13, 2026 YDSC
 *    meeting at the SemDems office in Longwood that search engines indexed from the Florida Democrats calendar; the
 *    listing no longer opens, so it is medium confidence with no link a reader can check.
 *  - Membership: 14 to 39; $20 a year, due in January; non-voting membership for anyone who can't pay.
 *  - Drop 01 (right-wing-merch) is DEMO: made-up pieces, edition size and date. Each piece is tied to an
 *    organizing action only (hosting, a volunteer shift, three friends joining), matching data/levels.js perks
 *    (Squad of Three: the tee; Shift Done: the tote). Nothing of value for registering, renewing or voting
 *    (52 U.S.C. 10307(c), Florida's vote-buying law; ruling 00). Counsel confirms before launch.
 * Every made-up event, person, count and clip says DEMO in both languages. No AI features.
 * Spanish is a draft until a fluent reviewer signs off (reviewedSpanish: false).
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.home = {
  // ---- link preview (the <title> uses seo.home.title from data/strings.js, brand first)
  'og.kicker': { en: 'AGES 14 TO 39 · SEMINOLE COUNTY', es: 'DE 14 A 39 AÑOS · CONDADO DE SEMINOLE' },
  'og.accent': { en: 'group project', es: 'trabajo en equipo' },
  'og.alt': { en: 'Card that reads: Local politics is a group project. Young Democrats of Seminole County, ages 14 to 39.', es: 'Tarjeta que dice: La política local es un trabajo en equipo. Young Democrats of Seminole County, de 14 a 39 años.' },

  // ---- 1. hero
  'hero.eyebrow': { en: 'Young Democrats of Seminole County · ages 14 to 39', es: 'Young Democrats of Seminole County · de 14 a 39 años' },
  'hero.l1': { en: 'Local politics', es: 'La política local' },
  'hero.l2': { en: 'is a', es: 'es un' },
  'hero.l2hi': { en: 'group', es: 'trabajo' },
  'hero.l3': { en: 'project.', es: 'en equipo.' },
  'hero.hand': { en: 'the fun kind', es: 'del divertido' },
  'hero.photoAlt': { en: 'Three friends seen from behind, arms up, watching the sun set from a rooftop', es: 'Tres amigas vistas de espaldas, con los brazos en alto, mirando el atardecer desde una azotea' },
  'sticker.sun': { en: 'Sticker: sun in sunglasses. Tap for a Seminole fact', es: 'Sticker: sol con lentes. Toca para ver un dato de Seminole' },
  'sticker.celery': { en: 'Sticker: celery. Tap for a Seminole fact', es: 'Sticker: apio. Toca para ver un dato de Seminole' },
  'hero.rotorSr': {
    en: "We're the friend who always knows the deadline, has a plan for Thursday, saves you a seat, explains the acronyms and remembers your name.",
    es: 'Somos la gente que siempre sabe la fecha, tiene plan para el jueves, te guarda un lugar, te explica las siglas y se acuerda de tu nombre.'
  },
  'hero.rotorLead': { en: "We're the friend who", es: 'Somos la gente que' },
  'hero.rotor1': { en: 'always knows the deadline.', es: 'siempre sabe la fecha.' },
  'hero.rotor2': { en: 'has a plan for Thursday.', es: 'tiene plan para el jueves.' },
  'hero.rotor3': { en: 'saves you a seat.', es: 'te guarda un lugar.' },
  'hero.rotor4': { en: 'explains the acronyms.', es: 'te explica las siglas.' },
  'hero.rotor5': { en: 'remembers your name.', es: 'se acuerda de tu nombre.' },
  'hero.sub': {
    en: 'Free hangouts, straight answers about voting, and a crew from Sanford to Oviedo. Come as you are. Bring a friend.',
    es: 'Encuentros gratis, respuestas claras sobre cómo votar y un grupo de Sanford a Oviedo. Ven como eres. Trae a alguien.'
  },
  'hero.note': { en: 'Events are free and open to everyone, in any party or none.', es: 'Los eventos son gratis y abiertos a todo el mundo, de cualquier partido o de ninguno.' },
  'ticket.eyebrow': { en: 'NEXT UP', es: 'LO PRÓXIMO' },
  'ticket.fallback': { en: 'Free hangouts all over Seminole, every week or two. Pick one and bring a friend.', es: 'Encuentros gratis por todo Seminole, cada una o dos semanas. Elige uno y trae a alguien.' },

  // ---- 2. pinned: the next thing to do
  'pins.eyebrow': { en: 'DO ONE THING', es: 'HAZ UNA COSA' },
  'pins.title': { en: 'The next thing to do', es: 'Lo próximo que puedes hacer' },
  'pins.strip': { en: 'The next thing to do: three cards', es: 'Lo próximo que puedes hacer: tres tarjetas' },
  'count.unit.one': { en: 'day left', es: 'día' },
  'count.unit.other': { en: 'days left', es: 'días' },
  'mail.until': { en: 'until requests from before Nov 3 end on Thu, Dec 31', es: 'hasta el jue. 31 de dic., cuando vencen las solicitudes de antes del 3 de nov.' },
  'mail.title': { en: 'Mail ballot? Renew it.', es: '¿Votas por correo? Renueva tu solicitud.' },
  'mail.body1': {
    en: 'Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028.',
    es: '¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela otra vez y debería cubrirte hasta 2028.'
  },
  'mail.link': { en: 'Check My Voter Record', es: 'Revisa tu registro de votante' },
  'mail.body2': { en: 'to be sure.', es: 'para confirmarlo.' },
  'mail.after': {
    en: 'Requests made before Nov 3, 2026 ended Dec 31, 2026. One new request covers every election through Dec 31, 2028.',
    es: 'Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Una nueva te cubre en todas las elecciones hasta el 31 de diciembre de 2028.'
  },
  'mail.checked': { en: 'Links checked Nov 9, 2026', es: 'Enlaces revisados el 9 de noviembre de 2026' },
  'id.tag': { en: 'New rule · Jan 1, 2027', es: 'Regla nueva · 1 de enero de 2027' },
  'id.title': { en: 'Student ID? It stops counting at the polls.', es: '¿Identificación de estudiante? Deja de servir para votar.' },
  'id.cta': { en: 'What ID to bring', es: 'Qué identificación llevar' },
  'id.source': { en: 'HB 991 summary', es: 'Resumen de la HB 991' },
  'hangout.tag': { en: 'Coming up', es: 'Muy pronto' },
  'hangout.title': { en: 'Free hangouts all over Seminole', es: 'Encuentros gratis por todo Seminole' },
  'hangout.body': { en: 'Walks, trivia, creator nights and volunteer shifts. First time? Perfect.', es: 'Caminatas, trivia, noches de creadores y turnos de voluntariado. ¿Primera vez? Perfecto.' },
  'hangout.free': { en: 'Free.', es: 'Gratis.' },

  // ---- ticker
  'ticker.label': { en: 'Cities we cover', es: 'Ciudades donde estamos' },
  'ticker.unincorporated': { en: 'Unincorporated Seminole', es: 'Seminole no incorporado' },

  // ---- 3. the Reel
  'reel.eyebrow': { en: 'CLIPS FROM THE GROUP · DEMO', es: 'CLIPS DEL GRUPO · DEMO' },
  'reel.title': { en: 'Why we show up.', es: 'Por qué participamos.' },
  'reel.sub': { en: 'Short clips from people around Seminole. Captions on, always.', es: 'Clips cortos de gente de Seminole. Siempre con subtítulos.' },
  'reel.prompt': { en: 'This week’s prompt', es: 'El tema de esta semana' },
  'reel.promptText': { en: '60 seconds on why you showed up.', es: '60 segundos sobre por qué participaste.' },
  'reel.fallback': { en: 'Watch the clips', es: 'Mira los clips' },
  'reel.more': { en: 'See all clips', es: 'Ver todos los clips' },
  'reel.strip': { en: 'Clips from the group', es: 'Clips del grupo' },

  // ---- 4. you're invited (the tentpole band is G-EVENTS' YSD.events.renderTentpole, copy from data/events.js)
  'invites.eyebrow': { en: 'DEMO EVENTS · ALL FREE', es: 'EVENTOS DEMO · TODOS GRATIS' },
  'invites.title': { en: 'You’re invited.', es: 'Te invitamos.' },
  'invites.sub': { en: 'Free, alcohol-free, and made for first-timers. Each one has an access note.', es: 'Gratis, sin alcohol y pensados para quien va por primera vez. Cada uno trae una nota de accesibilidad.' },
  'invites.sticker': { en: 'first time? perfect', es: '¿primera vez? perfecto' },
  'invites.strip': { en: 'Upcoming DEMO events', es: 'Próximos eventos DEMO' },
  'invites.fallback': { en: 'See every event on the events page.', es: 'Mira todos los eventos en la página de eventos.' },
  'invites.all': { en: 'See all events', es: 'Ver todos los eventos' },
  'drop.kicker': { en: 'NEXT DROP', es: 'LO QUE SIGUE' },
  'drop.line': { en: 'January’s lineup drops Tue, Dec 15 at noon (DEMO)', es: 'La programación de enero sale el mar. 15 de dic. a las 12 p. m. (DEMO)' },
  'drop.sub': { en: 'Drop 01 lands with it. One reminder covers both.', es: 'El Drop 01 sale ese mismo día. Un solo recordatorio para las dos cosas.' },

  // ---- 5. send it to the group chat (maker quick mode)
  'maker.eyebrow': { en: 'MAKE A CARD', es: 'HAZ UNA TARJETA' },
  'maker.sub': { en: 'Swipe to a card, add your first name, send it to one person you’d actually text. Your name stays on your phone until you share.', es: 'Desliza hasta una tarjeta, pon tu nombre y mándasela a una persona a la que de verdad le escribirías. Tu nombre se queda en tu teléfono hasta que la compartas.' },
  'maker.fallback': { en: 'The card maker needs JavaScript. You can still share this page.', es: 'El creador de tarjetas necesita JavaScript. Igual puedes compartir esta página.' },

  // ---- 6. quiz teaser
  'quiz.kicker': { en: '8 QUESTIONS · 6 TYPES', es: '8 PREGUNTAS · 6 MODOS' },
  'quiz.title': { en: 'How do you show up?', es: '¿Cuál es tu modo de organizar?' },
  'quiz.body': { en: 'Friday plans, group-chat roles, potluck strategy. Every type has a spot on the team.', es: 'Planes de viernes, tu papel en el chat, qué llevas a la comida compartida. Cada modo tiene su lugar en el equipo.' },
  'quiz.deck': { en: 'Three of the six types', es: 'Tres de los seis modos' },
  'quiz.t1': { en: 'The Hype Captain', es: 'La Chispa' },
  'quiz.t2': { en: 'The Spreadsheet Witch', es: 'Magia en Celdas' },
  'quiz.t3': { en: 'The Plus-One', es: 'Conoce a Medio Mundo' },
  'quiz.start': { en: 'Start the quiz', es: 'Empieza el quiz' },
  'quiz.issue': { en: 'Or find your issue', es: 'O encuentra tu tema' },
  'quiz.note': { en: 'No sign-up, no wrong answers, nothing saved but your result.', es: 'Sin registrarte, sin respuestas incorrectas, y solo se guarda tu resultado.' },

  // ---- the sticker rules teaser (under the quiz) + Drop 01 (in the drop card; DEMO, organizing only)
  'collect.rulesLink': { en: 'See all 15 stickers and the rules', es: 'Mira los 15 stickers y las reglas' },
  'drop1.artAlt': { en: 'Drawings of the Drop 01 pieces: a violet tee with the Young Dems ticket logo, a celery-green tote bag and a sheet of county stickers. DEMO designs.', es: 'Dibujos de las piezas del Drop 01: una camiseta violeta con el logo del boleto de los Young Dems, una bolsa verde apio y una hoja de stickers del condado. Diseños DEMO.' },
  'drop1.kicker': { en: 'DROP 01 · DEMO', es: 'DROP 01 · DEMO' },
  'drop1.title': { en: 'Can’t buy it. Earn it.', es: 'No se compra. Se gana.' },
  'drop1.tee': { en: 'The Young Dems tee', es: 'La camiseta de los Young Dems' },
  'drop1.teeHow': { en: 'Bring 3 friends: three join with your link.', es: 'Trae a 3: tres personas se unen con tu enlace.' },
  'drop1.tote': { en: 'The celery tote', es: 'La bolsa color apio' },
  'drop1.toteHow': { en: 'Finish one volunteer shift.', es: 'Completa un turno de voluntariado.' },
  'drop1.sheet': { en: 'The county sticker sheet', es: 'La hoja de stickers del condado' },
  'drop1.sheetHow': { en: 'Host a night.', es: 'Organiza una noche.' },
  'drop1.meta': { en: 'Edition of 100 each, tees XS to 4XL, designed by a member, our line on the back in English and Spanish. All DEMO, pending the chapter’s lawyer.', es: 'Edición de 100 de cada una, camisetas de XS a 4XL, diseño de un miembro, nuestra frase en la espalda en inglés y en español. Todo DEMO, pendiente de revisión legal del capítulo.' },
  'drop1.fine': { en: 'Nothing is ever given for registering, renewing or voting.', es: 'Nunca se da nada por inscribirte, renovar o votar.' },

  // ---- 8. real: this chapter is real + Nov 3, debriefed + the real scoreboard
  'real.eyebrow': { en: 'REAL · NO DEMO IN THIS ONE', es: 'REAL · AQUÍ NO HAY DEMO' },
  'real.title': { en: 'This chapter is real.', es: 'Este capítulo es real.' },
  'real.p1': { en: 'A chapter of the Florida Young Democrats.', es: 'Un capítulo de los Florida Young Democrats.' },
  'real.p1src': { en: 'FYD chapter list', es: 'Lista de capítulos de FYD' },
  'real.p2': { en: 'Dues are $20 a year on ActBlue. Can’t pay? You can still be a member.', es: 'La cuota es de $20 al año en ActBlue. ¿No puedes pagar? Igual puedes ser miembro.' },
  'real.p2src': { en: 'YDSC dues page', es: 'Página de cuotas de YDSC' },
  'real.p3': { en: 'It has hosted a musical theatre night in Oviedo to raise money for LGBTQ+ youth.', es: 'Organizó una noche de teatro musical en Oviedo para recaudar fondos para jóvenes LGBTQ+.' },
  'real.p3src': { en: 'The night’s ActBlue page', es: 'Página de ActBlue de esa noche' },
  'real.strip': { en: 'Proof this chapter is real', es: 'Pruebas de que este capítulo es real' },
  'real.checked': { en: 'All three checked Tue, Nov 10, 2026.', es: 'Las tres, revisadas el martes 10 de noviembre de 2026.' },
  'debrief.title': { en: 'Nov 3, debriefed.', es: 'El 3 de noviembre, en resumen.' },
  'debrief.p1': {
    en: 'Seminole picked the Democrat for governor, about 54% to 45% (unofficial until the county certifies, due Nov 16). Statewide, the Republican won by about a point.',
    es: 'Seminole eligió al demócrata para gobernador, más o menos 54 % a 45 % (no oficial hasta que el condado certifique, a más tardar el 16 de noviembre). En todo el estado, el republicano ganó por cerca de un punto.'
  },
  'debrief.p2': { en: 'If you’re tired, that’s fair. One thing that helps right now: set your January mail-ballot reminder.', es: 'Si te sientes con cansancio, es válido. Una cosa que ayuda ahora mismo: pon tu recordatorio de enero para la boleta por correo.' },
  'debrief.sources': { en: 'Sources:', es: 'Fuentes:' },
  'debrief.src1': { en: 'Florida Phoenix, Nov 3', es: 'Florida Phoenix, 3 de nov.' },
  'debrief.src2': { en: 'WFTV county results', es: 'WFTV, por condado' },
  'debrief.src3': { en: 'F.S. 102.112 (certification)', es: 'F.S. 102.112 (certificación)' },
  'score.title': { en: 'The real scoreboard: no demo numbers in this one', es: 'El marcador real: aquí no hay cifras DEMO' },
  'score.s1n': { en: '1 in 3+', es: '1 de cada 3+' },
  'score.s1': { en: 'Seminole voters are 18 to 40 (the county’s own age band)', es: 'votantes de Seminole tienen de 18 a 40 años (el rango de edad del propio condado)' },
  'score.s1src': { en: 'SOE data, Jul 1, 2026', es: 'Datos del SOE, 1 de jul. de 2026' },
  'score.s2': { en: 'The biggest group of them: no party', es: 'El grupo más grande de ellos: sin partido' },
  'score.s3n': { en: 'About 54%', es: 'Cerca de 54 %' },
  'score.s3': { en: 'Seminole picked the Democrat for governor', es: 'Seminole eligió al demócrata para gobernador' },
  'score.s3note': { en: 'Unofficial until the county certifies, due Nov 16.', es: 'No oficial hasta que el condado certifique, a más tardar el 16 de nov.' },
  'score.s3src': { en: 'WFTV county results', es: 'WFTV, por condado' },
  'score.s4n': { en: 'About 27%', es: 'Cerca de 27 %' },
  'score.s4': { en: 'National youth turnout', es: 'Participación juvenil en el país' },
  'score.s4note': { en: 'An early CIRCLE estimate.', es: 'Un cálculo preliminar de CIRCLE.' },
  'score.s4src': { en: 'CIRCLE 2026', es: 'CIRCLE 2026' },

  // ---- 9. join
  'join.eyebrow': { en: 'MEMBERSHIP · AGES 14 TO 39', es: 'MEMBRESÍA · DE 14 A 39 AÑOS' },
  'join.title': { en: '$20 a year. Or free.', es: '$20 al año. O gratis.' },
  'join.sub': { en: 'Everything we do is free to come to. Dues only matter if you want a vote at chapter meetings.', es: 'Todo lo que hacemos es gratis. La cuota solo importa si quieres votar en las reuniones del capítulo.' },
  'join.tiers': { en: 'Three ways to be a member', es: 'Tres formas de ser miembro' },
  'tier1.name': { en: 'Come to things', es: 'Ven a lo que quieras' },
  'tier1.what': { en: 'Join the list, come to every event, make cards, post clips.', es: 'Únete a la lista, ven a todos los eventos, haz tarjetas y sube clips.' },
  'tier2.name': { en: 'Voting member', es: 'Miembro con voto' },
  'tier2.per': { en: 'a year, due in January', es: 'al año, se paga en enero' },
  'tier2.what': { en: 'Vote and make motions at chapter meetings. Voting members live in Seminole County or go to school here.', es: 'Vota y presenta mociones en las reuniones del capítulo. Los miembros con voto viven en el condado de Seminole o estudian aquí.' },
  'tier2.cta': { en: 'Pay dues on ActBlue', es: 'Paga la cuota en ActBlue' },
  'tier3.name': { en: 'Non-voting member', es: 'Miembro sin voto' },
  'tier3.what': { en: 'For anyone who qualifies but can’t pay dues, whatever the reason, money or citizenship status.', es: 'Para quien cumple los requisitos pero no puede pagar la cuota, sea cual sea la razón: dinero o situación de ciudadanía.' },
  'tiers.source': { en: 'From YDSC’s dues page on ActBlue, checked Nov 9, 2026.', es: 'Según la página de cuotas de YDSC en ActBlue, revisada el 9 de noviembre de 2026.' },
  'form.title': { en: 'Join free', es: 'Únete gratis' },
  'form.sticker': { en: 'come as you are', es: 'ven como eres' },
  'form.fallback': { en: 'The quick form needs JavaScript. The join page works either way.', es: 'El formulario rápido necesita JavaScript. La página para unirte funciona igual.' },
  'form.fallbackLink': { en: 'Go to the join page', es: 'Ir a la página para unirte' },
  'chip.title': { en: 'Got $5 to spare?', es: '¿Te sobran $5?' },
  'chip.body': { en: 'That’s coffee for one volunteer night. Don’t have it? Come anyway.', es: 'Eso es el café de una noche de voluntariado. ¿No los tienes? Ven de todos modos.' },
  'chip.cta': { en: 'Chip in $5', es: 'Aporta $5' },

  // ---- closing strip: the Thursday Letter + share
  'outro.label': { en: 'The Thursday Letter, and sharing this page', es: 'La Carta del Jueves y compartir esta página' },
  'letter.eyebrow': { en: 'THE THURSDAY LETTER', es: 'LA CARTA DEL JUEVES' },
  'letter.title': { en: 'One letter a week. Written by a person.', es: 'Una carta por semana. Escrita por una persona.' },
  'letter.cta': { en: 'Read the sample issue', es: 'Lee la edición de muestra' },
  'letter.demo': { en: 'DEMO sample', es: 'Muestra DEMO' },
  'share.title': { en: 'Know one person who’d come?', es: '¿Conoces a alguien que vendría?' },

  // ---- JS-rendered labels (copied into data/slices/home.js)
  'js.reminderSaved': { en: 'Reminder file ready: Mon, Jan 4, 2027 at 10 am. Open it to add it to your calendar.', es: 'Recordatorio listo: lunes 4 de enero de 2027 a las 10 a. m. Ábrelo para agregarlo a tu calendario.' },
  'js.dropOpen': { en: 'January’s lineup is out (DEMO). Pick one and bring a friend.', es: 'Ya salió la programación de enero (DEMO). Elige uno y trae a alguien.' },
  'js.merch.saved': { en: 'Reminder file ready: Tue, Dec 15 at noon. Open it to add Drop 01 to your calendar.', es: 'Recordatorio listo: mar. 15 de dic. a las 12 p. m. Ábrelo para agregar el Drop 01 a tu calendario.' },
  'js.merch.calTitle': { en: 'Young Dems Drop 01 + January’s lineup (DEMO)', es: 'Drop 01 de los Young Dems + programación de enero (DEMO)' },
  'js.merch.calDescription': { en: 'DEMO. Drop 01 (a tee, a tote and a sticker sheet, earned by organizing) and January’s events land today at noon. Nothing is ever given for registering, renewing or voting.', es: 'DEMO. El Drop 01 (camiseta, bolsa y hoja de stickers que se ganan organizando) y los eventos de enero salen hoy a las 12 p. m. Nunca se da nada por inscribirte, renovar o votar.' }
};
