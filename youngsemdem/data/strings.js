/*!
 * data/strings.js: site-wide microcopy for the Young Democrats of Seminole County (YDSC) site, EN + ES.
 * window.YSD_DATA.strings                                                       STATUS: DRAFT
 * Checked Nov 9, 2026 (checker pass): every source re-opened, the mail-ballot lines realigned with
 * data/civic.js, the bylaw lines re-quoted from the dues page, and claims about other features matched
 * to their data files.
 *
 * Every button, label, hint, consent line, validation error, success/empty/offline/404 state, toast,
 * share-sheet label, per-page SEO and Open Graph line, and prewritten share text that is not a page's
 * own content. Pages look strings up by a dotted, stable key ('cta.join', 'form.email.label').
 * Voice: docs/research/05 (binding). Facts and brand safety: docs/research/00 (binding).
 * The Spanish is written for neutral Latin American readers (Puerto Rican, Cuban, Colombian,
 * Venezuelan, Mexican), not translated word for word; same facts, same links. It still needs a
 * fluent human reviewer before launch (reviewedSpanish: false).
 * Spanish terms, the same as data/civic.js: "boleta por correo" for the mail ballot (Florida's official
 * Spanish request form, DS-DE 160, says "boleta de voto por correo"; the site uses the short form
 * everywhere), "voto por correo" only as the name of the program or page, "solicitud" for the request,
 * "inscripción" / "inscribirte" for registering, "registro de votante" for the voter record,
 * "preinscribirte" for pre-registering at 16, "modo de organizar" for the organizer quiz (data/quiz.js),
 * "Supervisor de Elecciones" for the county office, and "los Young Dems" with the article.
 *
 * Load: classic script, after assets/js/config.js (and after data/legal.js on pages that use legal
 * copy). No modules, no fetches, no functions. Node check:
 *   node -e "global.window={};require('./data/strings.js');console.log(Object.keys(window.YSD_DATA))"
 *
 * There is no chatbot or AI feature on this site, and no string here refers to one.
 *
 * ============================================================================================ SCHEMA
 * strings = {
 *   version, updated ('YYYY-MM-DD'), status ('draft'), reviewedSpanish, reviewedByCounsel,
 *   langs: ['en', 'es'],
 *   areas:   { <area>: 'what lives there' }      the ONLY allowed first key segments (KEY RULES 1)
 *   tokens:  { <name>: { from, fallback: {en,es}, suggested? } }
 *            {placeholders} filled from YSD_CONFIG via YSD.cfg(from); fallback when '' or missing.
 *            Same names and paths as data/legal.js tokens, so one fill function serves both.
 *            suggested: true = config key that config.js doesn't define yet (core may add it).
 *   vars:    { <name>: 'meaning' }               {placeholders} the calling page passes in
 *   limits:  { <keyPattern>: n }                 soft max length in characters ('*' = any segments)
 *   entries: { '<dotted.key>': Entry, ... }
 * }
 *
 * Entry = {
 *   en, es       REQUIRED. Plain text, no HTML or Markdown: render with textContent. "\n" appears only
 *                in share texts (WhatsApp, Instagram, email bodies).
 *   source       URL. REQUIRED when the line states a fact (a date, rule, number or chapter policy).
 *   sources      [URL] extra sources.   verified: 'YYYY-MM-DD' (required with source).
 *   confidence   'high' | 'med' | 'low': our read of the sourcing, for editors. Never render it.
 *   demo         true = describes made-up people, events, clips or counts. The visible text says
 *                DEMO. Render only while YSD_CONFIG.demo === true.
 *   placeholder  Draft wording someone must sign off before launch. Render it, and keep it on the
 *                launch checklist:  'legal-review' (counsel) | 'committee-status' (depends on whether
 *                the chapter is a political committee, Fla. Stat. 106.011(16) and 106.143) |
 *                'chapter-confirm' (a YDSC policy or promise the chapter hasn't confirmed).
 *   mirror       Dotted path under window.YSD_DATA (e.g. 'legal.snippets.emailConsent') whose {en,es}
 *                this entry repeats word for word. Legal copy is owned by data/legal.js; if the two
 *                ever differ, legal.js wins. Consent records must store the exact text shown.
 *   consentVersion  For consent lines: store this id with the consent record.
 *   tone         'serious' = calm template: no emoji, no exclamation mark, no confetti, no donate
 *                module beside it.
 *   showFrom, expires   ISO 8601 instants with the America/New_York offset. Don't render outside them.
 *   next         Key to render instead once `expires` has passed.
 *   recheck      'YYYY-MM-DD': re-verify the fact by this date.
 *   max          Soft max length for this entry (overrides `limits`).
 *   note         For editors and page builders. Never rendered.
 * }
 *
 * ========================================================================= KEY RULES (for page builders)
 * 1. Shape: area.subject[.detail...][.part]. The first segment must be a key of `areas`. Segments are
 *    lowerCamelCase (^[a-z][a-zA-Z0-9]*$), except a last segment that copies a code from a module,
 *    which keeps that code verbatim (error.clip.no-file, error.age.too_young), so code can look it up
 *    blindly: t('error.' + field + '.' + code).
 * 2. Keys are stable. Never rename or repurpose one. To change the meaning, add a new key and set
 *    note: 'deprecated: use <new key>' on the old one. Wording can change any time; the key can't.
 * 3. Parts: .label .hint .placeholder (form fields), .title .body (states), .aria (screen-reader
 *    version), .short (compact version), .demo (demo-mode version of the same message),
 *    .one .other (plurals: use .one when count === 1, otherwise .other; same rule in Spanish).
 * 4. Share texts: share.<page | mechanic>.<channel>, channel = sms | whatsapp | igStory | short |
 *    email.subject | email.body. Every set has all six. `short` is for X, Threads and Bluesky.
 * 5. SEO: seo.<page>.title | description | ogTitle | ogDescription. No config tokens in seo.* (they
 *    get copied into static HTML); page vars ({event}, {match}) only in template pages.
 * 6. Validation: error.<field>.<code> and warning.<field>.<code>, codes exactly as the module
 *    returns them (assets/js/members.js validate(), assets/js/clips.js result codes).
 * 7. Both languages, always, with the same {placeholders}. If you can't write the Spanish, leave the
 *    key out rather than shipping English in the es field.
 * 8. Voice (docs/research/05): sentence case; buttons verb-first, 1-4 words; errors 2 sentences max
 *    (what happened, what to do), never blaming; one exclamation mark max per screen, none on serious
 *    lines; emoji only in share texts and success toasts (one, decorative, at the end of a line),
 *    never in errors, legal, SEO or serious lines. Times as "7 pm" / "7 p. m.". No slang cosplay,
 *    no guilt, no fake urgency, no Native imagery or words. Spanish buttons: tú imperative for
 *    invitations ("Únete"), infinitive for utility actions ("Copiar enlace").
 * 9. Facts carry source + verified. Can't verify it? Link the official page instead of stating it.
 * 10. Demo: anything describing a made-up person, event, clip, quote or count gets demo: true and
 *    says DEMO in both languages.
 *
 * ========================================================================================= RENDERING
 * Suggested helper (put it in a file under assets/js/: the CSP blocks inline scripts):
 *
 *   function ysdT(key, lang, vars) {
 *     var S = window.YSD_DATA && window.YSD_DATA.strings, e = S && S.entries[key];
 *     if (!e) { if (window.YSD && YSD.log) YSD.log('strings: missing', key); return ''; }
 *     var now = Date.now();
 *     if (e.expires && now >= Date.parse(e.expires)) return e.next ? ysdT(e.next, lang, vars) : '';
 *     if (e.showFrom && now < Date.parse(e.showFrom)) return '';
 *     if (e.demo && !(window.YSD && YSD.cfg && YSD.cfg('demo', true))) return '';
 *     var s = e[lang] || e.en || '';
 *     return s.replace(/\{(\w+)\}/g, function (m, k) {
 *       if (vars && vars[k] != null) return String(vars[k]);
 *       var t = S.tokens[k]; if (!t) return m;
 *       var v = t.from && window.YSD && YSD.cfg ? YSD.cfg(t.from, '') : '';
 *       return v !== '' && v != null ? String(v) : (t.fallback[lang] || t.fallback.en);
 *     });
 *   }
 *   Plurals:  ysdT(key + (n === 1 ? '.one' : '.other'), lang, { count: n })
 *
 * Language entries (lang.switch, lang.switchAria, lang.prompt, lang.promptYes, lang.promptNo) are
 * cross-language on purpose: the `en` value is what an ENGLISH page shows, written in Spanish, to
 * invite Spanish readers over (and the reverse). Wrap them in an element with the matching lang
 * attribute (lang="es" on English pages) so screen readers pronounce them right.
 *
 * ======================================================================================= SHARE TEXTS
 * Fill {link} with YSD.share.url(path), which adds the visitor's referral code and utm tags.
 * {link} is the canonical name (docs/research/00 Conventions). data/civic.js, events.js, levels.js and
 * sharekit.js still say {url}; YSD.fill(text, { link }) in assets/js/config.js fills both, so any
 * template works: YSD.fill(entry[lang], { link: YSD.share.url(path), event, date }).
 * In sms, whatsapp, igStory and short, {link} is always the last thing in the text.
 *  - Channel links: strip the trailing {link} (or {url}) and pass the link on its own:
 *    YSD.share.links(textWithoutLink, link). SMS, WhatsApp and Bluesky get "text link" back (the same
 *    message); X and Threads carry the link in their url field; Facebook and Telegram need it there, or
 *    they share the site root and drop the referral code. Email: YSD.share.links(filledBody, link,
 *    { subject: filledSubject }).email (the body already holds the link; share.js won't add it twice).
 *  - Native share sheet: YSD.share.native({ title: <seo ogTitle>, text: textWithoutLink, url: link }),
 *    where textWithoutLink = text.replace(/\s*\{(?:link|url)\}\s*$/, '') (iMessage then shows the preview).
 *  - Instagram has no web share intent: copy the igStory text with YSD.share.copy(), offer the card
 *    image (YSD.cards), and show shareSheet.igHint.
 *  - The user can always edit the text before it sends. Never auto-send anything.
 *  - Demo events: pass the event name with its DEMO label in {event}.
 * Mechanics with time-bound facts carry showFrom/expires/next; share.result has a recheck date for
 * when the county certifies the Nov 3, 2026 results.
 *
 * =============================================================================================== SEO
 * Copy seo.* into each page's static <head> (link-preview crawlers don't run JavaScript):
 * <title>, <meta name="description">, og:title, og:description, plus og:locale en_US (es_US on
 * Spanish pages, with og:locale:alternate for the other) and twitter:card summary_large_image.
 * og:title leaves out the site name (Apple TN3156); <title> keeps "| YDSC". Mark 404 noindex.
 * Pages: home, join, events, eventInvite (single-event page, template), vote, feed (the clips wall),
 * post (upload), issues, quiz, quizResult (template), newsletter, about, privacy, accessibility,
 * notFound. Image alt text (og:image:alt) belongs with each image, so the design team writes it.
 *
 * ========================================================================================= DATE/TIME
 * Format with Intl.DateTimeFormat('en-US' | 'es-US', { timeZone: 'America/New_York' }), then follow
 * format.*: "Thu, Dec 3 · 7 pm" and "jue 3 de dic · 7 p. m.". Drop ":00", lowercase am/pm.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.strings = {
  version: 1,
  updated: "2026-11-09",
  status: "draft",
  reviewedSpanish: false,
  reviewedByCounsel: false,
  langs: ["en", "es"],

  areas: {
    brand: "Names, tagline, motto, newsletter name",
    nav: "Header, menu and footer link labels",
    a11y: "Screen-reader-only labels and announcements",
    lang: "Language toggle and language prompts",
    demo: "DEMO banner, badges and watermarks (render only while YSD_CONFIG.demo is true)",
    footer: "Footer lines: paid-for disclaimer, not-approved note, demo status, copyright",
    cta: "Buttons and action links (verb-first, 1-4 words)",
    form: "Form labels, hints, placeholders, options and consent text",
    error: "Validation and failure messages, keyed by field (or module) and code",
    warning: "Soft validation warnings that don't block submitting",
    success: "Success states after an action (title and body)",
    empty: "Empty states for lists and feeds (title and body)",
    state: "Page-level states: loading, offline, not found, generic errors",
    toast: "Short status messages (announce with role=status)",
    shareSheet: "Share sheet labels and hints",
    share: "Prewritten share texts per page and per mechanic, per channel",
    seo: "Per-page <title>, meta description, og:title, og:description",
    nudge: "Short, sourced voting heads-ups for strips, banners and cards",
    join: "Membership facts and reassurance lines for the join flow",
    event: "Event card and event page labels",
    feed: "Clip feed controls and labels",
    count: "Counts and countdowns (with .one/.other plurals)",
    format: "Date, time and list patterns",
    a11yStatement: "Short accessibility statement for footers and forms"
  },

  tokens: {
    orgShort: { from: "org.short", fallback: { en: "YDSC", es: "YDSC" } },
    minAge: { from: "org.minAge", fallback: { en: "14", es: "14" } },
    maxAge: { from: "org.ageCap", fallback: { en: "39", es: "39" } },
    duesAmount: { from: "org.dues.amount", fallback: { en: "20", es: "20" } },
    soePhone: { from: "links.vote.countyPhone", fallback: { en: "407-585-8683", es: "407-585-8683" } },
    privacyEmail: { from: "legal.privacyEmail", fallback: { en: "[privacy email, set before launch]", es: "[correo de privacidad, se configura antes del lanzamiento]" } },
    smsNumber: { from: "legal.smsNumber", fallback: { en: "[texting number, set before launch]", es: "[número de mensajes, se configura antes del lanzamiento]" } },
    mailingAddress: { from: "legal.mailingAddress", fallback: { en: "[mailing address, set before launch]", es: "[dirección postal, se configura antes del lanzamiento]" } }
  },

  vars: {
    link: "Absolute share URL from YSD.share.url(path) (carries ref and utm tags)",
    count: "A whole number",
    n: "Current step or question number",
    total: "Total steps or questions",
    firstName: "The visitor's first name",
    name: "A display name (demo bylines)",
    event: "Event title (include its DEMO label for demo events)",
    date: "Formatted date, per format.date",
    time: "Formatted time, per format.time",
    place: "Public place or generic venue (never a member's home)",
    match: "Quiz result name in the page language (from data/quiz.js)",
    election: "civic.dates[].planName in the page language, article included (\"the 2028 general election\")",
    number: "Member card number (a labeled DEMO sample in demo mode)",
    who: "Clip author's display name or handle",
    caption: "Clip caption",
    query: "What the visitor searched for",
    max: "A limit, already formatted (\"150 MB\", \"3:00\", \"300\")",
    maxSize: "Max upload size, formatted (\"150 MB\")",
    maxLength: "Max clip length, formatted (\"3 minutes\")",
    size: "This file's size, formatted",
    duration: "This clip's length, formatted",
    topic: "What a link is about, for descriptive link text",
    app: "App or network name (\"WhatsApp\")",
    what: "What a countdown counts down to",
    label: "A counter's label",
    year: "Current four-digit year",
    weekday: "Short weekday name from Intl",
    month: "Short month name from Intl",
    day: "Day of the month",
    h: "Hour, 1-12",
    mm: "Minutes, 2 digits (drop ':mm' when 00)",
    ampm: "format.ampm.am or format.ampm.pm",
    start: "Start time, formatted",
    end: "End time, formatted",
    a: "First list item",
    b: "Second list item"
  },

  limits: {
    "seo.*.title": 60,
    "seo.*.description": 160,
    "seo.*.ogTitle": 60,
    "seo.*.ogDescription": 200,
    "share.*.sms": 320,
    "share.*.whatsapp": 520,
    "share.*.igStory": 200,
    "share.*.short": 185,
    "share.*.email.subject": 70,
    "cta.*": 32,
    "toast.*": 100,
    "error.*": 170,
    "nav.*": 30
  },

  entries: {
    // ================================================================================== BRAND
    "brand.name": { en: "Young Democrats of Seminole County", es: "Young Democrats of Seminole County", note: "Proper name: never translate." },
    "brand.short": { en: "YDSC", es: "YDSC" },
    "brand.nickname": { en: "Young Dems", es: "Young Dems", note: "Casual name. In Spanish copy, write \"los Young Dems\"." },
    "brand.tagline": {
      en: "Young Democrats in Seminole County, ages {minAge} to {maxAge}.",
      es: "Jóvenes demócratas en el condado de Seminole, de {minAge} a {maxAge} años.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "YDSC dues page: at least 14 and under 40. Never write \"40 and under\"."
    },
    "brand.chapterOf": {
      en: "A chapter of the Florida Young Democrats.",
      es: "Un capítulo de los Florida Young Democrats.",
      source: "https://www.floridayoungdems.com/current-chapters", verified: "2026-11-09", confidence: "med",
      recheck: "2027-04-01",
      note: "FYD's chapter list (find-your-chapter now redirects to current-chapters) shows a Seminole County chapter with @youngsemdems. It shows no charter dates, so confirm the charter is current for 2026-27. The list also names a chapter officer: never copy that name into site copy."
    },
    "brand.motto": { en: "Local politics is a group project.", es: "La política local es un trabajo en equipo.", note: "Spanish uses the natural idiom (\"trabajo en equipo\") rather than a calque of \"group project\"." },
    "brand.welcome": { en: "Come as you are. Bring a friend.", es: "Ven como eres. Trae a alguien." },
    "brand.newsletter": {
      en: "The Thursday Letter", es: "La Carta del Jueves",
      placeholder: "chapter-confirm",
      note: "Newsletter name and weekly Thursday cadence from docs/research/05. The chapter has to agree to keep that promise before launch."
    },

    // ==================================================================================== NAV
    "nav.aria": { en: "Main menu", es: "Menú principal" },
    "nav.footerAria": { en: "Site links", es: "Enlaces del sitio" },
    "nav.home": { en: "Home", es: "Inicio" },
    "nav.vote": { en: "Vote", es: "Votar" },
    "nav.events": { en: "Events", es: "Eventos" },
    "nav.issues": { en: "Issues", es: "Temas" },
    "nav.quiz": { en: "Quiz", es: "Quiz" },
    "nav.feed": { en: "Clips", es: "Clips" },
    "nav.post": { en: "Post a clip", es: "Sube un clip" },
    "nav.newsletter": { en: "Newsletter", es: "Boletín" },
    "nav.about": { en: "About", es: "Quiénes somos" },
    "nav.join": { en: "Join", es: "Únete" },
    "nav.donate": { en: "Chip in", es: "Aporta" },
    "nav.dues": { en: "Pay dues", es: "Pagar la cuota" },
    "nav.privacy": { en: "Privacy", es: "Privacidad" },
    "nav.accessibility": { en: "Accessibility", es: "Accesibilidad" },
    "nav.policies": { en: "Policies", es: "Políticas" },
    "nav.more": { en: "More", es: "Más" },
    "nav.menu": { en: "Menu", es: "Menú" },
    "nav.social": { en: "Follow along", es: "Síguenos", note: "Render social links only when YSD_CONFIG.social.<net>.url is set (handles aren't confirmed)." },
    "nav.countyParty": {
      en: "Seminole County Democratic Party", es: "Seminole County Democratic Party",
      source: "https://semdems.com/", verified: "2026-11-09", confidence: "high", max: 34,
      note: "Proper name, as the party's own site titles itself (over the nav limit on purpose; footer use). Link it with YSD.cfg('links.countyParty') (https://semdems.com/, checked 2026-11-09); render the link only while it's set. A link, not an endorsement."
    },
    "nav.elections": { en: "Supervisor of Elections", es: "Supervisor de Elecciones", note: "Footer link to links.vote.countyElections." },

    // =================================================================================== A11Y
    "a11y.skip": { en: "Skip to main content", es: "Saltar al contenido principal" },
    "a11y.logo": { en: "Young Democrats of Seminole County, home", es: "Young Democrats of Seminole County, inicio" },
    "a11y.menuOpen": { en: "Open menu", es: "Abrir menú" },
    "a11y.menuClose": { en: "Close menu", es: "Cerrar menú" },
    "a11y.close": { en: "Close", es: "Cerrar" },
    "a11y.backToTop": { en: "Back to top", es: "Volver arriba" },
    "a11y.newTab": { en: "(opens in a new tab)", es: "(se abre en otra pestaña)" },
    "a11y.offsite": { en: "(leaves this site)", es: "(sale de este sitio)" },
    "a11y.official": { en: "(official government site)", es: "(sitio oficial del gobierno)" },
    "a11y.required": { en: "required", es: "obligatorio" },
    "a11y.loading": { en: "Loading", es: "Cargando" },
    "a11y.progress": { en: "Step {n} of {total}", es: "Paso {n} de {total}" },
    "a11y.pauseMotion": { en: "Pause animations", es: "Pausar animaciones" },
    "a11y.playMotion": { en: "Play animations", es: "Reproducir animaciones" },
    "a11y.shareOptions": { en: "Share options", es: "Opciones para compartir" },
    "a11y.languageGroup": { en: "Choose a language", es: "Elige un idioma" },
    "a11y.counter": { en: "{label}: {count}", es: "{label}: {count}", note: "Announce counters once on load, not on every demo tick." },
    "a11y.demoBadge": { en: "DEMO: made up for this preview", es: "DEMO: inventado para esta vista previa", demo: true },

    // =================================================================================== LANG
    "lang.label": { en: "Language", es: "Idioma" },
    "lang.current": { en: "English", es: "Español" },
    "lang.switch": { en: "Español", es: "English", note: "Cross-language: an English page shows \"Español\" (lang=\"es\")." },
    "lang.switchAria": { en: "Leer esta página en español", es: "Read this page in English", note: "Cross-language. Set lang on the element." },
    "lang.prompt": {
      en: "¿Prefieres leer en español? Esta página también está en español.",
      es: "Prefer English? This page is in English too.",
      note: "Cross-language: show on an English page when the browser prefers Spanish (and the reverse). Show once; remember the choice."
    },
    "lang.promptYes": { en: "Ver en español", es: "Switch to English", note: "Cross-language." },
    "lang.promptNo": { en: "Seguir en inglés", es: "Stay in Spanish", note: "Cross-language." },
    "lang.unavailable": {
      en: "This page isn't available in English yet, so you're seeing the Spanish version.",
      es: "Esta página todavía no está en español, así que te mostramos la versión en inglés."
    },

    // =================================================================================== DEMO
    "demo.banner": {
      en: "DEMO: This is a preview of the Young Democrats of Seminole County site for the chapter to review. Anything marked DEMO is made up, and forms don't send anything.",
      es: "DEMO: Esta es una vista previa del sitio de los Young Democrats of Seminole County para que el capítulo la revise. Todo lo marcado DEMO es inventado, y los formularios no envían nada.",
      demo: true,
      note: "Top of every page while YSD_CONFIG.demo is true. Dismissing collapses it to demo.bannerShort; it never disappears."
    },
    "demo.bannerShort": { en: "DEMO preview. Forms don't send anything.", es: "Vista previa DEMO. Los formularios no envían nada.", demo: true },
    "demo.bannerMore": { en: "What's real here?", es: "¿Qué es real aquí?" },
    "demo.bannerDismiss": { en: "Got it", es: "Entendido" },
    "demo.explain": {
      en: "Real: the voting rules, dates and official links, all sourced. DEMO: the people, events, clips, quotes and counts. Before launch, the DEMO items come down and the forms get connected.",
      es: "Real: las reglas para votar, las fechas y los enlaces oficiales, todo con fuentes. DEMO: las personas, los eventos, los clips, las citas y los números. Antes del lanzamiento quitamos lo DEMO y conectamos los formularios.",
      demo: true
    },
    "demo.badge": { en: "DEMO", es: "DEMO", demo: true },
    "demo.badgeEvent": { en: "DEMO event", es: "Evento DEMO", demo: true },
    "demo.badgePerson": { en: "DEMO person", es: "Persona DEMO", demo: true },
    "demo.badgeNumber": { en: "DEMO number", es: "Número DEMO", demo: true },
    "demo.badgeQuote": { en: "DEMO quote", es: "Cita DEMO", demo: true },
    "demo.badgeClip": { en: "DEMO clip", es: "Clip DEMO", demo: true },
    "demo.byline": { en: "{name} (DEMO)", es: "{name} (DEMO)", demo: true, note: "For demo bylines and quotes. Never a real officer's name." },
    "demo.counters": { en: "DEMO numbers, made up so the preview looks alive.", es: "Números DEMO, inventados para que la vista previa se vea con vida.", demo: true },
    "demo.watermark": { en: "DEMO · not a real member card", es: "DEMO · no es una tarjeta de miembro real", demo: true },
    "demo.formNotice": {
      en: "DEMO preview: forms here don't send anything. Everything stays in your browser.",
      es: "Vista previa DEMO: los formularios no envían nada. Todo se queda en tu navegador.",
      demo: true, mirror: "legal.snippets.demoNotice"
    },

    // ================================================================================= FOOTER
    "footer.paidFor": {
      en: "Paid for by [committee name and address placeholder]",
      es: "Pagado por [nombre y dirección del comité: pendiente]",
      placeholder: "committee-status",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html",
      verified: "2026-11-09", confidence: "high",
      note: "Ruling in docs/research/00. When counsel settles the committee question, use YSD_CONFIG.legal.paidFor with the 106.143(1)(c) wording: \"paid political advertisement\" or \"pd. pol. adv.\", payer name and address, and whether it was paid for or provided in kind. 106.143(9) lets Spanish pages give it in Spanish. Show it on every page and share card."
    },
    "footer.notApproved": {
      en: "Not approved by any candidate. [Placeholder: depends on the chapter's committee status.]",
      es: "Ningún candidato aprobó este contenido. [Texto provisional: depende del estatus de comité del capítulo.]",
      placeholder: "committee-status",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html",
      sources: ["http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.071.html"],
      verified: "2026-11-09", confidence: "med",
      note: "Checked against the 2026 statutes: 106.143(5)(b) makes an independent spender give the newspaper, station or other medium a written statement that no candidate approved the ad; it does not put that line on the ad itself. The on-ad wording for independent expenditures is 106.071(2): \"Paid political advertisement paid for by (name and address) independently of any (candidate or committee).\" Whether any of it applies depends on the committee question (report 06, D2). Counsel picks the final line or drops this one."
    },
    "footer.demoStatus": {
      en: "DEMO site for the chapter's review. YDSC hasn't approved it yet.",
      es: "Sitio DEMO para que el capítulo lo revise. YDSC todavía no lo ha aprobado.",
      demo: true,
      note: "Status per docs/research/00 (Kira is getting sign-off, Nov 9, 2026). Update the day the chapter approves."
    },
    "footer.copyright": { en: "© {year} Young Democrats of Seminole County", es: "© {year} Young Democrats of Seminole County", note: "Fill {year} at runtime so it never goes stale." },
    "footer.officialHelp": {
      en: "Voting questions? The official source is the Seminole County Supervisor of Elections.",
      es: "¿Dudas sobre cómo votar? La fuente oficial es la oficina del Supervisor de Elecciones del condado de Seminole.",
      source: "https://voteseminole.gov/", verified: "2026-11-09", confidence: "high"
    },
    "footer.madeIn": { en: "Made in Seminole County.", es: "Hecho en el condado de Seminole." },

    // ==================================================================================== CTA
    "cta.join": { en: "Count me in", es: "Cuenta conmigo" },
    "cta.joinLong": { en: "Join the Young Dems", es: "Únete a los Young Dems" },
    "cta.rsvp": { en: "Save my seat", es: "Guárdame un lugar" },
    "cta.rsvpCancel": { en: "I can't make it", es: "No puedo ir" },
    "cta.going": { en: "I'm going", es: "Voy" },
    "cta.waitlist": { en: "Join the waitlist", es: "Anótame en la lista de espera", note: "Same as data/events.js labels.waitlist." },
    "cta.share": { en: "Share", es: "Compartir" },
    "cta.shareGroup": { en: "Send to the group chat", es: "Mándalo al grupo" },
    "cta.textFriend": { en: "Text a friend", es: "Mándaselo a alguien" },
    "cta.copyLink": { en: "Copy link", es: "Copiar enlace" },
    "cta.shareCard": { en: "Share my card", es: "Compartir mi tarjeta" },
    "cta.saveCard": { en: "Save the image", es: "Guardar la imagen" },
    "cta.inviteThree": { en: "Invite 3 friends", es: "Invita a 3 personas" },
    "cta.addCalendar": { en: "Add to calendar", es: "Agregar al calendario" },
    "cta.googleCalendar": { en: "Google Calendar", es: "Google Calendar" },
    "cta.icsCalendar": { en: "Apple or Outlook", es: "Apple u Outlook", note: "Downloads the .ics file from YSD.cal." },
    "cta.subscribeCalendar": { en: "Subscribe to the calendar", es: "Suscribirme al calendario" },
    "cta.takeQuiz": { en: "Take the quiz", es: "Haz el quiz" },
    "cta.findIssue": { en: "Find your issue", es: "Encuentra tu tema" },
    "cta.findEra": { en: "Find your era", es: "Descubre tu modo" },
    "cta.makePlan": { en: "Make my plan", es: "Hacer mi plan" },
    "cta.pledge": { en: "I'm in", es: "Me comprometo" },
    "cta.checkRegistration": { en: "Check my registration", es: "Revisar mi inscripción" },
    "cta.register": { en: "Register to vote", es: "Inscribirme para votar" },
    "cta.preRegister": {
      en: "Pre-register at 16", es: "Preinscribirme a los 16",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      verified: "2026-11-09", confidence: "high"
    },
    "cta.mailBallotCheck": { en: "Check my mail ballot", es: "Revisar mi boleta por correo" },
    "cta.mailBallotRequest": { en: "Request a mail ballot", es: "Pedir boleta por correo" },
    "cta.mailBallotRemind": {
      en: "Remind me Jan 1", es: "Recuérdamelo el 1 de enero",
      expires: "2027-01-01T00:00:00-05:00",
      note: "Calendar reminder for Jan 1, 2027: renew the mail-ballot request if you haven't, or check My Voter Record if you renewed in November or December (data/civic.js steps[renew-mail-ballot])."
    },
    "cta.idRules": { en: "See what ID works", es: "Ver qué identificación sirve" },
    "cta.pollingPlace": { en: "Find my polling place", es: "Buscar mi lugar de votación" },
    "cta.sampleBallot": { en: "See my sample ballot", es: "Ver mi boleta de muestra" },
    "cta.callSoe": { en: "Call the elections office", es: "Llamar a la oficina electoral" },
    "cta.officialSite": { en: "Go to voteseminole.gov", es: "Ir a voteseminole.gov" },
    "cta.voteHelp": { en: "Get voting help", es: "Ayuda para votar" },
    "cta.seeEvents": { en: "See all events", es: "Ver todos los eventos" },
    "cta.host": { en: "Host a meetup", es: "Organiza una reunión" },
    "cta.watch": { en: "Watch clips", es: "Ver clips" },
    "cta.postClip": { en: "Post a clip", es: "Sube un clip" },
    "cta.sendClip": { en: "Send it in", es: "Enviar" },
    "cta.subscribe": { en: "Send me the letter", es: "Mándame la carta" },
    "cta.unsubscribe": { en: "Unsubscribe", es: "Darme de baja" },
    "cta.donate": { en: "Chip in", es: "Aporta" },
    "cta.payDues": { en: "Pay dues", es: "Pagar la cuota" },
    "cta.readAbout": { en: "More about {topic}", es: "Más sobre {topic}", note: "Descriptive link text. Never \"click here\" or a bare \"read more\"." },
    "cta.home": { en: "Back to home", es: "Volver al inicio" },
    "cta.retry": { en: "Try again", es: "Intentar de nuevo" },
    "cta.back": { en: "Back", es: "Atrás" },
    "cta.next": { en: "Next", es: "Siguiente" },
    "cta.done": { en: "Done", es: "Listo" },
    "cta.cancel": { en: "Cancel", es: "Cancelar" },
    "cta.close": { en: "Close", es: "Cerrar" },
    "cta.save": { en: "Save", es: "Guardar" },
    "cta.edit": { en: "Edit", es: "Editar" },
    "cta.remove": { en: "Remove", es: "Quitar" },
    "cta.undo": { en: "Undo", es: "Deshacer" },
    "cta.showMore": { en: "Show more", es: "Ver más" },
    "cta.showLess": { en: "Show less", es: "Ver menos" },
    "cta.loadMore": { en: "Load more", es: "Cargar más" },
    "cta.notNow": { en: "Not now", es: "Ahora no" },
    "cta.gotIt": { en: "Got it", es: "Entendido" },
    "cta.unmute": { en: "Tap for sound", es: "Toca para activar el sonido" },

    // =================================================================================== FORM
    "form.optional": { en: "(optional)", es: "(opcional)", note: "Append to optional labels. Labels never include it themselves." },
    "form.required": { en: "Required", es: "Obligatorio" },
    "form.requiredNote": { en: "Everything is optional except your first name and one way to reach you.", es: "Todo es opcional, menos tu nombre y una forma de contactarte." },
    "form.sending": { en: "Sending…", es: "Enviando…" },
    "form.saving": { en: "Saving…", es: "Guardando…" },
    "form.honeypot": { en: "Leave this empty", es: "Deja esto vacío", note: "Label for the hidden anti-spam field." },

    "form.firstName.label": { en: "First name (or what you go by)", es: "Nombre (o como te dicen)" },
    "form.lastName.label": { en: "Last name", es: "Apellido" },
    "form.email.label": { en: "Email", es: "Correo electrónico" },
    "form.email.hint": { en: "For event invites and the Thursday Letter. Unsubscribe anytime.", es: "Para invitaciones a eventos y la Carta del Jueves. Te das de baja cuando quieras." },
    "form.email.placeholder": { en: "you@example.com", es: "tu@ejemplo.com" },
    "form.phone.label": { en: "Mobile number", es: "Número de celular" },
    "form.phone.hint": { en: "We only text you if you tick the box below.", es: "Solo te enviamos mensajes de texto si marcas la casilla de abajo." },
    "form.phone.placeholder": { en: "407-555-0123", es: "407-555-0123" },
    "form.contact.hint": { en: "Email or mobile: one is enough.", es: "Correo o celular: con uno basta." },
    "form.zip.label": { en: "ZIP code", es: "Código postal" },
    "form.zip.hint": { en: "So we can invite you to things near you.", es: "Para invitarte a cosas cerca de ti." },
    "form.city.label": { en: "Where in Seminole?", es: "¿En qué parte de Seminole?", note: "Options: data/civic.js places[].name (proper nouns, not repeated here), then the three below." },
    "form.city.unincorporated": { en: "Unincorporated Seminole (not in a city)", es: "Zona no incorporada de Seminole (fuera de una ciudad)" },
    "form.city.outside": { en: "Outside Seminole County", es: "Fuera del condado de Seminole" },
    "form.city.notSure": { en: "Not sure", es: "No sé" },
    "form.age.label": { en: "How old are you?", es: "¿Cuántos años tienes?", mirror: "legal.snippets.ageLabel" },
    "form.age.hint": { en: "We ask so we can follow our teen safety rules.", es: "Te lo preguntamos para seguir nuestras reglas de seguridad para adolescentes.", mirror: "legal.snippets.ageHint" },
    "form.guardian.label": { en: "Parent or guardian email (optional)", es: "Correo de tu madre, padre o tutor legal (opcional)", mirror: "legal.snippets.guardianLabel" },
    "form.guardian.hint": {
      en: "We only use it to ask their OK before you're in a photo or clip, or before an off-site event.",
      es: "Solo lo usamos para pedir su permiso antes de que salgas en una foto o clip, o antes de un evento fuera del local.",
      mirror: "legal.snippets.guardianHint"
    },
    "form.pronouns.label": { en: "Pronouns", es: "Pronombres" },
    "form.language.label": { en: "Which language should we write to you in?", es: "¿En qué idioma te escribimos?" },
    "form.language.en": { en: "English", es: "Inglés" },
    "form.language.es": { en: "Spanish", es: "Español" },
    "form.language.both": { en: "Both", es: "Los dos" },
    "form.wants.label": { en: "What do you want from us? Pick any.", es: "¿Qué te interesa? Elige todo lo que quieras." },
    "form.wants.hint": { en: "We'll send what matches. Change it anytime.", es: "Te mandamos lo que coincida. Lo cambias cuando quieras." },
    "form.wants.social": { en: "Hangouts and socials", es: "Encuentros y salidas" },
    "form.wants.volunteer": { en: "Volunteer shifts", es: "Turnos de voluntariado" },
    "form.wants.voting": { en: "Voting reminders", es: "Recordatorios para votar" },
    "form.wants.learn": { en: "Plain-words explainers on local issues", es: "Temas locales explicados sin enredos" },
    "form.wants.create": { en: "Making videos and graphics", es: "Hacer videos y gráficos" },
    "form.wants.spanish": { en: "Events in Spanish", es: "Eventos en español" },
    "form.wants.students": { en: "Student stuff", es: "Cosas para estudiantes" },
    "form.wants.lgbtq": { en: "LGBTQ+ meetups", es: "Encuentros LGBTQ+" },
    "form.access.label": { en: "Anything that would make this easier for you?", es: "¿Algo que te lo haría más fácil?" },
    "form.access.hint": {
      en: "Rides, ASL, a quiet corner, kids in tow. Tell us and we'll do our best.",
      es: "Transporte, intérprete de lengua de señas (ASL), un rincón tranquilo, venir con tus hijos. Cuéntanos y haremos lo posible."
    },
    "form.message.label": { en: "Anything you want us to know?", es: "¿Algo que quieras contarnos?" },

    "form.rsvp.plusOne.label": { en: "Bringing someone?", es: "¿Vas con alguien?" },
    "form.rsvp.plusOne.none": { en: "Just me", es: "Solo yo" },
    "form.rsvp.plusOne.plus1": { en: "Me +1", es: "Yo +1" },
    "form.rsvp.plusOne.plus2": { en: "Me +2", es: "Yo +2" },
    "form.rsvp.showName.label": { en: "Show my first name on the “who's going” list", es: "Mostrar mi nombre en la lista de quiénes van" },
    "form.rsvp.showName.hint": { en: "First name only, and only if you tick this.", es: "Solo tu nombre, y solo si marcas esta casilla.", note: "Unchecked by default." },
    "form.rsvp.reminder.label": { en: "Remind me the day before", es: "Recuérdamelo el día anterior" },

    "form.pledge.wall.label": { en: "Add my first name and city to the public pledge wall", es: "Agregar mi nombre y ciudad al muro público de compromisos" },
    "form.pledge.wall.hint": { en: "Off unless you tick it. You can take it down anytime.", es: "Desactivado a menos que lo marques. Lo puedes quitar cuando quieras.", note: "Unchecked by default." },

    "form.clip.file.label": { en: "Your video", es: "Tu video" },
    "form.clip.file.hint": { en: "Vertical works best. MP4, MOV or WebM, up to {maxLength} and {maxSize}.", es: "En vertical se ve mejor. MP4, MOV o WebM, hasta {maxLength} y {maxSize}." },
    "form.clip.caption.label": { en: "Caption", es: "Descripción" },
    "form.clip.caption.hint": { en: "What's it about? Up to {max} characters. No last names, schools or addresses.", es: "¿De qué se trata? Hasta {max} caracteres. Sin apellidos, escuelas ni direcciones." },
    "form.clip.handle.label": { en: "Name or handle to show", es: "Nombre o usuario que quieres mostrar" },
    "form.clip.tags.label": { en: "Tags", es: "Etiquetas" },
    "form.clip.tags.hint": { en: "Up to {max}. Like: rent, transit, voting.", es: "Hasta {max}. Por ejemplo: alquiler, transporte, votar." },
    "form.clip.link.label": { en: "Or paste a TikTok, Instagram or YouTube link", es: "O pega un enlace de TikTok, Instagram o YouTube", note: "Upload consent checkboxes live in data/legal.js snippets.uploadConsent and minorsInClip; don't duplicate them here." },

    "form.newsletter.hint": {
      en: "One email a week, on Thursdays. Never more, and you can unsubscribe anytime.",
      es: "Un correo a la semana, los jueves. Nunca más, y te das de baja cuando quieras.",
      placeholder: "chapter-confirm",
      note: "A cadence promise. Only ship it if the chapter will keep it."
    },

    "form.consent.join": {
      en: "By joining, you'll get updates from {orgShort}. We never sell your info. See our Privacy Policy.",
      es: "Al unirte, recibirás novedades de {orgShort}. Nunca vendemos tus datos. Consulta nuestra Política de privacidad.",
      mirror: "legal.snippets.joinNotice", placeholder: "legal-review"
    },
    "form.consent.email": {
      en: "Email me {orgShort} news and event invites. Unsubscribe anytime.",
      es: "Envíenme por correo noticias de {orgShort} e invitaciones a eventos. Puedo darme de baja cuando quiera.",
      mirror: "legal.snippets.emailConsent", placeholder: "legal-review",
      note: "Checkbox label. Every email needs a one-click unsubscribe and a postal address ({mailingAddress}) per report 06 7.3."
    },
    "form.consent.sms": {
      en: "Text me about {orgShort} events, volunteer shifts and voting reminders from {smsNumber}. Recurring automated texts, up to 4 msgs/month. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Agreeing isn't required to join or donate. See our Privacy Policy and SMS terms.",
      es: "Envíenme mensajes de texto de {orgShort} sobre eventos, turnos de voluntariado y recordatorios para votar desde {smsNumber}. Mensajes automatizados recurrentes, hasta 4 al mes. Pueden aplicarse tarifas de mensajes y datos. Responde HELP para ayuda o STOP para cancelar. Aceptar no es requisito para unirte ni para donar. Consulta nuestra Política de privacidad y los términos de SMS.",
      mirror: "legal.snippets.smsConsent.label", consentVersion: "sms-consent-2026-11-09-draft",
      placeholder: "legal-review",
      source: "https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf",
      sources: ["https://www.law.cornell.edu/cfr/text/47/64.1200"],
      verified: "2026-11-09", confidence: "high",
      note: "PLACEHOLDER pending legal review (report 06 7.2). Checkbox UNCHECKED by default, never required. Store consentVersion, the exact text shown, timestamp, page, IP and number. Link the privacy policy and SMS terms right next to it. Hide for members under 18 (form.consent.smsTeen)."
    },
    "form.consent.smsTeen": { en: "Texts are for members 18 and older for now.", es: "Por ahora, los mensajes de texto son solo para miembros de 18 años o más.", mirror: "legal.snippets.smsConsent.teenNote", placeholder: "legal-review" },
    "form.consent.privacyLink": { en: "Privacy Policy", es: "Política de privacidad" },
    "form.consent.smsTermsLink": { en: "SMS terms", es: "Términos de SMS" },
    "form.consent.uploadRules": { en: "Clip Rules", es: "Reglas para clips" },

    // ================================================================================== ERROR
    "error.required": { en: "This one's required.", es: "Este campo es obligatorio." },
    "error.tooLong": { en: "That's a bit long. Keep it under {max} characters.", es: "Es un poco largo. Usa menos de {max} caracteres." },
    "error.firstName.required": { en: "What should we call you? Add a first name.", es: "¿Cómo te llamamos? Escribe tu nombre." },
    "error.email.required": { en: "Add an email or a mobile number so we can reach you.", es: "Agrega un correo o un número de celular para poder contactarte.", note: "members.validate returns email 'required' when both email and phone are empty." },
    "error.email.invalid": { en: "That email doesn't look right. Check for a missing @ or a typo.", es: "Ese correo no se ve bien. Revisa si falta la @ o hay un error." },
    "error.email.missingAt": { en: "That email's missing an @. Happens to everyone.", es: "A ese correo le falta la @. Le pasa a cualquiera.", note: "Optional page-side check before members.validate." },
    "error.phone.invalid": { en: "Use a 10-digit US mobile number, like 407-555-0123.", es: "Usa un número de celular de EE. UU. de 10 dígitos, como 407-555-0123." },
    "error.zip.invalid": { en: "ZIP codes are 5 digits, like 32771.", es: "El código postal tiene 5 dígitos, como 32771." },
    "error.age.invalid": { en: "Enter your age as a number, like 22.", es: "Escribe tu edad en números, por ejemplo 22." },
    "error.age.too_young": {
      en: "Thanks for your interest! Members need to be at least {minAge}. We didn't save anything you typed. Everything on this site is still yours to read.",
      es: "¡Gracias por tu interés! Para ser miembro necesitas tener al menos {minAge} años. No guardamos nada de lo que escribiste. Puedes seguir leyendo todo lo que hay en este sitio.",
      mirror: "legal.snippets.ageTooYoung", max: 200,
      note: "Show only after validate() returns too_young (neutral age screen, FTC COPPA FAQ)."
    },
    "error.age.over_age_cap": {
      en: "Members are {minAge} to {maxAge}, so you're past the cutoff. Everything on this site is still yours to use.",
      es: "Los miembros tienen de {minAge} a {maxAge} años, así que ya pasaste el límite. Todo lo que hay en este sitio sigue siendo para ti.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "Only when YSD_CONFIG.members.enforceAgeCap is true. Otherwise use warning.age.over_age_cap."
    },
    "error.sms.noPhone": { en: "Add a mobile number to get texts, or untick the box.", es: "Agrega un número de celular para recibir mensajes, o desmarca la casilla." },
    "error.consent.required": { en: "Tick this box to post your clip.", es: "Marca esta casilla para subir tu clip." },
    "error.link.invalid": {
      en: "That doesn't look like a TikTok, Instagram or YouTube link. Copy it from the app's Share button and try again.",
      es: "Ese no parece un enlace de TikTok, Instagram o YouTube. Cópialo desde el botón Compartir de la app e inténtalo de nuevo."
    },
    "error.form.summary.one": { en: "1 thing needs a fix before this can send.", es: "Hay 1 cosa por corregir antes de enviar." },
    "error.form.summary.other": { en: "{count} things need a fix before this can send.", es: "Hay {count} cosas por corregir antes de enviar." },
    "error.submit.failed": { en: "That didn't send. Your answers are still here, so try again in a minute.", es: "No se envió. Tus respuestas siguen aquí, así que inténtalo de nuevo en un minuto." },
    "error.submit.offline": { en: "You're offline, so this didn't send. Your answers are still here: try again once you're connected.", es: "No tienes conexión, así que esto no se envió. Tus respuestas siguen aquí: inténtalo cuando vuelvas a conectarte." },
    "error.storage.blocked": { en: "Your browser is blocking storage, so we can't save this here. Everything else still works.", es: "Tu navegador está bloqueando el almacenamiento, así que no podemos guardar esto aquí. Todo lo demás funciona." },
    "error.share.failed": { en: "Couldn't share or copy that. Press and hold the link to copy it.", es: "No pudimos compartir ni copiar. Mantén presionado el enlace para copiarlo." },
    "error.calendar.failed": { en: "Couldn't make the calendar file. Add the date by hand: {date}, {time}.", es: "No pudimos crear el archivo de calendario. Agrega la fecha a mano: {date}, {time}." },
    "error.clip.no-file": { en: "Choose a video to post.", es: "Elige un video para subir.", note: "assets/js/clips.js codes: assign YSD.clips.messages[code] = ysdT('error.clip.' + code, lang)." },
    "error.clip.type": { en: "That file isn't a video we can post. Try MP4, MOV or WebM.", es: "Ese archivo no es un video que podamos publicar. Prueba con MP4, MOV o WebM." },
    "error.clip.empty": { en: "That video file is empty. Try exporting it again.", es: "Ese archivo de video está vacío. Prueba exportarlo de nuevo." },
    "error.clip.size": { en: "Videos can be up to {max}. This one is {size}.", es: "Los videos pueden pesar hasta {max}. Este pesa {size}." },
    "error.clip.duration": { en: "Videos can be up to {max} long. This one is {duration}.", es: "Los videos pueden durar hasta {max}. Este dura {duration}." },
    "error.clip.too-short": { en: "That video is too short to post.", es: "Ese video es demasiado corto para publicarlo." },
    "error.clip.unplayable": { en: "This browser can't play that video. Try exporting it as MP4.", es: "Este navegador no puede reproducir ese video. Prueba exportarlo como MP4." },
    "error.clip.timeout": { en: "That video took too long to open. Try a shorter clip.", es: "Ese video tardó demasiado en abrir. Prueba con un clip más corto." },
    "error.clip.missing": { en: "That video isn't saved on this device anymore.", es: "Ese video ya no está guardado en este dispositivo." },
    "error.clip.demo": { en: "DEMO: uploads are off, so your clip stays on this device.", es: "DEMO: las subidas están desactivadas, así que tu clip se queda en este dispositivo.", demo: true },
    "error.clip.no-endpoint": { en: "Video uploads aren't set up yet.", es: "Las subidas de video todavía no están configuradas." },
    "error.clip.network": { en: "The upload stopped. Check your connection and try again.", es: "La subida se detuvo. Revisa tu conexión e inténtalo de nuevo." },
    "error.clip.aborted": { en: "Upload canceled.", es: "Subida cancelada." },
    "error.clip.create-failed": { en: "We couldn't start the upload. Try again in a minute.", es: "No pudimos empezar la subida. Inténtalo de nuevo en un minuto." },
    "error.clip.upload-failed": { en: "The upload didn't finish. Try again in a minute.", es: "La subida no terminó. Inténtalo de nuevo en un minuto." },
    "error.clip.interrupted": { en: "The upload stopped when the page closed. Tap “Try again”.", es: "La subida se detuvo cuando se cerró la página. Toca “Intentar de nuevo”.", note: "Names the cta.retry button in each language." },
    "error.clip.processing-failed": { en: "Your clip uploaded but couldn't be processed. Try exporting it as MP4 and posting it again.", es: "Tu clip se subió, pero no se pudo procesar. Prueba exportarlo como MP4 y súbelo de nuevo.", note: "clips.js status() sets upload.error = 'processing-failed' when the video host reports an error." },

    // ================================================================================ WARNING
    "warning.zip.outside_county": {
      en: "That ZIP looks like it's outside Seminole. You're still welcome, we just might not have events near you.",
      es: "Ese código postal parece estar fuera de Seminole. Igual te damos la bienvenida, aunque quizás no tengamos eventos cerca de ti."
    },
    "warning.age.over_age_cap": {
      en: "Members are {minAge} to {maxAge}, so you're past the cutoff. Everything on this site is still yours to use.",
      es: "Los miembros tienen de {minAge} a {maxAge} años, así que ya pasaste el límite. Todo lo que hay en este sitio sigue siendo para ti.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high"
    },

    // ================================================================================ SUCCESS
    "success.join.title": { en: "You're in.", es: "Ya eres parte." },
    "success.join.body": { en: "Welcome to the Young Dems. Next step: pick one event, or send your invite link to one friend.", es: "Te damos la bienvenida a los Young Dems. Lo que sigue: elige un evento o manda tu enlace de invitación a alguien." },
    "success.join.letter": { en: "Your first Thursday Letter lands Thursday morning.", es: "Tu primera Carta del Jueves llega el jueves por la mañana.", placeholder: "chapter-confirm", note: "Only when they opted into email. Matches data/newsletter.js cadence (Thursdays, 7 am). \"This week\" was wrong for anyone joining after Thursday's send." },
    "success.join.signoff": { en: "Now go drink some water.", es: "Ahora tómate un vaso de agua." },
    "success.join.invite": { en: "Here's your invite link. Send it to one person you'd actually want at a meetup.", es: "Aquí está tu enlace de invitación. Mándaselo a una persona que de verdad quieras ver en una reunión." },
    "success.join.demo": { en: "DEMO: nothing left this browser. On the live site, this is where your welcome email would start.", es: "DEMO: nada salió de este navegador. En el sitio real, aquí empezaría tu correo de bienvenida.", demo: true },
    "success.rsvp.title": { en: "Seat saved.", es: "Lugar reservado." },
    "success.rsvp.body": { en: "Add it to your calendar so future you remembers too.", es: "Agrégalo a tu calendario para que tu yo del futuro también se acuerde." },
    "success.rsvp.reminder": { en: "We'll remind you the day before.", es: "Te lo recordamos el día anterior.", note: "Only when they gave a way to reach them and asked for a reminder." },
    "success.rsvp.bring": { en: "Bringing someone? Send them the invite.", es: "¿Traes a alguien? Mándale la invitación." },
    "success.rsvp.demo": { en: "DEMO event: your RSVP stays in this browser.", es: "Evento DEMO: tu confirmación se queda en este navegador.", demo: true },
    "success.pledge.title": { en: "You're in for 2027 and 2028.", es: "Te comprometiste para 2027 y 2028." },
    "success.pledge.body": { en: "Your card's ready. Share it with the people who'll keep you to it.", es: "Tu tarjeta está lista. Compártela con quienes te van a recordar tu palabra." },
    "success.plan.title": { en: "Plan made.", es: "Plan listo." },
    "success.plan.body": { en: "It's saved in this browser. Add it to your calendar or text it to yourself.", es: "Quedó guardado en este navegador. Agrégalo a tu calendario o mándatelo por mensaje." },
    "success.newsletter.title": { en: "You're on the list.", es: "Ya estás en la lista." },
    "success.newsletter.body": { en: "First letter lands Thursday. If you don't see it, check your Promotions folder.", es: "La primera carta llega el jueves. Si no la ves, revisa la carpeta de Promociones.", placeholder: "chapter-confirm" },
    "success.clip.title": { en: "Clip sent.", es: "Clip enviado." },
    "success.clip.body": {
      en: "Thanks! Your clip is in review. A person on our team checks every clip, usually within 3 days. Only you can see it until then.",
      es: "¡Gracias! Tu clip está en revisión. Una persona de nuestro equipo revisa cada clip, casi siempre en 3 días. Hasta entonces, solo tú puedes verlo.",
      mirror: "legal.snippets.uploadPending", placeholder: "chapter-confirm"
    },
    "success.card.title": { en: "Your card's ready.", es: "Tu tarjeta está lista." },
    "success.reminder.title": { en: "We'll remind you on {date}.", es: "Te lo recordamos el {date}." },
    "success.unsubscribe.title": { en: "You're unsubscribed.", es: "Te diste de baja." },
    "success.unsubscribe.body": { en: "Sad to see you go, glad you were here. The door stays open.", es: "Nos da pena que te vayas y nos alegra que hayas estado. La puerta sigue abierta." },

    // ================================================================================== EMPTY
    "empty.events.title": { en: "Nothing on the calendar this week.", es: "Esta semana no hay nada en el calendario." },
    "empty.events.body": { en: "Rest counts too. Want to host the next one? We'll help you plan it.", es: "Descansar también cuenta. ¿Quieres organizar el próximo? Te ayudamos a planearlo.", placeholder: "chapter-confirm" },
    "empty.eventsFilter.title": { en: "No events match that filter.", es: "Ningún evento coincide con ese filtro." },
    "empty.eventsFilter.body": { en: "Try another city or type, or see everything.", es: "Prueba otra ciudad u otro tipo, o mira todos." },
    "empty.clips.title": { en: "No clips here yet.", es: "Todavía no hay clips aquí." },
    "empty.clips.body": { en: "Yours could be first: a short vertical video about why you showed up.", es: "El tuyo podría ser el primero: un video corto y vertical sobre por qué participaste." },
    "empty.clipsMine.title": { en: "You haven't posted a clip yet.", es: "Todavía no has subido ningún clip." },
    "empty.clipsMine.body": { en: "When you do, it shows up here while it waits for review.", es: "Cuando subas uno, aparecerá aquí mientras espera revisión." },
    "empty.squad.title": { en: "No one's joined with your link yet.", es: "Todavía nadie se ha unido con tu enlace." },
    "empty.squad.body": { en: "Send it to one person who'd actually come. One is plenty to start.", es: "Mándalo a una persona que de verdad vendría. Con una basta para empezar." },
    "empty.going.title": { en: "Be the first to say you're going.", es: "Sé la primera persona en confirmar." },
    "empty.pledgeWall.title": { en: "No names on the wall yet.", es: "Todavía no hay nombres en el muro." },
    "empty.pledgeWall.body": { en: "Take the pledge and you can be the first, only if you choose to show your name.", es: "Haz el compromiso y puedes ser la primera persona, solo si decides mostrar tu nombre." },
    "empty.plan.title": { en: "No plan saved yet.", es: "Todavía no tienes un plan guardado." },
    "empty.plan.body": { en: "A few taps and it's on your calendar.", es: "Unos toques y queda en tu calendario.", note: "Not \"three\": data/civic.js plan asks up to 7 questions (\"a few quick taps\")." },
    "empty.search.title": { en: "Nothing matched “{query}”.", es: "No encontramos nada con “{query}”." },
    "empty.search.body": { en: "Try a shorter word, or browse the topics below.", es: "Prueba una palabra más corta o mira los temas de abajo." },

    // ================================================================================== STATE
    "state.loading": { en: "Loading…", es: "Cargando…" },
    "state.notFound.title": { en: "This page skipped the meeting.", es: "Esta página no llegó a la reunión." },
    "state.notFound.body": { en: "It may have moved, or the link has a typo. Let's get you somewhere useful.", es: "Quizás cambió de dirección o el enlace tiene un error. Te llevamos a algo útil." },
    "state.notFound.suggest": { en: "Or try one of these:", es: "O prueba una de estas:" },
    "state.offline.title": { en: "You're offline", es: "No tienes conexión" },
    "state.offline.body": { en: "No signal right now. This page will load once you're back online, and forms won't send until then.", es: "Ahora mismo no hay señal. Esta página va a cargar cuando vuelvas a tener conexión, y los formularios no se envían hasta entonces." },
    "state.offline.banner": { en: "You're offline. Pages you've opened before may still load.", es: "No tienes conexión. Las páginas que ya abriste podrían seguir cargando." },
    "state.error.title": { en: "That one's on us, not you.", es: "El error es nuestro, no tuyo." },
    "state.error.body": { en: "Something broke on our end. Give it a minute and try again.", es: "Algo falló de nuestro lado. Espera un minuto e inténtalo de nuevo." },
    "state.error.network": { en: "We couldn't reach the server. Check your connection and try again.", es: "No pudimos conectar con el servidor. Revisa tu conexión e inténtalo de nuevo." },
    "state.notConnected": { en: "DEMO: this part isn't connected yet. On the live site, it will be.", es: "DEMO: esta parte todavía no está conectada. En el sitio real, lo estará.", demo: true },
    "state.past": { en: "This one already happened. Here's what's next.", es: "Esto ya pasó. Esto es lo que viene." },

    // ================================================================================== TOAST
    "toast.linkCopied": { en: "Link copied. Paste it anywhere.", es: "Enlace copiado. Pégalo donde quieras." },
    "toast.textCopied": { en: "Message copied. Paste it into your chat.", es: "Mensaje copiado. Pégalo en tu chat." },
    "toast.codeCopied": { en: "Invite code copied.", es: "Código de invitación copiado." },
    "toast.shared": { en: "Sent. Thanks for spreading the word.", es: "Enviado. Gracias por correr la voz.", note: "YSD.share.native() resolved 'shared'. Say nothing on 'cancelled'." },
    "toast.shareFailed": { en: "Couldn't share or copy that. Press and hold the link to copy it.", es: "No pudimos compartir ni copiar. Mantén presionado el enlace para copiarlo." },
    "toast.calendarReady": { en: "Calendar file ready. Open it to add the event.", es: "Archivo de calendario listo. Ábrelo para agregar el evento." },
    "toast.cardSaved": { en: "Card saved.", es: "Tarjeta guardada." },
    "toast.joined": { en: "You're in. 🎉", es: "Ya eres parte. 🎉" },
    "toast.rsvpSaved": { en: "Seat saved. See you there.", es: "Lugar reservado. Nos vemos allá." },
    "toast.rsvpCanceled": { en: "RSVP canceled. Hope to see you at the next one.", es: "Cancelaste tu confirmación. Ojalá te veamos en el próximo." },
    "toast.reminderSet": { en: "Reminder set.", es: "Recordatorio listo." },
    "toast.saved": { en: "Saved.", es: "Guardado." },
    "toast.removed": { en: "Removed.", es: "Quitado." },
    "toast.pledgeSaved": { en: "Pledge saved. Your card is ready.", es: "Compromiso guardado. Tu tarjeta está lista." },
    "toast.planSaved": { en: "Plan saved in this browser.", es: "Plan guardado en este navegador." },
    "toast.clipSent": { en: "Clip sent for review.", es: "Clip enviado a revisión." },
    "toast.subscribed": { en: "You're on the list.", es: "Ya estás en la lista." },
    "toast.unsubscribed": { en: "You're unsubscribed. The door stays open.", es: "Te diste de baja. La puerta sigue abierta." },
    "toast.offline": { en: "You're offline.", es: "No tienes conexión." },
    "toast.online": { en: "You're back online.", es: "Volviste a tener conexión." },
    "toast.demoNotSent": { en: "DEMO: nothing was sent. It's saved in this browser only.", es: "DEMO: no se envió nada. Solo se guardó en este navegador.", demo: true },

    // ============================================================================ SHARE SHEET
    "shareSheet.title": { en: "Send it to the group chat", es: "Mándalo al grupo" },
    "shareSheet.intro": { en: "Pick an app. You can edit the message before it sends.", es: "Elige una app. Puedes editar el mensaje antes de enviarlo." },
    "shareSheet.message": { en: "Your message", es: "Tu mensaje" },
    "shareSheet.more": { en: "More options", es: "Más opciones", note: "Opens the system share sheet (navigator.share)." },
    "shareSheet.via": { en: "Share on {app}", es: "Compartir en {app}", note: "aria-label for icon-only buttons." },
    "shareSheet.sms": { en: "Text message", es: "Mensaje de texto" },
    "shareSheet.whatsapp": { en: "WhatsApp", es: "WhatsApp" },
    "shareSheet.instagram": { en: "Instagram Story", es: "Historia de Instagram" },
    "shareSheet.x": { en: "X", es: "X" },
    "shareSheet.threads": { en: "Threads", es: "Threads" },
    "shareSheet.bluesky": { en: "Bluesky", es: "Bluesky" },
    "shareSheet.facebook": { en: "Facebook", es: "Facebook" },
    "shareSheet.telegram": { en: "Telegram", es: "Telegram" },
    "shareSheet.email": { en: "Email", es: "Correo" },
    "shareSheet.copyLink": { en: "Copy link", es: "Copiar enlace" },
    "shareSheet.copyText": { en: "Copy message", es: "Copiar mensaje" },
    "shareSheet.saveImage": { en: "Save image", es: "Guardar imagen" },
    "shareSheet.igHint": { en: "We copied the text. Paste it on your story, then add a link sticker with your link.", es: "Copiamos el texto. Pégalo en tu historia y agrega el sticker de enlace con tu link." },
    "shareSheet.refNote": {
      en: "Your link carries your invite code (like MAYA7QX, made from your first name, or random letters if you're under 18), so we can count who you brought. Your email and phone number never go with it.",
      es: "Tu enlace lleva tu código de invitación (como MAYA7QX, hecho con tu nombre, o con letras al azar si tienes menos de 18 años) para contar a quién trajiste. Tu correo y tu teléfono nunca van con él.",
      note: "True to assets/js/share.js and members.js makeRefCode: up to 5 letters of the first name plus 3 random characters (6 random when the name is too short, when members.refCodeStyle is 'random', or always for members under 18). The example uses Maya, the voice guide's demo name, not a real person's."
    },

    // ============================================================================ SHARE: PAGES
    // ---- home
    "share.home.sms": {
      en: "Have you seen the Young Dems? It's Seminole County's Young Democrats: meetups, voting help that actually makes sense, and people who care about this place. Come to one with me? {link}",
      es: "¿Ya viste a los Young Dems? Son los jóvenes demócratas del condado de Seminole: reuniones, ayuda para votar que de verdad se entiende y gente a la que le importa este lugar. ¿Me acompañas a una? {link}"
    },
    "share.home.whatsapp": {
      en: "Found something for us: the Young Dems, Seminole County's Young Democrats. Meetups around the county, voting rules explained in plain words, and nobody expects you to know everything on day one.\n\nCome to one with me? {link}",
      es: "Encontré algo para nosotros: los Young Dems, los jóvenes demócratas del condado de Seminole. Reuniones por todo el condado, las reglas para votar explicadas sin enredos, y nadie espera que lo sepas todo el primer día.\n\n¿Me acompañas a una? {link}"
    },
    "share.home.igStory": { en: "Local politics is a group project. This is Seminole's.\n{link}", es: "La política local es un trabajo en equipo. Este es el equipo de Seminole.\n{link}" },
    "share.home.short": {
      en: "Local politics is a group project. Seminole County's Young Dems: meetups, voting help in plain words, and a seat saved for you. {link}",
      es: "La política local es un trabajo en equipo. Los Young Dems del condado de Seminole: reuniones, ayuda para votar sin enredos y un lugar para ti. {link}"
    },
    "share.home.email.subject": { en: "Thought of you: the Young Dems in Seminole", es: "Me acordé de ti: los Young Dems de Seminole" },
    "share.home.email.body": {
      en: "Hi,\n\nI came across the Young Democrats of Seminole County and thought of you. Their site has upcoming meetups, voting help in plain words (in English and Spanish), and a one-minute quiz that tells you which local issue is yours.\n\nHave a look: {link}\n\nWant to go to something together?",
      es: "Hola:\n\nEncontré a los Young Democrats of Seminole County y me acordé de ti. En su sitio hay reuniones próximas, ayuda para votar sin enredos (en inglés y en español) y un quiz de un minuto que te dice cuál tema local es el tuyo.\n\nÉchale un vistazo: {link}\n\n¿Te animas a ir conmigo a algo?"
    },

    // ---- join
    "share.join.sms": {
      en: "I'm joining the Young Dems here in Seminole. It takes under a minute and you can come as you are. Join with me? {link}",
      es: "Me voy a unir a los Young Dems aquí en Seminole. Toma menos de un minuto y puedes venir tal como eres. ¿Te unes conmigo? {link}"
    },
    "share.join.whatsapp": {
      en: "Joining the Young Democrats of Seminole County. It's for ages 14 to 39, it takes under a minute, and there's no pop quiz on day one. Join with me so we show up together? {link}",
      es: "Me estoy uniendo a los Young Democrats of Seminole County. Es para gente de 14 a 39 años, toma menos de un minuto y nadie te toma examen el primer día. ¿Te unes conmigo y llegamos en grupo? {link}",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high"
    },
    "share.join.igStory": { en: "Joining the Young Dems in Seminole. Who's with me?\n{link}", es: "Me uno a los Young Dems de Seminole. ¿Quién se apunta?\n{link}" },
    "share.join.short": {
      en: "Joining Seminole County's Young Democrats. Under a minute, come as you are, bring a friend. {link}",
      es: "Me uno a los jóvenes demócratas del condado de Seminole. Menos de un minuto, ven como eres y trae a alguien. {link}"
    },
    "share.join.email.subject": { en: "Join the Young Dems with me?", es: "¿Te unes conmigo a los Young Dems?" },
    "share.join.email.body": {
      en: "Hi,\n\nI'm joining the Young Democrats of Seminole County and I'd like you there too. It's for ages 14 to 39, the form takes under a minute, and if the $20 yearly dues are a stretch, you can still be a member (non-voting) for free.\n\nHere's the link: {link}\n\nLet's pick a first event to go to.",
      es: "Hola:\n\nMe voy a unir a los Young Democrats of Seminole County y me gustaría que estuvieras. Es para gente de 14 a 39 años, el formulario toma menos de un minuto y, si la cuota de $20 al año no te alcanza, igual puedes ser miembro (sin voto) gratis.\n\nAquí está el enlace: {link}\n\n¿Elegimos un primer evento para ir?",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "Ages and dues from YDSC's dues page; keep in step with YSD_CONFIG.org.dues."
    },

    // ---- events
    "share.events.sms": { en: "Look what's coming up with the Young Dems in Seminole. Pick one and I'll go with you. {link}", es: "Mira lo que viene con los Young Dems en Seminole. Elige uno y voy contigo. {link}" },
    "share.events.whatsapp": {
      en: "The Young Dems calendar for Seminole is up: hangouts, volunteer shifts and more, each with the time, the place and how to get in. Pick one that works for you and I'll come too. {link}",
      es: "Ya está el calendario de los Young Dems en Seminole: encuentros, turnos de voluntariado y más, cada uno con la hora, el lugar y los datos de acceso. Elige uno que te quede bien y voy yo también. {link}"
    },
    "share.events.igStory": { en: "Free Thursday? Same.\n{link}", es: "¿Libre el jueves? Yo también.\n{link}" },
    "share.events.short": { en: "What's on with the Young Dems in Seminole: pick a night, save your seat, bring a friend. {link}", es: "Lo que viene con los Young Dems en Seminole: elige una noche, guarda tu lugar y trae a alguien. {link}" },
    "share.events.email.subject": { en: "Want to go to one of these?", es: "¿Te animas a ir a uno de estos?" },
    "share.events.email.body": {
      en: "Hi,\n\nThe Young Democrats of Seminole County post their meetups here, with the time, place and access notes for each one. Want to pick one to go to together?\n\n{link}",
      es: "Hola:\n\nLos Young Democrats of Seminole County publican aquí sus reuniones, con la hora, el lugar y los datos de accesibilidad de cada una. ¿Elegimos una para ir?\n\n{link}"
    },

    // ---- event invite (single-event page; vars: event, date, time, place)
    "share.eventInvite.sms": {
      en: "Come to {event} with me? {date}, {time}, {place}. First time is fine, nobody's keeping score. Details and RSVP: {link}",
      es: "¿Vienes conmigo a {event}? {date}, {time}, {place}. Si es tu primera vez, perfecto: nadie lleva la cuenta. Detalles y confirmación: {link}"
    },
    "share.eventInvite.whatsapp": {
      en: "{event}\n{date}, {time}\n{place}\n\nIt's a Young Dems thing in Seminole. Great for a first time, and I'd like company. RSVP here: {link}",
      es: "{event}\n{date}, {time}\n{place}\n\nEs de los Young Dems en Seminole. Ideal si es tu primera vez, y me gustaría ir con alguien. Confirma aquí: {link}"
    },
    "share.eventInvite.igStory": { en: "{date}. {event}. Who's coming?\n{link}", es: "{date}. {event}. ¿Quién viene?\n{link}" },
    "share.eventInvite.short": { en: "{event}: {date}, {time}, {place}. Save a seat and bring a friend. {link}", es: "{event}: {date}, {time}, {place}. Guarda tu lugar y trae a alguien. {link}" },
    "share.eventInvite.email.subject": { en: "You're invited: {event}, {date}", es: "Te invito: {event}, {date}" },
    "share.eventInvite.email.body": {
      en: "Hi,\n\nCome to {event} with me?\n\nWhen: {date}, {time}\nWhere: {place}\n\nIt's a Young Democrats of Seminole County event. No experience needed, and you don't have to know anyone (you'll know me).\n\nDetails and RSVP: {link}",
      es: "Hola:\n\n¿Vienes conmigo a {event}?\n\nCuándo: {date}, {time}\nDónde: {place}\n\nEs un evento de los Young Democrats of Seminole County. No necesitas experiencia ni conocer a nadie (me conoces a mí).\n\nDetalles y confirmación: {link}"
    },

    // ---- vote (evergreen; time-bound facts live in share.mailBallot and share.studentId)
    "share.vote.sms": {
      en: "Saving you a headache: what changed for Seminole voters, in plain words with official links. Mail ballots, ID, dates. {link}",
      es: "Para ahorrarte un dolor de cabeza: lo que cambió para votar en Seminole, explicado sin enredos y con enlaces oficiales. Boleta por correo, identificación, fechas. {link}",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991", verified: "2026-11-09", confidence: "high"
    },
    "share.vote.whatsapp": {
      en: "This page has the Seminole voting stuff in one place: what changed with mail ballots and IDs, the next election dates, and links to the official county and state sites. Worth a bookmark. {link}",
      es: "En esta página está todo lo de votar en Seminole en un solo lugar: qué cambió con la boleta por correo y la identificación, las próximas fechas de elecciones y enlaces a los sitios oficiales del condado y del estado. Vale la pena guardarla. {link}",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991", verified: "2026-11-09", confidence: "high"
    },
    "share.vote.igStory": {
      en: "Florida voting rules changed. Here's the plain-words version for Seminole.\n{link}",
      es: "Cambiaron las reglas para votar en Florida. Aquí está la versión clara para Seminole.\n{link}",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991", verified: "2026-11-09", confidence: "high"
    },
    "share.vote.short": {
      en: "Seminole voting, minus the confusion: mail ballots, voter ID and the next dates, in plain words with official links. {link}",
      es: "Votar en Seminole, sin confusión: boleta por correo, identificación y próximas fechas, sin enredos y con enlaces oficiales. {link}"
    },
    "share.vote.email.subject": { en: "Seminole voting rules, in plain words", es: "Las reglas para votar en Seminole, sin enredos" },
    "share.vote.email.body": {
      en: "Hi,\n\nFlorida changed some voting rules for 2027, and mail-ballot requests have to be renewed after every general election year. This page explains it in plain words and links straight to the official county and state sites:\n\n{link}\n\nBetter to have it before you need it.",
      es: "Hola:\n\nFlorida cambió algunas reglas para votar a partir de 2027, y la solicitud de boleta por correo hay que renovarla después de cada año de elecciones generales. Esta página lo explica en palabras sencillas y lleva directo a los sitios oficiales del condado y del estado:\n\n{link}\n\nMejor tenerlo antes de necesitarlo.",
      source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://www.flsenate.gov/Laws/Statutes/2026/101.62"],
      verified: "2026-11-09", confidence: "high"
    },

    // ---- feed (clips wall)
    "share.feed.sms": {
      en: "Short videos from people around Seminole about why they show up. Watch one, then tell me you didn't watch three. {link}",
      es: "Videos cortos de gente de Seminole sobre por qué participan. Mira uno y luego dime que no viste tres. {link}"
    },
    "share.feed.whatsapp": {
      en: "Short vertical clips from people in Seminole about why they show up, plus a few that explain voting stuff fast. Sound optional. {link}",
      es: "Clips cortos y verticales de gente de Seminole sobre por qué participan, y algunos que explican cosas de votación en poco tiempo. El sonido es opcional. {link}"
    },
    "share.feed.igStory": { en: "Why people here show up. Short clips, sound optional.\n{link}", es: "Por qué la gente de aquí participa. Clips cortos, con sonido opcional.\n{link}" },
    "share.feed.short": { en: "Short clips from people around Seminole County on why they show up. Sound optional. {link}", es: "Clips cortos de gente del condado de Seminole sobre por qué participan. El sonido es opcional. {link}" },
    "share.feed.email.subject": { en: "A few short videos from Seminole", es: "Unos videos cortos desde Seminole" },
    "share.feed.email.body": {
      en: "Hi,\n\nThe Young Democrats of Seminole County collect short clips from people here about why they show up. A real person reviews each one before it goes up. Have a look:\n\n{link}",
      es: "Hola:\n\nLos Young Democrats of Seminole County reúnen clips cortos de gente de aquí sobre por qué participan. Una persona revisa cada uno antes de publicarlo. Échales un vistazo:\n\n{link}",
      placeholder: "chapter-confirm", note: "Human review before publishing is the draft moderation policy (docs/legal/MODERATION_POLICY.md)."
    },

    // ---- issues
    "share.issues.sms": {
      en: "Rent, heat, insurance, water, schools: the actual Seminole numbers, with sources, and one thing you can do about each. {link}",
      es: "Alquiler, calor, seguros, agua, escuelas: los datos reales de Seminole, con fuentes, y una cosa que puedes hacer en cada caso. {link}"
    },
    "share.issues.whatsapp": {
      en: "Nine local issues, each with the Seminole numbers behind it, the sources, and one thing you can actually do. {link}",
      es: "Nueve temas locales, cada uno con los datos de Seminole, las fuentes y una cosa que de verdad puedes hacer. {link}",
      note: "Nine = data/issues.js items. Update if that count changes."
    },
    "share.issues.igStory": { en: "The Seminole numbers behind the stuff we all talk about.\n{link}", es: "Los datos de Seminole detrás de lo que todos comentamos.\n{link}" },
    "share.issues.short": { en: "Nine Seminole issues, the numbers behind each with sources, and one thing you can do. {link}", es: "Nueve temas de Seminole, los datos de cada uno con fuentes y una cosa que puedes hacer. {link}" },
    "share.issues.email.subject": { en: "The Seminole numbers behind the headlines", es: "Los datos de Seminole detrás de los titulares" },
    "share.issues.email.body": {
      en: "Hi,\n\nThis page lays out nine issues in Seminole County, from rent to water, with the local numbers and their sources, plus one concrete thing to do for each. Thought you'd find it useful:\n\n{link}",
      es: "Hola:\n\nEsta página explica nueve temas del condado de Seminole, del alquiler al agua, con los datos locales y sus fuentes, y una acción concreta para cada uno. Pensé que te serviría:\n\n{link}"
    },

    // ---- quiz (page)
    "share.quiz.sms": {
      en: "Two quick quizzes from the Young Dems: which Seminole issue is yours, and what kind of organizer you are. Take one and tell me what you get. {link}",
      es: "Dos quizzes rápidos de los Young Dems: cuál tema de Seminole es el tuyo y cuál es tu modo de organizar. Haz uno y me cuentas qué te salió. {link}"
    },
    "share.quiz.whatsapp": {
      en: "Quiz time: seven everyday questions and it tells you which Seminole issue is yours. There's also one for your organizer era. Send me your result. {link}",
      es: "Hora del quiz: siete preguntas de la vida diaria y te dice cuál tema de Seminole es el tuyo. También hay uno sobre tu modo de organizar. Mándame tu resultado. {link}"
    },
    "share.quiz.igStory": { en: "Which Seminole issue is yours? One minute to find out.\n{link}", es: "¿Cuál tema de Seminole es el tuyo? Un minuto para saberlo.\n{link}" },
    "share.quiz.short": { en: "Which Seminole issue is yours? Seven everyday questions, one minute, one match. {link}", es: "¿Cuál tema de Seminole es el tuyo? Siete preguntas de la vida diaria, un minuto, un resultado. {link}" },
    "share.quiz.email.subject": { en: "One-minute quiz: which Seminole issue is yours?", es: "Quiz de un minuto: ¿cuál tema de Seminole es el tuyo?" },
    "share.quiz.email.body": {
      en: "Hi,\n\nThe Young Democrats of Seminole County made a one-minute quiz that matches you to a local issue from everyday questions (how you get around, where you live, your weekends). They don't save your answers. Tell me what you get:\n\n{link}",
      es: "Hola:\n\nLos Young Democrats of Seminole County hicieron un quiz de un minuto que te asigna un tema local según preguntas de la vida diaria (cómo te mueves, dónde vives, tus fines de semana). No guardan tus respuestas. Cuéntame qué te sale:\n\n{link}",
      note: "\"They don't save your answers\" matches data/quiz.js issueFinder.privacy."
    },

    // ---- newsletter
    "share.newsletter.sms": {
      en: "The Young Dems in Seminole send one short email a week: what's on, one thing to do, and nothing panicky. Worth it: {link}",
      es: "Los Young Dems de Seminole mandan un correo corto a la semana: qué hay, una cosa para hacer y cero pánico. Vale la pena: {link}",
      placeholder: "chapter-confirm"
    },
    "share.newsletter.whatsapp": {
      en: "If you want to keep up with Seminole without doom-scrolling: the Young Dems send one short email a week with what's on, one thing to do and a few local picks. Unsubscribe anytime. {link}",
      es: "Si quieres estar al día con Seminole sin pasarte horas en el celular: los Young Dems mandan un correo corto a la semana con lo que hay, una cosa para hacer y algunas recomendaciones locales. Te das de baja cuando quieras. {link}",
      placeholder: "chapter-confirm"
    },
    "share.newsletter.igStory": { en: "One good email a week. Seminole edition.\n{link}", es: "Un buen correo a la semana. Edición Seminole.\n{link}", placeholder: "chapter-confirm" },
    "share.newsletter.short": {
      en: "One short email a week about Seminole: what's on, one thing to do, nothing panicky. {link}",
      es: "Un correo corto a la semana sobre Seminole: qué hay, una cosa para hacer y cero pánico. {link}",
      placeholder: "chapter-confirm"
    },
    "share.newsletter.email.subject": { en: "A weekly email worth opening", es: "Un correo semanal que vale la pena abrir", placeholder: "chapter-confirm" },
    "share.newsletter.email.body": {
      en: "Hi,\n\nThe Young Democrats of Seminole County send one short email every Thursday: what's happening around the county, one thing to do that week, and a few local picks. No guilt trips, and you can unsubscribe anytime, right from the email.\n\n{link}",
      es: "Hola:\n\nLos Young Democrats of Seminole County mandan un correo corto cada jueves: lo que pasa en el condado, una cosa para hacer esa semana y algunas recomendaciones locales. Nada de culpas, y te das de baja cuando quieras, desde el mismo correo.\n\n{link}",
      placeholder: "chapter-confirm"
    },

    // ---- about
    "share.about.sms": { en: "Who the Young Dems in Seminole are and how to get involved without a big commitment. Short read. {link}", es: "Quiénes son los Young Dems de Seminole y cómo participar sin un gran compromiso. Se lee rápido. {link}" },
    "share.about.whatsapp": {
      en: "This explains the Young Democrats of Seminole County: who they are, who can join (ages 14 to 39), how dues work, and how to start small. {link}",
      es: "Aquí explican los Young Democrats of Seminole County: quiénes son, quién puede unirse (de 14 a 39 años), cómo funciona la cuota y cómo empezar poco a poco. {link}",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high"
    },
    "share.about.igStory": { en: "Meet Seminole's Young Dems.\n{link}", es: "Conoce a los Young Dems de Seminole.\n{link}" },
    "share.about.short": { en: "Who Seminole County's Young Democrats are, who can join, and how to start small. {link}", es: "Quiénes son los jóvenes demócratas del condado de Seminole, quién puede unirse y cómo empezar poco a poco. {link}" },
    "share.about.email.subject": { en: "Who the Young Dems are", es: "Quiénes son los Young Dems" },
    "share.about.email.body": {
      en: "Hi,\n\nHere's a quick explainer on the Young Dems: Seminole County's chapter of the Florida Young Democrats, for ages 14 to 39. The page covers what they do, how dues work and how to get involved without signing your life away.\n\n{link}",
      es: "Hola:\n\nAquí va una explicación rápida de los Young Dems: el capítulo del condado de Seminole de los Florida Young Democrats, para gente de 14 a 39 años. La página cuenta qué hacen, cómo funciona la cuota y cómo participar sin comprometer tu vida entera.\n\n{link}",
      source: "https://secure.actblue.com/donate/ydscdues",
      sources: ["https://www.floridayoungdems.com/current-chapters"],
      verified: "2026-11-09", confidence: "high"
    },

    // ======================================================================== SHARE: MECHANICS
    // ---- Find your issue result (var: match = result name from data/quiz.js)
    "share.quizIssue.sms": { en: "Took the Young Dems quiz: my Seminole issue is {match}. What's yours? Takes about a minute. {link}", es: "Hice el quiz de los Young Dems: mi tema en Seminole es {match}. ¿Y el tuyo? Toma como un minuto. {link}" },
    "share.quizIssue.whatsapp": { en: "My Seminole issue, according to seven questions about my actual life: {match}. Honestly fair. Find yours: {link}", es: "Mi tema en Seminole, según siete preguntas sobre mi vida real: {match}. La verdad, me representa. Encuentra el tuyo: {link}" },
    "share.quizIssue.igStory": { en: "My Seminole issue: {match}. Yours?\n{link}", es: "Mi tema en Seminole: {match}. ¿Y el tuyo?\n{link}" },
    "share.quizIssue.short": { en: "My Seminole issue is {match}. Seven everyday questions, one minute. Find yours: {link}", es: "Mi tema en Seminole es {match}. Siete preguntas de la vida diaria, un minuto. Encuentra el tuyo: {link}" },
    "share.quizIssue.email.subject": { en: "My Seminole issue is {match}. What's yours?", es: "Mi tema en Seminole es {match}. ¿Y el tuyo?" },
    "share.quizIssue.email.body": {
      en: "Hi,\n\nI took a one-minute quiz from the Young Democrats of Seminole County and got {match}. It comes with the local numbers and one thing to do about it. I'm curious what you'd get:\n\n{link}",
      es: "Hola:\n\nHice un quiz de un minuto de los Young Democrats of Seminole County y me salió {match}. Viene con los datos locales y una cosa para hacer al respecto. Tengo curiosidad de qué te sale a ti:\n\n{link}"
    },

    // ---- Organizer era result (var: match)
    "share.quizEra.sms": { en: "I got {match} on the Young Dems organizer quiz. Which one are you? {link}", es: "Me salió {match} en el quiz de los Young Dems. ¿Y a ti cuál? {link}" },
    "share.quizEra.whatsapp": { en: "Apparently my organizer era is {match}. Accurate, unfortunately. Take it and tell me yours: {link}", es: "Parece que mi modo de organizar es {match}. Muy acertado, para qué negarlo. Hazlo y dime el tuyo: {link}" },
    "share.quizEra.igStory": { en: "Organizer era: {match}. It's me.\n{link}", es: "Mi modo de organizar: {match}. Me describe bien.\n{link}" },
    "share.quizEra.short": { en: "My organizer era is {match}. Eight quick questions. What's yours? {link}", es: "Mi modo de organizar es {match}. Ocho preguntas rápidas. ¿Cuál es el tuyo? {link}" },
    "share.quizEra.email.subject": { en: "I got {match}. Which organizer are you?", es: "Me salió {match}. ¿Cuál es tu modo?" },
    "share.quizEra.email.body": {
      en: "Hi,\n\nThe Young Democrats of Seminole County have a quiz that tells you what kind of organizer you are. I got {match}, which tracks. Take it and send me yours:\n\n{link}",
      es: "Hola:\n\nLos Young Democrats of Seminole County tienen un quiz que te dice cuál es tu modo de organizar. Me salió {match}, y tiene sentido. Hazlo y mándame el tuyo:\n\n{link}"
    },

    // ---- Pledge card
    "share.pledge.sms": { en: "I took the pledge: I'm voting in every election through 2028, starting with the next one. Take it with me? {link}", es: "Hice el compromiso: voy a votar en todas las elecciones hasta 2028, empezando por la próxima. ¿Te comprometes conmigo? {link}" },
    "share.pledge.whatsapp": {
      en: "Small thing, big deal: I pledged to vote in every election through 2028, local ones included. A study of young voters found that pledging made people more likely to actually vote, so I'm asking you to pledge too. {link}",
      es: "Algo pequeño que importa: me comprometí a votar en todas las elecciones hasta 2028, incluidas las locales. Un estudio con votantes jóvenes encontró que comprometerse aumenta las probabilidades de votar de verdad, así que te pido que te comprometas tú también. {link}",
      source: "https://pmc.ncbi.nlm.nih.gov/articles/PMC5973556/", verified: "2026-11-09", confidence: "high",
      note: "Costa, Schaffner and Prevost, PLoS One 2018: pledging raised youth turnout 3.7 points (5.6 for first-time voters) in two field experiments."
    },
    "share.pledge.igStory": { en: "In for 2027 and 2028. 🗳️\n{link}", es: "Me comprometo para 2027 y 2028. 🗳️\n{link}" },
    "share.pledge.short": { en: "I pledged to vote in every election through 2028, local ones included. Join me: {link}", es: "Me comprometí a votar en todas las elecciones hasta 2028, incluidas las locales. Súmate: {link}" },
    "share.pledge.email.subject": { en: "I made a voting pledge. Want in?", es: "Hice un compromiso para votar. ¿Te sumas?" },
    "share.pledge.email.body": {
      en: "Hi,\n\nI pledged to vote in every election through 2028, including the small local ones that are easy to forget. It took a minute, and I got a card out of it.\n\nWant to take it with me? {link}",
      es: "Hola:\n\nMe comprometí a votar en todas las elecciones hasta 2028, incluidas las locales que se nos olvidan fácil. Me tomó un minuto y hasta me dieron una tarjeta.\n\n¿Te comprometes conmigo? {link}"
    },

    // ---- Make-a-plan card (var: election = civic planName, article included)
    "share.plan.sms": { en: "Made my voting plan for {election}: when, how and who I'm going with. Took a few taps. Make yours? {link}", es: "Hice mi plan para votar en {election}: cuándo, cómo y con quién voy. Fueron unos toques. ¿Haces el tuyo? {link}" },
    "share.plan.whatsapp": { en: "I made a plan for {election}: when I'm voting, how I'm getting there and who's coming with me. It's on my calendar now. Want to be the who? {link}", es: "Hice un plan para {election}: cuándo voto, cómo llego y quién va conmigo. Ya está en mi calendario. ¿Quieres ser quien va conmigo? {link}" },
    "share.plan.igStory": { en: "Plan made for {election}. Yours?\n{link}", es: "Plan listo para {election}. ¿Y el tuyo?\n{link}" },
    "share.plan.short": { en: "Plan made for {election}: when, how and who with. A few taps, on your calendar. Make yours: {link}", es: "Plan listo para {election}: cuándo, cómo y con quién. Unos toques y queda en tu calendario. Haz el tuyo: {link}" },
    "share.plan.email.subject": { en: "My plan for {election}", es: "Mi plan para {election}" },
    "share.plan.email.body": {
      en: "Hi,\n\nI used the Young Democrats of Seminole County's plan builder for {election}. It asks when you'll vote, how you'll get there and who you're going with, then puts it on your calendar. It doesn't save your address or anything like that.\n\nWant to make yours and go together? {link}",
      es: "Hola:\n\nUsé el planificador de los Young Democrats of Seminole County para {election}. Te pregunta cuándo vas a votar, cómo vas a llegar y con quién vas, y lo pone en tu calendario. No guarda tu dirección ni nada por el estilo.\n\n¿Haces el tuyo y vamos en grupo? {link}",
      note: "Matches data/civic.js plan rules: no street address, plan stays in the browser."
    },

    // ---- Mail-ballot heads-up (until Jan 1, 2027). Same facts and advice as data/civic.js changes[mail-ballot-expiry].
    "share.mailBallot.sms": {
      en: "Heads up from a friend: if you asked for a mail ballot before Nov 3, that request ends Dec 31. Renew it once and you're covered through 2028. How: {link}",
      es: "Aviso entre amigos: si pediste la boleta por correo antes del 3 de noviembre, esa solicitud vence el 31 de diciembre. Renuévala una vez y te cubre hasta finales de 2028. Cómo hacerlo: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "share.mailBallot2027.sms",
      note: "F.S. 101.62(1)(a), 2026 statutes: one request covers all elections through the end of the calendar year of the next regularly scheduled general election. That election was Nov 3, 2026, so requests made before it end Dec 31, 2026, and one made after it should run through Dec 31, 2028 (med for that reading: Seminole's vote-by-mail page hasn't said how it handles post-election requests, so the longer texts say to check My Voter Record in January). Not \"2025 or 2026\": requests made after Nov 5, 2024 also end Dec 31, 2026, and ones made after Nov 3, 2026 don't."
    },
    "share.mailBallot.whatsapp": {
      en: "Heads up: a Florida mail-ballot request lasts through the end of the next general election year. That election was Nov 3, so if you asked before then, yours ends Dec 31. Renew it once and you're covered for every election through 2028, including a 2027 city election if your city has one. Steps and the official link: {link}",
      es: "Ojo: en Florida, la solicitud de boleta por correo dura hasta el final del año de las siguientes elecciones generales. Esas elecciones fueron el 3 de noviembre, así que si la pediste antes, la tuya vence el 31 de diciembre. Renuévala una vez y te cubre en todas las elecciones hasta finales de 2028, incluida una elección municipal en 2027 si tu ciudad tiene una. Los pasos y el enlace oficial: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "share.mailBallot2027.whatsapp"
    },
    "share.mailBallot.igStory": {
      en: "Asked for a mail ballot before Nov 3? That request ends Dec 31.\n{link}",
      es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre.\n{link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "share.mailBallot2027.igStory"
    },
    "share.mailBallot.short": {
      en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Renew it once and you're covered through 2028. {link}",
      es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Renuévala una vez y te cubre hasta finales de 2028. {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "share.mailBallot2027.short"
    },
    "share.mailBallot.email.subject": {
      en: "Asked for a mail ballot before Nov 3? It ends Dec 31",
      es: "¿Pediste la boleta por correo antes del 3 de noviembre? Vence el 31 de diciembre",
      max: 85,
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "share.mailBallot2027.email.subject"
    },
    "share.mailBallot.email.body": {
      en: "Hi,\n\nQuick one, because it catches people every two years: in Florida, a mail-ballot request lasts through the end of the next general election year. That election was Nov 3, 2026, so every request made before it ends Dec 31.\n\nRenew online, or call the Seminole County Supervisor of Elections at 407-585-8683. One new request covers every election through 2028. Renewing before Jan 1? Under the state rule it should already count through 2028, but the county hasn't said how it's handling these yet, so look yourself up on My Voter Record in January.\n\nSteps and official links: {link}",
      es: "Hola:\n\nAlgo rápido, porque cada dos años toma por sorpresa a mucha gente: en Florida, una solicitud de boleta por correo dura hasta el final del año de las siguientes elecciones generales. Esas elecciones fueron el 3 de noviembre de 2026, así que todas las solicitudes hechas antes vencen el 31 de diciembre.\n\nRenuévala en línea o llama a la oficina del Supervisor de Elecciones del condado de Seminole al 407-585-8683. Una nueva solicitud te cubre en todas las elecciones hasta finales de 2028. ¿La renuevas antes del 1 de enero? Según la regla del estado, ya debería servir hasta 2028, pero el condado todavía no ha dicho cómo las está manejando, así que búscate en My Voter Record en enero.\n\nLos pasos y los enlaces oficiales: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/", "https://voteseminole.gov/voters/my-voter-record/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "share.mailBallot2027.email.body",
      note: "Advice mirrors data/civic.js changes[mail-ballot-expiry].body and steps[renew-mail-ballot]: renew now; if before Jan 1, check My Voter Record in January."
    },

    // ---- Mail-ballot heads-up (from Jan 1, 2027). Same facts as data/civic.js mail-ballot-expiry phase 2.
    "share.mailBallot2027.sms": {
      en: "Vote by mail? Florida requests made before Nov 3, 2026 ended Dec 31, 2026. One new request covers every election through 2028: {link}",
      es: "¿Votas por correo? En Florida, las solicitudes de boleta por correo hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Una nueva te cubre en todas las elecciones hasta finales de 2028: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00"
    },
    "share.mailBallot2027.whatsapp": {
      en: "If you vote by mail: Florida requests made before Nov 3, 2026 ended Dec 31, 2026. One new request covers every election through 2028, local ones included. Steps and the official link: {link}",
      es: "Si votas por correo: en Florida, las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Una nueva te cubre en todas las elecciones hasta finales de 2028, incluidas las locales. Los pasos y el enlace oficial: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00",
      note: "\"Local ones included\" instead of naming the Nov 2, 2027 city elections, so the line stays true for the whole window."
    },
    "share.mailBallot2027.igStory": {
      en: "Vote by mail? Requests from before Nov 3, 2026 have ended. One new request covers you through 2028.\n{link}",
      es: "¿Votas por correo? Las solicitudes de antes del 3 de noviembre de 2026 ya vencieron. Una nueva te cubre hasta finales de 2028.\n{link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00"
    },
    "share.mailBallot2027.short": {
      en: "Vote by mail in Florida? Requests made before Nov 3, 2026 ended Dec 31. One new request covers every election through 2028: {link}",
      es: "¿Votas por correo en Florida? Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre. Una nueva te cubre hasta finales de 2028: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00"
    },
    "share.mailBallot2027.email.subject": {
      en: "Time to renew your mail-ballot request", es: "Es hora de renovar tu solicitud de boleta por correo",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00"
    },
    "share.mailBallot2027.email.body": {
      en: "Hi,\n\nIf you vote by mail: Florida mail-ballot requests made before Nov 3, 2026 ended Dec 31, 2026. That's the law, not a glitch: one request lasts through the end of the next general election year. A new request covers every election through Dec 31, 2028, local ones included.\n\nRenew online, or call the Seminole County Supervisor of Elections at 407-585-8683. Already renewed in November or December? Look yourself up on My Voter Record to make sure it shows.\n\nSteps and official links: {link}",
      es: "Hola:\n\nSi votas por correo: en Florida, las solicitudes de boleta por correo hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Es la ley, no un error: una solicitud dura hasta el final del año de las siguientes elecciones generales. Una nueva te cubre en todas las elecciones hasta el 31 de diciembre de 2028, incluidas las locales.\n\nRenuévala en línea o llama a la oficina del Supervisor de Elecciones del condado de Seminole al 407-585-8683. ¿Ya la renovaste en noviembre o diciembre? Búscate en My Voter Record para confirmar que aparezca.\n\nLos pasos y los enlaces oficiales: {link}",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/", "https://voteseminole.gov/voters/my-voter-record/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00"
    },

    // ---- Student ID change (required copy shape from docs/research/00; serious)
    "share.studentId.sms": {
      en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go. More: {link}",
      es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir. Más información: {link}",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://flsenate.gov/Session/Bill/2026/991", "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-12-15", expires: "2028-11-08T00:00:00-05:00",
      note: "Required wording (docs/research/00). If a court blocks the student-ID ban, rewrite every share.studentId and nudge.studentId entry the same day."
    },
    "share.studentId.whatsapp": {
      en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go.\n\nPassing it on in case you've been using a student ID to vote. Details and official links: {link}",
      es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.\n\nTe lo paso por si has votado con tu identificación de estudiante. Detalles y enlaces oficiales: {link}",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-12-15", expires: "2028-11-08T00:00:00-05:00"
    },
    "share.studentId.igStory": {
      en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a license, state ID or passport, and check voteseminole.gov first.\n{link}",
      es: "Desde el 1 de enero de 2027, Florida no acepta la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva licencia, ID estatal o pasaporte, y revisa voteseminole.gov antes.\n{link}",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-12-15", expires: "2028-11-08T00:00:00-05:00", max: 210
    },
    "share.studentId.short": {
      en: "From Jan 1, 2027, Florida stops taking student IDs at the polls (it's being challenged in court). Bring a license, state ID or passport; check voteseminole.gov. {link}",
      es: "Desde el 1 de enero de 2027, Florida no acepta ID de estudiante para votar (la medida está impugnada). Lleva licencia, ID estatal o pasaporte; revisa voteseminole.gov. {link}",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-12-15", expires: "2028-11-08T00:00:00-05:00",
      note: "Every element of the required shape (date, change, court challenge, what to bring, check voteseminole.gov), squeezed for Bluesky's 300-character limit with a long tracked link."
    },
    "share.studentId.email.subject": {
      en: "Student IDs stop counting at the polls Jan 1", es: "Desde el 1 de enero, la identificación de estudiante no sirve para votar",
      max: 75, tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991", verified: "2026-11-09", confidence: "high",
      expires: "2027-01-01T00:00:00-05:00", next: "share.studentId.email.subjectLater"
    },
    "share.studentId.email.subjectLater": {
      en: "Student IDs don't count at Florida polls anymore", es: "La identificación de estudiante ya no sirve para votar en Florida",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991", verified: "2026-11-09", confidence: "high",
      showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00", recheck: "2026-12-15"
    },
    "share.studentId.email.body": {
      en: "Hi,\n\nStarting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go.\n\nIf you don't have one of those yet, it's worth sorting out well before your next election. Details and official links: {link}",
      es: "Hola:\n\nDesde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.\n\nSi todavía no tienes ninguno de esos documentos, vale la pena resolverlo con tiempo antes de tu próxima elección. Detalles y enlaces oficiales: {link}",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://flsenate.gov/Session/Bill/2026/991", "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-12-15", expires: "2028-11-08T00:00:00-05:00"
    },

    // ---- Pre-register at 16
    "share.preRegister.sms": {
      en: "Know someone turning 16? Florida lets you pre-register at 16, so you're ready to vote once you turn 18. {link}",
      es: "¿Conoces a alguien que va a cumplir 16? En Florida, desde los 16 ya se puede hacer la preinscripción para votar, y así todo queda listo para votar a los 18. {link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      sources: ["https://voteseminole.gov/voters/register-to-vote/"], verified: "2026-11-09", confidence: "high"
    },
    "share.preRegister.whatsapp": {
      en: "For the 16- and 17-year-olds in your life: Florida lets you pre-register to vote at 16, so you can vote in any election on or after your 18th birthday. Official info here: {link}",
      es: "Para quienes tienen 16 o 17 años: en Florida puedes preinscribirte para votar a los 16 y así votar en cualquier elección desde que cumplas 18. Información oficial aquí: {link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      verified: "2026-11-09", confidence: "high"
    },
    "share.preRegister.igStory": {
      en: "Turning 16? You can pre-register to vote in Florida.\n{link}",
      es: "¿Vas a cumplir 16? Desde ese día puedes preinscribirte para votar en Florida.\n{link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      verified: "2026-11-09", confidence: "high"
    },
    "share.preRegister.short": {
      en: "Florida lets you pre-register to vote at 16, so you can vote in any election on or after your 18th birthday. {link}",
      es: "En Florida puedes preinscribirte para votar a los 16 y votar en cualquier elección desde que cumplas 18. {link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      verified: "2026-11-09", confidence: "high"
    },
    "share.preRegister.email.subject": {
      en: "You can pre-register to vote at 16", es: "Puedes preinscribirte para votar a los 16",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      verified: "2026-11-09", confidence: "high"
    },
    "share.preRegister.email.body": {
      en: "Hi,\n\nPassing this on for anyone 16 or 17: Florida lets you pre-register to vote on or after your 16th birthday, so you can vote in any election on or after your 18th. The official state site handles it, and this page has the steps:\n\n{link}",
      es: "Hola:\n\nTe lo paso para quien tenga 16 o 17 años: en Florida puedes preinscribirte para votar desde que cumples 16, y así votar en cualquier elección desde que cumplas 18. Se hace en el sitio oficial del estado, y esta página tiene los pasos:\n\n{link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      sources: ["https://voteseminole.gov/voters/register-to-vote/"], verified: "2026-11-09", confidence: "high"
    },

    // ---- Check your registration
    "share.checkRegistration.sms": {
      en: "Quick favor to yourself: check that your Florida voter registration is active and your address is current. The official lookup is linked here: {link}",
      es: "Un favor rápido para ti: revisa que tu inscripción para votar en Florida esté activa y que tu dirección esté al día. Aquí está el enlace a la consulta oficial: {link}"
    },
    "share.checkRegistration.whatsapp": {
      en: "Moved, changed your name, or just not sure? Check your Florida voter registration before the next deadline. Registration closes 29 days before every election. Official lookup here: {link}",
      es: "¿Te mudaste, cambiaste de nombre o simplemente tienes dudas? Revisa tu inscripción para votar en Florida antes de la próxima fecha límite. La inscripción cierra 29 días antes de cada elección. Consulta oficial aquí: {link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.055.html",
      verified: "2026-11-09", confidence: "high"
    },
    "share.checkRegistration.igStory": { en: "Checked my voter registration. Your turn.\n{link}", es: "Ya revisé mi inscripción para votar. Te toca.\n{link}" },
    "share.checkRegistration.short": {
      en: "Florida registration closes 29 days before every election. Check yours now, while it's easy: {link}",
      es: "En Florida, la inscripción para votar cierra 29 días antes de cada elección. Revisa la tuya ahora, que es fácil: {link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.055.html",
      verified: "2026-11-09", confidence: "high"
    },
    "share.checkRegistration.email.subject": { en: "Is your voter registration still good?", es: "¿Tu inscripción para votar sigue al día?" },
    "share.checkRegistration.email.body": {
      en: "Hi,\n\nIf you've moved or changed your name, your voter registration might need an update, and Florida closes registration 29 days before every election. The official state lookup takes a minute, and this page links straight to it:\n\n{link}",
      es: "Hola:\n\nSi te mudaste o cambiaste de nombre, puede que tu inscripción para votar necesite una actualización, y en Florida la inscripción cierra 29 días antes de cada elección. La consulta oficial del estado toma un minuto, y esta página lleva directo a ella:\n\n{link}",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.055.html",
      verified: "2026-11-09", confidence: "high"
    },

    // ---- Invite friends (referral link with ref code)
    "share.invite.sms": { en: "I'm in the Young Dems here in Seminole. Join with my link and we'll show up as a crew: {link}", es: "Ya estoy con los Young Dems aquí en Seminole. Únete con mi enlace y llegamos en grupo: {link}" },
    "share.invite.whatsapp": {
      en: "I joined the Young Democrats of Seminole County. If you join with my link, it counts that we came together. No pressure, but I'd like you there. {link}",
      es: "Me uní a los Young Democrats of Seminole County. Si te unes con mi enlace, queda registrado que llegamos en grupo. Sin presión, pero me encantaría que estuvieras. {link}"
    },
    "share.invite.igStory": { en: "Bringing my people. You're one of them.\n{link}", es: "Traigo a mi gente. Tú eres parte.\n{link}" },
    "share.invite.short": { en: "Joined Seminole County's Young Democrats. Bringing three friends. You're one of them: {link}", es: "Me uní a los jóvenes demócratas del condado de Seminole. Voy a traer a tres personas. Tú eres una: {link}" },
    "share.invite.email.subject": { en: "Come join the Young Dems with me", es: "Únete conmigo a los Young Dems" },
    "share.invite.email.body": {
      en: "Hi,\n\nI joined the Young Democrats of Seminole County, and you're one of the three people I'd most like to bring along. The link below has my invite code, so it shows we came together. It doesn't share my email or number.\n\n{link}\n\nCome to one thing with me and see if it's your speed.",
      es: "Hola:\n\nMe uní a los Young Democrats of Seminole County, y eres una de las tres personas que más me gustaría traer. El enlace de abajo lleva mi código de invitación, para que se vea que vamos en grupo. No comparte mi correo ni mi número.\n\n{link}\n\nVen conmigo a una actividad y ve si es lo tuyo."
    },

    // ---- Founding-member card (var: number; a labeled DEMO sample in demo mode)
    "share.foundingCard.sms": { en: "Member #{number} of the Young Dems in Seminole. Quietly proud of this. Get your card: {link}", es: "Miembro #{number} de los Young Dems de Seminole. Con orgullo. Consigue tu tarjeta: {link}" },
    "share.foundingCard.whatsapp": { en: "Got my Young Dems member card: #{number}. If you join, you get one too. {link}", es: "Ya tengo mi tarjeta de miembro de los Young Dems: la #{number}. Si te unes, te dan una a ti también. {link}" },
    "share.foundingCard.igStory": { en: "Member #{number}. Seminole County.\n{link}", es: "Miembro #{number}. Condado de Seminole.\n{link}" },
    "share.foundingCard.short": { en: "Member #{number} of Seminole County's Young Democrats. Your card is waiting: {link}", es: "Miembro #{number} de los jóvenes demócratas del condado de Seminole. Tu tarjeta te espera: {link}" },
    "share.foundingCard.email.subject": { en: "I'm member #{number}. You could be next.", es: "Soy miembro #{number}. La próxima tarjeta puede ser tuya." },
    "share.foundingCard.email.body": {
      en: "Hi,\n\nI joined the Young Democrats of Seminole County and got member card #{number}. Joining takes under a minute, and you'd get a card of your own.\n\n{link}",
      es: "Hola:\n\nMe uní a los Young Democrats of Seminole County y me dieron la tarjeta de miembro #{number}. Unirte toma menos de un minuto, y te darían tu propia tarjeta.\n\n{link}",
      note: "In demo mode the number is a sample and the card carries demo.watermark."
    },

    // ---- RSVP'd: "I'm going" (vars: event, date, time, place)
    "share.rsvp.sms": { en: "I'm going to {event} ({date}, {time}). Come with me? It's better with someone you know. {link}", es: "Voy a {event} ({date}, {time}). ¿Vienes conmigo? Es mejor con alguien conocido. {link}" },
    "share.rsvp.whatsapp": {
      en: "Just saved my seat for {event}: {date}, {time}, {place}. I'd love company. RSVP with this link and we'll find each other there: {link}",
      es: "Acabo de guardar mi lugar para {event}: {date}, {time}, {place}. Me encantaría ir con alguien. Confirma con este enlace y nos encontramos allá: {link}"
    },
    "share.rsvp.igStory": { en: "Going. {event}, {date}. 🗓️\n{link}", es: "Voy. {event}, {date}. 🗓️\n{link}" },
    "share.rsvp.short": { en: "Going to {event} ({date}, {time}). Save a seat and come find me: {link}", es: "Voy a {event} ({date}, {time}). Guarda tu lugar y búscame allá: {link}" },
    "share.rsvp.email.subject": { en: "I'm going to {event}. Come with me?", es: "Voy a {event}. ¿Vienes conmigo?" },
    "share.rsvp.email.body": {
      en: "Hi,\n\nI RSVP'd to {event} on {date} at {time}, at {place}. It's a Young Democrats of Seminole County event, and it'd be more fun with you there.\n\nSave your seat here: {link}",
      es: "Hola:\n\nConfirmé que voy a {event}: {date}, {time}, en {place}. Es un evento de los Young Democrats of Seminole County y sería más divertido contigo.\n\nGuarda tu lugar aquí: {link}"
    },

    // ---- One clip
    "share.clip.sms": { en: "Short clip from someone here in Seminole. Worth a minute: {link}", es: "Un clip corto de alguien de aquí, de Seminole. Vale la pena verlo: {link}" },
    "share.clip.whatsapp": { en: "Watch this: a short clip from someone in Seminole about why they show up. Then maybe make your own? {link}", es: "Mira esto: un clip corto de alguien de Seminole sobre por qué participa. ¿Y si luego haces el tuyo? {link}" },
    "share.clip.igStory": { en: "This one's worth the watch.\n{link}", es: "Este vale la pena.\n{link}" },
    "share.clip.short": { en: "A short clip from someone in Seminole County about why they show up. {link}", es: "Un clip corto de alguien del condado de Seminole sobre por qué participa. {link}" },
    "share.clip.email.subject": { en: "Watch this short clip from Seminole", es: "Mira este clip corto desde Seminole" },
    "share.clip.email.body": {
      en: "Hi,\n\nSomeone here in Seminole made this short clip about why they show up, and I thought of you. It's quick:\n\n{link}",
      es: "Hola:\n\nAlguien de aquí, de Seminole, hizo este clip corto sobre por qué participa, y me acordé de ti. Es rápido:\n\n{link}"
    },

    // ---- Post your take (invite someone to make a clip)
    "share.postTake.sms": {
      en: "The Young Dems are collecting short clips from people in Seminole about why they show up. Got something to say? Film it vertical and send it in: {link}",
      es: "Los Young Dems están reuniendo clips cortos de gente de Seminole sobre por qué participa. ¿Tienes algo que decir? Grábalo en vertical y mándalo: {link}"
    },
    "share.postTake.whatsapp": {
      en: "You'd be great at this: short vertical clips about why you care about Seminole. Keep it kind, film it vertical, and a real person reviews it before it goes up. {link}",
      es: "Te quedaría muy bien: clips cortos y verticales sobre por qué te importa Seminole. Que sea respetuoso, grábalo en vertical, y una persona lo revisa antes de publicarlo. {link}",
      placeholder: "chapter-confirm"
    },
    "share.postTake.igStory": { en: "Got a minute and something to say about Seminole?\n{link}", es: "¿Tienes un minuto y algo que decir sobre Seminole?\n{link}" },
    "share.postTake.short": { en: "Got a minute and something to say about Seminole County? Film it vertical, keep it kind, send it in: {link}", es: "¿Tienes un minuto y algo que decir sobre el condado de Seminole? Grábalo en vertical, que sea respetuoso, y mándalo: {link}" },
    "share.postTake.email.subject": { en: "You should make one of these", es: "Deberías hacer uno de estos" },
    "share.postTake.email.body": {
      en: "Hi,\n\nThe Young Democrats of Seminole County post short vertical clips from people here about why they show up. You'd be good at it. Keep it kind, film it vertical, and a real person reviews every clip before it goes public:\n\n{link}",
      es: "Hola:\n\nLos Young Democrats of Seminole County publican clips cortos y verticales de gente de aquí sobre por qué participa. Te saldría muy bien. Que sea respetuoso, grábalo en vertical, y una persona revisa cada clip antes de publicarlo:\n\n{link}",
      placeholder: "chapter-confirm"
    },

    // ---- Post-election (Nov 3, 2026 results; unofficial until certified)
    "share.result.sms": {
      en: "Seminole voted blue for governor on Nov 3, even though the state went the other way (unofficial results). That's a start, not a finish. Here's where the next part happens: {link}",
      es: "En Seminole ganó el candidato demócrata a gobernador el 3 de noviembre, aunque en el estado ganó el republicano (resultados no oficiales). Es un comienzo, no el final. Aquí empieza lo que sigue: {link}",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      sources: ["https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00",
      note: "WFTV unofficial county results: Jolly 54.08%, Donalds 44.59% in Seminole. Spanish avoids \"votó azul\" (party colors don't travel). After certification, drop \"unofficial\" and re-check the numbers."
    },
    "share.result.whatsapp": {
      en: "However Nov 3 landed for you: Seminole County voted for the Democrat for governor, even as Florida went the other way (unofficial results). The next elections are local, and that's where a few more people showing up goes a long way. {link}",
      es: "Como sea que te hayas sentido con el 3 de noviembre: en el condado de Seminole ganó el candidato demócrata a gobernador, aunque en Florida ganó el republicano (resultados no oficiales). Las próximas elecciones son locales, y ahí unas cuantas personas más sí hacen la diferencia. {link}",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      sources: ["https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00"
    },
    "share.result.igStory": {
      en: "Seminole voted blue for governor (unofficial results). Now the local work.\n{link}",
      es: "En Seminole ganó el demócrata a gobernador (resultados no oficiales). Ahora, lo local.\n{link}",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00"
    },
    "share.result.short": {
      en: "Seminole County voted blue for governor on Nov 3, even as Florida didn't (unofficial results). A start, not a finish. {link}",
      es: "En el condado de Seminole ganó el demócrata a gobernador el 3 de noviembre, aunque en Florida no (resultados no oficiales). Un comienzo, no el final. {link}",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      sources: ["https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00"
    },
    "share.result.email.subject": {
      en: "Seminole voted blue for governor. Now what?", es: "En Seminole ganó el demócrata a gobernador. ¿Y ahora?",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00"
    },
    "share.result.email.body": {
      en: "Hi,\n\nHowever Nov 3 landed for you, here's something real: Seminole County voted for the Democrat for governor, about 54% to 45% in unofficial returns, even though the statewide result went the other way. It's a start, not a finish.\n\nThe next elections are local. If you want to be part of what comes next, this is a good place to begin:\n\n{link}",
      es: "Hola:\n\nComo sea que te hayas sentido con el 3 de noviembre, aquí va algo concreto: en el condado de Seminole ganó el candidato demócrata a gobernador, con cerca del 54% contra el 45% según resultados no oficiales, aunque en el estado el resultado fue el contrario. Es un comienzo, no el final.\n\nLas próximas elecciones son locales. Si quieres ser parte de lo que sigue, este es un buen lugar para empezar:\n\n{link}",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      sources: ["https://floridaphoenix.com/2026/11/03/donalds-defeats-jolly-becoming-floridas-first-black-governor/"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00"
    },

    // ==================================================================================== SEO
    // ---- home
    "seo.home.title": {
      en: "Young Democrats of Seminole County | Ages 14 to 39", es: "Young Democrats of Seminole County | De 14 a 39 años",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high"
    },
    "seo.home.description": {
      en: "Seminole County's Young Democrats: meetups, plain-words voting help in English and Spanish, issue quizzes and clips from people who live here.",
      es: "Los jóvenes demócratas del condado de Seminole: reuniones, ayuda para votar sin enredos en inglés y español, quizzes de temas locales y clips de gente de aquí."
    },
    "seo.home.ogTitle": { en: "Local politics is a group project", es: "La política local es un trabajo en equipo" },
    "seo.home.ogDescription": {
      en: "Seminole County's Young Democrats, ages 14 to 39. Meetups, voting help that makes sense, and a seat saved for you.",
      es: "Los jóvenes demócratas del condado de Seminole, de 14 a 39 años. Reuniones, ayuda para votar que se entiende y un lugar guardado para ti.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high"
    },
    // ---- join
    "seo.join.title": { en: "Join the Young Dems | YDSC", es: "Únete a los Young Dems | YDSC" },
    "seo.join.description": {
      en: "Join the Young Democrats of Seminole County, ages 14 to 39. A first name and an email or phone gets you started. Dues are $20 a year, with a free option.",
      es: "Únete a los Young Democrats of Seminole County (de 14 a 39 años). Basta tu nombre y un correo o celular. La cuota es de $20 al año, con opción gratis.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "\"Free option\" = non-voting membership for anyone who can't pay dues."
    },
    "seo.join.ogTitle": { en: "Come as you are. Bring a friend.", es: "Ven como eres. Trae a alguien." },
    "seo.join.ogDescription": {
      en: "Join Seminole County's Young Democrats. Takes under a minute, and nobody expects you to know everything on day one.",
      es: "Únete a los jóvenes demócratas del condado de Seminole. Toma menos de un minuto y nadie espera que lo sepas todo el primer día."
    },
    // ---- events
    "seo.events.title": { en: "Events in Seminole County | YDSC", es: "Eventos en el condado de Seminole | YDSC" },
    "seo.events.description": {
      en: "Meetups, volunteer shifts and hangouts with the Young Democrats of Seminole County. Times, places, access notes and a quick RSVP, no account needed.",
      es: "Reuniones, voluntariado y encuentros con los Young Democrats of Seminole County. Horarios, lugares, accesibilidad y confirmación rápida, sin crear cuenta."
    },
    "seo.events.ogTitle": { en: "What's coming up in Seminole", es: "Lo que viene en Seminole" },
    "seo.events.ogDescription": {
      en: "Pick a night, save your seat, bring a friend. Every event lists the time, the place and how to get in.",
      es: "Elige una noche, guarda tu lugar y trae a alguien. Cada evento dice la hora, el lugar y cómo es el acceso."
    },
    // ---- event invite (template: event, date, time, place)
    "seo.eventInvite.title": { en: "{event}, {date} | YDSC", es: "{event}, {date} | YDSC" },
    "seo.eventInvite.description": {
      en: "{event} with the Young Democrats of Seminole County: {date}, {time}, {place}. Quick RSVP, no account needed. Bring a friend.",
      es: "{event} con los Young Democrats of Seminole County: {date}, {time}, {place}. Confirma rápido, sin crear cuenta, y trae a alguien."
    },
    "seo.eventInvite.ogTitle": { en: "You're invited: {event}", es: "Te invitamos: {event}" },
    "seo.eventInvite.ogDescription": { en: "{date}, {time}, {place}. First time? Perfect.", es: "{date}, {time}, {place}. ¿Primera vez? Perfecto." },
    // ---- vote
    "seo.vote.title": { en: "Vote in Seminole County: what changed | YDSC", es: "Votar en el condado de Seminole: qué cambió | YDSC" },
    "seo.vote.description": {
      en: "Plain-words voting help for Seminole County: mail ballots, voter ID, registration and the next election dates, with official links.",
      es: "Ayuda para votar en el condado de Seminole, sin enredos: boleta por correo, identificación, inscripción y próximas fechas, con enlaces oficiales."
    },
    "seo.vote.ogTitle": { en: "Seminole voting, minus the confusion", es: "Votar en Seminole, sin confusión" },
    "seo.vote.ogDescription": {
      en: "Mail-ballot requests from before Nov 3 end Dec 31, and student IDs stop counting at the polls on Jan 1, 2027. Here's what to do, in plain words.",
      es: "Las solicitudes de boleta por correo de antes del 3 de noviembre vencen el 31 de diciembre, y desde el 1 de enero de 2027 la identificación de estudiante no sirve para votar.",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://flsenate.gov/Committees/BillSummaries/2026/html/991"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "seo.vote.ogDescriptionLater",
      note: "Static HTML: swap to seo.vote.ogDescriptionLater in the page head on Jan 1, 2027."
    },
    "seo.vote.ogDescriptionLater": {
      en: "Mail-ballot requests from before Nov 3, 2026 have ended, and student IDs no longer count at the polls. What to bring and how to renew, in plain words.",
      es: "Las solicitudes de boleta por correo de antes del 3 de noviembre de 2026 vencieron, y la identificación de estudiante ya no sirve para votar. Qué llevar y cómo renovarla.",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://flsenate.gov/Committees/BillSummaries/2026/html/991"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00", recheck: "2026-12-15"
    },
    // ---- feed
    "seo.feed.title": { en: "Clips from Seminole | YDSC", es: "Clips desde Seminole | YDSC" },
    "seo.feed.description": {
      en: "Short videos from people around Seminole County on why they show up, plus how to post your own. A real person reviews every clip.",
      es: "Videos cortos de gente del condado de Seminole sobre por qué participa, y cómo subir el tuyo. Una persona revisa cada clip.",
      placeholder: "chapter-confirm"
    },
    "seo.feed.ogTitle": { en: "Why we show up", es: "Por qué participamos" },
    "seo.feed.ogDescription": { en: "Short clips from people around Seminole County. Sound optional.", es: "Clips cortos de gente del condado de Seminole. El sonido es opcional." },
    // ---- post (upload)
    "seo.post.title": { en: "Post a clip | YDSC", es: "Sube un clip | YDSC" },
    "seo.post.description": {
      en: "Got something to say about Seminole? Post a short vertical clip. A real person reviews every clip before it goes public.",
      es: "¿Tienes algo que decir sobre Seminole? Sube un clip corto y vertical. Una persona revisa cada clip antes de publicarlo.",
      placeholder: "chapter-confirm"
    },
    "seo.post.ogTitle": { en: "Got a minute and something to say?", es: "¿Tienes un minuto y algo que decir?" },
    "seo.post.ogDescription": { en: "Film it vertical, keep it kind, send it in.", es: "Grábalo en vertical, que sea respetuoso, y mándalo." },
    // ---- issues
    "seo.issues.title": { en: "Local issues in Seminole County | YDSC", es: "Temas locales del condado de Seminole | YDSC" },
    "seo.issues.description": {
      en: "Rent, storms and insurance, reproductive and LGBTQ+ freedom, schools, wages, SunRail, clean water and voting rights: Seminole numbers and one thing to do.",
      es: "Alquiler, tormentas y seguros, libertad reproductiva y LGBTQ+, escuelas, sueldos, SunRail, agua limpia y derecho al voto: datos de Seminole y algo que hacer.",
      note: "Names follow data/issues.js items[].title (9 issues). Update if the list changes."
    },
    "seo.issues.ogTitle": { en: "The Seminole numbers behind the headlines", es: "Los datos de Seminole detrás de los titulares" },
    "seo.issues.ogDescription": { en: "Nine local issues, sourced, each with one thing you can actually do.", es: "Nueve temas locales, con fuentes, cada uno con algo que de verdad puedes hacer." },
    // ---- quiz
    "seo.quiz.title": { en: "Quizzes: find your issue, find your era | YDSC", es: "Quizzes: encuentra tu tema y tu modo | YDSC" },
    "seo.quiz.description": {
      en: "Two quick quizzes from the Young Democrats of Seminole County: the local issue that's yours, and the way you like to organize. Shareable results.",
      es: "Dos quizzes rápidos de los Young Democrats of Seminole County: el tema local que es tuyo y tu modo de organizar. Resultados para compartir."
    },
    "seo.quiz.ogTitle": { en: "Which Seminole issue is yours?", es: "¿Cuál tema de Seminole es el tuyo?" },
    "seo.quiz.ogDescription": { en: "Seven everyday questions, one match, and three things you can do about it.", es: "Siete preguntas de la vida diaria, un resultado y tres cosas que puedes hacer al respecto." },
    // ---- quiz result (template: match; for pre-rendered /quiz/<slug>/<result>.html pages)
    "seo.quizResult.title": { en: "{match}: a Seminole quiz result | YDSC", es: "{match}: un resultado del quiz de Seminole | YDSC" },
    "seo.quizResult.description": { en: "A one-minute quiz from the Young Democrats of Seminole County. See the result, then take it yourself.", es: "Un quiz de un minuto de los Young Democrats of Seminole County. Mira el resultado y luego hazlo tú." },
    "seo.quizResult.ogTitle": { en: "I got {match}. What's yours?", es: "Me salió {match}. ¿Y a ti?" },
    "seo.quizResult.ogDescription": { en: "One minute, everyday questions, one match. Take the quiz.", es: "Un minuto, preguntas de la vida diaria, un resultado. Haz el quiz." },
    // ---- newsletter
    "seo.newsletter.title": { en: "The Thursday Letter: weekly email | YDSC", es: "La Carta del Jueves: correo semanal | YDSC", placeholder: "chapter-confirm" },
    "seo.newsletter.description": {
      en: "One short email a week from the Young Democrats of Seminole County: what's on, one thing to do, a few local picks. No guilt, unsubscribe anytime.",
      es: "Un correo corto a la semana de los Young Democrats of Seminole County: qué hay, una cosa para hacer y recomendaciones locales. Te das de baja cuando quieras.",
      placeholder: "chapter-confirm"
    },
    "seo.newsletter.ogTitle": { en: "One good email a week", es: "Un buen correo a la semana", placeholder: "chapter-confirm" },
    "seo.newsletter.ogDescription": { en: "What's happening in Seminole, one thing to do, and nothing panicky.", es: "Lo que pasa en Seminole, una cosa para hacer y cero pánico.", placeholder: "chapter-confirm" },
    // ---- about
    "seo.about.title": { en: "About the Young Democrats of Seminole County", es: "Quiénes somos: Young Democrats of Seminole County" },
    "seo.about.description": {
      en: "Seminole County's chapter of the Florida Young Democrats, for ages 14 to 39: what we do, who can join, how dues work, and how to get involved.",
      es: "El capítulo del condado de Seminole de los Florida Young Democrats, de 14 a 39 años: qué hacemos, quién puede unirse, cómo funciona la cuota y cómo participar.",
      source: "https://secure.actblue.com/donate/ydscdues", sources: ["https://www.floridayoungdems.com/current-chapters"],
      verified: "2026-11-09", confidence: "high"
    },
    "seo.about.ogTitle": { en: "Who the Young Dems are", es: "Quiénes son los Young Dems" },
    "seo.about.ogDescription": {
      en: "Seminole County's young Democrats: how we work, who can join, and how to jump in without a big commitment.",
      es: "Los jóvenes demócratas del condado de Seminole: cómo trabajamos, quién puede unirse y cómo empezar sin un gran compromiso."
    },
    // ---- privacy
    "seo.privacy.title": { en: "Privacy | YDSC", es: "Privacidad | YDSC" },
    "seo.privacy.description": {
      en: "What the Young Democrats of Seminole County collect, why, who sees it, and how to delete it.",
      es: "Qué datos recopilan los Young Democrats of Seminole County, para qué, quién los ve y cómo borrarlos.",
      mirror: "legal.pages.privacy.summary"
    },
    "seo.privacy.ogTitle": { en: "Privacy, in plain words", es: "Privacidad, en palabras sencillas" },
    "seo.privacy.ogDescription": {
      en: "We never sell your info. Here's exactly what we keep and how to delete it.",
      es: "Nunca vendemos tus datos. Aquí está exactamente qué guardamos y cómo borrarlo.",
      placeholder: "legal-review", note: "Draft policy commitment from data/legal.js; counsel signs off."
    },
    // ---- accessibility
    "seo.accessibility.title": { en: "Accessibility | YDSC", es: "Accesibilidad | YDSC" },
    "seo.accessibility.description": {
      en: "Our accessibility goal (WCAG 2.2 AA), what doesn't work yet, and how to get help fast.",
      es: "Nuestra meta de accesibilidad (WCAG 2.2 AA), lo que todavía no funciona bien y cómo pedir ayuda rápido.",
      mirror: "legal.pages.accessibility.summary"
    },
    "seo.accessibility.ogTitle": { en: "Our goal: a site everyone can use", es: "Nuestra meta: un sitio que todos puedan usar" },
    "seo.accessibility.ogDescription": { en: "What works, what doesn't yet, and how to reach a person fast.", es: "Lo que funciona, lo que todavía no y cómo hablar rápido con una persona." },
    // ---- 404
    "seo.notFound.title": { en: "Page not found | YDSC", es: "Página no encontrada | YDSC" },
    "seo.notFound.description": {
      en: "This page doesn't exist or has moved. Head back to the Young Democrats of Seminole County home page.",
      es: "Esta página no existe o cambió de dirección. Vuelve a la página de inicio de los Young Democrats of Seminole County."
    },
    "seo.notFound.ogTitle": { en: "Page not found", es: "Página no encontrada" },
    "seo.notFound.ogDescription": { en: "This page skipped the meeting. Let's get you back home.", es: "Esta página no llegó a la reunión. Te llevamos de vuelta al inicio." },

    // ================================================================================== NUDGE
    "nudge.mailBallot.eyebrow": { en: "HEADS UP", es: "OJO", expires: "2027-01-01T00:00:00-05:00", next: "nudge.mailBallot2027.eyebrow" },
    "nudge.mailBallot.text": {
      en: "Asked for a mail ballot before Nov 3? That request ends Dec 31. Renew it once and you're covered through 2028.",
      es: "¿Pediste la boleta por correo antes del 3 de noviembre? Esa solicitud vence el 31 de diciembre. Renuévala una vez y te cubre hasta finales de 2028.",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", expires: "2027-01-01T00:00:00-05:00", next: "nudge.mailBallot2027.text",
      note: "Same wording as data/civic.js changes[mail-ballot-expiry].short."
    },
    "nudge.mailBallot2027.eyebrow": { en: "VOTE BY MAIL?", es: "¿VOTAS POR CORREO?", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00" },
    "nudge.mailBallot2027.text": {
      en: "Requests made before Nov 3, 2026 ended Dec 31, 2026. One new request covers every election through Dec 31, 2028.",
      es: "Las solicitudes hechas antes del 3 de noviembre de 2026 vencieron el 31 de diciembre de 2026. Una nueva te cubre en todas las elecciones hasta el 31 de diciembre de 2028.",
      source: "https://www.flsenate.gov/Laws/Statutes/2026/101.62", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"],
      verified: "2026-11-09", confidence: "high", showFrom: "2027-01-01T00:00:00-05:00", expires: "2028-11-08T00:00:00-05:00",
      note: "Same wording as data/civic.js changes[mail-ballot-expiry].phases[1].short. Pair it with the nudge.mailBallot2027.eyebrow (\"VOTE BY MAIL?\")."
    },
    "nudge.studentId.eyebrow": { en: "NEW IN 2027", es: "NUEVO EN 2027", tone: "serious", expires: "2028-11-08T00:00:00-05:00" },
    "nudge.studentId.text": {
      en: "Starting Jan 1, 2027, Florida stops accepting student IDs at the polls (it's being challenged in court). Bring a driver's license, state ID or passport, and check voteseminole.gov before you go.",
      es: "Desde el 1 de enero de 2027, Florida deja de aceptar la identificación de estudiante para votar (la medida está impugnada en los tribunales). Lleva tu licencia de conducir, tu identificación estatal o tu pasaporte, y revisa voteseminole.gov antes de ir.",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      sources: ["https://flsenate.gov/Session/Bill/2026/991", "https://www.democracydocket.com/wp-content/uploads/2026/10/2026-10-16-Complaint.pdf"],
      verified: "2026-11-09", confidence: "high", recheck: "2026-12-15", expires: "2028-11-08T00:00:00-05:00",
      note: "Required copy shape, verbatim (docs/research/00). Same wording as data/civic.js changes[student-id].copy."
    },
    "nudge.citizenship.text": {
      en: "Registering for the first time, or updating your name or address? Starting Jan 1, 2027, Florida checks citizenship when you register or update your record. Do it early on the official state site, so there's time to answer if the elections office asks for anything.",
      es: "¿Te vas a inscribir por primera vez o vas a cambiar tu nombre o dirección? Desde el 1 de enero de 2027, Florida verifica la ciudadanía cuando te inscribes o actualizas tu registro. Hazlo con tiempo en el sitio oficial del estado, por si la oficina electoral te pide algo.",
      tone: "serious", source: "https://flsenate.gov/Committees/BillSummaries/2026/html/991",
      verified: "2026-11-09", confidence: "high", expires: "2028-11-08T00:00:00-05:00",
      note: "HB 991 summary: DHSMV REAL ID citizenship data is checked for new registration applicants and for voters updating their registration, from Jan 1, 2027 (not only new registrations). Matches data/civic.js changes[citizenship-check]. Plain, no fearmongering (docs/research/00). Link links.vote.register."
    },
    "nudge.preRegister.text": {
      en: "Turning 16? Florida lets you pre-register, so you're ready to vote in any election on or after your 18th birthday.",
      es: "¿Vas a cumplir 16? Desde ese día, en Florida puedes preinscribirte y así votar en cualquier elección desde que cumplas 18.",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html",
      sources: ["https://voteseminole.gov/voters/register-to-vote/"], verified: "2026-11-09", confidence: "high"
    },
    "nudge.registrationDeadline.text": {
      en: "Registration closes 29 days before every Florida election. Check yours now, and future you says thanks.",
      es: "En Florida, la inscripción para votar cierra 29 días antes de cada elección. Revisa la tuya ahora y tu yo del futuro te lo agradece.",
      source: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.055.html",
      verified: "2026-11-09", confidence: "high"
    },
    "nudge.soePhone.text": {
      en: "Questions about voting? The Seminole County Supervisor of Elections answers at {soePhone}.",
      es: "¿Dudas sobre cómo votar? La oficina del Supervisor de Elecciones del condado de Seminole responde en el {soePhone}.",
      source: "https://voteseminole.gov/contact-us/", sources: ["https://voteseminole.gov/how-to-vote/vote-by-mail/"], verified: "2026-11-09", confidence: "high",
      note: "The SOE contact page lists 407-585-8683 as General Inquiries (407-585-VOTE on My Voter Record); 407-708-7705 is the fax. Hours per data/civic.js office: Mon to Fri, 8 am to 5 pm."
    },
    "nudge.independents.text": {
      en: "No party, or still deciding? You're in good company: the biggest group of Seminole voters 18 to 40 isn't registered with any party.",
      es: "¿Sin partido o todavía lo estás pensando? Estás en buena compañía: el grupo más grande de votantes de 18 a 40 años en Seminole no está inscrito en ningún partido.",
      source: "https://voteseminole.gov/wp-content/uploads/2026/07/District-Demographic-Analysis.pdf",
      verified: "2026-11-09", confidence: "high",
      note: "SOE District Demographic Analysis dated 7/1/2026, countywide rows AGE 18-25 through AGE 36-40, re-added by the checker: NPA 42,710, Dem 40,696, Rep 34,200, other parties 7,020, total 124,626 (NPA 34.3%, the biggest group but not a majority). Never write \"most\"."
    },
    "nudge.result.text": {
      en: "Seminole voted blue for governor on Nov 3 (unofficial results).",
      es: "En Seminole ganó el candidato demócrata a gobernador el 3 de noviembre (resultados no oficiales).",
      tone: "serious", source: "https://www.wftv.com/news/local/florida-election-results-by-county-explore-governor-us-senate-races/M4I4A3YEGJH6BJ3TSVPISSSXHA/",
      verified: "2026-11-09", confidence: "high", recheck: "2026-11-18", expires: "2027-01-01T00:00:00-05:00",
      note: "Wording allowed by docs/research/00. Keep \"unofficial\" until the county certifies."
    },

    // =================================================================================== JOIN
    "join.eligibility": {
      en: "Members are {minAge} to {maxAge} and share the principles of the Democratic Party.",
      es: "Los miembros tienen de {minAge} a {maxAge} años y comparten los principios del Partido Demócrata.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "YDSC Article III, Section 1, quoted on the dues page: \"Any person of at least fourteen (14) years of age and under forty (40) years of age\" who \"professes and demonstrates allegiance to the principles of the Democratic Party shall be eligible for membership.\""
    },
    "join.noRegistration": {
      en: "Not registered as a Democrat? The membership rule asks you to stand by the Democratic Party's principles. It doesn't mention how you're registered.",
      es: "¿Tu inscripción electoral no dice demócrata? La regla de membresía pide respaldar los principios del Partido Demócrata, y no menciona con qué partido te inscribiste.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "med",
      placeholder: "chapter-confirm",
      note: "Article III as quoted on the dues page never mentions voter registration, and non-voting membership is open to people who can't pay dues because of \"citizenship status\", who can't register to vote at all. So registration can't be a membership requirement. Still an inference from a page excerpt: confirm against the full bylaws."
    },
    "join.dues": {
      en: "Dues are ${duesAmount} a year, paid in January (or when you join). Can't pay? Whatever the reason, you can be a non-voting member for free.",
      es: "La cuota es de ${duesAmount} al año y se paga en enero (o cuando te unes). ¿No puedes pagarla? Sea cual sea la razón, puedes ser miembro sin voto, gratis.",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "Dues page: \"$20 annually, to be paid during the month of January, unless a member joins later in the year\"; non-voting membership for anyone eligible who \"cannot pay dues for any reason, such as citizenship status, financial hardship, etc.\" The page also says only U.S. citizens over 18 may contribute to YDSC, so members 14 to 17 likely join as non-voting members: the chapter should confirm before any copy says so."
    },
    "join.votingMembers": {
      en: "Voting members pay dues and live in Seminole County or go to school here (high school, college or university).",
      es: "Los miembros con voto pagan la cuota y viven en el condado de Seminole o estudian aquí (escuela secundaria, college o universidad).",
      source: "https://secure.actblue.com/donate/ydscdues", verified: "2026-11-09", confidence: "high",
      note: "Article III, Section 3, quoted on the dues page: \"Voting Membership shall be extended to any dues paying individual who is a resident or domiciliary in Seminole County, or a student of a fully accredited high school, college, university or institution of higher learning in Seminole County, Florida.\" The earlier draft left out the dues requirement."
    },
    "join.time": { en: "Takes under a minute.", es: "Toma menos de un minuto." },
    "join.next": {
      en: "What happens next: we say hi, invite you to one thing near you, and only send what you asked for.",
      es: "Qué sigue: te saludamos, te invitamos a algo cerca de ti y solo te mandamos lo que pediste.",
      placeholder: "chapter-confirm"
    },
    "join.noPressure": { en: "No experience needed. Nobody expects you to know everything on day one.", es: "No necesitas experiencia. Nadie espera que lo sepas todo el primer día." },

    // ================================================================================== EVENT
    "event.when": { en: "When", es: "Cuándo" },
    "event.where": { en: "Where", es: "Dónde" },
    "event.whoFor": { en: "Who it's for", es: "Para quién es" },
    "event.access": { en: "Getting in", es: "Accesibilidad" },
    "event.cost": { en: "Cost", es: "Costo" },
    "event.whosGoing": { en: "Who's going", es: "Quiénes van" },
    "event.free": { en: "Free", es: "Gratis", note: "Only when the event data says it's free." },
    "event.stepFree": { en: "Step-free entrance", es: "Entrada sin escalones" },
    "event.kidFriendly": { en: "Kid-friendly", es: "Apto para niños" },
    "event.firstTimers": { en: "First time? Perfect.", es: "¿Primera vez? Perfecto." },
    "event.spanish": { en: "Spanish spoken", es: "Se habla español" },
    "event.asl": { en: "ASL interpreter on request", es: "Intérprete de lengua de señas (ASL) si lo pides" },
    "event.transit": { en: "Near SunRail", es: "Cerca de SunRail" },
    "event.parking": { en: "Free parking", es: "Estacionamiento gratis" },
    "event.allAges": { en: "All ages", es: "Para todas las edades" },
    "event.online": { en: "Online", es: "En línea" },
    "event.addressAfterRsvp": { en: "Exact address after you RSVP.", es: "La dirección exacta te llega cuando confirmes.", note: "Only if the RSVP flow really sends it." },
    "event.full": { en: "Full. Join the waitlist?", es: "Lleno. ¿Te anotas en la lista de espera?" },
    "event.past": { en: "This one already happened.", es: "Este evento ya pasó." },
    "event.canceled": { en: "Canceled", es: "Cancelado" },
    "event.bringFriend": { en: "Bring a friend", es: "Trae a alguien" },

    // =================================================================================== FEED
    "feed.play": { en: "Play", es: "Reproducir" },
    "feed.pause": { en: "Pause", es: "Pausar" },
    "feed.sound": { en: "Sound", es: "Sonido" },
    "feed.unmute": { en: "Turn sound on", es: "Activar sonido" },
    "feed.mute": { en: "Turn sound off", es: "Silenciar" },
    "feed.like": { en: "Like", es: "Me gusta" },
    "feed.next": { en: "Next clip", es: "Siguiente clip" },
    "feed.prev": { en: "Previous clip", es: "Clip anterior" },
    "feed.videoBy": { en: "Video by {who}: {caption}", es: "Video de {who}: {caption}", note: "aria-label for each <video> (assets/js/feed.js builds one in English by default)." },
    "feed.keys": { en: "Arrows or J/K to move, Space to play or pause, M for sound.", es: "Flechas o J/K para moverte, espacio para reproducir o pausar, M para el sonido." },
    "feed.inReview": { en: "In review: only you can see this.", es: "En revisión: solo tú puedes verlo." },
    "feed.loadError": { en: "This clip won't play right now. Try the next one.", es: "Este clip no se puede reproducir ahora. Prueba el siguiente." },
    "feed.reducedMotion": { en: "Autoplay is off because your device asked for less motion. Tap a clip to play it.", es: "La reproducción automática está desactivada porque tu dispositivo pidió menos movimiento. Toca un clip para verlo." },
    "feed.views.one": { en: "1 view", es: "1 vista" },
    "feed.views.other": { en: "{count} views", es: "{count} vistas" },
    "feed.likes.one": { en: "1 like", es: "1 me gusta" },
    "feed.likes.other": { en: "{count} likes", es: "{count} me gusta" },

    // ================================================================================== COUNT
    "count.going.one": { en: "1 person going", es: "Va 1 persona" },
    "count.going.other": { en: "{count} going", es: "Van {count} personas", note: "Demo counts must say DEMO: add demo.badgeNumber next to them, or use data/events.js labels.going (\"{n} going (DEMO)\"). Same for every count.* line." },
    "count.spotsLeft.one": { en: "1 spot left", es: "Queda 1 lugar" },
    "count.spotsLeft.other": { en: "{count} spots left", es: "Quedan {count} lugares" },
    "count.joined.one": { en: "1 person joined", es: "Se unió 1 persona" },
    "count.joined.other": { en: "{count} people joined", es: "Se unieron {count} personas" },
    "count.pledges.one": { en: "1 pledge", es: "1 compromiso" },
    "count.pledges.other": { en: "{count} pledges", es: "{count} compromisos" },
    "count.squad.one": { en: "1 friend joined with your link", es: "1 persona se unió con tu enlace" },
    "count.squad.other": { en: "{count} friends joined with your link", es: "{count} personas se unieron con tu enlace" },
    "count.founding": { en: "Be one of the first {count}.", es: "Sé de las primeras {count} personas.", note: "Show below a real-count threshold instead of a small number (report 04, mechanic 7)." },
    "count.daysLeft.one": { en: "1 day left", es: "Queda 1 día" },
    "count.daysLeft.other": { en: "{count} days left", es: "Quedan {count} días" },
    "count.daysUntil.one": { en: "1 day until {what}", es: "Falta 1 día para {what}" },
    "count.daysUntil.other": { en: "{count} days until {what}", es: "Faltan {count} días para {what}" },
    "count.today": { en: "Today", es: "Hoy" },
    "count.tomorrow": { en: "Tomorrow", es: "Mañana" },

    // ================================================================================= FORMAT
    "format.date": { en: "{weekday}, {month} {day}", es: "{weekday} {day} de {month}", note: "\"Thu, Dec 3\" / \"jue 3 de dic\"." },
    "format.dateYear": { en: "{weekday}, {month} {day}, {year}", es: "{weekday} {day} de {month} de {year}" },
    "format.time": { en: "{h}:{mm} {ampm}", es: "{h}:{mm} {ampm}", note: "Drop \":{mm}\" when it's 00: \"7 pm\", \"7:30 pm\", \"7 p. m.\"." },
    "format.ampm.am": { en: "am", es: "a. m." },
    "format.ampm.pm": { en: "pm", es: "p. m." },
    "format.timeRange": { en: "{start} to {end}", es: "de {start} a {end}" },
    "format.eventWhen": { en: "{date} · {time}", es: "{date} · {time}" },
    "format.list2": { en: "{a} and {b}", es: "{a} y {b}", note: "Spanish uses \"e\" before words starting with an i sound; rare here." },

    // ========================================================================= A11Y STATEMENT
    "a11yStatement.title": { en: "Accessibility", es: "Accesibilidad" },
    "a11yStatement.short": {
      en: "We're aiming for every page to meet WCAG 2.2 AA, the web accessibility standard, and we haven't finished a full audit yet. If something doesn't work for you, email {privacyEmail} and a person will reply within 2 business days.",
      es: "Queremos que todas las páginas cumplan con WCAG 2.2 AA, el estándar de accesibilidad web, y todavía no terminamos una auditoría completa. Si algo no te funciona, escribe a {privacyEmail} y una persona te responde en 2 días hábiles.",
      placeholder: "legal-review", source: "https://www.w3.org/TR/WCAG22/", verified: "2026-11-09", confidence: "high",
      note: "Condensed from data/legal.js pages.accessibility (goal, status, 2-business-day reply). No \"this is a demo\" here: the entry isn't demo-only, so its status line has to stay true after launch (the DEMO banner covers the preview). The reply time is a proposal for the board."
    },
    "a11yStatement.urgent": {
      en: "Voting deadline today? Say it's urgent and we answer the same day.",
      es: "¿Tienes una fecha límite para votar hoy? Dinos que es urgente y te respondemos el mismo día.",
      mirror: "legal.pages.accessibility.tldr.3", placeholder: "legal-review"
    },
    "a11yStatement.link": { en: "Read the full accessibility statement", es: "Lee la declaración de accesibilidad completa" }
  }
};
