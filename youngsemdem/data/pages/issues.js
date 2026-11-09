/*!
 * data/pages/issues.js: page copy for issues.html (W3). EN + ES.
 * Static strings for data-t="issues:<key>" and runtime labels for assets/js/pages/issues.js. Every
 * issue, fact, source and action renders from data/issues.js (the single source); the nine titles
 * here are only the no-JS fallback for the jump tiles and section headings. The two stats in the
 * context strip repeat data/issues.js context.youngVoters (SOE District Demographic Analysis, active
 * voters, Jul 1, 2026), checked Mon, Nov 9, 2026. Spanish is a draft pending native review.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.pages = window.YSD_DATA.pages || {};
window.YSD_DATA.pages.issues = {
  'og.kicker': { en: '9 LOCAL ISSUES', es: '9 TEMAS LOCALES' },
  'og.alt': { en: 'The Seminole numbers behind the headlines: nine local issues, sourced, each with one thing you can do. Young Democrats of Seminole County, DEMO preview.', es: 'Los datos de Seminole detrás de los titulares: nueve temas locales, con fuentes, cada uno con algo que puedes hacer. Young Democrats of Seminole County, vista previa DEMO.' },

  'hero.eyebrow': { en: 'ISSUES · SOURCED', es: 'TEMAS · CON FUENTES' },
  'hero.title1': { en: 'Nine issues.', es: 'Nueve temas.' },
  'hero.title2': { en: 'Real numbers.', es: 'Datos reales.' },
  'hero.sub': { en: 'Rent, heat, schools, SunRail and more: the Seminole numbers, every source a tap away, and one thing you can do about each.', es: 'Alquiler, calor, escuelas, SunRail y más: los datos de Seminole, cada fuente a un toque y algo que puedes hacer en cada tema.' },
  'hero.cta2': { en: 'Jump to an issue', es: 'Ir a un tema' },
  'sheet.label': { en: 'The nine issues', es: 'Los nueve temas' },

  'issue.housing': { en: 'Rent and housing', es: 'Alquiler y vivienda' },
  'issue.heat': { en: 'Heat, storms and home insurance', es: 'Calor, tormentas y seguros de vivienda' },
  'issue.repro': { en: 'Reproductive freedom', es: 'Libertad reproductiva' },
  'issue.lgbtq': { en: 'LGBTQ+ freedom', es: 'Libertad LGBTQ+' },
  'issue.schools': { en: 'Schools and the freedom to read', es: 'Escuelas y libertad para leer' },
  'issue.wages': { en: 'Wages and cost of living', es: 'Sueldos y costo de vida' },
  'issue.transit': { en: 'Transit and SunRail', es: 'Transporte y SunRail' },
  'issue.water': { en: 'Lakes, rivers and clean water', es: 'Lagos, ríos y agua limpia' },
  'issue.voting': { en: 'Voting rights', es: 'Derecho al voto' },

  'ctx.eyebrow': { en: 'WHO WE’RE TALKING WITH', es: 'CON QUIÉN HABLAMOS' },
  'ctx.title': { en: 'The biggest group of young voters here has no party, and that’s fine', es: 'El grupo más grande de votantes jóvenes aquí no tiene partido, y está bien' },
  'ctx.young': { en: 'of Seminole voters are 18 to 40 (the county’s own age band)', es: 'del electorado de Seminole tiene de 18 a 40 años (el rango de edad del propio condado)' },
  'ctx.npa': { en: 'The biggest group of them: no party', es: 'El grupo más grande entre ellos: sin partido' },
  'ctx.src': { en: 'SOE data, Jul 1, 2026', es: 'Datos de la oficina electoral, 1 de julio de 2026' },
  'ctx.ydsc': { en: 'YDSC says it’s dedicated to increasing young voter turnout, advocating for issues that affect young people and supporting Democratic candidates in Seminole County.', es: 'YDSC dice que se dedica a aumentar la participación de votantes jóvenes, defender los temas que afectan a la gente joven y apoyar a candidatos demócratas en el condado de Seminole.' },
  'ctx.ydscSrc': { en: 'YDSC’s ActBlue page', es: 'Página de YDSC en ActBlue' },
  'ctx.note': { en: 'Every number below links to where it came from. No source, no number.', es: 'Cada dato de abajo enlaza a su origen. Sin fuente, no hay dato.' },

  'nojs': { en: 'The facts, sources and actions for each issue show up with JavaScript on.', es: 'Los datos, las fuentes y las acciones de cada tema aparecen con JavaScript activado.' },

  'quiz.eyebrow': { en: 'NOT SURE WHERE TO START?', es: '¿NO SABES POR DÓNDE EMPEZAR?' },
  'quiz.title': { en: 'Find your issue in four taps', es: 'Encuentra tu tema en cuatro toques' },
  'quiz.sub': { en: 'Four quick questions, one match, and three things you can do about it. Your answers aren’t saved or sent.', es: 'Cuatro preguntas rápidas, un tema para ti y tres cosas que puedes hacer. Tus respuestas no se guardan ni se envían.' },
  'join.title': { en: 'Care about one of these? Come to one thing.', es: '¿Te importa alguno de estos temas? Ven a una cosa.' },
  'join.sub': { en: 'Joining is free, events are free, and nobody quizzes you on policy. First time? Perfect.', es: 'Unirte es gratis, los eventos son gratis y nadie te va a examinar sobre política. ¿Primera vez? Perfecto.' },
  'share.lead': { en: 'Send this to the friend who keeps asking “is it just me?”', es: 'Mándaselo a quien siempre pregunta “¿soy solo yo?”' },

  // runtime labels (assets/js/pages/issues.js)
  'js.numbers': { en: 'The numbers', es: 'Los datos' },
  'js.doing': { en: 'What we’re doing', es: 'Lo que hacemos' },
  'js.do': { en: 'One thing you can do', es: 'Algo que puedes hacer' },
  'js.source': { en: 'Source', es: 'Fuente' },
  'js.checked': { en: 'Checked {date}.', es: 'Revisado el {date}.' },
  'js.computed': { en: 'We did the math from this source.', es: 'Hicimos el cálculo con esta fuente.' },
  'js.official': { en: 'Official site', es: 'Sitio oficial' },
  'js.card': { en: 'Share the card', es: 'Compartir la tarjeta' },
  'js.cardReady': { en: 'Card saved. Send it to one person you’d actually text.', es: 'Tarjeta guardada. Mándasela a una persona a la que de verdad le escribirías.' },
  'js.cardFail': { en: 'That card didn’t load. The text is copied instead, so you can paste it anywhere.', es: 'La tarjeta no cargó. Copiamos el texto para que lo pegues donde quieras.' },
  'js.cardSource': { en: 'Source: {source}', es: 'Fuente: {source}' }
};
