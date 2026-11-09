/*!
 * data/pages/vote.js: page copy for vote.html, the "2027 Ready" vote hub (W3). EN + ES.
 *
 * Static strings for data-t="vote:<key>" in vote.html, plus the labels assets/js/pages/vote.js
 * uses at runtime. Voting facts, steps, dates, the FAQ and the plan builder render from
 * data/civic.js (the single source); this file only holds page chrome and the two key cards.
 *
 * Required wording (docs/research/00-lead-factcheck.md), kept verbatim:
 *   mail.body1 + mail.bodyLink + mail.body2 = "Asked for a mail ballot before Nov 3? That request
 *     ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure."
 *   id.copy = civic.changes[student-id].copy (the student-ID shape with the court note).
 * Checked Mon, Nov 9, 2026 against data/civic.js (verified 2026-11-09). Spanish is a draft until a
 * fluent reviewer signs off (reviewedSpanish: false in data/civic.js).
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.vote = {
  // link preview
  'og.kicker': { en: '2027 READY', es: 'LISTOS PARA 2027' },
  'og.alt': { en: 'Seminole voting, minus the confusion. Mail-ballot requests from before Nov 3 end Dec 31; student IDs stop counting at the polls Jan 1, 2027. Young Democrats of Seminole County, DEMO preview.', es: 'Votar en Seminole, sin confusión. Las solicitudes de boleta por correo de antes del 3 de noviembre vencen el 31 de diciembre; la identificación de estudiante deja de servir para votar el 1 de enero de 2027. Young Democrats of Seminole County, vista previa DEMO.' },

  // 1. hero
  'hero.eyebrow': { en: '2027 READY · VOTE HUB', es: 'LISTOS PARA 2027 · VOTAR' },
  'hero.title1': { en: 'Ready', es: 'Listos' },
  'hero.title2': { en: 'for 2027.', es: 'para 2027.' },
  'hero.sub': { en: 'Mail-ballot requests from before Nov 3 end Dec 31, and voter ID rules change Jan 1. Here’s what to do, in plain words, with official links only.', es: 'Las solicitudes de boleta por correo de antes del 3 de noviembre vencen el 31 de diciembre, y las reglas de identificación cambian el 1 de enero. Aquí tienes qué hacer, sin enredos y solo con enlaces oficiales.' },
  'hero.cta1': { en: 'Check My Voter Record', es: 'Buscar mi registro de votante' },
  'hero.phone1': { en: 'Questions? The Supervisor of Elections answers at', es: '¿Dudas? La oficina del Supervisor de Elecciones responde en el' },
  'hero.phone2': { en: 'Mon to Fri, 8 am to 5 pm.', es: 'de lunes a viernes, de 8 a. m. a 5 p. m.' },
  'hero.changed': { en: 'What changed', es: 'Qué cambió' },
  'tile.mail.k': { en: 'MAIL BALLOTS', es: 'VOTO POR CORREO' },
  'tile.mail.big': { en: 'Dec 31', es: '31 de dic.' },
  'tile.mail.t': { en: 'mail-ballot requests from before Nov 3 end', es: 'vencen las solicitudes de boleta por correo de antes del 3 de noviembre' },
  'tile.id.k': { en: 'VOTER ID', es: 'IDENTIFICACIÓN' },
  'tile.id.big': { en: 'Jan 1', es: '1 de ene.' },
  'tile.id.t': { en: 'student IDs stop counting at the polls', es: 'la identificación de estudiante deja de servir para votar' },
  'sticker.official': { en: 'official links only', es: 'solo enlaces oficiales' },
  // countdown unit (YSD.ui.countdown data-countdown-unit-key)
  'count.unit.one': { en: 'day left', es: 'día' },
  'count.unit.other': { en: 'days left', es: 'días' },

  // 2. the mail-ballot card (required wording, ruling 00)
  'mail.tag': { en: 'Heads up', es: 'Ojo' },
  'mail.until': { en: 'until requests from before Nov 3 end on Thu, Dec 31, 2026', es: 'para que venzan, el jueves 31 de diciembre de 2026, las solicitudes hechas antes del 3 de noviembre' },
  'mail.title': { en: 'Mail ballot? Renew it.', es: '¿Boleta por correo? Renueva tu solicitud.' },
  'mail.body1': { en: 'Asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028.', es: '¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028.' },
  'mail.bodyLink': { en: 'Check My Voter Record', es: 'Revisa My Voter Record' },
  'mail.body2': { en: 'to be sure.', es: 'para confirmarlo.' },
  'mail.renew': { en: 'Renew online', es: 'Renovar en línea' },
  'mail.when': { en: 'The reminder pops up Mon, Jan 4, 2027 at 10 am, when the office phones are open.', es: 'El recordatorio aparece el lunes 4 de enero de 2027 a las 10 a. m., con la oficina abierta para llamadas.' },
  'mail.calOr': { en: 'Or add it to', es: 'O agrégalo a' },
  'mail.soe': { en: 'Not sure when 2027 requests open? The Supervisor of Elections can tell you:', es: '¿No sabes cuándo abren las solicitudes para 2027? La oficina del Supervisor de Elecciones te lo dice:' },
  'mail.checked': { en: 'Links checked Nov 9, 2026', es: 'Enlaces revisados el 9 de noviembre de 2026' },
  'mail.after': { en: 'Requests made before Nov 3, 2026 ended Dec 31, 2026. One new request covers every election through Dec 31, 2028.', es: 'Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Una nueva te cubre en todas las elecciones hasta el 31 de diciembre de 2028.' },
  'ways.title': { en: 'Three ways to renew', es: 'Tres formas de renovarla' },
  'ways.online': { en: 'Online, on the elections office’s request page.', es: 'En línea, en la página de solicitudes de la oficina electoral.' },
  'ways.onlineLink': { en: 'Request a mail ballot online', es: 'Pedir la boleta por correo en línea' },
  'ways.phone': { en: 'By phone, Mon to Fri, 8 am to 5 pm:', es: 'Por teléfono, de lunes a viernes, de 8 a. m. a 5 p. m.:' },
  'ways.paper': { en: 'On a signed paper form.', es: 'Con un formulario en papel firmado.' },
  'ways.paperLink': { en: 'Paper mail-ballot request form (PDF)', es: 'Formulario en papel para pedir la boleta por correo (PDF)' },
  'ways.need': { en: 'Have one number ready: your Florida driver license number, your Florida ID card number, or the last four digits of your Social Security number.', es: 'Ten a mano un número: el de tu licencia de conducir de Florida, el de tu tarjeta de identificación de Florida o los últimos cuatro dígitos de tu Seguro Social.' },
  'ways.page': { en: 'Seminole’s vote-by-mail page', es: 'Página de voto por correo de Seminole' },
  'why.summary': { en: 'Why does it end?', es: '¿Por qué vence?' },
  'why.p1': { en: 'In Florida, one mail-ballot request lasts from the day you make it through the end of the year of the next regular general election. That election was Nov 3, 2026, so a request made between the Nov 2024 and Nov 2026 elections ends Dec 31, 2026. That’s the law, not a glitch, and it happens every two years.', es: 'En Florida, una solicitud de boleta por correo dura desde el día en que la haces hasta el final del año de las siguientes elecciones generales ordinarias. Esas elecciones fueron el 3 de noviembre de 2026, así que una solicitud hecha entre las elecciones de noviembre de 2024 y las de noviembre de 2026 vence el 31 de diciembre de 2026. Es la ley, no un error, y pasa cada dos años.' },
  'why.p2': { en: 'Renewing before Jan 1? Under the state’s rule, a request made after Nov 3 should already count through 2028. Seminole hasn’t posted how it’s handling these yet, so look yourself up on My Voter Record in January and make sure your request shows.', es: '¿La renuevas antes del 1 de enero? Según la regla del estado, una solicitud hecha después del 3 de noviembre ya debería servir hasta finales de 2028. Seminole todavía no ha publicado cómo las está manejando, así que búscate en My Voter Record en enero y confirma que tu solicitud aparezca.' },
  'why.src': { en: 'Sources:', es: 'Fuentes:' },
  'why.state': { en: 'Florida Division of Elections', es: 'División de Elecciones de Florida' },

  // 3. the two Jan 1 rules (serious template)
  'rules.eyebrow': { en: 'NEW IN 2027', es: 'NUEVO EN 2027' },
  'rules.title': { en: 'Two rules change on Jan 1, 2027', es: 'Dos reglas cambian el 1 de enero de 2027' },
  'id.title': { en: 'Student IDs stop counting at the polls', es: 'La identificación de estudiante deja de servir para votar' },
  'id.copy': { en: 'Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it’s being challenged in court). Bring a driver’s license, state ID, or passport, and check voteseminole.gov before you go.', es: 'Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.' },
  'id.p1': { en: 'That means any card a school issues, even a public college or university, like a UCF or Seminole State ID. Debit and credit cards come off the list too.', es: 'Eso incluye cualquier tarjeta emitida por una escuela o institución educativa, aunque sea pública, como la de UCF o Seminole State. También salen de la lista las tarjetas de débito y crédito.' },
  'id.p2': { en: 'At check-in you need photo and signature ID. One card with both works. No ID? You can still vote a provisional ballot.', es: 'Cuando te presentas a votar necesitas una identificación con foto y firma. Una sola tarjeta con las dos sirve. ¿Sin identificación? Igual puedes votar con una boleta provisional.' },
  'id.court': { en: 'On Oct 16, 2026, the Florida NAACP’s branches and youth units sued in federal court to block the student-ID ban. As of Nov 9, 2026 there’s no ruling, so plan as if the change happens. We’ll update this if a court steps in.', es: 'El 16 de octubre de 2026, las ramas y unidades juveniles de la NAACP de Florida demandaron en un tribunal federal para frenar la prohibición de la identificación de estudiante. Al 9 de noviembre de 2026 no hay fallo, así que planifica como si el cambio fuera a aplicarse. Actualizaremos esto si un tribunal interviene.' },
  'id.note': { en: 'On Nov 9, 2026, the county’s ID page still showed the list used through 2026. Check it again before you vote.', es: 'Al 9 de noviembre de 2026, la página de identificaciones del condado todavía mostraba la lista vigente hasta 2026. Revísala otra vez antes de votar.' },
  'id.cta1': { en: 'Check voteseminole.gov', es: 'Revisar voteseminole.gov' },
  'id.cta2': { en: 'What ID to bring (official)', es: 'Qué identificación llevar (oficial)' },
  'id.src1': { en: 'HB 991 summary', es: 'Resumen de la HB 991' },
  'id.src2': { en: 'Lawsuit filed Oct 16, 2026', es: 'Demanda del 16 de octubre de 2026' },
  'cit.title': { en: 'Registrations and updates get a citizenship check', es: 'Las inscripciones y los cambios de datos pasan por una verificación de ciudadanía' },
  'cit.short': { en: 'From Jan 1, 2027, Florida checks citizenship when you register or update your record. It starts with driver-license records; if those can’t confirm it, the elections office checks other records and may ask you for proof.', es: 'Desde el 1 de enero de 2027, Florida verifica la ciudadanía cuando te inscribes o actualizas tu registro. Empieza con los registros de licencias de conducir; si con eso no se confirma, la oficina electoral revisa otros registros y puede pedirte un comprobante.' },
  'cit.p1': { en: 'Already registered? Keep your address current and open mail from the elections office. If you get a notice, answer it by the date on it, and call 407-585-8683 with any questions.', es: '¿Ya te inscribiste? Mantén tu dirección al día y abre el correo de la oficina electoral. Si te llega un aviso, contéstalo antes de la fecha que indica y llama al 407-585-8683 si tienes preguntas.' },
  'cit.p2': { en: 'Registering for the first time? Do it early, so there’s time to answer if the elections office asks for anything. Several federal lawsuits challenge these rules; as of Nov 9, 2026, we haven’t found any court order pausing them.', es: '¿Te inscribes por primera vez? Hazlo con tiempo, por si la oficina electoral te pide algo. Varias demandas federales impugnan estas reglas; al 9 de noviembre de 2026 no encontramos ninguna orden judicial que las suspenda.' },
  'cit.cta': { en: 'Register or update online', es: 'Inscríbete o actualiza tus datos en línea' },

  // 4. steps (titles and buttons are the no-JS fallback; vote.js re-renders them from data/civic.js)
  'steps.eyebrow': { en: 'THE STEPS', es: 'LOS PASOS' },
  'steps.title': { en: 'Every step, with the official link', es: 'Cada paso, con su enlace oficial' },
  'steps.sub': { en: 'Short version first. Open a step for the details, and tick it off when it’s done. Your ticks stay on this device.', es: 'Primero, la versión corta. Abre un paso para ver los detalles y márcalo cuando lo hagas. Tus marcas se quedan en este dispositivo.' },
  'steps.jump': { en: 'Jump to a step', es: 'Ir a un paso' },
  'step.register': { en: 'Register or update your info', es: 'Inscríbete o actualiza tus datos' },
  'step.register.cta': { en: 'Register or update', es: 'Inscribirme o actualizar' },
  'step.check-registration': { en: 'Check your registration', es: 'Revisa tu inscripción' },
  'step.check-registration.cta': { en: 'Look me up', es: 'Buscarme' },
  'step.renew-mail-ballot': { en: 'Renew your mail-ballot request', es: 'Renueva tu solicitud de boleta por correo' },
  'step.renew-mail-ballot.cta': { en: 'Renew my request', es: 'Renovar mi solicitud' },
  'step.polling-place': { en: 'Find your polling place', es: 'Encuentra tu lugar de votación' },
  'step.polling-place.cta': { en: 'Find my polling place', es: 'Buscar mi lugar de votación' },
  'step.early-voting': { en: 'Vote early', es: 'Vota por adelantado' },
  'step.early-voting.cta': { en: 'See sites and hours', es: 'Ver sitios y horarios' },
  'step.what-id': { en: 'What ID to bring', es: 'Qué identificación llevar' },
  'step.what-id.cta': { en: 'Check the ID list', es: 'Ver la lista de identificaciones' },
  'step.party-and-primaries': { en: 'Closed primaries: should you pick a party?', es: 'Primarias cerradas: ¿te conviene elegir un partido?' },
  'step.party-and-primaries.cta': { en: 'Update my party', es: 'Actualizar mi partido' },
  'step.problems-at-polls': { en: 'If something goes wrong at the polls', es: 'Si algo sale mal al votar' },
  'step.problems-at-polls.cta': { en: 'Know your rights', es: 'Conoce tus derechos' },

  // 5. key dates
  'dates.eyebrow': { en: 'KEY DATES', es: 'FECHAS CLAVE' },
  'dates.title': { en: 'What’s next on the calendar', es: 'Lo que viene en el calendario' },
  'dates.sub': { en: 'Every date has a source, and expected ones say so. Pick where you live to see what’s on your ballot.', es: 'Cada fecha tiene su fuente, y las previstas lo dicen. Elige dónde vives para ver lo que te toca.' },
  'dates.where': { en: 'Where you live', es: 'Dónde vives' },
  'dates.all': { en: 'All of Seminole', es: 'Todo Seminole' },
  'dates.nojs': { en: 'The dates show up here with JavaScript on. The official list:', es: 'Las fechas aparecen aquí con JavaScript activado. La lista oficial:' },
  'dates.upcoming': { en: 'Upcoming elections (official)', es: 'Próximas elecciones (oficial)' },
  'dates.more': { en: 'Show all {n} dates', es: 'Ver las {n} fechas' },
  'dates.less': { en: 'Show the next 6 only', es: 'Ver solo las próximas 6' },
  'dates.none': { en: 'Nothing posted for there yet. The next countywide dates are below “All of Seminole”.', es: 'Todavía no hay nada publicado para ahí. Las próximas fechas para todo el condado están en “Todo Seminole”.' },

  // 6. make a plan
  'plan.eyebrow': { en: 'MAKE A PLAN', es: 'ARMA TU PLAN' },
  'plan.title': { en: 'Make your voting plan', es: 'Arma tu plan para votar' },
  'plan.intro': { en: 'A few quick taps: when, how, and who’s coming. You get a calendar reminder and a plan you can text to a friend. Your address never goes on it.', es: 'Unos toques rápidos: cuándo, cómo y con quién. Te llevas un recordatorio para el calendario y un plan para mandarle por mensaje a alguien. Tu dirección nunca aparece en él.' },
  'plan.privacy': { en: 'Your plan stays in this browser unless you choose to share it.', es: 'Tu plan se queda en este navegador, a menos que decidas compartirlo.' },
  'plan.nojs': { en: 'The plan builder needs JavaScript. Everything it uses is on the official site:', es: 'Para armar el plan hace falta JavaScript. Todo lo que usa está en el sitio oficial:' },
  'plan.cal': { en: 'Add it to my calendar', es: 'Agregarlo a mi calendario' },
  'plan.text': { en: 'Text it to myself', es: 'Mandármelo por mensaje' },
  'plan.invite': { en: 'Ask a friend to come', es: 'Invitar a alguien' },
  'plan.reset': { en: 'Start over', es: 'Empezar de nuevo' },
  'plan.saved': { en: 'Plan saved on this device.', es: 'Plan guardado en este dispositivo.' },
  'plan.next': { en: 'Then do these:', es: 'Después, haz esto:' },
  'plan.cardKicker': { en: 'MY VOTING PLAN', es: 'MI PLAN PARA VOTAR' },
  'plan.noElection': { en: 'Nothing posted for there yet. Pick “Not sure” or another place to see countywide elections.', es: 'Todavía no hay nada publicado para ahí. Elige “No sé” u otro lugar para ver las elecciones de todo el condado.' },

  // 7. private checklist
  'check.eyebrow': { en: 'PRIVATE CHECKLIST', es: 'LISTA PRIVADA' },
  'check.title': { en: 'What you’ve done', es: 'Lo que ya hiciste' },
  'check.sub': { en: 'Tick what you’ve done. It stays in this browser, nobody else sees it, and there are no points. It’s just for you.', es: 'Marca lo que ya hiciste. Se queda en este navegador, nadie más lo ve y no hay puntos. Es solo para ti.' },
  'check.done': { en: 'Done (only you see this)', es: 'Hecho (solo tú lo ves)' },
  'check.clear': { en: 'Clear my checklist', es: 'Borrar mi lista' },
  'check.cleared': { en: 'Checklist cleared on this device.', es: 'Lista borrada en este dispositivo.' },

  // 8. no party
  'npa.eyebrow': { en: 'NO PARTY?', es: '¿SIN PARTIDO?' },
  'npa.title': { en: 'No party? Here’s what you can vote in.', es: '¿Sin partido? Esto es lo que puedes votar.' },
  'npa.sub': { en: 'You don’t have to pick a party to register. No party affiliation (NPA) is a real choice, and either way you’re welcome here.', es: 'No tienes que elegir un partido para inscribirte. Sin afiliación partidista (NPA) es una opción real y, de cualquier forma, aquí eres bienvenido.' },
  'npa.statLabel': { en: 'The biggest group of Seminole voters 18 to 40: no party', es: 'El grupo más grande de votantes de 18 a 40 años en Seminole: sin partido' },
  'npa.statSrc': { en: 'SOE data, Jul 1, 2026', es: 'Datos de la oficina electoral, 1 de julio de 2026' },
  'npa.yes': { en: 'You vote in', es: 'Puedes votar en' },
  'npa.yes1': { en: 'Every race in every general election', es: 'Todas las contiendas de cada elección general' },
  'npa.yes2': { en: 'Nonpartisan races, like school board, judges and city races', es: 'Contiendas no partidistas, como la junta escolar, los jueces y las elecciones municipales' },
  'npa.yes3': { en: 'Ballot questions', es: 'Las preguntas de la boleta' },
  'npa.yes4': { en: 'A primary race where every candidate is from one party and the winner faces no one in November', es: 'Una contienda primaria en la que todos los candidatos son del mismo partido y quien gane no tiene rival en noviembre' },
  'npa.no': { en: 'You sit out', es: 'Te quedas fuera de' },
  'npa.no1': { en: 'Party primaries, including the presidential primary on Mar 21, 2028', es: 'Las primarias de los partidos, incluida la primaria presidencial del 21 de marzo de 2028' },
  'npa.no2': { en: 'Want in? You can change party any time. For a primary, do it before registration closes, 29 days ahead.', es: '¿Quieres participar? Puedes cambiar de partido cuando quieras. Para una primaria, hazlo antes de que cierre la inscripción, 29 días antes.' },
  'npa.cta': { en: 'Read the honest trade-off', es: 'Lee los pros y contras' },
  'npa.us': { en: 'We’re the Young Democrats, so yes, we’d love to see you in the Democratic primary. Either way, you’re welcome at everything we do.', es: 'Somos los Young Democrats, así que sí, nos encantaría verte en la primaria demócrata. De cualquier forma, eres bienvenido en todo lo que hacemos.' },
  'npa.src': { en: 'Sources:', es: 'Fuentes:' },
  'npa.src1': { en: 'F.S. 101.021 (closed primaries)', es: 'F.S. 101.021 (primarias cerradas)' },
  'npa.src2': { en: 'Florida Constitution, Art. VI, §5(b)', es: 'Constitución de Florida, art. VI, §5(b)' },

  // 9. FAQ
  'faq.eyebrow': { en: 'FAQ', es: 'PREGUNTAS' },
  'faq.title': { en: 'Questions people actually ask', es: 'Lo que la gente pregunta de verdad' },
  'faq.filter': { en: 'Show questions about', es: 'Ver preguntas sobre' },
  'faq.nojs': { en: 'The questions show up here with JavaScript on. The elections office has its own:', es: 'Las preguntas aparecen aquí con JavaScript activado. La oficina electoral tiene las suyas:' },
  'faq.soe': { en: 'Elections office FAQ', es: 'Preguntas frecuentes de la oficina electoral' },
  'faq.tag.all': { en: 'All', es: 'Todo' },
  'faq.tag.vote-by-mail': { en: 'Mail ballots', es: 'Voto por correo' },
  'faq.tag.id': { en: 'ID', es: 'Identificación' },
  'faq.tag.register': { en: 'Registering', es: 'Inscripción' },
  'faq.tag.party': { en: 'Parties', es: 'Partidos' },
  'faq.tag.students': { en: 'Students', es: 'Estudiantes' },
  'faq.tag.election-day': { en: 'Election Day', es: 'Día de elecciones' },

  // 10. heads-up cards
  'psa.eyebrow': { en: 'SEND A HEADS-UP', es: 'AVÍSALE A ALGUIEN' },
  'psa.title': { en: 'Send it to the group chat', es: 'Mándalo al grupo' },
  'psa.sub': { en: 'Two cards with the official wording and voteseminole.gov on them. Pick one and send it to someone who’d want to know.', es: 'Dos tarjetas con la información oficial y voteseminole.gov. Elige una y mándasela a alguien a quien le sirva.' },
  'psa.mail': { en: 'Mail-ballot heads-up', es: 'Aviso: boleta por correo' },
  'psa.id': { en: 'Student-ID heads-up', es: 'Aviso: identificación de estudiante' },
  'psa.size': { en: 'Card size', es: 'Tamaño de la tarjeta' },
  'psa.post': { en: 'Post 4:5', es: 'Publicación 4:5' },
  'psa.story': { en: 'Story 9:16', es: 'Historia 9:16' },
  'psa.official': { en: 'Official info: voteseminole.gov', es: 'Información oficial: voteseminole.gov' },
  'psa.mailText': { en: 'Heads up: asked for a mail ballot before Nov 3? That request ends Dec 31. Ask again and you should be set through 2028. Check My Voter Record to be sure. Official info: voteseminole.gov', es: 'Ojo: ¿pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela de nuevo y debería valer hasta 2028. Revisa My Voter Record para confirmarlo. Información oficial: voteseminole.gov' },
  'psa.idText': { en: 'Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it’s being challenged in court). Bring a driver’s license, state ID, or passport, and check voteseminole.gov before you go.', es: 'Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.' },
  'psa.nojs': { en: 'The cards need JavaScript. You can still share this page:', es: 'Las tarjetas necesitan JavaScript. Igual puedes compartir esta página:' },
  'psa.ready': { en: 'Card saved. Send it to one person you’d actually text.', es: 'Tarjeta guardada. Mándasela a una persona a la que de verdad le escribirías.' },

  // 11. need a human
  'help.eyebrow': { en: 'NEED A HUMAN?', es: '¿NECESITAS A UNA PERSONA?' },
  'help.title': { en: 'Call someone whose whole job is this', es: 'Llama a quien se dedica a esto' },
  'help.soe': { en: 'Seminole County Supervisor of Elections', es: 'Supervisor de Elecciones del Condado de Seminole' },
  'help.disclaimer': { en: 'We’re the Young Democrats of Seminole County, a volunteer group, not the elections office. We checked every date and rule on this page against official sources on Nov 9, 2026. Before you act on one, confirm it at voteseminole.gov or call 407-585-8683.', es: 'Somos los Young Democrats of Seminole County, un grupo de voluntarios, no la oficina electoral. Revisamos cada fecha y regla de esta página en fuentes oficiales el 9 de noviembre de 2026. Antes de actuar, confírmala en voteseminole.gov o llama al 407-585-8683.' },
  'help.recheck': { en: 'Next full recheck: by Tue, Dec 15, 2026.', es: 'Próxima revisión completa: antes del martes 15 de diciembre de 2026.' },
  'help.share': { en: 'Know someone who votes in Seminole? This page saves them a headache.', es: '¿Conoces a alguien que vota en Seminole? Esta página le ahorra un dolor de cabeza.' },

  // runtime labels (assets/js/pages/vote.js)
  'js.how': { en: 'How it works', es: 'Cómo funciona' },
  'js.links': { en: 'Official links', es: 'Enlaces oficiales' },
  'js.dates': { en: 'Dates for this step', es: 'Fechas de este paso' },
  'js.call': { en: 'Call', es: 'Llamar' },
  'js.add': { en: 'Add to calendar', es: 'Agregar al calendario' },
  'js.scope': { en: 'For', es: 'Para' },
  'js.cityOnly': { en: 'City voters only', es: 'Solo votantes de la ciudad' },
  'js.optional': { en: 'Optional', es: 'Opcional' },
  'js.cardFail': { en: 'That card didn’t load. The text is copied instead, so you can paste it anywhere.', es: 'La tarjeta no cargó. Copiamos el texto para que lo pegues donde quieras.' },
  'js.cardMaking': { en: 'Making your card…', es: 'Preparando tu tarjeta…' },
  'js.planCopied': { en: 'Plan copied. Paste it wherever you keep notes.', es: 'Plan copiado. Pégalo donde guardes tus notas.' },
  'js.calDone': { en: 'Reminder file downloaded. Open it to add it to your calendar.', es: 'Se descargó el recordatorio. Ábrelo para agregarlo a tu calendario.' }
};
