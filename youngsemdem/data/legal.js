/*!
 * Legal and policy copy for the youngsemdems site (Young Democrats of Seminole County):
 * window.YSD_DATA.legal                                                     STATUS: DRAFT
 *
 * DRAFT: not legal advice; have counsel review before launch. Nothing here is in effect. The full
 * drafts for reviewers (with citations and open questions) are in docs/legal/*.md; this file holds
 * the SHORT, page-ready versions in English and Spanish, plus form copy (SMS consent, upload
 * consent, age screen, report, "forget me") and the Fla. Stat. 106.143 disclaimer placeholder.
 * Edit the .md draft first, then this file, and bump `updated`. Spanish needs a fluent human
 * reviewer before launch (reviewedSpanish: false).
 *
 * Classic script, no modules, no functions, no network: load it like any data/*.js file, after
 * assets/js/config.js:   <script src="data/legal.js"></script>
 *
 * ---------------------------------------------------------------------------------------- SCHEMA
 * L      = { en: string, es: string }            every user-facing string, both languages, plain
 *                                                text (no HTML: render with textContent)
 * Block  = exactly one of
 *            { p: L }                            paragraph
 *            { list: [L, ...] }                  bulleted list
 *            { steps: [L, ...] }                 numbered list
 *            { note: L }                         callout (draft notes, warnings)
 *            { links: [{ label: L, page?: id, href?: url }, ...] }
 *                                                page = a key of `pages` (link to its slug),
 *                                                href = absolute URL (open normally; tel: allowed)
 * Page   = { id, slug, title: L, short: L, summary: L, tldr: [L], sections: [Section],
 *            sources: [sourceId], fullDraft: 'docs/legal/....md' }
 *            slug      suggested file name for the page (design owns the actual page)
 *            short     nav/footer label; summary = one line for <meta name="description">
 *            tldr      3 to 8 bullets shown first ("The short version")
 * Section= { id, heading: L, body: [Block] }     id is a stable anchor (#privacy-collect etc.)
 *
 * YSD_DATA.legal = {
 *   version, status ('draft' until counsel signs off), reviewedByCounsel, reviewedSpanish,
 *   updated ('YYYY-MM-DD'), effective ('' until launch: show labels.notYetEffective), langs,
 *   banner: L                         show on every legal page while status === 'draft'
 *   tokens: { name: { from, fallback: L, suggested? } }
 *   labels: { key: L }                UI chrome for legal pages
 *   order: [pageId]                   footer / nav order
 *   pages: { privacy, minors, moderation, accessibility }   (Page)
 *   snippets: { ... }                 form and UI copy, documented inline below
 *   disclaimer: { statute, source, configKey, placeholder: L, note: L }
 *   sources: { id: { cite, label, url, checked } }           every citation, checked 2026-11-09
 * }
 *
 * TOKENS. Strings may contain {name} placeholders. Fill them at render time from YSD_CONFIG via
 * `from` (a dotted path for YSD.cfg); when that value is '' or missing, use `fallback[lang]`.
 * `suggested: true` marks config keys that do not exist in config.js yet (core may add them).
 *
 *   function legalText(L, lang) {                        // page code (a file, never inline)
 *     var d = window.YSD_DATA.legal, s = (L && (L[lang] || L.en)) || '';
 *     return s.replace(/\{(\w+)\}/g, function (m, k) {
 *       var t = d.tokens[k]; if (!t) return m;
 *       var v = t.from && window.YSD && YSD.cfg ? YSD.cfg(t.from, '') : '';
 *       return v !== '' && v != null ? String(v) : (t.fallback[lang] || t.fallback.en);
 *     });
 *   }
 *
 * Proposed numbers (review in 3 days, takedowns in 24 hours, retention periods, reply times) are
 * proposals for Kira and the YDSC board; docs/legal/README.md lists them.
 */
