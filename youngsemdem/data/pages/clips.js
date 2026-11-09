/*!
 * data/pages/clips.js: page copy for clips.html ("The Reel") and post.html, EN + ES. Owner: W4.
 * window.YSD_DATA.pages.clips  keyed strings ('hero.title1': { en, es }), read with YSD.t('clips:<key>')
 *                              and by tools/make_es.js for data-t="clips:<key>".
 * window.YSD_DATA.reel          structured reel data: the weekly clip prompt schedule (BRIEF §5.9, hooks
 *                              from data/sharekit.js scripts[]), the feed filters, the clip action map
 *                              (BRIEF §6), and Spanish translations of the DEMO clips' captions.
 *
 * Facts: the mail-ballot lines follow docs/research/00-lead-factcheck.md word for word (EN) and the
 * Spanish wording in data/strings.js nudge.mailBallot.text. Moderation times ("usually within 3 days",
 * "24 hours if someone could get hurt") come from data/legal.js snippets (DRAFT, chapter-confirm).
 * Rest weeks match data/levels.js streaks.restWeeks. Nothing of value is offered for any civic step.
 * Every made-up clip, person and event is labelled DEMO where it renders. No AI features.
 * Spanish is a draft until a fluent reviewer signs off (reviewedSpanish: false).
 *
 * Regenerate the page slice after editing: node tools/slice_data.js --rerun data/slices/clips.js
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.clips = {
  // ---- share cards (og)
  'og.kicker': { en: 'THE REEL', es: 'LOS CLIPS' },
  'og.accent': { en: 'show up', es: 'participamos' },
  'post.og.accent': { en: 'something to say', es: 'algo que decir' },
  'og.alt': { en: 'Card that reads: Why we show up. Short clips from people around Seminole County.', es: 'Tarjeta que dice: Por qué participamos. Clips cortos de gente del condado de Seminole.' },
  'post.og.kicker': { en: 'POST A CLIP', es: 'SUBE UN CLIP' },
  'post.og.alt': { en: 'Card that reads: Got a minute and something to say? Post a clip to the Young Dems reel.', es: 'Tarjeta que dice: ¿Tienes un minuto y algo que decir? Sube un clip a los Young Dems.' },

  // ---- clips.html hero
  'hero.eyebrow': { en: 'THE REEL · DEMO CLIPS', es: 'LOS CLIPS · CLIPS DEMO' },
  'hero.title1': { en: 'Why we', es: 'Por qué' },
  'hero.title2': { en: 'show up.', es: 'participamos.' },
  'hero.sub': { en: 'Short clips from people around Seminole. Captions on, always. Sound optional.', es: 'Clips cortos de gente de Seminole. Siempre con subtítulos. El sonido es opcional.' },
  'hero.promise': { en: 'A person on our team checks every clip before it goes up. No view counts, no like counts.', es: 'Una persona de nuestro equipo revisa cada clip antes de publicarlo. Sin conteo de vistas ni de me gusta.' },

  // ---- weekly prompt
  'prompt.eyebrow': { en: 'THIS WEEK', es: 'ESTA SEMANA' },
  'prompt.dates': { en: '{from} to {to}', es: 'Del {from} al {to}' },
  'prompt.title': { en: '60 seconds on why you showed up.', es: '60 segundos sobre por qué participaste.' },
  'prompt.sub': { en: 'Film it vertical, keep it kind, captions on.', es: 'Grábalo en vertical, que sea respetuoso y con subtítulos.' },
  'prompt.add': { en: 'Add yours', es: 'Sube el tuyo' },
  'prompt.watch': { en: 'Watch the reel', es: 'Mira los clips' },
  'prompt.tips': { en: 'How to film it', es: 'Cómo grabarlo' },
  'prompt.tag': { en: 'Your clip gets the tag #{tag}.', es: 'Tu clip lleva la etiqueta #{tag}.' },
  'prompt.help': { en: 'Want a hand filming it?', es: '¿Quieres ayuda para grabarlo?' },
  'prompt.helpEvent': { en: '{title}, {when} in {city} (DEMO event)', es: '{title}, {when} en {city} (Evento DEMO)' },
  'prompt.rest': { en: 'Rest week. No prompt this time.', es: 'Semana de descanso. Esta vez no hay tema.' },
  'prompt.restSub': { en: 'Post whenever you feel like it, or don’t. Rest counts too.', es: 'Sube algo cuando te nazca, o no. Descansar también cuenta.' },

  // ---- filters
  'filters.label': { en: 'Filter clips', es: 'Filtrar clips' },
  'filter.all': { en: 'All', es: 'Todos' },
  'filter.vote': { en: 'Voting help', es: 'Ayuda para votar' },
  'filter.hangouts': { en: 'Hangouts', es: 'Encuentros' },
  'filter.volunteer': { en: 'Volunteer', es: 'Voluntariado' },
  'filter.prompt': { en: 'This week’s prompt', es: 'Tema de la semana' },
  'filters.count.one': { en: '1 clip', es: '1 clip' },
  'filters.count.other': { en: '{count} clips', es: '{count} clips' },
  'feed.label': { en: 'Clips', es: 'Clips' },
  'feed.keys': { en: 'Keys: J or K to move, Space to play or pause, L to like.', es: 'Teclas: J o K para moverte, espacio para reproducir o pausar, L para dar me gusta.' },
  'nojs': { en: 'The clips need JavaScript to play. You can still post one from the post page.', es: 'Los clips necesitan JavaScript para reproducirse. Igual puedes subir uno desde la página para subir clips.' },

  // ---- one clip (reel.js reads these; it has built-in fallbacks)
  'reel.play': { en: 'Play clip by {who}', es: 'Reproducir el clip de {who}' },
  'reel.like': { en: 'Like clip by {who}', es: 'Me gusta el clip de {who}' },
  'reel.mute': { en: 'Mute', es: 'Silenciar' },
  'reel.share': { en: 'Share this clip', es: 'Compartir este clip' },
  'reel.report': { en: 'Report', es: 'Reportar' },
  'reel.reportLabel': { en: 'Report clip by {who}', es: 'Reportar el clip de {who}' },
  'reel.captions': { en: 'Read the captions', es: 'Leer los subtítulos' },
  'reel.captionsOriginal': { en: 'On screen', es: 'En pantalla (en inglés)' },
  'reel.captionsSpanish': { en: 'In Spanish', es: 'En español' },
  'reel.translated': { en: 'Translated from English', es: 'Traducido del inglés' },
  'reel.controls': { en: 'Video controls', es: 'Controles del video' },
  'reel.silent': { en: 'No sound · captions on', es: 'Sin sonido · con subtítulos' },
  'reel.videoBy': { en: 'Video by {who}: {caption}', es: 'Video de {who}: {caption}' },
  'reel.postTitle': { en: 'Post yours', es: 'Sube el tuyo' },
  'reel.postSub': { en: '60 seconds, filmed vertical, about why you showed up.', es: '60 segundos, grabado en vertical, sobre por qué participaste.' },
  'reel.more': { en: 'See all clips', es: 'Ver todos los clips' },
  'reel.moreCaption': { en: 'Show the full caption', es: 'Ver la descripción completa' },
  'reel.lessCaption': { en: 'Show less', es: 'Ver menos' },
  'reel.playing': { en: 'Playing', es: 'Reproduciendo' },
  'reel.paused': { en: 'Paused', es: 'En pausa' },
  'reel.soundOn': { en: 'Sound on', es: 'Sonido activado' },
  'reel.soundOff': { en: 'Sound off', es: 'Sonido desactivado' },
  'reel.liked': { en: 'Liked. Only you can see it.', es: 'Te gustó. Solo tú lo ves.' },
  'reel.unliked': { en: 'Like removed.', es: 'Quitaste el me gusta.' },
  'reel.shareText': { en: 'Short clip from someone here in Seminole. Worth a minute:', es: 'Un clip corto de alguien de aquí, de Seminole. Vale la pena verlo:' },
  'action.renew': { en: 'How to renew', es: 'Cómo renovar' },
  'action.vote': { en: 'Get voting help', es: 'Ayuda para votar' },
  'action.volunteer': { en: 'Find a volunteer shift', es: 'Busca un turno de voluntariado' },
  'action.event': { en: 'Come to the next one', es: 'Ven a la próxima' },
  'action.eventDated': { en: 'Next hangout: {date}', es: 'Próximo encuentro: {date}' },
  'action.join': { en: 'Join free', es: 'Únete gratis' },

  // ---- end of the feed
  'end.eyebrow': { en: 'YOUR TURN', es: 'TE TOCA' },
  'end.title': { en: 'That’s the reel for now.', es: 'Por ahora, esos son todos.' },
  'end.sub': { en: 'Yours could be next: 60 seconds, filmed vertical, about why you showed up.', es: 'El tuyo podría ser el próximo: 60 segundos, grabado en vertical, sobre por qué participaste.' },
  'end.hidden': { en: 'Show the clips you hid ({count})', es: 'Mostrar los clips que ocultaste ({count})' },
  'end.top': { en: 'Back to the first clip', es: 'Volver al primer clip' },
  'empty.filter': { en: 'Nothing with this tag yet.', es: 'Todavía no hay nada con esta etiqueta.' },

  // ---- how the reel works
  'rules.eyebrow': { en: 'HOW THE REEL WORKS', es: 'CÓMO FUNCIONAN LOS CLIPS' },
  'rules.title': { en: 'Kind clips, real people, no scoreboard.', es: 'Clips respetuosos, gente real, sin marcador.' },
  'rules.check.title': { en: 'A person checks every clip', es: 'Una persona revisa cada clip' },
  'rules.check.body': { en: 'Usually within 3 days. Nothing goes public before that, and only you can see yours while it waits.', es: 'Casi siempre en 3 días. Nada se publica antes, y mientras espera, solo tú puedes ver el tuyo.' },
  'rules.report.title': { en: 'Report anything', es: 'Reporta lo que sea' },
  'rules.report.body': { en: 'Tap Report on any clip. Reports can be anonymous, and we never tell the uploader who reported.', es: 'Toca Reportar en cualquier clip. Puedes reportar de forma anónima y nunca le decimos a quien subió el clip quién lo reportó.' },
  'rules.counts.title': { en: 'No views. No like counts.', es: 'Sin vistas. Sin conteo de me gusta.' },
  'rules.counts.body': { en: 'Your heart is just for you. Post because it matters to you, not for a number.', es: 'Tu me gusta es solo para ti. Sube algo porque te importa, no por un número.' },
  'rules.teens.title': { en: 'Under 18? A parent says OK first', es: '¿Menor de 18? Primero da el visto bueno tu familia' },
  'rules.teens.body': { en: 'If anyone under 18 shows up in a clip, a parent or guardian signs off before it goes public. No last names, schools or addresses.', es: 'Si en un clip aparece alguien menor de 18, su madre, padre o tutor legal da el visto bueno antes de publicarlo. Sin apellidos, escuelas ni direcciones.' },
  'rules.linkRules': { en: 'Clip rules', es: 'Reglas para clips' },
  'rules.linkTeens': { en: 'Teen safety', es: 'Seguridad para adolescentes' },
  'rules.linkConduct': { en: 'Code of conduct', es: 'Código de conducta' },
  'rules.draft': { en: 'Draft rules until the chapter signs off.', es: 'Reglas en borrador hasta que el capítulo las apruebe.' },

  // ---- report sheet
  'report.send': { en: 'Send report', es: 'Enviar reporte' },
  'report.pick': { en: 'Pick what’s wrong so we know where to look.', es: 'Elige cuál es el problema para saber dónde mirar.' },
  'report.demo': { en: 'DEMO: nothing was sent. We hid the clip on this device. On the live site, a moderator would review it.', es: 'DEMO: no se envió nada. Ocultamos el clip en este dispositivo. En el sitio real, una persona moderadora lo revisaría.' },
  'report.about': { en: 'Clip by {who}', es: 'Clip de {who}' },

  // ---- post flow (post.html and the post sheet on clips.html)
  'post.eyebrow': { en: 'POST A CLIP', es: 'SUBE UN CLIP' },
  'post.title': { en: 'Got a minute and something to say?', es: '¿Tienes un minuto y algo que decir?' },
  'post.sheetTitle': { en: 'Post a clip', es: 'Sube un clip' },
  'post.sub': { en: 'Film it vertical, keep it kind, send it in. A person on our team checks every clip before it goes public, usually within 3 days.', es: 'Grábalo en vertical, que sea respetuoso, y mándalo. Una persona de nuestro equipo revisa cada clip antes de publicarlo, casi siempre en 3 días.' },
  'post.promptLabel': { en: 'This week’s prompt', es: 'Tema de la semana' },
  'post.usePrompt': { en: 'Use this prompt', es: 'Usar este tema' },
  'post.how': { en: 'How are you sharing it?', es: '¿Cómo lo vas a compartir?' },
  'post.howUpload': { en: 'Upload a video', es: 'Subir un video' },
  'post.howLink': { en: 'Paste a link', es: 'Pegar un enlace' },
  'post.fileLabel': { en: 'Your video', es: 'Tu video' },
  'post.fileHint': { en: 'Vertical works best. MP4, MOV or WebM, up to 3 minutes and 150 MB.', es: 'En vertical se ve mejor. MP4, MOV o WebM, hasta 3 minutos y 150 MB.' },
  'post.fileChosen': { en: 'Ready: {name} · {duration}', es: 'Listo: {name} · {duration}' },
  'post.linkLabel': { en: 'Link to your TikTok, Instagram or YouTube post', es: 'Enlace a tu publicación de TikTok, Instagram o YouTube' },
  'post.linkHint': { en: 'Use the app’s share link. Other sites aren’t supported yet.', es: 'Usa el enlace para compartir de la app. Por ahora no aceptamos otros sitios.' },
  'post.err.empty': { en: 'Paste a link or pick a video.', es: 'Pega un enlace o elige un video.' },
  'post.err.host': { en: 'That link isn’t from TikTok, Instagram or YouTube. Try the share link from the app.', es: 'Ese enlace no es de TikTok, Instagram ni YouTube. Prueba con el enlace para compartir de la app.' },
  'post.err.url': { en: 'That doesn’t look like a full link. Copy it from the app’s share button and paste it again.', es: 'Eso no parece un enlace completo. Cópialo desde el botón de compartir de la app y pégalo otra vez.' },
  'post.captionLabel': { en: 'Caption', es: 'Descripción' },
  'post.captionHint': { en: 'What’s it about? No last names, schools or addresses.', es: '¿De qué se trata? Sin apellidos, escuelas ni direcciones.' },
  'post.count': { en: '{n} of {max} characters', es: '{n} de {max} caracteres' },
  'post.err.caption': { en: 'Captions can be up to 300 characters. Trim it a little.', es: 'La descripción puede tener hasta 300 caracteres. Recórtala un poco.' },
  'post.tagsLabel': { en: 'Tags', es: 'Etiquetas' },
  'post.tagsHint': { en: 'Up to 8, separated by commas. Like: rent, transit, voting.', es: 'Hasta 8, separadas por comas. Por ejemplo: alquiler, transporte, votar.' },
  'post.err.tags': { en: 'That’s more than 8 tags. Keep your favorite 8.', es: 'Son más de 8 etiquetas. Quédate con tus 8 favoritas.' },
  'post.err.age': { en: 'Add your age so we can follow our teen safety rules.', es: 'Escribe tu edad para que podamos seguir nuestras reglas de seguridad para adolescentes.' },
  'post.err.minors': { en: 'Let us know if anyone under 18 is in it.', es: 'Dinos si aparece alguien menor de 18.' },
  'post.err.guardian': { en: 'Add a parent or guardian email or phone so we can ask them first.', es: 'Escribe el correo o teléfono de la madre, el padre o el tutor legal para preguntarle primero.' },
  'post.captionsCheck': { en: 'It has captions (burned in, or added in the app).', es: 'Tiene subtítulos (incrustados o agregados en la app).' },
  'post.err.captions': { en: 'Add captions first so everyone can follow along. Most apps do it in one tap.', es: 'Primero ponle subtítulos para que todo el mundo lo pueda seguir. Casi todas las apps lo hacen con un toque.' },
  'post.consents': { en: 'Before you send it', es: 'Antes de enviarlo' },
  'post.rulesLink': { en: 'Read the Clip Rules', es: 'Lee las Reglas para clips' },
  'post.privacy': { en: 'DEMO: your clip stays on this device. Nothing is uploaded, and only you can see it. We never sell your info.', es: 'DEMO: tu clip se queda en este dispositivo. No se sube nada y solo tú puedes verlo. Nunca vendemos tus datos.' },
  'post.privacyLink': { en: 'Privacy policy', es: 'Política de privacidad' },
  'post.submit': { en: 'Send for review', es: 'Enviar a revisión' },
  'post.working': { en: 'Checking your video', es: 'Revisando tu video' },
  'post.again': { en: 'Post another', es: 'Subir otro' },
  'post.back': { en: 'Back to the reel', es: 'Volver a los clips' },
  'post.doneTitle': { en: 'Clip sent.', es: 'Clip enviado.' },
  'post.tooYoung': { en: 'Thanks for wanting to make something. You need to be at least 14 to post a clip. We didn’t save anything you typed.', es: 'Gracias por querer crear algo. Necesitas tener al menos 14 años para subir un clip. No guardamos nada de lo que escribiste.' },
  'post.side.title': { en: 'What makes a good one', es: 'Qué hace que un clip funcione' },
  'post.side.1': { en: 'Open with the moment: where were you, who was there?', es: 'Empieza con el momento: ¿dónde estabas y quién estaba contigo?' },
  'post.side.2': { en: 'Film vertical, face the light, say your first name only.', es: 'Graba en vertical, de frente a la luz, y di solo tu nombre de pila.' },
  'post.side.3': { en: 'Add captions in the app before you post. Lots of people watch with the sound off.', es: 'Ponle subtítulos en la app antes de publicarlo. Mucha gente mira sin sonido.' },
  'post.side.4': { en: 'End on one thing to do: come to a hangout, check your registration, bring a friend.', es: 'Termina con una sola cosa por hacer: ven a un encuentro, revisa tu inscripción o trae a alguien.' },

  // ---- pending card
  'pending.tag': { en: 'Pending review · only you can see this', es: 'En revisión · solo tú puedes verlo' },
  'pending.body': { en: 'A person on our team checks every clip, usually within 3 days.', es: 'Una persona de nuestro equipo revisa cada clip, casi siempre en 3 días.' },
  'pending.heading': { en: 'Your clips', es: 'Tus clips' },
  'pending.link': { en: 'Link to a post on {host}', es: 'Enlace a una publicación en {host}' },
  'pending.removeLabel': { en: 'Remove this clip from this device', es: 'Quitar este clip de este dispositivo' },
  'pending.removed': { en: 'Removed from this device.', es: 'Quitado de este dispositivo.' },
  'pending.notSaved': { en: 'Your browser didn’t let us save this one, so it disappears when you close the tab.', es: 'Tu navegador no nos dejó guardarlo, así que desaparece cuando cierres la pestaña.' },
  'pending.noCaption': { en: 'No caption', es: 'Sin descripción' },
  'pending.you': { en: 'You', es: 'Tú' }
};

/* ============================================================================ structured reel data */
window.YSD_DATA.reel = {
  version: 1,
  updated: '2026-11-09',
  reviewedSpanish: false,

  /**
   * Weekly clip prompt (BRIEF §5.9). One per Monday-to-Sunday week, New York time. `script` names a
   * data/sharekit.js scripts[] id whose hook and safety notes become the "How to film it" tips.
   * `rest: true` weeks match data/levels.js streaks.restWeeks. After the last week, `evergreen` shows.
   */
  prompts: [
    { weekOf: '2026-11-09', tag: 'why-i-showed-up', title: { en: '60 seconds on why you showed up.', es: '60 segundos sobre por qué participaste.' },
      tips: [
        { en: 'Open with the moment: where were you, who was there?', es: 'Empieza con el momento: ¿dónde estabas y quién estaba contigo?' },
        { en: 'Film vertical, face the light, say your first name only.', es: 'Graba en vertical, de frente a la luz, y di solo tu nombre de pila.' },
        { en: 'Add captions in the app before you post.', es: 'Ponle subtítulos en la app antes de publicarlo.' }
      ] },
    { weekOf: '2026-11-16', tag: 'fix-one-thing', script: 'v11', title: { en: 'One thing you’d fix in Seminole.', es: 'Una cosa que arreglarías en Seminole.' } },
    { weekOf: '2026-11-23', rest: true, name: { en: 'Thanksgiving week', es: 'Semana de Acción de Gracias' } },
    { weekOf: '2026-11-30', tag: 'any-party-or-none', script: 'v04', title: { en: 'No party? Perfect. Tell us why you came anyway.', es: '¿Sin partido? Perfecto. Cuéntanos por qué viniste.' } },
    { weekOf: '2026-12-07', tag: 'bring-three', script: 'v08', title: { en: 'Three friends. Not 300. Who are your three?', es: 'Tres personas. No trescientas. ¿Quiénes son tus tres?' } },
    { weekOf: '2026-12-14', tag: 'turning-16', script: 'v10', title: { en: 'Turning 16? Tell a friend they can pre-register.', es: '¿Vas a cumplir 16? Cuéntale a alguien que ya puede preinscribirse.' } },
    { weekOf: '2026-12-21', rest: true, name: { en: 'Christmas week', es: 'Semana de Navidad' } },
    { weekOf: '2026-12-28', rest: true, name: { en: 'New Year’s week', es: 'Semana de Año Nuevo' } }
  ],
  evergreen: { tag: 'why-i-showed-up', title: { en: '60 seconds on why you showed up.', es: '60 segundos sobre por qué participaste.' } },
  /** The DEMO event that helps people film (data/events.js id); shown on the prompt card while upcoming. */
  helpEvent: 'creator-night-60-seconds',

  /** Feed filters: a clip matches when it has any of the tags. 'prompt' uses this week's tag. */
  filters: [
    { id: 'all' },
    { id: 'vote', tags: ['vote-by-mail', 'explainer', 'how-to-vote', 'first-time-voter', 'psa', 'register'] },
    { id: 'hangouts', tags: ['trivia', 'social', 'meetup', 'rally', 'squad', 'events', 'recap', 'sunrail'] },
    { id: 'volunteer', tags: ['canvass', 'volunteer', 'organizing', 'precinct-captain', 'text-bank'] },
    { id: 'prompt' }
  ],

  /**
   * One action chip per clip (BRIEF §6), first match wins. kind 'event' links the next upcoming DEMO
   * event of `eventKind` (from the page slice) and falls back to href.
   */
  actions: [
    { kind: 'renew', tags: ['vote-by-mail'], href: 'vote.html#renew-mail-ballot' },
    { kind: 'volunteer', tags: ['canvass', 'volunteer', 'text-bank'], href: 'events.html?kind=volunteer' },
    { kind: 'join', tags: ['precinct-captain', 'organizing'], href: 'join.html' },
    { kind: 'event', tags: ['events', 'recap', 'trivia', 'social', 'meetup', 'rally', 'squad'], eventKind: 'social', href: 'events.html' },
    { kind: 'vote', tags: ['explainer', 'how-to-vote', 'first-time-voter', 'register', 'psa'], href: 'vote.html' },
    { kind: 'join', tags: [], href: 'join.html' }
  ],

  /**
   * Spanish for the DEMO clips (the burned-in captions are English). title{} is the clip's short name
   * (the first burned-in line). lines.es mirrors the on-screen rows line for line; lines.en (optional)
   * replaces burnedInText in the transcript when the data runs two on-screen rows together. The mail-ballot clip follows
   * ruling 00 and data/strings.js nudge.mailBallot.text.
   */
  clips: {
    'demo-mail-ballot-renew': {
      title: { en: 'Mail ballot PSA', es: 'Aviso sobre la boleta por correo' },
      caption: { es: 'Aviso: ¿Pediste la boleta por correo de Florida antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Pídela otra vez y debería cubrirte hasta 2028. Revisa tu registro de votante para confirmarlo.' },
      // en: burnedInText[3] holds two on-screen rows run together; the transcript shows them as two lines.
      lines: { en: ['Mail ballot PSA', 'Asked for a mail ballot before Nov 3?', 'That request ends Dec 31, 2026', 'Ask again: voteseminole.gov', 'Should last through 2028'],
        es: ['Aviso sobre la boleta por correo', '¿Pediste la boleta por correo antes del 3 de noviembre?', 'Esa solicitud vence el 31 de diciembre de 2026', 'Pídela otra vez: voteseminole.gov', 'Debería cubrirte hasta 2028'] }
    },
    'demo-sunrail-rally': {
      title: { en: 'SunRail to the rally', es: 'En SunRail al mitin' },
      caption: { es: 'Fuimos en SunRail al mitin. Sin buscar estacionamiento, sin estrés. ¿Quién viene la próxima vez?' },
      lines: { es: ['En SunRail al mitin', '4 paradas en Seminole: Sanford, Lake Mary, Longwood y Altamonte Springs', 'El grupo, completo'] }
    },
    'demo-first-time-voter': {
      title: { en: 'POV: first time voter', es: 'POV: votas por primera vez' },
      caption: { es: 'POV: acabas de votar por primera vez y el sticker se siente distinto.' },
      lines: { es: ['POV: votas por primera vez', 'Paso 1: confirma que estás inscrito', 'Paso 2: lleva una identificación vigente con foto y con tu firma', 'Paso 3: recibe el sticker'] }
    },
    'demo-lake-monroe-canvass': {
      title: { en: 'Lake Monroe sunset canvass', es: 'Puerta a puerta al atardecer en el lago Monroe' },
      caption: { es: 'Puerta a puerta al atardecer junto al lago Monroe. Tocamos puertas, conocimos vecinos y nos quedamos para ver el cielo.' },
      lines: { es: ['Puerta a puerta al atardecer en el lago Monroe', 'Toca puertas. Conoce a tus vecinos.', 'Quédate para el atardecer.'] }
    },
    'demo-precinct-captain': {
      title: { en: 'What’s a precinct captain?', es: '¿Qué es un capitán de precinto?' },
      caption: { es: '¿Qué es un capitán de precinto? Una persona demócrata de tu vecindario que organiza, informa y anima a la gente a votar.' },
      lines: { es: ['¿Qué es un capitán de precinto?', 'Representantes oficiales del Partido Demócrata en tu precinto', 'Contacto directo con los votantes de tu vecindario', 'Podrías ser tú'] }
    },
    'demo-trivia-night-recap': {
      title: { en: 'Trivia night recap', es: 'Resumen de la noche de trivia' },
      caption: { es: 'Resumen de la noche de trivia: amistades nuevas, nombres de equipo cuestionables y cero arrepentimientos.' },
      lines: { es: ['Resumen de la noche de trivia', 'Amistades nuevas. Nombres de equipo cuestionables.', 'Nos vemos en la próxima'] }
    }
  }
};
