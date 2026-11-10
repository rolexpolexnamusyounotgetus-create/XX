/*!
 * data/pages/quiz.js: page copy for quiz.html and the static result pages (quiz/show-up/*, quiz/issue/*),
 * EN + ES (W5). Quiz content itself (questions, results, scoring) lives in data/quiz.js; issue facts in
 * data/issues.js. Plain text only (render with textContent). Times read "2 am" / "2 a. m.".
 * Spanish follows data/strings.js: "los Young Dems", "boleta por correo"; it needs a fluent reviewer.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.quiz = {
  'og.alt': { en: 'Card: Which Seminole issue is yours? Two quizzes from the Young Dems.', es: 'Tarjeta: ¿Cuál tema de Seminole es el tuyo? Dos quizzes de los Young Dems.' },
  'og.kicker': { en: 'TWO QUIZZES', es: 'DOS QUIZZES' },

  'hero.eyebrow': { en: 'TWO QUIZZES · ABOUT A MINUTE', es: 'DOS QUIZZES · COMO UN MINUTO' },
  'hero.title1': { en: 'Which Young Dem', es: '¿Qué Young Dem' },
  'hero.title2': { en: 'are you?', es: 'eres tú?' },
  'hero.sub': {
    en: 'Tap through questions about your actual life. Get one match that’s a little too accurate, and a card worth sending to the group chat.',
    es: 'Responde preguntas sobre tu vida real. Te sale un resultado que te describe un poco demasiado bien, y una tarjeta para mandar al grupo.'
  },
  'hero.startShowUp': { en: 'Find my type', es: 'Descubre tu modo' },
  'hero.startIssue': { en: 'Find my issue', es: 'Encuentra mi tema' },
  'hero.note': { en: 'No sign-up, no wrong answers, nothing saved but your result.', es: 'Sin registrarte, sin respuestas incorrectas, y solo se guarda tu resultado.' },
  'deck.label': { en: 'Six of the result cards, fanned out like a deck', es: 'Seis tarjetas de resultado, abiertas como un mazo' },

  'stage.eyebrow': { en: 'PICK ONE', es: 'ESCOGE UNO' },
  'stage.title': { en: 'Two quizzes, two very shareable cards', es: 'Dos quizzes, dos tarjetas para compartir' },
  'showUp.kicker': { en: '8 QUESTIONS · 6 TYPES', es: '8 PREGUNTAS · 6 MODOS' },
  'showUp.title': { en: 'How do you show up?', es: '¿Cuál es tu modo de organizar?' },
  'showUp.body': { en: 'Friday plans, group-chat roles, potluck strategy. Every type has a spot on the team.', es: 'Planes de viernes, tu papel en el chat, qué llevas a la comida compartida. Cada modo tiene su lugar en el equipo.' },
  'showUp.start': { en: 'Start', es: 'Empezar' },
  'showUp.peek': { en: 'You might be…', es: 'Podrías ser…' },
  'issue.kicker': { en: '4 OR 7 TAPS · 9 ISSUES', es: '4 O 7 TOQUES · 9 TEMAS' },
  'issue.title': { en: 'Find your issue', es: 'Encuentra tu tema' },
  'issue.body': { en: 'Your commute, your rent, your 2 am thoughts. We match you with the Seminole issue that fits, plus 3 things to do about it.', es: 'Cómo te mueves, tu alquiler, lo que piensas a las 2 a. m. Te mostramos el tema de Seminole que va contigo, y 3 cosas que puedes hacer.' },
  'issue.quick': { en: 'Quick match (4 taps)', es: 'Rápido (4 toques)' },
  'issue.full': { en: 'Full match (7 taps)', es: 'Completo (7 toques)' },
  'privacy': { en: 'We don’t save your answers. If you share, only your result goes with it.', es: 'No guardamos tus respuestas. Si compartes, solo se comparte tu resultado.' },
  'noJs': { en: 'The quiz needs JavaScript. You can still meet every type and issue below.', es: 'El quiz necesita JavaScript. Igual puedes conocer cada modo y cada tema aquí abajo.' },

  'player.skip': { en: 'Skip this one', es: 'Saltar esta' },
  'player.quit': { en: 'Start over', es: 'Empezar de nuevo' },
  'player.picked': { en: 'Picked', es: 'Elegida' },
  'player.needOne': { en: 'Pick at least one answer so we can match you. Skip the rest if you like.', es: 'Elige al menos una respuesta para encontrar tu resultado. Las demás las puedes saltar.' },

  'result.cardTitle': { en: 'Your card', es: 'Tu tarjeta' },
  'result.cardSub': { en: 'Send it to one person you’d actually text.', es: 'Mándasela a una persona a quien de verdad le escribirías.' },
  'result.mixHint': { en: 'Everyone is a mix. Here’s yours.', es: 'Todos somos una mezcla. Esta es la tuya.' },
  'result.eventsNone': { en: 'Nothing in this series on the calendar right now.', es: 'Por ahora no hay nada de esta serie en el calendario.' },
  'result.next': { en: 'Next up', es: 'Lo próximo' },
  'result.coverCta': { en: 'Put yourself on the cover', es: 'Ponte en la portada' },
  'result.official': { en: 'Official link', es: 'Enlace oficial' },
  'result.retake': { en: 'Take it again', es: 'Hacerlo de nuevo' },

  'types.eyebrow': { en: 'THE SIX TYPES', es: 'LOS SEIS MODOS' },
  'types.title': { en: 'Meet all 6 types', es: 'Conoce los 6 modos' },
  'types.sub': { en: 'No ranking, no best type. A crew needs all six.', es: 'No hay ranking ni modo mejor. Un equipo necesita los seis.' },
  'issues.eyebrow': { en: 'THE NINE ISSUES', es: 'LOS NUEVE TEMAS' },
  'issues.title': { en: '9 issues. One is yours.', es: '9 temas. Uno es el tuyo.' },
  'issues.sub': { en: 'Each one comes with local facts, sources linked, and three things you can do this month.', es: 'Cada uno trae datos locales con sus fuentes y tres cosas que puedes hacer este mes.' },
  'issues.all': { en: 'See all 9 issues', es: 'Mira los 9 temas' },

  'cover.eyebrow': { en: 'ME, ON THE COVER', es: 'YO, EN LA PORTADA' },
  'cover.title': { en: 'Put yourself on the cover', es: 'Ponte en la portada' },
  'cover.sub': { en: 'Your name, huge. Your city, your issue, your colours. Add a photo if you want; it never leaves your phone.', es: 'Tu nombre en grande. Tu ciudad, tu tema, tus colores. Agrega una foto si quieres; nunca sale de tu teléfono.' },

  'share.title': { en: 'Know someone who needs to take this?', es: '¿Conoces a alguien que tiene que hacer esto?' },
  'share.sub': { en: 'One minute, no sign-up. Send it over.', es: 'Un minuto y sin registrarse. Mándaselo.' },

  'r.eyebrowShowUp': { en: 'A RESULT FROM “HOW DO YOU SHOW UP?”', es: 'UN RESULTADO DE «¿CUÁL ES TU MODO DE ORGANIZAR?»' },
  'r.eyebrowIssue': { en: 'A RESULT FROM “FIND YOUR ISSUE”', es: 'UN RESULTADO DE «ENCUENTRA TU TEMA»' },
  'r.someone': { en: 'Someone sent you their result. Here’s what it means, and here’s yours in about a minute.', es: 'Alguien te mandó su resultado. Esto es lo que significa, y el tuyo está a un minuto.' },
  'r.takeShowUp': { en: 'Find my type', es: 'Descubre tu modo' },
  'r.takeIssue': { en: 'Find my issue', es: 'Encuentra mi tema' },
  'r.allTypes': { en: 'Meet all 6 types', es: 'Conoce los 6 modos' },
  'r.allIssues': { en: 'See all 9 issues', es: 'Mira los 9 temas' },
  'r.share': { en: 'Send it to the group chat', es: 'Mándalo al grupo' },
  'r.others': { en: 'The other types', es: 'Los otros modos' },
  'char.alt': { en: 'Illustrated character for {name}', es: 'Personaje ilustrado de {name}' },
  'r.otherIssues': { en: 'The other issues', es: 'Los otros temas' }
};