window.YSD_DATA = window.YSD_DATA || {};
window.YSD_DATA.legal = {
  version: 1,
  status: "draft",
  reviewedByCounsel: false,
  reviewedSpanish: false,
  updated: "2026-11-09",
  effective: "",
  langs: ["en", "es"],

  banner: {
    en: "DRAFT: not legal advice; have counsel review before launch.",
    es: "BORRADOR: no es asesoría legal; un abogado debe revisarlo antes del lanzamiento."
  },

  tokens: {
    org: { from: "org.name", fallback: { en: "Young Democrats of Seminole County", es: "Young Democrats of Seminole County" } },
    orgShort: { from: "org.short", fallback: { en: "YDSC", es: "YDSC" } },
    minAge: { from: "org.minAge", fallback: { en: "14", es: "14" } },
    privacyEmail: { from: "legal.privacyEmail", fallback: { en: "[privacy email, set before launch]", es: "[correo de privacidad, se configura antes del lanzamiento]" } },
    mailingAddress: { from: "legal.mailingAddress", fallback: { en: "[mailing address, set before launch]", es: "[dirección postal, se configura antes del lanzamiento]" } },
    smsNumber: { from: "legal.smsNumber", fallback: { en: "[texting number, set before launch]", es: "[número de mensajes, se configura antes del lanzamiento]" } },
    dmcaAgent: { from: "legal.dmcaAgent", suggested: true, fallback: { en: "[copyright agent, registered before uploads go live]", es: "[agente de derechos de autor, se registra antes de abrir las subidas]" } },
    soePhone: { from: "links.vote.countyPhone", fallback: { en: "407-585-8683", es: "407-585-8683" } }
  },

  labels: {
    updated: { en: "Last updated", es: "Última actualización" },
    effective: { en: "Effective", es: "Vigente desde" },
    notYetEffective: { en: "Not in effect yet. This is a draft for review.", es: "Todavía no está vigente. Es un borrador para revisión." },
    tldr: { en: "The short version", es: "En resumen" },
    onThisPage: { en: "On this page", es: "En esta página" },
    sources: { en: "Laws and sources", es: "Leyes y fuentes" },
    checked: { en: "Checked", es: "Verificado" },
    fullDraft: { en: "Full draft for reviewers", es: "Borrador completo para revisores" },
    backToTop: { en: "Back to top", es: "Volver arriba" },
    policies: { en: "Policies", es: "Políticas" },
    questions: { en: "Questions? Email {privacyEmail}.", es: "¿Preguntas? Escribe a {privacyEmail}." }
  },

  order: ["privacy", "minors", "moderation", "accessibility"],

  pages: {
    // ------------------------------------------------------------------------------- PRIVACY
    privacy: {
      id: "privacy",
      slug: "privacy.html",
      title: { en: "Privacy Policy", es: "Política de privacidad" },
      short: { en: "Privacy", es: "Privacidad" },
      summary: {
        en: "What the Young Democrats of Seminole County collect, why, who sees it, and how to delete it.",
        es: "Qué datos recopilan los Young Democrats of Seminole County, para qué, quién los ve y cómo borrarlos."
      },
      tldr: [
        { en: "Demo right now: everything you type stays in your own browser. Nothing is sent to us.", es: "Por ahora es una demo: todo lo que escribes se queda en tu navegador. No nos llega nada." },
        { en: "On the live site we only collect what you put in the join form, the texts you sign up for and the clips you choose to post.", es: "En el sitio real solo guardamos lo que pones en el formulario para unirte, los mensajes de texto que pidas y los clips que decidas publicar." },
        { en: "We never sell, rent or trade your info, and we never share your phone number for anyone's marketing.", es: "Nunca vendemos, alquilamos ni cambiamos tus datos, y nunca compartimos tu número de teléfono para publicidad de nadie." },
        { en: "No ad trackers and no cookies from us. If your browser sends Do Not Track or Global Privacy Control, we skip analytics completely.", es: "Sin rastreadores de anuncios y sin cookies nuestras. Si tu navegador envía “No rastrear” (Do Not Track) o Control Global de Privacidad (GPC), no usamos analíticas." },
        { en: "Texts only if you tick the box. Reply STOP any time.", es: "Mensajes de texto solo si marcas la casilla. Responde STOP cuando quieras." },
        { en: "A real person checks every clip before anyone else can see it.", es: "Una persona revisa cada clip antes de que alguien más lo vea." },
        { en: "Ask us to see, fix or delete your info at {privacyEmail}.", es: "Pídenos ver, corregir o borrar tus datos en {privacyEmail}." }
      ],
      sections: [
        {
          id: "privacy-who",
          heading: { en: "Who we are", es: "Quiénes somos" },
          body: [
            { p: { en: "The {org} ({orgShort}) is a volunteer club for Democrats ages 14 to under 40 in Seminole County, Florida. Volunteers run this site. “We” means {orgShort}.", es: "Los {org} ({orgShort}) son un club de voluntarios para demócratas de 14 a 39 años en el condado de Seminole, Florida. Este sitio lo manejan voluntarios. Cuando decimos “nosotros”, hablamos de {orgShort}." } },
            { p: { en: "Privacy questions: {privacyEmail}. Mail: {mailingAddress}.", es: "Preguntas sobre privacidad: {privacyEmail}. Correo postal: {mailingAddress}." } }
          ]
        },
        {
          id: "privacy-demo",
          heading: { en: "Demo site vs. live site", es: "Sitio de demostración vs. sitio real" },
          body: [
            { p: { en: "While this site is a demo, the join form, counters and clip uploads send nothing. Everything stays in your browser, and demo numbers and demo people are labeled as demo.", es: "Mientras el sitio sea una demo, el formulario para unirte, los contadores y las subidas de clips no envían nada. Todo se queda en tu navegador, y los números y las personas de la demo están marcados como demo." } },
            { p: { en: "On the live site, the join form goes to our member list (Action Network or a similar tool), and clips go to our video provider, where they wait for review.", es: "En el sitio real, el formulario va a nuestra lista de miembros (Action Network o una herramienta parecida) y los clips van a nuestro proveedor de video, donde esperan revisión." } }
          ]
        },
        {
          id: "privacy-collect",
          heading: { en: "What we collect and why", es: "Qué recopilamos y para qué" },
          body: [
            { list: [
              { en: "Join form: first name (required), last name, email or mobile number (one of the two), ZIP code, age, interests, and whether you want emails or texts. We use them to welcome you, invite you to things you care about, and follow our teen safety rules.", es: "Formulario para unirte: nombre (obligatorio), apellido, correo o celular (uno de los dos), código postal, edad, intereses y si quieres correos o mensajes de texto. Los usamos para darte la bienvenida, invitarte a lo que te interesa y seguir nuestras reglas de seguridad para adolescentes." },
              { en: "Added automatically: your invite code (like KIRA7QX: up to five letters of your first name plus random characters; members under 18 get random characters only), who invited you, the page you joined from, campaign tags in the link (utm_*), and when you joined.", es: "Se agrega solo: tu código de invitación (como KIRA7QX: hasta cinco letras de tu nombre más caracteres al azar; si tienes menos de 18 años, solo caracteres al azar), quién te invitó, la página desde la que te uniste, las etiquetas de campaña del enlace (utm_*) y la fecha." },
              { en: "Texts: if you tick the box, a consent record with your number, the time, the exact words you agreed to, the page and your IP address.", es: "Mensajes de texto: si marcas la casilla, un registro de tu consentimiento con tu número, la hora, el texto exacto que aceptaste, la página y tu dirección IP." },
              { en: "Clips: the video, a still frame, your caption, tags and handle, the clip's length and size, and your answers to the consent questions.", es: "Clips: el video, una imagen fija, tu descripción, etiquetas y usuario, la duración y el tamaño del clip, y tus respuestas a las preguntas de consentimiento." },
              { en: "Browsing: our host handles your IP address to deliver pages, like every website. No ad pixels, no social media trackers, no fingerprinting.", es: "Navegación: nuestro proveedor de hosting usa tu dirección IP para mostrarte las páginas, como cualquier sitio web. Sin píxeles de anuncios, sin rastreadores de redes sociales y sin huellas digitales del navegador." }
            ] },
            { p: { en: "If you're under 14, the form tells you and saves nothing. Donations and dues go through ActBlue: we never see your card number.", es: "Si tienes menos de 14 años, el formulario te lo dice y no guarda nada. Las donaciones y cuotas pasan por ActBlue: nunca vemos el número de tu tarjeta." } }
          ]
        },
        {
          id: "privacy-browser",
          heading: { en: "What's saved in your browser", es: "Qué se guarda en tu navegador" },
          body: [
            { p: { en: "This site's own code sets no cookies. It uses your browser's storage to remember your member profile, your invite code and squad, the invite code from a link you opened (it counts for 30 days), your clips, likes and views, and counter values. On the live site, your email, phone and ZIP are removed from your browser once they reach our list.", es: "El código de este sitio no pone cookies. Usa el almacenamiento de tu navegador para recordar tu perfil de miembro, tu código de invitación y tu grupo, el código de invitación de un enlace que abriste (cuenta por 30 días), tus clips, “me gusta” y vistas, y los contadores. En el sitio real, tu correo, teléfono y código postal se borran de tu navegador cuando llegan a nuestra lista." } },
            { p: { en: "Tap “Forget me on this device” to wipe it all, or clear site data in your browser settings. That doesn't delete what we already have on the live site: email us for that.", es: "Toca “Olvidarme en este dispositivo” para borrarlo todo, o borra los datos del sitio en la configuración de tu navegador. Eso no borra lo que ya tenemos en el sitio real: para eso, escríbenos." } },
            { p: { en: "ActBlue, Action Network, Mobilize, video players and the bot check may set their own cookies under their own policies.", es: "ActBlue, Action Network, Mobilize, los reproductores de video y la verificación anti-bots pueden poner sus propias cookies según sus propias políticas." } }
          ]
        },
        {
          id: "privacy-analytics",
          heading: { en: "Analytics, Do Not Track and GPC", es: "Analíticas, “No rastrear” y GPC" },
          body: [
            { p: { en: "The demo never sends analytics. The live site counts page visits with privacy-friendly tools (Cloudflare Web Analytics, maybe Plausible later) that don't collect personal data. Our code strips anything that looks personal (name, email, phone, ZIP, age and similar) before an event is sent.", es: "La demo nunca envía analíticas. El sitio real cuenta visitas con herramientas que respetan la privacidad (Cloudflare Web Analytics y quizá Plausible más adelante) y no recopilan datos personales. Nuestro código quita todo lo que parezca personal (nombre, correo, teléfono, código postal, edad y similares) antes de enviar un evento." } },
            { p: { en: "If your browser sends Do Not Track or Global Privacy Control, we send no analytics at all.", es: "Si tu navegador envía “No rastrear” o Control Global de Privacidad, no enviamos ninguna analítica." } },
            { p: { en: "Visit counts may show how many visits came through each member's invite link. They never show who you are.", es: "El conteo de visitas puede mostrar cuántas visitas llegaron por el enlace de invitación de cada miembro. Nunca muestra quién eres." } }
          ]
        },
        {
          id: "privacy-share",
          heading: { en: "Who we share with", es: "Con quién compartimos" },
          body: [
            { p: { en: "We don't sell, rent or trade your info. We share only what each service needs to help us run the club:", es: "No vendemos, alquilamos ni cambiamos tus datos. Solo compartimos lo que cada servicio necesita para ayudarnos a manejar el club:" } },
            { list: [
              { en: "Action Network (or the list tool we choose): your join form and consent choices.", es: "Action Network (o la herramienta de lista que elijamos): tu formulario y tus opciones de consentimiento." },
              { en: "Our texting provider: your number, first name and consent record.", es: "Nuestro proveedor de mensajes de texto: tu número, tu nombre y tu registro de consentimiento." },
              { en: "Mux or Cloudflare Stream: your clips, captions, tags and handle.", es: "Mux o Cloudflare Stream: tus clips, descripciones, etiquetas y usuario." },
              { en: "Cloudflare Turnstile: technical browser signals, to block bots.", es: "Cloudflare Turnstile: señales técnicas del navegador, para bloquear bots." },
              { en: "Cloudflare Pages or Netlify: your IP address, to host the site.", es: "Cloudflare Pages o Netlify: tu dirección IP, para alojar el sitio." },
              { en: "ActBlue: what you give ActBlue, plus the invite code in the donate link.", es: "ActBlue: lo que le das a ActBlue, más el código de invitación del enlace para donar." }
            ] },
            { p: { en: "We won't share your info with other organizations, including other Democratic groups, unless you say yes or the law requires it. Your mobile number is never shared for anyone's marketing.", es: "No compartiremos tus datos con otras organizaciones, ni siquiera con otros grupos demócratas, a menos que digas que sí o que la ley lo exija. Tu número de celular nunca se comparte para publicidad de nadie." } },
            { p: { en: "If you join through a friend's link, they may see your first name and last initial in their squad. Members under 18 show by first name only.", es: "Si te unes con el enlace de un amigo, esa persona puede ver tu nombre y la inicial de tu apellido en su grupo. Los miembros menores de 18 aparecen solo con su nombre." } }
          ]
        },
        {
          id: "privacy-sms",
          heading: { en: "Text messages", es: "Mensajes de texto" },
          body: [
            { list: [
              { en: "{orgShort} texts about events, volunteer shifts and voting reminders, from {smsNumber}.", es: "Mensajes de {orgShort} sobre eventos, turnos de voluntariado y recordatorios para votar, desde {smsNumber}." },
              { en: "Recurring automated texts, up to 4 a month, a few more right before an election.", es: "Mensajes automatizados recurrentes, hasta 4 al mes, y algunos más justo antes de una elección." },
              { en: "Message and data rates may apply. We never charge for texts.", es: "Pueden aplicarse tarifas de mensajes y datos. Nunca cobramos por los mensajes." },
              { en: "Reply STOP to stop (QUIT, END, CANCEL, UNSUBSCRIBE also work). We send one confirmation, then nothing. Reply HELP for help.", es: "Responde STOP para dejar de recibirlos (también sirven QUIT, END, CANCEL o UNSUBSCRIBE). Te enviamos una confirmación y luego nada más. Responde HELP para pedir ayuda." },
              { en: "Agreeing to texts is never required to join, come to events or donate.", es: "Aceptar los mensajes nunca es requisito para unirte, ir a eventos o donar." },
              { en: "For now, texts are only for members 18 and older.", es: "Por ahora, los mensajes de texto son solo para miembros de 18 años o más." }
            ] }
          ]
        },
        {
          id: "privacy-clips",
          heading: { en: "Clips you post", es: "Clips que publicas" },
          body: [
            { p: { en: "Nothing you upload is public until a person on our team approves it. Ask us to take down your own clip and we'll do it within 3 days, or within 24 hours if it shows someone under 18. Keep personal details out of captions.", es: "Nada de lo que subes es público hasta que una persona de nuestro equipo lo aprueba. Si nos pides quitar tu clip, lo hacemos en 3 días, o en 24 horas si aparece alguien menor de 18. No pongas datos personales en las descripciones." } },
            { links: [{ label: { en: "Read the Clip Rules", es: "Lee las Reglas para clips" }, page: "moderation" }] }
          ]
        },
        {
          id: "privacy-teens",
          heading: { en: "Kids and teens", es: "Niños y adolescentes" },
          body: [
            { p: { en: "We don't accept anyone under 13, and our club starts at 14. If we learn we have info from someone under 13, we delete it. Members 14 to 17 get extra protections for photos, video, texts and events. Parents and guardians can ask to see or delete their teen's info.", es: "No aceptamos a nadie menor de 13 años, y nuestro club empieza a los 14. Si descubrimos que tenemos datos de alguien menor de 13, los borramos. Los miembros de 14 a 17 años tienen protecciones extra para fotos, videos, mensajes de texto y eventos. Madres, padres y tutores legales pueden pedir ver o borrar los datos de su adolescente." } },
            { links: [{ label: { en: "Read the Teen Safety Policy", es: "Lee la Política de seguridad para adolescentes" }, page: "minors" }] }
          ]
        },
        {
          id: "privacy-retention",
          heading: { en: "How long we keep things", es: "Cuánto tiempo guardamos los datos" },
          body: [
            { list: [
              { en: "Member records: while you're a member. Each January we remove people who asked to leave or haven't been active for 2 years.", es: "Registros de miembros: mientras seas miembro. Cada enero quitamos a quienes pidieron salir o llevan 2 años sin participar." },
              { en: "Text consent records: 5 years after your last text from us, so we can prove you agreed.", es: "Registros de consentimiento para mensajes: 5 años después de tu último mensaje, para poder demostrar que aceptaste." },
              { en: "Opt-outs: kept (just the number or email and the date) so we never contact you again.", es: "Bajas: las guardamos (solo el número o correo y la fecha) para no volver a contactarte." },
              { en: "Clips we don't approve: deleted within 30 days. Published clips: until you or someone in it asks us to remove it, or 2 years.", es: "Clips no aprobados: se borran en 30 días. Clips publicados: hasta que tú o alguien que aparezca pida quitarlos, o 2 años." },
              { en: "Anything from someone under 13: deleted as soon as we know.", es: "Cualquier dato de alguien menor de 13: se borra en cuanto lo sepamos." }
            ] }
          ]
        },
        {
          id: "privacy-rights",
          heading: { en: "Your choices", es: "Tus opciones" },
          body: [
            { p: { en: "Email {privacyEmail} to see, fix or delete your info. We reply within 3 business days and finish within 30 days. When you ask us to delete, we also tell our list, texting and video services to delete it. We keep only what the law requires and a do-not-contact note.", es: "Escribe a {privacyEmail} para ver, corregir o borrar tus datos. Respondemos en 3 días hábiles y terminamos en 30 días. Cuando nos pides borrar, también se lo pedimos a nuestros servicios de lista, mensajes y video. Solo guardamos lo que exige la ley y una nota para no contactarte." } },
            { p: { en: "Unsubscribe from emails with the link in any email. Stop texts by replying STOP.", es: "Date de baja de los correos con el enlace que viene en cada uno. Deja de recibir mensajes respondiendo STOP." } }
          ]
        },
        {
          id: "privacy-security",
          heading: { en: "Security", es: "Seguridad" },
          body: [
            { p: { en: "HTTPS everywhere, secret keys kept off the website, and only named volunteers with two-factor logins can open the member list. Being on a Democratic club's list says something about your politics, so we treat it as sensitive and never post it. If a breach puts your info at risk, we'll tell you within 30 days.", es: "HTTPS en todo el sitio, claves secretas fuera de la página web y solo voluntarios designados, con verificación en dos pasos, pueden abrir la lista de miembros. Estar en la lista de un club demócrata dice algo sobre tus ideas políticas, así que la tratamos como información sensible y nunca la publicamos. Si una filtración pone en riesgo tus datos, te avisaremos en un plazo de 30 días." } }
          ]
        },
        {
          id: "privacy-changes",
          heading: { en: "Changes and contact", es: "Cambios y contacto" },
          body: [
            { p: { en: "When we change this policy, we update the date and say what changed. If a change affects info you already gave us, we'll ask you first. Contact: {privacyEmail}, {mailingAddress}.", es: "Cuando cambiemos esta política, actualizaremos la fecha y diremos qué cambió. Si un cambio afecta datos que ya nos diste, te preguntaremos primero. Contacto: {privacyEmail}, {mailingAddress}." } }
          ]
        }
      ],
      sources: ["coppa-rule", "ftc-coppa-faq", "tcpa-rule", "ctia-2023", "can-spam", "fl-501-171", "fl-501-702", "usc-1658", "actblue-privacy", "an-privacy", "cf-analytics", "plausible-data", "plausible-params", "turnstile-privacy"],
      fullDraft: "docs/legal/PRIVACY_DRAFT.md"
    },

    // -------------------------------------------------------------------------------- MINORS
    minors: {
      id: "minors",
      slug: "teen-safety.html",
      title: { en: "Teen Safety Policy", es: "Política de seguridad para adolescentes" },
      short: { en: "Teen safety", es: "Seguridad para adolescentes" },
      summary: {
        en: "How the Young Democrats of Seminole County protect members ages 14 to 17 online and at events.",
        es: "Cómo los Young Democrats of Seminole County protegen a los miembros de 14 a 17 años en línea y en los eventos."
      },
      tldr: [
        { en: "13 and under can't join. Our club starts at 14, and we never collect info from anyone under 13.", es: "Menores de 14 no pueden unirse. Nuestro club empieza a los 14 y nunca recopilamos datos de menores de 13." },
        { en: "Teens 14 to 17 are welcome to join, learn, volunteer and come to events.", es: "Los adolescentes de 14 a 17 años pueden unirse, aprender, ser voluntarios e ir a eventos." },
        { en: "No last names, no schools, no locations in anything we post that shows a teen.", es: "Sin apellidos, sin escuelas y sin ubicaciones en nada que publiquemos donde aparezca un adolescente." },
        { en: "A parent or guardian says yes before we post a photo or clip where a teen can be recognized.", es: "Una madre, padre o tutor legal dice que sí antes de publicar una foto o clip donde se reconozca a un adolescente." },
        { en: "No one-on-one DMs between adult organizers and teen members. Group chats with two adults, always.", es: "Nada de mensajes privados uno a uno entre organizadores adultos y miembros adolescentes. Siempre chats de grupo con dos adultos." },
        { en: "Two adults at anything teens attend. No adult is ever alone with a teen.", es: "Dos adultos en cualquier actividad con adolescentes. Ningún adulto se queda a solas con un adolescente." },
        { en: "No alcohol for anyone under 21.", es: "Nada de alcohol para menores de 21 años." }
      ],
      sections: [
        {
          id: "minors-ages",
          heading: { en: "Who can join", es: "Quién puede unirse" },
          body: [
            { list: [
              { en: "Under 14: can't join. We don't collect any info. (Federal privacy law treats anyone under 13 as a child; we go further.)", es: "Menores de 14: no pueden unirse y no recopilamos ningún dato. (La ley federal de privacidad considera niño a cualquier menor de 13; nosotros vamos más allá)." },
              { en: "14 to 17: welcome, with the protections on this page.", es: "De 14 a 17: bienvenidos, con las protecciones de esta página." },
              { en: "18 and up: adult members. Adults who work with teens follow this policy too.", es: "18 o más: miembros adultos. Los adultos que trabajan con adolescentes también siguen esta política." }
            ] },
            { p: { en: "The join form asks your age without hinting at an answer. If you're under 14, it saves nothing.", es: "El formulario te pregunta la edad sin sugerir ninguna respuesta. Si tienes menos de 14, no guarda nada." } }
          ]
        },
        {
          id: "minors-joining",
          heading: { en: "Joining at 14 to 17", es: "Unirte entre los 14 y los 17" },
          body: [
            { p: { en: "Teens join with the same short form as everyone. We ask for a parent or guardian contact only when a teen wants to be in a photo or clip, go to an off-site event, or get texts. In referral squads, teens show by first name only. We never aim donation asks at members under 18.", es: "Los adolescentes se unen con el mismo formulario corto que todos. Solo pedimos el contacto de una madre, padre o tutor legal cuando un adolescente quiere salir en una foto o clip, ir a un evento fuera del local o recibir mensajes de texto. En los grupos de invitación, los adolescentes aparecen solo con su nombre. Nunca dirigimos pedidos de donación a menores de 18." } }
          ]
        },
        {
          id: "minors-photos",
          heading: { en: "Photos and video of anyone under 18", es: "Fotos y videos de menores de 18" },
          body: [
            { steps: [
              { en: "Consent first: the teen's own OK plus written consent from a parent or legal guardian before we post anything where they can be recognized.", es: "Primero, el consentimiento: el permiso del adolescente y el permiso por escrito de su madre, padre o tutor legal antes de publicar algo donde se le reconozca." },
              { en: "No last names. First name only, or no name.", es: "Sin apellidos. Solo el nombre, o ningún nombre." },
              { en: "No school identifiers: no school names, mascots, logos, uniforms, ID badges, buildings or team jerseys.", es: "Nada que identifique la escuela: ni nombres de escuelas, mascotas, logos, uniformes, credenciales, edificios ni camisetas de equipos." },
              { en: "No location tags. We remove location data from files and post after the event, not live.", es: "Sin etiquetas de ubicación. Quitamos los datos de ubicación de los archivos y publicamos después del evento, no en vivo." },
              { en: "Uploads that show a minor wait in review until a moderator contacts the parent or guardian and gets consent. A checkbox alone isn't enough.", es: "Los clips subidos donde aparece un menor esperan en revisión hasta que una persona de moderación contacta a la madre, padre o tutor legal y obtiene su permiso. Marcar una casilla no basta." },
              { en: "No photos of minors in donation or fundraising posts.", es: "No usamos fotos de menores en publicaciones para pedir donaciones o recaudar fondos." },
              { en: "A teen or guardian can ask us to take anything down. We do it within 24 hours, no questions asked.", es: "Un adolescente o su tutor puede pedirnos quitar cualquier cosa. Lo hacemos en 24 horas, sin preguntas." }
            ] }
          ]
        },
        {
          id: "minors-online",
          heading: { en: "DMs and texts", es: "Mensajes privados y de texto" },
          body: [
            { list: [
              { en: "No private one-on-one messages between adult organizers and teen members, on any app. Use group chats with at least two adult organizers, or copy the guardian.", es: "Nada de mensajes privados uno a uno entre organizadores adultos y miembros adolescentes, en ninguna app. Usamos chats de grupo con al menos dos organizadores adultos, o con copia al tutor." },
              { en: "No disappearing-message apps with teens.", es: "Nada de apps con mensajes temporales (que se borran solos) con adolescentes." },
              { en: "For now, no club texts to members under 18.", es: "Por ahora, el club no envía mensajes de texto a menores de 18." },
              { en: "Nobody from the club asks a teen for their home address, school, schedule or personal photos.", es: "Nadie del club le pide a un adolescente su dirección, escuela, horario o fotos personales." }
            ] }
          ]
        },
        {
          id: "minors-events",
          heading: { en: "At events", es: "En los eventos" },
          body: [
            { list: [
              { en: "At least two adult organizers at every activity a minor attends. No adult alone with a minor: not in a room, a car or a call.", es: "Al menos dos organizadores adultos en cada actividad con menores. Ningún adulto a solas con un menor: ni en un cuarto, ni en un carro, ni en una llamada." },
              { en: "A named safety lead at each event has guardian contacts and is the person to tell if something's wrong.", es: "En cada evento hay una persona responsable de seguridad que tiene los contactos de los tutores y a quien puedes avisar si algo anda mal." },
              { en: "A parent or guardian permission form for anything off-site, after dark, overnight, or at a rally or protest.", es: "Un permiso de la madre, padre o tutor legal para cualquier actividad fuera del local, de noche, con pernoctación o en una marcha o protesta." },
              { en: "Canvassing in pairs, in daylight, with an adult team lead nearby. Never inside anyone's home.", es: "Para tocar puertas: en parejas, de día y con un adulto responsable cerca. Nunca dentro de una casa." },
              { en: "Events teens attend are alcohol-free or keep alcohol in a separate, ID-checked area. Giving alcohol to anyone under 21 is a crime in Florida.", es: "Los eventos con adolescentes no tienen alcohol o lo mantienen en un área aparte donde se revisa la identificación. En Florida es delito darle alcohol a menores de 21." }
            ] }
          ]
        },
        {
          id: "minors-report",
          heading: { en: "If something's wrong", es: "Si algo anda mal" },
          body: [
            { list: [
              { en: "Someone in danger right now: call 911.", es: "Si alguien está en peligro ahora mismo: llama al 911." },
              { en: "Suspected child abuse: Florida law says anyone who suspects it must report it to the Florida Abuse Hotline, 1-800-962-2873 (24/7). You don't need proof or anyone's permission.", es: "Sospecha de abuso infantil: la ley de Florida dice que cualquier persona que lo sospeche debe reportarlo a la Línea de Abuso de Florida (Florida Abuse Hotline), 1-800-962-2873 (24/7). No necesitas pruebas ni permiso de nadie." },
              { en: "Sexual exploitation of a child online: report it to NCMEC's CyberTipline. Don't download, screenshot or forward the material.", es: "Explotación sexual infantil en línea: repórtala a la CyberTipline del NCMEC. No descargues, no hagas captura de pantalla ni reenvíes el material." },
              { en: "Anything else that worries you: tell the event's safety lead or email {privacyEmail}. We follow up within 24 hours.", es: "Cualquier otra cosa que te preocupe: díselo a la persona responsable de seguridad del evento o escribe a {privacyEmail}. Damos seguimiento en 24 horas." }
            ] },
            { links: [
              { label: { en: "Florida Abuse Hotline: 1-800-962-2873", es: "Línea de Abuso de Florida: 1-800-962-2873" }, href: "tel:+18009622873" },
              { label: { en: "Report abuse online (not for emergencies)", es: "Reportar abuso en línea (no para emergencias)" }, href: "https://reportabuse.myflfamilies.com/s/" },
              { label: { en: "NCMEC CyberTipline", es: "CyberTipline del NCMEC" }, href: "https://report.cybertip.org/" }
            ] }
          ]
        },
        {
          id: "minors-parents",
          heading: { en: "For parents and guardians", es: "Para madres, padres y tutores" },
          body: [
            { p: { en: "You can ask what we have about your teen, ask us to delete it, withdraw photo consent at any time, or raise a concern with the club's youth safety officer at {privacyEmail}.", es: "Pueden preguntarnos qué datos tenemos de su adolescente, pedir que los borremos, retirar el permiso para fotos en cualquier momento o contarle una preocupación a la persona encargada de seguridad juvenil del club en {privacyEmail}." } }
          ]
        }
      ],
      sources: ["coppa-rule", "ftc-coppa-faq", "fl-743-07", "fl-540-08", "fl-934-03", "fl-934-02", "fl-97-041", "fl-97-0575", "fl-562-11", "fl-39-201", "dcf-hotline", "ncmec-cybertip", "fl-501-1736", "fl-501-1735", "tcpa-rule", "ctia-2023"],
      fullDraft: "docs/legal/MINORS_POLICY.md"
    },

    // ---------------------------------------------------------------------------- MODERATION
    moderation: {
      id: "moderation",
      slug: "content-policy.html",
      title: { en: "Clip Rules", es: "Reglas para clips" },
      short: { en: "Clip rules", es: "Reglas para clips" },
      summary: {
        en: "What you can post to the Young Democrats of Seminole County clip feed, what we remove, and how to report or appeal.",
        es: "Qué puedes publicar en los clips de los Young Democrats of Seminole County, qué quitamos y cómo reportar o apelar."
      },
      tldr: [
        { en: "A real person checks every clip before anyone else sees it.", es: "Una persona revisa cada clip antes de que alguien más lo vea." },
        { en: "Bring your voice: opinions, recaps, explainers, jokes, Spanish, all welcome. Disagreeing with politicians, Democrats included, is fine.", es: "Trae tu voz: opiniones, resúmenes, explicaciones, humor, en español o en inglés. Puedes criticar a cualquier político, incluidos los demócratas." },
        { en: "We remove harassment, doxxing, lies about how to vote, impersonation, hate, sexual content, and anything showing a minor without a guardian's OK.", es: "Quitamos el acoso, el doxeo, las mentiras sobre cómo votar, la suplantación de identidad, el odio, el contenido sexual y cualquier cosa que muestre a un menor sin permiso de su tutor." },
        { en: "Review takes up to 3 days. Reports about safety or minors: within 24 hours.", es: "La revisión tarda hasta 3 días. Los reportes sobre seguridad o menores: en 24 horas." },
        { en: "Report with the Report button or {privacyEmail}. Appeal within 14 days.", es: "Reporta con el botón Reportar o en {privacyEmail}. Puedes apelar en un plazo de 14 días." }
      ],
      sections: [
        {
          id: "moderation-review",
          heading: { en: "How review works", es: "Cómo funciona la revisión" },
          body: [
            { steps: [
              { en: "You upload a video file up to 3 minutes and 150 MB.", es: "Subes un video de hasta 3 minutos y 150 MB." },
              { en: "It's held as “pending”. Only you can see it.", es: "Queda “pendiente”. Solo tú puedes verlo." },
              { en: "A trained moderator watches all of it with sound and reads the caption and tags. Automated tools may flag things, but a person decides.", es: "Una persona capacitada lo ve completo, con sonido, y lee la descripción y las etiquetas. Las herramientas automáticas pueden marcar cosas, pero decide una persona." },
              { en: "Approved clips get captions corrected by a person, then go public.", es: "Los clips aprobados reciben subtítulos corregidos por una persona y luego se publican." }
            ] },
            { p: { en: "We decide within 3 days, usually sooner. Clips that show anyone under 18 also wait for guardian consent.", es: "Decidimos en 3 días, casi siempre antes. Los clips donde aparece alguien menor de 18 también esperan el permiso de su tutor." } }
          ]
        },
        {
          id: "moderation-welcome",
          heading: { en: "What's welcome", es: "Lo que sí" },
          body: [
            { list: [
              { en: "Your take on local and national issues, why you vote, why you joined.", es: "Tu opinión sobre temas locales y nacionales, por qué votas, por qué te uniste." },
              { en: "Event recaps, canvassing and tabling clips, behind the scenes.", es: "Resúmenes de eventos, clips tocando puertas o en mesas informativas, detrás de cámaras." },
              { en: "Voting explainers that point to official sources.", es: "Explicaciones sobre cómo votar que remiten a fuentes oficiales." },
              { en: "Humor, memes, parody and satire that are clearly labeled.", es: "Humor, memes, parodia y sátira, bien identificados como tales." },
              { en: "Criticism of public officials, candidates and parties, including Democrats.", es: "Críticas a funcionarios, candidatos y partidos, incluidos los demócratas." },
              { en: "Any language. Music and footage you made or have the rights to.", es: "Cualquier idioma. Música e imágenes que tú hiciste o que tienes derecho a usar." }
            ] }
          ]
        },
        {
          id: "moderation-removed",
          heading: { en: "What we remove", es: "Lo que quitamos" },
          body: [
            { list: [
              { en: "Harassment and threats: bullying, targeted insults, piling on, threats of violence.", es: "Acoso y amenazas: bullying, insultos dirigidos, ataques en grupo, amenazas de violencia." },
              { en: "Doxxing: home addresses, phone numbers, license plates, school or workplace of private people, voter-record details.", es: "Doxeo: direcciones, teléfonos, placas de carro, escuela o trabajo de personas privadas, datos del registro electoral." },
              { en: "False info about voting: wrong dates, places, ID or eligibility rules, mail-ballot steps, “vote by text” hoaxes. In Florida, knowingly using false info to keep someone from voting is a felony.", es: "Información falsa sobre cómo votar: fechas, lugares, requisitos de identificación o elegibilidad equivocados, pasos falsos para votar por correo, engaños como “vota por mensaje de texto”. En Florida, usar a sabiendas información falsa para que alguien no vote es un delito grave." },
              { en: "Impersonation of a person, candidate, election official, YDSC or any group. Parody must say “parody”.", es: "Suplantar a una persona, candidato, funcionario electoral, YDSC o cualquier grupo. La parodia debe decir “parodia”." },
              { en: "Deceptive AI and deepfakes that show a real person saying or doing something they didn't.", es: "IA engañosa y deepfakes que muestran a una persona real diciendo o haciendo algo que no hizo." },
              { en: "Hate: attacks on people for race, ethnicity, national origin, immigration status, religion, sex, gender identity, sexual orientation, disability or age.", es: "Odio: ataques por raza, etnia, origen nacional, estatus migratorio, religión, sexo, identidad de género, orientación sexual, discapacidad o edad." },
              { en: "Sexual content and nudity. Anything sexual involving a minor is removed and reported.", es: "Contenido sexual y desnudos. Todo contenido sexual con menores se quita y se reporta." },
              { en: "Anyone under 18 shown without guardian consent, and any minor's last name, school or location.", es: "Cualquier menor de 18 que aparezca sin permiso de su tutor, y el apellido, la escuela o la ubicación de cualquier menor." },
              { en: "Violence, gore, dangerous stunts and self-harm. If you're struggling, call or text 988.", es: "Violencia, contenido sangriento, retos peligrosos y autolesiones. Si estás pasando por un mal momento, llama o escribe al 988." },
              { en: "Illegal activity, secret recordings of private conversations, music or footage you don't have rights to, spam, scams and fake engagement.", es: "Actividades ilegales, grabaciones secretas de conversaciones privadas, música o imágenes sin derechos, spam, estafas y “me gusta” falsos." }
            ] },
            { p: { en: "If only part of a clip is a problem, we may ask you to trim, blur or recaption it. We don't edit your words for you.", es: "Si solo una parte del clip es un problema, puede que te pidamos recortarlo, difuminarlo o cambiar la descripción. No editamos tus palabras por ti." } }
          ]
        },
        {
          id: "moderation-report",
          heading: { en: "Report a clip", es: "Reportar un clip" },
          body: [
            { p: { en: "Tap Report on any clip or email {privacyEmail} with the link and what's wrong. Reports can be anonymous, and we never tell the uploader who reported.", es: "Toca Reportar en cualquier clip o escribe a {privacyEmail} con el enlace y el problema. Puedes reportar de forma anónima y nunca le decimos a quien subió el clip quién lo reportó." } },
            { list: [
              { en: "Threats, doxxing, sexual content, a minor shown without consent, or someone in danger: we hide the clip right away and review within 24 hours.", es: "Amenazas, doxeo, contenido sexual, un menor sin permiso o alguien en peligro: ocultamos el clip de inmediato y lo revisamos en 24 horas." },
              { en: "Everything else: within 3 days.", es: "Todo lo demás: en 3 días." },
              { en: "If a clip shows you, ask us to take it down even if no rule was broken: within 3 days, or 24 hours for a minor.", es: "Si apareces en un clip, puedes pedir que lo quitemos aunque no rompa ninguna regla: en 3 días, o en 24 horas si se trata de un menor." }
            ] },
            { note: { en: "Someone in danger? Call 911 first.", es: "¿Alguien en peligro? Llama primero al 911." } }
          ]
        },
        {
          id: "moderation-strikes",
          heading: { en: "Strikes and appeals", es: "Advertencias y apelaciones" },
          body: [
            { list: [
              { en: "First minor problem: the clip is declined or removed, with a note saying which rule.", es: "Primer problema menor: el clip se rechaza o se quita, con una nota que dice qué regla rompió." },
              { en: "Repeated problems: uploads paused for 30 days.", es: "Problemas repetidos: no puedes subir clips por 30 días." },
              { en: "Serious harm (threats, doxxing, sexual content, voting lies, minors without consent): upload access removed right away.", es: "Daño grave (amenazas, doxeo, contenido sexual, mentiras sobre el voto, menores sin permiso): se te quita el acceso para subir clips de inmediato." }
            ] },
            { p: { en: "Think we got it wrong? Reply to the decision or email {privacyEmail} within 14 days. Two moderators who weren't part of the first decision review it and answer within 7 days. Their decision is final.", es: "¿Crees que nos equivocamos? Responde a la decisión o escribe a {privacyEmail} en un plazo de 14 días. Dos personas de moderación que no participaron en la primera decisión lo revisan y responden en 7 días. Su decisión es definitiva." } }
          ]
        },
        {
          id: "moderation-copyright",
          heading: { en: "Copyright and the law", es: "Derechos de autor y la ley" },
          body: [
            { p: { en: "Copyright complaints go to our designated agent: {dmcaAgent}. Include the clip link, the work you own, your contact details and a good-faith statement. Uploaders can send a counter-notice. Repeat infringers lose upload access.", es: "Las quejas por derechos de autor van a nuestro agente designado: {dmcaAgent}. Incluye el enlace del clip, la obra que te pertenece, tus datos de contacto y una declaración de buena fe. Quien subió el clip puede enviar una contranotificación. Quien infrinja derechos varias veces pierde el acceso para subir clips." } },
            { p: { en: "We report child sexual exploitation to NCMEC and suspected child abuse to the Florida Abuse Hotline. We share info with law enforcement only when the law requires it.", es: "Reportamos la explotación sexual infantil al NCMEC y las sospechas de abuso infantil a la Línea de Abuso de Florida. Solo compartimos información con las autoridades cuando la ley lo exige." } }
          ]
        }
      ],
      sources: ["fl-104-0615", "fl-106-145", "fl-934-03", "fl-39-201", "fl-106-011", "usc-2258a", "usc-2258e", "dmca-faq", "ncmec-cybertip", "lifeline-988"],
      fullDraft: "docs/legal/MODERATION_POLICY.md"
    },

    // ------------------------------------------------------------------------- ACCESSIBILITY
    accessibility: {
      id: "accessibility",
      slug: "accessibility.html",
      title: { en: "Accessibility Statement", es: "Declaración de accesibilidad" },
      short: { en: "Accessibility", es: "Accesibilidad" },
      summary: {
        en: "Our accessibility goal (WCAG 2.2 AA), what doesn't work yet, and how to get help fast.",
        es: "Nuestra meta de accesibilidad (WCAG 2.2 AA), lo que todavía no funciona bien y cómo pedir ayuda rápido."
      },
      tldr: [
        { en: "Our goal: every page meets WCAG 2.2 Level AA.", es: "Nuestra meta: que todas las páginas cumplan con WCAG 2.2, nivel AA." },
        { en: "Where we are: a demo, not yet fully tested. Known problems are listed below.", es: "Dónde estamos: es una demo y todavía no la hemos probado a fondo. Abajo están los problemas que ya conocemos." },
        { en: "Stuck? Email {privacyEmail}. We reply within 2 business days and fix it or get you the info another way within 10.", es: "¿Algo no te funciona? Escribe a {privacyEmail}. Respondemos en 2 días hábiles y lo arreglamos o te damos la información de otra forma en 10." },
        { en: "Voting deadline today? Say it's urgent and we answer the same day.", es: "¿Tienes una fecha límite para votar hoy? Dinos que es urgente y te respondemos el mismo día." }
      ],
      sections: [
        {
          id: "accessibility-goal",
          heading: { en: "Our goal", es: "Nuestra meta" },
          body: [
            { p: { en: "We want everyone in Seminole County to be able to join, learn, show up and post, including people who use screen readers, keyboards, captions, magnification or voice control, and people who read in Spanish. We aim for the Web Content Accessibility Guidelines (WCAG) 2.2, Level AA. We haven't had a full audit yet, so we don't claim to meet it today.", es: "Queremos que todas las personas del condado de Seminole puedan unirse, aprender, participar y publicar, incluidas quienes usan lectores de pantalla, teclado, subtítulos, ampliación o control por voz, y quienes leen en español. Nuestra meta son las Pautas de Accesibilidad para el Contenido Web (WCAG) 2.2, nivel AA. Todavía no hemos hecho una auditoría completa, así que no decimos que ya las cumplimos." } }
          ]
        },
        {
          id: "accessibility-built",
          heading: { en: "What we've built in", es: "Lo que ya incluimos" },
          body: [
            { list: [
              { en: "Automated checks on every page at phone and desktop sizes (alt text, labels, contrast and more).", es: "Revisiones automáticas en cada página, en tamaño de celular y de computadora (texto alternativo, etiquetas, contraste y más)." },
              { en: "A video feed you can use with a keyboard: arrows or j/k to move, Space to play or pause, m for sound.", es: "Clips que puedes usar con el teclado: flechas o j/k para moverte, barra espaciadora para reproducir o pausar, m para el sonido." },
              { en: "Clips never autoplay when your device asks for reduced motion or data saving, and they start muted.", es: "Los clips nunca se reproducen solos si tu dispositivo pide menos movimiento o ahorro de datos, y empiezan sin sonido." },
              { en: "No picture puzzles to prove you're human.", es: "Sin rompecabezas de imágenes para demostrar que eres humano." },
              { en: "Pages in English and Spanish, with the page language set for screen readers.", es: "Páginas en inglés y en español, con el idioma marcado para los lectores de pantalla." },
              { en: "Captions, corrected by a person, on every published member clip with speech.", es: "Subtítulos corregidos por una persona en cada clip publicado que tenga voz." }
            ] }
          ]
        },
        {
          id: "accessibility-limits",
          heading: { en: "What doesn't work well yet", es: "Lo que todavía no funciona bien" },
          body: [
            { list: [
              { en: "No full audit or screen-reader testing yet: the demo is still being built.", es: "Todavía no hay auditoría completa ni pruebas con lectores de pantalla: la demo sigue en construcción." },
              { en: "Share cards are pictures. The same words are always on the page as text.", es: "Las tarjetas para compartir son imágenes. Las mismas palabras siempre están en la página como texto." },
              { en: "Clips you save on your own device in the demo have no captions.", es: "Los clips que guardas en tu dispositivo durante la demo no tienen subtítulos." },
              { en: "Some demo numbers move while the page is open. They go away on the live site.", es: "Algunos números de la demo se mueven mientras la página está abierta. Desaparecen en el sitio real." },
              { en: "Spanish text is still waiting for review by a fluent speaker.", es: "El texto en español todavía espera la revisión de una persona hablante nativa." },
              { en: "Sites we link to (ActBlue, Action Network, Mobilize, state and county election sites) have their own accessibility. If one blocks you, tell us and we'll help another way.", es: "Los sitios a los que enlazamos (ActBlue, Action Network, Mobilize, los sitios electorales del estado y del condado) tienen su propia accesibilidad. Si alguno te bloquea, avísanos y te ayudamos de otra forma." }
            ] }
          ]
        },
        {
          id: "accessibility-help",
          heading: { en: "Get help", es: "Pide ayuda" },
          body: [
            { p: { en: "Tell us what you need: the info in plain text, large print, in Spanish, read to you over the phone, or help filling in a form. Email {privacyEmail} with the page, what you were trying to do, and your device and assistive technology if you know them.", es: "Dinos qué necesitas: la información en texto simple, en letra grande, en español, leída por teléfono o ayuda para llenar un formulario. Escribe a {privacyEmail} con la página, lo que intentabas hacer y, si lo sabes, tu dispositivo y la tecnología de asistencia que usas." } },
            { list: [
              { en: "We reply within 2 business days.", es: "Respondemos en 2 días hábiles." },
              { en: "We fix it, or get you the same info another way, within 10 business days.", es: "Lo arreglamos, o te damos la misma información de otra forma, en 10 días hábiles." },
              { en: "Voting deadline today or tomorrow? Same day.", es: "¿Fecha límite para votar hoy o mañana? El mismo día." },
              { en: "Not happy with our answer? Ask for it to go to the {orgShort} board, and we answer in writing within 10 business days.", es: "¿No te convence nuestra respuesta? Pide que llegue a la directiva de {orgShort} y te respondemos por escrito en 10 días hábiles." }
            ] }
          ]
        },
        {
          id: "accessibility-voting",
          heading: { en: "Accessible voting", es: "Votar con accesibilidad" },
          body: [
            { p: { en: "For accessible ballots, help at the polls and mail ballots, the official source is the Seminole County Supervisor of Elections.", es: "Para boletas accesibles, ayuda en los centros de votación y voto por correo, la fuente oficial es la oficina del Supervisor de Elecciones del condado de Seminole." } },
            { links: [
              { label: { en: "Seminole County Supervisor of Elections", es: "Supervisor de Elecciones del condado de Seminole" }, href: "https://voteseminole.gov/" },
              { label: { en: "Call {soePhone}", es: "Llama al {soePhone}" }, href: "tel:+14075858683" }
            ] }
          ]
        }
      ],
      sources: ["wcag22", "wai-statements", "turnstile-docs"],
      fullDraft: "docs/legal/ACCESSIBILITY_STATEMENT.md"
    }
  },

  snippets: {
    /** Footer line under the policy links while demo is on. */
    demoNotice: {
      en: "DEMO preview: forms here don't send anything. Everything stays in your browser.",
      es: "Vista previa DEMO: los formularios no envían nada. Todo se queda en tu navegador."
    },

    /** Join form. Show joinNotice under the submit button, linked to the privacy page. */
    joinNotice: {
      en: "By joining, you'll get updates from {orgShort}. We never sell your info. See our Privacy Policy.",
      es: "Al unirte, recibirás novedades de {orgShort}. Nunca vendemos tus datos. Consulta nuestra Política de privacidad."
    },
    /**
     * Neutral age screen (FTC COPPA FAQ H.3): free entry, no hint at the minimum before entry, no
     * pre-filled value. Show ageTooYoung only after validate() returns errors.age === 'too_young'.
     */
    ageLabel: { en: "How old are you?", es: "¿Cuántos años tienes?" },
    ageHint: { en: "We ask so we can follow our teen safety rules.", es: "Te lo preguntamos para seguir nuestras reglas de seguridad para adolescentes." },
    ageTooYoung: {
      en: "Thanks for your interest! Members need to be at least {minAge}. We didn't save anything you typed. Everything on this site is still yours to read.",
      es: "¡Gracias por tu interés! Para ser miembro necesitas tener al menos {minAge} años. No guardamos nada de lo que escribiste. Puedes seguir leyendo todo lo que hay en este sitio."
    },
    /** Shown when age is 14 to 17 (members.js keeps extra fields such as guardianEmail as-is). */
    guardianLabel: { en: "Parent or guardian email (optional)", es: "Correo de tu madre, padre o tutor legal (opcional)" },
    guardianHint: {
      en: "We only use it to ask their OK before you're in a photo or clip, or before an off-site event.",
      es: "Solo lo usamos para pedir su permiso antes de que salgas en una foto o clip, o antes de un evento fuera del local."
    },
    emailConsent: {
      en: "Email me {orgShort} news and event invites. Unsubscribe anytime.",
      es: "Envíenme por correo noticias de {orgShort} e invitaciones a eventos. Puedo darme de baja cuando quiera."
    },
    /**
     * SMS opt-in checkbox: UNCHECKED by default, never required. Store `version` and the exact
     * label shown with the consent record (CTIA 5.1.2). Hide the box when age < 18 (proposal).
     */
    smsConsent: {
      version: "sms-consent-2026-11-09-draft",
      label: {
        en: "Text me about {orgShort} events, volunteer shifts and voting reminders from {smsNumber}. Recurring automated texts, up to 4 msgs/month. Msg & data rates may apply. Reply HELP for help, STOP to opt out. Agreeing isn't required to join or donate. See our Privacy Policy and SMS terms.",
        es: "Envíenme mensajes de texto de {orgShort} sobre eventos, turnos de voluntariado y recordatorios para votar desde {smsNumber}. Mensajes automatizados recurrentes, hasta 4 al mes. Pueden aplicarse tarifas de mensajes y datos. Responde HELP para ayuda o STOP para cancelar. Aceptar no es requisito para unirte ni para donar. Consulta nuestra Política de privacidad y los términos de SMS."
      },
      teenNote: { en: "Texts are for members 18 and older for now.", es: "Por ahora, los mensajes de texto son solo para miembros de 18 años o más." }
    },
    /** First text after opt-in (CTIA 5.1.2.1), the HELP reply and the STOP confirmation. */
    smsMessages: {
      confirm: {
        en: "{orgShort}: You're in! Recurring texts about events & voting, up to 4/mo. Msg & data rates may apply. Reply HELP for help, STOP to opt out.",
        es: "{orgShort}: ¡Ya estás! Mensajes recurrentes sobre eventos y votación, hasta 4 al mes. Pueden aplicarse tarifas de mensajes y datos. HELP para ayuda, STOP para cancelar."
      },
      help: {
        en: "{orgShort} texts: events & voting reminders, up to 4/mo. Help: {privacyEmail}. Msg & data rates may apply. Reply STOP to opt out.",
        es: "Mensajes de {orgShort}: eventos y recordatorios para votar, hasta 4 al mes. Ayuda: {privacyEmail}. Pueden aplicarse tarifas de mensajes y datos. STOP para cancelar."
      },
      stop: {
        en: "{orgShort}: You're unsubscribed and won't get more texts from this number.",
        es: "{orgShort}: Te diste de baja y no recibirás más mensajes de este número."
      }
    },

    /**
     * Clip upload consent. All `required` boxes must be ticked before upload. If minorsInClip is
     * 'yes' (or the uploader is under 18), require guardianContact and hold the clip until a
     * moderator has guardian consent (Teen Safety Policy).
     */
    uploadConsent: [
      { id: "rights", required: true, label: { en: "I made this clip or have permission to post everything in it, including the music.", es: "Yo hice este clip o tengo permiso para publicar todo lo que contiene, incluida la música." } },
      { id: "people", required: true, label: { en: "Everyone who can be recognized in this clip agreed to be in it.", es: "Todas las personas que se reconocen en este clip aceptaron aparecer." } },
      { id: "rules", required: true, label: { en: "I've read the Clip Rules. A person reviews every clip before it goes public.", es: "Leí las Reglas para clips. Una persona revisa cada clip antes de publicarlo." } }
    ],
    minorsInClip: {
      question: { en: "Does anyone under 18 appear in this clip (including you)?", es: "¿Aparece en este clip alguien menor de 18 años (incluyéndote a ti)?" },
      yes: { en: "Yes", es: "Sí" },
      no: { en: "No", es: "No" },
      guardianContact: { en: "Parent or guardian email or phone", es: "Correo o teléfono de la madre, el padre o el tutor legal" },
      guardianNote: {
        en: "We'll contact them before your clip goes public. No last names, schools or locations in the clip or caption.",
        es: "Les escribiremos antes de publicar tu clip. Nada de apellidos, escuelas ni ubicaciones en el clip o la descripción."
      }
    },
    uploadPending: {
      en: "Thanks! Your clip is in review. A person on our team checks every clip, usually within 3 days. Only you can see it until then.",
      es: "¡Gracias! Tu clip está en revisión. Una persona de nuestro equipo revisa cada clip, casi siempre en 3 días. Hasta entonces, solo tú puedes verlo."
    },

    /** Report control on each clip. `reasons` ids match the Clip Rules. */
    report: {
      button: { en: "Report", es: "Reportar" },
      title: { en: "Report this clip", es: "Reportar este clip" },
      prompt: { en: "What's wrong?", es: "¿Cuál es el problema?" },
      reasons: [
        { id: "harassment", label: { en: "Harassment or threats", es: "Acoso o amenazas" } },
        { id: "doxxing", label: { en: "Shares private info (doxxing)", es: "Comparte datos privados (doxeo)" } },
        { id: "voting", label: { en: "False info about voting", es: "Información falsa sobre cómo votar" } },
        { id: "impersonation", label: { en: "Impersonation or fake account", es: "Suplantación o cuenta falsa" } },
        { id: "deepfake", label: { en: "Deceptive AI or deepfake", es: "IA engañosa o deepfake" } },
        { id: "hate", label: { en: "Hate", es: "Odio" } },
        { id: "sexual", label: { en: "Sexual content or nudity", es: "Contenido sexual o desnudos" } },
        { id: "minor", label: { en: "Shows a minor without consent", es: "Muestra a un menor sin permiso" } },
        { id: "me", label: { en: "It shows me and I want it down", es: "Aparezco yo y quiero que lo quiten" } },
        { id: "violence", label: { en: "Violence or self-harm", es: "Violencia o autolesiones" } },
        { id: "copyright", label: { en: "Copyright", es: "Derechos de autor" } },
        { id: "spam", label: { en: "Spam or scam", es: "Spam o estafa" } },
        { id: "other", label: { en: "Something else", es: "Otra cosa" } }
      ],
      details: { en: "Anything else we should know? (optional)", es: "¿Algo más que debamos saber? (opcional)" },
      danger: { en: "If someone is in danger, call 911 now.", es: "Si alguien está en peligro, llama al 911 ahora." },
      thanks: {
        en: "Thanks. We'll review it within 3 days, or within 24 hours if someone could get hurt. We never tell the uploader who reported.",
        es: "Gracias. Lo revisaremos en 3 días, o en 24 horas si alguien podría salir lastimado. Nunca le decimos a quien subió el clip quién lo reportó."
      }
    },

    /** "Forget me" button: call YSD.members.forget() and YSD.clips.reset(). */
    forgetMe: {
      button: { en: "Forget me on this device", es: "Olvidarme en este dispositivo" },
      confirm: {
        en: "This removes your member info, invite data and clips saved in this browser. It doesn't delete what we already have on the live site: email {privacyEmail} for that.",
        es: "Esto borra tu información de miembro, tus datos de invitación y los clips guardados en este navegador. No borra lo que ya tenemos en el sitio real: para eso, escribe a {privacyEmail}."
      },
      done: { en: "Done. This browser no longer has your info.", es: "Listo. Este navegador ya no tiene tus datos." }
    },

    /** Sign for event check-in tables and RSVP pages. */
    eventPhotoNotice: {
      en: "Heads up: we take photos at this event. Tell the check-in table if you'd rather not be in them. We never post anyone under 18 without a parent's or guardian's OK.",
      es: "Aviso: tomamos fotos en este evento. Si prefieres no salir, díselo a la mesa de registro. Nunca publicamos a menores de 18 sin permiso de su madre, padre o tutor legal."
    },

    /** One-line safety contacts for event pages and the teen safety page. */
    safetyLine: {
      en: "Emergency: 911. Suspected child abuse: Florida Abuse Hotline, 1-800-962-2873.",
      es: "Emergencias: 911. Sospecha de abuso infantil: Línea de Abuso de Florida, 1-800-962-2873."
    }
  },

  /**
   * Florida political advertising disclaimer: PLACEHOLDER for the chapter. Pages render
   * YSD_CONFIG.legal.paidFor (owned by core); this is the shape counsel will fill in, plus a note
   * for reviewers. Do not show `note` on the public site.
   */
  disclaimer: {
    statute: "Fla. Stat. 106.143",
    source: "fl-106-143",
    configKey: "legal.paidFor",
    placeholder: {
      en: "Pd. pol. adv. Paid for by [ENTITY NAME], [STREET ADDRESS, CITY, FL ZIP]. [Paid for by / provided in kind by ...]",
      es: "Anuncio político pagado (pd. pol. adv.). Pagado por [NOMBRE DE LA ENTIDAD], [DIRECCIÓN, CIUDAD, FL CÓDIGO POSTAL]. [Pagado por / aportado en especie por ...]"
    },
    note: {
      en: "Placeholder. Under Fla. Stat. 106.143(1)(c), a political ad not paid for by a candidate must be marked “paid political advertisement” or “pd. pol. adv.”, give the name and address of whoever paid, and say whether it was paid for or provided in kind. An ad in Spanish may give that information in Spanish (106.143(9)). The chapter and its lawyer supply the final wording, payer and address before launch.",
      es: "Texto provisional. Según la ley de Florida (Fla. Stat. 106.143(1)(c)), un anuncio político que no paga un candidato debe decir “paid political advertisement” o “pd. pol. adv.”, dar el nombre y la dirección de quien lo pagó e indicar si se pagó o se aportó en especie. Un anuncio en español puede dar esa información en español (106.143(9)). El capítulo y su abogado deben aportar el texto final, quién paga y la dirección antes del lanzamiento."
    }
  },

  sources: {
    "coppa-rule": { cite: "16 CFR 312.2", label: "COPPA Rule definitions (child = under 13)", url: "https://www.law.cornell.edu/cfr/text/16/312.2", checked: "2026-11-09" },
    "ftc-coppa-faq": { cite: "FTC COPPA FAQ", label: "FTC, Complying with COPPA: Frequently Asked Questions", url: "https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions", checked: "2026-11-09" },
    "tcpa-rule": { cite: "47 CFR 64.1200", label: "TCPA rules: consent and opt-out for calls and texts", url: "https://www.law.cornell.edu/cfr/text/47/64.1200", checked: "2026-11-09" },
    "ctia-2023": { cite: "CTIA Messaging Principles (May 2023)", label: "CTIA Messaging Principles and Best Practices", url: "https://api.ctia.org/wp-content/uploads/2023/05/230523-CTIA-Messaging-Principles-and-Best-Practices-FINAL.pdf", checked: "2026-11-09" },
    "can-spam": { cite: "CAN-SPAM", label: "FTC, CAN-SPAM Act compliance guide", url: "https://www.ftc.gov/business-guidance/resources/can-spam-act-compliance-guide-business", checked: "2026-11-09" },
    "usc-1658": { cite: "28 U.S.C. 1658(a)", label: "Four-year limit for federal claims", url: "https://www.law.cornell.edu/uscode/text/28/1658", checked: "2026-11-09" },
    "usc-2258a": { cite: "18 U.S.C. 2258A", label: "Reporting child sexual exploitation to NCMEC", url: "https://www.law.cornell.edu/uscode/text/18/2258A", checked: "2026-11-09" },
    "usc-2258e": { cite: "18 U.S.C. 2258E", label: "Definitions (provider)", url: "https://www.law.cornell.edu/uscode/text/18/2258E", checked: "2026-11-09" },
    "dmca-faq": { cite: "17 U.S.C. 512(c)(2)", label: "US Copyright Office, DMCA designated agent FAQ ($6, renew every 3 years)", url: "https://www.copyright.gov/dmca-directory/faq.html", checked: "2026-11-09" },
    "fl-106-143": { cite: "Fla. Stat. 106.143", label: "Political advertisements circulated prior to election; requirements", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.143.html", checked: "2026-11-09" },
    "fl-106-011": { cite: "Fla. Stat. 106.011", label: "Campaign finance definitions (political advertisement, political committee)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.011.html", checked: "2026-11-09" },
    "fl-106-145": { cite: "Fla. Stat. 106.145", label: "Use of artificial intelligence in political advertising", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0106/Sections/0106.145.html", checked: "2026-11-09" },
    "fl-104-0615": { cite: "Fla. Stat. 104.0615", label: "Voter intimidation or suppression prohibited", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0100-0199/0104/Sections/0104.0615.html", checked: "2026-11-09" },
    "fl-97-041": { cite: "Fla. Stat. 97.041", label: "Qualifications to register or vote (pre-registration at 16)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.041.html", checked: "2026-11-09" },
    "fl-97-0575": { cite: "Fla. Stat. 97.0575", label: "Third-party voter registration organizations", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0097/Sections/0097.0575.html", checked: "2026-11-09" },
    "fl-743-07": { cite: "Fla. Stat. 743.07", label: "Age of majority (18)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0700-0799/0743/Sections/0743.07.html", checked: "2026-11-09" },
    "fl-540-08": { cite: "Fla. Stat. 540.08", label: "Unauthorized publication of name or likeness (parent consent for minors)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0540/Sections/0540.08.html", checked: "2026-11-09" },
    "fl-934-02": { cite: "Fla. Stat. 934.02", label: "Definitions (oral communication)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.02.html", checked: "2026-11-09" },
    "fl-934-03": { cite: "Fla. Stat. 934.03", label: "Interception of communications (all-party consent)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0900-0999/0934/Sections/0934.03.html", checked: "2026-11-09" },
    "fl-562-11": { cite: "Fla. Stat. 562.11", label: "Alcohol and persons under 21", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0562/Sections/0562.11.html", checked: "2026-11-09" },
    "fl-39-201": { cite: "Fla. Stat. 39.201", label: "Required reports of child abuse, abandonment or neglect", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0000-0099/0039/Sections/0039.201.html", checked: "2026-11-09" },
    "fl-501-1736": { cite: "Fla. Stat. 501.1736", label: "Social media use for minors (HB 3, 2024)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1736.html", checked: "2026-11-09" },
    "fl-501-1735": { cite: "Fla. Stat. 501.1735", label: "Protection of children in online spaces", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.1735.html", checked: "2026-11-09" },
    "fl-501-171": { cite: "Fla. Stat. 501.171", label: "Florida Information Protection Act (security and breach notice)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.171.html", checked: "2026-11-09" },
    "fl-501-702": { cite: "Fla. Stat. 501.702", label: "Florida Digital Bill of Rights definitions (who it covers)", url: "http://www.leg.state.fl.us/statutes/index.cfm?App_mode=Display_Statute&URL=0500-0599/0501/Sections/0501.702.html", checked: "2026-11-09" },
    "dcf-hotline": { cite: "Florida DCF", label: "Florida Abuse Hotline (1-800-962-2873)", url: "https://www.myflfamilies.com/services/abuse/abuse-hotline", checked: "2026-11-09" },
    "ncmec-cybertip": { cite: "NCMEC", label: "CyberTipline", url: "https://report.cybertip.org/", checked: "2026-11-09" },
    "lifeline-988": { cite: "988 Lifeline", label: "988 Suicide & Crisis Lifeline (call or text 988)", url: "https://988lifeline.org/", checked: "2026-11-09" },
    "actblue-privacy": { cite: "ActBlue", label: "ActBlue Privacy Policy (effective Oct 1, 2026)", url: "https://www.actblue.com/legal-privacy/", checked: "2026-11-09" },
    "an-privacy": { cite: "Action Network", label: "Action Network Privacy Policy (revised Feb 26, 2026)", url: "https://actionnetwork.org/privacy", checked: "2026-11-09" },
    "cf-analytics": { cite: "Cloudflare", label: "Cloudflare Web Analytics: no personal data", url: "https://developers.cloudflare.com/web-analytics/about/", checked: "2026-11-09" },
    "plausible-data": { cite: "Plausible", label: "Plausible data policy: no cookies, no stored IPs", url: "https://plausible.io/data-policy", checked: "2026-11-09" },
    "plausible-params": { cite: "Plausible", label: "Plausible custom query parameters (keeps ref, source and utm_*)", url: "https://plausible.io/docs/custom-query-params", checked: "2026-11-09" },
    "turnstile-privacy": { cite: "Cloudflare", label: "Turnstile Privacy Addendum (June 18, 2025)", url: "https://www.cloudflare.com/turnstile-privacy-policy/", checked: "2026-11-09" },
    "turnstile-docs": { cite: "Cloudflare", label: "Turnstile overview (no visual puzzle; WCAG 2.2 AA)", url: "https://developers.cloudflare.com/turnstile/", checked: "2026-11-09" },
    "wcag22": { cite: "WCAG 2.2", label: "W3C, Web Content Accessibility Guidelines 2.2 (Dec 12, 2024 edition)", url: "https://www.w3.org/TR/WCAG22/", checked: "2026-11-09" },
    "wai-statements": { cite: "W3C WAI", label: "Developing an Accessibility Statement", url: "https://www.w3.org/WAI/planning/statements/", checked: "2026-11-09" }
  }
};
