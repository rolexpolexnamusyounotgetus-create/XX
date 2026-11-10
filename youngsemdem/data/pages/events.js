/*! data/pages/events.js (W2): page copy for events.html and the generated event pages (events/<id>.html),
 * EN + ES. Event details themselves live in data/events.js. Keys are read as "events:<key>" (YSD.t,
 * tools/make_es.js, tools/make_event_pages.js). Spanish is a draft until a fluent reviewer signs off.
 * Every made-up event, count and person says DEMO; the REAL partner events come from data/events.js.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.events = {
  /* link previews (events.html) */
  'og.kicker': { en: 'THIS MONTH IN SEMINOLE', es: 'ESTE MES EN SEMINOLE' },
  'og.alt': { en: "A Young Dems card that reads What's coming up in Seminole, with a date ticket and a DEMO tag", es: 'Una tarjeta de los Young Dems que dice Lo que viene en Seminole, con un boleto de fecha y una etiqueta DEMO' },

  /* hero */
  'hero.eyebrow': { en: 'Events · Seminole County', es: 'Eventos · condado de Seminole' },
  'hero.title1': { en: "You're", es: 'Te' },
  'hero.title2': { en: 'invited.', es: 'invitamos.' },
  'hero.sub': { en: 'Free hangouts, volunteer nights and real talk, from Sanford to Oviedo. Pick a night. Bring a friend.', es: 'Encuentros gratis, noches de voluntariado y conversaciones de verdad, de Sanford a Oviedo. Elige una noche. Trae a alguien.' },
  'hero.sticker': { en: 'first time? perfect', es: '¿primera vez? perfecto' },
  'hero.next': { en: 'Next up', es: 'Lo próximo' },
  'hero.host': { en: 'Host a night', es: 'Organiza una noche' },
  'hero.stack': { en: 'The next nights', es: 'Las próximas noches' },
  'hero.bigOne': { en: 'The big one', es: 'El grande' },
  'hero.reassure': { en: 'Free and open to everyone 14 and up, in any party or none.', es: 'Gratis y abiertos a cualquier persona desde los 14 años, de cualquier partido o de ninguno.' },
  'hero.all': { en: 'See the whole lineup', es: 'Ver toda la programación' },

  /* lineup */
  'lineup.eyebrow': { en: 'The lineup', es: 'La programación' },
  'lineup.title': { en: 'Pick a night', es: 'Elige una noche' },
  'lineup.sub': { en: 'Every event is free, alcohol-free and comes with an access note. No experience needed.', es: 'Todos los eventos son gratis, sin alcohol y con una nota de accesibilidad. No hace falta experiencia.' },
  'filter.label': { en: 'Filter the events', es: 'Filtra los eventos' },
  'filter.kind': { en: 'What kind', es: 'Qué tipo' },
  'filter.city': { en: 'Where', es: 'Dónde' },
  'filter.all': { en: 'All', es: 'Todos' },
  'filter.anyCity': { en: 'Anywhere', es: 'Donde sea' },
  'filter.social': { en: 'Hang out', es: 'Pasarla bien' },
  'filter.learn': { en: 'Learn', es: 'Aprender' },
  'filter.volunteer': { en: 'Volunteer', es: 'Voluntariado' },
  'filter.create': { en: 'Make stuff', es: 'Crear' },
  'filter.spanish': { en: 'In Spanish', es: 'En español' },
  'filter.clear': { en: 'Clear filters', es: 'Quitar filtros' },
  'filter.who': { en: 'Who', es: 'Para quién' },
  'filter.teen': { en: 'Good for under-18s', es: 'Ideal para menores de 18' },
  'filter.teenHint': { en: 'Daytime events: under-18s come without a guardian form.', es: 'Eventos de día: los menores de 18 vienen sin el formulario del tutor.' },
  /* ?series=<id> (quiz "Events made for you" links): a chip above the count shows the series and clears it */
  'filter.seriesOnly': { en: 'Only showing', es: 'Mostrando solo' },
  'filter.seriesClear': { en: 'Clear the {series} filter and show every event', es: 'Quitar el filtro {series} y ver todos los eventos' },
  /* series names now live in data/events.js series{} (brand names, genz-brand-27); YSD.events.series() reads them */
  'count.one': { en: '1 event (DEMO)', es: '1 evento (DEMO)' },
  'count.other': { en: '{count} events (DEMO)', es: '{count} eventos (DEMO)' },
  'empty.title': { en: 'Nothing on the calendar for that one yet', es: 'Todavía no hay nada así en el calendario' },
  'empty.line': { en: "Try another filter, or host the night you wish existed. We'll help you plan it.", es: 'Prueba otro filtro u organiza la noche que te gustaría que existiera. Te ayudamos a planearla.' },
  'empty.dropTitle': { en: 'Coming in the January drop', es: 'Llega con la programación de enero' },
  'empty.next': { en: 'Open now, same kind of night:', es: 'Ya abierto, del mismo tipo:' },
  'empty.host': { en: 'Host the next one', es: 'Organiza el próximo' },
  'noscript': { en: 'Turn on JavaScript to see the lineup and RSVP. Every event also has its own page that works without it.', es: 'Activa JavaScript para ver la programación y confirmar. Cada evento también tiene su propia página, que funciona sin JavaScript.' },

  /* the drop */
  'drop.eyebrow': { en: 'Next drop', es: 'Lo que sale pronto' },
  'drop.title': { en: "January's lineup drops Tue, Dec 15 at noon", es: 'La programación de enero sale el mar. 15 de dic. a las 12 p. m.' },
  'drop.demo': { en: 'DEMO date', es: 'Fecha DEMO' },
  'drop.sub': { en: 'January and February land all at once. Set a reminder and get first pick of the seats.', es: 'Enero y febrero salen de una vez. Ponte un recordatorio y elige lugar antes que nadie.' },
  'drop.notify': { en: 'Notify me', es: 'Avísame' },
  'drop.notified': { en: 'Reminder saved', es: 'Recordatorio guardado' },
  'drop.notifiedToast': { en: "Reminder file ready. Open it and you're set for Dec 15 at noon.", es: 'Archivo de recordatorio listo. Ábrelo y quedas para el 15 de dic. a las 12 p. m.' },
  'drop.locked': { en: '{count} events (DEMO), locked until the drop', es: '{count} eventos (DEMO), bloqueados hasta que salgan' },
  'drop.unit.one': { en: 'day to go', es: 'día para que salga' },
  'drop.unit.other': { en: 'days to go', es: 'días para que salga' },
  'drop.tile.title': { en: '{count} more nights, locked', es: '{count} noches más, bloqueadas' },
  'drop.tile.cta': { en: 'Get the drop reminder', es: 'Recibe el aviso' },
  'drop.liveTitle': { en: "January's lineup just dropped", es: 'Acaba de salir la programación de enero' },
  'drop.liveSub': { en: 'The new nights are in the lineup above, marked Just dropped.', es: 'Las noches nuevas ya están en la programación, marcadas como Recién salido.' },

  /* REAL partner events */
  'real.eyebrow': { en: 'Also this month', es: 'También este mes' },
  'real.title': { en: 'Real events from the county party', es: 'Eventos reales del partido del condado' },
  'real.sub': { en: 'The Seminole County Democrats run these, not us. RSVP on their page.', es: 'Los organiza el Partido Demócrata del condado de Seminole, no nosotros. Confirma en su página.' },
  'real.link': { en: 'Details and RSVP on their page', es: 'Detalles y confirmación en su página' },
  'real.host': { en: 'Hosted by the Seminole County Democrats', es: 'Organiza: Seminole County Democrats' },
  'real.checked': { en: 'Checked on their events calendar Nov 9, 2026.', es: 'Revisado en su calendario de eventos el 9 de nov. de 2026.' },

  /* host teaser (B39); the full chapter-in-a-box kit is host.html */
  'host.eyebrow': { en: 'Host a night', es: 'Organiza una noche' },
  'host.title': { en: 'Got a night in mind? Host it.', es: '¿Tienes una idea? Organízala.' },
  'host.sub': { en: "We hand you the chapter in a box: a 3-week plan, the checklist, invite texts and share cards. You bring the idea and two friends.", es: 'Te damos todo en una caja: un plan de 3 semanas, la lista de pendientes, mensajes para invitar y tarjetas para compartir. Tú pones la idea y dos amistades.' },
  'host.r1': { en: 'Public place', es: 'Lugar público' },
  'host.r2': { en: 'Alcohol-free', es: 'Sin alcohol' },
  'host.r3': { en: 'Open to 14+', es: 'Desde 14 años' },
  'host.r4': { en: 'Access note', es: 'Nota de accesibilidad' },
  'host.cta': { en: 'Get the host kit', es: 'Ver el kit para organizar' },
  'host.pitch': { en: 'Pitch a night', es: 'Propón una noche' },
  'host.box1': { en: '3-week plan', es: 'Plan de 3 semanas' },
  'host.box2': { en: 'Flyer + cards', es: 'Volante y tarjetas' },
  'host.box3': { en: 'Invite texts', es: 'Mensajes' },

  /* series shelf (genz-brand-27) */
  'series.eyebrow': { en: 'Same name, new crowd', es: 'Mismo nombre, gente nueva' },
  'series.title': { en: 'Find your night', es: 'Encuentra tu noche' },
  'series.sub': { en: 'Every night here has a name, so you can find the one that feels like yours and come back to it.', es: 'Cada noche tiene nombre, para que encuentres la que va contigo y vuelvas.' },
  'series.next': { en: 'Next: {date}', es: 'Próximo: {date}' },
  'series.locked': { en: 'Next one drops Dec 15 (DEMO)', es: 'El próximo sale el 15 de dic. (DEMO)' },
  'series.see': { en: 'See the {series} dates', es: 'Ver las fechas de {series}' },
  'series.dates.one': { en: '1 date', es: '1 fecha' },
  'series.dates.other': { en: '{count} dates', es: '{count} fechas' },

  /* share */
  'share.title': { en: 'Know someone who needs a Thursday plan?', es: '¿Conoces a alguien que necesita plan para el jueves?' },
  'share.sub': { en: "Send the lineup to your group chat. It's easier to show up when someone you know is going.", es: 'Manda la programación a tu grupo. Es más fácil ir cuando va alguien que conoces.' },

  /* event pages (tools/make_event_pages.js) */
  'ev.back': { en: 'All events', es: 'Todos los eventos' },
  'ev.question': { en: 'Are you in?', es: '¿Te apuntas?' },
  'ev.lang.en': { en: 'In English', es: 'En inglés' },
  'ev.lang.es': { en: 'In Spanish', es: 'En español' },
  'ev.lang.both': { en: 'English and Spanish', es: 'En inglés y en español' },
  'ev.language': { en: 'Language', es: 'Idioma' },
  'ev.about': { en: "What's the plan", es: 'De qué se trata' },
  'ev.capacity': { en: 'Room for {n} (DEMO)', es: 'Hay lugar para {n} (DEMO)' },
  'ev.map': { en: 'Open in Maps', es: 'Abrir en Mapas' },
  'ev.generic': { en: 'The exact place is a DEMO venue. The real address comes with your RSVP.', es: 'El lugar exacto es un lugar DEMO. La dirección real llega con tu confirmación.' },
  'ev.calTitle': { en: 'Add it to your calendar', es: 'Agrégalo a tu calendario' },
  'ev.bringTitle': { en: 'Bring a friend', es: 'Trae a alguien' },
  'ev.first.title': { en: "First time? Here's what happens", es: '¿Primera vez? Así funciona' },
  'ev.first.1': { en: 'Tap I’m in. A first name and one way to reach you, that’s it. No account.', es: 'Toca Me apunto. Tu nombre y una forma de contactarte, nada más. Sin crear cuenta.' },
  'ev.first.2': { en: 'The day before, you get one reminder with the details.', es: 'El día antes te llega un recordatorio con los detalles.' },
  'ev.first.3': { en: 'Show up, look for the celery-green sign (DEMO), and someone will say hi and introduce you around.', es: 'Llega, busca el letrero verde apio (DEMO) y alguien te va a saludar y presentar al grupo.' },
  'ev.links': { en: 'Official links', es: 'Enlaces oficiales' },
  'ev.sources': { en: 'Where the facts on this page come from', es: 'De dónde salen los datos de esta página' },
  'ev.source': { en: 'Source', es: 'Fuente' },
  'ev.checked': { en: 'Links checked Nov 9, 2026.', es: 'Enlaces revisados el 9 de nov. de 2026.' },
  'ev.sample': { en: 'Try a sample question', es: 'Prueba una pregunta de muestra' },
  'ev.related': { en: 'More nights like this', es: 'Más planes así' },
  'ev.policy': { en: 'The fine print', es: 'La letra pequeña' },
  'ev.share': { en: 'Send it to the group chat', es: 'Mándalo al grupo' },
  'ev.full': { en: 'This one is full (DEMO). Join the waitlist and we’ll let you know if a spot opens.', es: 'Este está lleno (DEMO). Anótate en la lista de espera y te avisamos si se libera un lugar.' },
  'ev.nojs': { en: 'I’m in takes you to a short form that saves your seat.', es: 'Me apunto te lleva a un formulario corto para guardar tu lugar.' },
  'ev.drop': { en: 'Part of January’s lineup, which drops Tue, Dec 15 at noon (DEMO). You can save a seat now.', es: 'Es parte de la programación de enero, que sale el mar. 15 de dic. a las 12 p. m. (DEMO). Ya puedes guardar tu lugar.' },
  'ev.pastNote': { en: 'This one already happened. Here’s what’s next.', es: 'Este evento ya pasó. Esto es lo que viene.' },
  'ev.kicker': { en: "YOU'RE INVITED", es: 'TE INVITAMOS' },
  'ev.series': { en: 'Part of', es: 'Parte de' },
  'ev.teen': { en: 'Good for under-18s: it ends in daylight, so no guardian form.', es: 'Ideal para menores de 18: termina de día, así que no hace falta el formulario del tutor.' },
  'ev.tentpole': { en: 'The monthly big one', es: 'El grande de cada mes' }, // month-neutral: static pages can't know the visitor's month
  'ev.ogAlt': { en: 'A Young Dems invite card for {event}: {date}, {time}, {place}, with a DEMO tag', es: 'Una invitación de los Young Dems para {event}: {date}, {time}, {place}, con una etiqueta DEMO' }
};
