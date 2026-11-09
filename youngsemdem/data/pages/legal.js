/*!
 * data/pages/legal.js: page chrome for the five policy pages (W7), EN + ES.   STATUS: DRAFT
 *   privacy.html, accessibility.html, teen-safety.html, content-policy.html, conduct.html
 *
 * YSD_DATA.pages.legal (data-t="legal:key"). The policy text itself (TL;DR, sections, sources) is
 * NOT here: assets/js/pages/legal.js renders it from data/legal.js (BRIEF 4.10). This file holds the
 * hero lines, the DRAFT notice, headings, the "what this browser remembers" panel and the SEO keys
 * for the three pages that have none in data/strings.js (teen safety, clip rules, conduct).
 * The hero lines are page chrome and can be warm; the policy text stays plain (BRIEF 2.4).
 * SEO descriptions mirror each page's `summary` in data/legal.js.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};

window.YSD_DATA.pages.legal = {
  // ---- SEO for pages without seo.* keys in data/strings.js
  'seo.teenSafety.title': { en: 'Teen safety · Young Democrats of Seminole County', es: 'Seguridad para adolescentes · Young Democrats of Seminole County' },
  'seo.teenSafety.description': { en: 'How the Young Democrats of Seminole County protect members ages 14 to 17 online and at events.', es: 'Cómo los Young Democrats of Seminole County protegen a los miembros de 14 a 17 años en línea y en los eventos.', mirror: 'legal.pages.minors.summary' },
  'seo.teenSafety.ogTitle': { en: 'Teens welcome. Safety first.', es: 'Adolescentes bienvenidos. La seguridad primero.' },
  'seo.teenSafety.ogDescription': { en: 'How we look out for members 14 to 17, online and at events.', es: 'Cómo cuidamos a los miembros de 14 a 17 años, en línea y en los eventos.' },
  'seo.clipRules.title': { en: 'Clip rules · Young Democrats of Seminole County', es: 'Reglas para clips · Young Democrats of Seminole County' },
  'seo.clipRules.description': { en: 'What you can post to the Young Democrats of Seminole County clip feed, what we remove, and how to report or appeal.', es: 'Qué puedes publicar en los clips de los Young Democrats of Seminole County, qué quitamos y cómo reportar o apelar.', mirror: 'legal.pages.moderation.summary' },
  'seo.clipRules.ogTitle': { en: 'Post your take. Keep it kind.', es: 'Comparte lo que piensas. Con respeto.' },
  'seo.clipRules.ogDescription': { en: 'What you can post, what comes down, and how to report or appeal.', es: 'Qué puedes publicar, qué se quita y cómo reportar o apelar.' },
  'seo.conduct.title': { en: 'Code of conduct · Young Democrats of Seminole County', es: 'Código de conducta · Young Democrats of Seminole County' },
  'seo.conduct.description': { en: "How members and guests of the Young Democrats of Seminole County treat each other at events and online, what's not OK, and how to report a problem.", es: 'Cómo se tratan los miembros e invitados de los Young Democrats of Seminole County en los eventos y en línea, qué no está bien y cómo reportar un problema.', mirror: 'legal.pages.conduct.summary' },
  'seo.conduct.ogTitle': { en: 'Be cool to each other.', es: 'Trátense bien.' },
  'seo.conduct.ogDescription': { en: 'How we treat each other at events and online, and how to report a problem.', es: 'Cómo nos tratamos en los eventos y en línea, y cómo reportar un problema.' },

  // ---- link-preview cards
  'og.kicker': { en: 'POLICY · DRAFT', es: 'POLÍTICA · BORRADOR' },
  'og.privacy.alt': { en: 'Privacy, in plain words. Young Democrats of Seminole County. Draft policy, DEMO preview.', es: 'Privacidad, en palabras sencillas. Young Democrats of Seminole County. Política en borrador, vista previa DEMO.' },
  'og.accessibility.alt': { en: 'Our goal: a site everyone can use. Young Democrats of Seminole County. Draft statement, DEMO preview.', es: 'Nuestra meta: un sitio que todos puedan usar. Young Democrats of Seminole County. Declaración en borrador, vista previa DEMO.' },
  'og.teen.alt': { en: 'Teens welcome. Safety first. Young Democrats of Seminole County. Draft policy, DEMO preview.', es: 'Adolescentes bienvenidos. La seguridad primero. Young Democrats of Seminole County. Política en borrador, vista previa DEMO.' },
  'og.clips.alt': { en: 'Post your take. Keep it kind. Young Democrats of Seminole County clip rules. Draft, DEMO preview.', es: 'Comparte lo que piensas. Con respeto. Reglas para clips de los Young Democrats of Seminole County. Borrador, vista previa DEMO.' },
  'og.conduct.alt': { en: 'Be cool to each other. Young Democrats of Seminole County code of conduct. Draft, DEMO preview.', es: 'Trátense bien. Código de conducta de los Young Democrats of Seminole County. Borrador, vista previa DEMO.' },

  // ---- heroes (page chrome)
  'privacy.eyebrow': { en: 'PRIVACY POLICY · DRAFT', es: 'POLÍTICA DE PRIVACIDAD · BORRADOR' },
  'privacy.title': { en: 'Your info is yours.', es: 'Tus datos son tuyos.' },
  'privacy.lede': { en: 'What we keep, who sees it, and how to wipe it. Plain words, no tricks.', es: 'Qué guardamos, quién lo ve y cómo borrarlo. En palabras sencillas, sin trucos.' },
  'accessibility.eyebrow': { en: 'ACCESSIBILITY STATEMENT · DRAFT', es: 'DECLARACIÓN DE ACCESIBILIDAD · BORRADOR' },
  'accessibility.title': { en: 'Built for everyone. Still fixing things.', es: 'Hecho para todos. Todavía lo estamos arreglando.' },
  'accessibility.lede': { en: "Our goal, what doesn't work yet, and how to reach a person fast if something blocks you.", es: 'Nuestra meta, lo que todavía no funciona y cómo hablar rápido con una persona si algo te bloquea.' },
  'teen.eyebrow': { en: 'TEEN SAFETY POLICY · DRAFT', es: 'SEGURIDAD PARA ADOLESCENTES · BORRADOR' },
  'teen.title': { en: 'Teens welcome. Safety first.', es: 'Adolescentes bienvenidos. La seguridad primero.' },
  'teen.lede': { en: "How we look out for members 14 to 17, online and at events. Parents and guardians, this one's for you too.", es: 'Cómo cuidamos a los miembros de 14 a 17 años, en línea y en los eventos. Madres, padres y tutores: esto también es para ustedes.' },
  'clips.eyebrow': { en: 'CLIP RULES · DRAFT', es: 'REGLAS PARA CLIPS · BORRADOR' },
  'clips.title': { en: 'Post your take. Keep it kind.', es: 'Comparte lo que piensas. Con respeto.' },
  'clips.lede': { en: 'What you can post to the Reel, what comes down, and how to report or appeal.', es: 'Qué puedes publicar en Clips, qué se quita y cómo reportar o apelar.' },
  'conduct.eyebrow': { en: 'CODE OF CONDUCT · DRAFT', es: 'CÓDIGO DE CONDUCTA · BORRADOR' },
  'conduct.title': { en: 'Be cool to each other.', es: 'Trátense bien.' },
  'conduct.lede': { en: "How we treat each other at events and online, what's not OK, and what happens when someone crosses the line.", es: 'Cómo nos tratamos en los eventos y en línea, qué no está bien y qué pasa cuando alguien se pasa de la raya.' },

  'privacy.jump': { en: 'See what this browser saved', es: 'Mira lo que guardó este navegador' },
  'accessibility.jump': { en: 'Get help fast', es: 'Pide ayuda rápido' },
  'teen.jump': { en: "If something's wrong", es: 'Si algo anda mal' },
  'clips.jump': { en: 'How to report a clip', es: 'Cómo reportar un clip' },
  'conduct.jump': { en: 'How to report something', es: 'Cómo reportar algo' },

  // ---- shared chrome
  'draft.title': { en: 'DRAFT, not legal advice', es: 'BORRADOR, no es asesoría legal' },
  'draft.body': { en: 'Nothing here is in effect yet. The chapter and its lawyer review every word before launch.', es: 'Nada de esto está vigente todavía. El capítulo y su abogado revisan cada palabra antes del lanzamiento.' },
  'tldr.title': { en: 'The short version', es: 'En resumen' },
  'tldr.sub': { en: 'Read this if nothing else.', es: 'Si no lees nada más, lee esto.' },
  'toc.title': { en: 'On this page', es: 'En esta página' },
  'full.title': { en: 'The full version', es: 'La versión completa' },
  'noscript': { en: 'The policy text loads with JavaScript. Turn it on to read the short version and every section.', es: 'El texto de la política se carga con JavaScript. Actívalo para leer el resumen y cada sección.' },

  // ---- what this browser remembers + Forget me
  'device.eyebrow': { en: 'YOUR DEVICE', es: 'TU DISPOSITIVO' },
  'device.title': { en: 'What this browser remembers', es: 'Lo que este navegador recuerda' },
  'device.sub': { en: 'Everything this site saved on this device, live. None of it has been sent anywhere.', es: 'Todo lo que este sitio guardó en este dispositivo, en vivo. Nada de esto se ha enviado a ningún lado.' },
  'device.member': { en: 'Member profile', es: 'Perfil de miembro' },
  'device.ref': { en: 'Invite code from a link', es: 'Código de invitación de un enlace' },
  'device.rsvp': { en: 'Event RSVPs', es: 'Confirmaciones a eventos' },
  'device.quiz': { en: 'Quiz results', es: 'Resultados del quiz' },
  'device.maker': { en: 'Card drafts', es: 'Borradores de tarjetas' },
  'device.stickers': { en: 'Stickers and streak', es: 'Stickers y racha' },
  'device.clips': { en: 'Clips and likes', es: 'Clips y me gusta' },
  'device.other': { en: 'Other saved items', es: 'Otras cosas guardadas' },
  'device.none': { en: 'Nothing', es: 'Nada' },
  'device.yes': { en: 'Saved', es: 'Guardado' },
  'device.n': { en: '{n} saved', es: '{n} guardados' },
  'device.keeps': { en: 'Forgetting keeps only your theme and motion settings.', es: 'Al olvidarte solo se quedan tus ajustes de tema y de movimiento.' },
  'forget.button': { en: 'Forget me on this device', es: 'Olvidarme en este dispositivo' },
  'forget.yes': { en: 'Yes, forget me', es: 'Sí, olvídame' },
  'forget.no': { en: 'Keep it', es: 'Mejor no' },

  // ---- sources, more policies
  'sources.title': { en: 'Laws and sources', es: 'Leyes y fuentes' },
  'more.title': { en: 'More policies', es: 'Más políticas' },
  'more.privacy': { en: 'What we keep and how to delete it.', es: 'Qué guardamos y cómo borrarlo.' },
  'more.teen': { en: 'How we look out for members 14 to 17.', es: 'Cómo cuidamos a los miembros de 14 a 17 años.' },
  'more.clips': { en: 'What you can post, and what comes down.', es: 'Qué puedes publicar y qué se quita.' },
  'more.conduct': { en: 'How we treat each other, and how to report.', es: 'Cómo nos tratamos y cómo reportar.' },
  'more.accessibility': { en: "What works, what doesn't yet, and how to get help.", es: 'Lo que funciona, lo que todavía no y cómo pedir ayuda.' },
  'more.here': { en: "You're here", es: 'Estás aquí' },
  'share.lead': { en: 'Policies nobody reads? The short version takes 30 seconds.', es: '¿Políticas que nadie lee? El resumen se lee en 30 segundos.' }
};
